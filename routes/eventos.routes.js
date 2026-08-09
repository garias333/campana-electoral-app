const express = require('express');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { geocodificarConTerritorio } = require('../config/geoTerritorio');
const { armarWhereSql } = require('../config/filtros');
const { registrarAuditoria } = require('../config/auditoria');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { desde, hasta, tipo, territorio_id } = req.query;
  const condiciones = [];
  const params = [];
  if (desde) { condiciones.push('e.fecha_inicio >= ?'); params.push(desde); }
  if (hasta) { condiciones.push('e.fecha_inicio <= ?'); params.push(hasta); }
  if (tipo) { condiciones.push('e.tipo = ?'); params.push(tipo); }
  if (territorio_id) { condiciones.push('e.territorio_id = ?'); params.push(territorio_id); }
  const whereSql = armarWhereSql(condiciones);

  try {
    const [rows] = await pool.query(
      `SELECT e.*, t.nombre AS territorio_nombre, u.nombre AS responsable_nombre,
              coord.nombre AS coordinador_nombre, lid.nombre AS lider_nombre,
              (SELECT COUNT(*) FROM evento_asistentes ea WHERE ea.evento_id = e.id) AS total_invitados,
              (SELECT COUNT(*) FROM evento_asistentes ea WHERE ea.evento_id = e.id AND ea.asistio = 1) AS total_asistio
       FROM eventos e
       LEFT JOIN territorios t ON t.id = e.territorio_id
       LEFT JOIN usuarios u ON u.id = e.responsable_id
       LEFT JOIN usuarios coord ON coord.id = e.coordinador_id
       LEFT JOIN usuarios lid ON lid.id = e.lider_id
       ${whereSql}
       ORDER BY ABS(TIMESTAMPDIFF(SECOND, NOW(), e.fecha_inicio)) ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando eventos.' });
  }
});

router.get('/:id/asistentes', async (req, res) => {
  try {
    // Un asistente puede venir de tres fuentes: un votante registrado, un
    // usuario del sistema (líder, coordinador...) sin fila propia en
    // Votantes, o un invitado escrito a mano — se resuelve un solo
    // nombre/teléfono/identidad/barrio para mostrar, sea cual sea la
    // fuente. El Barrio del votante sale de Estructura territorial (vía
    // territorio_id); el del usuario ya es texto libre en su propia ficha.
    const [rows] = await pool.query(
      `SELECT ea.*,
              COALESCE(v.nombre, u.nombre, ea.nombre_invitado) AS nombre_resuelto,
              COALESCE(v.telefono, u.telefono) AS telefono_resuelto,
              COALESCE(v.cedula, u.numero_identificacion) AS identidad_resuelta,
              COALESCE(tv.nombre, u.barrio_residencia) AS barrio_resuelto
       FROM evento_asistentes ea
       LEFT JOIN votantes v ON v.id = ea.votante_id
       LEFT JOIN usuarios u ON u.id = ea.usuario_id
       LEFT JOIN territorios tv ON tv.id = v.territorio_id
       WHERE ea.evento_id = ?`, [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando los asistentes del evento.' });
  }
});

/**
 * Trae, para CADA asistencia registrada en cualquier reunión/evento, a qué
 * persona corresponde (mismo criterio de resolución que GET /:id/asistentes)
 * y la agrupa por persona — así se puede ver de un vistazo a qué reuniones
 * ha ido cada quien, y detectar quién repite. Sin cédula (un invitado
 * escrito a mano, sin votante ni usuario asociado), se agrupa por el
 * nombre ya normalizado — es la única pista de identidad que hay para esos
 * casos, así que dos invitados con el mismo nombre pueden aparecer juntos
 * aunque en la vida real sean personas distintas.
 */
async function obtenerConsolidadoAsistentes() {
  const [filas] = await pool.query(
    `SELECT e.id AS evento_id, e.titulo AS evento_titulo, e.fecha_inicio AS evento_fecha,
            COALESCE(v.cedula, u.numero_identificacion) AS identidad_resuelta,
            COALESCE(v.nombre, u.nombre, ea.nombre_invitado) AS nombre_resuelto,
            COALESCE(v.telefono, u.telefono) AS telefono_resuelto,
            COALESCE(tv.nombre, u.barrio_residencia) AS barrio_resuelto
     FROM evento_asistentes ea
     JOIN eventos e ON e.id = ea.evento_id
     LEFT JOIN votantes v ON v.id = ea.votante_id
     LEFT JOIN usuarios u ON u.id = ea.usuario_id
     LEFT JOIN territorios tv ON tv.id = v.territorio_id
     ORDER BY e.fecha_inicio ASC`
  );

  const grupos = new Map();
  for (const f of filas) {
    const clave = f.identidad_resuelta || `inv:${(f.nombre_resuelto || '').trim().toLowerCase()}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        nombre: f.nombre_resuelto, identidad: f.identidad_resuelta,
        telefono: f.telefono_resuelto, barrio: f.barrio_resuelto, reuniones: []
      });
    }
    grupos.get(clave).reuniones.push({ evento_id: f.evento_id, titulo: f.evento_titulo, fecha: f.evento_fecha });
  }

  return [...grupos.values()]
    .map(g => ({ ...g, total_reuniones: g.reuniones.length }))
    .sort((a, b) => b.total_reuniones - a.total_reuniones || (a.nombre || '').localeCompare(b.nombre || ''));
}

router.get('/asistentes-consolidado', async (req, res) => {
  try {
    res.json(await obtenerConsolidadoAsistentes());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consolidando los asistentes.' });
  }
});

router.get('/asistentes-consolidado/exportar-excel', async (req, res) => {
  try {
    const consolidado = await obtenerConsolidadoAsistentes();
    const columnas = ['Nombre', 'Identidad', 'Teléfono', 'Barrio', 'Total de reuniones', 'Reuniones (fecha - título)'];
    const datos = consolidado.map(p => ({
      'Nombre': p.nombre || '',
      'Identidad': p.identidad || '',
      'Teléfono': p.telefono || '',
      'Barrio': p.barrio || '',
      'Total de reuniones': p.total_reuniones,
      'Reuniones (fecha - título)': p.reuniones
        .map(r => `${new Date(r.fecha).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })} - ${r.titulo}`)
        .join('; ')
    }));
    const hoja = datos.length
      ? XLSX.utils.json_to_sheet(datos, { header: columnas })
      : XLSX.utils.aoa_to_sheet([columnas]);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Consolidado asistentes');
    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="consolidado-asistentes.xlsx"');
    await registrarAuditoria(
      req.session.usuario.id, 'exportar_excel', 'evento_asistentes', null,
      `Exportó el consolidado de asistentes a reuniones (${consolidado.length} persona(s)).`, req.ip
    );
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error exportando el consolidado de asistentes.' });
  }
});

router.post('/', requireRole('admin', 'coordinador', 'lider'), async (req, res) => {
  const b = req.body;
  if (!b.titulo || !b.fecha_inicio) {
    return res.status(400).json({ error: 'Título y fecha de inicio son obligatorios.' });
  }
  let eventoId;
  try {
    const [result] = await pool.query(
      `INSERT INTO eventos (titulo, descripcion, tipo, fecha_inicio, fecha_fin, lugar, departamento, ciudad,
       territorio_id, area, responsable_id, coordinador_id, lider_id, meta_asistentes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.titulo, b.descripcion || null, b.tipo || 'reunion', b.fecha_inicio, b.fecha_fin || null,
       b.lugar || null, b.departamento || null, b.ciudad || null, b.territorio_id || null, b.area || null,
       b.responsable_id || req.session.usuario.id, b.coordinador_id || null, b.lider_id || null,
       b.meta_asistentes || 0, req.session.usuario.id]
    );
    eventoId = result.insertId;
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error creando el evento.' });
  }

  // La georreferenciación del lugar de la reunión se hace después de crear
  // el evento, y nunca hace fallar la creación aunque el servicio no responda.
  const geo = await geocodificarConTerritorio(b.lugar, b.territorio_id, b.ciudad, b.departamento);
  if (geo) {
    try {
      await pool.query(
        `UPDATE eventos SET latitud = ?, longitud = ?, geocodificado_en = NOW() WHERE id = ?`,
        [geo.latitud, geo.longitud, eventoId]
      );
    } catch (err) {
      console.error('Error guardando la geocodificación del evento:', err);
    }
  }
  res.json({ ok: true, id: eventoId, geocodificado: !!geo });
});

router.put('/:id', requireRole('admin', 'coordinador', 'lider'), async (req, res) => {
  const b = req.body;
  if (!b.titulo || !b.fecha_inicio) {
    return res.status(400).json({ error: 'Título y fecha de inicio son obligatorios.' });
  }
  try {
    const [[anterior]] = await pool.query(
      `SELECT lugar, territorio_id FROM eventos WHERE id = ?`, [req.params.id]
    );

    await pool.query(
      `UPDATE eventos SET titulo=?, descripcion=?, tipo=?, fecha_inicio=?, fecha_fin=?, lugar=?,
       departamento=?, ciudad=?, territorio_id=?, area=?, responsable_id=?, coordinador_id=?, lider_id=?,
       meta_asistentes=?, estado=?
       WHERE id=?`,
      [b.titulo, b.descripcion || null, b.tipo, b.fecha_inicio, b.fecha_fin || null, b.lugar || null,
       b.departamento || null, b.ciudad || null,
       b.territorio_id || null, b.area || null, b.responsable_id || null, b.coordinador_id || null,
       b.lider_id || null, b.meta_asistentes || 0, b.estado || 'programado', req.params.id]
    );

    const cambioUbicacion = anterior && (
      (b.lugar || '') !== (anterior.lugar || '') ||
      Number(b.territorio_id || 0) !== Number(anterior.territorio_id || 0)
    );
    if (cambioUbicacion) {
      const geo = await geocodificarConTerritorio(b.lugar, b.territorio_id, b.ciudad, b.departamento);
      if (geo) {
        await pool.query(
          `UPDATE eventos SET latitud = ?, longitud = ?, geocodificado_en = NOW() WHERE id = ?`,
          [geo.latitud, geo.longitud, req.params.id]
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error actualizando el evento.' });
  }
});

router.delete('/:id', requireRole('admin', 'coordinador'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM eventos WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error eliminando el evento.' });
  }
});

router.post('/:id/asistentes', requireRole('admin', 'coordinador', 'lider'), async (req, res) => {
  const { votante_id, usuario_id, nombre_invitado } = req.body;
  if (!votante_id && !usuario_id && !nombre_invitado) {
    return res.status(400).json({ error: 'Debe indicar un votante existente, un usuario del sistema o el nombre del invitado.' });
  }
  try {
    const [result] = await pool.query(
      `INSERT INTO evento_asistentes (evento_id, votante_id, usuario_id, nombre_invitado) VALUES (?,?,?,?)`,
      [req.params.id, votante_id || null, usuario_id || null, nombre_invitado || null]
    );
    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error agregando el asistente.' });
  }
});

router.put('/asistentes/:asistenteId', requireRole('admin', 'coordinador', 'lider'), async (req, res) => {
  const { confirmado, asistio } = req.body;
  try {
    await pool.query(
      `UPDATE evento_asistentes SET confirmado = ?, asistio = ? WHERE id = ?`,
      [confirmado ? 1 : 0, asistio ? 1 : 0, req.params.asistenteId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error actualizando el asistente.' });
  }
});

router.delete('/asistentes/:asistenteId', requireRole('admin', 'coordinador', 'lider'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM evento_asistentes WHERE id = ?`, [req.params.asistenteId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error quitando el asistente.' });
  }
});

/**
 * Verifica que la contraseña dada sea la de algún administrador activo.
 * Solo se pide para "Corregir ubicaciones existentes", que reescribe
 * coordenadas ya calculadas — mismo criterio que en Votantes y Estructura.
 */
async function verificarPasswordAdmin(password) {
  if (!password) return false;
  const [admins] = await pool.query(
    `SELECT u.password_hash FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.nombre = 'admin' AND u.activo = 1`
  );
  for (const admin of admins) {
    if (await bcrypt.compare(password, admin.password_hash)) return true;
  }
  return false;
}

/**
 * Vuelve a intentar geocodificar los eventos que tienen Dirección guardada
 * pero nunca quedaron georreferenciados. Mismo mecanismo que en Votantes y
 * Estructura: lotes pequeños con pausa entre solicitudes, para respetar el
 * límite de Nominatim (~1 por segundo) y no agotar el tiempo de una sola
 * petición.
 *
 * A diferencia de los otros dos, aquí la dirección se completa con el
 * Departamento y la Ciudad **del evento**, no los de la campaña: un evento
 * puede ser fuera de la ciudad sede, y sin ese dato la misma dirección
 * resolvería al municipio equivocado.
 */
router.post('/regeocodificar-pendientes', requireRole('admin'), async (req, res) => {
  const tamanoLote = Math.min(Math.max(parseInt(req.query.lote) || 5, 1), 20);
  const despuesDe = parseInt(req.query.despues_de) || 0;
  const incluirTodos = req.query.todos === '1';

  if (incluirTodos) {
    const autorizado = await verificarPasswordAdmin(req.body && req.body.password);
    if (!autorizado) {
      return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
    }
  }

  try {
    const condicionGeocodificado = incluirTodos ? '' : ' AND geocodificado_en IS NULL';
    const filtro = `lugar IS NOT NULL AND lugar != '' AND id > ?${condicionGeocodificado}`;

    const [pendientes] = await pool.query(
      `SELECT id, lugar, territorio_id, departamento, ciudad FROM eventos
        WHERE ${filtro} ORDER BY id LIMIT ?`, [despuesDe, tamanoLote]);

    const [[{ totalPendientesDespues }]] = await pool.query(
      `SELECT COUNT(*) AS totalPendientesDespues FROM eventos WHERE ${filtro}`, [despuesDe]);

    let geocodificados = 0;
    const fallidos = [];
    let cursorSiguiente = despuesDe;
    for (const fila of pendientes) {
      try {
        const geo = await geocodificarConTerritorio(fila.lugar, fila.territorio_id, fila.ciudad, fila.departamento);
        if (geo) {
          await pool.query(
            `UPDATE eventos SET latitud = ?, longitud = ?, geocodificado_en = NOW() WHERE id = ?`,
            [geo.latitud, geo.longitud, fila.id]
          );
          geocodificados++;
        } else {
          fallidos.push(fila.id);
        }
      } catch (err) {
        console.error(`Error re-geocodificando evento id ${fila.id}:`, err);
        fallidos.push(fila.id);
      }
      cursorSiguiente = fila.id;
      await new Promise(resolve => setTimeout(resolve, 1200));
    }

    res.json({
      ok: true,
      procesados: pendientes.length,
      geocodificados,
      fallidos: fallidos.length,
      idsFallidos: fallidos,
      cursorSiguiente,
      quedanPendientes: Math.max(0, totalPendientesDespues - pendientes.length)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error re-geocodificando pendientes.' });
  }
});

module.exports = router;
