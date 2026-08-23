const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const { enviarCorreoRecuperacion, enviarCodigo2FA } = require('../config/mailer');
const smsSvc = require('../config/sms');
const { firmarTokenDispositivo } = require('../config/tokenDispositivo');

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
const ROLES_CON_CODIGO = ['admin', 'coordinador', 'asistente_administrativo'];

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
  message: { error: 'Demasiadas solicitudes de código. Espere unos minutos antes de volver a intentar.' }
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
function completarSesion(req, usuario, recordar, entrarComo) {
  const rolEfectivo = entrarComo === 'testigo' ? 'testigo' : usuario.rol;
  req.session.usuario = {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: rolEfectivo,
    territorio_id: usuario.territorio_id,
    debe_cambiar_password: !!usuario.debe_cambiar_password,
    two_factor_enabled: !!usuario.two_factor_enabled
  };
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
  if (!['lider', 'sublider'].includes(usuario.rol)) return false;
  const [[fila]] = await pool.query(
    `SELECT 1 FROM estructura WHERE usuario_id = ? AND cargo = 'testigo' LIMIT 1`,
    [usuario.id]
  );
  return !!fila;
}

/** Cola del 2FA (si está activado) o cierra el inicio de sesión de una vez — usado tanto por /login como por /elegir-rol, ya que a partir de ese punto ambos siguen exactamente el mismo camino. */
async function iniciar2faOCompletarSesion(req, res, usuario, recordar, entrarComo) {
  if (usuario.two_factor_enabled) {
    const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const codigoHash = crypto.createHash('sha256').update(codigo).digest('hex');
    const expiraEn = new Date(Date.now() + CODIGO_2FA_MINUTOS * 60 * 1000);

    await pool.query(
      `INSERT INTO two_factor_codes (usuario_id, codigo_hash, expira_en) VALUES (?, ?, ?)`,
      [usuario.id, codigoHash, expiraEn]
    );

    req.session.pendiente2fa = { usuarioId: usuario.id, recordar: !!recordar, entrarComo: entrarComo || null };

    try {
      await enviarCodigo2FA(usuario.email, codigo);
    } catch (mailErr) {
      console.error('Error enviando código 2FA:', mailErr);
      res.status(500).json({ error: 'No se pudo enviar el código de verificación. Intente de nuevo en unos minutos.' });
      return;
    }

    res.json({ ok: true, requiere2fa: true });
    return;
  }

  const dispositivoToken = completarSesion(req, usuario, recordar, entrarComo);
  await registrarAuditoria(
    usuario.id,
    'login',
    `Inicio de sesión: ${usuario.email}` + (entrarComo === 'testigo' ? ' (como testigo electoral)' : ''),
    req.ip
  );
  res.json({ ok: true, usuario: req.session.usuario, dispositivoToken });
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
    const [rows] = await pool.query(
      `SELECT u.*, r.nombre AS rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
       WHERE u.email = ? OR u.nombre_usuario = ? LIMIT 1`,
      [identificador, identificador]
    );

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
        error: `Cuenta bloqueada temporalmente por intentos fallidos. Intente de nuevo después de ${new Date(usuario.bloqueado_hasta).toLocaleTimeString('es-CO')}.`
      });
    }

    if (!usuario.activo) {
      return res.status(403).json({ error: 'Su cuenta se encuentra inactiva. Contacte al administrador.' });
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
        error: 'Ese código de acceso ya venció. Pídale al administrador de la campaña que se lo envíe de nuevo.'
      });
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
    const { entrarComo } = req.body;
    if (!entrarComo && await tieneDobleRolTestigo(usuario)) {
      req.session.pendienteEleccionRol = { usuarioId: usuario.id, recordar: !!recordar };
      return res.json({ ok: true, requiereEleccionRol: true, nombre: usuario.nombre });
    }

    await iniciar2faOCompletarSesion(req, res, usuario, recordar, entrarComo);
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno al iniciar sesión.' });
  }
});

/** Continúa un inicio de sesión que quedó a la espera de "¿cómo quieres entrar?" (ver tieneDobleRolTestigo arriba). */
router.post('/elegir-rol', async (req, res) => {
  const pendiente = req.session.pendienteEleccionRol;
  const { entrarComo } = req.body;

  if (!pendiente) {
    return res.status(400).json({ error: 'No hay una elección de ingreso en curso. Inicie sesión de nuevo.' });
  }
  if (!['principal', 'testigo'].includes(entrarComo)) {
    return res.status(400).json({ error: 'Elección inválida.' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT u.*, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`,
      [pendiente.usuarioId]
    );
    const usuario = rows[0];
    delete req.session.pendienteEleccionRol;

    if (!usuario || !usuario.activo) {
      return res.status(401).json({ error: 'La cuenta ya no está disponible. Inicie sesión de nuevo.' });
    }

    // Se revalida la doble condición en el servidor: no basta con lo que
    // mande el cliente para conceder la capacidad de testigo.
    const entrarComoValidado = (entrarComo === 'testigo' && await tieneDobleRolTestigo(usuario)) ? 'testigo' : null;

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
        ? 'Escriba su teléfono móvil.'
        : 'Escriba su correo o nombre de usuario.'
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
    req.session.pendiente2fa = { usuarioId: usuario.id, recordar: !!recordar, entrarComo: null };

    try {
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
    } catch (errEnvio) {
      // Un fallo de entrega SÍ se registra en el servidor, pero no cambia
      // la respuesta: si dijéramos "no se pudo enviar", habríamos
      // confirmado que la cuenta existe.
      console.error(`Error enviando código de acceso por ${via}:`, errEnvio.message);
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
    return res.status(400).json({ error: 'No hay una verificación en curso. Inicie sesión de nuevo.' });
  }
  if (!codigo) {
    return res.status(400).json({ error: 'Ingrese el código recibido por correo.' });
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
      return res.status(400).json({ error: 'El código expiró. Inicie sesión de nuevo para recibir uno nuevo.' });
    }

    const registro = rows[0];

    if (registro.intentos >= MAX_INTENTOS_2FA) {
      delete req.session.pendiente2fa;
      return res.status(429).json({ error: 'Demasiados intentos. Inicie sesión de nuevo para recibir un código nuevo.' });
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

    const dispositivoToken = completarSesion(req, usuario, pendiente.recordar, pendiente.entrarComo);
    delete req.session.pendiente2fa;

    await registrarAuditoria(
      usuario.id,
      'login',
      `Inicio de sesión (2FA): ${usuario.email}` + (pendiente.entrarComo === 'testigo' ? ' (como testigo electoral)' : ''),
      req.ip
    );

    res.json({ ok: true, usuario: req.session.usuario, dispositivoToken });
  } catch (err) {
    console.error('Error verificando 2FA:', err);
    res.status(500).json({ error: 'Error interno al verificar el código.' });
  }
});

router.put('/2fa', requireAuth, async (req, res) => {
  const { activar, password } = req.body;
  try {
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

router.post('/logout', requireAuth, async (req, res) => {
  const usuarioId = req.session.usuario.id;
  await registrarAuditoria(usuarioId, 'logout', 'Cierre de sesión.', req.ip);
  req.session.destroy(() => {
    res.clearCookie('campana_sid');
    res.json({ ok: true });
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ usuario: req.session.usuario });
});

router.post('/cambiar-password', requireAuth, async (req, res) => {
  const { passwordActual, passwordNueva } = req.body;

  /* ------------------------------------------------------------------
     SEIS CIFRAS, O UNA CONTRASEÑA LARGA. LAS DOS VALEN.

     Un lider entra desde el celular con su cedula y cambia la clave por un
     numero de seis cifras: exigirle ocho caracteres con letras es pedirle
     algo que no va a recordar y que va a terminar anotado en un papel.
     Un administrador, en cambio, sigue pudiendo poner una contraseña larga.

     Se acepta CUALQUIERA DE LAS DOS en vez de mirar el rol: el rol dice
     quien es hoy, no como quiere entrar, y una persona puede ser lider y
     administradora a la vez —ya paso en esta campaña—.

     Lo que NO se acepta es el terreno de en medio: cuatro cifras, o siete
     caracteres. Ahi no hay ni lo memorizable ni lo seguro.
     ------------------------------------------------------------------ */
  const nueva = String(passwordNueva || '');
  const esSeisCifras = /^\d{6}$/.test(nueva);
  const esLarga = nueva.length >= 8;
  if (!esSeisCifras && !esLarga) {
    return res.status(400).json({
      error: 'La clave nueva debe ser un número de 6 cifras, o una contraseña de al menos 8 caracteres.'
    });
  }
  // 123456 y 000000 son las dos primeras que prueba cualquiera.
  if (esSeisCifras && (/^(\d)\1{5}$/.test(nueva) || nueva === '123456' || nueva === '654321')) {
    return res.status(400).json({ error: 'Ese número es demasiado fácil de adivinar. Elija otro de 6 cifras.' });
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
    const nuevoHash = await bcrypt.hash(passwordNueva, 12);
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

  if (!token || !nuevaPassword || nuevaPassword.length < 8) {
    return res.status(400).json({ error: 'Token inválido o la nueva contraseña debe tener al menos 8 caracteres.' });
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
