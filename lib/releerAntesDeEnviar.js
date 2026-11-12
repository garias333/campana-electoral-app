/**
 * lib/releerAntesDeEnviar.js — LO QUE YA NO APLICA ENTRE CREAR UNA CAMPAÑA Y ENVIARLA.
 *
 * Vivía dentro de routes/comunicaciones.routes.js (parche 300, «Recordatorios automáticos, Fase 0»).
 * Se movió aquí en el parche 327 SIN CAMBIAR SU LÓGICA, para que otros módulos puedan usarla sin
 * importar el archivo de rutas; la ruta la sigue exportando con el mismo nombre
 * (`module.exports.releerAntesDeEnviar`), así que quien la usaba no nota nada.
 *
 * Lo que sí viaja con ella: `MARCADOR_ENLACE`, `esCanalDeCorreo` y `esCampanaDeDiaD`, que son lo único
 * que necesita de ese archivo (la ruta los importa de aquí en vez de tener su propia copia).
 */
'use strict';

const pool = require('../config/db');

/** El marcador del enlace «Ya voté» dentro del texto de un mensaje. */
const MARCADOR_ENLACE = /\{enlace_ya_vote\}/i;

/** "email" (SendGrid, CRM masivo) y "email_personal" (Hostinger, grupos pequeños) usan el mismo dato de contacto: el correo. */
function esCanalDeCorreo(canal) {
  return canal === 'email' || canal === 'email_personal';
}

/** ¿La campaña es de Día D? Lleva el enlace «Ya voté» o su fuente es «mis votantes que aún no han votado». */
function esCampanaDeDiaD(campana) {
  if (MARCADOR_ENLACE.test(campana.mensaje || '')) return true;
  const f = typeof campana.filtros === 'string' ? campana.filtros : JSON.stringify(campana.filtros || {});
  return f.includes('mis_votantes_sin_voto');
}

/**
 * Lo que ya no aplica ENTRE crear la campaña y enviarla. Devuelve el motivo (texto) o null si se puede enviar.
 * Vuelve a leer la ficha: baja, autorización del canal y, en Día D, si ya votó.
 *   · Autorización: la regla general deja pasar el NULL («no consta») y solo bloquea un 0; con {enlace_ya_vote}
 *     por SMS la regla es la estricta (solo un 1), la misma de aplicarReglaDelEnlace.
 */
async function releerAntesDeEnviar(envio, campana) {
  const canal = campana.canal;
  const diaD = esCampanaDeDiaD(campana);
  const estricta = canal === 'sms' && MARCADOR_ENLACE.test(campana.mensaje || '');
  if (envio.destinatario_tipo === 'votante' && envio.destinatario_id) {
    const [[v]] = await pool.query(
      `SELECT v.no_contactar, v.consentimiento_sms, v.consentimiento_email,
              EXISTS(SELECT 1 FROM votante_votos vv WHERE vv.votante_id = v.id) AS ya_voto
         FROM votantes v WHERE v.id = ?`, [envio.destinatario_id]);
    if (!v) return 'La persona ya no está registrada.';
    if (Number(v.no_contactar) === 1) return 'Pidió no recibir más mensajes: se respetó antes de enviar.';
    const columna = canal === 'sms' ? 'consentimiento_sms' : esCanalDeCorreo(canal) ? 'consentimiento_email' : null;
    if (columna) {
      const valor = v[columna];
      const autoriza = estricta ? Number(valor) === 1 : (valor === null || valor === undefined || Number(valor) === 1);
      if (!autoriza) return estricta && (valor === null || valor === undefined)
        ? 'No consta su autorización por este medio (el enlace «Ya voté» solo va a quien dijo que sí).'
        : 'Retiró su autorización por este medio: se respetó antes de enviar.';
    }
    if (diaD && Number(v.ya_voto) === 1) return 'Ya votó: no hace falta escribirle.';
  } else if (envio.destinatario_tipo === 'estructura' && envio.destinatario_id) {
    const [[u]] = await pool.query(
      `SELECT u.no_contactar FROM estructura e JOIN usuarios u ON u.id = e.usuario_id WHERE e.id = ?`, [envio.destinatario_id]);
    if (u && Number(u.no_contactar) === 1) return 'Pidió no recibir más mensajes: se respetó antes de enviar.';
  }
  return null;
}

module.exports = { releerAntesDeEnviar, esCampanaDeDiaD, esCanalDeCorreo, MARCADOR_ENLACE };
