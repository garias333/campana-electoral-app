/* FORMULARIO LARGO → PASO A PASO, para las pantallas de public/app/.

   Lo usa app/registro-votante.html. Sus estilos están en /app/pasos-formulario.css.

   QUÉ HACE Y QUÉ NO. Solo REORGANIZA lo que ya existe: MUEVE los nodos del formulario a N secciones y muestra una
   a la vez, con barra de progreso arriba y botones fijos abajo («← Atrás», «Siguiente →» y, en el último paso, el
   botón de guardar de siempre). appendChild conserva el nodo, su id y sus manejadores: NO toca las validaciones, el
   envío, la cola sin señal ni el dictado de la página. Si este archivo no carga (actualización a medias), el
   formulario se queda largo y sigue funcionando.

   LO QUE LA PÁGINA LE ENTREGA (`PasosFormulario.crear`):
     form            el <form>
     titulos         un texto por paso: define también cuántos son
     grupos          un arreglo de nodos por paso, en el orden en que se ven (los null se ignoran). Lo que no esté en
                     ningún grupo va al último paso: mejor un campo en un paso raro que uno que desaparece.
     botonGuardar    el submit de siempre; se muestra solo en el último paso
     cajaError       el aviso de error de la página (el MISMO nodo: se cambia de sitio, no se copia)
     validarPaso     (n, ctl) => boolean. «Siguiente» la llama con el paso actual y solo avanza si devuelve true. Si
                     devuelve false, ella misma muestra el motivo con ctl.senalar(n, texto, campo)
     destinoDelError (texto) => { paso, campo? }. Cuando la página muestra un error (envío local o 400 del
                     servidor) se salta al paso del campo, se marca y el aviso se muestra ahí
     arriba          el elemento fijo de arriba (la barra de la app): la barra de progreso se pega debajo de él

   Devuelve un controlador: { irAPaso, actual, total, senalar, marcar, reiniciar }. */
(function (global) {
  'use strict';

  /** El hijo DIRECTO del formulario que contiene a este elemento (o null). */
  function hijoDe(form, selector) {
    let el = form.querySelector(selector);
    while (el && el.parentElement !== form) el = el.parentElement;
    return el;
  }

  function crear(op) {
    const form = op.form;
    const TOTAL = op.titulos.length;
    const cajaError = op.cajaError || null;
    let actual = 1;

    /* ------------------------------ las secciones ------------------------------ */
    const pasos = op.grupos.map((nodos, i) => {
      const sec = document.createElement('section');
      sec.className = 'pf-paso';
      sec.dataset.paso = String(i + 1);
      (nodos || []).filter(Boolean).forEach((n) => sec.appendChild(n));
      return sec;
    });
    // Lo que haya quedado suelto (un campo nuevo que alguien agregue mañana) va al último paso.
    Array.from(form.children).forEach((n) => {
      if (n !== op.botonGuardar && n !== cajaError) pasos[TOTAL - 1].appendChild(n);
    });

    const cuerpo = document.createElement('div');
    cuerpo.className = 'pf-cuerpo';
    pasos.forEach((sec) => cuerpo.appendChild(sec));

    /* La barra de progreso, pegada bajo la barra de la app. */
    const cab = document.createElement('div');
    cab.className = 'pf-cab';
    cab.innerHTML = '<div class="pf-linea"><span class="pf-num"></span><span class="pf-titulo"></span></div>'
      + '<div class="pf-barra" aria-hidden="true"><i></i></div>';
    const elNum = cab.querySelector('.pf-num');
    const elTitulo = cab.querySelector('.pf-titulo');
    const elAvance = cab.querySelector('.pf-barra > i');

    /* Los botones fijos de abajo. El de guardar es el submit del formulario, no una copia. */
    const pie = document.createElement('div');
    pie.className = 'pf-pie';
    const pieIn = document.createElement('div');
    pieIn.className = 'pf-pie-in';
    const btnAtras = document.createElement('button');
    btnAtras.type = 'button'; btnAtras.className = 'btn-app btn-app-secundario pf-atras'; btnAtras.textContent = '← Atrás';
    const btnSig = document.createElement('button');
    btnSig.type = 'button'; btnSig.className = 'btn-app btn-app-primario pf-sig'; btnSig.textContent = 'Siguiente →';
    pieIn.append(btnAtras, btnSig);
    if (op.botonGuardar) pieIn.appendChild(op.botonGuardar);
    pie.appendChild(pieIn);

    form.prepend(cab);
    if (cajaError) form.insertBefore(cuerpo, cab.nextSibling); else form.appendChild(cuerpo);
    form.appendChild(pie);
    document.body.classList.add('pf-activo');

    /* Debajo de la barra de la app, que es fija y mide distinto según el teléfono (safe-area). */
    if (op.arriba) {
      const medir = () => form.style.setProperty('--pf-top', op.arriba.offsetHeight + 'px');
      medir();
      window.addEventListener('resize', medir);
      if (typeof ResizeObserver === 'function') new ResizeObserver(medir).observe(op.arriba);
    }

    /* ------------------------------- navegación ------------------------------- */
    function irAPaso(n) {
      actual = Math.max(1, Math.min(TOTAL, n));
      pasos.forEach((sec, i) => { sec.hidden = (i + 1 !== actual); });
      elNum.textContent = `Paso ${actual} de ${TOTAL}`;
      elTitulo.textContent = op.titulos[actual - 1];
      elAvance.style.width = `${(actual / TOTAL) * 100}%`;
      btnAtras.style.visibility = actual === 1 ? 'hidden' : 'visible';
      btnSig.style.display = actual === TOTAL ? 'none' : '';
      if (op.botonGuardar) op.botonGuardar.style.display = actual === TOTAL ? '' : 'none';
      window.scrollTo({ top: 0 });
    }

    function pasoDe(el) {
      const sec = el && el.closest && el.closest('.pf-paso');
      return sec ? Number(sec.dataset.paso) : null;
    }

    /* Marca un campo con borde rojo. null = quitar las marcas. */
    function marcar(campo) {
      form.querySelectorAll('.pf-error').forEach((c) => c.classList.remove('pf-error'));
      if (campo) campo.classList.add('pf-error');
    }

    /* Lleva a la persona al paso `n`, trae el aviso hasta ahí y marca el campo. `campo` undefined = no tocar las
       marcas que ya haya; null = limpiarlas. */
    function mostrarEnPaso(n, campo) {
      irAPaso(n);
      if (cajaError) pasos[n - 1].insertBefore(cajaError, pasos[n - 1].firstChild);
      if (campo !== undefined) marcar(campo);
      const objetivo = campo || cajaError;
      if (objetivo && objetivo.scrollIntoView) objetivo.scrollIntoView({ block: 'center' });
      if (campo && typeof campo.focus === 'function') campo.focus({ preventScroll: true });
    }

    function senalar(n, texto, campo) {
      if (cajaError) {
        cajaError.textContent = texto;
        cajaError.classList.add('visible');
      }
      mostrarEnPaso(n, campo);
    }

    btnSig.addEventListener('click', () => {
      if (op.validarPaso && !op.validarPaso(actual, ctl)) return;
      if (cajaError) cajaError.classList.remove('visible');
      marcar(null);
      irAPaso(actual + 1);
    });
    btnAtras.addEventListener('click', () => irAPaso(actual - 1));

    /* Enter en un campo NO envía el formulario desde un paso intermedio: avanza. En el último no hace nada
       (se guarda con el botón). */
    form.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || ['TEXTAREA', 'BUTTON'].includes(e.target.tagName)) return;
      if (e.target.type === 'checkbox' || e.target.type === 'radio') return;
      e.preventDefault();
      if (actual < TOTAL) btnSig.click();
    });

    /* Al corregir un campo se le quita la marca. */
    const limpiarMarca = (e) => { if (e.target.classList) e.target.classList.remove('pf-error'); };
    form.addEventListener('input', limpiarMarca);
    form.addEventListener('change', limpiarMarca);

    /* El navegador valida los `required` al enviar. Si el campo inválido está en un paso oculto no podría mostrar
       su aviso: se lleva a la persona a ese paso antes de que intente enfocarlo. */
    let saltando = false;
    form.addEventListener('invalid', (e) => {
      if (saltando) return;
      const n = pasoDe(e.target);
      if (!n) return;
      saltando = true;
      irAPaso(n);
      marcar(e.target);
      setTimeout(() => { saltando = false; }, 0);
    }, true);

    /* Los errores que escribe la página (al enviar, o del servidor) se llevan al paso del campo. */
    if (cajaError && op.destinoDelError) {
      new MutationObserver(() => {
        if (!cajaError.classList.contains('visible')) return;
        const d = op.destinoDelError(cajaError.textContent) || { paso: actual };
        mostrarEnPaso(d.paso, d.campo);
      }).observe(cajaError, { attributes: true, attributeFilter: ['class'] });
    }

    function reiniciar() {
      marcar(null);
      if (cajaError) cajaError.classList.remove('visible');
      irAPaso(1);
    }

    const ctl = { irAPaso, actual: () => actual, total: TOTAL, senalar, marcar, reiniciar, pasoDe };
    irAPaso(1);
    return ctl;
  }

  global.PasosFormulario = { crear, hijoDe };
})(window);
