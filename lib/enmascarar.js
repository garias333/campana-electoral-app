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
 * QUIÉN VE EL DATO COMPLETO: el administrador, el coordinador y el aspirante (dueño de su campaña, orden 42). Los demás lo ven
 * tapado (`puedeVerCompleto`).
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

/**
 * ¿Este usuario ve cédulas, teléfonos y correos completos? El administrador, el coordinador y el ASPIRANTE (orden 42:
 * es el dueño de su campaña y de su rama). El aspirante no tiene un rol propio —entra con rol «lider» y una sublicencia
 * (`req.sublicencia`)—, por eso hay que decirle a esta función si quien pregunta lo es.
 */
function puedeVerCompleto(usuario, sublicencia = null) {
  return !!usuario && (usuario.rol === 'admin' || usuario.rol === 'coordinador' || !!sublicencia);
}

/** La cédula como la debe ver `usuario`: completa para administrador, coordinador y aspirante; tapada para los demás. */
function cedulaPara(usuario, cedula, sublicencia = null) {
  return puedeVerCompleto(usuario, sublicencia) ? (cedula || null) : (cedula ? enmascararCedula(cedula) : null);
}

module.exports = { enmascararCedula, enmascararTelefono, enmascararEmail, puedeVerCompleto, cedulaPara };
