/**
 * config/bajaContacto.js — El enlace para darse de baja.
 *
 * POR QUÉ UN ENLACE Y NO «RESPONDA BAJA»
 *   La baja por respuesta existe desde el parche 14, pero exige que el mensaje
 *   se pueda contestar. Medido el 13 de agosto de 2026 en la campaña
 *   municipal: enviando con un número largo de EE. UU. por Twilio, el operador
 *   colombiano entrega el mensaje desde un código corto suyo y la respuesta no
 *   tiene ruta de vuelta — **cero respuestas recibidas en toda la vida de la
 *   instalación**, con tres plantillas prometiendo «Responda BAJA». Un enlace
 *   no depende del proveedor ni del tipo de número: funciona con Twilio, con
 *   Onurix y con el que venga después.
 *
 * EL TOKEN NO SE GUARDA: SE CALCULA
 *   Es un HMAC de «tipo:id» — así no hace falta una tabla ni escribir nada al
 *   enviar, y el enlace de una persona no sirve para dar de baja a otra. Sin
 *   firma, cambiar el número del enlace daría de baja a quien uno quisiera.
 *
 * LA LLAVE SALE DE SESSION_SECRET, y es una decisión, no un descuido.
 *   Una variable nueva y obligatoria en el .env habría dejado el canal roto en
 *   las dos campañas hasta que alguien entrara a editar tres archivos a mano
 *   —el .env nunca viaja en un parche—. SESSION_SECRET ya existe en toda
 *   instalación, es distinto en cada una, y aquí se usa DERIVADO con una
 *   etiqueta fija: de este token no se puede volver a la clave de sesión.
 *
 * CONSECUENCIA QUE HAY QUE SABER: si algún día se rota SESSION_SECRET, los
 * enlaces ya enviados dejan de validar. Quien le dé clic a uno viejo verá que
 * el enlace no es válido, no una baja silenciosa que no ocurrió.
 */
'use strict';

const crypto = require('crypto');

// 'estructura' tiene su propia letra y NO se traduce aquí a usuario: en
// comunicaciones_envios lo que se guarda es el id de la FILA de estructura, y
// los dos rangos de id se solapan —confundirlos daría de baja a otra persona,
// que es el error que ya casi manda un aviso push al destinatario equivocado—.
// La traducción a usuario se hace al abrir el enlace, una sola vez, y no en
// cada uno de los cientos de mensajes de un envío.
const TIPOS = { votante: 'v', usuario: 'u', estructura: 'e' };
const TIPO_POR_LETRA = { v: 'votante', u: 'usuario', e: 'estructura' };

function llave() {
  const base = process.env.SESSION_SECRET;
  if (!base) return null;
  return crypto.createHmac('sha256', base).update('baja-contacto:v1').digest();
}

/**
 * 10 caracteres de base64url ≈ 60 bits. Sobra contra la fuerza bruta —y aquí
 * el premio de adivinar uno es dar de baja a un desconocido, no entrar a
 * ningún lado— y no se come el mensaje: cada carácter cuesta en un SMS.
 */
function firmar(tipo, id) {
  const k = llave();
  if (!k) return null;
  return crypto.createHmac('sha256', k).update(`${tipo}:${id}`).digest('base64url').slice(0, 10);
}

/** El código que viaja en la URL: v123-Ab3xK9pQ2r */
function codigoDe(tipo, id) {
  const letra = TIPOS[tipo];
  const token = letra ? firmar(tipo, id) : null;
  return token ? `${letra}${id}-${token}` : null;
}

/**
 * Devuelve { tipo, id } si el código es auténtico, o null.
 * La comparación es en tiempo constante: un `===` delata el token por lo que
 * tarda en fallar.
 */
function verificar(codigo) {
  const m = /^([vue])(\d+)-([A-Za-z0-9_-]{10})$/.exec(String(codigo || ''));
  if (!m) return null;
  const tipo = TIPO_POR_LETRA[m[1]];
  const id = parseInt(m[2], 10);
  const esperado = firmar(tipo, id);
  if (!esperado) return null;
  const a = Buffer.from(m[3]);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { tipo, id };
}

/**
 * La URL completa. La base sale de `sms_config.url_baja_base` si la campaña
 * puso una —sirve para usar un dominio corto, porque en un SMS cada carácter
 * cuenta— y si no, del dominio de la licencia, que toda instalación tiene.
 */
function urlDeBaja(codigo, base) {
  if (!codigo) return '';
  const raiz = (base || `https://${process.env.LICENCIA_DOMINIO || ''}`).replace(/\/+$/, '');
  return `${raiz}/b/${codigo}`;
}

module.exports = { codigoDe, verificar, urlDeBaja };
