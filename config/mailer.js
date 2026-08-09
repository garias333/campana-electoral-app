const nodemailer = require('nodemailer');
/**
 * Transporte SMTP reutilizable. Pensado para una cuenta de correo de
 * Hostinger (smtp.hostinger.com), pero funciona con cualquier proveedor
 * SMTP estándar con las variables de entorno correctas.
 *
 * Variables esperadas en .env:
 *   SMTP_HOST=smtp.hostinger.com
 *   SMTP_PORT=465
 *   SMTP_SECURE=true        (true para puerto 465, false para 587/STARTTLS)
 *   SMTP_USER=noreply@appestrategia.net
 *   SMTP_PASSWORD=clave_del_correo
 *   SMTP_FROM_NAME=Estrategia - Campañas
 */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: (process.env.SMTP_SECURE || 'true') === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});
async function enviarCorreoRecuperacion(destinatario, enlace) {
  const nombreRemitente = process.env.SMTP_FROM_NAME || 'Estrategia - Campañas';
  await transporter.sendMail({
    from: `"${nombreRemitente}" <${process.env.SMTP_USER}>`,
    to: destinatario,
    subject: 'Recuperación de contraseña',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color:#1a2b4c;">Recuperación de contraseña</h2>
        <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
        <p>Si fuiste tú, haz clic en el siguiente enlace (válido por 1 hora):</p>
        <p style="margin: 24px 0;">
          <a href="${enlace}" style="background:#c0621f; color:#fff; padding:12px 20px; border-radius:6px; text-decoration:none; display:inline-block;">
            Restablecer contraseña
          </a>
        </p>
        <p style="font-size: 0.85rem; color: #666;">
          Si no solicitaste este cambio, puedes ignorar este correo — tu contraseña actual seguirá funcionando.
        </p>
      </div>
    `
  });
}
async function enviarCodigo2FA(destinatario, codigo) {
  const nombreRemitente = process.env.SMTP_FROM_NAME || 'Estrategia - Campañas';
  await transporter.sendMail({
    from: `"${nombreRemitente}" <${process.env.SMTP_USER}>`,
    to: destinatario,
    subject: `Tu código de verificación: ${codigo}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color:#1a2b4c;">Código de verificación</h2>
        <p>Usa este código para completar tu inicio de sesión (válido por 10 minutos):</p>
        <p style="font-size: 2rem; font-weight: bold; letter-spacing: 0.3em; text-align: center; background:#f4f6f8; padding: 16px; border-radius: 8px;">
          ${codigo}
        </p>
        <p style="font-size: 0.85rem; color: #666;">
          Si no intentaste iniciar sesión, ignora este correo y considera cambiar tu contraseña.
        </p>
      </div>
    `
  });
}

/**
 * Envío masivo desde el CRM (Comunicaciones → CRM y Mensajes). El
 * mensaje lo escribe el usuario en texto libre — se muestra tal cual,
 * respetando los saltos de línea, dentro de una plantilla simple. Usa el
 * mismo remitente/transportador que el resto del sistema.
 */
async function enviarCorreoMasivo(destinatario, asunto, mensaje) {
  const nombreRemitente = process.env.SMTP_FROM_NAME || 'Estrategia - Campañas';
  const mensajeHtml = String(mensaje || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  await transporter.sendMail({
    from: `"${nombreRemitente}" <${process.env.SMTP_USER}>`,
    to: destinatario,
    subject: asunto,
    text: mensaje,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color:#222; line-height:1.5;">
        ${mensajeHtml}
      </div>
    `
  });
}

module.exports = { transporter, enviarCorreoRecuperacion, enviarCodigo2FA, enviarCorreoMasivo };
