/**
 * A QUÉ TAREAS LLEGA CADA QUIEN, Y A QUIÉN SE LE PUEDE ASIGNAR (parche 305). Hermana de lib/alcanceSolicitudes.js, con la misma idea y SIN
 * reutilizar lib/alcanceVotantes.js: aquella cruza contra `votante_ramas` y `apoya_a`, y con el id de una tarea en el lugar del de un
 * votante acertaría mal sin fallar (los rangos de id se solapan). Una regla propia se puede probar sola.
 *
 * ALCANCE DE LECTURA (sobre `tareas` con el alias `t`)
 *   administrador ......... toda la campaña madre (las tareas de la rama de un aspirante NO)
 *   coordinador ........... las que él, uno de sus líderes o un sublíder de estos CREARON o tienen ASIGNADAS; sin la rama de un aspirante
 *   líder ................. las que creó, las que tiene asignadas y las asignadas a SUS sublíderes (`estructura.supervisor_id`)
 *   sublíder y demás ...... las que creó y las que tiene asignadas
 *   aspirante (sublicencia) las de SU rama (no llega: la lista blanca de middleware/aspirante.js no incluye las tareas)
 *
 * GESTIONAR (editar, reasignar, cancelar, verificar, devolver) es más estrecho que ver:
 *   administrador y coordinador ... lo que ven (el coordinador, su rama)
 *   líder y demás ................. solo lo que CREARON ellos
 * Quien ejecuta (empecé, terminé, no pude) es únicamente el ASIGNADO.
 *
 * A QUIÉN SE ASIGNA (`asignablesPara`, condición sobre `u.id`)
 *   administrador ......... a cualquiera con cuenta activa de un rol de trabajo
 *   coordinador ........... a sí mismo, a sus líderes y a los sublíderes de estos
 *   líder ................. a sí mismo y a sus sublíderes
 *   los demás ............. a nadie
 */
'use strict';

const SUBQUERY_LIDERES = `SELECT el.usuario_id FROM estructura el WHERE el.activo = 1 AND el.supervisor_id = ?`;
const SUBQUERY_SUBLIDERES = `SELECT es.usuario_id FROM estructura es
                               JOIN estructura el2 ON el2.usuario_id = es.supervisor_id
                              WHERE es.activo = 1 AND el2.activo = 1 AND el2.supervisor_id = ?`;
const SUBQUERY_MIS_SUBLIDERES = `SELECT es.usuario_id FROM estructura es WHERE es.activo = 1 AND es.cargo = 'usuario' AND es.supervisor_id = ?`;

/** "la columna es yo, uno de mis líderes o un sublíder de estos", para el coordinador. */
const enRama = (col) => ({ sql: `(${col} = ? OR ${col} IN (${SUBQUERY_LIDERES}) OR ${col} IN (${SUBQUERY_SUBLIDERES}))`, n: 3 });

/**
 * @param alcance  `req.alcance` (middleware/auth.js `calcularAlcance`)
 * @returns {{ sql: string, valores: any[] }}
 */
function alcanceTareas(alcance, alias = 't') {
  const a = alias;
  if (!alcance) return { sql: '1 = 0', valores: [] };
  const yo = alcance.usuarioId;
  if (alcance.cargo === 'madre') return { sql: `${a}.rama_aspirante_id IS NULL`, valores: [] };
  if (!yo) return { sql: '1 = 0', valores: [] };
  if (alcance.cargo === 'aspirante') return { sql: `${a}.rama_aspirante_id = ?`, valores: [yo] };
  if (alcance.cargo === 'coordinador') {
    const c = enRama(`${a}.creada_por`), s = enRama(`${a}.asignada_a`);
    return { sql: `(${a}.rama_aspirante_id IS NULL AND (${c.sql} OR ${s.sql}))`, valores: [yo, yo, yo, yo, yo, yo] };
  }
  if (alcance.cargo === 'lider') {
    return { sql: `(${a}.creada_por = ? OR ${a}.asignada_a = ? OR ${a}.asignada_a IN (${SUBQUERY_MIS_SUBLIDERES}))`, valores: [yo, yo, yo] };
  }
  return { sql: `(${a}.creada_por = ? OR ${a}.asignada_a = ?)`, valores: [yo, yo] };
}

/** Las tareas que quien pregunta puede GESTIONAR (más estrecho que ver). */
function gestionTareas(alcance, alias = 't') {
  const a = alias;
  if (!alcance) return { sql: '1 = 0', valores: [] };
  if (alcance.cargo === 'madre' || alcance.cargo === 'coordinador') return alcanceTareas(alcance, alias);
  if (!alcance.usuarioId || alcance.cargo === 'aspirante') return { sql: '1 = 0', valores: [] };
  return { sql: `${a}.creada_por = ?`, valores: [alcance.usuarioId] };
}

/** A quién se le puede asignar (condición sobre `u.id`), o null si no puede asignar. */
function asignablesPara(alcance) {
  if (!alcance) return null;
  const yo = alcance.usuarioId;
  if (alcance.cargo === 'madre') return { sql: '1 = 1', valores: [] };
  if (!yo) return null;
  if (alcance.cargo === 'coordinador') return { sql: `(u.id = ? OR u.id IN (${SUBQUERY_LIDERES}) OR u.id IN (${SUBQUERY_SUBLIDERES}))`, valores: [yo, yo, yo] };
  if (alcance.cargo === 'lider') return { sql: `(u.id = ? OR u.id IN (${SUBQUERY_MIS_SUBLIDERES}))`, valores: [yo, yo] };
  return null;
}

module.exports = { alcanceTareas, gestionTareas, asignablesPara };
