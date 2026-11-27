#!/usr/bin/env node
// scripts/probar-conteo-campos-totales.js
//
// ORDEN 136: «Reportar conteo de mi mesa» (public/app/dia-d.html) con CAMPOS QUE SE DISTINGAN del título y
// TOTAL VOTANTES / TOTAL VOTOS EN LA MESA en mayúsculas, negrita y más grandes, con el campo al frente.
// EN CHROMIUM REAL, con las rutas reales de /api/dia-d y la sesión de una testigo del arnés de capturas, a 390×844 y 360×740:
//   · campos (Departamento, Municipio, Puesto, Mesa, Total votantes, votos, Total votos): fondo #FFFFFF, borde 1,5 px #9DB4D9, texto 16 px
//     #1A1A1A; el total calculado (disabled) con fondo #EEF2F8; al enfocar, borde 2 px #0B5ED7 y sombra 0 0 0 3px rgba(11,94,215,.15);
//     placeholder #8A94A6; casillas de mesa de 22 px con borde #9DB4D9;
//   · títulos de la izquierda: 700, #084298, 15 px;
//   · TOTAL VOTANTES y TOTAL VOTOS EN LA MESA: en mayúsculas, 17 px, peso 800, #084298; campo de 52 px con el número en 20 px negrita; el
//     left y el ancho de sus campos coinciden (±1 px) con los de Departamento; «TOTAL VOTOS EN LA MESA» con raya de 2 px #0B5ED7 arriba;
//   · votos de cada candidato: 96 px de ancho, mismo left en todas las filas, pegados a la derecha, número de 18 px;
//   · el total se actualiza al escribir votos; enviar un reporte sigue llegando igual; cero errores de consola.
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada136 [SALIDA=/ruta] node scripts/probar-conteo-campos-totales.js
require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) { console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`); process.exit(2); }
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const pool = require('../config/db');
const { sembrar } = require('./capturas/semilla');
const { crear } = require('./capturas/servidor');
const { lanzar, espera } = require('./capturas/navegador');

const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden136');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];
const cerca = (a, b, tol = 1) => Math.abs(a - b) <= tol;

const AZUL_OSC = 'rgb(8, 66, 152)'; const AZUL = 'rgb(11, 94, 215)'; const BORDE = 'rgb(157, 180, 217)';
const BLANCO = 'rgb(255, 255, 255)'; const GRIS_AZUL = 'rgb(238, 242, 248)'; const TINTA = 'rgb(26, 26, 26)';

/** Mide, desde dentro de la página, estilo y caja de cada pieza del formulario. */
const MEDIR = `(() => {
  const r = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, width: b.width, height: b.height }; };
  const est = (e) => { const c = getComputedStyle(e); return { fondo: c.backgroundColor, borde: c.borderTopColor, bordeAncho: c.borderTopWidth, fuente: c.fontSize, peso: c.fontWeight,
    color: c.color, alto: c.height, transf: c.textTransform, sombra: c.boxShadow, alinea: c.textAlign }; };
  const por = (id) => document.getElementById(id);
  const campo = (id) => ({ ...est(por(id)), caja: r(por(id)) });
  const tit = (sel) => { const l = document.querySelector(sel); return { ...est(l), caja: r(l), texto: l.textContent.trim(), lineas: Math.round(l.getBoundingClientRect().height / parseFloat(getComputedStyle(l).lineHeight)) }; };
  const votos = [...document.querySelectorAll('#tbody-votos-candidatos input[data-candidato]')].map((i) => ({ ...est(i), caja: r(i) }));
  const fila = por('campo-total-votos-mesa');
  const cs = getComputedStyle(fila);
  const sel = por('f-puesto-select');
  const cas = [...document.querySelectorAll('.chk-mesa-coordinador')].map((i) => ({ ...est(i), caja: r(i) }));
  const sonda = document.createElement('div'); sonda.style.cssText = 'border:1.5px solid red;width:10px;height:10px;position:absolute'; document.body.appendChild(sonda); const b15 = getComputedStyle(sonda).borderTopWidth; sonda.remove();
  return { b15, dpr: devicePixelRatio, ancho: innerWidth, desborde: document.documentElement.scrollWidth - innerWidth,
    dep: campo('f-departamento'), mun: campo('f-municipio'), puesto: { ...est(sel), caja: r(sel) }, mesa: por('f-mesa') ? campo('f-mesa') : null,
    totVotantes: campo('f-total-votantes'), totVotos: campo('f-total-votos-mesa'), novedad: campo('f-novedad'), votos, cas,
    tDep: tit('label[for="f-departamento"]'), tMun: tit('label[for="f-municipio"]'), tPuesto: tit('label[for="f-puesto-select"]'), tMesa: tit('label[for="f-mesa"]'),
    tTotVotantes: tit('label[for="f-total-votantes"]'), tTotVotos: tit('#rotulo-total-votos'),
    rayaVotos: { ancho: cs.borderTopWidth, color: cs.borderTopColor, estilo: cs.borderTopStyle, top: r(fila).top },
    ultimoVoto: votos.length ? votos[votos.length - 1].caja : null };
})()`;

(async () => {
  const ids = await sembrar(pool);
  const [[p0]] = await pool.query("SELECT id FROM dia_d_puestos_votacion WHERE nombre = 'I.E. Ejemplo Norte'");
  const ponerTestigo = async (tipo, mesas) => {
    await q('UPDATE estructura SET tipo_testigo = ?, mesas_asignadas = ?, puesto_id = ?, puesto_votacion = ?, mesa_votacion = ? WHERE usuario_id = ?',
      [tipo, JSON.stringify(mesas), p0.id, 'I.E. Ejemplo Norte', tipo === 'mesa' ? 1 : null, ids.testigo]);
  };

  const s = http.createServer(crear(pool));
  await new Promise((r2) => s.listen(0, '127.0.0.1', r2));
  const base = `http://127.0.0.1:${s.address().port}`;
  const dirUp = path.join(__dirname, '..', 'uploads', 'dia-d');
  const antes = new Set(fs.existsSync(dirUp) ? fs.readdirSync(dirUp) : []);

  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; const ce = console.error; console.error = function () { window.__errs.push([].slice.call(arguments).join(' ')); ce.apply(console, arguments); }; window.addEventListener('error', function (e) { window.__errs.push('ERR ' + e.message); });` });
  await cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
  const errores = [];
  const recoger = async (donde) => { try { (await ev('window.__errs || []')).forEach((e) => errores.push(donde + ': ' + e)); } catch (_) { /* página cambiando */ } };
  const encuadre = (w, h) => cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  const esperar = async (expr, ms = 12000) => {
    const hasta = Date.now() + ms;
    while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); }
    return false;
  };
  async function abrir(w, h) {
    await encuadre(w, h);
    await cmd('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' });
    await cmd('Network.clearBrowserCookies');
    await cmd('Network.setCookie', { name: 'ej_usuario', value: String(ids.testigo), url: base });
    await cmd('Page.navigate', { url: base + '/app/dia-d.html' });
    const listo = await esperar("document.getElementById('pantalla-contenido') && document.getElementById('pantalla-contenido').style.display === 'block'");
    await espera(500);
    return listo;
  }
  /** Captura un tramo de la página, de `desde` a `hasta` (ids o selectores), a 390 px de ancho. */
  async function foto(nombre, selDesde, selHasta) {
    // La barra de abajo (con «Enviar reporte») es fija y se pinta encima de lo que quede detrás al capturar la
    // página entera: se esconde SOLO durante la captura y se devuelve después. No afecta a nada de lo medido.
    await ev(`document.querySelectorAll('.barra-fija-app').forEach((b) => { b.dataset.vis = b.style.visibility; b.style.visibility = 'hidden'; })`);
    const caja = await ev(`(() => { const a = document.querySelector(${JSON.stringify(selDesde)}).getBoundingClientRect(); const b = document.querySelector(${JSON.stringify(selHasta)}).getBoundingClientRect();
      return { y: a.top + scrollY - 8, h: b.bottom - a.top + 16 }; })()`);
    const r3 = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: Math.max(0, caja.y), width: 390, height: caja.h, scale: 1 } });
    fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r3.result.data, 'base64'));
    await ev(`document.querySelectorAll('.barra-fija-app').forEach((b) => { b.style.visibility = b.dataset.vis || ''; })`);
  }

  function revisar(m, e) {
    const campos = [['Departamento', m.dep], ['Municipio', m.mun], ['Total votantes', m.totVotantes], ['Novedad', m.novedad]];
    if (m.mesa) campos.push(['Mesa', m.mesa]);
    campos.push(['Puesto', m.puesto]);
    ok(campos.every(([, c]) => c.fondo === BLANCO && c.borde === BORDE && c.bordeAncho === m.b15 && c.color === TINTA && parseFloat(c.fuente) >= 16),
      `${e}: campos escribibles con fondo #FFFFFF, borde 1,5 px (=${m.b15} en este arnés) #9DB4D9, texto #1A1A1A de 16 px o más`, campos.map(([n, c]) => [n, c.fondo, c.borde, c.bordeAncho, c.color, c.fuente]));
    ok(m.votos.length > 0 && m.votos.every((c) => c.fondo === BLANCO && c.borde === BORDE && c.bordeAncho === m.b15 && parseFloat(c.fuente) === 18),
      `${e}: los ${m.votos.length} campos de votos con fondo blanco, borde 1,5 px #9DB4D9 y número de 18 px`, m.votos.slice(0, 2));
    ok(m.totVotos.fondo === GRIS_AZUL && m.totVotos.borde === BORDE && m.totVotos.bordeAncho === m.b15,
      `${e}: el total calculado (solo lectura) con el mismo borde y fondo #EEF2F8`, m.totVotos);
    for (const [clave, nombre] of [['tDep', 'Departamento'], ['tMun', 'Municipio'], ['tPuesto', 'Puesto de votación'], ['tMesa', 'Mesa']]) {
      const t = m[clave];
      if (!t || (clave === 'tMesa' && !m.mesa)) continue;
      ok(t.texto === nombre && t.fuente === '15px' && Number(t.peso) >= 700 && t.color === AZUL_OSC, `${e}: título «${nombre}» en 15 px, negrita ${t.peso}, #084298`, t);
    }
    for (const [clave, texto, campo] of [['tTotVotantes', 'TOTAL VOTANTES', 'totVotantes'], ['tTotVotos', 'TOTAL VOTOS EN LA MESA', 'totVotos']]) {
      const t = m[clave]; const c = m[campo];
      ok(t.texto === texto && t.transf === 'uppercase' && t.fuente === '17px' && Number(t.peso) >= 700 && t.peso === '800' && t.color === AZUL_OSC,
        `${e}: título «${texto}» en mayúsculas, 17 px, peso ${t.peso}, #084298 (${t.lineas} línea/s)`, t);
      ok(cerca(c.caja.height, 52, 0.6) && c.fuente === '20px' && Number(c.peso) >= 700 && c.alinea === 'right', `${e}: campo de «${texto}» de 52 px (${c.caja.height.toFixed(1)}) con el número en 20 px negrita`, c);
      ok(cerca(c.caja.left, m.dep.caja.left) && cerca(c.caja.width, m.dep.caja.width), `${e}: el campo de «${texto}» tiene el mismo left y ancho que Departamento (${c.caja.left.toFixed(1)} / ${c.caja.width.toFixed(1)})`, [c.caja, m.dep.caja]);
      ok(cerca(t.caja.left, m.tDep.caja.left), `${e}: y su título arranca en el mismo left que el de Departamento`, [t.caja.left, m.tDep.caja.left]);
      ok(t.caja.left + t.caja.width <= c.caja.left + 1, `${e}: el título no invade el campo`, [t.caja, c.caja]);
    }
    ok(m.rayaVotos.ancho === '2px' && m.rayaVotos.color === AZUL && m.rayaVotos.estilo === 'solid', `${e}: línea de 2 px #0B5ED7 arriba de «TOTAL VOTOS EN LA MESA»`, m.rayaVotos);
    ok(m.rayaVotos.top > m.ultimoVoto.top, `${e}: la fila del total queda debajo de las filas de candidatos`, [m.rayaVotos.top, m.ultimoVoto.top]);
    const v0 = m.votos[0].caja;
    ok(m.votos.every((c) => cerca(c.caja.width, 96, 0.6) && cerca(c.caja.left, v0.left) && cerca(c.caja.right, v0.right)), `${e}: votos de 96 px, mismo left y mismo borde derecho en las ${m.votos.length} filas`, m.votos.map((c) => [c.caja.left, c.caja.width]));
    ok(m.votos.every((c) => c.alinea === 'right'), `${e}: número alineado a la derecha en todas las filas`);
    ok(m.desborde <= 0, `${e}: nada se desborda en horizontal`, m.desborde);
  }

  const fuente = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'dia-d.html'), 'utf8');
  ok(/border: 1\.5px solid #9DB4D9;/.test(fuente) && /border: 2px solid #0B5ED7;\s*box-shadow: 0 0 0 3px rgba\(11, 94, 215, \.15\)/.test(fuente),
    'la hoja declara borde 1,5 px #9DB4D9 y, al enfocar, 2 px #0B5ED7 con sombra 0 0 0 3px rgba(11,94,215,.15) (el arnés redondea 1,5 px a 1 px al medir)');
  for (const [w, h] of [[390, 844], [360, 740]]) {
    console.log(`\n[${w}×${h}] Testigo de una mesa`);
    await ponerTestigo('mesa', [1]);
    ok(await abrir(w, h), 'abre «Día D» como testigo');
    const nCand = await ev(`document.querySelectorAll('#tbody-votos-candidatos input[data-candidato]').length`);
    ok(nCand >= 2, `hay ${nCand} candidatos para probar las filas`);
    const m0 = await ev(MEDIR); console.log('  dpr=' + m0.dpr + ' borde Departamento=' + m0.dep.bordeAncho + ' casilla borde=' + (m0.cas[0] && m0.cas[0].borde));
    revisar(m0, `${w} · vacío`);
    ok(!!m0.mesa, 'la fila Mesa está');

    // Foco: borde 2 px azul y sombra suave.
    for (const id of ['f-total-votantes', 'f-departamento']) {
      await ev(`document.getElementById('${id}').focus()`); await espera(120);
      const f = await ev(`(() => { const c = getComputedStyle(document.getElementById('${id}')); return { b: c.borderTopWidth, col: c.borderTopColor, sombra: c.boxShadow, fondo: c.backgroundColor }; })()`);
      ok(f.b === '2px' && f.col === AZUL && /rgba\(11, 94, 215, 0\.15\) 0px 0px 0px 3px/.test(f.sombra) && f.fondo === BLANCO, `${w} · foco en ${id}: borde 2 px #0B5ED7, sombra 0 0 0 3px rgba(11,94,215,.15)`, f);
    }
    await ev(`document.activeElement.blur()`);
    // Placeholder: se muestra el del campo de texto del puesto.
    await ev(`(() => { const s = document.getElementById('f-puesto-select'); s.value = [...s.options].pop().value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await espera(200);
    const ph = await ev(`(() => { const i = document.getElementById('f-puesto'); const c = getComputedStyle(i, '::placeholder'); const k = getComputedStyle(i); return { color: c.color, ph: i.placeholder, fondo: k.backgroundColor, borde: k.borderTopColor, alto: i.getBoundingClientRect().height }; })()`);
    ok(ph.color === 'rgb(138, 148, 166)' && ph.fondo === BLANCO && ph.borde === BORDE, `${w} · placeholder gris #8A94A6 en el texto del puesto`, ph);
    await ev(`(() => { const s = document.getElementById('f-puesto-select'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);

    // El total se actualiza al escribir votos.
    await ev(`document.getElementById('f-departamento').value = 'Caldas'; document.getElementById('f-municipio').value = 'Manizales'; document.getElementById('f-total-votantes').value = '250'`);
    ok(await ev(`document.getElementById('f-total-votos-mesa').value`) === '0', `${w} · el total de votos arranca en 0`);
    await ev(`document.querySelectorAll('#tbody-votos-candidatos input[data-candidato]').forEach((i, n) => { i.value = String(n + 1); i.dispatchEvent(new Event('input', { bubbles: true })); })`);
    const suma = (nCand * (nCand + 1)) / 2;
    ok(Number(await ev(`document.getElementById('f-total-votos-mesa').value`)) === suma, `${w} · el total se actualiza al escribir votos (${suma})`);
    await ev(`document.querySelector('#tbody-votos-candidatos input[data-candidato]').value = '1000'; document.querySelector('#tbody-votos-candidatos input[data-candidato]').dispatchEvent(new Event('input', { bubbles: true }))`);
    const m1 = await ev(MEDIR);
    revisar(m1, `${w} · con datos (votos de 4 cifras)`);
    ok(Number(await ev(`document.getElementById('f-total-votos-mesa').value`)) === suma - 1 + 1000, `${w} · y sigue sumando (${suma - 1 + 1000})`);
    await recoger(`${w} mesa`);
    if (w === 390) {
      await foto('1-arriba-390', '.seccion-titulo', '#campo-total-votantes');
      await foto('2-abajo-390', '.tabla-votos-candidatos', '#campo-total-votos-mesa');
    }

    // Coordinador de puesto con 3 mesas: las casillas de 22 px.
    console.log(`\n[${w}×${h}] Coordinador de puesto (casillas de mesa)`);
    await ponerTestigo('puesto', [1, 2, 3]);
    ok(await abrir(w, h), 'abre «Día D»');
    ok(await esperar(`document.querySelectorAll('.chk-mesa-coordinador').length === 3`), 'salen las 3 casillas de mesa');
    const m2 = await ev(MEDIR);
    ok(m2.cas.every((c) => cerca(c.caja.width, 22, 0.6) && cerca(c.caja.height, 22, 0.6) && c.borde === BORDE && c.bordeAncho === m2.b15), `${w} · casillas de mesa de 22 px con borde #9DB4D9`, m2.cas.map((c) => [c.caja.width, c.caja.height, c.borde]));
    ok(m2.tTotVotantes.caja.left > 0 && cerca(m2.totVotantes.caja.left, m2.dep.caja.left), `${w} · con casillas, Total votantes sigue alineado con Departamento`);
    if (w === 390) await foto('3-casillas-390', '.seccion-titulo', '#campo-total-votantes');
    await recoger(`${w} coordinador`);
  }

  console.log('\n[Envío] Un reporte sigue llegando igual (testigo de una mesa, 390×844)');
  await ponerTestigo('mesa', [1]);
  ok(await abrir(390, 844), 'abre «Día D»');
  await ev(`document.getElementById('f-departamento').value = 'Caldas'; document.getElementById('f-municipio').value = 'Manizales'; document.getElementById('f-mesa').value = '1';`);
  await ev(`archivoFotoE14 = new Blob([new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 255, 217])], { type: 'image/jpeg' }); nombreFotoE14 = 'foto_e14.jpg';
    document.querySelectorAll('#tbody-votos-candidatos input[data-candidato]').forEach((i) => { i.value = '10'; i.dispatchEvent(new Event('input', { bubbles: true })); });`);
  const nCand = await ev(`document.querySelectorAll('#tbody-votos-candidatos input[data-candidato]').length`);
  await ev(`document.getElementById('f-total-votantes').value = String(${nCand} * 10)`);
  const antesR = (await q('SELECT COUNT(*) AS n FROM dia_d_reportes'))[0].n;
  await ev(`document.getElementById('btn-enviar-reporte').click()`);
  const llego = await (async () => { const hasta = Date.now() + 12000; while (Date.now() < hasta) { if ((await q('SELECT COUNT(*) AS n FROM dia_d_reportes'))[0].n > antesR) return true; await espera(250); } return false; })();
  ok(llego, 'el reporte llegó al servidor (se guardó una fila nueva)');
  const rep = (await q('SELECT * FROM dia_d_reportes ORDER BY id DESC LIMIT 1'))[0] || {};
  ok(rep.departamento === 'Caldas' && rep.municipio === 'Manizales' && String(rep.mesa_votacion) === '1' && Number(rep.total_votantes_mesa) === nCand * 10 && Number(rep.puesto_id) === p0.id,
    'con departamento, municipio, puesto, mesa y total votantes tal como se escribieron', { dep: rep.departamento, mun: rep.municipio, mesa: rep.mesa_votacion, total: rep.total_votantes_mesa, puesto: rep.puesto_id });
  const nVotos = (await q('SELECT COUNT(*) AS n FROM dia_d_reporte_votos WHERE reporte_id = ?', [rep.id]).catch(() => [{ n: -1 }]))[0].n;
  console.log('  (votos por candidato guardados: ' + nVotos + ')');
  ok(await esperar(`document.getElementById('lista-mis-reportes').children.length >= 1`), 'y aparece en «Mis reportes de hoy»');
  await recoger('envío');

  ok(errores.length === 0, 'cero errores de consola en todas las pantallas', errores);

  console.log(`\nCapturas en ${SALIDA}`);
  console.log(fallos ? `\n${fallos} de ${pasos} comprobaciones FALLARON` : `\nTodas las comprobaciones pasaron (${pasos}).`);
  const despues = fs.existsSync(dirUp) ? fs.readdirSync(dirUp) : [];
  despues.filter((f) => !antes.has(f)).forEach((f) => fs.rmSync(path.join(dirUp, f), { force: true }));
  nav.cerrar(); s.close(); await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
