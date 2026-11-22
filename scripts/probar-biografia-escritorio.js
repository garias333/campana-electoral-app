#!/usr/bin/env node
// scripts/probar-biografia-escritorio.js — ORDEN 104:
//   La biografía del candidato se ve y se edita en «Información para compartir» del ESCRITORIO (public/recursos.html), con el MISMO dato que lee el celular.
//   1. Administrador, biografía vacía → «Aún no hay biografía cargada» + «Agregar biografía» (amarillo #FFC300); guarda con foto; se ve en el escritorio y en /app (celular).
//   2. Editar de nuevo → el cambio llega al escritorio y al celular sin más pasos.
//   3. Pestaña «Biografía» (segunda, tras «Todos los tipos»): deja solo la tarjeta; otra pestaña de tipo la esconde.
//   4. Coordinador y líder: no ven «Editar/Agregar» y la API de guardar (PUT texto, POST/DELETE foto) les responde 403. El servidor decide, no el botón.
//
// USO (base desechable con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada104 [SALIDA=/ruta] node scripts/probar-biografia-escritorio.js
// Se niega a correr si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) { console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`); process.exit(2); }
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.LICENCIA_SERVIDOR_URL = 'http://127.0.0.1:1';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { sembrar, CLAVE_CORREO } = require('./fixtures/coordinadores-celular');
const { lanzar, espera } = require('./capturas/navegador');

const RAIZ = path.join(__dirname, '..');
const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden104');
fs.mkdirSync(SALIDA, { recursive: true });
const CLAVE = 'Clave-Prueba-104x';
const CORREO_ADMIN = 'admin104@ejemplo.co';
const BIO1 = 'Nació en el barrio Los Ejemplos, estudió en la universidad pública y lleva veinte años trabajando con las juntas de acción comunal.\n\nPropone empleo, vías y salud para todos los habitantes del municipio, con presupuesto participativo y rendición de cuentas cada seis meses.\n\nHa liderado tres proyectos de vivienda de interés social, dos programas de becas y una red de huertas comunitarias que hoy alimenta a más de trescientas familias de la zona rural y urbana.';
const BIO2 = 'Texto corregido de la biografía: líder comunitario, madre cabeza de hogar y servidora pública.';

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];

/** PNG sólido de 160×160 (sin dependencias): una foto de prueba. */
function pngSolido(ruta, r, g, b) {
  const w = 160, h = 160;
  const crudo = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { crudo[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; crudo[o] = r; crudo[o + 1] = g + (x % 40); crudo[o + 2] = b; } }
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let v = 0xFFFFFFFF; for (const x of buf) v = t[(v ^ x) & 255] ^ (v >>> 8); return (v ^ 0xFFFFFFFF) >>> 0; };
  const trozo = (tipo, datos) => { const l = Buffer.alloc(4); l.writeUInt32BE(datos.length); const td = Buffer.concat([Buffer.from(tipo), datos]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(ruta, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', zlib.deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))]));
}

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
  app.use('/uploads', express.static(path.join(RAIZ, 'uploads')));
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
  return { get: (r) => pedir('GET', r), post: (r, b) => pedir('POST', r, b || {}), put: (r, b) => pedir('PUT', r, b || {}), del: (r) => pedir('DELETE', r) };
}

(async () => {
  const servidor = http.createServer(crearApp());
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const { ids } = await sembrar(pool);
  const hash = bcrypt.hashSync(CLAVE, 4);
  const rol = async (n) => (await q('SELECT id FROM roles WHERE nombre = ?', [n]))[0].id;
  await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, es_candidato, clave_celular_pregunta_hecha)
     VALUES ('Admin Ciento Cuatro', '1099104001', '1099104001', ?, '3001040000', ?, ?, 1, 0, 1)`, [CORREO_ADMIN, hash, await rol('admin')]);
  await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, es_candidato, clave_celular_pregunta_hecha)
     VALUES ('Juan Candidato Pérez', '1099104002', '1099104002', 'candidato104@ejemplo.co', '3001040001', ?, ?, 1, 0, 1)`, [hash, await rol('candidato')]);
  await q("UPDATE usuarios SET password_hash = ?, email = 'ana104@ejemplo.co' WHERE id = ?", [hash, ids.ana]);
  await q("UPDATE configuracion_campana SET nombre_candidato = 'Juan Candidato Pérez' WHERE id = 1");
  await q("DELETE FROM contenido_paginas WHERE clave = 'biografia_candidato'");
  await q('UPDATE licencia_equipos_config SET max_equipos = 0, requiere_aprobacion = 0 WHERE id = 1');

  // El superadministrador conserva rol_id de admin: pasa por el mismo requireRole('admin') y por la misma comprobación de la pantalla.
  const sup = await q("SELECT r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.es_superadmin = 1");
  console.log('\n[0] Superadministrador');
  ok(sup.length === 1 && sup[0].rol === 'admin', 'la cuenta superadministrador tiene rol «admin» (mismo camino que el administrador en servidor y pantalla)', sup);

  /* ====================== HTTP: quién puede guardar ====================== */
  console.log('\n[1] Servidor: quién puede escribir la biografía');
  const adm = cliente();
  let r = await adm.post('/auth/login', { email: CORREO_ADMIN, password: CLAVE });
  ok(r.status === 200 && r.datos.usuario.rol === 'admin', 'el administrador entra', r.datos);
  r = await adm.get('/contenido/biografia_candidato');
  ok(r.status === 200 && (r.datos.contenido || '') === '', 'con la base vacía el GET responde 200 y contenido vacío (no 404)', r);
  for (const [nombre, correo, clave] of [['coordinador', 'marta@ejemplo.co', CLAVE_CORREO], ['líder', 'ana104@ejemplo.co', CLAVE]]) {
    const c = cliente();
    r = await c.post('/auth/login', { email: correo, password: clave });
    ok(r.status === 200, `${nombre} entra`, r);
    r = await c.get('/contenido/biografia_candidato');
    ok(r.status === 200, `${nombre} puede LEER la biografía`, r.status);
    r = await c.put('/contenido/biografia_candidato', { titulo: 'x', contenido: 'intento de ' + nombre });
    ok(r.status === 403, `${nombre}: PUT del texto → 403`, r.status);
    r = await c.post('/contenido/biografia_candidato/foto', {});
    ok(r.status === 403, `${nombre}: POST de la foto → 403`, r.status);
    r = await c.del('/contenido/biografia_candidato/foto');
    ok(r.status === 403, `${nombre}: DELETE de la foto → 403`, r.status);
  }
  ok((await q("SELECT COUNT(*) n FROM contenido_paginas WHERE clave = 'biografia_candidato'"))[0].n === 0, 'los intentos rechazados no escribieron nada');

  /* ====================== NAVEGADOR ====================== */
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  const escritorio = () => cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const movil = () => cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const ir = async (url) => { await cmd('Page.navigate', { url }); await espera(1000); };
  const esperar = async (expr, ms = 9000) => { const hasta = Date.now() + ms; while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); } return false; };
  const foto = async (nombre) => { const x = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(x.result.data, 'base64')); };
  const sinDesborde = () => ev('document.documentElement.scrollWidth <= window.innerWidth + 1');
  const limpiar = async () => { await cmd('Network.clearBrowserCookies'); await ir(base + '/login.html'); await ev('localStorage.clear(); sessionStorage.clear()'); await espera(500); p.avisos.length = 0; };
  const entrarPorApi = async (correo, clave = CLAVE) => ev(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(correo)}, password: ${JSON.stringify(clave)} }) }).then(x => x.status)`);
  const tarjeta = () => ev(`(() => { const c = document.getElementById('card-bio'); return { visible: getComputedStyle(c).display !== 'none', texto: c.innerText, botones: [...c.querySelectorAll('button')].map(b => ({ t: b.innerText.trim(), bg: getComputedStyle(b).backgroundColor, vis: getComputedStyle(b).display !== 'none' })), img: !!c.querySelector('img'), imgCargada: !!c.querySelector('img') && c.querySelector('img').naturalWidth > 0 }; })()`);
  const chips = () => ev("[...document.querySelectorAll('#filtros-chips .chip-filtro')].map(c => c.innerText.trim())");
  const bioFoto = path.join(SALIDA, 'foto-prueba.png');
  pngSolido(bioFoto, 30, 90, 160);

  console.log('\n[2] Escritorio (1280): administrador con la biografía VACÍA');
  await escritorio(); await limpiar();
  ok(await entrarPorApi(CORREO_ADMIN) === 200, 'sesión de administrador');
  await ir(base + '/recursos.html');
  ok(await esperar("getComputedStyle(document.getElementById('card-bio')).display !== 'none'", 10000), 'la tarjeta «Biografía del candidato» aparece aunque no haya biografía');
  let t = await tarjeta();
  ok(/Aún no hay biografía cargada/.test(t.texto), 'dice «Aún no hay biografía cargada»', t.texto);
  const bAgregar = t.botones.find((b) => /Agregar biografía/.test(b.t));
  ok(!!bAgregar && bAgregar.bg === 'rgb(255, 195, 0)', 'botón «Agregar biografía» en amarillo #FFC300', bAgregar);
  ok(!t.botones.some((b) => /Copiar|Editar/.test(b.t)), 'sin «Copiar» ni «Editar» cuando no hay texto', t.botones);
  const orden = await chips();
  ok(orden[0] === 'Todos los tipos' && orden[1] === 'Biografía' && orden[2] === 'Noticias', 'la pestaña «Biografía» es la primera después de «Todos los tipos»', orden);
  ok(await ev("document.getElementById('card-bio').getBoundingClientRect().bottom <= document.getElementById('filtros-chips').getBoundingClientRect().top + 1"), 'la tarjeta va arriba de las pestañas');
  ok(await sinDesborde() && p.avisos.length === 0, 'sin desborde ni errores de consola', p.avisos);
  await foto('1-escritorio-vacia-admin-1280');

  console.log('\n[3] Agregar biografía con foto');
  await ev("document.getElementById('bio-editar').click()");
  ok(await esperar("document.getElementById('overlay-bio').classList.contains('abierto')"), 'se abre el modal');
  ok(await ev("document.getElementById('titulo-modal-bio').innerText") === 'Agregar biografía', 'titulado «Agregar biografía»');
  await ev(`(() => { const t = document.getElementById('campo-bio-texto'); t.value = ${JSON.stringify(BIO1)}; t.dispatchEvent(new Event('input')); })()`);
  const cont = await ev("document.getElementById('bio-contador').innerText");
  ok(cont.replace(/\D/g, '') === String(BIO1.length), 'el contador de caracteres cuenta el texto', { cont, largo: BIO1.length });
  const doc = await cmd('DOM.getDocument', {});
  const nodo = await cmd('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#campo-bio-foto' });
  await cmd('DOM.setFileInputFiles', { nodeId: nodo.result.nodeId, files: [bioFoto] });
  await foto('2-escritorio-modal-agregar-1280');
  await ev("document.getElementById('btn-guardar-bio').click()");
  ok(await esperar("!document.getElementById('overlay-bio').classList.contains('abierto') && !!document.querySelector('#card-bio .bio-texto')", 10000), 'guarda y el modal se cierra', await ev("document.getElementById('bio-error').innerText"));
  await espera(500);
  t = await tarjeta();
  ok(/Los Ejemplos/.test(t.texto) && /Juan Candidato Pérez/.test(t.texto), 'la tarjeta muestra el nombre del candidato y el texto', t.texto.slice(0, 120));
  ok(t.img && t.imgCargada, 'y la foto cargada');
  ok(t.botones.some((b) => b.t === 'Editar biografía' && b.bg === 'rgb(11, 94, 215)') && t.botones.some((b) => b.t === 'Copiar texto' && b.bg === 'rgb(11, 94, 215)'), '«Editar biografía» y «Copiar texto» en azul #0B5ED7', t.botones);
  ok(t.botones.some((b) => /Ver completa/.test(b.t) && b.vis), 'texto largo: recortado a 4 líneas con «Ver completa»', t.botones);
  const alto = await ev("(() => { const e = document.getElementById('bio-texto'); return { recortado: e.classList.contains('recortado'), ch: e.clientHeight, sh: e.scrollHeight }; })()");
  ok(alto.recortado && alto.sh > alto.ch, 'el recorte es real (el texto completo es más alto que lo visible)', alto);
  await foto('3-escritorio-llena-admin-1280');
  await ev("document.getElementById('bio-ver-mas').click()"); await espera(200);
  ok(await ev("!document.getElementById('bio-texto').classList.contains('recortado') && /Ver menos/.test(document.getElementById('bio-ver-mas').innerText)"), '«Ver completa» despliega el texto entero');
  await foto('4-escritorio-llena-expandida-1280');
  const fila = (await q("SELECT contenido, foto_url, titulo FROM contenido_paginas WHERE clave = 'biografia_candidato'"))[0];
  ok(fila && fila.contenido === BIO1 && /^\/uploads\/contenido\/biografia_candidato-foto-/.test(fila.foto_url), 'quedó en contenido_paginas (el mismo lugar que lee el celular)', fila);
  const fotoSubida = fila && fila.foto_url ? path.join(RAIZ, fila.foto_url) : null;
  await ev("window.__copiado = null; navigator.clipboard.writeText = async (x) => { window.__copiado = x; }"); // Chromium sin permiso de portapapeles: se captura lo que se pediría copiar
  await ev("document.getElementById('bio-copiar').click()"); await espera(300);
  const copiado = await ev('window.__copiado');
  ok(copiado && copiado.startsWith('Juan Candidato Pérez') && copiado.includes(BIO1), '«Copiar texto» copia el nombre y la biografía completa', copiado && copiado.slice(0, 80));

  console.log('\n[4] El celular lo ve sin más pasos (390×844, «Información para compartir»)');
  const verEnCelular = async (correo, clave) => {
    await movil(); await limpiar();
    await entrarPorApi(correo, clave); await espera(400);
    await ir(base + '/app/informacion.html?modo=informacion');
    const hay = await esperar("!!document.getElementById('tarjeta-biografia')", 10000);
    return { hay, texto: hay ? await ev("document.getElementById('tarjeta-biografia').innerText") : '' };
  };
  let cel = await verEnCelular('candidato104@ejemplo.co', CLAVE);
  ok(cel.hay && /Los Ejemplos/.test(cel.texto) && /Juan Candidato Pérez/.test(cel.texto), 'el candidato ve la biografía recién guardada en su celular', cel.texto.slice(0, 150));
  await foto('5-celular-candidato-con-biografia-390');

  console.log('\n[5] Editar de nuevo y quitar la foto');
  await escritorio(); await limpiar();
  await entrarPorApi(CORREO_ADMIN); await espera(400);
  await ir(base + '/recursos.html'); await esperar("!!document.getElementById('bio-editar')");
  await ev("document.getElementById('bio-editar').click()");
  ok(await ev("document.getElementById('titulo-modal-bio').innerText") === 'Editar biografía' && await ev("document.getElementById('campo-bio-texto').value") === BIO1, 'el modal abre en «Editar biografía» con el texto actual');
  ok(await ev("getComputedStyle(document.getElementById('bio-foto-actual')).display") === 'flex', 'muestra la foto actual con «Quitar la foto actual»');
  await ev(`(() => { const t = document.getElementById('campo-bio-texto'); t.value = ${JSON.stringify(BIO2)}; t.dispatchEvent(new Event('input')); document.getElementById('bio-quitar-foto').checked = true; })()`);
  await ev("document.getElementById('btn-guardar-bio').click()");
  await esperar("!document.getElementById('overlay-bio').classList.contains('abierto')", 10000); await espera(500);
  t = await tarjeta();
  ok(/Texto corregido/.test(t.texto) && !t.img && !t.botones.some((b) => /Ver completa/.test(b.t) && b.vis), 'el escritorio muestra el texto nuevo, sin foto y sin «Ver completa» (cabe en 4 líneas)', t);
  ok((await q("SELECT contenido, foto_url FROM contenido_paginas WHERE clave = 'biografia_candidato'"))[0].foto_url === null, 'la foto quedó en NULL en la base');
  ok(!fotoSubida || !fs.existsSync(fotoSubida), 'y el archivo de la foto se borró del disco');
  await foto('6-escritorio-editada-sin-foto-1280');
  cel = await verEnCelular('candidato104@ejemplo.co', CLAVE);
  ok(cel.hay && /Texto corregido/.test(cel.texto) && !/Los Ejemplos/.test(cel.texto), 'el celular del candidato ve el texto corregido sin más pasos', cel.texto.slice(0, 150));

  console.log('\n[6] Pestañas');
  await escritorio(); await limpiar();
  await entrarPorApi(CORREO_ADMIN); await espera(400);
  await ir(base + '/recursos.html'); await esperar("!!document.getElementById('bio-editar')");
  const estado = () => ev("({ card: getComputedStyle(document.getElementById('card-bio')).display !== 'none', grid: getComputedStyle(document.getElementById('grid-recursos')).display !== 'none' })");
  let e = await estado();
  ok(e.card && e.grid, '«Todos los tipos»: tarjeta y recursos', e);
  await ev("document.querySelector('[data-tipo=biografia]').click()"); await espera(500);
  e = await estado();
  ok(e.card && !e.grid, '«Biografía»: solo la tarjeta', e);
  ok(p.respuestas.every((x) => !/recursos\?tipo=biografia/.test(x.url)), 'y no se le pide al servidor un tipo «biografia» que no existe');
  await foto('7-escritorio-pestana-biografia-1280');
  await ev("document.querySelector('[data-tipo=noticia]').click()"); await espera(500);
  e = await estado();
  ok(!e.card && e.grid, '«Noticias»: sin tarjeta, solo recursos (como en el celular)', e);
  await ev("document.querySelector('[data-tipo=\"\"]').click()"); await espera(500);
  e = await estado();
  ok(e.card && e.grid, 'volver a «Todos los tipos» la trae de nuevo', e);

  console.log('\n[7] Coordinador: la ve y la copia, sin Editar/Agregar; el servidor lo rechaza aunque fuerce la llamada');
  await escritorio(); await limpiar();
  ok(await entrarPorApi('marta@ejemplo.co', CLAVE_CORREO) === 200, 'sesión de coordinador');
  await ir(base + '/recursos.html');
  const vio = await esperar("getComputedStyle(document.getElementById('card-bio')).display !== 'none'", 10000);
  ok(vio, 'el coordinador ve la tarjeta', { ruta: await ev('location.pathname') });
  if (vio) {
    t = await tarjeta();
    ok(t.botones.some((b) => b.t === 'Copiar texto') && !t.botones.some((b) => /Editar|Agregar/.test(b.t)), 'con «Copiar texto» y sin «Editar» ni «Agregar»', t.botones);
    ok(await ev("!document.getElementById('bio-editar')"), 'ni siquiera existe el botón en el DOM');
    const forzado = await ev("fetch('/api/contenido/biografia_candidato', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo: 'x', contenido: 'forzado' }) }).then(x => x.status)");
    ok(forzado === 403, 'forzar la llamada PUT desde su sesión → 403', forzado);
    ok((await q("SELECT contenido FROM contenido_paginas WHERE clave = 'biografia_candidato'"))[0].contenido === BIO2, 'y la biografía no cambió');
    await foto('8-escritorio-coordinador-1280');
  }
  ok(p.avisos.length === 0, 'sin errores de consola en toda la sesión del coordinador', p.avisos);

  console.log('\n[8] Administrador con la biografía borrada otra vez: vuelve «Agregar» (amarillo)');
  await q("DELETE FROM contenido_paginas WHERE clave = 'biografia_candidato'");
  await limpiar(); await entrarPorApi(CORREO_ADMIN); await espera(400);
  await ir(base + '/recursos.html'); await esperar("!!document.getElementById('bio-editar')");
  ok(/Agregar biografía/.test(await ev("document.getElementById('bio-editar').innerText")), 'de vuelta a «Agregar biografía»');

  nav.cerrar && nav.cerrar();
  servidor.close();
  await pool.end();
  console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
