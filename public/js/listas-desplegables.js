/**
 * Que una lista desplegable se abra ENTERA aunque ya haya algo elegido.
 *
 * EL PROBLEMA, Y POR QUÉ NO ES UN FALLO DE ESTA APLICACIÓN
 *   Un `<input list="...">` con `<datalist>` filtra las sugerencias por lo
 *   que hay escrito. Con «Calarcá» en el campo, la única sugerencia que
 *   encaja es «Calarcá», así que al hacer clic no se abre nada y parece que
 *   la lista se hubiera roto. Para volver a verla entera hay que borrar el
 *   contenido a mano. Es el comportamiento estándar del navegador, y lo
 *   padecen los 49 campos de este tipo que tiene la aplicación.
 *
 * QUÉ HACE
 *   Al entrar al campo, guarda lo que había y lo deja vacío: sin texto que
 *   filtre, el navegador ofrece la lista completa. Lo elegido pasa al texto
 *   gris de fondo, para que se siga viendo qué estaba puesto.
 *
 * LO QUE ESTABA NO SE PIERDE. Es la parte delicada, porque un campo que se
 * vacía solo y no se rellena es peor que el problema que viene a arreglar:
 *
 *   - si se sale del campo sin tocar nada, se devuelve lo que había;
 *   - si se elige de la lista o se escribe, lo nuevo manda y ya no se
 *     devuelve nada;
 *   - si se borra a propósito, se respeta: cuenta como «escribir»;
 *   - y con Enter se devuelve ANTES de que el formulario se envíe, que si no
 *     se guardaría el campo vacío por pulsar una tecla.
 *
 * VACIAR POR CÓDIGO NO DISPARA EVENTOS, así que las cascadas que cuelgan de
 * estos campos —Comuna llena Barrios, Municipio llena Puestos— no se
 * ejecutan con el campo a medias. Solo corren cuando la persona escribe o
 * elige, que es cuando el valor es de verdad.
 *
 * Se engancha a `input[list]`, así que un campo nuevo con lista lo hereda
 * sin tener que acordarse de nada.
 */
(function () {
  function enganchar(input) {
    if (input.dataset.listaDinamica === 'si') return;   // no engancharlo dos veces
    input.dataset.listaDinamica = 'si';

    let valorPrevio = null;
    const marcadorOriginal = input.placeholder || '';

    const devolver = () => {
      if (valorPrevio === null) return;
      if (!input.value) input.value = valorPrevio;
      input.placeholder = marcadorOriginal;
      valorPrevio = null;
    };

    input.addEventListener('focus', () => {
      if (!input.value) return;
      valorPrevio = input.value;
      // El elegido pasa al texto de fondo: el campo se ve vacío, pero no se
      // pierde de vista qué había.
      input.placeholder = valorPrevio;
      input.value = '';
    });

    // Cualquier cosa que escriba o elija la persona manda sobre lo anterior,
    // incluido borrarlo del todo.
    input.addEventListener('input', () => {
      valorPrevio = null;
      input.placeholder = marcadorOriginal;
    });

    input.addEventListener('blur', devolver);
    input.addEventListener('keydown', (e) => {
      // Enter envía el formulario: hay que devolver el valor ANTES.
      if (e.key === 'Enter') devolver();
      // Escape = «déjalo como estaba», que es lo que espera cualquiera.
      if (e.key === 'Escape') { devolver(); input.blur(); }
    });
  }

  // El formato Nombre Propio de los nombres de lugar VIVE EN common.js
  // (normalizarNombresDeLugar), porque ese archivo se carga en todas las
  // pantallas y este solo en seis. Aquí había una copia de la misma regla:
  // dos implementaciones de un mismo criterio es exactamente cómo terminan
  // divergiendo, así que se dejó una sola y este archivo se queda con lo
  // suyo, que es el comportamiento del campo al recibir el foco.

  function activar() {
    document.querySelectorAll('input[list]').forEach(enganchar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activar);
  } else {
    activar();
  }

  // Los formularios en ventana emergente ya están en el HTML desde el
  // principio, así que con una pasada basta. Se expone por si alguna
  // pantalla llega a crear campos después.
  window.activarListasDesplegables = activar;
})();
