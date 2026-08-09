const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { sqlMetaEfectiva } = require('../config/metasEstructura');

const router = express.Router();
router.use(requireAuth);

router.get('/resumen', async (req, res) => {
  try {
    const [[estructura]] = await pool.query(`
      SELECT
        COUNT(CASE WHEN cargo='coordinador' THEN 1 END) AS coordinadores,
        COUNT(CASE WHEN cargo='lider' THEN 1 END) AS lideres,
        COUNT(CASE WHEN cargo='testigo' THEN 1 END) AS testigos
      FROM estructura WHERE activo = 1
    `);
    const [[votantes]] = await pool.query(`
      SELECT COUNT(*) AS total,
        COUNT(CASE WHEN intencion_voto='confirmado' THEN 1 END) AS confirmados,
        COUNT(CASE WHEN intencion_voto='probable' THEN 1 END) AS probables,
        COUNT(CASE WHEN intencion_voto='indeciso' THEN 1 END) AS indecisos
      FROM votantes
    `);
    // Meta de votos = suma de la meta de votos que cada Líder tiene
    // registrada. Avance de registros = suma de los votantes/contactos que
    // tienen como Líder a cada uno de ellos (lo que han "aportado" en total).
    const [[metaYAvanceLideres]] = await pool.query(`
      SELECT
        COALESCE((SELECT SUM(meta_votos) FROM estructura WHERE cargo IN ('lider','usuario') AND activo = 1), 0) AS meta_votos_lideres,
        (
          SELECT COUNT(*) FROM votantes v
          WHERE v.lider_id IN (SELECT usuario_id FROM estructura WHERE cargo IN ('lider','usuario') AND activo = 1)
        ) AS avance_registros_lideres
    `);
    const [[finanzas]] = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo='ingreso' THEN monto END),0) AS ingresos,
        COALESCE(SUM(CASE WHEN tipo='gasto' THEN monto END),0) AS gastos
      FROM finanzas_movimientos
    `);
    const [[eventos]] = await pool.query(`
      SELECT
        COUNT(CASE WHEN fecha_inicio >= NOW() AND estado='programado' THEN 1 END) AS proximos,
        COUNT(CASE WHEN estado='realizado' THEN 1 END) AS realizados
      FROM eventos
    `);
    const [proximosEventos] = await pool.query(`
      SELECT id, titulo, tipo, fecha_inicio, lugar FROM eventos
      WHERE fecha_inicio >= NOW() AND estado = 'programado'
      ORDER BY fecha_inicio ASC LIMIT 5
    `);
    const [menciones] = await pool.query(`
      SELECT sentimiento, COUNT(*) AS total FROM monitoreo_menciones GROUP BY sentimiento
    `);

    // "Apoya a": cuenta personas (de Estructura + Votantes, combinado) que
    // tengan marcado cada cargo. Como cualquier persona de Estructura con
    // cédula se sincroniza automáticamente hacia Votantes, contar los dos
    // orígenes sin cuidado duplicaría a esas personas — por eso, del lado
    // de Votantes, se excluyen los que vinieron de esa sincronización
    // (origen = 'estructura'), ya que esos ya se cuentan del lado de
    // Estructura. Así cada persona real se cuenta una sola vez.
    const CARGOS_APOYA = ['alcaldia', 'concejo', 'jal', 'gobernacion', 'asamblea'];
    const [[apoyaAFila]] = await pool.query(`
      SELECT
        ${CARGOS_APOYA.map(c => `
          (
            (SELECT COUNT(*) FROM estructura e JOIN usuarios u ON u.id = e.usuario_id
             WHERE e.activo = 1 AND JSON_CONTAINS(u.apoya_a, '"${c}"'))
            +
            (SELECT COUNT(*) FROM votantes v
             WHERE v.origen <> 'estructura' AND JSON_CONTAINS(v.apoya_a, '"${c}"'))
          ) AS ${c}
        `).join(',')}
    `);
    const apoyaA = {};
    CARGOS_APOYA.forEach(c => { apoyaA[c] = Number(apoyaAFila[c]) || 0; });

    res.json({
      estructura,
      votantes,
      metaVotosLideres: Number(metaYAvanceLideres.meta_votos_lideres),
      avanceRegistrosLideres: Number(metaYAvanceLideres.avance_registros_lideres),
      finanzas: {
        ingresos: Number(finanzas.ingresos),
        gastos: Number(finanzas.gastos),
        balance: Number(finanzas.ingresos) - Number(finanzas.gastos)
      },
      eventos,
      proximosEventos,
      menciones,
      apoyaA
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generando el resumen del dashboard.' });
  }
});

// Registros de votantes por semana, últimas 12 semanas — para la gráfica
// de tendencia del panel principal. YEARWEEK(..., 3) usa semanas ISO (de
// lunes a domingo), que es el criterio que la gente espera al pensar
// "esta semana" en Colombia (a diferencia del modo por defecto de MySQL,
// que empieza la semana en domingo).
router.get('/tendencia-registros', async (req, res) => {
  try {
    const [filas] = await pool.query(`
      SELECT
        YEARWEEK(created_at, 3) AS semana_id,
        MIN(DATE(created_at)) AS semana_inicio,
        COUNT(*) AS total
      FROM votantes
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
      GROUP BY YEARWEEK(created_at, 3)
      ORDER BY semana_id
    `);
    res.json(filas.map(f => ({ semanaInicio: f.semana_inicio, total: f.total })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error calculando la tendencia de registros.' });
  }
});

// Progreso propio del líder/coordinador que inició sesión: formularios
// enviados (votantes con lider_id = su propio id) vs. su meta de votos.
// Para un Coordinador, la meta es la suma de las metas de todos los
// Líderes de su Comuna/Corregimiento (su territorio_id ES esa Comuna/
// Corregimiento desde este parche), no un número propio editable.
router.get('/mi-progreso', async (req, res) => {
  try {
    const usuarioId = req.session.usuario.id;
    const [[fila]] = await pool.query(
      `SELECT
        ${sqlMetaEfectiva('e')} AS meta_votos,
        (
          SELECT COUNT(*) FROM votantes v
          WHERE v.lider_id = e.usuario_id
             OR v.lider_id IN (
               SELECT sub.usuario_id FROM estructura sub
               WHERE sub.supervisor_id = e.usuario_id AND sub.cargo = 'usuario' AND sub.activo = 1
             )
        ) AS enviados
       FROM estructura e
       WHERE e.usuario_id = ? AND e.activo = 1
       LIMIT 1`,
      [usuarioId]
    );

    if (!fila) {
      return res.json({ tieneMetaAsignada: false });
    }

    const meta = fila.meta_votos || 0;
    const enviados = fila.enviados || 0;
    const porcentaje = meta > 0 ? Math.min(100, Math.round((enviados / meta) * 100)) : 0;

    res.json({ tieneMetaAsignada: true, meta, enviados, porcentaje });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error calculando el progreso de meta.' });
  }
});

// Progreso de todo el equipo (coordinadores y líderes), visible para admin/coordinador.
router.get('/progreso-equipo', async (req, res) => {
  if (!['admin', 'coordinador'].includes(req.session.usuario.rol)) {
    return res.status(403).json({ error: 'No tiene permisos para ver esta información.' });
  }
  try {
    const [filas] = await pool.query(`
      SELECT
        u.id AS usuario_id,
        u.nombre,
        e.cargo,
        t.nombre AS territorio,
        ${sqlMetaEfectiva('e')} AS meta,
        (
          SELECT COUNT(*) FROM votantes v
          WHERE v.lider_id = u.id
             OR v.lider_id IN (
               SELECT sub.usuario_id FROM estructura sub
               WHERE sub.supervisor_id = u.id AND sub.cargo = 'usuario' AND sub.activo = 1
             )
        ) AS enviados
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      LEFT JOIN territorios t ON t.id = e.territorio_id
      WHERE e.activo = 1 AND e.cargo IN ('coordinador','lider')
      ORDER BY e.cargo, u.nombre
    `);

    const conPorcentaje = filas.map(f => ({
      ...f,
      porcentaje: f.meta > 0 ? Math.min(100, Math.round((f.enviados / f.meta) * 100)) : 0
    }));

    res.json({ data: conPorcentaje });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error calculando el progreso del equipo.' });
  }
});

/**
 * Tabla de posiciones de actividad de líderes y sublíderes — a propósito
 * SOLO cuenta registros (nunca expone datos de los votantes en sí, ni
 * quiénes son, ni su intención de voto), para que sea un motivador sano y
 * no una forma de convertir contactos en trofeos. Visible para cualquier
 * rol autenticado (es el punto: que el propio líder/sublíder se vea a sí
 * mismo en la tabla).
 *
 * Es una consulta aparte de /progreso-equipo (que sí junta el equipo de un
 * coordinador en un solo número) porque acá interesa el aporte INDIVIDUAL
 * de cada quien: lo que el líder registró con su propia cuenta, y lo que
 * cada sublíder registró con la suya — sin que el conteo de un líder se
 * infle con lo que sus sublíderes ya aportan por su lado.
 */
router.get('/tabla-posiciones', async (req, res) => {
  try {
    const [filas] = await pool.query(`
      SELECT
        u.id AS usuario_id,
        u.nombre,
        e.cargo,
        (
          (SELECT COUNT(*) FROM votantes v WHERE v.lider_id = u.id AND v.sublider_id IS NULL)
          + (SELECT COUNT(*) FROM votantes v WHERE v.sublider_id = u.id)
        ) AS registros
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.activo = 1 AND e.cargo IN ('lider', 'usuario')
      HAVING registros > 0
      ORDER BY registros DESC, u.nombre
      LIMIT 50
    `);
    res.json(filas.map(f => ({ usuarioId: f.usuario_id, nombre: f.nombre, esLider: f.cargo === 'lider', registros: f.registros })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error calculando la tabla de posiciones.' });
  }
});

module.exports = router;
