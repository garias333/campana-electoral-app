#!/usr/bin/env node
// scripts/probar-coordinador-agregar-lider.js — ORDEN 83: el coordinador del celular agrega LÍDERES a su estructura.
//
// SERVIDOR (HTTP, sesión real por «Acceso a Coordinadores»): lecturas del formulario abiertas, POST de estructura que solo deja crear Líder y fuerza «Reporta a»,
// PUT/DELETE/asignar testigo/importar/eliminar/territorios en 403, y que el coordinador que entra por el COMPUTADOR (correo) conserva lo de siempre.
// NAVEGADOR (Chromium real, 390×844, CDP): ingreso por el botón, menú con «Agregar líder», formulario con Categoría y «Reporta a» fijos, guardado, «Mis líderes».
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada83 [SALIDA=/ruta/capturas] node scripts/probar-coordinador-agregar-lider.js
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

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
const express = require('express');
const session = require('express-session');
const pool = require('../config/db');
const { sembrar, CLAVE_CORREO } = require('./fixtures/coordinadores-celular');
const { sincronizarClaveCelular } = require('../lib/claveCelular');
const { lanzar, espera } = require('./capturas/navegador');

const RAIZ = path.join(__dirname, '..');
const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden83');
fs.mkdirSync(SALIDA, { recursive: true });

let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];

function crearApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(session({ secret: 'secreto-de-prueba', resave: false, saveUninitialized: true, cookie: { httpOnly: true } }));
  app.get('/api/csrf-token', (req, res) => res.json({ csrfToken: 'ejemplo' }));
  app.get('/api/marca-publica', (req, res) => res.json({ titulo: 'Campaña de ejemplo', subtitulo: '', logo_url: '', boton_testigos: false }));
  const { cargarSublicencia, restringirAspirante } = require(path.join(RAIZ, 'middleware/aspirante'));
  app.use('/api', cargarSublicencia, restringirAspirante);
  app.use('/api', require(path.join(RAIZ, 'middleware/soloLecturaCandidato')).soloLecturaCandidato);   // como app.js
  const montar = (ruta, archivo) => app.use(ruta, require(path.join(RAIZ, 'routes', archivo)));
  ['auth', 'usuarios', 'territorial', 'votantes', 'dashboard', 'configuracion', 'permisos', 'complementos', 'contenido', 'push', 'geo', 'coordinador', 'catalogo', 'panel-lider:panelLider']
    .forEach((x) => { const [r, f] = x.split(':'); montar('/api/' + r, (f || r) + '.routes'); });
  montar('/api/dia-d', 'diaD.routes');
  app.use('/api', (req, res) => res.status(404).json({ error: 'sin ruta en el servidor de pruebas' }));
  app.use(express.static(path.join(RAIZ, 'public'), { etag: false, lastModified: false, setHeaders: (r) => r.setHeader('Cache-Control', 'no-store') }));
  return app;
}

let base = '';
function cliente() {
  let cookie = '';
  const pedir = async (metodo, ruta, cuerpo) => {
    const h = { 'Content-Type': 'application/json' };
    if (cookie) h.Cookie = cookie;
    const r = await fetch(base + '/api' + ruta, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), redirect: 'manual' });
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const texto = await r.text(); let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
    return { status: r.status, datos, texto };
  };
  return { get: (r) => pedir('GET', r), post: (r, b) => pedir('POST', r, b || {}), put: (r, b) => pedir('PUT', r, b || {}), del: (r, b) => pedir('DELETE', r, b || {}) };
}

(async () => {
  const servidor = http.createServer(crearApp());
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const { ids } = await sembrar(pool);
  await sincronizarClaveCelular(pool, ids.coord1);
  await sincronizarClaveCelular(pool, ids.coord2);
  const [[mun]] = await pool.query("SELECT id FROM territorios WHERE tipo = 'municipio' LIMIT 1");
  const [[bar]] = await pool.query("SELECT id FROM territorios WHERE tipo = 'barrio' ORDER BY id LIMIT 1");
  const [[perm0]] = await pool.query("SELECT permitido, editar, agregar, importar_exportar FROM permisos_rol WHERE rol = 'coordinador' AND modulo = 'territorial'");
  console.log('permisos del coordinador en Estructura territorial (ahora):', JSON.stringify(perm0));
  const contar = async (cedula) => (await q('SELECT COUNT(*) n FROM usuarios WHERE numero_identificacion = ?', [cedula]))[0].n;
  const cuerpoLider = (extra = {}) => ({ nombre: 'Lina Líder Nueva', cargo: 'lider', numero_identificacion: '1099000001', telefono: '3001230001', area: 'urbano', territorio_id: bar.id, territorio_ids: [bar.id], ...extra });

  console.log('\n[1] El coordinador entra por el botón del celular');
  const cel = cliente();
  let r = await cel.post('/auth/login-coordinador', { cedula: '1023456789', clave: '456789' });
  ok(r.status === 200, 'cédula 1023456789 + clave 456789 → entra', r);
  r = await cel.get('/auth/me');
  ok(r.status === 200 && r.datos.usuario.rol === 'coordinador' && r.datos.usuario.puerta_celular === true, '/auth/me dice que la sesión es la del celular (puerta_celular) y su rol', r.datos && r.datos.usuario);

  console.log('\n[2] Lo que lee el formulario está abierto (nada de 403)');
  const lecturas = [
    ['GET', '/catalogo/departamentos'], ['GET', '/catalogo/municipios?departamento=1'], ['GET', '/catalogo/puestos?municipio=1'],
    ['GET', '/dia-d/puestos-para-reporte'], ['GET', '/dia-d/mesas-ocupadas?puesto=Puesto%20X'],
    ['GET', '/territorial/territorios'], ['GET', '/territorial/territorios/modo'], ['GET', `/territorial/coordinadores-por-zona/${bar.id}`],
    ['GET', `/territorial/lideres-para-sublider/${bar.id}`], ['GET', '/territorial/coordinador-organizaciones'], ['GET', '/territorial/estructura/verificar-identificacion?numero=1099000009'],
    ['GET', '/territorial/estructura'], ['GET', '/usuarios'], ['GET', '/configuracion/campana'],
  ];
  for (const [m, ruta] of lecturas) {
    const x = await cel.get(ruta);
    ok(x.status !== 403 && x.status !== 401, `${m} /api${ruta} no responde 403 (responde ${x.status})`, x.texto.slice(0, 200));
  }
  r = await cel.post('/geo/inverso', { lat: 'x', lon: 'y' });
  ok(r.status === 400, 'POST /geo/inverso llega al servicio (coordenadas inválidas → 400, no 403)', r);

  console.log('\n[3] POST de estructura: solo Líder; cualquier otra categoría → 403 y no se crea nada');
  const otras = [
    ['Coordinador de territorio', { cargo: 'coordinador', numero_identificacion: '1099000011' }],
    ['Coordinador de organizaciones', { cargo: 'coordinador_organizaciones', numero_identificacion: '1099000012' }],
    ['Aspirante al Concejo', { cargo: 'lider', tipo_cargo: 'aspirante_concejo', numero_identificacion: '1099000013' }],
    ['Sublíder', { cargo: 'usuario', numero_identificacion: '1099000014', supervisor_id: ids.ana }],
    ['Testigo', { cargo: 'testigo', numero_identificacion: '1099000015' }],
  ];
  for (const [nombre, extra] of otras) {
    r = await cel.post('/territorial/estructura', cuerpoLider(extra));
    ok(r.status === 403 && /solo puede agregar líderes/i.test((r.datos || {}).error || ''), `${nombre} → 403 con mensaje claro`, r);
    ok(await contar(extra.numero_identificacion) === 0, `   y no se creó a nadie (${extra.numero_identificacion})`);
  }

  console.log('\n[4] Un líder sí: el servidor FUERZA «Reporta a» = el coordinador');
  r = await cel.post('/territorial/estructura', cuerpoLider({ supervisor_id: ids.coord2 }));   // intenta colgarlo de OTRO coordinador
  ok(r.status === 200 && r.datos.ok, 'crear un líder → 200', r);
  const [[e1]] = await pool.query(`SELECT e.cargo, e.supervisor_id, e.territorio_id, u.rol_id, ro.nombre rol, u.clave_celular_hash, u.clave_celular_es_defecto, u.numero_identificacion, u.nombre_usuario
                                    FROM estructura e JOIN usuarios u ON u.id = e.usuario_id JOIN roles ro ON ro.id = u.rol_id WHERE u.numero_identificacion = '1099000001'`);
  ok(e1 && e1.cargo === 'lider' && e1.rol === 'lider', 'quedó como Líder (cargo y rol)', e1);
  ok(e1 && e1.supervisor_id === ids.coord1, 'pidió reportar a OTRO coordinador (Pedro) → se FORZÓ a Marta, la que lo creó', { supervisor: e1 && e1.supervisor_id, marta: ids.coord1, pedro: ids.coord2 });
  ok(e1 && e1.territorio_id === bar.id, 'con el territorio que escogió', e1);
  ok(e1 && !!e1.clave_celular_hash && Number(e1.clave_celular_es_defecto) === 1, 'y con cédula: se le generó la clave del celular (últimos 6 de la cédula)', e1);
  const claveHash = require('bcryptjs');
  ok(e1 && claveHash.compareSync('000001', e1.clave_celular_hash), '   la clave es 000001 (los últimos 6 de 1099000001)');
  r = await cel.post('/territorial/estructura', cuerpoLider({ numero_identificacion: '1099000002', nombre: 'Luis Líder Sin Jefe', supervisor_id: '' }));
  const [[e2]] = await pool.query("SELECT e.supervisor_id FROM estructura e JOIN usuarios u ON u.id = e.usuario_id WHERE u.numero_identificacion = '1099000002'");
  ok(r.status === 200 && e2 && e2.supervisor_id === ids.coord1, 'sin «Reporta a» en la petición: también cuelga de él', { st: r.status, e2 });
  r = await cel.post('/territorial/estructura', cuerpoLider({ numero_identificacion: '1099000003', nombre: 'Lola Líder Sin Cédula Propia', supervisor_id: ids.eva }));   // «un líder que reporte a otro (Eva, que es líder)»
  const [[e3]] = await pool.query("SELECT e.supervisor_id FROM estructura e JOIN usuarios u ON u.id = e.usuario_id WHERE u.numero_identificacion = '1099000003'");
  ok(r.status === 200 && e3 && e3.supervisor_id === ids.coord1, 'pedir que reporte a un líder (Eva) → también forzado al coordinador', e3);
  r = await cel.post('/territorial/estructura', cuerpoLider({ numero_identificacion: '1099000001' }));
  ok(r.status === 400, 'una cédula repetida sigue respondiendo el error de siempre (400)', r);

  console.log('\n[5] Editar, borrar, asignar testigo, importar y eliminar: 403 desde el celular');
  const [[ficha]] = await pool.query("SELECT e.id FROM estructura e JOIN usuarios u ON u.id = e.usuario_id WHERE u.numero_identificacion = '1099000001'");
  const antes = (await q('SELECT nombre, telefono FROM usuarios WHERE numero_identificacion = ?', ['1099000001']))[0];
  const escrituras = [
    ['PUT', `/territorial/estructura/${ficha.id}`, cuerpoLider({ nombre: 'Cambiado', password: CLAVE_CORREO })],
    ['DELETE', `/territorial/estructura/${ficha.id}`, { password: CLAVE_CORREO }],
    ['POST', `/territorial/estructura/${ficha.id}/asignar-testigo`, { puesto_votacion: 'X', mesa_votacion: 1 }],
    ['POST', '/territorial/estructura/eliminar-masivo', { tipo: 'lider', password: CLAVE_CORREO }],
    ['POST', '/territorial/estructura/importar-excel', {}],
    ['POST', '/territorial/testigos/importar-excel', {}],
    ['POST', '/territorial/territorios', { nombre: 'Barrio Nuevo', tipo: 'barrio', padre_id: mun.id }],
    ['PUT', `/territorial/territorios/${bar.id}`, { nombre: 'Barrio Renombrado' }],
    ['POST', '/territorial/territorios/crear-zona', { nombre: 'Zona', tipo: 'barrio', padre_id: mun.id }],
  ];
  for (const [m, ruta, cuerpo] of escrituras) {
    const x = await (m === 'PUT' ? cel.put(ruta, cuerpo) : m === 'DELETE' ? cel.del(ruta, cuerpo) : cel.post(ruta, cuerpo));
    ok(x.status === 403, `${m} /api${ruta} → 403`, { status: x.status, texto: x.texto.slice(0, 160) });
  }
  const despues = (await q('SELECT nombre, telefono FROM usuarios WHERE numero_identificacion = ?', ['1099000001']))[0];
  ok(despues && despues.nombre === antes.nombre && despues.telefono === antes.telefono && await contar('1099000001') === 1, 'la ficha quedó exactamente como estaba');
  ok((await q('SELECT nombre FROM territorios WHERE id = ?', [bar.id]))[0].nombre !== 'Barrio Renombrado', 'ningún territorio se renombró');

  console.log('\n[6] El coordinador que entra por el COMPUTADOR (correo y contraseña) conserva lo de siempre');
  const pc = cliente();
  r = await pc.post('/auth/login', { email: 'marta@ejemplo.co', password: CLAVE_CORREO });
  ok(r.status === 200, 'entra por el computador', r.texto.slice(0, 200));
  r = await pc.get('/auth/me');
  ok(r.datos.usuario.puerta_celular === false, 'su sesión NO es la del celular (puerta_celular = false)', r.datos.usuario);
  r = await pc.post('/territorial/estructura', cuerpoLider({ cargo: 'coordinador', numero_identificacion: '1099000021', nombre: 'Coordinador Por Computador' }));
  ok(r.status === 200, 'puede crear un coordinador (como hoy)', r);
  r = await pc.put(`/territorial/estructura/${ficha.id}`, cuerpoLider({ nombre: 'Lina Editada En Computador', password: CLAVE_CORREO }));
  ok(r.status === 200, 'puede editar una ficha de su rama (como hoy)', r);
  r = await pc.del(`/territorial/estructura/${(await q('SELECT e.id FROM estructura e JOIN usuarios u ON u.id = e.usuario_id WHERE u.numero_identificacion = ?', ['1099000021']))[0].id}`, { password: CLAVE_CORREO });
  ok(r.status === 200, 'puede borrar a alguien (como hoy)', r);

  console.log('\n[7] Matriz de permisos');
  const [[perm1]] = await pool.query("SELECT permitido, editar, agregar, importar_exportar FROM permisos_rol WHERE rol = 'coordinador' AND modulo = 'territorial'");
  ok(perm1.permitido === 1 && perm1.agregar === 1, 'Coordinador en Estructura territorial: Ver = 1 y Agregar = 1', perm1);
  console.log('    antes:', JSON.stringify(perm0), '· después:', JSON.stringify(perm1));

  /* ============================ NAVEGADOR ============================ */
  console.log('\n[8] En el celular (Chromium 390×844)');
  // Marta empieza de cero en esta parte: se borran los líderes que creó la parte HTTP, para ver el formulario y la lista sin mezclar.
  await q("DELETE e FROM estructura e JOIN usuarios u ON u.id = e.usuario_id WHERE u.numero_identificacion LIKE '10990000%'");
  await q("DELETE FROM usuarios WHERE numero_identificacion LIKE '10990000%'");
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: true });
  const ir = async (url) => { await cmd('Page.navigate', { url }); await espera(900); };
  const esperar = async (expr, ms = 8000) => {
    const hasta = Date.now() + ms;
    while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* aún cargando */ } await espera(150); }
    return false;
  };
  const foto = async (nombre) => { const x = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(x.result.data, 'base64')); };
  const sinDesborde = () => ev('document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1');
  const escribir = (sel, valor) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value = ${JSON.stringify(valor)}; e.dispatchEvent(new Event('input', { bubbles: true })); return e.value; })()`);
  const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const texto = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ''`);
  const ruta = () => ev('location.pathname + location.search + location.hash');

  await ir(base + '/login.html');
  await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
  await click('#ir-a-coordinadores-desde-eleccion');
  await esperar("getComputedStyle(document.getElementById('form-coordinador')).display !== 'none'");
  await escribir('#campo-cedula-coord', '1023456789'); await escribir('#campo-clave-coord', '456789');
  await click('#form-coordinador button[type=submit]');
  ok(await esperar("location.pathname === '/app/inicio.html'", 10000), 'entra por «Acceso a Coordinadores» y cae en su inicio', await ruta());
  await esperar("document.querySelectorAll('#menu-app .menu-boton').length > 0", 10000); await espera(600);
  const menu = await ev(`({ grupos: [...document.querySelectorAll('#menu-app .menu-grupo')].map(g => ({ t: g.querySelector('.menu-grupo-titulo').innerText, items: [...g.querySelectorAll('.menu-boton strong')].map(e => e.innerText) })),
    href: (document.querySelector('#menu-app a[href*="territorial.html"]') || {}).getAttribute ? document.querySelector('#menu-app a[href*="territorial.html"]').getAttribute('href') : null })`);
  console.log('    menú:', JSON.stringify(menu.grupos));
  const reg = menu.grupos.find((g) => /^registro$/i.test(g.t));
  ok(!!reg && reg.items.length === 1 && reg.items[0] === 'Agregar líder', 'el grupo «Registro» vuelve con UN solo botón: «Agregar líder»', menu.grupos);
  ok(menu.grupos[0].items[0] === 'Mis líderes', '«Mis líderes» sigue primero del menú', menu.grupos[0]);
  const todos = menu.grupos.flatMap((g) => g.items);
  ok(!['Registro de votantes y sublíderes', 'Mi enlace de inscripción', 'Consultar puesto de votación', 'Panel completo', 'Registro de votantes'].some((x) => todos.includes(x)), 'sin «Registro de votantes», «Mi enlace» ni otros del grupo anterior (Consultar puesto de votación no estaba en su menú: sigue sin estar)', todos);
  ok(menu.href === '/territorial.html?app=1&volver=/app/mis-lideres.html#nuevo', 'el botón abre el formulario de siempre en modo app y vuelve a Mis líderes', menu.href);
  ok(await sinDesborde(), 'sin desborde horizontal');
  await ev('window.scrollTo(0, 420)'); await espera(300);
  await foto('1-menu-con-agregar-lider-390x844');
  await ev('window.scrollTo(0, 0)');

  p.avisos.length = 0; p.respuestas.length = 0;
  await click('#menu-app a[href*="territorial.html"]');
  ok(await esperar("location.pathname === '/territorial.html'", 12000), 'tocar «Agregar líder» abre territorial.html', await ruta());
  await esperar("document.getElementById('overlay-form') && document.getElementById('overlay-form').classList.contains('abierto') && document.querySelector('.wz-paso')", 15000); await espera(2000);
  const fm = await ev(`({ modoApp: document.documentElement.classList.contains('modo-app'), coord: document.body.classList.contains('coord-celular'), pasos: document.querySelectorAll('.wz-paso').length,
    titulo: document.getElementById('modal-form-titulo').innerText, listaVisible: getComputedStyle(document.querySelector('main.main')).display !== 'none',
    chips: [...document.querySelectorAll('#chips-cargo-persona label')].map(l => ({ t: l.innerText.trim(), v: l.offsetParent !== null })),
    categoria: (document.getElementById('categoria-fija-coord') || {}).innerText, cargoValor: document.getElementById('select-cargo-persona').value, tipo: document.getElementById('select-tipo-cargo-persona').value,
    reporta: (document.getElementById('reporta-fijo-coord') || {}).innerText, selectVisible: getComputedStyle(document.getElementById('select-supervisor')).display !== 'none',
    abierto: document.getElementById('overlay-form').classList.contains('abierto') })`);
  console.log('    formulario:', JSON.stringify(fm));
  ok(fm.modoApp && fm.coord && fm.abierto && fm.pasos >= 4, 'se abre solo (#nuevo), en modo app, por pasos', fm);
  ok(!fm.listaVisible, 'no se ve la lista de la estructura detrás (solo se agrega)', fm);
  ok(fm.chips.every((c) => !c.v) && /Categoría:\s*Líder/.test(fm.categoria || '') && fm.cargoValor === 'lider', 'las cinco categorías NO aparecen: se lee «Categoría: Líder»', fm);
  ok(/^Reporta a: Marta Coordinadora Ejemplo$/.test((fm.reporta || '').trim()) && !fm.selectVisible, '«Reporta a: Marta Coordinadora Ejemplo», fijo y sin desplegable', fm);
  ok(p.avisos.length === 0, 'sin errores de consola', p.avisos);
  const malos = p.respuestas.filter((x) => x.status === 403 || x.status === 500).map((x) => x.status + ' ' + x.url.replace(base, ''));
  ok(malos.length === 0, 'el formulario carga sin ningún 403/500 de la API', malos);
  ok(await sinDesborde(), 'sin desborde horizontal');
  await foto('2-formulario-paso1-categoria-fija-390x844');

  // Llenar de verdad con la pantalla
  await ev(`(() => { const f = document.getElementById('form-estructura'); const poner = (s, v) => { const e = f.querySelector(s); if (!e) return; e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    poner('[name=numero_identificacion]', '1099000031'); poner('[name=nombre]', 'Laura Líder Pantalla'); poner('[name=telefono]', '3001230031'); poner('[name=area]', 'urbano'); poner('#input-barrio-persona', 'Barrio Los Ejemplos'); })()`);
  const irAlUltimo = async () => {
    for (let i = 0; i < 4; i++) {
      await ev(`(() => { const f = document.getElementById('form-estructura'); f.querySelectorAll('select').forEach((s) => { if (!s.value && s.offsetParent !== null && s.options.length > 1) { s.value = [...s.options].find((o) => o.value)?.value || ''; s.dispatchEvent(new Event('change', { bubbles: true })); } }); })()`);
      await espera(500);
      if (i === 2) await foto('3-formulario-paso4-territorio-390x844');
      await ev("(document.querySelector('.wz-sig') || { click() {} }).click()"); await espera(400);
    }
  };
  await irAlUltimo();
  const ult = await ev(`({ paso: document.getElementById('wz-num').innerText, reporta: (document.getElementById('reporta-fijo-coord') || {}).innerText, visible: !!document.getElementById('reporta-fijo-coord') && document.getElementById('reporta-fijo-coord').offsetParent !== null })`);
  console.log('    último paso:', JSON.stringify(ult));
  ok(ult.visible && /Reporta a: Marta/.test(ult.reporta), 'en el último paso se ve «Reporta a: Marta…»', ult);
  await foto('4-formulario-ultimo-paso-390x844');
  await ev("(document.getElementById('btn-guardar-estructura') || document.querySelector('.wz-pie button[type=submit]')).click()"); await espera(3500);
  const exito = await ev("({ visible: !!document.querySelector('.wz-exito.visible'), titulo: (document.querySelector('.wz-exito h2') || {}).innerText, boton: (document.querySelector('.wz-exito .wz-lista') || {}).innerText, error: (document.getElementById('form-error') || {}).innerText })");
  console.log('    guardado:', JSON.stringify(exito));
  let [[creado]] = await pool.query("SELECT e.supervisor_id, e.cargo FROM estructura e JOIN usuarios u ON u.id = e.usuario_id WHERE u.numero_identificacion = '1099000031'");
  ok(!!creado && creado.cargo === 'lider' && creado.supervisor_id === ids.coord1, 'el formulario por pasos guardó a Laura como Líder de Marta', { creado, exito });
  ok(exito.visible && exito.titulo === 'Guardado' && /Mis líderes/.test(exito.boton || ''), 'dice «Guardado» y ofrece «Volver a Mis líderes»', exito);
  await foto('5-guardado-390x844');

  await click('.wz-exito .wz-lista');
  ok(await esperar("location.pathname === '/app/mis-lideres.html'", 10000), 'vuelve a «Mis líderes»', await ruta());
  await esperar("document.querySelectorAll('.lider-item').length > 0", 10000); await espera(500);
  const lista = await ev("[...document.querySelectorAll('.lider-item .nombre')].map(e => e.innerText)");
  ok(lista.some((n) => /Laura Líder Pantalla/.test(n)), 'y Laura aparece en Mis líderes', lista);
  await foto('6-mis-lideres-con-el-nuevo-390x844');
  await ir(base + '/app/inicio.html'); await esperar("!document.getElementById('panel-coordinador').hidden", 10000); await espera(600);
  const tiles = await ev("[...document.querySelectorAll('#panel-coordinador .pc-k')].map(t => t.innerText.replace(/\\n/g, ' · '))");
  ok(/^5 · Líderes activos/i.test(tiles[0] || ''), 'en «Mi equipo» los líderes activos pasaron de 4 a 5', tiles);

  // La × devuelve a Mis líderes (no deja ver la lista de la estructura)
  await ir(base + '/territorial.html?app=1&volver=/app/mis-lideres.html#nuevo');
  await esperar("document.getElementById('overlay-form').classList.contains('abierto')", 12000); await espera(1500);
  await click('#cerrar-modal');
  ok(await esperar("location.pathname === '/app/mis-lideres.html'", 8000), 'la × del formulario también vuelve a Mis líderes', await ruta());
  // Sin ?app=1 (o sin #nuevo) tampoco se ve la lista: se le lleva al formulario en modo app
  await ir(base + '/territorial.html');
  ok(await esperar("location.search.includes('app=1') && location.hash === '#nuevo'", 8000), 'abrir territorial.html a secas lo lleva al formulario en modo app', await ruta());

  // Marta por el computador (correo) ve su pantalla de siempre: probado arriba por HTTP; aquí, que la sesión del celular de OTRA persona (líder) no cambia
  nav.cerrar();
  servidor.close();
  console.log(`\n${pasos - fallos}/${pasos} comprobaciones correctas.`);
  console.log(fallos ? `HAY ${fallos} FALLO(S).` : 'TODO BIEN.');
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch(async (e) => { console.error(e); try { await pool.end(); } catch (_) { /* nada */ } process.exit(1); });
