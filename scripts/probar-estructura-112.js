#!/usr/bin/env node
// scripts/probar-estructura-112.js — ORDEN 112: las cinco vistas nuevas de «Estructura territorial» (Tarjetas, Por rol, Ranking, Explorador y
// Pendientes) muestran LA MISMA INFORMACIÓN QUE LA LISTA, con letra más grande en las seis.
//   Con administrador, coordinadora y líder, a 1280 y 1600 px, para cinco personas (coordinador con comuna, líder con barrio y +N territorios,
//   sublíder, coordinador de organizaciones y alguien sin territorio y sin autorización) cada dato a–j de la Lista sale IGUAL en las cinco vistas
//   (mismo texto, mismo href de WhatsApp, misma Σ, Eliminar solo donde la Lista lo muestra); tamaños con getComputedStyle (nombre 19, secundarios 16,
//   mínimo 14, botones 15 y ≥ 38 px); sin desbordes; cero errores de consola.
//
// USO (base desechable con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada112 [SALIDA=/ruta] node scripts/probar-estructura-112.js
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
const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden112');
fs.mkdirSync(SALIDA, { recursive: true });
const CLAVE = 'Clave-Prueba-112x';
const CORREO_ADMIN = 'admin112@ejemplo.co';

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
     VALUES ('Admin Ciento Doce', '1099112001', '1099112001', ?, '3001050000', ?, ?, 1, 0, 1)`, [CORREO_ADMIN, hash, await rol('admin')]);
  await q('UPDATE usuarios SET password_hash = ? WHERE id IN (?, ?)', [hash, ids.coord1, ids.ana]);
  await q("UPDATE usuarios SET email = 'ana112@ejemplo.co' WHERE id = ?", [ids.ana]);
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

  /** Lo que la Lista dice de una persona, leído de un contenedor. Una sola función para la Lista y para las cinco vistas. */
  const LECTOR = `(el, quitarEquipo) => {
    const c = el.cloneNode(true);
    if (quitarEquipo) c.querySelectorAll('.ev-equipo').forEach(x => x.remove());
    const t = (s) => { const e = c.querySelector(s); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; };
    const a = c.querySelector('.btn-wa-fila'), ms = c.querySelector('.mas-territorios'), sg = c.querySelector('.sigma-p'), au = c.querySelector('.aut-pill'), es = c.querySelector('.badge-p:not(.badge-excluido)');
    const cif = c.querySelector('.avance-cifra');
    const bot = [...c.querySelectorAll('button')].filter(b => /^(Editar|Eliminar|Quitar de mi equipo)$/.test(b.textContent.trim()));
    return {
      numero: t('.id-registro'), nombre: t('.nombre-p'), correo: t('.correo-p'),
      wa: a ? { href: a.getAttribute('href'), onclick: a.getAttribute('onclick'), texto: a.textContent.trim() } : null,
      aut: au ? au.textContent.trim() : null, autClase: au ? au.className : null,
      chips: [...c.querySelectorAll('.chip-p, .geo-chip')].map(e => e.textContent.trim()), chipsClase: [...c.querySelectorAll('.chip-p')].map(e => e.className),
      territorio: t('.migaja'), mas: ms ? ms.getAttribute('title') + '|' + ms.textContent.trim() : null,
      sinTerritorio: !!c.querySelector('.sin-territorio'), aviso: t('.aviso-falta'), jefe: t('.jefe-p'),
      cifra: cif ? [...cif.children].map(x => x.textContent.trim()).join(' ') : null, pie: t('.avance-pie'), sigma: sg ? sg.getAttribute('title') : null,
      estado: es ? es.textContent.trim() : null, estadoClase: es ? es.className : null,
      botones: bot.map(b => b.textContent.trim()), clicks: bot.map(b => b.getAttribute('onclick')),
    };
  }`;
  const leerTodos = (sel, quitarEquipo) => ev(`(() => { const f = ${LECTOR}; return [...document.querySelectorAll(${JSON.stringify(sel)})].map(el => f(el, ${!!quitarEquipo})); })()`);
  const leerLista = async () => {
    const filas = await leerTodos('#tbody-estructura .ficha-p > .ficha-cuerpo');
    const m = {}; filas.forEach((x) => { m[x.nombre] = x; }); return m;
  };
  const CAMPOS = ['numero', 'nombre', 'correo', 'wa', 'aut', 'autClase', 'chips', 'chipsClase', 'territorio', 'mas', 'sinTerritorio', 'aviso', 'jefe', 'cifra', 'pie', 'sigma', 'estado', 'estadoClase', 'botones', 'clicks'];
  const diferencias = (ref, x, campos) => campos.filter((k) => JSON.stringify(ref[k]) !== JSON.stringify(x[k])).map((k) => `${k}: lista=${JSON.stringify(ref[k])} vista=${JSON.stringify(x[k])}`);
  const comparar = (vista, filas, lista, campos = CAMPOS, minimo = 1) => {
    const malas = filas.map((x) => ({ n: x.nombre, d: lista[x.nombre] ? diferencias(lista[x.nombre], x, campos) : ['no está en la Lista'] })).filter((x) => x.d.length);
    ok(filas.length >= minimo && malas.length === 0, `${vista}: ${filas.length} persona(s) con los mismos datos que la Lista (${campos.length} campos: número, correo·sexo, WhatsApp, autorización, chips, territorio, +N, Le reporta a, X de Y, leyenda, Σ, estado, botones)`, malas.slice(0, 3));
  };

  /** Todos los textos visibles de un contenedor y su tamaño: el menor debe ser ≥ 14 px. */
  const menorLetra = (sel) => ev(`(() => { let min = 999, quien = ''; document.querySelectorAll(${JSON.stringify(sel)}).forEach(root => { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.textContent.trim()) continue; const e = n.parentElement; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || e.getBoundingClientRect().width === 0) continue; const fs = parseFloat(cs.fontSize); if (fs < min) { min = fs; quien = e.className + ' «' + n.textContent.trim().slice(0, 30) + '»'; } } }); return { min, quien }; })()`);
  const tam = (sel, prop = 'fontSize') => ev(`(() => [...new Set([...document.querySelectorAll(${JSON.stringify(sel)})].map(e => getComputedStyle(e)[${JSON.stringify(prop)}]))])()`);
  const todos = async (sel, esperado, prop) => { const t = await tam(sel, prop); return t.length > 0 && t.every((x) => x === esperado); };
  const botonesOk = (sel) => ev(`(() => { const l = [...document.querySelectorAll(${JSON.stringify(sel)})]; return { n: l.length, mal: l.filter(e => parseFloat(getComputedStyle(e).fontSize) !== 15 || e.getBoundingClientRect().height < 37.5).map(e => e.className + ' ' + getComputedStyle(e).fontSize + ' ' + Math.round(e.getBoundingClientRect().height)).slice(0, 3) }; })()`);
  const sinSalirse = (sel) => ev(`(() => [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className + ' ' + e.scrollWidth + '>' + e.clientWidth).slice(0, 3))()`);
  const cajaCompleta = () => ev(`(() => { const c = document.getElementById('vistas-estructura').getBoundingClientRect(); return [...document.querySelectorAll('#vistas-estructura *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > c.right + 1 || r.left < c.left - 1); }).length === 0; })()`);
  const sinMontarse = (sel) => ev(`(() => { const mal = []; document.querySelectorAll(${JSON.stringify(sel)}).forEach(f => { const h = [...f.children].filter(x => x.getBoundingClientRect().width > 0).map(x => x.getBoundingClientRect()); for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) { const a = h[i], b = h[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) mal.push(f.className + ':' + i + 'x' + j); } }); return mal.slice(0, 3); })()`);

  /** Las vistas por persona: un contenedor por persona (el Explorador se recorre nodo a nodo). */
  const SELECTORES = { tarjetas: '.ev-tarjeta', rol: '.ev-mini', podio: '.ev-pod', ranking: '.ev-fila-ranking', pendientes: '.ev-pend-lista li[data-uid]' };

  async function comprobarRolYAncho(etq, correo, w) {
    console.log(`\n[ORDEN 112 · ${etq} · ${w} px]`);
    await ancho(w, 1500); await limpiar();
    ok(await entrar(correo) === 200, `sesión de ${etq}`);
    ok(await abrirEstructura(), 'la pantalla carga');
    const lista = await leerLista();
    const nombres = Object.keys(lista);
    ok(nombres.length > 0, `la Lista trae ${nombres.length} personas`);
    const esAdmin = etq === 'administrador';

    // -- Los cinco casos, en la Lista (la referencia) --
    if (esAdmin) {
      const marta = lista['Marta Coordinadora Ejemplo'], ana = lista['Ana Líder Alfa'], sara = lista['Sara Sublíder Alfa'], olga = lista['Olga Organizaciones Ejemplo'], carla = lista['Carla Líder Gamma'];
      ok(marta && /Comuna 04/.test(marta.territorio) && marta.chips.includes('Coordinador'), 'caso 1 (coordinadora con comuna): «Comuna 04…»', marta && marta.territorio);
      ok(ana && /Barrio Los Ejemplos/.test(ana.territorio) && /^.*\|\+2$/.test(ana.mas) && /Barrio La Muestra/.test(ana.mas) && /Vereda La Palma/.test(ana.mas), 'caso 2 (líder con barrio y +2 territorios, con title)', ana && ana.mas);
      ok(sara && sara.chips.includes('Sublíder'), 'caso 3 (sublíder)', sara && sara.chips);
      ok(olga && /Organización/.test(olga.territorio) && /Gremio de Ejemplo/.test(olga.territorio) && olga.chips.includes('Coord. organizaciones'), 'caso 4 (coordinadora de organizaciones: la organización)', olga && olga.territorio);
      ok(carla && carla.sinTerritorio && carla.territorio === 'Sin territorio asignado' && carla.aut === 'Sin autorización' && carla.wa === null, 'caso 5 (sin territorio, sin autorización y sin celular)', carla);
      ok(Object.values(lista).every((x) => x.correo && x.estado && x.cifra && x.numero), 'la Lista trae número, correo, estado y «X de Y» en todas');
    }

    // -- Cada vista, dato por dato contra la Lista --
    await elegir('tarjetas');
    const tj = await leerTodos(SELECTORES.tarjetas);
    // Tarjetas muestra «X de Y» como franja Registros · Meta; se reconstruye con el mismo formato.
    const franjas = await ev("[...document.querySelectorAll('.ev-tarjeta')].map(t => [...t.querySelectorAll('.ev-cifras3 b')].map(b => b.textContent.trim()))");
    tj.forEach((x, k) => { x.cifra = `${franjas[k][0]} de ${franjas[k][1] === '—' ? '0' : franjas[k][1]}`; });
    comparar('Tarjetas', tj, lista, CAMPOS, nombres.length);
    ok(tj.length === nombres.length, `Tarjetas: una por persona (${tj.length} de ${nombres.length})`);
    await elegir('rol');
    comparar('Por rol', await leerTodos(SELECTORES.rol), lista, CAMPOS, 1);
    await elegir('ranking');
    comparar('Ranking (podio)', await leerTodos(SELECTORES.podio), lista, CAMPOS, 1);
    const filasRk = await leerTodos(SELECTORES.ranking);
    comparar('Ranking (filas)', filasRk, lista, CAMPOS, 0);
    await elegir('pendientes');
    comparar('Pendientes', await leerTodos(SELECTORES.pendientes), lista, CAMPOS, 1);
    await elegir('explorador');
    const nodos = await ev("document.querySelectorAll('.ev-nodo-btn').length");
    let fichas = [], equipos = [];
    for (let k = 0; k < nodos; k++) {
      await ev(`document.querySelectorAll('.ev-nodo-btn')[${k}].click()`); await espera(150);
      fichas = fichas.concat(await ev(`(() => { const f = ${LECTOR}; return [f(document.getElementById('ev-ficha'), true)]; })()`));
      // «Su equipo»: nombre, rol · territorio, X de Y, WhatsApp y Activo, contra la Lista.
      equipos = equipos.concat(await ev(`(() => [...document.querySelectorAll('#ev-ficha .ev-equipo li')].map(li => { const a = li.querySelector('.btn-wa-fila'), cif = li.querySelector('.avance-cifra'), es = li.querySelector('.badge-p'); return { nombre: li.querySelector('.nombre-p').textContent.trim(), numero: li.querySelector('.id-registro').textContent.trim(), rolLugar: li.querySelector('.ev-sub').textContent.replace(/\\s+/g, ' ').trim(), cifra: [...cif.children].map(x => x.textContent.trim()).join(' '), wa: a ? { href: a.getAttribute('href'), onclick: a.getAttribute('onclick'), texto: a.textContent.trim() } : null, estado: es.textContent.trim(), estadoClase: es.className }; }))()`));
    }
    comparar('Explorador (ficha)', fichas, lista, CAMPOS.filter((k) => k !== 'chipsClase' || true), nodos);
    ok(equipos.length > 0, `Explorador: «Su equipo» trae ${equipos.length} filas`);
    const malosEq = equipos.filter((e) => { const r = lista[e.nombre]; return !r || r.numero !== e.numero || r.cifra !== e.cifra || JSON.stringify(r.wa) !== JSON.stringify(e.wa) || r.estado !== e.estado || r.estadoClase !== e.estadoClase || !new RegExp('^' + (r.chips[0] || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(e.rolLugar); });
    ok(malosEq.length === 0, 'Explorador (Su equipo): nombre, rol · territorio, X de Y, WhatsApp y Activo iguales a la Lista', malosEq.slice(0, 3));
    ok(await ev("[...document.querySelectorAll('#ev-ficha .ev-equipo li')].every(li => /\\S/.test(li.querySelector('.ev-sub').textContent))"), 'Explorador (Su equipo): cada fila trae rol y territorio');

    if (esAdmin && w === 1280) {
      await ev("[...document.querySelectorAll('.ev-nodo-btn')].find(b => b.textContent.includes('Marta')).click()"); await espera(300);
      await ev("window.scrollTo(0, document.getElementById('vistas-estructura').getBoundingClientRect().top + window.scrollY - 70)"); await espera(250);
      await foto('orden112-explorador-equipo-1280'); await ev('window.scrollTo(0, 0)');
    }
    // Eliminar solo donde la Lista lo muestra
    const conEliminar = Object.values(lista).filter((x) => x.botones.includes('Eliminar')).length;
    ok(esAdmin ? conEliminar === nombres.length : conEliminar === 0, `Eliminar: la Lista lo muestra en ${conEliminar} de ${nombres.length} (${esAdmin ? 'administrador: todas' : 'otro rol: ninguna'}) y las vistas coinciden (comprobado dato por dato arriba)`);

    // -- Tamaños de letra --
    await elegir('lista');
    const grande = { '#tbody-estructura .nombre-p': '19px' };
    ok(await todos('#tbody-estructura .nombre-p', '19px') && await todos('#tbody-estructura .nombre-p', '700', 'fontWeight'), 'Lista: nombre 19 px negrita', await tam('#tbody-estructura .nombre-p'));
    void grande;
    for (const v of ['tarjetas', 'rol', 'ranking', 'explorador', 'pendientes']) {
      await elegir(v);
      const R = '#vistas-estructura';
      const nomSel = { tarjetas: '.ev-tarjeta .nombre-p', rol: '.ev-mini .nombre-p', ranking: '.ev-pod .nombre-p, .ev-fila-ranking .nombre-p', explorador: '#ev-ficha .ev-ficha-cab .nombre-p, #ev-ficha .ev-equipo .nombre-p', pendientes: '.ev-pend-lista .nombre-p' }[v];
      ok(await todos(nomSel, '19px') && await todos(nomSel, '700', 'fontWeight'), `${v}: nombre 19 px negrita`, await tam(nomSel));
      const sec = `${R} .migaja, ${R} .jefe-nombre, ${R} .jefe-cabeza, ${R} .jefe-nadie, ${R} .correo-p, ${R} .avance-cifra .meta, ${R} .ev-equipo-linea, ${R} .ev-sub`;
      ok(await todos(sec, '16px'), `${v}: territorio, «Le reporta a», correo·sexo, «X de Y», equipo y «rol · territorio» a 16 px`, await tam(sec));
      const chicos = `${R} .chip-p, ${R} .badge-p, ${R} .avance-pie, ${R} .aut-pill, ${R} .jefe-rotulo, ${R} .aviso-falta, ${R} .ev-cifras3 span, ${R} .ev-ind span, ${R} .ev-contador`;
      ok(await todos(chicos, '14px'), `${v}: etiquetas, leyendas y chips a 14 px`, await tam(chicos));
      const bot = await botonesOk(`${R} .btn-neutro, ${R} .btn-wa-fila, ${R} .ev-btn, ${R} .ev-btn-mini, ${R} .ev-agregar, ${R} .btn-principal-fichas, ${R} .ev-fichas-filtro button`);
      ok(bot.n > 0 && bot.mal.length === 0, `${v}: ${bot.n} botones a 15 px y ≥ 38 px de alto`, bot);
      const m = await menorLetra(R);
      ok(m.min >= 14, `${v}: ningún texto por debajo de 14 px (el menor: ${m.min} px)`, m);
      ok(await sinDesborde(), `${v}: sin desborde horizontal de la página a ${w} px`);
      ok(await cajaCompleta(), `${v}: nada se sale de su caja`);
      const sel = { tarjetas: '.ev-tarjeta', rol: '.ev-mini, .ev-columna', ranking: '.ev-pod, .ev-fila-ranking', explorador: '#ev-ficha, .ev-equipo li, .ev-nodo-btn', pendientes: '.ev-pend, .ev-pend-lista li' }[v];
      const salen = await sinSalirse(sel);
      ok(salen.length === 0, `${v}: ninguna ficha tiene contenido que se corte`, salen);
      const montan = await sinMontarse({ tarjetas: '.ev-tarjeta', rol: '.ev-mini-texto', ranking: '.ev-rk-1', explorador: '.ev-ficha-cab, .ev-equipo li', pendientes: '.ev-pd-1' }[v]);
      ok(montan.length === 0, `${v}: nada se monta`, montan);
      if (v === 'tarjetas') ok(await ev("getComputedStyle(document.querySelector('.ev-grid-tarjetas')).gridTemplateColumns.split(' ').every(x => parseFloat(x) >= 299)"), 'Tarjetas: columnas de al menos 300 px');
      if (v === 'tarjetas') ok(await todos('.ev-cifras3 b', '23.4px') || await todos('.ev-cifras3 b', '23.5px'), 'Tarjetas: cifras de la franja +20 % (23,4 px)', await tam('.ev-cifras3 b'));
      if (v === 'rol') {
        ok(await todos('.ev-columna-cab', '18px'), 'Por rol: encabezados de columna 18 px', await tam('.ev-columna-cab'));
        const c3 = await ev("getComputedStyle(document.querySelector('.ev-columnas')).gridTemplateColumns.split(' ').length");
        ok(c3 === 3 && !/Testig/.test(await ev("document.getElementById('vistas-estructura').innerText")), 'Por rol: 3 columnas, sin testigos');
      }
      if (v === 'ranking') {
        ok(await todos('.ev-pct-grande', '25px') || (await tam('.ev-pct-grande')).length === 0, 'Ranking: % de la lista +20 % (25 px)', await tam('.ev-pct-grande'));
        const pp = await tam('.ev-pod-pct');
        ok(pp.every((x) => x === '42px' || x === '53px'), 'Ranking: % del podio +20 % (42 / 53 px)', pp);
        // fila de 2 líneas: la línea 2 queda debajo de la 1
        ok(await ev("[...document.querySelectorAll('.ev-fila-ranking')].every(f => f.querySelector('.ev-rk-2').getBoundingClientRect().top >= f.querySelector('.ev-rk-1').getBoundingClientRect().bottom - 1)"), 'Ranking: fila de dos líneas (la 2.ª debajo de la 1.ª)');
      }
      if (v === 'explorador') ok(await todos('.ev-nodo-nombre', '16px'), 'Explorador: árbol 16 px', await tam('.ev-nodo-nombre'));
      if (v === 'pendientes') {
        ok(await todos('.ev-pend h4', '18px'), 'Pendientes: encabezados de grupo 18 px', await tam('.ev-pend h4'));
        ok(await ev("[...document.querySelectorAll('.ev-pend-lista li[data-uid]')].every(f => f.querySelector('.ev-pd-2').getBoundingClientRect().top >= f.querySelector('.ev-pd-1').getBoundingClientRect().bottom - 1)"), 'Pendientes: fila de dos líneas');
      }
      if (esAdmin && w === 1280) { await ev("window.scrollTo(0, document.getElementById('vistas-estructura').getBoundingClientRect().top + window.scrollY - 70)"); await espera(250); await foto(`orden112-${v}-1280`); await ev('window.scrollTo(0, 0)'); }
    }
    // Lista: tamaños y desborde
    await elegir('lista');
    const mL = await menorLetra('#tbody-estructura, #card-estructura .leyenda-fichas');
    ok(mL.min >= 14, `Lista: ningún texto por debajo de 14 px (el menor: ${mL.min} px)`, mL);
    const lsec = '#tbody-estructura .migaja, #tbody-estructura .jefe-nombre, #tbody-estructura .jefe-cabeza, #tbody-estructura .correo-p, #tbody-estructura .avance-cifra .meta';
    ok(await todos(lsec, '16px'), 'Lista: secundarios a 16 px', await tam(lsec));
    const lb = await botonesOk('#tbody-estructura .btn-neutro, #tbody-estructura .btn-wa-fila');
    ok(lb.n > 0 && lb.mal.length === 0, `Lista: ${lb.n} botones a 15 px y ≥ 38 px`, lb);
    ok(await sinDesborde(), `Lista: sin desborde horizontal a ${w} px`);
    ok((await sinSalirse('#tbody-estructura .ficha-cuerpo')).length === 0, 'Lista: nada se corta dentro de las fichas', await sinSalirse('#tbody-estructura .ficha-cuerpo'));
    ok((await sinMontarse('#tbody-estructura .ficha-cuerpo')).length === 0, 'Lista: nada se monta', await sinMontarse('#tbody-estructura .ficha-cuerpo'));
    if (esAdmin && w === 1280) { await foto('orden112-lista-1280'); }
    ok(p.avisos.length === 0, `sin errores de consola (${etq} · ${w})`, p.avisos);
  }

  await comprobarRolYAncho('administrador', CORREO_ADMIN, 1280);
  await comprobarRolYAncho('administrador', CORREO_ADMIN, 1600);
  await comprobarRolYAncho('coordinadora', 'marta@ejemplo.co', 1280);
  await comprobarRolYAncho('coordinadora', 'marta@ejemplo.co', 1600);
  await comprobarRolYAncho('líder', 'ana112@ejemplo.co', 1280);
  await comprobarRolYAncho('líder', 'ana112@ejemplo.co', 1600);

  nav.cerrar();
  servidor.close();
  await pool.end();
  console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
