/* Barra inferior y utilidades de las pantallas del CANDIDATO PRINCIPAL de la app del celular (orden 70):
   candidato.html (Inicio), candidato-equipo.html, candidato-mapa.html, candidato-agenda.html y candidato-mas.html.

   Se carga DESPUÉS de api-core.js, app-comun.js y es-celular.js (las mismas que admin-nav.js, de donde sale la forma de la barra).

   ES COMODIDAD DE LA PANTALLA, NO SEGURIDAD. Que el candidato no pueda escribir lo impone el SERVIDOR (middleware/soloLecturaCandidato.js): aquí solo se
   evita ofrecerle lo que no hay. Las pantallas de esta app NO llaman a ninguna ruta que escriba (salvo cerrar sesión, que no es de aquí sino de /api/auth). */
(function (global) {
  'use strict';

  var ITEMS = [
    { id: 'inicio', href: '/app/candidato.html',        icono: '⌂',  texto: 'Inicio' },
    { id: 'equipo', href: '/app/candidato-equipo.html', icono: '👥', texto: 'Equipo' },
    { id: 'mapa',   href: '/app/candidato-mapa.html',   icono: '📍', texto: 'Mapa' },
    { id: 'agenda', href: '/app/candidato-agenda.html', icono: '📅', texto: 'Agenda' },
    { id: 'mas',    href: '/app/candidato-mas.html',    icono: '☰',  texto: 'Más' }
  ];

  /** Pinta la barra inferior con `activo` marcado. Idempotente. */
  global.montarNavCandidato = function (activo) {
    if (document.getElementById('nav-candidato')) return;
    var nav = document.createElement('nav');
    nav.id = 'nav-candidato';
    nav.className = 'nav';
    nav.setAttribute('aria-label', 'Secciones del candidato');
    nav.innerHTML = ITEMS.map(function (it) {
      var on = it.id === activo;
      return '<a href="' + it.href + '"' + (on ? ' class="on" aria-current="page"' : '') + '>'
        + '<span class="ico" aria-hidden="true">' + it.icono + '</span>' + it.texto + '</a>';
    }).join('');
    document.body.appendChild(nav);
  };

  /** Exige sesión Y rol candidato (el administrador pasa, para poder probar). Devuelve el usuario, o null si ya redirigió. */
  global.exigirCandidatoApp = async function (activo) {
    var usuario = await requerirSesionApp();
    if (!usuario) return null;
    if (usuario.rol !== 'candidato' && usuario.rol !== 'admin') { window.location.replace('/app/inicio.html'); return null; }
    if (activo) global.montarNavCandidato(activo);
    return usuario;
  };

  /* ---- Formato ---- */
  global.cFmt = function (n) { var x = Number(n); return isFinite(x) ? x.toLocaleString('es-CO') : '0'; };
  global.cEsc = function (t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  global.cIniciales = function (nombre) {
    var p = String(nombre || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return p.map(function (x) { return x[0].toUpperCase(); }).join('') || '—';
  };
  /** «Buenos días / Buenas tardes / Buenas noches» según la hora del teléfono. */
  global.cSaludo = function (fecha) {
    var h = (fecha || new Date()).getHours();
    return h < 12 ? 'Buenos días' : (h < 19 ? 'Buenas tardes' : 'Buenas noches');
  };
  global.cPorcentaje = function (p) { return (p === null || p === undefined || !isFinite(Number(p))) ? null : Math.max(0, Math.round(Number(p))); };

  /** Teléfonos: `tel:` y `wa.me/57…` con el mensaje vacío (no se envía nada desde aquí). `celular` son los 10 dígitos ya validados por el servidor (o null).
      Sin celular válido, los dos quedan deshabilitados; con `noContactar` (la persona pidió no recibir mensajes) se puede llamar pero no abrir WhatsApp, como en «Mi equipo». */
  global.cAccionesContacto = function (celular, nombre, noContactar, grande) {
    var n = global.cEsc(nombre || 'esta persona');
    var clase = grande ? 'ficha-acc' : 'acc';
    var apagado = function (cls, ico, rotulo, razon) {
      return '<span class="off ' + cls + '" title="' + razon + '" aria-label="' + rotulo + ' ' + n + ' (no disponible)" role="img">' + ico + (grande ? ' ' + rotulo : '') + '</span>';
    };
    if (!celular || !/^3\d{9}$/.test(String(celular))) {
      return '<span class="' + clase + '">' + apagado('ll', '📞', 'Llamar', 'Sin celular válido') + apagado('wa', '✆', 'WhatsApp', 'Sin celular válido') + '</span>';
    }
    var llamar = '<a class="ll" href="tel:+57' + celular + '" aria-label="Llamar a ' + n + '">📞' + (grande ? ' Llamar' : '') + '</a>';
    var wa = noContactar
      ? apagado('wa', '✆', 'WhatsApp', 'Pidió no recibir mensajes')
      : '<a class="wa" href="https://wa.me/57' + celular + '" target="_blank" rel="noopener" aria-label="WhatsApp a ' + n + '">✆' + (grande ? ' WhatsApp' : '') + '</a>';
    return '<span class="' + clase + '">' + llamar + wa + '</span>';
  };

  /* ---- Sin señal: se muestra lo último cargado con «Actualizado hace N min» ----
     La copia va en localStorage POR CUENTA Y POR PANTALLA. Es solo lo que ya vio esa persona; se borra al cerrar sesión (cSoltarCopias). */
  var PREFIJO = 'cand_copia:';
  function claveCopia(usuarioId, ruta) { return PREFIJO + usuarioId + ':' + ruta; }
  function leerCopia(usuarioId, ruta) {
    try { var t = localStorage.getItem(claveCopia(usuarioId, ruta)); return t ? JSON.parse(t) : null; } catch (e) { return null; }
  }
  function guardarCopia(usuarioId, ruta, datos) {
    try { localStorage.setItem(claveCopia(usuarioId, ruta), JSON.stringify({ t: Date.now(), datos: datos })); } catch (e) { /* sin espacio o sin almacenamiento: no pasa nada */ }
  }
  global.cSoltarCopias = function () {
    try {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf(PREFIJO) === 0) localStorage.removeItem(k); });
    } catch (e) { /* nada que borrar */ }
  };
  global.cHaceTexto = function (ms) {
    var min = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (min < 1) return 'hace un momento';
    if (min < 60) return 'hace ' + min + ' min';
    var h = Math.round(min / 60);
    if (h < 24) return 'hace ' + h + (h === 1 ? ' hora' : ' horas');
    var d = Math.round(h / 24);
    return 'hace ' + d + (d === 1 ? ' día' : ' días');
  };

  /**
   * GET a /api/candidato/<ruta> con respaldo sin señal. Devuelve { datos, copia: false } si llegó del servidor, o
   * { datos, copia: true, desde: <ms> } si se muestra la última copia guardada. Lanza si no hay señal y tampoco hay copia, o si el servidor
   * respondió un error (un 403, por ejemplo, NO se tapa con la copia: el acceso cambió y hay que decirlo).
   */
  global.cCargar = async function (usuarioId, ruta) {
    try {
      var datos = await api('/candidato' + ruta);
      if (datos === undefined) throw new Error('Sin respuesta.');   // api() ya mandó a login
      guardarCopia(usuarioId, ruta, datos);
      return { datos: datos, copia: false, desde: Date.now() };
    } catch (err) {
      if (err && err.esErrorDeRed) {
        var c = leerCopia(usuarioId, ruta);
        if (c && c.datos) return { datos: c.datos, copia: true, desde: c.t };
      }
      throw err;
    }
  };

  /** La franja «Estás sin señal…» / «Actualizado hace N min» bajo el encabezado. */
  global.cPintarEstado = function (resultado, donde) {
    var el = typeof donde === 'string' ? document.getElementById(donde) : donde;
    if (!el) return;
    if (resultado.copia) {
      el.className = 'aviso-copia';
      el.textContent = 'Sin señal. Se muestra lo último cargado · Actualizado ' + global.cHaceTexto(resultado.desde);
    } else {
      el.className = 'aviso-act';
      el.textContent = 'Actualizado ' + global.cHaceTexto(resultado.desde);
    }
  };

  /** Cierra la sesión AL INSTANTE aunque no haya señal (mismo camino que la barra del administrador, public/js/cerrar-sesion.js). */
  global.cCerrarSesion = async function () {
    global.cSoltarCopias();
    if (typeof cargarCerrarSesionApp === 'function') await cargarCerrarSesionApp();
    if (typeof cerrarSesionLocal === 'function') await cerrarSesionLocal();
    else window.location.href = '/login.html';
  };

  /** Un estado vacío bonito: nunca una tarjeta rota. */
  global.cVacio = function (icono, titulo, texto) {
    return '<div class="vacio"><span class="ic" aria-hidden="true">' + icono + '</span><b>' + global.cEsc(titulo) + '</b>'
      + (texto ? '<span>' + global.cEsc(texto) + '</span>' : '') + '</div>';
  };

  /** Texto de la fecha en bloque: { dia: '21', mes: 'NOV' } desde 'YYYY-MM-DD'. */
  var MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  global.cFechaBloque = function (iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return { dia: '—', mes: '' };
    return { dia: String(Number(m[3])), mes: MESES[Number(m[2]) - 1] || '' };
  };
})(window);
