#!/usr/bin/env node
// scripts/probar-mi-equipo-diseno.js
//
// Prueba de la ORDEN 68 (nuevo diseño de «Mi equipo» en el inicio del coordinador, propuesta 5) EN CHROMIUM REAL (CDP) a 360×800, 390×844 y 430×932:
//   · las situaciones de color (rojo, amarillo, verde, compromiso 0, meta cumplida) con su frase, su semáforo y los colores pedidos;
//   · 0, 1 y varios sublíderes; alerta de 7 días en 0, 1 y varios; el aviso de «Activar los avisos» visible y cerrado; sin señal;
//   · tamaños de letra pedidos, sin desborde horizontal ni textos cortados;
//   · el inicio del LÍDER idéntico antes (HEAD) y ahora: mismas medidas, mismos colores y la misma imagen.
// Saca las capturas.
//
// USO (sobre una base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium: comparten el perfil):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada68 CARPETA_ANTES=/ruta/a/public-de-HEAD [SALIDA=/ruta] node scripts/probar-mi-equipo-diseno.js
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) {
  console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`);
  process.exit(2);
}
if (!process.env.CARPETA_ANTES) { console.error('Falta CARPETA_ANTES (el public/ de HEAD: git archive HEAD public | tar -x -C <carpeta>).'); process.exit(2); }
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const pool = require('../config/db');
const { sembrar, crearApp } = require('./fixtures/coordinadores-celular');
const { sincronizarClaveCelular } = require('../lib/claveCelular');
const { lanzar, espera } = require('./capturas/navegador');

const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden68');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); }
}
async function escuchar(app) {
  const s = http.createServer(app);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { s, base: `http://127.0.0.1:${s.address().port}` };
}

const ANCHOS = [[360, 800], [390, 844], [430, 932]];
const num = (n) => Number(n || 0).toLocaleString('es-CO');
const pct = (p) => Number(p).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' %';
const COLORES = {
  rojo: { fondo: 'rgb(253, 236, 236)', cifra: 'rgb(214, 58, 58)', luz: 'rgb(255, 77, 77)' },
  amarillo: { fondo: 'rgb(255, 244, 204)', cifra: 'rgb(138, 109, 0)', luz: 'rgb(255, 195, 0)' },
  verde: { fondo: 'rgb(230, 246, 236)', cifra: 'rgb(31, 157, 85)', luz: 'rgb(47, 208, 122)' },
};

(async () => {
  const { ids } = await sembrar(pool);
  await sincronizarClaveCelular(pool, ids.coord1);
  await require('./fixtures/encender-complementos')(pool, ['alertas_dia_d']);

  // Foto del estado inicial para volver a él entre situaciones.
  const [estr0] = await pool.query('SELECT id, activo, meta_votos, meta_votos_base FROM estructura');
  const [vot0] = await pool.query('SELECT id, created_at FROM votantes');
  const restaurar = async () => {
    for (const e of estr0) await pool.query('UPDATE estructura SET activo = ?, meta_votos = ?, meta_votos_base = ? WHERE id = ?', [e.activo, e.meta_votos, e.meta_votos_base, e.id]);
    for (const v of vot0) await pool.query('UPDATE votantes SET created_at = ? WHERE id = ?', [v.created_at, v.id]);
  };
  const metas = async (m) => { for (const [k, v] of Object.entries(m)) await pool.query('UPDATE estructura SET meta_votos = ?, meta_votos_base = ? WHERE usuario_id = ? AND cargo = \'lider\'', [v, v, ids[k]]); };
  const baja = (...claves) => pool.query('UPDATE estructura SET activo = 0 WHERE usuario_id IN (?)', [claves.map((k) => ids[k])]);
  const reciente = (clave) => pool.query('UPDATE votantes SET created_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE lider_id = ?', [ids[clave]]);

  const actual = await escuchar(crearApp(pool, undefined, { alertas: true }));
  const antes = await escuchar(crearApp(pool, process.env.CARPETA_ANTES, { alertas: true }));
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: true });
  // Errores de consola: se guardan en la página y se leen después de cada carga.
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; const ce = console.error; console.error = function () { window.__errs.push([].slice.call(arguments).join(' ')); ce.apply(console, arguments); }; window.addEventListener('error', function (e) { window.__errs.push('ERR ' + e.message); });` });
  const errores = [];

  const ancho = async (w, h) => cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  const ir = async (url) => { await cmd('Page.navigate', { url }); await espera(900); };
  const esperar = async (expr, ms = 10000) => {
    const hasta = Date.now() + ms;
    while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); }
    return false;
  };
  const foto = async (nombre, w) => {
    const alto = await ev('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)');
    const r = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: alto, scale: 1 } });
    const buf = Buffer.from(r.result.data, 'base64');
    fs.writeFileSync(path.join(SALIDA, nombre + '.png'), buf);
    return buf;
  };
  const recogerErrores = async (donde) => { try { (await ev('window.__errs || []')).forEach((e) => errores.push(donde + ': ' + e)); } catch (_) { /* página cambiando */ } };

  async function entrar(servidor, ruta, cuerpo) {
    await ir(servidor.base + '/login.html');
    return ev(`fetch('/api/auth/${ruta}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(cuerpo))} }).then(r => r.status)`);
  }
  const coordinador = (servidor) => entrar(servidor, 'login-coordinador', { cedula: '1023456789', clave: '456789' });
  const lider = (servidor) => entrar(servidor, 'login', { email: '1055000001', password: '1055000001' });

  const abrirCoordinador = async (w, h) => {
    await ancho(w, h);
    await ir(actual.base + '/app/inicio.html');
    const listo = await esperar("location.pathname === '/app/inicio.html' && !document.getElementById('panel-coordinador').hidden && document.querySelectorAll('.pc-kpis .pc-k').length === 4", 12000);
    await espera(900);                      // el aviso de avisos llega después
    return listo;
  };

  /** Lo que se ve en el inicio del coordinador, leído del DOM. */
  const leer = () => ev(`(() => {
    const q = (s) => document.querySelector(s); const cs = (e) => e && getComputedStyle(e);
    const rect = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right }; };
    const card = q('#panel-coordinador .pc-card'); const estado = q('.pc-estado'); const frase = q('.pc-estado p');
    const franja = q('#franja-avisos-alertas'); const pie = q('#panel-coordinador .pl-pie') || q('#panel-coordinador .pl-sin-senal');
    const negritas = [...document.querySelectorAll('.pc-estado p b')];
    const luces = [...document.querySelectorAll('.pc-luz i')];
    const todos = [...document.querySelectorAll('#panel-coordinador *')].filter((e) => e.offsetParent !== null);
    return {
      saludo: q('#saludo .hero-saludo').innerText, nombre: q('#saludo .hero-nombre').innerText,
      saludoPx: cs(q('#saludo .hero-saludo')).fontSize, nombrePx: cs(q('#saludo .hero-nombre')).fontSize,
      hayCard: !!card, frase: frase ? frase.innerText.replace(/\\s+/g, ' ').trim() : null, clases: estado ? estado.className : null,
      fraseFondo: estado ? cs(estado).backgroundColor : null, frasePx: frase ? cs(frase).fontSize : null,
      negritaColor: negritas.length ? cs(negritas[0]).color : null, negritas: negritas.map((b) => b.innerText),
      luces: luces.map((i) => ({ on: i.classList.contains('on'), fondo: cs(i).backgroundColor, w: i.getBoundingClientRect().width })),
      kpis: [...document.querySelectorAll('.pc-k')].map((k) => ({ cifra: k.querySelector('b').innerText, texto: k.querySelector('span').innerText.replace(/\\s+/g, ' '), cifraPx: cs(k.querySelector('b')).fontSize, textoPx: cs(k.querySelector('span')).fontSize, borde: cs(k).borderLeftColor, bordePx: cs(k).borderLeftWidth })),
      alerta: q('.pc-alerta') ? { texto: q('.pc-alerta').innerText.replace(/\\s+/g, ' ').trim(), href: q('.pc-alerta').getAttribute('href'), px: cs(q('.pc-alerta')).fontSize, nPx: cs(q('.pc-alerta .pc-n')).fontSize, n: q('.pc-alerta .pc-n').innerText } : null,
      boton: q('.pc-boton') ? { texto: q('.pc-boton').innerText.trim(), href: q('.pc-boton').getAttribute('href'), px: cs(q('.pc-boton')).fontSize, fondo: cs(q('.pc-boton')).backgroundColor } : null,
      franja: franja ? { visible: franja.offsetParent !== null, texto: franja.innerText.replace(/\\s+/g, ' ').trim(), px: cs(franja).fontSize, enCont: !!franja.closest('#panel-coordinador'), top: rect(franja) && rect(franja).top, alto: rect(franja) && (rect(franja).bottom - rect(franja).top) } : null,
      pie: pie ? { texto: pie.innerText.trim(), px: cs(pie).fontSize, align: cs(pie).textAlign, top: rect(pie).top } : null,
      tarjeta: card ? { top: rect(card).top, bottom: rect(card).bottom, radio: cs(card).borderRadius, sombra: cs(card).boxShadow } : null,
      heroBottom: rect(q('.hero-inicio')).bottom,
      desborde: document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1,
      fuera: todos.filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5).map((e) => e.className || e.tagName),
      cortados: todos.filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'inline').map((e) => (e.className || e.tagName) + ':' + e.scrollWidth + '>' + e.clientWidth),
    };
  })()`);

  /** Lo que debería decir la frase, calculado aparte con la regla de la orden, a partir de lo que devuelve el servidor. */
  const esperado = async () => {
    const d = await ev("fetch('/api/coordinador/mis-lideres').then(r => r.json())");
    const r = d.resumen; const R = r.personas_registradas; const C = r.compromiso_total;
    let color; let frase;
    if (!(C > 0)) { color = null; frase = 'Su equipo aún no tiene compromiso de registros.'; }
    else if (R >= C) { color = 'verde'; frase = `¡Su equipo ya cumplió la meta! ${num(R)} de ${num(C)} registros.`; }
    else {
      color = r.porcentaje < 40 ? 'rojo' : (r.porcentaje < 80 ? 'amarillo' : 'verde');
      const F = Math.max(0, C - R);
      frase = `Su equipo va en ${pct(r.porcentaje)} de la meta: ${num(R)} de ${num(C)} registros. ${F === 1 ? 'Falta 1.' : 'Faltan ' + num(F) + '.'}`;
    }
    return { r, color, frase };
  };

  // Cada situación deja la base como se pide y dice qué se espera. `color`: el semáforo que debe encenderse.
  const SITUACIONES = [
    { id: 'rojo', titulo: 'avance ROJO (menos del 40 %)', prep: async () => {}, color: 'rojo', sub: 2, alerta: 2 },
    { id: 'amarillo', titulo: 'avance AMARILLO (40–79 %)', prep: async () => { await metas({ ana: 20, beto: 10, carla: 0, diego: 10 }); }, color: 'amarillo', sub: 2, alerta: 2 },
    { id: 'verde', titulo: 'avance VERDE (80 % o más)', prep: async () => { await metas({ ana: 7, beto: 5, carla: 4, diego: 9 }); }, color: 'verde', sub: 2, alerta: 2 },
    { id: 'compromiso0', titulo: 'compromiso 0 (semáforo apagado)', prep: async () => { await metas({ ana: 0, beto: 0, carla: 0, diego: 0 }); }, color: null, sub: 2, alerta: 2 },
    { id: 'cumplida', titulo: 'meta cumplida (registros ≥ compromiso)', prep: async () => { await metas({ ana: 7, beto: 5, carla: 0, diego: 9 }); }, color: 'verde', sub: 2, alerta: 2 },
    { id: 'sin-sublideres', titulo: 'SIN sublíderes', prep: async () => { await baja('sara', 'tito'); }, color: 'rojo', sub: 0, alerta: 2 },
    { id: 'un-sublider', titulo: 'UN sublíder (singular)', prep: async () => { await baja('tito'); }, color: 'rojo', sub: 1, alerta: 2 },
    { id: 'alerta-1', titulo: 'alerta de 7 días en SINGULAR (1 líder)', prep: async () => { await baja('carla'); }, color: 'rojo', sub: 2, alerta: 1 },
    { id: 'alerta-0', titulo: 'alerta en 0: no se muestra', prep: async () => { await baja('carla'); await reciente('beto'); }, color: 'rojo', sub: 2, alerta: 0 },
  ];

  console.log('\n[1] Las situaciones del coordinador, a 360, 390 y 430 px');
  ok(await coordinador(actual) === 200, 'entra el coordinador');
  for (const s of SITUACIONES) {
    console.log(`\n  — ${s.titulo}`);
    await restaurar(); await s.prep();
    for (const [w, h] of ANCHOS) {
      const donde = `${s.id}@${w}`;
      ok(await abrirCoordinador(w, h), `${donde}: abre el inicio con la tarjeta y las cuatro cifras`);
      const v = await leer(); const e = await esperado();
      await foto(`${s.id}-${w}x${h}`, w);
      await recogerErrores(donde);
      if (w === 390) {
        ok(v.frase === e.frase, `${donde}: la frase es la pedida`, { v: v.frase, e: e.frase });
        ok(e.color === s.color, `${donde}: el servidor da la situación que se quería probar (${s.color || 'sin color'})`, e.color);
      }
      ok(v.frase === e.frase, `${donde}: frase «${v.frase}»`, { v: v.frase, e: e.frase });
      const enc = v.luces.filter((l) => l.on);
      ok(v.luces.length === 3 && enc.length === (s.color ? 1 : 0) && (!s.color || (v.luces[{ rojo: 0, amarillo: 1, verde: 2 }[s.color]].on && v.luces[{ rojo: 0, amarillo: 1, verde: 2 }[s.color]].fondo === COLORES[s.color].luz)),
        `${donde}: semáforo de tres luces, ${s.color ? 'encendida la ' + s.color : 'todas apagadas'}`, v.luces);
      if (s.color) {
        ok(v.fraseFondo === COLORES[s.color].fondo && v.negritaColor === COLORES[s.color].cifra, `${donde}: fondo y negritas en ${s.color}`, { f: v.fraseFondo, n: v.negritaColor });
      } else {
        ok(v.clases.includes('apagado') && v.negritas.length === 0 && v.luces.every((l) => l.fondo === 'rgb(85, 85, 102)'), `${donde}: sin compromiso, gris y sin negritas`, v);
      }
      if (s.id === 'cumplida') ok(v.negritas.length === 1 && /^\d+ de \d+$/.test(v.negritas[0]) && /^¡Su equipo ya cumplió la meta!/.test(v.frase), `${donde}: «¡Su equipo ya cumplió la meta!» con «R de C» en negrita`, v.negritas);
      else if (s.color) ok(v.negritas.length === 3, `${donde}: tres cifras en negrita (X %, R de C, faltan)`, v.negritas);
      // Las cuatro tarjetas
      const k = v.kpis; const r = e.r;
      const etSub = r.sublideres ? ` · ${num(r.sublideres)} ${r.sublideres === 1 ? 'sublíder' : 'sublíderes'}` : '';
      ok(r.sublideres === s.sub, `${donde}: el servidor cuenta ${s.sub} sublíder(es)`, r.sublideres);
      ok(k.length === 4
        && k[0].texto === `${r.lideres_activos === 1 ? 'Líder activo' : 'Líderes activos'}${etSub}` && k[0].cifra === num(r.lideres_activos)
        && k[1].texto === (r.personas_registradas === 1 ? 'Persona registrada' : 'Personas registradas') && k[1].cifra === num(r.personas_registradas)
        && k[2].texto === 'Compromiso total' && k[2].cifra === num(r.compromiso_total)
        && k[3].texto === (r.registros_7_dias === 1 ? 'Registro últimos 7 días' : 'Registros últimos 7 días') && k[3].cifra === num(r.registros_7_dias),
      `${donde}: las cuatro tarjetas con sus cifras y textos`, k);
      ok(k.length === 4 && k.every((t) => t.cifraPx === '36px' && t.textoPx === '15px' && t.bordePx === '5px'), `${donde}: cifra 36 px, texto 15 px, borde izquierdo 5 px`, k.map((t) => [t.cifraPx, t.textoPx, t.bordePx]));
      ok(k.length === 4 && k[0].borde === 'rgb(11, 94, 215)' && k[1].borde === 'rgb(8, 66, 152)' && k[2].borde === 'rgb(255, 195, 0)' && k[3].borde === 'rgb(31, 157, 85)', `${donde}: colores de borde azul, azul oscuro, amarillo, verde`, k.map((t) => t.borde));
      // Alerta
      if (s.alerta === 0) ok(v.alerta === null, `${donde}: sin alerta cuando es 0`, v.alerta);
      else ok(v.alerta && v.alerta.n === String(s.alerta) && v.alerta.texto === `${s.alerta} ${s.alerta === 1 ? 'líder lleva' : 'líderes llevan'} 7 días o más sin registrar ›` && v.alerta.href === '/app/mis-lideres.html?filtro=sin7' && v.alerta.px === '17px' && v.alerta.nPx === '22px',
        `${donde}: alerta «${s.alerta} ${s.alerta === 1 ? 'líder lleva' : 'líderes llevan'} 7 días…», mismo filtro, 17 px y número de 22 px`, v.alerta);
      ok(v.boton && v.boton.texto === 'Ver mis líderes' && v.boton.href === '/app/mis-lideres.html' && v.boton.px === '21px' && v.boton.fondo === 'rgb(255, 195, 0)', `${donde}: botón amarillo «Ver mis líderes» de 21 px`, v.boton);
      // Encabezado, estado, aviso y pie
      ok(v.saludo === 'Hola,' && v.saludoPx === '17px' && v.nombrePx === '30px' && /Marta/.test(v.nombre), `${donde}: encabezado «Hola,» 17 px y el nombre a 30 px`, [v.saludo, v.saludoPx, v.nombrePx]);
      ok(v.frasePx === '19px' && v.tarjeta.radio === '22px' && v.tarjeta.top < v.heroBottom && v.tarjeta.bottom > v.heroBottom, `${donde}: frase de 19 px y tarjeta de 22 px montada sobre el encabezado`, { f: v.frasePx, r: v.tarjeta.radio, t: v.tarjeta.top, h: v.heroBottom });
      ok(v.franja && v.franja.visible && v.franja.enCont && v.franja.px === '15px' && /Activar los avisos del día de la elección/.test(v.franja.texto) && /Activar ×$/.test(v.franja.texto) && v.franja.top >= v.tarjeta.bottom && v.pie && v.pie.top >= v.franja.top + v.franja.alto - 1,
        `${donde}: el aviso va DEBAJO de la tarjeta, compacto (15 px) y «Actualizado» debajo de todo`, { franja: v.franja, tarjeta: v.tarjeta, pie: v.pie });
      ok(v.pie && /^Actualizado a las \d\d:\d\d/.test(v.pie.texto) && v.pie.px === '15px' && v.pie.align === 'right', `${donde}: «${v.pie && v.pie.texto}» a la derecha, 15 px`, v.pie);
      ok(!v.desborde && v.fuera.length === 0 && v.cortados.length === 0, `${donde}: sin desborde, nada se sale de la pantalla ni queda cortado`, { d: v.desborde, f: v.fuera, c: v.cortados });
    }
  }

  console.log('\n[2] El aviso «Activar los avisos»: cerrado y comportamiento de hoy');
  await restaurar();
  await ancho(390, 844);
  await abrirCoordinador(390, 844);
  const antesCerrar = await leer();
  ok(antesCerrar.franja && antesCerrar.franja.visible, 'visible la primera vez');
  const destino = await ev("document.getElementById('enlace-activar-avisos-corto').getAttribute('href')");
  ok(destino === '#caja-avisos-push' && await ev("!!document.getElementById('caja-avisos-push')"), '«Activar» lleva a la casilla de avisos de esta misma pantalla (como el enlace de hoy)', destino);
  await ev("document.getElementById('cerrar-franja-avisos').click()");
  await espera(200);
  ok(await ev("localStorage.getItem('franja_avisos_alertas_cerrada')") === '1' && !(await leer()).franja.visible, 'la × la cierra y lo recuerda en este celular');
  await foto('aviso-cerrado-390x844', 390);
  await ir(actual.base + '/app/inicio.html'); await esperar("!document.getElementById('panel-coordinador').hidden"); await espera(900);
  const cerrado = await leer();
  ok(!cerrado.franja.visible && cerrado.pie && cerrado.tarjeta, 'recargada: el aviso sigue cerrado y la tarjeta y «Actualizado» siguen en su sitio');
  ok(!cerrado.desborde, 'sin desborde con el aviso cerrado');
  await ev("localStorage.removeItem('franja_avisos_alertas_cerrada')");

  console.log('\n[3] Sin señal, con los datos guardados');
  for (const [w, h] of ANCHOS) {
    await restaurar();
    await abrirCoordinador(w, h);
    await cmd('Network.setBlockedURLs', { urls: ['*/api/*'] });
    await ev('PanelCoordinador.recargar()'); await espera(900);
    const v = await leer();
    ok(v.hayCard && v.kpis.length === 4 && v.pie && /^Sin señal: esta es la copia de las \d\d:\d\d.*Solo puede mirarla\.$/.test(v.pie.texto) && v.pie.px === '15px', `sin señal@${w}: la tarjeta sale de la copia guardada, con el aviso «Sin señal» (15 px)`, v.pie);
    ok(v.frase && /^Su equipo va en/.test(v.frase) && !v.desborde && v.cortados.length === 0 && v.fuera.length === 0, `sin señal@${w}: la frase y las cifras de la copia, sin desborde`, v.frase);
    if (w === 390) await foto('sin-senal-390x844', w);
    await cmd('Network.setBlockedURLs', { urls: [] });
    await recogerErrores('sin-senal@' + w);
  }

  console.log('\n[4] Un coordinador SIN líderes a su cargo');
  await restaurar();
  await pool.query('UPDATE estructura SET activo = 0 WHERE supervisor_id = ?', [ids.coord1]);
  await abrirCoordinador(390, 844).catch(() => {});
  await esperar("!document.getElementById('panel-coordinador').hidden && !!document.querySelector('.pl-vacio')", 8000);
  const vacio = await ev("({ texto: document.querySelector('#panel-coordinador .pc-card') ? document.querySelector('#panel-coordinador .pc-card').innerText : null, boton: !!document.querySelector('.pc-boton'), desborde: document.documentElement.scrollWidth > innerWidth + 1 })");
  ok(vacio.texto === 'Todavía no tiene líderes a su cargo.' && !vacio.boton && !vacio.desborde, 'sin líderes: «Todavía no tiene líderes a su cargo.» y sin botón', vacio);
  await foto('sin-lideres-390x844', 390);
  await restaurar();

  console.log('\n[5] El inicio del LÍDER: idéntico antes (HEAD) y ahora');
  await ancho(390, 844);
  const inicioLider = async (servidor, nombre) => {
    ok(await lider(servidor) === 200, `líder entra (${nombre})`);
    await ir(servidor.base + '/app/inicio.html');
    await esperar("location.pathname === '/app/inicio.html' && !document.getElementById('panel-lider').hidden", 12000);
    await espera(1200);
    // En esta base el líder no tiene el módulo de alertas, así que el aviso no sale solo: se fuerza a la vista (igual en las dos versiones) para comparar su aspecto.
    await ev("document.getElementById('franja-avisos-alertas').style.display = 'block'");
    await ev("document.querySelectorAll('.pl-pie').forEach((e) => { e.textContent = 'Actualizado a las 00:00'; })");   // la hora cambia de un minuto a otro
    const medidas = await ev(`(() => {
      const cs = (e) => { const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return [e.id || e.className || e.tagName, c.display, c.fontSize, c.fontWeight, c.color, c.backgroundColor, c.borderTopColor, c.borderTopWidth, c.borderRadius, c.padding, c.margin, Math.round(r.top + scrollY), Math.round(r.left), Math.round(r.width), Math.round(r.height)].join('|'); };
      const sel = ['.hero-inicio', '#saludo', '.hero-saludo', '.hero-nombre', '#panel-lider', '#panel-lider .pl-tarjeta', '#franja-avisos-alertas', '#franja-avisos-alertas strong', '#enlace-activar-avisos', '#cerrar-franja-avisos', '#panel-coordinador', '#menu-app', '.cuerpo-inicio'];
      const out = {}; sel.forEach((s) => { const e = document.querySelector(s); out[s] = e ? cs(e) : null; });
      return { out, saludo: document.querySelector('#saludo').innerText, franjaVisible: document.getElementById('franja-avisos-alertas').offsetParent !== null,
        franjaTexto: document.getElementById('franja-avisos-alertas').innerText.replace(/\\s+/g, ' ').trim(), tarjetas: [...document.querySelectorAll('#panel-lider .pl-tarjeta')].map((t) => t.innerText.replace(/\\s+/g, ' ')),
        menu: [...document.querySelectorAll('#menu-app .menu-boton strong')].map((e) => e.innerText), coordOculto: document.getElementById('panel-coordinador').hidden, clases: document.body.className };
    })()`);
    await recogerErrores('lider-' + nombre);
    const png = await foto(`lider-${nombre}-390x844`, 390);
    return { medidas, png };
  };
  const lAntes = await inicioLider(antes, 'antes');
  const lAhora = await inicioLider(actual, 'despues');
  ok(lAntes.medidas.franjaVisible && lAhora.medidas.franjaVisible, 'el aviso del líder (puesto a la vista en las dos versiones) se ve antes y ahora', [lAntes.medidas.franjaVisible, lAhora.medidas.franjaVisible]);
  ok(/Activa los avisos para el día de la elección\./.test(lAhora.medidas.franjaTexto) && !/Activar los avisos del día de la elección ×/.test(lAhora.medidas.franjaTexto) === true, 'y sigue con su texto largo (no la versión compacta)', lAhora.medidas.franjaTexto);
  ok(lAntes.medidas.franjaTexto === lAhora.medidas.franjaTexto.replace('🔔', '').replace(/\s+/g, ' ').trim() || lAntes.medidas.franjaTexto === lAhora.medidas.franjaTexto, 'mismo texto visible del aviso del líder', [lAntes.medidas.franjaTexto, lAhora.medidas.franjaTexto]);
  const dif = Object.keys(lAntes.medidas.out).filter((k) => lAntes.medidas.out[k] !== lAhora.medidas.out[k]);
  ok(dif.length === 0, `el líder: mismas medidas, colores, tamaños y posiciones en ${Object.keys(lAntes.medidas.out).length} elementos (inicio, saludo, tarjeta, aviso, menú)`, dif.map((k) => [k, lAntes.medidas.out[k], lAhora.medidas.out[k]]));
  ok(lAntes.medidas.saludo === lAhora.medidas.saludo && JSON.stringify(lAntes.medidas.tarjetas) === JSON.stringify(lAhora.medidas.tarjetas) && JSON.stringify(lAntes.medidas.menu) === JSON.stringify(lAhora.medidas.menu), 'mismos textos: saludo, tarjetas del panel y menú');
  ok(lAhora.medidas.coordOculto && !/inicio-coordinador/.test(lAhora.medidas.clases), 'el líder no recibe la clase del coordinador ni su tarjeta');
  ok(Buffer.compare(lAntes.png, lAhora.png) === 0, 'la imagen del inicio del líder es IDÉNTICA píxel por píxel (antes y ahora)', { antes: lAntes.png.length, ahora: lAhora.png.length });

  console.log('\n[6] La consola');
  ok(p.avisos.length === 0, 'ninguna excepción de JavaScript en toda la prueba', p.avisos);
  ok(errores.length === 0, 'ningún console.error ni error de página', errores.slice(0, 5));
  const raros = p.respuestas.filter((r) => r.status >= 400 && !/\/api\/auth\/(me|login-coordinador|login)\b/.test(r.url) && !/favicon/.test(r.url) && !(r.status === 0 && /api/.test(r.url)));
  ok(raros.length === 0, 'ninguna respuesta de error inesperada', raros.slice(0, 5));

  nav.cerrar(); actual.s.close(); antes.s.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO BIEN'} (${pasos} comprobaciones). Capturas en ${SALIDA}`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
