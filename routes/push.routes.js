/**
 * Suscripciones a notificaciones push.
 *
 * POR QUÉ ES UN ARCHIVO APARTE Y NO VA EN comunicaciones.routes.js
 *   Ese archivo entero está restringido a admin, coordinador, líder y
 *   asistente administrativo. Los avisos los reciben sobre todo TESTIGOS y
 *   SUBLÍDERES, que quedarían fuera. Aquí solo se exige sesión: cualquiera
 *   que pueda entrar a la aplicación puede pedir recibir avisos en su
 *   propio teléfono.
 *
 * QUÉ GUARDA
 *   Lo que el navegador entrega al aceptar: una URL que identifica al
 *   dispositivo ante el servicio de su fabricante, y dos claves con las que
 *   se cifra el contenido. Sin las tres no se puede enviar nada.
 *
 * ESTE ARCHIVO NO ENVÍA NADA — solo registra. El envío necesita la
 * librería `web-push` y vive en el canal del CRM (bloque 4).
 */
const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/**
 * La clave pública que el navegador necesita para suscribirse.
 *
 * Es pública a propósito: viaja al navegador de cualquiera. La privada
 * nunca sale del servidor — con ella se firma cada envío, y es lo único
 * que prueba ante el servicio de push que el aviso lo manda esta
 * aplicación y no un tercero.
 */
router.get('/clave-publica', (req, res) => {
  const clave = process.env.VAPID_PUBLIC_KEY || null;
  res.json({
    clave,
    // Sin las llaves configuradas no hay nada que hacer, y conviene que la
    // app lo sepa para no ofrecer un interruptor que no puede funcionar.
    disponible: !!clave,
  });
});

router.post('/suscribir', async (req, res) => {
  const { endpoint, keys, dispositivo } = req.body || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'La suscripción llegó incompleta.' });
  }
  try {
    // El mismo endpoint puede volver a registrarse (el navegador lo renueva
    // por su cuenta cada tanto) y puede cambiar de dueño: en una campaña se
    // prestan los teléfonos. Por eso se actualiza en vez de duplicar, y se
    // reasigna al usuario que está en sesión ahora.
    await pool.query(
      `INSERT INTO push_suscripciones (usuario_id, endpoint, p256dh, auth, dispositivo)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE usuario_id = VALUES(usuario_id), p256dh = VALUES(p256dh),
                               auth = VALUES(auth), dispositivo = VALUES(dispositivo)`,
      [req.session.usuario.id, endpoint, keys.p256dh, keys.auth,
       (dispositivo || '').slice(0, 150) || null]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error guardando la suscripción push:', err);
    res.status(500).json({ error: 'No se pudo registrar este dispositivo.' });
  }
});

router.post('/desuscribir', async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Falta el identificador del dispositivo.' });
  try {
    // Se borra por endpoint y no por usuario: apagar los avisos en ESTE
    // teléfono no debe apagarlos en los demás dispositivos de la persona.
    await pool.query(`DELETE FROM push_suscripciones WHERE endpoint = ?`, [endpoint]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error eliminando la suscripción push:', err);
    res.status(500).json({ error: 'No se pudo desactivar este dispositivo.' });
  }
});

/** Cuántos dispositivos tiene registrados quien consulta. Para la pantalla. */
router.get('/mis-dispositivos', async (req, res) => {
  try {
    const [filas] = await pool.query(
      `SELECT id, dispositivo, creado_en FROM push_suscripciones WHERE usuario_id = ? ORDER BY creado_en DESC`,
      [req.session.usuario.id]);
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando los dispositivos.' });
  }
});

module.exports = router;
