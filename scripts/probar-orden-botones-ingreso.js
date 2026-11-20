#!/usr/bin/env node
// scripts/probar-orden-botones-ingreso.js
//
// Prueba de las órdenes 64 y 66 EN CHROMIUM REAL (CDP) a 390×844 y 1366×768: el ORDEN de los botones de «¿Cómo va a ingresar?» del celular
// (Líderes y Sublíderes · Aspirantes al Concejo · Coordinadores · Testigos Electorales · Otros usuarios), que desde la Orden 66 LOS CUATRO PRIMEROS abren el mismo formulario
// de cédula y clave de 6 dígitos (cada uno con su título), «Otros usuarios» abre el ingreso con código, el texto de ayuda, la vista de computador, y que el ingreso de líder,
// coordinador y «otros usuarios» siga funcionando.
//
// USO (sobre una base desechable ya inicializada con init-db; sin otra prueba con Chromium a la vez):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada64 [SALIDA=/ruta/capturas] node scripts/probar-orden-botones-ingreso.js
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
const pool = require('../config/db');
const { sembrar, crearApp, CLAVE_CORREO } = require('./fixtures/coordinadores-celular');
const { sincronizarClaveCelular } = require('../lib/claveCelular');
const { lanzar, espera } = require('./capturas/navegador');

const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden64');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); }
}
async function escuchar(app) {
  const s = http.createServer(app);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { s, base: `http://127.0.0.1:${s.address().port}` };
}

const PEDIDO = ['Acceso a Líderes y Sublíderes', 'Acceso a Aspirantes al Concejo', 'Acceso a Coordinadores', 'Acceso a Testigos Electorales', 'Otros usuarios'];
const BOTON = {
  'Acceso a Líderes y Sublíderes': 'ir-a-lideres-desde-eleccion', 'Acceso a Aspirantes al Concejo': 'ir-a-aspirantes-desde-eleccion',
  'Acceso a Coordinadores': 'ir-a-coordinadores-desde-eleccion', 'Acceso a Testigos Electorales': 'ir-a-testigos-desde-eleccion', 'Otros usuarios': 'ir-a-otros-desde-eleccion',
};

(async () => {
  const { ids } = await sembrar(pool);
  await sincronizarClaveCelular(pool, ids.coord1);
  const actual = await escuchar(crearApp(pool));
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;

  const pantalla = async (ancho, alto, movil) => {
    await cmd('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: movil ? 2 : 1, mobile: movil });
    await cmd('Emulation.setTouchEmulationEnabled', { enabled: movil });
  };
  const ir = async (url) => { await cmd('Page.navigate', { url }); await espera(1000); };
  const esperar = async (expr, ms = 10000) => {
    const hasta = Date.now() + ms;
    while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); }
    return false;
  };
  const foto = async (nombre) => {
    const r = await cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  const sinDesborde = () => ev('document.documentElement.scrollWidth <= window.innerWidth + 1');
  const escribir = (sel, valor) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value = ${JSON.stringify(valor)}; e.dispatchEvent(new Event('input', { bubbles: true })); return e.value; })()`);
  const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const botones = () => ev("[...document.querySelectorAll('#form-elegir-acceso button')].map(b => b.innerText.trim())");
  const ayuda = () => ev("document.querySelector('#form-elegir-acceso p').innerText.replace(/\\s+/g, ' ').trim()");
  // Qué formulario queda a la vista tras tocar un botón (y cómo viene el de número de identificación).
  const que = () => ev(`(() => { const vis = ['form-elegir-acceso','form-torre','form-login','form-coordinador'].filter(id => getComputedStyle(document.getElementById(id)).display !== 'none');
    const l = document.querySelector('#form-login [name=email]');
    return { vis, titulo: document.getElementById('login-titulo').innerText, etiqueta: vis.includes('form-login') ? document.querySelector('label[for=campo-email]').innerText : null, modo: vis.includes('form-login') ? l.inputMode : null }; })()`);
  async function formularioDe(servidor, etiqueta) {
    await ir(servidor.base + '/login.html');
    await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
    await click('#' + BOTON[etiqueta]);
    await espera(300);
    return que();
  }

  console.log('\n[1] Celular 390×844: el orden y el texto de ayuda');
  await pantalla(390, 844, true);
  await ir(actual.base + '/login.html'); await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
  const bAhora = await botones(); const aAhora = await ayuda();
  await foto('1-botones-390x844');
  console.log('     ahora :', bAhora.join(' | '));
  ok(JSON.stringify(bAhora) === JSON.stringify(PEDIDO), 'Líderes y Sublíderes, Aspirantes al Concejo, Coordinadores, Testigos Electorales, Otros usuarios', bAhora);
  ok(aAhora === 'Líderes, sublíderes, aspirantes, coordinadores y testigos entran con su cédula y una clave de 6 dígitos. Administración, con su correo o celular.', 'el texto de ayuda de debajo (Orden 66)', aAhora);
  ok(await sinDesborde(), 'sin desborde horizontal');

  console.log('\n[2] Los cuatro botones abren el MISMO formulario de cédula y clave (cada uno con su título); «Otros usuarios», el ingreso con código');
  const TITULOS = { 'Acceso a Líderes y Sublíderes': 'Ingreso de líderes y sublíderes', 'Acceso a Aspirantes al Concejo': 'Ingreso de aspirantes', 'Acceso a Coordinadores': 'Ingreso de coordinadores', 'Acceso a Testigos Electorales': 'Ingreso de testigos' };
  for (const etiqueta of PEDIDO.filter((x) => x !== 'Otros usuarios')) {
    const d = await formularioDe(actual, etiqueta);
    ok(d.vis.join() === 'form-coordinador' && d.titulo === TITULOS[etiqueta], `«${etiqueta}» → formulario de cédula y clave («${d.titulo}»)`, d);
  }
  const campos = await ev(`({ cedula: document.querySelector('label[for=campo-cedula-coord]').innerText, clave: document.querySelector('label[for=campo-clave-coord]').innerText,
    ayuda: document.querySelector('#form-coordinador small').innerText.trim(), tipo: document.getElementById('campo-clave-coord').type, modo: document.getElementById('campo-clave-coord').inputMode })`);
  ok(campos.cedula === 'Número de cédula' && campos.clave === 'Clave de 6 dígitos' && campos.tipo === 'password' && campos.modo === 'numeric', 'con «Número de cédula» y «Clave de 6 dígitos» (numérica y oculta)', campos);
  ok(campos.ayuda === 'Su clave son los últimos 6 dígitos de su cédula, o la que usted eligió.', 'y el texto de ayuda nuevo', campos.ayuda);
  const otr = await formularioDe(actual, 'Otros usuarios');
  ok(otr.vis.join() === 'form-torre', 'Otros usuarios abre el ingreso con código (correo o celular)', otr);

  console.log('\n[3] El ingreso sigue funcionando (por la pantalla, en el celular)');
  const salir = () => ev("fetch('/api/auth/logout', { method: 'POST' }).then(r => r.status)");
  // Líder: por su botón.
  await ir(actual.base + '/login.html'); await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
  await click('#ir-a-lideres-desde-eleccion');
  await escribir('#campo-cedula-coord', '1055000001'); await escribir('#campo-clave-coord', '000001');
  await click('#form-coordinador button[type=submit]');
  ok(await esperar("location.pathname === '/app/inicio.html'"), 'un LÍDER entra por «Líderes y Sublíderes» con los últimos 6 de su cédula y cae en su inicio', await ev('location.pathname'));
  ok(await esperar("!document.getElementById('panel-lider').hidden"), 've su panel de líder');
  await salir();
  // Líder por el botón de Aspirantes (mismo formulario) y por Testigos: entra igual.
  for (const etiqueta of ['Acceso a Aspirantes al Concejo', 'Acceso a Testigos Electorales']) {
    await ir(actual.base + '/login.html'); await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
    await click('#' + BOTON[etiqueta]);
    await escribir('#campo-cedula-coord', '1055000001'); await escribir('#campo-clave-coord', '000001');
    await click('#form-coordinador button[type=submit]');
    ok(await esperar("location.pathname === '/app/inicio.html'"), `por «${etiqueta}» la misma persona entra igual (el servidor decide quién es)`);
    await salir();
  }
  // Coordinador por su botón.
  await ir(actual.base + '/login.html'); await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
  await click('#ir-a-coordinadores-desde-eleccion');
  await escribir('#campo-cedula-coord', '1023456789'); await escribir('#campo-clave-coord', '456789');
  await click('#form-coordinador button[type=submit]');
  ok(await esperar("location.pathname === '/app/inicio.html'"), 'un COORDINADOR entra por «Coordinadores» (cédula 1023456789 + 456789)');
  ok(await esperar("!document.getElementById('panel-coordinador').hidden"), 've «Mi equipo»');
  await salir();
  // Otros usuarios: el coordinador por correo y contraseña.
  await ir(actual.base + '/login.html'); await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
  await click('#ir-a-otros-desde-eleccion');
  await click('#ir-a-password');
  await escribir('#campo-email', 'marta@ejemplo.co'); await escribir('#campo-password', CLAVE_CORREO);
  await click('#form-login button[type=submit]');
  ok(await esperar("location.pathname === '/app/inicio.html'"), '«Otros usuarios» → usuario y contraseña: el coordinador entra por correo', await ev('location.pathname'));
  await salir();
  // Y el «Otras formas de ingresar» / volver regresa a la lista en el mismo orden.
  await ir(actual.base + '/login.html'); await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
  await click('#ir-a-lideres-desde-eleccion'); await click('#salir-de-coordinador');
  ok(JSON.stringify(await botones()) === JSON.stringify(PEDIDO) && await esperar("getComputedStyle(document.getElementById('form-elegir-acceso')).display !== 'none'"), '«Otras formas de ingresar» (desde líderes) vuelve a la lista, en el mismo orden');
  await click('#ir-a-coordinadores-desde-eleccion'); await click('#salir-de-coordinador');
  ok(JSON.stringify(await botones()) === JSON.stringify(PEDIDO) && await esperar("getComputedStyle(document.getElementById('form-elegir-acceso')).display !== 'none'"), '«Otras formas de ingresar» (desde coordinadores) también vuelve a la lista, en el mismo orden');

  console.log('\n[4] Computador 1366×768: la vista de escritorio no cambia');
  await pantalla(1366, 768, false);
  const escritorio = {};
  for (const [nombre, srv] of [['despues', actual]]) {
    await ir(srv.base + '/login.html'); await espera(700);
    escritorio[nombre] = await ev(`({ lista: getComputedStyle(document.getElementById('form-elegir-acceso')).display, torre: getComputedStyle(document.getElementById('form-torre')).display,
      titulo: document.getElementById('login-titulo').innerText, boton: document.querySelector('#form-torre button[type=submit]').innerText.trim() })`);
    await foto(`2-escritorio-${nombre}-1366x768`);
  }
  ok(escritorio.despues.lista === 'none' && escritorio.despues.torre !== 'none', 'en el computador sigue viéndose el ingreso con código, sin la lista de botones', escritorio.despues);
  ok(await sinDesborde(), 'sin desborde horizontal');

  console.log('\n[5] La consola');
  ok(p.avisos.length === 0, 'ninguna excepción de JavaScript en toda la prueba', p.avisos);
  const raros = p.respuestas.filter((r) => r.status >= 400 && r.status !== 401 &&   // los 401 de después de cerrar sesión (peticiones que la pantalla ya tenía en vuelo) no son un error
     !/\/api\/auth\/(me|login-coordinador|login|logout)\b/.test(r.url) && !/favicon/.test(r.url)
    && !/\/api\/(dia-d|votantes|inscripcion)\b/.test(r.url));   // rutas que el servidor de pruebas no monta
  ok(raros.length === 0, 'ninguna respuesta de error inesperada', raros);

  nav.cerrar(); actual.s.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO BIEN'} (${pasos} comprobaciones). Capturas en ${SALIDA}`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
