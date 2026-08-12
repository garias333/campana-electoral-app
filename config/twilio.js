/**
 * Envío de SMS usando Twilio (https://www.twilio.com).
 *
 * ESTE ARCHIVO YA NO ES EL CAMINO DE ENVÍO. Desde la migración a Onurix
 * (12 de agosto de 2026) los SMS salen por config/sms.js, y NADIE requiere
 * este archivo: se comprobó con un grep de `require.*config/twilio` en todo
 * el proyecto y no quedó ni una llamada. Si viene a corregir algo del envío
 * de SMS, el archivo es config/sms.js.
 *
 * Se conserva porque Twilio sigue siendo el RESPALDO del transporte
 * (SMS_FALLBACK_PROVIDER=twilio en lib/sms.js) y porque
 * routes/webhooks.routes.js todavía recibe sus callbacks de estado. Pero
 * quien manda por ese respaldo es lib/sms.js con las credenciales que le
 * pasa config/sms.js, no las funciones de aquí.
 *
 * Las credenciales se configuran desde Configuración → Comunicaciones
 * en la interfaz (guardadas en la base de datos) — el .env sigue
 * funcionando como respaldo si todavía no se ha configurado nada ahí.
 * Ver config/comunicacionesConfig.js para el detalle de esa prioridad.
 *
 * Mientras no estén configuradas, las funciones de envío devuelven un
 * error claro en vez de fallar de forma confusa — así el CRM puede
 * mostrar "Canal no configurado" en la interfaz sin romper nada.
 *
 * WHATSAPP ESTÁ DESACTIVADO. Meta prohíbe las campañas políticas en su
 * API de negocios (WhatsApp Business), así que usarlo arriesga la
 * cuenta. enviarWhatsApp() y normalizarRemitenteWhatsApp() siguen aquí
 * a propósito, pero NO se exportan: nadie las puede llamar. Se
 * conservan porque volver a encender el canal —si Meta cambia de
 * política— es agregarlas a module.exports y devolver 'whatsapp' a la
 * lista de canales válidos de routes/comunicaciones.routes.js.
 */
const { obtenerCredenciales } = require('./comunicacionesConfig');

async function obtenerCliente(cred) {
  // Se importa acá adentro (no al inicio del archivo) para que la app no
  // truene si todavía no se ha corrido "npm install twilio".
  const twilio = require('twilio');
  return twilio(cred.twilioAccountSid, cred.twilioAuthToken);
}

/** Estado de configuración de cada canal, para mostrar en la interfaz. */
async function estadoCanales() {
  const cred = await obtenerCredenciales();
  const credencialesBase = !!(cred.twilioAccountSid && cred.twilioAuthToken);
  return {
    sms: {
      configurado: credencialesBase && !!cred.twilioSmsFrom,
      motivo: !credencialesBase
        ? 'Falta configurar el Account SID/Auth Token de Twilio (Configuración → Comunicaciones).'
        : (!cred.twilioSmsFrom ? 'Falta configurar el número de Twilio para SMS (Configuración → Comunicaciones).' : null)
    }
  };
}

/**
 * Normaliza un número de teléfono colombiano a formato internacional
 * E.164 (+57...) para Twilio. Si ya viene con "+", se deja tal cual.
 */
/**
 * Twilio exige que el remitente y el destinatario de un mensaje de
 * WhatsApp lleven el mismo prefijo "whatsapp:" — si el número se guardó
 * sin ese prefijo (algo fácil de que pase, porque el campo de SMS no lo
 * necesita), Twilio lo rechaza con "Invalid From and To pair". Esta
 * función lo agrega si hace falta, sin importar cómo se haya escrito.
 */
function normalizarRemitenteWhatsApp(numero) {
  if (!numero) return null;
  const limpio = numero.trim();
  return limpio.startsWith('whatsapp:') ? limpio : `whatsapp:${limpio}`;
}

function normalizarTelefono(telefono) {
  if (!telefono) return null;
  const limpio = String(telefono).replace(/[^\d+]/g, '');
  if (limpio.startsWith('+')) return limpio;
  if (limpio.startsWith('57') && limpio.length >= 11) return `+${limpio}`;
  if (limpio.length === 10) return `+57${limpio}`; // celular colombiano típico (10 dígitos)
  return `+${limpio}`;
}

/**
 * Twilio acepta el mensaje de inmediato (queda "queued"/"accepted") y
 * solo unos segundos después sabe si realmente se pudo entregar o no —
 * por eso NO basta con que la llamada a .create() no lance error para
 * dar el mensaje por enviado. Acá se espera un momento y se vuelve a
 * consultar el mensaje por su SID; si Twilio ya lo marcó como fallido o
 * no entregado, se lanza un error con el motivo real (en vez de quedar
 * como "Enviado" en el historial sin haber llegado nunca).
 */
async function verificarEntrega(cliente, sid) {
  await new Promise(resolve => setTimeout(resolve, 4000));
  let actualizado;
  try {
    actualizado = await cliente.messages(sid).fetch();
  } catch (err) {
    // Si ni siquiera se pudo consultar el estado, no se puede confirmar
    // la entrega — se deja pasar como enviado (Twilio sí lo aceptó), pero
    // queda registrado en los logs del servidor por si hace falta revisar.
    console.warn(`No se pudo verificar el estado del mensaje ${sid}:`, err.message);
    return;
  }
  if (actualizado.status === 'failed' || actualizado.status === 'undelivered') {
    throw new Error(
      `Twilio no pudo entregar el mensaje (estado: ${actualizado.status}). ` +
      `${actualizado.errorMessage || 'Sin detalle adicional.'} (código ${actualizado.errorCode || '?'})`
    );
  }
}

async function enviarSMS(telefono, mensaje, statusCallbackUrl) {
  const cred = await obtenerCredenciales();
  if (!cred.twilioAccountSid || !cred.twilioAuthToken) {
    throw new Error('Twilio no está configurado (Configuración → Comunicaciones).');
  }
  if (!cred.twilioSmsFrom) {
    throw new Error('Falta configurar el número de Twilio para SMS (Configuración → Comunicaciones).');
  }
  const destino = normalizarTelefono(telefono);
  if (!destino) throw new Error('Número de teléfono no válido.');

  const cliente = await obtenerCliente(cred);
  const payload = { from: cred.twilioSmsFrom, to: destino, body: mensaje };
  if (statusCallbackUrl) payload.statusCallback = statusCallbackUrl;
  const msg = await cliente.messages.create(payload);
  await verificarEntrega(cliente, msg.sid);
  return { sid: msg.sid };
}

async function enviarWhatsApp(telefono, mensaje, mediaUrl, statusCallbackUrl) {
  const cred = await obtenerCredenciales();
  if (!cred.twilioAccountSid || !cred.twilioAuthToken) {
    throw new Error('Twilio no está configurado (Configuración → Comunicaciones).');
  }
  if (!cred.twilioWhatsappFrom) {
    throw new Error('Falta configurar el número de WhatsApp de Twilio (Configuración → Comunicaciones).');
  }
  const destino = normalizarTelefono(telefono);
  if (!destino) throw new Error('Número de teléfono no válido.');

  const cliente = await obtenerCliente(cred);
  const payload = {
    from: normalizarRemitenteWhatsApp(cred.twilioWhatsappFrom),
    to: `whatsapp:${destino}`,
    body: mensaje
  };
  // Adjunto opcional (imagen, PDF, video, etc.) — Twilio exige que sea
  // una URL pública que sus propios servidores puedan descargar (no
  // basta con que el navegador de la persona tenga sesión iniciada).
  if (mediaUrl) payload.mediaUrl = [mediaUrl];
  // Le pide a Twilio que avise a esta URL cada vez que el estado del
  // mensaje cambie (entregado, fallido, no entregado...) — necesario
  // porque la confirmación de entrega real de WhatsApp casi siempre
  // llega DESPUÉS de la ventana de verificación inmediata de abajo.
  if (statusCallbackUrl) payload.statusCallback = statusCallbackUrl;

  const msg = await cliente.messages.create(payload);
  await verificarEntrega(cliente, msg.sid);
  return { sid: msg.sid };
}

// enviarWhatsApp NO se exporta a propósito — ver la nota del encabezado.
module.exports = { enviarSMS, estadoCanales, normalizarTelefono };
