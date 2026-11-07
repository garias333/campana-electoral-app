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

module.exports = { canalesDelEnlace };
