/**
 * El enlace de inscripción de cada líder (/i/<código>).
 *
 * LO QUE ES. Una URL corta y un QR por persona de la estructura. Quien los abre
 * se inscribe solo desde su celular y queda como votante de ESE líder, con
 * origen «enlace_lider» y pendiente de confirmar (ver config/inscripcionRegistro.js).
 *
 * EL CÓDIGO ES ALEATORIO Y SE GUARDA EN CLARO; NO ES UN HMAC. A diferencia del
 * enlace «Ya voté» (config/yaVotoEnlace.js, derivado de SESSION_SECRET y por
 * tanto imposible de rotar por persona), éste tiene que poder cambiarse para UN
 * solo líder —se difundió donde no debía, o salió del equipo— sin tocar a los
 * demás. El precio es que la tabla a la vista permite abrir los formularios; lo
 * único que se puede hacer con un código es INSCRIBIR a alguien en la lista de
 * ese líder, que es para lo que está hecho.
 *
 * EL ID DEL USUARIO NO VIAJA EN LA URL. Ni en claro ni dentro de una firma
 * (el código de baja `u123-…` sí lo lleva; aquí se evita a propósito).
 *
 * VALE SOLO MIENTRAS EL LÍDER ESTÉ EN LA CAMPAÑA: `buscarEnlaceActivo` exige
 * cuenta activa Y una fila de estructura activa. Si sale, el enlace deja de
 * servir sin borrar nada; si vuelve, vuelve a servir.
 */
'use strict';

const crypto = require('crypto');
const pool = require('./db');

/**
 * Sin 0, O, 1, I ni L: lo que se confunde al dictarlo o leerlo en un afiche.
 * 31 símbolos ^ 8 posiciones ≈ 8,5 × 10^11 códigos (≈ 40 bits). Con el límite de
 * intentos fallidos por IP de la página pública, adivinar uno no es práctico.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LARGO_CODIGO = 8;
const PATRON_CODIGO = new RegExp(`^[${ALFABETO}]{${LARGO_CODIGO}}$`);

/** Quiénes pueden tener enlace. Los roles se leen de `roles.nombre`. */
const ROLES_CON_ENLACE = ['coordinador', 'lider', 'sublider', 'aspirante_concejo'];

function generarCodigo() {
  let c = '';
  // randomInt es uniforme (sin sesgo de módulo) y criptográficamente seguro.
  for (let i = 0; i < LARGO_CODIGO; i++) c += ALFABETO[crypto.randomInt(0, ALFABETO.length)];
  return c;
}

/** Acepta minúsculas y espacios (alguien lo copió a mano); devuelve null si no es un código posible. */
function normalizarCodigo(valor) {
  const c = String(valor || '').trim().toUpperCase();
  return PATRON_CODIGO.test(c) ? c : null;
}

/**
 * La dirección del sitio, de la configuración y NUNCA de la cabecera Host (que la
 * manda el cliente): la misma regla de /b, /c y /v. Sin LICENCIA_DOMINIO se
 * devuelve '' y el que llama decide (la pantalla del líder usa el origen de la
 * propia página, que es el del navegador de quien la abrió con sesión).
 */
function baseDelSitio() {
  return process.env.LICENCIA_DOMINIO ? `https://${process.env.LICENCIA_DOMINIO}` : '';
}

function urlDelEnlace(codigo, base = baseDelSitio()) {
  return `${String(base || '').replace(/\/+$/, '')}/i/${codigo}`;
}

/**
 * El enlace del usuario, creándolo si aún no tiene. NO mira si el usuario puede
 * tenerlo: eso lo decide quien llama con `puedeTenerEnlace`.
 */
async function obtenerOCrearEnlace(usuarioId, conexion = pool) {
  for (let intento = 0; intento < 8; intento++) {
    const [[fila]] = await conexion.query(
      'SELECT id, usuario_id, codigo, activo, creado_en, rotado_en FROM inscripcion_enlaces WHERE usuario_id = ?',
      [usuarioId]);
    if (fila) return fila;
    try {
      await conexion.query('INSERT INTO inscripcion_enlaces (usuario_id, codigo) VALUES (?, ?)',
        [usuarioId, generarCodigo()]);
    } catch (err) {
      // Choque de código (casi imposible) o dos pedidos a la vez: se vuelve a leer / se reintenta.
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
  }
  throw new Error('No se pudo crear el enlace de inscripción.');
}

/**
 * Cambia el código del enlace. El anterior deja de servir en el acto.
 * No reactiva un enlace que un coordinador desactivó.
 */
async function rotarEnlace(usuarioId, conexion = pool) {
  await obtenerOCrearEnlace(usuarioId, conexion);
  for (let intento = 0; intento < 8; intento++) {
    try {
      await conexion.query(
        'UPDATE inscripcion_enlaces SET codigo = ?, rotado_en = NOW() WHERE usuario_id = ?',
        [generarCodigo(), usuarioId]);
      return obtenerOCrearEnlace(usuarioId, conexion);
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
  }
  throw new Error('No se pudo cambiar el enlace de inscripción.');
}

/**
 * El enlace de un código SI ESTÁ VIVO: enlace activo, cuenta activa, rol que
 * puede tenerlo y una fila de estructura activa. Si no, null. Un código
 * inexistente, desactivado o de alguien que ya no está devuelven LO MISMO.
 */
async function buscarEnlaceActivo(codigoCrudo, conexion = pool) {
  const codigo = normalizarCodigo(codigoCrudo);
  if (!codigo) return null;
  const [[fila]] = await conexion.query(
    `SELECT e.id AS enlace_id, e.usuario_id, e.codigo, u.nombre, r.nombre AS rol
       FROM inscripcion_enlaces e
       JOIN usuarios u ON u.id = e.usuario_id
       JOIN roles r ON r.id = u.rol_id
      WHERE e.codigo = ? AND e.activo = 1 AND u.activo = 1
        AND r.nombre IN (?)
        AND EXISTS (SELECT 1 FROM estructura s
                     WHERE s.usuario_id = u.id AND s.activo = 1 AND s.cargo <> 'testigo')
      LIMIT 1`,
    [codigo, ROLES_CON_ENLACE]);
  return fila || null;
}

/** ¿Este usuario (de la sesión) puede tener enlace? Rol permitido y estructura activa. */
async function puedeTenerEnlace(usuarioId, conexion = pool) {
  const [[fila]] = await conexion.query(
    `SELECT 1 AS ok FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.id = ? AND u.activo = 1 AND r.nombre IN (?)
        AND EXISTS (SELECT 1 FROM estructura s
                     WHERE s.usuario_id = u.id AND s.activo = 1 AND s.cargo <> 'testigo')`,
    [usuarioId, ROLES_CON_ENLACE]);
  return !!fila;
}

/**
 * A QUIÉN QUEDA LA PERSONA INSCRITA. Es la regla de `resolverAtribucion`
 * (routes/votantes.routes.js) aplicada al DUEÑO DEL ENLACE en vez de a quien tiene
 * la sesión: un líder se queda con sus inscritos (`lider_id` = él); a un sublíder
 * lo cuenta su líder (`lider_id` = el supervisor) y él queda en `sublider_id`.
 * Coordinador y aspirante: `lider_id` = él mismo, como cuando registran a mano.
 *
 * El servidor lo calcula de la estructura guardada; nada de esto llega del navegador.
 */
async function atribucionDe(enlace, conexion = pool) {
  if (enlace.rol !== 'sublider') return { lider_id: enlace.usuario_id, sublider_id: null };
  // Filtrado por cargo='usuario', como en el formulario: si la cuenta también es
  // testigo hay dos filas y se quedaría con la equivocada.
  const [[propia]] = await conexion.query(
    `SELECT supervisor_id FROM estructura WHERE usuario_id = ? AND cargo = 'usuario' AND activo = 1
      ORDER BY id DESC LIMIT 1`, [enlace.usuario_id]);
  return { lider_id: propia ? propia.supervisor_id : null, sublider_id: enlace.usuario_id };
}

// ---------------------------------------------------------------------------
// Ajustes (inscripcion_config, una sola fila)
// ---------------------------------------------------------------------------

const AJUSTES_POR_DEFECTO = { habilitado: 1, limite_enlace_dia: 200, limite_telefono_dia: 3, segundos_minimos: 4 };

async function leerAjustes(conexion = pool) {
  try {
    const [[f]] = await conexion.query(
      'SELECT habilitado, limite_enlace_dia, limite_telefono_dia, segundos_minimos FROM inscripcion_config WHERE id = 1');
    return f ? { ...AJUSTES_POR_DEFECTO, ...f } : { ...AJUSTES_POR_DEFECTO };
  } catch (err) {
    // Sin la tabla (campaña que aún no corrió init-db) la inscripción queda APAGADA:
    // es lo seguro, y la página lo dice como «no activo».
    if (err.code === 'ER_NO_SUCH_TABLE') return { ...AJUSTES_POR_DEFECTO, habilitado: 0 };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// El pase del formulario: demuestra que la página se pidió hace un rato
// ---------------------------------------------------------------------------

function llaveDelPase() {
  const base = process.env.SESSION_SECRET;
  if (!base) return null;
  return crypto.createHmac('sha256', base).update('inscripcion-pase:v1').digest();
}

/**
 * `<segundos>.<huella de la política>.<firma>`. Firma el código del enlace, el
 * momento en que se pintó el formulario y la versión de la política que se MOSTRÓ.
 *
 * Sirve para dos cosas: (1) el tiempo mínimo —un robot que envía en 100 ms no
 * puede falsificar una hora anterior—, y (2) que la versión de la política que
 * queda como evidencia sea la que la persona vio, no la que haya hoy al
 * enviar (la misma razón por la que `votantes.routes.js` no recalcula la huella).
 */
function emitirPase(codigo, huellaPolitica, ahoraMs = Date.now()) {
  const k = llaveDelPase();
  if (!k) return null;
  const seg = Math.floor(ahoraMs / 1000);
  const huella = huellaPolitica || '-';
  const firma = crypto.createHmac('sha256', k).update(`${codigo}|${seg}|${huella}`).digest('base64url').slice(0, 22);
  return `${seg}.${huella}.${firma}`;
}

const VIGENCIA_PASE_SEG = 12 * 60 * 60;

/** { ok, edadSeg, huellaPolitica } o { ok:false, motivo: 'invalido' | 'caducado' } */
function verificarPase(codigo, pase, ahoraMs = Date.now()) {
  const k = llaveDelPase();
  const m = /^(\d{9,11})\.([0-9a-f]{16}|-)\.([A-Za-z0-9_-]{22})$/.exec(String(pase || ''));
  if (!k || !m) return { ok: false, motivo: 'invalido' };
  const esperado = crypto.createHmac('sha256', k).update(`${codigo}|${m[1]}|${m[2]}`).digest('base64url').slice(0, 22);
  const a = Buffer.from(m[3]), b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, motivo: 'invalido' };
  const edad = Math.floor(ahoraMs / 1000) - Number(m[1]);
  if (edad < 0 || edad > VIGENCIA_PASE_SEG) return { ok: false, motivo: 'caducado' };
  return { ok: true, edadSeg: edad, huellaPolitica: m[2] === '-' ? null : m[2] };
}

module.exports = {
  ALFABETO, LARGO_CODIGO, ROLES_CON_ENLACE, AJUSTES_POR_DEFECTO, VIGENCIA_PASE_SEG,
  generarCodigo, normalizarCodigo, baseDelSitio, urlDelEnlace,
  obtenerOCrearEnlace, rotarEnlace, buscarEnlaceActivo, puedeTenerEnlace, atribucionDe,
  leerAjustes, emitirPase, verificarPase,
};
