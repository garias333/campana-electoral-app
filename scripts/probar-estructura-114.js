#!/usr/bin/env node
// scripts/probar-estructura-114.js — ORDEN 114: «Estructura territorial» (ESCRITORIO) con letra de tamaño medio y todo alineado en las seis vistas.
//   Con administrador (1280, 1440 y 1600 px), coordinadora y líder (1440 px):
//     · TAMAÑOS con getComputedStyle: nombre 17 px/700 y número 13 px gris; secundarios 14,5; leyendas, etiquetas y chips 12,5 (chips de 24 px);
//       botones y píldora de WhatsApp 13,5 px de 34 px de alto; cifras (podio 34/28, filas 18, franja 20, «X» 18); encabezados 16; árbol 14,5; título de ficha 20;
//       mínimo 12,5 px; interlineado 1,35;
//     · ALINEACIÓN MEDIDA: Tarjetas (mismo alto por fila de tarjetas y mismo top de nombre, chips, territorio, franja y botones), Podio (cada renglón a la
//       misma altura), Ranking y Pendientes (el left de cada columna coincide en todas las filas), Por rol (botones y avatar al mismo left, 12 px entre fichas),
//       Explorador (etiquetas de 160 px, 4 indicadores iguales), Lista (columnas fijas);
//     · Por rol: % en #084298 y punto rojo de 8 px solo bajo 25 %; Pendientes en una sola columna con «Ver todos (N)» a partir de 9;
//     · ningún botón de distinto alto en una fila, sin desbordes ni textos montados, cero errores de consola. Capturas a 1440 px en SALIDA.
//
// USO (base desechable con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada114 [SALIDA=/ruta] node scripts/probar-estructura-114.js
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
const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden114');
fs.mkdirSync(SALIDA, { recursive: true });
const CLAVE = 'Clave-Prueba-114x';
const CORREO_ADMIN = 'admin114@ejemplo.co';

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
     VALUES ('Admin Ciento Catorce', '1099114001', '1099114001', ?, '3001050000', ?, ?, 1, 0, 1)`, [CORREO_ADMIN, hash, await rol('admin')]);
  await q('UPDATE usuarios SET password_hash = ? WHERE id IN (?, ?)', [hash, ids.coord1, ids.ana]);
  await q("UPDATE usuarios SET email = 'ana114@ejemplo.co' WHERE id = ?", [ids.ana]);
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

  // ---- Datos para los cinco casos: Marta con comuna; Ana con barrio principal y dos territorios más (+2); Carla sin territorio ni autorización.
  const idUsuarioEst = async (u) => (await q('SELECT id FROM estructura WHERE usuario_id = ? AND cargo <> ?', [u, 'testigo']))[0].id;
  const [com] = await pool.query("INSERT INTO territorios (tipo, nombre, padre_id) VALUES ('comuna', 'Comuna 04 Ejemplo', ?)", [mun]);
  await q('UPDATE estructura SET territorio_id = ?, area = ? WHERE usuario_id = ?', [com.insertId, 'urbano', ids.coord1]);
  const eAna = await idUsuarioEst(ids.ana), eMarta = await idUsuarioEst(ids.coord1);
  const terr = async (nombre) => (await q('SELECT id FROM territorios WHERE nombre = ? LIMIT 1', [nombre]))[0].id;
  const tB1 = await terr('Barrio Los Ejemplos'), tB2 = await terr('Barrio La Muestra'), tVer = await terr('Vereda La Palma');
  await pool.query('INSERT IGNORE INTO estructura_territorios (estructura_id, territorio_id, es_principal) VALUES (?,?,1),(?,?,0),(?,?,0)', [eAna, tB1, eAna, tB2, eAna, tVer]);
  await pool.query('INSERT IGNORE INTO estructura_territorios (estructura_id, territorio_id, es_principal) VALUES (?,?,1)', [eMarta, com.insertId]);


  // ---- Gente extra para estresar la alineación: nombres de dos líneas, correos largos, sin teléfono, sin meta y más de 8 personas en un grupo de Pendientes.
  const NOMBRES = ['Alejandra María de los Ángeles Fernández Rodríguez', 'Bo', 'Cristóbal Hernández', 'Daniela Valentina Ospina Castañeda', 'Ernesto Gómez', 'Fabiola Restrepo Villegas de la Torre', 'Gustavo Adolfo', 'Heidy Johana Zapata', 'Iván Darío Cardona Montoya', 'Jimena López'];
  for (let k = 0; k < NOMBRES.length; k++) {
    const u = await nuevo(NOMBRES[k], '10770000' + String(k).padStart(2, '0'), rolLider, { telefono: k % 3 === 2 ? null : '30122200' + String(k).padStart(2, '0'), email: k % 2 ? null : `correo.muy.largo.de.una.persona.numero${k}@dominio-institucional-de-ejemplo.com.co` });
    await est(u, k % 4 === 0 ? 'usuario' : 'lider', k % 2 ? ids.ana : ids.coord1, k % 5 === 4 ? 0 : 40 + k * 3, k % 3 === 0 ? ver.insertId : null, { area: k % 3 === 0 ? 'rural' : null });
  }

  const fotoTodo = async (nombre) => { const x = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(x.result.data, 'base64')); };
  const R = '#vistas-estructura';
  const NUM = (x) => Math.round(x * 10) / 10;

  /* ---------- utilidades de medida ---------- */
  // Tamaños distintos de una propiedad en un selector.
  const tam = (sel, prop = 'fontSize') => ev(`(() => [...new Set([...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.getBoundingClientRect().width > 0).map(e => getComputedStyle(e)[${JSON.stringify(prop)}]))])()`);
  const todos = async (sel, esperado, prop) => { const t = await tam(sel, prop); return t.length > 0 && t.every((x) => x === esperado); };
  const menorLetra = (sel) => ev(`(() => { let min = 999, quien = ''; document.querySelectorAll(${JSON.stringify(sel)}).forEach(root => { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.textContent.trim()) continue; const e = n.parentElement; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || e.getBoundingClientRect().width === 0) continue; const fs = parseFloat(cs.fontSize); if (fs < min) { min = fs; quien = e.className + ' «' + n.textContent.trim().slice(0, 30) + '»'; } } }); return { min, quien }; })()`);
  // Botones: tamaño de letra, alto y, en cada fila de botones, que todos midan lo mismo.
  const botones = (sel) => ev(`(() => { const l = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.getBoundingClientRect().width > 0); return { n: l.length, mal: l.filter(e => parseFloat(getComputedStyle(e).fontSize) !== 13.5 || Math.abs(e.getBoundingClientRect().height - 34) > 0.6).map(e => e.className + ' ' + getComputedStyle(e).fontSize + ' ' + NUM_(e.getBoundingClientRect().height)).slice(0, 4) }; function NUM_(x){return Math.round(x*10)/10;} })()`);
  // Dentro de un mismo contenedor de botones (o de la misma fila visual) todos del mismo alto.
  const mismoAlto = (contenedores) => ev(`(() => { const mal = []; document.querySelectorAll(${JSON.stringify(contenedores)}).forEach(c => { const hs = [...c.querySelectorAll('button, a.btn-wa-fila')].filter(b => b.getBoundingClientRect().width > 0).map(b => Math.round(b.getBoundingClientRect().height * 10) / 10); if (hs.length && Math.max(...hs) - Math.min(...hs) > 0.6) mal.push(c.className + ' ' + hs.join('/')); }); return mal.slice(0, 4); })()`);
  const sinSalirse = (sel) => ev(`(() => [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.getBoundingClientRect().width > 0 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'hidden').map(e => e.className + ' ' + e.scrollWidth + '>' + e.clientWidth).slice(0, 4))()`);
  const sinDesbordeCaja = (raiz) => ev(`(() => { const c = document.querySelector(${JSON.stringify(raiz)}).getBoundingClientRect(); return [...document.querySelectorAll(${JSON.stringify(raiz)} + ' *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && !e.closest('.correo-p, .nombre-p, .migaja, .jefe-nombre') && (r.right > c.right + 1 || r.left < c.left - 1); }).map(e => e.className).slice(0, 4); })()`);
  const sinMontarse = (sel, hijos = ':scope > *') => ev(`(() => { const mal = []; document.querySelectorAll(${JSON.stringify(sel)}).forEach(f => { const h = [...f.querySelectorAll(${JSON.stringify(hijos)})].filter(x => x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().height > 0 && getComputedStyle(x).position !== 'absolute').map(x => ({ r: x.getBoundingClientRect(), c: x.className })); for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) { const a = h[i].r, b = h[j].r; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) mal.push(f.className + ':' + h[i].c + '×' + h[j].c); } }); return mal.slice(0, 4); })()`);
  // Textos montados: el contenido de un elemento no debe sobresalir de su caja (clamp con «…» es válido: overflow hidden).
  const textoCortadoSinElipsis = (sel) => ev(`(() => [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => { if (e.getBoundingClientRect().width === 0) return false; const cs = getComputedStyle(e); if (cs.overflow === 'hidden' || cs.overflowX === 'hidden') return e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && !(cs.webkitLineClamp && cs.webkitLineClamp !== 'none'); return false; }).map(e => e.className).slice(0, 4))()`);

  /** Medidas de un conjunto de elementos hermanos por persona: para cada selector, la lista de [top relativo a su contenedor, left relativo, ancho, alto]. */
  const medidas = (contenedor, partes) => ev(`(() => { const sels = ${JSON.stringify(partes)}; return [...document.querySelectorAll(${JSON.stringify(contenedor)})].map(c => { const cr = c.getBoundingClientRect(); const o = { _top: Math.round(cr.top), _alto: cr.height, _ancho: cr.width, _left: cr.left }; for (const k of Object.keys(sels)) { const e = c.querySelector(sels[k]); if (!e) { o[k] = null; continue; } const r = e.getBoundingClientRect(); o[k] = { t: r.top - cr.top, l: r.left - cr.left, r: r.right - cr.left, w: r.width, h: r.height, b: r.bottom - cr.top, fb: cr.bottom - r.bottom }; } return o; }); })()`);
  const rango = (lista, k, campo) => { const v = lista.map((x) => x[k] && x[k][campo]).filter((x) => x != null); return v.length ? Math.max(...v) - Math.min(...v) : 0; };
  const alineados = (lista, ks, campo, tol = 1) => ks.map((k) => [k, NUM(rango(lista, k, campo))]).filter(([, d]) => d > tol);

  async function comprobar(etq, correo, w) {
    console.log(`\n[ORDEN 114 · ${etq} · ${w} px]`);
    await ancho(w, 1500); await limpiar();
    ok(await entrar(correo) === 200, `sesión de ${etq}`);
    ok(await abrirEstructura(), 'la pantalla carga');
    const esAdmin = etq === 'administrador';
    const baseFoto = esAdmin && w === 1440;

    for (const v of ['lista', 'tarjetas', 'rol', 'ranking', 'explorador', 'pendientes']) {
      await elegir(v);
      const raiz = v === 'lista' ? '#tbody-estructura' : R;
      const S = raiz;
      console.log(`  -- ${v}`);

      /* ===== 1. TAMAÑOS ===== */
      const nomSel = { lista: '#tbody-estructura .nombre-p', tarjetas: '.ev-tarjeta .nombre-p', rol: '.ev-mini .nombre-p', ranking: '.ev-pod .nombre-p, .ev-fila-ranking .nombre-p', explorador: '#ev-ficha .ev-equipo .nombre-p', pendientes: '.ev-pend-lista .nombre-p' }[v];
      ok(await todos(nomSel, '17px') && await todos(nomSel, '700', 'fontWeight'), `${v}: nombre 17 px, peso 700`, await tam(nomSel));
      ok(await todos(`${S} .id-registro`, '13px'), `${v}: número de orden 13 px`, await tam(`${S} .id-registro`));
      const gris = await ev(`(() => { const e = document.querySelector(${JSON.stringify(S + ' .id-registro')}); return e ? getComputedStyle(e).color : ''; })()`);
      ok(/107, 116, 130/.test(gris), `${v}: número de orden en gris`, gris);
      const sec = `${S} .migaja, ${S} .jefe-nombre, ${S} .jefe-cabeza, ${S} .jefe-nadie, ${S} .correo-p, ${S} .avance-cifra .meta, ${S} .ev-equipo-linea, ${S} .ev-sub, ${S} .ev-nodo-nombre, ${S} .ev-dato`;
      ok(await todos(sec, '14.5px'), `${v}: secundarios (territorio, Le reporta a, correo·sexo, «X de Y», equipo) 14,5 px`, await tam(sec));
      const chicos = `${S} .chip-p, ${S} .badge-p, ${S} .avance-pie, ${S} .aut-pill, ${S} .jefe-rotulo, ${S} .aviso-falta, ${S} .ev-cifras3 span, ${S} .ev-ind span, ${S} .ev-etq, ${S} .ev-contador, ${S} .avance-cifra .de, ${S} .mas-territorios`;
      ok(await todos(chicos, '12.5px'), `${v}: leyendas, etiquetas y chips 12,5 px`, await tam(chicos));
      ok(await todos(`${S} .chip-p, ${S} .badge-p, ${S} .aut-pill`, '24px', 'height'), `${v}: chips con alto fijo de 24 px`, await tam(`${S} .chip-p, ${S} .badge-p, ${S} .aut-pill`, 'height'));
      const bot = await botones(`${S} .btn-neutro, ${S} .btn-wa-fila, ${S} .ev-btn, ${S} .ev-btn-mini, ${S} .ev-agregar, ${S} .btn-principal-fichas, ${S} .ev-fichas-filtro button, ${S} .ev-ver-todos`);
      ok(bot.n > 0 && bot.mal.length === 0, `${v}: ${bot.n} botones (y píldora de WhatsApp) a 13,5 px y 34 px de alto`, bot);
      ok(!(await tam(`${S} .btn-neutro`, 'paddingLeft')).length || await todos(`${S} .btn-neutro`, '14px', 'paddingLeft'), `${v}: botones con 14 px de relleno horizontal`, await tam(`${S} .btn-neutro`, 'paddingLeft'));
      ok((await mismoAlto(`${S} .ev-acciones, ${S} .ev-mini-acciones, ${S} .ev-pd-acciones, ${S} .ev-rk-acc, ${S} .acciones-p, ${S} .ev-contacto, ${S} .ev-ficha-botones, ${S} .ev-fichas-filtro`)).length === 0, `${v}: ningún botón de distinto alto en una misma fila`, await mismoAlto(`${S} .ev-acciones, ${S} .ev-mini-acciones, ${S} .ev-pd-acciones, ${S} .ev-rk-acc, ${S} .acciones-p, ${S} .ev-contacto, ${S} .ev-ficha-botones`));
      const lh = await ev(`(() => ['.nombre-p', '.migaja', '.correo-p'].map(s => { const e = document.querySelector(${JSON.stringify(S)} + ' ' + s); if (!e) return true; const cs = getComputedStyle(e); return Math.abs(parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) - 1.35) < 0.02; }).every(Boolean))()`);
      ok(lh, `${v}: interlineado 1,35`);
      const m = await menorLetra(S);
      ok(m.min >= 12.5, `${v}: ningún texto por debajo de 12,5 px (el menor: ${m.min} px)`, m);
      if (v === 'lista') ok(await todos('#card-estructura .leyenda-fichas', '12.5px'), 'lista: leyenda 12,5 px');

      /* ===== 3. SIN DESBORDES NI TEXTOS MONTADOS ===== */
      ok(await sinDesborde(), `${v}: sin desborde horizontal de la página a ${w} px`);
      if (v !== 'lista') { const d = await sinDesbordeCaja(R); ok(d.length === 0, `${v}: nada se sale de su caja`, d); }
      const filas = { lista: '#tbody-estructura .ficha-cuerpo', tarjetas: '.ev-tarjeta', rol: '.ev-mini-texto', ranking: '.ev-fila-ranking, .ev-pod', explorador: '.ev-ficha-cab, .ev-equipo li, .ev-dato', pendientes: '.ev-pd' }[v];
      const hijosMontaje = v === 'lista' ? ':scope > .quien > *, :scope > .territorio-p, :scope > .jefe-p, :scope > .avance-p > *, :scope > .lateral-p > *, :scope > .quien > div > *' : ':scope > *';
      const mon = await sinMontarse(filas, hijosMontaje);
      ok(mon.length === 0, `${v}: nada se monta ni queda un texto sobre otro`, mon);
      const cor = await textoCortadoSinElipsis(`${S} .correo-p, ${S} .migaja, ${S} .nombre-p, ${S} .jefe-nombre`);
      ok(cor.length === 0, `${v}: lo que se corta lleva «…»`, cor);
      const mal = await ev(`(() => [...document.querySelectorAll(${JSON.stringify(S + ' .correo-p, ' + S + ' .migaja, ' + S + ' .nombre-p')})].filter(e => e.getBoundingClientRect().width > 0 && !e.getAttribute('title')).length)()`);
      ok(mal === 0, `${v}: correos, territorios y nombres llevan title con el texto completo`, mal);
      const sal = await sinSalirse(`${S} .ev-tarjeta, ${S} .ev-pod, ${S} .ev-mini, ${S} .ev-fila-ranking, ${S} .ev-pd, ${S} .ev-ficha, ${S} .ficha-cuerpo`);
      ok(sal.length === 0, `${v}: ninguna ficha tiene contenido que se corte`, sal);

      /* ===== 2. ALINEACIÓN MEDIDA ===== */
      if (v === 'tarjetas') {
        const zonas = { nombre: '.linea-nombre', correo: '.correo-p', chips: '.chips-p', terr: '.ev-bloque-territorio', jefe: '.jefe-p', franja: '.ev-cifras3', pie: '.ev-z-pie', contacto: '.ev-contacto', estado: '.ev-estado', botones: '.ev-acciones', anillo: '.ev-anillo-av' };
        const tj = await medidas('.ev-tarjeta', zonas);
        const filasTop = {}; tj.forEach((x) => { (filasTop[x._top] = filasTop[x._top] || []).push(x); });
        let malas = [];
        Object.entries(filasTop).forEach(([top, g]) => {
          const alto = Math.max(...g.map((x) => x._alto)) - Math.min(...g.map((x) => x._alto));
          if (alto > 1) malas.push(`fila ${top}: alturas distintas (${NUM(alto)} px)`);
          ['nombre', 'chips', 'terr', 'franja', 'botones', 'correo', 'jefe', 'contacto', 'estado'].forEach((k) => { const d = rango(g, k, 't'); if (d > 1) malas.push(`fila ${top}: ${k} varía ${NUM(d)} px`); });
        });
        ok(Object.keys(filasTop).length >= 2 && malas.length === 0, `Tarjetas: en cada fila de tarjetas (${Object.keys(filasTop).length} filas, ${tj.length} tarjetas) todas miden lo mismo y nombre, chips, territorio, franja de cifras y botones coinciden (±1 px)`, malas.slice(0, 4));
        ok(alineados(tj, Object.keys(zonas), 't').length === 0 && rango(tj.map((x) => ({ a: { t: x._alto } })), 'a', 't') <= 1, `Tarjetas: lo mismo entre TODAS las tarjetas (mismas zonas, misma altura de ${NUM(tj[0]._alto)} px)`, alineados(tj, Object.keys(zonas), 't'));
        const cols = await ev("getComputedStyle(document.querySelector('.ev-grid-tarjetas')).gridTemplateColumns.split(' ').length");
        ok(cols >= 2, `Tarjetas: ${cols} columnas a ${w} px`);
        ok(await todos('.ev-cifras3 b', '20px'), 'Tarjetas: cifras de la franja 20 px', await tam('.ev-cifras3 b'));
        ok(await ev("[...document.querySelectorAll('.ev-tarjeta .nombre-p')].every(e => e.getBoundingClientRect().height <= 2 * 17 * 1.35 + 1)"), 'Tarjetas: nombres hasta 2 líneas');
        ok(await ev("[...document.querySelectorAll('.ev-tarjeta .correo-p')].every(e => e.getBoundingClientRect().height <= 20)"), 'Tarjetas: correo·sexo en 1 línea');
        // todos los botones de una tarjeta en la misma fila (un solo `top`) o «Ver equipo» solo arriba, igual en todas
        const disp = await ev(`(() => [...new Set([...document.querySelectorAll('.ev-tarjeta .ev-acciones')].map(a => [...a.children].map(b => Math.round(b.getBoundingClientRect().top - a.getBoundingClientRect().top)).join(',')))])()`);
        ok(disp.length === 1, 'Tarjetas: la fila de botones se reparte igual en todas', disp);
      }
      if (v === 'rol') {
        const cols = await ev(`[...document.querySelectorAll('.ev-columna-cuerpo')].map(c => [...c.querySelectorAll('.ev-mini')].map(m => { const b = m.querySelector('.ev-mini-acciones button'); const r = m.getBoundingClientRect(); const a = m.querySelector('.ev-av').getBoundingClientRect(); const t = m.querySelector('.ev-mini-texto').getBoundingClientRect(); return { w: r.width, l: r.left, bl: b ? b.getBoundingClientRect().left : null, av: a.left, avw: a.width, tl: t.left, top: r.top, bottom: r.bottom }; }))`);
        let malas = [];
        cols.forEach((c, i) => {
          const rg = (k) => c.length ? Math.max(...c.map((x) => x[k])) - Math.min(...c.map((x) => x[k])) : 0;
          if (rg('w') > 1) malas.push(`col ${i}: anchos distintos`); if (rg('bl') > 1) malas.push(`col ${i}: botones a distinto left`); if (rg('tl') > 1) malas.push(`col ${i}: texto a distinto left`); if (rg('av') > 1) malas.push(`col ${i}: avatar a distinto left`);
          for (let k = 1; k < c.length; k++) { const g = c[k].top - c[k - 1].bottom; if (Math.abs(g - 12) > 1) malas.push(`col ${i}: separación ${NUM(g)} px entre fichas ${k}`); }
        });
        ok(cols.some((c) => c.length > 1) && malas.length === 0, 'Por rol: tarjetas de una columna con el mismo ancho, avatar, texto y botones al mismo left, y 12 px entre ellas', malas.slice(0, 4));
        ok((await tam('.ev-mini > .ev-av', 'width')).join() === '40px', 'Por rol: avatar de 40 px');
        ok(await ev("[...document.querySelectorAll('.ev-mini')].every(m => m.querySelector('.ev-av').getBoundingClientRect().top - m.getBoundingClientRect().top < 20)"), 'Por rol: avatar alineado arriba');
        // Orden de zonas igual en todas las fichas
        const orden = await ev(`(() => [...new Set([...document.querySelectorAll('.ev-mini-texto')].map(t => [...t.children].map(c => c.className.split(' ')[0] || c.tagName).filter(x => !/^(ev-equipo-linea|ev-sin-meta|ev-sub)$/.test(x)).join('>')))])()`);
        ok(orden.length <= 2, 'Por rol: las zonas van en el mismo orden en todas las fichas', orden);
        const pct = await ev(`(() => [...document.querySelectorAll('.ev-mini .ev-pct-txt')].map(e => ({ c: getComputedStyle(e).color, f: getComputedStyle(e).fontSize })))()`);
        ok(pct.length > 0 && pct.every((x) => x.c === 'rgb(8, 66, 152)' && x.f === '18px'), 'Por rol: % en #084298 a 18 px (ya no en rojo grande)', pct.slice(0, 3));
        const puntos = await ev(`(() => [...document.querySelectorAll('.ev-mini')].map(m => { const pc = m.querySelector('.ev-pct-txt'); const bajo = pc && parseFloat(pc.textContent) < 25; const pt = m.querySelector('.ev-punto-rojo'); return pc ? (!!pt === !!bajo) && (!pt || (pt.getBoundingClientRect().width === 8 && getComputedStyle(pt).backgroundColor === 'rgb(229, 72, 77)')) : true; }).every(Boolean))()`);
        ok(puntos, 'Por rol: punto rojo de 8 px solo para quien va bajo 25 %');
        ok(!(await ev("[...document.querySelectorAll('.ev-mini .ev-pct-txt')].some(e => getComputedStyle(e).color === 'rgb(198, 40, 40)')")), 'Por rol: ningún % en rojo');
        ok(await todos('.ev-columna-cab', '16px'), 'Por rol: encabezados de columna 16 px', await tam('.ev-columna-cab'));
        ok(!/Testig/.test(await ev("document.getElementById('vistas-estructura').innerText")), 'Por rol: sin testigos');
      }
      if (v === 'ranking') {
        const zp = { nombre: '.linea-nombre', correo: '.correo-p', chips: '.chips-p', terr: '.ev-bloque-territorio', jefe: '.jefe-p', pct: '.ev-pod-pct', avance: '.avance-p', contacto: '.ev-contacto', estado: '.ev-estado', botones: '.ev-acciones' };
        const pod = await medidas('.ev-pod', zp);
        const dp = alineados(pod, Object.keys(zp), 'fb', 1);
        ok(pod.length >= 2 && dp.length === 0, `Ranking: las ${pod.length} tarjetas del podio llevan cada renglón a la misma altura (±1 px, medido desde el borde de abajo; el 1.º solo es más alto arriba)`, dp);
        ok(pod.length < 3 || pod.find((x, i) => i === 1)._alto > pod[0]._alto, 'Ranking: el 1.º es más alto que el 2.º y el 3.º');
        const pp = await ev("[...document.querySelectorAll('.ev-pod')].map(e => [e.className.match(/ev-pod-(\\d)/)[1], getComputedStyle(e.querySelector('.ev-pod-pct')).fontSize])");
        ok(pp.length > 0 && pp.every(([k, f]) => f === (k === '1' ? '34px' : '28px')), 'Ranking: % del podio 1.º 34 px, 2.º y 3.º 28 px', pp);
        ok(await todos('.ev-pct-grande', '18px') || (await tam('.ev-pct-grande')).length === 0, 'Ranking: % de las filas 18 px', await tam('.ev-pct-grande'));
        // columnas de las filas
        const cs = { pos: '.ev-puesto', av: '.ev-av-n', quien: '.ev-rk-quien', barra: '.ev-rk-barra', cifra: '.ev-rk-cifra', pct: '.ev-pct-grande', wa: '.ev-rk-wa', acc: '.ev-rk-acc', l2: '.ev-rk-2' };
        const fl = await medidas('.ev-fila-ranking', cs);
        const dl = alineados(fl, ['pos', 'av', 'quien', 'barra', 'wa', 'acc'], 'l'); const dr = alineados(fl, ['cifra', 'pct'], 'r');
        ok(fl.length > (esAdmin ? 3 : 0) && dl.length === 0 && dr.length === 0, `Ranking: el left (y el right de las cifras) de cada columna coincide (±1 px) en las ${fl.length} filas`, dl.concat(dr));
        ok(rango(fl.map((x) => ({ q: { l: x.l2.l - x.quien.l } })), 'q', 'l') <= 1 && fl.every((x) => Math.abs(x.l2.l - x.quien.l) <= 1), 'Ranking: la segunda línea empieza en la columna del nombre');
        ok(fl.every((x) => x.l2.t >= x.quien.b - 1 || x.l2.t >= x.acc.b - 1), 'Ranking: fila de dos líneas (la 2.ª debajo de la 1.ª)');
        const anchos = alineados(fl, ['pos', 'av', 'quien', 'barra', 'wa', 'acc'], 'w');
        ok(anchos.length === 0, 'Ranking: las columnas miden lo mismo en todas las filas', anchos);
      }
      if (v === 'explorador') {
        const d = await medidas('.ev-dato', { etq: '.ev-etq', val: '.ev-val' });
        ok(d.length >= 4 && alineados(d, ['etq'], 'l').length === 0 && alineados(d, ['val'], 'l').length === 0 && d.every((x) => Math.abs(x.etq.w - 160) <= 1 || Math.abs(x.val.l - x.etq.l - 176) <= 1), 'Explorador: etiquetas de 160 px a la izquierda y valores a la derecha, alineados en todas las filas', d.slice(0, 2));
        const ind = await ev("[...document.querySelectorAll('.ev-ind')].map(e => Math.round(e.getBoundingClientRect().height * 10) / 10)");
        ok(ind.length === 4 && Math.max(...ind) - Math.min(...ind) < 0.6, 'Explorador: 4 indicadores del mismo alto', ind);
        ok(await todos('#ev-ficha .ev-ficha-id h3', '20px'), 'Explorador: título de la ficha 20 px', await tam('#ev-ficha .ev-ficha-id h3'));
        ok(await todos('.ev-nodo-nombre', '14.5px'), 'Explorador: árbol 14,5 px', await tam('.ev-nodo-nombre'));
        const eq = await medidas('#ev-ficha .ev-equipo li', { av: '.ev-av', quien: '.ev-eq-quien', est: '.ev-eq-estado', wa: '.ev-eq-wa' });
        ok(eq.length > 2 && alineados(eq, ['av', 'quien', 'est', 'wa'], 'l').length === 0, 'Explorador (Su equipo): las columnas alinean en todas las filas', alineados(eq, ['av', 'quien', 'est', 'wa'], 'l'));
        await ev("document.querySelectorAll('.ev-nodo-btn')[0].click()"); await espera(200);
      }
      if (v === 'pendientes') {
        const secs = await ev("[...document.querySelectorAll('.ev-pend')].map(s => { const r = s.getBoundingClientRect(); return { l: r.left, w: r.width, t: r.top, b: r.bottom }; })");
        ok(secs.length === 5 && secs.every((s, i) => Math.abs(s.l - secs[0].l) < 1 && Math.abs(s.w - secs[0].w) < 1 && (i === 0 || s.t >= secs[i - 1].b - 1)) && secs[0].w > 800, 'Pendientes: una sola columna (5 grupos, uno debajo del otro, a lo ancho)', secs);
        const cs = { av: '.ev-av', quien: '.ev-pend-quien', jefe: '.ev-pd-jefe', cifra: '.ev-pd-cifra', estado: '.ev-pd-estado', wa: '.ev-pd-wa', acc: '.ev-pd-acciones', l2: '.ev-pd-2' };
        const fl = await medidas('.ev-pd', cs);
        const dl = alineados(fl, ['av', 'quien', 'jefe', 'estado', 'wa'], 'l'); const dr = alineados(fl, ['cifra', 'acc'], 'r');
        ok(fl.length > 10 && dl.length === 0 && dr.length === 0, `Pendientes: el left de cada columna coincide (±1 px) en las ${fl.length} filas de todos los grupos`, dl.concat(dr));
        ok(fl.every((x) => Math.abs(x.l2.l - x.quien.l) <= 1), 'Pendientes: la segunda línea (correo·sexo·autorización) empieza en la columna del nombre');
        const g = await ev("[...document.querySelectorAll('.ev-pend')].map(s => [s.dataset.grupo, s.querySelectorAll('.ev-pend-lista li.ev-pd').length, s.querySelector('.ev-contador').textContent.trim(), (s.querySelector('.ev-ver-todos') || {}).textContent || null])");
        ok(g.every(([, n, total, btn]) => (Number(total) > 8 ? n === 8 && btn === `Ver todos (${total})` : n === Number(total) && btn === null)), 'Pendientes: grupos de más de 8 muestran 8 y «Ver todos (N)»; los demás, todos', g);
        const grande = g.find((x) => Number(x[2]) > 8);
        if (grande) {
          await ev(`document.querySelector('.ev-pend[data-grupo="${grande[0]}"] .ev-ver-todos').click()`); await espera(300);
          ok(await ev(`document.querySelectorAll('.ev-pend[data-grupo="${grande[0]}"] .ev-pend-lista li.ev-pd').length === ${grande[2]}`), `Pendientes: «Ver todos (${grande[2]})» abre el grupo completo`);
          await ev(`document.querySelector('.ev-pend[data-grupo="${grande[0]}"] .ev-ver-todos').click()`); await espera(300);
        }
        ok(await todos('.ev-pend h4', '16px'), 'Pendientes: encabezados de grupo 16 px', await tam('.ev-pend h4'));
      }
      if (v === 'lista') {
        const cs = { av: ':scope > .quien > .avatar-p', nombre: ':scope > .quien > div > .linea-nombre', correo: ':scope > .quien > div > .correo-p', terr: ':scope > .territorio-p', jefe: ':scope > .jefe-p', cifra: ':scope > .avance-p > .avance-cifra', barra: ':scope > .avance-p > .medidor-p', estado: ':scope > .lateral-p > .badge-p', acc: ':scope > .lateral-p > .acciones-p' };
        const todosL = await ev(`(() => { const sels = ${JSON.stringify(cs)}; return [...document.querySelectorAll('#tbody-estructura .ficha-cuerpo')].filter(c => !c.closest('.hijos-p')).map(c => { const cr = c.getBoundingClientRect(); const o = { alto: cr.height }; for (const k of Object.keys(sels)) { const e = c.querySelector(sels[k]); if (!e) { o[k] = null; continue; } const r = e.getBoundingClientRect(); o[k] = { t: r.top - cr.top, l: r.left - cr.left, r: r.right - cr.left, w: r.width }; } return o; }); })()`);
        const dl = alineados(todosL, ['av', 'nombre', 'correo', 'terr', 'jefe', 'barra', 'estado', 'acc'], 'l'); const dr = alineados(todosL, ['cifra'], 'r');
        ok(todosL.length >= 1 && dl.length === 0 && dr.length === 0, `Lista: las columnas alinean (±1 px) en las ${todosL.length} fichas principales`, dl.concat(dr));
        const dr2 = ev("(() => { const f = document.querySelector('#tbody-estructura .ficha-cuerpo'); const e = f.querySelector('.acciones-p').getBoundingClientRect(); return f.getBoundingClientRect().right - e.right; })()");
        const hueco = await dr2;
        ok(hueco < 40, `Lista: sin hueco a la derecha (los botones terminan a ${NUM(hueco)} px del borde de la ficha)`, hueco);
        const dos = await ev("[...document.querySelectorAll('#tbody-estructura .ficha-cuerpo')].every(c => { const n = c.querySelector(':scope > .quien > div > .linea-nombre').getBoundingClientRect().top, e = c.querySelector(':scope > .quien > div > .correo-p').getBoundingClientRect().top; return e > n; })");
        ok(dos, 'Lista: ficha de 2 renglones (el correo·sexo queda debajo del nombre)');
        const posBarra = await ev("[...document.querySelectorAll('#tbody-estructura .ficha-cuerpo')].every(c => { const b = c.querySelector(':scope > .avance-p > .medidor-p').getBoundingClientRect(), n = c.querySelector(':scope > .quien > div > .linea-nombre').getBoundingClientRect(); return Math.abs(b.top - n.top) < 30; })");
        ok(posBarra, 'Lista: la barra de avance va en el primer renglón');
        const prim = await ev("(() => { const c = document.querySelector('#tbody-estructura .ficha-cuerpo'); return c.getBoundingClientRect().height; })()");
        console.log(`  (altura de la primera ficha: ${NUM(prim)} px)`);
      }
      if (baseFoto) {
        await ev(`window.scrollTo(0, document.querySelector(${JSON.stringify(v === 'lista' ? '#tbody-estructura' : R)}).getBoundingClientRect().top + window.scrollY - 90)`); await espera(250);
        await fotoTodo(`orden114-${v}-1440`); await ev('window.scrollTo(0, 0)');
      }
    }
    ok(p.avisos.length === 0, `sin errores de consola (${etq} · ${w})`, p.avisos);
  }

  await comprobar('administrador', CORREO_ADMIN, 1280);
  await comprobar('administrador', CORREO_ADMIN, 1440);
  await comprobar('administrador', CORREO_ADMIN, 1600);
  if (!process.env.SOLO_ADMIN) {
    await comprobar('coordinadora', 'marta@ejemplo.co', 1440);
    await comprobar('líder', 'ana114@ejemplo.co', 1440);
  }

  nav.cerrar();
  servidor.close();
  await pool.end();
  console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
