/**
 * Envío de notificaciones push (bloque 4).
 *
 * El registro de los dispositivos vive en routes/push.routes.js; aquí solo
 * se manda. La librería `web-push` cifra el contenido con las dos claves
 * que entregó el navegador y lo firma con la privada VAPID, que nunca sale
 * del servidor.
 *
 * A QUIÉN LLEGA, Y POR QUÉ IMPORTA
 *   Una suscripción cuelga de `usuarios.id`, así que un aviso solo puede
 *   llegarle a quien TIENE CUENTA y abrió la app en su teléfono — el
 *   equipo, no el electorado. Medido el 9 de agosto de 2026 en las dos
 *   campañas: 53 y 52 cuentas frente a 86 y 82 votantes, y esas cuentas son
 *   36 líderes, 9 coordinadores, 5 sublíderes, un admin y un testigo. Por
 *   eso el CRM solo deja elegir el canal Push con orígenes que son personas
 *   con cuenta (Estructura, Testigos, Organigrama).
 *
 * UN DISPOSITIVO MUERTO SE BORRA, NO SE REINTENTA
 *   Cuando alguien desinstala la app o el navegador caduca la suscripción,
 *   el servicio de push responde 404 o 410. Esa respuesta es definitiva: el
 *   endpoint no va a volver. Si no se borrara, la tabla acumularía
 *   dispositivos fantasma y cada campaña gastaría envíos y tiempo en ellos,
 *   contándolos como fallidos para siempre. Cualquier otro error (un 500
 *   del servicio, la red) SÍ es transitorio y la fila se conserva.
 */
const pool = require('./db');

let webpush = null;
let configurado = false;

/**
 * Se carga y configura una sola vez, y perezosamente: si la librería no
 * está instalada o faltan las llaves, la aplicación tiene que seguir
 * arrancando igual — el canal simplemente aparece como no configurado.
 */
function obtenerWebPush() {
  if (configurado) return webpush;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return null;
  try {
    webpush = require('web-push');
    // El asunto es un mailto: o una URL https — es a quién contactar si el
    // servicio de push detecta un abuso. web-push rechaza otros formatos.
    webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:soporte@appestrategia.net',
      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configurado = true;
    return webpush;
  } catch (err) {
    console.error('No se pudo inicializar web-push:', err.message);
    return null;
  }
}

/** Estado del canal, con el mismo formato que sms/email en el CRM. */
function estadoCanal() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return { configurado: false, motivo: 'Faltan las llaves VAPID en el archivo .env de esta instalación.' };
  }
  if (!obtenerWebPush()) {
    return { configurado: false, motivo: 'La librería de notificaciones no está instalada en el servidor.' };
  }
  return { configurado: true, motivo: null };
}

/**
 * Cuáles de estos usuarios tienen al menos un dispositivo registrado.
 * Se consulta en bloque, no uno por uno: una campaña puede tener cientos
 * de destinatarios y esto decide cuáles cuentan como "con contacto".
 *
 * @param {number[]} usuarioIds
 * @returns {Promise<Set<number>>}
 */
async function usuariosConDispositivo(usuarioIds) {
  const ids = [...new Set((usuarioIds || []).filter(Boolean))];
  if (ids.length === 0) return new Set();
  const [filas] = await pool.query(
    `SELECT DISTINCT usuario_id FROM push_suscripciones WHERE usuario_id IN (?)`, [ids]);
  return new Set(filas.map(f => f.usuario_id));
}

/**
 * Manda un aviso a TODOS los dispositivos de una persona.
 *
 * Lanza error si no se pudo entregar en ninguno — así el CRM lo marca como
 * fallido igual que un SMS rechazado. Si al menos uno lo recibió, se
 * considera entregado: la persona vio el aviso.
 *
 * @returns {Promise<{entregados:number, eliminados:number}>}
 */
async function enviarAUsuario(usuarioId, { titulo, cuerpo, url }) {
  const wp = obtenerWebPush();
  if (!wp) throw new Error('El canal de notificaciones no está configurado en el servidor.');

  const [dispositivos] = await pool.query(
    `SELECT id, endpoint, p256dh, auth FROM push_suscripciones WHERE usuario_id = ?`, [usuarioId]);
  if (dispositivos.length === 0) {
    throw new Error('Esta persona no tiene ningún dispositivo registrado para avisos.');
  }

  const carga = JSON.stringify({ titulo, cuerpo, url: url || '/app/inicio.html' });
  let entregados = 0, eliminados = 0;
  let ultimoError = null;

  for (const d of dispositivos) {
    try {
      await wp.sendNotification(
        { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, carga);
      entregados++;
      await pool.query(`UPDATE push_suscripciones SET ultimo_envio = NOW() WHERE id = ?`, [d.id]);
    } catch (err) {
      ultimoError = err;
      // 404/410: el endpoint ya no existe y no va a volver. Ver la nota del
      // encabezado: se borra para que no se reintente eternamente.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.query(`DELETE FROM push_suscripciones WHERE id = ?`, [d.id]);
        eliminados++;
      }
    }
  }

  if (entregados === 0) {
    throw new Error(eliminados > 0
      ? 'El dispositivo registrado ya no existe (la aplicación fue desinstalada o los avisos se desactivaron).'
      : `No se pudo entregar el aviso: ${ultimoError ? ultimoError.message : 'motivo desconocido'}`);
  }
  return { entregados, eliminados };
}

module.exports = { estadoCanal, enviarAUsuario, usuariosConDispositivo };
