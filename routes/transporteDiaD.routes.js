/**
 * Transporte del Día D — la puerta de LA COORDINACIÓN (orden 33). Montado en /api/dia-d/transporte.
 *
 * Con sesión, con el módulo `transporte_dia_d` (de fábrica admin y coordinador; el aspirante por PERMISOS_ASPIRANTE; el
 * administrador puede abrírselo a otro rol desde «Asignación de permisos»). Todo lo que lee de votantes va acotado por el
 * MISMO alcance del listado (`req.alcance`), y los vehículos, conductores y paradas son de la campaña de quien pregunta
 * (`aspirante_id`, 0 = la madre). Las reglas viven en lib/transporteDiaD.js; la otra puerta, la del conductor, es /t.
 *
 * LA DEMANDA es `votantes.necesita_transporte`, que sigue marcando el líder con `rescate_votos`. Aquí no se marca ni se
 * desmarca: se asigna.
 */
'use strict';

const express = require('express');
const pool = require('../config/db');
const { calcularAlcance, requireAuth } = require('../middleware/auth');
const { requiereVerModulo } = require('../middleware/permisoModulo');
const { requiereComplemento } = require('../middleware/complemento');
const { registrarAuditoria } = require('../config/auditoria');
const { duenoDeLaCampana } = require('../lib/ramas');
const { baseDelSitio } = require('../config/inscripcionEnlace');
const { condicionAlcanceVotantes, parametrosAlcanceVotantes } = require('../lib/alcanceVotantes');
const T = require('../lib/transporteDiaD');

const router = express.Router();
router.use(requireAuth, requiereComplemento('transporte_dia_d'), calcularAlcance, requiereVerModulo('transporte_dia_d', { aspirante: true }));

const TOPE_ASIGNAR = 200;

/** El sitio, de la configuración y, sin ella, el de esta misma petición (la abrió quien tiene sesión). */
const baseDe = (req) => (baseDelSitio() || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
const entero = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const idsDe = (lista) => [...new Set((Array.isArray(lista) ? lista : []).map(entero).filter(Boolean))];
const falla = (res, ruta, err, mensaje) => {
  console.error('transporte/' + ruta + ':', err.code || err.message);
  return res.status(500).json({ error: mensaje });
};

async function contexto(req) {
  const dueno = await duenoDeLaCampana(pool, req);
  const { fecha, configurada } = await T.fechaDeTrabajo();
  return { dueno, fecha, configurada };
}

// ---------------------------------------------------------------------------
// Contexto, contador y demanda
// ---------------------------------------------------------------------------

router.get('/contexto', async (req, res) => {
  try {
    const { dueno, fecha, configurada } = await contexto(req);
    const [[e]] = await pool.query('SELECT (fecha_eleccion = CURDATE()) AS hoy FROM configuracion_campana WHERE id = 1').catch(() => [[null]]);
    // Los puestos de la campaña con sus coordenadas del catálogo (para «ordenar desde un puesto»).
    const [puestos] = await pool.query('SELECT id, nombre FROM dia_d_puestos_votacion WHERE aspirante_id = ? ORDER BY nombre', [dueno]);
    const ubicacion = require('./checkinDiaD.routes').ubicacionDelPuesto;
    const conCoord = [];
    for (const p of puestos.slice(0, 600)) {
      const u = await ubicacion(pool, p.id);
      if (u) conCoord.push({ id: p.id, nombre: p.nombre, lat: u.lat, lon: u.lon });
    }
    res.json({ fecha, fecha_configurada: configurada, hoy_es_eleccion: !!(e && Number(e.hoy) === 1), tipos_vehiculo: T.TIPOS_VEHICULO, puestos: conCoord });
  } catch (err) { falla(res, 'contexto', err, 'No se pudo cargar el contexto del transporte.'); }
});

router.get('/resumen', async (req, res) => {
  try {
    const { dueno, fecha } = await contexto(req);
    res.json(await T.resumen(req, dueno, fecha));
  } catch (err) { falla(res, 'resumen', err, 'No se pudo calcular el contador de transporte.'); }
});

router.get('/demanda', async (req, res) => {
  try {
    const { dueno, fecha } = await contexto(req);
    const filtro = ['todos', 'sin_asignar', 'asignados'].includes(req.query.filtro) ? req.query.filtro : 'todos';
    res.json({ fecha, ...(await T.demanda(req, dueno, fecha, {
      filtro, conductorId: entero(req.query.conductor_id), incluirVotaron: req.query.votaron === '1' })) });
  } catch (err) { falla(res, 'demanda', err, 'No se pudo cargar la lista de quienes necesitan transporte.'); }
});

// ---------------------------------------------------------------------------
// Vehículos
// ---------------------------------------------------------------------------

router.get('/vehiculos', async (req, res) => {
  try {
    const { dueno } = await contexto(req);
    const [filas] = await pool.query(
      `SELECT id, placa, tipo, capacidad, descripcion, activo FROM transporte_vehiculos WHERE aspirante_id = ? ORDER BY activo DESC, placa`, [dueno]);
    res.json(filas.map(f => ({ ...f, activo: !!f.activo })));
  } catch (err) { falla(res, 'vehiculos', err, 'No se pudieron cargar los vehículos.'); }
});

router.post('/vehiculos', async (req, res) => {
  const v = T.validarVehiculo(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const { dueno } = await contexto(req);
    const x = v.valores;
    const [r] = await pool.query(
      'INSERT INTO transporte_vehiculos (aspirante_id, placa, tipo, capacidad, descripcion) VALUES (?, ?, ?, ?, ?)',
      [dueno, x.placa, x.tipo, x.capacidad, x.descripcion]);
    await registrarAuditoria(req.session.usuario.id, 'transporte_vehiculo_crear', 'transporte_vehiculos', r.insertId, `Placa ${x.placa}`, req.ip);
    res.json({ ok: true, id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya hay un vehículo con esa placa.' });
    falla(res, 'vehiculo-crear', err, 'No se pudo crear el vehículo.');
  }
});

router.put('/vehiculos/:id', async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: 'Vehículo inválido.' });
  try {
    const { dueno } = await contexto(req);
    const [[actual]] = await pool.query('SELECT * FROM transporte_vehiculos WHERE id = ? AND aspirante_id = ?', [id, dueno]);
    if (!actual) return res.status(404).json({ error: 'Ese vehículo no existe.' });
    const v = T.validarVehiculo({ ...actual, ...req.body });
    if (v.error) return res.status(400).json({ error: v.error });
    const x = v.valores;
    const activo = req.body && req.body.activo !== undefined ? (req.body.activo ? 1 : 0) : actual.activo;
    await pool.query('UPDATE transporte_vehiculos SET placa = ?, tipo = ?, capacidad = ?, descripcion = ?, activo = ? WHERE id = ?',
      [x.placa, x.tipo, x.capacidad, x.descripcion, activo, id]);
    await registrarAuditoria(req.session.usuario.id, 'transporte_vehiculo_editar', 'transporte_vehiculos', id, `Placa ${x.placa}${activo ? '' : ' (desactivado)'}`, req.ip);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya hay un vehículo con esa placa.' });
    falla(res, 'vehiculo-editar', err, 'No se pudo guardar el vehículo.');
  }
});

// ---------------------------------------------------------------------------
// Conductores
// ---------------------------------------------------------------------------

async function vehiculoDelDueno(vehiculoId, dueno) {
  if (vehiculoId == null || vehiculoId === '') return { ok: true, id: null };
  const id = entero(vehiculoId);
  if (!id) return { ok: false };
  const [[v]] = await pool.query('SELECT id FROM transporte_vehiculos WHERE id = ? AND aspirante_id = ?', [id, dueno]);
  return v ? { ok: true, id } : { ok: false };
}

router.get('/conductores', async (req, res) => {
  try {
    const { dueno, fecha } = await contexto(req);
    const [filas] = await pool.query(
      `SELECT c.id, c.nombre, c.celular, c.vehiculo_id, c.codigo, c.activo, c.rotado_en,
              v.placa, v.capacidad, v.tipo,
              (SELECT COUNT(*) FROM transporte_asignaciones a WHERE a.conductor_id = c.id AND a.fecha = ? AND a.estado <> 'cancelado') AS paradas,
              (SELECT COALESCE(SUM(a.personas), 0) FROM transporte_asignaciones a WHERE a.conductor_id = c.id AND a.fecha = ? AND a.estado IN (?)) AS ocupacion
         FROM transporte_conductores c LEFT JOIN transporte_vehiculos v ON v.id = c.vehiculo_id
        WHERE c.aspirante_id = ? ORDER BY c.activo DESC, c.nombre`, [fecha, fecha, T.ESTADOS_OCUPAN, dueno]);
    const base = baseDe(req);
    res.json(filas.map(f => {
      const enlace = T.urlDelConductor(f.codigo, base);
      const capacidad = f.capacidad == null ? null : Number(f.capacidad);
      return {
        id: f.id, nombre: f.nombre, celular: f.celular, activo: !!f.activo, vehiculo_id: f.vehiculo_id,
        placa: f.placa || null, capacidad, tipo: f.tipo || null,
        paradas: Number(f.paradas), ocupacion: Number(f.ocupacion), excede: capacidad != null && Number(f.ocupacion) > capacidad,
        enlace, texto: T.textoParaConductor(f.nombre, enlace),
      };
    }));
  } catch (err) { falla(res, 'conductores', err, 'No se pudieron cargar los conductores.'); }
});

router.post('/conductores', async (req, res) => {
  const v = T.validarConductor(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const { dueno } = await contexto(req);
    const veh = await vehiculoDelDueno(req.body && req.body.vehiculo_id, dueno);
    if (!veh.ok) return res.status(400).json({ error: 'Ese vehículo no existe.' });
    let id = null;
    for (let i = 0; i < 8 && !id; i++) {
      try {
        const [r] = await pool.query(
          'INSERT INTO transporte_conductores (aspirante_id, nombre, celular, vehiculo_id, codigo) VALUES (?, ?, ?, ?, ?)',
          [dueno, v.valores.nombre, v.valores.celular, veh.id, await T.codigoNuevo()]);
        id = r.insertId;
      } catch (err) { if (err.code !== 'ER_DUP_ENTRY') throw err; }
    }
    if (!id) throw new Error('sin código');
    await registrarAuditoria(req.session.usuario.id, 'transporte_conductor_crear', 'transporte_conductores', id, 'Creó un conductor', req.ip);
    res.json({ ok: true, id });
  } catch (err) { falla(res, 'conductor-crear', err, 'No se pudo crear el conductor.'); }
});

router.put('/conductores/:id', async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: 'Conductor inválido.' });
  try {
    const { dueno } = await contexto(req);
    const [[actual]] = await pool.query('SELECT * FROM transporte_conductores WHERE id = ? AND aspirante_id = ?', [id, dueno]);
    if (!actual) return res.status(404).json({ error: 'Ese conductor no existe.' });
    const v = T.validarConductor({ nombre: actual.nombre, celular: actual.celular, ...req.body });
    if (v.error) return res.status(400).json({ error: v.error });
    let vehiculoId = actual.vehiculo_id;
    if (req.body && 'vehiculo_id' in req.body) {
      const veh = await vehiculoDelDueno(req.body.vehiculo_id, dueno);
      if (!veh.ok) return res.status(400).json({ error: 'Ese vehículo no existe.' });
      vehiculoId = veh.id;
    }
    const activo = req.body && req.body.activo !== undefined ? (req.body.activo ? 1 : 0) : actual.activo;
    await pool.query('UPDATE transporte_conductores SET nombre = ?, celular = ?, vehiculo_id = ?, activo = ? WHERE id = ?',
      [v.valores.nombre, v.valores.celular, vehiculoId, activo, id]);
    await registrarAuditoria(req.session.usuario.id, 'transporte_conductor_editar', 'transporte_conductores', id, activo ? 'Editó un conductor' : 'Desactivó un conductor', req.ip);
    res.json({ ok: true });
  } catch (err) { falla(res, 'conductor-editar', err, 'No se pudo guardar el conductor.'); }
});

/** Cambia el código: el enlace anterior deja de servir en el acto. No reactiva a un conductor desactivado. */
router.post('/conductores/:id/rotar', async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: 'Conductor inválido.' });
  try {
    const { dueno } = await contexto(req);
    const [[c]] = await pool.query('SELECT id, nombre FROM transporte_conductores WHERE id = ? AND aspirante_id = ?', [id, dueno]);
    if (!c) return res.status(404).json({ error: 'Ese conductor no existe.' });
    let codigo = null;
    for (let i = 0; i < 8 && !codigo; i++) {
      const nuevo = await T.codigoNuevo();
      try { await pool.query('UPDATE transporte_conductores SET codigo = ?, rotado_en = NOW() WHERE id = ?', [nuevo, id]); codigo = nuevo; }
      catch (err) { if (err.code !== 'ER_DUP_ENTRY') throw err; }
    }
    if (!codigo) throw new Error('sin código');
    await registrarAuditoria(req.session.usuario.id, 'transporte_conductor_rotar', 'transporte_conductores', id, 'Cambió el código del enlace', req.ip);
    const enlace = T.urlDelConductor(codigo, baseDe(req));
    res.json({ ok: true, enlace, texto: T.textoParaConductor(c.nombre, enlace) });
  } catch (err) { falla(res, 'conductor-rotar', err, 'No se pudo cambiar el código.'); }
});

// ---------------------------------------------------------------------------
// Asignar, desasignar, personas y nota, ordenar
// ---------------------------------------------------------------------------

router.post('/asignar', async (req, res) => {
  const conductorId = entero(req.body && req.body.conductor_id);
  const ids = idsDe(req.body && req.body.votante_ids);
  if (!conductorId) return res.status(400).json({ error: 'Elige un conductor.' });
  if (!ids.length) return res.status(400).json({ error: 'Elige al menos un votante.' });
  if (ids.length > TOPE_ASIGNAR) return res.status(400).json({ error: `Máximo ${TOPE_ASIGNAR} votantes por vez.` });
  const personas = Math.min(20, Math.max(1, entero(req.body.personas) || 1));
  const cx = await pool.getConnection();
  try {
    const { dueno, fecha } = await contexto(req);
    const [[cond]] = await cx.query(
      `SELECT c.id, c.activo, v.capacidad FROM transporte_conductores c LEFT JOIN transporte_vehiculos v ON v.id = c.vehiculo_id
        WHERE c.id = ? AND c.aspirante_id = ?`, [conductorId, dueno]);
    if (!cond) { return res.status(404).json({ error: 'Ese conductor no existe.' }); }
    if (!cond.activo) { return res.status(409).json({ error: 'Ese conductor está desactivado.' }); }

    const a = { sql: condicionAlcanceVotantes(req.alcance, 'v'), valores: parametrosAlcanceVotantes(req.alcance) };
    const [votantes] = await cx.query(
      `SELECT v.id, v.necesita_transporte, (vv.votante_id IS NOT NULL) AS ya_voto
         FROM votantes v LEFT JOIN votante_votos vv ON vv.votante_id = v.id
        WHERE v.id IN (?) AND ${a.sql}`, [ids, ...a.valores]);
    const visibles = new Map(votantes.map(v => [v.id, v]));
    const omitidos = [];
    const validos = [];
    for (const id of ids) {
      const v = visibles.get(id);
      if (!v) omitidos.push({ votante_id: id, motivo: 'fuera_de_alcance' });
      else if (Number(v.necesita_transporte) !== 1) omitidos.push({ votante_id: id, motivo: 'no_marcado' });
      else if (Number(v.ya_voto) === 1) omitidos.push({ votante_id: id, motivo: 'ya_voto' });
      else validos.push(id);
    }

    await cx.beginTransaction();
    const [[mx]] = await cx.query('SELECT COALESCE(MAX(orden), 0) AS m FROM transporte_asignaciones WHERE conductor_id = ? AND fecha = ?', [conductorId, fecha]);
    let orden = Number(mx.m);
    let asignados = 0;
    for (const id of validos) {
      const [[ya]] = await cx.query('SELECT id, estado, conductor_id FROM transporte_asignaciones WHERE votante_id = ? AND fecha = ? FOR UPDATE', [id, fecha]);
      if (!ya) {
        orden++;
        await cx.query(
          `INSERT INTO transporte_asignaciones (aspirante_id, votante_id, conductor_id, fecha, orden, personas, asignado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?)`, [dueno, id, conductorId, fecha, orden, personas, req.session.usuario.id]);
        asignados++;
      } else if (['recogido', 'en_puesto'].includes(ya.estado)) {
        omitidos.push({ votante_id: id, motivo: 'ya_en_camino' });
      } else if (ya.estado === 'asignado' && ya.conductor_id === conductorId) {
        omitidos.push({ votante_id: id, motivo: 'ya_asignado' });
      } else {
        // Estaba con otro conductor, o cancelada, o «no estaba»: se reasigna la MISMA fila (la llave es única por votante y fecha).
        orden++;
        await cx.query(
          `UPDATE transporte_asignaciones
              SET conductor_id = ?, orden = ?, estado = 'asignado', recogido_en = NULL, llevado_en = NULL, latitud = NULL, longitud = NULL,
                  cliente_uuid = NULL, asignado_por = ?, asignado_en = NOW()
            WHERE id = ?`, [conductorId, orden, req.session.usuario.id, ya.id]);
        asignados++;
      }
    }
    await cx.commit();
    const ocupacion = await T.ocupacionDe(conductorId, fecha);
    const capacidad = cond.capacidad == null ? null : Number(cond.capacidad);
    if (asignados) await registrarAuditoria(req.session.usuario.id, 'transporte_asignar', 'transporte_conductores', conductorId, `Asignó ${asignados} parada(s)`, req.ip);
    // El aviso de capacidad NO bloquea: la coordinación sabe si caben más o si va a mandar otro vehículo.
    res.json({ ok: true, asignados, omitidos, capacidad: { capacidad, ocupacion, excede: capacidad != null && ocupacion > capacidad } });
  } catch (err) {
    try { await cx.rollback(); } catch (_) { /* sin transacción abierta */ }
    falla(res, 'asignar', err, 'No se pudo asignar.');
  } finally { cx.release(); }
});

router.post('/desasignar', async (req, res) => {
  const ids = idsDe(req.body && req.body.votante_ids);
  if (!ids.length) return res.status(400).json({ error: 'Elige al menos un votante.' });
  try {
    const { dueno, fecha } = await contexto(req);
    const [filas] = await pool.query(
      `SELECT a.id, a.estado, a.votante_id FROM transporte_asignaciones a JOIN votantes v ON v.id = a.votante_id
        WHERE a.votante_id IN (?) AND a.fecha = ? AND a.aspirante_id = ? AND ${condicionAlcanceVotantes(req.alcance, 'v')}`,
      [ids, fecha, dueno, ...parametrosAlcanceVotantes(req.alcance)]);
    let quitados = 0; const omitidos = [];
    for (const f of filas) {
      if (f.estado === 'asignado') { await pool.query('DELETE FROM transporte_asignaciones WHERE id = ?', [f.id]); quitados++; }
      else if (f.estado === 'recogido') { await pool.query("UPDATE transporte_asignaciones SET estado = 'cancelado' WHERE id = ?", [f.id]); quitados++; }
      else if (f.estado !== 'cancelado') omitidos.push({ votante_id: f.votante_id, motivo: 'ya_cerrada' });
    }
    if (quitados) await registrarAuditoria(req.session.usuario.id, 'transporte_desasignar', 'transporte_asignaciones', null, `Quitó ${quitados} parada(s)`, req.ip);
    res.json({ ok: true, quitados, omitidos });
  } catch (err) { falla(res, 'desasignar', err, 'No se pudo quitar de la lista.'); }
});

/** Cuántas personas lleva la parada y una nota para el conductor. */
router.put('/asignaciones/:id', async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: 'Parada inválida.' });
  try {
    const { dueno } = await contexto(req);
    const personas = Math.min(20, Math.max(1, entero(req.body && req.body.personas) || 1));
    const nota = String((req.body && req.body.nota) || '').replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, 255) || null;
    const [r] = await pool.query('UPDATE transporte_asignaciones SET personas = ?, nota = ? WHERE id = ? AND aspirante_id = ?', [personas, nota, id, dueno]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Esa parada no existe.' });
    res.json({ ok: true });
  } catch (err) { falla(res, 'asignacion', err, 'No se pudo guardar la parada.'); }
});

/**
 * «Ordenar por cercanía»: reescribe el orden de las paradas PENDIENTES de un conductor con el vecino más cercano
 * (lib/transporteDiaD.js). `inicio`: {tipo:'primero'} (parte de la primera parada actual), {tipo:'punto', lat, lon} o
 * {tipo:'puesto', puesto_id}. Las ya recogidas quedan primero; las sin coordenadas, al final de las pendientes.
 */
router.post('/conductores/:id/ordenar', async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: 'Conductor inválido.' });
  try {
    const { dueno, fecha } = await contexto(req);
    const [[c]] = await pool.query('SELECT id FROM transporte_conductores WHERE id = ? AND aspirante_id = ?', [id, dueno]);
    if (!c) return res.status(404).json({ error: 'Ese conductor no existe.' });
    const ini = (req.body && req.body.inicio) || { tipo: 'primero' };
    let inicio = null;
    if (ini.tipo === 'punto') {
      const lat = Number(ini.lat), lon = Number(ini.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return res.status(400).json({ error: 'El punto de partida no es válido.' });
      inicio = { lat, lon };
    } else if (ini.tipo === 'puesto') {
      const [[p]] = await pool.query('SELECT id FROM dia_d_puestos_votacion WHERE id = ? AND aspirante_id = ?', [entero(ini.puesto_id) || 0, dueno]);
      const u = p ? await require('./checkinDiaD.routes').ubicacionDelPuesto(pool, p.id) : null;
      if (!u) return res.status(400).json({ error: 'Ese puesto no tiene coordenadas en el catálogo.' });
      inicio = { lat: u.lat, lon: u.lon };
    }
    const [filas] = await pool.query(
      `SELECT a.id, a.estado, a.orden, v.latitud AS lat, v.longitud AS lon
         FROM transporte_asignaciones a JOIN votantes v ON v.id = a.votante_id
        WHERE a.conductor_id = ? AND a.fecha = ? AND a.estado IN ('asignado', 'recogido') ORDER BY a.orden, a.id`, [id, fecha]);
    const pendientes = filas.filter(f => f.estado === 'asignado');
    const yaRecogidas = filas.filter(f => f.estado === 'recogido');
    const nuevo = T.ordenarPorCercania(pendientes, inicio);
    let n = 0;
    for (const f of yaRecogidas) await pool.query('UPDATE transporte_asignaciones SET orden = ? WHERE id = ?', [++n, f.id]);
    for (const pid of nuevo) await pool.query('UPDATE transporte_asignaciones SET orden = ? WHERE id = ?', [++n, pid]);
    const sinCoordenadas = pendientes.filter(f => f.lat == null || f.lon == null).length;
    await registrarAuditoria(req.session.usuario.id, 'transporte_ordenar', 'transporte_conductores', id, `Ordenó ${nuevo.length} parada(s) por cercanía`, req.ip);
    res.json({ ok: true, ordenadas: nuevo.length, sin_coordenadas: sinCoordenadas });
  } catch (err) { falla(res, 'ordenar', err, 'No se pudo ordenar.'); }
});

module.exports = router;
