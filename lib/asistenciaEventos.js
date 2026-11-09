/**
 * MARCAR LA ASISTENCIA A UN EVENTO (parche 313). Hasta el 312 la API aceptaba `asistio` (PUT /api/eventos/asistentes/:id) pero NINGUNA pantalla la llamaba: el
 * contador «asistieron» de cada evento solo podía valer lo que alguien escribiera a mano en la base. Aquí vive la regla, para el escritorio y para el celular.
 *
 * QUIÉN MARCA
 *   administrador, coordinador y líder .... en los eventos que GESTIONAN (figuran como creador, responsable, coordinador o líder: `alcanceEventos(…, soloGestion)`)
 *   sublíder ............................... SOLO «asistió / no asistió», y solo en los eventos donde es el RESPONSABLE o está INVITADO. No edita ni borra el evento,
 *                                            no confirma, no agrega ni quita asistentes (decisión del dueño, 9 de noviembre de 2026; si cambia, se avisa antes del parche).
 *   testigo, invitado y demás ............. nadie.
 *
 * IDEMPOTENTE Y EN ORDEN. La marca es un ESTADO («asistió = sí/no»), no un contador: repetirla no suma. Cada marca lleva el instante de su CAPTURA (`marcado_en`, el del
 * toque en el celular) y se guarda con `asistio_ms`: una marca más vieja que la ya guardada se IGNORA. Así, lo que un celular marcó sin señal el martes y sube el jueves no
 * pisa lo que otra persona marcó el miércoles, y dos subidas del mismo registro dejan lo mismo. El contador se calcula SIEMPRE contando filas (`asistio = 1`).
 *
 * NO TIENE NADA QUE VER con el check-in del Día D (`dia_d_checkin`): son tablas, rutas y pantallas distintas, y esto tampoco se bloquea el día de la elección.
 */
'use strict';

const pool = require('../config/db');
const { alcanceEventos } = require('./alcanceEventos');

const ROLES_QUE_MARCAN = ['admin', 'coordinador', 'lider', 'sublider'];
const ROLES_QUE_AGREGAN = ['admin', 'coordinador', 'lider'];
const VENTANA_DIAS = 7;                 // lo marcado sin señal se acepta hasta una semana después
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const err = (estado, mensaje) => { const e = new Error(mensaje); e.estado = estado; e.mensaje = mensaje; return e; };

/**
 * Los eventos en los que `rol` puede MARCAR (condición sobre `eventos` con el alias dado). Un sublíder: responsable o invitado. Los demás: lo que gestionan.
 * Falla cerrado sin usuario.
 */
function alcanceMarcar(alcance, rol, alias = 'e') {
  if (!alcance || !ROLES_QUE_MARCAN.includes(rol)) return { sql: '1 = 0', valores: [] };
  if (rol === 'sublider') {
    if (!alcance.usuarioId) return { sql: '1 = 0', valores: [] };
    const yo = alcance.usuarioId;
    return { sql: `(${alias}.responsable_id = ? OR EXISTS (SELECT 1 FROM evento_asistentes ea WHERE ea.evento_id = ${alias}.id AND ea.usuario_id = ?))`, valores: [yo, yo] };
  }
  return alcanceEventos(alcance, alias, true);
}

/** El instante de la captura, en ms: el del cuerpo (`marcado_en`) o, si no viene (el escritorio), ahora. Lanza 400/422 si está en el futuro o es muy viejo. */
function capturaMs(marcado, ahora = Date.now()) {
  if (marcado === undefined || marcado === null || marcado === '') return ahora;
  const t = Date.parse(marcado);
  if (!Number.isFinite(t)) throw err(400, 'La hora en que se hizo la marca no es válida (marcado_en).');
  if (t > ahora + 5 * 60 * 1000) throw err(400, 'La hora de la marca está en el futuro. Revisa la hora de tu celular.');
  if (t < ahora - VENTANA_DIAS * 86400 * 1000) throw err(422, `Esta marca se hizo hace más de ${VENTANA_DIAS} días y ya no se acepta.`);
  return t;
}

/** `true`/`false` de un valor que llegó en un cuerpo JSON (acepta 1/0, «1»/«0», true/false). Otra cosa: undefined. */
function aBooleano(v) {
  if (v === true || v === 1 || v === '1' || v === 'true') return true;
  if (v === false || v === 0 || v === '0' || v === 'false') return false;
  return undefined;
}

/**
 * Marca «asistió» o «no asistió» a una fila de `evento_asistentes`. Devuelve null si la fila no existe o su evento no está en el alcance de quien marca (el mismo 404),
 * o { id, evento_id, asistio, ignorada, total_invitados, total_asistio }. `ignorada`: había una marca más reciente y esta no cambió nada.
 */
async function marcarAsistencia({ asistenteId, asistio, marcadoMs, usuario, alcance }) {
  const id = Number(asistenteId);
  if (!Number.isInteger(id) || id < 1) return null;
  const [[a]] = await pool.query('SELECT id, evento_id FROM evento_asistentes WHERE id = ?', [id]);
  if (!a) return null;
  const sc = alcanceMarcar(alcance, usuario.rol, 'e');
  const [[e]] = await pool.query(`SELECT e.id FROM eventos e WHERE e.id = ? AND ${sc.sql}`, [a.evento_id, ...sc.valores]);
  if (!e) return null;
  const [r] = await pool.query(
    'UPDATE evento_asistentes SET asistio = ?, asistio_ms = ?, asistio_por = ? WHERE id = ? AND (asistio_ms IS NULL OR asistio_ms <= ?)',
    [asistio ? 1 : 0, marcadoMs, usuario.id, id, marcadoMs]);
  const [[ahora]] = await pool.query('SELECT asistio FROM evento_asistentes WHERE id = ?', [id]);
  const [[c]] = await pool.query('SELECT COUNT(*) AS invitados, COALESCE(SUM(asistio = 1), 0) AS asistieron FROM evento_asistentes WHERE evento_id = ?', [a.evento_id]);
  return { id, evento_id: a.evento_id, asistio: Number(ahora.asistio) === 1, ignorada: r.affectedRows === 0, total_invitados: Number(c.invitados), total_asistio: Number(c.asistieron) };
}

module.exports = { ROLES_QUE_MARCAN, ROLES_QUE_AGREGAN, VENTANA_DIAS, UUID, alcanceMarcar, capturaMs, aBooleano, marcarAsistencia };
