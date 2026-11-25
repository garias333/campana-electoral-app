#!/usr/bin/env node
// scripts/probar-permisos-orden.js — orden 124: ASIGNACIÓN DE PERMISOS, COLUMNAS EN ORDEN ALFABÉTICO Y «CONFIGURACIÓN» AL FINAL.
//
// Chromium REAL sobre /configuracion.html#permisos como administrador:
//   · los encabezados salen en orden alfabético español (sin distinguir tildes ni mayúsculas) y «Configuración» de última;
//   · son los MISMOS módulos que entrega el servidor (ninguno de más ni de menos) y el servidor sigue entregándolos en su orden de siempre;
//   · cada casilla sigue debajo de su encabezado: el `data-modulo` de cada celda es el del módulo de su columna;
//   · marcar y desmarcar casillas de DOS columnas distintas, guardar y recargar: se guardó en el módulo correcto y en ningún otro.
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada124 node scripts/probar-permisos-orden.js
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) { console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`); process.exit(2); }
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';

const http = require('http');
const path = require('path');
const express = require('express');
const pool = require('../config/db');
const { lanzar, espera } = require('./capturas/navegador');
const { crear: crearServidor } = require('./capturas/servidor');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 900) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];

(async () => {
  const [adm] = await q("SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.nombre = 'admin' AND u.es_superadmin = 0 LIMIT 1");
  const admin = adm ? adm.id : (await q('SELECT id FROM usuarios WHERE es_superadmin = 1 LIMIT 1'))[0].id;

  const externo = express();
  externo.use(crearServidor(pool));
  const servidor = http.createServer(externo);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const navegador = await lanzar();
  try {
    const p = await navegador.pagina('about:blank');
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(admin), url: base });
    const ir = async () => { await p.cmd('Page.navigate', { url: base + '/configuracion.html#permisos' }); await espera(2500); await p.ev(`document.getElementById('btn-tab-permisos') && document.getElementById('btn-tab-permisos').click()`); await espera(1500); };

    console.log('\n[1] Orden de los encabezados');
    await ir();
    const enc = await p.ev(`[...document.querySelectorAll('#permisos-encabezado th')].slice(1).map((th) => th.childNodes[0].textContent.trim())`);
    const servidorMods = await p.ev(`fetch('/api/permisos/matriz').then((r) => r.json()).then((j) => j.modulos)`);
    ok(enc.length > 20, `la tabla dibuja ${enc.length} columnas`);
    ok(enc[enc.length - 1] === 'Configuración', '«Configuración» es la última columna', enc.slice(-3));
    const resto = enc.slice(0, -1);
    const esperado = [...resto].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    ok(JSON.stringify(resto) === JSON.stringify(esperado), 'las demás van en orden alfabético español (tildes y mayúsculas no cuentan)');
    ok(resto.every((e) => e !== 'Configuración'), 'no queda otra «Configuración» en medio');
    ok(JSON.stringify([...enc].sort()) === JSON.stringify(servidorMods.map((m) => m.etiqueta).sort()), 'son exactamente los módulos que entrega el servidor (ninguno de más ni de menos)');
    ok(servidorMods[0].clave === 'panel_general' && servidorMods[servidorMods.length - 1].clave === 'configuracion', 'el servidor sigue entregando MODULOS en su orden de siempre (el del menú)');
    console.log('  columnas: ' + enc.join(' | '));

    console.log('\n[2] Cada casilla sigue bajo su encabezado');
    const porEtiqueta = Object.fromEntries(servidorMods.map((m) => [m.etiqueta, m.clave]));
    const desajustes = await p.ev(`(() => {
      const claves = ${JSON.stringify(porEtiqueta)};
      const cab = [...document.querySelectorAll('#permisos-encabezado th')].slice(1).map((th) => claves[th.childNodes[0].textContent.trim()]);
      const malas = [];
      document.querySelectorAll('#tbody-permisos tr').forEach((tr) => [...tr.children].slice(1).forEach((td, i) => td.querySelectorAll('input').forEach((c) => { if (c.dataset.modulo !== cab[i]) malas.push(c.dataset.rol + ':' + c.dataset.modulo + ' bajo ' + cab[i]); })));
      return malas; })()`);
    ok(desajustes.length === 0, 'en las 9 filas, el data-modulo de cada casilla es el de su columna', desajustes.slice(0, 5));

    console.log('\n[3] Marcar casillas de dos columnas distintas, guardar y recargar');
    // Se eligen dos módulos lejos uno del otro en la pantalla; el rol «testigo» y el nivel «ver».
    const A = 'agenda', B = 'finanzas';
    const leer = async () => Object.fromEntries((await q("SELECT modulo, permitido FROM permisos_rol WHERE rol = 'testigo' AND modulo IN ('agenda','finanzas','legislacion','tareas')")).map((f) => [f.modulo, f.permitido]));
    const antes = await leer();
    const sel = (m) => `#tbody-permisos input[data-rol="testigo"][data-modulo="${m}"][data-nivel="ver"]`;
    const estado = (m) => p.ev(`document.querySelector(${JSON.stringify(sel(m))}).checked`);
    const guardar = async () => { await p.ev(`document.getElementById('btn-guardar-permisos').click()`); await espera(1500); };
    const posicion = (m) => p.ev(`[...document.querySelectorAll('#tbody-permisos tr')].find((tr) => tr.querySelector('strong').textContent === 'Testigo') && [...[...document.querySelectorAll('#tbody-permisos tr')].find((tr) => tr.querySelector('strong').textContent === 'Testigo').children].findIndex((td) => td.querySelector('[data-modulo="${m}"]'))`);
    ok((await posicion(A)) < (await posicion(B)), `Agenda queda a la izquierda de Finanzas en la pantalla`);
    console.log('  antes en la base (testigo, ver): ' + JSON.stringify(antes));
    const nuevoA = !(await estado(A)), nuevoB = !(await estado(B));
    await p.ev(`document.querySelector(${JSON.stringify(sel(A))}).click(); document.querySelector(${JSON.stringify(sel(B))}).click();`);
    await guardar();
    let ahora = await leer();
    ok(!!ahora[A] === nuevoA && !!ahora[B] === nuevoB, `guardó Agenda=${nuevoA} y Finanzas=${nuevoB} en SUS módulos`, ahora);
    ok(!!ahora.legislacion === !!antes.legislacion && !!ahora.tareas === !!antes.tareas, 'los módulos vecinos no cambiaron', { antes, ahora });
    await ir();
    ok((await estado(A)) === nuevoA && (await estado(B)) === nuevoB, 'tras recargar, las dos casillas siguen como se dejaron');

    // Desmarcar solo una: la otra debe quedar intacta.
    await p.ev(`document.querySelector(${JSON.stringify(sel(A))}).click();`);
    await guardar();
    ahora = await leer();
    ok(!!ahora[A] === !nuevoA && !!ahora[B] === nuevoB, 'desmarcar Agenda no toca Finanzas', ahora);
    // Se restituye lo que había.
    await ir();
    for (const [m, v] of [[A, antes[A]], [B, antes[B]]]) if ((await estado(m)) !== !!v) await p.ev(`document.querySelector(${JSON.stringify(sel(m))}).click()`);
    await guardar();
    ahora = await leer();
    ok(!!ahora[A] === !!antes[A] && !!ahora[B] === !!antes[B], 'se devolvió la base a como estaba');
  } finally {
    navegador.cerrar(); servidor.close(); await pool.end();
  }
  console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTodo en orden.');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
