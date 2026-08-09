const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { armarWhereSql } = require('../config/filtros');

const router = express.Router();
router.use(requireAuth);

/* ---------------------- Calendario de publicaciones ---------------------- */

router.get('/publicaciones', async (req, res) => {
  const { estado, red_social } = req.query;
  const condiciones = [];
  const params = [];
  if (estado) { condiciones.push('estado = ?'); params.push(estado); }
  if (red_social) { condiciones.push('red_social = ?'); params.push(red_social); }
  const whereSql = armarWhereSql(condiciones);
  try {
    const [rows] = await pool.query(
      `SELECT p.*, u.nombre AS creado_por_nombre FROM redes_publicaciones p
       JOIN usuarios u ON u.id = p.created_by ${whereSql} ORDER BY fecha_programada ASC`, params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando las publicaciones.' });
  }
});

router.post('/publicaciones', requireRole('admin', 'coordinador'), async (req, res) => {
  const b = req.body;
  if (!b.titulo || !b.red_social) return res.status(400).json({ error: 'Título y red social son obligatorios.' });
  try {
    const [result] = await pool.query(
      `INSERT INTO redes_publicaciones (titulo, red_social, contenido, fecha_programada, estado, created_by)
       VALUES (?,?,?,?,?,?)`,
      [b.titulo, b.red_social, b.contenido || null, b.fecha_programada || null, b.estado || 'borrador', req.session.usuario.id]
    );
    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creando la publicación.' });
  }
});

router.put('/publicaciones/:id', requireRole('admin', 'coordinador'), async (req, res) => {
  const b = req.body;
  if (!b.titulo || !b.red_social) return res.status(400).json({ error: 'Título y red social son obligatorios.' });
  try {
    await pool.query(
      `UPDATE redes_publicaciones SET titulo=?, red_social=?, contenido=?, fecha_programada=?, estado=?,
       url_publicacion=?, metricas_alcance=?, metricas_interacciones=? WHERE id=?`,
      [b.titulo, b.red_social, b.contenido || null, b.fecha_programada || null, b.estado || 'borrador',
       b.url_publicacion || null, b.metricas_alcance || 0, b.metricas_interacciones || 0, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error actualizando la publicación.' });
  }
});

router.delete('/publicaciones/:id', requireRole('admin', 'coordinador'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM redes_publicaciones WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error eliminando la publicación.' });
  }
});

/* ---------------------- Monitoreo de menciones / opinión ---------------------- */

router.get('/menciones', async (req, res) => {
  const { sentimiento } = req.query;
  const whereSql = sentimiento ? 'WHERE sentimiento = ?' : '';
  const params = sentimiento ? [sentimiento] : [];
  try {
    const [rows] = await pool.query(
      `SELECT * FROM monitoreo_menciones ${whereSql} ORDER BY fecha_deteccion DESC LIMIT 200`, params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando las menciones.' });
  }
});

router.get('/menciones/resumen', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT sentimiento, COUNT(*) AS total FROM monitoreo_menciones GROUP BY sentimiento`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando el resumen de menciones.' });
  }
});

router.post('/menciones', requireRole('admin', 'coordinador'), async (req, res) => {
  const b = req.body;
  if (!b.fuente || !b.texto) return res.status(400).json({ error: 'Fuente y texto son obligatorios.' });
  try {
    const [result] = await pool.query(
      `INSERT INTO monitoreo_menciones (fuente, texto, sentimiento, url, registrado_por) VALUES (?,?,?,?,?)`,
      [b.fuente, b.texto, b.sentimiento || 'neutro', b.url || null, req.session.usuario.id]
    );
    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error registrando la mención.' });
  }
});

router.delete('/menciones/:id', requireRole('admin', 'coordinador'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM monitoreo_menciones WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error eliminando la mención.' });
  }
});

module.exports = router;
