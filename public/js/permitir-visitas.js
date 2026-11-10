/**
 * public/js/permitir-visitas.js — «Volver a permitir visitas», en la ficha del votante (parche 309).
 *
 * Quita la marca «pidió no volver» (`votantes.no_visitar`). SOLO el administrador: quien no lo es no ve el botón, y aunque lo viera el servidor
 * responde 403. El motivo y la fecha en que el ciudadano lo pidió son obligatorios y quedan en la auditoría. NO toca «no contactar» (los mensajes):
 * son dos marcas distintas.
 *
 * Usa `api` y `escaparHtml` de common.js.
 */
(function () {
  'use strict';

  /** Solo el administrador, y solo con «Puerta a puerta» encendido (Activar complementos, parche 318): apagado, el botón no se ofrece. La ruta del servidor no cambia. */
  window.puedePermitirVisitas = function (usuario) {
    return !!usuario && usuario.rol === 'admin' && typeof complementoActivo === 'function' && complementoActivo(usuario, 'puerta_a_puerta');
  };

  function hoyEnColombia() {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  /** @param {{id:number, nombre?:string, alListo?:function}} o */
  window.abrirPermitirVisitas = function (o) {
    var previa = document.getElementById('overlay-permitir-visitas');
    if (previa) previa.remove();

    var hoy = hoyEnColombia();
    var ov = document.createElement('div');
    ov.id = 'overlay-permitir-visitas';
    ov.className = 'overlay abierto';
    ov.style.cssText = 'display:flex; align-items:center; justify-content:center; position:fixed; inset:0; background:rgba(16,35,63,.55); z-index:9999; padding:16px;';
    ov.innerHTML =
      '<div class="modal" style="background:var(--color-surface,#fff); border-radius:12px; padding:20px; max-width:440px; width:100%; max-height:92vh; overflow:auto;">' +
        '<h3 style="margin:0 0 6px;">Volver a permitir visitas</h3>' +
        '<p style="margin:0 0 14px; font-size:.9rem; color:var(--color-text-muted,#5B6472);">' +
          '<strong>' + escaparHtml(o.nombre || 'Esta persona') + '</strong> pidió que no la visitaran. Quítale esa marca solo si <strong>ella</strong> ' +
          'pidió volver a recibir visitas. Sus mensajes (SMS, correo, WhatsApp) no cambian.</p>' +
        '<div class="campo"><label for="pv-fecha">¿Qué día lo pidió?</label>' +
          '<input type="date" id="pv-fecha" value="' + hoy + '" max="' + hoy + '"></div>' +
        '<div class="campo"><label for="pv-motivo">Motivo <small style="font-weight:400;">(queda en la auditoría)</small></label>' +
          '<textarea id="pv-motivo" rows="3" maxlength="255" placeholder="Ej.: el ciudadano lo pidió por teléfono"></textarea></div>' +
        '<div id="pv-error" class="mensaje-error" style="display:none; margin-bottom:10px;"></div>' +
        '<div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px;">' +
          '<button type="button" class="btn-secundario" id="pv-cancelar">Cancelar</button>' +
          '<button type="button" class="btn-primario" id="pv-guardar">Volver a permitir visitas</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    var fecha = ov.querySelector('#pv-fecha');
    var motivo = ov.querySelector('#pv-motivo');
    var error = ov.querySelector('#pv-error');
    var guardar = ov.querySelector('#pv-guardar');
    function cerrar() { ov.remove(); }
    function falla(texto) { error.textContent = texto; error.style.display = 'block'; }

    ov.querySelector('#pv-cancelar').addEventListener('click', cerrar);
    ov.addEventListener('click', function (e) { if (e.target === ov) cerrar(); });

    guardar.addEventListener('click', async function () {
      error.style.display = 'none';
      if (!fecha.value) return falla('Escribe el día en que el ciudadano lo pidió.');
      if (motivo.value.trim().length < 5) return falla('Escribe el motivo (al menos 5 letras): por ejemplo, «el ciudadano lo pidió».');
      guardar.disabled = true;
      try {
        await api('/puerta-a-puerta/votantes/' + encodeURIComponent(o.id) + '/permitir-visitas', {
          method: 'POST',
          body: { motivo: motivo.value.trim(), fecha_pedido: fecha.value },
        });
        cerrar();
        alert('Listo. Esta persona puede volver a entrar en una lista de visitas.');
        if (typeof o.alListo === 'function') o.alListo();
      } catch (err) {
        guardar.disabled = false;
        falla(err.message || 'No se pudo quitar la marca.');
      }
    });
    motivo.focus();
  };
})();
