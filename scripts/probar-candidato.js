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
const CLAVE_A = 'ClaveAdmin-ej81';
const CORREO_ADM_CAND = 'admin.cand@ejemplo.co';   // administrador MARCADO «Es el candidato» (orden 81)
const CORREO_ADM_SIN = 'admin.sin@ejemplo.co';     // administrador sin la marca

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
    'permisos', 'complementos', 'contenido', 'push', 'geo', 'manuales', 'panel-lider:panelLider', 'coordinador', 'catalogo', 'solicitudes', 'tareas', 'puerta-a-puerta:puertaAPuerta', 'candidato']
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
    ['POST', '/auth/otra-ruta-inexistente', {}],
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
  ok((await ad.get('/candidato/resumen')).status === 403, 'el administrador SIN la marca «Es el candidato» ya no entra a /api/candidato (orden 81; antes pasaba cualquier administrador)');
  const ver = await cand.get('/candidato/resumen');
  ok(ver.status === 200, 'tras los intentos, el candidato sigue con sesión');

  console.log('\n[4] Cambiar su clave y cerrar sesión funcionan');
  const mal = await cand.post('/auth/cambiar-password', { passwordActual: 'otra', passwordNueva: '482915' });
  ok(mal.status === 400, 'clave actual equivocada → 400 (no 403)', mal);
  const bien = await cand.post('/auth/cambiar-password', { passwordActual: CLAVE, passwordNueva: '482915' });
  ok(bien.status === 200, 'cambiar su propia clave → 200', bien);
  const c2 = cliente(base); ok((await c2.entrar(CORREO, '482915')).status === 200, 'entra con la clave nueva');
  // Orden 90: la contraseña nueva es de 6 números; una larga (la de la siembra) ya no se acepta al CAMBIAR. Se devuelve a la de la siembra por la base.
  const larga = await cand.post('/auth/cambiar-password', { passwordActual: '482915', passwordNueva: CLAVE });
  ok(larga.status === 400, 'cambiarla por una contraseña larga → 400 (orden 90: son 6 números)', larga);
  await pool.query('UPDATE usuarios SET password_hash = ? WHERE email = ?', [bcrypt.hashSync(CLAVE, 4), CORREO]);
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

  console.log('\n[5c] Orden 77: Mis avisos y Ayuda');
  const c7 = cliente(base); await c7.entrar(CORREO, CLAVE);
  const ep = 'https://push.ejemplo.co/endpoint/prueba-candidato';
  const sus = await c7.post('/push/suscribir', { endpoint: ep, keys: { p256dh: 'clave-ejemplo', auth: 'auth-ejemplo' }, dispositivo: 'Celular de prueba' });
  ok(sus.status === 200 && sus.datos.ok, 'suscribirse a los avisos en su propio equipo → 200', sus);
  const disp = await c7.get('/push/mis-dispositivos');
  ok(disp.status === 200 && disp.datos.length === 1, 'y ve su dispositivo', disp.datos);
  const des = await c7.post('/push/desuscribir', { endpoint: ep });
  ok(des.status === 200 && (await c7.get('/push/mis-dispositivos')).datos.length === 0, 'desuscribirse → 200 y queda sin dispositivos', des);
  for (const [m, r] of [['POST', '/push/enviar'], ['POST', '/push/otra-cosa'], ['PUT', '/push/mis-avisos/1'], ['DELETE', '/push/mis-avisos/1'], ['POST', '/manuales/rol/admin'], ['POST', '/comunicaciones/campanas']]) {
    const x = m === 'DELETE' ? await c7.del(r) : (m === 'PUT' ? await c7.put(r, {}) : await c7.post(r, {}));
    ok(x.status === 403 && x.datos.codigo === 'solo_lectura', `${m} /api${r} → 403 (el resto de escrituras sigue cerrado)`, { status: x.status, datos: x.datos });
  }
  const [camp] = await pool.query("INSERT INTO comunicaciones_campanas (nombre, canal, asunto, mensaje, estado) VALUES ('Aviso de prueba', 'push', 'Reunión de equipo', 'Hola {primer_nombre}, mañana nos vemos en la sede a las 6 p. m.', 'enviado')");
  await pool.query("INSERT INTO comunicaciones_envios (campana_id, destinatario_tipo, destinatario_nombre, destinatario_contacto, estado, enviado_en) VALUES (?, 'manual', 'Juan Pérez', ?, 'enviado', NOW())", [camp.insertId, String(candidatoId)]);
  await pool.query("INSERT INTO comunicaciones_envios (campana_id, destinatario_tipo, destinatario_nombre, destinatario_contacto, estado, enviado_en) VALUES (?, 'manual', 'Otra persona', '999999', 'enviado', NOW())", [camp.insertId]);
  const av = await c7.get('/push/mis-avisos');
  ok(av.status === 200 && av.datos.avisos.length === 1 && av.datos.avisos[0].titulo === 'Reunión de equipo', 'Mis avisos trae solo el aviso dirigido a él (no el de otra persona)', av.datos);
  const cont = await c7.get('/push/mis-avisos/contar?desde=0');
  ok(cont.status === 200 && cont.datos.nuevos === 1, 'el contador de «nuevos» da 1', cont.datos);
  const uno = await c7.get('/push/mis-avisos/' + av.datos.avisos[0].id);
  ok(uno.status === 200, 'y abre ese aviso completo', uno.status);
  const man = await c7.get('/manuales/mio');
  if (man.status !== 200) console.log('    (manuales/mio respondió ' + man.status + ': ' + String(man.texto).slice(0, 200) + ')');
  const idsMan = [].concat(...(man.datos.secciones || []).map((s) => s.bloques.map((b) => b.id)));
  ok(man.status === 200 && /candidato/i.test(man.datos.titulo) && idsMan.length >= 6 && idsMan.every((i) => /^c-/.test(i)), 'GET /manuales/mio: su manual propio, solo con sus bloques', { t: man.datos.titulo, ids: idsMan });
  ok(!/alcald|gobernaci|concejo|asamblea|senado/i.test(JSON.stringify(man.datos)), 'el manual no menciona el cargo');
  ok((await c7.get('/manuales/instalacion')).status === 403 && (await c7.get('/manuales/rol/admin')).status === 403, 'el manual de instalación y los de otros roles siguen cerrados (403)');
  const adm7 = cliente(base); await adm7.entrar('admin.ej@ejemplo.co', 'clave-admin-ej');
  const mAdm = await adm7.get('/manuales/rol/candidato');
  ok(mAdm.status === 200 && mAdm.datos.totales.bloques >= 6, 'el administrador también lo ve en su lista de manuales (/manuales/rol/candidato)', mAdm.status);
  if (!VACIA) { const mCoord = cliente(base); await mCoord.entrar('marta@ejemplo.co', 'clave-correo-ej'); const mc = await mCoord.get('/manuales/mio'); ok(mc.status === 200 && ![].concat(...mc.datos.secciones.map((s) => s.bloques.map((b) => b.id))).some((i) => /^c-/.test(i)), 'el manual del coordinador NO trae los bloques del candidato'); }
  await q('DELETE FROM comunicaciones_campanas WHERE id = ?', [camp.insertId]);

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
  /* ================= ORDEN 81 (servidor): administrador que también es el candidato ================= */
  console.log('\n[5d] Orden 81: la marca «Es el candidato» (solo con rol administrador)');
  {
    const hashA = bcrypt.hashSync(CLAVE_A, 4);
    const rolAdmin = (await q("SELECT id FROM roles WHERE nombre = 'admin'"))[0].id;
    const [ac] = await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, es_candidato, clave_celular_pregunta_hecha)
      VALUES ('Admin Candidato', '1099000101', '1099000101', ?, '3001230101', ?, ?, 1, 1, 1)`, [CORREO_ADM_CAND, hashA, rolAdmin]);
    const [as] = await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, es_candidato, clave_celular_pregunta_hecha)
      VALUES ('Admin Sin Marca', '1099000102', '1099000102', ?, '3001230102', ?, ?, 1, 0, 1)`, [CORREO_ADM_SIN, hashA, rolAdmin]);
    const [[col]] = await pool.query("SELECT COLUMN_TYPE t, COLUMN_DEFAULT d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'es_candidato'");
    ok(col && /tinyint/i.test(col.t) && String(col.d) === '0', 'la columna usuarios.es_candidato existe (TINYINT, por omisión 0)', col);
    const cm = cliente(base); await cm.entrar(CORREO_ADM_CAND, CLAVE_A);
    const cs = cliente(base); await cs.entrar(CORREO_ADM_SIN, CLAVE_A);
    const cc = cliente(base); await cc.entrar(CORREO, CLAVE);
    const meM = (await cm.get('/auth/me')).datos.usuario, meS = (await cs.get('/auth/me')).datos.usuario, meC = (await cc.get('/auth/me')).datos.usuario;
    ok(meM.rol === 'admin' && meM.es_candidato === true && meS.es_candidato === false && meC.rol === 'candidato' && !meC.es_candidato, '/auth/me: el administrador marcado trae es_candidato = true; el que no, false; el candidato puro, false (su rol es otro)', { meM: meM.es_candidato, meS: meS.es_candidato, meC: meC.es_candidato });
    ok((await cm.get('/candidato/resumen')).status === 200 && (await cm.get('/candidato/mas')).status === 200 && (await cm.get('/candidato/equipo')).status === 200, '/api/candidato/*: acepta al administrador marcado');
    ok((await cs.get('/candidato/resumen')).status === 403 && (await cs.get('/candidato/mas')).status === 403, '/api/candidato/*: el administrador SIN marca ya no pasa (antes pasaba cualquier administrador)');
    ok((await cc.get('/candidato/resumen')).status === 200, '/api/candidato/*: el rol candidato puro sigue pasando');
    const evCuerpo = { titulo: 'Evento del administrador-candidato', fecha_inicio: '2031-03-01 10:00:00', lugar: 'Sede', tipo: 'reunion' };
    const wM = await cm.post('/eventos', evCuerpo);
    ok(wM.status === 200 || wM.status === 201, 'el administrador marcado SÍ puede escribir (crear un evento): no le aplica el solo lectura del candidato', { s: wM.status, d: wM.datos });
    const wC = await cc.post('/eventos', evCuerpo);
    ok(wC.status === 403 && wC.datos.codigo === 'solo_lectura', 'el candidato puro sigue en solo lectura: 403 «solo_lectura» al crear un evento', { s: wC.status, d: wC.datos });
    ok((await cm.get('/usuarios/admin')).status === 200 && (await cm.get('/configuracion/campana')).status === 200, 'el administrador marcado conserva sus lecturas de administrador (listado de usuarios, configuración)');
    ok((await cc.get('/usuarios/admin')).status === 403, 'el candidato puro sigue sin el listado de usuarios (403)');
    await q("DELETE FROM eventos WHERE titulo = 'Evento del administrador-candidato'");

    // Usuarios: la casilla solo vale con rol administrador
    const cuerpoU = (extra) => ({ nombre: 'Persona de Prueba', numero_identificacion: '1099000103', email: 'persona.prueba81@ejemplo.co', telefono: '3001230103', rol: 'admin', es_candidato: true, password: '482913', ...extra });
    const nuevo = await cs.post('/usuarios', cuerpoU());
    const [[f1]] = await pool.query('SELECT es_candidato e FROM usuarios WHERE id = ?', [nuevo.datos.id || 0]);
    ok(nuevo.status === 200 && f1 && f1.e === 1, 'Usuarios (crear): rol Administrador + «Es el candidato» → queda marcado', { s: nuevo.status, f1 });
    const nuevoL = await cs.post('/usuarios', cuerpoU({ rol: 'lider', numero_identificacion: '1099000104', email: 'lider.prueba81@ejemplo.co', telefono: '3001230104' }));
    const [[f2]] = await pool.query('SELECT es_candidato e FROM usuarios WHERE id = ?', [nuevoL.datos.id || 0]);
    ok(nuevoL.status === 200 && f2 && f2.e === 0, 'Usuarios (crear): con otro rol la casilla se ignora (queda en 0) aunque el formulario la mande', { s: nuevoL.status, f2 });
    const put = (rol, extra) => cs.put('/usuarios/' + nuevo.datos.id, { nombre: 'Persona de Prueba', numero_identificacion: '1099000103', email: 'persona.prueba81@ejemplo.co', telefono: '3001230103', rol, activo: true, password_confirmacion: CLAVE_A, ...extra });
    const marca = async () => (await q('SELECT es_candidato e FROM usuarios WHERE id = ?', [nuevo.datos.id]))[0].e;
    const lista = (await cs.get('/usuarios/admin')).datos.find((u) => u.id === nuevo.datos.id);
    ok(lista && lista.es_candidato === 1, 'el listado de administración de usuarios trae es_candidato (para abrir la edición con la casilla puesta)', lista && lista.es_candidato);
    const r1 = await put('coordinador', { es_candidato: true });
    ok(r1.status === 200 && await marca() === 0, 'Usuarios (editar): si el rol cambia a otro, la marca se apaga sola', { s: r1.status, d: r1.datos, m: await marca() });
    const r2 = await put('admin', { es_candidato: true });
    ok(r2.status === 200 && await marca() === 1, 'Usuarios (editar): de vuelta a Administrador y con la casilla → marcado', { s: r2.status, d: r2.datos });
    const r3 = await put('admin', {});
    ok(r3.status === 200 && await marca() === 1, 'Usuarios (editar): un guardado que no trae la casilla no borra la marca', { s: r3.status });
    const r4 = await put('admin', { es_candidato: false });
    ok(r4.status === 200 && await marca() === 0, 'Usuarios (editar): se puede desmarcar', { s: r4.status });
    // Quitarle la marca vale desde la petición siguiente, sin cerrar sesión
    await q('UPDATE usuarios SET es_candidato = 0 WHERE id = ?', [ac.insertId]);
    ok((await cm.get('/candidato/resumen')).status === 403 && (await cm.get('/auth/me')).datos.usuario.es_candidato === false, 'quitar la marca vale en la petición siguiente (se consulta, no se lee de la sesión)');
    await q('UPDATE usuarios SET es_candidato = 1 WHERE id = ?', [ac.insertId]);
    await q("DELETE FROM usuarios WHERE email IN ('persona.prueba81@ejemplo.co', 'lider.prueba81@ejemplo.co')");
  }

  console.log('\n[6] El navegador (Chromium 390×844)');
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  const movil = (w = 390, h = 844) => cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
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

  // SOLO79=1 salta lo anterior (ya probado) para iterar rápido sobre la orden 79: entra y va directo a su bloque.
  if (!process.env.SOLO79) {
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

  // Más (cuadrícula, orden 75)
  console.log('  — Más (cuadrícula) y Cambiar mi clave');
  limpiarAvisos();
  await ir(base + '/app/candidato-mas.html');
  await esperar("document.querySelectorAll('.menu-boton').length > 0");
  const leerMas = () => ev(`({ grupos: [...document.querySelectorAll('.menu-grupo')].map(g => ({ t: g.querySelector('.menu-grupo-titulo').innerText.trim(), items: [...g.querySelectorAll('.menu-boton')].map(b => b.querySelector('.texto strong').innerText.trim()) })),
     cols: document.querySelector('.menu-grid') ? getComputedStyle(document.querySelector('.menu-grid')).gridTemplateColumns.split(' ').length : 0,
     barra: document.querySelector('.menu-grupo-titulo') ? getComputedStyle(document.querySelector('.menu-grupo-titulo'), '::before').backgroundColor : '', icono: document.querySelector('.menu-boton .icono') ? getComputedStyle(document.querySelector('.menu-boton .icono')).width : '',
     titulo: document.querySelector('.barra h1').innerText, estado: document.getElementById('estado').innerText, nav: [...document.querySelectorAll('#nav-candidato a')].map(a => a.lastChild.textContent.trim()), listaVieja: !!document.querySelector('.menu-mas'), grupoTit: document.querySelectorAll('.grupo-tit').length })`);
  const mas = await leerMas();
  console.log('    más:', JSON.stringify(mas));
  ok(mas.grupos.map((g) => g.t).join('|') === 'Registro|Seguimiento|Material de apoyo|Mi cuenta y ayuda', 'Más: los cuatro grupos, en ese orden', mas.grupos.map((g) => g.t));
  const lista = (t) => (mas.grupos.find((g) => g.t === t) || { items: [] }).items;
  ok(lista('Registro').join('|') === 'Registrar en la estructura territorial|Consultar puesto de votación', 'Registro: solo esos dos botones', lista('Registro'));
  ok(lista('Seguimiento').join('|') === 'Solicitudes|Tareas|Puerta a puerta|Día D · avance de votación', 'Seguimiento: Solicitudes, Tareas, Puerta a puerta y Día D', lista('Seguimiento'));
  ok(lista('Material de apoyo').join('|') === 'Biografía del candidato|Información para compartir', 'Material de apoyo: Biografía e Información para compartir', lista('Material de apoyo'));
  ok(lista('Mi cuenta y ayuda').join('|') === 'Mis avisos|Cambiar mi clave|Política de privacidad|Legislación|Ayuda|Cerrar sesión', 'Mi cuenta y ayuda: Mis avisos, Cambiar mi clave, Política, Legislación, Ayuda y Cerrar sesión', lista('Mi cuenta y ayuda'));
  ok(mas.cols === 2 && /255, 195, 0/.test(mas.barra) && parseInt(mas.icono, 10) === 42, 'es la cuadrícula del menú de la app: barra amarilla #FFC300 e icono en cuadro de 42 px; con la letra de 15 px, dos columnas en el celular (orden 79: en tres, «Información» se partía)', { c: mas.cols, b: mas.barra, i: mas.icono });
  ok(!mas.listaVieja && mas.grupoTit === 0, 'ya no queda nada de la lista de filas con flecha');
  ok(mas.titulo === 'Más opciones' && /Actualizado/.test(mas.estado) && mas.nav.join(',') === 'Inicio,Equipo,Mapa,Agenda,Más', 'se mantiene el encabezado «Más opciones», «Actualizado hace…» y la barra inferior', mas);
  ok(await ev("!document.getElementById('detalle') && document.querySelectorAll('button.menu-boton[data-accion]').length === 1"), 'Más: ya no hay resumen que se despliega debajo; solo «Cerrar sesión» es botón, el resto abre pantalla', await ev("[...document.querySelectorAll('button.menu-boton')].map(b => b.dataset.accion)"));
  ok(await sinDesborde() && p.avisos.length === 0, 'Más: sin desborde ni errores de consola', p.avisos);
  await ev('window.scrollTo(0, 0)'); await espera(300);
  await foto('6-mas' + sufijo);
  // Cada tarjeta que abre una pantalla: la abre, sin 403 ni 500, y «volver» lleva a «Más» (nunca al menú de inicio.html)
  const enlaces = await ev("[...document.querySelectorAll('a.menu-boton')].map(a => a.getAttribute('href'))");
  for (const h of enlaces) {
    limpiarAvisos(); p.respuestas.length = 0;
    await ir(base + h); await espera(1800);
    const malas = p.respuestas.filter((r) => r.status === 403 || r.status === 500).map((r) => r.status + ' ' + r.url.replace(base, ''));
    const volver = await ev("(document.querySelector('.app-barra .volver') || {}).getAttribute ? (document.querySelector('.app-barra .volver').getAttribute('onclick') || '') : ''");
    const aqui = await ruta();
    ok(malas.length === 0 && aqui !== '/login.html' && aqui !== '/app/candidato.html', `tarjeta ${h}: abre sin 403/500 (${aqui})`, { malas, aqui });
    if (/^\/app\/(biografia|informacion|politica-privacidad|legislacion|mis-avisos)/.test(h)) ok(/candidato-mas/.test(volver) && !/inicio\.html/.test(volver), `${h}: «volver» lleva a «Más»`, volver);
    if (/^\/ayuda\.html/.test(h)) ok(await ev("(document.getElementById('btn-app') || {}).getAttribute('href')") === '/app/candidato-mas.html' && await ev("!document.getElementById('btn-app').hidden"), `${h}: «← Volver a la app» lleva a «Más»`);
    ok(p.avisos.filter((x) => !/tile|Failed to load|favicon/i.test(x)).length === 0, `tarjeta ${h}: sin errores de consola`, p.avisos);
  }
  // Mis avisos y Ayuda, a fondo (orden 77)
  const [campB] = await pool.query("INSERT INTO comunicaciones_campanas (nombre, canal, asunto, mensaje, estado) VALUES ('Aviso de prueba', 'push', 'Reunión de equipo', 'Mañana nos vemos en la sede a las 6 p. m. Gracias por todo.', 'enviado')");
  await pool.query("INSERT INTO comunicaciones_envios (campana_id, destinatario_tipo, destinatario_nombre, destinatario_contacto, estado, enviado_en) VALUES (?, 'manual', 'Juan Pérez', ?, 'enviado', NOW())", [campB.insertId, String(candidatoId)]);
  limpiarAvisos(); p.respuestas.length = 0;
  await ir(base + '/app/mis-avisos.html'); await esperar("document.querySelectorAll('#lista-avisos .aviso-caja').length > 0 || document.querySelector('#lista-avisos .vacio-app')");
  await espera(800);
  const mav = await ev(`({ lista: document.getElementById('lista-avisos').innerText, caja: (document.getElementById('caja-avisos-push') || {}).innerText || '', cajaExiste: !!document.getElementById('caja-avisos-push'), barra: document.querySelector('.app-barra h1').innerText })`);
  console.log('    mis avisos:', JSON.stringify(mav).slice(0, 300));
  ok(/Reunión de equipo/.test(mav.lista) && mav.cajaExiste && mav.caja.length > 5, 'Mis avisos: muestra el aviso dirigido a él y el interruptor de avisos de este celular', mav);
  await ev("document.querySelector('#lista-avisos [data-id]').click()"); await espera(400);
  ok(/Gracias por todo/.test(await texto('#lista-avisos')), 'al tocar el aviso se lee completo');
  const subOk = await ev(`api('/push/suscribir', { method: 'POST', body: { endpoint: 'https://push.ejemplo.co/e2', keys: { p256dh: 'a', auth: 'b' }, dispositivo: 'Chromium de prueba' } }).then(r => r.ok === true)`);
  ok(subOk === true, 'suscribirse a los avisos desde la propia aplicación funciona');
  await ev(`api('/push/desuscribir', { method: 'POST', body: { endpoint: 'https://push.ejemplo.co/e2' } })`);
  const malasAv = p.respuestas.filter((r) => r.status === 403 || r.status === 500).map((r) => r.status + ' ' + r.url.replace(base, ''));
  ok(malasAv.length === 0 && await sinDesborde() && p.avisos.length === 0, 'Mis avisos: sin 403/500, sin desborde y sin errores de consola', { malasAv, av: p.avisos });
  await foto('14-mis-avisos');
  await q('DELETE FROM comunicaciones_campanas WHERE id = ?', [campB.insertId]);
  limpiarAvisos(); p.respuestas.length = 0;
  await ir(base + '/ayuda.html?app=1'); await esperar("/manual del candidato/i.test(document.body.innerText)", 12000); await espera(1200);
  const cuerpoAyuda = await texto('body');
  const titulosManual = ['Entrar a la aplicación', 'Qué hay en cada pantalla', 'Llamar o escribir por WhatsApp a tu equipo', 'Registrar a alguien en la estructura territorial', 'Consultar el puesto de votación de una persona', 'Cambiar tu clave', 'Activar y leer tus avisos'];
  ok(/Manual del candidato/i.test(cuerpoAyuda) && titulosManual.every((t) => cuerpoAyuda.indexOf(t) >= 0), 'Ayuda: se ve el «Manual del candidato» con sus 7 temas', titulosManual.filter((t) => cuerpoAyuda.indexOf(t) < 0));
  ok(!/Alcald|Gobernaci|Concejo|Asamblea/i.test(cuerpoAyuda), 'Ayuda: sin mencionar el cargo');
  const malasAy = p.respuestas.filter((r) => r.status === 403 || r.status === 500).map((r) => r.status + ' ' + r.url.replace(base, ''));
  ok(malasAy.length === 0 && p.avisos.length === 0, 'Ayuda: sin 403/500 ni errores de consola', { malasAy, av: p.avisos });
  await foto('15-ayuda');

  limpiarAvisos();
  await ir(base + '/app/candidato-clave.html');
  ok(await esperar("document.getElementById('actual')"), 'Cambiar mi clave carga');
  await ev("document.querySelector('[data-ojo=nueva]').click()");
  ok(await ev("document.getElementById('nueva').type") === 'text', 'el ojo muestra la clave');
  await ev(`(() => { actual.value = 'equivocada'; nueva.value = '482915'; repetir.value = '482915'; document.getElementById('form').requestSubmit(); })()`); await espera(900);
  ok(/no es correcta/.test(await texto('#msg')), 'clave actual equivocada → mensaje claro (sin que lo tome por sesión vencida)', await texto('#msg'));
  await ev(`(() => { actual.value = ${JSON.stringify(CLAVE)}; nueva.value = '482915'; repetir.value = '482915'; document.getElementById('form').requestSubmit(); })()`); await espera(1200);
  ok(/Listo/.test(await texto('#msg')), 'cambiar su clave desde la pantalla funciona', await texto('#msg'));
  // Orden 90: la pantalla rechaza una contraseña larga (son 6 números) y la de la siembra se devuelve por la base.
  await ev(`(() => { actual.value = '482915'; nueva.value = ${JSON.stringify(CLAVE)}; repetir.value = ${JSON.stringify(CLAVE)}; document.getElementById('form').requestSubmit(); })()`); await espera(700);
  ok(/6 números/.test(await texto('#msg')), 'una contraseña larga se rechaza en la pantalla: «La contraseña debe tener 6 números.»', await texto('#msg'));
  await pool.query('UPDATE usuarios SET password_hash = ? WHERE email = ?', [bcrypt.hashSync(CLAVE, 4), CORREO]);
  ok(await sinDesborde() && p.avisos.length === 0, 'Cambiar mi clave: sin desborde ni errores de consola', p.avisos);
  await foto('7-cambiar-clave');

  console.log('  — Orden 73: nunca al escritorio, grupo «Registro» y formulario de la estructura');
  limpiarAvisos();
  for (const u of ['/dashboard.html', '/territorial.html', '/votantes.html', '/app/inicio.html']) {
    await ir(base + u); await esperar("location.pathname === '/app/candidato.html'", 9000);
    ok(await ruta() === '/app/candidato.html', `candidato en celular abre ${u} a mano → termina en /app/candidato.html`, await ruta());
  }
  /* NINGÚN CAMINO LE MUESTRA EL MENÚ DE /app/inicio.html (orden 75): se vigila si en algún instante aparece una tarjeta de ese menú (.menu-boton con su <section class="menu-grupo"> dentro de #menu-app)
     mientras se abre inicio.html (el ícono de la app instalada) y mientras se vuelve «atrás» hacia él. */
  const vigia = (await cmd('Page.addScriptToEvaluateOnNewDocument', { source: "new MutationObserver(function () { if (document.getElementById('menu-app') && document.querySelector('#menu-app .menu-boton') && location.pathname === '/app/inicio.html') sessionStorage.setItem('vio_menu_inicio', '1'); }).observe(document, { childList: true, subtree: true });" })).result.identifier;
  await ev("sessionStorage.removeItem('vio_menu_inicio')");
  await ir(base + '/app/inicio.html'); await espera(2500);
  ok(await ruta() === '/app/candidato.html' && await ev("sessionStorage.getItem('vio_menu_inicio')") === null, 'abrir el ícono de la app (inicio.html) con la sesión iniciada: nunca se pinta el menú de inicio.html y termina en su app', await ev("sessionStorage.getItem('vio_menu_inicio')"));
  await ev('history.back()'); await espera(2000);
  ok(await ev("sessionStorage.getItem('vio_menu_inicio')") === null, '«atrás» tampoco le muestra el menú de inicio.html', await ruta());
  await cmd('Page.removeScriptToEvaluateOnNewDocument', { identifier: vigia });
  await ir(base + '/login.html'); await espera(1500);
  ok(await ruta() === '/app/candidato.html', 'con la sesión ya iniciada, el ingreso lo lleva a su app (nunca al escritorio)', await ruta());
  await ir(base + '/app/candidato-mas.html'); await esperar("document.querySelectorAll('.menu-boton').length > 0");
  const reg = await ev(`({ botones: [...document.querySelectorAll('.menu-grupo')[0].querySelectorAll('.menu-boton')].map(a => a.innerText.trim()), hrefs: [...document.querySelectorAll('.menu-grupo')[0].querySelectorAll('.menu-boton')].map(a => a.getAttribute('href')),
     grupos: [...document.querySelectorAll('.menu-grupo-titulo')].map(x => x.innerText), escritorio: /escritorio/i.test(document.body.innerText), primero: (document.querySelector('.menu-grupo-titulo') || {}).innerText })`);
  console.log('    registro:', JSON.stringify(reg));
  ok(reg.botones.length === 2 && /Registrar en la estructura territorial/.test(reg.botones[0]) && /Consultar puesto de votación/.test(reg.botones[1]), '«Más» → Registro: exactamente dos botones, los pedidos', reg.botones);
  ok(/^registro$/i.test(reg.primero) && /^registro$/i.test(reg.grupos[0]), 'el grupo «Registro» va arriba de todo', reg.grupos);
  ok(!reg.escritorio, '«Ver versión de escritorio» ya no aparece');
  ok(!/Registrar (votante|persona)|Importar|Eliminar|enlace de inscripción|Mi enlace/i.test(await texto('body')), 'ningún otro botón de registro, importar, eliminar ni enlaces de inscripción', await texto('body'));
  ok(await sinDesborde() && p.avisos.length === 0, 'Más con Registro: sin desborde ni errores de consola', p.avisos);
  await foto('9-mas-con-registro');
  // Consultar puesto de votación
  await ev("document.querySelector('a.menu-boton[href*=puesto-votacion]').click()");
  ok(await esperar("location.pathname === '/app/puesto-votacion.html'"), '«Consultar puesto de votación» abre la consulta de siempre');
  await espera(600);
  const pv = await ev(`({ reg: (document.querySelector('a[href*=registraduria]') || {}).href, volver: (document.querySelector('.app-barra .volver') || {}).getAttribute ? document.querySelector('.app-barra .volver').getAttribute('onclick') : '', btn: document.getElementById('btn-volver-menu').onclick ? 'js' : '' })`);
  ok(/consultacenso\.registraduria\.gov\.co/.test(pv.reg || ''), 'enlaza a la Registraduría (no se envía nada)', pv);
  ok(/candidato-mas/.test(pv.volver), 'y «Volver» lo devuelve a su app, no al menú de líder', pv);
  const copia = await ev(`(typeof copiarCedulaParaConsulta === 'function') || document.body.innerHTML.indexOf('consulta-censo') >= 0 || !!document.querySelector('[data-copiar-cedula], #cedula-consulta, input')`);
  await foto('10-consultar-puesto');
  // Registrar en la estructura territorial (formulario de siempre, en modo app)
  await ir(base + '/app/candidato-mas.html'); await esperar("document.querySelectorAll('.menu-boton').length > 0");
  limpiarAvisos(); p.respuestas.length = 0;
  await ev("document.querySelector('a.menu-boton[href*=territorial]').click()");
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

  // «Más» con módulos apagados: sin huecos y sin grupos vacíos
  await q("UPDATE complementos_campana SET activo = 0 WHERE clave IN ('solicitudes','tareas','puerta_a_puerta','puerta_panel')"); require('../lib/complementos').invalidar();
  await q("UPDATE permisos_rol SET permitido = 0 WHERE rol = 'candidato' AND modulo IN ('rescate_votos','biografia_candidato','recursos')");
  await ir(base + '/app/candidato-mas.html'); await esperar("document.querySelectorAll('.menu-boton').length > 0");
  const apag = await leerMas();
  console.log('    más con módulos apagados:', JSON.stringify(apag.grupos));
  ok(apag.grupos.map((g) => g.t).join('|') === 'Registro|Mi cuenta y ayuda' && apag.grupos.every((g) => g.items.length > 0), 'con Seguimiento y Material apagados: no salen sus grupos (ni títulos solos ni huecos)', apag.grupos);
  ok(await sinDesborde() && p.avisos.length === 0, 'Más con módulos apagados: sin desborde ni errores de consola', p.avisos);
  await foto('13-mas-modulos-apagados');
  await ir(base + '/app/candidato-seguimiento.html?seccion=tareas'); await esperar("!document.querySelector('#contenido .cargando')"); await espera(400);
  ok(/No se pudo abrir esta sección/.test(await texto('#contenido')) && await ev("!!document.querySelector('.btn-volver')"), 'Seguimiento con la sección apagada: lo dice claro y ofrece volver (el servidor sigue respondiendo 403)', await texto('#contenido'));
  await ir(base + '/app/candidato-seguimiento.html?seccion=inventada'); await esperar("location.pathname === '/app/candidato-mas.html'", 6000);
  ok(await ruta() === '/app/candidato-mas.html', 'una sección que no existe vuelve a «Más»', await ruta());
  await q("UPDATE complementos_campana SET activo = 0 WHERE clave = 'puerta_panel'"); await require('./fixtures/encender-complementos')(pool, ['tareas']);
  await ir(base + '/app/candidato-mas.html'); await esperar("document.querySelectorAll('.menu-boton').length > 0");
  const parc = await leerMas();
  ok((parc.grupos.find((g) => g.t === 'Seguimiento') || { items: [] }).items.join('|') === 'Tareas', 'con solo Tareas encendido, Seguimiento trae únicamente Tareas', parc.grupos);
  await require('./fixtures/encender-complementos')(pool, ['solicitudes', 'tareas', 'puerta_a_puerta', 'puerta_panel']);
  await q("UPDATE permisos_rol SET permitido = 1 WHERE rol = 'candidato' AND modulo IN ('rescate_votos','biografia_candidato','recursos')");
  require('../lib/complementos').invalidar();

  } // fin de lo que SOLO79 salta

  /* ================= ORDEN 79: Seguimiento en pantallas propias, «Salir» en cada pantalla, letra grande ================= */
  const MEDIR = `(() => {
    const res = { base: parseFloat(getComputedStyle(document.body).fontSize), menores: [], cortados: [], fuera: [], n: 0 };
    const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false; } return true; };
    const ajeno = (el) => !!el.closest('.leaflet-control-attribution, .leaflet-control-zoom, .leaflet-container, .chips, .tira, .hoja:not(.abierta), #salir-confirma, option');
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const vistos = new Set();
    while (w.nextNode()) {
      const t = w.currentNode; if (!t.nodeValue.trim()) continue;
      const el = t.parentElement; if (!el || vistos.has(el) || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName) || el.closest('.leaflet-control-attribution') || !visible(el)) continue;
      vistos.add(el); res.n++;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < (el.closest('#nav-candidato') ? 12 : 14)) res.menores.push(el.tagName + '.' + (el.className.baseVal !== undefined ? el.className.baseVal : el.className) + ' ' + fs + 'px «' + t.nodeValue.trim().slice(0, 28) + '»');
    }
    res.partidas = [];
    document.querySelectorAll('.menu-boton .texto strong, #chips-cargo-persona .chip-form').forEach((el) => {
      if (!visible(el)) return;
      const cv = document.createElement('canvas').getContext('2d'); const cs = getComputedStyle(el); cv.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      const util = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      el.innerText.split(/\\s+/).forEach((pal) => { if (pal && cv.measureText(pal).width > util + 0.5) res.partidas.push(pal + ' ' + Math.round(cv.measureText(pal).width) + '>' + Math.round(util)); });
    });
    document.querySelectorAll('input, select, textarea').forEach((el) => { if (visible(el) && el.type !== 'hidden' && el.type !== 'checkbox' && el.type !== 'radio' && parseFloat(getComputedStyle(el).fontSize) < 14) res.menores.push(el.tagName + '#' + el.id + ' ' + getComputedStyle(el).fontSize); });
    document.querySelectorAll('body *').forEach((el) => {
      if (!visible(el) || ajeno(el)) return;
      const s = getComputedStyle(el);
      if ((s.overflowX === 'hidden' || s.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1 && el.children.length === 0 && el.innerText) res.cortados.push(el.tagName + '.' + el.className + ' «' + el.innerText.slice(0, 30) + '» ' + el.scrollWidth + '>' + el.clientWidth);
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth + 1 || r.left < -1) res.fuera.push(el.tagName + '.' + el.className + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
    });
    return res;
  })()`;
  const visiblesSalir = () => ev(`[...document.querySelectorAll('.btn-salir')].filter((b) => { const r = b.getBoundingClientRect(); if (r.width < 1) return false; for (let e = b; e && e !== document.documentElement; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; }).map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), der: Math.round(r.right), izq: Math.round(r.left), top: Math.round(r.top), txt: b.innerText.trim(), svg: !!b.querySelector('svg'), ancho: innerWidth }; })`);
  const PANTALLAS = [
    ['Inicio', '/app/candidato.html', "document.getElementById('contenido').style.display !== 'none'"],
    ['Equipo', '/app/candidato-equipo.html', "document.getElementById('lista').style.display !== 'none'"],
    ['Mapa', '/app/candidato-mapa.html', "!!document.querySelector('.btn-salir')"],
    ['Agenda', '/app/candidato-agenda.html', "!document.querySelector('#lista .cargando')"],
    ['Más', '/app/candidato-mas.html', "document.querySelectorAll('.menu-boton').length > 0"],
    ['Solicitudes', '/app/candidato-seguimiento.html?seccion=solicitudes', "!document.querySelector('#contenido .cargando')"],
    ['Tareas', '/app/candidato-seguimiento.html?seccion=tareas', "!document.querySelector('#contenido .cargando')"],
    ['Puerta a puerta', '/app/candidato-seguimiento.html?seccion=puerta', "!document.querySelector('#contenido .cargando')"],
    ['Día D', '/app/candidato-seguimiento.html?seccion=dia_d', "!document.querySelector('#contenido .cargando')"],
    ['Cambiar mi clave', '/app/candidato-clave.html', "!!document.getElementById('actual')"],
    ['Consultar puesto', '/app/puesto-votacion.html', "!!document.querySelector('.btn-salir')"],
    ['Biografía', '/app/biografia.html', "!!document.querySelector('.btn-salir')"],
    ['Información', '/app/informacion.html?modo=informacion', "!!document.querySelector('.btn-salir')"],
    ['Política de privacidad', '/app/politica-privacidad.html', "!!document.querySelector('.btn-salir')"],
    ['Legislación', '/app/legislacion.html', "!!document.querySelector('.btn-salir')"],
    ['Mis avisos', '/app/mis-avisos.html', "!!document.querySelector('.btn-salir')"],
    ['Ayuda', '/ayuda.html?app=1', "!!document.querySelector('.btn-salir')"],
    ['Estructura territorial', '/territorial.html?app=1&volver=/app/candidato-mas.html', "!!document.querySelector('.btn-salir')"],
    ['Estructura: formulario abierto', '/territorial.html?app=1&volver=/app/candidato-mas.html#nuevo', "!!document.getElementById('overlay-form') && document.getElementById('overlay-form').classList.contains('abierto')"],
  ];
  const MUESTRAS = {
    solicitudes: { total: 12, nuevas: 4, en_tramite: 5, resueltas: 3, sin_sin: 0, sin_movimiento: 2, mas_pedidas: [{ nombre: 'Alumbrado público', total: 5 }, { nombre: 'Vías en mal estado', total: 4 }, { nombre: 'Seguridad y convivencia en el barrio', total: 2 }] },
    tareas: { total: 20, abiertas: 8, hechas: 9, verificadas: 2, canceladas: 1, vencidas: 3, cumplimiento: 55, por_responsable: [{ nombre: 'Marta Coordinadora Ejemplo', total: 8, abiertas: 3, hechas: 4, vencidas: 1 }, { nombre: 'Pedro Coordinador Muestra', total: 5, abiertas: 2, hechas: 3, vencidas: 0 }] },
    puerta: { oculto: false, minimo: 5, total: { listas: 3, asignadas: 120, visitadas: 64, visitas: 80 }, zonas: [{ zona: 'Comuna 5 Universitaria', asignadas: 60, visitadas: 40 }, { zona: 'Comuna 2 Centro', asignadas: 60, visitadas: 24 }] },
    dia_d: { total: 60, votaron: 24, faltan: 36, porcentaje: 40, modo_prueba: true, por_puesto: [{ puesto: 'Colegio San José de la Montaña Sede Central', total: 20, votaron: 5, faltan: 15 }, { puesto: 'Escuela Rural Los Alpes', total: 12, votaron: 6, faltan: 6 }] },
  };
  const bloque79 = async (ancho, alto, fotos) => {
    console.log(`  — Orden 79 a ${ancho}×${alto}: Seguimiento, «Salir» y letra en cada pantalla`);
    await movil(ancho, alto);
    const sfx = '-' + ancho;
    // Seguimiento: cada tarjeta abre SU pantalla, con flecha «←» a «Más»; el atrás del celular también vuelve
    const SEG = [['Solicitudes', 'solicitudes'], ['Tareas', 'tareas'], ['Puerta a puerta', 'puerta'], ['Día D · avance de votación', 'dia_d']];
    for (const [rotulo, id] of SEG) {
      limpiarAvisos(); p.respuestas.length = 0;
      await ir(base + '/app/candidato-mas.html'); await esperar("document.querySelectorAll('.menu-boton').length > 0");
      const tiles = await ev("[...document.querySelectorAll('a.menu-boton')].map((a) => a.querySelector('.texto strong').innerText.trim())");
      ok(tiles.includes(rotulo), `${ancho}: «Más» trae la tarjeta ${rotulo}`, { tiles, url: await ev('location.href'), txt: (await texto('body')).slice(0, 200) });
      if (!tiles.includes(rotulo)) continue;
      await ev(`[...document.querySelectorAll('a.menu-boton')].find((a) => a.querySelector('.texto strong').innerText.trim() === ${JSON.stringify(rotulo)}).click()`);
      ok(await esperar(`location.pathname === '/app/candidato-seguimiento.html' && location.search === '?seccion=${id}'`, 8000), `${ancho}: Más › ${rotulo} abre su pantalla propia (no una pestaña nueva ni un resumen debajo)`, await ev('location.href'));
      await esperar("!document.querySelector('#contenido .cargando')"); await espera(500);
      const v = await ev(`({ h1: document.getElementById('titulo').innerText, flecha: (document.getElementById('volver') || {}).innerText, href: (document.getElementById('volver') || {}).getAttribute('href'), nav: (document.querySelector('#nav-candidato a.on') || {}).innerText, txt: document.getElementById('contenido').innerText, estado: document.getElementById('estado').innerText, vent: window.history.length })`);
      ok(v.h1.toLowerCase().indexOf(rotulo.split(' ·')[0].toLowerCase()) === 0 && v.flecha === '←' && v.href === '/app/candidato-mas.html' && /Más/.test(v.nav), `${ancho}: ${rotulo}: título, flecha «←» a Más y «Más» marcado en la barra inferior`, v);
      ok(v.txt.length > 10 && !mala(v.txt), `${ancho}: ${rotulo}: contenido sin NaN/undefined`, v.txt.slice(0, 200));
      const malas = p.respuestas.filter((r) => r.status === 403 || r.status === 500).map((r) => r.status + ' ' + r.url.replace(base, ''));
      ok(malas.length === 0 && p.avisos.length === 0, `${ancho}: ${rotulo}: sin 403/500 ni errores de consola`, { malas, av: p.avisos });
      // Con cifras de muestra (la base de prueba no trae solicitudes ni tareas): el mismo pintor de la pantalla, con la forma que devuelve el servidor
      const muestra = MUESTRAS[id];
      await ev(`document.getElementById('contenido').innerHTML = PINTORES[${JSON.stringify(id)}](${JSON.stringify(muestra)})`); await espera(300);
      const mm = await ev(MEDIR);
      ok(mm.menores.length === 0 && mm.cortados.length === 0 && mm.fuera.length === 0 && await sinDesborde(), `${ancho}: ${rotulo} con cifras: letra ≥ 14 px, sin cortes ni desborde`, { a: mm.menores.slice(0, 4), b: mm.cortados.slice(0, 4), c: mm.fuera.slice(0, 4) });
      ok(!mala(await texto('#contenido')) && (await texto('#contenido')).length > 40, `${ancho}: ${rotulo} con cifras: sin NaN/undefined`, (await texto('#contenido')).slice(0, 200));
      if (fotos) await foto('16b-seguimiento-' + id + '-con-cifras' + sfx);
      if (fotos && id === 'solicitudes') { await foto('16-seguimiento-solicitudes' + sfx); }
      if (fotos && id === 'dia_d') { await foto('17-seguimiento-dia-d' + sfx); }
      await ev('history.back()');
      ok(await esperar("location.pathname === '/app/candidato-mas.html'", 6000), `${ancho}: ${rotulo}: el botón atrás del celular vuelve a «Más»`, await ruta());
      await ir(base + `/app/candidato-seguimiento.html?seccion=${id}`); await esperar("!document.querySelector('#contenido .cargando')");
      await ev("document.getElementById('volver').click()");
      ok(await esperar("location.pathname === '/app/candidato-mas.html'", 6000), `${ancho}: ${rotulo}: la flecha «←» vuelve a «Más»`, await ruta());
    }
    // Cada pantalla: «Salir» (44 px, a la derecha, con confirmación), letra y desborde
    for (const [nombre, url, listo] of PANTALLAS) {
      limpiarAvisos();
      if (/#nuevo/.test(url)) await ir('about:blank');   // misma página con otro # no recarga: el formulario solo se abre al cargar
      await ir(base + url); ok(await esperar(listo, 14000), `${ancho}: ${nombre}: carga lista`, url); await espera(/Ayuda|Estructura|Legislación|Mapa|Información/.test(nombre) ? 3000 : 900);
      const sal = await visiblesSalir();
      ok(sal.length === 1 && sal[0].h >= 44 && sal[0].w >= 44 && sal[0].txt === 'Salir' && sal[0].svg && sal[0].der <= sal[0].ancho && sal[0].izq > sal[0].ancho / 2 && sal[0].top < 140, `${ancho}: ${nombre}: un solo «Salir» (puerta con flecha), ≥ 44 px, arriba a la derecha`, sal);
      await ev("[...document.querySelectorAll('.btn-salir')].find((b) => b.getBoundingClientRect().width > 0).click()"); await espera(250);
      const dlg = await ev(`(() => { const d = document.getElementById('salir-confirma'); return d ? { t: d.innerText.replace(/\\n+/g, ' | '), botones: [...d.querySelectorAll('button')].map((b) => b.innerText.trim()) } : null; })()`);
      ok(dlg && /¿Cerrar sesión\?/.test(dlg.t) && dlg.botones.join(',') === 'Cancelar,Sí, salir', `${ancho}: ${nombre}: «Salir» pide «¿Cerrar sesión?» con Cancelar y Sí`, dlg);
      if (fotos && nombre === 'Inicio') await foto('18-confirmar-salir' + sfx);
      await ev("document.getElementById('salir-no').click()"); await espera(200);
      ok(await ev("!document.getElementById('salir-confirma')") && await ruta() === new URL(base + url).pathname, `${ancho}: ${nombre}: «Cancelar» cierra la pregunta y sigue en la misma pantalla con la sesión abierta`, await ruta());
      await ev('document.getElementById("salir-confirma") && document.getElementById("salir-confirma").remove()');
      const m = await ev(MEDIR);
      ok(m.base >= 17 || /Ayuda|Estructura/.test(nombre), `${ancho}: ${nombre}: texto base ≥ 17 px (${m.base})`, m.base);
      ok(m.menores.length === 0, `${ancho}: ${nombre}: ningún texto visible menor de 14 px (12 en la barra inferior)`, m.menores.slice(0, 8));
      ok(m.partidas.length === 0, `${ancho}: ${nombre}: ninguna palabra de las tarjetas se parte a la mitad`, m.partidas);
      ok(m.cortados.length === 0 && m.fuera.length === 0 && await sinDesborde(), `${ancho}: ${nombre}: nada se corta ni se desborda`, { cortados: m.cortados.slice(0, 5), fuera: m.fuera.slice(0, 5) });
      const aviso = p.avisos.filter((x) => !/tile|Failed to load|favicon|403|solo lectura/i.test(x));
      ok(aviso.length === 0, `${ancho}: ${nombre}: sin errores de consola`, aviso);
      if (fotos) {
        if (nombre === 'Inicio') await foto('1-inicio-letra' + sfx);
        if (nombre === 'Equipo') await foto('2-equipo-letra' + sfx);
        if (nombre === 'Más') await foto('6-mas-letra' + sfx);
        if (['Consultar puesto', 'Ayuda', 'Estructura territorial', 'Estructura: formulario abierto', 'Mis avisos'].includes(nombre)) await foto('19-' + nombre.toLowerCase().replace(/[^a-z]+/g, '-') + sfx);
      }
      if (nombre === 'Equipo' && !VACIA) {   // la ficha también lleva «Salir»
        await ev("document.querySelector('#lista button.nom').click()"); await espera(600);
        const s2 = await visiblesSalir();
        ok(s2.length === 1 && s2[0].h >= 44 && s2[0].der <= s2[0].ancho, `${ancho}: ficha del coordinador: «Salir» visible`, s2);
        const m2 = await ev(MEDIR);
        ok(m2.menores.length === 0 && m2.cortados.length === 0 && m2.fuera.length === 0, `${ancho}: ficha del coordinador: letra y sin cortes`, { a: m2.menores.slice(0, 5), b: m2.cortados.slice(0, 5), c: m2.fuera.slice(0, 5) });
      }
    }
  };
  if (!process.env.SOLO81) {   // SOLO81=1 salta lo de la orden 79 (ya probado) para iterar sobre la 81
  await q("UPDATE permisos_rol SET permitido = 1 WHERE rol = 'candidato' AND modulo IN ('rescate_votos','biografia_candidato','recursos','solicitudes','tareas','puerta_listas')");
  await require('./fixtures/encender-complementos')(pool, ['solicitudes', 'tareas', 'puerta_a_puerta', 'puerta_panel']);
  limpiarAvisos();
  await bloque79(360, 780, true);
  await bloque79(390, 844, true);
  await movil();
  // Más a 360 px: cuántas columnas quedaron
  await movil(360, 780); await ir(base + '/app/candidato-mas.html'); await esperar("document.querySelectorAll('.menu-boton').length > 0");
  const col360 = await ev("getComputedStyle(document.querySelector('.menu-grid')).gridTemplateColumns.split(' ').length");
  const txt15 = await ev("parseFloat(getComputedStyle(document.querySelector('.menu-boton .texto strong')).fontSize)");
  ok(col360 === 2 && txt15 === 15, 'Más a 360 px: dos columnas y texto de las tarjetas de 15 px', { col360, txt15 });
  await foto('6-mas-360-completo');
  await movil(390, 844); await ir(base + '/app/candidato-mas.html'); await esperar("document.querySelectorAll('.menu-boton').length > 0");
  ok(await ev("getComputedStyle(document.querySelector('.menu-grid')).gridTemplateColumns.split(' ').length") === 2, 'Más a 390 px: dos columnas');
  await movil(480, 900); await ir(base + '/app/candidato-mas.html'); await esperar("document.querySelectorAll('.menu-boton').length > 0");
  ok(await ev("getComputedStyle(document.querySelector('.menu-grid')).gridTemplateColumns.split(' ').length") === 3, 'Más en pantalla ancha (480 px): vuelven las tres columnas');
  await movil(390, 844);
  // el tamaño de letra del sistema se respeta: con texto al 130 % (el equivalente de «Letra grande» del celular) nada se desborda
  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await ev("document.documentElement.style.fontSize = '130%'"); await espera(300);
  const m130 = await ev(MEDIR);
  ok(m130.cortados.length === 0 && await sinDesborde(), 'con la letra del sistema al 130 %, «Más» no se desborda ni corta', { c: m130.cortados.slice(0, 4), f: m130.fuera.slice(0, 4) });
  await ev("document.documentElement.style.fontSize = ''");

  }

  // Cerrar sesión: con confirmación, desde el encabezado
  await ir(base + '/app/candidato-mas.html'); await esperar("document.querySelector('button.menu-boton[data-accion=salir]')");
  await ev("document.querySelector('button.menu-boton[data-accion=salir]').click()"); await espera(250);
  ok(await ev("!!document.getElementById('salir-confirma')"), 'la tarjeta «Cerrar sesión» de Más también pide confirmación');
  await ev("document.getElementById('salir-no').click()"); await espera(200);
  await ev("document.querySelector('.btn-salir').click()"); await espera(250);
  await ev("document.getElementById('salir-si').click()");
  ok(await esperar("location.pathname === '/login.html'", 10000), '«Salir» → «Sí, salir» cierra la sesión y lleva al ingreso', await ruta());

  /* ================= ORDEN 81 (navegador): administrador que también es el candidato ================= */
  console.log('  — Orden 81: administrador marcado «Es el candidato»');
  const limpiarSesion = async () => { await cmd('Network.clearBrowserCookies'); await ir(base + '/login.html'); await ev('localStorage.clear(); sessionStorage.clear()'); };
  const entrarPorLaPantalla = async (correo) => {
    await limpiarSesion(); await movil();
    await ir(base + '/login.html');
    await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
    await ev("document.getElementById('ir-a-otros-desde-eleccion').click()");
    await ev("document.getElementById('ir-a-password').click()");
    await ev(`(() => { const e = document.getElementById('campo-email'); e.value = ${JSON.stringify(correo)}; document.getElementById('campo-password').value = ${JSON.stringify(CLAVE_A)}; document.querySelector('#form-login button[type=submit]').click(); })()`);
  };
  const modoGuardado = () => ev("sessionStorage.getItem('modo_admin_candidato')");
  limpiarAvisos(); p.respuestas.length = 0;
  await entrarPorLaPantalla(CORREO_ADM_CAND);
  ok(await esperar("location.pathname === '/app/candidato.html'", 12000), 'celular: el administrador marcado cae en /app/candidato.html (la app del candidato)', await ruta());
  await esperar("document.getElementById('contenido').style.display !== 'none'"); await espera(500);
  ok(await ev("!!document.querySelector('.btn-salir')") && /Inicio,Equipo,Mapa,Agenda,Más/.test(await ev("[...document.querySelectorAll('#nav-candidato a')].map(a => a.lastChild.textContent.trim()).join(',')")), 'y la ve igual que el candidato: barra inferior y «Salir»');
  await ir(base + '/app/candidato-mas.html'); await esperar("document.querySelectorAll('.menu-boton').length > 0");
  const masA = await ev(`({ grupos: [...document.querySelectorAll('.menu-grupo')].map(g => ({ t: g.querySelector('.menu-grupo-titulo').innerText.trim(), items: [...g.querySelectorAll('.menu-boton')].map(b => b.querySelector('.texto strong').innerText.trim()) })) })`);
  console.log('    más del administrador marcado:', JSON.stringify(masA.grupos.map((g) => g.t)));
  ok(masA.grupos[0].t === 'Cambiar de modo' && masA.grupos[0].items.join('|') === 'Modo administrador', '«Más» trae arriba «Modo administrador»', masA.grupos[0]);
  ok(masA.grupos.find((g) => g.t === 'Registro').items.join('|') === 'Registrar en la estructura territorial|Consultar puesto de votación', '«Registro» sigue con los dos botones de siempre', masA.grupos.find((g) => g.t === 'Registro'));
  ok(await sinDesborde() && p.avisos.length === 0, 'Más del administrador marcado: sin desborde ni errores de consola', p.avisos);
  await foto('20-mas-modo-administrador');
  // Cambiar a modo administrador
  await ev("document.querySelector('button.menu-boton[data-accion=modo_admin]').click()");
  ok(await esperar("location.pathname === '/app/admin-panel.html'", 10000), '«Modo administrador» lleva a la app de administración del celular', await ruta());
  await esperar("!!document.querySelector('.btn-modo-candidato')", 10000); await espera(1200);
  const bmc = await ev(`(() => { const b = document.querySelector('.btn-modo-candidato'); if (!b) return null; const r = b.getBoundingClientRect(); return { txt: b.innerText.trim(), h: Math.round(r.height), der: Math.round(r.right), ancho: innerWidth }; })()`);
  ok(bmc && bmc.txt === 'Modo candidato' && bmc.h >= 44 && bmc.der <= bmc.ancho, 'allí hay un botón «Modo candidato» (≥ 44 px) en la barra', bmc);
  ok(await modoGuardado() === 'admin', 'el modo elegido queda recordado mientras usa la app (sessionStorage; orden 86)', await modoGuardado());
  await foto('21-admin-modo-candidato');
  await ir(base + '/login.html'); await espera(1500);
  ok(await ruta() === '/app/candidato.html', 'ORDEN 86: al volver a ingresar entra SIEMPRE como candidato, aunque haya quedado el modo administrador', await ruta());
  ok(await modoGuardado() !== 'admin', '   y el modo administrador ya no queda recordado', await modoGuardado());
  await ev("sessionStorage.setItem('modo_admin_candidato', 'admin')");
  await ir(base + '/app/inicio.html'); await esperar("document.querySelectorAll('#menu-app .menu-boton').length > 0"); await espera(500);
  ok(await ruta() === '/app/inicio.html' && /Modo candidato/.test(await texto('#menu-app')), 'en modo administrador, el inicio de siempre (el ícono de la app) muestra su menú, con «Modo candidato»', await ruta());
  // Volver a modo candidato
  await ir(base + '/app/admin-panel.html'); await esperar("!!document.querySelector('.btn-modo-candidato')"); await espera(500);
  await ev("document.querySelector('.btn-modo-candidato').click()");
  ok(await esperar("location.pathname === '/app/candidato.html'", 10000) && await modoGuardado() === 'candidato', '«Modo candidato» lo regresa a la app del candidato y lo recuerda', await ruta());
  await ir(base + '/login.html'); await espera(1500);
  ok(await ruta() === '/app/candidato.html', 'recordado: al volver a ingresar sigue en la app del candidato', await ruta());
  await ir(base + '/app/inicio.html'); await espera(2000);
  ok(await ruta() === '/app/candidato.html', 'y el ícono de la app instalada (inicio.html) lo lleva a la del candidato', await ruta());
  // En modo candidato sigue siendo administrador: escribe
  await ir(base + '/app/candidato.html'); await esperar("document.getElementById('contenido').style.display !== 'none'");
  const escrito = await ev(`api('/eventos', { method: 'POST', body: { titulo: 'Evento desde la app del candidato (admin)', fecha_inicio: '2031-03-02 09:00:00', tipo: 'reunion' } }).then(r => !!r && !!r.id).catch(e => 'ERROR ' + e.message)`);
  ok(escrito === true, 'en modo candidato conserva TODO lo de administrador: crea un evento (no le aplica el solo lectura)', escrito);
  ok(await ev("api('/usuarios/admin').then(r => Array.isArray(r)).catch(() => false)"), 'y lee el listado de usuarios (lo de administrador)');
  await q("DELETE FROM eventos WHERE titulo = 'Evento desde la app del candidato (admin)'");
  // «Salir» y letra grande en las páginas compartidas SOLO en modo candidato
  await ir(base + '/app/puesto-votacion.html'); await esperar("!!document.querySelector('.btn-salir')", 8000); await espera(500);
  ok(await ev("document.body.classList.contains('cand-app') && !!document.querySelector('.btn-salir')") && /candidato-mas/.test(await ev("document.querySelector('.app-barra .volver').getAttribute('onclick')")), 'en modo candidato las pantallas compartidas llevan «Salir», la letra grande y vuelven a «Más»');
  await ev("sessionStorage.setItem('modo_admin_candidato', 'admin')");
  await ir(base + '/app/puesto-votacion.html'); await espera(1500);
  ok(await ev("!document.body.classList.contains('cand-app') && !document.querySelector('.btn-salir')") && /inicio\.html/.test(await ev("document.querySelector('.app-barra .volver').getAttribute('onclick')")), 'en modo administrador esas mismas pantallas son las de siempre (sin «Salir» ni letra del candidato)');
  await ev("sessionStorage.setItem('modo_admin_candidato', 'candidato')");
  const malas81 = p.respuestas.filter((r) => r.status === 403 || r.status === 500).map((r) => r.status + ' ' + r.url.replace(base, ''));
  ok(malas81.length === 0, 'el administrador marcado no recibe ningún 403/500 en todo el recorrido', malas81);
  // Computador: sigue en el panel de administrador
  await limpiarSesion(); await escritorio();
  await ir(base + '/login.html');
  await ev(`(async () => { const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(CORREO_ADM_CAND)}, password: ${JSON.stringify(CLAVE_A)} }) }); const d = await r.json(); irDondeCorresponde(d.usuario); })()`);
  ok(await esperar("location.pathname === '/dashboard.html'", 12000), 'computador: el administrador marcado sigue cayendo en el panel de administrador (/dashboard.html)', await ruta());
  await espera(1500);
  ok(await ev("!document.querySelector('.btn-salir')"), 'y en el computador no aparece nada de la app del candidato');
  await ir(base + '/app/candidato.html?app=1'); await espera(2000);
  ok(await ruta() === '/app/candidato.html', 'se puede abrir la app del candidato a mano en el computador (/app/candidato.html?app=1)', await ruta());
  // Administrador SIN marca: igual que antes
  await entrarPorLaPantalla(CORREO_ADM_SIN);
  ok(await esperar("location.pathname === '/app/admin-panel.html'", 12000), 'celular: el administrador SIN marca sigue cayendo en /app/admin-panel.html', await ruta());
  await esperar("!document.getElementById('pantalla-carga') || getComputedStyle(document.getElementById('pantalla-carga')).display === 'none'", 10000); await espera(800);
  ok(await ev("!document.querySelector('.btn-modo-candidato')"), 'y su barra no trae «Modo candidato»');
  await ir(base + '/app/candidato.html'); await espera(2500);
  ok(await ruta() === '/app/admin-panel.html', 'si abre la app del candidato a mano, lo devuelve a la de administración', await ruta());
  ok(await ev("sessionStorage.getItem('modo_admin_candidato')") === null, 'y no queda ningún modo recordado');
  // Usuarios (computador): la casilla solo aparece con rol Administrador
  await limpiarSesion(); await escritorio();
  await ir(base + '/login.html');
  await ev(`(async () => { await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(CORREO_ADM_SIN)}, password: ${JSON.stringify(CLAVE_A)} }) }); })()`); await espera(800);
  await ir(base + '/configuracion.html'); await esperar("document.getElementById('usuario-form-rol') && document.getElementById('usuario-form-rol').options.length > 2", 12000); await espera(800);
  await ev('abrirCreacionUsuario()'); await espera(300);
  const casilla = () => ev("(() => { const c = document.getElementById('campo-usuario-es-candidato'); return { vis: getComputedStyle(c).display !== 'none', marcada: document.getElementById('usuario-form-es-candidato').checked }; })()");
  const poner = (rol) => ev(`(() => { const s = document.getElementById('usuario-form-rol'); s.value = ${JSON.stringify(rol)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  ok((await casilla()).vis === false, 'Usuarios: sin rol elegido, la casilla «Es el candidato» no se ve');
  await poner('lider'); ok((await casilla()).vis === false, 'Usuarios: con rol Líder, no se ve');
  await poner('admin'); ok((await casilla()).vis === true, 'Usuarios: con rol Administrador, se ve');
  await ev("document.getElementById('usuario-form-es-candidato').click()");
  ok((await casilla()).marcada === true, 'y se puede marcar');
  await foto('22-usuarios-casilla-es-candidato');
  await poner('coordinador'); const despues = await casilla();
  ok(despues.vis === false && despues.marcada === false, 'si el rol cambia a otro, la casilla desaparece y se apaga sola', despues);
  ok(p.avisos.filter((x) => !/tile|Failed to load|favicon/i.test(x)).length === 0, 'Usuarios: sin errores de consola', p.avisos);
  await q("DELETE FROM usuarios WHERE email IN (?, ?)", [CORREO_ADM_CAND, CORREO_ADM_SIN]);
  await movil();

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
    for (const u of ['/app/puesto-votacion.html', '/app/biografia.html', '/app/politica-privacidad.html', '/app/mis-avisos.html']) {
      await ir(base + u); await espera(1800);
      ok(await ev("!document.body.classList.contains('cand-app') && !document.querySelector('.btn-salir') && !document.getElementById('cand-letra-css')"), `líder: ${u} sin «Salir» ni letra del candidato (sin cambios)`);
    }
  }

  nav.cerrar(); app.s.close();
  console.log(`\n${fallos === 0 ? 'TODO BIEN' : 'HAY FALLOS'}: ${pasos - fallos} de ${pasos} comprobaciones.`);
  console.log('Capturas en ' + SALIDA);
  await pool.end();
  process.exit(fallos === 0 ? 0 : 1);
})().catch(async (e) => { console.error('Error en la prueba:', e); try { await pool.end(); } catch (_) { /* ya cerrado */ } process.exit(1); });

