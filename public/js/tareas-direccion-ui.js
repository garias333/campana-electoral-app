/**
 * «TAREAS DE DIRECCIÓN» (orden 116) — las piezas que comparten las dos pantallas: el tablero de escritorio y la del celular del candidato.
 * Carga DESPUÉS de /js/tareas-direccion-reglas.js y de api() (api-core.js o common.js). Prefijo `td-` en clases (public/css/tareas-direccion.css).
 *
 * Lo que vive aquí: el escape de texto, la hoja de calendario, el avatar, el detalle (datos, botón «Marcar como realizada», historial), el formulario
 * (el MISMO en escritorio y celular), la confirmación y el aviso «Tarea marcada como realizada · Deshacer». Las pantallas solo deciden dónde ponerlos.
 * NADA se guarda sin señal: si no hay red, el mensaje lo dice y no se encola nada.
 */
(function (global) {
  'use strict';
  var R = global.TareasDir;

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function iniciales(nombre) {
    var p = String(nombre || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return p.map(function (x) { return x.charAt(0).toUpperCase(); }).join('') || '—';
  }
  /** «8:00 a. m.» de un sello «AAAA-MM-DD hh:mm:ss». */
  function hora12(sello) {
    var m = /(\d{2}):(\d{2})/.exec(String(sello || '').slice(11));
    if (!m) return '';
    var h = +m[1]; var ampm = h >= 12 ? 'p. m.' : 'a. m.';
    return ((h % 12) || 12) + ':' + m[2] + ' ' + ampm;
  }
  function fechaHora(sello) { return R.formatoCorto(R.soloFecha(sello)) + ', ' + hora12(sello); }

  var SVG_WA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.25-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35m-5.42 7.4h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88m8.41-18.3A11.8 11.8 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.41z"/></svg>';

  /** La hoja de calendario (rojo vencida · amarillo hoy/mañana · verde hecha · azul a tiempo). */
  function hojaHtml(t) {
    var dm = R.diaYMes(t.fecha_limite);
    return '<div class="td-hoja ' + R.COLOR_ESTADO[t.estado_fecha] + '" aria-hidden="true"><div class="mes">' + esc(dm.mes) + '</div><div class="dia">' + esc(dm.dia) + '</div></div>';
  }
  function etiquetaEstadoHtml(t) { return '<span class="td-est ' + t.estado_fecha + '">' + R.ROTULO_ESTADO[t.estado_fecha] + '</span>'; }

  /** ¿Se ofrece WhatsApp en esta tarea? No para el candidato, ni en las hechas, ni sin celular. */
  function conWhatsapp(t) { return !!t.responsable.celular && !t.responsable.es_candidato && t.estado !== 'hecha'; }

  /* ---------------------------------------------------------------------------------------- detalle ---- */
  function textoAvisoDetalle(t) {
    var app = t.canal_previsto === 'app';
    if (t.estado === 'hecha' && t.aviso_estado === 'cancelado') return 'Cancelado: la tarea está realizada';
    if (!t.aviso_activo || t.aviso_estado === 'cancelado') return 'Apagado';
    switch (t.aviso_estado) {
      case 'programado':
        return (app ? 'En la app' : 'SMS al ' + R.enmascarar(t.responsable.celular)) + ' el ' + R.formatoCorto(t.aviso_para) + ' a las 8:00 a. m.';
      case 'enviado': return 'Enviado ' + (t.aviso_canal === 'app' ? 'en la app' : 'por SMS') + ' el ' + fechaHora(t.aviso_enviado_en);
      case 'sin_celular': return 'Sin celular: no hay forma de avisarle';
      case 'fallido': return 'No se pudo enviar (vea el historial)';
      case 'no_aplica': return 'Ya no aplica: la fecha límite está encima';
      default: return 'Apagado';
    }
  }

  var ROTULO_EVENTO = { creada: 'Creada', editada: 'Cambio', en_curso: 'En curso', realizada: 'Realizada', reabierta: 'Reabierta', aviso_enviado: 'Aviso enviado',
    aviso_cancelado: 'Aviso cancelado', aviso_fallido: 'Aviso fallido', whatsapp: 'WhatsApp' };
  function historialHtml(eventos) {
    if (!eventos || !eventos.length) return '';
    return '<h3 class="td-sub">Historial</h3><ul class="td-hist">' + eventos.slice().reverse().map(function (e) {
      return '<li><time>' + esc(fechaHora(e.creado_en)) + '</time><span><b>' + esc(ROTULO_EVENTO[e.tipo] || e.tipo) + '.</b> ' + esc(e.detalle || '') + '</span></li>';
    }).join('') + '</ul>';
  }

  /** El cuerpo del detalle. `o.nota`: el texto bajo el botón verde. Los botones llevan `data-accion` (realizada | reabrir) para que la pantalla los conecte. */
  function detalleHtml(d, o) {
    o = o || {};
    var t = d.tarea; var hoy = d.hoy;
    var cel = t.responsable.celular ? ' · ' + R.enmascarar(t.responsable.celular) : '';
    var plazo = t.estado === 'hecha' ? R.textoHecha(t.fecha_limite, t.realizada_en) : R.textoPlazo(t.fecha_limite, hoy);
    var h = '<dl class="td-datos">'
      + '<dt>Responsable</dt><dd><b>' + esc(t.responsable.nombre) + '</b><span class="bajo">' + esc(t.responsable.cargo) + esc(cel) + '</span>'
      + (t.responsable.fuera_del_organigrama ? '<span class="bajo marca-fuera">⚠ Responsable fuera del organigrama. Al editar la tarea hay que elegir a alguien de la lista.</span>'
        : (!t.responsable.celular && !t.responsable.es_candidato ? '<span class="bajo marca-fuera">Sin celular registrado: no habrá SMS ni WhatsApp.</span>' : '')) + '</dd>'
      + '<dt>Fecha límite</dt><dd>' + esc(R.formatoCorto(t.fecha_limite)) + '<span class="bajo">' + esc(plazo) + '</span></dd>'
      + '<dt>Prioridad</dt><dd>' + (t.prioridad === 'urgente' ? '⚡ Urgente' : 'Normal') + '</dd>'
      + '<dt>Aviso automático</dt><dd>' + esc(textoAvisoDetalle(t)) + '</dd>'
      + '</dl>';
    if (t.estado === 'hecha') {
      h += '<button type="button" class="td-btn borde" data-accion="reabrir" style="width:100%;margin:0 0 6px;">↩ Reabrir (volver a Pendientes)</button>';
    } else {
      h += '<button type="button" class="td-grande" data-accion="realizada">✓ Marcar como realizada</button>'
        + '<p class="td-nota">' + esc(o.nota || 'Si la marca hoy, el aviso automático se cancela.') + '</p>';
    }
    return h + historialHtml(d.eventos);
  }

  /* ---------------------------------------------------------------------------------- confirmar y avisar ---- */
  /** «¿Seguro?» con dos botones. Devuelve una promesa de true/false. */
  function confirmar(o) {
    return new Promise(function (ok) {
      var ov = document.createElement('div');
      ov.className = 'td-overlay abierto'; ov.style.zIndex = 2500;
      ov.innerHTML = '<div class="td-modal" role="alertdialog" aria-modal="true" aria-labelledby="td-conf-t" style="max-width:420px;"><div class="td-modal-cab"><h2 id="td-conf-t">' + esc(o.titulo) + '</h2></div>'
        + '<div class="td-modal-cuerpo"><p style="margin:0;font-size:16px;line-height:1.45;">' + esc(o.texto || '') + '</p></div>'
        + '<div class="td-modal-pie"><button type="button" class="td-btn borde" data-r="0">Cancelar</button><button type="button" class="td-btn ' + (o.peligro ? 'peligro' : 'azul') + '" data-r="1">' + esc(o.ok || 'Aceptar') + '</button></div></div>';
      function cerrar(v) { document.removeEventListener('keydown', tecla); ov.remove(); ok(v); }
      function tecla(e) { if (e.key === 'Escape') cerrar(false); }
      ov.addEventListener('click', function (e) { var b = e.target.closest('button[data-r]'); if (b) cerrar(b.dataset.r === '1'); else if (e.target === ov) cerrar(false); });
      document.addEventListener('keydown', tecla);
      document.body.appendChild(ov);
      ov.querySelector('button[data-r="0"]').focus();
    });
  }

  var snackTimer = null;
  /** El aviso de abajo. Con `accion` lleva un botón («Deshacer») que vale mientras dure `ms` (6 s por omisión). */
  function snack(texto, o) {
    o = o || {};
    var viejo = document.getElementById('td-snack'); if (viejo) viejo.remove();
    clearTimeout(snackTimer);
    var el = document.createElement('div');
    el.id = 'td-snack'; el.className = 'td-snack' + (o.tipo === 'error' ? ' error' : '');
    el.setAttribute('role', o.tipo === 'error' ? 'alert' : 'status');
    el.innerHTML = '<span>' + esc(texto) + '</span>' + (o.accion ? '<button type="button">' + esc(o.accion) + '</button>' : '');
    if (o.accion) el.querySelector('button').addEventListener('click', function () { clearTimeout(snackTimer); el.remove(); if (o.onAccion) o.onAccion(); });
    document.body.appendChild(el);
    snackTimer = setTimeout(function () { if (el.parentNode) el.remove(); }, o.ms || (o.tipo === 'error' ? 6000 : 6000));
    return el;
  }
  /** Un error de red o del servidor, dicho claro. Sin señal: nada se guardó. */
  function textoDeError(err, leyendo) {
    if (err && err.esErrorDeRed) return leyendo
      ? 'Sin señal: las tareas necesitan conexión para verse. Vuelva a intentarlo cuando la tenga.'
      : 'Sin señal: no se guardó nada. Vuelva a intentarlo cuando tenga conexión.';
    return (err && err.message) || 'No se pudo completar. Intente de nuevo.';
  }

  /* ----------------------------------------------------------------------------------------- servidor ---- */
  var API = '/tareas-direccion';
  function llamar(metodo, ruta, cuerpo) { return global.api(API + (ruta || ''), cuerpo === undefined ? { method: metodo } : { method: metodo, body: cuerpo }); }
  var servidor = {
    listar: function (todasLasHechas) { return llamar('GET', todasLasHechas ? '?hechas=todas' : ''); },
    detalle: function (id) { return llamar('GET', '/' + id); },
    resumen: function () { return llamar('GET', '/resumen'); },
    responsables: function () { return llamar('GET', '/responsables'); },
    crear: function (d) { return llamar('POST', '', d); },
    editar: function (id, d) { return llamar('PUT', '/' + id, d); },
    estado: function (id, estado, deshacer) { return llamar('PATCH', '/' + id + '/estado', deshacer ? { estado: estado, deshacer: true } : { estado: estado }); },
    whatsapp: function (id) { return llamar('POST', '/' + id + '/whatsapp', {}); },
    eliminar: function (id) { return llamar('DELETE', '/' + id); },
  };

  /* ---------------------------------------------------------------------------------------- formulario ---- */
  /** Sin tildes ni mayúsculas, para el buscador del selector. */
  function clave(t) { return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  var MARCA_FUERA = 'Responsable fuera del organigrama';
  /** Lo que se lee en la línea del cargo de una tarjeta: el cargo, o la marca si el responsable ya no es de la lista. */
  function rotuloCargo(t) { return t.responsable.fuera_del_organigrama ? '⚠ ' + MARCA_FUERA : t.responsable.cargo; }
  var SIN_CELULAR = 'Sin celular registrado: no habrá SMS ni WhatsApp. Agréguelo en el organigrama o en Estructura.';

  /**
   * Pinta el formulario «Nueva tarea» / «Editar tarea» dentro de `raiz` y devuelve { leer(), error(texto), enfocar() }.
   *   o.tarea  — la tarea que se edita (o null)         o.resp — { candidato, organigrama, coordinadores } de /responsables
   *   o.yoId   — el id de quien tiene la sesión          o.hoy  — «AAAA-MM-DD» de Colombia
   * El responsable SOLO se elige de la lista (el candidato, el organigrama o los coordinadores): no hay forma de escribir uno. El cargo y el celular se leen de su origen
   * y quedan en solo lectura. Con buscador por nombre o cargo (campo de 16 px: en el celular no hace «zoom»).
   */
  function montarFormulario(raiz, o) {
    var t = o.tarea; var resp = o.resp || {};
    var grupos = [
      { titulo: '', lista: resp.candidato || [] },
      { titulo: 'Organigrama', lista: resp.organigrama || [] },
      { titulo: 'Coordinadores', lista: resp.coordinadores || [] },
    ];
    function etiqueta(p) {
      if (p.tipo === 'candidato') return p.ref_id === o.yoId ? 'Yo (candidato)' : 'Candidato · ' + p.nombre;
      if (p.tipo === 'coordinador') return 'Coordinador · ' + p.nombre + (p.territorio ? ' · ' + p.territorio : '');
      return (p.cargo ? p.cargo + ' · ' : '') + p.nombre;
    }
    var todas = [];
    grupos.forEach(function (g) { g.lista.forEach(function (p) { todas.push({ k: p.tipo + ':' + p.ref_id, p: p, texto: etiqueta(p), busca: clave(p.nombre + ' ' + (p.cargo || '') + ' ' + (p.territorio || '') + ' ' + (p.tipo === 'candidato' ? 'yo candidato' : '')) }); }); });

    raiz.innerHTML = '<form class="td-form" novalidate autocomplete="off">'
      + '<div class="td-error" id="tdf-error" role="alert"></div>'
      + '<div class="campo"><label for="tdf-titulo">¿Qué hay que hacer?</label><input type="text" id="tdf-titulo" maxlength="200" placeholder="Por ejemplo: Entregar la rendición de cuentas"></div>'
      + '<div class="campo"><label id="tdf-resp-et" for="tdf-resp">Responsable</label>'
      + '<div class="td-sel" id="tdf-sel"><button type="button" id="tdf-resp" class="td-sel-btn" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="tdf-resp-et tdf-resp-txt"><span id="tdf-resp-txt" class="td-sel-txt sin-elegir">Elija al responsable…</span><span class="td-sel-flecha" aria-hidden="true">▾</span></button>'
      + '<div class="td-sel-panel" id="tdf-panel" hidden><input type="search" id="tdf-buscar" placeholder="Buscar por nombre o cargo" aria-label="Buscar responsable por nombre o cargo" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="tdf-lista" aria-autocomplete="list">'
      + '<ul id="tdf-lista" class="td-sel-lista" role="listbox" aria-label="Responsables"></ul></div></div>'
      + '<p class="td-marca-fuera" id="tdf-fuera" role="status" hidden></p></div>'
      + '<div class="dos"><div class="campo"><label for="tdf-cargo">Cargo</label><input type="text" id="tdf-cargo" readonly placeholder="Sale de la lista"></div>'
      + '<div class="campo"><label for="tdf-cel">Celular</label><input type="text" id="tdf-cel" readonly placeholder="Sale de la lista"></div></div>'
      + '<p class="td-sin-celular" id="tdf-sincel" role="status" hidden></p>'
      + '<div class="dos"><div class="campo"><label for="tdf-fecha">Fecha límite</label><input type="date" id="tdf-fecha"></div>'
      + '<div class="campo"><label id="tdf-prio-et">Prioridad</label><div class="td-seg" role="group" aria-labelledby="tdf-prio-et"><button type="button" data-prio="normal" aria-pressed="true">Normal</button><button type="button" data-prio="urgente" class="urgente" aria-pressed="false">⚡ Urgente</button></div></div></div>'
      + '<div class="td-aviso-caja"><label class="td-interruptor"><input type="checkbox" id="tdf-aviso" checked><span class="pista"></span><span>🔔 Aviso automático 3 días antes</span></label>'
      + '<p class="td-frase" id="tdf-frase" aria-live="polite"></p></div>'
      + '</form>';

    var $ = function (id) { return raiz.querySelector('#' + id); };
    var estado = { sel: null, prioridad: 'normal', activa: -1, visibles: [] };

    function frase() {
      var s = estado.sel;
      if (!s) { $('tdf-frase').textContent = 'Elija al responsable para ver cómo se le avisa.'; return; }
      $('tdf-frase').textContent = R.frasePrevia({ activo: $('tdf-aviso').checked, fechaLimite: $('tdf-fecha').value, celular: s ? s.celular : '', esCandidato: !!(s && s.tipo === 'candidato'), hoy: o.hoy });
    }
    function fijarPrioridad(p) {
      estado.prioridad = p;
      raiz.querySelectorAll('[data-prio]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.prio === p ? 'true' : 'false'); });
    }
    /** Pone al responsable elegido (o ninguno) en el botón, el cargo y el celular, y dice si no tiene celular. */
    function mostrarSeleccion() {
      var s = estado.sel; var txt = $('tdf-resp-txt');
      txt.textContent = s ? etiqueta(s) : 'Elija al responsable…'; txt.classList.toggle('sin-elegir', !s);
      $('tdf-cargo').value = s ? s.cargo : '';
      $('tdf-cel').value = s ? (s.tipo === 'candidato' ? 'Le llega en la app' : (s.celular ? s.celular.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3') : '—')) : '';
      var sin = $('tdf-sincel'); var falta = !!s && s.tipo !== 'candidato' && !s.celular;
      sin.textContent = falta ? SIN_CELULAR : ''; sin.hidden = !falta;
      frase();
    }

    /* ---- el selector con buscador ---- */
    function pintarLista() {
      var q = clave($('tdf-buscar').value);
      var html = ''; estado.visibles = [];
      grupos.forEach(function (g) {
        var items = todas.filter(function (x) { return g.lista.indexOf(x.p) !== -1 && (!q || x.busca.indexOf(q) !== -1); });
        if (!items.length) return;
        if (g.titulo) html += '<li role="presentation" class="grupo">' + esc(g.titulo) + '</li>';
        items.forEach(function (x) {
          var i = estado.visibles.push(x) - 1;
          var activa = estado.sel && estado.sel.tipo === x.p.tipo && estado.sel.ref_id === x.p.ref_id;
          html += '<li role="option" id="tdf-op-' + i + '" data-i="' + i + '" aria-selected="' + (activa ? 'true' : 'false') + '"' + (activa ? ' class="elegida"' : '') + '>' + esc(x.texto) + '</li>';
        });
      });
      if (!estado.visibles.length) html = '<li role="presentation" class="sin-coincidencias">' + (todas.length ? 'Nadie coincide con «' + esc($('tdf-buscar').value.trim()) + '».' : 'No hay personas en el organigrama ni coordinadores todavía.') + '</li>';
      $('tdf-lista').innerHTML = html;
      marcarActiva(estado.visibles.length ? Math.min(Math.max(estado.activa, 0), estado.visibles.length - 1) : -1);
    }
    function marcarActiva(i) {
      estado.activa = i;
      $('tdf-lista').querySelectorAll('[role=option]').forEach(function (e) { e.classList.toggle('activa', +e.dataset.i === i); });
      var el = i >= 0 ? $('tdf-op-' + i) : null;
      if (el) { $('tdf-buscar').setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); } else $('tdf-buscar').removeAttribute('aria-activedescendant');
    }
    function abrir() {
      $('tdf-panel').hidden = false; $('tdf-resp').setAttribute('aria-expanded', 'true');
      $('tdf-buscar').value = ''; estado.activa = 0; pintarLista();
      var ya = estado.sel ? estado.visibles.findIndex(function (x) { return x.p.tipo === estado.sel.tipo && x.p.ref_id === estado.sel.ref_id; }) : -1;
      if (ya >= 0) marcarActiva(ya);
      $('tdf-buscar').focus();
    }
    function cerrar(volver) {
      $('tdf-panel').hidden = true; $('tdf-resp').setAttribute('aria-expanded', 'false');
      if (volver) $('tdf-resp').focus();
    }
    function elegir(i) {
      var x = estado.visibles[i]; if (!x) return;
      estado.sel = x.p; mostrarSeleccion(); $('tdf-fuera').hidden = true; cerrar(true); api.error('');
    }
    $('tdf-resp').addEventListener('click', function () { if ($('tdf-panel').hidden) abrir(); else cerrar(true); });
    $('tdf-resp').addEventListener('keydown', function (e) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if ($('tdf-panel').hidden) abrir(); } });
    $('tdf-buscar').addEventListener('input', function () { estado.activa = 0; pintarLista(); });
    $('tdf-buscar').addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); marcarActiva(Math.min(estado.activa + 1, estado.visibles.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); marcarActiva(Math.max(estado.activa - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); if (estado.activa >= 0) elegir(estado.activa); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(true); }
      else if (e.key === 'Tab') cerrar(false);
    });
    $('tdf-lista').addEventListener('mousedown', function (e) { e.preventDefault(); });   // que el clic no le quite el foco al buscador antes de elegir
    $('tdf-lista').addEventListener('click', function (e) { var li = e.target.closest('[role=option]'); if (li) elegir(+li.dataset.i); });
    raiz.addEventListener('click', function (e) { if (!$('tdf-panel').hidden && !e.target.closest('#tdf-sel')) cerrar(false); });
    ['tdf-fecha', 'tdf-aviso'].forEach(function (id) { $(id).addEventListener('input', frase); $(id).addEventListener('change', frase); });
    raiz.querySelectorAll('[data-prio]').forEach(function (b) { b.addEventListener('click', function () { fijarPrioridad(b.dataset.prio); }); });

    if (t) {
      $('tdf-titulo').value = t.titulo; $('tdf-fecha').value = t.fecha_limite; $('tdf-aviso').checked = !!t.aviso_activo; fijarPrioridad(t.prioridad);
      var r = t.responsable;
      if (r.fuera_del_organigrama) {
        // Una tarea de antes (responsable escrito a mano) o cuya persona ya no está: se dice, y para guardar hay que elegir de la lista.
        var f = $('tdf-fuera');
        f.textContent = '⚠ ' + MARCA_FUERA + ': ' + r.nombre + (r.cargo ? ' (' + r.cargo + ')' : '') + '. Elija a alguien de la lista para poder guardar.'; f.hidden = false;
      } else {
        var hallado = todas.filter(function (x) { return x.p.tipo === r.tipo && x.p.ref_id === r.ref_id; })[0];
        // Si en la lista ya sale en otro grupo (p. ej. un coordinador que también está en el organigrama), se queda con lo que dice la tarea.
        estado.sel = hallado ? hallado.p : { tipo: r.tipo, ref_id: r.ref_id, nombre: r.nombre, cargo: r.cargo, celular: r.celular || '' };
      }
    }
    mostrarSeleccion();

    var api = {
      enfocar: function () { $('tdf-titulo').focus(); },
      error: function (texto) { var e = $('tdf-error'); e.textContent = texto || ''; e.classList.toggle('visible', !!texto); if (texto) e.scrollIntoView({ block: 'nearest' }); },
      /** Los datos del formulario, o null (con el error ya pintado) si falta algo. */
      leer: function () {
        var s = estado.sel;
        var d = { titulo: $('tdf-titulo').value.trim(), responsable_tipo: s ? s.tipo : null, responsable_ref_id: s ? s.ref_id : null, fecha_limite: $('tdf-fecha').value, prioridad: estado.prioridad, aviso_activo: $('tdf-aviso').checked };
        var falta = !d.titulo ? ['Escriba qué hay que hacer.', 'tdf-titulo']
          : !s ? ['Elija al responsable de la lista: el candidato, una persona del organigrama o un coordinador.', 'tdf-resp']
          : !d.fecha_limite ? ['Elija la fecha límite.', 'tdf-fecha'] : null;
        if (falta) { this.error(falta[0]); $(falta[1]).focus(); return null; }
        this.error('');
        return d;
      },
    };
    return api;
  }

  global.TareasDirUI = {
    esc: esc, iniciales: iniciales, hora12: hora12, fechaHora: fechaHora, SVG_WA: SVG_WA, hojaHtml: hojaHtml, etiquetaEstadoHtml: etiquetaEstadoHtml, conWhatsapp: conWhatsapp,
    textoAvisoDetalle: textoAvisoDetalle, historialHtml: historialHtml, detalleHtml: detalleHtml, confirmar: confirmar, snack: snack, textoDeError: textoDeError,
    servidor: servidor, montarFormulario: montarFormulario, rotuloCargo: rotuloCargo, MARCA_FUERA: MARCA_FUERA, SIN_CELULAR: SIN_CELULAR,
  };
})(window);
