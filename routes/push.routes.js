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

/* ------------------------------------------------------------------------------------------------------------------------------------
   «MIS AVISOS» (parche 316): los avisos en la app que RECIBIÓ quien inició sesión.

   POR QUÉ. El teléfono recorta el texto de una notificación y, al tocarla, la app abría Inicio: el mensaje completo se perdía. Ahora la
   notificación abre /app/mis-avisos.html?id=<fila> y ahí se lee entero.

   DE DÓNDE SALE. De comunicaciones_envios (la fila de cada destinatario) unida a su campaña: solo las campañas de canal push y solo las
   filas 'enviado'. En un aviso push, `destinatario_contacto` es el usuario_id de la CUENTA a la que se mandó (ver obtenerDestinatarios).
   El texto no está guardado ya personalizado: se arma igual que al enviar (textoDeAvisoRecibido).

   QUIÉN VE QUÉ. SIEMPRE se filtra por el usuario de la SESIÓN, en la consulta, nunca por un dato que mande el navegador: otra persona que
   abra la misma dirección recibe 404 (el mismo que un aviso que no existe: no se revela cuál es de quién). Esta ruta pide solo sesión,
   como el resto de este archivo: un testigo o un sublíder reciben avisos y tienen que poder leerlos.

   LO QUE NO HAY: «leído» en el servidor. Marcarlo pide una columna nueva (migración); el contador de «nuevos» de Inicio se lleva en cada
   celular (localStorage). Está en el pendiente del ESTADO.md.
   ------------------------------------------------------------------------------------------------------------------------------------ */
const DESDE_AVISOS_SQL = `
  FROM comunicaciones_envios e JOIN comunicaciones_campanas c ON c.id = e.campana_id
 WHERE c.canal = 'push' AND e.estado = 'enviado' AND e.destinatario_contacto = ?`;

async function armarAviso(fila) {
  const { textoDeAvisoRecibido } = require('./comunicaciones.routes');   // al llamar, no al cargar: este archivo no depende del orden de app.js
  return {
    id: fila.id,
    titulo: fila.asunto || 'Aviso de la campaña',
    mensaje: await textoDeAvisoRecibido(fila, fila.mensaje),
    fecha: fila.enviado_en,
  };
}

/** Los más nuevos primero. `?limite=` (máx. 100). */
router.get('/mis-avisos', async (req, res) => {
  try {
    const limite = Math.min(100, Math.max(1, parseInt(req.query.limite, 10) || 50));
    const [filas] = await pool.query(
      `SELECT e.id, e.destinatario_tipo, e.destinatario_id, e.destinatario_nombre, e.enviado_en, c.asunto, c.mensaje ${DESDE_AVISOS_SQL}
        ORDER BY e.id DESC LIMIT ?`, [String(req.session.usuario.id), limite]);
    res.json({ avisos: await Promise.all(filas.map(armarAviso)) });
  } catch (err) {
    console.error('Error listando mis avisos:', err);
    res.status(500).json({ error: 'No se pudieron cargar los avisos.' });
  }
});

/** Cuántos avisos nuevos hay (los de los últimos 7 días con id mayor que `?desde=`), para la insignia de Inicio. */
router.get('/mis-avisos/contar', async (req, res) => {
  try {
    const desde = Math.max(0, parseInt(req.query.desde, 10) || 0);
    const [[r]] = await pool.query(
      `SELECT COUNT(*) AS nuevos, COALESCE(MAX(e.id), 0) AS ultimo_id ${DESDE_AVISOS_SQL}
          AND e.id > ? AND e.enviado_en >= NOW() - INTERVAL 7 DAY`, [String(req.session.usuario.id), desde]);
    res.json({ nuevos: Number(r.nuevos) || 0, ultimo_id: Number(r.ultimo_id) || 0 });
  } catch (err) {
    console.error('Error contando mis avisos:', err);
    res.status(500).json({ error: 'No se pudo contar los avisos.' });
  }
});

/** Un aviso completo. 404 si no existe o NO es de quien pregunta. */
router.get('/mis-avisos/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Ese aviso no está disponible.' });
  try {
    const [[fila]] = await pool.query(
      `SELECT e.id, e.destinatario_tipo, e.destinatario_id, e.destinatario_nombre, e.enviado_en, c.asunto, c.mensaje ${DESDE_AVISOS_SQL} AND e.id = ?`,
      [String(req.session.usuario.id), id]);
    if (!fila) return res.status(404).json({ error: 'Ese aviso no está disponible.' });
    res.json(await armarAviso(fila));
  } catch (err) {
    console.error('Error leyendo un aviso:', err);
    res.status(500).json({ error: 'No se pudo cargar el aviso.' });
  }
});

module.exports = router;
