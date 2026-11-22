#!/usr/bin/env node
// scripts/probar-estructura-vistas.js — ORDEN 105 (+ ORDEN 107: diseño «Avatar con anillo» en Tarjetas y «Podio» en Ranking):
//   «Estructura territorial» (escritorio) con selector de 6 vistas: Lista (la de siempre) + Tarjetas, Por rol, Ranking, Explorador y Pendientes.
//   Con administrador, coordinador y líder, a 1280 y 1600 px:
//     · las 6 vistas muestran LAS MISMAS personas que la lista (sin búsqueda y con búsqueda);
//     · la vista elegida se recuerda al recargar (por usuario);
//     · Editar abre el formulario de siempre; «+ Agregar» respeta lo que cada rol puede agregar;
//     · «Ver equipo» deja a la persona y su gente; «Ver detalle» (Pendientes) lleva al Explorador;
//     · a menos de 900 px las columnas de «Por rol» bajan una debajo de otra.
//
// ORDEN 112: las piezas de cada persona salen de la ficha de la Lista (ver probar-estructura-112.js, que compara dato por dato y mide tamaños);
//   aquí se mantienen las comprobaciones de comportamiento y de diseño de las órdenes 105-111 con la letra y las piezas nuevas.
//
// USO (base desechable con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada105 [SALIDA=/ruta] node scripts/probar-estructura-vistas.js
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
const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden105');
fs.mkdirSync(SALIDA, { recursive: true });
const CLAVE = 'Clave-Prueba-105x';
const CORREO_ADMIN = 'admin105@ejemplo.co';

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
     VALUES ('Admin Ciento Cinco', '1099105001', '1099105001', ?, '3001050000', ?, ?, 1, 0, 1)`, [CORREO_ADMIN, hash, await rol('admin')]);
  await q('UPDATE usuarios SET password_hash = ? WHERE id IN (?, ?)', [hash, ids.coord1, ids.ana]);
  await q("UPDATE usuarios SET email = 'ana105@ejemplo.co' WHERE id = ?", [ids.ana]);
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

  /** Las personas que cada vista dice tener, leídas de la pantalla. Los testigos se devuelven aparte (solo «Por rol» los muestra). */
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

  /** ORDEN 107 — el diseño del Ranking (Podio), con los datos que haya en pantalla. */
  async function comprobarDisenoRanking(etiqueta) {
    const d = await ev(`(() => {
      const num = (el) => parseInt(el.textContent.replace(/[^0-9]/g, ''), 10);
      const pods = [...document.querySelectorAll('.ev-pod')];
      const filas = [...document.querySelectorAll('.ev-fila-ranking')];
      const cs = (el, k) => getComputedStyle(el)[k];
      const box = (el) => el.getBoundingClientRect();
      const podio = document.querySelector('.ev-podio');
      const franja = document.querySelector('.ev-franja-sin-meta');
      const todos = [...document.querySelectorAll('.ev-podio, .ev-pod, .ev-medalla, .ev-pod-pct, .ev-ranking, .ev-fila-ranking, .ev-rk-barra, .ev-rk-barra > i, .ev-pct-grande, .ev-puesto, .ev-pastilla, .ev-tarjeta, .ev-anillo-av')];
      return {
        pods: pods.map((e) => ({ n: e.querySelector('.ev-medalla').textContent.trim(), pct: num(e.querySelector('.ev-pod-pct')), fs: cs(e.querySelector('.ev-pod-pct'), 'fontSize'), av: cs(e.querySelector('.ev-av-pod'), 'width'), borde: cs(e, 'borderTopColor'), bw: cs(e, 'borderTopWidth'), med: cs(e.querySelector('.ev-medalla'), 'backgroundColor'), medw: cs(e.querySelector('.ev-medalla'), 'width'), x: Math.round(box(e).left), bajo: Math.round(box(e).bottom), cifras: /\\d+\\s*de\\s*\\d+/.test(e.innerText) })),
        columnasPodio: podio ? cs(podio, 'gridTemplateColumns').split(' ').length : 0,
        claseN: podio ? podio.className : '',
        filas: filas.map((f) => ({ pos: f.querySelector('.ev-puesto').textContent.trim(), pct: num(f.querySelector('.ev-pct-grande')), barra: cs(f.querySelector('.ev-rk-barra'), 'height'), radio: cs(f.querySelector('.ev-rk-barra'), 'borderTopLeftRadius'), fondo: cs(f.querySelector('.ev-rk-barra'), 'backgroundColor'), relleno: cs(f.querySelector('.ev-rk-barra > i'), 'backgroundImage'), ancho: box(f.querySelector('.ev-rk-barra > i')).width / box(f.querySelector('.ev-rk-barra')).width, textoEnBarra: f.querySelector('.ev-rk-barra').textContent.trim(), cifras: f.querySelector('.ev-rk-cifra .avance-cifra').textContent.trim(), cifX: Math.round(box(f.querySelector('.ev-rk-cifra .avance-cifra')).top), barraFin: Math.round(box(f.querySelector('.ev-rk-barra')).bottom), pctColor: cs(f.querySelector('.ev-pct-grande'), 'color'), pctFs: cs(f.querySelector('.ev-pct-grande'), 'fontSize'), punto: !!f.querySelector('.ev-punto-rojo') })),
        franja: franja ? { fondo: cs(franja, 'backgroundColor'), borde: cs(franja, 'borderTopColor'), texto: franja.textContent } : null,
        rojos: todos.filter((e) => /rgb\\(198, 40, 40\\)|rgb\\(178, 106, 0\\)|rgb\\(46, 125, 50\\)|#C62828|#B26A00/i.test(cs(e, 'backgroundColor') + cs(e, 'backgroundImage') + cs(e, 'color') + cs(e, 'borderTopColor'))).length,
        fichaActiva: cs(document.querySelector('.ev-fichas-filtro .activa'), 'backgroundColor') + '|' + cs(document.querySelector('.ev-fichas-filtro .activa'), 'color'),
      };
    })()`);
    console.log(`  · Ranking (${etiqueta}): podio ${d.pods.length}, lista ${d.filas.length}, franja ${d.franja ? 'sí' : 'no'}`);
    const todosPct = [...d.pods].sort((a, b) => a.n - b.n).map((x) => x.pct).concat(d.filas.map((f) => f.pct));
    ok(todosPct.every((v, i) => i === 0 || todosPct[i - 1] >= v), 'ordenado de mayor a menor % (podio y lista)', todosPct);
    ok(d.pods.length === Math.min(3, d.pods.length) && d.filas.length >= 0, 'el podio muestra hasta 3');
    ok(d.filas.every((f, i) => Number(f.pos) === i + 4), 'la lista arranca en el 4.º', d.filas.map((f) => f.pos));
    ok(d.pods.map((x) => x.n).join(',') === ({ 3: '2,1,3', 2: '2,1', 1: '1', 0: '' })[d.pods.length], 'el podio va en orden 2-1-3 (con los que haya)', d.pods.map((x) => x.n));
    if (d.pods.length === 3) {
      ok(d.columnasPodio === 3, 'podio en 3 columnas');
      ok(d.pods.every((x) => Math.abs(x.bajo - d.pods[0].bajo) <= 1), 'alineadas abajo', d.pods.map((x) => x.bajo));
    }
    d.pods.forEach((x) => {
      const primero = x.n === '1';
      ok(x.cifras && x.fs === (primero ? '34px' : '28px') && x.av === (primero ? '64px' : '54px') && x.medw === '30px', `puesto ${x.n}: % de ${primero ? 34 : 28} px (ORDEN 114), avatar de ${primero ? 64 : 54} px, medalla de 30 px y «X de Y»`, x);
      ok(x.med === ({ 1: 'rgb(255, 195, 0)', 2: 'rgb(11, 94, 215)', 3: 'rgb(8, 66, 152)' })[x.n], `medalla ${x.n} del color de marca`, x.med);
      if (primero) ok(x.bw === '2px' && x.borde === 'rgb(255, 195, 0)', 'el 1.º con borde amarillo de 2 px', x);
    });
    d.filas.forEach((f) => {
      ok(f.barra === '16px', `barra de ${f.barra} (ORDEN 114: 16 px)`, f.barra);
      ok(f.radio === '99px' || parseFloat(f.radio) >= 15, 'barra con radio de píldora', f.radio);
      ok(f.fondo === 'rgb(232, 240, 253)' && /rgb\(11, 94, 215\).*rgb\(8, 66, 152\)/.test(f.relleno), 'fondo #e8f0fd y relleno degradado #0B5ED7 → #084298', { fondo: f.fondo, relleno: f.relleno });
      ok(f.ancho >= 0.0195, 'relleno visible (mínimo 2 %)', f.ancho);
      ok(f.textoEnBarra === '' && f.cifras.length > 0, '«X de Y» (el de la Lista) fuera de la barra, en su propia columna (ORDEN 114)', f);
      ok(f.pctColor === 'rgb(8, 66, 152)' && f.pctFs === '18px', '% de 18 px (ORDEN 114) en #084298', f);
      ok(f.punto === (f.pct < 25), 'punto rojo solo si va bajo 25 %', f);
    });
    ok(d.rojos === 0, 'no queda rojo/ámbar/verde de semáforo en barras, anillos ni porcentajes', d.rojos);
    ok(d.fichaActiva === 'rgb(8, 66, 152)|rgb(255, 255, 255)', 'ficha de filtro activa en #084298 con texto blanco', d.fichaActiva);
    if (d.franja) ok(d.franja.fondo === 'rgb(255, 248, 219)' && d.franja.borde === 'rgb(242, 211, 122)' && /Asígneles meta para que entren al ranking/.test(d.franja.texto), 'franja amarilla suave «Sin meta asignada (N)…»', d.franja);
    return d;
  }

  const VISTAS = ['tarjetas', 'rol', 'ranking', 'explorador', 'pendientes'];

  async function comprobarRol(etiqueta, correo, clave, anchos) {
    for (const w of anchos) {
      console.log(`\n[${etiqueta} · ${w} px]`);
      await ancho(w, etiqueta === 'administrador' ? 1500 : 900); await limpiar();
      ok(await entrar(correo, clave) === 200, `sesión de ${etiqueta}`);
      const cargo = await abrirEstructura();
      ok(cargo, 'la pantalla carga con la lista (vista por defecto)');
      if (!cargo) { console.log('    ruta:', await ev('location.pathname'), p.avisos); continue; }
      const activa = await ev("document.querySelector('#selector-vistas-estructura .activa').dataset.vista");
      ok(activa === 'lista', 'la vista por defecto es «Lista»', activa);
      const botones = await txt('#selector-vistas-estructura button');
      ok(JSON.stringify(botones) === JSON.stringify(['Lista', 'Tarjetas', 'Por rol', 'Ranking', 'Explorador', 'Pendientes']), 'seis botones en el orden pedido', botones);
      const lista = await nombresLista();
      ok(lista.length > 0, `la lista trae ${lista.length} personas`);
      for (const v of VISTAS) {
        await elegir(v);
        const r = await personasDeVista(v);
        ok(igual(r.gente, v === 'pendientes' ? r.gente.filter((n) => lista.includes(n)) : lista) && (v !== 'pendientes' || r.gente.every((n) => lista.includes(n))),
          `${v}: las mismas personas que la lista (${r.gente.length}${v === 'pendientes' ? ' distintas en algún grupo' : ''})`, { lista, vista: r.gente });
        const lleno = await ev("document.getElementById('vistas-estructura').innerText.length");
        ok(lleno > 20 && !(await ev("document.getElementById('tbody-estructura').offsetParent")), `${v}: se ve y la lista queda oculta`);
        ok(await sinDesborde(), `${v}: sin desborde horizontal`);
        if (etiqueta === 'administrador') await foto(`${v}-admin-${w}`);
      }
      // búsqueda: aplica a todas las vistas
      await elegir('lista'); await buscar('Alfa');
      const listaBuscada = await nombresLista();
      ok(listaBuscada.length > 0 && listaBuscada.length <= lista.length, `búsqueda «Alfa»: la lista queda en ${listaBuscada.length}`, listaBuscada);
      for (const v of VISTAS) {
        await elegir(v);
        const r = await personasDeVista(v);
        const esperado = v === 'pendientes' ? r.gente.filter((n) => listaBuscada.includes(n)) : listaBuscada;
        ok(igual(r.gente, esperado) && (v !== 'pendientes' || r.gente.every((n) => listaBuscada.includes(n))), `${v}: con la búsqueda muestra las mismas que la lista`, { listaBuscada, vista: r.gente });
      }
      await ev("document.getElementById('btn-quitar-filtros-estructura').click()"); await espera(500);
      // se recuerda al recargar
      await elegir('ranking');
      await ir(base + '/territorial.html');
      await esperar("!!document.querySelector('#selector-vistas-estructura .activa') && document.getElementById('vistas-estructura').innerText.length > 20", 12000);
      ok(await ev("document.querySelector('#selector-vistas-estructura .activa').dataset.vista") === 'ranking', 'al recargar sigue en «Ranking» (se recuerda por usuario)');
      await elegir('lista');
      ok(p.avisos.length === 0, 'sin errores de consola', p.avisos);
    }
  }


  /* ============ ORDEN 111: sin testigos, letra más grande y WhatsApp en las cinco vistas ============ */
  async function comprobarOrden111(etq, correo, anchos) {
    for (const w of anchos) {
      console.log(`\n[ORDEN 111 · ${etq} · ${w} px]`);
      await ancho(w); await limpiar(); await entrar(correo); await abrirEstructura();
      // La Lista es la referencia: nombre -> { href, onclick, texto } del botón verde (o null si no lo trae).
      const lista = await ev(`(() => { const m = {}; document.querySelectorAll('#tbody-estructura .ficha-p').forEach(f => { const a = f.querySelector(':scope > .ficha-cuerpo .btn-wa-fila'); m[f.querySelector(':scope > .ficha-cuerpo .nombre-p').textContent.trim()] = a ? { href: a.getAttribute('href'), onclick: a.getAttribute('onclick'), texto: a.textContent.trim() } : null; }); return m; })()`);
      const conTel = Object.values(lista).filter(Boolean).length, sinTel = Object.values(lista).filter((x) => !x).length;
      ok(conTel > 0, `Lista: ${conTel} con botón de WhatsApp y ${sinTel} sin celular`);
      if (etq === 'administrador') ok(sinTel > 0 && Object.values(lista).some((x) => x && /^💬 \d{3} \d{3} \d{4}$/.test(x.texto)), 'hay personas sin celular y el número sale como «310 471 2806»', lista);
      // Lo que cada vista pinta: [{ nombre, href, onclick, texto, titulo }] por persona, y qué personas hay.
      const leer = (contSel, nombreSel, waSel) => ev(`(() => [...document.querySelectorAll(${JSON.stringify(contSel)})].map(c => { const a = c.querySelector(${JSON.stringify(waSel)}); return { nombre: c.querySelector(${JSON.stringify(nombreSel)}).textContent.trim(), href: a && a.getAttribute('href'), onclick: a && a.getAttribute('onclick'), texto: a && a.textContent.trim(), titulo: a && a.getAttribute('title'), clase: a && a.className }; }))()`);
      const compara = (vista, filas, tipo, puedeVaciar) => {
        const malas = filas.filter((x) => {
          const ref = lista[x.nombre];
          if (ref === undefined) return true;                       // una persona que la Lista no tiene
          if (!ref) return !!x.href;                                // sin celular en la Lista → sin botón aquí
          return x.href !== ref.href || x.onclick !== ref.onclick || (tipo === 'pildora' ? x.texto !== ref.texto : !x.titulo.includes(ref.texto.replace('💬 ', '')));
        });
        ok((puedeVaciar || filas.length > 0) && malas.length === 0, `${vista}: WhatsApp igual al de la Lista en ${filas.length} personas (mismo href, onclick y número; sin celular → sin botón)`, malas.slice(0, 3));
        ok(filas.filter((x) => lista[x.nombre]).every((x) => !!x.href), `${vista}: todas las que tienen celular en la Lista lo traen`);
      };
      await elegir('tarjetas');
      compara('Tarjetas', await leer('.ev-tarjeta', '.ev-nombre', '.btn-wa-fila'), 'pildora');
      await elegir('rol');
      compara('Por rol', await leer('.ev-mini', '.ev-nombre-enlace', '.btn-wa-fila'), 'pildora');
      await elegir('ranking');
      compara('Ranking (podio)', await leer('.ev-pod', '.ev-pod-nombre', '.btn-wa-fila'), 'pildora');
      compara('Ranking (filas)', await leer('.ev-fila-ranking', '.ev-nombre-enlace', '.btn-wa-fila'), 'pildora', true);
      await elegir('pendientes');
      compara('Pendientes', await leer('.ev-pend-lista li:not(.ev-pend-nadie)', '.ev-pend-quien .ev-nombre-enlace', '.btn-wa-fila'), 'pildora');
      await elegir('explorador');
      const nodos = await ev("document.querySelectorAll('.ev-nodo-btn').length");
      let fichas = [], equipos = [];
      for (let k = 0; k < nodos; k++) {
        await ev(`document.querySelectorAll('.ev-nodo-btn')[${k}].click()`); await espera(200);
        fichas = fichas.concat(await leer('#ev-ficha', 'h3', '.ev-datos .btn-wa-fila'));
        equipos = equipos.concat(await leer('#ev-ficha .ev-equipo li', '.ev-nombre-enlace', '.btn-wa-fila'));
      }
      compara('Explorador (ficha)', fichas, 'pildora');
      if (equipos.length) compara('Explorador (Su equipo)', equipos, 'pildora');
      // (ORDEN 112: en la ficha del Explorador la píldora va en el bloque de contacto, no junto a «Editar»)

      // ---- Por rol sin testigos, 3 columnas a lo ancho
      await elegir('rol');
      const col = await ev(`(() => { const g = document.querySelector('.ev-columnas'), r = g.getBoundingClientRect(); const cs = [...g.children].map(c => c.getBoundingClientRect()); return { n: getComputedStyle(g).gridTemplateColumns.split(' ').length, ancho: r.width, suma: cs.reduce((t, c) => t + c.width, 0), gaps: parseFloat(getComputedStyle(g).columnGap) * (cs.length - 1), titulos: [...g.querySelectorAll('.ev-columna-cab span:first-child')].map(e => e.textContent.trim()), tam: [...g.querySelectorAll('.ev-columna-cab')].map(e => getComputedStyle(e).fontSize) }; })()`);
      ok(col.n === 3 && Math.abs(col.suma + col.gaps - col.ancho) < 2, 'Por rol: 3 columnas que ocupan todo el ancho', col);
      ok(JSON.stringify(col.titulos) === JSON.stringify(['Coordinadores', 'Líderes', 'Sublíderes']) && col.tam.every((t) => t === '16px'), 'Por rol: encabezados Coordinadores, Líderes y Sublíderes en 16 px (ORDEN 114)', col);
      for (const v of VISTAS.filter((x) => x !== 'lista')) {
        await elegir(v);
        ok(!/Testig/.test(await ev("document.getElementById('vistas-estructura').innerText")), `${v}: no hay testigos`);
        ok(await sinDesborde(), `${v}: sin desborde de la página a ${w} px`);
        ok(await ev(`(() => { const c = document.getElementById('vistas-estructura').getBoundingClientRect(); return [...document.querySelectorAll('#vistas-estructura *')].every(e => { const r = e.getBoundingClientRect(); return r.width === 0 || (r.right <= c.right + 1 && r.left >= c.left - 1); }); })()`), `${v}: nada se sale de su caja a ${w} px`);
        if (etq === 'administrador' && w === 1280) { await ev("window.scrollTo(0, document.getElementById('vistas-estructura').getBoundingClientRect().top + window.scrollY - 70)"); await espera(250); await foto(`orden111-${v}-1280`); await ev('window.scrollTo(0, 0)'); }
      }

      // ---- tamaños de letra: ORDEN 112 los cambió (nombre 19, secundarios 16, chips 14, botones 15 y ≥ 38 px) y los mide probar-estructura-112.js
      ok(p.avisos.length === 0, `sin errores de consola (ORDEN 111 · ${etq} · ${w})`, p.avisos);
    }
  }

  /* ============ ADMINISTRADOR ============ */
  await comprobarRol('administrador', CORREO_ADMIN, CLAVE, [1280, 1600]);
  await comprobarOrden111('administrador', CORREO_ADMIN, [1280, 1600]);

  console.log('\n[Administrador · detalle de cada vista · 1280 px]');
  await ancho(1280); await limpiar(); await entrar(CORREO_ADMIN); await abrirEstructura();
  const listaAdmin = await nombresLista();
  const total = await ev("document.getElementById('contador-estructura').textContent");
  ok(/registro/.test(total), 'contador de la lista', total);

  await elegir('tarjetas');
  ok(await ev("getComputedStyle(document.querySelector('.ev-grid-tarjetas')).gridTemplateColumns.split(' ').length >= 3"), 'Tarjetas: cuadrícula de 3 o más columnas a 1280 px (ORDEN 112: mínimo de 300 px por tarjeta)');
  const tarjeta = await ev("(() => { const t = [...document.querySelectorAll('.ev-tarjeta')].find(x => x.querySelector('.ev-nombre').textContent.includes('Beto')); return { texto: t.innerText, anillo: !!t.querySelector('.ev-anillo-av'), titulo: t.querySelector('.jefe-p').innerText, cifras: [...t.querySelectorAll('.ev-cifras3 > div')].map(d => d.innerText.replace(/\\s+/g, ' ')), pastilla: t.querySelector('.ev-pastilla').textContent.trim(), editar: !![...t.querySelectorAll('.btn-neutro')].find(b => b.textContent.trim() === 'Editar'), equipo: !!t.querySelector('[data-accion=equipo]') }; })()");
  ok(/Líder/.test(tarjeta.texto) && tarjeta.pastilla === '50%' && /Marta/.test(tarjeta.titulo), 'Tarjeta de Beto: rol, pastilla 50 % y «Le reporta a Marta» escrito en la tarjeta (ORDEN 112)', tarjeta);
  ok(JSON.stringify(tarjeta.cifras) === JSON.stringify(['5 Registros', '10 Meta', '1 Equipo']), 'franja de 3 cifras: Registros · Meta · Equipo', tarjeta.cifras);
  ok(tarjeta.anillo && tarjeta.editar && tarjeta.equipo, 'con anillo, Editar y Ver equipo');
  ok(!/Cabeza de su rama|equipo \d/.test(tarjeta.texto) && !(await ev("document.querySelector('.ev-franja')")), 'sin la franja de arriba ni el texto «Cabeza de su rama · equipo N»');
  const zonas = (await txt('.ev-tarjeta .chip-p')).map((t) => t.toUpperCase());
  ok(zonas.includes('URBANO') && zonas.includes('RURAL'), 'etiquetas URBANO y RURAL (los chips de la Lista)', zonas);

  const dt = await ev(`(() => {
    const cs = (el, k) => getComputedStyle(el)[k];
    const g = document.querySelector('.ev-grid-tarjetas');
    const t = (n) => [...document.querySelectorAll('.ev-tarjeta')].find((x) => x.querySelector('.ev-nombre').textContent.includes(n));
    const info = (n) => { const x = t(n); return { av: cs(x.querySelector('.ev-av-n'), 'backgroundColor'), avTxt: cs(x.querySelector('.ev-av-n'), 'color'), avW: cs(x.querySelector('.ev-av-n'), 'width'), avB: cs(x.querySelector('.ev-av-n'), 'borderTopWidth'), anillo: cs(x.querySelector('.ev-anillo-av'), 'width'), fondoAnillo: cs(x.querySelector('.ev-anillo-av'), 'backgroundImage'), pastilla: x.querySelector('.ev-pastilla').textContent.trim(), pastColor: cs(x.querySelector('.ev-pastilla'), 'backgroundColor'), punto: !!x.querySelector('.ev-pastilla .ev-punto-rojo'), puntoTam: x.querySelector('.ev-punto-rojo') ? cs(x.querySelector('.ev-punto-rojo'), 'width') + '/' + cs(x.querySelector('.ev-punto-rojo'), 'backgroundColor') : null, puntoTitle: x.querySelector('.ev-punto-rojo') ? x.querySelector('.ev-punto-rojo').title : null, chipRol: cs(x.querySelector('.chip-p'), 'backgroundColor') + '|' + cs(x.querySelector('.chip-p'), 'color'), meta: x.querySelectorAll('.ev-cifras3 b')[1].textContent.trim(), btnE: x.querySelector('.ev-btn-editar') ? cs(x.querySelector('.ev-btn-editar'), 'borderTopColor') + '|' + cs(x.querySelector('.ev-btn-editar'), 'borderTopWidth') : null, btnV: cs(x.querySelector('.ev-btn-equipo'), 'backgroundColor') + '|' + cs(x.querySelector('.ev-btn-equipo'), 'color'), radio: cs(x, 'borderTopLeftRadius'), gap: cs(g, 'columnGap'), pad: cs(x, 'padding'), bordeTarjeta: cs(x, 'borderTopColor') }; };
    const rojos = [...document.querySelectorAll('.ev-anillo-av, .ev-pastilla')].filter((e) => /rgb\\(198, 40, 40\\)|rgb\\(178, 106, 0\\)|rgb\\(46, 125, 50\\)/.test(cs(e, 'backgroundImage') + cs(e, 'backgroundColor') + cs(e, 'color'))).length;
    return { coord: info('Marta'), lider: info('Beto'), sub: info('Sara'), otro: info('Olga'), asp: info('Aurelio'), sinMeta: info('Carla'), bajo: info('Ana'), rojos };
  })()`);
  ok(dt.coord.av === 'rgb(11, 94, 215)' && dt.lider.av === 'rgb(8, 66, 152)' && dt.sub.av === 'rgb(255, 195, 0)' && dt.sub.avTxt === 'rgb(61, 44, 0)' && dt.otro.av === 'rgb(91, 107, 134)' && dt.asp.av === 'rgb(91, 107, 134)',
    'avatar con el color del rol (coordinador azul, líder azul oscuro, sublíder amarillo con texto oscuro, otros gris azulado)', dt);
  ok(dt.coord.avW === '72px' && dt.coord.avB === '4px' && dt.coord.anillo === '96px' && dt.coord.radio === '18px' && dt.coord.gap === '16px', 'anillo de 96 px, avatar de 72 px con borde blanco de 4 px, tarjeta de radio 18 px y gap de 16 px', dt.coord);
  ok(/rgb\(11, 94, 215\)/.test(dt.coord.fondoAnillo) && /conic-gradient/.test(dt.coord.fondoAnillo) && /rgb\(232, 240, 253\)/.test(dt.coord.fondoAnillo), 'anillo conic-gradient azul sobre #e8f0fd', dt.coord.fondoAnillo);
  ok(/repeating-conic-gradient/.test(dt.sinMeta.fondoAnillo) && dt.sinMeta.pastilla === 'sin meta' && dt.sinMeta.meta === '—', 'sin meta: anillo punteado, pastilla «sin meta» y Meta «—»', dt.sinMeta);
  ok(dt.coord.pastColor === 'rgb(255, 195, 0)' && dt.coord.pastilla === '30%', 'pastilla amarilla con el %', dt.coord);
  ok(dt.bajo.punto && dt.bajo.puntoTam === '8px/rgb(229, 72, 77)' && dt.bajo.puntoTitle === 'Menos del 25 % de su meta' && !dt.coord.punto, 'punto rojo de 8 px (#e5484d) con title solo bajo 25 %', { bajo: dt.bajo.puntoTam, titulo: dt.bajo.puntoTitle });
  ok(dt.rojos === 0, 'Tarjetas: ningún anillo ni pastilla en rojo/ámbar/verde de semáforo', dt.rojos);
  ok(dt.coord.btnV === 'rgb(8, 66, 152)|rgb(255, 255, 255)', 'botones: Ver equipo azul oscuro con texto blanco (Editar y Eliminar son los de la Lista)', dt.coord);
  await foto('tarjetas-admin-1280-detalle');

  // Editar abre el formulario de siempre (pide la contraseña propia primero)
  await ev("[...document.querySelectorAll('.ev-tarjeta .btn-neutro')].find(b => b.textContent.trim() === 'Editar').click()");
  const pideClave = await esperar("!!document.querySelector('.overlay.abierto input[type=password]')", 5000);
  ok(pideClave, 'Editar pide la contraseña propia, como en la lista');
  if (pideClave) {
    await ev(`(() => { const o = document.querySelector('.overlay.abierto input[type=password]'); o.value = ${JSON.stringify(CLAVE)}; o.form.requestSubmit ? o.form.requestSubmit() : o.form.dispatchEvent(new Event('submit', { cancelable: true })); })()`);
    ok(await esperar("document.getElementById('overlay-form').classList.contains('abierto') && document.getElementById('modal-form-titulo').textContent === 'Editar persona'", 8000), 'y abre «Editar persona»');
    await ev("document.getElementById('cerrar-modal').click()"); await espera(300);
  }

  // Ver equipo
  await ev("[...document.querySelectorAll('.ev-tarjeta')].find(x => x.querySelector('.ev-nombre').textContent.includes('Marta')).querySelector('[data-accion=equipo]').click()");
  await espera(500);
  const equipoMarta = await txt('.ev-tarjeta .ev-nombre');
  ok(equipoMarta.length === 7 && equipoMarta.some((n) => n.includes('Marta')) && equipoMarta.some((n) => n.includes('Tito')) && !equipoMarta.some((n) => n.includes('Eva')),
    '«Ver equipo» de Marta: ella y su gente (7), sin la rama de Pedro', equipoMarta);
  ok(await ev("getComputedStyle(document.getElementById('aviso-equipo-estructura')).display !== 'none'"), 'franja «Mostrando el equipo de…» con «Quitar»');
  await elegir('lista');
  const listaEquipo = await nombresLista();
  ok(igual(listaEquipo, equipoMarta), 'la lista también queda con ese equipo (mismo filtro para todas las vistas)', listaEquipo);
  await ev("document.getElementById('btn-quitar-equipo-estructura').click()"); await espera(400);
  ok(igual(await nombresLista(), listaAdmin), '«Quitar» devuelve a todos');

  await elegir('rol');
  const rolInfo = await personasDeVista('rol');
  ok(JSON.stringify(rolInfo.columnas) === JSON.stringify(['Coordinadores', 'Líderes', 'Sublíderes']), 'Por rol: tres columnas con su nombre (ORDEN 111: sin Testigos)', rolInfo.columnas);
  ok(rolInfo.testigos.length === 0 && !/Testigo/.test(await ev("document.getElementById('vistas-estructura').innerText")), 'Por rol: ningún testigo (ni columna ni nombres)', rolInfo.testigos);
  ok(await ev("getComputedStyle(document.querySelector('.ev-columnas')).gridTemplateColumns.split(' ').length === 3"), 'tres columnas a 1280 px');
  const colores = await ev("[...document.querySelectorAll('.ev-columna-cab')].map(h => getComputedStyle(h).backgroundColor)");
  ok(JSON.stringify(colores) === JSON.stringify(['rgb(11, 94, 215)', 'rgb(8, 66, 152)', 'rgb(138, 90, 0)']), 'encabezados con los colores de rol', colores);
  const agregarAdmin = await txt('.ev-columna-pie .ev-agregar');
  ok(JSON.stringify(agregarAdmin) === JSON.stringify(['+ Agregar coordinador', '+ Agregar líder', '+ Agregar sublíder']), 'administrador: «+ Agregar» en las tres columnas', agregarAdmin);
  for (const [cat, texto] of [['usuario', 'sublíder'], ['coordinador', 'coordinador'], ['lider', 'líder']]) {
    await ev(`document.querySelector('.ev-agregar[data-cat="${cat}"]').click()`);
    const abierto = await esperar("document.getElementById('overlay-form').classList.contains('abierto')", 8000);
    await espera(900);
    const marcado = await ev("(document.querySelector('#chips-cargo-persona input:checked') || {}).value");
    ok(abierto && marcado === cat, `«+ Agregar ${texto}» abre el formulario de hoy con la categoría ya puesta (${cat})`, { abierto, marcado });
    await ev("document.getElementById('cerrar-modal').click()"); await espera(300);
  }
  await foto('rol-admin-1280-b');
  // a menos de 900 px las columnas bajan una debajo de otra
  await ancho(880);
  await espera(300);
  ok(await ev("getComputedStyle(document.querySelector('.ev-columnas')).gridTemplateColumns.split(' ').length === 1"), 'a 880 px las columnas de «Por rol» bajan una debajo de otra');
  ok(await sinDesborde(), 'a 880 px sin desborde horizontal');
  await foto('rol-admin-880');
  for (const v of ['tarjetas', 'ranking']) {
    await elegir(v); await ancho(880); await espera(300);
    ok(await sinDesborde(), `${v} a 880 px: sin desborde horizontal`);
    if (v === 'ranking') {
      const m = await ev("(() => { const f = document.querySelector('.ev-fila-ranking'); const b = f.querySelector('.ev-rk-barra').getBoundingClientRect(); return { barra: getComputedStyle(f.querySelector('.ev-rk-barra')).height, anchoBarra: Math.round(b.width), podio: getComputedStyle(document.querySelector('.ev-podio')).gridTemplateColumns.split(' ').length }; })()");
      ok(m.barra === '16px' && m.anchoBarra > 300 && m.podio === 3, 'ranking a 880 px: barra de 16 px a todo lo ancho y podio de 3 columnas', m);
    }
    await ev("document.getElementById('vistas-estructura').scrollIntoView()"); await espera(200);
    await foto(v + '-admin-880');
  }
  await ancho(1280);

  await elegir('ranking');
  const rk = await personasDeVista('ranking');
  ok(rk.con.length > 0 && rk.sin.length > 0, 'Ranking: con meta y «Sin meta asignada» (franja amarilla suave)', rk);
  await comprobarDisenoRanking('administrador 1280');
  ok(JSON.stringify(await txt('.ev-fichas-filtro button')) === JSON.stringify(['Todos', 'Coordinadores', 'Líderes', 'Sublíderes']), 'fichas de filtro: Todos / Coordinadores / Líderes / Sublíderes');
  await ev("document.querySelector('.ev-fichas-filtro [data-valor=sublider]').click()"); await espera(300);
  const soloSub = await personasDeVista('ranking');
  ok(soloSub.gente.length === 2 && soloSub.gente.every((n) => /Sublíder/.test(n)), 'la ficha «Sublíderes» deja solo a los sublíderes', soloSub.gente);
  const dSub = await comprobarDisenoRanking('ficha Sublíderes');
  ok(dSub.pods.length === 1 && dSub.filas.length === 0, 'con 1 con meta (Sublíderes): el podio muestra solo al 1.º y no hay lista', { pods: dSub.pods.length, filas: dSub.filas.length });
  await foto('ranking-admin-1280-uno-con-meta');
  await ev("document.querySelector('.ev-fichas-filtro [data-valor=coordinador]').click()"); await espera(300);
  const dCoord = await comprobarDisenoRanking('ficha Coordinadores');
  ok(dCoord.pods.length === 2 && dCoord.filas.length === 0 && await sinDesborde(), 'con 2 con meta (Coordinadores): el podio muestra 2 (2.º y 1.º) y no hay lista', { pods: dCoord.pods.length, filas: dCoord.filas.length });
  await foto('ranking-admin-1280-dos-con-meta');
  await ev("document.querySelector('.ev-fichas-filtro [data-valor=todos]').click()"); await espera(300);
  await ev("document.querySelector('.ev-fichas-filtro [data-valor=todos]').click()"); await espera(300);

  await elegir('explorador');
  const primera = await ev("document.querySelector('.ev-nodo.sel .ev-nodo-nombre').textContent.trim()");
  const primeroDelArbol = await ev("document.querySelector('.ev-nodo .ev-nodo-nombre').textContent.trim()");
  ok(primera === primeroDelArbol && (await ev("document.querySelector('#ev-ficha h3').textContent.trim()")) === primera, 'Explorador: al abrir queda seleccionada la primera persona y su ficha', { primera });
  ok(await ev("Math.round(document.getElementById('ev-arbol').getBoundingClientRect().width)") >= 370 && await ev("Math.round(document.getElementById('ev-arbol').getBoundingClientRect().width)") <= 390, 'panel izquierdo de ≈380 px (ORDEN 112: letra más grande)');
  await ev("[...document.querySelectorAll('.ev-nodo-btn')].find(b => b.textContent.includes('Marta')).click()"); await espera(350);
  const ficha = await ev("document.getElementById('ev-ficha').innerText");
  ok(/Marta Coordinadora/.test(ficha) && /Personas a cargo/.test(ficha) && /Su equipo/.test(ficha) && /WhatsApp/.test(ficha) && /Correo · sexo/.test(ficha) && /Autorización de datos/.test(ficha), 'ficha de Marta: indicadores, datos y «Su equipo»', ficha.slice(0, 200));
  ok(await ev("document.querySelectorAll('#ev-ficha .ev-equipo li').length") === 4, 'su equipo: sus 4 líderes con barra');
  ok(await ev("document.querySelectorAll('#ev-ficha .ev-ind').length") === 4, 'cuatro indicadores');
  ok(await ev("[...document.querySelectorAll('#ev-ficha .ev-ficha-botones .btn-neutro')].some(b => b.textContent.trim() === 'Editar') && !!document.querySelector('#ev-ficha [data-accion=agregar]')"), 'botones Editar y «+ Agregar» (administrador)');
  await ev("document.querySelector('.ev-triangulo').click()"); await espera(300);
  ok(await ev("document.querySelector('.ev-triangulo').textContent.trim()") === '▸', 'el triángulo pliega la rama (▸)');
  const nodosPlegado = (await txt('.ev-nodo .ev-nodo-nombre')).length;
  ok(nodosPlegado < listaAdmin.length, 'y esconde a su equipo', { nodosPlegado, total: listaAdmin.length });
  await ev("document.querySelector('.ev-triangulo').click()"); await espera(300);
  ok((await txt('.ev-nodo .ev-nodo-nombre')).length === listaAdmin.length, 'al desplegar vuelven todos');

  await elegir('pendientes');
  const pend = await personasDeVista('pendientes');
  const g = Object.fromEntries(pend.grupos.map((x) => [x.g, x.n]));
  ok(JSON.stringify(Object.keys(g)) === JSON.stringify(['sin-equipo', 'sin-autorizacion', 'sin-lugar', 'avance-bajo', 'al-dia']), 'Pendientes: los cinco grupos', Object.keys(g));
  ok(['Carla', 'Diego', 'Eva', 'Aurelio', 'Olga'].every((n) => g['sin-equipo'].some((x) => x.includes(n))) && !g['sin-equipo'].some((x) => /Ana|Beto|Marta/.test(x)), '«Sin equipo todavía»: Carla, Diego, Eva, el aspirante y la coordinadora de organizaciones; no Ana, Beto ni Marta', g['sin-equipo']);
  ok(g['sin-autorizacion'].some((x) => x.includes('Beto')) && !g['sin-autorizacion'].some((x) => x.includes('Diego')), '«Sin autorización»: incluye a Beto (pendiente) y no a Diego (firmada)', g['sin-autorizacion']);
  ok(!g['sin-lugar'].some((x) => x.includes('Diego')) && g['sin-lugar'].some((x) => x.includes('Ana')), '«Falta lugar de votación»: Ana sí, Diego no', g['sin-lugar']);
  ok(g['avance-bajo'].some((x) => x.includes('Ana')) && g['avance-bajo'].some((x) => x.includes('Eva')) && !g['avance-bajo'].some((x) => x.includes('Diego')), '«Avance bajo»: Ana (14 %) y Eva (15 %), no Diego', g['avance-bajo']);
  ok(g['al-dia'].length === 1 && g['al-dia'][0].includes('Diego'), '«Al día»: solo Diego (firmada, lugar completo, 90 %)', g['al-dia']);
  ok(new Set(Object.values(g).flat()).size < Object.values(g).flat().length, 'una persona puede salir en varios grupos');
  const bordes = await ev("[...document.querySelectorAll('.ev-pend')].map(s => getComputedStyle(s).borderTopColor)");
  ok(bordes[0] === 'rgb(198, 40, 40)' && bordes[1] === 'rgb(230, 154, 0)' && bordes[4] === 'rgb(46, 125, 50)', 'bordes superiores rojo / ámbar / verde', bordes);
  const botonesPend = await ev("(() => { const s = n => [...document.querySelectorAll('[data-grupo=' + n + '] .ev-pd-accion button')].map(b => b.textContent.trim()); return { eq: s('sin-equipo'), au: s('sin-autorizacion'), lu: s('sin-lugar'), av: s('avance-bajo') }; })()");
  ok(botonesPend.eq.every((t) => t === 'Agregar equipo') && botonesPend.au.every((t) => t === 'Ver') && botonesPend.lu.every((t) => t === 'Completar') && botonesPend.av.every((t) => t === 'Ver detalle'), 'botones: Agregar equipo / Ver / Completar / Ver detalle', botonesPend);
  await ev("document.querySelector('[data-grupo=avance-bajo] button').click()"); await espera(500);
  const destino = await ev("({ v: document.querySelector('#selector-vistas-estructura .activa').dataset.vista, h3: (document.querySelector('#ev-ficha h3') || {}).textContent })");
  ok(destino.v === 'explorador' && /Pedro|Ana|Eva/.test(destino.h3 || ''), '«Ver detalle» lleva al Explorador con esa persona', destino);
  await ev("document.querySelector('#selector-vistas-estructura [data-vista=pendientes]').click()"); await espera(350);
  await ev("document.querySelector('[data-grupo=sin-equipo] [data-accion=agregar]').click()");
  ok(await esperar("document.getElementById('overlay-form').classList.contains('abierto')", 8000), '«Agregar equipo» abre el formulario de hoy');
  await ev("document.getElementById('cerrar-modal').click()"); await espera(300);

  /* ---- Ranking con 2 y con 0 personas con meta (ORDEN 107) ---- */
  console.log('\n[Ranking · 0 con meta · 1280 px]');
  const metasOriginales = await q('SELECT id, meta_votos, meta_votos_base FROM estructura');
  // (El caso de 2 y de 1 con meta se prueba arriba con las fichas Coordinadores y Sublíderes: la meta de un jefe suma la de su equipo.)
  await q('UPDATE estructura SET meta_votos = 0, meta_votos_base = 0');
  await ir(base + '/territorial.html'); await esperar("document.querySelectorAll('#tbody-estructura .ficha-p').length > 0", 12000);
  await elegir('ranking');
  const r0 = await comprobarDisenoRanking('0 con meta');
  ok(r0.pods.length === 0 && r0.filas.length === 0 && r0.franja && /Sin meta asignada \(\d+\)/.test(r0.franja.texto), 'con 0 con meta: solo la franja amarilla', r0.franja);
  await foto('ranking-admin-1280-cero-con-meta');
  for (const m of metasOriginales) await q('UPDATE estructura SET meta_votos = ?, meta_votos_base = ? WHERE id = ?', [m.meta_votos, m.meta_votos_base, m.id]);
  await ir(base + '/territorial.html'); await esperar("document.querySelectorAll('#tbody-estructura .ficha-p').length > 0", 12000);
  await elegir('lista');
  ok(p.avisos.length === 0, 'sin errores de consola en el escenario de pocos con meta', p.avisos);

  /* ============ COORDINADOR ============ */
  await comprobarRol('coordinador', 'marta@ejemplo.co', CLAVE, [1280, 1600]);
  await comprobarOrden111('coordinador', 'marta@ejemplo.co', [1280, 1600]);
  console.log('\n[Coordinador · permisos de «+ Agregar»]');
  await ancho(1280); await limpiar(); await entrar('marta@ejemplo.co'); await abrirEstructura();
  await elegir('rol');
  const agregarCoord = await txt('.ev-columna-pie .ev-agregar');
  ok(JSON.stringify(agregarCoord) === JSON.stringify(['+ Agregar líder']), 'el coordinador solo ve «+ Agregar líder»', agregarCoord);
  ok(await ev("![...document.querySelectorAll('#vistas-estructura .btn-neutro')].some(b => b.textContent.trim() === 'Editar')"), 'y ninguna vista le ofrece Editar');
  await ev("document.querySelector('.ev-agregar[data-cat=lider]').click()");
  ok(await esperar("document.getElementById('overlay-form').classList.contains('abierto')", 8000), '«+ Agregar líder» abre el formulario (con la categoría fija en Líder)');
  await ev("document.getElementById('cerrar-modal').click()"); await espera(300);
  await elegir('explorador');
  await ev("[...document.querySelectorAll('.ev-nodo-btn')].find(b => b.textContent.includes('Ana')).click()"); await espera(300);
  ok(await ev("!document.querySelector('#ev-ficha [data-accion=agregar]')"), 'Explorador: en un líder no ofrece «+ Agregar» (un coordinador no agrega sublíderes)');
  await ev("[...document.querySelectorAll('.ev-nodo-btn')].find(b => b.textContent.includes('Marta')).click()"); await espera(300);
  ok(await ev("!!document.querySelector('#ev-ficha [data-accion=agregar]')"), 'y en su propia ficha sí (agrega líderes)');
  await elegir('pendientes');
  const botonesCoord = await txt('[data-grupo=sin-equipo] .ev-pd-accion button');
  ok(botonesCoord.every((t) => t === 'Agregar equipo'), 'Pendientes: «Agregar equipo» solo donde puede (un líder le agrega sublíderes: no → sin botón)', botonesCoord);

  /* ============ LÍDER ============ */
  await comprobarRol('líder', 'ana105@ejemplo.co', CLAVE, [1280]);
  await comprobarOrden111('líder', 'ana105@ejemplo.co', [1280, 1600]);
  console.log('\n[Líder · permisos]');
  await ancho(1280); await limpiar(); await entrar('ana105@ejemplo.co'); await abrirEstructura();
  await elegir('rol');
  ok((await txt('.ev-columna-pie .ev-agregar')).length === 0, 'el líder no ve ningún «+ Agregar»');
  ok(await ev("![...document.querySelectorAll('#vistas-estructura .btn-neutro')].some(b => b.textContent.trim() === 'Editar')"), 'ni Editar');

  nav.cerrar();
  servidor.close();
  await pool.end();
  console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
