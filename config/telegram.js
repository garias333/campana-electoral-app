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

const { obtenerCredenciales } = require('./comunicacionesConfig');

/**
 * El token del bot. Sale de la BASE primero y del .env despues — la misma
 * prioridad que el resto de canales, para que se pueda configurar desde
 * Configurar mensajeria sin entrar por SSH y sin romper las instalaciones
 * que ya lo tenian escrito en el archivo.
 */
async function tokenDelBot() {
  try {
    const c = await obtenerCredenciales();
    return (c && c.telegramBotToken) || null;
  } catch (_) {
    return process.env.TELEGRAM_BOT_TOKEN || null;
  }
}

async function telegramConfigurado() {
  return !!(await tokenDelBot());
}

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Llama a la API del bot. Devuelve { ok, ... } y NUNCA lanza. */
async function llamar(metodo, cuerpo, tokenExplicito) {
  // `tokenExplicito` sirve para PROBAR un token que todavia no se ha guardado
  // —al escribirlo en la pantalla—, sin tener que confiarlo a la base antes
  // de saber si sirve.
  const token = tokenExplicito || await tokenDelBot();
  if (!token) return { ok: false, error: 'sin configurar' };
  try {
    const control = new AbortController();
    // Con límite de tiempo: sin él, una API lenta deja colgado un inicio de
    // sesión que por correo ya funcionó.
    const reloj = setTimeout(() => control.abort(), 8000);
    const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
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
async function usuarioDelBot(tokenExplicito) {
  const r = await llamar('getMe', {}, tokenExplicito);
  return r.ok ? r.resultado.username : null;
}

/**
 * Deja el webhook apuntando a esta instalacion. Se llama al guardar el token
 * desde la pantalla: sin esto habria que acordarse de correr un script, y
 * olvidarlo no da error — los vinculos simplemente no se completan.
 *
 * UN BOT POR CAMPANA. Telegram admite UNA sola URL por bot, asi que registrar
 * aqui un token que ya usa otra instalacion le quita el webhook a esa otra, en
 * silencio. Por eso se devuelve la URL que TENIA antes: es lo unico que
 * permite avisarlo.
 */
async function registrarWebhook(dominio, secreto, tokenExplicito) {
  const antes = await llamar('getWebhookInfo', {}, tokenExplicito);
  const urlPrevia = antes.ok ? (antes.resultado.url || '') : '';
  const url = `https://${dominio}/webhooks/telegram`;
  const r = await llamar('setWebhook', {
    url, secret_token: secreto, allowed_updates: ['message'],
  }, tokenExplicito);
  return { ok: r.ok, error: r.error, url, urlPrevia };
}

module.exports = {
  telegramConfigurado, tokenDelBot, enviarTelegram, enviarCodigoTelegram,
  usuarioDelBot, registrarWebhook, llamar,
};
