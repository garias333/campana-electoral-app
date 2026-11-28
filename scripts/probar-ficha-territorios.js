#!/usr/bin/env node
// scripts/probar-ficha-territorios.js
//
// ORDEN 147 — «🗺️ Barrios y veredas», la séptima ficha de Configuración → Datos de la campaña,
// EN CHROMIUM REAL a 1600×900, contra el servidor y la base de verdad:
//
//   A. La ficha está DESPUÉS de «⏱️ Jornada Día D» y es la séptima.
//   B. `#datos-territorios-lista` la abre al cargar; cambiar de ficha deja el `#` en la dirección.
//   C. EL PIE NO SE MUESTRA en esta ficha (ahí «Guardar datos de la campaña» no guarda nada) y SÍ
//      en las otras seis; la nota «se guardan al momento» está a la vista.
//   D. SUPERADMINISTRADOR (es_superadmin = 1, usuario 2): ve agregar, importar y eliminar; exporta;
//      baja la plantilla (4 filas de ejemplo, 6 columnas); la importa (4 procesadas, 6 creadas);
//      la vuelve a importar y NO duplica (4 procesadas, 0 creadas); agrega una; edita una; elimina una.
//   E. ADMINISTRADOR (usuario 1): lo mismo que hoy — ve las tres acciones.
//   F. Buscador y filtro por tipo: acotan la tabla y el conteo.
//   G. ESTRUCTURA TERRITORIAL: «Gestionar territorios» ya no es un modal, es un enlace a la ficha;
//      `#gestionar-territorios` redirige allí; al coordinador y al líder no se les ofrece.
//   H. CAMPAÑA EN MODO CATÁLOGO (`territorios` convertido en VISTA): la ficha queda de solo lectura,
//      con el aviso y sin ningún botón de escribir.
//   Cero errores de consola en todas. Capturas en SALIDA.
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada147 [SALIDA=/ruta] \
//     node scripts/probar-ficha-territorios.js
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
const XLSX = require('xlsx');
const pool = require('../config/db');
const { sembrar } = require('./capturas/semilla');
const { crear } = require('./capturas/servidor');
const { lanzar, espera } = require('./capturas/navegador');
const modoTerritorios = require('../config/territoriosModo');

const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden147');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 900) : '')); }
}

/* Las siete fichas, en el orden que tienen que salir. La séptima es la de esta orden. */
const FICHAS = [
  ['datos-candidato',          'dc-ficha-candidato',          '👤 Candidato'],
  ['datos-campana-meta',       'dc-ficha-campana',            '🗳️ Campaña y meta'],
  ['datos-identidad',          'dc-ficha-identidad',          '🎨 Identidad'],
  ['datos-territorio',         'dc-ficha-territorio',         '🗺️ Territorio'],
  ['datos-apoyos',             'dc-ficha-apoyos',             '🤝 Apoyos'],
  ['datos-jornada',            'dc-ficha-jornada',            '⏱️ Jornada Día D'],
  ['datos-territorios-lista',  'dc-ficha-territorios-lista',  '🗺️ Barrios y veredas'],
];

/** Un POST JSON al servidor de prueba, con la cookie de sesión. Devuelve solo el código. */
function postear(base, ruta, idUsuario, cuerpo) {
  return new Promise((ok_, ko) => {
    const datos = Buffer.from(JSON.stringify(cuerpo || {}));
    const u = new URL(base + ruta);
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { Cookie: `ej_usuario=${idUsuario}`, 'Content-Type': 'application/json', 'Content-Length': datos.length } },
      (res) => { res.resume(); res.on('end', () => ok_(res.statusCode)); });
    r.on('error', ko);
    r.end(datos);
  });
}

/** Una petición HTTP al servidor de prueba, con la cookie de sesión. Devuelve el cuerpo en Buffer. */
function pedir(base, ruta, idUsuario) {
  return new Promise((ok_, ko) => {
    const r = http.get(base + ruta, { headers: { Cookie: `ej_usuario=${idUsuario}` } }, (res) => {
      const trozos = [];
      res.on('data', (c) => trozos.push(c));
      res.on('end', () => ok_({ status: res.statusCode, tipo: res.headers['content-type'] || '', cuerpo: Buffer.concat(trozos) }));
    });
    r.on('error', ko);
  });
}

(async () => {
  await sembrar(pool);

  const s = http.createServer(crear(pool));
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; const ce = console.error; console.error = function () { window.__errs.push([].slice.call(arguments).join(' ')); ce.apply(console, arguments); }; window.addEventListener('error', function (e) { window.__errs.push('ERR ' + e.message); });` });
  await cmd('DOM.enable');
  const errores = [];
  const recoger = async (donde) => { try { (await ev('window.__errs || []')).forEach((e) => errores.push(donde + ': ' + e)); } catch (_) { /* página cambiando */ } };
  const esperar = async (expr, ms = 15000) => { const hasta = Date.now() + ms; while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); } return false; };
  const foto = async (nombre) => {
    const r = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  const texto = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
  const visible = (id) => ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e) return null; const c = getComputedStyle(e); return c.display !== 'none' && c.visibility !== 'hidden'; })()`);
  const clic = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
  const teclear = (id, v) => ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e) return null; e.value = ${JSON.stringify(v)};
    e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return e.value; })()`);

  /* LA FICHA ESTÁ LISTA cuando el módulo ya pintó su tabla y contestó el modo.
     No basta con que exista el panel: su contenido lo pinta JavaScript. */
  const LISTO_CONF = "!!document.getElementById('dc-fichas') && !!document.getElementById('campo-nombre-candidato') && document.getElementById('campo-nombre-candidato').value !== ''";
  const LISTO_FICHA = "!!document.getElementById('tg-tbody') && document.getElementById('tg-tbody').children.length > 0";

  /**
   * Abre una pantalla de verdad, como una persona que llega por primera vez.
   * PASA POR about:blank A PROPÓSITO: `Page.navigate` a la misma página con otro
   * `#` no recarga, solo cambia el ancla (ver probar-datos-campana-fichas.js).
   */
  async function abrir(url, idUsuario, listo = LISTO_CONF) {
    await cmd('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await cmd('Page.navigate', { url: 'about:blank' });
    await espera(150);
    await cmd('Network.clearBrowserCookies');
    await cmd('Network.setCookie', { name: 'ej_usuario', value: String(idUsuario), url: base });
    await cmd('Page.navigate', { url: base + url });
    const l = await esperar(listo, 20000);
    await espera(700);
    return l;
  }

  /** Le entrega un archivo al <input type="file"> como lo haría el explorador del sistema. */
  async function elegirArchivo(selector, ruta) {
    const doc = await cmd('DOM.getDocument', { depth: 0 });
    const nodo = await cmd('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
    if (!nodo.result || !nodo.result.nodeId) return false;
    await cmd('DOM.setFileInputFiles', { files: [ruta], nodeId: nodo.result.nodeId });
    return true;
  }

  const contar = async (tipo) => {
    const [[r]] = await pool.query('SELECT COUNT(*) n FROM territorios WHERE tipo = ?', [tipo]);
    return Number(r.n);
  };

  try {
    /* ===================================================================== A. LA SÉPTIMA FICHA */
    console.log('\n[A. La séptima ficha, después de Jornada Día D]');
    ok(await abrir('/configuracion.html#campana', 2), 'Configuración abre con el superadministrador');
    const fichas = await ev(`[...document.querySelectorAll('#dc-fichas .dc-ficha')].map((e) => ({ id: e.id, ficha: e.dataset.ficha, texto: e.textContent.trim(), oculto: getComputedStyle(e).display === 'none' }))`);
    ok(fichas.length === 7, `siete fichas (${fichas.length})`, fichas.map((f) => f.texto));
    ok(fichas.every((f, i) => FICHAS[i] && f.ficha === FICHAS[i][0] && f.texto === FICHAS[i][2]),
      'en el orden pedido, «Barrios y veredas» la última', fichas.map((f) => f.texto));
    ok(fichas.length === 7 && fichas[5].ficha === 'datos-jornada' && fichas[6].ficha === 'datos-territorios-lista',
      'la séptima va inmediatamente después de Jornada Día D');
    const unaLinea = [...new Set((await ev(`[...document.querySelectorAll('#dc-fichas .dc-ficha')].map((e) => Math.round(e.getBoundingClientRect().top))`)))];
    ok(unaLinea.length === 1, `las siete en una sola línea (tops: ${unaLinea.join(', ')})`);
    await recoger('A');

    /* ===================================================================== B y C. ANCLA Y PIE */
    console.log('\n[B/C. El ancla propia y el pie que no se muestra]');
    ok(await abrir('/configuracion.html#datos-territorios-lista', 2, LISTO_FICHA),
      '#datos-territorios-lista abre la ficha directamente');
    ok(await ev(`document.getElementById('dc-panel-territorios-lista').hidden === false`), 'el panel de la ficha está a la vista');
    ok(await ev(`document.getElementById('dc-ficha-territorios-lista').getAttribute('aria-selected') === 'true'`), 'su pestaña queda marcada');
    ok((await visible('dc-pie')) === false, 'el pie («Guardar datos de la campaña») NO se muestra en esta ficha');
    ok(await visible('dc-aviso-territorios-al-momento'), 'se ve la nota «Los cambios de esta ficha se guardan al momento»');
    ok((await texto('#dc-aviso-territorios-al-momento') || '').includes('se guardan al momento'), 'y lo dice con esas palabras');
    await foto('147-ficha-barrios-y-veredas-superadmin');

    await clic('#dc-ficha-candidato'); await espera(250);
    ok(await visible('dc-pie'), 'al volver a «Candidato» el pie reaparece');
    ok(await ev(`!!document.getElementById('dc-btn-guardar')`), 'y el botón de guardar sigue ahí para las otras seis');
    await clic('#dc-ficha-territorios-lista'); await espera(250);
    ok((await visible('dc-pie')) === false, 'y se vuelve a esconder al entrar otra vez');
    ok(await ev(`window.location.hash === '#datos-territorios-lista'`), 'la dirección lleva el ancla de la ficha');
    await recoger('B/C');

    /* ===================================================================== D. SUPERADMINISTRADOR */
    console.log('\n[D. El superadministrador puede todo]');
    const [[sup]] = await pool.query('SELECT id, es_superadmin FROM usuarios WHERE id = 2');
    ok(sup && Number(sup.es_superadmin) === 1, 'el usuario 2 de la base ES el superadministrador');
    ok(await ev(`(window.dcTerritorios && window.dcTerritorios.estado().mando) === true`), 'el servidor le reconoce mando total');
    ok(await visible('tg-form'), 've el formulario de agregar');
    ok(await visible('tg-label-importar'), 've «Importar desde Excel»');
    ok(await visible('tg-eliminar-todos'), 've «Eliminar todos»');
    ok(await visible('tg-ayuda'), 've la caja de ayuda con las columnas');
    const ayuda = (await texto('#tg-ayuda')) || '';
    ok(['Departamento', 'Municipio', 'Área', 'Tipo', 'Nombre', 'Pertenece'].every((c) => ayuda.includes(c)),
      'la ayuda nombra las seis columnas');
    ok(ayuda.includes('Comuna') && ayuda.includes('Corregimiento') && ayuda.includes('Vereda'),
      'y dice qué vale en Tipo');
    ok((await visible('tg-aviso-vista')) === false, 'no sale el aviso del catálogo (aquí `territorios` es tabla local)');

    // --- Exportar
    const exportado = await pedir(base, '/api/territorial/territorios/exportar-excel', 2);
    ok(exportado.status === 200, `exportar responde 200 (${exportado.status})`);
    ok(exportado.tipo.includes('spreadsheetml'), 'y manda un .xlsx', exportado.tipo);

    // --- La plantilla de ejemplo
    const plantilla = await pedir(base, '/api/territorial/territorios/exportar-excel?plantilla=1', 2);
    ok(plantilla.status === 200, `la plantilla responde 200 (${plantilla.status})`);
    const libro = XLSX.read(plantilla.cuerpo, { type: 'buffer' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filasPlantilla = XLSX.utils.sheet_to_json(hoja, { defval: '' });
    ok(filasPlantilla.length === 4, `la plantilla trae 4 filas de ejemplo (${filasPlantilla.length})`);
    const encabezados = XLSX.utils.sheet_to_json(hoja, { header: 1 })[0];
    ok(JSON.stringify(encabezados) === JSON.stringify(['Departamento', 'Municipio', 'Área', 'Tipo', 'Nombre', 'Pertenece']),
      'con las seis columnas en orden', encabezados);
    ok(filasPlantilla.map((f) => f.Tipo).join(',') === 'Comuna,Barrio,Corregimiento,Vereda',
      'una fila de cada tipo', filasPlantilla.map((f) => f.Tipo));
    ok(filasPlantilla[1].Pertenece === filasPlantilla[0].Nombre, 'el barrio de ejemplo cuelga de la comuna de ejemplo');
    ok(filasPlantilla[3].Pertenece === filasPlantilla[2].Nombre, 'la vereda de ejemplo cuelga del corregimiento de ejemplo');
    const rutaPlantilla = path.join(SALIDA, 'plantilla-territorios.xlsx');
    fs.writeFileSync(rutaPlantilla, plantilla.cuerpo);

    // --- Importarla
    const antes = { comuna: await contar('comuna'), barrio: await contar('barrio'), vereda: await contar('vereda') };
    ok(await elegirArchivo('#tg-importar', rutaPlantilla), 'se le entrega la plantilla al importador');
    ok(await esperar(`(document.getElementById('tg-resultado').textContent || '').includes('Importación terminada')`, 20000),
      'el resumen de la importación sale EN LA PANTALLA (no en un alert)');
    const resumen1 = (await texto('#tg-resultado')) || '';
    ok(resumen1.includes('4 fila(s) procesada(s)'), 'dice 4 filas procesadas', resumen1.slice(0, 220));
    ok(resumen1.includes('6 territorio(s) nuevo(s)'), 'y 6 territorios nuevos (los 4 + su departamento y municipio)', resumen1.slice(0, 220));
    ok(resumen1.includes('0 fila(s) con error'), 'sin errores', resumen1.slice(0, 220));
    ok((await contar('comuna')) === antes.comuna + 1 && (await contar('barrio')) === antes.barrio + 1
       && (await contar('vereda')) === antes.vereda + 1, 'y en la base hay una comuna, un barrio y una vereda más');
    const [[galan]] = await pool.query("SELECT t.id, t.padre_id, pa.tipo AS tipo_padre, pa.nombre AS nombre_padre FROM territorios t LEFT JOIN territorios pa ON pa.id = t.padre_id WHERE t.tipo = 'barrio' AND t.nombre = 'Galán'");
    ok(galan && galan.tipo_padre === 'comuna', 'el barrio importado quedó colgando de su COMUNA, no del municipio', galan);
    await foto('147-importacion-resumen');

    // --- Importarla otra vez: ni un duplicado
    ok(await elegirArchivo('#tg-importar', rutaPlantilla), 'se vuelve a entregar el MISMO archivo');
    ok(await esperar(`(document.getElementById('tg-resultado').textContent || '').includes('0 territorio(s) nuevo(s)')`, 20000),
      'la segunda importación no crea NADA (0 territorios nuevos)');
    const resumen2 = (await texto('#tg-resultado')) || '';
    ok(resumen2.includes('4 fila(s) procesada(s)'), 'procesa las 4 filas igual', resumen2.slice(0, 220));
    ok((await contar('comuna')) === antes.comuna + 1 && (await contar('barrio')) === antes.barrio + 1,
      'y la base queda exactamente como estaba');

    // --- Agregar una a mano
    const barriosAntes = await contar('barrio');
    await teclear('tg-departamento', 'Caldas');
    await teclear('tg-municipio', 'Manizales');
    await teclear('tg-area', 'urbano');
    await espera(200);
    await teclear('tg-tipo', 'barrio');
    await espera(200);
    await teclear('tg-nombre', 'Barrio de la Orden 147');
    await clic('#tg-agregar');
    ok(await esperar(`document.getElementById('tg-ok').classList.contains('visible')`, 15000), 'agregar uno a mano responde «Zona agregada»');
    ok((await contar('barrio')) === barriosAntes + 1, 'y queda en la base');

    // --- Editar
    const [[nuevo]] = await pool.query("SELECT id FROM territorios WHERE nombre = 'Barrio de la Orden 147'");
    ok(!!nuevo, 'el barrio nuevo existe');
    await clic(`[data-tg-editar="${nuevo.id}"]`);
    await espera(400);
    ok(await ev(`document.getElementById('tg-ed-overlay').classList.contains('abierto')`), 'el lápiz abre el modal de editar');
    await teclear('tg-ed-nombre', 'Barrio Renombrado 147');
    await clic('#tg-ed-form button[type="submit"]');
    ok(await esperar(`document.getElementById('tg-ed-ok').classList.contains('visible')`, 15000), 'guardar el cambio responde «Territorio actualizado»');
    const [[renombrado]] = await pool.query('SELECT nombre FROM territorios WHERE id = ?', [nuevo.id]);
    ok(renombrado && renombrado.nombre === 'Barrio Renombrado 147', 'y el nombre cambió en la base', renombrado);

    // --- Eliminar
    await espera(1800);                      // el modal se cierra solo a los 1,6 s
    const barriosAntesBorrar = await contar('barrio');
    await clic(`[data-tg-eliminar="${nuevo.id}"]`);   // el diálogo lo acepta el arnés
    ok(await esperar(`!document.querySelector('[data-tg-eliminar="${nuevo.id}"]')`, 15000), 'eliminar lo saca de la tabla');
    ok((await contar('barrio')) === barriosAntesBorrar - 1, 'y de la base');
    await recoger('D');

    /* ===================================================================== F. BUSCADOR Y FILTRO */
    console.log('\n[F. Buscador y filtro por tipo]');
    const filasVisibles = () => ev(`document.getElementById('tg-tbody').children.length`);
    const todas = await filasVisibles();
    await teclear('tg-filtro-tipo', 'vereda');
    await espera(250);
    const soloVeredas = await filasVisibles();
    ok(soloVeredas > 0 && soloVeredas < todas, `el filtro por tipo acota (${todas} → ${soloVeredas})`);
    ok(await ev(`[...document.querySelectorAll('#tg-tbody .tag-tipo')].every((e) => e.textContent.trim() === 'vereda')`),
      'y solo deja veredas');
    ok(((await texto('#tg-conteo')) || '').includes(`${soloVeredas} de ${todas}`), 'el conteo dice cuántas de cuántas', await texto('#tg-conteo'));
    await teclear('tg-filtro-tipo', '');
    await teclear('tg-buscar', 'Alto Corinto');
    await espera(250);
    ok((await filasVisibles()) === 1, 'el buscador por nombre deja una sola fila');
    await teclear('tg-buscar', 'zzz-no-existe');
    await espera(250);
    ok((await filasVisibles()) === 0 && (await visible('tg-vacio')), 'y sin coincidencias sale el aviso de vacío');
    ok(((await texto('#tg-vacio')) || '').includes('coincide'), 'que dice que no coincide (no «aún no hay»)', await texto('#tg-vacio'));
    await teclear('tg-buscar', '');
    await espera(250);
    await recoger('F');

    /* ===================================================================== E. ADMINISTRADOR */
    console.log('\n[E. El administrador, igual que hoy]');
    ok(await abrir('/configuracion.html#datos-territorios-lista', 1, LISTO_FICHA), 'la ficha abre con el administrador');
    ok(await ev(`(window.dcTerritorios && window.dcTerritorios.estado().mando) === true`), 'el servidor le reconoce mando total');
    ok(await visible('tg-form'), 've el formulario de agregar');
    ok(await visible('tg-label-importar'), 've «Importar desde Excel»');
    ok(await visible('tg-eliminar-todos'), 've «Eliminar todos»');
    const expAdmin = await pedir(base, '/api/territorial/territorios/exportar-excel', 1);
    ok(expAdmin.status === 200, `y exporta (${expAdmin.status})`);
    await foto('147-ficha-barrios-y-veredas-admin');
    await recoger('E');

    /* ===================================================================== G. ESTRUCTURA TERRITORIAL */
    console.log('\n[G. Estructura territorial: el botón lleva a la ficha]');
    const LISTO_ESTR = "!!document.getElementById('btn-territorios') && !!document.getElementById('bloque-estructura')";
    ok(await abrir('/territorial.html', 1, LISTO_ESTR), 'Estructura territorial abre con el administrador');
    ok(await ev(`!document.getElementById('overlay-territorios')`), 'el modal «Territorios» ya no existe en la pantalla');
    ok(await ev(`!document.getElementById('overlay-editar-territorio')`), 'ni el modal de editar territorio');
    const enlace = await ev(`(() => { const e = document.getElementById('btn-territorios'); return e ? { tag: e.tagName, href: e.getAttribute('href'), visible: getComputedStyle(e).display !== 'none' } : null; })()`);
    ok(enlace && enlace.tag === 'A', '«Gestionar territorios» es un enlace, no un botón de modal', enlace);
    ok(enlace && enlace.href === '/configuracion.html#datos-territorios-lista', 'y apunta a la ficha', enlace);
    ok(enlace && enlace.visible === true, 'y al administrador se le ofrece');
    await recoger('G-admin');

    ok(await abrir('/territorial.html#gestionar-territorios', 1, "window.location.pathname === '/configuracion.html'"),
      '#gestionar-territorios redirige a Configuración');
    ok(await ev(`window.location.hash === '#datos-territorios-lista'`), 'y cae en la ficha de Barrios y veredas');
    await recoger('G-atajo');

    const [[coord]] = await pool.query("SELECT id FROM usuarios WHERE nombre = 'Carolina Ejemplo'");
    const [[lid]] = await pool.query("SELECT id FROM usuarios WHERE nombre = 'Laura Muestra'");
    for (const [quien, id] of [['coordinador', coord && coord.id], ['líder', lid && lid.id]]) {
      ok(await abrir('/territorial.html', id, LISTO_ESTR), `Estructura territorial abre con el ${quien}`);
      ok((await visible('btn-territorios')) === false, `al ${quien} no se le ofrece «Gestionar territorios»`);
      ok(await ev(`document.getElementById('tbody-estructura') ? true : !!document.getElementById('bloque-estructura')`),
        `y el ${quien} sigue viendo su pantalla`);
      await recoger('G-' + quien);
    }

    /* ================================================== I. LAS GUARDAS DEL SERVIDOR, POR ROL */
    console.log('\n[I. Quién puede escribir territorios, preguntándoselo al servidor]');
    const zona = { departamento: 'Caldas', municipio: 'Manizales', tipoZona: 'barrio', nombreZona: 'Zona guarda 147' };
    /* El superadministrador y el administrador escriben; el coordinador y el líder no.
       EL COORDINADOR YA NO PODÍA ANTES DE ESTA ORDEN: `requireRole` lo nombraba, pero
       `noCoordinador` corría primero y lo rechazaba — ese `'coordinador'` era código muerto.
       Se comprueba para que el cambio de guardas no le haya ABIERTO la puerta sin querer. */
    ok((await postear(base, '/api/territorial/territorios/crear-zona', 2, zona)) === 200,
      'el superadministrador crea una zona (200)');
    ok((await postear(base, '/api/territorial/territorios/crear-zona', 1, { ...zona, nombreZona: 'Zona guarda 147 admin' })) === 200,
      'el administrador también (200)');
    for (const [quien, id] of [['coordinador', coord && coord.id], ['líder', lid && lid.id]]) {
      ok((await postear(base, '/api/territorial/territorios/crear-zona', id, zona)) === 403,
        `el ${quien} NO crea zonas (403), igual que antes de esta orden`);
      ok((await postear(base, '/api/territorial/territorios/eliminar-todo', id, { password: 'x' })) === 403,
        `ni elimina todos (403) — ${quien}`);
      ok((await pedir(base, '/api/territorial/territorios/exportar-excel?plantilla=1', id)).status === 403,
        `ni baja la plantilla (403) — ${quien}`);
      ok((await pedir(base, '/api/territorial/territorios', id)).status === 200,
        `pero SIGUE leyendo la lista de territorios (200), que es de lo que viven sus desplegables — ${quien}`);
    }
    await pool.query("DELETE FROM territorios WHERE nombre LIKE 'Zona guarda 147%'");

    /* ===================================================================== H. MODO CATÁLOGO */
    console.log('\n[H. Campaña conectada al Catálogo Territorial: solo lectura]');
    /* `territorios` se convierte en una VISTA, que es lo que tiene una campaña conectada al
       catálogo. Se usa una subconsulta a propósito: así la vista NO es actualizable, igual que
       la de verdad (vista_territorios_catalogo.sql), y MySQL rechazaría una escritura aunque la
       guarda de la aplicación fallara. Va al final porque no se deshace. */
    await pool.query('RENAME TABLE territorios TO territorios_local');
    await pool.query(`CREATE VIEW territorios AS
      SELECT t.id, CAST(t.tipo AS CHAR) AS tipo, t.nombre, t.padre_id, t.created_at
        FROM territorios_local t
       WHERE t.id IN (SELECT id FROM territorios_local)`);
    modoTerritorios.olvidarCache();        // el detector cachea 60 s: se le avisa
    const [[tipoTabla]] = await pool.query(
      `SELECT TABLE_TYPE AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'territorios'`);
    ok(tipoTabla && tipoTabla.t === 'VIEW', 'la base ya tiene `territorios` como VISTA', tipoTabla);

    ok(await abrir('/configuracion.html#datos-territorios-lista', 2, LISTO_FICHA), 'la ficha abre igual en modo catálogo');
    ok(await visible('tg-aviso-vista'), 'sale el aviso de que los territorios vienen del catálogo');
    ok(((await texto('#tg-aviso-vista')) || '').includes('Catálogo Territorial'), 'y lo nombra', await texto('#tg-aviso-vista'));
    ok((await visible('tg-form')) === false, 'NO se ofrece agregar');
    ok((await visible('tg-label-importar')) === false, 'NO se ofrece importar');
    ok((await visible('tg-eliminar-todos')) === false, 'NO se ofrece eliminar todos');
    ok((await visible('tg-ayuda')) === false, 'ni la ayuda de la importación');
    ok((await visible('dc-aviso-territorios-al-momento')) === false,
      'ni la nota «se guardan al momento»: aquí no hay nada que guardar');
    ok(await ev(`document.getElementById('tg-tbody').children.length > 0`), 'pero la tabla SÍ se ve: la lectura no se toca');
    ok(await ev(`!document.querySelector('#tg-tbody [data-tg-editar]')`), 'y ninguna fila ofrece editar');
    ok(await ev(`!document.querySelector('#tg-tbody [data-tg-eliminar]')`), 'ni eliminar');
    const vistaMando = await ev(`window.dcTerritorios && window.dcTerritorios.estado()`);
    ok(vistaMando && vistaMando.editable === false, 'el servidor dijo editable=false', vistaMando);
    await foto('147-ficha-modo-catalogo-solo-lectura');
    /* Y el servidor también lo rechaza, no solo la pantalla. */
    const rechazo = await ev(`(async () => { const r = await fetch('/api/territorial/territorios/crear-zona', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'ejemplo' },
      body: JSON.stringify({ departamento: 'X', municipio: 'Y', tipoZona: 'barrio', nombreZona: 'Z' }) }); return r.status; })()`);
    ok(rechazo === 409, `crear-zona responde 409 en modo catálogo (${rechazo})`);
    await recoger('H');

    /* ===================================================================== CONSOLA */
    console.log('\n[Errores de consola]');
    ok(errores.length === 0, `cero errores de consola (${errores.length})`, errores.slice(0, 8));

    console.log(`\nCapturas en ${SALIDA}`);
    console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} COMPROBACIÓN(ES) FALLIDA(S)`);
  } catch (err) {
    fallos++;
    console.error('\nLa prueba se rompió:', err);
  } finally {
    try { p.cerrar(); } catch (_) { /* ya cerrada */ }
    try { nav.cerrar(); } catch (_) { /* ya cerrado */ }
    await new Promise((r) => s.close(r));
    await pool.end();
    process.exit(fallos === 0 ? 0 : 1);
  }
})();
