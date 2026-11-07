/**
 * TRANSPORTE DEL DÍA D, parte 1 (orden 33): vehículos, conductores y a quién recoge cada uno.
 *
 * LA DEMANDA YA EXISTÍA: `votantes.necesita_transporte` (la marca el líder desde «Faltan por votar» o la ficha).
 * Aquí está lo que se hace con ella. Una sola copia de las reglas para las dos puertas:
 *   · routes/transporteDiaD.routes.js  →  /api/dia-d/transporte   (la coordinación, con sesión y con el alcance de quien pregunta)
 *   · routes/transporte.routes.js      →  /t/<código>             (el conductor, SIN cuenta: entra con el código de su enlace)
 *
 * «LLEVADO AL PUESTO» NO ES «YA VOTÓ». Llegar al puesto no es votar —la persona puede no entrar, y el conductor no lo
 * puede verificar—, y la marca de «ya votó» (votante_votos) alimenta Faltantes, el ranking y la alerta de baja votación.
 * Aquí NUNCA se escribe en votante_votos. Al revés sí: si el votante (o el equipo) marca «ya votó», su parada se muestra
 * CERRADA en la lista del conductor.
 *
 * LOS ESTADOS DE UNA PARADA
 *     asignado ──recogido──▶ recogido ──llevado──▶ en_puesto        (terminal)
 *         └──────llevado────────────────────────────▲
 *         └──no_estaba──▶ no_estaba                                (terminal)
 *     cancelado: la coordinación la quitó (terminal; el votante vuelve a «sin asignar»)
 * Una marca sobre una parada terminal, o que no avanza, NO cambia nada y responde lo que hay: así un reintento desde la
 * cola sin señal es inocuo.
 */
'use strict';

const pool = require('../config/db');
const { condicionAlcanceVotantes, parametrosAlcanceVotantes } = require('./alcanceVotantes');
const { distanciaMetros } = require('./jornadaDiaD');
const { generarCodigo, normalizarCodigo, baseDelSitio } = require('../config/inscripcionEnlace');
const { coordenadasValidas } = require('../config/inscripcionRegistro');
const { primerNombre } = require('../config/inscripcionMensaje');
const { estadoDeLaElección } = require('../config/yaVotoEnlace');

const TIPOS_VEHICULO = ['carro', 'camioneta', 'van', 'bus', 'moto', 'otro'];
const ESTADOS = ['asignado', 'recogido', 'en_puesto', 'no_estaba', 'cancelado'];
/** Las que ocupan lugar en el vehículo (en el puesto o no estaba ya no). */
const ESTADOS_OCUPAN = ['asignado', 'recogido'];
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'di', 'van', 'von']);

// ---------------------------------------------------------------------------
// Pequeños ayudantes
// ---------------------------------------------------------------------------

/**
 * «Ana María Pérez Gómez» → «Ana P.»: el primer nombre y la inicial del apellido. La ficha guarda «nombres y apellidos»
 * en un solo campo, así que se supone la forma colombiana corriente: con tres palabras o más, el primer apellido es la
 * PENÚLTIMA («Ana María Pérez Gómez», «Juan Pérez Gómez»); con dos, la segunda. Las partículas («de», «del»…) no cuentan.
 */
function nombreCorto(nombre) {
  const p = String(nombre || '').trim().split(/\s+/).filter(w => w && !PARTICULAS.has(w.toLowerCase()));
  if (!p.length) return '';
  const cap = (w) => w.charAt(0).toLocaleUpperCase('es') + w.slice(1).toLocaleLowerCase('es');
  if (p.length === 1) return cap(p[0]);
  const apellido = p.length >= 3 ? p[p.length - 2] : p[p.length - 1];
  return `${cap(p[0])} ${Array.from(apellido)[0].toLocaleUpperCase('es')}.`;
}

/** El mensaje para mandarle su enlace al conductor. Sin el pie «Baja»: es un aviso operativo a alguien del equipo. */
function textoParaConductor(nombre, enlace) {
  const n = primerNombre(nombre);
  return `Hola ${n || 'conductor'}, esta es tu lista de recogida del día de elecciones: ${enlace}`;
}

function urlDelConductor(codigo, base = baseDelSitio()) {
  return `${String(base || '').replace(/\/+$/, '')}/t/${codigo}`;
}

/** Lo que se marcó (ISO del teléfono) como hora de Colombia «YYYY-MM-DD HH:MM:SS», o null si no es creíble (futuro o de hace más de 18 h). */
function aHoraColombia(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const ahora = Date.now();
  if (t > ahora + 5 * 60 * 1000 || t < ahora - 18 * 3600 * 1000) return null;
  return new Date(t - 5 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/** El día de trabajo de la coordinación: el de la elección; sin fecha configurada, hoy (para poder preparar y probar). */
async function fechaDeTrabajo(conexion = pool) {
  const [[f]] = await conexion.query(
    `SELECT DATE_FORMAT(COALESCE(fecha_eleccion, CURDATE()), '%Y-%m-%d') AS fecha, (fecha_eleccion IS NOT NULL) AS configurada
       FROM configuracion_campana WHERE id = 1`).catch(() => [[null]]);
  if (f) return { fecha: f.fecha, configurada: Number(f.configurada) === 1 };
  const [[h]] = await conexion.query(`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS fecha`);
  return { fecha: h.fecha, configurada: false };
}

// ---------------------------------------------------------------------------
// Ordenar paradas por cercanía (sin API de mapas: la distancia de lib/jornadaDiaD.js)
// ---------------------------------------------------------------------------

/**
 * El vecino más cercano: empieza en `inicio` ({lat, lon}) o, sin él, en la PRIMERA parada de la lista actual, y de ahí
 * va siempre a la parada pendiente más cercana. Las paradas sin coordenadas van al final, en el orden que ya tenían.
 * No es la ruta óptima —eso sería un problema de viajante— pero es predecible y sirve para una lista de pocas paradas.
 * @param {{id:number, lat:any, lon:any, orden:number}[]} paradas
 * @returns {number[]} los id en el orden nuevo
 */
function ordenarPorCercania(paradas, inicio = null) {
  const num = (x) => (x == null || x === '' ? null : Number(x));
  const todas = paradas.map(p => ({ id: p.id, orden: Number(p.orden) || 0, lat: num(p.lat), lon: num(p.lon) }))
    .sort((a, b) => a.orden - b.orden || a.id - b.id);
  const ok = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon);
  const con = todas.filter(ok), sin = todas.filter(p => !ok(p));
  const resultado = [];
  let actual = inicio && Number.isFinite(Number(inicio.lat)) && Number.isFinite(Number(inicio.lon))
    ? { lat: Number(inicio.lat), lon: Number(inicio.lon) } : null;
  const pendientes = con.slice();
  if (!actual && pendientes.length) {
    const primera = pendientes.shift();
    resultado.push(primera.id);
    actual = primera;
  }
  while (pendientes.length) {
    let mejor = 0, mejorD = Infinity;
    pendientes.forEach((p, i) => {
      const d = distanciaMetros(actual.lat, actual.lon, p.lat, p.lon);
      if (d < mejorD) { mejorD = d; mejor = i; }
    });
    const [elegida] = pendientes.splice(mejor, 1);
    resultado.push(elegida.id);
    actual = elegida;
  }
  return [...resultado, ...sin.map(p => p.id)];
}

// ---------------------------------------------------------------------------
// Vehículos y conductores
// ---------------------------------------------------------------------------

function validarVehiculo(b) {
  const placa = String((b && b.placa) || '').toUpperCase().replace(/\s+/g, '').trim();
  if (!/^[A-Z0-9-]{3,12}$/.test(placa)) return { error: 'La placa debe tener entre 3 y 12 letras o números.' };
  const tipo = TIPOS_VEHICULO.includes(b.tipo) ? b.tipo : 'carro';
  const capacidad = Number(b.capacidad);
  if (!Number.isInteger(capacidad) || capacidad < 1 || capacidad > 80) return { error: 'La capacidad debe ser un número de personas entre 1 y 80.' };
  const descripcion = String(b.descripcion || '').replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, 150) || null;
  return { valores: { placa, tipo, capacidad, descripcion } };
}

function validarConductor(b) {
  const nombre = String((b && b.nombre) || '').replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (nombre.length < 2 || nombre.length > 120) return { error: 'Escribe el nombre del conductor.' };
  const digitos = String((b && b.celular) || '').replace(/\D/g, '');
  const celular = digitos ? (digitos.length === 12 && digitos.startsWith('57') ? digitos.slice(2) : digitos) : null;
  if (celular && !/^3\d{9}$/.test(celular)) return { error: 'El celular debe tener 10 dígitos y empezar por 3.' };
  return { valores: { nombre, celular } };
}

/** Un código que no choca con otro (el índice UNIQUE decide; se reintenta). */
async function codigoNuevo(conexion = pool) {
  for (let i = 0; i < 12; i++) {
    const c = generarCodigo();
    const [[ya]] = await conexion.query('SELECT 1 AS x FROM transporte_conductores WHERE codigo = ?', [c]);
    if (!ya) return c;
  }
  throw new Error('No se pudo generar un código nuevo.');
}

/** El conductor de un código SI ESTÁ VIVO (activo y hoy es el día de la elección); si no, null. Inexistente, inactivo y fuera de fecha dan LO MISMO. */
async function conductorVigente(codigoCrudo, conexion = pool) {
  const codigo = normalizarCodigo(codigoCrudo);
  if (!codigo) return null;
  const [[c]] = await conexion.query(
    `SELECT c.id, c.aspirante_id, c.nombre, c.celular, c.vehiculo_id, c.codigo, v.placa, v.capacidad, v.tipo
       FROM transporte_conductores c LEFT JOIN transporte_vehiculos v ON v.id = c.vehiculo_id
      WHERE c.codigo = ? AND c.activo = 1 LIMIT 1`, [codigo]);
  if (!c) return null;
  const e = await estadoDeLaElección(conexion);
  if (!e.fecha || !e.esHoy) return null;
  return { ...c, fecha: e.fecha };
}

/** Cuántas personas lleva un conductor hoy (paradas que ocupan lugar). */
async function ocupacionDe(conductorId, fecha, conexion = pool) {
  const [[o]] = await conexion.query(
    `SELECT COALESCE(SUM(personas), 0) AS n FROM transporte_asignaciones
      WHERE conductor_id = ? AND fecha = ? AND estado IN (?)`, [conductorId, fecha, ESTADOS_OCUPAN]);
  return Number(o.n);
}

// ---------------------------------------------------------------------------
// Demanda y contador, con el alcance de quien pregunta
// ---------------------------------------------------------------------------

function alcanceSql(req) {
  return { sql: condicionAlcanceVotantes(req.alcance, 'v'), valores: parametrosAlcanceVotantes(req.alcance) };
}

const TOPE_DEMANDA = 3000;

/**
 * Los votantes que necesitan transporte (dentro del alcance), con el estado de su asignación.
 * filtro: 'todos' | 'sin_asignar' | 'asignados'; conductorId acota a uno; `incluirVotaron` trae también a los que ya votaron.
 */
async function demanda(req, dueno, fecha, { filtro = 'todos', conductorId = null, incluirVotaron = false } = {}) {
  const a = alcanceSql(req);
  const cond = ['v.necesita_transporte = 1', a.sql];
  const params = [fecha, dueno, ...a.valores];
  if (!incluirVotaron) cond.push('vv.votante_id IS NULL');
  if (filtro === 'sin_asignar') cond.push("(a.id IS NULL OR a.estado = 'cancelado')");
  if (filtro === 'asignados') cond.push("(a.id IS NOT NULL AND a.estado <> 'cancelado')");
  if (conductorId) { cond.push('a.conductor_id = ?'); params.push(conductorId); }
  const [filas] = await pool.query(
    `SELECT v.id, v.nombre, v.telefono, v.direccion,
            COALESCE(NULLIF(TRIM(v.barrio_residencia), ''), '') AS barrio,
            v.puesto_id, v.puesto_votacion, v.mesa_votacion, v.latitud, v.longitud,
            (vv.votante_id IS NOT NULL) AS ya_voto,
            a.id AS asignacion_id, a.estado, a.conductor_id, c.nombre AS conductor, a.personas, a.nota, a.orden
       FROM votantes v
       LEFT JOIN votante_votos vv ON vv.votante_id = v.id
       LEFT JOIN transporte_asignaciones a ON a.votante_id = v.id AND a.fecha = ? AND a.aspirante_id = ?
       LEFT JOIN transporte_conductores c ON c.id = a.conductor_id
      WHERE ${cond.join(' AND ')}
      ORDER BY COALESCE(NULLIF(TRIM(v.puesto_votacion), ''), '~'), COALESCE(NULLIF(TRIM(v.barrio_residencia), ''), '~'), v.nombre
      LIMIT ${TOPE_DEMANDA + 1}`, params);
  const truncado = filas.length > TOPE_DEMANDA;
  if (truncado) filas.pop();
  return {
    truncado,
    votantes: filas.map(f => ({
      id: f.id, nombre: f.nombre, telefono: f.telefono || '', direccion: f.direccion || '', barrio: f.barrio,
      puesto: (f.puesto_votacion || '').trim() || 'Sin puesto registrado', puesto_id: f.puesto_id, mesa: f.mesa_votacion,
      latitud: f.latitud == null ? null : Number(f.latitud), longitud: f.longitud == null ? null : Number(f.longitud),
      ya_voto: Number(f.ya_voto) === 1,
      // Una parada cancelada es como si no existiera: vuelve a «sin asignar».
      asignacion_id: f.estado && f.estado !== 'cancelado' ? f.asignacion_id : null,
      estado: f.estado && f.estado !== 'cancelado' ? f.estado : null,
      conductor_id: f.estado && f.estado !== 'cancelado' ? f.conductor_id : null,
      conductor: f.estado && f.estado !== 'cancelado' ? f.conductor : null,
      personas: f.estado && f.estado !== 'cancelado' ? f.personas : 1,
      nota: f.estado && f.estado !== 'cancelado' ? f.nota : null,
      orden: f.estado && f.estado !== 'cancelado' ? f.orden : null,
    })),
  };
}

/**
 * EL CONTADOR del cuadro del Día D, con el alcance de quien pregunta.
 *   necesitan    los marcados «necesita transporte» dentro de su alcance
 *   asignados    con conductor y todavía sin recoger
 *   recogidos    ya subieron al vehículo
 *   en_puesto    llevados al puesto
 *   no_estaban   el conductor llegó y no estaban
 *   sin_recoger  esperan transporte: marcados, sin «ya votó» y sin recoger (sin conductor o con conductor que no ha llegado)
 */
async function resumen(req, dueno, fecha) {
  const a = alcanceSql(req);
  const [[d]] = await pool.query(
    `SELECT COUNT(*) AS necesitan,
            COALESCE(SUM(vv.votante_id IS NULL AND (x.id IS NULL OR x.estado IN ('asignado', 'cancelado'))), 0) AS sin_recoger
       FROM votantes v
       LEFT JOIN votante_votos vv ON vv.votante_id = v.id
       LEFT JOIN transporte_asignaciones x ON x.votante_id = v.id AND x.fecha = ? AND x.aspirante_id = ?
      WHERE v.necesita_transporte = 1 AND ${a.sql}`, [fecha, dueno, ...a.valores]);
  const [porEstado] = await pool.query(
    `SELECT x.estado, COUNT(*) AS n FROM transporte_asignaciones x JOIN votantes v ON v.id = x.votante_id
      WHERE x.fecha = ? AND x.aspirante_id = ? AND ${a.sql} GROUP BY x.estado`, [fecha, dueno, ...a.valores]);
  const n = Object.fromEntries(porEstado.map(r => [r.estado, Number(r.n)]));
  return {
    fecha, necesitan: Number(d.necesitan), sin_recoger: Number(d.sin_recoger),
    asignados: n.asignado || 0, recogidos: n.recogido || 0, en_puesto: n.en_puesto || 0, no_estaban: n.no_estaba || 0,
  };
}

// ---------------------------------------------------------------------------
// La lista del conductor y sus marcas
// ---------------------------------------------------------------------------

/**
 * Las paradas de UN conductor para ese día, en su orden, listas para su pantalla. Lo que NO viaja de una parada ya
 * cerrada (llevado, no estaba, o ya votó): dirección, barrio, teléfono ni coordenadas.
 */
async function listaDelConductor(conductor, conexion = pool) {
  const [filas] = await conexion.query(
    `SELECT a.id, a.estado, a.orden, a.personas, a.nota, a.recogido_en, a.llevado_en,
            v.nombre, v.telefono, v.direccion, v.barrio_residencia AS barrio, v.latitud, v.longitud,
            v.puesto_id, v.puesto_votacion, v.mesa_votacion, (vv.votante_id IS NOT NULL) AS ya_voto
       FROM transporte_asignaciones a
       JOIN votantes v ON v.id = a.votante_id
       LEFT JOIN votante_votos vv ON vv.votante_id = v.id
      WHERE a.conductor_id = ? AND a.fecha = ? AND a.estado <> 'cancelado'
      ORDER BY a.orden, a.id`, [conductor.id, conductor.fecha]);
  const ubicacionDelPuesto = require('../routes/checkinDiaD.routes').ubicacionDelPuesto;
  const cachePuestos = new Map();
  const puestoCoord = async (id) => {
    if (!id) return null;
    if (!cachePuestos.has(id)) cachePuestos.set(id, await ubicacionDelPuesto(conexion, id));
    return cachePuestos.get(id);
  };
  const paradas = [];
  for (const f of filas) {
    const cerrada = ['en_puesto', 'no_estaba'].includes(f.estado) || Number(f.ya_voto) === 1;
    const base = {
      id: f.id, nombre: nombreCorto(f.nombre), estado: f.estado, orden: f.orden,
      cerrada, ya_voto: Number(f.ya_voto) === 1,
      hora: f.llevado_en ? String(f.llevado_en).slice(11, 16) : (f.recogido_en ? String(f.recogido_en).slice(11, 16) : null),
    };
    if (cerrada) { paradas.push(base); continue; }
    const pc = await puestoCoord(f.puesto_id);
    paradas.push({
      ...base,
      personas: f.personas, nota: f.nota || '', direccion: f.direccion || '', barrio: f.barrio || '',
      tel: String(f.telefono || '').replace(/\D/g, '') || null,
      latitud: f.latitud == null ? null : Number(f.latitud), longitud: f.longitud == null ? null : Number(f.longitud),
      puesto: (f.puesto_votacion || '').trim(), mesa: f.mesa_votacion || null,
      puesto_latitud: pc ? pc.lat : null, puesto_longitud: pc ? pc.lon : null,
    });
  }
  return paradas;
}

/**
 * Una marca del conductor. `accion`: 'recogido' | 'llevado' | 'no_estaba'. Idempotente: el mismo `clienteUuid` (o una marca
 * que no hace avanzar el estado) no cambia nada y responde el estado que hay. Devuelve { encontrada, aplicada, estado }.
 */
async function marcar(conductor, asignacionId, accion, { clienteUuid = null, marcadoEn = null, latitud = null, longitud = null } = {}) {
  const destino = { recogido: 'recogido', llevado: 'en_puesto', no_estaba: 'no_estaba' }[accion];
  if (!destino) return { encontrada: false };
  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    const [[f]] = await cx.query(
      `SELECT a.id, a.estado, a.cliente_uuid, (vv.votante_id IS NOT NULL) AS ya_voto
         FROM transporte_asignaciones a LEFT JOIN votante_votos vv ON vv.votante_id = a.votante_id
        WHERE a.id = ? AND a.conductor_id = ? AND a.fecha = ? AND a.estado <> 'cancelado' FOR UPDATE`,
      [asignacionId, conductor.id, conductor.fecha]);
    if (!f) { await cx.rollback(); return { encontrada: false }; }
    const uuid = clienteUuid ? String(clienteUuid).slice(0, 64) : null;
    let aplicada = false;
    const puede = {
      recogido: ['asignado'],
      en_puesto: ['asignado', 'recogido'],
      no_estaba: ['asignado'],
    }[destino];
    const repetida = uuid && f.cliente_uuid === uuid;
    if (!repetida && puede.includes(f.estado) && Number(f.ya_voto) !== 1) {
      const c = coordenadasValidas(latitud, longitud);
      const hora = aHoraColombia(marcadoEn);
      const sets = ['estado = ?', 'cliente_uuid = ?', 'latitud = ?', 'longitud = ?'];
      const vals = [destino, uuid, c ? c.latitud : null, c ? c.longitud : null];
      if (destino === 'recogido') { sets.push('recogido_en = COALESCE(?, NOW())'); vals.push(hora); }
      if (destino === 'en_puesto') { sets.push('llevado_en = COALESCE(?, NOW())'); vals.push(hora); }
      await cx.query(`UPDATE transporte_asignaciones SET ${sets.join(', ')} WHERE id = ?`, [...vals, f.id]);
      aplicada = true;
    }
    const [[ahora]] = await cx.query('SELECT estado FROM transporte_asignaciones WHERE id = ?', [f.id]);
    await cx.commit();
    return { encontrada: true, aplicada, estado: ahora.estado };
  } catch (err) {
    try { await cx.rollback(); } catch (_) { /* conexión ya cerrada */ }
    throw err;
  } finally {
    cx.release();
  }
}

module.exports = {
  TIPOS_VEHICULO, ESTADOS, ESTADOS_OCUPAN,
  nombreCorto, textoParaConductor, urlDelConductor, aHoraColombia, fechaDeTrabajo,
  ordenarPorCercania, validarVehiculo, validarConductor, codigoNuevo, conductorVigente, ocupacionDe,
  demanda, resumen, listaDelConductor, marcar,
};
