/**
 * RECORDATORIOS AUTOMÁTICOS — las rutas de la pantalla del administrador (Configuración → Recordatorios). Fase 4.
 *
 * El motor y todas las reglas viven en lib/recordatorios.js; esto solo lo expone:
 *   GET  /estado                 configuración, tope de hoy, libro central, tipos
 *   PUT  /config                 interruptor, fecha permitida, tope de SMS, silencio
 *   GET  /reglas                 las reglas, con su cuenta de envíos
 *   PUT  /reglas/:id             editar nombre, plantilla, asunto y cuándo toca
 *   POST /reglas/:id/activar     { activo: true|false }
 *   POST /validar                { tipo, canal, plantilla, asunto } → errores, avisos y segmentos (validador en vivo)
 *   POST /reglas/:id/probar      «Enviarme una prueba»: a quien la pide, sin contar en el tope
 *   GET  /envios                 historial con filtros por estado, motivo y regla
 *
 * PERMISOS. «Ver» el módulo `recordatorios` (solo el administrador de fábrica) para todo; para ESCRIBIR, además «Editar»: la
 * matriz lo ofrece, y aquí sí se aplica en el servidor (el administrador y el superadministrador pasan siempre).
 *
 * AUDITORÍA. Todo cambio de configuración o de una regla —y cada prueba— deja su apunte (config/auditoria.js), con lo que había y
 * lo que quedó. La plantilla se registra completa: es texto de la campaña, no un dato de nadie.
 */
'use strict';

const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { requiereVerModulo } = require('../middleware/permisoModulo');
const { registrarAuditoria } = require('../config/auditoria');
const R = require('../lib/recordatorios');

const router = express.Router();
router.use(requireAuth, requiereVerModulo('recordatorios'));

/** Escribir exige «Editar» en la matriz (el administrador y el superadministrador pasan siempre). Falla cerrado. */
async function requiereEditar(req, res, next) {
  const usuario = req.session && req.session.usuario;
  if (!usuario) return res.status(401).json({ error: 'Debes iniciar sesión para continuar.' });
  try {
    if (usuario.rol === 'admin') return next();
    const [[u]] = await pool.query('SELECT es_superadmin FROM usuarios WHERE id = ?', [usuario.id]);
    if (u && Number(u.es_superadmin) === 1) return next();
    const [filas] = await pool.query('SELECT editar FROM permisos_rol WHERE rol = ? AND modulo = ? LIMIT 1', [usuario.rol, 'recordatorios']);
    if (filas.length && Number(filas[0].editar) === 1) return next();
    return res.status(403).json({ error: 'Tu tipo de usuario puede ver los recordatorios pero no cambiarlos. Pídeselo al administrador de la campaña.' });
  } catch (err) {
    console.error('[editar recordatorios] No se pudo comprobar el permiso:', err.code || err.message);
    return res.status(403).json({ error: 'No se pudo comprobar su permiso, y por seguridad se negó. Vuelve a intentarlo.' });
  }
}

const errorDe = (res, err, estado = 400) => {
  if (err && err.errores) return res.status(estado).json({ error: err.errores.join(' '), errores: err.errores });
  console.error('Recordatorios:', err && (err.code || err.message));
  return res.status(500).json({ error: 'No se pudo completar la operación.' });
};

/** «clave: antes → después» solo de lo que cambió, para el apunte de auditoría. */
function diferencias(antes, despues, claves) {
  return claves.filter((k) => String(antes[k] === null || antes[k] === undefined ? '' : antes[k]) !== String(despues[k] === null || despues[k] === undefined ? '' : despues[k]))
    .map((k) => `${k}: «${antes[k] === null || antes[k] === undefined ? '' : antes[k]}» → «${despues[k] === null || despues[k] === undefined ? '' : despues[k]}»`);
}

router.get('/estado', async (req, res) => {
  try { res.json(await R.estado()); } catch (err) { errorDe(res, err); }
});

router.put('/config', requiereEditar, async (req, res) => {
  try {
    const cuerpo = req.body || {};
    const r = await R.guardarConfig({
      recordatorios_activos: cuerpo.recordatorios_activos, fecha_permitida_propaganda: cuerpo.fecha_permitida_propaganda,
      tope_diario_sms_automaticos: cuerpo.tope_diario_sms_automaticos, silencio_inicio: cuerpo.silencio_inicio, silencio_fin: cuerpo.silencio_fin,
    });
    const claves = ['recordatorios_activos', 'fecha_permitida_propaganda', 'tope_diario_sms_automaticos', 'silencio_inicio', 'silencio_fin'];
    const norm = (c) => ({ ...c, fecha_permitida_propaganda: c.fecha_permitida_propaganda ? String(c.fecha_permitida_propaganda).slice(0, 10) : '', silencio_inicio: String(c.silencio_inicio).slice(0, 5), silencio_fin: String(c.silencio_fin).slice(0, 5) });
    const cambios = diferencias(norm(r.antes), norm(r.despues), claves);
    if (cambios.length || r.reglasApagadas) {
      await registrarAuditoria(req.session.usuario.id, 'recordatorios_configuracion', 'configuracion_campana', 1,
        `Cambió la configuración de los recordatorios: ${cambios.join('; ') || 'sin cambios de valor'}.${r.reglasApagadas ? ` Se apagaron ${r.reglasApagadas} regla(s) que exigen la fecha permitida.` : ''}`, req.ip);
    }
    res.json({ ok: true, reglasApagadas: r.reglasApagadas, estado: await R.estado() });
  } catch (err) { errorDe(res, err); }
});

router.get('/reglas', async (req, res) => {
  try { res.json({ reglas: await R.listarReglas() }); } catch (err) { errorDe(res, err); }
});

router.put('/reglas/:id', requiereEditar, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[antes]] = await pool.query('SELECT * FROM recordatorio_reglas WHERE id = ?', [id]);
    if (!antes) return res.status(404).json({ error: 'Esa regla no existe.' });
    const b = req.body || {};
    await R.guardarRegla({ id, nombre: b.nombre, plantilla: b.plantilla, asunto: b.asunto, desfase_min: b.desfase_min, hora_dia: b.hora_dia, gracia_min: b.gracia_min }, req.session.usuario.id);
    const [[despues]] = await pool.query('SELECT * FROM recordatorio_reglas WHERE id = ?', [id]);
    const cambios = diferencias(antes, despues, ['nombre', 'plantilla', 'asunto', 'desfase_min', 'hora_dia', 'gracia_min']);
    await registrarAuditoria(req.session.usuario.id, 'recordatorios_regla_editar', 'recordatorio_reglas', id,
      `Editó la regla «${despues.nombre}»: ${cambios.join('; ') || 'sin cambios de valor'}.`, req.ip);
    res.json({ ok: true, regla: (await R.listarReglas()).find((r) => r.id === id) });
  } catch (err) { errorDe(res, err); }
});

router.post('/reglas/:id/activar', requiereEditar, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const activo = !!(req.body && req.body.activo);
    const r = await R.activarRegla(id, activo);
    const [[regla]] = await pool.query('SELECT nombre FROM recordatorio_reglas WHERE id = ?', [id]);
    if (r.antes !== r.activo) {
      await registrarAuditoria(req.session.usuario.id, activo ? 'recordatorios_regla_activar' : 'recordatorios_regla_apagar', 'recordatorio_reglas', id,
        `${activo ? 'Activó' : 'Apagó'} la regla «${regla.nombre}».`, req.ip);
    }
    res.json({ ok: true, activo: r.activo });
  } catch (err) { errorDe(res, err); }
});

router.post('/validar', async (req, res) => {
  try {
    const b = req.body || {};
    const cfg = await R.estado();
    const [[cf]] = await pool.query('SELECT nombre_candidato, slogan_campana, cargo_aspira, fecha_permitida_propaganda FROM configuracion_campana WHERE id = 1');
    const regla = b.regla_id ? (await R.listarReglas()).find((r) => r.id === Number(b.regla_id)) : null;
    const def = { tipo: b.tipo || (regla && regla.tipo), canal: b.canal || (regla && regla.canal), plantilla: b.plantilla, asunto: b.asunto, activo: regla ? regla.activo : 0 };
    const v = R.validarPlantilla(def, { cfg: cf || {}, sms: await R.deps.configSms(), ahora: R.deps.reloj() });
    res.json({ ok: v.ok, errores: v.errores, avisos: v.avisos, segmentos: v.segmentos, caracteres: v.caracteres, bajaCaracteres: v.bajaCaracteres, recortables: v.recortables, propagandaPermitida: cfg.propagandaPermitida });
  } catch (err) { errorDe(res, err); }
});

router.post('/reglas/:id/probar', requiereEditar, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const r = await R.enviarPrueba({ reglaId: id, usuarioId: req.session.usuario.id });
    await registrarAuditoria(req.session.usuario.id, 'recordatorios_prueba', 'recordatorio_reglas', id,
      `Pidió una prueba de la regla #${id} por ${r.canal} (${r.destino}).`, req.ip);
    res.json({ ok: true, canal: r.canal, destino: r.destino, texto: r.texto });
  } catch (err) {
    // Un rechazo del proveedor (fuera de franja, sin crédito…) se dice tal cual: es justo lo que quien prueba quiere saber.
    if (err && !err.errores && err.message) return res.status(502).json({ error: String(err.message).slice(0, 250) });
    errorDe(res, err);
  }
});

router.get('/envios', async (req, res) => {
  try {
    res.json(await R.historial({ estado: req.query.estado, motivo: req.query.motivo, regla: req.query.regla, limite: req.query.limite, pagina: req.query.pagina }));
  } catch (err) { errorDe(res, err); }
});

module.exports = router;
