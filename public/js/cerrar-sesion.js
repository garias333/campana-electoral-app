/* CERRAR SESIÓN SIN SEÑAL (parche 329, orden 43).

   EL PROBLEMA. En un celular compartido, cerrar sesión SIN señal no cerraba nada en el servidor: la cookie de sesión es httpOnly (el navegador no
   puede borrarla) y la llamada a /auth/logout fallaba y se tragaba el error. La cookie seguía viva 8 horas —o 7 días con «Recordar sesión»— y la
   siguiente persona que abría la app entraba COMO LA ANTERIOR (api('/auth/me') resolvía por la cookie), con sus datos y sus pendientes.

   LO QUE HACE ESTE ARCHIVO, en un solo sitio para los cinco cierres de sesión (inicio, dia-d, mis-registros y registro-votante de la app, y el
   encabezado de escritorio de common.js):

     1. `cerrarSesionLocal()` cierra AL INSTANTE, sin depender de la red: desactiva la cuenta del dispositivo, borra la identidad en caché
        (`app_usuario_verificado`) y las copias de lectura del usuario, y deja anotado `logout_pendiente` con el token de cierre de esa sesión.
        Después AVISA al servidor como «mejor esfuerzo» (4 s como máximo) y SIEMPRE redirige a /login.html.
     2. Mientras exista `logout_pendiente` y no haya una cuenta de dispositivo activa, las pantallas NO entran por la cookie vieja
        (`entradaBloqueada()`): muestran el login. Una cuenta activa del dispositivo (token propio) sí es otra persona y sí entra.
     3. `resolver()` presenta el token a POST /api/auth/cerrar-pendiente y, al recibir respuesta, borra `logout_pendiente`. Se llama al abrir cualquier
        pantalla, al volver la señal (`online`) y justo antes de iniciar sesión en login.html.

   LO PENDIENTE DE ENVIAR NO SE BORRA: queda guardado con su dueño (public/js/offline-utils.js) y solo se envía cuando ESA persona vuelve a entrar.

   Lo guardado en localStorage:
     · `sesion_token_cierre`  el token de la sesión en curso (lo entrega el servidor al iniciar sesión; solo su hash vive en el servidor).
     · `logout_pendiente`     { tokenCierre, desde, usuarioId } cuando se cerró sesión y todavía no se confirmó en el servidor. */
(function () {
  'use strict';

  var CLAVE_SESION_CIERRE = 'sesion_token_cierre';
  var CLAVE_PENDIENTE = 'logout_pendiente';
  var CLAVE_CUENTA_ACTIVA = 'app_cuenta_activa_id';
  var CLAVE_USUARIO_OFFLINE = 'offline_usuario_id';
  var enVuelo = null;                       // una sola solicitud de cierre a la vez

  function leer(clave) { try { return localStorage.getItem(clave); } catch (e) { return null; } }
  function escribir(clave, valor) { try { localStorage.setItem(clave, valor); } catch (e) { /* sin almacenamiento */ } }
  function quitar(clave) { try { localStorage.removeItem(clave); } catch (e) { /* sin almacenamiento */ } }
  function esperar(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  /** Guarda el token de cierre de la sesión que acaba de empezar (la respuesta de login y de verificar-2fa lo traen). */
  function guardarTokenCierre(token) {
    if (token) escribir(CLAVE_SESION_CIERRE, String(token));
    // Se acaba de iniciar sesión: cualquier cierre que hubiera quedado pendiente era de la sesión que esta REEMPLAZA (el servidor ya borró su token).
    quitar(CLAVE_PENDIENTE);
  }

  function leerPendiente() {
    var crudo = leer(CLAVE_PENDIENTE);
    if (!crudo) return null;
    try { return JSON.parse(crudo) || { tokenCierre: null }; } catch (e) { return { tokenCierre: null }; }
  }
  function hayLogoutPendiente() { return !!leer(CLAVE_PENDIENTE); }
  function hayCuentaActiva() { return !!leer(CLAVE_CUENTA_ACTIVA); }

  /** ¿Esta pantalla debe NEGARSE a entrar por la cookie? Sí si hay un cierre pendiente y no hay otra cuenta activa de dispositivo. */
  function entradaBloqueada() { return hayLogoutPendiente() && !hayCuentaActiva(); }

  /** Pide el cierre al servidor. true = el servidor respondió (cerrada o ya no existía); false = no hay señal o respondió «ahora no». */
  async function pedirCierre(pendiente) {
    try {
      if (pendiente.tokenCierre) {
        var r = await fetch('/api/auth/cerrar-pendiente', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ tokenCierre: pendiente.tokenCierre })
        });
        return r.status === 200;               // 429 (demasiados intentos) y 5xx no cuentan: se reintenta después
      }
      // Una sesión que empezó ANTES de este parche no tiene token: se cierra por la vía de siempre (necesita la cookie, que aún es la suya).
      if (typeof api === 'function') {
        try { await api('/auth/logout', { method: 'POST' }); return true; }
        catch (e) { if (e && e.status === 401) return true; return false; }
      }
      return false;
    } catch (e) {
      return false;                            // sin señal
    }
  }

  /** Cierra en el servidor la sesión pendiente (si la hay). Devuelve true si no queda nada pendiente. `ms` es el máximo que se espera. */
  function resolver(ms) {
    var pendiente = leerPendiente();
    if (!pendiente) return Promise.resolve(true);
    if (!enVuelo) {
      enVuelo = pedirCierre(pendiente).then(function (hecho) {
        if (hecho) quitar(CLAVE_PENDIENTE);
        enVuelo = null;
        return hecho;
      });
    }
    return ms ? Promise.race([enVuelo, esperar(ms).then(function () { return false; })]) : enVuelo;
  }

  /** Carga un script si esta pantalla no lo trae. Si no se puede (sin señal ni caché), se sigue sin él. */
  function cargarScript(src) {
    return new Promise(function (ok) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { ok(); };
      s.onerror = function () { ok(); };
      document.head.appendChild(s);
    });
  }

  /** Cuántas pendientes de ESTA cuenta hay sin enviar (en las colas de IndexedDB). 0 si no se pueden leer las colas. */
  async function contarPendientes() {
    try {
      // Algunas pantallas (Mis registros, el escritorio) no cargan las colas: se piden aquí para poder avisar antes de cerrar.
      if (typeof listarColaOffline !== 'function') await cargarScript('/js/offline-utils.js');
      if (typeof listarColaOffline !== 'function' || typeof OFFLINE_STORES === 'undefined') return 0;
      var total = 0;
      for (var i = 0; i < OFFLINE_STORES.length; i++) {
        var nombre = OFFLINE_STORES[i];
        if (typeof OFFLINE_STORES_COPIA !== 'undefined' && OFFLINE_STORES_COPIA.indexOf(nombre) !== -1) continue;   // las copias de lectura no son trabajo sin enviar
        total += (await listarColaOffline(nombre)).length;
      }
      return total;
    } catch (e) {
      return 0;
    }
  }

  /** Carga cuentas-dispositivo.js si esta pantalla no lo trae (las de escritorio). Si no se puede (sin señal ni caché), se sigue sin él. */
  function asegurarCuentasDispositivo() {
    if (typeof desactivarCuentaDispositivo === 'function') return Promise.resolve();
    return cargarScript('/js/cuentas-dispositivo.js');
  }

  /**
   * CIERRA LA SESIÓN DE ESTE CELULAR, YA, con o sin señal. Devuelve false si la persona prefirió no cerrar (había pendientes y canceló).
   * opciones.destino: a dónde ir (por omisión /login.html).
   */
  async function cerrarSesionLocal(opciones) {
    var destino = (opciones && opciones.destino) || '/login.html';
    var pendientes = await contarPendientes();
    if (pendientes > 0) {
      var texto = 'Tienes ' + pendientes + ' registro' + (pendientes === 1 ? '' : 's') + ' sin enviar. '
        + 'Si cierras sesión, se enviarán cuando vuelvas a entrar en este celular.';
      if (!window.confirm(texto)) return false;
    }

    // 1) LO LOCAL, ANTES DE LA RED. Se anota qué sesión hay que cerrar en el servidor y se deja el celular sin identidad.
    var token = leer(CLAVE_SESION_CIERRE);
    escribir(CLAVE_PENDIENTE, JSON.stringify({ tokenCierre: token || null, desde: Date.now(), usuarioId: leer(CLAVE_USUARIO_OFFLINE) || null }));
    quitar(CLAVE_SESION_CIERRE);
    quitar('app_usuario_verificado');                      // la identidad en caché que reabriría la sesión sola sin señal
    await asegurarCuentasDispositivo();
    if (typeof desactivarCuentaDispositivo === 'function') {
      desactivarCuentaDispositivo();                       // deja de haber cuenta activa y borra las copias de lectura de quien se va
    } else {
      quitar(CLAVE_CUENTA_ACTIVA);
      quitar(CLAVE_USUARIO_OFFLINE);
      try { Object.keys(localStorage).filter(function (k) { return k.indexOf('cache_ref_') === 0; }).forEach(quitar); } catch (e) { /* sin almacenamiento */ }
    }

    // 2) EL SERVIDOR, COMO «MEJOR ESFUERZO» (4 s como máximo). Si no se pudo, queda `logout_pendiente` y se reintenta al volver la señal.
    try { await resolver(4000); } catch (e) { /* se cierra igual */ }

    // 3) SIEMPRE SE SALE.
    window.location.href = destino;
    return true;
  }

  // Al volver la señal, si quedó un cierre pendiente, se presenta.
  window.addEventListener('online', function () { if (hayLogoutPendiente()) resolver(0); });

  window.CerrarSesion = {
    cerrarSesionLocal: cerrarSesionLocal, guardarTokenCierre: guardarTokenCierre, resolver: resolver,
    entradaBloqueada: entradaBloqueada, hayLogoutPendiente: hayLogoutPendiente, contarPendientes: contarPendientes
  };
  window.cerrarSesionLocal = cerrarSesionLocal;
})();
