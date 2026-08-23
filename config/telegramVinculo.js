/**
 * config/telegramVinculo.js — El código que ata un chat de Telegram a una persona.
 *
 * EL PROBLEMA: Telegram no dice quién es quién. Cuando alguien le escribe al
 * bot, lo único que llega es un `chat_id` — un número que no significa nada
 * para esta aplicación. Hay que poder afirmar que ESE chat es de ESTA persona.
 *
 * LA SOLUCIÓN: un enlace profundo, `t.me/<bot>?start=<codigo>`, donde el
 * código va FIRMADO con el secreto de sesión. El bot lo recibe en el primer
 * mensaje, se comprueba la firma y ahí se sabe de quién es el chat.
 *
 * VA FIRMADO Y NO ES EL id A SECAS porque ese enlace se abre desde el
 * navegador y queda en el historial: con el id desnudo, cambiar un número
 * bastaría para vincular el Telegram propio a la cuenta de otra persona — y
 * entonces los códigos de acceso de esa persona llegarían al chat de uno.
 *
 * CADUCA. El vínculo se hace una vez y en el momento; un enlace que sirva para
 * siempre es una llave olvidada en un historial. Doce horas alcanzan de sobra
 * y acotan el daño de una captura reenviada.
 *
 * La comparación es en tiempo constante: un `===` sobre el token delata por lo
 * que tarda cuántos caracteres iban bien.
 */
'use strict';
const crypto = require('crypto');

const VIGENCIA_MS = 12 * 60 * 60 * 1000;

function llave() {
  const base = process.env.SESSION_SECRET;
  if (!base) throw new Error('Falta SESSION_SECRET: sin él no se pueden firmar los vínculos de Telegram.');
  return crypto.createHmac('sha256', base).update('telegram-vinculo:v1').digest();
}

function firmar(id, vence) {
  return crypto.createHmac('sha256', llave()).update(`${id}:${vence}`).digest('base64url').slice(0, 12);
}

/** El código que viaja en el enlace: `u<id>-<vence>-<firma>`. */
function codigoDe(usuarioId) {
  const vence = Date.now() + VIGENCIA_MS;
  return `u${usuarioId}-${vence}-${firmar(usuarioId, vence)}`;
}

/** Devuelve el id de la persona si el código es auténtico y está vigente; si no, null. */
function verificar(codigo) {
  const m = /^u(\d+)-(\d+)-([A-Za-z0-9_-]{12})$/.exec(String(codigo || '').trim());
  if (!m) return null;
  const [, id, vence, firma] = m;
  if (Number(vence) < Date.now()) return null;
  const esperada = Buffer.from(firmar(id, vence));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length) return null;
  if (!crypto.timingSafeEqual(esperada, recibida)) return null;
  return Number(id);
}

module.exports = { codigoDe, verificar, VIGENCIA_MS };
