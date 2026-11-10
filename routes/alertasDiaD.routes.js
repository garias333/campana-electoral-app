/**
 * Cuadro de alertas del Día D — lo que la coordinación tiene que atender AHORA. Montado en /api/dia-d/alertas.
 *
 * EL GET SE CALCULA AL PEDIRLO: la pantalla de escritorio lo pide cada 30 s y la del celular cada 60, con el alcance de quien
 * pregunta. El cálculo vive en lib/alertasDiaD.js, el MISMO que usan los avisos push automáticos (lib/avisosAlertas.js).
 *
 * Los siete tipos y su orden están descritos en lib/alertasDiaD.js. Las que dependen de la hora salen «pendiente» —en gris—
 * ANTES de su hora, con la hora a la que se activan.
 *
 * ATENDIDA: una marca por alerta y por DÍA (`dia_d_alertas_atendidas`), con quién y cuándo. No la apaga: baja al final de la
 * lista y se ve tenue; se puede desmarcar. Todo cambio queda en la auditoría.
 *
 */
'use strict';

const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole, calcularAlcance } = require('../middleware/auth');
const { requiereVerModulo } = require('../middleware/permisoModulo');
const { requiereComplemento } = require('../middleware/complemento');
const { registrarAuditoria } = require('../config/auditoria');
const diaD = require('./diaD.routes').compartido;
const { TIPOS, GRAVEDAD, TOPE_SIN_VOTANTES, MIN_VOTANTES_BAJA, calcularAlertas } = require('../lib/alertasDiaD');
const jornada = require('../lib/jornadaDiaD');
const router = express.Router();
router.use(requireAuth);

/* ——— configuración de la jornada (Configuración → Datos de la campaña) ——————————————— */
router.get('/config', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  const cfg = await jornada.leerJornada(pool);
  const estado = jornada.estadoDeLaJornada(cfg);
  res.json({
    hoy: estado.hoy, ahora: estado.ahora, modo_prueba: estado.modo_prueba,
    fecha_eleccion: cfg.fecha_eleccion, jornada_apertura: cfg.jornada_apertura, jornada_cierre: cfg.jornada_cierre,
    plazo_e14_min: cfg.plazo_e14_min, alerta_checkin_min: cfg.alerta_checkin_min,
    baja_votacion_pct: cfg.baja_votacion_pct, baja_votacion_desde: cfg.baja_votacion_desde,
    transporte_alerta_desde: cfg.transporte_alerta_desde,
    avisos_alertas_push: cfg.avisos_alertas_push,
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
              baja_votacion_pct = ?, baja_votacion_desde = ?, avisos_alertas_push = ?,
              transporte_alerta_desde = COALESCE(?, transporte_alerta_desde)
        WHERE id = 1`,
      [v.valores.jornada_apertura, v.valores.jornada_cierre, v.valores.plazo_e14_min, v.valores.alerta_checkin_min,
       v.valores.baja_votacion_pct, v.valores.baja_votacion_desde, v.valores.avisos_alertas_push, v.valores.transporte_alerta_desde]);
    const ahora = await jornada.leerJornada(pool);
    await registrarAuditoria(req.session.usuario.id, 'config_jornada_dia_d', 'configuracion_campana', 1,
      `Antes: apertura ${antes.jornada_apertura}, cierre ${antes.jornada_cierre}, E-14 ${antes.plazo_e14_min} min, `
      + `llegada ${antes.alerta_checkin_min} min, baja votación ${antes.baja_votacion_pct} % desde ${antes.baja_votacion_desde}, `
      + `transporte sin recoger desde ${antes.transporte_alerta_desde}, avisos push ${antes.avisos_alertas_push ? 'encendidos' : 'apagados'}. `
      + `Ahora: apertura ${ahora.jornada_apertura}, cierre ${ahora.jornada_cierre}, E-14 ${ahora.plazo_e14_min} min, `
      + `llegada ${ahora.alerta_checkin_min} min, baja votación ${ahora.baja_votacion_pct} % desde ${ahora.baja_votacion_desde}, `
      + `transporte sin recoger desde ${ahora.transporte_alerta_desde}, avisos push ${ahora.avisos_alertas_push ? 'encendidos' : 'apagados'}.`, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error('alertas/config:', err.code || err.message);
    res.status(500).json({ error: 'No se pudieron guardar los horarios de la jornada.' });
  }
});

/* Activar complementos (parche 318): apagado para TODOS los roles, el administrador incluido. Va antes que la matriz de permisos.
   `GET` y `PUT /config` (arriba) quedan FUERA de esta puerta a propósito: son la jornada del Día D (apertura, cierre, plazo del E-14, llegada),
   que NO es solo de las alertas — la leen también Logística (lib/logisticaDiaD.js), los recordatorios de «ya votaste»
   (lib/recordatoriosFuentes.js), el check-in del testigo (routes/checkinDiaD.routes.js) y el «en vivo» de la cobertura de testigos
   (public/configuracion.html lee `modo_prueba` de aquí). Cerrarla con Alertas apagado dejaría esos horarios sin poder cambiarse. Para cerrarla
   también, basta mover esta línea antes de `router.get('/config'`. */
router.use(requiereComplemento('alertas_dia_d'), requiereVerModulo('alertas_dia_d', { aspirante: true }), calcularAlcance);

/* ——— los avisos push: diagnóstico ——————————————————————————————————————
   «N coordinadores sin avisos activados»: quienes TIENEN el módulo y NO tienen ningún dispositivo suscrito, de ESTA campaña.
   Se da el nombre y el teléfono para que la coordinación les pida activarlos. */
router.get('/avisos', async (req, res) => {
  try {
    const avisos = require('../lib/avisosAlertas');
    const dueno = await diaD.duenoDeLaCampana(req);
    const todos = await avisos.destinatarios(pool);
    const deEsta = [];
    for (const u of todos) { if ((await avisos.duenoDe(u, pool)) === dueno) deEsta.push(u); }
    const sin = deEsta.filter(u => u.dispositivos === 0);
    const cfg = await jornada.leerJornada(pool);
    res.json({
      avisos_activos: cfg.avisos_alertas_push, total: deEsta.length, con_avisos: deEsta.length - sin.length,
      sin_avisos: sin.map(u => ({ nombre: u.nombre, telefono: u.telefono || '', rol: u.rol })),
    });
  } catch (err) {
    console.error('alertas/avisos:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo consultar quién tiene los avisos activados.' });
  }
});

/* Para la franja de app/inicio.html: ¿esta persona ya tiene algún dispositivo suscrito? (Esta ruta sólo responde a quien
   tiene el módulo; para el resto es 403 y la franja no se ofrece.) */
router.get('/mis-avisos', async (req, res) => {
  try {
    const [[f]] = await pool.query(`SELECT COUNT(*) AS n FROM push_suscripciones WHERE usuario_id = ?`, [req.session.usuario.id]);
    const cfg = await jornada.leerJornada(pool);
    res.json({ suscrito: Number(f.n) > 0, avisos_activos: cfg.avisos_alertas_push });
  } catch (err) {
    console.error('alertas/mis-avisos:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo consultar tus avisos.' });
  }
});

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
