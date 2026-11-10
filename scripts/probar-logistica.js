#!/usr/bin/env node
// scripts/probar-logistica.js
//
// Prueba de la LOGÍSTICA DEL DÍA D (orden 39): tablas e ítems de fábrica (init-db dos veces), el plan por puesto (con y sin suplentes, la
// fila de conductores), los permisos (módulo y coordinador de puesto), la entrega idempotente (doble toque, dos a la vez, cola sin
// señal), la foto, el contador, la alerta «sin entregar» (antes y después de la hora, y fuera del día de la elección) y el Excel.
// Levanta las rutas reales en un Express de prueba (sesión fingida por cabecera). NO usa servicios externos.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada39 node scripts/probar-logistica.js
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
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const XLSX = require('xlsx');
const sharp = require('sharp');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const jornada = require('../lib/jornadaDiaD');
const L = require('../lib/logisticaDiaD');
const alertasLib = require('../lib/alertasDiaD');
const avisos = require('../lib/avisosAlertas');
const { UPLOAD_DIA_D_DIR } = require('../middleware/upload');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }
const leer = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const warnOriginal = console.warn;
console.warn = () => {};                       // el aviso «no se pudo guardar la foto» es esperado en una de las pruebas

// El reloj: la jornada del 8 de noviembre de 2026, que es también la fecha de la elección en esta prueba.
const FECHA = '2026-11-08';
const a = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return new Date(Date.UTC(2026, 10, 8, h + 5, m)); };   // hora de Colombia → UTC
const ponerHora = (hhmm) => { jornada.reloj = () => a(hhmm); };

let sublicencia = null;
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use((req, res, next) => {
  const u = req.headers['x-test-user'];
  req.session = { usuario: u ? JSON.parse(u) : undefined };
  req.sublicencia = req.headers['x-test-aspirante'] ? sublicencia : null;
  next();
});
app.use('/api/dia-d/logistica', require('../routes/logisticaDiaD.routes'));
app.use('/api/dia-d/alertas', require('../routes/alertasDiaD.routes'));

let base = '';
async function pedir(metodo, ruta, { json, usuario, form, aspirante, binario } = {}) {
  const h = { 'X-Forwarded-For': '198.51.100.7', 'User-Agent': 'prueba/1.0' };
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  if (aspirante) h['X-Test-Aspirante'] = '1';
  const r = await fetch(base + ruta, { method: metodo, headers: h, body });
  if (binario) return { status: r.status, buffer: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') };
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
  return { status: r.status, datos, texto };
}
const P = (r) => '/api/dia-d/logistica' + r;

let n = 0;
async function usuario(nombre, rol, extra = {}) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo)
     VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, extra.cedula || `8400000${n}`, `u8400000${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  return { id: r.insertId, rol, nombre };
}
async function testigo(u, puestoId, tipo, mesa, activo = 1) {
  await pool.query(
    `INSERT INTO estructura (usuario_id, cargo, tipo_testigo, mesa_votacion, puesto_id, activo) VALUES (?, 'testigo', ?, ?, ?, ?)`,
    [u.id, tipo, mesa || null, puestoId, activo]);
}
async function llego(u, puestoId) {
  await pool.query('INSERT INTO dia_d_checkin (aspirante_id, usuario_id, puesto_id, fecha, origen) VALUES (0, ?, ?, ?, ?)', [u.id, puestoId, FECHA, 'testigo']);
}
const entregasDe = async (itemId) => q("SELECT * FROM logistica_entregas WHERE item_id = ? AND estado = 'entregado'", [itemId]);

(async () => {
  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  ponerHora('06:00');

  // ============================================================== 1. tablas e ítems de fábrica (init-db dos veces)
  console.log('\n== Tablas e ítems de fábrica; init-db dos veces');
  const tablas = (await q("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'logistica_%'")).map(x => x.t).sort();
  ok(tablas.join() === 'logistica_entregas,logistica_items,logistica_plan', 'las tres tablas existen', tablas);
  const uq = await q("SHOW INDEX FROM logistica_entregas WHERE Key_name = 'uq_logi_entrega'");
  ok(uq.map(x => x.Column_name).join() === 'item_id,receptor_usuario_id,fecha' && uq.every(x => x.Non_unique === 0), 'la clave única es (ítem, receptor, fecha)', uq.map(x => x.Column_name));
  let items0 = await q("SELECT nombre, TIME_FORMAT(hora_limite, '%H:%i') h, destinatario, activo, incluir_suplentes FROM logistica_items WHERE aspirante_id = 0 ORDER BY orden");
  ok(items0.map(i => `${i.nombre}@${i.h}`).join() === 'Kit de testigo@07:00,Refrigerio@12:00,Almuerzo@14:00', 'ítems de fábrica: Kit 07:00, Refrigerio 12:00, Almuerzo 14:00', items0);
  ok(items0.every(i => i.destinatario === 'testigos' && i.activo === 1 && i.incluir_suplentes === 0), 'todos a testigos, activos y con suplentes apagado');
  await pool.query("UPDATE logistica_items SET nombre = 'Desayuno', activo = 0 WHERE nombre = 'Refrigerio' AND aspirante_id = 0");
  const hijo = spawnSync(process.execPath, [path.join(__dirname, '..', 'db', 'init-db.js')], { env: process.env, encoding: 'utf8' });
  for (const f of ['.credenciales-admin.txt', '.credenciales-superadmin.txt']) { try { fs.unlinkSync(path.join(__dirname, '..', f)); } catch (_) { /* no había */ } }
  ok(hijo.status === 0, 'init-db por segunda vez termina bien', (hijo.stderr || '').slice(-200));
  items0 = await q("SELECT nombre, activo FROM logistica_items WHERE aspirante_id = 0 ORDER BY orden");
  ok(items0.length === 3 && items0[1].nombre === 'Desayuno' && items0[1].activo === 0, 'la segunda corrida NO recrea ni pisa lo que el administrador renombró o desactivó', items0);
  await pool.query("UPDATE logistica_items SET nombre = 'Refrigerio', activo = 1 WHERE nombre = 'Desayuno' AND aspirante_id = 0");

  // ============================================================== 2. el terreno
  await pool.query('DELETE FROM logistica_entregas');
  await pool.query('DELETE FROM logistica_plan');
  await pool.query('DELETE FROM dia_d_checkin');
  await pool.query('DELETE FROM dia_d_suplentes_testigo');
  await pool.query('DELETE FROM transporte_conductores');
  await pool.query("DELETE FROM estructura WHERE usuario_id IN (SELECT id FROM usuarios WHERE numero_identificacion LIKE '8400000%')");
  await pool.query("DELETE FROM usuarios WHERE numero_identificacion LIKE '8400000%'");
  await pool.query('DELETE FROM dia_d_puestos_votacion');
  await pool.query('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');      // una base recién creada no trae la fila
  await pool.query('UPDATE configuracion_campana SET fecha_eleccion = ? WHERE id = 1', [FECHA]);

  const [pa] = await pool.query("INSERT INTO dia_d_puestos_votacion (nombre, cantidad_mesas, aspirante_id) VALUES ('PUESTO A', 8, 0)");
  const [pb] = await pool.query("INSERT INTO dia_d_puestos_votacion (nombre, cantidad_mesas, aspirante_id) VALUES ('PUESTO B', 5, 0)");
  const PA = pa.insertId, PB = pb.insertId;
  const admin = await usuario('Admin Prueba', 'admin', { cedula: '84000000011' });
  const coord = await usuario('Coordinador Prueba', 'coordinador');
  const lider = await usuario('Lider Prueba', 'lider');
  const tp1 = await usuario('Coordinadora Puesto A', 'testigo', { cedula: '1053000991' });
  const tp2 = await usuario('Coordinador Puesto B', 'testigo');
  const t1 = await usuario('Testigo Uno A', 'testigo', { cedula: '1053000992' });
  const t2 = await usuario('Testigo Dos A', 'testigo');
  const t3 = await usuario('Testigo Tres B', 'testigo');
  const tInactivo = await usuario('Testigo Inactivo A', 'testigo');
  const sup1 = await usuario('Suplente Uno A', 'testigo');
  await testigo(tp1, PA, 'puesto'); await testigo(tp2, PB, 'puesto');
  await testigo(t1, PA, 'mesa', 1); await testigo(t2, PA, 'mesa', 2); await testigo(t3, PB, 'mesa', 1);
  await testigo(tInactivo, PA, 'mesa', 3, 0);
  await pool.query('INSERT INTO dia_d_suplentes_testigo (aspirante_id, puesto_id, usuario_id) VALUES (0, ?, ?)', [PA, sup1.id]);
  await pool.query("INSERT INTO transporte_conductores (aspirante_id, nombre, codigo, activo) VALUES (0, 'Conductor 1', 'AAAA2222', 1), (0, 'Conductor 2', 'BBBB3333', 1), (0, 'Conductor 3', 'CCCC4444', 0)");
  const itemId = async (nombre) => (await q('SELECT id FROM logistica_items WHERE aspirante_id = 0 AND nombre = ?', [nombre]))[0].id;
  const KIT = await itemId('Kit de testigo'), REF = await itemId('Refrigerio'), ALM = await itemId('Almuerzo');

  // ============================================================== 3. el plan
  console.log('\n== El plan por puesto');
  const plan = (await pedir('GET', P('/plan'), { usuario: admin })).datos;
  const fA = plan.puestos.find(f => f.puesto === 'PUESTO A'), fB = plan.puestos.find(f => f.puesto === 'PUESTO B');
  ok(fA.testigos === 3 && fB.testigos === 2, 'testigos asignados: A = 3 (con la coordinadora de puesto; sin el inactivo), B = 2', [fA.testigos, fB.testigos]);
  ok(fA.suplentes === 1 && fB.suplentes === 0, 'suplentes: A = 1', [fA.suplentes, fB.suplentes]);
  const cel = (f, id) => f.items.find(x => x.item_id === id);
  ok(cel(fA, REF).sugerido === 3 && cel(fA, REF).cantidad === 3 && !cel(fA, REF).manual, 'sugerido SIN suplentes (interruptor apagado): A refrigerio = 3');
  ok(plan.totales.find(t => t.item_id === REF).total === 5, 'total a comprar de refrigerios: 3 + 2 = 5', plan.totales);
  await pedir('PUT', P(`/items/${REF}`), { usuario: admin, json: { incluir_suplentes: true } });
  const plan2 = (await pedir('GET', P('/plan'), { usuario: admin })).datos;
  ok(cel(plan2.puestos.find(f => f.puesto === 'PUESTO A'), REF).sugerido === 4 && plan2.totales.find(t => t.item_id === REF).total === 6, 'sugerido CON suplentes: A = 4 y el total sube a 6', plan2.totales);
  ok(cel(plan2.puestos.find(f => f.puesto === 'PUESTO A'), KIT).sugerido === 3, 'el interruptor es por ítem: el kit sigue en 3');
  await pedir('PUT', P(`/items/${REF}`), { usuario: admin, json: { incluir_suplentes: false } });
  const corr = await pedir('PUT', P('/plan'), { usuario: admin, json: { item_id: REF, puesto_id: PA, cantidad: 10 } });
  const plan3 = (await pedir('GET', P('/plan'), { usuario: admin })).datos;
  ok(corr.status === 200 && cel(plan3.puestos.find(f => f.puesto === 'PUESTO A'), REF).cantidad === 10 && cel(plan3.puestos.find(f => f.puesto === 'PUESTO A'), REF).manual
    && cel(plan3.puestos.find(f => f.puesto === 'PUESTO A'), REF).sugerido === 3 && plan3.totales.find(t => t.item_id === REF).total === 12, 'corregido a mano: A = 10 (sugerido 3 se conserva), total 12', plan3.totales);
  await pedir('PUT', P('/plan'), { usuario: admin, json: { item_id: REF, puesto_id: PA, cantidad: null } });
  ok(!(cel((await pedir('GET', P('/plan'), { usuario: admin })).datos.puestos.find(f => f.puesto === 'PUESTO A'), REF)).manual, 'cantidad null: vuelve a la sugerida');
  ok((await pedir('PUT', P('/plan'), { usuario: admin, json: { item_id: REF, puesto_id: PA, cantidad: -3 } })).status === 400, 'una cantidad negativa se rechaza (400)');
  ok((await pedir('PUT', P('/plan'), { usuario: admin, json: { item_id: REF, puesto_id: PA, cantidad: 2.5 } })).status === 400, 'una cantidad con decimales se rechaza (400)');
  // La fila de conductores
  const crear = await pedir('POST', P('/items'), { usuario: admin, json: { nombre: 'Almuerzo de conductor', destinatario: 'conductores', hora_limite: '13:00' } });
  const CON = crear.datos.id;
  const plan4 = (await pedir('GET', P('/plan'), { usuario: admin })).datos;
  ok(plan4.transporte.conductores === 2 && plan4.transporte.items.length === 1 && plan4.transporte.items[0].cantidad === 2, 'fila «Transporte»: 2 conductores activos (el inactivo no cuenta)', plan4.transporte);
  const tot = plan4.totales.find(t => t.item_id === CON);
  ok(tot && tot.total === 2 && tot.entregados === null && tot.destinatario === 'conductores', 'su total a comprar es 2 y no tiene «entregados»', tot);
  ok(!plan4.puestos[0].items.some(c => c.item_id === CON), 'el ítem de conductores NO aparece por puesto');
  ok((await pedir('PUT', P('/plan'), { usuario: admin, json: { item_id: CON, puesto_id: PA, cantidad: 3 } })).status === 400, 'no se corrige a mano la cantidad de un ítem de conductores');
  ok((await pedir('POST', P('/items'), { usuario: admin, json: { nombre: 'Almuerzo de conductor' } })).status === 409, 'dos ítems con el mismo nombre: 409');
  ok((await pedir('POST', P('/items'), { usuario: admin, json: { nombre: '  ' } })).status === 400, 'ítem sin nombre: 400');
  ok((await pedir('PUT', P(`/items/${CON}`), { usuario: admin, json: { hora_limite: '25:61' } })).status === 400, 'hora inválida: 400');
  await pedir('PUT', P(`/items/${CON}`), { usuario: admin, json: { activo: false } });
  ok(!(await pedir('GET', P('/plan'), { usuario: admin })).datos.totales.some(t => t.item_id === CON), 'un ítem desactivado sale del plan y de la compra');

  // ============================================================== 4. permisos
  console.log('\n== Permisos');
  ok((await pedir('GET', P('/plan'), { usuario: lider })).status === 403, 'un líder (sin el módulo) recibe 403 en el plan');
  ok((await pedir('GET', P('/items'), { usuario: lider })).status === 403, '…y en los ítems');
  ok((await pedir('GET', P('/mi-puesto'), { usuario: lider })).status === 403, '…y en la pantalla del celular (no es coordinador de puesto)');
  ok((await pedir('GET', P('/exportar-excel'), { usuario: lider, binario: true })).status === 403, '…y en el Excel');
  ok((await pedir('GET', P('/plan'), { usuario: coord })).status === 200, 'el coordinador (módulo de fábrica) entra');
  ok((await pedir('GET', P('/plan'), {})).status === 401, 'sin sesión: 401');
  ok((await pedir('GET', P('/plan'), { usuario: tp1 })).status === 403, 'el coordinador de puesto NO entra a la pantalla de escritorio (plan)');
  ok((await pedir('PUT', P('/plan'), { usuario: tp1, json: { item_id: REF, puesto_id: PA, cantidad: 1 } })).status === 403, '…ni puede corregir el plan');
  ok((await pedir('GET', P('/mi-puesto'), { usuario: t1 })).status === 403, 'un testigo común (no coordinador de puesto) recibe 403 en el celular');
  const mia = await pedir('GET', P('/mi-puesto'), { usuario: tp1 });
  ok(mia.status === 200 && mia.datos.puesto.nombre === 'PUESTO A', 'el coordinador de puesto A ve SU puesto', mia.datos && mia.datos.puesto);
  ok(mia.datos.testigos.map(t => t.nombre).sort().join() === 'Coordinadora Puesto A,Testigo Dos A,Testigo Uno A', 'con sus 3 testigos (sin el inactivo ni los de B)', mia.datos.testigos.map(t => t.nombre));
  ok(!JSON.stringify(mia.datos).includes('1053000992') && !('telefono' in mia.datos.testigos[0]) && !('cedula' in mia.datos.testigos[0]), 'y sin cédulas ni teléfonos');
  const ajeno = await pedir('GET', P(`/mi-puesto?puesto_id=${PB}`), { usuario: tp1 });
  ok(ajeno.status === 200 && ajeno.datos.puesto.nombre === 'PUESTO A', 'pedir el puesto B siendo coordinador del A: se ignora, ve el suyo', ajeno.datos && ajeno.datos.puesto);
  const staffB = await pedir('GET', P(`/mi-puesto?puesto_id=${PB}`), { usuario: coord });
  ok(staffB.status === 200 && staffB.datos.puesto.nombre === 'PUESTO B' && staffB.datos.es_coordinacion, 'la coordinación sí puede abrir el puesto B');
  ok((await pedir('GET', P('/mi-puesto'), { usuario: coord })).status === 400, 'la coordinación sin indicar puesto: 400');

  // ============================================================== 5. entregar
  console.log('\n== Entregar: idempotente, doble toque, cola sin señal');
  const entrega = (u, body, extra = {}) => { const fd = new FormData(); Object.entries(body).forEach(([k, v]) => fd.append(k, String(v))); if (extra.foto) fd.append('foto', new Blob([extra.foto], { type: extra.tipo || 'image/jpeg' }), 'foto.jpg'); return pedir('POST', P('/entregar'), { usuario: u, form: fd }); };
  const e1 = await entrega(tp1, { item_id: REF, receptor_usuario_id: t1.id, cliente_uuid: 'uuid-prueba-0001' });
  ok(e1.status === 200 && e1.datos.resultado === 'entregado' && !e1.datos.ya_estaba, 'entrega del refrigerio a un testigo del puesto', e1.datos || e1.texto);
  const e1b = await entrega(tp1, { item_id: REF, receptor_usuario_id: t1.id, cliente_uuid: 'uuid-prueba-0002' });
  ok(e1b.status === 200 && e1b.datos.ya_estaba && e1b.datos.id === e1.datos.id, 'segundo toque: ya_estaba, la misma entrega', e1b.datos);
  const e1c = await entrega(tp1, { item_id: REF, receptor_usuario_id: t1.id, cliente_uuid: 'uuid-prueba-0001' });
  ok(e1c.datos.ya_estaba, 'reintento con el MISMO identificador (cola sin señal): ya_estaba');
  const dos = await Promise.all([1, 2, 3].map(i => entrega(tp1, { item_id: REF, receptor_usuario_id: t2.id, cliente_uuid: `uuid-simultaneo-${i}` })));
  ok(dos.every(r => r.status === 200) && dos.filter(r => !r.datos.ya_estaba).length === 1, 'tres toques a la vez: UNO entrega y los otros dos ya_estaba', dos.map(r => r.datos));
  ok((await entregasDe(REF)).length === 2, 'en la base hay exactamente 2 entregas del refrigerio (una por testigo)');
  ok((await entrega(tp1, { item_id: REF, receptor_usuario_id: t3.id })).status === 400, 'entregar a un testigo de OTRO puesto: 400');
  ok((await entrega(tp1, { item_id: REF, receptor_usuario_id: t3.id, puesto_id: PB })).status === 400, '…aunque mande el puesto B: se usa el suyo');
  ok((await entrega(tp1, { item_id: REF, receptor_usuario_id: tInactivo.id })).status === 400, 'entregar a un testigo inactivo: 400');
  ok((await entrega(tp1, { item_id: CON, receptor_usuario_id: t1.id })).status === 409, 'entregar un ítem desactivado: 409');
  await pedir('PUT', P(`/items/${CON}`), { usuario: admin, json: { activo: true } });
  ok((await entrega(tp1, { item_id: CON, receptor_usuario_id: t1.id })).status === 400, 'un ítem para conductores no se entrega a testigos: 400');
  ok((await entrega(t1, { item_id: REF, receptor_usuario_id: t2.id })).status === 403, 'un testigo común no puede entregar: 403');
  ok((await entrega(tp1, { item_id: 999999, receptor_usuario_id: t1.id })).status === 404, 'ítem inexistente: 404');
  // Cualquier testigo puede recibir, haya hecho check-in o no: t1 y t2 no han marcado «Llegué».
  ok((await q('SELECT COUNT(*) n FROM dia_d_checkin'))[0].n === 0, '(nadie ha hecho check-in y aun así se entregó)');
  // Sin señal: la hora del toque
  const haceDosHoras = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const off = await entrega(tp1, { item_id: KIT, receptor_usuario_id: t1.id, cliente_uuid: 'uuid-sinsenal-01', marcado_en: haceDosHoras });
  const filaOff = (await q('SELECT TIMESTAMPDIFF(MINUTE, entregado_en, NOW()) AS min FROM logistica_entregas WHERE id = ?', [off.datos.id]))[0];
  ok(off.datos.resultado === 'entregado' && filaOff.min >= 118 && filaOff.min <= 122, 'una entrega subida tarde guarda la hora del TOQUE (hace ~2 h), no la de la subida', filaOff);
  const futuro = await entrega(tp1, { item_id: KIT, receptor_usuario_id: t2.id, cliente_uuid: 'uuid-sinsenal-02', marcado_en: new Date(Date.now() + 3600 * 1000).toISOString() });
  ok((await q('SELECT TIMESTAMPDIFF(MINUTE, entregado_en, NOW()) AS min FROM logistica_entregas WHERE id = ?', [futuro.datos.id]))[0].min <= 1, 'una hora del futuro se descarta (queda la de ahora)');
  const reint = await entrega(tp1, { item_id: KIT, receptor_usuario_id: t1.id, cliente_uuid: 'uuid-sinsenal-01', marcado_en: haceDosHoras });
  ok(reint.datos.ya_estaba, 'la cola reintenta la misma entrega: no se duplica');
  // Anular y volver a entregar
  const anula = await pedir('POST', P('/anular'), { usuario: tp1, json: { entrega_id: e1.datos.id } });
  ok(anula.status === 200 && (await entregasDe(REF)).length === 1, 'anular una entrega hecha por error');
  ok((await pedir('POST', P('/anular'), { usuario: tp1, json: { entrega_id: e1.datos.id } })).status === 404, 'anularla dos veces: 404');
  const otra = await entrega(tp1, { item_id: REF, receptor_usuario_id: t1.id, cliente_uuid: 'uuid-prueba-0003' });
  ok(otra.datos.resultado === 'reactivada' && (await entregasDe(REF)).length === 2, 'entregar de nuevo lo anulado lo reactiva (sin chocar con la clave única)', otra.datos);
  const eB = await entrega(tp2, { item_id: REF, receptor_usuario_id: t3.id });
  ok(eB.datos.resultado === 'entregado', '(el coordinador del puesto B entrega en el suyo)');
  ok((await pedir('POST', P('/anular'), { usuario: tp1, json: { entrega_id: eB.datos.id } })).status === 404, 'el coordinador de A no puede anular una entrega del puesto B: 404');
  const vista = (await pedir('GET', P('/mi-puesto'), { usuario: tp1 })).datos;
  ok(vista.testigos.find(t => t.usuario_id === t1.id).entregas[REF] && !vista.testigos.find(t => t.usuario_id === tp1.id).entregas[REF], 'la pantalla muestra quién ya recibió y quién no');

  // ============================================================== 6. la foto
  console.log('\n== La foto');
  const grande = await sharp({ create: { width: 3200, height: 2400, channels: 3, background: { r: 200, g: 80, b: 40 } } }).jpeg({ quality: 95 }).toBuffer();
  const antes = new Set(fs.readdirSync(UPLOAD_DIA_D_DIR));
  const conFoto = await entrega(tp1, { item_id: ALM, receptor_usuario_id: t1.id, cliente_uuid: 'uuid-foto-0001' }, { foto: grande });
  ok(conFoto.status === 200 && conFoto.datos.foto === true, 'entrega con foto: se guarda la foto', conFoto.datos);
  const nuevos = fs.readdirSync(UPLOAD_DIA_D_DIR).filter(f => !antes.has(f));
  ok(nuevos.length === 1 && /^logistica_\d+_[0-9a-f]+\.jpg$/.test(nuevos[0]), 'el archivo quedó en la carpeta protegida uploads/dia-d/ con nombre generado', nuevos);
  const meta = await sharp(path.join(UPLOAD_DIA_D_DIR, nuevos[0])).metadata();
  const pesa = fs.statSync(path.join(UPLOAD_DIA_D_DIR, nuevos[0])).size;
  ok(Math.max(meta.width, meta.height) <= 1280 && pesa < grande.length / 3, `la foto se redujo: ${meta.width}×${meta.height}, ${Math.round(pesa / 1024)} KB (la original ${Math.round(grande.length / 1024)} KB)`);
  const f1 = await pedir('GET', P(`/entregas/${conFoto.datos.id}/foto`), { usuario: tp1, binario: true });
  ok(f1.status === 200 && /image\/jpeg/.test(f1.tipo), 'el coordinador de ese puesto abre la foto');
  ok((await pedir('GET', P(`/entregas/${conFoto.datos.id}/foto`), { usuario: tp2, binario: true })).status === 404, 'el coordinador de OTRO puesto no la ve (404)');
  ok((await pedir('GET', P(`/entregas/${conFoto.datos.id}/foto`), { usuario: lider, binario: true })).status === 403, 'un líder recibe 403');
  ok((await pedir('GET', P(`/entregas/${conFoto.datos.id}/foto`), { usuario: admin, binario: true })).status === 200, 'la coordinación la abre');
  const repetida = await entrega(tp1, { item_id: ALM, receptor_usuario_id: t1.id, cliente_uuid: 'uuid-foto-0002' }, { foto: grande });
  ok(repetida.datos.ya_estaba && repetida.datos.foto === false && fs.readdirSync(UPLOAD_DIA_D_DIR).filter(f => !antes.has(f)).length === 1, 'un segundo toque con foto NO deja otro archivo');
  const basura = await entrega(tp1, { item_id: ALM, receptor_usuario_id: t2.id, cliente_uuid: 'uuid-foto-0003' }, { foto: Buffer.from('esto no es una imagen') });
  ok(basura.status === 200 && basura.datos.resultado === 'entregado' && basura.datos.foto === false && basura.datos.foto_recibida === true, 'un archivo que no es imagen: la entrega SÍ queda y la respuesta dice que la foto no se guardó', basura.datos);
  ok(fs.readdirSync(UPLOAD_DIA_D_DIR).filter(f => !antes.has(f)).length === 1, '…y no deja archivos sueltos');
  const sinFoto = await entrega(tp1, { item_id: ALM, receptor_usuario_id: tp1.id, cliente_uuid: 'uuid-foto-0004' });
  ok(sinFoto.status === 200 && sinFoto.datos.foto === false, 'la foto es opcional');
  ok((await pedir('GET', P(`/entregas/${sinFoto.datos.id}/foto`), { usuario: admin, binario: true })).status === 404, 'una entrega sin foto: 404 al pedirla');
  nuevos.forEach(f => { try { fs.unlinkSync(path.join(UPLOAD_DIA_D_DIR, f)); } catch (_) { /* ya no */ } });

  // ============================================================== 7. el contador, por dueño
  console.log('\n== El contador');
  const c = (await pedir('GET', P('/contador'), { usuario: admin })).datos;
  const cRef = c.items.find(i => i.item_id === REF), cKit = c.items.find(i => i.item_id === KIT), cAlm = c.items.find(i => i.item_id === ALM);
  ok(cRef.entregados === 3 && cRef.planeados === 5, 'refrigerio: 3 de 5 (t1, t2 y t3)', cRef);
  ok(cKit.entregados === 2 && cAlm.entregados === 3, 'kit: 2 · almuerzo: 3', [cKit, cAlm]);
  const cCond = c.items.find(i => i.item_id === CON);
  ok(cCond && cCond.entregados === null && cCond.planeados === 2, 'el ítem de conductores: 2 por comprar y sin entregados', cCond);
  ok((await pedir('GET', P('/contador'), { usuario: coord })).datos.items.find(i => i.item_id === REF).entregados === 3, 'el coordinador ve el mismo contador de la campaña');
  sublicencia = { usuario_id: lider.id, cargo: 'concejo' };
  const cAsp = await pedir('GET', P('/contador'), { usuario: lider, aspirante: true });
  ok(cAsp.status === 200 && cAsp.datos.items.length === 3 && cAsp.datos.items.every(i => i.entregados === 0 && i.planeados === 0), 'un aspirante ve SU campaña: ítems propios (sembrados al abrir) y en cero, no los de la madre', cAsp.datos);
  ok((await pedir('GET', P('/items'), { usuario: lider, aspirante: true })).datos.items.every(i => i.id !== REF), 'sus ítems no son los de la madre');
  sublicencia = null;

  // ============================================================== 8. la alerta
  console.log('\n== La alerta «sin entregar»');
  await pool.query('DELETE FROM logistica_entregas');
  await pool.query('DELETE FROM dia_d_alertas_atendidas');
  await llego(tp1, PA); await llego(t1, PA); await llego(t3, PB);          // t2 NO ha llegado
  const alertasDe = async (usuarioSesion = admin) => ((await pedir('GET', '/api/dia-d/alertas', { usuario: usuarioSesion })).datos || { alertas: [] }).alertas.filter(x => x.tipo === 'logistica_sin_entregar');
  ponerHora('06:00');
  let al = await alertasDe();
  const kitA = al.find(x => x.puesto === 'PUESTO A' && x.mesa === KIT), kitB = al.find(x => x.puesto === 'PUESTO B' && x.mesa === KIT);
  ok(kitA && kitA.detalle === 'Puesto PUESTO A: 2 testigos sin kit de testigo a las 7 a. m.', 'a las 06:00 el kit de A ya está en la lista: 2 que llegaron y no lo tienen (el que no ha llegado no cuenta)', al.map(x => x.detalle));
  ok(kitA.estado === 'pendiente' && kitA.pendiente_hasta === '07:00', 'pero PENDIENTE hasta las 07:00 (antes de la hora)', [kitA.estado, kitA.pendiente_hasta]);
  ok(kitB && kitB.detalle === 'Puesto PUESTO B: 1 testigo sin kit de testigo a las 7 a. m.', 'B: «1 testigo» en singular', kitB && kitB.detalle);
  ok(al.every(x => x.estado === 'pendiente'), 'a las 06:00 todas son pendientes');
  ok(kitA.gravedad === 8 && kitA.nombre_tipo === 'Logística sin entregar', 'gravedad 8, nombre del tipo');
  ponerHora('08:00');
  al = await alertasDe();
  ok(al.find(x => x.mesa === KIT && x.puesto === 'PUESTO A').estado === 'activa', 'a las 08:00 el kit está ACTIVA');
  ok(al.find(x => x.mesa === REF && x.puesto === 'PUESTO A').estado === 'pendiente', '…y el refrigerio sigue pendiente hasta las 12:00');
  await entrega(tp1, { item_id: KIT, receptor_usuario_id: t1.id });
  al = await alertasDe();
  ok(al.find(x => x.mesa === KIT && x.puesto === 'PUESTO A').detalle === 'Puesto PUESTO A: 1 testigo sin kit de testigo a las 7 a. m.', 'al entregarle el kit a t1, A baja de 2 a 1');
  await entrega(tp1, { item_id: KIT, receptor_usuario_id: tp1.id });
  al = await alertasDe();
  ok(!al.some(x => x.mesa === KIT && x.puesto === 'PUESTO A'), 'cuando todos los que llegaron lo tienen, la alerta desaparece');
  ponerHora('13:00');
  al = await alertasDe();
  const refA = al.find(x => x.mesa === REF && x.puesto === 'PUESTO A');
  ok(refA && refA.estado === 'activa' && refA.detalle === 'Puesto PUESTO A: 2 testigos sin refrigerio a las 12 m.', 'a la 1 p. m.: «Puesto PUESTO A: 2 testigos sin refrigerio a las 12 m.»', refA && refA.detalle);
  ok(al.find(x => x.mesa === ALM).estado === 'pendiente' && al.find(x => x.mesa === ALM).detalle.endsWith('a las 2 p. m.'), 'el almuerzo (14:00) aún pendiente, dicho «a las 2 p. m.»');
  // Atender es por ítem
  const aten = await pedir('POST', '/api/dia-d/alertas/atendida', { usuario: admin, json: { tipo: 'logistica_sin_entregar', puesto_id: PA, mesa: REF, atendida: true } });
  al = await alertasDe();
  ok(aten.status === 200 && al.find(x => x.mesa === REF && x.puesto === 'PUESTO A').atendida && !al.find(x => x.mesa === ALM && x.puesto === 'PUESTO A').atendida, 'marcar «atendida» el refrigerio de A no marca el almuerzo de A');
  // Pasa por el filtro de un coordinador con su alcance
  const falso = { session: { usuario: admin }, sublicencia: null, alcance: { cargo: 'madre' } };
  const baseAl = await alertasLib.calcularAlertas(falso, { conContexto: true });
  const delCoord = await alertasLib.alertasParaUsuario(baseAl, { cargo: 'coordinador', usuarioId: coord.id });
  ok(delCoord.filter(x => x.tipo === 'logistica_sin_entregar').length === baseAl.alertas.filter(x => x.tipo === 'logistica_sin_entregar').length && baseAl.alertas.some(x => x.tipo === 'logistica_sin_entregar'),
    'alertasParaUsuario: un coordinador recibe las mismas alertas de logística que la campaña');
  ok(avisos.TIPOS_AVISADOS.has('logistica_sin_entregar') && avisos.textoDelAviso({ logistica_sin_entregar: 2 }) === '2 alertas nuevas: 2 puestos con logística sin entregar', 'el push la avisa y la frase sale bien', avisos.textoDelAviso({ logistica_sin_entregar: 2 }));
  // Fuera del día de la elección
  await pool.query("UPDATE configuracion_campana SET fecha_eleccion = '2026-11-09' WHERE id = 1");
  ok((await alertasDe()).length === 0, 'con la elección mañana: NO hay alertas de logística (ni pendientes)');
  await pool.query('UPDATE configuracion_campana SET fecha_eleccion = NULL WHERE id = 1');
  ok((await alertasDe()).length === 0, 'sin fecha de elección: tampoco');
  await pool.query('UPDATE configuracion_campana SET fecha_eleccion = ? WHERE id = 1', [FECHA]);
  // Ítem desactivado
  await pedir('PUT', P(`/items/${ALM}`), { usuario: admin, json: { activo: false } });
  ok(!(await alertasDe()).some(x => x.mesa === ALM), 'un ítem desactivado deja de alertar');
  await pedir('PUT', P(`/items/${ALM}`), { usuario: admin, json: { activo: true, hora_limite: null } });
  ok(!(await alertasDe()).some(x => x.mesa === ALM), 'un ítem sin hora límite no alerta');

  // ============================================================== 9. el Excel
  console.log('\n== Excel');
  await pedir('PUT', P(`/items/${ALM}`), { usuario: admin, json: { hora_limite: '14:00' } });
  await entrega(tp1, { item_id: REF, receptor_usuario_id: t1.id });
  const ex = await pedir('GET', P('/exportar-excel'), { usuario: admin, binario: true });
  const libro = XLSX.read(ex.buffer, { type: 'buffer' });
  ok(ex.status === 200 && libro.SheetNames.join() === 'Lista de compras,Por puesto,Testigos', 'el Excel trae 3 hojas: Lista de compras, Por puesto y Testigos', libro.SheetNames);
  const compras = XLSX.utils.sheet_to_json(libro.Sheets['Lista de compras']);
  ok(compras.find(f => f['Ítem'] === 'Refrigerio')['Total a comprar'] === 5 && compras.find(f => f['Ítem'] === 'Almuerzo de conductor')['Total a comprar'] === 2, 'lista de compras: refrigerio 5 y almuerzo de conductor 2', compras);
  const porPuesto = XLSX.utils.sheet_to_json(libro.Sheets['Por puesto']);
  ok(porPuesto.find(f => f.Puesto === 'PUESTO A').Refrigerio === 3 && porPuesto.some(f => /Transporte/.test(f.Puesto) && f['Almuerzo de conductor'] === 2), 'por puesto: A refrigerio 3 y la fila «Transporte (conductores)» con 2', porPuesto);
  const hojaTest = XLSX.utils.sheet_to_json(libro.Sheets['Testigos']);
  const texto = JSON.stringify(hojaTest);
  ok(hojaTest.length === 5 && hojaTest.some(f => f.Testigo === 'Testigo Uno A' && f.Refrigerio === 'Entregado'), 'testigos con su nombre y lo que ya recibieron', hojaTest.length);
  ok(!texto.includes('1053000992') && !texto.includes('1053000991') && texto.includes('***992'), 'la cédula va ENMASCARADA (***992), nunca completa');
  ok(hojaTest.some(f => f.Cargo === 'Coordinador de puesto'), 'distingue al coordinador de puesto');
  ok((await pedir('GET', P('/exportar-excel'), { usuario: coord, binario: true })).status === 200, 'el coordinador (con Importar/Exportar de fábrica) también exporta');

  // ============================================================== 10. la declaración del módulo y la interfaz
  console.log('\n== Declaración y pantallas');
  const asp = require('../middleware/aspirante');
  ok(asp.MODULOS_ASPIRANTE.includes('logistica_dia_d') && asp.PERMISOS_ASPIRANTE.logistica_dia_d && asp.PERMISOS_ASPIRANTE.logistica_dia_d.ver, 'aspirante: MODULOS_ASPIRANTE y PERMISOS_ASPIRANTE');
  ok(asp.HREFS_ASPIRANTE.includes('/dia-d.html#logistica'), 'aspirante: HREFS_ASPIRANTE');
  ok(/logistica_dia_d:\s*\['admin', 'coordinador'\]/.test(leer('db/init-db.js')), 'init-db: de fábrica admin y coordinador');
  ok(leer('routes/permisos.routes.js').includes("clave: 'logistica_dia_d'") && leer('config/importarExportar.js').includes('logistica_dia_d'), 'la matriz de permisos y el Importar/Exportar de fábrica');
  const nav = leer('public/js/common.js');
  // Orden menús 2: Transporte y Logística del Día D pasaron del grupo «Día D» al grupo «Logística» (el último de ese grupo).
  const bloque = nav.slice(nav.indexOf("grupo: 'Logística'"), nav.indexOf("grupo: 'Mensajería'"));
  const orden = [...bloque.matchAll(/texto: '([^']+)'/g)].map(m => m[1]);
  ok(orden[orden.length - 1] === 'Logística del Día D' && orden[orden.length - 2] === 'Transporte del Día D', 'submenú LOGÍSTICA: «Logística del Día D» va al final, después de «Transporte del Día D»', orden.slice(-3));
  const diad = leer('public/dia-d.html');
  const pestanas = [...diad.matchAll(/id="pestana-(\w+)"/g)].map(m => m[1]);
  ok(pestanas[pestanas.length - 1] === 'logistica' && pestanas[pestanas.length - 2] === 'transporte', 'pestañas de dia-d.html: Logística al final, después de Transporte', pestanas);
  ok(diad.includes('id="vista-logistica"') && diad.includes('id="fila-logistica"') && diad.includes("h === '#logistica'") && diad.includes('/js/logistica-dia-d.js'), 'la vista, el contador, el ancla y el script');
  const sw = leer('public/service-worker.js');
  ok(/estrategia-v(1(6[3-9]|[7-9]\d)|[2-9]\d\d)/.test(sw) && sw.includes("'/app/logistica.html'"), 'service worker v163 o posterior con la pantalla del celular en su precache');
  ok(/OFFLINE_DB_VERSION = (?:[5-9]|1[01])/.test(leer('public/js/offline-utils.js')) && leer('public/js/offline-utils.js').includes("'logistica_pendientes'"), 'la cola sin señal tiene su cajón nuevo (versión 5 o posterior)');
  ok(leer('public/app/inicio.html').split("href: '/app/logistica.html'").length === 3 && leer('public/app/dia-d.html').includes('id="enlace-logistica"'), 'tarjetas del celular (coordinador y administrador) y el acceso del coordinador de puesto');

  servidor.close();
  await pool.end();
  console.warn = warnOriginal;
  console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})().catch(async (e) => { console.warn = warnOriginal; console.error('ERROR DE LA PRUEBA:', e); try { await pool.end(); } catch (_) { /* ya cerrado */ } process.exit(1); });
