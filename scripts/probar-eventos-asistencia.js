#!/usr/bin/env node
// scripts/probar-eventos-asistencia.js
//
// Prueba de EVENTOS Y ASISTENCIA (parche 313), del lado del servidor y en un Chromium real:
//   · GET /api/eventos/movil: el alcance del líder, del sublíder y del coordinador; solo nombre y barrio (nunca teléfono ni cédula, ni siquiera al administrador);
//   · marcar «asistió»: líder, sublíder (solo en eventos donde es responsable o está invitado, y solo asistencia), permisos, 404 fuera de alcance;
//   · idempotencia: la misma marca dos veces no cuenta doble; una marca más vieja no pisa a una nueva; el PUT ya no borra la confirmación;
//   · agregar asistente por cédula (solo líder, coordinador y administrador; solo gente de su equipo; no revela quién existe fuera de su alcance);
//   · el escritorio (botones y contador) y el menú del celular según el permiso;
//   · el celular: «Mis eventos», el evento abierto, el buscador, la cola SIN SEÑAL por usuario, la copia de 48 horas.
//
// USO (sobre una base desechable ya inicializada con init-db; hace falta Chromium, ver scripts/capturas/navegador.js):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada313 node scripts/probar-eventos-asistencia.js
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
const pool = require('../config/db');
const { lanzar, espera } = require('./capturas/navegador');
const { crear } = require('./capturas/servidor');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }
const uuid = () => crypto.randomUUID();
const leer = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const mismo = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------------------------------------------------------------------------------ el servidor de la API */
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use((req, res, next) => {
  const u = req.headers['x-test-user'];
  req.session = { usuario: u ? JSON.parse(u) : undefined };
  req.sublicencia = null;
  next();
});
app.use('/api/eventos', require('../routes/eventos.routes'));
let base = '';
async function pedir(metodo, ruta, { json, usuario } = {}) {
  const h = { 'X-Forwarded-For': '198.51.100.9', 'User-Agent': 'prueba/1.0' };
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  const r = await fetch(base + '/api/eventos' + ruta, { method: metodo, headers: h, body });
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
  return { status: r.status, datos, texto };
}

const sello = String(Date.now()).slice(-7);
let n = 0, nv = 0;
async function usuario(nombre, rol, telefono) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo, telefono) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1, ?)`,
    [nombre, `88${sello}${n}`, `u88${sello}${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol, telefono || `31${sello}${n}`.slice(0, 10)]);
  return { id: r.insertId, rol, nombre };
}
async function estructura(u, cargo, supervisor) {
  await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, ?, 1)', [u.id, cargo, supervisor ? supervisor.id : null]);
}
async function territorio(tipo, nombre) {
  const [r] = await pool.query('INSERT INTO territorios (tipo, nombre) VALUES (?, ?)', [tipo, nombre]);
  return r.insertId;
}
const CEDULAS = {};
async function votante(nombre, lider, zona) {
  nv++;
  const cedula = `87${sello}${String(nv).padStart(3, '0')}`;
  const telefono = `32${sello}${nv}`.slice(0, 10);
  const [r] = await pool.query(
    `INSERT INTO votantes (nombre, cedula, telefono, email, direccion, territorio_id, lider_id, consentimiento_autorizado, categoria) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'votante')`,
    [nombre, cedula, telefono, `e${sello}${nv}@secreto.test`, `Calle ${nv} # 4-${nv}`, zona, lider.id]);
  CEDULAS[r.insertId] = { cedula, telefono };
  return { id: r.insertId, nombre, cedula, telefono };
}
async function evento(titulo, cuando, o = {}) {
  const [r] = await pool.query(
    `INSERT INTO eventos (titulo, tipo, fecha_inicio, lugar, meta_asistentes, responsable_id, coordinador_id, lider_id, created_by) VALUES (?, 'reunion', ${cuando}, ?, ?, ?, ?, ?, ?)`,
    [titulo, o.lugar || 'Salón comunal', o.meta || 0, o.responsable || null, o.coordinador || null, o.lider || null, o.creador]);
  return r.insertId;
}
async function asistente(eventoId, o) {
  const [r] = await pool.query('INSERT INTO evento_asistentes (evento_id, votante_id, usuario_id, nombre_invitado) VALUES (?, ?, ?, ?)', [eventoId, o.votante || null, o.usuario || null, o.invitado || null]);
  return r.insertId;
}
async function permiso(rol, modulo, ver) {
  await q(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES (?, ?, ?, 0, 0) ON DUPLICATE KEY UPDATE permitido = VALUES(permitido)`, [rol, modulo, ver]);
}
const fila = async (id) => (await q('SELECT asistio, confirmado, asistio_ms, asistio_por FROM evento_asistentes WHERE id = ?', [id]))[0];
const asistieron = async (ev) => Number((await q('SELECT COUNT(*) c FROM evento_asistentes WHERE evento_id = ? AND asistio = 1', [ev]))[0].c);

(async () => {
  let servidor, servidorWeb, navegador;
  try {
    servidor = http.createServer(app);
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${servidor.address().port}`;
    await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');

    const admin = await usuario('Admin Eventos', 'admin');
    const coord = await usuario('Coordinador Eventos', 'coordinador'); await estructura(coord, 'coordinador', null);
    const lid1 = await usuario('Líder Uno', 'lider'); await estructura(lid1, 'lider', coord);
    const lid2 = await usuario('Líder Dos', 'lider'); await estructura(lid2, 'lider', coord);
    const lid3 = await usuario('Líder Tres', 'lider'); await estructura(lid3, 'lider', null);
    const sub1 = await usuario('Sublíder Uno', 'sublider'); await estructura(sub1, 'usuario', lid1);
    const sub2 = await usuario('Sublíder Dos', 'sublider'); await estructura(sub2, 'usuario', lid1);
    const testigo = await usuario('Testigo Eventos', 'testigo');
    const barrio = await territorio('barrio', `Barrio Ev ${sello}`);

    const v1 = await votante('Ana Asistente', lid1, barrio), v2 = await votante('Beto Asistente', lid1, barrio), v3 = await votante('Carla Asistente', lid1, barrio);
    const v4 = await votante('Dora Nueva', lid1, barrio), v5 = await votante('Elena DeOtro', lid2, barrio), v6 = await votante('Gina Gamma', lid1, barrio);
    const HOY = 'CONCAT(CURDATE(), \' 15:00:00\')', MANANA = 'DATE_ADD(CONCAT(CURDATE(), \' 09:00:00\'), INTERVAL 1 DAY)', AYER = 'DATE_SUB(CONCAT(CURDATE(), \' 10:00:00\'), INTERVAL 1 DAY)', VIEJO = 'DATE_SUB(CONCAT(CURDATE(), \' 10:00:00\'), INTERVAL 20 DAY)';
    const E1 = await evento('Reunión de hoy', HOY, { meta: 20, responsable: lid1.id, creador: lid1.id });
    const E2 = await evento('Evento del otro líder', MANANA, { responsable: lid2.id, creador: lid2.id });
    const E3 = await evento('Reunión de ayer', AYER, { lider: lid1.id, creador: coord.id });
    const E4 = await evento('Reunión vieja', VIEJO, { responsable: lid1.id, creador: lid1.id });
    const E5 = await evento('Reunión de mañana (la responde el sublíder)', MANANA, { responsable: sub1.id, lider: lid1.id, creador: lid1.id, meta: 10 });
    const E6 = await evento('Reunión de hoy sin sublíderes', HOY, { responsable: lid1.id, creador: lid1.id });
    const E7 = await evento('Evento del otro líder, con Líder Uno invitado', MANANA, { responsable: lid2.id, creador: lid2.id });
    const A = {};
    A.ana = await asistente(E1, { votante: v1.id }); A.beto = await asistente(E1, { votante: v2.id }); A.carla = await asistente(E1, { votante: v3.id });
    A.subinv = await asistente(E1, { usuario: sub1.id }); A.invitado = await asistente(E1, { invitado: 'Fulano Escrito A Mano' });
    A.ayer = await asistente(E3, { votante: v1.id }); A.e5 = await asistente(E5, { votante: v2.id }); A.e6 = await asistente(E6, { votante: v3.id });
    A.otro = await asistente(E2, { votante: v5.id }); A.e7 = await asistente(E7, { usuario: lid1.id });
    console.log('EVENTOS Y ASISTENCIA (313) — base «' + nombreBase + '»');

    /* ===================================================================================== 1. el alcance de GET /movil */
    console.log('\n[1] GET /movil: el alcance de cada quien, y solo nombre y barrio');
    const m1 = await pedir('GET', '/movil', { usuario: lid1 });
    const ids1 = m1.datos.eventos.map((e) => e.id);
    ok(m1.status === 200 && mismo(ids1, [E3, E1, E6, E5, E7].sort((a, b) => ids1.indexOf(a) - ids1.indexOf(b))) && ids1.length === 5 && !ids1.includes(E2) && !ids1.includes(E4),
      'Líder Uno: sus eventos (ayer, hoy, mañana, el invitado); NO el del otro líder ni el de hace 20 días', ids1);
    const fechas = m1.datos.eventos.map((e) => e.fecha_inicio);
    ok(mismo(fechas, fechas.slice().sort()), 'ordenados por fecha, del más viejo al más nuevo', fechas);
    ok(mismo(Object.keys(m1.datos).sort(), ['config', 'eventos']) && m1.datos.config.horas_copia === 48, 'la respuesta trae eventos y la configuración (copia de 48 horas)');
    const e1 = m1.datos.eventos.find((e) => e.id === E1);
    ok(mismo(Object.keys(e1).sort(), ['asistentes', 'fecha_fin', 'fecha_inicio', 'id', 'lugar', 'meta_asistentes', 'puede_agregar', 'puede_marcar', 'tipo', 'titulo', 'total_asistio', 'total_invitados']), 'cada evento: claves exactas', Object.keys(e1));
    ok(e1.asistentes.length === 5 && e1.asistentes.every((a) => mismo(Object.keys(a).sort(), ['asistio', 'barrio', 'id', 'nombre'])), 'cada invitado: SOLO id, nombre, barrio y si asistió', e1.asistentes[0]);
    ok(e1.total_invitados === 5 && e1.meta_asistentes === 20 && e1.total_asistio === 0 && e1.asistentes.find((a) => a.id === A.ana).barrio === `Barrio Ev ${sello}`, 'con «5 invitados / 20» y el barrio de la ficha', { t: e1.total_invitados });
    const crudo = (r) => r.texto;
    const secretos = Object.values(CEDULAS).flatMap((c) => [c.cedula, c.telefono]).concat(['@secreto.test', 'Calle ']);
    ok(!secretos.some((s) => crudo(m1).includes(s)), 'ni cédula, ni teléfono, ni correo, ni dirección en la respuesta', secretos.filter((s) => crudo(m1).includes(s)));
    const mAdmin = await pedir('GET', '/movil', { usuario: admin });
    ok(mAdmin.status === 200 && mAdmin.datos.eventos.length >= 6 && !secretos.some((s) => crudo(mAdmin).includes(s)), 'tampoco al administrador (que sí ve contactos en el escritorio): la pantalla del celular no los necesita');
    ok(e1.puede_marcar === true && e1.puede_agregar === true, 'el líder marca y agrega en los eventos que gestiona');
    const e7 = m1.datos.eventos.find((e) => e.id === E7);
    ok(e7 && e7.puede_marcar === false && e7.puede_agregar === false, 'en el evento al que solo está invitado, solo mira', e7 && [e7.puede_marcar, e7.puede_agregar]);
    const ms1 = await pedir('GET', '/movil', { usuario: sub1 });
    const idsS = ms1.datos.eventos.map((e) => e.id).sort();
    ok(ms1.status === 200 && mismo(idsS, [E1, E5].sort()), 'Sublíder Uno: el evento donde está INVITADO (hoy) y el que RESPONDE (mañana); nada más, aunque su líder gestione otros', idsS);
    ok(ms1.datos.eventos.every((e) => e.puede_marcar === true && e.puede_agregar === false), 'puede marcar en los dos, y NO agregar asistentes');
    const ms2 = await pedir('GET', '/movil', { usuario: sub2 });
    ok(ms2.status === 200 && ms2.datos.eventos.length === 0, 'Sublíder Dos (ni invitado ni responsable de nada): ninguno');
    const mc = await pedir('GET', '/movil', { usuario: coord });
    ok(mc.status === 200 && [E1, E2, E3, E5, E6, E7].every((id) => mc.datos.eventos.some((e) => e.id === id)) && mc.datos.eventos.every((e) => e.puede_marcar === true) && !mc.datos.eventos.some((e) => e.id === E4), 'el coordinador: los de su rama (sin el de hace 20 días), y puede marcar en todos', mc.datos.eventos.map((e) => e.id));
    const ml3 = await pedir('GET', '/movil', { usuario: lid3 });
    ok(ml3.status === 200 && ml3.datos.eventos.length === 0, 'un líder de otra rama no ve nada de lo ajeno');
    const mt = await pedir('GET', '/movil', { usuario: testigo });
    ok(mt.status === 200 && mt.datos.eventos.every((e) => e.puede_marcar === false), 'un testigo puede mirar (si tiene «Ver») pero nunca marca');
    await permiso('lider', 'eventos', 0); await permiso('lider', 'agenda', 0); await permiso('lider', 'asistentes_reuniones', 0);
    ok((await pedir('GET', '/movil', { usuario: lid1 })).status === 403, 'sin «Ver» en los tres módulos de eventos, el servidor responde 403');
    await permiso('lider', 'agenda', 1);
    ok((await pedir('GET', '/movil', { usuario: lid1 })).status === 200, 'con «Ver» en cualquiera de los tres (aquí, agenda), pasa');
    await permiso('lider', 'eventos', 1); await permiso('lider', 'asistentes_reuniones', 1);

    /* ======================================================================================= 2. marcar «asistió» */
    console.log('\n[2] Marcar «asistió»: quién, dónde, y sin contar doble');
    const m = (id, usuarioQuien, cuerpo) => pedir('PUT', `/asistentes/${id}`, { usuario: usuarioQuien, json: cuerpo });
    const r1 = await m(A.ana, lid1, { asistio: true });
    ok(r1.status === 200 && r1.datos.asistio === true && r1.datos.total_asistio === 1 && r1.datos.total_invitados === 5, 'el líder marca «asistió»: el contador pasa a 1 de 5', r1.datos);
    const r2 = await m(A.ana, lid1, { asistio: true });
    ok(r2.status === 200 && r2.datos.total_asistio === 1 && (await asistieron(E1)) === 1, 'MARCA REPETIDA: sigue en 1 (no cuenta doble)', r2.datos);
    await q('UPDATE evento_asistentes SET confirmado = 1 WHERE id = ?', [A.ana]);
    const r3 = await m(A.ana, lid1, { asistio: false });
    const fa = await fila(A.ana);
    ok(r3.status === 200 && Number(fa.asistio) === 0 && Number(fa.confirmado) === 1, 'desmarcar NO borra la confirmación (antes el PUT escribía las dos columnas siempre)', fa);
    ok(Number(fa.asistio_por) === lid1.id && Number(fa.asistio_ms) > 0, 'queda quién marcó y cuándo');
    ok((await m(A.ana, lid1, {})).status === 400 && (await m(A.ana, lid1, { asistio: 'tal vez' })).status === 400, 'un cuerpo sin «asistio» válido: 400');
    ok((await m(A.ana, lid2, { asistio: true })).status === 404 && (await m(A.ana, lid3, { asistio: true })).status === 404, 'un líder que no gestiona ese evento: 404 (igual que si no existiera)');
    ok((await m(A.e7, lid1, { asistio: true })).status === 404, 'ni quien solo está INVITADO al evento puede marcar');
    ok((await m(A.ana, coord, { asistio: true })).status === 200, 'el coordinador marca en los eventos de su rama');
    ok((await m(A.ana, testigo, { asistio: true })).status === 403, 'un testigo no marca (403)');
    ok((await m(99999999, lid1, { asistio: true })).status === 404, 'una fila que no existe: 404');
    // el sublíder
    const s1 = await m(A.subinv, sub1, { asistio: true });
    ok(s1.status === 200 && s1.datos.asistio === true, 'Sublíder Uno marca en el evento donde está invitado');
    ok((await m(A.e5, sub1, { asistio: true })).status === 200, 'y en el que es responsable');
    ok((await m(A.ayer, sub1, { asistio: true })).status === 404, 'pero no en uno donde ni es responsable ni está invitado (aunque su líder lo gestione)');
    ok((await m(A.ana, sub2, { asistio: true })).status === 404, 'Sublíder Dos: 404');
    ok((await m(A.ana, sub1, { confirmado: true })).status === 403 && (await m(A.ana, sub1, { asistio: true, confirmado: true })).status === 403, 'el sublíder no confirma: solo marca asistencia (403)');
    ok((await pedir('POST', `/${E1}/asistentes`, { usuario: sub1, json: { votante_id: v4.id } })).status === 403, 'el sublíder no agrega asistentes por la ruta de siempre (403)');
    ok((await pedir('DELETE', `/asistentes/${A.ana}`, { usuario: sub1 })).status === 403, 'ni los quita (403)');
    ok((await pedir('PUT', `/${E1}`, { usuario: sub1, json: { titulo: 'Cambiado' } })).status === 403 && (await pedir('DELETE', `/${E1}`, { usuario: sub1 })).status === 403, 'ni edita ni borra el evento (403)');
    ok((await q(`SELECT COUNT(*) c FROM auditoria WHERE accion = 'evento_asistencia'`))[0].c >= 4, 'las marcas que cambian algo quedan en la auditoría');

    /* ============================================================ 3. la marca del celular: idempotente y en orden */
    console.log('\n[3] La marca del celular: la misma marca dos veces, y una vieja no pisa a una nueva');
    const t0 = Date.now() - 3600 * 1000;
    const post = (asist, quien, cuerpo) => pedir('POST', '/asistencias', { usuario: quien, json: { cliente_uuid: uuid(), asistente_id: asist, ...cuerpo } });
    const iso = (ms) => new Date(ms).toISOString();
    await q('UPDATE evento_asistentes SET asistio = 0, asistio_ms = NULL WHERE evento_id = ?', [E1]);
    const u = uuid();
    const p1 = await pedir('POST', '/asistencias', { usuario: lid1, json: { cliente_uuid: u, asistente_id: A.beto, asistio: 1, marcado_en: iso(t0) } });
    const p1b = await pedir('POST', '/asistencias', { usuario: lid1, json: { cliente_uuid: u, asistente_id: A.beto, asistio: 1, marcado_en: iso(t0) } });
    ok(p1.status === 200 && p1b.status === 200 && p1b.datos.total_asistio === 1 && (await asistieron(E1)) === 1, 'el mismo registro subido dos veces: un solo asistente contado', { a: p1.datos, b: p1b.datos });
    const p2 = await post(A.beto, lid1, { asistio: 0, marcado_en: iso(t0 - 600000) });
    ok(p2.status === 200 && p2.datos.ignorada === true && p2.datos.asistio === true && Number((await fila(A.beto)).asistio) === 1, 'una marca MÁS VIEJA que la guardada se ignora (lo marcado sin señal el martes no pisa lo del miércoles)', p2.datos);
    const p3 = await post(A.beto, lid1, { asistio: 0, marcado_en: iso(t0 + 60000) });
    ok(p3.status === 200 && p3.datos.ignorada === false && p3.datos.asistio === false && (await asistieron(E1)) === 0, 'una marca más nueva sí la cambia');
    ok(mismo(Object.keys(p3.datos).sort(), ['asistio', 'ignorada', 'ok', 'total_asistio', 'total_invitados']), 'la respuesta: solo el estado y los contadores');
    ok((await pedir('POST', '/asistencias', { usuario: lid1, json: { asistente_id: A.beto, asistio: 1, marcado_en: iso(t0) } })).status === 400, 'sin cliente_uuid: 400');
    ok((await post(A.beto, lid1, { asistio: 1 })).status === 400, 'sin la hora de la marca: 400');
    ok((await post(A.beto, lid1, { asistio: 1, marcado_en: iso(Date.now() + 3600 * 1000) })).status === 400, 'una hora en el futuro: 400');
    ok((await post(A.beto, lid1, { asistio: 1, marcado_en: iso(Date.now() - 8 * 86400 * 1000) })).status === 422, 'una marca de hace más de 7 días: 422');
    ok((await post(A.beto, lid1, { asistio: 'quizá', marcado_en: iso(t0) })).status === 400, 'un valor que no es sí/no: 400');
    ok((await post(A.otro, lid1, { asistio: 1, marcado_en: iso(t0) })).status === 404, 'un asistente de un evento ajeno: 404');
    ok((await post(A.e5, sub1, { asistio: 1, marcado_en: iso(t0) })).status === 200 && (await post(A.ayer, sub1, { asistio: 1, marcado_en: iso(t0) })).status === 404, 'el sublíder: sí donde responde, 404 donde no');
    ok((await post(A.ana, testigo, { asistio: 1, marcado_en: iso(t0) })).status === 403, 'un testigo: 403');
    const ordenado = [];
    for (const [asis, ms] of [[0, t0 + 300000], [1, t0 + 100000], [1, t0 + 400000], [0, t0 + 200000]]) { const r = await post(A.carla, lid1, { asistio: asis, marcado_en: iso(ms) }); ordenado.push(r.datos.asistio); }
    ok(Number((await fila(A.carla)).asistio) === 1, 'cuatro marcas que llegan DESORDENADAS: gana la de la hora más reciente', ordenado);

    /* ========================================================================== 4. agregar por cédula */
    console.log('\n[4] Agregar asistente por cédula');
    const ag = (ev, quien, cedula) => pedir('POST', `/${ev}/asistentes-por-cedula`, { usuario: quien, json: { cedula } });
    const a1 = await ag(E1, lid1, v4.cedula);
    ok(a1.status === 200 && a1.datos.duplicado === false && a1.datos.asistente.nombre === 'Dora Nueva' && mismo(Object.keys(a1.datos.asistente).sort(), ['asistio', 'barrio', 'id', 'nombre']), 'el líder agrega a una persona de su equipo por la cédula', a1.datos);
    ok(!secretos.some((s) => crudo(a1).includes(s)), 'y la respuesta no trae cédula ni teléfono');
    const a2 = await ag(E1, lid1, ` ${v4.cedula.slice(0, 3)}.${v4.cedula.slice(3)} `);
    ok(a2.status === 200 && a2.datos.duplicado === true && a2.datos.asistente.id === a1.datos.asistente.id && (await q('SELECT COUNT(*) c FROM evento_asistentes WHERE evento_id = ? AND votante_id = ?', [E1, v4.id]))[0].c === 1, 'la misma persona otra vez (aunque la cédula traiga puntos o espacios): la misma fila, sin duplicar');
    const ajena = await ag(E1, lid1, v5.cedula), noExiste = await ag(E1, lid1, '1000000001');
    ok(ajena.status === 404 && noExiste.status === 404 && ajena.datos.error === noExiste.datos.error, 'una cédula de alguien de OTRO líder responde exactamente lo mismo que una que no existe (no dice quién está fuera de tu equipo)', [ajena.datos, noExiste.datos]);
    ok((await ag(E1, lid1, '123')).status === 400, 'una cédula corta: 400');
    ok((await ag(E1, sub1, v4.cedula)).status === 403, 'el sublíder no agrega (403)');
    ok((await ag(E1, lid2, v5.cedula)).status === 404, 'quien no gestiona ese evento: 404');
    ok((await ag(E7, lid1, v4.cedula)).status === 404, 'ni quien solo está invitado');
    ok((await ag(E1, coord, v5.cedula)).status === 200, 'el coordinador agrega a gente de su rama (Elena es de Líder Dos, que cuelga de él)');
    ok((await ag(E1, admin, v5.cedula)).status === 200 && (await ag(E1, admin, v5.cedula)).datos.duplicado === true, 'y el administrador');

    /* ========================================================================== 5. el escritorio */
    console.log('\n[5] El escritorio: el botón y el contador');
    const d1 = await pedir('GET', `/${E1}/asistentes`, { usuario: lid1 });
    ok(d1.status === 200 && d1.datos.every((a) => a.puede_marcar === true) && d1.datos.every((a) => 'asistio' in a), 'GET /:id/asistentes trae puede_marcar y asistio (el botón se ofrece solo a quien puede)');
    ok(d1.datos.every((a) => a.contactos_visibles === true), 'el responsable (Líder Uno) sigue viendo los contactos en el escritorio');
    const d2 = await pedir('GET', `/${E1}/asistentes`, { usuario: coord });
    ok(d2.datos.every((a) => a.contactos_visibles === false && a.telefono_resuelto === null && a.identidad_resuelta === null), 'y el coordinador no (como antes)');
    const dsub = await pedir('GET', `/${E1}/asistentes`, { usuario: sub1 });
    ok(dsub.status === 403, 'el sublíder (de fábrica solo con «Ver» en agenda) no abre la lista del escritorio: su camino es el celular (GET /movil)');
    const d7 = await pedir('GET', `/${E7}/asistentes`, { usuario: lid1 });
    ok(d7.status === 200 && d7.datos.every((a) => a.puede_marcar === false), 'el líder invitado a un evento ajeno: ve la lista y NO el botón');
    const lista = await pedir('GET', '/', { usuario: lid1 });
    const f1 = lista.datos.find((e) => e.id === E1);
    ok(Number(f1.total_asistio) === (await asistieron(E1)) && Number(f1.total_invitados) === 7, 'GET / (la tabla de eventos) trae el contador «asistieron» al día', { a: f1.total_asistio, i: f1.total_invitados });
    const html = leer('public/asistentes-reuniones.html'), htmlEv = leer('public/eventos.html');
    ok(/celdaAsistencia/.test(html) && /method: 'PUT', body: \{ asistio: valor \}/.test(html) && /<th>Asistencia<\/th>/.test(html) && /asistieron \$\{/.test(html), 'estático: «Asistentes a reuniones» tiene la columna, los botones «Asistió» / «No asistió» y el contador');
    ok(/asistieron \$\{Number\(ev\.total_asistio\)/.test(htmlEv), 'estático: la tabla de «Eventos y GOTV» muestra «asistieron N»');

    /* ================================================================= 6. lo estático del celular */
    console.log('\n[6] Lo estático: versión de la base del celular, copias y service worker');
    const off = leer('public/js/offline-utils.js');
    ok(/OFFLINE_DB_VERSION = 11;/.test(off) && /'eventos_pendientes'/.test(off) && /'eventos_cache'/.test(off), 'OFFLINE_DB_VERSION = 11, con la cola eventos_pendientes y la copia eventos_cache');
    ok(/OFFLINE_STORES_COPIA = \[[^\]]*'eventos_cache'[^\]]*\]/.test(off) && /COPIAS_SIN_SENAL = \[[^\]]*'eventos_cache'[^\]]*\]/.test(leer('public/js/cuentas-dispositivo.js')), 'la copia se borra al cerrar sesión o cambiar de cuenta (las dos listas, que deben ser la misma)');
    const sw = leer('public/service-worker.js');
    ok(/estrategia-v\d+/.test(sw) && sw.includes("'/app/eventos.html'"), 'service worker con /app/eventos.html en la coraza');
    ok(!/\.telefono|\.cedula|\.identidad|telefono_resuelto|identidad_resuelta/.test(leer('public/app/eventos.html')), 'estático: la pantalla del celular no lee teléfono ni cédula de nada');

    /* ================================================================= 7. el celular, en Chromium */
    console.log('\n[7] El celular, en un Chromium real');
    await q('UPDATE evento_asistentes SET asistio = 0, asistio_ms = NULL WHERE evento_id IN (?)', [[E1, E3, E5, E6]]);
    const web = crear(pool);
    servidorWeb = http.createServer(web);
    await new Promise((r) => servidorWeb.listen(0, '127.0.0.1', r));
    const urlWeb = `http://127.0.0.1:${servidorWeb.address().port}`;
    navegador = await lanzar();
    const p = await navegador.pagina('about:blank');
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
    await p.cmd('Network.clearBrowserCookies');
    await p.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `
      try { window.__sinSenal = sessionStorage.getItem('sinSenal') === '1'; } catch (_) { window.__sinSenal = false; }
      window.__cuerpos = [];
      const f = window.fetch.bind(window);
      window.fetch = (...a) => { try { window.__cuerpos.push(String((a[1] && a[1].body) || '')); } catch (_) {} return window.__sinSenal ? Promise.reject(new TypeError('Failed to fetch')) : f(...a); };` });
    const sinSenal = (off2) => p.ev(`window.__sinSenal = ${off2 ? 'true' : 'false'}; sessionStorage.setItem('sinSenal', '${off2 ? 1 : 0}')`);
    const entrarComo = (id) => p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(id), url: urlWeb });
    const ir = async (ruta, ms = 2800) => { await p.cmd('Page.navigate', { url: urlWeb + ruta }); await espera(ms); };
    const clic = (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
    const texto = (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
    const idb = (store) => p.ev(`(async () => { const db = await abrirBaseOffline();
      return await new Promise((ok2, ko) => { const r = db.transaction(${JSON.stringify(store)}, 'readonly').objectStore(${JSON.stringify(store)}).getAll(); r.onsuccess = () => ok2(r.result); r.onerror = () => ko(r.error); }); })()`);
    const titulos = () => p.ev(`Array.from(document.querySelectorAll('#vista .caja-ev .titulo')).map((e) => e.textContent.trim())`);
    const grupos = () => p.ev(`Array.from(document.querySelectorAll('#vista .grupo-titulo')).map((e) => e.textContent.trim())`);
    const nombres = () => p.ev(`Array.from(document.querySelectorAll('#lista-asistentes .fila-asis .nombre')).map((e) => e.textContent.trim())`);

    // --- el menú
    await entrarComo(lid1.id);
    await ir('/app/inicio.html', 3500);
    const enlaceEventos = () => p.ev(`(() => { const a = Array.from(document.querySelectorAll('#menu-app a')).find((x) => x.getAttribute('href') === '/app/eventos.html'); return a ? a.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
    ok(/Eventos/.test(await enlaceEventos() || ''), 'el líder ve «Eventos» en el menú del celular');
    await permiso('lider', 'eventos', 0); await permiso('lider', 'asistentes_reuniones', 0);
    await ir('/app/inicio.html', 3500);
    ok(/Eventos/.test(await enlaceEventos() || ''), 'con «Ver» solo en agenda sigue viéndolo (basta con uno de los tres)');
    await permiso('lider', 'agenda', 0);
    await ir('/app/inicio.html', 3500);
    ok(!(await enlaceEventos()), 'sin «Ver» en eventos, agenda ni asistentes_reuniones, no aparece');
    await permiso('lider', 'eventos', 1); await permiso('lider', 'agenda', 1); await permiso('lider', 'asistentes_reuniones', 1);
    await entrarComo(sub1.id);
    await ir('/app/inicio.html', 3500);
    ok(/Eventos/.test(await enlaceEventos() || ''), 'el sublíder lo ve (de fábrica tiene «Ver» en agenda)');
    await permiso('sublider', 'agenda', 0);
    await ir('/app/inicio.html', 3500);
    ok(!(await enlaceEventos()), 'y si el administrador le quita agenda (no tiene eventos ni asistentes), desaparece');
    await permiso('sublider', 'agenda', 1);

    // --- mis eventos
    await entrarComo(lid1.id);
    await ir('/app/eventos.html', 3500);
    const g = await grupos(), t = await titulos();
    ok(g.some((x) => /^Hoy \(2\)/.test(x)) && g.some((x) => /^Próximos \(2\)/.test(x)) && g.some((x) => /^Anteriores, últimos 7 días \(1\)/.test(x)), 'la lista se agrupa en Hoy (2), Próximos (2: mañana y el invitado) y Anteriores de los últimos 7 días (1)', g);
    ok(!t.includes('Evento del otro líder') && !t.includes('Reunión vieja') && t.length === 5, 'sin el evento del otro líder ni el de hace 20 días', t);
    const tarjeta1 = await p.ev(`(() => { const c = Array.from(document.querySelectorAll('.caja-ev')).find((x) => /Reunión de hoy$/.test(x.querySelector('.titulo').textContent.trim())); return c ? c.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
    ok(/Salón comunal/.test(tarjeta1 || '') && /7 \/ 20 invitados/.test(tarjeta1 || '') && /asistieron 0/.test(tarjeta1 || ''), 'cada tarjeta: fecha, lugar y «N / meta invitados»', tarjeta1);

    // --- abrir un evento
    const abrir = async (titulo) => { await p.ev(`Array.from(document.querySelectorAll('.caja-ev')).find((x) => x.querySelector('.titulo').textContent.trim() === ${JSON.stringify(titulo)}).click()`); await espera(700); };
    await abrir('Reunión de hoy');
    let nom = await nombres();
    ok(nom.length === 7 && nom.includes('Ana Asistente') && nom.includes('Fulano Escrito A Mano'), 'al abrir un evento: sus 7 invitados por nombre', nom);
    const cuerpo = await p.ev(`document.getElementById('vista').innerText`);
    ok(!secretos.some((s) => cuerpo.includes(s)), 'en pantalla solo nombre y barrio: ni cédula, ni teléfono, ni correo, ni dirección');
    ok(/Barrio Ev/.test(await texto('.fila-asis .barrio') || ''), 'cada invitado muestra su barrio');
    const botones = await p.ev(`Array.from(document.querySelectorAll('.fila-asis .btn-asistio')).map((b) => b.textContent.trim())`);
    ok(botones.length === 7 && botones.every((b) => b === 'Asistió'), 'cada invitado tiene su botón grande «Asistió»', botones);
    const alto = await p.ev(`document.querySelector('.fila-asis .btn-asistio').getBoundingClientRect().height`);
    ok(alto >= 48, `el botón es grande (${Math.round(alto)} px de alto)`);
    // buscador
    await p.ev(`(() => { const i = document.getElementById('buscar'); i.value = 'carl'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await espera(500);
    nom = await nombres();
    ok(nom.length === 1 && nom[0] === 'Carla Asistente', 'el buscador por nombre filtra la lista (sin importar tildes ni mayúsculas)', nom);
    await p.ev(`(() => { const i = document.getElementById('buscar'); i.value = 'zzz'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await espera(500);
    ok(/Nadie coincide/.test(await texto('#lista-asistentes') || ''), 'sin coincidencias lo dice');
    await p.ev(`(() => { const i = document.getElementById('buscar'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await espera(400);
    // marcar con señal
    await clic(`[data-marcar="${A.ana}"]`);
    await espera(2200);
    ok(Number((await fila(A.ana)).asistio) === 1, 'tocar «Asistió» con señal lo guarda en el servidor');
    ok(/✔ Asistió/.test(await texto(`[data-asistente="${A.ana}"]`) || '') && /asistieron 1/.test(await texto('.cab-ev') || ''), 'la pantalla marca la persona y el contador sube a «asistieron 1»');
    ok((await idb('eventos_pendientes')).length === 0, 'y la cola quedó vacía');
    const copia = await idb('eventos_cache');
    ok(copia.length === 1 && String(copia[0].usuarioId) === String(lid1.id) && !secretos.some((s) => JSON.stringify(copia).includes(s)), 'la copia en el celular es de ESTE usuario y no lleva cédulas ni teléfonos', copia.map((c) => [c.usuarioId, c.clienteUuid]));
    // agregar por cédula (con señal)
    ok(!!(await p.ev(`!!document.getElementById('btn-agregar')`)), 'el líder ve «Agregar asistente por cédula»');
    await p.ev(`document.getElementById('ced').value = '${v6.cedula}'`);
    await p.ev(`document.getElementById('btn-agregar').click()`);
    await espera(2200);
    nom = await nombres();
    ok(nom.includes('Gina Gamma') && /Gina Gamma/.test(await texto('#aviso') || ''), 'agregar por cédula: aparece en la lista y avisa', { nom: nom.length, aviso: await texto('#aviso') });
    await p.ev(`document.getElementById('ced').value = '${v5.cedula}'`);
    await p.ev(`document.getElementById('btn-agregar').click()`);
    await espera(1800);
    ok(/No encontré a nadie con esa cédula en tu equipo/.test(await texto('#aviso') || ''), 'una cédula que no es de tu equipo: «No encontré a nadie…» (sin decir si existe)', await texto('#aviso'));

    // --- sin señal
    console.log('\n[8] Sin señal: la copia, la cola por usuario y la marca repetida');
    await sinSenal(true);
    await clic(`[data-marcar="${A.beto}"]`);
    await espera(1500);
    let cola = await idb('eventos_pendientes');
    ok(cola.length === 1 && String(cola[0].usuarioId) === String(lid1.id) && cola[0].asistenteId === A.beto && cola[0].payload.asistio === true, 'sin señal la marca queda en eventos_pendientes con su dueño', cola);
    ok(!/Beto|Ana|Asistente|Barrio/.test(JSON.stringify(cola)) && mismo(Object.keys(cola[0].payload).sort(), ['asistio', 'marcado_en']), 'y la cola NO lleva el nombre de nadie: solo el id, el valor y el instante', JSON.stringify(cola[0]));
    ok(/Esperando señal/.test(await texto(`[data-asistente="${A.beto}"]`) || '') && /asistieron 2/.test(await texto('.cab-ev') || ''), 'la pantalla lo dice y el contador ya cuenta la marca (2)');
    ok(Number((await fila(A.beto)).asistio) === 0, 'el servidor todavía no sabe nada');
    await clic(`[data-marcar="${A.beto}"]`); await espera(700);          // la desmarca
    await clic(`[data-marcar="${A.beto}"]`); await espera(700);          // y la vuelve a marcar
    cola = await idb('eventos_pendientes');
    ok(cola.length === 1 && cola[0].payload.asistio === true, 'tocar varias veces la misma persona sin señal deja UNA sola marca en la cola (la última)', cola.map((c) => c.payload));
    await clic(`[data-marcar="${A.carla}"]`); await espera(700);
    ok((await idb('eventos_pendientes')).length === 2, 'otra persona: otra marca');
    await p.ev('abierto = null; pintar();');                               // volver a la lista sin recargar
    await p.ev('refrescar()');
    await espera(1200);
    ok((await titulos()).length === 5 && /Sin señal/.test(await texto('#nota-copia') || ''), 'sin señal la lista de eventos sale de la copia guardada, y lo dice');
    ok(/asistieron 3/.test(await p.ev(`Array.from(document.querySelectorAll('.caja-ev')).find((x) => /Reunión de hoy$/.test(x.querySelector('.titulo').textContent.trim())).textContent`)), 'con los contadores al día (la copia más las marcas de la cola)');
    // el agregar necesita señal
    await abrir('Reunión de hoy');
    await p.ev(`document.getElementById('ced').value = '${v4.cedula}'`);
    await p.ev(`document.getElementById('btn-agregar').click()`);
    await espera(900);
    ok(/necesitas señal/.test(await texto('#aviso') || ''), 'agregar sin señal lo dice: necesitas señal');
    // vuelve la señal
    await sinSenal(false);
    await p.ev(`window.dispatchEvent(new Event('online'))`);
    await espera(3200);
    ok((await idb('eventos_pendientes')).length === 0 && Number((await fila(A.beto)).asistio) === 1 && Number((await fila(A.carla)).asistio) === 1, 'al volver la señal las dos marcas suben solas y la cola queda vacía');
    ok((await asistieron(E1)) === 3, 'el servidor cuenta 3 asistentes (Ana, Beto y Carla): ninguna marca de más');
    ok((await q(`SELECT COUNT(*) c FROM auditoria WHERE accion = 'evento_asistencia' AND usuario_id = ? AND detalle LIKE '%desde el celular%'`, [lid1.id]))[0].c >= 3, 'las marcas subidas por la cola quedan en la auditoría como hechas desde el celular');

    // --- la copia caduca y se borra al cambiar de cuenta
    await sinSenal(true);
    await p.ev(`(async () => { const c = await leerCopiaOffline('eventos_cache', 'mia'); c.guardadoEn = Date.now() - 47 * 3600 * 1000; await guardarEnColaOffline('eventos_cache', c); })()`);
    await p.ev('refrescar()'); await espera(1000);
    ok((await titulos()).length > 0 || /Reunión de hoy/.test(await texto('#vista') || ''), 'a las 47 horas, sin señal, todavía se ve la copia');
    await p.ev(`(async () => { const c = await leerCopiaOffline('eventos_cache', 'mia'); c.guardadoEn = Date.now() - 49 * 3600 * 1000; await guardarEnColaOffline('eventos_cache', c); })()`);
    await p.ev('refrescar()'); await espera(1000);
    ok(/caducaron/.test(await texto('#aviso') || '') && (await idb('eventos_cache')).length === 0, 'a las 49 horas la copia caduca: se borra y lo dice');
    await sinSenal(false);

    // --- el sublíder
    console.log('\n[9] El sublíder: solo marca asistencia');
    await ir('/app/eventos.html', 3500);                                 // con señal otra vez: vuelve a quedar la copia del líder
    ok((await idb('eventos_cache')).some((c) => String(c.usuarioId) === String(lid1.id)), 'antes de cambiar de cuenta, el celular tiene la copia del líder');
    await entrarComo(sub1.id);
    await ir('/app/eventos.html', 3500);
    const copiasDespues = await idb('eventos_cache');
    ok(copiasDespues.length === 1 && String(copiasDespues[0].usuarioId) === String(sub1.id), 'al entrar OTRA cuenta se BORRA la copia del anterior: queda solo la de esa cuenta', copiasDespues.map((c) => c.usuarioId));
    const ts = await titulos();
    ok(ts.length === 2 && ts.includes('Reunión de hoy') && ts.some((x) => /responde el sublíder/.test(x)), 've solo el evento donde está invitado y el que responde', ts);
    await abrir('Reunión de hoy');
    ok(!(await p.ev(`!!document.getElementById('btn-agregar')`)), 'sin «Agregar asistente»');
    ok(await p.ev(`document.querySelectorAll('.fila-asis .btn-asistio').length === 8`), 'pero con su botón «Asistió» en cada invitado');
    await clic(`[data-marcar="${A.subinv}"]`);
    await espera(2200);
    ok(Number((await fila(A.subinv)).asistio) === 1 && Number((await fila(A.subinv)).asistio_por) === sub1.id, 'el sublíder marca y queda registrado quién');
    // el servidor lo rechaza si la marca no es suya (por ejemplo, copia vieja): queda «fallido» con el motivo
    await p.ev(`(async () => { await guardarEnColaOffline('eventos_pendientes', { clienteUuid: generarUuid(), creadoEn: Date.now(), asistenteId: ${A.ayer}, eventoId: ${E3}, payload: { asistio: true, marcado_en: new Date().toISOString() } }); })()`);
    await p.ev('subirCola().then(() => refrescar())'); await espera(2500);
    const falla = await idb('eventos_pendientes');
    ok(falla.length === 1 && falla[0].estado === 'fallido' && /ya no está|no es de tu equipo/.test(falla[0].error || ''), 'una marca que el servidor rechaza (ya no es suya) queda «fallido» con el motivo, no se pierde en silencio', falla.map((f) => [f.estado, f.error]));
    ok(/No se pudo subir una marca/.test(await texto('#lista-pendientes') || ''), 'y la pantalla da Reintentar o Descartar');
    await clic('[data-descartar]'); await espera(900);
    ok((await idb('eventos_pendientes')).length === 0, 'descartar la borra');

    ok(!p.avisos.length, 'ninguna excepción de JavaScript en el celular', p.avisos);
  } catch (e) {
    fallos++;
    console.log('  FALLA la prueba se cayó:', e && (e.stack || e.message));
  } finally {
    try { if (navegador) navegador.cerrar(); } catch (_) { /* ya cerrado */ }
    try { if (servidorWeb) servidorWeb.close(); } catch (_) { /* ya cerrado */ }
    try { if (servidor) servidor.close(); } catch (_) { /* ya cerrado */ }
    await pool.end().catch(() => {});
  }
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO EN ORDEN');
  process.exit(fallos ? 1 : 0);
})();
