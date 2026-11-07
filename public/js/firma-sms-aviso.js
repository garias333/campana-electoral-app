/**
 * El aviso de la FIRMA DEL SMS (orden 35), para la pantalla Configurar CRM → SMS.
 *
 * La firma NO la escribe esta aplicación: la pega el proveedor a cada mensaje (la CRC lo exige). Aquí se guarda para poder
 * CONTAR lo que ocupa en el segmento. Una firma larga o con tilde o ñ puede encarecer TODOS los SMS que salen:
 *   · un carácter FUERA del alfabeto GSM-7 (á, í, ó, ú…) baja el segmento de 160 a 70 caracteres. La ñ, la é y la ü SÍ están en
 *     GSM-7 (no bajan el segmento), pero esta aplicación las quita de sus propios mensajes y no se sabe cómo las trata el
 *     proveedor: por prudencia también se avisa de ellas;
 *   · una firma de ~50 caracteres le deja al texto ~110, y la confirmación de la inscripción, «Ya voté» y el aviso de transporte
 *     pueden pasar de 1 SMS a 2.
 * Esta función SOLO MIDE Y AVISA: no cambia lo escrito (la firma real vive en la cuenta del proveedor, y no se corrige sola).
 *
 * Una sola función pura, también la usa la prueba del servidor (se carga con `vm`).
 *
 *   avisoDeFirmaSms('Estrategia Marketing Politico - Campaña municipal')
 *     → { caracteres: 49, conTilde: true, larga: true, advertencia: 'Firma larga: …', detalle: '…' }
 */
(function (raiz) {
  'use strict';
  var LIMITE = 30;
  // El alfabeto GSM-7 básico (el mismo de lib/sms.js): fuera de él, el SMS pasa a UCS-2 (70 caracteres por segmento).
  var GSM7 = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
  var GSM7_EXT = '^{}\\[~]|€';
  var MENSAJE = 'Firma larga: los SMS de confirmación, Ya voté y transporte pueden costar 2 créditos';

  function avisoDeFirmaSms(firma) {
    var t = String(firma == null ? '' : firma);
    var caracteres = Array.from(t).length;
    // Tildes y ñ (y cualquier carácter fuera de ASCII): una sola saca el mensaje entero del alfabeto GSM-7.
    var n = t.normalize ? t.normalize('NFC') : t;
    var conTilde = /[^\x00-\x7F]/.test(n);
    var fuera = Array.from(n).some(function (ch) { return GSM7.indexOf(ch) === -1 && GSM7_EXT.indexOf(ch) === -1; });
    var larga = caracteres > LIMITE;
    var detalle = '';
    if (caracteres) {
      var limite = fuera ? 70 : 160;
      detalle = caracteres + ' caracteres' +
        (fuera ? ' · lleva caracteres fuera de GSM-7 (tildes como á, í, ó, ú): el SMS entero baja a 70 caracteres por segmento'
          : (conTilde ? ' · lleva ñ o tildes que GSM-7 sí admite, pero esta aplicación las quita de sus mensajes: confirme con el proveedor cómo las envía' : '')) +
        ' · al texto le quedan ' + Math.max(0, limite - caracteres) + ' en 1 SMS';
    }
    return {
      caracteres: caracteres, conTilde: conTilde, fueraDeGsm7: fuera, larga: larga,
      advertencia: (larga || conTilde) ? MENSAJE : '',
      detalle: detalle,
    };
  }

  raiz.avisoDeFirmaSms = avisoDeFirmaSms;
  if (typeof module !== 'undefined' && module.exports) module.exports = { avisoDeFirmaSms: avisoDeFirmaSms, LIMITE_FIRMA: LIMITE, MENSAJE_FIRMA: MENSAJE };
})(typeof window !== 'undefined' ? window : globalThis);
