/**
 * /api/tareas-direccion — «Tareas de dirección» (orden 116). SOLO el candidato y el superadministrador; cualquier otra persona recibe 403 en TODAS las rutas.
 *
 * El acceso es FIJO para esos dos y no está en «Asignación de permisos»: no se le puede dar a otros roles. El rol «candidato» es de solo lectura en todo el servidor
 * (middleware/soloLecturaCandidato.js); a él se le abre únicamente este prefijo (config/rolCandidato.js), y con eso nada más.
 *
 *   GET    /                    el tablero: todas las pendientes y en curso, y las hechas de los últimos 30 días (?hechas=todas para todas)
 *   GET    /resumen             { hoy, vencidas, vencen_en_3_dias, sin_realizar, tareas[3] } para Inicio, Panel y «Más» del celular (orden 122: el aviso «Tareas programadas»)
 *   GET    /responsables        el candidato, las personas con usuario y los responsables escritos a mano ya usados
 *   GET    /:id                 la tarea con su historial
 *   POST   /                    crear
 *   PUT    /:id                 editar (los campos que lleguen)
 *   PATCH  /:id/estado          { estado: 'pendiente'|'en_curso'|'hecha', deshacer?: true } — arrastrar, botones, «Marcar como realizada», reabrir, deshacer
 *   POST   /:id/whatsapp        anota «Recordar por WhatsApp» en el historial y devuelve la URL de wa.me
 *   DELETE /:id                 eliminar
 *
 * Todo vive en lib/tareasDireccion.js. Las tareas no salen en exportaciones, dashboards, búsquedas ni en ningún otro módulo.
 */
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const T = require('../lib/tareasDireccion');
const { registrarAuditoria } = require('../config/auditoria');

const router = express.Router();
router.use(requireAuth, T.requiereDireccion);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const FALLO = 'No se pudo completar la operación. Intente de nuevo.';
function fallar(res, etiqueta, err) {
  console.error(`tareas-direccion/${etiqueta}:`, (err && (err.code || err.message)));   // sin la sentencia: lleva datos
  res.status(500).json({ error: FALLO });
}
function idDe(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) { res.status(404).json({ error: 'Esa tarea ya no existe.' }); return null; }
  return id;
}
const NO_EXISTE = { error: 'Esa tarea ya no existe.' };

router.get('/', async (req, res) => {
  try { res.json(await T.listar({ todasLasHechas: req.query.hechas === 'todas' })); }
  catch (err) { fallar(res, 'listar', err); }
});

router.get('/resumen', async (req, res) => {
  try { res.json(await T.resumen()); }
  catch (err) { fallar(res, 'resumen', err); }
});

router.get('/responsables', async (req, res) => {
  try { res.json(await T.responsables()); }
  catch (err) { fallar(res, 'responsables', err); }
});

router.get('/:id', async (req, res) => {
  const id = idDe(req, res); if (id === null) return;
  try {
    const d = await T.detalle(id);
    if (!d) return res.status(404).json(NO_EXISTE);
    res.json(d);
  } catch (err) { fallar(res, 'detalle', err); }
});

router.post('/', async (req, res) => {
  try {
    const r = await T.crear(req.body || {}, req.session.usuario.id);
    if (r.error) return res.status(400).json({ error: r.error });
    res.status(201).json(r);
  } catch (err) { fallar(res, 'crear', err); }
});

router.put('/:id', async (req, res) => {
  const id = idDe(req, res); if (id === null) return;
  try {
    const r = await T.editar(id, req.body || {}, req.session.usuario.id);
    if (r.noExiste) return res.status(404).json(NO_EXISTE);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) { fallar(res, 'editar', err); }
});

router.patch('/:id/estado', async (req, res) => {
  const id = idDe(req, res); if (id === null) return;
  try {
    const r = await T.cambiarEstado(id, String((req.body || {}).estado || ''), req.session.usuario.id, { deshacer: !!(req.body || {}).deshacer });
    if (r.noExiste) return res.status(404).json(NO_EXISTE);
    if (r.error) return res.status(400).json({ error: r.error });
    if (r.conflicto) return res.status(409).json({ error: 'La tarea cambió mientras tanto. Se recargó el tablero.' });
    res.json(r);
  } catch (err) { fallar(res, 'estado', err); }
});

router.post('/:id/whatsapp', async (req, res) => {
  const id = idDe(req, res); if (id === null) return;
  try {
    const r = await T.registrarWhatsapp(id, req.session.usuario.id);
    if (r.noExiste) return res.status(404).json(NO_EXISTE);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) { fallar(res, 'whatsapp', err); }
});

router.delete('/:id', async (req, res) => {
  const id = idDe(req, res); if (id === null) return;
  try {
    if (!(await T.eliminar(id))) return res.status(404).json(NO_EXISTE);
    // La auditoría NO lleva el título: la tarea es privada y la auditoría la leen los administradores.
    try { await registrarAuditoria(req.session.usuario.id, 'tarea_direccion_eliminar', 'tareas_direccion', id, 'Eliminó una tarea de dirección.', req.ip); } catch (_) { /* la auditoría no frena el borrado */ }
    res.json({ ok: true });
  } catch (err) { fallar(res, 'eliminar', err); }
});

module.exports = router;
