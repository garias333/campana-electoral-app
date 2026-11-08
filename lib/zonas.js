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

module.exports = { zonaYDescendientes, PROFUNDIDAD_MAXIMA, TOPE_DE_ZONAS };
