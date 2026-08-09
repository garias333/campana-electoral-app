/**
 * La Meta de votos EFECTIVA de una persona, en SQL.
 *
 * Dos cargos no tienen meta propia: la suya se DERIVA de su equipo, y se
 * calcula al leer, nunca se guarda.
 *
 *   - Coordinador ................ suma la meta de los Líderes de su
 *                                  Comuna/Corregimiento (por territorio:
 *                                  el territorio del líder cuelga del suyo).
 *   - Coordinador Organizaciones . suma la meta de sus gremiales (por
 *                                  supervisor: este cargo NO tiene
 *                                  territorio geográfico).
 *
 * Cualquier otro cargo usa su propio `meta_votos`.
 *
 * POR QUÉ AL LEER Y NO GUARDADO. Antes, el Coordinador Organizaciones
 * guardaba el total en `meta_votos` (un "piso" manual `meta_votos_base`
 * más la suma de sus gremiales). Eso son dos fuentes de verdad para el
 * mismo número, y se desincronizaron: el 9 de agosto de 2026 la única
 * persona con ese cargo tenía 1150 guardados con un piso de 1000 y CERO
 * gremiales — 150 de un estado anterior, sin error ni aviso. Un valor
 * derivado al leer no puede quedar rancio.
 *
 * `meta_votos_base` sigue en la tabla y se sigue llenando para los demás
 * cargos, pero para el Coordinador Organizaciones ya NO se lee: su meta
 * no tiene parte manual. Sin nada manual que reguardar, desaparece solo
 * el riesgo de que el total ya sumado se tomara como nuevo piso y se
 * fuera inflando en cada guardado.
 *
 * UNA SOLA COPIA, A PROPÓSITO. Esta regla estaba escrita tres veces
 * (territorial.routes.js y dos veces en dashboard.routes.js) y agregar
 * la rama nueva la habría dejado en seis. Es la misma trampa que
 * CLAUDE.md documenta para ctc_normalizar()/normalizar(): dos copias
 * divergen solas, y aquí el síntoma sería que el tablero y el listado
 * muestran metas distintas para la misma persona.
 */

/**
 * Tipos de cargo "gremiales" — quien tenga uno de estos y le reporte a un
 * Coordinador Organizaciones, suma su meta a la de él.
 */
const TIPOS_GREMIALES = [
  'presidente_gremio',
  'presidente_asociacion',
  'organizaciones_sociales',
  'organizaciones_religiosas'
];

// Va embebido en SQL, así que se arma desde la constante de arriba en vez
// de escribirlo a mano: los valores son literales fijos del ENUM, no
// entran datos de nadie. Si algún día salen de una petición, esto tiene
// que volver a ser un marcador `?`.
const LISTA_GREMIALES_SQL = TIPOS_GREMIALES.map(t => `'${t}'`).join(', ');

/**
 * Devuelve la expresión SQL de la meta efectiva, para usar en un SELECT.
 *
 * @param {string} alias  Alias de la tabla `estructura` en la consulta
 *                        que la va a usar (casi siempre 'e').
 */
function sqlMetaEfectiva(alias = 'e') {
  return `(CASE
    WHEN ${alias}.cargo = 'coordinador' THEN (
      SELECT COALESCE(SUM(el.meta_votos), 0)
        FROM estructura el
        JOIN territorios tl ON tl.id = el.territorio_id
       WHERE el.cargo = 'lider' AND el.activo = 1 AND tl.padre_id = ${alias}.territorio_id
    )
    WHEN ${alias}.cargo = 'coordinador_organizaciones' THEN (
      SELECT COALESCE(SUM(eg.meta_votos), 0)
        FROM estructura eg
        JOIN usuarios ug ON ug.id = eg.usuario_id
       WHERE eg.supervisor_id = ${alias}.usuario_id
         AND eg.activo = 1
         AND ug.tipo_cargo IN (${LISTA_GREMIALES_SQL})
    )
    ELSE ${alias}.meta_votos
  END)`;
}

/** Los dos cargos cuya meta es derivada — el formulario no la deja editar. */
const CARGOS_CON_META_DERIVADA = ['coordinador', 'coordinador_organizaciones'];

module.exports = { TIPOS_GREMIALES, CARGOS_CON_META_DERIVADA, sqlMetaEfectiva };
