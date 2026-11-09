#!/usr/bin/env node
// scripts/probar-encuestas-celular.js
//
// Prueba, en un Chromium REAL, de las ENCUESTAS INTERNAS (parche 307): el celular, la cola sin señal y el constructor del escritorio.
//   · «Encuestas»: la lista de las publicadas, la marca «Uso interno – no publicable», la copia de la lista en el celular (con dueño);
//   · aplicar una encuesta con señal: la zona obligatoria (con la lista de los CUATRO tipos), lo obligatorio, los límites del número, el texto libre
//     (siete dígitos), «No sabe / No responde», la ubicación como CELDA, y lo que queda en la base;
//   · SIN SEÑAL: queda en el cajón `encuestas_pendientes` con su dueño y SIN latitud ni longitud; otra cuenta del mismo celular no la ve ni la sube;
//     al volver la dueña con señal, sube sola, UNA vez;
//   · UN RECHAZO DEL SERVIDOR NO SE BORRA: queda «fallido», visible, con su motivo y con Reintentar y Descartar;
//   · el día de la elección: la lista dice por qué no hay encuestas (del servidor y, sin señal, con la fecha guardada en el celular);
//   · Solicitudes: la lista de zonas con la misma degradación (comunas y corregimientos, no solo barrios y veredas) y un rechazo que no se borra;
//   · el constructor del escritorio: crear, la palabra que impide publicar, sensible ⇒ no obligatoria, publicar (queda congelada), duplicar;
//   · (parche 308) las COLAS: `sincronizarCola` no borra ante un 401 (undefined) ni ante un error de red ni ante 429/503; `api()` pone `error.status`;
//     «Mis tareas» deja lo rechazado «fallido» con Reintentar y Descartar; y «Mis tareas» / «Mis solicitudes» dicen que no hay permiso ante un 403;
//   · (parche 308) la pantalla de resultados del escritorio: tablas, cobertura, Excel solo con la casilla, Calidad y Textos libres solo del administrador, cuotas.
//
// USO (sobre una base desechable ya inicializada con init-db; hace falta Chromium, ver scripts/capturas/navegador.js):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada307 node scripts/probar-encuestas-celular.js
//
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». No abrir otra prueba con Chromium a la vez (comparten el perfil).

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) {
  console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`);
  process.exit(2);
}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';

const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { lanzar, espera } = require('./capturas/navegador');
const { crear } = require('./capturas/servidor');
const E = require('../lib/encuestas');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }

let n = 0;
const sello = String(Date.now()).slice(-7);
async function persona(nombre, rol, cargo, supervisor) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, `97${sello}${n}`, `u97${sello}${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  if (cargo) await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, ?, 1)', [r.insertId, cargo, supervisor || null]);
  return r.insertId;
}
const fechaSql = async (expr) => (await q(`SELECT DATE_FORMAT(${expr}, '%Y-%m-%d') f`))[0].f;
async function config(c) {
  const sets = Object.keys(c).map((k) => `${k} = ?`).join(', ');
  await q(`UPDATE configuracion_campana SET ${sets} WHERE id = 1`, Object.values(c));
}

(async () => {
  let servidor; let navegador;
  try {
    await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
    await config({ fecha_permitida_propaganda: null, fecha_eleccion: null, nombre_candidato: null });
    await q(`DELETE FROM permisos_rol WHERE modulo IN ('encuestas','encuestas_campo') AND rol <> 'admin'`);
    // Pizarra limpia (es una base desechable: el nombre se comprobó arriba): las cifras de esta prueba se cuentan desde cero.
    for (const t of ['encuesta_respuesta_items', 'encuesta_respuestas', 'encuesta_preguntas', 'encuestas', 'solicitudes']) await q(`DELETE FROM ${t}`);
    await q(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES ('lider', 'encuestas_campo', 1, 0, 1) ON DUPLICATE KEY UPDATE permitido = 1, editar = 0, agregar = 1`);
    await q(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES ('lider', 'solicitudes', 1, 0, 1) ON DUPLICATE KEY UPDATE permitido = 1, editar = 0, agregar = 1`);
    await q(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES ('lider', 'tareas', 1, 0, 0) ON DUPLICATE KEY UPDATE permitido = 1, editar = 0, agregar = 0`);
    await q(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar, importar_exportar) VALUES ('coordinador', 'encuestas', 1, 0, 0, 0) ON DUPLICATE KEY UPDATE permitido = 1, editar = 0, agregar = 0, importar_exportar = 0`);
    const admin = 1;
    const jefa = await persona('Coordinadora Ejemplo', 'coordinador', 'coordinador');
    const ana = await persona('Ana Lider Ejemplo', 'lider', 'lider', jefa);
    const beto = await persona('Beto Lider Ejemplo', 'lider', 'lider', jefa);
    await q('DELETE FROM territorios');
    await q(`INSERT INTO territorios (id, tipo, nombre, padre_id) VALUES (9101, 'municipio', 'Municipio Ejemplo', NULL), (9102, 'comuna', 'Comuna Centro', 9101),
             (9103, 'barrio', 'El Carmen', 9102), (9104, 'vereda', 'La Cabaña', 9101), (9105, 'corregimiento', 'Corregimiento Alto', 9101)`);
    console.log('ENCUESTAS, EN EL CELULAR Y EN EL ESCRITORIO — base «' + nombreBase + '»\n');

    // Dos encuestas publicadas, por la misma lógica que usa el constructor.
    const publicar = async (cuerpo) => {
      const { datos } = E.normalizarBorrador(cuerpo);
      const id = await E.guardarBorrador(null, datos, { id: admin });
      await E.publicar(id, { id: admin });
      return E.detalle(id);
    };
    const ez = await publicar({ titulo: 'Necesidades del barrio', descripcion: 'Preguntas cortas para conocer el barrio', pide_ubicacion: 1, preguntas: [
      { tipo: 'unica', enunciado: '¿Cuál es el principal problema del barrio?', obligatoria: true, opciones: ['Vías', 'Agua', 'Seguridad'] },
      { tipo: 'multiple', enunciado: '¿Qué servicios usa?', opciones: ['Transporte', 'Salud', 'Colegio'] },
      { tipo: 'escala', enunciado: '¿Qué tan satisfecho está con la limpieza? (1 = nada, 5 = mucho)' },
      { tipo: 'numero', enunciado: '¿Cuántas personas viven en la casa?', num_min: 1, num_max: 30 },
      { tipo: 'texto', enunciado: '¿Qué mejoraría primero?' },
    ] });
    const respuestasDe = async () => q('SELECT * FROM encuesta_respuestas ORDER BY id');

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
    const clic = async (sel) => { const r = await p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`); await espera(250); return r; };
    const escribir = async (sel, v) => { await p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`); await espera(120); };
    const texto = (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.trim() : null; })()`);
    const visible = (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && getComputedStyle(e).display !== 'none'; })()`);
    const cola = () => p.ev(`(async () => {
      const db = await abrirBaseOffline();
      const todo = await new Promise((ok, ko) => { const r = db.transaction('encuestas_pendientes', 'readonly').objectStore('encuestas_pendientes').getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
      return todo.map((r) => ({ uuid: r.clienteUuid, usuarioId: r.usuarioId, estado: r.estado || '', error: r.error || '', claves: Object.keys(r.payload || {}), payload: JSON.stringify(r.payload || {}) }));
    })()`);
    const copias = () => p.ev(`(async () => {
      const db = await abrirBaseOffline();
      const todo = await new Promise((ok, ko) => { const r = db.transaction('encuestas_cache', 'readonly').objectStore('encuestas_cache').getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
      return todo.map((r) => ({ usuarioId: r.usuarioId, clave: r.clave }));
    })()`);
    const empezar = async () => { await ir('/app/encuestas-campo.html', 2800); await clic(`[data-iniciar="${ez.id}"]`); await espera(2200); };
    // Responde la encuesta completa (la zona ya escrita). Deja la pantalla en el último paso, SIN guardar.
    const llenar = async (zona) => {
      await escribir('#f-zona', zona); await clic('#btn-siguiente');
      await clic('[data-opcion="o2"]'); await clic('#btn-siguiente');
      await clic('[data-multi="o1"]'); await clic('[data-multi="o3"]'); await clic('#btn-siguiente');
      await clic('[data-escala="4"]'); await clic('#btn-siguiente');
      await escribir('#f-valor', '5'); await clic('#btn-siguiente');
      await escribir('#f-texto', 'Arreglar la calle principal');
    };

    /* =============================================================================================== 1. la lista */
    console.log('[1] «Encuestas»: la lista y la copia en el celular');
    await entrarComo(ana);
    await ir('/app/encuestas-campo.html', 3000);
    ok((await p.ev(`document.querySelectorAll('[data-encuesta]').length`)) === 1 && /Necesidades del barrio/.test(await texto('[data-encuesta]') || ''), 'Ana ve la encuesta publicada');
    ok(/5 pregunta\(s\)/.test(await texto('[data-encuesta]') || '') && /ubicaci/i.test(await texto('[data-encuesta]') || ''), 'dice cuántas preguntas tiene y que puede usar la ubicación (opcional)');
    ok(/Uso interno – no publicable/.test(await texto('.uso-interno') || '') && /an[oó]nimas/i.test(await texto('.uso-interno') || ''), 'lleva la marca «Uso interno – no publicable» y recuerda que son anónimas');
    const cp = await copias();
    ok(cp.length === 1 && String(cp[0].usuarioId) === String(ana), 'la lista queda guardada en el celular, con el dueño (Ana)', cp);

    /* =============================================================================================== 2. aplicar con señal */
    console.log('\n[2] Aplicar con señal: zona, obligatorias, límites, texto libre, ubicación');
    await p.cmd('Browser.grantPermissions', { permissions: ['geolocation'], origin: base }).catch(() => {});
    await p.cmd('Emulation.setGeolocationOverride', { latitude: 5.0703, longitude: -75.5138, accuracy: 20 }).catch(() => {});
    await clic('[data-iniciar]');
    await espera(2200);
    ok((await p.ev(`document.querySelectorAll('#lista-zonas option').length`)) === 4, 'la lista de zonas trae los CUATRO tipos: comuna, barrio, vereda y corregimiento (no solo barrio y vereda)');
    ok(/Barrio, vereda o zona/.test(await texto('#etiqueta-zona') || ''), 'la etiqueta lo dice', await texto('#etiqueta-zona'));
    ok(await visible('#bloque-ubicacion'), 'la encuesta pide ubicación: aparece el botón (opcional)');
    await clic('#btn-siguiente');
    ok(/Elige la zona/i.test(await texto('#aviso') || '') && await visible('#paso-cero'), 'sin zona NO avanza', await texto('#aviso'));
    await escribir('#f-zona', 'Municipio Ejemplo'); await clic('#btn-siguiente');
    ok(/Elige la zona/i.test(await texto('#aviso') || ''), 'y el municipio no es una zona válida si hay barrios');
    await clic('#btn-ubicacion');
    await espera(1500);
    ok(/aproximada guardada/i.test(await texto('#estado-ubicacion') || ''), 'la ubicación se pide y dice que guardó una zona APROXIMADA, no el punto', await texto('#estado-ubicacion'));
    await escribir('#f-zona', 'El Carmen'); await clic('#btn-siguiente');
    ok(/Pregunta 1 de 5/.test(await texto('#progreso') || '') && /\*/.test(await texto('#paso-pregunta h2') || ''), 'con la zona avanza a la pregunta 1, marcada como obligatoria (*)');
    await clic('#btn-siguiente');
    ok(/obligatoria/i.test(await texto('#aviso') || '') && /Pregunta 1/.test(await texto('#progreso') || ''), 'una obligatoria sin responder no avanza', await texto('#aviso'));
    ok(/No sabe \/ No responde/.test(await texto('#paso-pregunta') || ''), 'trae «No sabe / No responde»');
    await clic('[data-opcion="o2"]'); await clic('#btn-siguiente');
    ok(/Pregunta 2 de 5/.test(await texto('#progreso') || ''), 'responde y pasa a la pregunta 2');
    await clic('#btn-siguiente');
    ok(/Pregunta 3 de 5/.test(await texto('#progreso') || ''), 'una pregunta NO obligatoria se puede dejar en blanco');
    await clic('#btn-atras');
    await clic('[data-multi="o1"]'); await clic('[data-multi="o3"]');
    ok((await p.ev(`document.querySelectorAll('#paso-pregunta button.elegida').length`)) === 2, 'la múltiple deja elegir varias');
    await clic('[data-nsnr]');
    ok((await p.ev(`document.querySelectorAll('#paso-pregunta button.elegida').length`)) === 1, '«No sabe / No responde» reemplaza a las demás');
    await clic('[data-multi="o1"]'); await clic('[data-multi="o3"]'); await clic('#btn-siguiente');
    await clic('[data-escala="4"]'); await clic('#btn-siguiente');
    await escribir('#f-valor', '31'); await clic('#btn-siguiente');
    ok(/máximo es 30/i.test(await texto('#aviso') || ''), 'un número sobre el máximo no avanza', await texto('#aviso'));
    await escribir('#f-valor', '5'); await clic('#btn-siguiente');
    ok(/Pregunta 5 de 5/.test(await texto('#progreso') || '') && /Guardar la encuesta/.test(await texto('#btn-siguiente') || ''), 'la última pregunta ofrece «Guardar la encuesta»');
    await escribir('#f-texto', 'Mi teléfono es 3001234567'); await clic('#btn-siguiente');
    ok(/siete o más dígitos/i.test(await texto('#aviso') || ''), 'el texto libre con un teléfono no se guarda', await texto('#aviso'));
    ok(/\d+ \/ 80/.test(await texto('#contador') || ''), 'y muestra el contador de 80 caracteres');
    await escribir('#f-texto', 'Arreglar la calle principal'); await clic('#btn-siguiente');
    await espera(2500);
    ok(/Encuesta registrada/.test(await texto('#hecho-titulo') || ''), 'con señal queda «Encuesta registrada»', await texto('#hecho-titulo'));
    const filas = await respuestasDe();
    ok(filas.length === 1 && filas[0].aplicada_por === ana && filas[0].territorio_id === 9103 && filas[0].zona_texto === 'El Carmen' && filas[0].huella === ez.huella, 'en la base: una respuesta de Ana, en El Carmen, de esa versión', filas[0]);
    const lat = Number(filas[0].celda_lat), lng = Number(filas[0].celda_lng);
    ok(Math.abs(lat - 5.0703) <= 0.0026 && Math.abs(lng + 75.5138) <= 0.0026 && Math.abs(lat - 5.0703) > 0.00001, 'la ubicación guardada es el CENTRO de la celda (a ±0,0025° de donde estaba), no la coordenada', [filas[0].celda_lat, filas[0].celda_lng]);
    const its = await q('SELECT pregunta_id, opcion_id, valor_num, valor_texto, nsnr FROM encuesta_respuesta_items WHERE respuesta_id = ? ORDER BY pregunta_id, opcion_id', [filas[0].id]);
    ok(its.length === 6 && its.some((i) => i.valor_texto === 'Arreglar la calle principal') && its.filter((i) => i.nsnr).length === 0, 'seis filas de respuestas, con el texto', its.length);
    ok(p.avisos.length === 0, 'sin errores de JavaScript', p.avisos);

    /* =============================================================================================== 3. sin señal */
    console.log('\n[3] Sin señal: queda en el celular, con su dueño y SIN coordenadas');
    await ir('/app/encuesta-aplicar.html', 2500);        // con señal se abre (la lista de zonas queda en la caché de referencia)...
    await sinSenal(true);                                // ...y se pierde la señal: ahora todo sale de la copia del celular
    ok(await visible('#formulario') && (await p.ev(`document.querySelectorAll('#lista-zonas option').length`)) === 4, 'sin señal la encuesta y la lista de zonas abren desde la copia del celular');
    await clic('#btn-ubicacion'); await espera(1200);
    await llenar('La Cabaña');
    await clic('#btn-siguiente');
    await espera(1500);
    const c1 = await cola();
    ok(/Guardada en tu celular/.test(await texto('#hecho-titulo') || ''), 'sin señal dice «Guardada en tu celular»', await texto('#hecho-titulo'));
    ok(c1.length === 1 && String(c1[0].usuarioId) === String(ana) && c1[0].estado === '', 'en la cola hay UNA respuesta, con el dueño (Ana)', c1);
    ok(c1[0].claves.includes('celda_ix') && !c1[0].claves.some((k) => /^(latitud|longitud|lat|lng|latitude|longitude)$/i.test(k)) && !/-?\d+\.\d{4,}/.test(c1[0].payload.replace(/"(respondida_en|iniciada_en)":"[^"]*"/g, '')), 'y lo guardado NO lleva latitud ni longitud: solo los índices de la celda', c1[0].claves);
    ok((await respuestasDe()).length === 1, 'en el servidor todavía no hay nada nuevo');
    const uuidAna = c1[0].uuid;

    /* =============================================================================================== 4. otra cuenta */
    console.log('\n[4] Otra cuenta en el mismo celular no ve ni sube lo de Ana');
    await sinSenal(false);
    await entrarComo(beto);
    await q(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES ('lider', 'encuestas_campo', 1, 0, 1) ON DUPLICATE KEY UPDATE permitido = 1`);
    await ir('/app/encuestas-campo.html', 3500);
    ok(!(await visible('#bloque-pendientes')), 'Beto no ve la cola de Ana');
    ok((await respuestasDe()).length === 1, 'y su sesión NO la subió');
    ok((await cola()).length === 1, 'la respuesta de Ana sigue guardada (no se borró al cambiar de cuenta)');
    const cp2 = await copias();
    ok(cp2.length === 1 && String(cp2[0].usuarioId) === String(beto), 'la copia de la lista de Ana se borró y quedó solo la de Beto', cp2);

    /* =============================================================================================== 5. vuelve la señal */
    console.log('\n[5] Vuelve la señal: la dueña la sube sola, una vez');
    await entrarComo(ana);
    await ir('/app/encuestas-campo.html', 4500);
    const f2 = await respuestasDe();
    ok(f2.length === 2 && f2[1].cliente_uuid === uuidAna && f2[1].territorio_id === 9104, 'al volver la señal quedó guardada UNA vez, con el identificador que nació en el celular', f2.map((r) => r.cliente_uuid));
    ok((await cola()).length === 0 && !(await visible('#bloque-pendientes')), 'la cola quedó vacía y la pantalla ya no dice «sin subir»');
    ok(f2[1].celda_lat !== null, 'y con su celda');

    /* =============================================================================================== 6. un rechazo no se borra */
    console.log('\n[6] Un rechazo del servidor NO se borra: queda «fallido», visible');
    await empezar();
    await llenar('La Cabaña');
    await q('DELETE FROM territorios WHERE id = 9104');                              // la zona desaparece del catálogo mientras la persona llenaba
    await clic('#btn-siguiente');
    await espera(2500);
    ok(/No se pudo registrar/.test(await texto('#hecho-titulo') || '') && /cat[aá]logo/i.test(await texto('#hecho-texto') || ''), 'la pantalla dice «No se pudo registrar» y por qué', await texto('#hecho-texto'));
    ok(/reintentarla o descartarla/.test(await texto('#hecho-texto') || ''), 'y que quedó guardada para reintentarla o descartarla');
    const c3 = await cola();
    ok(c3.length === 1 && c3[0].estado === 'fallido' && /cat[aá]logo/i.test(c3[0].error), 'EL REGISTRO SIGUE EN LA COLA, marcado «fallido» y con su motivo', c3);
    await q(`INSERT INTO territorios (id, tipo, nombre, padre_id) VALUES (9104, 'vereda', 'La Cabaña', 9101)`);
    await ir('/app/encuestas-campo.html', 3000);
    ok(await visible('#bloque-pendientes') && /No se pudo subir/.test(await texto('#lista-pendientes') || '') && /cat[aá]logo/i.test(await texto('#lista-pendientes [data-error]') || ''), 'la lista lo muestra «No se pudo subir», con el motivo');
    ok(!!(await p.ev(`!!document.querySelector('[data-reintentar]') && !!document.querySelector('[data-descartar]')`)), 'con Reintentar y Descartar');
    await clic('[data-reintentar]');
    await espera(3000);
    const f3 = await respuestasDe();
    ok(f3.length === 3 && (await cola()).length === 0, 'Reintentar (ya con la zona de vuelta en el catálogo) la sube y vacía la cola', f3.length);
    // y Descartar: se manda un registro malo a propósito
    await p.ev(`guardarEnColaOffline('encuestas_pendientes', { clienteUuid: generarUuid(), creadoEn: Date.now(), encuestaId: ${ez.id}, titulo: 'Mala a propósito', payload: { encuesta_id: ${ez.id}, huella: 'x', respuestas: [] } })`);
    await ir('/app/encuestas-campo.html', 3000);
    ok(/Mala a propósito/.test(await texto('#lista-pendientes') || '') && /otra versión/i.test(await texto('#lista-pendientes [data-error]') || ''), 'un registro de otra versión también queda visible con su motivo', await texto('#lista-pendientes'));
    await clic('[data-descartar]');
    await espera(800);
    ok((await cola()).length === 0, 'Descartar lo quita (solo cuando la persona lo decide)');

    /* =============================================================================================== 7. el día de la elección */
    console.log('\n[7] El día de la elección');
    await config({ fecha_eleccion: await fechaSql('CURDATE()') });
    await ir('/app/encuestas-campo.html', 3000);
    ok(await visible('#bloqueo') && /día de la elección/.test(await texto('#bloqueo') || '') && (await p.ev(`document.querySelectorAll('[data-encuesta]').length`)) === 0, 'el servidor responde sin encuestas y la pantalla dice por qué', await texto('#bloqueo'));
    const mañana = await fechaSql('DATE_ADD(CURDATE(), INTERVAL 1 DAY)');
    await config({ fecha_eleccion: mañana });
    await ir('/app/encuestas-campo.html', 3000);
    ok((await p.ev(`document.querySelectorAll('[data-encuesta]').length`)) === 1, 'el día antes, normal (y la fecha de la elección queda en la copia del celular)');
    await sinSenal(true);
    await p.ev(`hoyEnColombia = () => '${mañana}'; pintar();`);                       // el reloj del celular marca el día de la elección
    await espera(300);
    ok(await visible('#bloqueo') && (await p.ev(`document.querySelectorAll('[data-encuesta]').length`)) === 0, 'SIN SEÑAL también se bloquea, con la fecha guardada en el celular');
    await sinSenal(false);
    await config({ fecha_eleccion: null });

    /* =============================================================================================== 8. Solicitudes */
    console.log('\n[8] Solicitudes: la zona con la misma degradación y un rechazo que no se borra');
    await entrarComo(ana);
    await ir('/app/solicitud-nueva.html', 3000);
    const opciones = await p.ev(`[...document.querySelectorAll('#lista-barrios option')].map((o) => o.value).sort()`);
    ok(opciones.join('|') === 'Comuna Centro|Corregimiento Alto|El Carmen|La Cabaña', 'la lista de zonas trae comunas y corregimientos, no solo barrios y veredas', opciones);
    ok(/Barrio, vereda o zona/.test(await texto('#etiqueta-barrio') || ''), 'y la etiqueta se ajusta al nivel');
    // Un barrio de la lista viaja con su territorio_id y su nombre.
    await p.ev(`(async () => {
      const cat = document.querySelector('#categorias button'); if (cat) cat.click();
    })()`);
    await espera(300);
    await escribir('#f-descripcion', 'Hay un hueco grande frente a la escuela.');
    await clic('#btn-siguiente'); await clic('#btn-siguiente');
    await escribir('#f-barrio', 'Comuna Centro');
    await clic('#btn-siguiente');
    // Se rompe a propósito el teléfono: el servidor rechaza una solicitud con autorización y sin datos.
    await p.ev(`document.getElementById('f-autoriza').checked = true; document.getElementById('f-autoriza').dispatchEvent(new Event('change', {bubbles:true}));`);
    await escribir('#f-nombre', 'Persona Ejemplo'); await escribir('#f-telefono', '3001234567');
    await q('UPDATE solicitud_categorias SET activa = 0');                              // el servidor la rechaza: no hay categoría activa
    await clic('#btn-siguiente');
    await espera(2500);
    const colaSol = await p.ev(`(async () => {
      const db = await abrirBaseOffline();
      const todo = await new Promise((ok, ko) => { const r = db.transaction('solicitudes_pendientes', 'readonly').objectStore('solicitudes_pendientes').getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
      return todo.map((r) => ({ estado: r.estado || '', error: r.error || '', barrio: (r.payload || {}).barrio_texto, territorio: (r.payload || {}).territorio_id }));
    })()`);
    await q('UPDATE solicitud_categorias SET activa = 1');
    ok(colaSol.length === 1 && colaSol[0].estado === 'fallido' && colaSol[0].barrio === 'Comuna Centro' && String(colaSol[0].territorio) === '9102', 'la solicitud rechazada SIGUE EN LA COLA como «fallido» (antes se borraba) y viajó con el id de la comuna', colaSol);
    ok(/No se pudo registrar/.test(await texto('#hecho-titulo') || '') && /Mis solicitudes/.test(await texto('#hecho-texto') || ''), 'la pantalla lo dice y manda a «Mis solicitudes»', await texto('#hecho-texto'));
    await ir('/app/mis-solicitudes.html', 3000);
    ok(/No se pudo subir/.test(await texto('#lista-pendientes') || '') && !!(await p.ev(`!!document.querySelector('[data-reintentar]') && !!document.querySelector('[data-descartar]')`)), '«Mis solicitudes» la muestra con Reintentar y Descartar');
    await clic('[data-descartar]');
    await espera(800);
    ok(!(await visible('#bloque-pendientes')), 'Descartar la quita');
    await q('DELETE FROM solicitudes');

    /* =============================================================================================== 9. el constructor */
    console.log('\n[9] El constructor del escritorio');
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await entrarComo(admin);
    p.avisos.length = 0;
    await ir('/encuestas.html', 3000);
    ok(/Uso interno – no publicable/.test(await texto('.enc-uso') || ''), 'la pantalla lleva la marca «Uso interno – no publicable»');
    ok((await p.ev(`document.querySelectorAll('#enc-filas tr[data-id]').length`)) >= 1 && /Publicada/.test(await texto('#enc-filas') || ''), 'la lista muestra las encuestas con su estado');
    await clic('#btn-nueva');
    await escribir('#ed-titulo', 'Encuesta del constructor');
    await escribir('[data-campo="enunciado"]', '¿Qué opina de la fecha de apertura?');
    await escribir('[data-campo="opciones"]', 'Muy bien\nBien\nMal');
    await clic('#ed-agregar');
    await p.ev(`(() => { const s = document.querySelectorAll('.enc-pregunta')[1].querySelector('[data-campo="tipo"]'); s.value = 'escala'; s.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await espera(300);
    await escribir('.enc-pregunta[data-i="1"] [data-campo="enunciado"]', '¿Qué tan seguro se siente en el barrio? (1 = nada, 5 = mucho)');
    await clic('#ed-guardar');
    await espera(1500);
    const guardada = (await q(`SELECT id, estado FROM encuestas WHERE titulo = 'Encuesta del constructor'`))[0];
    ok(guardada && guardada.estado === 'borrador' && (await q('SELECT COUNT(*) c FROM encuesta_preguntas WHERE encuesta_id = ?', [guardada.id]))[0].c === 2, 'se guarda el borrador con sus dos preguntas', guardada);
    ok(/Borrador guardado/.test(await texto('#ed-msg') || ''), 'y lo dice');
    // una pregunta que habla de política sin marcarla
    await clic('#ed-agregar');
    await escribir('.enc-pregunta[data-i="2"] [data-campo="enunciado"]', '¿Votaría por el candidato de su barrio?');
    await escribir('.enc-pregunta[data-i="2"] [data-campo="opciones"]', 'Sí\nNo');
    await clic('#ed-guardar');
    await espera(1500);
    ok(/Para poder publicarla falta corregir/.test(await texto('#ed-problemas') || '') && /sensible/i.test(await texto('#ed-problemas') || ''), 'al guardar avisa qué impide publicar: hay que marcar la pregunta política como sensible', await texto('#ed-problemas'));
    await clic('#ed-publicar');
    await espera(2000);
    ok((await q('SELECT estado FROM encuestas WHERE id = ?', [guardada.id]))[0].estado === 'borrador' && /vot|candidat|sensible/i.test(await texto('#ed-msg') || await texto('#ed-problemas') || ''), 'publicar se rechaza y la encuesta sigue en borrador');
    // marcarla sensible: la casilla «Obligatoria» se deshabilita
    await p.ev(`(() => { const c = document.querySelector('.enc-pregunta[data-i="2"] [data-campo="sensible"]'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await espera(400);
    ok(await p.ev(`document.querySelector('.enc-pregunta[data-i="2"] [data-campo="obligatoria"]').disabled`), 'al marcarla sensible, «Obligatoria» queda deshabilitada');
    // y todavía no se puede publicar: antes de la fecha permitida no puede hablar de voto ni candidatos
    await clic('#ed-publicar');
    await espera(2000);
    ok((await q('SELECT estado FROM encuestas WHERE id = ?', [guardada.id]))[0].estado === 'borrador' && /«/.test(await texto('#ed-problemas') || '') , 'aún marcada, antes de la fecha permitida no se publica y se ve la palabra entre comillas', await texto('#ed-problemas'));
    // se quita la pregunta política y se publica
    await p.ev(`document.querySelector('.enc-pregunta[data-i="2"] [data-accion="quitar"]').click()`);
    await espera(300);
    await clic('#ed-publicar');
    await espera(2500);
    const pubd = (await q('SELECT estado, huella FROM encuestas WHERE id = ?', [guardada.id]))[0];
    ok(pubd.estado === 'publicada' && /^[0-9a-f]{16}$/.test(pubd.huella), 'sin la pregunta política se publica y queda con su huella', pubd);
    ok(/congelada/.test(await texto('.enc-editor') || '') && (await p.ev(`document.getElementById('ed-titulo').disabled`)) && !(await visible('#ed-guardar')) && !!(await p.ev(`!!document.getElementById('ed-cerrar')`)), 'el editor queda en solo lectura: dice «congelada», no hay Guardar, sí Cerrar');
    await clic('#ed-duplicar');
    await espera(2000);
    const copia = (await q(`SELECT id, estado, titulo, copia_de FROM encuestas WHERE copia_de = ?`, [guardada.id]))[0];
    ok(copia && copia.estado === 'borrador' && /^Copia de/.test(copia.titulo) && (await p.ev(`!document.getElementById('ed-titulo').disabled`)), 'Duplicar da un borrador nuevo y editable', copia);
    await clic('#ed-eliminar');
    await espera(1500);
    ok((await q('SELECT 1 FROM encuestas WHERE id = ?', [copia.id])).length === 0, 'y un borrador se elimina');
    ok(p.avisos.length === 0, 'sin errores de JavaScript en el constructor', p.avisos);

    /* =============================================================================================== 10. las colas (parche 308) */
    console.log('\n[10] Las colas sin señal: nada se borra sin que el servidor lo confirme');
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
    await entrarComo(ana);
    await ir('/app/mis-solicitudes.html', 2500);
    const casos = await p.ev(`(async () => {
      const original = api;
      const S = 'solicitudes_pendientes';
      const caso = async (id, stub) => {
        await guardarEnColaOffline(S, { clienteUuid: id, creadoEn: Date.now(), payload: {} });
        api = stub;
        try { await sincronizarCola(S, '/x', (r) => r.payload); } finally { api = original; }
        const r = (await listarColaOffline(S)).find((x) => x.clienteUuid === id);
        const salida = r ? (r.estado || 'pendiente') : 'borrado';
        if (r) await borrarDeColaOffline(S, id);
        return salida;
      };
      const falla = (extra) => async () => { const e = new Error('x'); Object.assign(e, extra); throw e; };
      return {
        sesionVencida: await caso('k1', async () => undefined),
        sinRed: await caso('k2', falla({ esErrorDeRed: true })),
        s429: await caso('k3', falla({ status: 429 })),
        s503: await caso('k4', falla({ status: 503 })),
        s400: await caso('k5', falla({ status: 400 })),
        s500: await caso('k6', falla({ status: 500 })),
        exito: await caso('k7', async () => ({ ok: true })),
        exitoSinCuerpo: await caso('k8', async () => null),
      };
    })()`);
    ok(casos.sesionVencida === 'pendiente', 'un 401 (api() devuelve undefined tras redirigir al login) NO borra el registro: queda pendiente', casos);
    ok(casos.sinRed === 'pendiente' && casos.s429 === 'pendiente' && casos.s503 === 'pendiente', 'ni un error de red, ni 429 ni 503: quedan pendientes para la siguiente subida (no «fallidos»)', casos);
    ok(casos.s400 === 'fallido' && casos.s500 === 'fallido', 'un rechazo real (400, 500) queda «fallido» y NO se borra', casos);
    ok(casos.exito === 'borrado' && casos.exitoSinCuerpo === 'borrado', 'solo lo que el servidor confirmó se borra (con cuerpo o sin él)', casos);
    // api(): el error trae `status` y `datos`
    const e403 = await p.ev(`(async () => { try { await api('/encuestas'); return null; } catch (e) { return { status: e.status, tieneDatos: !!e.datos, mensaje: e.message }; } })()`);
    ok(e403 && e403.status === 403 && e403.tieneDatos && /acceso/i.test(e403.mensaje), 'api() pone error.status (403) y error.datos en los errores del servidor', e403);
    // El 403 en las dos pantallas del celular
    const sinPermiso = await persona('Invitado Sin Permisos', 'invitado');
    await entrarComo(sinPermiso);
    await ir('/app/mis-tareas.html', 3000);
    ok(/no tiene habilitadas las tareas/i.test(await texto('#lista-servidor') || ''), '«Mis tareas»: ante un 403 dice que su tipo de usuario no tiene habilitadas las tareas (esa rama nunca se ejecutaba)', await texto('#lista-servidor'));
    await ir('/app/mis-solicitudes.html', 3000);
    ok(/no tiene habilitadas las solicitudes/i.test(await texto('#lista-servidor') || ''), '«Mis solicitudes»: lo mismo');
    // «Mis tareas»: un rechazo queda fallido, visible, con Reintentar y Descartar
    await entrarComo(ana);
    const [rt] = await pool.query(`INSERT INTO tareas (tipo, titulo, estado, zona_texto, creada_por, asignada_a) VALUES ('libre', 'Tarea que se cancela', 'pendiente', 'La Esperanza', ?, ?)`, [jefa, ana]);
    await ir('/app/mis-tareas.html', 3000);
    await clic(`[data-abrir="${rt.insertId}"]`);
    await sinSenal(true);
    await clic(`[data-accion="empece"][data-id="${rt.insertId}"]`);
    await espera(1200);
    await sinSenal(false);
    await q(`UPDATE tareas SET estado = 'cancelada', cancelada_en = NOW(), motivo_cancelacion = 'Ya no hace falta' WHERE id = ?`, [rt.insertId]);
    await ir('/app/mis-tareas.html', 4500);
    const colaT = await p.ev(`(async () => { const t = await listarColaOffline('tareas_pendientes'); return t.map((r) => ({ estado: r.estado || '', error: r.error || '' })); })()`);
    ok(colaT.length === 1 && colaT[0].estado === 'fallido' && colaT[0].error, '«Mis tareas»: la acción que el servidor rechazó SIGUE EN LA COLA, «fallido» y con su motivo', colaT);
    ok(await visible('#bloque-pendientes') && /No se pudo subir/.test(await texto('#lista-pendientes') || '') && !!(await p.ev(`!!document.querySelector('#lista-pendientes [data-reintentar]') && !!document.querySelector('#lista-pendientes [data-descartar]')`)), 'y la pantalla lo muestra con Reintentar y Descartar');
    await clic('#lista-pendientes [data-reintentar]');
    await espera(2500);
    ok((await p.ev(`(async () => (await listarColaOffline('tareas_pendientes')).map((r) => r.estado || ''))()`)).join() === 'fallido', 'Reintentar lo vuelve a intentar y, si el servidor lo rechaza otra vez, sigue ahí (nada se borra solo)');
    await clic('#lista-pendientes [data-descartar]');
    await espera(1500);
    ok((await p.ev(`(async () => (await listarColaOffline('tareas_pendientes')).length)()`)) === 0, 'Descartar lo quita (solo cuando la persona lo decide)');
    await q('DELETE FROM tareas WHERE id = ?', [rt.insertId]);

    /* =============================================================================================== 11. los resultados en el escritorio (parche 308) */
    console.log('\n[11] Resultados, calidad y cuotas en el escritorio');
    const apx = await persona('Aplicador Resultados', 'lider', 'lider', jefa);
    for (let i = 0; i < 8; i++) {
      await E.registrarRespuesta({ usuario: { id: apx, rol: 'lider', nombre: 'Aplicador Resultados' }, body: {
        cliente_uuid: crypto.randomUUID(), encuesta_id: ez.id, huella: ez.huella, respondida_en: new Date(Date.now() - (i + 10) * 180000).toISOString(), iniciada_en: new Date(Date.now() - (i + 10) * 180000 - 60000).toISOString(),
        territorio_id: 9103, respuestas: [{ pregunta_id: ez.preguntas[0].id, opcion: 'o' + (1 + (i % 3)) }, { pregunta_id: ez.preguntas[3].id, valor: 1 + i }, { pregunta_id: ez.preguntas[4].id, texto: 'Texto de revisión ' + i }] } });
    }
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await entrarComo(admin);
    p.avisos.length = 0;
    await ir('/encuestas.html', 3000);
    await clic(`#enc-filas tr[data-id="${ez.id}"]`);
    await espera(3500);
    ok((await p.ev(`document.querySelectorAll('#enc-vista .enc-res').length`)) >= 5, 'al abrir una encuesta publicada aparece la pestaña «Resultados» con una tabla por pregunta', await p.ev(`document.querySelectorAll('#enc-vista .enc-res').length`));
    const vista = await texto('#enc-vista') || '';
    ok(/Uso interno – no publicable/.test(vista) && /Todas las zonas/.test(vista) && /Cobertura/.test(vista) && /Mínimo de respuestas por celda/.test(vista), 'con la franja «Uso interno – no publicable», el total, la cobertura y el mínimo por celda');
    ok(/Sin agregado|no tiene agregado/.test(vista) && !/Texto de revisión/.test(vista), 'la pregunta de texto no tiene agregado y ningún texto libre aparece en los resultados');
    ok(!!(await p.ev(`!!document.querySelector('#rs-excel') && document.querySelector('#rs-excel').getAttribute('href').includes('/api/encuestas/${ez.id}/exportar')`)), 'el administrador ve el botón del Excel');
    ok((await p.ev(`document.querySelectorAll('.enc-tab').length`)) === 4, 'y ve cuatro pestañas: Resultados, Cuotas por zona, Calidad y Textos libres');
    await clic('.enc-tab[data-vista="calidad"]'); await espera(2500);
    ok(/Por aplicador/.test(await texto('#enc-vista') || '') && /Aplicador Resultados/.test(await texto('#enc-vista') || '') && !/Texto de revisión|Arreglar la calle/.test(await texto('#enc-vista') || ''), 'Calidad: el panel por aplicador, sin una sola respuesta');
    await clic('.enc-tab[data-vista="textos"]'); await espera(2500);
    ok(/Texto de revisión/.test(await texto('#enc-vista') || '') && !!(await p.ev(`!!document.querySelector('[data-texto][data-accion="borrar"]')`)), 'Textos libres: ahí SÍ se ven, con Conservar y Borrar');
    await clic('[data-texto][data-accion="borrar"]'); await espera(1500);
    ok((await q('SELECT COUNT(*) n FROM encuesta_respuesta_items WHERE valor_texto IS NULL AND texto_revisado = 1'))[0].n >= 1, 'Borrar desde la pantalla borra el texto');
    await clic('.enc-tab[data-vista="cuotas"]'); await espera(2500);
    await escribir('#cu-zona', 'El Carmen'); await escribir('#cu-meta', '12'); await clic('#cu-agregar'); await clic('#cu-guardar'); await espera(1500);
    ok((await q('SELECT meta FROM encuesta_cuotas WHERE encuesta_id = ? AND territorio_id = 9103', [ez.id]))[0].meta === 12, 'Cuotas: se agrega la zona con su meta y se guarda');
    await clic('.enc-tab[data-vista="resultados"]'); await espera(2500);
    ok(/Cuotas por zona/.test(await texto('#enc-vista') || '') && /El Carmen/.test(await texto('#enc-vista') || ''), 'y el avance de la cuota aparece en los resultados');
    ok(p.avisos.length === 0, 'sin errores de JavaScript en los resultados', p.avisos);
    // quien tiene «Ver» pero no es administrador ni tiene la casilla de Exportar
    await entrarComo(jefa);
    await ir('/encuestas.html', 3000);
    await clic(`#enc-filas tr[data-id="${ez.id}"]`);
    await espera(3500);
    ok((await p.ev(`document.querySelectorAll('.enc-tab').length`)) === 2 && !(await p.ev(`!!document.querySelector('.enc-tab[data-vista="calidad"]')`)), 'la coordinadora con «Ver» ve solo Resultados y Cuotas: no Calidad ni Textos libres');
    ok(!(await p.ev(`!!document.querySelector('#rs-excel')`)) && (await p.ev(`document.getElementById('rs-min').disabled`)), 'sin la casilla de Exportar no hay botón de Excel, y el mínimo por celda no es editable');
  } catch (err) {
    fallos++;
    console.log('  FALLA la prueba se interrumpió: ' + (err && err.stack || err));
  } finally {
    try { await config({ fecha_eleccion: null }); await q('UPDATE solicitud_categorias SET activa = 1'); } catch (_) { /* nada */ }
    if (navegador) navegador.cerrar();
    if (servidor) servidor.close();
    await pool.end().catch(() => {});
  }
  console.log(fallos ? `\n${fallos} comprobación(es) FALLARON.` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})();
