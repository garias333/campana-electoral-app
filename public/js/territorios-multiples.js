/**
 * LAS FICHAS DE TERRITORIO: una persona puede cubrir varios.
 *
 * Esta pieza es COMPARTIDA por Estructura territorial y por el formulario de
 * sublíder de Votantes. No sabe nada de ninguna de las dos pantallas: cada una
 * le presta lo que le falta —cómo se resuelve la selección actual, cómo se
 * llama un territorio, cómo se vacía el selector— y ella solo guarda la lista
 * y la pinta.
 *
 * EL MODELO, EN TRES REGLAS
 *   1. Lo que el usuario ya confirmó con «+ Agregar otro territorio» son FICHAS.
 *      Lo que tiene escrito en el selector ahora mismo es la selección PENDIENTE.
 *   2. Al guardar se manda `[...fichas, pendiente]`, sin repetir. El PRIMERO es
 *      el principal: es el que el servidor deja en `estructura.territorio_id`.
 *   3. Ningún tipo está prohibido. Una ficha puede ser un barrio, una vereda, una
 *      comuna o —en campaña departamental— un municipio entero.
 *
 * NO HAY LLAMADAS AL SERVIDOR AQUÍ y no se toca ningún evento del selector: la
 * pantalla decide cuándo se recalcula nada (por ejemplo «Reporta a»).
 *
 * Opciones:
 *   contenedor   elemento donde se pintan las fichas
 *   boton        el botón «+ Agregar otro territorio»
 *   resolver()   la selección actual: { territorioId } o { error }. Es el
 *                resolver que la pantalla YA usaba para guardar un solo territorio.
 *   nombreDe(id) cómo se llama un territorio en pantalla (o null si no se conoce)
 *   limpiar()    deja el selector vacío, listo para elegir otro (sin disparar eventos)
 *   mostrarError(texto) / quitarError()
 *   alCambiar(motivo, huboCambioDePrincipal)   motivo: 'agregar' | 'quitar' | 'fijar' | 'vaciar'
 */
(function (global) {
  'use strict';

  function crearFichasTerritorios(opciones) {
    const o = opciones || {};
    let ids = [];   // ids[0] es el principal

    function nombre(id) {
      const n = o.nombreDe ? o.nombreDe(id) : null;
      return n || ('Territorio ' + id);
    }

    function avisar(motivo, principalAntes) {
      if (typeof o.alCambiar === 'function') {
        o.alCambiar(motivo, (ids.length ? ids[0] : null) !== principalAntes);
      }
    }

    function pintar() {
      const raiz = o.contenedor;
      if (!raiz) return;
      raiz.innerHTML = '';
      ids.forEach((id, posicion) => {
        const ficha = document.createElement('span');
        ficha.className = 'ficha-territorio' + (posicion === 0 ? ' ficha-territorio-principal' : '');
        ficha.setAttribute('role', 'listitem');

        const texto = document.createElement('span');
        texto.className = 'ficha-territorio-texto';
        texto.textContent = nombre(id);
        ficha.appendChild(texto);

        if (posicion === 0 && ids.length > 1) {
          const marca = document.createElement('small');
          marca.className = 'ficha-territorio-marca';
          marca.textContent = 'principal';
          ficha.appendChild(marca);
        }

        const quitar = document.createElement('button');
        quitar.type = 'button';
        quitar.className = 'ficha-territorio-quitar';
        quitar.setAttribute('aria-label', 'Quitar ' + nombre(id));
        quitar.textContent = '×';
        quitar.addEventListener('click', () => {
          const principalAntes = ids.length ? ids[0] : null;
          ids = ids.filter(x => x !== id);
          pintar();
          if (typeof o.quitarError === 'function') o.quitarError();
          avisar('quitar', principalAntes);
        });
        ficha.appendChild(quitar);
        raiz.appendChild(ficha);
      });
      raiz.style.display = ids.length ? 'flex' : 'none';
    }

    if (o.boton) {
      o.boton.addEventListener('click', () => {
        const resuelto = typeof o.resolver === 'function' ? o.resolver() : { territorioId: null };
        const falla = (texto) => { if (typeof o.mostrarError === 'function') o.mostrarError(texto); };
        if (resuelto.error) { falla(resuelto.error); return; }
        if (!resuelto.territorioId) { falla('Elija primero el territorio que quiere agregar.'); return; }
        if (ids.includes(resuelto.territorioId)) { falla('Ese territorio ya está en la lista.'); return; }
        const principalAntes = ids.length ? ids[0] : null;
        ids.push(resuelto.territorioId);
        if (typeof o.limpiar === 'function') o.limpiar();
        if (typeof o.quitarError === 'function') o.quitarError();
        pintar();
        avisar('agregar', principalAntes);
      });
    }

    pintar();

    return {
      /** Los ids confirmados, en orden; el primero es el principal. */
      ids() { return ids.slice(); },
      hayFichas() { return ids.length > 0; },
      principal() { return ids.length ? ids[0] : null; },
      /** Reemplaza la lista (por ejemplo al abrir una persona para editarla). */
      fijar(nuevos) {
        const principalAntes = ids.length ? ids[0] : null;
        ids = [];
        (nuevos || []).forEach((id) => { if (id && !ids.includes(id)) ids.push(id); });
        pintar();
        avisar('fijar', principalAntes);
      },
      vaciar() {
        const principalAntes = ids.length ? ids[0] : null;
        ids = [];
        pintar();
        avisar('vaciar', principalAntes);
      },
      /**
       * La lista que se manda al servidor: las fichas más la selección pendiente,
       * sin repetir. `pendienteId` es el id que resolvió el selector (o null).
       */
      listaParaGuardar(pendienteId) {
        const lista = ids.slice();
        if (pendienteId && !lista.includes(pendienteId)) lista.push(pendienteId);
        return lista;
      },
    };
  }

  global.crearFichasTerritorios = crearFichasTerritorios;
})(window);
