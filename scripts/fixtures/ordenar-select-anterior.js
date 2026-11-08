/* FIXTURE de scripts/probar-ordenar-select.js: el ordenador de desplegables de public/js/common.js TAL COMO ERA antes del parche 304
   (copiado de git, sin cambios). Existe para REPRODUCIR el fallo en la prueba: si la prueba solo comprobara la versión nueva, un verde no
   demostraría que la prueba sabe detectar el problema. NO se carga en ninguna pantalla. */
const COMPARADOR_OPCIONES = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

/**
 * Ordena las opciones de un desplegable. Devuelve true si tuvo que moverlas.
 *
 * SI YA ESTABA ORDENADO NO TOCA EL DOM, y no es una optimización cosmética:
 * cada movimiento despierta al observador de abajo, así que reordenar a lo
 * tonto se realimenta. Comprobar primero corta ese ciclo en el caso normal.
 */
function ordenarSelect(select) {
  if (!select || select.tagName !== 'SELECT') return false;
  if (select.hasAttribute('data-sin-ordenar')) return false;

  // El propio select y cada grupo son contenedores independientes.
  const contenedores = [select, ...select.querySelectorAll('optgroup')];
  let cambio = false;

  for (const contenedor of contenedores) {
    const opciones = Array.from(contenedor.children).filter((n) => n.tagName === 'OPTION');
    if (opciones.length < 2) continue;

    // La opción sin valor es el rótulo del campo: se queda donde está.
    const fijas = opciones.filter((o) => o.value === '');
    const movibles = opciones.filter((o) => o.value !== '');
    if (movibles.length < 2) continue;

    const ordenadas = movibles.slice().sort((a, b) =>
      COMPARADOR_OPCIONES.compare((a.textContent || '').trim(), (b.textContent || '').trim()));
    if (ordenadas.every((o, i) => o === movibles[i])) continue;   // ya estaba

    /* SE GUARDA LA SELECCIÓN Y SE RESTAURA. Mover el <option> que está
       seleccionado hace que algunos navegadores devuelvan el select a su
       primera opción; el usuario vería su elección cambiar sola mientras
       escribe en otro campo. */
    const seleccionadas = Array.from(contenedor.querySelectorAll('option:checked')).map((o) => o.value);
    const valorPrevio = select.value;

    const trozo = document.createDocumentFragment();
    fijas.forEach((o) => trozo.appendChild(o));
    ordenadas.forEach((o) => trozo.appendChild(o));
    contenedor.appendChild(trozo);

    if (select.multiple) {
      Array.from(select.options).forEach((o) => { o.selected = seleccionadas.includes(o.value); });
    } else if (valorPrevio !== '' && select.value !== valorPrevio) {
      select.value = valorPrevio;
    }
    cambio = true;
  }
  return cambio;
}

/** Ordena todos los desplegables que haya bajo `raiz` (por omisión, la página). */
function ordenarTodosLosSelects(raiz) {
  const donde = raiz && raiz.querySelectorAll ? raiz : document;
  donde.querySelectorAll('select').forEach(ordenarSelect);
}

/* EL OBSERVADOR. Mira toda la página y ordena el desplegable que acabe de
   recibir opciones.

   SE DESACTIVA MIENTRAS ORDENA, y después se tiran los registros que él mismo
   provocó con `takeRecords()`. Sin eso el ciclo es inevitable: la llamada del
   observador es asíncrona, así que los movimientos hechos con la bandera
   puesta llegarían igualmente cuando ya está quitada, y volvería a ordenar
   para siempre.

   Se agrupa el trabajo en un `requestAnimationFrame` porque llenar un
   desplegable con `innerHTML` de mil opciones dispara una avalancha de
   mutaciones: ordenar en cada una sería ordenar mil veces la misma lista. */
let observadorSelects = null;
let pendientesDeOrdenar = new Set();
let ordenadoProgramado = false;

function procesarPendientes() {
  ordenadoProgramado = false;
  const lista = Array.from(pendientesDeOrdenar);
  pendientesDeOrdenar.clear();
  if (!lista.length || !observadorSelects) return;
  observadorSelects.disconnect();
  try {
    lista.forEach((s) => { if (s.isConnected) ordenarSelect(s); });
  } finally {
    observadorSelects.takeRecords();
    observadorSelects.observe(document.documentElement, { childList: true, subtree: true });
  }
}

function vigilarDesplegables() {
  if (observadorSelects || typeof MutationObserver === 'undefined') return;
  observadorSelects = new MutationObserver((mutaciones) => {
    for (const m of mutaciones) {
      // El contenedor que cambió: el select mismo, o el optgroup que lo lleva.
      const destino = m.target && m.target.closest ? m.target.closest('select') : null;
      if (destino) pendientesDeOrdenar.add(destino);
      /* UN DESPLEGABLE QUE LLEGA YA LLENO NO SE TOCA, y esta es la linea
         entera del diseño. Si las opciones aparecen DENTRO de un select que
         ya estaba en la pagina, vienen de la base de datos y se ordenan. Si
         llega un trozo de pagina que TRAE el select escrito dentro, lo
         escribio una persona en una plantilla y su orden es suyo:
         plantillaGrupo() en crm.html pinta asi cuatro desplegables cuyo orden
         es un rango, y el primero de ellos lleva `selected` en una opcion con
         valor real, que el alfabeto moveria de sitio. */
    }
    if (pendientesDeOrdenar.size && !ordenadoProgramado) {
      ordenadoProgramado = true;
      requestAnimationFrame(procesarPendientes);
    }
  });
  observadorSelects.observe(document.documentElement, { childList: true, subtree: true });
}

/* NO SE ORDENA LA PAGINA AL CARGAR, A PROPOSITO. Ver la nota de arriba: lo
   que ya esta escrito en el HTML lo puso una persona y su orden significa
   algo. Solo se vigila lo que llegue despues, que es lo que viene de la base
   de datos. `ordenarTodosLosSelects()` queda disponible para la pantalla que
   quiera pedirlo a mano; no la llama nadie sola. */
document.addEventListener('DOMContentLoaded', () => {
  vigilarDesplegables();
});
