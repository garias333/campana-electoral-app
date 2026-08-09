const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/**
 * Lugar de votación leído del Catálogo Territorial de Colombia (CTC).
 *
 * POR QUE EXISTE
 *   Hasta ahora el desplegable de Puesto de votación se llenaba con
 *   `/api/dia-d/puestos-para-reporte`, que devuelve los puestos de
 *   `dia_d_puestos_votacion` — los que la campaña va a CUBRIR CON
 *   TESTIGOS. Son otra cosa que DONDE VOTA una persona.
 *
 *   El efecto era visible: en la campaña departamental (ámbito Caldas) se
 *   elegía Antioquia / Puerto Berrío y el desplegable seguía mostrando los
 *   332 puestos de Caldas. Un líder que vote fuera del ámbito no se podía
 *   registrar, y el que se registraba quedaba con un puesto que no es el
 *   suyo.
 *
 *   Estas rutas son de SOLO LECTURA sobre el catálogo: 33 departamentos,
 *   1.122 municipios, 12.885 puestos, todos los del país. El recorte al
 *   ámbito sigue donde corresponde — en `dia_d_puestos_votacion`, para el
 *   puesto de TESTIGO y para el reporte del Día D.
 *
 * DE DONDE SALEN LOS DATOS
 *   Del mismo MySQL, base `territoriosdb`, por JOIN directo — sin HTTP de
 *   por medio. El usuario de la app tiene GRANT SELECT sobre 17 tablas del
 *   catálogo (las de datos; NO las que guardan contraseñas ni llaves).
 *
 * LAS MESAS NO NECESITAN CONSULTA
 *   Medido sobre los 12.885 puestos activos: la numeración es SIEMPRE
 *   1..N, sin huecos, sin saltos, y `total_mesas` coincide exactamente con
 *   el conteo real en los 12.885. Cero excepciones. Así que el desplegable
 *   de Mesa se arma en el front con un rango, y `ctc_mesas_votacion` no se
 *   consulta.
 */

// La base del catálogo. Se deja configurable por si algún día vive en otro
// servidor: cambiar aquí, no en cada consulta.
const CAT = process.env.CATALOGO_DB || 'territoriosdb';

// Niveles del catálogo (ctc_niveles): 2 = Departamento, 3 = Municipio.
// Municipio incluye los tipos 30 Municipio, 31 Área no municipalizada y
// 32 Isla — en las tres se vota, así que las tres entran.
const NIVEL_DEPARTAMENTO = 2;
const NIVEL_MUNICIPIO = 3;

/**
 * Traduce el fallo típico —falta el GRANT sobre territoriosdb— en un
 * mensaje que se entienda. Sin esto, el front recibe un 500 pelado y
 * quien lo depure va a buscar el error en el JavaScript.
 */
function responderError(res, err, queSeBuscaba) {
  console.error(`[catalogo] ${queSeBuscaba}:`, err.message);
  if (err.code === 'ER_TABLEACCESS_DENIED_ERROR' || err.code === 'ER_DBACCESS_DENIED_ERROR') {
    return res.status(503).json({
      error: 'Esta campaña todavía no tiene permiso de lectura sobre el catálogo territorial. ' +
             'Hay que otorgarle GRANT SELECT sobre las tablas ctc_* de territoriosdb.'
    });
  }
  if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_DB_ERROR') {
    return res.status(503).json({
      error: 'No se encuentra el catálogo territorial (' + CAT + ') en este servidor de base de datos.'
    });
  }
  res.status(500).json({ error: 'Error consultando ' + queSeBuscaba + '.' });
}

/** Los 33 departamentos. */
router.get('/departamentos', async (req, res) => {
  try {
    const [filas] = await pool.query(
      `SELECT id, codigo_dane, nombre
         FROM ${CAT}.ctc_territorios
        WHERE nivel_id = ? AND estado = 'ACTIVO'
        ORDER BY nombre`,
      [NIVEL_DEPARTAMENTO]
    );
    res.json(filas);
  } catch (err) {
    responderError(res, err, 'los departamentos');
  }
});

/**
 * Los municipios de un departamento.
 *
 * Se filtra por `padre_id` y no por la ruta materializada: un municipio
 * cuelga siempre directamente de su departamento, así que la lista de
 * adyacencia basta y usa el índice.
 */
router.get('/municipios', async (req, res) => {
  const departamentoId = Number(req.query.departamento_id) || 0;
  if (!departamentoId) {
    return res.status(400).json({ error: 'Falta departamento_id.' });
  }
  try {
    const [filas] = await pool.query(
      `SELECT id, codigo_dane, nombre
         FROM ${CAT}.ctc_territorios
        WHERE padre_id = ? AND nivel_id = ? AND estado = 'ACTIVO'
        ORDER BY nombre`,
      [departamentoId, NIVEL_MUNICIPIO]
    );
    res.json(filas);
  } catch (err) {
    responderError(res, err, 'los municipios');
  }
});

/**
 * Los puestos de votación de un municipio, con su cantidad de mesas.
 *
 * `total_mesas` sale del catálogo y es el número de mesas que EXISTEN en
 * ese puesto. El front arma con eso el desplegable de Mesa (1..total).
 *
 * Dos municipios de los 1.122 no tienen ningún puesto registrado. La
 * respuesta es una lista vacía, no un error: el front debe decirlo.
 */
router.get('/puestos', async (req, res) => {
  const municipioId = Number(req.query.municipio_id) || 0;
  if (!municipioId) {
    return res.status(400).json({ error: 'Falta municipio_id.' });
  }
  try {
    const [filas] = await pool.query(
      `SELECT id, nombre, COALESCE(total_mesas, 0) AS total_mesas, direccion
         FROM ${CAT}.ctc_puestos_votacion
        WHERE municipio_id = ? AND estado = 'ACTIVO'
        ORDER BY nombre`,
      [municipioId]
    );
    res.json(filas);
  } catch (err) {
    responderError(res, err, 'los puestos de votación');
  }
});

/**
 * Traduce los nombres guardados en texto a los id del catálogo, para
 * PRESELECCIONAR los desplegables al editar una persona ya registrada.
 *
 * Las personas registradas antes de este cambio tienen el departamento y
 * el municipio como TEXTO, escritos desde `/data/colombia.json`, que usa
 * formato título («Puerto Berrío») mientras el catálogo usa mayúsculas
 * («PUERTO BERRÍO»).
 *
 * NO SE NORMALIZA EN JAVASCRIPT: la colación `utf8mb4_0900_ai_ci` de la
 * base ya ignora mayúsculas Y tildes, así que la comparación directa
 * resuelve los tres casos —«PUERTO BERRIO», «Puerto Berrío», «puerto
 * berrio»— sin escribir una sola regla. Comprobado en la base.
 *
 * El municipio se busca SIEMPRE dentro del departamento ya resuelto.
 * A nivel nacional los nombres se repiten —«EL CARMEN» está en Chocó y en
 * Santander, «SAN ANDRÉS» en Antioquia y en el Archipiélago— y buscar sin
 * acotar metería a la persona en otro departamento.
 */
router.get('/resolver', async (req, res) => {
  const nombreDepto = String(req.query.departamento || '').trim();
  const nombreMuni = String(req.query.municipio || '').trim();
  if (!nombreDepto) {
    return res.status(400).json({ error: 'Falta departamento.' });
  }
  try {
    // Primero por nombre propio; si no cruza, por alias. `ctc_alias`
    // existe justo para esto: cruzar archivos externos que escriben los
    // nombres a su manera. Aquí el «archivo externo» es
    // /data/colombia.json, que dice «Bogotá D.C.» donde el catálogo dice
    // «Bogotá, D.C.» — la coma basta para que no cruce.
    const [deptos] = await pool.query(
      `SELECT t.id, t.nombre
         FROM ${CAT}.ctc_territorios t
        WHERE t.nivel_id = ? AND t.estado = 'ACTIVO'
          AND (t.nombre = ?
               OR EXISTS (SELECT 1 FROM ${CAT}.ctc_alias a
                           WHERE a.territorio_id = t.id AND a.alias = ?))
        LIMIT 1`,
      [NIVEL_DEPARTAMENTO, nombreDepto, nombreDepto]
    );
    if (!deptos.length) return res.json({ departamento: null, municipio: null });

    const departamento = deptos[0];
    if (!nombreMuni) return res.json({ departamento, municipio: null });

    // El municipio, SIEMPRE acotado al departamento ya resuelto. Los
    // alias a nivel nacional son ambiguos —«EL CARMEN» está en Chocó y en
    // Santander— y sin acotar meterían a la persona en otro departamento.
    const [munis] = await pool.query(
      `SELECT t.id, t.nombre
         FROM ${CAT}.ctc_territorios t
        WHERE t.padre_id = ? AND t.nivel_id = ? AND t.estado = 'ACTIVO'
          AND (t.nombre = ?
               OR EXISTS (SELECT 1 FROM ${CAT}.ctc_alias a
                           WHERE a.territorio_id = t.id AND a.alias = ?))
        LIMIT 1`,
      [departamento.id, NIVEL_MUNICIPIO, nombreMuni, nombreMuni]
    );
    res.json({ departamento, municipio: munis.length ? munis[0] : null });
  } catch (err) {
    responderError(res, err, 'la equivalencia de nombres');
  }
});

/**
 * Dado un puesto de la campaña (`dia_d_puestos_votacion`), devuelve su
 * ubicación completa en el catálogo.
 *
 * PARA QUE SIRVE
 *   Cuando a una persona se le asigna un puesto de TESTIGO, el formulario
 *   copia ese puesto al Lugar de votación. Con este cambio las dos listas
 *   dejan de compartir vocabulario: el puesto de testigo viene de la
 *   campaña y el de votación del catálogo. Esta ruta los reconcilia por
 *   `ctc_puesto_id`, el enlace que se sembró al crear la campaña.
 *
 *   Importa especialmente en las campañas de más de un municipio, donde el
 *   nombre del puesto va calificado —«LA FLORESTA (SALAMINA)»— y NO cruza
 *   con el nombre limpio del catálogo. Por id sí cruza siempre.
 */
router.get('/ubicacion-de-puesto', async (req, res) => {
  const puestoCampanaId = Number(req.query.puesto_campana_id) || 0;
  if (!puestoCampanaId) {
    return res.status(400).json({ error: 'Falta puesto_campana_id.' });
  }
  try {
    const [filas] = await pool.query(
      `SELECT p.id            AS puesto_id,
              p.nombre        AS puesto_nombre,
              COALESCE(p.total_mesas, 0) AS total_mesas,
              m.id            AS municipio_id,
              m.nombre        AS municipio_nombre,
              d.id            AS departamento_id,
              d.nombre        AS departamento_nombre
         FROM dia_d_puestos_votacion c
         JOIN ${CAT}.ctc_puestos_votacion p ON p.id = c.ctc_puesto_id
         JOIN ${CAT}.ctc_territorios     m ON m.id = p.municipio_id
         JOIN ${CAT}.ctc_territorios     d ON d.id = m.padre_id
        WHERE c.id = ?
        LIMIT 1`,
      [puestoCampanaId]
    );
    // Un puesto creado a mano desde Configuración → Día D no tiene
    // `ctc_puesto_id`, así que no hay nada que reconciliar. No es un error.
    if (!filas.length) return res.json(null);
    res.json(filas[0]);
  } catch (err) {
    responderError(res, err, 'la ubicación del puesto');
  }
});

/**
 * Diagnóstico: dice si esta instancia puede leer el catálogo y qué tan
 * poblado está. Útil tras desplegar, para no descubrir el GRANT que falta
 * cuando un usuario abra el formulario.
 */
router.get('/salud', async (req, res) => {
  try {
    const [[conteo]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM ${CAT}.ctc_territorios WHERE nivel_id = ${NIVEL_DEPARTAMENTO} AND estado='ACTIVO') AS departamentos,
              (SELECT COUNT(*) FROM ${CAT}.ctc_territorios WHERE nivel_id = ${NIVEL_MUNICIPIO}    AND estado='ACTIVO') AS municipios,
              (SELECT COUNT(*) FROM ${CAT}.ctc_puestos_votacion WHERE estado='ACTIVO')                                  AS puestos`
    );
    res.json({ catalogo: CAT, accesible: true, ...conteo });
  } catch (err) {
    console.error('[catalogo] salud:', err.message);
    res.status(503).json({ catalogo: CAT, accesible: false, motivo: err.code || err.message });
  }
});

module.exports = router;
