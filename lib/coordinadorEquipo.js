/**
 * «MIS LÍDERES» del coordinador en el celular (orden 59): su rama —líderes y sublíderes—, con el avance de cada uno, el
 * último registro y las cuatro últimas semanas.
 *
 * NO INVENTA UNA REGLA DE ALCANCE NI UNA DE CONTEO: reutiliza las dos que ya existían.
 *
 *   · QUIÉN ES DE SU RAMA es la regla de Votantes para el coordinador (`condicionAlcanceVotantes` en lib/alcanceVotantes.js):
 *     los que le reportan DIRECTO (`estructura.supervisor_id` = él) y los que reportan a esos (dos niveles). Aquí: líderes
 *     (cargo 'lider') que le reportan a él, y sublíderes (cargo 'usuario') que le reportan a él o a uno de esos líderes. Nadie
 *     más: un id de otra rama no existe para esta consulta (la ruta responde 404).
 *   · CUÁNTOS REGISTROS LLEVA UN LÍDER, y su meta, salen de `avanceDeLideres` (lib/avanceLideres.js): la MISMA consulta que
 *     usaba «Avance de mis líderes», con su regla de «votantes distintos cuyo lider_id es él o uno de sus sublíderes». Lo que
 *     se agrega aquí es lo que esa pantalla no tenía: el último registro, los últimos 7 días, las semanas y los sublíderes.
 *   · Un SUBLÍDER cuenta lo que él registró: fichas con `sublider_id` = él (o `lider_id` = él, por las antiguas). Es la
 *     definición de la «posición» y del «equipo» del panel del líder (lib/panelLider.js).
 *
 * Los DÍAS son del calendario de Colombia: la conexión fija -05:00 (config/db.js), así que CURDATE() y DATE() son de Colombia.
 */
'use strict';

const { avanceDeLideres, porcentajeDe } = require('./avanceLideres');

/** Semáforo: rojo < 40 %, amarillo 40–79 %, verde ≥ 80 %. (El avance de líderes no tenía uno: el del Día D es de otra cosa, 50/75.) */
const UMBRAL_ROJO = 40;
const UMBRAL_VERDE = 80;
/** «Sin registrar hace N días»: desde 7 días, en rojo. Quien nunca ha registrado también cuenta. */
const DIAS_SIN_REGISTRAR = 7;
const SEMANAS = 4;

function semaforoDe(sinMeta, porcentaje) {
  if (sinMeta) return 'sin_meta';
  if (porcentaje < UMBRAL_ROJO) return 'rojo';
  if (porcentaje < UMBRAL_VERDE) return 'amarillo';
  return 'verde';
}

/** Solo los dígitos de un teléfono; null si no hay. */
function digitosDeTelefono(t) {
  const d = String(t == null ? '' : t).replace(/\D/g, '');
  return d || null;
}

/** Un celular colombiano válido: 10 dígitos que empiezan por 3 (con o sin el 57 delante). Devuelve los 10 o null. */
function celularValido(telefono) {
  let d = digitosDeTelefono(telefono);
  if (!d) return null;
  if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
  return /^3\d{9}$/.test(d) ? d : null;
}

/** El fragmento SQL que nombra a los líderes del coordinador (alias `u` para el filtro del superadministrador oculto). */
const SQL_LIDERES = `
  lideres AS (
    SELECT DISTINCT e.usuario_id AS id
      FROM estructura e JOIN usuarios u ON u.id = e.usuario_id
     WHERE e.cargo = 'lider' AND e.activo = 1 AND e.supervisor_id = ? __OCULTAR__
  )`;

/** Cuántas semanas cuenta cada columna: w0 = hoy y los 6 días anteriores, w1 = los 7 de antes, etc. */
function columnasDeSemanas(alias = 'v') {
  const d = `DATEDIFF(CURDATE(), DATE(${alias}.created_at))`;
  const cols = [];
  for (let i = 0; i < SEMANAS; i++) {
    cols.push(`COUNT(DISTINCT CASE WHEN ${d} BETWEEN ${i * 7} AND ${i * 7 + 6} THEN ${alias}.id END) AS w${i}`);
  }
  return cols.join(', ');
}

/**
 * La rama completa del coordinador, lista para pintar.
 *
 * @param pool        pool de mysql2/promise
 * @param coordinadorId usuarios.id del coordinador
 * @param ocultar     fragmento ` AND u.es_superadmin = 0` (filtroOcultar), o ''
 * @returns {{ coordinador:null, hoy:string, resumen:object, miembros:object[] }}
 */
async function equipoDelCoordinador(pool, coordinadorId, ocultar = '') {
  const [[{ hoy }]] = await pool.query(`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy`);

  // 1) Los líderes con su meta y registros: la consulta de «Avance de mis líderes», tal cual.
  const { lideres: avance, total } = await avanceDeLideres(pool, coordinadorId, ocultar);
  const avancePorId = new Map(avance.map((l) => [l.id, l]));

  // 2) Quién es quién: líderes y sublíderes de la rama, con su zona, su supervisor y lo que hace falta para contactarlos.
  const lid = SQL_LIDERES.replace('__OCULTAR__', ocultar);
  const [filas] = await pool.query(
    `WITH ${lid}
     SELECT e.usuario_id AS id, e.cargo, e.supervisor_id, u.nombre, u.telefono, u.no_contactar,
            MAX(COALESCE(e.meta_votos, 0)) AS meta, MAX(t.nombre) AS barrio
       FROM estructura e
       JOIN usuarios u ON u.id = e.usuario_id
       LEFT JOIN territorios t ON t.id = e.territorio_id
      WHERE e.activo = 1
        AND ( (e.cargo = 'lider' AND e.supervisor_id = ?)
           OR (e.cargo = 'usuario' AND (e.supervisor_id = ? OR e.supervisor_id IN (SELECT id FROM lideres))) )
        ${ocultar}
      GROUP BY e.usuario_id, e.cargo, e.supervisor_id, u.nombre, u.telefono, u.no_contactar`,
    [coordinadorId, coordinadorId, coordinadorId]);

  // Una persona puede figurar dos veces (líder y también sublíder bajo otro): se queda como líder.
  const base = new Map();
  for (const f of filas) {
    const previo = base.get(f.id);
    if (!previo || (previo.cargo !== 'lider' && f.cargo === 'lider')) base.set(f.id, f);
  }
  const nombrePorId = new Map([...base.values()].map((f) => [f.id, f.nombre]));

  // 3) Lo que lleva cada líder en el tiempo: último registro y semanas. Mismos «votantes distintos» que usa el avance.
  const [porLider] = await pool.query(
    `WITH ${lid},
       miembros AS (
         SELECT id AS duenio, id AS miembro FROM lideres
         UNION
         SELECT es.supervisor_id, es.usuario_id FROM estructura es
          WHERE es.cargo = 'usuario' AND es.activo = 1 AND es.supervisor_id IN (SELECT id FROM lideres)
       )
     SELECT m.duenio AS id, COUNT(DISTINCT v.id) AS total,
            DATE_FORMAT(MAX(v.created_at), '%Y-%m-%d %H:%i') AS ultimo,
            DATEDIFF(CURDATE(), DATE(MAX(v.created_at))) AS dias, ${columnasDeSemanas()}
       FROM miembros m JOIN votantes v ON v.lider_id = m.miembro
      GROUP BY m.duenio`, [coordinadorId]);
  // 4) Lo mismo para cada sublíder: lo que él registró.
  const [porSublider] = await pool.query(
    `WITH ${lid},
       subs AS (
         SELECT DISTINCT es.usuario_id AS id FROM estructura es JOIN usuarios u ON u.id = es.usuario_id
          WHERE es.cargo = 'usuario' AND es.activo = 1
            AND (es.supervisor_id = ? OR es.supervisor_id IN (SELECT id FROM lideres)) ${ocultar}
       )
     SELECT s.id, COUNT(DISTINCT v.id) AS total,
            DATE_FORMAT(MAX(v.created_at), '%Y-%m-%d %H:%i') AS ultimo,
            DATEDIFF(CURDATE(), DATE(MAX(v.created_at))) AS dias, ${columnasDeSemanas()}
       FROM subs s JOIN votantes v ON (v.lider_id = s.id OR v.sublider_id = s.id)
      GROUP BY s.id`, [coordinadorId, coordinadorId]);
  const tiempo = new Map([...porLider, ...porSublider].map((r) => [r.id, r]));

  // 5) Las cifras del encabezado: personas DISTINTAS de la rama y las de los últimos 7 días.
  const [[cifras]] = await pool.query(
    `WITH ${lid},
       miembros AS (
         SELECT id AS miembro FROM lideres
         UNION
         SELECT es.usuario_id FROM estructura es
          WHERE es.cargo = 'usuario' AND es.activo = 1 AND es.supervisor_id IN (SELECT id FROM lideres)
       )
     SELECT COUNT(DISTINCT v.id) AS personas,
            COUNT(DISTINCT CASE WHEN DATEDIFF(CURDATE(), DATE(v.created_at)) BETWEEN 0 AND 6 THEN v.id END) AS ultimos_7
       FROM miembros m JOIN votantes v ON v.lider_id = m.miembro`, [coordinadorId]);

  // Las fechas de cada semana, de la más antigua a la más reciente (para rotularlas).
  const [y, m, d] = hoy.split('-').map(Number);
  const iso = (offset) => new Date(Date.UTC(y, m - 1, d - offset)).toISOString().slice(0, 10);
  const rangos = [];
  for (let i = SEMANAS - 1; i >= 0; i--) rangos.push({ desde: iso(i * 7 + 6), hasta: iso(i * 7), clave: `w${i}` });

  const subsPorLider = new Map();
  for (const f of base.values()) {
    if (f.cargo === 'usuario' && f.supervisor_id && f.supervisor_id !== coordinadorId) {
      subsPorLider.set(f.supervisor_id, (subsPorLider.get(f.supervisor_id) || 0) + 1);
    }
  }

  const miembros = [...base.values()].map((f) => {
    const esLider = f.cargo === 'lider';
    const t = tiempo.get(f.id);
    const av = esLider ? avancePorId.get(f.id) : null;
    const metaBruta = esLider ? (av ? av.meta : 0) : (Number(f.meta) || 0);
    const sinMeta = esLider ? (av ? av.sin_meta : true) : metaBruta <= 0;
    const meta = sinMeta ? 0 : metaBruta;
    const registros = esLider ? (av ? av.registros : 0) : (t ? Number(t.total) : 0);
    const porcentaje = sinMeta ? null : (esLider && av ? av.porcentaje : porcentajeDe(registros, meta));
    const dias = t && t.dias !== null && t.dias !== undefined ? Number(t.dias) : null;
    const tel = celularValido(f.telefono);
    return {
      id: f.id,
      rol: esLider ? 'lider' : 'sublider',
      nombre: f.nombre,
      barrio: f.barrio || null,
      supervisor_id: f.supervisor_id || null,
      supervisor_nombre: (f.supervisor_id && nombrePorId.get(f.supervisor_id)) || null,
      telefono: tel,                                   // los 10 dígitos del celular, o null (sin celular válido)
      no_contactar: !!f.no_contactar,
      meta, sin_meta: sinMeta, registros, porcentaje,
      cumplida: esLider && av ? !!av.cumplida : (!sinMeta && registros >= meta),
      semaforo: semaforoDe(sinMeta, porcentaje),
      ultimo_registro: t && t.ultimo ? t.ultimo : null,
      dias_sin_registrar: dias,                        // null = nunca ha registrado
      sin_registrar_7: dias === null || dias >= DIAS_SIN_REGISTRAR,
      registros_7_dias: t ? Number(t.w0) : 0,
      semanas: rangos.map((r) => ({ desde: r.desde, hasta: r.hasta, n: t ? Number(t[r.clave]) : 0 })),
      sublideres: esLider ? (subsPorLider.get(f.id) || 0) : 0,
    };
  });

  // Orden de entrada: líderes antes que sublíderes, y de menor a mayor avance (quien no tiene meta, al final).
  miembros.sort((a, b) => {
    if (a.rol !== b.rol) return a.rol === 'lider' ? -1 : 1;
    if (a.sin_meta !== b.sin_meta) return a.sin_meta ? 1 : -1;
    if (!a.sin_meta && a.porcentaje !== b.porcentaje) return a.porcentaje - b.porcentaje;
    return String(a.nombre).localeCompare(String(b.nombre), 'es');
  });

  const soloLideres = miembros.filter((x) => x.rol === 'lider');
  return {
    hoy,
    resumen: {
      lideres_activos: soloLideres.length,
      sublideres: miembros.length - soloLideres.length,
      personas_registradas: Number(cifras.personas) || 0,
      compromiso_total: total.meta,
      registros_con_meta: total.registros,
      porcentaje: total.porcentaje,
      sin_meta_total: total.sin_meta_total,
      registros_7_dias: Number(cifras.ultimos_7) || 0,
      lideres_sin_registrar_7: soloLideres.filter((x) => x.sin_registrar_7).length,
    },
    miembros,
  };
}

/** A cuál coordinador se le mira la rama. Devuelve `{ coordinador }` o `{ status, error }` para responder tal cual. */
async function coordinadorDeLaPeticion(pool, req) {
  const sesion = req.session.usuario;
  if (sesion.rol !== 'admin') return { coordinador: { id: sesion.id, nombre: sesion.nombre } };

  const pedido = Number(req.query.coordinador_id);
  if (!Number.isInteger(pedido) || pedido <= 0) {
    return { status: 400, error: 'Indica de qué coordinador quiere ver el avance (coordinador_id).' };
  }
  /* Se comprueba que SEA un coordinador de esta campaña, activo, y se le aplica el filtro del superadministrador oculto: sin eso esta ruta
     serviría para sondear ids de usuario. El 404 es el mismo para «no existe» y «no es coordinador» (igual que /dashboard/avance-mis-lideres). */
  const { filtroOcultar } = require('../config/superadmin');
  const ocultarAlConsultado = await filtroOcultar(sesion, 'u');
  const [[fila]] = await pool.query(
    `SELECT u.id, u.nombre FROM estructura e JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.usuario_id = ? AND e.cargo = 'coordinador' AND e.activo = 1 ${ocultarAlConsultado} LIMIT 1`, [pedido]);
  if (!fila) return { status: 404, error: 'Ese coordinador no existe.' };
  return { coordinador: { id: fila.id, nombre: fila.nombre } };
}

module.exports = {
  equipoDelCoordinador, coordinadorDeLaPeticion, celularValido, semaforoDe,
  UMBRAL_ROJO, UMBRAL_VERDE, DIAS_SIN_REGISTRAR, SEMANAS,
};
