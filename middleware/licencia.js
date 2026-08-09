// middleware/licencia.js
//
// Se registra MUY temprano en server.js (antes de las rutas de la app),
// para que ninguna pantalla ni endpoint funcione si la licencia no está
// vigente. Deja pasar sin bloquear: los archivos estáticos de la propia
// pantalla de "suspendida" (para no crear un bucle) y el endpoint de
// salud que uses para monitoreo, si tienes uno.
const { estaAutorizada, obtenerEstado } = require('../config/licencia');

const RUTAS_PERMITIDAS_SIEMPRE = ['/suspendida.html', '/css/', '/img/', '/favicon.ico'];

function middlewareLicencia(req, res, next) {
  if (RUTAS_PERMITIDAS_SIEMPRE.some((r) => req.path.startsWith(r))) return next();

  if (estaAutorizada()) return next();

  const estado = obtenerEstado();
  if (req.path.startsWith('/api') || req.headers.accept?.includes('application/json')) {
    return res.status(403).json({
      error: 'licencia_invalida',
      motivo: estado.motivo,
      mensaje: estado.mensaje || 'La licencia de esta instalación no está vigente. Contacta al proveedor.'
    });
  }
  return res.redirect('/suspendida.html');
}

module.exports = middlewareLicencia;
