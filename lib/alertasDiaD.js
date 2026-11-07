/**
 * El CÁLCULO del cuadro de alertas del Día D — una sola copia para el GET /api/dia-d/alertas (al pedirlo) y para los avisos
 * automáticos (routes/…, lib/avisosAlertas.js). Vivía dentro de la ruta; se sacó aquí para que los dos lean lo mismo.
 *
 * LAS SIETE, DE MÁS A MENOS GRAVE:
 *   1 mesa_sin_testigo_con_votantes  la mesa no tiene testigo y la campaña SÍ tiene votantes ahí
 *   2 testigo_no_llego               asignado y sin «Llegué» pasada la apertura + minutos de gracia        (depende de la hora)
 *   3 mesa_sin_e14                   mesa con testigo y sin E-14 pasado el cierre + plazo                  (depende de la hora)
 *   4 reporte_con_alertas            el último reporte de la mesa trae alertas del servidor
 *   5 diferencia_con_oficial         el resultado oficial no coincide con lo que dijo el testigo
 *   6 baja_votacion                  un puesto con «ya votó» bajo el umbral desde cierta hora               (depende de la hora)
 *   7 mesa_sin_testigo               la mesa no tiene testigo y no hay votantes propios ahí (la menos urgente)
 *
 * QUÉ DEPENDE DEL ALCANCE DE QUIEN PREGUNTA, y qué no: sólo las alertas 1 y 6 (y el dato de transporte) leen los votantes del
 * alcance. Los testigos, las llegadas, los reportes y las diferencias son de la CAMPAÑA (se acotan por su dueño), iguales para
 * todos los de esa campaña. Por eso los avisos automáticos calculan UNA vez por campaña y rehacen sólo 1 y 6 para quien no ve
 * toda la campaña (ver `alertasParaUsuario`).
 */
'use strict';

const pool = require('../config/db');
const jornada = require('./jornadaDiaD');
const { pasoElPlazoDelE14 } = require('./mesasEnVivo');
const { crearResolutorDePuestos } = require('./puestosDiaD');
const { calcularEstimadoPorPuesto } = require('../config/estimadoPuestos');
const { filtroAlcanceEstimado, condicionAlcanceVotantes, parametrosAlcanceVotantes } = require('./alcanceVotantes');
const {
  cargarTestigos, repartirPorPuesto, armarDetallePuesto, leerLimiteDeMesas,
} = require('./coberturaTestigos');

const TIPOS = [
  { tipo: 'mesa_sin_testigo_con_votantes', gravedad: 1, nombre: 'Mesa sin testigo (con votantes)' },
  { tipo: 'testigo_no_llego', gravedad: 2, nombre: 'Testigo que no llegó' },
  { tipo: 'mesa_sin_e14', gravedad: 3, nombre: 'Mesa sin E-14' },
  { tipo: 'reporte_con_alertas', gravedad: 4, nombre: 'Reporte con alertas' },
  { tipo: 'diferencia_con_oficial', gravedad: 5, nombre: 'Diferencia con el oficial' },
  { tipo: 'baja_votacion', gravedad: 6, nombre: 'Baja votación' },
  { tipo: 'mesa_sin_testigo', gravedad: 7, nombre: 'Mesa sin testigo (sin votantes)' },
];
const GRAVEDAD = Object.fromEntries(TIPOS.map(t => [t.tipo, t.gravedad]));
const TOPE_SIN_VOTANTES = 400;
/** Un puesto con menos votantes que esto no entra en «baja votación»: con 3 personas, un 0 % es ruido. */
const MIN_VOTANTES_BAJA = 5;


/* ——— el cálculo ———————————————————————————————————————————————————— */
function claveAlerta(tipo, puestoId, mesa) { return `${tipo}|${puestoId || 0}|${mesa || 0}`; }

/** A partir de cuándo (hh:mm de hoy) se activa una alerta que depende de la hora. */
const desdeHoy = (ahora, minutos) => `${ahora.fecha} ${jornada.hhmm(minutos)}`;

async function calcularAlertas(req, { conContexto = false } = {}) {
  const diaD = require('../routes/diaD.routes').compartido;      // perezoso: las rutas requieren esta librería
  const dueno = await diaD.duenoDeLaCampana(req);
  const cfg = await jornada.leerJornada(pool);
  const ahora = jornada.ahoraColombia();
  const estado = jornada.estadoDeLaJornada(cfg, ahora);
  const resultados = require('../routes/resultadosDiaD.routes');       // perezoso: se requieren entre sí
  const rescate = require('../routes/rescateVotos.routes');

  const [puestos] = await pool.query(
    `SELECT id, nombre, cantidad_mesas, ctc_puesto_id FROM dia_d_puestos_votacion WHERE aspirante_id = ? ORDER BY nombre`, [dueno]);
  const resolver = crearResolutorDePuestos(puestos);
  const testigos = await cargarTestigos(pool, dueno);
  const porPuesto = repartirPorPuesto(testigos, puestos);
  const limite = await leerLimiteDeMesas(pool);

  // Votantes propios por mesa (con el alcance de quien pregunta) — el mismo dato de la tabla de cobertura.
  const votantesPorMesa = new Map();
  try {
    const est = await calcularEstimadoPorPuesto(pool, filtroAlcanceEstimado(req), dueno);
    est.puestos.forEach(e => {
      const m = new Map();
      (e.mesas || []).forEach(x => { if (x.cantidad > 0) m.set(Number(x.mesa), x.cantidad); });
      votantesPorMesa.set(e.puesto, m);
    });
  } catch (err) { console.warn('alertas: sin el cruce de votantes por mesa:', err.code || err.message); }

  const [llegadas] = await pool.query(
    `SELECT usuario_id, DATE_FORMAT(llegado_en, '%Y-%m-%d %H:%i') AS llegado_en, origen, distancia_m
       FROM dia_d_checkin WHERE aspirante_id = ? AND fecha = ?`, [dueno, ahora.fecha]);
  const llegoPor = new Map(llegadas.map(l => [l.usuario_id, l]));

  // El último reporte de cada mesa. Los votos sólo se cargan si hay resultado oficial con qué compararlos.
  const [[{ n: nOficial }]] = await pool.query(
    `SELECT COUNT(*) AS n FROM dia_d_resultado_oficial WHERE aspirante_id = ?`, [dueno]);
  const j = await resultados.cargarJornada(req, { conVotos: Number(nOficial) > 0 });

  const [atendidas] = await pool.query(
    `SELECT a.tipo, a.puesto_id, a.mesa, a.atendida_por, u.nombre AS atendida_nombre,
            DATE_FORMAT(a.atendida_en, '%Y-%m-%d %H:%i') AS atendida_en, a.nota
       FROM dia_d_alertas_atendidas a LEFT JOIN usuarios u ON u.id = a.atendida_por
      WHERE a.aspirante_id = ? AND a.fecha = ?`, [dueno, ahora.fecha]);
  const atendidaPor = new Map(atendidas.map(a => [claveAlerta(a.tipo, a.puesto_id, a.mesa), a]));

  // Faltantes que necesitan transporte, por puesto (un dato, no una alerta).
  const transporte = new Map();
  if (req.alcance) {
    try {
      const [filas] = await pool.query(
        `SELECT v.puesto_id, v.puesto_votacion, COUNT(*) AS n
           FROM votantes v LEFT JOIN votante_votos vv ON vv.votante_id = v.id
          WHERE v.necesita_transporte = 1 AND vv.votante_id IS NULL AND ${condicionAlcanceVotantes(req.alcance, 'v')}
          GROUP BY v.puesto_id, v.puesto_votacion`, parametrosAlcanceVotantes(req.alcance));
      for (const f of filas) {
        const g = resolver({ puesto_id: f.puesto_id, puesto_votacion: f.puesto_votacion });
        if (g.puesto) transporte.set(g.puesto.id, (transporte.get(g.puesto.id) || 0) + Number(f.n));
      }
    } catch (err) { console.warn('alertas: sin el dato de transporte:', err.code || err.message); }
  }

  const alertas = [];
  let sinVotantesTotal = 0;
  const poner = (a) => {
    const tipo = TIPOS.find(t => t.tipo === a.tipo);
    const k = claveAlerta(a.tipo, a.puesto_id, a.mesa);
    const at = atendidaPor.get(k);
    alertas.push({
      id: k, nombre_tipo: tipo.nombre, gravedad: tipo.gravedad, mesa: null, desde: null, responsable: null, detalle: '',
      estado: 'activa', pendiente_hasta: null,
      atendida: !!at, atendida_por: at ? at.atendida_nombre : null, atendida_en: at ? at.atendida_en : null, nota: at ? at.nota : null,
      faltan_transporte: transporte.get(a.puesto_id) || 0,
      ...a,
    });
  };
  const persona = (t) => (t ? { usuario_id: t.usuario_id, nombre: t.nombre, telefono: t.telefono || '' } : null);

  // Cuándo se activan las que dependen de la hora.
  const activaLlegada = cfg.apertura_min + cfg.alerta_checkin_min;
  const activaE14 = cfg.cierre_min + cfg.plazo_e14_min;
  const llegadaYaToca = ahora.minutos >= activaLlegada;
  const e14YaToca = pasoElPlazoDelE14(cfg, ahora);
  const bajaYaToca = ahora.minutos >= cfg.baja_desde_min;

  for (const p of puestos) {
    const delPuesto = porPuesto.get(Number(p.id)) || [];
    const det = armarDetallePuesto(p, delPuesto, votantesPorMesa.get(p.nombre), 0, limite);
    // El responsable de una mesa sin testigo: el coordinador de puesto (testigo de varias mesas) de ese puesto, si lo hay.
    const coordinador = delPuesto.find(t => t.tipo_testigo === 'puesto') || null;

    for (const m of det.mesas_detalle) {
      if (m.testigo_id) continue;
      if (m.votantes > 0) {
        poner({ tipo: 'mesa_sin_testigo_con_votantes', puesto_id: p.id, puesto: p.nombre, mesa: m.mesa,
          detalle: `${m.votantes === 1 ? '1 votante propio vota' : m.votantes + ' votantes propios votan'} en esta mesa y no tiene testigo.`,
          responsable: persona(coordinador) });
      } else {
        sinVotantesTotal++;
        if (sinVotantesTotal <= TOPE_SIN_VOTANTES) {
          poner({ tipo: 'mesa_sin_testigo', puesto_id: p.id, puesto: p.nombre, mesa: m.mesa,
            detalle: 'Mesa sin testigo (sin votantes propios registrados).', responsable: persona(coordinador) });
        }
      }
    }

    // b) testigo que no llegó — uno por testigo (sobre su primera mesa)
    for (const t of delPuesto) {
      if (!t.activo || !t.mesas.length) continue;
      if (llegoPor.has(t.usuario_id)) continue;
      poner({ tipo: 'testigo_no_llego', puesto_id: p.id, puesto: p.nombre, mesa: t.mesas[0],
        detalle: `${t.nombre} no ha marcado su llegada (mesa${t.mesas.length > 1 ? 's' : ''} ${t.mesas.join(', ')}).`,
        responsable: persona(t),
        estado: llegadaYaToca ? 'activa' : 'pendiente', pendiente_hasta: llegadaYaToca ? null : jornada.hhmm(activaLlegada),
        desde: desdeHoy(ahora, activaLlegada) });
    }

    // c) mesa con testigo y sin E-14
    const porMesa = new Map(det.mesas_detalle.map(m => [m.mesa, m]));
    for (const [mesa, m] of porMesa) {
      if (!m.testigo_id) continue;
      const r = j.vigentes.get(`p${p.id}|${mesa}`);
      if (r && r.tiene_foto) continue;
      const t = delPuesto.find(x => x.estructura_id === m.testigo_id);
      poner({ tipo: 'mesa_sin_e14', puesto_id: p.id, puesto: p.nombre, mesa,
        detalle: r ? 'Hay reporte pero sin la foto del E-14.' : 'Todavía no hay reporte ni E-14 de esta mesa.',
        responsable: persona(t),
        estado: e14YaToca ? 'activa' : 'pendiente', pendiente_hasta: e14YaToca ? null : jornada.hhmm(activaE14),
        desde: desdeHoy(ahora, activaE14) });
    }
  }

  // d) reportes con alertas — el último de cada mesa
  for (const r of j.vigentes.values()) {
    if (!r.alertas) continue;
    poner({ tipo: 'reporte_con_alertas', puesto_id: r.g.puesto ? r.g.puesto.id : 0, puesto: r.g.nombre, mesa: r.mesa,
      detalle: `Alertas del reporte: ${String(r.alertas).split(',').map(x => x.trim().replace(/_/g, ' ')).join(', ')}.`,
      responsable: { usuario_id: r.testigo_id, nombre: r.testigo_nombre, telefono: r.testigo_telefono || '' },
      desde: r.created_at ? String(r.created_at).slice(0, 16).replace('T', ' ') : null });
  }

  // e) diferencias con el resultado oficial
  if (Number(nOficial) > 0) {
    const dif = await resultados.calcularDiferencias(j, { filtro: 'cualquiera', fuente: 'todas' });
    const vistas = new Set();
    for (const d of dif.filas) {
      const k = `${d.puesto_id || 0}|${d.mesa}`;
      if (vistas.has(k)) continue;
      vistas.add(k);
      const r = j.vigentes.get(`p${d.puesto_id}|${d.mesa}`);
      poner({ tipo: 'diferencia_con_oficial', puesto_id: d.puesto_id || 0, puesto: d.puesto, mesa: d.mesa,
        detalle: d.delta_propio !== null && d.delta_propio !== undefined
          ? `El oficial difiere del testigo (${d.delta_propio > 0 ? '+' : ''}${d.delta_propio} votos para el propio).`
          : 'El oficial difiere de lo que reportó el testigo.',
        responsable: r ? { usuario_id: r.testigo_id, nombre: r.testigo_nombre, telefono: r.testigo_telefono || '' } : null,
        desde: d.hora_reporte ? String(d.hora_reporte).slice(0, 16).replace('T', ' ') : null });
    }
  }

  // f) puestos con baja votación
  if (req.alcance) {
    for (const a of alertasDeBajaVotacion(await rescate.resumenPorPuesto(req), { cfg, ahora, resolver })) poner(a);
  }

  // Orden: atendidas al final; luego gravedad; las activas antes que las pendientes; puesto y mesa.
  alertas.sort((a, b) => (a.atendida - b.atendida) || (a.gravedad - b.gravedad)
    || ((a.estado === 'pendiente') - (b.estado === 'pendiente'))
    || String(a.puesto).localeCompare(String(b.puesto), 'es') || (a.mesa || 0) - (b.mesa || 0));

  const conteos = Object.fromEntries(TIPOS.map(t => [t.tipo, { activas: 0, pendientes: 0, atendidas: 0 }]));
  for (const a of alertas) {
    const c = conteos[a.tipo];
    if (a.atendida) c.atendidas++; else if (a.estado === 'pendiente') c.pendientes++; else c.activas++;
  }
  // La 7 se cuenta ENTERA aunque la lista se corte (las atendidas sólo pueden estar entre las que salieron).
  conteos.mesa_sin_testigo.activas = Math.max(0, sinVotantesTotal - conteos.mesa_sin_testigo.atendidas);
  const resultado = {
    jornada: {
      ...estado, apertura: cfg.jornada_apertura, cierre: cfg.jornada_cierre, plazo_e14_min: cfg.plazo_e14_min,
      alerta_checkin_min: cfg.alerta_checkin_min, baja_votacion_pct: cfg.baja_votacion_pct, baja_votacion_desde: cfg.baja_votacion_desde,
    },
    tipos: TIPOS.map(t => ({ tipo: t.tipo, nombre: t.nombre, gravedad: t.gravedad, ...conteos[t.tipo] })),
    total_activas: Object.values(conteos).reduce((n, c) => n + c.activas, 0),
    sin_votantes_omitidas: Math.max(0, sinVotantesTotal - TOPE_SIN_VOTANTES),
    alertas,
  };
  // Para quien reparte las alertas entre usuarios (los avisos automáticos): lo que hace falta para rehacer las que dependen del alcance.
  if (conContexto) Object.defineProperty(resultado, 'contexto', { value: { dueno, cfg, ahora, puestos, resolver, poner, claveAlerta, atendidaPor, transporte }, enumerable: false });
  return resultado;
}


/**
 * Las alertas de «baja votación» a partir de «ya votó» por puesto. Aparte para poder rehacerlas con el resumen de UN usuario.
 * Devuelve borradores para `poner`.
 */
function alertasDeBajaVotacion(resumen, { cfg, ahora, resolver }) {
  const salida = [];
  const bajaYaToca = ahora.minutos >= cfg.baja_desde_min;
  for (const x of resumen) {
    const g = resolver({ puesto_votacion: x.puesto });
    if (!g.puesto || x.total < MIN_VOTANTES_BAJA || !(x.pct < cfg.baja_votacion_pct)) continue;
    const pct = String(x.pct).replace('.', ',');
    salida.push({ tipo: 'baja_votacion', puesto_id: g.puesto.id, puesto: g.puesto.nombre, mesa: null,
      detalle: `Han votado ${x.votaron} de ${x.total} (${pct} %): bajo el umbral de ${cfg.baja_votacion_pct} %.`,
      estado: bajaYaToca ? 'activa' : 'pendiente', pendiente_hasta: bajaYaToca ? null : cfg.baja_votacion_desde,
      desde: desdeHoy(ahora, cfg.baja_desde_min) });
  }
  return salida;
}

/**
 * Lo que un usuario CON ALCANCE LIMITADO (un coordinador con su rama) ve de las alertas de la campaña: las mismas, salvo las
 * dos que leen votantes (1 y 6), que se rehacen con SUS votantes —la misma regla del GET, con una consulta liviana por usuario—.
 * El administrador y el aspirante ven la campaña entera: para ellos `base` sirve tal cual.
 *
 * @param base   resultado de calcularAlertas(…, { conContexto: true }) de la campaña
 * @param alcance el alcance del usuario (lo que arma calcularAlcance)
 * @returns {Promise<object[]>} las alertas visibles para ese usuario
 */
async function alertasParaUsuario(base, alcance, conexion = pool) {
  const ctx = base.contexto;
  if (!alcance || alcance.cargo === 'madre' || alcance.cargo === 'aspirante') return base.alertas;
  const condicion = condicionAlcanceVotantes(alcance, 'v');
  const [filas] = await conexion.query(
    `SELECT v.puesto_id, v.puesto_votacion, v.mesa_votacion, COUNT(*) AS total, SUM(vv.votante_id IS NOT NULL) AS votaron
       FROM votantes v LEFT JOIN votante_votos vv ON vv.votante_id = v.id
      WHERE ${condicion} AND v.puesto_votacion IS NOT NULL AND TRIM(v.puesto_votacion) <> ''
      GROUP BY v.puesto_id, v.puesto_votacion, v.mesa_votacion`, parametrosAlcanceVotantes(alcance));
  const porMesa = new Set();                 // «puesto|mesa» donde el usuario tiene votantes
  const porPuesto = new Map();               // puesto.id → { puesto, total, votaron }
  for (const f of filas) {
    const g = ctx.resolver({ puesto_id: f.puesto_id, puesto_votacion: f.puesto_votacion });
    if (!g.puesto) continue;
    porMesa.add(`${g.puesto.id}|${Number(f.mesa_votacion) || 0}`);
    const p = porPuesto.get(g.puesto.id) || { puesto: g.puesto.nombre, total: 0, votaron: 0 };
    p.total += Number(f.total); p.votaron += Number(f.votaron);
    porPuesto.set(g.puesto.id, p);
  }
  const resumen = [...porPuesto.values()].map(p => ({ ...p, pct: p.total > 0 ? Math.round((p.votaron * 1000) / p.total) / 10 : 0 }));
  const propias = [];
  const salida = base.alertas.filter(a => a.tipo !== 'baja_votacion' && !(a.tipo === 'mesa_sin_testigo_con_votantes' && !porMesa.has(`${a.puesto_id}|${a.mesa}`)));
  // La baja votación del usuario, con la misma construcción de arriba. `atendida` se toma de lo que ya se marcó.
  for (const d of alertasDeBajaVotacion(resumen, ctx)) {
    const k = ctx.claveAlerta(d.tipo, d.puesto_id, d.mesa);
    const at = ctx.atendidaPor.get(k);
    propias.push({ id: k, nombre_tipo: TIPOS[5].nombre, gravedad: 6, mesa: null, desde: null, responsable: null, detalle: '',
      estado: 'activa', pendiente_hasta: null, atendida: !!at, atendida_por: at ? at.atendida_nombre : null, atendida_en: at ? at.atendida_en : null,
      nota: at ? at.nota : null, faltan_transporte: ctx.transporte.get(d.puesto_id) || 0, ...d });
  }
  return [...salida, ...propias];
}

module.exports = {
  TIPOS, GRAVEDAD, TOPE_SIN_VOTANTES, MIN_VOTANTES_BAJA, calcularAlertas, alertasParaUsuario, alertasDeBajaVotacion, claveAlerta,
};
