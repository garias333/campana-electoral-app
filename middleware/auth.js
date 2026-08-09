/**
 * Middlewares de autenticación y control de acceso por rol.
 *
 * Roles del sistema: admin, coordinador, lider, testigo, invitado
 * - admin: control total, incluida la carga y eliminación de recursos.
 * - coordinador / lider / testigo: gestión operativa según su alcance.
 * - invitado: solo lectura (p. ej. descarga de recursos públicos).
 */

const pool = require('../config/db');
const { verificarTokenDispositivo } = require('../config/tokenDispositivo');

/**
 * Resuelve quién hace la solicitud: la cookie de sesión normal, o —si
 * viene un encabezado X-Device-Token válido— la cuenta que representa ese
 * token (ver config/tokenDispositivo.js). El token manda cuando está
 * presente: así, en un celular compartido donde alguien ya cambió de
 * cuenta activa en el navegador, no se confunde con una cookie vieja de
 * otra persona que todavía ande dando vueltas en ese mismo dispositivo.
 * Si el token viene pero no es válido/venció, se trata como no
 * autenticado (no cae de vuelta a la cookie, para no mezclar cuentas).
 */
async function resolverUsuario(req) {
  const tokenDispositivo = req.headers['x-device-token'];
  if (tokenDispositivo) {
    const datosToken = verificarTokenDispositivo(tokenDispositivo);
    if (!datosToken) return null;
    try {
      const [[usuario]] = await pool.query(
        `SELECT u.*, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`,
        [datosToken.usuarioId]
      );
      if (!usuario || !usuario.activo) return null;
      // Si el token quedó firmado como "testigo" (la persona eligió entrar
      // con esa capacidad al iniciar sesión, ver /auth/elegir-rol) y sigue
      // siendo Líder/Sublíder, la sesión toma ese rol en vez del rol_id
      // real — así las rutas restringidas a testigo (ej. enviar el
      // reporte de Día D) quedan disponibles con este token, igual que si
      // hubiera elegido esa opción en una sesión en vivo.
      const rolEfectivo = (datosToken.entrarComo === 'testigo' && ['lider', 'sublider'].includes(usuario.rol))
        ? 'testigo'
        : usuario.rol;
      req.session.usuario = {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: rolEfectivo,
        territorio_id: usuario.territorio_id,
        debe_cambiar_password: !!usuario.debe_cambiar_password,
        two_factor_enabled: !!usuario.two_factor_enabled
      };
      return req.session.usuario;
    } catch (err) {
      console.error('Error verificando token de dispositivo:', err);
      return null;
    }
  }
  return (req.session && req.session.usuario) || null;
}

async function requireAuth(req, res, next) {
  const usuario = await resolverUsuario(req);
  if (!usuario) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ error: 'Debe iniciar sesión para continuar.' });
    }
    return res.redirect('/login.html');
  }
  next();
}

function requireRole(...rolesPermitidos) {
  return async (req, res, next) => {
    const usuario = await resolverUsuario(req);
    if (!usuario) {
      return res.status(401).json({ error: 'Debe iniciar sesión para continuar.' });
    }
    if (!rolesPermitidos.includes(usuario.rol)) {
      return res.status(403).json({ error: 'No tiene permisos para realizar esta acción.' });
    }
    next();
  };
}

/**
 * Restringe el acceso a los datos del propio territorio/estructura
 * cuando el usuario no es admin ni coordinador (por ejemplo un líder
 * solo debería ver los votantes que él mismo ha registrado).
 * Se deja el criterio disponible en req.alcance para usarlo en las consultas SQL.
 */
function calcularAlcance(req, res, next) {
  const usuario = req.session.usuario;
  if (['admin', 'coordinador'].includes(usuario.rol)) {
    req.alcance = null; // sin restricción
  } else {
    req.alcance = { usuarioId: usuario.id, territorioId: usuario.territorio_id };
  }
  next();
}

module.exports = { requireAuth, requireRole, calcularAlcance };
