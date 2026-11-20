/**
 * LO QUE VE EL CANDIDATO PRINCIPAL EN SU APP DEL CELULAR (orden 70). Solo lectura, toda la campaña, SIN finanzas y SIN cédulas.
 *
 * REUTILIZA, no duplica:
 *   · el equipo de cada coordinador, con la misma cuenta de «Mi equipo» (lib/coordinadorEquipo.js → equipoDelCoordinador): registros de su gente, su meta,
 *     el último registro y los 7 días;
 *   · el alcance de «toda la campaña» de los votantes, el MISMO que usa el panel del administrador (lib/alcanceVotantes.js con cargo 'madre'), para que
 *     el total de aquí y el del panel digan lo mismo;
 *   · los paneles de Solicitudes y de Tareas (lib/solicitudesPanel.js, lib/tareasPanel.js), con alcance 'madre'.
 * Lo que no existía hoy y se define aquí (ver el informe de la orden 70): «activo», «puesto cubierto» y el punto de actividad de cada persona.
 *
 * QUÉ ES «ACTIVO»  — alguien con al menos un registro (de él o, si es líder, de sus sublíderes; si es coordinador, de su equipo) en los últimos 7 días
 *   (hoy y los 6 anteriores, día de Colombia: la conexión a la base trabaja en -05:00). «Sin actividad» = ninguno en 7 días, o nunca.
 * PUNTO DE ACTIVIDAD — verde: registró hoy · amarillo: hace 1 a 6 días · rojo: hace 7 o más días, o nunca (el mismo umbral de 7 días de «Mi equipo»).
 * PUESTO CUBIERTO  — un puesto de la lista de la campaña (`dia_d_puestos_votacion`) con al menos un testigo activo asignado O al menos un votante registrado
 *   que vota en él (el cruce es por `puesto_id`, no por texto). Es el criterio de «Cobertura de testigos» ampliado a los votantes, como pidió la orden.
 */
'use strict';

const pool = require('../config/db');
const { equipoDelCoordinador, celularValido } = require('./coordinadorEquipo');
const { condicionAlcanceVotantes, parametrosAlcanceVotantes } = require('./alcanceVotantes');
const { cargoDeLaMadre } = require('../config/cargoMadre');

const DIAS_SIN_ACTIVIDAD = 7;

/* La zona de una persona o de un votante: la COMUNA (o corregimiento) cuando su territorio es un barrio o una vereda; si no, su propio territorio.
   Se usa con `LEFT JOIN territorios t ON t.id = <territorio_id>` y `LEFT JOIN territorios p ON p.id = t.padre_id`. */
const ZONA_ID = `IF(t.tipo IN ('barrio','vereda') AND p.id IS NOT NULL, p.id, t.id)`;
const ZONA_NOMBRE = `IF(t.tipo IN ('barrio','vereda') AND p.id IS NOT NULL, p.nombre, t.nombre)`;

const num = (x) => Number(x) || 0;

function puntoDe(dias) {
  if (dias === null || dias === undefined) return 'rojo';
  if (dias <= 0) return 'verde';
  if (dias < DIAS_SIN_ACTIVIDAD) return 'amarillo';
  return 'rojo';
}

/** El alcance «toda la campaña» sobre `votantes v`, como el del panel del administrador. */
async function alcanceVotantesMadre() {
  let cargoMadre = null;
  try { cargoMadre = await cargoDeLaMadre(); } catch (_) { /* sin cargo no se aplica el filtro de la madre (igual que calcularAlcance) */ }
  const alcance = { cargo: 'madre', cargoMadre };
  return { sql: condicionAlcanceVotantes(alcance, 'v'), valores: parametrosAlcanceVotantes(alcance) };
}

/* --------------------------------------------------------------------------------------------------------- EL EQUIPO */

let _cacheEquipo = null;   // { t, ocultar, datos }: el Inicio y el Equipo piden lo mismo seguido; 45 s bastan para que no se repita la cuenta.
const VIGENCIA_EQUIPO_MS = 45 * 1000;
function olvidarEquipo() { _cacheEquipo = null; }

async function enLotes(lista, tamano, fn) {
  const salida = [];
  for (let i = 0; i < lista.length; i += tamano) {
    salida.push(...await Promise.all(lista.slice(i, i + tamano).map(fn)));
  }
  return salida;
}

/**
 * Los coordinadores y los líderes de toda la campaña, con su avance. `ocultar` es el fragmento ` AND u.es_superadmin = 0` de filtroOcultar().
 * @returns {{coordinadores: object[], lideres: object[], zonas: object[]}}
 */
async function equipoCampana(ocultar = '') {
  if (_cacheEquipo && _cacheEquipo.ocultar === ocultar && Date.now() - _cacheEquipo.t < VIGENCIA_EQUIPO_MS) return _cacheEquipo.datos;

  const [coords] = await pool.query(
    `SELECT e.usuario_id AS id, MIN(u.nombre) AS nombre, MIN(u.telefono) AS telefono, MAX(u.no_contactar) AS no_contactar,
            MIN(${ZONA_ID}) AS zona_id, MIN(${ZONA_NOMBRE}) AS zona
       FROM estructura e
       JOIN usuarios u ON u.id = e.usuario_id
       LEFT JOIN territorios t ON t.id = e.territorio_id
       LEFT JOIN territorios p ON p.id = t.padre_id
      WHERE e.cargo = 'coordinador' AND e.activo = 1 ${ocultar}
      GROUP BY e.usuario_id`);

  const coordinadores = await enLotes(coords, 6, async (c) => {
    const eq = await equipoDelCoordinador(pool, c.id, ocultar);
    const r = eq.resumen;
    const diasDelEquipo = eq.miembros.map((m) => m.dias_sin_registrar).filter((d) => d !== null && d !== undefined);
    const dias = diasDelEquipo.length ? Math.min(...diasDelEquipo) : null;
    const meta = num(r.compromiso_total);
    const registrados = num(r.personas_registradas);
    return {
      id: c.id, nombre: c.nombre,
      zona_id: c.zona_id || null, zona: c.zona || null,
      telefono: celularValido(c.telefono), no_contactar: !!c.no_contactar,
      lideres: num(r.lideres_activos), sublideres: num(r.sublideres),
      registrados, meta,
      porcentaje: meta > 0 ? Math.round((num(r.registros_con_meta) / meta) * 100) : null,
      registros_7_dias: num(r.registros_7_dias),
      dias_sin_registrar: dias, punto: puntoDe(dias),
      activo: num(r.registros_7_dias) > 0,
    };
  });

  const [lids] = await pool.query(
    `WITH lideres AS (
       SELECT e.usuario_id AS id, MIN(u.nombre) AS nombre, MIN(u.telefono) AS telefono, MAX(u.no_contactar) AS no_contactar,
              MAX(COALESCE(e.meta_votos, 0)) AS meta, MIN(e.supervisor_id) AS supervisor_id,
              MIN(${ZONA_ID}) AS zona_id, MIN(${ZONA_NOMBRE}) AS zona
         FROM estructura e
         JOIN usuarios u ON u.id = e.usuario_id
         LEFT JOIN territorios t ON t.id = e.territorio_id
         LEFT JOIN territorios p ON p.id = t.padre_id
        WHERE e.cargo = 'lider' AND e.activo = 1 ${ocultar}
        GROUP BY e.usuario_id
     ),
     miembros AS (
       SELECT id AS duenio, id AS miembro FROM lideres
       UNION
       SELECT es.supervisor_id, es.usuario_id FROM estructura es
        WHERE es.cargo = 'usuario' AND es.activo = 1 AND es.supervisor_id IN (SELECT id FROM lideres)
     ),
     reg AS (
       SELECT m.duenio, COUNT(DISTINCT v.id) AS total,
              DATEDIFF(CURDATE(), DATE(MAX(v.created_at))) AS dias,
              COUNT(DISTINCT CASE WHEN v.created_at >= CURDATE() - INTERVAL 6 DAY THEN v.id END) AS ult7
         FROM miembros m JOIN votantes v ON v.lider_id = m.miembro
        GROUP BY m.duenio
     )
     SELECT l.id, l.nombre, l.telefono, l.no_contactar, l.meta, l.zona_id, l.zona,
            c.nombre AS coordinador, COALESCE(r.total, 0) AS registrados, r.dias AS dias, COALESCE(r.ult7, 0) AS ult7
       FROM lideres l
       LEFT JOIN reg r ON r.duenio = l.id
       LEFT JOIN usuarios c ON c.id = l.supervisor_id`);

  const lideres = lids.map((l) => {
    const meta = Math.max(0, num(l.meta));
    const registrados = num(l.registrados);
    const dias = l.dias === null || l.dias === undefined ? null : num(l.dias);
    return {
      id: l.id, nombre: l.nombre, zona_id: l.zona_id || null, zona: l.zona || null, coordinador: l.coordinador || null,
      telefono: celularValido(l.telefono), no_contactar: !!l.no_contactar,
      registrados, meta, porcentaje: meta > 0 ? Math.round((registrados / meta) * 100) : null,
      dias_sin_registrar: dias, punto: puntoDe(dias), activo: num(l.ult7) > 0,
    };
  });

  // Las zonas del filtro «Comuna»: las que tiene alguien del equipo.
  const zonasMapa = new Map();
  [...coordinadores, ...lideres].forEach((x) => { if (x.zona_id && x.zona) zonasMapa.set(x.zona_id, x.zona); });
  const zonas = [...zonasMapa.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));

  const ordenar = (a, b) => b.registrados - a.registrados || String(a.nombre).localeCompare(String(b.nombre), 'es');
  coordinadores.sort(ordenar);
  lideres.sort(ordenar);

  const datos = { coordinadores, lideres, zonas };
  _cacheEquipo = { t: Date.now(), ocultar, datos };
  return datos;
}

/** La ficha de un coordinador: sus cifras y sus líderes con el punto de actividad. null si no es coordinador activo de la campaña. */
async function fichaCoordinador(id, ocultar = '') {
  const { coordinadores } = await equipoCampana(ocultar);
  const c = coordinadores.find((x) => Number(x.id) === Number(id));
  if (!c) return null;
  const eq = await equipoDelCoordinador(pool, c.id, ocultar);
  const lideres = eq.miembros.filter((m) => m.rol === 'lider').map((m) => ({
    id: m.id, nombre: m.nombre, zona: m.barrio || null,
    telefono: m.telefono, no_contactar: !!m.no_contactar,
    registrados: m.registros, meta: m.meta, porcentaje: m.porcentaje === null || m.porcentaje === undefined ? null : Math.round(m.porcentaje),
    dias_sin_registrar: m.dias_sin_registrar, punto: puntoDe(m.dias_sin_registrar),
    sublideres: m.sublideres,
  })).sort((a, b) => b.registrados - a.registrados || String(a.nombre).localeCompare(String(b.nombre), 'es'));
  return { coordinador: c, sublideres: eq.resumen.sublideres, lideres };
}

/* ------------------------------------------------------------------------------------------------------------ INICIO */

function horaTexto(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return '';
  const h24 = Number(m[1]);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${m[2]} ${h24 < 12 ? 'a. m.' : 'p. m.'}`;
}

const LETRA_DIA = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

async function cabecera() {
  let c = {};
  try {
    [[c]] = await pool.query(
      `SELECT nombre_candidato, slogan_campana, meta_votos_campana, DATE_FORMAT(fecha_eleccion, '%Y-%m-%d') AS fecha_eleccion,
              DATEDIFF(fecha_eleccion, CURDATE()) AS dias
         FROM configuracion_campana WHERE id = 1`);
  } catch (_) { c = {}; }
  c = c || {};
  let foto = null;
  try {
    const [[f]] = await pool.query(`SELECT foto_url FROM contenido_paginas WHERE clave = 'biografia_candidato'`);
    foto = (f && f.foto_url) || null;
  } catch (_) { foto = null; }
  /* LA FECHA DE INICIO DE LA CAMPAÑA no existe hoy en «Datos de la campaña». Si algún día la columna `fecha_inicio_campana` existe, se usa; si no (o está
     vacía), no hay etiqueta de ritmo. Se pide aparte, con su propio try: una columna que falta no puede tumbar el Inicio. */
  let inicio = null;
  try {
    const [[i]] = await pool.query(
      `SELECT DATEDIFF(CURDATE(), fecha_inicio_campana) AS transcurridos, DATEDIFF(fecha_eleccion, fecha_inicio_campana) AS total
         FROM configuracion_campana WHERE id = 1 AND fecha_inicio_campana IS NOT NULL`);
    if (i && num(i.total) > 0) inicio = { transcurridos: num(i.transcurridos), total: num(i.total) };
  } catch (_) { inicio = null; }
  return {
    candidato: { nombre: c.nombre_candidato || null, eslogan: c.slogan_campana || null, foto_url: foto },
    fecha_eleccion: c.fecha_eleccion || null,
    dias: c.dias === null || c.dias === undefined ? null : num(c.dias),
    meta: c.meta_votos_campana === null || c.meta_votos_campana === undefined ? 0 : num(c.meta_votos_campana),
    inicio,
  };
}

async function resumen(ocultar = '') {
  const cab = await cabecera();
  const a = await alcanceVotantesMadre();

  const [[tot]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(v.created_at >= CURDATE() - INTERVAL 6 DAY), 0) AS semana
       FROM votantes v WHERE ${a.sql}`, a.valores);
  const [dias] = await pool.query(
    `SELECT DATE_FORMAT(DATE(v.created_at), '%Y-%m-%d') AS f, COUNT(*) AS n
       FROM votantes v WHERE v.created_at >= CURDATE() - INTERVAL 6 DAY AND ${a.sql} GROUP BY f`, a.valores);
  const [[{ hoy }]] = await pool.query(`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy`);
  const porFecha = new Map(dias.map((d) => [d.f, num(d.n)]));
  const [y, m, d0] = hoy.split('-').map(Number);
  const por_dia = [];
  for (let i = 6; i >= 0; i--) {
    const f = new Date(Date.UTC(y, m - 1, d0 - i));
    const iso = f.toISOString().slice(0, 10);
    por_dia.push({ fecha: iso, dia: LETRA_DIA[f.getUTCDay()], n: porFecha.get(iso) || 0, hoy: i === 0 });
  }

  const registrados = num(tot.total);
  const porcentaje = cab.meta > 0 ? Math.round((registrados / cab.meta) * 100) : null;
  let ritmo = null; let tiempo_pct = null;
  if (porcentaje !== null && cab.inicio) {
    tiempo_pct = Math.max(0, Math.min(100, Math.round((cab.inicio.transcurridos / cab.inicio.total) * 100)));
    ritmo = porcentaje >= tiempo_pct ? 'al_ritmo' : 'por_debajo';
  }

  const eq = await equipoCampana(ocultar);
  const coordTotal = eq.coordinadores.length;
  const coordSin = eq.coordinadores.filter((c) => !c.activo).length;
  const lidTotal = eq.lideres.length;
  const lidActivos = eq.lideres.filter((l) => l.activo).length;

  const [[pu]] = await pool.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(p.id IN (SELECT COALESCE(e.puesto_id, u.puesto_id) FROM estructura e JOIN usuarios u ON u.id = e.usuario_id
                                   WHERE e.cargo = 'testigo' AND e.activo = 1 AND COALESCE(e.puesto_id, u.puesto_id) IS NOT NULL)
                 OR p.id IN (SELECT DISTINCT puesto_id FROM votantes WHERE puesto_id IS NOT NULL)), 0) AS cubiertos
       FROM dia_d_puestos_votacion p`);

  const proximos = await eventosEntre(null, null, 3);

  return {
    generado_en: new Date().toISOString(),
    candidato: cab.candidato,
    eleccion: { fecha: cab.fecha_eleccion, dias: cab.dias },
    meta: { meta: cab.meta, registrados, porcentaje, ritmo, tiempo_pct },
    semana: { registrados: num(tot.semana) },
    coordinadores: { total: coordTotal, activos: coordTotal - coordSin, sin_actividad: coordSin },
    lideres: { total: lidTotal, activos: lidActivos, porcentaje_activos: lidTotal > 0 ? Math.round((lidActivos / lidTotal) * 100) : 0 },
    puestos: { total: num(pu.total), cubiertos: num(pu.cubiertos) },
    por_dia,
    proximos_eventos: proximos,
  };
}

/* ------------------------------------------------------------------------------------------------------------ AGENDA */

/**
 * Eventos entre dos fechas (YYYY-MM-DD, inclusive). Sin fechas: los próximos (programados, desde ahora), `limite` como máximo.
 * Trae organizador y asistentes SOLO como cifras: ni nombres ni teléfonos de los asistentes.
 */
async function eventosEntre(desde, hasta, limite = 100) {
  const filtro = desde
    ? 'e.fecha_inicio >= ? AND e.fecha_inicio < DATE_ADD(?, INTERVAL 1 DAY)'
    : `e.fecha_inicio >= NOW() AND e.estado = 'programado'`;
  const valores = desde ? [desde, hasta] : [];
  const [filas] = await pool.query(
    `SELECT e.id, e.titulo, e.lugar, e.estado, e.tipo, e.meta_asistentes,
            DATE_FORMAT(e.fecha_inicio, '%Y-%m-%d') AS fecha, DATE_FORMAT(e.fecha_inicio, '%H:%i') AS hora24,
            (e.fecha_inicio < NOW()) AS pasado,
            COALESCE(ou.nombre, cu.nombre) AS organizador,
            (SELECT COUNT(*) FROM evento_asistentes a WHERE a.evento_id = e.id) AS invitados,
            (SELECT COUNT(*) FROM evento_asistentes a WHERE a.evento_id = e.id AND a.confirmado = 1) AS confirmados,
            (SELECT COUNT(*) FROM evento_asistentes a WHERE a.evento_id = e.id AND a.asistio = 1) AS asistieron
       FROM eventos e
       LEFT JOIN usuarios ou ON ou.id = e.responsable_id
       LEFT JOIN usuarios cu ON cu.id = e.created_by
      WHERE ${filtro}
      ORDER BY e.fecha_inicio ASC
      LIMIT ${Number(limite) || 100}`, valores);
  return filas.map((f) => ({
    id: f.id, titulo: f.titulo, fecha: f.fecha, hora: horaTexto(f.hora24), lugar: f.lugar || null,
    organizador: f.organizador || null, estado: f.estado, pasado: Number(f.pasado) === 1,
    invitados: num(f.invitados), confirmados: num(f.confirmados), asistieron: num(f.asistieron),
    meta_asistentes: num(f.meta_asistentes),
  }));
}

/* ------------------------------------------------------------------------------------------------------------- MAPA */

/**
 * Las zonas (comunas o corregimientos) con lo que tienen. Solo cifras por zona y el centro de los votantes con coordenadas: NO devuelve personas,
 * ni direcciones, ni coordenadas de una casa (a diferencia de /territorial/mapa-personas, que es del administrador).
 */
async function mapaZonas(ocultar = '') {
  const a = await alcanceVotantesMadre();
  const [filas] = await pool.query(
    `SELECT ${ZONA_ID} AS id, MIN(${ZONA_NOMBRE}) AS nombre, COUNT(*) AS votantes,
            AVG(v.latitud) AS lat, AVG(v.longitud) AS lng, COUNT(DISTINCT v.puesto_id) AS puestos
       FROM votantes v
       LEFT JOIN territorios t ON t.id = v.territorio_id
       LEFT JOIN territorios p ON p.id = t.padre_id
      WHERE v.territorio_id IS NOT NULL AND ${a.sql}
      GROUP BY ${ZONA_ID}`, a.valores);
  const eq = await equipoCampana(ocultar);
  const lideresPorZona = new Map();
  eq.lideres.forEach((l) => { if (l.zona_id) lideresPorZona.set(l.zona_id, (lideresPorZona.get(l.zona_id) || 0) + 1); });
  const coordPorZona = new Map();
  eq.coordinadores.forEach((c) => { if (c.zona_id && !coordPorZona.has(c.zona_id)) coordPorZona.set(c.zona_id, c.nombre); });

  const zonas = filas.filter((f) => f.id !== null && f.nombre).map((f) => ({
    id: f.id, nombre: f.nombre, votantes: num(f.votantes), lideres: lideresPorZona.get(f.id) || 0,
    puestos: num(f.puestos), coordinador: coordPorZona.get(f.id) || null,
    lat: f.lat === null ? null : Number(f.lat), lng: f.lng === null ? null : Number(f.lng),
  })).sort((x, y) => y.votantes - x.votantes);

  const [ev] = await pool.query(
    `SELECT e.id, e.titulo, DATE_FORMAT(e.fecha_inicio, '%Y-%m-%d') AS fecha, e.latitud AS lat, e.longitud AS lng
       FROM eventos e
      WHERE e.latitud IS NOT NULL AND e.longitud IS NOT NULL AND e.estado = 'programado' AND e.fecha_inicio >= NOW()
      ORDER BY e.fecha_inicio LIMIT 60`);
  return {
    zonas,
    eventos: ev.map((e) => ({ id: e.id, titulo: e.titulo, fecha: e.fecha, lat: Number(e.lat), lng: Number(e.lng) })),
  };
}

/* -------------------------------------------------------------------------------------------------------- MÁS: LOS TRES */

async function solicitudes() {
  const Panel = require('./solicitudesPanel');
  const p = await Panel.panel({ cargo: 'madre' }, {});
  return {
    total: p.total,
    nuevas: p.porEstado.registrada,
    en_tramite: p.porEstado.en_revision + p.porEstado.remitida,
    resueltas: p.porEstado.cerrada,
    mas_pedidas: p.porCategoria.filter((c) => c.total > 0).slice(0, 5).map((c) => ({ nombre: c.nombre, total: c.total })),
    sin_movimiento: p.sinMovimiento ? p.sinMovimiento.n : 0,
  };
}

async function tareas() {
  const Panel = require('./tareasPanel');
  const p = await Panel.panel({ cargo: 'madre' }, {});
  const t = p.totales;
  return {
    total: t.total, abiertas: t.abiertas, hechas: t.hechas, verificadas: t.verificadas, canceladas: t.canceladas, vencidas: t.vencidas,
    cumplimiento: t.cumplimiento,
    por_responsable: p.porPersona.slice(0, 8).map((x) => ({ nombre: x.nombre, total: x.total, abiertas: x.abiertas, hechas: x.hechas + x.verificadas, vencidas: x.vencidas })),
  };
}

/** Puerta a puerta: SOLO los conteos del panel que ya existe (lib/puertaPanel.js), con sus reglas de mínimo por celda (nunca una casa). */
async function puertaAPuerta() {
  const Panel = require('./puertaPanel');
  const p = await Panel.panel({ alcance: { cargo: 'madre' }, filtro: {} });
  if (p.oculto || !p.total) return { oculto: true, minimo: p.minimo, total: null, zonas: [] };
  const t = p.total;
  return {
    oculto: false, minimo: p.minimo,
    total: { listas: t.listas, asignadas: t.asignadas, visitadas: t.visitadas, visitas: t.visitas },
    zonas: p.zonas.concat(p.otras ? [p.otras] : []).slice(0, 6).map((z) => ({ zona: z.zona, asignadas: z.asignadas, visitadas: z.visitadas })),
  };
}

async function diaD() {
  const a = await alcanceVotantesMadre();
  const { estadoDeLaElección } = require('../config/yaVotoEnlace');
  const eleccion = await estadoDeLaElección();
  const [[t]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(vv.votante_id IS NOT NULL), 0) AS votaron, MAX(vv.voto_en) AS ultima
       FROM votantes v LEFT JOIN votante_votos vv ON vv.votante_id = v.id WHERE ${a.sql}`, a.valores);
  const [puestos] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(MAX(v.puesto_votacion)), ''), 'Sin puesto registrado') AS puesto, COUNT(*) AS total, SUM(vv.votante_id IS NOT NULL) AS votaron
       FROM votantes v LEFT JOIN votante_votos vv ON vv.votante_id = v.id
      WHERE ${a.sql} GROUP BY IF(v.puesto_id IS NOT NULL, CONCAT('p', v.puesto_id), LOWER(TRIM(COALESCE(v.puesto_votacion, ''))))
      ORDER BY (COUNT(*) - SUM(vv.votante_id IS NOT NULL)) DESC, puesto LIMIT 5`, a.valores);
  const total = num(t.total); const votaron = num(t.votaron);
  return {
    fecha_eleccion: eleccion.fecha, modo_prueba: !eleccion.esHoy,
    total, votaron, faltan: total - votaron, porcentaje: total > 0 ? Math.round((votaron / total) * 100) : null,
    ultima_marca: t.ultima || null,
    por_puesto: puestos.map((p) => ({ puesto: p.puesto, total: num(p.total), votaron: num(p.votaron), faltan: num(p.total) - num(p.votaron) })),
  };
}

module.exports = {
  equipoCampana, fichaCoordinador, resumen, eventosEntre, mapaZonas, solicitudes, tareas, diaD, puertaAPuerta, olvidarEquipo, puntoDe,
  ZONA_ID, ZONA_NOMBRE, DIAS_SIN_ACTIVIDAD,
};
