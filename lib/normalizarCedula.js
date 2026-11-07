'use strict';
/**
 * normalizarCedula.js — UNA sola regla para decir «es la misma cédula».
 *
 * SOLO DÍGITOS, SIN CEROS A LA IZQUIERDA: «1.053.123.456», «1 053 123 456» y «01053123456» son la misma
 * persona. Es la regla de `validarFormato` (lib/validarCedula.js: quita lo que no es dígito y luego los
 * ceros del comienzo); aquí está sola para que el formulario público la use también al COMPARAR contra lo que
 * ya hay guardado.
 *
 * POR QUÉ HACE FALTA AL COMPARAR. El alta normal (routes/votantes.routes.js) guarda la cédula TAL COMO SE
 * TECLEÓ, sin normalizarla, y el índice UNIQUE de `votantes.cedula` solo detecta el texto idéntico. Una ficha
 * guardada como «1.053.123.456» no choca con «1053123456»: sin esta regla, el enlace de inscripción crearía
 * una SEGUNDA ficha de la misma persona, sin error y sin aviso.
 *
 * NO se reescribe lo que ya está guardado: otras partes de la aplicación cruzan `votantes.cedula` contra
 * `usuarios.numero_identificacion` por igualdad de texto, y normalizar de un lado solo las rompería.
 */

/** «1.053 123.456» → «1053123456»; «0012345678» → «12345678»; sin dígitos → ''. */
function normalizarCedula(valor) {
  return String(valor == null ? '' : valor).replace(/\D/g, '').replace(/^0+/, '');
}

/** La MISMA regla, escrita en SQL, para una columna que guarda cédulas tecleadas a mano. */
function sqlCedulaNormalizada(columna) {
  return `TRIM(LEADING '0' FROM REGEXP_REPLACE(${columna}, '[^0-9]', ''))`;
}

/** «1053123456» → «***456»: lo que se le muestra a quien NO es dueño de la ficha. */
function enmascararCedula(valor) {
  const d = normalizarCedula(valor);
  return d ? '***' + d.slice(-3) : '***';
}

/** Los últimos tres dígitos (lo único de la cédula que se guarda en la bitácora de intentos). */
function finDeCedula(valor) {
  const d = normalizarCedula(valor);
  return d ? d.slice(-3) : null;
}

/**
 * LA BÚSQUEDA DE UNA CÉDULA YA GUARDADA, para TODAS las entradas de `votantes` (orden 30): el formulario público, el
 * alta normal, la edición, la importación y la sincronización con Estructura. Una sola función, para que la regla
 * no pueda divergir entre ellas (el mismo error que ya costó 194 duplicados en otro sistema por tener dos copias
 * de una regla de normalización).
 *
 * Dos pasos: el exacto, por el índice UNIQUE, y, si no hay, las variantes guardadas con puntos, espacios o ceros a
 * la izquierda (sin índice: solo se paga cuando la cédula es nueva, y el prefiltro descarta de entrada las filas ya
 * normalizadas). Sin FOR UPDATE a propósito: un barrido con bloqueo cerraría todas las filas que recorre.
 *
 * @param cx                    pool o conexión
 * @param cedulaNormalizada     ya pasada por normalizarCedula
 * @param {number|string} [excluirId]  una ficha que no cuenta (la que se está editando)
 * @returns {Promise<{id:number, cedula:string}|null>}  la ficha y la cédula TAL COMO está guardada
 */
async function buscarFichaConCedula(cx, cedulaNormalizada, excluirId = null) {
  if (!cedulaNormalizada) return null;
  const sin = excluirId ? ' AND id <> ?' : '';
  const extra = excluirId ? [excluirId] : [];
  const [[exacta]] = await cx.query(`SELECT id, cedula FROM votantes WHERE cedula = ?${sin} LIMIT 1`, [cedulaNormalizada, ...extra]);
  if (exacta) return exacta;
  const [[variante]] = await cx.query(
    `SELECT id, cedula FROM votantes
      WHERE cedula REGEXP '[^0-9]|^0' AND ${sqlCedulaNormalizada('cedula')} = ?${sin} LIMIT 1`, [cedulaNormalizada, ...extra]);
  return variante || null;
}

/** Solo el id de la ficha (o null). Ver buscarFichaConCedula. */
async function buscarFichaPorCedula(cx, cedulaNormalizada, excluirId = null) {
  const f = await buscarFichaConCedula(cx, cedulaNormalizada, excluirId);
  return f ? f.id : null;
}

/**
 * Lo mismo para MUCHAS cédulas de una vez (una importación de miles de filas): una consulta por el índice más UN
 * barrido de las fichas guardadas con signos o ceros —no uno por fila—. Devuelve Map(cédula normalizada → {id,
 * cedula}). Si una cédula normalizada está en dos fichas viejas, gana la de menor id (la más antigua).
 */
async function mapaDeFichasPorCedula(cx, listaNormalizadas) {
  const mapa = new Map();
  const unicas = [...new Set((listaNormalizadas || []).filter(Boolean))];
  for (let i = 0; i < unicas.length; i += 1000) {
    const [filas] = await cx.query('SELECT id, cedula FROM votantes WHERE cedula IN (?)', [unicas.slice(i, i + 1000)]);
    for (const f of filas) mapa.set(normalizarCedula(f.cedula), f);
  }
  const quedan = new Set(unicas.filter(c => !mapa.has(c)));
  if (quedan.size) {
    const [viejas] = await cx.query(`SELECT id, cedula FROM votantes WHERE cedula REGEXP '[^0-9]|^0' ORDER BY id`);
    for (const f of viejas) {
      const n = normalizarCedula(f.cedula);
      if (quedan.has(n) && !mapa.has(n)) mapa.set(n, f);
    }
  }
  return mapa;
}

/**
 * El usuario (cuenta) cuyo `numero_identificacion` es esta cédula, escrita como esté: «1.053.123.456» y
 * «1053123456» son la misma. `usuarios` es una tabla chica (cientos o pocos miles) y tiene índice UNIQUE: se prueba
 * el exacto y, si no, se compara normalizado.
 */
async function buscarUsuarioPorCedula(cx, cedulaNormalizada, columnas = 'id') {
  if (!cedulaNormalizada) return null;
  const [[exacto]] = await cx.query(`SELECT ${columnas} FROM usuarios WHERE numero_identificacion = ? LIMIT 1`, [cedulaNormalizada]);
  if (exacto) return exacto;
  const [[variante]] = await cx.query(
    `SELECT ${columnas} FROM usuarios
      WHERE numero_identificacion REGEXP '[^0-9]|^0' AND ${sqlCedulaNormalizada('numero_identificacion')} = ? LIMIT 1`, [cedulaNormalizada]);
  return variante || null;
}

module.exports = { normalizarCedula, sqlCedulaNormalizada, enmascararCedula, finDeCedula,
  buscarFichaConCedula, buscarFichaPorCedula, mapaDeFichasPorCedula, buscarUsuarioPorCedula };
