/**
 * «TAREAS DE DIRECCIÓN» (orden 116) — las reglas de fechas y textos, UNA SOLA VEZ.
 *
 * Es el único archivo que lo decide TODO: lo cargan las dos pantallas (escritorio y celular del candidato) y lo `require` el servidor (lib/tareasDireccion.js).
 * Así «el aviso sale el 24 nov» que dice el formulario y el 24 nov en que de verdad sale el SMS no pueden divergir: es la misma función. Sin dependencias,
 * y sin tocar el DOM ni la red: solo cuentas con fechas y textos.
 *
 * LAS FECHAS SON TEXTO «AAAA-MM-DD», en hora de Colombia, y se cuentan como días de calendario (UTC puro). Nada de `new Date('2026-11-25')` + husos: es la causa
 * clásica de que una tarea «de hoy» aparezca como de ayer a ciertas horas. «Hoy» de Colombia sale de restar cinco horas al instante (no hay horario de verano).
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.TareasDir = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var DIAS_ANTES = 3;                 // el aviso sale 3 días antes del vencimiento
  var HORA_AVISO_MIN = 8 * 60;        // 08:00 hora de Colombia
  var CINCO_HORAS = 5 * 60 * 60 * 1000;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /** Una fecha real del calendario: «2026-13-45» o «2026-02-30» NO valen (Date.UTC las «arregla» sola, y por eso se compara al volver). */
  function valida(iso) { return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) && !isNaN(utc(iso)) && aIso(utc(iso)) === iso; }
  function utc(iso) { var p = String(iso).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function aIso(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function sumarDias(iso, n) { return aIso(utc(iso) + n * 86400000); }
  /** Días de calendario de `desde` a `hasta` (negativo si `hasta` es anterior). */
  function diasEntre(desde, hasta) { return Math.round((utc(hasta) - utc(desde)) / 86400000); }

  /** { hoy: 'AAAA-MM-DD', minutos } de Colombia para un instante. */
  function enColombia(fecha) {
    var c = new Date((fecha || new Date()).getTime() - CINCO_HORAS);
    return { hoy: aIso(c.getTime()), minutos: c.getUTCHours() * 60 + c.getUTCMinutes() };
  }

  function formatoCorto(iso) { if (!valida(iso)) return ''; var p = iso.split('-'); return (+p[2]) + ' ' + MESES[+p[1] - 1]; }   // «29 nov»
  function diaYMes(iso) { if (!valida(iso)) return { dia: '', mes: '' }; var p = iso.split('-'); return { dia: String(+p[2]), mes: MESES[+p[1] - 1].toUpperCase() }; }
  /** El día de una fecha-hora «AAAA-MM-DD hh:mm:ss» (lo que devuelve MySQL con dateStrings). */
  function soloFecha(texto) { return String(texto || '').slice(0, 10); }

  /**
   * LA FECHA EN QUE SALE EL AVISO. null si no tiene sentido (la tarea ya venció, o no hay día entre hoy y el vencimiento).
   *   · normal: 3 días antes del vencimiento;
   *   · si «3 días antes» ya pasó (o es hoy y ya son las 8:00), sale MAÑANA a las 8:00, mientras no haya vencido;
   *   · si «3 días antes» es hoy y aún no son las 8:00, sale hoy.
   */
  function avisoPara(fechaLimite, hoy, minutosAhora) {
    if (!valida(fechaLimite) || !valida(hoy)) return null;
    if (diasEntre(hoy, fechaLimite) < 0) return null;
    var base = sumarDias(fechaLimite, -DIAS_ANTES);
    var d = diasEntre(hoy, base);
    if (d > 0) return base;
    if (d === 0 && (minutosAhora || 0) < HORA_AVISO_MIN) return hoy;
    var manana = sumarDias(hoy, 1);
    return diasEntre(manana, fechaLimite) >= 0 ? manana : null;
  }

  /** 'hecha' | 'vencida' | 'hoy' | 'manana' | 'a_tiempo' */
  function estadoFecha(fechaLimite, hoy, hecha) {
    if (hecha) return 'hecha';
    var d = diasEntre(hoy, fechaLimite);
    if (d < 0) return 'vencida';
    if (d === 0) return 'hoy';
    if (d === 1) return 'manana';
    return 'a_tiempo';
  }
  var ROTULO_ESTADO = { vencida: 'Vencida', hoy: 'Hoy', manana: 'Mañana', a_tiempo: 'A tiempo', hecha: 'Hecha' };
  /** Color de la hoja de calendario: rojo vencida · amarillo hoy o mañana · verde hecha · azul a tiempo. */
  var COLOR_ESTADO = { vencida: 'rojo', hoy: 'amarillo', manana: 'amarillo', a_tiempo: 'azul', hecha: 'verde' };

  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
  /** «faltan 5 días» / «vence mañana» / «vence hoy» / «venció hace 2 días». */
  function textoPlazo(fechaLimite, hoy) {
    var d = diasEntre(hoy, fechaLimite);
    if (d > 1) return 'faltan ' + d + ' días';
    if (d === 1) return 'falta 1 día (vence mañana)';
    if (d === 0) return 'vence hoy';
    return 'venció hace ' + plural(-d, 'día', 'días');
  }
  /** «4 días antes» / «el mismo día» / «2 días tarde», comparando el día de la entrega con el límite. */
  function textoOportunidad(fechaLimite, fechaRealizada) {
    var d = diasEntre(fechaRealizada, fechaLimite);
    if (d > 0) return plural(d, 'día', 'días') + ' antes';
    if (d === 0) return 'el mismo día';
    return plural(-d, 'día', 'días') + ' tarde';
  }
  /** «Hecha el 24 nov · 4 días antes» */
  function textoHecha(fechaLimite, realizadaEn) {
    var dia = soloFecha(realizadaEn);
    if (!valida(dia)) return 'Hecha';
    return 'Hecha el ' + formatoCorto(dia) + ' · ' + textoOportunidad(fechaLimite, dia);
  }

  /** 10 dígitos de celular colombiano (empieza por 3), o null. Acepta «300 123 4567», «+57 300…», «0057…», «57300…». */
  function normalizarCelular(texto) {
    var d = String(texto == null ? '' : texto).replace(/\D/g, '');
    if (d.indexOf('0057') === 0) d = d.slice(4);
    else if (d.length === 12 && d.indexOf('57') === 0) d = d.slice(2);
    return /^3\d{9}$/.test(d) ? d : null;
  }
  /** «300 *** 4521» */
  function enmascarar(celular) { var c = normalizarCelular(celular); return c ? c.slice(0, 3) + ' *** ' + c.slice(6) : ''; }
  function primerNombre(nombre) { return String(nombre || '').trim().split(/\s+/)[0] || ''; }

  /** El texto de WhatsApp y su enlace (wa.me con el prefijo 57). */
  function textoWhatsapp(nombre, titulo, fechaLimite) {
    return 'Hola ' + primerNombre(nombre) + ' 👋, te recuerdo esta tarea de la campaña: ' + String(titulo || '').trim()
      + '. Fecha límite: ' + formatoCorto(fechaLimite) + '. ¡Gracias!';
  }
  function urlWhatsapp(celular, nombre, titulo, fechaLimite) {
    var c = normalizarCelular(celular);
    if (!c) return null;
    return 'https://wa.me/57' + c + '?text=' + encodeURIComponent(textoWhatsapp(nombre, titulo, fechaLimite));
  }

  /**
   * LA LÍNEA DEL AVISO de la tarjeta. `t` trae: estado, fecha_limite, realizada_en, aviso_activo, aviso_estado, aviso_para, aviso_enviado_en y
   * `canal_previsto` ('sms' | 'app' | null, lo calcula el servidor). Devuelve { texto, tono } con tono 'ok' | 'aviso' | 'apagado' | 'error'.
   */
  function lineaAviso(t, hoy) {
    if (t.estado === 'hecha') return { texto: '✓ ' + textoHecha(t.fecha_limite, t.realizada_en), tono: 'ok' };
    if (!Number(t.aviso_activo) || t.aviso_estado === 'cancelado') return { texto: 'Aviso apagado', tono: 'apagado' };
    var app = t.canal_previsto === 'app';
    switch (t.aviso_estado) {
      case 'sin_celular': return { texto: 'Sin celular: no hay aviso', tono: 'apagado' };
      case 'no_aplica': return { texto: 'Sin aviso: ya no aplica', tono: 'apagado' };
      case 'fallido': return { texto: 'Aviso fallido: no se pudo enviar', tono: 'error' };
      case 'enviado': {
        var f = formatoCorto(soloFecha(t.aviso_enviado_en));
        return { texto: (t.aviso_canal === 'app' || (!t.aviso_canal && app) ? 'Aviso en la app ' : 'SMS enviado ') + f, tono: 'ok' };
      }
      case 'programado': {
        var cuando = formatoCorto(t.aviso_para);
        if (app) return { texto: 'Aviso en la app ' + (t.aviso_para === hoy ? 'hoy ' : '') + cuando, tono: 'aviso' };
        return { texto: (t.aviso_para === hoy ? 'SMS sale hoy ' : 'SMS programado ') + cuando, tono: 'aviso' };
      }
      default: return { texto: 'Aviso apagado', tono: 'apagado' };
    }
  }

  /** La frase bajo el interruptor del formulario. `celular` es lo escrito; `esCandidato` si el responsable es el candidato. */
  function frasePrevia(o) {
    var hoyMin = o.ahora ? enColombia(o.ahora) : enColombia(new Date());
    if (!o.activo) return 'El aviso automático está apagado.';
    if (!valida(o.fechaLimite)) return 'Elija la fecha límite para ver cuándo sale el aviso.';
    var ap = avisoPara(o.fechaLimite, o.hoy || hoyMin.hoy, o.minutos === undefined ? hoyMin.minutos : o.minutos);
    if (!ap) return 'Esta tarea vence muy pronto: no alcanza a salir un aviso.';
    if (o.esCandidato) return 'Le llega en la app el ' + formatoCorto(ap) + ', si no está realizada.';
    var cel = normalizarCelular(o.celular);
    if (cel) return 'SMS al ' + enmascarar(cel) + ' el ' + formatoCorto(ap) + ', si no está realizada.';
    if (o.conApp) return 'Le llega en la app el ' + formatoCorto(ap) + ', si no está realizada.';
    return 'Sin celular no sale el SMS. Escriba el celular del responsable.';
  }

  return {
    MESES: MESES, DIAS_ANTES: DIAS_ANTES, HORA_AVISO_MIN: HORA_AVISO_MIN,
    valida: valida, sumarDias: sumarDias, diasEntre: diasEntre, enColombia: enColombia, formatoCorto: formatoCorto, diaYMes: diaYMes, soloFecha: soloFecha,
    avisoPara: avisoPara, estadoFecha: estadoFecha, ROTULO_ESTADO: ROTULO_ESTADO, COLOR_ESTADO: COLOR_ESTADO,
    textoPlazo: textoPlazo, textoOportunidad: textoOportunidad, textoHecha: textoHecha,
    normalizarCelular: normalizarCelular, enmascarar: enmascarar, primerNombre: primerNombre,
    textoWhatsapp: textoWhatsapp, urlWhatsapp: urlWhatsapp, lineaAviso: lineaAviso, frasePrevia: frasePrevia,
  };
});
