#!/usr/bin/env node
// scripts/probar-solicitudes.js
//
// Prueba de las SOLICITUDES CIUDADANAS (parche 303), Fases 1 y 2, del lado del servidor:
//   · migración repetible: tablas, nueve categorías, módulo apagado de fábrica, política con la finalidad nueva y versión archivada;
//   · permisos EXIGIDOS en el servidor (Ver, Agregar, Editar);
//   · el registro: validaciones, idempotencia por cliente_uuid, anonimato sin autorización, ubicación que nunca bloquea;
//   · el ALCANCE (líder, sublíder, otro líder, coordinador, otra coordinación, aspirante, administrador) y «me la asignaron»;
//   · el teléfono del ciudadano: solo el administrador y el responsable; nunca en la lista ni en la respuesta de registrar;
//   · estados (nunca «resuelta» ni «cumplida»), responsable, notas internas, historial y auditoría;
//   · fotos: máximo 3, reducidas a 1.280 px, SIN EXIF, en una carpeta que /uploads no sirve y por una ruta que comprueba el alcance;
//   · categorías editables solo por el administrador; anonimización (una solicitud y el plazo después de la elección, con su script);
//   · la cola sin señal (se comprueba en el código; el comportamiento real lo prueba scripts/probar-solicitudes-celular.js);
//   · los textos de las pantallas nuevas: nada de cargos, voto, elección ni promesas.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada303 node scripts/probar-solicitudes.js
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
const { spawnSync } = require('child_process');
const pool = require('../config/db');
const { alcanceSolicitudes } = require('../lib/alcanceSolicitudes');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); }
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
app.use('/api/solicitudes', require('../routes/solicitudes.routes'));
let base = '';
async function pedir(metodo, ruta, { json, usuario, form, aspirante } = {}) {
  const h = { 'X-Forwarded-For': '198.51.100.9', 'User-Agent': 'prueba/1.0' };
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  if (aspirante) h['X-Test-Aspirante'] = String(aspirante);
  const r = await fetch(base + '/api/solicitudes' + ruta, { method: metodo, headers: h, body });
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
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo, telefono) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), ?, ?)`,
    [nombre, `9300000${n}`, `u9300000${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol, extra.activo === 0 ? 0 : 1, extra.telefono || null]);
  return { id: r.insertId, rol, nombre };
}
async function estructura(u, cargo, supervisor) {
  await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, ?, 1)', [u.id, cargo, supervisor ? supervisor.id : null]);
}
async function permisos(rol, ver, editar, agregar) {
  await pool.query(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES (?, 'solicitudes', ?, ?, ?)
                    ON DUPLICATE KEY UPDATE permitido = VALUES(permitido), editar = VALUES(editar), agregar = VALUES(agregar)`, [rol, ver, editar, agregar]);
}
const formDe = (campos, fotos = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== null) f.append(k, String(v));
  fotos.forEach((b, i) => f.append('fotos', new Blob([b], { type: 'image/jpeg' }), `foto${i}.jpg`));
  return f;
};
let categoriaVias = null;
const base1 = (o = {}) => ({ cliente_uuid: uuid(), categoria_id: categoriaVias, descripcion: 'Hay un hueco grande frente a la escuela del barrio.', barrio_texto: 'Barrio Los Ejemplos', ...o });
async function registrar(u, o = {}, fotos = []) {
  const r = await pedir('POST', '/', { usuario: u, form: formDe(base1(o), fotos) });
  return r;
}
const idsDe = (r) => (r.datos && r.datos.solicitudes ? r.datos.solicitudes.map((s) => s.id).sort((a, b) => a - b) : null);

(async () => {
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
  console.log('SOLICITUDES CIUDADANAS — base «' + nombreBase + '»\n');

  /* =========================================================================================== 1. migración */
  console.log('[1] Migración: tablas, categorías, módulo apagado, política con la finalidad nueva');
  const tablas = (await q(`SELECT table_name t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'solicitud%'`)).map((f) => f.t).sort();
  ok(JSON.stringify(tablas) === JSON.stringify(['solicitud_categorias', 'solicitud_fotos', 'solicitud_historial', 'solicitudes']), 'las cuatro tablas existen', tablas);
  const columnas = (await q(`SELECT column_name c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'solicitudes'`)).map((f) => f.c);
  ok(!columnas.some((c) => /votante|cedula|apoya|intencion/i.test(c)), 'la tabla NO tiene vínculo con votantes: ni votante_id, ni cédula, ni apoya_a, ni intención de voto', columnas.filter((c) => /votante|cedula|apoya|intencion/i.test(c)));
  ok(['cliente_uuid', 'categoria_id', 'estado', 'territorio_id', 'barrio_texto', 'latitud', 'longitud', 'autoriza_datos', 'autoriza_fecha', 'politica_version', 'responsable_id', 'entidad_remitida', 'lider_id', 'sublider_id', 'rama_aspirante_id', 'aspirante_id', 'registrado_por'].every((c) => columnas.includes(c)), 'trae los campos de la orden');
  const estadoEnum = (await q(`SELECT column_type t FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'solicitudes' AND column_name = 'estado'`))[0].t;
  ok(estadoEnum === "enum('registrada','en_revision','remitida','cerrada')" && !/resuelta|cumplida/i.test(estadoEnum), 'los estados son registrada, en_revision, remitida y cerrada (nunca resuelta ni cumplida)', estadoEnum);
  const cats = await q('SELECT clave, nombre, ayuda, activa FROM solicitud_categorias ORDER BY orden');
  ok(cats.map((c) => c.clave).join() === 'vias,agua,luz,empleo,salud,educacion,seguridad,medio_ambiente,otras' && cats.every((c) => Number(c.activa) === 1), 'las nueve categorías de la orden, activas', cats.map((c) => c.clave));
  ok(/no escribas diagn/i.test(cats.find((c) => c.clave === 'salud').ayuda) && /denuncias con nombres/i.test(cats.find((c) => c.clave === 'seguridad').ayuda), 'salud y seguridad piden la necesidad: nada de diagnósticos ni denuncias con nombres');
  categoriaVias = cats.length ? (await q(`SELECT id FROM solicitud_categorias WHERE clave = 'vias'`))[0].id : null;
  const mod = await q(`SELECT rol, permitido FROM permisos_rol WHERE modulo = 'solicitudes'`);
  ok(mod.filter((m) => Number(m.permitido) === 1).map((m) => m.rol).join() === 'admin', 'el módulo «solicitudes» está en la matriz y de fábrica solo lo ve el administrador', mod);
  const [[cfg]] = await pool.query('SELECT anonimizar_solicitudes_meses m FROM configuracion_campana WHERE id = 1');
  ok(Number(cfg.m) === 6, 'anonimizar 6 meses después de la elección (por defecto)', cfg);
  const pol = (await q(`SELECT contenido FROM contenido_paginas WHERE clave = 'politica_privacidad'`))[0];
  const huella = require('../config/politicaVersiones').huellaDePolitica(pol.contenido);
  ok(/registrar y remitir necesidades del territorio/.test(pol.contenido), 'la política de privacidad tiene la finalidad «registrar y remitir necesidades del territorio»');
  ok(!/cargo|elecci|voto|candidat/i.test(pol.contenido.slice(pol.contenido.indexOf('Si usted nos cuenta una necesidad'), pol.contenido.indexOf('plazo que fije la campaña.'))), 'y el párrafo nuevo no habla de cargos, voto ni elección');
  ok((await q(`SELECT 1 FROM politica_versiones WHERE huella = ?`, [huella])).length === 1, 'la versión nueva quedó ARCHIVADA con su huella', huella);
  const raizEnv = { ...process.env };
  const corr = spawnSync(process.execPath, ['db/init-db.js'], { cwd: raiz, env: raizEnv, encoding: 'utf8' });
  for (const f of fs.readdirSync(raiz)) if (/^\.credenciales-.*\.txt$/.test(f)) fs.unlinkSync(path.join(raiz, f));
  const nCats = (await q('SELECT COUNT(*) n FROM solicitud_categorias'))[0].n;
  const polDespues = (await q(`SELECT contenido FROM contenido_paginas WHERE clave = 'politica_privacidad'`))[0].contenido;
  ok(corr.status === 0 && Number(nCats) === 9 && polDespues === pol.contenido && (polDespues.match(/registrar y remitir necesidades/g) || []).length === 1, 'otra corrida de init-db no duplica categorías ni vuelve a tocar la política');

  /* ====================================================================================== 2. la gente */
  const admin = { id: 1, rol: 'admin', nombre: 'Admin Prueba' };
  const c1 = await usuario('Coordinadora Uno', 'coordinador'), c2 = await usuario('Coordinador Dos', 'coordinador');
  const l1 = await usuario('Lider Uno', 'lider'), l2 = await usuario('Lider Dos', 'lider'), l3 = await usuario('Lider Tres', 'lider');
  const s1 = await usuario('Sublider Uno', 'sublider');
  const asp = await usuario('Aspirante Prueba', 'lider'), la = await usuario('Lider del Aspirante', 'lider');
  const testigo = await usuario('Testigo Prueba', 'testigo'), inactivo = await usuario('Lider Inactivo', 'lider', { activo: 0 });
  await estructura(c1, 'coordinador', null); await estructura(c2, 'coordinador', null);
  await estructura(l1, 'lider', c1); await estructura(l2, 'lider', c1); await estructura(l3, 'lider', c2);
  await estructura(s1, 'usuario', l1);
  await estructura(asp, 'lider', c1); await estructura(la, 'lider', asp);
  await pool.query(`INSERT INTO sublicencias (usuario_id, cargo, nombre, activa) VALUES (?, 'concejo', 'Aspirante Prueba', 1)`, [asp.id]);
  const U = (u) => u;

  /* ====================================================================================== 3. permisos */
  console.log('\n[2] Permisos EXIGIDOS en el servidor (Ver, Agregar, Editar)');
  ok((await pedir('GET', '/')).status === 401, 'sin sesión: 401');
  ok((await pedir('GET', '/', { usuario: l1 })).status === 403 && (await pedir('POST', '/', { usuario: l1, form: formDe(base1()) })).status === 403, 'un líder, con el módulo apagado (de fábrica): 403 al ver y al registrar');
  ok((await pedir('GET', '/', { usuario: admin })).status === 200, 'el administrador: 200');
  await permisos('lider', 1, 0, 0);
  ok((await pedir('GET', '/', { usuario: l1 })).status === 200, 'con «Ver», el líder ve la lista');
  const sinAgregar = await pedir('POST', '/', { usuario: l1, form: formDe(base1()) });
  ok(sinAgregar.status === 403 && /no registrarlas/.test(sinAgregar.datos.error), 'con «Ver» pero sin «Agregar», no puede registrar (403)');
  await permisos('lider', 1, 0, 1);
  const primero = await registrar(l1);
  ok(primero.status === 201 && primero.datos.id > 0, 'con «Agregar» sí registra (201)', primero.datos);
  const sinEditar = await pedir('PUT', `/${primero.datos.id}/estado`, { usuario: l1, json: { estado: 'en_revision' } });
  ok(sinEditar.status === 403 && /no cambiarlas/.test(sinEditar.datos.error), 'con «Agregar» pero sin «Editar», no cambia el estado (403)');
  ok((await pedir('PUT', `/${primero.datos.id}/responsable`, { usuario: l1, json: { responsable_id: l1.id } })).status === 403 && (await pedir('POST', `/${primero.datos.id}/notas`, { usuario: l1, json: { nota: 'hola' } })).status === 403, 'ni asignar ni anotar');
  ok((await pedir('POST', '/categorias', { usuario: l1, json: { nombre: 'Otra más' } })).status === 403 && (await pedir('PUT', '/config', { usuario: l1, json: { anonimizar_meses: 3 } })).status === 403, 'categorías y configuración: solo el administrador');
  ok((await pedir('GET', '/', { usuario: l1, aspirante: asp.id })).status === 403, 'un aspirante con sublicencia no llega al módulo (no está en lo que puede alcanzar): 403');
  await permisos('lider', 1, 1, 1); await permisos('sublider', 1, 0, 1); await permisos('coordinador', 1, 1, 1); await permisos('testigo', 1, 0, 0);

  /* ====================================================================================== 4. registro */
  console.log('\n[3] El registro: validaciones, idempotencia, anonimato, ubicación');
  const malo = async (o, texto) => { const r = await registrar(l1, o); ok(r.status === 400, texto, r.datos); return r; };
  await malo({ descripcion: 'corta' }, 'una descripción de menos de 10 letras se rechaza');
  await malo({ barrio_texto: '' }, 'sin barrio ni vereda se rechaza');
  await malo({ categoria_id: 99999 }, 'una categoría que no existe se rechaza');
  await malo({ cliente_uuid: 'no-es-un-uuid' }, 'sin identificador de registro válido se rechaza');
  const uuidFijo = uuid();
  const a1 = await registrar(l1, { cliente_uuid: uuidFijo }), a2 = await registrar(l1, { cliente_uuid: uuidFijo });
  ok(a1.status === 201 && a2.status === 200 && a2.datos.duplicado === true && a1.datos.id === a2.datos.id, 'el MISMO identificador no duplica: la segunda vez devuelve la misma solicitud (200, duplicado)', [a1.datos, a2.datos]);
  ok(Number((await q('SELECT COUNT(*) n FROM solicitudes WHERE cliente_uuid = ?', [uuidFijo]))[0].n) === 1, 'y hay UNA sola fila');
  const [d1, d2] = await Promise.all([registrar(l1, { cliente_uuid: uuid() }), registrar(l1, { cliente_uuid: uuid() })]);
  ok(d1.status === 201 && d2.status === 201 && d1.datos.id !== d2.datos.id, 'dos registros distintos a la vez quedan como dos');
  const fijo2 = uuid();
  const [e1, e2] = await Promise.all([registrar(l2, { cliente_uuid: fijo2 }), registrar(l2, { cliente_uuid: fijo2 })]);
  ok([e1.status, e2.status].sort().join() === '200,201' && e1.datos.id === e2.datos.id, 'el mismo identificador, a la vez desde dos conexiones: una crea y la otra recibe la misma', [e1.datos, e2.datos]);
  const ajeno = await registrar(l3, { cliente_uuid: uuidFijo });
  ok(ajeno.status === 409, 'el identificador de OTRA persona no se reutiliza (409)', ajeno.datos);
  // Anónima: llegan nombre y teléfono SIN autorización → se descartan.
  const anon = await registrar(l1, { ciudadano_nombre: 'Marta Prueba', ciudadano_telefono: '3001234567', autoriza_datos: '0' });
  const filaAnon = (await q('SELECT * FROM solicitudes WHERE id = ?', [anon.datos.id]))[0];
  ok(anon.status === 201 && filaAnon.ciudadano_nombre === null && filaAnon.ciudadano_telefono === null && Number(filaAnon.autoriza_datos) === 0 && filaAnon.autoriza_fecha === null, 'SIN autorización, nombre y teléfono se DESCARTAN aunque lleguen: la solicitud es anónima', filaAnon);
  const conAut = await registrar(l1, { ciudadano_nombre: 'Marta Prueba', ciudadano_telefono: '300 123 4567', autoriza_datos: '1' });
  const filaAut = (await q('SELECT * FROM solicitudes WHERE id = ?', [conAut.datos.id]))[0];
  ok(filaAut.ciudadano_nombre === 'Marta Prueba' && filaAut.ciudadano_telefono === '3001234567' && Number(filaAut.autoriza_datos) === 1 && filaAut.autoriza_fecha && /^[0-9a-f]{16}$/.test(filaAut.politica_version), 'con autorización se guardan nombre, teléfono (normalizado), fecha y la versión de la política', filaAut);
  ok(filaAut.politica_version === huella, 'la versión guardada es la HUELLA de la política vigente (la que tiene la finalidad)', filaAut.politica_version);
  const versionAjena = await registrar(l1, { ciudadano_nombre: 'Pedro Prueba', autoriza_datos: '1', politica_version: 'ffffffffffffffff' });
  ok((await q('SELECT politica_version v FROM solicitudes WHERE id = ?', [versionAjena.datos.id]))[0].v === huella, 'una versión de política que el servidor no tiene archivada no se acepta: queda la vigente');
  await malo({ autoriza_datos: '1' }, 'con autorización pero sin nombre ni teléfono se rechaza');
  await malo({ autoriza_datos: '1', ciudadano_telefono: '12345' }, 'un teléfono que no es un celular de 10 dígitos se rechaza');
  const cedula = await registrar(l1, { cedula: '1053123456', ciudadano_cedula: '1053123456', autoriza_datos: '1', ciudadano_nombre: 'Ana Prueba' });
  ok(cedula.status === 201 && !(await q('SELECT * FROM solicitudes WHERE id = ?', [cedula.datos.id])).some((f) => Object.values(f).some((v) => String(v) === '1053123456')), 'NUNCA cédula: si llega, no se guarda en ninguna parte');
  ok(!/telefono|nombre|ciudadano/.test(JSON.stringify(conAut.datos)), 'la respuesta de registrar no devuelve nombre ni teléfono del ciudadano', conAut.datos);
  const lejos = await registrar(l1, { latitud: '48.85', longitud: '2.35', precision_m: '10' });
  const filaLejos = (await q('SELECT latitud, longitud, precision_m FROM solicitudes WHERE id = ?', [lejos.datos.id]))[0];
  ok(lejos.status === 201 && filaLejos.latitud === null && filaLejos.longitud === null, 'una ubicación fuera de Colombia NO bloquea: se descarta y se guarda igual');
  const gps = await registrar(l1, { latitud: '5.0689', longitud: '-75.5174', precision_m: '12.4' });
  const filaGps = (await q('SELECT latitud, longitud, precision_m FROM solicitudes WHERE id = ?', [gps.datos.id]))[0];
  ok(gps.status === 201 && Number(filaGps.latitud) === 5.0689 && Number(filaGps.longitud) === -75.5174 && filaGps.precision_m === 12, 'con ubicación válida se guarda (con su precisión)', filaGps);
  const sinUbic = await registrar(l1, { latitud: 'abc', longitud: '' });
  ok(sinUbic.status === 201, 'una ubicación ilegible tampoco bloquea');
  const hist0 = await q(`SELECT tipo, estado_despues, usuario_id FROM solicitud_historial WHERE solicitud_id = ?`, [gps.datos.id]);
  ok(hist0.length === 1 && hist0[0].tipo === 'registro' && hist0[0].estado_despues === 'registrada' && hist0[0].usuario_id === l1.id, 'el historial arranca con el registro, quién y en qué estado');
  ok((await q(`SELECT 1 FROM auditoria WHERE accion = 'solicitud_registrar' AND entidad_id = ?`, [gps.datos.id])).length === 1 && !/Marta|3001234567/.test(JSON.stringify(await q(`SELECT detalle FROM auditoria WHERE accion = 'solicitud_registrar'`))), 'el registro queda en auditoría y sin datos del ciudadano');
  // Atribución para el alcance.
  const porSub = await registrar(s1, {});
  const filaSub = (await q('SELECT lider_id, sublider_id, rama_aspirante_id, registrado_por FROM solicitudes WHERE id = ?', [porSub.datos.id]))[0];
  ok(filaSub.lider_id === l1.id && filaSub.sublider_id === s1.id && filaSub.rama_aspirante_id === null, 'un sublíder registra con SU líder y con él mismo', filaSub);
  const porLa = await registrar(la, {});
  const filaLa = (await q('SELECT lider_id, rama_aspirante_id, aspirante_id FROM solicitudes WHERE id = ?', [porLa.datos.id]))[0];
  ok(filaLa.lider_id === la.id && filaLa.rama_aspirante_id === asp.id && filaLa.aspirante_id === asp.id, 'quien cuelga de un aspirante registra con la rama de ese aspirante', filaLa);

  /* ====================================================================================== 5. alcance */
  console.log('\n[4] El alcance: quién ve qué');
  await q('DELETE FROM solicitudes');   // se parte de cero para contar bien
  const sol = {};
  sol.l1 = (await registrar(l1)).datos.id; sol.s1 = (await registrar(s1)).datos.id; sol.l2 = (await registrar(l2)).datos.id; sol.l3 = (await registrar(l3)).datos.id;
  sol.c1 = (await registrar(c1)).datos.id; sol.adm = (await registrar(admin)).datos.id; sol.la = (await registrar(la)).datos.id; sol.t = (await registrar(testigo)).datos.id;
  // `testigo` no tiene «Agregar» (0): se registra por SQL, solo para comprobar su alcance.
  const orden = (...x) => x.sort((a, b) => a - b);
  const vista = async (u, o) => idsDe(await pedir('GET', '/?limite=100', { usuario: u, ...(o || {}) }));
  ok(JSON.stringify(await vista(l1)) === JSON.stringify(orden(sol.l1, sol.s1)), 'LÍDER 1: las suyas y las de su sublíder; no las de otro líder', await vista(l1));
  ok(JSON.stringify(await vista(s1)) === JSON.stringify(orden(sol.s1)), 'SUBLÍDER: solo la que él registró', await vista(s1));
  ok(JSON.stringify(await vista(l2)) === JSON.stringify(orden(sol.l2)), 'OTRO LÍDER: solo la suya (no ve las del líder 1)', await vista(l2));
  ok(JSON.stringify(await vista(c1)) === JSON.stringify(orden(sol.l1, sol.s1, sol.l2, sol.c1)), 'COORDINADOR 1: las suyas, las de sus líderes y las de los sublíderes de estos; NO las de otra coordinación ni la rama del aspirante', await vista(c1));
  ok(JSON.stringify(await vista(c2)) === JSON.stringify(orden(sol.l3)), 'COORDINADOR 2: solo las de su coordinación', await vista(c2));
  ok(JSON.stringify(await vista(admin)) === JSON.stringify(orden(sol.l1, sol.s1, sol.l2, sol.l3, sol.c1, sol.adm)), 'ADMINISTRADOR: toda la campaña madre, SIN la rama de un aspirante', await vista(admin));
  const rama = alcanceSolicitudes({ cargo: 'aspirante', usuarioId: asp.id });
  const deAsp = (await q(`SELECT s.id FROM solicitudes s WHERE ${rama.sql} ORDER BY s.id`, rama.valores)).map((f) => f.id);
  ok(JSON.stringify(deAsp) === JSON.stringify([sol.la]), 'ASPIRANTE (alcance de su rama): solo las de su rama', deAsp);
  const ramaOtro = alcanceSolicitudes({ cargo: 'aspirante', usuarioId: asp.id + 9999 });
  ok((await q(`SELECT s.id FROM solicitudes s WHERE ${ramaOtro.sql}`, ramaOtro.valores)).length === 0, 'otro aspirante no ve la rama de éste');
  ok(JSON.stringify(await vista(la)) === JSON.stringify(orden(sol.la)), 'quien cuelga del aspirante ve lo suyo (como un líder cualquiera)', await vista(la));
  ok(alcanceSolicitudes(null).sql === '1 = 0', 'sin alcance, a nadie');
  const t = await pedir('GET', '/?limite=100', { usuario: testigo });
  ok(t.status === 200 && idsDe(t).length === 0, 'un rol sin trabajo en campo (testigo) con el módulo abierto solo ve lo que él registró (nada)', idsDe(t));
  // El detalle de una ajena es un 404, igual que una que no existe: no se dice cuál.
  const ajena = await pedir('GET', `/${sol.l3}`, { usuario: l1 }), inexistente = await pedir('GET', '/9999999', { usuario: l1 });
  ok(ajena.status === 404 && inexistente.status === 404 && ajena.datos.error === inexistente.datos.error, 'el detalle de una solicitud ajena responde lo MISMO que una que no existe (404)', [ajena.datos, inexistente.datos]);
  ok((await pedir('PUT', `/${sol.l3}/estado`, { usuario: l1, json: { estado: 'en_revision' } })).status === 404 && (await pedir('POST', `/${sol.l3}/notas`, { usuario: l1, json: { nota: 'intruso' } })).status === 404, 'ni cambiar ni anotar una ajena');
  const dentro = await pedir('GET', `/${sol.s1}`, { usuario: l1 });
  ok(dentro.status === 200 && dentro.datos.registrada_por === 'Sublider Uno', 'el líder abre la de su sublíder y ve quién la registró');
  // «Me la asignaron».
  await pedir('PUT', `/${sol.l3}/responsable`, { usuario: admin, json: { responsable_id: l1.id } });
  ok((await vista(l1)).includes(sol.l3) && (await pedir('GET', `/${sol.l3}`, { usuario: l1 })).status === 200, 'una solicitud de OTRA coordinación se ve si te la asignaron');
  ok(!(await vista(c1)).includes(sol.l3), 'pero la asignación no se la abre a su coordinador');
  ok((await pedir('GET', '/?responsable=sin&limite=100', { usuario: admin })).datos.solicitudes.every((s) => s.responsable_id === null), 'filtro «sin responsable»');
  const mias = await pedir('GET', '/mias', { usuario: l1 });
  ok(idsDe(mias).join() === orden(sol.l1, sol.l3).join(), '«Mis solicitudes»: las que registró y las que le asignaron (no las de su sublíder)', idsDe(mias));
  await pedir('PUT', `/${sol.l3}/responsable`, { usuario: admin, json: { responsable_id: null } });

  /* ====================================================================================== 6. teléfono */
  console.log('\n[5] El teléfono del ciudadano: solo el administrador y el responsable');
  const conTel = (await registrar(l1, { ciudadano_nombre: 'Rosa Prueba', ciudadano_telefono: '3109876543', autoriza_datos: '1' })).datos.id;
  const ver = async (u) => (await pedir('GET', `/${conTel}`, { usuario: u })).datos;
  ok((await ver(admin)).ciudadano.telefono === '3109876543', 'el administrador VE el teléfono');
  const dl1 = await ver(l1);
  ok(dl1.ciudadano.telefono === null && dl1.ciudadano.tiene_telefono === true && dl1.ciudadano.nombre === 'Rosa Prueba' && !JSON.stringify(dl1).includes('3109876543'), 'el líder que la registró ve el nombre pero NO el teléfono (ni en ninguna parte de la respuesta)', dl1.ciudadano);
  ok(!JSON.stringify(await ver(c1)).includes('3109876543'), 'el coordinador, aunque ve la solicitud, tampoco');
  await pedir('PUT', `/${conTel}/responsable`, { usuario: admin, json: { responsable_id: l2.id } });
  const dl2 = await pedir('GET', `/${conTel}`, { usuario: l2 });
  ok(dl2.status === 200 && dl2.datos.ciudadano.telefono === '3109876543' && dl2.datos.puede_ver_telefono === true, 'el RESPONSABLE asignado ve el teléfono', dl2.datos && dl2.datos.ciudadano);
  ok(!JSON.stringify(await ver(l1)).includes('3109876543'), 'y el que la registró, sigue sin verlo');
  await pedir('PUT', `/${conTel}/responsable`, { usuario: admin, json: { responsable_id: l1.id } });
  ok((await ver(l1)).ciudadano.telefono === '3109876543' && !JSON.stringify(await pedir('GET', `/${conTel}`, { usuario: l2 })).includes('3109876543'), 'al reasignarla, el teléfono pasa al nuevo responsable y el anterior lo pierde');
  const lista = JSON.stringify((await pedir('GET', '/?limite=100', { usuario: admin })).datos) + JSON.stringify((await pedir('GET', '/mias', { usuario: l1 })).datos);
  ok(!lista.includes('3109876543') && !lista.includes('3001234567'), 'NINGUNA lista (ni la del administrador ni «Mis solicitudes») trae teléfonos');

  /* ====================================================================================== 7. estados */
  console.log('\n[6] Estados, responsable, notas e historial');
  const e = async (id, json, u = c1) => pedir('PUT', `/${id}/estado`, { usuario: u, json });
  ok((await e(sol.l1, { estado: 'resuelta' })).status === 400 && (await e(sol.l1, { estado: 'cumplida' })).status === 400, 'no existe el estado «resuelta» ni «cumplida»');
  ok((await e(sol.l1, { estado: 'registrada' })).status === 400, 'cambiar al mismo estado se rechaza');
  ok((await e(sol.l1, { estado: 'en_revision', nota: 'Se revisa con el equipo' })).status === 200, 'registrada → en revisión');
  const sinEntidad = await e(sol.l1, { estado: 'remitida' });
  ok(sinEntidad.status === 400 && /entidad/.test(sinEntidad.datos.error), 'remitida pide la entidad (400 sin ella)');
  ok((await e(sol.l1, { estado: 'remitida', entidad_remitida: 'Secretaría de Obras' })).status === 200, 'en revisión → remitida, con su entidad');
  const sinMotivo = await e(sol.l1, { estado: 'cerrada' });
  ok(sinMotivo.status === 400 && /motivo/.test(sinMotivo.datos.error), 'cerrada pide el motivo (400 sin él)');
  ok((await e(sol.l1, { estado: 'cerrada', nota: 'La entidad respondió por escrito' })).status === 200, 'remitida → cerrada, con su motivo');
  const cerrada = (await q('SELECT estado, entidad_remitida, cerrada_en, motivo_cierre FROM solicitudes WHERE id = ?', [sol.l1]))[0];
  ok(cerrada.estado === 'cerrada' && cerrada.entidad_remitida === 'Secretaría de Obras' && cerrada.cerrada_en && /respondió/.test(cerrada.motivo_cierre), 'quedan la entidad, la fecha y el motivo de cierre', cerrada);
  ok((await e(sol.l1, { estado: 'en_revision' })).status === 200 && (await q('SELECT cerrada_en FROM solicitudes WHERE id = ?', [sol.l1]))[0].cerrada_en === null, 'una cerrada se puede reabrir (y se borra la fecha de cierre)');
  const hist = (await pedir('GET', `/${sol.l1}`, { usuario: c1 })).datos.historial;
  ok(hist.map((h) => h.tipo + ':' + (h.estado_despues || '')).join() === 'registro:registrada,estado:en_revision,estado:remitida,estado:cerrada,estado:en_revision' && hist.every((h) => h.usuario_nombre), 'el historial cuenta cada paso, con quién y qué', hist.map((h) => h.tipo + ':' + h.estado_despues));
  ok(hist[2].entidad === 'Secretaría de Obras' && hist[1].nota === 'Se revisa con el equipo', 'y la entidad y la nota de cada uno');
  ok((await q(`SELECT COUNT(*) n FROM auditoria WHERE accion = 'solicitud_estado' AND entidad_id = ?`, [sol.l1]))[0].n === 4, 'cada cambio de estado queda en auditoría');
  // Responsable.
  const resp = async (id, rid, u = c1) => pedir('PUT', `/${id}/responsable`, { usuario: u, json: { responsable_id: rid } });
  ok((await resp(sol.l2, l2.id)).status === 200, 'el coordinador asigna a SU líder');
  ok((await resp(sol.l2, l3.id)).status === 400, 'pero no al líder de OTRA coordinación');
  ok((await resp(sol.l2, inactivo.id)).status === 400 && (await resp(sol.l2, testigo.id)).status === 400, 'ni a una cuenta inactiva ni a un testigo');
  ok((await resp(sol.l2, l3.id, admin)).status === 200, 'el administrador asigna a cualquiera');
  ok((await resp(sol.l2, l3.id, admin)).status === 400, 'asignar a quien ya es el responsable se rechaza');
  ok((await resp(sol.l2, null, admin)).status === 200 && (await q('SELECT responsable_id FROM solicitudes WHERE id = ?', [sol.l2]))[0].responsable_id === null, 'se puede quitar el responsable');
  const rs = (await pedir('GET', '/responsables', { usuario: c1 })).datos.responsables.map((x) => x.id).sort((a, b) => a - b);
  ok(rs.includes(c1.id) && rs.includes(l1.id) && rs.includes(l2.id) && rs.includes(s1.id) && !rs.includes(l3.id) && !rs.includes(testigo.id) && !rs.includes(inactivo.id), 'la lista de responsables del coordinador: él, sus líderes y sublíderes; no otros, ni testigos ni inactivos', rs);
  ok((await pedir('GET', '/responsables', { usuario: l1 })).datos.responsables.length === 0, 'un líder con «Editar» no puede asignar a nadie (lista vacía)');
  // Notas internas.
  await pedir('POST', `/${sol.l1}/notas`, { usuario: c1, json: { nota: 'Llamé a la secretaría y quedó de responder' } });
  ok((await pedir('GET', `/${sol.l1}`, { usuario: c1 })).datos.historial.some((h) => h.tipo === 'nota'), 'una nota interna la ve quien puede editar');
  await permisos('lider', 1, 0, 1);
  ok(!(await pedir('GET', `/${sol.l1}`, { usuario: l1 })).datos.historial.some((h) => h.tipo === 'nota'), 'pero quien solo registra (sin «Editar») NO ve las notas internas');
  await permisos('lider', 1, 1, 1);
  ok((await pedir('POST', `/${sol.l1}/notas`, { usuario: c1, json: { nota: 'x' } })).status === 400, 'una nota vacía se rechaza');

  /* ====================================================================================== 8. filtros */
  console.log('\n[7] Filtros de la lista');
  const agua = (await q(`SELECT id FROM solicitud_categorias WHERE clave = 'agua'`))[0].id;
  const fAgua = (await registrar(l1, { categoria_id: agua, barrio_texto: 'La Esperanza' })).datos.id;
  const porCat = await pedir('GET', `/?categoria=${agua}`, { usuario: admin });
  ok(idsDe(porCat).join() === String(fAgua), 'filtro por categoría', idsDe(porCat));
  ok(idsDe(await pedir('GET', '/?barrio=esperan', { usuario: admin })).join() === String(fAgua), 'filtro por barrio (parte del nombre)');
  ok((await pedir('GET', '/?estado=cerrada', { usuario: admin })).datos.solicitudes.length === 0 && (await pedir('GET', '/?estado=en_revision', { usuario: admin })).datos.solicitudes.some((s) => s.id === sol.l1), 'filtro por estado');
  await pedir('PUT', `/${fAgua}/responsable`, { usuario: admin, json: { responsable_id: l1.id } });
  ok(idsDe(await pedir('GET', `/?responsable=${l1.id}`, { usuario: admin })).includes(fAgua), 'filtro por responsable');
  const pag = await pedir('GET', '/?limite=2&pagina=2', { usuario: admin });
  ok(pag.datos.solicitudes.length === 2 && pag.datos.total > 4 && pag.datos.pagina === 2, 'paginación', [pag.datos.total, pag.datos.pagina]);
  ok(pag.datos.porEstado && pag.datos.porEstado.registrada > 0, 'y los totales por estado');

  /* ====================================================================================== 9. fotos */
  console.log('\n[8] Fotos: máximo 3, 1.280 px, sin EXIF, carpeta privada, ruta con alcance');
  const grande = async (con) => {
    let img = sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg({ quality: 90 });
    if (con) img = img.withExif({ IFD0: { Copyright: 'SECRETO-DEL-TELEFONO', Make: 'MarcaPrueba' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '5/1 4/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '75/1 31/1 0/1' } });
    return img.toBuffer();
  };
  const conExif = await grande(true);
  const metaEntrada = await sharp(conExif).metadata();
  ok(metaEntrada.exif && conExif.includes(Buffer.from('SECRETO-DEL-TELEFONO')) && metaEntrada.width === 3000, 'la foto de prueba trae EXIF (con ubicación) y mide 3000 px');
  const tres = await registrar(l1, {}, [conExif, conExif, await grande(false)]);
  ok(tres.status === 201 && tres.datos.fotos === 3, 'se registran 3 fotos', tres.datos);
  const filasFoto = await q('SELECT * FROM solicitud_fotos WHERE solicitud_id = ? ORDER BY orden', [tres.datos.id]);
  ok(filasFoto.length === 3 && filasFoto.map((f) => f.orden).join() === '1,2,3', 'quedan 3 filas, en orden');
  const carpeta = path.join(raiz, 'uploads', 'solicitudes');
  for (const f of filasFoto) {
    const archivo = path.join(carpeta, f.archivo);
    const buf = fs.readFileSync(archivo);
    const m = await sharp(buf).metadata();
    ok(/^sol_\d+_[0-9a-f]{12}\.jpg$/.test(f.archivo) && m.format === 'jpeg' && Math.max(m.width, m.height) === 1280 && f.ancho === m.width && f.alto === m.height, `la foto ${f.orden} es un JPEG de 1.280 px de lado mayor (${m.width}×${m.height})`, [f.archivo, m.width, m.height]);
    ok(!m.exif && !buf.includes(Buffer.from('SECRETO-DEL-TELEFONO')) && !buf.includes(Buffer.from('MarcaPrueba')) && !buf.includes(Buffer.from('Exif')), `la foto ${f.orden} NO trae EXIF: ni la ubicación ni el modelo del teléfono`);
    ok(buf.length < conExif.length, `y pesa menos que la original (${buf.length} de ${conExif.length})`);
  }
  ok(!fs.existsSync(path.join(raiz, 'uploads', filasFoto[0].archivo)), 'el archivo NO está en la raíz de uploads/ sino en uploads/solicitudes/');
  const { carpetaPrivadaDe } = require('../lib/carpetasPrivadas');
  ok(['/solicitudes/a.jpg', '//solicitudes/a.jpg', '/./solicitudes/a.jpg', '/Solicitudes/a.jpg', '/contenido/../solicitudes/a.jpg', '/%73olicitudes/a.jpg', '/solicitudes'].every((r) => carpetaPrivadaDe(r) === 'solicitudes'), '/uploads NO sirve uploads/solicitudes (también con //, /./, mayúsculas, /../ y %-escapes)');
  ok(carpetaPrivadaDe('/dia-d/x.jpg') === 'dia-d' && carpetaPrivadaDe('/marca/logo.png') === null && carpetaPrivadaDe('/%E0%A4%A') === 'ilegible', 'dia-d sigue cerrada, marca sigue abierta y una ruta ilegible se trata como privada');
  ok(/carpetaPrivadaDe\(req\.path\) === 'solicitudes'/.test(leer('app.js')) && /app\.use\('\/uploads', requireAuth, cerrarFotosDelDiaD/.test(leer('app.js')), 'app.js usa ese cierre en el montaje de /uploads');
  const foto = await pedir('GET', `/${tres.datos.id}/fotos/${filasFoto[0].id}`, { usuario: l1 });
  ok(foto.status === 200 && foto.tipo === 'image/jpeg' && foto.buffer.length > 1000, 'la foto sale por su ruta a quien la solicitud le es de su alcance (el líder que la registró)');
  ok((await pedir('GET', `/${tres.datos.id}/fotos/${filasFoto[0].id}`, { usuario: c1 })).status === 200, '…y a su coordinador');
  ok((await pedir('GET', `/${tres.datos.id}/fotos/${filasFoto[0].id}`, { usuario: l3 })).status === 404, '…pero NO a un líder de otra coordinación (404)');
  ok((await pedir('GET', `/${tres.datos.id}/fotos/${filasFoto[0].id}`)).status === 401, '…ni a nadie sin sesión (401)');
  ok((await pedir('GET', `/${tres.datos.id}/fotos/99999`, { usuario: l1 })).status === 404, 'una foto que no es de esa solicitud, 404');
  const cuatro = await registrar(l1, {}, [conExif, conExif, conExif, conExif]);
  ok(cuatro.status === 400 && /Máximo 3/.test(cuatro.datos.error), 'una CUARTA foto se rechaza (400)', cuatro.datos);
  const antes = (await q('SELECT COUNT(*) n FROM solicitudes'))[0].n;
  const noImagen = await pedir('POST', '/', { usuario: l1, form: (() => { const f = formDe(base1()); f.append('fotos', new Blob([Buffer.from('esto no es una imagen, es un texto')], { type: 'image/jpeg' }), 'x.jpg'); return f; })() });
  ok(noImagen.status === 400 && /no es una imagen/.test(noImagen.datos.error) && (await q('SELECT COUNT(*) n FROM solicitudes'))[0].n === antes, 'un archivo que no es imagen se rechaza (400) y NO deja la solicitud a medias');
  // Un registro con una foto buena y otra mala NO deja la buena huérfana en la carpeta.
  const listadoAntes = fs.readdirSync(carpeta).sort().join();
  const mixta = await pedir('POST', '/', { usuario: l1, form: (() => { const f = formDe(base1(), [conExif]); f.append('fotos', new Blob([Buffer.from('no es imagen')], { type: 'image/jpeg' }), 'x.jpg'); return f; })() });
  ok(mixta.status === 400 && fs.readdirSync(carpeta).sort().join() === listadoAntes, 'si una foto es mala, la buena de ese mismo registro tampoco queda guardada (ni huérfana en la carpeta)');
  const dupConFotos = await pedir('POST', '/', { usuario: l1, form: formDe(base1({ cliente_uuid: (await q('SELECT cliente_uuid u FROM solicitudes WHERE id = ?', [tres.datos.id]))[0].u }), [conExif]) });
  ok(dupConFotos.status === 200 && dupConFotos.datos.duplicado === true && dupConFotos.datos.fotos === 3 && (await q('SELECT COUNT(*) n FROM solicitud_fotos WHERE solicitud_id = ?', [tres.datos.id]))[0].n === 3, 'un reintento con las mismas fotos NO las duplica');
  const S = require('../lib/solicitudes');
  ok(S.rutaDeFoto('../../etc/passwd') === null && S.rutaDeFoto('sol_1_abcdef123456.jpg.php') === null && S.rutaDeFoto('x') === null, 'la ruta de una foto solo acepta los nombres que genera la aplicación');
  const detalle = (await pedir('GET', `/${tres.datos.id}`, { usuario: l1 })).datos;
  ok(detalle.fotos.length === 3 && detalle.fotos.every((f) => f.id && !('archivo' in f)), 'el detalle lista las fotos por id, sin el nombre del archivo');

  /* ====================================================================================== 10. categorías y config */
  console.log('\n[9] Categorías editables y configuración (solo el administrador)');
  const nueva = await pedir('POST', '/categorias', { usuario: admin, json: { nombre: 'Transporte público', ayuda: 'Cuenta la necesidad de la ruta.' } });
  ok(nueva.status === 200 && nueva.datos.id > 0, 'el administrador crea una categoría', nueva.datos);
  ok((await pedir('POST', '/categorias', { usuario: admin, json: { nombre: 'Transporte  público' } })).status === 409, 'una con el mismo nombre se rechaza (409)');
  ok((await pedir('PUT', `/categorias/${nueva.datos.id}`, { usuario: admin, json: { nombre: 'Transporte y movilidad' } })).status === 200, 'la renombra');
  ok((await pedir('GET', '/categorias', { usuario: l1 })).datos.categorias.some((c) => c.nombre === 'Transporte y movilidad'), 'el líder la ve entre las activas');
  await pedir('PUT', `/categorias/${nueva.datos.id}`, { usuario: admin, json: { activa: false } });
  ok(!(await pedir('GET', '/categorias', { usuario: l1 })).datos.categorias.some((c) => c.id === nueva.datos.id) && (await pedir('GET', '/categorias', { usuario: admin })).datos.categorias.some((c) => c.id === nueva.datos.id), 'desactivada, el líder ya no la ve y el administrador sí');
  ok((await registrar(l1, { categoria_id: nueva.datos.id })).status === 400, 'y no se puede registrar en una categoría desactivada');
  ok((await q(`SELECT COUNT(*) n FROM auditoria WHERE accion IN ('solicitud_categoria_crear','solicitud_categoria_editar')`))[0].n === 3, 'crear, renombrar y desactivar quedan en auditoría', await q(`SELECT accion, detalle FROM auditoria WHERE accion LIKE 'solicitud_categoria%'`));
  ok((await pedir('PUT', '/config', { usuario: admin, json: { anonimizar_meses: 0 } })).status === 400 && (await pedir('PUT', '/config', { usuario: admin, json: { anonimizar_meses: 'x' } })).status === 400, 'los meses de anonimización tienen que ser un entero de 1 a 120');
  ok((await pedir('PUT', '/config', { usuario: admin, json: { anonimizar_meses: 9 } })).status === 200 && (await pedir('GET', '/config', { usuario: admin })).datos.anonimizar_meses === 9, 'el administrador cambia los meses');
  ok((await q(`SELECT detalle FROM auditoria WHERE accion = 'solicitud_config'`))[0].detalle.includes('6 → 9'), 'y queda en auditoría (6 → 9)');
  await pedir('PUT', '/config', { usuario: admin, json: { anonimizar_meses: 6 } });

  /* ====================================================================================== 11. anonimizar */
  console.log('\n[10] Anonimizar una solicitud y el plazo después de la elección');
  const ant = await registrar(l1, { ciudadano_nombre: 'Luisa Prueba', ciudadano_telefono: '3151112233', autoriza_datos: '1' }, [await grande(false), await grande(false)]);
  const fotosAnt = await q('SELECT archivo FROM solicitud_fotos WHERE solicitud_id = ?', [ant.datos.id]);
  ok(fotosAnt.length === 2 && fotosAnt.every((f) => fs.existsSync(path.join(carpeta, f.archivo))), 'una solicitud con ciudadano y 2 fotos');
  ok((await pedir('POST', `/${ant.datos.id}/anonimizar`, { usuario: c1 })).status === 403, 'un coordinador (aunque pueda editar) no anonimiza: es del administrador');
  const an = await pedir('POST', `/${ant.datos.id}/anonimizar`, { usuario: admin });
  const despues = (await q('SELECT ciudadano_nombre, ciudadano_telefono, anonimizada_en, barrio_texto, categoria_id FROM solicitudes WHERE id = ?', [ant.datos.id]))[0];
  ok(an.status === 200 && an.datos.fotos === 2 && despues.ciudadano_nombre === null && despues.ciudadano_telefono === null && despues.anonimizada_en && despues.barrio_texto, 'se borran nombre y teléfono (queda el barrio y la categoría)', despues);
  ok((await q('SELECT COUNT(*) n FROM solicitud_fotos WHERE solicitud_id = ?', [ant.datos.id]))[0].n === 0 && fotosAnt.every((f) => !fs.existsSync(path.join(carpeta, f.archivo))), 'y las fotos: las filas y los ARCHIVOS');
  ok((await q(`SELECT 1 FROM solicitud_historial WHERE solicitud_id = ? AND tipo = 'anonimizada'`, [ant.datos.id])).length === 1 && (await q(`SELECT 1 FROM auditoria WHERE accion = 'solicitud_anonimizar' AND entidad_id = ?`, [ant.datos.id])).length === 1, 'queda en el historial y en auditoría');
  // El plazo.
  const SOL = require('../lib/solicitudes');
  await q('UPDATE configuracion_campana SET fecha_eleccion = NULL WHERE id = 1');
  let v = await SOL.anonimizarVencidas({ aplicar: true });
  ok(!v.aplicado && /fecha de elección/.test(v.motivo), 'sin fecha de elección no se anonimiza nada');
  await q('UPDATE configuracion_campana SET fecha_eleccion = DATE_ADD(CURDATE(), INTERVAL 10 DAY), anonimizar_solicitudes_meses = 6 WHERE id = 1');
  v = await SOL.anonimizarVencidas({ aplicar: true });
  ok(!v.aplicado && /Todavía no/.test(v.motivo) && v.anonimizadas === 0, 'con la elección en el futuro, todavía no');
  await q('UPDATE configuracion_campana SET fecha_eleccion = DATE_SUB(CURDATE(), INTERVAL 5 MONTH) WHERE id = 1');
  v = await SOL.anonimizarVencidas({ aplicar: true });
  ok(!v.aplicado && /Todavía no/.test(v.motivo), 'a los 5 meses de la elección, con plazo de 6, todavía no');
  const pend = await registrar(l1, { ciudadano_nombre: 'Julia Prueba', ciudadano_telefono: '3201112233', autoriza_datos: '1' }, [await grande(false)]);
  await q('UPDATE configuracion_campana SET fecha_eleccion = DATE_SUB(CURDATE(), INTERVAL 7 MONTH) WHERE id = 1');
  const sim = await SOL.anonimizarVencidas({ aplicar: false });
  ok(!sim.aplicado && sim.vencen >= 1 && (await q('SELECT ciudadano_nombre FROM solicitudes WHERE id = ?', [pend.datos.id]))[0].ciudadano_nombre === 'Julia Prueba', 'a los 7 meses, la simulación cuenta lo que vence y NO borra nada', sim);
  const cli = spawnSync(process.execPath, ['scripts/anonimizar-solicitudes.js'], { cwd: raiz, env: process.env, encoding: 'utf8' });
  ok(cli.status === 0 && /Simulación/.test(cli.stdout) && (await q('SELECT ciudadano_nombre FROM solicitudes WHERE id = ?', [pend.datos.id]))[0].ciudadano_nombre === 'Julia Prueba', 'el script, sin --aplicar, solo simula', cli.stdout.slice(0, 200));
  const cli2 = spawnSync(process.execPath, ['scripts/anonimizar-solicitudes.js', '--aplicar'], { cwd: raiz, env: process.env, encoding: 'utf8' });
  const hecho = (await q('SELECT ciudadano_nombre, ciudadano_telefono FROM solicitudes WHERE id = ?', [pend.datos.id]))[0];
  ok(cli2.status === 0 && hecho.ciudadano_nombre === null && hecho.ciudadano_telefono === null && (await q('SELECT COUNT(*) n FROM solicitud_fotos WHERE solicitud_id = ?', [pend.datos.id]))[0].n === 0, 'con --aplicar, pasado el plazo, borra nombre, teléfono y fotos', cli2.stdout.slice(0, 300));
  ok((await q('SELECT COUNT(*) n FROM solicitudes WHERE ciudadano_nombre IS NOT NULL OR ciudadano_telefono IS NOT NULL'))[0].n === 0, 'y ya no queda ningún dato de ciudadano en ninguna solicitud');
  const otra = await SOL.anonimizarVencidas({ aplicar: true });
  ok(otra.vencen === 0 && otra.anonimizadas === 0, 'una segunda corrida no hace nada');
  ok(fs.readdirSync(carpeta).every((a) => /^sol_\d+_[0-9a-f]{12}\.jpg$/.test(a)), 'en la carpeta de fotos no hay nada raro');
  await q('UPDATE configuracion_campana SET fecha_eleccion = NULL WHERE id = 1');

  /* ====================================================================================== 12. sin señal */
  console.log('\n[11] Sin señal: la cola de la PWA (el comportamiento real lo prueba probar-solicitudes-celular.js)');
  const off = leer('public/js/offline-utils.js');
  ok(/OFFLINE_DB_VERSION = [789];/.test(off) && /'solicitudes_pendientes'/.test(off), 'offline-utils.js: base en versión 7 (8 desde el parche 305, 9 desde el 307) y cajón «solicitudes_pendientes»');
  ok(!/OFFLINE_STORES_COPIA = \[[^\]]*solicitudes_pendientes/.test(off), 'es una COLA (de lo pendiente de subir), no una copia de lectura: no se borra al cambiar de cuenta');
  const sw = leer('public/service-worker.js');
  ok(/estrategia-v17[3-9]|estrategia-v1[89]\d/.test(sw) && sw.includes('/app/solicitud-nueva.html') && sw.includes('/app/mis-solicitudes.html'), 'el service worker precarga las dos pantallas nuevas y subió de versión');
  const nueva2 = leer('public/app/solicitud-nueva.html');
  ok(/guardarEnColaOffline\(/.test(nueva2) && /sincronizarCola\(/.test(nueva2) && /cliente_uuid/.test(nueva2) && /Blob|toBlob/.test(nueva2), 'el formulario guarda primero en la cola, con su identificador y las fotos como Blob, y sincroniza');
  ok(/navigator\.geolocation/.test(nueva2) && /(timeout|maximumAge)/.test(nueva2), 'la ubicación es opcional y con tiempo límite');
  ok(/\.length >= 3|MAX_FOTOS|máximo 3|Máximo 3/i.test(nueva2), 'el formulario limita a 3 fotos');
  ok(/solicitudes/.test(leer('public/app/inicio.html')), 'la tarjeta «Solicitudes» está en inicio.html');

  /* ====================================================================================== 13. textos */
  console.log('\n[12] Los textos: nada de cargos, voto, elección ni promesas');
  const PROHIBIDO = /\b(alcald\w*|concej\w*|gobernaci\w*|gobernador\w*|asamble\w*|senad\w*|edil\w*|vot\w*|elecci\w*|electoral\w*|urnas?|tarjet\w*|cargos?|resuelt[ao]s?|cumplid[ao]s?|solucionad[ao]s?|se compromet\w*|prometemos|garantizamos)\b/i;
  const sinMarcado = (html) => html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
  const cadenas = (js) => [...js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1').matchAll(/'([^'\n]{4,})'|"([^"\n]{4,})"|`([^`]{4,})`/g)].map((m) => m[1] || m[2] || m[3]);
  const guiones = (html) => [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const revisar = (archivo) => {
    const t = leer(archivo);
    const visibles = archivo.endsWith('.html') ? [sinMarcado(t), ...guiones(t).flatMap(cadenas)] : cadenas(t);
    return visibles.filter((x) => PROHIBIDO.test(x.replace(/^\s*(select|insert|update|from|where)\b[\s\S]*$/i, '')));
  };
  for (const a of ['public/solicitudes.html', 'public/app/solicitud-nueva.html', 'public/app/mis-solicitudes.html']) {
    if (!fs.existsSync(path.join(raiz, a))) { ok(false, `existe ${a}`); continue; }
    const mal = revisar(a);
    ok(mal.length === 0, `${a}: ningún texto menciona cargos, voto, elección ni promete`, mal.slice(0, 3));
  }
  const manual = leer('manuales/bloques/mod-solicitudes.md');
  ok(!PROHIBIDO.test(manual.replace(/^---[\s\S]*?---/, '')), 'la guía mod-solicitudes tampoco');
  const estadosTexto = Object.values(SOL.ETIQUETA_ESTADO).join(' ') + ' ' + cats.map((c) => c.nombre + ' ' + (c.ayuda || '')).join(' ');
  ok(!PROHIBIDO.test(estadosTexto), 'ni los estados ni las categorías de fábrica');
  const rutasTextos = leer('routes/solicitudes.routes.js') + leer('lib/solicitudes.js');
  ok(!/estado\s*[=:]\s*['"](resuelta|cumplida)/i.test(rutasTextos), 'ningún estado «resuelta» ni «cumplida» en el código');

  servidor.close();
  console.log(fallos ? `\n${fallos} comprobación(es) FALLARON.` : '\nTODO BIEN');
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });

