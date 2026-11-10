#!/usr/bin/env node
// scripts/probar-complementos.js
//
// Prueba de ACTIVAR COMPLEMENTOS (parche 318), del lado del servidor y sobre las rutas REALES (scripts/capturas/servidor.js las monta):
//   · la tabla `complementos_campana`: nueve filas, TODAS apagadas de fábrica; correr `init-db` otra vez no apaga lo que se encendió;
//   · apagado = apagado para TODOS: administrador, superadministrador y coordinador reciben 403 { motivo: 'complemento_inactivo' } en los
//     nueve complementos (la ruta de cada uno), y sin sesión sigue siendo 401;
//   · encendido = cada rol según `permisos_rol`, como siempre (el interruptor no la toca);
//   · la dependencia: «Puerta a puerta panel» no se enciende sin «Puerta a puerta», y al apagar éste se apaga aquél;
//   · GET/PUT /api/complementos: solo administrador y superadministrador, validaciones, auditoría;
//   · /permisos/mios: quita los módulos del complemento apagado (administrador, superadministrador y aspirante) y trae `complementos`;
//   · las pantallas (HTML) y el enlace del conductor (/t/…): «Este complemento no está activo», 403, sin guardar en el service worker;
//   · lo automático: las alertas dejan de calcular el tipo de un complemento apagado, los avisos y el reloj de tareas no corren, los
//     recordatorios no generan; LA RETENCIÓN DE DATOS SIGUE corriendo;
//   · el resumen del Panel no trae `finanzas` (la clave se quita del JSON), las tarjetas y los manuales no salen;
//   · el «necesita transporte» de Faltantes y de Votantes responde 403 con Transporte apagado;
//   · se FALLA CERRADO: sin la tabla, todo cuenta como apagado.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada318 node scripts/probar-complementos.js
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
process.env.COMPLEMENTOS_CACHE_MS = '0';          // aquí se enciende y se apaga en el mismo proceso: sin caché (la caché se prueba aparte)

const fs = require('fs');
const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');
const { spawnSync } = require('child_process');
const pool = require('../config/db');
const C = require('../lib/complementos');
const { crear } = require('./capturas/servidor');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }
const raiz = path.join(__dirname, '..');
const sello = String(Date.now()).slice(-7);
let n = 0;
async function persona(nombre, rol) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, `95${sello}${n}`, `u95${sello}${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  return r.insertId;
}

const TODAS = C.CLAVES;
async function apagarTodas() { await q('UPDATE complementos_campana SET activo = 0'); C.invalidar(); }
async function encender(...claves) { for (const c of claves) await C.guardar(c, true, null); }

(async () => {
  let servidor;
  try {
    console.log('ACTIVAR COMPLEMENTOS — base «' + nombreBase + '»\n');
    await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
    const [sup] = await q('SELECT id FROM usuarios WHERE es_superadmin = 1 LIMIT 1');
    if (!sup) throw new Error('la base de prueba no tiene superadministrador (¿corrió init-db?)');
    const superadmin = sup.id;
    const admin = await persona('Admin Ejemplo', 'admin');
    const coord = await persona('Coord Ejemplo', 'coordinador');
    const lider = await persona('Lider Ejemplo', 'lider');
    const sublider = await persona('Sublider Ejemplo', 'sublider');

    const app = crear(pool);
    servidor = http.createServer(app);
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    const puerto = servidor.address().port;
    const pedir = (metodo, ruta, { quien, json } = {}) => new Promise((resolve, reject) => {
      const h = { 'X-Forwarded-For': '198.51.100.9' };
      let cuerpo;
      if (quien) h.Cookie = `ej_usuario=${quien}`;
      if (json !== undefined) { h['Content-Type'] = 'application/json'; cuerpo = JSON.stringify(json); }
      const r = http.request({ host: '127.0.0.1', port: puerto, path: ruta, method: metodo, headers: h }, (x) => {
        let d = ''; x.on('data', (c) => { d += c; });
        x.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (_) { /* no es JSON */ } resolve({ status: x.statusCode, json: j, texto: d, cabeceras: x.headers }); });
      });
      r.on('error', reject);
      if (cuerpo) r.write(cuerpo);
      r.end();
    });
    const cerrada = (r) => r.status === 403 && r.json && r.json.motivo === 'complemento_inactivo';

    // Una ruta REAL de cada complemento (la puerta es del router entero: cualquiera sirve) y una que el administrador abre estando encendido.
    const RUTAS = {
      solicitudes: ['GET', '/api/solicitudes/categorias'],
      tareas: ['GET', '/api/tareas/resumen'],
      puerta_a_puerta: ['GET', '/api/puerta-a-puerta/config'],
      puerta_panel: ['GET', '/api/puerta-a-puerta/panel'],
      alertas_dia_d: ['GET', '/api/dia-d/alertas/mis-avisos'],
      resultados_dia_d: ['GET', '/api/dia-d/resultados/pendientes'],
      transporte_dia_d: ['GET', '/api/dia-d/transporte/contexto'],
      logistica_dia_d: ['GET', '/api/dia-d/logistica/contexto'],
      finanzas: ['GET', '/api/finanzas/categorias'],
    };

    /* ------------------------------------------------------------------------------------------------------------------------ 1 */
    console.log('[1] La tabla: nueve filas, todas apagadas de fábrica');
    await apagarTodas();
    const filas = await q('SELECT clave, activo FROM complementos_campana ORDER BY clave');
    ok(filas.length === 9 && TODAS.every((c) => filas.some((f) => f.clave === c)), 'hay una fila por complemento (nueve)', filas.map((f) => f.clave));
    ok(filas.every((f) => Number(f.activo) === 0), 'todas apagadas');
    ok(JSON.stringify(Object.values(await C.complementosActivos()).filter(Boolean)) === '[]', 'complementosActivos() dice false en los nueve');
    ok(!(await C.complementoActivo('no_existe')), 'una clave que no existe cuenta como apagada (y no rompe)');

    // init-db otra vez NO apaga lo encendido. Se borran las credenciales que el propio init-db deja, SOLO si son de hoy.
    await q("UPDATE complementos_campana SET activo = 1, actualizado_por = ? WHERE clave = 'tareas'", [admin]);
    const credenciales = ['.credenciales-admin.txt', '.credenciales-superadmin.txt'].map((f) => path.join(raiz, f));
    credenciales.forEach((f) => { try { if (Date.now() - fs.statSync(f).mtimeMs < 12 * 3600 * 1000) fs.unlinkSync(f); } catch (_) { /* no existe */ } });
    const corrida = spawnSync(process.execPath, ['db/init-db.js'], { cwd: raiz, env: process.env, encoding: 'utf8' });
    credenciales.forEach((f) => { try { fs.unlinkSync(f); } catch (_) { /* no se creó */ } });
    const despues = await q("SELECT activo, actualizado_por FROM complementos_campana WHERE clave = 'tareas'");
    ok(corrida.status === 0, 'init-db corre otra vez sin error', (corrida.stderr || '').slice(-200));
    ok(Number(despues[0].activo) === 1 && despues[0].actualizado_por === admin, 'init-db NO apagó lo que estaba encendido ni cambió quién lo encendió');
    ok((await q('SELECT COUNT(*) AS n FROM complementos_campana'))[0].n === 9, 'y sigue habiendo nueve filas');
    await apagarTodas();

    /* ------------------------------------------------------------------------------------------------------------------------ 2 */
    console.log('\n[2] Apagado = apagado para TODOS (también administrador y superadministrador)');
    for (const [clave, [metodo, ruta]] of Object.entries(RUTAS)) {
      for (const [quien, id] of [['administrador', admin], ['superadministrador', superadmin], ['coordinador', coord]]) {
        const r = await pedir(metodo, ruta, { quien: id });
        ok(cerrada(r) && r.json.complemento === clave || (clave === 'puerta_panel' && cerrada(r)),
          `${clave} · ${quien}: 403 complemento_inactivo`, { status: r.status, json: r.json });
      }
      const sin = await pedir(metodo, ruta);
      ok(sin.status === 401, `${clave} · sin sesión: sigue siendo 401`, sin.status);
    }
    {
      const r = await pedir('GET', RUTAS.solicitudes[1], { quien: admin });
      ok(r.json && r.json.error === 'Este complemento no está activo.', 'el texto del error dice «Este complemento no está activo.»', r.json);
    }
    // Las dos rutas de privacidad del puerta a puerta quedan como están (decisión h).
    const pol = await pedir('GET', '/api/puerta-a-puerta/politica', { quien: admin });
    ok(!cerrada(pol), 'GET /api/puerta-a-puerta/politica NO se cierra (es de privacidad)', pol.status);
    const per = await pedir('POST', '/api/puerta-a-puerta/votantes/999999/permitir-visitas', { quien: admin, json: {} });
    ok(!cerrada(per), 'POST …/permitir-visitas NO se cierra (responde 400/404 por el votante, no por el complemento)', { status: per.status, json: per.json });
    // La jornada del Día D (GET/PUT /config) NO se cierra con Alertas apagado: la leen Logística, los recordatorios, el check-in y la cobertura.
    const cfg = await pedir('GET', '/api/dia-d/alertas/config', { quien: admin });
    ok(!cerrada(cfg) && cfg.status === 200, 'GET /api/dia-d/alertas/config (la jornada) sigue abierta con Alertas apagado', { status: cfg.status });

    /* ------------------------------------------------------------------------------------------------------------------------ 3 */
    console.log('\n[3] Encendido = cada rol según la matriz, como siempre');
    await q("DELETE FROM permisos_rol WHERE rol = 'lider' AND modulo = 'tareas'");
    await encender('tareas', 'solicitudes', 'finanzas');
    for (const [clave, [metodo, ruta]] of Object.entries(RUTAS).filter(([c]) => ['tareas', 'solicitudes', 'finanzas'].includes(c))) {
      const a = await pedir(metodo, ruta, { quien: admin });
      ok(a.status === 200, `${clave} encendido · el administrador entra (200)`, { status: a.status, json: a.json });
      const s = await pedir(metodo, ruta, { quien: superadmin });
      ok(s.status === 200, `${clave} encendido · el superadministrador entra (200)`, s.status);
    }
    const cT = await pedir('GET', RUTAS.tareas[1], { quien: coord });
    ok(cT.status === 403 && !cerrada(cT), 'tareas encendido · el coordinador sigue SIN acceso: la matriz de fábrica solo abre el administrador (403 de permisos, no del complemento)', { status: cT.status, json: cT.json });
    const cF = await pedir('GET', RUTAS.finanzas[1], { quien: coord });
    ok(cF.status === 200, 'finanzas encendido · el coordinador entra (su rol ya lo dejaba)', cF.status);
    const lF = await pedir('GET', RUTAS.finanzas[1], { quien: lider });
    ok(lF.status === 403 && !cerrada(lF), 'finanzas encendido · el líder sigue fuera (requireRole, como hoy)', { status: lF.status });
    // Abrir la matriz a otro rol sigue funcionando exactamente igual.
    await q("INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES ('coordinador', 'tareas', 1, 1, 1) ON DUPLICATE KEY UPDATE permitido = 1, editar = 1, agregar = 1");
    const cT2 = await pedir('GET', RUTAS.tareas[1], { quien: coord });
    ok(cT2.status === 200, 'tareas encendido y la matriz abierta al coordinador · entra (el interruptor no toca la matriz)', cT2.status);
    await apagarTodas();
    const cT3 = await pedir('GET', RUTAS.tareas[1], { quien: coord });
    ok(cerrada(cT3), 'apagado otra vez, aunque la matriz diga que sí · 403 complemento_inactivo', { status: cT3.status });
    await q("UPDATE permisos_rol SET permitido = 0, editar = 0, agregar = 0 WHERE rol = 'coordinador' AND modulo = 'tareas'");

    /* ------------------------------------------------------------------------------------------------------------------------ 4 */
    console.log('\n[4] La dependencia: el panel necesita Puerta a puerta');
    const aP = await pedir('PUT', '/api/complementos/puerta_panel', { quien: admin, json: { activo: true } });
    ok(aP.status === 409 && /necesita/.test((aP.json || {}).error || ''), 'encender el panel con Puerta a puerta apagado se rechaza (409)', { status: aP.status, json: aP.json });
    ok(!(await C.complementoActivo('puerta_panel')), 'y el panel sigue apagado');
    await encender('puerta_a_puerta');
    const rp = await pedir('GET', RUTAS.puerta_panel[1], { quien: admin });
    ok(cerrada(rp) && rp.json.complemento === 'puerta_panel', 'Puerta a puerta encendido y panel apagado: /panel responde 403 del complemento «puerta_panel»', { status: rp.status, json: rp.json });
    const rl = await pedir('GET', '/api/puerta-a-puerta/listas', { quien: admin });
    ok(rl.status === 200, 'y el resto del puerta a puerta (las listas) sí abre', rl.status);
    const pe = await pedir('GET', '/api/puerta-a-puerta/panel/exportar', { quien: admin });
    ok(cerrada(pe), '/panel/exportar también queda bajo puerta_panel', pe.status);
    const aP2 = await pedir('PUT', '/api/complementos/puerta_panel', { quien: admin, json: { activo: true } });
    ok(aP2.status === 200 && aP2.json.ok, 'con Puerta a puerta encendido, el panel se enciende');
    const rp2 = await pedir('GET', RUTAS.puerta_panel[1], { quien: admin });
    ok(!cerrada(rp2), 'y /panel abre', { status: rp2.status });
    const ap = await pedir('PUT', '/api/complementos/puerta_a_puerta', { quien: admin, json: { activo: false } });
    ok(ap.status === 200 && ap.json.cambiadas.includes('puerta_panel') && ap.json.cambiadas.includes('puerta_a_puerta'), 'apagar Puerta a puerta apaga también el panel', ap.json);
    ok((await q("SELECT activo FROM complementos_campana WHERE clave = 'puerta_panel'"))[0].activo === 0, 'la fila del panel quedó en 0');
    // Si alguien dejó el panel en 1 y Puerta a puerta en 0 (a mano), el panel cuenta como apagado.
    await q("UPDATE complementos_campana SET activo = 1 WHERE clave = 'puerta_panel'"); C.invalidar();
    ok(!(await C.complementoActivo('puerta_panel')), 'con la fila del panel en 1 pero Puerta a puerta en 0, el panel cuenta como APAGADO');
    await apagarTodas();

    /* ------------------------------------------------------------------------------------------------------------------------ 5 */
    console.log('\n[5] GET/PUT /api/complementos');
    const g = await pedir('GET', '/api/complementos', { quien: admin });
    ok(g.status === 200 && g.json.complementos.length === 9, 'el administrador lista los nueve', g.status);
    ok(g.json.complementos.every((c) => c.nombre && c.descripcion && c.activo === false && c.efectivo === false), 'cada uno con nombre, descripción y estado apagado');
    const pp = g.json.complementos.find((c) => c.clave === 'puerta_panel');
    ok(pp.depende === 'puerta_a_puerta', 'el panel declara de quién depende', pp);
    ok('transporte_sin_cerrar' in g.json, 'la respuesta trae el conteo de transporte sin cerrar de hoy', Object.keys(g.json));
    const gs = await pedir('GET', '/api/complementos', { quien: superadmin });
    ok(gs.status === 200, 'el superadministrador también');
    for (const [quien, id] of [['coordinador', coord], ['líder', lider], ['sublíder', sublider]]) {
      const r = await pedir('GET', '/api/complementos', { quien: id });
      ok(r.status === 403, `el ${quien} no puede consultarlo (403)`, r.status);
      const w = await pedir('PUT', '/api/complementos/finanzas', { quien: id, json: { activo: true } });
      ok(w.status === 403, `el ${quien} no puede encender nada (403)`, w.status);
    }
    ok((await pedir('GET', '/api/complementos')).status === 401, 'sin sesión: 401');
    ok((await pedir('PUT', '/api/complementos/nada', { quien: admin, json: { activo: true } })).status === 404, 'un complemento que no existe: 404');
    ok((await pedir('PUT', '/api/complementos/finanzas', { quien: admin, json: { activo: 'si' } })).status === 400, '«activo» que no es true/false: 400');
    ok((await pedir('PUT', '/api/complementos/finanzas', { quien: admin, json: {} })).status === 400, 'sin «activo»: 400');
    const antes = (await q('SELECT COUNT(*) AS n FROM auditoria'))[0].n;
    const w1 = await pedir('PUT', '/api/complementos/finanzas', { quien: admin, json: { activo: true } });
    ok(w1.status === 200 && w1.json.cambiadas.length === 1, 'el administrador enciende Finanzas', w1.json);
    const fila = (await q("SELECT activo, actualizado_por, actualizado_en FROM complementos_campana WHERE clave = 'finanzas'"))[0];
    ok(Number(fila.activo) === 1 && fila.actualizado_por === admin && fila.actualizado_en, 'se guardó quién y cuándo');
    ok((await q('SELECT COUNT(*) AS n FROM auditoria'))[0].n === antes + 1, 'y quedó en la auditoría');
    const aud = (await q("SELECT accion, detalle FROM auditoria WHERE accion = 'complemento_encender' ORDER BY id DESC LIMIT 1"))[0];
    ok(aud && /Finanzas/.test(aud.detalle), 'con el nombre del complemento', aud);
    const w2 = await pedir('PUT', '/api/complementos/finanzas', { quien: admin, json: { activo: true } });
    ok(w2.status === 200 && w2.json.cambiadas.length === 0, 'encender lo que ya estaba encendido no cambia ni audita nada');
    const w3 = await pedir('PUT', '/api/complementos/finanzas', { quien: superadmin, json: { activo: false } });
    ok(w3.status === 200 && !(await C.complementoActivo('finanzas')), 'el superadministrador lo apaga');
    ok((await q("SELECT accion FROM auditoria WHERE accion = 'complemento_apagar' ORDER BY id DESC LIMIT 1")).length === 1, 'y también se audita');

    /* ------------------------------------------------------------------------------------------------------------------------ 6 */
    console.log('\n[6] /permisos/mios: los módulos del complemento apagado salen para todos');
    const MODS = ['solicitudes', 'tareas', 'puerta_listas', 'puerta_visitas', 'alertas_dia_d', 'resultados_dia_d', 'transporte_dia_d', 'logistica_dia_d', 'finanzas'];
    await apagarTodas();
    for (const [quien, id] of [['administrador', admin], ['superadministrador', superadmin], ['coordinador', coord], ['líder', lider], ['sublíder', sublider]]) {
      const r = await pedir('GET', '/api/permisos/mios', { quien: id });
      ok(r.status === 200 && MODS.every((m) => !r.json.modulos.includes(m)), `${quien}: ninguno de los 9 módulos en «modulos»`, r.json && r.json.modulos);
      ok(MODS.every((m) => !r.json.permisos[m] || r.json.permisos[m].ver === false), `${quien}: la casilla «ver» de esos módulos es false (no falta: puedeVer() diría que sí)`, r.json.permisos);
      ok(r.json.complementos && TODAS.every((c) => r.json.complementos[c] === false), `${quien}: trae «complementos» con los nueve en false`, r.json.complementos);
    }
    {
      const r = await pedir('GET', '/api/permisos/mios', { quien: superadmin });
      ok(MODS.every((m) => r.json.permisos[m] && r.json.permisos[m].ver === false), 'el superadministrador (que lo tiene todo en verde) recibe false en los módulos apagados, no los omite');
      ok(r.json.modulos.includes('configuracion') && r.json.modulos.includes('panel_general'), 'y conserva el resto de su menú');
    }
    await encender('finanzas', 'puerta_a_puerta');
    {
      const a = await pedir('GET', '/api/permisos/mios', { quien: admin });
      ok(a.json.modulos.includes('finanzas') && a.json.modulos.includes('puerta_listas') && a.json.modulos.includes('puerta_visitas'), 'encendidos Finanzas y Puerta a puerta: sus módulos vuelven para el administrador');
      ok(!a.json.modulos.includes('tareas') && a.json.complementos.finanzas === true && a.json.complementos.tareas === false, 'y solo esos');
      const c = await pedir('GET', '/api/permisos/mios', { quien: coord });
      ok(c.json.modulos.includes('finanzas'), 'el coordinador ve Finanzas encendido (su fila lo permite)');
      const l = await pedir('GET', '/api/permisos/mios', { quien: lider });
      ok(!l.json.modulos.includes('finanzas'), 'el líder no (su fila no lo permite): el interruptor no le da nada a nadie');
    }
    // El aspirante tiene listas FIJAS: se prueba la función directamente, con una sublicencia simulada.
    {
      const { permisosDeSesion } = require('../routes/permisos.routes');
      const req = { session: { usuario: { id: lider, rol: 'lider' } }, sublicencia: { usuario_id: lider, cargo: 'concejo' } };
      await apagarTodas();
      const off = await permisosDeSesion(req);
      const DIAD = ['alertas_dia_d', 'resultados_dia_d', 'transporte_dia_d', 'logistica_dia_d'];
      ok(DIAD.every((m) => !off.modulos.includes(m)), 'ASPIRANTE con los complementos apagados: sin los cuatro módulos del Día D', off.modulos);
      ok(!off.hrefs.some((h) => /alertas|#resultados|#transporte|#logistica/.test(h)), 'y su lista de direcciones pierde sus pestañas', off.hrefs);
      ok(off.hrefs.includes('/dia-d.html') && off.hrefs.includes('/dia-d.html#avance'), 'pero conserva la Jornada y el Avance (no son complementos)');
      await encender('alertas_dia_d', 'transporte_dia_d');
      const on = await permisosDeSesion(req);
      ok(on.modulos.includes('alertas_dia_d') && on.modulos.includes('transporte_dia_d') && !on.modulos.includes('resultados_dia_d'), 'encendidos Alertas y Transporte, el aspirante los recupera');
      ok(on.hrefs.includes('/dia-d.html#alertas') && on.hrefs.includes('/dia-d.html#transporte') && !on.hrefs.includes('/dia-d.html#resultados'), 'y sus direcciones');
    }
    await apagarTodas();

    /* ------------------------------------------------------------------------------------------------------------------------ 7 */
    console.log('\n[7] Las pantallas y el enlace del conductor');
    const PAGINAS = [['/solicitudes.html', 'solicitudes'], ['/app/solicitud-nueva.html', 'solicitudes'], ['/app/mis-solicitudes.html', 'solicitudes'],
      ['/tareas.html', 'tareas'], ['/app/mis-tareas.html', 'tareas'], ['/puerta-listas.html', 'puerta_a_puerta'], ['/app/puerta-a-puerta.html', 'puerta_a_puerta'],
      ['/puerta-panel.html', 'puerta_panel'], ['/app/alertas-dia-d.html', 'alertas_dia_d'], ['/app/logistica.html', 'logistica_dia_d'], ['/finanzas.html', 'finanzas']];
    for (const [ruta] of PAGINAS) {
      const r = await pedir('GET', ruta, { quien: admin });
      ok(r.status === 403 && /Este complemento no está activo/.test(r.texto) && /text\/html/.test(r.cabeceras['content-type']), `${ruta} (administrador): «Este complemento no está activo»`, { status: r.status });
      ok(/Activar complementos/.test(r.texto), `${ruta} (administrador): con el enlace a Activar complementos`);
    }
    {
      const r = await pedir('GET', '/solicitudes.html', { quien: coord });
      ok(r.status === 403 && /Este complemento no está activo/.test(r.texto) && !/Activar complementos/.test(r.texto), 'el coordinador ve el mensaje, sin el enlace a Activar complementos');
      const a = await pedir('GET', '/app/mis-tareas.html', { quien: lider });
      ok(/href="\/app\/inicio\.html"/.test(a.texto), 'en /app el botón vuelve al inicio del celular');
      ok(/no-store/.test(a.cabeceras['cache-control'] || ''), 'la respuesta lleva Cache-Control: no-store');
      const ok2 = await pedir('GET', '/dia-d.html', { quien: admin });
      ok(ok2.status === 200, 'la Jornada electoral (dia-d.html) NO se cierra: sus pestañas las esconde ella misma');
      const login = await pedir('GET', '/login.html');
      ok(login.status === 200, 'y el resto de páginas, como siempre');
    }
    await encender('solicitudes');
    {
      const r = await pedir('GET', '/solicitudes.html', { quien: admin });
      ok(r.status === 200 && /Solicitudes ciudadanas/.test(r.texto) && !/Este complemento no está activo/.test(r.texto), 'encendido: /solicitudes.html sirve la pantalla de verdad');
    }
    // El enlace del conductor
    await apagarTodas();
    {
      const pag = await pedir('GET', '/t/ABCD2345');
      ok(pag.status === 403 && /Este complemento no está activo/.test(pag.texto) && !/Lista de recogida/.test(pag.texto), '/t/<código>: la página «Este complemento no está activo» (sin datos)', { status: pag.status });
      const lista = await pedir('GET', '/t/ABCD2345/lista');
      ok(lista.status === 403 && lista.json && lista.json.motivo === 'complemento_inactivo', '/t/<código>/lista: 403 en JSON, sin datos', { status: lista.status, json: lista.json });
      const marca = await pedir('POST', '/t/ABCD2345/marcar', { json: {} });
      ok(marca.status === 403 && marca.json && marca.json.motivo === 'complemento_inactivo', '/t/<código>/marcar: 403 en JSON');
    }
    await encender('transporte_dia_d');
    {
      const pag = await pedir('GET', '/t/ABCD2345');
      ok(/Este enlace no está activo/.test(pag.texto) && !/Este complemento no está activo/.test(pag.texto), 'encendido, /t/<código> vuelve a su comportamiento de siempre (código inexistente: «Este enlace no está activo»)', { status: pag.status });
    }
    await apagarTodas();

    /* ------------------------------------------------------------------------------------------------------------------------ 8 */
    console.log('\n[8] Lo automático');
    {
      // Alertas: cada tipo sale solo si su complemento de origen está encendido.
      const { calcularAlertas } = require('../lib/alertasDiaD');
      const peticion = { session: { usuario: { id: 0, rol: 'admin' } }, sublicencia: null, alcance: { cargo: 'madre' } };
      const tipos = async () => (await calcularAlertas(peticion)).tipos.map((t) => t.tipo);
      const todos = ['mesa_sin_testigo', 'testigo_no_llego', 'mesa_sin_e14', 'reporte_con_alertas', 'diferencia_con_oficial', 'baja_votacion', 'transporte_sin_recoger', 'logistica_sin_entregar'];
      let t0 = await tipos();
      ok(!t0.includes('diferencia_con_oficial') && !t0.includes('transporte_sin_recoger') && !t0.includes('logistica_sin_entregar'), 'con los tres apagados: sin las alertas 5 (Resultados), 7 (Transporte) y 8 (Logística)', t0);
      ok(['mesa_sin_testigo', 'testigo_no_llego', 'mesa_sin_e14', 'reporte_con_alertas', 'baja_votacion'].every((x) => t0.includes(x)), 'las demás (1 a 4 y 6) siguen, no dependen de ningún complemento', t0);
      await encender('transporte_dia_d');
      let t1 = await tipos();
      ok(t1.includes('transporte_sin_recoger') && !t1.includes('logistica_sin_entregar') && !t1.includes('diferencia_con_oficial'), 'encendido solo Transporte: vuelve su alerta y solo esa', t1);
      await encender('logistica_dia_d', 'resultados_dia_d');
      let t2 = await tipos();
      ok(todos.every((x) => t2.includes(x)), 'encendidos los tres: salen los ocho tipos', t2);
      await apagarTodas();

      // Los avisos push: con Alertas apagado no corre nada.
      const avisos = require('../lib/avisosAlertas');
      const v = await avisos.vuelta();
      ok(v.omitida === 'complemento_apagado', 'avisosAlertas.vuelta() con Alertas apagado: omitida «complemento_apagado»', v);
      await encender('alertas_dia_d');
      const v2 = await avisos.vuelta();
      ok(v2.omitida !== 'complemento_apagado', 'con Alertas encendido, la vuelta sigue su camino de siempre (otro motivo: ventana, push…)', v2);
      await apagarTodas();

      // El reloj de las tareas.
      const reloj = require('../lib/tareasMantenimiento');
      const p0 = await reloj.pasada();
      ok(p0 && p0.apagado === true, 'tareasMantenimiento.pasada() con Tareas apagado: no hace nada', p0);
      await encender('tareas');
      const p1 = await reloj.pasada();
      ok(p1 && !p1.apagado && 'metas' in p1, 'con Tareas encendido corre (cierra metas y revisa reasignaciones)', p1);
      await apagarTodas();

      // La RETENCIÓN sigue.
      const mant = require('../lib/solicitudesMantenimiento');
      mant.reiniciarMemoria();
      const m = await mant.vueltaDiaria({ forzar: true });
      ok(m && m.corrio === true && m.resultado && 'tareas' in m && 'puerta' in m, 'la vuelta diaria de retención (solicitudes, fotos de tareas, puerta a puerta) CORRE con los tres apagados', m && { corrio: m.corrio });
      ok(!/complemento/.test(String(m.motivo || '')), 'y no se salta por el complemento');
    }
    {
      // Recordatorios
      const R = require('../lib/recordatorios');
      let est = await R.estado();
      ok(!est.tipos.some((t) => t.clave === 'solicitud_sin_movimiento') && !est.tipos.some((t) => t.clave === 'tarea_vence'), 'Recordatorios: los tipos de Solicitudes y Tareas no se ofrecen con los complementos apagados', est.tipos.map((t) => t.clave));
      ok(est.tipos.some((t) => t.clave === 'evento'), 'los demás tipos (evento…) siguen');
      const c1 = await R.TIPOS.solicitud_sin_movimiento.candidatos({ regla: { canal: 'push', id: 0 }, ahora: new Date() });
      const c2 = await R.TIPOS.tarea_vence.candidatos({ regla: { canal: 'push', id: 0, desfase_min: -60 }, ahora: new Date() });
      ok(Array.isArray(c1) && c1.length === 0 && Array.isArray(c2) && c2.length === 0, 'y sus fuentes de candidatos no generan nada');
      await encender('solicitudes', 'tareas');
      est = await R.estado();
      ok(est.tipos.some((t) => t.clave === 'solicitud_sin_movimiento') && est.tipos.some((t) => t.clave === 'tarea_vence'), 'encendidos, vuelven a ofrecerse');
      await apagarTodas();
    }

    /* ------------------------------------------------------------------------------------------------------------------------ 9 */
    console.log('\n[9] Finanzas en el Panel, tarjeta del líder, Faltantes y manuales');
    {
      const r0 = await pedir('GET', '/api/dashboard/resumen', { quien: admin });
      ok(r0.status === 200 && !('finanzas' in r0.json), '/dashboard/resumen con Finanzas apagado: la clave `finanzas` NO viene en el JSON', r0.status === 200 ? Object.keys(r0.json) : r0.status);
      await encender('finanzas');
      const r1 = await pedir('GET', '/api/dashboard/resumen', { quien: admin });
      ok(r1.status === 200 && r1.json.finanzas && 'balance' in r1.json.finanzas, 'con Finanzas encendido sí trae finanzas {ingresos, gastos, balance}', r1.json && r1.json.finanzas);
      const r2 = await pedir('GET', '/api/dashboard/resumen', { quien: lider });
      ok(!(r2.json && 'finanzas' in r2.json), 'y a un líder no, como siempre');
      await apagarTodas();

      // Tarjeta «mis tareas» del panel del líder
      await q("INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES ('lider', 'tareas', 1, 0, 0) ON DUPLICATE KEY UPDATE permitido = 1");
      const pl0 = await pedir('GET', '/api/panel-lider', { quien: lider });
      ok(pl0.status === 200 && (pl0.json.tareas === null || pl0.json.tareas === undefined), 'panel del líder: la tarjeta «mis tareas» NO se manda con Tareas apagado, aunque la matriz se la dé', pl0.status === 200 ? pl0.json.tareas : pl0.status);
      await encender('tareas');
      const pl1 = await pedir('GET', '/api/panel-lider', { quien: lider });
      ok(pl1.status === 200 && pl1.json.tareas, 'con Tareas encendido la tarjeta viene', pl1.json && pl1.json.tareas);
      await q("UPDATE permisos_rol SET permitido = 0 WHERE rol = 'lider' AND modulo = 'tareas'");
      await apagarTodas();

      // «Necesita transporte»
      const f0 = await pedir('GET', '/api/dia-d/rescate/faltantes?filtro=transporte', { quien: admin });
      ok(cerrada(f0) && f0.json.complemento === 'transporte_dia_d', 'Faltantes: el filtro «Necesitan transporte» responde 403 con Transporte apagado', { status: f0.status, json: f0.json });
      const f0b = await pedir('GET', '/api/dia-d/rescate/faltantes?filtro=faltan', { quien: admin });
      ok(f0b.status === 200 && f0b.json.puestos !== undefined, 'pero el resto de Faltantes sigue igual (200)', f0b.status);
      const t0 = await pedir('POST', '/api/dia-d/rescate/transporte', { quien: admin, json: { votante_id: 1, necesita: true } });
      ok(cerrada(t0), 'POST /dia-d/rescate/transporte: 403 complemento_inactivo', { status: t0.status });
      const t1 = await pedir('PUT', '/api/votantes/1/transporte', { quien: admin, json: { necesita: true } });
      ok(cerrada(t1), 'PUT /votantes/:id/transporte: 403 complemento_inactivo', { status: t1.status });
      await encender('transporte_dia_d');
      const t2 = await pedir('POST', '/api/dia-d/rescate/transporte', { quien: admin, json: { votante_id: 987654321, necesita: true } });
      ok(!cerrada(t2) && t2.status === 403 && /no está entre tus votantes/.test((t2.json || {}).error || ''), 'encendido: la ruta responde por el votante, no por el complemento', { status: t2.status, json: t2.json });
      const t3 = await pedir('PUT', '/api/votantes/987654321/transporte', { quien: admin, json: { necesita: true } });
      ok(!cerrada(t3) && t3.status === 404, 'encendido: PUT /votantes/:id/transporte responde 404 (el votante no existe), no 403 del complemento', { status: t3.status });
      await apagarTodas();

      // Manuales
      const ids = async (quien) => {
        const r = await pedir('GET', '/api/manuales/mio', { quien });
        const bloques = [];
        (r.json.secciones || []).forEach((s) => s.bloques.forEach((b) => bloques.push(b.id)));
        (r.json.faq || []).forEach((b) => bloques.push(b.id));
        (r.json.glosario || []).forEach((b) => bloques.push(b.id));
        return { bloques, r };
      };
      let man = await ids(admin);
      const DE_COMPLEMENTOS = ['mod-solicitudes', 'mod-tareas', 'mod-puerta_listas', 'mod-puerta_visitas', 'mod-alertas_dia_d', 'mod-resultados_dia_d', 'mod-transporte_dia_d', 'mod-logistica_dia_d', 'mod-finanzas',
        't-transporte-marcar', 'f-necesita-transporte', 't-solicitud-registrar', 't-finanzas-agregar', 't-puerta-armar', 'g-alerta-dia-d', 't-resultados-paquete', 't-logistica-plan', 't-tarea-asignar'];
      ok(man.r.status === 200 && DE_COMPLEMENTOS.every((b) => !man.bloques.includes(b)), 'Manuales (administrador): ningún bloque de un complemento apagado', DE_COMPLEMENTOS.filter((b) => man.bloques.includes(b)));
      ok(man.bloques.includes('t-activar-complementos') && man.bloques.includes('mod-votantes'), 'y siguen los demás, con el de «Activar complementos»', man.bloques.length);
      await encender('transporte_dia_d', 'finanzas', 'solicitudes');
      man = await ids(admin);
      ok(['mod-transporte_dia_d', 't-transporte-marcar', 'f-necesita-transporte', 'mod-finanzas', 'mod-solicitudes'].every((b) => man.bloques.includes(b)), 'encendidos Transporte, Finanzas y Solicitudes: sus bloques vuelven (también los que van por otro módulo y declaran `complemento:`)');
      ok(!man.bloques.includes('mod-tareas') && !man.bloques.includes('mod-logistica_dia_d'), 'y los de los que siguen apagados no');
      await apagarTodas();
    }

    /* ----------------------------------------------------------------------------------------------------------------------- 10 */
    console.log('\n[10] Matriz de permisos: los módulos apagados se muestran, en gris');
    {
      const m = await pedir('GET', '/api/permisos/matriz', { quien: admin });
      ok(m.status === 200 && m.json.complementos_apagados && m.json.complementos_apagados.solicitudes === 'Solicitudes ciudadanas' && m.json.complementos_apagados.puerta_listas === 'Puerta a puerta',
        'GET /permisos/matriz trae `complementos_apagados` con el nombre del complemento de cada módulo', m.json && m.json.complementos_apagados);
      ok(m.json.modulos.some((x) => x.clave === 'solicitudes'), 'y la fila del módulo SIGUE en la matriz (no se esconde)');
      await encender('solicitudes');
      const m2 = await pedir('GET', '/api/permisos/matriz', { quien: admin });
      ok(!('solicitudes' in m2.json.complementos_apagados) && 'tareas' in m2.json.complementos_apagados, 'encendido, el módulo deja de estar marcado');
      await apagarTodas();
    }

    /* ----------------------------------------------------------------------------------------------------------------------- 11 */
    console.log('\n[11] Falla cerrado y la caché');
    {
      await encender('finanzas');
      ok(await C.complementoActivo('finanzas'), 'Finanzas encendido');
      await q('RENAME TABLE complementos_campana TO complementos_campana_x');
      try {
        ok(!(await C.complementoActivo('finanzas')), 'SIN la tabla, Finanzas cuenta como APAGADO (no lanza)');
        const r = await pedir('GET', RUTAS.finanzas[1], { quien: admin });
        ok(cerrada(r), 'y la ruta responde 403 complemento_inactivo, también al administrador', { status: r.status });
        const mi = await pedir('GET', '/api/permisos/mios', { quien: admin });
        ok(mi.status === 200 && mi.json.complementos.finanzas === false && !mi.json.modulos.includes('finanzas'), '/permisos/mios sigue respondiendo (200) con todo apagado', { status: mi.status });
      } finally {
        await q('RENAME TABLE complementos_campana_x TO complementos_campana');
      }
      C.invalidar();
      ok(await C.complementoActivo('finanzas'), 'al volver la tabla vuelve el estado real (el fallo no se guardó)');
      await apagarTodas();

      // La caché: módulo aparte, con 60 s de vida.
      delete require.cache[require.resolve('../lib/complementos')];
      process.env.COMPLEMENTOS_CACHE_MS = '60000';
      const C2 = require('../lib/complementos');
      await q("UPDATE complementos_campana SET activo = 0 WHERE clave = 'tareas'");
      ok(!(await C2.complementoActivo('tareas')), 'caché: lee apagado');
      await q("UPDATE complementos_campana SET activo = 1 WHERE clave = 'tareas'");
      ok(!(await C2.complementoActivo('tareas')), 'caché: un cambio hecho por fuera NO se ve dentro de su vida (por eso el cambio se hace con guardar())');
      await C2.guardar('tareas', true, null);
      ok(await C2.complementoActivo('tareas'), 'caché: guardar() la invalida y el cambio se ve al instante');
      await C2.guardar('tareas', false, null);
      ok(!(await C2.complementoActivo('tareas')), 'y apagar también');
      process.env.COMPLEMENTOS_CACHE_MS = '0';
      delete require.cache[require.resolve('../lib/complementos')];
      await apagarTodas();
    }
  } catch (e) {
    fallos++;
    console.log('  FALLA la prueba se cayó:', e && e.stack);
  } finally {
    try { await apagarTodas(); } catch (_) { /* nada */ }
    try { if (servidor) servidor.close(); } catch (_) { /* ya cerrado */ }
    await pool.end().catch(() => {});
  }
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})();
