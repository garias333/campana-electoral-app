#!/usr/bin/env node
// scripts/probar-candidato.js — orden 70/71: la app del CANDIDATO PRINCIPAL (solo lectura).
//
// Prueba el servidor (solo lectura en el servidor, finanzas, cédulas, módulos apagados, ritmo) y la app EN CHROMIUM REAL (CDP, 390×844 y 1280):
// ingreso por «Otros usuarios», las cinco pantallas + ficha + «Cambiar mi clave», con datos y con la campaña VACÍA, sin errores de consola ni desborde.
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada70datos [SALIDA=/ruta] node scripts/probar-candidato.js
// MODO: si DB_NAME contiene «vacia», no se siembra nada (campaña sin registros); si no, se siembran los datos de ejemplo. Se niega a correr si
// DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) { console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`); process.exit(2); }
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';
const VACIA = /vacia/i.test(nombreBase);

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { sembrar } = require('./fixtures/coordinadores-celular');
const { lanzar, espera } = require('./capturas/navegador');

const RAIZ = path.join(__dirname, '..');
const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden71');
fs.mkdirSync(SALIDA, { recursive: true });
const CLAVE = 'ClaveCandidato-ej1';
const CORREO = 'candidato.prueba@ejemplo.co';

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
  ['auth', 'usuarios', 'territorial', 'votantes', 'votantes-dashboard:votantesDashboard', 'finanzas', 'eventos', 'recursos', 'legislacion', 'dashboard', 'configuracion',
    'permisos', 'complementos', 'contenido', 'push', 'geo', 'panel-lider:panelLider', 'coordinador', 'catalogo', 'solicitudes', 'tareas', 'puerta-a-puerta:puertaAPuerta', 'candidato']
    .forEach((x) => { const [r, f] = x.split(':'); montar('/api/' + r, (f || r) + '.routes'); });
  montar('/api/dia-d/rescate', 'rescateVotos.routes');
  montar('/api/dia-d', 'diaD.routes');
  app.use('/api', (req, res) => res.status(404).json({ error: 'sin ruta en el servidor de pruebas' }));
  app.use(express.static(path.join(RAIZ, 'public'), { etag: false, lastModified: false, setHeaders: (r) => r.setHeader('Cache-Control', 'no-store') }));
  return app;
}

/** Un cliente HTTP con su propia cookie de sesión. */
function cliente(base) {
  const jar = new Map();
  const pedir = async (metodo, ruta, cuerpo) => {
    const r = await fetch(base + '/api' + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', ...(jar.size ? { Cookie: [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ') } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    r.headers.getSetCookie().forEach((c) => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); });
    let datos = null; const texto = await r.text(); try { datos = JSON.parse(texto); } catch (_) { datos = texto; }
    return { status: r.status, datos, texto };
  };
  return { get: (r) => pedir('GET', r), post: (r, b) => pedir('POST', r, b || {}), put: (r, b) => pedir('PUT', r, b || {}), patch: (r, b) => pedir('PATCH', r, b || {}), del: (r) => pedir('DELETE', r),
    entrar: async (email, password) => { const x = await pedir('POST', '/auth/login', { email, password }); if (x.status !== 200) console.log('    (ingreso de ' + email + ' respondió ' + x.status + ': ' + String(x.texto).slice(0, 160) + ')'); return x; } };
}

async function sembrarCandidato() {
  const rol = async (n) => (await q('SELECT id FROM roles WHERE nombre = ?', [n]))[0].id;
  await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
  await q(`UPDATE configuracion_campana SET nombre_candidato = 'Juan Pérez', slogan_campana = 'Juntos por la Ciudad', meta_votos_campana = ${VACIA ? 'NULL' : 60},
           fecha_eleccion = DATE_ADD(CURDATE(), INTERVAL 112 DAY), fecha_inicio_campana = NULL, marca_titulo = 'Campaña de ejemplo' WHERE id = 1`);
  const hash = bcrypt.hashSync(CLAVE, 4);
  const [r] = await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, clave_celular_pregunta_hecha)
      VALUES ('Juan Pérez', '1099000001', 'candidato.prueba', ?, '3001230000', ?, ?, 1, 1)`, [CORREO, hash, await rol('candidato')]);
  if (VACIA) {   // campaña sin registros, pero con un barrio donde poder crear a alguien en la estructura
    const [m] = await pool.query("INSERT INTO territorios (tipo, nombre) VALUES ('municipio', 'Ciudad de ejemplo')");
    await pool.query("INSERT INTO territorios (tipo, nombre, padre_id) VALUES ('barrio', 'Barrio Los Ejemplos', ?)", [m.insertId]);
  }
  if (VACIA) await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, password_hash, rol_id, activo) VALUES ('Admin Ejemplo', '1000000001', '1000000001', 'admin.ej@ejemplo.co', ?, ?, 1)`, [bcrypt.hashSync('clave-admin-ej', 4), await rol('admin')]);
  await require('./fixtures/encender-complementos')(pool, ['solicitudes', 'tareas', 'puerta_a_puerta', 'puerta_panel']);
  return r.insertId;
}

async function sembrarDatos(ids) {
  const [[mun]] = await pool.query("SELECT id FROM territorios WHERE tipo = 'municipio' LIMIT 1");
  const [c5] = await pool.query("INSERT INTO territorios (tipo, nombre, padre_id) VALUES ('comuna', 'Comuna 5 Universitaria', ?)", [mun.id]);
  const [c2] = await pool.query("INSERT INTO territorios (tipo, nombre, padre_id) VALUES ('comuna', 'Comuna 2 Centro', ?)", [mun.id]);
  await q("UPDATE territorios SET padre_id = ? WHERE nombre = 'Barrio Los Ejemplos'", [c5.insertId]);
  await q("UPDATE territorios SET padre_id = ? WHERE nombre = 'Barrio La Muestra'", [c2.insertId]);
  await q("UPDATE estructura SET territorio_id = ? WHERE usuario_id = ?", [c5.insertId, ids.coord1]);
  await q("UPDATE estructura SET territorio_id = ? WHERE usuario_id = ?", [c2.insertId, ids.coord2]);
  const [[b1]] = await pool.query("SELECT id FROM territorios WHERE nombre = 'Barrio Los Ejemplos'");
  const [[b2]] = await pool.query("SELECT id FROM territorios WHERE nombre = 'Barrio La Muestra'");
  const [pa] = await pool.query("INSERT INTO dia_d_puestos_votacion (nombre, cantidad_mesas) VALUES ('Puesto A Ejemplo', 10)");
  const [pb] = await pool.query("INSERT INTO dia_d_puestos_votacion (nombre, cantidad_mesas) VALUES ('Puesto B Ejemplo', 8)");
  await pool.query("INSERT INTO dia_d_puestos_votacion (nombre, cantidad_mesas) VALUES ('Puesto C Ejemplo', 6)");
  await q('UPDATE votantes SET territorio_id = ?, latitud = 5.0700000, longitud = -75.5200000 WHERE lider_id IN (?, ?)', [b1.id, ids.ana, ids.diego]);
  await q('UPDATE votantes SET territorio_id = ?, latitud = 5.0600000, longitud = -75.5000000 WHERE lider_id IN (?, ?)', [b2.id, ids.beto, ids.eva]);
  await q('UPDATE votantes SET puesto_id = ?, puesto_votacion = ? WHERE lider_id = ?', [pa.insertId, 'Puesto A Ejemplo', ids.ana]);
  // Un testigo activo en el puesto B → «puestos cubiertos» = 2 de 3 (A por votantes, B por testigo).
  const [t] = await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo, puesto_id) VALUES ('Testigo Ejemplo', '1099000009', '1099000009', ?, (SELECT id FROM roles WHERE nombre='testigo'), 1, ?)`, [bcrypt.hashSync('x', 4), pb.insertId]);
  await q("INSERT INTO estructura (usuario_id, cargo, activo, puesto_id) VALUES (?, 'testigo', 1, ?)", [t.insertId, pb.insertId]);
  // Eventos: dos próximos (con ubicación) y uno pasado con asistencia.
  const ev = async (titulo, dias, hora, lugar, lat, lng) => (await pool.query(
    `INSERT INTO eventos (titulo, tipo, fecha_inicio, lugar, latitud, longitud, responsable_id, meta_asistentes, estado, created_by)
     VALUES (?, 'reunion', DATE_ADD(DATE_ADD(CURDATE(), INTERVAL ? DAY), INTERVAL ? HOUR), ?, ?, ?, ?, 100, ?, ?)`, [titulo, dias, hora, lugar, lat, lng, ids.coord1, dias < 0 ? 'realizado' : 'programado', ids.admin]))[0].insertId;
  const e1 = await ev('Reunión comuna 5', 1, 18, 'Salón comunal Universitaria', 5.0705, -75.5210);
  await ev('Caminata barrio La Enea', 3, 8, 'Parque La Enea', 5.0610, -75.4990);
  const e3 = await ev('Encuentro con líderes', -3, 17, 'Sede de la campaña', null, null);
  for (let i = 0; i < 5; i++) await q('INSERT INTO evento_asistentes (evento_id, nombre_invitado, confirmado, asistio) VALUES (?, ?, 1, ?)', [e3, 'Invitado ' + i, i < 3 ? 1 : 0]);
  for (let i = 0; i < 4; i++) await q('INSERT INTO evento_asistentes (evento_id, nombre_invitado, confirmado, asistio) VALUES (?, ?, ?, 0)', [e1, 'Confirmado ' + i, i < 3 ? 1 : 0]);
}

async function escuchar(app) {
  const s = http.createServer(app);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { s, base: `http://127.0.0.1:${s.address().port}` };
}

const NOMBRES_TEXTO_MALO = /\bNaN\b|undefined|\[object Object\]|null%|Infinity/;

(async () => {
  let ids = {};
  if (!VACIA) ({ ids } = await sembrar(pool));
  const candidatoId = await sembrarCandidato();
  if (!VACIA) await sembrarDatos(ids);
  const app = await escuchar(crearApp());
  const base = app.base;
  console.log(`\n=== MODO ${VACIA ? 'CAMPAÑA VACÍA' : 'CON DATOS'} · ${base} ===`);

  /* ================= SERVIDOR ================= */
  console.log('\n[1] El servidor: ingreso, lecturas y solo lectura');
  const cand = cliente(base);
  const login = await cand.entrar(CORREO, CLAVE);
  ok(login.status === 200 && login.datos.usuario && login.datos.usuario.rol === 'candidato', 'el candidato entra con su correo y clave (rol «candidato», sin traducir)', login.datos);

  const rutas = ['/candidato/resumen', '/candidato/equipo', '/candidato/mapa', '/candidato/mas', '/candidato/mapbox-token'];
  const [[{ hdb }]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hdb");   // el día de la base (Colombia), no el del reloj del servidor de pruebas
  const d0 = (n) => { const x = new Date(hdb + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  rutas.push(`/candidato/agenda?desde=${d0(-7)}&hasta=${d0(7)}`, '/candidato/solicitudes', '/candidato/tareas', '/candidato/dia-d', '/candidato/puerta-a-puerta');
  const cuerpos = {};
  for (const r of rutas) {
    const x = await cand.get(r);
    cuerpos[r] = x.datos;
    ok(x.status === 200, `GET /api${r.split('?')[0]} → 200`, { status: x.status, datos: x.datos });
  }
  const res = cuerpos['/candidato/resumen'];
  const todo = JSON.stringify(cuerpos);
  ok(!/finanz|ingresos|gastos|balance/i.test(todo), '/api/candidato/*: ninguna respuesta trae finanzas');
  ok(!/cedula|numero_identificacion|"password/i.test(todo) && !/1023456789|1055000|74000000|1034567891/.test(todo), '/api/candidato/*: ni cédulas ni claves');
  ok(!NOMBRES_TEXTO_MALO.test(todo), '/api/candidato/*: ningún NaN/undefined en los datos');
  ok(res.candidato.nombre === 'Juan Pérez' && res.candidato.eslogan === 'Juntos por la Ciudad', 'el resumen trae nombre y eslogan del candidato', res.candidato);
  ok(res.eleccion.dias === 112, 'faltan 112 días para la elección', res.eleccion);
  ok(Array.isArray(res.por_dia) && res.por_dia.length === 7 && res.por_dia[6].hoy === true, 'siete días, el último es hoy');
  if (!VACIA) {
    ok(res.meta.registrados === 24 && res.meta.meta === 60 && res.meta.porcentaje === 40, 'meta: 24 de 60 = 40 %', res.meta);
    ok(res.meta.ritmo === null && res.meta.tiempo_pct === null, 'sin fecha de inicio → no hay etiqueta de ritmo', res.meta);
    ok(res.coordinadores.total === 2 && res.lideres.total === 5, '2 coordinadores y 5 líderes', { c: res.coordinadores, l: res.lideres });
    ok(res.coordinadores.activos + res.coordinadores.sin_actividad === 2 && res.coordinadores.sin_actividad === 0, 'los dos coordinadores tienen registros en 7 días', res.coordinadores);
    ok(res.lideres.activos === 3, 'líderes activos: Ana, Diego y Eva (Beto lleva 9 días)', res.lideres);
    ok(res.puestos.total === 3 && res.puestos.cubiertos === 2, 'puestos cubiertos: 2 de 3 (uno por votantes, otro por testigo)', res.puestos);
    ok(res.proximos_eventos.length === 2 && res.proximos_eventos[0].titulo === 'Reunión comuna 5' && res.proximos_eventos[0].hora === '6:00 p. m.', 'próximos eventos: dos, con la hora en 12 h', res.proximos_eventos);
    const eq = cuerpos['/candidato/equipo'];
    ok(eq.coordinadores.length === 2 && eq.coordinadores[0].registrados >= eq.coordinadores[1].registrados, 'el ranking va de más a menos registrados');
    const marta = eq.coordinadores.find((c) => c.nombre.startsWith('Marta'));
    ok(marta && marta.telefono === '3000000001' && marta.zona === 'Comuna 5 Universitaria', 'la coordinadora trae celular válido y su zona (comuna)', marta);
    const diego = eq.lideres.find((l) => l.nombre.startsWith('Diego')); const carla = eq.lideres.find((l) => l.nombre.startsWith('Carla'));
    ok(diego && diego.no_contactar === true && carla && carla.telefono === null, 'no_contactar y «sin celular» viajan al navegador');
    const f = await cand.get('/candidato/equipo/' + ids.coord1);
    ok(f.status === 200 && f.datos.lideres.length === 4 && f.datos.lideres.every((l) => ['verde', 'amarillo', 'rojo'].includes(l.punto)), 'la ficha del coordinador trae sus líderes con punto de actividad', f.datos);
    const beto = f.datos.lideres.find((l) => l.nombre.startsWith('Beto'));
    ok(beto && beto.punto === 'rojo', 'Beto, con 9 días sin registrar → punto rojo', beto);
    ok(f.datos.lideres.find((l) => l.nombre.startsWith('Ana')).punto === 'verde', 'Ana registró hoy → punto verde');
    ok((await cand.get('/candidato/equipo/' + ids.ana)).status === 404, 'la ficha de alguien que no es coordinador → 404');
    const mp = cuerpos['/candidato/mapa'];
    ok(mp.zonas.length === 2 && mp.zonas[0].lat !== null && mp.eventos.length === 2, 'mapa: dos zonas con coordenadas y dos eventos', { z: mp.zonas, e: mp.eventos.length });
    ok(!/direccion|"nombre":"Votante/i.test(JSON.stringify(mp)), 'el mapa no trae personas ni direcciones');
    const ag = cuerpos[`/candidato/agenda?desde=${d0(-7)}&hasta=${d0(7)}`];
    const pasado = ag.eventos.find((e) => e.pasado);
    ok(ag.eventos.length === 3 && pasado && pasado.asistieron === 3 && pasado.invitados === 5, 'agenda: 3 eventos; el pasado trae «3 de 5» asistieron', ag.eventos);
    ok(cuerpos['/candidato/mas'].secciones.solicitudes && cuerpos['/candidato/mas'].secciones.tareas && cuerpos['/candidato/mas'].secciones.puerta && cuerpos['/candidato/mas'].secciones.dia_d, 'Más: con los complementos encendidos aparecen Solicitudes, Tareas, Puerta a puerta y Día D', cuerpos['/candidato/mas']);
  }

  console.log('\n[2] Etiqueta de ritmo con y sin fecha de inicio');
  if (!VACIA) {
    await q('UPDATE configuracion_campana SET fecha_inicio_campana = DATE_SUB(CURDATE(), INTERVAL 28 DAY) WHERE id = 1');   // 28 de 140 días = 20 % del tiempo; la meta va en 40 %
    let r2 = (await cand.get('/candidato/resumen')).datos;
    ok(r2.meta.tiempo_pct === 20 && r2.meta.ritmo === 'al_ritmo', 'con fecha de inicio: 40 % de la meta vs 20 % del tiempo → «al ritmo esperado»', r2.meta);
    await q('UPDATE configuracion_campana SET fecha_inicio_campana = DATE_SUB(CURDATE(), INTERVAL 84 DAY) WHERE id = 1');   // 84 de 196 = 43 %
    r2 = (await cand.get('/candidato/resumen')).datos;
    ok(r2.meta.ritmo === 'por_debajo', '40 % de la meta vs 43 % del tiempo → «por debajo del ritmo»', r2.meta);
    await q('UPDATE configuracion_campana SET fecha_inicio_campana = NULL WHERE id = 1');
    // Guardar el campo desde Configuración (administrador)
    const adm = cliente(base); await adm.entrar('admin.ej@ejemplo.co', 'clave-admin-ej');
    const g = await adm.get('/configuracion/campana');
    const body = { ...g.datos, fecha_inicio_campana: d0(-30), fecha_eleccion: d0(112), meta_votos_campana: 60 };
    const guardado = await adm.put('/configuracion/campana', body);
    const [[fila]] = await pool.query("SELECT DATE_FORMAT(fecha_inicio_campana,'%Y-%m-%d') AS f FROM configuracion_campana WHERE id = 1");
    ok(guardado.status === 200 && fila.f === d0(-30), 'el administrador guarda la fecha de inicio desde Configuración', { st: guardado.status, d: guardado.datos, fila });
    const malo = await adm.put('/configuracion/campana', { ...body, fecha_inicio_campana: '30/11/2026' });
    ok(malo.status === 400, 'una fecha de inicio con formato inválido → 400');
    await adm.put('/configuracion/campana', { ...body, fecha_inicio_campana: '' });
    const [[fila2]] = await pool.query('SELECT fecha_inicio_campana AS f FROM configuracion_campana WHERE id = 1');
    ok(fila2.f === null, 'vaciar el campo la deja en blanco (sin etiqueta)');
    const sinCampo = { ...body }; delete sinCampo.fecha_inicio_campana;
    await q('UPDATE configuracion_campana SET fecha_inicio_campana = CURDATE() WHERE id = 1');
    await adm.put('/configuracion/campana', sinCampo);
    const [[fila3]] = await pool.query('SELECT fecha_inicio_campana AS f FROM configuracion_campana WHERE id = 1');
    ok(fila3.f !== null, 'una pantalla vieja que no manda el campo NO borra la fecha');
    await q('UPDATE configuracion_campana SET fecha_inicio_campana = NULL, fecha_eleccion = DATE_ADD(CURDATE(), INTERVAL 112 DAY) WHERE id = 1');
  }

  console.log('\n[3] Solo lectura en el servidor');
  const escrituras = [
    ['POST', '/votantes', { nombre: 'X' }], ['PUT', '/votantes/1', { nombre: 'X' }], ['DELETE', '/votantes/1'],
    ['PUT', '/territorial/estructura/1', { nombre: 'X' }], ['DELETE', '/territorial/estructura/1'], ['POST', '/territorial/estructura/importar-excel', {}], ['POST', '/territorial/estructura/eliminar-masivo', {}], ['POST', '/territorial/estructura/1/asignar-testigo', {}], ['PUT', '/territorial/territorios/1', {}], ['POST', '/territorial/territorios', {}],
    ['POST', '/eventos', { titulo: 'X' }], ['PUT', '/eventos/1', {}], ['POST', '/solicitudes', {}], ['POST', '/tareas', {}],
    ['POST', '/dia-d/rescate/marcar', { votante_id: 1 }], ['PUT', '/permisos/matriz', { permisos: {} }], ['PUT', '/configuracion/campana', {}],
    ['POST', '/usuarios', {}], ['PUT', '/complementos/solicitudes', {}], ['POST', '/finanzas', {}], ['PATCH', '/votantes/1', {}],
    ['POST', '/auth/otra-ruta-inexistente', {}], ['POST', '/push/suscribir', {}],
  ];
  for (const [m, r, b] of escrituras) {
    const x = m === 'DELETE' ? await cand.del(r) : (m === 'PUT' ? await cand.put(r, b) : (m === 'PATCH' ? await cand.patch(r, b) : await cand.post(r, b)));
    ok(x.status === 403 && x.datos && x.datos.codigo === 'solo_lectura', `${m} /api${r} → 403 solo_lectura`, { status: x.status, datos: x.datos });
  }
  for (const r of ['/votantes', '/usuarios/admin', '/finanzas/resumen', '/territorial/estructura/exportar-excel', '/usuarios/admin', '/territorial/mapa-personas', '/votantes-dashboard/resumen', '/dia-d/rescate/ranking', '/comunicaciones/campanas', '/coordinador/mis-lideres', '/eventos', '/solicitudes', '/backup/lista']) {
    const x = await cand.get(r);
    ok(x.status === 403, `GET /api${r} → 403 (no está en lo que puede leer)`, { status: x.status });
  }
  const dash = await cand.get('/dashboard/resumen');
  ok(dash.status === 200 && !('finanzas' in dash.datos), '/dashboard/resumen: 200 y SIN finanzas', Object.keys(dash.datos || {}));
  ok(!/"cedula"|numero_identificacion/.test(JSON.stringify(dash.datos)), '/dashboard/resumen: sin cédulas');
  const tp = await cand.get('/dashboard/tabla-posiciones');
  ok(tp.status === 200 && !/"cedula"|numero_identificacion/.test(JSON.stringify(tp.datos)), '/dashboard/tabla-posiciones: 200 y sin cédulas');
  const mios = (await cand.get('/permisos/mios')).datos;
  ok(Object.entries(mios.permisos).every(([m, p]) => !p.editar && !p.importar_exportar && (!p.agregar || m === 'territorial')), '/permisos/mios: nada con editar ni importar, y «agregar» solo en la estructura territorial', mios.permisos);
  ok(mios.permisos.territorial && mios.permisos.territorial.ver && mios.permisos.territorial.agregar === true && mios.permisos.territorial.editar === false, 'Estructura territorial: Ver y Agregar sí, Editar no', mios.permisos.territorial);
  ok(!['finanzas', 'configuracion', 'usuarios', 'votantes', 'crm', 'solicitudes', 'tareas', 'rescate_votos', 'puerta_listas'].some((m) => mios.modulos.includes(m)), 'el menú del escritorio no ofrece módulos que le den 403', mios.modulos);
  ok(['panel_general', 'legislacion', 'recursos', 'territorial'].every((m) => mios.modulos.includes(m)), 'el menú del escritorio ofrece el panel, la estructura territorial, legislación y recursos', mios.modulos);
  const mz = (await (async () => { const adm = cliente(base); await adm.entrar('admin.ej@ejemplo.co', 'clave-admin-ej'); return adm.get('/permisos/matriz'); })()).datos;
  ok(mz.roles.includes('candidato') && Object.entries(mz.permisos).filter(([k]) => k.startsWith('candidato:')).every(([k, p]) => !p.editar && !p.importar_exportar && (!p.agregar || k === 'candidato:territorial')), 'la matriz muestra la fila «candidato»: Editar e Importar apagados, Agregar solo en Estructura territorial');
  { // guardar la matriz como admin intentando encender escritura del candidato: el servidor la deja en 0
    const adm = cliente(base); await adm.entrar('admin.ej@ejemplo.co', 'clave-admin-ej');
    const m = (await adm.get('/permisos/matriz')).datos;
    const permisos = { ...m.permisos }; permisos['candidato:panel_general'] = { ver: true, editar: true, agregar: true, importar_exportar: true };
    const gp = await adm.put('/permisos/matriz', { permisos });
    const [[fp]] = await pool.query("SELECT editar, agregar, importar_exportar FROM permisos_rol WHERE rol='candidato' AND modulo='panel_general'");
    ok(gp.status === 200 && fp.editar === 0 && fp.agregar === 0 && fp.importar_exportar === 0, 'aunque se pida, el servidor guarda editar/agregar/importar del candidato en 0', { gp: gp.status, fp });
  }
  const otros = { admin: ['admin.ej@ejemplo.co', 'clave-admin-ej'] };
  const rc = cliente(base); const rcl = await rc.entrar('1023456789', 'clave-correo-ej');
  if (!VACIA) {
    ok(rcl.status === 200, 'el coordinador sigue entrando por el login de siempre');
    ok((await rc.get('/candidato/resumen')).status === 403, 'el coordinador NO puede leer /api/candidato (403)');
    ok((await rc.get('/coordinador/mis-lideres')).status === 200, 'el coordinador sigue viendo «Mis líderes»');
    const w = await rc.post('/auth/logout');
    ok(w.status === 200 && w.datos && w.datos.codigo !== 'solo_lectura', 'las escrituras del coordinador no pasan por el candado (logout 200)');
  }
  const ad = cliente(base); await ad.entrar(...otros.admin);
  ok((await ad.get('/candidato/resumen')).status === 200, 'el administrador SÍ puede leer /api/candidato (para probar)');
  const ver = await cand.get('/candidato/resumen');
  ok(ver.status === 200, 'tras los intentos, el candidato sigue con sesión');

  console.log('\n[4] Cambiar su clave y cerrar sesión funcionan');
  const mal = await cand.post('/auth/cambiar-password', { passwordActual: 'otra', passwordNueva: '482915' });
  ok(mal.status === 400, 'clave actual equivocada → 400 (no 403)', mal);
  const bien = await cand.post('/auth/cambiar-password', { passwordActual: CLAVE, passwordNueva: '482915' });
  ok(bien.status === 200, 'cambiar su propia clave → 200', bien);
  const c2 = cliente(base); ok((await c2.entrar(CORREO, '482915')).status === 200, 'entra con la clave nueva');
  await cand.post('/auth/cambiar-password', { passwordActual: '482915', passwordNueva: CLAVE });
  const lo = await cand.post('/auth/logout');
  ok(lo.status === 200, 'cerrar sesión → 200', lo);
  ok((await cand.get('/candidato/resumen')).status === 401, 'después de cerrar sesión ya no lee nada (401)');

  if (!VACIA) {
  console.log('\n[5b] Orden 73: el candidato SOLO agrega a la estructura territorial');
  const c5 = cliente(base); await c5.entrar(CORREO, CLAVE);
  const [[terr]] = await pool.query("SELECT id FROM territorios WHERE tipo = 'barrio' LIMIT 1"); const terrId = terr.id;
  const nuevoCoord = await c5.post('/territorial/estructura', { nombre: 'Rosa Coordinadora Candidato', cargo: 'coordinador', numero_identificacion: '1066778899', email: 'rosa.cand@ejemplo.co', telefono: '3000000007', area: 'urbano', territorio_id: terrId, password_confirmacion: CLAVE });
  ok(nuevoCoord.status === 200 && nuevoCoord.datos.ok, 'el candidato crea un COORDINADOR en la estructura', nuevoCoord);
  const [[rosa]] = await pool.query("SELECT id FROM usuarios WHERE numero_identificacion = '1066778899'");
  const nuevoLider = await c5.post('/territorial/estructura', { nombre: 'Luis Líder Candidato', cargo: 'lider', numero_identificacion: '1066778800', telefono: '3000000008', area: 'urbano', territorio_id: terrId, supervisor_id: rosa.id, meta_votos: 30, password_confirmacion: CLAVE });
  ok(nuevoLider.status === 200 && nuevoLider.datos.ok, 'y un LÍDER que reporta a ese coordinador', nuevoLider);
  const [[cre]] = await pool.query("SELECT COUNT(*) n FROM votantes WHERE cedula IN ('1066778899','1066778800') AND created_by = ?", [candidatoId]);
  ok(cre.n === 2, 'quedan a nombre del candidato como creador (la ficha que la estructura copia a Votantes lleva su usuario en `created_by`, como cuando crea el administrador)', cre);
  const eqn = (await c5.get('/candidato/equipo')).datos;
  ok(eqn.coordinadores.some((c) => c.nombre.startsWith('Rosa')) && eqn.lideres.some((l) => l.nombre.startsWith('Luis') && l.coordinador && l.coordinador.startsWith('Rosa')), 'los dos aparecen en Equipo enseguida (con «Reporta a» bien)', { c: eqn.coordinadores.map((c) => c.nombre), l: eqn.lideres.map((l) => l.nombre) });
  const sinReporta = await c5.post('/territorial/estructura', { nombre: 'Sara Sin Jefe', cargo: 'lider', numero_identificacion: '1066778811', telefono: '3000000009', area: 'urbano', territorio_id: terrId, password_confirmacion: CLAVE });
  const [[sj]] = await pool.query("SELECT e.supervisor_id s FROM estructura e JOIN usuarios u ON u.id = e.usuario_id WHERE u.numero_identificacion = '1066778811'");
  ok(sinReporta.status === 200 && sj.s === null, 'si el candidato no escoge a quién reporta, queda sin supervisor (igual que cuando lo crea el administrador)', sj);
  for (const [m, r, b] of [['PUT', '/territorial/estructura/' + nuevoCoord.datos.estructura_id, { nombre: 'Otro' }], ['DELETE', '/territorial/estructura/' + nuevoLider.datos.estructura_id], ['POST', '/territorial/estructura/importar-excel', {}], ['POST', '/territorial/estructura/eliminar-masivo', {}], ['POST', '/votantes', { nombre: 'X' }], ['POST', '/territorial/estructura/regeocodificar-pendientes', {}]]) {
    const x = m === 'DELETE' ? await c5.del(r) : (m === 'PUT' ? await c5.put(r, b) : await c5.post(r, b));
    ok(x.status === 403 && x.datos.codigo === 'solo_lectura', `${m} /api${r.replace(/\d+$/, 'N')} → 403 (no edita, borra, importa ni registra votantes)`, { status: x.status, datos: x.datos });
  }
  const [[intacto]] = await pool.query("SELECT COUNT(*) n FROM usuarios WHERE numero_identificacion IN ('1066778899','1066778800')");
  ok(intacto.n === 2, 'lo creado sigue ahí (nada se editó ni se borró)');
  const us = (await c5.get('/usuarios')).datos;
  ok(Array.isArray(us) && us.every((u) => !('numero_identificacion' in u) && !('email' in u)), 'GET /usuarios («Reporta a») trae solo id, nombre y rol: sin cédulas ni correos', us[0]);
  for (const r of ['/territorial/territorios', '/territorial/territorios/modo', '/territorial/estructura/verificar-identificacion?numero=123', '/territorial/coordinador-organizaciones', '/dia-d/puestos-para-reporte', '/territorial/estructura']) {
    const x = await c5.get(r);
    ok(x.status !== 403 && x.status < 500, `GET /api${r.split('?')[0]} lo que lee el formulario: no se le cierra (${x.status})`, x.datos);
  }
  const est = (await c5.get('/territorial/estructura')).datos;
  ok(Array.isArray(est) && est.length <= 3 && est.every((e) => ['Rosa Coordinadora Candidato', 'Luis Líder Candidato', 'Sara Sin Jefe'].includes(e.nombre) || e.supervisor_id === candidatoId), 'GET /territorial/estructura: solo ve lo que él mismo creó (no la estructura entera)', est.map((e) => e.nombre));
  // Se borra lo creado aquí para que el resto de la prueba (cifras del Inicio, Equipo) parta de los mismos datos.
  const [creados] = await pool.query("SELECT id FROM usuarios WHERE numero_identificacion IN ('1066778899','1066778800','1066778811')");
  await q("DELETE FROM votantes WHERE cedula IN ('1066778899','1066778800','1066778811')");
  await q('DELETE FROM usuarios WHERE id IN (?)', [creados.map((c) => c.id)]);
  require('../lib/candidatoResumen').olvidarEquipo();
  }

  console.log('\n[5] Módulos apagados no aparecen en «Más»');
  const c3 = cliente(base); await c3.entrar(CORREO, CLAVE);
  await q("UPDATE complementos_campana SET activo = 0 WHERE clave IN ('solicitudes','tareas','puerta_a_puerta','puerta_panel')"); require('../lib/complementos').invalidar();
  await q("UPDATE permisos_rol SET permitido = 0 WHERE rol='candidato' AND modulo='rescate_votos'");
  const m0 = (await c3.get('/candidato/mas')).datos.secciones;
  ok(!m0.solicitudes && !m0.tareas && !m0.puerta && !m0.dia_d, 'con todo apagado: ni Solicitudes, ni Tareas, ni Puerta a puerta, ni Día D', m0);
  ok((await c3.get('/candidato/solicitudes')).status === 403 && (await c3.get('/candidato/dia-d')).status === 403 && (await c3.get('/candidato/puerta-a-puerta')).status === 403, 'y sus rutas responden 403');
  await q("UPDATE permisos_rol SET permitido = 1 WHERE rol='candidato' AND modulo='rescate_votos'");
  await require('./fixtures/encender-complementos')(pool, ['solicitudes', 'tareas', 'puerta_a_puerta', 'puerta_panel']);
  const m1 = (await c3.get('/candidato/mas')).datos.secciones;
  ok(m1.solicitudes && m1.tareas && m1.puerta && m1.dia_d, 'al volver a encenderlos, aparecen', m1);
  await q("UPDATE complementos_campana SET activo = 0 WHERE clave = 'tareas'"); require('../lib/complementos').invalidar();
  ok(!(await c3.get('/candidato/mas')).datos.secciones.tareas && (await c3.get('/candidato/mas')).datos.secciones.solicitudes, 'apagar solo Tareas: Tareas desaparece y Solicitudes se queda');
  await require('./fixtures/encender-complementos')(pool, ['tareas']);

  /* ================= NAVEGADOR ================= */
  console.log('\n[6] El navegador (Chromium 390×844)');
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  const movil = () => cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const escritorio = () => cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const ir = async (url) => { await cmd('Page.navigate', { url }); await espera(1000); };
  const esperar = async (expr, ms = 9000) => { const hasta = Date.now() + ms; while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); } return false; };
  const foto = async (nombre) => { const r = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r.result.data, 'base64')); };
  const sinDesborde = () => ev('document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1');
  const texto = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ''`);
  const ruta = () => ev('location.pathname');
  const sufijo = VACIA ? '-vacia' : '';
  const limpiarAvisos = () => { p.avisos.length = 0; };
  const mala = (t) => NOMBRES_TEXTO_MALO.test(t);

  await cmd('Emulation.setTimezoneOverride', { timezoneId: 'America/Bogota' });   // el celular de quien lo usa está en Colombia
  await movil();
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: true });
  console.log('  — ingreso por «Otros usuarios»');
  await ir(base + '/login.html');
  ok(await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'"), 'en el celular se ve la pantalla de elección');
  await ev("document.getElementById('ir-a-otros-desde-eleccion').click()");
  await ev("document.getElementById('ir-a-password').click()");
  await ev(`(() => { const e = document.getElementById('campo-email'); e.value = ${JSON.stringify(CORREO)}; document.getElementById('campo-password').value = ${JSON.stringify(CLAVE)}; document.querySelector('#form-login button[type=submit]').click(); })()`);
  ok(await esperar("location.pathname === '/app/candidato.html'", 12000), 'el candidato cae en /app/candidato.html', await ruta());

  // Inicio
  ok(await esperar("document.getElementById('contenido').style.display !== 'none'"), 'el Inicio carga');
  await espera(600);
  const inicio = await ev(`({ nombre: document.getElementById('nombre').innerText, saludo: document.getElementById('saludo').innerText, lema: document.getElementById('lema').innerText, meta: document.getElementById('meta').innerText.replace(/\\n/g,' · '),
     kpis: [...document.querySelectorAll('#kpis .kpi')].map(k => k.innerText.replace(/\\n/g,' ')), alerta: getComputedStyle(document.getElementById('alerta')).display, barras: document.querySelectorAll('#barras .spark i').length,
     vacioBarras: !!document.querySelector('#barras .vacio'), eventos: document.querySelectorAll('#eventos .ev').length, foto: document.getElementById('foto').innerText, nav: [...document.querySelectorAll('#nav-candidato a')].map(a => a.lastChild.textContent.trim()),
     activo: (document.querySelector('#nav-candidato a.on') || { lastChild: {} }).lastChild.textContent, estado: document.getElementById('estado').innerText })`);
  console.log('    inicio:', JSON.stringify(inicio));
  ok(inicio.nombre === 'Juan Pérez' && /Buen/.test(inicio.saludo) && inicio.foto === 'JP', 'encabezado: saludo, nombre e iniciales', inicio);
  ok(/Juntos por la Ciudad/.test(inicio.lema) && /112 días para la elección/.test(inicio.lema), 'eslogan y «faltan 112 días para la elección»', inicio.lema);
  ok(!/Alcald|Gobernaci|Concejo/i.test(JSON.stringify(inicio)), 'precampaña: ningún texto menciona el cargo');
  ok(inicio.nav.join(',') === 'Inicio,Equipo,Mapa,Agenda,Más' && /Inicio/.test(inicio.activo), 'barra inferior con 5 botones y el activo resaltado', inicio.nav);
  ok(inicio.kpis.length === 4 && !mala(JSON.stringify(inicio)), 'cuatro tarjetas de cifras y ningún NaN/undefined', inicio.kpis);
  if (!VACIA) {
    ok(/40%/.test(await texto('#meta')) && /24/.test(inicio.meta), 'anillo con 40 % y 24 registrados', inicio.meta);
    ok(!/ritmo/.test(inicio.meta), 'sin fecha de inicio: sin etiqueta de ritmo');
    ok(inicio.alerta === 'none', 'sin coordinadores inactivos: el aviso amarillo no se muestra');
    ok(inicio.barras === 7 && inicio.eventos === 2, 'siete barras y dos eventos próximos');
  } else {
    ok(/Defina la meta en Configuración/.test(inicio.meta), 'vacía: sin meta dice «Defina la meta en Configuración»', inicio.meta);
    ok(inicio.vacioBarras && inicio.eventos === 0 && /No hay eventos próximos/.test(await texto('#eventos')), 'vacía: estados vacíos en barras y eventos');
  }
  ok(await sinDesborde(), 'Inicio: sin desborde horizontal');
  ok(p.avisos.length === 0, 'Inicio: sin errores de consola', p.avisos);
  await foto('1-inicio' + sufijo);

  if (!VACIA) { // ritmo en pantalla
    await q('UPDATE configuracion_campana SET fecha_inicio_campana = DATE_SUB(CURDATE(), INTERVAL 28 DAY) WHERE id = 1');
    await ev('cargar(true)'); await espera(900);
    ok(/al ritmo esperado/.test(await texto('#meta')) && await ev("!!document.querySelector('#meta .sem.verde')"), 'con fecha de inicio: «al ritmo esperado» en verde');
    await foto('1b-inicio-con-ritmo');
    await q('UPDATE configuracion_campana SET fecha_inicio_campana = DATE_SUB(CURDATE(), INTERVAL 84 DAY) WHERE id = 1');
    await ev('cargar(true)'); await espera(900);
    ok(/por debajo del ritmo/.test(await texto('#meta')) && await ev("!!document.querySelector('#meta .sem.ambar')"), 'y «por debajo del ritmo» en ámbar');
    await q('UPDATE configuracion_campana SET fecha_inicio_campana = NULL WHERE id = 1');
    // alerta de coordinadores sin actividad
    await q("UPDATE votantes SET created_at = DATE_SUB(NOW(), INTERVAL 20 DAY) WHERE lider_id IN (?, ?, ?)", [ids.eva, ids.eva, ids.eva]);
    require('../lib/candidatoResumen').olvidarEquipo();
    await ev('cargar(true)'); await espera(900);
    const al = await ev(`({ d: getComputedStyle(document.getElementById('alerta')).display, t: document.getElementById('alerta-texto').innerText, h: document.getElementById('alerta').getAttribute('href') })`);
    ok(al.d === 'flex' && /1 coordinador/.test(al.t) && /sin registros en 7 días/.test(al.t) && /sin_actividad/.test(al.h), 'si un coordinador pasa 7 días sin registrar: aviso «1 coordinador sin registros en 7 días» → Equipo/Sin actividad', al);
    await foto('1c-inicio-con-alerta');
  }

  // Sin señal en el Inicio
  await cmd('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await ev('cargar(true)'); await espera(1200);
  const sinSenal = await texto('#estado');
  ok(/Sin señal/.test(sinSenal) && /Actualizado hace/.test(sinSenal), 'sin señal: muestra lo último con «Actualizado hace N min»', sinSenal);
  await cmd('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // Equipo
  console.log('  — Equipo y ficha');
  limpiarAvisos();
  await ir(base + '/app/candidato-equipo.html');
  ok(await esperar("document.getElementById('lista').style.display !== 'none'"), 'Equipo carga');
  const eqp = await ev(`({ filas: document.querySelectorAll('#lista .per').length, nombres: [...document.querySelectorAll('#lista .per .nom')].map(n => n.innerText), pos: [...document.querySelectorAll('#lista .pos')].map(n => n.className), tel: [...document.querySelectorAll('#lista a.ll')].map(a => a.getAttribute('href')), wa: [...document.querySelectorAll('#lista a.wa')].map(a => a.getAttribute('href')), chips: [...document.querySelectorAll('#chips .chip')].map(c => c.innerText.trim()), vacio: !!document.querySelector('#lista .vacio') })`);
  console.log('    equipo:', JSON.stringify(eqp));
  ok(eqp.chips.slice(0, 3).join(',') === 'Coordinadores,Líderes,Sin actividad', 'chips: Coordinadores / Líderes / Sin actividad / Comuna', eqp.chips);
  if (!VACIA) {
    ok(eqp.filas === 2 && eqp.pos[0].includes('o1'), 'ranking con posición 1 en amarillo', eqp);
    ok(eqp.tel.includes('tel:+573000000001') && eqp.wa.includes('https://wa.me/573000000001'), 'Llamar y WhatsApp apuntan a tel:+57… y wa.me/57… (mensaje vacío, no se envía nada)', eqp);
    ok(await sinDesborde(), 'Equipo: sin desborde horizontal');
    await foto('2-equipo');
    await ev("document.querySelector('#chips [data-modo=lid]').click()"); await espera(300);
    const lid = await ev(`({ filas: document.querySelectorAll('#lista .per').length, off: document.querySelectorAll('#lista .per .off').length, tel: [...document.querySelectorAll('#lista a.ll')].map(a => a.getAttribute('href')), wa: [...document.querySelectorAll('#lista a.wa')].map(a => a.getAttribute('href')), nc: document.getElementById('lista').innerText.includes('pidió no recibir mensajes') })`);
    ok(lid.filas === 5 && lid.off >= 3, 'Líderes: 5 filas; sin celular → deshabilitados', lid);
    ok(lid.tel.some((h) => h.includes('3157778899')) && !lid.wa.some((h) => h.includes('3157778899')) && lid.nc, 'no_contactar: se puede llamar pero WhatsApp queda deshabilitado, con su nota', lid);
    ok(lid.filas - lid.tel.length === 1, 'Carla, sin celular: ni Llamar ni WhatsApp (una sola fila sin enlace de llamada)', lid);
    await ev("document.querySelector('#chips [data-modo=sin]').click()"); await espera(300);
    const sin = await ev(`({ txt: document.getElementById('lista').innerText.replace(/\\n/g,' ') })`);
    ok(/Beto/.test(sin.txt) && /Eva/.test(sin.txt) || /Beto/.test(sin.txt), '«Sin actividad» lista a quien lleva 7 días o más sin registrar', sin.txt.slice(0, 300));
    await ev("document.querySelector('#chips [data-modo=coord]').click()"); await espera(200);
    await ev("document.getElementById('zona').value = [...document.getElementById('zona').options].find(o => /Comuna 5/.test(o.text)).value; document.getElementById('zona').dispatchEvent(new Event('change'))"); await espera(300);
    ok(await ev("document.querySelectorAll('#lista .per').length") === 1, 'el filtro «Comuna» deja solo a la coordinadora de esa comuna');
    await ev("document.getElementById('zona').value = ''; document.getElementById('zona').dispatchEvent(new Event('change'))"); await espera(200);
    // Ficha
    await ev("document.querySelector('#lista button.nom').click()");
    ok(await esperar("document.getElementById('vista-ficha').style.display !== 'none' && document.getElementById('ficha-lideres').querySelectorAll('.per').length > 0"), 'tocar el nombre abre la ficha con sus líderes');
    const fi = await ev(`({ nombre: document.getElementById('ficha-nombre').innerText, zona: document.getElementById('ficha-zona').innerText, puntos: [...document.querySelectorAll('#ficha-lideres .punto')].map(x => x.className.replace('punto ','')), acc: [...document.querySelectorAll('#ficha-resumen .ficha-acc a')].map(a => a.getAttribute('href')), anillo: !!document.querySelector('#ficha-resumen svg') })`);
    console.log('    ficha:', JSON.stringify(fi));
    ok(/Marta/.test(fi.nombre) && fi.puntos.includes('verde') && fi.puntos.includes('rojo') && fi.anillo && fi.acc.some((h) => /^tel:\+57/.test(h)), 'ficha: nombre, anillo de avance, puntos verde/amarillo/rojo y botones de contacto', fi);
    ok(await sinDesborde() && p.avisos.length === 0, 'ficha y Equipo: sin desborde ni errores de consola', p.avisos);
    await foto('3-ficha-coordinador');
  } else {
    ok(eqp.vacio && /Aún no hay coordinadores/.test(await texto('#lista')), 'vacía: «Aún no hay coordinadores»');
    ok(await sinDesborde() && p.avisos.length === 0 && !mala(await texto('body')), 'vacía: sin desborde, errores ni NaN', p.avisos);
    await foto('2-equipo' + sufijo);
  }

  // Mapa
  console.log('  — Mapa');
  limpiarAvisos();
  await ir(base + '/app/candidato-mapa.html');
  await espera(2500);
  if (!VACIA) {
    ok(await esperar("document.querySelectorAll('.pin-zona').length >= 2"), 'el mapa dibuja círculos por zona con su número');
    const am = await ev("[...document.querySelectorAll('.pin-zona')].map(p => ({ n: p.innerText, am: p.classList.contains('am') }))");
    ok(am.filter((x) => x.am).length === 1, 'solo la zona más grande va en amarillo', am);
    await ev("document.querySelector('.pin-zona.am').parentElement.dispatchEvent(new MouseEvent('click', { bubbles: true }))"); await espera(700);
    const h = await ev(`({ abierta: document.getElementById('hoja').classList.contains('abierta'), nombre: document.getElementById('h-nombre').innerText, cif: document.getElementById('h-cifras').innerText.replace(/\\n/g,' '), href: document.getElementById('h-equipo').getAttribute('href'), btn: document.getElementById('h-equipo').innerText })`);
    console.log('    hoja:', JSON.stringify(h));
    ok(h.abierta && /Comuna/.test(h.nombre) && /votantes/.test(h.cif) && /zona=/.test(h.href) && /Ver el equipo de esta zona/.test(h.btn), 'tocar una zona abre la hoja con votantes, líderes y puestos y el botón «Ver el equipo de esta zona»', h);
    await foto('4-mapa-con-hoja');
    await ev("document.getElementById('buscar').value = 'Comuna 2'; document.getElementById('buscar').dispatchEvent(new Event('input'))"); await espera(300);
    ok(/Comuna 2/.test(await texto('#sugerencias')), 'el buscador encuentra una comuna');
    await ev("document.querySelector('#capas [data-capa=eventos]').click()"); await espera(500);
    ok(await ev("document.querySelectorAll('.pin-zona').length") === 2, 'la capa Eventos muestra los dos eventos con ubicación');
  } else {
    ok(/Aún no hay datos con ubicación/.test(await texto('#aviso')), 'vacía: aviso «Aún no hay datos con ubicación»', await texto('#aviso'));
    await foto('4-mapa' + sufijo);
  }
  const errMapa = p.avisos.filter((a) => !/tile|Failed to load/i.test(a));
  ok(errMapa.length === 0 && await sinDesborde(), 'Mapa: sin errores de consola ni desborde', errMapa);

  // Agenda
  console.log('  — Agenda');
  limpiarAvisos();
  await ir(base + '/app/candidato-agenda.html');
  await esperar("!document.querySelector('#lista .cargando')");
  await espera(500);
  const ag = await ev(`({ tira: document.querySelectorAll('#tira .dia-tira').length, hoy: document.querySelectorAll('#tira .dia-tira.hoy').length, evt: document.querySelectorAll('#lista .evt').length, txt: document.getElementById('lista').innerText.replace(/\\n/g,' '), vacio: !!document.querySelector('#lista .vacio') })`);
  console.log('    agenda:', JSON.stringify(ag).slice(0, 400));
  ok(ag.tira === 7 && ag.hoy === 1, 'tira de 7 días con «hoy» marcado (amarillo)', ag);
  ok(!mala(ag.txt), 'Agenda: ningún NaN/undefined');
  if (!VACIA) {
    // semana actual muestra los eventos de esta semana; navegar para ver el pasado y los próximos
    const total = [];
    for (let i = 0; i < 3; i++) { total.push(await ev("document.querySelectorAll('#lista .evt').length")); await ev("document.getElementById('ant').click()"); await espera(900); }
    ok(total.some((n) => n > 0), 'Agenda: hay tarjetas de evento en la semana', total);
    await ir(base + `/app/candidato-agenda.html?dia=${d0(-3)}`); await esperar("!document.querySelector('#lista .cargando')"); await espera(500);
    const past = await texto('#lista');
    ok(/3 de 5/.test(past) && await ev("!!document.querySelector('#lista .barra-asis i')"), 'un evento pasado muestra «3 de 5» asistieron con su barra verde', past.slice(0, 200));
    await foto('5-agenda');
    await ir(base + `/app/candidato-agenda.html?dia=${d0(1)}`); await esperar("!document.querySelector('#lista .cargando')"); await espera(400);
    ok(/Reunión comuna 5/.test(await texto('#lista')) && /3 confirmados/.test(await texto('#lista')) && /Organiza: Marta/.test(await texto('#lista')) && /6:00 p\. m\./.test(await texto('#lista')), 'un evento próximo: hora, lugar, organizador y confirmados');
  } else {
    ok(ag.vacio && /No hay eventos/.test(ag.txt), 'vacía: «No hay eventos esta semana»');
    await foto('5-agenda' + sufijo);
  }
  ok(p.avisos.length === 0 && await sinDesborde(), 'Agenda: sin errores de consola ni desborde', p.avisos);

  // Más
  console.log('  — Más y Cambiar mi clave');
  limpiarAvisos();
  await ir(base + '/app/candidato-mas.html');
  await esperar("document.querySelectorAll('#menu a, #menu button').length > 0");
  const mas = await ev(`({ items: [...document.querySelectorAll('#menu a, #menu button')].map(x => x.innerText.replace(/[›\\n]/g,'').trim()) })`);
  console.log('    más:', JSON.stringify(mas));
  ok(mas.items.some((t) => /Cambiar mi clave/.test(t)) && mas.items.some((t) => /Solicitudes/.test(t)) && mas.items.some((t) => /Tareas/.test(t)) && mas.items.some((t) => /Puerta a puerta/.test(t)) && mas.items.some((t) => /Día D/.test(t)) && mas.items.some((t) => /Legislación/.test(t)), 'Más: Solicitudes, Tareas, Puerta a puerta, Día D, Legislación y Cambiar mi clave', mas.items);
  for (const id of ['solicitudes', 'tareas', 'puerta', 'dia_d']) {
    await ev(`document.querySelector('#menu button[data-id=${id}]').click()`); await espera(700);
    const t = await texto('#detalle');
    ok(t.length > 5 && !mala(t), `Más › ${id}: se abre sin NaN/undefined`, t.slice(0, 160));
  }
  await ev("document.querySelector('#menu button[data-id=solicitudes]').click()"); await espera(600);
  ok(await sinDesborde() && p.avisos.length === 0, 'Más: sin desborde ni errores de consola', p.avisos);
  await foto('6-mas' + sufijo);
  limpiarAvisos();
  await ir(base + '/app/candidato-clave.html');
  ok(await esperar("document.getElementById('actual')"), 'Cambiar mi clave carga');
  await ev("document.querySelector('[data-ojo=nueva]').click()");
  ok(await ev("document.getElementById('nueva').type") === 'text', 'el ojo muestra la clave');
  await ev(`(() => { actual.value = 'equivocada'; nueva.value = '482915'; repetir.value = '482915'; document.getElementById('form').requestSubmit(); })()`); await espera(900);
  ok(/no es correcta/.test(await texto('#msg')), 'clave actual equivocada → mensaje claro (sin que lo tome por sesión vencida)', await texto('#msg'));
  await ev(`(() => { actual.value = ${JSON.stringify(CLAVE)}; nueva.value = '482915'; repetir.value = '482915'; document.getElementById('form').requestSubmit(); })()`); await espera(1200);
  ok(/Listo/.test(await texto('#msg')), 'cambiar su clave desde la pantalla funciona', await texto('#msg'));
  await ev(`(() => { actual.value = '482915'; nueva.value = ${JSON.stringify(CLAVE)}; repetir.value = ${JSON.stringify(CLAVE)}; document.getElementById('form').requestSubmit(); })()`); await espera(1200);
  ok(/Listo/.test(await texto('#msg')), 'y se vuelve a dejar la de prueba');
  ok(await sinDesborde() && p.avisos.length === 0, 'Cambiar mi clave: sin desborde ni errores de consola', p.avisos);
  await foto('7-cambiar-clave');

  console.log('  — Orden 73: nunca al escritorio, grupo «Registro» y formulario de la estructura');
  limpiarAvisos();
  for (const u of ['/dashboard.html', '/territorial.html', '/votantes.html', '/app/inicio.html']) {
    await ir(base + u); await esperar("location.pathname === '/app/candidato.html'", 9000);
    ok(await ruta() === '/app/candidato.html', `candidato en celular abre ${u} a mano → termina en /app/candidato.html`, await ruta());
  }
  await ir(base + '/login.html'); await espera(1500);
  ok(await ruta() === '/app/candidato.html', 'con la sesión ya iniciada, el ingreso lo lleva a su app (nunca al escritorio)', await ruta());
  await ir(base + '/app/candidato-mas.html'); await esperar("document.querySelectorAll('#registro a').length > 0");
  const reg = await ev(`({ botones: [...document.querySelectorAll('#registro a')].map(a => a.innerText.replace(/[›\\n]/g, '').trim()), hrefs: [...document.querySelectorAll('#registro a')].map(a => a.getAttribute('href')),
     grupos: [...document.querySelectorAll('.grupo-tit')].map(x => x.innerText), escritorio: /escritorio/i.test(document.body.innerText), primero: (document.querySelector('.grupo-tit') || {}).innerText })`);
  console.log('    registro:', JSON.stringify(reg));
  ok(reg.botones.length === 2 && /Registrar en la estructura territorial/.test(reg.botones[0]) && /Consultar puesto de votación/.test(reg.botones[1]), '«Más» → Registro: exactamente dos botones, los pedidos', reg.botones);
  ok(/^registro$/i.test(reg.primero) && /^registro$/i.test(reg.grupos[0]), 'el grupo «Registro» va arriba de todo', reg.grupos);
  ok(!reg.escritorio, '«Ver versión de escritorio» ya no aparece');
  ok(!/Registrar (votante|persona)|Importar|Eliminar|enlace de inscripción|Mi enlace/i.test(await texto('body')), 'ningún otro botón de registro, importar, eliminar ni enlaces de inscripción', await texto('body'));
  ok(await sinDesborde() && p.avisos.length === 0, 'Más con Registro: sin desborde ni errores de consola', p.avisos);
  await foto('9-mas-con-registro');
  // Consultar puesto de votación
  await ev("document.querySelector('#registro a[href*=puesto-votacion]').click()");
  ok(await esperar("location.pathname === '/app/puesto-votacion.html'"), '«Consultar puesto de votación» abre la consulta de siempre');
  await espera(600);
  const pv = await ev(`({ reg: (document.querySelector('a[href*=registraduria]') || {}).href, volver: (document.querySelector('.app-barra .volver') || {}).getAttribute ? document.querySelector('.app-barra .volver').getAttribute('onclick') : '', btn: document.getElementById('btn-volver-menu').onclick ? 'js' : '' })`);
  ok(/consultacenso\.registraduria\.gov\.co/.test(pv.reg || ''), 'enlaza a la Registraduría (no se envía nada)', pv);
  ok(/candidato-mas/.test(pv.volver), 'y «Volver» lo devuelve a su app, no al menú de líder', pv);
  const copia = await ev(`(typeof copiarCedulaParaConsulta === 'function') || document.body.innerHTML.indexOf('consulta-censo') >= 0 || !!document.querySelector('[data-copiar-cedula], #cedula-consulta, input')`);
  await foto('10-consultar-puesto');
  // Registrar en la estructura territorial (formulario de siempre, en modo app)
  await ir(base + '/app/candidato-mas.html'); await esperar("document.querySelectorAll('#registro a').length > 0");
  limpiarAvisos(); p.respuestas.length = 0;
  await ev("document.querySelector('#registro a[href*=territorial]').click()");
  ok(await esperar("location.pathname === '/territorial.html'", 12000), '«Registrar en la estructura territorial» abre el formulario por pasos', await ruta());
  await esperar("document.querySelector('.wz-paso') && document.querySelector('#form-estructura')", 12000); await espera(2500);
  const fe = await ev(`({ modoApp: document.documentElement.classList.contains('modo-app'), volver: document.getElementById('barra-volver-app').getAttribute('href'), volverVisible: getComputedStyle(document.getElementById('barra-volver-app')).display !== 'none',
     pasos: document.querySelectorAll('.wz-paso').length, hash: location.hash, abierto: document.getElementById('overlay-form').classList.contains('abierto'),
     ocultos: ['btn-whatsapp-lote', 'btn-territorios', 'btn-regeocodificar', 'btn-regeocodificar-todos', 'btn-eliminar-masivo'].every((id) => getComputedStyle(document.getElementById(id)).display === 'none'), nuevo: getComputedStyle(document.getElementById('btn-nuevo')).display !== 'none',
     fichaBotones: [...document.querySelectorAll('#lista-estructura button, .ficha button')].map((b) => b.innerText.trim()).filter((t) => /Editar|Eliminar/.test(t)) })`);
  console.log('    formulario:', JSON.stringify(fe));
  ok(fe.modoApp && fe.volver === '/app/candidato.html' && fe.volverVisible, 'el formulario va en modo app, con «← Volver a la app» hacia /app/candidato.html', fe);
  ok(fe.abierto && fe.pasos >= 4, 'el formulario paso a paso se abre solo (#nuevo)', fe);
  ok(fe.ocultos && fe.nuevo && fe.fichaBotones.length === 0, 'la pantalla NO ofrece WhatsApp en lote, gestionar territorios, re-geocodificar, eliminar registros, importar ni editar/eliminar fichas', fe);
  const malosForm = p.respuestas.filter((r) => r.status === 403 || r.status === 500).map((r) => r.status + ' ' + r.url.replace(base, ''));
  ok(malosForm.length === 0, 'el formulario carga sin ningún 403/500 de la API', malosForm);
  ok(p.avisos.length === 0, 'sin errores de consola en el formulario', p.avisos);
  await foto('11-estructura-formulario');
  // Llenar y guardar de verdad con el formulario
  await ev(`(() => { const f = document.getElementById('form-estructura'); const poner = (s, v) => { const e = f.querySelector(s); if (!e) return; e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    poner('[name=cargo]', 'coordinador'); poner('[name=numero_identificacion]', '1088000001'); poner('[name=nombre]', 'Pedro Coordinador Pantalla'); poner('[name=telefono]', '3000000010'); poner('[name=area]', 'urbano'); })()`);
  for (let i = 0; i < 4; i++) {
    await ev(`(() => { const f = document.getElementById('form-estructura'); f.querySelectorAll('select').forEach((s) => { if (!s.value && s.offsetParent !== null && s.options.length > 1) { s.value = [...s.options].find((o) => o.value)?.value || ''; s.dispatchEvent(new Event('change', { bubbles: true })); } }); })()`);
    await espera(500);
    await ev("(document.querySelector('.wz-sig') || { click() {} }).click()"); await espera(400);
  }
  await foto('11b-estructura-ultimo-paso');
  await ev("(document.getElementById('btn-guardar-estructura') || document.querySelector('.wz-pie button[type=submit]')).click()"); await espera(3000);
  const exitoUi = await ev("!!document.querySelector('.wz-exito.visible')");
  let [[viaPantalla]] = await pool.query("SELECT COUNT(*) n FROM usuarios WHERE numero_identificacion = '1088000001'");
  if (!viaPantalla.n) {
    // Algún campo del formulario por pasos no se llenó con este atajo: se guarda con la MISMA llamada que hace la pantalla, desde la propia pantalla.
    await ev(`api('/territorial/estructura', { method: 'POST', body: { nombre: 'Pedro Coordinador Pantalla', cargo: 'coordinador', numero_identificacion: '1088000001', telefono: '3000000010', area: 'urbano', territorio_id: ${await (async () => (await pool.query("SELECT id FROM territorios WHERE tipo IN ('barrio','municipio') ORDER BY tipo LIMIT 1"))[0][0].id)()}, password_confirmacion: ${JSON.stringify(CLAVE)} } })`); await espera(1000);
    console.log('    (el guardado se hizo con la llamada de la propia pantalla: el atajo de llenado no completó todos los pasos)');
  }
  [[viaPantalla]] = await pool.query("SELECT COUNT(*) n FROM usuarios WHERE numero_identificacion = '1088000001'");
  console.log('    guardado por el formulario por pasos:', exitoUi);
  ok(viaPantalla.n === 1, 'el coordinador creado desde la pantalla del celular quedó guardado', viaPantalla);
  await ev(`api('/territorial/estructura', { method: 'POST', body: { nombre: 'Lina Líder Pantalla', cargo: 'lider', numero_identificacion: '1088000002', telefono: '3000000011', area: 'urbano', territorio_id: ${await (async () => (await pool.query("SELECT id FROM territorios WHERE tipo IN ('barrio','municipio') ORDER BY tipo LIMIT 1"))[0][0].id)()}, password_confirmacion: ${JSON.stringify(CLAVE)} } })`); await espera(800);
  await foto('12-estructura-guardado');
  await ir(base + '/app/candidato-equipo.html'); await esperar("document.getElementById('lista').style.display !== 'none'");
  ok(/Pedro Coordinador Pantalla/.test(await texto('#lista')), 'el coordinador nuevo aparece en Equipo', (await texto('#lista')).slice(0, 200));
  await ev("document.querySelector('#chips [data-modo=lid]').click()"); await espera(300);
  ok(/Lina Líder Pantalla/.test(await texto('#lista')), 'y el líder nuevo también', (await texto('#lista')).slice(0, 200));

  // Cerrar sesión desde Más
  await ir(base + '/app/candidato-mas.html'); await esperar("document.getElementById('salir')");
  await ev("document.getElementById('salir').click()");
  ok(await esperar("location.pathname === '/login.html'", 10000), 'Cerrar sesión desde «Más» lleva al ingreso', await ruta());

  // Escritorio 1280
  console.log('  — Escritorio (1280 px)');
  await cmd('Network.clearBrowserCookies'); await ev("localStorage.clear(); sessionStorage.clear()");
  await escritorio();
  limpiarAvisos(); p.respuestas.length = 0;
  await ir(base + '/login.html');
  await esperar("document.getElementById('form-torre') && getComputedStyle(document.getElementById('form-torre')).display !== 'none'");
  await ev("document.getElementById('ir-a-password').click()");
  await ev(`(() => { document.getElementById('campo-email').value = ${JSON.stringify(CORREO)}; document.getElementById('campo-password').value = ${JSON.stringify(CLAVE)}; document.querySelector('#form-login button[type=submit]').click(); })()`);
  ok(await esperar("location.pathname === '/dashboard.html'", 12000), 'en 1280 px el candidato cae en /dashboard.html', await ruta());
  await espera(2500);
  const menu = await ev("[...document.querySelectorAll('#sidebar a[href], nav a[href], .sidebar a[href]')].map(a => a.getAttribute('href')).filter(h => h && !h.startsWith('#'))");
  console.log('    menú de escritorio:', JSON.stringify(menu));
  const visibles = await ev("[...document.querySelectorAll('#sidebar a[href], nav a[href], .sidebar a[href]')].filter(a => a.offsetParent !== null).map(a => a.getAttribute('href'))");
  const prohibidas = ['/votantes.html', '/finanzas.html', '/configuracion.html', '/crm.html', '/testigos.html', '/solicitudes.html', '/tareas.html', '/eventos.html', '/mapa.html', '/organigrama.html', '/dia-d.html', '/enviar-sms.html', '/enviar-email.html', '/agenda.html'];
  ok(!visibles.some((h) => prohibidas.some((x) => h.split('#')[0] === x)), 'el menú del escritorio NO muestra enlaces a pantallas que le den 403', visibles);
  ok(visibles.length > 0 && visibles.some((h) => /dashboard/.test(h)), 'y sí muestra el panel', visibles);
  const todosEnlaces = await ev("[...new Set([...document.querySelectorAll('#sidebar a[href], nav a[href], .sidebar a[href]')].map(a => a.getAttribute('href')).filter(h => h && !h.startsWith('#')))]");
  const respuestasMenu = [];
  for (const h of todosEnlaces) {
    p.respuestas.length = 0; await ir(base + h); await espera(1500);
    const malas = p.respuestas.filter((r) => r.status === 403 || r.status === 500).map((r) => r.status + ' ' + r.url.replace(base, ''));
    respuestasMenu.push({ h, malas });
  }
  ok(respuestasMenu.every((x) => x.malas.length === 0), 'cada enlace del menú de escritorio abre sin ningún 403/500 de la API', respuestasMenu.filter((x) => x.malas.length));
  console.log('    enlaces recorridos:', todosEnlaces.join(' '));
  await ir(base + '/dashboard.html'); await espera(1500); p.respuestas.length = 0; await ir(base + '/dashboard.html'); await espera(2500);
  const malos = p.respuestas.filter((r) => r.status === 403 || r.status === 500).map((r) => r.status + ' ' + r.url.replace(base, ''));
  ok(malos.length === 0, 'el panel de escritorio carga sin ningún 403/500 de la API', malos);
  ok(p.avisos.length === 0, 'sin errores de consola en el panel', p.avisos);
  const dText = await texto('body');
  ok(!/finanzas|balance/i.test(await ev("[...document.querySelectorAll('#sidebar a, nav a')].map(a=>a.innerText).join(' ')")), 'el panel de escritorio no ofrece Finanzas');
  ok(!mala(dText), 'el panel no muestra NaN/undefined');
  await foto('8-escritorio-1280' + sufijo);

  // Otros roles: a dónde van al entrar (no deben cambiar)
  if (!VACIA) {
    console.log('  — Otros roles: su destino al entrar no cambia');
    const destino = async (usuario, clave, ancho) => {
      await cmd('Network.clearBrowserCookies'); await ev("localStorage.clear(); sessionStorage.clear()");
      await (ancho === 390 ? movil() : escritorio());
      await ir(base + '/login.html');
      await ev(`(async () => { const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(usuario)}, password: ${JSON.stringify(clave)} }) }); const d = await r.json(); irDondeCorresponde(d.usuario); })()`);
      await espera(1500);
      return ruta();
    };
    ok(await destino('admin.ej@ejemplo.co', 'clave-admin-ej', 390) === '/app/admin-panel.html', 'administrador en celular → /app/admin-panel.html');
    ok(await destino('admin.ej@ejemplo.co', 'clave-admin-ej', 1280) === '/dashboard.html', 'administrador en computador → /dashboard.html');
    ok(await destino('1023456789', 'clave-correo-ej', 390) === '/app/inicio.html', 'coordinador en celular → /app/inicio.html');
    ok(await destino('1023456789', 'clave-correo-ej', 1280) === '/dashboard.html', 'coordinador en computador → /dashboard.html');
    ok(await destino('1055000001', '1055000001', 390) === '/app/inicio.html', 'líder → /app/inicio.html');
  }

  nav.cerrar(); app.s.close();
  console.log(`\n${fallos === 0 ? 'TODO BIEN' : 'HAY FALLOS'}: ${pasos - fallos} de ${pasos} comprobaciones.`);
  console.log('Capturas en ' + SALIDA);
  await pool.end();
  process.exit(fallos === 0 ? 0 : 1);
})().catch(async (e) => { console.error('Error en la prueba:', e); try { await pool.end(); } catch (_) { /* ya cerrado */ } process.exit(1); });

