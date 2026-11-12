/**
 * Logística del Día D — refrigerios, almuerzos, kits (orden 39). Montado en /api/dia-d/logistica. Las reglas viven en
 * lib/logisticaDiaD.js.
 *
 * DOS PUERTAS
 *   · LA COORDINACIÓN (escritorio): con el módulo `logistica_dia_d` (de fábrica admin y coordinador; el aspirante por
 *     PERMISOS_ASPIRANTE). Ítems, plan por puesto, total a comprar, contador y Excel. Todo es de la campaña de quien pregunta
 *     (`aspirante_id` = `duenoDeLaCampana`, 0 = la madre).
 *   · EL COORDINADOR DE PUESTO (celular): NO va por rol ni por la casilla del módulo, sino por tener una fila de testigo de
 *     tipo «puesto» (el «Coordinador de puesto» de testigos.html) en un puesto de la campaña. Ve y entrega SÓLO en su puesto;
 *     un `puesto_id` ajeno en la petición se ignora. Quien tiene el módulo entra por esta misma puerta a cualquier puesto
 *     de su campaña (para cubrir a un coordinador de puesto que no está).
 */
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { requireAuth, calcularAlcance } = require('../middleware/auth');
const { requiereVerModulo, requiereImportarExportar, requiereEditarModulo } = require('../middleware/permisoModulo');
const editarLogistica = requiereEditarModulo('logistica_dia_d', { aspirante: true });   // «Editar» exigido en el servidor (parche 328)
const { requiereComplemento } = require('../middleware/complemento');
const { UPLOAD_DIA_D_DIR } = require('../middleware/upload');
const { registrarAuditoria } = require('../config/auditoria');
const { duenoDeLaCampana } = require('../lib/ramas');
const L = require('../lib/logisticaDiaD');

const router = express.Router();
// Activar complementos (parche 318): cierra TODO el router, también la pantalla del coordinador de puesto (`puertaDelPuesto`), que no pasa por el módulo.
router.use(requireAuth, requiereComplemento('logistica_dia_d'), calcularAlcance);

const entero = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const falla = (res, ruta, err, mensaje) => {
  console.error('logistica/' + ruta + ':', err.code || err.message);
  return res.status(500).json({ error: mensaje });
};
const NOMBRE_FOTO = /^logistica_[0-9]+_[0-9a-f]+\.jpg$/;

const puertaCoordinacion = requiereVerModulo('logistica_dia_d', { aspirante: true });

/** ¿Pasa esta petición la puerta de la coordinación? (se usa la misma función, sin que conteste ella). */
function pasaLaCoordinacion(req) {
  return new Promise((resolver) => {
    const res = { status() { return this; }, json() { resolver(false); return this; } };
    puertaCoordinacion(req, res, () => resolver(true));
  });
}

/**
 * La puerta del celular: la coordinación, o el coordinador de puesto. Deja `req.esCoordinacion`, `req.dueno` y, para el segundo,
 * `req.miPuesto` (su puesto). Falla cerrada.
 */
async function puertaDelPuesto(req, res, next) {
  try {
    req.dueno = await duenoDeLaCampana(pool, req);
    if (await pasaLaCoordinacion(req)) { req.esCoordinacion = true; return next(); }
    const mio = await L.puestoDeTestigo(pool, req.dueno, req.session.usuario.id);
    if (mio && mio.puesto && mio.testigo.tipo_testigo === 'puesto') { req.miPuesto = mio.puesto; return next(); }
    return res.status(403).json({ error: 'Esta pantalla es para el coordinador de puesto. Si lo necesitas, pídeselo al administrador de la campaña.' });
  } catch (err) {
    return falla(res, 'puerta', err, 'No se pudo comprobar su permiso, y por seguridad se negó. Vuelve a intentarlo.');
  }
}

/** El puesto sobre el que se opera: el suyo para el coordinador de puesto; el pedido para la coordinación. */
const puestoDe = (req, pedido) => (req.miPuesto ? req.miPuesto.id : entero(pedido));

// ===========================================================================
// EL CELULAR — el coordinador de puesto
// ===========================================================================

const subirFoto = multer({ storage: multer.memoryStorage(), limits: { fileSize: L.TAMANO_MAXIMO_FOTO, files: 1 } }).single('foto');
const conFoto = (req, res, next) => subirFoto(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'La foto pesa más de 8 MB.' });
  return res.status(400).json({ error: 'No se pudo leer la foto.' });
});

/** Mi puesto (o el pedido, para la coordinación): testigos, ítems y qué recibió cada uno hoy. */
router.get('/mi-puesto', puertaDelPuesto, async (req, res) => {
  try {
    const puestoId = puestoDe(req, req.query.puesto_id);
    if (!puestoId) return res.status(400).json({ error: 'Indica el puesto.' });
    const vista = await L.vistaDelPuesto(pool, req.dueno, puestoId, L.hoy());
    if (!vista) return res.status(404).json({ error: 'Ese puesto no es de esta campaña.' });
    res.json({ ...vista, es_coordinacion: !!req.esCoordinacion });
  } catch (err) { falla(res, 'mi-puesto', err, 'No se pudo cargar su puesto.'); }
});

/**
 * Entregar un ítem a un testigo. Idempotente (ver L.entregar): el doble toque y el reintento de la cola sin señal responden 200 con
 * `ya_estaba: true`. La foto es opcional: se reduce y se guarda DESPUÉS de reclamar la entrega, así una entrega repetida no deja
 * archivos huérfanos.
 */
router.post('/entregar', puertaDelPuesto, conFoto, async (req, res) => {
  try {
    const b = req.body || {};
    const itemId = entero(b.item_id), receptorId = entero(b.receptor_usuario_id);
    if (!itemId || !receptorId) return res.status(400).json({ error: 'Indica el ítem y el testigo.' });
    const puestoId = puestoDe(req, b.puesto_id);
    if (!puestoId) return res.status(400).json({ error: 'Indica el puesto.' });
    const horaDeMarca = require('./checkinDiaD.routes').horaDeMarca;
    const marcadoEn = b.marcado_en ? horaDeMarca(b.marcado_en) : null;
    let r;
    try {
      r = await L.entregar(pool, {
        dueno: req.dueno, usuarioId: req.session.usuario.id, puestoId, itemId, receptorId,
        clienteUuid: b.cliente_uuid || null, marcadoEn, nota: b.nota,
      });
    } catch (e) {
      if (e.estado) return res.status(e.estado).json({ error: e.message });
      throw e;
    }
    let foto = false;
    if (req.file && r.resultado !== 'ya_estaba') {
      try {
        const nombre = await L.guardarFoto(req.file.buffer, UPLOAD_DIA_D_DIR);
        await pool.query('UPDATE logistica_entregas SET foto_url = ? WHERE id = ?', [nombre, r.id]);
        foto = true;
      } catch (e) {
        // La entrega ya está registrada; la foto es opcional. Se avisa, no se deshace.
        console.warn('logistica/foto: no se pudo guardar la foto de la entrega', r.id, e.message);
      }
    }
    res.json({ ok: true, id: r.id, resultado: r.resultado, ya_estaba: r.resultado === 'ya_estaba', foto, foto_recibida: !!req.file });
  } catch (err) { falla(res, 'entregar', err, 'No se pudo registrar la entrega.'); }
});

/** Anular una entrega hecha por error. El coordinador de puesto, sólo las de su puesto. */
router.post('/anular', puertaDelPuesto, async (req, res) => {
  try {
    const entregaId = entero((req.body || {}).entrega_id);
    if (!entregaId) return res.status(400).json({ error: 'Indica la entrega.' });
    const ok = await L.anular(pool, { dueno: req.dueno, entregaId, usuarioId: req.session.usuario.id, puestoId: req.miPuesto ? req.miPuesto.id : null });
    if (!ok) return res.status(404).json({ error: 'Esa entrega no existe, ya estaba anulada o no es de su puesto.' });
    await registrarAuditoria(req.session.usuario.id, 'anular_entrega_logistica', 'logistica_entregas', entregaId, 'Anuló una entrega de logística del Día D.', req.ip);
    res.json({ ok: true });
  } catch (err) { falla(res, 'anular', err, 'No se pudo anular la entrega.'); }
});

/** La foto de una entrega: sólo la coordinación, o el coordinador de ese puesto. Carpeta protegida; nunca por /uploads. */
router.get('/entregas/:id/foto', puertaDelPuesto, async (req, res) => {
  try {
    const id = entero(req.params.id);
    if (!id) return res.status(400).json({ error: 'Entrega inválida.' });
    const [[e]] = await pool.query('SELECT puesto_id, foto_url FROM logistica_entregas WHERE id = ? AND aspirante_id = ?', [id, req.dueno]);
    if (!e || (req.miPuesto && Number(e.puesto_id) !== Number(req.miPuesto.id))) return res.status(404).json({ error: 'Esa entrega no existe.' });
    if (!e.foto_url || !NOMBRE_FOTO.test(e.foto_url)) return res.status(404).json({ error: 'Esta entrega no tiene foto.' });
    const ruta = path.join(UPLOAD_DIA_D_DIR, e.foto_url);
    if (!fs.existsSync(ruta)) return res.status(404).json({ error: 'El archivo ya no está en el servidor.' });
    res.sendFile(ruta, { headers: { 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
  } catch (err) { falla(res, 'foto', err, 'No se pudo abrir la foto.'); }
});

// ===========================================================================
// ESCRITORIO — la coordinación
// ===========================================================================

const coordinacion = express.Router();
coordinacion.use(puertaCoordinacion, async (req, res, next) => {
  try { req.dueno = await duenoDeLaCampana(pool, req); next(); } catch (err) { falla(res, 'dueno', err, 'No se pudo identificar la campaña.'); }
});

coordinacion.get('/contexto', async (req, res) => {
  try {
    const [[e]] = await pool.query('SELECT (fecha_eleccion = CURDATE()) AS hoy FROM configuracion_campana WHERE id = 1').catch(() => [[null]]);
    res.json({ fecha: L.hoy(), hoy_es_eleccion: !!(e && Number(e.hoy) === 1) });
  } catch (err) { falla(res, 'contexto', err, 'No se pudo cargar el contexto.'); }
});

coordinacion.get('/items', async (req, res) => {
  try { res.json({ items: await L.listarItems(pool, req.dueno) }); } catch (err) { falla(res, 'items', err, 'No se pudieron cargar los ítems.'); }
});

coordinacion.post('/items', editarLogistica, async (req, res) => {
  try {
    const v = L.validarItem(req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    const d = v.datos;
    const [[{ maximo }]] = await pool.query('SELECT COALESCE(MAX(orden), 0) AS maximo FROM logistica_items WHERE aspirante_id = ?', [req.dueno]);
    try {
      const [r] = await pool.query(
        'INSERT INTO logistica_items (aspirante_id, nombre, destinatario, hora_limite, incluir_suplentes, activo, orden) VALUES (?,?,?,?,?,?,?)',
        [req.dueno, d.nombre, d.destinatario, d.hora_limite === undefined ? null : d.hora_limite, d.incluir_suplentes || 0, d.activo === undefined ? 1 : d.activo, d.orden === undefined ? Number(maximo) + 1 : d.orden]);
      await registrarAuditoria(req.session.usuario.id, 'crear_item_logistica', 'logistica_items', r.insertId, `Creó el ítem de logística «${d.nombre}».`, req.ip);
      res.json({ ok: true, id: r.insertId });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya hay un ítem con ese nombre.' });
      throw e;
    }
  } catch (err) { falla(res, 'items-crear', err, 'No se pudo crear el ítem.'); }
});

coordinacion.put('/items/:id', editarLogistica, async (req, res) => {
  try {
    const id = entero(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ítem inválido.' });
    const v = L.validarItem(req.body || {}, { parcial: true });
    if (v.error) return res.status(400).json({ error: v.error });
    const sets = Object.keys(v.datos);
    if (!sets.length) return res.status(400).json({ error: 'No hay nada que cambiar.' });
    try {
      const [r] = await pool.query(
        `UPDATE logistica_items SET ${sets.map(k => `${k} = ?`).join(', ')} WHERE id = ? AND aspirante_id = ?`,
        [...sets.map(k => v.datos[k]), id, req.dueno]);
      if (!r.affectedRows) return res.status(404).json({ error: 'Ese ítem no existe.' });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya hay un ítem con ese nombre.' });
      throw e;
    }
    await registrarAuditoria(req.session.usuario.id, 'editar_item_logistica', 'logistica_items', id, `Editó el ítem de logística ${id}: ${sets.join(', ')}.`, req.ip);
    res.json({ ok: true });
  } catch (err) { falla(res, 'items-editar', err, 'No se pudo guardar el ítem.'); }
});

coordinacion.get('/plan', async (req, res) => {
  try { res.json(await L.planDelDia(pool, req.dueno, L.hoy())); } catch (err) { falla(res, 'plan', err, 'No se pudo calcular el plan.'); }
});

/** Corrige a mano la cantidad de un ítem en un puesto; `cantidad: null` vuelve a la sugerida. */
coordinacion.put('/plan', editarLogistica, async (req, res) => {
  try {
    const b = req.body || {};
    const itemId = entero(b.item_id), puestoId = entero(b.puesto_id);
    if (!itemId || !puestoId) return res.status(400).json({ error: 'Indica el ítem y el puesto.' });
    let cantidad = null;
    if (b.cantidad !== null && b.cantidad !== undefined && b.cantidad !== '') {
      cantidad = Number(b.cantidad);
      if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > 9999) return res.status(400).json({ error: 'La cantidad debe ser un número entero de 0 a 9999.' });
    }
    const [[item]] = await pool.query('SELECT id, destinatario FROM logistica_items WHERE id = ? AND aspirante_id = ?', [itemId, req.dueno]);
    if (!item) return res.status(404).json({ error: 'Ese ítem no existe.' });
    if (item.destinatario !== 'testigos') return res.status(400).json({ error: 'La cantidad de un ítem para conductores sale del número de conductores.' });
    const [[p]] = await pool.query('SELECT id FROM dia_d_puestos_votacion WHERE id = ? AND aspirante_id = ?', [puestoId, req.dueno]);
    if (!p) return res.status(404).json({ error: 'Ese puesto no es de esta campaña.' });
    await L.fijarCantidad(pool, { dueno: req.dueno, itemId, puestoId, cantidad, usuarioId: req.session.usuario.id });
    await registrarAuditoria(req.session.usuario.id, 'plan_logistica', 'logistica_plan', itemId,
      cantidad === null ? `Volvió a la cantidad sugerida del ítem ${itemId} en el puesto ${puestoId}.` : `Fijó en ${cantidad} el ítem ${itemId} en el puesto ${puestoId}.`, req.ip);
    res.json({ ok: true });
  } catch (err) { falla(res, 'plan-guardar', err, 'No se pudo guardar la cantidad.'); }
});

/** El contador del cuadro del Día D: por ítem, «entregados de planeados». */
coordinacion.get('/contador', async (req, res) => {
  try { res.json(await L.contador(pool, req.dueno, L.hoy())); } catch (err) { falla(res, 'contador', err, 'No se pudo calcular el contador.'); }
});

/** Excel: lista de compras, lista por puesto y testigos (nombre y cédula enmascarada). */
coordinacion.get('/exportar-excel', requiereImportarExportar('logistica_dia_d'), async (req, res) => {
  try {
    const d = await L.datosParaExcel(pool, req.dueno, L.hoy());
    const libro = XLSX.utils.book_new();
    const hoja = (filas, vacio) => (filas.length ? XLSX.utils.json_to_sheet(filas) : XLSX.utils.aoa_to_sheet([[vacio]]));
    XLSX.utils.book_append_sheet(libro, hoja(d.compras, 'Sin ítems activos'), 'Lista de compras');
    XLSX.utils.book_append_sheet(libro, hoja(d.porPuesto, 'Sin puestos'), 'Por puesto');
    XLSX.utils.book_append_sheet(libro, hoja(d.testigos, 'Sin testigos asignados'), 'Testigos');
    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
    await registrarAuditoria(req.session.usuario.id, 'exportar_logistica', 'logistica_plan', 0, 'Exportó el Excel de logística del Día D.', req.ip);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="logistica-dia-d.xlsx"');
    res.send(buffer);
  } catch (err) { falla(res, 'excel', err, 'No se pudo generar el Excel.'); }
});

router.use(coordinacion);

module.exports = router;
