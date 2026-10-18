/**
 * LOS TERRITORIOS DE UNA PERSONA DE LA ESTRUCTURA — UN SOLO SITIO QUE LOS ESCRIBE.
 *
 * Una persona (coordinador, líder, sublíder…) puede cubrir varios territorios:
 * tres barrios, dos veredas, o —en una campaña departamental— dos municipios.
 *
 * CÓMO SE GUARDA
 *   · `estructura.territorio_id` es EL PRINCIPAL. Se conservó la columna: unas
 *     treinta consultas la leen para decir «el territorio de esta persona»
 *     (listado, exportación, copia a Votantes, mapa) y todas siguen valiendo.
 *   · `estructura_territorios` guarda la lista completa, principal incluido
 *     (`es_principal = 1`). Solo las consultas que preguntan «quién cubre el
 *     territorio X» la miran.
 *
 * EL INVARIANTE
 *   Si `estructura.territorio_id` no es NULL, en `estructura_territorios` hay una
 *   fila con ese territorio y `es_principal = 1`. Lo garantiza que NADIE más
 *   escriba esa columna: ni el POST, ni el PUT, ni la importación de Excel, ni
 *   el alta de sublíderes desde Votantes tocan `estructura.territorio_id` en su
 *   propio SQL; todos llaman a `guardar()`. Quien escriba la columna por fuera
 *   rompe el invariante sin que nada falle: por eso hay una consulta de control
 *   (`CONSULTA_CONTROL`, al final) que debe dar 0.
 *
 * SIN LA TABLA, TODO SIGUE FUNCIONANDO
 *   Si `estructura_territorios` no existe (el código llegó antes que `init-db`),
 *   los lectores devuelven solo el principal y `guardar()` escribe solo la
 *   columna. Es el mismo patrón de `hayExclusiones()`: lo que no está, no rompe.
 *   Eso sí: en ese estado un segundo territorio NO se guarda, y no avisa.
 *
 * NO HAY LLAVE FORÁNEA HACIA `territorios` (puede ser una vista del catálogo),
 * así que aquí no se comprueba que el id exista: es lo mismo que pasaba con la
 * columna sola. Lo que sí se comprueba es que cada id sea un entero positivo.
 */
const pool = require('../config/db');

/** Tope por persona. No es una regla de negocio: es para que un cuerpo mal formado no meta miles de filas. */
const MAX_TERRITORIOS = 50;

/* ¿EXISTE YA `estructura_territorios`? Se pregunta una vez por proceso... pero
   un «no» se vuelve a preguntar cada minuto. Si se recordara para siempre, un
   proceso que arrancó ANTES de que init-db creara la tabla seguiría
   ignorándola hasta reiniciarse. Un «sí» no cambia nunca. */
let _hayPuente = null;
let _revisadaEn = 0;
const REVISAR_DE_NUEVO_MS = 60 * 1000;
async function hayPuente() {
  if (_hayPuente === true) return true;
  const ahora = Date.now();
  if (_hayPuente === false && ahora - _revisadaEn < REVISAR_DE_NUEVO_MS) return false;
  try {
    const [f] = await pool.query("SHOW TABLES LIKE 'estructura_territorios'");
    _hayPuente = f.length > 0;
  } catch (_) { _hayPuente = false; }
  _revisadaEn = ahora;
  return _hayPuente;
}

/**
 * De una lista cruda (lo que llegó en el cuerpo) a una lista limpia: enteros
 * positivos, sin repetidos, EN EL MISMO ORDEN — el primero es el principal.
 * Devuelve `{ lista }` o `{ error }` (texto listo para un 400).
 */
function normalizarLista(crudo) {
  const lista = [];
  for (const valor of (Array.isArray(crudo) ? crudo : [])) {
    if (valor === null || valor === undefined || valor === '') continue;
    const n = Number(valor);
    if (!Number.isInteger(n) || n <= 0) return { error: 'Alguno de los territorios no es válido.' };
    if (!lista.includes(n)) lista.push(n);
  }
  if (lista.length > MAX_TERRITORIOS) {
    return { error: `Una persona no puede tener más de ${MAX_TERRITORIOS} territorios.` };
  }
  return { lista };
}

/**
 * La lista que pide un cuerpo de petición. Acepta `territorio_ids` (arreglo) o,
 * como hasta ahora, solo `territorio_id`.
 *
 *   · `territorio_ids` con algo manda; su primer elemento es el principal.
 *   · Sin él, o vacío, vale `territorio_id` suelto: una lista de uno, o vacía.
 *     Un cliente que no conoce la lista —la app de celular en caché, una
 *     importación— se comporta exactamente como antes.
 */
function listaDesdeCuerpo(cuerpo) {
  const b = cuerpo || {};
  const conLista = Array.isArray(b.territorio_ids) && b.territorio_ids.some(v => v !== null && v !== undefined && v !== '');
  return normalizarLista(conLista ? b.territorio_ids : (b.territorio_id ? [b.territorio_id] : []));
}

/**
 * Escribe los territorios de una persona. Se llama DENTRO de la transacción del
 * escritor (o con el pool, si no hay una) y es el único código que toca
 * `estructura.territorio_id`.
 *
 * `lista`: ya normalizada; el primero es el principal; vacía = sin territorio.
 *
 * `conservarExtras` es para la importación de Excel, que solo trae UN territorio
 * por persona. Un archivo no puede pisar lo que no trae:
 *   · el principal pasa a ser el del archivo, y el principal anterior se
 *     reemplaza (es lo que ya hacía la importación: cambiar su territorio);
 *   · los demás territorios de la persona NO se borran;
 *   · si el archivo no trae territorio y la persona tiene otros, no se toca nada;
 *     si no los tiene, se limpia como antes.
 * Sin esa opción la lista guardada reemplaza a la anterior entera (formularios).
 */
async function guardar(ejecutor, estructuraId, lista, { conservarExtras = false } = {}) {
  const id = Number(estructuraId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('territoriosPersona.guardar: falta el id de estructura.');
  const deseada = Array.isArray(lista) ? lista : [];
  const principal = deseada.length ? deseada[0] : null;

  if (!(await hayPuente())) {
    await ejecutor.query('UPDATE estructura SET territorio_id = ? WHERE id = ?', [principal, id]);
    return { principal, total: principal === null ? 0 : 1, conLista: false };
  }

  if (principal === null) {
    if (conservarExtras) {
      const [[otros]] = await ejecutor.query(
        'SELECT COUNT(*) AS n FROM estructura_territorios WHERE estructura_id = ? AND es_principal = 0', [id]);
      if (Number(otros.n) > 0) return { principal: null, total: Number(otros.n), conLista: true, sinCambios: true };
    }
    await ejecutor.query('DELETE FROM estructura_territorios WHERE estructura_id = ?', [id]);
    await ejecutor.query('UPDATE estructura SET territorio_id = NULL WHERE id = ?', [id]);
    return { principal: null, total: 0, conLista: true };
  }

  if (conservarExtras) {
    // Se va el principal anterior (lo reemplaza el del archivo); los extras se quedan.
    await ejecutor.query(
      'DELETE FROM estructura_territorios WHERE estructura_id = ? AND es_principal = 1 AND territorio_id <> ?',
      [id, principal]);
  } else {
    await ejecutor.query(
      'DELETE FROM estructura_territorios WHERE estructura_id = ? AND territorio_id NOT IN (?)', [id, deseada]);
  }
  await ejecutor.query(
    `INSERT INTO estructura_territorios (estructura_id, territorio_id, es_principal)
     VALUES ?
     ON DUPLICATE KEY UPDATE es_principal = VALUES(es_principal)`,
    [deseada.map(t => [id, t, t === principal ? 1 : 0])]);
  await ejecutor.query('UPDATE estructura SET territorio_id = ? WHERE id = ?', [principal, id]);

  const [[cuenta]] = await ejecutor.query(
    'SELECT COUNT(*) AS n FROM estructura_territorios WHERE estructura_id = ?', [id]);
  return { principal, total: Number(cuenta.n), conLista: true };
}

/**
 * Los territorios de varias personas, con nombre y tipo.
 * Devuelve un Map: id de estructura -> [{ territorio_id, es_principal, nombre, tipo, padre_id }],
 * con el principal PRIMERO. El principal sale de la columna `estructura.territorio_id`
 * —es la fuente de verdad— y la tabla solo aporta los demás; así una persona cuya
 * lista todavía no se rellenó se ve igual que antes.
 */
async function leerListas(ejecutor, estructuraIds) {
  const ids = [...new Set((estructuraIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
  const mapa = new Map();
  if (!ids.length) return mapa;

  const [principales] = await ejecutor.query(
    'SELECT id, territorio_id FROM estructura WHERE id IN (?) AND territorio_id IS NOT NULL', [ids]);
  for (const f of principales) mapa.set(f.id, [{ territorio_id: f.territorio_id, es_principal: 1 }]);

  if (await hayPuente()) {
    const [extras] = await ejecutor.query(
      `SELECT estructura_id, territorio_id FROM estructura_territorios
        WHERE estructura_id IN (?) AND es_principal = 0
        ORDER BY estructura_id, creado_en, territorio_id`, [ids]);
    for (const x of extras) {
      const lista = mapa.get(x.estructura_id) || [];
      if (lista.some(l => l.territorio_id === x.territorio_id)) continue;
      lista.push({ territorio_id: x.territorio_id, es_principal: 0 });
      mapa.set(x.estructura_id, lista);
    }
  }

  const territorioIds = [...new Set([...mapa.values()].flat().map(l => l.territorio_id))];
  if (territorioIds.length) {
    const [nombres] = await ejecutor.query(
      'SELECT id, nombre, tipo, padre_id FROM territorios WHERE id IN (?)', [territorioIds]);
    const porId = new Map(nombres.map(t => [t.id, t]));
    for (const lista of mapa.values()) {
      for (const l of lista) {
        const t = porId.get(l.territorio_id);
        l.nombre = t ? t.nombre : null;
        l.tipo = t ? t.tipo : null;
        l.padre_id = t ? t.padre_id : null;
      }
    }
  }
  return mapa;
}

/**
 * Pega a cada fila de estructura (`fila.id`) su lista:
 *   territorio_ids     [principal, ...otros]
 *   territorios        [{ id, nombre, tipo, es_principal }]
 *   territorios_extra  cuántos hay además del principal (el «+N» del listado)
 * Las filas ya traen `territorio_id`, `territorio_nombre` y `territorio_tipo` del
 * principal; eso no se toca.
 */
async function adjuntarListas(ejecutor, filas) {
  const mapa = await leerListas(ejecutor, filas.map(f => f.id));
  for (const f of filas) {
    const lista = mapa.get(f.id) || [];
    f.territorio_ids = lista.map(l => l.territorio_id);
    f.territorios = lista.map(l => ({
      id: l.territorio_id, nombre: l.nombre || null, tipo: l.tipo || null, es_principal: l.es_principal ? 1 : 0
    }));
    f.territorios_extra = Math.max(0, lista.length - 1);
  }
  return filas;
}

/**
 * Los nombres de los territorios de una persona que NO son el principal, en el
 * texto de la exportación: «Barrio A; Barrio B». Vacío si no tiene otros.
 */
function nombresOtros(lista) {
  return (lista || []).filter(l => !l.es_principal && l.nombre).map(l => l.nombre).join('; ');
}

/**
 * Fragmento SQL: «la persona `alias` tiene asignado el territorio `expr`».
 * Es el principal (columna) O alguno de la lista. Con la tabla ausente queda
 * solo la comparación con la columna, que es lo que había antes.
 *
 * `alias` es el alias de `estructura` en la consulta y `expr` una expresión SQL
 * (`b.id`, `?`, `t.padre_id`…). `aliasPuente` solo cambia si la consulta ya usa
 * `et` para otra cosa.
 */
function sqlAsignado(alias, expr, puente, aliasPuente = 'et') {
  const principal = `${alias}.territorio_id = ${expr}`;
  if (!puente) return principal;
  return `(${principal} OR EXISTS (SELECT 1 FROM estructura_territorios ${aliasPuente}
                                    WHERE ${aliasPuente}.estructura_id = ${alias}.id
                                      AND ${aliasPuente}.territorio_id = ${expr}))`;
}

/**
 * Los parámetros de un `sqlAsignado(alias, '?', puente)`. Con la tabla presente
 * el `?` aparece DOS veces en el SQL (la columna y el EXISTS), sin ella una.
 */
function paramsAsignado(puente, valor) {
  return puente ? [valor, valor] : [valor];
}

/**
 * Una tabla derivada con un renglón por (persona, territorio): el principal y
 * los demás, sin repetir. Para las consultas que necesitan RECORRER los
 * territorios de cada persona y no solo comprobar uno. Columnas:
 * `estructura_id`, `territorio_id`.
 */
function sqlParesPersonaTerritorio(puente) {
  const principales = 'SELECT id AS estructura_id, territorio_id FROM estructura WHERE territorio_id IS NOT NULL';
  return puente
    ? `(${principales} UNION SELECT estructura_id, territorio_id FROM estructura_territorios)`
    : `(${principales})`;
}

/**
 * CONSULTAS DE CONTROL. Cada una debe dar 0; si no, algún escritor tocó
 * `estructura.territorio_id` por fuera de este módulo, o la lista quedó a medias.
 * No se ejecutan desde la aplicación.
 *
 *  1. (la principal) personas con territorio_id que NO tienen su fila principal igual.
 *  2. personas con más de una fila principal.
 *  3. filas principales de personas cuya columna es NULL o es otro territorio.
 */
const CONSULTA_CONTROL = `
SELECT COUNT(*) AS estructuras_sin_fila_principal_igual
  FROM estructura e
 WHERE e.territorio_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM estructura_territorios x
                    WHERE x.estructura_id = e.id
                      AND x.es_principal = 1
                      AND x.territorio_id = e.territorio_id);

SELECT COUNT(*) AS personas_con_mas_de_una_principal
  FROM (SELECT estructura_id FROM estructura_territorios
         WHERE es_principal = 1 GROUP BY estructura_id HAVING COUNT(*) > 1) x;

SELECT COUNT(*) AS filas_principales_que_no_coinciden_con_la_columna
  FROM estructura_territorios x
  JOIN estructura e ON e.id = x.estructura_id
 WHERE x.es_principal = 1
   AND NOT (e.territorio_id <=> x.territorio_id);
`;

module.exports = {
  MAX_TERRITORIOS,
  hayPuente,
  normalizarLista,
  listaDesdeCuerpo,
  guardar,
  leerListas,
  adjuntarListas,
  nombresOtros,
  sqlAsignado,
  paramsAsignado,
  sqlParesPersonaTerritorio,
  CONSULTA_CONTROL,
};
