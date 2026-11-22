#!/usr/bin/env node
// scripts/probar-estructura-equipo-109.js — ORDEN 109: «Por rol» abre el Explorador con el equipo, y el tamaño del equipo en las tarjetas.
//   Con administrador, coordinadora y líder, a 1280 px:
//     · clic en coordinador / líder / sublíder de «Por rol» → Explorador con esa persona, su rama desplegada y «Su equipo» lleno
//       (también con búsqueda o cargo activos, con la rama plegada, y sin gente: «Aún no tiene equipo»);
//     · «Ver equipo» de «Por rol» y de «Tarjetas»; «Ver detalle» de Pendientes;
//     · el MISMO N en Lista, Tarjetas, Por rol y Explorador (0 · solo directos · dos niveles · sublíder con gente);
//     · los testigos no suman ni llevan enlace; cero errores de consola.
//
// USO (base desechable con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada109 [SALIDA=/ruta] node scripts/probar-estructura-vistas.js
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
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { sembrar, CLAVE_CORREO } = require('./fixtures/coordinadores-celular');
const { lanzar, espera } = require('./capturas/navegador');

const RAIZ = path.join(__dirname, '..');
const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden109');
fs.mkdirSync(SALIDA, { recursive: true });
const CLAVE = 'Clave-Prueba-109x';
const CORREO_ADMIN = 'admin109@ejemplo.co';

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];
const igual = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

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

(async () => {
  const servidor = http.createServer(crearApp());
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const { ids } = await sembrar(pool);
  const hash = bcrypt.hashSync(CLAVE, 4);
  const rol = async (n) => (await q('SELECT id FROM roles WHERE nombre = ?', [n]))[0].id;
  await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, es_candidato, clave_celular_pregunta_hecha)
     VALUES ('Admin Ciento Nueve', '1099109001', '1099105001', ?, '3001090000', ?, ?, 1, 0, 1)`, [CORREO_ADMIN, hash, await rol('admin')]);
  await q('UPDATE usuarios SET password_hash = ? WHERE id IN (?, ?)', [hash, ids.coord1, ids.ana]);
  await q("UPDATE usuarios SET email = 'ana109@ejemplo.co' WHERE id = ?", [ids.ana]);
  await q('UPDATE licencia_equipos_config SET max_equipos = 0, requiere_aprobacion = 0 WHERE id = 1');

  // Datos extra: rural, coordinador de organizaciones, aspirante al Concejo, testigos, autorizaciones y lugar de votación.
  const dep = (await q("SELECT id FROM territorios WHERE tipo = 'departamento' LIMIT 1"))[0].id;
  const mun = (await q("SELECT id FROM territorios WHERE tipo = 'municipio' LIMIT 1"))[0].id;
  const [corr] = await pool.query("INSERT INTO territorios (tipo, nombre, padre_id) VALUES ('corregimiento', 'Corregimiento El Alto', ?)", [mun]);
  const [ver] = await pool.query("INSERT INTO territorios (tipo, nombre, padre_id) VALUES ('vereda', 'Vereda La Palma', ?)", [corr.insertId]);
  void dep;
  const rolLider = await rol('lider'), rolCoord = await rol('coordinador'), rolTest = await rol('testigo').catch(() => rolLider);
  const nuevo = async (nombre, cedula, rolId, extra = {}) => (await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, tipo_cargo, clave_celular_pregunta_hecha)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1)`, [nombre, cedula, cedula, extra.email || null, extra.telefono || null, hash, rolId, extra.tipo || null]))[0].insertId;
  const olga = await nuevo('Olga Organizaciones Ejemplo', '1066000001', rolCoord, { telefono: '3011110001' });
  const asp = await nuevo('Aurelio Aspirante Concejo', '1066000002', rolLider, { telefono: '3011110002', tipo: 'aspirante_concejo' });
  const t1 = await nuevo('Tomás Testigo Uno', '1066000003', rolTest, { telefono: '3011110003' });
  const t2 = await nuevo('Teresa Testigo Dos', '1066000004', rolTest);
  const est = (u, cargo, sup, meta, terr, extra = {}) => pool.query(
    `INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo, meta_votos, meta_votos_base, territorio_id, area, tipo_area_influencia, organizacion, puesto_votacion, tipo_testigo)
     VALUES (?,?,?,1,?,?,?,?,?,?,?,?)`, [u, cargo, sup || null, meta || 0, meta || 0, terr || null, extra.area || null, extra.tipoArea || 'territorio', extra.org || null, extra.puesto || null, extra.tipoTestigo || 'mesa']);
  await est(olga, 'coordinador_organizaciones', null, 0, null, { tipoArea: 'organizacion', org: 'Gremio de Ejemplo' });
  await est(asp, 'lider', null, 30, ver.insertId, { area: 'rural' });
  await est(t1, 'testigo', ids.ana, 0, null, { puesto: 'Colegio Ejemplo', tipoTestigo: 'puesto' });
  await est(t2, 'testigo', ids.beto, 0, null, { puesto: 'Escuela Muestra', tipoTestigo: 'puesto' });
  // Diego: lugar de votación completo y autorización firmada → «Al día». Beto: autorización pendiente vigente.
  await q("UPDATE usuarios SET departamento_votacion = 'Departamento de ejemplo', municipio_votacion = 'Ciudad de ejemplo', puesto_votacion = 'Colegio Ejemplo', mesa_votacion = 4 WHERE id = ?", [ids.diego]);
  const idEst = async (u) => (await q('SELECT id FROM estructura WHERE usuario_id = ? AND cargo <> ?', [u, 'testigo']))[0].id;
  await pool.query("INSERT INTO autorizaciones_datos (persona_tipo, persona_id, token_hash, estado, canal_envio, creada_en, expira_en, firmada_en) VALUES ('estructura', ?, ?, 'firmada', 'copiado', NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY), NOW())", [await idEst(ids.diego), 'a'.repeat(64)]);
  await pool.query("INSERT INTO autorizaciones_datos (persona_tipo, persona_id, token_hash, estado, canal_envio, creada_en, expira_en) VALUES ('estructura', ?, ?, 'pendiente', 'copiado', NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY))", [await idEst(ids.beto), 'b'.repeat(64)]);

  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  const ancho = (w, h = 900) => cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const ir = async (url) => { await cmd('Page.navigate', { url }); await espera(900); };
  const esperar = async (expr, ms = 9000) => { const hasta = Date.now() + ms; while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); } return false; };
  const foto = async (nombre) => { const x = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(x.result.data, 'base64')); };
  const limpiar = async () => { await cmd('Network.clearBrowserCookies'); await ir(base + '/login.html'); await ev('localStorage.clear(); sessionStorage.clear()'); await espera(300); p.avisos.length = 0; };
  const entrar = (correo, clave = CLAVE) => ev(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(correo)}, password: ${JSON.stringify(clave)} }) }).then(x => x.status)`);
  const abrirEstructura = async () => { await ir(base + '/territorial.html'); return esperar("document.querySelectorAll('#tbody-estructura .ficha-p').length > 0 && !!document.querySelector('#selector-vistas-estructura')", 12000); };
  const elegir = async (v) => { await ev(`document.querySelector('#selector-vistas-estructura [data-vista="${v}"]').click()`); await espera(350); };
  const sinDesborde = () => ev('document.documentElement.scrollWidth <= window.innerWidth + 1');
  const nombresLista = () => ev("[...document.querySelectorAll('#tbody-estructura .ficha-p .nombre-p')].map(e => e.textContent.trim())");
  const txt = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e => e.textContent.trim())`);
  const buscar = async (texto) => { await ev(`(() => { const i = document.getElementById('filtro-estructura-busqueda'); i.value = ${JSON.stringify(texto)}; i.dispatchEvent(new Event('input')); })()`); await espera(700); };

  const personasDeVista = async (v) => {
    if (v === 'tarjetas') return { gente: await txt('.ev-tarjeta .ev-nombre'), testigos: [] };
    if (v === 'rol') {
      const todos = await ev("[...document.querySelectorAll('.ev-columna')].map(c => ({ t: c.querySelector('.ev-columna-cab span').textContent.trim(), n: [...c.querySelectorAll('.ev-mini .ev-nombre-enlace')].map(e => e.textContent.trim()) }))");
      return { gente: todos.filter((c) => c.t !== 'Testigos').flatMap((c) => c.n), testigos: (todos.find((c) => c.t === 'Testigos') || { n: [] }).n, columnas: todos.map((c) => c.t) };
    }
    if (v === 'ranking') {
      const con = (await txt('.ev-pod-nombre')).concat(await txt('.ev-fila-ranking .ev-nombre-enlace'));
      const franja = await ev("(() => { const f = document.querySelector('.ev-franja-sin-meta'); return f ? f.textContent.replace(/^Sin meta asignada \\(\\d+\\):/, '').replace(/\\. Asígneles meta.*$/, '').split(',').map(x => x.trim()).filter(Boolean) : []; })()");
      return { gente: con.concat(franja), testigos: [], con, sin: franja };
    }
    if (v === 'explorador') return { gente: await txt('.ev-nodo .ev-nodo-nombre'), testigos: [] };
    if (v === 'pendientes') {
      const grupos = await ev("[...document.querySelectorAll('.ev-pend')].map(s => ({ g: s.dataset.grupo, n: [...s.querySelectorAll('.ev-pend-quien .ev-nombre-enlace')].map(e => e.textContent.trim()) }))");
      return { gente: [...new Set(grupos.flatMap((g) => g.n))], testigos: [], grupos };
    }
    return { gente: [], testigos: [] };
  };

  // Un sublíder CON gente (Sandra reporta a Sara): Ana → Sara → Sandra, para el caso de «dos niveles».
  const sandra = await nuevo('Sandra Sublíder Gamma', '1066000005', await rol('sublider'), { telefono: '3011110005' });
  await est(sandra, 'usuario', ids.sara, 0, null);

  const NOMBRE = { marta: 'Marta Coordinadora Ejemplo', ana: 'Ana Líder Alfa', beto: 'Beto Líder Beta', carla: 'Carla Líder Gamma', sara: 'Sara Sublíder Alfa', tito: 'Tito Sublíder Beta', sandra: 'Sandra Sublíder Gamma', tomas: 'Tomás Testigo Uno' };
  const estado = async () => ({
    vista: await ev('EstructuraVistas.vista()'),
    arbol: await txt('.ev-nodo .ev-nodo-nombre'),
    sel: await txt('.ev-nodo.sel .ev-nodo-nombre'),
    ficha: (await txt('#ev-ficha h3'))[0],
    equipo: await txt('#ev-ficha .ev-equipo li .ev-nombre-enlace'),
    sinEquipo: (await txt('#ev-ficha .ev-sin-equipo'))[0] || null,
    agregarEnVacio: await ev("!!document.querySelector('#ev-ficha .ev-sin-equipo [data-accion=agregar]')"),
    personasACargo: (await txt('#ev-ficha .ev-ind'))[3] || '',
  });
  const clicRol = (n) => ev(`[...document.querySelectorAll('.ev-mini .ev-nombre-enlace')].find(b => b.textContent.includes(${JSON.stringify(n)})).click()`);
  const mismos = (a, b) => igual(a, b);
  const sinAviso = (etq) => ok(p.avisos.length === 0, `sin errores de consola: ${etq}`, p.avisos);

  /** N de «Equipo» que cada vista dice de una persona (null si la vista no la muestra con cifra). */
  const nLista = async (nombre) => {
    const t = await ev("[...document.querySelectorAll('#tbody-estructura .rama-titulo')].map(e => ({ n: e.querySelector('b').textContent.trim(), t: e.textContent }))");
    const r = t.find((x) => x.n === nombre);
    return r ? parseInt(r.t.split('·')[1], 10) : 0;   // sin rótulo «Reportan a» = nadie a cargo
  };
  const nTarjetas = (nombre) => ev(`(() => { const t = [...document.querySelectorAll('.ev-tarjeta')].find(x => x.querySelector('.ev-nombre').textContent.trim() === ${JSON.stringify(nombre)}); return t ? parseInt(t.querySelectorAll('.ev-cifras3 b')[2].textContent.replace(/\\D/g, ''), 10) : null; })()`);
  const nPorRol = (nombre) => ev(`(() => { const m = [...document.querySelectorAll('.ev-mini')].find(x => x.querySelector('.ev-nombre-enlace').textContent.trim() === ${JSON.stringify(nombre)}); if (!m) return null; const l = m.querySelector('.ev-equipo-linea'); return l ? parseInt(l.querySelector('b').textContent.replace(/\\D/g, ''), 10) : -1; })()`);
  const lineaPorRol = (nombre) => ev(`(() => { const m = [...document.querySelectorAll('.ev-mini')].find(x => x.querySelector('.ev-nombre-enlace').textContent.trim() === ${JSON.stringify(nombre)}); const l = m && m.querySelector('.ev-equipo-linea'); return l ? { t: l.textContent.trim(), peso: getComputedStyle(l.querySelector('b')).fontWeight, color: getComputedStyle(l.querySelector('b')).color } : null; })()`);
  const nExplorador = async (nombre) => {
    await ev(`[...document.querySelectorAll('.ev-nodo-btn')].find(b => b.querySelector('.ev-nodo-nombre').textContent.trim() === ${JSON.stringify(nombre)}).click()`); await espera(300);
    const ficha = parseInt(((await txt('#ev-ficha .ev-ind'))[3] || '').replace(/\D/g, ''), 10);
    const arbol = await ev(`(() => { const b = [...document.querySelectorAll('.ev-nodo-btn')].find(b => b.querySelector('.ev-nodo-nombre').textContent.trim() === ${JSON.stringify(nombre)}); const n = b.querySelector('.ev-nodo-n'); return n ? parseInt(n.textContent.replace(/\\D/g, ''), 10) : 0; })()`);
    const lista = (await txt('#ev-ficha .ev-equipo li')).length;
    return { ficha, arbol, lista };
  };

  async function comprobarRol(etq, correo, ancho_) {
    console.log(`\n[${etq} · ${ancho_} px]`);
    await ancho(ancho_); await limpiar(); await entrar(correo); await abrirEstructura();

    console.log(' · clic en una persona de «Por rol»');
    await elegir('rol');
    ok(await ev("document.querySelectorAll('.ev-mini .ev-btn-mini').length > 0 && [...document.querySelectorAll('.ev-mini .ev-btn-mini')].every(b => b.textContent.trim() === 'Ver equipo')"), 'cada tarjeta de Por rol trae su botón «Ver equipo»');
    ok(await ev("![...document.querySelectorAll('.ev-columna')].find(c => c.querySelector('.ev-columna-cab span').textContent.trim() === 'Testigos') && !/Testig/.test(document.getElementById('vistas-estructura').innerText)"), 'ORDEN 111: Por rol no trae la columna Testigos ni ningún testigo');
    // Lo que cada rol alcanza a ver lo decide el SERVIDOR (coordinador: él, sus líderes y los sublíderes de esos líderes; líder: su equipo directo).
    const esAdmin = correo === CORREO_ADMIN, esCoord = correo === 'marta@ejemplo.co', esLider = correo === 'ana109@ejemplo.co';
    const rama = {};
    if (!esLider) rama.marta = { directos: ['Ana Líder Alfa', 'Beto Líder Beta', 'Carla Líder Gamma', 'Diego Líder Delta'], baja: [NOMBRE.ana, NOMBRE.beto, NOMBRE.carla, NOMBRE.sara, NOMBRE.tito].concat(esAdmin ? [NOMBRE.sandra] : []) };
    rama.ana = { directos: [NOMBRE.sara], baja: [NOMBRE.sara].concat(esAdmin ? [NOMBRE.sandra] : []) };
    rama.sara = { directos: esAdmin ? [NOMBRE.sandra] : [], baja: esAdmin ? [NOMBRE.sandra] : [] };
    if (!esLider) rama.carla = { directos: [], baja: [] };
    for (const [k, { directos, baja }] of Object.entries(rama)) {
      await elegir('rol');
      await clicRol(NOMBRE[k]); await espera(450);
      const e = await estado();
      ok(e.vista === 'explorador' && e.ficha === NOMBRE[k] && e.sel[0] === NOMBRE[k], `clic en ${NOMBRE[k]} (Por rol) → Explorador con esa persona seleccionada`, e);
      ok(mismos(e.equipo, directos), `   «Su equipo» lleno: ${directos.length ? directos.join(', ') : 'vacío'}`, e.equipo);
      ok([NOMBRE[k], ...baja].every((n) => e.arbol.includes(n)), '   su rama está desplegada en el árbol', e.arbol);
      if (!directos.length) ok(/Aún no tiene equipo/.test(e.sinEquipo || ''), '   sin gente: dice «Aún no tiene equipo»', e.sinEquipo);
      if (k === 'carla' && esAdmin) ok(e.agregarEnVacio, '   y ofrece «+ Agregar» (el administrador puede)');
      if (k === 'carla' && esCoord) ok(!e.agregarEnVacio, '   y NO ofrece «+ Agregar» (un coordinador no agrega sublíderes)');
    }
    sinAviso('clics de Por rol');

    console.log(' · «Ver equipo» de Por rol y de Tarjetas');
    await elegir('rol');
    await ev(`[...document.querySelectorAll('.ev-mini')].find(m => m.querySelector('.ev-nombre-enlace').textContent.trim() === ${JSON.stringify(NOMBRE.ana)}).querySelector('[data-accion=equipo]').click()`); await espera(500);
    const pr = (await personasDeVista('rol')).gente;
    const gente = [NOMBRE.ana, NOMBRE.sara].concat(correo === CORREO_ADMIN ? [NOMBRE.sandra] : []);
    ok(mismos(pr, gente) && await ev("!!document.getElementById('btn-quitar-equipo-estructura')"), 'Por rol · «Ver equipo» deja a Ana y su gente (con la franja «Quitar»)', pr);
    await ev('document.getElementById("btn-quitar-equipo-estructura").click()'); await espera(400);
    await elegir('tarjetas');
    await ev(`[...document.querySelectorAll('.ev-tarjeta')].find(t => t.querySelector('.ev-nombre').textContent.trim() === ${JSON.stringify(NOMBRE.ana)}).querySelector('[data-accion=equipo]').click()`); await espera(500);
    const pt = (await personasDeVista('tarjetas')).gente;
    ok(mismos(pt, gente), 'Tarjetas · «Ver equipo» deja a Ana y su gente', pt);
    await elegir('explorador');
    ok((await estado()).ficha === NOMBRE.ana, 'Explorador, llegando de «Ver equipo» de Tarjetas: abre la ficha de Ana', await estado());
    ok(mismos((await estado()).equipo, [NOMBRE.sara]), '   con «Su equipo» lleno');
    await ev('document.getElementById("btn-quitar-equipo-estructura").click()'); await espera(400);

    console.log(' · «Ver detalle» de Pendientes');
    await elegir('pendientes');
    const hayDetalle = await ev("!!document.querySelector('[data-grupo=avance-bajo] [data-accion=explorar]')");
    if (hayDetalle) {
      const quien = await ev("document.querySelector('[data-grupo=avance-bajo] [data-accion=explorar]').closest('li').querySelector('.ev-pend-quien .ev-nombre-enlace').textContent.trim()");
      await ev("document.querySelector('[data-grupo=avance-bajo] [data-accion=explorar]').click()"); await espera(450);
      const e = await estado();
      ok(e.vista === 'explorador' && e.ficha === quien && e.sel[0] === quien, `«Ver detalle» (Pendientes) → Explorador con ${quien}`, e);
      const dir = await ev(`(() => { return null; })()`);
      void dir;
      ok(e.equipo.length === parseInt((e.personasACargo.match(/\d+/) || [0])[0], 10), '   «Su equipo» coincide con «Personas a cargo»', e);
    } else console.log('  (sin filas de «Avance bajo» para este rol)');
    sinAviso('Ver equipo y Ver detalle');
  }

  /* ============ ADMINISTRADOR ============ */
  await comprobarRol('administrador', CORREO_ADMIN, 1280);

  console.log('\n[Administrador · filtros, plegado y testigos]');
  await ancho(1280); await limpiar(); await entrar(CORREO_ADMIN); await abrirEstructura();
  await elegir('rol'); await buscar('Marta'); await clicRol(NOMBRE.marta); await espera(450);
  let e = await estado();
  ok(e.vista === 'explorador' && ['Ana Líder Alfa', 'Beto Líder Beta', 'Sandra Sublíder Gamma'].every((n) => e.arbol.includes(n)), 'con la BÚSQUEDA «Marta» activa, el árbol igual trae toda la rama (antes quedaba la persona sola)', e.arbol);
  ok(mismos(e.equipo, ['Ana Líder Alfa', 'Beto Líder Beta', 'Carla Líder Gamma', 'Diego Líder Delta']), '   y «Su equipo» sigue lleno');
  await foto('explorador-con-busqueda-admin-1280');
  await ev("document.getElementById('filtro-estructura-busqueda').value = ''; document.getElementById('filtro-estructura-busqueda').dispatchEvent(new Event('input'))"); await espera(500);
  await ev("(() => { const c = document.getElementById('filtro-estructura-cargo'); c.value = 'coordinador'; c.dispatchEvent(new Event('change')); })()"); await espera(500);
  await elegir('rol');
  await clicRol(NOMBRE.marta); await espera(450);
  e = await estado();
  ok(['Ana Líder Alfa', 'Sara Sublíder Alfa', 'Sandra Sublíder Gamma'].every((n) => e.arbol.includes(n)), 'con el filtro de CARGO = Coordinador, el árbol también trae su gente', e.arbol);
  await ev("(() => { const c = document.getElementById('filtro-estructura-cargo'); c.value = ''; c.dispatchEvent(new Event('change')); })()"); await espera(500);
  // plegado: la persona plegada se abre al llegar
  await elegir('explorador');
  await ev(`document.querySelector('.ev-triangulo[data-uid="${ids.coord1}"]').click()`); await espera(300);
  ok(!(await estado()).arbol.includes(NOMBRE.ana), 'el árbol de Marta estaba plegado (Ana no se ve)');
  await elegir('rol'); await clicRol(NOMBRE.marta); await espera(450);
  e = await estado();
  ok(e.arbol.includes(NOMBRE.ana) && e.arbol.includes(NOMBRE.sandra), 'con su rama plegada, el clic en «Por rol» la despliega', e.arbol);
  // testigos
  await elegir('rol');
  ok(await ev("!/Testig/.test(document.getElementById('vistas-estructura').innerText)"), 'ORDEN 111: los testigos ya no aparecen en Por rol (ni como texto plano)');
  sinAviso('filtros, plegado y testigos');

  console.log('\n[Administrador · el mismo N en Lista, Tarjetas, Por rol y Explorador]');
  await ancho(1280); await limpiar(); await entrar(CORREO_ADMIN); await abrirEstructura();
  const casos = [['carla', 0, 'sin nadie'], ['ana', 1, 'solo directos (Sara; el testigo Tomás NO suma)'], ['marta', 4, 'dos niveles (4 directos y 3 más debajo; la lista cuenta los directos)'], ['sara', 1, 'sublíder con gente (Sandra)']];
  for (const [k, esperado, etq] of casos) {
    const nombre = NOMBRE[k];
    await elegir('lista'); const l = await nLista(nombre);
    await elegir('tarjetas'); const t = await nTarjetas(nombre);
    await elegir('rol'); const r = await nPorRol(nombre);
    await elegir('explorador'); const x = await nExplorador(nombre);
    const rolN = r === -1 ? 0 : r;
    ok(l === esperado && t === esperado && rolN === esperado && x.ficha === esperado && x.arbol === esperado && x.lista === esperado,
      `${nombre} — ${etq}: Lista ${l} · Tarjetas ${t} · Por rol ${r === -1 ? '(sin línea)' : r} · Explorador ficha ${x.ficha}, árbol ${x.arbol}, lista ${x.lista} → esperado ${esperado}`);
  }
  await elegir('rol');
  const linea = await lineaPorRol(NOMBRE.marta);
  ok(linea && /^👥 Equipo: 4 personas$/.test(linea.t) && Number(linea.peso) >= 700 && linea.color === 'rgb(8, 66, 152)', 'Por rol: «👥 Equipo: 4 personas» con el N en negrita y #084298', linea);
  const una = await lineaPorRol(NOMBRE.ana);
  ok(una && /^👥 Equipo: 1 persona$/.test(una.t), 'y en singular: «1 persona»', una);
  const cero = await lineaPorRol(NOMBRE.carla);
  ok(cero && /Equipo: 0 personas/.test(cero.t), 'un líder sin gente muestra «0 personas»', cero);
  ok(await ev(`(() => { const m = [...document.querySelectorAll('.ev-mini')].find(x => x.querySelector('.ev-nombre-enlace').textContent.trim() === ${JSON.stringify(NOMBRE.tito)}); return !m.querySelector('.ev-equipo-linea'); })()`), 'un sublíder SIN gente no lleva la línea de equipo');
  ok(await ev(`(() => { const m = [...document.querySelectorAll('.ev-mini')].find(x => x.querySelector('.ev-nombre-enlace').textContent.trim() === ${JSON.stringify(NOMBRE.sara)}); return !!m.querySelector('.ev-equipo-linea'); })()`), 'y un sublíder CON gente sí');
  await clicRol(NOMBRE.marta); await espera(450);
  await ancho(1280); await foto('explorador-tras-clic-admin-1280');
  await elegir('rol'); await foto('por-rol-admin-1280');
  sinAviso('N en las cuatro vistas');

  /* ============ COORDINADORA ============ */
  await comprobarRol('coordinadora', 'marta@ejemplo.co', 1280);
  console.log('\n[Coordinadora · el mismo N]');
  await ancho(1280); await limpiar(); await entrar('marta@ejemplo.co'); await abrirEstructura();
  for (const [k, esperado] of [['marta', 4], ['ana', 1], ['carla', 0]]) {
    const nombre = NOMBRE[k];
    await elegir('lista'); const l = await nLista(nombre);
    await elegir('tarjetas'); const t = await nTarjetas(nombre);
    await elegir('rol'); const r = await nPorRol(nombre);
    await elegir('explorador'); const x = await nExplorador(nombre);
    ok(l === esperado && t === esperado && (r === -1 ? 0 : r) === esperado && x.ficha === esperado && x.arbol === esperado, `${nombre}: Lista ${l} · Tarjetas ${t} · Por rol ${r} · Explorador ${x.ficha}/${x.arbol} → ${esperado}`);
  }
  await elegir('rol'); await foto('por-rol-coordinadora-1280');
  sinAviso('coordinadora');

  /* ============ LÍDER ============ */
  await comprobarRol('líder', 'ana109@ejemplo.co', 1280);

  nav.cerrar();
  servidor.close();
  await pool.end();
  console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
