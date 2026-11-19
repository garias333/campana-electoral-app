/**
 * EL ENCABEZADO DEL COORDINADOR en app/inicio.html (orden 59): las cifras de su rama en tarjetas, y el paso a «Mis líderes».
 *
 * Una sola llamada, GET /api/coordinador/mis-lideres (el servidor sabe quién es por la sesión; aquí nunca se manda un id de persona). Dibuja con
 * las mismas tarjetas (`pl-*`) del panel del líder (panel-lider.css), para que las dos secciones se vean iguales.
 *
 * SIN SEÑAL se muestra la última copia DE ESTE USUARIO con su hora (la misma que usa la pantalla «Mis líderes»; vive en IndexedDB, por usuario, y se
 * borra al cerrar sesión o al entrar otra cuenta: ver offline-utils.js y cuentas-dispositivo.js).
 *
 * Requiere api-core.js, offline-utils.js y app-comun.js (escaparAppHtml).
 */
(function () {
  'use strict';

  var STORE = 'panel_lider_cache';
  var CLAVE = 'coordinador_mis_lideres';
  var numero = function (n) { return Number(n || 0).toLocaleString('es-CO'); };
  var porcentaje = function (p) { return Number(p).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' %'; };
  var $ = function (id) { return document.getElementById(id); };
  var hora = function (ms) { return new Date(ms).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }); };

  function tile(titulo, grande, detalle, clase) {
    return '<div class="pc-tile' + (clase ? ' ' + clase : '') + '"><span class="pc-t">' + titulo + '</span>' +
      '<span class="pc-n">' + grande + '</span>' + (detalle ? '<span class="pc-d">' + detalle + '</span>' : '') + '</div>';
  }

  function dibujar(d, sinSenal, guardadoEn) {
    var cont = $('panel-coordinador');
    if (!cont || !d) return;
    var r = d.resumen;
    var tieneEquipo = d.miembros && d.miembros.length > 0;
    var semaforo = r.sin_meta_total ? '' : (r.porcentaje < d.reglas.umbral_rojo ? 'rojo' : (r.porcentaje < d.reglas.umbral_verde ? 'amarillo' : 'verde'));

    var cifras = tieneEquipo
      ? '<div class="pc-cifras">' +
          tile('Líderes activos', numero(r.lideres_activos), r.sublideres ? numero(r.sublideres) + (r.sublideres === 1 ? ' sublíder' : ' sublíderes') : '') +
          tile('Personas registradas', numero(r.personas_registradas), 'en total') +
          tile('Compromiso total', r.compromiso_total ? numero(r.compromiso_total) : '—', r.compromiso_total ? 'registros prometidos' : 'sin metas asignadas') +
          tile('Avance', r.sin_meta_total ? '—' : porcentaje(r.porcentaje), r.sin_meta_total ? 'sin meta' : 'frente al compromiso', semaforo) +
        '</div>' +
        '<div class="pc-tile pc-ancho"><span class="pc-t">Últimos 7 días</span><span class="pc-n">' + numero(r.registros_7_dias) +
          '</span><span class="pc-d">' + (r.registros_7_dias === 1 ? 'registro' : 'registros') + ' de su equipo</span></div>'
      : '<div class="pl-vacio">Todavía no tiene líderes a su cargo.</div>';

    var atencion = '';
    if (tieneEquipo && r.lideres_sin_registrar_7 > 0) {
      atencion = '<a class="pc-atencion" href="/app/mis-lideres.html?filtro=sin7">' +
        '<strong>' + numero(r.lideres_sin_registrar_7) + '</strong> ' + (r.lideres_sin_registrar_7 === 1 ? 'líder lleva' : 'líderes llevan') +
        ' 7 días o más sin registrar <span aria-hidden="true">›</span></a>';
    }
    var boton = sinSenal && !tieneEquipo ? '' : '<a class="btn-app btn-app-primario pl-boton" href="/app/mis-lideres.html">Ver mis líderes</a>';
    var pie = sinSenal
      ? '<div class="pl-sin-senal">Sin señal: esta es la copia de las ' + hora(guardadoEn) + '. Solo puede mirarla.</div>'
      : '<div class="pl-pie">Actualizado a las ' + hora(guardadoEn) + '</div>';

    cont.innerHTML = '<div class="pl-tarjeta"><div class="pl-titulo">Mi equipo</div>' + cifras + atencion + (tieneEquipo ? boton : '') + '</div>' + pie;
    cont.hidden = false;
  }

  async function cargar() {
    var datos = null; var sinSenal = false; var guardadoEn = Date.now();
    try {
      datos = await window.api('/coordinador/mis-lideres');
      if (!datos) return;
      try { await window.guardarCopiaOffline(STORE, CLAVE, Object.assign({}, datos, { guardadoEn: guardadoEn })); } catch (_) { /* sin copia */ }
    } catch (err) {
      if (!err || !err.esErrorDeRed) return;       // un error de verdad del servidor: el encabezado simplemente no se muestra
      var copia = null;
      try { copia = await window.leerCopiaOffline(STORE, CLAVE); } catch (_) { copia = null; }
      if (!copia) return;
      datos = copia.datos; sinSenal = true; guardadoEn = copia.guardadoEn;
    }
    dibujar(datos, sinSenal, guardadoEn);
  }

  window.PanelCoordinador = {
    iniciar: function () { cargar(); window.addEventListener('online', cargar); },
    recargar: cargar,
  };
})();
