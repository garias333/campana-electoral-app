#!/usr/bin/env node
// scripts/probar-mensaje-2x2-biografia.js
//
// ORDEN 143, EN CHROMIUM REAL, a 1600×900 y 1366×768, con administrador, datos y biografía cargada:
//
//   A. MENSAJERÍA · crm.html, paso 3 «Escribe el mensaje» en DOS FILAS × DOS COLUMNAS.
//      · Los cuatro bloques en 2×2: left(Nombre) = left(Mensaje) y left(Asunto) = left(cuadro de texto), ±1 px; dos filas, no cuatro.
//      · Rejilla 1fr 1fr con separación 16 px / 20 px; el cuadro de texto arranca a la altura del select de plantillas (±1 px) y mide 120 px o más.
//      · Con canal SMS el Asunto se esconde y el Nombre NO se estira: se queda en su columna y la derecha queda vacía.
//      · Con «Aviso en la app» (push) el Asunto vuelve: ahí hace de Título del aviso, y va en la columna del Asunto.
//      · Acabado de la 141: campos de 38 px blancos con borde de 1,5 px declarado, títulos #084298 con barrita amarilla, botones de 38 px.
//      · Por debajo de 1100 px, una sola columna.
//      · El envío sigue igual: se intercepta POST /api/crm/campanas y se comprueba que manda nombre, asunto y mensaje como siempre (no sale nada).
//
//   B. CONTENIDO PARA COMPARTIR · recursos.html, filtro «Biografía».
//      · Con «Biografía»: se ve la biografía COMPLETA (no recortada), foto de 120 px con borde de 4 px #FFC300, el nombre, «Copiar texto» y
//        «Editar biografía», que abre el mismo editor de siempre. La tarjeta resumida de arriba se esconde (no se duplica la biografía).
//      · Con «Todos los tipos»: la tarjeta resumida vuelve, como hoy, y la biografía grande desaparece.
//      · Sin biografía: «Aún no hay biografía» y botón «Agregar biografía».
//      · Un usuario sin permiso de edición (coordinador) NO ve «Editar biografía» ni «Agregar biografía».
//      · La barra de tipos con el acabado de la 138/141: 38 px, blanca con borde, la elegida en #084298 con raya amarilla de 3 px, en UNA línea
//        y desplazable sin barra visible. «+ Subir recurso», amarillo de 38 px.
//
//   Cero errores de consola. Capturas a 1600 px en SALIDA.
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada143 [SALIDA=/ruta] node scripts/probar-mensaje-2x2-biografia.js
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

const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden143');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 900) : '')); }
}
const cerca = (a, b, tol = 1) => Math.abs(a - b) <= tol;

const AZUL = 'rgb(8, 66, 152)';
const AMARILLO = 'rgb(255, 195, 0)';
const BIO = 'Nació en el barrio y estudió en el colegio público de la esquina.\n\n'
  + 'Trabajó quince años en la empresa de acueducto, donde fue representante de los trabajadores, y coordinó la junta de acción comunal '
  + 'durante dos periodos seguidos.\n\n'
  + 'Es madre de dos hijos, ingeniera civil de la universidad pública y la primera de su familia en terminar una carrera. '
  + 'Su trabajo en el acueducto la llevó a recorrer las treinta y dos veredas del municipio, una por una, antes de pensar en presentarse.\n\n'
  + 'Esta biografía es larga a propósito: tiene que pasar de cuatro líneas para que la tarjeta de arriba la recorte y la vista grande la muestre entera.';

(async () => {
  await sembrar(pool);
  // La biografía del candidato, con foto: es el mismo dato que lee el celular (contenido_paginas.clave = 'biografia_candidato').
  await pool.query(
    `INSERT INTO contenido_paginas (clave, titulo, contenido, foto_url) VALUES ('biografia_candidato', 'Biografía del candidato', ?, '/img/logo.png')
     ON DUPLICATE KEY UPDATE titulo = VALUES(titulo), contenido = VALUES(contenido), foto_url = VALUES(foto_url)`, [BIO]);

  const s = http.createServer(crear(pool));
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; const ce = console.error; console.error = function () { window.__errs.push([].slice.call(arguments).join(' ')); ce.apply(console, arguments); }; window.addEventListener('error', function (e) { window.__errs.push('ERR ' + e.message); });` });
  await cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
  const errores = [];
  const recoger = async (donde) => { try { (await ev('window.__errs || []')).forEach((e) => errores.push(donde + ': ' + e)); } catch (_) { /* página cambiando */ } };
  const encuadre = (w, h) => cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const esperar = async (expr, ms = 15000) => { const hasta = Date.now() + ms; while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); } return false; };
  const foto = async (nombre) => {
    const r = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width && !r.height) return null;
    return { top: Math.round(r.top * 10) / 10, left: Math.round(r.left * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 }; })()`);
  const estilo = (sel, props) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const c = getComputedStyle(e); return ${JSON.stringify(props)}.map((k) => c[k]); })()`);
  const texto = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
  const clic = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
  const visible = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && getComputedStyle(e).display !== 'none' && e.offsetParent !== null; })()`);

  /** Abre pasando por about:blank: `Page.navigate` a la misma página con otro `#` no recarga (lección de la orden 144). */
  async function abrir(w, h, url, listo, usuario = '1') {
    await encuadre(w, h);
    await cmd('Page.navigate', { url: 'about:blank' });
    await espera(150);
    await cmd('Network.clearBrowserCookies');
    await cmd('Network.setCookie', { name: 'ej_usuario', value: usuario, url: base });
    await cmd('Page.navigate', { url: base + url });
    const l = await esperar(listo, 20000);
    await espera(700);
    return l;
  }

  const LISTO_CRM = "!!document.getElementById('paso-mensaje-campana') && !!document.getElementById('input-mensaje-campana')";
  const LISTO_REC = "!!document.getElementById('filtros-chips') && document.querySelectorAll('#filtros-chips .chip-filtro').length === 10";

  for (const [w, h] of [[1600, 900], [1366, 768]]) {
    console.log(`\n========== ${w}×${h} ==========`);

    /* ===================================================================== A. EL FORMULARIO EN 2×2 */
    console.log('\n[A. crm.html · «Escribe el mensaje» en 2 filas × 2 columnas]');
    ok(await abrir(w, h, '/crm.html', LISTO_CRM), 'la pantalla de campañas de mensajes carga');
    // El canal por omisión puede ser cualquiera: se fuerza Email, que es el que trae Asunto.
    await ev(`(() => { const b = [...document.querySelectorAll('#paso-canal [data-canal], #paso-canal button')].find((x) => /email/i.test(x.dataset.canal || x.textContent)); if (b) b.click(); })()`);
    await espera(500);

    const cajas = await ev(`(() => { const r = {}; [['nombre','#input-nombre-campana'],['asunto','#input-asunto-campana'],['celdaNombre','.celda-nombre'],
      ['celdaAsunto','#campo-asunto'],['celdaPlantillas','.celda-plantillas'],['celdaTexto','.celda-texto'],['select','#select-plantilla'],
      ['texto','#input-mensaje-campana'],['rotuloMensaje','.celda-plantillas > label'],['ayuda','.celda-plantillas .ayuda-campo'],
      ['guardarPlantilla','#btn-guardar-plantilla']].forEach(([k, sel]) => { const e = document.querySelector(sel);
        if (!e) { r[k] = null; return; } const b = e.getBoundingClientRect();
        r[k] = { top: Math.round(b.top * 10) / 10, left: Math.round(b.left * 10) / 10, width: Math.round(b.width * 10) / 10, height: Math.round(b.height * 10) / 10 }; });
      return r; })()`);
    ok(cajas.celdaNombre && cajas.celdaAsunto && cajas.celdaPlantillas && cajas.celdaTexto, 'las cuatro celdas existen', Object.keys(cajas).filter((k) => !cajas[k]));

    if (w >= 1100) {
      ok(cerca(cajas.nombre.left, cajas.rotuloMensaje.left, 1),
        `left del Nombre = left del rótulo «Mensaje» (${cajas.nombre.left} vs ${cajas.rotuloMensaje.left})`);
      ok(cerca(cajas.asunto.left, cajas.texto.left, 1),
        `left del Asunto = left del cuadro de texto (${cajas.asunto.left} vs ${cajas.texto.left})`);
      ok(cerca(cajas.celdaNombre.top, cajas.celdaAsunto.top, 1), 'Nombre y Asunto en la MISMA fila', [cajas.celdaNombre.top, cajas.celdaAsunto.top]);
      ok(cerca(cajas.celdaPlantillas.top, cajas.celdaTexto.top, 1), 'plantillas y cuadro de texto en la MISMA fila', [cajas.celdaPlantillas.top, cajas.celdaTexto.top]);
      ok(cajas.celdaPlantillas.top > cajas.celdaNombre.top, 'la segunda fila va debajo de la primera', [cajas.celdaNombre.top, cajas.celdaPlantillas.top]);
      ok(cajas.celdaAsunto.left > cajas.celdaNombre.left, 'el Asunto, a la derecha del Nombre', [cajas.celdaNombre.left, cajas.celdaAsunto.left]);
      // «alineado arriba con el select»
      ok(cerca(cajas.texto.top, cajas.select.top, 1), `el cuadro de texto arranca a la altura del select (${cajas.texto.top} vs ${cajas.select.top})`);
      // dos columnas iguales
      ok(cerca(cajas.celdaNombre.width, cajas.celdaAsunto.width, 1), 'las dos columnas, del mismo ancho', [cajas.celdaNombre.width, cajas.celdaAsunto.width]);
      const sep = await estilo('#paso-mensaje-campana .dos-por-dos', ['gridTemplateColumns', 'rowGap', 'columnGap']);
      ok(sep && sep[1] === '16px' && sep[2] === '20px', 'separación de 16 px entre filas y 20 px entre columnas', sep);
      ok(sep && sep[0].split(' ').length === 2, 'rejilla de dos columnas (1fr 1fr)', sep && sep[0]);
    }
    ok(cajas.texto.height >= 120, `el cuadro de texto mide 120 px o más (${cajas.texto.height})`);
    ok(cajas.ayuda, 'la ayuda de {nombre} y {baja} está a la vista, no solo dentro del placeholder');
    const ayudaEstilo = await estilo('.celda-plantillas .ayuda-campo', ['fontSize', 'color']);
    ok(ayudaEstilo && ayudaEstilo[0] === '12px' && ayudaEstilo[1] === 'rgb(107, 114, 128)', 'la ayuda, en 12 px gris', ayudaEstilo);
    const txtAyuda = await texto('.celda-plantillas .ayuda-campo');
    ok(/\{nombre\}/.test(txtAyuda) && /\{baja\}/.test(txtAyuda), 'y dice lo de {nombre} y {baja}', txtAyuda);

    // Acabado de la 141
    const campos = await ev(`(() => [...document.querySelectorAll('#paso-mensaje-campana .dos-por-dos input, #paso-mensaje-campana .dos-por-dos select')]
      .filter((e) => e.offsetParent !== null).map((e) => { const c = getComputedStyle(e);
        return { id: e.id, alto: Math.round(e.getBoundingClientRect().height * 10) / 10, fondo: c.backgroundColor, color: c.borderTopColor, radio: c.borderTopLeftRadius }; }))()`);
    ok(campos.length >= 3, `se miden los campos del paso (${campos.length})`, campos.map((c) => c.id));
    ok(campos.every((c) => cerca(c.alto, 38, 0.6)), 'campos de 38 px', campos.map((c) => [c.id, c.alto]));
    ok(campos.every((c) => c.fondo === 'rgb(255, 255, 255)' && c.color === 'rgb(213, 220, 232)'), 'blancos con borde #D5DCE8', campos.map((c) => [c.id, c.fondo, c.color]));
    ok(campos.every((c) => c.radio === '8px'), 'radio de 8 px', campos.map((c) => [c.id, c.radio]));
    const rotulo = await estilo('.celda-nombre > label', ['fontSize', 'fontWeight', 'color']);
    ok(rotulo && rotulo[0] === '13px' && rotulo[1] === '700' && rotulo[2] === AZUL, 'títulos de campo 13 px / 700 / #084298', rotulo);
    const barrita = await ev(`(() => { const c = getComputedStyle(document.querySelector('.celda-nombre > label'), '::before'); return [c.backgroundColor, c.width, c.height]; })()`);
    ok(barrita[0] === AMARILLO && barrita[1] === '4px' && barrita[2] === '14px', 'con la barrita amarilla de 4×14 px', barrita);
    const botonPlantilla = await rect('#btn-guardar-plantilla');
    ok(botonPlantilla && cerca(botonPlantilla.height, 38, 0.6), `«Guardar como plantilla», de 38 px (${botonPlantilla && botonPlantilla.height})`);

    // SMS: el Asunto se esconde y el Nombre NO se estira.
    const anchoNombreEmail = cajas.celdaNombre.width;
    await ev(`(() => { const b = [...document.querySelectorAll('#paso-canal [data-canal], #paso-canal button')].find((x) => /sms/i.test(x.dataset.canal || x.textContent)); if (b) b.click(); })()`);
    await espera(500);
    const conSms = await ev(`(() => ({ asunto: getComputedStyle(document.getElementById('campo-asunto')).display,
      nombre: Math.round(document.querySelector('.celda-nombre').getBoundingClientRect().width * 10) / 10,
      nombreLeft: Math.round(document.querySelector('.celda-nombre').getBoundingClientRect().left * 10) / 10,
      textoLeft: Math.round(document.getElementById('input-mensaje-campana').getBoundingClientRect().left * 10) / 10,
      plantillasTop: Math.round(document.querySelector('.celda-plantillas').getBoundingClientRect().top * 10) / 10,
      nombreTop: Math.round(document.querySelector('.celda-nombre').getBoundingClientRect().top * 10) / 10 }))()`);
    ok(conSms.asunto === 'none', 'con SMS, el Asunto se esconde', conSms.asunto);
    ok(cerca(conSms.nombre, anchoNombreEmail, 1), `y el Nombre NO se estira: sigue en su columna (${conSms.nombre} vs ${anchoNombreEmail})`);
    if (w >= 1100) {
      ok(conSms.plantillasTop > conSms.nombreTop, 'las celdas de abajo NO suben al hueco del Asunto', conSms);
      ok(cerca(conSms.textoLeft, cajas.texto.left, 1), 'el cuadro de texto se queda en la columna derecha', [conSms.textoLeft, cajas.texto.left]);
    }
    // Push: el Asunto vuelve (ahí hace de Título del aviso) y va en la columna del Asunto.
    await ev(`(() => { const b = [...document.querySelectorAll('#paso-canal [data-canal], #paso-canal button')].find((x) => /push|aviso/i.test(x.dataset.canal || x.textContent)); if (b) b.click(); })()`);
    await espera(500);
    const conPush = await ev(`(() => { const a = document.getElementById('campo-asunto'); const r = a.getBoundingClientRect();
      return { display: getComputedStyle(a).display, left: Math.round(r.left * 10) / 10, top: Math.round(r.top * 10) / 10 }; })()`);
    ok(conPush.display !== 'none', 'con «Aviso en la app», el Asunto vuelve (hace de Título del aviso)', conPush);
    if (w >= 1100) ok(cerca(conPush.left, cajas.celdaAsunto.left, 1), 'y en la MISMA columna del Asunto', [conPush.left, cajas.celdaAsunto.left]);

    /* El envío, igual que siempre. Se intercepta `api()` —no `fetch`— porque es
       por donde pasa esta pantalla, y el cuerpo es un FormData, no JSON. El
       canal se marca como configurado sólo para llegar hasta el envío: en el
       arnés no hay SendGrid y el código se corta antes, con razón. No sale nada. */
    await ev(`(() => { const b = [...document.querySelectorAll('#paso-canal [data-canal], #paso-canal button')].find((x) => /email/i.test(x.dataset.canal || x.textContent)); if (b) b.click(); })()`);
    await espera(400);
    const envios = await ev(`(async () => {
      window.__envios = [];
      const orig = window.api;
      window.api = (u, o) => {
        if (u === '/comunicaciones/campanas' && o && o.method === 'POST') {
          window.__envios.push(Object.fromEntries(o.body.entries()));
          return Promise.resolve({ total_destinatarios: 1 });
        }
        return orig(u, o);
      };
      estadoCanales[canalElegido] = Object.assign({}, estadoCanales[canalElegido], { configurado: true });
      document.getElementById('input-nombre-campana').value = 'Campaña de prueba 143';
      document.getElementById('input-asunto-campana').value = 'Asunto de prueba';
      document.getElementById('input-mensaje-campana').value = 'Hola {nombre}, esto es una prueba.';
      document.getElementById('btn-enviar-campana').click();
      await new Promise((r) => setTimeout(r, 1500));
      window.api = orig;
      return window.__envios;
    })()`);
    ok(envios.length === 1 && envios[0].nombre === 'Campaña de prueba 143' && envios[0].asunto === 'Asunto de prueba'
      && envios[0].mensaje === 'Hola {nombre}, esto es una prueba.' && envios[0].canal === 'email',
      'el envío arma la misma petición de siempre: nombre, canal, asunto, mensaje y filtros', envios);
    ok(envios.length === 1 && typeof envios[0].filtros === 'string', 'con los filtros de destinatarios, como antes', envios[0] && envios[0].filtros);
    await recoger(`crm ${w}×${h}`);

    /* ===================================================================== B. BIOGRAFÍA */
    console.log('\n[B. recursos.html · el filtro «Biografía»]');
    ok(await abrir(w, h, '/recursos.html', LISTO_REC), 'Contenido para compartir carga con sus diez tipos');

    // La barra de tipos, con el acabado de la 138/141.
    const pestanas = await ev(`(() => [...document.querySelectorAll('#filtros-chips .chip-filtro')].map((e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
      return { tipo: e.dataset.tipo, texto: e.textContent.trim(), top: Math.round(r.top * 10) / 10, alto: Math.round(r.height * 10) / 10,
        fondo: c.backgroundColor, borde: c.borderTopColor, color: c.color, sombra: c.boxShadow, activa: e.classList.contains('activo') }; }))()`);
    ok(pestanas.length === 10, `diez tipos (${pestanas.length})`);
    ok(pestanas.every((x) => cerca(x.alto, 38, 0.6)), 'todas de 38 px', pestanas.map((x) => [x.tipo, x.alto]));
    const unaLinea = [...new Set(pestanas.map((x) => x.top))];
    ok(unaLinea.length === 1, `todas en UNA línea (tops: ${unaLinea.join(', ')})`);
    const barra = await estilo('#filtros-chips', ['overflowX', 'flexWrap', 'scrollbarWidth']);
    ok(barra && (barra[0] === 'auto' || barra[0] === 'scroll') && barra[1] === 'nowrap', 'la barra se desplaza de lado, sin partirse en dos filas', barra);
    ok(barra && barra[2] === 'none', 'y sin barra de desplazamiento visible', barra && barra[2]);
    const sinActivar = pestanas.filter((x) => !x.activa);
    ok(sinActivar.every((x) => x.fondo === 'rgb(255, 255, 255)' && x.borde === 'rgb(223, 227, 234)'), 'las no elegidas, blancas con borde', sinActivar.slice(0, 3));
    const act = pestanas.find((x) => x.activa);
    ok(act && act.tipo === '' && act.fondo === AZUL && act.color === 'rgb(255, 255, 255)', '«Todos los tipos» empieza elegida, en #084298', act);
    // Chromium serializa la sombra con el color DELANTE: «rgb(255, 195, 0) 0px -3px 0px 0px inset».
    ok(act && /rgb\(255, 195, 0\) 0px -3px 0px 0px inset/.test(act.sombra), 'con raya inferior amarilla de 3 px', act && act.sombra);
    const subir = await ev(`(() => { const b = document.getElementById('btn-subir'); if (!b || getComputedStyle(b).display === 'none') return null;
      const c = getComputedStyle(b); return { alto: Math.round(b.getBoundingClientRect().height * 10) / 10, fondo: c.backgroundColor }; })()`);
    ok(subir && cerca(subir.alto, 38, 0.6) && subir.fondo === AMARILLO, '«+ Subir recurso», amarillo de 38 px', subir);

    // Con «Todos los tipos»: la tarjeta resumida de arriba, como hoy; sin biografía grande.
    const todos = await ev(`(() => ({ tarjeta: getComputedStyle(document.getElementById('card-bio')).display,
      grande: getComputedStyle(document.getElementById('bio-grande')).display,
      recortado: !!document.querySelector('#card-bio .bio-texto.recortado') }))()`);
    ok(todos.tarjeta !== 'none', 'con «Todos los tipos», la tarjeta resumida se queda como hoy', todos);
    ok(todos.grande === 'none', 'y la biografía grande no aparece', todos);
    ok(todos.recortado, 'la tarjeta de arriba sigue recortando el texto, como hoy', todos);

    // Con «Biografía»: la biografía entera.
    ok(await clic('#filtros-chips .chip-filtro[data-tipo="biografia"]'), 'se pulsa el filtro «Biografía»');
    ok(await esperar(`document.getElementById('bio-grande').classList.contains('visible')`, 8000), 'y aparece la biografía en grande');
    await espera(400);
    const bio = await ev(`(() => { const g = document.getElementById('bio-grande'); const t = document.getElementById('bio-g-texto');
      const f = g.querySelector('.bio-g-foto'); const cf = getComputedStyle(f); const ft = f.getBoundingClientRect();
      return { tarjeta: getComputedStyle(document.getElementById('card-bio')).display,
        texto: t ? t.textContent : null, recortado: t ? getComputedStyle(t).webkitLineClamp : null,
        completo: t ? t.scrollHeight <= t.clientHeight + 1 : null,
        nombre: (g.querySelector('.bio-g-nombre') || {}).textContent,
        fotoAncho: Math.round(ft.width), fotoAlto: Math.round(ft.height), fotoBorde: cf.borderTopWidth + ' ' + cf.borderTopColor, fotoRadio: cf.borderTopLeftRadius,
        copiar: !!document.getElementById('bio-g-copiar'), editar: !!document.getElementById('bio-g-editar'),
        editarTexto: (document.getElementById('bio-g-editar') || {}).textContent,
        grid: getComputedStyle(document.getElementById('grid-recursos')).display,
        vacio: getComputedStyle(document.getElementById('vacio-recursos')).display }; })()`);
    ok(bio.tarjeta === 'none', 'la tarjeta resumida de arriba se esconde (no se ve la biografía dos veces)', bio.tarjeta);
    ok(bio.texto && bio.texto.includes('treinta y dos veredas') && bio.texto.includes('Esta biografía es larga a propósito'),
      'se ve la biografía COMPLETA, hasta el último párrafo', bio.texto && bio.texto.slice(-60));
    ok(bio.recortado === 'none' || !bio.recortado, 'sin recortar (no hay «Ver completa» que valga)', bio.recortado);
    ok(bio.completo, 'y el bloque muestra todo el texto, sin corte', bio.completo);
    ok(bio.fotoAncho === 120 && bio.fotoAlto === 120, `foto de 120 px (${bio.fotoAncho}×${bio.fotoAlto})`);
    ok(bio.fotoBorde === '4px ' + AMARILLO, 'con borde de 4 px #FFC300', bio.fotoBorde);
    ok(bio.nombre && bio.nombre.trim().length > 0, 'con el nombre del candidato', bio.nombre);
    ok(bio.copiar, 'botón «Copiar texto»');
    ok(bio.editar && /Editar biografía/.test(bio.editarTexto), 'botón «Editar biografía»', bio.editarTexto);
    ok(bio.vacio === 'none', 'y NO sale «no hay recursos en esta categoría» (sí hay algo que mirar)', bio.vacio);

    // «Editar biografía» abre el editor de siempre, con el texto dentro.
    await clic('#bio-g-editar');
    ok(await esperar(`document.getElementById('overlay-bio').classList.contains('abierto')`, 6000), '«Editar biografía» abre el editor de siempre');
    const editor = await ev(`(() => ({ titulo: document.getElementById('titulo-modal-bio').textContent.trim(),
      texto: document.getElementById('campo-bio-texto').value.slice(0, 40) }))()`);
    ok(editor.titulo === 'Editar biografía' && editor.texto.startsWith('Nació en el barrio'), 'con la biografía cargada dentro', editor);
    await clic('#cerrar-modal-bio');
    await espera(300);

    // Volver a «Todos los tipos» deja la pantalla como estaba.
    ok(await clic('#filtros-chips .chip-filtro[data-tipo=""]'), 'se vuelve a «Todos los tipos»');
    ok(await esperar(`!document.getElementById('bio-grande').classList.contains('visible')`, 8000), 'y la biografía grande se va');
    await espera(400);
    const vuelta = await ev(`(() => ({ tarjeta: getComputedStyle(document.getElementById('card-bio')).display,
      grid: getComputedStyle(document.getElementById('grid-recursos')).display }))()`);
    ok(vuelta.tarjeta !== 'none', 'la tarjeta resumida vuelve', vuelta);
    ok(vuelta.grid !== 'none', 'y la rejilla de recursos también', vuelta);

    await recoger(`recursos ${w}×${h}`);
  }

  /* ===================================================================== B2. SIN BIOGRAFÍA Y SIN PERMISO */
  console.log('\n[B2. Sin biografía cargada, y sin permiso de edición]');
  // Quien no puede editar (un coordinador) no ve el botón.
  ok(await abrir(1600, 900, '/recursos.html', LISTO_REC, '3'), 'entra un coordinador (sin permiso de edición)');
  const quien = await ev(`(() => ({ rol: usuarioActual && usuarioActual.rol, puede: typeof puedeEditarBio === 'function' ? puedeEditarBio() : null }))()`);
  ok(quien.rol && quien.rol !== 'admin' && quien.puede === false, `es ${quien.rol} y no puede editar`, quien);
  await clic('#filtros-chips .chip-filtro[data-tipo="biografia"]');
  await esperar(`document.getElementById('bio-grande').classList.contains('visible')`, 8000);
  await espera(400);
  const sinPermiso = await ev(`(() => ({ texto: !!document.getElementById('bio-g-texto'), copiar: !!document.getElementById('bio-g-copiar'),
    editar: !!document.getElementById('bio-g-editar') }))()`);
  ok(sinPermiso.texto, 've la biografía completa');
  ok(sinPermiso.copiar, 'y puede copiarla');
  ok(!sinPermiso.editar, 'pero NO ve «Editar biografía»', sinPermiso);
  await recoger('coordinador');

  // Sin biografía: «Aún no hay biografía» y «Agregar biografía».
  await pool.query("UPDATE contenido_paginas SET contenido = '', foto_url = NULL WHERE clave = 'biografia_candidato'");
  ok(await abrir(1600, 900, '/recursos.html', LISTO_REC), 'vuelve el administrador, con la biografía vacía');
  await clic('#filtros-chips .chip-filtro[data-tipo="biografia"]');
  await esperar(`document.getElementById('bio-grande').classList.contains('visible')`, 8000);
  await espera(400);
  const vacia = await ev(`(() => ({ aviso: (document.getElementById('bio-g-vacia') || {}).textContent,
    agregar: (document.getElementById('bio-g-editar') || {}).textContent, copiar: !!document.getElementById('bio-g-copiar') }))()`);
  ok(vacia.aviso && /Aún no hay biografía/.test(vacia.aviso), '«Aún no hay biografía»', vacia.aviso);
  ok(vacia.agregar && /Agregar biografía/.test(vacia.agregar), 'y el botón dice «Agregar biografía»', vacia.agregar);
  ok(!vacia.copiar, 'sin texto no se ofrece «Copiar texto»', vacia);
  await clic('#bio-g-editar');
  ok(await esperar(`document.getElementById('overlay-bio').classList.contains('abierto')`, 6000), '«Agregar biografía» abre el mismo editor');
  await clic('#cerrar-modal-bio');
  await espera(300);
  await recoger('sin biografía');
  await pool.query('UPDATE contenido_paginas SET contenido = ?, foto_url = ? WHERE clave = ?', [BIO, '/img/logo.png', 'biografia_candidato']);

  /* ===================================================================== POR DEBAJO DE 1100 px */
  console.log('\n[Por debajo de 1100 px]');
  ok(await abrir(1000, 800, '/crm.html', LISTO_CRM), 'crm.html carga a 1000 px');
  /* SE MIDEN LOS CUATRO, el Asunto incluido. Mirar sólo el Nombre y el cuadro
     de texto dejaba pasar que el Asunto se quedara en una segunda columna
     implícita: su regla lleva dos ids y le ganaba a la del teléfono. */
  const estrecho = await ev(`(() => { const r = getComputedStyle(document.querySelector('#paso-mensaje-campana .dos-por-dos'));
    const caja = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), ancho: Math.round(b.width) }; };
    return { cols: r.gridTemplateColumns.split(' ').length, nombre: caja('.celda-nombre'), asunto: caja('#campo-asunto'),
      plantillas: caja('.celda-plantillas'), texto: caja('.celda-texto') }; })()`);
  ok(estrecho.cols === 1, 'una sola columna', estrecho);
  const lefts = [estrecho.nombre.left, estrecho.asunto.left, estrecho.plantillas.left, estrecho.texto.left];
  ok(new Set(lefts).size === 1, 'los CUATRO bloques arrancan en el mismo borde izquierdo', lefts);
  const tops = [estrecho.nombre.top, estrecho.asunto.top, estrecho.plantillas.top, estrecho.texto.top];
  ok(tops.every((t, i) => i === 0 || t > tops[i - 1]), 'y van uno debajo de otro, en orden', tops);
  ok(estrecho.asunto.ancho === estrecho.nombre.ancho, 'el Asunto ocupa el ancho entero, como los demás', [estrecho.asunto.ancho, estrecho.nombre.ancho]);
  await recoger('1000×800');

  /* ===================================================================== CAPTURAS */
  console.log('\n[Capturas a 1600 px]');
  await abrir(1600, 900, '/crm.html', LISTO_CRM);
  await ev(`(() => { const b = [...document.querySelectorAll('#paso-canal [data-canal], #paso-canal button')].find((x) => /email/i.test(x.dataset.canal || x.textContent)); if (b) b.click(); })()`);
  await espera(500);
  await ev(`document.getElementById('paso-mensaje-campana').scrollIntoView({ block: 'center' })`);
  await espera(400);
  await foto('143-1-mensaje-2x2-email');
  console.log('  143-1-mensaje-2x2-email.png');
  await ev(`(() => { const b = [...document.querySelectorAll('#paso-canal [data-canal], #paso-canal button')].find((x) => /sms/i.test(x.dataset.canal || x.textContent)); if (b) b.click(); })()`);
  await espera(500);
  await ev(`document.getElementById('paso-mensaje-campana').scrollIntoView({ block: 'center' })`);
  await espera(400);
  await foto('143-2-mensaje-2x2-sms');
  console.log('  143-2-mensaje-2x2-sms.png');

  await abrir(1600, 900, '/recursos.html', LISTO_REC);
  await foto('143-3-recursos-todos');
  console.log('  143-3-recursos-todos.png');
  await clic('#filtros-chips .chip-filtro[data-tipo="biografia"]');
  await esperar(`document.getElementById('bio-grande').classList.contains('visible')`, 8000);
  await espera(500);
  await foto('143-4-recursos-biografia');
  console.log('  143-4-recursos-biografia.png');
  await recoger('capturas');

  console.log('\n--- errores de consola ---');
  if (errores.length) { errores.forEach((e) => console.log('  ' + e)); fallos += errores.length; } else console.log('  ninguno');

  console.log(`\n${fallos === 0 ? 'TODO BIEN' : fallos + ' FALLA(S)'} · capturas en ${SALIDA}`);
  try { p.cerrar(); nav.cerrar(); } catch (_) { /* ya cerrado */ }
  s.close();
  await pool.end();
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
