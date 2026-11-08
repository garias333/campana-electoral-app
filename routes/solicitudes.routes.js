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
 *   GET  /panel                 conteos por categoría, barrio y estado, y tiempos promedio (con el mismo alcance que la lista)
 *   GET  /mapa                  círculos por zona: solo el centro de la celda, la cuenta y las categorías (nada de personas)
 *   GET  /exportar/diagnostico  Excel agregado categoría × barrio × estado, SIN datos personales (quien tenga «Importar / Exportar»)
 *   GET  /exportar/detalle      Excel por solicitud, con teléfono enmascarado: SOLO el administrador, y queda en la auditoría
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
const Panel = require('../lib/solicitudesPanel');
const Seg = require('../lib/solicitudesSeguimiento');
const XLSX = require('xlsx');
const { requiereImportarExportar } = require('../middleware/permisoModulo');

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
    res.json({ anonimizar_meses: c ? Number(c.meses) : 6, fecha_eleccion: c ? c.eleccion : null, dias_sin_movimiento: await Seg.diasSinMovimiento() });
  } catch (e) { responder(res, e); }
});

router.put('/config', exigir('editar'), soloAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const cambios = [];
    const sets = [], valores = [];
    if (b.anonimizar_meses !== undefined) {
      const n = Number(b.anonimizar_meses);
      if (!Number.isInteger(n) || n < 1 || n > 120) return res.status(400).json({ error: 'Los meses tienen que ser un número entero entre 1 y 120.' });
      const [[antes]] = await pool.query('SELECT anonimizar_solicitudes_meses AS meses FROM configuracion_campana WHERE id = 1');
      sets.push('anonimizar_solicitudes_meses = ?'); valores.push(n);
      if (!antes || Number(antes.meses) !== n) cambios.push(`Meses para anonimizar las solicitudes después de la elección: ${antes ? antes.meses : '—'} → ${n}.`);
    }
    if (b.dias_sin_movimiento !== undefined) {
      const d = Number(b.dias_sin_movimiento);
      if (!Number.isInteger(d) || d < 1 || d > 365) return res.status(400).json({ error: 'Los días sin movimiento tienen que ser un número entero entre 1 y 365.' });
      const antes = await Seg.diasSinMovimiento();
      sets.push('solicitud_dias_sin_movimiento = ?'); valores.push(d);
      if (antes !== d) cambios.push(`Días sin movimiento para avisar al responsable de una solicitud: ${antes} → ${d}.`);
    }
    if (!sets.length) return res.status(400).json({ error: 'No llegó nada que guardar.' });
    await pool.query(`UPDATE configuracion_campana SET ${sets.join(', ')} WHERE id = 1`, valores);
    for (const c of cambios) await registrarAuditoria(req.session.usuario.id, 'solicitud_config', 'configuracion_campana', 1, c, req.ip);
    res.json({ ok: true, anonimizar_meses: b.anonimizar_meses !== undefined ? Number(b.anonimizar_meses) : undefined, dias_sin_movimiento: await Seg.diasSinMovimiento() });
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

/* ------------------------------------------------------------------------------------------ PANEL, MAPA Y EXPORTACIÓN */

const filtrosDe = (q) => ({ desde: q.desde, hasta: q.hasta, categoria: q.categoria, estado: q.estado });

router.get('/panel', exigir('ver'), async (req, res) => {
  try { res.json(await Panel.panel(req.alcance, filtrosDe(req.query))); } catch (e) { responder(res, e); }
});

router.get('/mapa', exigir('ver'), async (req, res) => {
  try { res.json(await Panel.mapa(req.alcance, filtrosDe(req.query))); } catch (e) { responder(res, e); }
});

const ETIQUETAS_ESTADO = ['Registrada', 'En revisión', 'Remitida', 'Cerrada'];
const hoyArchivo = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);   // hora de Colombia
const enviarLibro = (res, libro, nombre) => {
  const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(buffer);
};
const textoFiltros = (f) => [f.desde ? `desde ${f.desde}` : null, f.hasta ? `hasta ${f.hasta}` : null, f.categoria ? `categoría ${Number(f.categoria)}` : null, f.estado ? `estado ${f.estado}` : null].filter(Boolean).join(', ') || 'sin filtros';

/** «Diagnóstico de necesidades del territorio»: agregado, sin una sola persona. */
router.get('/exportar/diagnostico', exigir('ver'), requiereImportarExportar('solicitudes'), async (req, res) => {
  try {
    const f = filtrosDe(req.query);
    const filas = await Panel.diagnostico(req.alcance, f);
    const resumen = await Panel.panel(req.alcance, f);
    const hojaDiag = XLSX.utils.aoa_to_sheet([
      ['Categoría', 'Barrio o vereda', ...ETIQUETAS_ESTADO, 'Total'],
      ...filas.map((x) => [x.categoria, x.barrio, x.registrada, x.en_revision, x.remitida, x.cerrada, x.total]),
    ]);
    hojaDiag['!cols'] = [{ wch: 22 }, { wch: 34 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }];
    const hojaCat = XLSX.utils.aoa_to_sheet([
      ['Categoría', ...ETIQUETAS_ESTADO, 'Total'],
      ...resumen.porCategoria.map((x) => [x.nombre, x.registrada, x.en_revision, x.remitida, x.cerrada, x.total]),
      ['Todas', resumen.porEstado.registrada, resumen.porEstado.en_revision, resumen.porEstado.remitida, resumen.porEstado.cerrada, resumen.total],
    ]);
    hojaCat['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }];
    const t = resumen.tiempos;
    const hojaNota = XLSX.utils.aoa_to_sheet([
      ['Diagnóstico de necesidades del territorio'],
      ['Generado el', hoyArchivo()],
      ['Filtros', textoFiltros(f)],
      ['Solicitudes contadas', resumen.total],
      ['Días promedio de registrada a remitida', t.registrada_a_remitida.dias === null ? 'sin datos' : t.registrada_a_remitida.dias, `(${t.registrada_a_remitida.n} solicitud(es))`],
      ['Días promedio de registrada a cerrada', t.registrada_a_cerrada.dias === null ? 'sin datos' : t.registrada_a_cerrada.dias, `(${t.registrada_a_cerrada.n} solicitud(es))`],
      [],
      ['Cómo leerlo'],
      ['Este archivo cuenta solicitudes por categoría, barrio o vereda y estado. No lleva nombres, teléfonos, fotos ni el texto de ninguna solicitud.'],
      ['Los estados cuentan el punto del seguimiento, no que el problema se haya arreglado. No es una respuesta oficial ni un compromiso con nadie.'],
      ['El barrio o la vereda es el que escribió o eligió quien registró la solicitud; el mismo lugar escrito distinto puede aparecer en filas separadas.'],
    ]);
    hojaNota['!cols'] = [{ wch: 44 }, { wch: 16 }, { wch: 24 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hojaDiag, 'Diagnóstico');
    XLSX.utils.book_append_sheet(libro, hojaCat, 'Por categoría');
    XLSX.utils.book_append_sheet(libro, hojaNota, 'Cómo leerlo');
    await registrarAuditoria(req.session.usuario.id, 'exportar_excel', 'solicitudes', null,
      `Exportó el diagnóstico de necesidades del territorio (${filas.length} fila(s), ${resumen.total} solicitud(es), ${textoFiltros(f)}; sin datos personales).`, req.ip);
    enviarLibro(res, libro, `diagnostico-necesidades-territorio-${hoyArchivo()}.xlsx`);
  } catch (e) { responder(res, e); }
});

/** El detalle, solicitud por solicitud: SOLO el administrador (aunque otro rol tenga la casilla), con el teléfono enmascarado. */
router.get('/exportar/detalle', exigir('ver'), soloAdmin, requiereImportarExportar('solicitudes'), async (req, res) => {
  try {
    const f = filtrosDe(req.query);
    const filas = await Panel.detalle(req.alcance, f);
    const hoja = XLSX.utils.aoa_to_sheet([
      ['N.º', 'Registrada', 'Categoría', 'Barrio o vereda', 'Estado', 'Lo que cuenta', 'Responsable', 'Entidad a la que se remitió', 'Remitida el', 'Cerrada el', 'Motivo del cierre',
        'Registrada por', '¿Autorizó guardar sus datos?', 'Ciudadano', 'Teléfono (enmascarado)', 'Tiene ubicación', 'Fotos', 'Datos del ciudadano borrados'],
      ...filas.map((x) => [x.id, x.creada_en, x.categoria, x.barrio, x.estado, x.descripcion, x.responsable, x.entidad_remitida, x.remitida_en, x.cerrada_en, x.motivo_cierre,
        x.registrada_por, x.autoriza, x.ciudadano, x.telefono, x.con_ubicacion, x.fotos, x.datos_borrados]),
    ]);
    hoja['!cols'] = [{ wch: 7 }, { wch: 17 }, { wch: 16 }, { wch: 26 }, { wch: 12 }, { wch: 60 }, { wch: 22 }, { wch: 26 }, { wch: 17 }, { wch: 17 }, { wch: 28 }, { wch: 22 }, { wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 10 }, { wch: 7 }, { wch: 12 }];
    const nota = XLSX.utils.aoa_to_sheet([
      ['Detalle de solicitudes ciudadanas — solo para el administrador'],
      ['Generado el', hoyArchivo()],
      ['Filtros', textoFiltros(f)],
      ['Filas', filas.length],
      [],
      ['Este archivo lleva el texto de cada solicitud y, cuando el ciudadano lo autorizó, su nombre. El teléfono sale enmascarado: solo se ve el final.'],
      ['No lo reenvíes ni lo subas a un servicio de terceros. La descripción es texto libre y puede nombrar a alguien.'],
    ]);
    nota['!cols'] = [{ wch: 40 }, { wch: 24 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Solicitudes');
    XLSX.utils.book_append_sheet(libro, nota, 'Aviso');
    await registrarAuditoria(req.session.usuario.id, 'exportar_excel_detalle', 'solicitudes', null,
      `Exportó el detalle de solicitudes ciudadanas (${filas.length} fila(s), ${textoFiltros(f)}), con el teléfono enmascarado y el nombre del ciudadano solo donde autorizó.`, req.ip);
    enviarLibro(res, libro, `detalle-solicitudes-${hoyArchivo()}.xlsx`);
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
    // El aviso a quien recibe la solicitud. Nunca tumba la asignación (avisarAsignacion no lanza) y no lleva datos del ciudadano.
    const aviso = await Seg.avisarAsignacion({ solicitudId: f.id, responsableId: r.responsable_id, asignadoPor: req.session.usuario });
    const respuesta = { ok: true, responsable_id: r.responsable_id, aviso_enviado: aviso.enviado };
    if (aviso.motivo === 'sin_acceso') respuesta.aviso = 'Esa persona no tiene acceso al módulo de solicitudes: no verá la solicitud ni le llegará el aviso. Dale el permiso en Asignación de permisos.';
    res.json(respuesta);
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
