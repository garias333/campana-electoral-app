/**
 * POR QUÉ CANALES SE LE PUEDE ESCRIBIR A UN VOTANTE — una sola copia de la regla.
 *
 * Vivía dentro de routes/rescateVotos.routes.js (el enlace «Ya voté» que el líder manda desde su celular). Se sacó aquí
 * para que el aviso «tu transporte va en camino» (lib/transporteDiaD.js, orden 35) pase por EXACTAMENTE la misma regla:
 * dos reglas de «a quién se le puede escribir» se separan solas, y esta se habría separado el día de la elección.
 */
'use strict';

/**
 * Por qué canales puede un líder mandarle a esta persona su enlace «Ya voté» desde su celular.
 *
 * LA MISMA REGLA ESTRICTA DEL ENVÍO MASIVO (`aplicarReglaDelEnlace`, comunicaciones.routes.js) y
 * del asistente de WhatsApp (POST /enlace, abajo): autorización EXPLÍCITA por ese canal
 * (`consentimiento_whatsapp = 1` / `consentimiento_sms = 1`; NULL y 0 no cuentan) y sin
 * `no_contactar`. Además, quien ya votó no necesita enlace, y sin teléfono no hay a quién enviarlo.
 */
function canalesDelEnlace(f) {
  const sinTel = !String(f.telefono || '').replace(/\D/g, '');
  if (f.voto_en || Number(f.no_contactar) === 1 || sinTel) return { wa: false, sms: false };
  // Se inscribió solo por el enlace de un líder y aún no confirma por /c: no se le escribe (orden 23).
  if (f.origen_votante === 'enlace_lider' && !f.consentimiento_confirmado_en) return { wa: false, sms: false };
  return { wa: Number(f.consentimiento_whatsapp) === 1, sms: Number(f.consentimiento_sms) === 1 };
}

/**
 * LA MISMA REGLA ESTRICTA, PARA TODO ENVÍO AUTOMÁTICO (recordatorios, lib/recordatorios.js).
 *
 * Un mensaje que nadie escribe a mano no puede apoyarse en «no consta»: el NULL NO autoriza, igual que aquí arriba.
 * `f` es la ficha leída justo antes de enviar. Devuelve { ok, motivo }.
 *   · sms: teléfono, consentimiento_sms = 1, sin no_contactar, y —si se inscribió solo por un enlace— ya confirmado.
 *   · email: correo, consentimiento_email = 1, sin no_contactar, y lo mismo de la confirmación.
 *   · push: solo a quien tiene cuenta (el equipo): no hay casilla que preguntar, pero la baja SÍ cuenta.
 *   · whatsapp: nunca. El WhatsApp automático está prohibido; solo hay enlaces wa.me que abre una persona.
 */
function puedeEscribirseEstricto(f, canal) {
  if (canal === 'whatsapp') return { ok: false, motivo: 'El WhatsApp automático está prohibido: solo enlaces wa.me que abre una persona.' };
  if (!f) return { ok: false, motivo: 'La persona ya no está registrada.' };
  if (Number(f.no_contactar) === 1) return { ok: false, motivo: 'Pidió no recibir más mensajes.' };
  if (canal === 'push') return { ok: true, motivo: null };
  const sinTel = !String(f.telefono || '').replace(/\D/g, '');
  const sinCorreo = !String(f.email || '').trim();
  if (canal === 'sms' && sinTel) return { ok: false, motivo: 'No tiene teléfono registrado.' };
  if (canal === 'email' && sinCorreo) return { ok: false, motivo: 'No tiene correo registrado.' };
  if (f.origen_votante === 'enlace_lider' && !f.consentimiento_confirmado_en) {
    return { ok: false, motivo: 'Se inscribió por el enlace de un líder y aún no confirma su autorización.' };
  }
  const columna = canal === 'sms' ? f.consentimiento_sms : f.consentimiento_email;
  if (columna === null || columna === undefined) return { ok: false, motivo: 'No consta su autorización por este medio (el NULL no autoriza).' };
  if (Number(columna) !== 1) return { ok: false, motivo: 'No autorizó este medio.' };
  return { ok: true, motivo: null };
}

module.exports = { canalesDelEnlace, puedeEscribirseEstricto };
