const pool = require('./db');

/**
 * Registra una acción sensible en el log de auditoría (tabla `auditoria`).
 * Nunca lanza error — si el registro en sí falla, se anota en consola pero
 * no debe tumbar la acción real que se estaba auditando (exportar, borrar, etc.).
 */
async function registrarAuditoria(usuarioId, accion, entidad, entidadId, detalle, ip) {
  try {
    await pool.query(
      `INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, detalle, ip) VALUES (?, ?, ?, ?, ?, ?)`,
      [usuarioId || null, accion, entidad || null, entidadId || null, detalle || null, ip || null]
    );
  } catch (err) {
    console.error('Error registrando auditoría:', err);
  }
}

module.exports = { registrarAuditoria };
