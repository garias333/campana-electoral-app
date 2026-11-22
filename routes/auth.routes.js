const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const { enviarCorreoRecuperacion, enviarCodigo2FA, nombreDeLaApp } = require('../config/mailer');
const { enviarTelegramSuperadmin } = require('../config/telegram');
const smsSvc = require('../config/sms');
const { firmarTokenDispositivo } = require('../config/tokenDispositivo');
const { reconocerEquipo, mensajeDeRechazo, equipoControlado } = require('../config/equiposAutorizados');
const { esSuperadmin, ERROR_2FA_OBLIGATORIO } = require('../config/superadmin');
const { esAdminCandidato } = require('../config/esCandidato');
const { verificarPasswordPropia } = require('../config/verificaciones');
const { sincronizarClaveCelular, ROLES_DE_BOTON, esRolDeBoton, problemaDeClaveNueva, fijarClaveCelular } = require('../lib/claveCelular');
const { normalizarCedula, sqlCedulaNormalizada, finDeCedula } = require('../lib/normalizarCedula');

const router = express.Router();

/**
 * Hash de descarte para igualar el tiempo de respuesta del login.
 *
 * Cuando el identificador no existe no hay contraseña contra la que comparar,
 * así que la respuesta salía MUCHO más rápido que cuando sí existe (bcrypt
 * con coste 12 tarda cientos de milisegundos). Esa diferencia se mide desde
 * fuera y permite averiguar qué cuentas existen sin acertar ni una
 * contraseña. Comparando igual contra este hash, los dos caminos tardan lo
 * mismo.
 *
 * Se genera al arrancar en vez de escribirlo fijo en el código: así nadie lo
 * confunde con una credencial real ni lo copia a otro sitio.
 */
const clave6 = require('../lib/contrasenaSeisDigitos');   // contraseña de 6 dígitos (orden 90)
const HASH_DE_DESCARTE = bcrypt.hashSync('cuenta-inexistente', 12);

const MAX_INTENTOS = 5;
const BLOQUEO_MINUTOS = 15;
const RESET_TOKEN_HORAS = 1;
const CODIGO_2FA_MINUTOS = 10;
const MAX_INTENTOS_2FA = 5;
const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * INGRESO POR CÓDIGO DE UN SOLO USO ("Torre de acceso").
 *
 * Estos roles entran SIN contraseña: escriben su correo, reciben un código
 * de seis dígitos y con eso pasan. Los demás —líder, sublíder, testigo,
 * usuario, invitado— siguen con nombre de usuario y contraseña, y con
 * ellos el token de dispositivo que permite prestarse el celular en
 * campaña.
 *
 * POR QUÉ SON DOS PANTALLAS Y NO UNA QUE ADIVINE.
 *   Preguntarle al servidor «¿esta cuenta entra con código o con
 *   contraseña?» obliga a responder algo distinto según si la cuenta
 *   existe, y eso convierte el ingreso en una forma de averiguar quién
 *   trabaja en la campaña probando correos. Aquí el camino lo elige la
 *   PERSONA (la torre, o el enlace a usuario y contraseña) y el servidor
 *   nunca tiene que delatar nada.
 *
 * LA CONTRASEÑA SIGUE FUNCIONANDO PARA ESTOS ROLES, A PROPÓSITO.
 *   Es la salida de emergencia: en este proyecto el SMTP ya se rompió dos
 *   veces (ver LEAMELECTORAL.md), y dejar al administrador dependiendo
 *   solo del correo significa que un fallo de correo lo saca de su propia
 *   campaña sin forma de volver a entrar salvo por SSH. La torre es el
 *   camino ofrecido; la contraseña, el que queda por si el correo falla.
 */
/* EL ASPIRANTE AL CONCEJO ENTRA POR LAS DOS PUERTAS, Y CADA UNA EN SU SITIO.
 *
 *   celular    -> nombre de usuario y contraseña, como cualquier líder: es el
 *                 formulario al que lleva su botón del ingreso y el que sirve
 *                 para trabajar de pie en la calle.
 *   computador -> correo o celular y código de acceso, que es a lo que abre la
 *                 pantalla en un computador y como entra al panel de su
 *                 sublicencia.
 *
 * Las dos ya funcionaban para él salvo la del código, que exigía estar en esta
 * lista. La contraseña le sigue sirviendo en los dos aparatos —es la salida de
 * emergencia que explica el comentario de arriba, y el día que el SMTP falle
 * él tampoco puede quedarse fuera de su propia campaña.
 */
const ROLES_CON_CODIGO = ['admin', 'coordinador', 'asistente_administrativo', 'administrativo', 'aspirante_concejo', 'candidato'];   // orden 70: el candidato entra por «Otros usuarios»

/**
 * Límite de solicitudes de código: 5 cada 15 minutos por IP.
 *
 * Sin esto, la pantalla es una forma gratuita de mandarle correos (o SMS,
 * que se cobran) a cualquier dirección que alguien escriba, tantas veces
 * como quiera.
 */
const limitadorCodigo = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de código. Espera unos minutos antes de volver a intentar.' }
});

async function registrarAuditoria(usuarioId, accion, detalle, ip) {
  try {
    await pool.query(
      `INSERT INTO auditoria (usuario_id, accion, entidad, detalle, ip) VALUES (?, ?, 'usuarios', ?, ?)`,
      [usuarioId, accion, detalle, ip]
    );
  } catch (err) {
    console.error('Error registrando auditoría:', err);
  }
}

/**
 * Además de la cookie de sesión de siempre, cuando "recordar" está
 * marcado también se firma un token de dispositivo (ver
 * config/tokenDispositivo.js) — permite retomar esta cuenta en este mismo
 * celular más adelante sin depender de esa cookie, para poder cambiar
 * entre varias cuentas guardadas en un dispositivo compartido incluso sin
 * conexión. Devuelve ese token (o null si no se pidió "recordar") para
 * que la ruta que llama lo incluya en la respuesta.
 */
/**
 * EL TOKEN DE CIERRE (parche 329, orden 43). Cerrar sesión en un celular SIN SEÑAL no podía destruir la sesión en el servidor: la cookie
 * (httpOnly, el navegador no puede borrarla) seguía viva 8 horas —o 7 días con «Recordar sesión»— y la siguiente persona que abría la app
 * entraba como la anterior. Ahora, al iniciar sesión, el servidor entrega un token aleatorio de 32 bytes LIGADO A ESTA SESIÓN y guarda solo su
 * hash (tabla `sesiones_cierre`). El navegador lo recuerda; si se cierra sesión sin señal, al volver la señal lo presenta en
 * POST /api/auth/cerrar-pendiente y el servidor destruye esa sesión.
 *
 * Se borran antes los tokens que ya apuntaban a ESTA misma sesión: si otra persona inicia sesión sobre una cookie vieja, la sesión se REEMPLAZA y el
 * token del anterior no debe poder destruir la sesión de la persona nueva. También se purgan los de más de 8 días (la cookie más larga dura 7).
 * Devuelve el token, o null si la tabla todavía no existe (el parche llegó antes que `init-db`): iniciar sesión nunca falla por esto.
 */
async function crearTokenCierre(req, usuarioId) {
  try {
    const token = crypto.randomBytes(32).toString('base64url');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await pool.query('DELETE FROM sesiones_cierre WHERE session_id = ? OR creado_en < NOW() - INTERVAL 8 DAY', [req.sessionID]);
    await pool.query('INSERT INTO sesiones_cierre (token_hash, session_id, usuario_id) VALUES (?, ?, ?)', [hash, req.sessionID, usuarioId]);
    return token;
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') console.error('No se pudo crear el token de cierre de sesión:', err.code || err.message);
    return null;
  }
}

/** La capacidad «solo candidato» (orden 93): solo existe para el administrador marcado «Es el candidato». Para cualquier otro se ignora, venga de donde venga. */
const SOLO_CANDIDATO = 'solo_candidato';

async function completarSesion(req, usuario, recordar, entrarComo) {
  if (entrarComo === SOLO_CANDIDATO && !(usuario.rol === 'admin' && Number(usuario.es_candidato) === 1)) entrarComo = null;
  /* EL SOMBRERO DE TESTIGO SE COMPRUEBA, NO SE CREE.
     `POST /login` acepta `entrarComo` en el cuerpo y, cuando viene, se SALTA
     la pregunta de «¿cómo quieres entrar?» — y con ella el `capacidadesDe()`
     que es quien sabe qué puede ser esta persona. Hasta hoy sólo lo mandaba
     /elegir-rol, donde ya venía filtrado, así que nadie lo notó; pero la ruta
     está abierta y cualquiera con SUS PROPIAS credenciales podía pedir
     `entrarComo: 'testigo'` y llevarse una sesión con `rol: 'testigo'` sin
     tener una sola fila de testigo.

     La rama de `aspirante`, tres líneas más abajo, siempre lo comprobó contra
     `sublicencias`. Ésta no. Ahora hacen lo mismo las dos, y por el mismo
     motivo: quien elige el sombrero es la persona, pero quién PUEDE ponérselo
     lo dice la base.

     (Se destapó al poner tres botones en el ingreso del celular: el paso
     natural era que cada uno mandara su `entrarComo`, y al mirar qué haría el
     servidor con eso apareció que no lo verificaba. Por eso los botones NO lo
     mandan — ver login.html.) */
  /* EL ROL «aspirante_concejo» VIAJA EN LA SESION COMO 'lider'.
     Medido antes de crear el rol: 32 sitios comparan contra 'lider' —25 en el
     servidor, 7 en el navegador— mas 6 `requireRole`. Un rol nuevo a secas
     dejaria de coincidir en los 32, y cada uno que se escapara seria un
     permiso que falla en silencio.
     Un aspirante ES un lider en todo lo operativo: su alcance, sus rutas, su
     matriz de permisos. Lo que lo distingue —que registra Lideres y que manda
     sobre ellos— no viaja en el rol sino en `es_aspirante_concejo`.
     El verdadero se guarda en `rol_real`, por si alguna pantalla necesita
     saberlo sin preguntarle a la base. */
  const ROL_ASPIRANTE_CONCEJO = 'aspirante_concejo';
  let rolEfectivo = usuario.rol === ROL_ASPIRANTE_CONCEJO ? 'lider' : usuario.rol;
  if (entrarComo === 'testigo') {
    const [[esTestigo]] = await pool.query(
      `SELECT 1 FROM estructura WHERE usuario_id = ? AND cargo = 'testigo' LIMIT 1`, [usuario.id]);
    if (esTestigo) rolEfectivo = 'testigo';
  }

  /* ¿ESTA PERSONA TIENE SUBLICENCIA? Se anota en la sesión porque de eso
     depende A DÓNDE va al entrar, y esa decisión la toma el navegador antes de
     poder preguntar nada más.

     Sin esto, un aspirante al Concejo —que en la estructura es un líder—
     aterrizaba en la app de captura de campo, que no tiene menú ni barra
     lateral: todo lo que se le construyó (sus cuatro pantallas, su marca) vive
     en el panel, y el nunca lo veia. Medido con Camilo Arias el 24 de agosto
     de 2026: entraba a /app/inicio.html con la marca del alcalde. */
  /* EL SOMBRERO LO ELIGE ELLA, NO SE LO PONE EL SISTEMA.
     `es_aspirante` es verdadero sólo si ESTA VEZ entró como aspirante. La misma
     persona, entrando como líder, trabaja para la campaña madre sin ninguna
     restricción — que es lo correcto: sigue siendo su líder.

     Se comprueba ademas que la sublicencia siga activa: sin eso, alguien
     podria mandar `entrarComo: 'aspirante'` a mano y darse una vista que no
     compro. */
  let esAspirante = false;
  if (entrarComo === 'aspirante') {
    try {
      const [f] = await pool.query(
        'SELECT 1 FROM sublicencias WHERE usuario_id = ? AND activa = 1 LIMIT 1', [usuario.id]);
      esAspirante = f.length > 0;
    } catch (err) {
      if (err.code !== 'ER_NO_SUCH_TABLE') console.error('Leyendo sublicencia al entrar:', err.message);
    }
  }
  /* SESIÓN «SOLO CANDIDATO» (orden 93). El rol de la sesión es `candidato`: así lo tratan, sin una línea más, soloLecturaCandidato, requireRole, la matriz de permisos y todo lo que decide por
     rol. En la base sigue siendo administrador (`rol_real`), pero esta sesión NO se convierte en administrativa: hay que volver a iniciar sesión desde un equipo autorizado. */
  const soloCandidato = entrarComo === SOLO_CANDIDATO;
  if (soloCandidato) rolEfectivo = 'candidato';
  req.session.usuario = {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: rolEfectivo,
    solo_candidato: soloCandidato,
    // El de la base, sin traducir. `rol` es con lo que se decide todo; éste
    // sólo sirve para saber qué se le asignó de verdad.
    rol_real: usuario.rol,
    territorio_id: usuario.territorio_id,
    debe_cambiar_password: !!usuario.debe_cambiar_password,
    two_factor_enabled: !!usuario.two_factor_enabled,
    es_aspirante: esAspirante,
    // Orden 81: el administrador que también es el candidato. El navegador decide con esto a dónde va en el celular; /auth/me lo vuelve a consultar.
    es_candidato: usuario.rol === 'admin' && Number(usuario.es_candidato) === 1
  };
  req.tokenCierreNuevo = await crearTokenCierre(req, usuario.id);   // lo devuelven las dos respuestas de ingreso (login y verificar-2fa)
  if (recordar) {
    req.session.cookie.maxAge = SIETE_DIAS_MS;
    return firmarTokenDispositivo(usuario.id, entrarComo);
  }
  return null;
}

/**
 * Puede pasar que un Líder o Sublíder también esté registrado como
 * testigo electoral (ver /territorial/estructura y /votantes, función
 * "asignar como testigo"): la misma persona (usuario_id) tiene una fila
 * de Estructura territorial con cargo='testigo' además de su rol
 * principal. En ese caso, al iniciar sesión se le pregunta con cuál de
 * las dos capacidades quiere entrar (ver /auth/elegir-rol) — de eso
 * depende a qué pantalla se le manda y qué permisos recibe la sesión.
 */
async function tieneDobleRolTestigo(usuario) {
  // Mismo motivo que en capacidadesDe: aquí el rol llega SIN traducir, y un
  // aspirante que además sea testigo tiene que poder elegir con cuál entra.
  if (!['lider', 'sublider', 'aspirante_concejo'].includes(usuario.rol)) return false;
  const [[fila]] = await pool.query(
    `SELECT 1 FROM estructura WHERE usuario_id = ? AND cargo = 'testigo' LIMIT 1`,
    [usuario.id]
  );
  return !!fila;
}

/* Aquí vivía ASPIRANTE_A, el mapa de cómo se llamaba cada cargo en el botón
   «Como Aspirante a…». Ese botón ya no existe: el sombrero lo da la puerta.
   Se borra en vez de dejarlo por si acaso — una tabla sin usar que describe una
   pantalla que se quitó es exactamente lo que confunde dentro de seis meses. */

/**
 * Con cuántos sombreros puede entrar esta persona.
 *
 * UNA MISMA PERSONA PUEDE SER TRES COSAS A LA VEZ, y ya pasa: líder de la
 * campaña madre, testigo electoral el día D, y aspirante al Concejo con su
 * propia sublicencia. Son tres trabajos distintos con tres pantallas distintas,
 * y elegir por ella —mandándola siempre a la del sombrero «más importante»— la
 * deja sin poder hacer los otros dos.
 *
 * Devuelve la lista sólo cuando hay MÁS DE UNA: con una sola, preguntar es
 * poner una pantalla en medio para que conteste lo único que se puede contestar.
 */
async function capacidadesDe(usuario) {
  const opciones = [];
  /* `aspirante_concejo` entra aquí porque en la sesión ES un líder. Esta
     función recibe la FILA DE LA BASE, no la sesión, así que el rol le llega
     sin traducir: sin nombrarlo, alguien con el rol nuevo y una sublicencia
     activa no vería la pregunta de «¿cómo quieres entrar?» y perdería el
     acceso a su panel sin que nada fallara. */
  if (!['lider', 'sublider', 'aspirante_concejo'].includes(usuario.rol)) return opciones;

  opciones.push({
    valor: 'principal',
    texto: usuario.rol === 'sublider' ? 'Como Sublíder' : 'Como Líder',
  });

  const [[testigo]] = await pool.query(
    `SELECT 1 FROM estructura WHERE usuario_id = ? AND cargo = 'testigo' LIMIT 1`, [usuario.id]);
  if (testigo) opciones.push({ valor: 'testigo', texto: 'Como Testigo electoral' });

  /* YA NO SE PREGUNTA POR EL SOMBRERO DE ASPIRANTE: LO DICE LA PUERTA.
     Entrar por la torre —correo o celular y codigo— con sublicencia activa ES
     entrar como aspirante (ver /verificar-2fa); entrar con identificacion y
     clave es entrar como lider. Preguntarlo ademas seria pedirle que conteste
     lo que ya contesto al elegir formulario, y dejaba el caso raro de entrar
     por la torre y elegir «Como Lider», que no significa nada.

     El sombrero de TESTIGO se sigue preguntando, porque ese si es una eleccion
     de verdad: la misma persona, por la misma puerta, puede querer una cosa u
     otra el dia de las elecciones. */
  return opciones.length > 1 ? opciones : [];
}

/**
 * El mismo código de ingreso, también por Telegram, SOLO para el superadministrador.
 *
 * Devuelve una promesa de true/false (nunca rechaza: config/telegram.js no
 * lanza), o null si la cuenta no es la superadministradora — entonces no hay
 * nada que enviar y el flujo de los demás usuarios queda exactamente como era.
 * El nombre de la campaña sale de la misma fuente que el correo del código
 * (nombreDeLaApp: APP_NOMBRE o "Estrategia | App electoral"), para que quien
 * lo recibe sepa de qué campaña viene.
 *
 * NADA de esto llega al navegador: ni la respuesta ni la pantalla dicen que
 * existe este segundo envío.
 */
function avisarCodigoPorTelegram(usuario, codigo) {
  if (!usuario || Number(usuario.es_superadmin) !== 1) return null;
  return enviarTelegramSuperadmin(
    `Código de ingreso a ${nombreDeLaApp()}: ${codigo}. Vence en ${CODIGO_2FA_MINUTOS} minutos.`
  );
}

/** Cola del 2FA (si está activado) o cierra el inicio de sesión de una vez — usado tanto por /login como por /elegir-rol, ya que a partir de ese punto ambos siguen exactamente el mismo camino. */
/* `opciones.sinCodigo` (orden 62): el ingreso del coordinador por el celular NO pide el código de verificación, tenga o no la marca `two_factor_enabled`. Es lo
   único que cambia: la sesión se completa con el usuario TAL CUAL (la marca se queda en la sesión y en la base: el ingreso por correo sigue pidiendo el código). */
async function iniciar2faOCompletarSesion(req, res, usuario, recordar, entrarComo, detalleDelIngreso, opciones = {}) {
  if (usuario.two_factor_enabled && !opciones.sinCodigo) {
    const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const codigoHash = crypto.createHash('sha256').update(codigo).digest('hex');
    const expiraEn = new Date(Date.now() + CODIGO_2FA_MINUTOS * 60 * 1000);

    await pool.query(
      `INSERT INTO two_factor_codes (usuario_id, codigo_hash, expira_en) VALUES (?, ?, ?)`,
      [usuario.id, codigoHash, expiraEn]
    );

    req.session.pendiente2fa = { usuarioId: usuario.id, recordar: !!recordar, entrarComo: entrarComo || null };

    // En paralelo: el correo de siempre y, solo para el superadministrador,
    // Telegram. El ingreso falla únicamente si NINGUNO salió. Para los demás
    // usuarios hay un solo envío (el correo), así que se comporta como antes.
    const correo = enviarCodigo2FA(usuario.email, codigo).then(() => true);
    const telegram = avisarCodigoPorTelegram(usuario, codigo);
    const [resCorreo, resTelegram] = await Promise.allSettled(telegram ? [correo, telegram] : [correo]);
    if (resCorreo.status === 'rejected') {
      console.error('Error enviando código 2FA:', resCorreo.reason);
    }
    const salioAlguno = resCorreo.status === 'fulfilled'
      || (resTelegram && resTelegram.status === 'fulfilled' && resTelegram.value === true);
    if (!salioAlguno) {
      // Sin correo (y sin Telegram) el código no tiene a dónde llegar: se dice, en vez del genérico (orden 62).
      res.status(500).json({ error: String(usuario.email || '').trim()
        ? 'No se pudo enviar el código de verificación. Intenta de nuevo en unos minutos.'
        : 'Su cuenta tiene verificación en dos pasos pero no tiene correo registrado. Pida al administrador que lo revise.' });
      return;
    }

    res.json({ ok: true, requiere2fa: true });
    return;
  }

  const dispositivoToken = await completarSesion(req, usuario, recordar, entrarComo);
  await registrarAuditoria(
    usuario.id,
    'login',
    detalleDelIngreso || (`Inicio de sesión: ${usuario.email}` + (entrarComo === 'testigo' ? ' (como testigo electoral)' : '')),
    req.ip
  );
  res.json({ ok: true, usuario: req.session.usuario, dispositivoToken, tokenCierre: req.tokenCierreNuevo || null });
}

router.post('/login', async (req, res) => {
  const { email, password, recordar } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son obligatorios.' });
  }

  try {
    // El mismo campo acepta el correo electrónico o el "Nombre de
    // usuario" (por ejemplo, el número de identificación asignado como
    // usuario) — se busca por cualquiera de los dos, sin distinguir
    // mayúsculas/minúsculas. La columna va SIN envolver en LOWER(): la
    // colación de la base (utf8mb4_0900_ai_ci) ya ignora mayúsculas y
    // tildes, y una función sobre la columna impediría usar su índice
    // único — cada intento de login recorrería la tabla entera.
    const identificador = email.trim().toLowerCase();
    let [rows] = await pool.query(
      `SELECT u.*, r.nombre AS rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
       WHERE u.email = ? OR u.nombre_usuario = ? LIMIT 1`,
      [identificador, identificador]
    );

    /* ORDEN 102: SI NO HAY CORREO NI NOMBRE DE USUARIO, Y LO ESCRITO SON SOLO DÍGITOS, TAMBIÉN SE BUSCA POR NÚMERO DE CÉDULA.
       «Acceso a candidato» (orden 101) pide la cédula; si a alguien le editaron el nombre de usuario, la cédula ya no lo encontraba. Solo cuentan los usuarios ACTIVOS y se compara
       con la misma regla que el ingreso del celular (normalizarCedula: sin puntos ni ceros a la izquierda). Va DESPUÉS de correo y nombre de usuario: lo que entraba antes entra igual.
       Si la cédula coincide con MÁS de un usuario no se adivina: la misma respuesta genérica de credenciales inválidas (sin revelar que hay duplicados) y queda en la bitácora.
       Desde aquí todo sigue igual: mismo límite de intentos, misma autorización de equipo, mismo 2FA, misma bitácora. */
    if (rows.length === 0 && /^\d+$/.test(identificador)) {
      const cedula = normalizarCedula(identificador);
      if (cedula) {
        const [porCedula] = await pool.query(
          `SELECT u.*, r.nombre AS rol
             FROM usuarios u JOIN roles r ON r.id = u.rol_id
            WHERE u.activo = 1 AND ${sqlCedulaNormalizada('u.numero_identificacion')} = ?
            LIMIT 2`, [cedula]);
        if (porCedula.length > 1) {
          await bcrypt.compare(password, HASH_DE_DESCARTE);
          console.error(`Ingreso por cédula: la cédula terminada en ${finDeCedula(cedula) || '***'} coincide con más de un usuario activo; se rechaza.`);
          await registrarAuditoria(null, 'login_fallido',
            `Ingreso por cédula rechazado: la cédula terminada en ${finDeCedula(cedula) || '***'} coincide con más de un usuario activo (ids ${porCedula.map((u) => u.id).join(', ')}). Corregir el dato duplicado.`, req.ip);
          return res.status(401).json({ error: 'Credenciales inválidas.' });
        }
        rows = porCedula;
      }
    }

    if (rows.length === 0) {
      // Se compara igual, contra un hash de descarte, para que responder
      // "no existe" cueste lo mismo que responder "contraseña incorrecta".
      // Ver HASH_DE_DESCARTE arriba.
      await bcrypt.compare(password, HASH_DE_DESCARTE);
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const usuario = rows[0];

    if (usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date()) {
      return res.status(423).json({
        error: `Cuenta bloqueada temporalmente por intentos fallidos. Intenta de nuevo después de ${new Date(usuario.bloqueado_hasta).toLocaleTimeString('es-CO')}.`
      });
    }

    /* CUMPLIDO EL BLOQUEO, EL CONTADOR VUELVE A CERO (parche 330). Antes `intentos_fallidos` se quedaba en 5 al vencer los 15 minutos: UN solo error
       más sumaba 6 (≥ 5) y bloqueaba otros 15 minutos. Ahora, si el bloqueo ya pasó, se limpia antes de contar: la persona vuelve a tener sus 5 intentos. */
    if (usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) <= new Date()) {
      await pool.query('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?', [usuario.id]);
      usuario.intentos_fallidos = 0;
      usuario.bloqueado_hasta = null;
    }

    if (!usuario.activo) {
      return res.status(403).json({ error: 'Su cuenta se encuentra inactiva. Contacta al administrador.' });
    }

    const passwordValido = await bcrypt.compare(password, usuario.password_hash);

    if (!passwordValido) {
      // EL CONTADOR SE INCREMENTA EN LA PROPIA BASE, NO EN JAVASCRIPT.
      //
      // Antes se leía `intentos_fallidos`, se le sumaba uno y se escribía el
      // resultado. Dos intentos a la vez leen el mismo número y escriben el
      // mismo, así que cinco intentos simultáneos podían contar como uno: el
      // bloqueo por fuerza bruta se debilitaba justo cuando hace falta.
      //
      // El orden de los SET importa: MySQL los aplica de izquierda a derecha,
      // así que `bloqueado_hasta` se calcula con el valor ANTERIOR del
      // contador y después se incrementa.
      const bloqueadoHasta = new Date(Date.now() + BLOQUEO_MINUTOS * 60000);
      await pool.query(
        `UPDATE usuarios
            SET bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= ? THEN ? ELSE bloqueado_hasta END,
                intentos_fallidos = intentos_fallidos + 1
          WHERE id = ?`,
        [MAX_INTENTOS, bloqueadoHasta, usuario.id]
      );
      // Se relee para anotar en la bitácora el número real, que con varios
      // intentos a la vez puede no ser el que este proceso calculó.
      const [[tras]] = await pool.query(`SELECT intentos_fallidos FROM usuarios WHERE id = ?`, [usuario.id]);
      const intentos = tras ? tras.intentos_fallidos : MAX_INTENTOS;
      if (intentos >= MAX_INTENTOS) {
        await registrarAuditoria(usuario.id, 'bloqueo_cuenta', `Cuenta bloqueada ${BLOQUEO_MINUTOS} min por intentos fallidos.`, req.ip);
      }
      await registrarAuditoria(usuario.id, 'login_fallido', `Contraseña incorrecta (intento ${intentos}/${MAX_INTENTOS}).`, req.ip);
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    // EL CÓDIGO TEMPORAL CADUCA, Y SE COMPRUEBA DESPUÉS DE VALIDARLO.
    //
    // Va aquí y no antes a propósito: comprobarlo antes de saber si la
    // contraseña es correcta convertiría este mensaje en una forma de
    // averiguar qué cuentas tienen un código pendiente, sin acertar ninguno.
    //
    // Solo aplica a las contraseñas TEMPORALES: la columna queda en NULL para
    // las que la persona eligió, y ésas no vencen nunca.
    if (usuario.password_temporal_expira && new Date(usuario.password_temporal_expira) < new Date()) {
      await registrarAuditoria(usuario.id, 'codigo_vencido',
        'Intento de entrar con un código de acceso ya vencido.', req.ip);
      return res.status(401).json({
        error: 'Ese código de acceso ya venció. Pídele al administrador de la campaña que se lo envíe de nuevo.'
      });
    }

    /* ¿DESDE QUÉ EQUIPO SE ESTÁ ENTRANDO?
       Va DESPUÉS de la contraseña y del código vencido, y por lo mismo que
       aquéllos van en ese orden: responder «este equipo no está autorizado» a
       quien ni siquiera acertó la clave le confirmaría que la cuenta existe.
       Y va ANTES de crear la sesión: dejar la sesión hecha y cortar después
       sería darle acceso por un instante.

       Mientras la licencia no fije un límite esto no rechaza a nadie: solo
       anota el equipo. Ver config/equiposAutorizados.js.

       Y SOLO SE LE PREGUNTA A QUIEN ADMINISTRA LA LICENCIA. Un líder, un
       sublíder, un testigo o un aspirante al Concejo entrando desde su
       celular no está activando ningún computador de la campaña, y pedirle
       autorización lo deja fuera de su trabajo por una protección que no va
       con él. La regla vive en `equipoControlado`, no aquí: hay una sola
       lista de roles controlados y está en un solo archivo. */
    let ingresoSoloCandidato = false;
    if (await equipoControlado({ rol: usuario.rol, id: usuario.id })) {
      const equipo = await reconocerEquipo(req, res, usuario.id);
      if (!equipo.permitido) {
        /* ORDEN 93: EL ADMINISTRADOR QUE ES EL CANDIDATO NO SE QUEDA FUERA. Desde un equipo sin autorizar (pendiente, revocado o cupo lleno) entra, pero con una sesión «SOLO CANDIDATO»:
           `completarSesion` le pone el rol `candidato` y el servidor lo trata EXACTAMENTE como a ese rol (solo lectura, lista corta de config/rolCandidato.js), aunque en la base siga siendo
           administrador. El equipo queda registrado como pendiente (lo hizo `reconocerEquipo`) para que se pueda aprobar desde el panel; ya autorizado, el siguiente ingreso es el de siempre.
           Un administrador SIN la marca, el superadministrador y los demás: rechazados como hoy. */
        if (usuario.rol === 'admin' && Number(usuario.es_candidato) === 1) {
          ingresoSoloCandidato = true;
          await registrarAuditoria(usuario.id, 'equipo_no_autorizado',
            `Entró desde un equipo ${equipo.motivo} en modo solo candidato (administrador que es el candidato).`, req.ip);
        } else {
          await registrarAuditoria(usuario.id, 'equipo_no_autorizado',
            `Intento de entrar desde un equipo ${equipo.motivo}.`, req.ip);
          return res.status(403).json({ error: mensajeDeRechazo(equipo.motivo), equipoNoAutorizado: true });
        }
      }
    }

    await pool.query(
      `UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_login = NOW() WHERE id = ?`,
      [usuario.id]
    );

    // Y UNA VEZ USADO, EL CÓDIGO SE APAGA.
    //
    // No se anula de golpe: si alguien entra y cierra la aplicación antes de
    // terminar de poner su contraseña nueva, quedaría fuera de su propia
    // cuenta sin haber hecho nada mal. Se le deja media hora, que alcanza de
    // sobra para el cambio y no para que el código siga sirviendo mañana.
    if (usuario.password_temporal_expira) {
      await pool.query(
        `UPDATE usuarios SET password_temporal_expira = LEAST(password_temporal_expira, NOW() + INTERVAL 30 MINUTE)
          WHERE id = ?`, [usuario.id]
      );
    }

    // --- Líder/Sublíder que también es testigo electoral: se le pregunta
    // con cuál capacidad quiere entrar ANTES de seguir (incluso antes del
    // 2FA), porque de eso depende a qué pantalla se le manda y qué
    // permisos recibe la sesión (ver /auth/elegir-rol). ---
    /* POR ESTA PUERTA NO SE ENTRA COMO ASPIRANTE, NUNCA.
       Es la de numero de identificacion y contraseña: la del celular, la de
       trabajar en la calle. El sombrero de aspirante lo da la otra —correo o
       celular y codigo— y lo pone el servidor, no el cuerpo de la peticion.
       Sin esta linea seguiria siendo posible pedirlo aqui a mano; lo frenaba
       la comprobacion de sublicencia en completarSesion, pero apoyarse en una
       comprobacion de mas abajo para algo que aqui ya se sabe es dejar la
       puerta cerrada con el pestillo de otra habitacion. */
    const entrarComo = ingresoSoloCandidato ? 'solo_candidato' : (req.body.entrarComo === 'aspirante' ? null : req.body.entrarComo);
    if (!entrarComo) {
      const opciones = await capacidadesDe(usuario);
      if (opciones.length) {
        req.session.pendienteEleccionRol = { usuarioId: usuario.id, recordar: !!recordar };
        // Las opciones las manda el SERVIDOR y no las tiene escritas la
        // pantalla: quien es las tres cosas ve tres botones, y quien deja de
        // ser aspirante deja de verlo sin que nadie toque el formulario.
        return res.json({ ok: true, requiereEleccionRol: true, nombre: usuario.nombre, opciones });
      }
    }

    await iniciar2faOCompletarSesion(req, res, usuario, recordar, entrarComo);
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno al iniciar sesión.' });
  }
});

/* ---------------------------------------------------------------------------
   INGRESO POR LOS BOTONES DEL CELULAR (órdenes 59 y 66): número de cédula y clave de 6 dígitos, para líderes y sublíderes, aspirantes, coordinadores y testigos.

   LA CLAVE son, por omisión, los últimos 6 dígitos de la cédula; la persona puede cambiarla por otra de 6 dígitos (lib/claveCelular.js). Se guarda con hash en columnas
   PROPIAS: la contraseña del computador y del correo (`password_hash`) no se toca, y `POST /login` (computador, «Otros usuarios») sigue igual. Esta puerta solo deja pasar
   a los roles de botón (ROLES_DE_BOTON): un administrador, una cédula que no existe o una clave mala reciben el MISMO mensaje y nunca se enteran de si la cédula existe.

   TRANSICIÓN. Hasta hoy esta gente entraba por el botón con su cédula y su contraseña (`password_hash`: la cédula completa, o la de 6 cifras que eligió al cambiarla).
   Quien escriba por aquí SU CONTRASEÑA DE HOY en vez de la clave del celular entra UNA VEZ MÁS —mientras no haya contestado la pregunta del primer ingreso— y la
   pantalla de esa pregunta le explica la clave nueva. Una vez contestada, la contraseña de hoy deja de servir por esta puerta (sigue sirviendo en el computador).

   EL LÍMITE DE INTENTOS ES POR CÉDULA ESCRITA, EXISTA O NO (tabla `ingresos_celular_intentos`), y no en la fila del usuario: así «Demasiados intentos» sale igual para una
   cédula inventada que para una real, y los fallos de esta puerta no bloquean el ingreso por correo. 5 fallos seguidos → 15 minutos, y durante el bloqueo ni la clave
   correcta entra. Además, un límite por IP como en las páginas públicas (/c, /v): solo gastan cupo las respuestas fallidas.

   EL CÓDIGO DE VERIFICACIÓN: el coordinador no lo pide por aquí (orden 62). Los demás roles se quedan como estaban: solo lo piden si activaron la verificación en dos pasos.
   --------------------------------------------------------------------------- */
const MENSAJE_INGRESO_CELULAR = 'Cédula o clave incorrecta.';
const MENSAJE_BLOQUEO_CELULAR = `Demasiados intentos. Espere ${BLOQUEO_MINUTOS} minutos.`;

const limitadorIngresoCelular = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: MENSAJE_BLOQUEO_CELULAR }
});

/** Cuenta un fallo para esa clave del límite (cédula escrita, o «cc<id>»). Devuelve cuántos van. El quinto bloquea 15 minutos (hora de la base). */
async function contarFalloDeClave(clave) {
  await pool.query(
    `INSERT INTO ingresos_celular_intentos (cedula, intentos, bloqueado_hasta) VALUES (?, 1, NULL)
     ON DUPLICATE KEY UPDATE
       bloqueado_hasta = CASE WHEN intentos + 1 >= ? THEN DATE_ADD(NOW(), INTERVAL ? MINUTE) ELSE bloqueado_hasta END,
       intentos = intentos + 1`, [clave, MAX_INTENTOS, BLOQUEO_MINUTOS]);
  const [[tras]] = await pool.query('SELECT intentos FROM ingresos_celular_intentos WHERE cedula = ?', [clave]);
  // Limpieza barata de lo que lleva un día quieto y no está bloqueado.
  await pool.query(`DELETE FROM ingresos_celular_intentos WHERE actualizado_en < NOW() - INTERVAL 1 DAY AND (bloqueado_hasta IS NULL OR bloqueado_hasta < NOW())`);
  return tras ? Number(tras.intentos) : 1;
}

/** ¿Está bloqueada esa clave del límite? Si el bloqueo ya venció, el contador vuelve a cero (como en el ingreso de los líderes, parche 330). */
async function claveBloqueada(clave) {
  const [[fila]] = await pool.query(
    `SELECT (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > NOW()) AS bloqueada, (bloqueado_hasta IS NOT NULL AND bloqueado_hasta <= NOW()) AS vencida
       FROM ingresos_celular_intentos WHERE cedula = ?`, [clave]);
  if (fila && Number(fila.vencida) === 1) await pool.query('UPDATE ingresos_celular_intentos SET intentos = 0, bloqueado_hasta = NULL WHERE cedula = ?', [clave]);
  return !!(fila && Number(fila.bloqueada) === 1);
}

async function entrarPorBoton(req, res, { soloCoordinador = false } = {}) {
  const rechazar = () => res.status(401).json({ error: MENSAJE_INGRESO_CELULAR });
  try {
    const cuerpo = req.body || {};
    const digitos = String(cuerpo.cedula == null ? '' : cuerpo.cedula).replace(/\D/g, '').slice(0, 20);
    const escrita = String(cuerpo.clave == null ? '' : cuerpo.clave).slice(0, 72);
    // Lo que no tiene forma de cédula ni de clave se rechaza sin tocar la base ni contar intentos.
    if (digitos.length < 5 || !escrita) {
      await bcrypt.compare(escrita, HASH_DE_DESCARTE);
      return rechazar();
    }
    if (await claveBloqueada(digitos)) return res.status(423).json({ error: MENSAJE_BLOQUEO_CELULAR });

    // Solo cuentan los roles de botón. La cédula se compara normalizada (con puntos o ceros a la izquierda es la misma).
    const roles = soloCoordinador ? ['coordinador'] : ROLES_DE_BOTON;
    const [filas] = await pool.query(
      `SELECT u.*, r.nombre AS rol
         FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE r.nombre IN (?) AND ${sqlCedulaNormalizada('u.numero_identificacion')} = ?
        LIMIT 2`, [roles, normalizarCedula(digitos)]);
    // Dos cuentas con la misma cédula normalizada no es un dato válido (la cédula es única): ante la duda, nadie entra.
    let usuario = filas.length === 1 ? filas[0] : null;
    if (usuario && !usuario.activo) usuario = null;

    // Red de seguridad: si por cualquier camino cambió la cédula (o falta la clave), se recalcula ANTES de comparar —salvo que la persona haya elegido la suya—.
    if (usuario && (await sincronizarClaveCelular(pool, usuario.id)) === 'generada') {
      const [[renovado]] = await pool.query('SELECT clave_celular_hash FROM usuarios WHERE id = ?', [usuario.id]);
      usuario.clave_celular_hash = renovado.clave_celular_hash;
    }

    // 1) La clave del celular. Un hash de descarte cuando no hay a quién compararla: responder «no existe» cuesta lo mismo que «clave incorrecta».
    const seisDigitos = /^\d{6}$/.test(escrita);
    const valida = await bcrypt.compare(seisDigitos ? escrita : 'x', (usuario && usuario.clave_celular_hash) || HASH_DE_DESCARTE) && seisDigitos;
    // 2) LA CONTRASEÑA DE HOY (transición): solo mientras no haya contestado la pregunta del primer ingreso.
    const permiteAntigua = !soloCoordinador && !!usuario && Number(usuario.clave_celular_pregunta_hecha) === 0 && !!usuario.password_hash;   // el alias viejo de coordinadores no la admite
    let viaAntigua = false;
    if (!valida) viaAntigua = (await bcrypt.compare(escrita, permiteAntigua ? usuario.password_hash : HASH_DE_DESCARTE)) && permiteAntigua;

    if (!usuario || (!valida && !viaAntigua)) {
      const intentos = await contarFalloDeClave(digitos);
      if (usuario) {
        // En la bitácora va el número del intento, nunca la clave ni la cédula escrita.
        await registrarAuditoria(usuario.id, 'login_fallido',
          `Ingreso por el celular: clave incorrecta (intento ${intentos}/${MAX_INTENTOS}).`, req.ip);
        if (intentos >= MAX_INTENTOS) {
          await registrarAuditoria(usuario.id, 'bloqueo_cuenta',
            `Ingreso por el celular bloqueado ${BLOQUEO_MINUTOS} min por intentos fallidos.`, req.ip);
        }
      }
      // El quinto fallo ya dice «Demasiados intentos»: sale igual exista o no la cédula.
      if (intentos >= MAX_INTENTOS) return res.status(423).json({ error: MENSAJE_BLOQUEO_CELULAR });
      return rechazar();
    }

    // Entró: se borra el contador de esa cédula y se sigue el mismo camino que cualquier ingreso (sesión, token de cierre, bitácora).
    await pool.query('DELETE FROM ingresos_celular_intentos WHERE cedula = ?', [digitos]);
    await pool.query('UPDATE usuarios SET ultimo_login = NOW() WHERE id = ?', [usuario.id]);
    // Por esta puerta no rige el aviso «cambia tu clave» de la app (el de `password_hash`): aquí la clave tiene su propia pregunta, que la app hace al entrar.
    usuario.debe_cambiar_password = 0;
    // Marcas de ESTA sesión: entró por el botón (de ahí la pregunta del primer ingreso, sin pedir la clave actual) y, si fue con la contraseña de hoy, para explicárselo.
    req.session.puertaCelular = true;
    req.session.claveAntigua = !!viaAntigua;

    // Quien puede entrar con más de un sombrero (líder y además testigo) elige cuál, como en `POST /login` (y por esta puerta nunca entra como aspirante con sublicencia).
    if (['lider', 'sublider', 'aspirante_concejo'].includes(usuario.rol)) {
      const opciones = await capacidadesDe(usuario);
      if (opciones.length) {
        req.session.pendienteEleccionRol = { usuarioId: usuario.id, recordar: false, puerta: 'celular' };
        return res.json({ ok: true, requiereEleccionRol: true, nombre: usuario.nombre, opciones });
      }
    }
    await iniciar2faOCompletarSesion(req, res, usuario, false, null,
      `Ingreso por celular ${usuario.rol} (cédula terminada en ${finDeCedula(digitos) || '***'})`
        + (viaAntigua ? '; con su contraseña anterior (se le explicó la clave del celular)' : '')
        + (usuario.rol === 'coordinador' && usuario.two_factor_enabled ? '; sin código de verificación' : ''),
      { sinCodigo: usuario.rol === 'coordinador' });   // orden 62: el coordinador no pide código de verificación por aquí
  } catch (err) {
    console.error('Error en el ingreso por el celular:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo iniciar sesión. Intente de nuevo.' });
  }
}

router.post('/login-celular', limitadorIngresoCelular, (req, res) => entrarPorBoton(req, res));
// El de la Orden 59, para los celulares que todavía tengan la pantalla vieja en caché: solo coordinadores, sin la contraseña de hoy.
router.post('/login-coordinador', limitadorIngresoCelular, (req, res) => entrarPorBoton(req, res, { soloCoordinador: true }));

/** Continúa un inicio de sesión que quedó a la espera de "¿cómo quieres entrar?" (ver tieneDobleRolTestigo arriba). */
router.post('/elegir-rol', async (req, res) => {
  const pendiente = req.session.pendienteEleccionRol;
  const { entrarComo } = req.body;

  if (!pendiente) {
    return res.status(400).json({ error: 'No hay una elección de ingreso en curso. Inicia sesión de nuevo.' });
  }
  if (!['principal', 'testigo', 'aspirante'].includes(entrarComo)) {
    return res.status(400).json({ error: 'Elección inválida.' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT u.*, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`,
      [pendiente.usuarioId]
    );
    const usuario = rows[0];
    delete req.session.pendienteEleccionRol;
    // Entró por un botón del celular: ahí no rige el aviso «cambia tu clave» de la contraseña del computador (orden 66).
    if (usuario && pendiente.puerta === 'celular') usuario.debe_cambiar_password = 0;

    if (!usuario || !usuario.activo) {
      return res.status(401).json({ error: 'La cuenta ya no está disponible. Inicia sesión de nuevo.' });
    }

    // Se revalida la doble condición en el servidor: no basta con lo que
    // mande el cliente para conceder la capacidad de testigo.
    // Se revalida el sombrero contra la base: no basta con lo que mande el
    // navegador para concederse una capacidad.
    let entrarComoValidado = null;
    if (entrarComo === 'testigo' && await tieneDobleRolTestigo(usuario)) entrarComoValidado = 'testigo';
    if (entrarComo === 'aspirante') {
      const opciones = await capacidadesDe(usuario);
      if (opciones.some(o => o.valor === 'aspirante')) entrarComoValidado = 'aspirante';
    }

    await iniciar2faOCompletarSesion(req, res, usuario, pendiente.recordar, entrarComoValidado);
  } catch (err) {
    console.error('Error eligiendo rol de ingreso:', err);
    res.status(500).json({ error: 'Error interno al continuar el inicio de sesión.' });
  }
});

/**
 * Paso 1 de la torre: pide un código de un solo uso.
 *
 * SIEMPRE responde lo mismo, exista o no la cuenta, tenga o no el dato de
 * contacto pedido, y sea cual sea su rol. Cualquier diferencia —un error
 * distinto, incluso tardar más— convierte esta pantalla en un detector de
 * correos válidos. Por eso el trabajo real va después de responder... no:
 * va antes, pero su resultado no se refleja en la respuesta.
 *
 * El `identificador` no siempre es un correo: con el canal SMS la pantalla
 * pide el teléfono móvil, y acá se busca por él (ver abajo). Se acepta
 * igual el correo, para no bloquear a quien cambió de canal a mitad.
 *
 * OJO CON EL CANAL SMS: si la cuenta no tiene teléfono, no se manda nada y
 * la respuesta es igual de optimista. Es deliberado (no delatar), y tiene
 * un costo real: esa persona espera un mensaje que no va a llegar. Hoy el
 * administrador de las dos campañas NO tiene teléfono registrado.
 */
router.post('/solicitar-codigo', limitadorCodigo, async (req, res) => {
  const { identificador, canal, recordar } = req.body || {};
  const via = canal === 'sms' ? 'sms' : 'correo';
  const respuestaUnica = {
    ok: true,
    mensaje: via === 'sms'
      ? 'Si esa cuenta puede ingresar con código, le enviamos un mensaje de texto.'
      : 'Si esa cuenta puede ingresar con código, le enviamos un correo.'
  };

  if (!identificador || !String(identificador).trim()) {
    return res.status(400).json({
      error: via === 'sms'
        ? 'Escribe tu teléfono móvil.'
        : 'Escribe tu correo o nombre de usuario.'
    });
  }

  try {
    const buscado = String(identificador).trim().toLowerCase();

    // Con el canal SMS la pantalla pide el teléfono, no el correo. Se busca
    // por los últimos 10 dígitos porque `usuarios.telefono` es texto libre
    // (varchar(30)) y el mismo número está escrito de mil formas: con +57,
    // sin él, con espacios o guiones. Comparar la cadena tal cual no cruza.
    //
    // Si dos cuentas comparten teléfono, primero se DESEMPATA por rol: solo
    // admin, coordinador y asistente administrativo entran con código, y en la
    // práctica el número de un administrador suele estar además en su ficha de
    // líder o de votante. Medido el 13 de agosto de 2026 en la campaña
    // municipal: el teléfono del administrador estaba en dos cuentas —la suya
    // y una de líder—, así que la torre se detenía sin mandar nada y sin dejar
    // rastro, y desde afuera se veía igual que un SMS que no llega.
    //
    // Desempatar así NO revela nada de más: la respuesta al navegador es la
    // misma pase lo que pase. Si tras el filtro sigue habiendo más de una
    // cuenta con acceso, ahí sí no se manda: elegir "la primera" sería dejar
    // entrar a la cuenta equivocada, y eso es peor que no entrar.
    //
    // El LIMIT sube de 2 a 5 porque con dos filas no se puede desempatar: hay
    // que ver todas las candidatas para saber cuántas tienen acceso.
    let usuario = null;
    const digitos = buscado.replace(/\D/g, '');
    if (via === 'sms' && digitos.length >= 10) {
      const [porTelefono] = await pool.query(
        `SELECT u.*, r.nombre AS rol
           FROM usuarios u JOIN roles r ON r.id = u.rol_id
          WHERE u.telefono IS NOT NULL AND u.telefono <> ''
            AND RIGHT(REGEXP_REPLACE(u.telefono, '[^0-9]', ''), 10) = ?
          LIMIT 5`,
        [digitos.slice(-10)]
      );
      if (porTelefono.length > 1) {
        const conAcceso = porTelefono.filter(u => u.activo && ROLES_CON_CODIGO.includes(u.rol));
        if (conAcceso.length !== 1) {
          // Se registra POR DENTRO, que es lo que faltaba: quien administra
          // necesita poder saber por qué no salió el mensaje. La respuesta al
          // navegador no cambia, así que no se filtra nada.
          await registrarAuditoria(null, 'codigo_acceso_no_enviado',
            `El teléfono terminado en ${digitos.slice(-4)} está en ${porTelefono.length} cuentas y `
            + `${conAcceso.length} pueden entrar con código: no se envió nada.`, req.ip);
          return res.json(respuestaUnica);
        }
        usuario = conAcceso[0];
      } else {
        usuario = porTelefono[0] || null;
      }
    }

    // Sigue valiendo escribir el correo aunque el canal sea SMS: quien ya lo
    // tenía escrito y cambió de canal no queda bloqueado.
    if (!usuario) {
      const [rows] = await pool.query(
        `SELECT u.*, r.nombre AS rol
           FROM usuarios u JOIN roles r ON r.id = u.rol_id
          WHERE u.email = ? OR u.nombre_usuario = ? LIMIT 1`,
        [buscado, buscado]
      );
      usuario = rows[0];
    }

    const puede = usuario && usuario.activo && ROLES_CON_CODIGO.includes(usuario.rol);
    const destino = !puede ? null : (via === 'sms' ? usuario.telefono : usuario.email);
    if (!destino) {
      // Misma respuesta de siempre hacia afuera, pero adentro queda el motivo:
      // sin esto, «no me llega el código» no se puede diagnosticar sin leer el
      // registro del proceso, al que el administrador no tiene acceso.
      const motivo = !usuario ? 'no hay ninguna cuenta con ese identificador'
        : !usuario.activo ? 'la cuenta está inactiva'
        : !ROLES_CON_CODIGO.includes(usuario.rol) ? `el rol ${usuario.rol} no entra con código`
        : via === 'sms' ? 'la cuenta no tiene teléfono registrado'
        : 'la cuenta no tiene correo registrado';
      await registrarAuditoria(usuario ? usuario.id : null, 'codigo_acceso_no_enviado',
        `Solicitud por ${via}: ${motivo}.`, req.ip);
      return res.json(respuestaUnica);
    }

    const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const codigoHash = crypto.createHash('sha256').update(codigo).digest('hex');
    const expiraEn = new Date(Date.now() + CODIGO_2FA_MINUTOS * 60 * 1000);
    await pool.query(
      `INSERT INTO two_factor_codes (usuario_id, codigo_hash, expira_en) VALUES (?, ?, ?)`,
      [usuario.id, codigoHash, expiraEn]
    );

    // La sesión recuerda a quién pertenece el código. El navegador nunca
    // recibe el usuario_id: si lo mandara él en el paso 2, bastaría con
    // cambiarlo para pedir el código de una cuenta y validar el de otra.
    /* SE ANOTA POR QUE PUERTA ENTRO, y de eso depende con que sombrero sale.
       LA PUERTA DECIDE EL SOMBRERO. Quien entra por aqui —correo o celular y
       codigo— entra como aspirante si tiene sublicencia activa. Quien entra
       con su numero de identificacion y su clave entra como lider, siempre.
       Antes se le preguntaba, y preguntar sobra cuando la respuesta ya esta en
       la puerta que la persona eligio: son dos formularios distintos.
       Lo decide el SERVIDOR con este dato de sesion, no el navegador: si el
       sombrero viajara en el cuerpo, cualquiera pediria el de aspirante. */
    req.session.pendiente2fa = { usuarioId: usuario.id, recordar: !!recordar, entrarComo: null, via: 'torre' };

    // El canal pedido y, solo para el superadministrador, Telegram — en
    // paralelo. Un fallo de entrega SÍ se registra en el servidor, pero no
    // cambia la respuesta: si dijéramos "no se pudo enviar", habríamos
    // confirmado que la cuenta existe. (Telegram se registra solo, en
    // config/telegram.js.)
    const principal = (async () => {
      if (via === 'sms') {
        // `operativo: true`: el código de acceso es un mensaje de la
        // aplicación a su propio equipo, no mensajería de campaña, así que no
        // lo detiene la lista de baja — quien pidió no recibir propaganda
        // sigue necesitando entrar a su cuenta. Sí consume crédito: cuesta
        // igual que cualquier otro SMS.
        await smsSvc.enviarSMS(
          destino,
          `Su codigo de acceso es ${codigo}. Vence en ${CODIGO_2FA_MINUTOS} minutos.`,
          null,
          { origen: 'acceso', operativo: true, usuarioId: usuario.id }
        );
      } else {
        await enviarCodigo2FA(destino, codigo);
      }
    })();
    const telegram = avisarCodigoPorTelegram(usuario, codigo);
    const [resPrincipal] = await Promise.allSettled(telegram ? [principal, telegram] : [principal]);
    if (resPrincipal.status === 'rejected') {
      const motivo = resPrincipal.reason;
      console.error(`Error enviando código de acceso por ${via}:`, motivo && motivo.message);
    }

    await registrarAuditoria(usuario.id, 'solicitar_codigo_acceso', `Código de acceso solicitado por ${via}.`, req.ip);
    return res.json(respuestaUnica);
  } catch (err) {
    console.error('Error solicitando código de acceso:', err);
    return res.json(respuestaUnica);
  }
});

router.post('/verificar-2fa', async (req, res) => {
  const { codigo } = req.body;
  const pendiente = req.session.pendiente2fa;

  if (!pendiente) {
    return res.status(400).json({ error: 'No hay una verificación en curso. Inicia sesión de nuevo.' });
  }
  if (!codigo) {
    return res.status(400).json({ error: 'Ingresa el código recibido por correo.' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT * FROM two_factor_codes
       WHERE usuario_id = ? AND usado = 0 AND expira_en > NOW()
       ORDER BY id DESC LIMIT 1`,
      [pendiente.usuarioId]
    );

    if (rows.length === 0) {
      delete req.session.pendiente2fa;
      return res.status(400).json({ error: 'El código expiró. Inicia sesión de nuevo para recibir uno nuevo.' });
    }

    const registro = rows[0];

    if (registro.intentos >= MAX_INTENTOS_2FA) {
      delete req.session.pendiente2fa;
      return res.status(429).json({ error: 'Demasiados intentos. Inicia sesión de nuevo para recibir un código nuevo.' });
    }

    const codigoHash = crypto.createHash('sha256').update(String(codigo).trim()).digest('hex');

    if (codigoHash !== registro.codigo_hash) {
      await pool.query(`UPDATE two_factor_codes SET intentos = intentos + 1 WHERE id = ?`, [registro.id]);
      await registrarAuditoria(pendiente.usuarioId, 'verificar_2fa_fallido', 'Código de verificación incorrecto.', req.ip);
      return res.status(401).json({ error: 'Código incorrecto.' });
    }

    await pool.query(`UPDATE two_factor_codes SET usado = 1 WHERE id = ?`, [registro.id]);

    const [usuarioRows] = await pool.query(
      `SELECT u.*, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`,
      [pendiente.usuarioId]
    );
    const usuario = usuarioRows[0];

    /* El sombrero se deduce de la puerta, no se pregunta. Solo cuando la
       sublicencia existe y esta activa: sin ella no hay panel de aspirante que
       mostrar —su nombre, su lema y su logo viven en esa fila— y mandarlo alla
       le daria el panel de la campaña madre SIN acotar, porque el filtro de
       rama cuelga justamente de `req.sublicencia`. */
    let entrarComoFinal = pendiente.entrarComo;
    if (pendiente.via === 'torre' && !entrarComoFinal) {
      try {
        const [f] = await pool.query(
          'SELECT 1 FROM sublicencias WHERE usuario_id = ? AND activa = 1 LIMIT 1', [usuario.id]);
        if (f.length) entrarComoFinal = 'aspirante';
      } catch (err) {
        if (err.code !== 'ER_NO_SUCH_TABLE') console.error('Leyendo sublicencia en la torre:', err.message);
      }
    }

    // Entró por un botón del celular (y tenía activada la verificación en dos pasos): tampoco aquí rige el aviso «cambia tu clave» del computador (orden 66).
    if (req.session.puertaCelular) usuario.debe_cambiar_password = 0;
    const dispositivoToken = await completarSesion(req, usuario, pendiente.recordar, entrarComoFinal);
    delete req.session.pendiente2fa;

    await registrarAuditoria(
      usuario.id,
      'login',
      `Inicio de sesión (2FA): ${usuario.email}` + (pendiente.entrarComo === 'testigo' ? ' (como testigo electoral)' : ''),
      req.ip
    );

    res.json({ ok: true, usuario: req.session.usuario, dispositivoToken, tokenCierre: req.tokenCierreNuevo || null });
  } catch (err) {
    console.error('Error verificando 2FA:', err);
    res.status(500).json({ error: 'Error interno al verificar el código.' });
  }
});

router.put('/2fa', requireAuth, async (req, res) => {
  const { activar, password } = req.body;
  try {
    // EL SUPERADMINISTRADOR NO PUEDE APAGARLO. Es la cuenta con control total y
    // entra siempre con código (init-db lo vuelve a encender en cada corrida).
    // Va ANTES de pedir la contraseña: con contraseña correcta tampoco se
    // apaga, así que pedirla solo sería hacer el rechazo más lento. Encenderlo
    // sigue permitido. `esSuperadmin` consulta la base, no la sesión (ver /me).
    if (!activar && await esSuperadmin(req.session.usuario)) {
      return res.status(400).json({ error: ERROR_2FA_OBLIGATORIO });
    }

    // APAGARLO EXIGE LA CONTRASEÑA; encenderlo no.
    //
    // No es simetría por gusto: quien se haga con una sesión ajena —una cookie
    // robada, un token de dispositivo copiado del localStorage— podía quitarle
    // el segundo factor a esa cuenta y consolidar el acceso sin saber ni la
    // contraseña. Encenderlo no tiene ese riesgo: solo añade una traba.
    if (!activar) {
      const [[fila]] = await pool.query('SELECT password_hash FROM usuarios WHERE id = ?', [req.session.usuario.id]);
      const valida = fila && await bcrypt.compare(password || '', fila.password_hash);
      if (!valida) {
        return res.status(400).json({ error: 'Para desactivar la verificación en dos pasos, escriba su contraseña actual.' });
      }
    }
    await pool.query(`UPDATE usuarios SET two_factor_enabled = ? WHERE id = ?`, [activar ? 1 : 0, req.session.usuario.id]);
    req.session.usuario.two_factor_enabled = !!activar;
    await registrarAuditoria(
      req.session.usuario.id,
      'toggle_2fa',
      `Doble autenticación ${activar ? 'activada' : 'desactivada'} por el propio usuario.`,
      req.ip
    );
    res.json({ ok: true, two_factor_enabled: req.session.usuario.two_factor_enabled });
  } catch (err) {
    console.error('Error activando/desactivando 2FA:', err);
    res.status(500).json({ error: 'Error interno al actualizar la configuración de 2FA.' });
  }
});

/**
 * CERRAR LA SESIÓN QUE QUEDÓ PENDIENTE (parche 329). PÚBLICA a propósito y EXENTA de CSRF (middleware/csrf.js): quien la llama es un celular que
 * cerró sesión sin señal y ya no tiene una sesión válida con qué pedirlo; lo que lo autoriza es el token de cierre, que solo conoce ese navegador
 * y del que el servidor guarda únicamente el hash. Tiene LÍMITE de consultas por IP (adivinar un token de 32 bytes no es posible, pero esta ruta
 * no debe servir para martillar la base). Y RESPONDE IGUAL exista o no el token: no dice si adivinaste.
 */
const limiteCerrarPendiente = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ ok: false, error: 'Demasiados intentos. Espera unos minutos.' }),
});
router.post('/cerrar-pendiente', limiteCerrarPendiente, async (req, res) => {
  const token = String((req.body && req.body.tokenCierre) || '');
  try {
    if (/^[A-Za-z0-9_-]{20,128}$/.test(token)) {
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const [[fila]] = await pool.query('SELECT session_id FROM sesiones_cierre WHERE token_hash = ?', [hash]);
      if (fila) {
        await pool.query('DELETE FROM sesiones_cierre WHERE token_hash = ?', [hash]);
        if (req.sessionID === fila.session_id) {
          // Es la propia cookie de esta petición: se destruye y se pide al navegador que la suelte.
          await new Promise((ok) => req.session.destroy(() => ok()));
          res.clearCookie('campana_sid');
        } else {
          await new Promise((ok) => req.sessionStore.destroy(fila.session_id, () => ok()));
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') console.error('cerrar-pendiente:', err.code || err.message);
  }
  res.json({ ok: true });
});

router.post('/logout', requireAuth, async (req, res) => {
  const usuarioId = req.session.usuario.id;
  await registrarAuditoria(usuarioId, 'logout', 'Cierre de sesión.', req.ip);
  // El token de cierre de esta sesión ya no hace falta (se cierra ahora mismo).
  try { await pool.query('DELETE FROM sesiones_cierre WHERE session_id = ?', [req.sessionID]); } catch (_) { /* tabla aún sin crear */ }
  req.session.destroy(() => {
    res.clearCookie('campana_sid');
    res.json({ ok: true });
  });
});

/**
 * Comprueba la contraseña de quien está usando la aplicación, sin hacer nada
 * más.
 *
 * PARA QUÉ. Las acciones sobre una cuenta ajena se confirman con la clave
 * propia (ver confirmarConSuPassword en routes/usuarios.routes.js). En las
 * que se resuelven de un clic eso basta: se pide, se manda, se ejecuta. Pero
 * «Editar» abre un formulario, y pedir la clave al GUARDAR significa
 * descubrir que estaba mal después de haberlo llenado entero. Con esto se
 * pregunta al abrir y el formulario solo aparece si la clave era correcta.
 *
 * NO SUSTITUYE LA COMPROBACIÓN DE LA ACCIÓN, LA ADELANTA. El PUT sigue
 * exigiendo `password_confirmacion` por su cuenta: esta ruta la llama el
 * navegador, y lo que el navegador diga no es una autorización. Quien llame
 * al PUT directamente se topa con la misma comprobación de siempre.
 *
 * EL LIMITADOR NO ES DECORACIÓN. Esta ruta dice sí o no sobre una contraseña,
 * o sea que es un oráculo: sin freno, quien se siente en una sesión ajena
 * abierta —el riesgo exacto que esta función existe para cerrar— podría
 * probar claves hasta dar con la del dueño. Cinco por cuarto de hora deja
 * pasar los errores de tecleo y no mucho más.
 *
 * PERO SOLO CUENTAN LOS INTENTOS FALLIDOS (`skipSuccessfulRequests`).
 *
 * Lo que este freno persigue es ADIVINAR, y una contraseña correcta no es un
 * intento de adivinarla. Contando también los aciertos, el límite lo agota
 * quien trabaja bien: desde que Estructura y Votantes confirman fila por fila
 * —52 y 102 registros en la campaña de prueba—, editar seis personas en un
 * cuarto de hora dejaba a la persona fuera con «Demasiados intentos» habiendo
 * escrito su clave bien las seis veces. Y el mensaje la manda a esperar sin
 * decirle por qué, porque desde su lado no hizo nada mal.
 *
 * Con la bandera, cinco EQUIVOCACIONES siguen cerrando la puerta igual que
 * antes; los aciertos ya no gastan cupo. El oráculo sigue frenado: quien
 * prueba claves ajenas falla, y fallar es lo que se cuenta.
 */
const limitadorVerificarPassword = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos antes de volver a intentar.' }
});

router.post('/verificar-password', requireAuth, limitadorVerificarPassword, async (req, res) => {
  const ok = await verificarPasswordPropia(req.session.usuario.id, req.body && req.body.password);
  if (!ok) return res.status(403).json({ error: 'Contraseña incorrecta. Escribe la suya para confirmar.' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  /*
   * `es_superadmin` SE CONSULTA, NO SE LEE DE LA SESIÓN.
   *
   * La sesión se guarda en la tabla `sessions` y con «Recordarme» dura
   * siete días. Si la bandera viviera dentro de ella, una cuenta recién
   * elevada seguiría viéndose como un administrador corriente hasta que su
   * dueño cerrara sesión y volviera a entrar — y al revés, una sesión vieja
   * seguiría diciendo «superadministrador» después de habérselo quitado.
   *
   * Preguntándolo aquí (config/superadmin.js cachea la respuesta 30
   * segundos) el cambio vale desde la petición siguiente, sin obligar a
   * nadie a volver a entrar.
   */
  /* `es_aspirante` TAMBIÉN SE CONSULTA, Y POR LO MISMO. Se anota en la sesión
     al entrar —ahí hace falta, para decidir a dónde va— pero una sesión de
     siete días seguiría diciendo «aspirante» después de suspenderle la
     sublicencia. Preguntándolo aquí, suspenderla surte efecto en la petición
     siguiente. */
  let esAspirante = false;
  if (req.session.usuario.es_aspirante) {
    // Entro con ese sombrero; queda comprobar que la sublicencia SIGUE activa.
    try {
      const [f] = await pool.query(
        'SELECT 1 FROM sublicencias WHERE usuario_id = ? AND activa = 1 LIMIT 1',
        [req.session.usuario.id]);
      esAspirante = f.length > 0;
    } catch (err) {
      if (err.code !== 'ER_NO_SUCH_TABLE') console.error('Leyendo sublicencia en /me:', err.message);
    }
  }

  /* DOS COSAS DISTINTAS QUE SE LLAMAN «ASPIRANTE», Y CONVIENE NO MEZCLARLAS.
   *
   *   es_aspirante          -> entró CON EL SOMBRERO de aspirante y su
   *                            sublicencia sigue activa. Es de LICENCIA: decide
   *                            a qué pantallas llega y qué ve del panel.
   *   es_aspirante_concejo  -> en la Estructura de esta campaña su categoría es
   *                            Aspirante al Concejo. Es de JERARQUÍA: decide a
   *                            quién manda y a quién registra.
   *
   * Se pueden dar por separado, y de hecho se dan: alguien marcado en la
   * estructura sin sublicencia vendida, o al revés. La app del celular
   * necesita la SEGUNDA —el rótulo del botón habla de jerarquía, no de
   * licencia— y hasta ahora miraba la primera, que en esa pantalla es siempre
   * falsa: quien tiene sublicencia activa ni siquiera llega ahí, lo desvía
   * app-comun.js al panel. Un rótulo condicionado a algo que no puede ocurrir
   * nunca es un rótulo que no cambia. */
  let esAspiranteConcejo = false;
  try {
    const [[fila]] = await pool.query(
      /* DOS FORMAS DE SERLO, Y LAS DOS VALEN.
         El ROL es lo que se le asigna en Editar usuario y manda; la CATEGORIA
         (tipo_cargo) es como se marcaba antes de que el rol existiera, y sigue
         viva en las fichas ya creadas. Mirar solo una dejaria fuera a la mitad
         de la gente segun cuando se la registro. */
      `SELECT 1 AS ok FROM usuarios u
         LEFT JOIN roles r ON r.id = u.rol_id
         LEFT JOIN estructura e ON e.usuario_id = u.id AND e.cargo = 'lider'
        WHERE u.id = ?
          AND (r.nombre = 'aspirante_concejo'
               OR (e.id IS NOT NULL AND u.tipo_cargo = 'aspirante_concejo'))
        LIMIT 1`,
      [req.session.usuario.id]);
    esAspiranteConcejo = !!fila;
  } catch (err) {
    console.error('Leyendo categoría de estructura en /me:', err.message);
  }

  /* LA CLAVE DEL CELULAR (orden 66). `pregunta` = esta sesión entró por un botón del celular y a la persona todavía no se le ha preguntado si quiere cambiar la
     clave por defecto: la app muestra la pantalla de la pregunta antes del inicio. Se CONSULTA (no se lee de la sesión): contestarla vale desde la petición siguiente. */
  let claveCelular = null;
  if (req.session.puertaCelular && esRolDeBoton(req.session.usuario.rol_real || req.session.usuario.rol)) {
    try {
      const [[f]] = await pool.query('SELECT clave_celular_pregunta_hecha AS hecha FROM usuarios WHERE id = ?', [req.session.usuario.id]);
      if (f) claveCelular = { pregunta: Number(f.hecha) === 0, desde_clave_anterior: !!req.session.claveAntigua };
    } catch (err) {
      if (err.code !== 'ER_BAD_FIELD_ERROR') console.error('Leyendo la clave del celular en /me:', err.code || err.message);
    }
  }

  res.json({
    usuario: {
      ...req.session.usuario,
      es_superadmin: await esSuperadmin(req.session.usuario),
      es_aspirante: esAspirante,
      es_aspirante_concejo: esAspiranteConcejo,
      es_candidato: await esAdminCandidato(req.session.usuario),   // se CONSULTA, no se lee de la sesión: quitarle la marca vale desde la petición siguiente
      clave_celular: claveCelular,
      puerta_celular: req.session.puertaCelular === true,   // orden 83: entró por el botón del celular (cédula + clave); el coordinador de esa sesión solo agrega líderes
    }
  });
});

router.post('/cambiar-password', requireAuth, async (req, res) => {
  const { passwordActual, passwordNueva } = req.body;

  /* ORDEN 90: LA CONTRASEÑA ES DE EXACTAMENTE 6 NÚMEROS, para todos los roles (antes valían 6 cifras o 8 caracteres o más). Una contraseña larga ya no se
     acepta al CAMBIAR; las que ya existen siguen entrando (el ingreso no mira el largo). */
  const nueva = String(passwordNueva == null ? '' : passwordNueva);
  if (!clave6.esContrasenaValida(nueva)) {
    return res.status(400).json({ error: clave6.MENSAJE });
  }
  // 123456 y 000000 son las dos primeras que prueba cualquiera.
  if (/^(\d)\1{5}$/.test(nueva) || nueva === '123456' || nueva === '654321') {
    return res.status(400).json({ error: 'Ese número es demasiado fácil de adivinar. Elige otro de 6 cifras.' });
  }
  try {
    const [rows] = await pool.query(`SELECT password_hash FROM usuarios WHERE id = ?`, [req.session.usuario.id]);
    const valido = await bcrypt.compare(passwordActual || '', rows[0].password_hash);
    if (!valido) {
      // 400, no 401: un 401 aquí lo interpreta el helper api() del
      // frontend como "sesión vencida" y redirige a login.html borrando
      // el mensaje de error, en vez de mostrarlo en el propio formulario.
      return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
    }
    const nuevoHash = await bcrypt.hash(nueva, 12);
    await pool.query(
      `UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 0, password_temporal_expira = NULL WHERE id = ?`,
      [nuevoHash, req.session.usuario.id]
    );
    req.session.usuario.debe_cambiar_password = false;
    await registrarAuditoria(req.session.usuario.id, 'cambio_password', 'Cambio voluntario de contraseña.', req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error cambiando contraseña:', err);
    res.status(500).json({ error: 'Error interno al cambiar la contraseña.' });
  }
});

/* ---------------------------------------------------------------------------
   LA CLAVE DEL CELULAR: pregunta del primer ingreso y «Cambiar mi clave» (orden 66). Solo para la PROPIA sesión y solo para los roles de botón. No tocan `password_hash`.
   Los errores de validación salen con 400 (no 401: el helper api() de la app lo tomaría por «sesión vencida» y redirigiría al ingreso, borrando el mensaje).
   --------------------------------------------------------------------------- */
function claveCelularDeLaSesion(req, res) {
  const u = req.session.usuario;
  if (!esRolDeBoton(u.rol_real || u.rol)) {
    res.status(403).json({ error: 'Esta cuenta no tiene clave del celular.' });
    return null;
  }
  return u;
}

/** Valida la clave nueva y su repetición. Devuelve el mensaje si no sirve (sin la clave dentro), o null. */
function problemaDeNuevaYRepetida(nueva, repetir) {
  if (String(nueva == null ? '' : nueva) !== String(repetir == null ? '' : repetir)) return 'La clave nueva y su repetición no son iguales.';
  return problemaDeClaveNueva(nueva);
}

/** La pregunta del primer ingreso: «dejar» la de por omisión o «cambiar» (sin pedir la clave actual: acaba de entrar con ella por el botón). */
router.post('/clave-celular/primera', requireAuth, async (req, res) => {
  const u = claveCelularDeLaSesion(req, res);
  if (!u) return;
  try {
    // Sin la clave actual SOLO si esta sesión entró por el botón: una sesión que entró por otro camino no puede saltarse ese paso (usa «Cambiar mi clave»).
    if (!req.session.puertaCelular) return res.status(403).json({ error: 'Para cambiar su clave use la opción «Cambiar mi clave» del menú.' });
    const [[f]] = await pool.query('SELECT clave_celular_pregunta_hecha AS hecha FROM usuarios WHERE id = ?', [u.id]);
    if (!f || Number(f.hecha) === 1) return res.status(409).json({ error: 'Esa pregunta ya la contestó.' });
    const accion = req.body && req.body.accion;
    if (accion === 'dejar') {
      await pool.query('UPDATE usuarios SET clave_celular_pregunta_hecha = 1 WHERE id = ?', [u.id]);
      delete req.session.claveAntigua;
      await registrarAuditoria(u.id, 'clave_celular', 'Dejó la clave del celular por omisión (los últimos 6 dígitos de su cédula).', req.ip);
      return res.json({ ok: true, cambiada: false });
    }
    if (accion === 'cambiar') {
      const problema = problemaDeNuevaYRepetida(req.body.nueva, req.body.repetir);
      if (problema) return res.status(400).json({ error: problema });
      await fijarClaveCelular(pool, u.id, req.body.nueva);
      delete req.session.claveAntigua;
      await registrarAuditoria(u.id, 'clave_celular', 'Cambió su clave del celular (primer ingreso).', req.ip);
      return res.json({ ok: true, cambiada: true });
    }
    res.status(400).json({ error: 'Elija «Cambiar mi clave» o «Dejar la que tengo».' });
  } catch (err) {
    console.error('Error en la pregunta de la clave del celular:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo guardar. Intente de nuevo.' });
  }
});

/** «Cambiar mi clave» desde el menú: pide la clave ACTUAL (con su límite 5/15, aparte del ingreso) y la nueva dos veces. La sesión actual sigue abierta. */
router.post('/cambiar-clave-celular', requireAuth, async (req, res) => {
  const u = claveCelularDeLaSesion(req, res);
  if (!u) return;
  try {
    const { actual, nueva, repetir } = req.body || {};
    const problema = problemaDeNuevaYRepetida(nueva, repetir);
    if (problema) return res.status(400).json({ error: problema });
    if (!/^\d{6}$/.test(String(actual == null ? '' : actual))) return res.status(400).json({ error: 'La clave actual debe tener 6 dígitos numéricos.' });

    const limite = `cc${u.id}`;                       // el límite de la clave actual es por persona y no se mezcla con el del ingreso
    if (await claveBloqueada(limite)) return res.status(423).json({ error: MENSAJE_BLOQUEO_CELULAR });
    await sincronizarClaveCelular(pool, u.id);        // por si todavía no tenía (un alta que no pasó por el gancho): se calcula la de por omisión
    const [[f]] = await pool.query('SELECT clave_celular_hash AS hash FROM usuarios WHERE id = ?', [u.id]);
    const buena = await bcrypt.compare(String(actual), (f && f.hash) || HASH_DE_DESCARTE) && !!(f && f.hash);
    if (!buena) {
      const intentos = await contarFalloDeClave(limite);
      await registrarAuditoria(u.id, 'clave_celular_fallida', `Clave actual incorrecta al cambiar la clave del celular (intento ${intentos}/${MAX_INTENTOS}).`, req.ip);
      if (intentos >= MAX_INTENTOS) return res.status(423).json({ error: MENSAJE_BLOQUEO_CELULAR });
      return res.status(400).json({ error: 'La clave actual no es correcta.' });
    }
    await pool.query('DELETE FROM ingresos_celular_intentos WHERE cedula = ?', [limite]);
    await fijarClaveCelular(pool, u.id, nueva);
    delete req.session.claveAntigua;
    await registrarAuditoria(u.id, 'clave_celular', 'Cambió su clave del celular.', req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error cambiando la clave del celular:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo cambiar la clave. Intente de nuevo.' });
  }
});

// --- Recuperación de contraseña por correo ---

// El MISMO limitador de /solicitar-codigo: 5 cada 15 minutos por IP. Sin él,
// esta pantalla es una forma gratuita de llenarle el buzón a cualquiera y de
// quemar la cuota del servidor de correo — y en este proyecto un SMTP caído
// deja además sin recuperación a todo el mundo.
router.post('/olvidar-password', limitadorCodigo, async (req, res) => {
  const { email } = req.body;
  // Respuesta genérica siempre, exista o no la cuenta, para no revelar
  // qué correos están registrados en el sistema.
  const respuestaGenerica = {
    ok: true,
    mensaje: 'Si el correo está registrado, en unos minutos recibirás un enlace para restablecer tu contraseña.'
  };

  if (!email) return res.json(respuestaGenerica);

  try {
    const [rows] = await pool.query(
      `SELECT id, email FROM usuarios WHERE email = ? AND activo = 1 LIMIT 1`,
      [email.trim().toLowerCase()]
    );

    if (rows.length > 0) {
      const usuario = rows[0];
      const tokenPlano = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(tokenPlano).digest('hex');
      const expiraEn = new Date(Date.now() + RESET_TOKEN_HORAS * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO password_resets (usuario_id, token_hash, expira_en) VALUES (?, ?, ?)`,
        [usuario.id, tokenHash, expiraEn]
      );

      // EL DOMINIO SALE DE LA CONFIGURACIÓN, NO DE LA PETICIÓN. `req.get('host')`
      // es una cabecera que manda el cliente: quien pudiera colarla haría que
      // la víctima recibiera por correo un enlace legítimo, con un token
      // válido, apuntando a un servidor ajeno. Hoy Nginx lo impide
      // —comprobado: responde 421 a un Host que no coincide—, pero esa
      // protección vive fuera del repositorio y un cambio de vhost la quita
      // sin que nada avise. LICENCIA_DOMINIO es el mismo dato, y no viaja en
      // la petición. Es lo que ya hace config/bajaContacto.js.
      const baseUrl = process.env.LICENCIA_DOMINIO
        ? `https://${process.env.LICENCIA_DOMINIO}`
        : `${req.protocol}://${req.get('host')}`;
      const enlace = `${baseUrl}/reset-password.html?token=${tokenPlano}`;

      try {
        await enviarCorreoRecuperacion(usuario.email, enlace);
      } catch (mailErr) {
        console.error('Error enviando correo de recuperación:', mailErr);
        // No revelamos el error de envío al cliente; se registra en el servidor.
      }
    }

    res.json(respuestaGenerica);
  } catch (err) {
    console.error('Error en /olvidar-password:', err);
    res.json(respuestaGenerica);
  }
});

router.post('/resetear-password', async (req, res) => {
  const { token, nuevaPassword } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Token inválido.' });
  }
  if (!clave6.esContrasenaValida(nuevaPassword)) {
    return res.status(400).json({ error: clave6.MENSAJE });   // orden 90
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const [rows] = await pool.query(
      `SELECT id, usuario_id FROM password_resets
       WHERE token_hash = ? AND usado = 0 AND expira_en > NOW() LIMIT 1`,
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'El enlace no es válido o ya expiró. Solicita uno nuevo.' });
    }

    const reset = rows[0];
    const nuevoHash = await bcrypt.hash(nuevaPassword, 12);

    await pool.query(
      `UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 0, intentos_fallidos = 0,
              bloqueado_hasta = NULL, password_temporal_expira = NULL WHERE id = ?`,
      [nuevoHash, reset.usuario_id]
    );
    await pool.query(`UPDATE password_resets SET usado = 1 WHERE id = ?`, [reset.id]);

    await registrarAuditoria(reset.usuario_id, 'reset_password', 'Contraseña restablecida vía correo.', req.ip);

    res.json({ ok: true });
  } catch (err) {
    console.error('Error en /resetear-password:', err);
    res.status(500).json({ error: 'Error interno al restablecer la contraseña.' });
  }
});

module.exports = router;
