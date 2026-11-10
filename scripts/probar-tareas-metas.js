#!/usr/bin/env node
// scripts/probar-tareas-metas.js
//
// Prueba de las TAREAS, Fases 3 y 4 (parche 306), del lado del servidor:
//   · la «meta de registros»: avance con el alcance del RESPONSABLE (la misma cuenta del panel del líder), por fechas y por zona con sus
//     descendientes, sin las fichas por enlace sin confirmar; «hecha» sola al llegar a la meta, sin verificación obligatoria;
//   · la «reunión» enlazada a un evento: asistio contra meta_asistentes, respetando el alcance de eventos del parche 305;
//   · las tareas «por reasignar»: cuenta inactiva, cambio de supervisor y de rama; push a quien las asignó (una vez), bandeja con alcance,
//     y que NADA se reasigna solo;
//   · el panel de cumplimiento, el mapa y el Excel (sin nombres) con alcance;
//   · la conservación de las fotos de las tareas con el mismo plazo de las solicitudes, dentro de la vuelta diaria.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada306 node scripts/probar-tareas-metas.js
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

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const XLSX = require('xlsx');
const pool = require('../config/db');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }
const uuid = () => crypto.randomUUID();
const raiz = path.join(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use((req, res, next) => {
  const u = req.headers['x-test-user'];
  req.session = { usuario: u ? JSON.parse(u) : undefined };
  req.sublicencia = req.headers['x-test-aspirante'] ? { usuario_id: Number(req.headers['x-test-aspirante']), cargo: 'concejo' } : null;
  next();
});
const { restringirAspirante } = require('../middleware/aspirante');
app.use('/api', restringirAspirante);
app.use('/api/tareas', require('../routes/tareas.routes'));
app.use('/api/panel-lider', require('../routes/panelLider.routes'));
let base = '';
async function pedir(metodo, ruta, { json, usuario, form, aspirante, prefijo = '/api/tareas' } = {}) {
  const h = { 'X-Forwarded-For': '198.51.100.9', 'User-Agent': 'prueba/1.0' };
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  if (aspirante) h['X-Test-Aspirante'] = String(aspirante);
  const r = await fetch(base + prefijo + ruta, { method: metodo, headers: h, body });
  const ct = r.headers.get('content-type') || '';
  if (/spreadsheetml/.test(ct)) return { status: r.status, buffer: Buffer.from(await r.arrayBuffer()), disposicion: r.headers.get('content-disposition') || '' };
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
  return { status: r.status, datos, texto };
}

let n = 0;
async function usuario(nombre, rol, extra = {}) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), ?)`,
    [nombre, `9800000${n}`, `u9800000${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol, extra.activo === 0 ? 0 : 1]);
  return { id: r.insertId, rol, nombre };
}
async function estructura(u, cargo, supervisor) {
  await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, ?, 1)', [u.id, cargo, supervisor ? supervisor.id : null]);
}
async function permisos(rol, modulo, ver, editar, agregar, exportar = 0) {
  await pool.query(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar, importar_exportar) VALUES (?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE permitido = VALUES(permitido), editar = VALUES(editar), agregar = VALUES(agregar), importar_exportar = VALUES(importar_exportar)`, [rol, modulo, ver, editar, agregar, exportar]);
}
const formDe = (campos, fotos = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== null) f.append(k, String(v));
  fotos.forEach((b, i) => f.append('fotos', new Blob([b], { type: 'image/jpeg' }), `foto${i}.jpg`));
  return f;
};
const foto = () => sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 40, g: 120, b: 80 } } }).jpeg().toBuffer();
const dentroDe = async (d) => (await q(`SELECT DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL ? DAY), '%Y-%m-%d') f`, [d]))[0].f;
const idsDe = (r) => (r.datos && r.datos.tareas ? r.datos.tareas.map((t) => t.id).sort((a, b) => a - b) : null);

let nv = 0;
async function votante(o) {
  nv++;
  const [r] = await pool.query(
    `INSERT INTO votantes (nombre, cedula, categoria, lider_id, sublider_id, territorio_id, origen, consentimiento_confirmado_en, created_at)
     VALUES (?, ?, 'votante', ?, ?, ?, ?, ?, ${o.hace ? 'DATE_SUB(NOW(), INTERVAL ? DAY)' : 'NOW()'})`,
    [`Votante ${nv}`, `10${String(nv).padStart(8, '0')}`, o.lider || null, o.sublider || null, o.zona || null, o.origen || 'manual', o.confirmado === false ? null : (o.origen === 'enlace_lider' ? new Date() : null), ...(o.hace ? [o.hace] : [])]);
  return r.insertId;
}

(async () => {
  // Activar complementos (parche 318): los complementos nacen APAGADOS; esta prueba enciende los que necesita.
  await require('./fixtures/encender-complementos')(pool, ['tareas']);
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
  console.log('TAREAS · FASES 3 Y 4 — base «' + nombreBase + '»\n');

  const T = require('../lib/tareas');
  const M = require('../lib/tareasMetas');
  const H = require('../lib/tareasHuerfanas');
  const Avisos = require('../lib/tareasAvisos');
  const Mant = require('../lib/solicitudesMantenimiento');
  const { zonaYDescendientes } = require('../lib/zonas');

  /* ====================================================================================== la gente y las zonas */
  const admin = { id: 1, rol: 'admin', nombre: 'Admin Prueba' };
  const c1 = await usuario('Coordinadora Uno', 'coordinador'), c2 = await usuario('Coordinador Dos', 'coordinador');
  const l1 = await usuario('Lider Uno', 'lider'), l2 = await usuario('Lider Dos', 'lider'), l3 = await usuario('Lider Tres', 'lider');
  const s1 = await usuario('Sublider Uno', 'sublider'), s2 = await usuario('Sublider Dos', 'sublider'), s3 = await usuario('Sublider Tres', 'sublider');
  const asp = await usuario('Aspirante Prueba', 'lider'), la = await usuario('Lider del Aspirante', 'lider');
  await estructura(c1, 'coordinador', null); await estructura(c2, 'coordinador', null);
  await estructura(l1, 'lider', c1); await estructura(l2, 'lider', c1); await estructura(l3, 'lider', c2);
  await estructura(s1, 'usuario', l1); await estructura(s2, 'usuario', l1); await estructura(s3, 'usuario', l2);
  await estructura(asp, 'lider', c1); await estructura(la, 'lider', asp);
  await pool.query(`INSERT INTO sublicencias (usuario_id, cargo, nombre, activa) VALUES (?, 'concejo', 'Aspirante Prueba', 1)`, [asp.id]);
  for (const rol of ['coordinador', 'lider', 'sublider']) await permisos(rol, 'tareas', 1, 1, 1);
  for (const rol of ['coordinador', 'lider', 'sublider']) for (const m of ['eventos', 'agenda', 'asistentes_reuniones']) await permisos(rol, m, 1, 1, 1);
  const Z = { M: 9100, C: 9101, B1: 9102, B2: 9103, V: 9104, Z: 9105 };
  await q(`INSERT INTO territorios (id, tipo, nombre, padre_id) VALUES (?, 'municipio', 'Municipio Ejemplo', NULL), (?, 'comuna', 'Comuna Centro', ?), (?, 'barrio', 'Barrio Uno', ?),
           (?, 'barrio', 'Barrio Dos', ?), (?, 'vereda', 'Vereda Alta', ?), (?, 'barrio', 'Barrio Aparte', NULL)`,
    [Z.M, Z.C, Z.M, Z.B1, Z.C, Z.B2, Z.C, Z.V, Z.M, Z.Z]);
  const hoy = await T.hoy();
  const crear = (u, o = {}) => pedir('POST', '/', { usuario: u, json: { tipo: 'libre', titulo: 'Tarea de prueba', asignada_a: s1.id, ...o } });
  const avisos = []; Avisos.deps.enviarPush = async (id, carga) => { avisos.push({ id, ...carga }); };

  /* ====================================================================================== 1. migración y zonas */
  console.log('[1] Migración y la función compartida de zonas');
  const cols = (await q(`SELECT column_name c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'tareas'`)).map((f) => f.c);
  ok(['meta_n', 'desde', 'evento_id', 'huerfana_desde', 'huerfana_motivo', 'fotos_borradas_en'].every((c) => cols.includes(c)), 'las columnas nuevas existen', cols);
  ok(/meta_registros/.test((await q(`SELECT column_type c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'tareas' AND column_name = 'tipo'`))[0].c) && T.TIPOS.meta_registros.medible === true && T.TIPOS.reunion.medible === false, 'el tipo admite meta_registros y reunion; la meta se mide sola y la reunión no cierra sola');
  ok(JSON.stringify((await zonaYDescendientes(Z.C)).sort()) === JSON.stringify([Z.C, Z.B1, Z.B2].sort()), 'una comuna trae sus barrios (y ella misma)', await zonaYDescendientes(Z.C));
  ok((await zonaYDescendientes(Z.M)).length === 5 && (await zonaYDescendientes(Z.B1)).join() === String(Z.B1) && (await zonaYDescendientes(99999)).length === 0 && (await zonaYDescendientes('x')).length === 0, 'el municipio trae todo lo suyo; un barrio, solo él; una zona que no existe, nada');

  /* ====================================================================================== 2. meta de registros: crear */
  console.log('\n[2] Meta de registros: crear');
  const meta = (o = {}) => ({ tipo: 'meta_registros', titulo: 'Meta de registros del mes', asignada_a: l1.id, meta_n: 15, fecha_limite: undefined, ...o });
  const fin = await dentroDe(5), inicio = await dentroDe(-10);
  const m0 = await crear(admin, meta({ fecha_limite: fin }));
  ok(m0.status === 201, 'una meta con su número y su fecha límite se crea', m0.datos);
  ok((await crear(admin, meta())).status === 400 && /fecha límite/.test((await crear(admin, meta())).datos.error), 'sin fecha límite: 400 (hasta qué día se cuenta)');
  ok((await crear(admin, meta({ fecha_limite: fin, meta_n: 0 }))).status === 400 && (await crear(admin, meta({ fecha_limite: fin, meta_n: 'x' }))).status === 400 && (await crear(admin, meta({ fecha_limite: fin, meta_n: null }))).status === 400, 'la meta tiene que ser un entero positivo');
  ok((await crear(admin, meta({ fecha_limite: fin, desde: await dentroDe(9) }))).status === 400, '«desde» posterior a la fecha límite: 400');
  const soloTexto = await crear(admin, meta({ fecha_limite: fin, zona_texto: 'Una zona escrita a mano' }));
  ok(soloTexto.status === 400 && /elígela de la lista/.test(soloTexto.datos.error), 'una zona solo escrita a mano no se puede medir: 400', soloTexto.datos);
  ok((await crear(admin, meta({ fecha_limite: fin, territorio_id: Z.C }))).status === 201 && (await crear(admin, meta({ fecha_limite: fin, territorio_id: 99999 }))).status === 400, 'con una zona del catálogo sí; con un id que no existe, no');
  const fila0 = (await q('SELECT desde, meta_n FROM tareas WHERE id = ?', [m0.datos.id]))[0];
  ok(fila0.desde === hoy && fila0.meta_n === 15, '«desde» por omisión es hoy', fila0);
  await q('DELETE FROM tareas');

  /* ====================================================================================== 3. meta de registros: avance */
  console.log('\n[3] Meta de registros: el avance, con el alcance del responsable');
  // l1: lo suyo (lider_id = l1). s1 registra con lider_id = l1 y sublider_id = s1 (como resolverAtribucion). l2: otro líder.
  for (let i = 0; i < 6; i++) await votante({ lider: l1.id, zona: Z.B1 });
  await votante({ lider: l1.id, zona: Z.B1, origen: 'enlace_lider', confirmado: true });          // por enlace, CONFIRMADA: cuenta
  await votante({ lider: l1.id, zona: Z.B1, origen: 'enlace_lider', confirmado: false });         // por enlace, SIN confirmar: no cuenta
  await votante({ lider: l1.id, zona: Z.B1, origen: 'enlace_lider', confirmado: false });
  for (let i = 0; i < 2; i++) await votante({ lider: l1.id, zona: Z.B2 });
  await votante({ lider: l1.id, zona: Z.V });
  await votante({ lider: l1.id });                                                                // sin territorio
  for (let i = 0; i < 3; i++) await votante({ lider: l1.id, zona: Z.B1, hace: 40 });              // de hace 40 días: antes de «desde»
  for (let i = 0; i < 4; i++) await votante({ lider: l1.id, sublider: s1.id, zona: Z.B2 });       // los de su sublíder
  for (let i = 0; i < 5; i++) await votante({ lider: l2.id, zona: Z.B1 });                        // de otro líder: no cuentan
  const medir = async (id) => M.avanceRegistros((await q('SELECT * FROM tareas WHERE id = ?', [id]))[0]);
  const mk = async (u, para, o) => { const r = await crear(u, { tipo: 'meta_registros', titulo: 'Meta', asignada_a: para.id, meta_n: 15, desde: inicio, fecha_limite: fin, ...o }); if (r.status !== 201) throw new Error('no se pudo crear: ' + r.texto); return r.datos.id; };
  const tL1 = await mk(admin, l1);
  const aL1 = await medir(tL1);
  ok(aL1.actual === 15 && aL1.meta === 15 && aL1.pct === 100, 'LÍDER 1 sin zona: 15 = 7 + 2 + 1 + 1 propios (la enlace sin confirmar y los de hace 40 días NO) + 4 de su sublíder', aL1);
  const tC = await mk(admin, l1, { territorio_id: Z.C }), tB1 = await mk(admin, l1, { territorio_id: Z.B1 }), tM = await mk(admin, l1, { territorio_id: Z.M }), tZ = await mk(admin, l1, { territorio_id: Z.Z });
  ok((await medir(tC)).actual === 13, 'por COMUNA cuenta sus barrios: Barrio Uno 7 + Barrio Dos 2 + 4 del sublíder = 13 (la vereda cuelga del municipio, no de la comuna; los sin zona tampoco)', (await medir(tC)).actual);
  ok((await medir(tB1)).actual === 7, 'por BARRIO: solo ese barrio (7)', (await medir(tB1)).actual);
  ok((await medir(tM)).actual === 14, 'por MUNICIPIO cuenta todo lo que cuelga (barrios y vereda), no los sin zona (14)', (await medir(tM)).actual);
  ok((await medir(tZ)).actual === 0, 'una zona sin registros: 0 (y nunca «todo»)');
  const tS1 = await mk(admin, s1);
  ok((await medir(tS1)).actual === 4, 'SUBLÍDER: cuenta lo que registró él (4), con SU alcance', (await medir(tS1)).actual);
  const tL2 = await mk(admin, l2);
  ok((await medir(tL2)).actual === 5, 'otro líder: solo lo suyo (5)');
  const tC1 = await mk(admin, c1);
  ok((await medir(tC1)).actual === 15 + 5, 'la COORDINADORA cuenta con el alcance de su rama: la suma de sus dos líderes (15 + 5)', (await medir(tC1)).actual);
  // La fecha: hasta es un día completo y lo posterior no cuenta.
  const ayer = await dentroDe(-1);
  await q('UPDATE tareas SET fecha_limite = ? WHERE id = ?', [ayer, tL1]);
  ok((await medir(tL1)).actual === 0, 'con la fecha límite en el pasado, los registros de hoy no cuentan (hasta es un día completo, no más)', (await medir(tL1)).actual);
  await q('UPDATE tareas SET fecha_limite = ?, desde = ? WHERE id = ?', [hoy, hoy, tL1]);
  ok((await medir(tL1)).actual === 15, 'con hasta = hoy sí cuenta el día de hoy completo');
  // Una cuenta inactiva no se mide.
  const inactivo = await usuario('Lider Inactivo', 'lider', { activo: 0 });
  await estructura(inactivo, 'lider', c1);
  const tIn = (await pool.query(`INSERT INTO tareas (tipo, titulo, estado, meta_n, desde, fecha_limite, creada_por, asignada_a) VALUES ('meta_registros', 'x', 'pendiente', 5, ?, ?, 1, ?)`, [inicio, fin, inactivo.id]))[0].insertId;
  ok((await medir(tIn)).actual === null, 'una cuenta inactiva no se mide (null)');

  console.log('\n   La cifra coincide con la del panel del líder');
  const panelDe = (u) => pedir('GET', '', { usuario: u, prefijo: '/api/panel-lider' });
  await q(`UPDATE votantes SET consentimiento_confirmado_en = NOW() WHERE origen = 'enlace_lider' AND consentimiento_confirmado_en IS NULL`);
  await q(`UPDATE tareas SET desde = '2000-01-01', fecha_limite = '2999-12-31' WHERE id = ?`, [tL1]);
  const pl = await panelDe(l1);
  ok(pl.status === 200 && (await medir(tL1)).actual === pl.datos.meta.inscritos, 'con todo confirmado y todo el tiempo, la meta cuenta EXACTAMENTE los «inscritos» del panel de l1', [(await medir(tL1)).actual, pl.datos.meta && pl.datos.meta.inscritos]);
  await q(`UPDATE votantes SET consentimiento_confirmado_en = NULL WHERE origen = 'enlace_lider' LIMIT 2`);
  const pl2 = await panelDe(l1);
  ok((await medir(tL1)).actual === pl2.datos.meta.inscritos - pl2.datos.meta.por_enlace_sin_confirmar && pl2.datos.meta.por_enlace_sin_confirmar === 2, 'y con 2 fichas por enlace sin confirmar, la meta cuenta lo del panel MENOS esas 2', [(await medir(tL1)).actual, pl2.datos.meta.inscritos, pl2.datos.meta.por_enlace_sin_confirmar]);
  const tS1b = await mk(admin, s1); await q(`UPDATE tareas SET desde = '2000-01-01', fecha_limite = '2999-12-31' WHERE id = ?`, [tS1b]);
  const plS = await panelDe(s1);
  ok((await medir(tS1b)).actual === plS.datos.meta.inscritos, 'lo mismo para el sublíder: su meta cuenta lo que dice su panel', [(await medir(tS1b)).actual, plS.datos.meta.inscritos]);
  await q(`UPDATE votantes SET consentimiento_confirmado_en = NOW() WHERE origen = 'enlace_lider'`);
  await q('DELETE FROM tareas');

  /* ====================================================================================== 4. «hecha» sola */
  console.log('\n[4] «Hecha» sola al llegar a la meta');
  // (Tras el punto anterior las dos fichas por enlace quedaron confirmadas: l1 cuenta 17.)
  const tMeta = await mk(admin, l1, { meta_n: 17, desde: inicio, fecha_limite: fin });
  const tFalta = await mk(admin, l1, { meta_n: 34, desde: inicio, fecha_limite: fin });
  const tLejos = await mk(admin, s1, { meta_n: 40, desde: inicio, fecha_limite: fin });
  ok(await M.cerrarMetasAlcanzadas({ tareaId: tFalta }) === 0 && (await q('SELECT estado FROM tareas WHERE id = ?', [tFalta]))[0].estado === 'pendiente', 'una meta que no se ha alcanzado sigue pendiente');
  const cerradas = await M.cerrarMetasAlcanzadas();
  const fm = (await q('SELECT estado, hecha_en, hecha_nota FROM tareas WHERE id = ?', [tMeta]))[0];
  ok(cerradas === 1 && fm.estado === 'hecha' && fm.hecha_en && /Llegó a la meta: 17 de 17/.test(fm.hecha_nota), 'al llegar a la meta pasa sola a «hecha» (solo esa)', fm);
  const hm = await q(`SELECT usuario_id, usuario_nombre, nota FROM tarea_historial WHERE tarea_id = ? AND tipo = 'hecha'`, [tMeta]);
  ok(hm.length === 1 && hm[0].usuario_id === null && hm[0].usuario_nombre === 'Automático', 'queda en el historial, sin usuario: la hizo el sistema', hm);
  ok(await M.cerrarMetasAlcanzadas() === 0 && (await q(`SELECT COUNT(*) n FROM tarea_historial WHERE tarea_id = ? AND tipo = 'hecha'`, [tMeta]))[0].n === 1, 'una segunda pasada no la vuelve a cerrar ni duplica el apunte');
  const lst = await pedir('GET', '/?limite=100', { usuario: admin });
  const fl = lst.datos.tareas.find((x) => x.id === tMeta);
  ok(fl.requiere_verificacion === false && fl.avance.actual === 17 && lst.datos.por_verificar === 0, 'la lista dice que no requiere verificación, trae el avance y no cuenta como «por verificar»', [fl.requiere_verificacion, lst.datos.por_verificar]);
  const acc = (u, id, accion, campos = {}, fotos = []) => pedir('POST', '/accion', { usuario: u, form: formDe({ tarea_id: id, accion, cliente_uuid: uuid(), ...campos }, fotos) });
  const intentoManual = await acc(l1, tFalta, 'termine');
  ok(intentoManual.status === 409 && /se cumple sola/.test(intentoManual.datos.error), 'el responsable no puede «terminarla» a mano: se cumple sola (409)', intentoManual.datos);
  ok((await acc(l1, tFalta, 'empece')).status === 201 && (await acc(l1, tFalta, 'no_pude', { nota: 'Falta tiempo' })).status === 201, 'pero sí puede decir que empezó o que no pudo');
  ok((await pedir('POST', `/${tMeta}/devolver`, { usuario: admin, json: { nota: 'falta algo' } })).status === 409, 'no se devuelve (ya cumplió la meta)');
  ok((await pedir('POST', `/${tMeta}/verificar`, { usuario: admin, json: {} })).status === 200, 'verificarla es opcional pero se puede (200)');
  const mias = await pedir('GET', '/mias', { usuario: l1 });
  const miaFalta = mias.datos.tareas.find((x) => x.id === tFalta);
  ok(miaFalta.avance && miaFalta.avance.actual === 17 && miaFalta.avance.meta === 34 && miaFalta.avance.pct === 50, '«Mis tareas» trae el avance (17 de 34)', miaFalta.avance);
  // Llegar a la meta mientras se mira «Mis tareas».
  await q('UPDATE tareas SET meta_n = 17 WHERE id = ?', [tFalta]);
  const mias2 = await pedir('GET', '/mias', { usuario: l1 });
  ok(mias2.datos.tareas.find((x) => x.id === tFalta).estado === 'hecha', 'si llega a la meta, «Mis tareas» ya la trae hecha (no espera al reloj)');
  const det = await pedir('GET', `/${tLejos}`, { usuario: admin });
  ok(det.datos.avance.actual === 4 && det.datos.avance.meta === 40 && det.datos.requiere_verificacion === false && det.datos.estado === 'pendiente', 'el detalle trae el avance (4 de 40)');
  // Registros nuevos suben la cuenta y cierran.
  await q('UPDATE tareas SET meta_n = 6 WHERE id = ?', [tLejos]);
  const reloj = require('../lib/tareasMantenimiento');
  for (let i = 0; i < 2; i++) await votante({ lider: s1.id, sublider: s1.id, zona: Z.B1 });
  const pas = await reloj.pasada();
  ok(pas && pas.metas === 1 && (await q('SELECT estado FROM tareas WHERE id = ?', [tLejos]))[0].estado === 'hecha', 'el reloj de 5 minutos cierra la meta cuando los registros nuevos la alcanzan', pas);
  ok(/tareasMantenimiento'\)\.iniciar\(\)/.test(leer('app.js')), 'app.js arranca el reloj');
  await q('DELETE FROM tareas');

  /* ====================================================================================== 5. reunión */
  console.log('\n[5] Reunión enlazada a un evento');
  const evento = async (titulo, o = {}) => (await pool.query(
    `INSERT INTO eventos (titulo, tipo, fecha_inicio, lugar, responsable_id, meta_asistentes, created_by) VALUES (?, 'reunion', DATE_ADD(NOW(), INTERVAL 3 DAY), 'Salón', ?, ?, ?)`, [titulo, o.responsable || null, o.meta === undefined ? 10 : o.meta, o.responsable || 1]))[0].insertId;
  const e1 = await evento('Reunión del barrio', { responsable: l1.id }), e2 = await evento('Sin meta', { responsable: l1.id, meta: 0 }), e3 = await evento('De otra coordinación', { responsable: l3.id });
  for (let i = 0; i < 10; i++) await pool.query('INSERT INTO evento_asistentes (evento_id, nombre_invitado, asistio) VALUES (?, ?, ?)', [e1, `Invitado ${i}`, i < 4 ? 1 : 0]);
  const reunion = (u, o = {}) => crear(u, { tipo: 'reunion', titulo: 'Reunión con la junta', asignada_a: l1.id, evento_id: e1, ...o });
  const r1 = await reunion(c1);
  ok(r1.status === 201, 'la coordinadora crea una reunión sobre un evento de su rama', r1.datos);
  ok((await reunion(c1, { evento_id: null })).status === 400, 'sin evento: 400');
  const r3 = await reunion(c1, { evento_id: e3 });
  ok(r3.status === 400 && /no es de tu equipo/.test(r3.datos.error), 'un evento fuera de su alcance (otra coordinación): 400', r3.datos);
  const r2 = await reunion(c1, { evento_id: e2 });
  ok(r2.status === 400 && /meta de asistentes/.test(r2.datos.error), 'un evento sin meta de asistentes: 400 (no hay contra qué medir)', r2.datos);
  ok((await reunion(c1, { evento_id: 999999 })).status === 400, 'un evento que no existe: 400');
  const tR = r1.datos.id;
  const avL1 = (await pedir('GET', `/${tR}`, { usuario: l1 })).datos;
  ok(avL1.avance && avL1.avance.actual === 4 && avL1.avance.meta === 10 && avL1.avance.pct === 40 && avL1.avance.evento.titulo === 'Reunión del barrio', 'el avance es asistio contra meta_asistentes (4 de 10) para quien puede ver el evento', avL1.avance);
  ok(avL1.requiere_verificacion === true, 'la reunión SÍ se verifica: no se cumple sola');
  await pool.query('UPDATE evento_asistentes SET asistio = 1 WHERE evento_id = ?', [e1]);
  ok((await pedir('GET', `/${tR}`, { usuario: l1 })).datos.estado === 'pendiente' && (await pedir('GET', `/${tR}`, { usuario: l1 })).datos.avance.pct === 100, 'aunque asistan todos, no se cierra sola (la termina quien la tiene)');
  ok(!JSON.stringify((await pedir('GET', `/${tR}`, { usuario: l1 })).datos.avance).match(/Invitado \d|nombre|telefono|cedula/i), 'el avance solo trae cifras y el título del evento: ningún asistente');
  await pool.query('UPDATE evento_asistentes SET asistio = (id % 2) WHERE evento_id = ?', [e1]);
  // Un lector que no ve el evento: ve la tarea, no las cifras.
  const tRs1 = (await reunion(c1, { asignada_a: s1.id })).datos.id;
  const verS1 = (await pedir('GET', `/${tRs1}`, { usuario: s1 })).datos;
  ok(verS1.avance === null && verS1.id === tRs1, 'el sublíder asignado, que no puede ver ese evento, ve la tarea pero NO sus cifras (avance null)', verS1.avance);
  ok((await pedir('GET', `/${tR}`, { usuario: c1 })).datos.avance.actual >= 0, 'la coordinadora (su rama) ve el avance');
  const lista = await pedir('GET', '/?limite=100', { usuario: l1 });
  const listaS1 = await pedir('GET', '/?limite=100', { usuario: s1 });
  ok(lista.datos.tareas.find((x) => x.id === tR).avance.meta === 10 && lista.datos.tareas.find((x) => x.id === tRs1).avance.meta === 10 && listaS1.datos.tareas.find((x) => x.id === tRs1).avance === null, 'la lista respeta lo mismo, fila por fila: el líder (responsable del evento) ve las cifras en ambas; el sublíder, ninguna');
  const evs = await pedir('GET', '/eventos', { usuario: c1 });
  ok(evs.status === 200 && evs.datos.eventos.map((x) => x.id).join() === String(e1), 'GET /eventos ofrece solo los de su alcance con meta de asistentes (e1; no e2 ni e3)', evs.datos);
  await permisos('coordinador', 'eventos', 0, 0, 0); await permisos('coordinador', 'agenda', 0, 0, 0); await permisos('coordinador', 'asistentes_reuniones', 0, 0, 0);
  ok((await reunion(c1)).status === 403 && (await pedir('GET', '/eventos', { usuario: c1 })).datos.eventos.length === 0, 'sin «Ver» en los módulos de eventos no puede enlazar una reunión (403) ni ve la lista de eventos');
  for (const m of ['eventos', 'agenda', 'asistentes_reuniones']) await permisos('coordinador', m, 1, 1, 1);
  const term = await acc(l1, tR, 'termine');
  ok(term.status === 201 && (await q('SELECT estado FROM tareas WHERE id = ?', [tR]))[0].estado === 'hecha', 'la persona la termina sin evidencia obligatoria y queda hecha, por verificar');
  const lst2 = await pedir('GET', '/?limite=100', { usuario: c1 });
  ok(lst2.datos.por_verificar === 1, 'y cuenta como «por verificar»');
  await q('DELETE FROM tareas');

  /* ====================================================================================== 6. por reasignar */
  console.log('\n[6] Tareas por reasignar (nada se reasigna solo)');
  avisos.length = 0;
  const tHu = (await crear(l1, { asignada_a: s1.id, titulo: 'Título que no debe salir en el aviso' })).datos.id;
  const tHu2 = (await crear(l1, { asignada_a: s1.id, titulo: 'Otra del mismo líder' })).datos.id;
  const tOk = (await crear(l1, { asignada_a: s2.id })).datos.id;
  const tAdm = (await crear(admin, { asignada_a: s3.id })).datos.id;
  const tPropia = (await crear(l2, { asignada_a: l2.id })).datos.id;
  avisos.length = 0;
  let rv = await H.revisar();
  ok(rv.nuevas === 0 && avisos.length === 0, 'con todos activos y en su rama, no hay nada por reasignar');
  await q('UPDATE usuarios SET activo = 0 WHERE id = ?', [s1.id]);
  rv = await H.revisar();
  const hu = (await q('SELECT id, huerfana_desde, huerfana_motivo, asignada_a FROM tareas WHERE id IN (?, ?) ORDER BY id', [tHu, tHu2]));
  ok(rv.nuevas === 2 && hu.every((x) => x.huerfana_desde && x.huerfana_motivo === 'cuenta_inactiva' && x.asignada_a === s1.id), 'al desactivar la cuenta, sus 2 tareas abiertas quedan por reasignar (cuenta_inactiva) y el responsable NO cambia', hu);
  ok(avisos.length === 1 && avisos[0].id === l1.id && avisos[0].titulo === 'Tareas por reasignar' && /2 tareas/.test(avisos[0].cuerpo), 'a quien las asignó (l1) le llega UN push que dice cuántas son', avisos);
  ok(!/Título|Otra del mismo|Sublider/.test(JSON.stringify(avisos[0])) && avisos[0].url === '/tareas.html', 'sin títulos ni nombres, y abre la bandeja del escritorio');
  rv = await H.revisar();
  ok(rv.nuevas === 0 && avisos.length === 1, 'una segunda pasada no vuelve a avisar');
  ok((await q(`SELECT COUNT(*) n FROM tarea_historial WHERE tarea_id = ? AND tipo = 'huerfana'`, [tHu]))[0].n === 1, 'y deja un solo apunte en el historial');
  const bandeja = async (u) => ((await pedir('GET', '/por-reasignar', { usuario: u })).datos || {}).tareas;
  const idsB = async (u) => ((await bandeja(u)) || []).map((x) => x.id).sort((a, b) => a - b);
  ok(JSON.stringify(await idsB(l1)) === JSON.stringify([tHu, tHu2]), 'BANDEJA del líder que las asignó: sus 2', await idsB(l1));
  ok(JSON.stringify(await idsB(c1)) === JSON.stringify([tHu, tHu2]) && JSON.stringify(await idsB(admin)) === JSON.stringify([tHu, tHu2]), 'la coordinadora (su rama) y el administrador las ven igual');
  ok((await idsB(l2)).length === 0 && (await idsB(c2)).length === 0 && (await idsB(s2)).length === 0, 'otro líder, otra coordinación y un sublíder: nada');
  const bj = (await bandeja(l1))[0];
  ok(bj.por_reasignar_motivo === 'cuenta_inactiva' && /inactiva/.test(bj.motivo_texto) && bj.asignado === 'Sublider Uno', 'cada fila dice por qué quedó ahí', bj);
  const tFlag = (await pedir('GET', '/?limite=100&por_reasignar=1', { usuario: admin })).datos;
  ok(JSON.stringify(idsDe({ datos: tFlag })) === JSON.stringify([tHu, tHu2]) && tFlag.por_reasignar === 2, 'el filtro y el contador de la lista dicen lo mismo (2)');
  // Reactivar la cuenta la resuelve sola (el motivo desapareció).
  await q('UPDATE usuarios SET activo = 1 WHERE id = ?', [s1.id]);
  rv = await H.revisar();
  ok(rv.resueltas === 2 && (await idsB(l1)).length === 0 && (await q('SELECT huerfana_desde FROM tareas WHERE id = ?', [tHu]))[0].huerfana_desde === null, 'si la cuenta se reactiva, deja de estar por reasignar y queda escrito');
  // Cambio de supervisor: s2 pasa a depender de otro líder; las tareas que l1 le dio ya no son suyas de asignar.
  avisos.length = 0;
  await q('UPDATE estructura SET supervisor_id = ? WHERE usuario_id = ?', [l3.id, s2.id]);
  rv = await H.revisar();
  const hf = (await q('SELECT huerfana_motivo, asignada_a FROM tareas WHERE id = ?', [tOk]))[0];
  ok(rv.nuevas === 1 && hf.huerfana_motivo === 'fuera_de_rama' && hf.asignada_a === s2.id, 'al cambiar a s2 de supervisor, la tarea que l1 le dio queda por reasignar (fuera_de_rama) sin cambiar de responsable', hf);
  ok(avisos.length === 1 && avisos[0].id === l1.id && /1 tarea /.test(avisos[0].cuerpo), 'y a l1 le llega el aviso (1 tarea)');
  ok((await idsB(l3)).length === 0, 'el nuevo líder de s2 no la ve en su bandeja (no la asignó él)');
  ok(JSON.stringify(await idsB(c1)) === JSON.stringify([tOk]), 'la coordinadora de la rama donde la asignaron la ve', await idsB(c1));
  // Reasignar la saca de la bandeja.
  const re = await pedir('PUT', `/${tOk}`, { usuario: l1, json: { asignada_a: s1.id } });
  ok(re.status === 200 && (await q('SELECT asignada_a, huerfana_desde, estado FROM tareas WHERE id = ?', [tOk]))[0].huerfana_desde === null, 'reasignarla (una persona) la saca de la bandeja', re.datos);
  ok((await q('SELECT asignada_a FROM tareas WHERE id = ?', [tOk]))[0].asignada_a === s1.id, 'ahora es de s1');
  // Otra campaña.
  avisos.length = 0;
  await q('UPDATE estructura SET supervisor_id = ? WHERE usuario_id = ?', [asp.id, s3.id]);
  rv = await H.revisar();
  ok((await q('SELECT huerfana_motivo FROM tareas WHERE id = ?', [tAdm]))[0].huerfana_motivo === 'otra_campana', 'quien pasa a la rama de un aspirante deja la tarea del administrador por reasignar (otra_campana)');
  ok(avisos.some((a) => a.id === 1) , 'y al administrador, que la asignó, le llega el aviso', avisos.map((a) => a.id));
  // Tarea propia de una cuenta inactiva: el creador es el mismo; no hay a quién avisar.
  avisos.length = 0;
  await q('UPDATE usuarios SET activo = 0 WHERE id = ?', [l2.id]);
  rv = await H.revisar();
  ok((await q('SELECT huerfana_motivo FROM tareas WHERE id = ?', [tPropia]))[0].huerfana_motivo === 'cuenta_inactiva' && !avisos.some((a) => a.id === l2.id), 'una tarea que alguien se puso a sí mismo y quedó inactivo: por reasignar, sin avisarle a una cuenta inactiva');
  ok((await idsB(c1)).includes(tPropia), 'y la coordinadora la ve en su bandeja');
  await q('UPDATE usuarios SET activo = 1 WHERE id = ?', [l2.id]);
  // Solo abiertas; las cerradas no.
  const tCer = (await crear(admin, { asignada_a: s2.id })).datos.id;
  await q(`UPDATE tareas SET estado = 'verificada' WHERE id = ?`, [tCer]);
  await q('UPDATE usuarios SET activo = 0 WHERE id = ?', [s2.id]);
  await H.revisar();
  ok((await q('SELECT huerfana_desde FROM tareas WHERE id = ?', [tCer]))[0].huerfana_desde === null, 'una tarea ya verificada no se marca (solo las abiertas y las hechas)');
  await q('UPDATE usuarios SET activo = 1 WHERE id = ?', [s2.id]);
  ok(/revisarEnSegundoPlano/.test(leer('routes/usuarios.routes.js')) && /tareasHuerfanas/.test(leer('lib/ramas.js')), 'se dispara al desactivar o editar una cuenta (usuarios) y al cambiar de supervisor (ramas)');
  ok(!/UPDATE tareas SET asignada_a/.test(leer('lib/tareasHuerfanas.js')), 'y el código de la revisión NO contiene ninguna reasignación');
  await q('DELETE FROM tareas'); await q('UPDATE estructura SET supervisor_id = ? WHERE usuario_id = ?', [l1.id, s2.id]); await q('UPDATE estructura SET supervisor_id = ? WHERE usuario_id = ?', [l2.id, s3.id]);

  /* ====================================================================================== 7. panel, mapa y Excel */
  console.log('\n[7] Panel de cumplimiento, mapa y Excel');
  const mkT = async (u, para, o = {}) => (await crear(u, { asignada_a: para.id, ...o })).datos.id;
  const acc2 = (u, id, accion, campos = {}, fotos = []) => acc(u, id, accion, campos, fotos);
  await q(`UPDATE configuracion_campana SET fecha_eleccion = NULL WHERE id = 1`);
  const p1 = await mkT(admin, l1, { tipo: 'visita', titulo: 'Visita A', territorio_id: Z.B1 });
  const p2 = await mkT(admin, l1, { tipo: 'visita', titulo: 'Visita B', territorio_id: Z.B1 });
  const p3 = await mkT(admin, s1, { tipo: 'entrega', titulo: 'Entrega C', zona_texto: 'Barrio Uno' });
  const p4 = await mkT(admin, l3, { tipo: 'libre', titulo: 'Libre D' });
  const p5 = await mkT(admin, s3, { tipo: 'libre', titulo: 'Libre E' });
  const p6 = await mkT(l1, s2, { tipo: 'libre', titulo: 'Libre F' });
  await acc2(l1, p1, 'termine', { latitud: 5.0711, longitud: -75.5120 });
  await acc2(l1, p2, 'termine', { latitud: 5.0731, longitud: -75.5131 });
  await acc2(s1, p3, 'termine', { cantidad: 10 }, [await foto()]);
  await pedir('POST', `/${p2}/verificar`, { usuario: admin, json: {} });
  await q(`UPDATE tareas SET fecha_limite = DATE_SUB(CURDATE(), INTERVAL 1 DAY) WHERE id = ?`, [p6]);
  await pedir('POST', `/${p5}/cancelar`, { usuario: admin, json: { nota: 'ya no hace falta' } });
  const pn = async (u, qs = '') => pedir('GET', '/panel' + qs, { usuario: u });
  const pa = (await pn(admin)).datos;
  ok(pa.totales.total === 6 && pa.totales.hechas === 2 && pa.totales.verificadas === 1 && pa.totales.canceladas === 1 && pa.totales.abiertas === 2 && pa.totales.vencidas === 1, 'ADMINISTRADOR: 6 tareas, 2 hechas, 1 verificada, 1 cancelada, 2 abiertas, 1 vencida', pa.totales);
  ok(pa.totales.cumplimiento === 60, 'cumplimiento = (hechas + verificadas) / (todas menos las canceladas) = 3 de 5 = 60 %', pa.totales.cumplimiento);
  const zUno = pa.porZona.find((z) => z.nombre === 'Barrio Uno');
  ok(zUno && zUno.total === 3 && zUno.hechas + zUno.verificadas === 3 && zUno.cumplimiento === 100, 'por zona: «Barrio Uno» junta las del catálogo y la escrita igual (3), 100 %', pa.porZona.map((z) => [z.nombre, z.total]));
  ok(pa.porZona.some((z) => z.nombre === '(sin zona)'), 'las tareas sin zona se cuentan aparte');
  const pL1 = pa.porPersona.find((x) => x.nombre === 'Lider Uno');
  ok(pL1 && pL1.total === 2 && pL1.cumplimiento === 100 && pa.porPersona.length === 5, 'por persona: cada responsable con lo suyo', pa.porPersona.map((x) => [x.nombre, x.total]));
  ok(pa.porTipo.find((x) => x.tipo === 'visita').total === 2, 'y por tipo');
  const pc1 = (await pn(c1)).datos, pc2 = (await pn(c2)).datos, pl1 = (await pn(l1)).datos, ps1 = (await pn(s1)).datos;
  ok(pc1.totales.total === 5 && !pc1.porPersona.some((x) => x.nombre === 'Lider Tres'), 'COORDINADORA 1: las 5 de su rama; no la del líder de otra coordinación', pc1.totales.total);
  ok(pc2.totales.total === 1 && pc2.porPersona.length === 1 && pc2.porPersona[0].nombre === 'Lider Tres', 'COORDINADOR 2: solo la de su líder');
  ok(pl1.totales.total === 4 && ps1.totales.total === 1, 'LÍDER 1: las suyas, las de sus sublíderes y las que creó (4); SUBLÍDER: la suya (1)', [pl1.totales.total, ps1.totales.total]);
  for (const [u, nombre] of [[admin, 'admin'], [c1, 'coordinadora'], [l1, 'líder'], [s1, 'sublíder'], [c2, 'coordinador 2']]) {
    ok((await pn(u)).datos.totales.total === (await pedir('GET', '/?limite=100', { usuario: u })).datos.total, `el panel de ${nombre} cuenta lo MISMO que su lista`);
  }
  ok((await pn(admin, '?tipo=visita')).datos.totales.total === 2 && (await pn(admin, '?desde=2999-01-01')).datos.totales.total === 0, 'los filtros por tipo y por fecha acotan');
  ok((await pedir('GET', '/panel', { usuario: l1, aspirante: asp.id })).status === 403 && (await pedir('GET', '/panel')).status === 401, 'sin sesión 401; el aspirante con sublicencia no llega');

  console.log('\n   Mapa');
  const mp = async (u, qs = '') => (await pedir('GET', '/mapa' + qs, { usuario: u })).datos;
  const ma = await mp(admin);
  ok(ma.total === 6 && ma.con_ubicacion === 2 && ma.zonas.length === 1 && ma.zonas[0].n === 2, 'ADMINISTRADOR: 2 tareas con ubicación, en una sola zona de 0,005°', [ma.total, ma.con_ubicacion, ma.zonas]);
  ok(ma.zonas[0].lat === 5.0725 && ma.zonas[0].lng === -75.5125, 'va el CENTRO de la celda (5,0725 · -75,5125), no los puntos exactos');
  ok(Object.keys(ma.zonas[0]).sort().join() === 'lat,lng,n,tipos' && ma.zonas[0].tipos[0].etiqueta === 'Visita a un barrio o vereda', 'solo lat, lng, n y tipos');
  ok(!/Visita A|Visita B|Lider|Barrio|titulo|foto|tar_|5\.0711|5\.0731|-75\.5120|-75\.5131/.test(JSON.stringify(ma).replace('Visita a un barrio o vereda', '')), 'el mapa NO lleva nombres, títulos, zonas, fotos ni los puntos exactos');
  ok((await mp(l1)).con_ubicacion === 2 && (await mp(s1)).con_ubicacion === 0 && (await mp(c2)).zonas.length === 0, 'el alcance también acota el mapa (líder 1: 2; sublíder: 0; otra coordinación: nada)');

  console.log('\n   Excel');
  const x0 = await pedir('GET', '/exportar/cumplimiento', { usuario: l1 });
  ok(x0.status === 403, 'sin la casilla Importar / Exportar: 403');
  await permisos('coordinador', 'tareas', 1, 1, 1, 1); await permisos('lider', 'tareas', 1, 1, 1, 1);
  const xa = await pedir('GET', '/exportar/cumplimiento', { usuario: admin });
  ok(xa.status === 200 && /cumplimiento-tareas-\d{4}-\d{2}-\d{2}\.xlsx/.test(xa.disposicion), 'el administrador descarga el cumplimiento (.xlsx)', xa.status);
  const wb = XLSX.read(xa.buffer, { type: 'buffer' });
  const hoja = XLSX.utils.sheet_to_json(wb.Sheets['Cumplimiento'], { header: 1 });
  ok(wb.SheetNames.join() === 'Cumplimiento,Cómo leerlo' && hoja[0].join() === 'Zona,Tipo,Total,Abiertas,Hechas,Verificadas,Canceladas,Vencidas,Por reasignar,Cumplimiento (%)', 'dos hojas y la cabecera zona × tipo', hoja[0]);
  ok(hoja.slice(1).reduce((a, f) => a + Number(f[2]), 0) === 6, 'las filas suman las 6 tareas');
  const todo = JSON.stringify(wb.SheetNames.map((h) => XLSX.utils.sheet_to_json(wb.Sheets[h], { header: 1 })));
  ok(!/Lider|Sublider|Coordinador|Visita A|Entrega C|Libre|Admin Prueba|tar_/.test(todo), 'SIN nombres de personas, títulos ni fotos');
  const xl = await pedir('GET', '/exportar/cumplimiento', { usuario: l1 });
  const hojaL = XLSX.utils.sheet_to_json(XLSX.read(xl.buffer, { type: 'buffer' }).Sheets['Cumplimiento'], { header: 1 });
  ok(xl.status === 200 && hojaL.slice(1).reduce((a, f) => a + Number(f[2]), 0) === 4, 'con la casilla, el líder descarga solo lo de su alcance (4)');
  ok((await q(`SELECT detalle FROM auditoria WHERE accion = 'exportar_excel' AND entidad = 'tareas'`)).length === 2 && (await pedir('GET', '/exportar/cumplimiento', { usuario: l1, aspirante: asp.id })).status === 403, 'las dos descargas quedan en la auditoría; el aspirante, 403');
  await permisos('lider', 'tareas', 1, 1, 1, 0); await permisos('coordinador', 'tareas', 1, 1, 1, 0);
  const { moduloTieneImportarExportar } = require('../config/importarExportar');
  ok(moduloTieneImportarExportar('tareas'), '«tareas» tiene la casilla Importar / Exportar en la matriz');
  await q('DELETE FROM tareas');

  /* ====================================================================================== 8. conservación de fotos */
  console.log('\n[8] Conservación de las fotos de las tareas (mismo plazo y vuelta diaria que las solicitudes)');
  const f1 = await mkT(admin, s1, { tipo: 'entrega', titulo: 'Con fotos' }), f2 = await mkT(admin, s2, { tipo: 'visita', zona_texto: 'X', titulo: 'Con una foto' }), f3 = await mkT(admin, l1, { titulo: 'Sin fotos' });
  await acc(s1, f1, 'termine', { cantidad: 5, latitud: 5.07, longitud: -75.5 }, [await foto(), await foto()]);
  await acc(s2, f2, 'termine', {}, [await foto()]);
  await acc(l1, f3, 'termine');
  const archivos = (await q('SELECT archivo FROM tarea_fotos')).map((f) => f.archivo);
  const existen = () => archivos.every((a) => fs.existsSync(path.join(T.DIR_FOTOS, a)));
  ok(archivos.length === 3 && existen(), '3 fotos en 2 tareas');
  const vuelta = () => Mant.vueltaDiaria({ forzar: true });
  const intacta = async () => (await q('SELECT COUNT(*) n FROM tarea_fotos'))[0].n === 3 && existen();
  await q(`UPDATE configuracion_campana SET fecha_eleccion = NULL, anonimizar_solicitudes_meses = 6 WHERE id = 1`);
  let v = await vuelta();
  ok(v.tareas && !v.tareas.aplicado && await intacta(), 'SIN fecha de elección no se borra nada');
  await q(`UPDATE configuracion_campana SET fecha_eleccion = DATE_ADD(CURDATE(), INTERVAL 20 DAY) WHERE id = 1`);
  v = await vuelta(); ok(!v.tareas.aplicado && await intacta(), 'con la elección en el futuro, tampoco');
  await q(`UPDATE configuracion_campana SET fecha_eleccion = DATE_SUB(CURDATE(), INTERVAL 5 MONTH) WHERE id = 1`);
  v = await vuelta(); ok(!v.tareas.aplicado && await intacta(), 'a los 5 meses con plazo de 6, NO toca nada');
  await q(`UPDATE configuracion_campana SET fecha_eleccion = DATE_SUB(CURDATE(), INTERVAL 7 MONTH), anonimizar_solicitudes_meses = 12 WHERE id = 1`);
  v = await vuelta(); ok(!v.tareas.aplicado && await intacta(), 'a los 7 meses pero con el plazo CONFIGURADO en 12: se respeta el de la campaña (el mismo de las solicitudes)');
  const sim = await T.borrarFotosVencidas({ aplicar: false });
  await q(`UPDATE configuracion_campana SET anonimizar_solicitudes_meses = 6 WHERE id = 1`);
  const sim2 = await T.borrarFotosVencidas({ aplicar: false });
  ok(!sim.aplicado && sim2.tareas === 2 && sim2.fotos === 3 && await intacta(), 'vencido el plazo, la simulación cuenta (2 tareas, 3 fotos) y NO borra', sim2);
  v = await vuelta();
  ok(v.tareas.aplicado && v.tareas.fotos === 3 && v.tareas.tareas === 2, 'la vuelta diaria borra las 3 fotos de las 2 tareas', v.tareas);
  ok((await q('SELECT COUNT(*) n FROM tarea_fotos'))[0].n === 0 && archivos.every((a) => !fs.existsSync(path.join(T.DIR_FOTOS, a))), 'las filas y los ARCHIVOS');
  const conserva = (await q('SELECT estado, cantidad_entregada, latitud, fotos_borradas_en FROM tareas WHERE id = ?', [f1]))[0];
  ok(conserva.estado === 'hecha' && conserva.cantidad_entregada === 5 && conserva.fotos_borradas_en, 'la tarea se conserva (estado, cantidad) marcada con la fecha del borrado', conserva);
  ok((await q(`SELECT COUNT(*) n FROM tarea_historial WHERE tarea_id = ? AND tipo = 'fotos_borradas'`, [f1]))[0].n === 1 && (await q('SELECT fotos_borradas_en FROM tareas WHERE id = ?', [f3]))[0].fotos_borradas_en === null, 'queda un apunte en su historial; la que nunca tuvo fotos no se marca');
  const aud = await q(`SELECT usuario_id, detalle FROM auditoria WHERE accion = 'tarea_fotos_borrar_auto'`);
  ok(aud.length === 1 && aud[0].usuario_id === null && /3 foto\(s\) de 2 tarea\(s\)/.test(aud[0].detalle), 'y UN apunte en la auditoría, sin usuario', aud);
  v = await vuelta();
  ok(v.tareas.fotos === 0 && (await q(`SELECT COUNT(*) n FROM auditoria WHERE accion = 'tarea_fotos_borrar_auto'`))[0].n === 1, 'una segunda vuelta no encuentra nada y no escribe otro apunte');
  ok((await pedir('GET', `/${f1}`, { usuario: admin })).datos.fotos_borradas_en, 'el detalle dice que las fotos se borraron por el plazo');
  ok(v.resultado && typeof v.resultado.aplicado === 'boolean', 'y lo de las solicitudes sigue en la misma vuelta');
  await q(`UPDATE configuracion_campana SET fecha_eleccion = NULL WHERE id = 1`);

  /* ====================================================================================== 9. textos */
  console.log('\n[9] Los textos nuevos: nada de votos, elección ni cargos');
  const PROHIBIDO = /\b(alcald\w*|concej\w*|gobernaci\w*|gobernador\w*|asamble\w*|senad\w*|edil\w*|vot\w*|elecci\w*|electoral\w*|urnas?|tarjet\w*|cargos?)\b/i;
  const cuerpoGuia = (t2) => t2.replace(/^---[\s\S]*?---/, '');
  const sinMarcado = (html) => html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
  const cadenas = (js) => [...js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1').matchAll(/'([^'\n]{4,})'|"([^"\n]{4,})"|`([^`]{4,})`/g)].map((m) => m[1] || m[2] || m[3]);
  const guiones = (html) => [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const a of ['manuales/bloques/mod-tareas.md', 'manuales/bloques/t-tarea-asignar.md', 'manuales/bloques/t-tarea-reasignar.md', 'manuales/bloques/t-tarea-cumplimiento.md']) {
    ok(fs.existsSync(path.join(raiz, a)) && !PROHIBIDO.test(cuerpoGuia(leer(a))), `la guía ${path.basename(a)}`);
  }
  for (const a of ['public/tareas.html', 'public/app/mis-tareas.html']) {
    const t2 = leer(a);
    const mal = [sinMarcado(t2), ...guiones(t2).flatMap(cadenas)].filter((x) => PROHIBIDO.test(x.replace(/^\s*(select|insert|update|from|where)\b[\s\S]*$/i, '')));
    ok(mal.length === 0, `${a}: ningún texto visible menciona cargos, voto ni elección`, mal.slice(0, 3));
  }
  ok(!PROHIBIDO.test(Object.values(H.MOTIVOS).join(' ') + ' Tareas por reasignar Tienes tareas por reasignar'), 'los motivos y el aviso de «por reasignar»');

  servidor.close();
  try { for (const f of fs.readdirSync(T.DIR_FOTOS)) fs.unlinkSync(path.join(T.DIR_FOTOS, f)); } catch (_) { /* sin carpeta */ }
  console.log(fallos ? `\n${fallos} comprobación(es) FALLARON.` : '\nTODO BIEN');
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
