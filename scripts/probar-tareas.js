#!/usr/bin/env node
// scripts/probar-tareas.js
//
// Prueba de las TAREAS (parche 305), Fases 1 y 2, del lado del servidor:
//   · migración repetible: tablas, módulo apagado de fábrica, reglas de recordatorio apagadas, carpeta privada;
//   · permisos EXIGIDOS en el servidor (Ver, Agregar, Editar) y quién asigna a quién (administrador, coordinador, líder, sublíder);
//   · el ALCANCE de lectura y el de gestión (quién ve, quién verifica), con todos los roles;
//   · los tres tipos (libre, visita, entrega), la zona contra la vista `territorios` y su degradación cuando no hay barrios;
//   · estados, evidencia por tipo, «vencida» y «sin responsable activo» derivadas, historial, idempotencia de la cola sin señal;
//   · fotos (1.280 px, sin EXIF, carpeta privada, ruta con alcance) y una sola posición por «terminé»;
//   · push al asignar, verificar y devolver (solo tipo y zona, nunca el título), la tarjeta del panel del líder y los recordatorios del motor;
//   · los textos: nada de votos, elección ni cargos.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada305 node scripts/probar-tareas.js
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

/* ------------------------------------------------------------------------------------------------------ el servidor */
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
  if (/^image\//.test(ct)) return { status: r.status, tipo: ct, buffer: Buffer.from(await r.arrayBuffer()) };
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
  return { status: r.status, datos, texto };
}

let n = 0;
async function usuario(nombre, rol, extra = {}) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), ?)`,
    [nombre, `9600000${n}`, `u9600000${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol, extra.activo === 0 ? 0 : 1]);
  return { id: r.insertId, rol, nombre };
}
async function estructura(u, cargo, supervisor) {
  await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, ?, 1)', [u.id, cargo, supervisor ? supervisor.id : null]);
}
async function permisos(rol, ver, editar, agregar) {
  await pool.query(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES (?, 'tareas', ?, ?, ?)
                    ON DUPLICATE KEY UPDATE permitido = VALUES(permitido), editar = VALUES(editar), agregar = VALUES(agregar)`, [rol, ver, editar, agregar]);
}
const formDe = (campos, fotos = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== null) f.append(k, String(v));
  fotos.forEach((b, i) => f.append('fotos', new Blob([b], { type: 'image/jpeg' }), `foto${i}.jpg`));
  return f;
};
const idsDe = (r) => (r.datos && r.datos.tareas ? r.datos.tareas.map((t) => t.id).sort((a, b) => a - b) : null);
const orden = (...x) => x.sort((a, b) => a - b);
const grande = (con) => {
  let img = sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 40, g: 160, b: 80 } } }).jpeg({ quality: 90 });
  if (con) img = img.withExif({ IFD0: { Copyright: 'SECRETO-DEL-TELEFONO', Make: 'MarcaPrueba' } });
  return img.toBuffer();
};

(async () => {
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
  console.log('TAREAS · FASES 1 Y 2 — base «' + nombreBase + '»\n');

  const T = require('../lib/tareas');
  const Avisos = require('../lib/tareasAvisos');
  const R = require('../lib/recordatorios');
  const { carpetaPrivadaDe } = require('../lib/carpetasPrivadas');

  /* ====================================================================================== la gente */
  const admin = { id: 1, rol: 'admin', nombre: 'Admin Prueba' };
  const c1 = await usuario('Coordinadora Uno', 'coordinador'), c2 = await usuario('Coordinador Dos', 'coordinador');
  const l1 = await usuario('Lider Uno', 'lider'), l2 = await usuario('Lider Dos', 'lider'), l3 = await usuario('Lider Tres', 'lider');
  const s1 = await usuario('Sublider Uno', 'sublider'), s2 = await usuario('Sublider Dos', 'sublider'), s3 = await usuario('Sublider Tres', 'sublider');
  const testigo = await usuario('Testigo Prueba', 'testigo'), inactivo = await usuario('Lider Inactivo', 'lider', { activo: 0 });
  const asp = await usuario('Aspirante Prueba', 'lider'), la = await usuario('Lider del Aspirante', 'lider'), sa = await usuario('Sublider del Aspirante', 'sublider');
  await estructura(c1, 'coordinador', null); await estructura(c2, 'coordinador', null);
  await estructura(l1, 'lider', c1); await estructura(l2, 'lider', c1); await estructura(l3, 'lider', c2);
  await estructura(s1, 'usuario', l1); await estructura(s2, 'usuario', l1); await estructura(s3, 'usuario', l2);
  await estructura(asp, 'lider', c1); await estructura(la, 'lider', asp); await estructura(sa, 'usuario', la);
  await pool.query(`INSERT INTO sublicencias (usuario_id, cargo, nombre, activa) VALUES (?, 'concejo', 'Aspirante Prueba', 1)`, [asp.id]);

  /* ====================================================================================== 1. migración */
  console.log('[1] Migración: tablas, módulo apagado, reglas apagadas, carpeta privada');
  const tablas = (await q(`SELECT table_name t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'tarea%' ORDER BY 1`)).map((f) => f.t);
  ok(JSON.stringify(tablas) === JSON.stringify(['tarea_fotos', 'tarea_historial', 'tareas']), 'las tres tablas existen', tablas);
  const mod = await q(`SELECT rol, permitido FROM permisos_rol WHERE modulo = 'tareas'`);
  ok(mod.filter((m) => Number(m.permitido) === 1).map((m) => m.rol).join() === 'admin' && mod.length >= 8, 'el módulo «tareas» está en la matriz y de fábrica solo lo ve el administrador', mod);
  const reglas = await q(`SELECT nombre, canal, activo, desfase_min FROM recordatorio_reglas WHERE tipo = 'tarea_vence' ORDER BY desfase_min`);
  ok(reglas.length === 2 && reglas.every((r) => r.canal === 'push' && Number(r.activo) === 0) && reglas.map((r) => r.desfase_min).join() === '-4320,0', 'dos reglas de recordatorio de fábrica (3 días antes y el día que vence), por la app y APAGADAS', reglas);
  ok(carpetaPrivadaDe('/tareas/tar_1_aaaaaaaaaaaa.jpg') === 'tareas' && carpetaPrivadaDe('//Tareas/x.jpg') === 'tareas', 'uploads/tareas está en las carpetas privadas (también con rutas torcidas)');
  ok(/carpetaPrivadaDe\(req\.path\) === 'tareas'/.test(leer('app.js')), 'y app.js la cierra en /uploads');
  const { MODULOS } = require('../routes/permisos.routes');
  ok(MODULOS.some((m) => m.clave === 'tareas'), 'el catálogo de módulos de la matriz la trae');
  const est = await R.estado();
  ok(est.tipos.some((t) => t.clave === 'tarea_vence' && t.conFuente), 'el motor de recordatorios conoce el tipo y tiene su fuente');

  /* ====================================================================================== 2. permisos */
  console.log('\n[2] Permisos EXIGIDOS en el servidor');
  const nueva = (o = {}) => ({ tipo: 'libre', titulo: 'Pasar por la junta', descripcion: 'Llevar la lista.', asignada_a: s1.id, ...o });
  ok((await pedir('GET', '/')).status === 401, 'sin sesión: 401');
  ok((await pedir('GET', '/', { usuario: l1 })).status === 403 && (await pedir('GET', '/mias', { usuario: l1 })).status === 403 && (await pedir('POST', '/', { usuario: l1, json: nueva() })).status === 403, 'un líder, con el módulo apagado (de fábrica): 403');
  ok((await pedir('GET', '/', { usuario: admin })).status === 200, 'el administrador: 200');
  await permisos('lider', 1, 0, 0);
  ok((await pedir('GET', '/', { usuario: l1 })).status === 200, 'con «Ver», el líder ve la lista');
  const sinAgregar = await pedir('POST', '/', { usuario: l1, json: nueva() });
  ok(sinAgregar.status === 403 && /no crearlas/.test(sinAgregar.datos.error), 'con «Ver» pero sin «Agregar», no puede crear (403)');
  ok((await pedir('POST', '/1/verificar', { usuario: l1, json: {} })).status === 403, 'ni verificar sin «Editar» (403)');
  for (const rol of ['coordinador', 'lider', 'sublider']) await permisos(rol, 1, 1, 1);
  await permisos('testigo', 1, 0, 0);
  ok((await pedir('GET', '/', { usuario: l1, aspirante: asp.id })).status === 403, 'el aspirante con sublicencia no llega (lista blanca)');

  /* ====================================================================================== 3. quién asigna a quién */
  console.log('\n[3] Quién asigna a quién');
  const crear = (u, o = {}) => pedir('POST', '/', { usuario: u, json: nueva(o) });
  ok((await crear(admin, { asignada_a: c1.id })).status === 201 && (await crear(admin, { asignada_a: l3.id })).status === 201 && (await crear(admin, { asignada_a: s3.id })).status === 201, 'ADMINISTRADOR: a un coordinador, a un líder de otra coordinación y a un sublíder');
  ok((await crear(c1, { asignada_a: l1.id })).status === 201 && (await crear(c1, { asignada_a: s1.id })).status === 201 && (await crear(c1, { asignada_a: c1.id })).status === 201, 'COORDINADORA: a su líder, al sublíder de su líder y a sí misma');
  const aOtra = await crear(c1, { asignada_a: l3.id });
  ok(aOtra.status === 400 && /No puedes asignarle/.test(aOtra.datos.error) && (await crear(c1, { asignada_a: c2.id })).status === 400 && (await crear(c1, { asignada_a: admin.id })).status === 400, 'COORDINADORA: NO a un líder de otra coordinación, ni a otro coordinador, ni al administrador', aOtra.datos);
  ok((await crear(l1, { asignada_a: s1.id })).status === 201 && (await crear(l1, { asignada_a: s2.id })).status === 201 && (await crear(l1, { asignada_a: l1.id })).status === 201, 'LÍDER: a sus sublíderes y a sí mismo');
  ok((await crear(l1, { asignada_a: s3.id })).status === 400 && (await crear(l1, { asignada_a: l2.id })).status === 400 && (await crear(l1, { asignada_a: c1.id })).status === 400, 'LÍDER: NO al sublíder de otro líder, ni a otro líder, ni a su coordinadora');
  const deSub = await crear(s1, { asignada_a: s2.id });
  ok(deSub.status === 403 && /No puedes asignar/.test(deSub.datos.error), 'SUBLÍDER: no asigna a nadie (403), aunque tenga «Agregar»', deSub.datos);
  ok((await crear(admin, { asignada_a: inactivo.id })).status === 400 && (await crear(admin, { asignada_a: 99999999 })).status === 400 && (await crear(admin, { asignada_a: null })).status === 400, 'una cuenta inactiva, una que no existe o ninguna: 400');
  ok((await crear(admin, { asignada_a: testigo.id })).status === 400, 'un rol que no es de trabajo (testigo): 400');
  ok((await crear(admin, { asignada_a: la.id })).status === 400 && (await crear(admin, { asignada_a: sa.id })).status === 400, 'el administrador no asigna a la rama de un aspirante (otra campaña): 400');
  ok((await crear(la, { asignada_a: sa.id })).status === 201, 'pero dentro de la rama del aspirante sí (líder del aspirante → su sublíder)');
  const resp = async (u) => ((await pedir('GET', '/responsables', { usuario: u })).datos || {}).responsables;
  const ids = (l) => (l || []).map((x) => x.id).sort((a, b) => a - b);
  ok(JSON.stringify(ids(await resp(l1))) === JSON.stringify(orden(l1.id, s1.id, s2.id)), '«a quién» del líder: él y sus dos sublíderes', ids(await resp(l1)));
  ok(JSON.stringify(ids(await resp(c1))) === JSON.stringify(orden(c1.id, l1.id, l2.id, s1.id, s2.id, s3.id)), '«a quién» de la coordinadora: ella, sus líderes y los sublíderes de estos (no el aspirante ni su rama: son otra campaña)', ids(await resp(c1)));
  ok((await pedir('GET', '/responsables', { usuario: s1 })).datos.responsables.length === 0, '«a quién» del sublíder: nadie');
  await q('DELETE FROM tareas');

  /* ====================================================================================== 4. tipos y zona */
  console.log('\n[4] Tipos y zona');
  const mal = (o) => crear(admin, o);
  ok((await mal({ tipo: 'otra' })).status === 400 && (await mal({ titulo: 'ab' })).status === 400, 'tipo inexistente o título de menos de 3 letras: 400');
  ok((await mal({ fecha_limite: '2020-01-01' })).status === 400 && (await mal({ fecha_limite: '2026-02-31' })).status === 400 && (await mal({ fecha_limite: 'mañana' })).status === 400, 'fecha límite pasada o inválida: 400');
  const hoy = await T.hoy();
  const dentroDe = async (d) => (await q(`SELECT DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL ? DAY), '%Y-%m-%d') f`, [d]))[0].f;
  ok((await mal({ fecha_limite: hoy })).status === 201 && (await mal({ fecha_limite: await dentroDe(5) })).status === 201 && (await mal({ fecha_limite: '' })).status === 201, 'hoy, una fecha futura o ninguna: 201');
  const sinZona = await mal({ tipo: 'visita' });
  ok(sinZona.status === 400 && /barrio o la vereda/.test(sinZona.datos.error), 'una VISITA sin zona: 400', sinZona.datos);
  ok((await mal({ tipo: 'visita', zona_texto: 'Vereda La Esperanza' })).status === 201, 'una visita con la zona escrita a mano (campaña sin barrios en el catálogo): 201');
  ok((await mal({ tipo: 'entrega', cantidad_prevista: 0 })).status === 400 && (await mal({ tipo: 'entrega', cantidad_prevista: 'x' })).status === 400 && (await mal({ tipo: 'entrega', cantidad_prevista: 40 })).status === 201, 'entrega: cantidad prevista entera y positiva (o ninguna)');
  const zs = await pedir('GET', '/zonas?q=carmen', { usuario: admin });
  ok(zs.status === 200 && zs.datos.hay === false && zs.datos.zonas.length === 0, 'sin barrios ni veredas en el catálogo, /zonas dice hay:false (se escribe a mano)', zs.datos);
  await q(`INSERT INTO territorios (id, tipo, nombre, padre_id) VALUES (9001, 'comuna', 'Comuna Centro', NULL), (9002, 'barrio', 'El Carmen', 9001), (9003, 'vereda', 'La Cabaña', NULL), (9004, 'municipio', 'Municipio Ejemplo', NULL)`).catch(async () => {
    await q(`INSERT INTO territorios (id, tipo, nombre, padre_id) VALUES (9001, 'comuna', 'Comuna Centro', NULL), (9002, 'barrio', 'El Carmen', 9001), (9003, 'vereda', 'La Cabaña', NULL)`);
  });
  const zs2 = await pedir('GET', '/zonas?q=carmen', { usuario: admin });
  ok(zs2.datos.hay === true && zs2.datos.zonas.length === 1 && zs2.datos.zonas[0].nombre === 'El Carmen' && zs2.datos.zonas[0].padre === 'Comuna Centro', 'con catálogo: busca por nombre y dice de qué comuna es', zs2.datos);
  ok((await pedir('GET', '/zonas', { usuario: admin })).datos.zonas.every((z) => ['barrio', 'vereda', 'comuna', 'corregimiento'].includes(z.tipo)), 'solo ofrece barrios, veredas, comunas y corregimientos (no municipios)');
  const conId = await mal({ tipo: 'visita', territorio_id: 9002 });
  ok(conId.status === 201 && (await q('SELECT zona_texto z, territorio_id t FROM tareas WHERE id = ?', [conId.datos.id]))[0].z === 'El Carmen', 'con territorio_id válido guarda el id y completa el nombre', conId.datos);
  ok((await mal({ tipo: 'visita', territorio_id: 99999 })).status === 400 && (await mal({ tipo: 'visita', territorio_id: 9004 })).status === 400, 'un territorio_id que no está en el catálogo, o que es un municipio: 400');
  await q('DELETE FROM tareas');

  /* ====================================================================================== 5. alcance */
  console.log('\n[5] El alcance: quién ve qué');
  const mk = async (u, asignado, o = {}) => (await crear(u, { asignada_a: asignado.id, ...o })).datos.id;
  const t = {};
  t.adm_c1 = await mk(admin, c1); t.adm_l3 = await mk(admin, l3); t.adm_s3 = await mk(admin, s3);
  t.c1_l1 = await mk(c1, l1); t.c1_s1 = await mk(c1, s1); t.c1_c1 = await mk(c1, c1);
  t.l1_s1 = await mk(l1, s1); t.l1_s2 = await mk(l1, s2); t.l1_l1 = await mk(l1, l1);
  t.la_sa = await mk(la, sa);
  const lista = async (u, qs = '') => idsDe(await pedir('GET', '/?limite=100' + qs, { usuario: u }));
  ok(JSON.stringify(await lista(admin)) === JSON.stringify(orden(t.adm_c1, t.adm_l3, t.adm_s3, t.c1_l1, t.c1_s1, t.c1_c1, t.l1_s1, t.l1_s2, t.l1_l1)), 'ADMINISTRADOR: toda la campaña madre, sin la rama del aspirante', await lista(admin));
  ok(JSON.stringify(await lista(c1)) === JSON.stringify(orden(t.adm_c1, t.adm_s3, t.c1_l1, t.c1_s1, t.c1_c1, t.l1_s1, t.l1_s2, t.l1_l1)), 'COORDINADORA 1: las de su rama (creadas o ASIGNADAS a alguien de su rama, aunque las ponga el administrador); NO las de otra coordinación', await lista(c1));
  ok(JSON.stringify(await lista(l1)) === JSON.stringify(orden(t.c1_l1, t.c1_s1, t.l1_s1, t.l1_s2, t.l1_l1)), 'LÍDER 1: las suyas, las que tiene asignadas y las de SUS sublíderes (aunque las haya puesto la coordinadora)', await lista(l1));
  ok(JSON.stringify(await lista(s1)) === JSON.stringify(orden(t.c1_s1, t.l1_s1)), 'SUBLÍDER 1: solo las que tiene asignadas', await lista(s1));
  ok(JSON.stringify(await lista(s2)) === JSON.stringify(orden(t.l1_s2)), 'SUBLÍDER 2: la suya, y no las de su compañero', await lista(s2));
  ok(JSON.stringify(await lista(l2)) === JSON.stringify(orden(t.adm_s3)), 'LÍDER 2: la que le asignaron a SU sublíder (ninguna otra)', await lista(l2));
  ok(JSON.stringify(await lista(c2)) === JSON.stringify(orden(t.adm_l3)), 'COORDINADOR 2: la que le asignaron a su líder; nada de la coordinación 1', await lista(c2));
  ok(JSON.stringify(await lista(l3)) === JSON.stringify(orden(t.adm_l3)), 'LÍDER 3: la que le asignó el administrador', await lista(l3));
  ok(JSON.stringify(await lista(testigo)) === JSON.stringify([]), 'TESTIGO con el módulo abierto: nada');
  const rama = (await pedir('GET', '/?limite=100', { usuario: la })).datos;
  ok(rama.tareas.length === 1 && rama.tareas[0].id === t.la_sa, 'el líder del aspirante ve lo suyo (la rama no se mezcla con la madre)');
  const ajena = await pedir('GET', `/${t.adm_l3}`, { usuario: l1 }), inexistente = await pedir('GET', '/9999999', { usuario: l1 });
  ok(ajena.status === 404 && inexistente.status === 404 && ajena.datos.error === inexistente.datos.error, 'el detalle de una ajena responde LO MISMO que una que no existe (404)');
  ok((await pedir('GET', `/${t.la_sa}`, { usuario: admin })).status === 404, 'el administrador no abre la de una rama de aspirante');
  const vistaL1 = await lista(l1, '&asignada_a=' + s2.id);
  ok(JSON.stringify(vistaL1) === JSON.stringify(orden(t.l1_s2)), 'filtro por responsable');
  ok((await pedir('GET', '/?limite=100&tipo=visita', { usuario: admin })).datos.tareas.length === 0 && (await pedir('GET', '/?estado=pendiente&limite=100', { usuario: admin })).datos.total === 9, 'filtros por tipo y por estado');
  const mias = await pedir('GET', '/mias', { usuario: l1 });
  ok(idsDe(mias).join() === orden(t.c1_l1, t.l1_l1).join(), '«Mis tareas»: solo las asignadas a mí (no las de mis sublíderes)', idsDe(mias));

  /* ====================================================================================== 6. ejecutar */
  console.log('\n[6] Lo que hace el asignado: empecé, terminé, no pude');
  const acc = (u, id, accion, campos = {}, fotos = []) => pedir('POST', '/accion', { usuario: u, form: formDe({ tarea_id: id, accion, cliente_uuid: uuid(), ...campos }, fotos) });
  ok((await acc(s2, t.l1_s1, 'empece')).status === 404 && (await acc(l1, t.l1_s1, 'empece')).status === 404, 'solo el ASIGNADO ejecuta: otro (aunque sea el líder que la creó) recibe 404');
  ok((await acc(s1, t.l1_s1, 'bailar')).status === 400, 'una acción que no existe: 400');
  const u1 = uuid();
  const e1 = await pedir('POST', '/accion', { usuario: s1, form: formDe({ tarea_id: t.l1_s1, accion: 'empece', cliente_uuid: u1 }) });
  ok(e1.status === 201 && e1.datos.estado === 'en_curso', 'empecé: pendiente → en curso', e1.datos);
  const e1b = await pedir('POST', '/accion', { usuario: s1, form: formDe({ tarea_id: t.l1_s1, accion: 'empece', cliente_uuid: u1 }) });
  ok(e1b.status === 200 && e1b.datos.duplicado === true && (await q(`SELECT COUNT(*) n FROM tarea_historial WHERE tarea_id = ? AND tipo = 'empezada'`, [t.l1_s1]))[0].n === 1, 'el mismo envío dos veces (cola sin señal) no duplica: 200 y un solo apunte');
  ok((await acc(s1, t.l1_s1, 'empece')).status === 201 && (await q(`SELECT COUNT(*) n FROM tarea_historial WHERE tarea_id = ? AND tipo = 'empezada'`, [t.l1_s1]))[0].n === 1, 'empezar una ya empezada no escribe otro apunte');
  const np = await acc(s1, t.l1_s1, 'no_pude', { nota: 'ab' });
  ok(np.status === 400, '«no pude» pide el motivo (3 letras)');
  const np2 = await acc(s1, t.l1_s1, 'no_pude', { nota: 'No hubo nadie en la junta' });
  const filaNp = (await q('SELECT estado, no_pudo_nota, no_pudo_en FROM tareas WHERE id = ?', [t.l1_s1]))[0];
  ok(np2.status === 201 && filaNp.estado === 'pendiente' && filaNp.no_pudo_nota === 'No hubo nadie en la junta' && filaNp.no_pudo_en, '«no pude»: vuelve a pendiente con su motivo y su hora', filaNp);
  ok((await pedir('GET', '/?limite=100', { usuario: l1 })).datos.tareas.find((x) => x.id === t.l1_s1).no_pudo === true, 'y quien asignó lo ve marcado en la lista');
  ok((await acc(s1, t.l1_s1, 'empece')).status === 201 && (await q('SELECT no_pudo_en FROM tareas WHERE id = ?', [t.l1_s1]))[0].no_pudo_en === null, 'empezar de nuevo limpia el «no pude»');

  // Evidencia por tipo.
  const libre = await mk(admin, s1, { tipo: 'libre', titulo: 'Tarea libre de prueba' });
  const visita = await mk(admin, s1, { tipo: 'visita', titulo: 'Visita de prueba', zona_texto: 'Barrio Los Ejemplos' });
  const entrega = await mk(admin, s1, { tipo: 'entrega', titulo: 'Entrega de prueba', zona_texto: 'Barrio Los Ejemplos', cantidad_prevista: 30 });
  const sinEvid = await acc(s1, libre, 'termine');
  ok(sinEvid.status === 201 && sinEvid.datos.estado === 'hecha', 'LIBRE: se termina sin evidencia obligatoria (pendiente → hecha directo)', sinEvid.datos);
  const v0 = await acc(s1, visita, 'termine');
  ok(v0.status === 400 && /foto o con la ubicación/.test(v0.datos.error), 'VISITA sin foto ni ubicación: 400', v0.datos);
  const vPos = await acc(s1, visita, 'termine', { latitud: 5.0689, longitud: -75.5174, precision_m: 12 });
  ok(vPos.status === 201, 'VISITA solo con la ubicación: se acepta');
  const visita2 = await mk(admin, s1, { tipo: 'visita', titulo: 'Visita con foto', zona_texto: 'Barrio Los Ejemplos' });
  ok((await acc(s1, visita2, 'termine', {}, [await grande(true)])).status === 201, 'VISITA solo con una foto: se acepta');
  const e0 = await acc(s1, entrega, 'termine');
  ok(e0.status === 400 && /cantidad/.test(e0.datos.error), 'ENTREGA sin cantidad: 400');
  ok((await acc(s1, entrega, 'termine', { cantidad: 0 }, [await grande(false)])).status === 400 && (await acc(s1, entrega, 'termine', { cantidad: 'muchas' }, [await grande(false)])).status === 400, 'cantidad cero o que no es número: 400');
  const eSinFoto = await acc(s1, entrega, 'termine', { cantidad: 25 });
  ok(eSinFoto.status === 400 && /foto/.test(eSinFoto.datos.error), 'ENTREGA con cantidad pero sin foto: 400', eSinFoto.datos);
  ok((await acc(s1, entrega, 'termine', { cantidad: 25 }, [await grande(false), await grande(false), await grande(false), await grande(false)])).status === 400, 'más de 3 fotos: 400');
  const eOk = await acc(s1, entrega, 'termine', { cantidad: 25, nota: 'Entregado a la presidenta de la junta' }, [await grande(true), await grande(false)]);
  ok(eOk.status === 201 && eOk.datos.fotos === 2, 'ENTREGA con cantidad y fotos: se acepta', eOk.datos);
  const fe = (await q('SELECT estado, cantidad_entregada, hecha_nota, hecha_en FROM tareas WHERE id = ?', [entrega]))[0];
  ok(fe.estado === 'hecha' && fe.cantidad_entregada === 25 && fe.hecha_en, 'queda la cantidad, la nota y la hora', fe);
  ok((await acc(s1, entrega, 'termine', { cantidad: 25 }, [await grande(false)])).status === 409 && (await acc(s1, entrega, 'empece')).status === 409, 'una tarea ya hecha no se vuelve a terminar ni a empezar (409)');
  // La hora del toque sin señal.
  const horaToque = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const sinSenal = await mk(admin, s1, { titulo: 'Hecha sin señal' });
  await acc(s1, sinSenal, 'termine', { marcado_en: horaToque });
  const hecha = (await q(`SELECT TIMESTAMPDIFF(MINUTE, hecha_en, NOW()) m FROM tareas WHERE id = ?`, [sinSenal]))[0].m;
  ok(hecha >= 175 && hecha <= 185, 'la hora que cuenta es la del TOQUE (hace 3 horas), no la de la subida', hecha);
  const futura = await mk(admin, s1, { titulo: 'Con hora del futuro' });
  await acc(s1, futura, 'termine', { marcado_en: new Date(Date.now() + 86400000).toISOString() });
  ok((await q(`SELECT TIMESTAMPDIFF(MINUTE, hecha_en, NOW()) m FROM tareas WHERE id = ?`, [futura]))[0].m <= 1, 'una hora del futuro se descarta: cuenta la del servidor');

  /* ====================================================================================== 7. fotos y posición */
  console.log('\n[7] Fotos (1.280 px, sin EXIF, privadas) y una sola posición');
  const fotosE = await q('SELECT * FROM tarea_fotos WHERE tarea_id = ? ORDER BY orden', [entrega]);
  ok(fotosE.length === 2 && fotosE.map((f) => f.orden).join() === '1,2', 'quedan 2 filas, en orden');
  for (const f of fotosE) {
    const ruta = path.join(T.DIR_FOTOS, f.archivo), buf = fs.readFileSync(ruta), m = await sharp(buf).metadata();
    ok(/^tar_\d+_[0-9a-f]{12}\.jpg$/.test(f.archivo) && m.format === 'jpeg' && Math.max(m.width, m.height) === 1280, `la foto ${f.orden} es un JPEG de 1.280 px (${m.width}×${m.height})`);
    ok(!m.exif && !buf.includes(Buffer.from('SECRETO-DEL-TELEFONO')) && !buf.includes(Buffer.from('MarcaPrueba')), `la foto ${f.orden} NO trae EXIF`);
  }
  const verFoto = (u, id, fid) => pedir('GET', `/${id}/fotos/${fid}`, { usuario: u });
  const fo = await verFoto(admin, entrega, fotosE[0].id);
  ok(fo.status === 200 && fo.tipo === 'image/jpeg', 'la foto sale por la ruta con alcance (el administrador)');
  ok((await verFoto(s1, entrega, fotosE[0].id)).status === 200, 'el asignado la abre');
  ok((await verFoto(l2, entrega, fotosE[0].id)).status === 404 && (await verFoto(s2, entrega, fotosE[0].id)).status === 404 && (await verFoto(admin, 9999999, 1)).status === 404, 'otro líder, otro sublíder o una tarea que no existe: 404');
  ok((await verFoto(admin, libre, fotosE[0].id)).status === 404, 'una foto de OTRA tarea no sale por esta');
  // Posición: la ven quien gestiona y el asignado.
  const dPos = async (u, id) => (await pedir('GET', `/${id}`, { usuario: u })).datos;
  ok((await dPos(s1, visita)).ubicacion && (await dPos(s1, visita)).ubicacion.latitud === 5.0689, 'el ASIGNADO ve su posición');
  ok((await dPos(admin, visita)).ubicacion && (await dPos(admin, visita)).ubicacion.latitud === 5.0689, 'quien la creó (administrador) también');
  // Una tarea creada por la coordinadora para el sublíder: el líder la ve, pero no gestiona; no ve la posición.
  const delC1 = await mk(c1, s1, { tipo: 'visita', titulo: 'Visita de la coordinadora', zona_texto: 'Barrio Los Ejemplos' });
  await acc(s1, delC1, 'termine', { latitud: 5.07, longitud: -75.52 });
  const comoL1 = await dPos(l1, delC1);
  ok(comoL1.puede_gestionar === false && comoL1.con_ubicacion === true && comoL1.ubicacion === null && !JSON.stringify(comoL1).includes('5.07'), 'el LÍDER (ve la tarea de su sublíder pero no la gestiona) sabe que hay ubicación, no CUÁL', comoL1.ubicacion);
  ok((await dPos(c1, delC1)).ubicacion && (await dPos(c1, delC1)).puede_gestionar === true, 'la coordinadora que la creó sí');
  const fuera = await acc(s1, await mk(admin, s1, { tipo: 'visita', titulo: 'Visita fuera de Colombia', zona_texto: 'X' }), 'termine', { latitud: 40.4, longitud: -3.7 });
  ok(fuera.status === 400, 'una posición fuera de Colombia se descarta y entonces la visita no tiene evidencia (400)');
  const sinGps = await mk(admin, s1, { tipo: 'visita', titulo: 'Visita sin GPS pero con foto', zona_texto: 'X' });
  await acc(s1, sinGps, 'termine', { latitud: 'abc', longitud: '' }, [await grande(false)]);
  const filaSinGps = (await q('SELECT estado, latitud FROM tareas WHERE id = ?', [sinGps]))[0];
  ok(filaSinGps.estado === 'hecha' && filaSinGps.latitud === null, 'la ubicación nunca bloquea: con una foto y GPS inválido, la tarea se termina sin coordenadas');
  ok((await q('SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = \'tareas\' AND column_name IN (\'latitud\',\'longitud\')'))[0].n === 2 && (await q('SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE \'tarea%\' AND table_name LIKE \'%ruta%\'' ))[0].n === 0, 'una sola posición por tarea: dos columnas en la propia tarea, ninguna tabla de recorridos');

  /* ====================================================================================== 8. gestionar */
  console.log('\n[8] Quien gestiona: verificar, devolver, cancelar, editar, reasignar');
  const accion = (u, id, a, nota) => pedir('POST', `/${id}/${a}`, { usuario: u, json: nota === undefined ? {} : { nota } });
  ok((await accion(l1, t.l1_s2, 'verificar')).status === 409, 'verificar una que no está hecha: 409');
  ok((await accion(s1, entrega, 'verificar')).status === 404, 'el asignado no verifica lo que él hizo (no la gestiona): 404');
  ok((await accion(l2, entrega, 'verificar')).status === 404, 'otro líder: 404');
  const dev0 = await accion(admin, entrega, 'devolver');
  ok(dev0.status === 400 && /falta/.test(dev0.datos.error), 'devolver pide lo que falta (400)');
  const dev = await accion(admin, entrega, 'devolver', 'Falta la foto del acta de entrega');
  const fd = (await q('SELECT estado, devuelta_nota FROM tareas WHERE id = ?', [entrega]))[0];
  ok(dev.status === 200 && fd.estado === 'en_curso' && fd.devuelta_nota === 'Falta la foto del acta de entrega', 'devolver: hecha → en curso con su motivo', fd);
  ok((await pedir('GET', '/mias', { usuario: s1 })).datos.tareas.find((x) => x.id === entrega).devuelta_nota === 'Falta la foto del acta de entrega', 'el asignado ve lo que le falta en «Mis tareas»');
  const reHecha = await acc(s1, entrega, 'termine', { cantidad: 25 }, [await grande(false)]);
  ok(reHecha.status === 201 && (await q('SELECT COUNT(*) n FROM tarea_fotos WHERE tarea_id = ?', [entrega]))[0].n === 3 && (await q('SELECT devuelta_nota FROM tareas WHERE id = ?', [entrega]))[0].devuelta_nota === null, 'al terminarla otra vez suma su foto (3 en total) y limpia la devolución');
  ok((await acc(s1, entrega, 'termine', { cantidad: 25 }, [await grande(false)])).status === 409, 'y ya no admite más (está hecha)');
  const ver = await accion(admin, entrega, 'verificar');
  ok(ver.status === 200 && (await q('SELECT estado, verificada_en, verificada_por FROM tareas WHERE id = ?', [entrega]))[0].verificada_por === 1, 'verificar: hecha → verificada, con quién y cuándo');
  ok((await accion(admin, entrega, 'verificar')).status === 409 && (await accion(admin, entrega, 'cancelar', 'ya no')).status === 409, 'una verificada es terminal: no se verifica ni se cancela otra vez (409)');
  // Coordinadora y líder.
  ok((await accion(c1, delC1, 'verificar')).status === 200, 'la COORDINADORA verifica lo que creó');
  const hechaAdm = await mk(admin, c1, { titulo: 'Tarea del administrador para la coordinadora' });
  await acc(c1, hechaAdm, 'termine');
  ok((await accion(c1, hechaAdm, 'verificar')).status === 403 && (await accion(admin, hechaAdm, 'verificar')).status === 200, 'la coordinadora NO verifica lo que le asignaron a ella (403); el administrador sí');
  const hechaL1 = await mk(l1, s2, { titulo: 'Tarea del líder para su sublíder' });
  await acc(s2, hechaL1, 'termine');
  ok((await accion(l1, hechaL1, 'devolver', 'Faltó algo')).status === 200 && (await accion(c1, hechaL1, 'cancelar', 'ya no hace falta')).status === 200, 'el líder devuelve lo que creó; la coordinadora (su rama) cancela con motivo');
  ok((await accion(l1, t.c1_s1, 'cancelar', 'No me toca')).status === 404, 'el líder NO gestiona la tarea que la coordinadora le puso a su sublíder (la ve, pero 404 al gestionar)');
  const canc0 = await accion(admin, t.adm_c1, 'cancelar');
  ok(canc0.status === 400 && /motivo/.test(canc0.datos.error), 'cancelar pide el motivo');
  // Editar y reasignar.
  const ed = await pedir('PUT', `/${t.l1_s2}`, { usuario: l1, json: { titulo: 'Título nuevo', fecha_limite: await dentroDe(9) } });
  ok(ed.status === 200 && (await q('SELECT titulo FROM tareas WHERE id = ?', [t.l1_s2]))[0].titulo === 'Título nuevo', 'el líder edita lo que creó');
  ok((await pedir('PUT', `/${t.l1_s2}`, { usuario: s2, json: { titulo: 'Intruso' } })).status === 404 && (await q('SELECT titulo FROM tareas WHERE id = ?', [t.l1_s2]))[0].titulo === 'Título nuevo', 'el sublíder asignado no edita lo que le pusieron (404) y no cambió nada');
  ok((await pedir('PUT', `/${t.c1_s1}`, { usuario: l1, json: { titulo: 'Intruso' } })).status === 404, 'el líder no edita la de la coordinadora (404)');
  const re = await pedir('PUT', `/${t.l1_s2}`, { usuario: l1, json: { asignada_a: s1.id } });
  ok(re.status === 200 && re.datos.reasignada === true && (await q('SELECT asignada_a, estado FROM tareas WHERE id = ?', [t.l1_s2]))[0].asignada_a === s1.id, 'reasignar a otro sublíder suyo');
  ok((await pedir('PUT', `/${t.l1_s2}`, { usuario: l1, json: { asignada_a: s3.id } })).status === 400, 'reasignar fuera de lo que puede asignar: 400');
  const hechaParaReasignar = await mk(l1, s1, { titulo: 'Para reasignar' });
  await acc(s1, hechaParaReasignar, 'termine');
  ok((await pedir('PUT', `/${hechaParaReasignar}`, { usuario: l1, json: { asignada_a: s2.id } })).status === 409, 'una hecha no se reasigna sin devolverla antes (409)');
  ok((await pedir('PUT', `/${entrega}`, { usuario: admin, json: { titulo: 'x1234' } })).status === 409, 'una verificada no se edita (409)');
  const histEntrega = (await pedir('GET', `/${entrega}`, { usuario: admin })).datos.historial.map((h) => h.tipo);
  ok(['creada', 'hecha', 'devuelta', 'hecha', 'verificada'].every((x, i) => histEntrega[i] === x), 'el historial cuenta todo en orden: creada, hecha, devuelta, hecha, verificada', histEntrega);

  /* ====================================================================================== 9. derivados */
  console.log('\n[9] «Vencida» y «sin responsable activo» se calculan; no se guardan');
  await q('DELETE FROM tareas');
  const ayer = await dentroDelAlcance(-1);
  async function dentroDelAlcance(d) { return (await q(`SELECT DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL ? DAY), '%Y-%m-%d') f`, [d]))[0].f; }
  const vv = await mk(admin, s1, { titulo: 'Vence ayer' }), vh = await mk(admin, s1, { titulo: 'Vence hoy', fecha_limite: hoy }), vf = await mk(admin, s1, { titulo: 'Vence luego', fecha_limite: await dentroDe(4) });
  await q('UPDATE tareas SET fecha_limite = ? WHERE id = ?', [ayer, vv]);
  const rowOf = async (id) => (await pedir('GET', `/?limite=100`, { usuario: admin })).datos.tareas.find((x) => x.id === id);
  ok((await rowOf(vv)).vencida === true && (await rowOf(vh)).vencida === false && (await rowOf(vh)).vence_hoy === true && (await rowOf(vf)).vencida === false, 'vencida = abierta con la fecha límite pasada; la de hoy vence hoy; la de más adelante, ninguna');
  ok(!(await q(`SELECT column_name c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'tareas'`)).some((c) => /vencid|sin_responsable/.test(c.c)) && (await q(`SELECT column_type c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'tareas' AND column_name = 'estado'`))[0].c === "enum('pendiente','en_curso','hecha','verificada','cancelada')", 'y no existen como columna ni como estado guardado');
  const lv = await pedir('GET', '/?limite=100&vencidas=1', { usuario: admin });
  ok(idsDe(lv).join() === String(vv) && lv.datos.vencidas === 1, 'el filtro «vencidas» y su contador', lv.datos.vencidas);
  await acc(s1, vv, 'termine');
  ok((await rowOf(vv)).vencida === false, 'una HECHA ya no está vencida (solo espera su verificación)');
  await q('UPDATE usuarios SET activo = 0 WHERE id = ?', [s1.id]);
  ok((await rowOf(vh)).sin_responsable_activo === true && (await rowOf(vv)).sin_responsable_activo === true && (await pedir('GET', '/?sin_responsable=1&limite=100', { usuario: admin })).datos.sin_responsable === 3, 'con la cuenta del responsable inactiva, las abiertas y las hechas salen «sin responsable activo»');
  await accion(admin, vv, 'verificar');
  ok((await rowOf(vv)).sin_responsable_activo === false, 'una verificada ya no necesita responsable');
  await q('UPDATE usuarios SET activo = 1 WHERE id = ?', [s1.id]);
  ok((await rowOf(vh)).sin_responsable_activo === false, 'al reactivar la cuenta, desaparece');
  const rr = await pedir('PUT', `/${vh}`, { usuario: admin, json: { asignada_a: s2.id } });
  ok(rr.status === 200 && (await pedir('GET', '/mias', { usuario: s2 })).datos.tareas.some((x) => x.id === vh), 'y reasignarla la lleva al nuevo responsable');

  /* ====================================================================================== 10. push */
  console.log('\n[10] Push: al asignar, al verificar y al devolver');
  const avisos = [];
  Avisos.deps.enviarPush = async (id, carga) => { avisos.push({ id, ...carga }); };
  await q('DELETE FROM tareas');
  const titulo = 'Titulo secreto con la palabra jamás';
  const cA = await crear(admin, { asignada_a: l1.id, tipo: 'visita', titulo, zona_texto: 'Barrio El Carmen', descripcion: 'Descripción privada' });
  ok(cA.status === 201 && cA.datos.aviso_enviado === true && avisos.length === 1 && avisos[0].id === l1.id, 'al asignar, le llega el aviso al responsable', [cA.datos, avisos.length]);
  ok(avisos[0].titulo === 'Te asignaron una tarea' && /visita/.test(avisos[0].cuerpo) && /El Carmen/.test(avisos[0].cuerpo) && avisos[0].cuerpo.length <= 140, 'dice el tipo y la zona, y cabe en 140', avisos[0]);
  ok(!/secreto|jamás|privada|Descripci/i.test(JSON.stringify(avisos[0])), 'NUNCA el título ni la descripción');
  ok(avisos[0].url === '/app/mis-tareas.html', 'y abre «Mis tareas»');
  avisos.length = 0;
  const cSelf = await crear(l1, { asignada_a: l1.id });
  ok(cSelf.status === 201 && avisos.length === 0 && cSelf.datos.aviso_enviado === false, 'quien se asigna a sí mismo no se avisa solo');
  await crear(admin, { asignada_a: c2.id });
  await permisos('coordinador', 0, 0, 0);
  avisos.length = 0;
  const cSin2 = await crear(admin, { asignada_a: c2.id });
  ok(cSin2.status === 201 && avisos.length === 0 && /no tiene acceso/.test(cSin2.datos.aviso || ''), 'a quien no puede ver el módulo NO se le avisa y al administrador se le dice', cSin2.datos);
  await permisos('coordinador', 1, 1, 1);
  avisos.length = 0;
  const idHecha = cA.datos.id;
  await acc(l1, idHecha, 'termine', { latitud: 5.06, longitud: -75.51 });
  const vf2 = await accion(admin, idHecha, 'devolver', 'Faltó la firma de la presidenta secreta');
  ok(vf2.status === 200 && avisos.length === 1 && avisos[0].id === l1.id && avisos[0].titulo === 'Te devolvieron una tarea', 'al devolverla, le llega al responsable', avisos);
  ok(!/firma|presidenta|secreta/i.test(JSON.stringify(avisos[0])), 'sin la nota de la devolución');
  await acc(l1, idHecha, 'termine', { latitud: 5.06, longitud: -75.51 });
  avisos.length = 0;
  const vf3 = await accion(admin, idHecha, 'verificar');
  ok(vf3.status === 200 && avisos.length === 1 && avisos[0].titulo === 'Tu tarea fue verificada', 'al verificarla, también');
  const autoCreada = (await crear(l1, { asignada_a: l1.id })).datos.id;
  await acc(l1, autoCreada, 'termine');
  avisos.length = 0;
  await accion(l1, autoCreada, 'verificar');
  ok(avisos.length === 0, 'si quien verifica es el mismo asignado (se la puso a sí mismo), no se avisa solo');
  Avisos.deps.enviarPush = async () => { throw new Error('Esta persona no tiene ningún dispositivo registrado para avisos.'); };
  const cFalla = await crear(admin, { asignada_a: l2.id });
  ok(cFalla.status === 201 && cFalla.datos.aviso_enviado === false && (await q('SELECT asignada_a FROM tareas WHERE id = ?', [cFalla.datos.id]))[0].asignada_a === l2.id, 'si el aviso falla, la tarea igual queda creada');
  Avisos.deps.enviarPush = async (id, carga) => { avisos.push({ id, ...carga }); };
  avisos.length = 0;
  await pedir('PUT', `/${cFalla.datos.id}`, { usuario: admin, json: { asignada_a: l1.id } });
  ok(avisos.length === 1 && avisos[0].id === l1.id && avisos[0].titulo === 'Te asignaron una tarea', 'reasignar le avisa a la persona nueva');

  /* ====================================================================================== 11. tarjeta del panel */
  console.log('\n[11] La tarjeta «mis tareas» del panel del líder');
  await q('DELETE FROM tareas');
  const p1 = await mk(admin, l1, { titulo: 'Vence hoy', fecha_limite: hoy }), p2 = await mk(admin, l1, { titulo: 'Futura', fecha_limite: await dentroDe(6) }), p3 = await mk(admin, l1, { titulo: 'Sin fecha' }), p4 = await mk(admin, l1, { titulo: 'Vencida' });
  await q('UPDATE tareas SET fecha_limite = ? WHERE id = ?', [await dentroDelAlcance(-3), p4]);
  await mk(admin, l2, { titulo: 'De otro' });
  const hecho = await mk(admin, l1, { titulo: 'Ya hecha' }); await acc(l1, hecho, 'termine');
  const rs = await T.resumenMisTareas(l1.id);
  ok(rs.pendientes === 4 && rs.vencen_hoy === 1 && rs.vencidas === 1, 'resumen: 4 pendientes, 1 vence hoy, 1 vencida (la hecha y las de otros no cuentan)', rs);
  const panelDe = (u) => pedir('GET', '', { usuario: u, prefijo: '/api/panel-lider' });
  const pl = await panelDe(l1);
  ok(pl.status === 200 && pl.datos.tareas && pl.datos.tareas.pendientes === 4 && pl.datos.tareas.vencen_hoy === 1 && pl.datos.tareas.vencidas === 1, '/api/panel-lider trae la tarjeta con «Ver» en tareas', pl.datos && pl.datos.tareas);
  ok(!JSON.stringify(pl.datos.tareas).match(/Futura|Ya hecha|De otro|Sin fecha|titulo|nombre/i), 'solo cifras: ningún título ni nombre en la tarjeta');
  await permisos('lider', 0, 0, 0);
  const plSin = await panelDe(l1);
  ok(plSin.status === 200 && plSin.datos.tareas === null && plSin.datos.meta !== undefined, 'sin «Ver» en tareas la tarjeta no viaja (null) y el resto del panel sigue igual');
  await permisos('lider', 1, 1, 1);
  const plS = await panelDe(s1);
  ok(plS.status === 200 && plS.datos.tareas && plS.datos.tareas.pendientes === 0, 'el sublíder también la tiene (con sus propias cifras)');

  /* ====================================================================================== 12. recordatorios */
  console.log('\n[12] Recordatorios en el motor: 3 días antes y al vencer, máximo 3 avisos');
  await q('DELETE FROM tareas'); await q('DELETE FROM recordatorio_envios');
  const D = '2026-11-20';                                                      // la fecha límite de las pruebas
  const aTexto = R.aTexto;
  const COL = (iso) => new Date(iso);                                           // instantes en UTC
  const ahora3 = COL('2026-11-17T19:00:00Z');                                   // 17 nov 14:00 en Colombia
  const ahoraHoy = COL('2026-11-20T19:00:00Z');                                 // 20 nov 14:00
  const fijar = async (id, o = {}) => {
    await q('UPDATE tareas SET fecha_limite = ?, creada_en = ? WHERE id = ?', [o.fecha || D, o.creada || '2026-11-10 10:00:00', id]);
  };
  const tv = await mk(admin, l1, { titulo: 'Título que no debe salir', tipo: 'visita', zona_texto: 'Barrio El Carmen' });
  const tc = await mk(admin, l1, { titulo: 'Cerrada' }); const tr = await mk(admin, l1, { titulo: 'Recién creada' }); const ts = await mk(admin, c2, { titulo: 'Sin acceso al módulo' });
  const tn = await mk(admin, l1, { titulo: 'Sin fecha' });
  await fijar(tv); await fijar(tc); await fijar(ts); await fijar(tr, { creada: '2026-11-18 09:00:00' });
  await q("UPDATE tareas SET estado = 'cancelada' WHERE id = ?", [tc]);
  await permisos('coordinador', 0, 0, 0);
  const enviados = [];
  R.deps.enviar = async (canal, o) => { enviados.push({ canal, usuario: o.ficha.usuario_id, texto: o.texto, asunto: o.asunto, regla: o.regla.id }); return 'push:1'; };
  let r = await R.vuelta({ ahora: ahora3 });
  ok(r.omitida === 'apagado' && enviados.length === 0, 'APAGADO de fábrica: con el interruptor general en 0, ni se mira');
  await q('UPDATE configuracion_campana SET recordatorios_activos = 1 WHERE id = 1');
  r = await R.vuelta({ ahora: ahora3 });
  ok(enviados.length === 0, 'con el general encendido pero las reglas apagadas, tampoco sale nada');
  const [rAntes, rHoy] = await q(`SELECT id FROM recordatorio_reglas WHERE tipo = 'tarea_vence' ORDER BY desfase_min`);
  await R.activarRegla(rAntes.id, 1, { ahora: ahora3 }); await R.activarRegla(rHoy.id, 1, { ahora: ahora3 });
  ok((await q(`SELECT COUNT(*) n FROM recordatorio_reglas WHERE tipo = 'tarea_vence' AND activo = 1`))[0].n === 2, 'las plantillas de fábrica pasan el validador (también en precampaña) y las reglas se encienden');
  r = await R.vuelta({ ahora: COL('2026-11-18T02:00:00Z') });                   // 21:00 en Colombia
  ok(r.omitida === 'silencio' && enviados.length === 0, 'en la franja de silencio (20:00–08:00) no sale nada');
  r = await R.vuelta({ ahora: COL('2026-11-17T12:00:00Z') });                   // 07:00: todavía no toca
  ok(enviados.length === 0, 'antes de las 8 de la mañana del día que toca, tampoco');
  r = await R.vuelta({ ahora: ahora3 });
  ok(enviados.length === 1 && enviados[0].usuario === l1.id && enviados[0].regla === rAntes.id, '3 días antes (17 nov): UN aviso, al responsable de la tarea abierta', enviados.map((e) => [e.usuario, e.texto]));
  ok(/visita/.test(enviados[0].texto) && /El Carmen/.test(enviados[0].texto) && /vence en 3 días/.test(enviados[0].texto) && /^Lider/.test(enviados[0].texto), 'dice el tipo, la zona y «vence en 3 días», con el nombre de pila', enviados[0].texto);
  ok(!/Título|debe salir/.test(JSON.stringify(enviados[0])) && enviados[0].asunto === 'Tarea por vencer', 'y NUNCA el título');
  ok(!enviados.some((e) => /Cerrada|Recién|Sin acceso|Sin fecha/.test(e.texto)) && enviados.every((e) => e.usuario !== c2.id), 'no avisa de la cancelada, la recién creada (ya lo supo al asignársela), la de quien no ve el módulo ni la que no tiene fecha');
  r = await R.vuelta({ ahora: new Date(ahora3.getTime() + 120000) });
  ok(enviados.length === 1, 'una segunda vuelta no repite el aviso');
  r = await R.vuelta({ ahora: ahoraHoy });
  const hoyDeTv = enviados.filter((e) => /El Carmen/.test(e.texto) && /vence hoy/.test(e.texto));
  ok(enviados.length === 3 && hoyDeTv.length === 1 && hoyDeTv[0].regla === rHoy.id, 'el día que vence (20 nov): el segundo aviso de esa tarea, «vence hoy»', enviados.map((e) => e.texto));
  ok(enviados.some((e) => /\(libre\) en tu zona vence hoy/.test(e.texto)), 'y la creada el 18 (después del aviso de 3 días) recibe el de «hoy», con «tu zona» por no tener zona');
  r = await R.vuelta({ ahora: new Date(ahoraHoy.getTime() + 120000) });
  ok(enviados.length === 3, 'y ahí se acaban: 2 avisos por fecha límite');
  // Máximo 3 avisos por tarea, aunque la fecha cambie.
  await q('UPDATE tareas SET fecha_limite = ? WHERE id = ?', ['2026-11-30', tv]);
  await q('UPDATE tareas SET creada_en = ? WHERE id = ?', ['2026-11-10 10:00:00', tv]);
  r = await R.vuelta({ ahora: COL('2026-11-27T19:00:00Z') });                   // 3 días antes de la nueva fecha
  ok(enviados.length === 4 && enviados.filter((e) => /El Carmen/.test(e.texto)).length === 3, 'si la fecha cambia, otro aviso para esa tarea (el tercero)', enviados.length);
  r = await R.vuelta({ ahora: COL('2026-11-30T19:00:00Z') });
  ok(enviados.length === 4, 'y el cuarto NO sale: máximo 3 avisos por tarea', enviados.length);
  // Cerrar mientras espera un reintento.
  const tReint = await mk(admin, l1, { titulo: 'Con reintento', tipo: 'libre' });
  await fijar(tReint, { fecha: '2026-12-10' });
  let falla = true;
  R.deps.enviar = async (canal, o) => { if (falla) { falla = false; throw new Error('el servicio de avisos no responde'); } enviados.push({ canal, usuario: o.ficha.usuario_id, texto: o.texto }); return 'push:1'; };
  const t7 = COL('2026-12-07T19:00:00Z');
  r = await R.vuelta({ ahora: t7 });
  ok(r.reintentos === 1 && enviados.length === 4, 'si el aviso falla, queda esperando su reintento', r);
  await accion(admin, tReint, 'cancelar', 'Ya no hace falta');
  r = await R.vuelta({ ahora: new Date(t7.getTime() + 6 * 60000) });
  const filaEsp = (await q(`SELECT estado, motivo FROM recordatorio_envios WHERE ocurrencia LIKE ? ORDER BY id DESC LIMIT 1`, [`tarea:${tReint}:%`]))[0];
  ok(enviados.length === 4 && filaEsp.estado === 'omitido' && /ya no está abierta/.test(filaEsp.motivo), 'si la tarea se cancela mientras esperaba, el aviso se cancela con su motivo', filaEsp);
  // Enviarme una prueba.
  const prueba = await R.enviarPrueba({ reglaId: rAntes.id, usuarioId: admin.id, ahora: ahora3 });
  ok(prueba.canal === 'push' && /vence en 3 días/.test(prueba.texto) && /visita/.test(prueba.texto), '«Enviarme una prueba» funciona con datos de muestra', prueba);
  const listadas = await R.listarReglas();
  ok(listadas.filter((x) => x.tipo === 'tarea_vence').length === 2 && listadas.findIndex((x) => x.tipo === 'tarea_vence') > listadas.findIndex((x) => x.tipo === 'solicitud_sin_movimiento'), 'la pantalla de reglas las lista al final, con su etiqueta');
  const val = R.validarProgramacion({ tipo: 'tarea_vence', gracia_min: 60, desfase_min: 5 });
  ok(val.length === 1 && R.validarProgramacion({ tipo: 'tarea_vence', gracia_min: 60, desfase_min: -4320 }).length === 0 && R.validarProgramacion({ tipo: 'tarea_vence', gracia_min: 60, desfase_min: 0 }).length === 0, 'el validador acepta de -7 días a 0 y rechaza el futuro');
  await q('UPDATE configuracion_campana SET recordatorios_activos = 0 WHERE id = 1');
  await q("UPDATE recordatorio_reglas SET activo = 0 WHERE tipo = 'tarea_vence'");
  await permisos('coordinador', 1, 1, 1);

  /* ====================================================================================== 13. textos */
  console.log('\n[13] Los textos: nada de votos, elección ni cargos');
  const PROHIBIDO = /\b(alcald\w*|concej\w*|gobernaci\w*|gobernador\w*|asamble\w*|senad\w*|edil\w*|vot\w*|elecci\w*|electoral\w*|urnas?|tarjet\w*|cargos?)\b/i;
  const cuerpoGuia = (t2) => t2.replace(/^---[\s\S]*?---/, '');
  const sinMarcado = (html) => html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
  const cadenas = (js) => [...js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1').matchAll(/'([^'\n]{4,})'|"([^"\n]{4,})"|`([^`]{4,})`/g)].map((m) => m[1] || m[2] || m[3]);
  const guiones = (html) => [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const a of ['manuales/bloques/mod-tareas.md', 'manuales/bloques/t-tarea-asignar.md']) {
    ok(fs.existsSync(path.join(raiz, a)) && !PROHIBIDO.test(cuerpoGuia(leer(a))), `la guía ${path.basename(a)}`);
  }
  for (const a of ['public/tareas.html', 'public/app/mis-tareas.html']) {
    if (!fs.existsSync(path.join(raiz, a))) { ok(false, `existe ${a}`); continue; }
    const t2 = leer(a);
    const mal = [sinMarcado(t2), ...guiones(t2).flatMap(cadenas)].filter((x) => PROHIBIDO.test(x.replace(/^\s*(select|insert|update|from|where)\b[\s\S]*$/i, '')));
    ok(mal.length === 0, `${a}: ningún texto visible menciona cargos, voto ni elección`, mal.slice(0, 3));
  }
  const tAvisos = Object.values(Avisos.TEXTOS).map((x) => x.titulo + ' ' + x.cola).join(' ') + ' ' + Object.values(T.TIPOS).map((x) => x.etiqueta + ' ' + x.frase).join(' ') + ' ' + reglas.map((x) => x.nombre).join(' ');
  const plantillas = (await q(`SELECT plantilla, asunto FROM recordatorio_reglas WHERE tipo = 'tarea_vence'`)).map((x) => x.plantilla + ' ' + x.asunto).join(' ');
  ok(!PROHIBIDO.test(tAvisos + ' ' + plantillas) && !R.palabraProhibida(plantillas, {}), 'los avisos, los tipos y las plantillas de fábrica (también para el validador de precampaña)');

  servidor.close();
  try { for (const f of fs.readdirSync(T.DIR_FOTOS)) fs.unlinkSync(path.join(T.DIR_FOTOS, f)); } catch (_) { /* sin carpeta */ }
  console.log(fallos ? `\n${fallos} comprobación(es) FALLARON.` : '\nTODO BIEN');
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
