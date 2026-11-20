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

  /** Una de las cuatro tarjetas: cifra grande y su texto. `clase` pone el color del borde izquierdo. */
  function tarjeta(cifra, texto, clase) {
    return '<div class="pc-k' + (clase ? ' ' + clase : '') + '"><b>' + cifra + '</b><span>' + texto + '</span></div>';
  }

  /**
   * El cuadro de estado (orden 68): semáforo vertical de tres luces y una frase. X = el avance de siempre, R = personas registradas, C = compromiso
   * total, F = lo que falta. El color sale del semáforo de la orden 59 (rojo < 40 %, amarillo 40–79 %, verde ≥ 80 %: llegan en `reglas`). Sin
   * compromiso (C = 0) el semáforo queda apagado; con la meta cumplida (R ≥ C, C > 0) va en verde con otra frase.
   */
  function cuadroDeEstado(r, reglas) {
    var R = Number(r.personas_registradas || 0);
    var C = Number(r.compromiso_total || 0);
    var color = ''; var frase;
    var registros = function (n) { return n === 1 ? 'registro' : 'registros'; };
    if (!(C > 0)) {
      frase = 'Su equipo aún no tiene compromiso de registros.';
    } else if (R >= C) {
      color = 'verde';
      frase = '¡Su equipo ya cumplió la meta! <b>' + numero(R) + ' de ' + numero(C) + '</b> ' + registros(C) + '.';
    } else {
      var X = Number(r.porcentaje || 0);
      color = X < reglas.umbral_rojo ? 'rojo' : (X < reglas.umbral_verde ? 'amarillo' : 'verde');
      var F = Math.max(0, C - R);
      frase = 'Su equipo va en <b>' + porcentaje(X) + '</b> de la meta: <b>' + numero(R) + ' de ' + numero(C) + '</b> ' + registros(C) + '. ' +
        (F === 1 ? 'Falta <b>1</b>.' : 'Faltan <b>' + numero(F) + '</b>.');
    }
    var nombreColor = color || 'apagado';
    var luces = ['rojo', 'amarillo', 'verde'].map(function (l) { return '<i class="' + (l === color ? 'on ' + l : '') + '"></i>'; }).join('');
    return '<div class="pc-estado ' + nombreColor + '"><div class="pc-luz" role="img" aria-label="Semáforo: ' + (color || 'sin compromiso') + '">' + luces + '</div><p>' + frase + '</p></div>';
  }

  function dibujar(d, sinSenal, guardadoEn) {
    var cont = $('panel-coordinador');
    if (!cont || !d) return;
    var r = d.resumen;
    var tieneEquipo = d.miembros && d.miembros.length > 0;
    var franja = $('franja-avisos-alertas');       // el aviso de activar los avisos va debajo de la tarjeta; se conserva al redibujar

    var cuerpo;
    if (tieneEquipo) {
      var sub = r.sublideres ? ' · ' + numero(r.sublideres) + (r.sublideres === 1 ? ' sublíder' : ' sublíderes') : '';
      var atencion = '';
      if (r.lideres_sin_registrar_7 > 0) {
        atencion = '<a class="pc-alerta" href="/app/mis-lideres.html?filtro=sin7">' +
          '<span class="pc-n">' + numero(r.lideres_sin_registrar_7) + '</span><span>' + (r.lideres_sin_registrar_7 === 1 ? 'líder lleva' : 'líderes llevan') +
          ' 7 días o más sin registrar</span><span class="pc-ir" aria-hidden="true">›</span></a>';
      }
      cuerpo = cuadroDeEstado(r, d.reglas) +
        '<div class="pc-kpis">' +
          tarjeta(numero(r.lideres_activos), (r.lideres_activos === 1 ? 'Líder activo' : 'Líderes activos') + sub) +
          tarjeta(numero(r.personas_registradas), r.personas_registradas === 1 ? 'Persona registrada' : 'Personas registradas', 'azo') +
          tarjeta(numero(r.compromiso_total), 'Compromiso total', 'am') +
          tarjeta(numero(r.registros_7_dias), r.registros_7_dias === 1 ? 'Registro últimos 7 días' : 'Registros últimos 7 días', 'vd') +
        '</div>' + atencion +
        '<a class="pc-boton" href="/app/mis-lideres.html">Ver mis líderes</a>';
    } else {
      cuerpo = '<div class="pl-vacio">Todavía no tiene líderes a su cargo.</div>';
    }
    var pie = sinSenal
      ? '<div class="pl-sin-senal">Sin señal: esta es la copia de las ' + hora(guardadoEn) + '. Solo puede mirarla.</div>'
      : '<div class="pl-pie">Actualizado a las ' + hora(guardadoEn) + '</div>';

    cont.innerHTML = '<div class="pc-card">' + cuerpo + '</div>';
    if (franja) cont.appendChild(franja);
    cont.insertAdjacentHTML('beforeend', pie);
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
