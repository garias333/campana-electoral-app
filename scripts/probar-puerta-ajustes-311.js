#!/usr/bin/env node
// scripts/probar-puerta-ajustes-311.js
//
// Prueba de los CINCO AJUSTES del puerta a puerta del parche 311, del lado del servidor y en un Chromium real:
//   1. EDITAR una lista cerrada o cancelada (nombre, quién visita, máximo de personas) y REACTIVARLA;
//   2. ELIMINAR (solo cerrada o cancelada, sin ninguna visita) y OCULTAR (con visitas) — solo el administrador, todo auditado;
//   3. la ZONA al armar es un desplegable del catálogo (antes, escribir «La Enea» terminaba en «—»);
//   4. el mensaje cuando no hay NADIE de partida («Este líder no tiene votantes en su alcance…»), y el desglose solo cuando sí hubo excluidos;
//   5. el enlace «Política de privacidad» en el menú del celular del administrador (/app/inicio.html).
//
// USO (sobre una base desechable ya inicializada con init-db; hace falta Chromium, ver scripts/capturas/navegador.js):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada311 node scripts/probar-puerta-ajustes-311.js
//
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) {
  console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`);
  process.exit(2);
}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
delete process.env.MAPBOX_ACCESS_TOKEN;
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const R = require('../public/js/puerta-reglas');
const { lanzar, espera } = require('./capturas/navegador');
const { crear } = require('./capturas/servidor');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }
const uuid = () => crypto.randomUUID();
const leer = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const hoyCol = () => R.colombiaDe(new Date()).fecha;
const inst = (dias, hhmm) => new Date(`${R.sumarDias(hoyCol(), -dias)}T${hhmm}:00-05:00`).toISOString();

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
app.use('/api/puerta-a-puerta', require('../routes/puertaAPuerta.routes'));
let base = '';
async function pedir(metodo, ruta, { json, usuario } = {}) {
  const h = { 'X-Forwarded-For': '198.51.100.9', 'User-Agent': 'prueba/1.0' };
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  const r = await fetch(base + '/api/puerta-a-puerta' + ruta, { method: metodo, headers: h, body });
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
  return { status: r.status, datos, texto };
}

const sello = String(Date.now()).slice(-7);
let n = 0, nv = 0;
async function usuario(nombre, rol) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, `95${sello}${n}`, `u95${sello}${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  return { id: r.insertId, rol, nombre };
}
async function estructura(u, cargo, supervisor) {
  await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, ?, 1)', [u.id, cargo, supervisor ? supervisor.id : null]);
}
async function permisos(rol, modulo, ver, editar, agregar) {
  await pool.query(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE permitido = VALUES(permitido), editar = VALUES(editar), agregar = VALUES(agregar)`, [rol, modulo, ver, editar, agregar]);
}
async function votante(o) {
  nv++;
  const [r] = await pool.query(
    `INSERT INTO votantes (nombre, cedula, telefono, email, direccion, latitud, longitud, territorio_id, lider_id, sublider_id, consentimiento_autorizado, no_visitar, apoya_a, observaciones, categoria)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'votante')`,
    [o.nombre, `94${sello}${String(nv).padStart(3, '0')}`, `3${sello}${nv}`.slice(0, 10), `w${sello}${nv}@secreto.test`, `Calle ${nv} # 2-${nv}`, 5.07 + nv * 0.001, -75.51 - nv * 0.001,
      o.zona || null, o.lider ? o.lider.id : null, o.sublider ? o.sublider.id : null, o.sinConsentimiento ? 0 : 1, o.noVisitar ? 1 : 0, JSON.stringify(['alcaldia']), 'obs']);
  return { id: r.insertId, nombre: o.nombre };
}
async function territorio(tipo, nombre, padre) {
  const [r] = await pool.query('INSERT INTO territorios (tipo, nombre, padre_id) VALUES (?, ?, ?)', [tipo, nombre, padre ? padre.id : null]);
  return { id: r.insertId, nombre };
}
const aud = (accion, id) => q('SELECT detalle FROM auditoria WHERE accion = ? AND entidad_id = ? ORDER BY id DESC', [accion, id]);
const items = (lista) => q('SELECT id, votante_id, estado, intentos FROM puerta_items WHERE lista_id = ? ORDER BY id', [lista]);
const estadoDe = async (lista) => (await q('SELECT estado, cerrada_en, oculta, nombre, asignada_a FROM puerta_listas WHERE id = ?', [lista]))[0];
async function armar(admin, lider, extra = {}) {
  const r = await pedir('POST', '/listas', { usuario: admin, json: { nombre: extra.nombre || 'Lista de prueba', asignada_a: lider.id, cliente_uuid: uuid(), ...extra.cuerpo } });
  return r;
}
/** Una lista insertada a mano (para armar situaciones que armar no produce): estado, quién visita y las fichas. */
async function listaDirecta(estado, lider, creadaPor, fichas, { cerradaHace } = {}) {
  const [r] = await pool.query(
    `INSERT INTO puerta_listas (nombre, asignada_a, creada_por, estado, aspirante_id, cerrada_en) VALUES (?, ?, ?, ?, 0, ${cerradaHace !== undefined ? 'DATE_SUB(NOW(), INTERVAL ? DAY)' : 'NULL'})`,
    cerradaHace !== undefined ? [`Directa ${estado}`, lider.id, creadaPor.id, estado, cerradaHace] : [`Directa ${estado}`, lider.id, creadaPor.id, estado]);
  for (const f of fichas) await pool.query('INSERT INTO puerta_items (lista_id, votante_id, estado, ultima_fecha, intentos) VALUES (?, ?, ?, ?, 0)', [r.insertId, f.v.id, f.estado || 'pendiente', f.fecha || null]);
  return r.insertId;
}

(async () => {
  let servidor, servidorWeb, navegador;
  try {
    servidor = http.createServer(app);
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${servidor.address().port}`;
    await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
    await q(`UPDATE configuracion_campana SET fecha_eleccion = NULL, puerta_franja_desde = '07:00', puerta_franja_hasta = '19:00' WHERE id = 1`);
    await q(`DELETE FROM permisos_rol WHERE modulo IN ('puerta_listas','puerta_visitas') AND rol <> 'admin'`);
    await permisos('coordinador', 'puerta_listas', 1, 1, 1);
    await permisos('lider', 'puerta_visitas', 1, 0, 1); await permisos('sublider', 'puerta_visitas', 1, 0, 1);

    const admin = await usuario('Admin Ajustes', 'admin');
    const coord = await usuario('Coordinador Ajustes', 'coordinador'); await estructura(coord, 'coordinador', null);
    const lid1 = await usuario('Líder Uno', 'lider'); await estructura(lid1, 'lider', coord);
    const lid2 = await usuario('Líder Dos', 'lider'); await estructura(lid2, 'lider', coord);
    const lid3 = await usuario('Líder Tres (otra rama)', 'lider'); await estructura(lid3, 'lider', null);
    const lidVacio = await usuario('Líder Vacío', 'lider'); await estructura(lidVacio, 'lider', coord);
    const lidSolo = await usuario('Líder Solo Sin Permiso', 'lider'); await estructura(lidSolo, 'lider', coord);
    const sub1 = await usuario('Sublíder Uno', 'sublider'); await estructura(sub1, 'usuario', lid1);
    const com = await territorio('comuna', `Comuna A ${sello}`);
    const b1 = await territorio('barrio', `Barrio Uno ${sello}`, com), b2 = await territorio('barrio', `Barrio Dos ${sello}`, com);

    const v = {};
    for (const [k, o] of Object.entries({
      v1: { lider: lid1, zona: b1.id }, v2: { lider: lid1, zona: b1.id }, v3: { lider: lid1, zona: b1.id },
      v4: { lider: lid1, sublider: sub1, zona: b2.id }, v5: { lider: lid1, sublider: sub1, zona: b2.id }, v6: { lider: lid1, zona: b2.id }, v7: { lider: lid1, zona: b2.id },
      g1: { lider: lid2, zona: b1.id }, g2: { lider: lid2, zona: b1.id }, g3: { lider: lid2, zona: b1.id }, g4: { lider: lid2, zona: b1.id }, g5: { lider: lid2, zona: b1.id },
      s1: { lider: lidSolo, zona: b1.id, sinConsentimiento: true },
    })) v[k] = await votante({ nombre: `Persona ${k}`, ...o });
    console.log('AJUSTES DEL PUERTA A PUERTA (311) — base «' + nombreBase + '»');

    /* ================================================================================ 1a. editar una lista */
    console.log('\n[1] EDITAR una lista cerrada o cancelada');
    const L1 = await armar(admin, lid1, { nombre: 'Lista editable' });
    ok(L1.status === 201 && L1.datos.personas === 7, 'armo la lista de Líder Uno con sus 7 personas', L1.datos);
    const idL1 = L1.datos.id;
    const it1 = await items(idL1);
    const itemDeV1 = it1.find((i) => i.votante_id === v.v1.id).id;
    const vis = await pedir('POST', '/visitas', { usuario: lid1, json: { cliente_uuid: uuid(), item_id: itemDeV1, resultado: 'no_abrio', marcado_en: inst(1, '10:00') } });
    ok(vis.status === 201, 'una puerta ya tiene una visita («no abrió»): lo que no se puede perder al sacarla de la lista', vis.datos);

    const sobreActiva = await pedir('PUT', `/listas/${idL1}`, { usuario: coord, json: { nombre: 'Otro nombre' } });
    ok(sobreActiva.status === 409 && /activa/.test(sobreActiva.datos.error) && /ciérrala o cancélala/.test(sobreActiva.datos.error), 'una lista ACTIVA no se edita: «ciérrala o cancélala primero»', sobreActiva.datos);
    ok((await pedir('POST', `/listas/${idL1}/reactivar`, { usuario: coord })).status === 409, 'ni se «reactiva» una que ya está activa');
    ok((await pedir('POST', `/listas/${idL1}/cancelar`, { usuario: admin })).status === 200, 'la cancelo');

    ok((await pedir('PUT', `/listas/${idL1}`, { usuario: lid1, json: { nombre: 'Intruso' } })).status === 403, 'un líder (sin el módulo de armar listas) no edita');
    ok((await pedir('PUT', `/listas/${idL1}`, { usuario: coord, json: {} })).status === 400, 'sin ningún cambio: «no hay nada que cambiar»');
    ok((await pedir('PUT', `/listas/${idL1}`, { usuario: coord, json: { nombre: 'x' } })).status === 400, 'el nombre pide al menos 3 letras');
    ok((await pedir('PUT', `/listas/${idL1}`, { usuario: coord, json: { max: 0 } })).status === 400 && (await pedir('PUT', `/listas/${idL1}`, { usuario: coord, json: { max: 301 } })).status === 400, 'el máximo va de 1 a 300');
    ok((await pedir('PUT', `/listas/${idL1}`, { usuario: coord, json: { asignada_a: lid3.id } })).status === 400, 'no se le puede pasar la lista a alguien que no es de su equipo');
    ok((await pedir('PUT', `/listas/99999999`, { usuario: coord, json: { nombre: 'Nada' } })).status === 404, 'una lista que no existe: 404');

    const cambioNombre = await pedir('PUT', `/listas/${idL1}`, { usuario: coord, json: { nombre: `  Lista   renombrada ${sello} ` } });
    ok(cambioNombre.status === 200 && (await estadoDe(idL1)).nombre === `Lista renombrada ${sello}` && cambioNombre.datos.retiradas === 0 && cambioNombre.datos.personas === 7, 'cambiar solo el nombre: queda limpio y nadie sale', cambioNombre.datos);
    const a1 = await aud('puerta_lista_editar', idL1);
    ok(a1.length === 1 && /nombre/.test(a1[0].detalle), 'queda en la auditoría', a1);

    // Cambiar quién visita: se vuelve a juzgar el alcance del NUEVO visitante.
    const aSub = await pedir('PUT', `/listas/${idL1}`, { usuario: coord, json: { asignada_a: sub1.id } });
    const despues = await items(idL1);
    ok(aSub.status === 200 && aSub.datos.retiradas === 5 && aSub.datos.personas === 3, 'pasarla al sublíder saca a las 5 que NO son de su alcance (quedan las 2 que él registró y la puerta con visita)', aSub.datos);
    ok(despues.filter((i) => i.estado === 'pendiente').map((i) => i.votante_id).sort().join() === [v.v4.id, v.v5.id].sort().join(), 'las que quedan por visitar son exactamente las del sublíder', despues);
    const suelta = despues.find((i) => i.id === itemDeV1);
    ok(suelta && suelta.votante_id === null && suelta.estado === 'agotada', 'la puerta que YA tenía una visita no se borra: se suelta de la persona y queda «sin respuesta»', suelta);
    ok((await q('SELECT COUNT(*) n FROM puerta_visitas WHERE lista_id = ?', [idL1]))[0].n === 1, 'y su visita sigue ahí (borrar la puerta se la habría llevado por la cascada)');
    ok((await estadoDe(idL1)).asignada_a === sub1.id && (await aud('puerta_lista_editar', idL1)).length === 2, 'la lista quedó asignada al sublíder y el cambio quedó auditado');

    // Máximo: subir trae más gente de la zona; bajar saca las últimas por visitar; no se puede bajar de lo que ya tiene resultado.
    const sube = await pedir('PUT', `/listas/${idL1}`, { usuario: coord, json: { asignada_a: lid1.id, max: 7 } });
    ok(sube.status === 200 && sube.datos.agregadas === 4 && sube.datos.personas === 7, 'pasarla de vuelta al líder y subir el máximo a 7 trae 4 personas más de su alcance (con las reglas de armar)', sube.datos);
    const idsAhora = (await items(idL1)).filter((i) => i.votante_id).map((i) => i.votante_id);
    ok(new Set(idsAhora).size === idsAhora.length, 'sin repetir a nadie dentro de la lista', idsAhora);
    const antesBaja = await items(idL1);
    const dosUltimas = antesBaja.filter((i) => i.estado === 'pendiente').slice(-2).map((i) => i.id);
    const baja = await pedir('PUT', `/listas/${idL1}`, { usuario: coord, json: { max: 5 } });
    const tras = await items(idL1);
    ok(baja.status === 200 && baja.datos.retiradas === 2 && tras.length === 5, 'bajar el máximo a 5 saca 2 de las que faltaban por visitar', baja.datos);
    ok(dosUltimas.length === 2 && tras.every((i) => !dosUltimas.includes(i.id)) && antesBaja.filter((i) => !dosUltimas.includes(i.id)).length === 5, 'y salen LAS ÚLTIMAS (las dos de id más alto), no cualquiera', { dosUltimas, quedan: tras.map((i) => i.id) });
    await q(`UPDATE puerta_items SET estado = 'cerrada' WHERE lista_id = ? AND estado = 'pendiente' ORDER BY id LIMIT 3`, [idL1]);
    const antes = (await items(idL1)).length;
    const muyBajo = await pedir('PUT', `/listas/${idL1}`, { usuario: coord, json: { max: 2 } });
    ok(muyBajo.status === 422 && /ya tienen un resultado/.test(muyBajo.datos.error) && (await items(idL1)).length === antes, 'no se puede bajar por debajo de lo que ya tiene resultado, y no se cambia NADA', muyBajo.datos);

    // Lo que no es suyo
    const ajena = await listaDirecta('cancelada', lid3, admin, [{ v: v.s1 }]);
    ok((await pedir('PUT', `/listas/${ajena}`, { usuario: coord, json: { nombre: 'De otra rama' } })).status === 404, 'la lista de alguien de otra rama: 404 para el coordinador');

    /* ======================================================================================== 1b. reactivar */
    console.log('\n[1b] REACTIVAR: vuelve a «activa» con las mismas reglas');
    const L2 = await armar(admin, lid2, { nombre: 'Lista a reactivar' });
    ok(L2.status === 201 && L2.datos.personas === 5, 'armo la lista de Líder Dos con 5 personas', L2.datos);
    const idL2 = L2.datos.id;
    await pedir('POST', `/listas/${idL2}/cancelar`, { usuario: admin });
    // Entre tanto: g1 pidió no volver, g2 retiró la autorización, g3 entró en OTRA lista activa, g4 se visitó hace poco en otra lista, g5 sigue bien.
    await q('UPDATE votantes SET no_visitar = 1, no_visitar_fecha = CURDATE() WHERE id = ?', [v.g1.id]);
    await q('UPDATE votantes SET consentimiento_autorizado = 0 WHERE id = ?', [v.g2.id]);
    const otra = await armar(admin, lid2, { nombre: 'Otra activa', cuerpo: { max: 1 } });
    ok(otra.status === 201 && otra.datos.personas === 1, 'preparo a g3 en OTRA lista activa (una lista activa por persona)', otra.datos);
    const enOtra = (await q('SELECT votante_id FROM puerta_items WHERE lista_id = ?', [otra.datos.id]))[0].votante_id;
    // El que arma toma al primero elegible por id: g3. Si fuera otro, se ajusta el resto de la preparación.
    ok(enOtra === v.g3.id, 'y es g3', enOtra);
    await listaDirecta('cerrada', lid1, admin, [{ v: v.g4, estado: 'cerrada', fecha: hoyCol() }]);

    const re = await pedir('POST', `/listas/${idL2}/reactivar`, { usuario: coord });
    ok(re.status === 200 && re.datos.pendientes === 1 && re.datos.retiradas === 4, 'reactivar deja SOLO a la que hoy cumple todo (g5) y saca a las otras 4', re.datos);
    const e2 = await estadoDe(idL2);
    ok(e2.estado === 'activa' && e2.cerrada_en === null, 'la lista vuelve a «activa» y sin fecha de cierre', e2);
    ok((await items(idL2)).length === 1 && (await items(idL2))[0].votante_id === v.g5.id, 'queda una sola puerta, la de g5', await items(idL2));
    const mias2 = await pedir('GET', '/mias', { usuario: lid2 });
    ok(mias2.status === 200 && mias2.datos.listas.some((l) => l.id === idL2 && l.items.length === 1 && l.items[0].nombre === 'Persona g5'), 'y el líder la vuelve a recibir en el celular', mias2.datos.listas && mias2.datos.listas.map((l) => l.id));
    const a2 = await aud('puerta_lista_reactivar', idL2);
    ok(a2.length === 1 && /4 que hoy no cumplen/.test(a2[0].detalle) && /estaba cancelada/.test(a2[0].detalle), 'queda en la auditoría, con cuántas salieron', a2);
    ok((await pedir('POST', `/listas/${idL2}/reactivar`, { usuario: coord })).status === 409, 'reactivar otra vez: 409 (ya está activa)');

    // Si no queda nadie por visitar, no se reactiva y no se toca nada.
    const sinNadie = await listaDirecta('cancelada', lid2, admin, [{ v: v.g1 }, { v: v.g2 }]);
    const rn = await pedir('POST', `/listas/${sinNadie}/reactivar`, { usuario: coord });
    ok(rn.status === 422 && /ninguna de las 2/.test(rn.datos.error) && (await estadoDe(sinNadie)).estado === 'cancelada' && (await items(sinNadie)).length === 2, 'si ninguna cumple, no se reactiva y no se saca a nadie', rn.datos);
    // Quien visitaba ya no está activo
    const desact = await listaDirecta('cancelada', lid2, admin, [{ v: v.g5 }]);
    await pedir('POST', `/listas/${idL2}/cancelar`, { usuario: admin });
    await q('UPDATE usuarios SET activo = 0 WHERE id = ?', [lid2.id]);
    const rd = await pedir('POST', `/listas/${desact}/reactivar`, { usuario: coord });
    ok(rd.status === 400 && (await estadoDe(desact)).estado === 'cancelada', 'si quien visitaba ya no está activo, no se reactiva (hay que pasársela a otra persona)', rd.datos);
    await q('UPDATE usuarios SET activo = 1 WHERE id = ?', [lid2.id]);
    ok((await pedir('POST', `/listas/${desact}/reactivar`, { usuario: lid1 })).status === 403, 'y un líder no reactiva');

    /* ============================================================================ 2. eliminar y ocultar */
    console.log('\n[2] ELIMINAR y OCULTAR (solo el administrador, todo auditado)');
    const sinVisitas = await listaDirecta('cancelada', lid1, admin, [{ v: v.v1 }, { v: v.v2 }]);
    ok((await pedir('DELETE', `/listas/${sinVisitas}`, { usuario: coord })).status === 403, 'el coordinador, aunque pueda editar, NO elimina');
    ok((await pedir('POST', `/listas/${sinVisitas}/ocultar`, { usuario: coord })).status === 403, 'ni oculta');
    const lst = await pedir('GET', '/listas', { usuario: admin });
    const fila = lst.datos.listas.find((l) => l.id === sinVisitas), filaVis = lst.datos.listas.find((l) => l.id === idL1);
    ok(fila && fila.eliminable === true && fila.visitas === 0 && filaVis && filaVis.eliminable === false && filaVis.visitas === 1, 'la lista dice si se puede eliminar (sin visitas) o solo ocultar (con visitas)', { fila, filaVis });
    const el = await pedir('DELETE', `/listas/${sinVisitas}`, { usuario: admin });
    ok(el.status === 200 && !(await q('SELECT 1 FROM puerta_listas WHERE id = ?', [sinVisitas])).length && !(await q('SELECT 1 FROM puerta_items WHERE lista_id = ?', [sinVisitas])).length, 'eliminar borra la lista y sus puertas');
    const ae = await aud('puerta_lista_eliminar', sinVisitas);
    ok(ae.length === 1 && /2 persona/.test(ae[0].detalle) && /ninguna visita/.test(ae[0].detalle), 'y queda auditado', ae);
    await pedir('POST', `/listas/${idL2}/reactivar`, { usuario: coord });
    const act = (await q(`SELECT id FROM puerta_listas WHERE estado = 'activa' LIMIT 1`))[0];
    ok(act && (await pedir('DELETE', `/listas/${act.id}`, { usuario: admin })).status === 409 && (await pedir('POST', `/listas/${act.id}/ocultar`, { usuario: admin })).status === 409, 'activa: ni eliminar ni ocultar (409)');

    const delConVisitas = await pedir('DELETE', `/listas/${idL1}`, { usuario: admin });
    ok(delConVisitas.status === 409 && /visita/.test(delConVisitas.datos.error) && /ocúltala/.test(delConVisitas.datos.error), 'con visitas NO se elimina: «ocúltala»', delConVisitas.datos);
    ok((await items(idL1)).length > 0 && (await q('SELECT COUNT(*) n FROM puerta_visitas WHERE lista_id = ?', [idL1]))[0].n === 1, 'y no se perdió nada (puertas y visita siguen)');

    // Una cerrada hace poco: un celular todavía puede subir lo que apuntó antes del cierre.
    const reciente = await listaDirecta('cerrada', lid1, admin, [{ v: v.v6 }], { cerradaHace: 1 });
    const filaR = (await pedir('GET', '/listas', { usuario: admin })).datos.listas.find((l) => l.id === reciente);
    const delReciente = await pedir('DELETE', `/listas/${reciente}`, { usuario: admin });
    ok(filaR.eliminable === false && delReciente.status === 409 && /menos de 7 días/.test(delReciente.datos.error), 'una cerrada hace menos de 7 días no se elimina (un celular puede traer visitas anotadas antes del cierre): se oculta', delReciente.datos);
    await q('UPDATE puerta_listas SET cerrada_en = DATE_SUB(NOW(), INTERVAL 8 DAY) WHERE id = ?', [reciente]);
    ok((await pedir('DELETE', `/listas/${reciente}`, { usuario: admin })).status === 200, 'pasados los 7 días sí');

    const oc = await pedir('POST', `/listas/${idL1}/ocultar`, { usuario: admin });
    ok(oc.status === 200 && (await estadoDe(idL1)).oculta === 1, 'ocultar una lista con visitas: marcada');
    const lstOc = await pedir('GET', '/listas', { usuario: admin });
    ok(!lstOc.datos.listas.some((l) => l.id === idL1), 'sale de la tabla');
    const lstVer = await pedir('GET', '/listas?ocultas=1', { usuario: admin });
    ok(lstVer.datos.listas.some((l) => l.id === idL1 && l.oculta === true && l.visitas === 1), 'con «Ver ocultas» vuelve a salir, marcada, con su visita', lstVer.datos.listas.map((l) => l.id));
    ok((await pedir('GET', '/listas', { usuario: coord })).datos.listas.every((l) => l.id !== idL1), 'el coordinador tampoco la ve en la tabla normal');
    ok((await pedir('PUT', `/listas/${idL1}`, { usuario: coord, json: { nombre: 'Oculta' } })).status === 409 && (await pedir('POST', `/listas/${idL1}/reactivar`, { usuario: coord })).status === 409, 'una oculta no se edita ni se reactiva (primero se muestra)');
    ok((await pedir('POST', `/listas/${idL1}/ocultar`, { usuario: admin })).status === 409, 'ocultar otra vez: 409');
    ok((await q('SELECT COUNT(*) n FROM puerta_visitas WHERE lista_id = ?', [idL1]))[0].n === 1, 'las visitas se conservan tal cual');
    ok((await aud('puerta_lista_ocultar', idL1)).length === 1, 'ocultar queda auditado');
    ok((await pedir('POST', `/listas/${idL1}/mostrar`, { usuario: coord })).status === 403, 'mostrar de nuevo es solo del administrador');
    ok((await pedir('POST', `/listas/${idL1}/mostrar`, { usuario: admin })).status === 200 && (await estadoDe(idL1)).oculta === 0 && (await pedir('POST', `/listas/${idL1}/mostrar`, { usuario: admin })).status === 409, 'mostrarla la devuelve a la tabla (y mostrar una que no está oculta: 409)');
    ok((await aud('puerta_lista_mostrar', idL1)).length === 1, 'y también queda auditado');

    /* ============================================================================= 4. el mensaje de lista vacía */
    console.log('\n[4] El mensaje cuando no hay lista que armar');
    const vacia = await armar(admin, lidVacio);
    ok(vacia.status === 422 && vacia.datos.error === 'Este líder no tiene votantes en su alcance.' && !('omitidas' in vacia.datos), 'sin nadie de partida: «Este líder no tiene votantes en su alcance.» y SIN desglose', vacia.datos);
    const vaciaZona = await armar(admin, lidVacio, { cuerpo: { territorio_id: b1.id } });
    ok(vaciaZona.status === 422 && vaciaZona.datos.error === 'Este líder no tiene votantes en su alcance para esa zona.' && !('omitidas' in vaciaZona.datos), 'con zona: «…en su alcance para esa zona.»', vaciaZona.datos);
    const zonaSinGente = await armar(admin, lid1, { cuerpo: { territorio_id: (await territorio('barrio', `Barrio Vacío ${sello}`, com)).id } });
    ok(zonaSinGente.status === 422 && zonaSinGente.datos.error === 'Este líder no tiene votantes en su alcance para esa zona.', 'un líder que sí tiene gente pero NO en esa zona recibe el mismo mensaje', zonaSinGente.datos);
    const soloExcluidos = await armar(admin, lidSolo);
    ok(soloExcluidos.status === 422 && /^Hay 1 persona\(s\) en su alcance, pero ninguna se puede visitar: 1 sin autorización\.$/.test(soloExcluidos.datos.error) && soloExcluidos.datos.omitidas && soloExcluidos.datos.omitidas.sin_autorizacion === 1,
      'si SÍ había personas excluidas: el desglose, con solo los motivos que pesaron (no una lista de ceros)', soloExcluidos.datos);
    ok(!/todas están/.test(soloExcluidos.datos.error), 'y se acabó la frase de «todas están sin autorización, sin dirección…»');

    /* ============================================================= 3 y 5. las pantallas, en un Chromium real */
    console.log('\n[3] La zona es un desplegable; [1][2] los botones; [5] el menú del celular — en un Chromium real');
    const html = leer('public/puerta-listas.html');
    ok(/<select id="a-zona"/.test(html) && !/datalist/.test(html), 'estático: la zona es un <select> (ya no un campo de texto con datalist)');
    const menuAdmin = leer('public/app/inicio.html').split('const MENU_ADMIN = [')[1].split('\n];')[0];
    ok(menuAdmin.includes("href: '/contenido.html?clave=politica_privacidad'") && menuAdmin.includes("titulo: 'Política de privacidad'"), 'estático: el menú del celular del administrador (MENU_ADMIN) trae el enlace a la política');
    ok(leer('public/app/inicio.html').split("href: '/contenido.html?clave=politica_privacidad'").length === 2, 'estático: el enlace está UNA sola vez en el archivo (solo en el menú del administrador)');

    // Para la prueba de la zona: «La Enea» existe como barrio Y como vereda (pasa de verdad en Manizales).
    const enea = await territorio('barrio', 'La Enea', com);
    const mpio = await territorio('municipio', `Municipio de prueba ${sello}`);
    const eneaV = await territorio('vereda', 'La Enea', mpio);
    const vEnea = await votante({ nombre: 'Persona de La Enea', lider: lid2, zona: enea.id });
    await q('UPDATE votantes SET no_visitar = 0, consentimiento_autorizado = 1 WHERE id IN (?, ?)', [v.g1.id, v.g2.id]);

    const web = crear(pool);
    servidorWeb = http.createServer(web);
    await new Promise((r) => servidorWeb.listen(0, '127.0.0.1', r));
    const urlWeb = `http://127.0.0.1:${servidorWeb.address().port}`;
    navegador = await lanzar();
    const p = await navegador.pagina('about:blank');
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await p.cmd('Network.clearBrowserCookies');
    const entrarComo = (id) => p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(id), url: urlWeb });
    const ir = async (ruta, ms = 2500) => { await p.cmd('Page.navigate', { url: urlWeb + ruta }); await espera(ms); };
    const clic = async (sel, ms = 1200) => { await p.ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await espera(ms); };
    const texto = (sel) => p.ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || null`);
    const filas = () => p.ev(`Array.from(document.querySelectorAll('#pp-listas tr')).map((tr) => ({ celdas: Array.from(tr.children).map((c) => c.textContent.replace(/\\s+/g, ' ').trim()),
      botones: Array.from(tr.querySelectorAll('button')).map((b) => b.textContent.trim()) }))`);
    const filaDe = async (nombre) => (await filas()).find((f) => f.celdas[0] && f.celdas[0].startsWith(nombre));

    await q(`DELETE FROM puerta_listas WHERE nombre LIKE 'Desde la pantalla%'`);
    await entrarComo(admin.id);
    await ir('/puerta-listas.html');
    const zonaSel = await p.ev(`(() => { const s = document.getElementById('a-zona'); return s && s.tagName === 'SELECT' ? { grupos: Array.from(s.querySelectorAll('optgroup')).map((g) => ({ titulo: g.label, opciones: Array.from(g.querySelectorAll('option')).map((o) => o.textContent.trim()) })), primera: s.options[0].textContent.trim() } : null; })()`);
    ok(zonaSel && zonaSel.primera === 'Todas sus personas', 'la zona es un desplegable y su primera opción es «Todas sus personas»', zonaSel);
    ok(zonaSel && zonaSel.grupos.some((g) => g.titulo === 'Barrios' && g.opciones.includes('La Enea')) && zonaSel.grupos.some((g) => g.titulo === 'Veredas' && g.opciones.includes('La Enea')),
      '«La Enea» aparece en Barrios y en Veredas, cada una en su grupo: se elige, no se escribe', zonaSel && zonaSel.grupos.map((g) => g.titulo));

    // Armar con «La Enea» (el barrio) desde la pantalla: la zona queda escrita en la tabla, no en «—».
    await p.ev(`document.getElementById('a-nombre').value = 'Desde la pantalla Enea'`);
    await p.ev(`(() => { const q = document.getElementById('a-quien'); q.value = '${lid2.id}'; })()`);
    await p.ev(`(() => { const s = document.getElementById('a-zona'); const o = Array.from(s.options).find((x) => x.value === '${enea.id}'); s.value = o.value; })()`);
    await clic('#a-armar', 1800);
    const msgArmar = await texto('#a-msg');
    ok(/Lista armada con 1 persona/.test(msgArmar), 'armar con la zona elegida: «Lista armada con 1 persona(s)»', msgArmar);
    const fEnea = await filaDe('Desde la pantalla Enea');
    ok(fEnea && fEnea.celdas[2] === 'La Enea' && fEnea.celdas[3] === 'Activa', 'y la tabla muestra la zona «La Enea» (no «—»)', fEnea);

    // El mensaje de lista vacía, en la pantalla.
    await p.ev(`document.getElementById('a-nombre').value = 'Desde la pantalla vacía'`);
    await p.ev(`document.getElementById('a-quien').value = '${lidVacio.id}'`);
    await p.ev(`document.getElementById('a-zona').value = ''`);
    await clic('#a-armar', 1500);
    ok((await texto('#a-msg')) === 'Este líder no tiene votantes en su alcance.', 'en pantalla: «Este líder no tiene votantes en su alcance.» (sin paréntesis de ceros)', await texto('#a-msg'));

    // Botones por estado: activa → Cerrar y Cancelar; cancelada → Editar, Reactivar, Eliminar (admin, sin visitas).
    ok(JSON.stringify(fEnea.botones) === JSON.stringify(['Cerrar', 'Cancelar']), 'activa: «Cerrar» y «Cancelar»', fEnea.botones);
    await clic('#pp-listas [data-accion="cancelar"][data-id="' + (await q(`SELECT id FROM puerta_listas WHERE nombre = 'Desde la pantalla Enea'`))[0].id + '"]');
    let f = await filaDe('Desde la pantalla Enea');
    ok(f && f.celdas[3] === 'Cancelada' && JSON.stringify(f.botones) === JSON.stringify(['Editar', 'Reactivar', 'Eliminar']), 'cancelada, sin visitas: «Editar», «Reactivar» y «Eliminar»', f);
    const idEnea = (await q(`SELECT id FROM puerta_listas WHERE nombre = 'Desde la pantalla Enea'`))[0].id;

    // Editar desde la pantalla.
    await clic(`[data-accion="editar"][data-id="${idEnea}"]`, 800);
    const dlg = await p.ev(`(() => { const d = document.getElementById('pp-editar'); return d ? { nombre: d.querySelector('#pe-nombre').value, quien: d.querySelector('#pe-quien').selectedOptions[0].textContent.trim(), max: d.querySelector('#pe-max').value } : null; })()`);
    ok(dlg && dlg.nombre === 'Desde la pantalla Enea' && /Líder Dos/.test(dlg.quien) && dlg.max === '1', 'el cuadro «Editar la lista» trae el nombre, quién visita y el máximo actuales', dlg);
    await p.ev(`document.getElementById('pe-nombre').value = 'Desde la pantalla renombrada'`);
    await clic('#pe-guardar', 1500);
    ok(!(await p.ev(`!!document.getElementById('pp-editar')`)) && /Lista actualizada: quedan 1 persona/.test(await texto('#l-msg')), 'guardar cierra el cuadro y avisa «Lista actualizada: quedan 1 persona(s)»', await texto('#l-msg'));
    ok(!!(await filaDe('Desde la pantalla renombrada')), 'y la tabla ya muestra el nombre nuevo');

    // Reactivar desde la pantalla, y volver a cancelar y ELIMINAR.
    await clic(`[data-accion="reactivar"][data-id="${idEnea}"]`, 1500);
    f = await filaDe('Desde la pantalla renombrada');
    ok(f && f.celdas[3] === 'Activa' && /Lista reactivada: 1 persona/.test(await texto('#l-msg')), '«Reactivar» la deja «Activa» y avisa cuántas hay por visitar', { f, msg: await texto('#l-msg') });
    await clic(`[data-accion="cancelar"][data-id="${idEnea}"]`);
    await clic(`[data-accion="eliminar"][data-id="${idEnea}"]`, 1500);
    ok(!(await filaDe('Desde la pantalla renombrada')) && (await texto('#l-msg')) === 'Lista eliminada.' && !(await q('SELECT 1 FROM puerta_listas WHERE id = ?', [idEnea])).length, '«Eliminar» la quita de la tabla y de la base');

    // La lista con visitas: «Ocultar» en vez de «Eliminar»; «Ver ocultas»; «Mostrar de nuevo».
    const fVis = await filaDe(`Lista renombrada ${sello}`);
    ok(fVis && fVis.botones.includes('Ocultar') && !fVis.botones.includes('Eliminar') && fVis.botones.includes('Editar') && fVis.botones.includes('Reactivar'), 'con visitas: «Ocultar» en vez de «Eliminar»', fVis);
    await clic(`[data-accion="ocultar"][data-id="${idL1}"]`, 1500);
    ok(!(await filaDe(`Lista renombrada ${sello}`)) && /Lista oculta/.test(await texto('#l-msg')), '«Ocultar» la quita de la tabla');
    await p.ev(`document.getElementById('l-ocultas').click()`); await espera(1500);
    const fOc = await filaDe(`Lista renombrada ${sello}`);
    ok(fOc && /Oculta/.test(fOc.celdas[3]) && JSON.stringify(fOc.botones) === JSON.stringify(['Mostrar de nuevo']), 'con «Ver ocultas» vuelve a salir, marcada «Oculta», solo con «Mostrar de nuevo»', fOc);
    await clic(`[data-accion="mostrar"][data-id="${idL1}"]`, 1500);
    await p.ev(`document.getElementById('l-ocultas').click()`); await espera(1200);
    ok(!!(await filaDe(`Lista renombrada ${sello}`)) && !(await filaDe(`Lista renombrada ${sello}`)).celdas[3].includes('Oculta'), '«Mostrar de nuevo» la devuelve a la tabla normal');

    // El coordinador: Editar y Reactivar, pero NO Eliminar ni Ocultar, ni «Ver ocultas».
    await entrarComo(coord.id);
    await ir('/puerta-listas.html');
    const fCoord = await filaDe(`Lista renombrada ${sello}`);
    ok(fCoord && JSON.stringify(fCoord.botones) === JSON.stringify(['Editar', 'Reactivar']), 'el coordinador ve «Editar» y «Reactivar», pero no «Eliminar» ni «Ocultar»', fCoord);
    ok(!(await p.ev(`getComputedStyle(document.getElementById('l-ocultas-etiqueta')).display !== 'none'`)), 'y no ve «Ver ocultas»');

    // El menú del celular del administrador.
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await entrarComo(admin.id);
    await ir('/app/inicio.html', 3500);
    const enlace = (rol) => p.ev(`(() => { const a = Array.from(document.querySelectorAll('#menu-app a')).find((x) => x.getAttribute('href') === '/contenido.html?clave=politica_privacidad'); return a ? a.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
    const eAdmin = await enlace();
    ok(eAdmin && /Política de privacidad/.test(eAdmin), 'el administrador ve «Política de privacidad» en el menú del celular, y lleva a la pantalla donde se edita', eAdmin);
    await entrarComo(coord.id); await ir('/app/inicio.html', 3500);
    const eCoord = await enlace();
    ok(!eCoord, 'el coordinador NO la ve (su menú trae la lectura, no la edición)', eCoord);
    await entrarComo(lid1.id); await ir('/app/inicio.html', 3500);
    ok(!(await enlace()), 'ni el líder');

    ok(!p.avisos.length, 'ninguna excepción de JavaScript en las pantallas', p.avisos);
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
