#!/usr/bin/env node
// scripts/probar-tareas-direccion-admin-celular.js — orden 120: «TAREAS DE DIRECCIÓN» EN EL PANEL DE CELULAR DEL ADMINISTRADOR.
//
// Chromium REAL, service worker ENCENDIDO, 390×844 (celular) y 800 px (escritorio angosto), y la app «instalada» simulada (display-mode: standalone).
//   · superadministrador, administrador «Es el candidato» (en Modo administrador) y candidato ven la tarjeta; la pantalla abre con SU barra y «volver» regresa a donde estaban;
//   · administrador sin la casilla, coordinador y líder no la ven, y la API les responde 403;
//   · el aviso «Tareas programadas» (orden 122) sale en el Panel general ARRIBA de las cifras y en el primer grupo del menú de inicio (con el globo rojo de vencidas).
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada120 node scripts/probar-tareas-direccion-admin-celular.js
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) { console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`); process.exit(2); }
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';
process.env.SMS_PROVIDER = 'none';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const pool = require('../config/db');
const T = require('../lib/tareasDireccion');
const R = require('../public/js/tareas-direccion-reglas.js');
const { lanzar, espera } = require('./capturas/navegador');
const { crear: crearServidor } = require('./capturas/servidor');

const RAIZ = path.join(__dirname, '..');
const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden120');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];
const VERSION_SW = /CACHE_NAME = '([^']+)'/.exec(fs.readFileSync(path.join(RAIZ, 'public/service-worker.js'), 'utf8'))[1];
const D = R.enColombia(new Date()).hoy;
const dia = (n) => R.sumarDias(D, n);
const en = (d, hh = 8) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd, hh + 5, 0)); };

(async () => {
  await q("DELETE FROM tareas_direccion WHERE titulo LIKE 'PRUEBA120%'");
  await q("DELETE FROM usuarios WHERE numero_identificacion BETWEEN '7200101' AND '7200199' AND es_superadmin = 0");
  const rolId = async (n) => (await q('SELECT id FROM roles WHERE nombre = ?', [n]))[0].id;
  let ced = 7200100;
  const usuario = async (nombre, rol, extra = {}) => {
    ced++;
    const [r] = await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, password_hash, rol_id, activo, es_candidato) VALUES (?, ?, ?, ?, 'x', ?, 1, ?)`,
      [nombre, String(ced), String(ced), `p${ced}@ejemplo.co`, await rolId(rol), extra.es_candidato ? 1 : 0]);
    return r.insertId;
  };
  const sup = (await q('SELECT id FROM usuarios WHERE es_superadmin = 1 LIMIT 1'))[0];
  const ids = {
    super: sup.id, cand: await usuario('Candidato Prueba', 'candidato'), admCand: await usuario('Admin Es Candidato', 'admin', { es_candidato: 1 }),
    admSin: await usuario('Admin Sin Casilla', 'admin'), coord: await usuario('Coordinadora', 'coordinador'), lider: await usuario('Lider', 'lider'),
  };
  // Tres tareas del candidato: dos vencidas y una que vence en 2 días (→ «2 vencidas · 1 vence en 3 días»).
  const nueva = async (titulo, limite) => T.crear({ titulo: 'PRUEBA120 ' + titulo, responsable_tipo: 'candidato', responsable_ref_id: ids.cand, fecha_limite: limite, prioridad: 'normal', aviso_activo: false }, ids.cand, { ahora: en(dia(-10)) });
  for (const [t, l] of [['vencida uno', dia(-3)], ['vencida dos', dia(-1)], ['próxima', dia(2)]]) { const r = await nueva(t, l); if (!r.tarea) throw new Error('No se pudo sembrar: ' + JSON.stringify(r)); }

  // Los estáticos van delante, como en app.js (con 10 minutos de caché HTTP): sin ellos el service worker no llega a instalarse en el servidor de capturas.
  const estaticos = express.static(path.join(RAIZ, 'public'), { maxAge: '10m' });
  const externo = express();
  externo.use((req, res, next) => estaticos(req, res, next));
  externo.use(crearServidor(pool, { soloLecturaCandidato: true }));
  const servidor = http.createServer(externo);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const navegador = await lanzar();
  try {
    const p = await navegador.pagina('about:blank');
    await p.cmd('Network.setBypassServiceWorker', { bypass: false });   // SERVICE WORKER ENCENDIDO
    await p.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; const ce = console.error; console.error = function () { window.__errs.push([].slice.call(arguments).join(' ')); ce.apply(console, arguments); }; window.addEventListener('error', (e) => window.__errs.push('EXC ' + e.message));` });
    const vista = (w, h, movil) => p.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: movil ? 2 : 1, mobile: !!movil });
    const entrarComo = async (id) => { await p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(id), url: base }); };
    const ir = async (ruta, ms = 2300) => { await p.cmd('Page.navigate', { url: base + ruta }); await espera(ms); };
    const ev = (x) => p.ev(x);
    const foto = async (nombre) => { const r = await p.cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r.result.data, 'base64')); console.log('  captura: ' + path.join(SALIDA, nombre + '.png')); };
    const ruta = () => ev('location.pathname + location.search');
    const existe = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
    const visible = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return !e.hidden && s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; })()`);
    const texto = (sel) => ev(`((document.querySelector(${JSON.stringify(sel)}) || {}).textContent || '').replace(/\\s+/g, ' ').trim()`);
    const clic = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
    const llamar = (r) => ev(`fetch(${JSON.stringify(r)}).then((x) => x.status)`);
    const sinDesborde = () => ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`);

    await vista(390, 844, true);
    await p.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] });   // la app «instalada»

    console.log('\n[1] Panel general (390×844, app instalada): la tarjeta según el rol');
    const roles = [['superadministrador', ids.super, true], ['administrador «Es el candidato» (Modo administrador)', ids.admCand, true], ['administrador SIN la casilla', ids.admSin, false]];
    for (const [nombre, id, debe] of roles) {
      await entrarComo(id); await ir('/app/admin-panel.html');
      // Orden 122: la tarjeta «Tareas programadas» va ARRIBA de las cifras; la vieja «Tareas de dirección» (orden 120) ya no existe.
      const a = { visible: await visible('#tareas-aviso'), txt: await texto('#tareas-aviso'), globo: await visible('#tareas-aviso .tav-globo') ? await texto('#tareas-aviso .tav-globo') : null,
        filas: await ev(`[...document.querySelectorAll('#tareas-aviso .tav-fila')].map((f) => ({ t: f.querySelector('.tav-t').textContent, v: f.querySelector('.tav-venc').textContent.replace(/\\u00a0/g, ' '), c: f.querySelector('.tav-hoja').className }))`),
        arriba: await ev(`(document.getElementById('tareas-aviso').getBoundingClientRect().top < document.getElementById('cifras').getBoundingClientRect().top)`),
        vieja: await existe('#tarjeta-tareas') };
      if (debe) {
        ok(a.visible && /Tareas programadas/.test(a.txt) && a.globo === '2' && /Ver todas \(3\)/.test(a.txt), `${nombre}: sale «Tareas programadas» con el globo rojo 2 y «Ver todas (3)»`, a);
        ok(a.filas.length === 3 && /vencida uno/.test(a.filas[0].t) && a.filas[0].v === 'Vencida hace 3 días' && a.filas[0].c.includes('rojo') && /vencida dos/.test(a.filas[1].t) && a.filas[1].v === 'Vencida hace 1 día'
          && /próxima/.test(a.filas[2].t) && a.filas[2].v === 'Vence en 2 días' && a.filas[2].c.includes('azul'), `${nombre}: tres renglones, las vencidas primero (la más vieja arriba) y luego la próxima, con sus textos`, a.filas);
        ok(a.arriba, `${nombre}: la tarjeta está ARRIBA de las cifras`);
      } else ok(!a.visible && a.txt === '', `${nombre}: la tarjeta NO sale (ni su espacio)`, a);
      ok(!a.vieja, `${nombre}: la tarjeta vieja de la orden 120 ya no está`);
      ok(await visible('#nav-admin') && await ev(`document.querySelectorAll('#nav-admin a').length === 7`), `${nombre}: la barra inferior del administrador sigue igual (7 botones, sin tocar)`);
      ok(await sinDesborde(), `${nombre}: sin desborde horizontal`);
      if (id === ids.super) await foto('panel-superadmin-390');
    }

    console.log('\n[2] La tarjeta abre la pantalla con la barra del administrador, y «volver» regresa al Panel');
    for (const [nombre, id] of [['superadministrador', ids.super], ['administrador «Es el candidato» en Modo administrador', ids.admCand]]) {
      await entrarComo(id); await ir('/app/admin-panel.html');
      await clic('#tareas-aviso .tav-todas'); await espera(2500);
      const r1 = await ruta();
      ok(/^\/app\/candidato-tareas\.html/.test(r1), `${nombre}: la tarjeta abre candidato-tareas.html`, r1);
      ok(await visible('#app-barra') && /Tareas de dirección/.test(await texto('#app-barra')) && !(await visible('#barra-cand')), `${nombre}: encabezado de la app del administrador, no el del candidato`);
      ok(await visible('#nav-admin') && !(await existe('#nav-candidato')), `${nombre}: barra inferior del administrador (no la del candidato)`);
      ok(await existe('.tdm-tabs') && await ev(`document.querySelectorAll('.tdm-card').length === 3`) && /2/.test(await texto('.tdm-tabs button[data-tab=pendiente] b')) === false, `${nombre}: la lista carga las 3 tareas`);
      ok(await sinDesborde(), `${nombre}: sin desborde horizontal`);
      if (id === ids.super) await foto('pantalla-superadmin-390');
      await clic('#app-barra .volver'); await espera(2200);
      ok(/^\/app\/admin-panel\.html/.test(await ruta()), `${nombre}: «volver» regresa al Panel general`, await ruta());
    }

    console.log('\n[3] El menú de inicio: la tarjeta en el primer grupo, con el globo rojo');
    for (const [nombre, id, debe] of [['superadministrador', ids.super, true], ['administrador «Es el candidato» (Modo administrador)', ids.admCand, true], ['administrador SIN la casilla', ids.admSin, false]]) {
      await entrarComo(id); await ir('/app/admin-panel.html', 1800);   // fija el Modo administrador en este equipo
      await ir('/app/inicio.html', 2800);
      const m = await ev(`(() => { const a = [...document.querySelectorAll('.menu-boton')].find((x) => /Tareas de direcci/.test(x.textContent)); if (!a) return { esta: false, ruta: location.pathname }; const g = a.closest('.menu-grupo'); return { esta: true, grupo: g.querySelector('h2').textContent, previo: a.previousElementSibling ? a.previousElementSibling.textContent.trim().slice(0, 30) : null, href: a.getAttribute('href'), globo: (a.querySelector('.globo-tareas') && !a.querySelector('.globo-tareas').hidden) ? a.querySelector('.globo-tareas').textContent : null, candado: !!a.querySelector('.candado') }; })()`);
      if (debe) ok(m.esta && m.grupo === 'Resumen' && /Panel general/.test(m.previo || '') && m.globo === '2' && m.candado && /candidato-tareas\.html\?volver=\/app\/inicio\.html/.test(m.href), `${nombre}: en el grupo «Resumen», debajo de «Panel general», con candado y globo 2`, m);
      else ok(!m.esta, `${nombre}: la tarjeta NO sale en el menú`, m);
      if (debe && id === ids.super) {
        await foto('menu-superadmin-390');
        await ev(`[...document.querySelectorAll('.menu-boton')].find((x) => /Tareas de direcci/.test(x.textContent)).click()`); await espera(2500);
        ok(/^\/app\/candidato-tareas\.html/.test(await ruta()) && await visible('#nav-admin'), 'desde el menú abre la pantalla con la barra del administrador');
        await clic('#app-barra .volver'); await espera(2200);
        ok(/^\/app\/inicio\.html/.test(await ruta()), '«volver» regresa al menú de inicio', await ruta());
      }
    }

    console.log('\n[4] Candidato (y administrador-candidato en Modo candidato): barra del candidato, «volver» a Más');
    for (const [nombre, id, previo] of [['candidato', ids.cand, null], ['administrador «Es el candidato» en Modo candidato', ids.admCand, '/app/candidato.html']]) {
      await entrarComo(id);
      if (previo) await ir(previo, 2000);                       // abrir la app del candidato fija el Modo candidato
      await ir('/app/candidato-mas.html', 2800);
      const g = await ev(`(() => { const a = [...document.querySelectorAll('.menu-boton')].find((x) => /Tareas de direcci/.test(x.textContent)); return a ? (a.querySelector('.globo') ? a.querySelector('.globo').textContent : '') : null; })()`);
      ok(g === '2', `${nombre}: «Más» sigue con su tarjeta y el globo 2`, g);
      await ev(`[...document.querySelectorAll('.menu-boton')].find((x) => /Tareas de direcci/.test(x.textContent)).click()`); await espera(2500);
      ok(await visible('#nav-candidato') && !(await existe('#nav-admin')) && await visible('#barra-cand') && !(await visible('#app-barra')), `${nombre}: la pantalla trae la barra y el encabezado del candidato`);
      ok(await ev(`document.querySelectorAll('.tdm-card').length === 3`), `${nombre}: la lista carga las 3 tareas`);
      await clic('#btn-volver-lista'); await espera(2200);
      ok(/^\/app\/candidato-mas\.html/.test(await ruta()), `${nombre}: «volver» regresa a Más`, await ruta());
    }

    console.log('\n[5] Sin permiso: ni tarjeta ni pantalla, y la API da 403');
    for (const [nombre, id, destino] of [['administrador SIN la casilla', ids.admSin, '/app/admin-panel.html'], ['coordinador', ids.coord, '/app/inicio.html'], ['líder', ids.lider, '/app/inicio.html']]) {
      await entrarComo(id); await ir('/app/candidato-tareas.html?volver=/app/inicio.html', 2800);
      const r = await ruta();
      const api = await llamar('/api/tareas-direccion/resumen');
      ok(r.startsWith(destino) && !(await existe('.tdm-card')) && api === 403, `${nombre}: la pantalla lo devuelve a ${destino}, sin tareas, y la API responde 403`, { r, api });
    }
    // Coordinador y líder tampoco ven la tarjeta en su menú de inicio.
    for (const [nombre, id] of [['coordinador', ids.coord], ['líder', ids.lider]]) {
      await entrarComo(id); await ir('/app/inicio.html', 2800);
      ok(!(await ev(`[...document.querySelectorAll('.menu-boton')].some((x) => /Tareas de direcci/.test(x.textContent))`)), `${nombre}: sin «Tareas de dirección» en el menú`);
    }

    console.log('\n[6] Escritorio angosto (800 px, sin emulación de celular): el administrador que cae en /app también la ve');
    await vista(800, 900, false);
    await p.cmd('Emulation.setEmulatedMedia', { features: [] });
    for (const [nombre, id, debe] of [['superadministrador', ids.super, true], ['administrador «Es el candidato»', ids.admCand, true], ['administrador SIN la casilla', ids.admSin, false]]) {
      await entrarComo(id); await ir('/app/admin-panel.html');
      const v = await visible('#tareas-aviso');
      ok(v === debe, `${nombre}: a 800 px la tarjeta ${debe ? 'sale' : 'NO sale'}`, v);
      if (debe) { await clic('#tareas-aviso .tav-todas'); await espera(2500); ok(await visible('#nav-admin') && await existe('.tdm-card') && await sinDesborde(), `${nombre}: a 800 px la pantalla abre con su barra, sin desborde`); }
    }
    await entrarComo(ids.super); await ir('/app/admin-panel.html'); await clic('#tareas-aviso .tav-todas'); await espera(2500); await foto('pantalla-superadmin-800');

    console.log('\n[7] Service worker');
    await vista(390, 844, true);
    await entrarComo(ids.super); await ir('/app/admin-panel.html', 3500); await ir('/app/admin-panel.html', 2500);
    const leerSw = () => ev(`(async () => { const rs = await navigator.serviceWorker.getRegistrations(); const ks = await caches.keys(); const c = await caches.open(ks[0] || 'x'); const a = await c.match('/app/admin-panel.html'); const html = a ? await a.text() : ''; return { controlado: !!navigator.serviceWorker.controller, registros: rs.map((r) => (r.scope + ' ' + (r.active ? r.active.state : 'sin activo'))), caches: ks, tarjeta: html.indexOf('tareas-aviso') >= 0, activo: rs.some((r) => !!r.active) }; })()`);
    let sw = await leerSw();
    for (let i = 0; i < 6 && !sw.controlado; i++) { await ir('/app/admin-panel.html', 2500); sw = await leerSw(); }
    ok(sw.controlado && sw.activo && sw.caches.join() === VERSION_SW && sw.tarjeta, `service worker activo y controlando, caché ${VERSION_SW}, con el panel nuevo guardado`, sw);
    const errs = await ev('window.__errs.slice()');
    ok(errs.length === 0, 'sin errores de consola ni excepciones en la última pantalla', errs);
  } finally {
    navegador.cerrar(); servidor.close();
    await q("DELETE FROM tareas_direccion WHERE titulo LIKE 'PRUEBA120%'");
    await q("DELETE FROM usuarios WHERE numero_identificacion BETWEEN '7200101' AND '7200199' AND es_superadmin = 0");
    await pool.end();
  }
  console.log(fallos ? `\nFALLÓ: ${fallos} de ${pasos} comprobaciones.` : `\nTODO BIEN: ${pasos} de ${pasos} comprobaciones.`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
