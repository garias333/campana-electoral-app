/**
 * LA ZONA Y TODO LO QUE CUELGA DE ELLA (parche 306): función compartida para preguntar «¿qué barrios y veredas están dentro de esta zona?».
 *
 * Una zona es una fila de la vista `territorios` (comuna, corregimiento, barrio, vereda o municipio). Sus descendientes salen de `padre_id`:
 * una comuna trae sus barrios; en el catálogo nacional las veredas cuelgan del MUNICIPIO (no del corregimiento: ver CLAUDE.md del CTC), así que
 * el municipio las trae. Un votante cuenta para una zona si su `territorio_id` es la zona o cualquiera de sus descendientes.
 *
 * Es la ÚNICA definición: la usan las metas de las tareas (lib/tareasMetas.js) y cualquier consulta futura «por zona», para que dos pantallas
 * no cuenten distinto el mismo barrio.
 */
'use strict';

const pool = require('../config/db');

const PROFUNDIDAD_MAXIMA = 6;          // país > departamento > municipio > comuna > barrio: más hondo no existe; el tope corta un ciclo
const TOPE_DE_ZONAS = 20000;

/**
 * Los ids de la zona y de todos sus descendientes (la zona incluida). Devuelve [] si la zona no existe en la vista (por ejemplo, una campaña
 * cuyo ámbito no la incluye): una meta sobre una zona que no se ve no cuenta nada, en vez de contar todo.
 */
async function zonaYDescendientes(territorioId, conexion = pool) {
  const id = Number(territorioId);
  if (!Number.isInteger(id) || id < 1) return [];
  try {
    const [filas] = await conexion.query(
      `WITH RECURSIVE bajo AS (
         SELECT t.id, 0 AS nivel FROM territorios t WHERE t.id = ?
         UNION
         SELECT h.id, b.nivel + 1 FROM territorios h JOIN bajo b ON h.padre_id = b.id WHERE b.nivel < ?
       ) SELECT id FROM bajo LIMIT ?`, [id, PROFUNDIDAD_MAXIMA, TOPE_DE_ZONAS]);
    return filas.map((f) => f.id);
  } catch (err) {
    console.error('[zonas] No se pudo resolver la zona:', err.code || err.message);
    return [];
  }
}

/* ----------------------------------------------------------------------------------------------------------------------------
   LA ZONA EN UN FORMULARIO DE CAMPO (parche 307): qué se le ofrece a quien llena el formulario, y qué se acepta en el servidor.

   LA DEGRADACIÓN, en este orden y la MISMA para Solicitudes, Encuestas y (en sus cuatro primeros tipos) Tareas:
     1. 'zona' ....... hay barrios, veredas, comunas o corregimientos en la vista `territorios`: se elige uno de la lista.
     2. 'municipio' .. no hay ninguno de esos pero sí municipios (una campaña departamental sin división interna): se elige el municipio.
     3. 'texto' ...... no hay catálogo: la zona se escribe a mano. Exigir un nivel que no existe haría imposible guardar el formulario
                       (caso real: Quindío, 12 municipios y 232 veredas pero ningún barrio — ahí manda el nivel 1, por las veredas).
   Un id que NO está en el nivel vigente se rechaza: si hay barrios, no se acepta «el municipio» como zona (sería no decir nada).
   ---------------------------------------------------------------------------------------------------------------------------- */

const TIPOS_ZONA_FINA = ['barrio', 'vereda', 'comuna', 'corregimiento'];
const LIMITE_LISTA_ZONAS = 2500;      // lo que cabe en el celular; si la campaña tiene más, la lista avisa que está recortada

/** El nivel de zona vigente: 'zona' | 'municipio' | 'texto'. Sin la vista `territorios` (o con un error de lectura) es 'texto'. */
async function nivelDeZonas(conexion = pool) {
  for (const [nivel, tipos] of [['zona', TIPOS_ZONA_FINA], ['municipio', ['municipio']]]) {
    try {
      const [[h]] = await conexion.query('SELECT COUNT(*) AS n FROM (SELECT 1 FROM territorios WHERE tipo IN (?) LIMIT 1) x', [tipos]);
      if (Number(h.n) > 0) return nivel;
    } catch (err) {
      if (err.code !== 'ER_NO_SUCH_TABLE') console.error('[zonas] No se pudo mirar el nivel de zonas:', err.code || err.message);
      return 'texto';
    }
  }
  return 'texto';
}

/** La lista completa de zonas del nivel vigente, para que el celular la guarde y funcione sin señal. { nivel, zonas: [{id,nombre,tipo,padre}], truncada } */
async function listaDeZonas({ limite = LIMITE_LISTA_ZONAS } = {}, conexion = pool) {
  const nivel = await nivelDeZonas(conexion);
  if (nivel === 'texto') return { nivel, zonas: [], truncada: false };
  try {
    const [filas] = await conexion.query(
      `SELECT t.id, t.nombre, t.tipo, p.nombre AS padre FROM territorios t LEFT JOIN territorios p ON p.id = t.padre_id
        WHERE t.tipo IN (?) ORDER BY t.nombre, t.id LIMIT ?`, [nivel === 'zona' ? TIPOS_ZONA_FINA : ['municipio'], limite + 1]);
    return { nivel, zonas: filas.slice(0, limite), truncada: filas.length > limite };
  } catch (err) {
    console.error('[zonas] No se pudo leer la lista de zonas:', err.code || err.message);
    return { nivel: 'texto', zonas: [], truncada: false };
  }
}

/**
 * Valida la zona que llegó de un formulario de campo contra el nivel vigente. Devuelve { territorio_id, zona_texto } o lanza un error con
 * `.estado` (400) y `.mensaje`. `obligatoria`: sin zona es un error (las encuestas la exigen); si no, se acepta vacía.
 */
async function resolverZonaDeCampo({ territorio_id, zona_texto }, { obligatoria = true } = {}, conexion = pool) {
  const falla = (mensaje) => { const e = new Error(mensaje); e.estado = 400; e.mensaje = mensaje; return e; };
  const id = Number(territorio_id);
  const texto = String(zona_texto === undefined || zona_texto === null ? '' : zona_texto).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 120);
  const nivel = await nivelDeZonas(conexion);
  if (nivel === 'texto') {
    if (texto.length >= 2) return { territorio_id: null, zona_texto: texto };
    if (!obligatoria) return { territorio_id: null, zona_texto: null };
    throw falla('Escribe la zona (el barrio o la vereda).');
  }
  if (Number.isInteger(id) && id > 0) {
    const [[t]] = await conexion.query('SELECT id, nombre FROM territorios WHERE id = ? AND tipo IN (?)',
      [id, nivel === 'zona' ? TIPOS_ZONA_FINA : ['municipio']]);
    if (!t) throw falla('Esa zona no está en el catálogo de la campaña. Elígela de la lista.');
    return { territorio_id: t.id, zona_texto: t.nombre };
  }
  if (!obligatoria && !texto) return { territorio_id: null, zona_texto: null };
  throw falla(nivel === 'zona' ? 'Elige la zona de la lista (el barrio, la vereda, la comuna o el corregimiento).' : 'Elige el municipio de la lista.');
}

module.exports = { zonaYDescendientes, PROFUNDIDAD_MAXIMA, TOPE_DE_ZONAS, TIPOS_ZONA_FINA, LIMITE_LISTA_ZONAS, nivelDeZonas, listaDeZonas, resolverZonaDeCampo };
