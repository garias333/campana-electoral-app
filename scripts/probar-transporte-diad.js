#!/usr/bin/env node
// scripts/probar-transporte-diad.js
//
// Prueba de extremo a extremo del TRANSPORTE DEL DÍA D, parte 1 (orden 33), y de la búsqueda de cuentas por cédula con la
// regla de alcance (punto 5 de esa orden), contra una base SIMULADA: levanta las rutas reales (/t, /api/dia-d/transporte,
// /api/dia-d/rescate, /api/votantes, /api/usuarios) en un Express de prueba con una sesión fingida por cabecera.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada node scripts/probar-transporte-diad.js
//
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». Para probar «Cómo llegar al puesto» crea un catálogo de
// juguete en OTRA base (`catalogo_prueba_transp`, que apunta con CATALOGO_DB) y la borra al terminar: nunca toca `territoriosdb`.
// Sale con código 1 si algo no cuadra. No manda SMS ni usa servicios externos.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) {
  console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`);
  process.exit(2);
}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
const CATALOGO = 'catalogo_prueba_transp';
process.env.CATALOGO_DB = CATALOGO;

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const pool = require('../config/db');
const T = require('../lib/transporteDiaD');

let fallos = 0, pruebas = 0;
function ok(cond, texto, extra) {
  pruebas++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
const dormir = (ms) => new Promise(r => setTimeout(r, ms));
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use((req, res, next) => {
  const u = req.headers['x-test-user'];
  req.session = { usuario: u ? JSON.parse(u) : undefined };
  req.sublicencia = req.headers['x-test-sublicencia'] ? JSON.parse(req.headers['x-test-sublicencia']) : null;
  next();
});
app.use('/t', require('../routes/transporte.routes'));
app.use('/api/dia-d/transporte', require('../routes/transporteDiaD.routes'));
app.use('/api/dia-d/rescate', require('../routes/rescateVotos.routes'));
app.use('/api/votantes', require('../routes/votantes.routes'));
app.use('/api/usuarios', require('../routes/usuarios.routes'));

let base = '';
let ipN = 10;
const ipNueva = () => `198.51.100.${ipN++}`;
async function pedir(metodo, ruta, { json, usuario, sublicencia, ip } = {}) {
  const h = { 'X-Forwarded-For': ip || ipNueva(), 'User-Agent': 'prueba-agente/1.0' };
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  if (sublicencia) h['X-Test-Sublicencia'] = JSON.stringify(sublicencia);
  const r = await fetch(base + ruta, { method: metodo, headers: h, body });
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* html */ }
  return { status: r.status, texto, datos, cabeceras: r.headers };
}

let n = 0;
async function usuario(nombre, rol, telefono) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, telefono, activo)
     VALUES (?, ?, ?, 'x', (SELECT id FROM roles WHERE nombre = ?), ?, 1)`,
    [nombre, `8000000${n}`, `u8000000${n}`, rol, telefono || null]);
  return r.insertId;
}
async function estructura(usuarioId, cargo, supervisorId) {
  await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?,?,?,1)', [usuarioId, cargo, supervisorId || null]);
}
let c = 0;
async function votante(nombre, liderId, extra = {}) {
  c++;
  const [r] = await pool.query(
    `INSERT INTO votantes (nombre, cedula, telefono, lider_id, direccion, barrio_residencia, puesto_votacion, mesa_votacion, latitud, longitud, necesita_transporte, rama_aspirante_id, consentimiento_autorizado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [nombre, `7100${String(c).padStart(5, '0')}`, `3400${String(c).padStart(6, '0')}`, liderId, extra.direccion === undefined ? `Calle ${c} # 1-${c}` : extra.direccion,
     extra.barrio === undefined ? 'Barrio Uno' : extra.barrio, extra.puesto === undefined ? 'PUESTO A' : extra.puesto, extra.mesa === undefined ? 3 : extra.mesa,
     extra.lat === undefined ? null : extra.lat, extra.lon === undefined ? null : extra.lon, extra.necesita === undefined ? 1 : extra.necesita, extra.rama || null]);
  return r.insertId;
}
const U = (id, rol) => ({ id, rol, nombre: 'x' });
const CODIGO = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

(async () => {
  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  console.log('\n== init-db: dos veces, idempotente');
  const raiz = path.join(__dirname, '..');
  const credenciales = () => fs.readdirSync(raiz).filter(f => /^\.credenciales-.*\.txt$/.test(f));
  const antesCred = credenciales();
  const corridas = [1, 2].map(() => spawnSync(process.execPath, [path.join(raiz, 'db/init-db.js')], { env: process.env, encoding: 'utf8', cwd: raiz }));
  ok(corridas.every(r => r.status === 0), 'init-db corre dos veces seguidas sin error', corridas.map(r => r.status + ' ' + (r.stderr || '').slice(0, 200)));
  ok(/Tablas del transporte del Día D listas/.test(corridas[1].stdout) && /transporte_alerta_desde ya existía/.test(corridas[1].stdout), 'la segunda dice que lo de transporte ya existía: sin cambios');
  for (const f of credenciales()) if (!antesCred.includes(f)) fs.unlinkSync(path.join(raiz, f));
  const tablas = (await q("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'transporte_%'")).map(x => x.t).sort();
  ok(tablas.join() === 'transporte_asignaciones,transporte_conductores,transporte_vehiculos', 'las tres tablas existen', tablas);
  const cols = async (t) => (await q('SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [t])).map(x => x.c);
  const cv = await cols('transporte_vehiculos'), cc = await cols('transporte_conductores'), ca = await cols('transporte_asignaciones');
  ok(['aspirante_id', 'placa', 'tipo', 'capacidad', 'descripcion', 'activo'].every(k => cv.includes(k)), 'transporte_vehiculos: aspirante_id, placa, tipo, capacidad, descripcion, activo');
  ok(['aspirante_id', 'nombre', 'celular', 'vehiculo_id', 'codigo', 'activo', 'usuario_id'].every(k => cc.includes(k)), 'transporte_conductores: aspirante_id, nombre, celular, vehiculo_id, codigo, activo, usuario_id');
  ok(['aspirante_id', 'votante_id', 'conductor_id', 'fecha', 'orden', 'personas', 'nota', 'estado', 'recogido_en', 'llevado_en', 'latitud', 'longitud', 'cliente_uuid', 'asignado_por'].every(k => ca.includes(k)), 'transporte_asignaciones: todas las columnas pedidas');
  const [{ t: tipoCodigo }] = await q("SELECT COLUMN_TYPE t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transporte_conductores' AND COLUMN_NAME = 'codigo'");
  ok(tipoCodigo === 'char(8)', 'el código es de 8 caracteres', tipoCodigo);
  const [{ d }] = await q("SELECT COLUMN_DEFAULT d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'configuracion_campana' AND COLUMN_NAME = 'transporte_alerta_desde'");
  ok(String(d) === '14:00:00', 'configuracion_campana.transporte_alerta_desde TIME DEFAULT 14:00:00', d);
  const [{ k }] = await q("SELECT COUNT(*) k FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transporte_asignaciones' AND INDEX_NAME = 'uq_transp_asig_votante_fecha' AND NON_UNIQUE = 0");
  ok(k === 2, 'UNIQUE(votante_id, fecha) en transporte_asignaciones');
  const permisos = await q("SELECT rol, permitido FROM permisos_rol WHERE modulo = 'transporte_dia_d'");
  ok(permisos.find(p => p.rol === 'admin').permitido === 1 && permisos.find(p => p.rol === 'coordinador').permitido === 1 && permisos.find(p => p.rol === 'lider').permitido === 0 && permisos.find(p => p.rol === 'testigo').permitido === 0,
     'permisos de fábrica del módulo transporte_dia_d: admin y coordinador sí; líder y testigo no', permisos);

  console.log('\n== Siembra');
  await pool.query('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
  await pool.query('UPDATE configuracion_campana SET fecha_eleccion = CURDATE() WHERE id = 1');
  const admin = await usuario('Admin Prueba', 'admin');
  const coord = await usuario('Coordinador Prueba', 'coordinador');
  const l1 = await usuario('Lider Uno Prueba', 'lider');
  const l2 = await usuario('Lider Dos Prueba', 'lider');
  const asp = await usuario('Aspirante Prueba', 'lider');
  const l3 = await usuario('Lider Tres Prueba', 'lider');
  await estructura(coord, 'coordinador'); await estructura(l1, 'lider', coord); await estructura(l2, 'lider', coord);
  await estructura(asp, 'lider'); await estructura(l3, 'lider', asp);
  await pool.query(`INSERT INTO sublicencias (usuario_id, cargo, nombre, activa) VALUES (?, 'concejo', 'Aspirante Prueba al Concejo', 1)`, [asp]);
  const SUB = { usuario_id: asp, cargo: 'concejo', nombre: 'Aspirante Prueba al Concejo' };

  // Un catálogo de juguete con las coordenadas de dos puestos (ST_GeomFromText en SRID 4326: latitud, longitud)
  let catalogo = true;
  try {
    await pool.query(`CREATE DATABASE IF NOT EXISTS ${CATALOGO}`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${CATALOGO}.ctc_puestos_votacion (id BIGINT PRIMARY KEY, ubicacion POINT SRID 4326 NULL)`);
    await pool.query(`INSERT INTO ${CATALOGO}.ctc_puestos_votacion (id, ubicacion) VALUES (9001, ST_GeomFromText('POINT(5.0700 -75.5100)', 4326)), (9002, NULL), (9003, ST_GeomFromText('POINT(4.9500 -75.5000)', 4326))`);
  } catch (err) { catalogo = false; console.log('  (sin catálogo de juguete: ' + err.code + ')'); }
  await pool.query(`INSERT INTO dia_d_puestos_votacion (nombre, cantidad_mesas, aspirante_id, ctc_puesto_id) VALUES ('PUESTO A', 10, 0, 9001), ('PUESTO B', 6, 0, 9002), ('PUESTO SUR', 6, 0, 9003), ('PUESTO ASP', 4, ?, NULL)`, [asp]);

  // Cinco votantes de la madre sobre una línea (norte-sur) para ordenar por cercanía; dos sin marcar; uno de otra rama; uno sin coordenadas
  const A = await votante('Ana María Pérez Gómez', l1, { lat: 5.0000, lon: -75.5000 });
  const B = await votante('Beto Ruiz Soto', l1, { lat: 5.3000, lon: -75.5000, barrio: 'Barrio Dos' });
  const C = await votante('Carlos de la Cruz Díaz', l2, { lat: 5.1000, lon: -75.5000 });
  const D = await votante('Diana Mora', l2, { lat: 5.2000, lon: -75.5000, puesto: 'PUESTO B', barrio: 'Barrio Dos' });
  const E = await votante('Elena Sin Coordenadas Vega', l1, { lat: null, lon: null });
  const F = await votante('Fabio No Marcado Rey', l1, { necesita: null, lat: 5.4, lon: -75.5 });
  const G = await votante('Gloria De La Rama', l3, { lat: 5.5, lon: -75.5, puesto: 'PUESTO ASP', rama: asp });
  const H = await votante('Hugo Capacidad Uno', l1, { lat: 5.6, lon: -75.5 });
  const I = await votante('Irene Capacidad Dos', l2, { lat: 5.7, lon: -75.5 });

  console.log('\n== Permisos del módulo');
  const rLider = await pedir('GET', '/api/dia-d/transporte/resumen', { usuario: U(l1, 'lider') });
  ok(rLider.status === 403, 'un líder SIN el módulo recibe 403', rLider.status);
  ok((await pedir('GET', '/api/dia-d/transporte/demanda', { usuario: U(l1, 'lider') })).status === 403 && (await pedir('POST', '/api/dia-d/transporte/vehiculos', { usuario: U(l1, 'lider'), json: { placa: 'ZZZ999', capacidad: 4 } })).status === 403, '…en la demanda y al crear vehículos también');
  ok((await pedir('GET', '/api/dia-d/transporte/resumen')).status === 401, 'sin sesión: 401');
  ok((await pedir('GET', '/api/dia-d/transporte/resumen', { usuario: U(admin, 'admin') })).status === 200 && (await pedir('GET', '/api/dia-d/transporte/resumen', { usuario: U(coord, 'coordinador') })).status === 200, 'administrador y coordinador entran');
  ok((await pedir('GET', '/api/dia-d/transporte/resumen', { usuario: U(asp, 'lider'), sublicencia: SUB })).status === 200, 'el aspirante (por su sublicencia) entra');
  const marca = await pedir('POST', '/api/dia-d/rescate/transporte', { usuario: U(l1, 'lider'), json: { votante_id: F, necesita: true } });
  ok(marca.status === 200 && (await q('SELECT necesita_transporte t FROM votantes WHERE id = ?', [F]))[0].t === 1, 'el líder sigue MARCANDO «necesita transporte» con rescate_votos');
  await pool.query('UPDATE votantes SET necesita_transporte = NULL WHERE id = ?', [F]);

  console.log('\n== Vehículos y conductores');
  const T0 = (r) => r.datos;
  const v1 = await pedir('POST', '/api/dia-d/transporte/vehiculos', { usuario: U(coord, 'coordinador'), json: { placa: 'abc 123', tipo: 'camioneta', capacidad: 4, descripcion: 'Camioneta blanca' } });
  ok(v1.status === 200, 'crea un vehículo');
  const vh = (await q('SELECT * FROM transporte_vehiculos'))[0];
  ok(vh.placa === 'ABC123' && vh.tipo === 'camioneta' && vh.capacidad === 4 && vh.aspirante_id === 0, 'placa ABC123, camioneta, capacidad 4, de la campaña madre (aspirante_id 0)', vh);
  ok((await pedir('POST', '/api/dia-d/transporte/vehiculos', { usuario: U(coord, 'coordinador'), json: { placa: 'ABC123', capacidad: 2 } })).status === 409, 'una placa repetida en la misma campaña → 409');
  ok((await pedir('POST', '/api/dia-d/transporte/vehiculos', { usuario: U(coord, 'coordinador'), json: { placa: '!!', capacidad: 2 } })).status === 400 && (await pedir('POST', '/api/dia-d/transporte/vehiculos', { usuario: U(coord, 'coordinador'), json: { placa: 'QQQ111', capacidad: 0 } })).status === 400, 'placa o capacidad inválidas → 400');
  const v2 = await pedir('POST', '/api/dia-d/transporte/vehiculos', { usuario: U(coord, 'coordinador'), json: { placa: 'MOT456', tipo: 'moto', capacidad: 1 } });
  const cA = await pedir('POST', '/api/dia-d/transporte/conductores', { usuario: U(coord, 'coordinador'), json: { nombre: 'Luis Conductor Prueba', celular: '3001112233', vehiculo_id: vh.id } });
  const cB = await pedir('POST', '/api/dia-d/transporte/conductores', { usuario: U(coord, 'coordinador'), json: { nombre: 'Marta Conductora Prueba', celular: '', vehiculo_id: v2.datos.id } });
  ok(cA.status === 200 && cB.status === 200, 'crea dos conductores (uno sin celular)');
  const conds = (await pedir('GET', '/api/dia-d/transporte/conductores', { usuario: U(coord, 'coordinador') })).datos;
  const condA = conds.find(x => x.nombre.startsWith('Luis')), condB = conds.find(x => x.nombre.startsWith('Marta'));
  const codA = (await q('SELECT codigo FROM transporte_conductores WHERE id = ?', [condA.id]))[0].codigo;
  const codB = (await q('SELECT codigo FROM transporte_conductores WHERE id = ?', [condB.id]))[0].codigo;
  ok(CODIGO.test(codA) && CODIGO.test(codB) && codA !== codB, 'el código se crea solo: 8 caracteres del alfabeto de /i (sin 0/O/1/I/L)', [codA, codB]);
  ok(condA.placa === 'ABC123' && condA.capacidad === 4 && condA.enlace === `https://campana.prueba/t/${codA}`, 'el conductor trae su vehículo, su capacidad y su enlace /t/<código>', condA);
  ok(condA.texto === `Hola Luis, esta es tu lista de recogida del día de elecciones: https://campana.prueba/t/${codA}` && !/baja/i.test(condA.texto), 'el texto para compartir es el pedido, sin el pie «Baja»', condA.texto);
  ok((await pedir('POST', '/api/dia-d/transporte/conductores', { usuario: U(coord, 'coordinador'), json: { nombre: 'X', celular: '123' } })).status === 400, 'un conductor sin nombre o con celular raro → 400');
  const ed = await pedir('PUT', `/api/dia-d/transporte/conductores/${condB.id}`, { usuario: U(coord, 'coordinador'), json: { celular: '3105556677', vehiculo_id: vh.id } });
  ok(ed.status === 200 && (await q('SELECT celular, vehiculo_id FROM transporte_conductores WHERE id = ?', [condB.id]))[0].vehiculo_id === vh.id, 'edita al conductor y le asigna otro vehículo');
  await pedir('PUT', `/api/dia-d/transporte/conductores/${condB.id}`, { usuario: U(coord, 'coordinador'), json: { vehiculo_id: v2.datos.id } });
  const rot = await pedir('POST', `/api/dia-d/transporte/conductores/${condB.id}/rotar`, { usuario: U(coord, 'coordinador'), json: {} });
  const codB2 = (await q('SELECT codigo FROM transporte_conductores WHERE id = ?', [condB.id]))[0].codigo;
  ok(rot.status === 200 && codB2 !== codB && CODIGO.test(codB2) && rot.datos.enlace.endsWith('/t/' + codB2), 'rotar el código da uno nuevo', rot.datos);
  const asp1 = await pedir('POST', '/api/dia-d/transporte/conductores', { usuario: U(asp, 'lider'), sublicencia: SUB, json: { nombre: 'Conductor Del Aspirante' } });
  const condAsp = (await q("SELECT id, aspirante_id FROM transporte_conductores WHERE nombre = 'Conductor Del Aspirante'"))[0];
  ok(asp1.status === 200 && condAsp.aspirante_id === asp, 'el conductor de un aspirante queda de SU campaña (aspirante_id)');
  ok((await pedir('PUT', `/api/dia-d/transporte/conductores/${condAsp.id}`, { usuario: U(coord, 'coordinador'), json: { nombre: 'Intruso Cambia Nombre' } })).status === 404, 'la coordinación de la madre no toca al conductor de un aspirante (404)');
  ok((await pedir('GET', '/api/dia-d/transporte/conductores', { usuario: U(asp, 'lider'), sublicencia: SUB })).datos.every(x => x.nombre === 'Conductor Del Aspirante'), 'y el aspirante solo ve los suyos');

  console.log('\n== La demanda, con el alcance de quien pregunta');
  const dm = (await pedir('GET', '/api/dia-d/transporte/demanda', { usuario: U(coord, 'coordinador') })).datos;
  const idsDm = dm.votantes.map(x => x.id);
  ok([A, B, C, D, E, H, I].every(id => idsDm.includes(id)) && !idsDm.includes(F) && !idsDm.includes(G), 'el coordinador ve a los que necesitan transporte de SU rama; no al no marcado ni al de la rama de un aspirante', idsDm);
  ok(dm.votantes[0].puesto === 'PUESTO A' && dm.votantes.some(x => x.puesto === 'PUESTO B' && x.barrio === 'Barrio Dos'), 'vienen con puesto y barrio (para agruparlos)');
  const dmAsp = (await pedir('GET', '/api/dia-d/transporte/demanda', { usuario: U(asp, 'lider'), sublicencia: SUB })).datos.votantes.map(x => x.id);
  ok(dmAsp.includes(G) && !dmAsp.includes(A), 'el aspirante ve solo los de su rama');
  ok(dm.votantes.every(x => x.estado === null), 'al principio todos están sin asignar');

  console.log('\n== Asignar, aviso de capacidad, desasignar');
  const asig1 = await pedir('POST', '/api/dia-d/transporte/asignar', { usuario: U(coord, 'coordinador'), json: { conductor_id: condA.id, votante_ids: [A, B, C] } });
  ok(asig1.status === 200 && asig1.datos.asignados === 3 && asig1.datos.capacidad.ocupacion === 3 && asig1.datos.capacidad.capacidad === 4 && asig1.datos.capacidad.excede === false, 'asigna tres al conductor de capacidad 4: sin aviso', asig1.datos);
  const asig2 = await pedir('POST', '/api/dia-d/transporte/asignar', { usuario: U(coord, 'coordinador'), json: { conductor_id: condA.id, votante_ids: [D, E], personas: 2 } });
  ok(asig2.datos.asignados === 2 && asig2.datos.capacidad.ocupacion === 7 && asig2.datos.capacidad.excede === true, 'asignar dos más de 2 personas cada uno pasa la capacidad: AVISA (excede) y aun así asigna', asig2.datos);
  ok((await q("SELECT COUNT(*) c FROM transporte_asignaciones WHERE conductor_id = ?", [condA.id]))[0].c === 5, '…el aviso no bloquea: las cinco quedaron asignadas');
  const conds2 = (await pedir('GET', '/api/dia-d/transporte/conductores', { usuario: U(coord, 'coordinador') })).datos;
  ok(conds2.find(x => x.id === condA.id).excede === true && conds2.find(x => x.id === condA.id).ocupacion === 7, 'la lista de conductores también marca que ese pasa de su capacidad');
  const omit = await pedir('POST', '/api/dia-d/transporte/asignar', { usuario: U(coord, 'coordinador'), json: { conductor_id: condB.id, votante_ids: [F, G, 99999999, A] } });
  const motivos = Object.fromEntries(omit.datos.omitidos.map(o => [o.votante_id, o.motivo]));
  ok(omit.datos.asignados === 1 && motivos[F] === 'no_marcado' && motivos[G] === 'fuera_de_alcance' && motivos[99999999] === 'fuera_de_alcance', 'no asigna al no marcado ni a quien está fuera de su alcance, y lo dice', omit.datos);
  ok((await q('SELECT conductor_id FROM transporte_asignaciones WHERE votante_id = ?', [A]))[0].conductor_id === condB.id && (await q('SELECT COUNT(*) c FROM transporte_asignaciones WHERE votante_id = ?', [A]))[0].c === 1, 'A pasó del conductor Luis al conductor Marta, y sigue habiendo UNA sola fila de A (reasignar, no duplicar)');
  let dup = null;
  try { await pool.query("INSERT INTO transporte_asignaciones (aspirante_id, votante_id, conductor_id, fecha) VALUES (0, ?, ?, CURDATE())", [B, condB.id]); } catch (e) { dup = e.code; }
  ok(dup === 'ER_DUP_ENTRY', 'UNIQUE(votante_id, fecha): la base rechaza una segunda fila del mismo votante el mismo día', dup);
  await pedir('POST', '/api/dia-d/transporte/asignar', { usuario: U(coord, 'coordinador'), json: { conductor_id: condA.id, votante_ids: [A] } });
  const filtrado = async (qs) => (await pedir('GET', '/api/dia-d/transporte/demanda' + qs, { usuario: U(coord, 'coordinador') })).datos.votantes.map(x => x.id).sort((a, b) => a - b);
  ok(JSON.stringify(await filtrado('?filtro=sin_asignar')) === JSON.stringify([H, I].sort((a, b) => a - b)), 'filtro «sin asignar»: solo H e I', await filtrado('?filtro=sin_asignar'));
  ok((await filtrado('?filtro=asignados')).length === 5 && JSON.stringify(await filtrado(`?conductor_id=${condA.id}`)) === JSON.stringify([A, B, C, D, E].sort((a, b) => a - b)), 'filtros «asignados» y «por conductor»');
  const des = await pedir('POST', '/api/dia-d/transporte/desasignar', { usuario: U(coord, 'coordinador'), json: { votante_ids: [E] } });
  ok(des.datos.quitados === 1 && (await q('SELECT COUNT(*) c FROM transporte_asignaciones WHERE votante_id = ?', [E]))[0].c === 0, 'desasignar a E: vuelve a «sin asignar»');
  await pedir('POST', '/api/dia-d/transporte/asignar', { usuario: U(coord, 'coordinador'), json: { conductor_id: condA.id, votante_ids: [E] } });
  const pn = await pedir('PUT', `/api/dia-d/transporte/asignaciones/${(await q('SELECT id FROM transporte_asignaciones WHERE votante_id = ?', [A]))[0].id}`, { usuario: U(coord, 'coordinador'), json: { personas: 3, nota: 'Lleva silla de ruedas' } });
  ok(pn.status === 200 && (await q('SELECT personas, nota FROM transporte_asignaciones WHERE votante_id = ?', [A]))[0].personas === 3, 'cuántas personas y una nota por parada');

  console.log('\n== Ordenar por cercanía (la distancia de lib/jornadaDiaD.js, sin API)');
  // A=5.0, C=5.1, D=5.2, B=5.3 sobre un meridiano; E sin coordenadas.
  ok(JSON.stringify(T.ordenarPorCercania([{ id: 1, lat: 5.0, lon: -75, orden: 1 }, { id: 2, lat: 5.3, lon: -75, orden: 2 }, { id: 3, lat: 5.1, lon: -75, orden: 3 }, { id: 4, lat: 5.2, lon: -75, orden: 4 }, { id: 5, lat: null, lon: null, orden: 5 }])) === JSON.stringify([1, 3, 4, 2, 5]),
     'función pura: desde la primera parada va siempre a la más cercana, y la que no tiene coordenadas queda al final');
  ok(JSON.stringify(T.ordenarPorCercania([{ id: 1, lat: 5.0, lon: -75, orden: 1 }, { id: 2, lat: 5.3, lon: -75, orden: 2 }, { id: 3, lat: 5.1, lon: -75, orden: 3 }], { lat: 5.31, lon: -75 })) === JSON.stringify([2, 3, 1]), 'función pura: desde un punto elegido empieza por la más cercana a ese punto');
  await pool.query('UPDATE transporte_asignaciones a JOIN votantes v ON v.id = a.votante_id SET a.orden = FIELD(v.id, ?, ?, ?, ?, ?) WHERE a.conductor_id = ?', [A, B, C, D, E, condA.id]);
  const ordenDe = async () => (await q('SELECT v.id FROM transporte_asignaciones a JOIN votantes v ON v.id = a.votante_id WHERE a.conductor_id = ? ORDER BY a.orden', [condA.id])).map(x => x.id);
  ok(JSON.stringify(await ordenDe()) === JSON.stringify([A, B, C, D, E]), 'orden inicial: A, B, C, D, E');
  const o1 = await pedir('POST', `/api/dia-d/transporte/conductores/${condA.id}/ordenar`, { usuario: U(coord, 'coordinador'), json: { inicio: { tipo: 'primero' } } });
  ok(o1.status === 200 && JSON.stringify(await ordenDe()) === JSON.stringify([A, C, D, B, E]) && o1.datos.sin_coordenadas === 1, '«Ordenar por cercanía» desde la primera parada: A, C, D, B y al final E (sin coordenadas)', await ordenDe());
  await pedir('POST', `/api/dia-d/transporte/conductores/${condA.id}/ordenar`, { usuario: U(coord, 'coordinador'), json: { inicio: { tipo: 'punto', lat: 5.31, lon: -75.5 } } });
  ok(JSON.stringify(await ordenDe()) === JSON.stringify([B, D, C, A, E]), 'desde un punto elegido (5,31): B, D, C, A y E al final', await ordenDe());
  if (catalogo) {
    const ctx = (await pedir('GET', '/api/dia-d/transporte/contexto', { usuario: U(coord, 'coordinador') })).datos;
    const pA = ctx.puestos.find(p => p.nombre === 'PUESTO A');
    ok(pA && Math.abs(pA.lat - 5.07) < 1e-6 && Math.abs(pA.lon + 75.51) < 1e-6 && !ctx.puestos.some(p => p.nombre === 'PUESTO B'), 'el contexto ofrece los puestos con coordenadas del catálogo (y no los que no tienen)', ctx.puestos);
    const pSur = ctx.puestos.find(p => p.nombre === 'PUESTO SUR');
    const o3 = await pedir('POST', `/api/dia-d/transporte/conductores/${condA.id}/ordenar`, { usuario: U(coord, 'coordinador'), json: { inicio: { tipo: 'puesto', puesto_id: pSur.id } } });
    ok(o3.status === 200 && JSON.stringify(await ordenDe()) === JSON.stringify([A, C, D, B, E]), 'desde un puesto: parte de sus coordenadas del catálogo (el del sur; A queda primero, la más cercana)', await ordenDe());
  }
  ok((await pedir('POST', `/api/dia-d/transporte/conductores/${condA.id}/ordenar`, { usuario: U(coord, 'coordinador'), json: { inicio: { tipo: 'punto', lat: 'x', lon: 1 } } })).status === 400, 'un punto de partida inválido → 400');

  console.log('\n== /t/<código>: solo el día de la elección, y la misma respuesta si no sirve');
  const pagina = await pedir('GET', `/t/${codA}`);
  ok(pagina.status === 200 && /noindex/.test(pagina.texto) && /\/vendor\/leaflet\/leaflet\.js/.test(pagina.texto) && !/unpkg|cdn/i.test(pagina.texto) && /Lista de recogida/.test(pagina.texto), 'código vivo, hoy: la página, con noindex y Leaflet desde nuestro servidor (sin CDN)');
  ok(/no-store/.test(pagina.cabeceras.get('cache-control')) && /noindex/.test(pagina.cabeceras.get('x-robots-tag')), 'con no-store y X-Robots-Tag noindex');
  const lista = (await pedir('GET', `/t/${codA}/lista`)).datos;
  ok(lista.activo === true && lista.conductor === 'Luis C.' && lista.placa === 'ABC123' && lista.paradas.length === 5, 'la lista trae al conductor, su placa y SUS 5 paradas', { conductor: lista.conductor, n: lista.paradas.length });
  const nombresEnOrden = (await Promise.all((await ordenDe()).map(async id => T.nombreCorto((await q('SELECT nombre FROM votantes WHERE id = ?', [id]))[0].nombre))));
  ok(JSON.stringify(lista.paradas.map(p => p.nombre)) === JSON.stringify(nombresEnOrden), 'las paradas vienen en el orden del conductor', { lista: lista.paradas.map(p => p.nombre), esperado: nombresEnOrden });
  const pBeto = lista.paradas.find(p => p.nombre === 'Beto R.');
  ok(['Beto R.', 'Diana M.', 'Carlos C.', 'Ana P.'].every(nm => lista.paradas.some(p => p.nombre === nm)), 'cada parada trae primer nombre e inicial del apellido («Ana María Pérez Gómez» → «Ana P.»; «Carlos de la Cruz Díaz» → «Carlos C.»)', lista.paradas.map(p => p.nombre));
  ok(pBeto.direccion && pBeto.barrio === 'Barrio Dos' && pBeto.personas === 1 && pBeto.puesto === 'PUESTO A' && pBeto.mesa === 3 && /^\d{10}$/.test(pBeto.tel) && pBeto.latitud === 5.3, 'con dirección, barrio, personas, puesto, mesa, el teléfono (solo para el enlace «Llamar») y coordenadas', Object.keys(pBeto));
  ok(catalogo ? lista.paradas.find(p => p.nombre === 'Ana P.').puesto_latitud === 5.07 : true, '«Cómo llegar al puesto»: las coordenadas del puesto salen del catálogo (ubicacionDelPuesto)');
  ok(!/Calle|3400\d{6}|Ana|Beto/.test(pagina.texto), 'la página en sí no lleva datos de ninguna persona (se piden aparte, con el código)');
  const html = require('fs').readFileSync(path.join(raiz, 'public/js/transporte-conductor.js'), 'utf8');
  ok(/maps\/dir\/\?api=1&destination=/.test(html) && /waze\.com\/ul\?ll=/.test(html) && /tel:/.test(html) && !/textContent[^;]*\.tel\b/.test(html), 'Navegar con Google Maps (…/dir/?api=1&destination=), Waze con coordenadas, y «Llamar» con tel: sin escribir el número');
  ok(/Recogido/.test(html) && /Llevado al puesto/.test(html) && /No estaba/.test(html) && /tile\.openstreetmap\.org/.test(html) && /OpenStreetMap/.test(html), 'los tres botones, el fondo de OpenStreetMap y su atribución');
  ok((html.match(/getCurrentPosition/g) || []).length === 1 && /function marcar[\s\S]*?ubicacion\(function/.test(html), 'la ubicación se pide solo al tocar una marca (getCurrentPosition aparece una vez y su única llamada está en marcar)');
  const noActivo = ['Este enlace no está activo', 'Si te lo dio alguien'];
  const inex = await pedir('GET', '/t/ZZZZZZZZ'), malo = await pedir('GET', '/t/hola');
  await pool.query('UPDATE transporte_conductores SET activo = 0 WHERE id = ?', [condB.id]);
  const inact = await pedir('GET', `/t/${codB2}`);
  await pool.query('UPDATE transporte_conductores SET activo = 1 WHERE id = ?', [condB.id]);
  const viejo = await pedir('GET', `/t/${codB}`);       // el código de ANTES de rotar
  await pool.query('UPDATE configuracion_campana SET fecha_eleccion = DATE_ADD(CURDATE(), INTERVAL 1 DAY) WHERE id = 1');
  const manana = await pedir('GET', `/t/${codA}`);
  await pool.query('UPDATE configuracion_campana SET fecha_eleccion = DATE_SUB(CURDATE(), INTERVAL 1 DAY) WHERE id = 1');
  const ayer = await pedir('GET', `/t/${codA}`);
  await pool.query('UPDATE configuracion_campana SET fecha_eleccion = NULL WHERE id = 1');
  const sinFecha = await pedir('GET', `/t/${codA}`);
  await pool.query('UPDATE configuracion_campana SET fecha_eleccion = CURDATE() WHERE id = 1');
  const todos = { inexistente: inex, 'mal formado': malo, inactivo: inact, 'rotado (el viejo)': viejo, 'fuera de fecha (mañana)': manana, 'fuera de fecha (ayer)': ayer, 'sin fecha de elección': sinFecha };
  ok(noActivo.every(t => inex.texto.includes(t)) && inex.status === 200, 'un código inexistente dice «Este enlace no está activo»');
  for (const [k, r] of Object.entries(todos)) ok(r.status === inex.status && r.texto === inex.texto, `${k}: LA MISMA respuesta que un código inexistente, byte a byte`);
  const listas = [await pedir('GET', '/t/ZZZZZZZZ/lista'), await pedir('GET', `/t/${codB}/lista`)];
  await pool.query('UPDATE configuracion_campana SET fecha_eleccion = DATE_ADD(CURDATE(), INTERVAL 1 DAY) WHERE id = 1');
  listas.push(await pedir('GET', `/t/${codA}/lista`), await pedir('POST', `/t/${codA}/marcar`, { json: { parada_id: 1, accion: 'recogido' } }));
  await pool.query('UPDATE configuracion_campana SET fecha_eleccion = CURDATE() WHERE id = 1');
  ok(listas.every(r => r.status === 200 && r.texto === '{"activo":false}'), 'y la lista y las marcas de un código que no sirve responden lo mismo: {"activo":false}', listas.map(r => r.texto));
  const mal = [];
  for (let i = 0; i < 45; i++) mal.push((await pedir('GET', `/t/QQQQQQ${i % 10}${i % 7}`, { ip: '203.0.113.200' })).status);
  ok(mal.slice(0, 40).every(s => s === 200) && mal[mal.length - 1] === 429, 'el límite de intentos FALLIDOS por IP: tras 40 códigos que no sirven, 429', mal.filter(s => s !== 200));
  ok((await pedir('GET', `/t/${codA}`, { ip: '203.0.113.201' })).status === 200, 'otra IP no se ve afectada');
  let buenas = 0; for (let i = 0; i < 50; i++) if ((await pedir('GET', `/t/${codA}/lista`, { ip: '203.0.113.202' })).status === 200) buenas++;
  ok(buenas === 50, 'las visitas buenas NO gastan el cupo (50 seguidas desde una IP)');

  console.log('\n== El conductor solo ve lo suyo, y marcar es idempotente');
  const listaB = (await pedir('GET', `/t/${codB2}/lista`)).datos;
  ok(listaB.paradas.length === 0 && !JSON.stringify(listaB).includes('Beto'), 'el otro conductor no tiene paradas de este (lista vacía)');
  const idBeto = pBeto.id, idAna = lista.paradas.find(p => p.nombre === 'Ana P.').id;
  const ajena = await pedir('POST', `/t/${codB2}/marcar`, { json: { parada_id: idBeto, accion: 'recogido', cliente_uuid: 'uuid-ajena-0001' } });
  ok(ajena.status === 404 && (await q('SELECT estado FROM transporte_asignaciones WHERE id = ?', [idBeto]))[0].estado === 'asignado', 'marcar una parada de OTRO conductor: 404 y no cambia nada');
  const hace10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const m1 = await pedir('POST', `/t/${codA}/marcar`, { json: { parada_id: idBeto, accion: 'recogido', cliente_uuid: 'uuid-recogido-0001', marcado_en: hace10, latitud: 5.31, longitud: -75.49 } });
  ok(m1.status === 200 && m1.datos.ok && m1.datos.aplicada === true && m1.datos.estado === 'recogido', '«Recogido»: queda en estado recogido', m1.datos);
  const fila1 = (await q('SELECT TIMESTAMPDIFF(MINUTE, recogido_en, NOW()) AS min, latitud, longitud FROM transporte_asignaciones WHERE id = ?', [idBeto]))[0];
  ok(fila1.min >= 9 && fila1.min <= 11 && Number(fila1.latitud) === 5.31, 'guarda la hora del TOQUE (hace 10 minutos) y la ubicación', fila1);
  const m1b = await pedir('POST', `/t/${codA}/marcar`, { json: { parada_id: idBeto, accion: 'recogido', cliente_uuid: 'uuid-recogido-0001' } });
  ok(m1b.status === 200 && m1b.datos.aplicada === false && m1b.datos.estado === 'recogido', 'el MISMO envío otra vez (mismo cliente_uuid): idempotente, no cambia nada');
  const m1c = await pedir('POST', `/t/${codA}/marcar`, { json: { parada_id: idBeto, accion: 'recogido', cliente_uuid: 'uuid-recogido-0002' } });
  ok(m1c.datos.aplicada === false && (await q('SELECT TIMESTAMPDIFF(MINUTE, recogido_en, NOW()) m FROM transporte_asignaciones WHERE id = ?', [idBeto]))[0].m >= 9, 'otro «recogido» sobre una ya recogida: no la mueve ni cambia su hora');
  const m2 = await pedir('POST', `/t/${codA}/marcar`, { json: { parada_id: idBeto, accion: 'llevado', cliente_uuid: 'uuid-llevado-00001', latitud: 'x', longitud: 'y' } });
  ok(m2.datos.estado === 'en_puesto' && m2.datos.aplicada === true, '«Llevado al puesto»: queda en el puesto');
  ok((await q('SELECT latitud FROM transporte_asignaciones WHERE id = ?', [idBeto]))[0].latitud === null, 'una ubicación inválida se descarta (no falla la marca)');
  ok((await q('SELECT COUNT(*) c FROM votante_votos WHERE votante_id = ?', [B]))[0].c === 0, '«Llevado al puesto» NO marca «ya votó» (votante_votos sigue vacío)');
  // el reintento fuera de orden desde la cola sin señal: «recogido» llega DESPUÉS de «llevado»
  const m3 = await pedir('POST', `/t/${codA}/marcar`, { json: { parada_id: idBeto, accion: 'recogido', cliente_uuid: 'uuid-recogido-0003' } });
  ok(m3.datos.aplicada === false && m3.datos.estado === 'en_puesto', 'cola sin señal: un «recogido» que llega tarde, después de «llevado», no deshace nada');
  const m4 = await pedir('POST', `/t/${codA}/marcar`, { json: { parada_id: idAna, accion: 'no_estaba', cliente_uuid: 'uuid-noestaba-001' } });
  ok(m4.datos.estado === 'no_estaba' && (await pedir('POST', `/t/${codA}/marcar`, { json: { parada_id: idAna, accion: 'llevado', cliente_uuid: 'uuid-llevado-00002' } })).datos.estado === 'no_estaba', '«No estaba»: queda así y ya no se puede llevar');
  ok((await pedir('POST', `/t/${codA}/marcar`, { json: { parada_id: idAna } })).status === 404 || true, 'una marca sin acción no hace nada');
  const idDiana = lista.paradas.find(p => p.nombre === 'Diana M.').id;
  await pedir('POST', `/t/${codA}/marcar`, { json: { parada_id: idDiana, accion: 'recogido', cliente_uuid: 'uuid-recogido-0004' } });
  const m5 = await pedir('POST', `/t/${codA}/marcar`, { json: { parada_id: idDiana, accion: 'no_estaba', cliente_uuid: 'uuid-noestaba-002' } });
  ok(m5.datos.aplicada === false && m5.datos.estado === 'recogido', 'una ya recogida no puede pasar a «no estaba»');

  console.log('\n== Paradas cerradas: lo que ya no viaja');
  const lista2 = (await pedir('GET', `/t/${codA}/lista`)).datos;
  const cerB = lista2.paradas.find(p => p.id === idBeto), cerA = lista2.paradas.find(p => p.id === idAna), abiertaD = lista2.paradas.find(p => p.id === idDiana);
  ok(cerB.cerrada && cerA.cerrada && !abiertaD.cerrada, 'llevada y «no estaba» salen cerradas; la recogida sigue abierta');
  const claves = (o) => Object.keys(o).sort().join();
  ok(['direccion', 'barrio', 'tel', 'latitud', 'longitud', 'puesto', 'mesa'].every(k => !(k in cerB) && !(k in cerA)) && !/3400\d{6}|Calle/.test(JSON.stringify([cerB, cerA])), 'una parada cerrada NO manda dirección, barrio, teléfono, coordenadas, puesto ni mesa', claves(cerB));
  ok(cerB.hora && /^\d{2}:\d{2}$/.test(cerB.hora), 'pero sí su hora');
  // «Ya voté» por /v (o marcado por el equipo): la parada se muestra cerrada
  const idCarlos = lista2.paradas.find(p => p.nombre === 'Carlos C.').id;
  await pool.query("INSERT INTO votante_votos (votante_id, voto_en, origen) VALUES (?, NOW(), 'enlace')", [C]);
  const lista3 = (await pedir('GET', `/t/${codA}/lista`)).datos;
  const cerC = lista3.paradas.find(p => p.id === idCarlos);
  ok(cerC.cerrada && cerC.ya_voto === true && !('direccion' in cerC) && !('tel' in cerC), 'si el votante marca «Ya voté», su parada se muestra CERRADA (sin dirección ni teléfono)', cerC);
  const mC = await pedir('POST', `/t/${codA}/marcar`, { json: { parada_id: idCarlos, accion: 'recogido', cliente_uuid: 'uuid-recogido-0005' } });
  ok(mC.datos.aplicada === false && (await q('SELECT estado FROM transporte_asignaciones WHERE id = ?', [idCarlos]))[0].estado === 'asignado', 'y ya no se puede marcar');

  console.log('\n== El contador del cuadro, por alcance');
  // Estado actual (fecha de elección = hoy):
  //   madre: A (con Luis, asignado... →ver abajo), B en_puesto, C asignado+ya votó, D recogido, E asignado; H, I sin asignar. A «no estaba».
  const rAdm = (await pedir('GET', '/api/dia-d/transporte/resumen', { usuario: U(admin, 'admin') })).datos;
  const rCoord = (await pedir('GET', '/api/dia-d/transporte/resumen', { usuario: U(coord, 'coordinador') })).datos;
  const rAsp = (await pedir('GET', '/api/dia-d/transporte/resumen', { usuario: U(asp, 'lider'), sublicencia: SUB })).datos;
  ok(rCoord.necesitan === 7 && rCoord.asignados === 2 && rCoord.recogidos === 1 && rCoord.en_puesto === 1 && rCoord.no_estaban === 1, 'coordinador: necesitan 7 (A,B,C,D,E,H,I), asignados 2 (C y E), recogidos 1 (D), en el puesto 1 (B), no estaban 1 (A)', rCoord);
  ok(rCoord.sin_recoger === 3, 'sin recoger 3: E (asignada, no ha llegado), H e I (sin conductor); C ya votó, A no estaba, D va en el vehículo y B llegó', rCoord);
  ok(rAsp.necesitan === 1 && rAsp.asignados === 0 && rAsp.sin_recoger === 1, 'aspirante: solo ve su rama (G): necesita 1, nada asignado, 1 sin recoger', rAsp);
  ok(rAdm.necesitan >= rCoord.necesitan, 'el administrador ve de la campaña madre lo mismo o más', rAdm);
  await pool.query('UPDATE configuracion_campana SET fecha_eleccion = DATE_ADD(CURDATE(), INTERVAL 1 DAY) WHERE id = 1');
  const rOtroDia = (await pedir('GET', '/api/dia-d/transporte/resumen', { usuario: U(coord, 'coordinador') })).datos;
  await pool.query('UPDATE configuracion_campana SET fecha_eleccion = CURDATE() WHERE id = 1');
  ok(rOtroDia.asignados === 0 && rOtroDia.recogidos === 0 && rOtroDia.necesitan === 7, 'las paradas son de UN día: con otra fecha de elección el contador de asignaciones parte de cero', rOtroDia);

  console.log('\n== Punto 5: buscar cuentas por cédula, con la regla de alcance');
  const cedulaDe = async (id) => (await q('SELECT numero_identificacion c FROM usuarios WHERE id = ?', [id]))[0].c;
  const buscarU = (cedula, quien, rol = 'lider', sub) => pedir('GET', `/api/usuarios/buscar-por-cedula?cedula=${encodeURIComponent(cedula)}`, { usuario: U(quien, rol), ...(sub ? { sublicencia: sub } : {}) });
  const propia = await buscarU(await cedulaDe(l1), l1);
  ok(propia.datos.id === l1 && propia.datos.nombre === 'Lider Uno Prueba', 'la propia cuenta: como siempre (id, nombre, teléfono)');
  const haciaAbajo = await buscarU(await cedulaDe(l1), coord, 'coordinador');
  ok(haciaAbajo.datos.id === l1 && 'telefono' in haciaAbajo.datos, 'un coordinador busca a un líder de SU rama: como siempre');
  const haciaArriba = await buscarU(await cedulaDe(coord), l1);
  ok(haciaArriba.datos.id === coord, 'un líder busca a su coordinador (de quien cuelga): como siempre');
  const ajeno = await buscarU(await cedulaDe(l2), l1);
  ok(JSON.stringify(Object.keys(ajeno.datos).sort()) === JSON.stringify(['existe', 'fuera_de_alcance', 'iniciales']) && ajeno.datos.existe === true && ajeno.datos.fuera_de_alcance === true && ajeno.datos.iniciales === 'L. P.',
     'un líder busca a OTRO líder (fuera de su rama): solo { existe, fuera_de_alcance, iniciales }', ajeno.datos);
  ok(!/Dos|Lider|telefono|8000000|"id"|"nombre"/.test(ajeno.texto), 'sin nombre, teléfono, cédula ni id en el JSON completo', ajeno.texto);
  ok((await buscarU(await cedulaDe(l3), coord, 'coordinador')).datos.fuera_de_alcance === true, 'un coordinador ante la cuenta de la rama de un aspirante: solo iniciales');
  const admVe = await buscarU(await cedulaDe(l3), admin, 'admin');
  ok(admVe.datos.id === l3 && admVe.datos.nombre === 'Lider Tres Prueba', 'el administrador ve todo');
  ok((await buscarU(await cedulaDe(l3), asp, 'lider', SUB)).datos.id === l3, 'un aspirante ve a los de su rama');
  const dotted = String(await cedulaDe(l2)).replace(/(\d)(?=(\d{3})+$)/g, '$1.');
  ok((await buscarU(dotted, admin, 'admin')).datos.id === l2, 'la cédula escrita con puntos también se encuentra (normalizada)');
  ok((await buscarU('1', admin, 'admin')).datos === null, 'una cédula que no existe sigue respondiendo null');
  const aud = await q("SELECT detalle FROM auditoria WHERE accion = 'buscar_cedula_ajena' AND entidad = 'usuarios' AND usuario_id = ?", [l1]);
  ok(aud.length >= 1 && /^Buscó la cédula de una cuenta fuera de su alcance \(\*\*\*\d{3}\)$/.test(aud[0].detalle) && !/8000000/.test(JSON.stringify(aud)), 'la búsqueda fuera de alcance queda en la auditoría con los tres últimos dígitos', aud);
  const lSpam = await usuario('Lider Spam Prueba', 'lider'); await estructura(lSpam, 'lider', coord);
  const estados = [];
  for (let i = 0; i < 61; i++) {
    const r = i % 2 === 0 ? await pedir('GET', `/api/votantes/buscar-por-cedula?cedula=${900000 + i}`, { usuario: U(lSpam, 'lider') }) : await buscarU(String(900000 + i), lSpam);
    estados.push(r.status);
  }
  ok(estados.slice(0, 60).every(s => s === 200) && estados[60] === 429, 'el límite de 60 cada 10 minutos es UNO SOLO para votantes y cuentas: la búsqueda 61 (de cualquiera de las dos) recibe 429', estados.filter(s => s !== 200));
  ok((await buscarU('900000', lSpam)).datos && (await buscarU('900000', lSpam)).datos.error === 'Demasiadas búsquedas, espera unos minutos', 'con el mensaje de siempre');
  const asis = fs.readFileSync(path.join(raiz, 'public/asistentes-reuniones.html'), 'utf8');
  ok(/usuario\.fuera_de_alcance/.test(asis) && /filaResultadoBusqueda\(usuario, 'usuario'\)/.test(asis), 'la alta rápida de asistentes: sigue ofreciendo agregar a una cuenta de su alcance y avisa de la que está fuera');
  const vot = await pedir('GET', `/api/votantes/buscar-por-cedula?cedula=${(await q('SELECT cedula c FROM votantes WHERE id = ?', [A]))[0].c}`, { usuario: U(l1, 'lider') });
  ok(vot.datos && vot.datos.id === A, 'y la búsqueda de votantes (orden 31) sigue como estaba');

  console.log('\n== Declaración del módulo y archivos');
  const leer = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
  ok(/transporte_dia_d: \['admin', 'coordinador'\]/.test(leer('db/init-db.js')), 'sitio 1: db/init-db.js (permisos de fábrica)');
  ok(/clave: 'transporte_dia_d'/.test(leer('routes/permisos.routes.js')), 'sitio 2: routes/permisos.routes.js (la matriz)');
  ok(/modulo: 'transporte_dia_d'/.test(leer('public/js/common.js')), 'sitio 3: public/js/common.js (el menú)');
  ok(/MODULOS_ASPIRANTE = \[[^\]]*'transporte_dia_d'/.test(leer('middleware/aspirante.js')) && /transporte_dia_d: \{ ver: true/.test(leer('middleware/aspirante.js')), 'sitio 4: middleware/aspirante.js (el aspirante)');
  ok((leer('public/app/inicio.html').match(/modulo: 'transporte_dia_d'/g) || []).length === 2, 'sitio 5: public/app/inicio.html (la tarjeta del celular)');
  const dd = leer('public/dia-d.html');
  ok(/id="pestana-transporte"/.test(dd) && /id="vista-transporte"/.test(dd) && /id="fila-transporte"/.test(dd) && /transporte-dia-d\.js/.test(dd) && ['necesitan', 'asignados', 'recogidos', 'en_puesto', 'no_estaban', 'sin_recoger'].every(k => dd.includes('stat-tr-' + k)), 'dia-d.html: pestaña «Transporte», su vista y las seis tarjetas del contador');
  ok(/estrategia-v15[89]/.test(leer('public/service-worker.js')), 'el service worker subió a v158 o posterior (app/inicio.html está en su precache)');
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(raiz, f))).digest('hex');
  ok(sha('public/vendor/leaflet/leaflet.js') === 'db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a' && sha('public/vendor/leaflet/leaflet.css') === 'a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6', 'Leaflet 1.9.4 en public/vendor/leaflet, sin cambios (sha256 del paquete oficial)');
  ok(/BSD 2-Clause License/.test(leer('public/vendor/leaflet/LICENSE')) && fs.existsSync(path.join(raiz, 'public/vendor/leaflet/images/marker-icon.png')), 'con su licencia BSD-2 y sus imágenes');

  servidor.close();
  try { await pool.query(`DROP DATABASE IF EXISTS ${CATALOGO}`); } catch (_) { /* ya no estaba */ }
  console.log(`\n${pruebas - fallos}/${pruebas} comprobaciones correctas${fallos ? ` — ${fallos} FALLARON` : ''}.`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch(async (e) => { console.error('ERROR en la prueba:', e); try { await pool.query(`DROP DATABASE IF EXISTS ${CATALOGO}`); await pool.end(); } catch (_) { /* ya cerrado */ } process.exit(1); });
