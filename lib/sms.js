/**
 * sms.js — Transporte SMS multi-proveedor (v2)
 * Estrategia Marketing Politico / appestrategia.net
 *
 * CAMBIO CLAVE FRENTE A v1:
 * Este modulo ya NO lee credenciales de process.env directamente en el envio.
 * Recibe la configuracion por parametro, para funcionar en multi-tenant.
 * process.env solo se usa como valor por defecto (cuenta maestra).
 *
 * Este archivo NO sabe nada de cuotas ni de base de datos. Solo transporta.
 * La cuota la maneja sms-cuota.js.
 *
 * Requiere Node 18+.
 */

'use strict';

// Onurix solo acepta IPv4. Sin esto, Node 22 sale por IPv6 y responde 1005.
require('node:dns').setDefaultResultOrder('ipv4first');

const ONURIX_BASE = 'https://www.onurix.com/api/v1';
const ONURIX_SEND = `${ONURIX_BASE}/sms/send`;
const TIMEOUT_MS = parseInt(process.env.SMS_TIMEOUT_MS || '15000', 10);

// ---------------------------------------------------------------------------
// Mapeo de errores de Onurix
// PENDIENTE: completar con la seccion "Tabla de Errores" de docs.onurix.com
// ---------------------------------------------------------------------------

const ERRORES_ONURIX = {
  1005: 'IP no aprobada. Registre la IPv4 del VPS en portal.onurix.com/app/security/security',
  // TODO: agregar el resto de la tabla oficial.
};

function describirErrorOnurix(codigo, msgOriginal) {
  const conocido = ERRORES_ONURIX[codigo];
  if (conocido) return `${codigo} - ${conocido}`;
  return `${codigo} - ${msgOriginal || 'error no documentado'}`;
}

// ---------------------------------------------------------------------------
// Normalizacion de numeros colombianos
// ---------------------------------------------------------------------------

function normalizarCelular(entrada) {
  if (entrada === null || entrada === undefined) return null;

  let d = String(entrada).replace(/\D/g, '');
  if (!d) return null;

  d = d.replace(/^0+/, '');

  if (d.length === 12 && d.startsWith('57')) {
    d = d.slice(2);
  }

  if (d.length !== 10 || !d.startsWith('3')) return null;

  return '57' + d;
}

function aE164(entrada) {
  const n = normalizarCelular(entrada);
  return n ? '+' + n : null;
}

// ---------------------------------------------------------------------------
// Analisis de texto: GSM-7 vs UCS-2 y conteo de segmentos
// ---------------------------------------------------------------------------

const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = '^{}\\[~]|€';

function analizarTexto(texto) {
  const t = String(texto || '');
  let unidades = 0;
  let gsm7 = true;

  for (const ch of t) {
    if (GSM7.includes(ch)) unidades += 1;
    else if (GSM7_EXT.includes(ch)) unidades += 2;
    else {
      gsm7 = false;
      break;
    }
  }

  if (!gsm7) {
    unidades = t.length;
    const limite = unidades <= 70 ? 70 : 67;
    const segmentos = Math.max(1, Math.ceil(unidades / limite));
    return { gsm7: false, codificacion: 'ucs2', segmentos, caracteres: unidades,
             restantes: segmentos * limite - unidades };
  }

  const limite = unidades <= 160 ? 160 : 153;
  const segmentos = Math.max(1, Math.ceil(unidades / limite));
  return { gsm7: true, codificacion: 'gsm7', segmentos, caracteres: unidades,
           restantes: segmentos * limite - unidades };
}

function forzarGSM7(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, '');
}

// ---------------------------------------------------------------------------
// Credenciales
// ---------------------------------------------------------------------------

/**
 * Resuelve credenciales. Prioridad:
 *   1. Lo que venga en `config` (por campaña, si algun dia lo necesita)
 *   2. La cuenta maestra del .env
 */
function resolverCredenciales(config = {}) {
  return {
    onurix: {
      client: config.onurixClient || process.env.ONURIX_CLIENT,
      key: config.onurixKey || process.env.ONURIX_KEY,
    },
    twilio: {
      sid: config.twilioSid || process.env.TWILIO_ACCOUNT_SID,
      token: config.twilioToken || process.env.TWILIO_AUTH_TOKEN,
      from: config.twilioFrom || process.env.TWILIO_FROM,
    },
  };
}

// ---------------------------------------------------------------------------
// Driver: Onurix
// ---------------------------------------------------------------------------

async function enviarOnurix({ phone, body, cred }) {
  if (!cred.client || !cred.key) {
    return { ok: false, provider: 'onurix', errorCodigo: 'CONFIG',
             error: 'Faltan ONURIX_CLIENT u ONURIX_KEY' };
  }

  const params = new URLSearchParams();
  params.append('client', cred.client);
  params.append('key', cred.key);
  params.append('phone', phone);
  params.append('sms', body);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ONURIX_SEND, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
      signal: ctrl.signal,
    });

    const texto = await res.text();
    let json = null;
    try { json = JSON.parse(texto); } catch (_) { /* no JSON */ }

    // Formato de error confirmado en produccion: { error: 1005, msg: '...' }
    if (json && json.error) {
      return {
        ok: false,
        provider: 'onurix',
        errorCodigo: String(json.error),
        error: describirErrorOnurix(json.error, json.msg),
        raw: json,
      };
    }

    if (!res.ok) {
      return { ok: false, provider: 'onurix', errorCodigo: `HTTP${res.status}`,
               error: `HTTP ${res.status}`, raw: json || texto };
    }

    const data = (json && json.data) || {};
    const aceptado = Boolean(data.id);

    return {
      ok: aceptado,
      provider: 'onurix',
      providerId: data.id || null,
      credits: typeof data.credits === 'number' ? data.credits : null,
      errorCodigo: aceptado ? null : 'SIN_ID',
      error: aceptado ? null : 'Onurix no devolvio id de mensaje',
      raw: json || texto,
    };
  } catch (err) {
    const msg = err.name === 'AbortError' ? `Timeout tras ${TIMEOUT_MS}ms` : err.message;
    return { ok: false, provider: 'onurix', errorCodigo: 'RED', error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Driver: Twilio — respaldo y destinos fuera de Colombia
// ---------------------------------------------------------------------------

async function enviarTwilio({ phone, body, cred }) {
  if (!cred.sid || !cred.token || !cred.from) {
    return { ok: false, provider: 'twilio', errorCodigo: 'CONFIG',
             error: 'Faltan credenciales de Twilio' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${cred.sid}/Messages.json`;
  const params = new URLSearchParams();
  params.append('To', '+' + phone);
  params.append('From', cred.from);
  params.append('Body', body);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${cred.sid}:${cred.token}`).toString('base64'),
      },
      body: params.toString(),
      signal: ctrl.signal,
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        ok: false,
        provider: 'twilio',
        errorCodigo: json ? String(json.code) : `HTTP${res.status}`,
        error: json ? `${json.code}: ${json.message}` : `HTTP ${res.status}`,
        raw: json,
      };
    }

    return { ok: true, provider: 'twilio', providerId: json.sid, raw: json };
  } catch (err) {
    const msg = err.name === 'AbortError' ? `Timeout tras ${TIMEOUT_MS}ms` : err.message;
    return { ok: false, provider: 'twilio', errorCodigo: 'RED', error: msg };
  } finally {
    clearTimeout(timer);
  }
}

const DRIVERS = { onurix: enviarOnurix, twilio: enviarTwilio };

// ---------------------------------------------------------------------------
// API publica de transporte
// ---------------------------------------------------------------------------

/**
 * Envia un SMS. NO controla cuota — para eso use sms-cuota.js.
 *
 * @param {Object} opts
 * @param {string} opts.to           Celular en cualquier formato
 * @param {string} opts.body         Texto
 * @param {Object} [opts.config]     { onurixClient, onurixKey, twilioSid, ... }
 * @param {string} [opts.proveedor]  'onurix' | 'twilio' | 'none'
 * @param {string} [opts.respaldo]   proveedor de respaldo si falla el primero
 * @param {boolean}[opts.forzarGSM7] quita tildes para abaratar
 */
async function sendSMS({ to, body, config = {}, proveedor, respaldo, forzarGSM7: forzar } = {}) {
  const phone = normalizarCelular(to);
  if (!phone) {
    return { ok: false, errorCodigo: 'NUMERO', provider: null,
             error: `Numero invalido o no es celular colombiano: ${to}` };
  }

  let texto = String(body || '').trim();
  if (!texto) {
    return { ok: false, errorCodigo: 'VACIO', provider: null, error: 'Mensaje vacio' };
  }
  if (forzar) texto = forzarGSM7(texto);

  const analisis = analizarTexto(texto);
  const creds = resolverCredenciales(config);

  const principal = (proveedor || process.env.SMS_PROVIDER || 'onurix').toLowerCase();
  const alterno = (respaldo !== undefined ? respaldo : process.env.SMS_FALLBACK_PROVIDER || '')
    .toLowerCase();

  if (principal === 'none') {
    console.log(`[SMS:DRYRUN] -> ${phone} (${analisis.segmentos} seg): ${texto}`);
    return { ok: true, provider: 'none', providerId: 'dryrun', analisis, phone, texto };
  }

  const driver = DRIVERS[principal];
  if (!driver) {
    return { ok: false, errorCodigo: 'PROVEEDOR', provider: null,
             error: `Proveedor desconocido: ${principal}` };
  }

  let r = await driver({ phone, body: texto, cred: creds[principal] });

  // No reintentar con respaldo si el error es de configuracion o del numero:
  // fallaria igual y gastaria saldo del otro proveedor sin necesidad.
  const reintentable = r.errorCodigo !== 'CONFIG' && r.errorCodigo !== 'NUMERO';

  if (!r.ok && reintentable && alterno && DRIVERS[alterno] && alterno !== principal) {
    console.warn(`[SMS] ${principal} fallo (${r.error}). Respaldo: ${alterno}`);
    const r2 = await DRIVERS[alterno]({ phone, body: texto, cred: creds[alterno] });
    r2.fallbackDesde = principal;
    r2.errorPrincipal = r.error;
    r = r2;
  }

  r.analisis = analisis;
  r.phone = phone;
  r.texto = texto;
  return r;
}

module.exports = {
  sendSMS,
  normalizarCelular,
  aE164,
  analizarTexto,
  forzarGSM7,
  ERRORES_ONURIX,
};
