/**
 * Reglas para escribir en la tabla LOCAL `territorios` (campañas que no están
 * conectadas al catálogo como vista). Ver config/territoriosModo.js.
 *
 * POR QUÉ HACE FALTA, Y POR QUÉ NO LA HACÍA LA BASE
 *
 *   Las cinco llaves foráneas que otras tablas tenían hacia `territorios` se
 *   quitaron (db/schema.sql) porque una FK impide convertir la tabla en vista.
 *   Con ellas se fue la protección del borrado: antes MySQL rechazaba borrar un
 *   territorio con gente asignada; ahora lo borraría, y `estructura`,
 *   `votantes`, `usuarios`, `eventos` y `finanzas_movimientos` quedarían con un
 *   `territorio_id` que no apunta a nada. La auto-FK `padre_id` es
 *   ON DELETE SET NULL, o sea que tampoco protege a los hijos: los deja
 *   huérfanos. Todo eso se comprueba aquí, antes de escribir.
 *
 * Todas las funciones reciben el «ejecutor» (un pool o una conexión de una
 * transacción) y devuelven `{ error }` en vez de lanzar, para que cada ruta
 * decida el código HTTP.
 */
'use strict';

const TIPOS = ['departamento', 'municipio', 'comuna', 'corregimiento', 'barrio', 'vereda'];

/**
 * Qué tipos de padre admite cada tipo. Es la jerarquía que ya aplica el
 * importador de Excel (routes/territorial.routes.js):
 *   · comuna y corregimiento cuelgan del municipio;
 *   · barrio, de una comuna o directamente del municipio;
 *   · vereda, de un corregimiento o directamente del municipio.
 * En el catálogo nacional las veredas cuelgan casi siempre del municipio.
 */
const PADRES_PERMITIDOS = {
  departamento: [],
  municipio: ['departamento'],
  comuna: ['municipio'],
  corregimiento: ['municipio'],
  barrio: ['comuna', 'municipio'],
  vereda: ['corregimiento', 'municipio']
};

const MAX_NOMBRE = 120;   // territorios.nombre es VARCHAR(120)

/**
 * Las tablas que guardan un `territorio_id` local: las cinco de siempre más
 * `estructura_territorios`, la lista de territorios de cada persona de la
 * estructura (ver lib/territoriosPersona.js). Sin ella, borrar un territorio que
 * una persona tiene como SEGUNDO o tercero se permitiría en silencio.
 */
const TABLAS_CON_TERRITORIO = ['usuarios', 'estructura', 'votantes', 'eventos', 'finanzas_movimientos', 'estructura_territorios'];

/**
 * Qué filas de cada tabla cuentan. En la lista de territorios solo los que NO
 * son el principal: el principal de cada persona ya se cuenta en `estructura`, y
 * contarlo otra vez diría «3 personas y 3 territorios de personas» de las mismas
 * tres personas. Con el invariante intacto no se pierde nada.
 */
const CONDICION_EXTRA = { estructura_territorios: 'es_principal = 0' };

/**
 * Cuenta las filas de una tabla que cumplen `condicion`. La lista de
 * territorios puede no existir todavía (el código llegó antes que `init-db`):
 * ahí vale 0 en vez de romper el borrado de un territorio.
 */
async function contarFilas(ejecutor, tabla, condicion, params) {
  const extra = CONDICION_EXTRA[tabla] ? ` AND ${CONDICION_EXTRA[tabla]}` : '';
  try {
    const [[{ n }]] = await ejecutor.query(`SELECT COUNT(*) AS n FROM ${tabla} WHERE ${condicion}${extra}`, params);
    return Number(n);
  } catch (err) {
    if (tabla === 'estructura_territorios' && err.code === 'ER_NO_SUCH_TABLE') return 0;
    throw err;
  }
}

/** Espacios sobrantes fuera. No toca mayúsculas ni tildes: eso lo decide la colación al comparar. */
function limpiarNombre(valor) {
  return String(valor === undefined || valor === null ? '' : valor).replace(/\s+/g, ' ').trim();
}

/** Recorta un texto largo para ponerlo en un mensaje sin volcar 5 KB. */
function abreviar(texto, max = 40) {
  const t = String(texto);
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function validarNombre(valor, etiqueta = 'El nombre') {
  const limpio = limpiarNombre(valor);
  if (!limpio) return { error: `${etiqueta} es obligatorio.` };
  if (limpio.length > MAX_NOMBRE) {
    return { error: `${etiqueta} "${abreviar(limpio)}" tiene ${limpio.length} caracteres; el máximo es ${MAX_NOMBRE}.` };
  }
  return { valor: limpio };
}

function validarTipo(tipo) {
  const t = String(tipo || '').trim().toLowerCase();
  if (!TIPOS.includes(t)) {
    return { error: `Tipo "${abreviar(tipo || '')}" no válido. Use: ${TIPOS.join(', ')}.` };
  }
  return { valor: t };
}

async function cargarTerritorio(ejecutor, id) {
  const [[fila]] = await ejecutor.query(`SELECT id, tipo, nombre, padre_id FROM territorios WHERE id = ?`, [id]);
  return fila || null;
}

/** El municipio del que cuelga un territorio (él mismo si lo es), o null. */
async function municipioDe(ejecutor, id) {
  let actual = id;
  for (let i = 0; i < 8 && actual; i++) {
    const fila = await cargarTerritorio(ejecutor, actual);
    if (!fila) return null;
    if (fila.tipo === 'municipio') return fila.id;
    actual = fila.padre_id;
  }
  return null;
}

/**
 * ¿Puede `padreId` ser el padre de un territorio de este `tipo`?
 *
 *   · existe, y su tipo está en PADRES_PERMITIDOS[tipo];
 *   · no es el propio territorio ni uno de sus descendientes (`territorioId`,
 *     al editar): sin ciclos;
 *   · si se pasa `municipioEsperado`, cuelga de ese municipio: un barrio no se
 *     muda a una comuna de otra ciudad.
 *
 * Devuelve `{ padreId }` (null solo para departamento) o `{ error }`.
 */
async function validarPadre(ejecutor, tipo, padreId, { territorioId = null, municipioEsperado = null } = {}) {
  const permitidos = PADRES_PERMITIDOS[tipo] || [];
  const hayPadre = padreId !== undefined && padreId !== null && padreId !== '';
  if (!permitidos.length) {
    return hayPadre ? { error: `Un territorio de tipo ${tipo} no tiene padre.` } : { padreId: null };
  }
  if (!hayPadre) {
    return { error: `Un ${tipo} necesita un padre (${permitidos.join(' o ')}).` };
  }
  const id = Number(padreId);
  if (!Number.isInteger(id) || id < 1) return { error: 'El padre indicado no es válido.' };

  const padre = await cargarTerritorio(ejecutor, id);
  if (!padre) return { error: `El padre indicado (id ${id}) no existe.` };
  if (!permitidos.includes(padre.tipo)) {
    return { error: `Un ${tipo} no puede colgar de un ${padre.tipo}; debe colgar de ${permitidos.join(' o ')}.` };
  }

  if (territorioId !== null) {
    if (Number(territorioId) === id) return { error: 'Un territorio no puede ser su propio padre.' };
    // Subir desde el padre: si se encuentra el territorio, sería un ciclo.
    let actual = padre.padre_id;
    for (let i = 0; i < 8 && actual; i++) {
      if (Number(actual) === Number(territorioId)) return { error: 'Ese cambio crearía un ciclo en la jerarquía.' };
      const fila = await cargarTerritorio(ejecutor, actual);
      actual = fila ? fila.padre_id : null;
    }
  }

  if (municipioEsperado !== null && municipioEsperado !== undefined) {
    const muni = await municipioDe(ejecutor, id);
    if (muni !== Number(municipioEsperado)) {
      return { error: 'El padre indicado pertenece a otro municipio.' };
    }
  }
  return { padreId: id };
}

/**
 * ¿Ya hay un territorio igual? Mismo tipo, mismo padre y mismo nombre sin
 * distinguir mayúsculas ni tildes (la misma comparación que usa el importador).
 * `excluirId` evita contarse a sí mismo al editar. Devuelve el id o null.
 */
async function buscarDuplicado(ejecutor, tipo, nombre, padreId, excluirId = null) {
  const params = [tipo, nombre, padreId === undefined ? null : padreId];
  let sql = `SELECT id FROM territorios
              WHERE tipo = ?
                AND LOWER(nombre) COLLATE utf8mb4_unicode_ci = LOWER(?) COLLATE utf8mb4_unicode_ci
                AND (padre_id <=> ?)`;
  if (excluirId !== null && excluirId !== undefined) { sql += ` AND id <> ?`; params.push(excluirId); }
  const [filas] = await ejecutor.query(sql + ' LIMIT 1', params);
  return filas.length ? filas[0].id : null;
}

/**
 * Qué cuelga de estos territorios: hijos directos y filas que los usan como
 * `territorio_id` en las tablas de TABLAS_CON_TERRITORIO. `ids` es un arreglo no vacío.
 */
async function referenciasDe(ejecutor, ids) {
  const marcas = ids.map(() => '?').join(',');
  const porTabla = {};
  let total = 0;
  for (const tabla of TABLAS_CON_TERRITORIO) {
    const n = await contarFilas(ejecutor, tabla, `territorio_id IN (${marcas})`, ids);
    porTabla[tabla] = n;
    total += n;
  }
  const [[{ h }]] = await ejecutor.query(
    `SELECT COUNT(*) AS h FROM territorios WHERE padre_id IN (${marcas})`, ids);
  return { porTabla, total, hijos: Number(h) };
}

/** Lo mismo para TODOS los territorios: cuántas filas de cada tabla usan alguno. */
async function referenciasGlobales(ejecutor) {
  const porTabla = {};
  let total = 0;
  for (const tabla of TABLAS_CON_TERRITORIO) {
    const n = await contarFilas(ejecutor, tabla, 'territorio_id IS NOT NULL', []);
    porTabla[tabla] = n;
    total += n;
  }
  return { porTabla, total, hijos: 0 };
}

const ETIQUETAS_TABLA = {
  usuarios: 'usuarios', estructura: 'personas de la estructura', votantes: 'votantes',
  eventos: 'eventos', finanzas_movimientos: 'movimientos de finanzas',
  estructura_territorios: 'territorios adicionales de personas de la estructura'
};

/** «12 votantes y 3 eventos», solo con lo que no es cero. */
function describirReferencias(refs) {
  const partes = Object.entries(refs.porTabla)
    .filter(([, n]) => n > 0)
    .map(([tabla, n]) => `${n} ${ETIQUETAS_TABLA[tabla] || tabla}`);
  if (partes.length <= 1) return partes.join('');
  return partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1];
}

module.exports = {
  TIPOS, PADRES_PERMITIDOS, MAX_NOMBRE, TABLAS_CON_TERRITORIO,
  limpiarNombre, abreviar, validarNombre, validarTipo,
  cargarTerritorio, municipioDe, validarPadre, buscarDuplicado,
  referenciasDe, referenciasGlobales, describirReferencias
};
