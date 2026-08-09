const express = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { upload, UPLOAD_DIR } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

/**
 * Regla de negocio de esta sección:
 * - Cualquier usuario autenticado puede LISTAR y DESCARGAR recursos publicados.
 * - Solo el rol "admin" puede SUBIR y ELIMINAR recursos.
 */

router.get('/', async (req, res) => {
  const { tipo } = req.query;
  const whereSql = tipo ? 'WHERE tipo = ? AND publicado = 1' : 'WHERE publicado = 1';
  const params = tipo ? [tipo] : [];
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.titulo, r.tipo, r.descripcion, r.archivo_nombre, r.archivo_url,
              r.archivo_mime, r.archivo_tamano_kb, r.enlace_externo, r.fecha_evento,
              r.created_at, u.nombre AS subido_por_nombre
       FROM recursos r JOIN usuarios u ON u.id = r.subido_por
       ${whereSql} ORDER BY r.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando los recursos.' });
  }
});

// Descarga controlada (cualquier usuario autenticado, sin exponer la ruta física directa)
router.get('/:id/descargar', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM recursos WHERE id = ? AND publicado = 1`, [req.params.id]);
    if (!rows.length || !rows[0].archivo_nombre) {
      return res.status(404).json({ error: 'Recurso no encontrado.' });
    }
    const recurso = rows[0];
    const filePath = path.join(UPLOAD_DIR, path.basename(recurso.archivo_url));
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'El archivo ya no está disponible en el servidor.' });
    }
    res.download(filePath, recurso.archivo_nombre);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al descargar el recurso.' });
  }
});

// Solo admin: subir un nuevo recurso
router.post('/', requireRole('admin'), upload.single('archivo'), async (req, res) => {
  const b = req.body;
  if (!b.titulo || !b.tipo) {
    return res.status(400).json({ error: 'Título y tipo de recurso son obligatorios.' });
  }
  if (!req.file && !b.enlace_externo) {
    return res.status(400).json({ error: 'Debe adjuntar un archivo o proporcionar un enlace externo (p. ej. video de YouTube).' });
  }
  try {
    const [result] = await pool.query(
      `INSERT INTO recursos
       (titulo, tipo, descripcion, archivo_nombre, archivo_url, archivo_mime, archivo_tamano_kb,
        enlace_externo, fecha_evento, subido_por)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        b.titulo, b.tipo, b.descripcion || null,
        req.file ? req.file.originalname : null,
        req.file ? `/uploads/${req.file.filename}` : null,
        req.file ? req.file.mimetype : null,
        req.file ? Math.round(req.file.size / 1024) : null,
        b.enlace_externo || null,
        b.fecha_evento || null,
        req.session.usuario.id
      ]
    );
    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error subiendo el recurso.' });
  }
});

// Solo admin: editar un recurso existente. El archivo es opcional — si
// se sube uno nuevo, reemplaza al anterior (y se borra el viejo del
// disco); si no se sube nada, se conserva el archivo que ya tenía.
router.put('/:id', requireRole('admin'), upload.single('archivo'), async (req, res) => {
  const b = req.body;
  if (!b.titulo || !b.tipo) {
    return res.status(400).json({ error: 'Título y tipo de recurso son obligatorios.' });
  }
  try {
    const [rows] = await pool.query(`SELECT * FROM recursos WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Recurso no encontrado.' });
    const anterior = rows[0];

    const nuevoArchivo = !!req.file;
    if (!nuevoArchivo && !anterior.archivo_url && !(b.enlace_externo || anterior.enlace_externo)) {
      return res.status(400).json({ error: 'Debe conservar el archivo, subir uno nuevo, o proporcionar un enlace externo.' });
    }

    await pool.query(
      `UPDATE recursos SET
         titulo = ?, tipo = ?, descripcion = ?,
         archivo_nombre = ?, archivo_url = ?, archivo_mime = ?, archivo_tamano_kb = ?,
         enlace_externo = ?, fecha_evento = ?
       WHERE id = ?`,
      [
        b.titulo, b.tipo, b.descripcion || null,
        nuevoArchivo ? req.file.originalname : anterior.archivo_nombre,
        nuevoArchivo ? `/uploads/${req.file.filename}` : anterior.archivo_url,
        nuevoArchivo ? req.file.mimetype : anterior.archivo_mime,
        nuevoArchivo ? Math.round(req.file.size / 1024) : anterior.archivo_tamano_kb,
        b.enlace_externo || null,
        b.fecha_evento || null,
        req.params.id
      ]
    );

    if (nuevoArchivo && anterior.archivo_url) {
      const rutaAnterior = path.join(UPLOAD_DIR, path.basename(anterior.archivo_url));
      if (fs.existsSync(rutaAnterior)) fs.unlinkSync(rutaAnterior);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error actualizando el recurso.' });
  }
});

// Solo admin: eliminar un recurso (y su archivo físico)
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM recursos WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Recurso no encontrado.' });

    const recurso = rows[0];
    if (recurso.archivo_url) {
      const filePath = path.join(UPLOAD_DIR, path.basename(recurso.archivo_url));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await pool.query(`DELETE FROM recursos WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error eliminando el recurso.' });
  }
});

module.exports = router;
