#!/usr/bin/env node
// scripts/probar-panel-lider.js
//
// Prueba de la orden «Panel del líder en la PWA + cierre de fugas de alcance».
//   PARTE A (fugas):
//     · /dashboard/tabla-posiciones: líder, sublíder, testigo, usuario e invitado reciben SOLO {lugar, de}, contado con la
//       definición de inscritos de su lista; administrador, coordinador y aspirante siguen recibiendo la lista.
//     · /votantes/resumen: acotado por el alcance de quien pregunta.
//     · /configuracion/campana: quien trabaja en la calle no recibe metas ni datos internos; admin y coordinador, la fila entera.
//     · /dashboard/mi-progreso: los inscritos son los de la lista de Votantes (líder, sublíder y aspirante con rol líder).
//   PARTE B (panel):
//     · GET /api/panel-lider (una llamada: meta, 7 días, pendientes, equipo, posición, Día D) y /pendientes, con alcance.
//     · PATCH /api/votantes/:id/datos-basicos: solo teléfono, puesto y mesa; 403 fuera del alcance; validaciones; auditoría; tope.
//   Y en todo: nadie ve datos fuera de su alcance (ni nombres, ni cédulas, ni teléfonos de otro).
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada296 node scripts/probar-panel-lider.js
//
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) {
  console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`);
  process.exit(2);
}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';

const express = require('express');
const http = require('http');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];

let sublicencia = null;
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const u = req.headers['x-test-user'];
  req.session = { usuario: u ? JSON.parse(u) : undefined };
  req.sublicencia = req.headers['x-test-aspirante'] ? sublicencia : null;
  next();
});
app.use('/api/dashboard', require('../routes/dashboard.routes'));
app.use('/api/votantes', require('../routes/votantes.routes'));
app.use('/api/configuracion', require('../routes/configuracion.routes'));
app.use('/api/panel-lider', require('../routes/panelLider.routes'));

let base = '';
async function pedir(metodo, ruta, usuario, { aspirante, cuerpo } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  if (aspirante) h['X-Test-Aspirante'] = '1';
  const r = await fetch(base + ruta, { method: metodo, headers: h, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
  return { status: r.status, datos, texto };
}
const GET = (ruta, u, o) => pedir('GET', ruta, u, o);

let n = 0;
async function persona(nombre, rol) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo)
     VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, `9700000${n}`, `u9700000${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  return { id: r.insertId, rol, nombre };
}
async function estructura(usuarioId, cargo, supervisorId, meta) {
  await q('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo, meta_votos) VALUES (?,?,?,1,?)', [usuarioId, cargo, supervisorId || null, meta || 0]);
}
let c = 0;
async function ficha(o) {
  c++;
  const [r] = await pool.query(
    `INSERT INTO votantes (nombre, cedula, telefono, lider_id, sublider_id, origen, created_at, puesto_votacion, datos_verificados,
                           territorio_id, rama_aspirante_id, consentimiento_confirmado_en)
     VALUES (?, ?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? DAY), ?, ?, ?, ?, ?)`,
    [o.nombre || `Persona ${c}`, `7300${String(c).padStart(6, '0')}`, o.telefono === undefined ? `3140${String(c).padStart(6, '0')}` : o.telefono,
      o.lider, o.sublider || null, o.origen || 'manual', o.dias || 0, o.puesto || null, o.verificado ? 1 : 0, o.territorio || null,
      o.rama || null, o.confirmado ? new Date() : null]);
  return r.insertId;
}

const pideNombre = (texto, nombre) => texto.includes(nombre);

(async () => {
  // Activar complementos (parche 318): los complementos nacen APAGADOS; esta prueba enciende los que necesita.
  await require('./fixtures/encender-complementos')(pool, ['tareas']);
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  // ================================================================ el terreno
  await q('DELETE FROM votante_votos');
  await q('DELETE FROM votantes');
  await q("DELETE FROM dia_d_puestos_votacion");
  await q("DELETE FROM auditoria WHERE accion = 'completar_datos_basicos'");
  await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
  await q('UPDATE configuracion_campana SET meta_votos_campana = 1234, direccion_sede = ?, telefono = ?, email = ?, nombre_candidato = ?, slogan_campana = ?, fecha_eleccion = DATE_ADD(CURDATE(), INTERVAL 10 DAY) WHERE id = 1',
    ['Calle Ficticia 1', '3009998877', 'sede@ejemplo.co', 'Candidato de Prueba', 'Lema de prueba']);

  const admin = await persona('Admin Prueba', 'admin');
  const coord = await persona('Coordinador Prueba', 'coordinador');
  const liderA = await persona('Lider Alfa', 'lider');
  const liderB = await persona('Lider Beta', 'lider');
  const liderSinFila = await persona('Lider Sin Fila', 'lider');
  const subA = await persona('Sublider De Alfa', 'sublider');
  const subB = await persona('Sublider De Beta', 'sublider');
  const asp = await persona('Aspirante Prueba', 'lider');
  const testigo = await persona('Testigo Prueba', 'testigo');
  await estructura(coord.id, 'coordinador', null, 0);
  await estructura(liderA.id, 'lider', coord.id, 50);
  await estructura(liderB.id, 'lider', coord.id, 80);
  await estructura(subA.id, 'usuario', liderA.id, 10);
  await estructura(subB.id, 'usuario', liderB.id, 20);
  await estructura(asp.id, 'lider', null, 100);
  sublicencia = { usuario_id: asp.id, cargo: 'cargo-de-prueba', nombre: 'Campaña de prueba', activa: 1 };

  const [t1] = await pool.query("INSERT INTO territorios (tipo, nombre) VALUES ('barrio', 'Barrio Equis')");
  const [t2] = await pool.query("INSERT INTO territorios (tipo, nombre) VALUES ('barrio', 'Barrio Ye')");
  await q('INSERT INTO dia_d_puestos_votacion (nombre, cantidad_mesas) VALUES (?, ?), (?, ?)', ['PUESTO UNO', 4, 'PUESTO DOS', 2]);
  const [[p1]] = await pool.query("SELECT id FROM dia_d_puestos_votacion WHERE nombre = 'PUESTO UNO'");
  const [[p2]] = await pool.query("SELECT id FROM dia_d_puestos_votacion WHERE nombre = 'PUESTO DOS'");

  // Alfa: 5 fichas (2 las registró su sublíder). Beta: 3. Aspirante: 2 en su rama.
  const A = [];
  A.push(await ficha({ nombre: 'Votante A1', lider: liderA.id, dias: 0, territorio: t1.insertId, puesto: 'PUESTO UNO', verificado: true }));
  A.push(await ficha({ nombre: 'Votante A2', lider: liderA.id, dias: 1, territorio: t1.insertId, telefono: null }));
  A.push(await ficha({ nombre: 'Votante A3', lider: liderA.id, dias: 3, territorio: t2.insertId, telefono: '', puesto: 'PUESTO DOS' }));
  A.push(await ficha({ nombre: 'Votante A4', lider: liderA.id, sublider: subA.id, dias: 3, territorio: t1.insertId, origen: 'enlace_lider' }));
  A.push(await ficha({ nombre: 'Votante A5', lider: liderA.id, sublider: subA.id, dias: 9, territorio: t2.insertId, puesto: 'PUESTO UNO' }));
  const B = [];
  B.push(await ficha({ nombre: 'Votante B1', lider: liderB.id, dias: 0, territorio: t1.insertId }));
  B.push(await ficha({ nombre: 'Votante B2', lider: liderB.id, sublider: subB.id, dias: 2, territorio: t2.insertId, telefono: null }));
  B.push(await ficha({ nombre: 'Votante B3', lider: liderB.id, dias: 5, territorio: t1.insertId }));
  const R = [];
  R.push(await ficha({ nombre: 'Votante R1', lider: coord.id, rama: asp.id, dias: 0, territorio: t1.insertId, telefono: null }));
  R.push(await ficha({ nombre: 'Votante R2', lider: coord.id, rama: asp.id, dias: 2, territorio: t2.insertId }));
  // Dos de Alfa ya votaron.
  await q('INSERT INTO votante_votos (votante_id, origen) VALUES (?, ?), (?, ?)', [A[0], 'equipo', A[3], 'equipo']);

  const nombresAjenosDeA = ['Votante B1', 'Votante B2', 'Votante B3', 'Votante R1', 'Votante R2', 'Lider Beta', 'Sublider De Beta', 'Aspirante Prueba', 'Coordinador Prueba'];
  const telefonosAjenos = (await q('SELECT telefono, cedula FROM votantes WHERE id IN (?)', [[...B, ...R]])).flatMap((f) => [f.telefono, f.cedula]).filter(Boolean);

  // ================================================================ A1. tabla-posiciones
  console.log('\n[A1] /dashboard/tabla-posiciones');
  let r = await GET('/api/dashboard/tabla-posiciones', liderA);
  ok(r.status === 200 && !Array.isArray(r.datos) && r.datos.lugar === 1 && r.datos.de === 3, 'el líder Alfa recibe solo {lugar: 1, de: 3} (5 > 3 > 0 fichas)', r.datos);
  ok(Object.keys(r.datos).sort().join() === 'de,lugar', 'y nada más que esas dos claves');
  ok(!nombresAjenosDeA.some((x) => pideNombre(r.texto, x)), 'sin el nombre de nadie');
  r = await GET('/api/dashboard/tabla-posiciones', liderB);
  ok(r.datos.lugar === 2 && r.datos.de === 3, 'el líder Beta va en el lugar 2 de 3', r.datos);
  r = await GET('/api/dashboard/tabla-posiciones', subA);
  ok(r.datos.lugar === 1 && r.datos.de === 2, 'la sublíder de Alfa (2 fichas) va en el lugar 1 de 2', r.datos);
  r = await GET('/api/dashboard/tabla-posiciones', subB);
  ok(r.datos.lugar === 2 && r.datos.de === 2, 'la sublíder de Beta (1 ficha) va en el lugar 2 de 2', r.datos);
  r = await GET('/api/dashboard/tabla-posiciones', liderSinFila);
  ok(r.status === 200 && r.datos.lugar === null && r.datos.de === 3, 'un líder sin fila de estructura: lugar null, de 3', r.datos);
  r = await GET('/api/dashboard/tabla-posiciones', testigo);
  ok(r.status === 200 && !Array.isArray(r.datos) && r.datos.lugar === null, 'el testigo tampoco recibe la lista', r.datos);
  r = await GET('/api/dashboard/tabla-posiciones', admin);
  ok(Array.isArray(r.datos) && r.datos.length >= 2 && r.datos.some((f) => f.nombre === 'Lider Alfa'), 'el administrador sigue recibiendo la lista');
  r = await GET('/api/dashboard/tabla-posiciones', coord);
  ok(Array.isArray(r.datos) && r.datos.some((f) => f.nombre === 'Lider Alfa') && r.datos.some((f) => f.nombre === 'Lider Beta'), 'el coordinador sigue recibiendo la lista de su rama');
  r = await GET('/api/dashboard/tabla-posiciones', asp, { aspirante: true });
  ok(Array.isArray(r.datos), 'el aspirante con sublicencia sigue recibiendo la lista (de su rama)');

  // ================================================================ A2. votantes/resumen
  console.log('\n[A2] /votantes/resumen con alcance');
  const suma = (d, nombre) => ((d.porTerritorio.find((f) => f.nombre === nombre) || {}).total) || 0;
  r = await GET('/api/votantes/resumen', admin);
  ok(r.status === 200 && suma(r.datos, 'Barrio Equis') === 6 && suma(r.datos, 'Barrio Ye') === 4, 'el administrador ve toda la campaña (6 y 4)', r.datos);
  r = await GET('/api/votantes/resumen', liderA);
  ok(suma(r.datos, 'Barrio Equis') === 3 && suma(r.datos, 'Barrio Ye') === 2, 'el líder Alfa ve solo lo suyo (3 y 2)', r.datos);
  r = await GET('/api/votantes/resumen', subA);
  ok(suma(r.datos, 'Barrio Equis') === 1 && suma(r.datos, 'Barrio Ye') === 1, 'la sublíder de Alfa, solo lo que registró (1 y 1)', r.datos);
  r = await GET('/api/votantes/resumen', asp, { aspirante: true });
  ok(suma(r.datos, 'Barrio Equis') === 1 && suma(r.datos, 'Barrio Ye') === 1, 'el aspirante, solo su rama (1 y 1)', r.datos);

  // ================================================================ A3. configuracion/campana
  console.log('\n[A3] /configuracion/campana recortada para quien trabaja en la calle');
  const sensibles = ['meta_votos_campana', 'direccion_sede', 'telefono', 'email', 'actualizado_por', 'actualizado_en'];
  for (const [etiqueta, u] of [['líder', liderA], ['sublíder', subA], ['testigo', testigo]]) {
    r = await GET('/api/configuracion/campana', u);
    ok(r.status === 200 && sensibles.every((k) => !(k in r.datos)), `${etiqueta}: sin metas, sede, teléfono ni correo`, Object.keys(r.datos || {}));
    ok(r.datos.nombre_candidato === 'Candidato de Prueba' && r.datos.slogan_campana === 'Lema de prueba' && !!r.datos.fecha_eleccion, `${etiqueta}: sí recibe candidato, lema y fecha de elección`);
    ok(Array.isArray(r.datos.apoyos_posibles) && 'hay_datos_comuna' in r.datos && 'ciudad_tiene_comunas' in r.datos, `${etiqueta}: y lo que arman sus formularios (apoyos, niveles territoriales)`);
  }
  r = await GET('/api/configuracion/campana', admin);
  ok(r.datos.meta_votos_campana === 1234 && r.datos.telefono === '3009998877', 'el administrador recibe la fila entera');
  r = await GET('/api/configuracion/campana', coord);
  ok(r.datos.meta_votos_campana === 1234, 'el coordinador también');

  // ================================================================ A5. mi-progreso = la lista
  console.log('\n[A5] /dashboard/mi-progreso cuenta lo mismo que la lista de Votantes');
  for (const [etiqueta, u, o] of [['líder Alfa', liderA], ['líder Beta', liderB], ['sublíder de Alfa', subA], ['aspirante (rol líder)', asp, { aspirante: true }]]) {
    const lista = await GET('/api/votantes?limit=100', u, o);
    const prog = await GET('/api/dashboard/mi-progreso', u, o);
    ok(lista.status === 200 && prog.status === 200 && prog.datos.enviados === lista.datos.total, `${etiqueta}: enviados (${prog.datos.enviados}) = total de su lista (${lista.datos && lista.datos.total})`, [prog.datos, lista.datos && lista.datos.total]);
  }
  r = await GET('/api/dashboard/mi-progreso', liderA);
  ok(r.datos.tieneMetaAsignada && r.datos.meta === 50 && r.datos.porcentaje === 10 && r.datos.porEnlace === 1 && r.datos.porEnlaceSinConfirmar === 1, 'Alfa: meta 50, 10 %, 1 por su enlace sin confirmar', r.datos);
  r = await GET('/api/dashboard/mi-progreso', liderSinFila);
  ok(r.datos.tieneMetaAsignada === false && r.datos.enviados === 0, 'sin fila de estructura: sin meta, 0 inscritos', r.datos);

  // ================================================================ B6. panel-lider
  console.log('\n[B6] GET /api/panel-lider');
  r = await GET('/api/panel-lider', liderA);
  const P = r.datos;
  ok(r.status === 200 && P && P.meta && P.ultimos_7_dias && P.pendientes && P.posicion, 'el líder recibe todo en una llamada');
  ok(P.meta.tieneMeta && P.meta.meta === 50 && P.meta.inscritos === 5 && P.meta.porcentaje === 10, 'meta 50, inscritos 5, 10 %', P.meta);
  ok(P.ultimos_7_dias.dias.length === 7 && P.ultimos_7_dias.dias[6].fecha === P.ultimos_7_dias.hoy, 'siete días, el último es hoy');
  const porFecha = Object.fromEntries(P.ultimos_7_dias.dias.map((d) => [d.fecha, d.n]));
  const [[{ hoy }]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy");
  const haceDias = async (k) => (await q("SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ? DAY), '%Y-%m-%d') AS d", [k]))[0].d;
  ok(porFecha[hoy] === 1 && porFecha[await haceDias(1)] === 1 && porFecha[await haceDias(3)] === 2 && porFecha[await haceDias(2)] === 0, 'por día: hoy 1, ayer 1, hace 3 días 2, y los días sin registros en cero', porFecha);
  ok(P.ultimos_7_dias.total === 4, 'el total de la semana es 4 (la ficha de hace 9 días no entra)', P.ultimos_7_dias.total);
  ok(P.pendientes.sin_telefono === 2 && P.pendientes.sin_puesto === 2 && P.pendientes.sin_verificar === 4, 'pendientes: 2 sin teléfono, 2 sin puesto, 4 sin verificar', P.pendientes);
  ok(JSON.stringify(P.equipo) === JSON.stringify([{ nombre: 'Sublider De Alfa', registros: 2, meta: 10 }]), 'equipo: solo nombre, registros y meta de su sublíder', P.equipo);
  ok(P.posicion.lugar === 1 && P.posicion.de === 3, 'posición 1 de 3');
  ok(P.dia_d && P.dia_d.total === 5 && P.dia_d.votaron === 2 && P.dia_d.faltan === 3 && P.dia_d.pct === 40 && P.dia_d.modo_prueba === true, 'Día D (modo prueba): 5 de los suyos, 2 votaron, faltan 3, 40 %', P.dia_d);
  ok(!nombresAjenosDeA.some((x) => pideNombre(r.texto, x)) && !telefonosAjenos.some((x) => r.texto.includes(x)), 'no aparece ningún nombre, teléfono ni cédula de otra persona');
  ok(!/"(cedula|email|telefono|numero_identificacion)"/.test(JSON.stringify(P.equipo)), 'el equipo no trae cédula, correo ni teléfono');
  // Nunca de la URL.
  const manipulado = await GET(`/api/panel-lider?usuario_id=${liderB.id}&lider_id=${liderB.id}&id=${liderB.id}`, liderA);
  ok(manipulado.datos.meta.meta === 50 && manipulado.datos.meta.inscritos === 5, 'mandar el id de otro líder en la URL no cambia nada: es el de la sesión');
  // Día D el día de la elección: sin modo prueba.
  await q('UPDATE configuracion_campana SET fecha_eleccion = CURDATE() WHERE id = 1');
  r = await GET('/api/panel-lider', liderA);
  ok(r.datos.dia_d && r.datos.dia_d.modo_prueba === false, 'el día de la elección: Día D sin «modo prueba»');
  await q('UPDATE configuracion_campana SET fecha_eleccion = DATE_ADD(CURDATE(), INTERVAL 10 DAY) WHERE id = 1');
  // Sin el módulo, sin Día D.
  const filaRescate = (await q("SELECT permitido FROM permisos_rol WHERE rol = 'lider' AND modulo = 'rescate_votos'"))[0];
  await q("UPDATE permisos_rol SET permitido = 0 WHERE rol = 'lider' AND modulo = 'rescate_votos'");
  r = await GET('/api/panel-lider', liderA);
  ok(r.datos.dia_d === null, 'sin «Ver» en rescate_votos no hay contador de Día D');
  await q('UPDATE permisos_rol SET permitido = ? WHERE rol = ? AND modulo = ?', [filaRescate.permitido, 'lider', 'rescate_votos']);

  r = await GET('/api/panel-lider', subA);
  ok(r.datos.equipo.length === 0 && r.datos.meta.meta === 10 && r.datos.meta.inscritos === 2 && r.datos.posicion.lugar === 1 && r.datos.posicion.de === 2, 'la sublíder: sin equipo, meta 10, 2 inscritos, lugar 1 de 2', r.datos);
  r = await GET('/api/panel-lider', liderSinFila);
  ok(r.datos.meta.tieneMeta === false && r.datos.meta.inscritos === 0, 'sin fila de estructura: tieneMeta false (el panel dice «Aún no tienes meta asignada»)');
  r = await GET('/api/panel-lider', asp, { aspirante: true });
  ok(r.status === 200 && r.datos.meta.inscritos === 2, 'el aspirante con rol líder: sus inscritos son los de su rama (2)', r.datos && r.datos.meta);
  ok(r.datos.meta.tieneMeta === false, 'y su barra se mide contra la meta de SU campaña (sublicencia): sin ella, «Aún no tienes meta asignada» (la de 100 de la campaña principal no es su meta)', r.datos.meta);
  ok(r.datos.posicion.lugar === null && !nombresAjenosDeA.filter((x) => x !== 'Aspirante Prueba' && x !== 'Votante R1' && x !== 'Votante R2' && x !== 'Coordinador Prueba').some((x) => pideNombre(r.texto, x)), 'el aspirante no ve a los líderes de la campaña principal');
  ok(r.datos.dia_d && r.datos.dia_d.total === 2, 'y su Día D cuenta su rama (2)');
  for (const [etiqueta, u] of [['coordinador', coord], ['administrador', admin], ['testigo', testigo]]) {
    ok((await GET('/api/panel-lider', u)).status === 403, `${etiqueta}: 403 (el panel es de líder, sublíder y aspirante)`);
  }
  ok((await GET('/api/panel-lider')).status === 401, 'sin sesión: 401');

  // ================================================================ B7. pendientes
  console.log('\n[B7] GET /api/panel-lider/pendientes');
  r = await GET('/api/panel-lider/pendientes?tipo=sin_telefono', liderA);
  const idsTel = (r.datos.items || []).map((x) => x.id).sort();
  ok(r.status === 200 && r.datos.total === 2 && JSON.stringify(idsTel) === JSON.stringify([A[1], A[2]].sort()), 'sin teléfono: solo A2 y A3, de Alfa', r.datos);
  ok(r.datos.items.every((x) => Object.keys(x).sort().join() === 'barrio,falta,id,nombre') && r.datos.items[0].barrio !== undefined, 'cada uno trae solo id, nombre, barrio y lo que falta');
  ok(!telefonosAjenos.some((x) => r.texto.includes(x)) && !r.texto.includes('Votante B2'), 'sin nada de otro líder');
  r = await GET('/api/panel-lider/pendientes?tipo=sin_puesto', liderA);
  ok(r.datos.total === 2 && r.datos.items.map((x) => x.id).sort().join() === [A[1], A[3]].sort().join(), 'sin puesto: A2 y A4', r.datos);
  ok((await GET('/api/panel-lider/pendientes?tipo=otra', liderA)).status === 400, 'tipo inválido: 400');
  ok((await GET('/api/panel-lider/pendientes', liderA)).status === 400, 'sin tipo: 400');
  r = await GET('/api/panel-lider/pendientes?tipo=sin_telefono', asp, { aspirante: true });
  ok(r.datos.total === 1 && r.datos.items[0].id === R[0], 'el aspirante: solo los de su rama (R1)', r.datos);
  r = await GET('/api/panel-lider/pendientes?tipo=sin_telefono', subA);
  ok(r.datos.total === 0, 'la sublíder de Alfa no tiene sin teléfono entre las suyas (A4 y A5 tienen)', r.datos);

  // ================================================================ B8. PATCH datos-basicos
  console.log('\n[B8] PATCH /api/votantes/:id/datos-basicos');
  const patch = (id, cuerpo, u, o) => pedir('PATCH', `/api/votantes/${id}/datos-basicos`, u, { ...(o || {}), cuerpo });
  const fila = async (id) => (await q('SELECT telefono, puesto_votacion, puesto_id, mesa_votacion FROM votantes WHERE id = ?', [id]))[0];
  r = await patch(A[1], { telefono: '300 111 22 33' }, liderA);
  ok(r.status === 200 && (await fila(A[1])).telefono === '3001112233', 'completar el teléfono (con espacios) lo guarda como 10 dígitos', [r.status, r.datos]);
  r = await patch(A[2], { telefono: '12345' }, liderA);
  ok(r.status === 400 && (await fila(A[2])).telefono === '', 'un teléfono de 5 dígitos: 400 y no se guarda');
  r = await patch(A[1], { puesto_id: p1.id, mesa: 3 }, liderA);
  const f1 = await fila(A[1]);
  ok(r.status === 200 && f1.puesto_votacion === 'PUESTO UNO' && f1.mesa_votacion === 3 && f1.puesto_id === p1.id, 'puesto y mesa: se guarda el nombre completo, la mesa y el enlace del puesto', f1);
  r = await patch(A[1], { puesto_id: p2.id }, liderA);
  const f2 = await fila(A[1]);
  ok(r.status === 200 && f2.puesto_votacion === 'PUESTO DOS' && f2.mesa_votacion === null, 'cambiar de puesto sin elegir mesa deja la mesa vacía (la anterior ya no corresponde)', f2);
  r = await patch(A[1], { puesto_id: p2.id, mesa: 9 }, liderA);
  ok(r.status === 400 && /2 mesas/.test(r.datos.error), 'una mesa mayor a las del puesto: 400', r.datos);
  r = await patch(A[4], { mesa: 2 }, liderA);
  ok(r.status === 200 && (await fila(A[4])).mesa_votacion === 2, 'la mesa se puede poner si la persona ya tiene puesto');
  r = await patch(A[3], { mesa: 2 }, liderA);
  ok(r.status === 400, 'la mesa sin puesto elegido y sin puesto guardado: 400');
  r = await patch(A[1], { puesto_id: 999999 }, liderA);
  ok(r.status === 400, 'un puesto que no está en la lista de la campaña: 400');
  r = await patch(A[1], {}, liderA);
  ok(r.status === 400, 'sin nada que completar: 400');
  r = await patch(A[1], { telefono: '3001112233', nombre: 'Otro Nombre' }, liderA);
  ok(r.status === 400 && (await q('SELECT nombre FROM votantes WHERE id = ?', [A[1]]))[0].nombre === 'Votante A2', 'otro campo (nombre): 400 y no se toca');
  // Alcance.
  const antes = await fila(B[0]);
  r = await patch(B[0], { telefono: '3009990000' }, liderA);
  ok(r.status === 403 && JSON.stringify(await fila(B[0])) === JSON.stringify(antes), 'Alfa sobre una ficha de Beta: 403 y no cambia nada');
  r = await patch(R[0], { telefono: '3009990000' }, liderA);
  ok(r.status === 403, 'Alfa sobre una ficha de la rama del aspirante: 403');
  r = await patch(A[2], { telefono: '3005550000' }, subA);
  ok(r.status === 403, 'la sublíder de Alfa sobre una ficha que no registró ella: 403');
  r = await patch(A[3], { telefono: '3005550001' }, subA);
  ok(r.status === 200, 'la sublíder de Alfa sobre una que sí registró: 200');
  r = await patch(R[0], { telefono: '3005550002' }, asp, { aspirante: true });
  ok(r.status === 200, 'el aspirante sobre una de su rama: 200');
  r = await patch(A[2], { telefono: '3005550003' }, asp, { aspirante: true });
  ok(r.status === 403, 'el aspirante sobre una ficha que no es de su rama: 403');
  r = await patch(A[2], { telefono: '3005550004' }, coord);
  ok(r.status === 200, 'el coordinador sobre una ficha de su rama: 200');
  r = await patch(A[2], { telefono: '3005550005' }, testigo);
  ok(r.status === 403, 'un testigo: 403 (no es de quienes registran)');
  r = await patch(9999999, { telefono: '3005550006' }, liderA);
  ok(r.status === 403, 'una ficha que no existe: 403, igual que una ajena (no se dice si existe)');
  const aud = await q("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'completar_datos_basicos' AND usuario_id = ?", [liderA.id]);
  ok(aud[0].n >= 4, 'quedó en auditoría', aud[0].n);
  const detalle = (await q("SELECT detalle FROM auditoria WHERE accion = 'completar_datos_basicos' ORDER BY id DESC LIMIT 1"))[0].detalle;
  ok(!/\d{10}/.test(detalle), 'y la auditoría no guarda el teléfono entero', detalle);
  // Tope por usuario.
  let ultimo = 0;
  for (let i = 0; i < 125; i++) { ultimo = (await patch(A[0], { telefono: '3001110000' }, liderB)).status; }
  ok(ultimo === 429, 'el tope por usuario: tras muchos cambios seguidos responde 429', ultimo);
  ok((await patch(A[0], { telefono: '3001110000' }, liderA)).status === 200, 'y el tope es por usuario: otro líder sigue pudiendo');

  // ------------------------------------------------------------------------------------------------ limpieza
  await q('DELETE FROM votante_votos');
  await q('DELETE FROM votantes');
  await q('DELETE FROM dia_d_puestos_votacion');
  await q("DELETE FROM auditoria WHERE accion = 'completar_datos_basicos'");
  await q('DELETE FROM usuarios WHERE nombre_usuario LIKE ?', ['u9700000%']);
  servidor.close();
  await pool.end();
  console.log(fallos ? `\n${fallos} comprobación(es) fallaron.` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
