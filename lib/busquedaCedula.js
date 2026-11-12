/**
 * Lo que comparten las dos búsquedas por cédula —la de votantes y la de cuentas— (órdenes 31 y 33):
 *   · el LÍMITE: 60 búsquedas por usuario cada 10 minutos, UN SOLO contador para las dos (la misma instancia de
 *     `express-rate-limit`), porque son la misma pregunta —«¿esta cédula existe?»— y quien recorre cédulas no debe poder
 *     repartirlas entre dos rutas;
 *   · las INICIALES con que se responde cuando la persona es de otro líder o está fuera del alcance de quien pregunta.
 *
 * Vive en memoria del proceso: un reinicio de PM2 lo pone en cero.
 */
'use strict';

const rateLimit = require('express-rate-limit');

const limiteBuscarCedula = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  // Una consulta sin cédula no cuenta. La cédula puede venir en la URL (búsqueda) o en el cuerpo (sumar).
  skip: (req) => !String((req.query && req.query.cedula) || (req.body && req.body.cedula) || '').trim(),
  // Por USUARIO y no por IP: varios líderes comparten la wifi de un evento.
  keyGenerator: (req) => 'usuario:' + ((req.session && req.session.usuario && req.session.usuario.id) || 'sin-sesion'),
  handler: (req, res) => res.status(429).json({ error: 'Demasiadas búsquedas, espera unos minutos' }),
});

/**
 * EL LÍMITE DE «¿YA EXISTE ALGUIEN CON ESTE NOMBRE O TELÉFONO?» (parche 327). La pantalla lo pregunta mientras se
 * escribe (con un retraso de medio segundo), así que el tope es mayor que el de las cédulas: 120 por usuario cada 10
 * minutos. Es OTRO contador: quien recorre teléfonos no debe poder gastar el de las cédulas ni al revés.
 */
const limiteVerificarDuplicado = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !String((req.query && req.query.nombre) || '').trim(),
  keyGenerator: (req) => 'duplicado:' + ((req.session && req.session.usuario && req.session.usuario.id) || 'sin-sesion'),
  handler: (req, res) => res.status(429).json({ error: 'Demasiadas búsquedas, espera unos minutos' }),
});

const PARTICULAS_DE_NOMBRE = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'di', 'van', 'von']);

/** «Pedro Gómez Ruiz» → «P. R.»; «María» → «M.». Primera y última palabra, sin partículas («de», «del»…): lo mínimo para reconocer a alguien sin decir quién es. */
function inicialesDe(nombre) {
  const palabras = String(nombre || '').trim().split(/\s+/).filter(w => w && !PARTICULAS_DE_NOMBRE.has(w.toLowerCase()));
  if (!palabras.length) return '';
  const ini = (w) => Array.from(w)[0].toLocaleUpperCase('es') + '.';
  return palabras.length === 1 ? ini(palabras[0]) : `${ini(palabras[0])} ${ini(palabras[palabras.length - 1])}`;
}

module.exports = { limiteBuscarCedula, limiteVerificarDuplicado, inicialesDe };
