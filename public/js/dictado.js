/**
 * DICTADO POR VOZ EN LOS CAMPOS DE LA APP DEL CELULAR.
 *
 * Un micrófono al lado del campo: se pulsa, se dicta, y el texto entra.
 * Pensado para quien registra de pie en la calle, con una mano ocupada.
 *
 * ------------------------------------------------------------------
 * LO QUE HAY QUE SABER ANTES DE TOCAR ESTO
 *
 * 1. NO EXISTE EN TODOS LOS TELÉFONOS. Usa `SpeechRecognition`, que Chrome de
 *    Android sí trae y Safari de iPhone no. Por eso el botón NO SE DIBUJA
 *    cuando el navegador no lo soporta, en vez de dibujarlo y fallar: en esta
 *    aplicación un botón que se ofrece y no responde ya costó una sesión entera
 *    de diagnóstico.
 *
 * 2. NECESITA SEÑAL. Chrome no reconoce en el teléfono: manda el audio a un
 *    servidor. Y esta app está hecha para trabajar sin conexión, así que el
 *    botón lo dice en vez de quedarse pensando: «Sin señal no se puede dictar».
 *
 * 3. PONER `.value` NO DISPARA `input`. El campo de cédula tiene un escuchador
 *    que consulta duplicados mientras se teclea, y el de nombre otro que avisa
 *    de parecidos. Si el dictado escribiera el valor a secas, esas dos
 *    comprobaciones no correrían y la persona guardaría un duplicado sin que
 *    nada se lo dijera. Por eso se dispara el evento a mano.
 *
 * 4. SE PUEDE QUITAR SIN CICATRIZ. Todo vive aquí; para retirarlo basta borrar
 *    el `<script>` de la página y la línea que llama a `activarDictado()`.
 * ------------------------------------------------------------------
 */
(function () {
  const Reconocedor = window.SpeechRecognition || window.webkitSpeechRecognition;

  /** Solo dígitos. Lo que se dicta como «uno cero dos» llega escrito, y de ahí se rescatan las cifras. */
  const PALABRA_A_DIGITO = {
    cero: '0', uno: '1', dos: '2', tres: '3', cuatro: '4',
    cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9'
  };

  function aDigitos(texto) {
    /* Se rescatan también los dígitos deletreados. Chrome suele devolver
       «1023456» de corrido, pero si la persona dicta despacio devuelve «uno cero
       dos...» y sin esto el campo quedaría vacío después de hablar — que se lee
       como que el micrófono no funciona. */
    const porPalabras = texto.toLowerCase().split(/[\s,.-]+/)
      .map((p) => PALABRA_A_DIGITO[p] !== undefined ? PALABRA_A_DIGITO[p] : p)
      .join('');
    return porPalabras.replace(/\D/g, '');
  }

  function aNombre(texto) {
    // Se reutiliza el formateador de la aplicación si está cargado, para que un
    // nombre dictado y uno tecleado se guarden idénticos.
    const limpio = texto.replace(/[^\wáéíóúñüÁÉÍÓÚÑÜ\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
    return typeof formatoNombrePropio === 'function' ? formatoNombrePropio(limpio) : limpio;
  }

  /**
   * Correo dictado. Nadie dice «arroba jota eme»; dice «juan punto perez arroba
   * gmail punto com». Chrome a veces ya devuelve el simbolo y a veces la
   * palabra, asi que se admiten las dos formas.
   *
   * EL ORDEN DE LOS REEMPLAZOS IMPORTA: «guion bajo» tiene que resolverse antes
   * que «guion», o el primero se convertiria en «-bajo».
   */
  function aCorreo(texto) {
    let t = texto.toLowerCase().trim();
    t = t.replace(/\s*(arroba|at)\s*/g, '@');
    t = t.replace(/\s*(guion|guión)\s+bajo\s*/g, '_');
    t = t.replace(/\s*(guion|guión)\s*/g, '-');
    t = t.replace(/\s*punto\s*/g, '.');
    t = t.replace(/\s+/g, '');
    // Un correo sin arroba no es un correo: se avisa en vez de escribir basura.
    return /@/.test(t) ? t : '';
  }

  /**
   * Direccion dictada. En Colombia se dice «calle diez numeral cinco guion
   * veinte», y eso se escribe «Calle 10 #5-20» — el propio campo lo sugiere en
   * su marcador de posicion.
   *
   * NO se intenta convertir «diez» en «10»: Chrome ya devuelve las cifras casi
   * siempre, y una tabla de numeros escritos acertaria con «diez» y fallaria con
   * «ciento cuarenta y dos». Se prefiere dejar lo que se oyo, que la persona lee
   * y corrige, antes que inventar un numero.
   */
  function aDireccion(texto) {
    let t = texto.trim();
    t = t.replace(/\s*(numeral|almohadilla|n[uú]mero)\s*/gi, ' #');
    t = t.replace(/\s*(guion|guión)\s*/gi, '-');
    t = t.replace(/\s+/g, ' ').replace(/#\s+/g, '#').trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  }

  const TRANSFORMA = { digitos: aDigitos, nombre: aNombre, correo: aCorreo, direccion: aDireccion };

  function escribirEn(campo, valor) {
    campo.value = valor;
    // Ver el punto 3 de arriba: sin esto, las comprobaciones que cuelgan del
    // campo no se enteran de que cambió.
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    campo.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Pone un micrófono junto a un campo.
   * @param {string} selector  el campo
   * @param {'digitos'|'nombre'} tipo  qué hacer con lo que se oyó
   * @param {string} etiqueta  cómo se llama el campo, para los avisos
   */
  function dictarEn(selector, tipo, etiqueta) {
    const campo = document.querySelector(selector);
    if (!campo || campo.dataset.conDictado) return;
    campo.dataset.conDictado = '1';

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'btn-dictado';
    boton.title = 'Dictar ' + etiqueta;
    boton.setAttribute('aria-label', 'Dictar ' + etiqueta);
    boton.innerHTML = '<span aria-hidden="true">🎤</span>';

    // El aviso va DEBAJO del campo y no en un alert: en el celular un alert tapa
    // el formulario y hay que cerrarlo para volver a ver qué se escribió.
    const aviso = document.createElement('small');
    aviso.className = 'dictado-aviso';

    /* EL MICROFONO VA DELANTE DEL CAMPO, no detras. Con el boton a la derecha,
       el dedo que lo pulsa tapa justo lo que se acaba de escribir; a la
       izquierda queda fuera de la linea de lectura. Y en un formulario de doce
       campos, tenerlos todos en la misma columna deja una guia vertical: se
       encuentra el de al lado sin buscarlo. */
    const caja = document.createElement('div');
    caja.className = 'campo-con-dictado';
    campo.parentNode.insertBefore(caja, campo);
    caja.appendChild(boton);
    caja.appendChild(campo);
    caja.parentNode.insertBefore(aviso, caja.nextSibling);

    let reconociendo = null;

    const decir = (texto, clase) => {
      aviso.textContent = texto || '';
      aviso.className = 'dictado-aviso' + (clase ? ' ' + clase : '');
    };

    boton.addEventListener('click', () => {
      if (reconociendo) { reconociendo.stop(); return; }

      if (navigator.onLine === false) {
        decir('Sin señal no se puede dictar. Escríbalo a mano.', 'malo');
        return;
      }

      const rec = new Reconocedor();
      rec.lang = 'es-CO';
      rec.continuous = false;
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      rec.onstart = () => { reconociendo = rec; boton.classList.add('oyendo'); decir('Escuchando… hable ahora.'); };

      rec.onresult = (evento) => {
        const oido = (evento.results[0] && evento.results[0][0] && evento.results[0][0].transcript) || '';
        const valor = TRANSFORMA[tipo](oido);
        if (!valor) {
          /* SE MUESTRA LO QUE SE OYÓ. Un «no entendí» a secas no dice si el
             micrófono falló o si la persona dictó otra cosa; con el texto
             delante, ella misma ve cuál de las dos fue. */
          decir('No se entendió un ' + etiqueta + '. Se oyó: «' + oido + '»', 'malo');
          return;
        }
        escribirEn(campo, valor);
        decir('');
      };

      rec.onerror = (evento) => {
        const razon = {
          'not-allowed': 'No se dio permiso al micrófono. Actívelo en los ajustes del navegador.',
          'service-not-allowed': 'El navegador no permite el dictado en esta página.',
          'no-speech': 'No se oyó nada. Inténtelo otra vez, más cerca del micrófono.',
          'audio-capture': 'No se encontró micrófono en este aparato.',
          'network': 'No se pudo conectar para reconocer la voz. Revise la señal.'
        }[evento.error] || 'No se pudo dictar en este momento.';
        decir(razon, 'malo');
      };

      rec.onend = () => { reconociendo = null; boton.classList.remove('oyendo'); };

      try { rec.start(); } catch (e) { decir('No se pudo iniciar el dictado.', 'malo'); }
    });
  }

  /**
   * Enciende el dictado en los campos indicados.
   * Sin soporte del navegador no hace NADA — ni botón, ni aviso. Un aparato que
   * no puede dictar no tiene por qué enterarse de que existe la función.
   */
  window.activarDictado = function (campos) {
    if (!Reconocedor) return false;
    campos.forEach((c) => dictarEn(c.selector, c.tipo, c.etiqueta));
    return true;
  };
})();
