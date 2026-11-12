#!/usr/bin/env node
// scripts/probar-solicitudes-celular.js
//
// Prueba, en un Chromium REAL con pantalla de celular, de las SOLICITUDES CIUDADANAS (parche 303, Fase 2):
//   · el formulario por pasos (validaciones de cada paso, categoría que trae su ayuda, tope de 3 fotos);
//   · SIN SEÑAL: la solicitud queda en el cajón `solicitudes_pendientes` de IndexedDB con sus fotos como Blob, y la pantalla lo dice;
//   · al volver la señal «Mis solicitudes» la sube sola, con sus fotos, y el servidor la guarda UNA vez (idempotente por cliente_uuid);
//   · la cola es de QUIEN LA HIZO: otra cuenta en el mismo celular no la ve ni la sube; al volver la dueña, sube;
//   · una solicitud sin la casilla de autorización se guarda sin nombre ni teléfono, aunque se hayan escrito;
//   · la ubicación es opcional y no bloquea el guardado;
//   · lo guardado en el servidor: fotos reducidas a 1.280 px y sin EXIF.
//
// USO (sobre una base desechable ya inicializada con init-db; hace falta Chromium, ver scripts/capturas/navegador.js):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada303c node scripts/probar-solicitudes-celular.js
//
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) {
  console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`);
  process.exit(2);
}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const pool = require('../config/db');
const { lanzar, espera } = require('./capturas/navegador');
const { crear } = require('./capturas/servidor');
const S = require('../lib/solicitudes');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }

let n = 0;
async function lider(nombre) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = 'lider'), 1)`,
    [nombre, `9400000${n}`, `u9400000${n}`, bcrypt.hashSync('clave-ejemplo', 4)]);
  await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, NULL, 1)', [r.insertId, 'lider']);
  return r.insertId;
}

(async () => {
  // Activar complementos (parche 318): los complementos nacen APAGADOS; esta prueba enciende los que necesita.
  await require('./fixtures/encender-complementos')(pool, ['solicitudes']);
  let servidor; let navegador; // Las fotos de prueba van en una carpeta NO oculta del hogar: el Chromium de snap no puede leer archivos de carpetas ocultas (.cache) y se cuelga al guardarlos.
  const tmp = fs.mkdtempSync(path.join(os.homedir(), 'sol-cel-'));
  const archivosCreados = [];
  try {
    await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
    await q(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES ('lider', 'solicitudes', 1, 0, 1)
             ON DUPLICATE KEY UPDATE permitido = 1, editar = 0, agregar = 1`);
    const ana = await lider('Ana Ejemplo');
    const beto = await lider('Beto Ejemplo');
    console.log('SOLICITUDES CIUDADANAS, EN EL CELULAR — base «' + nombreBase + '»\n');

    // Tres fotos de prueba grandes y CON metadatos.
    const fotos = [];
    for (let i = 0; i < 4; i++) {
      const f = path.join(tmp, `foto${i}.jpg`);
      await sharp({ create: { width: 2400, height: 1800, channels: 3, background: { r: 120 + i * 20, g: 90, b: 60 } } })
        .withExif({ IFD0: { Copyright: 'secreto-gps-' + i } }).jpeg().toFile(f);
      fotos.push(f);
    }

    const app = crear(pool);
    servidor = http.createServer(app);
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${servidor.address().port}`;
    navegador = await lanzar();
    const p = await navegador.pagina('about:blank');
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
    await p.cmd('Network.clearBrowserCookies');
    // «Sin señal»: Chromium no corta el tráfico a 127.0.0.1 con emulateNetworkConditions, así que se corta donde la app lo nota: fetch falla como sin red.
    await p.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.confirm = () => true; window.__sinSenal = false;
      const f = window.fetch.bind(window); window.fetch = (...a) => (window.__sinSenal ? Promise.reject(new TypeError('Failed to fetch')) : f(...a));` });

    const sinSenal = (off) => p.ev(`window.__sinSenal = ${off ? 'true' : 'false'}`);
    const entrarComo = async (id) => { await p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(id), url: base }); };
    const ir = async (ruta, ms = 1800) => { await p.cmd('Page.navigate', { url: base + ruta }); await espera(ms); };
    const clic = (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
    const escribir = (sel, v) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);
    /* Desde el rediseño del celular (parche 320) los avisos ya no van en #aviso: los generales salen en el aviso flotante (#toast-app) y los de un campo
       debajo del campo (.error-campo). `texto('#aviso')` junta las tres fuentes para que la prueba lea lo que la persona ve. */
    const texto = (sel) => p.ev(sel === '#aviso'
      ? `(() => { const t = [document.querySelector('#aviso'), document.querySelector('#toast-app'), ...document.querySelectorAll('.error-campo')].filter(Boolean).map(e => e.textContent.trim()).filter(Boolean).join(' | '); return t; })()`
      : `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.trim() : null; })()`);
    const visible = (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && getComputedStyle(e).display !== 'none'; })()`);
    const pasoActivo = () => p.ev(`(() => { const e = document.querySelector('.paso.activo'); return e ? Number(e.dataset.paso) : 0; })()`);
    const subirFoto = async (ruta) => {
      const { result: doc } = await p.cmd('DOM.getDocument', { depth: 0 });
      const { result: nodo } = await p.cmd('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#archivo-foto' });
      await p.cmd('DOM.setFileInputFiles', { files: [ruta], nodeId: nodo.nodeId });
      await espera(900);
    };
    const cola = () => p.ev(`(async () => {
      const db = await abrirBaseOffline();
      const todo = await new Promise((ok, ko) => { const r = db.transaction('solicitudes_pendientes', 'readonly').objectStore('solicitudes_pendientes').getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
      return todo.map((r) => ({ uuid: r.clienteUuid, usuarioId: r.usuarioId, estado: r.estado || '', fotos: (r.fotos || []).length, sonBlob: (r.fotos || []).every((b) => b instanceof Blob), nombre: r.payload.ciudadano_nombre, telefono: r.payload.ciudadano_telefono, autoriza: r.payload.autoriza_datos }));
    })()`);

    /* =============================================================================================== 1. el formulario por pasos */
    console.log('[1] El formulario por pasos');
    await entrarComo(ana);
    await ir('/app/solicitud-nueva.html');
    const bodyOk = await p.ev(`document.querySelectorAll('#categorias button').length`);
    ok(bodyOk === 9, 'carga las nueve categorías', bodyOk);
    ok((await pasoActivo()) === 1, 'arranca en el paso 1');
    await clic('#btn-siguiente');
    ok((await pasoActivo()) === 1 && /categoría/i.test(await texto('#aviso')), 'sin categoría no avanza y lo dice', await texto('#aviso'));
    await p.ev(`[...document.querySelectorAll('#categorias button')].find((b) => /salud/i.test(b.textContent)).click()`);
    ok(/diagn/i.test(await texto('#ayuda-categoria') || ''), 'al elegir «Salud» aparece su ayuda: la necesidad, sin diagnósticos');
    await escribir('#f-descripcion', 'corta');
    await clic('#btn-siguiente');
    ok((await pasoActivo()) === 1 && /10 letras/i.test(await texto('#aviso')), 'una descripción corta no avanza', await texto('#aviso'));
    await escribir('#f-descripcion', 'No hay un puesto de salud cerca de la vereda y la gente debe caminar dos horas.');
    await clic('#btn-siguiente');
    ok((await pasoActivo()) === 2, 'con categoría y descripción pasa al paso 2');
    for (let i = 0; i < 3; i++) await subirFoto(fotos[i]);
    ok((await p.ev(`document.querySelectorAll('#fotos .foto').length`)) === 3, 'se agregan tres fotos');
    ok(!(await visible('#btn-foto')), 'con tres fotos el botón de agregar desaparece (tope de 3)');
    await p.ev(`document.querySelector('#fotos button[data-quitar="2"]').click()`);
    ok((await p.ev(`document.querySelectorAll('#fotos .foto').length`)) === 2 && (await visible('#btn-foto')), 'quitar una foto la libera');
    await clic('#btn-ubicacion');
    await espera(10500);
    ok(/ubicaci/i.test(await texto('#estado-ubicacion')) && !/Buscando/i.test(await texto('#estado-ubicacion')), 'la ubicación no se queda colgada: o se guarda o dice que no se pudo, y no bloquea', await texto('#estado-ubicacion'));
    await clic('#btn-siguiente');
    ok((await pasoActivo()) === 3, 'pasa al paso 3 sin ubicación (es opcional)');
    await clic('#btn-siguiente');
    ok((await pasoActivo()) === 3 && /barrio|vereda/i.test(await texto('#aviso')), 'sin barrio o vereda no avanza', await texto('#aviso'));
    await escribir('#f-barrio', 'Vereda La Esperanza');
    await clic('#btn-siguiente');
    ok((await pasoActivo()) === 4, 'con barrio pasa al paso 4');
    await clic('#f-autoriza');
    await clic('#btn-siguiente');
    ok((await pasoActivo()) === 4 && /nombre o su tel/i.test(await texto('#aviso')), 'si autoriza, pide nombre o teléfono', await texto('#aviso'));
    await escribir('#f-nombre', 'Persona Ejemplo');
    await escribir('#f-telefono', '12345');
    await clic('#btn-siguiente');
    ok((await pasoActivo()) === 4 && /celular de 10/i.test(await texto('#aviso')), 'un teléfono mal escrito no pasa', await texto('#aviso'));
    // Desmarca: sin autorización, el nombre y el teléfono escritos NO deben viajar.
    await clic('#f-autoriza');

    /* =============================================================================================== 2. sin señal */
    console.log('\n[2] Sin señal: queda en el celular, con sus fotos como Blob');
    await sinSenal(true);
    await clic('#btn-siguiente');
    await espera(2500);
    ok(await visible('#hecho'), 'la pantalla de «hecho» aparece', { aviso: await texto('#aviso'), js: p.avisos });
    ok(/Guardada en tu celular/i.test(await texto('#hecho-titulo')), 'dice «Guardada en tu celular»', await texto('#hecho-titulo'));
    const c1 = await cola();
    ok(c1.length === 1 && c1[0].fotos === 2 && c1[0].sonBlob, 'en la cola hay una solicitud con 2 fotos como Blob', c1);
    ok(c1[0].usuarioId === String(ana) || c1[0].usuarioId === ana, 'la cola lleva el dueño (Ana)', c1[0].usuarioId);
    ok(c1[0].autoriza === 0 && !c1[0].nombre && !c1[0].telefono, 'sin la casilla marcada, el nombre y el teléfono escritos NO se guardan en la cola', c1[0]);
    ok((await q('SELECT COUNT(*) c FROM solicitudes'))[0].c === 0, 'en el servidor todavía no hay nada');
    const uuidAna = c1[0].uuid;

    /* =============================================================================================== 3. otra cuenta en el mismo celular */
    console.log('\n[3] Otra cuenta en el mismo celular no ve ni sube lo de Ana');
    await sinSenal(false);
    await entrarComo(beto);
    await ir('/app/mis-solicitudes.html', 3500);
    ok(!(await visible('#bloque-pendientes')), 'Beto no ve la cola de Ana');
    ok((await q('SELECT COUNT(*) c FROM solicitudes'))[0].c === 0, 'y su sesión NO la subió');
    ok((await cola()).length === 1, 'la solicitud de Ana sigue guardada (no se borró al cambiar de cuenta)');

    /* =============================================================================================== 4. vuelve la señal */
    console.log('\n[4] Vuelve la señal: la dueña la sube sola');
    await entrarComo(ana);
    await ir('/app/mis-solicitudes.html', 4500);
    const filas = await q('SELECT id, cliente_uuid, estado, barrio_texto, ciudadano_nombre, ciudadano_telefono, autoriza_datos, registrado_por, latitud FROM solicitudes');
    ok(filas.length === 1 && filas[0].cliente_uuid === uuidAna, 'al volver la señal se subió UNA solicitud', filas);
    ok(filas[0] && Number(filas[0].registrado_por) === ana && filas[0].estado === 'registrada' && filas[0].barrio_texto === 'Vereda La Esperanza', 'es de Ana, registrada, en la vereda escrita', filas[0]);
    ok(filas[0] && filas[0].ciudadano_nombre === null && filas[0].ciudadano_telefono === null && Number(filas[0].autoriza_datos) === 0, 'sin autorización: sin nombre ni teléfono en la base', filas[0]);
    ok((await cola()).length === 0, 'la cola quedó vacía');
    ok(!(await visible('#bloque-pendientes')), 'y «Mis solicitudes» ya no muestra «sin subir»');
    ok(/Salud/.test(await texto('#lista-servidor')) && /Vereda La Esperanza/.test(await texto('#lista-servidor')), 'aparece en «Registradas»', (await texto('#lista-servidor') || '').slice(0, 120));
    const fs_ = await q('SELECT archivo, ancho, alto, bytes FROM solicitud_fotos WHERE solicitud_id = ? ORDER BY orden', [filas[0].id]);
    fs_.forEach((f) => archivosCreados.push(f.archivo));
    ok(fs_.length === 2, 'subió las 2 fotos', fs_);
    let limpias = fs_.length > 0;
    for (const f of fs_) {
      const ruta = S.rutaDeFoto(f.archivo);
      const buf = ruta && fs.existsSync(ruta) ? fs.readFileSync(ruta) : null;
      const meta = buf ? await sharp(buf).metadata() : null;
      if (!buf || meta.exif || buf.includes('secreto-gps') || Math.max(meta.width, meta.height) > 1280) limpias = false;
    }
    ok(limpias, 'las fotos guardadas miden como mucho 1.280 px y no traen metadatos (EXIF)');

    /* =============================================================================================== 5. idempotencia y autorización */
    console.log('\n[5] El mismo envío dos veces no duplica; con autorización sí viaja el nombre');
    await ir('/app/solicitud-nueva.html');
    await p.ev(`[...document.querySelectorAll('#categorias button')].find((b) => /v[ií]as/i.test(b.textContent)).click()`);
    await escribir('#f-descripcion', 'Hay un hueco muy grande frente a la escuela y los niños pasan por ahí.');
    await clic('#btn-siguiente'); await clic('#btn-siguiente');
    await escribir('#f-barrio', 'Barrio Los Ejemplos');
    await clic('#btn-siguiente');
    await clic('#f-autoriza');
    await escribir('#f-nombre', 'Persona Autorizada');
    await escribir('#f-telefono', '300 123 4567');
    await clic('#btn-siguiente');
    await espera(2500);
    ok(/Solicitud registrada/i.test(await texto('#hecho-titulo')), 'con señal queda «Solicitud registrada» de una vez', await texto('#hecho-titulo'));
    const f2 = await q('SELECT id, cliente_uuid, ciudadano_nombre, ciudadano_telefono, autoriza_datos, politica_version FROM solicitudes WHERE barrio_texto = ?', ['Barrio Los Ejemplos']);
    ok(f2.length === 1 && f2[0].ciudadano_nombre === 'Persona Autorizada' && f2[0].ciudadano_telefono === '3001234567' && Number(f2[0].autoriza_datos) === 1, 'con la casilla marcada se guarda el nombre y el teléfono normalizado', f2);
    ok(f2[0] && /^[0-9a-f]{16}$/.test(f2[0].politica_version || ''), 'queda la versión de la política que se aceptó', f2[0] && f2[0].politica_version);
    // Reenvío del MISMO identificador (como si la respuesta se hubiera perdido y el celular reintentara).
    const antes = (await q('SELECT COUNT(*) c FROM solicitudes'))[0].c;
    const reenvio = await p.ev(`(async () => {
      const fd = new FormData();
      fd.append('cliente_uuid', ${JSON.stringify(f2[0].cliente_uuid)}); fd.append('categoria_id', '1'); fd.append('descripcion', 'Hay un hueco muy grande frente a la escuela y los niños pasan por ahí.'); fd.append('barrio_texto', 'Barrio Los Ejemplos');
      try { const r = await api('/solicitudes', { method: 'POST', body: fd }); return { ok: true, duplicado: !!(r && r.duplicado) }; } catch (e) { return { ok: false, error: e.message }; }
    })()`);
    ok(reenvio.ok && (await q('SELECT COUNT(*) c FROM solicitudes'))[0].c === antes, 'reenviar el mismo identificador no crea otra', reenvio);

    /* =============================================================================================== 6. el escritorio, de humo */
    console.log('\n[6] El escritorio: la lista, el detalle y el teléfono del ciudadano');
    n++;
    const [ra] = await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES ('Admin Ejemplo', ?, ?, ?, (SELECT id FROM roles WHERE nombre = 'admin'), 1)`, [`9400000${n}`, `u9400000${n}`, bcrypt.hashSync('clave-ejemplo', 4)]);
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await entrarComo(ra.insertId);
    p.avisos.length = 0;
    await ir('/solicitudes.html', 3000);
    const nFilas = await p.ev(`document.querySelectorAll('#sol-filas tr[data-id]').length`);
    ok(nFilas === 2, 'el administrador ve las dos solicitudes en la lista', { nFilas, info: await texto('#p-info') });
    ok(!/3001234567|300 123|Persona Autorizada/.test(await texto('#sol-filas') || ''), 'la lista NO trae ni el nombre ni el teléfono');
    await p.ev(`document.querySelectorAll('#sol-filas tr[data-id]')[0].click()`);
    await espera(1500);
    const det1 = await texto('#sol-detalle');
    ok(/Persona Autorizada/.test(det1 || '') && /300\s?123\s?4567|3001234567/.test(det1 || ''), 'el detalle muestra al administrador el nombre y el teléfono de quien lo autorizó', (det1 || '').slice(0, 200));
    await p.ev(`document.querySelectorAll('#sol-filas tr[data-id]')[1].click()`);
    await espera(2500);
    const imgs = await p.ev(`[...document.querySelectorAll('#sol-detalle img')].map((i) => ({ src: i.getAttribute('src'), ancho: i.naturalWidth }))`);
    ok(imgs.length === 2 && imgs.every((i) => /^\/api\/solicitudes\/\d+\/fotos\/\d+$/.test(i.src) && i.ancho > 0), 'las dos fotos se ven y salen por la ruta protegida, no por /uploads', imgs);
    ok(!/Persona/.test(await texto('#sol-detalle') || ''), 'la anónima no muestra datos de ciudadano');
    ok(p.avisos.length === 0, 'sin errores de JavaScript en el escritorio', p.avisos);

    /* =============================================================================================== 7. panel y mapa (parche 304) */
    console.log('\n[7] El escritorio: pestañas Panel y Mapa');
    ok(await p.ev(`document.getElementById('f-categoria').value`) === '' && await p.ev(`document.getElementById('f-estado').value`) === '', 'los filtros de la lista siguen en «Todas» y «Todos» después de cargar');
    await q('UPDATE solicitudes SET latitud = 5.0711, longitud = -75.5120 WHERE id = (SELECT m FROM (SELECT MIN(id) m FROM solicitudes) x)');
    await clic('.sol-pestanas .pestana[data-vista="panel"]');
    await espera(1500);
    ok(await visible('#vista-panel') && !(await visible('#vista-lista')), 'la pestaña Panel muestra el panel y esconde la lista');
    ok(/2/.test(await texto('#pn-cifras') || '') && /En total/.test(await texto('#pn-cifras') || ''), 'el panel cuenta las 2 solicitudes', (await texto('#pn-cifras') || '').slice(0, 160));
    ok((await p.ev(`document.querySelectorAll('#pn-cat tbody tr').length`)) >= 1 && (await p.ev(`document.querySelectorAll('#pn-zona tbody tr').length`)) >= 1, 'y las tablas por categoría y por barrio tienen filas');
    ok(await visible('#d-diagnostico') && await visible('#d-detalle'), 'el administrador ve los dos botones de descarga (diagnóstico y detalle)');
    ok(/^\/api\/solicitudes\/exportar\/diagnostico/.test(await p.ev(`document.getElementById('d-diagnostico').getAttribute('href')`)), 'el botón apunta a la ruta del diagnóstico');
    await clic('.sol-pestanas .pestana[data-vista="mapa"]');
    await espera(4500);
    ok(await visible('#vista-mapa') && (await p.ev(`!!document.querySelector('#mapa-sol.leaflet-container')`)), 'la pestaña Mapa carga Leaflet y pinta el mapa');
    ok((await p.ev(`document.querySelectorAll('#mapa-sol path.leaflet-interactive').length`)) === 1, 'hay UN círculo (la solicitud con ubicación)');
    await p.ev(`document.querySelector('#mapa-sol path.leaflet-interactive').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    await espera(600);
    const popup = await texto('.leaflet-popup-content') || '';
    ok(/1 solicitud\(es\) en esta zona/.test(popup) && !/Persona|3001234567|Ejemplo|foto/i.test(popup), 'al tocar el círculo solo dice cuántas hay y de qué categoría: ningún nombre, teléfono ni foto', popup);
    ok(/1 de 2 solicitud\(es\) tienen ubicación/.test(await texto('#mp-nota') || ''), 'y la nota dice cuántas tienen ubicación', await texto('#mp-nota'));
    await clic('.sol-pestanas .pestana[data-vista="lista"]');
    await espera(300);
    ok(await visible('#vista-lista') && !(await visible('#vista-mapa')), 'volver a Lista la muestra');
    ok(p.avisos.length === 0, 'sin errores de JavaScript en el panel ni en el mapa', p.avisos);
  } catch (err) {
    fallos++;
    console.log('  FALLA la prueba se interrumpió: ' + (err && err.stack || err));
  } finally {
    try { for (const f of await q('SELECT archivo FROM solicitud_fotos')) archivosCreados.push(f.archivo); } catch (_) { /* sin base */ }
    archivosCreados.forEach((a) => { try { const r = S.rutaDeFoto(a); if (r) fs.unlinkSync(r); } catch (_) { /* ya no está */ } });
    if (navegador) navegador.cerrar();
    if (servidor) servidor.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    await pool.end().catch(() => {});
  }
  console.log(fallos ? `\n${fallos} comprobación(es) FALLARON.` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})();
