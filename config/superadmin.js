/**
 * Superadministrador — la única cuenta con control total de la aplicación.
 *
 * QUÉ ES, Y POR QUÉ NO ES UN ROL NUEVO
 *
 *   La tentación era agregar 'superadmin' a la tabla `roles`. Sería el
 *   camino equivocado, y el efecto sería el CONTRARIO al buscado: toda la
 *   aplicación autoriza con `requireRole('admin')` —más de cuarenta rutas—,
 *   `calcularAlcance` compara `usuario.rol === 'admin'` para no restringir
 *   el alcance, `verificarPasswordAdmin` busca `r.nombre = 'admin'`, la
 *   matriz de `permisos_rol` está indexada por nombre de rol y el menú de
 *   `public/js/common.js` lleva `roles: ['admin', ...]` escrito a mano en
 *   cada entrada.
 *
 *   Una cuenta con `rol = 'superadmin'` no habría pasado NINGUNA de esas
 *   comprobaciones: habría quedado sin menú, sin configuración y sin
 *   alcance. El usuario con control total habría sido el más limitado de
 *   todos.
 *
 *   Por eso el superadministrador CONSERVA su `rol_id` de admin —y con él
 *   todo lo que un admin puede hacer, sin tocar una sola de esas cuarenta
 *   rutas— y lo que lo distingue va en una bandera aparte:
 *   `usuarios.es_superadmin`.
 *
 * LAS TRES PROMESAS, Y QUIÉN LAS SOSTIENE
 *
 *   1. «Solo puede haber uno» — lo sostiene LA BASE DE DATOS, no este
 *      código. `usuarios` lleva una columna generada `superadmin_unico`
 *      (vale 1 si es superadmin, NULL si no) con índice UNIQUE encima.
 *      MySQL ignora los NULL en un UNIQUE, así que los demás usuarios
 *      conviven sin estorbarse y un segundo superadministrador falla con
 *      ER_DUP_ENTRY. Da igual por dónde entre el INSERT: aplicación,
 *      consola de MySQL o un respaldo restaurado.
 *
 *      Una comprobación en JavaScript («¿ya hay uno?») no habría servido:
 *      entre la consulta y el INSERT cabe otra petición, y sobre todo no
 *      cubre lo que no pasa por aquí.
 *
 *   2. «Es indetectable» — lo sostienen los filtros de este módulo,
 *      aplicados en las consultas que listan cuentas. Y algo más
 *      importante: las rutas que reciben un `:id` responden 404, NO 403.
 *      Un 403 confirma que la cuenta existe; con 404 la respuesta es
 *      idéntica a la de un id que nunca existió, que es lo que
 *      «indetectable» significa cuando alguien prueba números a mano.
 *
 *   3. «Control total» — se hereda del rol admin, y encima se le quita a
 *      los demás la capacidad de tocarlo: nadie más lo edita, lo borra, lo
 *      desactiva, le cambia el rol ni le restablece la contraseña.
 *
 * NINGÚN CAMINO DE LA APLICACIÓN ESCRIBE `es_superadmin = 1`.
 *
 *   Es a propósito, y es la garantía de fondo: si un administrador pudiera
 *   otorgarse la categoría desde alguna pantalla, la categoría no valdría
 *   nada. La elevación se hace UNA vez desde el servidor, con
 *   `node scripts/elevar-superadmin.js`, fuera del alcance de la web.
 *
 * LÍMITE CONOCIDO, DICHO EN VOZ ALTA: un respaldo completo
 *   (Configuración → Backup) es un `mysqldump` de la base entera y por
 *   definición incluye la fila. La invisibilidad es dentro de la
 *   aplicación. Excluir la fila del volcado sería peor: un respaldo que al
 *   restaurarse se lleva por delante al superadministrador.
 */

const pool = require('./db');
// El correo con el que nace el superadministrador (SUPERADMIN_EMAIL o el valor por
// omisión). Vive en un archivo sin dependencias para que db/init-db.js pueda leerlo
// sin abrir el pool de la aplicación; aquí se vuelve a exportar.
const { CORREO_SUPERADMIN } = require('./superadminCorreo');

/**
 * El id se consulta a la base, no se lee de la sesión.
 *
 * POR QUÉ. Las sesiones viven en la tabla `sessions` y duran hasta siete
 * días («Recordarme»). Si la comprobación dependiera de una bandera
 * guardada dentro de la sesión, la cuenta recién elevada seguiría siendo un
 * admin corriente hasta que su dueño cerrara sesión y volviera a entrar —y
 * al revés, una sesión vieja seguiría diciendo «superadmin» después de
 * revocarlo. Preguntándole a la base, el cambio vale desde el instante
 * siguiente.
 *
 * El TTL de 30 segundos es para no repetir la consulta en cada petición sin
 * quedarse con una respuesta vieja para siempre. Es corto a propósito: el
 * caso que importa es el arranque —el proceso pregunta y no hay ninguno
 * todavía— y con un caché eterno esa respuesta vacía sobreviviría hasta el
 * siguiente reinicio.
 */
const TTL_CACHE_MS = 30 * 1000;
let cacheId = null;
let cacheVence = 0;

async function idSuperadmin() {
  if (Date.now() < cacheVence) return cacheId;
  try {
    const [[fila]] = await pool.query(
      `SELECT id FROM usuarios WHERE es_superadmin = 1 LIMIT 1`
    );
    cacheId = fila ? fila.id : null;
    cacheVence = Date.now() + TTL_CACHE_MS;
  } catch (err) {
    // La columna todavía no existe (base sin migrar): no es superadmin
    // nadie, y la aplicación sigue funcionando exactamente como antes.
    // Se cachea igual, para no repetir una consulta que va a fallar en
    // cada petición.
    if (err.code !== 'ER_BAD_FIELD_ERROR') {
      console.error('[superadmin] No se pudo consultar la cuenta:', err.code || err.message);
    }
    cacheId = null;
    cacheVence = Date.now() + TTL_CACHE_MS;
  }
  return cacheId;
}

/** Olvida el caché — lo llama el script de elevación tras escribir. */
function olvidarCache() {
  cacheId = null;
  cacheVence = 0;
}

/** ¿Quien hace esta petición es el superadministrador? */
async function esSuperadmin(usuario) {
  if (!usuario || !usuario.id) return false;
  const id = await idSuperadmin();
  return id !== null && Number(usuario.id) === Number(id);
}

/**
 * Fragmento de SQL para esconder la fila en los listados de cuentas.
 *
 * Devuelve cadena vacía cuando quien consulta ES el superadministrador —él
 * sí se ve a sí mismo; si no, no podría administrar su propia cuenta.
 *
 * `alias` es el que tenga la tabla `usuarios` en esa consulta ('u' casi
 * siempre). Se compara con `= 0` y no con `<> 1` porque la columna es
 * NOT NULL DEFAULT 0: no hay NULL que se escape del filtro.
 */
async function filtroOcultar(usuario, alias = 'u') {
  if (await esSuperadmin(usuario)) return '';
  return ` AND ${alias}.es_superadmin = 0`;
}

/**
 * Guarda para toda ruta administrativa que reciba un `:id` de usuario.
 *
 * Devuelve true —y YA respondió 404— si el objetivo es el
 * superadministrador y quien pide no lo es. La ruta debe cortar ahí:
 *
 *     if (await protegerObjetivo(req, res, req.params.id)) return;
 *
 * EL 404 NO ES PEREZA, ES EL REQUISITO. Con 403 («no tiene permisos»)
 * cualquier administrador descubriría la cuenta recorriendo ids: la que
 * conteste distinto es la que existe. Con 404 la respuesta es letra por
 * letra la misma que da un id inexistente.
 */
async function protegerObjetivo(req, res, idObjetivo) {
  const id = await idSuperadmin();
  if (id === null || Number(idObjetivo) !== Number(id)) return false;
  if (await esSuperadmin(req.session && req.session.usuario)) return false;
  res.status(404).json({ error: 'Ese usuario ya no existe.' });
  return true;
}

/**
 * Impide que el superadministrador se borre o se desactive A SÍ MISMO.
 *
 * NO ES PATERNALISMO, ES LA CUARTA PROMESA AL REVÉS. La cuenta es invisible
 * para todos los demás: si desaparece o queda inactiva, NADIE puede
 * recrearla ni reactivarla desde la aplicación —los administradores no ven
 * la fila, y aunque la vieran las guardas se lo impiden—. Un clic distraído
 * dejaría la instancia sin superadministrador y solo se podría arreglar
 * volviendo al servidor.
 *
 * Por eso no es un «no se puede» sino un «no por aquí»: el camino está y es
 * explícito, `node scripts/elevar-superadmin.js <correo> --revocar`. Quien
 * de verdad quiera irse, revoca primero y después borra la cuenta como
 * cualquier otra.
 *
 * Responde 409 y no 404: aquí quien pregunta ES el superadministrador, así
 * que no hay nada que esconderle — hay algo que explicarle.
 */
async function protegerAutodestruccion(req, res, idObjetivo) {
  const usuario = req.session && req.session.usuario;
  if (!await esSuperadmin(usuario)) return false;
  if (Number(idObjetivo) !== Number(usuario.id)) return false;
  res.status(409).json({
    error: 'Es la cuenta de superadministrador y no se puede eliminar ni desactivar desde aquí. '
         + 'Si de verdad quiere hacerlo, primero quítele la categoría en el servidor: '
         + 'node scripts/elevar-superadmin.js <correo> --revocar'
  });
  return true;
}

module.exports = {
  CORREO_SUPERADMIN,
  idSuperadmin,
  esSuperadmin,
  filtroOcultar,
  protegerObjetivo,
  protegerAutodestruccion,
  olvidarCache
};
