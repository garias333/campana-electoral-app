/**
 * Check-in del testigo — «Llegué a mi puesto». Montado en /api/dia-d/checkin.
 *
 * QUÉ GUARDA: una fila por persona y día en `dia_d_checkin` con la hora de llegada y, si hay, dónde se marcó. Es lo que
 * convierte «mesa con testigo asignado» en «testigo que ya llegó» (el cuadro de alertas, los colores de las mesas).
 *
 * LA UBICACIÓN ES UN DATO, NO UN REQUISITO. Si la persona la niega, o el teléfono no la da, se guarda la llegada igual,
 * sin coordenadas. Si el catálogo trae la ubicación del puesto, se guarda además la distancia; que sea mayor a 500 m es
 * una marca para quien mira el cuadro, NUNCA un rechazo: un testigo que marca desde la esquina porque en el puesto no hay
 * señal sigue habiendo llegado.
 *
 * IDEMPOTENTE. La clave única es (persona, día): marcar dos veces —el doble toque, o el reintento de la cola sin señal—
 * devuelve la llegada que ya estaba y no cambia su hora. La hora que cuenta es la del TOQUE, no la de la subida: lo que
 * se marca sin señal llega con su `marcado_en` y se acepta si no es del futuro ni de hace más de un día.
 *
 * FECHA = HOY EN COLOMBIA, también fuera de `fecha_eleccion`: en «modo prueba» se puede ensayar la jornada entera.
 *
 * QUIÉN: cualquiera con una fila de testigo en la campaña marca LA SUYA; admin, coordinador y aspirante pueden marcar la
 * de un testigo a mano (origen 'coordinador', con auditoría).
 */
'use strict';

const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { registrarAuditoria } = require('../config/auditoria');
const diaD = require('./diaD.routes').compartido;
const jornada = require('../lib/jornadaDiaD');
const { cargarTestigos, repartirPorPuesto } = require('../lib/coberturaTestigos');

const router = express.Router();
router.use(requireAuth);

const DISTANCIA_LEJOS_M = 500;
const UUID = /^[A-Za-z0-9_-]{8,64}$/;

/** El instante de un toque hecho sin señal, en hora de Colombia, o null si no sirve (futuro, de hace más de un día o inválido). */
function horaDeMarca(iso, ahora = new Date()) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d) || d.getTime() > ahora.getTime() || ahora.getTime() - d.getTime() > 24 * 3600 * 1000) return null;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(d);
}

function coordenada(v, min, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** El puesto de la campaña donde vigila esta persona, o null. Devuelve también sus mesas. */
async function puestoDelTestigo(conexion, dueno, usuarioId) {
  const todos = await cargarTestigos(conexion, dueno);
  const t = todos.find(x => x.usuario_id === usuarioId);
  if (!t) return null;
  const [puestos] = await conexion.query(
    `SELECT id, nombre, cantidad_mesas, ctc_puesto_id FROM dia_d_puestos_votacion WHERE aspirante_id = ? ORDER BY nombre`, [dueno]);
  for (const p of puestos) {
    const lista = repartirPorPuesto([t], [p]).get(Number(p.id)) || [];
    if (lista.length) return { puesto: p, testigo: t };
  }
  return { puesto: null, testigo: t };
}

/** Lat/lon del puesto según el catálogo, o null. Si el catálogo no trae `ubicacion` o no se puede leer, null y listo. */
async function ubicacionDelPuesto(conexion, puestoId) {
  try {
    const catalogo = process.env.CATALOGO_DB || 'territoriosdb';
    const [[f]] = await conexion.query(
      `SELECT ST_Latitude(cp.ubicacion) AS lat, ST_Longitude(cp.ubicacion) AS lon
         FROM dia_d_puestos_votacion p JOIN ${catalogo}.ctc_puestos_votacion cp ON cp.id = p.ctc_puesto_id
        WHERE p.id = ? AND cp.ubicacion IS NOT NULL`, [puestoId]);
    return f && f.lat != null && f.lon != null ? { lat: Number(f.lat), lon: Number(f.lon) } : null;
  } catch (_) { return null; }
}

async function llegadaDe(conexion, usuarioId, fecha) {
  const [[f]] = await conexion.query(
    `SELECT id, puesto_id, DATE_FORMAT(llegado_en, '%Y-%m-%d %H:%i:%s') AS llegado_en, latitud, longitud, distancia_m, origen
       FROM dia_d_checkin WHERE usuario_id = ? AND fecha = ?`, [usuarioId, fecha]);
  return f || null;
}

const formatoLlegada = (f) => f && ({
  llegado_en: f.llegado_en, origen: f.origen, distancia_m: f.distancia_m == null ? null : Number(f.distancia_m),
  lejos: f.distancia_m != null && Number(f.distancia_m) > DISTANCIA_LEJOS_M, con_ubicacion: f.latitud != null,
});

/* ——— GET /mio: lo que necesita el botón «Llegué a mi puesto» ——————————————— */
router.get('/mio', async (req, res) => {
  try {
    const dueno = await diaD.duenoDeLaCampana(req);
    const cfg = await jornada.leerJornada(pool);
    const estado = jornada.estadoDeLaJornada(cfg);
    const mio = await puestoDelTestigo(pool, dueno, req.session.usuario.id);
    if (!mio || !mio.puesto) {
      return res.json({ tiene_puesto: false, modo_prueba: estado.modo_prueba, fecha: estado.hoy, ahora: estado.ahora });
    }
    res.json({
      tiene_puesto: true, puesto: { id: mio.puesto.id, nombre: mio.puesto.nombre }, mesas: mio.testigo.mesas,
      llegada: formatoLlegada(await llegadaDe(pool, req.session.usuario.id, estado.hoy)),
      modo_prueba: estado.modo_prueba, fecha: estado.hoy, ahora: estado.ahora, apertura: cfg.jornada_apertura,
    });
  } catch (err) {
    console.error('checkin/mio:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo consultar tu llegada.' });
  }
});

/* ——— POST /: «Llegué» (la propia) ————————————————————————————————————— */
router.post('/', async (req, res) => {
  const b = req.body || {};
  try {
    const usuarioId = req.session.usuario.id;
    const dueno = await diaD.duenoDeLaCampana(req);
    const cfg = await jornada.leerJornada(pool);
    const ahora = jornada.ahoraColombia();
    const estado = jornada.estadoDeLaJornada(cfg, ahora);
    const mio = await puestoDelTestigo(pool, dueno, usuarioId);
    if (!mio || !mio.puesto) {
      return res.status(400).json({ error: 'No tienes un puesto de votación asignado como testigo. Avísale a tu coordinador.' });
    }
    const uuid = b.cliente_uuid && UUID.test(String(b.cliente_uuid)) ? String(b.cliente_uuid) : null;
    const lat = coordenada(b.latitud, -90, 90), lon = coordenada(b.longitud, -180, 180);
    // Sin las DOS coordenadas no hay ubicación: una sola no sirve para nada y confunde.
    const conUbicacion = lat !== null && lon !== null;
    let distancia = null;
    if (conUbicacion) {
      const p = await ubicacionDelPuesto(pool, mio.puesto.id);
      if (p) distancia = jornada.distanciaMetros(lat, lon, p.lat, p.lon);
    }
    // La hora del toque, si vino de la cola sin señal y es creíble; si no, la del servidor.
    const hora = horaDeMarca(b.marcado_en, jornada.reloj()) || `${ahora.texto}:00`;
    // La fecha de la fila es la del TOQUE, no la de la subida: lo marcado a las 11 p. m. y subido pasada la medianoche cuenta ese día.
    const fecha = hora.slice(0, 10);
    const [r] = await pool.query(
      `INSERT INTO dia_d_checkin (aspirante_id, usuario_id, puesto_id, fecha, llegado_en, latitud, longitud, distancia_m, origen, cliente_uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'testigo', ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [dueno, usuarioId, mio.puesto.id, fecha, hora, conUbicacion ? lat : null, conUbicacion ? lon : null, distancia, uuid]);
    const llegada = formatoLlegada(await llegadaDe(pool, usuarioId, fecha));
    res.json({ ok: true, ya_estaba: r.affectedRows === 0, llegada, modo_prueba: estado.modo_prueba, puesto: mio.puesto.nombre });
  } catch (err) {
    console.error('checkin/marcar:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo registrar tu llegada. Intenta de nuevo.' });
  }
});

/* ——— POST /manual: la coordinación marca la llegada de un testigo ———————————— */
router.post('/manual', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  const usuarioId = Number(req.body && req.body.usuario_id);
  if (!Number.isInteger(usuarioId) || usuarioId < 1) return res.status(400).json({ error: 'Falta el testigo.' });
  try {
    const dueno = await diaD.duenoDeLaCampana(req);
    const ahora = jornada.ahoraColombia();
    const mio = await puestoDelTestigo(pool, dueno, usuarioId);
    if (!mio) return res.status(404).json({ error: 'Esa persona no es testigo de esta campaña.' });
    if (!mio.puesto) return res.status(400).json({ error: 'Ese testigo no tiene un puesto de la lista asignado.' });
    const [r] = await pool.query(
      `INSERT INTO dia_d_checkin (aspirante_id, usuario_id, puesto_id, fecha, llegado_en, origen, marcado_por)
       VALUES (?, ?, ?, ?, ?, 'coordinador', ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [dueno, usuarioId, mio.puesto.id, ahora.fecha, `${ahora.texto}:00`, req.session.usuario.id]);
    const llegada = formatoLlegada(await llegadaDe(pool, usuarioId, ahora.fecha));
    if (r.affectedRows) {
      await registrarAuditoria(req.session.usuario.id, 'marcar_llegada_testigo', 'dia_d_checkin', r.insertId || usuarioId,
        `Marcó a mano la llegada de ${mio.testigo.nombre} al puesto ${mio.puesto.nombre} (${ahora.texto}).`, req.ip);
    }
    res.json({ ok: true, ya_estaba: r.affectedRows === 0, llegada, testigo: mio.testigo.nombre });
  } catch (err) {
    console.error('checkin/manual:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo marcar la llegada.' });
  }
});

module.exports = router;
module.exports.horaDeMarca = horaDeMarca;
module.exports.DISTANCIA_LEJOS_M = DISTANCIA_LEJOS_M;
// El transporte del Día D (lib/transporteDiaD.js) usa las mismas coordenadas del catálogo para «Cómo llegar al puesto».
module.exports.ubicacionDelPuesto = ubicacionDelPuesto;
