/**
 * ¿Esto se está viendo en un celular?
 *
 * UNA SOLA DEFINICIÓN PARA TODA LA APLICACIÓN. La pantalla de ingreso decide
 * con esto cuál formulario muestra primero, y el botón de instalar decide con
 * esto si se ofrece. Si cada uno lo resolviera por su lado, algún día uno
 * diría que sí y el otro que no en el mismo aparato, y nadie sabría cuál de
 * los dos está equivocado.
 *
 * TRES SEÑALES, EN ORDEN DE CERTEZA:
 *
 *   1. Ya está corriendo como aplicación instalada. Solo se instala en el
 *      teléfono, así que eso zanja la pregunta.
 *   2. Lo mismo, pero en un iPhone, que lo reporta con otro nombre.
 *   3. El ancho de la pantalla. 820 px deja adentro cualquier teléfono en
 *      vertical y las tabletas chicas, y deja afuera un computador con la
 *      ventana entera.
 *
 * SE MIDE EL ANCHO Y NO EL `userAgent`. La lista de aparatos no se acaba
 * nunca, y los navegadores mienten en ese campo a propósito desde hace años.
 * Consecuencia sabida: achicar la ventana del computador da la pantalla del
 * celular. Está bien — es la misma que va a ver quien la tenga de ese tamaño.
 */
window.esCelular = function () {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.navigator.standalone === true) return true;
    return window.matchMedia('(max-width: 820px)').matches;
  } catch (e) {
    return false;
  }
};
