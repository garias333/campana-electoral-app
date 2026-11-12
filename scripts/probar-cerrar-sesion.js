#!/usr/bin/env node
// scripts/probar-cerrar-sesion.js
//
// Prueba del parche 329 (orden 43): CERRAR SESIÓN SIN SEÑAL Y PENDIENTES POR USUARIO.
//   S1 (servidor, sin navegador): el token de cierre se entrega al iniciar sesión y solo su HASH se guarda; POST /api/auth/cerrar-pendiente destruye
//      la sesión (la cookie vieja deja de servir), responde IGUAL con un token falso, está exenta de CSRF y tiene límite de consultas; una sesión
//      reemplazada por otra persona no puede ser destruida con el token del anterior; el 409 «Esta pendiente es de otra cuenta»; «Marcar llegada»
//      sin «Editar» responde 403; el service worker no cachea /api/.
//   S2 (Chromium REAL, con /api/* bloqueado = «sin señal»): cerrar sesión sin señal deja el celular sin identidad y el siguiente que abre la app ve el
//      login; al volver la señal la sesión vieja se destruye en el servidor; otra cuenta en el mismo celular no ve ni envía las pendientes del
//      anterior, que quedan guardadas y se envían cuando él vuelve a entrar; las pendientes sin dueño no se envían y se pueden descartar; sin saber
//      el usuario no se encola.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada329 node scripts/probar-cerrar-sesion.js
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
delete process.env.NODE_ENV;

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { csrfToken, csrfProtegido } = require('../middleware/csrf');
const { verificarDuenoDeCola, requireAuth } = require('../middleware/auth');

const RAIZ = path.join(__dirname, '..');
let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }

// ------------------------------------------------------------------------------ el servidor de prueba: sesión real, CSRF real, rutas reales
const recibidas = [];                 // lo que llegó a la ruta de pruebas de la cola
function construir() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  const almacen = new MySQLStore({}, pool);
  app.use(session({ key: 'campana_sid', secret: process.env.SESSION_SECRET, store: almacen, resave: false, saveUninitialized: false,
    cookie: { maxAge: 8 * 3600 * 1000, httpOnly: true, secure: false, sameSite: 'lax' } }));
  app.use(csrfToken);
  app.get('/api/csrf-token', (req, res) => res.json({ csrfToken: req.session.csrfToken }));
  app.use('/api', csrfProtegido);
  app.use('/api', verificarDuenoDeCola);
  app.get('/api/marca-publica', (req, res) => res.json({ titulo: '', subtitulo: '', logo_url: '' }));
  app.use('/api/auth', require('../routes/auth.routes'));
  app.use('/api/permisos', require('../routes/permisos.routes'));
  app.use('/api/dia-d/checkin', require('../routes/checkinDiaD.routes'));
  app.post('/api/_cola_prueba', requireAuth, (req, res) => {
    recibidas.push({ usuario: req.session.usuario.id, cola: req.headers['x-cola-usuario'] || null, cuerpo: req.body });
    res.json({ ok: true });
  });
  app.use(express.static(path.join(RAIZ, 'public')));
  return { app, almacen };
}

let base = '';
// ---- cliente HTTP con su propia cookie
function cliente(ipFalsa) {
  const c = { cookie: '', csrf: null };
  c.pedir = async (metodo, ruta, { json, conCsrf = true, sinCookie = false } = {}) => {
    const h = { 'X-Forwarded-For': ipFalsa || '198.51.100.7' };
    if (c.cookie && !sinCookie) h.Cookie = c.cookie;
    if (json !== undefined) h['Content-Type'] = 'application/json';
    if (metodo !== 'GET' && conCsrf) {
      if (!c.csrf) c.csrf = (await (await fetch(base + '/api/csrf-token', { headers: h })).json()).csrfToken;
      h['X-CSRF-Token'] = c.csrf;
    }
    const r = await fetch(base + '/api' + ruta, { method: metodo, headers: h, body: json !== undefined ? JSON.stringify(json) : undefined });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    const nueva = sc.find((x) => x.startsWith('campana_sid='));
    if (nueva) c.cookie = nueva.split(';')[0];
    const texto = await r.text();
    let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
    return { status: r.status, datos, texto };
  };
  // El token CSRF se pide con la cookie de este cliente
  c.csrfConCookie = async () => {
    const r = await fetch(base + '/api/csrf-token', { headers: c.cookie ? { Cookie: c.cookie } : {} });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    const nueva = sc.find((x) => x.startsWith('campana_sid='));
    if (nueva) c.cookie = nueva.split(';')[0];
    c.csrf = (await r.json()).csrfToken;
  };
  return c;
}

let n = 0;
const sello = String(Date.now()).slice(-6);
async function usuario(nombre, rol) {
  n++;
  const cedula = `96${sello}${n}`;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, cedula, cedula, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  return { id: r.insertId, rol, nombre, cedula };
}
async function entrar(c, u) {
  await c.csrfConCookie();
  return c.pedir('POST', '/auth/login', { json: { email: u.cedula, password: 'clave-ejemplo', recordar: false } });
}

(async () => {
  const { app, almacen } = construir();
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const A = await usuario('Persona A', 'lider');
  const B = await usuario('Persona B', 'lider');
  const coord = await usuario('Coordinador Sin Editar', 'coordinador');

  // ================================================================================== S1. SERVIDOR
  console.log('\nS1. Servidor: token de cierre y cerrar-pendiente');
  const a = cliente('198.51.100.11');
  let r = await entrar(a, A);
  ok(r.status === 200 && r.datos && r.datos.ok, 'iniciar sesión (A)', r.texto);
  const tokenA = r.datos && r.datos.tokenCierre;
  ok(typeof tokenA === 'string' && tokenA.length >= 40 && /^[A-Za-z0-9_-]+$/.test(tokenA), 'la respuesta del ingreso trae un tokenCierre aleatorio (32 bytes en base64url)', tokenA);
  const hashA = crypto.createHash('sha256').update(String(tokenA)).digest('hex');
  let filas = await q('SELECT token_hash, session_id, usuario_id FROM sesiones_cierre WHERE token_hash = ?', [hashA]);
  ok(filas.length === 1 && filas[0].usuario_id === A.id, 'el servidor guarda el HASH del token ligado a esa sesión', filas);
  const todos = await q('SELECT token_hash FROM sesiones_cierre');
  ok(!todos.some((f) => f.token_hash === tokenA), 'el token en claro NO se guarda en ninguna parte');
  r = await a.pedir('GET', '/auth/me');
  ok(r.status === 200 && r.datos.usuario.id === A.id, 'con la cookie, /auth/me responde como A');

  // otra persona (otro navegador, sin cookie, sin CSRF) presenta el token
  const otro = cliente('198.51.100.12');
  r = await otro.pedir('POST', '/auth/cerrar-pendiente', { json: { tokenCierre: tokenA }, conCsrf: false });
  ok(r.status === 200 && r.datos && r.datos.ok === true, 'POST /auth/cerrar-pendiente: sin cookie y SIN token CSRF responde 200 (ruta exenta de CSRF)', { status: r.status, t: r.texto });
  r = await a.pedir('GET', '/auth/me');
  ok(r.status === 401, 'LA COOKIE VIEJA YA NO SIRVE: /auth/me de la sesión cerrada responde 401', r.status);
  filas = await q('SELECT 1 FROM sesiones_cierre WHERE token_hash = ?', [hashA]);
  ok(filas.length === 0, 'y la fila del token se borró');
  const mismaRespuesta = await otro.pedir('POST', '/auth/cerrar-pendiente', { json: { tokenCierre: tokenA }, conCsrf: false });
  const falso = await otro.pedir('POST', '/auth/cerrar-pendiente', { json: { tokenCierre: crypto.randomBytes(32).toString('base64url') }, conCsrf: false });
  const basura = await otro.pedir('POST', '/auth/cerrar-pendiente', { json: { tokenCierre: 'x'.repeat(5) }, conCsrf: false });
  const vacio = await otro.pedir('POST', '/auth/cerrar-pendiente', { json: {}, conCsrf: false });
  ok([mismaRespuesta, falso, basura, vacio].every((x) => x.status === 200 && x.texto === '{"ok":true}'), 'token ya usado, falso, mal formado o ausente: la MISMA respuesta (no dice si existe)', [mismaRespuesta.texto, falso.texto, basura.texto, vacio.texto]);

  // una sesión REEMPLAZADA por otra persona no se puede destruir con el token del anterior
  const c1 = cliente('198.51.100.13');
  r = await entrar(c1, A); const tA2 = r.datos.tokenCierre;
  r = await entrar(c1, B); const tB2 = r.datos.tokenCierre;   // B inicia sesión sobre la MISMA cookie
  const filasSesion = await q('SELECT usuario_id FROM sesiones_cierre WHERE usuario_id IN (?, ?) AND session_id = (SELECT session_id FROM sesiones_cierre WHERE token_hash = ?)', [A.id, B.id, crypto.createHash('sha256').update(tB2).digest('hex')]);
  ok(filasSesion.length === 1 && filasSesion[0].usuario_id === B.id, 'al iniciar B sobre la cookie de A, el token de A deja de existir (queda solo el de B)', filasSesion);
  await otro.pedir('POST', '/auth/cerrar-pendiente', { json: { tokenCierre: tA2 }, conCsrf: false });
  r = await c1.pedir('GET', '/auth/me');
  ok(r.status === 200 && r.datos.usuario.id === B.id, 'el token VIEJO de A no destruye la sesión nueva de B', r.status);
  await otro.pedir('POST', '/auth/cerrar-pendiente', { json: { tokenCierre: tB2 }, conCsrf: false });
  r = await c1.pedir('GET', '/auth/me');
  ok(r.status === 401, 'y el token de B sí cierra la de B', r.status);

  // el cierre normal también limpia
  const c2 = cliente('198.51.100.14');
  r = await entrar(c2, A); const t3 = r.datos.tokenCierre;
  await c2.pedir('POST', '/auth/logout', { json: {} });
  filas = await q('SELECT 1 FROM sesiones_cierre WHERE token_hash = ?', [crypto.createHash('sha256').update(t3).digest('hex')]);
  ok(filas.length === 0, 'POST /auth/logout también borra el token de cierre de esa sesión');

  // dueño de la cola
  console.log('\nS1b. La pendiente es de una cuenta (409) y «Marcar llegada» pide Editar');
  const ca = cliente('198.51.100.15'); await entrar(ca, A);
  r = await ca.pedir('POST', '/_cola_prueba', { json: { x: 1 } });
  ok(r.status === 200, 'sin X-Cola-Usuario (una petición normal) pasa');
  const h = (id) => ({});
  const conCola = async (c, id) => {
    await c.csrfConCookie();
    const rr = await fetch(base + '/api/_cola_prueba', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: c.cookie, 'X-CSRF-Token': c.csrf, 'X-Cola-Usuario': String(id), 'X-Forwarded-For': '198.51.100.15' }, body: '{}' });
    return { status: rr.status, datos: await rr.json().catch(() => null) };
  };
  r = await conCola(ca, A.id);
  ok(r.status === 200, 'X-Cola-Usuario igual a la cuenta de la sesión: pasa');
  r = await conCola(ca, B.id);
  ok(r.status === 409 && /otra cuenta/.test(r.datos.error) && r.datos.codigo === 'cola_de_otra_cuenta', 'X-Cola-Usuario de OTRA cuenta: 409 «Esta pendiente es de otra cuenta»', r);
  r = await conCola(ca, '');
  ok(r.status === 409, 'X-Cola-Usuario vacío tampoco coincide: 409', r.status);

  await q(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES ('coordinador', 'alertas_dia_d', 1, 0, 0) ON DUPLICATE KEY UPDATE permitido = 1, editar = 0`);
  const cc = cliente('198.51.100.16'); await entrar(cc, coord);
  r = await cc.pedir('POST', '/dia-d/checkin/manual', { json: { usuario_id: A.id } });
  ok(r.status === 403 && /Editar/.test((r.datos || {}).error || ''), '«Marcar llegada» (checkin/manual) con «Ver» y sin «Editar» en Alertas: 403', r);
  await q(`UPDATE permisos_rol SET editar = 1 WHERE rol = 'coordinador' AND modulo = 'alertas_dia_d'`);
  r = await cc.pedir('POST', '/dia-d/checkin/manual', { json: { usuario_id: A.id } });
  ok(r.status !== 403, 'con «Editar» ya no responde 403 (pasa a la lógica de la ruta)', r.status);
  await q(`DELETE FROM permisos_rol WHERE rol = 'coordinador' AND modulo = 'alertas_dia_d'`);
  r = await cc.pedir('POST', '/dia-d/checkin/manual', { json: { usuario_id: A.id } });
  ok(r.status === 403, 'sin fila de permiso falla cerrado (403)', r.status);

  const sw = fs.readFileSync(path.join(RAIZ, 'public/service-worker.js'), 'utf8');
  ok(/url\.pathname\.startsWith\('\/api\/'\)[\s\S]{0,80}return;/.test(sw), 'el service worker NO cachea /api/* (incluido /api/auth/*): el handler sale antes de cachear');
  ok(sw.includes("'/js/cerrar-sesion.js'"), 'y cerrar-sesion.js está en la precarga (sirve sin señal)');

  // ================================================================================== S2. CHROMIUM
  console.log('\nS2. Chromium real, con /api/* bloqueado («sin señal»)');
  const { lanzar } = require('./capturas/navegador');
  const nav = await lanzar();
  try {
    const p = await nav.pagina('about:blank');
    const ir = async (ruta, ms = 1800) => { await p.cmd('Page.navigate', { url: base + ruta }); await espera(ms); };
    const donde = () => p.ev('location.pathname');
    const sinSenal = (si) => p.cmd('Network.setBlockedURLs', { urls: si ? ['*://*/api/*'] : [] });
    const ls = (k) => p.ev(`localStorage.getItem(${JSON.stringify(k)})`);
    const idb = (store) => p.ev(`new Promise((ok) => { const r = indexedDB.open('estrategia_offline'); r.onsuccess = () => { const d = r.result; if (!d.objectStoreNames.contains(${JSON.stringify(store)})) return ok([]); const g = d.transaction(${JSON.stringify(store)}, 'readonly').objectStore(${JSON.stringify(store)}).getAll(); g.onsuccess = () => { d.close(); ok(g.result); }; }; r.onerror = () => ok(null); })`);
    const ingresar = async (u) => {
      await ir('/login.html', 1200);
      await p.ev(`(() => { const f = document.getElementById('form-login'); f.email.value = ${JSON.stringify(u.cedula)}; f.password.value = 'clave-ejemplo'; f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); })()`);
      for (let i = 0; i < 40 && (await donde()) === '/login.html'; i++) await espera(250);
      await espera(800);
    };

    // ---- A entra y deja una pendiente
    await ingresar(A);
    ok((await donde()) !== '/login.html', 'A inicia sesión por el formulario real y sale del login', await donde());
    ok(!!(await ls('sesion_token_cierre')), 'el navegador guarda el token de cierre de la sesión (sesion_token_cierre)');
    await ir('/app/inicio.html', 2500);
    ok(String(await ls('offline_usuario_id')) === String(A.id), 'la app registra a A como el usuario de este celular (offline_usuario_id)', await ls('offline_usuario_id'));
    await p.ev(`guardarEnColaOffline('votantes_pendientes', { clienteUuid: generarUuid(), estado: 'pendiente', payload: { nombre: 'Pendiente de A' } })`);
    const cookies = (await p.cmd('Network.getCookies', { urls: [base] })).result.cookies;
    const cookieA = (cookies.find((c) => c.name === 'campana_sid') || {}).value;
    ok(!!cookieA, 'hay una cookie de sesión del servidor (httpOnly: el navegador no puede borrarla)');
    let pend = await idb('votantes_pendientes');
    ok(pend && pend.length === 1 && String(pend[0].usuarioId) === String(A.id), 'la pendiente se guardó con su dueño (A)', pend);

    // ---- A cierra sesión SIN SEÑAL
    const tokenAntes = await ls('sesion_token_cierre');
    await sinSenal(true);
    await p.ev(`document.getElementById('btn-cerrar-sesion').click()`);
    for (let i = 0; i < 40 && (await donde()) !== '/login.html'; i++) await espera(250);
    ok((await donde()) === '/login.html', 'cerrar sesión sin señal SIEMPRE redirige a /login.html (aunque el servidor no responda)', await donde());
    const pendiente = JSON.parse((await ls('logout_pendiente')) || 'null');
    ok(pendiente && pendiente.tokenCierre === tokenAntes && pendiente.usuarioId === String(A.id), 'queda anotado logout_pendiente con el token de cierre', pendiente);
    ok(!(await ls('app_cuenta_activa_id')) && !(await ls('offline_usuario_id')) && !(await ls('app_usuario_verificado')) && !(await ls('sesion_token_cierre')), 'el celular quedó sin identidad: sin cuenta activa, sin usuario, sin identidad en caché ni token');
    pend = await idb('votantes_pendientes');
    ok(pend && pend.length === 1 && String(pend[0].usuarioId) === String(A.id), 'las pendientes de A NO se borraron: siguen guardadas con su dueño', pend);
    const meConCookieVieja = await fetch(base + '/api/auth/me', { headers: { Cookie: `campana_sid=${cookieA}` } });
    ok(meConCookieVieja.status === 200, 'y, sin señal, la sesión de A sigue viva en el servidor (por eso hace falta la guardia)', meConCookieVieja.status);

    // ---- el SIGUIENTE abre la app (sigue sin señal): ve el login, no entra como A
    await ir('/app/inicio.html', 3500);
    ok((await donde()) === '/login.html', 'EL SIGUIENTE QUE ABRE LA APP VE EL LOGIN (no entra como A)', await donde());
    ok(!!(await ls('logout_pendiente')), 'sin señal el cierre sigue pendiente');

    // ---- vuelve la señal
    await sinSenal(false);
    await ir('/app/inicio.html', 3500);
    ok((await donde()) === '/login.html', 'con señal y el cierre pendiente, tampoco entra por la cookie vieja: login', await donde());
    ok(!(await ls('logout_pendiente')), 'al recibir respuesta del servidor, logout_pendiente se borra');
    const meCerrada = await fetch(base + '/api/auth/me', { headers: { Cookie: `campana_sid=${cookieA}` } });
    ok(meCerrada.status === 401, 'AL VOLVER LA SEÑAL, LA SESIÓN VIEJA SE DESTRUYÓ EN EL SERVIDOR (la cookie vieja ya no sirve)', meCerrada.status);

    // ---- B inicia sesión en el MISMO celular
    await ingresar(B);
    await ir('/app/inicio.html', 2500);
    ok(String(await ls('offline_usuario_id')) === String(B.id), 'B entra: ahora el usuario del celular es B', await ls('offline_usuario_id'));
    const veB = await p.ev(`listarColaOffline('votantes_pendientes').then((l) => l.length)`);
    ok(veB === 0, 'B NO ve las pendientes de A', veB);
    recibidas.length = 0;
    await p.ev(`sincronizarCola('votantes_pendientes', '/_cola_prueba', (r) => r.payload)`);
    ok(recibidas.length === 0, 'B no ENVÍA las pendientes de A (el servidor no recibió nada)', recibidas);
    pend = await idb('votantes_pendientes');
    ok(pend && pend.length === 1 && String(pend[0].usuarioId) === String(A.id), 'y siguen guardadas, a nombre de A', pend);
    const e409 = await p.ev(`api('/_cola_prueba', { method: 'POST', body: {}, headers: { 'X-Cola-Usuario': '${A.id}' } }).then(() => 'paso', (e) => e.status + ':' + (e.datos && e.datos.codigo))`);
    ok(e409 === '409:cola_de_otra_cuenta', 'si B intentara subir una pendiente de A, el servidor responde 409', e409);
    // un registro de A que se cuela en la cola de B se queda guardado (no «fallido», no borrado)
    await p.ev(`(async () => { const db = await abrirBaseOffline(); await new Promise((ok) => { const tx = db.transaction('votantes_pendientes', 'readwrite'); tx.objectStore('votantes_pendientes').put({ clienteUuid: 'colado-1', estado: 'pendiente', usuarioId: '${B.id}', payload: { nombre: 'De B' } }); tx.oncomplete = ok; }); })()`);
    await p.ev(`sincronizarCola('votantes_pendientes', '/_cola_prueba', (r) => r.payload)`);
    ok(recibidas.length === 1 && recibidas[0].usuario === B.id && String(recibidas[0].cola) === String(B.id), 'lo de B sí sube, con X-Cola-Usuario = B', recibidas);

    // ---- B cierra sesión CON señal; A vuelve a entrar y sus pendientes se envían
    await p.ev(`document.getElementById('btn-cerrar-sesion').click()`);
    for (let i = 0; i < 40 && (await donde()) !== '/login.html'; i++) await espera(250);
    await espera(600);
    ok(!(await ls('logout_pendiente')), 'cerrar sesión CON señal: el servidor responde y no queda nada pendiente');
    await ingresar(A);
    await ir('/app/inicio.html', 2500);
    const veA = await p.ev(`listarColaOffline('votantes_pendientes').then((l) => l.length)`);
    ok(veA === 1, 'cuando A vuelve a entrar, ve su pendiente', veA);
    recibidas.length = 0;
    await p.ev(`sincronizarCola('votantes_pendientes', '/_cola_prueba', (r) => r.payload)`);
    ok(recibidas.length === 1 && recibidas[0].usuario === A.id && recibidas[0].cuerpo.nombre === 'Pendiente de A', 'A envía su pendiente (con su sesión)', recibidas);
    pend = await idb('votantes_pendientes');
    ok(pend && pend.length === 0, 'y la cola queda vacía');

    // ---- pendientes SIN dueño
    await p.ev(`(async () => { const db = await abrirBaseOffline(); await new Promise((ok) => { const tx = db.transaction('votantes_pendientes', 'readwrite'); tx.objectStore('votantes_pendientes').put({ clienteUuid: 'huerfana-1', estado: 'pendiente', payload: { nombre: 'Sin dueño' } }); tx.oncomplete = ok; }); })()`);
    recibidas.length = 0;
    const lista = await p.ev(`listarColaOffline('votantes_pendientes').then((l) => l.length)`);
    await p.ev(`sincronizarCola('votantes_pendientes', '/_cola_prueba', (r) => r.payload)`);
    const sinDueno = await p.ev(`listarSinDueno('votantes_pendientes').then((l) => l.length)`);
    ok(lista === 0 && recibidas.length === 0 && sinDueno === 1, 'una pendiente SIN dueño no se lista ni se envía; se cuenta aparte', { lista, enviadas: recibidas.length, sinDueno });
    await p.ev(`revisarPendientesSinDueno()`);
    const barra = await p.ev(`(document.getElementById('aviso-pendientes-sin-dueno') || {}).textContent || ''`);
    ok(/1 pendiente sin dueño/.test(barra), 'se avisa «pendientes sin dueño» con la opción de descartarlas', barra);
    await p.ev(`document.querySelector('#aviso-pendientes-sin-dueno button').click()`);
    await espera(900);
    const quedan = await idb('votantes_pendientes');
    ok(quedan && quedan.length === 0 && !(await p.ev(`!!document.getElementById('aviso-pendientes-sin-dueno')`)), 'Descartarlas las borra y quita el aviso', quedan);

    // ---- sin saber el usuario, no se encola
    await p.ev(`document.getElementById('btn-cerrar-sesion').click()`);
    for (let i = 0; i < 40 && (await donde()) !== '/login.html'; i++) await espera(250);
    await espera(600);
    await p.ev(`new Promise((ok) => { const s = document.createElement('script'); s.src = '/js/offline-utils.js'; s.onload = ok; document.head.appendChild(s); })`);
    const rechazo = await p.ev(`guardarEnColaOffline('votantes_pendientes', { clienteUuid: 'sin-saber', estado: 'pendiente', payload: {} }).then(() => 'guardada', (e) => e.codigo + '|' + e.message)`);
    ok(/^SIN_DUENO\|/.test(rechazo), 'si no se sabe quién es el usuario, NO se encola y se avisa (error SIN_DUENO)', rechazo);
    ok(((await idb('votantes_pendientes')) || []).length === 0, 'y no quedó nada guardado');
    ok((await ls('logout_pendiente')) === null, 'cerrar sesión con señal deja todo limpio (nada pendiente)');
  } finally {
    nav.cerrar();
  }

  // ================================================================================== S1c. EL LÍMITE (al final: consume el contador de esa IP)
  console.log('\nS1c. Límite de consultas de cerrar-pendiente');
  const lim = cliente('198.51.100.99');
  let primera429 = 0;
  for (let i = 1; i <= 40; i++) {
    const x = await lim.pedir('POST', '/auth/cerrar-pendiente', { json: { tokenCierre: crypto.randomBytes(32).toString('base64url') }, conCsrf: false });
    if (x.status === 429) { primera429 = i; break; }
  }
  ok(primera429 > 25 && primera429 <= 32, `a partir de unas 30 consultas desde la misma IP responde 429 (cortó en la ${primera429})`, primera429);
  const otraIp = cliente('198.51.100.98');
  r = await otraIp.pedir('POST', '/auth/cerrar-pendiente', { json: { tokenCierre: 'x'.repeat(40) }, conCsrf: false });
  ok(r.status === 200, 'y otra IP no se ve afectada');

  servidor.close();
  try { almacen.close(); } catch (_) { /* ya cerrado */ }
  await pool.end();
  console.log(fallos ? `\n${fallos} comprobación(es) FALLARON.` : '\nTodo bien.');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('Error de la prueba:', e); process.exit(1); });
