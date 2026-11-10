#!/usr/bin/env node
// scripts/probar-mapa-fondo.js
//
// Prueba, en un Chromium REAL, del FONDO DE MAPA COMÚN (parche 314, public/js/mapa-fondo.js):
//   · CONTROL NEGATIVO: la pantalla de Solicitudes del commit anterior, con las DOS cabeceras Referrer-Policy que manda el servidor de
//     producción (la de helmet y una `same-origin` de nginx), pide las teselas de OpenStreetMap SIN Referer. Ese era el 403 «Access blocked».
//   · Solicitudes y Tareas (administrador y líder), sin token y con un token que Mapbox rechaza: las teselas de OpenStreetMap salen CON
//     Referer (solo el dominio, nunca la ruta) y se cargan; con token falso Mapbox se abandona solo y cae a OpenStreetMap.
//   · Un rol que no puede leer el token NO lo pide (no deja un 403 en la red) y el mapa se pinta igual.
//   · Mapa territorial, Dashboard y Admin móvil siguen con sus fondos y el selector de fondos.
//   · El token nunca se escribe en la consola ni en la atribución.
// Las teselas se piden DE VERDAD a tile.openstreetmap.org: hace falta salida a internet.
//
// USO (sobre una base desechable ya inicializada con init-db; hace falta Chromium, ver scripts/capturas/navegador.js):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada314 node scripts/probar-mapa-fondo.js
//
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
delete process.env.MAPBOX_ACCESS_TOKEN;
const TOKEN_FALSO = 'pk.prueba-314-no-es-un-token-real';

const fs = require('fs');
const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');
const { spawnSync } = require('child_process');
const pool = require('../config/db');
const { lanzar, espera } = require('./capturas/navegador');
const { crear } = require('./capturas/servidor');

const RAIZ = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
const esOsm = (u) => /^https:\/\/[abc]\.tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png/.test(u);
const esMapbox = (u) => /^https:\/\/api\.mapbox\.com\/styles\//.test(u);

(async () => {
  // Activar complementos (parche 318): los complementos nacen APAGADOS; esta prueba enciende los que necesita.
  await require('./fixtures/encender-complementos')(pool, ['solicitudes', 'tareas', 'puerta_a_puerta']);
  let servidor; let navegador;
  try {
    /* ---------- 1. Estático ---------- */
    console.log('\n1. Estático');
    const fondo = leer('public/js/mapa-fondo.js');
    ok(!/console\./.test(fondo), 'mapa-fondo.js no escribe nada en la consola (el token no puede salir por ahí)');
    ok(/referrerPolicy: 'origin'/.test(fondo) && (fondo.match(/maxZoom: \d+, referrerPolicy: 'origin'|maxZoom: 22, referrerPolicy: 'origin'/g) || []).length === 2, 'las capas de OpenStreetMap y de Mapbox llevan referrerPolicy «origin»');
    ok(!/attribution:[^\n]*token/i.test(fondo), 'la atribución no lleva el token');
    for (const pag of ['public/solicitudes.html', 'public/tareas.html']) {
      const h = leer(pag);
      ok(/<meta name="referrer" content="strict-origin-when-cross-origin">/.test(h) && h.includes('<script src="/js/mapa-fondo.js"></script>') && /fondoMapa\(/.test(h) && !/tile\.openstreetmap/.test(h), `${pag}: meta referrer, mapa-fondo.js y fondoMapa(); ya no arma su propia capa`);
    }
    for (const pag of ['public/mapa.html', 'public/dashboard.html', 'public/app/admin-mapa.html']) {
      const h = leer(pag);
      ok(h.includes('<script src="/js/mapa-fondo.js"></script>') && /fondosMapa\(/.test(h) && !/tile\.openstreetmap|api\.mapbox\.com/.test(h), `${pag}: usa fondosMapa(); ya no arma sus propias capas`);
    }
    ok(/tile\.openstreetmap/.test(leer('public/app/puerta-a-puerta.html')) && /tile\.openstreetmap/.test(leer('public/js/transporte-conductor.js')), 'Puerta a puerta y Transporte NO se tocaron (siguen con su capa propia)');
    const sw = leer('public/service-worker.js');
    ok(/CACHE_NAME = 'estrategia-v\d+'/.test(sw) && sw.includes("'/js/mapa-fondo.js'"), 'service worker: caché versionada y /js/mapa-fondo.js en la coraza');

    /* ---------- 2. Base y usuarios ---------- */
    const [[admin]] = await pool.query("SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.nombre = 'admin' ORDER BY u.id LIMIT 1");
    const sufijo = '95' + String(Date.now()).slice(-8);   // cada corrida su propio líder: la prueba se puede repetir
    const [r] = await pool.query(
      `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES ('Líder de prueba', ?, ?, ?, (SELECT id FROM roles WHERE nombre = 'lider'), 1)`,
      [sufijo, 'u' + sufijo, bcrypt.hashSync('clave-ejemplo', 4)]);
    await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, NULL, 1)', [r.insertId, 'lider']);
    const lider = r.insertId;
    for (const modulo of ['solicitudes', 'tareas']) {
      await pool.query('INSERT IGNORE INTO permisos_rol (rol, modulo, permitido, editar, agregar, importar_exportar) VALUES (?, ?, 1, 1, 1, 0)', ['lider', modulo]);
      await pool.query('UPDATE permisos_rol SET permitido = 1 WHERE rol = ? AND modulo = ?', ['lider', modulo]);
    }

    /* ---------- 3. Servidor: el real, con las dos cabeceras de producción ---------- */
    const app = crear(pool);
    const envoltorio = require('express')();
    envoltorio.use((req, res, next) => {          // helmet + nginx: DOS Referrer-Policy; el navegador se queda con la última (same-origin)
      res.append('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.append('Referrer-Policy', 'same-origin');
      next();
    });
    // El control negativo: la pantalla de Solicitudes tal como estaba en el commit anterior (se lee de git).
    const viejo = spawnSync('git', ['show', 'HEAD:public/solicitudes.html'], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 20e6 });
    ok(viejo.status === 0 && /tile\.openstreetmap/.test(viejo.stdout) && !/mapa-fondo/.test(viejo.stdout), 'control: el HEAD trae la pantalla vieja (capa de OSM propia, sin mapa-fondo.js)');
    envoltorio.get('/viejo/solicitudes.html', (req, res) => res.type('html').send(viejo.stdout));
    envoltorio.use(app);
    servidor = http.createServer(envoltorio);
    await new Promise((res) => servidor.listen(0, '127.0.0.1', res));
    const base = `http://127.0.0.1:${servidor.address().port}`;
    const cab = await new Promise((res) => http.get(base + '/solicitudes.html', (x) => { x.resume(); res(x.headers['referrer-policy']); }));
    ok(/strict-origin-when-cross-origin, same-origin/.test(cab || ''), 'el servidor de la prueba manda las dos cabeceras, como producción', cab);

    navegador = await lanzar();
    const nuevaPagina = async () => {
      const p = await navegador.pagina('about:blank');
      await p.cmd('Network.clearBrowserCookies');
      await p.cmd('Network.setCacheDisabled', { cacheDisabled: true });
      await p.cmd('Log.enable').catch(() => {});
      return p;
    };
    const entrarComo = (p, id) => p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(id), url: base });
    const ir = async (p, ruta, ms = 2500) => { await p.cmd('Page.navigate', { url: base + ruta }); await espera(ms); };
    const clic = (p, sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
    const hayTeselas = (p, f) => p.respuestas.some((x) => f(x.url));
    const esperarTeselas = async (p, f, ms = 25000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (hayTeselas(p, f)) { await espera(800); return true; } await espera(400); } return false; };
    const resumen = (p, f) => { const m = {}; p.respuestas.filter((x) => f(x.url)).forEach((x) => { m[x.status] = (m[x.status] || 0) + 1; }); return m; };
    const del = (p, f) => p.detalle.filter((x) => f(x.url));
    const referers = (p) => [...new Set(del(p, esOsm).map((x) => x.referer))];
    const tokenPedido = (p) => p.detalle.some((x) => /\/api\/territorial\/mapbox-token/.test(x.url));
    const token403 = (p) => p.respuestas.some((x) => /\/api\/territorial\/mapbox-token/.test(x.url) && x.status === 403);

    /* ---------- 4. CONTROL NEGATIVO ---------- */
    console.log('\n4. Control negativo: la pantalla vieja con las dos cabeceras');
    {
      const p = await nuevaPagina(); await entrarComo(p, admin.id);
      await ir(p, '/viejo/solicitudes.html'); await clic(p, '.pestana[data-vista="mapa"]');
      const llegaron = await esperarTeselas(p, esOsm);
      console.log('       (informativo) OSM respondió a la pantalla vieja:', JSON.stringify(resumen(p, esOsm)), 'Referer enviado:', JSON.stringify(referers(p)));
      ok(llegaron && referers(p).every((x) => x === null), 'la pantalla vieja pide las teselas de OSM SIN Referer (la causa del «Access blocked»)', referers(p));
      p.cerrar();
    }

    /* ---------- 5. Solicitudes y Tareas ---------- */
    const pantallas = [
      { ruta: '/solicitudes.html', pestana: '.pestana[data-vista="mapa"]', nombre: 'Solicitudes' },
      { ruta: '/tareas.html', pestana: '.pestana[data-vista="mapa"]', nombre: 'Tareas' },
    ];
    const casos = [
      { quien: 'administrador', id: admin.id, token: null, etiqueta: 'sin token' },
      { quien: 'líder', id: lider, token: null, etiqueta: 'sin token' },
      { quien: 'administrador', id: admin.id, token: TOKEN_FALSO, etiqueta: 'con token que Mapbox rechaza' },
      { quien: 'líder', id: lider, token: TOKEN_FALSO, etiqueta: 'con token (el líder no puede leerlo)' },
    ];
    for (const pant of pantallas) {
      for (const c of casos) {
        console.log(`\n5. ${pant.nombre} · ${c.quien} · ${c.etiqueta}`);
        if (c.token) process.env.MAPBOX_ACCESS_TOKEN = c.token; else delete process.env.MAPBOX_ACCESS_TOKEN;
        const p = await nuevaPagina(); await entrarComo(p, c.id);
        await ir(p, pant.ruta); await clic(p, pant.pestana);
        const conTokenVisible = c.token && c.quien === 'administrador';
        const llegaron = await esperarTeselas(p, esOsm, 30000);
        const osm = resumen(p, esOsm), mb = resumen(p, esMapbox);
        console.log('       OSM:', JSON.stringify(osm), ' Mapbox:', JSON.stringify(mb), ' Referer:', JSON.stringify(referers(p)), p.respuestas.filter((x) => esMapbox(x.url) && x.error).map((x) => x.error).slice(0, 1).join());
        ok(llegaron, 'se piden teselas de OpenStreetMap (directo, o como caída desde Mapbox)');
        ok(referers(p).length > 0 && referers(p).every((x) => x === base + '/'), 'todas con Referer = el dominio solo (sin ruta), pese a las dos cabeceras', referers(p));
        ok(Object.keys(osm).length > 0 && Object.keys(osm).every((k) => k === '200'), 'todas las teselas de OSM devuelven 200', osm);
        if (conTokenVisible) ok(del(p, esMapbox).length > 0 && Object.keys(mb).every((k) => k !== '200'), 'se intentó Mapbox primero y NO entregó nada (token falso), antes de caer a OSM', mb);
        else ok(del(p, esMapbox).length === 0, 'no se pidió ninguna tesela de Mapbox');
        if (c.quien === 'líder') ok(!tokenPedido(p) && !token403(p), 'el líder NO pide el token: no queda ningún 403 en la red');
        ok(p.avisos.length === 0, 'sin excepciones en la página', p.avisos);
        const capa = await p.ev(`document.querySelectorAll('#${pant.nombre === 'Solicitudes' ? 'mapa-sol' : 'mapa-tar'} .leaflet-tile-pane img').length`);
        ok(capa > 0, 'el mapa tiene teselas en el DOM', capa);
        const attr = await p.ev(`[...document.querySelectorAll('.leaflet-control-attribution')].map((e) => e.textContent).join(' ')`);
        ok(!attr.includes(TOKEN_FALSO), 'la atribución visible no lleva el token');
        p.cerrar();
      }
    }

    /* ---------- 6. Otros tres mapas, como administrador ---------- */
    const otros = [
      { ruta: '/mapa.html', nombre: 'Mapa territorial', sel: '#mapa', selector: true },
      { ruta: '/dashboard.html', nombre: 'Dashboard', sel: '#mapa-dashboard', selector: true },
      { ruta: '/app/admin-mapa.html', nombre: 'Admin móvil', sel: '#mapa', selector: true },
    ];
    for (const o of otros) {
      for (const token of [null, TOKEN_FALSO]) {
        console.log(`\n6. ${o.nombre} · ${token ? 'con token que Mapbox rechaza' : 'sin token'}`);
        if (token) process.env.MAPBOX_ACCESS_TOKEN = token; else delete process.env.MAPBOX_ACCESS_TOKEN;
        const p = await nuevaPagina(); await entrarComo(p, admin.id);
        await ir(p, o.ruta, 3500);
        const llegaron = await esperarTeselas(p, esOsm, 30000);
        const osm = resumen(p, esOsm), mb = resumen(p, esMapbox);
        console.log('       OSM:', JSON.stringify(osm), ' Mapbox:', JSON.stringify(mb), ' Referer:', JSON.stringify(referers(p)));
        ok(llegaron && Object.keys(osm).every((k) => k === '200'), 'teselas de OSM con 200', osm);
        ok(referers(p).every((x) => x === base + '/'), 'con Referer del dominio solo', referers(p));
        if (token) ok(Object.keys(mb).length > 0 && Object.keys(mb).every((k) => k !== '200'), 'Mapbox se intentó primero, no entregó nada y cayó a OSM', mb);
        else ok(Object.keys(mb).length === 0, 'sin token no se pide Mapbox');
        const opciones = await p.ev(`[...document.querySelectorAll('.leaflet-control-layers-base label')].map(l => l.textContent.trim())`);
        ok(JSON.stringify(opciones) === JSON.stringify(token ? ['OpenStreetMap', 'Mapbox Calles', 'Mapbox Satélite'] : ['OpenStreetMap']), 'el selector de fondos ofrece lo de siempre', opciones);
        ok(p.avisos.length === 0, 'sin excepciones en la página', p.avisos);
        p.cerrar();
      }
    }

    /* ---------- 7. obtenerTokenMapa ante un 403 ---------- */
    console.log('\n7. obtenerTokenMapa()');
    {
      process.env.MAPBOX_ACCESS_TOKEN = TOKEN_FALSO;
      const p = await nuevaPagina(); await entrarComo(p, lider);
      await ir(p, '/solicitudes.html', 2000);
      const sinRol = await p.ev(`obtenerTokenMapa().then((t) => ({ t: t, error: null }), (e) => ({ t: null, error: String(e) }))`);
      ok(sinRol.t === null && sinRol.error === null, 'sin pasar el rol: el servidor responde 403 y la función devuelve null SIN lanzar', sinRol);
      const conRol = await p.ev(`obtenerTokenMapa({ rol: 'lider' })`);
      ok(conRol === null, 'pasando un rol sin acceso: null sin preguntar');
      const admin2 = await nuevaPagina(); await entrarComo(admin2, admin.id);
      await ir(admin2, '/solicitudes.html', 2000);
      const tk = await admin2.ev(`obtenerTokenMapa({ rol: 'admin' }).then((t) => t === ${JSON.stringify(TOKEN_FALSO)})`);
      ok(tk === true, 'el administrador sí recibe el token');
      const forzado = await admin2.ev(`(async () => { const a = window.api; window.api = () => Promise.reject(new Error('sin red')); const t = await obtenerTokenMapa(); window.api = a; return t; })()`);
      ok(forzado === null, 'sin red: null, sin lanzar');
      p.cerrar(); admin2.cerrar();
    }
  } catch (e) {
    fallos++; console.log('  FALLA excepción en la prueba:', e && e.stack || e);
  } finally {
    if (navegador) navegador.cerrar();
    if (servidor) servidor.close();
    try { await pool.end(); } catch (_) { /* ya cerrado */ }
  }
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})();
