/**
 * Rescate de votos del Día D (fase 2): quién ya votó, quién falta, y cómo va cada
 * líder. Montado en /api/dia-d/rescate.
 *
 * POR QUÉ CUELGA DE /dia-d. `restringirAspirante` (middleware/aspirante.js) deja
 * pasar a un aspirante solo por prefijos de ruta, y /dia-d ya es suyo. Colgar de
 * ahí evita abrirle un prefijo nuevo.
 *
 * LO QUE ACOTA CADA RUTA, Y CON QUÉ. Todas leen o escriben votantes, y todas usan
 * la MISMA condición que el listado de Votantes (`condicionAlcanceVotantes`, ver
 * lib/alcanceVotantes.js): un líder ve lo suyo y lo de sus sublíderes, un
 * sublíder lo que él registró, un coordinador su rama, un aspirante la suya y el
 * administrador la campaña madre. No se escribió una regla nueva: dos reglas de
 * «a quién ve cada quien» se separan solas, y esta se habría separado justo el
 * día de la elección.
 *
 * LA MARCA ES IDEMPOTENTE. Marcar a quien ya estaba marcado responde 200 y NO
 * cambia la hora original: el avance por hora cuenta cuándo votó, no cuándo
 * alguien lo volvió a apuntar. Es también lo que hace seguro el reintento desde
 * la cola sin señal del celular.
 */
'use strict';

const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole, calcularAlcance } = require('../middleware/auth');
const { requiereVerModulo } = require('../middleware/permisoModulo');
const { requiereComplemento } = require('../middleware/complemento');
const complementos = require('../lib/complementos');
const { condicionAlcanceVotantes, parametrosAlcanceVotantes } = require('../lib/alcanceVotantes');
const { registrarAuditoria, registrarAuditoriaEn } = require('../config/auditoria');
const { verificarPasswordPropia } = require('../config/verificaciones');
const { canalesDelEnlace } = require('../lib/canalesDelEnlace');   // la regla vive en lib/ (la comparte el aviso de transporte)
const enlaces = require('../config/yaVotoEnlace');

const router = express.Router();
router.use(requireAuth, calcularAlcance, requiereVerModulo('rescate_votos', { aspirante: true }));

/** La condición de alcance sobre la tabla `votantes v`, con sus parámetros EN ORDEN. */
function alcanceDe(req) {
  return {
    sql: condicionAlcanceVotantes(req.alcance, 'v'),
    valores: parametrosAlcanceVotantes(req.alcance),
  };
}

/** Quien puede deshacer marcas ajenas y ver el ranking: la coordinación y el aspirante. */
function esCoordinacion(req) {
  return ['admin', 'coordinador'].includes(req.session.usuario.rol) || !!req.sublicencia;
}

/** El mismo grupo para el mismo puesto: por id si lo hay; si no, por el texto. */
const CLAVE_PUESTO = `IF(v.puesto_id IS NOT NULL, CONCAT('p', v.puesto_id),
                          CONCAT('t', LOWER(TRIM(COALESCE(v.puesto_votacion, '')))))`;

const SIN_TELEFONO = `(v.telefono IS NULL OR TRIM(v.telefono) = '')`;

/** ¿Hoy es el día de la elección? Fuera de ese día las pantallas funcionan, en «modo prueba». */
async function contextoDeElección() {
  try {
    const e = await enlaces.estadoDeLaElección();
    return { fecha_eleccion: e.fecha, modo_prueba: !e.esHoy };
  } catch (_) {
    return { fecha_eleccion: null, modo_prueba: true };
  }
}

const pct = (votaron, total) => (total > 0 ? Math.round((votaron * 1000) / total) / 10 : 0);

/** Un instante que mandó el celular (marca hecha sin señal), en hora de Colombia, o null si no sirve. */
function aHoraColombia(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const ahora = Date.now();
  // Sin fecha válida, en el futuro (reloj del teléfono adelantado) o de hace más
  // de un día: no se confía en él y se usa la hora del servidor.
  if (isNaN(d) || d.getTime() > ahora || ahora - d.getTime() > 24 * 3600 * 1000) return null;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(d);
}

/* ——— GET /faltantes ——————————————————————————————————————————————
   Los votantes del alcance, agrupados por puesto. Las cifras de cada grupo y
   las de arriba se calculan sobre TODO el alcance, no sobre lo filtrado: si el
   chip «Faltan» recortara también el denominador, cada puesto saldría al 0 %.

   CADA PERSONA QUE AÚN NO HA VOTADO TRAE SU ENLACE «YA VOTÉ» (`enlace_ya_vote`), para que el
   líder lo mande desde su celular. Sale de la MISMA función que el envío masivo
   (`enlaces.asegurarEnlaces`): el mismo token HMAC, no una copia. Va en la lista —y por eso
   queda en la copia sin señal del celular— y SOLO para los votantes que esta consulta ya
   acotó al alcance de quien pregunta: nunca se pide un enlace de alguien que no se ve. */
const TOPE_FALTANTES = 5000;
router.get('/faltantes', async (req, res) => {
  const filtro = ['todos', 'faltan', 'votaron', 'sin_telefono', 'transporte'].includes(req.query.filtro) ? req.query.filtro : 'faltan';
  const q = String(req.query.q || '').trim();
  try {
    /* ACTIVAR COMPLEMENTOS (parche 318): el «Necesita transporte» es de Transporte. Con ese complemento apagado el filtro responde 403 y la
       marca no se manda (la columna `votantes.necesita_transporte` no se toca). El resto de Faltantes sigue igual. */
    const transporteActivo = await complementos.complementoActivo('transporte_dia_d');
    if (filtro === 'transporte' && !transporteActivo) {
      return res.status(403).json({ error: complementos.MENSAJE_INACTIVO, motivo: complementos.MOTIVO, complemento: 'transporte_dia_d' });
    }
    const a = alcanceDe(req);
    const [grupos] = await pool.query(
      `SELECT ${CLAVE_PUESTO} AS clave,
              MAX(v.puesto_votacion) AS puesto, MAX(v.municipio_votacion) AS municipio,
              COUNT(*) AS total, SUM(vv.votante_id IS NOT NULL) AS votaron
         FROM votantes v LEFT JOIN votante_votos vv ON vv.votante_id = v.id
        WHERE ${a.sql}
        GROUP BY clave`, a.valores);

    const cond = [];
    const params = [];
    if (filtro === 'faltan') cond.push('vv.votante_id IS NULL');
    if (filtro === 'votaron') cond.push('vv.votante_id IS NOT NULL');
    if (filtro === 'sin_telefono') cond.push(`${SIN_TELEFONO} AND vv.votante_id IS NULL`);
    // «Necesitan transporte»: los que faltan por votar y alguien marcó que necesitan que los lleven.
    if (filtro === 'transporte') cond.push('v.necesita_transporte = 1 AND vv.votante_id IS NULL');
    if (q) { cond.push('v.nombre LIKE ?'); params.push(`%${q}%`); }
    const [filas] = await pool.query(
      `SELECT v.id, v.nombre, v.telefono, v.mesa_votacion, v.no_contactar,
              v.consentimiento_sms, v.consentimiento_whatsapp, v.necesita_transporte,
              v.origen AS origen_votante, v.consentimiento_confirmado_en,
              ${CLAVE_PUESTO} AS clave, vv.voto_en, vv.origen
         FROM votantes v LEFT JOIN votante_votos vv ON vv.votante_id = v.id
        WHERE ${a.sql} ${cond.length ? 'AND ' + cond.join(' AND ') : ''}
        ORDER BY (vv.votante_id IS NOT NULL), v.mesa_votacion, v.nombre
        LIMIT ${TOPE_FALTANTES + 1}`, [...a.valores, ...params]);
    const truncado = filas.length > TOPE_FALTANTES;
    if (truncado) filas.pop();

    const porClave = new Map(grupos.map(g => [g.clave, {
      clave: g.clave, puesto: (g.puesto || '').trim() || 'Sin puesto registrado',
      municipio: g.municipio || '', total: Number(g.total), votaron: Number(g.votaron),
      faltan: Number(g.total) - Number(g.votaron), pct: pct(Number(g.votaron), Number(g.total)),
      personas: [],
    }]));
    const eleccion = await contextoDeElección();
    // Los enlaces de toda la lista, en una sola pasada (crea o reutiliza; ver asegurarEnlaces).
    const permitidos = new Map(filas.map(f => [f.id, canalesDelEnlace(f)]));
    const conPermiso = [...permitidos].filter(([, c]) => c.wa || c.sms).map(([id]) => id);
    let urls = new Map();
    let falloEnlaces = false;
    if (eleccion.fecha_eleccion && conPermiso.length) {
      try { urls = await enlaces.asegurarEnlaces(conPermiso); }
      catch (err) {
        // La lista NO se cae por esto: sin enlaces el líder sigue pudiendo llamar y marcar.
        falloEnlaces = true;
        console.error('rescate/faltantes (enlaces):', err.codigo || err.code || err.message);
      }
    }
    for (const f of filas) {
      const g = porClave.get(f.clave);
      if (!g) continue;
      const c = permitidos.get(f.id);
      const url = urls.get(f.id) || null;
      // Por qué NO hay enlace, en una palabra, para que la lista lo diga (null = no hace falta decirlo:
      // ya votó, pidió no recibir mensajes o no tiene teléfono, y la fila ya lo muestra).
      let sinEnlace = null;
      if (!url && !f.voto_en && !Number(f.no_contactar) && String(f.telefono || '').trim()) {
        if (!c.wa && !c.sms) sinEnlace = 'sin_autorizacion';
        else sinEnlace = (!eleccion.fecha_eleccion) ? 'sin_fecha' : (falloEnlaces ? 'no_disponible' : null);
      }
      g.personas.push({
        id: f.id, nombre: f.nombre, telefono: f.telefono || '', mesa: f.mesa_votacion,
        no_contactar: !!f.no_contactar, voto_en: f.voto_en || null, origen: f.origen || null,
        necesita_transporte: transporteActivo && Number(f.necesita_transporte) === 1,
        enlace_ya_vote: url, enlace_wa: !!url && c.wa, enlace_sms: !!url && c.sms, sin_enlace: sinEnlace,
      });
    }
    // Los puestos con más gente por rescatar, primero; y los que no tienen
    // ninguna persona que mostrar con este filtro, fuera.
    const puestos = [...porClave.values()]
      .filter(g => g.personas.length > 0)
      .sort((x, y) => y.faltan - x.faltan || x.puesto.localeCompare(y.puesto));

    const total = grupos.reduce((s, g) => s + Number(g.total), 0);
    const votaron = grupos.reduce((s, g) => s + Number(g.votaron), 0);
    res.json({
      ...eleccion,
      filtro, truncado,
      totales: { total, votaron, faltan: total - votaron, pct: pct(votaron, total) },
      puestos,
    });
  } catch (err) {
    console.error('rescate/faltantes:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo cargar la lista de votantes.' });
  }
});

/* ——— POST /transporte ————————————————————————————————————————————
   El interruptor «necesita transporte» de Faltantes. Idempotente (poner lo que ya estaba no cambia nada), así que es seguro
   reintentarlo desde la cola sin señal. Con el MISMO alcance que marcar: sólo votantes que se ven; 403 y no 404 fuera de él. */
router.post('/transporte', requiereComplemento('transporte_dia_d'), async (req, res) => {
  const votanteId = Number(req.body && req.body.votante_id);
  if (!Number.isInteger(votanteId) || votanteId < 1) return res.status(400).json({ error: 'Falta el votante.' });
  const necesita = req.body && (req.body.necesita === true || req.body.necesita === 1) ? 1 : 0;
  try {
    const a = alcanceDe(req);
    const [[v]] = await pool.query(`SELECT v.id FROM votantes v WHERE v.id = ? AND ${a.sql}`, [votanteId, ...a.valores]);
    if (!v) return res.status(403).json({ error: 'Ese votante no está entre tus votantes.' });
    await pool.query(`UPDATE votantes SET necesita_transporte = ? WHERE id = ?`, [necesita ? 1 : null, votanteId]);
    res.json({ ok: true, necesita_transporte: !!necesita });
  } catch (err) {
    console.error('rescate/transporte:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo guardar. Intenta de nuevo.' });
  }
});

/* ——— POST /marcar ————————————————————————————————————————————— */
router.post('/marcar', async (req, res) => {
  const votanteId = Number(req.body && req.body.votante_id);
  if (!Number.isInteger(votanteId) || votanteId < 1) {
    return res.status(400).json({ error: 'Falta el votante.' });
  }
  try {
    const a = alcanceDe(req);
    const [[v]] = await pool.query(
      `SELECT v.id, v.puesto_id FROM votantes v WHERE v.id = ? AND ${a.sql}`, [votanteId, ...a.valores]);
    // 403 y no 404: no se dice si el votante existe fuera de su alcance.
    if (!v) return res.status(403).json({ error: 'Ese votante no está entre tus votantes.' });

    const r = await enlaces.registrarVoto({
      votanteId, puestoId: v.puesto_id, origen: 'equipo',
      marcadoPor: req.session.usuario.id, votoEn: aHoraColombia(req.body.marcado_en),
    });
    const [[marca]] = await pool.query(
      `SELECT voto_en, origen FROM votante_votos WHERE votante_id = ?`, [votanteId]);
    res.json({ ok: true, ya_estaba: r.yaEstaba, voto_en: marca ? marca.voto_en : null, origen: marca ? marca.origen : null });
  } catch (err) {
    console.error('rescate/marcar:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo marcar. Intenta de nuevo.' });
  }
});

/* ——— DELETE /marcar/:votanteId ———————————————————————————————————— */
router.delete('/marcar/:votanteId', async (req, res) => {
  const votanteId = Number(req.params.votanteId);
  if (!Number.isInteger(votanteId) || votanteId < 1) return res.status(400).json({ error: 'Votante inválido.' });
  try {
    const a = alcanceDe(req);
    const [[m]] = await pool.query(
      `SELECT vv.marcado_por, vv.origen, vv.voto_en, v.nombre AS votante, u.nombre AS marcador
         FROM votante_votos vv
         JOIN votantes v ON v.id = vv.votante_id
         LEFT JOIN usuarios u ON u.id = vv.marcado_por
        WHERE vv.votante_id = ? AND ${a.sql}`, [votanteId, ...a.valores]);
    if (!m) return res.status(404).json({ error: 'Ese votante no tiene marca de «ya votó».' });
    // Deshacer es de quien marcó, o de la coordinación. Una marca que vino por el
    // enlace no tiene «quien marcó»: solo la coordinación la deshace.
    const suya = m.marcado_por !== null && m.marcado_por === req.session.usuario.id;
    if (!suya && !esCoordinacion(req)) {
      return res.status(403).json({ error: 'Solo quien lo marcó, o la coordinación, puede deshacer esta marca.' });
    }
    await pool.query(`DELETE FROM votante_votos WHERE votante_id = ?`, [votanteId]);
    await registrarAuditoria(
      req.session.usuario.id, 'desmarcar_voto', 'votante_votos', votanteId,
      `Deshizo la marca «ya votó» de ${m.votante} (id ${votanteId}), puesta por `
        + `${m.marcador || (m.origen === 'enlace' ? 'el votante, desde su enlace' : 'alguien ya borrado')} `
        + `a las ${m.voto_en}.`, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error('rescate/desmarcar:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo deshacer la marca.' });
  }
});

/* ——— GET /resumen ————————————————————————————————————————————————— */
/** «Ya votó» por puesto, con el alcance de quien pregunta: [{ puesto (texto), total, votaron, pct }]. Lo usa también el cuadro de alertas. */
async function resumenPorPuesto(req) {
  const a = alcanceDe(req);
  const [puestos] = await pool.query(
    `SELECT ${CLAVE_PUESTO} AS clave, MAX(v.puesto_votacion) AS puesto,
            COUNT(*) AS total, SUM(vv.votante_id IS NOT NULL) AS votaron
       FROM votantes v LEFT JOIN votante_votos vv ON vv.votante_id = v.id
      WHERE ${a.sql} GROUP BY clave`, a.valores);
  return puestos.map(p => ({
    puesto: (p.puesto || '').trim() || 'Sin puesto registrado',
    total: Number(p.total), votaron: Number(p.votaron),
    faltan: Number(p.total) - Number(p.votaron), pct: pct(Number(p.votaron), Number(p.total)),
  }));
}

router.get('/resumen', async (req, res) => {
  try {
    const a = alcanceDe(req);
    const [[t]] = await pool.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(vv.votante_id IS NOT NULL), 0) AS votaron,
              MAX(vv.voto_en) AS ultima
         FROM votantes v LEFT JOIN votante_votos vv ON vv.votante_id = v.id
        WHERE ${a.sql}`, a.valores);
    // Por hora, de HOY (hora de Colombia: voto_en ya está en ella). Solo hoy: en
    // un simulacro quedan marcas de otros días y mezclarlas inventa una curva.
    const [horas] = await pool.query(
      `SELECT HOUR(vv.voto_en) AS hora, COUNT(*) AS n
         FROM votante_votos vv JOIN votantes v ON v.id = vv.votante_id
        WHERE vv.voto_en >= CURDATE() AND vv.voto_en < CURDATE() + INTERVAL 1 DAY AND ${a.sql}
        GROUP BY hora ORDER BY hora`, a.valores);
    const [puestos] = await pool.query(
      `SELECT ${CLAVE_PUESTO} AS clave, MAX(v.puesto_votacion) AS puesto,
              COUNT(*) AS total, SUM(vv.votante_id IS NOT NULL) AS votaron
         FROM votantes v LEFT JOIN votante_votos vv ON vv.votante_id = v.id
        WHERE ${a.sql} GROUP BY clave`, a.valores);
    const total = Number(t.total), votaron = Number(t.votaron);
    res.json({
      ...(await contextoDeElección()),
      total, votaron, faltan: total - votaron, pct: pct(votaron, total), ultima_marca: t.ultima || null,
      por_hora: horas.map(h => ({ hora: Number(h.hora), n: Number(h.n) })),
      por_puesto: puestos.map(p => ({
        puesto: (p.puesto || '').trim() || 'Sin puesto registrado',
        total: Number(p.total), votaron: Number(p.votaron),
        faltan: Number(p.total) - Number(p.votaron), pct: pct(Number(p.votaron), Number(p.total)),
      })).sort((x, y) => y.faltan - x.faltan || x.puesto.localeCompare(y.puesto)),
    });
  } catch (err) {
    console.error('rescate/resumen:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo calcular el avance.' });
  }
});

/* ——— GET /ranking ————————————————————————————————————————————————
   Por líder. Solo la coordinación y el aspirante: un líder no tiene por qué ver
   cuánto lleva el de al lado. El agrupamiento es por `lider_id` (el líder de la
   ficha); lo que registró un sublíder cuenta para SU líder. */
const MIN_SIN_MOVIMIENTO = 60;
router.get('/ranking', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  const orden = ['faltantes', 'pct', 'sin_movimiento'].includes(req.query.orden) ? req.query.orden : 'faltantes';
  try {
    const a = alcanceDe(req);
    const [filas] = await pool.query(
      `SELECT v.lider_id, u.nombre AS lider_nombre, u.telefono AS lider_telefono,
              COUNT(*) AS total, SUM(vv.votante_id IS NOT NULL) AS votaron,
              MAX(vv.voto_en) AS ultima,
              TIMESTAMPDIFF(MINUTE, MAX(vv.voto_en), NOW()) AS min_sin_marca
         FROM votantes v
         LEFT JOIN votante_votos vv ON vv.votante_id = v.id
         LEFT JOIN usuarios u ON u.id = v.lider_id
        WHERE ${a.sql}
        GROUP BY v.lider_id, u.nombre, u.telefono`, a.valores);
    // Las cifras de arriba son de TODO el alcance: se calculan ANTES de filtrar, porque
    // con «Sin movimiento 1 h» la lista se recorta y las cifras no deben encogerse con ella.
    const total = filas.reduce((s, f) => s + Number(f.total), 0);
    const votaron = filas.reduce((s, f) => s + Number(f.votaron), 0);
    let lideres = filas.map(f => {
      const total = Number(f.total), votaron = Number(f.votaron);
      const sinMarca = f.min_sin_marca === null ? null : Number(f.min_sin_marca);
      return {
        lider_id: f.lider_id, nombre: f.lider_nombre || 'Sin líder asignado', telefono: f.lider_telefono || '',
        total, votaron, faltan: total - votaron, pct: pct(votaron, total),
        ultima_marca: f.ultima || null, min_sin_marca: sinMarca,
        // Sin movimiento: le faltan votantes y lleva más de una hora sin una marca
        // (o nunca ha marcado).
        sin_movimiento: (total - votaron) > 0 && (sinMarca === null || sinMarca >= MIN_SIN_MOVIMIENTO),
      };
    });
    if (orden === 'sin_movimiento') {
      lideres = lideres.filter(l => l.sin_movimiento)
        .sort((x, y) => (y.min_sin_marca === null ? 1e9 : y.min_sin_marca) - (x.min_sin_marca === null ? 1e9 : x.min_sin_marca)
          || y.faltan - x.faltan);
    } else if (orden === 'pct') {
      lideres.sort((x, y) => x.pct - y.pct || y.faltan - x.faltan);
    } else {
      lideres.sort((x, y) => y.faltan - x.faltan || x.pct - y.pct);
    }
    res.json({
      ...(await contextoDeElección()), orden,
      totales: { total, votaron, faltan: total - votaron, pct: pct(votaron, total) },
      lideres,
    });
  } catch (err) {
    console.error('rescate/ranking:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo armar el ranking.' });
  }
});

/* ——— POST /enlace ————————————————————————————————————————————————
   El enlace «Ya voté» de UN votante, para el asistente de WhatsApp (que arma el
   mensaje en el navegador y necesita pedírselo al servidor). Aplica la misma
   regla estricta que el SMS: solo con autorización EXPLÍCITA por ese canal y sin
   baja. */
router.post('/enlace', async (req, res) => {
  const votanteId = Number(req.body && req.body.votante_id);
  if (!Number.isInteger(votanteId) || votanteId < 1) return res.status(400).json({ error: 'Falta el votante.' });
  try {
    const a = alcanceDe(req);
    const [[v]] = await pool.query(
      `SELECT v.id, v.no_contactar, v.consentimiento_whatsapp, v.origen, v.consentimiento_confirmado_en
         FROM votantes v WHERE v.id = ? AND ${a.sql}`,
      [votanteId, ...a.valores]);
    if (!v) return res.status(403).json({ error: 'Ese votante no está entre tus votantes.' });
    if (v.origen === 'enlace_lider' && !v.consentimiento_confirmado_en) {
      return res.status(403).json({ error: 'Esta persona se inscribió por enlace y aún no confirma su autorización.' });
    }
    if (Number(v.no_contactar) === 1 || Number(v.consentimiento_whatsapp) !== 1) {
      return res.status(403).json({ error: 'Esta persona no tiene autorización registrada para recibir este enlace por WhatsApp.' });
    }
    const mapa = await enlaces.asegurarEnlaces([votanteId]);
    res.json({ ok: true, url: mapa.get(votanteId) });
  } catch (err) {
    if (err.codigo === 'SIN_FECHA' || err.codigo === 'SIN_LLAVE') return res.status(400).json({ error: err.message });
    console.error('rescate/enlace:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo generar el enlace.' });
  }
});

/* ——— POST /vaciar ————————————————————————————————————————————————
   Borra las marcas y los enlaces de SU alcance, para empezar de cero tras un
   simulacro. Confirma con la contraseña de quien lo hace (la suya, no la de
   «algún administrador»: aquí el aspirante no tiene por qué conocer la de otro).
   Queda en la auditoría con cuántas marcas se borraron. */
router.post('/vaciar', requireRole('admin', 'aspirante'), async (req, res) => {
  const ok = await verificarPasswordPropia(req.session.usuario.id, req.body && req.body.password);
  if (!ok) return res.status(403).json({ error: 'Contraseña incorrecta.' });
  let conexion;
  try {
    const a = alcanceDe(req);
    conexion = await pool.getConnection();
    await conexion.beginTransaction();
    const [m] = await conexion.query(
      `DELETE vv FROM votante_votos vv JOIN votantes v ON v.id = vv.votante_id WHERE ${a.sql}`, a.valores);
    const [t] = await conexion.query(
      `DELETE t FROM votante_voto_tokens t JOIN votantes v ON v.id = t.votante_id WHERE ${a.sql}`, a.valores);
    await registrarAuditoriaEn(
      conexion, req.session.usuario.id, 'vaciar_marcas_voto', 'votante_votos', null,
      `Vació las marcas de «ya votó» de su alcance: ${m.affectedRows} marcas y ${t.affectedRows} enlaces borrados.`,
      req.ip);
    await conexion.commit();
    res.json({ ok: true, marcas: m.affectedRows, enlaces: t.affectedRows });
  } catch (err) {
    if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
    console.error('rescate/vaciar:', err.code || err.message);
    res.status(500).json({ error: 'No se pudieron vaciar las marcas.' });
  } finally {
    if (conexion) conexion.release();
  }
});

module.exports = router;
module.exports.resumenPorPuesto = resumenPorPuesto;
