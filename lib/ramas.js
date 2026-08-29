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
 * hasta topar con uno que tenga sublicencia ACTIVA. Devuelve su fila
 * —`usuario_id`, `nivel` y `cargo`—, o null si no cuelga de ninguno.
 *
 * EL `cargo` VIENE EN LA MISMA CONSULTA A PROPOSITO. Quien pregunta por la rama
 * casi siempre necesita despues a que aspira ese aspirante (los apoyos que
 * ofrece su gente, por ejemplo), y sacarlo en un segundo viaje seria subir dos
 * veces la misma cadena. `aspiranteDe` queda como el atajo de siempre para
 * quien solo quiere el id.
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
async function sublicenciaSobre(conexion, usuarioId) {
  if (!usuarioId) return null;
  try {
    const [filas] = await conexion.query(
      `WITH RECURSIVE cadena AS (
         SELECT ? AS usuario_id, 0 AS nivel
         UNION
         SELECT e.supervisor_id, c.nivel + 1
           FROM cadena c
           JOIN estructura e ON e.usuario_id = c.usuario_id
          WHERE e.supervisor_id IS NOT NULL AND c.nivel < ?
       )
       SELECT c.usuario_id, c.nivel, s.cargo
         FROM cadena c
         JOIN sublicencias s ON s.usuario_id = c.usuario_id AND s.activa = 1
        ORDER BY c.nivel ASC
        LIMIT 1`,
      [usuarioId, PROFUNDIDAD_MAXIMA]
    );
    return filas.length ? filas[0] : null;
  } catch (err) {
    /* SIN TABLA `sublicencias` NO HAY RAMAS, Y ESO NO ES UN ERROR. La plantilla
       (electoral) y cualquier campaña que no haya aplicado ese parche no la
       tienen: medido el 27 de agosto de 2026, electoral no la tiene. Es el
       mismo criterio de `middleware/aspirante.js`: seguir como si no hubiera
       aspirantes, en vez de tumbar la pantalla que llamó. */
    if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
    return null;
  }
}

async function aspiranteDe(conexion, usuarioId) {
  const fila = await sublicenciaSobre(conexion, usuarioId);
  return fila ? fila.usuario_id : null;
}

/**
 * De qué rama cuelga un votante. Se parte del sublíder si lo tiene y del líder
 * si no: el sublíder es el eslabón más cercano y el que de verdad lo captó.
 */
async function ramaDeVotante(conexion, votante) {
  /* PRIMERO EL VOTANTE MISMO, SI ES PERSONA DE LA ESTRUCTURA.
     Medido en la campaña municipal el 24 de agosto de 2026: las cinco personas
     que cuelgan de Camilo (`estructura.supervisor_id = 127`) existen también
     como votantes, y su `lider_id` apunta a TRES COORDINADORES distintos —75,
     76, 77— o a nadie. Quien tecleó la ficha no fue él.

     Subiendo sólo desde `lider_id`, la cadena arranca en un coordinador sin
     supervisor y no llega nunca a Camilo: los cinco quedaban con
     `rama_aspirante_id = NULL` y su pantalla decía «0 registros». No era que
     no tuviera gente; era que se preguntaba por el camino equivocado.

     Pertenecer a la estructura de alguien es una afirmación más fuerte que
     haber sido tecleado por alguien, así que gana. */
  const propio = votante.usuario_id || await usuarioDeVotante(conexion, votante);
  if (propio) {
    const suya = await aspiranteDe(conexion, propio);
    if (suya) return suya;
  }
  const desde = votante.sublider_id || votante.lider_id;
  return aspiranteDe(conexion, desde);
}

/**
 * El `usuarios.id` de un votante que además tiene cuenta, cruzando por cédula.
 *
 * `votantes.cedula` y `usuarios.numero_identificacion` son la misma cosa con
 * dos nombres: es el único puente entre las dos tablas. Devuelve null si esa
 * persona no tiene cuenta, que es el caso de la mayoría.
 */
async function usuarioDeVotante(conexion, votante) {
  if (!votante.cedula) return null;
  const [filas] = await conexion.query(
    'SELECT id FROM usuarios WHERE numero_identificacion = ? LIMIT 1', [votante.cedula]);
  return filas.length ? filas[0].id : null;
}

/**
 * Recalcula `rama_aspirante_id` de todos los votantes y devuelve qué cambió.
 *
 * NO escribe si el valor no cambia: `actualizado_en` de la fila es un dato que
 * alguien mira, y tocarlo en cada corrida convertiría «modificado hoy» en ruido.
 */
async function recalcularTodas(conexion, { simular = false } = {}) {
  /* SE TRAE EL `usuario_id` DE UNA VEZ, NO UNA CONSULTA POR FILA.
     Sin este LEFT JOIN, cada votante costaría una consulta extra sólo para
     averiguar si tiene cuenta — y la inmensa mayoría no la tiene. */
  const [votantes] = await conexion.query(
    `SELECT v.id, v.cedula, v.lider_id, v.sublider_id, v.rama_aspirante_id,
            u.id AS usuario_id
       FROM votantes v
       LEFT JOIN usuarios u ON u.numero_identificacion = v.cedula`
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
 * Recalcula la rama de los votantes afectados por MOVER a alguien de supervisor.
 *
 * EL AGUJERO QUE TAPA. `rama_aspirante_id` es un dato derivado que se escribe
 * al guardar un votante y NADIE volvía a tocar. La cabecera de
 * `scripts/recalcular-ramas.js` decía que también se recalculaba «al mover a
 * alguien en la estructura»; esa mitad de la frase no era cierta. Los tres
 * sitios que escriben `estructura.supervisor_id` —el PUT de editar persona, la
 * importación por Excel y el alta de sublíder desde Votantes— no lo llamaban.
 *
 * Consecuencia medida en el código: la campaña madre reasignaba un líder que
 * colgaba de un aspirante, y los votantes de ese líder conservaban la rama
 * vieja PARA SIEMPRE. El aspirante seguía viendo sus fichas —con nombre,
 * cédula y teléfono— en su pantalla de Votantes, y sus conteos en el panel.
 * El único remedio era correr `recalcular-ramas.js` a mano, y nadie lo sabía.
 *
 * POR QUÉ NO CALCULA LA RAMA POR SU CUENTA. Sería más rápido resolver el
 * aspirante una vez por persona del subárbol —que son pocas— en vez de una vez
 * por votante. Y sería una SEGUNDA implementación de la regla de precedencia
 * («primero su propia posición en la estructura, después el sublíder, después
 * el líder»), que es justo la clase de duplicado que en este proyecto termina
 * divergiendo en silencio. Se reutiliza `ramaDeVotante`, que es la única.
 *
 * A cambio cuesta una consulta o dos por votante afectado, así que NO se llama
 * antes de responder: se lanza después. La ficha ya está guardada y la rama se
 * pone al día un instante más tarde — que es infinitamente mejor que nunca.
 */
async function recalcularRamaDesde(conexion, usuarioId) {
  const nada = { revisados: 0, cambios: [] };
  if (!usuarioId) return nada;
  /* SIN ASPIRANTES NO HAY RAMAS QUE RECALCULAR, y son la mayoría de las
     instalaciones. Se pregunta primero porque es una consulta trivial y evita
     la recursiva y el recorrido de votantes en el caso normal.
     Además cubre lo que la plantilla NO tiene: medido, `electoraldb` no tiene
     ni la tabla `sublicencias` ni la columna `votantes.rama_aspirante_id` —las
     crea el parche de sublicencias—, así que sin esta salida cada edición de
     la estructura dejaría un «Unknown column» en el registro. */
  try {
    if (!(await aspirantesActivos(conexion)).length) return nada;
  } catch (_) { return nada; }
  /* A QUIÉNES ALCANZA. Mover a P mueve todo lo que cuelga de P, así que el
     subárbol es el mismo antes y después: lo que cambió es de quién cuelga P.
     Los votantes afectados son los que se cuelgan de alguien de ese subárbol,
     por cualquiera de las tres vías que mira `ramaDeVotante`: su propia ficha
     de estructura (cruzada por cédula), su sublíder o su líder. */
  let votantes;
  try {
    [votantes] = await conexion.query(
      `WITH RECURSIVE bajo AS (
         SELECT ? AS usuario_id, 0 AS nivel
         UNION
         SELECT es.usuario_id, b.nivel + 1
           FROM bajo b JOIN estructura es ON es.supervisor_id = b.usuario_id
          WHERE es.activo = 1 AND b.nivel < ?
       )
       SELECT DISTINCT v.id, v.cedula, v.lider_id, v.sublider_id, v.rama_aspirante_id,
              u.id AS usuario_id
         FROM votantes v
         LEFT JOIN usuarios u ON u.numero_identificacion = v.cedula
        WHERE v.lider_id    IN (SELECT usuario_id FROM bajo)
           OR v.sublider_id IN (SELECT usuario_id FROM bajo)
           OR u.id          IN (SELECT usuario_id FROM bajo)`,
      [usuarioId, PROFUNDIDAD_MAXIMA]
    );
  } catch (err) {
    if (err.code !== 'ER_BAD_FIELD_ERROR') throw err;
    return nada;   // hay sublicencias pero no la columna: nada que poner al día
  }

  const cambios = [];
  for (const v of votantes) {
    const nueva = await ramaDeVotante(conexion, v);
    if ((v.rama_aspirante_id || null) === (nueva || null)) continue;   // no se toca lo que no cambia
    cambios.push({ votanteId: v.id, antes: v.rama_aspirante_id || null, ahora: nueva || null });
    await conexion.query(`UPDATE votantes SET rama_aspirante_id = ? WHERE id = ?`, [nueva, v.id]);
  }
  return { revisados: votantes.length, cambios };
}

/**
 * La misma cosa, para llamar y olvidarse: registra lo que cambió y no lanza.
 *
 * Va DESPUÉS de responder, como la geocodificación. Que falle poner al día un
 * dato derivado no puede deshacer una edición que el usuario ya dio por hecha.
 */
function recalcularRamaEnSegundoPlano(conexion, usuarioId, motivo) {
  recalcularRamaDesde(conexion, usuarioId)
    .then(r => {
      if (r.cambios.length) {
        console.log(`Ramas al día tras ${motivo}: ${r.cambios.length} de ${r.revisados} votantes cambiaron de rama.`);
      }
    })
    .catch(err => console.error(`No se pudo recalcular la rama tras ${motivo}:`, err.message));
}

/**
 * El subárbol de un aspirante: él y todo el que cuelga de él en `estructura`.
 *
 * Devuelve `{ sql, valores }` con un `IN (...)` listo para pegar. Es la pieza
 * que convierte «dejarlo entrar a la ruta» en «dejarlo ver LO SUYO»: la guarda
 * abre la puerta y esto decide qué hay dentro. Sin el par completo, un
 * aspirante en una ruta de coordinador vería la campaña entera.
 *
 * Baja por `supervisor_id` igual que `aspiranteDe` sube, con el mismo tope de
 * profundidad y el mismo `UNION` —no `UNION ALL`— porque una persona puede
 * tener varias filas en `estructura` (líder y testigo a la vez) y cada una
 * devolvería la misma rama otra vez.
 */
function subarbolSql(aspiranteId, columna) {
  return {
    sql: `${columna} IN (
            WITH RECURSIVE bajo AS (
              SELECT ? AS usuario_id, 0 AS nivel
              UNION
              SELECT es.usuario_id, b.nivel + 1
                FROM bajo b
                JOIN estructura es ON es.supervisor_id = b.usuario_id
               WHERE es.activo = 1 AND b.nivel < ?
            )
            SELECT usuario_id FROM bajo)`,
    valores: [aspiranteId, PROFUNDIDAD_MAXIMA],
  };
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
 * Los aspirantes con sublicencia ACTIVA. Lista vacía —no error— donde la tabla
 * `sublicencias` no existe: la plantilla y las campañas que no han aplicado ese
 * parche no la tienen. Mismo criterio que `sublicenciaSobre`.
 */
async function aspirantesActivos(conexion) {
  try {
    const [filas] = await conexion.query('SELECT usuario_id FROM sublicencias WHERE activa = 1');
    return filas.map(f => f.usuario_id);
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
    return [];
  }
}

/**
 * Qué CUENTAS puede administrar un aspirante: las de su rama que NO apoyan a
 * la campaña madre.
 *
 * OJO, ES UNA REGLA DISTINTA DE LA DE VER. Para la estructura y los votantes,
 * quien marca los dos cargos aparece en las DOS campañas — trabaja para las
 * dos y las dos lo cuentan. Aquí no: administrar una cuenta es restablecer su
 * contraseña, quitarle el segundo factor y borrarla. Eso no se comparte, o dos
 * personas se pisan la clave de un tercero sin enterarse. Cada cuenta tiene un
 * dueño: quien marca «alcaldía» lo administra la alcaldía, y punto.
 *
 * `cargoMadre` sale de la configuración, no se escribe a mano: en una campaña
 * a la Gobernación la frontera la marca «gobernacion».
 *
 * Devuelve `{ sql, valores }` para pegar con AND, o null si no hay cargo de la
 * madre — sin él no hay con qué comparar, y ocultar por si acaso dejaría al
 * aspirante sin ninguna cuenta que administrar.
 */
function usuariosDelAspiranteSql(aspiranteId, cargoMadre, columna = 'u.id', columnaApoya = 'u.apoya_a') {
  if (!aspiranteId || !cargoMadre) return null;
  const dentro = subarbolSql(aspiranteId, columna);
  return {
    /* `JSON_CONTAINS` devuelve NULL si `apoya_a` es NULL, y `NOT NULL` es NULL:
       la fila no pasaría. Por eso el `COALESCE`: quien no ha declarado nada NO
       apoya a la alcaldía, así que es suyo. Es lo contrario del criterio de la
       madre —allí el NULL deja fuera— y es a propósito: una cuenta sin dueño
       declarado la administra quien la tiene en su equipo, no nadie. */
    sql: `(${dentro.sql} AND COALESCE(JSON_CONTAINS(${columnaApoya}, ?), 0) = 0)`,
    valores: [...dentro.valores, JSON.stringify(cargoMadre)],
  };
}

/**
 * El trozo de WHERE con el que la campaña MADRE ve su ESTRUCTURA.
 *
 * POR QUÉ NO SIRVE `filtroMadre`, QUE ES LA MISMA REGLA. Aquella compara
 * `rama_aspirante_id`, y esa columna existe en `votantes` y NO en `usuarios`
 * —comprobado en el esquema: de las dos columnas de rama, `usuarios` solo
 * tiene `apoya_a`—. La rama de una persona de la estructura no está guardada:
 * hay que deducirla bajando por `estructura.supervisor_id`, que es lo que hace
 * el `WITH RECURSIVE` de aquí. Misma regla, distinta forma de averiguar quién
 * está dentro de una rama.
 *
 * EL ASPIRANTE MISMO NO SE FILTRA, y es una decisión, no un descuido: el
 * recorrido arranca en `nivel = 1`, o sea en sus subordinados directos. Él
 * pertenece a la campaña madre por derecho propio —es un líder suyo que
 * además compró una sublicencia—, y esconderlo dejaría huérfanos en el árbol
 * a los de su equipo que SÍ apoyan a la madre, además de borrar la marca que
 * le dice a la campaña quién tiene sublicencia.
 *
 * `JSON_CONTAINS` DEVUELVE NULL SI `apoya_a` ES NULL, y `NULL OR FALSE` es
 * NULL, así que la fila no pasa. Es el mismo comportamiento que ya tiene
 * `filtroMadre` para los votantes: quien está en una rama y no ha declarado a
 * quién apoya, no aparece en la madre. No se inventa una segunda regla.
 *
 * Devuelve null cuando no hay nada que filtrar —sin cargo de la madre o sin
 * aspirantes activos—, y entonces la consulta queda exactamente como antes.
 */
async function filtroMadreEstructura(conexion, cargoMadre,
                                     columnaUsuario = 'e.usuario_id',
                                     columnaApoya = 'u.apoya_a') {
  if (!cargoMadre) return null;
  const aspirantes = await aspirantesActivos(conexion);
  if (!aspirantes.length) return null;
  const marcas = aspirantes.map(() => '?').join(', ');
  return {
    /* `NOT IN` es seguro aquí porque `estructura.usuario_id` es NOT NULL: un
       solo NULL en la lista volvería NULL toda la comparación y la consulta
       no devolvería ni una fila. Verificado en el esquema. */
    sql: `(${columnaUsuario} NOT IN (
             WITH RECURSIVE rama_asp AS (
               SELECT es.usuario_id AS usuario_id, 1 AS nivel
                 FROM estructura es
                WHERE es.activo = 1 AND es.supervisor_id IN (${marcas})
               UNION
               SELECT es2.usuario_id, r.nivel + 1
                 FROM rama_asp r
                 JOIN estructura es2 ON es2.supervisor_id = r.usuario_id
                WHERE es2.activo = 1 AND r.nivel < ?
             )
             SELECT usuario_id FROM rama_asp)
           OR JSON_CONTAINS(${columnaApoya}, ?))`,
    valores: [...aspirantes, PROFUNDIDAD_MAXIMA, JSON.stringify(cargoMadre)],
  };
}

/**
 * El trozo de WHERE con el que un ASPIRANTE ve su rama: por la cadena de mando
 * o por una pertenencia añadida a mano. Sin condición de apoyo — su gente es
 * suya, marque lo que marque.
 */
function filtroAspirante(aspiranteId, alias = 'v') {
  return {
    sql: `((${alias}.rama_aspirante_id = ?
           OR EXISTS (SELECT 1 FROM votante_ramas vr
                       WHERE vr.votante_id = ${alias}.id AND vr.aspirante_id = ? AND vr.excluido = 0))
          AND NOT EXISTS (SELECT 1 FROM votante_ramas vx
                           WHERE vx.votante_id = ${alias}.id AND vx.aspirante_id = ? AND vx.excluido = 1))`,
    valores: [aspiranteId, aspiranteId, aspiranteId],
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
  sublicenciaSobre,
  ramaDeVotante,
  usuarioDeVotante,
  recalcularTodas,
  recalcularRamaDesde,
  recalcularRamaEnSegundoPlano,
  filtroMadre,
  filtroMadreEstructura,
  usuariosDelAspiranteSql,
  aspirantesActivos,
  filtroAspirante,
  subarbolSql,
  opinionSegun,
  guardarOpinion,
  PROFUNDIDAD_MAXIMA,
};
