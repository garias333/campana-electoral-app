/**
 * EL MÍNIMO POR CELDA, compartido (antes vivía en lib/encuestasResultados.js, del módulo «Encuestas internas», que se eliminó en la Orden menús 3).
 * Lo usa el panel del Puerta a puerta (lib/puertaPanel.js): solo conteos, y nunca una cifra que señale a una casa.
 *
 *   MÍNIMO POR CELDA. Una celda es una zona; se muestra solo si tiene al menos `minimoPorCelda()` visitas (5 de fábrica; configurable solo HACIA
 *   ARRIBA, con `configuracion_campana.encuesta_min_celda` —el nombre de la columna es el de siempre: no se renombró para no tocar datos—).
 *
 *   «OTRAS ZONAS» PARA QUE NO SE PUEDA RESTAR. Si solo se ocultara la celda chica y se mostraran el total y todas las demás, una resta devolvería
 *   justo lo que se ocultó. Por eso las celdas chicas se AGRUPAN en «Otras zonas» y el grupo se muestra solo si suma el mínimo; si no llega, se le
 *   suma la celda visible más pequeña, y así hasta llegar o quedarse sin celdas. Si ni todas juntas llegan, no se muestra nada (ni el total).
 */
'use strict';

const pool = require('../config/db');

const MINIMO_PISO = 5;
const MINIMO_TOPE = 1000;

/** El mínimo por celda vigente: el de la configuración, nunca menos de 5. */
async function minimoPorCelda() {
  try {
    const [[c]] = await pool.query('SELECT encuesta_min_celda AS m FROM configuracion_campana WHERE id = 1');
    const m = c ? Number(c.m) : MINIMO_PISO;
    return Number.isInteger(m) && m >= MINIMO_PISO ? Math.min(m, MINIMO_TOPE) : MINIMO_PISO;
  } catch (_) { return MINIMO_PISO; }             // sin la columna (el código llegó antes que init-db): el piso
}

/**
 * De las celdas con su `n`, cuáles se muestran, cuáles forman «Otras zonas» y si no se puede mostrar nada.
 * Devuelve { visibles, otras: [celdas] | null, oculto }.
 */
function aplicarMinimo(celdas, k) {
  const visibles = celdas.filter((c) => c.n >= k).sort((a, b) => b.n - a.n || String(a.nombre).localeCompare(String(b.nombre), 'es'));
  const omitidas = celdas.filter((c) => c.n < k);
  if (!omitidas.length) return { visibles, otras: null, oculto: false };
  let suma = omitidas.reduce((a, c) => a + c.n, 0);
  while (suma < k && visibles.length) { const c = visibles.pop(); omitidas.push(c); suma += c.n; }     // la visible más chica se une al grupo
  if (suma < k) return { visibles: [], otras: null, oculto: true };                                      // ni todas juntas llegan al mínimo
  return { visibles, otras: omitidas, oculto: false };
}

module.exports = { MINIMO_PISO, MINIMO_TOPE, minimoPorCelda, aplicarMinimo };
