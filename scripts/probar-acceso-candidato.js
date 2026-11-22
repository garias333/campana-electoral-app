#!/usr/bin/env node
// scripts/probar-acceso-candidato.js
//
// Prueba de la ORDEN 101 EN CHROMIUM REAL (CDP): la pantalla «Ingresar con código» del celular (login.html) con el botón «Acceso a candidato» arriba y el orden nuevo:
//   título · «Acceso a candidato» · campo de correo/celular con su ayuda · «Mantener sesión iniciada por 7 días» · «Enviar código» · «¿Olvidaste tu contraseña?» (18 px, ≥ 44 px de alto).
// «Acceso a candidato» abre el formulario de cédula y contraseña (mismo POST /auth/login). El computador (1280 px) no cambia.
//
// USO (sobre una base desechable ya inicializada con init-db; sin otra prueba con Chromium a la vez):
//   DB_HOST=127.0.0.1 DB_PORT=33101 DB_USER=root DB_PASSWORD= DB_NAME=simulada101 [SALIDA=/ruta/capturas] node scripts/probar-acceso-candidato.js
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
const pool = require('../config/db');
const { sembrar, crearApp, CLAVE_ADMIN } = require('./fixtures/coordinadores-celular');
const { lanzar, espera } = require('./capturas/navegador');

const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden101');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); }
}

const CEDULA_CAND = '1099000001'; const CLAVE_CAND = '482913';
const CEDULA_ADMCAND = '1099000101'; const CORREO_ADMCAND = 'admin.cand101@ejemplo.co'; const CLAVE_ADMCAND = '735091';

(async () => {
  const { ids } = await sembrar(pool);
  const rol = async (n) => (await pool.query('SELECT id FROM roles WHERE nombre = ?', [n]))[0][0].id;
  const hash = (t) => bcrypt.hashSync(t, 4);
  await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, clave_celular_pregunta_hecha)
      VALUES ('Juan Candidato Ejemplo', ?, ?, 'candidato101@ejemplo.co', '3001230001', ?, ?, 1, 1)`, [CEDULA_CAND, CEDULA_CAND, hash(CLAVE_CAND), await rol('candidato')]);
  await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, es_candidato, clave_celular_pregunta_hecha)
      VALUES ('Admin Es Candidato', ?, ?, ?, '3001230101', ?, ?, 1, 1, 1)`, [CEDULA_ADMCAND, CEDULA_ADMCAND, CORREO_ADMCAND, hash(CLAVE_ADMCAND), await rol('admin')]);

  const s = http.createServer(crearApp(pool));
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;

  const pantalla = async (ancho, alto, movil) => {
    await cmd('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: movil ? 2 : 1, mobile: movil });
    await cmd('Emulation.setTouchEmulationEnabled', { enabled: movil });
  };
  const ir = async (url) => { await cmd('Page.navigate', { url }); await espera(900); };
  const esperar = async (expr, ms = 10000) => {
    const hasta = Date.now() + ms;
    while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); }
    return false;
  };
  const foto = async (nombre) => {
    const r = await cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  // Página entera (no solo la parte que cabe en 844 px): así se ve el orden completo hasta «¿Olvidaste tu contraseña?».
  const fotoCompleta = async (nombre) => {
    const h = await ev('document.documentElement.scrollHeight'); const w = await ev('window.innerWidth');
    const r = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
    fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  const sinDesborde = () => ev('document.documentElement.scrollWidth <= window.innerWidth');
  const escribir = (sel, valor) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value = ${JSON.stringify(valor)}; e.dispatchEvent(new Event('input', { bubbles: true })); return e.value; })()`);
  const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const salir = () => ev("fetch('/api/auth/logout', { method: 'POST' }).then(r => r.status)");
  const visible = (id) => ev(`getComputedStyle(document.getElementById(${JSON.stringify(id)})).display !== 'none'`);
  const abrirTorreCelular = async (sufijo = '') => {
    await ir(base + '/login.html' + sufijo);
    await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
    await click('#ir-a-otros-desde-eleccion'); await espera(250);
  };

  // Los elementos de la pantalla, en el orden en que deben verse de arriba abajo.
  const ORDEN = [
    ['logo', '.login-logo'], ['título', '#login-titulo'], ['botón Acceso a candidato', '#ir-a-candidato'],
    ['campo correo/celular', '#campo-identificador'], ['ayuda del campo', '#pista-canal'], ['Mantener sesión 7 días', '#campo-recordar-torre'],
    ['Enviar código', '#form-torre button[type=submit]'], ['¿Olvidaste tu contraseña?', '#pie-olvido a'],
  ];
  const medir = () => ev(`(() => ${JSON.stringify(ORDEN)}.map(([n, sel]) => { const e = document.querySelector(sel); const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
    return { n, sel, top: Math.round(r.top + scrollY), alto: Math.round(r.height), ancho: Math.round(r.width), visible: c.display !== 'none' && r.height > 0, fuente: c.fontSize, texto: (e.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 60) }; }))()`);

  for (const [ancho, alto] of [[360, 740], [390, 844], [412, 915]]) {
    console.log(`\n[celular ${ancho}×${alto}] orden y medidas de «Ingresar con código»`);
    await pantalla(ancho, alto, true);
    await abrirTorreCelular();
    const m = await medir();
    console.log('     ' + m.map((x) => `${x.n}@${x.top}`).join(' | '));
    ok(m.every((x) => x.visible), 'todos los elementos están a la vista', m.filter((x) => !x.visible));
    ok(m.every((x, i) => i === 0 || x.top > m[i - 1].top), 'orden exacto: logo · título · Acceso a candidato · correo/celular · ayuda · Mantener sesión · Enviar código · ¿Olvidaste…?', m.map((x) => x.n + ':' + x.top));
    const por = (n) => m.find((x) => x.n === n);
    ok(por('título').texto === 'Ingresar con código', 'título «Ingresar con código» como hoy', por('título').texto);
    ok(por('botón Acceso a candidato').texto === 'Acceso a candidato', 'botón «Acceso a candidato»', por('botón Acceso a candidato').texto);
    ok(por('botón Acceso a candidato').alto >= 52, 'el botón mide ≥ 52 px de alto', por('botón Acceso a candidato').alto);
    const form = await ev("Math.round(document.getElementById('form-torre').getBoundingClientRect().width)");
    ok(por('botón Acceso a candidato').ancho >= form - 1, 'el botón ocupa el ancho completo', { boton: por('botón Acceso a candidato').ancho, form });
    ok(/Mantener sesión iniciada por 7 días/.test(por('Mantener sesión 7 días').texto), 'texto «Mantener sesión iniciada por 7 días»', por('Mantener sesión 7 días').texto);
    ok(/Enviar código/i.test(por('Enviar código').texto), 'botón «Enviar código»', por('Enviar código').texto);
    ok(por('¿Olvidaste tu contraseña?').fuente === '18px', '«¿Olvidaste tu contraseña?» a 18 px', por('¿Olvidaste tu contraseña?').fuente);
    ok(por('¿Olvidaste tu contraseña?').alto >= 44, '«¿Olvidaste…?» mide ≥ 44 px de alto (se toca fácil)', por('¿Olvidaste tu contraseña?').alto);
    const viejo = await ev("getComputedStyle(document.getElementById('ir-a-password')).display");
    ok(viejo === 'none', '«Ingresar con usuario y contraseña» ya no se ve en esta pantalla', viejo);
    const pie = await ev(`(() => { const a = document.querySelector('#pie-ingreso-correo a'); const o = document.querySelector('#pie-olvido a'); const r = a.getBoundingClientRect(); return { texto: a.innerText.trim(), debajo: r.top > o.getBoundingClientRect().top, fuente: getComputedStyle(a).fontSize, alto: Math.round(r.height) }; })()`);
    ok(pie.texto === 'Ingresar con correo y contraseña' && pie.debajo && parseFloat(pie.fuente) < 18, 'enlace pequeño «Ingresar con correo y contraseña» debajo de «¿Olvidaste…?» (administración)', pie);
    ok(await sinDesborde(), 'sin desborde horizontal (scrollWidth <= innerWidth)');
    if (ancho === 390) { await foto('1-ingresar-con-codigo-390x844'); await fotoCompleta('1b-ingresar-con-codigo-390-pagina-completa'); }
  }

  console.log('\n[celular 390×844] «Acceso a candidato» abre el formulario');
  await pantalla(390, 844, true);
  await abrirTorreCelular();
  await click('#ir-a-candidato'); await espera(300);
  const f = await ev(`({ vis: ['form-elegir-acceso','form-torre','form-login','form-coordinador','form-candidato','form-2fa'].filter((id) => getComputedStyle(document.getElementById(id)).display !== 'none'),
    titulo: document.getElementById('login-titulo').innerText, cedula: document.querySelector('label[for=campo-cedula-cand]').innerText, clave: document.querySelector('label[for=campo-clave-cand]').innerText,
    modoCedula: document.getElementById('campo-cedula-cand').inputMode, modoClave: document.getElementById('campo-clave-cand').inputMode, tipoClave: document.getElementById('campo-clave-cand').type,
    volver: document.getElementById('volver-desde-candidato').innerText.trim() })`);
  ok(f.vis.join() === 'form-candidato' && f.titulo === 'Acceso a candidato', 'abre el formulario «Acceso a candidato»', f);
  ok(f.cedula === 'Número de cédula' && f.clave === 'Contraseña', 'etiquetas «Número de cédula» y «Contraseña»', f);
  ok(f.modoCedula === 'numeric' && f.modoClave === 'numeric' && f.tipoClave === 'password', 'teclado numérico en los dos campos y la contraseña oculta', f);
  ok(f.volver === '← Volver', 'enlace «← Volver»', f.volver);
  ok(await sinDesborde(), 'sin desborde horizontal');
  await foto('2-acceso-a-candidato-390x844');
  await click('#volver-desde-candidato'); await espera(250);
  const vuelta = await ev("({ torre: getComputedStyle(document.getElementById('form-torre')).display !== 'none', titulo: document.getElementById('login-titulo').innerText })");
  ok(vuelta.torre && vuelta.titulo === 'Ingresar con código', '«← Volver» regresa a «Ingresar con código»', vuelta);

  console.log('\n[celular 390×844] se entra con el formulario');
  const entrar = async (usuario, clave) => {
    await abrirTorreCelular();
    await click('#ir-a-candidato');
    await escribir('#campo-cedula-cand', usuario); await escribir('#campo-clave-cand', clave);
    await click('#form-candidato button[type=submit]');
  };
  await entrar(CEDULA_CAND, CLAVE_CAND);
  ok(await esperar("location.pathname === '/app/candidato.html'"), 'el CANDIDATO entra con cédula + 6 dígitos → /app/candidato.html', await ev('location.pathname'));
  await salir();
  await entrar(CEDULA_ADMCAND, CLAVE_ADMCAND);
  ok(await esperar("location.pathname === '/app/candidato.html'"), 'el administrador «Es el candidato» entra con su cédula → /app/candidato.html', await ev('location.pathname'));
  await salir();
  await entrar(CORREO_ADMCAND, CLAVE_ADMCAND);
  ok(await esperar("location.pathname === '/app/candidato.html'"), 'el administrador «Es el candidato» con su CORREO, en el mismo formulario, también entra', await ev('location.pathname'));
  await salir();
  await entrar('admin.ej@ejemplo.co', CLAVE_ADMIN);
  ok(await esperar("location.pathname === '/app/admin-panel.html'"), 'un administrador por CORREO en ese mismo formulario entra (a su panel del celular)', await ev('location.pathname'));
  await salir();
  await entrar(CEDULA_CAND, '000000');
  await espera(900);
  const err = await ev("({ ruta: location.pathname, msg: document.getElementById('login-error').innerText, vis: document.getElementById('login-error').classList.contains('visible'), vacia: document.getElementById('campo-clave-cand').value === '' })");
  ok(err.ruta === '/login.html' && err.vis && /inv[aá]lidas/i.test(err.msg) && err.vacia, 'una contraseña mala muestra el error y vacía el campo', err);

  console.log('\n[celular 390×844] el ingreso con enlace pequeño y las demás vías siguen');
  await abrirTorreCelular();
  await click('#ir-a-password-correo'); await espera(250);
  ok(await visible('form-login') && await ev("document.querySelector('label[for=campo-email]').innerText") === 'Correo electrónico o número de identificación', 'el enlace pequeño abre el formulario completo de correo y contraseña');
  await escribir('#campo-email', 'admin.ej@ejemplo.co'); await escribir('#campo-password', CLAVE_ADMIN);
  await click('#form-login button[type=submit]');
  ok(await esperar("location.pathname === '/app/admin-panel.html'"), 'el administrador entra por correo y contraseña desde ese enlace', await ev('location.pathname'));
  await salir();
  await abrirTorreCelular();
  await escribir('#campo-identificador', 'admin.ej@ejemplo.co');
  await click('#form-torre button[type=submit]');
  ok(await esperar("getComputedStyle(document.getElementById('form-2fa')).display !== 'none'"), '«Enviar código» sigue funcionando: pasa a «Escribe tu código»', await ev("document.getElementById('login-error').innerText"));
  ok(/Escribe tu c/.test(await ev("document.getElementById('login-titulo').innerText")), 'con el título «Escribe tu código»');
  // Las otras puertas del celular no se tocan.
  await ir(base + '/login.html'); await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
  const puertas = await ev("[...document.querySelectorAll('#form-elegir-acceso button')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.innerText.trim())");
  ok(JSON.stringify(puertas) === JSON.stringify(['Acceso a Líderes y Sublíderes', 'Acceso a Aspirantes al Concejo', 'Acceso a Coordinadores', 'Otros usuarios']), 'las puertas de «¿Cómo va a ingresar?» siguen igual y en su orden', puertas);
  const olvidoEleccion = await ev("getComputedStyle(document.querySelector('#pie-olvido a')).fontSize");
  ok(olvidoEleccion !== '18px', 'en las otras pantallas «¿Olvidaste…?» conserva su tamaño de siempre', olvidoEleccion);

  console.log('\n[celular 390×844, abierto con ?app=1 en pantalla ancha]');
  await pantalla(1000, 800, false);
  await abrirTorreCelular('?app=1');
  const m1 = await medir();
  ok(m1.every((x, i) => i === 0 || x.top > m1[i - 1].top) && m1.every((x) => x.visible), 'con ?app=1 se ve el orden nuevo', m1.map((x) => x.n + ':' + x.top));

  console.log('\n[computador 1280×800] sin cambios');
  await pantalla(1280, 800, false);
  await ir(base + '/login.html'); await espera(500);
  const pc = await ev(`({ clase: document.documentElement.classList.contains('login-celular'), lista: getComputedStyle(document.getElementById('form-elegir-acceso')).display, torre: getComputedStyle(document.getElementById('form-torre')).display,
    titulo: document.getElementById('login-titulo').innerText, candidato: getComputedStyle(document.getElementById('bloque-acceso-candidato')).display,
    password: getComputedStyle(document.getElementById('ir-a-password')).display, correo: getComputedStyle(document.getElementById('pie-ingreso-correo')).display,
    olvido: getComputedStyle(document.querySelector('#pie-olvido a')).fontSize,
    orden: [...document.querySelectorAll('#form-torre > *')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.id || e.tagName.toLowerCase() + (e.type ? '[' + e.type + ']' : '')) })`);
  ok(!pc.clase && pc.lista === 'none' && pc.torre !== 'none' && pc.titulo === 'Ingresar con código', 'el computador sigue viendo «Ingresar con código» directo, sin la lista de puertas', pc);
  ok(pc.candidato === 'none' && pc.correo === 'none', 'sin «Acceso a candidato» ni el enlace pequeño', pc);
  ok(pc.password !== 'none', 'conserva el botón «Ingresar con usuario y contraseña»', pc);
  ok(pc.olvido !== '18px', '«¿Olvidaste tu contraseña?» conserva su tamaño de siempre', pc.olvido);
  ok(JSON.stringify(pc.orden) === JSON.stringify(['div', 'div', 'pista-canal', 'button[submit]', 'ir-a-password']),
    'el orden del computador es el de siempre (texto, campo, ayuda, Enviar código, usuario y contraseña; «Mantener sesión» ya estaba oculto en el computador)', pc.orden);
  ok(await sinDesborde(), 'sin desborde horizontal');
  await foto('3-escritorio-1280x800');
  await click('#ir-a-password'); await espera(250);
  ok(await visible('form-login'), 'en el computador «Ingresar con usuario y contraseña» abre el formulario de siempre');

  console.log('\n[la consola]');
  ok(p.avisos.length === 0, 'ninguna excepción de JavaScript en toda la prueba', p.avisos);

  nav.cerrar(); s.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO BIEN'} (${pasos} comprobaciones). Capturas en ${SALIDA}`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
