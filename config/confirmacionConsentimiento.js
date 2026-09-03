/**
 * Doble confirmación de la autorización de datos.
 *
 * QUÉ AÑADE SOBRE LA FIRMA. La firma se dibuja en el teléfono del líder,
 * delante de él. Esto llega al teléfono o al correo DE LA PERSONA, y solo ella
 * puede abrirlo: para la autorización de mensajería es la prueba más fuerte
 * que se puede tener, porque nace en su propio canal. De paso comprueba que
 * ese número o ese correo existen y son suyos.
 *
 * EL TOKEN SE GUARDA HASHEADO, NUNCA EN CLARO — igual que `password_resets`.
 * Quien lea la tabla no puede confirmar en nombre de nadie. El token completo
 * vive solo dentro del enlace enviado.
 *
 * NO se copia el patrón de `config/bajaContacto.js`: aquel es un HMAC
 * recalculable, sin caducidad y reutilizable, derivado de SESSION_SECRET.
 * Para una baja está bien —repetirla no hace daño— pero como prueba de un
 * acto concreto y fechado no sirve, y además rotar la llave invalidaría de
 * golpe todos los enlaces ya enviados.
 */
'use strict';

const crypto = require('crypto');
const pool = require('./db');

// Quince días. Suficiente para quien no mira el correo a diario, y corto
// para que un enlace olvidado en un historial no siga vivo un año.
const DIAS_DE_VIGENCIA = 15;

function generarToken() {
  return crypto.randomBytes(32).toString('hex');
}

function huellaDeToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

/**
 * La dirección del sitio, SIEMPRE desde la configuración y nunca desde la
 * cabecera Host, que la manda el cliente. Con `req.get('host')` un atacante
 * puede provocar un enlace legítimo, con token válido, apuntando a un
 * servidor suyo. Es la misma regla ya escrita en `bajaContacto.js` y en la
 * recuperación de contraseña.
 */
function baseDelSitio(req) {
  return process.env.LICENCIA_DOMINIO
    ? `https://${process.env.LICENCIA_DOMINIO}`
    : `${req.protocol}://${req.get('host')}`;
}

/**
 * Crea una confirmación pendiente y devuelve el enlace que hay que enviar.
 * El token en claro se devuelve aquí y no se guarda en ninguna parte.
 */
async function crearConfirmacion({ req, votanteId, canal, destino }) {
  const token = generarToken();
  const expira = new Date(Date.now() + DIAS_DE_VIGENCIA * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO consentimiento_confirmaciones (votante_id, token_hash, canal, destino, expira_en)
     VALUES (?, ?, ?, ?, ?)`,
    [votanteId, huellaDeToken(token), canal, String(destino).slice(0, 150), expira]
  );
  return { token, enlace: `${baseDelSitio(req)}/c/${token}`, expira };
}

/**
 * Busca una confirmación vigente por su token. Devuelve null si no existe,
 * si caducó o si ya se usó.
 */
async function buscarVigente(token) {
  if (!/^[0-9a-f]{64}$/.test(String(token || ''))) return null;
  const [[fila]] = await pool.query(
    `SELECT id, votante_id, canal, destino, confirmada_en
       FROM consentimiento_confirmaciones
      WHERE token_hash = ? AND expira_en > NOW()`,
    [huellaDeToken(token)]
  );
  return fila || null;
}

/**
 * Marca la confirmación y la copia al votante. Es idempotente: si la persona
 * vuelve a abrir el enlace y a pulsar, no se duplica ni se reescribe la fecha
 * original — la primera vez es la que vale como prueba.
 */
async function confirmar({ fila, ip, agente }) {
  if (fila.confirmada_en) return { yaEstaba: true };
  const ahora = new Date();
  await pool.query(
    `UPDATE consentimiento_confirmaciones
        SET confirmada_en = ?, confirmada_ip = ?, confirmada_agente = ?
      WHERE id = ? AND confirmada_en IS NULL`,
    [ahora, (ip || '').slice(0, 45), (agente || '').slice(0, 255), fila.id]
  );
  await pool.query(
    `UPDATE votantes
        SET consentimiento_confirmado_en = ?, consentimiento_confirmado_canal = ?
      WHERE id = ? AND consentimiento_confirmado_en IS NULL`,
    [ahora, fila.canal, fila.votante_id]
  );
  return { yaEstaba: false, en: ahora };
}

module.exports = {
  generarToken, huellaDeToken, baseDelSitio,
  crearConfirmacion, buscarVigente, confirmar, DIAS_DE_VIGENCIA
};
