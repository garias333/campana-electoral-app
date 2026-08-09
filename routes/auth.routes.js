const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { enviarCorreoRecuperacion, enviarCodigo2FA } = require('../config/mailer');
const { firmarTokenDispositivo } = require('../config/tokenDispositivo');

const router = express.Router();

const MAX_INTENTOS = 5;
const BLOQUEO_MINUTOS = 15;
const RESET_TOKEN_HORAS = 1;
const CODIGO_2FA_MINUTOS = 10;
const MAX_INTENTOS_2FA = 5;
const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

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
      const intentos = usuario.intentos_fallidos + 1;
      let bloqueadoHasta = null;
      if (intentos >= MAX_INTENTOS) {
        bloqueadoHasta = new Date(Date.now() + BLOQUEO_MINUTOS * 60000);
        await registrarAuditoria(usuario.id, 'bloqueo_cuenta', `Cuenta bloqueada ${BLOQUEO_MINUTOS} min por intentos fallidos.`, req.ip);
      }
      await pool.query(
        `UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE id = ?`,
        [intentos, bloqueadoHasta, usuario.id]
      );
      await registrarAuditoria(usuario.id, 'login_fallido', `Contraseña incorrecta (intento ${intentos}/${MAX_INTENTOS}).`, req.ip);
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    await pool.query(
      `UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_login = NOW() WHERE id = ?`,
      [usuario.id]
    );

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
  const { activar } = req.body;
  try {
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
  if (!passwordNueva || passwordNueva.length < 8) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
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
      `UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 0 WHERE id = ?`,
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

router.post('/olvidar-password', async (req, res) => {
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

      const baseUrl = `${req.protocol}://${req.get('host')}`;
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
      `UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 0, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?`,
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
