/**
 * LA CLAVE DEL CELULAR (órdenes 59 y 66): los últimos 6 dígitos de la cédula, por omisión, para TODOS los que entran por un botón de «¿Cómo va a ingresar?»
 * (líderes y sublíderes, aspirantes, coordinadores, testigos). La persona puede cambiarla por otra de 6 dígitos que solo ella conozca.
 *
 * VIVE EN COLUMNAS PROPIAS de `usuarios` y NO TOCA `password_hash` (la contraseña del computador y del correo):
 *
 *   clave_celular_hash             bcrypt de la clave del celular (la de por omisión o la que la persona eligió). Nunca en texto plano ni en un registro.
 *   clave_celular_cedula           la cédula (solo dígitos) de la que salió la clave POR OMISIÓN. Sirve para saber, sin calcular nada, si ese hash quedó
 *                                  viejo: si la cédula de la fila ya no es esta, se recalcula. Solo mira mientras la clave sea la de por omisión.
 *   clave_celular_es_defecto       1 = el hash es el de por omisión (últimos 6 de la cédula); 0 = la persona ELIGIÓ otra. Con 0 NUNCA se pisa la clave: ni init-db,
 *                                  ni al editar su ficha, ni al cambiarle la cédula.
 *   clave_celular_pregunta_hecha   0 = todavía no se le preguntó «¿quiere cambiarla?» (se le pregunta al primer ingreso por el celular); 1 = ya contestó.
 *
 * `sincronizarClaveCelular` es idempotente: si todo está al día, no escribe nada (así init-db dos veces seguidas no cambia nada).
 */
'use strict';

const bcrypt = require('bcryptjs');

const COSTO_BCRYPT = 12;   // el mismo que las demás contraseñas
const LARGO_CLAVE = 6;

/**
 * Los roles que entran por un botón del celular. Los cuatro botones —y «invitado» y «usuario», que hasta hoy entraban por el mismo formulario de cédula— son
 * éstos. Administración (admin, asistente administrativo, administrativo) entra por «Otros usuarios» y NO tiene clave del celular.
 */
const ROLES_DE_BOTON = ['lider', 'sublider', 'usuario', 'invitado', 'testigo', 'aspirante_concejo', 'coordinador'];
const esRolDeBoton = (rol) => ROLES_DE_BOTON.includes(rol);

/** Solo los dígitos de la cédula, tal cual (sin quitar ceros a la izquierda: «0012345678» son 10 dígitos). */
function digitosDeCedula(cedula) {
  return String(cedula == null ? '' : cedula).replace(/\D/g, '');
}

/**
 * La clave por omisión de una cédula: sus últimos 6 dígitos. Con menos de 6 se rellena con ceros a la izquierda («12345» → «012345»).
 * Devuelve null si no hay un solo dígito.
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
 * ¿Sirve como clave NUEVA que elige la persona? Exactamente 6 dígitos y que no sea de las que prueba cualquiera (la misma regla que ya tenía el cambio de
 * contraseña de /auth/cambiar-password). Devuelve null si sirve, o el mensaje (sin la clave) si no.
 */
function problemaDeClaveNueva(nueva) {
  const t = String(nueva == null ? '' : nueva);
  if (!/^\d{6}$/.test(t)) return 'La clave nueva debe tener exactamente 6 dígitos numéricos.';
  if (/^(\d)\1{5}$/.test(t) || t === '123456' || t === '654321') return 'Esa clave es demasiado fácil de adivinar. Elija otra de 6 dígitos.';
  return null;
}

/**
 * Deja al día la clave del celular de UN usuario. `cx` es un pool o una conexión (puede ir dentro de una transacción).
 *
 * Devuelve:
 *   'generada'    se calculó y se guardó (no tenía, o la cédula cambió y la clave era la de por omisión)
 *   'sin_cambio'  ya estaba al día (o la persona eligió la suya: no se toca)
 *   'borrada'     dejó de aplicar (su rol no entra por botón, o no tiene cédula y la clave era la de por omisión) y se limpió lo que tenía
 *   'no_aplica'   no aplica y no había nada que limpiar
 *   'no_existe'   no hay usuario con ese id
 *
 * NUNCA lanza por una base sin las columnas todavía (un parche que llegó antes que `init-db`): devuelve 'sin_columnas'. Cualquier otro error se propaga.
 */
async function sincronizarClaveCelular(cx, usuarioId) {
  let u;
  try {
    const [[fila]] = await cx.query(
      `SELECT u.id, u.numero_identificacion, u.clave_celular_hash, u.clave_celular_cedula, u.clave_celular_es_defecto, r.nombre AS rol
         FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`, [usuarioId]);
    u = fila;
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') return 'sin_columnas';
    throw err;
  }
  if (!u) return 'no_existe';

  const digitos = digitosDeCedula(u.numero_identificacion);
  const eligio = Number(u.clave_celular_es_defecto) === 0 && !!u.clave_celular_hash;
  const limpiar = async () => {
    if (u.clave_celular_hash || u.clave_celular_cedula) {
      await cx.query(
        `UPDATE usuarios SET clave_celular_hash = NULL, clave_celular_cedula = NULL, clave_celular_es_defecto = 1, clave_celular_pregunta_hecha = 0 WHERE id = ?`, [u.id]);
      return 'borrada';
    }
    return 'no_aplica';
  };

  // Ya no entra por botón (por ejemplo, lo pasaron a administrador): la clave del celular no tiene dónde usarse.
  if (!esRolDeBoton(u.rol)) return limpiar();
  // Eligió la suya: NUNCA se pisa, cambie lo que cambie en su ficha.
  if (eligio) return 'sin_cambio';
  // Sin cédula no hay de dónde sacar la clave por omisión.
  if (!digitos) return limpiar();

  if (u.clave_celular_hash && u.clave_celular_cedula === digitos.slice(0, 20)) return 'sin_cambio';

  const hash = await bcrypt.hash(claveDeCedula(digitos), COSTO_BCRYPT);
  await cx.query(
    'UPDATE usuarios SET clave_celular_hash = ?, clave_celular_cedula = ?, clave_celular_es_defecto = 1 WHERE id = ?', [hash, digitos.slice(0, 20), u.id]);
  return 'generada';
}

/**
 * Lo mismo para quien llama DESPUÉS de crear o editar a alguien: nunca debe tumbar el alta ni la edición. Un fallo se registra (solo el código y el mensaje: la
 * consulta lleva el hash) y se sigue; el ingreso lo vuelve a intentar.
 */
async function sincronizarSinFallar(cx, usuarioId) {
  try {
    return await sincronizarClaveCelular(cx, usuarioId);
  } catch (err) {
    console.error('Clave del celular (no se pudo sincronizar):', err.code || err.message);
    return 'error';
  }
}

/**
 * «Restablecer clave del celular» (administración): la vuelve a los últimos 6 dígitos de la cédula y vuelve a activar la pregunta del primer ingreso.
 * Devuelve true si quedó restablecida; false si no se pudo (rol que no entra por botón, o sin cédula).
 */
async function restablecerClaveCelular(cx, usuarioId) {
  const [[u]] = await cx.query(
    `SELECT u.id, u.numero_identificacion, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`, [usuarioId]);
  if (!u || !esRolDeBoton(u.rol)) return false;
  const digitos = digitosDeCedula(u.numero_identificacion);
  if (!digitos) return false;
  const hash = await bcrypt.hash(claveDeCedula(digitos), COSTO_BCRYPT);
  await cx.query(
    `UPDATE usuarios SET clave_celular_hash = ?, clave_celular_cedula = ?, clave_celular_es_defecto = 1, clave_celular_pregunta_hecha = 0 WHERE id = ?`,
    [hash, digitos.slice(0, 20), u.id]);
  return true;
}

/** La persona eligió su clave (ya validada con `problemaDeClaveNueva`): se guarda con hash, deja de ser la de por omisión y la pregunta queda contestada. */
async function fijarClaveCelular(cx, usuarioId, clave) {
  const hash = await bcrypt.hash(String(clave), COSTO_BCRYPT);
  await cx.query(
    'UPDATE usuarios SET clave_celular_hash = ?, clave_celular_es_defecto = 0, clave_celular_pregunta_hecha = 1 WHERE id = ?', [hash, usuarioId]);
}

module.exports = {
  ROLES_DE_BOTON, esRolDeBoton, claveDeCedula, cedulaCorta, digitosDeCedula, problemaDeClaveNueva,
  sincronizarClaveCelular, sincronizarSinFallar, restablecerClaveCelular, fijarClaveCelular, LARGO_CLAVE,
};
