/**
 * AUTORIZACIÓN DE DATOS POR ENLACE (parche 325).
 *
 * Quien registra a una persona le manda, desde su PROPIO WhatsApp, un enlace /a/<token> donde la persona lee la política de
 * tratamiento de datos de la campaña, marca lo que autoriza, firma con el dedo y queda la constancia. La app no envía nada por su
 * cuenta: genera el enlace y el mensaje, y la persona que registra los manda.
 *
 * QUÉ SE REUTILIZA (para no duplicar la regla de los otros enlaces):
 *   · config/confirmacionConsentimiento.js  el token corto (128 bits), el sha256 del token (SOLO SE GUARDA EL HASH), el patrón del token
 *                                           y `baseDelSitio` (la dirección sale de LICENCIA_DOMINIO, nunca de la cabecera Host).
 *   · config/firmaConsentimiento.js         `validarFirma` (solo PNG en data URL, con tope) y `guardarFirma` (votante_firmas).
 *   · config/politicaPublica.js             la política vigente y su huella, y el nombre de la campaña.
 *   · config/politicaVersiones.js           `versionConocida`: la huella resuelve contra el archivo de versiones.
 *   · votantes.consentimiento_* y votante_consentimiento_evidencia: al firmar, un votante queda con las MISMAS columnas que ya lee el resto
 *                                           de la aplicación (envíos de SMS, correo, WhatsApp, listados).
 *
 * LO NUEVO: la tabla `autorizaciones_datos` (db/init-db.js), porque la estructura territorial no tiene columnas de consentimiento y porque
 * hace falta el estado del enlace (pendiente / firmada / vencida) y su un-solo-uso.
 */
'use strict';

const pool = require('./db');
const { generarTokenCorto, huellaDeToken, baseDelSitio } = require('./confirmacionConsentimiento');
const { validarFirma, guardarFirma } = require('./firmaConsentimiento');
const { versionConocida } = require('./politicaVersiones');
const { nombreDeLaCampana } = require('./politicaPublica');

const DIAS_DE_VIGENCIA = 7;
const TIPOS = ['votante', 'estructura'];
const PATRON_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** Los datos mínimos de la persona (nombre, cédula, teléfono). Una sola consulta por tipo. */
async function datosDePersona(tipo, id, cx = pool) {
  if (tipo === 'votante') {
    const [[f]] = await cx.query('SELECT id, nombre, cedula, telefono, rama_aspirante_id AS rama FROM votantes WHERE id = ?', [id]);
    return f || null;
  }
  if (tipo === 'estructura') {
    const [[f]] = await cx.query(
      `SELECT e.id, u.nombre, u.numero_identificacion AS cedula, u.telefono, NULL AS rama
         FROM estructura e JOIN usuarios u ON u.id = e.usuario_id WHERE e.id = ?`, [id]);
    return f || null;
  }
  return null;
}

/** «123456789» → «••• ••• 789»: lo justo para que la persona vea que es ella, sin dejar la cédula entera en una página con token. */
function mascaraCedula(cedula) {
  const d = String(cedula || '').replace(/\D/g, '');
  if (!d) return '';
  return '••• ••• ' + d.slice(-3);
}

function primerNombre(nombre) {
  const p = String(nombre || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}

/**
 * EL MENSAJE QUE SE ABRE EN WHATSAPP. Corto, sin mencionar ningún cargo (precampaña) y sin el nombre completo de la persona.
 * Vive AQUÍ y no en el navegador: un solo texto para el computador y el celular.
 */
function mensajeWhatsapp({ nombre, campana, enlace }) {
  const quien = primerNombre(nombre);
  const de = String(campana || '').trim() || 'la campaña';
  return `Hola${quien ? ' ' + quien : ''}, ${de} necesita tu autorización para el tratamiento de tus datos personales (Ley 1581 de 2012). Léela y firma aquí: ${enlace}`;
}

/**
 * Crea un enlace nuevo para la persona y ANULA el pendiente anterior (el «Reenviar»). El token en claro se devuelve aquí y no se guarda.
 * Una persona que ya firmó no necesita otro: lo decide quien llama (estadoDePersona).
 */
async function crearEnlace({ req, tipo, personaId, usuario, canal = 'whatsapp' }) {
  if (!TIPOS.includes(tipo)) throw new Error('tipo de persona no válido');
  const token = generarTokenCorto();
  const expira = new Date(Date.now() + DIAS_DE_VIGENCIA * 24 * 60 * 60 * 1000);
  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    await cx.query(`UPDATE autorizaciones_datos SET estado = 'anulada'
                     WHERE persona_tipo = ? AND persona_id = ? AND estado = 'pendiente'`, [tipo, personaId]);
    await cx.query(
      `INSERT INTO autorizaciones_datos (persona_tipo, persona_id, token_hash, canal_envio, expira_en, enviada_en, enviado_por, enviado_por_nombre)
       VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)`,
      [tipo, personaId, huellaDeToken(token), canal === 'copiado' ? 'copiado' : 'whatsapp', expira,
       (usuario && usuario.id) || null, String((usuario && usuario.nombre) || '').slice(0, 150) || null]);
    await cx.commit();
  } catch (err) {
    try { await cx.rollback(); } catch (_) { /* ya */ }
    throw err;
  } finally {
    cx.release();
  }
  return { token, enlace: `${baseDelSitio(req)}/a/${token}`, expira };
}

/**
 * El estado de la autorización de una persona, para pintarlo.
 *   firmada   hay una firma por este enlace, o (votantes) la firma en pantalla del registro del celular.
 *   pendiente enlace enviado, vigente, sin firmar.   vencida: el enlace pasó de su fecha sin firmarse.
 *   verbal    (solo votantes) alguien marcó que la persona autorizó, pero no hay firma suya.   sin: nada.
 */
async function estadoDePersona(tipo, personaId, cx = pool) {
  const [[firmada]] = await cx.query(
    `SELECT firmada_en, politica_version, autoriza_whatsapp, autoriza_sms, autoriza_email
       FROM autorizaciones_datos WHERE persona_tipo = ? AND persona_id = ? AND estado = 'firmada'
      ORDER BY firmada_en DESC LIMIT 1`, [tipo, personaId]);
  if (firmada) return { estado: 'firmada', firmada_en: firmada.firmada_en, politica_version: firmada.politica_version, via: 'enlace' };
  if (tipo === 'votante') {
    const [[v]] = await cx.query(
      `SELECT v.consentimiento_autorizado AS aut, v.consentimiento_fecha AS fecha, v.consentimiento_version AS version,
              (SELECT f.creada_en FROM votante_firmas f WHERE f.votante_id = v.id) AS firma_en
         FROM votantes v WHERE v.id = ?`, [personaId]);
    if (v && v.firma_en) return { estado: 'firmada', firmada_en: v.firma_en, politica_version: v.version, via: 'pantalla' };
    const pend = await pendienteDe(tipo, personaId, cx);
    if (pend) return pend;
    if (v && v.aut) return { estado: 'verbal', firmada_en: null, fecha: v.fecha, politica_version: v.version };
    return { estado: 'sin' };
  }
  return (await pendienteDe(tipo, personaId, cx)) || { estado: 'sin' };
}

async function pendienteDe(tipo, personaId, cx) {
  const [[p]] = await cx.query(
    `SELECT enviada_en, expira_en, canal_envio, enviado_por_nombre, (expira_en > NOW()) AS vigente
       FROM autorizaciones_datos WHERE persona_tipo = ? AND persona_id = ? AND estado = 'pendiente'
      ORDER BY id DESC LIMIT 1`, [tipo, personaId]);
  if (!p) return null;
  return { estado: p.vigente ? 'pendiente' : 'vencida', enviada_en: p.enviada_en, expira_en: p.expira_en,
           canal: p.canal_envio, enviado_por: p.enviado_por_nombre };
}

/** La fila de un token, en cualquier estado (o null si el token no tiene el formato o no existe). */
async function buscarPorToken(token) {
  if (!PATRON_TOKEN.test(String(token || ''))) return null;
  const [[f]] = await pool.query(
    `SELECT id, persona_tipo, persona_id, estado, expira_en, (expira_en > NOW()) AS vigente, firmada_en
       FROM autorizaciones_datos WHERE token_hash = ?`, [huellaDeToken(token)]);
  return f || null;
}

/**
 * Registra la firma. UN SOLO USO: el UPDATE exige `estado = 'pendiente'` y `expira_en > NOW()`; si dos peticiones llegan a la vez solo una
 * ve `affectedRows = 1`. Después copia a la persona: un votante recibe las columnas `consentimiento_*` (que ya leen los envíos y los
 * listados) más la evidencia y la firma de siempre; una persona de la estructura solo tiene esta tabla.
 * Devuelve { ok:true } o { ok:false, motivo }.
 */
async function firmar({ fila, firma, autoriza, canales, politica, ip, agente }) {
  if (!autoriza) return { ok: false, motivo: 'falta_autorizacion' };
  const f = validarFirma(firma);
  if (!f.ok) return { ok: false, motivo: 'firma' };
  if (!politica || !politica.huella) return { ok: false, motivo: 'sin_politica' };
  const versionOk = (await versionConocida(politica.huella)) ? 1 : 0;
  const c = { whatsapp: canales && canales.whatsapp ? 1 : 0, sms: canales && canales.sms ? 1 : 0, email: canales && canales.email ? 1 : 0 };
  const ahora = new Date();
  const [r] = await pool.query(
    `UPDATE autorizaciones_datos
        SET estado = 'firmada', firmada_en = ?, firma_ip = ?, firma_agente = ?, politica_version = ?, politica_version_ok = ?,
            autoriza_whatsapp = ?, autoriza_sms = ?, autoriza_email = ?, firma_png = ?
      WHERE id = ? AND estado = 'pendiente' AND expira_en > NOW()`,
    [ahora, String(ip || '').slice(0, 45), String(agente || '').slice(0, 255), politica.huella, versionOk,
     c.whatsapp, c.sms, c.email, f.valor, fila.id]);
  if (!r.affectedRows) return { ok: false, motivo: 'usado' };
  if (fila.persona_tipo === 'votante') {
    await pool.query(
      `UPDATE votantes
          SET consentimiento_autorizado = 1, consentimiento_fecha = ?, consentimiento_metodo = 'firma_enlace_whatsapp',
              consentimiento_email = ?, consentimiento_sms = ?, consentimiento_whatsapp = ?,
              consentimiento_version = ?, consentimiento_version_ok = ?
        WHERE id = ?`,
      [ahora, c.email, c.sms, c.whatsapp, politica.huella, versionOk, fila.persona_id]);
    await pool.query(
      `INSERT INTO votante_consentimiento_evidencia (votante_id, metodo, ip, navegador, enlace_id, politica_version)
       VALUES (?, 'firma_enlace_whatsapp', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE metodo = VALUES(metodo), ip = VALUES(ip), navegador = VALUES(navegador),
                               enlace_id = VALUES(enlace_id), politica_version = VALUES(politica_version), creado_en = NOW()`,
      [fila.persona_id, String(ip || '').slice(0, 45), String(agente || '').slice(0, 255), fila.id, politica.huella]);
    await guardarFirma(pool, fila.persona_id, f.valor);
  }
  return { ok: true };
}

function esc(t) {
  return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/* Las fechas llegan como TEXTO ya en hora de Colombia (la sesión de MySQL habla -05:00 y el pool trae `dateStrings`): se dan vuelta a
   «DD/MM/AAAA HH:MM» sin pasar por Date, que las movería por la zona horaria del servidor. */
function fmt(d) {
  if (!d) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(d));
  if (m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
  return String(d);
}
const si = (v) => (v === 1 || v === true ? 'Sí' : (v === 0 || v === false ? 'No' : 'No consta'));

/**
 * LA CONSTANCIA: una página imprimible con la fecha, la IP, el navegador, la versión de la política, las casillas y la firma. La ven y la
 * descargan solo el administrador y el coordinador (lo exige la ruta). Sirve para las firmas por enlace y, en un votante, también para
 * la firma en pantalla del registro del celular. Devuelve null si no hay nada que constatar.
 */
async function constanciaHtml(tipo, personaId) {
  const persona = await datosDePersona(tipo, personaId);
  if (!persona) return null;
  const [[a]] = await pool.query(
    `SELECT * FROM autorizaciones_datos WHERE persona_tipo = ? AND persona_id = ? AND estado = 'firmada' ORDER BY firmada_en DESC LIMIT 1`,
    [tipo, personaId]);
  let datos = null;
  if (a) {
    datos = { metodo: 'Firma por enlace enviado por WhatsApp', fecha: a.firmada_en, ip: a.firma_ip, agente: a.firma_agente,
              version: a.politica_version, ok: a.politica_version_ok, wa: a.autoriza_whatsapp, sms: a.autoriza_sms, email: a.autoriza_email,
              firma: a.firma_png, enviada: a.enviada_en, enviadoPor: a.enviado_por_nombre };
  } else if (tipo === 'votante') {
    const [[v]] = await pool.query(
      `SELECT v.consentimiento_autorizado AS aut, v.consentimiento_fecha AS fecha, v.consentimiento_metodo AS metodo,
              v.consentimiento_version AS version, v.consentimiento_version_ok AS ok, v.consentimiento_whatsapp AS wa,
              v.consentimiento_sms AS sms, v.consentimiento_email AS email,
              e.ip, e.navegador AS agente, f.firma
         FROM votantes v
         LEFT JOIN votante_consentimiento_evidencia e ON e.votante_id = v.id
         LEFT JOIN votante_firmas f ON f.votante_id = v.id
        WHERE v.id = ?`, [personaId]);
    if (v && v.aut) datos = { metodo: v.metodo === 'firma_en_pantalla' ? 'Firma en pantalla al registrar' : (v.metodo || 'Autorización registrada'),
                              fecha: v.fecha, ip: v.ip, agente: v.agente, version: v.version, ok: v.ok, wa: v.wa, sms: v.sms, email: v.email, firma: v.firma };
  }
  if (!datos) return null;
  const campana = await nombreDeLaCampana(persona.rama);
  const firmaImg = datos.firma && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(datos.firma)
    ? `<img src="${datos.firma}" alt="Firma" style="max-width:360px;border:1px solid #d5dcea;border-radius:8px;background:#fff">` : '<em>Sin firma dibujada</em>';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Constancia de autorización de datos</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1b2333;max-width:720px;margin:32px auto;padding:0 20px}
h1{font-size:1.3rem;color:#084298}table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #d5dcea;padding:8px 6px;vertical-align:top}
td:first-child{width:34%;color:#6a7590;font-weight:600}.pie{margin-top:24px;font-size:.85rem;color:#6a7590}
@media print{button{display:none}}</style></head><body>
<h1>Constancia de autorización para el tratamiento de datos personales</h1>
<p>${esc(campana || 'Campaña')} — Ley 1581 de 2012</p>
<table>
<tr><td>Persona</td><td>${esc(persona.nombre)}</td></tr>
<tr><td>Identificación</td><td>${esc(persona.cedula || '—')}</td></tr>
<tr><td>Medio</td><td>${esc(datos.metodo)}</td></tr>
<tr><td>Fecha y hora de la firma</td><td>${esc(fmt(datos.fecha))}</td></tr>
${datos.enviada ? `<tr><td>Enlace enviado</td><td>${esc(fmt(datos.enviada))}${datos.enviadoPor ? ' por ' + esc(datos.enviadoPor) : ''}</td></tr>` : ''}
<tr><td>Versión de la política</td><td>${esc(datos.version || 'No consta')}${datos.ok === 0 ? ' (no coincide con el archivo de versiones)' : ''}</td></tr>
<tr><td>Dirección IP</td><td>${esc(datos.ip || 'No consta')}</td></tr>
<tr><td>Navegador</td><td>${esc(datos.agente || 'No consta')}</td></tr>
<tr><td>Autoriza el tratamiento de sus datos</td><td>Sí</td></tr>
<tr><td>Autoriza contacto por WhatsApp</td><td>${si(datos.wa)}</td></tr>
<tr><td>Autoriza contacto por SMS</td><td>${si(datos.sms)}</td></tr>
<tr><td>Autoriza contacto por correo</td><td>${si(datos.email)}</td></tr>
<tr><td>Firma</td><td>${firmaImg}</td></tr>
</table>
<p class="pie">Documento generado por la plataforma el ${esc(fmt(new Date()))}. Es la constancia de lo que quedó registrado; el texto completo de la política de esa versión se conserva en el archivo de versiones de la campaña.</p>
<button onclick="window.print()">Imprimir o guardar como PDF</button>
</body></html>`;
}

module.exports = {
  DIAS_DE_VIGENCIA, TIPOS, PATRON_TOKEN,
  datosDePersona, mascaraCedula, primerNombre, mensajeWhatsapp,
  crearEnlace, estadoDePersona, buscarPorToken, firmar, constanciaHtml,
};
