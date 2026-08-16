/**
 * Los apoyos que se muestran, EN EL ORDEN QUE MANDA EL CARGO.
 *
 * VIVE EN SU PROPIO ARCHIVO, y no dentro de common.js, porque lo necesitan dos
 * mundos distintos: las pantallas de escritorio (que sí cargan common.js) y el
 * formulario de la app de celular (que NO lo carga — allí el diseño lo pone
 * app-comun.js). Tenerlo en common.js hacía que en el celular la función no
 * existiera y el formulario entero muriera con un error, mostrando «no hay
 * conexión a internet» cuando la conexión estaba perfecta.
 *
 * Es el mismo patrón que /js/validarCedula.js: una regla que usan varios
 * sitios se sirve desde un archivo, no se copia en cada uno.
 *
 * El orden y el conjunto los define el servidor en un solo lugar
 * (APOYOS_POR_CARGO, routes/configuracion.routes.js) y llegan en
 * `apoyos_posibles`. Aquí solo se cruzan con los que la campaña dejó activos.
 *
 * SE ORDENA POR `posibles`, NO POR LO GUARDADO. `apoyos_activos` conserva el
 * orden que tenía el día que se guardó, que puede ser el de una versión
 * anterior; respetarlo dejaría la pantalla con el orden viejo hasta que
 * alguien volviera a entrar a Configuración y guardara.
 *
 * Y SE FILTRA, no solo se ordena: un apoyo que el cargo ya no contempla
 * desaparece aunque siga listado en `apoyos_activos`. Así el cambio se ve de
 * inmediato, sin tener que volver a guardar la configuración.
 *
 * Tres casos, y el del medio importa:
 *   null / undefined -> nunca se configuró: se ofrecen todos los del cargo.
 *   []               -> se configuró y se dejó sin ninguno: no se muestra nada.
 *   lista            -> esos, en el orden del cargo.
 */
const APOYOS_SI_NO_LLEGA_LA_LISTA = ['alcaldia', 'concejo', 'jal', 'gobernacion', 'asamblea'];

function apoyosEnOrden(activos, posibles) {
  // Una página servida desde la caché contra un servidor que todavía no manda
  // `apoyos_posibles` recibe undefined: se cae a los cinco de siempre, que es
  // el comportamiento anterior, en vez de quedarse sin ninguno.
  const orden = (Array.isArray(posibles) && posibles.length) ? posibles : APOYOS_SI_NO_LLEGA_LA_LISTA;
  if (activos === null || activos === undefined) return orden.slice();
  const elegidos = Array.isArray(activos) ? activos : [];
  return orden.filter(a => elegidos.includes(a));
}
