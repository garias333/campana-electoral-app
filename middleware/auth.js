/**
 * Middlewares de autenticación y control de acceso por rol.
 *
 * Roles del sistema: admin, coordinador, lider, testigo, invitado
 * - admin: control total, incluida la carga y eliminación de recursos.
 * - coordinador / lider / testigo: gestión operativa según su alcance.
 * - invitado: solo lectura (p. ej. descarga de recursos públicos).
 */

const pool = require('../config/db');
const { cargoDeLaMadre } = require('../config/cargoMadre');
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
    /* 'aspirante' NO ES UN ROL DE LA TABLA: es el sombrero de una sublicencia.
       Se escribe en la lista de la ruta, igual que los demás, para que leyendo
       la línea se sepa si un aspirante llega ahí — en vez de tener que buscarlo
       en otro archivo. Su rol real sigue siendo 'lider'.

       Ponerlo en la guarda ABRE LA PUERTA, no acota los datos. La ruta que lo
       admita tiene que filtrar por su rama; sin eso, un aspirante vería la
       campaña entera. Va comprobado en cada una de las que lo llevan. */
    const esAspirante = rolesPermitidos.includes('aspirante') && !!req.sublicencia;
    if (!esAspirante && !rolesPermitidos.includes(usuario.rol)) {
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
async function calcularAlcance(req, res, next) {
  const usuario = req.session.usuario;

  /* EL ASPIRANTE VE SU RAMA, NO LO QUE REGISTRÓ EN PERSONA.
     Su rol es 'lider', y el alcance de un líder es «los votantes cuyo
     `lider_id` soy yo». Para un aspirante eso da casi siempre CERO: las
     personas de su estructura las tecleó quien las captó, normalmente un
     coordinador de la campaña madre. Medido en la municipal el 24 de agosto de
     2026, Camilo tiene cinco personas colgando de él y ni una sola ficha con
     su `lider_id` — su pantalla decía «0 registros» teniendo gente.

     Se resuelve aquí, en el alcance, y no en cada consulta: las cinco
     consultas de votantes ya comparten esta pieza, y una sexta que se escriba
     mañana la hereda sin que nadie tenga que acordarse. */
  if (req.sublicencia) {
    req.alcance = { usuarioId: req.sublicencia.usuario_id, cargo: 'aspirante',
                    territorioId: usuario.territorio_id };
    return next();
  }

  /* EL CARGO DE LA MADRE VIAJA EN EL ALCANCE, para que `filtroMadre` pueda
     comparar contra el `apoya_a` de cada votante sin que cada consulta tenga
     que ir a buscarlo. Va cacheado 30 s (ver config/cargoMadre.js).
     Si no se puede leer viene null, y entonces el filtro no se aplica: sin
     cargo no hay con qué comparar, y ocultar por si acaso dejaria a la campaña
     sin ver a su propia gente por un error de lectura. */
  let cargoMadre = null;
  try { cargoMadre = await cargoDeLaMadre(); } catch (err) { /* se sigue sin filtro */ }

  if (usuario.rol === 'admin') {
    /* ANTES ERA `null`, «sin restricción», y todas las consultas hacen
       `if (req.alcance)`. Ahora lleva objeto para que ese `if` sea verdadero y
       la condición de la madre entre por el mismo sitio que las demás — sin
       tocar una sola de las consultas.
       `cargo: 'madre'` no acota por persona: es exactamente «toda la campaña»,
       igual que antes, más el filtro de la rama. */
    req.alcance = { cargo: 'madre', cargoMadre };
  } else {
    // EL COORDINADOR VE SU RAMA, NO TODA LA CAMPAÑA.
    //
    // Hasta ahora se le daba el mismo alcance que al administrador: sin
    // restricción. En las campañas de prueba eso son NUEVE personas por
    // campaña con acceso de lectura y exportación a la base entera de
    // votantes — cédulas, teléfonos, direcciones e intención de voto.
    //
    // Un coordinador necesita ver el trabajo de SUS líderes, que es otra cosa
    // y está registrada: `estructura.supervisor_id` ata cada líder a su
    // coordinador. Con `cargo` en el alcance, cada consulta arma la condición
    // que le toca (ver SQL_ALCANCE_VOTANTES en routes/votantes.routes.js).
    req.alcance = { usuarioId: usuario.id, territorioId: usuario.territorio_id, cargo: usuario.rol, cargoMadre };
  }
  next();
}

/**
 * LAS PENDIENTES DE LA COLA SIN SEÑAL SON DE UNA CUENTA (parche 329, orden 43). Un celular se comparte: lo que alguien dejó sin enviar es SUYO y solo
 * su sesión debe subirlo. El navegador manda `X-Cola-Usuario` con el dueño de cada pendiente cuando la sube (public/js/offline-utils.js,
 * `sincronizarCola`); si no coincide con la cuenta de quien la presenta, se rechaza con 409 y el cliente la deja guardada, intacta.
 * Sin ese encabezado no hace nada (una petición normal, no de la cola). Va antes de las rutas, así que vale para TODAS las que reciben pendientes
 * (las que llevan `cliente_uuid`) sin tocarlas una por una.
 */
async function verificarDuenoDeCola(req, res, next) {
  const declarado = req.headers['x-cola-usuario'];
  if (declarado === undefined) return next();
  const usuario = await resolverUsuario(req);
  if (!usuario) return next();                       // sin sesión: la ruta responde 401 como siempre
  if (String(declarado).trim() !== String(usuario.id)) {
    return res.status(409).json({ error: 'Esta pendiente es de otra cuenta.', codigo: 'cola_de_otra_cuenta' });
  }
  next();
}

module.exports = { requireAuth, requireRole, calcularAlcance, verificarDuenoDeCola };
