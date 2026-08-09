const express = require('express');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { armarWhereSql } = require('../config/filtros');

const router = express.Router();
router.use(requireAuth);

// Solo admin y coordinador pueden ver y gestionar finanzas
router.use(requireRole('admin', 'coordinador'));

router.get('/categorias', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM finanzas_categorias ORDER BY tipo, nombre`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando las categorías.' });
  }
});

// Crea una categoría nueva (usada por la opción "Otro" del formulario de
// movimientos: el usuario escribe un nombre y queda disponible en la lista
// desplegable para movimientos futuros). Si ya existe una con ese nombre y
// tipo, simplemente devuelve su id en vez de duplicarla.
router.post('/categorias', async (req, res) => {
  const { nombre, tipo } = req.body;
  if (!nombre || !nombre.trim() || !['ingreso', 'gasto'].includes(tipo)) {
    return res.status(400).json({ error: 'Nombre y tipo (ingreso/gasto) son obligatorios.' });
  }
  try {
    const [existente] = await pool.query(
      `SELECT id FROM finanzas_categorias WHERE LOWER(nombre) = LOWER(?) AND tipo = ?`,
      [nombre.trim(), tipo]
    );
    if (existente.length) {
      return res.json({ ok: true, id: existente[0].id, yaExistia: true });
    }
    const [result] = await pool.query(
      `INSERT INTO finanzas_categorias (nombre, tipo) VALUES (?, ?)`,
      [nombre.trim(), tipo]
    );
    res.json({ ok: true, id: result.insertId, yaExistia: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creando la categoría.' });
  }
});

router.get('/movimientos', async (req, res) => {
  const { tipo, categoria_id, desde, hasta } = req.query;
  const condiciones = [];
  const params = [];
  if (tipo) { condiciones.push('m.tipo = ?'); params.push(tipo); }
  if (categoria_id) { condiciones.push('m.categoria_id = ?'); params.push(categoria_id); }
  if (desde) { condiciones.push('m.fecha >= ?'); params.push(desde); }
  if (hasta) { condiciones.push('m.fecha <= ?'); params.push(hasta); }
  const whereSql = armarWhereSql(condiciones);

  try {
    const [rows] = await pool.query(
      `SELECT m.*, c.nombre AS categoria_nombre, u.nombre AS registrado_por_nombre
       FROM finanzas_movimientos m
       JOIN finanzas_categorias c ON c.id = m.categoria_id
       JOIN usuarios u ON u.id = m.registrado_por
       ${whereSql}
       ORDER BY m.fecha DESC, m.id DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando movimientos financieros.' });
  }
});

router.get('/resumen', async (req, res) => {
  try {
    const [[totales]] = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto END), 0) AS total_ingresos,
        COALESCE(SUM(CASE WHEN tipo = 'gasto' THEN monto END), 0) AS total_gastos
      FROM finanzas_movimientos
    `);
    const [porCategoria] = await pool.query(`
      SELECT c.nombre, c.tipo, COALESCE(SUM(m.monto),0) AS total, c.tope_legal
      FROM finanzas_categorias c
      LEFT JOIN finanzas_movimientos m ON m.categoria_id = c.id
      GROUP BY c.id ORDER BY c.tipo, total DESC
    `);
    res.json({
      totalIngresos: Number(totales.total_ingresos),
      totalGastos: Number(totales.total_gastos),
      balance: Number(totales.total_ingresos) - Number(totales.total_gastos),
      porCategoria
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generando el resumen financiero.' });
  }
});

/**
 * Exporta un reporte de apoyo para diligenciar Cuentas Claras (el aplicativo
 * del CNE para rendir el informe de ingresos y gastos de campaña) — NO es
 * un archivo para subir directamente al portal: los formatos de importación
 * que publicaba el CNE (cnecuentasclaras.gov.co/formatos.php) ya no están
 * disponibles en esos enlaces al momento de construir esto, así que no hay
 * forma de verificar la plantilla exacta que exige el portal ahora mismo.
 * Lo que sí se puede hacer con certeza es ahorrarle al cliente el trabajo de
 * revisar movimiento por movimiento: acá quedan agrupados por categoría
 * (las categorías de finanzas_categorias ya están alineadas a como el CNE
 * clasifica ingresos/gastos), con el tope legal de cada una al lado, listos
 * para copiar al portal real — hay que confirmar ahí los códigos vigentes.
 */
router.get('/exportar-cuentas-claras', async (req, res) => {
  try {
    const [porCategoria] = await pool.query(`
      SELECT c.nombre, c.tipo, c.tope_legal, COALESCE(SUM(m.monto), 0) AS total
      FROM finanzas_categorias c
      LEFT JOIN finanzas_movimientos m ON m.categoria_id = c.id
      GROUP BY c.id
      ORDER BY c.tipo, c.nombre
    `);
    const [movimientos] = await pool.query(`
      SELECT m.fecha, m.tipo, c.nombre AS categoria, m.tercero, m.documento_tercero, m.descripcion, m.monto
      FROM finanzas_movimientos m
      JOIN finanzas_categorias c ON c.id = m.categoria_id
      ORDER BY c.tipo, c.nombre, m.fecha
    `);

    const resumenColumnas = ['Tipo', 'Categoría', 'Total registrado', 'Tope legal CNE', '% del tope usado'];
    const resumenDatos = porCategoria.map(c => ({
      Tipo: c.tipo === 'ingreso' ? 'Ingreso' : 'Gasto',
      'Categoría': c.nombre,
      'Total registrado': Number(c.total),
      'Tope legal CNE': c.tope_legal !== null ? Number(c.tope_legal) : 'Sin tope registrado',
      '% del tope usado': c.tope_legal ? `${((Number(c.total) / Number(c.tope_legal)) * 100).toFixed(1)}%` : ''
    }));

    const detalleColumnas = ['Fecha', 'Tipo', 'Categoría', 'Tercero', 'Documento tercero', 'Descripción', 'Monto'];
    const detalleDatos = movimientos.map(m => ({
      Fecha: m.fecha,
      Tipo: m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto',
      'Categoría': m.categoria,
      Tercero: m.tercero || '',
      'Documento tercero': m.documento_tercero || '',
      'Descripción': m.descripcion || '',
      Monto: Number(m.monto)
    }));

    const notasDatos = [
      ['Este archivo es un apoyo para diligenciar Cuentas Claras (cnecuentasclaras.gov.co) — NO es un archivo para subir directamente al portal.'],
      ['Verifica en el portal los códigos y el formato vigentes antes de radicar el informe oficial; el CNE actualiza estas reglas entre ciclos electorales.'],
      [`Generado el ${new Date().toLocaleDateString('es-CO')} desde Estrategia · Administración de campaña.`]
    ];

    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      libro,
      resumenDatos.length ? XLSX.utils.json_to_sheet(resumenDatos, { header: resumenColumnas }) : XLSX.utils.aoa_to_sheet([resumenColumnas]),
      'Resumen por categoría'
    );
    XLSX.utils.book_append_sheet(
      libro,
      detalleDatos.length ? XLSX.utils.json_to_sheet(detalleDatos, { header: detalleColumnas }) : XLSX.utils.aoa_to_sheet([detalleColumnas]),
      'Detalle de movimientos'
    );
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(notasDatos), 'Notas');

    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="finanzas-cuentas-claras.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generando el reporte para Cuentas Claras.' });
  }
});

router.post('/movimientos', upload.single('comprobante'), async (req, res) => {
  const b = req.body;
  if (!b.categoria_id || !b.tipo || !b.monto || !b.fecha) {
    return res.status(400).json({ error: 'Categoría, tipo, monto y fecha son obligatorios.' });
  }
  const comprobanteUrl = req.file ? `/uploads/${req.file.filename}` : null;
  try {
    const [result] = await pool.query(
      `INSERT INTO finanzas_movimientos
       (categoria_id, tipo, monto, descripcion, tercero, documento_tercero, fecha, comprobante_url, territorio_id, registrado_por)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [b.categoria_id, b.tipo, b.monto, b.descripcion || null, b.tercero || null,
       b.documento_tercero || null, b.fecha, comprobanteUrl, b.territorio_id || null, req.session.usuario.id]
    );
    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error registrando el movimiento.' });
  }
});

router.delete('/movimientos/:id', requireRole('admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM finanzas_movimientos WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error eliminando el movimiento.' });
  }
});

module.exports = router;
