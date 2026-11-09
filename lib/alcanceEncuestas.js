/**
 * A QUÉ RESPUESTAS DE ENCUESTAS LLEGA CADA QUIEN (parche 308). Hermana de lib/alcanceSolicitudes.js y de lib/alcanceTareas.js, con las MISMAS
 * reglas de quién ve a quién, y SIN reutilizar lib/alcanceVotantes.js: aquélla cruza contra `votante_ramas` y `apoya_a`, y con el id de una
 * respuesta en el lugar del de un votante acertaría mal sin fallar (los rangos de id se solapan). Las respuestas no tienen vínculo con
 * votantes. Una regla propia se puede probar sola (scripts/probar-encuestas-resultados.js).
 *
 * LA REGLA (con `lider_id`, `sublider_id` y `rama_aspirante_id` de la respuesta, que se guardan al registrarla):
 *   administrador ............ toda la campaña madre (las respuestas de la rama de un aspirante NO)
 *   coordinador .............. las de sus líderes, las de los sublíderes de estos y las suyas; sin la rama de un aspirante
 *   líder .................... las que él o sus sublíderes aplicaron
 *   sublíder ................. las que él aplicó
 *   aspirante (sublicencia) .. las de SU rama (la ruta no le llega hoy: no está en la lista de lo que puede alcanzar)
 *   cualquier otro rol ....... solo las que él aplicó (`aplicada_por`)
 *
 * EL ALCANCE NO SUSTITUYE AL MÍNIMO POR CELDA: acota QUÉ respuestas se cuentan, y el mínimo (lib/encuestasResultados.js) decide qué cifras se
 * pueden mostrar de ellas. Un líder con 3 respuestas propias en una zona ve esa zona omitida, igual que el administrador.
 */
'use strict';

const SUBQUERY_LIDERES = `SELECT el.usuario_id FROM estructura el WHERE el.activo = 1 AND el.supervisor_id = ?`;
const SUBQUERY_SUBLIDERES = `SELECT es.usuario_id FROM estructura es
                               JOIN estructura el2 ON el2.usuario_id = es.supervisor_id
                              WHERE es.activo = 1 AND el2.activo = 1 AND el2.supervisor_id = ?`;

/**
 * @param alcance  `req.alcance` (middleware/auth.js `calcularAlcance`): { cargo, usuarioId, ... }
 * @param alias    alias de la tabla encuesta_respuestas en la consulta (por defecto «r»)
 * @returns {{ sql: string, valores: any[] }}
 */
function alcanceEncuestas(alcance, alias = 'r') {
  const a = alias;
  if (!alcance) return { sql: '1 = 0', valores: [] };              // sin alcance, a nadie: acotar a nadie es el error seguro
  const yo = alcance.usuarioId;
  if (alcance.cargo === 'madre') return { sql: `${a}.rama_aspirante_id IS NULL`, valores: [] };
  if (alcance.cargo === 'aspirante') return { sql: `${a}.rama_aspirante_id = ?`, valores: [yo] };
  if (alcance.cargo === 'coordinador') {
    return {
      sql: `(${a}.rama_aspirante_id IS NULL AND (${a}.lider_id = ? OR ${a}.aplicada_por = ?
               OR ${a}.lider_id IN (${SUBQUERY_LIDERES})
               OR ${a}.lider_id IN (${SUBQUERY_SUBLIDERES})))`,
      valores: [yo, yo, yo, yo],
    };
  }
  if (alcance.cargo === 'lider') return { sql: `${a}.lider_id = ?`, valores: [yo] };
  if (alcance.cargo === 'sublider') return { sql: `(${a}.lider_id = ? OR ${a}.sublider_id = ?)`, valores: [yo, yo] };
  return { sql: `${a}.aplicada_por = ?`, valores: [yo] };            // cualquier otro rol: solo lo que él aplicó
}

module.exports = { alcanceEncuestas };
