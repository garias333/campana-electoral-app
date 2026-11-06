/**
 * config/telegram.js — Aviso por Telegram al superadministrador.
 *
 * PARA QUÉ SIRVE. El código de ingreso del superadministrador sale por el
 * canal de siempre (correo o SMS) y, además, por aquí. Es una cuenta con
 * control total de la campaña: que el código le llegue por dos vías distintas
 * hace que un buzón caído no la deje fuera, y que ella vea de qué campaña
 * viene cada código.
 *
 * QUÉ NO ES. No hay vinculación por persona ni webhook: un solo bot y un solo
 * chat, el del superadministrador, ambos en el .env. (La versión anterior,
 * retirada en el commit 516f965, vinculaba un chat por usuario; esto es otra
 * cosa y no la restaura.)
 *
 *   TELEGRAM_BOT_TOKEN            el que entrega @BotFather
 *   TELEGRAM_SUPERADMIN_CHAT_ID   el chat al que escribe el bot
 *
 * Si falta cualquiera de las dos, esto no hace nada y devuelve false, sin
 * error: una instalación sin Telegram sigue entrando por correo.
 *
 * NUNCA SE REGISTRA el token, el chat_id ni la URL (que lleva el token). Un
 * fallo de `fetch` puede traer la URL dentro de su mensaje, así que del error
 * solo se toma el TIPO, jamás el texto.
 */
'use strict';

const TIEMPO_LIMITE_MS = 8000;

/**
 * Manda `texto` al chat `chatId`. Devuelve true si Telegram lo aceptó y false
 * en cualquier otro caso. NUNCA lanza: un aviso de apoyo no puede tumbar un
 * inicio de sesión.
 */
async function enviarTelegram(chatId, texto) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId || !texto) return false;

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: String(texto), disable_web_page_preview: true }),
      // Sin límite, una API lenta dejaría colgado un ingreso que por correo
      // ya funcionó.
      signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
    });
    if (!r.ok) {
      console.error(`Telegram falló: HTTP ${r.status}`);
      return false;
    }
    console.log('Telegram OK');
    return true;
  } catch (err) {
    // Solo el tipo (TimeoutError, TypeError…) y, si lo hay, el código de red
    // (ENOTFOUND, ECONNRESET…). Nunca err.message.
    const tipo = (err && err.name) || 'error';
    const red = err && err.cause && err.cause.code ? `/${err.cause.code}` : '';
    console.error(`Telegram falló: ${tipo}${red}`);
    return false;
  }
}

/** Lo mismo, al chat del superadministrador (TELEGRAM_SUPERADMIN_CHAT_ID). */
function enviarTelegramSuperadmin(texto) {
  return enviarTelegram(process.env.TELEGRAM_SUPERADMIN_CHAT_ID, texto);
}

module.exports = { enviarTelegram, enviarTelegramSuperadmin };
