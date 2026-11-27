#!/usr/bin/env node
// scripts/probar-datos-campana-fichas.js
//
// ORDEN 144 (Configuración → «Datos de la campaña»: ficha azul lateral y seis fichas), EN CHROMIUM REAL, con administrador, con datos y con logo,
// a 1600×900 y 1366×768:
//   · Las SEIS fichas en el orden pedido (👤 Candidato · 🗳️ Campaña y meta · 🎨 Identidad · 🗺️ Territorio · 🤝 Apoyos · ⏱️ Jornada Día D), activa en
//     #084298 con raya inferior de 3 px #FFC300 y letra de 15 px negrita; título de ficha de 19 px #084298 con barrita amarilla.
//   · CADA CAMPO DE ANTES, EXACTAMENTE UNA VEZ: se compara la lista de ids y names contra la que había (la trae escrita este archivo, medida sobre
//     el commit b97bcb6) y además se comprueba que ninguno esté repetido.
//   · Campos de 46 px de alto y letra de 16 px; títulos de campo 15 px/700/#084298; ayudas de 13 px #6B7280.
//   · Cambiar de ficha NO pierde lo escrito (se teclea en cuatro fichas, se recorren las seis y se vuelve).
//   · Guardar con cambios en TRES fichas distintas guarda todo: se recarga y se compara contra lo tecleado.
//   · Error forzado en un campo de otra ficha (teléfono de 3 dígitos, ficha «Campaña y meta») estando en «Territorio»: salta a esa ficha, enfoca el
//     campo y pone el punto rojo en la pestaña.
//   · La ficha azul se actualiza al escribir nombre, eslogan, fecha y meta (sin guardar), y dice «Ponga la fecha de elecciones» si no hay fecha.
//   · «Cambiar logo» (los dos botones, el de la ficha Identidad y el amarillo de la ficha azul) y «Quitar» siguen funcionando.
//   · #datos-territorio abre esa ficha al cargar; cambiar de ficha deja el `#` de la ficha en la dirección.
//   · Rejilla 300px | 1fr con 22 px de separación y ficha azul pegada (sticky); por debajo de 1100 px la ficha azul arriba y una columna.
//   Cero errores de consola. Capturas de las seis fichas a 1600 px en SALIDA.
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada144 [SALIDA=/ruta] node scripts/probar-datos-campana-fichas.js
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

const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden144');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 900) : '')); }
}
const cerca = (a, b, tol = 1) => Math.abs(a - b) <= tol;

/* LOS CAMPOS QUE HABÍA ANTES, medidos sobre public/configuracion.html en b97bcb6 (el commit anterior a esta orden).
   Van escritos aquí y no leídos del archivo a propósito: la prueba tiene que fallar si mañana alguien quita un campo,
   y una lista sacada del archivo de ese momento diría siempre que está completo. */
const IDS_ANTES = ['archivo-logo', 'aviso-sublicencia-campana', 'bloque-apoyos', 'bloque-datos-campana', 'bloque-jornada', 'bloque-territorio',
  'btn-activar-apoyos', 'btn-cambiar-logo', 'btn-quitar-logo', 'campana-error', 'campana-ok', 'campo-cargo-aspira', 'campo-ciudad-tiene-comunas',
  'campo-direccion-sede', 'campo-email', 'campo-fecha-eleccion', 'campo-fecha-inicio', 'campo-marca-subtitulo', 'campo-marca-titulo',
  'campo-meta-campana', 'campo-meta-madre', 'campo-meta-sublicencia', 'campo-meta-votos-campana', 'campo-nombre-candidato', 'campo-partido-otro',
  'campo-slogan-campana', 'campo-telefono-2', 'campo-usar-nombre-barrios', 'campo-usar-nombre-corregimientos', 'campo-usar-nombre-veredas',
  'casillas-apoyos', 'form-campana', 'input-ciudad-campana', 'input-departamento-campana', 'input-meta-madre', 'input-meta-sublicencia',
  'input-partido-otro', 'jornada-apertura', 'jornada-avisos-push', 'jornada-baja-desde', 'jornada-baja-pct', 'jornada-checkin-min', 'jornada-cierre',
  'jornada-plazo-e14', 'jornada-transporte-desde', 'lista-ciudades-campana', 'lista-departamentos-campana', 'panel-apoyos', 'seccion-campana',
  'select-partido-politico', 'vista-logo'];
const NAMES_ANTES = ['cargo_aspira', 'ciudad_tiene_comunas', 'direccion_sede', 'email', 'fecha_eleccion', 'fecha_inicio_campana', 'marca_subtitulo',
  'marca_titulo', 'meta_votos', 'meta_votos_campana', 'nombre_candidato', 'slogan_campana', 'telefono', 'usar_nombre_barrios',
  'usar_nombre_corregimientos', 'usar_nombre_veredas'];

// Las seis fichas, en el orden que pidió Gildardo.
const FICHAS = [
  ['datos-candidato',    'dc-ficha-candidato',  'dc-panel-candidato',  '👤 Candidato',      'Candidato'],
  ['datos-campana-meta', 'dc-ficha-campana',    'dc-panel-campana',    '🗳️ Campaña y meta', 'Campaña y meta'],
  ['datos-identidad',    'dc-ficha-identidad',  'dc-panel-identidad',  '🎨 Identidad',      'Identidad en el menú lateral'],
  ['datos-territorio',   'dc-ficha-territorio', 'dc-panel-territorio', '🗺️ Territorio',     'Territorio'],
  ['datos-apoyos',       'dc-ficha-apoyos',     'dc-panel-apoyos',     '🤝 Apoyos',         'Apoyos'],
  ['datos-jornada',      'dc-ficha-jornada',    'dc-panel-jornada',    '⏱️ Jornada Día D',  'Jornada del Día D'],
];

const AZUL_OSCURO = 'rgb(8, 66, 152)';
const AMARILLO = 'rgb(255, 195, 0)';
const GRIS_AYUDA = 'rgb(107, 114, 128)';

(async () => {
  await sembrar(pool);
  /* CON LOGO, como pide la orden: la semilla no pone ninguno y sin él no se puede comprobar «Quitar» ni el aro de la ficha azul.
     Se usa el logo de la propia plataforma, que existe en public/img. */
  await pool.query("UPDATE configuracion_campana SET marca_logo_url = '/img/logo.png', marca_subtitulo = 'El barrio primero', cargo_aspira = 'alcaldia' WHERE id = 1");

  const s = http.createServer(crear(pool));
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; const ce = console.error; console.error = function () { window.__errs.push([].slice.call(arguments).join(' ')); ce.apply(console, arguments); }; window.addEventListener('error', function (e) { window.__errs.push('ERR ' + e.message); });` });
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
  const valor = (id) => ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); return e ? e.value : null; })()`);
  /** Teclea como una persona: pone el valor y dispara `input` y `change`, que es lo que oye la ficha azul. */
  const teclear = (id, v) => ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(v)};
    e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return e.value; })()`);
  const clic = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
  const LISTO = "!!document.getElementById('dc-fichas') && !!document.getElementById('campo-nombre-candidato') && document.getElementById('campo-nombre-candidato').value !== ''";
  /**
   * Abre la pantalla de verdad.
   *
   * PASA POR about:blank A PROPÓSITO. `Page.navigate` a la misma página con
   * otro `#` NO recarga —el navegador solo cambia el ancla y dispara
   * `hashchange`—, así que una prueba escrita sin esto comprobaba lo que ya
   * había en los campos creyendo que venía del servidor: el guardado parecía
   * funcionar sin haberse leído nada. Costó media tarde.
   */
  async function abrir(w, h, url, listo = LISTO) {
    await encuadre(w, h);
    await cmd('Page.navigate', { url: 'about:blank' });
    await espera(150);
    await cmd('Network.clearBrowserCookies');
    await cmd('Network.setCookie', { name: 'ej_usuario', value: '1', url: base });
    await cmd('Page.navigate', { url: base + url });
    const l = await esperar(listo, 20000);
    await espera(700);
    return l;
  }
  /* EL FOCO, EMULADO. Sin esto la ventana sin cabeza no tiene el foco del
     escritorio y `:focus` no pinta nada, aunque `document.activeElement` sí
     cambie: el borde azul del campo enfocado daría un falso negativo. */
  await cmd('Emulation.setFocusEmulationEnabled', { enabled: true });

  for (const [w, h] of [[1600, 900], [1366, 768]]) {
    console.log(`\n========== ${w}×${h} ==========`);
    /* CADA VUELTA EMPIEZA CON LOGO. La vuelta anterior lo quita a propósito
       (es parte de lo que se comprueba), así que si no se repone aquí, la
       segunda medida de la ficha azul se hace sin logo y falla por el estado
       que dejó la primera, no por el diseño. */
    await pool.query("UPDATE configuracion_campana SET marca_logo_url = '/img/logo.png' WHERE id = 1");

    /* ===================================================================== A. LAS SEIS FICHAS, EN ORDEN */
    console.log('\n[A. Las seis fichas]');
    ok(await abrir(w, h, '/configuracion.html#campana'), 'la pantalla carga con los datos de la campaña');

    const fichas = await ev(`(() => [...document.querySelectorAll('#dc-fichas .dc-ficha')].map((e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
      return { id: e.id, ficha: e.dataset.ficha, texto: e.textContent.replace(/\\s+/g, ' ').trim(), sel: e.getAttribute('aria-selected'), oculto: c.display === 'none',
        top: Math.round(r.top * 10) / 10, left: Math.round(r.left * 10) / 10, letra: c.fontSize, peso: c.fontWeight, color: c.color, raya: c.borderBottomWidth + ' ' + c.borderBottomColor }; }))()`);
    ok(fichas.length === 6, `seis fichas (${fichas.length})`, fichas.map((f) => f.texto));
    ok(fichas.every((f, i) => f.ficha === FICHAS[i][0] && f.texto === FICHAS[i][3]),
      'en el orden pedido: Candidato · Campaña y meta · Identidad · Territorio · Apoyos · Jornada Día D', fichas.map((f) => f.texto));
    ok(fichas.every((f) => !f.oculto), 'las seis visibles para el administrador', fichas.filter((f) => f.oculto).map((f) => f.id));
    ok(fichas.every((f) => f.letra === '15px' && f.peso === '700'), 'letra de 15 px negrita en las pestañas', fichas.map((f) => [f.letra, f.peso]));
    const uno = [...new Set(fichas.map((f) => f.top))];
    ok(uno.length === 1, `las seis en una sola línea (tops: ${uno.join(', ')})`);
    ok(fichas.every((f, i) => i === 0 || f.left > fichas[i - 1].left), 'de izquierda a derecha, sin solaparse', fichas.map((f) => f.left));
    const activa = fichas.find((f) => f.sel === 'true');
    ok(activa && activa.ficha === 'datos-candidato', 'al entrar por #campana se abre «Candidato»', activa && activa.ficha);
    ok(activa && activa.color === AZUL_OSCURO && activa.raya === '3px ' + AMARILLO,
      'ficha activa en #084298 con raya inferior de 3 px #FFC300', activa && [activa.color, activa.raya]);
    const soloUna = fichas.filter((f) => f.sel === 'true').length;
    ok(soloUna === 1, `una sola ficha activa (${soloUna})`);
    const paneles = await ev(`(() => [...document.querySelectorAll('#seccion-campana .dc-panel')].map((e) => ({ id: e.id, visible: !e.hidden })))()`);
    ok(paneles.filter((x) => x.visible).length === 1 && paneles.find((x) => x.visible).id === 'dc-panel-candidato',
      'un solo panel a la vista, el de la ficha activa', paneles);

    /* ===================================================================== B. CADA CAMPO DE ANTES, UNA SOLA VEZ */
    console.log('\n[B. Los campos de antes, cada uno exactamente una vez]');
    const inventario = await ev(`(() => { const s = document.getElementById('seccion-campana');
      const ids = [...s.querySelectorAll('[id]')].map((e) => e.id); if (s.id) ids.push(s.id);
      const names = [...s.querySelectorAll('[name]')].map((e) => e.getAttribute('name'));
      const cuenta = (a) => a.reduce((o, x) => { o[x] = (o[x] || 0) + 1; return o; }, {});
      return { ids: cuenta(ids), names: cuenta(names) }; })()`);
    const faltanIds = IDS_ANTES.filter((i) => !inventario.ids[i]);
    const repesIds = IDS_ANTES.filter((i) => inventario.ids[i] > 1);
    ok(faltanIds.length === 0, `están los ${IDS_ANTES.length} ids de antes`, faltanIds);
    ok(repesIds.length === 0, 'ninguno repetido', repesIds);
    const faltanNames = NAMES_ANTES.filter((n) => !inventario.names[n]);
    const repesNames = NAMES_ANTES.filter((n) => inventario.names[n] > 1);
    ok(faltanNames.length === 0, `están los ${NAMES_ANTES.length} names de antes (de ellos viven el guardado y las validaciones)`, faltanNames);
    ok(repesNames.length === 0, 'ningún name repetido', repesNames);

    /* Y que cada uno esté EN SU FICHA: el campo tiene que verse al abrir la pestaña que le toca, no quedarse escondido. */
    const ubicacion = await ev(`(() => { const r = {}; ['campo-nombre-candidato','campo-cargo-aspira','campo-slogan-campana','select-partido-politico',
      'campo-fecha-inicio','campo-fecha-eleccion','campo-meta-votos-campana','campo-direccion-sede','campo-telefono-2','campo-email',
      'vista-logo','campo-marca-titulo','campo-marca-subtitulo','input-departamento-campana','input-ciudad-campana','campo-ciudad-tiene-comunas',
      'campo-usar-nombre-barrios','campo-usar-nombre-corregimientos','campo-usar-nombre-veredas','casillas-apoyos','jornada-apertura','jornada-cierre',
      'jornada-checkin-min','jornada-plazo-e14','jornada-baja-pct','jornada-baja-desde','jornada-transporte-desde','jornada-avisos-push'].forEach((id) => {
        const e = document.getElementById(id); const pa = e && e.closest('.dc-panel'); r[id] = pa ? pa.id : null; }); return r; })()`);
    const ESPERADO = { 'campo-nombre-candidato': 'dc-panel-candidato', 'campo-cargo-aspira': 'dc-panel-candidato', 'campo-slogan-campana': 'dc-panel-candidato',
      'select-partido-politico': 'dc-panel-candidato', 'campo-fecha-inicio': 'dc-panel-campana', 'campo-fecha-eleccion': 'dc-panel-campana',
      'campo-meta-votos-campana': 'dc-panel-campana', 'campo-direccion-sede': 'dc-panel-campana', 'campo-telefono-2': 'dc-panel-campana',
      'campo-email': 'dc-panel-campana', 'vista-logo': 'dc-panel-identidad', 'campo-marca-titulo': 'dc-panel-identidad',
      'campo-marca-subtitulo': 'dc-panel-identidad', 'input-departamento-campana': 'dc-panel-territorio', 'input-ciudad-campana': 'dc-panel-territorio',
      'campo-ciudad-tiene-comunas': 'dc-panel-territorio', 'campo-usar-nombre-barrios': 'dc-panel-territorio',
      'campo-usar-nombre-corregimientos': 'dc-panel-territorio', 'campo-usar-nombre-veredas': 'dc-panel-territorio',
      'casillas-apoyos': 'dc-panel-apoyos', 'jornada-apertura': 'dc-panel-jornada', 'jornada-cierre': 'dc-panel-jornada',
      'jornada-checkin-min': 'dc-panel-jornada', 'jornada-plazo-e14': 'dc-panel-jornada', 'jornada-baja-pct': 'dc-panel-jornada',
      'jornada-baja-desde': 'dc-panel-jornada', 'jornada-transporte-desde': 'dc-panel-jornada', 'jornada-avisos-push': 'dc-panel-jornada' };
    const malUbicados = Object.keys(ESPERADO).filter((id) => ubicacion[id] !== ESPERADO[id]);
    ok(malUbicados.length === 0, 'los 28 campos de referencia, cada uno en su ficha', malUbicados.map((id) => [id, ubicacion[id], ESPERADO[id]]));

    /* ===================================================================== C. MEDIDAS */
    console.log('\n[C. Medidas: campos de 46 px, letra de 16 px, títulos y ayudas]');
    /* Se recorren las seis fichas y se miden los campos QUE SE VEN en cada una
       (`offsetParent`): los tres que nacen escondidos —el nombre del partido
       cuando no se eligió «Otro», y las dos metas que solo salen en la pantalla
       de un aspirante— no tienen caja y medirían 0. El del partido se mide
       aparte, eligiendo «Otro», que es cuando aparece de verdad. */
    const todosLosCampos = [];
    for (const [hash, idBoton] of FICHAS.map((f) => [f[0], f[1]])) {
      if (!(await clic('#' + idBoton))) continue;
      await espera(140);
      if (hash === 'datos-candidato') { await teclear('select-partido-politico', 'Otro'); await espera(250); }
      const m = await ev(`(() => [...document.querySelectorAll('#seccion-campana .dc-panel:not([hidden]) input:not([type=checkbox]):not([type=file]), #seccion-campana .dc-panel:not([hidden]) select')]
        .filter((e) => e.offsetParent !== null)
        .map((e) => { const c = getComputedStyle(e); const r = e.getBoundingClientRect();
          return { id: e.id, alto: Math.round(r.height * 10) / 10, letra: c.fontSize, fondo: c.backgroundColor, grosor: e.offsetHeight - e.clientHeight,
            color: c.borderTopColor, radio: c.borderTopLeftRadius }; }))()`);
      todosLosCampos.push(...m.map((x) => ({ ...x, ficha: hash })));
    }
    ok(todosLosCampos.length >= 20, `se midieron los campos visibles de las seis fichas (${todosLosCampos.length})`);
    ok(todosLosCampos.some((c) => c.id === 'input-partido-otro'), 'incluido «Nombre del partido/movimiento», que aparece al elegir «Otro»');
    const altoMal = todosLosCampos.filter((c) => !cerca(c.alto, 46, 0.6));
    ok(altoMal.length === 0, 'todos los campos de 46 px de alto', altoMal.map((c) => [c.id, c.alto]));
    const letraMal = todosLosCampos.filter((c) => c.letra !== '16px');
    ok(letraMal.length === 0, 'letra de 16 px en los campos', letraMal.map((c) => [c.id, c.letra]));
    const fondoMal = todosLosCampos.filter((c) => c.fondo !== 'rgb(255, 255, 255)');
    ok(fondoMal.length === 0, 'fondo blanco', fondoMal.map((c) => [c.id, c.fondo]));
    const colorMal = todosLosCampos.filter((c) => c.color !== 'rgb(213, 220, 232)');
    ok(colorMal.length === 0, 'borde del color #D5DCE8', colorMal.map((c) => [c.id, c.color]));
    /* EL BORDE SE DECLARA DE 1,5 px Y CHROMIUM LO PINTA DE 1 (con un píxel por
       punto): `getComputedStyle` devuelve «1px» y `offsetHeight - clientHeight`
       da 2, o sea 1 px por lado. No es un defecto de esta pantalla —
       controles-uniformes.css declara el mismo 1,5 px desde la orden 141 — así
       que se comprueba lo que de verdad se puede comprobar: que la HOJA declara
       1,5 px, y que el navegador lo redondea parejo en todos los campos. */
    /* Se lee el `cssText` y no `style.borderWidth`: la regla declara
       `border: 1.5px solid var(--dc-borde-campo)`, y una abreviada con `var()`
       dentro NO se descompone en el CSSOM — `borderWidth` sale vacío. */
    const declarado = await ev(`(() => { for (const hoja of document.styleSheets) { let reglas; try { reglas = hoja.cssRules; } catch (_) { continue; }
      for (const r of reglas) { if (!r.selectorText || !r.style) continue;
        if (r.selectorText.indexOf('#seccion-campana') < 0 || r.selectorText.indexOf(':is(input') < 0) continue;
        if (!/min-height:\\s*46px/.test(r.cssText)) continue;
        return [String(hoja.href).split('/').pop(), (/border:\\s*([^;]+);/.exec(r.cssText) || [])[1] || null]; } } return null; })()`);
    ok(declarado && declarado[0] === 'datos-campana.css' && /^1\.5px solid/.test(declarado[1] || ''),
      'la hoja declara el borde de los campos en 1,5 px', declarado);
    const grosorMal = todosLosCampos.filter((c) => c.grosor !== 2);
    ok(grosorMal.length === 0, 'y el navegador lo pinta igual en todos (1 px por lado a un píxel por punto)', grosorMal.map((c) => [c.id, c.grosor]));
    const radioMal = todosLosCampos.filter((c) => c.radio !== '8px');
    ok(radioMal.length === 0, 'radio de 8 px', radioMal.map((c) => [c.id, c.radio]));
    // Se deshace la elección de «Otro» para no dejar el partido a medio escribir.
    await clic('#dc-ficha-candidato'); await espera(150);
    await teclear('select-partido-politico', ''); await espera(200);

    await clic('#dc-ficha-candidato');
    await espera(150);
    const rotulo = await estilo('label[for="campo-nombre-candidato"]', ['fontSize', 'fontWeight', 'color']);
    ok(rotulo && rotulo[0] === '15px' && rotulo[1] === '700' && rotulo[2] === AZUL_OSCURO, 'título de campo 15 px / 700 / #084298', rotulo);
    /* LOS CAMPOS DE UNA MISMA FILA, A LA MISMA ALTURA, aunque un rótulo ocupe
       dos líneas y el de al lado una (pasa en la jornada del Día D). */
    const porFilas = await ev(`(() => { const malas = [];
      for (const rej of document.querySelectorAll('#seccion-campana .dc-panel .dc-g2, #seccion-campana .dc-panel .dc-g3')) {
        const oculto = rej.closest('.dc-panel').hidden; if (oculto) rej.closest('.dc-panel').hidden = false;
        const campos = [...rej.children].filter((c) => c.offsetParent !== null);
        const tops = campos.map((c) => { const i = c.querySelector('input, select'); return i ? Math.round(i.getBoundingClientRect().top) : null; }).filter((t) => t !== null);
        if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) > 1) malas.push([rej.closest('.dc-panel').id, tops]);
        if (oculto) rej.closest('.dc-panel').hidden = true;
      } return malas; })()`);
    ok(porFilas.length === 0, 'en cada fila de dos o tres columnas, los campos arrancan a la misma altura', porFilas);
    await clic('#dc-ficha-campana');
    await espera(150);
    const ayuda = await estilo('#dc-panel-campana .campo small', ['fontSize', 'color']);
    ok(ayuda && ayuda[0] === '13px' && ayuda[1] === GRIS_AYUDA, 'ayuda 13 px #6B7280', ayuda);
    const tituloFicha = await estilo('#dc-panel-campana .dc-titulo', ['fontSize', 'color']);
    ok(tituloFicha && tituloFicha[0] === '19px' && tituloFicha[1] === AZUL_OSCURO, 'título de la ficha 19 px #084298', tituloFicha);
    const barrita = await ev(`(() => { const c = getComputedStyle(document.querySelector('#dc-panel-campana .dc-titulo'), '::before'); return [c.content, c.backgroundColor, c.width]; })()`);
    ok(barrita && barrita[1] === AMARILLO, 'el título lleva la barrita amarilla', barrita);
    // El foco: borde azul y resplandor.
    await ev(`document.getElementById('campo-email').focus()`);
    await espera(120);
    const foco = await estilo('#campo-email', ['borderTopColor', 'boxShadow']);
    ok(foco && foco[0] === 'rgb(11, 94, 215)' && /rgba?\(11, 94, 215/.test(foco[1]), 'foco: borde azul con resplandor', foco);
    await ev(`document.getElementById('campo-email').blur()`);

    /* ===================================================================== D. LA REJILLA Y LA FICHA AZUL */
    console.log('\n[D. Rejilla 300 | 1fr y la ficha azul]');
    const reja = await estilo('#seccion-campana .dc-reja', ['gridTemplateColumns', 'columnGap']);
    const anchoTarjeta = await rect('#dc-tarjeta');
    if (w >= 1100) {
      ok(reja && /^300px /.test(reja[0]), `primera columna de 300 px (${reja && reja[0]})`);
      ok(reja && reja[1] === '22px', `separación de 22 px (${reja && reja[1]})`);
      ok(anchoTarjeta && cerca(anchoTarjeta.width, 300, 1), `la ficha azul mide 300 px (${anchoTarjeta && anchoTarjeta.width})`);
      const pos = await estilo('#dc-tarjeta', ['position']);
      ok(pos && pos[0] === 'sticky', 'la ficha azul queda pegada arriba (sticky)', pos);
      const caja = await rect('#seccion-campana .dc-caja');
      ok(caja && anchoTarjeta && cerca(caja.left - (anchoTarjeta.left + anchoTarjeta.width), 22, 1.5),
        'la caja blanca empieza 22 px a la derecha de la ficha azul', caja && anchoTarjeta && [anchoTarjeta.left, anchoTarjeta.width, caja.left]);
    }
    const fondoTarjeta = await estilo('#dc-tarjeta', ['backgroundImage', 'borderTopLeftRadius']);
    ok(fondoTarjeta && /linear-gradient\(/.test(fondoTarjeta[0]) && /rgb\(11, 94, 215\)/.test(fondoTarjeta[0]) && /rgb\(8, 66, 152\)/.test(fondoTarjeta[0]),
      'degradado #0B5ED7 → #084298', fondoTarjeta && fondoTarjeta[0]);
    ok(fondoTarjeta && fondoTarjeta[1] === '16px', 'radio de 16 px', fondoTarjeta && fondoTarjeta[1]);
    const aro = await ev(`(() => { const e = document.getElementById('dc-aro'); const c = getComputedStyle(e); const r = e.getBoundingClientRect();
      return { ancho: Math.round(r.width), alto: Math.round(r.height), borde: c.borderTopWidth + ' ' + c.borderTopColor }; })()`);
    ok(aro.ancho === 120 && aro.alto === 120, `el logo de la ficha azul mide 120 px (${aro.ancho}×${aro.alto})`);
    ok(aro.borde === '4px ' + AMARILLO, 'con borde de 4 px #FFC300', aro.borde);
    const conLogo = await ev(`(() => { const i = document.getElementById('dc-logo-img'); const n = document.getElementById('dc-iniciales');
      return { img: getComputedStyle(i).display, src: i.getAttribute('src'), ini: getComputedStyle(n).display }; })()`);
    ok(conLogo.img !== 'none' && conLogo.ini === 'none' && conLogo.src === '/img/logo.png', 'con logo, se ve el logo (y no las iniciales)', conLogo);
    const letraNombre = await estilo('#dc-nombre', ['fontSize', 'color']);
    ok(letraNombre && letraNombre[0] === '22px' && letraNombre[1] === 'rgb(255, 255, 255)', 'nombre del candidato 22 px blanco', letraNombre);
    const letraEslogan = await estilo('#dc-eslogan', ['color']);
    ok(letraEslogan && letraEslogan[0] === AMARILLO, 'eslogan en #FFC300', letraEslogan);
    const numeros = await ev(`(() => [...document.querySelectorAll('#dc-cajas .dc-caja-num b')].map((e) => { const c = getComputedStyle(e); return [c.fontSize, c.color]; }))()`);
    ok(numeros.length === 3 && numeros.every((n) => n[0] === '24px' && n[1] === AMARILLO), 'tres cajas con números de 24 px #FFC300', numeros);
    ok((await texto('#dc-cajas')).includes('Días') && (await texto('#dc-cajas')).includes('Semanas') && (await texto('#dc-cajas')).includes('Meta'),
      'las tres cajas son días, semanas y meta de votos', await texto('#dc-cajas'));
    ok(/^Faltan para la elección \(\d{2}\/\d{2}\/\d{4}\)$/.test(await texto('#dc-cuenta-rotulo')) || /^La elección fue el /.test(await texto('#dc-cuenta-rotulo')),
      '«Faltan para la elección (dd/mm/aaaa)»', await texto('#dc-cuenta-rotulo'));
    /* Se compara contra lo que tienen LOS CAMPOS, no contra horas escritas a
       mano: la jornada de la base de pruebas no es 08:00–16:00, y una prueba
       con el valor clavado falla por el dato y no por el diseño. */
    const urnas = await ev(`(() => ({ texto: document.getElementById('dc-urnas').textContent.trim(),
      a: document.getElementById('jornada-apertura').value, c: document.getElementById('jornada-cierre').value }))()`);
    ok(/^Urnas \d{2}:\d{2} – \d{2}:\d{2}$/.test(urnas.texto) && urnas.texto === `Urnas ${urnas.a} – ${urnas.c}`,
      `«Urnas HH:MM – HH:MM» con las horas de la jornada (${urnas.texto})`, urnas);
    const lugar = await ev(`(() => ({ texto: document.getElementById('dc-cargo-lugar').textContent.trim(),
      cargo: document.getElementById('campo-cargo-aspira').selectedOptions[0].textContent.trim(),
      ciudad: document.getElementById('input-ciudad-campana').value, depto: document.getElementById('input-departamento-campana').value }))()`);
    ok(lugar.texto === `${lugar.cargo} · ${lugar.ciudad}, ${lugar.depto}`,
      `cargo · ciudad, departamento (${lugar.texto})`, lugar);
    const botonLogo = await estilo('#dc-btn-logo', ['backgroundColor']);
    ok(botonLogo && botonLogo[0] === AMARILLO, 'botón amarillo «🎨 Cambiar logo»', botonLogo);
    ok((await texto('#dc-btn-logo')).includes('Cambiar logo'), 'con ese texto', await texto('#dc-btn-logo'));

    /* ===================================================================== E. LA FICHA AZUL SE ACTUALIZA AL ESCRIBIR */
    console.log('\n[E. La ficha azul se actualiza al escribir]');
    await clic('#dc-ficha-candidato');
    await espera(120);
    await teclear('campo-nombre-candidato', 'Mariana Restrepo Ocampo');
    await espera(150);
    ok((await texto('#dc-nombre')) === 'Mariana Restrepo Ocampo', 'al escribir el nombre, cambia en la ficha azul', await texto('#dc-nombre'));
    await teclear('campo-slogan-campana', 'La ciudad que queremos');
    await espera(150);
    ok((await texto('#dc-eslogan')) === 'La ciudad que queremos', 'al escribir el eslogan, cambia', await texto('#dc-eslogan'));
    await clic('#dc-ficha-campana');
    await espera(120);
    await teclear('campo-meta-votos-campana', '31500');
    await espera(150);
    ok((await texto('#dc-meta')) === '31.500', 'al escribir la meta, cambia (con separador de miles)', await texto('#dc-meta'));
    // Una fecha a 100 días exactos: la cuenta tiene que dar 100 días y 14 semanas.
    const dentro = new Date(); dentro.setDate(dentro.getDate() + 100);
    const iso = `${dentro.getFullYear()}-${String(dentro.getMonth() + 1).padStart(2, '0')}-${String(dentro.getDate()).padStart(2, '0')}`;
    await teclear('campo-fecha-eleccion', iso);
    await espera(200);
    const cuenta = await ev(`[document.getElementById('dc-dias').textContent, document.getElementById('dc-semanas').textContent, document.getElementById('dc-cuenta-rotulo').textContent]`);
    ok(cuenta[0] === '100' && cuenta[1] === '14', 'al cambiar la fecha, la cuenta regresiva da 100 días y 14 semanas', cuenta);
    const [aa, mm, dd] = iso.split('-');
    ok(cuenta[2] === `Faltan para la elección (${dd}/${mm}/${aa})`, 'y el rótulo trae la fecha nueva', cuenta[2]);
    // Sin fecha: el aviso en vez de la cuenta.
    await teclear('campo-fecha-eleccion', '');
    await espera(200);
    const sin = await ev(`(() => ({ aviso: document.getElementById('dc-sin-fecha').textContent.trim(), avisoVisible: getComputedStyle(document.getElementById('dc-sin-fecha')).display,
      cajas: getComputedStyle(document.getElementById('dc-cajas')).display, rotulo: getComputedStyle(document.getElementById('dc-cuenta-rotulo')).display }))()`);
    ok(sin.aviso === 'Ponga la fecha de elecciones' && sin.avisoVisible !== 'none' && sin.cajas === 'none' && sin.rotulo === 'none',
      'sin fecha: «Ponga la fecha de elecciones» en vez de la cuenta regresiva', sin);
    await teclear('campo-fecha-eleccion', iso);
    await espera(150);
    // El cargo, la ciudad y las horas también.
    await clic('#dc-ficha-candidato'); await espera(120);
    await teclear('campo-cargo-aspira', 'gobernacion'); await espera(400);
    await clic('#dc-ficha-territorio'); await espera(120);
    await teclear('input-ciudad-campana', 'Manizales'); await espera(150);
    ok((await texto('#dc-cargo-lugar')).startsWith('Gobernación · Manizales'), 'cargo y ciudad también se reflejan', await texto('#dc-cargo-lugar'));
    await clic('#dc-ficha-jornada'); await espera(120);
    const cierre = await valor('jornada-cierre');
    await teclear('jornada-apertura', '07:30'); await espera(150);
    ok((await texto('#dc-urnas')) === `Urnas 07:30 – ${cierre}`, 'la hora de apertura también', await texto('#dc-urnas'));
    await teclear('jornada-apertura', '08:00'); await espera(120);
    // Sin logo, las iniciales del candidato.
    await ev(`(() => { dcLogoUrl = ''; dcPintarTarjeta(); })()`);
    await espera(150);
    const sinLogo = await ev(`(() => ({ img: getComputedStyle(document.getElementById('dc-logo-img')).display, ini: document.getElementById('dc-iniciales').textContent.trim(),
      iniVisible: getComputedStyle(document.getElementById('dc-iniciales')).display }))()`);
    ok(sinLogo.img === 'none' && sinLogo.iniVisible !== 'none' && sinLogo.ini === 'MR', 'sin logo: las iniciales del candidato («MR» de Mariana Restrepo)', sinLogo);
    await ev(`(() => { dcLogoUrl = '/img/logo.png'; dcPintarTarjeta(); })()`);
    await espera(120);

    /* ===================================================================== F. CAMBIAR DE FICHA NO PIERDE LO ESCRITO */
    console.log('\n[F. Cambiar de ficha no pierde lo escrito]');
    await clic('#dc-ficha-identidad'); await espera(120);
    await teclear('campo-marca-titulo', 'CAMPAÑA MARIANA');
    await clic('#dc-ficha-campana'); await espera(120);
    await teclear('campo-direccion-sede', 'Carrera 23 # 62-16');
    await clic('#dc-ficha-apoyos'); await espera(120);
    await clic('#dc-ficha-jornada'); await espera(120);
    await teclear('jornada-plazo-e14', '95');
    // Se recorren las seis y se vuelve a comprobar todo lo tecleado.
    for (const f of FICHAS) { await clic('#' + f[1]); await espera(110); }
    const conservado = await ev(`(() => ({ nombre: document.getElementById('campo-nombre-candidato').value, slogan: document.getElementById('campo-slogan-campana').value,
      meta: document.getElementById('campo-meta-votos-campana').value, marca: document.getElementById('campo-marca-titulo').value,
      sede: document.getElementById('campo-direccion-sede').value, e14: document.getElementById('jornada-plazo-e14').value,
      ciudad: document.getElementById('input-ciudad-campana').value, fecha: document.getElementById('campo-fecha-eleccion').value }))()`);
    ok(conservado.nombre === 'Mariana Restrepo Ocampo' && conservado.slogan === 'La ciudad que queremos' && conservado.meta === '31500'
      && conservado.marca === 'CAMPAÑA MARIANA' && conservado.sede === 'Carrera 23 # 62-16' && conservado.e14 === '95'
      && conservado.ciudad === 'Manizales' && conservado.fecha === iso,
      'tras recorrer las seis fichas, los ocho campos tecleados siguen con su valor', conservado);

    /* ===================================================================== G. UN GUARDADO PARA LAS SEIS */
    console.log('\n[G. Guardar con cambios en tres fichas distintas]');
    const pie = await texto('#seccion-campana .dc-pie-nota');
    ok(pie === 'Las seis fichas se guardan juntas', '«Las seis fichas se guardan juntas» en el pie', pie);
    const botones = await ev(`(() => [...document.querySelectorAll('#seccion-campana .dc-pie-botones button')].map((e) => ({ id: e.id, tipo: e.type, texto: e.textContent.trim(), fondo: getComputedStyle(e).backgroundColor })))()`);
    ok(botones.length === 2 && botones[0].id === 'dc-btn-cancelar' && botones[1].id === 'dc-btn-guardar', 'Cancelar y Guardar, en ese orden, a la derecha', botones);
    ok(botones[1] && botones[1].fondo === 'rgb(11, 94, 215)' && botones[1].texto.includes('Guardar datos de la campaña'),
      '«💾 Guardar datos de la campaña» en azul #0B5ED7', botones[1]);
    ok(botones[1] && botones[1].tipo === 'submit', 'y es UN SOLO botón de envío del formulario de siempre', botones[1] && botones[1].tipo);

    // Tres fichas distintas: Candidato (nombre), Identidad (eslogan del menú) y Jornada (plazo del E-14, que se guarda por otra ruta).
    await clic('#dc-ficha-identidad'); await espera(120);
    await teclear('campo-marca-subtitulo', 'Eslogan guardado en la 144');
    await clic('#dc-ficha-candidato'); await espera(120);
    await teclear('campo-nombre-candidato', 'Mariana Restrepo Ocampo');
    await clic('#dc-ficha-territorio'); await espera(120);
    await teclear('input-departamento-campana', 'Caldas');
    await clic('#dc-ficha-jornada'); await espera(120);
    await teclear('jornada-plazo-e14', '95');
    await teclear('jornada-baja-pct', '55');
    await clic('#dc-btn-guardar');
    ok(await esperar(`document.getElementById('campana-ok').classList.contains('visible')`, 12000),
      'guarda y lo dice («Datos de la campaña guardados»)', await texto('#campana-error'));

    // Se recarga y se compara: lo de las tres fichas tiene que estar, incluido lo de la jornada (que viaja por su propia ruta).
    ok(await abrir(w, h, '/configuracion.html#datos-candidato'), 'se recarga la pantalla');
    const guardado = await ev(`(() => ({ nombre: document.getElementById('campo-nombre-candidato').value, sub: document.getElementById('campo-marca-subtitulo').value,
      depto: document.getElementById('input-departamento-campana').value, e14: document.getElementById('jornada-plazo-e14').value,
      baja: document.getElementById('jornada-baja-pct').value, meta: document.getElementById('campo-meta-votos-campana').value,
      sede: document.getElementById('campo-direccion-sede').value, fecha: document.getElementById('campo-fecha-eleccion').value }))()`);
    ok(guardado.nombre === 'Mariana Restrepo Ocampo', 'ficha Candidato: el nombre quedó guardado', guardado.nombre);
    ok(guardado.sub === 'Eslogan guardado en la 144', 'ficha Identidad: el eslogan del menú quedó guardado', guardado.sub);
    ok(guardado.depto === 'Caldas', 'ficha Territorio: el departamento quedó guardado', guardado.depto);
    ok(guardado.e14 === '95' && guardado.baja === '55', 'ficha Jornada Día D: el plazo del E-14 y el % de baja votación quedaron guardados', [guardado.e14, guardado.baja]);
    ok(guardado.meta === '31500' && guardado.sede === 'Carrera 23 # 62-16' && guardado.fecha === iso,
      'y lo de las otras fichas que se había tecleado antes, también', guardado);

    /* ===================================================================== H. UN ERROR EN OTRA FICHA */
    console.log('\n[H. Error forzado en un campo de otra ficha]');
    await clic('#dc-ficha-territorio'); await espera(150);
    await teclear('campo-telefono-2', '300');            // el teléfono vive en «Campaña y meta»
    ok((await ev(`document.getElementById('dc-ficha-territorio').getAttribute('aria-selected')`)) === 'true', 'se está en la ficha «Territorio»');
    await clic('#dc-btn-guardar');
    ok(await esperar(`document.getElementById('campana-error').classList.contains('visible')`, 8000), 'guardar avisa del error del teléfono');
    await espera(300);
    const salto = await ev(`(() => ({ activa: (document.querySelector('.dc-ficha[aria-selected=true]') || {}).id,
      panel: !document.getElementById('dc-panel-campana').hidden, foco: document.activeElement && document.activeElement.id,
      punto: document.getElementById('dc-ficha-campana').classList.contains('dc-con-error'),
      marcado: document.getElementById('campo-telefono-2').classList.contains('dc-campo-malo') }))()`);
    ok(salto.activa === 'dc-ficha-campana' && salto.panel, 'salta a la ficha «Campaña y meta», donde está el campo', salto);
    ok(salto.foco === 'campo-telefono-2', 'y enfoca el teléfono', salto.foco);
    ok(salto.punto, 'con un punto rojo en esa pestaña', salto);
    const punto = await ev(`(() => { const c = getComputedStyle(document.getElementById('dc-ficha-campana'), '::after'); return [c.backgroundColor, c.width, c.borderRadius]; })()`);
    ok(punto[0] === 'rgb(217, 45, 32)', 'el punto es rojo', punto);
    // Y al corregirlo se puede guardar.
    await teclear('campo-telefono-2', '3001234567');
    await clic('#dc-btn-guardar');
    ok(await esperar(`document.getElementById('campana-ok').classList.contains('visible')`, 12000), 'corregido el teléfono, guarda');

    /* ===================================================================== I. EL LOGO */
    console.log('\n[I. Cambiar logo y Quitar]');
    ok(await abrir(w, h, '/configuracion.html#datos-identidad'), 'se abre la ficha «Identidad»');
    // Los dos botones abren el MISMO selector de archivo: se comprueba interceptando el clic en el input.
    const pide = await ev(`(() => { window.__clics = 0; const inp = document.getElementById('archivo-logo');
      inp.addEventListener('click', (e) => { e.preventDefault(); window.__clics++; });
      document.getElementById('btn-cambiar-logo').click(); const a = window.__clics;
      document.getElementById('dc-btn-logo').click(); return [a, window.__clics]; })()`);
    ok(pide[0] === 1 && pide[1] === 2, 'los dos botones «Cambiar logo» (el de la ficha y el amarillo) abren el selector de archivo', pide);
    const quitarVisible = await ev(`getComputedStyle(document.getElementById('btn-quitar-logo')).display !== 'none'`);
    ok(quitarVisible, 'con logo propio, el botón «Quitar» se ofrece');
    const vista = await rect('#vista-logo');
    ok(vista && cerca(vista.width, 126, 3), `el logo de la ficha Identidad va en la caja de 150 px (imagen ${vista && vista.width} px)`);
    // Quitar: el modal de confirmación y la vuelta al logo de la plataforma.
    await clic('#btn-quitar-logo');
    ok(await esperar(`!!document.querySelector('.overlay.abierto')`, 6000), '«Quitar» pide confirmación');
    await ev(`(() => { const b = [...document.querySelectorAll('.overlay.abierto button')].find((x) => /Quitar el logo/i.test(x.textContent)); if (b) b.click(); return !!b; })()`);
    ok(await esperar(`document.getElementById('campana-ok').classList.contains('visible') && getComputedStyle(document.getElementById('btn-quitar-logo')).display === 'none'`, 10000),
      'quita el logo y vuelve al de la plataforma (y «Quitar» desaparece)');
    const trasQuitar = await ev(`(() => ({ ini: document.getElementById('dc-iniciales').textContent.trim(), iniVisible: getComputedStyle(document.getElementById('dc-iniciales')).display,
      img: getComputedStyle(document.getElementById('dc-logo-img')).display }))()`);
    ok(trasQuitar.iniVisible !== 'none' && trasQuitar.img === 'none' && trasQuitar.ini === 'MR',
      'la ficha azul pasa a las iniciales del candidato, sin recargar', trasQuitar);
    // El logo se repone al empezar cada vuelta (arriba), no aquí: así esta
    // sección puede dejarlo quitado, que es su resultado legítimo.

    /* ===================================================================== J. LA FICHA EN LA DIRECCIÓN */
    console.log('\n[J. La ficha abierta va en la dirección]');
    ok(await abrir(w, h, '/configuracion.html#datos-territorio'), 'se entra por #datos-territorio');
    const porHash = await ev(`(() => ({ activa: (document.querySelector('.dc-ficha[aria-selected=true]') || {}).id, panel: !document.getElementById('dc-panel-territorio').hidden,
      hash: location.hash, seccion: getComputedStyle(document.getElementById('seccion-campana')).display }))()`);
    ok(porHash.activa === 'dc-ficha-territorio' && porHash.panel, '#datos-territorio abre la ficha «Territorio»', porHash);
    ok(porHash.seccion === 'block', 'y la sección «Datos de la campaña» está a la vista', porHash.seccion);
    ok(porHash.hash === '#datos-territorio', 'el `#` no se pierde al acabar el arranque', porHash.hash);
    await clic('#dc-ficha-apoyos'); await espera(200);
    ok((await ev('location.hash')) === '#datos-apoyos', 'al cambiar de ficha, el `#` cambia con ella', await ev('location.hash'));
    // Y al revés: cambiar el `#` a mano abre la ficha.
    await ev(`location.hash = '#datos-jornada'`);
    await espera(400);
    ok((await ev(`(document.querySelector('.dc-ficha[aria-selected=true]') || {}).id`)) === 'dc-ficha-jornada', 'cambiar el `#` a mano abre esa ficha');
    // El menú lateral sigue marcando «Datos de la campaña» (va por `porDefecto`, no por el ancla).
    const menu = await ev(`(() => { const a = document.querySelector('.sidebar a.activo'); return a ? a.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
    ok(menu === 'Datos de la campaña', 'el menú lateral sigue marcando «Datos de la campaña»', menu);

    /* ===================================================================== K. APOYOS Y TERRITORIO */
    console.log('\n[K. Apoyos en tarjetas y las cajas de aviso]');
    ok(await abrir(w, h, '/configuracion.html#datos-apoyos'), 'se abre la ficha «Apoyos»');
    const hayApoyos = await ev(`getComputedStyle(document.getElementById('bloque-apoyos')).display !== 'none'`);
    ok(hayApoyos, 'con cargo «Gobernación» hay apoyos que configurar');
    if (hayApoyos) {
      if (await ev(`getComputedStyle(document.getElementById('panel-apoyos')).display === 'none'`)) { await clic('#btn-activar-apoyos'); await espera(250); }
      const tarjetas = await ev(`(() => [...document.querySelectorAll('#casillas-apoyos .dc-apoyo')].map((e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
        return { texto: e.textContent.trim(), top: Math.round(r.top), left: Math.round(r.left), borde: c.borderTopColor, fondo: c.backgroundColor, marcada: !!e.querySelector('input:checked') }; }))()`);
      ok(tarjetas.length >= 1, `las casillas salen como tarjetas (${tarjetas.length})`, tarjetas.map((t) => t.texto));
      const cols = await estilo('#casillas-apoyos', ['gridTemplateColumns']);
      ok(cols && cols[0].split(' ').length === (w >= 1100 ? 3 : 1), `tarjetas en ${w >= 1100 ? 3 : 1} columna(s)`, cols);
      // Marcar una: borde azul, fondo #F4F8FF y casilla amarilla.
      await ev(`(() => { const i = document.querySelector('#casillas-apoyos input'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await espera(200);
      const marcada = await ev(`(() => { const e = document.querySelector('#casillas-apoyos .dc-apoyo'); const c = getComputedStyle(e);
        return [c.borderTopColor, c.backgroundColor, getComputedStyle(e.querySelector('input')).accentColor]; })()`);
      ok(marcada[0] === 'rgb(11, 94, 215)' && marcada[1] === 'rgb(244, 248, 255)', 'marcada: borde #0B5ED7 y fondo #F4F8FF', marcada);
      ok(marcada[2] === AMARILLO, 'y la casilla en amarillo', marcada[2]);
    }
    await clic('#dc-ficha-territorio'); await espera(200);
    const cajaAzul = await estilo('#dc-panel-territorio .dc-aviso-azul', ['backgroundColor']);
    ok(cajaAzul && cajaAzul[0] === 'rgb(238, 244, 255)', 'la explicación de Territorio va en caja azul clara #EEF4FF', cajaAzul);
    await clic('#dc-ficha-campana'); await espera(200);
    const cajaAmarilla = await estilo('#dc-panel-campana .dc-aviso-amarillo', ['backgroundColor', 'borderTopColor']);
    ok(cajaAmarilla && cajaAmarilla[0] === 'rgb(255, 248, 219)' && cajaAmarilla[1] === 'rgb(255, 224, 138)',
      'la advertencia de los enlaces «Ya voté» en caja amarilla #FFF8DB con borde #FFE08A', cajaAmarilla);
    ok((await texto('#dc-panel-campana .dc-aviso-amarillo')).includes('Ya voté'), 'y dice lo de los enlaces «Ya voté»');
    await clic('#dc-ficha-jornada'); await espera(200);
    const interruptor = await estilo('#dc-panel-jornada .dc-interruptor', ['backgroundColor']);
    ok(interruptor && interruptor[0] === 'rgb(238, 244, 255)', 'el interruptor de avisos push, en caja azul clara', interruptor);
    ok((await texto('#dc-panel-jornada .dc-interruptor')).includes('Un aviso cada 5 minutos'), 'con su explicación completa');
    const subtitulos = await ev(`(() => [...document.querySelectorAll('#dc-panel-jornada .dc-sub')].map((e) => e.textContent.trim()))()`);
    ok(subtitulos.length === 2 && /Horario de la jornada/i.test(subtitulos[0]) && /Cuándo salen las alertas/i.test(subtitulos[1]),
      'los dos subtítulos de la jornada', subtitulos);
    // La muestra en vivo del menú lateral.
    await clic('#dc-ficha-identidad'); await espera(200);
    await teclear('campo-marca-titulo', 'CAMPAÑA DE PRUEBA 144');
    await espera(200);
    const muestra = await ev(`(() => { const t = document.getElementById('dc-muestra-titulo'); const s = document.getElementById('dc-muestra-sub'); const m = document.querySelector('.dc-muestra-menu');
      return { titulo: t.textContent.trim(), sub: s.textContent.trim(), subColor: getComputedStyle(s).color, subMayus: getComputedStyle(s).textTransform, fondo: getComputedStyle(m).backgroundColor }; })()`);
    ok(muestra.titulo === 'CAMPAÑA DE PRUEBA 144', 'la muestra del menú lateral se escribe al teclear el nombre', muestra);
    ok(muestra.subColor === AMARILLO && muestra.subMayus === 'uppercase', 'el eslogan de la muestra, en mayúsculas y amarillo', muestra);
    ok(muestra.fondo === 'rgb(16, 35, 63)', 'sobre el fondo oscuro del menú', muestra.fondo);

    await recoger(`${w}×${h}`);
  }

  /* ===================================================================== L. POR DEBAJO DE 1100 px */
  console.log('\n[L. Por debajo de 1100 px]');
  ok(await abrir(1000, 800, '/configuracion.html#datos-candidato'), 'la pantalla carga a 1000 px');
  const estrecho = await ev(`(() => { const reja = getComputedStyle(document.querySelector('.dc-reja')); const t = document.getElementById('dc-tarjeta');
    const caja = document.querySelector('#seccion-campana .dc-caja'); const fichas = document.getElementById('dc-fichas');
    return { cols: reja.gridTemplateColumns.split(' ').length, pos: getComputedStyle(t).position, tarjetaTop: Math.round(t.getBoundingClientRect().top),
      cajaTop: Math.round(caja.getBoundingClientRect().top), g2: getComputedStyle(document.querySelector('#dc-panel-candidato .dc-g2')).gridTemplateColumns.split(' ').length,
      desplaza: getComputedStyle(fichas).overflowX, anchoFichas: Math.round(fichas.scrollWidth) }; })()`);
  ok(estrecho.cols === 1, 'una sola columna', estrecho);
  ok(estrecho.pos === 'static', 'la ficha azul deja de ser sticky', estrecho.pos);
  ok(estrecho.tarjetaTop < estrecho.cajaTop, 'la ficha azul queda ARRIBA de la caja blanca', estrecho);
  ok(estrecho.g2 === 1, 'los campos a una columna', estrecho.g2);
  ok(estrecho.desplaza === 'auto' || estrecho.desplaza === 'scroll', 'las pestañas se desplazan de lado', estrecho.desplaza);
  await recoger('1000×800');

  /* ===================================================================== CAPTURAS DE LAS SEIS FICHAS A 1600 px */
  console.log('\n[Capturas de las seis fichas a 1600 px]');
  // Con logo, como pide la orden: la vuelta anterior lo quitó a propósito.
  await pool.query("UPDATE configuracion_campana SET marca_logo_url = '/img/logo.png' WHERE id = 1");
  await abrir(1600, 900, '/configuracion.html#datos-candidato');
  for (let i = 0; i < FICHAS.length; i++) {
    const [hash, idBoton, , , titulo] = FICHAS[i];
    await clic('#' + idBoton);
    await espera(350);
    const nombre = `144-${i + 1}-${hash}`;
    await foto(nombre);
    console.log(`  ${nombre}.png — ${titulo}`);
  }
  await recoger('capturas');

  console.log('\n--- errores de consola ---');
  if (errores.length) { errores.forEach((e) => console.log('  ' + e)); fallos += errores.length; } else console.log('  ninguno');

  console.log(`\n${fallos === 0 ? 'TODO BIEN' : fallos + ' FALLA(S)'} · capturas en ${SALIDA}`);
  try { p.cerrar(); nav.cerrar(); } catch (_) { /* ya cerrado */ }
  s.close();
  await pool.end();
  process.exit(fallos === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
