/* «Tareas programadas» (orden 122): el aviso de las tareas de dirección en el Inicio del candidato y en el Panel del celular del superadministrador.
   Los datos salen de /api/tareas-direccion/resumen (el servidor responde 403 a quien no puede). Pide tareas-direccion-reglas.js (TareasDir) y api-core.js (api).
   Sin señal se muestra lo último cargado, con «Actualizado hace…»; la copia va por cuenta con el prefijo `cand_copia:` y se borra al cerrar sesión.
   La tarjeta NO se oculta cuando no hay tareas: dice «Sin tareas pendientes» y ofrece «＋ Nueva tarea». Si el servidor niega el acceso (403) o no hay señal ni copia, no sale nada. */
(function (global) {
  'use strict';
  var R = global.TareasDir;
  var RUTA = '/tareas-direccion/resumen';
  var DESTINO = '/app/candidato-tareas.html';
  var MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
  function clave(usuarioId) { return 'cand_copia:' + usuarioId + ':' + RUTA; }
  function hace(ms) {
    var min = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (min < 1) return 'hace un momento';
    if (min < 60) return 'hace ' + min + ' min';
    var h = Math.round(min / 60);
    if (h < 24) return 'hace ' + plural(h, 'hora', 'horas');
    return 'hace ' + plural(Math.round(h / 24), 'día', 'días');
  }

  /** { texto, color } del vencimiento de una fecha límite frente a hoy (Colombia). Color: rojo (vencida) · amarillo (hoy o mañana) · azul (a tiempo). */
  function vencimiento(fecha, hoy) {
    var d = R.diasEntre(hoy, fecha);
    // El espacio entre el número y «día(s)» no se parte: si el texto baja de renglón, baja «Vence en» y se queda junto «5 días».
    var nb = function (t) { return t.replace(/ (días?)$/, '\u00a0$1'); };
    if (d < 0) return { texto: 'Vencida hace ' + nb(plural(-d, 'día', 'días')), color: 'rojo' };
    if (d === 0) return { texto: 'Vence hoy', color: 'amarillo' };
    if (d === 1) return { texto: 'Vence mañana', color: 'amarillo' };
    return { texto: 'Vence en ' + nb(d + ' días'), color: 'azul' };
  }

  function enlace(extra, volver) {
    var q = extra ? [extra] : [];
    if (volver) q.push('volver=' + encodeURIComponent(volver));
    return DESTINO + (q.length ? '?' + q.join('&') : '');
  }

  /** El HTML interior de la tarjeta. `o.volver`: a dónde regresa la pantalla de tareas (el Panel); `o.copiaDesde`: ms de la copia que se muestra sin señal. */
  function html(datos, o) {
    o = o || {};
    var hoy = R.enColombia(new Date()).hoy;
    var lista = (datos.tareas || []).slice(0, 3);
    var venc = Number(datos.vencidas) || 0;
    var total = Number(datos.sin_realizar);
    if (!isFinite(total)) total = lista.length;
    var cab = '<div class="tav-cab"><h2 class="tav-tit"><span aria-hidden="true">📋</span> Tareas programadas'
      + (venc > 0 ? '<span class="tav-globo" aria-label="' + esc(plural(venc, 'vencida', 'vencidas')) + '">' + (venc > 99 ? '99+' : venc) + '</span>' : '')
      + '</h2>' + (lista.length ? '<a class="tav-todas" href="' + esc(enlace('', o.volver)) + '">Ver todas (' + total + ')</a>' : '') + '</div>';
    var cuerpo;
    if (!lista.length) {
      cuerpo = '<div class="tav-vacio"><span>Sin tareas pendientes</span><a href="' + esc(enlace('nueva=1', o.volver)) + '">＋ Nueva tarea</a></div>';
    } else {
      cuerpo = '<div class="tav-lista">' + lista.map(function (t) {
        var f = String(t.fecha_limite || '').slice(0, 10);
        var v = vencimiento(f, hoy);
        var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(f);
        var resp = [t.responsable && t.responsable.cargo, t.responsable && t.responsable.nombre].filter(Boolean).join(' · ');
        return '<a class="tav-fila" href="' + esc(enlace('tarea=' + encodeURIComponent(t.id), o.volver)) + '">'
          + '<span class="tav-hoja ' + v.color + '" aria-hidden="true"><b>' + (m ? Number(m[2]) : '—') + '</b><small>' + (m ? MESES[Number(m[1]) - 1] : '') + '</small></span>'
          + '<span class="tav-txt"><span class="tav-t">' + esc(t.titulo) + '</span><span class="tav-r">' + esc(resp) + '</span></span>'
          + '<span class="tav-venc ' + v.color + '">' + esc(v.texto) + '</span></a>';
      }).join('') + '</div>';
    }
    var pie = o.copiaDesde ? '<p class="tav-copia">Sin señal · Actualizado ' + esc(hace(o.copiaDesde)) + '</p>' : '';
    return cab + cuerpo + pie;
  }

  /** { datos, copia, desde }. Un 403 u otro error del servidor NO se tapa con la copia (el acceso cambió); solo la falta de señal la usa. */
  async function cargar(usuarioId) {
    try {
      var datos = await api(RUTA);
      if (datos === undefined) throw new Error('Sin respuesta.');   // api() ya mandó a login
      try { localStorage.setItem(clave(usuarioId), JSON.stringify({ t: Date.now(), datos: datos })); } catch (e) { /* sin almacenamiento */ }
      return { datos: datos, copia: false, desde: Date.now() };
    } catch (err) {
      if (err && err.esErrorDeRed) {
        try {
          var c = JSON.parse(localStorage.getItem(clave(usuarioId)) || 'null');
          if (c && c.datos && Array.isArray(c.datos.tareas)) return { datos: c.datos, copia: true, desde: c.t };
        } catch (e) { /* copia ilegible: nada que mostrar */ }
      }
      throw err;
    }
  }

  /** Pinta la tarjeta `el` (un elemento con `hidden`). Devuelve true si quedó a la vista. `o.alCambiar(visible)` avisa a la pantalla para ajustar su diseño. */
  async function montar(el, usuarioId, o) {
    o = o || {};
    var visible = false;
    try {
      var r = await cargar(usuarioId);
      if (!r.datos || !Array.isArray(r.datos.tareas)) throw new Error('Sin datos de tareas.');   // un servidor anterior, o una copia vieja: no se inventa nada
      el.innerHTML = html(r.datos, { volver: o.volver, copiaDesde: r.copia ? r.desde : 0 });
      visible = true;
    } catch (e) { el.innerHTML = ''; }
    el.hidden = !visible;
    if (typeof o.alCambiar === 'function') o.alCambiar(visible);
    return visible;
  }

  global.TareasAviso = { html: html, cargar: cargar, montar: montar, vencimiento: vencimiento };
})(window);
