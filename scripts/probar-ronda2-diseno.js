#!/usr/bin/env node
// scripts/probar-ronda2-diseno.js
//
// ORDEN 141 (ronda 2 de diseño del escritorio), EN CHROMIUM REAL, con administrador, a 1600×900 y 1366×768. Complementa a probar-controles-uniformes.js
// (que cubre Organigrama y Día D · Reportes/Resultados) con lo que ese no mide:
//   · Día D · Alertas: 10 cápsulas → rejilla de 5 columnas iguales × 2 filas, tarjetas de 64 px, colores por gravedad, seleccionada, en 0, hover, filtro;
//     con más o menos de 10 sigue en 5 columnas; «N coordinadores sin avisos activados» como botón secundario con 🔔.
//   · Mensajes · crm.html «Elige el canal»: número + título + divisor + canales + nota en UNA línea; canales de 44 px con «Configurado» / «Sin configurar»;
//     etiqueta verde con el proveedor.
//   · Mensajes · enviar-email / enviar-sms / enviar-push: formularios en DOS columnas (mismo top, mismos left entre pasos), campos de 38 px, títulos de campo,
//     ayudas debajo, etiqueta «N destinatarios», destinatarios como etiquetas con ✕ (agregar y quitar), contadores (N caracteres / N/60), una columna bajo 1100 px,
//     y un envío de prueba con datos falsos (se intercepta la petición: no sale nada).
//   Cero errores de consola. Capturas a 1600 px en SALIDA.
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada141 [SALIDA=/ruta] node scripts/probar-ronda2-diseno.js
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

const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden141');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 900) : '')); }
}
const cerca = (a, b, tol = 1) => Math.abs(a - b) <= tol;

// Tipos de alerta tal como los manda el servidor (lib/alertasDiaD.js): 10 con los dos complementos encendidos.
const TIPOS = [
  ['mesa_sin_testigo_con_votantes', 1, 'Mesa sin testigo (con votantes)', 4, 0], ['testigo_no_llego', 2, 'Testigo que no llegó', 2, 3], ['mesa_sin_e14', 3, 'Mesa sin E-14', 0, 0],
  ['reporte_con_alertas', 4, 'Reporte con alertas', 1, 0], ['diferencia_con_oficial', 5, 'Diferencia con el oficial', 0, 2], ['baja_votacion', 6, 'Baja votación', 3, 0],
  ['transporte_sin_recoger', 7, 'Transporte sin recoger', 1, 1], ['logistica_sin_entregar', 8, 'Logística sin entregar', 5, 0], ['mesa_sin_testigo', 9, 'Mesa sin testigo (sin votantes)', 6, 0],
];
const fake = (tipos) => ({
  jornada: { modo_prueba: false, apertura: '08:00', cierre: '16:00', plazo_e14_min: 60, ahora: '2026-03-08 10:00:00', fecha_eleccion: '2026-03-08' },
  tipos: tipos.map(([tipo, gravedad, nombre, activas, pendientes]) => ({ tipo, gravedad, nombre, activas, pendientes })),
  total_activas: tipos.reduce((n, t) => n + t[3], 0), sin_votantes_omitidas: 0,
  alertas: tipos.filter((t) => t[3] > 0).slice(0, 5).map((t, i) => ({ id: 'a' + i, tipo: t[0], nombre_tipo: t[2], gravedad: t[1], puesto: 'Puesto ' + (i + 1), puesto_id: i + 1, mesa: i + 1, estado: 'activa', detalle: 'Detalle ' + i,
    desde: null, responsable: null, atendida: false })),
});

(async () => {
  await sembrar(pool);
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
  /** Rectángulos {top,left,width,height,bottom,right} de varios selectores (null si no existe o no se ve). */
  const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width && !r.height) return null;
    return { top: Math.round(r.top * 10) / 10, left: Math.round(r.left * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10, bottom: r.bottom, right: r.right }; })()`);
  const estilo = (sel, props) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const c = getComputedStyle(e); return ${JSON.stringify(props)}.map((k) => c[k]); })()`);

  for (const [w, h] of [[1600, 900], [1366, 768]]) {
    /* ===================================================================== A. DÍA D · ALERTAS */
    console.log(`\n[Día D · Alertas · ${w}×${h}]`);
    ok(await abrir(w, h, '/dia-d.html#alertas', "!!document.getElementById('chips-alertas') && typeof pintarAlertas === 'function'"), 'la pantalla carga');
    // Los módulos pueden estar apagados en el arnés: se muestra la vista y se pintan datos fijos con el mismo código de la pantalla (pintarAlertas).
    await ev(`(() => { ['vista-reportes','vista-resultados','vista-transporte','vista-logistica'].forEach((i) => { document.getElementById(i).style.display = 'none'; });
      document.getElementById('vista-alertas').style.display = 'block'; document.getElementById('barra-diad').setAttribute('data-vista', 'alertas');
      clearInterval(intervaloAlertas); filtroAlertas = ''; ultimasAlertas = ${JSON.stringify(fake(TIPOS))}; pintarAlertas(); })()`);
    await espera(300);
    const chips = await ev(`(() => [...document.querySelectorAll('#chips-alertas .al-chip')].map((e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); const b = e.querySelector('b'); const n = e.querySelector('.al-nom'); const sm = e.querySelector('small');
      const bc = getComputedStyle(b), nc = getComputedStyle(n), sc = sm && getComputedStyle(sm);
      return { tipo: e.dataset.tipo, top: Math.round(r.top * 10) / 10, left: Math.round(r.left * 10) / 10, ancho: Math.round(r.width * 10) / 10, alto: r.height, radio: c.borderTopLeftRadius, borde: c.borderTopWidth + ' ' + c.borderTopColor,
        bIzq: c.borderLeftWidth + ' ' + c.borderLeftColor, fondo: c.backgroundImage, op: c.opacity, num: bc.fontSize + ' ' + bc.fontWeight + ' ' + bc.color, nom: nc.fontSize + ' ' + nc.fontWeight, pend: sc ? sc.fontSize + ' ' + sc.color : '', numLeft: b.getBoundingClientRect().left,
        nomLeft: n.getBoundingClientRect().left, pendTop: sm ? sm.getBoundingClientRect().top : 0, nomBottom: n.getBoundingClientRect().bottom, cero: e.classList.contains('al-cero'), activo: e.classList.contains('activo'), texto: e.textContent.trim() }; }))()`);
    ok(chips.length === 10, `10 cápsulas (Todas + 9 tipos), las que genera hoy el servidor con los dos complementos (${chips.length})`);
    const filas = [...new Set(chips.map((c) => c.top))];
    const cols = [...new Set(chips.map((c) => c.left))];
    ok(filas.length === 2 && cols.length === 5, `rejilla de 5 columnas × 2 filas (filas: ${filas.join(', ')} · columnas: ${cols.join(', ')})`);
    ok(chips.every((c) => cerca(c.ancho, chips[0].ancho, 0.6)), `las 10 tarjetas del mismo ancho (${chips[0].ancho} px)`, chips.map((c) => c.ancho));
    ok(chips.every((c) => c.alto === 64), 'todas de 64 px de alto', chips.map((c) => c.alto));
    const gapH = chips[1].left - (chips[0].left + chips[0].ancho), gapV = chips[5].top - (chips[0].top + 64);
    ok(cerca(gapH, 10, 0.6) && cerca(gapV, 10, 0.6), `separación de 10 px (horizontal ${gapH.toFixed(1)}, vertical ${gapV.toFixed(1)})`);
    ok(chips.every((c) => c.radio === '12px') && chips.filter((c) => !c.activo).every((c) => c.borde === '1px rgb(223, 227, 234)'), 'radio 12 px y borde de 1 px #DFE3EA', chips[1]);
    const COL = { rojo: 'rgb(198, 40, 40)', naranja: 'rgb(217, 119, 6)', azul: 'rgb(11, 94, 215)', gris: 'rgb(107, 114, 128)' };
    const esperado = { mesa_sin_testigo_con_votantes: COL.rojo, testigo_no_llego: COL.rojo, mesa_sin_e14: COL.naranja, reporte_con_alertas: COL.naranja, diferencia_con_oficial: COL.naranja, baja_votacion: COL.azul,
      transporte_sin_recoger: COL.azul, logistica_sin_entregar: COL.azul, mesa_sin_testigo: COL.gris };
    const malColor = chips.filter((c) => c.tipo && !c.activo && c.bIzq !== '4px ' + esperado[c.tipo]);
    ok(malColor.length === 0, 'borde izquierdo de 4 px con el color de gravedad (rojo / naranja / azul / gris)', malColor.map((c) => [c.tipo, c.bIzq]));
    const todas = chips[0];
    ok(todas.tipo === '' && /^4px rgb\(8, 66, 152\)$/.test(todas.bIzq) && todas.activo, '«Todas» en azul oscuro y seleccionada al empezar', todas);
    ok(/linear-gradient\(/.test(todas.fondo) && /rgb\(11, 79, 179\)/.test(todas.fondo) && /rgb\(8, 66, 152\)/.test(todas.fondo), 'seleccionada: degradado #0B4FB3 → #084298', todas.fondo);
    ok(todas.num.endsWith('rgb(255, 195, 0)'), 'seleccionada: número en #FFC300', todas.num);
    const noSel = chips.filter((c) => c.tipo && c.num.startsWith('22px 800'));
    ok(noSel.length === 9 && noSel.every((c) => c.nom === '13px 600'), 'número de 22 px / 800 y nombre de 13 px / 600 en cada tarjeta', noSel.map((c) => [c.tipo, c.num, c.nom]));
    ok(chips.filter((c) => c.tipo && c.activo === false && !c.cero).every((c) => c.num.endsWith(esperado[c.tipo])), 'el número lleva el color de gravedad', chips.map((c) => [c.tipo, c.num]));
    ok(chips.every((c) => c.numLeft < c.nomLeft), 'número a la izquierda y nombre a su derecha', chips[1]);
    const conPend = chips.filter((c) => c.pend && !c.activo);
    ok(conPend.length >= 3 && conPend.every((c) => c.pend === '11px rgb(180, 83, 9)' && c.pendTop >= c.nomBottom - 1), `«+N pend.» debajo del nombre, 11 px #B45309 (${conPend.length} tarjetas)`, conPend.map((c) => [c.tipo, c.pend]));
    const ceros = chips.filter((c) => c.cero);
    ok(ceros.length >= 1 && ceros.every((c) => c.op === '0.6' && c.num.endsWith('rgb(156, 163, 175)')), `en 0 y sin pendientes: opacidad .6 y número gris (${ceros.length}: ${ceros.map((c) => c.tipo).join(', ')})`, ceros);
    ok(chips.some((c) => c.tipo === 'mesa_sin_e14' && c.cero) && !chips.find((c) => c.tipo === 'diferencia_con_oficial').cero, 'una tarjeta en 0 CON pendientes no se atenúa', chips.find((c) => c.tipo === 'diferencia_con_oficial'));
    // Hover: sube 2 px.
    const antes = await rect('#chips-alertas .al-chip[data-tipo="baja_votacion"]');
    await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: antes.left + 40, y: antes.top + 30 });
    await espera(350);
    const hover = await rect('#chips-alertas .al-chip[data-tipo="baja_votacion"]');
    ok(cerca(antes.top - hover.top, 2, 0.6), `hover: la tarjeta sube 2 px (${antes.top} → ${hover.top})`);
    await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    // Filtro: mismo filtro y mismos conteos.
    await ev("document.querySelector('#chips-alertas .al-chip[data-tipo=\"mesa_sin_e14\"]').click()");
    await espera(300);
    const filtrado = await ev("({ f: filtroAlertas, tipos: [...new Set([...document.querySelectorAll('#lista-alertas .al-fila')].map((e) => e.querySelector('.al-tipo').textContent))], act: document.querySelector('#chips-alertas .al-chip.activo').dataset.tipo, conteo: document.querySelector('#chips-alertas .al-chip.activo b').textContent })");
    ok(filtrado.f === 'mesa_sin_e14' && filtrado.act === 'mesa_sin_e14' && filtrado.conteo === '0', 'el filtro por tipo sigue funcionando (y la tarjeta elegida queda seleccionada)', filtrado);
    await ev("document.querySelector('#chips-alertas .al-chip[data-tipo=\"baja_votacion\"]').click()");
    await espera(300);
    ok(await ev("document.querySelectorAll('#lista-alertas .al-fila').length") === 1, 'filtro «Baja votación»: la lista muestra solo sus alertas');
    await ev("document.querySelector('#chips-alertas .al-chip[data-tipo=\"\"]').click()");
    ok(await ev("filtroAlertas") === '', '«Todas» quita el filtro');
    // Conteo de «Todas»: igual a la suma de los tipos.
    ok((await ev("document.querySelector('#chips-alertas .al-chip[data-tipo=\"\"]').textContent.replace(/\\s+/g, ' ').trim()")) === 'Todas 22+6 pend.', 'texto de «Todas»: «Todas 22+6 pend.» (suma de activas y de pendientes, igual que antes)');
    // Más o menos de 10 cápsulas: la rejilla sigue en 5 columnas.
    for (const [n, texto] of [[7, '6 tipos + Todas'], [12, '11 tipos + Todas']]) {
      const tipos = []; for (let i = 0; i < n - 1; i++) tipos.push(TIPOS[i % TIPOS.length].map((v, j) => (j === 0 ? v + (i >= TIPOS.length ? '_b' : '') : v)));
      await ev(`(() => { ultimasAlertas = ${JSON.stringify(fake(tipos))}; pintarAlertas(); })()`);
      await espera(200);
      const cx = await ev("[...document.querySelectorAll('#chips-alertas .al-chip')].map((e) => Math.round(e.getBoundingClientRect().left))");
      ok(cx.length === n && new Set(cx).size === 5, `con ${n} cápsulas (${texto}) la rejilla sigue en 5 columnas (${[...new Set(cx)].length})`);
    }
    await ev(`(() => { ultimasAlertas = ${JSON.stringify(fake(TIPOS))}; pintarAlertas(); })()`);
    // «N coordinadores sin avisos activados»: botón secundario con 🔔, 38 px.
    await ev(`(() => { const orig = window.api; window.api = (u, o) => (u === '/dia-d/alertas/avisos' ? Promise.resolve({ avisos_activos: true, sin_avisos: Array.from({ length: 12 }, (_, i) => ({ nombre: 'C' + i, telefono: '300' + i })) }) : orig(u, o)); })()`);
    await ev('cargarAvisos()');
    await espera(500);
    const av = await ev(`(() => { const b = document.getElementById('btn-sin-avisos'); const r = b.getBoundingClientRect(); const c = getComputedStyle(b); const ch = document.getElementById('chips-alertas').getBoundingClientRect();
      return { texto: b.textContent, clase: b.className, alto: r.height, radio: c.borderTopLeftRadius, fondo: c.backgroundColor, arriba: r.bottom <= ch.top }; })()`);
    ok(/^🔔 12 coordinadores sin avisos activados$/.test(av.texto) && /btn-secundario/.test(av.clase) && av.alto === 38 && av.arriba, 'botón secundario «🔔 12 coordinadores sin avisos activados», de 38 px y arriba de las tarjetas', av);
    if (w === 1600) await foto('3-alertas-1600', await caja('#vista-alertas', 20));
    await recoger('alertas ' + w);

    /* ===================================================================== B. MENSAJES · ELIGE EL CANAL */
    console.log(`\n[Mensajes · Elige el canal · ${w}×${h}]`);
    ok(await abrir(w, h, '/crm.html', "!!document.getElementById('paso-canal') && document.getElementById('estado-email').textContent !== ''"), 'la pantalla carga con los estados de canal');
    ok(await ev("[...document.styleSheets].some(h => /controles-uniformes\\.css/.test(h.href || ''))"), 'la hoja controles-uniformes.css está cargada');
    // Estado: email y push configurados, SMS sin configurar (lo que antes decía el punto verde / rojo).
    await ev(`(() => { const orig = window.api; window.api = (u, o) => (u === '/comunicaciones/estado-canales' ? Promise.resolve({ email: { configurado: true }, sms: { configurado: false, motivo: 'Falta la clave del proveedor de SMS.' }, push: { configurado: true } }) : orig(u, o)); })()`);
    await ev('cargarEstadoCanales()');
    await espera(500);
    const ca = await ev(`(() => ['email','sms','push'].map((c) => { const b = document.querySelector('#selector-canal [data-canal="' + c + '"]'); const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); const e = b.querySelector('.canal-estado'); const es = getComputedStyle(e);
      const n = b.querySelector('.canal-nom'); const ico = b.querySelector('.canal-ico'); return { c, alto: r.height, radio: cs.borderTopLeftRadius, top: r.top, ico: ico.textContent, nom: n.textContent, estado: e.textContent, estadoTam: es.fontSize, estadoColor: es.color, estadoDebajo: e.getBoundingClientRect().top >= n.getBoundingClientRect().bottom - 1,
        punto: getComputedStyle(b.querySelector('.punto-estado')).display, puntoClase: b.querySelector('.punto-estado').className, fondo: cs.backgroundImage }; }))()`);
    ok(ca.every((x) => x.alto === 44 && x.radio === '12px'), 'canales de 44 px de alto y radio 12 px', ca);
    ok(ca[0].ico === '✉️' && ca[1].ico === '💬' && ca[2].ico === '📱' && ca[0].nom === 'Email' && ca[1].nom === 'SMS' && ca[2].nom === 'Aviso en la app', 'íconos ✉️ 💬 📱 y los tres nombres de siempre', ca);
    ok(ca[0].estado === 'Configurado' && ca[1].estado === 'Sin configurar' && ca[2].estado === 'Configurado', 'el estado dice «Configurado» / «Sin configurar» según el punto de antes (clase ok/falta)', ca.map((x) => [x.c, x.estado, x.puntoClase]));
    ok(ca.every((x) => x.estadoTam === '11px' && x.estadoDebajo), 'estado en 11 px, debajo del nombre', ca);
    ok(ca[1].estadoColor === 'rgb(107, 114, 128)' && ca.every((x) => x.punto === 'none'), '«Sin configurar» en gris; el punto de color ya no se ve', ca);
    ok(ca[0].puntoClase === 'punto-estado ok' && ca[1].puntoClase === 'punto-estado falta', 'el script sigue poniendo ok/falta en el punto (lógica intacta)', ca);
    ok(/linear-gradient\(/.test(ca[0].fondo) && /rgb\(11, 94, 215\)/.test(ca[0].fondo) && /rgb\(8, 66, 152\)/.test(ca[0].fondo), 'canal elegido: degradado #0B5ED7 → #084298', ca[0].fondo);
    const nota = await ev(`(() => { const n = document.getElementById('nota-canal'); const c = getComputedStyle(n); return { texto: n.textContent, fondo: c.backgroundColor, borde: c.borderTopColor, color: c.color, radio: c.borderTopLeftRadius }; })()`);
    ok(nota.texto === '✓ Email sale por SendGrid' && nota.fondo === 'rgb(236, 253, 243)' && nota.borde === 'rgb(171, 239, 198)' && nota.color === 'rgb(6, 118, 71)' && parseFloat(nota.radio) >= 20, 'etiqueta verde «✓ Email sale por SendGrid» (#ECFDF3, borde #ABEFC6, texto #067647)', nota);
    // Una línea a 1600 px.
    const linea = await ev(`(() => { const p = document.getElementById('paso-canal'); const piezas = ['.paso-num', '.paso-cabeza h3', '#selector-canal [data-canal="email"]', '#selector-canal [data-canal="sms"]', '#selector-canal [data-canal="push"]', '#nota-canal']
      .map((s) => { const r = p.querySelector(s).getBoundingClientRect(); return { s, centro: r.top + r.height / 2, der: r.right }; }); const pr = p.getBoundingClientRect(); return { piezas, alto: pr.height, derPanel: pr.right, desborde: p.scrollWidth - p.clientWidth,
      div: getComputedStyle(document.getElementById('selector-canal'), '::before').width }; })()`);
    if (w === 1600) ok(linea.piezas.every((x) => cerca(x.centro, linea.piezas[0].centro, 2)) && linea.alto < 90, `a 1600 px número, título, divisor, canales y nota en UNA línea (alto del panel ${linea.alto} px)`, linea);
    else console.log(`  info a ${w} px: alto del panel ${linea.alto} px`);
    ok(linea.desborde <= 0 && linea.piezas.every((x) => x.der <= linea.derPanel + 0.5) && linea.div === '1px', 'cero desbordes y divisor de 1 px entre el título y los canales', linea);
    // Elegir otro canal sigue funcionando y cambia la nota.
    await ev("document.querySelector('#selector-canal [data-canal=\"sms\"]').click()");
    await espera(300);
    const sms = await ev("({ canal: canalElegido, nota: document.getElementById('nota-canal').textContent, color: getComputedStyle(document.getElementById('nota-canal')).color, activo: document.querySelector('#selector-canal .activo').dataset.canal })");
    ok(sms.canal === 'sms' && sms.activo === 'sms' && /Falta la clave/.test(sms.nota) && sms.color === 'rgb(169, 50, 38)', 'elegir SMS (sin configurar) sigue funcionando y muestra el motivo en rojo', sms);
    await ev("document.querySelector('#selector-canal [data-canal=\"push\"]').click()");
    ok((await ev("document.getElementById('nota-canal').textContent")) === '✓ Aviso en la app sale como notificación', 'Aviso en la app: etiqueta verde con la notificación');
    await ev("document.querySelector('#selector-canal [data-canal=\"email\"]').click()");
    if (w === 1600) await foto('5-elige-el-canal-1600', await caja('#paso-canal', 20));
    await recoger('crm ' + w);

    /* ===================================================================== C. MENSAJES · FORMULARIOS EN DOS COLUMNAS */
    for (const [pg, titulo, campoId, contacto] of [['email', 'Enviar E-mail', 'input-asunto', 'prueba.falsa@ejemplo.com'], ['sms', 'Enviar SMS', null, '3001234567'], ['push', 'Aviso en la app', 'input-titulo', '3001234567']]) {
      console.log(`\n[Mensajes · ${titulo} · ${w}×${h}]`);
      ok(await abrir(w, h, `/enviar-${pg}.html`, "!!document.getElementById('paso-destinatarios') && !!document.getElementById('input-buscar-contacto')"), 'la pantalla carga');
      ok(await ev("[...document.styleSheets].some(h => /controles-uniformes\\.css/.test(h.href || ''))"), 'la hoja controles-uniformes.css está cargada');
      // Paso destinatarios: dos columnas.
      const b1 = await rect('#paso-destinatarios .dos-col > .campo:nth-child(1)'), b2 = await rect('#paso-destinatarios .dos-col > .campo:nth-child(2)');
      ok(b1 && b2 && cerca(b1.top, b2.top, 1) && b2.left > b1.right && cerca(b1.width, b2.width, 1.5), `destinatarios: dos columnas iguales alineadas arriba (left ${b1.left} / ${b2.left}, ancho ${b1.width} / ${b2.width})`, [b1, b2]);
      ok(cerca(b2.left - b1.right, 20, 1), `separación de 20 px entre columnas (${(b2.left - b1.right).toFixed(1)})`);
      const lb = await ev(`(() => ['#paso-destinatarios .campo:nth-child(1) > label', '#paso-destinatarios .campo:nth-child(2) > label'].map((s) => { const e = document.querySelector(s); const c = getComputedStyle(e); const a = getComputedStyle(e, '::before');
        return { t: e.textContent.trim(), tam: c.fontSize, peso: c.fontWeight, color: c.color, bw: a.width, bh: a.height, bf: a.backgroundColor }; }))()`);
      ok(lb.every((x) => x.tam === '13px' && x.peso === '700' && x.color === 'rgb(8, 66, 152)' && x.bw === '4px' && x.bh === '14px' && x.bf === 'rgb(255, 195, 0)'), 'títulos de campo: 13 px, 700, #084298, con barrita amarilla de 4×14 px', lb);
      ok(lb[0].t === 'Buscar por nombre, cargo o nivel' && lb[1].t === 'O agrega manualmente', 'rótulos «Buscar por nombre, cargo o nivel» y «O agrega manualmente»', lb);
      const ay = await ev(`(() => ['#paso-destinatarios .campo:nth-child(1)', '#paso-destinatarios .campo:nth-child(2)'].map((s) => { const k = document.querySelector(s); const a = k.querySelector('.ayuda-campo'); const c = getComputedStyle(a); const campo = k.querySelector('input, textarea');
        return { t: a.textContent.trim(), tam: c.fontSize, debajo: a.getBoundingClientRect().top >= campo.getBoundingClientRect().bottom - 1 }; }))()`);
      ok(ay[0].t === 'Votantes, Estructura, Organigrama' && ay[1].t === 'Uno o varios, separados por coma, punto y coma, o cada uno en su línea' && ay.every((x) => x.tam === '12px' && x.debajo), 'ayudas debajo de cada campo, en 12 px', ay);
      const alt = await ev(`(() => ['#input-buscar-contacto', '#input-manual', '#btn-agregar-manual', '#select-plantilla', '#btn-guardar-plantilla', ${campoId ? "'#" + campoId + "'" : "'#btn-mostrar-panel-grupo'"}].filter((s) => document.querySelector(s))
        .map((s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { s, alto: r.height, radio: c.borderTopLeftRadius, borde: c.borderTopWidth + ' ' + c.borderTopColor, fondo: c.backgroundColor }; }))()`);
      ok(alt.every((x) => cerca(x.alto, 38, 0.6)), `campos y botones de una línea de 38 px: ${alt.map((x) => x.s.replace('#', '') + '=' + x.alto).join(', ')}`, alt);
      const campos = alt.filter((x) => /input|select/.test(x.s) && !/btn/.test(x.s));
      // Chromium redondea los bordes a píxeles enteros del dispositivo: a escala 1 el «1,5 px» se mide como 1 px (en pantallas 2x sale 1,5). Se comprueba también el valor declarado.
      const declarado = await ev("getComputedStyle(document.documentElement).getPropertyValue('--ctl-campo-borde').trim()");
      ok(campos.every((x) => x.radio === '8px' && /^1(\.5)?px rgb\(213, 220, 232\)$/.test(x.borde) && x.fondo === 'rgb(255, 255, 255)') && declarado === '1.5px solid #D5DCE8', 'campos: fondo blanco, borde 1,5 px #D5DCE8 (declarado), radio 8 px', [campos, declarado]);
      const man = await rect('#input-manual'), btn = await rect('#btn-agregar-manual');
      ok(man && btn && btn.left >= man.right && cerca(btn.top, man.top, 1), 'botón Agregar al lado del campo manual', [man, btn]);
      // El campo manual crece con varias líneas.
      await ev("(() => { const c = document.getElementById('input-manual'); c.value = 'uno\\ndos\\ntres'; c.dispatchEvent(new Event('input', { bubbles: true })); })()");
      await espera(250);
      const crece = (await rect('#input-manual')).height;
      ok(crece > 45, `el campo manual crece al escribir varias líneas (${man.height} → ${crece} px)`);
      await ev("document.getElementById('input-manual').value = ''");
      await espera(150);
      // Etiqueta verde de destinatarios y etiquetas con ✕.
      const et0 = await ev("(() => { const e = document.getElementById('etiqueta-destinatarios'); const c = getComputedStyle(e); const r = e.getBoundingClientRect(); const p = document.querySelector('#paso-destinatarios').getBoundingClientRect(); return { t: e.textContent, f: c.backgroundColor, b: c.borderTopColor, c: c.color, der: p.right - r.right }; })()");
      ok(et0.t === '0 destinatarios' && et0.f === 'rgb(236, 253, 243)' && et0.b === 'rgb(171, 239, 198)' && et0.c === 'rgb(6, 118, 71)' && et0.der < 40, 'etiqueta verde «0 destinatarios» a la derecha del título del paso', et0);
      await ev(`(() => { const c = document.getElementById('input-manual'); c.value = ${JSON.stringify(contacto)}; document.getElementById('btn-agregar-manual').click(); })()`);
      await espera(500);
      const et1 = await ev(`(() => { const ch = document.querySelector('#lista-seleccionados .chip-contacto'); if (!ch) return { hay: false, n: document.getElementById('conteo-seleccionados').textContent, etq: document.getElementById('etiqueta-destinatarios').textContent }; const c = getComputedStyle(ch); const b = ch.querySelector('button');
        return { hay: true, etq: document.getElementById('etiqueta-destinatarios').textContent, n: document.getElementById('conteo-seleccionados').textContent, f: c.backgroundColor, b: c.borderTopColor, col: c.color, r: c.borderTopLeftRadius, x: b.textContent.trim() }; })()`);
      ok(et1.hay && et1.etq === '1 destinatario' && et1.n === '1', 'al agregar un contacto: «1 destinatario» y el conteo «Seleccionados (1)» sigue igual', et1);
      ok(et1.f === 'rgb(238, 244, 255)' && et1.b === 'rgb(207, 224, 255)' && et1.col === 'rgb(8, 66, 152)' && parseFloat(et1.r) >= 20 && et1.x === '✕', 'destinatario como etiqueta (#EEF4FF, borde #CFE0FF, texto #084298, radio 999) con ✕', et1);
      if (w === 1600) await foto(`6-${pg}-destinatarios-1600`, await caja('#paso-destinatarios', 20));
      // Paso mensaje.
      const m1 = await rect('#paso-mensaje .dos-col > .campo:nth-child(1)'), m2 = await rect('#paso-mensaje .dos-col > .campo:nth-child(2)');
      if (pg === 'sms') {
        ok(m1 === null && !!(await rect('#input-mensaje')) && !!(await rect('#contador-sms')), 'SMS: no tiene la estructura Asunto/Mensaje: el paso queda en una columna y conserva su contador de segmentos');
      } else {
        ok(m1 && m2 && cerca(m1.top, m2.top, 1) && m2.left > m1.right && cerca(m1.width, m2.width, 1.5), `mensaje: dos columnas iguales alineadas arriba (left ${m1.left} / ${m2.left})`, [m1, m2]);
        ok(cerca(m1.left, b1.left, 1) && cerca(m2.left, b2.left, 1), `columnas alineadas entre pasos: left ${m1.left}=${b1.left} y ${m2.left}=${b2.left}`);
        const ma = await ev(`(() => { const c1 = document.querySelector('#paso-mensaje .dos-col > .campo:nth-child(1)'), c2 = document.querySelector('#paso-mensaje .dos-col > .campo:nth-child(2)'); const pl = c2.querySelector('#select-plantilla').getBoundingClientRect(), tx = c2.querySelector('#input-mensaje').getBoundingClientRect(), g = c2.querySelector('#btn-guardar-plantilla').getBoundingClientRect();
          return { izq: c1.querySelector('input').id, plantillaArriba: pl.bottom <= tx.top, guardarMismaFila: Math.abs(g.top - pl.top) <= 1, tx: tx.height }; })()`);
        ok(ma.izq === campoId && ma.plantillaArriba && ma.guardarMismaFila, `izquierda: ${campoId}; derecha: Plantillas + Guardar como plantilla y el cuadro de texto debajo`, ma);
        // Contador.
        const maxl = await ev(`document.getElementById(${JSON.stringify(campoId)}).maxLength`);
        await ev(`(() => { const c = document.getElementById(${JSON.stringify(campoId)}); c.value = 'Hola'; c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        const cont = await ev("(() => { const e = document.getElementById('contador-campo'); const r = e.getBoundingClientRect(); const l = e.parentElement.getBoundingClientRect(); return { t: e.textContent, der: l.right - r.right, tam: getComputedStyle(e).fontSize }; })()");
        if (pg === 'push') ok(maxl === 60 && cont.t === '4/60' && cont.der < 2, `Título del aviso (maxlength ${maxl} ya existente): contador «${cont.t}» a la derecha del título del campo`, cont);
        else ok(maxl === -1 && cont.t === '4 caracteres' && cont.der < 2, `Asunto (sin maxlength: no se inventa límite): contador «${cont.t}» a la derecha del título del campo`, [maxl, cont]);
        await ev(`(() => { const c = document.getElementById(${JSON.stringify(campoId)}); c.value = ''; c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        if (w === 1600) await foto(`7-${pg}-mensaje-1600`, await caja('#paso-mensaje', 20));
      }
      // Por debajo de 1100 px, una columna.
      if (w === 1366) {
        await encuadre(1000, 800);
        await espera(500);
        const u1 = await rect('#paso-destinatarios .dos-col > .campo:nth-child(1)'), u2 = await rect('#paso-destinatarios .dos-col > .campo:nth-child(2)');
        ok(cerca(u1.left, u2.left, 1) && u2.top >= u1.bottom, `a 1000 px el formulario pasa a UNA columna (left ${u1.left} / ${u2.left})`, [u1, u2]);
        await encuadre(w, h);
        await espera(300);
      }
      // Quitar un destinatario.
      await ev("document.querySelector('#lista-seleccionados .chip-contacto button').click()");
      await espera(300);
      const et2 = await ev("({ etq: document.getElementById('etiqueta-destinatarios').textContent, n: document.getElementById('conteo-seleccionados').textContent, chips: document.querySelectorAll('#lista-seleccionados .chip-contacto').length })");
      ok(et2.etq === '0 destinatarios' && et2.n === '0' && et2.chips === 0, 'quitar un destinatario con ✕ sigue funcionando (vuelve a «0 destinatarios»)', et2);
      // Envío de prueba con datos falsos: se intercepta la petición (no sale nada) y se comprueba lo que se mandaría.
      await ev(`(() => { window.__envios = []; const orig = window.api; window.api = (u, o) => { if (u === '/comunicaciones/campanas' && o && o.method === 'POST') { window.__envios.push(o.body); return Promise.resolve({ total_destinatarios: 1, enviados: 1 }); } return orig(u, o); }; })()`);
      await ev(`(() => { const c = document.getElementById('input-manual'); c.value = ${JSON.stringify(contacto)}; document.getElementById('btn-agregar-manual').click(); })()`);
      await espera(300);
      if (campoId) await ev(`(() => { const c = document.getElementById(${JSON.stringify(campoId)}); c.value = 'Asunto falso de prueba'; c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await ev("(() => { const c = document.getElementById('input-mensaje'); c.value = 'Mensaje falso de prueba para {nombre}'; c.dispatchEvent(new Event('input', { bubbles: true })); })()");
      await ev("document.getElementById('btn-enviar').click()");
      await espera(900);
      const env = await ev('window.__envios');
      ok(env.length === 1 && env[0].mensaje === 'Mensaje falso de prueba para {nombre}' && (!campoId || env[0].asunto === 'Asunto falso de prueba') && JSON.stringify(env[0].filtros).includes(contacto), 'el envío de prueba arma la misma petición de siempre (asunto/título, mensaje y destinatario)', env);
      if (pg === 'email') ok(await ev(`document.getElementById('input-asunto').value === '' && document.getElementById('contador-campo').textContent.startsWith('0')`), 'tras enviar, el asunto se limpia y el contador vuelve a 0');
      await recoger(`${pg} ${w}`);
    }
  }

  ok(errores.length === 0, 'cero errores de consola en Alertas, Elige el canal y los tres formularios', errores.slice(0, 6));
  nav.cerrar(); s.close(); await pool.end();
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
