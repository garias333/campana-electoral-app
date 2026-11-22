#!/usr/bin/env node
// scripts/probar-admin-candidato-sin-equipo.js — ORDEN 93: el administrador que es el candidato entra desde un equipo SIN autorizar, en modo «solo candidato».
//
// SERVIDOR (HTTP): con el cupo lleno / aprobación pendiente, el administrador marcado «Es el candidato» entra (sesión con rol candidato, solo lectura y lista corta del candidato; lo de administración
// responde 403), con la contraseña, con el código de verificación en dos pasos y con el token del dispositivo; el equipo queda pendiente; ya autorizado entra como siempre; y la sesión «solo candidato»
// no se vuelve administrativa aunque el equipo se apruebe. Administrador sin la marca y superadministrador: rechazados como hoy. Rol candidato, coordinador y líder: sin cambios.
// NAVEGADOR (390×844 y 1280): cae en /app/candidato.html, ve su app, y «Modo administrador» muestra el aviso sin cambiar de modo.
//
// USO (base desechable con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada93 [SALIDA=/ruta] node scripts/probar-admin-candidato-sin-equipo.js
// Se niega a correr si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) { console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`); process.exit(2); }
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.LICENCIA_SERVIDOR_URL = 'http://127.0.0.1:1';   // Orden 92: un equipo pendiente avisa al panel; que la prueba no llame al servidor de licencias de verdad
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';

// El correo del código se SIMULA (antes de que auth.routes lo cargue): se anota el código y no sale nada.
const codigos = [];
require('../config/mailer').enviarCodigo2FA = async (destino, codigo) => { codigos.push({ destino, codigo }); };

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { sembrar, CLAVE_CORREO } = require('./fixtures/coordinadores-celular');
const { lanzar, espera } = require('./capturas/navegador');

const RAIZ = path.join(__dirname, '..');
const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden93');
fs.mkdirSync(SALIDA, { recursive: true });
const CLAVE = 'Clave-Prueba-93x';
const CORREOS = { admcand: 'admcand93@ejemplo.co', admsin: 'admsin93@ejemplo.co', super: 'super93@ejemplo.co', candidato: 'candidato93@ejemplo.co', admcand2fa: 'admcand2fa93@ejemplo.co' };

let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];

function crearApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(session({ secret: 'secreto-de-prueba', resave: false, saveUninitialized: true, cookie: { httpOnly: true } }));
  app.get('/api/csrf-token', (req, res) => res.json({ csrfToken: 'ejemplo' }));
  app.get('/api/marca-publica', (req, res) => res.json({ titulo: 'Campaña de ejemplo', subtitulo: '', logo_url: '', boton_testigos: false }));
  const { cargarSublicencia, restringirAspirante } = require(path.join(RAIZ, 'middleware/aspirante'));
  app.use('/api', cargarSublicencia, restringirAspirante);
  app.use('/api', require(path.join(RAIZ, 'middleware/soloLecturaCandidato')).soloLecturaCandidato);   // como app.js
  const montar = (ruta, archivo) => app.use(ruta, require(path.join(RAIZ, 'routes', archivo)));
  ['auth', 'usuarios', 'territorial', 'votantes', 'votantes-dashboard:votantesDashboard', 'finanzas', 'eventos', 'recursos', 'legislacion', 'dashboard', 'configuracion',
    'permisos', 'complementos', 'contenido', 'push', 'geo', 'manuales', 'panel-lider:panelLider', 'coordinador', 'catalogo', 'solicitudes', 'tareas', 'puerta-a-puerta:puertaAPuerta', 'candidato']
    .forEach((x) => { const [r, f] = x.split(':'); montar('/api/' + r, (f || r) + '.routes'); });
  montar('/api/dia-d/rescate', 'rescateVotos.routes');
  montar('/api/dia-d', 'diaD.routes');
  app.use('/api', (req, res) => res.status(404).json({ error: 'sin ruta en el servidor de pruebas' }));
  app.use(express.static(path.join(RAIZ, 'public'), { etag: false, lastModified: false, setHeaders: (r) => r.setHeader('Cache-Control', 'no-store') }));
  return app;
}

let base = '';
function cliente() {
  let cookie = '';
  const pedir = async (metodo, ruta, cuerpo, cabeceras = {}) => {
    const h = { 'Content-Type': 'application/json', ...cabeceras };
    if (cookie) h.Cookie = cookie;
    const r = await fetch(base + '/api' + ruta, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), redirect: 'manual' });
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (set.length) {
      const jar = new Map(cookie.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c]));
      set.forEach((c) => { const kv = c.split(';')[0]; jar.set(kv.split('=')[0], kv); });
      cookie = [...jar.values()].join('; ');
    }
    const texto = await r.text(); let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
    return { status: r.status, datos, texto };
  };
  return { get: (r, h) => pedir('GET', r, undefined, h), post: (r, b, h) => pedir('POST', r, b || {}, h), put: (r, b) => pedir('PUT', r, b || {}), del: (r) => pedir('DELETE', r), tieneEquipo: () => /(^|; )equipo=/.test(cookie) };
}

(async () => {
  const servidor = http.createServer(crearApp());
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const { ids } = await sembrar(pool);
  const hash = bcrypt.hashSync(CLAVE, 4);
  const rol = async (n) => (await q('SELECT id FROM roles WHERE nombre = ?', [n]))[0].id;
  const nuevo = async (nombre, cedula, correo, rolNombre, extra = {}) => (await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, es_candidato, es_superadmin, two_factor_enabled, clave_celular_pregunta_hecha)
     VALUES (?, ?, ?, ?, '3001230000', ?, ?, 1, ?, ?, ?, 1)`, [nombre, cedula, cedula, correo, hash, await rol(rolNombre), extra.cand ? 1 : 0, extra.sup ? 1 : 0, extra.dos ? 1 : 0]))[0].insertId;
  const idAdmCand = await nuevo('Admin Candidato', '1099930001', CORREOS.admcand, 'admin', { cand: true });
  await nuevo('Admin Sin Marca', '1099930002', CORREOS.admsin, 'admin');
  // El superadministrador es ÚNICO (índice): init-db ya creó uno; se le pone un correo y una contraseña de prueba.
  await q('UPDATE usuarios SET email = ?, password_hash = ?, two_factor_enabled = 0 WHERE es_superadmin = 1', [CORREOS.super, hash]);
  await nuevo('Juan Candidato Pérez', '1099930004', CORREOS.candidato, 'candidato');
  await nuevo('Admin Candidato 2FA', '1099930005', CORREOS.admcand2fa, 'admin', { cand: true, dos: true });
  await q('INSERT INTO licencia_equipos_config (id, max_equipos, requiere_aprobacion) VALUES (1, 1, 1) ON DUPLICATE KEY UPDATE max_equipos = 1, requiere_aprobacion = 1');
  const login = (c, correo, extra = {}) => c.post('/auth/login', { email: correo, password: CLAVE, ...extra });

  console.log('\n[1] Administrador «Es el candidato» desde un equipo NUEVO (aprobación pendiente)');
  const A = cliente();
  let r = await login(A, CORREOS.admcand);
  ok(r.status === 200 && r.datos.ok && !r.datos.equipoNoAutorizado, 'NO se rechaza: entra', r);
  const u = r.datos && r.datos.usuario;
  ok(u && u.rol === 'candidato' && u.solo_candidato === true && u.rol_real === 'admin', 'con sesión «solo candidato»: rol candidato en la sesión (en la base sigue siendo admin)', u);
  const eq = (await q("SELECT estado FROM equipos_autorizados WHERE ultimo_usuario_id = ?", [idAdmCand]));
  ok(eq.length === 1 && eq[0].estado === 'pendiente', 'el equipo queda registrado como PENDIENTE (se puede aprobar en el panel)', eq);
  ok((await q("SELECT COUNT(*) n FROM auditoria WHERE usuario_id = ? AND accion = 'equipo_no_autorizado' AND detalle LIKE '%solo candidato%'", [idAdmCand]))[0].n === 1, 'y queda anotado en la bitácora');
  r = await A.get('/auth/me');
  ok(r.status === 200 && r.datos.usuario.rol === 'candidato' && r.datos.usuario.solo_candidato === true, '/auth/me dice solo_candidato', r.datos && r.datos.usuario);

  console.log('\n[2] Lo del candidato funciona; TODO lo de administración responde 403');
  for (const ruta of ['/candidato/mas', '/candidato/resumen', '/configuracion/campana', '/dashboard/resumen', '/contenido/biografia_candidato', '/recursos']) {
    r = await A.get(ruta);
    ok(r.status === 200, `GET /api${ruta} (lo del candidato) → ${r.status}`, r.texto.slice(0, 120));
  }
  for (const [m, ruta, cuerpo] of [
    ['GET', '/usuarios/admin'], ['GET', '/votantes'], ['GET', '/finanzas/movimientos'], ['GET', '/territorial/estructura/exportar-excel'], ['GET', '/permisos/matriz'],
    ['POST', '/usuarios', { nombre: 'X', email: 'x93@ejemplo.co', rol: 'lider' }], ['PUT', '/usuarios/' + ids.ana, { nombre: 'Cambiado' }], ['DELETE', '/usuarios/' + ids.ana],
    ['POST', '/eventos', { titulo: 'X', fecha_inicio: '2031-03-02 09:00:00', tipo: 'reunion' }], ['PUT', '/configuracion/campana', { nombre_candidato: 'X' }],
    ['POST', '/votantes', { nombre: 'X', categoria: 'votante' }], ['DELETE', '/votantes/1'], ['PUT', '/permisos/matriz', {}], ['POST', '/territorial/estructura/eliminar-masivo', {}],
  ]) {
    const x = await (m === 'GET' ? A.get(ruta) : m === 'POST' ? A.post(ruta, cuerpo) : m === 'PUT' ? A.put(ruta, cuerpo) : A.del(ruta));
    ok(x.status === 403, `${m} /api${ruta} → 403 (era ${x.status})`, x.texto.slice(0, 120));
  }
  ok((await q('SELECT nombre FROM usuarios WHERE id = ?', [ids.ana]))[0].nombre !== 'Cambiado', 'y no se escribió nada');

  console.log('\n[3] La sesión «solo candidato» NO se vuelve administrativa aunque el equipo se apruebe');
  await q("UPDATE equipos_autorizados SET estado = 'autorizado'");
  r = await A.get('/usuarios/admin');
  ok(r.status === 403, 'equipo aprobado, MISMA sesión: lo de administración sigue en 403', r.status);
  r = await login(A, CORREOS.admcand);
  ok(r.status === 200 && r.datos.usuario.rol === 'admin' && !r.datos.usuario.solo_candidato, 'tras volver a iniciar sesión desde el equipo ya autorizado: entra como administrador, como hoy', r.datos && r.datos.usuario);
  r = await A.get('/usuarios/admin');
  ok(r.status === 200, '   y ahora sí administra', r.status);
  await q("UPDATE equipos_autorizados SET estado = 'pendiente'");

  console.log('\n[4] Con la verificación en dos pasos y con el token del dispositivo');
  const D = cliente();
  r = await login(D, CORREOS.admcand2fa);
  ok(r.status === 200 && r.datos.requiere2fa === true, 'con dos pasos pide el código (no se rechaza)', r);
  const cod = codigos.filter((x) => x.destino === CORREOS.admcand2fa).pop();
  r = await D.post('/auth/verificar-2fa', { codigo: cod && cod.codigo });
  ok(r.status === 200 && r.datos.usuario.rol === 'candidato' && r.datos.usuario.solo_candidato === true, 'tras el código la sesión es «solo candidato»', r.datos && r.datos.usuario);
  r = await D.get('/usuarios/admin');
  ok(r.status === 403, '   y lo de administración responde 403', r.status);
  const T = cliente();
  r = await login(T, CORREOS.admcand, { recordar: true });
  const token = r.datos && r.datos.dispositivoToken;
  ok(!!token && r.datos.usuario.solo_candidato === true, 'con «recordar» recibe un token del dispositivo', !!token);
  const S = cliente();   // otro navegador sin cookie: solo el token
  r = await S.get('/auth/me', { 'X-Device-Token': token });
  ok(r.status === 200 && r.datos.usuario.rol === 'candidato' && r.datos.usuario.solo_candidato === true, 'con el token, /auth/me sigue siendo «solo candidato» (no recupera el rol de administrador)', r.datos && r.datos.usuario);
  r = await S.get('/usuarios/admin', { 'X-Device-Token': token });
  ok(r.status === 403, '   y con el token lo de administración responde 403', r.status);
  r = await S.post('/eventos', { titulo: 'X', fecha_inicio: '2031-03-02 09:00:00', tipo: 'reunion' }, { 'X-Device-Token': token });
  ok(r.status === 403, '   y escribir también', r.status);

  console.log('\n[5] Los demás, igual que hoy (equipo nuevo con cupo lleno)');
  r = await login(cliente(), CORREOS.admsin);
  ok(r.status === 403 && r.datos.equipoNoAutorizado === true, 'administrador SIN la marca: rechazado (equipoNoAutorizado)', r);
  r = await login(cliente(), CORREOS.super);
  ok(r.status === 403 && r.datos.equipoNoAutorizado === true, 'superadministrador: igual que hoy (rechazado como cualquier administrador)', r);
  r = await login(cliente(), CORREOS.candidato);
  ok(r.status === 200 && r.datos.usuario.rol === 'candidato' && !r.datos.usuario.solo_candidato, 'rol candidato: entra sin autorización, como hoy (y no es «solo candidato»)', r.datos && r.datos.usuario);
  r = await login(cliente(), 'marta@ejemplo.co');
  r = await cliente().post('/auth/login', { email: 'marta@ejemplo.co', password: CLAVE_CORREO });
  ok(r.status === 200 && r.datos.usuario.rol === 'coordinador' && !r.datos.usuario.solo_candidato, 'coordinador: igual', r.datos && r.datos.usuario);
  await q("UPDATE usuarios SET email = 'ana93@ejemplo.co', password_hash = ? WHERE id = ?", [hash, ids.ana]);
  r = await login(cliente(), 'ana93@ejemplo.co');
  ok(r.status === 200 && r.datos.usuario.rol === 'lider' && !r.datos.usuario.solo_candidato, 'líder: igual', r.datos && r.datos.usuario);
  r = await login(cliente(), CORREOS.admsin, { entrarComo: 'solo_candidato' });
  ok(r.status === 403, 'pedir «solo_candidato» a mano siendo administrador SIN la marca no abre nada (403)', r.status);
  r = await login(cliente(), 'ana93@ejemplo.co', { entrarComo: 'solo_candidato' });
  ok(r.status === 200 && r.datos.usuario.rol === 'lider' && !r.datos.usuario.solo_candidato, 'ni cambia a un líder que lo pida a mano', r.datos && r.datos.usuario);

  /* ============================ NAVEGADOR ============================ */
  console.log('\n[6] En el celular (390×844) y en el computador (1280)');
  await q("UPDATE equipos_autorizados SET estado = 'pendiente'");
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  const movil = () => cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const escritorio = () => cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const ir = async (url) => { await cmd('Page.navigate', { url }); await espera(1000); };
  const esperar = async (expr, ms = 10000) => { const hasta = Date.now() + ms; while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); } return false; };
  const foto = async (nombre) => { const x = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(x.result.data, 'base64')); };
  const sinDesborde = () => ev('document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1');
  const ruta = () => ev('location.pathname + location.search');
  const limpiar = async () => { await cmd('Network.clearBrowserCookies'); await ir(base + '/login.html'); await ev('localStorage.clear(); sessionStorage.clear()'); await espera(500); p.avisos.length = 0; };
  const entrarPorLaPantalla = async (correo) => {
    await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
    await ev("document.getElementById('ir-a-otros-desde-eleccion').click()");
    await ev("document.getElementById('ir-a-password').click()");
    await ev(`(() => { document.getElementById('campo-email').value = ${JSON.stringify(correo)}; document.getElementById('campo-password').value = ${JSON.stringify(CLAVE)}; document.querySelector('#form-login button[type=submit]').click(); })()`);
  };

  await movil(); await cmd('Emulation.setTouchEmulationEnabled', { enabled: true }); await limpiar();
  await entrarPorLaPantalla(CORREOS.admcand);
  ok(await esperar("location.pathname === '/app/candidato.html'", 12000), 'celular, equipo nuevo: entra y cae en /app/candidato.html (no ve «este equipo no está autorizado»)', { ruta: await ruta(), error: await ev("(document.getElementById('login-error') || {}).innerText") });
  await esperar("document.getElementById('contenido').style.display !== 'none'"); await espera(1000);
  ok(await ev("!!document.querySelector('.btn-salir')") && /Inicio,Equipo,Mapa,Agenda,Más/.test(await ev("[...document.querySelectorAll('#nav-candidato a')].map(a => a.lastChild.textContent.trim()).join(',')")), 've su app del candidato (inicio, barra inferior, «Salir»)');
  ok(await sinDesborde() && p.avisos.filter((x) => !/tile|favicon|Failed to load/i.test(x)).length === 0, 'sin desborde ni errores de consola', p.avisos);
  await foto('1-candidato-inicio-equipo-nuevo-390x844');
  await ir(base + '/app/candidato-mas.html'); await esperar("document.querySelectorAll('.menu-boton').length > 0"); await espera(500);
  const hayModo = await ev("[...document.querySelectorAll('button.menu-boton')].some(b => /Modo administrador/.test(b.innerText))");
  ok(hayModo, '«Más» trae el botón «Modo administrador»');
  await ev("document.querySelector('button.menu-boton[data-accion=modo_admin]').click()"); await espera(500);
  const av = await ev("({ texto: document.getElementById('aviso-modo').innerText, visible: document.getElementById('aviso-modo').offsetParent !== null, ruta: location.pathname, modo: sessionStorage.getItem('modo_admin_candidato') })");
  ok(av.visible && av.texto === 'Para administrar, este equipo debe estar autorizado. Pídalo en el panel.' && av.ruta === '/app/candidato-mas.html' && av.modo !== 'admin', '«Modo administrador» muestra el aviso y NO cambia de modo', av);
  await foto('2-aviso-modo-administrador-390x844');
  ok((await q("SELECT estado FROM equipos_autorizados WHERE ultimo_usuario_id = ?", [idAdmCand])).every((e) => e.estado === 'pendiente'), 'el equipo sigue pendiente');
  await ir(base + '/app/admin-panel.html'); await espera(1500);
  ok(await ruta() === '/app/inicio.html' || (await ruta()).startsWith('/app/candidato'), 'si abre la app de administración a mano, lo devuelve a la del candidato', await ruta());

  await escritorio(); await cmd('Emulation.setTouchEmulationEnabled', { enabled: false }); await limpiar();
  await ev(`(async () => { const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(CORREOS.admcand)}, password: ${JSON.stringify(CLAVE)} }) }); const d = await r.json(); irDondeCorresponde(d.usuario); })()`);
  ok(await esperar("location.pathname === '/app/candidato.html'", 12000), 'computador (1280), equipo nuevo: también cae en /app/candidato.html (no en el escritorio de administración)', await ruta());

  // Equipo autorizado → como hoy
  await q("UPDATE licencia_equipos_config SET max_equipos = 0, requiere_aprobacion = 0 WHERE id = 1");
  await movil(); await cmd('Emulation.setTouchEmulationEnabled', { enabled: true }); await limpiar();
  await entrarPorLaPantalla(CORREOS.admcand);
  ok(await esperar("location.pathname === '/app/candidato.html'", 12000), 'equipo autorizado, celular: entra como candidato (como hoy)', await ruta());
  await ir(base + '/app/candidato-mas.html'); await esperar("document.querySelectorAll('.menu-boton').length > 0"); await espera(500);
  await ev("document.querySelector('button.menu-boton[data-accion=modo_admin]').click()");
  ok(await esperar("location.pathname === '/app/admin-panel.html'", 10000), 'y su «Modo administrador» SÍ abre la app de administración (como hoy)', await ruta());
  await escritorio(); await cmd('Emulation.setTouchEmulationEnabled', { enabled: false }); await limpiar();
  await ev(`(async () => { const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(CORREOS.admcand)}, password: ${JSON.stringify(CLAVE)} }) }); const d = await r.json(); irDondeCorresponde(d.usuario); })()`);
  ok(await esperar("location.pathname === '/dashboard.html'", 12000), 'equipo autorizado, computador: escritorio de administración (como hoy)', await ruta());

  nav.cerrar(); servidor.close();
  console.log(`\n${pasos - fallos}/${pasos} comprobaciones correctas.`);
  console.log(fallos ? `HAY ${fallos} FALLO(S).` : 'TODO BIEN.');
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch(async (e) => { console.error(e); try { await pool.end(); } catch (_) { /* nada */ } process.exit(1); });
