/**
 * EL GUION DE LA VISITA (parche 312, puerta a puerta, Fase 3): de 3 a 5 pasos cortos que el visitante LEE en el celular, plegados arriba de la ficha de
 * cada puerta («Ver guion»). Es de la campaña: lo edita SOLO el administrador, y cada cambio es una VERSIÓN nueva con su huella (como las encuestas).
 *
 * LO QUE SE GUARDA Y LO QUE NO
 *   · `puerta_guiones` guarda cada versión: sus pasos, su huella (sha256 de los pasos, 16 hex) y quién la guardó. La vigente es la última.
 *   · Cada visita guarda SOLO la huella de la versión que se le mostró al visitante (`puerta_visitas.guion_huella`), nunca el texto: con la huella se
 *     puede probar, meses después, qué se le dijo a la gente sin copiar el guion en cada visita.
 *   · Sin ninguna versión guardada rige el guion POR DEFECTO (abajo), que vive en el código y también tiene huella.
 *
 * EL GUION POR DEFECTO ES NEUTRO a propósito: saludo, presentación del equipo, escuchar las necesidades del barrio y despedida. No menciona voto,
 * elección, cargo, candidato, partido ni apoyo: una visita que la persona no pidió no puede ser propaganda antes de tiempo. La prueba lo comprueba con
 * el mismo validador que usan las encuestas (lib/encuestasReglas.js), con y sin nombre de candidato en la configuración.
 *
 * PRECAMPAÑA (`revisarPrecampana`, el MISMO validador de las encuestas), en dos momentos:
 *   · AL GUARDAR: antes de `fecha_permitida_propaganda` (vacía = nunca), un guion con palabras prohibidas NO se guarda y el mensaje dice cuál y en qué paso.
 *   · AL MOSTRAR (cada vez que se arma la lista del celular): si la versión vigente las trae (se guardó cuando se podía y la fecha cambió, o alguien tocó la
 *     base por fuera), el celular recibe el guion POR DEFECTO, marcado como sustituido. La huella que viaja es la del guion que de verdad se mostró.
 *   Lo que el celular ya bajó no se vuelve a juzgar sin señal: es el guion que el servidor juzgó en ese momento.
 */
'use strict';

const crypto = require('crypto');
const pool = require('../config/db');
const Reglas = require('./encuestasReglas');

const MIN_PASOS = 3, MAX_PASOS = 5;
const MIN_LARGO = 5, MAX_LARGO = 220;
const MAX_VERSIONES_A_LISTAR = 20;

/** El guion que rige mientras la campaña no guarde uno propio. NEUTRO: nada de voto, elección, cargo, candidato, partido ni apoyo. */
const PASOS_POR_DEFECTO = [
  'Salude con amabilidad: «Buenos días (o buenas tardes), ¿cómo está? Un gusto saludarle.»',
  'Preséntese y presente al equipo: «Soy [su nombre], del equipo con el que usted se registró. Pasaba a saludarle.»',
  'Escuche las necesidades del barrio o de la vereda: «¿Qué necesita su barrio?» Deje que cuente con calma. Si cuenta algo concreto, ofrézcale dejarlo como solicitud.',
  'Despídase con respeto: «Gracias por atenderme, que tenga un muy buen día.» Si prefiere que no se le visite más, respete su decisión y anótela.',
];

const err = (estado, mensaje) => { const e = new Error(mensaje); e.estado = estado; e.mensaje = mensaje; return e; };

function huellaDe(pasos) {
  return crypto.createHash('sha256').update(JSON.stringify({ pasos }), 'utf8').digest('hex').slice(0, 16);
}
const HUELLA_POR_DEFECTO = huellaDe(PASOS_POR_DEFECTO);

/** Los pasos limpios (sin saltos ni caracteres de control, espacios colapsados) o un error 400 en lenguaje de quien edita. */
function normalizarPasos(entrada) {
  if (!Array.isArray(entrada)) throw err(400, 'El guion tiene que ser una lista de pasos.');
  const pasos = entrada.map((p) => String(p === undefined || p === null ? '' : p).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()).filter((p) => p.length);
  if (pasos.length < MIN_PASOS || pasos.length > MAX_PASOS) throw err(400, `El guion lleva de ${MIN_PASOS} a ${MAX_PASOS} pasos (hoy tiene ${pasos.length}).`);
  pasos.forEach((p, i) => {
    if (p.length < MIN_LARGO) throw err(400, `El paso ${i + 1} es muy corto: escribe al menos ${MIN_LARGO} letras.`);
    if (p.length > MAX_LARGO) throw err(400, `El paso ${i + 1} es muy largo (${p.length}): máximo ${MAX_LARGO} caracteres. Un guion se lee de pie, en la puerta.`);
  });
  return pasos;
}

const textosDe = (pasos) => pasos.map((t, i) => ({ donde: `El paso ${i + 1}`, texto: t }));

/** El primer hallazgo de precampaña ({palabra, donde, mensaje}) o null. `cfg`: lo de lib/encuestasReglas.leerConfig(). */
function hallazgoDePrecampana(pasos, cfg, fecha = new Date()) {
  return Reglas.revisarPrecampana(textosDe(pasos), cfg, fecha);
}

function leerPasos(crudo) {
  try { const v = typeof crudo === 'string' ? JSON.parse(crudo) : crudo; return Array.isArray(v) ? v.map(String) : null; } catch (_) { return null; }
}

/** La versión vigente guardada: { id, huella, pasos, creado_en, creado_por_nombre } o null si la campaña no ha guardado ninguna. */
async function versionVigente() {
  const [[f]] = await pool.query(
    `SELECT g.id, g.huella, g.pasos, DATE_FORMAT(g.creado_en, '%Y-%m-%d %H:%i') AS creado_en, u.nombre AS creado_por_nombre
       FROM puerta_guiones g LEFT JOIN usuarios u ON u.id = g.creado_por ORDER BY g.id DESC LIMIT 1`);
  if (!f) return null;
  const pasos = leerPasos(f.pasos);
  return { id: f.id, huella: f.huella, pasos, creado_en: f.creado_en, creado_por_nombre: f.creado_por_nombre || null };
}

/**
 * LO QUE SE LE MUESTRA AL VISITANTE AHORA: { huella, pasos, sustituido, motivo }.
 * La versión vigente, salvo que (a) no haya ninguna (rige la de por defecto), (b) su contenido ya no coincida con su huella (alguien tocó la base) o
 * (c) en precampaña traiga palabras prohibidas: en (b) y (c) se muestra la de por defecto, `sustituido: true`, y el motivo (para el administrador).
 */
async function paraMostrar(ahora = new Date()) {
  const defecto = { huella: HUELLA_POR_DEFECTO, pasos: PASOS_POR_DEFECTO.slice(), sustituido: false, motivo: null, por_defecto: true };
  let v = null;
  try { v = await versionVigente(); } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') console.error('[guion] No se pudo leer el guion:', e.code || e.message);
    return defecto;                                         // sin la tabla (init-db sin correr): rige el de por defecto
  }
  if (!v) return defecto;
  if (!v.pasos || huellaDe(v.pasos) !== v.huella) return { ...defecto, sustituido: true, motivo: 'El guion guardado no coincide con su huella: se muestra el guion por defecto.' };
  const h = hallazgoDePrecampana(v.pasos, await Reglas.leerConfig(), ahora);
  if (h) return { ...defecto, sustituido: true, motivo: h.mensaje };
  return { huella: v.huella, pasos: v.pasos, sustituido: false, motivo: null, por_defecto: false };
}

/**
 * Guarda una versión nueva. Antes de la fecha permitida de propaganda, con palabras prohibidas: 422 y no se guarda. Si es igual a la vigente (misma
 * huella), no se crea otra versión. Devuelve { huella, sin_cambio, version_id }.
 */
async function guardar({ pasos: entrada, usuario, ahora = new Date() }) {
  const pasos = normalizarPasos(entrada);
  const cfg = await Reglas.leerConfig();
  const h = hallazgoDePrecampana(pasos, cfg, ahora);
  if (h) throw err(422, h.mensaje);
  const huella = huellaDe(pasos);
  const vigente = await versionVigente().catch(() => null);
  const rige = vigente && vigente.pasos ? vigente.huella : HUELLA_POR_DEFECTO;
  if (rige === huella) return { huella, sin_cambio: true, version_id: vigente ? vigente.id : null };
  const [r] = await pool.query('INSERT INTO puerta_guiones (huella, pasos, creado_por) VALUES (?, ?, ?)', [huella, JSON.stringify(pasos), usuario ? usuario.id : null]);
  return { huella, sin_cambio: false, version_id: Number(r.insertId) };
}

/** Las últimas versiones (sin el texto: solo cuándo, quién y la huella; el texto vigente se lee aparte). */
async function historial() {
  const [filas] = await pool.query(
    `SELECT g.id, g.huella, DATE_FORMAT(g.creado_en, '%Y-%m-%d %H:%i') AS creado_en, u.nombre AS por,
            (SELECT COUNT(*) FROM puerta_visitas v WHERE v.guion_huella = g.huella) AS visitas
       FROM puerta_guiones g LEFT JOIN usuarios u ON u.id = g.creado_por ORDER BY g.id DESC LIMIT ?`, [MAX_VERSIONES_A_LISTAR]);
  return filas.map((f) => ({ id: f.id, huella: f.huella, creado_en: f.creado_en, por: f.por || null, visitas: Number(f.visitas) }));
}

/** ¿La huella es la de por defecto o la de una versión guardada? Para decidir si se anota en la visita. */
async function huellaConocida(huella) {
  const h = String(huella || '').trim().toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(h)) return null;
  if (h === HUELLA_POR_DEFECTO) return h;
  try {
    const [[f]] = await pool.query('SELECT 1 AS ok FROM puerta_guiones WHERE huella = ? LIMIT 1', [h]);
    return f ? h : null;
  } catch (_) { return null; }
}

module.exports = {
  MIN_PASOS, MAX_PASOS, MIN_LARGO, MAX_LARGO, PASOS_POR_DEFECTO, HUELLA_POR_DEFECTO,
  huellaDe, normalizarPasos, hallazgoDePrecampana, versionVigente, paraMostrar, guardar, historial, huellaConocida,
};
