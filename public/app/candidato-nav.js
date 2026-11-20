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

  /* ---- MODO (orden 81): el administrador que también es el candidato ----
     Un administrador con la marca «Es el candidato» (`usuario.es_candidato`) usa las dos apps con UN solo usuario: la del candidato y la de administración del celular.
     Cuál de las dos está usando se RECUERDA EN ESE EQUIPO (localStorage `modo_admin_candidato` = 'admin' | 'candidato'); sin dato, entra como candidato. Se anota solo, al
     entrar a cualquiera de las dos apps (exigirCandidatoApp / exigirAdminApp / inicio.html), y con los botones «Modo administrador» y «Modo candidato».
     El rol «candidato» puro siempre está en modo candidato. Es comodidad de la pantalla: lo que cada uno puede hacer lo decide el servidor por su rol. */
  var CLAVE_MODO = 'modo_admin_candidato';
  global.cEsAdminCandidato = function (usuario) { return !!usuario && usuario.rol === 'admin' && !!Number(usuario.es_candidato); };
  global.cModoGuardado = function () {
    try { return localStorage.getItem(CLAVE_MODO) === 'admin' ? 'admin' : 'candidato'; } catch (e) { return 'candidato'; }
  };
  global.cFijarModo = function (modo) {
    try { localStorage.setItem(CLAVE_MODO, modo === 'admin' ? 'admin' : 'candidato'); } catch (e) { /* sin almacenamiento: vale solo esta vez */ }
  };
  /** ¿Esta persona está usando AHORA la app del candidato? (rol candidato; o administrador marcado en modo candidato.) */
  global.cEsModoCandidato = function (usuario) {
    if (!usuario) return false;
    if (usuario.rol === 'candidato') return true;
    return global.cEsAdminCandidato(usuario) && global.cModoGuardado() === 'candidato';
  };
  /** «Modo administrador»: recuerda la elección y va a la app de administración del celular. */
  global.cIrModoAdmin = function () { global.cFijarModo('admin'); window.location.href = '/app/admin-panel.html'; };

  /** Exige sesión Y ser el candidato: rol candidato, o administrador con la marca «Es el candidato». Un administrador SIN la marca va a su app de administración. Devuelve el usuario, o null si ya redirigió. */
  global.exigirCandidatoApp = async function (activo) {
    var usuario = await requerirSesionApp();
    if (!usuario) return null;
    if (usuario.rol !== 'candidato' && !global.cEsAdminCandidato(usuario)) {
      window.location.replace(usuario.rol === 'admin' ? '/app/admin-panel.html' : '/app/inicio.html');
      return null;
    }
    if (global.cEsAdminCandidato(usuario)) global.cFijarModo('candidato');   // abrió la app del candidato: ese es el modo de este equipo
    if (activo) global.montarNavCandidato(activo);
    global.cMontarSalir();   // «Salir» en el encabezado de TODA pantalla del candidato (orden 79): un solo componente, aquí
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
    else await cargarScript('/js/cerrar-sesion.js');   // las pantallas de escritorio que abre en modo app (estructura, ayuda) no traen app-comun.js
    if (typeof cerrarSesionLocal === 'function') await cerrarSesionLocal();
    else window.location.href = '/login.html';
  };

  function cargarScript(src) {
    return new Promise(function (ok) {
      var s = document.createElement('script');
      s.src = src; s.onload = function () { ok(true); }; s.onerror = function () { ok(false); };
      document.head.appendChild(s);
    });
  }

  /* ---- «Salir» (orden 79) ----
     UN SOLO COMPONENTE para todas las pantallas del candidato: botón con puerta y flecha + la palabra, a la derecha del encabezado, de 44 px de alto como mínimo,
     que pide «¿Cerrar sesión?» (Sí / Cancelar) y luego cierra igual que siempre (cCerrarSesion: lo local primero, sin esperar a la red — orden 43).
     Se coloca solo, según el encabezado que encuentre: `.hdr .top` (Inicio, ficha), `.barra` (Equipo, Agenda, Más, Seguimiento), `.buscar` (Mapa), `.app-barra`
     (las pantallas de /app/ que abre en modo app). Si no hay ninguno (estructura territorial y ayuda son pantallas de escritorio), un botón flotante arriba a la derecha.
     Es idempotente: se puede llamar cuantas veces haga falta (pintarBarraApp lo llama de nuevo cuando rehace su barra). */
  var SVG_SALIR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>';
  function botonSalir(extra) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-salir' + (extra ? ' ' + extra : '');
    b.setAttribute('aria-label', 'Cerrar sesión');
    b.innerHTML = SVG_SALIR + '<span>Salir</span>';
    b.addEventListener('click', global.cPedirSalir);
    return b;
  }

  /** «¿Cerrar sesión?» Sí / Cancelar. Devuelve la caja (para las pruebas). */
  global.cPedirSalir = function () {
    if (document.getElementById('salir-confirma')) return;
    var fondo = document.createElement('div');
    fondo.id = 'salir-confirma';
    fondo.className = 'salir-confirma';
    fondo.innerHTML = '<div class="caja" role="alertdialog" aria-modal="true" aria-labelledby="salir-tit" aria-describedby="salir-txt">'
      + '<h2 id="salir-tit">¿Cerrar sesión?</h2>'
      + '<p id="salir-txt">Para volver a entrar necesitará su correo y su clave.</p>'
      + '<div class="acciones"><button type="button" class="no" id="salir-no">Cancelar</button><button type="button" class="si" id="salir-si">Sí, salir</button></div></div>';
    document.body.appendChild(fondo);
    var cerrar = function () { fondo.remove(); };
    fondo.addEventListener('click', function (e) { if (e.target === fondo) cerrar(); });
    fondo.querySelector('#salir-no').addEventListener('click', cerrar);
    fondo.querySelector('#salir-si').addEventListener('click', function () { cerrar(); global.cCerrarSesion(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { cerrar(); document.removeEventListener('keydown', esc); } });
    fondo.querySelector('#salir-no').focus();
  };

  global.cMontarSalir = function () {
    var puesto = 0;
    document.querySelectorAll('.hdr .top').forEach(function (t) {
      if (t.querySelector('.btn-salir')) return;
      t.appendChild(botonSalir()); puesto++;
    });
    document.querySelectorAll('.barra').forEach(function (b) {
      if (b.querySelector('.btn-salir')) return;
      var fila = document.createElement('div');
      fila.className = 'fila-salir';
      var primero = b.firstElementChild;
      if (primero && primero.tagName === 'SMALL') fila.appendChild(primero); else fila.appendChild(document.createElement('span'));
      fila.appendChild(botonSalir());
      b.insertBefore(fila, b.firstChild); puesto++;
    });
    document.querySelectorAll('.mapa-pant .buscar').forEach(function (b) {
      if (b.querySelector('.btn-salir')) return;
      var x = botonSalir('sobre-claro'); b.appendChild(x); puesto++;
    });
    document.querySelectorAll('.app-barra').forEach(function (b) {
      if (b.querySelector('.btn-salir')) return;
      var x = botonSalir(); x.style.marginLeft = 'auto'; b.appendChild(x); puesto++;
    });
    // El formulario «Agregar a la estructura» (modo app) es una pantalla completa que tapa todo: lleva su propio «Salir», junto a la «×».
    document.querySelectorAll('#overlay-form .modal-header').forEach(function (h) {
      if (h.querySelector('.btn-salir')) return;
      var x = botonSalir('en-modal'), cerrar = h.querySelector('.modal-cerrar');
      if (cerrar) h.insertBefore(x, cerrar); else h.appendChild(x);
    });
    if (!puesto && !document.querySelector('.btn-salir.flotante')) { document.body.appendChild(botonSalir('flotante')); }
  };

  /* ---- Las pantallas de OTRAS secciones que el candidato abre en modo app (orden 79) ----
     Las comparten los demás roles: NO cambia nada para ellos. Cuando las abre el candidato, app-comun.js (requerirSesionApp) y common.js (inicializarLayout)
     llaman a esto: pone `cand-app` en <body> (candidato-letra.css agranda la letra SOLO con esa clase), carga este mismo archivo y monta «Salir». */
  global.cPrepararModoApp = async function (usuario) {
    if (!global.cEsModoCandidato(usuario)) return;
    if (document.body.classList.contains('cand')) return;   // las pantallas candidato*.html traen su propia hoja y su propio «Salir»
    document.body.classList.add('cand-app');
    document.documentElement.classList.add('cand-app');
    if (!document.getElementById('cand-letra-css')) {
      var l = document.createElement('link');
      l.id = 'cand-letra-css'; l.rel = 'stylesheet'; l.href = '/app/candidato-letra.css';
      document.head.appendChild(l);
    }
    global.cMontarSalir();
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
