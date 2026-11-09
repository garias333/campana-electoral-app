/**
 * El permiso «Importar / Exportar»: la única lista de qué módulos lo tienen y a
 * qué roles se les da de fábrica.
 *
 * UNA SOLA LISTA, USADA EN CUATRO SITIOS. La migración (`db/init-db.js`), la
 * siembra de una instalación nueva, la matriz de «Asignación de permisos»
 * (`routes/permisos.routes.js`) y el middleware que bloquea las rutas
 * (`middleware/permisoModulo.js`) leen de aquí. Si cada uno tuviera la suya, un
 * módulo nuevo se añadiría en tres y se olvidaría en el cuarto, y el síntoma
 * sería una casilla que no hace nada o una ruta que nadie puede cerrar.
 *
 * LAS CLAVES SON LAS DEL CATÁLOGO DE MÓDULOS (`MODULOS` en permisos.routes.js),
 * no inventos de esta lista.
 */

/**
 * Módulo → roles que lo traen encendido de fábrica.
 *
 * CASI ES EL COMPORTAMIENTO DE HOY, y la diferencia importa. Importan y
 * exportan el administrador y el coordinador; esta tabla lo deja escrito y es
 * lo que la migración enciende. Un módulo que no aparece aquí no tiene ninguna
 * ruta de importar ni de exportar, y su casilla no se ofrece.
 *
 * LO QUE CAMBIA, a propósito: cuatro exportaciones que antes pedían SOLO
 * SESIÓN (la de territorios, la de asistentes de eventos y las dos de Word del
 * organigrama) ahora exigen este permiso. Cualquier rol con sesión —líder,
 * sublíder, testigo…— las sacaba; ahora solo el administrador y quien tenga la
 * casilla encendida. Es lo que pidió la orden («0 para el resto»), pero es un
 * cierre, no una conservación, y los roles que no están en la matriz (como
 * «usuario») no pueden reabrirlo desde la pantalla.
 *
 * `configuracion` lleva solo al administrador, a propósito: ahí viven los
 * puestos y los candidatos del Día D, cuyas rutas hoy piden administrador o
 * aspirante, y un coordinador no las alcanza. Encenderle la casilla no le
 * daría nada —`requireRole` seguiría cerrándole el paso— pero la matriz diría
 * que puede, y una casilla que miente es peor que una apagada.
 *
 * Por qué el Día D está bajo `configuracion` y no bajo `dia_d`: es donde está
 * la pantalla (Configuración → Día D) y es el módulo que el aspirante con
 * sublicencia ya tiene. Con `dia_d` habría que añadirlo a su lista de módulos,
 * y eso le abriría una entrada de menú que hoy no tiene.
 */
const IMPORTAR_EXPORTAR_POR_DEFECTO = {
  votantes: ['admin', 'coordinador'],
  territorial: ['admin', 'coordinador'],
  testigos: ['admin', 'coordinador'],
  votantes_dashboard: ['admin', 'coordinador'],
  finanzas: ['admin', 'coordinador'],
  asistentes_reuniones: ['admin', 'coordinador'],
  crm: ['admin', 'coordinador'],
  organigrama: ['admin', 'coordinador'],
  // Logística del día D (orden 39): la lista de compras y la lista por puesto en Excel.
  logistica_dia_d: ['admin', 'coordinador'],
  configuracion: ['admin'],
  // Solicitudes ciudadanas (parche 304): el «Diagnóstico de necesidades del territorio» (Excel agregado, sin datos personales). El detalle
  // con nombres es solo del administrador, tenga o no esta casilla. No hay importación.
  solicitudes: ['admin'],
  // Tareas (parche 306): el Excel agregado de cumplimiento por zona (sin nombres de nadie). No hay importación.
  tareas: ['admin'],
  // Encuestas internas (parche 308): el Excel agregado de resultados (por zona y pregunta, con el mínimo por celda y la marca «Uso interno – no publicable»).
  // Sin respuestas sueltas, sin textos libres. No hay importación.
  encuestas: ['admin'],
  // Puerta a puerta (parche 312): el Excel agregado de cobertura y avance (por zona y por visitante, con el mínimo por celda; nunca una lista de casas ni de personas).
  puerta_listas: ['admin', 'coordinador'],
};

const MODULOS_CON_IMPORTAR_EXPORTAR = Object.keys(IMPORTAR_EXPORTAR_POR_DEFECTO);

/** ¿Este módulo tiene alguna ruta de importar o de exportar? */
function moduloTieneImportarExportar(modulo) {
  return MODULOS_CON_IMPORTAR_EXPORTAR.includes(modulo);
}

/** ¿Lo trae encendido de fábrica este rol en este módulo? Devuelve 1 o 0. */
function importarExportarPorDefecto(rol, modulo) {
  const roles = IMPORTAR_EXPORTAR_POR_DEFECTO[modulo];
  return roles && roles.includes(rol) ? 1 : 0;
}

module.exports = {
  IMPORTAR_EXPORTAR_POR_DEFECTO,
  MODULOS_CON_IMPORTAR_EXPORTAR,
  moduloTieneImportarExportar,
  importarExportarPorDefecto,
};
