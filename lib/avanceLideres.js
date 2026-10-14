/**
 * «Avance de mis líderes»: cuántos registros lleva cada líder de un coordinador
 * frente a la meta que se comprometió.
 *
 * LA CONSULTA VIVE AQUÍ Y NO DENTRO DE LA RUTA para poder ejecutarse sola contra
 * una base real, en sesión de solo lectura, sin levantar el servidor ni simular
 * una sesión. Lo que se prueba así es la misma SQL que corre la ruta, no una
 * copia que algún día difiera.
 *
 * QUÉ ES CADA COSA
 *   · Los líderes: filas de `estructura` con cargo 'lider', activas, cuyo
 *     `supervisor_id` es el coordinador. Nadie más: no se recorre hacia abajo
 *     ni hacia los lados.
 *   · La meta: `estructura.meta_votos`. Es el compromiso del líder; no existe
 *     una meta de registros aparte, y el resto de la aplicación ya compara esta
 *     misma cifra contra el número de registros.
 *   · Los registros: votantes DISTINTOS cuyo `lider_id` es el líder o uno de sus
 *     sublíderes. Es la MISMA regla que usa `/dashboard/mi-progreso`, o sea la
 *     cifra que el propio líder ve en su celular: si la del coordinador fuera
 *     otra, los dos se compararían números distintos de la misma persona.
 *
 * POR QUÉ NO LA DE `/territorial/estructura`, QUE TAMBIÉN CUENTA `sublider_id`.
 * Ahí un votante puede contar para DOS líderes a la vez: el de su `lider_id` y
 * quien figure en su `sublider_id`. Medido el 14 de octubre de 2026 en la
 * campaña municipal: el coordinador 131 tiene dos líderes; uno suma 10 por su
 * `lider_id` y el otro 4 por `sublider_id` —los MISMOS 4 votantes ya contados en
 * el primero—, así que la suma de filas da 14 y los votantes distintos son 10.
 * Con `lider_id` un votante tiene un solo dueño, y la suma de las filas de un
 * coordinador es exactamente su número de votantes (comprobado el 14 de octubre
 * de 2026 en los 7 coordinadores con líderes a cargo de esa campaña; hay 9
 * supervisores de líderes, pero 2 son líderes —aspirantes— y no coordinadores).
 *
 * LA ÚNICA FORMA DE QUE UNA SUMA SE INFLE es un dato sucio: una misma persona
 * como sublíder (cargo 'usuario') bajo dos líderes distintos, que no tiene índice
 * único que lo impida. Sus votantes contarían en las dos filas. No hay ningún
 * caso en la campaña de pruebas (consulta de duplicados vacía), pero la
 * precondición es del dato y no de esta consulta.
 *
 * POR QUÉ UN VOTANTE CUENTA UNA SOLA VEZ DENTRO DE UN LÍDER. Cuando registra un
 * líder, `lider_id` es él; cuando registra un sublíder, `lider_id` es SU LÍDER y
 * `sublider_id` es el sublíder (`resolverAtribucion`, en
 * routes/votantes.routes.js). Sumar «los del líder» más «los de sus sublíderes»
 * contaba dos veces a todo votante registrado por un sublíder: un caso real
 * medido dio 8 personas donde la ficha decía 12 (ver «CONTAR PERSONAS DISTINTAS»
 * en routes/territorial.routes.js). Por eso COUNT(DISTINCT).
 */
'use strict';

/**
 * @param {{query: Function}} pool   Una conexión o pool de mysql2/promise.
 * @param {number} coordinadorId     usuarios.id del coordinador.
 * @param {string} [ocultar]         Fragmento ` AND u.es_superadmin = 0` que
 *                                   devuelve `filtroOcultar(usuario, 'u')`, o ''.
 *                                   Es SQL propio —nunca un dato de la petición—.
 * @returns {Promise<{lideres: object[], total: object}>}
 */
async function avanceDeLideres(pool, coordinadorId, ocultar = '') {
  const [filas] = await pool.query(
    `WITH
       lideres AS (
         /* GROUP BY por si una persona figurara dos veces como líder: no hay
            índice único sobre (usuario_id, cargo), y un dato sucio no debe
            salir como dos filas ni como el doble de registros. */
         SELECT e.usuario_id AS id, u.nombre, u.telefono,
                MAX(COALESCE(e.meta_votos, 0)) AS meta
           FROM estructura e
           JOIN usuarios u ON u.id = e.usuario_id
          WHERE e.cargo = 'lider' AND e.activo = 1 AND e.supervisor_id = ?
                ${ocultar}
          GROUP BY e.usuario_id, u.nombre, u.telefono
       ),
       /* Cada líder y su gente, como pares (líder, miembro). El líder se incluye
          a sí mismo: los que registró directamente también son suyos. */
       miembros AS (
         SELECT id AS lider, id AS miembro FROM lideres
         UNION
         SELECT es.supervisor_id, es.usuario_id
           FROM estructura es
          WHERE es.cargo = 'usuario' AND es.activo = 1
            AND es.supervisor_id IN (SELECT id FROM lideres)
       ),
       registros AS (
         SELECT m.lider, COUNT(DISTINCT v.id) AS total
           FROM miembros m JOIN votantes v ON v.lider_id = m.miembro
          GROUP BY m.lider
       )
     SELECT l.id, l.nombre, l.telefono, l.meta,
            COALESCE(r.total, 0) AS registros,
            (SELECT COUNT(*) FROM miembros m2
              WHERE m2.lider = l.id AND m2.miembro <> l.id) AS sublideres
       FROM lideres l
       LEFT JOIN registros r ON r.lider = l.id`,
    [coordinadorId]
  );

  const lideres = filas.map((f) => {
    const metaBruta = Number(f.meta) || 0;
    const registros = Number(f.registros) || 0;
    /* «SIN META» ES NULA, CERO O NEGATIVA. El alta guarda `meta_votos || 0` sin
       validar el signo, así que un -40 es posible; no es una meta con la que
       comparar a nadie. Se dice «sin meta» y NO se deja el negativo en el dato:
       sumado al total, restaría del denominador de todos los demás. */
    const sinMeta = metaBruta <= 0;
    const meta = sinMeta ? 0 : metaBruta;
    return {
      id: f.id,
      nombre: f.nombre,
      telefono: f.telefono || null,
      meta,
      registros,
      sublideres: Number(f.sublideres) || 0,
      sin_meta: sinMeta,
      /* `cumplida` SE CALCULA CON LOS NÚMEROS, NO CON EL PORCENTAJE REDONDEADO.
         Con un decimal, 1.999 de 2.000 redondea a 100 % y la barra se pondría
         verde —«cumplido»— a un registro de la meta. */
      cumplida: !sinMeta && registros >= meta,
      porcentaje: sinMeta ? null : porcentajeDe(registros, meta),
    };
  });

  /* DE MENOR A MAYOR PORCENTAJE, para ver primero a quién hay que empujar. Quien
     no tiene meta no tiene porcentaje con el que compararlo: va al final, y no
     al principio, para no taparle a quien sí va retrasado. Empate: por nombre,
     para que el orden no cambie de una carga a otra. */
  lideres.sort((a, b) => {
    if (a.sin_meta !== b.sin_meta) return a.sin_meta ? 1 : -1;
    if (!a.sin_meta && a.porcentaje !== b.porcentaje) return a.porcentaje - b.porcentaje;
    return String(a.nombre).localeCompare(String(b.nombre), 'es');
  });

  /* EL TOTAL COMPARA LO COMPARABLE. Numerador y denominador salen del MISMO
     conjunto: los líderes que tienen meta. Antes `registros` sumaba a todos y
     `meta` solo a los que la tienen, y un líder sin meta con 90 registros hacía
     que un coordinador cuyo único líder con meta iba en 10 % viera «100 %» y la
     barra verde — lo primero que se mira en la pantalla.
     Los registros de quien no tiene meta no se pierden: van aparte, en
     `registros_sin_meta`, para decirlos sin mezclarlos. Las dos cifras juntas
     son la suma de las filas. */
  const conMeta = lideres.filter((l) => !l.sin_meta);
  const sinMetaLista = lideres.filter((l) => l.sin_meta);
  const suma = (lista, campo) => lista.reduce((a, l) => a + l[campo], 0);
  const meta = suma(conMeta, 'meta');
  const registros = suma(conMeta, 'registros');
  const total = {
    lideres: lideres.length,
    con_meta: conMeta.length,
    sin_meta: sinMetaLista.length,
    meta,
    registros,
    registros_sin_meta: suma(sinMetaLista, 'registros'),
    sin_meta_total: conMeta.length === 0,
    cumplida: meta > 0 && registros >= meta,
    porcentaje: meta > 0 ? porcentajeDe(registros, meta) : null,
  };

  return { lideres, total };
}

/**
 * El porcentaje con un decimal, SIN TOPE DE 100: quien supera su meta tiene que
 * verse como 143 %, no como 100. (`/mi-progreso` y `/progreso-equipo` sí lo
 * topan; aquí la pantalla existe justo para distinguir a quien va por detrás de
 * quien va por delante.) Un decimal, porque 12 de 2.000 es 0,6 % y redondeado a
 * entero se leería como 1 %, y 1 de 2.000 como 0 %.
 *
 * NUNCA REDONDEA HACIA ARRIBA HASTA 100: mientras falte aunque sea un registro
 * dice 99,9 %. El 100 % solo lo muestra quien de verdad llegó.
 */
function porcentajeDe(registros, meta) {
  const p = (registros / meta) * 100;
  const redondeado = Math.round(p * 10) / 10;
  return p < 100 && redondeado >= 100 ? 99.9 : redondeado;
}

module.exports = { avanceDeLideres };
