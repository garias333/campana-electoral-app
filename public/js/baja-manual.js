/**
 * public/js/baja-manual.js — «Marcar como no contactar», a mano.
 *
 * Lo usan la ficha del votante (votantes.html) y la de la estructura (territorial.html).
 * Una sola ventana para las dos: el motivo y el canal son obligatorios, y dos copias de
 * esta ventana acaban pidiendo cosas distintas.
 *
 * POR QUÉ EXISTE
 *   El SMS sale por un código corto del operador y las respuestas («NO», «BAJA») no llegan
 *   a la app. Y hay quien lo pide por teléfono o en persona. Sin esto el equipo sabía que
 *   alguien se había salido y no tenía dónde anotarlo.
 *
 * El servidor es quien manda: sólo admin y coordinador, motivo y canal obligatorios
 * (POST /api/comunicaciones/bajas/manual). Esta ventana es la comodidad; quien no tenga el
 * permiso ni ve el botón (`puedeMarcarBajaManual`), pero aunque lo viera recibiría 403.
 *
 * Usa `api` y `escaparHtml` de common.js.
 */
(function () {
  'use strict';

  var CANALES = [
    ['sms', 'SMS respondido'],
    ['llamada', 'Llamada'],
    ['en_persona', 'En persona'],
    ['whatsapp', 'WhatsApp'],
    ['otro', 'Otro'],
  ];

  /** Los mismos dos roles que ven «Pidieron no recibir más». */
  window.puedeMarcarBajaManual = function (usuario) {
    return !!usuario && ['admin', 'coordinador'].indexOf(usuario.rol) !== -1;
  };

  /**
   * @param {{tipo:'votante'|'usuario', id:number, nombre?:string, alListo?:function}} o
   */
  window.abrirBajaManual = function (o) {
    var previa = document.getElementById('overlay-baja-manual');
    if (previa) previa.remove();

    var ov = document.createElement('div');
    ov.id = 'overlay-baja-manual';
    ov.className = 'overlay abierto';
    ov.style.cssText = 'display:flex; align-items:center; justify-content:center; position:fixed; inset:0; background:rgba(16,35,63,.55); z-index:9999; padding:16px;';
    ov.innerHTML =
      '<div class="modal" style="background:var(--color-surface,#fff); border-radius:12px; padding:20px; max-width:440px; width:100%; max-height:92vh; overflow:auto;">' +
        '<h3 style="margin:0 0 6px;">Marcar como no contactar</h3>' +
        '<p style="margin:0 0 14px; font-size:.9rem; color:var(--color-text-muted,#5B6472);">' +
          '<strong>' + escaparHtml(o.nombre || 'Esta persona') + '</strong> quedará fuera de todos los envíos, por cualquier canal, ' +
          'junto con las fichas que compartan su teléfono o correo. Anótelo sólo si <strong>ella</strong> lo pidió.</p>' +
        '<div class="campo"><label for="bm-canal">¿Por dónde lo pidió?</label>' +
          '<select id="bm-canal"><option value="">Elija…</option>' +
          CANALES.map(function (c) { return '<option value="' + c[0] + '">' + escaparHtml(c[1]) + '</option>'; }).join('') +
          '</select></div>' +
        '<div class="campo"><label for="bm-motivo">Motivo <small style="font-weight:400;">(queda en la ficha y en la auditoría)</small></label>' +
          '<textarea id="bm-motivo" rows="3" maxlength="255" placeholder="Ej.: respondió NO al SMS del 12/11; llamó para pedir que no le escriban"></textarea></div>' +
        '<div id="bm-error" class="mensaje-error" style="display:none; margin-bottom:10px;"></div>' +
        '<div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px;">' +
          '<button type="button" class="btn-secundario" id="bm-cancelar">Cancelar</button>' +
          '<button type="button" class="btn-primario" id="bm-guardar">Marcar como no contactar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    var canal = ov.querySelector('#bm-canal');
    var motivo = ov.querySelector('#bm-motivo');
    var error = ov.querySelector('#bm-error');
    var guardar = ov.querySelector('#bm-guardar');
    function cerrar() { ov.remove(); }
    function falla(texto) { error.textContent = texto; error.style.display = 'block'; }

    ov.querySelector('#bm-cancelar').addEventListener('click', cerrar);
    ov.addEventListener('click', function (e) { if (e.target === ov) cerrar(); });

    guardar.addEventListener('click', async function () {
      error.style.display = 'none';
      if (!canal.value) return falla('Elija por dónde lo pidió.');
      if (!motivo.value.trim()) return falla('Escriba el motivo.');
      guardar.disabled = true;
      try {
        var r = await api('/comunicaciones/bajas/manual', {
          method: 'POST',
          body: { tipo: o.tipo, id: o.id, canal: canal.value, motivo: motivo.value.trim() },
        });
        cerrar();
        alert(r.ya_estaba
          ? 'Esta persona ya estaba de baja: no se cambió nada.'
          : 'Listo. Quedó fuera de los envíos (' + r.fichas + ' ficha(s) marcada(s)).');
        if (typeof o.alListo === 'function') o.alListo(r);
      } catch (err) {
        guardar.disabled = false;
        falla(err.message || 'No se pudo anotar la baja.');
      }
    });
    canal.focus();
  };
})();
