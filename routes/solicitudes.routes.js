/**
 * SOLICITUDES CIUDADANAS: las rutas (parche 303). La regla vive en lib/solicitudes.js y el alcance en lib/alcanceSolicitudes.js.
 *
 *   GET  /categorias            las categorías (quien registra ve las activas; el administrador, todas)
 *   POST /categorias            (admin) crear · PUT /categorias/:id  (admin) renombrar, ordenar, activar o desactivar
 *   GET  /config · PUT /config  (admin) meses para anonimizar después de la elección
 *   POST /                      registrar (multipart con hasta 3 fotos, o JSON sin ellas). Idempotente por cliente_uuid
 *   GET  /                      la lista, con filtros y dentro del alcance
 *   GET  /mias                  las que registré o me asignaron (la pantalla del celular)
 *   GET  /responsables          a quién se le puede asignar
 *   GET  /:id                   el detalle, con historial (las notas internas solo las ven quienes pueden editar)
 *   GET  /:id/fotos/:fotoId     una foto, si la solicitud está dentro del alcance
 *   PUT  /:id/estado · PUT /:id/responsable · POST /:id/notas · POST /:id/anonimizar (admin)
 *
 * PERMISOS. «Ver» el módulo `solicitudes` para todo; «Agregar» para registrar; «Editar» para cambiar estado, asignar y anotar. Se
 * exigen AQUÍ, en el servidor (el administrador y el superadministrador pasan siempre). De fábrica solo el administrador. Un aspirante con
 * sublicencia no llega: la ruta no está en la lista de lo que puede alcanzar (middleware/aspirante.js).
 *
 * DATOS PERSONALES. El teléfono del ciudadano solo viaja al administrador y al responsable asignado. La respuesta de «registrar» no lo
 * devuelve. Las fotos salen únicamente por su ruta, que comprueba el alcance.
 */
'use strict';

const express = require('express');
const multer = require('multer');
const pool = require('../config/db');
const { requireAuth, calcularAlcance } = require('../middleware/auth');
const { registrarAuditoria } = require('../config/auditoria');
const { alcanceSolicitudes, asignablesPara } = require('../lib/alcanceSolicitudes');
const S = require('../lib/solicitudes');

const router = express.Router();
router.use(requireAuth, calcularAlcance);

const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: S.TAMANO_MAXIMO_FOTO, files: S.MAX_FOTOS, fields: 40 } });

/** Exige un nivel de la matriz y deja `req.permisos` listo. */
const exigir = (nivel) => async (req, res, next) => {
  const p = await S.permisosDe(req.session.usuario);
  req.permisos = p;
  if (!p.ver) return res.status(403).json({ error: 'Su tipo de usuario no tiene acceso a las solicitudes. Si lo necesita, pídaselo al administrador de la campaña.' });
  if (nivel === 'agregar' && !p.agregar) return res.status(403).json({ error: 'Su tipo de usuario puede ver las solicitudes pero no registrarlas.' });
  if (nivel === 'editar' && !p.editar) return res.status(403).json({ error: 'Su tipo de usuario puede ver las solicitudes pero no cambiarlas.' });
  next();
};
const soloAdmin = (req, res, next) => (req.session.usuario.rol === 'admin' ? next() : res.status(403).json({ error: 'Esto es solo del administrador.' }));

const responder = (res, e) => {
  if (e && e.estado) return res.status(e.estado).json({ error: e.mensaje || e.message });
  console.error('[solicitudes]', e && (e.code || e.message));
  return res.status(500).json({ error: 'No se pudo completar la operación.' });
};

/** La solicitud, SOLO si está dentro del alcance de quien pregunta. null si no existe o no es suya (el mismo 404: no se dice cuál). */
async function dentroDelAlcance(req, id) {
  const a = alcanceSolicitudes(req.alcance, 's');
  const [[fila]] = await pool.query(
    `SELECT s.*, c.nombre AS categoria, c.clave AS categoria_clave, ru.nombre AS responsable, rg.nombre AS registrada_por_nombre
       FROM solicitudes s JOIN solicitud_categorias c ON c.id = s.categoria_id
       LEFT JOIN usuarios ru ON ru.id = s.responsable_id LEFT JOIN usuarios rg ON rg.id = s.registrado_por
      WHERE s.id = ? AND ${a.sql}`, [id, ...a.valores]);
  return fila || null;
}

/* -------------------------------------------------------------------------------------------------------- CATEGORÍAS */

router.get('/categorias', exigir('ver'), async (req, res) => {
  try {
    const todas = req.session.usuario.rol === 'admin';
    const [filas] = await pool.query(
      `SELECT c.id, c.clave, c.nombre, c.ayuda, c.orden, c.activa, (SELECT COUNT(*) FROM solicitudes s WHERE s.categoria_id = c.id) AS solicitudes
         FROM solicitud_categorias c ${todas ? '' : 'WHERE c.activa = 1'} ORDER BY c.orden, c.id`);
    res.json({ categorias: filas.map((c) => ({ ...c, activa: Number(c.activa) })) });
  } catch (e) { responder(res, e); }
});

const clave = (n) => String(n).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

router.post('/categorias', exigir('editar'), soloAdmin, async (req, res) => {
  try {
    const nombre = String((req.body && req.body.nombre) || '').trim().slice(0, 80);
    if (nombre.length < 2) return res.status(400).json({ error: 'Escribe el nombre de la categoría.' });
    const k = clave(nombre);
    if (!k) return res.status(400).json({ error: 'Ese nombre no sirve para una categoría.' });
    const ayuda = String((req.body && req.body.ayuda) || '').trim().slice(0, 255) || null;
    const [[max]] = await pool.query('SELECT COALESCE(MAX(orden), 0) AS m FROM solicitud_categorias');
    const [r] = await pool.query('INSERT INTO solicitud_categorias (clave, nombre, ayuda, orden) VALUES (?,?,?,?)', [k, nombre, ayuda, Number(max.m) + 10]);
    await registrarAuditoria(req.session.usuario.id, 'solicitud_categoria_crear', 'solicitud_categorias', r.insertId, `Creó la categoría «${nombre}».`, req.ip);
    res.json({ ok: true, id: r.insertId });
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya hay una categoría con ese nombre.' });
    responder(res, e);
  }
});

router.put('/categorias/:id', exigir('editar'), soloAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[antes]] = await pool.query('SELECT * FROM solicitud_categorias WHERE id = ?', [id]);
    if (!antes) return res.status(404).json({ error: 'Esa categoría no existe.' });
    const b = req.body || {};
    const nombre = b.nombre !== undefined ? String(b.nombre).trim().slice(0, 80) : antes.nombre;
    if (nombre.length < 2) return res.status(400).json({ error: 'Escribe el nombre de la categoría.' });
    const ayuda = b.ayuda !== undefined ? (String(b.ayuda).trim().slice(0, 255) || null) : antes.ayuda;
    const orden = b.orden !== undefined && Number.isInteger(Number(b.orden)) ? Number(b.orden) : antes.orden;
    const activa = b.activa !== undefined ? (b.activa ? 1 : 0) : Number(antes.activa);
    await pool.query('UPDATE solicitud_categorias SET nombre = ?, ayuda = ?, orden = ?, activa = ? WHERE id = ?', [nombre, ayuda, orden, activa, id]);
    const cambios = [];
    if (nombre !== antes.nombre) cambios.push(`nombre: «${antes.nombre}» → «${nombre}»`);
    if (activa !== Number(antes.activa)) cambios.push(activa ? 'se activó' : 'se desactivó');
    if ((ayuda || '') !== (antes.ayuda || '')) cambios.push('cambió el texto de ayuda');
    if (orden !== antes.orden) cambios.push(`orden: ${antes.orden} → ${orden}`);
    if (cambios.length) await registrarAuditoria(req.session.usuario.id, 'solicitud_categoria_editar', 'solicitud_categorias', id, `Categoría «${antes.nombre}»: ${cambios.join('; ')}.`, req.ip);
    res.json({ ok: true });
  } catch (e) { responder(res, e); }
});

/* ----------------------------------------------------------------------------------------------------------- CONFIG */

router.get('/config', exigir('ver'), soloAdmin, async (req, res) => {
  try {
    const [[c]] = await pool.query(`SELECT anonimizar_solicitudes_meses AS meses, DATE_FORMAT(fecha_eleccion, '%Y-%m-%d') AS eleccion FROM configuracion_campana WHERE id = 1`);
    res.json({ anonimizar_meses: c ? Number(c.meses) : 6, fecha_eleccion: c ? c.eleccion : null });
  } catch (e) { responder(res, e); }
});

router.put('/config', exigir('editar'), soloAdmin, async (req, res) => {
  try {
    const n = Number(req.body && req.body.anonimizar_meses);
    if (!Number.isInteger(n) || n < 1 || n > 120) return res.status(400).json({ error: 'Los meses tienen que ser un número entero entre 1 y 120.' });
    const [[antes]] = await pool.query('SELECT anonimizar_solicitudes_meses AS meses FROM configuracion_campana WHERE id = 1');
    await pool.query('UPDATE configuracion_campana SET anonimizar_solicitudes_meses = ? WHERE id = 1', [n]);
    if (!antes || Number(antes.meses) !== n) {
      await registrarAuditoria(req.session.usuario.id, 'solicitud_config', 'configuracion_campana', 1, `Meses para anonimizar las solicitudes después de la elección: ${antes ? antes.meses : '—'} → ${n}.`, req.ip);
    }
    res.json({ ok: true, anonimizar_meses: n });
  } catch (e) { responder(res, e); }
});

/* --------------------------------------------------------------------------------------------------------- REGISTRAR */

router.post('/', exigir('agregar'), (req, res, next) => subida.array('fotos', S.MAX_FOTOS)(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: `Máximo ${S.MAX_FOTOS} fotos.` });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Una foto pesa demasiado.' });
  return res.status(400).json({ error: 'No se pudo leer lo que se envió.' });
}), async (req, res) => {
  try {
    const { errores, datos } = S.validarRegistro(req.body || {});
    if (errores.length) return res.status(400).json({ error: errores.join(' '), errores });
    const buffers = (req.files || []).map((f) => f.buffer);
    let r;
    try { r = await S.registrar({ datos, fotos: buffers, usuario: req.session.usuario }); }
    catch (e) {
      // Una foto que no es una imagen se dice como lo que es, no como un 500.
      if (e && /Input buffer|unsupported image|corrupt|bad seek|VipsJpeg|pngload|webpload|heif|Input file/i.test(String(e.message))) return res.status(400).json({ error: 'Una de las fotos no es una imagen válida.' });
      if (e && /demasiado|vacía/.test(String(e.message))) return res.status(400).json({ error: e.message });
      throw e;
    }
    if (!r.duplicado) {
      await registrarAuditoria(req.session.usuario.id, 'solicitud_registrar', 'solicitudes', r.id, `Registró una solicitud de ${r.categoria || 'una categoría'}${r.fotos ? ` con ${r.fotos} foto(s)` : ''}.`, req.ip);
    }
    // No se devuelve el teléfono ni el nombre del ciudadano: quien registra ya los tiene, y la respuesta no tiene por qué llevarlos.
    res.status(r.duplicado ? 200 : 201).json({ ok: true, id: r.id, duplicado: r.duplicado, fotos: r.fotos });
  } catch (e) { responder(res, e); }
});

/* ------------------------------------------------------------------------------------------------------------ LISTAS */

function filaPublica(f, usuario) {
  const o = {
    id: f.id, categoria_id: f.categoria_id, categoria: f.categoria, estado: f.estado, estado_etiqueta: S.ETIQUETA_ESTADO[f.estado],
    barrio: f.barrio_texto, territorio_id: f.territorio_id, responsable_id: f.responsable_id, responsable: f.responsable,
    creada_en: f.creada_en, actualizada_en: f.actualizada_en, resumen: f.resumen, fotos: Number(f.fotos || 0),
    con_ubicacion: !!Number(f.con_ubicacion), con_ciudadano: !!Number(f.con_ciudadano), anonimizada: !!f.anonimizada_en,
  };
  return o;
}

router.get('/', exigir('ver'), async (req, res) => {
  try {
    const a = alcanceSolicitudes(req.alcance, 's');
    const cond = [a.sql], par = [...a.valores];
    const q = req.query;
    if (q.categoria) { cond.push('s.categoria_id = ?'); par.push(Number(q.categoria)); }
    if (q.estado && S.ESTADOS.includes(q.estado)) { cond.push('s.estado = ?'); par.push(q.estado); }
    if (q.barrio) { cond.push('s.barrio_texto LIKE ?'); par.push(`%${String(q.barrio).replace(/[%_]/g, '').slice(0, 60)}%`); }
    if (q.responsable === 'sin') cond.push('s.responsable_id IS NULL');
    else if (q.responsable) { cond.push('s.responsable_id = ?'); par.push(Number(q.responsable)); }
    const limite = Math.min(100, Math.max(1, Number(q.limite) || 25));
    const pagina = Math.max(1, Number(q.pagina) || 1);
    const [filas] = await pool.query(
      `SELECT s.id, s.categoria_id, c.nombre AS categoria, s.estado, s.barrio_texto, s.territorio_id, s.responsable_id, ru.nombre AS responsable,
              s.creada_en, s.actualizada_en, SUBSTRING(s.descripcion, 1, 140) AS resumen, s.anonimizada_en,
              (SELECT COUNT(*) FROM solicitud_fotos f WHERE f.solicitud_id = s.id) AS fotos,
              (s.latitud IS NOT NULL) AS con_ubicacion, (s.ciudadano_nombre IS NOT NULL OR s.ciudadano_telefono IS NOT NULL) AS con_ciudadano
         FROM solicitudes s JOIN solicitud_categorias c ON c.id = s.categoria_id LEFT JOIN usuarios ru ON ru.id = s.responsable_id
        WHERE ${cond.join(' AND ')} ORDER BY s.id DESC LIMIT ? OFFSET ?`, [...par, limite, (pagina - 1) * limite]);
    const [[tot]] = await pool.query(`SELECT COUNT(*) AS n FROM solicitudes s WHERE ${cond.join(' AND ')}`, par);
    const [porEstado] = await pool.query(`SELECT s.estado, COUNT(*) AS n FROM solicitudes s WHERE ${a.sql} GROUP BY s.estado`, a.valores);
    res.json({
      solicitudes: filas.map((f) => filaPublica(f, req.session.usuario)), total: Number(tot.n), pagina, limite,
      porEstado: porEstado.reduce((o, x) => { o[x.estado] = Number(x.n); return o; }, {}), permisos: req.permisos,
    });
  } catch (e) { responder(res, e); }
});

router.get('/mias', exigir('ver'), async (req, res) => {
  try {
    const yo = req.session.usuario.id;
    const [filas] = await pool.query(
      `SELECT s.id, s.categoria_id, c.nombre AS categoria, s.estado, s.barrio_texto, s.territorio_id, s.responsable_id, ru.nombre AS responsable,
              s.creada_en, s.actualizada_en, SUBSTRING(s.descripcion, 1, 140) AS resumen, s.anonimizada_en,
              (SELECT COUNT(*) FROM solicitud_fotos f WHERE f.solicitud_id = s.id) AS fotos,
              (s.latitud IS NOT NULL) AS con_ubicacion, (s.ciudadano_nombre IS NOT NULL OR s.ciudadano_telefono IS NOT NULL) AS con_ciudadano
         FROM solicitudes s JOIN solicitud_categorias c ON c.id = s.categoria_id LEFT JOIN usuarios ru ON ru.id = s.responsable_id
        WHERE s.registrado_por = ? OR s.responsable_id = ? ORDER BY s.id DESC LIMIT 100`, [yo, yo]);
    res.json({ solicitudes: filas.map((f) => filaPublica(f, req.session.usuario)), permisos: req.permisos });
  } catch (e) { responder(res, e); }
});

router.get('/responsables', exigir('editar'), async (req, res) => {
  try {
    const as = asignablesPara(req.alcance);
    if (!as) return res.json({ responsables: [] });
    const [filas] = await pool.query(
      `SELECT u.id, u.nombre, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.activo = 1 AND r.nombre IN (?) AND ${as.sql} ORDER BY u.nombre LIMIT 500`, [S.ROLES_ASIGNABLES, ...as.valores]);
    res.json({ responsables: filas });
  } catch (e) { responder(res, e); }
});

/* ----------------------------------------------------------------------------------------------------------- DETALLE */

router.get('/:id', exigir('ver'), async (req, res) => {
  try {
    const f = await dentroDelAlcance(req, Number(req.params.id));
    if (!f) return res.status(404).json({ error: 'Esa solicitud no existe o no es de tu equipo.' });
    const u = req.session.usuario;
    const [fotos] = await pool.query('SELECT id, orden, ancho, alto FROM solicitud_fotos WHERE solicitud_id = ? ORDER BY orden', [f.id]);
    const [hist] = await pool.query(
      `SELECT h.id, h.tipo, h.estado_antes, h.estado_despues, h.responsable_antes, h.responsable_despues, h.entidad, h.nota, h.usuario_nombre, h.creado_en,
              ra.nombre AS responsable_antes_nombre, rd.nombre AS responsable_despues_nombre
         FROM solicitud_historial h LEFT JOIN usuarios ra ON ra.id = h.responsable_antes LEFT JOIN usuarios rd ON rd.id = h.responsable_despues
        WHERE h.solicitud_id = ? ORDER BY h.id`, [f.id]);
    const veNotas = req.permisos.editar;
    const telefono = S.puedeVerTelefono(u, f) ? f.ciudadano_telefono : null;
    res.json({
      id: f.id, categoria_id: f.categoria_id, categoria: f.categoria, descripcion: f.descripcion, estado: f.estado, estado_etiqueta: S.ETIQUETA_ESTADO[f.estado],
      barrio: f.barrio_texto, territorio_id: f.territorio_id, latitud: f.latitud, longitud: f.longitud, precision_m: f.precision_m,
      ciudadano: { nombre: f.ciudadano_nombre, telefono, tiene_telefono: !!f.ciudadano_telefono, autoriza_datos: !!Number(f.autoriza_datos), autoriza_fecha: f.autoriza_fecha, politica_version: f.politica_version },
      responsable_id: f.responsable_id, responsable: f.responsable, entidad_remitida: f.entidad_remitida, remitida_en: f.remitida_en, cerrada_en: f.cerrada_en, motivo_cierre: f.motivo_cierre,
      registrada_por: f.registrada_por_nombre, creada_en: f.creada_en, actualizada_en: f.actualizada_en, anonimizada_en: f.anonimizada_en,
      fotos, historial: hist.filter((h) => veNotas || h.tipo !== 'nota'),
      puede_editar: req.permisos.editar, puede_ver_telefono: S.puedeVerTelefono(u, f), puede_asignar: !!asignablesPara(req.alcance) && req.permisos.editar,
    });
  } catch (e) { responder(res, e); }
});

router.get('/:id/fotos/:fotoId', exigir('ver'), async (req, res) => {
  try {
    const f = await dentroDelAlcance(req, Number(req.params.id));
    if (!f) return res.status(404).json({ error: 'Esa solicitud no existe o no es de tu equipo.' });
    const [[foto]] = await pool.query('SELECT archivo FROM solicitud_fotos WHERE id = ? AND solicitud_id = ?', [Number(req.params.fotoId), f.id]);
    const ruta = foto && S.rutaDeFoto(foto.archivo);
    if (!ruta || !require('fs').existsSync(ruta)) return res.status(404).json({ error: 'Esa foto ya no está.' });
    res.sendFile(ruta, { headers: { 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'image/jpeg' } });
  } catch (e) { responder(res, e); }
});

/* ---------------------------------------------------------------------------------------------------------- CAMBIOS */

router.put('/:id/estado', exigir('editar'), async (req, res) => {
  try {
    const f = await dentroDelAlcance(req, Number(req.params.id));
    if (!f) return res.status(404).json({ error: 'Esa solicitud no existe o no es de tu equipo.' });
    const b = req.body || {};
    const r = await S.cambiarEstado({ id: f.id, estado: b.estado, entidad: b.entidad_remitida, nota: b.nota, usuario: req.session.usuario });
    await registrarAuditoria(req.session.usuario.id, 'solicitud_estado', 'solicitudes', f.id, `Solicitud #${f.id}: ${S.ETIQUETA_ESTADO[r.estado_antes]} → ${S.ETIQUETA_ESTADO[r.estado_despues]}.`, req.ip);
    res.json({ ok: true, estado: r.estado_despues });
  } catch (e) { responder(res, e); }
});

router.put('/:id/responsable', exigir('editar'), async (req, res) => {
  try {
    const f = await dentroDelAlcance(req, Number(req.params.id));
    if (!f) return res.status(404).json({ error: 'Esa solicitud no existe o no es de tu equipo.' });
    const r = await S.asignarResponsable({ id: f.id, responsableId: req.body ? req.body.responsable_id : null, usuario: req.session.usuario, asignables: asignablesPara(req.alcance) });
    await registrarAuditoria(req.session.usuario.id, 'solicitud_responsable', 'solicitudes', f.id, r.responsable_id ? `Solicitud #${f.id}: se asignó a la persona #${r.responsable_id}.` : `Solicitud #${f.id}: se quitó el responsable.`, req.ip);
    res.json({ ok: true, responsable_id: r.responsable_id });
  } catch (e) { responder(res, e); }
});

router.post('/:id/notas', exigir('editar'), async (req, res) => {
  try {
    const f = await dentroDelAlcance(req, Number(req.params.id));
    if (!f) return res.status(404).json({ error: 'Esa solicitud no existe o no es de tu equipo.' });
    await S.agregarNota({ id: f.id, nota: req.body && req.body.nota, usuario: req.session.usuario });
    res.json({ ok: true });
  } catch (e) { responder(res, e); }
});

router.post('/:id/anonimizar', exigir('editar'), soloAdmin, async (req, res) => {
  try {
    const f = await dentroDelAlcance(req, Number(req.params.id));
    if (!f) return res.status(404).json({ error: 'Esa solicitud no existe.' });
    const r = await S.anonimizarSolicitud(f.id, req.session.usuario);
    await registrarAuditoria(req.session.usuario.id, 'solicitud_anonimizar', 'solicitudes', f.id, `Solicitud #${f.id}: se borraron los datos del ciudadano y ${r ? r.fotos : 0} foto(s).`, req.ip);
    res.json({ ok: true, fotos: r ? r.fotos : 0 });
  } catch (e) { responder(res, e); }
});

module.exports = router;
