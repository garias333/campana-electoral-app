#!/usr/bin/env node
// scripts/probar-conteo-dos-columnas.js
//
// ORDEN 132: «Reportar conteo de mi mesa» en DOS COLUMNAS (título a la izquierda, campo a la derecha) en la app del celular
// (public/app/dia-d.html). EN CHROMIUM REAL, con las rutas reales de /api/dia-d y la sesión de una testigo del arnés de capturas.
//   · en 390×844 y 360×740, en tres formas del formulario (Mesa escrita · 3 casillas de mesa · 12 casillas de mesa):
//       - las 5 filas (Departamento, Municipio, Puesto de votación, Mesa, Total votantes): el left de los títulos coincide (±1 px),
//         el left y el ancho de los campos coinciden (±1 px), la columna del título mide max(110 px, 38 %), los campos con 48 px de alto
//         (la lista de casillas no es un campo de texto), cada título centrado en vertical con su campo, mismo tamaño de letra que antes (15 px);
//       - nada se desborda en horizontal;
//       - con un puesto de nombre largo se ve la elipsis (y el desplegable la tiene configurada);
//       - con 12 mesas las casillas se acomodan en varias filas, alineadas a la izquierda de la columna derecha;
//   · el título «Reportar conteo de mi mesa» y el botón «Enviar reporte» siguen a lo ancho completo;
//   · enviar un reporte sigue funcionando igual: llega al servidor con los mismos campos (departamento, municipio, puesto, mesa, total);
//   · cero errores de consola.
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada132 [SALIDA=/ruta] node scripts/probar-conteo-dos-columnas.js
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

const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden132');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];
const cerca = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const NOMBRE_LARGO = 'INSTITUCIÓN EDUCATIVA TÉCNICA AGROPECUARIA NUESTRA SEÑORA DEL ROSARIO SEDE PRINCIPAL';

/** Mide el formulario desde dentro de la página: una fila por título, con su campo (el control, o la lista de casillas). */
const MEDIR = `(() => {
  const r = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height, cy: b.top + b.height / 2 }; };
  const visible = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 0 && b.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const filas = [...document.querySelectorAll('#form-reporte .fila-conteo')].filter(visible).map((f) => {
    const t = f.querySelector(':scope > label');
    const campo = f.querySelector(':scope > input:not([style*="none"]), :scope > select, :scope > .lista-mesas-casillas');
    const cs = getComputedStyle(t);
    return { titulo: t.textContent.trim(), t: r(t), c: r(campo), fila: r(f), tag: campo.tagName, clase: campo.className, fuente: cs.fontSize, peso: cs.fontWeight,
      lineas: Math.round(t.getBoundingClientRect().height / parseFloat(cs.lineHeight)) };
  });
  const tit = document.querySelector('.seccion-titulo'); const btn = document.getElementById('btn-enviar-reporte'); const cont = document.querySelector('main.app-cuerpo');
  return { filas, ancho: innerWidth, desborde: document.documentElement.scrollWidth - innerWidth, tituloSeccion: r(tit), boton: r(btn), cuerpo: r(cont),
    cuerpoPad: parseFloat(getComputedStyle(cont).paddingLeft) };
})()`;

(async () => {
  const ids = await sembrar(pool);
  // Un puesto de nombre largo (para la elipsis) y uno con 12 mesas.
  const idLargo = (await q('INSERT INTO dia_d_puestos_votacion (nombre, cantidad_mesas, aspirante_id) VALUES (?,12,0)', [NOMBRE_LARGO])).insertId;
  const [[p0]] = await pool.query("SELECT id FROM dia_d_puestos_votacion WHERE nombre = 'I.E. Ejemplo Norte'");
  const ponerTestigo = async (tipo, mesas) => {
    await q('UPDATE estructura SET tipo_testigo = ?, mesas_asignadas = ?, puesto_id = ?, puesto_votacion = ?, mesa_votacion = ? WHERE usuario_id = ?',
      [tipo, JSON.stringify(mesas), p0.id, 'I.E. Ejemplo Norte', tipo === 'mesa' ? 1 : null, ids.testigo]);
  };

  const s = http.createServer(crear(pool));
  await new Promise((r2) => s.listen(0, '127.0.0.1', r2));
  const base = `http://127.0.0.1:${s.address().port}`;
  const antes = new Set(fs.existsSync(path.join(__dirname, '..', 'uploads', 'dia-d')) ? fs.readdirSync(path.join(__dirname, '..', 'uploads', 'dia-d')) : []);

  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; const ce = console.error; console.error = function () { window.__errs.push([].slice.call(arguments).join(' ')); ce.apply(console, arguments); }; window.addEventListener('error', function (e) { window.__errs.push('ERR ' + e.message); });` });
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
  /** Recorte de la parte del formulario que cambió: del título «Reportar conteo…» al final de «Total votantes». */
  async function foto(nombre) {
    const caja = await ev(`(() => { const t = document.querySelector('.seccion-titulo').getBoundingClientRect(); const f = [...document.querySelectorAll('#form-reporte .fila-conteo')].filter((x) => x.getBoundingClientRect().height > 0).pop().getBoundingClientRect();
      return { y: t.top + scrollY - 8, h: f.bottom - t.top + 16 }; })()`);
    const r3 = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: Math.max(0, caja.y), width: 390, height: caja.h, scale: 1 } });
    fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r3.result.data, 'base64'));
  }

  function revisar(m, etiqueta, { esperaCasillas = 0 } = {}) {
    const f = m.filas;
    // Orden 136: «Total votantes» pasó a mayúsculas y «TOTAL VOTOS EN LA MESA» entró a la misma grid (sexta fila).
    ok(JSON.stringify(f.map((x) => x.titulo.toLowerCase())) === JSON.stringify(['departamento', 'municipio', 'puesto de votación', 'mesa', 'total votantes', 'total votos en la mesa']),
      `${etiqueta}: seis filas con los títulos Departamento · Municipio · Puesto de votación · Mesa · TOTAL VOTANTES · TOTAL VOTOS EN LA MESA`, f.map((x) => x.titulo));
    const t0 = f[0].t.left; const c0 = f[0].c;
    ok(f.every((x) => cerca(x.t.left, t0)), `${etiqueta}: el left de los títulos coincide (±1 px)`, f.map((x) => x.t.left));
    ok(f.every((x) => cerca(x.c.left, c0.left) && cerca(x.c.width, c0.width)), `${etiqueta}: el left y el ancho de los campos coinciden (±1 px)`, f.map((x) => [x.c.left, x.c.width]));
    const colTitulo = c0.left - t0 - 12;
    const esperado = Math.max(110, 0.38 * f[0].fila.width);
    ok(cerca(colTitulo, esperado, 1.5), `${etiqueta}: la columna del título mide max(110 px, 38 %) = ${esperado.toFixed(1)} px`, colTitulo);
    ok(f.every((x) => x.t.left >= m.cuerpo.left && cerca(x.c.left + x.c.width, f[0].fila.left + f[0].fila.width)), `${etiqueta}: los campos llegan hasta el borde derecho de la fila`, f.map((x) => x.c.left + x.c.width));
    const controles = f.filter((x) => x.tag !== 'DIV');
    ok(controles.filter((x) => !/^total/i.test(x.titulo)).every((x) => cerca(x.c.height, 48, 0.6)) && controles.filter((x) => /^total/i.test(x.titulo)).every((x) => cerca(x.c.height, 52, 0.6)),
      `${etiqueta}: los campos miden 48 px de alto y los de los dos totales 52 px (Orden 136)`, controles.map((x) => x.c.height));
    ok(f.every((x) => cerca(x.t.cy, x.c.cy, 1.5)), `${etiqueta}: cada título centrado en vertical con su campo (±1,5 px)`, f.map((x) => [x.titulo, x.t.cy, x.c.cy]));
    ok(f.filter((x) => !/^total/i.test(x.titulo)).every((x) => x.fuente === '15px' && Number(x.peso) >= 700) && f.filter((x) => /^total/i.test(x.titulo)).every((x) => x.fuente === '17px' && Number(x.peso) >= 700),
      `${etiqueta}: los títulos conservan su letra (15 px, negrita) y los dos totales van en 17 px (Orden 136)`, f.map((x) => [x.fuente, x.peso]));
    ok(m.desborde <= 0, `${etiqueta}: nada se desborda en horizontal`, m.desborde);
    const sec = m.tituloSeccion;
    ok(cerca(sec.left, m.cuerpo.left + m.cuerpoPad) && sec.width >= m.ancho - 2 * m.cuerpoPad - 1, `${etiqueta}: el título «Reportar conteo de mi mesa» sigue a lo ancho completo`, sec);
    ok(m.boton.width >= m.ancho - 2 * m.cuerpoPad - 1, `${etiqueta}: el botón «Enviar reporte» sigue a lo ancho completo`, m.boton);
    if (esperaCasillas) {
      const casillas = f[3].tag === 'DIV';
      ok(casillas, `${etiqueta}: la fila Mesa trae la lista de casillas`);
    }
  }

  // ===================================================================================================================
  for (const [w, h] of [[390, 844], [360, 740]]) {
    console.log(`\n[${w}×${h}] Mesa escrita (testigo de una mesa)`);
    await ponerTestigo('mesa', [1]);
    ok(await abrir(w, h), 'abre «Día D» como testigo');
    await ev(`document.getElementById('f-departamento').value = 'Caldas'; document.getElementById('f-municipio').value = 'Manizales'; document.getElementById('f-total-votantes').value = '250'`);
    revisar(await ev(MEDIR), `${w} · mesa escrita`);
    ok(await ev(`document.getElementById('f-total-votantes').getAttribute('inputmode') === 'numeric'`), 'Total votantes con teclado numérico (inputmode="numeric")');

    // El puesto de nombre largo: elipsis en el desplegable cerrado.
    await ev(`(() => { const s = document.getElementById('f-puesto-select'); s.value = '${idLargo}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await espera(300);
    const el = await ev(`(() => { const s = document.getElementById('f-puesto-select'); const cs = getComputedStyle(s); const cv = document.createElement('canvas').getContext('2d'); cv.font = cs.fontSize + ' ' + cs.fontFamily;
      const ancho = cv.measureText(s.selectedOptions[0].text).width; const util = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { ellipsis: cs.textOverflow, nowrap: cs.whiteSpace, texto: ancho, util, sinDesborde: document.documentElement.scrollWidth <= innerWidth + 1, alto: s.getBoundingClientRect().height }; })()`);
    ok(el.ellipsis === 'ellipsis' && el.nowrap === 'nowrap' && el.texto > el.util, `${w} · con un puesto de nombre largo el desplegable lo corta con elipsis (texto ${Math.round(el.texto)} px en ${Math.round(el.util)} px)`, el);
    ok(el.sinDesborde && cerca(el.alto, 48, 0.6), `${w} · y el desplegable sigue a 48 px de alto, sin desborde`, el);
    ok(await ev(`[...document.getElementById('f-puesto-select').options].some((o) => o.text === ${JSON.stringify(NOMBRE_LARGO)})`), `${w} · el nombre completo está en la lista que se abre`);
    await recoger(`${w} mesa escrita`);

    // «Mi puesto no aparece»: el texto cae debajo del desplegable, en la columna derecha, y el título sigue centrado con el desplegable.
    await ev(`(() => { const s = document.getElementById('f-puesto-select'); s.value = [...s.options].pop().value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await espera(250);
    const otro = await ev(`(() => { const r = (e) => e.getBoundingClientRect(); const s = r(document.getElementById('f-puesto-select')); const i = r(document.getElementById('f-puesto')); const l = r(document.querySelector('label[for="f-puesto-select"]'));
      return { sl: s.left, sw: s.width, il: i.left, iw: i.width, ih: i.height, debajo: i.top >= s.bottom, ly: l.top + l.height / 2, sy: s.top + s.height / 2, ancho: document.documentElement.scrollWidth <= innerWidth + 1 }; })()`);
    ok(cerca(otro.sl, otro.il) && cerca(otro.sw, otro.iw) && otro.debajo && cerca(otro.ih, 48, 0.6) && cerca(otro.ly, otro.sy, 1.5) && otro.ancho, `${w} · «Mi puesto no aparece»: el texto va debajo del desplegable, mismo ancho, y el título sigue centrado con el desplegable`, otro);
    revisar(await ev(MEDIR), `${w} · con el texto del puesto abierto`);
    if (w === 390) await foto('3-puesto-no-aparece-390');
    await ev(`(() => { const s = document.getElementById('f-puesto-select'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);

    for (const n of [3, 12]) {
      console.log(`\n[${w}×${h}] Coordinador de puesto con ${n} mesas (casillas)`);
      await ponerTestigo('puesto', Array.from({ length: n }, (_, i) => i + 1));
      ok(await abrir(w, h), 'abre «Día D»');
      ok(await esperar(`document.querySelectorAll('.chk-mesa-coordinador').length === ${n}`), `salen las ${n} casillas de mesa`);
      await ev(`document.getElementById('f-departamento').value = 'Caldas'; document.getElementById('f-municipio').value = 'Manizales'; document.getElementById('f-total-votantes').value = '250'`);
      const m = await ev(MEDIR);
      revisar(m, `${w} · ${n} mesas`, { esperaCasillas: 1 });
      const cas = await ev(`(() => { const c = document.getElementById('lista-mesas-coordinador'); const cb = c.getBoundingClientRect(); const L = [...c.querySelectorAll('label')].map((l) => l.getBoundingClientRect());
        return { izq: Math.min(...L.map((x) => x.left)) - cb.left, filas: new Set(L.map((x) => Math.round(x.top))).size, dentro: L.every((x) => x.right <= cb.right + 1), titulos: [...c.querySelectorAll('label')].map((l) => l.textContent.trim()).slice(0, 2) }; })()`);
      ok(cas.izq <= 1 && cas.dentro, `${w} · ${n} mesas: las casillas arrancan en el borde izquierdo de la columna y no se salen de ella`, cas);
      if (n === 3) ok(cas.filas >= 1 && cas.titulos[0] === 'Mesa 1', `${w} · 3 mesas: «Mesa 1», «Mesa 2», «Mesa 3» (${cas.filas} fila/s)`, cas);
      if (n === 12) ok(cas.filas > 1, `${w} · 12 mesas: se acomodan en varias filas (${cas.filas})`, cas);
      if (w === 390) await foto(`${n === 3 ? '1' : '2'}-${n}-mesas-390`);
      await recoger(`${w} ${n} mesas`);
    }
  }

  // ===================================================================================================================
  console.log('\n[Envío] Un reporte sigue llegando igual (testigo de una mesa, 390×844)');
  await ponerTestigo('mesa', [1]);
  ok(await abrir(390, 844), 'abre «Día D»');
  await ev(`document.getElementById('f-departamento').value = 'Caldas'; document.getElementById('f-municipio').value = 'Manizales'; document.getElementById('f-total-votantes').value = '30'; document.getElementById('f-mesa').value = '1';`);
  await ev(`archivoFotoE14 = new Blob([new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 255, 217])], { type: 'image/jpeg' }); nombreFotoE14 = 'foto_e14.jpg';
    document.querySelectorAll('#tbody-votos-candidatos input[data-candidato]').forEach((i) => { i.value = '10'; i.dispatchEvent(new Event('input', { bubbles: true })); });`);
  const nCand = await ev(`document.querySelectorAll('#tbody-votos-candidatos input[data-candidato]').length`);
  await ev(`document.getElementById('f-total-votantes').value = String(${nCand} * 10)`);
  const reportesAntes = (await q('SELECT COUNT(*) AS n FROM dia_d_reportes'))[0].n;
  await ev(`document.getElementById('btn-enviar-reporte').click()`);
  const llego = await (async () => { const hasta = Date.now() + 12000; while (Date.now() < hasta) { if ((await q('SELECT COUNT(*) AS n FROM dia_d_reportes'))[0].n > reportesAntes) return true; await espera(250); } return false; })();
  ok(llego, 'el reporte llegó al servidor (se guardó una fila nueva)');
  const rep = (await q('SELECT * FROM dia_d_reportes ORDER BY id DESC LIMIT 1'))[0] || {};
  ok(rep.departamento === 'Caldas' && rep.municipio === 'Manizales' && String(rep.mesa_votacion) === '1' && Number(rep.total_votantes_mesa) === nCand * 10 && Number(rep.puesto_id) === p0.id,
    'con departamento, municipio, puesto, mesa y total votantes tal como se escribieron', { dep: rep.departamento, mun: rep.municipio, mesa: rep.mesa_votacion, total: rep.total_votantes_mesa, puesto: rep.puesto_id });
  ok(await esperar(`document.getElementById('lista-mis-reportes').children.length >= 1`), 'y aparece en «Mis reportes de hoy»');
  await recoger('envío');

  ok(errores.length === 0, 'cero errores de consola en todas las pantallas', errores);

  console.log(`\nCapturas en ${SALIDA}`);
  console.log(fallos ? `\n${fallos} de ${pasos} comprobaciones FALLARON` : `\nTodas las comprobaciones pasaron (${pasos}).`);
  const despues = fs.existsSync(path.join(__dirname, '..', 'uploads', 'dia-d')) ? fs.readdirSync(path.join(__dirname, '..', 'uploads', 'dia-d')) : [];
  despues.filter((f) => !antes.has(f)).forEach((f) => fs.rmSync(path.join(__dirname, '..', 'uploads', 'dia-d', f), { force: true }));   // la foto de prueba no se queda en la carpeta de la instalación
  nav.cerrar(); s.close(); await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
