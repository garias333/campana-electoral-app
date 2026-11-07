/**
 * config/paginaBaja.js — La confirmación de la baja, UNA vez para las dos páginas públicas.
 *
 * La usan `/b/<código>` (routes/baja.routes.js) y `/v/<token>?baja=1`
 * (routes/yaVoto.routes.js). Dos copias de esto divergen solas, y aquí divergir significa
 * que una de las dos páginas pide un toque más que la otra —o, peor, que una de ellas deja
 * de dar de baja de verdad—.
 *
 * POR QUÉ LA PÁGINA ENVÍA SOLA EL POST
 *   Medido en la campaña municipal (orden 10): quien abría el enlace de baja veía un botón
 *   «Confirmar mi baja» y, en los registros, había GET sin ningún POST. Abrió el enlace y se
 *   fue sin tocarlo. Para esa persona la baja no existía: la siguiente tanda le llegaba igual.
 *
 *   El GET sigue sin dar de baja, y eso NO se negocia: los clientes de SMS y de correo abren
 *   los enlaces por su cuenta para previsualizarlos. Lo que cambia es que la página, ya
 *   cargada en un navegador de verdad, manda ella misma el POST con JavaScript. Quien hace
 *   la precarga no ejecuta JavaScript, así que no da de baja a nadie.
 *
 * LO QUE SÍ EJECUTA JAVASCRIPT
 *   Los escáneres de seguridad de algunos correos corporativos abren el enlace en un
 *   navegador sin cabeza. Esos se anuncian con `navigator.webdriver`; si está activo, la
 *   página NO envía sola y deja el botón. No es infalible —un escáner puede ocultarlo—, y
 *   por eso es una defensa más y no la razón por la que esto es seguro: lo es porque el
 *   enlace de baja de una persona sólo llega a esa persona.
 *
 * SIN JAVASCRIPT queda el formulario con su botón, como antes. Y si el POST falla (sin señal,
 * 429, 500), el botón vuelve con un aviso para que la persona reintente: una baja que parece
 * hecha y no lo está es el peor resultado posible.
 */
'use strict';

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Lo que dice la página cuando la baja quedó registrada. Lo usan el POST normal y el automático. */
const LISTO = {
  titulo: 'Listo',
  cuerpo: 'Su solicitud quedó registrada. Ya no recibirás más mensajes de esta campaña.',
};

/**
 * El bloque de la confirmación: el formulario (visible sin JavaScript) y el script que lo envía.
 *
 * @param {string} accion     la URL del POST, ya codificada (`/b/…` o `/v/…?baja=1`)
 * @param {string} botonHtml  el <button type="submit"> con el estilo de cada página
 */
function confirmacionDeBaja(accion, botonHtml) {
  return `<div id="baja-zona" data-ok-titulo="${esc(LISTO.titulo)}" data-ok-cuerpo="${esc(LISTO.cuerpo)}">
<form id="baja-form" method="post" action="${esc(accion)}">${botonHtml}</form>
<p id="baja-msg" role="status" style="margin:14px 0 0;"></p>
</div>
<script>
(function () {
  var zona = document.getElementById('baja-zona');
  var form = document.getElementById('baja-form');
  if (!zona || !form || !window.fetch) return;           // sin soporte: queda el botón
  if (navigator.webdriver) return;                        // navegador automático (escáner): queda el botón
  var caja = zona.parentNode;
  var h1 = caja.querySelector('h1');
  var p = caja.querySelector('p');
  var msg = document.getElementById('baja-msg');
  var enviando = false;

  function listo() {
    if (h1) h1.textContent = zona.getAttribute('data-ok-titulo');
    if (p) { p.textContent = zona.getAttribute('data-ok-cuerpo'); p.className = 'ok'; }
    zona.style.display = 'none';
  }
  function enviar() {
    if (enviando) return;
    enviando = true;
    form.style.display = 'none';
    msg.textContent = 'Registrando su solicitud…';
    fetch(form.action, { method: 'POST', credentials: 'omit', cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); listo(); })
      .catch(function () {
        enviando = false;
        form.style.display = '';
        msg.textContent = 'No pudimos registrar su solicitud. Toque el botón para intentarlo de nuevo.';
      });
  }
  form.addEventListener('submit', function (e) { e.preventDefault(); enviar(); });
  enviar();
})();
</script>`;
}

module.exports = { confirmacionDeBaja, LISTO };
