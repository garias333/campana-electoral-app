/**
 * Dos comprobaciones que estaban copiadas por media aplicación.
 *
 * POR QUÉ IMPORTA TENERLAS EN UN SOLO SITIO
 *   `verificarPasswordAdmin` estaba repetida en OCHO archivos de rutas y
 *   `validarTelefono10Digitos` en CINCO. Con esa dispersión, cualquier
 *   corrección —endurecer la comparación, cambiar la regla del teléfono—
 *   hay que hacerla ocho veces, y basta olvidar una para que el sistema se
 *   comporte distinto según por qué pantalla se entre.
 *
 *   No es hipotético: al unificarlas, una de las ocho copias YA había
 *   divergido (`SELECT password_hash` en vez de `SELECT u.password_hash`, en
 *   el módulo de Día D). Esa diferencia era inofensiva; la siguiente no tiene
 *   por qué serlo.
 *
 *   Es la misma trampa que CLAUDE.md documenta para
 *   `ctc_normalizar()`/`normalizar()`: dos copias divergen solas.
 */

const bcrypt = require('bcryptjs');
const pool = require('./db');

/**
 * ¿La contraseña recibida es la de ALGÚN administrador activo?
 *
 * Se usa como confirmación extra antes de acciones que no se pueden deshacer
 * (borrados masivos, restaurar un respaldo, cambiar ajustes que afectan a
 * varios formularios a la vez), además del rol que ya exige la ruta.
 *
 * Se comparan todos los admins activos, no "el" admin: puede haber más de uno
 * y cualquiera de ellos debe poder confirmar.
 */
async function verificarPasswordAdmin(password) {
  if (!password) return false;
  const [admins] = await pool.query(
    `SELECT u.password_hash FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.nombre = 'admin' AND u.activo = 1`
  );
  for (const admin of admins) {
    if (await bcrypt.compare(password, admin.password_hash)) return true;
  }
  return false;
}

/**
 * Si el teléfono trae algo, debe tener EXACTAMENTE 10 dígitos.
 *
 * Se ignoran espacios, guiones y paréntesis: el formulario ya lo presenta
 * como "### ### ####", pero la API se puede llamar de otras formas. Vacío se
 * considera válido — el teléfono es opcional en todos los formularios.
 *
 * Ojo: la importación masiva por Excel NO usa esto, es más tolerante a
 * propósito (ver normalizarTelefonoImportado en votantes.routes.js).
 */
function validarTelefono10Digitos(valor) {
  if (!valor) return true;
  const digitos = String(valor).replace(/\D/g, '');
  return digitos.length === 10;
}

module.exports = { verificarPasswordAdmin, validarTelefono10Digitos };
