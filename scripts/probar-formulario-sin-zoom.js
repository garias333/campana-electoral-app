#!/usr/bin/env node
// scripts/probar-formulario-sin-zoom.js — Orden 95: «Agregar a la estructura» abre a escala 1 y sin desborde en el celular del candidato.
//
// Chromium real con pantalla de celular y toque (isMobile + hasTouch). Para el candidato, el administrador-candidato (modo solo candidato) y el coordinador, abre
// /territorial.html?app=1&volver=…#nuevo y comprueba, a 360/390/412 px, a 390 con la letra del sistema al 130 % y (con EXTRA=1) a 360 y 390 con 130 % y 160 %:
//   · el ancho de DISEÑO (innerWidth) es igual al de la PANTALLA (visualViewport.width) y scrollWidth <= innerWidth — es lo que descuadraba la hoja fija del formulario;
//   · visualViewport.scale == 1;
//   · «Siguiente» y, para el candidato, la barra con «Salir» y «×» quedan dentro de la pantalla, sin desplazar;
//   · un elemento de 900 px que alguien agregue mañana a la página de fondo NO ensancha el diseño (red de seguridad `overflow-x: hidden` en modo app).
// La letra grande se simula multiplicando por 1,3 (o 1,6) el tamaño de cada elemento: así crece también lo que está en px, como hace Android con el tamaño de letra del sistema.
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada95 [EXTRA=1] [SALIDA=/ruta] [ETIQ=despues] node scripts/probar-formulario-sin-zoom.js
// Se niega a correr si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.
const path = require('path');
const R = path.join(__dirname, '..');
process.chdir(R);
require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) { console.error('Me niego: DB_NAME=' + nombreBase); process.exit(2); }
process.env.SESSION_SECRET = 'secreto-de-prueba'; process.env.LICENCIA_DOMINIO = 'campana.prueba'; process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';
const fs = require('fs'), os = require('os'), http = require('http');
const express = require('express'), session = require('express-session'), bcrypt = require('bcryptjs');
const pool = require(R + '/config/db');
const { sembrar } = require('./fixtures/coordinadores-celular');
const { lanzar, espera } = require('./capturas/navegador');
const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden95');
fs.mkdirSync(SALIDA, { recursive: true });
const ETIQ = process.env.ETIQ || 'despues';
let fallos = 0, pasos = 0;
const ok = (c, t, x) => { pasos++; if (c) console.log('  ok   ' + t); else { fallos++; console.log('  FALLA ' + t + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 700) : '')); } };
const q = async (s, p) => (await pool.query(s, p))[0];
function crearApp() {
  const app = express(); app.set('trust proxy', 1); app.use(express.json());
  app.use(session({ secret: 'secreto-de-prueba', resave: false, saveUninitialized: true, cookie: { httpOnly: true } }));
  app.get('/api/csrf-token', (req, res) => res.json({ csrfToken: 'ejemplo' }));
  app.get('/api/marca-publica', (req, res) => res.json({ titulo: 'Campaña de ejemplo', subtitulo: '', logo_url: '', boton_testigos: false }));
  const { cargarSublicencia, restringirAspirante } = require(R + '/middleware/aspirante');
  app.use('/api', cargarSublicencia, restringirAspirante);
  app.use('/api', require(R + '/middleware/soloLecturaCandidato').soloLecturaCandidato);
  const montar = (ruta, a) => app.use(ruta, require(R + '/routes/' + a));
  ['auth', 'usuarios', 'territorial', 'votantes', 'votantes-dashboard:votantesDashboard', 'finanzas', 'eventos', 'recursos', 'legislacion', 'dashboard', 'configuracion', 'permisos', 'complementos', 'contenido', 'push', 'geo', 'manuales', 'panel-lider:panelLider', 'coordinador', 'catalogo', 'solicitudes', 'tareas', 'puerta-a-puerta:puertaAPuerta', 'candidato']
    .forEach((x) => { const [r, f] = x.split(':'); montar('/api/' + r, (f || r) + '.routes'); });
  montar('/api/dia-d/rescate', 'rescateVotos.routes'); montar('/api/dia-d', 'diaD.routes');
  app.use('/api', (req, res) => res.status(404).json({ error: 'sin ruta' }));
  app.use(express.static(R + '/public', { etag: false, lastModified: false, setHeaders: (r) => r.setHeader('Cache-Control', 'no-store') }));
  return app;
}
(async () => {
  const { ids } = await sembrar(pool);
  if (!process.env.SIN_ESTRES) {   // datos de campaña real: correo largo sin cortes, nombre largo, organización larga
    await q("UPDATE usuarios SET email = 'coordinadoraorganizacionesmunicipalesmanizales@correoinstitucional.gov.co', nombre = 'María Fernanda de los Ángeles Restrepo-Hernández' WHERE nombre LIKE 'Ana%' LIMIT 1");
    await q("UPDATE usuarios SET email = 'lider.barrio.laenea.sector.norte@gmail.com' WHERE nombre LIKE 'Beto%' LIMIT 1");
  }
  const rol = async (n) => (await q('SELECT id FROM roles WHERE nombre = ?', [n]))[0].id;
  await q("UPDATE configuracion_campana SET nombre_candidato='Juan Pérez', marca_titulo='Campaña de ejemplo' WHERE id=1");
  await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, clave_celular_pregunta_hecha) VALUES ('Juan Pérez','1099000001','candidato.prueba','candidato.prueba@ejemplo.co','3001230000',?,?,1,1)`, [bcrypt.hashSync('ClaveCandidato-ej1', 4), await rol('candidato')]);
  await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, es_candidato, clave_celular_pregunta_hecha) VALUES ('Diego Admin Candidato','1099000101','1099000101','admin.cand@ejemplo.co','3001230101',?,?,1,1,1)`, [bcrypt.hashSync('ClaveAdmin-ej81', 4), await rol('admin')]);
  const s = http.createServer(crearApp()); await new Promise((r) => s.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + s.address().port;
  const nav = await lanzar(); const p = await nav.pagina('about:blank'); const { cmd, ev } = p;
  const ir = async (u) => { await cmd('Page.navigate', { url: u }); await espera(900); };
  const esperar = async (e, ms = 12000) => { const h = Date.now() + ms; while (Date.now() < h) { try { if (await ev(e)) return true; } catch (_) {} await espera(150); } return false; };
  const foto = async (n) => { const r = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SALIDA, n + '.png'), Buffer.from(r.result.data, 'base64')); };
  const movil = (w, h = 844) => cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2.75, mobile: true });
  await cmd('Emulation.setTimezoneOverride', { timezoneId: 'America/Bogota' });
  await movil(390); await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const entrar = async (email, clave, modo) => {
    await cmd('Network.clearBrowserCookies'); await ir(base + '/login.html'); await ev('localStorage.clear(); sessionStorage.clear()');
    await ev(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)},password:${JSON.stringify(clave)}})}).then(r=>r.status)`);
    // (el administrador-candidato entra en modo «candidato» por omisión: cModoGuardado() lee sessionStorage y, sin nada guardado, devuelve 'candidato')
  };
  const medir = () => ev(`(() => { const v = window.visualViewport; const ov = document.getElementById('overlay-form');
    const vis = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { izq: Math.round(r.left), der: Math.round(r.right), top: Math.round(r.top), bot: Math.round(r.bottom), w: Math.round(r.width) }; };
    const sig = document.querySelector('.wz-sig'); const salir = document.querySelector('#overlay-form .btn-salir'); const cerrar = document.querySelector('#overlay-form .modal-cerrar');
    const anchos = [...document.querySelectorAll("body *")].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > (v ? v.width : innerWidth) + 0.5 && !e.closest("#overlay-form"); }).slice(0, 8).map(e => (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 30)) + ' der=' + Math.round(e.getBoundingClientRect().right));
    const ancho = [...document.querySelectorAll('body *')].filter(e => !e.closest('#overlay-form')).map(e => ({ e, r: e.getBoundingClientRect() })).filter(x => x.r.width > 0 && x.r.right > (v ? v.width : innerWidth) + 0.5).slice(0, 6).map(x => (x.e.id ? '#' + x.e.id : x.e.tagName.toLowerCase() + '.' + String(x.e.className).slice(0, 25)) + ' der=' + Math.round(x.r.right));
    return { ancho, iw: innerWidth, sw: document.documentElement.scrollWidth, bsw: document.body.scrollWidth, escala: v ? v.scale : null, vvw: v ? Math.round(v.width) : null, vvx: v ? v.offsetLeft : null, abierto: !!ov && ov.classList.contains('abierto'), clases: document.documentElement.className + '|' + document.body.className,
      sig: vis(sig), salir: vis(salir), cerrar: vis(cerrar), cuerpoSW: (document.querySelector('.wz-cuerpo')||{}).scrollWidth, cuerpoCW: (document.querySelector('.wz-cuerpo')||{}).clientWidth, anchos,
      fs: getComputedStyle(document.documentElement).fontSize }; })()`);
  const abrir = async (ancho, letra, etiqueta) => {
    await movil(ancho);
    await ir('about:blank');
    await cmd('Page.navigate', { url: base + '/territorial.html?app=1&volver=/app/candidato-mas.html#nuevo' });
    await esperar("document.getElementById('overlay-form') && document.getElementById('overlay-form').classList.contains('abierto')", 15000);
    await espera(2500);
    if (letra) { await ev(`(() => { const els = [document.documentElement, ...document.querySelectorAll('body *')]; const fs = els.map((e) => parseFloat(getComputedStyle(e).fontSize)); els.forEach((e, i) => e.style.setProperty('font-size', (fs[i] * ${letra}) + 'px', 'important')); return 0; })()`); await espera(800); }
    const m = await medir();
    await foto(`${ETIQ}-${etiqueta}-${ancho}${letra ? '-letra' + Math.round(letra * 100) : ''}`);
    return m;
  };
  const casos = [['candidato', 'candidato.prueba@ejemplo.co', 'ClaveCandidato-ej1', null], ['admin-candidato', 'admin.cand@ejemplo.co', 'ClaveAdmin-ej81', 'candidato'], ['coordinador', '1023456789', 'clave-correo-ej', null]];
  for (const [nom, em, cl, modo] of casos.filter((c) => !process.env.SOLO || process.env.SOLO.split(',').includes(c[0]))) {
    await entrar(em, cl, modo);
    for (const [w, letra] of (process.env.EXTRA ? [[360, 1.3], [360, 1.6], [390, 1.6]] : [[360, 0], [390, 0], [412, 0], [390, 1.3]])) {
      const m = await abrir(w, letra, nom);
      console.log(`  [${nom} ${w}${letra ? ' letra130' : ''}]`, JSON.stringify(m));
      const z = 1;
      ok(m.sw <= m.iw && m.bsw <= m.iw, `${nom} ${w}${letra ? '+130%' : ''}: sin desborde a lo ancho (scrollWidth ${m.sw} ≤ ${m.iw})`, m.anchos);
      ok(m.escala === 1 && m.vvw === m.iw, `${nom} ${w}${letra ? '+130%' : ''}: visualViewport.scale == 1 y el diseño mide lo mismo que la pantalla (iw ${m.iw}, vv ${m.vvw}, escala ${m.escala})`);
      ok(m.abierto && m.sig && m.sig.der <= m.iw && m.sig.izq >= 0 && m.sig.bot <= (844 / z) + 1, `${nom} ${w}: «Siguiente» visible sin desplazar`, m.sig);
      if (nom === 'candidato' || nom === 'admin-candidato') ok(m.salir && m.salir.der <= m.iw && m.cerrar && m.cerrar.der <= m.iw && m.salir.top >= 0, `${nom} ${w}: barra con «Salir» y «×» visible`, { s: m.salir, c: m.cerrar });
    }
  }
  // Red de seguridad: un elemento de 900 px que alguien agregue mañana a la página de fondo no ensancha el diseño ni descoloca la hoja.
  await entrar('candidato.prueba@ejemplo.co', 'ClaveCandidato-ej1', null);
  for (const w of [360, 390, 412]) {
    await abrir(w, 0, 'red');
    await ev(`(() => { const d = document.createElement('div'); d.id = 'intruso'; d.style.cssText = 'width:900px;height:6px;background:red'; document.querySelector('.main').appendChild(d); return 0; })()`); await espera(600);
    const m = await medir(); await foto(`${ETIQ}-red-intruso-${w}`);
    ok(m.iw === m.vvw && m.escala === 1 && m.sig && m.sig.der <= m.iw && m.cerrar && m.cerrar.der <= m.iw, `${w}: un elemento de 900 px detrás NO ensancha el diseño ni corta el formulario (iw ${m.iw}, vv ${m.vvw})`, m);
  }
  try { nav.cerrar(); } catch (_) { /* el perfil sigue en uso un instante */ } s.close();
  console.log(`\n${fallos === 0 ? 'TODO BIEN' : 'HAY FALLOS'}: ${pasos - fallos} de ${pasos}.`);
  await pool.end(); process.exit(fallos ? 1 : 0);
})().catch(async (e) => { console.error('Error:', e); try { await pool.end(); } catch (_) {} process.exit(1); });
