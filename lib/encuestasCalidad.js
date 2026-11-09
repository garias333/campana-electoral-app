/**
 * EL CONTROL DE CALIDAD DE LAS ENCUESTAS INTERNAS (parche 308, Fase 4).
 *
 * EL PROBLEMA. Las respuestas son anónimas, así que no hay contra-llamada: nadie puede llamar a la persona y preguntarle si de verdad contestó eso. Lo
 * único que queda para saber si un aplicador inventó respuestas son SEÑALES en la forma de las respuestas. Una señal NO prueba nada y NO rechaza
 * nada (es la misma filosofía de lib/validarCedula.js): la respuesta se guarda siempre; lo que cambia es que, si salta alguna, queda
 * `revision = 'sospechosa'` y NO entra en los resultados hasta que el administrador la revise. Revisar es reversible y queda en la auditoría.
 *
 * LAS SEÑALES (se calculan al registrar cada respuesta, nunca se le muestran a quien la aplicó: sabrías cómo esquivarlas):
 *   ritmo ............ 8 o más respuestas del mismo aplicador en cualquier tramo de 10 minutos, medido por la hora de CAPTURA (`respondida_en`) y
 *                      NO por la de la subida: una cola sin señal sube diez encuestas de golpe y esas no son sospechosas. Marca a todas las del tramo.
 *   duracion ......... se llenó en menos de 2 segundos por pregunta (y nunca menos de 5), o en menos de la cuarta parte de lo que suele tardar esa
 *                      encuesta (la mediana de las demás, con al menos 10 de muestra).
 *   misma_opcion ..... 4 o más preguntas de opción única con la misma opción (la misma posición) o 4 o más escalas con el mismo valor.
 *   vector_repetido .. 3 o más respuestas del mismo aplicador a la misma encuesta con EXACTAMENTE las mismas respuestas (huella del conjunto, sin textos).
 *   celda_lejos ...... la celda de ubicación queda a más de 15 km del centro de las demás de esa zona (necesita 5 de comparación; el catálogo no trae
 *                      coordenadas de las zonas, así que la zona se mide contra lo que ya se aplicó en ella).
 *   zona_ajena ....... la zona no está dentro del territorio de quien la aplicó ni lo contiene (solo si esa persona tiene territorios asignados).
 *
 * EL PANEL ES DEL ADMINISTRADOR Y NO LLEVA RESPUESTAS. Por aplicador: cuántas, cuántas sospechosas, la mediana de lo que tardan y qué señales saltan.
 * Quien administra necesita saber QUIÉN trabaja raro, no QUÉ contestó la gente; la lista de sospechosas trae zona, hora y señales, jamás las respuestas.
 *
 * LA COLA DE TEXTOS LIBRES es del administrador: es el único sitio donde un texto libre se ve (sin zona exacta de quién lo aplicó, sin aplicador).
 * Ahí se conserva o se borra; el texto borrado no vuelve. Los textos nunca entran en los resultados ni en el Excel.
 *
 * LAS CUOTAS son metas opcionales de respuestas por zona (para ver dónde falta). No son parte de la versión congelada de la encuesta: se cambian
 * siempre. Una meta menor que el mínimo por celda no tendría sentido (el avance no se mostraría), así que no se admite.
 */
'use strict';

const crypto = require('crypto');
const pool = require('../config/db');
const Z = require('./zonas');

const RITMO_VENTANA_MIN = 10;
const RITMO_MAX = 8;
const DURACION_PISO_SEG = 5;
const DURACION_SEG_POR_PREGUNTA = 2;
const DURACION_FRACCION_DE_LA_MEDIANA = 0.25;
const DURACION_MUESTRA_MINIMA = 10;
const MISMA_OPCION_MINIMO = 4;
const VECTOR_REPETIDO_MINIMO = 3;
const VECTOR_ITEMS_MINIMOS = 3;
const CELDA_LEJOS_KM = 15;
const CELDA_COMPARACION_MINIMA = 5;
const MAX_IDS_REVISION = 500;
const MAX_FILAS_LISTA = 300;

const SENALES = {
  ritmo: 'Muchas respuestas seguidas en poco tiempo',
  duracion: 'Se llenó demasiado rápido',
  misma_opcion: 'La misma opción en todas las preguntas',
  vector_repetido: 'Respuestas idénticas repetidas',
  celda_lejos: 'Ubicación lejos de las demás de esa zona',
  zona_ajena: 'Zona fuera del territorio de quien la aplicó',
};

const err = (estado, mensaje) => { const e = new Error(mensaje); e.estado = estado; e.mensaje = mensaje; return e; };

function mediana(v) {
  if (!v.length) return null;
  const s = v.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function kmEntre(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Marca como sospechosas las respuestas `ids` con la señal, sin tocar las que el administrador ya revisó. Devuelve cuántas cambiaron. */
async function marcar(ids, senal) {
  if (!ids.length) return 0;
  const [r] = await pool.query(
    `UPDATE encuesta_respuestas
        SET senales = CONCAT_WS(',', senales, ?), revision = IF(revision = 'ok', 'sospechosa', revision)
      WHERE id IN (?) AND revisada_por IS NULL AND (senales IS NULL OR FIND_IN_SET(?, senales) = 0)`, [senal, ids, senal]);
  return r.affectedRows;
}

/** La huella del conjunto de respuestas (sin textos): dos encuestas con las mismas respuestas dan la misma. null si hay muy pocas para comparar. */
function huellaDelVector(items) {
  const fichas = items.filter((i) => i.tipo !== 'texto').map((i) => `${i.pregunta_id}:${Number(i.nsnr) === 1 ? 'n' : (i.opcion_id || Number(i.valor_num))}`).sort();
  if (fichas.length < VECTOR_ITEMS_MINIMOS) return null;
  return crypto.createHash('sha256').update(fichas.join('|'), 'utf8').digest('hex').slice(0, 16);
}

/** Los territorios asignados a una persona de la estructura (el principal y los demás). */
async function territoriosDe(usuarioId) {
  const [f] = await pool.query(
    `SELECT e.territorio_id AS t FROM estructura e WHERE e.usuario_id = ? AND e.activo = 1 AND e.territorio_id IS NOT NULL
      UNION SELECT et.territorio_id FROM estructura e2 JOIN estructura_territorios et ON et.estructura_id = e2.id WHERE e2.usuario_id = ? AND e2.activo = 1`, [usuarioId, usuarioId]);
  return f.map((x) => Number(x.t));
}

/** Señal «ritmo» para el aplicador alrededor de `centro`: marca a todas las respuestas que caen en algún tramo con demasiadas. */
async function evaluarRitmo(aplicadaPor, centro) {
  const [filas] = await pool.query(
    `SELECT id, UNIX_TIMESTAMP(respondida_en) AS t FROM encuesta_respuestas
      WHERE aplicada_por = ? AND respondida_en BETWEEN DATE_SUB(?, INTERVAL ? MINUTE) AND DATE_ADD(?, INTERVAL ? MINUTE) ORDER BY respondida_en, id`,
    [aplicadaPor, centro, RITMO_VENTANA_MIN, centro, RITMO_VENTANA_MIN]);
  const marcadas = new Set();
  for (let j = 0; j < filas.length; j++) {
    let k = j;
    while (k < filas.length && Number(filas[k].t) - Number(filas[j].t) <= RITMO_VENTANA_MIN * 60) k++;
    if (k - j >= RITMO_MAX) for (let x = j; x < k; x++) marcadas.add(filas[x].id);
  }
  return marcar([...marcadas], 'ritmo');
}

/**
 * Calcula las señales de UNA respuesta recién guardada (y, de rebote, de otras: el ritmo y los vectores repetidos se descubren con la última).
 * Nunca lanza hacia quien registra: el llamador la envuelve en un try/catch, porque una falla del control de calidad no puede perder una respuesta.
 * Devuelve la lista de señales que le saltaron a ESTA respuesta.
 */
async function evaluar(respuestaId) {
  const [[r]] = await pool.query('SELECT * FROM encuesta_respuestas WHERE id = ?', [respuestaId]);
  if (!r) return [];
  const [items] = await pool.query(
    `SELECT i.pregunta_id, i.opcion_id, i.valor_num, i.nsnr, q.tipo FROM encuesta_respuesta_items i JOIN encuesta_preguntas q ON q.id = i.pregunta_id WHERE i.respuesta_id = ?`, [respuestaId]);
  const [[np]] = await pool.query('SELECT COUNT(*) AS n FROM encuesta_preguntas WHERE encuesta_id = ?', [r.encuesta_id]);
  const propias = [];

  // duración
  if (r.duracion_seg !== null && r.duracion_seg !== undefined) {
    const d = Number(r.duracion_seg);
    let baja = d < Math.max(DURACION_PISO_SEG, Number(np.n) * DURACION_SEG_POR_PREGUNTA);
    if (!baja) {
      const [otras] = await pool.query('SELECT duracion_seg FROM encuesta_respuestas WHERE encuesta_id = ? AND duracion_seg IS NOT NULL AND id <> ? ORDER BY id DESC LIMIT 200', [r.encuesta_id, r.id]);
      if (otras.length >= DURACION_MUESTRA_MINIMA) baja = d < DURACION_FRACCION_DE_LA_MEDIANA * mediana(otras.map((o) => Number(o.duracion_seg)));
    }
    if (baja) propias.push('duracion');
  }

  // la misma opción en todo
  const unicas = items.filter((i) => i.tipo === 'unica' && Number(i.nsnr) !== 1);
  const escalas = items.filter((i) => i.tipo === 'escala' && Number(i.nsnr) !== 1);
  if ((unicas.length >= MISMA_OPCION_MINIMO && new Set(unicas.map((i) => i.opcion_id)).size === 1)
    || (escalas.length >= MISMA_OPCION_MINIMO && new Set(escalas.map((i) => Number(i.valor_num))).size === 1)) propias.push('misma_opcion');

  // celda lejos de las demás de su zona
  if (r.celda_lat !== null && r.territorio_id) {
    const [otras] = await pool.query(
      `SELECT celda_lat, celda_lng FROM encuesta_respuestas WHERE encuesta_id = ? AND territorio_id = ? AND id <> ? AND celda_lat IS NOT NULL LIMIT 200`, [r.encuesta_id, r.territorio_id, r.id]);
    if (otras.length >= CELDA_COMPARACION_MINIMA) {
      const centro = { lat: mediana(otras.map((o) => Number(o.celda_lat))), lng: mediana(otras.map((o) => Number(o.celda_lng))) };
      if (kmEntre(centro, { lat: Number(r.celda_lat), lng: Number(r.celda_lng) }) > CELDA_LEJOS_KM) propias.push('celda_lejos');
    }
  }

  // zona fuera del territorio de quien la aplicó
  if (r.territorio_id && r.aplicada_por) {
    const suyos = await territoriosDe(r.aplicada_por);
    if (suyos.length) {
      const bajoLaZona = new Set(await Z.zonaYDescendientes(r.territorio_id));
      let dentro = suyos.some((t) => bajoLaZona.has(t));
      for (let i = 0; i < suyos.length && !dentro; i++) dentro = (await Z.zonaYDescendientes(suyos[i])).includes(Number(r.territorio_id));
      if (!dentro) propias.push('zona_ajena');
    }
  }

  // el vector de respuestas: se guarda su huella y, si ya hay 3 iguales del mismo aplicador, se marcan todas
  const vector = huellaDelVector(items);
  if (vector) {
    await pool.query('UPDATE encuesta_respuestas SET vector_hash = ? WHERE id = ?', [vector, r.id]);
    const [iguales] = await pool.query('SELECT id FROM encuesta_respuestas WHERE aplicada_por <=> ? AND encuesta_id = ? AND vector_hash = ?', [r.aplicada_por, r.encuesta_id, vector]);
    if (iguales.length >= VECTOR_REPETIDO_MINIMO) { await marcar(iguales.map((x) => x.id), 'vector_repetido'); if (iguales.some((x) => Number(x.id) === Number(r.id))) propias.push('vector_repetido'); }
  }

  // el ritmo: mira alrededor de la HORA DE CAPTURA
  if (r.aplicada_por) {
    await evaluarRitmo(r.aplicada_por, r.respondida_en);
    const [[ahora]] = await pool.query('SELECT senales FROM encuesta_respuestas WHERE id = ?', [r.id]);
    if (ahora && ahora.senales && ahora.senales.split(',').includes('ritmo')) propias.push('ritmo');
  }

  for (const s of [...new Set(propias)].filter((x) => x !== 'ritmo' && x !== 'vector_repetido')) await marcar([r.id], s);
  return [...new Set(propias)];
}

/* ------------------------------------------------------------------------------------------------------------ PANEL */

/** El panel por aplicador: cuántas respuestas, cuántas sospechosas, cuánto tardan y qué señales saltan. SIN respuestas. */
async function panelPorAplicador(encuestaId) {
  const [filas] = await pool.query(
    `SELECT r.aplicada_por AS id, u.nombre, COUNT(*) AS total, SUM(r.revision = 'ok') AS ok, SUM(r.revision = 'sospechosa') AS sospechosas, SUM(r.revision = 'excluida') AS excluidas,
            DATE_FORMAT(MIN(r.respondida_en), '%Y-%m-%d') AS primera, DATE_FORMAT(MAX(r.respondida_en), '%Y-%m-%d') AS ultima
       FROM encuesta_respuestas r LEFT JOIN usuarios u ON u.id = r.aplicada_por WHERE r.encuesta_id = ? GROUP BY r.aplicada_por, u.nombre ORDER BY total DESC LIMIT 200`, [encuestaId]);
  const [det] = await pool.query('SELECT aplicada_por, duracion_seg, senales FROM encuesta_respuestas WHERE encuesta_id = ? LIMIT 50000', [encuestaId]);
  const duraciones = new Map(), senales = new Map();
  det.forEach((d) => {
    const k = d.aplicada_por === null ? 'null' : String(d.aplicada_por);
    if (d.duracion_seg !== null) { const l = duraciones.get(k) || []; l.push(Number(d.duracion_seg)); duraciones.set(k, l); }
    if (d.senales) { const m = senales.get(k) || {}; d.senales.split(',').forEach((s) => { m[s] = (m[s] || 0) + 1; }); senales.set(k, m); }
  });
  return filas.map((f) => {
    const k = f.id === null ? 'null' : String(f.id);
    const total = Number(f.total), sosp = Number(f.sospechosas);
    return {
      aplicador_id: f.id, aplicador: f.nombre || '(cuenta eliminada)', total, ok: Number(f.ok), sospechosas: sosp, excluidas: Number(f.excluidas),
      pct_sospechosas: total ? Math.round(((sosp + Number(f.excluidas)) / total) * 100) : 0,
      mediana_seg: duraciones.has(k) ? Math.round(mediana(duraciones.get(k))) : null,
      senales: Object.entries(senales.get(k) || {}).map(([codigo, n]) => ({ codigo, texto: SENALES[codigo] || codigo, n })),
      primera: f.primera, ultima: f.ultima,
    };
  });
}

/** La lista de respuestas por revisar: zona, hora, aplicador y señales. NUNCA lo que se respondió. `ver`: 'sospechosa' | 'excluida' | 'aprobada'. */
async function listaDeRevision(encuestaId, ver = 'sospechosa') {
  const cond = ver === 'excluida' ? `r.revision = 'excluida'` : (ver === 'aprobada' ? `r.revision = 'ok' AND r.senales IS NOT NULL AND r.revisada_por IS NOT NULL` : `r.revision = 'sospechosa'`);
  const [filas] = await pool.query(
    `SELECT r.id, u.nombre AS aplicador, COALESCE(t.nombre, r.zona_texto) AS zona, r.respondida_en, r.duracion_seg, r.senales, r.revision, r.revisada_en
       FROM encuesta_respuestas r LEFT JOIN usuarios u ON u.id = r.aplicada_por LEFT JOIN territorios t ON t.id = r.territorio_id
      WHERE r.encuesta_id = ? AND ${cond} ORDER BY r.id DESC LIMIT ${MAX_FILAS_LISTA}`, [encuestaId]);
  return filas.map((f) => ({
    id: Number(f.id), aplicador: f.aplicador || '(cuenta eliminada)', zona: f.zona, respondida_en: f.respondida_en, duracion_seg: f.duracion_seg, revision: f.revision, revisada_en: f.revisada_en,
    senales: f.senales ? f.senales.split(',').map((c) => ({ codigo: c, texto: SENALES[c] || c })) : [],
  }));
}

/**
 * Revisa respuestas: 'aprobar' (entra en los resultados), 'excluir' (queda fuera) o 'restaurar' (vuelve a sospechosa, o a ok si nunca tuvo señales).
 * Todo es reversible. Devuelve { cambiadas }.
 */
async function revisar({ encuestaId, ids, accion, usuario }) {
  const lista = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!lista.length) throw err(400, 'Elige al menos una respuesta.');
  if (lista.length > MAX_IDS_REVISION) throw err(400, `Máximo ${MAX_IDS_REVISION} respuestas a la vez.`);
  let r;
  if (accion === 'aprobar') {
    [r] = await pool.query(`UPDATE encuesta_respuestas SET revision = 'ok', revisada_por = ?, revisada_en = NOW() WHERE encuesta_id = ? AND id IN (?)`, [usuario.id, encuestaId, lista]);
  } else if (accion === 'excluir') {
    [r] = await pool.query(`UPDATE encuesta_respuestas SET revision = 'excluida', revisada_por = ?, revisada_en = NOW() WHERE encuesta_id = ? AND id IN (?)`, [usuario.id, encuestaId, lista]);
  } else if (accion === 'restaurar') {
    [r] = await pool.query(`UPDATE encuesta_respuestas SET revision = IF(senales IS NULL, 'ok', 'sospechosa'), revisada_por = NULL, revisada_en = NULL WHERE encuesta_id = ? AND id IN (?)`, [encuestaId, lista]);
  } else throw err(400, 'La acción tiene que ser aprobar, excluir o restaurar.');
  return { cambiadas: r.affectedRows, pedidas: lista.length };
}

/* ------------------------------------------------------------------------------------------------------------ TEXTOS */

/** La cola de revisión de los textos libres. SIN aplicador y sin hora: el texto, su pregunta, la zona y el día. `ver`: 'pendientes' | 'todos'. */
async function textosParaRevisar(encuestaId, ver = 'pendientes') {
  const [filas] = await pool.query(
    `SELECT i.id, q.orden, q.enunciado, COALESCE(t.nombre, r.zona_texto) AS zona, DATE_FORMAT(r.respondida_en, '%Y-%m-%d') AS dia, i.valor_texto AS texto, i.texto_revisado AS revisado
       FROM encuesta_respuesta_items i JOIN encuesta_respuestas r ON r.id = i.respuesta_id JOIN encuesta_preguntas q ON q.id = i.pregunta_id LEFT JOIN territorios t ON t.id = r.territorio_id
      WHERE r.encuesta_id = ? AND i.valor_texto IS NOT NULL ${ver === 'todos' ? '' : 'AND i.texto_revisado = 0'} ORDER BY i.id DESC LIMIT ${MAX_FILAS_LISTA}`, [encuestaId]);
  return filas.map((f) => ({ id: Number(f.id), pregunta: Number(f.orden), enunciado: f.enunciado, zona: f.zona, dia: f.dia, texto: f.texto, revisado: !!Number(f.revisado) }));
}

/** 'conservar' marca el texto como visto; 'borrar' lo borra para siempre. Devuelve { cambiado }. */
async function revisarTexto({ encuestaId, itemId, accion }) {
  if (!['conservar', 'borrar'].includes(accion)) throw err(400, 'La acción tiene que ser conservar o borrar.');
  const id = Number(itemId);
  if (!Number.isInteger(id) || id < 1) throw err(404, 'Ese texto no existe.');
  const [r] = await pool.query(
    `UPDATE encuesta_respuesta_items i JOIN encuesta_respuestas r ON r.id = i.respuesta_id
        SET i.texto_revisado = 1${accion === 'borrar' ? ', i.valor_texto = NULL' : ''}
      WHERE i.id = ? AND r.encuesta_id = ? AND i.valor_texto IS NOT NULL`, [id, encuestaId]);
  if (!r.affectedRows) throw err(404, 'Ese texto no existe o ya se borró.');
  return { cambiado: true };
}

/* ----------------------------------------------------------------------------------------------------------- CUOTAS */

async function cuotasGuardadas(encuestaId) {
  const [f] = await pool.query(`SELECT c.territorio_id, c.meta, t.nombre FROM encuesta_cuotas c LEFT JOIN territorios t ON t.id = c.territorio_id WHERE c.encuesta_id = ? ORDER BY t.nombre`, [encuestaId]);
  return f.map((x) => ({ territorio_id: Number(x.territorio_id), zona: x.nombre, meta: Number(x.meta) }));
}

/** Reemplaza las cuotas de la encuesta. Cada zona tiene que ser del catálogo (del nivel vigente) y la meta, al menos el mínimo por celda. */
async function guardarCuotas(encuestaId, lista, minimo) {
  if (!Array.isArray(lista)) throw err(400, 'Las cuotas tienen que ser una lista.');
  if (lista.length > 200) throw err(400, 'Máximo 200 cuotas por encuesta.');
  if (lista.length && (await Z.nivelDeZonas()) === 'texto') throw err(400, 'Esta campaña no tiene catálogo de zonas: las cuotas necesitan zonas del catálogo.');
  const vistas = new Set(), filas = [];
  for (const c of lista) {
    const meta = Number(c && c.meta);
    if (!Number.isInteger(meta) || meta < minimo || meta > 100000) throw err(400, `La meta de cada zona tiene que ser un número entero de ${minimo} a 100000 (el mínimo por celda es ${minimo}).`);
    const zona = await Z.resolverZonaDeCampo({ territorio_id: c && c.territorio_id }, { obligatoria: true });
    if (vistas.has(zona.territorio_id)) throw err(400, `La zona «${zona.zona_texto}» está repetida.`);
    vistas.add(zona.territorio_id);
    filas.push([encuestaId, zona.territorio_id, meta]);
  }
  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    await cx.query('DELETE FROM encuesta_cuotas WHERE encuesta_id = ?', [encuestaId]);
    if (filas.length) await cx.query('INSERT INTO encuesta_cuotas (encuesta_id, territorio_id, meta) VALUES ?', [filas]);
    await cx.commit();
  } catch (e) { try { await cx.rollback(); } catch (_) { /* ya cerrada */ } throw e; } finally { cx.release(); }
  return { guardadas: filas.length };
}

module.exports = {
  SENALES, RITMO_VENTANA_MIN, RITMO_MAX, CELDA_LEJOS_KM, VECTOR_REPETIDO_MINIMO,
  evaluar, evaluarRitmo, marcar, huellaDelVector, kmEntre, panelPorAplicador, listaDeRevision, revisar, textosParaRevisar, revisarTexto, cuotasGuardadas, guardarCuotas,
};
