const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const { campoDuplicado, registrarErrorSinSql } = require('../config/erroresUsuarios');
const { verificarPasswordAdmin, validarTelefono10Digitos } = require('../config/verificaciones');
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
// Sin cambios respecto al comportamiento original: solo usuarios activos.
router.get('/', async (req, res) => {
  const { rol } = req.query;
  const whereSql = rol ? 'WHERE r.nombre = ? AND u.activo = 1' : 'WHERE u.activo = 1';
  const params = rol ? [rol] : [];
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.nombre, u.email, r.nombre AS rol, u.territorio_id
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
      SELECT u.id, u.nombre, u.numero_identificacion, u.nombre_usuario, u.email, u.telefono, r.nombre AS rol, u.activo,
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
      [nombre, (numero_identificacion || '').trim() || null, (nombre_usuario || '').trim() || null,
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

    if (password && password.trim()) {
      // Se escribió una contraseña nueva: se actualiza y se obliga a
      // cambiarla en el próximo inicio de sesión (igual que al crear).
      const hash = await bcrypt.hash(password.trim(), 12);
      await pool.query(
        `UPDATE usuarios SET nombre = ?, numero_identificacion = ?, nombre_usuario = ?, email = ?, telefono = ?,
         rol_id = ?, activo = ?, password_hash = ?, debe_cambiar_password = 1 WHERE id = ?`,
        [nombre, (numero_identificacion || '').trim() || null, (nombre_usuario || '').trim() || null,
         email.trim().toLowerCase(), telefono ? telefono.replace(/\D/g, '') : null, rolFila.id, activo ? 1 : 0, hash, req.params.id]
      );
    } else {
      // Sin contraseña nueva: se deja la que ya tenía, sin tocarla.
      await pool.query(
        `UPDATE usuarios SET nombre = ?, numero_identificacion = ?, nombre_usuario = ?, email = ?, telefono = ?, rol_id = ?, activo = ? WHERE id = ?`,
        [nombre, (numero_identificacion || '').trim() || null, (nombre_usuario || '').trim() || null,
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
    const passwordTemporal = Math.random().toString(36).slice(-10);
    const hash = await bcrypt.hash(passwordTemporal, 12);
    await pool.query(
      `UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 1, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?`,
      [hash, req.params.id]
    );
    res.json({ ok: true, password_temporal: passwordTemporal });
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'Error restableciendo la contraseña.' });
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
