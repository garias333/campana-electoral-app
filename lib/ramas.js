/**
 * Ramas de aspirantes — quién ve a quién.
 *
 * LA REGLA, ENTERA: el aspirante ve todo lo de su rama; la campaña madre ve lo
 * de fuera de esa rama, más lo de dentro que marque «apoya a». Vale igual para
 * votantes y para miembros de la estructura, y no hay una segunda regla.
 *
 * ESTE MÓDULO NO CAMBIA NADA POR SÍ SOLO. Calcula, guarda y ofrece los trozos
 * de SQL; que una pantalla los use es un paso posterior y deliberado. Mientras
 * ninguna ruta llame a `filtroMadre`, la aplicación se comporta exactamente
 * como antes.
 *
 * POR QUÉ LA RAMA SE GUARDA Y NO SE CALCULA CADA VEZ. Subir por la cadena de
 * mando es una CTE recursiva; la lista de votantes se pinta muchas veces al
 * día y llevaría una por fila. Se calcula al guardar y se guarda. El precio es
 * el de siempre con un dato derivado: si alguien cambia la cadena por fuera de
 * la aplicación, queda viejo — para eso está `recalcularTodas()`, que es barato
 * y se puede correr cuando se dude.
 */

/** Hasta dónde se sube antes de rendirse. Una cadena de mando de más de veinte
 *  niveles no existe en una campaña: si se llega ahí, hay un ciclo. */
const PROFUNDIDAD_MAXIMA = 20;

/**
 * El aspirante del que cuelga un usuario, subiendo por `estructura.supervisor_id`
 * hasta topar con uno que tenga sublicencia ACTIVA. Devuelve su `usuarios.id`,
 * o null si no cuelga de ninguno.
 *
 * Se cuenta a sí mismo: un aspirante pertenece a su propia rama, y sin esto los
 * votantes que él registra directamente se quedarían fuera de su propia vista.
 *
 * OJO CON EL `UNION`, QUE AQUÍ HACE UN TRABAJO CONCRETO. Una persona puede
 * tener VARIAS filas en `estructura` —11 de 52 en la campaña municipal son
 * «líder» y «testigo» a la vez— y el paso recursivo devolvería a su supervisor
 * una vez por fila, multiplicando la cadena en cada nivel. `UNION` (y no
 * `UNION ALL`) colapsa esos repetidos.
 *
 * La solución evidente —`SELECT DISTINCT` en el paso recursivo— MySQL la
 * rechaza: «doesn't yet support SELECT DISTINCT in recursive query block».
 * Probado el 24 de agosto de 2026. El `UNION` consigue lo mismo y sí se admite.
 */
async function aspiranteDe(conexion, usuarioId) {
  if (!usuarioId) return null;
  const [filas] = await conexion.query(
    `WITH RECURSIVE cadena AS (
       SELECT ? AS usuario_id, 0 AS nivel
       UNION
       SELECT e.supervisor_id, c.nivel + 1
         FROM cadena c
         JOIN estructura e ON e.usuario_id = c.usuario_id
        WHERE e.supervisor_id IS NOT NULL AND c.nivel < ?
     )
     SELECT c.usuario_id, c.nivel
       FROM cadena c
       JOIN sublicencias s ON s.usuario_id = c.usuario_id AND s.activa = 1
      ORDER BY c.nivel ASC
      LIMIT 1`,
    [usuarioId, PROFUNDIDAD_MAXIMA]
  );
  return filas.length ? filas[0].usuario_id : null;
}

/**
 * De qué rama cuelga un votante. Se parte del sublíder si lo tiene y del líder
 * si no: el sublíder es el eslabón más cercano y el que de verdad lo captó.
 */
async function ramaDeVotante(conexion, votante) {
  const desde = votante.sublider_id || votante.lider_id;
  return aspiranteDe(conexion, desde);
}

/**
 * Recalcula `rama_aspirante_id` de todos los votantes y devuelve qué cambió.
 *
 * NO escribe si el valor no cambia: `actualizado_en` de la fila es un dato que
 * alguien mira, y tocarlo en cada corrida convertiría «modificado hoy» en ruido.
 */
async function recalcularTodas(conexion, { simular = false } = {}) {
  const [votantes] = await conexion.query(
    `SELECT id, lider_id, sublider_id, rama_aspirante_id FROM votantes`
  );

  const cambios = [];
  for (const v of votantes) {
    const nueva = await ramaDeVotante(conexion, v);
    const antes = v.rama_aspirante_id;
    if ((antes || null) === (nueva || null)) continue;
    cambios.push({ votanteId: v.id, antes: antes || null, ahora: nueva || null });
    if (!simular) {
      await conexion.query(`UPDATE votantes SET rama_aspirante_id = ? WHERE id = ?`, [nueva, v.id]);
    }
  }
  return { revisados: votantes.length, cambios };
}

/**
 * El trozo de WHERE con el que la campaña MADRE ve lo que le corresponde.
 *
 * `cargoMadre` sale de la configuración de la campaña —'alcaldia',
 * 'gobernacion'…—, no se escribe a mano: una campaña a la Gobernación compara
 * contra su propio cargo.
 *
 * Devuelve `{ sql, valores }` para pegarlo con AND en la consulta que sea. Se
 * entrega como fragmento y no como consulta hecha porque los sitios que hay que
 * tocar son muchos y cada uno tiene su propio FROM: una función que devolviera
 * la consulta entera obligaría a reescribirlos todos.
 */
function filtroMadre(cargoMadre, alias = 'v') {
  return {
    sql: `(${alias}.rama_aspirante_id IS NULL OR JSON_CONTAINS(${alias}.apoya_a, ?))`,
    valores: [JSON.stringify(cargoMadre)],
  };
}

/**
 * El trozo de WHERE con el que un ASPIRANTE ve su rama: por la cadena de mando
 * o por una pertenencia añadida a mano. Sin condición de apoyo — su gente es
 * suya, marque lo que marque.
 */
function filtroAspirante(aspiranteId, alias = 'v') {
  return {
    sql: `(${alias}.rama_aspirante_id = ?
           OR EXISTS (SELECT 1 FROM votante_ramas vr
                       WHERE vr.votante_id = ${alias}.id AND vr.aspirante_id = ?))`,
    valores: [aspiranteId, aspiranteId],
  };
}

/* ---------------------------------------------------------------------------
   LA VALORACIÓN, SEGÚN QUIÉN MIRE

   `votantes.intencion_voto` y `votantes.observaciones` NO se movieron: pasan a
   significar «lo que piensa la campaña madre», que es lo que ya eran. Un
   aspirante con sublicencia ve su propia valoración si la tiene, y la de la
   madre mientras no la tenga.

   Ese respaldo importa: una sublicencia recién activada muestra de entrada lo
   que la madre sabía, en vez de estrenar a toda su gente en «desconocido» y
   obligar a reclasificar a cien personas para volver al punto de partida.

   `apoya_a` NO entra aquí. Es un hecho declarado por la persona —a quién
   apoya—, no la opinión de una campaña: dos aspirantes no pueden estar en
   desacuerdo sobre si apoya al alcalde. Se queda compartido en `votantes`, que
   además es donde el filtro de la madre lo busca.
   --------------------------------------------------------------------------- */

/**
 * Las columnas de valoración vistas por un aspirante, con respaldo en la madre.
 * Devuelve `{ columnas, join, valores }` para armar el SELECT.
 *
 * Con `aspiranteId` nulo —la madre, o cualquier pantalla de hoy— devuelve las
 * columnas tal cual y sin JOIN: la consulta queda idéntica a la de siempre. Eso
 * es lo que permite meter esto en una consulta existente sin cambiar lo que ve
 * nadie hasta que de verdad haya un aspirante mirando.
 */
function opinionSegun(aspiranteId, alias = 'v') {
  if (!aspiranteId) {
    return {
      columnas: `${alias}.intencion_voto, ${alias}.observaciones`,
      join: '',
      valores: [],
    };
  }
  return {
    columnas: `COALESCE(vo.intencion_voto, ${alias}.intencion_voto) AS intencion_voto,
               COALESCE(vo.observaciones, ${alias}.observaciones) AS observaciones,
               (vo.intencion_voto IS NOT NULL) AS valoracion_propia`,
    join: `LEFT JOIN votante_opinion vo
             ON vo.votante_id = ${alias}.id AND vo.aspirante_id = ?`,
    valores: [aspiranteId],
  };
}

/**
 * Guarda la valoración de un aspirante sobre un votante.
 *
 * Escribe SIEMPRE en `votante_opinion`, nunca en `votantes`: si un aspirante
 * pudiera tocar la fila compartida, cambiaría la valoración de la madre y la de
 * los demás aspirantes sin saberlo. Es justamente lo que esta tabla evita.
 */
async function guardarOpinion(conexion, { votanteId, aspiranteId, intencionVoto, observaciones, usuarioId }) {
  await conexion.query(
    `INSERT INTO votante_opinion (votante_id, aspirante_id, intencion_voto, observaciones, actualizado_por)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       intencion_voto = VALUES(intencion_voto),
       observaciones  = VALUES(observaciones),
       actualizado_por = VALUES(actualizado_por)`,
    [votanteId, aspiranteId, intencionVoto || null, observaciones || null, usuarioId || null]
  );
}

module.exports = {
  aspiranteDe,
  ramaDeVotante,
  recalcularTodas,
  filtroMadre,
  filtroAspirante,
  opinionSegun,
  guardarOpinion,
  PROFUNDIDAD_MAXIMA,
};
