#!/usr/bin/env node
// scripts/probar-puerta-a-puerta-celular.js
//
// Prueba, en un Chromium REAL, de «Puerta a puerta» en el celular (parche 309):
//   · la lista: ordenada por cercanía EN el celular, con el punto de partida solo en memoria (ninguna petición lleva la ubicación);
//   · la copia en IndexedDB: con dueño, sin cédula ni teléfono ni correo; se BORRA al cambiar de cuenta; CADUCA a las 48 horas;
//   · cada resultado se guarda primero en el celular, SIN nombre ni dirección, y sube solo cuando hay señal (una vez);
//   · un rechazo del servidor NO se borra: queda «fallido» con su motivo, y la persona decide Reintentar o Descartar;
//   · fuera de la franja y el día de la elección el celular se niega solo (nada queda en la cola), también sin señal;
//   · «pidió no volver» con y sin «tampoco quiere mensajes»; «quiere registrarse» abre el registro normal sin guardar el vínculo.
//
// La hora del navegador se FIJA (ayer a las 10:00 de Colombia) para que la prueba no dependa de la hora a la que se corre.
//
// USO (sobre una base desechable ya inicializada con init-db; hace falta Chromium, ver scripts/capturas/navegador.js):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada309c node scripts/probar-puerta-a-puerta-celular.js
//
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) {
  console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`);
  process.exit(2);
}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
// Aislada del .env de esta instalación: la prueba decide sola si hay token de Mapbox (nunca el real).
delete process.env.MAPBOX_ACCESS_TOKEN;
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';

const http = require('http');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { lanzar, espera } = require('./capturas/navegador');
const { crear } = require('./capturas/servidor');
const R = require('../public/js/puerta-reglas');
const P = require('../lib/puertaAPuerta');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }
const mismo = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sello = String(Date.now()).slice(-7);
let n = 0;
async function persona(nombre, rol, cargo, supervisor) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, `95${sello}${n}`, `u95${sello}${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  if (cargo) await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, ?, 1)', [r.insertId, cargo, supervisor || null]);
  return r.insertId;
}
let nv = 0;
async function votante(nombre, lider, direccion, lat, lon, telefono) {
  nv++;
  const [r] = await pool.query(
    `INSERT INTO votantes (nombre, cedula, telefono, email, direccion, latitud, longitud, lider_id, consentimiento_autorizado, apoya_a, observaciones, categoria)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'votante')`,
    [nombre, `94${sello}${nv}`, telefono || `31${sello}${nv}`.slice(0, 10), `p${sello}${nv}@secreto.test`, direccion, lat, lon, lider, JSON.stringify(['alcaldia']), `OBS-SECRETA-${sello}`]);
  return r.insertId;
}

(async () => {
  let servidor; let navegador;
  try {
    await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
    await q(`UPDATE configuracion_campana SET fecha_eleccion = NULL, puerta_franja_desde = '08:00', puerta_franja_hasta = '18:00' WHERE id = 1`);
    await q(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES ('lider', 'puerta_visitas', 1, 0, 1) ON DUPLICATE KEY UPDATE permitido = 1, editar = 0, agregar = 1`);
    const admin = await persona('Admin Ejemplo', 'admin');
    const lid = await persona('Lider Ejemplo', 'lider', 'lider');
    const otro = await persona('Otra Cuenta', 'lider', 'lider');
    // Cuatro puertas con coordenadas conocidas (A, D, B) y una sin ellas (C), más dos para las pruebas de franja y de registro.
    const vA = await votante('Alicia Antigua', lid, 'Calle 10 # 5-20', 5.070, -75.510, '3001112233');
    const vD = await votante('Diego Cercano', lid, 'Carrera 7 # 8-10', 5.071, -75.511);
    const vB = await votante('Berta Lejana', lid, 'Avenida 30 # 40-50', 5.080, -75.520);
    const vC = await votante('Camilo SinMapa', lid, 'Vereda El Alto, finca La Palma', null, null);
    const vE = await votante('Elisa Horario', lid, 'Calle 1 # 1-1', 5.072, -75.512);
    const vF = await votante('Fernando Registro', lid, 'Calle 2 # 2-2', 5.073, -75.513);
    const armada = await P.armarLista({ datos: { nombre: 'Lista de prueba', asignada_a: lid, cliente_uuid: require('crypto').randomUUID() },
      usuario: { id: admin, rol: 'admin' }, alcanceQuienArma: { cargo: 'madre', cargoMadre: null }, asignables: { sql: '1 = 1', valores: [] } });
    const items = {};
    for (const [k, v] of Object.entries({ A: vA, D: vD, B: vB, C: vC, E: vE, F: vF })) items[k] = (await q('SELECT id FROM puerta_items WHERE lista_id = ? AND votante_id = ?', [armada.id, v]))[0].id;
    console.log('PUERTA A PUERTA, EN EL CELULAR — base «' + nombreBase + '»  (lista ' + armada.id + ', ' + armada.personas + ' puertas)\n');

    const app = crear(pool);
    servidor = http.createServer(app);
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${servidor.address().port}`;
    navegador = await lanzar();
    const p = await navegador.pagina('about:blank');
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
    await p.cmd('Network.clearBrowserCookies');
    // «Ahora» del navegador: AYER a las 10:00 de Colombia (el servidor aceptará lo capturado en los últimos 7 días).
    const ayer = R.sumarDias(R.colombiaDe(new Date()).fecha, -1);
    const AHORA = new Date(`${ayer}T10:00:00-05:00`).getTime();
    await p.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `
      (() => { const T = ${AHORA}; const RD = Date;
        class FD extends RD { constructor(...a) { if (a.length === 0) super(T); else super(...a); } static now() { return T; } }
        window.Date = FD; })();
      window.confirm = () => true;
      try { window.__sinSenal = sessionStorage.getItem('sinSenal') === '1'; } catch (_) { window.__sinSenal = false; }
      window.__cuerpos = [];
      const f = window.fetch.bind(window);
      window.fetch = (...a) => { try { window.__cuerpos.push(String((a[1] && a[1].body) || '')); } catch (_) {} return window.__sinSenal ? Promise.reject(new TypeError('Failed to fetch')) : f(...a); };` });

    const sinSenal = (off) => p.ev(`window.__sinSenal = ${off ? 'true' : 'false'}; sessionStorage.setItem('sinSenal', '${off ? 1 : 0}')`);
    const entrarComo = async (id) => { await p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(id), url: base }); };
    const ir = async (ruta, ms = 2400) => { await p.cmd('Page.navigate', { url: base + ruta }); await espera(ms); };
    const clic = (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
    const texto = (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
    const idb = (store) => p.ev(`(async () => { const db = await abrirBaseOffline();
      return await new Promise((ok, ko) => { const r = db.transaction(${JSON.stringify(store)}, 'readonly').objectStore(${JSON.stringify(store)}).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); }); })()`);
    const resultado = async (item, r) => { await clic(`[data-resultado="${r}"][data-id="${item}"]`); await espera(1800); };
    const nombresEnPantalla = () => p.ev(`Array.from(document.querySelectorAll('#lista-servidor .caja-pp[data-item] .nombre')).map((e) => e.textContent.replace(/\\s+/g, ' ').trim())`);
    const filaItem = async (id) => (await q('SELECT estado, intentos, ultimo_resultado FROM puerta_items WHERE id = ?', [id]))[0];
    const visitasDe = async (id) => q('SELECT resultado, fecha, franja FROM puerta_visitas WHERE item_id = ? ORDER BY id', [id]);
    const SECRETOS = [`94${sello}`, `OBS-SECRETA-${sello}`, '@secreto.test', '3001112233', 'alcaldia', 'cedula', 'telefono', 'consentimiento'];

    /* ============================================================================================ 1. la lista */
    console.log('[1] La lista: ordenada por cercanía en el celular');
    await entrarComo(lid);
    await ir('/app/puerta-a-puerta.html');
    let nombres = await nombresEnPantalla();
    ok(nombres.length === 6, 'el líder ve sus 6 puertas', nombres);
    ok(nombres[0].startsWith('Alicia') && nombres[1].startsWith('Diego') && nombres[nombres.length - 1].startsWith('Camilo'),
      'sin ubicación, parte de la primera puerta: Alicia, Diego (la más cercana)… y la que no tiene coordenadas, al final', nombres);
    ok(/Por visitar/.test(await texto('#resumen') || '') && /^.*6.*Por visitar/.test(await texto('#resumen') || ''), 'el resumen cuenta 6 por visitar', await texto('#resumen'));
    ok(/de 08:00 a 18:00/.test(await texto('#bloque-estado') || ''), 'dice el horario de las visitas');
    ok(/48 horas/.test(await texto('#nota-copia') || ''), 'avisa que la lista queda guardada 48 horas');
    ok(await p.ev(`document.querySelectorAll('a[href*="maps"], a[href^="geo:"], a[href^="tel:"], button[data-compartir]').length === 0 && !/navigator\\.share|window\\.print/.test(document.documentElement.innerHTML)`), 'sin botón de Google Maps, sin llamar, sin compartir ni imprimir');
    const copia = await idb('puerta_cache');
    ok(copia.length === 1 && String(copia[0].usuarioId) === String(lid) && copia[0].datos.listas[0].items.length === 6, 'la copia en IndexedDB es de ESTE usuario y tiene las 6 puertas', copia.map((c) => [c.usuarioId, c.clienteUuid]));
    ok(!SECRETOS.some((s) => JSON.stringify(copia).includes(s)), 'y la copia NO trae cédula, teléfono, correo, apoya_a, observaciones ni consentimiento', SECRETOS.filter((s) => JSON.stringify(copia).includes(s)));

    /* ===================================================================== 2. la ubicación, solo en memoria */
    console.log('\n[2] La ubicación de quien visita: una lectura, solo en memoria');
    const permiso = await p.cmd('Browser.grantPermissions', { permissions: ['geolocation'], origin: base });
    await p.cmd('Emulation.setGeolocationOverride', { latitude: 5.0801, longitude: -75.5201, accuracy: 20 });
    if (permiso.error) console.log('  (no se pudo conceder el permiso de ubicación en este Chromium: ' + JSON.stringify(permiso.error).slice(0, 120) + ')');
    await clic('#btn-gps');
    await espera(1500);
    nombres = await nombresEnPantalla();
    ok(permiso.error || (nombres[0].startsWith('Berta') && nombres[1].startsWith('Fernando')), 'al ordenar desde donde está (junto a Berta), la primera puerta es la más cercana a esa posición y la segunda la que sigue (Fernando)', nombres);
    ok(permiso.error || /no se guarda ni se envía/.test(await texto('#estado-gps') || ''), 'y la pantalla dice que la ubicación no se guarda ni se envía');
    const cuerpos = await p.ev('window.__cuerpos');
    ok(!cuerpos.some((c) => /5\.080|75\.520/.test(c)), 'ninguna petición a la red llevó la ubicación', cuerpos);
    const ls = await p.ev(`JSON.stringify(Object.assign({}, localStorage))`);
    ok(!/5\.0801|75\.5201/.test(ls) && !/5\.0801|75\.5201/.test(JSON.stringify(await idb('puerta_cache'))), 'ni quedó guardada en el celular');

    /* ============================================================================ 3. un resultado con señal */
    console.log('\n[3] Un resultado con señal: sube y la puerta cambia');
    await ir('/app/puerta-a-puerta.html');
    await resultado(items.A, 'no_abrio');
    const vis = await visitasDe(items.A);
    ok(vis.length === 1 && vis[0].resultado === 'no_abrio' && String(vis[0].fecha).slice(0, 10) === ayer && vis[0].franja === 'manana', 'el servidor guardó el resultado con la FECHA y la franja (mañana), no la hora', vis);
    const fa = await filaItem(items.A);
    ok(fa.estado === 'pendiente' && Number(fa.intentos) === 1, 'la puerta queda pendiente con un intento', fa);
    nombres = await nombresEnPantalla();
    ok(!nombres.some((x) => x.startsWith('Alicia')) && /Para volver más tarde/.test(await texto('#lista-servidor') || '') && /Intento 1 de 3/.test(await texto('#lista-servidor') || ''), 'y pasa a «Para volver más tarde», con «Intento 1 de 3»');
    ok((await idb('puerta_pendientes')).length === 0, 'la cola quedó vacía');

    /* ======================================================================================= 4. sin señal */
    console.log('\n[4] Sin señal: se guarda primero en el celular, sin nombre ni dirección, y sube una sola vez');
    await sinSenal(true);
    await resultado(items.D, 'no_interesado');
    let cola = await idb('puerta_pendientes');
    ok(cola.length === 1 && String(cola[0].usuarioId) === String(lid) && cola[0].resultado === 'no_interesado' && cola[0].itemId === items.D, 'queda en puerta_pendientes con su dueño', cola);
    ok(!/Diego|Carrera|alcaldia/.test(JSON.stringify(cola)), 'el registro de la cola NO lleva el nombre ni la dirección de nadie', JSON.stringify(cola));
    ok(/Esperando señal/.test(await texto('#lista-pendientes') || '') && (await visitasDe(items.D)).length === 0, 'la pantalla lo dice y el servidor todavía no sabe nada');
    ok(!(await nombresEnPantalla()).some((x) => x.startsWith('Diego')), 'la puerta ya sale de la ruta');
    ok(!JSON.stringify(await idb('puerta_cache')).includes('Diego'), 'y su nombre ya no está en la copia guardada (una puerta cerrada no necesita a la persona)');
    await sinSenal(false);
    await p.ev(`window.dispatchEvent(new Event('online'))`);
    await espera(2500);
    ok((await idb('puerta_pendientes')).length === 0 && (await visitasDe(items.D)).length === 1 && (await filaItem(items.D)).estado === 'cerrada', 'al volver la señal sube sola, una vez, y la cola se vacía');
    await p.ev(`window.dispatchEvent(new Event('online'))`);
    await espera(1200);
    ok((await visitasDe(items.D)).length === 1, 'otro aviso de señal no la duplica');

    /* ============================================================ 5. un rechazo del servidor no se borra */
    console.log('\n[5] Un rechazo del servidor NO se borra: queda «fallido» y la persona decide');
    await sinSenal(true);
    await resultado(items.B, 'interesado');
    ok((await idb('puerta_pendientes')).length === 1, 'sin señal, «interesado» queda en la cola');
    await q("UPDATE puerta_items SET estado = 'cerrada', ultimo_resultado = 'no_interesado', ultima_fecha = CURDATE() WHERE id = ?", [items.B]);
    await sinSenal(false);
    await p.ev(`window.dispatchEvent(new Event('online'))`);
    await espera(2500);
    cola = await idb('puerta_pendientes');
    ok(cola.length === 1 && cola[0].estado === 'fallido' && /ya tiene un resultado/.test(cola[0].error || ''), 'el servidor lo rechazó (la puerta ya estaba cerrada) y queda «fallido» con su motivo, sin borrarse', cola.map((c) => [c.estado, c.error]));
    const pend = await texto('#lista-pendientes');
    ok(/No se pudo subir/.test(pend || '') && await p.ev(`!!document.querySelector('[data-reintentar]') && !!document.querySelector('[data-descartar]')`), 'la pantalla ofrece Reintentar y Descartar');
    await clic('[data-descartar]');
    await espera(1200);
    ok((await idb('puerta_pendientes')).length === 0, 'Descartar lo quita, porque la persona lo decidió');

    /* ============================================================ 6. pidió no volver, con y sin mensajes */
    console.log('\n[6] «Pidió no volver»');
    await ir('/app/puerta-a-puerta.html');
    await clic(`[data-pedir-no-volver="${items.C}"]`);
    await espera(400);
    ok(await p.ev(`!!document.querySelector('#chk-mensajes')`), 'abre un panel con la casilla «tampoco quiere mensajes»');
    await p.ev(`document.querySelector('#chk-mensajes').checked = true`);
    await clic(`[data-confirmar-no-volver="${items.C}"]`);
    await espera(2200);
    const fc = (await q('SELECT no_visitar, no_contactar, no_contactar_canal FROM votantes WHERE id = ?', [vC]))[0];
    ok(Number(fc.no_visitar) === 1 && Number(fc.no_contactar) === 1 && fc.no_contactar_canal === 'en_persona', 'con la casilla marcada: no_visitar Y no_contactar (canal en_persona)', fc);
    ok((await filaItem(items.C)).estado === 'cerrada', 'y la puerta se cierra');

    /* ======================================================================== 7. fuera de la franja */
    console.log('\n[7] Fuera de la franja el celular se niega solo: no se guarda NADA');
    await q(`UPDATE configuracion_campana SET puerta_franja_desde = '11:00', puerta_franja_hasta = '12:00' WHERE id = 1`);
    await ir('/app/puerta-a-puerta.html');
    ok(/fuera del horario/i.test(await texto('#bloque-estado') || ''), 'avisa arriba que ahora está fuera del horario');
    await clic(`[data-resultado="no_abrio"][data-id="${items.E}"]`);
    await espera(600);
    ok(/Fuera del horario permitido/.test(await texto('#aviso') || '') && (await idb('puerta_pendientes')).length === 0 && (await visitasDe(items.E)).length === 0, 'con las 10:00 y la franja 11:00–12:00: no queda nada en la cola ni en el servidor', await texto('#aviso'));
    await sinSenal(true);
    await clic(`[data-resultado="no_abrio"][data-id="${items.E}"]`);
    await espera(600);
    ok((await idb('puerta_pendientes')).length === 0, 'tampoco sin señal');
    await sinSenal(false);
    await q(`UPDATE configuracion_campana SET puerta_franja_desde = '08:00', puerta_franja_hasta = '18:00' WHERE id = 1`);

    /* ============================================================================ 8. quiere registrarse */
    console.log('\n[8] «Alguien quiere registrarse» abre el registro normal');
    await ir('/app/puerta-a-puerta.html');
    await clic(`[data-resultado="quiere_registrarse"][data-id="${items.F}"]`);
    await espera(2500);
    // Desde el parche 312, quien tiene enlace de inscripción ve primero el cuadro con «Abrir el registro» y «Mostrar código QR» (lo prueba probar-puerta-fases-3-4.js).
    ok(await p.ev(`!!document.getElementById('velo-registro')`), 'quien tiene enlace propio ve el cuadro de «Alguien quiere registrarse» (el resultado ya quedó guardado)');
    await clic('#vr-abrir');
    await espera(3000);
    const ruta = await p.ev('location.pathname');
    ok(ruta === '/app/registro-votante.html', 'abre /app/registro-votante.html', ruta);
    const vf = await visitasDe(items.F);
    ok(vf.length === 1 && vf[0].resultado === 'quiere_registrarse' && (await filaItem(items.F)).estado === 'cerrada', 'la visita quedó registrada, y no se guardó de cuál visita vino el registro (no hay columna de vínculo)');

    /* ======================================================================== 9. el día de la elección */
    console.log('\n[9] El día de la elección: bloqueado, con la fecha de captura, también sin señal');
    await q('UPDATE configuracion_campana SET fecha_eleccion = ? WHERE id = 1', [ayer]);           // «hoy» para el navegador (el servidor no lo bloquea: su hoy es otro)
    await ir('/app/puerta-a-puerta.html');
    await clic(`[data-resultado="no_abrio"][data-id="${items.E}"]`);
    await espera(600);
    ok(/día de la elección/.test(await texto('#aviso') || '') && (await idb('puerta_pendientes')).length === 0, 'el celular se niega a registrar una visita ese día', await texto('#aviso'));
    ok((await visitasDe(items.E)).length === 0, 'y el servidor tampoco recibió nada');
    await sinSenal(true);
    await p.ev('refrescar()');
    await espera(800);
    ok(/día de la elección/.test(await texto('#lista-servidor') || '') && (await nombresEnPantalla()).length === 0, 'sin señal, la pantalla ya no muestra la lista: dice que es el día de la elección', await texto('#lista-servidor'));
    ok((await idb('puerta_cache')).length === 0, 'y borra la copia que tenía guardada');
    await sinSenal(false);
    await q('UPDATE configuracion_campana SET fecha_eleccion = NULL WHERE id = 1');

    /* ===================================================================================== 10. 48 horas */
    console.log('\n[10] La copia caduca a las 48 horas');
    await ir('/app/puerta-a-puerta.html');
    ok((await idb('puerta_cache')).length === 1, 'con señal vuelve a quedar la copia');
    await p.ev(`(async () => { const c = await leerCopiaOffline('puerta_cache', 'mia'); c.guardadoEn = ${AHORA} - 47 * 3600 * 1000; await guardarEnColaOffline('puerta_cache', c); })()`);
    await sinSenal(true);
    await p.ev('refrescar()');
    await espera(800);
    ok((await nombresEnPantalla()).length > 0 && /Sin señal/.test(await texto('#nota-copia') || ''), 'a las 47 horas, sin señal, todavía se ve la lista guardada', await texto('#nota-copia'));
    await p.ev(`(async () => { const c = await leerCopiaOffline('puerta_cache', 'mia'); c.guardadoEn = ${AHORA} - 49 * 3600 * 1000; await guardarEnColaOffline('puerta_cache', c); })()`);
    await p.ev('refrescar()');
    await espera(800);
    ok(/caducó/.test(await texto('#lista-servidor') || '') && (await nombresEnPantalla()).length === 0, 'a las 49 horas, sin señal, caducó: dice que con señal se baja otra', await texto('#lista-servidor'));
    ok((await idb('puerta_cache')).length === 0, 'y la copia se borró');
    await sinSenal(false);

    /* ===================================================================== 11. cerrar sesión / cambiar de cuenta */
    console.log('\n[11] Al cambiar de cuenta, la copia se borra y la cola no');
    await ir('/app/puerta-a-puerta.html');
    ok((await idb('puerta_cache')).length === 1, 'con señal vuelve la copia');
    ok(await p.ev(`(async () => { localStorage.setItem('offline_usuario_id', '${otro}'); const c = await leerCopiaOffline('puerta_cache', 'mia'); localStorage.setItem('offline_usuario_id', '${lid}'); return c === null; })()`), 'otra cuenta del mismo celular NO ve la copia de la primera');
    await p.ev(`guardarEnColaOffline('puerta_pendientes', { clienteUuid: 'prueba-cola-' + Date.now(), creadoEn: 1, itemId: 1, resultado: 'no_abrio', payload: {}, usuarioId: '${lid}' })`);
    await p.ev(`purgarCopiasSinSenal('${lid}')`);
    await espera(800);
    ok((await idb('puerta_cache')).length === 0, 'al cambiar de cuenta (purgarCopiasSinSenal) la copia con nombres y direcciones se borra');
    ok((await idb('puerta_pendientes')).length === 1, 'y lo pendiente de subir NO (es trabajo sin enviar)');

    /* ============================================================ 12. «Volver a permitir visitas» en la ficha */
    console.log('\n[12] «Volver a permitir visitas»: el botón solo para el administrador, el diálogo y el efecto');
    const coord = await persona('Coord Ejemplo', 'coordinador', 'coordinador');
    const vN = await votante('Nelly NoVisitar', lid, 'Calle 9 # 9-9', 5.074, -75.514);
    await q('UPDATE votantes SET no_visitar = 1, no_visitar_fecha = ?, no_contactar = 1, no_contactar_canal = ? WHERE id = ?', [ayer, 'sms', vN]);
    await entrarComo(coord);
    await ir('/votantes.html', 3500);
    ok(await p.ev(`typeof lineaNoVisitar === 'function' && !/data-permitir-visitas/.test(lineaNoVisitar({ id: ${vN}, no_visitar: 1, no_visitar_fecha: '${ayer}' }))`), 'el coordinador ve la ficha dicha «pidió no recibir más visitas» pero SIN el botón');
    await entrarComo(admin);
    await ir('/votantes.html', 3500);
    const linea = await p.ev(`lineaNoVisitar({ id: ${vN}, no_visitar: 1, no_visitar_fecha: '${ayer}' })`);
    ok(/Pidió no recibir más visitas \(desde el /.test(linea) && linea.includes(`data-permitir-visitas="${vN}"`) && /Volver a permitir visitas/.test(linea), 'el administrador sí ve el botón «Volver a permitir visitas»', linea);
    ok(await p.ev(`lineaNoVisitar({ id: 1, no_visitar: 0 })`) === '', 'y una ficha sin la marca no muestra nada');
    await p.ev(`abrirPermitirVisitas({ id: ${vN}, nombre: 'Nelly', alListo: () => { window.__listo = true; } })`);
    await espera(300);
    ok(await p.ev(`!!document.querySelector('#pv-motivo') && document.querySelector('#pv-fecha').max === document.querySelector('#pv-fecha').value`), 'se abre el diálogo, con la fecha de hoy y sin permitir fechas futuras');
    await clic('#pv-guardar');
    await espera(500);
    ok(/motivo/i.test(await texto('#pv-error') || '') && Number((await q('SELECT no_visitar n FROM votantes WHERE id = ?', [vN]))[0].n) === 1, 'sin motivo no se envía nada', await texto('#pv-error'));
    await p.ev(`document.querySelector('#pv-motivo').value = 'el ciudadano lo pidió en la sede'`);
    await clic('#pv-guardar');
    await espera(1800);
    const fn = (await q('SELECT no_visitar, no_visitar_fecha, no_contactar, no_contactar_canal FROM votantes WHERE id = ?', [vN]))[0];
    ok(Number(fn.no_visitar) === 0 && fn.no_visitar_fecha === null && Number(fn.no_contactar) === 1 && fn.no_contactar_canal === 'sms', 'quita la marca de visitas y NO toca la de mensajes', fn);
    ok(await p.ev('window.__listo === true') && !(await p.ev(`!!document.querySelector('#overlay-permitir-visitas')`)), 'avisa a la pantalla y cierra el diálogo');
    ok((await q(`SELECT COUNT(*) n FROM auditoria WHERE accion = 'votante_permitir_visitas' AND detalle LIKE '%el ciudadano lo pidió en la sede%'`))[0].n === 1, 'y queda en la auditoría con el motivo');


    /* ======================================================================================== 13. el mapa y la ruta */
    console.log('\n[13] El mapa: Leaflet local, pines numerados en el orden de la ruta, línea guía, sin señal sobre fondo liso');
    const lid5 = await persona('Lider Mapa', 'lider', 'lider');
    const pts = [['Pía Uno', 5.0700, -75.5100], ['Pablo Dos', 5.0710, -75.5110], ['Paula Tres', 5.0800, -75.5200], ['Pedro Cuatro', 5.0720, -75.5120], ['Pilar SinMapa', null, null]];
    const vM = [];
    for (const [nom, la, lo] of pts) vM.push(await votante(nom, lid5, 'Calle ' + nom.split(' ')[0] + ' # 1-1', la, lo));
    const lmapa = await P.armarLista({ datos: { nombre: 'Lista del mapa', asignada_a: lid5, cliente_uuid: require('crypto').randomUUID() },
      usuario: { id: admin, rol: 'admin' }, alcanceQuienArma: { cargo: 'madre', cargoMadre: null }, asignables: { sql: '1 = 1', valores: [] } });
    const itM = []; for (const v of vM) itM.push((await q('SELECT id FROM puerta_items WHERE lista_id = ? AND votante_id = ?', [lmapa.id, v]))[0].id);
    const esperada = (inicio) => R.ordenarPorCercania(itM.map((id, k) => ({ id, orden: k, lat: pts[k][1], lon: pts[k][2] })), inicio);
    const pinesEsperados = (inicio) => esperada(inicio).map((id, k) => ({ id, n: k + 1 })).filter((x) => pts[itM.indexOf(x.id)][1] !== null);
    const tesela = /^https:\/\/((a|b|c)\.)?tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$|^https:\/\/api\.mapbox\.com\/styles\/v1\/mapbox\/streets-v12\/tiles\/\d+\/\d+\/\d+\?access_token=[\w.-]+$/;
    const externas = (desde) => p.peticiones.slice(desde).filter((u) => !/^(http:\/\/127\.0\.0\.1|data:|blob:|about:)/.test(u));
    delete process.env.MAPBOX_ACCESS_TOKEN;
    await entrarComo(lid5);
    const desde0 = p.peticiones.length;
    await ir('/app/puerta-a-puerta.html', 3500);
    ok(await p.ev(`typeof L === 'object' && L.version === '1.9.4'`) && p.peticiones.slice(desde0).some((u) => u.endsWith('/vendor/leaflet/leaflet.js')), 'Leaflet 1.9.4 se carga de /vendor/leaflet (de esta app)');
    ok(!p.peticiones.slice(desde0).some((u) => /unpkg\.com|google/i.test(u)), 'sin ninguna petición a unpkg ni a Google', p.peticiones.slice(desde0).filter((u) => /unpkg|google/i.test(u)));
    ok(await p.ev(`getComputedStyle(document.querySelector('#bloque-mapa')).display !== 'none' && !!document.querySelector('#mapa-pp.leaflet-container')`), 'el mapa se dibuja');
    let dm = await p.ev('window.__ppMapa');
    ok(mismo(dm.pines.map((x) => [x.id, x.n]), pinesEsperados(null).map((x) => [x.id, x.n])), 'los pines están numerados en el MISMO orden que ordenarPorCercania (la puerta sin coordenadas no tiene pin)', dm.pines.map((x) => [x.id, x.n]));
    ok(mismo(await p.ev(`Array.from(document.querySelectorAll('.pin-pp')).map((e) => e.textContent.trim())`), pinesEsperados(null).map((x) => String(x.n))), 'y los números dibujados son 1, 2, 3, 4');
    ok(mismo(await p.ev(`Array.from(document.querySelectorAll('#lista-servidor .caja-pp[data-item]')).map((e) => Number(e.dataset.item))`), esperada(null)), 'la lista está en el mismo orden que la ruta');
    ok(dm.linea.length === 4 && mismo(dm.linea, dm.pines.map((x) => [x.lat, x.lon])) && await p.ev(`document.querySelectorAll('#mapa-pp .leaflet-overlay-pane path').length >= 1`), 'la línea une los pines en orden (solo guía: sin calles)');
    ok(/Sin ubicación en el mapa/.test(await texto(`[data-item="${itM[4]}"]`) || '') && (await nombresEnPantalla()).pop().startsWith('Pilar'), 'la ficha sin coordenadas va al final de la lista con «Sin ubicación en el mapa»');
    // Un pin abre la MISMA ficha de la lista.
    const pin3 = dm.pines[2];
    await p.ev(`Array.from(document.querySelectorAll('.pin-pp')).find((e) => e.textContent.trim() === '3').click()`);
    await espera(500);
    ok(await p.ev(`(() => { const f = document.querySelector('#lista-servidor .caja-pp.sel'); return !!f && Number(f.dataset.item) === ${pin3.id} && !!f.querySelector('[data-resultado="no_abrio"]'); })()`), 'tocar un pin resalta su ficha en la lista (la misma, con sus botones de resultado)');
    await p.ev(`document.querySelector('#lista-servidor .caja-pp[data-item="${dm.pines[0].id}"] [data-ver-en-mapa]').click()`);
    await espera(300);
    ok(await p.ev(`document.querySelector('#lista-servidor .caja-pp.sel').dataset.item === '${dm.pines[0].id}' && document.querySelectorAll('.pin-pp.sel').length === 1 && document.querySelector('.pin-pp.sel').textContent.trim() === '1'`), 'y tocar el número de una ficha resalta su pin');
    ok(!(await p.ev(`document.documentElement.innerHTML`)).match(/google\.com\/maps|maps\.google|waze|geo:|maps\.apple/i) && (await p.ev(`document.querySelectorAll('a[href*="google"], a[href*="waze"], a[href^="geo:"], a[href*="maps.apple"]').length`)) === 0, 'sin botón de Google Maps ni de otra aplicación de navegación');
    // Las peticiones externas: solo teselas de «zoom/x/y».
    await espera(800);
    const ext1 = externas(desde0);
    ok(ext1.every((u) => tesela.test(u)), 'lo único que sale a la red son teselas (zoom/x/y): nada de la lista viaja al servidor de teselas', ext1.filter((u) => !tesela.test(u)));
    ok(!ext1.some((u) => /Calle|Pía|Pablo|Paula|Pedro|Pilar|%20/.test(u)), 'ni un nombre ni una dirección en ninguna petición externa');

    // «Mi ubicación».
    await p.cmd('Browser.grantPermissions', { permissions: ['geolocation'], origin: base });
    await p.cmd('Emulation.setGeolocationOverride', { latitude: 5.0801, longitude: -75.5201, accuracy: 20 });
    const n0 = p.peticiones.length;
    await clic('#btn-gps');
    await espera(1500);
    dm = await p.ev('window.__ppMapa');
    const inicio = { lat: 5.0801, lon: -75.5201 };
    ok(mismo(dm.pines.map((x) => [x.id, x.n]), pinesEsperados(inicio).map((x) => [x.id, x.n])) && dm.pines[0].id === itM[2], '«Mi ubicación» reordena la ruta desde ahí (la primera puerta es la más cercana) y los pines se renumeran', dm.pines.map((x) => x.id));
    ok(dm.linea.length === 5 && dm.linea[0][0] === 5.0801 && dm.linea[0][1] === -75.5201 && await p.ev(`!!document.querySelector('.leaflet-overlay-pane path.leaflet-interactive') || document.querySelectorAll('.leaflet-overlay-pane path').length >= 2`), 'la línea sale del punto de partida');
    const cuerpos2 = await p.ev('window.__cuerpos');
    ok(!cuerpos2.some((c) => /5\.080|75\.520/.test(c)) && !p.peticiones.slice(n0).some((u) => /5\.0801|75\.5201/.test(u)), 'la ubicación NO llegó al servidor: ni en un cuerpo de petición ni en ninguna URL');
    ok(!/5\.0801|75\.5201/.test(JSON.stringify(await idb('puerta_cache'))) && !/5\.0801|75\.5201/.test(await p.ev(`JSON.stringify(Object.assign({}, localStorage))`)), 'y no quedó guardada en el celular');

    // Sin señal: los pines y la línea se dibujan sobre un fondo liso y la lista sigue operando.
    await p.cmd('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await sinSenal(true);
    await espera(400);
    const sinTeselas = await p.ev(`document.querySelectorAll('#mapa-pp .leaflet-tile-pane img.leaflet-tile').length`);
    const nOff = p.peticiones.length;
    await p.ev('refrescar()');
    await espera(1200);
    dm = await p.ev('window.__ppMapa');
    ok(dm.pines.length === 4 && dm.linea.length === 5 && sinTeselas === 0, 'con la red cortada el mapa conserva los 4 pines numerados y la línea, y no tiene teselas', { pines: dm.pines.length, linea: dm.linea.length, sinTeselas });
    ok(await p.ev(`getComputedStyle(document.querySelector('#mapa-pp')).backgroundColor`) === 'rgb(230, 236, 243)', 'sobre un fondo liso');
    ok(!p.peticiones.slice(nOff).some((u) => tesela.test(u)), 'sin señal no se piden teselas');
    const primero = dm.pines[0].id;
    await clic(`[data-resultado="no_abrio"][data-id="${primero}"]`);
    await espera(1500);
    const colaOff = await idb('puerta_pendientes');
    dm = await p.ev('window.__ppMapa');
    ok(colaOff.some((r) => r.itemId === primero && String(r.usuarioId) === String(lid5)) && dm.pines.length === 3 && !dm.pines.some((x) => x.id === primero), 'y la lista sigue operando: el resultado queda en la cola y esa puerta sale de la ruta y del mapa');
    await p.cmd('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await sinSenal(false);
    await p.ev(`window.dispatchEvent(new Event('online'))`);
    await espera(2500);
    const colaVuelta = (await idb('puerta_pendientes')).filter((r) => r.itemId === primero);
    ok(colaVuelta.length === 0 && (await visitasDe(primero)).length === 1, 'al volver la señal sube sola', { colaVuelta, visitas: await visitasDe(primero) });

    // Mapbox cuando hay token.
    process.env.MAPBOX_ACCESS_TOKEN = 'pk.prueba123';
    const desde2 = p.peticiones.length;
    await ir('/app/puerta-a-puerta.html', 3500);
    await espera(800);
    const ext2 = externas(desde2);
    ok(ext2.length > 0 && ext2.every((u) => tesela.test(u)) && ext2.some((u) => u.startsWith('https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/')) && !ext2.some((u) => /tile\.openstreetmap\.org/.test(u)), 'con token, el fondo es Mapbox (la misma fuente del mapa territorial) y solo se piden teselas', ext2.slice(0, 3));
    delete process.env.MAPBOX_ACCESS_TOKEN;

    // Tareas y Solicitudes: el mismo Leaflet local.
    await entrarComo(admin);
    for (const [ruta, sel] of [['/tareas.html', '#mapa-tar'], ['/solicitudes.html', '#mapa-sol']]) {
      const d = p.peticiones.length;
      await ir(ruta, 3000);
      await clic('[data-vista="mapa"]');
      await espera(2500);
      const usadas = p.peticiones.slice(d);
      ok(await p.ev(`typeof L === 'object' && L.version === '1.9.4' && !!document.querySelector('${sel}.leaflet-container')`) && usadas.some((u) => u.endsWith('/vendor/leaflet/leaflet.js')) && !usadas.some((u) => /unpkg\.com/.test(u)), `${ruta}: el mapa carga el Leaflet local y no llama a unpkg`, usadas.filter((u) => /unpkg|leaflet/.test(u)));
    }

    ok(!p.avisos.length, 'ninguna excepción de JavaScript en la pantalla', p.avisos);
  } catch (e) {
    fallos++;
    console.log('  FALLA la prueba se cayó:', e && e.message);
  } finally {
    try { if (navegador) navegador.cerrar(); } catch (_) { /* ya cerrado */ }
    try { if (servidor) servidor.close(); } catch (_) { /* ya cerrado */ }
    await pool.end().catch(() => {});
  }
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})();
