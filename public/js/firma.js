/**
 * Firma dibujada en la pantalla, para el formulario de registro.
 *
 * POR QUÉ EXISTE. La casilla de autorización la marca el LÍDER —dice «le leí o
 * le mostré»—, así que como evidencia es la afirmación de un tercero
 * interesado. Esto es lo único del formulario que hace la persona con su mano.
 *
 * AUTOCONTENIDO Y QUITABLE, igual que `dictado.js`: si la firma no convence,
 * se borra la llamada a `activarFirma` y no queda nada suelto.
 */
(function () {
  'use strict';

  // Dos veces la densidad real es de sobra para un trazo. Sin tope, un
  // teléfono con densidad 3 o 4 genera un PNG varias veces más pesado sin que
  // la firma se vea mejor — y ese peso viaja por la red de la calle.
  const DENSIDAD_MAXIMA = 2;

  function activarFirma(opciones) {
    const lienzo = document.querySelector(opciones.lienzo);
    if (!lienzo || !lienzo.getContext) return null;
    const estado = document.querySelector(opciones.estado);
    const borrar = document.querySelector(opciones.borrar);
    const ctx = lienzo.getContext('2d');

    let trazado = false;
    let dibujando = false;
    let dimensionado = false;

    /* EL LIENZO SE DIMENSIONA AL MOSTRARLO, NO AL CARGAR LA PÁGINA.
       Arranca dentro de un contenedor con `display:none`, y ahí su ancho
       medido es 0: dimensionarlo entonces deja un lienzo de cero píxeles en
       el que se puede dibujar sin que aparezca nada. */
    function dimensionar() {
      const caja = lienzo.getBoundingClientRect();
      if (!caja.width) return false;
      const d = Math.min(window.devicePixelRatio || 1, DENSIDAD_MAXIMA);
      lienzo.width = Math.round(caja.width * d);
      lienzo.height = Math.round(caja.height * d);
      ctx.scale(d, d);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#142a3f';
      dimensionado = true;
      return true;
    }

    function punto(ev) {
      const caja = lienzo.getBoundingClientRect();
      return { x: ev.clientX - caja.left, y: ev.clientY - caja.top };
    }

    function empezar(ev) {
      if (!dimensionado && !dimensionar()) return;
      dibujando = true;
      lienzo.setPointerCapture && lienzo.setPointerCapture(ev.pointerId);
      const p = punto(ev);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      // Un punto solo también cuenta como trazo: hay quien firma con una marca.
      ctx.lineTo(p.x + 0.1, p.y);
      ctx.stroke();
      marcarTrazado();
      ev.preventDefault();
    }

    function seguir(ev) {
      if (!dibujando) return;
      const p = punto(ev);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ev.preventDefault();
    }

    function terminar() { dibujando = false; }

    function marcarTrazado() {
      if (trazado) return;
      trazado = true;
      lienzo.classList.add('firmado');
      if (estado) { estado.textContent = 'Firmado.'; estado.classList.add('lista'); }
    }

    function limpiar() {
      if (dimensionado) ctx.clearRect(0, 0, lienzo.width, lienzo.height);
      trazado = false;
      lienzo.classList.remove('firmado');
      if (estado) {
        estado.textContent = 'Pásele el teléfono para que firme con el dedo.';
        estado.classList.remove('lista');
      }
    }

    lienzo.addEventListener('pointerdown', empezar);
    lienzo.addEventListener('pointermove', seguir);
    lienzo.addEventListener('pointerup', terminar);
    lienzo.addEventListener('pointercancel', terminar);
    lienzo.addEventListener('pointerleave', terminar);
    if (borrar) borrar.addEventListener('click', limpiar);

    return {
      hayFirma: function () { return trazado; },
      // Devuelve '' si nadie firmó, para que quien llame no tenga que
      // distinguir entre un lienzo vacío y una firma de verdad.
      comoPNG: function () { return trazado ? lienzo.toDataURL('image/png') : ''; },
      limpiar: limpiar,
      // Se llama al mostrar la caja: es cuando el lienzo ya tiene ancho.
      alMostrar: function () { if (!dimensionado) dimensionar(); }
    };
  }

  window.activarFirma = activarFirma;
})();
