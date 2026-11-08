/**
 * PANEL, MAPA Y EXCEL DE LAS TAREAS (parche 306), con el MISMO alcance que la lista (lib/alcanceTareas.js): cada quien cuenta lo de su equipo.
 *
 *   · panel ......... cumplimiento por ZONA y por PERSONA dentro del alcance. «Cumplimiento» = (hechas + verificadas) / (todas menos las canceladas);
 *                     las vencidas y las que están por reasignar se cuentan aparte. La persona es el RESPONSABLE (alguien del equipo).
 *   · mapa .......... círculos por zona: la posición de «terminé» se agrupa en celdas de 0,005° (~550 m) y solo viaja el CENTRO de la celda, la
 *                     cuenta y cuántas hay por tipo. NUNCA un punto exacto, ni un nombre, ni una foto, ni el título, ni el número de la tarea.
 *   · cumplimiento (Excel) ... zona × tipo × estado, SIN nombres de nadie: para quien tenga «Importar / Exportar» en tareas.
 */
'use strict';

const pool = require('../config/db');
const T = require('./tareas');
const { alcanceTareas } = require('./alcanceTareas');

const PASO_MAPA = 0.005;
const MAX_ZONAS = 500;
const MAX_FILAS = 60;
const SIN_ZONA = '(sin zona)';
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** El alcance de quien pregunta más los filtros opcionales: desde y hasta (por fecha de creación), tipo. */
function condiciones(alcance, filtros = {}) {
  const a = alcanceTareas(alcance, 't');
  const cond = [a.sql], valores = [...a.valores];
  if (filtros.desde && FECHA.test(String(filtros.desde))) { cond.push('t.creada_en >= ?'); valores.push(`${filtros.desde} 00:00:00`); }
  if (filtros.hasta && FECHA.test(String(filtros.hasta))) { cond.push('t.creada_en < DATE_ADD(?, INTERVAL 1 DAY)'); valores.push(filtros.hasta); }
  if (filtros.tipo && T.TIPOS[String(filtros.tipo)]) { cond.push('t.tipo = ?'); valores.push(String(filtros.tipo)); }
  return { sql: cond.join(' AND '), valores };
}

const ZONA = `COALESCE(NULLIF(TRIM(COALESCE(t.zona_texto, tz.nombre)), ''), '${SIN_ZONA}')`;
const SUMAS = `COUNT(*) AS total,
  COALESCE(SUM(t.estado IN ('pendiente','en_curso')), 0) AS abiertas, COALESCE(SUM(t.estado = 'hecha'), 0) AS hechas,
  COALESCE(SUM(t.estado = 'verificada'), 0) AS verificadas, COALESCE(SUM(t.estado = 'cancelada'), 0) AS canceladas,
  COALESCE(SUM(t.estado IN ('pendiente','en_curso') AND t.fecha_limite IS NOT NULL AND t.fecha_limite < CURDATE()), 0) AS vencidas,
  COALESCE(SUM(t.huerfana_desde IS NOT NULL AND t.estado IN ('pendiente','en_curso','hecha')), 0) AS por_reasignar`;

function fila(f) {
  const total = Number(f.total), canceladas = Number(f.canceladas), hechas = Number(f.hechas), verificadas = Number(f.verificadas);
  const medibles = total - canceladas;
  return {
    total, abiertas: Number(f.abiertas), hechas, verificadas, canceladas, vencidas: Number(f.vencidas), por_reasignar: Number(f.por_reasignar),
    cumplimiento: medibles > 0 ? Math.round(((hechas + verificadas) / medibles) * 100) : null,
  };
}

async function panel(alcance, filtros = {}) {
  const c = condiciones(alcance, filtros);
  const [[tot]] = await pool.query(`SELECT ${SUMAS} FROM tareas t LEFT JOIN territorios tz ON tz.id = t.territorio_id WHERE ${c.sql}`, c.valores);
  const [zonas] = await pool.query(
    `SELECT MIN(${ZONA}) AS nombre, ${SUMAS} FROM tareas t LEFT JOIN territorios tz ON tz.id = t.territorio_id WHERE ${c.sql}
      GROUP BY ${ZONA} ORDER BY total DESC, nombre LIMIT ${MAX_FILAS}`, c.valores);
  const [personas] = await pool.query(
    `SELECT t.asignada_a AS id, MIN(COALESCE(ua.nombre, '(cuenta eliminada)')) AS nombre, MIN(ua.activo) AS activa, ${SUMAS}
       FROM tareas t LEFT JOIN territorios tz ON tz.id = t.territorio_id LEFT JOIN usuarios ua ON ua.id = t.asignada_a WHERE ${c.sql}
      GROUP BY t.asignada_a ORDER BY total DESC, nombre LIMIT ${MAX_FILAS}`, c.valores);
  const [tipos] = await pool.query(`SELECT t.tipo, ${SUMAS} FROM tareas t LEFT JOIN territorios tz ON tz.id = t.territorio_id WHERE ${c.sql} GROUP BY t.tipo`, c.valores);
  const [[dz]] = await pool.query(`SELECT COUNT(DISTINCT ${ZONA}) AS n FROM tareas t LEFT JOIN territorios tz ON tz.id = t.territorio_id WHERE ${c.sql}`, c.valores);
  return {
    totales: fila(tot),
    porZona: zonas.map((f) => ({ nombre: f.nombre, ...fila(f) })), zonasDistintas: Number(dz.n), zonasMostradas: zonas.length,
    porPersona: personas.map((f) => ({ id: f.id, nombre: f.nombre, activa: f.activa === null ? false : Number(f.activa) === 1, ...fila(f) })),
    porTipo: tipos.map((f) => ({ tipo: f.tipo, etiqueta: (T.TIPOS[f.tipo] || {}).etiqueta || f.tipo, ...fila(f) })),
  };
}

/** Círculos por zona de las tareas CON ubicación. Solo { lat, lng, n, tipos: [{ etiqueta, n }] } por celda. */
async function mapa(alcance, filtros = {}) {
  const c = condiciones(alcance, filtros);
  const [filas] = await pool.query(
    `SELECT FLOOR(t.latitud / ?) AS gy, FLOOR(t.longitud / ?) AS gx, t.tipo, COUNT(*) AS n
       FROM tareas t WHERE ${c.sql} AND t.latitud IS NOT NULL AND t.longitud IS NOT NULL GROUP BY gy, gx, t.tipo`, [PASO_MAPA, PASO_MAPA, ...c.valores]);
  const celdas = new Map();
  for (const f of filas) {
    const clave = `${f.gy}|${f.gx}`;
    let z = celdas.get(clave);
    if (!z) {
      z = { lat: Math.round((Number(f.gy) + 0.5) * PASO_MAPA * 10000) / 10000, lng: Math.round((Number(f.gx) + 0.5) * PASO_MAPA * 10000) / 10000, n: 0, tipos: [] };
      celdas.set(clave, z);
    }
    z.n += Number(f.n);
    z.tipos.push({ etiqueta: (T.TIPOS[f.tipo] || {}).etiqueta || f.tipo, n: Number(f.n) });
  }
  const zonas = [...celdas.values()].sort((a, b) => b.n - a.n).slice(0, MAX_ZONAS);
  zonas.forEach((z) => z.tipos.sort((a, b) => b.n - a.n));
  const [[tot]] = await pool.query(`SELECT COUNT(*) AS n, COALESCE(SUM(t.latitud IS NOT NULL AND t.longitud IS NOT NULL), 0) AS con FROM tareas t WHERE ${c.sql}`, c.valores);
  return { paso_grados: PASO_MAPA, zonas, total: Number(tot.n), con_ubicacion: Number(tot.con), sin_ubicacion: Number(tot.n) - Number(tot.con) };
}

/** zona × tipo × estado, para el Excel. Sin nombres de nadie. */
async function cumplimiento(alcance, filtros = {}) {
  const c = condiciones(alcance, filtros);
  const [filas] = await pool.query(
    `SELECT MIN(${ZONA}) AS zona, t.tipo, ${SUMAS} FROM tareas t LEFT JOIN territorios tz ON tz.id = t.territorio_id WHERE ${c.sql}
      GROUP BY ${ZONA}, t.tipo ORDER BY zona, t.tipo`, c.valores);
  return filas.map((f) => ({ zona: f.zona, tipo: (T.TIPOS[f.tipo] || {}).etiqueta || f.tipo, ...fila(f) }));
}

module.exports = { PASO_MAPA, SIN_ZONA, condiciones, panel, mapa, cumplimiento };
