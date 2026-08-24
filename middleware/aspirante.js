/**
 * El aspirante con sublicencia sólo alcanza sus cuatro pantallas.
 *
 * POR QUÉ ESTO ES UN MIDDLEWARE Y NO UN MENÚ RECORTADO. La matriz de módulos
 * de «Asignación de permisos» gobierna lo que se DIBUJA, y nada más: medido el
 * 24 de agosto de 2026, ninguna ruta del servidor la consulta. Esconder una
 * entrada del menú no impide teclear la dirección.
 *
 * Y no es teórico: `routes/comunicaciones.routes.js` abre con
 * `requireRole('admin','coordinador','lider','asistente_administrativo')`, así
 * que cualquier líder —y un aspirante lo es— puede hoy mandar una campaña de
 * SMS que consume los créditos de la campaña madre. Recortarle el menú lo
 * dejaría creyendo que no puede, y pudiendo.
 *
 * LA LISTA ES DE LO QUE SÍ PASA, NO DE LO QUE SE BLOQUEA. Con una lista de
 * bloqueos, cada módulo nuevo del futuro nace accesible para el aspirante y
 * nadie se entera; con una de permitidos, nace cerrado y alguien tiene que
 * abrirlo a propósito. El coste de equivocarse es asimétrico y por eso la
 * lista lo es.
 *
 * Los prefijos salieron de MEDIR qué llama cada una de las cuatro pantallas,
 * no de suponerlo.
 */
const pool = require('../config/db');

const PERMITIDOS = [
  '/auth',           // la sesión, siempre
  '/permisos',       // el menú se arma con esto
  '/configuracion',  // datos de la campaña, cargos y apoyos
  '/territorial',    // Estructura territorial
  '/votantes',       // Votantes y sublíderes
  '/usuarios',       // los miembros de su estructura
  '/dia-d',          // Testigos electorales
  '/catalogo',       // la cascada de lugar de votación
  '/geo',            // geocodificación de direcciones
];

/** Los módulos que ve en el menú. Se corresponden uno a uno con sus pantallas. */
const MODULOS_ASPIRANTE = ['configuracion', 'territorial', 'votantes', 'testigos'];

/**
 * Deja en `req.sublicencia` la sublicencia activa del usuario, o null.
 *
 * Se consulta en cada petición y no se guarda en la sesión a propósito: si se
 * guardara, suspender una sublicencia no surtiría efecto hasta que la persona
 * volviera a entrar — y podría seguir trabajando toda la tarde en una vista que
 * ya no le corresponde.
 */
async function cargarSublicencia(req, res, next) {
  req.sublicencia = null;
  const u = req.session && req.session.usuario;
  if (!u) return next();

  /* SOLO SI ENTRO CON ESE SOMBRERO.
     Una misma persona puede ser lider de la campaña madre Y aspirante al
     Concejo; elige al entrar. Si entro como lider, trabaja para la madre sin
     ninguna restriccion — restringirlo por tener una sublicencia le quitaria
     el trabajo por el que esta en la estructura. */
  if (!u.es_aspirante) return next();
  try {
    const [filas] = await pool.query(
      `SELECT id, usuario_id, cargo, nombre, subtitulo, logo_url FROM sublicencias
        WHERE usuario_id = ? AND activa = 1 LIMIT 1`,
      [u.id]
    );
    if (filas.length) req.sublicencia = filas[0];
  } catch (err) {
    // Si la tabla todavía no existe —una campaña que aún no aplicó el parche—
    // se sigue como si no hubiera sublicencias. Tumbar la aplicación entera por
    // una funcionalidad que esa campaña no usa sería el peor cambio posible.
    if (err.code !== 'ER_NO_SUCH_TABLE') console.error('Leyendo sublicencia:', err.message);
  }
  next();
}

/** Corta lo que un aspirante no debe alcanzar. Sin sublicencia, no hace nada. */
function restringirAspirante(req, res, next) {
  if (!req.sublicencia) return next();

  const ruta = req.path || '';
  const permitido = PERMITIDOS.some((p) => ruta === p || ruta.startsWith(p + '/'));
  if (permitido) return next();

  // 403 y no 404: aquí no hay nada que esconder — la persona sabe que existe
  // una campaña madre, trabaja en ella. Lo que hay que decirle es que esa parte
  // no es suya, y por qué, para que no crea que algo se rompió.
  return res.status(403).json({
    error: 'Esta sección pertenece a la campaña principal. Su acceso cubre su estructura, '
         + 'sus votantes y sus testigos.',
  });
}

module.exports = { cargarSublicencia, restringirAspirante, MODULOS_ASPIRANTE, PERMITIDOS };
