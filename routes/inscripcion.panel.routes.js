/**
 * routes/inscripcion.panel.routes.js — /api/inscripcion
 *
 * Lo que ve y hace alguien CON SESIÓN sobre los enlaces de inscripción. La
 * página pública que usa la gente está en routes/inscripcion.routes.js (/i).
 *
 *   · «Mi enlace» (líder, sublíder, coordinador, aspirante): su código, su QR
 *     (lo dibuja el navegador), cuánta gente lleva por ahí y «Cambiar mi enlace».
 *   · El cuadro del escritorio (admin, coordinador, aspirante): por líder, cuántos
 *     lleva hoy y en total, cuántos confirmaron, cuántos intentos se toparon con una
 *     cédula de otro líder, y desactivar o rotar un enlace. SIN MOSTRAR LA CÉDULA.
 *   · Los ajustes (topes, tiempo mínimo, interruptor general): solo el administrador.
 *
 * QUIEN NO ES ADMIN SOLO VE Y TOCA LA GENTE DE SU RAMA (`subarbolSql`, la misma
 * función con la que el resto de la aplicación acota por estructura).
 */
'use strict';

const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { subarbolSql } = require('../lib/ramas');
const { registrarAuditoria } = require('../config/auditoria');
const {
  ROLES_CON_ENLACE, obtenerOCrearEnlace, rotarEnlace, puedeTenerEnlace, baseDelSitio, leerAjustes,
} = require('../config/inscripcionEnlace');

const router = express.Router();
router.use(requireAuth);

/** El trozo de SQL que acota `columna` (un usuarios.id) a lo que ve quien pregunta. null = todo. */
function alcanceDeUsuarios(req, columna) {
  if (req.session.usuario.rol === 'admin') return null;
  const raiz = req.sublicencia ? req.sublicencia.usuario_id : req.session.usuario.id;
  return subarbolSql(raiz, columna);
}

// ---------------------------------------------------------------------------
// Mi enlace
// ---------------------------------------------------------------------------

router.get('/mi-enlace', async (req, res) => {
  try {
    const usuarioId = req.session.usuario.id;
    if (!(await puedeTenerEnlace(usuarioId))) {
      return res.status(403).json({ error: 'Tu cuenta no tiene enlace de inscripción.' });
    }
    const ajustes = await leerAjustes();
    const enlace = await obtenerOCrearEnlace(usuarioId);
    const [[c]] = await pool.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(DATE(i.creado_en) = CURDATE()), 0) AS hoy,
              COALESCE(SUM(v.consentimiento_confirmado_en IS NOT NULL), 0) AS confirmados
         FROM inscripcion_intentos i LEFT JOIN votantes v ON v.id = i.votante_id
        WHERE i.enlace_id = ? AND i.resultado = 'nuevo'`, [enlace.id]);
    /* CÉDULAS QUE YA EXISTÍAN (orden 28). Alguien escribió por ESTE enlace una cédula que ya estaba en la campaña:
       no se creó ficha y, si el celular no coincidía, no se tocó nada. El líder lo ve con la cédula ENMASCARADA
       (solo los tres últimos dígitos, que es lo único que se guardó), la fecha y si el celular coincidía. En su
       propio bloque: si la base aún no tiene las columnas nuevas (init-db sin correr), la pantalla sigue. */
    let avisos = [];
    try {
      const [filas] = await pool.query(
        `SELECT id, creado_en, cedula_fin, celular_coincide FROM inscripcion_intentos
          WHERE enlace_id = ? AND motivo = 'cedula_existente' ORDER BY creado_en DESC, id DESC LIMIT 20`, [enlace.id]);
      avisos = filas.map(f => ({
        id: f.id, fecha: f.creado_en,
        cedula: '***' + (f.cedula_fin || ''), celular_coincidia: f.celular_coincide === 1,
      }));
    } catch (err) {
      if (err.code !== 'ER_BAD_FIELD_ERROR') console.error('inscripcion mi-enlace (avisos):', err.code || err.message);
    }
    res.json({
      codigo: enlace.codigo,
      ruta: `/i/${enlace.codigo}`,
      base: baseDelSitio(),
      activo: !!enlace.activo,
      habilitado: !!ajustes.habilitado,
      total: Number(c.total), hoy: Number(c.hoy), confirmados: Number(c.confirmados),
      sin_confirmar: Number(c.total) - Number(c.confirmados),
      avisos,
    });
  } catch (err) {
    console.error('inscripcion mi-enlace:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo cargar tu enlace.' });
  }
});

router.post('/mi-enlace/rotar', async (req, res) => {
  try {
    const usuarioId = req.session.usuario.id;
    if (!(await puedeTenerEnlace(usuarioId))) {
      return res.status(403).json({ error: 'Tu cuenta no tiene enlace de inscripción.' });
    }
    const actual = await obtenerOCrearEnlace(usuarioId);
    if (!actual.activo) {
      return res.status(403).json({ error: 'Tu enlace fue desactivado por la coordinación. Pídeles que lo reactiven.' });
    }
    const nuevo = await rotarEnlace(usuarioId);
    await registrarAuditoria(usuarioId, 'rotar_enlace_inscripcion', 'inscripcion_enlaces', nuevo.id,
      'El usuario cambió su propio enlace de inscripción.', req.ip);
    res.json({ ok: true, codigo: nuevo.codigo, ruta: `/i/${nuevo.codigo}` });
  } catch (err) {
    console.error('inscripcion rotar:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo cambiar el enlace.' });
  }
});

// ---------------------------------------------------------------------------
// Cuadro del escritorio
// ---------------------------------------------------------------------------

router.get('/resumen', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  try {
    const alcance = alcanceDeUsuarios(req, 'u.id');
    const [filas] = await pool.query(
      `SELECT u.id AS usuario_id, u.nombre, r.nombre AS rol,
              e.id AS enlace_id, e.activo, e.rotado_en,
              COALESCE(st.total, 0) AS total, COALESCE(st.hoy, 0) AS hoy,
              COALESCE(st.confirmados, 0) AS confirmados,
              COALESCE(st.otro_lider, 0) AS intentos_otro_lider,
              COALESCE(st.rechazados, 0) AS rechazados
         FROM usuarios u
         JOIN roles r ON r.id = u.rol_id
         LEFT JOIN inscripcion_enlaces e ON e.usuario_id = u.id
         LEFT JOIN (
           SELECT i.enlace_id,
                  SUM(i.resultado = 'nuevo') AS total,
                  SUM(i.resultado = 'nuevo' AND DATE(i.creado_en) = CURDATE()) AS hoy,
                  SUM(i.resultado = 'nuevo' AND v.consentimiento_confirmado_en IS NOT NULL) AS confirmados,
                  SUM(i.otro_lider = 1) AS otro_lider,
                  SUM(i.resultado = 'rechazado') AS rechazados
             FROM inscripcion_intentos i LEFT JOIN votantes v ON v.id = i.votante_id
            GROUP BY i.enlace_id) st ON st.enlace_id = e.id
        WHERE u.activo = 1 AND r.nombre IN (?)
          AND EXISTS (SELECT 1 FROM estructura s WHERE s.usuario_id = u.id AND s.activo = 1 AND s.cargo <> 'testigo')
          ${alcance ? `AND ${alcance.sql}` : ''}
        ORDER BY total DESC, u.nombre`,
      [ROLES_CON_ENLACE, ...(alcance ? alcance.valores : [])]);
    const ajustes = await leerAjustes();
    res.json({
      ajustes,
      lideres: filas.map(f => ({
        usuario_id: f.usuario_id, nombre: f.nombre, rol: f.rol,
        enlace_id: f.enlace_id || null,
        // Sin fila de enlace todavía: nunca lo ha abierto. Cuenta como activo (se creará activo).
        activo: f.enlace_id ? !!f.activo : true,
        rotado_en: f.rotado_en || null,
        total: Number(f.total), hoy: Number(f.hoy), confirmados: Number(f.confirmados),
        sin_confirmar: Number(f.total) - Number(f.confirmados),
        intentos_otro_lider: Number(f.intentos_otro_lider), rechazados: Number(f.rechazados),
      })),
    });
  } catch (err) {
    console.error('inscripcion resumen:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo cargar el cuadro de inscripciones.' });
  }
});

/** Los intentos que se toparon con la cédula de otro líder. Sin cédula y sin nombre de la persona. */
router.get('/intentos-otro-lider', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  try {
    const alcance = alcanceDeUsuarios(req, 'uo.id');
    const [filas] = await pool.query(
      `SELECT i.id, i.creado_en, uo.nombre AS lider_del_enlace, ud.nombre AS dueno_actual, i.resultado
         FROM inscripcion_intentos i
         JOIN inscripcion_enlaces e ON e.id = i.enlace_id
         JOIN usuarios uo ON uo.id = e.usuario_id
         LEFT JOIN votantes v ON v.id = i.votante_id
         LEFT JOIN usuarios ud ON ud.id = v.lider_id
        WHERE i.otro_lider = 1 ${alcance ? `AND ${alcance.sql}` : ''}
        ORDER BY i.id DESC LIMIT 50`,
      alcance ? alcance.valores : []);
    res.json(filas);
  } catch (err) {
    console.error('inscripcion intentos:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo cargar la bitácora.' });
  }
});

/** Comprueba que `usuarioId` esté dentro de lo que quien llama puede tocar. */
async function enMiAlcance(req, usuarioId) {
  const alcance = alcanceDeUsuarios(req, 'u.id');
  if (!alcance) return true;
  const [[f]] = await pool.query(`SELECT 1 AS ok FROM usuarios u WHERE u.id = ? AND ${alcance.sql}`,
    [usuarioId, ...alcance.valores]);
  return !!f;
}

router.post('/enlaces/:usuarioId/activo', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  try {
    const usuarioId = Number(req.params.usuarioId) || 0;
    const activo = req.body && (req.body.activo === true || req.body.activo === 1 || req.body.activo === '1') ? 1 : 0;
    if (!usuarioId || !(await enMiAlcance(req, usuarioId)) || !(await puedeTenerEnlace(usuarioId))) {
      return res.status(404).json({ error: 'Esa persona no está en tu equipo.' });
    }
    const enlace = await obtenerOCrearEnlace(usuarioId);
    await pool.query('UPDATE inscripcion_enlaces SET activo = ? WHERE id = ?', [activo, enlace.id]);
    await registrarAuditoria(req.session.usuario.id, activo ? 'activar_enlace_inscripcion' : 'desactivar_enlace_inscripcion',
      'inscripcion_enlaces', enlace.id, `Enlace del usuario ${usuarioId}.`, req.ip);
    res.json({ ok: true, activo: !!activo });
  } catch (err) {
    console.error('inscripcion activo:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo cambiar el estado del enlace.' });
  }
});

router.post('/enlaces/:usuarioId/rotar', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  try {
    const usuarioId = Number(req.params.usuarioId) || 0;
    if (!usuarioId || !(await enMiAlcance(req, usuarioId)) || !(await puedeTenerEnlace(usuarioId))) {
      return res.status(404).json({ error: 'Esa persona no está en tu equipo.' });
    }
    const nuevo = await rotarEnlace(usuarioId);
    await registrarAuditoria(req.session.usuario.id, 'rotar_enlace_inscripcion', 'inscripcion_enlaces', nuevo.id,
      `Enlace del usuario ${usuarioId}.`, req.ip);
    // El código nuevo NO se devuelve: lo ve su dueño en «Mi enlace». Quien rota por otro no lo necesita.
    res.json({ ok: true });
  } catch (err) {
    console.error('inscripcion rotar (gestión):', err.code || err.message);
    res.status(500).json({ error: 'No se pudo cambiar el enlace.' });
  }
});

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

router.put('/ajustes', requireRole('admin'), async (req, res) => {
  try {
    const b = req.body || {};
    const entero = (v, min, max, def) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= min && n <= max ? n : def;
    };
    const actuales = await leerAjustes();
    const nuevos = {
      habilitado: b.habilitado === undefined ? actuales.habilitado : (b.habilitado ? 1 : 0),
      limite_enlace_dia: entero(b.limite_enlace_dia, 1, 10000, actuales.limite_enlace_dia),
      limite_telefono_dia: entero(b.limite_telefono_dia, 1, 50, actuales.limite_telefono_dia),
      segundos_minimos: entero(b.segundos_minimos, 0, 120, actuales.segundos_minimos),
    };
    await pool.query(
      `UPDATE inscripcion_config SET habilitado = ?, limite_enlace_dia = ?, limite_telefono_dia = ?, segundos_minimos = ? WHERE id = 1`,
      [nuevos.habilitado, nuevos.limite_enlace_dia, nuevos.limite_telefono_dia, nuevos.segundos_minimos]);
    await registrarAuditoria(req.session.usuario.id, 'ajustes_inscripcion', 'inscripcion_config', 1,
      JSON.stringify(nuevos), req.ip);
    res.json({ ok: true, ajustes: nuevos });
  } catch (err) {
    console.error('inscripcion ajustes:', err.code || err.message);
    res.status(500).json({ error: 'No se pudieron guardar los ajustes.' });
  }
});

module.exports = router;
