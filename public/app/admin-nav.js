/* Barra inferior y utilidades de las pantallas de ADMINISTRADOR de la app del
   celular (admin-panel, admin-votantes, admin-mapa, admin-contenido).

   Se carga DESPUÉS de api-core.js y app-comun.js.

   SOLO PARA EL ROL «admin». El superadministrador conserva el rol admin (ver
   config/superadmin.js), así que pasa sin tratamiento aparte. Esto es comodidad
   de la pantalla, NO seguridad: cada ruta de la API sigue decidiendo por su
   cuenta (requireRole / permiso del módulo). */
(function (global) {
  'use strict';

  var ITEMS = [
    { id: 'panel',     href: '/app/admin-panel.html',     icono: '📊', texto: 'Panel' },
    { id: 'votantes',  href: '/app/admin-votantes.html',  icono: '👥', texto: 'Votantes' },
    { id: 'mapa',      href: '/app/admin-mapa.html',      icono: '🗺️', texto: 'Mapa' },
    { id: 'compartir', href: '/app/admin-contenido.html', icono: '📣', texto: 'Compartir' },
    { id: 'ley',       href: '/app/legislacion.html',     icono: '⚖️', texto: 'Ley' },
    /* PARCHE 330: el administrador en el celular no tenía cómo pedir Ayuda ni cerrar sesión (esa barra no las traía y Panel general no tiene botones
       propios). `salir` no es un enlace: cierra la sesión AL INSTANTE aunque no haya señal (public/js/cerrar-sesion.js). */
    { id: 'ayuda',     href: '/ayuda.html',               icono: '❔', texto: 'Ayuda' },
    { id: 'salir',     href: '#',                         icono: '🚪', texto: 'Salir', accion: 'salir' }
  ];

  /** Preferencia «Ver versión de escritorio». Con try/catch: el almacenamiento puede no existir. */
  var CLAVE_ESCRITORIO = 'admin_preferir_escritorio';
  global.adminPrefiereEscritorio = function () {
    try { return localStorage.getItem(CLAVE_ESCRITORIO) === '1'; } catch (e) { return false; }
  };
  global.adminFijarPreferenciaEscritorio = function (valor) {
    try {
      if (valor) localStorage.setItem(CLAVE_ESCRITORIO, '1'); else localStorage.removeItem(CLAVE_ESCRITORIO);
    } catch (e) { /* sin almacenamiento: la preferencia vale solo esta vez */ }
  };

  /** Pinta la barra inferior y deja `activo` marcado. Idempotente. */
  global.montarNavAdmin = function (activo) {
    if (document.getElementById('nav-admin')) return;
    var nav = document.createElement('nav');
    nav.id = 'nav-admin';
    nav.className = 'nav-admin';
    nav.setAttribute('aria-label', 'Secciones de administrador');
    nav.innerHTML = ITEMS.map(function (it) {
      var on = it.id === activo;
      return '<a href="' + it.href + '"' + (on ? ' class="activo" aria-current="page"' : '') + (it.accion ? ' data-accion="' + it.accion + '" role="button"' : '') + '>'
        + '<span class="ico" aria-hidden="true">' + it.icono + '</span>'
        + '<span class="txt">' + it.texto + '</span></a>';
    }).join('');
    nav.addEventListener('click', async function (ev) {
      var a = ev.target.closest ? ev.target.closest('a[data-accion="salir"]') : null;
      if (!a) return;
      ev.preventDefault();
      if (typeof cargarCerrarSesionApp === 'function') await cargarCerrarSesionApp();
      if (typeof cerrarSesionLocal === 'function') await cerrarSesionLocal();
      else window.location.href = '/login.html';
    });
    document.body.appendChild(nav);
    document.body.classList.add('con-nav-admin');
  };

  /**
   * Exige sesión Y rol admin. Devuelve el usuario, o null si ya redirigió
   * (a login sin sesión, o a /app/inicio.html si el rol no es admin).
   */
  global.exigirAdminApp = async function (activo) {
    var usuario = await requerirSesionApp();
    if (!usuario) return null;
    if (usuario.rol !== 'admin') { window.location.replace('/app/inicio.html'); return null; }
    if (activo) global.montarNavAdmin(activo);
    return usuario;
  };

  /* Utilidades de formato compartidas por las cuatro pantallas. */
  global.fmtNumero = function (n) { return Number(n || 0).toLocaleString('es-CO'); };
  /* Escapa también las comillas: estas pantallas meten texto de la base dentro de
     atributos (value="…", data-…="…"), y escaparAppHtml solo cubre & < >. */
  global.escHtml = function (t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /** Un aviso pasajero abajo (sobre la barra), para confirmar o avisar sin bloquear. */
  global.avisoPasajero = function (texto, esError) {
    var viejo = document.getElementById('aviso-pasajero');
    if (viejo) viejo.remove();
    var el = document.createElement('div');
    el.id = 'aviso-pasajero';
    el.className = 'aviso-pasajero' + (esError ? ' error' : '');
    el.setAttribute('role', 'status');
    el.textContent = texto;
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.remove(); }, 4500);
  };
})(window);
