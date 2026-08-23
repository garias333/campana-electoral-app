#!/usr/bin/env node
/**
 * Registra (o revisa) el webhook del bot de Telegram de ESTA campaña.
 *
 *   node scripts/configurar-telegram.js              revisa como esta
 *   node scripts/configurar-telegram.js --registrar  lo deja apuntando aqui
 *
 * CADA CAMPANA NECESITA SU PROPIO BOT. Telegram admite UNA sola URL de webhook
 * por bot, asi que un bot compartido entre dos campanas dejaria a una de las
 * dos sin recibir nada — y el fallo seria silencioso: los vinculos
 * simplemente no se completarian.
 */
'use strict';
require('dotenv').config();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRETO = process.env.TELEGRAM_WEBHOOK_SECRET;
const DOMINIO = process.env.LICENCIA_DOMINIO;
const registrar = process.argv.includes('--registrar');

const api = async (metodo, cuerpo) => {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${metodo}`, cuerpo
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }
    : undefined);
  return r.json();
};

(async () => {
  const faltan = [];
  if (!TOKEN) faltan.push('TELEGRAM_BOT_TOKEN (lo da @BotFather con /newbot)');
  if (!SECRETO) faltan.push('TELEGRAM_WEBHOOK_SECRET (invente una cadena larga; la usan Telegram y esta app para reconocerse)');
  if (!DOMINIO) faltan.push('LICENCIA_DOMINIO');
  if (faltan.length) {
    console.log('  Falta en el .env:');
    faltan.forEach(f => console.log('    · ' + f));
    process.exit(1);
  }

  const yo = await api('getMe');
  if (!yo.ok) { console.log('  El token no sirve:', yo.description); process.exit(1); }
  console.log(`  Bot: @${yo.result.username}`);

  const url = `https://${DOMINIO}/webhooks/telegram`;
  if (registrar) {
    const r = await api('setWebhook', {
      url,
      secret_token: SECRETO,
      // Solo mensajes: no hace falta nada mas para vincular, y pedir de menos
      // es la forma barata de no procesar lo que no se entiende.
      allowed_updates: ['message'],
    });
    console.log(r.ok ? `  Webhook registrado en ${url}` : `  NO se pudo registrar: ${r.description}`);
    if (!r.ok) process.exit(1);
  }

  const info = await api('getWebhookInfo');
  if (info.ok) {
    const w = info.result;
    console.log(`  URL actual        : ${w.url || '(ninguna)'}`);
    console.log(`  Pendientes        : ${w.pending_update_count}`);
    if (w.last_error_message) {
      console.log(`  ULTIMO ERROR      : ${w.last_error_message}`);
      console.log('  (Telegram exige HTTPS con certificado valido y respuesta 200.)');
    }
    if (!registrar && w.url !== url) {
      console.log(`\n  El webhook NO apunta aqui. Deberia ser ${url}`);
      console.log('  Corra este mismo script con --registrar.');
    }
  }
})().catch(e => { console.error('  reventó:', e.message); process.exit(1); });
