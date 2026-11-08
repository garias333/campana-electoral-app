/**
 * EL PANEL DEL LÍDER (celular) y «mi progreso»: una sola definición de «inscritos».
 *
 * «INSCRITOS» DE QUIEN PREGUNTA ES LO QUE ÉL VE EN SU LISTA DE VOTANTES: la condición de `condicionAlcanceVotantes` con
 * `req.alcance` (lib/alcanceVotantes.js). Para un líder, las fichas cuyo `lider_id` es él (incluidas las que registran sus
 * sublíderes, que llevan su id); para un sublíder, las que él registró; para el aspirante con sublicencia, su rama. Antes
 * `/dashboard/mi-progreso` contaba otra cosa —`lider_id` suyo o de sus sublíderes de estructura—, y la barra de meta podía
 * decir 40 mientras la lista decía 38. Ahora todo cuenta con la misma condición.
 *
 * NUNCA `req.session.usuario.id` A SECAS: el aspirante tiene rol `lider` pero su alcance es de rama, y su id de persona está
 * en `req.alcance.usuarioId`. Todo se pide a `req.alcance`.
 *
 * Nada de esto devuelve datos de otras personas: el equipo trae solo nombre, registros y meta; la posición, solo «lugar» y
 * «de»; los pendientes, solo nombre, barrio y lo que falta.
 */
'use strict';

const pool = require('../config/db');
const { condicionAlcanceVotantes, parametrosAlcanceVotantes } = require('./alcanceVotantes');
const { sqlMetaEfectiva } = require('../config/metasEstructura');
const { cargoDeLaMadre } = require('../config/cargoMadre');
const enlaces = require('../config/yaVotoEnlace');

const SIN_TELEFONO = `(v.telefono IS NULL OR TRIM(v.telefono) = '')`;
const SIN_PUESTO = `(v.puesto_id IS NULL AND (v.puesto_votacion IS NULL OR TRIM(v.puesto_votacion) = ''))`;
const POR_PAGINA = 20;

/** La condición de alcance sobre `votantes v`, con sus parámetros en orden. */
function alcanceDe(req) {
  if (!req.alcance) throw new Error('panelLider: falta req.alcance (calcularAlcance)');
  return { sql: condicionAlcanceVotantes(req.alcance, 'v'), valores: parametrosAlcanceVotantes(req.alcance) };
}

const pct = (a, m) => (m > 0 ? Math.min(100, Math.round((a / m) * 100)) : 0);

/**
 * Meta e inscritos de quien pregunta. Misma forma que siempre tuvo `/dashboard/mi-progreso`, con `enviados` contado con el
 * alcance de la lista. `ambito` es el del aspirante (dashboard.routes.js → ambitoDelPanel), o null.
 */
async function progresoDelLider(req) {
  const a = alcanceDe(req);
  const yo = req.alcance.usuarioId;   // el aspirante: su id de persona; el líder: el suyo
  const [[fila]] = await pool.query(
    `SELECT ${sqlMetaEfectiva('e')} AS meta_votos FROM estructura e WHERE e.usuario_id = ? AND e.activo = 1 LIMIT 1`, [yo]);
  const [[c]] = await pool.query(
    `SELECT COUNT(*) AS enviados,
            COALESCE(SUM(v.origen = 'enlace_lider'), 0) AS por_enlace,
            COALESCE(SUM(v.origen = 'enlace_lider' AND v.consentimiento_confirmado_en IS NULL), 0) AS por_enlace_sin_confirmar
       FROM votantes v WHERE ${a.sql}`, a.valores);
  const enviados = Number(c.enviados) || 0;
  const porEnlace = Number(c.por_enlace) || 0;
  const porEnlaceSinConfirmar = Number(c.por_enlace_sin_confirmar) || 0;

  if (!fila) return { tieneMetaAsignada: false, enviados, porEnlace, porEnlaceSinConfirmar };
  const meta = Number(fila.meta_votos) || 0;
  const salida = { tieneMetaAsignada: true, meta, enviados, porcentaje: pct(enviados, meta), porEnlace, porEnlaceSinConfirmar };

  /* EL ASPIRANTE TIENE DOS METAS (ver la nota larga que esto trae de dashboard.routes.js): la suya y la que le prometió a la
     campaña principal. Se devuelven las dos; la barra de su campaña se mide contra lo que ve en su lista. */
  if (!req.sublicencia) return salida;
  const cargo = req.sublicencia.cargo;
  const contar = async (apoyo) => {
    const [[r]] = await pool.query(
      `SELECT COUNT(*) AS n FROM votantes v WHERE ${a.sql} AND JSON_CONTAINS(v.apoya_a, ?)`,
      [...a.valores, JSON.stringify(apoyo)]);
    return Number(r.n) || 0;
  };
  let metaPropia = 0;
  try {
    const [[sl]] = await pool.query('SELECT meta_votos FROM sublicencias WHERE usuario_id = ? LIMIT 1', [req.sublicencia.usuario_id]);
    metaPropia = sl ? Number(sl.meta_votos) || 0 : 0;
  } catch (_) { /* sin la columna todavía: 0, y la barra no se pinta */ }
  const avancePropio = await contar(cargo);
  const avanceMadre = await contar(await cargoDeLaMadre());
  return {
    ...salida, dosMetas: true,
    propia: { etiqueta: `Mi campaña (${cargo})`, meta: metaPropia, avance: avancePropio, porcentaje: pct(avancePropio, metaPropia) },
    madre: { etiqueta: 'Comprometido con la campaña principal', meta, avance: avanceMadre, porcentaje: pct(avanceMadre, meta) },
  };
}

/** Los últimos 7 días (hoy incluido), de más antiguo a más reciente, en hora de Colombia, con los días en cero rellenos. */
async function ultimosSieteDias(req) {
  const a = alcanceDe(req);
  // La conexión fija -05:00 (config/db.js): CURDATE() y DATE() son del día de Colombia.
  const [[{ hoy }]] = await pool.query(`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy`);
  const [filas] = await pool.query(
    `SELECT DATE_FORMAT(v.created_at, '%Y-%m-%d') AS dia, COUNT(*) AS n
       FROM votantes v
      WHERE ${a.sql} AND v.created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY dia`, a.valores);
  const porDia = new Map(filas.map((f) => [f.dia, Number(f.n)]));
  const [y, m, d] = hoy.split('-').map(Number);
  const dias = [];
  for (let i = 6; i >= 0; i--) {
    const f = new Date(Date.UTC(y, m - 1, d - i));
    const clave = f.toISOString().slice(0, 10);
    dias.push({ fecha: clave, n: porDia.get(clave) || 0 });
  }
  return { hoy, dias, total: dias.reduce((s, x) => s + x.n, 0) };
}

/** Cuántos de SUS votantes no tienen teléfono, puesto, o no están verificados (este último solo informa: lo marca la administración). */
async function pendientes(req) {
  const a = alcanceDe(req);
  const [[c]] = await pool.query(
    `SELECT COALESCE(SUM(${SIN_TELEFONO}), 0) AS sin_telefono,
            COALESCE(SUM(${SIN_PUESTO}), 0) AS sin_puesto,
            COALESCE(SUM(v.datos_verificados = 0), 0) AS sin_verificar
       FROM votantes v WHERE ${a.sql}`, a.valores);
  return { sin_telefono: Number(c.sin_telefono), sin_puesto: Number(c.sin_puesto), sin_verificar: Number(c.sin_verificar) };
}

/** Lista corta de pendientes: nombre, barrio y lo que falta. Sin cédula, sin teléfono, sin correo. */
async function listaPendientes(req, tipo, pagina) {
  const filtro = tipo === 'sin_telefono' ? SIN_TELEFONO : SIN_PUESTO;
  const a = alcanceDe(req);
  const p = Math.max(1, parseInt(pagina, 10) || 1);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM votantes v WHERE ${a.sql} AND ${filtro}`, a.valores);
  const [filas] = await pool.query(
    `SELECT v.id, v.nombre, t.nombre AS barrio,
            ${SIN_TELEFONO} AS falta_telefono, ${SIN_PUESTO} AS falta_puesto
       FROM votantes v LEFT JOIN territorios t ON t.id = v.territorio_id
      WHERE ${a.sql} AND ${filtro}
      ORDER BY v.created_at DESC, v.id DESC
      LIMIT ? OFFSET ?`, [...a.valores, POR_PAGINA, (p - 1) * POR_PAGINA]);
  return {
    tipo, total: Number(total), page: p, por_pagina: POR_PAGINA,
    items: filas.map((f) => ({
      id: f.id, nombre: f.nombre, barrio: f.barrio || '',
      falta: [Number(f.falta_telefono) ? 'telefono' : null, Number(f.falta_puesto) ? 'puesto' : null].filter(Boolean),
    })),
  };
}

/** El equipo: por sublíder (o por persona directa del aspirante), SOLO nombre, registros y meta. Sin cédula, correo ni teléfono. */
async function equipo(req) {
  if (req.alcance.cargo === 'sublider') return [];
  const a = alcanceDe(req);
  const yo = req.alcance.usuarioId;
  const cargos = req.sublicencia ? ['lider', 'usuario'] : ['usuario'];
  const [filas] = await pool.query(
    `SELECT u.nombre, e.meta_votos AS meta,
            (SELECT COUNT(*) FROM votantes v
              WHERE (v.sublider_id = e.usuario_id OR v.lider_id = e.usuario_id) AND ${a.sql}) AS registros
       FROM estructura e JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.activo = 1 AND e.supervisor_id = ? AND e.cargo IN (?)
      ORDER BY registros DESC, u.nombre
      LIMIT 50`, [...a.valores, yo, cargos]);
  return filas.map((f) => ({ nombre: f.nombre, registros: Number(f.registros), meta: Number(f.meta) || 0 }));
}

/**
 * «Vas en el lugar X de N», sin nombres. El líder se mide contra los líderes activos y el sublíder contra los sublíderes, cada
 * quien con la definición de inscritos de SU lista: líder, `lider_id`; sublíder, `sublider_id` o `lider_id`. Empates: mismo lugar.
 * Quien no está en esa lista (aspirante, o sin fila de estructura) recibe `lugar: null`.
 */
async function posicionPropia(req) {
  const rol = req.alcance.cargo;
  const yo = req.alcance.usuarioId;
  if (req.sublicencia || (rol !== 'lider' && rol !== 'sublider')) return { lugar: null, de: null };
  const cargo = rol === 'lider' ? 'lider' : 'usuario';
  const [filas] = rol === 'lider'
    ? await pool.query(
      `SELECT e.usuario_id, COUNT(v.id) AS n FROM estructura e LEFT JOIN votantes v ON v.lider_id = e.usuario_id
        WHERE e.activo = 1 AND e.cargo = ? GROUP BY e.usuario_id`, [cargo])
    : await pool.query(
      `SELECT e.usuario_id, COUNT(DISTINCT v.id) AS n FROM estructura e
         LEFT JOIN votantes v ON (v.lider_id = e.usuario_id OR v.sublider_id = e.usuario_id)
        WHERE e.activo = 1 AND e.cargo = ? GROUP BY e.usuario_id`, [cargo]);
  const mio = filas.find((f) => f.usuario_id === yo);
  if (!mio) return { lugar: null, de: filas.length };
  return { lugar: 1 + filas.filter((f) => Number(f.n) > Number(mio.n)).length, de: filas.length };
}

/** Día D: cuántos de sus votantes ya votaron y cuántos faltan. Solo si tiene «Ver» en `rescate_votos` (lo decide la ruta). */
async function diaD(req) {
  const a = alcanceDe(req);
  const [[t]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(vv.votante_id IS NOT NULL), 0) AS votaron
       FROM votantes v LEFT JOIN votante_votos vv ON vv.votante_id = v.id WHERE ${a.sql}`, a.valores);
  let eleccion = { fecha: null, esHoy: false };
  try { eleccion = await enlaces.estadoDeLaElección(); } catch (_) { /* sin fecha: modo prueba */ }
  const total = Number(t.total); const votaron = Number(t.votaron);
  return {
    fecha_eleccion: eleccion.fecha || null, modo_prueba: !eleccion.esHoy,
    total, votaron, faltan: total - votaron, pct: total > 0 ? Math.round((votaron * 1000) / total) / 10 : 0,
  };
}

module.exports = { progresoDelLider, ultimosSieteDias, pendientes, listaPendientes, equipo, posicionPropia, diaD, alcanceDe, SIN_TELEFONO, SIN_PUESTO, POR_PAGINA };
