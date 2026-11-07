/**
 * El mensaje con que un líder invita a inscribirse por su enlace (orden 29).
 *
 * ANTES salía solo «Inscríbete con mi equipo aquí: <enlace>». Ahora es una plantilla que la campaña
 * edita (una por campaña, en `inscripcion_config.mensaje_plantilla`) y que el servidor llena con lo
 * de cada líder. Está en el servidor y no en el navegador para que haya UNA sola regla y se pueda probar.
 *
 * VARIABLES, y no hay más: {nombre_lider} (primer nombre de quien comparte), {candidato}, {eslogan}, {enlace}.
 * NO HAY {cargo} NI NÚMERO DE TARJETÓN: la plantilla es para la precampaña y no debe hablar de elección,
 * cargo, voto ni tarjetón. El validador rechaza cualquier otra llave, así que no se puede colar.
 *
 * LA REGLA DE LA LÍNEA: si a una línea le falta el dato de alguna de sus variables, se quita la línea
 * ENTERA. Nunca queda «{eslogan}» a la vista ni una línea que diga «Te invito a sumarte al equipo de .»; y
 * las líneas en blanco seguidas se reducen a una. Una llave que no es una de las cuatro cuenta como dato
 * faltante: tampoco se muestra.
 *
 * LA VERSIÓN SMS es aparte y automática: sin emojis, sin tildes (una sola «á» pasa un SMS de 160 a 70
 * caracteres) y de un solo segmento; si no cabe, se quita el eslogan.
 */
'use strict';

const pool = require('./db');
const { aspiranteDe } = require('../lib/ramas');
const { transliterarSms } = require('../lib/transliterarSms');
const { analizarTexto } = require('../lib/sms');

const VARIABLES = ['nombre_lider', 'candidato', 'eslogan', 'enlace'];
const MAX_PLANTILLA = 1000;

const PLANTILLA_SUGERIDA = [
  'Hola 👋, soy {nombre_lider}.',
  '✨ {eslogan}',
  'Te invito a sumarte al equipo de {candidato}. Juntos vamos a lograrlo.',
  '📝 Inscríbete en menos de 1 minuto, desde tu celular:',
  '👉 {enlace}',
  'Tus datos están protegidos y solo se usan para la campaña. ¡Cuento contigo!',
].join('\n');

/** Un dato de una sola línea: sin saltos ni llaves (una llave dentro de un valor no se vuelve a expandir). */
function limpiarValor(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

/** «GILDARDO» / «gildardo arias» → «Gildardo». Solo el primer nombre. */
function primerNombre(nombre) {
  const p = String(nombre || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toLocaleUpperCase('es') + p.slice(1).toLocaleLowerCase('es') : '';
}

/**
 * Llena la plantilla. Una pasada: lo que trae un valor no se interpreta como variable.
 * @param {string} plantilla
 * @param {{nombre_lider?:string, candidato?:string, eslogan?:string, enlace?:string}} valores
 */
function armarMensaje(plantilla, valores = {}) {
  const v = {};
  for (const k of VARIABLES) v[k] = k === 'enlace' ? String(valores[k] || '').trim() : limpiarValor(valores[k]);
  const salida = [];
  for (const linea of String(plantilla == null ? '' : plantilla).replace(/\r/g, '').split('\n')) {
    const llaves = [...linea.matchAll(/\{([^{}\n]*)\}/g)].map(m => m[1]);
    if (llaves.some(k => !VARIABLES.includes(k) || !v[k])) continue;    // falta un dato: la línea entera se va
    const texto = linea.replace(/\{([^{}\n]*)\}/g, (_, k) => v[k]).replace(/[ \t]+$/g, '');
    if (texto.trim() === '' && llaves.length) continue;
    if (texto.trim() === '' && salida.length && salida[salida.length - 1] === '') continue;   // nunca dos blancos seguidos
    salida.push(texto.trim() === '' ? '' : texto);
  }
  while (salida.length && salida[0] === '') salida.shift();
  while (salida.length && salida[salida.length - 1] === '') salida.pop();
  return salida.join('\n');
}

/** Lo que el administrador puede guardar. `ok:false` trae el motivo, en español. */
function validarPlantilla(texto) {
  const t = String(texto == null ? '' : texto).replace(/\r/g, '').trim();
  if (!t) return { ok: false, error: 'El mensaje no puede estar vacío.' };
  if (t.length > MAX_PLANTILLA) return { ok: false, error: `El mensaje es muy largo (máximo ${MAX_PLANTILLA} caracteres).` };
  const llaves = [...t.matchAll(/\{([^{}]*)\}/g)].map(m => m[1]);
  const raras = [...new Set(llaves.filter(k => !VARIABLES.includes(k)))];
  if (raras.length) {
    return { ok: false, error: `Variable no permitida: ${raras.map(k => '{' + k + '}').join(', ')}. Las que existen: ${VARIABLES.map(k => '{' + k + '}').join(', ')}.` };
  }
  if (/[{}]/.test(t.replace(/\{[^{}]*\}/g, ''))) return { ok: false, error: 'Hay una llave «{» o «}» suelta. Cada variable va entre llaves, completa.' };
  if (!llaves.includes('enlace')) return { ok: false, error: 'El mensaje tiene que llevar {enlace}: sin él nadie puede inscribirse.' };
  return { ok: true, plantilla: t };
}

// ---------------------------------------------------------------------------
// La versión SMS
// ---------------------------------------------------------------------------

/** Solo ASCII imprimible: sin emojis, comillas curvas ni rayas largas (cualquiera de ellos pasa el SMS a 70). */
function aAsciiSms(texto) {
  return transliterarSms(String(texto || ''))
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * «{nombre_lider}: {eslogan}. Inscribete con {candidato} aqui: {enlace}». Si no cabe en 1 SMS se quita el
 * eslogan; si aun así no cabe (un dominio larguísimo), se quita también el candidato. Devuelve
 * `{ texto, segmentos, caracteres, sinEslogan }`. El SMS lo manda el líder desde SU teléfono: no lleva la firma ni
 * el «Baja:» de los envíos de la campaña.
 */
function armarSms({ nombre_lider, candidato, eslogan, enlace }) {
  const cab = aAsciiSms(limpiarValor(nombre_lider));
  const cand = aAsciiSms(limpiarValor(candidato));
  let esl = aAsciiSms(limpiarValor(eslogan));
  const url = String(enlace || '').trim();
  const pre = cab ? `${cab}: ` : '';
  const invitacion = cand ? `Inscribete con ${cand} aqui: ${url}` : `Inscribete aqui: ${url}`;
  const candidatos = [];
  if (esl) candidatos.push({ texto: `${pre}${esl}${/[.!?]$/.test(esl) ? '' : '.'} ${invitacion}`, sinEslogan: false });
  candidatos.push({ texto: `${pre}${invitacion}`, sinEslogan: true });
  if (cand) candidatos.push({ texto: `${pre}Inscribete aqui: ${url}`, sinEslogan: true });
  let elegido = null;
  for (const c of candidatos) {
    const a = analizarTexto(c.texto);
    elegido = { texto: c.texto, segmentos: a.segmentos, caracteres: a.caracteres, sinEslogan: c.sinEslogan && !!esl };
    if (a.gsm7 && a.segmentos === 1) break;
  }
  return elegido;
}

// ---------------------------------------------------------------------------
// De dónde salen los datos
// ---------------------------------------------------------------------------

/** La plantilla guardada, o null (= la sugerida). Tolerante: sin la columna (init-db sin correr) vale la sugerida. */
async function leerPlantilla(conexion = pool) {
  try {
    const [[f]] = await conexion.query('SELECT mensaje_plantilla FROM inscripcion_config WHERE id = 1');
    const t = f && f.mensaje_plantilla ? String(f.mensaje_plantilla) : '';
    return t.trim() ? t : null;
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE') return null;
    throw err;
  }
}

/** null = volver al texto sugerido. Devuelve true. */
async function guardarPlantilla(texto, conexion = pool) {
  await conexion.query('UPDATE inscripcion_config SET mensaje_plantilla = ? WHERE id = 1', [texto == null ? null : texto]);
  return true;
}

/**
 * El candidato y el eslogan de la campaña a la que pertenece este líder. Si cuelga de un aspirante con
 * sublicencia, son los DE ÉL (la misma regla de GET /api/configuracion: la persona, y su subtítulo); si no, los
 * de la campaña (`nombre_candidato`/`slogan_campana`, y como respaldo `marca_titulo`/`marca_subtitulo`).
 */
async function marcaDelLider(usuarioId) {
  const ramaId = await aspiranteDe(pool, usuarioId).catch(() => null);
  if (ramaId) {
    const [[sub]] = await pool.query('SELECT nombre, subtitulo FROM sublicencias WHERE usuario_id = ? AND activa = 1', [ramaId]);
    const [[persona]] = await pool.query('SELECT nombre FROM usuarios WHERE id = ?', [ramaId]);
    return {
      candidato: limpiarValor((persona && persona.nombre) || (sub && sub.nombre)),
      eslogan: limpiarValor(sub && sub.subtitulo),
    };
  }
  const [[c]] = await pool.query(
    'SELECT nombre_candidato, slogan_campana, marca_titulo, marca_subtitulo FROM configuracion_campana WHERE id = 1').then(r => r).catch(() => [[null]]);
  return {
    candidato: limpiarValor(c && (c.nombre_candidato || c.marca_titulo)),
    eslogan: limpiarValor(c && (c.slogan_campana || c.marca_subtitulo)),
  };
}

/** Todo lo que necesita la pantalla «Mi enlace»: el texto largo, el SMS corto y el enlace. */
async function mensajeDelLider({ usuarioId, nombreLider, enlace }) {
  const plantilla = (await leerPlantilla()) || PLANTILLA_SUGERIDA;
  const marca = await marcaDelLider(usuarioId);
  const valores = { nombre_lider: primerNombre(nombreLider), candidato: marca.candidato, eslogan: marca.eslogan, enlace };
  return {
    texto: armarMensaje(plantilla, valores),
    sms: armarSms(valores),
    enlace,
    falta_eslogan: !marca.eslogan,
  };
}

module.exports = {
  VARIABLES, PLANTILLA_SUGERIDA, MAX_PLANTILLA,
  armarMensaje, validarPlantilla, armarSms, primerNombre, limpiarValor,
  leerPlantilla, guardarPlantilla, marcaDelLider, mensajeDelLider,
};
