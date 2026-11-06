/**
 * Verificación del esquema al arrancar: columnas que el código usa y sin
 * las cuales la aplicación entera deja de servir, aunque el arranque se
 * vea sano.
 *
 * Existe por el hallazgo A1 de AUDITORIA.md: usuarios.nombre_usuario se
 * consultaba en el login pero ningún esquema la creaba — la columna vivía
 * solo en la base original, agregada a mano, y una instalación nueva
 * respondía 500 en el 100% de los inicios de sesión. Nada lo avisaba
 * hasta que alguien intentaba entrar.
 *
 * Si falta una columna de la lista, el proceso TERMINA con un mensaje que
 * dice qué correr: es preferible una campaña que no arranca —y se ve en
 * rojo en pm2 list— a una que arranca y falla en cada login.
 *
 * Si la verificación misma no se puede hacer (la base está caída en ese
 * momento), solo se avisa y la aplicación sigue: un corte transitorio de
 * MySQL no debe convertirse en un bucle de reinicios de PM2.
 */
const pool = require('./db');

// [tabla, columna, qué se rompe si falta]
const COLUMNAS_CRITICAS = [
  ['usuarios', 'nombre_usuario', 'el inicio de sesión (routes/auth.routes.js)'],
  ['dia_d_reportes', 'alertas', 'guardar CUALQUIER reporte del Día D (routes/diaD.routes.js): sin la columna cada envío del testigo responde 500'],
];

async function verificarColumnasCriticas() {
  let faltantes;
  try {
    const [filas] = await pool.query(
      `SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND (TABLE_NAME, COLUMN_NAME) IN (${COLUMNAS_CRITICAS.map(() => '(?, ?)').join(', ')})`,
      COLUMNAS_CRITICAS.flatMap(([tabla, columna]) => [tabla, columna])
    );
    const presentes = new Set(filas.map((f) => `${f.tabla}.${f.columna}`));
    faltantes = COLUMNAS_CRITICAS.filter(([tabla, columna]) => !presentes.has(`${tabla}.${columna}`));
  } catch (err) {
    console.warn('No se pudo verificar el esquema al arrancar (¿base de datos caída?):', err.message);
    return;
  }
  if (faltantes.length) {
    console.error('ESQUEMA INCOMPLETO — la aplicación no puede funcionar con esta base de datos:');
    for (const [tabla, columna, consecuencia] of faltantes) {
      console.error(`  - Falta ${tabla}.${columna}: rompe ${consecuencia}.`);
    }
    console.error('Corre "npm run init-db" sobre esta base y vuelve a arrancar la aplicación.');
    process.exit(1);
  }
}

module.exports = { verificarColumnasCriticas };
