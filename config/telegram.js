/**
 * config/telegram.js — El código de acceso, también por Telegram.
 *
 * CADA PERSONA RECIBE SOLO EL SUYO. El chat de destino sale de
 * `usuarios.telegram_chat_id`, que cada quien vincula desde su propia sesión;
 * no hay un chat común de la campaña. Un chat común habría sido más simple de
 * montar y habría significado que cualquiera que lo lea ve los códigos de
 * todos — es decir, entra con la cuenta de cualquiera.
 *
 * VA COMO ACOMPAÑANTE DEL CORREO, NUNCA EN SU LUGAR: el correo se manda
 * primero, y si Telegram falla el código ya está en el buzón.
 *
 *   TELEGRAM_BOT_TOKEN   el que da @BotFather (uno por campaña)
 *
 * Sin esa variable esto queda apagado y no estorba.
 */
'use strict';

function telegramConfigurado() {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Llama a la API del bot. Devuelve { ok, ... } y NUNCA lanza. */
async function llamar(metodo, cuerpo) {
  if (!telegramConfigurado()) return { ok: false, error: 'sin configurar' };
  try {
    const control = new AbortController();
    // Con límite de tiempo: sin él, una API lenta deja colgado un inicio de
    // sesión que por correo ya funcionó.
    const reloj = setTimeout(() => control.abort(), 8000);
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${metodo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: control.signal,
    });
    clearTimeout(reloj);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { ok: false, error: j.description || `HTTP ${r.status}` };
    return { ok: true, resultado: j.result };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'no respondió a tiempo' : err.message };
  }
}

async function enviarTelegram(chatId, texto) {
  if (!chatId) return { ok: false, error: 'esta persona no tiene Telegram vinculado' };
  return llamar('sendMessage', {
    chat_id: chatId, text: texto, parse_mode: 'HTML', disable_web_page_preview: true,
  });
}

/** El código de acceso. */
async function enviarCodigoTelegram(chatId, codigo, minutos) {
  return enviarTelegram(chatId,
    `Tu código de acceso es <code>${esc(codigo)}</code>\n`
    + `Vence en ${esc(minutos)} minutos.\n\n`
    + 'Si no fuiste tú quien lo pidió, no lo uses y avísale al administrador de la campaña.');
}

/** El nombre del bot, para armar el enlace de vinculación. */
async function usuarioDelBot() {
  const r = await llamar('getMe', {});
  return r.ok ? r.resultado.username : null;
}

module.exports = {
  telegramConfigurado, enviarTelegram, enviarCodigoTelegram, usuarioDelBot, llamar,
};
