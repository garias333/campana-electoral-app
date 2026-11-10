'use strict';
/**
 * ACTIVAR COMPLEMENTOS (parche 318): los nueve complementos nacen APAGADOS (db/init-db.js), también en la base desechable de las pruebas. Una prueba de
 * un complemento empieza encendiendo los que necesita:
 *
 *   await require('./fixtures/encender-complementos')(pool, ['solicitudes', 'tareas']);
 *
 * Es el mismo UPDATE que hace el botón de «Activar complementos», sin pasar por la API, y deja la caché de lib/complementos al día para el mismo proceso.
 * `puerta_panel` solo cuenta como encendido si `puerta_a_puerta` también lo está (la dependencia vive en lib/complementos.js).
 */
module.exports = async function encenderComplementos(pool, claves) {
  const lista = Array.isArray(claves) ? claves : [claves];
  await pool.query('UPDATE complementos_campana SET activo = 1 WHERE clave IN (?)', [lista]);
  require('../../lib/complementos').invalidar();
};
