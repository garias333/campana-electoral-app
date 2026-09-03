const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { huellaDePolitica, archivarVersion } = require('../config/politicaVersiones');

const router = express.Router();
router.use(requireAuth);

// Claves válidas — cualquier página nueva de este mismo estilo (un solo
// bloque de texto editable) se agrega simplemente sumándola aquí.
const CLAVES_VALIDAS = ['biografia_candidato', 'politica_privacidad'];

const TITULOS_POR_DEFECTO = {
  biografia_candidato: 'Biografía del candidato',
  politica_privacidad: 'Política de privacidad'
};

function validarClave(clave, res) {
  if (!CLAVES_VALIDAS.includes(clave)) {
    res.status(404).json({ error: 'Página de contenido no encontrada.' });
    return false;
  }
  return true;
}

// --- Subida de Foto y Video (por ahora solo la usa Biografía del
// candidato, pero queda disponible para cualquier página de este estilo) ---
const CARPETA_UPLOADS = path.join(__dirname, '..', 'uploads', 'contenido');
fs.mkdirSync(CARPETA_UPLOADS, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CARPETA_UPLOADS),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${req.params.clave}-${file.fieldname}-${Date.now()}${ext}`);
  }
});
const uploadFoto = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => cb(file.mimetype.startsWith('image/') ? null : new Error('Tipo de archivo no permitido: la foto debe ser una imagen.'), true)
});
const uploadVideo = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB — un video de campaña puede pesar bastante
  fileFilter: (req, file, cb) => cb(file.mimetype.startsWith('video/') ? null : new Error('Tipo de archivo no permitido: el video debe ser un archivo de video.'), true)
});

/** Borra del disco el archivo anterior (si había uno) para no acumular basura cada vez que se reemplaza. */
function borrarArchivoAnterior(url) {
  if (!url) return;
  const ruta = path.join(CARPETA_UPLOADS, path.basename(url));
  fs.unlink(ruta, () => {}); // si falla (ya no existe, etc.), no es un problema real
}

router.post('/:clave/foto', requireRole('admin'), uploadFoto.single('foto'), async (req, res) => {
  const { clave } = req.params;
  if (!validarClave(clave, res)) return;
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna foto.' });
  try {
    const [[filaActual]] = await pool.query(`SELECT foto_url FROM contenido_paginas WHERE clave = ?`, [clave]);
    const url = `/uploads/contenido/${req.file.filename}`;
    await pool.query(
      `INSERT INTO contenido_paginas (clave, titulo, foto_url, actualizado_por) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE foto_url = VALUES(foto_url), actualizado_por = VALUES(actualizado_por)`,
      [clave, TITULOS_POR_DEFECTO[clave] || null, url, req.session.usuario.id]
    );
    if (filaActual) borrarArchivoAnterior(filaActual.foto_url);
    res.json({ ok: true, foto_url: url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error guardando la foto.' });
  }
});

router.post('/:clave/video', requireRole('admin'), uploadVideo.single('video'), async (req, res) => {
  const { clave } = req.params;
  if (!validarClave(clave, res)) return;
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún video.' });
  try {
    const [[filaActual]] = await pool.query(`SELECT video_url FROM contenido_paginas WHERE clave = ?`, [clave]);
    const url = `/uploads/contenido/${req.file.filename}`;
    await pool.query(
      `INSERT INTO contenido_paginas (clave, titulo, video_url, actualizado_por) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE video_url = VALUES(video_url), actualizado_por = VALUES(actualizado_por)`,
      [clave, TITULOS_POR_DEFECTO[clave] || null, url, req.session.usuario.id]
    );
    if (filaActual) borrarArchivoAnterior(filaActual.video_url);
    res.json({ ok: true, video_url: url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error guardando el video.' });
  }
});

// Quita la foto o el video (sin reemplazarlo por otro).
router.delete('/:clave/:tipo(foto|video)', requireRole('admin'), async (req, res) => {
  const { clave, tipo } = req.params;
  if (!validarClave(clave, res)) return;
  const columna = tipo === 'foto' ? 'foto_url' : 'video_url';
  try {
    const [[filaActual]] = await pool.query(`SELECT ${columna} FROM contenido_paginas WHERE clave = ?`, [clave]);
    await pool.query(`UPDATE contenido_paginas SET ${columna} = NULL WHERE clave = ?`, [clave]);
    if (filaActual) borrarArchivoAnterior(filaActual[columna]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error quitando el ${tipo}.` });
  }
});

// EL ARCHIVO, PARA PODER EXHIBIRLO. De nada sirve guardar la huella si nadie
// puede recuperar el texto al que apunta: esto es lo que convierte
// `votantes.consentimiento_version` en una prueba que se puede enseñar.
// Va antes de /:clave, aunque esa ruta solo casa un segmento y no lo taparía.
router.get('/politica/versiones', requireRole('admin'), async (req, res) => {
  try {
    const [filas] = await pool.query(
      `SELECT v.huella, v.titulo, v.archivada_en, v.archivada_por_nombre,
              CHAR_LENGTH(v.contenido) AS largo,
              (SELECT COUNT(*) FROM votantes t WHERE t.consentimiento_version = v.huella) AS votantes
         FROM politica_versiones v
        WHERE v.clave = 'politica_privacidad'
        ORDER BY v.archivada_en DESC`
    );
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error listando las versiones de la política.' });
  }
});

router.get('/politica/versiones/:huella', requireRole('admin'), async (req, res) => {
  const { huella } = req.params;
  if (!/^[0-9a-f]{16}$/.test(huella || '')) {
    return res.status(400).json({ error: 'Huella no válida.' });
  }
  try {
    const [[fila]] = await pool.query(
      `SELECT huella, titulo, contenido, archivada_en, archivada_por_nombre
         FROM politica_versiones WHERE huella = ? AND clave = 'politica_privacidad'`,
      [huella]
    );
    if (!fila) return res.status(404).json({ error: 'Esa versión no está archivada.' });
    res.json(fila);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo la versión.' });
  }
});

// Trae el contenido de una página. Si nunca se ha guardado nada, responde
// con un título por defecto y contenido vacío (no 404), para que la
// pantalla arranque en blanco lista para editar.
router.get('/:clave', async (req, res) => {
  const { clave } = req.params;
  if (!validarClave(clave, res)) return;
  try {
    const [[fila]] = await pool.query(`SELECT * FROM contenido_paginas WHERE clave = ?`, [clave]);
    const salida = fila || { clave, titulo: TITULOS_POR_DEFECTO[clave] || '', contenido: '' };
    // `version` es una huella corta del texto. La usa el formulario de captura
    // para guardar, junto a la autorización de cada persona, QUÉ texto se le
    // mostró: sin eso, dentro de un año no se puede demostrar a qué dijo que
    // sí, porque la política pudo cambiar diez veces desde entonces.
    // Se calcula aquí y no en el navegador para que sea la misma para todos y
    // no dependa de la versión del teléfono.
    salida.version = huellaDePolitica(salida.contenido);
    res.json(salida);
    // SE ARCHIVA AL ENTREGARLO, no solo al guardarlo. Si solo se archivara en
    // el PUT, el texto que ya estaba escrito antes de que existiera el archivo
    // no entraría nunca — y es justo el que firmaron todos los votantes
    // registrados hasta hoy. Va después del res.json a propósito: nadie debe
    // esperar por esto, y si falla, la pantalla igual funciona.
    if (clave === 'politica_privacidad' && salida.contenido) {
      archivarVersion({
        clave, titulo: salida.titulo, contenido: salida.contenido,
        usuarioId: null, usuarioNombre: 'archivado al entregarse'
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo el contenido.' });
  }
});

// Crea o actualiza (upsert) el contenido de una página. Solo admin.
router.put('/:clave', requireRole('admin'), async (req, res) => {
  const { clave } = req.params;
  if (!validarClave(clave, res)) return;
  const { titulo, contenido } = req.body;
  try {
    await pool.query(
      `INSERT INTO contenido_paginas (clave, titulo, contenido, actualizado_por)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE titulo = VALUES(titulo), contenido = VALUES(contenido), actualizado_por = VALUES(actualizado_por)`,
      [clave, (titulo || '').trim() || TITULOS_POR_DEFECTO[clave] || null, contenido || '', req.session.usuario.id]
    );
    // Se archiva DESPUÉS de guardar y ANTES de responder: si el archivo
    // falla no rompe nada (archivarVersion no lanza), pero mientras funcione
    // ninguna versión de la política puede quedar guardada sin copia.
    if (clave === 'politica_privacidad') {
      await archivarVersion({
        clave,
        titulo: (titulo || '').trim() || TITULOS_POR_DEFECTO[clave] || null,
        contenido: contenido || '',
        usuarioId: req.session.usuario.id,
        usuarioNombre: req.session.usuario.nombre || null
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error guardando el contenido.' });
  }
});

// Da un mensaje claro cuando el archivo excede el límite de tamaño (por
// defecto, ese error de Multer llega como "File too large", que no dice
// nada útil) — se define DESPUÉS de las rutas de este router, para que
// solo capture errores de las subidas de acá.
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'El archivo es demasiado grande (revisa el límite indicado junto al campo).' });
  }
  next(err);
});

module.exports = router;
