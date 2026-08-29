const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { sqlMetaEfectiva } = require('../config/metasEstructura');
const { PROFUNDIDAD_MAXIMA } = require('../lib/ramas');
const { condicionAlcanceVotantes, parametrosAlcanceVotantes } = require('../lib/alcanceVotantes');

const router = express.Router();
router.use(requireAuth);

/* ---------------------------------------------------------------------------
   EL PANEL DEL ASPIRANTE ES EL MISMO, CON SUS NÚMEROS

   Estas cinco consultas nacieron para la campaña madre y contaban la campaña
   entera: `FROM estructura WHERE activo = 1`, `FROM votantes` a secas. Servía
   mientras el panel fuera solo suyo.

   Al abrírselo al aspirante con sublicencia, cada una de ellas es una fuga: le
   estaría enseñando cuántos votantes tiene la alcaldía, cuánto dinero mueve y
   quién va ganando en su tabla de posiciones — justo lo que la sublicencia
   existe para separar. Por eso NINGUNA consulta de este archivo puede quedarse
   sin acotar, y no basta con acotar las que «se ven»: el navegador recibe el
   JSON entero.

   TRES COSAS SE LE OCULTAN EN VEZ DE ACOTARSE: finanzas, eventos y menciones.
   No son suyas ni en parte —no tiene esos módulos— y no hay forma de acotarlas
   a su rama porque no cuelgan de nadie. Se devuelven vacías y el panel las
   esconde: un cero se lee como «mi campaña no tiene plata», que es mentira.
   --------------------------------------------------------------------------- */

/**
 * El ámbito del panel: null para la campaña madre —todo, como siempre— y la
 * rama del aspirante cuando mira él.
 *
 * La rama se resuelve UNA vez por petición y se reparte a las consultas como
 * una lista de ids. La alternativa era pegar `subarbolSql` en cada sitio, y
 * son ocho: cada uno con sus dos parámetros, en su posición exacta dentro de
 * la consulta. Un `?` desplazado no da error, acota por el id equivocado.
 *
 * La lista nunca viene vacía: incluye al propio aspirante.
 */
async function ambitoDelPanel(req) {
  if (!req.sublicencia) return null;
  const aspiranteId = req.sublicencia.usuario_id;
  const [filas] = await pool.query(
    `WITH RECURSIVE bajo AS (
       SELECT ? AS usuario_id, 0 AS nivel
       UNION
       SELECT es.usuario_id, b.nivel + 1
         FROM bajo b JOIN estructura es ON es.supervisor_id = b.usuario_id
        WHERE es.activo = 1 AND b.nivel < ?
     )
     SELECT usuario_id FROM bajo`,
    [aspiranteId, PROFUNDIDAD_MAXIMA]
  );
  const ids = filas.map(f => f.usuario_id);
  return {
    aspiranteId,
    ids,
    /* Los votantes NO se acotan por la lista de ids sino por
       `rama_aspirante_id`, que es la misma condición que usa su pantalla de
       Votantes y sublíderes. Si el panel contara de otra manera, sus dos
       pantallas darían cifras distintas para la misma cosa y no habría forma
       de saber cuál creer. */
    votantesSql: condicionAlcanceVotantes({ cargo: 'aspirante', usuarioId: aspiranteId }, 'v'),
    votantesPar: parametrosAlcanceVotantes({ cargo: 'aspirante', usuarioId: aspiranteId }),
  };
}

router.get('/resumen', async (req, res) => {
  try {
    const ambito = await ambitoDelPanel(req);
    // Cada trozo se arma una vez y se pega donde toca. Con `ambito` nulo todos
    // quedan en cadena vacía y la consulta es LA MISMA de siempre, letra por
    // letra: la campaña madre no cambia de comportamiento por este parche.
    const filtroEst = ambito ? 'AND e.usuario_id IN (?)' : '';
    const parEst = ambito ? [ambito.ids] : [];
    const filtroVot = ambito ? `AND ${ambito.votantesSql}` : '';
    const parVot = ambito ? ambito.votantesPar : [];

    const [[estructura]] = await pool.query(`
      SELECT
        COUNT(CASE WHEN e.cargo='coordinador' THEN 1 END) AS coordinadores,
        COUNT(CASE WHEN e.cargo='lider' THEN 1 END) AS lideres,
        COUNT(CASE WHEN e.cargo='testigo' THEN 1 END) AS testigos
      FROM estructura e WHERE e.activo = 1 ${filtroEst}
    `, parEst);
    const [[votantes]] = await pool.query(`
      SELECT COUNT(*) AS total,
        COUNT(CASE WHEN v.intencion_voto='confirmado' THEN 1 END) AS confirmados,
        COUNT(CASE WHEN v.intencion_voto='probable' THEN 1 END) AS probables,
        COUNT(CASE WHEN v.intencion_voto='indeciso' THEN 1 END) AS indecisos
      FROM votantes v WHERE 1 = 1 ${filtroVot}
    `, parVot);
    // Meta de votos = suma de la meta de votos que cada Líder tiene
    // registrada. Avance de registros = suma de los votantes/contactos que
    // tienen como Líder a cada uno de ellos (lo que han "aportado" en total).
    const [[metaYAvanceLideres]] = await pool.query(`
      SELECT
        COALESCE((SELECT SUM(e.meta_votos) FROM estructura e
                   WHERE e.cargo IN ('lider','usuario') AND e.activo = 1 ${filtroEst}), 0) AS meta_votos_lideres,
        (
          SELECT COUNT(*) FROM votantes v
          WHERE v.lider_id IN (SELECT e.usuario_id FROM estructura e
                                WHERE e.cargo IN ('lider','usuario') AND e.activo = 1 ${filtroEst})
            ${filtroVot}
        ) AS avance_registros_lideres
    `, [...parEst, ...parEst, ...parVot]);
    /* LAS TRES QUE NO SE CONSULTAN SIQUIERA CUANDO MIRA EL ASPIRANTE.
       El dinero, la agenda y las menciones son de la campaña madre entera y no
       tienen a quién colgarse para acotarlas. Se devuelven vacías y el panel
       esconde esas tarjetas — ver `esAspirante` en public/dashboard.html.
       No se consultan en absoluto: lo que no se lee no se puede filtrar mal
       más adelante, y son cuatro viajes menos a la base en su panel. */
    const [[finanzas]] = ambito ? [[{ ingresos: 0, gastos: 0 }]] : await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo='ingreso' THEN monto END),0) AS ingresos,
        COALESCE(SUM(CASE WHEN tipo='gasto' THEN monto END),0) AS gastos
      FROM finanzas_movimientos
    `);
    const [[eventos]] = ambito ? [[{ proximos: 0, realizados: 0 }]] : await pool.query(`
      SELECT
        COUNT(CASE WHEN fecha_inicio >= NOW() AND estado='programado' THEN 1 END) AS proximos,
        COUNT(CASE WHEN estado='realizado' THEN 1 END) AS realizados
      FROM eventos
    `);
    const [proximosEventos] = ambito ? [[]] : await pool.query(`
      SELECT id, titulo, tipo, fecha_inicio, lugar FROM eventos
      WHERE fecha_inicio >= NOW() AND estado = 'programado'
      ORDER BY fecha_inicio ASC LIMIT 5
    `);
    const [menciones] = ambito ? [[]] : await pool.query(`
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
             WHERE e.activo = 1 AND JSON_CONTAINS(u.apoya_a, '"${c}"') ${filtroEst})
            +
            (SELECT COUNT(*) FROM votantes v
             WHERE v.origen <> 'estructura' AND JSON_CONTAINS(v.apoya_a, '"${c}"') ${filtroVot})
          ) AS ${c}
        `).join(',')}
    `, CARGOS_APOYA.flatMap(() => [...parEst, ...parVot]));
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
    const ambito = await ambitoDelPanel(req);
    const filtroVot = ambito ? `AND ${ambito.votantesSql}` : '';
    const [filas] = await pool.query(`
      SELECT
        YEARWEEK(v.created_at, 3) AS semana_id,
        MIN(DATE(v.created_at)) AS semana_inicio,
        COUNT(*) AS total
      FROM votantes v
      WHERE v.created_at >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK) ${filtroVot}
      GROUP BY YEARWEEK(v.created_at, 3)
      ORDER BY semana_id
    `, ambito ? ambito.votantesPar : []);
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
    /* TAMBIÉN AQUÍ, aunque la fila ya sea suya por `e.usuario_id = ?`.
       Sin esto, el aspirante veía dos cifras distintas para la MISMA persona
       en la MISMA pantalla: «Mi meta de votos» contando todo lo que registró
       —incluido lo que hizo para la madre— y su fila en «Progreso del equipo»
       contando solo su rama. Dos números que no cuadran en un panel no se
       leen como un matiz: se leen como que el panel está mal. */
    const ambito = await ambitoDelPanel(req);
    const filtroVot = ambito ? `AND ${ambito.votantesSql}` : '';
    const parVot = ambito ? ambito.votantesPar : [];
    const [[fila]] = await pool.query(
      `SELECT
        ${sqlMetaEfectiva('e')} AS meta_votos,
        (
          SELECT COUNT(*) FROM votantes v
          WHERE (v.lider_id = e.usuario_id
             OR v.lider_id IN (
               SELECT sub.usuario_id FROM estructura sub
               WHERE sub.supervisor_id = e.usuario_id AND sub.cargo = 'usuario' AND sub.activo = 1
             ))
            ${filtroVot}
        ) AS enviados
       FROM estructura e
       WHERE e.usuario_id = ? AND e.activo = 1
       LIMIT 1`,
      [...parVot, usuarioId]
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
  /* EL ASPIRANTE ENTRA AUNQUE SU ROL SEA «lider».
     Su rol es el que tiene en la estructura de la madre; lo que compró es otra
     cosa. Sin esta excepción su panel mostraba un 403 en el sitio donde va el
     progreso de SU equipo, que es justo lo que él necesita ver. Lo que ve va
     acotado abajo — dejarlo entrar sin acotar le habría dado la nómina de
     coordinadores de la alcaldía con sus metas. */
  if (!req.sublicencia && !['admin', 'coordinador'].includes(req.session.usuario.rol)) {
    return res.status(403).json({ error: 'No tiene permisos para ver esta información.' });
  }
  try {
    const ambito = await ambitoDelPanel(req);
    const filtroEst = ambito ? 'AND e.usuario_id IN (?)' : '';
    const parEst = ambito ? [ambito.ids] : [];
    /* ACOTAR LAS FILAS NO ACOTA LOS NÚMEROS DE CADA FILA.
       `filtroEst` deja sólo a la gente de la rama, pero el conteo de
       `enviados` recorría `votantes` sin condición: a un líder recién traído
       a la rama le contaba también los votantes que registró trabajando para
       la madre. La fila era suya; el número, no.
       Y se contradecía con /resumen, donde `avance_registros_lideres` SÍ lleva
       este filtro: la suma de la tabla nunca cuadraba con la cifra grande del
       panel, y no había forma de saber cuál creer. */
    const filtroVot = ambito ? `AND ${ambito.votantesSql}` : '';
    const parVot = ambito ? ambito.votantesPar : [];
    const [filas] = await pool.query(`
      SELECT
        u.id AS usuario_id,
        u.nombre,
        e.cargo,
        t.nombre AS territorio,
        ${sqlMetaEfectiva('e')} AS meta,
        (
          SELECT COUNT(*) FROM votantes v
          WHERE (v.lider_id = u.id
             OR v.lider_id IN (
               SELECT sub.usuario_id FROM estructura sub
               WHERE sub.supervisor_id = u.id AND sub.cargo = 'usuario' AND sub.activo = 1
             ))
            ${filtroVot}
        ) AS enviados
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      LEFT JOIN territorios t ON t.id = e.territorio_id
      WHERE e.activo = 1 AND e.cargo IN ('coordinador','lider') ${filtroEst}
      ORDER BY e.cargo, u.nombre
    `, [...parVot, ...parEst]);

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
    const ambito = await ambitoDelPanel(req);
    const filtroEst = ambito ? 'AND e.usuario_id IN (?)' : '';
    const parEst = ambito ? [ambito.ids] : [];
    // Misma corrección que en /progreso-equipo: las filas iban acotadas y los
    // conteos no. Son DOS subconsultas, así que el filtro entra dos veces y
    // sus parámetros van delante de los de la fila, en ese orden.
    const filtroVot = ambito ? `AND ${ambito.votantesSql}` : '';
    const parVot = ambito ? ambito.votantesPar : [];
    const [filas] = await pool.query(`
      SELECT
        u.id AS usuario_id,
        u.nombre,
        e.cargo,
        (
          (SELECT COUNT(*) FROM votantes v WHERE v.lider_id = u.id AND v.sublider_id IS NULL ${filtroVot})
          + (SELECT COUNT(*) FROM votantes v WHERE v.sublider_id = u.id ${filtroVot})
        ) AS registros
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.activo = 1 AND e.cargo IN ('lider', 'usuario') ${filtroEst}
      HAVING registros > 0
      ORDER BY registros DESC, u.nombre
      LIMIT 50
    `, [...parVot, ...parVot, ...parEst]);
    res.json(filas.map(f => ({ usuarioId: f.usuario_id, nombre: f.nombre, esLider: f.cargo === 'lider', registros: f.registros })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error calculando la tabla de posiciones.' });
  }
});

module.exports = router;
