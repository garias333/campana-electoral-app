const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * Cuánto vive un código de acceso temporal.
 *
 * 48 horas es el margen para que alguien reciba el mensaje un viernes por la
 * noche y entre el domingo. Más allá de eso el código deja de ser una
 * comodidad y pasa a ser una puerta abierta: son cuatro dígitos, y con los 480
 * intentos diarios que permite el bloqueo por cuenta, treinta días de vigencia
 * dan un 76% de probabilidad de acertarlo. Con 48 horas queda por debajo del
 * 10%.
 */
const HORAS_VIGENCIA_CODIGO = 48;
const { campoDuplicado, registrarErrorSinSql } = require('../config/erroresUsuarios');
const { verificarPasswordAdmin, validarTelefono10Digitos } = require('../config/verificaciones');
const { registrarAuditoria } = require('../config/auditoria');
const smsSvc = require('../config/sms');
router.use(requireAuth);

/**
 * Búsqueda por cédula EXACTA entre las cuentas del sistema (líderes,
 * coordinadores, testigos, etc.) — para el módulo de Asistentes a
 * reuniones: un asistente puede ser, además de un votante normal, un
 * líder o coordinador que solo existe como cuenta de usuario, sin fila
 * propia en Votantes (ej. si se creó desde Configuración → Usuarios en
 * vez de Estructura territorial). Solo trae lo mínimo (nombre y
 * teléfono, nada de email ni rol) para no exponer de más a quien esté
 * pasando lista.
 */
router.get('/buscar-por-cedula', async (req, res) => {
  const cedula = (req.query.cedula || '').trim();
  if (!cedula) return res.json(null);
  try {
    const [[fila]] = await pool.query(
      `SELECT id, nombre, telefono FROM usuarios WHERE numero_identificacion = ? LIMIT 1`,
      [cedula]
    );
    res.json(fila || null);
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'Error buscando por número de identificación.' });
  }
});

// Listado liviano para poblar selects (líder responsable, supervisor, etc.)
// Solo usuarios activos.
//
// NO DEVUELVE EL CORREO, a propósito. Esta ruta la puede llamar CUALQUIER
// usuario con sesión —incluidos Invitado y Testigo—, porque las pantallas que
// la usan (Votantes, Territorial, Eventos) están abiertas a esos roles y
// necesitan la lista para armar sus desplegables. Devolver además el correo
// de todo el equipo era exponer datos de contacto a quien solo necesita
// nombres.
//
// Se comprobó que ninguno de los tres consumidores lo usaba: los tres leen
// únicamente id, nombre y rol. Por eso se quita el campo en vez de restringir
// la ruta por rol, que habría dejado sin desplegables a los Líderes.
router.get('/', async (req, res) => {
  const { rol } = req.query;
  const whereSql = rol ? 'WHERE r.nombre = ? AND u.activo = 1' : 'WHERE u.activo = 1';
  const params = rol ? [rol] : [];
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.nombre, r.nombre AS rol, u.territorio_id
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
       ${whereSql} ORDER BY u.nombre`, params
    );
    res.json(rows);
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'Error consultando los usuarios.' });
  }
});

// Listado completo para el panel de administración de Usuarios (Configuración).
// Incluye inactivos, y datos que no hacen falta en los selects livianos de arriba.
router.get('/admin', requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.nombre, u.numero_identificacion, u.nombre_usuario, u.email, u.telefono, u.credenciales_enviadas, r.nombre AS rol, u.activo,
             u.debe_cambiar_password, u.two_factor_enabled, u.ultimo_login, u.created_at,
             COALESCE(t.nombre, te.nombre) AS territorio_nombre
      FROM usuarios u
      JOIN roles r ON r.id = u.rol_id
      LEFT JOIN territorios t ON t.id = u.territorio_id
      -- "e.cargo = r.nombre" ata la fila de Estructura a la del cargo
      -- PRINCIPAL de la cuenta (u.rol_id): alguien con doble rol (ej. Líder
      -- y también Testigo electoral) tiene DOS filas en estructura para la
      -- misma cuenta — sin esta condición, el JOIN las traía ambas y la
      -- persona salía duplicada en este listado.
      LEFT JOIN estructura e ON e.usuario_id = u.id AND e.cargo = r.nombre
      LEFT JOIN territorios te ON te.id = e.territorio_id
      ORDER BY u.nombre
    `);
    res.json(rows);
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'Error obteniendo el listado de usuarios.' });
  }
});

// Lista de roles disponibles (para el selector de "Asignar roles y perfiles").
router.get('/roles', requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT id, nombre, descripcion FROM roles ORDER BY id`);
    res.json(rows);
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'Error obteniendo los roles.' });
  }
});

// Crea un usuario "suelto" (sin pasar por Estructura/Territorio) — para
// cuentas de administración, invitados, etc. Si no se indica una
// contraseña, se genera una temporal (igual que al crear alguien desde
// Agregar a la estructura); si el admin sí escribe una, se usa esa.
router.post('/', requireRole('admin'), async (req, res) => {
  const { nombre, numero_identificacion, nombre_usuario, email, telefono, rol, password } = req.body;
  if (!nombre || !email || !rol) {
    return res.status(400).json({ error: 'Nombre, email y rol son obligatorios.' });
  }
  if (password && password.trim() && password.trim().length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  }
  if (!validarTelefono10Digitos(telefono)) {
    return res.status(400).json({ error: 'Error de digitación: el teléfono debe tener 10 dígitos.' });
  }
  try {
    const [[rolFila]] = await pool.query(`SELECT id FROM roles WHERE nombre = ?`, [rol]);
    if (!rolFila) return res.status(400).json({ error: 'Rol no válido.' });

    const passwordElegidaPorAdmin = !!(password && password.trim());
    const passwordFinal = passwordElegidaPorAdmin ? password.trim() : Math.random().toString(36).slice(-10);
    const hash = await bcrypt.hash(passwordFinal, 12);

    const [result] = await pool.query(
      `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, password_hash, rol_id, telefono, debe_cambiar_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      // Vacio con cedula a la mano: la cedula. Es lo que promete el campo del
      // formulario, y guardar NULL dejaba a la persona sin con que entrar
      // salvo por su correo — que un lider no suele tener.
      [nombre, (numero_identificacion || '').trim() || null,
       (nombre_usuario || '').trim() || (numero_identificacion || '').trim() || null,
       email.trim().toLowerCase(), hash, rolFila.id, telefono ? telefono.replace(/\D/g, '') : null]
    );
    res.json({
      ok: true,
      id: result.insertId,
      // Si el admin escribió la contraseña, no hace falta mostrársela de vuelta.
      password_temporal: passwordElegidaPorAdmin ? null : passwordFinal
    });
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    const msg = err.code === 'ER_DUP_ENTRY'
      ? campoDuplicado(err)
      : 'Error creando el usuario.';
    res.status(400).json({ error: msg });
  }
});

// Edita nombre/email/teléfono/rol/estado de un usuario existente.
router.put('/:id', requireRole('admin'), async (req, res) => {
  const { nombre, numero_identificacion, nombre_usuario, email, telefono, rol, activo, password } = req.body;
  if (!nombre || !email || !rol) {
    return res.status(400).json({ error: 'Nombre, email y rol son obligatorios.' });
  }
  if (password && password.trim() && password.trim().length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  }
  if (!validarTelefono10Digitos(telefono)) {
    return res.status(400).json({ error: 'Error de digitación: el teléfono debe tener 10 dígitos.' });
  }
  try {
    const [[rolFila]] = await pool.query(`SELECT id FROM roles WHERE nombre = ?`, [rol]);
    if (!rolFila) return res.status(400).json({ error: 'Rol no válido.' });

    /* --------------------------------------------------------------------
       EL NOMBRE DE USUARIO SIGUE A LA CÉDULA CUANDO ERA LA CÉDULA

       Con qué se entra es `nombre_usuario`, no `numero_identificacion`. Al
       cambiarle la cédula a alguien, el usuario se quedaba con la vieja: la
       persona seguía entrando con el número anterior, y el mensaje de
       WhatsApp le mandaba ese, que era correcto pero no era el que el
       administrador acababa de escribir. Nadie daba error; simplemente los
       dos números dejaban de ser el mismo.

       Solo se re-sincroniza si el usuario ERA la cédula. Si el administrador
       le puso a propósito otro nombre de usuario, no se le toca — pisarlo
       seria decidir por él, y dejaria a esa persona sin poder entrar.
       -------------------------------------------------------------------- */
    const [[antes]] = await pool.query(
      `SELECT numero_identificacion, nombre_usuario FROM usuarios WHERE id = ?`, [req.params.id]);
    const cedula = (numero_identificacion || '').trim();
    let usuarioFinal = (nombre_usuario || '').trim();

    // Vacío con cédula a la mano: es lo que promete el propio campo del
    // formulario («Se autocompleta con el Número de identificación»), y hasta
    // hoy no lo cumplía — se guardaba NULL y la persona quedaba sin con qué
    // entrar, salvo por su correo.
    if (!usuarioFinal && cedula) usuarioFinal = cedula;

    if (antes && cedula && antes.nombre_usuario
        && antes.nombre_usuario === antes.numero_identificacion
        && usuarioFinal === antes.nombre_usuario) {
      usuarioFinal = cedula;
    }
    const usuarioParaGuardar = usuarioFinal || null;

    if (password && password.trim()) {
      // Se escribió una contraseña nueva: se actualiza y se obliga a
      // cambiarla en el próximo inicio de sesión (igual que al crear).
      const hash = await bcrypt.hash(password.trim(), 12);
      await pool.query(
        `UPDATE usuarios SET nombre = ?, numero_identificacion = ?, nombre_usuario = ?, email = ?, telefono = ?,
         rol_id = ?, activo = ?, password_hash = ?, debe_cambiar_password = 1 WHERE id = ?`,
        [nombre, cedula || null, usuarioParaGuardar,
         email.trim().toLowerCase(), telefono ? telefono.replace(/\D/g, '') : null, rolFila.id, activo ? 1 : 0, hash, req.params.id]
      );
    } else {
      // Sin contraseña nueva: se deja la que ya tenía, sin tocarla.
      await pool.query(
        `UPDATE usuarios SET nombre = ?, numero_identificacion = ?, nombre_usuario = ?, email = ?, telefono = ?, rol_id = ?, activo = ? WHERE id = ?`,
        [nombre, cedula || null, usuarioParaGuardar,
         email.trim().toLowerCase(), telefono ? telefono.replace(/\D/g, '') : null, rolFila.id, activo ? 1 : 0, req.params.id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    const msg = err.code === 'ER_DUP_ENTRY'
      ? campoDuplicado(err)
      : 'Error actualizando el usuario.';
    res.status(400).json({ error: msg });
  }
});

router.put('/:id/estado', requireRole('admin'), async (req, res) => {
  const { activo } = req.body;
  try {
    await pool.query(`UPDATE usuarios SET activo = ? WHERE id = ?`, [activo ? 1 : 0, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'Error actualizando el estado del usuario.' });
  }
});

// Restablece la contraseña de un usuario a una nueva temporal (por si la
// olvidó y no le llega el correo de recuperación, por ejemplo).
router.post('/:id/restablecer-password', requireRole('admin'), async (req, res) => {
  try {
    // CÓDIGO DE 4 DÍGITOS, pedido para que se pueda dictar por teléfono y
    // teclear en un celular en campo sin equivocarse. Es una credencial de
    // un solo uso: `debe_cambiar_password = 1` obliga a cambiarla en el
    // primer ingreso, así que solo tiene que durar lo que tarde la persona
    // en entrar.
    //
    // `crypto.randomInt` y no `Math.random()`: con diez caracteres daba
    // igual, con cuatro dígitos no. `Math.random()` no es un generador
    // criptográfico y su estado se puede reconstruir observando unas pocas
    // salidas — es decir, quien vea un par de códigos podría anticipar los
    // siguientes. Es el mismo generador que ya usa el código 2FA.
    //
    // `padStart` importa: sin él, 42 saldría como "42" y no como "0042", y
    // uno de cada diez códigos tendría menos dígitos de los debidos.
    // LA CLAVE INICIAL ES LA CEDULA, y eso es una decision tomada a sabiendas.
    //
    // La cedula NO es un secreto: esta en el formulario de registro y la
    // conocen lideres y coordinadores. Quien sepa la de otro puede entrar con
    // su cuenta. Lo que lo hace aceptable son dos cosas, y las dos tienen que
    // seguir ahi: VENCE —ver password_temporal_expira, abajo— y obliga a
    // cambiarla en el primer ingreso. Es una llave para entrar una vez, no una
    // contraseña.
    //
    // A cambio, el dato no tiene que viajar: la persona ya lo sabe. Eso quita
    // de en medio el SMS del codigo, que hoy es justo lo que no esta llegando.
    //
    // Si no hay cedula registrada se cae al codigo aleatorio de antes: sin ese
    // respaldo, esta persona se quedaria sin ninguna forma de entrar.
    const [[quien]] = await pool.query(
      'SELECT numero_identificacion FROM usuarios WHERE id = ?', [req.params.id]);
    const cedula = quien && String(quien.numero_identificacion || '').trim();
    const passwordTemporal = cedula || String(crypto.randomInt(0, 10000)).padStart(4, '0');
    const esCedula = !!cedula;
    const hash = await bcrypt.hash(passwordTemporal, 12);
    // `credenciales_enviadas = NULL`: la clave que la persona tenga guardada
    // dejo de servir en este mismo instante, asi que la casilla de
    // "Credenciales enviadas" vuelve a estar en blanco. Sin esto, la tabla
    // seguiria diciendo que ya se le escribio y nadie se enteraria de que hay
    // que volver a hacerlo.
    const expira = new Date(Date.now() + HORAS_VIGENCIA_CODIGO * 60 * 60 * 1000);
    await pool.query(
      `UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 1, intentos_fallidos = 0,
              bloqueado_hasta = NULL, credenciales_enviadas = NULL, password_temporal_expira = ?
        WHERE id = ?`,
      [hash, expira, req.params.id]
    );

    // EL CÓDIGO VIAJA POR OTRO CANAL QUE EL ENLACE.
    //
    // El enlace de la aplicación no es un secreto —el dominio está publicado
    // en los registros de Certificate Transparency desde que se emitió su
    // certificado, y ahí no se puede borrar—. El código sí lo es. Mandarlos
    // juntos por WhatsApp significa que una sola captura reenviada lleva todo
    // lo necesario para entrar; separados, cada mensaje por su lado no sirve.
    //
    // La clave NUNCA sale del servidor por este camino: se genera aquí y se
    // manda desde aquí. El navegador solo recibe si salió o no.
    let sms = { enviado: false, motivo: null };
    if (req.body && req.body.enviar_sms) {
      const [[persona]] = await pool.query('SELECT nombre, telefono FROM usuarios WHERE id = ?', [req.params.id]);
      if (!persona || !persona.telefono) {
        sms.motivo = 'la persona no tiene teléfono registrado';
      } else {
        try {
          // `operativo: true`: es un mensaje de la aplicación a su propio
          // equipo, no propaganda, así que no lo detiene la lista de baja.
          await smsSvc.enviarSMS(
            persona.telefono,
            `Su codigo de acceso es ${passwordTemporal}. Vence en ${HORAS_VIGENCIA_CODIGO} horas.`,
            null,
            { origen: 'acceso', operativo: true, usuarioId: Number(req.params.id) }
          );
          sms.enviado = true;
        } catch (err) {
          sms.motivo = err.message || 'no se pudo enviar';
          console.warn('[credenciales] SMS no enviado:', sms.motivo);
        }
      }
    }

    res.json({
      ok: true,
      password_temporal: passwordTemporal,
      // Para que el mensaje de WhatsApp sepa QUE decir: si la clave es la
      // cedula, escribirla ahi seria mandar por escrito algo que la persona
      // ya sabe, y de paso dejarla en una captura reenviable.
      es_cedula: esCedula,
      expira_en: expira,
      horas_vigencia: HORAS_VIGENCIA_CODIGO,
      sms
    });
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'Error restableciendo la contraseña.' });
  }
});

/**
 * Le apaga la verificación en dos pasos a OTRA persona.
 *
 * POR QUÉ HACE FALTA. Hasta ahora `two_factor_enabled` solo se podía cambiar
 * desde la propia cuenta (PUT /auth/2fa, que escribe sobre
 * req.session.usuario.id). Es decir: a quien se le rompiera el correo con el
 * 2FA encendido quedaba fuera de su cuenta y NADIE dentro de la aplicación
 * podía sacarlo — había que entrar por base de datos.
 *
 * Eso convertía encender el 2FA en una puerta de un solo sentido, y era la
 * razón de no activarlo. Con este botón, un bloqueo se resuelve en dos clics.
 *
 * SOLO APAGA, NUNCA ENCIENDE. Encenderle el 2FA a otro le exigiría un correo
 * que quizá no revisa, y volveríamos al mismo problema desde el otro lado.
 * Activarlo sigue siendo decisión de cada quien, desde su propio panel.
 */
router.post('/:id/desactivar-2fa', requireRole('admin'), async (req, res) => {
  try {
    const [[persona]] = await pool.query(
      'SELECT nombre, two_factor_enabled FROM usuarios WHERE id = ?', [req.params.id]
    );
    if (!persona) return res.status(404).json({ error: 'Ese usuario ya no existe.' });
    if (!persona.two_factor_enabled) {
      return res.json({ ok: true, ya_estaba: true, nombre: persona.nombre });
    }
    await pool.query('UPDATE usuarios SET two_factor_enabled = 0 WHERE id = ?', [req.params.id]);
    await registrarAuditoria(
      req.session.usuario.id, 'desactivar_2fa_ajeno', 'usuarios', req.params.id,
      `Un administrador le desactivó la verificación en dos pasos a ${persona.nombre}.`, req.ip
    );
    res.json({ ok: true, ya_estaba: false, nombre: persona.nombre });
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'No se pudo desactivar la verificación en dos pasos.' });
  }
});

/**
 * Deja constancia de que se le mandaron las credenciales a esta persona.
 *
 * Lo llama el botón de WhatsApp de Configuración → Usuarios DESPUÉS de abrir
 * la ventana del mensaje.
 *
 * LO QUE MARCA ES QUE EL MENSAJE SE ABRIÓ CON LOS DATOS PUESTOS, no que la
 * persona lo recibiera ni lo leyera: WhatsApp se abre en otra ventana, fuera
 * de esta aplicación, y desde aquí no hay forma de saber si el envío llegó a
 * completarse. Conviene que la casilla se entienda así y no como un acuse de
 * recibo.
 */
router.post('/:id/credenciales-enviadas', requireRole('admin'), async (req, res) => {
  try {
    const [r] = await pool.query(
      `UPDATE usuarios SET credenciales_enviadas = NOW() WHERE id = ?`, [req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Ese usuario ya no existe.' });
    const [[fila]] = await pool.query(
      `SELECT credenciales_enviadas FROM usuarios WHERE id = ?`, [req.params.id]
    );
    await registrarAuditoria(
      req.session.usuario.id, 'credenciales_enviadas', 'usuarios', req.params.id,
      'Se le enviaron por WhatsApp el enlace de la aplicación y sus datos de acceso.', req.ip
    );
    res.json({ ok: true, credenciales_enviadas: fila.credenciales_enviadas });
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'No se pudo dejar registrado el envío.' });
  }
});

// Eliminar un usuario también elimina en cascada su registro de Estructura
// si lo tenía (FK estructura.usuario_id ON DELETE CASCADE) — se advierte
// de esto en el frontend antes de confirmar.
/**
 * Acción administrativa en bloque: para todos los usuarios que YA tienen
 * Número de identificación guardado, copia ese número como su Nombre de
 * usuario (si no tenían uno) y como su contraseña — y los deja marcados
 * para cambiarla obligatoriamente en su próximo inicio de sesión. Piensa
 * en esto como un "restablecer contraseña" masivo usando la cédula como
 * valor de partida. Los usuarios sin Número de identificación se omiten
 * (no hay nada con qué sincronizarlos).
 */
router.post('/sincronizar-con-identificacion', requireRole('admin'), async (req, res) => {
  const { password } = req.body;
  const autorizado = await verificarPasswordAdmin(password);
  if (!autorizado) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }
  try {
    const [usuarios] = await pool.query(
      `SELECT id, numero_identificacion FROM usuarios WHERE numero_identificacion IS NOT NULL AND numero_identificacion != ''`
    );

    let actualizados = 0;
    const fallidos = [];
    for (const u of usuarios) {
      try {
        const hash = await bcrypt.hash(u.numero_identificacion, 12);
        await pool.query(
          `UPDATE usuarios SET nombre_usuario = ?, password_hash = ?, debe_cambiar_password = 1 WHERE id = ?`,
          [u.numero_identificacion, hash, u.id]
        );
        actualizados++;
      } catch (err) {
        console.error(`Error sincronizando usuario id ${u.id}:`, err);
        fallidos.push(u.id);
      }
    }

    res.json({ ok: true, total: usuarios.length, actualizados, fallidos: fallidos.length });
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'Error sincronizando usuarios con su Número de identificación.' });
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM usuarios WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'Error eliminando el usuario.' });
  }
});

module.exports = router;
