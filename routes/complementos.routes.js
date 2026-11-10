/**
 * «ACTIVAR COMPLEMENTOS» (parche 318): la API de la pantalla de Configuración. La regla y el estado viven en lib/complementos.js.
 *
 *   GET /api/complementos         el estado de los nueve (nombre, descripción, dependencia, si está encendido) y, para Transporte, cuántas
 *                                 asignaciones de HOY siguen sin cerrar. Solo el administrador y el superadministrador.
 *   PUT /api/complementos/:clave  { activo: true|false }. Solo el administrador y el superadministrador; se audita. Apagar «Puerta a puerta»
 *                                 apaga también su panel; encender el panel con Puerta a puerta apagado se rechaza (409).
 *
 * El superadministrador conserva el rol «admin» (config/superadmin.js), así que `requireRole('admin')` los cubre a los dos. Un aspirante con
 * sublicencia no llega aquí: `/api/complementos` no está en PERMITIDOS de middleware/aspirante.js.
 *
 * ESTA RUTA NO LLEVA `requiereComplemento`: es la que enciende y apaga.
 */
'use strict';

const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { registrarAuditoria } = require('../config/auditoria');
const C = require('../lib/complementos');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

/** Asignaciones de transporte de HOY (la base corre en hora de Colombia) que no se han cerrado: por recoger o ya en el vehículo. */
async function transporteSinCerrar() {
  try {
    const [[r]] = await pool.query(
      `SELECT COUNT(*) AS n FROM transporte_asignaciones WHERE fecha = CURDATE() AND estado IN ('asignado','recogido')`);
    return Number(r.n) || 0;
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') console.error('[complementos] No se pudo contar el transporte sin cerrar:', err.code || err.message);
    return null;                // sin dato: la pantalla no inventa una cifra
  }
}

router.get('/', async (req, res) => {
  try {
    res.json({ complementos: await C.estado(), transporte_sin_cerrar: await transporteSinCerrar() });
  } catch (err) {
    console.error('[complementos] GET:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo leer el estado de los complementos.' });
  }
});

router.put('/:clave', async (req, res) => {
  const def = C.CATALOGO.find((c) => c.clave === req.params.clave);
  if (!def) return res.status(404).json({ error: 'Ese complemento no existe.' });
  const activo = req.body && req.body.activo;
  if (typeof activo !== 'boolean') return res.status(400).json({ error: 'Falta decir si se enciende o se apaga («activo»: true o false).' });
  try {
    const cambiadas = await C.guardar(def.clave, activo, req.session.usuario.id);
    if (cambiadas.length) {
      const nombres = cambiadas.map((k) => C.CATALOGO.find((c) => c.clave === k).nombre).join(', ');
      await registrarAuditoria(req.session.usuario.id, activo ? 'complemento_encender' : 'complemento_apagar', 'complementos', null,
        `${activo ? 'Encendió' : 'Apagó'} ${cambiadas.length === 1 ? 'el complemento' : 'los complementos'}: ${nombres}.`, req.ip);
    }
    res.json({ ok: true, cambiadas, complementos: await C.estado() });
  } catch (err) {
    if (err && err.estado) return res.status(err.estado).json({ error: err.message });
    console.error('[complementos] PUT:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo guardar el cambio.' });
  }
});

module.exports = router;
