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
 *   SMTP_USER=no-responder@appestrategia.net
 *   SMTP_PASSWORD=clave_del_correo
 *   SMTP_FROM_NAME=App Administración Electoral
 *   SMTP_FROM=no-responder@appestrategia.net   (opcional)
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
/**
 * Arma la cabecera From de todos los correos del sistema.
 *
 * La dirección sale de SMTP_FROM y, si no está, de SMTP_USER. Están
 * separadas porque son dos cosas distintas: SMTP_USER es con quién se
 * AUTENTICA y SMTP_FROM es qué dirección VE quien recibe. Casi siempre
 * coinciden —y conviene que coincidan: la mayoría de proveedores,
 * Hostinger entre ellos, rechaza mandar desde una dirección que no sea
 * la de la cuenta autenticada o un alias suyo—, pero si algún día hay
 * que separarlas, esto no obliga a tocar código.
 *
 * El nombre va entre comillas y la dirección entre ángulos. Por eso
 * SMTP_FROM_NAME debe traer SOLO el nombre: si además trae la dirección
 * ("Campaña <x@y.com>"), el resultado es
 * `"Campaña <x@y.com>" <x@y.com>` y el destinatario ve el correo
 * repetido dentro del nombre de quien se lo manda.
 */
function remitente() {
  const nombre = process.env.SMTP_FROM_NAME || 'Estrategia - Campañas';
  const direccion = process.env.SMTP_FROM || process.env.SMTP_USER;
  return `"${nombre}" <${direccion}>`;
}

async function enviarCorreoRecuperacion(destinatario, enlace) {
  await transporter.sendMail({
    from: remitente(),
    to: destinatario,
    subject: 'Recuperación de contraseña',
    // Igual que en el correo del código: la versión de texto plano NO es
    // opcional. Un correo solo-HTML puntúa peor en los filtros de spam, y
    // este venía sin ella — la regla estaba escrita en la función de
    // abajo y aplicada solo ahí.
    text: `Recibimos una solicitud para restablecer la contraseña de tu cuenta.\n\n`
        + `Si fuiste tú, abre este enlace (válido por 1 hora):\n${enlace}\n\n`
        + `Si no solicitaste este cambio, ignora este mensaje: tu contraseña actual seguirá funcionando.`,
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
/**
 * Correo del código de acceso de un solo uso (Torre de acceso).
 *
 * TODO VA EN ESTILOS EN LÍNEA Y CON TABLAS SIMPLES, no con clases ni
 * flexbox: los clientes de correo —Gmail y Outlook sobre todo— descartan
 * las hojas de estilo y muchas propiedades modernas. Lo que aquí se ve
 * bien en un navegador puede llegar en blanco y negro a una bandeja.
 *
 * El código va también en el ASUNTO: así se lee desde la notificación del
 * teléfono sin abrir el correo, que es como se usa de verdad.
 *
 * @param {string} nombreApp  Cómo se llama la aplicación para quien lo
 *   recibe. Va en el saludo ("Tu código de acceso a X es"), porque un
 *   código sin decir para qué servicio es no se distingue de un intento
 *   de suplantación.
 */
async function enviarCodigo2FA(destinatario, codigo, nombreApp) {
  const app = nombreApp || process.env.APP_NOMBRE || 'Estrategia | App electoral';
  await transporter.sendMail({
    from: remitente(),
    to: destinatario,
    subject: `${codigo} · tu código de acceso`,
    // Versión de texto plano: no es opcional. Un correo solo-HTML puntúa
    // peor en los filtros de spam, y este es justo el que NO puede caer
    // ahí — sin él, nadie entra.
    text: `Tu código de acceso a ${app} es: ${codigo}\n\n`
        + `Vence en 10 minutos y sirve una sola vez.\n`
        + `Si no fuiste tú quien lo pidió, ignora este mensaje.`,
    html: `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 460px; margin: 0 auto; color:#1a2b4c;">
        <p style="font-size:15px; line-height:1.5; margin:0 0 18px;">
          Tu código de acceso a <strong>${app}</strong> es:
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;">
          <tr>
            <td align="center"
                style="background:#EEF4FE; border:2px solid #1F6FEB; border-radius:12px; padding:18px 10px;">
              <span style="font-family:'Courier New',Courier,monospace; font-size:30px; font-weight:bold;
                           letter-spacing:10px; color:#1F6FEB;">${codigo}</span>
            </td>
          </tr>
        </table>
        <p style="font-size:14px; line-height:1.5; margin:0 0 14px;">
          Vence en 10 minutos y sirve una sola vez.
        </p>
        <p style="font-size:12px; color:#8A94A6; margin:0;">
          Si no fuiste tú quien lo pidió, ignora este mensaje.
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
async function enviarCorreoMasivo(destinatario, asunto, mensaje, urlBaja) {
  const mensajeHtml = String(mensaje || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  // Las mismas cabeceras que el canal de SendGrid, y por la misma razon: este
  // canal tambien envia a listas. Si solo las llevara uno de los dos, la mitad
  // de los correos de la campana seguiria sin salida visible.
  const { cabecerasDeBaja, pieDeBaja } = require('./bajaContacto');
  const pie = pieDeBaja(urlBaja);
  await transporter.sendMail({
    from: remitente(),
    to: destinatario,
    subject: asunto,
    headers: cabecerasDeBaja(urlBaja),
    text: mensaje + pie.texto,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color:#222; line-height:1.5;">
        ${mensajeHtml}
        ${pie.html}
      </div>
    `
  });
}

module.exports = { transporter, enviarCorreoRecuperacion, enviarCodigo2FA, enviarCorreoMasivo };
