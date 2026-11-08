/**
 * TAREAS: las rutas (parche 305). La regla vive en lib/tareas.js, el alcance en lib/alcanceTareas.js y los avisos en lib/tareasAvisos.js.
 *
 *   GET  /zonas?q=              barrios, veredas, comunas y corregimientos de la campaña (para el formulario); `hay: false` = escribir a mano
 *   GET  /responsables          a quién se le puede asignar (el administrador, a todos; el coordinador, a su rama; el líder, a sí mismo y a sus sublíderes)
 *   GET  /                      la lista, con filtros y dentro del alcance
 *   GET  /mias                  las que tengo asignadas (la pantalla del celular)
 *   GET  /resumen               mis cifras: pendientes, vencen hoy, vencidas (la tarjeta del panel)
 *   POST /                      crear y asignar (multipart no: JSON)
 *   POST /accion                lo que hace el ASIGNADO: empecé, terminé (con evidencia y hasta 3 fotos) o no pude. Idempotente por cliente_uuid
 *   GET  /:id                   el detalle, con historial
 *   GET  /:id/fotos/:fotoId     una foto de la evidencia, si la tarea está dentro del alcance
 *   PUT  /:id                   editar y/o reasignar · POST /:id/verificar · /:id/devolver · /:id/cancelar   (quien gestiona)
 *
 * PERMISOS. «Ver» el módulo `tareas` para todo y para ejecutar lo propio; «Agregar» para crear y asignar; «Editar» para editar, reasignar,
 * cancelar, verificar y devolver. Se exigen AQUÍ, en el servidor (el administrador y el superadministrador pasan siempre). De fábrica solo el
 * administrador. Un aspirante con sublicencia no llega: la ruta no está en la lista de lo que puede alcanzar (middleware/aspirante.js).
 *
 * DATOS. Una tarea habla de una zona y de un equipo: ni nombres ni teléfonos de ciudadanos. La posición exacta de «terminé» solo la ven quien
 * gestiona la tarea y el asignado; los demás, dentro del alcance, ven que la hay. Las fotos salen únicamente por su ruta, que comprueba el alcance.
 */
'use strict';

const express = require('express');
const multer = require('multer');
const pool = require('../config/db');
const { requireAuth, calcularAlcance } = require('../middleware/auth');
const { registrarAuditoria } = require('../config/auditoria');
const { alcanceTareas, gestionTareas, asignablesPara } = require('../lib/alcanceTareas');
const T = require('../lib/tareas');
const Avisos = require('../lib/tareasAvisos');

const router = express.Router();
router.use(requireAuth, calcularAlcance);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: T.TAMANO_MAXIMO_FOTO, files: T.MAX_FOTOS, fields: 30 } });

/** Exige un nivel de la matriz y deja `req.permisos` listo. */
const exigir = (nivel) => async (req, res, next) => {
  const p = await T.permisosDe(req.session.usuario);
  req.permisos = p;
  if (!p.ver) return res.status(403).json({ error: 'Su tipo de usuario no tiene acceso a las tareas. Si lo necesita, pídaselo al administrador de la campaña.' });
  if (nivel === 'agregar' && !p.agregar) return res.status(403).json({ error: 'Su tipo de usuario puede ver las tareas pero no crearlas.' });
  if (nivel === 'editar' && !p.editar) return res.status(403).json({ error: 'Su tipo de usuario puede ver las tareas pero no cambiarlas.' });
  next();
};

const responder = (res, e) => {
  if (e && e.estado) return res.status(e.estado).json({ error: e.mensaje || e.message });
  console.error('[tareas]', e && (e.code || e.message));
  return res.status(500).json({ error: 'No se pudo completar la operación.' });
};

/** La tarea, SOLO si está dentro del alcance de quien pregunta. null si no existe o no es suya (el mismo 404: no se dice cuál). */
async function dentroDelAlcance(req, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  const a = alcanceTareas(req.alcance, 't');
  const [[fila]] = await pool.query(`SELECT ${T.COLUMNAS} ${T.UNIONES} WHERE t.id = ? AND ${a.sql}`, [n, ...a.valores]);
  return fila || null;
}

/** ¿Gestiona quien pregunta esta tarea? (más estrecho que verla; y nadie gestiona lo que le asignaron a él, salvo el administrador) */
async function puedeGestionar(req, t) {
  const u = req.session.usuario;
  if (!req.permisos || !req.permisos.editar) return false;
  if (u.rol !== 'admin' && Number(t.asignada_a) === Number(u.id) && Number(t.creada_por) !== Number(u.id)) return false;
  const g = gestionTareas(req.alcance, 't');
  const [[x]] = await pool.query(`SELECT 1 AS ok FROM tareas t WHERE t.id = ? AND ${g.sql}`, [t.id, ...g.valores]);
  return !!x;
}

/* ------------------------------------------------------------------------------------------------------------- APOYOS */

router.get('/zonas', exigir('ver'), async (req, res) => {
  try { res.json(await T.buscarZonas(req.query.q)); } catch (e) { responder(res, e); }
});

router.get('/responsables', exigir('agregar'), async (req, res) => {
  try {
    const as = asignablesPara(req.alcance);
    if (!as) return res.json({ responsables: [] });
    const [filas] = await pool.query(
      `SELECT u.id, u.nombre, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.activo = 1 AND r.nombre IN (?) AND ${as.sql} ORDER BY (u.id = ?) DESC, u.nombre LIMIT 500`, [T.ROLES_ASIGNABLES, ...as.valores, req.session.usuario.id]);
    // Solo de SU campaña: quien cuelga de un aspirante es de otra rama y asignarle desde aquí se rechaza (T.crear); no se ofrece.
    res.json({ responsables: await T.soloMismaRama(req.session.usuario.id, filas) });
  } catch (e) { responder(res, e); }
});

router.get('/resumen', exigir('ver'), async (req, res) => {
  try { res.json(await T.resumenMisTareas(req.session.usuario.id)); } catch (e) { responder(res, e); }
});

/* ------------------------------------------------------------------------------------------------------------- LISTAS */

router.get('/', exigir('ver'), async (req, res) => {
  try {
    const a = alcanceTareas(req.alcance, 't');
    const cond = [a.sql], par = [...a.valores];
    const q = req.query;
    if (q.estado && T.ESTADOS.includes(q.estado)) { cond.push('t.estado = ?'); par.push(q.estado); }
    if (q.tipo && T.TIPOS[q.tipo]) { cond.push('t.tipo = ?'); par.push(q.tipo); }
    if (q.asignada_a) { cond.push('t.asignada_a = ?'); par.push(Number(q.asignada_a)); }
    if (q.vencidas === '1') cond.push(`t.estado IN ('pendiente','en_curso') AND t.fecha_limite IS NOT NULL AND t.fecha_limite < CURDATE()`);
    if (q.sin_responsable === '1') cond.push(`t.estado IN ('pendiente','en_curso','hecha') AND (ua.id IS NULL OR ua.activo = 0)`);
    if (q.zona) { cond.push('COALESCE(t.zona_texto, tz.nombre) LIKE ?'); par.push(`%${String(q.zona).replace(/[%_]/g, '').slice(0, 60)}%`); }
    if (q.texto) { cond.push('t.titulo LIKE ?'); par.push(`%${String(q.texto).replace(/[%_]/g, '').slice(0, 60)}%`); }
    const limite = Math.min(100, Math.max(1, Number(q.limite) || 25));
    const pagina = Math.max(1, Number(q.pagina) || 1);
    const donde = cond.join(' AND ');
    const [filas] = await pool.query(
      `SELECT ${T.COLUMNAS} ${T.UNIONES} WHERE ${donde}
        ORDER BY FIELD(t.estado, 'hecha','en_curso','pendiente','verificada','cancelada'), (t.fecha_limite IS NULL), t.fecha_limite, t.id DESC LIMIT ? OFFSET ?`,
      [...par, limite, (pagina - 1) * limite]);
    const [[tot]] = await pool.query(`SELECT COUNT(*) AS n FROM tareas t LEFT JOIN territorios tz ON tz.id = t.territorio_id LEFT JOIN usuarios ua ON ua.id = t.asignada_a WHERE ${donde}`, par);
    const [porEstado] = await pool.query(`SELECT t.estado, COUNT(*) AS n FROM tareas t WHERE ${a.sql} GROUP BY t.estado`, a.valores);
    const [[extra]] = await pool.query(
      `SELECT COALESCE(SUM(t.estado IN ('pendiente','en_curso') AND t.fecha_limite IS NOT NULL AND t.fecha_limite < CURDATE()), 0) AS vencidas,
              COALESCE(SUM(t.estado IN ('pendiente','en_curso','hecha') AND (ua.id IS NULL OR ua.activo = 0)), 0) AS sin_responsable
         FROM tareas t LEFT JOIN usuarios ua ON ua.id = t.asignada_a WHERE ${a.sql}`, a.valores);
    res.json({
      tareas: filas.map(T.filaPublica), total: Number(tot.n), pagina, limite,
      porEstado: porEstado.reduce((o, x) => { o[x.estado] = Number(x.n); return o; }, {}),
      vencidas: Number(extra.vencidas), sin_responsable: Number(extra.sin_responsable), permisos: req.permisos,
      puede_asignar: !!asignablesPara(req.alcance) && req.permisos.agregar,
    });
  } catch (e) { responder(res, e); }
});

router.get('/mias', exigir('ver'), async (req, res) => {
  try {
    const [filas] = await pool.query(
      `SELECT ${T.COLUMNAS} ${T.UNIONES}
        WHERE t.asignada_a = ? AND (t.estado IN ('pendiente','en_curso','hecha') OR (t.estado IN ('verificada','cancelada') AND t.actualizada_en >= DATE_SUB(NOW(), INTERVAL 30 DAY)))
        ORDER BY FIELD(t.estado, 'en_curso','pendiente','hecha','verificada','cancelada'), (t.fecha_limite IS NULL), t.fecha_limite, t.id DESC LIMIT 100`, [req.session.usuario.id]);
    // Para el asignado: lo que necesita para hacerla (descripción, lo que le devolvieron, su último «no pude») además de la fila corta.
    res.json({
      tareas: filas.map((f) => ({
        ...T.filaPublica(f), descripcion: f.descripcion || null, cantidad_prevista: f.cantidad_prevista, devuelta_nota: f.estado === 'en_curso' ? f.devuelta_nota : null,
        no_pudo_nota: ['pendiente', 'en_curso'].includes(f.estado) ? f.no_pudo_nota : null, motivo_cancelacion: f.estado === 'cancelada' ? f.motivo_cancelacion : null,
        cantidad_entregada: f.cantidad_entregada,
      })),
      resumen: await T.resumenMisTareas(req.session.usuario.id), permisos: req.permisos,
    });
  } catch (e) { responder(res, e); }
});

/* ---------------------------------------------------------------------------------------------------------------- CREAR */

router.post('/', exigir('agregar'), express.json(), async (req, res) => {
  try {
    const b = req.body || {};
    const { errores, datos } = T.validarTarea(b, { hoyTexto: await T.hoy() });
    if (errores.length) return res.status(400).json({ error: errores.join(' '), errores });
    const u = req.session.usuario;
    const r = await T.crear({ datos, asignadaA: b.asignada_a, usuario: u, asignables: asignablesPara(req.alcance) });
    await registrarAuditoria(u.id, 'tarea_crear', 'tareas', r.id, `Creó una tarea de ${T.TIPOS[datos.tipo].corta} y la asignó a la persona #${r.asignado.id}.`, req.ip);
    const aviso = await Avisos.avisar('asignada', { tipo: datos.tipo, zona_texto: datos.zona_texto || null }, r.asignado.id, u);
    const respuesta = { ok: true, id: r.id, aviso_enviado: aviso.enviado };
    if (aviso.motivo === 'sin_acceso') respuesta.aviso = 'Esa persona no tiene acceso al módulo de tareas: no verá la tarea ni le llegará el aviso. Dale el permiso en Asignación de permisos.';
    res.status(201).json(respuesta);
  } catch (e) { responder(res, e); }
});

/* ------------------------------------------------------------------------------------------- LO QUE HACE EL ASIGNADO */

router.post('/accion', exigir('ver'), (req, res, next) => subida.array('fotos', T.MAX_FOTOS)(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: `Máximo ${T.MAX_FOTOS} fotos.` });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Una foto pesa demasiado.' });
  return res.status(400).json({ error: 'No se pudo leer lo que se envió.' });
}), async (req, res) => {
  try {
    const b = req.body || {};
    let r;
    try { r = await T.ejecutar({ tareaId: b.tarea_id, accion: String(b.accion || ''), usuario: req.session.usuario, b, fotos: (req.files || []).map((f) => f.buffer) }); }
    catch (e) {
      if (e && /Input buffer|unsupported image|corrupt|bad seek|VipsJpeg|pngload|webpload|heif|Input file/i.test(String(e.message))) return res.status(400).json({ error: 'Una de las fotos no es una imagen válida.' });
      if (e && /demasiado|vacía/.test(String(e.message))) return res.status(400).json({ error: e.message });
      throw e;
    }
    res.status(r.duplicado ? 200 : 201).json({ ok: true, id: r.id, estado: r.estado, duplicado: r.duplicado, fotos: r.fotos || 0 });
  } catch (e) { responder(res, e); }
});

/* ------------------------------------------------------------------------------------------------------------ DETALLE */

router.get('/:id', exigir('ver'), async (req, res) => {
  try {
    const f = await dentroDelAlcance(req, req.params.id);
    if (!f) return res.status(404).json({ error: 'Esa tarea no existe o no es de tu equipo.' });
    const u = req.session.usuario;
    const gestiona = await puedeGestionar(req, f);
    const esAsignado = Number(f.asignada_a) === Number(u.id);
    const [fotos] = await pool.query('SELECT id, orden, ancho, alto FROM tarea_fotos WHERE tarea_id = ? ORDER BY orden', [f.id]);
    const [hist] = await pool.query(
      `SELECT h.id, h.tipo, h.estado_antes, h.estado_despues, h.nota, h.usuario_nombre, h.creado_en, ra.nombre AS asignada_antes_nombre, rd.nombre AS asignada_despues_nombre
         FROM tarea_historial h LEFT JOIN usuarios ra ON ra.id = h.asignada_antes LEFT JOIN usuarios rd ON rd.id = h.asignada_despues
        WHERE h.tarea_id = ? ORDER BY h.id`, [f.id]);
    const verPosicion = gestiona || esAsignado;
    res.json({
      ...T.filaPublica(f), descripcion: f.descripcion, cantidad_prevista: f.cantidad_prevista, cantidad_entregada: f.cantidad_entregada, hecha_nota: f.hecha_nota,
      iniciada_en: f.iniciada_en, verificada_en: f.verificada_en, cancelada_en: f.cancelada_en, motivo_cancelacion: f.motivo_cancelacion,
      devuelta_nota: f.devuelta_nota, no_pudo_en: f.no_pudo_en, no_pudo_nota: f.no_pudo_nota,
      ubicacion: verPosicion && f.latitud !== null ? { latitud: Number(f.latitud), longitud: Number(f.longitud), precision_m: f.precision_m } : null,
      fotos: fotos.map((x) => ({ id: x.id, orden: x.orden })), historial: hist,
      puede_gestionar: gestiona, puede_ejecutar: esAsignado && T.ABIERTAS.includes(f.estado),
      puede_asignar: gestiona && !!asignablesPara(req.alcance) && req.permisos.agregar,
    });
  } catch (e) { responder(res, e); }
});

router.get('/:id/fotos/:fotoId', exigir('ver'), async (req, res) => {
  try {
    const f = await dentroDelAlcance(req, req.params.id);
    if (!f) return res.status(404).json({ error: 'Esa tarea no existe o no es de tu equipo.' });
    const [[foto]] = await pool.query('SELECT archivo FROM tarea_fotos WHERE id = ? AND tarea_id = ?', [Number(req.params.fotoId), f.id]);
    const ruta = foto && T.rutaDeFoto(foto.archivo);
    if (!ruta || !require('fs').existsSync(ruta)) return res.status(404).json({ error: 'Esa foto ya no está.' });
    res.sendFile(ruta, { headers: { 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'image/jpeg' } });
  } catch (e) { responder(res, e); }
});

/* ------------------------------------------------------------------------------------------------- LO QUE HACE QUIEN GESTIONA */

router.put('/:id', exigir('editar'), express.json(), async (req, res) => {
  try {
    const u = req.session.usuario;
    const r = await T.editar({ id: req.params.id, b: req.body || {}, usuario: u, gestion: gestionTareas(req.alcance, 't'), asignables: asignablesPara(req.alcance) });
    if (r.reasignada || r.cambios.length) {
      await registrarAuditoria(u.id, r.reasignada ? 'tarea_reasignar' : 'tarea_editar', 'tareas', r.t.id,
        r.reasignada ? `Tarea #${r.t.id}: se reasignó a la persona #${r.asignado.id}.` : `Tarea #${r.t.id}: cambió ${r.cambios.join(', ')}.`, req.ip);
    }
    const respuesta = { ok: true, reasignada: r.reasignada };
    if (r.reasignada) {
      const aviso = await Avisos.avisar('reasignada', r.t, r.asignado.id, u);
      respuesta.aviso_enviado = aviso.enviado;
      if (aviso.motivo === 'sin_acceso') respuesta.aviso = 'Esa persona no tiene acceso al módulo de tareas: no verá la tarea ni le llegará el aviso. Dale el permiso en Asignación de permisos.';
    }
    res.json(respuesta);
  } catch (e) { responder(res, e); }
});

for (const [accion, evento] of [['verificar', 'verificada'], ['devolver', 'devuelta'], ['cancelar', null]]) {
  router.post(`/:id/${accion}`, exigir('editar'), express.json(), async (req, res) => {
    try {
      const u = req.session.usuario;
      const { t } = await T.resolver({ id: req.params.id, accion, nota: req.body && req.body.nota, usuario: u, gestion: gestionTareas(req.alcance, 't') });
      await registrarAuditoria(u.id, `tarea_${accion}`, 'tareas', t.id, `Tarea #${t.id}: ${accion === 'verificar' ? 'verificada' : (accion === 'devolver' ? 'devuelta a su responsable' : 'cancelada')}.`, req.ip);
      let aviso = { enviado: false };
      if (evento) aviso = await Avisos.avisar(evento, t, t.asignada_a, u);
      res.json({ ok: true, aviso_enviado: aviso.enviado });
    } catch (e) { responder(res, e); }
  });
}

module.exports = router;
