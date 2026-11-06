/**
 * El enlace «Ya voté» de cada votante (Día D, fase 2).
 *
 * LO QUE ES. Una URL corta, `/v/<12 caracteres>`, que el votante recibe por SMS
 * o WhatsApp y abre sin cuenta para avisar que ya votó. No lleva ningún dato de
 * la persona: solo lleva un token, y el servidor sabe de quién es.
 *
 * PATRÓN DE /c (consentimiento), NO EL DE /b (baja). En /b el código ES la
 * identidad firmada —`v123-AbC…`— y no hay tabla. Aquí el token no dice nada y se
 * busca por su HASH en `votante_voto_tokens`, que guarda solo el SHA-256: con la
 * tabla a la vista no se puede votar por nadie. La diferencia importa porque
 * este enlace ESCRIBE un dato electoral, y porque deja un lugar donde decir
 * hasta cuándo vale.
 *
 * ¿ALEATORIO O DERIVADO? LA ORDEN PEDÍA LAS DOS COSAS Y NO CABEN JUNTAS. Pedía un
 * token aleatorio con «solo su hash guardado» y, a la vez, «reutilizar el token
 * si no ha vencido». Con un token aleatorio y solo el hash en la base, el texto
 * del token no se puede recuperar: reutilizarlo es imposible, y la alternativa
 * —generar uno nuevo en cada envío— mata el enlace que ya salió por SMS por la
 * mañana en cuanto se reenvía por la tarde. Se resolvió así: el token se DERIVA
 * con un HMAC de SESSION_SECRET y el id del votante (12 caracteres de base64url,
 * ≈72 bits, imposible de adivinar sin la llave) y SOLO SU HASH se guarda. Es el
 * mismo token cada vez que se pide, así que reutilizar es recalcular. Lo que se
 * pierde: no se puede «rotar» el enlace de una sola persona (se tendría que
 * rotar SESSION_SECRET, que también invalida los enlaces de baja).
 *
 * LA FECHA EN EL TOKEN. Ver `tokenDe`: el enlace es de ESA elección.
 *
 * VIGENCIA. Vale el día de la elección: `vence_en` es ese día a las 23:59:59,
 * hora de Colombia (la sesión de config/db.js fija -05:00, y NOW()/CURDATE() son
 * hora de Colombia). Y la página, además de `vence_en`, comprueba que HOY sea la
 * fecha de elección ACTUAL de la campaña: si alguien corrige la fecha, el enlace
 * sigue a la configuración, no a lo que se calculó al enviarlo.
 */
'use strict';

const crypto = require('crypto');
const pool = require('./db');

const LARGO_TOKEN = 12;
const PATRON_TOKEN = /^[A-Za-z0-9_-]{12}$/;

function llave() {
  const base = process.env.SESSION_SECRET;
  if (!base) return null;
  return crypto.createHmac('sha256', base).update('ya-voto:v1').digest();
}

/**
 * El token de un votante PARA UNA ELECCIÓN, o null si falta SESSION_SECRET o la fecha.
 *
 * LA FECHA DE LA ELECCIÓN ENTRA EN EL HMAC (votante_id + fecha). Por eso el enlace
 * de una misma persona es otro en cada elección —o en una segunda vuelta— y un
 * enlace viejo no puede marcar en una jornada nueva, aunque la fila de
 * `votante_voto_tokens` siga ahí: `buscarEnlaceActivo` lo recalcula con la fecha
 * ACTUAL y lo compara. Consecuencia que hay que saber: si alguien CAMBIA la fecha
 * de elección en Configuración, los enlaces ya enviados dejan de servir y hay que
 * volver a mandarlos (la pantalla de Configuración lo avisa junto a la fecha).
 */
function tokenDe(votanteId, fecha) {
  const k = llave();
  if (!k || !fecha) return null;
  return crypto.createHmac('sha256', k).update(`votante:${Number(votanteId)}:${fecha}`)
    .digest('base64url').slice(0, LARGO_TOKEN);
}

function huellaDeToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

/**
 * La dirección del sitio, de la configuración y NUNCA de la cabecera Host (que
 * manda el cliente): el mismo criterio de baja y confirmación.
 */
function baseDelSitio() {
  return process.env.LICENCIA_DOMINIO ? `https://${process.env.LICENCIA_DOMINIO}` : '';
}

/** La fecha de elección de la campaña y si HOY (hora de Colombia) es ese día. */
async function estadoDeLaElección(conexion = pool) {
  const [[c]] = await conexion.query(
    `SELECT DATE_FORMAT(fecha_eleccion, '%Y-%m-%d') AS fecha,
            (fecha_eleccion = CURDATE()) AS hoy
       FROM configuracion_campana WHERE id = 1`);
  return { fecha: (c && c.fecha) || null, esHoy: !!(c && Number(c.hoy) === 1) };
}

/**
 * Deja listos (crea o reutiliza) los enlaces de estos votantes y devuelve
 * Map(votanteId → URL completa).
 *
 * Lanza con `codigo = 'SIN_FECHA'` si la campaña no tiene fecha de elección: sin
 * ella no hay día en el que el enlace valga, y se prefiere no generar nada a
 * generar enlaces que nunca abrirían.
 */
async function asegurarEnlaces(votanteIds, base = baseDelSitio()) {
  const ids = [...new Set((votanteIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
  const mapa = new Map();
  if (!ids.length) return mapa;
  const { fecha } = await estadoDeLaElección();
  if (!fecha) {
    const e = new Error('La campaña no tiene fecha de elección: no se pueden generar enlaces «Ya voté».');
    e.codigo = 'SIN_FECHA';
    throw e;
  }
  if (!llave()) {
    const e = new Error('Falta SESSION_SECRET en el .env: no se pueden generar enlaces «Ya voté».');
    e.codigo = 'SIN_LLAVE';
    throw e;
  }
  const vence = `${fecha} 23:59:59`;
  for (let i = 0; i < ids.length; i += 500) {
    const lote = ids.slice(i, i + 500);
    await pool.query(
      `INSERT INTO votante_voto_tokens (votante_id, token_hash, vence_en) VALUES ?
       ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash), vence_en = VALUES(vence_en)`,
      [lote.map(id => [id, huellaDeToken(tokenDe(id, fecha)), vence])]);
  }
  const raiz = String(base || '').replace(/\/+$/, '');
  for (const id of ids) mapa.set(id, `${raiz}/v/${tokenDe(id, fecha)}`);
  return mapa;
}

/**
 * El votante de un token, si el enlace está ACTIVO hoy; si no, null. «No existe»,
 * «venció», «todavía no es el día» y «ya pasó el día» devuelven LO MISMO a
 * propósito: quien adivina tokens no debe poder distinguir uno que existe de uno
 * que no.
 */
async function buscarEnlaceActivo(token) {
  if (!PATRON_TOKEN.test(String(token || ''))) return null;
  const [[fila]] = await pool.query(
    `SELECT t.votante_id, v.nombre, v.puesto_id, v.puesto_votacion, v.mesa_votacion,
            v.municipio_votacion, v.departamento_votacion, vv.voto_en
       FROM votante_voto_tokens t
       JOIN votantes v ON v.id = t.votante_id
       LEFT JOIN votante_votos vv ON vv.votante_id = t.votante_id
      WHERE t.token_hash = ? AND t.vence_en >= NOW()`,
    [huellaDeToken(token)]);
  if (!fila) return null;
  const { fecha, esHoy } = await estadoDeLaElección();
  if (!esHoy) return null;
  /* EL TOKEN TIENE QUE SER EL DE ESTA ELECCIÓN. La fila puede ser de la elección
     anterior (la fecha cambió y todavía no se regeneró el enlace de esta persona):
     se recalcula con la fecha actual y se compara. Un enlace de otra jornada no marca. */
  const esperado = tokenDe(fila.votante_id, fecha);
  if (!esperado) return null;
  const a = Buffer.from(String(token)), b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return fila;
}

/**
 * El votante de un token SIN mirar la fecha ni la vigencia. Es para la BAJA («No quiero
 * recibir más mensajes»): darse de baja no puede depender de que sea el día de la elección,
 * ni de que el enlace siga vigente para votar. Solo hace falta que el token exista.
 *
 * Límite conocido: si se cambia la fecha de elección y se REGENERAN los enlaces, el token
 * viejo desaparece (se sobrescribe el hash) y su baja deja de funcionar. Quien conserve el
 * SMS de la elección anterior ya no puede darse de baja por ahí.
 */
async function buscarVotantePorToken(token) {
  if (!PATRON_TOKEN.test(String(token || ''))) return null;
  const [[fila]] = await pool.query(
    `SELECT t.votante_id FROM votante_voto_tokens t JOIN votantes v ON v.id = t.votante_id
      WHERE t.token_hash = ?`, [huellaDeToken(token)]);
  return fila ? { votante_id: fila.votante_id } : null;
}

/** Registra el voto. `INSERT IGNORE`: si ya estaba, no cambia nada —ni la hora—. */
async function registrarVoto({ votanteId, puestoId, origen, marcadoPor = null, votoEn = null }) {
  const [r] = await pool.query(
    `INSERT IGNORE INTO votante_votos (votante_id, voto_en, marcado_por, origen, puesto_id)
     VALUES (?, COALESCE(?, NOW()), ?, ?, ?)`,
    [votanteId, votoEn, marcadoPor, origen, puestoId || null]);
  return { yaEstaba: r.affectedRows === 0 };
}

module.exports = {
  tokenDe, huellaDeToken, baseDelSitio, estadoDeLaElección,
  asegurarEnlaces, buscarEnlaceActivo, buscarVotantePorToken, registrarVoto, PATRON_TOKEN,
};
