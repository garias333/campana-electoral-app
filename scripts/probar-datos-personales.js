#!/usr/bin/env node
// scripts/probar-datos-personales.js
//
// Prueba del parche 327 («Datos personales: baja en correo, historial y alcance del CRM», orden 41):
//   1. LA BAJA, en la salida de correo (config/mailer.js, lib/baja.js): un correo a alguien del equipo dado de baja queda
//      «omitido»; el código de acceso al MISMO usuario sí sale; la vista previa cuenta la baja de estructura, testigos y
//      organigrama; un SMS que la salida rechaza por baja queda «omitido», no «fallido».
//   2. EL HISTORIAL del CRM acotado por autor (administrador todo, coordinador su rama, líder lo suyo, asistente lo suyo);
//      borrar solo el administrador; las respuestas solo administrador y coordinador; fuera de alcance = 404.
//   3. LOS DESTINATARIOS acotados para líder y asistente, en TODAS las fuentes (vista previa, buscador, envío).
//   4. verificar-duplicado sin cédula ni teléfono y con límite; verificar-identificacion distingue «es mía».
//   5. Agregar un asistente a un evento exige que esté en el alcance; el Excel de votantes y la estructura del coordinador
//      son solo de su rama; la cédula sale tapada (***456) para quien no es administrador ni coordinador.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada327 node scripts/probar-datos-personales.js
//
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». No manda NINGÚN correo ni SMS real: el transporte de
// correo se reemplaza por uno que solo anota. Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) {
  console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`);
  process.exit(2);
}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';
process.env.SMTP_USER = 'prueba@campana.prueba';

const http = require('http');
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
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- el correo no sale: se anota a quién se le habría mandado
const mailer = require('../config/mailer');
const correosEnviados = [];
mailer.transporter.sendMail = async (m) => { correosEnviados.push(String(m.to)); return { messageId: 'prueba' }; };

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use((req, res, next) => {
  const u = req.headers['x-test-user'];
  req.session = { usuario: u ? JSON.parse(u) : undefined };
  req.sublicencia = null;
  next();
});
const comunicaciones = require('../routes/comunicaciones.routes');
app.use('/api/comunicaciones', comunicaciones);
app.use('/api/votantes', require('../routes/votantes.routes'));
app.use('/api/eventos', require('../routes/eventos.routes'));
app.use('/api/territorial', require('../routes/territorial.routes'));
let base = '';
let ipN = 0;
async function pedir(metodo, ruta, { json, usuario, ip } = {}) {
  const h = { 'X-Forwarded-For': ip || `198.51.100.${(ipN++ % 200) + 1}` };
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  const r = await fetch(base + '/api' + ruta, { method: metodo, headers: h, body });
  const ct = r.headers.get('content-type') || '';
  if (/spreadsheetml/.test(ct)) return { status: r.status, buffer: Buffer.from(await r.arrayBuffer()) };
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
  return { status: r.status, datos, texto };
}

let n = 0;
const sello = String(Date.now()).slice(-6);
async function usuario(nombre, rol, extra = {}) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo, telefono, email, no_contactar)
     VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1, ?, ?, ?)`,
    [nombre, `93${sello}${n}`, `u93${sello}${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol, extra.telefono || null, extra.email || null, extra.baja ? 1 : 0]);
  return { id: r.insertId, rol, nombre };
}
async function estructura(u, cargo, supervisor, extra = {}) {
  const [r] = await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, ?, 1)', [u.id, cargo, supervisor ? supervisor.id : null]);
  return r.insertId;
}
async function permiso(rol, modulo, extra = {}) {
  await pool.query(
    `INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar, importar_exportar) VALUES (?, ?, 1, 1, 1, ?)
     ON DUPLICATE KEY UPDATE permitido = 1, importar_exportar = VALUES(importar_exportar)`, [rol, modulo, extra.exportar ? 1 : 0]);
}
async function votante(nombre, lider, extra = {}) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO votantes (nombre, cedula, telefono, email, lider_id, categoria, no_contactar) VALUES (?, ?, ?, ?, ?, 'votante', ?)`,
    [nombre, extra.cedula || `1053${sello}${n}`, extra.telefono || null, extra.email || null, lider ? lider.id : null, extra.baja ? 1 : 0]);
  return r.insertId;
}
async function campana(nombre, autor, canal = 'email_personal') {
  const [r] = await pool.query(
    `INSERT INTO comunicaciones_campanas (nombre, canal, asunto, mensaje, estado, total_destinatarios, created_by) VALUES (?, ?, 'x', 'Hola', 'enviado', 1, ?)`,
    [nombre, canal, autor ? autor.id : null]);
  return r.insertId;
}
async function esperarCampana(id, segundos = 15) {
  for (let i = 0; i < segundos * 10; i++) {
    const [[c]] = await pool.query('SELECT estado FROM comunicaciones_campanas WHERE id = ?', [id]);
    const [[ab]] = await pool.query(`SELECT COUNT(*) AS n FROM comunicaciones_envios WHERE campana_id = ? AND estado IN ('pendiente','enviando')`, [id]);
    if (c && c.estado !== 'enviando' && Number(ab.n) === 0) return c.estado;
    await esperar(100);
  }
  return 'timeout';
}
const estadosDe = async (id) => Object.fromEntries((await q('SELECT destinatario_contacto AS c, estado FROM comunicaciones_envios WHERE campana_id = ?', [id])).map((f) => [f.c, f.estado]));
const nombres = (r, campo = 'nombre') => (r.datos && Array.isArray(r.datos) ? r.datos.map((x) => x[campo]).sort() : null);

(async () => {
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  // ------------------------------------------------------------------ el mundo de la prueba
  const admin = await usuario('Admin Prueba', 'admin');
  const coord = await usuario('Coord Uno', 'coordinador');
  const coordOtro = await usuario('Coord Dos', 'coordinador');
  const lid1 = await usuario('Lider Uno', 'lider', { telefono: `31055${sello.slice(0, 5)}`, email: `lid1${sello}@x.test` });
  const lid2 = await usuario('Lider Dos', 'lider');          // de OTRA rama
  const asis = await usuario('Asistente Uno', 'asistente_administrativo');
  const sub1 = await usuario('Sub Uno', 'sublider', { telefono: `31066${sello.slice(0, 5)}`, email: `sub1${sello}@x.test`, baja: true }); // dado de baja
  const sub2 = await usuario('Sub Dos', 'sublider', { telefono: `31077${sello.slice(0, 5)}`, email: `sub2${sello}@x.test` });
  const tes1 = await usuario('Testigo Baja', 'testigo', { telefono: `31088${sello.slice(0, 5)}`, email: `tes1${sello}@x.test`, baja: true });
  await estructura(coord, 'coordinador', null);
  await estructura(coordOtro, 'coordinador', null);
  await estructura(lid1, 'lider', coord);
  await estructura(lid2, 'lider', coordOtro);
  await estructura(sub1, 'usuario', lid1);
  await estructura(sub2, 'usuario', lid1);
  await estructura(tes1, 'testigo', lid1);
  const todos = [admin, coord, coordOtro, lid1, lid2, asis, sub1, sub2, tes1];
  for (const rol of ['coordinador', 'lider', 'asistente_administrativo']) {
    await permiso(rol, 'eventos'); await permiso(rol, 'agenda'); await permiso(rol, 'asistentes_reuniones');
  }
  await permiso('coordinador', 'votantes', { exportar: true });
  await permiso('coordinador', 'territorial', { exportar: true });

  // ====================================================================================== 1. LA BAJA
  console.log('\n1. La baja en el correo y en el SMS');
  const bajas = require('../lib/baja');
  ok(await bajas.estaDadoDeBaja({ email: sub1.id && `SUB1${sello}@X.test` }) === true, 'estaDadoDeBaja por correo, sin importar mayúsculas');
  ok(await bajas.estaDadoDeBaja({ telefono: `+57 310 66${sello.slice(0, 5)}`.replace(/\s/g, ' ') }) === true, 'estaDadoDeBaja por teléfono (últimos 10 dígitos)');
  ok(await bajas.estaDadoDeBaja({ email: `sub2${sello}@x.test` }) === false, 'quien no pidió la baja no está dado de baja');
  ok(await bajas.estaDadoDeBaja({}) === false, 'sin teléfono ni correo no hay a quién buscar (false)');
  const lote = await bajas.contactosDeBaja({ telefonos: [`31066${sello.slice(0, 5)}`, '3000000000'], correos: [`sub1${sello}@x.test`, 'nadie@x.test'] });
  ok(lote.telefonos.has(`31066${sello.slice(0, 5)}`) && !lote.telefonos.has('3000000000') && lote.correos.has(`sub1${sello}@x.test`) && !lote.correos.has('nadie@x.test'), 'contactosDeBaja en lote');

  correosEnviados.length = 0;
  let err = null;
  try { await mailer.enviarCorreoMasivo(`sub1${sello}@x.test`, 'Asunto', 'Texto', null); } catch (e) { err = e; }
  ok(err && err.codigo === 'DADO_DE_BAJA' && correosEnviados.length === 0, 'enviarCorreoMasivo a un correo dado de baja: se niega (DADO_DE_BAJA) y no sale nada', err && err.message);
  await mailer.enviarCorreoMasivo(`sub1${sello}@x.test`, 'Prueba', 'Texto', null, { operativo: true });
  ok(correosEnviados.includes(`sub1${sello}@x.test`), 'con operativo:true (prueba de configuración) el mismo correo sí sale');
  correosEnviados.length = 0;
  await mailer.enviarCodigo2FA(`sub1${sello}@x.test`, '123456');
  ok(correosEnviados.includes(`sub1${sello}@x.test`), 'el CÓDIGO DE ACCESO al mismo usuario dado de baja sí sale');
  correosEnviados.length = 0;
  await mailer.enviarCorreoRecuperacion(`sub1${sello}@x.test`, 'https://campana.prueba/reset?t=x');
  ok(correosEnviados.includes(`sub1${sello}@x.test`), 'la RECUPERACIÓN DE CLAVE al mismo usuario dado de baja sí sale');

  // Una campaña por correo a la ESTRUCTURA: Sub Uno y Testigo Baja están de baja, Sub Dos y Lider Uno no.
  correosEnviados.length = 0;
  let r = await pedir('POST', '/comunicaciones/campanas', { usuario: admin, json: {
    nombre: 'Correo a estructura', canal: 'email_personal', asunto: 'Hola', mensaje: 'Reunión mañana',
    filtros: [{ fuente: 'estructura' }] } });
  ok(r.status === 200 && r.datos && r.datos.campana_id, 'POST /campanas por correo a la estructura (administrador)', r.texto);
  const idCorreo = r.datos && r.datos.campana_id;
  await esperarCampana(idCorreo);
  const est = await estadosDe(idCorreo);
  ok(est[`sub1${sello}@x.test`] === 'dado_de_baja' || est[`sub1${sello}@x.test`] === 'omitido', 'el correo del equipo dado de baja NO sale: queda omitido/dado_de_baja', est);
  ok(est[`tes1${sello}@x.test`] === 'dado_de_baja' || est[`tes1${sello}@x.test`] === 'omitido', 'el testigo dado de baja tampoco', est);
  ok(est[`sub2${sello}@x.test`] === 'enviado' && est[`lid1${sello}@x.test`] === 'enviado', 'quien no pidió la baja sí recibe', est);
  ok(!correosEnviados.includes(`sub1${sello}@x.test`) && !correosEnviados.includes(`tes1${sello}@x.test`), 'el transporte no vio los correos de los dados de baja', correosEnviados);

  // La baja que llega ENTRE crear la campaña y enviarla: la fila ya existe 'pendiente'; la salida la omite (correo)
  correosEnviados.length = 0;
  const idTarde = await campana('Baja tardía por correo', admin, 'email_personal');
  await q(`INSERT INTO comunicaciones_envios (campana_id, destinatario_tipo, destinatario_nombre, destinatario_contacto, estado) VALUES (?, 'manual', 'Manual', ?, 'pendiente')`, [idTarde, `sub1${sello}@x.test`]);
  await q(`UPDATE comunicaciones_campanas SET estado = 'enviando' WHERE id = ?`, [idTarde]);
  await comunicaciones.procesarEnvioCampana(idTarde);
  const tarde = await estadosDe(idTarde);
  ok(tarde[`sub1${sello}@x.test`] === 'omitido' && correosEnviados.length === 0, 'una fila «manual» por correo con la baja descubierta en la salida: omitido, no fallido', tarde);

  // SMS: la salida de config/sms.js rechaza por baja; la fila debe quedar «omitido», NO «fallido»
  const idSms = await campana('Baja tardía por SMS', admin, 'sms');
  await q(`INSERT INTO comunicaciones_envios (campana_id, destinatario_tipo, destinatario_nombre, destinatario_contacto, estado) VALUES (?, 'manual', 'Manual', ?, 'pendiente')`, [idSms, `31066${sello.slice(0, 5)}`]);
  await q(`UPDATE comunicaciones_campanas SET estado = 'enviando' WHERE id = ?`, [idSms]);
  await comunicaciones.procesarEnvioCampana(idSms);
  const sms = await estadosDe(idSms);
  ok(sms[`31066${sello.slice(0, 5)}`] === 'omitido', 'SMS a un número dado de baja: la fila queda «omitido» (no «fallido»)', sms);

  // La vista previa cuenta la baja de estructura, testigos y organigrama
  await q(`INSERT INTO organigrama_nodos (cargo, nombres, apellidos, telefono, email, nivel) VALUES ('Jefe de prueba', 'Org', 'Baja', ?, ?, 'nivel_1')`, [`31066${sello.slice(0, 5)}`, `sub1${sello}@x.test`]);
  await q(`INSERT INTO organigrama_nodos (cargo, nombres, apellidos, telefono, email, nivel) VALUES ('Otro jefe', 'Org', 'Libre', '3011112222', ?, 'nivel_1')`, [`org-libre${sello}@x.test`]);
  r = await pedir('POST', '/comunicaciones/destinatarios/preview', { usuario: admin, json: { canal: 'email_personal', filtros: [{ fuente: 'estructura' }] } });
  ok(r.status === 200 && r.datos.dadosDeBaja === 2, 'vista previa de ESTRUCTURA: cuenta los 2 dados de baja (Sub Uno y Testigo Baja)', r.datos && { dadosDeBaja: r.datos.dadosDeBaja, total: r.datos.total });
  // Con correo y sin baja solo quedan Lider Uno y Sub Dos: los dados de baja NO se suman como «con contacto».
  ok(r.datos && r.datos.conContacto === 2, 'y no los suma como «con contacto»', r.datos && { conContacto: r.datos.conContacto, total: r.datos.total });
  r = await pedir('POST', '/comunicaciones/destinatarios/preview', { usuario: admin, json: { canal: 'email_personal', filtros: [{ fuente: 'testigos' }] } });
  ok(r.status === 200 && r.datos.dadosDeBaja === 1 && r.datos.total === 1, 'vista previa de TESTIGOS: el testigo dado de baja se marca', r.datos && { dadosDeBaja: r.datos.dadosDeBaja, total: r.datos.total });
  r = await pedir('POST', '/comunicaciones/destinatarios/preview', { usuario: admin, json: { canal: 'email_personal', filtros: [{ fuente: 'organigrama' }] } });
  ok(r.status === 200 && r.datos.total === 2 && r.datos.dadosDeBaja === 1, 'vista previa de ORGANIGRAMA: el cargo cuyo correo es de alguien dado de baja se marca', r.datos && { dadosDeBaja: r.datos.dadosDeBaja, total: r.datos.total });
  r = await pedir('POST', '/comunicaciones/destinatarios/preview', { usuario: admin, json: { canal: 'sms', filtros: [{ fuente: 'organigrama' }] } });
  ok(r.status === 200 && r.datos.dadosDeBaja === 1, 'lo mismo por SMS (se compara el teléfono)', r.datos && { dadosDeBaja: r.datos.dadosDeBaja });

  // Pedir confirmación de autorización a quien está de baja
  const vBaja = await votante('Votante En Baja', lid1, { telefono: '3120000001', email: `vbaja${sello}@x.test`, baja: true });
  await q('UPDATE votantes SET consentimiento_autorizado = 1 WHERE id = ?', [vBaja]);
  r = await pedir('POST', `/votantes/${vBaja}/pedir-confirmacion`, { usuario: admin, json: { canal: 'email' } });
  ok(r.status === 400 && /no recibir/i.test((r.datos || {}).error || ''), 'pedir confirmación de autorización a quien está de baja: 400, no se le escribe', r.texto);

  // ====================================================================================== 2. HISTORIAL
  console.log('\n2. El historial del CRM acotado por autor');
  const cAdmin = await campana('H admin', admin), cCoord = await campana('H coord', coord), cLid1 = await campana('H lider1', lid1),
        cLid2 = await campana('H lider2', lid2), cAsis = await campana('H asistente', asis), cOtroCoord = await campana('H coord2', coordOtro);
  const mias = (r) => (r.datos || []).filter((c) => /^H /.test(c.nombre)).map((c) => c.nombre).sort();
  r = await pedir('GET', '/comunicaciones/campanas', { usuario: admin });
  ok(JSON.stringify(mias(r)) === JSON.stringify(['H admin', 'H asistente', 'H coord', 'H coord2', 'H lider1', 'H lider2']), 'administrador: ve todas', mias(r));
  r = await pedir('GET', '/comunicaciones/campanas', { usuario: coord });
  ok(JSON.stringify(mias(r)) === JSON.stringify(['H coord', 'H lider1']), 'coordinador: la suya y la de su rama (no la del otro coordinador ni la del administrador)', mias(r));
  r = await pedir('GET', '/comunicaciones/campanas', { usuario: lid1 });
  ok(JSON.stringify(mias(r)) === JSON.stringify(['H lider1']), 'líder: solo lo suyo', mias(r));
  r = await pedir('GET', '/comunicaciones/campanas', { usuario: asis });
  ok(JSON.stringify(mias(r)) === JSON.stringify(['H asistente']), 'asistente administrativo: solo lo suyo', mias(r));

  r = await pedir('GET', `/comunicaciones/campanas/${cLid2}`, { usuario: lid1 });
  ok(r.status === 404, 'líder viendo el detalle de la campaña de OTRO líder: 404', r.status);
  r = await pedir('GET', `/comunicaciones/campanas/${cLid1}`, { usuario: lid1 });
  ok(r.status === 200, 'líder viendo el detalle de la suya: 200', r.status);
  r = await pedir('GET', `/comunicaciones/campanas/${cLid1}`, { usuario: coord });
  ok(r.status === 200, 'coordinador viendo el detalle de la de su líder: 200', r.status);
  r = await pedir('GET', `/comunicaciones/campanas/${cOtroCoord}`, { usuario: coord });
  ok(r.status === 404, 'coordinador viendo la del otro coordinador: 404', r.status);
  r = await pedir('GET', `/comunicaciones/campanas/${cAdmin}`, { usuario: asis });
  ok(r.status === 404, 'asistente viendo la del administrador: 404', r.status);
  r = await pedir('POST', `/comunicaciones/campanas/${cLid2}/reintentar-fallidos`, { usuario: lid1 });
  ok(r.status === 404, 'reintentar fallidos de la campaña de otro: 404', r.status);
  r = await pedir('POST', `/comunicaciones/campanas/${cLid1}/reintentar-fallidos`, { usuario: lid1 });
  ok(r.status === 200, 'reintentar fallidos de la suya: 200', r.status);

  r = await pedir('DELETE', `/comunicaciones/campanas/${cLid1}`, { usuario: lid1 });
  ok(r.status === 403, 'líder borrando incluso SU campaña: 403', r.status);
  r = await pedir('DELETE', `/comunicaciones/campanas/${cCoord}`, { usuario: coord });
  ok(r.status === 403, 'coordinador borrando: 403', r.status);
  r = await pedir('DELETE', `/comunicaciones/campanas/${cAsis}`, { usuario: asis });
  ok(r.status === 403, 'asistente borrando: 403', r.status);
  r = await pedir('DELETE', `/comunicaciones/campanas/${cLid2}`, { usuario: admin });
  ok(r.status === 200, 'administrador borrando: 200', r.status);

  await q(`INSERT INTO comunicaciones_respuestas (canal, de_contacto, mensaje, accion) VALUES ('sms', '3150000000', 'hola', 'ninguna')`);
  r = await pedir('GET', '/comunicaciones/respuestas', { usuario: lid1 });
  ok(r.status === 403, 'respuestas: líder 403', r.status);
  r = await pedir('GET', '/comunicaciones/respuestas', { usuario: asis });
  ok(r.status === 403, 'respuestas: asistente 403', r.status);
  r = await pedir('GET', '/comunicaciones/respuestas', { usuario: coord });
  ok(r.status === 200, 'respuestas: coordinador 200', r.status);
  r = await pedir('GET', '/comunicaciones/respuestas', { usuario: admin });
  ok(r.status === 200, 'respuestas: administrador 200', r.status);
  r = await pedir('POST', '/comunicaciones/respuestas/1/leida', { usuario: lid1 });
  ok(r.status === 403, 'marcar respuesta leída: líder 403', r.status);

  // ====================================================================================== 3. DESTINATARIOS ACOTADOS
  console.log('\n3. A quién puede escribirle un líder o un asistente');
  const vPropio = await votante('Votante Propio', lid1, { telefono: '3130000001', email: `vpropio${sello}@x.test` });
  const vAjeno = await votante('Votante Ajeno', lid2, { telefono: '3130000002', email: `vajeno${sello}@x.test` });
  const vOtro = await votante('Votante Del Coordinador', coordOtro, { telefono: '3130000003', email: `votro${sello}@x.test` });
  const preview = async (usuarioQuien, filtros, canal = 'sms') =>
    (await pedir('POST', '/comunicaciones/destinatarios/preview', { usuario: usuarioQuien, json: { canal, completo: true, filtros } })).datos;
  for (const fuente of ['votantes', 'ambos', 'estructura', 'testigos', 'organigrama']) {
    const d = await preview(lid1, [{ fuente }]);
    const nom = (d.destinatarios || []).map((x) => x.nombre);
    ok(!nom.includes('Votante Ajeno') && !nom.includes('Votante Del Coordinador') && !nom.includes('Lider Dos') && !nom.includes('Org Baja') && !nom.includes('Org Libre'),
      `líder, vista previa «${fuente}» (completo:true): nada fuera de su alcance`, nom);
  }
  let d = await preview(lid1, [{ fuente: 'votantes' }]);
  ok((d.destinatarios || []).map((x) => x.nombre).includes('Votante Propio'), 'líder, «votantes»: SÍ ve a su votante');
  d = await preview(lid1, [{ fuente: 'estructura' }]);
  ok((d.destinatarios || []).map((x) => x.nombre).includes('Sub Dos'), 'líder, «estructura»: SÍ ve a quien le reporta');
  d = await preview(asis, [{ fuente: 'ambos' }]);
  ok(d.total === 0, 'asistente administrativo, «ambos»: no ve a nadie (no registró a nadie)', d.total);
  d = await preview(coord, [{ fuente: 'votantes' }]);
  ok((d.destinatarios || []).map((x) => x.nombre).includes('Votante Ajeno'), 'el coordinador sigue como estaba (no se acota en esta orden)');
  d = await preview(admin, [{ fuente: 'votantes' }]);
  ok((d.destinatarios || []).map((x) => x.nombre).includes('Votante Ajeno'), 'el administrador sigue viendo a todos');

  r = await pedir('GET', '/comunicaciones/destinatarios/buscar?q=Votante&canal=sms', { usuario: lid1 });
  ok(r.status === 200 && nombres(r).includes('Votante Propio') && !nombres(r).includes('Votante Ajeno') && !nombres(r).includes('Votante Del Coordinador'), 'buscador del líder: solo su gente', nombres(r));
  r = await pedir('GET', '/comunicaciones/destinatarios/buscar?q=Votante&canal=sms', { usuario: admin });
  ok(r.status === 200 && nombres(r).includes('Votante Ajeno'), 'buscador del administrador: toda la base', nombres(r));

  // «seleccion» por id y «manual» por teléfono: tampoco devuelven a nadie ajeno
  d = await preview(lid1, [{ fuente: 'seleccion', seleccion: [{ tipo: 'votante', id: vAjeno }, { tipo: 'votante', id: vPropio }] }]);
  ok((d.destinatarios || []).map((x) => x.nombre).join() === 'Votante Propio', 'selección por id con un votante ajeno: el ajeno no entra', (d.destinatarios || []).map((x) => x.nombre));
  d = await preview(lid1, [{ fuente: 'manual', manual: '3130000002' }]);
  const man = (d.destinatarios || [])[0] || (d.muestra || [])[0];
  ok(!man || (man.nombre !== 'Votante Ajeno' && man.tipo === 'manual'), 'un teléfono tecleado que es de un votante ajeno NO devuelve su nombre', man);
  d = await preview(lid1, [{ fuente: 'manual', manual: '3130000001' }]);
  ok(((d.destinatarios || [])[0] || {}).nombre === 'Votante Propio', 'un teléfono tecleado que es de su votante sí se reconoce', d.destinatarios);

  // El ENVÍO también: POST /campanas del líder por correo, fuente «votantes» (toda la base) → solo los suyos
  correosEnviados.length = 0;
  r = await pedir('POST', '/comunicaciones/campanas', { usuario: lid1, json: {
    nombre: 'Envío del líder', canal: 'email_personal', asunto: 'Hola', mensaje: 'Hola', filtros: [{ fuente: 'ambos' }] } });
  ok(r.status === 200, 'POST /campanas del líder, fuente «ambos»', r.texto);
  const idLid = r.datos && r.datos.campana_id;
  await esperarCampana(idLid);
  const filasLid = await q('SELECT destinatario_nombre AS n, estado FROM comunicaciones_envios WHERE campana_id = ?', [idLid]);
  const quienes = filasLid.map((f) => f.n);
  ok(!quienes.includes('Votante Ajeno') && !quienes.includes('Votante Del Coordinador') && quienes.includes('Votante Propio'), 'el envío del líder llega solo a su gente', quienes);
  ok(!correosEnviados.includes(`vajeno${sello}@x.test`) && !correosEnviados.includes(`votro${sello}@x.test`), 'el transporte no vio a nadie ajeno', correosEnviados);
  r = await pedir('GET', '/comunicaciones/campanas', { usuario: lid1 });
  ok((r.datos || []).some((c) => c.id === idLid), 'y esa campaña aparece en el historial del líder');

  // ====================================================================================== 4. verificar-duplicado
  console.log('\n4. verificar-duplicado y verificar-identificacion');
  const vDup = await votante('Maria Gomez Ruiz', lid2, { telefono: '3140000009', cedula: '1053999888' });
  const usuarioDup = { id: lid1.id, rol: 'lider', nombre: lid1.nombre };
  r = await pedir('GET', '/votantes/verificar-duplicado?nombre=Maria%20Gomez&telefono=3140000009', { usuario: usuarioDup });
  const co = (r.datos && r.datos.coincidencias || [])[0] || {};
  ok(r.status === 200 && co.existe === true && co.iniciales === 'M. R.', 'responde que existe, con las iniciales', r.datos);
  ok(co.registrado_por === 'Lider Dos' && co.mia === false && co.porTelefono === true, 'dice quién la registró (el líder dueño) y que no es mía', co);
  ok(!/1053999888|3140000009|Maria Gomez/.test(r.texto), 'la respuesta NO trae cédula, teléfono ni nombre completo', r.texto);
  r = await pedir('GET', '/votantes/verificar-duplicado?nombre=Votante%20Propio&telefono=', { usuario: usuarioDup });
  ok(((r.datos.coincidencias || [])[0] || {}).mia === true && ((r.datos.coincidencias || [])[0] || {}).registrado_por === 'usted', 'si la ficha es del mismo usuario: mia=true, «usted»', r.datos);
  // El límite: 120 por usuario cada 10 minutos
  let ultimo = 0;
  const limiteUsuario = { id: 999000 + Number(sello.slice(-3)), rol: 'lider', nombre: 'Limite' };
  for (let i = 0; i < 125; i++) {
    const rr = await pedir('GET', '/votantes/verificar-duplicado?nombre=Zzz%20Prueba%20' + i, { usuario: limiteUsuario });
    ultimo = rr.status;
    if (rr.status === 429) { ok(i >= 120, `el límite corta pasadas 120 consultas (cortó en la ${i + 1})`, i); break; }
  }
  ok(ultimo === 429, 'verificar-duplicado responde 429 al pasarse del límite', ultimo);

  r = await pedir('GET', '/votantes/verificar-identificacion?numero=1053999888', { usuario: usuarioDup });
  ok(r.datos && r.datos.disponible === false && r.datos.mia === false, 'verificar-identificacion: ficha de otro → disponible=false, mia=false (aviso rojo)', r.datos);
  const vMia = await votante('Mia Registrada', lid1, { cedula: '1053777666' });
  r = await pedir('GET', '/votantes/verificar-identificacion?numero=1053777666', { usuario: usuarioDup });
  ok(r.datos && r.datos.disponible === false && r.datos.mia === true, 'verificar-identificacion: ficha MÍA → mia=true (no sale el aviso rojo)', r.datos);
  r = await pedir('GET', '/votantes/verificar-identificacion?numero=1053000111', { usuario: usuarioDup });
  ok(r.datos && r.datos.disponible === true, 'verificar-identificacion: cédula libre → disponible', r.datos);

  // ====================================================================================== 5. EVENTOS, EXCEL, ESTRUCTURA, CÉDULA
  console.log('\n5. Eventos, exportación, estructura y cédula tapada');
  r = await pedir('POST', '/eventos', { usuario: lid1, json: { titulo: 'Reunión del líder', tipo: 'reunion', fecha_inicio: '2026-12-05 10:00:00', lugar: 'Salón' } });
  ok(r.status === 200 || r.status === 201, 'el líder crea su evento (queda de responsable)', r.texto);
  const evId = r.datos && (r.datos.id || r.datos.evento_id);
  r = await pedir('POST', `/eventos/${evId}/asistentes`, { usuario: lid1, json: { votante_id: vAjeno } });
  ok(r.status === 404, 'agregar a su evento un votante AJENO: rechazado (404)', r.status + ' ' + r.texto);
  r = await pedir('POST', `/eventos/${evId}/asistentes`, { usuario: lid1, json: { votante_id: vPropio } });
  ok(r.status === 200, 'agregar un votante PROPIO: ok', r.texto);
  r = await pedir('POST', `/eventos/${evId}/asistentes`, { usuario: lid1, json: { usuario_id: lid2.id } });
  ok(r.status === 404, 'agregar a un usuario de otra rama: rechazado (404)', r.status);
  r = await pedir('POST', `/eventos/${evId}/asistentes`, { usuario: lid1, json: { usuario_id: sub2.id } });
  ok(r.status === 200, 'agregar a alguien de su equipo: ok', r.texto);
  r = await pedir('POST', `/eventos/${evId}/asistentes`, { usuario: lid1, json: { nombre_invitado: 'Invitada Escrita' } });
  ok(r.status === 200, 'un invitado escrito a mano sigue funcionando', r.texto);
  // el administrador, en su evento, puede agregar a cualquiera
  r = await pedir('POST', '/eventos', { usuario: admin, json: { titulo: 'Reunión del admin', tipo: 'reunion', fecha_inicio: '2026-12-06 10:00:00', lugar: 'Salón' } });
  const evAdmin = r.datos && (r.datos.id || r.datos.evento_id);
  r = await pedir('POST', `/eventos/${evAdmin}/asistentes`, { usuario: admin, json: { votante_id: vAjeno } });
  ok(r.status === 200, 'el administrador agrega a cualquiera', r.texto);

  // La cédula tapada: el líder (responsable) ve el teléfono pero la cédula sale ***
  r = await pedir('GET', `/eventos/${evId}/asistentes`, { usuario: lid1 });
  const fila = (r.datos || []).find((a) => a.votante_id === vPropio) || {};
  const cedPropia = (await q('SELECT cedula, telefono FROM votantes WHERE id = ?', [vPropio]))[0];
  ok(fila.telefono_resuelto === cedPropia.telefono && /^\*\*\*\d{3}$/.test(fila.identidad_resuelta || ''), 'líder responsable: ve el teléfono y la cédula TAPADA (***456)', fila);
  r = await pedir('GET', `/eventos/${evId}/asistentes`, { usuario: admin });
  const filaAdmin = (r.datos || []).find((a) => a.votante_id === vPropio) || {};
  ok(filaAdmin.identidad_resuelta === cedPropia.cedula, 'administrador: ve la cédula completa', filaAdmin);
  r = await pedir('GET', '/eventos/asistentes-consolidado', { usuario: lid1 });
  const cons = (r.datos || []).find((p) => p.nombre === 'Votante Propio') || {};
  ok(/^\*\*\*\d{3}$/.test(cons.identidad || '') && cons.telefono === cedPropia.telefono, 'consolidado del líder: cédula tapada, teléfono visible', cons);
  r = await pedir('GET', '/eventos/asistentes-consolidado', { usuario: admin });
  ok(((r.datos || []).find((p) => p.nombre === 'Votante Propio') || {}).identidad === cedPropia.cedula, 'consolidado del administrador: cédula completa');

  // Excel de votantes del coordinador: solo su rama
  const vDeCoord = await votante('Excel Rama Coord', lid1, { cedula: '1053555001' });
  const vFuera = await votante('Excel Fuera Rama', lid2, { cedula: '1053555002' });
  r = await pedir('GET', '/votantes/exportar-excel', { usuario: coord });
  ok(r.status === 200 && r.buffer, 'Excel de votantes del coordinador', r.status);
  const nomsExcel = (b) => XLSX.utils.sheet_to_json(XLSX.read(b, { type: 'buffer' }).Sheets[XLSX.read(b, { type: 'buffer' }).SheetNames[0]]).map((f) => f['Nombres y apellidos']);
  const exC = nomsExcel(r.buffer);
  ok(exC.includes('Excel Rama Coord') && !exC.includes('Excel Fuera Rama') && !exC.includes('Votante Del Coordinador'), 'el coordinador exporta SOLO su rama', exC);
  r = await pedir('GET', '/votantes/exportar-excel', { usuario: admin });
  const exA = nomsExcel(r.buffer);
  ok(exA.includes('Excel Rama Coord') && exA.includes('Excel Fuera Rama'), 'el administrador exporta todo', exA);
  r = await pedir('GET', '/votantes/exportar-excel', { usuario: coord });
  const filaC = XLSX.utils.sheet_to_json(XLSX.read(r.buffer, { type: 'buffer' }).Sheets[XLSX.read(r.buffer, { type: 'buffer' }).SheetNames[0]]).find((f) => f['Nombres y apellidos'] === 'Excel Rama Coord') || {};
  ok(String(filaC['Número de identificación']).replace(/\D/g, '') === '1053555001', 'el coordinador ve la cédula completa en el Excel', filaC['Número de identificación']);

  // Estructura (pantalla y Excel) del coordinador
  r = await pedir('GET', '/territorial/estructura', { usuario: coord });
  const nomEst = (r.datos || []).map((e) => e.nombre);
  ok(r.status === 200 && nomEst.includes('Coord Uno') && nomEst.includes('Lider Uno') && nomEst.includes('Sub Dos') && !nomEst.includes('Lider Dos') && !nomEst.includes('Coord Dos'),
    'GET /territorial/estructura del coordinador: su rama (él, su líder, sus sublíderes), no la del otro', nomEst);
  r = await pedir('GET', '/territorial/estructura', { usuario: admin });
  const nomEstA = (r.datos || []).map((e) => e.nombre);
  ok(nomEstA.includes('Lider Dos') && nomEstA.includes('Coord Dos') && nomEstA.includes('Lider Uno'), 'el administrador ve toda la estructura', nomEstA);
  r = await pedir('GET', '/territorial/estructura/exportar-excel', { usuario: coord });
  ok(r.status === 200 && r.buffer, 'Excel de estructura del coordinador', r.status);
  const exE = XLSX.utils.sheet_to_json(XLSX.read(r.buffer, { type: 'buffer' }).Sheets[XLSX.read(r.buffer, { type: 'buffer' }).SheetNames[0]]).map((f) => f['Nombre']);
  ok(exE.includes('Lider Uno') && exE.includes('Sub Dos') && !exE.includes('Lider Dos') && !exE.includes('Coord Dos'), 'el Excel de estructura del coordinador: solo su rama', exE);
  r = await pedir('GET', '/territorial/estructura/exportar-excel', { usuario: admin });
  const exEA = XLSX.utils.sheet_to_json(XLSX.read(r.buffer, { type: 'buffer' }).Sheets[XLSX.read(r.buffer, { type: 'buffer' }).SheetNames[0]]).map((f) => f['Nombre']);
  ok(exEA.includes('Lider Dos') && exEA.includes('Coord Dos'), 'el Excel de estructura del administrador: todo', exEA);

  // lib/enmascarar
  const m = require('../lib/enmascarar');
  ok(m.enmascararCedula('1053123456') === '***456', 'enmascararCedula: últimos 3 dígitos');
  ok(m.enmascararTelefono('3001234567') === '*** *** 4567', 'enmascararTelefono');
  ok(m.enmascararEmail('maria@correo.com') === 'm***@correo.com', 'enmascararEmail');
  ok(m.cedulaPara({ rol: 'lider' }, '1053123456') === '***456' && m.cedulaPara({ rol: 'admin' }, '1053123456') === '1053123456' && m.cedulaPara({ rol: 'coordinador' }, '1053123456') === '1053123456' && m.cedulaPara(null, '1053123456') === '***456', 'cedulaPara: completa solo para administrador y coordinador');

  // ------------------------------------------------------------------ limpieza ligera (la base es desechable)
  servidor.close();
  await pool.end();
  console.log(fallos ? `\n${fallos} comprobación(es) FALLARON.` : '\nTodo bien.');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('Error de la prueba:', e); process.exit(1); });
