/**
 * Protección CSRF por "doble token": el token se genera y se guarda en la
 * sesión del servidor (no en una cookie legible por JS de terceros); el
 * frontend lo obtiene una vez vía GET /api/csrf-token y lo reenvía en el
 * header `X-CSRF-Token` en cada solicitud que modifique datos.
 *
 * Los métodos de solo lectura (GET, HEAD, OPTIONS) no requieren el token.
 */

const crypto = require('crypto');

function generarToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Asegura que la sesión actual tenga un token CSRF asignado. */
function csrfToken(req, res, next) {
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = generarToken();
  }
  next();
}

/** Verifica el token en solicitudes que modifican datos. */
function csrfProtegido(req, res, next) {
  const metodosSeguros = ['GET', 'HEAD', 'OPTIONS'];
  if (metodosSeguros.includes(req.method)) return next();

  const tokenSesion = req.session && req.session.csrfToken;
  const tokenCliente = req.headers['x-csrf-token'] || (req.body && req.body._csrf);

  if (!tokenSesion || !tokenCliente || tokenSesion !== tokenCliente) {
    return res.status(403).json({
      error: 'Token de seguridad inválido o expirado. Recargue la página e intente de nuevo.'
    });
  }
  next();
}

module.exports = { csrfToken, csrfProtegido };
