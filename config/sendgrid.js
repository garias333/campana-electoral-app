/**
 * Envío de correo masivo del CRM usando Twilio SendGrid
 * (https://sendgrid.com — el producto de correo de Twilio).
 *
 * Las credenciales se configuran desde Configuración → Comunicaciones
 * en la interfaz (guardadas en la base de datos) — el .env sigue
 * funcionando como respaldo si todavía no se ha configurado nada ahí.
 * Ver config/comunicacionesConfig.js para el detalle de esa prioridad.
 *
 * Se usa SOLO para las campañas del CRM (Comunicaciones → CRM y
 * Mensajes) — la recuperación de contraseña y el código de verificación
 * (2FA) siguen usando el SMTP de Hostinger de siempre, sin ningún
 * cambio.
 */
const { obtenerCredenciales } = require('./comunicacionesConfig');
const { cabecerasDeBaja, pieDeBaja } = require('./bajaContacto');

/** Estado de configuración, para mostrar en la interfaz del CRM. */
async function estadoCanal() {
  const cred = await obtenerCredenciales();
  const configurado = !!(cred.sendgridApiKey && cred.sendgridFrom);
  return {
    configurado,
    motivo: configurado ? null : 'Falta configurar la API Key y el remitente de SendGrid (Configuración → Comunicaciones).'
  };
}

/**
 * @param urlBaja  El enlace personal de baja de ESTE destinatario. Si viene,
 *                 se agregan las cabeceras List-Unsubscribe y el pie visible.
 * @param opciones { operativo }  `operativo: true` salta la lista de baja (prueba de configuración).
 */
async function enviarCorreoMasivo(destinatario, asunto, mensaje, urlBaja, opciones = {}) {
  // LA LISTA DE BAJA SE RESPETA EN LA SALIDA, igual que en el SMS (config/sms.js).
  if (!opciones.operativo && await require('../lib/baja').estaDadoDeBaja({ email: destinatario })) {
    throw require('../lib/baja').errorDeBaja('correo');
  }
  const cred = await obtenerCredenciales();
  if (!cred.sendgridApiKey || !cred.sendgridFrom) {
    throw new Error('SendGrid no está configurado (Configuración → Comunicaciones).');
  }
  // Se importa acá adentro (no al inicio del archivo) para que la app no
  // truene si todavía no se ha corrido "npm install @sendgrid/mail".
  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(cred.sendgridApiKey);

  const mensajeHtml = String(mensaje || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  const pie = pieDeBaja(urlBaja);
  await sgMail.send({
    to: destinatario,
    from: {
      email: cred.sendgridFrom,
      name: cred.sendgridFromName || 'Estrategia - Campañas'
    },
    replyTo: cred.sendgridFrom,
    headers: cabecerasDeBaja(urlBaja),
    subject: asunto,
    text: mensaje + pie.texto,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color:#222; line-height:1.5;">
        ${mensajeHtml}
        ${pie.html}
      </div>
    `
  });
}

module.exports = { enviarCorreoMasivo, estadoCanal };
