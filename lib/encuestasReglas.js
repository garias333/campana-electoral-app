/**
 * LAS REGLAS ELECTORALES DE LAS ENCUESTAS INTERNAS (parche 307). Aquí vive lo que las encuestas NO pueden decir ni hacer, para que el
 * constructor, la publicación y el registro de cada respuesta lean de UN solo sitio.
 *
 * 1. PRECAMPAÑA. Antes de `fecha_permitida_propaganda` (vacía = nunca) una encuesta no puede hablar de voto, elección, urnas, tarjetón, cargo
 *    ni del nombre de ningún cargo. Se ENVUELVE el validador de los recordatorios (lib/recordatorios.js `propagandaPermitida` y
 *    `palabraProhibida`, sin tocarlos: los usa el motor de envíos) y se le AGREGA lo que una encuesta nombra y un SMS no: el nombre del
 *    candidato (completo y cada apellido o nombre de 4 letras o más), «candidato», «partido(s)», «apoyo», «favorabilidad» e «imagen».
 *    El mensaje dice QUÉ palabra lo causó y en qué texto. Se evalúa con la FECHA DE CAPTURA de cada respuesta (la del toque en el celular),
 *    no con la de la subida: lo que se captura sin señal se juzga por el día en que se hizo.
 *
 * 2. EL DÍA DE LA ELECCIÓN no se aplica NINGUNA encuesta (Ley 996 de 2005, art. 28: «en ningún caso se podrán realizar o publicar encuestas,
 *    sondeos o proyecciones electorales el día de los comicios»). La orden de la campaña es más estricta que la ley y cierra TODAS, no solo
 *    las electorales: es `fecha_eleccion` de la configuración, por el día de captura en hora de Colombia.
 *
 * 3. LO POLÍTICO ES SENSIBLE. Una pregunta cuyo texto toca esas palabras (voto, candidato, partido, apoyo…) hay que MARCARLA como sensible:
 *    la opinión política es dato sensible (Ley 1581 de 2012, art. 5). Sensible implica no obligatoria y sin texto libre en la encuesta.
 *
 * 4. TEXTO LIBRE. Máximo 80 caracteres, sin 7 o más dígitos seguidos (cédula, teléfono) y sin correos.
 *
 * Nada de esto vuelve una encuesta publicable: son de USO INTERNO. Lo que aplican los líderes es una muestra de conveniencia, no
 * probabilística, y la Ley 996 (art. 28) solo deja divulgar encuestas representativas, con la ficha técnica completa.
 */
'use strict';

const pool = require('../config/db');
const R = require('./recordatorios');

const MAX_TEXTO_LIBRE = 80;
/** Lo que una encuesta nombra y un recordatorio no. «imagen(es)» va completo; las demás por raíz. */
const PALABRAS_EXTRA = ['candidat\\w*', 'partidos?', 'partidist\\w*', 'apoy\\w*', 'favorab\\w*', 'imagen', 'imagenes'];

function sinTildes(texto) {
  return String(texto === undefined || texto === null ? '' : texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** La configuración que estas reglas necesitan. Nunca lanza: sin ella, null (y entonces `propagandaPermitida` dice «todavía no»). */
async function leerConfig() {
  try {
    const [[c]] = await pool.query(
      `SELECT fecha_permitida_propaganda, nombre_candidato, cargo_aspira, DATE_FORMAT(fecha_eleccion, '%Y-%m-%d') AS fecha_eleccion
         FROM configuracion_campana WHERE id = 1`);
    return c || null;
  } catch (_) { return null; }
}

/** El nombre del candidato como patrones: la frase entera y cada palabra de 4 letras o más (un apellido «Rojas» también se nombra solo). */
function patronesDelCandidato(cfg) {
  const nombre = sinTildes(cfg && cfg.nombre_candidato).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!nombre) return [];
  const p = new Set([nombre.replace(/ /g, '\\s+')]);
  nombre.split(' ').filter((t) => t.length >= 4).forEach((t) => p.add(t));
  return [...p];
}

/** La primera palabra prohibida que trae el texto (la del validador de recordatorios, o una de las que agrega la encuesta), o null. */
function palabraProhibidaEncuesta(texto, cfg) {
  const base = R.palabraProhibida(texto, cfg || {});
  if (base) return base;
  const patrones = PALABRAS_EXTRA.concat(patronesDelCandidato(cfg));
  const re = new RegExp('(^|[^a-z0-9])(' + patrones.join('|') + ')(?=[^a-z0-9]|$)', 'i');
  const m = re.exec(sinTildes(texto));
  return m ? m[2].replace(/\s+/g, ' ') : null;
}

/** ¿El texto habla de política? Sin mirar la fecha: sirve para exigir que la pregunta se marque como sensible. */
function esTextoPolitico(texto, cfg) { return palabraProhibidaEncuesta(texto, cfg) !== null; }

/**
 * Precampaña. `textos`: [{ donde, texto }]. Si en `fecha` ya se puede hablar de propaganda, null. Si no, el primer hallazgo:
 * { palabra, donde, mensaje }.
 */
function revisarPrecampana(textos, cfg, fecha = new Date()) {
  if (R.propagandaPermitida(cfg || {}, fecha)) return null;
  for (const t of textos) {
    if (!t || !t.texto) continue;
    const palabra = palabraProhibidaEncuesta(t.texto, cfg);
    if (palabra) {
      return {
        palabra, donde: t.donde,
        mensaje: `${t.donde} dice «${palabra}». Antes de la fecha permitida de propaganda una encuesta no puede hablar de voto, elección, cargo, candidatos, partidos, apoyo, favorabilidad ni imagen. Cambia la redacción o espera a que llegue esa fecha.`,
      };
    }
  }
  return null;
}

/** ¿`fecha` es el día de la elección (hora de Colombia)? */
function esDiaDeLaEleccion(cfg, fecha = new Date()) {
  return !!(cfg && cfg.fecha_eleccion) && R.hoyTexto(fecha) === String(cfg.fecha_eleccion).slice(0, 10);
}

const MENSAJE_DIA_DE_LA_ELECCION = 'Hoy es el día de la elección y ese día no se aplica ninguna encuesta. Vuelve a abrirla mañana.';

/** Texto libre de una respuesta: null si sirve, o el motivo (en lenguaje de quien llena el formulario). */
function problemaDeTextoLibre(texto) {
  const t = String(texto === undefined || texto === null ? '' : texto);
  if (t.length > MAX_TEXTO_LIBRE) return `El texto admite hasta ${MAX_TEXTO_LIBRE} caracteres.`;
  if (t.includes('@')) return 'No escribas correos electrónicos.';
  // «300 123 4567», «300-123-4567» o «1.234.567.890» son un solo número largo para esta regla: se quitan los separadores entre dígitos.
  if (/\d{7,}/.test(t.replace(/(?<=\d)[\s.,\-]+(?=\d)/g, ''))) return 'No escribas cédulas ni teléfonos (siete o más dígitos seguidos).';
  return null;
}

module.exports = {
  MAX_TEXTO_LIBRE, PALABRAS_EXTRA, MENSAJE_DIA_DE_LA_ELECCION,
  leerConfig, palabraProhibidaEncuesta, esTextoPolitico, revisarPrecampana, esDiaDeLaEleccion, problemaDeTextoLibre, patronesDelCandidato,
};
