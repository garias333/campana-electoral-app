/**
 * SEGUIMIENTO DE SOLICITUDES CIUDADANAS (parche 304): el aviso al responsable cuando se le asigna una solicitud, y la cuenta de las que llevan
 * días sin movimiento. El aviso periódico («sin movimiento hace N días») lo manda el motor de recordatorios (lib/recordatoriosSolicitudes.js),
 * con su regla apagada de fábrica; aquí vive lo que comparten el motor, el panel y la ruta de asignar.
 *
 * QUÉ ES «MOVIMIENTO». Cualquier cosa que quede en solicitud_historial —el registro, un cambio de estado, un cambio de responsable, una nota
 * interna—, menos la anonimización, que es un trámite del sistema y no una gestión de nadie. Una solicitud sin historial (no debería existir)
 * cuenta desde que se registró.
 *
 * EL AVISO DE ASIGNACIÓN NO LLEVA DATOS PERSONALES: categoría y barrio, nada del ciudadano, ni siquiera su nombre. Es inmediato (lo dispara una
 * persona al asignar, no el reloj), así que no pasa por la franja de silencio de los automáticos.
 */
'use strict';

const pool = require('../config/db');
const S = require('./solicitudes');

const DIAS_POR_DEFECTO = 15;
const MAX_CUERPO = 140;

/** El último movimiento de la solicitud `s`, como expresión SQL. */
const ULTIMO_MOVIMIENTO = `COALESCE((SELECT MAX(h.creado_en) FROM solicitud_historial h WHERE h.solicitud_id = s.id AND h.tipo <> 'anonimizada'), s.creada_en)`;

/** Lo que de verdad sale. Las pruebas lo reemplazan: no se manda nada real. */
const deps = {
  enviarPush: (usuarioId, carga) => require('../config/push').enviarAUsuario(usuarioId, carga),
};

/** A los cuántos días sin movimiento se avisa (15 de fábrica; entre 1 y 365). */
async function diasSinMovimiento() {
  try {
    const [[c]] = await pool.query('SELECT solicitud_dias_sin_movimiento AS d FROM configuracion_campana WHERE id = 1');
    const d = c ? Number(c.d) : NaN;
    return Number.isInteger(d) && d >= 1 && d <= 365 ? d : DIAS_POR_DEFECTO;
  } catch (_) { return DIAS_POR_DEFECTO; }   // una campaña que aún no recibió la migración
}

function recortar(texto, max) {
  const t = String(texto || '');
  return t.length <= max ? t : t.slice(0, max - 3).trimEnd() + '...';
}

/**
 * Avisa por push a quien acaba de recibir una solicitud. NUNCA lanza: el aviso es una cortesía y no puede tumbar la asignación.
 * Devuelve { enviado, motivo } — `motivo` dice por qué no salió (sin_acceso, sin_responsable, es_quien_asigna, sin_cuenta, no_contactar, push).
 * No se avisa a quien se asigna a sí mismo, ni a quien no puede ver el módulo (el aviso no llevaría a ninguna parte).
 */
async function avisarAsignacion({ solicitudId, responsableId, asignadoPor }) {
  try {
    if (!responsableId) return { enviado: false, motivo: 'sin_responsable' };
    if (asignadoPor && Number(asignadoPor.id) === Number(responsableId)) return { enviado: false, motivo: 'es_quien_asigna' };
    const [[u]] = await pool.query(
      `SELECT u.id, u.no_contactar, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ? AND u.activo = 1`, [responsableId]);
    if (!u) return { enviado: false, motivo: 'sin_cuenta' };
    if (Number(u.no_contactar) === 1) return { enviado: false, motivo: 'no_contactar' };
    const permisos = await S.permisosDe({ id: u.id, rol: u.rol });
    if (!permisos.ver) return { enviado: false, motivo: 'sin_acceso' };
    const [[s]] = await pool.query(
      'SELECT c.nombre AS categoria, s.barrio_texto FROM solicitudes s JOIN solicitud_categorias c ON c.id = s.categoria_id WHERE s.id = ?', [solicitudId]);
    if (!s) return { enviado: false, motivo: 'sin_solicitud' };
    const donde = s.barrio_texto ? ` en ${recortar(s.barrio_texto, 50)}` : '';
    const url = ['admin', 'coordinador'].includes(u.rol) ? '/solicitudes.html' : '/app/mis-solicitudes.html';
    await deps.enviarPush(u.id, { titulo: 'Te asignaron una solicitud', cuerpo: recortar(`Solicitud de ${s.categoria}${donde}. Ábrela para hacerle seguimiento.`, MAX_CUERPO), url });
    return { enviado: true, motivo: null };
  } catch (err) {
    // Sin dispositivo registrado, sin llaves VAPID, sin red: se dice cuál, sin la sentencia ni datos de nadie.
    return { enviado: false, motivo: 'push', detalle: String((err && (err.code || err.message)) || err).slice(0, 160) };
  }
}

/**
 * Cuántas solicitudes ABIERTAS (no cerradas) llevan `dias` o más sin movimiento, dentro del alcance. `alcanceSql` es la condición de
 * lib/alcanceSolicitudes.js (alias «s»).
 */
async function contarSinMovimiento({ alcanceSql, alcanceValores, dias }) {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS n FROM solicitudes s
      WHERE ${alcanceSql} AND s.estado <> 'cerrada' AND ${ULTIMO_MOVIMIENTO} <= DATE_SUB(NOW(), INTERVAL ? DAY)`, [...alcanceValores, dias]);
  return Number(r.n);
}

module.exports = { deps, DIAS_POR_DEFECTO, ULTIMO_MOVIMIENTO, diasSinMovimiento, avisarAsignacion, contarSinMovimiento };
