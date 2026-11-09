/**
 * LOS RESULTADOS DE LAS ENCUESTAS INTERNAS (parche 308, Fase 3): agregados por zona y pregunta, con el mínimo por celda, la cobertura frente a los
 * votantes registrados y las cuotas. Nunca una respuesta suelta, nunca un texto libre, nunca quién la aplicó.
 *
 * LAS REGLAS QUE NO SE NEGOCIAN
 *   1. SOLO ENTRA LO QUE ESTÁ BIEN. Cuentan las respuestas con `revision = 'ok'`. Las sospechosas y las excluidas (lib/encuestasCalidad.js) quedan
 *      fuera hasta que el administrador las revise; solo se dice CUÁNTAS hay fuera, no cuáles ni dónde.
 *   2. MÍNIMO POR CELDA. Una celda es una zona en una pregunta; se muestra solo si tiene al menos `minimoPorCelda()` respuestas a esa pregunta
 *      (5 de fábrica; configurable solo HACIA ARRIBA; igual para el administrador, que no necesita ver a tres personas para entender un barrio).
 *   3. «OTRAS ZONAS» PARA QUE NO SE PUEDA RESTAR. Si solo se ocultara la celda chica y se mostraran el total y todas las demás, una resta devolvería
 *      justo lo que se ocultó. Por eso las celdas chicas se AGRUPAN en «Otras zonas» y el grupo se muestra solo si suma el mínimo; si no llega, se le
 *      suma la celda visible más pequeña, y así hasta llegar o quedarse sin celdas. Si ni todas juntas llegan, no se muestra nada (ni el total).
 *      El grupo no dice qué zonas lo forman; sí cuántas son y que existen: «celdas omitidas» queda visible.
 *   4. SIN FILTROS QUE PERMITAN RESTAR. No hay filtro por fecha ni por aplicador: dos consultas que difieren en un día o en una persona podrían
 *      restarse y dejar al descubierto a una sola respuesta. Lo único que cambia la vista es el ALCANCE de quien mira y el nivel de agrupación
 *      (zona, o la zona que la contiene).
 *   5. UNA PREGUNTA DE TEXTO NO TIENE AGREGADO. Los textos libres solo existen en la cola de revisión del administrador.
 *   6. NÚMEROS Y ESCALAS: promedio y mediana de la celda, nunca el mínimo ni el máximo (serían la respuesta de una persona).
 *
 * Las respuestas ya llegan acotadas por el alcance de quien mira (lib/alcanceEncuestas.js); el mínimo se aplica DESPUÉS, sobre lo que quedó.
 */
'use strict';

const pool = require('../config/db');
const { alcanceEncuestas } = require('./alcanceEncuestas');
const { zonaYDescendientes } = require('./zonas');
const { condicionAlcanceVotantes, parametrosAlcanceVotantes } = require('./alcanceVotantes');
const E = require('./encuestas');

const MINIMO_PISO = 5;
const MINIMO_TOPE = 1000;
const MAX_ZONAS_COBERTURA = 300;
const MARCA = 'Uso interno – no publicable';

/** El mínimo por celda vigente: el de la configuración, nunca menos de 5. */
async function minimoPorCelda() {
  try {
    const [[c]] = await pool.query('SELECT encuesta_min_celda AS m FROM configuracion_campana WHERE id = 1');
    const m = c ? Number(c.m) : MINIMO_PISO;
    return Number.isInteger(m) && m >= MINIMO_PISO ? Math.min(m, MINIMO_TOPE) : MINIMO_PISO;
  } catch (_) { return MINIMO_PISO; }             // sin la columna (el código llegó antes que init-db): el piso
}

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
function mediana(v) {
  if (!v.length) return null;
  const s = v.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Lo que se dice de un conjunto de filas de UNA pregunta: n (personas que la contestaron), «no sabe», y su resumen según el tipo. */
function resumir(p, filas) {
  const personas = new Set(filas.map((f) => f.respuesta_id));
  const n = personas.size;
  const nsnr = new Set(filas.filter((f) => Number(f.nsnr) === 1).map((f) => f.respuesta_id)).size;
  const base = { n, nsnr, pct_nsnr: n ? r1((nsnr / n) * 100) : 0 };
  if (p.tipo === 'unica' || p.tipo === 'multiple') {
    const por = new Map();
    filas.forEach((f) => { if (f.opcion_id) por.set(f.opcion_id, (por.get(f.opcion_id) || 0) + 1); });
    return { ...base, opciones: (p.opciones || []).map((o) => ({ id: o.id, texto: o.texto, n: por.get(o.id) || 0, pct: n ? r1(((por.get(o.id) || 0) / n) * 100) : 0 })) };
  }
  const valores = filas.filter((f) => Number(f.nsnr) !== 1 && f.valor_num !== null && f.valor_num !== undefined).map((f) => Number(f.valor_num));
  const medio = valores.length ? r2(valores.reduce((a, b) => a + b, 0) / valores.length) : null;
  if (p.tipo === 'escala') {
    const dist = [1, 2, 3, 4, 5].map((v) => ({ valor: v, n: valores.filter((x) => x === v).length }));
    return { ...base, promedio: medio, distribucion: dist };
  }
  return { ...base, promedio: medio, mediana: valores.length ? r2(mediana(valores)) : null };    // número
}

/**
 * La regla 3: de las celdas con su `n`, cuáles se muestran, cuáles forman «Otras zonas» y si no se puede mostrar nada.
 * Devuelve { visibles, otras: [celdas] | null, oculto }.
 */
function aplicarMinimo(celdas, k) {
  const visibles = celdas.filter((c) => c.n >= k).sort((a, b) => b.n - a.n || String(a.nombre).localeCompare(String(b.nombre), 'es'));
  const omitidas = celdas.filter((c) => c.n < k);
  if (!omitidas.length) return { visibles, otras: null, oculto: false };
  let suma = omitidas.reduce((a, c) => a + c.n, 0);
  while (suma < k && visibles.length) { const c = visibles.pop(); omitidas.push(c); suma += c.n; }     // la visible más chica se une al grupo
  if (suma < k) return { visibles: [], otras: null, oculto: true };                                      // ni todas juntas llegan al mínimo
  return { visibles, otras: omitidas, oculto: false };
}

/** SQL de la zona según el nivel de agrupación: la propia zona, o la que la contiene. */
function sqlZona(agrupar) {
  return agrupar === 'padre'
    ? { clave: `COALESCE(CONCAT('t', p.id), CONCAT('t', t.id), CONCAT('x', LOWER(TRIM(r.zona_texto))))`, nombre: `COALESCE(p.nombre, t.nombre, r.zona_texto)`, id: 'COALESCE(p.id, t.id)' }
    : { clave: `COALESCE(CONCAT('t', t.id), CONCAT('x', LOWER(TRIM(r.zona_texto))))`, nombre: `COALESCE(t.nombre, r.zona_texto)`, id: 't.id' };
}

/** Las respuestas que cuentan (ok y dentro del alcance), cada una con su zona. */
async function respuestasQueCuentan(encuestaId, alcance, agrupar) {
  const a = alcanceEncuestas(alcance, 'r');
  const z = sqlZona(agrupar);
  const [filas] = await pool.query(
    `SELECT r.id, ${z.clave} AS clave, ${z.nombre} AS nombre, ${z.id} AS zona_id
       FROM encuesta_respuestas r LEFT JOIN territorios t ON t.id = r.territorio_id LEFT JOIN territorios p ON p.id = t.padre_id
      WHERE r.encuesta_id = ? AND r.revision = 'ok' AND ${a.sql}`, [encuestaId, ...a.valores]);
  return filas;
}

/** Cuántas respuestas del alcance quedan fuera por revisión (sospechosas o excluidas): una cifra, nunca cuáles. */
async function fueraPorRevision(encuestaId, alcance) {
  const a = alcanceEncuestas(alcance, 'r');
  const [[f]] = await pool.query(`SELECT COUNT(*) AS n FROM encuesta_respuestas r WHERE r.encuesta_id = ? AND r.revision <> 'ok' AND ${a.sql}`, [encuestaId, ...a.valores]);
  return Number(f.n);
}

/**
 * Votantes registrados en un conjunto de zonas y en todo lo que cuelga de ellas, dentro del alcance de quien mira. Cada votante cuenta UNA vez:
 * agrupando por «la zona que contiene», una comuna y su municipio se solapan, y sumar sus cifras por separado contaría dos veces a los mismos.
 */
async function votantesDeLasZonas(zonaIds, alcance) {
  const ids = new Set();
  for (const z of zonaIds) (await zonaYDescendientes(z)).forEach((x) => ids.add(x));
  if (!ids.size) return 0;
  const cond = [condicionAlcanceVotantes(alcance, 'v'), 'v.territorio_id IN (?)'];
  const [[f]] = await pool.query(`SELECT COUNT(*) AS n FROM votantes v WHERE ${cond.join(' AND ')}`, [...parametrosAlcanceVotantes(alcance), [...ids]]);
  return Number(f.n);
}

/**
 * LA COBERTURA: cuántas respuestas tiene cada zona frente a cuántos votantes hay registrados en ella. Sirve para ver el sesgo: una zona con el 40 %
 * de las respuestas y el 10 % de los votantes está sobrerrepresentada. Las zonas chicas se agrupan en «Otras zonas» con la misma regla del mínimo.
 */
async function coberturaPorZona(personasPorZona, k, alcance) {
  const celdas = [...personasPorZona.values()].map((c) => ({ clave: c.clave, nombre: c.nombre, zona_id: c.zona_id, n: c.n }));
  const { visibles, otras, oculto } = aplicarMinimo(celdas, k);
  if (oculto) return { zonas: [], otras: null, oculto: true, votantes_total: null };
  const zonas = [];
  for (const c of visibles.slice(0, MAX_ZONAS_COBERTURA)) {
    zonas.push({ zona: c.nombre, respuestas: c.n, votantes: c.zona_id ? await votantesDeLasZonas([c.zona_id], alcance) : null, _id: c.zona_id });
  }
  let otrasFila = null;
  if (otras) {
    const conId = otras.filter((c) => c.zona_id).map((c) => c.zona_id);
    otrasFila = { zonas: otras.length, respuestas: otras.reduce((a, c) => a + c.n, 0), votantes: conId.length ? await votantesDeLasZonas(conId, alcance) : null };
  }
  const idsTodas = zonas.map((z) => z._id).concat(otras ? otras.map((c) => c.zona_id) : []).filter(Boolean);
  const votantesTotal = idsTodas.length ? await votantesDeLasZonas(idsTodas, alcance) : 0;
  const respuestasTotal = zonas.reduce((a, z) => a + z.respuestas, 0) + (otrasFila ? otrasFila.respuestas : 0);
  const marca = (fila) => {
    delete fila._id;
    fila.pct_muestra = respuestasTotal ? r1((fila.respuestas / respuestasTotal) * 100) : 0;
    fila.pct_votantes = fila.votantes !== null && votantesTotal ? r1((fila.votantes / votantesTotal) * 100) : null;
    fila.por_100 = fila.votantes ? r1((fila.respuestas / fila.votantes) * 100) : null;
    fila.sesgo = fila.pct_votantes === null || fila.pct_votantes === 0 ? null
      : (fila.pct_muestra / fila.pct_votantes >= 1.5 ? 'sobre' : (fila.pct_muestra / fila.pct_votantes <= 0.5 ? 'sub' : 'parejo'));
  };
  zonas.forEach(marca);
  if (otrasFila) marca(otrasFila);
  return { zonas, otras: otrasFila, oculto: false, votantes_total: votantesTotal };
}

/** Las cuotas de la encuesta con su avance (el avance exacto solo si llega al mínimo por celda; si no, «menos de k»). */
async function cuotasConAvance(encuestaId, alcance, k) {
  const [cuotas] = await pool.query(
    `SELECT c.territorio_id, c.meta, t.nombre FROM encuesta_cuotas c LEFT JOIN territorios t ON t.id = c.territorio_id WHERE c.encuesta_id = ? ORDER BY t.nombre`, [encuestaId]);
  if (!cuotas.length) return [];
  const a = alcanceEncuestas(alcance, 'r');
  const salida = [];
  for (const c of cuotas) {
    const ids = await zonaYDescendientes(c.territorio_id);
    let n = 0;
    if (ids.length) {
      const [[f]] = await pool.query(
        `SELECT COUNT(*) AS n FROM encuesta_respuestas r WHERE r.encuesta_id = ? AND r.revision = 'ok' AND r.territorio_id IN (?) AND ${a.sql}`, [encuestaId, ids, ...a.valores]);
      n = Number(f.n);
    }
    const visible = n >= k;
    salida.push({ territorio_id: c.territorio_id, zona: c.nombre || `Zona ${c.territorio_id}`, meta: Number(c.meta), avance: visible ? n : null, menos_de: visible ? null : k,
      pct: visible ? Math.min(100, Math.round((n / Number(c.meta)) * 100)) : null, completa: visible && n >= Number(c.meta) });
  }
  return salida;
}

/**
 * El resultado de UNA encuesta para quien mira. `agrupar`: 'zona' (por omisión) o 'padre' (la zona que contiene a la zona de cada respuesta, para
 * juntar barrios chicos en su comuna). Devuelve null si la encuesta no existe o todavía es un borrador (no tiene respuestas).
 */
async function resultados({ encuestaId, alcance, agrupar = 'zona' }) {
  const detalle = await E.detalle(encuestaId);
  if (!detalle || detalle.estado === 'borrador') return null;
  agrupar = agrupar === 'padre' ? 'padre' : 'zona';
  const k = await minimoPorCelda();
  const resp = await respuestasQueCuentan(encuestaId, alcance, agrupar);
  const zonaDe = new Map(resp.map((r) => [Number(r.id), r]));
  const personasPorZona = new Map();
  resp.forEach((r) => {
    const c = personasPorZona.get(r.clave) || { clave: r.clave, nombre: r.nombre, zona_id: r.zona_id ? Number(r.zona_id) : null, n: 0 };
    c.n++;
    personasPorZona.set(r.clave, c);
  });

  // Las filas de respuesta de las preguntas que no son de texto, por pregunta y por zona.
  const porPregunta = new Map(detalle.preguntas.map((p) => [p.id, new Map()]));
  if (resp.length) {
    const a = alcanceEncuestas(alcance, 'r');
    const [items] = await pool.query(
      `SELECT i.respuesta_id, i.pregunta_id, i.opcion_id, i.valor_num, i.nsnr
         FROM encuesta_respuesta_items i JOIN encuesta_respuestas r ON r.id = i.respuesta_id JOIN encuesta_preguntas q ON q.id = i.pregunta_id
        WHERE r.encuesta_id = ? AND r.revision = 'ok' AND ${a.sql} AND q.tipo <> 'texto'`, [encuestaId, ...a.valores]);
    items.forEach((i) => {
      const z = zonaDe.get(Number(i.respuesta_id));
      const celdas = porPregunta.get(i.pregunta_id);
      if (!z || !celdas) return;
      const c = celdas.get(z.clave) || { clave: z.clave, nombre: z.nombre, zona_id: z.zona_id, filas: [] };
      c.filas.push(i);
      celdas.set(z.clave, c);
    });
  }

  const preguntas = detalle.preguntas.map((p) => {
    if (p.tipo === 'texto') return { id: p.id, orden: p.orden, tipo: p.tipo, enunciado: p.enunciado, sensible: p.sensible, sin_agregado: true };
    const celdas = [...porPregunta.get(p.id).values()].map((c) => ({ ...c, n: new Set(c.filas.map((f) => f.respuesta_id)).size }));
    const { visibles, otras, oculto } = aplicarMinimo(celdas, k);
    const base = { id: p.id, orden: p.orden, tipo: p.tipo, enunciado: p.enunciado, sensible: p.sensible, obligatoria: p.obligatoria };
    if (oculto) return { ...base, oculta: true, celdas: [], otras: null, total: null, celdas_omitidas: celdas.length };
    const todas = visibles.concat(otras || []);
    return {
      ...base, oculta: false,
      total: resumir(p, todas.flatMap((c) => c.filas)),
      celdas: visibles.map((c) => ({ zona: c.nombre, ...resumir(p, c.filas) })),
      otras: otras ? { zonas: otras.length, ...resumir(p, otras.flatMap((c) => c.filas)) } : null,
      celdas_omitidas: otras ? otras.length : 0,
    };
  });

  const totalOk = resp.length;
  return {
    marca: MARCA,
    encuesta: { id: detalle.id, titulo: detalle.titulo, estado: detalle.estado, estado_etiqueta: detalle.estado_etiqueta, huella: detalle.huella, sensible: detalle.sensible },
    minimo: k, agrupar,
    respuestas: totalOk >= k ? totalOk : null, menos_de: totalOk >= k ? null : k,
    fuera_por_revision: await fueraPorRevision(encuestaId, alcance),
    preguntas,
    cobertura: totalOk >= k ? await coberturaPorZona(personasPorZona, k, alcance) : { zonas: [], otras: null, oculto: true, votantes_total: null },
    cuotas: await cuotasConAvance(encuestaId, alcance, k),
  };
}

/** El libro de Excel como hojas de filas (aoa): Notas, Resultados, Cobertura y Cuotas. Cada hoja empieza con la marca. */
function hojasDeExcel(res, { fecha, generador }) {
  const lleno = (x) => (x === null || x === undefined ? '' : x);
  const notas = [
    [MARCA], [],
    ['Resultados de la encuesta', res.encuesta.titulo],
    ['Versión (huella)', res.encuesta.huella],
    ['Estado', res.encuesta.estado_etiqueta],
    ['Generado el', fecha],
    ['Agrupado por', res.agrupar === 'padre' ? 'La zona que contiene a la de cada respuesta' : 'Zona de cada respuesta'],
    ['Respuestas contadas', res.respuestas === null ? `menos de ${res.menos_de}` : res.respuestas],
    ['Respuestas fuera por revisión (sospechosas o excluidas)', res.fuera_por_revision],
    ['Mínimo de respuestas por celda', res.minimo],
    [], ['Cómo leer este archivo'],
    [`Una celda es una zona en una pregunta. Solo se muestra si tiene al menos ${res.minimo} respuestas; las demás se agrupan en «Otras zonas» y, si no suman ${res.minimo}, no se muestran.`],
    ['Es un archivo agregado: no trae respuestas sueltas, ni textos libres, ni quién aplicó cada encuesta.'],
    ['Lo que aplica el equipo es una muestra de conveniencia, no una encuesta técnica: no se divulga ni se presenta como encuesta de opinión.'],
    ['Generado por', generador],
  ];
  const filas = [[MARCA], [], ['Pregunta', 'Tipo', 'Zona', 'Respuestas', 'Detalle', 'Cantidad', '%']];
  res.preguntas.forEach((p) => {
    if (p.sin_agregado) { filas.push([`${p.orden}. ${p.enunciado}`, 'Texto corto', '', '', 'Sin agregado: los textos libres no se exportan', '', '']); return; }
    const titulo = `${p.orden}. ${p.enunciado}`;
    if (p.oculta) { filas.push([titulo, p.tipo, 'Todas', `menos de ${res.minimo}`, 'Sin cifras: no se llega al mínimo por celda', '', '']); return; }
    const celdas = [['Total', p.total]].concat(p.celdas.map((c) => [c.zona, c]), p.otras ? [[`Otras zonas (${p.otras.zonas} zonas)`, p.otras]] : []);
    celdas.forEach(([zona, c]) => {
      if (p.tipo === 'unica' || p.tipo === 'multiple') {
        c.opciones.forEach((o) => filas.push([titulo, p.tipo, zona, c.n, o.texto, o.n, o.pct]));
      } else if (p.tipo === 'escala') {
        filas.push([titulo, p.tipo, zona, c.n, 'Promedio', lleno(c.promedio), '']);
        c.distribucion.forEach((d) => filas.push([titulo, p.tipo, zona, c.n, `Valor ${d.valor}`, d.n, c.n ? r1((d.n / c.n) * 100) : 0]));
      } else {
        filas.push([titulo, p.tipo, zona, c.n, 'Promedio', lleno(c.promedio), '']);
        filas.push([titulo, p.tipo, zona, c.n, 'Mediana', lleno(c.mediana), '']);
      }
      filas.push([titulo, p.tipo, zona, c.n, 'No sabe / No responde', c.nsnr, c.pct_nsnr]);
    });
  });
  const cob = [[MARCA], [], ['Zona', 'Respuestas', 'Votantes registrados', '% de las respuestas', '% de los votantes', 'Respuestas por 100 votantes', 'Lectura']];
  const lectura = { sobre: 'Sobrerrepresentada', sub: 'Subrepresentada', parejo: 'Pareja' };
  if (res.cobertura.oculto) cob.push([`No se llega al mínimo de ${res.minimo} respuestas: no se muestra cobertura`]);
  res.cobertura.zonas.forEach((z) => cob.push([z.zona, z.respuestas, lleno(z.votantes), z.pct_muestra, lleno(z.pct_votantes), lleno(z.por_100), lectura[z.sesgo] || '']));
  if (res.cobertura.otras) { const z = res.cobertura.otras; cob.push([`Otras zonas (${z.zonas} zonas)`, z.respuestas, lleno(z.votantes), z.pct_muestra, lleno(z.pct_votantes), lleno(z.por_100), lectura[z.sesgo] || '']); }
  const cuo = [[MARCA], [], ['Zona', 'Meta', 'Avance', '%', 'Estado']];
  res.cuotas.forEach((c) => cuo.push([c.zona, c.meta, c.avance === null ? `menos de ${c.menos_de}` : c.avance, lleno(c.pct), c.completa ? 'Completa' : 'Pendiente']));
  return { Notas: notas, Resultados: filas, Cobertura: cob, Cuotas: cuo };
}

module.exports = { MINIMO_PISO, MINIMO_TOPE, MARCA, minimoPorCelda, aplicarMinimo, resumir, resultados, hojasDeExcel, cuotasConAvance, respuestasQueCuentan, fueraPorRevision };
