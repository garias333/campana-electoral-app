/**
 * Pedir la doble confirmación por CORREO al registrar a alguien, si está
 * encendido.
 *
 * APAGADO DE FÁBRICA, igual que el SMS de bienvenida. Aquí el motivo no es el
 * crédito —el correo no gasta— sino que enviarle algo a alguien recién
 * registrado es una decisión de la campaña, no del programa.
 *
 * SOLO CORREO, NUNCA SMS. Un SMS por cada alta puede vaciar el saldo en una
 * jornada de calle sin que nadie lo decida; para SMS existe el botón manual de
 * la ficha, que además avisa de que gasta crédito. Esa asimetría es a propósito.
 *
 * NUNCA LANZA. Se llama sin `await` y con `.catch()`, como
 * `bienvenidaAutomatica`: un fallo de correo no puede deshacer un registro que
 * ya está guardado, y una promesa rechazada sin manejar tumba el proceso.
 */
'use strict';

const pool = require('./db');
const { crearConfirmacion } = require('./confirmacionConsentimiento');

/** ¿Está encendida? Ante cualquier fallo, apagada: es la respuesta segura. */
async function encendida() {
  try {
    const [[c]] = await pool.query('SELECT confirmacion_email_automatica FROM sms_config WHERE id = 1');
    return !!(c && c.confirmacion_email_automatica);
  } catch (_) {
    return false;
  }
}

/**
 * @param {object} req  Necesario para armar el enlace (LICENCIA_DOMINIO).
 * @param {number} votanteId
 * @param {object} datos  { email, consentimiento_autorizado, consentimiento_email }
 */
async function pedirConfirmacionSiProcede(req, votanteId, datos) {
  try {
    if (!(await encendida())) return { pedida: false, motivo: 'apagado' };
    if (!datos.consentimiento_autorizado) return { pedida: false, motivo: 'sin autorización' };
    if (!datos.email) return { pedida: false, motivo: 'sin correo' };
    // Un 0 explícito es un no; NULL es «no consta» y pasa. Los MISMOS filtros
    // que el endpoint manual — si divergen, un camino mandaría correos que el
    // otro considera prohibidos.
    if (datos.consentimiento_email === 0) return { pedida: false, motivo: 'no autorizó el correo' };
    // La baja manda sobre todo (parche 327): quien pidió no recibir mensajes tampoco recibe esta confirmación.
    if (await require('../lib/baja').estaDadoDeBaja({ email: datos.email })) return { pedida: false, motivo: 'pidió la baja' };

    const { enlace } = await crearConfirmacion({ req, votanteId, canal: 'email', destino: datos.email });
    const { enviarCorreoMasivo } = require('./mailer');
    await enviarCorreoMasivo(datos.email,
      'Confirme su autorización de datos',
      'Usted autorizó que la campaña guarde sus datos y le escriba.\n\n' +
      'Para dejar constancia, abra este enlace y pulse el botón:\n' + enlace + '\n\n' +
      'Si no reconoce esta solicitud, ignore este mensaje: sin su confirmación no pasa nada.',
      null);
    return { pedida: true };
  } catch (err) {
    console.error('Confirmación automática: no se pudo pedir (la persona SÍ quedó registrada):',
      err.code || err.message);
    return { pedida: false, motivo: 'error' };
  }
}

module.exports = { encendida, pedirConfirmacionSiProcede };
