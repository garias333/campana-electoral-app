/**
 * Cuadro de alertas del Día D — lo que la coordinación tiene que atender AHORA. Montado en /api/dia-d/alertas.
 *
 * SE CALCULA AL PEDIRLO, no en un proceso aparte: la pantalla de escritorio la pide cada 30 s y la del celular cada 60, con el
 * alcance de quien pregunta. No hay nada que mantener en segundo plano ni que se pueda duplicar con un reinicio. (Los avisos
 * automáticos son otra cosa, de la orden 20.)
 *
 * LAS SIETE, DE MÁS A MENOS GRAVE:
 *   1 mesa_sin_testigo_con_votantes  la mesa no tiene testigo y la campaña SÍ tiene votantes ahí
 *   2 testigo_no_llego               asignado y sin «Llegué» pasada la apertura + minutos de gracia        (depende de la hora)
 *   3 mesa_sin_e14                   mesa con testigo y sin E-14 pasado el cierre + plazo                  (depende de la hora)
 *   4 reporte_con_alertas            el último reporte de la mesa trae alertas del servidor (suma distinta, fuera de lista…)
 *   5 diferencia_con_oficial         el resultado oficial no coincide con lo que dijo el testigo
 *   6 baja_votacion                  un puesto con «ya votó» bajo el umbral desde cierta hora               (depende de la hora)
 *   7 mesa_sin_testigo               la mesa no tiene testigo y no hay votantes propios ahí (la menos urgente)
 * Las que dependen de la hora salen como «pendiente» —en gris— ANTES de su hora, con la hora a la que se activan.
 *
 * QUÉ SE REÚSA, NO SE REHACE: la cobertura (lib/coberturaTestigos.js, por puesto_id), el último reporte de cada mesa y las
 * diferencias (routes/resultadosDiaD.routes.js), «ya votó» por puesto (routes/rescateVotos.routes.js) y los horarios
 * (lib/jornadaDiaD.js). Quien tenga la base cargada de testigos verá lo mismo aquí que en la tabla de cobertura.
 *
 * ATENDIDA: una marca por alerta y por DÍA (`dia_d_alertas_atendidas`), con quién y cuándo. No la apaga: baja al final de la
 * lista y se ve tenue; se puede desmarcar. Todo cambio queda en la auditoría.
 *
 * LA MESA SIN TESTIGO SIN VOTANTES (la 7) PUEDE SER MILES: sale una por mesa pero se corta en TOPE_SIN_VOTANTES filas y se dice
 * cuántas más hay. Los conteos de los chips cuentan todas.
 */
'use strict';

const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole, calcularAlcance } = require('../middleware/auth');
const { requiereVerModulo } = require('../middleware/permisoModulo');
const { registrarAuditoria } = require('../config/auditoria');
const diaD = require('./diaD.routes').compartido;
const jornada = require('../lib/jornadaDiaD');
const { estadoDeMesa, pasoElPlazoDelE14 } = require('../lib/mesasEnVivo');
const { crearResolutorDePuestos } = require('../lib/puestosDiaD');
const { calcularEstimadoPorPuesto } = require('../config/estimadoPuestos');
const { filtroAlcanceEstimado, condicionAlcanceVotantes, parametrosAlcanceVotantes } = require('../lib/alcanceVotantes');
const {
  cargarTestigos, repartirPorPuesto, armarDetallePuesto, leerLimiteDeMesas,
} = require('../lib/coberturaTestigos');

const router = express.Router();
router.use(requireAuth);

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

/* ——— configuración de la jornada (Configuración → Datos de la campaña) ——————————————— */
router.get('/config', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  const cfg = await jornada.leerJornada(pool);
  const estado = jornada.estadoDeLaJornada(cfg);
  res.json({
    hoy: estado.hoy, ahora: estado.ahora, modo_prueba: estado.modo_prueba,
    fecha_eleccion: cfg.fecha_eleccion, jornada_apertura: cfg.jornada_apertura, jornada_cierre: cfg.jornada_cierre,
    plazo_e14_min: cfg.plazo_e14_min, alerta_checkin_min: cfg.alerta_checkin_min,
    baja_votacion_pct: cfg.baja_votacion_pct, baja_votacion_desde: cfg.baja_votacion_desde,
  });
});

// Sólo el administrador de la campaña principal: es una fila única que comparten todas las ramas.
router.put('/config', requireRole('admin'), async (req, res) => {
  if (req.sublicencia) return res.status(403).json({ error: 'Los horarios de la jornada los define la campaña principal.' });
  const v = jornada.validarJornada(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const antes = await jornada.leerJornada(pool);
    await pool.query(
      `UPDATE configuracion_campana
          SET jornada_apertura = ?, jornada_cierre = ?, plazo_e14_min = ?, alerta_checkin_min = ?,
              baja_votacion_pct = ?, baja_votacion_desde = ?
        WHERE id = 1`,
      [v.valores.jornada_apertura, v.valores.jornada_cierre, v.valores.plazo_e14_min, v.valores.alerta_checkin_min,
       v.valores.baja_votacion_pct, v.valores.baja_votacion_desde]);
    const ahora = await jornada.leerJornada(pool);
    await registrarAuditoria(req.session.usuario.id, 'config_jornada_dia_d', 'configuracion_campana', 1,
      `Antes: apertura ${antes.jornada_apertura}, cierre ${antes.jornada_cierre}, E-14 ${antes.plazo_e14_min} min, `
      + `llegada ${antes.alerta_checkin_min} min, baja votación ${antes.baja_votacion_pct} % desde ${antes.baja_votacion_desde}. `
      + `Ahora: apertura ${ahora.jornada_apertura}, cierre ${ahora.jornada_cierre}, E-14 ${ahora.plazo_e14_min} min, `
      + `llegada ${ahora.alerta_checkin_min} min, baja votación ${ahora.baja_votacion_pct} % desde ${ahora.baja_votacion_desde}.`, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error('alertas/config:', err.code || err.message);
    res.status(500).json({ error: 'No se pudieron guardar los horarios de la jornada.' });
  }
});

router.use(requiereVerModulo('alertas_dia_d', { aspirante: true }), calcularAlcance);

/* ——— el cálculo ———————————————————————————————————————————————————— */
function claveAlerta(tipo, puestoId, mesa) { return `${tipo}|${puestoId || 0}|${mesa || 0}`; }

/** A partir de cuándo (hh:mm de hoy) se activa una alerta que depende de la hora. */
const desdeHoy = (ahora, minutos) => `${ahora.fecha} ${jornada.hhmm(minutos)}`;

async function calcularAlertas(req) {
  const dueno = await diaD.duenoDeLaCampana(req);
  const cfg = await jornada.leerJornada(pool);
  const ahora = jornada.ahoraColombia();
  const estado = jornada.estadoDeLaJornada(cfg, ahora);
  const resultados = require('./resultadosDiaD.routes');       // perezoso: se requieren entre sí
  const rescate = require('./rescateVotos.routes');

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
    const resumen = await rescate.resumenPorPuesto(req);
    for (const x of resumen) {
      const g = resolver({ puesto_votacion: x.puesto });
      if (!g.puesto || x.total < MIN_VOTANTES_BAJA || !(x.pct < cfg.baja_votacion_pct)) continue;
      const pct = String(x.pct).replace('.', ',');
      poner({ tipo: 'baja_votacion', puesto_id: g.puesto.id, puesto: g.puesto.nombre, mesa: null,
        detalle: `Han votado ${x.votaron} de ${x.total} (${pct} %): bajo el umbral de ${cfg.baja_votacion_pct} %.`,
        estado: bajaYaToca ? 'activa' : 'pendiente', pendiente_hasta: bajaYaToca ? null : cfg.baja_votacion_desde,
        desde: desdeHoy(ahora, cfg.baja_desde_min) });
    }
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
  return {
    jornada: {
      ...estado, apertura: cfg.jornada_apertura, cierre: cfg.jornada_cierre, plazo_e14_min: cfg.plazo_e14_min,
      alerta_checkin_min: cfg.alerta_checkin_min, baja_votacion_pct: cfg.baja_votacion_pct, baja_votacion_desde: cfg.baja_votacion_desde,
    },
    tipos: TIPOS.map(t => ({ tipo: t.tipo, nombre: t.nombre, gravedad: t.gravedad, ...conteos[t.tipo] })),
    total_activas: Object.values(conteos).reduce((n, c) => n + c.activas, 0),
    sin_votantes_omitidas: Math.max(0, sinVotantesTotal - TOPE_SIN_VOTANTES),
    alertas,
  };
}

router.get('/', async (req, res) => {
  try {
    res.json(await calcularAlertas(req));
  } catch (err) {
    console.error('alertas:', err.code || err.message);
    res.status(500).json({ error: 'No se pudieron calcular las alertas.' });
  }
});

/* ——— atendida / no atendida —————————————————————————————————————————— */
router.post('/atendida', async (req, res) => {
  const b = req.body || {};
  const tipo = String(b.tipo || '');
  if (!GRAVEDAD[tipo]) return res.status(400).json({ error: 'Tipo de alerta no válido.' });
  const puestoId = Number(b.puesto_id) || 0;
  const mesa = Number(b.mesa) || 0;
  if (mesa < 0 || !Number.isInteger(mesa)) return res.status(400).json({ error: 'Mesa no válida.' });
  const nota = String(b.nota || '').trim().slice(0, 255) || null;
  const atender = b.atendida !== false;
  try {
    const dueno = await diaD.duenoDeLaCampana(req);
    if (puestoId) {
      const [[p]] = await pool.query(`SELECT id, nombre FROM dia_d_puestos_votacion WHERE id = ? AND aspirante_id = ?`, [puestoId, dueno]);
      if (!p) return res.status(404).json({ error: 'Puesto no encontrado.' });
    }
    const ahora = jornada.ahoraColombia();
    const [[p2]] = puestoId
      ? await pool.query(`SELECT nombre FROM dia_d_puestos_votacion WHERE id = ?`, [puestoId]) : [[{ nombre: '(fuera de lista)' }]];
    const donde = `${p2 ? p2.nombre : ''}${mesa ? ', mesa ' + mesa : ''}`;
    const nombreTipo = TIPOS.find(t => t.tipo === tipo).nombre;
    if (atender) {
      const [r] = await pool.query(
        `INSERT INTO dia_d_alertas_atendidas (aspirante_id, tipo, puesto_id, mesa, fecha, atendida_por, atendida_en, nota)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE atendida_por = VALUES(atendida_por), atendida_en = VALUES(atendida_en), nota = VALUES(nota)`,
        [dueno, tipo, puestoId, mesa, ahora.fecha, req.session.usuario.id, `${ahora.texto}:00`, nota]);
      await registrarAuditoria(req.session.usuario.id, 'atender_alerta_dia_d', 'dia_d_alertas_atendidas', r.insertId || 0,
        `Marcó como atendida la alerta «${nombreTipo}» de ${donde}${nota ? '. Nota: ' + nota : ''}.`, req.ip);
    } else {
      const [r] = await pool.query(
        `DELETE FROM dia_d_alertas_atendidas WHERE aspirante_id = ? AND tipo = ? AND puesto_id = ? AND mesa = ? AND fecha = ?`,
        [dueno, tipo, puestoId, mesa, ahora.fecha]);
      if (r.affectedRows) {
        await registrarAuditoria(req.session.usuario.id, 'desatender_alerta_dia_d', 'dia_d_alertas_atendidas', 0,
          `Quitó la marca de atendida a la alerta «${nombreTipo}» de ${donde}.`, req.ip);
      }
    }
    res.json({ ok: true, atendida: atender });
  } catch (err) {
    console.error('alertas/atendida:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo cambiar la marca de la alerta.' });
  }
});

module.exports = router;
module.exports.calcularAlertas = calcularAlertas;
module.exports.TIPOS = TIPOS;
module.exports.MIN_VOTANTES_BAJA = MIN_VOTANTES_BAJA;
module.exports.TOPE_SIN_VOTANTES = TOPE_SIN_VOTANTES;
