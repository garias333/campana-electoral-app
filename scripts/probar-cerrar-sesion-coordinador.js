#!/usr/bin/env node
// scripts/probar-cerrar-sesion-coordinador.js
//
// Orden 65: «Cerrar sesión» del coordinador en el celular. Chromium REAL a 390×844, con el servidor lo más parecido al de producción que cabe en un
// arnés: sesión en MySQL (express-mysql-session), CSRF real, token de cierre real, las rutas reales. Los toques son TOQUES (Input.dispatchTouchEvent),
// no `.click()`. El coordinador entra por «Acceso a Coordinadores» (/api/auth/login-coordinador); el líder, por su puerta; se compara.
//
//   [A] con señal      · tocar «Cerrar sesión» · queda en el ingreso · la sesión del servidor muere (401 con la cookie y con el token viejos) · reabrir la app no entra
//   [B] sin señal      · cierra al instante · queda logout_pendiente · reabrir (sin señal) muestra el ingreso · al volver la señal se cierra en el servidor
//   [C] cuenta guardada · el celular tiene una cuenta de dispositivo de ANTES (token de «Mantener sesión») · entrar por la puerta del celular · cerrar sesión
//   [D] desde cada pantalla donde aparece el botón · volver a entrar con cédula y clave · admin cierra igual
//
// USO (sobre una base desechable ya inicializada con init-db; sin otra prueba con Chromium a la vez):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada65 [SOLO_DIAGNOSTICO=1] node scripts/probar-cerrar-sesion-coordinador.js
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

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const pool = require('../config/db');
const { csrfToken, csrfProtegido } = require('../middleware/csrf');
const { verificarDuenoDeCola } = require('../middleware/auth');
const { cargarSublicencia, restringirAspirante } = require('../middleware/aspirante');
const { sembrar, CLAVE_ADMIN } = require('./fixtures/coordinadores-celular');
const { sincronizarClaveCelular } = require('../lib/claveCelular');
const { firmarTokenDispositivo } = require('../config/tokenDispositivo');
const { lanzar, espera } = require('./capturas/navegador');

const RAIZ = path.join(__dirname, '..');
let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); }
}

function construir() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  const almacen = new MySQLStore({}, pool);
  app.use(session({ key: 'campana_sid', secret: process.env.SESSION_SECRET, store: almacen, resave: false, saveUninitialized: false,
    cookie: { maxAge: 8 * 3600 * 1000, httpOnly: true, secure: !!process.env.SEGURA, sameSite: 'lax' } }));   // SEGURA=1: la cookie como en producción (Secure)
  app.use(csrfToken);
  app.get('/api/csrf-token', (req, res) => res.json({ csrfToken: req.session.csrfToken }));
  app.use('/api', csrfProtegido);
  app.use('/api', verificarDuenoDeCola);
  app.get('/api/marca-publica', (req, res) => res.json({ titulo: 'Campaña de ejemplo', subtitulo: '', logo_url: '' }));
  app.use('/api', cargarSublicencia, restringirAspirante);
  const montar = (ruta, archivo) => app.use(ruta, require(path.join(RAIZ, 'routes', archivo)));
  montar('/api/auth', 'auth.routes');
  montar('/api/dashboard', 'dashboard.routes');
  montar('/api/coordinador', 'coordinador.routes');
  montar('/api/permisos', 'permisos.routes');
  montar('/api/configuracion', 'configuracion.routes');
  montar('/api/contenido', 'contenido.routes');
  montar('/api/push', 'push.routes');
  montar('/api/panel-lider', 'panelLider.routes');
  app.use('/api', (req, res) => res.status(404).json({ error: 'sin ruta en el servidor de pruebas' }));
  app.use(express.static(path.join(RAIZ, 'public'), { etag: false, lastModified: false, setHeaders: (r) => r.setHeader('Cache-Control', 'no-store') }));
  return { app, almacen };
}

(async () => {
  const { ids } = await sembrar(pool);
  await sincronizarClaveCelular(pool, ids.coord1);
  const { app, almacen } = construir();
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: true });
  // CON_SW=1: el service worker REAL activo (el arnés normal lo evita). Es lo que más se parece al celular de verdad.
  if (process.env.CON_SW) await cmd('Network.setBypassServiceWorker', { bypass: false });

  const ir = async (ruta, ms = 1200) => { await cmd('Page.navigate', { url: base + ruta }); await espera(ms); };
  const donde = () => ev('location.pathname');
  const ls = (k) => ev(`localStorage.getItem(${JSON.stringify(k)})`);
  const esperar = async (expr, ms = 10000) => {
    const hasta = Date.now() + ms;
    while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); }
    return false;
  };
  const esperarRuta = (r, ms = 10000) => esperar(`location.pathname === ${JSON.stringify(r)}`, ms);
  const sinSenal = (si) => cmd('Network.setBlockedURLs', { urls: si ? ['*://*/api/*'] : [] });
  const escribir = (sel, valor) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value = ${JSON.stringify(valor)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  /** UN TOQUE de verdad: se lleva el botón a la vista, se mide dónde quedó y se toca ahí. Devuelve false si lo que hay encima NO es el botón (algo lo tapa). */
  async function tocar(sel) {
    await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`);
    await espera(250);
    const c = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const encima = document.elementFromPoint(x, y); return { x, y, esElBoton: !!encima && (encima === e || e.contains(encima)), encima: encima ? (encima.id || encima.className || encima.tagName) : null }; })()`);
    await cmd('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
    await cmd('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return c;
  }
  async function cookieDelNavegador() {
    const cs = (await cmd('Network.getCookies', { urls: [base] })).result.cookies;
    return (cs.find((c) => c.name === 'campana_sid') || {}).value || null;
  }
  const estadoServidor = (cookie) => fetch(base + '/api/auth/me', { headers: cookie ? { Cookie: `campana_sid=${cookie}` } : {} }).then((r) => r.status);

  const entrarCoordinador = async () => {
    await ir('/login.html');
    await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
    await ev("document.getElementById('ir-a-coordinadores-desde-eleccion').click()");
    await escribir('#campo-cedula-coord', '1023456789'); await escribir('#campo-clave-coord', '456789');
    await ev("document.querySelector('#form-coordinador button[type=submit]').click()");
    await esperarRuta('/app/inicio.html');
    await esperar("!document.getElementById('panel-coordinador').hidden");
    await espera(500);
  };
  const entrarLider = async () => {
    await ir('/login.html');
    await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
    await ev("document.getElementById('ir-a-lideres-desde-eleccion').click()");
    await escribir('#campo-cedula-coord', '1055000001'); await escribir('#campo-clave-coord', '000001');
    await ev("document.querySelector('#form-coordinador button[type=submit]').click()");
    await esperarRuta('/app/inicio.html');
    await esperar("!document.getElementById('panel-lider').hidden");
    await espera(500);
  };
  const entrarAdminPorCorreo = async () => {
    await ir('/login.html');
    await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
    await ev("document.getElementById('ir-a-otros-desde-eleccion').click()");
    await ev("document.getElementById('ir-a-password').click()");
    await escribir('#campo-email', 'admin.ej@ejemplo.co'); await escribir('#campo-password', CLAVE_ADMIN);
    await ev("document.querySelector('#form-login button[type=submit]').click()");
    await esperarRuta('/app/admin-panel.html');
  };

  // ---------------------------------------------------------------------------------------------------------------- A / B
  for (const rol of ['lider', 'coordinador']) {
    const entrar = rol === 'coordinador' ? entrarCoordinador : entrarLider;
    console.log(`\n[A] ${rol.toUpperCase()} · con señal`);
    await entrar();
    ok(!!(await ls('sesion_token_cierre')), 'el navegador guarda el token de cierre de esta sesión');
    const cookie = await cookieDelNavegador();
    const tokenCierre = await ls('sesion_token_cierre');
    ok((await estadoServidor(cookie)) === 200, 'la sesión del servidor está viva (cookie)');
    const antes = await ls('app_cuenta_activa_id');
    console.log(`     (cuenta de dispositivo activa antes de cerrar: ${antes === null ? 'ninguna' : antes}; offline_usuario_id: ${await ls('offline_usuario_id')})`);
    const toque = await tocar('#btn-cerrar-sesion');
    ok(toque.esElBoton, 'el toque cae SOBRE el botón «Cerrar sesión» (nada lo tapa)', toque);
    ok(await esperarRuta('/login.html', 8000), 'tras tocar queda en /login.html', await donde());
    await espera(1500);
    ok((await donde()) === '/login.html', 'y SE QUEDA en el ingreso (no vuelve a entrar solo)', await donde());
    ok(await ev("document.getElementById('form-elegir-acceso').style.display === 'block'"), 'se ve la pantalla «¿Cómo va a ingresar?»');
    ok(!(await ls('sesion_token_cierre')) && !(await ls('app_cuenta_activa_id')) && !(await ls('offline_usuario_id')), 'el celular queda sin token, sin cuenta activa y sin identidad');
    ok(!(await ls('logout_pendiente')), 'el servidor confirmó el cierre: no queda logout_pendiente', await ls('logout_pendiente'));
    ok((await estadoServidor(cookie)) === 401, 'EL SERVIDOR: la cookie vieja da 401');
    const rToken = await fetch(base + '/api/auth/cerrar-pendiente', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokenCierre: tokenCierre }) });
    ok(rToken.status === 200, 'presentar el token viejo no rompe nada (responde igual)');
    ok((await estadoServidor(cookie)) === 401, 'y la sesión sigue cerrada');
    await ir('/app/inicio.html', 2500);
    ok((await donde()) === '/login.html', 'REABRIR LA APP (/app/inicio.html) NO lo mete: va al ingreso', await donde());

    console.log(`\n[B] ${rol.toUpperCase()} · SIN señal`);
    await entrar();
    const cookieB = await cookieDelNavegador();
    await sinSenal(true);
    const tB = await tocar('#btn-cerrar-sesion');
    ok(tB.esElBoton, 'el toque cae sobre el botón', tB);
    ok(await esperarRuta('/login.html', 10000), 'sin señal también sale al ingreso, al instante (≤ 10 s)', await donde());
    ok(!!(await ls('logout_pendiente')), 'queda logout_pendiente (el servidor no pudo enterarse)');
    ok(!(await ls('sesion_token_cierre')) && !(await ls('app_cuenta_activa_id')), 'el celular queda sin identidad');
    ok((await estadoServidor(cookieB)) === 200, '(y la sesión del servidor sigue viva: por eso existe la guardia)');
    await ir('/app/inicio.html', 3500);
    ok((await donde()) === '/login.html', 'reabrir la app SIN señal muestra el ingreso, no entra', await donde());
    await sinSenal(false);
    await ir('/login.html', 2500);
    ok((await estadoServidor(cookieB)) === 401, 'al volver la señal, el ingreso presenta el token y el servidor CIERRA la sesión (cookie vieja → 401)');
    ok(!(await ls('logout_pendiente')), 'y ya no queda pendiente');
    await ir('/app/inicio.html', 2500);
    ok((await donde()) === '/login.html', 'con señal tampoco entra', await donde());
  }

  console.log('\n[C] COORDINADOR · el celular ya tenía una cuenta guardada («Mantener sesión») de otra vez');
  // Se simula lo que deja un ingreso anterior con «Mantener sesión»: la cuenta del dispositivo (con su token firmado) queda activa.
  const tokenAnterior = firmarTokenDispositivo(ids.coord1, null);
  await ir('/login.html');
  await ev(`(() => { const u = { id: ${ids.coord1}, nombre: 'Marta Coordinadora Ejemplo', email: 'marta@ejemplo.co', rol: 'coordinador' };
    localStorage.setItem('app_cuentas_dispositivo', JSON.stringify({ [u.id]: { usuario: u, token: ${JSON.stringify(tokenAnterior)}, guardadoEn: Date.now() } }));
    localStorage.setItem('app_cuenta_activa_id', String(u.id)); localStorage.setItem('offline_usuario_id', String(u.id)); })()`);
  await ir('/login.html', 1500);
  console.log(`     (en el ingreso: ${await donde()})`);
  await entrarCoordinador().catch(() => {});
  const rutaC = await donde();
  console.log(`     (tras entrar por la puerta del celular: ${rutaC})`);
  if (rutaC === '/app/inicio.html') {
    const cookieC = await cookieDelNavegador();
    const tC = await tocar('#btn-cerrar-sesion');
    ok(tC.esElBoton, 'el toque cae sobre el botón', tC);
    ok(await esperarRuta('/login.html', 8000), 'cierra y queda en el ingreso', await donde());
    await espera(1500);
    ok((await donde()) === '/login.html', 'y no vuelve a entrar solo', await donde());
    ok((await estadoServidor(cookieC)) === 401, 'la cookie de la sesión del celular quedó cerrada en el servidor');
    ok(!(await ls('app_cuenta_activa_id')), 'y no queda cuenta activa en el celular', await ls('app_cuenta_activa_id'));
    await ir('/app/inicio.html', 2500);
    ok((await donde()) === '/login.html', 'reabrir la app no lo mete (aunque su cuenta siga guardada en el selector)', await donde());
  }
  await ev("localStorage.clear()");

  // ---------------------------------------------------------------------------------------------------------------- D
  console.log('\n[D] Admin cierra igual, y el coordinador vuelve a entrar con su cédula y clave');
  await entrarAdminPorCorreo();
  const cookieAd = await cookieDelNavegador();
  await ir('/app/inicio.html', 1500);
  const tAd = await tocar('#btn-cerrar-sesion');
  ok(tAd.esElBoton && await esperarRuta('/login.html', 8000), 'el administrador cierra sesión desde su inicio', tAd);
  await espera(800);
  ok((await estadoServidor(cookieAd)) === 401 && (await donde()) === '/login.html', 'y su sesión muere en el servidor');
  await entrarCoordinador();
  ok((await donde()) === '/app/inicio.html', 'el coordinador vuelve a entrar con su cédula y clave', await donde());

  console.log('\n[F] Diagnóstico: el botón «Atrás» y el selector de cuentas guardadas tras cerrar sesión (coordinador)');
  await ir('/app/inicio.html', 1500);             // [D] terminó con el coordinador dentro
  await esperar("!document.getElementById('panel-coordinador').hidden");
  const cookieF = await cookieDelNavegador();
  await tocar('#btn-cerrar-sesion');
  await esperarRuta('/login.html', 8000); await espera(800);
  await ev('history.back()'); await espera(2500);
  const trasAtras = await donde();
  const veInicio = await ev("!!document.getElementById('panel-coordinador') && !document.getElementById('panel-coordinador').hidden");
  console.log(`     (tras «Atrás»: ${trasAtras}; el encabezado del coordinador ${veInicio ? 'SE VE' : 'no se ve'}; sesión del servidor: ${await estadoServidor(cookieF)})`);
  ok((await estadoServidor(cookieF)) === 401, 'aunque «Atrás» muestre una página vieja, la sesión del servidor está cerrada');
  ok(trasAtras === '/login.html' || trasAtras === '/app/inicio.html', 'tras «Atrás» queda en una de las dos', trasAtras);
  const cuentasGuardadas = await ev("Object.keys(JSON.parse(localStorage.getItem('app_cuentas_dispositivo') || '{}')).length");
  console.log(`     (cuentas guardadas en el celular tras cerrar: ${cuentasGuardadas})`);

  console.log('\n[E] La consola');
  ok(p.avisos.length === 0, 'ninguna excepción de JavaScript en toda la prueba', p.avisos);
  nav.cerrar(); servidor.close();
  try { almacen.close(); } catch (_) { /* nada */ }
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO BIEN'} (${pasos} comprobaciones)`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
