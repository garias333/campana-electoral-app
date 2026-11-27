#!/usr/bin/env node
// scripts/probar-controles-uniformes.js
//
// ORDEN 138: campos y botones UNIFORMES (diseño «Encabezado azul oscuro») en cuatro zonas del ESCRITORIO, EN CHROMIUM REAL, con administrador,
// a 1600×900 y 1366×768, con getComputedStyle / getBoundingClientRect:
//   · Estructura territorial (territorial.html): alto 38 px de todos los campos y botones; los 5 filtros normales con el mismo ancho (±1 px) y
//     Comuna/corregimiento más ancho; Barrio/vereda y Autorización alineados (left) con Buscar y Cargos; el bloque no deja más de 16 px vacíos abajo;
//     encabezado azul oscuro con borde amarillo de 3 px; vista activa en amarillo; los filtros y el cambio de vista siguen funcionando.
//   · Organigrama (organigrama.html): modos y «NIVELES» con el mismo top (1600 px); botones de 38 px.
//   · Cobertura de testigos (configuracion.html#diad; orden 139): a 1600 px TODA la línea en una sola fila (mismo top ±1, 38 px, cero solapes); a 1366, orden y cero solapes (Excel y Avisar pueden bajar); rótulo «Solo sin cubrir» con el texto largo en title; Guardar,
//     Excel y Avisar siguen ahí.
//   · Día D (dia-d.html): pestañas del mismo ancho (150 px) y subpestañas (165 px) de 38 px; los dos botones de acción de 38 px; «Eliminar todos»
//     sigue pidiendo confirmación. Cero errores de consola. Capturas en SALIDA.
//
// ORDEN 141 (ronda 2): radio de 8 px en los controles; Organigrama sin «NIVELES» y con el número de personas por nivel sobre fondo propio;
//   Día D con pestañas que miden según su texto, con ícono, y las acciones / subpestañas en la MISMA línea que las pestañas (1600 px).
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada138 [SALIDA=/ruta] node scripts/probar-controles-uniformes.js
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

const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden138');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 900) : '')); }
}
const cerca = (a, b, tol = 1) => Math.abs(a - b) <= tol;

/** Lista de {id, tag, tipo, alto, top, left, ancho, bottom, texto} de los controles visibles dentro de `raiz`. */
const CONTROLES = (raiz, sel) => `(() => [...document.querySelectorAll(${JSON.stringify(sel.split(',').map((x) => raiz + ' ' + x.trim()).join(', '))})]
  .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
  .map((e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
    return { id: e.id || '', tag: e.tagName.toLowerCase(), alto: Math.round(r.height * 10) / 10, top: Math.round(r.top * 10) / 10, left: Math.round(r.left * 10) / 10,
      ancho: Math.round(r.width * 10) / 10, bottom: r.bottom, radio: c.borderTopLeftRadius, letra: c.fontSize, texto: (e.textContent || e.value || '').trim().slice(0, 30) }; }))()`;

(async () => {
  const ids = await sembrar(pool);
  void ids;
  const s = http.createServer(crear(pool));
  await new Promise((r2) => s.listen(0, '127.0.0.1', r2));
  const base = `http://127.0.0.1:${s.address().port}`;
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; const ce = console.error; console.error = function () { window.__errs.push([].slice.call(arguments).join(' ')); ce.apply(console, arguments); }; window.addEventListener('error', function (e) { window.__errs.push('ERR ' + e.message); });` });
  const errores = [];
  const recoger = async (donde) => { try { (await ev('window.__errs || []')).forEach((e) => errores.push(donde + ': ' + e)); } catch (_) { /* página cambiando */ } };
  const encuadre = (w, h) => cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const esperar = async (expr, ms = 12000) => { const hasta = Date.now() + ms; while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); } return false; };
  const foto = async (nombre, clip) => {
    const r = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  const caja = (sel, margen = 12) => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.max(0, r.left - ${margen}), y: Math.max(0, r.top + scrollY - ${margen}), width: r.width + ${margen * 2}, height: r.height + ${margen * 2} }; })()`);
  async function abrir(w, h, url, listo) {
    await encuadre(w, h);
    await cmd('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' });
    await cmd('Network.clearBrowserCookies');
    await cmd('Network.setCookie', { name: 'ej_usuario', value: '1', url: base });
    await cmd('Page.navigate', { url: base + url });
    const l = await esperar(listo, 15000);
    await espera(600);
    return l;
  }

  for (const [w, h] of [[1600, 900], [1366, 768]]) {
    /* ===================================================================== 1. ESTRUCTURA TERRITORIAL */
    console.log(`\n[Estructura territorial · ${w}×${h}]`);
    ok(await abrir(w, h, '/territorial.html', "document.querySelectorAll('#tbody-estructura .ficha-p').length > 0 && !!document.querySelector('#bloque-estructura')"), 'la pantalla carga con datos');
    const hojaOk = await ev("[...document.styleSheets].some(h => /controles-uniformes\\.css/.test(h.href || ''))");
    ok(hojaOk, 'la hoja común controles-uniformes.css está cargada');
    const vars = await ev("(() => { const c = getComputedStyle(document.documentElement); return ['--ctl-h','--ctl-radio','--ctl-letra','--ctl-borde','--ctl-fondo'].map(k => c.getPropertyValue(k).trim()); })()");
    ok(vars[0] === '38px' && vars[1] === '8px' && vars[2] === '14px' && vars[3] === '1px solid #DFE3EA' && vars[4] === '#F1F3F8', 'variables comunes --ctl-h/radio/letra/borde/fondo', vars);
    const cs = await ev(CONTROLES('#bloque-estructura', 'input:not([type=hidden]), select, button, a.btn-secundario'));
    ok(cs.length >= 12, `${cs.length} campos y botones visibles en el bloque (6 del selector de vistas + 5 filtros + Quitar)`, cs.map((c) => c.id || c.texto));
    ok(cs.every((c) => cerca(c.alto, 38, 0.6)), 'todos de 38 px de alto', cs.filter((c) => !cerca(c.alto, 38, 0.6)).map((c) => [c.id || c.texto, c.alto]));
    ok(cs.every((c) => c.radio === '8px'), 'todos con radio de 8 px', cs.filter((c) => c.radio !== '8px').map((c) => [c.id || c.texto, c.radio]));
    const f = Object.fromEntries(cs.filter((c) => c.id).map((c) => [c.id, c]));
    const normales = ['filtro-estructura-busqueda', 'filtro-estructura-cargo', 'filtro-estructura-area', 'filtro-estructura-territorio', 'filtro-estructura-autorizacion'].map((i) => f[i]);
    ok(normales.every(Boolean), 'los 5 filtros normales existen y se ven');
    const ws = normales.map((c) => c.ancho);
    ok(Math.max(...ws) - Math.min(...ws) <= 1, `los 5 filtros normales con el mismo ancho (±1 px): ${ws.join(' / ')}`);
    const zona = f['filtro-estructura-zona'];
    ok(zona && zona.ancho > Math.max(...ws) + 20, `Comuna/corregimiento más ancha (${zona && zona.ancho} px contra ${ws[0]} px)`);
    ok(cerca(f['filtro-estructura-territorio'].left, f['filtro-estructura-busqueda'].left), `Barrio/vereda alineado con Buscar (left ${f['filtro-estructura-territorio'].left} / ${f['filtro-estructura-busqueda'].left})`);
    ok(cerca(f['filtro-estructura-autorizacion'].left, f['filtro-estructura-cargo'].left), `Autorización alineada con Cargos (left ${f['filtro-estructura-autorizacion'].left} / ${f['filtro-estructura-cargo'].left})`);
    const quitar = cs.find((c) => c.texto === 'Quitar filtros');
    ok(quitar && cerca(quitar.top, f['filtro-estructura-territorio'].top), 'Quitar filtros en la fila 2, al lado de Autorización');
    ok(cerca(f['filtro-estructura-zona'].top, f['filtro-estructura-busqueda'].top) && cerca(f['filtro-estructura-cargo'].top, f['filtro-estructura-area'].top), 'fila 1: Buscar, Cargos, Áreas y Comuna con el mismo top');
    const vacio = await ev("(() => { const b = document.getElementById('bloque-estructura').getBoundingClientRect(); const u = [...document.querySelectorAll('#bloque-estructura input, #bloque-estructura select, #bloque-estructura button')].filter(e => e.getBoundingClientRect().width > 0 && !e.closest('.ctl-enc')); return b.bottom - Math.max(...u.map(e => e.getBoundingClientRect().bottom)); })()");
    ok(vacio <= 17 && vacio >= 14, `el bloque termina ${vacio.toFixed(1)} px después de la fila 2 (≤ 16 px + borde)`);
    const enc = await ev(`(() => { const e = document.querySelector('#bloque-estructura .ctl-enc'); const c = getComputedStyle(e); const h = e.querySelector('h2'); const a = document.querySelector('#selector-vistas-estructura .activa'); const n = document.getElementById('contador-estructura');
      return { fondo: c.backgroundColor, borde: c.borderBottomWidth + ' ' + c.borderBottomColor, titulo: h.textContent.trim(), tColor: getComputedStyle(h).color, tPeso: getComputedStyle(h).fontWeight,
        activa: getComputedStyle(a).backgroundColor + ' ' + getComputedStyle(a).color, cont: getComputedStyle(n).color, textoCont: n.textContent.trim(), selBg: getComputedStyle(document.getElementById('selector-vistas-estructura')).backgroundColor }; })()`);
    ok(enc.fondo === 'rgb(8, 66, 152)' && enc.borde === '3px rgb(255, 195, 0)', 'encabezado azul oscuro #084298 con borde inferior de 3 px #FFC300', enc);
    ok(enc.titulo === 'Estructura territorial' && enc.tColor === 'rgb(255, 255, 255)' && Number(enc.tPeso) >= 700, '«Estructura territorial» en blanco y negrita', enc);
    ok(enc.activa === 'rgb(255, 195, 0) rgb(59, 47, 0)', 'vista activa en amarillo #FFC300 con letra #3B2F00', enc);
    ok(enc.cont === 'rgb(207, 224, 255)' && /registro\(s\)/.test(enc.textoCont), `conteo «${enc.textoCont}» en #CFE0FF`, enc);
    ok(/rgba\(255, 255, 255, 0\.12\)/.test(enc.selBg), 'selector de vistas con fondo rgba(255,255,255,.12)', enc.selBg);
    if (w === 1600) await foto('1-estructura-1600', await caja('#bloque-estructura', 20));
    // Funcionan: filtro de cargo, quitar filtros y cambio de vista.
    const total0 = await ev("document.querySelectorAll('#tbody-estructura .ficha-p').length");
    await ev("(() => { const s = document.getElementById('filtro-estructura-cargo'); s.value = 'coordinador'; s.dispatchEvent(new Event('change')); })()");
    await espera(500);
    const total1 = await ev("document.querySelectorAll('#tbody-estructura .ficha-p').length");
    ok(total1 < total0 && total1 > 0, `el filtro de Cargo sigue filtrando (${total0} → ${total1})`);
    await ev("document.getElementById('btn-quitar-filtros-estructura').click()");
    await espera(500);
    ok(await ev("document.getElementById('filtro-estructura-cargo').value === ''") && await ev("document.querySelectorAll('#tbody-estructura .ficha-p').length") === total0, 'Quitar filtros restablece el filtro y la lista');
    await ev("document.querySelector('#selector-vistas-estructura [data-vista=\"tarjetas\"]').click()");
    await espera(500);
    ok(await ev("document.getElementById('card-estructura').dataset.vista") === 'tarjetas' && await ev("document.querySelector('#selector-vistas-estructura .activa').dataset.vista") === 'tarjetas', 'el cambio de vista (Tarjetas) sigue funcionando');
    const csV = await ev(CONTROLES('#bloque-estructura', 'button'));
    ok(csV.every((c) => cerca(c.alto, 38, 0.6)), 'tras cambiar de vista, los botones siguen de 38 px');
    // Por debajo de 1100 px: dos columnas.
    if (w === 1366) {
      await encuadre(1000, 800); await espera(400);
      const dos = await ev(CONTROLES('#bloque-estructura', 'input:not([type=hidden]), select'));
      const lefts = [...new Set(dos.map((c) => Math.round(c.left)))];
      ok(lefts.length === 2, `a 1000 px la rejilla es de 2 columnas (lefts: ${lefts.join(', ')})`);
      await foto('1b-estructura-1000', await caja('#bloque-estructura', 20));
      await encuadre(w, h);
    }
    await recoger('estructura ' + w);

    /* ===================================================================== 2. ORGANIGRAMA */
    console.log(`\n[Organigrama · ${w}×${h}]`);
    ok(await abrir(w, h, '/organigrama.html', "!!document.getElementById('btn-vista-diagrama')"), 'la pantalla carga');
    await ev("document.getElementById('btn-vista-diagrama').click()");
    ok(await esperar("document.getElementById('org-diagrama-contenedor').style.display !== 'none' && document.querySelectorAll('#org-leyenda .org-ley').length > 0"), 'el diagrama y la leyenda de niveles aparecen');
    const modos = await ev(CONTROLES('#org-barra-uniforme', '.org-subvista-chip'));
    ok(modos.length === 5 && modos.every((c) => cerca(c.alto, 38, 0.6)), `los 5 modos de 38 px de alto`, modos.map((c) => [c.texto, c.alto]));
    ok(modos.every((c) => c.radio === '8px' && c.letra === '13px'), 'modos con radio de 8 px y letra de 13 px');
    const ley = await ev(`(() => { const l = document.getElementById('org-leyenda'); const c = getComputedStyle(l); const b = document.getElementById('org-barra-uniforme'); const bc = getComputedStyle(b);
      const chips = [...document.querySelectorAll('#org-barra-uniforme .org-subvista-chip')]; const items = [...l.querySelectorAll('.org-ley')]; const br = b.getBoundingClientRect();
      const centro = (e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; };
      const cuenta = (n) => nodos.filter((x) => (x.nivel === n || (n === 'asesores' && x.tipo_relacion === 'asesor')) && nombreAbreviado(x)).length;
      const num = items.map((i) => { const m = [...i.querySelector('.muestra').classList].find((k) => /^org-nivel-/.test(k)).replace('org-nivel-', ''); const n = i.querySelector('.org-ley-n'); const nc = getComputedStyle(n);
        return { nivel: m, mostrado: n.textContent.trim(), real: String(cuenta(m)), peso: nc.fontWeight, color: nc.color }; });
      const sw = items[0].querySelector('.muestra').getBoundingClientRect();
      return { titulo: !!l.querySelector('.titulo'), texto: l.textContent, tam: c.fontSize, color: c.color, n: items.length, num, swW: sw.width, swH: sw.height,
        fondo: bc.backgroundImage, borde: bc.borderTopWidth + ' ' + bc.borderTopColor, bordeAbajo: bc.borderBottomWidth + ' ' + bc.borderBottomColor, radio: bc.borderTopLeftRadius + ' ' + bc.borderBottomLeftRadius, pad: bc.padding, gap: bc.columnGap,
        chipPad: chips.map((e) => getComputedStyle(e).paddingLeft + ' ' + getComputedStyle(e).paddingRight), chipGap: chips.length > 1 ? chips[1].getBoundingClientRect().left - chips[0].getBoundingClientRect().right : 0,
        centros: chips.map(centro).concat(items.map(centro)), centroBarra: br.top + (br.height - 3) / 2 + 0.5, altoBarra: br.height, derBarra: br.right, derUltimo: items[items.length - 1].getBoundingClientRect().right,
        desborde: b.scrollWidth - b.clientWidth }; })()`);
    ok(!ley.titulo && !/niveles/i.test(ley.texto), 'la palabra «NIVELES» ya no está en la leyenda', ley.texto);
    ok(ley.tam === '14px' && ley.color === 'rgb(55, 65, 81)', 'leyenda a 14 px, color #374151', ley);
    ok(ley.swW === 16 && ley.swH === 12, 'cuadritos de color de 16×12 px', ley);
    ok(ley.num.length > 0 && ley.num.every((x) => x.mostrado === x.real && /^\d+$/.test(x.mostrado)), `cada nivel con su número de personas, igual al conteo de los datos del organigrama: ${ley.num.map((x) => x.nivel + '=' + x.mostrado).join(', ')}`, ley.num);
    ok(ley.num.every((x) => x.peso === '700' && x.color === 'rgb(8, 66, 152)'), 'números en negrita #084298', ley.num);
    ok(/linear-gradient\(/.test(ley.fondo) && /rgb\(244, 247, 252\)/.test(ley.fondo) && /rgb\(233, 238, 247\)/.test(ley.fondo), 'barra con degradado #F4F7FC → #E9EEF7', ley.fondo);
    ok(ley.borde === '1px rgb(223, 227, 234)' && ley.bordeAbajo === '3px rgb(255, 195, 0)' && ley.radio === '10px 0px' && ley.pad === '10px 12px', 'borde 1 px #DFE3EA, inferior 3 px #FFC300, radio 10 px arriba, padding 10px 12px', ley);
    ok(ley.gap === '5px' && cerca(ley.chipGap, 5, 0.6), `separación de 5 px (gap ${ley.gap}, entre modos ${ley.chipGap})`, ley);
    ok(ley.chipPad.every((x) => x === '9px 9px'), 'botones de modo con padding 0 9px', ley.chipPad);
    if (w === 1600) {
      ok(ley.centros.every((y) => cerca(y, ley.centros[0], 2)) && ley.altoBarra < 70, `a ${w} px modos y leyenda en UNA línea (alto de la barra ${ley.altoBarra} px)`, ley.centros);
      ok(ley.desborde <= 0 && ley.derUltimo <= ley.derBarra + 0.5, `a ${w} px cero desbordes en la barra (último ítem termina en ${Math.round(ley.derUltimo)}, la barra en ${Math.round(ley.derBarra)})`, ley);
      await foto('2-organigrama-1600', await caja('#org-barra-uniforme', 20));
    } else {
      console.log(`  info a ${w} px: alto de la barra ${ley.altoBarra} px (${ley.altoBarra < 70 ? 'una línea' : 'la leyenda bajó a la línea siguiente'})`);
      ok(ley.desborde <= 0, `a ${w} px sin desborde horizontal en la barra`, ley);
      await foto('2b-organigrama-1366', await caja('#org-barra-uniforme', 20));
    }
    // El cambio de modo sigue funcionando.
    await ev("document.querySelector('#org-subvista-selector [data-subvista=\"compacto\"]').click()");
    await espera(400);
    ok(await ev("document.querySelector('#org-subvista-selector .activo').dataset.subvista") === 'compacto', 'el cambio de modo (Compacto) sigue funcionando');
    const act = await ev("(() => { const a = document.querySelector('#org-subvista-selector .activo'); const c = getComputedStyle(a); return c.backgroundColor + ' ' + c.color; })()");
    ok(act === 'rgb(8, 66, 152) rgb(255, 255, 255)', 'modo activo #084298 con letra blanca', act);
    await recoger('organigrama ' + w);

    /* ===================================================================== 3. COBERTURA DE TESTIGOS */
    console.log(`\n[Cobertura de testigos · ${w}×${h}]`);
    ok(await abrir(w, h, '/configuracion.html#diad', "!!document.getElementById('linea-cobertura') && document.getElementById('aviso-ambito-puestos').style.display === 'block'"), 'la pantalla carga (el arnés no trae catálogo: sin filas de puestos, la línea de controles es la misma)');
    await ev("document.getElementById('caja-limite-mesas').style.display = 'flex'");   // el admin del arnés no es aspirante: se muestra como lo haría un admin real
    await espera(300);
    ok(await ev("document.getElementById('linea-cobertura').offsetParent !== null"), 'la línea de cobertura está visible');
    // El arnés no trae catálogo (sin puestos el conteo queda vacío): se escribe el texto que pone la pantalla con 91 puestos, para medir el ancho real.
    await ev("document.getElementById('conteo-cobertura').textContent = '91 puestos'");
    await espera(200);
    const cc = await ev(CONTROLES('#linea-cobertura', 'input:not([type=checkbox]):not([type=hidden]), select, button, a.btn-secundario'));
    ok(cc.every((c) => cerca(c.alto, 38, 0.6)), `los ${cc.length} campos y botones de la línea (${cc.map((c) => c.id || c.texto).join(' · ')}) de 38 px`, cc.filter((c) => !cerca(c.alto, 38, 0.6)).map((c) => [c.id || c.texto, c.alto]));
    ok(cc.every((c) => c.radio === '8px'), 'todos con radio de 8 px');
    // ORDEN 139: a 1600 px TODO en UNA sola línea (mismo top ±1 px); por debajo de lo que quepa (1366), Excel y Avisar pueden bajar a una segunda línea. Siempre: el orden y cero solapes.
    const ancho = await ev(`(() => { const l = document.getElementById('linea-cobertura'); const k = [...l.children].filter((e) => e.getBoundingClientRect().width > 0); const cs = getComputedStyle(l);
      const hijos = k.map((e) => e.getBoundingClientRect().width); const suma = hijos.reduce((a, b) => a + b, 0) + (k.length - 1) * parseFloat(cs.columnGap || cs.gap);
      return { linea: Math.round(l.getBoundingClientRect().width * 10) / 10, necesita: Math.round(suma * 10) / 10 }; })()`);
    console.log(`  info a ${w} px: la línea mide ${ancho.linea} px y los controles necesitan ${ancho.necesita} px (${ancho.necesita <= ancho.linea ? 'sobran ' + (ancho.linea - ancho.necesita).toFixed(1) : 'faltan ' + (ancho.necesita - ancho.linea).toFixed(1)} px)`);
    const filasTop = [...new Set(cc.map((c) => Math.round(c.top)))].sort((a, b) => a - b);
    const ordenIds = cc.slice().sort((a, b) => a.top - b.top || a.left - b.left).map((c) => c.id);
    ok(JSON.stringify(ordenIds) === JSON.stringify(['filtro-cobertura-puestos', 'input-limite-mesas', 'btn-guardar-limite-mesas', 'btn-excel-acreditacion', 'btn-avisar-todos']), 'los controles salen en el orden del diseño', ordenIds);
    if (w === 1600) ok(cc.every((c) => cerca(c.top, cc[0].top)), `a 1600 px TODOS los controles de la línea con el mismo top (±1 px): ${filasTop.join(', ')}`, cc.map((c) => [c.id, c.top]));
    else {
      const g = cc.filter((c) => ['filtro-cobertura-puestos', 'input-limite-mesas', 'btn-guardar-limite-mesas'].includes(c.id));
      ok(g.every((c) => cerca(c.top, g[0].top)), 'filtro, número y Guardar con el mismo top');
      const d = cc.filter((c) => c.id === 'btn-excel-acreditacion' || c.id === 'btn-avisar-todos');
      ok(cerca(d[0].top, d[1].top), 'Excel y Avisar con el mismo top');
    }
    console.log(`  info a ${w} px los controles ocupan ${filasTop.length} línea(s): tops ${filasTop.join(', ')} (los de la derecha ${filasTop.length === 1 ? 'caben en la misma línea' : 'bajan a la línea siguiente, alineados a la derecha'})`);
    const solapados = await ev(`(() => { const e = [...document.querySelectorAll('#linea-cobertura > *, #linea-cobertura .cob-der > *, #caja-limite-mesas > *')].filter(x => x.getBoundingClientRect().width > 0 && getComputedStyle(x).display !== 'none'); const mal = [];
      for (let i = 0; i < e.length; i++) for (let j = i + 1; j < e.length; j++) { if (e[i].contains(e[j]) || e[j].contains(e[i])) continue; const a = e[i].getBoundingClientRect(), b = e[j].getBoundingClientRect(); if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) mal.push((e[i].id || e[i].className) + '×' + (e[j].id || e[j].className)); } return mal; })()`);
    ok(solapados.length === 0, 'ningún control se monta sobre otro', solapados);
    const lbl = await ev(`(() => ({ titulo: document.querySelector('#linea-cobertura .cob-titulo').textContent.trim(), tituloTitle: document.querySelector('#linea-cobertura .cob-titulo').title,
      maxTexto: [...document.getElementById('caja-limite-mesas').childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(''), maxTitle: document.getElementById('caja-limite-mesas').title,
      avisarTitle: document.getElementById('btn-avisar-todos').title, conteo: document.getElementById('conteo-cobertura').textContent, peso: getComputedStyle(document.querySelector('#linea-cobertura .cob-titulo')).fontWeight,
      sinCubrir: document.querySelector('label.cob-casilla:has(#filtro-sin-cubrir)').textContent.trim(), titulo2: document.querySelector('label.cob-casilla:has(#filtro-sin-cubrir)').title,
      selAncho: document.getElementById('filtro-cobertura-puestos').getBoundingClientRect().width, numAncho: document.getElementById('input-limite-mesas').getBoundingClientRect().width,
      numAlinea: getComputedStyle(document.getElementById('input-limite-mesas')).textAlign, chk: [document.getElementById('filtro-sin-cubrir'), document.getElementById('chk-en-vivo')].map(e => e.getBoundingClientRect().width),
      guardar: getComputedStyle(document.getElementById('btn-guardar-limite-mesas')).backgroundColor, excel: document.getElementById('btn-excel-acreditacion').textContent.trim(), avisar: document.getElementById('btn-avisar-todos').textContent.trim(),
      aviso: (() => { const a = document.getElementById('aviso-ambito-puestos'); return { visible: a.offsetParent !== null, tam: getComputedStyle(a).fontSize, color: getComputedStyle(a).color, texto: a.textContent.slice(0, 40) }; })(),
      derecha: (() => { const d = document.querySelector('#linea-cobertura .cob-der').getBoundingClientRect(); const l = document.getElementById('linea-cobertura').getBoundingClientRect(); return l.right - d.right; })() }))()`);
    ok(lbl.titulo === '🛡️ Cobertura' && lbl.peso === '600' && lbl.tituloTitle === 'Cobertura de testigos', `título «${lbl.titulo}» en 600, con «${lbl.tituloTitle}» en title`, lbl);
    ok(lbl.selAncho === 170, `select «Todos los puestos» de 170 px (${lbl.selAncho})`);
    ok(lbl.maxTexto === 'Máx. mesas/testigo' && lbl.maxTitle === 'Máx. mesas por testigo', `«${lbl.maxTexto}» con «${lbl.maxTitle}» en title`, lbl);
    ok(lbl.avisarTitle === 'Avisar a todos los asignados' && lbl.conteo === '91 puestos', `«${lbl.avisar}» con «${lbl.avisarTitle}» en title; conteo «${lbl.conteo}»`, lbl);
    ok(lbl.sinCubrir === 'Solo sin cubrir' && /Solo con votantes sin cubrir/.test(lbl.titulo2), 'casilla «Solo sin cubrir» con el texto largo en title', lbl);
    ok(lbl.chk.every((x) => x === 16), 'casillas de 16 px', lbl.chk);
    ok(lbl.numAncho === 56 && lbl.numAlinea === 'center', 'campo de número de 56 px, centrado', lbl);
    ok(lbl.guardar === 'rgb(11, 94, 215)', 'Guardar primario #0B5ED7', lbl.guardar);
    ok(/Excel de acreditación/.test(lbl.excel) && /Avisar a asignados/.test(lbl.avisar), 'Excel de acreditación y Avisar a todos están', [lbl.excel, lbl.avisar]);
    ok(lbl.aviso.visible && lbl.aviso.tam === '13px', `aviso «Mostrando solo…» arriba en 13 px`, lbl.aviso);
    const filas = await ev("(() => { const l = document.getElementById('linea-cobertura'); const r = l.getBoundingClientRect(); return { alto: r.height, scroll: document.documentElement.scrollWidth - innerWidth }; })()");
    console.log(`  info línea de cobertura a ${w} px: alto ${filas.alto} px (${filas.alto <= 40 ? 'UNA sola línea' : 'envuelve en más de una línea'}), desborde horizontal ${filas.scroll}`);
    ok(filas.scroll <= 0, 'sin desborde horizontal de la página');
    await foto(`3-cobertura-${w}`, await caja('#linea-cobertura', 24));

    // Los controles siguen funcionando.
    const antes = await ev("document.querySelectorAll('#tabla-puestos-contenedor tbody tr').length");
    await ev("(() => { const c = document.getElementById('filtro-sin-cubrir'); c.click(); })()");
    await espera(400);
    const marcado = await ev("document.getElementById('filtro-sin-cubrir').checked");
    ok(marcado, 'la casilla «Solo sin cubrir» se marca y dispara el filtro (antes: ' + antes + ' filas)');
    await ev("document.getElementById('filtro-sin-cubrir').click()");
    ok(await ev("typeof document.getElementById('btn-guardar-limite-mesas').onclick !== 'undefined' && !!document.getElementById('btn-avisar-todos')"), 'Guardar y Avisar están en su sitio');
    ok(await ev("fetch('/configuracion.html').then((x) => x.text()).then((t) => t.includes('`${puestos.length} puestos`') && t.includes('`${visibles.length} de ${puestos.length} puestos`') && !t.includes('mostrando los'))"), 'el conteo de la pantalla dice «N puestos» (y «X de N puestos» al filtrar)');
    await recoger('cobertura ' + w);

    /* ===================================================================== 4. DÍA D */
    console.log(`\n[Día D · ${w}×${h}]`);
    ok(await abrir(w, h, '/dia-d.html', "!!document.getElementById('pestana-reportes') && document.getElementById('vista-reportes').style.display !== 'none'"), 'la pantalla carga');
    // En el arnés los módulos pueden estar apagados: se muestran las pestañas ocultas para medirlas (no cambia sus medidas).
    await ev("['resultados','alertas','transporte','logistica'].forEach(k => { const b = document.getElementById('pestana-' + k); if (b.style.display === 'none') b.style.display = 'inline-flex'; })");
    await ev("document.getElementById('btn-eliminar-todos-reportes').style.display = 'inline-flex'");
    await espera(300);
    const pe = await ev(CONTROLES('#pestanas-diad', 'button'));
    ok(pe.length === 5 && pe.every((c) => cerca(c.alto, 38, 0.6)), `las 5 pestañas de 38 px (${pe.map((c) => c.texto.split(' ')[0]).join(', ')})`, pe.map((c) => [c.texto, c.alto]));
    const pmin = await ev(`(() => ['pestana-reportes','pestana-resultados','pestana-alertas','pestana-transporte','pestana-logistica'].map((i) => { const e = document.getElementById(i); const c = getComputedStyle(e);
      const t = e.getBoundingClientRect().width; const svg = e.querySelector('svg.ico-pest'); const sr = svg && svg.getBoundingClientRect(); const sc = svg && getComputedStyle(svg);
      return { id: i, minW: c.minWidth, pad: c.paddingLeft + ' ' + c.paddingRight, ancho: t, svg: !!svg, svgW: sr && sr.width, svgH: sr && sr.height, trazo: svg && svg.getAttribute('stroke-width') + ' ' + svg.getAttribute('stroke'), antes: svg ? svg.nextSibling && svg.nextSibling.textContent.trim().slice(0, 12) : '' }; }))()`);
    ok(pmin.every((x) => x.minW === '0px' && x.pad === '14px 14px'), 'pestañas SIN ancho mínimo de 150 px y con padding 0 14px', pmin);
    ok(new Set(pe.map((c) => c.ancho)).size > 1 && pe.some((c) => c.ancho < 150), `las pestañas miden según su texto: ${pe.map((c) => c.ancho).join(' / ')}`);
    ok(pmin.every((x) => x.svg && x.svgW === 15 && x.svgH === 15 && x.trazo === '2 currentColor'), 'cada pestaña con ícono SVG de línea de 15 px (stroke 2, currentColor) antes del texto', pmin);
    const tops2 = [...new Set(pe.map((c) => Math.round(c.top)))];
    ok(tops2.length === 1, 'las pestañas en una sola línea');
    const est = await ev(`(() => { const a = getComputedStyle(document.getElementById('pestana-reportes')); const i = getComputedStyle(document.getElementById('pestana-resultados'));
      return { act: a.backgroundColor + ' ' + a.color, ina: i.backgroundColor + ' ' + i.color + ' ' + i.borderTopColor, radio: a.borderTopLeftRadius, letra: a.fontSize + ' ' + a.fontWeight }; })()`);
    ok(est.act === 'rgb(8, 66, 152) rgb(255, 255, 255)', 'pestaña activa #084298 con letra blanca (ya no dorada)', est);
    ok(/^rgb\(255, 255, 255\) rgb\(8, 66, 152\) rgb\(223, 227, 234\)$/.test(est.ina), 'pestañas inactivas blancas con borde', est);
    ok(est.radio === '8px' && est.letra === '13px 600', 'radio 8 px, letra 13 px / 600', est);
    const raya = await ev("getComputedStyle(document.getElementById('pestana-reportes')).boxShadow");
    ok(/rgb\(255, 195, 0\) 0px -3px 0px 0px inset/.test(raya), 'pestaña activa con raya inferior amarilla', raya);
    const acc = await ev(CONTROLES('#acciones-reportes-diad', 'a, button'));
    ok(acc.length === 2 && acc.every((c) => cerca(c.alto, 38, 0.6)), `los dos botones de acción de 38 px (${acc.map((c) => c.alto).join(' / ')})`, acc);
    ok(acc.length === 2 && cerca(acc[0].top, acc[1].top), 'los dos botones de acción en la misma línea');
    if (w === 1600) ok(pe.concat(acc).every((c) => cerca(c.top, pe[0].top)), `a 1600 px pestañas + divisor + «Reportes por puesto» + «Eliminar todos» con el mismo top (±1 px): ${pe.concat(acc).map((c) => c.top).join(' / ')}`);
    else console.log(`  info a ${w} px: tops pestañas ${pe.map((c) => c.top).join('/')}, acciones ${acc.map((c) => c.top).join('/')}`);
    const lado = await ev(`(() => { const l = document.querySelector('#acciones-reportes-diad .btn-reportes-puesto'); const e = document.getElementById('btn-eliminar-todos-reportes'); const c = document.getElementById('acciones-reportes-diad').getBoundingClientRect();
      const a = getComputedStyle(l), b = getComputedStyle(e); const dv = getComputedStyle(document.getElementById('acciones-reportes-diad'), '::before'); const ult = document.getElementById('pestana-logistica').getBoundingClientRect();
      const barra = document.getElementById('barra-diad'); return { izq: l.getBoundingClientRect().left - ult.right, der: c.right - e.getBoundingClientRect().right, a: a.backgroundColor + ' ' + a.color, b: b.backgroundColor + ' ' + b.borderTopColor + ' ' + b.color,
        div: dv.width + ' ' + dv.height + ' ' + dv.backgroundColor, desborde: barra.scrollWidth - barra.clientWidth, altoBarra: barra.getBoundingClientRect().height }; })()`);
    ok(lado.der < 2 && (w !== 1600 || (lado.izq > 10 && lado.izq < 40)), `«Reportes por puesto» después de las pestañas y el divisor; «Eliminar todos» pegado a la derecha (${lado.izq} / ${lado.der})`, lado);
    ok(lado.div === '1px 22px rgb(213, 220, 232)', 'divisor vertical de 1 px entre las pestañas y las acciones', lado);
    ok(lado.desborde <= 0, 'cero desbordes en la barra de Día D', lado);
    if (w === 1600) ok(lado.altoBarra < 60, `a 1600 px la barra completa mide una sola línea (${lado.altoBarra} px)`, lado);
    ok(lado.a === 'rgb(255, 195, 0) rgb(59, 47, 0)', 'Reportes por puesto: amarillo #FFC300 con letra #3B2F00', lado);
    ok(lado.b === 'rgb(255, 255, 255) rgb(240, 180, 180) rgb(198, 40, 40)', 'Eliminar todos: fondo blanco, borde #F0B4B4, letra #C62828', lado);
    if (w === 1600) { const y0 = await ev("document.getElementById('pestanas-diad').getBoundingClientRect().top + scrollY"); await foto('4-dia-d-1600', { x: 260, y: y0 - 20, width: w - 260, height: 90 }); }
    // La confirmación antes de eliminar sigue igual (se intercepta confirm: no se borra nada).
    await ev("window.__confirms = []; window.confirm = (m) => { window.__confirms.push(m); return false; }");
    await ev("document.getElementById('btn-eliminar-todos-reportes').click()");
    await espera(300);
    ok(JSON.stringify(await ev('window.__confirms')) === JSON.stringify(['¿Eliminar TODOS los reportes del Día D? Esta acción no se puede deshacer.']), 'Eliminar todos sigue pidiendo la confirmación de siempre');
    // Subpestañas de Resultados.
    await ev("document.getElementById('pestana-resultados').click()");
    await esperar("document.getElementById('vista-resultados').style.display === 'block'");
    await espera(500);
    const sp = await ev(CONTROLES('#subpestanas-diad', 'button'));
    ok(sp.length === 4 && sp.every((c) => cerca(c.alto, 38, 0.6)), `las 4 subpestañas de 38 px`, sp);
    const spe = await ev(`(() => { const b = [...document.querySelectorAll('#subpestanas-diad > button')]; const a = document.querySelector('[data-sub="consolidado"]'); const ac = getComputedStyle(a); const t = document.getElementById('pestana-resultados'); const tc = getComputedStyle(t);
      return { minW: b.map((x) => getComputedStyle(x).minWidth), pad: b.map((x) => getComputedStyle(x).paddingLeft + ' ' + getComputedStyle(x).paddingRight), act: ac.backgroundColor + ' ' + ac.color, sombra: ac.boxShadow,
        tabAct: tc.backgroundColor, accOculto: getComputedStyle(document.getElementById('acciones-reportes-diad')).display, tops: [...document.querySelectorAll('#pestanas-diad > button, #subpestanas-diad > button')].map((x) => x.getBoundingClientRect().top),
        div: getComputedStyle(document.getElementById('subpestanas-diad'), '::before').width, desborde: document.getElementById('barra-diad').scrollWidth - document.getElementById('barra-diad').clientWidth }; })()`);
    ok(spe.minW.every((x) => x === '0px') && spe.pad.every((x) => x === '10px 10px'), 'subpestañas sin ancho mínimo, padding 0 10px', spe);
    ok(spe.act === 'rgb(11, 94, 215) rgb(255, 255, 255)' && /rgb\(255, 195, 0\) 0px -3px 0px 0px inset/.test(spe.sombra), 'subpestaña activa #0B5ED7 (azul claro) con raya amarilla', spe);
    ok(spe.tabAct === 'rgb(8, 66, 152)', 'la pestaña Resultados activa sigue en #084298 (distinta de la subpestaña)', spe);
    ok(spe.accOculto === 'none' && spe.div === '1px', 'en Resultados desaparecen las acciones de Reportes y aparece el divisor de las subpestañas', spe);
    if (w === 1600) ok(spe.tops.every((y) => cerca(y, spe.tops[0])), `a 1600 px pestañas + divisor + subpestañas en UNA línea (mismo top ±1): ${spe.tops.join(' / ')}`, spe);
    ok(spe.desborde <= 0, 'cero desbordes en Resultados', spe);
    await ev("document.querySelector('[data-sub=\"oficial\"]').click()");
    await espera(400);
    ok(await ev("document.getElementById('sub-oficial').style.display") === 'block', 'el cambio de subpestaña (Resultado oficial) sigue funcionando');
    if (w === 1600) { await ev('window.scrollTo(0, 0)'); const y1 = await ev("document.getElementById('pestanas-diad').getBoundingClientRect().top + scrollY"); await foto('4b-dia-d-resultados-1600', { x: 260, y: y1 - 20, width: w - 260, height: 90 }); }
    await recoger('dia-d ' + w);
  }

  ok(errores.length === 0, 'cero errores de consola en las cuatro pantallas', errores.slice(0, 5));
  nav.cerrar(); s.close(); await pool.end();
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
