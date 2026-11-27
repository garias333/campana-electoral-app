#!/usr/bin/env node
// scripts/probar-barrio-pone-comuna.js
//
// ORDEN 134: en «Nuevo registro» del celular (public/app/registro-votante.html, paso 4 «Territorio y autorización»), al escribir el
// Barrio (o la Vereda) se pone sola la Comuna (o el Corregimiento). EN CHROMIUM REAL, con las rutas reales y la sesión de un líder y de
// un sublíder del arnés de capturas, a 390×844:
//   · «Centro» → Comuna Centro, con «Puesta según el barrio»; «centro», «CENTRO » y «Céntro» igual; «nino jesus» → «Niño Jesús» (ñ y tildes);
//   · una Comuna escrita a mano se reemplaza por la del barrio;
//   · vereda rural → Corregimiento y Área Rural; vereda que cuelga del municipio → solo el Área, el Corregimiento no se toca;
//   · nombre repetido en 2 comunas (o 2 corregimientos) → no llena nada y ofrece las comunas para tocar; tocar una la pone;
//   · nombre nuevo → la Comuna queda como estaba; Área vacía + nombre conocido → marca Urbano/Rural;
//   · Comuna elegida primero → las sugerencias de Barrio se limitan a esa comuna;
//   · sin conexión (la página ya cargada) sigue funcionando;
//   · GUARDAR: el votante queda con el barrio correcto (incluido el homónimo de la comuna elegida) y el área; cero errores de consola.
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada134 [SALIDA=/ruta] [ANTES=1] node scripts/probar-barrio-pone-comuna.js
//   ANTES=1 sirve la versión de git (HEAD) de la pantalla, para la captura «antes».
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
const { execSync } = require('child_process');
const pool = require('../config/db');
const { sembrar } = require('./capturas/semilla');
const { crear } = require('./capturas/servidor');
const { lanzar, espera } = require('./capturas/navegador');

const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden134');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];
const PAGINA = path.join(__dirname, '..', 'public', 'app', '_antes134.html');

(async () => {
  const ids = await sembrar(pool);
  // Que Ciudad/Departamento de residencia se llenen solos, como en una campaña de alcaldía.
  await q("UPDATE configuracion_campana SET cargo_aspira = 'alcaldia' WHERE id = 1");
  const [[mun]] = await pool.query("SELECT id FROM territorios WHERE tipo = 'municipio' AND nombre = 'Ciudad de ejemplo'");
  const [[cNorte]] = await pool.query("SELECT id FROM territorios WHERE nombre = 'Comuna Norte'");
  const [[cCentro]] = await pool.query("SELECT id FROM territorios WHERE nombre = 'Comuna Centro'");
  const [[corSur]] = await pool.query("SELECT id FROM territorios WHERE nombre = 'Corregimiento Sur'");
  const terr = async (tipo, nombre, padre) => {                       // idempotente: se puede correr dos veces sobre la misma base
    const [[ya]] = await pool.query('SELECT id FROM territorios WHERE tipo = ? AND nombre = ? AND padre_id = ?', [tipo, nombre, padre]);
    return ya ? ya.id : (await q('INSERT INTO territorios (tipo, nombre, padre_id) VALUES (?,?,?)', [tipo, nombre, padre])).insertId;
  };
  const corOriente = await terr('corregimiento', 'Corregimiento Oriente', mun.id);
  const t = {
    centro: await terr('barrio', 'Centro', cCentro.id),
    nino: await terr('barrio', 'Niño Jesús', cNorte.id),
    espNorte: await terr('barrio', 'La Esperanza', cNorte.id),
    espCentro: await terr('barrio', 'La Esperanza', cCentro.id),
    sinComuna: await terr('barrio', 'Barrio Suelto', mun.id),
    roble: await terr('vereda', 'El Roble', corSur.id),
    palmaSur: await terr('vereda', 'La Palma', corSur.id),
    palmaOri: await terr('vereda', 'La Palma', corOriente),
    sueltaMun: await terr('vereda', 'Vereda Suelta', mun.id),
  };

  const s = http.createServer(crear(pool));
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const rutaForm = process.env.ANTES ? '/app/_antes134.html' : '/app/registro-votante.html';
  if (process.env.ANTES) fs.writeFileSync(PAGINA, execSync('git show HEAD:public/app/registro-votante.html', { cwd: path.join(__dirname, '..'), maxBuffer: 1 << 26 }));

  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; const ce = console.error; console.error = function () { window.__errs.push([].slice.call(arguments).join(' ')); ce.apply(console, arguments); }; window.addEventListener('error', function (e) { window.__errs.push('ERR ' + e.message); });` });
  const errores = [];
  const recoger = async (donde) => { try { (await ev('window.__errs || []')).forEach((e) => errores.push(donde + ': ' + e)); } catch (_) { /* página cambiando */ } };
  const esperar = async (expr, ms = 12000) => {
    const hasta = Date.now() + ms;
    while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); }
    return false;
  };

  async function abrir(usuarioId) {
    await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cmd('Emulation.setTouchEmulationEnabled', { enabled: true });
    await cmd('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await cmd('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' });
    await cmd('Network.clearBrowserCookies');
    await cmd('Network.setCookie', { name: 'ej_usuario', value: String(usuarioId), url: base });
    await cmd('Page.navigate', { url: base + rutaForm });
    const listo = await esperar("!!document.getElementById('f-barrio') && typeof territorios !== 'undefined' && territorios.length > 0 && (document.getElementById('f-ciudad-residencia').value !== '')");
    await espera(400);
    return listo;
  }
  const clic = (id) => ev(`document.getElementById(${JSON.stringify(id)}).click()`);
  /** Escribe como una persona: enfoca, borra y teclea; `salir` = quita el foco (dispara change/blur). */
  async function escribir(id, texto, salir = true) {
    await ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.focus(); e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    if (texto) await cmd('Input.insertText', { text: texto });
    if (salir) await ev(`document.getElementById(${JSON.stringify(id)}).blur()`);
    await espera(60);
  }
  /** Lo que hace elegir una sugerencia del datalist: pone el valor y dispara input y change. */
  const elegirSugerencia = (id, valor) => ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(valor)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const limpiar = () => ev(`['f-barrio', 'f-comuna', 'f-vereda', 'f-corregimiento'].forEach((i) => { const e = document.getElementById(i); e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); })`);
  const estado = () => ev(`(() => {
    const v = (i) => document.getElementById(i).value; const vis = (i) => { const e = document.getElementById(i); return !!e && !e.hidden && e.offsetParent !== null; };
    const chips = (i) => [...document.querySelectorAll('#' + i + ' button')].map((b) => b.textContent.trim());
    return { comuna: v('f-comuna'), barrio: v('f-barrio'), corr: v('f-corregimiento'), vereda: v('f-vereda'), area: areaActual,
      avisoC: vis('aviso-comuna-barrio') ? document.getElementById('aviso-comuna-barrio').textContent.trim() : null,
      avisoR: vis('aviso-corregimiento-vereda') ? document.getElementById('aviso-corregimiento-vereda').textContent.trim() : null,
      opB: vis('opciones-comuna-barrio') ? chips('opciones-comuna-barrio') : null, opV: vis('opciones-corregimiento-vereda') ? chips('opciones-corregimiento-vereda') : null,
      sugB: [...document.querySelectorAll('#lista-barrios option')].map((o) => o.value), sugV: [...document.querySelectorAll('#lista-veredas option')].map((o) => o.value),
      desborde: document.documentElement.scrollWidth - innerWidth };
  })()`);
  /** Llega al paso 4 llenando lo mínimo de los pasos 1 a 3 con los botones reales. */
  async function irAlPaso4(cedula, nombre) {
    await ev(`(() => { const set = (i, x) => { const e = document.getElementById(i); e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
      set('f-cedula', ${JSON.stringify(cedula)}); })()`);
    await espera(1200);                                       // la comprobación de «ya registrado»
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        await ev(`(() => { const set = (i, x) => { const e = document.getElementById(i); e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); };
          set('f-nombre', ${JSON.stringify(nombre)}); set('f-telefono', '3001234567'); })()`);
      }
      await ev("document.querySelector('.pf-sig').click()"); await espera(350);
    }
    return esperar("!document.getElementById('campo-area').closest('.pf-paso').hidden");
  }
  async function foto(nombre) {
    const caja = await ev(`(() => { const a = document.getElementById('campo-area').getBoundingClientRect(); const o = document.getElementById('f-observaciones').getBoundingClientRect();
      return { y: a.top + scrollY - 10, h: o.top - a.top + 10 }; })()`);
    const r = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: Math.max(0, caja.y), width: 390, height: caja.h, scale: 1 } });
    fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r.result.data, 'base64'));
  }
  const alTerritorio = () => ev("document.getElementById('campo-area').scrollIntoView({ block: 'start' })");

  /** Firma, autoriza y guarda con el botón real; devuelve cuando la pantalla de éxito aparece (o el aviso de error). */
  async function guardar() {
    await ev("document.getElementById('f-consentimiento').click()"); await espera(500);
    const c = await ev("(() => { const b = document.getElementById('lienzo-firma'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()");
    await espera(300);
    const c2 = await ev("(() => { const r = document.getElementById('lienzo-firma').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()");
    const pt = (x, y, type) => cmd('Input.dispatchMouseEvent', { type, x: c2.x + x, y: c2.y + y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    await pt(20, c2.h / 2, 'mousePressed');
    for (let i = 1; i <= 12; i++) await pt(20 + i * 12, c2.h / 2 + (i % 2 ? 12 : -12), 'mouseMoved');
    await pt(170, c2.h / 2, 'mouseReleased');
    await ev("document.getElementById('btn-guardar').click()");
    return esperar("(() => { const a = document.getElementById('aviso-error'); return a && a.classList.contains('visible') ? 'error' : !!document.querySelector('#pantalla-exito') && document.querySelector('#pantalla-exito').offsetParent !== null; })()", 15000);
  }

  for (const [rol, usuario] of [['líder', ids.lider], ['sublíder', ids.sublider]]) {
    console.log(`\n=== Rol ${rol} · 390×844 ===`);
    const abierto = await abrir(usuario);
    ok(abierto, `${rol}: el formulario carga con los territorios`);
    if (!abierto) { console.log(await ev('document.body.innerText.slice(0, 300)')); continue; }
    ok((await irAlPaso4(rol === 'líder' ? '900100001' : '900100101', `Prueba Barrio ${rol}`)), `${rol}: llega al paso 4 (Territorio)`);
    await clic('chip-urbano'); await alTerritorio(); await espera(200);
    let e = await estado();
    ok(e.area === 'urbano' && e.comuna === '' && e.barrio === '', `${rol}: Urbano elegido, Comuna y Barrio vacíos al empezar`, e);
    ok(e.sugB.includes('Centro') && e.sugB.includes('La Esperanza') && !e.sugB.includes('El Roble'), `${rol}: sugerencias de Barrio = los barrios conocidos (ninguna vereda)`, e.sugB);
    if (rol === 'líder') await foto('1-antes-de-escribir-centro-390x844' + (process.env.ANTES ? '-VERSION-ANTERIOR' : ''));

    // 1) «Centro» y sus variantes
    await escribir('f-barrio', 'Centro');
    e = await estado();
    ok(e.comuna === 'Comuna Centro' && e.avisoC === 'Puesta según el barrio' && e.area === 'urbano', `${rol}: «Centro» → Comuna Centro, con «Puesta según el barrio»`, e);
    if (rol === 'líder') await foto('2-despues-de-escribir-centro-390x844' + (process.env.ANTES ? '-VERSION-ANTERIOR' : ''));
    if (process.env.ANTES) { await recoger('antes'); break; }
    for (const variante of ['centro', 'CENTRO ', 'Céntro', '  centro   ']) {
      await limpiar(); await escribir('f-barrio', variante); e = await estado();
      ok(e.comuna === 'Comuna Centro' && e.barrio === 'Centro', `${rol}: «${variante}» → Comuna Centro y el barrio queda «Centro»`, e);
    }
    // Al escribir (sin salir del campo): solo si el texto ya coincide exacto
    await limpiar(); await escribir('f-barrio', 'Cen', false); e = await estado();
    ok(e.comuna === '', `${rol}: «Cen» (a medias, sin salir) no llena nada`, e);
    await cmd('Input.insertText', { text: 'tro' }); e = await estado();
    ok(e.comuna === 'Comuna Centro', `${rol}: al completar «Centro» (aún con el foco en el campo) ya se llena`, e);
    await ev("document.getElementById('f-barrio').blur()");
    // Elegir la sugerencia
    await limpiar(); await elegirSugerencia('f-barrio', 'Niño Jesús'); e = await estado();
    ok(e.comuna === 'Comuna Norte' && e.avisoC, `${rol}: elegir la sugerencia «Niño Jesús» → Comuna Norte`, e);
    await limpiar(); await escribir('f-barrio', 'nino jesus'); e = await estado();
    ok(e.comuna === 'Comuna Norte' && e.barrio === 'Niño Jesús', `${rol}: «nino jesus» (sin ñ ni tilde) → Comuna Norte y el barrio queda «Niño Jesús»`, e);

    // 2) Comuna escrita a mano: se reemplaza; y corregirla a mano apaga el aviso
    await limpiar(); await escribir('f-comuna', 'Comuna Norte'); await escribir('f-barrio', 'Centro'); e = await estado();
    ok(e.comuna === 'Comuna Centro' && e.avisoC, `${rol}: una Comuna escrita a mano (Norte) se reemplaza por la del barrio (Centro)`, e);
    await escribir('f-comuna', 'Comuna Norte'); e = await estado();
    ok(e.comuna === 'Comuna Norte' && e.avisoC === null, `${rol}: la persona puede cambiar la Comuna a mano (y el aviso desaparece)`, e);

    // 3) Nombre en varias comunas: opciones, sin llenar
    await limpiar(); await escribir('f-barrio', 'la esperanza'); e = await estado();
    ok(e.comuna === '' && e.avisoC === null && JSON.stringify((e.opB || []).slice().sort()) === JSON.stringify(['Comuna Centro', 'Comuna Norte']), `${rol}: «La Esperanza» (2 comunas) no llena nada y ofrece Comuna Centro y Comuna Norte`, e);
    await alTerritorio();
    if (rol === 'líder') await foto('3-nombre-repetido-390x844');
    await ev("[...document.querySelectorAll('#opciones-comuna-barrio button')].find((b) => b.textContent.trim() === 'Comuna Centro').click()"); e = await estado();
    ok(e.comuna === 'Comuna Centro' && e.avisoC && e.opB === null, `${rol}: tocar «Comuna Centro» la pone y cierra las opciones`, e);
    if (rol === 'líder') await foto('4-nombre-repetido-tras-tocar-390x844');
    const resolucion = await ev('resolverTerritorio()');
    ok(resolucion.territorioId === t.espCentro, `${rol}: con la Comuna Centro elegida, «La Esperanza» se guarda como la de esa comuna (id ${t.espCentro})`, { resolucion, esperado: t.espCentro });
    await escribir('f-comuna', 'Comuna Norte');
    ok((await ev('resolverTerritorio()')).territorioId === t.espNorte, `${rol}: con la Comuna Norte elegida, la misma «La Esperanza» se guarda como la de Norte (id ${t.espNorte})`);

    // 4) Barrio nuevo: la Comuna no se toca
    await limpiar(); await escribir('f-comuna', 'Comuna Norte'); await escribir('f-barrio', 'Barrio Inventado Hoy'); e = await estado();
    ok(e.comuna === 'Comuna Norte' && e.avisoC === null && e.opB === null && e.barrio === 'Barrio Inventado Hoy', `${rol}: un barrio nuevo no toca la Comuna (ni cambia lo escrito)`, e);
    // Barrio que cuelga del municipio, sin comuna
    await limpiar(); await escribir('f-comuna', 'Comuna Norte'); await escribir('f-barrio', 'Barrio Suelto'); e = await estado();
    ok(e.comuna === 'Comuna Norte' && e.avisoC === null, `${rol}: un barrio sin comuna (cuelga del municipio) no cambia la Comuna`, e);

    // 5) Al revés: la Comuna primero limita los barrios
    await limpiar(); await escribir('f-comuna', 'Comuna Centro'); e = await estado();
    ok(JSON.stringify(e.sugB.slice().sort()) === JSON.stringify(['Centro', 'La Esperanza'].concat(['Barrio Plaza Nueva']).sort()), `${rol}: con Comuna Centro, las sugerencias de Barrio son solo las de esa comuna`, e.sugB);
    await escribir('f-comuna', 'Comuna Norte'); e = await estado();
    ok(!e.sugB.includes('Centro') && e.sugB.includes('Niño Jesús') && e.sugB.includes('Barrio Los Ejemplos'), `${rol}: con Comuna Norte, las de Norte`, e.sugB);

    // 6) Rural
    await limpiar(); await clic('chip-rural'); await espera(150);
    e = await estado();
    ok(e.area === 'rural' && e.sugV.includes('El Roble') && e.sugV.includes('Vereda Suelta') && !e.sugV.includes('Centro'), `${rol}: Rural → sugerencias de Vereda = todas las veredas (ningún barrio), aunque falte el Corregimiento`, e.sugV);
    await escribir('f-vereda', 'el roble'); e = await estado();
    ok(e.corr === 'Corregimiento Sur' && e.avisoR === 'Puesto según la vereda' && e.vereda === 'El Roble', `${rol}: vereda «el roble» → Corregimiento Sur`, e);
    await alTerritorio();
    if (rol === 'líder') await foto('5-vereda-pone-corregimiento-390x844');
    await limpiar(); await escribir('f-corregimiento', 'Corregimiento Sur'); await escribir('f-vereda', 'Vereda Suelta'); e = await estado();
    ok(e.corr === 'Corregimiento Sur' && e.avisoR === null, `${rol}: una vereda que cuelga del municipio no cambia el Corregimiento`, e);
    await limpiar(); await escribir('f-vereda', 'La Palma'); e = await estado();
    ok(e.corr === '' && JSON.stringify((e.opV || []).slice().sort()) === JSON.stringify(['Corregimiento Oriente', 'Corregimiento Sur']), `${rol}: «La Palma» (2 corregimientos) no llena nada y ofrece los dos`, e);
    await ev("[...document.querySelectorAll('#opciones-corregimiento-vereda button')].find((b) => b.textContent.trim() === 'Corregimiento Oriente').click()");
    ok((await estado()).corr === 'Corregimiento Oriente' && (await ev('resolverTerritorio()')).territorioId === t.palmaOri, `${rol}: tocar «Corregimiento Oriente» la pone y la vereda se guarda como la de Oriente`);
    await limpiar(); await escribir('f-vereda', 'Vereda Inventada'); e = await estado();
    ok(e.corr === '' && e.avisoR === null, `${rol}: una vereda nueva no toca el Corregimiento`, e);

    // 7) Área vacía + nombre conocido: marca el área
    await clic('chip-rural'); await espera(100);                       // lo desmarca → Área vacía
    ok((await estado()).area === '', `${rol}: Área vacía`);
    await ev(`(() => { const e = document.getElementById('f-barrio'); e.value = 'centro'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    e = await estado();
    ok(e.area === 'urbano' && e.comuna === 'Comuna Centro', `${rol}: con el Área vacía, un barrio conocido marca Urbano y pone la Comuna`, e);
    await clic('chip-urbano'); await espera(100);
    await ev(`(() => { const e = document.getElementById('f-vereda'); e.value = 'el roble'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    e = await estado();
    ok(e.area === 'rural' && e.corr === 'Corregimiento Sur', `${rol}: con el Área vacía, una vereda conocida marca Rural y pone el Corregimiento`, e);

    // 8) Sin conexión (la página ya cargada)
    await clic('chip-urbano'); await limpiar();
    await cmd('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await escribir('f-barrio', 'Centro'); e = await estado();
    ok(e.comuna === 'Comuna Centro', `${rol}: sin conexión, «Centro» sigue poniendo la Comuna`, e);
    await cmd('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    ok(e.desborde <= 0, `${rol}: nada se desborda en horizontal (390 px)`, e.desborde);

    // 9) GUARDAR de verdad
    await limpiar(); await escribir('f-barrio', rol === 'líder' ? 'la esperanza' : 'nino jesus');
    if (rol === 'líder') { await ev("[...document.querySelectorAll('#opciones-comuna-barrio button')].find((b) => b.textContent.trim() === 'Comuna Centro').click()"); }
    const fin = await guardar();
    ok(fin === true, `${rol}: «Guardar» termina en la pantalla de éxito`, fin === true ? undefined : await ev("document.getElementById('aviso-error').textContent"));
    const cedula = rol === 'líder' ? '900100001' : '900100101';
    const [v] = await q('SELECT v.id, v.territorio_id, v.area, v.categoria, v.comuna_corregimiento_residencia comuna, v.barrio_residencia barrio, v.lider_id FROM votantes v WHERE v.cedula = ?', [cedula]);
    ok(!!v, `${rol}: el votante quedó en la base`, v);
    if (v) {
      const esperadoId = rol === 'líder' ? t.espCentro : t.nino;
      ok(v.territorio_id === esperadoId && v.area === 'urbano', `${rol}: guardó territorio_id=${esperadoId} (${rol === 'líder' ? 'La Esperanza de Comuna Centro' : 'Niño Jesús'}) y área urbano`, v);
      const [[nom]] = await pool.query('SELECT b.nombre barrio, c.nombre comuna FROM territorios b LEFT JOIN territorios c ON c.id = b.padre_id WHERE b.id = ?', [v.territorio_id]);
      ok(nom && nom.comuna === (rol === 'líder' ? 'Comuna Centro' : 'Comuna Norte'), `${rol}: en la base el barrio guardado cuelga de ${rol === 'líder' ? 'Comuna Centro' : 'Comuna Norte'}`, nom);
    }
    await recoger(rol);
  }

  const reales = errores.filter((x) => !/tile|favicon|Failed to load|ERR_INTERNET_DISCONNECTED|net::ERR/i.test(x));
  ok(reales.length === 0, 'cero errores de consola', reales);
  nav.cerrar(); s.close();
  if (fs.existsSync(PAGINA)) fs.unlinkSync(PAGINA);
  console.log(`\n${pasos - fallos}/${pasos} comprobaciones correctas.`);
  console.log(fallos ? `HAY ${fallos} FALLO(S).` : 'TODO BIEN.');
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch(async (err) => { console.error(err); try { if (fs.existsSync(PAGINA)) fs.unlinkSync(PAGINA); } catch (_) { /* nada */ } process.exit(1); });
