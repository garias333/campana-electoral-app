#!/usr/bin/env node
// scripts/probar-candidato-ingreso-biografia.js — ORDEN 86:
//   1. La biografía del candidato sale en «Información para compartir» (con y sin biografía cargada, con botón de compartir).
//   2. El candidato (rol «candidato» y administrador con «Es el candidato») que entra desde el celular cae SIEMPRE en /app/candidato.html: en vertical (390×844), en
//      horizontal (844×390), con la app instalada a cualquier ancho, con ?app=1, y aunque haya quedado el modo «administrador»; nunca en dashboard.html.
//      Desde un computador (1280 px, sin ?app=1) el administrador sigue en el escritorio.
//   3. Autorización de equipo SIN CAMBIOS (decisión de Gildardo: no se crea ninguna excepción): el rol «candidato» no la pide; el administrador (con o sin la marca) la pide como hoy.
//
// USO (base desechable con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada86 [SALIDA=/ruta] node scripts/probar-candidato-ingreso-biografia.js
// Se niega a correr si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) { console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`); process.exit(2); }
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { sembrar } = require('./fixtures/coordinadores-celular');
const { lanzar, espera } = require('./capturas/navegador');

const RAIZ = path.join(__dirname, '..');
const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden86');
fs.mkdirSync(SALIDA, { recursive: true });
const CLAVE = 'Clave-Prueba-86x';
const CORREOS = { candidato: 'candidato86@ejemplo.co', admcand: 'admcand86@ejemplo.co', admsin: 'admsin86@ejemplo.co' };
const BIOGRAFIA = 'Nació en el barrio Los Ejemplos, estudió en la universidad pública y lleva veinte años trabajando con las juntas de acción comunal. Propone empleo, vías y salud para todos los barrios de la ciudad. '.repeat(2).trim();

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
  app.use('/api', require(path.join(RAIZ, 'middleware/soloLecturaCandidato')).soloLecturaCandidato);
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
  const pedir = async (metodo, ruta, cuerpo) => {
    const h = { 'Content-Type': 'application/json' };
    if (cookie) h.Cookie = cookie;
    const r = await fetch(base + '/api' + ruta, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), redirect: 'manual' });
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const texto = await r.text(); let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
    return { status: r.status, datos, texto };
  };
  return { get: (r) => pedir('GET', r), post: (r, b) => pedir('POST', r, b || {}) };
}

(async () => {
  const servidor = http.createServer(crearApp());
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const { ids } = await sembrar(pool);
  const hash = bcrypt.hashSync(CLAVE, 4);
  const rol = async (n) => (await q('SELECT id FROM roles WHERE nombre = ?', [n]))[0].id;
  const insertar = async (nombre, cedula, correo, rolNombre, esCand) => pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, es_candidato, clave_celular_pregunta_hecha)
     VALUES (?, ?, ?, ?, '3001230000', ?, ?, 1, ?, 1)`, [nombre, cedula, cedula, correo, hash, await rol(rolNombre), esCand ? 1 : 0]);
  await insertar('Juan Candidato Pérez', '1099860001', CORREOS.candidato, 'candidato', false);
  await insertar('Admin Candidato', '1099860002', CORREOS.admcand, 'admin', true);
  await insertar('Admin Sin Marca', '1099860003', CORREOS.admsin, 'admin', false);
  const lideres = ids.ana;
  await q("UPDATE configuracion_campana SET nombre_candidato = 'Juan Candidato Pérez' WHERE id = 1");
  const ponerBio = (texto) => q(`INSERT INTO contenido_paginas (clave, titulo, contenido) VALUES ('biografia_candidato', 'Biografía del candidato', ?) ON DUPLICATE KEY UPDATE contenido = VALUES(contenido)`, [texto]);

  /* ====================== HTTP: autorización de equipo, sin cambios ====================== */
  console.log('\n[1] Autorización de equipo: SIN CAMBIOS (cupo de 1 equipo con aprobación; cada cliente HTTP es un equipo nuevo)');
  await q('INSERT INTO licencia_equipos_config (id, max_equipos, requiere_aprobacion) VALUES (1, 1, 1) ON DUPLICATE KEY UPDATE max_equipos = 1, requiere_aprobacion = 1');
  let r = await cliente().post('/auth/login', { email: CORREOS.candidato, password: CLAVE });
  ok(r.status === 200 && r.datos.usuario && r.datos.usuario.rol === 'candidato' && !r.datos.equipoNoAutorizado, 'el rol «candidato» entra desde un equipo nuevo SIN pantalla de autorización (como hoy)', r.datos);
  r = await cliente().post('/auth/login', { email: CORREOS.admcand, password: CLAVE });
  ok(r.status === 403 && r.datos.equipoNoAutorizado === true, 'el administrador «Es el candidato» la pide como cualquier administrador (equipo nuevo → 403 equipoNoAutorizado)', r);
  r = await cliente().post('/auth/login', { email: CORREOS.admsin, password: CLAVE });
  ok(r.status === 403 && r.datos.equipoNoAutorizado === true, 'el administrador sin la marca, igual que hoy', r);
  r = await cliente().post('/auth/login', { email: 'marta@ejemplo.co', password: require('./fixtures/coordinadores-celular').CLAVE_CORREO });
  ok(r.status === 200 && !r.datos.equipoNoAutorizado, 'un coordinador, igual que hoy (no se le pide)', r.datos);
  await q('UPDATE licencia_equipos_config SET max_equipos = 0, requiere_aprobacion = 0 WHERE id = 1');
  ok((await q('SELECT COUNT(*) n FROM equipos_autorizados e JOIN usuarios u ON u.id = e.ultimo_usuario_id JOIN roles r ON r.id = u.rol_id WHERE r.nombre = ?', ['candidato']))[0].n === 0, 'el rol «candidato» no dejó ningún equipo registrado');
  const [[expC]] = await pool.query("SELECT COUNT(*) n FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE (r.nombre = 'candidato') OR (r.nombre = 'admin' AND u.es_candidato = 1)");
  console.log('    usuarios con EXCEPCIÓN de autorización creada por esta orden: 0 (no se creó ninguna). Candidatos en esta base de pruebas:', expC.n);

  /* ====================== NAVEGADOR ====================== */
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  const movil = (w = 390, h = 844) => cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  const escritorio = () => cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const tactil = (si) => cmd('Emulation.setTouchEmulationEnabled', { enabled: !!si });
  /* Chromium no deja emular `display-mode` con setEmulatedMedia: se parcha matchMedia en cada documento nuevo para que «(display-mode: standalone)» diga que sí (app instalada). */
  let idParche = null;
  const instalada = async (si) => {
    if (idParche) { await cmd('Page.removeScriptToEvaluateOnNewDocument', { identifier: idParche }); idParche = null; }
    if (si) {
      const r = await cmd('Page.addScriptToEvaluateOnNewDocument', { source: "(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => /display-mode:\\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); })();" });
      idParche = r.result.identifier;
    }
  };
  const ir = async (url) => { await cmd('Page.navigate', { url }); await espera(1000); };
  const esperar = async (expr, ms = 9000) => { const hasta = Date.now() + ms; while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); } return false; };
  const foto = async (nombre) => { const x = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(x.result.data, 'base64')); };
  const sinDesborde = () => ev('document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1');
  const ruta = () => ev('location.pathname + location.search');
  // Al borrar las cookies, la pantalla anterior (aún cargando) pierde su sesión y lanza un error de promesa que es de la prueba, no de la app: se descarta tras la limpieza.
  const limpiar = async () => { await cmd('Network.clearBrowserCookies'); await ir(base + '/login.html'); await ev('localStorage.clear(); sessionStorage.clear()'); await espera(700); p.avisos.length = 0; };
  // Por la pantalla: «Otros usuarios» → correo y contraseña (la puerta del candidato en el celular y del administrador).
  const entrarPorLaPantalla = async (correo, url = '/login.html') => {
    await ir(base + url);
    await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
    await ev("document.getElementById('ir-a-otros-desde-eleccion').click()");
    await ev("document.getElementById('ir-a-password').click()");
    await ev(`(() => { document.getElementById('campo-email').value = ${JSON.stringify(correo)}; document.getElementById('campo-password').value = ${JSON.stringify(CLAVE)}; document.querySelector('#form-login button[type=submit]').click(); })()`);
  };
  const entrarPorApi = async (correo) => {
    await ev(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(correo)}, password: ${JSON.stringify(CLAVE)} }) }).then(x => x.status)`);
  };

  console.log('\n[2] Biografía en «Información para compartir» (celular 390×844, con la app del candidato)');
  await movil(); await tactil(true); await instalada(false);
  await limpiar();
  await ponerBio(BIOGRAFIA);
  await entrarPorLaPantalla(CORREOS.candidato);
  ok(await esperar("location.pathname === '/app/candidato.html'", 12000), 'el candidato entra y cae en su app', { ruta: await ruta(), error: await ev("(document.getElementById('login-error') || {}).innerText"), vis: await ev("[...document.querySelectorAll('form')].filter(f => f.offsetParent !== null).map(f => f.id)") });
  p.avisos.length = 0; p.respuestas.length = 0;
  await ir(base + '/app/candidato-mas.html'); await esperar("document.querySelectorAll('.menu-boton').length > 0");
  const hayEnlace = await ev("!![...document.querySelectorAll('a.menu-boton')].find(a => /informacion\\.html/.test(a.getAttribute('href')))");
  ok(hayEnlace, '«Más» del candidato trae «Información para compartir»');
  await ir(base + '/app/informacion.html?modo=informacion');
  ok(await esperar("document.getElementById('contenedor').style.display === 'block' && !!document.getElementById('tarjeta-biografia')", 10000), 'aparece la tarjeta de la biografía');
  const t1 = await ev(`({ titulo: document.querySelector('#tarjeta-biografia h3').innerText, tipo: document.querySelector('#tarjeta-biografia .rec-tipo').innerText, extracto: document.querySelector('#tarjeta-biografia .bio-extracto').innerText,
    botones: [...document.querySelectorAll('#tarjeta-biografia .btn-app')].map(b => b.innerText.trim()), primera: document.querySelector('#lista-recursos').firstElementChild.id, chips: [...document.querySelectorAll('#filtros-app .chip-app')].map(c => c.innerText.trim()), vacio: getComputedStyle(document.getElementById('vacio')).display })`);
  console.log('    tarjeta:', JSON.stringify({ ...t1, extracto: t1.extracto.slice(0, 60) + '…' }));
  ok(t1.titulo === 'Juan Candidato Pérez' && /Biografía/i.test(t1.tipo), 'con el nombre del candidato y la etiqueta «Biografía»', t1);
  ok(t1.extracto.length > 100 && t1.extracto.length <= 262 && /…$/.test(t1.extracto), 'muestra un extracto de la biografía', t1.extracto.length);
  ok(t1.botones.join('|') === 'Ver biografía completa|Compartir', 'con «Ver biografía completa» y «Compartir»', t1.botones);
  ok(t1.primera === 'tarjeta-biografia' && t1.vacio === 'none', 'va primero en la lista y no sale «todavía no hay contenido»', t1);
  ok(t1.chips.includes('👤 Biografía'), 'y hay un filtro «Biografía»', t1.chips);
  ok(await sinDesborde() && p.avisos.length === 0, 'sin desborde ni errores de consola', p.avisos);
  await foto('1-informacion-con-biografia-390x844');
  await ev("window.__compartido = null; navigator.share = async (d) => { window.__compartido = d; }");
  await ev("document.querySelector('[data-compartir-bio]').click()"); await espera(300);
  const comp = await ev('window.__compartido');
  ok(comp && comp.title === 'Juan Candidato Pérez' && comp.text.startsWith('Juan Candidato Pérez') && /Los Ejemplos/.test(comp.text), '«Compartir» abre la hoja de compartir con el nombre y el texto', comp);
  await ev("document.querySelector('#filtros-app .chip-app:last-child').click()"); await espera(200);
  ok(await ev("document.querySelectorAll('#lista-recursos > *').length === 1 && !!document.getElementById('tarjeta-biografia')"), 'el filtro «Biografía» deja solo la tarjeta');
  await ir(base + '/app/informacion.html?modo=publicidad'); await esperar("document.getElementById('contenedor').style.display === 'block'");
  ok(await ev("!document.getElementById('tarjeta-biografia') && ![...document.querySelectorAll('#filtros-app .chip-app')].some(c => /Biografía/.test(c.innerText))"), '«Publicidad descargable» no lleva la biografía');
  // Sin biografía cargada
  await q("DELETE FROM contenido_paginas WHERE clave = 'biografia_candidato'");
  await ir(base + '/app/informacion.html?modo=informacion'); await esperar("!!document.getElementById('tarjeta-biografia')");
  const t0 = await ev("({ texto: document.querySelector('#tarjeta-biografia').innerText, botones: [...document.querySelectorAll('#tarjeta-biografia .btn-app')].map(b => b.innerText.trim()) })");
  ok(/Aún no hay biografía cargada\./.test(t0.texto) && t0.botones.length === 0 && !/Compartir contenido/.test(t0.texto), 'sin biografía: «Aún no hay biografía cargada.» (no se esconde), sin botones; al candidato no se le dice dónde se escribe', t0);
  await foto('2-informacion-sin-biografia-390x844');
  // Otros roles (líder) y administrador
  await q("UPDATE usuarios SET password_hash = ?, email = 'ana86@ejemplo.co' WHERE id = ?", [hash, lideres]);
  await ponerBio(BIOGRAFIA);
  await limpiar();
  await entrarPorApi('ana86@ejemplo.co'); await espera(500);
  await ir(base + '/app/informacion.html?modo=informacion');
  ok(await esperar("!!document.getElementById('tarjeta-biografia')", 10000), 'donde la ven los demás roles (líder) también aparece la biografía');
  await limpiar(); await entrarPorApi(CORREOS.admsin); await espera(500);
  await q("DELETE FROM contenido_paginas WHERE clave = 'biografia_candidato'");
  await ir(base + '/app/informacion.html?modo=informacion'); await esperar("!!document.getElementById('tarjeta-biografia')");
  ok(/Compartir contenido/.test(await ev("document.getElementById('tarjeta-biografia').innerText")), 'sin biografía, al administrador se le dice dónde se llena («Compartir contenido» → Biografía del candidato)');
  await ponerBio(BIOGRAFIA);

  console.log('\n[3] Ingreso SIEMPRE a la app del celular');
  const casos = [
    { nombre: 'vertical 390×844', ajustar: async () => { await movil(390, 844); await tactil(true); await instalada(false); }, url: '/login.html' },
    { nombre: 'horizontal 844×390', ajustar: async () => { await movil(844, 390); await tactil(true); await instalada(false); }, url: '/login.html' },
    { nombre: 'app instalada a 1280 px', ajustar: async () => { await escritorio(); await tactil(false); await instalada(true); }, url: '/login.html' },
    { nombre: 'login.html?app=1 a 1280 px', ajustar: async () => { await escritorio(); await tactil(false); await instalada(false); }, url: '/login.html?app=1' },
  ];
  for (const caso of casos) {
    for (const quien of ['candidato', 'admcand']) {
      await caso.ajustar(); await limpiar();
      if (quien === 'admcand') await ev("sessionStorage.setItem('modo_admin_candidato', 'admin'); localStorage.setItem('modo_admin_candidato', 'admin'); localStorage.setItem('admin_preferir_escritorio', '1')");
      // En esos anchos la pantalla de elección puede no ser la de celular: se entra por la API y se llama a la misma función que usa el formulario.
      await ir(base + caso.url); await espera(600);
      const llegaA = await ev(`(async () => { const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(CORREOS[quien])}, password: ${JSON.stringify(CLAVE)} }) }); const d = await r.json(); irDondeCorresponde(d.usuario); return r.status; })()`);
      const cae = await esperar("location.pathname.startsWith('/app/candidato') || location.pathname === '/dashboard.html' || location.pathname === '/app/admin-panel.html'", 12000);
      ok(llegaA === 200 && cae && (await ev('location.pathname')) === '/app/candidato.html', `${quien === 'candidato' ? 'candidato' : 'administrador «Es el candidato»'}, ${caso.nombre}: cae en /app/candidato.html${quien === 'admcand' ? ' (aunque haya quedado el modo administrador y «ver escritorio»)' : ''}`, await ruta());
      if (quien === 'admcand') ok(await ev("sessionStorage.getItem('modo_admin_candidato')") !== 'admin', '   y el modo administrador recordado se borra');
    }
  }
  // Por la pantalla de verdad, en horizontal (la pantalla de ingreso debe ser la del celular)
  await movil(844, 390); await tactil(true); await instalada(false); await limpiar();
  await ir(base + '/login.html');
  ok(await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'"), 'en horizontal la pantalla de ingreso es la del celular («¿Cómo va a ingresar?»)');
  await foto('3-ingreso-horizontal-844x390');
  for (const quien of ['candidato', 'admcand']) {
    await limpiar(); await movil(844, 390);
    await entrarPorLaPantalla(CORREOS[quien]);
    ok(await esperar("location.pathname === '/app/candidato.html'", 12000), `por la pantalla, en horizontal: ${quien} → /app/candidato.html`, await ruta());
    await esperar("document.getElementById('contenido').style.display !== 'none'"); await espera(800);
    if (quien === 'candidato') await foto('4-candidato-inicio-horizontal-844x390');
  }
  // App instalada: el ícono abre inicio.html (start_url) y de ahí a la app del candidato
  await movil(390, 844); await tactil(true); await instalada(true); await limpiar();
  await entrarPorApi(CORREOS.admcand); await ev("sessionStorage.setItem('modo_admin_candidato', 'admin')");
  await ir(base + '/app/inicio.html');
  ok(await esperar("location.pathname === '/app/admin-panel.html' || location.pathname === '/app/inicio.html'", 4000) && (await ev('location.pathname')) === '/app/inicio.html', 'dentro de la misma sesión, en «Modo administrador», el ícono sigue mostrando la app de administración del celular (nunca el escritorio)', await ruta());
  await ev("sessionStorage.clear()");   // la app se cerró y se volvió a abrir
  await ir(base + '/app/inicio.html');
  ok(await esperar("location.pathname === '/app/candidato.html'", 12000), 'al volver a abrir la app instalada (inicio.html, sin modo recordado) vuelve a entrar como candidato', await ruta());
  await esperar("document.getElementById('contenido').style.display !== 'none'"); await espera(800);
  await foto('5-candidato-inicio-app-instalada-390x844');
  // «Modo administrador» es la app de administración del celular, y su botón de escritorio no sale para el administrador-candidato
  await ir(base + '/app/candidato-mas.html'); await esperar("document.querySelectorAll('.menu-boton').length > 0");
  await ev("document.querySelector('button.menu-boton[data-accion=modo_admin]').click()");
  ok(await esperar("location.pathname === '/app/admin-panel.html'", 10000), '«Modo administrador» abre /app/admin-panel.html (la app de administración DEL CELULAR)', await ruta());
  await esperar("!!document.querySelector('.btn-modo-candidato')", 10000); await espera(1200);
  ok(await ev("getComputedStyle(document.getElementById('ver-escritorio')).display === 'none'"), 'y allí NO sale «Ver versión de escritorio» para el administrador que es el candidato');
  await tactil(false); await instalada(false);

  console.log('\n[4] Desde un computador (1280 px, sin ?app=1) el administrador sigue entrando al escritorio');
  for (const quien of ['admcand', 'admsin', 'candidato']) {
    await escritorio(); await limpiar();
    await ir(base + '/login.html'); await espera(600);
    await ev(`(async () => { const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(CORREOS[quien])}, password: ${JSON.stringify(CLAVE)} }) }); const d = await r.json(); irDondeCorresponde(d.usuario); })()`);
    ok(await esperar("location.pathname === '/dashboard.html'", 12000), `${quien}: en el computador cae en /dashboard.html como antes`, await ruta());
  }
  console.log('\n[5] Un administrador SIN la marca en el celular sigue como antes');
  await movil(390, 844); await tactil(true); await limpiar();
  await entrarPorLaPantalla(CORREOS.admsin);
  ok(await esperar("location.pathname === '/app/admin-panel.html'", 12000), 'celular: el administrador sin marca cae en /app/admin-panel.html', await ruta());

  ok(p.avisos.filter((x) => !/tile|Failed to load|favicon/i.test(x)).length === 0, 'sin errores de consola en todo el recorrido', p.avisos);
  nav.cerrar(); servidor.close();
  console.log(`\n${pasos - fallos}/${pasos} comprobaciones correctas.`);
  console.log(fallos ? `HAY ${fallos} FALLO(S).` : 'TODO BIEN.');
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch(async (e) => { console.error(e); try { await pool.end(); } catch (_) { /* nada */ } process.exit(1); });
