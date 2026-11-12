#!/usr/bin/env node
// scripts/probar-eventos-alcance.js
//
// Prueba del CIERRE DE LA FUGA DE EVENTOS (parche 305): routes/eventos.routes.js solo pedía sesión, así que cualquier rol con cuenta listaba
// todos los eventos y leía nombre, teléfono y CÉDULA de todos los asistentes. Ahora:
//   · hace falta «Ver» en eventos, agenda o asistentes_reuniones (el consolidado, en asistentes_reuniones);
//   · cada ruta acota por alcance (administrador todo; coordinador su rama; líder, sublíder y demás, donde figuran o están invitados);
//   · un evento fuera del alcance responde 404, igual que uno que no existe;
//   · el teléfono y la cédula de los asistentes, solo para el administrador y el responsable del evento;
//   · escribir (editar, borrar, agregar o quitar asistentes) exige GESTIONAR el evento: estar invitado no basta.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada305 node scripts/probar-eventos-alcance.js
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
const express = require('express');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { alcanceEventos } = require('../lib/alcanceEventos');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }

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
app.use('/api/eventos', require('../routes/eventos.routes'));
let base = '';
async function pedir(metodo, ruta, { json, usuario, aspirante } = {}) {
  const h = { 'X-Forwarded-For': '198.51.100.9' };
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  if (aspirante) h['X-Test-Aspirante'] = String(aspirante);
  const r = await fetch(base + '/api/eventos' + ruta, { method: metodo, headers: h, body });
  const ct = r.headers.get('content-type') || '';
  if (/spreadsheetml/.test(ct)) return { status: r.status, buffer: Buffer.from(await r.arrayBuffer()) };
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
  return { status: r.status, datos, texto };
}

let n = 0;
async function usuario(nombre, rol, extra = {}) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo, telefono) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1, ?)`,
    [nombre, `9500000${n}`, `u9500000${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol, extra.telefono || null]);
  return { id: r.insertId, rol, nombre };
}
async function estructura(u, cargo, supervisor) {
  await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, ?, 1)', [u.id, cargo, supervisor ? supervisor.id : null]);
}
async function permiso(rol, modulo, ver) {
  await pool.query(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES (?, ?, ?, 1, 1) ON DUPLICATE KEY UPDATE permitido = VALUES(permitido)`, [rol, modulo, ver]);
}
async function evento(titulo, o = {}) {
  const [r] = await pool.query(
    `INSERT INTO eventos (titulo, tipo, fecha_inicio, lugar, responsable_id, coordinador_id, lider_id, created_by) VALUES (?, 'reunion', '2026-12-01 10:00:00', 'Salón de prueba', ?, ?, ?, ?)`,
    [titulo, o.responsable || null, o.coordinador || null, o.lider || null, o.creador || 1]);
  return r.insertId;
}
const ids = (r) => (r.datos && Array.isArray(r.datos) ? r.datos.map((e) => e.id).sort((a, b) => a - b) : null);
const orden = (...x) => x.sort((a, b) => a - b);

(async () => {
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  console.log('EVENTOS: PERMISO Y ALCANCE — base «' + nombreBase + '»\n');

  const admin = { id: 1, rol: 'admin', nombre: 'Admin Prueba' };
  const c1 = await usuario('Coordinadora Uno', 'coordinador'), c2 = await usuario('Coordinador Dos', 'coordinador');
  const l1 = await usuario('Lider Uno', 'lider'), l2 = await usuario('Lider Dos', 'lider'), l3 = await usuario('Lider Tres', 'lider');
  const s1 = await usuario('Sublider Uno', 'sublider');
  const testigo = await usuario('Testigo Prueba', 'testigo'), invitado = await usuario('Invitado Prueba', 'invitado');
  const asp = await usuario('Aspirante Prueba', 'lider');
  await estructura(c1, 'coordinador', null); await estructura(c2, 'coordinador', null);
  await estructura(l1, 'lider', c1); await estructura(l2, 'lider', c1); await estructura(l3, 'lider', c2);
  await estructura(s1, 'usuario', l1);
  await pool.query(`INSERT INTO sublicencias (usuario_id, cargo, nombre, activa) VALUES (?, 'concejo', 'Aspirante Prueba', 1)`, [asp.id]);

  // Los eventos.
  const ev = {};
  ev.l1 = await evento('Reunión del líder 1', { responsable: l1.id, creador: l1.id });
  ev.s1 = await evento('Reunión del sublíder', { responsable: s1.id, creador: s1.id });
  ev.l2 = await evento('Reunión del líder 2', { responsable: l2.id, creador: l2.id });
  ev.l3 = await evento('Reunión del líder 3 (otra coordinación)', { responsable: l3.id, creador: l3.id });
  ev.adm = await evento('Reunión del administrador', { responsable: 1, creador: 1 });
  ev.infoL1 = await evento('Evento donde el líder 1 es solo «líder» informativo', { responsable: 1, lider: l1.id, creador: 1 });
  ev.infoC1 = await evento('Evento con la coordinadora 1 como coordinadora informativa', { responsable: 1, coordinador: c1.id, creador: 1 });
  ev.sinNadie = await evento('Evento sin responsable', { creador: 1 });

  // Los asistentes: un votante con teléfono y cédula, un usuario y un invitado escrito a mano.
  const [vot] = await pool.query(`INSERT INTO votantes (nombre, cedula, telefono, lider_id, categoria) VALUES ('Votante Secreto', '1053111222', '3105550101', ?, 'votante')`, [l1.id]);
  const asistente = async (evId, o) => (await pool.query('INSERT INTO evento_asistentes (evento_id, votante_id, usuario_id, nombre_invitado) VALUES (?,?,?,?)', [evId, o.votante || null, o.usuario || null, o.invitado || null]))[0].insertId;
  const a1 = await asistente(ev.l1, { votante: vot.insertId });
  await asistente(ev.l1, { usuario: s1.id });
  await asistente(ev.l1, { invitado: 'Invitada a mano' });
  const aInvitadoTestigo = await asistente(ev.adm, { usuario: testigo.id });
  await asistente(ev.l3, { votante: vot.insertId });

  /* ============================================================================ 1. permiso del módulo */
  console.log('[1] El permiso del módulo, en el servidor');
  for (const rol of ['coordinador', 'lider', 'sublider', 'testigo', 'invitado']) for (const m of ['eventos', 'agenda', 'asistentes_reuniones']) await permiso(rol, m, 0);
  ok((await pedir('GET', '/')).status === 401, 'sin sesión: 401');
  for (const [u, nombre] of [[c1, 'coordinador'], [l1, 'líder'], [s1, 'sublíder'], [testigo, 'testigo'], [invitado, 'invitado']]) {
    const a = await pedir('GET', '/', { usuario: u }), b = await pedir('GET', `/${ev.l1}/asistentes`, { usuario: u }), c = await pedir('GET', '/asistentes-consolidado', { usuario: u });
    ok(a.status === 403 && b.status === 403 && c.status === 403, `${nombre} SIN «Ver» en ningún módulo de eventos: lista, asistentes y consolidado dan 403`, [a.status, b.status, c.status]);
  }
  ok((await pedir('GET', '/', { usuario: admin })).status === 200, 'el administrador pasa siempre');
  // Abrir por módulo: quien solo tiene «agenda» ve la lista pero no los asistentes; «asistentes_reuniones» abre asistentes y consolidado.
  await permiso('lider', 'agenda', 1);
  ok((await pedir('GET', '/', { usuario: l1 })).status === 200 && (await pedir('GET', `/${ev.l1}/asistentes`, { usuario: l1 })).status === 403 && (await pedir('GET', '/asistentes-consolidado', { usuario: l1 })).status === 403, 'solo con «agenda»: ve la lista, pero no los asistentes ni el consolidado');
  await permiso('lider', 'agenda', 0); await permiso('lider', 'eventos', 1);
  ok((await pedir('GET', `/${ev.l1}/asistentes`, { usuario: l1 })).status === 200 && (await pedir('GET', '/asistentes-consolidado', { usuario: l1 })).status === 403, 'con «eventos»: lista y asistentes; el consolidado es de «asistentes_reuniones»');
  await permiso('lider', 'eventos', 0); await permiso('lider', 'asistentes_reuniones', 1);
  ok((await pedir('GET', '/asistentes-consolidado', { usuario: l1 })).status === 200, 'con «asistentes_reuniones»: el consolidado');
  // Se abren los tres para el resto de las pruebas.
  for (const rol of ['coordinador', 'lider', 'sublider', 'testigo', 'invitado']) for (const m of ['eventos', 'agenda', 'asistentes_reuniones']) await permiso(rol, m, 1);
  ok((await pedir('GET', '/', { usuario: l1, aspirante: asp.id })).status === 403, 'el aspirante con sublicencia no llega (lista blanca)');

  /* ============================================================================ 2. alcance de la lista */
  console.log('\n[2] El alcance de la lista');
  const lista = async (u) => ids(await pedir('GET', '/', { usuario: u }));
  ok(JSON.stringify(await lista(admin)) === JSON.stringify(orden(...Object.values(ev))), 'ADMINISTRADOR: todos', await lista(admin));
  ok(JSON.stringify(await lista(l1)) === JSON.stringify(orden(ev.l1, ev.infoL1)), 'LÍDER 1: el suyo y donde figura como líder; NO el de su sublíder, ni los de otros', await lista(l1));
  ok(JSON.stringify(await lista(s1)) === JSON.stringify(orden(ev.s1, ev.l1)), 'SUBLÍDER: el suyo y al que está invitado (el del líder 1); nada más', await lista(s1));
  ok(JSON.stringify(await lista(l2)) === JSON.stringify(orden(ev.l2)), 'LÍDER 2: solo el suyo', await lista(l2));
  ok(JSON.stringify(await lista(c1)) === JSON.stringify(orden(ev.l1, ev.s1, ev.l2, ev.infoL1, ev.infoC1)), 'COORDINADORA 1: los de su rama (líderes y sublíderes) y donde figura; NO los de otra coordinación ni los del administrador', await lista(c1));
  ok(JSON.stringify(await lista(c2)) === JSON.stringify(orden(ev.l3)), 'COORDINADOR 2: solo los de su coordinación', await lista(c2));
  ok(JSON.stringify(await lista(testigo)) === JSON.stringify(orden(ev.adm)), 'TESTIGO: solo al que está invitado', await lista(testigo));
  ok(JSON.stringify(await lista(invitado)) === JSON.stringify([]), 'INVITADO sin invitaciones: nada', await lista(invitado));
  ok((await pedir('GET', `/?territorio_id=999`, { usuario: admin })).datos.length === 0, 'los filtros siguen funcionando junto al alcance');
  const a = alcanceEventos(null);
  ok(a.sql === '1 = 0' && alcanceEventos({ cargo: 'aspirante', usuarioId: 5 }).sql === '1 = 0', 'sin alcance, o aspirante: a nadie');

  /* ============================================================================ 3. detalle */
  console.log('\n[3] El detalle de un evento');
  const det = await pedir('GET', `/${ev.l1}`, { usuario: l1 });
  ok(det.status === 200 && det.datos.id === ev.l1 && det.datos.puede_ver_contactos === true && det.datos.responsable_nombre === 'Lider Uno', 'el responsable abre su evento', det.datos && det.datos.titulo);
  ok((await pedir('GET', `/${ev.l3}`, { usuario: l1 })).status === 404 && (await pedir('GET', '/99999999', { usuario: l1 })).status === 404, 'uno ajeno responde 404, IGUAL que uno que no existe');
  ok((await pedir('GET', `/${ev.l3}`, { usuario: l1 })).datos.error === (await pedir('GET', '/99999999', { usuario: l1 })).datos.error, 'con el mismo mensaje');
  ok((await pedir('GET', `/${ev.l1}`, { usuario: c1 })).status === 200 && (await pedir('GET', `/${ev.l1}`, { usuario: c1 })).datos.puede_ver_contactos === false, 'la coordinadora abre uno de su rama, pero sin contactos');
  ok((await pedir('GET', `/${ev.l1}`, { usuario: s1 })).status === 200, 'el invitado abre el evento al que lo invitaron');
  ok((await pedir('GET', '/abc', { usuario: admin })).status === 404, 'un id que no es número: 404');

  /* ============================================================================ 4. asistentes y contactos */
  console.log('\n[4] Los asistentes: teléfono y cédula solo para el administrador y el responsable');
  const vista = async (u, evId = ev.l1) => (await pedir('GET', `/${evId}/asistentes`, { usuario: u }));
  const comoAdmin = await vista(admin);
  const fVot = comoAdmin.datos.find((x) => x.id === a1);
  ok(comoAdmin.status === 200 && fVot.telefono_resuelto === '3105550101' && fVot.identidad_resuelta === '1053111222' && fVot.contactos_visibles === true, 'ADMINISTRADOR: ve teléfono y cédula', fVot);
  const comoL1 = await vista(l1);
  ok(comoL1.status === 200 && comoL1.datos.find((x) => x.id === a1).telefono_resuelto === '3105550101', 'el RESPONSABLE del evento (líder 1): los ve');
  for (const [u, nombre] of [[c1, 'la coordinadora (aunque sea de su rama)'], [s1, 'el sublíder invitado']]) {
    const r = await vista(u);
    const f = r.datos && r.datos.find((x) => x.id === a1);
    ok(r.status === 200 && f && f.nombre_resuelto === 'Votante Secreto' && f.telefono_resuelto === null && f.identidad_resuelta === null && f.contactos_visibles === false
      && !r.texto.includes('3105550101') && !r.texto.includes('1053111222'), `${nombre}: nombre y asistencia, pero NI teléfono NI cédula (ni en ninguna parte de la respuesta)`, f);
  }
  // «Líder» informativo: el evento ve, pero los contactos no.
  const info = await vista(l1, ev.infoL1);
  ok(info.status === 200 && info.datos.every((x) => x.telefono_resuelto === null), 'donde solo figura como «líder» informativo: no ve contactos');
  ok((await vista(l2)).status === 404 && (await vista(testigo, ev.l1)).status === 404 && (await vista(c2)).status === 404, 'un evento fuera de alcance: 404 (líder 2, testigo, coordinador 2)');
  ok((await vista(testigo, ev.adm)).status === 200, 'el testigo invitado ve la lista de ese evento');

  console.log('\n   El consolidado');
  const cons = async (u) => (await pedir('GET', '/asistentes-consolidado', { usuario: u }));
  const cAdmin = await cons(admin);
  const pAdmin = cAdmin.datos.find((x) => x.nombre === 'Votante Secreto');
  ok(pAdmin && pAdmin.telefono === '3105550101' && pAdmin.identidad === '1053111222' && pAdmin.total_reuniones === 2, 'ADMINISTRADOR: ve la persona con sus 2 reuniones y sus contactos', pAdmin);
  const cL1 = await cons(l1), pL1 = cL1.datos.find((x) => x.nombre === 'Votante Secreto');
  // Parche 327: el responsable que no es administrador ni coordinador ve el teléfono, pero la CÉDULA tapada (***222).
  ok(pL1 && pL1.total_reuniones === 1 && pL1.telefono === '3105550101' && pL1.identidad === '***222', 'LÍDER 1 (responsable de una de sus reuniones): solo la reunión suya, su teléfono y la cédula TAPADA', pL1);
  const cC1 = await cons(c1), pC1 = cC1.datos.find((x) => x.nombre === 'Votante Secreto');
  ok(pC1 && pC1.telefono === null && pC1.identidad === null && !cC1.texto.includes('3105550101') && !cC1.texto.includes('1053111222'), 'COORDINADORA: la ve en su rama, pero sin teléfono ni cédula', pC1);
  const cL2 = await cons(l2);
  ok(cL2.status === 200 && cL2.datos.length === 0, 'LÍDER 2: sin eventos con asistentes, consolidado vacío');
  const cC2 = await cons(c2), pC2 = cC2.datos.find((x) => x.nombre === 'Votante Secreto');
  ok(pC2 && pC2.total_reuniones === 1 && pC2.telefono === null, 'COORDINADOR 2: solo la reunión de su coordinación, sin contactos', pC2);
  await q("UPDATE permisos_rol SET importar_exportar = 1 WHERE modulo = 'asistentes_reuniones' AND rol IN ('coordinador','lider')");
  const x = await pedir('GET', '/asistentes-consolidado/exportar-excel', { usuario: c1 });
  const hoja = x.buffer ? XLSX.utils.sheet_to_json(XLSX.read(x.buffer, { type: 'buffer' }).Sheets['Consolidado asistentes'] || {}, { header: 1 }) : [];
  ok(x.status === 200 && !JSON.stringify(hoja).includes('3105550101') && !JSON.stringify(hoja).includes('1053111222'), 'el Excel del consolidado de la coordinadora tampoco lleva teléfono ni cédula', hoja.slice(0, 3));

  /* ============================================================================ 5. escribir */
  console.log('\n[5] Escribir: hace falta gestionar el evento');
  const put = (u, id) => pedir('PUT', `/${id}`, { usuario: u, json: { titulo: 'Cambiado', tipo: 'reunion', fecha_inicio: '2026-12-02 10:00:00' } });
  ok((await put(l2, ev.l1)).status === 404 && (await put(l1, ev.l3)).status === 404 && (await put(s1, ev.l1)).status === 403, 'editar uno ajeno: 404; el sublíder (invitado) no tiene rol para escribir: 403');
  await pool.query('INSERT INTO evento_asistentes (evento_id, usuario_id) VALUES (?, ?)', [ev.l3, l1.id]);
  ok((await put(l1, ev.l3)).status === 404, 'y estar invitado a un evento ajeno no basta para editarlo (404)');
  ok((await q('SELECT titulo FROM eventos WHERE id = ?', [ev.l1]))[0].titulo === 'Reunión del líder 1', 'y no cambió nada');
  ok((await put(l1, ev.l1)).status === 200 && (await put(c1, ev.s1)).status === 200 && (await put(admin, ev.l3)).status === 200, 'el responsable, la coordinadora (su rama) y el administrador sí editan');
  ok((await put(c2, ev.l1)).status === 404, 'el coordinador de otra coordinación no edita');
  ok((await pedir('DELETE', `/${ev.l3}`, { usuario: c1 })).status === 404 && (await pedir('DELETE', `/${ev.l2}`, { usuario: c1 })).status === 200, 'borrar: ajeno 404; de su rama, 200');
  ok((await pedir('POST', `/${ev.l1}/asistentes`, { usuario: l2, json: { nombre_invitado: 'Intruso' } })).status === 404 && (await pedir('POST', `/${ev.l1}/asistentes`, { usuario: s1, json: { nombre_invitado: 'Intruso' } })).status === 403, 'agregar asistentes a uno ajeno: 404; el sublíder no tiene rol para escribir: 403');
  ok((await pedir('POST', `/${ev.l1}/asistentes`, { usuario: l1, json: { nombre_invitado: 'Bienvenida' } })).status === 200, 'el responsable agrega');
  ok((await pedir('PUT', `/asistentes/${a1}`, { usuario: l2, json: { asistio: true } })).status === 404 && (await q('SELECT asistio FROM evento_asistentes WHERE id = ?', [a1]))[0].asistio === 0, 'marcar asistencia en un evento ajeno: 404 y no cambia');
  ok((await pedir('PUT', `/asistentes/${a1}`, { usuario: l1, json: { asistio: true, confirmado: true } })).status === 200 && (await q('SELECT asistio FROM evento_asistentes WHERE id = ?', [a1]))[0].asistio === 1, 'el responsable marca asistencia');
  ok((await pedir('DELETE', `/asistentes/${aInvitadoTestigo}`, { usuario: testigo })).status === 403, 'el testigo invitado no puede quitar asistentes (su rol no escribe)');
  ok((await pedir('DELETE', `/asistentes/${aInvitadoTestigo}`, { usuario: l2 })).status === 404 && (await pedir('DELETE', `/asistentes/99999999`, { usuario: admin })).status === 404, 'quitar uno ajeno o inexistente: 404');
  const creado = await pedir('POST', '/', { usuario: l1, json: { titulo: 'Nuevo del líder', fecha_inicio: '2026-12-05 09:00:00' } });
  ok(creado.status === 200 && (await lista(l1)).includes(creado.datos.id), 'lo que un líder crea queda en SU alcance (responsable = él)');

  servidor.close();
  console.log(fallos ? `\n${fallos} comprobación(es) FALLARON.` : '\nTODO BIEN');
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
