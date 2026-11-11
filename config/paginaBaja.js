/**
 * config/paginaBaja.js — La confirmación de la baja, UNA vez para las dos páginas públicas.
 *
 * La usan `/b/<código>` (routes/baja.routes.js) y `/v/<token>?baja=1`
 * (routes/yaVoto.routes.js). Dos copias de esto divergen solas, y aquí divergir significa
 * que una de las dos páginas se comporta distinto ante la misma persona —o, peor, que una de
 * ellas deja de dar de baja de verdad—.
 *
 * LA BAJA SE DA SÓLO AL TOCAR EL BOTÓN. NUNCA AL CARGAR LA PÁGINA.
 *
 *   La orden 12 la hacía sola: la página enviaba el POST con JavaScript al abrirse, para que
 *   quien abriera el enlace y se fuera quedara de baja. Se quitó (orden 12b) por lo que
 *   muestra el registro de la campaña municipal del 6 de noviembre de 2026: Google abre los
 *   enlaces de los SMS segundos después del envío, desde sus servidores, con un Chrome REAL
 *   («X11; Linux x86_64 Chrome/139», IPs 66.249.88.x y 74.125.x.x). Ese navegador ejecuta
 *   JavaScript y no tiene por qué anunciarse con `navigator.webdriver`. Con el envío
 *   automático, cada SMS que Google revisara habría dado de baja a su destinatario sin que
 *   éste supiera que existía un enlace.
 *
 *   No hay forma fiable de distinguir a una persona de ese Chrome desde la propia página, así
 *   que no se intenta: el único gesto que no hace un revisor es TOCAR el botón. El costo es el
 *   que ya se conocía —quien abre el enlace y se va sin tocar no queda de baja— y se paga con
 *   una página que no deja dudas: dice arriba, en grande, que AÚN NO está de baja, y tiene un
 *   solo botón grande. La baja a mano (Votantes → «Marcar como no contactar») cubre a quien la
 *   pide por otra vía.
 *
 * EL BOTÓN: al tocarlo se desactiva y dice «Procesando…». Si sale bien, la página cambia a
 * «Listo». Si falla (sin señal, 429, 500), el botón vuelve con un aviso para reintentar: una
 * baja que parece hecha y no lo está es el peor resultado posible.
 *
 * SIN JAVASCRIPT, el formulario normal hace el POST y el servidor responde la página «Listo».
 */
'use strict';

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Lo que dice la página ANTES de tocar. Corto: tiene que verse entero en un celular de 360 px. */
const ANTES = {
  titulo: 'Aún no estás dado de baja',
  cuerpo: 'Toca el botón para dejar de recibir mensajes de esta campaña.',
  boton: 'Sí, no quiero recibir más mensajes',
};

/** Lo que dice cuando la baja quedó registrada. Lo usan el POST normal y el de JavaScript. */
const LISTO = {
  titulo: 'Listo',
  cuerpo: 'Ya no recibirás más mensajes de esta campaña.',
};

/**
 * El bloque de la confirmación: el formulario con su botón y el script que lo envía al tocarlo.
 *
 * @param {string} accion  la URL del POST, ya codificada (`/b/…` o `/v/…?baja=1`)
 */
function confirmacionDeBaja(accion) {
  return `<style>
  .caja h1 { font-size: 1.7rem; line-height: 1.2; }
  #baja-boton { display: block; width: 100%; background: var(--texto, #1b2333); color: #fff; border: 0; border-radius: 999px;
                font-size: 1.2rem; font-weight: 800; line-height: 1.25; padding: 20px 16px; cursor: pointer; }
  #baja-boton:disabled { opacity: .65; cursor: default; }
</style>
<div id="baja-zona" data-ok-titulo="${esc(LISTO.titulo)}" data-ok-cuerpo="${esc(LISTO.cuerpo)}">
<form id="baja-form" method="post" action="${esc(accion)}"><button type="submit" id="baja-boton">${esc(ANTES.boton)}</button></form>
<p id="baja-msg" role="status" style="margin:14px 0 0; font-size:.95rem;"></p>
</div>
<script>
(function () {
  var zona = document.getElementById('baja-zona');
  var form = document.getElementById('baja-form');
  var boton = document.getElementById('baja-boton');
  var msg = document.getElementById('baja-msg');
  if (!zona || !form || !boton || !window.fetch) return;   // sin soporte: queda el formulario normal
  var caja = zona.parentNode;
  var h1 = caja.querySelector('h1');
  var p = caja.querySelector('p');
  var textoBoton = boton.textContent;
  var enviando = false;

  function listo() {
    if (h1) h1.textContent = zona.getAttribute('data-ok-titulo');
    if (p) { p.textContent = zona.getAttribute('data-ok-cuerpo'); p.className = 'ok'; }
    zona.style.display = 'none';
  }
  function enviar() {
    if (enviando) return;
    enviando = true;
    boton.disabled = true;
    boton.textContent = 'Procesando…';
    msg.textContent = '';
    fetch(form.action, { method: 'POST', credentials: 'omit', cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); listo(); })
      .catch(function () {
        enviando = false;
        boton.disabled = false;
        boton.textContent = textoBoton;
        msg.textContent = 'No pudimos registrar tu solicitud. Toca el botón para intentarlo de nuevo.';
      });
  }
  // SÓLO el envío del formulario (el toque en el botón). Nada se envía al cargar la página.
  form.addEventListener('submit', function (e) { e.preventDefault(); enviar(); });
})();
</script>`;
}

module.exports = { confirmacionDeBaja, ANTES, LISTO };
