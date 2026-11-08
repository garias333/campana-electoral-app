#!/usr/bin/env node
// scripts/probar-tareas-celular.js
//
// Prueba, en un Chromium REAL, de las TAREAS (parche 305): «Mis tareas» en el celular, la cola sin señal y el escritorio.
//   · «Mis tareas»: la lista, los grupos, las etiquetas (vencida, vence hoy) y las cifras;
//   · empecé, no pude (con motivo) y terminé, con la evidencia que pide cada tipo (visita: foto o ubicación; entrega: cantidad y foto);
//   · SIN SEÑAL: lo que se termina queda en el cajón `tareas_pendientes` con sus fotos como Blob y su dueño; la pantalla lo dice;
//   · otra cuenta en el mismo celular no ve ni sube lo de la primera; al volver la dueña con señal, sube sola, UNA vez, con fotos sin EXIF;
//   · la ubicación nunca bloquea (aquí el navegador no la da y la tarea se termina igual);
//   · el escritorio: la lista, crear y asignar, ver la foto por la ruta protegida y verificar;
//   · la tarjeta «mis tareas» en el panel del celular.
//
// USO (sobre una base desechable ya inicializada con init-db; hace falta Chromium, ver scripts/capturas/navegador.js):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada305c node scripts/probar-tareas-celular.js
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
const T = require('../lib/tareas');
const Avisos = require('../lib/tareasAvisos');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }

let n = 0;
async function persona(nombre, rol, cargo, supervisor) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, `9700000${n}`, `u9700000${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  if (cargo) await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, ?, 1)', [r.insertId, cargo, supervisor || null]);
  return r.insertId;
}
async function tarea(o) {
  const [r] = await pool.query(
    `INSERT INTO tareas (tipo, titulo, descripcion, estado, zona_texto, fecha_limite, cantidad_prevista, creada_por, asignada_a) VALUES (?,?,?,?,?,?,?,?,?)`,
    [o.tipo, o.titulo, o.descripcion || null, o.estado || 'pendiente', o.zona || null, o.fecha || null, o.cantidad || null, o.creador, o.para]);
  await pool.query(`INSERT INTO tarea_historial (tarea_id, tipo, estado_despues, asignada_despues, usuario_id) VALUES (?, 'creada', 'pendiente', ?, ?)`, [r.insertId, o.para, o.creador]);
  return r.insertId;
}

(async () => {
  let servidor; let navegador;
  // Las fotos de prueba van en una carpeta NO oculta del hogar: el Chromium de snap no puede leer archivos de carpetas ocultas.
  const tmp = fs.mkdtempSync(path.join(os.homedir(), 'tar-cel-'));
  try {
    await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
    for (const [rol, v, e, a] of [['sublider', 1, 0, 0], ['lider', 1, 1, 1]]) {
      await q(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES (?, 'tareas', ?, ?, ?) ON DUPLICATE KEY UPDATE permitido = VALUES(permitido), editar = VALUES(editar), agregar = VALUES(agregar)`, [rol, v, e, a]);
    }
    const admin = await persona('Admin Ejemplo', 'admin');
    const jefa = await persona('Lider Ejemplo', 'lider', 'lider');
    const ana = await persona('Ana Ejemplo', 'sublider', 'usuario', jefa);
    const beto = await persona('Beto Ejemplo', 'sublider', 'usuario', jefa);
    console.log('TAREAS, EN EL CELULAR Y EN EL ESCRITORIO — base «' + nombreBase + '»\n');
    const hoy = (await q(`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') f`))[0].f;
    const ayer = (await q(`SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '%Y-%m-%d') f`))[0].f;
    const tLibre = await tarea({ tipo: 'libre', titulo: 'Llevar la lista a la junta', descripcion: 'Pasar por la sede de la junta.', creador: jefa, para: ana });
    const tVisita = await tarea({ tipo: 'visita', titulo: 'Visitar el barrio La Esperanza', zona: 'La Esperanza', fecha: hoy, creador: jefa, para: ana });
    const tEntrega = await tarea({ tipo: 'entrega', titulo: 'Entregar los volantes', zona: 'La Esperanza', cantidad: 30, creador: jefa, para: ana });
    const tVencida = await tarea({ tipo: 'libre', titulo: 'Confirmar la reunión', fecha: ayer, creador: jefa, para: ana });
    await tarea({ tipo: 'libre', titulo: 'Tarea de Beto', creador: jefa, para: beto });

    // Fotos de prueba grandes y CON metadatos.
    const fotos = [];
    for (let i = 0; i < 3; i++) {
      const f = path.join(tmp, `foto${i}.jpg`);
      await sharp({ create: { width: 2400, height: 1800, channels: 3, background: { r: 60 + i * 30, g: 120, b: 90 } } }).withExif({ IFD0: { Copyright: 'secreto-gps-' + i } }).jpeg().toFile(f);
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
    await p.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.confirm = () => true; window.__sinSenal = false;
      const f = window.fetch.bind(window); window.fetch = (...a) => (window.__sinSenal ? Promise.reject(new TypeError('Failed to fetch')) : f(...a));` });

    const sinSenal = (off) => p.ev(`window.__sinSenal = ${off ? 'true' : 'false'}`);
    const entrarComo = async (id) => { await p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(id), url: base }); };
    const ir = async (ruta, ms = 2200) => { await p.cmd('Page.navigate', { url: base + ruta }); await espera(ms); };
    const clic = (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
    const escribir = (sel, v) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);
    const texto = (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.trim() : null; })()`);
    const visible = (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && getComputedStyle(e).display !== 'none'; })()`);
    const abrirTarea = async (id) => { await p.ev(`document.querySelector('[data-abrir="${id}"]').click()`); await espera(400); };
    const accion = async (id, a) => { await p.ev(`document.querySelector('[data-accion="${a}"][data-id="${id}"]').click()`); await espera(500); };
    const subirFoto = async (ruta) => {
      const { result: doc } = await p.cmd('DOM.getDocument', { depth: 0 });
      const { result: nodo } = await p.cmd('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#archivo-foto' });
      await p.cmd('DOM.setFileInputFiles', { files: [ruta], nodeId: nodo.nodeId });
      await espera(900);
    };
    const cola = () => p.ev(`(async () => {
      const db = await abrirBaseOffline();
      const todo = await new Promise((ok, ko) => { const r = db.transaction('tareas_pendientes', 'readonly').objectStore('tareas_pendientes').getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
      return todo.map((r) => ({ uuid: r.clienteUuid, usuarioId: r.usuarioId, accion: r.accion, tareaId: r.tareaId, estado: r.estado || '', fotos: (r.fotos || []).length, sonBlob: (r.fotos || []).every((b) => b instanceof Blob) }));
    })()`);
    const estadoDe = async (id) => (await q('SELECT estado FROM tareas WHERE id = ?', [id]))[0].estado;

    /* =============================================================================================== 1. la lista */
    console.log('[1] «Mis tareas»: la lista y las cifras');
    await entrarComo(ana);
    await ir('/app/mis-tareas.html');
    const cajas = await p.ev(`document.querySelectorAll('.caja-tar[data-tarea]').length`);
    ok(cajas === 4, 'Ana ve sus 4 tareas (y no la de Beto)', cajas);
    const resumen = await texto('#resumen');
    ok(/4\s*Pendientes/i.test(resumen || '') && /1\s*Vencen hoy/i.test(resumen || '') && /1\s*Vencidas/i.test(resumen || ''), 'el resumen dice 4 pendientes, 1 vence hoy, 1 vencida', resumen);
    ok(/Vencida/.test(await texto(`[data-tarea="${tVencida}"]`) || '') && /Vence hoy/.test(await texto(`[data-tarea="${tVisita}"]`) || ''), 'cada una lleva su etiqueta (vencida, vence hoy)');
    ok(!/Tarea de Beto/.test(await texto('#lista-servidor') || ''), 'la de Beto no aparece');
    await abrirTarea(tLibre);
    ok(/Pasar por la sede/.test(await texto(`[data-tarea="${tLibre}"]`) || '') && await p.ev(`!!document.querySelector('[data-accion="termine"][data-id="${tLibre}"]')`), 'al tocar una se abre su detalle con los botones');

    /* =============================================================================================== 2. empecé y no pude */
    console.log('\n[2] Empecé y no pude');
    await accion(tLibre, 'empece');
    await espera(1200);
    ok(await estadoDe(tLibre) === 'en_curso', 'empecé: la tarea pasa a «en curso» en el servidor');
    ok(/En curso/.test(await texto(`[data-tarea="${tLibre}"]`) || ''), 'y la pantalla lo muestra');
    await abrirTarea(tVencida);
    await accion(tVencida, 'no_pude');
    await escribir('#f-nota', 'ab');
    await clic('#btn-guardar-nopude');
    await espera(400);
    ok(/Cuenta por qué/i.test(await texto('#aviso') || '') && await estadoDe(tVencida) === 'pendiente', '«no pude» pide el motivo y no manda nada sin él', await texto('#aviso'));
    await escribir('#f-nota', 'No contestaron el teléfono de la junta');
    await clic('#btn-guardar-nopude');
    await espera(1500);
    const fn = (await q('SELECT estado, no_pudo_nota FROM tareas WHERE id = ?', [tVencida]))[0];
    ok(fn.estado === 'pendiente' && fn.no_pudo_nota === 'No contestaron el teléfono de la junta' && /No pude/.test(await texto(`[data-tarea="${tVencida}"]`) || ''), '«no pude» con motivo: queda escrito y se ve marcado', fn);

    /* =============================================================================================== 3. la evidencia que pide cada tipo */
    console.log('\n[3] La evidencia de «terminé»');
    await abrirTarea(tVisita);
    await accion(tVisita, 'termine');
    await clic('#btn-guardar-termine');
    await espera(400);
    ok(/foto o con la ubicaci/i.test(await texto('#aviso') || '') && await estadoDe(tVisita) === 'pendiente', 'una VISITA sin foto ni ubicación no se envía', await texto('#aviso'));
    await clic('#btn-cancelar-form');
    await abrirTarea(tEntrega); await abrirTarea(tEntrega);
    await abrirTarea(tEntrega);
    await accion(tEntrega, 'termine');
    await clic('#btn-guardar-termine');
    await espera(300);
    ok(/cantidad/i.test(await texto('#aviso') || ''), 'una ENTREGA sin cantidad no se envía', await texto('#aviso'));
    await escribir('#f-cantidad', '25');
    await clic('#btn-guardar-termine');
    await espera(300);
    ok(/foto/i.test(await texto('#aviso') || ''), 'con la cantidad pero sin foto, tampoco', await texto('#aviso'));
    ok(await estadoDe(tEntrega) === 'pendiente', 'y en el servidor no cambió nada');
    await clic('#btn-cancelar-form');

    /* =============================================================================================== 4. sin señal */
    console.log('\n[4] Sin señal: queda en el celular, con sus fotos como Blob');
    await sinSenal(true);
    await abrirTarea(tVisita);
    await accion(tVisita, 'termine');
    await subirFoto(fotos[0]);
    ok((await p.ev(`document.querySelectorAll('#fotos-tar .foto').length`)) === 1, 'se agrega una foto');
    await clic('#btn-ubicacion');
    await espera(10500);
    ok(/ubicaci/i.test(await texto('#estado-ubicacion') || '') && !/Buscando/i.test(await texto('#estado-ubicacion') || ''), 'la ubicación no se queda colgada: o se guarda o dice que no se pudo, y no bloquea', await texto('#estado-ubicacion'));
    await escribir('#f-nota', 'Se visitó la sede');
    await clic('#btn-guardar-termine');
    await espera(1500);
    const c1 = await cola();
    ok(c1.length === 1 && c1[0].accion === 'termine' && c1[0].tareaId === tVisita && c1[0].fotos === 1 && c1[0].sonBlob, 'en la cola hay un «terminé» con 1 foto como Blob', c1);
    ok(String(c1[0].usuarioId) === String(ana), 'la cola lleva el dueño (Ana)', c1[0] && c1[0].usuarioId);
    ok(/Esperando señal/.test(await texto('#lista-pendientes') || '') && /Guardado en tu celular/i.test(await texto('#aviso') || ''), 'la pantalla dice «Esperando señal» y «Guardado en tu celular»', await texto('#aviso'));
    ok(await estadoDe(tVisita) === 'pendiente', 'en el servidor todavía no hay nada');
    ok(!(await p.ev(`!!document.querySelector('[data-accion="termine"][data-id="${tVisita}"]')`)), 'y esa tarea no ofrece botones mientras tiene un cambio sin subir');
    const uuidAna = c1[0].uuid;

    /* =============================================================================================== 5. otra cuenta */
    console.log('\n[5] Otra cuenta en el mismo celular no ve ni sube lo de Ana');
    await sinSenal(false);
    await entrarComo(beto);
    await ir('/app/mis-tareas.html', 3500);
    ok(!(await visible('#bloque-pendientes')), 'Beto no ve la cola de Ana');
    ok(await estadoDe(tVisita) === 'pendiente', 'y su sesión NO la subió');
    ok((await cola()).length === 1, 'la tarea de Ana sigue guardada (no se borró al cambiar de cuenta)');

    /* =============================================================================================== 6. vuelve la señal */
    console.log('\n[6] Vuelve la señal: la dueña la sube sola, una vez');
    await entrarComo(ana);
    await ir('/app/mis-tareas.html', 4500);
    const fila = (await q('SELECT estado, hecha_nota, latitud FROM tareas WHERE id = ?', [tVisita]))[0];
    ok(fila.estado === 'hecha' && fila.hecha_nota === 'Se visitó la sede', 'al volver la señal la visita quedó «hecha», con su nota', fila);
    const hist = await q(`SELECT cliente_uuid FROM tarea_historial WHERE tarea_id = ? AND tipo = 'hecha'`, [tVisita]);
    ok(hist.length === 1 && hist[0].cliente_uuid === uuidAna, 'UNA sola vez, con el identificador que nació en el celular', hist);
    ok((await cola()).length === 0 && !(await visible('#bloque-pendientes')), 'la cola quedó vacía y la pantalla ya no dice «sin subir»');
    const fs_ = await q('SELECT archivo FROM tarea_fotos WHERE tarea_id = ? ORDER BY orden', [tVisita]);
    ok(fs_.length === 1, 'subió su foto');
    let limpias = fs_.length > 0;
    for (const f of fs_) {
      const ruta = T.rutaDeFoto(f.archivo);
      const buf = ruta && fs.existsSync(ruta) ? fs.readFileSync(ruta) : null;
      const meta = buf ? await sharp(buf).metadata() : null;
      if (!buf || meta.exif || buf.includes('secreto-gps') || Math.max(meta.width, meta.height) > 1280) limpias = false;
    }
    ok(limpias, 'la foto guardada mide como mucho 1.280 px y no trae metadatos (EXIF)');
    ok(fila.latitud === null, 'sin permiso de ubicación, la tarea se terminó igual y sin coordenadas');
    ok(/Esperando verificaci/i.test(await texto('#lista-servidor') || ''), '«Mis tareas» la pasa al grupo «Esperando verificación»');

    /* =============================================================================================== 7. la entrega, con señal */
    console.log('\n[7] La entrega, con señal');
    await abrirTarea(tEntrega);
    await accion(tEntrega, 'termine');
    await escribir('#f-cantidad', '28');
    await subirFoto(fotos[1]); await subirFoto(fotos[2]);
    await clic('#btn-guardar-termine');
    await espera(2500);
    const fe = (await q('SELECT estado, cantidad_entregada FROM tareas WHERE id = ?', [tEntrega]))[0];
    ok(fe.estado === 'hecha' && fe.cantidad_entregada === 28 && (await q('SELECT COUNT(*) c FROM tarea_fotos WHERE tarea_id = ?', [tEntrega]))[0].c === 2, 'con señal queda hecha de una vez, con la cantidad y 2 fotos', fe);

    /* =============================================================================================== 8. la tarjeta del panel */
    console.log('\n[8] La tarjeta «mis tareas» en el panel del celular');
    await ir('/app/inicio.html', 2500);
    // El panel se arma con una llamada a la API: se espera hasta 12 s a que aparezca (con la máquina ocupada tarda más).
    for (let i = 0; i < 24 && !(await texto('#pl-tareas')); i++) await espera(500);
    const tarjeta = await texto('#pl-tareas');
    ok(tarjeta && /Mis tareas/.test(tarjeta) && /2\s*pendientes/i.test(tarjeta) && /1\s*vencidas/i.test(tarjeta), 'el panel muestra cuántas tiene pendientes y vencidas', tarjeta);
    ok(!/Llevar la lista|Confirmar la reuni|Visitar el barrio/.test(tarjeta || ''), 'solo cifras: ningún título');
    ok(!!(await p.ev(`[...document.querySelectorAll('a')].some((a) => /mis-tareas\\.html/.test(a.getAttribute('href') || ''))`)), 'y hay una entrada «Mis tareas» en el menú / un enlace a la pantalla');

    /* =============================================================================================== 9. el escritorio */
    console.log('\n[9] El escritorio: la lista, la foto protegida, verificar y crear');
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    // Para que el aviso al asignar no intente un push real.
    Avisos.deps.enviarPush = async () => {};
    await entrarComo(admin);
    p.avisos.length = 0;
    await ir('/tareas.html', 3000);
    const filas = await p.ev(`document.querySelectorAll('#tar-filas tr[data-id]').length`);
    ok(filas === 5, 'el administrador ve las 5 tareas de la campaña', { filas, info: await texto('#p-info') });
    ok(/Por verificar/.test(await texto('#tar-resumen') || ''), 'el resumen cuenta las que están por verificar');
    await p.ev(`document.querySelector('#tar-filas tr[data-id="${tEntrega}"]').click()`);
    await espera(2500);
    const imgs = await p.ev(`[...document.querySelectorAll('#tar-detalle img')].map((i) => ({ src: i.getAttribute('src'), ancho: i.naturalWidth }))`);
    ok(imgs.length === 2 && imgs.every((i) => /^\/api\/tareas\/\d+\/fotos\/\d+$/.test(i.src) && i.ancho > 0), 'las dos fotos se ven y salen por la ruta protegida, no por /uploads', imgs);
    ok(/28 entregadas/.test(await texto('#tar-detalle') || ''), 'el detalle muestra la cantidad entregada');
    await clic('#a-verificar');
    await espera(1500);
    ok(await estadoDe(tEntrega) === 'verificada', 'Verificar la deja verificada', await estadoDe(tEntrega));
    // Devolver la visita pidiendo lo que falta.
    await p.ev(`document.querySelector('#tar-filas tr[data-id="${tVisita}"]').click()`);
    await espera(1500);
    await escribir('#a-devolver-nota', 'Falta la foto de la fachada');
    await clic('#a-devolver');
    await espera(1500);
    const fd = (await q('SELECT estado, devuelta_nota FROM tareas WHERE id = ?', [tVisita]))[0];
    ok(fd.estado === 'en_curso' && fd.devuelta_nota === 'Falta la foto de la fachada', 'Devolver la deja en curso con lo que falta', fd);
    // Crear y asignar.
    await clic('#btn-nueva');
    await espera(500);
    await p.ev(`document.getElementById('n-tipo').value = 'visita'; document.getElementById('n-tipo').dispatchEvent(new Event('change', {bubbles:true}))`);
    await escribir('#n-titulo', 'Visitar la vereda El Retiro');
    await escribir('#n-asignada', String(jefa));
    await clic('#n-guardar');
    await espera(800);
    ok(/barrio o la vereda/i.test(await texto('#n-msg') || ''), 'una visita sin zona se rechaza en el formulario', await texto('#n-msg'));
    await escribir('#n-zona', 'Vereda El Retiro');
    await escribir('#n-fecha', hoy);
    await clic('#n-guardar');
    await espera(2000);
    const nueva = (await q(`SELECT id, tipo, zona_texto, asignada_a, creada_por, estado FROM tareas WHERE titulo = 'Visitar la vereda El Retiro'`))[0];
    ok(nueva && nueva.tipo === 'visita' && nueva.zona_texto === 'Vereda El Retiro' && nueva.asignada_a === jefa && nueva.creada_por === admin && nueva.estado === 'pendiente', 'se crea y se asigna desde el escritorio', nueva);
    ok(/Tarea n\.º/.test(await texto('#tar-detalle') || ''), 'y se abre su detalle');
    ok(p.avisos.length === 0, 'sin errores de JavaScript en el escritorio', p.avisos);
  } catch (err) {
    fallos++;
    console.log('  FALLA la prueba se interrumpió: ' + (err && err.stack || err));
  } finally {
    try { for (const f of await q('SELECT archivo FROM tarea_fotos')) { const r = T.rutaDeFoto(f.archivo); if (r) fs.unlinkSync(r); } } catch (_) { /* ya no está */ }
    if (navegador) navegador.cerrar();
    if (servidor) servidor.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    await pool.end().catch(() => {});
  }
  console.log(fallos ? `\n${fallos} comprobación(es) FALLARON.` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})();
