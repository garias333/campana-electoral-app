/**
 * A QUÉ SOLICITUDES LLEGA CADA QUIEN (parche 303). Hermana de lib/alcanceVotantes.js y con las MISMAS reglas de quién ve a quién, pero
 * SIN reutilizarla, y por tres razones que importan:
 *   · la de votantes cruza contra `votante_ramas.votante_id` y contra `apoya_a`: con el id de una solicitud en el lugar del de un votante
 *     acertaría mal sin fallar (los dos rangos de id se solapan), y las solicitudes NO tienen vínculo con votantes ni con «apoya a»;
 *   · aquí no hay intención de voto ni nada parecido que cruzar;
 *   · una regla propia se puede probar sola (scripts/probar-solicitudes.js).
 *
 * LA REGLA (la misma de votantes, con `lider_id`, `sublider_id` y `rama_aspirante_id` de la solicitud):
 *   administrador ............ toda la campaña madre (las solicitudes de la rama de un aspirante NO)
 *   coordinador .............. las suyas, las de sus líderes y las de los sublíderes de estos; sin la rama de un aspirante
 *   líder .................... las que él o sus sublíderes registraron
 *   sublíder ................. las que él registró
 *   aspirante (sublicencia) .. las de SU rama
 *   cualquier otro rol ....... solo las que él registró
 * Y a todos, MENOS al administrador y al aspirante, se les SUMA «la que me asignaron» (`responsable_id = yo`): un responsable ve lo
 * que se le pidió atender aunque salga de su rama.
 */
'use strict';

const SUBQUERY_LIDERES = `SELECT el.usuario_id FROM estructura el WHERE el.activo = 1 AND el.supervisor_id = ?`;
const SUBQUERY_SUBLIDERES = `SELECT es.usuario_id FROM estructura es
                               JOIN estructura el2 ON el2.usuario_id = es.supervisor_id
                              WHERE es.activo = 1 AND el2.activo = 1 AND el2.supervisor_id = ?`;

/**
 * @param alcance  `req.alcance` (middleware/auth.js `calcularAlcance`): { cargo, usuarioId, ... }
 * @param alias    alias de la tabla solicitudes en la consulta (por defecto «s»)
 * @returns {{ sql: string, valores: any[] }}
 */
function alcanceSolicitudes(alcance, alias = 's') {
  const a = alias;
  if (!alcance) return { sql: '1 = 0', valores: [] };              // sin alcance, a nadie: acotar a nadie es el error seguro
  const yo = alcance.usuarioId;
  const asignada = yo ? `${a}.responsable_id = ?` : null;
  const conAsignada = (sql, valores) => (asignada ? { sql: `(${sql} OR ${asignada})`, valores: [...valores, yo] } : { sql, valores });

  if (alcance.cargo === 'madre') {
    return { sql: `${a}.rama_aspirante_id IS NULL`, valores: [] };
  }
  if (alcance.cargo === 'aspirante') {
    return { sql: `${a}.rama_aspirante_id = ?`, valores: [yo] };
  }
  if (alcance.cargo === 'coordinador') {
    return conAsignada(
      `(${a}.rama_aspirante_id IS NULL AND (${a}.lider_id = ?
         OR ${a}.lider_id IN (${SUBQUERY_LIDERES})
         OR ${a}.lider_id IN (${SUBQUERY_SUBLIDERES})))`,
      [yo, yo, yo]);
  }
  if (alcance.cargo === 'lider') {
    return conAsignada(`${a}.lider_id = ?`, [yo]);
  }
  if (alcance.cargo === 'sublider') {
    return conAsignada(`(${a}.lider_id = ? OR ${a}.sublider_id = ?)`, [yo, yo]);
  }
  // Cualquier otro rol (asistente administrativo, testigo, invitado…): solo lo que él registró.
  return conAsignada(`${a}.registrado_por = ?`, [yo]);
}

/**
 * A QUIÉN SE LE PUEDE ASIGNAR UNA SOLICITUD. El administrador, a cualquiera con cuenta activa de un rol de trabajo; el coordinador, a sí
 * mismo, a sus líderes y a los sublíderes de estos (lo que ya es de su rama). Los demás, a nadie.
 * @returns {{ sql: string, valores: any[] } | null}  condición sobre `u.id` (null = no puede asignar)
 */
function asignablesPara(alcance) {
  if (!alcance) return null;
  if (alcance.cargo === 'madre') return { sql: '1 = 1', valores: [] };
  if (alcance.cargo === 'coordinador') {
    return { sql: `(u.id = ? OR u.id IN (${SUBQUERY_LIDERES}) OR u.id IN (${SUBQUERY_SUBLIDERES}))`, valores: [alcance.usuarioId, alcance.usuarioId, alcance.usuarioId] };
  }
  return null;
}

module.exports = { alcanceSolicitudes, asignablesPara };
