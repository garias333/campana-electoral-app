#!/usr/bin/env node
// scripts/probar-menu-tareas-direccion.js — orden 118: «Tareas de dirección» TIENE QUE SALIR EN EL MENÚ DEL SUPERADMINISTRADOR.
//
// Comprueba, en un Chromium REAL y con el service worker ENCENDIDO (la prueba de la orden 116 lo apagaba con setBypassServiceWorker):
//   · /api/auth/me dice `tareas_direccion` con la MISMA función que da el 403 de /api/tareas-direccion (superadministrador, candidato, administrador «Es el candidato»,
//     sesión «solo candidato» → true; administrador sin la casilla, coordinador, líder → false);
//   · el ítem sale debajo de «Panel general» exactamente para esos, y la API responde 200 a ellos y 403 a los demás;
//   · si el servidor es de la versión anterior (/me SIN `tareas_direccion`) el menú cae a la regla del navegador y el superadministrador lo sigue viendo;
//   · un navegador con el service worker estrategia-v233 (y su caché) que recibe el despliegue nuevo ve el ítem en la primera recarga, y queda en v235.
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada118 node scripts/probar-menu-tareas-direccion.js
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
const { execSync } = require('child_process');
const express = require('express');
const pool = require('../config/db');
const { lanzar, espera } = require('./capturas/navegador');
const { crear: crearServidor } = require('./capturas/servidor');

const RAIZ = path.join(__dirname, '..');
const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden118');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];
const SEMILLA = '5ff7ca6';   // el árbol de ANTES de «Tareas de dirección» (service worker estrategia-v233)

(async () => {
  await q("DELETE FROM usuarios WHERE numero_identificacion BETWEEN '7180101' AND '7180199' AND es_superadmin = 0");
  const rolId = async (n) => (await q('SELECT id FROM roles WHERE nombre = ?', [n]))[0].id;
  let ced = 7180100;
  const usuario = async (nombre, rol, extra = {}) => {
    ced++;
    const [r] = await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, password_hash, rol_id, activo, es_candidato) VALUES (?, ?, ?, ?, 'x', ?, 1, ?)`,
      [nombre, String(ced), String(ced), `p${ced}@ejemplo.co`, await rolId(rol), extra.es_candidato ? 1 : 0]);
    return r.insertId;
  };
  const sup = (await q('SELECT id, email FROM usuarios WHERE es_superadmin = 1 LIMIT 1'))[0];
  const ids = {
    super: sup.id, cand: await usuario('Candidato', 'candidato'), admCand: await usuario('Admin Es Candidato', 'admin', { es_candidato: 1 }),
    admSin: await usuario('Admin Sin Casilla', 'admin'), coord: await usuario('Coordinadora', 'coordinador'), lider: await usuario('Lider', 'lider'),
  };
  console.log(`Superadministrador de la base de prueba: id ${sup.id}, ${sup.email}`);

  // El árbol viejo (service worker v233) para el escenario de despliegue.
  const viejo = path.join(os.homedir(), '.cache', 'probar118-arbol-viejo');
  fs.rmSync(viejo, { recursive: true, force: true }); fs.mkdirSync(viejo, { recursive: true });
  execSync(`git -C ${JSON.stringify(RAIZ)} archive ${SEMILLA} public | tar -x -C ${JSON.stringify(viejo)}`);
  let estaticos = express.static(path.join(RAIZ, 'public'), { maxAge: '10m' });   // como app.js: 10 minutos de caché HTTP
  const externo = express();
  externo.use((req, res, next) => estaticos(req, res, next));
  externo.use(crearServidor(pool, { soloLecturaCandidato: true }));
  const servidor = http.createServer(externo);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const navegador = await lanzar();
  try {
    const p = await navegador.pagina('about:blank');
    await p.cmd('Network.setBypassServiceWorker', { bypass: false });   // EL SERVICE WORKER ENCENDIDO
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    const entrarComo = async (id, extra) => {
      await p.cmd('Network.deleteCookies', { name: 'ej_solo_candidato', url: base });
      await p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(id), url: base });
      if (extra) await p.cmd('Network.setCookie', { name: extra, value: '1', url: base });
    };
    const ir = async (ruta, ms = 2500) => { await p.cmd('Page.navigate', { url: base + ruta }); await espera(ms); };
    const ev = (x) => p.ev(x);
    const menuAhora = () => ev(`(() => { const a = [...document.querySelectorAll('a[data-nav-href]')]; const i = a.findIndex((x) => x.dataset.navHref === '/tareas-direccion.html'); return { total: a.length, esta: i >= 0, antes: i > 0 ? a[i - 1].textContent.trim() : null, texto: i >= 0 ? a[i].textContent.trim() : null }; })()`);
    const menu = async () => { for (let i = 0; i < 40; i++) { if (await ev(`!!document.querySelector('a[data-nav-href="/dashboard.html"]')`)) break; await espera(250); } await espera(300); return menuAhora(); };
    const llamar = (ruta) => ev(`fetch(${JSON.stringify(ruta)}).then((r) => r.status)`);

    console.log('\n[1] /api/auth/me, el menú y la API, por rol (service worker encendido)');
    const casos = [
      ['superadministrador (rol admin + es_superadmin)', ids.super, null, true], ['candidato', ids.cand, null, true], ['administrador «Es el candidato»', ids.admCand, null, true],
      ['administrador «Es el candidato» en sesión «solo candidato»', ids.admCand, 'ej_solo_candidato', true],
      ['administrador SIN la casilla', ids.admSin, null, false], ['coordinador', ids.coord, null, false], ['líder', ids.lider, null, false],
    ];
    for (const [nombre, id, extra, debe] of casos) {
      await entrarComo(id, extra); await ir('/dashboard.html', 2200);
      const me = await ev(`fetch('/api/auth/me').then((r) => r.json()).then((j) => j.usuario.tareas_direccion)`);
      const m = await menu();
      const api = await llamar('/api/tareas-direccion/resumen');
      if (debe) ok(me === true && m.esta && /PANEL GENERAL/i.test(m.antes) && /TAREAS DE DIRECCI/i.test(m.texto) && api === 200, `${nombre}: /me dice true, el ítem sale debajo de «Panel general» y la API responde 200`, { me, m, api });
      else ok(me === false && !m.esta && api === 403, `${nombre}: /me dice false, el ítem NO sale y la API responde 403`, { me, m, api });
    }
    // La página abre para el superadministrador.
    await entrarComo(ids.super); await ir('/tareas-direccion.html', 2800);
    ok(await ev(`!document.querySelector('#sin-acceso') || getComputedStyle(document.getElementById('sin-acceso')).display === 'none'`) && await ev(`document.querySelectorAll('.td-col').length === 3`), 'la página «Tareas de dirección» abre para el superadministrador (tres columnas, sin «no es suya»)');

    console.log('\n[2] Un servidor de la versión anterior (/me SIN `tareas_direccion`): el menú cae a la regla del navegador');
    await p.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const f = window.fetch; window.fetch = async function (u, o) { const r = await f.apply(this, arguments); if (String(u).indexOf('/api/auth/me') !== -1) { const j = await r.clone().json(); if (j && j.usuario) delete j.usuario.tareas_direccion; return new Response(JSON.stringify(j), { status: r.status, headers: { 'Content-Type': 'application/json' } }); } return r; }; })();` });
    for (const [nombre, id, extra, debe] of [['superadministrador', ids.super, null, true], ['candidato', ids.cand, null, true], ['administrador «Es el candidato»', ids.admCand, null, true], ['administrador sin la casilla', ids.admSin, null, false], ['coordinador', ids.coord, null, false]]) {
      await entrarComo(id, extra); await ir('/dashboard.html', 2200);
      const visto = await ev(`fetch('/api/auth/me').then((r) => r.json()).then((j) => 'tareas_direccion' in j.usuario)`);
      const m = await menu();
      ok(visto === false && m.esta === debe, `${nombre}: sin el dato del servidor ${debe ? 'el ítem sale' : 'el ítem NO sale'}`, { visto, m });
    }

    console.log('\n[3] Despliegue sobre un navegador con el service worker v233 y su caché');
    const p2 = await navegador.pagina('about:blank');
    await p2.cmd('Network.setBypassServiceWorker', { bypass: false });
    await p2.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await p2.cmd('Network.setCookie', { name: 'ej_usuario', value: String(ids.super), url: base });
    estaticos = express.static(path.join(viejo, 'public'), { maxAge: '10m' });   // el servidor AÚN sirve la versión anterior
    const ir2 = async (ruta, ms) => { await p2.cmd('Page.navigate', { url: base + ruta }); await espera(ms); };
    const estado = () => p2.ev(`(async () => { let r = null; try { r = await navigator.serviceWorker.getRegistration(); } catch (e) {} const ks = await caches.keys(); const c = await fetch('/js/common.js').then((x) => x.text()); return { sw: !!(r && r.active), controlado: !!navigator.serviceWorker.controller, caches: ks, item: !!document.querySelector('a[data-nav-href="/tareas-direccion.html"]'), commonNuevo: c.includes('soloDireccion') }; })()`);
    await ir2('/login.html', 3500); await ir2('/dashboard.html', 3500);
    const antes = await estado();
    ok(antes.sw && antes.controlado && antes.caches.join() === 'estrategia-v233' && !antes.item && !antes.commonNuevo, 'antes del despliegue: service worker v233 activo, caché v233 y sin el ítem', antes);
    estaticos = express.static(path.join(RAIZ, 'public'), { maxAge: '10m' });     // ← el despliegue
    await ir2('/dashboard.html', 4500);
    const primera = await estado();
    ok(primera.item && primera.commonNuevo, 'tras el despliegue, la PRIMERA recarga normal ya muestra el ítem (sin borrar caché)', primera);
    ok(primera.caches.join() === 'estrategia-v235', 'y el service worker queda en estrategia-v235, sin rastro de la v233', primera.caches);
    await ir2('/dashboard.html', 3000);
    ok((await estado()).item, 'la segunda recarga también lo muestra');
    p2.cerrar();

    console.log('\n[4] Captura');
    const p3 = await navegador.pagina('about:blank');
    await p3.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await p3.cmd('Network.setCookie', { name: 'ej_usuario', value: String(ids.super), url: base });
    await p3.cmd('Page.navigate', { url: base + '/dashboard.html' }); await espera(3500);
    const r = await p3.cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SALIDA, 'menu-superadmin-1280.png'), Buffer.from(r.result.data, 'base64'));
    console.log('  captura: ' + path.join(SALIDA, 'menu-superadmin-1280.png'));
  } finally {
    navegador.cerrar(); servidor.close();
    fs.rmSync(viejo, { recursive: true, force: true });
    await q("DELETE FROM usuarios WHERE numero_identificacion BETWEEN '7180101' AND '7180199' AND es_superadmin = 0");
    await pool.end();
  }
  console.log(fallos ? `\nFALLÓ: ${fallos} de ${pasos} comprobaciones.` : `\nTODO BIEN: ${pasos} de ${pasos} comprobaciones.`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
