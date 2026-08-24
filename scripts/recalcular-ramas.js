#!/usr/bin/env node
/**
 * Recalcula de qué rama de aspirante cuelga cada votante.
 *
 * CUÁNDO CORRERLO. `rama_aspirante_id` es un dato DERIVADO: se calcula al
 * guardar un votante y al mover a alguien en la estructura. Este guion existe
 * para las veces en que eso no pasa por la aplicación — una carga por Excel, un
 * arreglo a mano en la base, un respaldo restaurado — y para la primera vez,
 * cuando la columna acaba de crearse y está vacía.
 *
 *   node scripts/recalcular-ramas.js --simular   dice qué cambiaría, sin tocar
 *   node scripts/recalcular-ramas.js             recalcula y guarda
 *
 * NO CAMBIA LO QUE VE NADIE. Mientras ninguna pantalla use el filtro, esta
 * columna es sólo un apunte. Se puede correr en producción sin riesgo, y ése es
 * justamente el punto de hacerlo primero.
 */
require('dotenv').config();
const pool = require('../config/db');
const { recalcularTodas } = require('../lib/ramas');

const SIMULAR = process.argv.includes('--simular');

(async () => {
  try {
    const [[{ n: sublicencias }]] = await pool.query(
      `SELECT COUNT(*) n FROM sublicencias WHERE activa = 1`
    );

    if (!sublicencias) {
      console.log('No hay ninguna sublicencia activa.');
      console.log('Todos los votantes quedan sin rama, que es lo correcto: sin');
      console.log('aspirantes habilitados, la campaña madre lo ve todo como hasta hoy.');
    }

    const r = await recalcularTodas(pool, { simular: SIMULAR });

    console.log(`${SIMULAR ? 'SIMULACIÓN · ' : ''}${r.revisados} votante(s) revisado(s), ` +
                `${r.cambios.length} con la rama distinta a la guardada.`);

    if (r.cambios.length) {
      // Se agrupa por destino en vez de listar votante por votante: con 88
      // filas cabría, con 20.000 no, y lo que se quiere saber es a qué rama
      // fue a parar cuánta gente.
      const porRama = new Map();
      for (const c of r.cambios) {
        const k = c.ahora === null ? '(sin rama)' : `aspirante ${c.ahora}`;
        porRama.set(k, (porRama.get(k) || 0) + 1);
      }
      console.log('');
      for (const [rama, n] of [...porRama.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`   ${String(n).padStart(6)}  ->  ${rama}`);
      }
    }

    // El reparto final, que es lo que de verdad se quiere ver: cuántos vería
    // cada quien SI el filtro estuviera puesto. Sirve para descubrir hoy lo que
    // pasaría el día que se encienda.
    const [reparto] = await pool.query(`
      SELECT COALESCE(CONCAT('aspirante ', rama_aspirante_id), '(campaña madre, sin rama)') AS rama,
             COUNT(*) AS total,
             SUM(JSON_CONTAINS(apoya_a, '"alcaldia"')) AS apoyan_a_la_madre
        FROM votantes
       GROUP BY rama_aspirante_id
       ORDER BY total DESC`);

    console.log('\nCómo quedaría el reparto:');
    for (const f of reparto) {
      console.log(`   ${String(f.total).padStart(6)} en ${f.rama}` +
                  `   ·   ${f.apoyan_a_la_madre} de ellos también los vería la madre`);
    }

    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Falló el recálculo:', err.message);
    await pool.end().catch(() => {});
    process.exit(1);
  }
})();
