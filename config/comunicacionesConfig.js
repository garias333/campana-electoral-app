const pool = require('./db');

let cache = null;
let cacheEn = 0;
const CACHE_MS = 30000; // 30s — evita consultar la BD en cada mensaje de una campaña grande

/**
 * Devuelve las credenciales de Comunicaciones (SendGrid + Twilio),
 * priorizando lo guardado en Configuración → Comunicaciones (base de
 * datos) sobre las variables del .env. Esto permite que cada cliente,
 * en su propia instalación, configure sus propias credenciales desde la
 * interfaz sin necesitar acceso al servidor — el .env queda como
 * respaldo/valor por defecto para cuando todavía no se ha configurado
 * nada desde la pantalla.
 *
 * Se cachea en memoria por un rato corto para no consultar la base de
 * datos en cada mensaje individual de una campaña grande.
 */
/**
 * Twilio exige el número remitente en formato E.164: "+14244975583", sin
 * espacios, guiones ni paréntesis. Al escribirlo en Configuración → CRM es
 * natural teclearlo con separadores —"+1424 497 5583"— y el guardado solo
 * recorta los extremos, así que los de en medio llegaban intactos a
 * Twilio, que responde "Invalid 'From' Number" y el SMS nunca sale. Sin
 * ningún aviso en la pantalla: el canal se ve configurado.
 *
 * Se limpia aquí, al leer, y no al guardar, para que también arregle los
 * números que ya están guardados con espacios sin tener que volver a
 * escribirlos. El prefijo "whatsapp:" que a veces trae el remitente de
 * WhatsApp se cae con la limpieza y lo vuelve a poner
 * normalizarRemitenteWhatsApp, que es a quien le corresponde.
 */
function soloE164(numero) {
  if (!numero) return null;
  const limpio = String(numero).replace(/[^\d+]/g, '');
  return limpio || null;
}

async function obtenerCredenciales() {
  const ahora = Date.now();
  if (cache && (ahora - cacheEn) < CACHE_MS) return cache;

  let fila = null;
  try {
    const [filas] = await pool.query(`SELECT * FROM configuracion_comunicaciones WHERE id = 1`);
    fila = filas[0] || null;
  } catch (err) {
    console.error('Error leyendo configuracion_comunicaciones (se usa el .env como respaldo):', err.message);
  }

  cache = {
    sendgridApiKey: (fila && fila.sendgrid_api_key) || process.env.SENDGRID_API_KEY || null,
    sendgridFrom: (fila && fila.sendgrid_from) || process.env.SENDGRID_FROM || null,
    sendgridFromName: (fila && fila.sendgrid_from_name) || process.env.SENDGRID_FROM_NAME || null,
    twilioAccountSid: (fila && fila.twilio_account_sid) || process.env.TWILIO_ACCOUNT_SID || null,
    twilioAuthToken: (fila && fila.twilio_auth_token) || process.env.TWILIO_AUTH_TOKEN || null,
    twilioSmsFrom: soloE164((fila && fila.twilio_sms_from) || process.env.TWILIO_SMS_FROM),
    twilioWhatsappFrom: soloE164((fila && fila.twilio_whatsapp_from) || process.env.TWILIO_WHATSAPP_FROM),
    // Onurix: lo normal es que la campaña NO tenga cuenta propia y se use la
    // maestra del .env. La prioridad es la misma que la de Twilio —la base
    // primero— para que se pueda cambiar sin entrar por SSH.
    onurixClient: (fila && fila.onurix_client) || process.env.ONURIX_CLIENT || null,
    onurixKey: (fila && fila.onurix_key) || process.env.ONURIX_KEY || null,
    // Para que la interfaz pueda decir CUAL de las dos se esta usando sin
    // mostrar ninguna clave: una cosa es "no hay credenciales" y otra muy
    // distinta "esta campaña trajo las suyas".
    onurixPropio: Boolean(fila && fila.onurix_client && fila.onurix_key)
  };
  cacheEn = ahora;
  return cache;
}

/** Se llama justo después de guardar cambios desde Configuración, para que se reflejen de inmediato (sin esperar a que expire el caché). */
function invalidarCache() {
  cache = null;
  cacheEn = 0;
}

module.exports = { obtenerCredenciales, invalidarCache };
