/**
 * Arma la cláusula de filtros dinámicos que se repite en varias rutas de
 * listado (Votantes, Comunicaciones, Finanzas, Eventos, Redes): a partir de
 * un arreglo de fragmentos SQL ("columna = ?", etc.) que cada ruta ya arma
 * según sus propios filtros, entrega el "WHERE ..." (o "AND ...") listo
 * para pegar en la consulta, o cadena vacía si no hay ningún filtro.
 */
function armarWhereSql(condiciones, prefijo = 'WHERE') {
  return condiciones.length ? `${prefijo} ${condiciones.join(' AND ')}` : '';
}

module.exports = { armarWhereSql };
