const express = require('express');
const pool = require('../config/db');
const { obtenerCredenciales } = require('../config/comunicacionesConfig');

const router = express.Router();

/**
 * Twilio llama a esta URL cada vez que el estado de un mensaje de SMS o
 * WhatsApp cambia (queued → sent → delivered, o → failed/undelivered).
 * Va DELIBERADAMENTE fuera de /api (así no pasa por el CSRF, que Twilio
 * no puede resolver — no tiene sesión ni cookie de este sitio) y sin
 * requireAuth (Twilio tampoco tiene una cuenta acá).
 *
 * Como protección, se valida la firma que Twilio manda en la cabecera
 * "X-Twilio-Signature" — así se confirma que el aviso de verdad viene de
 * Twilio, y no de alguien más intentando manipular el historial de
 * campañas mandando avisos falsos.
 */
router.post('/twilio/estado-mensaje', async (req, res) => {
  try {
    const twilio = require('twilio');
    const cred = await obtenerCredenciales();
    const firma = req.headers['x-twilio-signature'];
    const urlCompleta = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    if (!cred.twilioAuthToken || !firma || !twilio.validateRequest(cred.twilioAuthToken, firma, urlCompleta, req.body)) {
      console.warn('Aviso de estado de Twilio con firma inválida — se ignora.');
      return res.status(403).send('Firma inválida.');
    }

    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body;
    if (!MessageSid || !MessageStatus) return res.status(200).send('OK'); // nada que hacer, pero se responde 200 igual

    // Solo interesa corregir el registro si Twilio terminó confirmando
    // que el mensaje NO llegó — los estados intermedios (queued, sent,
    // delivered, read) no requieren ninguna corrección.
    if (!['failed', 'undelivered'].includes(MessageStatus)) {
      return res.status(200).send('OK');
    }

    const [[envio]] = await pool.query(
      `SELECT * FROM comunicaciones_envios WHERE twilio_sid = ?`, [MessageSid]
    );
    if (!envio) return res.status(200).send('OK'); // no encontrado, nada que corregir

    // Si ya estaba marcado como fallido (por ejemplo, la verificación
    // inmediata ya lo había detectado), no hay nada que corregir — evita
    // descontarlo dos veces del conteo de la campaña.
    if (envio.estado === 'fallido') return res.status(200).send('OK');

    const mensajeError = `Twilio confirmó después que no se pudo entregar (estado: ${MessageStatus}). ${ErrorMessage || 'Sin detalle adicional.'} (código ${ErrorCode || '?'})`;

    await pool.query(
      `UPDATE comunicaciones_envios SET estado = 'fallido', error_mensaje = ? WHERE id = ?`,
      [mensajeError.slice(0, 250), envio.id]
    );

    // El envío ya se había contado como "enviado" en la campaña — se
    // corrige ese conteo para que el historial refleje la realidad.
    await pool.query(
      `UPDATE comunicaciones_campanas SET enviados = GREATEST(enviados - 1, 0), fallidos = fallidos + 1 WHERE id = ?`,
      [envio.campana_id]
    );
    // Si con esta corrección ya no quedó ningún envío exitoso, se
    // refleja también en el estado general de la campaña.
    await pool.query(
      `UPDATE comunicaciones_campanas SET estado = 'fallido' WHERE id = ? AND enviados = 0 AND fallidos = total_destinatarios`,
      [envio.campana_id]
    );

    res.status(200).send('OK');
  } catch (err) {
    console.error('Error procesando el aviso de estado de Twilio:', err);
    // Se responde 200 igual — si se responde con error, Twilio reintenta
    // este mismo aviso varias veces, y el problema ya quedó en los logs.
    res.status(200).send('Error interno registrado.');
  }
});

module.exports = router;

/* ------------------------------------------------------------------
   MENSAJES ENTRANTES — y la baja de contacto que hacen posible.

   Hasta ahora Twilio solo avisaba el ESTADO de lo que salía. Lo que la
   gente contestaba no llegaba a ninguna parte: quien respondía «BAJA»
   seguía recibiendo mensajes.

   POR QUÉ ESTO NO ES UNA COMODIDAD
     La app pide autorización al registrar a una persona (Ley 1581 de
     2012, se agregó en julio). Esa autorización es revocable. Pedirla y
     no honrar su retiro es peor que no haberla pedido: deja por escrito
     que se sabía que hacía falta.

   SE MARCA A LA PERSONA, NO AL NÚMERO
     Un teléfono puede estar en varias fichas —en una familia se
     comparte—, así que se marcan TODAS las que coincidan. Es el lado
     conservador del error: de más, alguien deja de recibir mensajes que
     quizá quería; de menos, se sigue escribiendo a quien pidió que no.
   ------------------------------------------------------------------ */

/** Últimos 10 dígitos: la base los guarda así (3001234567) y Twilio manda +57…. */
function tel10(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  return digitos.length >= 10 ? digitos.slice(-10) : digitos;
}

/**
 * ¿El texto pide la baja?
 *
 * Se compara sin tildes, sin signos y en mayúscula, y se admite que venga
 * con algo más alrededor («por favor BAJA», «BAJA.»): quien quiere dejar
 * de recibir mensajes no tiene por qué escribir una palabra exacta.
 */
const PALABRAS_DE_BAJA = [
  'BAJA', 'BAJARME', 'BAJENME', 'BAJEME',
  'STOP', 'SALIR', 'CANCELAR', 'ELIMINAR', 'ELIMINARME', 'BORRARME', 'BORREN',
  'REMOVER', 'RETIRARME', 'NOMAS', 'UNSUBSCRIBE', 'DESUSCRIBIR',
];
/** Frases de dos palabras, que no se pueden buscar palabra por palabra. */
const FRASES_DE_BAJA = ['NO MAS', 'NO ESCRIBIR', 'NO ENVIAR'];

function pideLaBaja(texto) {
  const limpio = String(texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // quita tildes
    .toUpperCase().replace(/[^A-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!limpio) return false;

  // SE COMPARA POR PALABRA COMPLETA, NUNCA POR SUBCADENA.
  //
  // La primera versión usaba `includes`, y con eso «estoy TRABAJAndo»
  // contiene «BAJA»: alguien que respondiera contando que está trabajando
  // habría quedado dado de baja para siempre, sin que nadie se enterara.
  // Lo destapó una prueba, no una revisión.
  const palabras = limpio.split(' ');
  if (PALABRAS_DE_BAJA.some(p => palabras.includes(p))) return true;
  return FRASES_DE_BAJA.some(f => limpio.includes(f));
}

router.post('/twilio/entrante', async (req, res) => {
  // Se responde SIEMPRE 200 y con TwiML vacío o con el acuse: si esta ruta
  // devuelve un error, Twilio reintenta y la persona podría recibir varias
  // confirmaciones de la misma baja.
  const responder = (mensaje) => {
    res.set('Content-Type', 'text/xml');
    res.status(200).send(mensaje
      ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${mensaje}</Message></Response>`
      : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  };

  try {
    const twilio = require('twilio');
    const cred = await obtenerCredenciales();
    const firma = req.headers['x-twilio-signature'];
    const urlCompleta = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    if (!cred.twilioAuthToken || !firma || !twilio.validateRequest(cred.twilioAuthToken, firma, urlCompleta, req.body)) {
      console.warn('Mensaje entrante con firma inválida — se ignora.');
      return res.status(403).send('Firma inválida.');
    }

    const de = String(req.body.From || '');
    const canal = de.startsWith('whatsapp:') ? 'whatsapp' : 'sms';
    const telefono = tel10(de);
    const cuerpo = String(req.body.Body || '').trim();
    const baja = pideLaBaja(cuerpo);

    // A quién se le atribuye. Puede no encontrarse a nadie: un número
    // desconocido también escribe, y esa respuesta igual se guarda.
    let votanteId = null, usuarioId = null, nombre = null;
    if (telefono.length === 10) {
      const [[v]] = await pool.query(
        `SELECT id, nombre FROM votantes
          WHERE RIGHT(REGEXP_REPLACE(COALESCE(telefono,''), '[^0-9]', ''), 10) = ? LIMIT 1`, [telefono]);
      if (v) { votanteId = v.id; nombre = v.nombre; }
      const [[u]] = await pool.query(
        `SELECT id, nombre FROM usuarios
          WHERE RIGHT(REGEXP_REPLACE(COALESCE(telefono,''), '[^0-9]', ''), 10) = ? LIMIT 1`, [telefono]);
      if (u) { usuarioId = u.id; nombre = nombre || u.nombre; }
    }

    if (baja && telefono.length === 10) {
      for (const tabla of ['votantes', 'usuarios']) {
        await pool.query(
          `UPDATE ${tabla}
              SET no_contactar = 1, no_contactar_fecha = NOW(), no_contactar_origen = ?
            WHERE RIGHT(REGEXP_REPLACE(COALESCE(telefono,''), '[^0-9]', ''), 10) = ?`,
          [canal, telefono]);
      }
    }

    await pool.query(
      `INSERT INTO comunicaciones_respuestas
         (canal, de_contacto, mensaje, votante_id, usuario_id, nombre_resuelto, accion, twilio_sid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [canal, telefono || de, cuerpo, votanteId, usuarioId, nombre, baja ? 'baja' : 'ninguna', req.body.MessageSid || null]);

    // Solo se contesta cuando la persona pidió la baja: es el acuse que
    // prueba que se atendió. A un mensaje cualquiera no se le responde
    // automáticamente — sería escribirle a alguien que no lo pidió.
    return responder(baja
      ? 'Listo: no volveremos a enviarle mensajes. Si fue un error, escríbanos.'
      : null);
  } catch (err) {
    console.error('Error procesando un mensaje entrante:', err.message);
    return responder(null);
  }
});
