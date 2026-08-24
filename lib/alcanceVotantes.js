/**
 * A QUÉ VOTANTES LLEGA CADA QUIEN. Una sola copia, para dos consumidores.
 *
 * Vivía dentro de `routes/votantes.routes.js`, que era su único usuario. Dejó
 * de serlo cuando el estimado por puesto —en esta ruta y en el dashboard— tuvo
 * que acotarse igual. Copiarla habría dejado dos versiones de la misma regla, y
 * la que no se tocara al cambiar la otra seguiría enseñando de más sin avisar.
 */
function condicionAlcanceVotantes(alcance, alias) {
  const col = (alias === undefined ? 'v.' : (alias ? alias + '.' : '')) + 'lider_id';
  const pre = (alias === undefined ? 'v' : (alias ? alias : 'votantes'));
  /* EL ASPIRANTE NO SE MIDE POR `lider_id`.
     Su gente es la de su rama —calculada al guardar, en `rama_aspirante_id`—
     más la que se sumó a mano (`votante_ramas`). Preguntar por quién tecleó la
     ficha le devolvía cero. */
  if (alcance.cargo === 'aspirante') {
    /* `excluido` ES LO QUE HACE QUE «ELIMINAR» NO BORRE.
       Cuando un aspirante quita a alguien de su base, no se toca la ficha: se
       marca aqui. Deja de verla el —y solo el—, y la campaña madre y los demas
       aspirantes siguen con su dato intacto. */
    return `((${pre}.rama_aspirante_id = ?
             OR EXISTS (SELECT 1 FROM votante_ramas vr
                         WHERE vr.votante_id = ${pre}.id AND vr.aspirante_id = ? AND vr.excluido = 0))
            AND NOT EXISTS (SELECT 1 FROM votante_ramas vx
                             WHERE vx.votante_id = ${pre}.id AND vx.aspirante_id = ? AND vx.excluido = 1))`;
  }
  if (alcance.cargo === 'coordinador') {
    return `(${col} = ?
             OR ${col} IN (SELECT el.usuario_id FROM estructura el
                            WHERE el.activo = 1 AND el.supervisor_id = ?)
             OR ${col} IN (SELECT es.usuario_id FROM estructura es
                             JOIN estructura el2 ON el2.usuario_id = es.supervisor_id
                            WHERE es.activo = 1 AND el2.activo = 1 AND el2.supervisor_id = ?))`;
  }
  return `${col} = ?`;
}

/** Los parámetros que consume la condición de arriba (1 o 3 veces el id). */
function parametrosAlcanceVotantes(alcance) {
  if (alcance.cargo === 'aspirante') return [alcance.usuarioId, alcance.usuarioId, alcance.usuarioId];
  return alcance.cargo === 'coordinador'
    ? [alcance.usuarioId, alcance.usuarioId, alcance.usuarioId]
    : [alcance.usuarioId];
}

/**
 * El mismo alcance, en la forma `{sql, valores}` que espera el estimado.
 *
 * Sin `req.alcance` —un administrador— devuelve null y la consulta queda como
 * siempre: sin filtro. Es la diferencia entre «no acotar» y «acotar a nadie».
 */
function filtroAlcanceEstimado(req) {
  if (!req.alcance) return null;
  return {
    sql: condicionAlcanceVotantes(req.alcance, 'v'),
    valores: parametrosAlcanceVotantes(req.alcance),
  };
}

module.exports = { condicionAlcanceVotantes, parametrosAlcanceVotantes, filtroAlcanceEstimado };
