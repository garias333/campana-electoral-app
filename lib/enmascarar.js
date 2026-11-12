/**
 * lib/enmascarar.js — LOS DATOS PERSONALES SE ENSEÑAN TAPADOS A QUIEN NO ES DUEÑO DE ELLOS (parche 327).
 *
 * Las tres máscaras ya existían, cada una en su rincón: la de la cédula en lib/normalizarCedula.js (la usa
 * Logística, la auditoría y la inscripción), la del teléfono en lib/solicitudes.js y la del correo escrita en
 * línea dentro de lib/recordatorios.js. Aquí se juntan SIN cambiar ninguna: las dos primeras se reexportan y la
 * del correo se escribe una vez.
 *
 * LA CÉDULA SE TAPA CON LOS ÚLTIMOS 3 DÍGITOS (`***456`), igual que Logística, la bitácora y la inscripción
 * (decisión de Gildardo, orden 41): una sola forma en toda la aplicación.
 *
 * QUIÉN VE EL DATO COMPLETO: el administrador y el coordinador. Los demás roles lo ven tapado (`puedeVerCompleto`).
 */
'use strict';

const { enmascararCedula } = require('./normalizarCedula');

// lib/solicitudes.js arrastra media aplicación (base de datos, notificaciones): se carga al usarla, no al importar este archivo.
function enmascararTelefono(texto) {
  return require('./solicitudes').enmascararTelefono(texto);
}

/** «maria@correo.com» → «m***@correo.com». */
function enmascararEmail(texto) {
  const e = String(texto || '').trim();
  if (!e) return '';
  return /^.+@.+$/.test(e) ? e.replace(/^(.).*(@.*)$/, '$1***$2') : '***';
}

/** ¿Este usuario ve cédulas, teléfonos y correos completos? Administrador y coordinador. */
function puedeVerCompleto(usuario) {
  return !!usuario && (usuario.rol === 'admin' || usuario.rol === 'coordinador');
}

/** La cédula como la debe ver `usuario`: completa para administrador y coordinador, tapada para los demás. */
function cedulaPara(usuario, cedula) {
  return puedeVerCompleto(usuario) ? (cedula || null) : (cedula ? enmascararCedula(cedula) : null);
}

module.exports = { enmascararCedula, enmascararTelefono, enmascararEmail, puedeVerCompleto, cedulaPara };
