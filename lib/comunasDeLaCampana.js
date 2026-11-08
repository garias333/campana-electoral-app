/**
 * LA LISTA DE COMUNAS Y CORREGIMIENTOS DE LA CAMPAÑA, y la regla de qué se guarda en
 * `votantes.comuna_corregimiento_residencia` (orden 36).
 *
 * Esa columna es TEXTO LIBRE: ningún camino que la escribe comprobaba nada, y en los formularios la lista
 * es solo una sugerencia (<datalist>), así que alguien podía dejar ahí «MANIZALES» o «Caldas» —la ciudad o el
 * departamento— y la ficha quedaba con un dato que no es una comuna.
 *
 * LA REGLA
 *   · La lista sale de la vista `territorios` (comunas y corregimientos que la campaña ve). Si la campaña NO
 *     tiene ninguna —Quindío: 12 municipios, 232 veredas, cero comunas—, no hay contra qué comprobar y el texto
 *     queda libre, como siempre. Exigir una comuna que no existe haría imposible guardar la ficha.
 *   · Con lista, un valor que no está en ella se guarda VACÍO y se avisa. Nunca se rechaza la ficha por esto:
 *     la comuna es un dato opcional y perder a la persona sería peor que perder el dato.
 *   · La comparación ignora mayúsculas, tildes y espacios repetidos («comuna  1» = «Comuna 1»), y lo que se
 *     guarda es lo que la persona escribió, no se reescribe.
 *
 * NO SE TOCAN LAS FICHAS QUE YA ESTÁN. Esto solo gobierna lo que se escriba de aquí en adelante;
 * `scripts/reporte-comunas.js` dice cuántas hay mal.
 */
'use strict';

/** Minúsculas, sin tildes y con los espacios colapsados: la forma en que se comparan dos nombres. */
function normalizarNombre(texto) {
  return String(texto == null ? '' : texto)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Las comunas y corregimientos que la campaña ve. Nunca lanza: sin la vista `territorios` (o con un error de
 * lectura) devuelve una lista vacía, que significa «texto libre».
 * @param cx pool o conexión mysql2/promise
 * @returns {Promise<{hay: boolean, nombres: Set<string>}>}  nombres ya normalizados
 */
async function listaDeComunas(cx) {
  try {
    const [filas] = await cx.query("SELECT nombre FROM territorios WHERE tipo IN ('comuna','corregimiento')");
    const nombres = new Set(filas.map((f) => normalizarNombre(f.nombre)).filter(Boolean));
    return { hay: nombres.size > 0, nombres };
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') console.error('lista de comunas:', err.code || err.message);
    return { hay: false, nombres: new Set() };
  }
}

/**
 * ¿Se guarda este valor? Función pura, para probarla sin base.
 * @param {string|null|undefined} valor  lo que llegó
 * @param {{hay: boolean, nombres: Set<string>}} lista
 * @returns {{valor: string|null, descartada: string|null}}  `descartada` es el texto que se tiró (o null)
 */
function revisarComuna(valor, lista) {
  const texto = String(valor == null ? '' : valor).trim();
  if (!texto) return { valor: null, descartada: null };
  if (!lista || !lista.hay) return { valor: texto, descartada: null };
  if (lista.nombres.has(normalizarNombre(texto))) return { valor: texto, descartada: null };
  return { valor: null, descartada: texto };
}

/**
 * Atajo para las rutas: lee la lista y revisa el valor de una vez.
 * @returns {Promise<{valor: string|null, descartada: string|null}>}
 */
async function comunaValida(cx, valor) {
  if (!String(valor == null ? '' : valor).trim()) return { valor: null, descartada: null };
  return revisarComuna(valor, await listaDeComunas(cx));
}

module.exports = { normalizarNombre, listaDeComunas, revisarComuna, comunaValida };
