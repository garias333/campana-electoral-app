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
const { normalizarCedula, sqlCedulaNormalizada, buscarUsuarioPorCedula } = require('./normalizarCedula');

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
  // Cédula escrita como esté en cualquiera de las dos tablas («1.053.123.456» = «1053123456»): lib/normalizarCedula.js.
  const u = await buscarUsuarioPorCedula(conexion, normalizarCedula(votante.cedula));
  return u ? u.id : null;
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
       LEFT JOIN usuarios u ON ${sqlCedulaNormalizada('u.numero_identificacion')} = ${sqlCedulaNormalizada('v.cedula')}`
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
         LEFT JOIN usuarios u ON ${sqlCedulaNormalizada('u.numero_identificacion')} = ${sqlCedulaNormalizada('v.cedula')}
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
  return {
    /* `NOT IN` es seguro aquí porque `estructura.usuario_id` es NOT NULL: un
       solo NULL en la lista volvería NULL toda la comparación y la consulta
       no devolvería ni una fila. Verificado en el esquema. */
    sql: `(${columnaUsuario} NOT IN (${sqlRamaDeLosAspirantes(aspirantes)})
           OR JSON_CONTAINS(${columnaApoya}, ?))`,
    valores: [...aspirantes, PROFUNDIDAD_MAXIMA, JSON.stringify(cargoMadre)],
  };
}

/**
 * QUIÉN CUELGA DE UN ASPIRANTE. Es el recorrido que comparten los dos filtros
 * de la estructura, escrito una sola vez para que no se puedan separar.
 *
 * Arranca en `nivel = 1` —los subordinados directos—, así que el aspirante
 * MISMO no entra en el conjunto. Los dos filtros dependen de eso.
 */
function sqlRamaDeLosAspirantes(aspirantes) {
  const marcas = aspirantes.map(() => '?').join(', ');
  return `WITH RECURSIVE rama_asp AS (
            SELECT es.usuario_id AS usuario_id, 1 AS nivel
              FROM estructura es
             WHERE es.activo = 1 AND es.supervisor_id IN (${marcas})
            UNION
            SELECT es2.usuario_id, r.nivel + 1
              FROM rama_asp r
              JOIN estructura es2 ON es2.supervisor_id = r.usuario_id
             WHERE es2.activo = 1 AND r.nivel < ?
          )
          SELECT usuario_id FROM rama_asp`;
}

/**
 * El trozo de WHERE con el que la campaña MADRE SUMA LAS METAS de su equipo.
 *
 * ES LA TERCERA REGLA DE ESTE ARCHIVO, Y LA MÁS ESTRICTA. Ya hay dos:
 * `filtroMadreEstructura` decide a quién VE la madre, y `usuariosDelAspiranteSql`
 * decide a quién ADMINISTRA. Esta decide a quién SUMA, y no coincide con
 * ninguna de las dos.
 *
 * La diferencia está en `apoya_a`, y conviene verla con nombres. Pedro es
 * aspirante al Concejo y prometió 2.000 votos a la Alcaldía al inscribirse en
 * la campaña principal. Sus líderes son Carlos, que marca «concejo» y
 * «asamblea», y Jorge, que marca «concejo» y «alcaldía».
 *
 *   · Para VER, Jorge sale en la estructura de la Alcaldía: trabaja para las
 *     dos y las dos lo cuentan como gente suya. Carlos no sale.
 *   · Para SUMAR, ninguno de los dos cuenta — tampoco Jorge. Los 2.000 de
 *     Pedro YA SON el compromiso de toda su rama con la Alcaldía. Sumarle
 *     encima los 100 de Jorge sería contar dos veces la misma promesa.
 *
 * Por eso aquí no hay escapatoria por `apoya_a` y por eso la función no recibe
 * `cargoMadre`: no hay nada que comparar contra él. Si algún día alguien
 * intenta «unificar» las tres reglas, esto es lo que se rompe, y se rompe en
 * silencio: el número sigue saliendo, solo que inflado.
 *
 * OJO, ESTO ES SOLO PARA LA META. El AVANCE es al revés: un votante que
 * registra Carlos y marca «alcaldía» SÍ cuenta para la Alcaldía, porque ahí lo
 * que manda es a quién apoya el votante, no de quién cuelga quien lo registró.
 * Aplicar este filtro también al avance dejaría a la campaña con la meta bien
 * y los registros de menos — que es peor que el problema original.
 *
 * Devuelve null si no hay aspirantes activos, y entonces la consulta queda
 * exactamente como estaba.
 */
async function filtroMetaMadreEstructura(conexion, columnaUsuario = 'e.usuario_id') {
  const aspirantes = await aspirantesActivos(conexion);
  if (!aspirantes.length) return null;
  return {
    sql: `${columnaUsuario} NOT IN (${sqlRamaDeLosAspirantes(aspirantes)})`,
    valores: [...aspirantes, PROFUNDIDAD_MAXIMA],
  };
}

/**
 * DE QUE CAMPANA SON LOS DATOS DE QUIEN PREGUNTA. 0 es la campana principal.
 *
 * Vivia en routes/diaD.routes.js, y desde que hay mas de un fichero que
 * necesita separar por campana —los puestos del Dia D y el estimado por
 * puesto— tenerlo alli obligaba a copiarlo. Dos copias de esta regla se
 * separan el dia que alguien toque una: la de aqui es la unica.
 *
 * Dos maneras, y hacen falta las dos:
 *   · Con sublicencia -el aspirante en su panel- es el mismo.
 *   · Sin ella, se sube por la cadena de mando hasta el aspirante mas cercano.
 *     Eso es lo que hace que un TESTIGO suyo reporte contra los candidatos de
 *     su campana y no contra los de la madre.
 */
async function duenoDeLaCampana(conexion, req) {
  if (req && req.sublicencia) return req.sublicencia.usuario_id;
  return (await aspiranteDe(conexion, req && req.session && req.session.usuario && req.session.usuario.id)) || 0;
}

/**
 * LOS TESTIGOS DE LA MADRE: los suyos, sin los de las ramas de los aspirantes.
 *
 * Es la CUARTA regla, y va aparte a propósito. El archivo avisa arriba de que
 * unificarlas rompe cosas en silencio, así que esto no reutiliza la de la meta
 * aunque la forma coincida: comparten el ayudante, no el significado.
 *
 * SIN ESCAPATORIA POR `apoya_a`, y ahí está la diferencia con
 * `filtroMadreEstructura`. Para VER la estructura, alguien de la rama de Pedro
 * que marca «alcaldía» también es de la madre: apoyar a los dos es normal y
 * ninguna de las dos campañas pierde nada por verlo.
 *
 * Un testigo no es eso. Es una asignación operativa del día de la elección —
 * una persona, un puesto, una mesa— y no puede estar en dos sitios a la vez:
 * quien lo nombró es de quien es. Si el testigo que puso el aspirante saliera
 * también en el Día D de la madre por marcar «alcaldía», las dos campañas
 * creerían tener cubierta esa mesa y el día D una de las dos se queda sin
 * nadie, sin que nada lo avise hasta que ya no hay remedio.
 *
 * Devuelve null si no hay aspirantes activos, y entonces la consulta queda
 * exactamente como estaba.
 */
async function filtroTestigosMadre(conexion, columnaUsuario = 'e.usuario_id') {
  const aspirantes = await aspirantesActivos(conexion);
  if (!aspirantes.length) return null;
  return {
    sql: `${columnaUsuario} NOT IN (${sqlRamaDeLosAspirantes(aspirantes)})`,
    valores: [...aspirantes, PROFUNDIDAD_MAXIMA],
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
  filtroMetaMadreEstructura,
  filtroTestigosMadre,
  duenoDeLaCampana,
  usuariosDelAspiranteSql,
  aspirantesActivos,
  filtroAspirante,
  subarbolSql,
  PROFUNDIDAD_MAXIMA,
};
