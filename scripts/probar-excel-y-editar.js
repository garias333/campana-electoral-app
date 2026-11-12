#!/usr/bin/env node
// scripts/probar-excel-y-editar.js
//
// Prueba del parche 328 (orden 42):
//   A. LAS TRES IMPORTACIONES DE EXCEL (votantes, estructura, testigos): celda vacía = no toca; «-» borra solo en columnas
//      opcionales y da error en las obligatorias; teléfono inválido conserva el anterior; metas y tipo de testigo intactos; el
//      Excel de estructura no borra nada en Votantes; fila sin cédula para una cuenta nueva da error; el resumen cuenta.
//   B. «EDITAR» EN EL SERVIDOR en los cinco módulos del Día D: con «Ver» y sin «Editar», 403; con «Editar», pasa; administrador
//      y aspirante pasan; sin fila, falla cerrado.
//   C. LA SIEMBRA de init-db: editar = 1 donde había permitido = 1, UNA sola vez (una segunda corrida no pisa lo que el
//      administrador haya puesto a mano).
//   D. LA MATRIZ: «Guardar cambios» sin la fila «Usuarios» no se la escribe en 0 al administrador.
//   E. El aspirante ve la cédula completa en su Excel de votantes.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada328 node scripts/probar-excel-y-editar.js
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

const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const express = require('express');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const pool = require('../config/db');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }
async function uno(sql, p) { return (await q(sql, p))[0]; }

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use((req, res, next) => {
  const u = req.headers['x-test-user'];
  req.session = { usuario: u ? JSON.parse(u) : undefined };
  req.sublicencia = req.headers['x-test-aspirante'] ? { usuario_id: Number(req.headers['x-test-aspirante']), nombre: 'Aspirante de prueba' } : null;
  next();
});
app.use('/api/votantes', require('../routes/votantes.routes'));
app.use('/api/territorial', require('../routes/territorial.routes'));
app.use('/api/permisos', require('../routes/permisos.routes'));
app.use('/api/dia-d/rescate', require('../routes/rescateVotos.routes'));
app.use('/api/dia-d/resultados', require('../routes/resultadosDiaD.routes'));
app.use('/api/dia-d/alertas', require('../routes/alertasDiaD.routes'));
app.use('/api/dia-d/transporte', require('../routes/transporteDiaD.routes'));
app.use('/api/dia-d/logistica', require('../routes/logisticaDiaD.routes'));
let base = '';
let ipN = 0;
async function pedir(metodo, ruta, { json, usuario, aspirante, form } = {}) {
  const h = { 'X-Forwarded-For': `198.51.100.${(ipN++ % 200) + 1}` };
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  if (aspirante) h['X-Test-Aspirante'] = String(aspirante);
  const r = await fetch(base + '/api' + ruta, { method: metodo, headers: h, body });
  const ct = r.headers.get('content-type') || '';
  if (/spreadsheetml/.test(ct)) return { status: r.status, buffer: Buffer.from(await r.arrayBuffer()) };
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
  return { status: r.status, datos, texto };
}
function excel(filas) {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas), 'Hoja1');
  const fd = new FormData();
  fd.append('archivo', new Blob([XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' })]), 'prueba.xlsx');
  return fd;
}
const importar = (ruta, filas, usuario) => pedir('POST', ruta, { form: excel(filas), usuario });

let n = 0;
const sello = String(Date.now()).slice(-6);
async function usuario(nombre, rol, extra = {}) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo, telefono, email, genero, edad)
     VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1, ?, ?, ?, ?)`,
    [nombre, extra.cedula || `94${sello}${n}`, `u94${sello}${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol,
      extra.telefono || null, extra.email || null, extra.genero || 'prefiero_no_responder', extra.edad || null]);
  return { id: r.insertId, rol, nombre };
}

(async () => {
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const admin = await usuario('Admin Prueba', 'admin');

  // ======================================================================================== A1. VOTANTES
  console.log('\nA1. Importar votantes: celda vacía no toca, «-» borra solo en opcionales');
  const [vIns] = await pool.query(
    `INSERT INTO votantes (nombre, cedula, telefono, email, genero, edad, fecha_nacimiento, direccion, departamento_residencia, ciudad_residencia,
       departamento_votacion, municipio_votacion, puesto_votacion, mesa_votacion, observaciones, lider_id, categoria)
     VALUES ('Ana Prueba', ?, '3001112233', 'ana@x.test', 'mujer', 40, '1985-05-05', 'Calle 1 # 2-3', 'Caldas', 'Manizales', 'Caldas', 'Manizales',
       'Puesto Uno', '7', 'Nota original', ?, 'votante')`, [`1053${sello}1`, admin.id]);
  const vid = vIns.insertId;
  const ficha = () => uno('SELECT * FROM votantes WHERE id = ?', [vid]);
  const base0 = await ficha();

  let r = await importar('/votantes/importar-excel', [{ ID: vid, 'Nombres y apellidos': '', Teléfono: '3009998877' }], admin);
  let f = await ficha();
  ok(r.status === 200 && r.datos.actualizados === 1, 'una fila con ID y solo el teléfono: se actualiza', r.datos);
  ok(f.telefono === '3009998877', 'el teléfono cambió');
  ok(f.nombre === base0.nombre && f.cedula === base0.cedula && f.email === base0.email && f.genero === 'mujer' && f.edad === 40 && f.direccion === base0.direccion
    && f.puesto_votacion === 'Puesto Uno' && f.mesa_votacion === base0.mesa_votacion && f.observaciones === 'Nota original' && f.ciudad_residencia === 'Manizales'
    && f.lider_id === admin.id, 'TODO lo demás quedó como estaba (vacío no toca; género no pasa a «prefiero no responder»)', f);

  r = await importar('/votantes/importar-excel', [{ ID: vid, Email: '-' }], admin);
  f = await ficha();
  ok(r.datos.camposBorrados === 1 && f.email === null && f.telefono === '3009998877' && f.observaciones === 'Nota original', '«-» en Email: lo borra (1 campo borrado) y nada más', { r: r.datos, email: f.email });

  r = await importar('/votantes/importar-excel', [{ ID: vid, Observaciones: '-', Puesto: '-', Mesa: '-', Edad: '-', Dirección: '-', 'Ciudad de residencia': '-', 'Fecha nacimiento': '-' }], admin);
  f = await ficha();
  ok(r.datos.camposBorrados === 7 && f.observaciones === null && f.puesto_votacion === null && f.mesa_votacion === null && f.edad === null && f.direccion === null
    && f.ciudad_residencia === null && f.fecha_nacimiento === null, '«-» en observaciones, puesto, mesa, edad, dirección, residencia y fecha: las 7 se borran', { r: r.datos, f });
  ok(f.nombre === 'Ana Prueba' && f.cedula === base0.cedula && f.genero === 'mujer', 'y el nombre, la cédula y el género siguen', f);

  const antes = await ficha();
  for (const [col, fila] of [['cédula', { 'Número de identificación': '-' }], ['nombre', { 'Nombres y apellidos': '-' }], ['género', { Género: '-' }],
    ['líder', { 'Líder o coordinador': '-' }], ['barrio', { Barrio: '-' }], ['área', { Área: '-' }]]) {
    r = await importar('/votantes/importar-excel', [{ ID: vid, Teléfono: '3005550000', ...fila }], admin);
    ok(r.datos.errores.length === 1 && /no borra|El «-»/.test(r.datos.errores[0].error) && r.datos.actualizados === 0, `«-» en ${col}: error claro en el resumen y la fila no se procesa`, r.datos.errores);
  }
  const despues = await ficha();
  ok(despues.telefono === antes.telefono && despues.cedula === antes.cedula && despues.nombre === antes.nombre, 'ninguna de esas filas con error cambió nada (ni siquiera el teléfono que traían)');

  r = await importar('/votantes/importar-excel', [{ ID: vid, Teléfono: '12345' }], admin);
  f = await ficha();
  ok(f.telefono === '3009998877' && r.datos.avisos.some((a) => /teléfono inválido, se dejó el que tenía/.test(a.aviso)), 'teléfono inválido: se deja el que tenía y sale el aviso', { tel: f.telefono, avisos: r.datos.avisos });
  r = await importar('/votantes/importar-excel', [{ ID: vid }], admin);
  ok(r.datos.actualizados === 0 && r.datos.avisos.length === 1, 'una fila con solo el ID: no cambia nada y lo avisa (no cuenta como actualizada)', r.datos);

  r = await importar('/votantes/importar-excel', [
    { 'Nombres y apellidos': 'Nueva Uno', 'Número de identificación': `105${sello}2`, Teléfono: '99', Email: 'n1@x.test', Observaciones: '-' },
    { 'Nombres y apellidos': 'Nueva Dos', 'Número de identificación': `105${sello}3`, Teléfono: '3101234567' },
    { 'Nombres y apellidos': '', Teléfono: '3101234568' }], admin);
  ok(r.datos.insertados === 2 && r.datos.errores.length === 1 && r.datos.avisos.some((a) => /se importó sin teléfono/.test(a.aviso)), 'filas nuevas: 2 creadas, 1 con error (sin nombre), aviso del teléfono inválido', r.datos);
  ok(Object.prototype.hasOwnProperty.call(r.datos, 'camposBorrados'), 'el resumen trae creados, actualizados, camposBorrados, errores y avisos');

  // ======================================================================================== A2. ESTRUCTURA
  console.log('\nA2. Importar estructura: no borra en Estructura ni en Votantes');
  const ced = `1054${sello}1`;
  const lid = await usuario('Lider Importado', 'lider', { cedula: ced, telefono: '3011112222', email: 'lider@x.test', genero: 'hombre', edad: 50 });
  const [eIns] = await pool.query(`INSERT INTO estructura (usuario_id, cargo, meta_votos, meta_votos_base, direccion, tipo_area_influencia) VALUES (?, 'lider', 50, 50, 'Carrera 9', 'territorio')`, [lid.id]);
  const eid = eIns.insertId;
  await pool.query(
    `INSERT INTO votantes (nombre, cedula, telefono, email, genero, edad, direccion, barrio_residencia, puesto_votacion, mesa_votacion, departamento_residencia, categoria, origen)
     VALUES ('Lider Importado', ?, '3011112222', 'votante-lider@x.test', 'hombre', 50, 'Dirección en Votantes', 'Barrio en Votantes', 'Puesto V', '3', 'Caldas', 'votante', 'estructura')`, [ced]);
  const usuarioE = () => uno('SELECT u.*, e.meta_votos, e.meta_votos_base, e.direccion, e.cargo FROM estructura e JOIN usuarios u ON u.id = e.usuario_id WHERE e.id = ?', [eid]);
  const votanteE = () => uno('SELECT * FROM votantes WHERE cedula = ?', [ced]);
  const vot0 = await votanteE();

  r = await importar('/territorial/estructura/importar-excel', [{ ID: eid, Teléfono: '3023334444' }], admin);
  let u = await usuarioE(); let vv = await votanteE();
  ok(r.status === 200 && r.datos.actualizados === 1 && r.datos.errores.length === 0, 'una fila con ID y solo el teléfono: se actualiza sin pedir cargo ni territorio', r.datos);
  ok(u.telefono === '3023334444' && u.email === 'lider@x.test' && u.genero === 'hombre' && u.edad === 50 && Number(u.meta_votos) === 50 && u.direccion === 'Carrera 9' && u.cargo === 'lider',
    'en Estructura: teléfono nuevo; correo, género, edad, meta (no pasa a 0), dirección y cargo intactos', u);
  ok(vv.email === vot0.email && vv.genero === 'hombre' && vv.edad === 50 && vv.direccion === 'Dirección en Votantes' && vv.barrio_residencia === 'Barrio en Votantes'
    && vv.puesto_votacion === 'Puesto V' && String(vv.mesa_votacion) === '3' && vv.departamento_residencia === 'Caldas', 'EN VOTANTES no se borró nada (correo, dirección, barrio, puesto, mesa, residencia)', vv);
  ok(vv.telefono === '3023334444', 'y el teléfono nuevo sí viajó a Votantes', vv.telefono);

  r = await importar('/territorial/estructura/importar-excel', [{ ID: eid, Email: '-', Dirección: '-' }], admin);
  u = await usuarioE(); vv = await votanteE();
  ok(r.datos.camposBorrados === 2 && u.email === null && u.direccion === null, '«-» en correo y dirección: se borran en Estructura (2 campos)', { r: r.datos, u: { email: u.email, dir: u.direccion } });
  ok(vv.email === vot0.email && vv.direccion === 'Dirección en Votantes', 'pero NO en Votantes: un Excel de estructura no puede borrar datos de ahí', vv);

  const u0 = await usuarioE();
  for (const [col, fila] of [['meta', { 'Meta votos': '-' }], ['cargo', { Cargo: '-' }], ['«Reporta a»', { 'Reporta a': '-' }], ['cédula', { 'Número de identificación': '-' }],
    ['nombre', { Nombre: '-' }], ['comuna', { Comuna: '-' }], ['tipo', { Tipo: '-' }]]) {
    r = await importar('/territorial/estructura/importar-excel', [{ ID: eid, Teléfono: '3050000000', ...fila }], admin);
    ok(r.datos.errores.length === 1 && /no borra|El «-»/.test(r.datos.errores[0].error) && r.datos.actualizados === 0, `«-» en ${col}: error claro y la fila no se procesa`, r.datos.errores);
  }
  u = await usuarioE();
  ok(u.telefono === u0.telefono, 'esas filas con error no cambiaron ni el teléfono que traían');

  r = await importar('/territorial/estructura/importar-excel', [{ ID: eid, 'Meta votos': '120' }], admin);
  u = await usuarioE();
  ok(Number(u.meta_votos) === 120 && Number(u.meta_votos_base) === 120, 'la meta con valor sí se actualiza', u.meta_votos);
  r = await importar('/territorial/estructura/importar-excel', [{ ID: eid, 'Meta votos': '', Teléfono: '12' }], admin);
  u = await usuarioE();
  ok(Number(u.meta_votos) === 120 && u.telefono === '3023334444' && r.datos.avisos.some((a) => /teléfono inválido, se dejó el que tenía/.test(a.aviso)), 'meta vacía no toca (sigue en 120) y teléfono inválido conserva el anterior con aviso', { meta: u.meta_votos, tel: u.telefono, avisos: r.datos.avisos });

  // cuentas nuevas
  const sinCedula = await q('SELECT COUNT(*) n FROM usuarios');
  r = await importar('/territorial/estructura/importar-excel', [{ Nombre: 'Sin Cedula', Cargo: 'Coordinador Organizaciones', Teléfono: '3060000000' }], admin);
  ok(r.datos.insertados === 0 && r.datos.errores.length === 1 && /Falta la cédula para crear la cuenta/.test(r.datos.errores[0].error), 'fila nueva sin cédula: error «Falta la cédula para crear la cuenta»', r.datos);
  const despuesN = await q('SELECT COUNT(*) n FROM usuarios');
  ok(despuesN[0].n === sinCedula[0].n, 'y no se creó ninguna cuenta (nada de claves al azar)');
  r = await importar('/territorial/estructura/importar-excel', [{ Nombre: 'Con Cedula', Cargo: 'Coordinador Organizaciones', 'Número de identificación': `1055${sello}1`, Teléfono: '3060000001', Organización: 'Gremio X' }], admin);
  ok(r.datos.insertados === 1 && r.datos.errores.length === 0, 'fila nueva con cédula: se crea', r.datos);
  const nueva = await uno('SELECT u.nombre_usuario, u.debe_cambiar_password FROM usuarios u WHERE u.numero_identificacion = ?', [`1055${sello}1`]);
  ok(nueva && nueva.nombre_usuario === `1055${sello}1` && Number(nueva.debe_cambiar_password) === 1, 'entra con su cédula como usuario y clave inicial (debe cambiarla)', nueva);

  // ======================================================================================== A3. TESTIGOS
  console.log('\nA3. Importar testigos: el tipo y las mesas no se tocan sin la columna Tipo');
  const tcd = `1056${sello}1`;
  const tes = await usuario('Coordinador Puesto', 'testigo', { cedula: tcd, telefono: '3071112222', email: 'tes@x.test' });
  await pool.query(`UPDATE usuarios SET puesto_votacion = 'Puesto Testigo', municipio_votacion = 'Manizales', departamento_votacion = 'Caldas' WHERE id = ?`, [tes.id]);
  const [tIns] = await pool.query(`INSERT INTO estructura (usuario_id, cargo, tipo_testigo, mesas_asignadas, tipo_area_influencia) VALUES (?, 'testigo', 'puesto', '[1,2,3]', 'territorio')`, [tes.id]);
  const tid = tIns.insertId;
  const testigo = () => uno('SELECT u.*, e.tipo_testigo, e.mesas_asignadas FROM estructura e JOIN usuarios u ON u.id = e.usuario_id WHERE e.id = ?', [tid]);
  const t0 = await testigo();

  r = await importar('/territorial/testigos/importar-excel', [{ ID: tid, Teléfono: '3083334444' }], admin);
  let t = await testigo();
  ok(r.status === 200 && r.datos.actualizados === 1, 'una fila con ID y solo el teléfono: se actualiza', r.datos);
  ok(t.telefono === '3083334444' && t.email === 'tes@x.test' && t.puesto_votacion === 'Puesto Testigo' && t.tipo_testigo === 'puesto' && JSON.stringify(t.mesas_asignadas) === JSON.stringify(t0.mesas_asignadas),
    'sin la columna Tipo: el coordinador de puesto sigue siendo de puesto y conserva sus mesas', { tipo: t.tipo_testigo, mesas: t.mesas_asignadas });
  r = await importar('/territorial/testigos/importar-excel', [{ ID: tid, Mesa: '4, 5' }], admin);
  t = await testigo();
  ok(t.tipo_testigo === 'puesto' && JSON.stringify(t.mesas_asignadas) === JSON.stringify([4, 5]), 'con Mesa «4, 5» y sin Tipo: sigue de puesto y las mesas son 4 y 5', t.mesas_asignadas);
  r = await importar('/territorial/testigos/importar-excel', [{ ID: tid, Email: '-', Mesa: '-' }], admin);
  t = await testigo();
  ok(r.datos.camposBorrados === 2 && t.email === null && t.mesa_votacion === null && t.mesas_asignadas === null && t.tipo_testigo === 'puesto', '«-» en correo y mesa: los borra (2 campos) y no cambia el tipo', { r: r.datos, t });
  for (const [col, fila] of [['cédula', { 'Número de identificación': '-' }], ['nombre', { Nombre: '-' }], ['tipo', { Tipo: '-' }]]) {
    r = await importar('/territorial/testigos/importar-excel', [{ ID: tid, Teléfono: '3090000000', ...fila }], admin);
    ok(r.datos.errores.length === 1 && /no borra|El «-»/.test(r.datos.errores[0].error) && r.datos.actualizados === 0, `«-» en ${col}: error claro`, r.datos.errores);
  }
  r = await importar('/territorial/testigos/importar-excel', [{ ID: tid, Teléfono: '123456' }], admin);
  t = await testigo();
  ok(t.telefono === '3083334444' && r.datos.errores.length === 0 && r.datos.avisos.some((a) => /se dejó el que tenía/.test(a.aviso)), 'teléfono inválido: conserva el anterior y es un AVISO (no un error), sin cortar a 10 dígitos', { tel: t.telefono, r: r.datos });
  r = await importar('/territorial/testigos/importar-excel', [{ ID: tid, Tipo: 'Testigo electoral', Mesa: '9' }], admin);
  t = await testigo();
  ok(t.tipo_testigo === 'mesa' && String(t.mesa_votacion) === '9' && t.mesas_asignadas === null, 'con la columna Tipo, sí cambia el tipo (y suelta las mesas asignadas)', t);
  r = await importar('/territorial/testigos/importar-excel', [{ Nombre: 'Testigo sin cedula', Teléfono: '3091112222' }], admin);
  ok(r.datos.insertados === 0 && /Falta la cédula para crear la cuenta/.test((r.datos.errores[0] || {}).error || ''), 'testigo nuevo sin cédula: error, no se crea la cuenta', r.datos);
  r = await importar('/territorial/testigos/importar-excel', [{ Nombre: 'Testigo con cedula', 'Número de identificación': `1057${sello}1`, Teléfono: '3091112223', Puesto: 'Puesto Nuevo', Mesa: '2' }], admin);
  ok(r.datos.insertados === 1, 'testigo nuevo con cédula: se crea', r.datos);

  // ======================================================================================== B. EDITAR
  console.log('\nB. «Editar» exigido en el servidor (Día D)');
  for (const clave of ['solicitudes', 'tareas', 'puerta_a_puerta', 'puerta_panel', 'alertas_dia_d', 'resultados_dia_d', 'transporte_dia_d', 'logistica_dia_d', 'faltan_por_votar', 'finanzas']) {
    await pool.query('UPDATE complementos_campana SET activo = 1 WHERE clave = ?', [clave]);
  }
  const coord = await usuario('Coord Editar', 'coordinador');
  const MODULOS = {
    rescate_votos: [['POST', '/dia-d/rescate/marcar'], ['DELETE', '/dia-d/rescate/marcar/1'], ['POST', '/dia-d/rescate/transporte'], ['POST', '/dia-d/rescate/enlace']],
    alertas_dia_d: [['POST', '/dia-d/alertas/atendida']],
    resultados_dia_d: [['PUT', '/dia-d/resultados/mesa'], ['PUT', '/dia-d/resultados/revision'], ['POST', '/dia-d/resultados/paquete']],
    transporte_dia_d: [['POST', '/dia-d/transporte/vehiculos'], ['PUT', '/dia-d/transporte/vehiculos/1'], ['POST', '/dia-d/transporte/conductores'], ['PUT', '/dia-d/transporte/conductores/1'],
      ['POST', '/dia-d/transporte/conductores/1/rotar'], ['POST', '/dia-d/transporte/asignar'], ['POST', '/dia-d/transporte/desasignar'], ['PUT', '/dia-d/transporte/asignaciones/1'],
      ['POST', '/dia-d/transporte/conductores/1/ordenar']],
    logistica_dia_d: [['POST', '/dia-d/logistica/items'], ['PUT', '/dia-d/logistica/items/1'], ['PUT', '/dia-d/logistica/plan']],
  };
  const fijar = (modulo, ver, editar) => pool.query(
    `INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES ('coordinador', ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE permitido = VALUES(permitido), editar = VALUES(editar)`, [modulo, ver, editar]);
  for (const [modulo, rutas] of Object.entries(MODULOS)) {
    await fijar(modulo, 1, 0);
    const negadas = [];
    for (const [metodo, ruta] of rutas) {
      const x = await pedir(metodo, ruta, { usuario: coord, json: {} });
      if (x.status !== 403 || !/Editar/.test((x.datos || {}).error || '')) negadas.push(`${metodo} ${ruta} → ${x.status}`);
    }
    ok(!negadas.length, `${modulo}: con «Ver» y sin «Editar», las ${rutas.length} rutas de escritura responden 403 «Editar»`, negadas);
    await fijar(modulo, 1, 1);
    const pasan = [];
    for (const [metodo, ruta] of rutas) {
      const x = await pedir(metodo, ruta, { usuario: coord, json: {} });
      if (x.status === 403) pasan.push(`${metodo} ${ruta} → ${x.status} ${(x.datos || {}).error}`);
    }
    ok(!pasan.length, `${modulo}: con «Editar», ninguna responde 403`, pasan);
    const adm = [];
    for (const [metodo, ruta] of rutas) {
      const x = await pedir(metodo, ruta, { usuario: admin, json: {} });
      if (x.status === 403) adm.push(`${metodo} ${ruta}`);
    }
    ok(!adm.length, `${modulo}: el administrador pasa siempre`, adm);
    const asp = await usuario('Aspirante ' + modulo, 'lider');
    const aspiran = [];
    for (const [metodo, ruta] of rutas) {
      const x = await pedir(metodo, ruta, { usuario: asp, aspirante: asp.id, json: {} });
      if (x.status === 403 && /Editar|no está disponible/.test((x.datos || {}).error || '')) aspiran.push(`${metodo} ${ruta} → ${(x.datos || {}).error}`);
    }
    ok(!aspiran.length, `${modulo}: el aspirante pasa por su lista (PERMISOS_ASPIRANTE)`, aspiran);
    await pool.query(`DELETE FROM permisos_rol WHERE rol = 'coordinador' AND modulo = ?`, [modulo]);
    const sinFila = await pedir(rutas[0][0], rutas[0][1], { usuario: coord, json: {} });
    ok(sinFila.status === 403, `${modulo}: sin fila de permiso, falla cerrado (403)`, sinFila.status);
  }
  // Lo que se dejó fuera a propósito
  const vaciar = await pedir('POST', '/dia-d/rescate/vaciar', { usuario: coord, json: {} });
  ok(vaciar.status === 403 && !/Editar/.test((vaciar.datos || {}).error || ''), '/vaciar sigue siendo del administrador (su propia guarda, no la de «Editar»)', vaciar.datos);
  const cfg = await pedir('PUT', '/dia-d/alertas/config', { usuario: coord, json: {} });
  ok(cfg.status === 403 && !/Editar/.test((cfg.datos || {}).error || ''), 'PUT /alertas/config sigue siendo solo del administrador', cfg.datos);

  // ======================================================================================== C. SIEMBRA (init-db)
  console.log('\nC. La siembra de init-db: una sola vez');
  await pool.query(`DELETE FROM permisos_rol WHERE modulo IN ('rescate_votos','alertas_dia_d','resultados_dia_d','transporte_dia_d','logistica_dia_d') AND rol IN ('coordinador','lider')`);
  const sembrarFila = (rol, modulo, ver, edit) => pool.query(
    `INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES (?, ?, ?, ?, 0)`, [rol, modulo, ver, edit]);
  await sembrarFila('coordinador', 'transporte_dia_d', 1, 0);   // ve y no edita: debe quedar con editar = 1
  await sembrarFila('lider', 'transporte_dia_d', 0, 0);         // no ve: debe seguir sin editar
  await sembrarFila('coordinador', 'rescate_votos', 1, 0);
  await sembrarFila('coordinador', 'logistica_dia_d', 1, 0);
  // Una instalación anterior al parche 328 NO tiene la columna marca: se simula quitándola
  try { await pool.query('ALTER TABLE configuracion_campana DROP COLUMN permisos_editar_dia_d_sembrado'); } catch (_) { /* aún no existía */ }
  const correrInit = () => execFileSync(process.execPath, [path.join(__dirname, '..', 'db', 'init-db.js')], { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 280000 });
  let salida = correrInit();
  const ed = async (rol, modulo) => (await uno('SELECT permitido, editar FROM permisos_rol WHERE rol = ? AND modulo = ?', [rol, modulo]));
  ok((await ed('coordinador', 'transporte_dia_d')).editar === 1 && (await ed('coordinador', 'rescate_votos')).editar === 1 && (await ed('coordinador', 'logistica_dia_d')).editar === 1,
    'la primera corrida pone editar = 1 donde había permitido = 1', await ed('coordinador', 'transporte_dia_d'));
  ok((await ed('lider', 'transporte_dia_d')).editar === 0, 'y deja editar = 0 donde NO había permitido');
  ok(/«Editar» del Día D: se puso editar = 1/.test(salida), 'y lo dice en la salida', salida.split('\n').filter((l) => /Editar/.test(l)).slice(0, 2));
  // El administrador apaga a mano; una segunda corrida NO lo pisa
  await pool.query(`UPDATE permisos_rol SET editar = 0 WHERE rol = 'coordinador' AND modulo = 'transporte_dia_d'`);
  salida = correrInit();
  ok((await ed('coordinador', 'transporte_dia_d')).editar === 0, 'una SEGUNDA corrida de init-db no vuelve a encender lo que el administrador apagó a mano');
  ok(!/«Editar» del Día D: se puso/.test(salida), 'y no vuelve a sembrar');
  const usuariosAdmin = await ed('admin', 'usuarios');
  ok(usuariosAdmin && usuariosAdmin.permitido === 1, 'la fila «Usuarios» del administrador queda sembrada (permitido = 1)', usuariosAdmin);

  // ======================================================================================== D. MATRIZ
  console.log('\nD. «Guardar cambios» de la matriz sin la fila Usuarios');
  await pool.query(`DELETE FROM permisos_rol WHERE modulo = 'usuarios'`);
  r = await pedir('GET', '/permisos/matriz', { usuario: admin });
  const enviar = {};
  for (const rol of r.datos.roles) for (const m of r.datos.modulos) {
    const c = r.datos.permisos[`${rol}:${m.clave}`] || { ver: false, editar: false, agregar: false };   // como lo manda la pantalla: lo que no existe sale en blanco
    enviar[`${rol}:${m.clave}`] = { ver: c.ver, editar: c.editar, agregar: c.agregar, importar_exportar: !!c.importar_exportar };
  }
  r = await pedir('PUT', '/permisos/matriz', { usuario: admin, json: { permisos: enviar } });
  ok(r.status === 200, 'PUT /permisos/matriz sin las filas «Usuarios»', r.texto);
  const filasUsuarios = await q(`SELECT rol, permitido FROM permisos_rol WHERE modulo = 'usuarios'`);
  ok(filasUsuarios.length === 0, 'no se escribió NINGUNA fila de «Usuarios» en 0 (no se le oculta la pestaña al administrador)', filasUsuarios);
  // Una casilla que SÍ existía y se apaga a propósito, sigue guardándose
  await pool.query(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES ('coordinador', 'crm', 1, 1, 1) ON DUPLICATE KEY UPDATE permitido = 1, editar = 1, agregar = 1`);
  r = await pedir('GET', '/permisos/matriz', { usuario: admin });
  const enviar2 = {};
  for (const rol of r.datos.roles) for (const m of r.datos.modulos) {
    const c = r.datos.permisos[`${rol}:${m.clave}`] || { ver: false, editar: false, agregar: false };
    enviar2[`${rol}:${m.clave}`] = { ver: c.ver, editar: c.editar, agregar: c.agregar, importar_exportar: !!c.importar_exportar };
  }
  enviar2['coordinador:crm'] = { ver: false, editar: false, agregar: false, importar_exportar: false };
  r = await pedir('PUT', '/permisos/matriz', { usuario: admin, json: { permisos: enviar2 } });
  const crm = await uno(`SELECT permitido FROM permisos_rol WHERE rol = 'coordinador' AND modulo = 'crm'`);
  ok(r.status === 200 && crm.permitido === 0, 'apagar a propósito una casilla que existía sí se guarda', crm);
  // Y quien marca algo en una fila que no existía, la crea
  const enviar3 = { ...enviar2 };
  enviar3['admin:usuarios'] = { ver: true, editar: true, agregar: true, importar_exportar: false };
  r = await pedir('PUT', '/permisos/matriz', { usuario: admin, json: { permisos: enviar3 } });
  ok((await uno(`SELECT permitido FROM permisos_rol WHERE rol = 'admin' AND modulo = 'usuarios'`) || {}).permitido === 1, 'marcar algo en una fila que no existía la crea');

  // ======================================================================================== E. ASPIRANTE: CÉDULA COMPLETA
  console.log('\nE. El aspirante ve la cédula completa en su Excel de votantes');
  const asp = await usuario('Aspirante Excel', 'lider');
  const cedAsp = `1058${sello}1`;
  await pool.query(`INSERT INTO votantes (nombre, cedula, telefono, lider_id, rama_aspirante_id, categoria) VALUES ('Votante del Aspirante', ?, '3111112222', ?, ?, 'votante')`, [cedAsp, asp.id, asp.id]);
  const leer = (x) => XLSX.utils.sheet_to_json(XLSX.read(x.buffer, { type: 'buffer' }).Sheets[XLSX.read(x.buffer, { type: 'buffer' }).SheetNames[0]]);
  r = await pedir('GET', '/votantes/exportar-excel', { usuario: asp, aspirante: asp.id });
  const filaA = r.buffer ? leer(r).find((f) => f['Nombres y apellidos'] === 'Votante del Aspirante') : null;
  ok(r.status === 200 && filaA && String(filaA['Número de identificación']).replace(/\D/g, '') === cedAsp, 'el aspirante recibe la cédula COMPLETA en su Excel', filaA || r.texto);
  const m = require('../lib/enmascarar');
  ok(m.cedulaPara({ rol: 'lider' }, '1053123456', { usuario_id: 1 }) === '1053123456', 'cedulaPara: con sublicencia (aspirante) completa');
  ok(m.cedulaPara({ rol: 'lider' }, '1053123456', null) === '***456', 'cedulaPara: un líder sin sublicencia sigue viéndola tapada');
  ok(m.cedulaPara({ rol: 'testigo' }, '1053123456') === '***456' && m.cedulaPara({ rol: 'admin' }, '1053123456') === '1053123456' && m.cedulaPara({ rol: 'coordinador' }, '1053123456') === '1053123456', 'cedulaPara: administrador y coordinador completa; testigo tapada');

  servidor.close();
  await pool.end();
  console.log(fallos ? `\n${fallos} comprobación(es) FALLARON.` : '\nTodo bien.');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('Error de la prueba:', e); process.exit(1); });
