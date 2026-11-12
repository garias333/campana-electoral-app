/**
 * lib/alcanceCampanas.js — A QUIÉN LE ESCRIBE Y QUÉ HISTORIAL VE CADA ROL EN EL CRM (parche 327).
 *
 * Hasta el 326 todo /api/comunicaciones solo pedía rol (admin, coordinador, líder, asistente
 * administrativo), sin acotar nada por quien pregunta:
 *   · un líder veía y borraba el historial de TODAS las campañas de mensajes;
 *   · la vista previa y el buscador de destinatarios le devolvían el teléfono o el correo de toda la
 *     base, y «Enviar» le dejaba escribirle a toda la base eligiendo la fuente «votantes» o «ambos».
 *
 * LAS DECISIONES DE GILDARDO (orden 41):
 *   · historial: el administrador ve todo; el coordinador lo que envió él y su rama; el líder lo suyo y lo
 *     de su equipo; el asistente administrativo solo lo suyo. Borrar una campaña: solo el administrador.
 *   · destinatarios: el líder y el asistente quedan acotados a su alcance en TODAS las fuentes. (El
 *     coordinador y el administrador siguen como estaban.)
 *
 * «EQUIPO» / «RAMA» es el mismo patrón de lib/alcanceVotantes.js: `estructura.supervisor_id` ata a cada
 * persona con quien la supervisa (guarda un `usuarios.id`), a uno y a dos niveles.
 *
 * FUERA DEL ALCANCE SE RESPONDE 404, NO 403: un 403 le confirma a quien pregunta que esa campaña existe.
 */
'use strict';

const pool = require('../config/db');

/** Los roles cuyo envío se acota a su alcance. El aspirante entra con rol 'lider', así que queda incluido. */
const ROLES_ACOTADOS = ['lider', 'asistente_administrativo'];

/** ¿Hay que acotar a quien pregunta (destinatarios del CRM)? */
function debeAcotarEnvio(req) {
  const u = req.session && req.session.usuario;
  return !!u && ROLES_ACOTADOS.includes(u.rol);
}

/**
 * La condición «esta columna es del usuario o de su rama (a uno y dos niveles)». Devuelve SQL con 3 marcadores
 * y los 3 valores. `columna` es una expresión que vale un `usuarios.id` (por ejemplo `c.created_by`).
 */
function sqlDeMiRama(columna, usuarioId) {
  const id = Number(usuarioId);
  return {
    sql: `(${columna} = ?
        OR ${columna} IN (SELECT el.usuario_id FROM estructura el
                           WHERE el.activo = 1 AND el.supervisor_id = ?)
        OR ${columna} IN (SELECT es.usuario_id FROM estructura es
                            JOIN estructura el2 ON el2.usuario_id = es.supervisor_id
                           WHERE es.activo = 1 AND el2.activo = 1 AND el2.supervisor_id = ?))`,
    params: [id, id, id],
  };
}

/**
 * Qué campañas del historial ve quien pregunta, como condición sobre `created_by`.
 *   administrador → todas · coordinador, líder y aspirante → lo suyo y su rama · el resto → solo lo suyo.
 * Una campaña sin autor (`created_by` NULL, el usuario se borró) solo la ve el administrador.
 */
function condicionCampanas(req, columna = 'c.created_by') {
  const u = req.session.usuario;
  if (u.rol === 'admin') return { sql: '1 = 1', params: [] };
  if (['coordinador', 'lider'].includes(u.rol)) return sqlDeMiRama(columna, u.id);
  return { sql: `${columna} = ?`, params: [Number(u.id)] };
}

/** ¿Esta campaña está en el historial de quien pregunta? */
async function campanaEnAlcance(req, campanaId) {
  const n = Number(campanaId);
  if (!Number.isInteger(n) || n < 1) return false;
  const a = condicionCampanas(req);
  const [filas] = await pool.query(
    `SELECT 1 FROM comunicaciones_campanas c WHERE c.id = ? AND ${a.sql} LIMIT 1`, [n, ...a.params]);
  return filas.length > 0;
}

/**
 * Los usuarios (ids) a los que alcanza quien pregunta: él y su rama. Es lo que se compara al agregar a alguien a
 * un evento. El administrador devuelve null («cualquiera»).
 */
async function idsDeMiRama(req) {
  const u = req.session.usuario;
  if (u.rol === 'admin') return null;
  const a = sqlDeMiRama('u.id', u.id);
  const [filas] = await pool.query(`SELECT u.id FROM usuarios u WHERE ${a.sql}`, a.params);
  return filas.map(f => f.id);
}

module.exports = { ROLES_ACOTADOS, debeAcotarEnvio, sqlDeMiRama, condicionCampanas, campanaEnAlcance, idsDeMiRama };
