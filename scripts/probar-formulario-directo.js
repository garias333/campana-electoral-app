#!/usr/bin/env node
// scripts/probar-formulario-directo.js — Orden 99: «Agregar a la estructura» en el celular abre DIRECTO (sin pasar por la lista) y con la letra más grande.
//
// Chromium real con pantalla de celular y toque (isMobile + hasTouch). Para cada botón del celular que abre el formulario —el candidato («Registrar en la estructura territorial»),
// el administrador-candidato, el coordinador («Agregar líder») y el administrador («＋» / «Agregar coordinadores o líderes»)— abre /territorial.html?app=1[&volver=…]#nuevo a 360/390/412 px y comprueba:
//   · PRIMER PINTADO: un observador por cuadro (requestAnimationFrame, instalado antes de que cargue la página) anota en cada fotograma si la lista «Coordinadores y líderes» se veía. Ningún
//     fotograma puede mostrarla, y el elemento que queda arriba en el centro de la pantalla tiene que ser el formulario (o su esqueleto). Se repite con red lenta (latencia de 500 ms por petición),
//     que es cuando la lista se veía de más;
//   · letra del paso 1 (etiquetas y campos 18 px, botones de categoría y «Siguiente» 18 px con alto ≥ 52, títulos de sección 15 px, ayudas 16 px, título 22 px, «PASO 1 DE 5» 15 px, nada < 16 px en campos);
//   · scrollWidth <= innerWidth, escala 1 y «Siguiente» dentro de la pantalla (también con la letra del sistema al 130 %: se simula multiplicando cada tamaño por 1,3);
//   · «×» vuelve a la pantalla que abrió el formulario (no a la lista) y, al guardar, «Volver…» también;
//   · en el computador (1280 px) no cambia nada: ni la clase `abrir-directo`, ni la letra, y #nuevo sigue abriendo el formulario sobre la lista.
// Con ANTIGUO=1 sirve el territorial.html de HEAD (antes de la orden 99) para comprobar que el observador SÍ ve el salto de antes.
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada99 [ANTIGUO=1] [SALIDA=/ruta] [ETIQ=despues] node scripts/probar-formulario-directo.js
// Se niega a correr si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.
const path = require('path');
const R = path.join(__dirname, '..');
process.chdir(R);
require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) { console.error('Me niego: DB_NAME=' + nombreBase); process.exit(2); }
process.env.SESSION_SECRET = 'secreto-de-prueba'; process.env.LICENCIA_DOMINIO = 'campana.prueba'; process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';
const fs = require('fs'), os = require('os'), http = require('http'), { execSync } = require('child_process');
const express = require('express'), session = require('express-session'), bcrypt = require('bcryptjs');
const pool = require(R + '/config/db');
const { sembrar } = require('./fixtures/coordinadores-celular');
const { lanzar, espera } = require('./capturas/navegador');
const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden99');
fs.mkdirSync(SALIDA, { recursive: true });
const ETIQ = process.env.ETIQ || 'despues';
const ANTIGUO = !!process.env.ANTIGUO;
let fallos = 0, pasos = 0;
const ok = (c, t, x) => { pasos++; if (c) console.log('  ok   ' + t); else { fallos++; console.log('  FALLA ' + t + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 900) : '')); } };
const q = async (s, p) => (await pool.query(s, p))[0];
function crearApp() {
  const app = express(); app.set('trust proxy', 1); app.use(express.json());
  app.use(session({ secret: 'secreto-de-prueba', resave: false, saveUninitialized: true, cookie: { httpOnly: true } }));
  app.get('/api/csrf-token', (req, res) => res.json({ csrfToken: 'ejemplo' }));
  app.get('/api/marca-publica', (req, res) => res.json({ titulo: 'Campaña de ejemplo', subtitulo: '', logo_url: '', boton_testigos: false }));
  const { cargarSublicencia, restringirAspirante } = require(R + '/middleware/aspirante');
  app.use('/api', cargarSublicencia, restringirAspirante);
  app.use('/api', require(R + '/middleware/soloLecturaCandidato').soloLecturaCandidato);
  const montar = (ruta, a) => app.use(ruta, require(R + '/routes/' + a));
  ['auth', 'usuarios', 'territorial', 'votantes', 'votantes-dashboard:votantesDashboard', 'finanzas', 'eventos', 'recursos', 'legislacion', 'dashboard', 'configuracion', 'permisos', 'complementos', 'contenido', 'push', 'geo', 'manuales', 'panel-lider:panelLider', 'coordinador', 'catalogo', 'solicitudes', 'tareas', 'puerta-a-puerta:puertaAPuerta', 'candidato']
    .forEach((x) => { const [r, f] = x.split(':'); montar('/api/' + r, (f || r) + '.routes'); });
  montar('/api/dia-d/rescate', 'rescateVotos.routes'); montar('/api/dia-d', 'diaD.routes');
  // Tiempo que tarda cada petición a la API (para que la lista de la estructura llegue DESPUÉS de lo demás, como en un celular con señal regular).
  app.use('/api', (req, res, next) => (global.__demoraApi ? setTimeout(next, global.__demoraApi) : next()));
  app.use('/api', (req, res) => res.status(404).json({ error: 'sin ruta' }));
  if (ANTIGUO) {
    const viejo = execSync('git show HEAD:public/territorial.html', { cwd: R, maxBuffer: 64 * 1024 * 1024 }).toString();
    app.get('/territorial.html', (req, res) => { res.set('Content-Type', 'text/html; charset=utf-8'); res.set('Cache-Control', 'no-store'); res.send(viejo); });
  }
  app.use(express.static(R + '/public', { etag: false, lastModified: false, setHeaders: (r) => r.setHeader('Cache-Control', 'no-store') }));
  return app;
}
// El observador por cuadro. Se instala antes de que cargue la página y anota, en CADA fotograma, qué se veía.
const OBSERVADOR = `(() => {
  window.__cuadros = []; const t0 = performance.now();
  const visible = (e) => { if (!e) return false; const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  window.__tick = function tick() {
    const shell = document.getElementById('app-shell'), main = document.querySelector('.main'), ov = document.getElementById('overlay-form');
    const arriba = document.body ? document.elementFromPoint(innerWidth / 2, innerHeight / 2) : null;
    window.__cuadros.push({ t: Math.round(performance.now() - t0), body: !!document.body, lista: !!(shell && main && visible(shell) && visible(main)), hoja: !!(ov && visible(ov)),
      arribaEnHoja: !!(arriba && arriba.closest && arriba.closest('#overlay-form')), clases: document.documentElement.className });
  };
  // Se anota en cada cuadro Y cada 4 ms: Chromium sin ventana no siempre dispara requestAnimationFrame, y el estilo calculado es lo que se pinta en el siguiente cuadro.
  const bucle = () => { try { window.__tick(); } catch (_) {} requestAnimationFrame(bucle); };
  requestAnimationFrame(bucle); setInterval(() => { try { window.__tick(); } catch (_) {} }, 4);
})()`;

(async () => {
  const { ids } = await sembrar(pool);
  const rol = async (n) => (await q('SELECT id FROM roles WHERE nombre = ?', [n]))[0].id;
  await q("UPDATE configuracion_campana SET nombre_candidato='Juan Pérez', marca_titulo='Campaña de ejemplo' WHERE id=1");
  await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, es_candidato, clave_celular_pregunta_hecha) VALUES ('Diego Admin Candidato','1099000101','1099000101','admin.cand@ejemplo.co','3001230101',?,?,1,1,1)`, [bcrypt.hashSync('ClaveAdmin-ej81', 4), await rol('admin')]);
  await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, clave_celular_pregunta_hecha) VALUES ('Juan Pérez','1099000001','candidato.prueba','candidato.prueba@ejemplo.co','3001230000',?,?,1,1)`, [bcrypt.hashSync('ClaveCandidato-ej1', 4), await rol('candidato')]);
  await q("UPDATE usuarios SET clave_celular_pregunta_hecha = 1");
  const s = http.createServer(crearApp()); await new Promise((r) => s.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + s.address().port;
  const nav = await lanzar(); const p = await nav.pagina('about:blank'); const { cmd, ev } = p;
  const ir = async (u) => { await cmd('Page.navigate', { url: u }); await espera(900); };
  const esperar = async (e, ms = 15000) => { const h = Date.now() + ms; while (Date.now() < h) { try { if (await ev(e)) return true; } catch (_) {} await espera(100); } return false; };
  const foto = async (n) => { const r = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SALIDA, n + '.png'), Buffer.from(r.result.data, 'base64')); };
  const movil = (w, h = 844) => cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2.75, mobile: true });
  await cmd('Emulation.setTimezoneOverride', { timezoneId: 'America/Bogota' });
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVADOR });
  await movil(390); await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const entrar = async (email, clave) => {
    await cmd('Network.clearBrowserCookies'); await ir(base + '/login.html'); await ev('localStorage.clear(); sessionStorage.clear()');
    await ev(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)},password:${JSON.stringify(clave)}})}).then(r=>r.status)`);
  };
  const letraDelPaso = () => ev(`(() => { const px = (e) => e ? parseFloat(getComputedStyle(e).fontSize) : null; const v = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const paso = document.querySelector('.wz-paso:not([hidden])'); const f = document.getElementById('form-estructura');
    const etiquetas = [...paso.querySelectorAll('label')].filter(v).filter((e) => !e.closest('.chip-form') && e.parentElement.id !== 'chips-cargo-persona');
    const campos = [...paso.querySelectorAll('input:not([type=radio]):not([type=checkbox]):not([type=hidden]), select, textarea')].filter(v);
    const chips = [...paso.querySelectorAll('#chips-cargo-persona .chip-form')].filter(v);
    const ayudas = [...paso.querySelectorAll('small')].filter((e) => v(e) && e.textContent.trim());
    const secciones = [...paso.querySelectorAll('.encabezado-form')].filter(v);
    const sig = document.querySelector('.wz-sig'), atras = document.querySelector('.wz-atras');
    const chicas = [...paso.querySelectorAll('*')].filter((e) => v(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && px(e) < 15).map((e) => (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 20)) + '=' + px(e));
    const r = (e) => { const b = e.getBoundingClientRect(); return Math.round(b.height); };
    return { paso: (document.getElementById('wz-num') || {}).textContent, titulo: px(document.getElementById('modal-form-titulo')), num: px(document.getElementById('wz-num')),
      etiquetas: etiquetas.map(px), campos: campos.map(px), chips: chips.map(px), chipsAlto: chips.map(r), ayudas: ayudas.map(px), secciones: secciones.map(px), sig: px(sig), sigAlto: r(sig), atras: px(atras), atrasAlto: r(atras), chicas }; })()`);
  const medir = () => ev(`(() => { const v = window.visualViewport; const vis = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { izq: Math.round(r.left), der: Math.round(r.right), top: Math.round(r.top), bot: Math.round(r.bottom) }; };
    return { iw: innerWidth, sw: document.documentElement.scrollWidth, bsw: document.body.scrollWidth, escala: v ? v.scale : null, vvw: v ? Math.round(v.width) : null, sig: vis(document.querySelector('.wz-sig')), cerrar: vis(document.getElementById('cerrar-modal')),
      cuerpoSW: document.querySelector('.wz-cuerpo').scrollWidth, cuerpoCW: document.querySelector('.wz-cuerpo').clientWidth, ruta: location.pathname + location.search + location.hash }; })()`);
  const analizarCuadros = async () => {
    const c = await ev('window.__cuadros');
    const conLista = c.filter((x) => x.lista);
    const conBody = c.filter((x) => x.body);
    const primeraHoja = c.find((x) => x.hoja);
    // Antes de que exista la hoja solo puede haber blanco (el documento todavía se está leyendo); desde que existe, siempre es lo que queda arriba.
    const sinHoja = conBody.filter((x) => primeraHoja && x.t >= primeraHoja.t && !x.arribaEnHoja);
    const blanco = primeraHoja && conBody[0] ? primeraHoja.t - conBody[0].t : null;
    return { total: c.length, conLista: conLista.length, primeraHoja: primeraHoja ? primeraHoja.t : null, blancoMs: blanco, cuadrosSinHojaArriba: sinHoja.length, primerCuadro: conBody[0] ? conBody[0].t : null, ultimo: c[c.length - 1] };
  };
  const hacer = async (nom, ruta, w, { letra = 0, lento = false } = {}) => {
    await movil(w); await ir('about:blank');
    global.__demoraApi = lento ? 500 : 0;
    if (lento) await cmd('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: -1, uploadThroughput: -1 });
    await cmd('Page.navigate', { url: base + ruta });
    // Primer pintado: apenas existe la hoja o la lista en el documento.
    await esperar("document.body && document.getElementById('overlay-form') && getComputedStyle(document.documentElement).display !== ''", 15000);
    if (lento) { await espera(400); await foto(`${ETIQ}-${nom}-${w}-1-primer-pintado${lento ? '-red-lenta' : ''}`); }
    const listo = await esperar("document.documentElement.classList.contains('directo-listo') || (document.getElementById('overlay-form') && document.getElementById('overlay-form').classList.contains('abierto'))", 25000);
    await espera(1500);
    if (letra) { await ev(`(() => { const els = [document.documentElement, ...document.querySelectorAll('body *')]; const fs = els.map((e) => parseFloat(getComputedStyle(e).fontSize)); els.forEach((e, i) => e.style.setProperty('font-size', (fs[i] * ${letra}) + 'px', 'important')); return 0; })()`); await espera(600); }
    if (lento) await cmd('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    return { listo };
  };

  // ---------------------------- botones del celular que abren el formulario ----------------------------
  const casos = [
    ['candidato', 'candidato.prueba@ejemplo.co', 'ClaveCandidato-ej1', '/territorial.html?app=1&volver=/app/candidato.html#nuevo', '/app/candidato.html'],
    ['admin-candidato', 'admin.cand@ejemplo.co', 'ClaveAdmin-ej81', '/territorial.html?app=1&volver=/app/candidato.html#nuevo', '/app/candidato.html'],
    ['coordinador', '1023456789', 'clave-correo-ej', '/territorial.html?app=1&volver=/app/mis-lideres.html#nuevo', '/app/mis-lideres.html'],
    ['admin', 'admin.ej@ejemplo.co', 'clave-admin-ej', '/territorial.html?app=1#nuevo', '/app/admin-estructura.html']
  ].filter((c) => !process.env.SOLO || process.env.SOLO.split(',').includes(c[0]));
  for (const [nom, em, cl, ruta, origen] of casos) {
    await entrar(em, cl);
    for (const w of [360, 390, 412]) {
      for (const lento of [false, true]) {
        if (lento && w !== 390) continue;
        const { listo } = await hacer(nom, ruta, w, { lento });
        const c = await analizarCuadros();
        console.log(`  [${nom} ${w}${lento ? ' red lenta' : ''}] cuadros:`, JSON.stringify(c));
        ok(listo, `${nom} ${w}${lento ? ' (red lenta)' : ''}: el formulario abre`);
        ok(c.conLista === 0, `${nom} ${w}${lento ? ' (red lenta)' : ''}: NINGÚN cuadro mostró la lista «Coordinadores y líderes» (${c.conLista} de ${c.total} cuadros)`, c);
        ok(c.cuadrosSinHojaArriba === 0, `${nom} ${w}${lento ? ' (red lenta)' : ''}: en todos los cuadros lo que queda arriba en el centro es el formulario (${c.cuadrosSinHojaArriba} sin él)`, c);
        ok(c.primeraHoja !== null && c.blancoMs !== null && c.blancoMs <= 300, `${nom} ${w}${lento ? ' (red lenta)' : ''}: el formulario aparece a los ${c.blancoMs} ms de existir el documento (sin pantallazo en blanco largo)`, c);
        if (lento) { await foto(`${ETIQ}-${nom}-${w}-2-listo`); continue; }
        const L = await letraDelPaso(); const m = await medir();
        console.log(`  [${nom} ${w}] letra:`, JSON.stringify(L));
        const todos = (arr, f) => arr.length > 0 && arr.every(f);
        ok(/Paso 1 de 5/i.test(L.paso), `${nom} ${w}: el primer paso es «Paso 1 de 5»`, L.paso);
        ok(L.titulo === 22, `${nom} ${w}: título «Agregar a la estructura» 22 px`, L.titulo);
        ok(L.num === 15, `${nom} ${w}: «PASO 1 DE 5» 15 px`, L.num);
        if (nom === 'coordinador') {
          ok(L.etiquetas.length === 0 || todos(L.etiquetas, (x) => x === 18), `${nom} ${w}: etiquetas del paso 1 a 18 px`, L.etiquetas);
        } else {
          ok(todos(L.etiquetas, (x) => x === 18), `${nom} ${w}: etiquetas del paso 1 a 18 px`, L.etiquetas);
          ok(todos(L.chips, (x) => x === 18) && todos(L.chipsAlto, (x) => x >= 52), `${nom} ${w}: botones de categoría a 18 px y ≥ 52 px de alto`, { f: L.chips, h: L.chipsAlto });
          ok(todos(L.secciones, (x) => x === 15), `${nom} ${w}: títulos de sección (CATEGORÍA…) a 15 px`, L.secciones);
        }
        ok(todos(L.campos, (x) => x >= 18), `${nom} ${w}: campos a 18 px (y nunca < 16)`, L.campos);
        ok(L.ayudas.every((x) => x === 16), `${nom} ${w}: textos de ayuda a 16 px`, L.ayudas);
        ok(L.sig === 18 && L.sigAlto >= 52 && L.atras === 18 && L.atrasAlto >= 52, `${nom} ${w}: «Siguiente» y «Atrás» a 18 px y ≥ 52 px de alto`, { s: L.sig, sa: L.sigAlto, a: L.atras, aa: L.atrasAlto });
        ok(L.chicas.length === 0, `${nom} ${w}: ningún texto del paso 1 por debajo de 15 px`, L.chicas);
        ok(m.sw <= m.iw && m.bsw <= m.iw && m.cuerpoSW <= m.cuerpoCW, `${nom} ${w}: sin desborde a lo ancho (scrollWidth ${m.sw} ≤ ${m.iw})`, m);
        ok(m.escala === 1 && m.vvw === m.iw, `${nom} ${w}: escala 1 y el diseño mide lo mismo que la pantalla`, m);
        ok(m.sig && m.sig.der <= m.iw && m.sig.izq >= 0 && m.sig.bot <= 845 && m.cerrar && m.cerrar.der <= m.iw, `${nom} ${w}: «Siguiente» y «×» dentro de la pantalla`, m);
        if (w === 390) await foto(`${ETIQ}-${nom}-390-paso1`);
        // Recorre los cinco pasos con la letra nueva: nada se desborda ni queda con letra chica.
        for (let k = 2; k <= 5; k++) {
          if (k === 4) { await ev(`(() => { const n = document.querySelector('#form-estructura [name="nombre"]'); n.value = 'Persona De Prueba'; n.dispatchEvent(new Event('input', { bubbles: true })); return 0; })()`); }
          if (k === 5) { await ev(`(() => { const c = document.getElementById('chk-area-influencia-municipio'); if (c && !c.checked) c.click(); return 0; })()`); await espera(200); }
          await ev(`(() => { const b = document.querySelector('.wz-sig'); if (getComputedStyle(b).display !== 'none') b.click(); return 0; })()`); await espera(250);
          const Lk = await letraDelPaso(); const mk = await medir();
          if (/Paso (\d) de 5/i.exec(Lk.paso || '') && Number(/Paso (\d)/i.exec(Lk.paso)[1]) === k) {
            ok(mk.sw <= mk.iw && mk.cuerpoSW <= mk.cuerpoCW, `${nom} ${w} paso ${k}: sin desborde (scrollWidth ${mk.sw} ≤ ${mk.iw})`, mk);
            ok(Lk.campos.every((x) => x >= 16) && Lk.etiquetas.every((x) => x >= 18) && Lk.chicas.length === 0, `${nom} ${w} paso ${k}: campos ≥ 16, etiquetas 18, nada < 15 px`, { c: Lk.campos, e: Lk.etiquetas, chicas: Lk.chicas });
            if (w === 390) await foto(`${ETIQ}-${nom}-390-paso${k}`);
          } else if (k === 2 || nom !== 'coordinador') ok(false, `${nom} ${w}: «Siguiente» no avanzó al paso ${k}`, Lk.paso);
        }
        // «×» vuelve a la pantalla que abrió el formulario.
        const antes = await ev('location.pathname');
        await ev("document.getElementById('cerrar-modal').click()"); await espera(1200);
        const despues = await ev('location.pathname + location.search');
        ok(despues.startsWith(origen), `${nom} ${w}: «×» vuelve a ${origen}, no a la lista (quedó en ${despues})`, { antes, despues });
      }
    }
    // La letra del sistema al 130 %: nada más ancho que la pantalla.
    for (const w of [360, 390]) {
      await hacer(nom, ruta, w, { letra: 1.3 });
      const m = await medir();
      ok(m.sw <= m.iw && m.bsw <= m.iw && m.cuerpoSW <= m.cuerpoCW && m.escala === 1 && m.vvw === m.iw, `${nom} ${w} + letra del sistema 130 %: sin desborde, escala 1 (sw ${m.sw}, iw ${m.iw}, vv ${m.vvw})`, m);
      ok(m.sig && m.sig.der <= m.iw && m.sig.izq >= 0 && m.cerrar && m.cerrar.der <= m.iw, `${nom} ${w} + 130 %: «Siguiente» y «×» dentro de la pantalla`, m);
      await foto(`${ETIQ}-${nom}-${w}-letra130`);
    }
  }

  // ---------------------------- guardar: se crea la persona y «Volver…» regresa al origen ----------------------------
  for (const [nom, em, cl, ruta, origen] of casos) {
    await entrar(em, cl);
    await hacer(nom, ruta, 390);
    const cedula = '10770005' + String(Math.floor(Math.random() * 90) + 10);
    await ev(`(() => { const f = document.getElementById('form-estructura'); const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      set(f.querySelector('[name="nombre"]'), 'Persona De Prueba Directa ${nom}'); set(document.getElementById('input-numero-persona'), '${cedula}'); const t = f.querySelector('[name="telefono"]'); if (t) set(t, '31${Math.floor(Math.random() * 90000000 + 10000000)}'); return 0; })()`);
    await espera(1200);
    for (let k = 1; k < 5; k++) {
      if (k === 4) { await ev(`(() => { const c = document.getElementById('chk-area-influencia-municipio'); if (c && !c.checked) c.click(); return 0; })()`); await espera(200); }
      await ev("document.querySelector('.wz-sig').click()"); await espera(350);
    }
    const num = await ev("document.getElementById('wz-num').textContent");
    await ev("document.getElementById('btn-guardar-estructura').click()");
    const guardo = await esperar("document.querySelector('.wz-exito.visible') !== null", 15000);
    const txt = guardo ? await ev("document.getElementById('wz-exito-texto').textContent") : await ev("document.getElementById('form-error').textContent + ' | ' + document.getElementById('territorio-persona-error').textContent");
    ok(guardo, `${nom}: se guarda a la persona desde el paso ${num} («${txt}»)`, txt);
    if (guardo) {
      await foto(`${ETIQ}-${nom}-390-guardado`);
      const boton = await ev("document.querySelector('.wz-lista').textContent");
      await ev("document.querySelector('.wz-lista').click()"); await espera(1200);
      const dest = await ev('location.pathname');
      ok(dest === origen, `${nom}: «${boton}» al guardar vuelve a ${origen}, no a la lista (quedó en ${dest})`, dest);
    }
  }

  // ---------------------------- computador: nada cambia ----------------------------
  await entrar('admin.ej@ejemplo.co', 'clave-admin-ej');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: false });
  await ir('about:blank'); global.__demoraApi = 0;
  await cmd('Page.navigate', { url: base + '/territorial.html#nuevo' });
  await esperar("document.getElementById('overlay-form') && document.getElementById('overlay-form').classList.contains('abierto')", 20000); await espera(1200);
  const pc = await ev(`(() => { const px = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).fontSize : null; };
    return { clases: document.documentElement.className, directo: !!window.__ENTRADA_DIRECTA, abierto: document.getElementById('overlay-form').classList.contains('abierto'),
      lista: getComputedStyle(document.getElementById('app-shell')).display, label: px('#form-estructura label'), titulo: px('#modal-form-titulo'), chip: px('#chips-cargo-persona .chip-form'), enc: px('#form-estructura .encabezado-form'),
      campo: px('#form-estructura input[name=nombre]'), small: px('#form-estructura small') }; })()`);
  console.log('  [computador 1280]', JSON.stringify(pc));
  ok(!/abrir-directo|modo-app|directo-listo/.test(pc.clases) && pc.directo === false, 'computador 1280: sin clase abrir-directo ni modo-app', pc);
  ok(pc.abierto && pc.lista !== 'none', 'computador 1280: #nuevo sigue abriendo el formulario sobre la lista de siempre', pc);
  await foto(`${ETIQ}-computador-1280`);
  fs.writeFileSync(path.join(SALIDA, `${ETIQ}-computador-letra.json`), JSON.stringify({ label: pc.label, titulo: pc.titulo, chip: pc.chip, enc: pc.enc, campo: pc.campo, small: pc.small }));
  try { nav.cerrar(); } catch (_) { /* el perfil sigue en uso un instante */ } s.close();
  console.log(`\n${fallos === 0 ? 'TODO BIEN' : 'HAY FALLOS'}: ${pasos - fallos} de ${pasos}.`);
  await pool.end(); process.exit(fallos ? 1 : 0);
})().catch(async (e) => { console.error('Error:', e); try { await pool.end(); } catch (_) {} process.exit(1); });
