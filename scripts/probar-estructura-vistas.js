#!/usr/bin/env node
// scripts/probar-estructura-vistas.js — ORDEN 105:
//   «Estructura territorial» (escritorio) con selector de 6 vistas: Lista (la de siempre) + Tarjetas, Por rol, Ranking, Explorador y Pendientes.
//   Con administrador, coordinador y líder, a 1280 y 1600 px:
//     · las 6 vistas muestran LAS MISMAS personas que la lista (sin búsqueda y con búsqueda);
//     · la vista elegida se recuerda al recargar (por usuario);
//     · Editar abre el formulario de siempre; «+ Agregar» respeta lo que cada rol puede agregar;
//     · «Ver equipo» deja a la persona y su gente; «Ver detalle» (Pendientes) lleva al Explorador;
//     · a menos de 900 px las columnas de «Por rol» bajan una debajo de otra.
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
      const con = await txt('.ev-fila-ranking .ev-nombre-enlace');
      const franja = await ev("(() => { const f = document.querySelector('.ev-franja-rosa'); return f ? f.textContent.replace('Sin meta asignada:', '').split(',').map(x => x.trim()).filter(Boolean) : []; })()");
      return { gente: con.concat(franja), testigos: [], con, sin: franja };
    }
    if (v === 'explorador') return { gente: await txt('.ev-nodo .ev-nodo-nombre'), testigos: [] };
    if (v === 'pendientes') {
      const grupos = await ev("[...document.querySelectorAll('.ev-pend')].map(s => ({ g: s.dataset.grupo, n: [...s.querySelectorAll('.ev-pend-quien b')].map(e => e.textContent.trim()) }))");
      return { gente: [...new Set(grupos.flatMap((g) => g.n))], testigos: [], grupos };
    }
    return { gente: [], testigos: [] };
  };

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

  /* ============ ADMINISTRADOR ============ */
  await comprobarRol('administrador', CORREO_ADMIN, CLAVE, [1280, 1600]);

  console.log('\n[Administrador · detalle de cada vista · 1280 px]');
  await ancho(1280); await limpiar(); await entrar(CORREO_ADMIN); await abrirEstructura();
  const listaAdmin = await nombresLista();
  const total = await ev("document.getElementById('contador-estructura').textContent");
  ok(/registro/.test(total), 'contador de la lista', total);

  await elegir('tarjetas');
  ok(await ev("getComputedStyle(document.querySelector('.ev-grid-tarjetas')).gridTemplateColumns.split(' ').length >= 4"), 'Tarjetas: cuadrícula de 4 o más columnas a 1280 px');
  const tarjeta = await ev("(() => { const t = [...document.querySelectorAll('.ev-tarjeta')].find(x => x.querySelector('.ev-nombre').textContent.includes('Beto')); return { texto: t.innerText, anillo: !!t.querySelector('.ev-anillo'), editar: !!t.querySelector('[data-accion=editar]'), equipo: !!t.querySelector('[data-accion=equipo]') }; })()");
  ok(/Líder/.test(tarjeta.texto) && /5 de 10/.test(tarjeta.texto) && /50%/.test(tarjeta.texto) && /Reporta a|Marta/.test(tarjeta.texto) && /equipo 1/.test(tarjeta.texto), 'Tarjeta de Beto: rol, «5 de 10», 50 %, jefe y equipo 1', tarjeta.texto);
  ok(tarjeta.anillo && tarjeta.editar && tarjeta.equipo, 'con anillo, Editar y Ver equipo');
  const zonas = await txt('.ev-tarjeta .ev-chip-urbano, .ev-tarjeta .ev-chip-rural');
  ok(zonas.includes('URBANO') && zonas.includes('RURAL'), 'etiquetas URBANO y RURAL', zonas);

  // Editar abre el formulario de siempre (pide la contraseña propia primero)
  await ev("document.querySelector('.ev-tarjeta [data-accion=editar]').click()");
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
  ok(JSON.stringify(rolInfo.columnas) === JSON.stringify(['Coordinadores', 'Líderes', 'Sublíderes', 'Testigos']), 'Por rol: cuatro columnas con su nombre', rolInfo.columnas);
  ok(rolInfo.testigos.length === 2, 'Por rol: columna Testigos con los 2 testigos de la misma respuesta', rolInfo.testigos);
  ok(await ev("getComputedStyle(document.querySelector('.ev-columnas')).gridTemplateColumns.split(' ').length === 4"), 'cuatro columnas a 1280 px');
  const colores = await ev("[...document.querySelectorAll('.ev-columna-cab')].map(h => getComputedStyle(h).backgroundColor)");
  ok(JSON.stringify(colores) === JSON.stringify(['rgb(11, 94, 215)', 'rgb(8, 66, 152)', 'rgb(138, 90, 0)', 'rgb(46, 125, 50)']), 'encabezados con los colores de rol', colores);
  const agregarAdmin = await txt('.ev-columna-pie .ev-agregar');
  ok(JSON.stringify(agregarAdmin) === JSON.stringify(['+ Agregar coordinador', '+ Agregar líder', '+ Agregar sublíder', '+ Agregar testigo']), 'administrador: «+ Agregar» en las cuatro columnas', agregarAdmin);
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
  await ancho(1280);

  await elegir('ranking');
  const rk = await personasDeVista('ranking');
  ok(rk.con.length > 0 && rk.sin.length > 0, 'Ranking: con meta y «Sin meta asignada» (franja rosada)', rk);
  const pcts = await ev("[...document.querySelectorAll('.ev-pct-grande')].map(e => parseInt(e.textContent))");
  ok(pcts.every((v, i) => i === 0 || pcts[i - 1] >= v), 'ordenado de mayor a menor %', pcts);
  const medallas = await txt('.ev-puesto');
  ok(medallas[0] === '🥇' && medallas[1] === '🥈' && medallas[2] === '🥉', 'medallas 🥇🥈🥉 a los tres primeros', medallas.slice(0, 4));
  const colsPct = await ev("[...document.querySelectorAll('.ev-fila-ranking')].map(f => ({ p: parseInt(f.querySelector('.ev-pct-grande').textContent), c: getComputedStyle(f.querySelector('.ev-pct-grande')).color }))");
  const esperadoColor = (v) => (v < 25 ? 'rgb(198, 40, 40)' : v < 60 ? 'rgb(178, 106, 0)' : 'rgb(46, 125, 50)');
  ok(colsPct.every((x) => x.c === esperadoColor(x.p)), 'el % grande usa el semáforo (rojo <25, ámbar 25-59, verde ≥60)', colsPct);
  ok(JSON.stringify(await txt('.ev-fichas-filtro button')) === JSON.stringify(['Todos', 'Coordinadores', 'Líderes', 'Sublíderes']), 'fichas de filtro: Todos / Coordinadores / Líderes / Sublíderes');
  await ev("document.querySelector('.ev-fichas-filtro [data-valor=sublider]').click()"); await espera(300);
  const soloSub = await personasDeVista('ranking');
  ok(soloSub.gente.length === 2 && soloSub.gente.every((n) => /Sublíder/.test(n)), 'la ficha «Sublíderes» deja solo a los sublíderes', soloSub.gente);
  await ev("document.querySelector('.ev-fichas-filtro [data-valor=todos]').click()"); await espera(300);

  await elegir('explorador');
  const primera = await ev("document.querySelector('.ev-nodo.sel .ev-nodo-nombre').textContent.trim()");
  const primeroDelArbol = await ev("document.querySelector('.ev-nodo .ev-nodo-nombre').textContent.trim()");
  ok(primera === primeroDelArbol && (await ev("document.querySelector('#ev-ficha h3').textContent.trim()")) === primera, 'Explorador: al abrir queda seleccionada la primera persona y su ficha', { primera });
  ok(await ev("Math.round(document.getElementById('ev-arbol').getBoundingClientRect().width)") >= 320 && await ev("Math.round(document.getElementById('ev-arbol').getBoundingClientRect().width)") <= 340, 'panel izquierdo de ≈330 px');
  await ev("[...document.querySelectorAll('.ev-nodo-btn')].find(b => b.textContent.includes('Marta')).click()"); await espera(350);
  const ficha = await ev("document.getElementById('ev-ficha').innerText");
  ok(/Marta Coordinadora/.test(ficha) && /Personas a cargo/.test(ficha) && /Su equipo/.test(ficha) && /Celular/.test(ficha) && /Autorización de datos/.test(ficha), 'ficha de Marta: indicadores, datos y «Su equipo»', ficha.slice(0, 200));
  ok(await ev("document.querySelectorAll('#ev-ficha .ev-equipo li').length") === 4, 'su equipo: sus 4 líderes con barra');
  ok(await ev("document.querySelectorAll('#ev-ficha .ev-ind').length") === 4, 'cuatro indicadores');
  ok(await ev("!!document.querySelector('#ev-ficha [data-accion=editar]') && !!document.querySelector('#ev-ficha [data-accion=agregar]')"), 'botones Editar y «+ Agregar» (administrador)');
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
  const botonesPend = await ev("(() => { const s = n => [...document.querySelectorAll('[data-grupo=' + n + '] button')].map(b => b.textContent.trim()); return { eq: s('sin-equipo'), au: s('sin-autorizacion'), lu: s('sin-lugar'), av: s('avance-bajo') }; })()");
  ok(botonesPend.eq.every((t) => t === 'Agregar equipo') && botonesPend.au.every((t) => t === 'Ver') && botonesPend.lu.every((t) => t === 'Completar') && botonesPend.av.every((t) => t === 'Ver detalle'), 'botones: Agregar equipo / Ver / Completar / Ver detalle', botonesPend);
  await ev("document.querySelector('[data-grupo=avance-bajo] button').click()"); await espera(500);
  const destino = await ev("({ v: document.querySelector('#selector-vistas-estructura .activa').dataset.vista, h3: (document.querySelector('#ev-ficha h3') || {}).textContent })");
  ok(destino.v === 'explorador' && /Pedro|Ana|Eva/.test(destino.h3 || ''), '«Ver detalle» lleva al Explorador con esa persona', destino);
  await ev("document.querySelector('#selector-vistas-estructura [data-vista=pendientes]').click()"); await espera(350);
  await ev("document.querySelector('[data-grupo=sin-equipo] [data-accion=agregar]').click()");
  ok(await esperar("document.getElementById('overlay-form').classList.contains('abierto')", 8000), '«Agregar equipo» abre el formulario de hoy');
  await ev("document.getElementById('cerrar-modal').click()"); await espera(300);

  /* ============ COORDINADOR ============ */
  await comprobarRol('coordinador', 'marta@ejemplo.co', CLAVE, [1280, 1600]);
  console.log('\n[Coordinador · permisos de «+ Agregar»]');
  await ancho(1280); await limpiar(); await entrar('marta@ejemplo.co'); await abrirEstructura();
  await elegir('rol');
  const agregarCoord = await txt('.ev-columna-pie .ev-agregar');
  ok(JSON.stringify(agregarCoord) === JSON.stringify(['+ Agregar líder']), 'el coordinador solo ve «+ Agregar líder»', agregarCoord);
  ok(await ev("!document.querySelector('.ev-tarjeta [data-accion=editar]')"), 'y ninguna vista le ofrece Editar');
  await ev("document.querySelector('.ev-agregar[data-cat=lider]').click()");
  ok(await esperar("document.getElementById('overlay-form').classList.contains('abierto')", 8000), '«+ Agregar líder» abre el formulario (con la categoría fija en Líder)');
  await ev("document.getElementById('cerrar-modal').click()"); await espera(300);
  await elegir('explorador');
  await ev("[...document.querySelectorAll('.ev-nodo-btn')].find(b => b.textContent.includes('Ana')).click()"); await espera(300);
  ok(await ev("!document.querySelector('#ev-ficha [data-accion=agregar]')"), 'Explorador: en un líder no ofrece «+ Agregar» (un coordinador no agrega sublíderes)');
  await ev("[...document.querySelectorAll('.ev-nodo-btn')].find(b => b.textContent.includes('Marta')).click()"); await espera(300);
  ok(await ev("!!document.querySelector('#ev-ficha [data-accion=agregar]')"), 'y en su propia ficha sí (agrega líderes)');
  await elegir('pendientes');
  const botonesCoord = await txt('[data-grupo=sin-equipo] button');
  ok(botonesCoord.every((t) => t === 'Agregar equipo'), 'Pendientes: «Agregar equipo» solo donde puede (un líder le agrega sublíderes: no → sin botón)', botonesCoord);

  /* ============ LÍDER ============ */
  await comprobarRol('líder', 'ana105@ejemplo.co', CLAVE, [1280]);
  console.log('\n[Líder · permisos]');
  await ancho(1280); await limpiar(); await entrar('ana105@ejemplo.co'); await abrirEstructura();
  await elegir('rol');
  ok((await txt('.ev-columna-pie .ev-agregar')).length === 0, 'el líder no ve ningún «+ Agregar»');
  ok(await ev("!document.querySelector('[data-accion=editar]')"), 'ni Editar');

  nav.cerrar();
  servidor.close();
  await pool.end();
  console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
