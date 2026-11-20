#!/usr/bin/env node
// scripts/probar-interruptor-testigos.js
//
// Prueba de la ORDEN 69 (parche 347): el botón «Acceso a Testigos Electorales» de la pantalla de ingreso del celular se oculta, y solo vuelve cuando el
// interruptor «Activar botón Acceso a Testigos Electorales en App de celular» (Configuración → Activar complementos) está encendido. EN CHROMIUM REAL a 390×844.
//   · apagado: cuatro botones en el orden pedido y la ayuda sin testigos; encendido en Configuración: vuelve el orden de la Orden 64 y la ayuda de hoy; apagarlo: se va;
//   · la ruta pública solo dice sí o no; sin fila en la base cuenta como apagado; sin señal o mientras carga: oculto, sin errores de consola;
//   · quién puede cambiarlo: el administrador sí; el coordinador, el líder y quien no tiene sesión, no;
//   · un testigo SÍ puede entrar por el botón de Líderes (mismo formulario) con el interruptor apagado: solo se informa, no se bloquea.
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada69 [SALIDA=/ruta] node scripts/probar-interruptor-testigos.js
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
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const C = require('../lib/complementos');
const { sembrar, crearApp, CLAVE_ADMIN } = require('./fixtures/coordinadores-celular');
const { sincronizarClaveCelular } = require('../lib/claveCelular');
const { lanzar, espera } = require('./capturas/navegador');

const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden69');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];
const CLAVE = 'boton_testigos_celular';
const AYUDA_SIN = 'Líderes, sublíderes, aspirantes y coordinadores entran con su cédula y una clave de 6 dígitos. Administración, con su correo o celular.';
const AYUDA_CON = 'Líderes, sublíderes, aspirantes, coordinadores y testigos entran con su cédula y una clave de 6 dígitos. Administración, con su correo o celular.';
const SIN = ['Acceso a Líderes y Sublíderes', 'Acceso a Aspirantes al Concejo', 'Acceso a Coordinadores', 'Otros usuarios'];
const CON = ['Acceso a Líderes y Sublíderes', 'Acceso a Aspirantes al Concejo', 'Acceso a Coordinadores', 'Acceso a Testigos Electorales', 'Otros usuarios'];

(async () => {
  const { ids } = await sembrar(pool);
  const [r] = await pool.query('INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, telefono, clave_celular_pregunta_hecha) VALUES (?, ?, ?, ?, ?, ?, 1)',
    ['Tomás Testigo Ejemplo', '1077000001', '1077000001', bcrypt.hashSync('1077000001', 4), (await q("SELECT id FROM roles WHERE nombre = 'testigo'"))[0].id, '3010000001']);
  ids.testigo = r.insertId;
  await q("INSERT INTO estructura (usuario_id, cargo, activo) VALUES (?, 'testigo', 1)", [ids.testigo]);
  await sincronizarClaveCelular(pool, ids.testigo);
  await q('UPDATE usuarios SET clave_celular_pregunta_hecha = 1');

  const s = http.createServer(crearApp(pool));
  await new Promise((r2) => s.listen(0, '127.0.0.1', r2));
  const base = `http://127.0.0.1:${s.address().port}`;
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; const ce = console.error; console.error = function () { window.__errs.push([].slice.call(arguments).join(' ')); ce.apply(console, arguments); }; window.addEventListener('error', function (e) { window.__errs.push('ERR ' + e.message); });` });
  const errores = [];
  const recoger = async (donde) => { try { (await ev('window.__errs || []')).forEach((e) => errores.push(donde + ': ' + e)); } catch (_) { /* pagina cambiando */ } };
  const movil = async () => { await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await cmd('Emulation.setTouchEmulationEnabled', { enabled: true }); };
  const escritorio = async () => { await cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await cmd('Emulation.setTouchEmulationEnabled', { enabled: false }); };
  const ir = async (url) => { await cmd('Page.navigate', { url }); await espera(900); };
  const esperar = async (expr, ms = 10000) => {
    const hasta = Date.now() + ms;
    while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); }
    return false;
  };
  const foto = async (nombre, w = 390) => {
    const alto = await ev('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)');
    const r3 = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: alto, scale: 1 } });
    fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r3.result.data, 'base64'));
  };
  const botones = () => ev(`[...document.querySelectorAll('#form-elegir-acceso button')].filter((b) => b.offsetParent !== null).map((b) => b.innerText.trim())`);
  const ayuda = () => ev(`document.getElementById('ayuda-eleccion').innerText.replace(/\\s+/g, ' ').trim()`);
  const sinDesborde = () => ev('document.documentElement.scrollWidth <= window.innerWidth + 1');
  /** Abre la pantalla de ingreso del celular SIN sesión y espera a que se vea la lista de botones y llegue la lectura de la marca. */
  async function abrirIngreso() {
    await cmd('Network.clearBrowserCookies');
    await movil();
    await ir(base + '/login.html');
    const lista = await esperar("document.getElementById('form-elegir-acceso') && document.getElementById('form-elegir-acceso').style.display === 'block'");
    await espera(900);       // la lectura de /api/marca-publica llega después
    return lista;
  }
  const apagar = async () => { await q('UPDATE complementos_campana SET activo = 0 WHERE clave = ?', [CLAVE]); C.invalidar(); };

  console.log('\n[1] De fábrica: el complemento existe y está APAGADO');
  const fila = await q('SELECT clave, activo FROM complementos_campana WHERE clave = ?', [CLAVE]);
  ok(fila.length === 1 && Number(fila[0].activo) === 0, 'init-db sembró la fila `boton_testigos_celular` con activo = 0', fila);
  ok((await q('SELECT COUNT(*) AS n FROM complementos_campana'))[0].n === 11, 'y hay once complementos en total (los diez de antes y este)');
  const def = C.CATALOGO.find((c) => c.clave === CLAVE);
  ok(def && def.nombre === 'Activar botón Acceso a Testigos Electorales en App de celular' && def.descripcion === 'Muestra el botón de ingreso para testigos en la pantalla de inicio de la app del celular.' && def.modulos.length === 0 && def.depende === null,
    'nombre y línea de ayuda tal como se pidieron; sin módulos de permisos ni dependencia', def);

  console.log('\n[2] APAGADO: la pantalla de ingreso del celular (390×844)');
  ok(await abrirIngreso(), 'abre «¿Cómo va a ingresar?»');
  const b0 = await botones();
  ok(JSON.stringify(b0) === JSON.stringify(SIN), 'cuatro botones, en el orden: Líderes y Sublíderes, Aspirantes, Coordinadores, Otros usuarios', b0);
  ok((await ayuda()) === AYUDA_SIN, 'la ayuda de abajo no menciona testigos', await ayuda());
  ok(await ev("getComputedStyle(document.getElementById('ir-a-testigos-desde-eleccion')).display") === 'none', 'el botón de testigos está oculto');
  ok(await sinDesborde(), 'sin desborde horizontal');
  await foto('1-apagado-390x844');
  await recoger('apagado');

  console.log('\n[3] La ruta pública solo dice sí o no');
  const marca = await ev("fetch('/api/marca-publica').then(async (r) => ({ status: r.status, cache: r.headers.get('cache-control'), json: await r.json() }))");
  ok(marca.status === 200 && marca.json.boton_testigos === false, 'GET /api/marca-publica (sin sesión): boton_testigos false', marca);
  ok(/app\.get\('\/api\/marca-publica'[^]*?res\.set\('Cache-Control', 'no-store'\)/.test(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')), 'y app.js la sirve sin caché (el cambio del interruptor se ve al instante)');
  ok(JSON.stringify(Object.keys(marca.json).sort()) === JSON.stringify(['boton_testigos', 'logo_url', 'subtitulo', 'titulo']), 'y no trae nada más que lo que ya traía la marca (logo, nombre, eslogan)', Object.keys(marca.json));
  await q('DELETE FROM complementos_campana WHERE clave = ?', [CLAVE]); C.invalidar();
  const sinFila = await ev("fetch('/api/marca-publica').then((r) => r.json())");
  ok(sinFila.boton_testigos === false, 'sin la fila en la base (init-db sin correr) cuenta como apagado');
  await q('INSERT IGNORE INTO complementos_campana (clave, activo) VALUES (?, 0)', [CLAVE]); C.invalidar();

  console.log('\n[4] Quién puede cambiarlo');
  const entrar = async (ruta, cuerpo) => { await cmd('Network.clearBrowserCookies'); await ir(base + '/login.html'); return ev(`fetch('/api/auth/${ruta}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(cuerpo))} }).then((r) => r.status)`); };
  const poner = (activo) => ev(`fetch('/api/complementos/${CLAVE}', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo: ${activo} }) }).then((r) => r.status)`);
  ok(await poner(true) === 401, 'sin sesión: 401 (no se puede encender)');
  ok(await entrar('login-coordinador', { cedula: '1023456789', clave: '456789' }) === 200 && await poner(true) === 403, 'un COORDINADOR no puede encenderlo (403)');
  ok(await entrar('login', { email: '1055000001', password: '1055000001' }) === 200 && await poner(true) === 403, 'un LÍDER no puede encenderlo (403)');
  ok((await q('SELECT activo FROM complementos_campana WHERE clave = ?', [CLAVE]))[0].activo === 0, 'y sigue apagado en la base');
  ok(await entrar('login', { email: 'admin.ej@ejemplo.co', password: CLAVE_ADMIN }) === 200, 'el administrador (no superadministrador) entra');
  const lista = await ev("fetch('/api/complementos').then(async (r) => ({ s: r.status, j: await r.json() }))");
  const mia = lista.j.complementos && lista.j.complementos.find((c) => c.clave === CLAVE);
  ok(lista.s === 200 && lista.j.complementos.length === 11 && mia && mia.activo === false && mia.efectivo === false, 'GET /api/complementos lo lista (once), apagado', mia);

  console.log('\n[5] Encender en Configuración → Activar complementos (como administrador)');
  await escritorio();
  await ir(base + '/configuracion.html#complementos');       // la pestaña se abre por el ancla, como desde el menú lateral
  ok(await esperar("document.getElementById('seccion-complementos') && getComputedStyle(document.getElementById('seccion-complementos')).display !== 'none'"), 'abre Configuración → «Activar complementos»');
  ok(await esperar(`document.querySelector('[data-complemento="${CLAVE}"]')`), 'aparece el complemento nuevo en la lista');
  const tarjeta = await ev(`(() => { const c = document.querySelector('.comp-card[data-clave="${CLAVE}"]'); return { nombre: c.querySelector('strong').innerText, ayuda: c.querySelector('.comp-desc').innerText, estado: c.querySelector('.comp-estado').innerText, marcado: c.querySelector('input').checked, ultimo: document.querySelector('#complementos-lista .comp-card:last-child').getAttribute('data-clave') }; })()`);
  ok(tarjeta.nombre === def.nombre && tarjeta.ayuda === def.descripcion && tarjeta.estado === 'Apagado' && tarjeta.marcado === false, 'con su nombre, su línea de ayuda y «Apagado»', tarjeta);
  await foto('2-configuracion-apagado-1280', 1280);
  await ev(`document.querySelector('[data-complemento="${CLAVE}"]').click()`);
  ok(await esperar(`document.querySelector('.comp-card[data-clave="${CLAVE}"] .comp-estado').innerText === 'Encendido'`), 'el interruptor pasa a «Encendido»');
  ok((await ev("document.getElementById('complementos-ok').innerText")) === 'El botón «Acceso a Testigos Electorales» ya se ve en la pantalla de ingreso del celular.', 'y avisa lo que pasó', await ev("document.getElementById('complementos-ok').innerText"));
  const guardado = (await q('SELECT activo, actualizado_por FROM complementos_campana WHERE clave = ?', [CLAVE]))[0];
  ok(Number(guardado.activo) === 1 && guardado.actualizado_por === ids.admin, 'guardado en complementos_campana (activo = 1, por el administrador)', guardado);
  ok((await q("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'complemento_encender'"))[0].n >= 1, 'quedó en la bitácora de auditoría');
  await foto('3-configuracion-encendido-1280', 1280);
  await recoger('configuracion');

  console.log('\n[6] ENCENDIDO: el botón vuelve a su lugar');
  ok(await abrirIngreso(), 'abre «¿Cómo va a ingresar?»');
  const b1 = await botones();
  ok(JSON.stringify(b1) === JSON.stringify(CON), 'cinco botones, con el orden de la Orden 64: Líderes, Aspirantes, Coordinadores, Testigos, Otros', b1);
  ok((await ayuda()) === AYUDA_CON, 'la ayuda de abajo es la de hoy (con testigos)', await ayuda());
  ok(await sinDesborde(), 'sin desborde horizontal');
  await foto('4-encendido-390x844');
  await ev("document.getElementById('ir-a-testigos-desde-eleccion').click()");
  ok(await esperar("getComputedStyle(document.getElementById('form-coordinador')).display !== 'none'") && (await ev("document.getElementById('login-titulo').innerText")) === 'Ingreso de testigos', 'el botón funciona: abre «Ingreso de testigos»');
  await recoger('encendido');

  console.log('\n[7] Apagarlo otra vez en Configuración: desaparece');
  await entrar('login', { email: 'admin.ej@ejemplo.co', password: CLAVE_ADMIN });
  await escritorio();
  await ir(base + '/configuracion.html#complementos');
  await esperar(`document.querySelector('[data-complemento="${CLAVE}"]')`);
  await ev(`document.querySelector('[data-complemento="${CLAVE}"]').click()`);
  ok(await esperar("document.getElementById('si-confirmar-modal')"), 'al apagar pregunta antes («¿Apagar…?»)');
  const aviso = await ev("document.querySelector('.overlay .modal p').innerText");
  ok(/dejará de verse en la pantalla de ingreso del celular/.test(aviso) && !/trabajando sin señal/.test(aviso), 'con un aviso propio de este interruptor (no el de «trabajo sin señal»)', aviso);
  await ev("document.getElementById('si-confirmar-modal').click()");
  ok(await esperar(`document.querySelector('.comp-card[data-clave="${CLAVE}"] .comp-estado').innerText === 'Apagado'`), 'queda «Apagado»');
  await recoger('apagar');
  ok(await abrirIngreso(), 'abre «¿Cómo va a ingresar?»');
  ok(JSON.stringify(await botones()) === JSON.stringify(SIN) && (await ayuda()) === AYUDA_SIN, 'otra vez cuatro botones y la ayuda sin testigos', await botones());

  console.log('\n[8] Sin señal y mientras carga: el botón queda oculto');
  const html = await (await fetch(base + '/login.html')).text();
  ok(/id="ir-a-testigos-desde-eleccion" style="display:none;"/.test(html), 'en el HTML el botón nace oculto (mientras carga no se ve)');
  await q('UPDATE complementos_campana SET activo = 1 WHERE clave = ?', [CLAVE]); C.invalidar();     // encendido en el servidor…
  await cmd('Network.clearBrowserCookies');
  await movil();
  await cmd('Network.setBlockedURLs', { urls: ['*/api/*'] });           // …pero sin señal: la lectura falla
  await ir(base + '/login.html');
  ok(await esperar("document.getElementById('form-elegir-acceso') && document.getElementById('form-elegir-acceso').style.display === 'block'"), 'sin señal abre «¿Cómo va a ingresar?»');
  await espera(900);
  ok(JSON.stringify(await botones()) === JSON.stringify(SIN) && (await ayuda()) === AYUDA_SIN, 'sin señal: oculto (aunque en el servidor esté encendido) y la ayuda sin testigos', await botones());
  await foto('5-sin-senal-390x844');
  await recoger('sin-senal');
  await cmd('Network.setBlockedURLs', { urls: [] });
  await apagar();

  console.log('\n[9] ¿Puede entrar hoy un testigo por otro botón? (con el interruptor APAGADO)');
  ok(await abrirIngreso() && JSON.stringify(await botones()) === JSON.stringify(SIN), 'interruptor apagado, sin botón de testigos');
  await ev("document.getElementById('ir-a-lideres-desde-eleccion').click()");
  await esperar("getComputedStyle(document.getElementById('form-coordinador')).display !== 'none'");
  await ev(`(() => { const e = (s, v) => { const x = document.querySelector(s); x.focus(); x.value = v; x.dispatchEvent(new Event('input', { bubbles: true })); }; e('#campo-cedula-coord', '1077000001'); e('#campo-clave-coord', '000001'); document.querySelector('#form-coordinador button[type=submit]').click(); })()`);
  const llego = await esperar("location.pathname === '/app/dia-d.html'", 10000);
  ok(llego, 'un testigo entra por el botón de «Líderes y Sublíderes» (mismo formulario) y llega a su pantalla del Día D: NO se bloquea', await ev('location.pathname'));
  await recoger('testigo');

  console.log('\n[10] La consola');
  ok(p.avisos.length === 0, 'ninguna excepción de JavaScript', p.avisos);
  ok(errores.length === 0, 'ningún console.error ni error de página', errores.slice(0, 5));

  nav.cerrar(); s.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO BIEN'} (${pasos} comprobaciones). Capturas en ${SALIDA}`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
