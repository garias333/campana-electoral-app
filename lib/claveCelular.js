/**
 * LA CLAVE DEL CELULAR DEL COORDINADOR (orden 59): los últimos 6 dígitos de su cédula.
 *
 * Gildardo decidió que sea SIEMPRE esa: no hay cambio de clave al primer ingreso ni opción de cambiarla. Por eso no se
 * guarda lo que la persona elige sino lo que sale de su cédula, y se guarda con hash (bcrypt, igual que `password_hash`):
 * nunca en texto plano ni en un registro.
 *
 * VIVE EN COLUMNAS PROPIAS (`usuarios.clave_celular_hash` y `usuarios.clave_celular_cedula`) y NO TOCA `password_hash`: la
 * contraseña del coordinador para entrar por correo sigue siendo la de siempre.
 *
 *   clave_celular_hash    el bcrypt de los últimos 6 dígitos.
 *   clave_celular_cedula  la cédula (solo dígitos) de la que salió ese hash. No es un secreto —la cédula ya está en la
 *                         fila— y sirve para saber, sin calcular nada, si el hash quedó viejo: si la cédula de la fila ya
 *                         no es esta, la clave se recalcula. Es lo que hace que cambiarle la cédula a un coordinador por
 *                         CUALQUIER camino (formulario, Excel, un UPDATE a mano) invalide la clave vieja: el ingreso
 *                         comprueba esto antes de comparar.
 *
 * `sincronizarClaveCelular` es idempotente: si el hash ya corresponde a la cédula de hoy, no escribe nada (así init-db dos
 * veces seguidas no cambia nada).
 */
'use strict';

const bcrypt = require('bcryptjs');

const COSTO_BCRYPT = 12;   // el mismo que las demás contraseñas
const LARGO_CLAVE = 6;

/** Solo los dígitos de la cédula, tal cual (sin quitar ceros a la izquierda: «0012345678» son 10 dígitos). */
function digitosDeCedula(cedula) {
  return String(cedula == null ? '' : cedula).replace(/\D/g, '');
}

/**
 * La clave que le corresponde a una cédula: sus últimos 6 dígitos. Con menos de 6 dígitos se rellena con ceros a la
 * izquierda («12345» → «012345»). Devuelve null si no hay un solo dígito.
 */
function claveDeCedula(cedula) {
  const d = digitosDeCedula(cedula);
  if (!d) return null;
  return d.slice(-LARGO_CLAVE).padStart(LARGO_CLAVE, '0');
}

/** ¿La cédula tiene menos de 6 dígitos (y por lo tanto la clave lleva ceros de relleno)? */
function cedulaCorta(cedula) {
  const d = digitosDeCedula(cedula);
  return d.length > 0 && d.length < LARGO_CLAVE;
}

/**
 * Deja al día la clave del celular de UN usuario. `cx` es un pool o una conexión (puede ir dentro de una transacción).
 *
 * Devuelve:
 *   'generada'    se calculó y se guardó (no tenía, o la cédula cambió)
 *   'sin_cambio'  ya estaba al día
 *   'borrada'     dejó de aplicar (ya no es coordinador o no tiene cédula) y se limpió lo que tenía
 *   'no_aplica'   no es coordinador y no había nada que limpiar
 *   'no_existe'   no hay usuario con ese id
 *
 * NUNCA lanza por una base sin las columnas todavía (un parche que llegó antes que `init-db`): devuelve 'sin_columnas'.
 * Cualquier otro error sí se propaga: quien llama decide.
 */
async function sincronizarClaveCelular(cx, usuarioId) {
  let u;
  try {
    const [[fila]] = await cx.query(
      `SELECT u.id, u.numero_identificacion, u.clave_celular_hash, u.clave_celular_cedula, r.nombre AS rol
         FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`, [usuarioId]);
    u = fila;
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') return 'sin_columnas';
    throw err;
  }
  if (!u) return 'no_existe';

  const digitos = digitosDeCedula(u.numero_identificacion);
  if (u.rol !== 'coordinador' || !digitos) {
    if (u.clave_celular_hash || u.clave_celular_cedula) {
      await cx.query('UPDATE usuarios SET clave_celular_hash = NULL, clave_celular_cedula = NULL WHERE id = ?', [u.id]);
      return 'borrada';
    }
    return 'no_aplica';
  }

  if (u.clave_celular_hash && u.clave_celular_cedula === digitos.slice(0, 20)) return 'sin_cambio';

  const hash = await bcrypt.hash(claveDeCedula(digitos), COSTO_BCRYPT);
  await cx.query('UPDATE usuarios SET clave_celular_hash = ?, clave_celular_cedula = ? WHERE id = ?',
    [hash, digitos.slice(0, 20), u.id]);
  return 'generada';
}

/**
 * Lo mismo para quien llama DESPUÉS de crear o editar a alguien: nunca debe tumbar el alta ni la edición. Un fallo se
 * registra (solo el código y el mensaje: la consulta lleva el hash) y se sigue; el ingreso lo vuelve a intentar.
 */
async function sincronizarSinFallar(cx, usuarioId) {
  try {
    return await sincronizarClaveCelular(cx, usuarioId);
  } catch (err) {
    console.error('Clave del celular del coordinador (no se pudo sincronizar):', err.code || err.message);
    return 'error';
  }
}

module.exports = { claveDeCedula, cedulaCorta, digitosDeCedula, sincronizarClaveCelular, sincronizarSinFallar, LARGO_CLAVE };
