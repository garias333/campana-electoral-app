/**
 * EL PANEL DEL LÍDER en el celular. Montado en /api/panel-lider.
 *
 *   GET /              todo en UNA llamada: meta e inscritos, últimos 7 días, pendientes, equipo, posición y Día D.
 *   GET /pendientes    lista corta de quienes no tienen teléfono o puesto: ?tipo=sin_telefono|sin_puesto&page=
 *
 * QUIÉN ES, SALE DE LA SESIÓN, NUNCA DE LA URL: no hay ningún parámetro que nombre a una persona. Y TODO se acota con
 * `req.alcance` (el mismo que usa la lista de Votantes), de modo que el aspirante con rol `lider` ve su rama y un líder
 * corriente, lo suyo. Ver lib/panelLider.js: ahí está la definición única de «inscritos».
 *
 * Solo para quien trabaja en la calle: líder, sublíder y aspirante. El coordinador tiene «Avance de mis líderes».
 */
'use strict';

const express = require('express');
const { requireAuth, requireRole, calcularAlcance } = require('../middleware/auth');
const panel = require('../lib/panelLider');
const { permisosDeSesion } = require('./permisos.routes');

const router = express.Router();
router.use(requireAuth, calcularAlcance, requireRole('lider', 'sublider', 'aspirante'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/', async (req, res) => {
  try {
    const [progreso, dias, pend, equipo, posicion] = await Promise.all([
      panel.progresoDelLider(req), panel.ultimosSieteDias(req), panel.pendientes(req), panel.equipo(req), panel.posicionPropia(req),
    ]);
    // Con dos metas (aspirante), la barra mide lo que ve en su lista contra la de SU campaña.
    const meta = progreso.dosMetas ? progreso.propia.meta : (progreso.meta || 0);
    const tieneMeta = !!progreso.tieneMetaAsignada && meta > 0;

    let diaD = null;
    let tareas = null;
    try {
      const { permisos } = await permisosDeSesion(req);
      // «Si tiene rescate_votos y (es el día de la elección o modo prueba)»: fuera del día la pantalla trabaja en modo
      // prueba, así que quien tiene el módulo ve el contador siempre, con su etiqueta.
      if (permisos && permisos.rescate_votos && permisos.rescate_votos.ver) diaD = await panel.diaD(req);
    } catch (err) {
      console.error('panel-lider (Día D):', err.code || err.message);
    }

    // La tarjeta «mis tareas» (parche 305): solo con «Ver» en tareas. Cuenta lo que tiene ASIGNADO; sin títulos ni nombres. Va en su propio try:
    // una campaña que aplicó el parche sin la migración (sin la tabla `tareas`) no puede perder por eso el resto del panel.
    try {
      const { permisos } = await permisosDeSesion(req);
      if (permisos && permisos.tareas && permisos.tareas.ver && !req.sublicencia) tareas = await require('../lib/tareas').resumenMisTareas(req.session.usuario.id);
    } catch (err) {
      console.error('panel-lider (tareas):', err.code || err.message);
    }

    res.json({
      usuario: { nombre: req.session.usuario.nombre, rol: req.session.usuario.rol, es_aspirante: !!req.sublicencia },
      generado_en: new Date().toISOString(),
      meta: {
        tieneMeta, meta: tieneMeta ? meta : 0, inscritos: progreso.enviados,
        porcentaje: tieneMeta ? Math.min(100, Math.round((progreso.enviados / meta) * 100)) : 0,
        por_enlace: progreso.porEnlace, por_enlace_sin_confirmar: progreso.porEnlaceSinConfirmar,
      },
      ultimos_7_dias: dias,
      pendientes: pend,
      equipo,
      posicion,
      dia_d: diaD,
      tareas,
    });
  } catch (err) {
    console.error('panel-lider:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo cargar tu panel.' });
  }
});

router.get('/pendientes', async (req, res) => {
  const tipo = String(req.query.tipo || '');
  if (!['sin_telefono', 'sin_puesto'].includes(tipo)) return res.status(400).json({ error: 'El tipo debe ser sin_telefono o sin_puesto.' });
  try {
    res.json(await panel.listaPendientes(req, tipo, req.query.page));
  } catch (err) {
    console.error('panel-lider/pendientes:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo cargar la lista.' });
  }
});

module.exports = router;
