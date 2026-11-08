/**
 * PANEL, MAPA Y EXPORTACIÓN DE SOLICITUDES CIUDADANAS (parche 304). Todo con el MISMO alcance que la lista (lib/alcanceSolicitudes.js): cada
 * quien cuenta lo suyo, y el administrador, lo de la campaña madre.
 *
 * LO QUE CADA SALIDA LLEVA, Y LO QUE NO
 *   · panel ........ conteos por estado, categoría y barrio o vereda, y tiempos promedio. Sin texto libre, sin personas.
 *   · mapa ......... círculos por ZONA: la ubicación del GPS se agrupa en celdas de 0,005° (unos 550 m) y solo viaja el CENTRO de la celda, el
 *                    número de solicitudes y cuántas hay por categoría. Nunca un punto exacto, ni un nombre, ni un teléfono, ni una foto, ni el
 *                    texto de la solicitud, ni su número.
 *   · diagnóstico .. la tabla categoría × barrio × estado. Sin datos personales de ninguna clase.
 *   · detalle ...... fila por solicitud, SOLO para el administrador (la ruta lo exige): con el teléfono enmascarado.
 */
'use strict';

const pool = require('../config/db');
const S = require('./solicitudes');
const Seg = require('./solicitudesSeguimiento');
const { alcanceSolicitudes } = require('./alcanceSolicitudes');

/** Lado de la celda del mapa, en grados. 0,005° ≈ 550 m: una zona, no una casa. */
const PASO_MAPA = 0.005;
const MAX_ZONAS = 500;
const MAX_BARRIOS_PANEL = 25;
const MAX_FILAS_DETALLE = 20000;
const SIN_BARRIO = '(sin indicar)';
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** El alcance de quien pregunta más los filtros opcionales: desde, hasta (por fecha de registro), categoria y estado. */
function condiciones(alcance, filtros = {}) {
  const a = alcanceSolicitudes(alcance, 's');
  const cond = [a.sql];
  const valores = [...a.valores];
  if (filtros.desde && FECHA.test(String(filtros.desde))) { cond.push('s.creada_en >= ?'); valores.push(`${filtros.desde} 00:00:00`); }
  if (filtros.hasta && FECHA.test(String(filtros.hasta))) { cond.push('s.creada_en < DATE_ADD(?, INTERVAL 1 DAY)'); valores.push(filtros.hasta); }
  const cat = Number(filtros.categoria);
  if (Number.isInteger(cat) && cat > 0) { cond.push('s.categoria_id = ?'); valores.push(cat); }
  if (filtros.estado && S.ESTADOS.includes(String(filtros.estado))) { cond.push('s.estado = ?'); valores.push(String(filtros.estado)); }
  return { sql: cond.join(' AND '), valores, alcance: a };
}

const aDias = (minutos) => (minutos === null || minutos === undefined ? null : Math.round((Number(minutos) / 1440) * 10) / 10);

/* ---------------------------------------------------------------------------------------------------------------- PANEL */

async function panel(alcance, filtros = {}) {
  const c = condiciones(alcance, filtros);
  const [porEstadoFilas] = await pool.query(`SELECT s.estado, COUNT(*) AS n FROM solicitudes s WHERE ${c.sql} GROUP BY s.estado`, c.valores);
  const porEstado = { registrada: 0, en_revision: 0, remitida: 0, cerrada: 0 };
  porEstadoFilas.forEach((f) => { porEstado[f.estado] = Number(f.n); });
  const total = Object.values(porEstado).reduce((a, b) => a + b, 0);

  const [cats] = await pool.query(
    `SELECT k.id, k.nombre, COUNT(*) AS total,
            SUM(s.estado = 'registrada') AS registrada, SUM(s.estado = 'en_revision') AS en_revision,
            SUM(s.estado = 'remitida') AS remitida, SUM(s.estado = 'cerrada') AS cerrada
       FROM solicitudes s JOIN solicitud_categorias k ON k.id = s.categoria_id
      WHERE ${c.sql} GROUP BY k.id, k.nombre, k.orden ORDER BY total DESC, k.orden, k.id`, c.valores);

  const [zonas] = await pool.query(
    `SELECT MIN(COALESCE(NULLIF(TRIM(s.barrio_texto), ''), ?)) AS nombre, COUNT(*) AS total,
            SUM(s.estado = 'registrada') AS registrada, SUM(s.estado = 'en_revision') AS en_revision,
            SUM(s.estado = 'remitida') AS remitida, SUM(s.estado = 'cerrada') AS cerrada
       FROM solicitudes s WHERE ${c.sql}
      GROUP BY COALESCE(NULLIF(TRIM(s.barrio_texto), ''), ?) ORDER BY total DESC, nombre LIMIT ${MAX_BARRIOS_PANEL}`, [SIN_BARRIO, ...c.valores, SIN_BARRIO]);
  const [[distintas]] = await pool.query(
    `SELECT COUNT(DISTINCT COALESCE(NULLIF(TRIM(s.barrio_texto), ''), ?)) AS n FROM solicitudes s WHERE ${c.sql}`, [SIN_BARRIO, ...c.valores]);

  const [[t]] = await pool.query(
    `SELECT COUNT(s.remitida_en) AS n_remitida, COUNT(s.cerrada_en) AS n_cerrada,
            AVG(CASE WHEN s.remitida_en IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, s.creada_en, s.remitida_en) END) AS min_remitida,
            AVG(CASE WHEN s.cerrada_en IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, s.creada_en, s.cerrada_en) END) AS min_cerrada
       FROM solicitudes s WHERE ${c.sql}`, c.valores);

  const dias = await Seg.diasSinMovimiento();
  const sinMovimiento = await Seg.contarSinMovimiento({ alcanceSql: c.sql, alcanceValores: c.valores, dias });
  const numeros = (f) => ({ total: Number(f.total), registrada: Number(f.registrada), en_revision: Number(f.en_revision), remitida: Number(f.remitida), cerrada: Number(f.cerrada) });
  return {
    total, porEstado,
    porCategoria: cats.map((f) => ({ id: f.id, nombre: f.nombre, ...numeros(f) })),
    porZona: zonas.map((f) => ({ nombre: f.nombre, ...numeros(f) })),
    zonasDistintas: Number(distintas.n), zonasMostradas: zonas.length,
    tiempos: {
      registrada_a_remitida: { n: Number(t.n_remitida), dias: aDias(t.min_remitida) },
      registrada_a_cerrada: { n: Number(t.n_cerrada), dias: aDias(t.min_cerrada) },
    },
    sinMovimiento: { dias, n: sinMovimiento },
  };
}

/* ----------------------------------------------------------------------------------------------------------------- MAPA */

/**
 * Círculos por zona. La respuesta NO lleva ids de solicitudes, ni barrio, ni descripción, ni nada de la persona: solo
 * { lat, lng, n, categorias: [{ nombre, n }] } por celda. El centro de la celda sustituye al punto del GPS: aun sabiendo que hay una
 * solicitud en la zona, no se sabe en qué casa.
 */
async function mapa(alcance, filtros = {}) {
  const c = condiciones(alcance, filtros);
  const [filas] = await pool.query(
    `SELECT FLOOR(s.latitud / ?) AS gy, FLOOR(s.longitud / ?) AS gx, k.nombre AS categoria, COUNT(*) AS n
       FROM solicitudes s JOIN solicitud_categorias k ON k.id = s.categoria_id
      WHERE ${c.sql} AND s.latitud IS NOT NULL AND s.longitud IS NOT NULL
      GROUP BY gy, gx, k.id, k.nombre`, [PASO_MAPA, PASO_MAPA, ...c.valores]);
  const celdas = new Map();
  for (const f of filas) {
    const clave = `${f.gy}|${f.gx}`;
    let z = celdas.get(clave);
    if (!z) {
      z = { lat: Math.round((Number(f.gy) + 0.5) * PASO_MAPA * 10000) / 10000, lng: Math.round((Number(f.gx) + 0.5) * PASO_MAPA * 10000) / 10000, n: 0, categorias: [] };
      celdas.set(clave, z);
    }
    z.n += Number(f.n);
    z.categorias.push({ nombre: f.categoria, n: Number(f.n) });
  }
  const zonas = [...celdas.values()].sort((a, b) => b.n - a.n).slice(0, MAX_ZONAS);
  zonas.forEach((z) => z.categorias.sort((a, b) => b.n - a.n));
  const [[tot]] = await pool.query(`SELECT COUNT(*) AS n, SUM(s.latitud IS NOT NULL AND s.longitud IS NOT NULL) AS con FROM solicitudes s WHERE ${c.sql}`, c.valores);
  return { paso_grados: PASO_MAPA, zonas, total: Number(tot.n), con_ubicacion: Number(tot.con || 0), sin_ubicacion: Number(tot.n) - Number(tot.con || 0) };
}

/* ----------------------------------------------------------------------------------------------------------- EXPORTACIÓN */

/**
 * La tabla del diagnóstico: una fila por (categoría, barrio o vereda), con una columna por estado. Sin una sola persona.
 */
async function diagnostico(alcance, filtros = {}) {
  const c = condiciones(alcance, filtros);
  const [filas] = await pool.query(
    `SELECT k.nombre AS categoria, MIN(COALESCE(NULLIF(TRIM(s.barrio_texto), ''), ?)) AS barrio, COUNT(*) AS total,
            SUM(s.estado = 'registrada') AS registrada, SUM(s.estado = 'en_revision') AS en_revision,
            SUM(s.estado = 'remitida') AS remitida, SUM(s.estado = 'cerrada') AS cerrada
       FROM solicitudes s JOIN solicitud_categorias k ON k.id = s.categoria_id
      WHERE ${c.sql} GROUP BY k.id, k.nombre, k.orden, COALESCE(NULLIF(TRIM(s.barrio_texto), ''), ?) ORDER BY k.orden, k.id, barrio`,
    [SIN_BARRIO, ...c.valores, SIN_BARRIO]);
  return filas.map((f) => ({
    categoria: f.categoria, barrio: f.barrio, registrada: Number(f.registrada), en_revision: Number(f.en_revision),
    remitida: Number(f.remitida), cerrada: Number(f.cerrada), total: Number(f.total),
  }));
}

/**
 * El detalle, una fila por solicitud. SOLO PARA EL ADMINISTRADOR (la ruta lo exige). El teléfono sale ENMASCARADO; el nombre del ciudadano
 * solo si autorizó guardarlo. La descripción es texto libre y puede nombrar a alguien: por eso este archivo no es para repartir.
 */
async function detalle(alcance, filtros = {}) {
  const c = condiciones(alcance, filtros);
  const [filas] = await pool.query(
    `SELECT s.id, s.creada_en, k.nombre AS categoria, s.barrio_texto, s.estado, s.descripcion, ru.nombre AS responsable, s.entidad_remitida,
            s.remitida_en, s.cerrada_en, s.motivo_cierre, rg.nombre AS registrada_por, s.autoriza_datos, s.ciudadano_nombre, s.ciudadano_telefono,
            (s.latitud IS NOT NULL) AS con_ubicacion, (SELECT COUNT(*) FROM solicitud_fotos f WHERE f.solicitud_id = s.id) AS fotos, s.anonimizada_en
       FROM solicitudes s JOIN solicitud_categorias k ON k.id = s.categoria_id
       LEFT JOIN usuarios ru ON ru.id = s.responsable_id LEFT JOIN usuarios rg ON rg.id = s.registrado_por
      WHERE ${c.sql} ORDER BY s.id LIMIT ${MAX_FILAS_DETALLE}`, c.valores);
  return filas.map((f) => ({
    id: f.id, creada_en: f.creada_en, categoria: f.categoria, barrio: f.barrio_texto || '', estado: S.ETIQUETA_ESTADO[f.estado] || f.estado,
    descripcion: f.descripcion, responsable: f.responsable || '', entidad_remitida: f.entidad_remitida || '', remitida_en: f.remitida_en || '',
    cerrada_en: f.cerrada_en || '', motivo_cierre: f.motivo_cierre || '', registrada_por: f.registrada_por || '',
    autoriza: Number(f.autoriza_datos) ? 'Sí' : 'No', ciudadano: f.ciudadano_nombre || '', telefono: S.enmascararTelefono(f.ciudadano_telefono),
    con_ubicacion: Number(f.con_ubicacion) ? 'Sí' : 'No', fotos: Number(f.fotos), datos_borrados: f.anonimizada_en ? 'Sí' : 'No',
  }));
}

module.exports = { PASO_MAPA, SIN_BARRIO, MAX_FILAS_DETALLE, condiciones, panel, mapa, diagnostico, detalle };
