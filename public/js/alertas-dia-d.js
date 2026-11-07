/**
 * public/js/alertas-dia-d.js — lo que comparten la pestaña «Alertas» del escritorio (dia-d.html) y la pantalla del celular
 * (app/alertas-dia-d.html): cómo se dibuja una alerta, los chips de conteo y las acciones de una alerta.
 *
 * NO PIDE DATOS NI REFRESCA: cada pantalla trae `GET /api/dia-d/alertas` a su ritmo (30 s en escritorio, 60 s en celular, con
 * copia sin señal) y le pasa el resultado a estas funciones. Así hay UNA sola forma de decir «atendida» o «pendiente».
 *
 * Las acciones (`data-acc`) las atiende `AlertasDiaD.alTocar(evento, ctx)`: marcar atendida (con nota opcional), marcar la
 * llegada de un testigo a mano, y los enlaces de llamar y WhatsApp (que son <a> y no necesitan código).
 */
(function () {
  'use strict';

  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function digitos(t) { return String(t || '').replace(/\D/g, ''); }
  function aInternacional(tel) { var d = digitos(tel); return d ? (d.indexOf('57') === 0 && d.length > 10 ? d : '57' + d) : ''; }
  function hora(texto) { return texto ? String(texto).slice(11, 16) : ''; }

  var ESTILO = '.al-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}' +
    '.al-chip{border:1.5px solid #C9D2E0;background:#fff;color:#1B2432;border-radius:16px;padding:5px 11px;font-size:.82rem;cursor:pointer;font-weight:600}' +
    '.al-chip b{margin-left:5px;color:#A93226}.al-chip small{color:#8A94A6;font-weight:500;margin-left:3px}' +
    '.al-chip.activo{background:#1B2432;color:#fff;border-color:#1B2432}.al-chip.activo b{color:#FFC300}' +
    '.al-fila{border:1px solid #DDE3EC;border-left:6px solid #A93226;border-radius:10px;background:#fff;padding:10px 12px;margin-bottom:8px}' +
    '.al-fila.g2{border-left-color:#C0560F}.al-fila.g3{border-left-color:#E09B1A}.al-fila.g4{border-left-color:#B8860B}' +
    '.al-fila.g5{border-left-color:#7A4FB5}.al-fila.g6{border-left-color:#1B6CA8}.al-fila.g7{border-left-color:#8A94A6}' +
    '.al-fila.al-pendiente{border-left-color:#B8C0CC;background:#F4F6F9;color:#7A8497}.al-fila.al-atendida{opacity:.5}' +
    '.al-cab{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}.al-tipo{font-weight:700;font-size:.9rem}' +
    '.al-donde{font-size:.92rem}.al-det{font-size:.88rem;margin-top:2px}.al-meta{font-size:.78rem;color:#6B7585;margin-top:3px}' +
    '.al-trans{font-size:.78rem;color:#1B6CA8;margin-top:3px}.al-acc{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}' +
    '.al-acc a,.al-acc button{border:0;border-radius:8px;padding:7px 12px;font-size:.82rem;font-weight:700;cursor:pointer;text-decoration:none;color:#fff;background:#1B2432}' +
    '.al-acc a.wa{background:#1E7A3D}.al-acc a.ll{background:#1B6CA8}.al-acc button.llegada{background:#7A4FB5}' +
    '.al-acc button.at{background:#fff;color:#1B2432;border:1.5px solid #1B2432}';
  function inyectarEstilo() {
    if (document.getElementById('estilo-alertas-dia-d')) return;
    var s = document.createElement('style'); s.id = 'estilo-alertas-dia-d'; s.textContent = ESTILO; document.head.appendChild(s);
  }

  /** Los chips: «Todas» y uno por tipo con su conteo de activas (y las pendientes, en gris). */
  function chipsHtml(r, filtro) {
    var total = r.tipos.reduce(function (n, t) { return n + t.activas; }, 0);
    var pend = r.tipos.reduce(function (n, t) { return n + t.pendientes; }, 0);
    var html = '<button type="button" class="al-chip' + (!filtro ? ' activo' : '') + '" data-tipo="">Todas <b>' + total + '</b>' +
      (pend ? '<small>+' + pend + ' pend.</small>' : '') + '</button>';
    r.tipos.forEach(function (t) {
      html += '<button type="button" class="al-chip' + (filtro === t.tipo ? ' activo' : '') + '" data-tipo="' + esc(t.tipo) + '">' +
        esc(t.nombre) + ' <b>' + t.activas + '</b>' + (t.pendientes ? '<small>+' + t.pendientes + ' pend.</small>' : '') + '</button>';
    });
    return html;
  }

  /** Una alerta. */
  function filaHtml(a) {
    var tel = a.responsable && a.responsable.telefono ? digitos(a.responsable.telefono) : '';
    var donde = esc(a.puesto) + (a.mesa ? ' · Mesa ' + a.mesa : '');
    var meta = [];
    if (a.estado === 'pendiente') meta.push('Pendiente: se activa a las ' + esc(a.pendiente_hasta));
    else if (a.desde) meta.push('Desde ' + esc(a.desde.length > 10 && a.desde.slice(0, 10) === (a.desde_hoy || '') ? hora(a.desde) : a.desde));
    if (a.responsable && a.responsable.nombre) meta.push('Responsable: ' + esc(a.responsable.nombre) + (tel ? ' · ' + esc(a.responsable.telefono) : ''));
    if (a.atendida) meta.push('Atendida' + (a.atendida_por ? ' por ' + esc(a.atendida_por) : '') + (a.atendida_en ? ' a las ' + esc(hora(a.atendida_en)) : '') + (a.nota ? ' — ' + esc(a.nota) : ''));
    var acc = '';
    if (tel) {
      acc += '<a class="ll" href="tel:' + tel + '">Llamar</a>';
      acc += '<a class="wa" href="https://wa.me/' + aInternacional(tel) + '" target="_blank" rel="noopener">WhatsApp</a>';
    }
    if (a.tipo === 'testigo_no_llego' && a.responsable && a.responsable.usuario_id && a.estado !== 'pendiente' && !a.atendida) {
      acc += '<button type="button" class="llegada" data-acc="llegada" data-uid="' + a.responsable.usuario_id + '">Marcar llegada</button>';
    }
    acc += '<button type="button" class="at" data-acc="atendida" data-tipo="' + esc(a.tipo) + '" data-puesto="' + (a.puesto_id || 0) + '" data-mesa="' + (a.mesa || 0) +
      '" data-atendida="' + (a.atendida ? '1' : '0') + '">' + (a.atendida ? 'Quitar atendida' : 'Atendida') + '</button>';
    return '<div class="al-fila g' + a.gravedad + (a.estado === 'pendiente' ? ' al-pendiente' : '') + (a.atendida ? ' al-atendida' : '') + '" data-id="' + esc(a.id) + '">' +
      '<div class="al-cab"><span class="al-tipo">' + esc(a.nombre_tipo) + '</span><span class="al-donde">' + donde + '</span></div>' +
      '<div class="al-det">' + esc(a.detalle) + '</div>' +
      (meta.length ? '<div class="al-meta">' + meta.join(' · ') + '</div>' : '') +
      (a.faltan_transporte ? '<div class="al-trans">🚐 ' + a.faltan_transporte + (a.faltan_transporte === 1 ? ' faltante necesita' : ' faltantes necesitan') + ' transporte en este puesto</div>' : '') +
      '<div class="al-acc">' + acc + '</div></div>';
  }

  /**
   * Atiende los toques de una pantalla. `ctx.recargar()` vuelve a pedir las alertas; `ctx.api` es la función api de la página.
   * @returns {Promise<boolean>} true si hizo algo.
   */
  async function alTocar(e, ctx) {
    var b = e.target.closest ? e.target.closest('[data-acc]') : null;
    if (!b) return false;
    var acc = b.getAttribute('data-acc');
    b.disabled = true;
    try {
      if (acc === 'atendida') {
        var quitar = b.getAttribute('data-atendida') === '1';
        var nota = null;
        if (!quitar) { nota = prompt('Nota (opcional): qué se hizo'); if (nota === null) { b.disabled = false; return true; } }
        await ctx.api('/dia-d/alertas/atendida', { method: 'POST', body: {
          tipo: b.getAttribute('data-tipo'), puesto_id: Number(b.getAttribute('data-puesto')), mesa: Number(b.getAttribute('data-mesa')),
          atendida: !quitar, nota: nota || undefined } });
      } else if (acc === 'llegada') {
        if (!confirm('¿Marcar la llegada de este testigo? Queda registrado que la marcaste tú.')) { b.disabled = false; return true; }
        await ctx.api('/dia-d/checkin/manual', { method: 'POST', body: { usuario_id: Number(b.getAttribute('data-uid')) } });
      }
      await ctx.recargar();
    } catch (err) {
      alert(err.message || 'No se pudo hacer el cambio.');
      b.disabled = false;
    }
    return true;
  }

  window.AlertasDiaD = { inyectarEstilo: inyectarEstilo, chipsHtml: chipsHtml, filaHtml: filaHtml, alTocar: alTocar, esc: esc };
})();
