/* FONDO DE LOS MAPAS (parche 314). Un solo sitio que decide qué teselas pinta cada mapa de escritorio.

   POR QUÉ EXISTE. Solicitudes y Tareas pedían SIEMPRE las teselas de OpenStreetMap, sin mirar si la campaña tenía
   Mapbox, y sin `<meta name="referrer">`. Al servidor le llegan dos cabeceras Referrer-Policy (la de helmet y una
   `same-origin` que añade nginx) y el navegador se queda con la última: no manda Referer a otro dominio. OpenStreetMap
   rechaza las teselas pedidas sin Referer con un 403 («Access blocked») y el fondo sale lleno de cuadros amarillos.
   Aquí cada capa lleva `referrerPolicy: 'origin'`: el Referer se manda (solo el dominio, nunca la ruta) pase lo que
   pase con las cabeceras del servidor.

   QUÉ HACE.
   · Con token de Mapbox: Mapbox, con el mismo estilo, tamaño de tesela y atribución de siempre.
   · Sin token, o si Mapbox no entrega teselas (varios `tileerror` seguidos sin una sola cargada): OpenStreetMap.
   · NUNCA escribe el token en la consola, en la atribución ni en un mensaje. (El evento `tileerror` trae la dirección
     de la tesela, que lleva el token en la URL: aquí solo se cuentan los errores, no se muestran.)

   FUNCIONES GLOBALES.
     obtenerTokenMapa(opciones)  → el token público de Mapbox, o null ante CUALQUIER fallo (403, sin red, sin token).
                                    Nunca lanza ni muestra un aviso.
     fondosMapa(token)           → { 'OpenStreetMap', 'Mapbox Calles', 'Mapbox Satélite' } (los dos últimos solo con
                                    token). Para las pantallas que ofrecen el selector de fondos.
     fondoMapa(mapa, {token,estilo}) → agrega al mapa UN fondo y lo devuelve. estilo: 'calles' (por defecto) o 'satelite'. */
(function () {
  'use strict';

  /* Quién puede pedir el token: la misma lista que la ruta del servidor (routes/territorial.routes.js). Es solo para no
     hacer una petición que se sabe que dará 403 (y que el navegador dejaría anotada en la consola). El servidor sigue
     siendo quien decide: si esta lista se desfasa, el 403 igual cae en el `catch` y el mapa usa OpenStreetMap. */
  var ROLES_CON_TOKEN = ['admin', 'coordinador', 'aspirante'];

  var ATRIBUCION_OSM = '&copy; colaboradores de OpenStreetMap';
  var ATRIBUCION_MAPBOX = '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  var ESTILOS = { calles: 'streets-v12', satelite: 'satellite-streets-v12' };
  var ERRORES_PARA_CAER = 4;   // teselas fallidas, sin ninguna cargada, antes de dejar Mapbox

  /* El token público de Mapbox, o null. `opciones.rol`: si se da y no es de los que pueden leerlo, ni se pregunta.
     `opciones.rutas`: otras rutas del servidor que sirvan el token (por defecto la del mapa territorial). */
  window.obtenerTokenMapa = async function (opciones) {
    opciones = opciones || {};
    if (opciones.rol && ROLES_CON_TOKEN.indexOf(opciones.rol) === -1) return null;
    var rutas = opciones.rutas || ['/territorial/mapbox-token'];
    var pedir = window.api;
    if (typeof pedir !== 'function') return null;
    for (var i = 0; i < rutas.length; i++) {
      try {
        var r = await pedir(rutas[i]);
        var token = r && (r.token || r.mapbox_token);
        if (token && typeof token === 'string') return token;
      } catch (e) { /* 403, sin red, sesión vencida: se prueba la siguiente y, al final, OpenStreetMap */ }
    }
    return null;
  };

  function capaOsm() {
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: ATRIBUCION_OSM, maxZoom: 19, referrerPolicy: 'origin'
    });
  }

  /* Una capa de Mapbox que, si no entrega NADA, se cambia sola por OpenStreetMap en el mapa donde esté. */
  function capaMapbox(estilo, token, osm) {
    var capa = L.tileLayer('https://api.mapbox.com/styles/v1/mapbox/' + estilo + '/tiles/{z}/{x}/{y}?access_token=' + token, {
      attribution: ATRIBUCION_MAPBOX, tileSize: 512, zoomOffset: -1, maxZoom: 22, referrerPolicy: 'origin'
    });
    var errores = 0, cargadas = 0;
    var cayendo = false;
    /* El cambio se POSPONE un instante: quitar la capa en medio de su propio evento (`tileerror` o `load`) hace que Leaflet
       siga contando teselas de una capa que ya no tiene mapa y lance «Cannot read properties of null (_fadeAnimated)». */
    function caer() {
      if (cayendo) return;
      cayendo = true;
      setTimeout(function () {
        var mapa = capa._map;
        if (!mapa || mapa.hasLayer(osm)) return;
        mapa.removeLayer(capa);
        osm.addTo(mapa);
        if (osm.bringToBack) osm.bringToBack();
      }, 0);
    }
    capa.on('tileload', function () { cargadas++; });
    /* Dos formas de darse cuenta, porque un mapa pequeño (el del Dashboard, el del celular) muestra DOS o TRES teselas y
       nunca llegaría a las cuatro: (1) varios errores seguidos sin una sola cargada; (2) Leaflet avisa con `load` que
       terminó con todas las teselas a la vista y ninguna llegó. */
    capa.on('tileerror', function () { errores++; if (cargadas === 0 && errores >= ERRORES_PARA_CAER) caer(); });
    capa.on('load', function () { if (cargadas === 0 && errores > 0) caer(); });
    return capa;
  }

  window.fondosMapa = function (token) {
    var osm = capaOsm();
    var fondos = { 'OpenStreetMap': osm };
    if (token) {
      fondos['Mapbox Calles'] = capaMapbox(ESTILOS.calles, token, osm);
      fondos['Mapbox Satélite'] = capaMapbox(ESTILOS.satelite, token, osm);
    }
    return fondos;
  };

  window.fondoMapa = function (mapa, opciones) {
    opciones = opciones || {};
    var fondos = window.fondosMapa(opciones.token);
    var nombre = opciones.estilo === 'satelite' ? 'Mapbox Satélite' : 'Mapbox Calles';
    var capa = fondos[nombre] || fondos['OpenStreetMap'];
    capa.addTo(mapa);
    return capa;
  };
})();
