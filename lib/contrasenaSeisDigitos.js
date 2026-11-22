/**
 * LA CONTRASEÑA DE 6 DÍGITOS (orden 90), para todos los usuarios y todos los roles.
 *
 * Lo pidió Gildardo: «Esta contraseña es obligatoria de 6 caracteres numéricos para todos los usuarios, no 8, y la contraseña por defecto cuando se crea el
 * usuario son los 6 últimos dígitos de su número de identificación».
 *
 * REGLA. Toda contraseña NUEVA o CAMBIADA (la que escribe un administrador en el formulario de Usuarios, la que elige la persona al cambiarla o al recuperarla
 * por correo) tiene EXACTAMENTE 6 dígitos 0-9. Se valida en el servidor; las pantallas solo ayudan.
 *
 * LAS EXISTENTES NO SE TOCAN. Quien tiene una contraseña de 8 o más caracteres sigue entrando con ella: `POST /auth/login` compara el hash y no mira el largo.
 * La regla se aplica al CREAR o CAMBIAR, nunca al ingresar.
 *
 * Es la misma forma que la clave del celular (lib/claveCelular.js). Son dos claves distintas, en columnas distintas (`password_hash` y `clave_celular_hash`);
 * lo que se unifica es el formato y el valor por omisión (los últimos 6 dígitos de la cédula), no la columna.
 */
'use strict';

const MENSAJE = 'La contraseña debe tener 6 números.';
const MENSAJE_OBLIGATORIA = 'Escribe la contraseña (6 números): sin una identificación de al menos 6 dígitos no se puede calcular la de por omisión.';
const LARGO = 6;

/** ¿Son exactamente 6 dígitos 0-9? (sin recortar espacios: lo que llega es lo que se guarda) */
function esContrasenaValida(texto) {
  return /^\d{6}$/.test(String(texto == null ? '' : texto));
}

/** Solo los dígitos de la identificación. */
function digitos(identificacion) {
  return String(identificacion == null ? '' : identificacion).replace(/\D/g, '');
}

/**
 * La contraseña por omisión de un usuario nuevo: los últimos 6 dígitos de su identificación.
 * Con menos de 6 dígitos (o ninguno) devuelve null: ahí la contraseña es obligatoria y la tiene que escribir quien crea la cuenta.
 */
function porDefectoDeIdentificacion(identificacion) {
  const d = digitos(identificacion);
  return d.length >= LARGO ? d.slice(-LARGO) : null;
}

/**
 * La misma, pero para las cuentas que se crean SOLAS (un sublíder o un testigo que nace desde Votantes, la importación de Excel): ahí nadie puede escribir una
 * contraseña, así que con una cédula de menos de 6 dígitos se rellena con ceros a la izquierda, igual que la clave del celular. Null si no hay un solo dígito.
 */
function porDefectoDeIdentificacionRellena(identificacion) {
  const d = digitos(identificacion);
  if (!d) return null;
  return d.slice(-LARGO).padStart(LARGO, '0');
}

/** Un código de 6 dígitos al azar (cuando no hay cédula con qué calcularlo). `crypto.randomInt`, no Math.random: es una credencial. */
function codigoAleatorio() {
  return String(require('crypto').randomInt(0, 1000000)).padStart(LARGO, '0');
}

module.exports = { MENSAJE, MENSAJE_OBLIGATORIA, LARGO, esContrasenaValida, porDefectoDeIdentificacion, porDefectoDeIdentificacionRellena, codigoAleatorio };
