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
  /* El Panel general. Se abre SOLO porque sus cinco consultas ya vienen
     acotadas a la rama del aspirante; sin eso, esta línea sola le habría
     entregado los totales de la campaña madre en el primer JSON. */
  '/dashboard',
  '/configuracion',  // datos de la campaña, cargos y apoyos
  '/territorial',    // Estructura territorial
  '/votantes',       // Votantes y sublíderes
  '/usuarios',       // los miembros de su estructura
  '/dia-d',          // Testigos electorales
  '/catalogo',       // la cascada de lugar de votación
  '/geo',            // geocodificación de direcciones
];

/** Los módulos que ve en el menú. Se corresponden uno a uno con sus pantallas. */
/* `panel_general` ENTRA, y con él el panel deja de contar la campaña madre.
   Las cinco consultas de routes/dashboard.routes.js nacieron sin acotar —le
   habrían enseñado los votantes de la alcaldía, su balance y su tabla de
   posiciones—. Se acotaron a la rama antes de abrir esta puerta: el módulo y
   el filtro son el mismo cambio, y separarlos habría dejado una fuga con
   pinta de función nueva. */
const MODULOS_ASPIRANTE = ['panel_general', 'configuracion', 'usuarios', 'territorial', 'mapa', 'votantes', 'testigos'];

/**
 * Qué puede HACER en cada uno de sus cuatro módulos.
 *
 * Los dos que son suyos —su gente y sus testigos— van completos. Los otros dos
 * van de sólo lectura: los datos de la campaña y el árbol territorial son de la
 * madre, y él los consulta.
 *
 * Esto gobierna qué BOTONES se dibujan. Lo que de verdad impide escribir son
 * los `requireRole('admin', …)` que ya llevan esas rutas, y que un aspirante
 * —rol «lider»— no cumple. Los dos dicen lo mismo a propósito: un botón que se
 * ofrece y luego falla con un 403 es peor que no ofrecerlo.
 */
/**
 * Las entradas de menú, una por una — porque «configuracion» son SEIS.
 *
 * El módulo `configuracion` no es una pantalla: cuelgan de él Datos de la
 * campaña, Usuarios, Asignación de permisos, Eliminar información, Backup y
 * Puestos de votación. Dándole el módulo entero, al aspirante se le ofrecían
 * «Backup» y «Eliminar información» DE LA CAMPAÑA MADRE.
 *
 * Las rutas de esas pantallas son de admin y le habrían respondido 403, así que
 * no había peligro de que las usara — pero ofrecer un botón que luego falla es
 * el error que ya se cometió con el de importar: la persona no concluye «no
 * tengo permiso», concluye «esto está roto».
 *
 * La lista va aquí y no en el navegador para que sea la misma que decide los
 * módulos. Dos listas en dos sitios se separan; ésta no puede.
 */
const HREFS_ASPIRANTE = [
  '/dashboard.html',
  '/territorial.html',
  '/mapa.html',
  '/votantes.html',
  '/testigos.html',
  '/configuracion.html#campana',
  /* Las cuentas de SU equipo. Son las de su rama que no marcan el cargo de la
     madre: quien apoya a la alcaldía lo administra la alcaldía, porque
     restablecer una contraseña no es algo que puedan hacer dos personas sin
     pisarse. Ver `usuariosDelAspiranteSql` en lib/ramas.js. */
  '/configuracion.html#usuarios',
];

const PERMISOS_ASPIRANTE = {
  panel_general: { ver: true, editar: false, agregar: false },
  usuarios:      { ver: true, editar: true,  agregar: true },
  configuracion: { ver: true, editar: true,  agregar: false },
  territorial:   { ver: true, editar: false, agregar: false },
  mapa:          { ver: true, editar: false, agregar: false },
  votantes:      { ver: true, editar: true,  agregar: true },
  testigos:      { ver: true, editar: true,  agregar: true },
};

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
  /* «NO PUDE LEERLA» NO ES LO MISMO QUE «NO TIENE».
     Las dos cosas dejaban `req.sublicencia` en null, y null desarma
     `restringirAspirante` entero: con un error pasajero de la base —un
     ER_LOCK_WAIT_TIMEOUT, el pool agotado, una conexión cortada— el aspirante
     dejaba de estar acotado en TODAS las rutas y su panel pasaba a contar la
     campaña madre. Sin ningún error visible: la pantalla solo mostraba
     números más grandes.
     La bandera separa los dos casos para poder cerrar en uno y seguir abierto
     en el otro. */
  req.sublicenciaIlegible = false;
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
    /* SIN TABLA SE SIGUE COMO SIEMPRE: una campaña que no aplicó el parche no
       tiene aspirantes, así que no hay nada que acotar y no hay riesgo.
       Cualquier OTRO error sí es «no sé si esta persona está acotada», y a esa
       pregunta sin respuesta se contesta cerrando. */
    if (err.code === 'ER_NO_SUCH_TABLE') return next();
    console.error('Leyendo sublicencia:', err.message);
    req.sublicenciaIlegible = true;
  }
  next();
}

/** Corta lo que un aspirante no debe alcanzar. Sin sublicencia, no hace nada. */
function restringirAspirante(req, res, next) {
  /* Se falla CERRADO, y con 503 y no 403: no es que no tenga permiso, es que
     no se pudo comprobar. El mensaje lo dice, para que quien lo lea vuelva a
     intentarlo en vez de creer que le quitaron el acceso. */
  if (req.sublicenciaIlegible) {
    return res.status(503).json({
      error: 'No se pudo verificar su acceso en este momento. Vuelva a intentarlo en unos segundos.',
    });
  }
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

module.exports = {
  cargarSublicencia, restringirAspirante,
  MODULOS_ASPIRANTE, PERMISOS_ASPIRANTE, HREFS_ASPIRANTE, PERMITIDOS,
};
