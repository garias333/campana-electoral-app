#!/usr/bin/env node
// scripts/probar-coordinador-votantes.js — ORDEN 87: el coordinador no crea sublíderes ni testigos desde «Votantes».
//
// SERVIDOR (HTTP, sesión del celular —cédula + clave— y sesión del computador —correo + contraseña—): registrar y editar un votante normal sigue igual; marcar «Sublíder» al crear o al editar
// y «Es también testigo electoral» (asignar-testigo) responden 403 «El coordinador no puede crear sublíderes ni testigos.» y no escriben nada. Administrador y líder, sin cambios.
// NAVEGADOR (Chromium): formulario de Votantes del computador (1280 px) y de la app (390×844) como coordinador: sin la opción de sublíder ni la casilla de testigo.
//
// USO (base desechable con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada87 [SALIDA=/ruta] node scripts/probar-coordinador-votantes.js
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
const { sembrar, CLAVE_CORREO, CLAVE_ADMIN } = require('./fixtures/coordinadores-celular');
const { sincronizarClaveCelular } = require('../lib/claveCelular');
const { lanzar, espera } = require('./capturas/navegador');

const RAIZ = path.join(__dirname, '..');
const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden87');
fs.mkdirSync(SALIDA, { recursive: true });
const MSJ = 'El coordinador no puede crear sublíderes ni testigos.';

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
  ['auth', 'usuarios', 'territorial', 'votantes', 'dashboard', 'configuracion', 'permisos', 'complementos', 'contenido', 'push', 'geo', 'coordinador', 'catalogo', 'panel-lider:panelLider']
    .forEach((x) => { const [r, f] = x.split(':'); montar('/api/' + r, (f || r) + '.routes'); });
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
  return { get: (r) => pedir('GET', r), post: (r, b) => pedir('POST', r, b || {}), put: (r, b) => pedir('PUT', r, b || {}) };
}

(async () => {
  const servidor = http.createServer(crearApp());
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const { ids } = await sembrar(pool);
  await sincronizarClaveCelular(pool, ids.coord1);
  const [[bar]] = await pool.query("SELECT id FROM territorios WHERE tipo = 'barrio' ORDER BY id LIMIT 1");
  // La contraseña del líder (Ana) para el cliente de líder.
  await q("UPDATE usuarios SET email = 'ana87@ejemplo.co', password_hash = ? WHERE id = ?", [bcrypt.hashSync(CLAVE_CORREO, 4), ids.ana]);
  const votante = (extra = {}) => ({
    nombre: 'Vera Votante Prueba', categoria: 'votante', cedula: '1099870001', telefono: '3001230001', area: 'urbano', territorio_id: bar.id, territorio_ids: [bar.id],
    consentimiento_autorizado: true, consentimiento_metodo: 'verbal_formulario_campo', consentimiento_email: false, consentimiento_sms: false, consentimiento_whatsapp: false,
    ...extra,
  });
  const hay = async (cedula) => ({
    votante: (await q('SELECT COUNT(*) n FROM votantes WHERE cedula = ?', [cedula]))[0].n,
    usuario: (await q('SELECT COUNT(*) n FROM usuarios WHERE numero_identificacion = ?', [cedula]))[0].n,
    estructura: (await q('SELECT COUNT(*) n FROM estructura e JOIN usuarios u ON u.id = e.usuario_id WHERE u.numero_identificacion = ?', [cedula]))[0].n,
  });

  const probarCoordinador = async (c, via, c0) => {
    console.log(`\n[${via}] El coordinador (${via === 'celular' ? 'sesión del celular' : 'sesión del computador'})`);
    let r = await c.post('/votantes', votante({ cedula: c0 + '1' }));
    ok(r.status === 200 && r.datos.ok, 'registra un votante normal → 200', r);
    const idV = r.datos && r.datos.id;
    ok((await hay(c0 + '1')).votante === 1, '   y quedó guardado');
    r = await c.post('/votantes', votante({ cedula: c0 + '2', nombre: 'Sara Sublíder Prueba', categoria: 'sublider', meta_votos_sublider: 5 }));
    ok(r.status === 403 && r.datos.error === MSJ, 'registrar con «Sublíder» → 403 «El coordinador no puede crear sublíderes ni testigos.»', r);
    const h2 = await hay(c0 + '2');
    ok(h2.votante === 0 && h2.usuario === 0 && h2.estructura === 0, '   y no se creó nada (ni votante, ni cuenta, ni estructura)', h2);
    r = await c.put(`/votantes/${idV}`, votante({ cedula: c0 + '1', nombre: 'Vera Corregida', password: CLAVE_CORREO }));
    ok(r.status === 200, 'editar un votante normal → 200', r);
    ok((await q('SELECT nombre FROM votantes WHERE id = ?', [idV]))[0].nombre === 'Vera Corregida', '   y se guardó el cambio');
    r = await c.put(`/votantes/${idV}`, votante({ cedula: c0 + '1', categoria: 'sublider', password: CLAVE_CORREO }));
    ok(r.status === 403 && r.datos.error === MSJ, 'editar para convertirlo en sublíder → 403', r);
    const h3 = await hay(c0 + '1');
    ok(h3.usuario === 0 && h3.estructura === 0, '   y no se le creó cuenta ni estructura', h3);
    r = await c.post(`/votantes/${idV}/asignar-testigo`, { puesto_votacion: 'Puesto X', mesa_votacion: 1, tipo_testigo: 'mesa' });
    ok(r.status === 403 && r.datos.error === MSJ, '«Es también testigo electoral» (asignar-testigo) → 403', r);
    ok((await hay(c0 + '1')).usuario === 0, '   y no se creó la cuenta de testigo');
    r = await c.get('/votantes');
    ok(r.status === 200, 'y ve su lista de votantes como siempre', r.status);
  };

  const cel = cliente();
  let r = await cel.post('/auth/login-coordinador', { cedula: '1023456789', clave: '456789' });
  ok(r.status === 200, 'el coordinador entra por el celular (cédula + clave)', r.texto.slice(0, 120));
  await probarCoordinador(cel, 'celular', '10998710');
  const pc = cliente();
  r = await pc.post('/auth/login', { email: 'marta@ejemplo.co', password: CLAVE_CORREO });
  ok(r.status === 200, 'el coordinador entra por el computador (correo y contraseña)');
  await probarCoordinador(pc, 'computador', '10998720');

  console.log('\n[otros roles] sin cambios');
  const adm = cliente();
  await adm.post('/auth/login', { email: 'admin.ej@ejemplo.co', password: CLAVE_ADMIN });
  r = await adm.post('/votantes', votante({ cedula: '1099873001', nombre: 'Sara Sublíder Admin', categoria: 'sublider', meta_votos_sublider: 5 }));
  ok(r.status === 200 && r.datos.ok, 'el administrador SÍ registra un sublíder', r);
  ok((await hay('1099873001')).usuario === 1, '   y se le creó la cuenta');
  r = await adm.post(`/votantes/${r.datos.id || 0}/asignar-testigo`, { puesto_votacion: 'Puesto X', mesa_votacion: 1, tipo_testigo: 'mesa' });
  ok(r.status !== 403, 'el administrador no recibe el 403 en asignar-testigo (responde ' + r.status + ')', r);
  const lid = cliente();
  r = await lid.post('/auth/login', { email: 'ana87@ejemplo.co', password: CLAVE_CORREO });
  r = await lid.post('/votantes', votante({ cedula: '1099874001', nombre: 'Sara Sublíder De Ana', categoria: 'sublider', meta_votos_sublider: 5 }));
  ok(r.status === 200 && r.datos.ok, 'el líder SÍ registra un sublíder', r);
  r = await lid.post('/votantes', votante({ cedula: '1099874002', nombre: 'Vera Votante De Ana' }));
  ok(r.status === 200, 'y un votante', r);

  /* ============================ NAVEGADOR ============================ */
  console.log('\n[navegador] Votantes como coordinador');
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  const ir = async (url) => { await cmd('Page.navigate', { url }); await espera(1000); };
  const esperar = async (expr, ms = 10000) => { const hasta = Date.now() + ms; while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); } return false; };
  const foto = async (nombre) => { const x = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(x.result.data, 'base64')); };
  const vis = (id) => ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && e.offsetParent !== null; })()`);

  // Computador
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await ir(base + '/login.html'); await espera(500);
  await ev(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'marta@ejemplo.co', password: ${JSON.stringify(CLAVE_CORREO)} }) }).then(x => x.status)`);
  p.avisos.length = 0;
  await ir(base + '/votantes.html');
  ok(await esperar("!!document.getElementById('btn-nuevo') && document.querySelectorAll('#tbody-votantes tr').length > 0"), 'Votantes del computador carga con su lista');
  await ev("document.getElementById('btn-nuevo').click()"); await espera(1200);
  const d = await ev(`({ abierto: document.getElementById('overlay-form') ? document.getElementById('overlay-form').classList.contains('abierto') : null, titulo: document.getElementById('titulo-modal').innerText })`);
  ok(d.titulo === 'Nuevo votante', 'el formulario dice «Nuevo votante» (no «votante o sublíder»)', d);
  ok(await vis('chk-categoria-votante') || await ev("!!document.getElementById('chk-categoria-votante')"), 'queda la categoría «Votante»');
  ok(!(await vis('chip-categoria-sublider')) && !(await vis('campo-meta-votos-sublider')), 'NO aparece el botón «Sublíder» ni su meta de votos');
  ok(!(await vis('campo-asignar-testigo-votante')), 'NO aparece «Es también testigo electoral»');
  ok(await ev("document.getElementById('chk-categoria-votante').checked === true"), 'y «Votante» viene marcado');
  ok(!(await vis('nota-categoria-subalterno')) && (await ev("document.getElementById('btn-nuevo').innerText.trim()")) === '+ Nuevo votante', 'sin la nota «Si marcas Sublíder…» y con el botón «+ Nuevo votante»');
  await foto('1-votantes-coordinador-computador-1280x900');
  // Editar un votante existente: tampoco queda como sublíder
  await ev("document.getElementById('cerrar-modal').click()"); await espera(400);
  p.avisos.length = 0;
  ok(p.avisos.filter((x) => !/tile|favicon|Failed to load/i.test(x)).length === 0, 'sin errores de consola en el computador', p.avisos);

  // Celular (app)
  await cmd('Network.clearBrowserCookies');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: true });
  await ir(base + '/login.html'); await espera(500);
  await ev(`fetch('/api/auth/login-coordinador', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cedula: '1023456789', clave: '456789' }) }).then(x => x.status)`);
  p.avisos.length = 0;
  await ir(base + '/app/registro-votante.html');
  ok(await esperar("!!document.getElementById('chip-votante') && !document.getElementById('pantalla-carga') || getComputedStyle(document.getElementById('pantalla-carga')).display === 'none'"), 'el formulario de la app carga');
  await espera(1200);
  const m = await ev(`({ chipSub: (() => { const e = document.getElementById('chip-sublider'); return !!e && e.offsetParent !== null; })(), chipVot: (() => { const e = document.getElementById('chip-votante'); return !!e && e.offsetParent !== null; })(), nota: (() => { const e = document.getElementById('nota-categoria-subalterno'); return !!e && e.offsetParent !== null; })(),
    votanteActivo: document.getElementById('chip-votante').classList.contains('activo'), testigo: /testigo electoral/i.test(document.body.innerText) })`);
  ok(m.chipVot && !m.chipSub && !m.nota && m.votanteActivo, 'app: solo «Votante» (sin «Sublíder» ni su nota), y viene elegido', m);
  ok(!m.testigo, 'app: no hay «Es también testigo electoral»', m);
  ok((await ev("(document.querySelector('.app-barra .subt') || {}).innerText")) === 'Votante', 'app: el encabezado dice «Votante», no «Votante o sublíder»');
  await foto('2-registro-coordinador-celular-390x844');
  ok(p.avisos.filter((x) => !/tile|favicon|Failed to load/i.test(x)).length === 0, 'sin errores de consola en el celular', p.avisos);
  await ir(base + '/app/mis-registros.html'); await esperar("!!document.getElementById('texto-inscribir')"); await espera(800);
  ok(await ev("document.getElementById('texto-inscribir').innerText.trim()") === 'Inscribir votante', '«Mis registros»: el botón dice «Inscribir votante» (no «votante o sublíder»)');

  nav.cerrar(); servidor.close();
  console.log(`\n${pasos - fallos}/${pasos} comprobaciones correctas.`);
  console.log(fallos ? `HAY ${fallos} FALLO(S).` : 'TODO BIEN.');
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch(async (e) => { console.error(e); try { await pool.end(); } catch (_) { /* nada */ } process.exit(1); });
