const express = require('express');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { subarbolSql } = require('../lib/ramas');
const { condicionAlcanceVotantes,
        parametrosAlcanceVotantes } = require('../lib/alcanceVotantes');
const { geocodificarDireccion } = require('../config/geocoder');
const { resolverTerritorioDesdeNombres } = require('../config/territorioResolver');
const { uploadExcel } = require('../middleware/upload');
const { registrarAuditoria } = require('../config/auditoria');
const {
  asegurarEstructuraTestigo, verificarMesasDisponibles, geocodificarTestigoPorPuestoYGuardar
} = require('../config/testigoElectoral');
const {
  sincronizarVotanteDesdeEstructura, traerVotanteActualPorCedula
} = require('../config/sincronizacionVotantesEstructura');
const { TIPOS_GREMIALES, CARGOS_CON_META_DERIVADA, sqlMetaEfectiva } = require('../config/metasEstructura');
const { verificarPasswordAdmin, verificarPasswordPropia, validarTelefono10Digitos } = require('../config/verificaciones');

const router = express.Router();
router.use(requireAuth);

/**
 * Los territorios vienen del Catalogo Territorial (CTC): la tabla
 * `territorios` es una VISTA de solo lectura sobre territoriosdb.
 * Ver vista_territorios_catalogo.sql en el proyecto del catalogo.
 *
 * Sin esta guarda MySQL rechaza igual la escritura, pero con un
 * mensaje ilegible ("target table is not updatable").
 */
function catalogoSoloLectura(res) {
  return res.status(409).json({
    error: 'Los territorios ahora vienen del Catalogo Territorial y no se editan desde la campana. ' +
           'Si falta un territorio, o hay un nombre mal escrito, se corrige una vez en el catalogo ' +
           'y el cambio aparece solo en todas las campanas.'
  });
}

/** Etiquetas legibles para el campo opcional "Tipo" de la Estructura (cargo político/comunitario). */
const ETIQUETAS_TIPO_CARGO = {
  concejal: 'Concejal',
  edil: 'Edil',
  aspirante_concejo: 'Aspirante al concejo',
  aspirante_jal: 'Aspirante a JAL',
  presidente_jal: 'Presidente de JAL',
  presidente_jac: 'Presidente de JAC',
  miembro_jal: 'Miembro de JAL',
  miembro_jac: 'Miembro de JAC',
  presidente_gremio: 'Presidente de gremio',
  presidente_asociacion: 'Presidente de asociación'
};
/** Mapa inverso (etiqueta en minúscula sin tildes -> clave), para reconocer el valor al importar desde Excel. */
const CLAVES_TIPO_CARGO = Object.fromEntries(
  Object.entries(ETIQUETAS_TIPO_CARGO).map(([clave, etiqueta]) => [
    etiqueta.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
    clave
  ])
);

/**
 * Sube por la cadena de padres de un territorio (ej. Barrio -> Comuna ->
 * Municipio -> Departamento) y devuelve los nombres, del más específico al
 * más general. Se usa para armar una dirección completa para geocodificar.
 */
async function resolverCadenaTerritorio(territorioId) {
  const nombres = [];
  let actualId = territorioId;
  let profundidad = 0;
  while (actualId && profundidad < 6) {
    const [[fila]] = await pool.query(`SELECT nombre, padre_id FROM territorios WHERE id = ?`, [actualId]);
    if (!fila) break;
    nombres.push(fila.nombre);
    actualId = fila.padre_id;
    profundidad++;
  }
  return nombres;
}

/**
 * Geocodifica la Dirección de residencia usando el Barrio/Vereda o Comuna/
 * Corregimiento **de residencia** (si coinciden con el catálogo de
 * Territorios) para obtener el municipio/departamento correctos. Antes se
 * usaba el Territorio de influencia para esto, lo cual daba resultados
 * incorrectos cuando la persona vive en una zona distinta de la que
 * coordina/lidera — esa era la causa de que el mapa no georreferenciara
 * bien de acuerdo a los datos reales.
 */
/**
 * Ciudad/Departamento de respaldo cuando la persona no tiene su propia
 * Ciudad/Departamento de residencia registrada — se usa el Territorio en
 * el que se desarrolla la campaña (o, si no hay, la sede de la campaña).
 * Es INDISPENSABLE tener siempre algún ancla de ciudad: sin ella, el
 * buscador de mapas termina buscando la dirección en TODO el país, y
 * puede ubicarla en cualquier ciudad de Colombia con nombre de calle o
 * barrio parecido (esto pasó de verdad — ver parche 57).
 */
async function obtenerCiudadDepartamentoPorDefecto() {
  try {
    const [[config]] = await pool.query(
      `SELECT territorio_departamento, territorio_ciudad, departamento, ciudad FROM configuracion_campana WHERE id = 1`
    );
    if (!config) return { departamento: null, ciudad: null };
    return {
      departamento: config.territorio_departamento || config.departamento || null,
      ciudad: config.territorio_ciudad || config.ciudad || null
    };
  } catch (err) {
    console.error('Error obteniendo Departamento/Ciudad por defecto de la campaña:', err);
    return { departamento: null, ciudad: null };
  }
}

async function geocodificarResidenciaYGuardar(estructuraId, direccion, comunaCorregimientoResidencia, barrioVeredaResidencia, departamentoResidencia, ciudadResidencia) {
  if (!direccion || !direccion.trim()) return { geocodificado: false };
  try {
    let cadena = [];
    if (barrioVeredaResidencia && barrioVeredaResidencia.trim()) {
      const [[fila]] = await pool.query(
        `SELECT id FROM territorios WHERE tipo IN ('barrio','vereda')
         AND LOWER(nombre) COLLATE utf8mb4_unicode_ci = LOWER(?) COLLATE utf8mb4_unicode_ci LIMIT 1`,
        [barrioVeredaResidencia.trim()]
      );
      if (fila) cadena = await resolverCadenaTerritorio(fila.id);
    }
    if (!cadena.length && comunaCorregimientoResidencia && comunaCorregimientoResidencia.trim()) {
      const [[fila]] = await pool.query(
        `SELECT id FROM territorios WHERE tipo IN ('comuna','corregimiento')
         AND LOWER(nombre) COLLATE utf8mb4_unicode_ci = LOWER(?) COLLATE utf8mb4_unicode_ci LIMIT 1`,
        [comunaCorregimientoResidencia.trim()]
      );
      if (fila) cadena = await resolverCadenaTerritorio(fila.id);
    }
    // Ciudad/Departamento de residencia (catálogo DANE) — se mandan como
    // campos ESTRUCTURADOS y separados al buscador de mapas (no mezclados
    // en un solo texto), para que no tenga margen de interpretar la
    // dirección como si estuviera en otro municipio con nombre de calle o
    // barrio parecido. El Barrio/Vereda (si coincidió con el catálogo de
    // Territorios) se agrega a la calle, para ayudar a ubicar la cuadra
    // exacta dentro de esa ciudad.
    //
    // Si la persona no tiene su propia Ciudad/Departamento de residencia,
    // NUNCA se manda la búsqueda sin ancla de ciudad — se usa como
    // respaldo el Territorio de la campaña (Configuración).
    let ciudadFinal = ciudadResidencia && ciudadResidencia.trim() ? ciudadResidencia.trim() : null;
    let departamentoFinal = departamentoResidencia && departamentoResidencia.trim() ? departamentoResidencia.trim() : null;
    if (!ciudadFinal && !departamentoFinal) {
      const porDefecto = await obtenerCiudadDepartamentoPorDefecto();
      ciudadFinal = porDefecto.ciudad;
      departamentoFinal = porDefecto.departamento;
    }
    const calleConBarrio = [direccion.trim(), cadena[0] || null].filter(Boolean).join(', ');
    const resultado = await geocodificarDireccion({
      calle: calleConBarrio,
      ciudad: ciudadFinal,
      departamento: departamentoFinal
    });
    if (!resultado) {
      await pool.query(`UPDATE estructura SET direccion = ? WHERE id = ?`, [direccion.trim(), estructuraId]);
      return { geocodificado: false };
    }
    await pool.query(
      `UPDATE estructura SET direccion = ?, latitud = ?, longitud = ?, geocodificado_en = NOW() WHERE id = ?`,
      [direccion.trim(), resultado.latitud, resultado.longitud, estructuraId]
    );
    return { geocodificado: true, ...resultado };
  } catch (err) {
    console.error('Error geocodificando dirección de residencia:', err);
    await pool.query(`UPDATE estructura SET direccion = ? WHERE id = ?`, [direccion.trim(), estructuraId]);
    return { geocodificado: false };
  }
}

/** Geocodifica una dirección + territorio y actualiza la fila de estructura. No lanza error si falla. */
async function geocodificarYGuardar(estructuraId, direccion, territorioId) {
  if (!direccion || !direccion.trim()) return { geocodificado: false };
  try {
    const cadena = await resolverCadenaTerritorio(territorioId);
    const direccionCompleta = `${direccion.trim()}, ${cadena.join(', ')}, Colombia`;
    const resultado = await geocodificarDireccion(direccionCompleta);
    if (!resultado) {
      await pool.query(`UPDATE estructura SET direccion = ? WHERE id = ?`, [direccion.trim(), estructuraId]);
      return { geocodificado: false };
    }
    await pool.query(
      `UPDATE estructura SET direccion = ?, latitud = ?, longitud = ?, geocodificado_en = NOW() WHERE id = ?`,
      [direccion.trim(), resultado.latitud, resultado.longitud, estructuraId]
    );
    return { geocodificado: true, ...resultado };
  } catch (err) {
    console.error('Error geocodificando dirección:', err);
    await pool.query(`UPDATE estructura SET direccion = ? WHERE id = ?`, [direccion.trim(), estructuraId]);
    return { geocodificado: false };
  }
}

/**
 * Busca un territorio por tipo + nombre (+ padre opcional). Si no existe, lo crea.
 * Se usa para que el flujo Departamento -> Municipio -> Comuna/Barrio/Corregimiento/Vereda
 * no obligue a crear manualmente cada nivel: se resuelve solo detrás de escena.
 */
async function buscarOCrearTerritorio(conexion, tipo, nombre, padreId) {
  const nombreLimpio = nombre.trim();
  const params = padreId ? [tipo, nombreLimpio, padreId] : [tipo, nombreLimpio];
  const whereSql = padreId ? 'AND padre_id = ?' : 'AND padre_id IS NULL';
  const [existentes] = await conexion.query(
    `SELECT id FROM territorios WHERE tipo = ? AND LOWER(nombre) COLLATE utf8mb4_unicode_ci = LOWER(?) COLLATE utf8mb4_unicode_ci ${whereSql} LIMIT 1`,
    params
  );
  if (existentes.length > 0) return existentes[0].id;

  const [result] = await conexion.query(
    `INSERT INTO territorios (tipo, nombre, padre_id) VALUES (?, ?, ?)`,
    [tipo, nombreLimpio, padreId || null]
  );
  return result.insertId;
}

/**
 * Sube por padre_id hasta encontrar el territorio de tipo 'municipio' del
 * que depende un territorio dado. Se usa para no reasignar por error el
 * padre de un Barrio/Vereda que en realidad pertenece a otro municipio con
 * un nombre igual (poco común, pero se protege igual).
 */
async function obtenerMunicipioAncestro(conexion, territorioId) {
  let actualId = territorioId;
  let profundidad = 0;
  while (actualId && profundidad < 6) {
    const [[fila]] = await conexion.query(`SELECT tipo, padre_id FROM territorios WHERE id = ?`, [actualId]);
    if (!fila) return null;
    if (fila.tipo === 'municipio') return actualId;
    actualId = fila.padre_id;
    profundidad++;
  }
  return null;
}

/**
 * Para Barrio/Vereda: busca un territorio existente con ese tipo+nombre que
 * pertenezca al mismo municipio (sin importar su padre_id actual) y, si su
 * padre no es el correcto (ej. quedó colgado directamente del municipio por
 * una importación anterior sin columna "Pertenece"), lo corrige en el mismo
 * registro — conserva el id, por lo que no rompe referencias ya existentes
 * desde estructura/votantes. Si no existe ninguno en ese municipio, lo crea
 * bajo el padre correcto.
 */
async function buscarCrearOReparentarZona(conexion, tipo, nombre, padreCorrectoId, municipioId) {
  const nombreLimpio = nombre.trim();
  const [candidatos] = await conexion.query(
    `SELECT id, padre_id FROM territorios WHERE tipo = ? AND LOWER(nombre) COLLATE utf8mb4_unicode_ci = LOWER(?) COLLATE utf8mb4_unicode_ci`,
    [tipo, nombreLimpio]
  );

  for (const candidato of candidatos) {
    const municipioDelCandidato = await obtenerMunicipioAncestro(conexion, candidato.id);
    if (municipioDelCandidato === municipioId) {
      if (candidato.padre_id !== padreCorrectoId) {
        await conexion.query(`UPDATE territorios SET padre_id = ? WHERE id = ?`, [padreCorrectoId, candidato.id]);
        return { id: candidato.id, reparentado: true };
      }
      return { id: candidato.id, reparentado: false };
    }
  }

  const [result] = await conexion.query(
    `INSERT INTO territorios (tipo, nombre, padre_id) VALUES (?, ?, ?)`,
    [tipo, nombreLimpio, padreCorrectoId]
  );
  return { id: result.insertId, reparentado: false };
}

/* ------------------------- Territorios ------------------------- */

// Árbol completo de territorios
router.get('/territorios', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM territorios ORDER BY tipo, nombre`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo territorios.' });
  }
});

router.post('/territorios', requireRole('admin', 'coordinador'), async (req, res) => {
  return catalogoSoloLectura(res);   // catalogo de solo lectura
  const { tipo, nombre, padre_id } = req.body;
  if (!tipo || !nombre) return res.status(400).json({ error: 'Tipo y nombre son obligatorios.' });
  try {
    const [result] = await pool.query(
      `INSERT INTO territorios (tipo, nombre, padre_id) VALUES (?, ?, ?)`,
      [tipo, nombre, padre_id || null]
    );
    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creando territorio.' });
  }
});

/**
 * Edita un territorio (Comuna/Corregimiento/Barrio/Vereda): permite
 * corregir su Nombre y, para Barrio/Vereda, reasignarlo a otra Comuna/
 * Corregimiento. Como estructura/votantes/eventos referencian el territorio
 * por id, el cambio se refleja ahí automáticamente sin nada más que hacer.
 *
 * Pero "Comuna/Corregimiento de residencia" y "Barrio/Vereda de residencia"
 * (en Agregar a la estructura) se guardan como texto libre, no por id — así
 * que si se renombra un territorio, se actualizan también esos campos en
 * `usuarios` que coincidían exactamente con el nombre anterior, para que no
 * queden desincronizados.
 */
router.put('/territorios/:id', requireRole('admin', 'coordinador'), async (req, res) => {
  return catalogoSoloLectura(res);   // catalogo de solo lectura
  const { nombre, padre_id } = req.body;
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El nombre es obligatorio.' });
  }

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();

    const [[actual]] = await conexion.query(
      `SELECT tipo, nombre, padre_id FROM territorios WHERE id = ?`, [req.params.id]
    );
    if (!actual) throw new Error('Territorio no encontrado.');
    if (!['comuna', 'corregimiento', 'barrio', 'vereda'].includes(actual.tipo)) {
      throw new Error('Solo se pueden editar Comunas, Corregimientos, Barrios y Veredas.');
    }

    const nombreAnterior = actual.nombre;
    const nombreNuevo = nombre.trim();
    // Solo Barrio/Vereda pueden reasignarse a otra Comuna/Corregimiento;
    // para Comuna/Corregimiento el padre (Municipio) no se toca aquí.
    const padreNuevo = (['barrio', 'vereda'].includes(actual.tipo) && padre_id) ? padre_id : actual.padre_id;

    const [duplicado] = await conexion.query(
      `SELECT id FROM territorios
       WHERE tipo = ? AND LOWER(nombre) COLLATE utf8mb4_unicode_ci = LOWER(?) COLLATE utf8mb4_unicode_ci
       AND (padre_id <=> ?) AND id != ?`,
      [actual.tipo, nombreNuevo, padreNuevo, req.params.id]
    );
    if (duplicado.length) {
      throw new Error('Ya existe otro territorio con ese nombre en la misma ubicación.');
    }

    await conexion.query(
      `UPDATE territorios SET nombre = ?, padre_id = ? WHERE id = ?`,
      [nombreNuevo, padreNuevo, req.params.id]
    );

    // Propaga el cambio de nombre a los campos de residencia (texto libre)
    // que coincidían exactamente con el nombre anterior.
    let actualizadosResidencia = 0;
    if (nombreAnterior !== nombreNuevo) {
      if (actual.tipo === 'comuna' || actual.tipo === 'corregimiento') {
        const [r] = await conexion.query(
          `UPDATE usuarios SET comuna_corregimiento_residencia = ?
           WHERE comuna_corregimiento_residencia COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci`,
          [nombreNuevo, nombreAnterior]
        );
        actualizadosResidencia = r.affectedRows;
      } else {
        const [r] = await conexion.query(
          `UPDATE usuarios SET barrio_residencia = ?
           WHERE barrio_residencia COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci`,
          [nombreNuevo, nombreAnterior]
        );
        actualizadosResidencia = r.affectedRows;
      }
    }

    await conexion.commit();
    res.json({ ok: true, actualizadosResidencia });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    res.status(400).json({ error: err.message || 'Error actualizando el territorio.' });
  } finally {
    conexion.release();
  }
});

router.delete('/territorios/:id', requireRole('admin'), async (req, res) => {
  return catalogoSoloLectura(res);   // catalogo de solo lectura
  try {
    await pool.query(`DELETE FROM territorios WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo eliminar. Verifique que no tenga dependencias asociadas.' });
  }
});

/**
 * Elimina TODOS los territorios (departamentos, municipios, comunas,
 * corregimientos, barrios, veredas). Requiere la contraseña de un
 * administrador. Si hay personas de la Estructura o Votantes que todavía
 * dependen de algún territorio, la base de datos rechaza el borrado (no se
 * fuerza), para no dejar referencias huérfanas o violar campos obligatorios.
 */
router.post('/territorios/eliminar-todo', requireRole('admin'), async (req, res) => {
  return catalogoSoloLectura(res);   // catalogo de solo lectura
  const { password } = req.body;
  const autorizado = await verificarPasswordAdmin(password);
  if (!autorizado) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }
  try {
    await pool.query(`DELETE FROM territorios`);
    await registrarAuditoria(
      req.session.usuario.id, 'eliminar_todo', 'territorios', null,
      'Eliminó todos los territorios.', req.ip
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
      return res.status(400).json({
        error: 'No se pueden eliminar: hay personas de la Estructura, Votantes o Eventos que todavía dependen de algún territorio. Elimine o reasigne esos registros primero.'
      });
    }
    res.status(500).json({ error: 'Error eliminando los territorios.' });
  }
});

/**
 * Crea una zona (Comuna/Barrio/Corregimiento/Vereda) resolviendo automáticamente
 * el Departamento y Municipio como padres (los crea si aún no existen).
 */
router.post('/territorios/crear-zona', requireRole('admin', 'coordinador'), async (req, res) => {
  return catalogoSoloLectura(res);   // catalogo de solo lectura
  const { departamento, municipio, tipoZona, nombreZona, padreZonaId } = req.body;
  const tiposValidos = ['comuna', 'barrio', 'corregimiento', 'vereda'];
  if (!departamento || !municipio || !tiposValidos.includes(tipoZona) || !nombreZona) {
    return res.status(400).json({ error: 'Departamento, municipio, tipo de zona y nombre son obligatorios.' });
  }
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const departamentoId = await buscarOCrearTerritorio(conexion, 'departamento', departamento, null);
    const municipioId = await buscarOCrearTerritorio(conexion, 'municipio', municipio, departamentoId);
    // Un Barrio puede colgar de una Comuna, y una Vereda de un Corregimiento;
    // si no se especifica, cuelga directamente del municipio.
    const padreFinal = padreZonaId || municipioId;
    const zonaId = await buscarOCrearTerritorio(conexion, tipoZona, nombreZona, padreFinal);
    await conexion.commit();
    res.json({ ok: true, departamentoId, municipioId, zonaId });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    res.status(400).json({ error: 'Ya existe una zona con ese nombre en esa ubicación, o hubo un error al crearla.' });
  } finally {
    conexion.release();
  }
});

// Exporta comunas/barrios/corregimientos/veredas a Excel, con su departamento,
// municipio y de qué comuna/corregimiento depende cada barrio/vereda
// (columna "Pertenece", necesaria para que la importación reconstruya la
// jerarquía correctamente).
router.get('/territorios/exportar-excel', async (req, res) => {
  try {
    const [filas] = await pool.query(`
      SELECT
        z.tipo,
        z.nombre,
        padre_zona.nombre AS pertenece,
        COALESCE(muni_directo.nombre, muni_via_padre.nombre) AS municipio,
        COALESCE(depto_directo.nombre, depto_via_padre.nombre) AS departamento
      FROM territorios z
      LEFT JOIN territorios muni_directo
        ON muni_directo.id = z.padre_id AND muni_directo.tipo = 'municipio'
      LEFT JOIN territorios depto_directo
        ON depto_directo.id = muni_directo.padre_id
      LEFT JOIN territorios padre_zona
        ON padre_zona.id = z.padre_id AND padre_zona.tipo IN ('comuna','corregimiento')
      LEFT JOIN territorios muni_via_padre
        ON muni_via_padre.id = padre_zona.padre_id
      LEFT JOIN territorios depto_via_padre
        ON depto_via_padre.id = muni_via_padre.padre_id
      WHERE z.tipo IN ('comuna','barrio','corregimiento','vereda')
      ORDER BY departamento, municipio, z.tipo, z.nombre
    `);
    const columnas = ['Departamento', 'Municipio', 'Área', 'Tipo', 'Nombre', 'Pertenece'];
    const datos = filas.map(f => ({
      Departamento: f.departamento,
      Municipio: f.municipio,
      Área: ['comuna', 'barrio'].includes(f.tipo) ? 'Urbano' : 'Rural',
      Tipo: f.tipo.charAt(0).toUpperCase() + f.tipo.slice(1),
      Nombre: f.nombre,
      Pertenece: f.pertenece || ''
    }));
    // Si no hay registros, igual se exporta la hoja con los encabezados.
    const hoja = datos.length
      ? XLSX.utils.json_to_sheet(datos, { header: columnas })
      : XLSX.utils.aoa_to_sheet([columnas]);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Territorios');
    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="territorios.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error exportando territorios.' });
  }
});

// Importa comunas/barrios/corregimientos/veredas desde un Excel con columnas:
// Departamento, Municipio, Área, Tipo, Nombre, Pertenece.
//
// Reglas de jerarquía:
//  - Comuna y Corregimiento cuelgan directamente del Municipio (son,
//    respectivamente, la subdivisión "urbana" y "rural" del municipio).
//  - Barrio pertenece a la Comuna indicada en "Pertenece" (se crea si no existe).
//  - Vereda pertenece al Corregimiento indicado en "Pertenece" (se crea si no existe).
// Si un Barrio/Vereda ya existía con el padre equivocado (ej. de una
// importación anterior a este parche, que colgaba todo del municipio), se
// corrige en el mismo registro en lugar de crear uno duplicado.
router.post('/territorios/importar-excel', requireRole('admin', 'coordinador'), uploadExcel.single('archivo'), async (req, res) => {
  return catalogoSoloLectura(res);   // catalogo de solo lectura
  if (!req.file) return res.status(400).json({ error: 'Debe adjuntar un archivo Excel (.xlsx).' });

  try {
    const libro = XLSX.read(req.file.buffer, { type: 'buffer' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });
    const tiposValidos = ['comuna', 'barrio', 'corregimiento', 'vereda'];

    let insertados = 0;
    let reparentados = 0;
    const errores = [];

    // Tolera archivos exportados con celdas de Departamento/Municipio
    // "combinadas" visualmente (Excel deja en blanco las filas repetidas):
    // se reutiliza el último valor no vacío visto.
    let ultimoDepartamento = '';
    let ultimoMunicipio = '';

    // El Departamento y el Municipio se repiten en casi todas las filas de
    // un archivo real (un import típico cubre uno o pocos municipios). En
    // vez de volver a consultar la base de datos por cada fila para
    // resolver el mismo Departamento/Municipio ya resuelto antes, se
    // recuerda acá su id — solo después de que la fila que lo confirmó
    // quedó bien guardada (commit), para que una fila que termine
    // revertida por un error nunca deje un id "fantasma" para las
    // siguientes filas.
    const cacheDepartamentos = new Map();
    const cacheMunicipios = new Map();

    for (const [i, fila] of filas.entries()) {
      let departamento = String(fila.Departamento || fila.departamento || '').trim();
      let municipio = String(fila.Municipio || fila.municipio || '').trim();
      const tipo = String(fila.Tipo || fila.tipo || '').trim().toLowerCase();
      const nombre = String(fila.Nombre || fila.nombre || '').trim();
      const pertenece = String(
        fila.Pertenece || fila.pertenece || fila['Pertenece a'] || fila['pertenece a'] || ''
      ).trim();

      if (!departamento) departamento = ultimoDepartamento;
      if (!municipio) municipio = ultimoMunicipio;

      if (!departamento || !municipio || !tipo || !nombre) {
        errores.push({ fila: i + 2, error: 'Faltan datos obligatorios (Departamento, Municipio, Tipo, Nombre).' });
        continue;
      }
      if (!tiposValidos.includes(tipo)) {
        errores.push({ fila: i + 2, error: `Tipo "${fila.Tipo}" no válido. Use Comuna, Barrio, Corregimiento o Vereda.` });
        continue;
      }

      ultimoDepartamento = departamento;
      ultimoMunicipio = municipio;

      const claveDepto = departamento.toLowerCase();
      const conexion = await pool.getConnection();
      try {
        await conexion.beginTransaction();
        const departamentoId = cacheDepartamentos.has(claveDepto)
          ? cacheDepartamentos.get(claveDepto)
          : await buscarOCrearTerritorio(conexion, 'departamento', departamento, null);
        const claveMuni = `${departamentoId}|${municipio.toLowerCase()}`;
        const municipioId = cacheMunicipios.has(claveMuni)
          ? cacheMunicipios.get(claveMuni)
          : await buscarOCrearTerritorio(conexion, 'municipio', municipio, departamentoId);

        if (tipo === 'comuna' || tipo === 'corregimiento') {
          await buscarOCrearTerritorio(conexion, tipo, nombre, municipioId);
        } else if (tipo === 'barrio') {
          const comunaId = pertenece
            ? await buscarOCrearTerritorio(conexion, 'comuna', pertenece, municipioId)
            : municipioId;
          const resultado = await buscarCrearOReparentarZona(conexion, tipo, nombre, comunaId, municipioId);
          if (resultado.reparentado) reparentados++;
        } else if (tipo === 'vereda') {
          const corregimientoId = pertenece
            ? await buscarOCrearTerritorio(conexion, 'corregimiento', pertenece, municipioId)
            : municipioId;
          const resultado = await buscarCrearOReparentarZona(conexion, tipo, nombre, corregimientoId, municipioId);
          if (resultado.reparentado) reparentados++;
        }

        await conexion.commit();
        cacheDepartamentos.set(claveDepto, departamentoId);
        cacheMunicipios.set(claveMuni, municipioId);
        insertados++;
      } catch (err) {
        await conexion.rollback();
        errores.push({ fila: i + 2, error: 'Error al insertar esta fila (posible duplicado).' });
      } finally {
        conexion.release();
      }
    }

    res.json({ ok: true, insertados, reparentados, errores });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error procesando el archivo Excel. Verifique que el formato de las columnas sea correcto.' });
  }
});

/* ------------------------- Estructura (personas) ------------------------- */

// Verifica en tiempo real (antes de guardar) si un número de identificación
// ya está en uso por otra persona de la estructura. excluir_id se usa en modo
// edición para no contarse a sí mismo como duplicado.
router.get('/estructura/verificar-identificacion', async (req, res) => {
  const { numero, excluir_id } = req.query;
  if (!numero || !numero.trim()) return res.json({ disponible: true });
  try {
    let query = `SELECT id FROM usuarios WHERE numero_identificacion = ?`;
    const params = [numero.trim()];
    if (excluir_id) { query += ` AND id != ?`; params.push(excluir_id); }
    const [rows] = await pool.query(query, params);
    res.json({ disponible: rows.length === 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error verificando el número de identificación.' });
  }
});

// Listado de la estructura con datos de usuario y territorio
router.get('/estructura', async (req, res) => {
  try {
    const usuario = req.session.usuario;
    // Los conteos de "registros" se calculan UNA vez para toda la tabla, no
    // una vez por fila. Antes cada fila disparaba subconsultas anidadas
    // (líderes -> sublíderes -> votantes), así que el costo crecía con el
    // cuadrado del tamaño del equipo y no tenía tope. Estas cinco
    // agregaciones dan exactamente los mismos números —comprobado fila por
    // fila contra las dos campañas de prueba, 115 filas, cero diferencias—
    // pero recorren `votantes` una sola vez.
    let query = `
      WITH
      cnt_lider AS (
        SELECT lider_id AS uid, COUNT(*) AS c FROM votantes WHERE lider_id IS NOT NULL GROUP BY lider_id
      ),
      -- COUNT(DISTINCT) y no COUNT(*): si alguien figura como líder Y como
      -- sublíder del mismo votante, esa persona cuenta una sola vez, igual
      -- que hacía el "OR" de la consulta anterior.
      cnt_ambos AS (
        SELECT uid, COUNT(DISTINCT vid) AS c FROM (
          SELECT id AS vid, lider_id    AS uid FROM votantes WHERE lider_id    IS NOT NULL
          UNION ALL
          SELECT id AS vid, sublider_id AS uid FROM votantes WHERE sublider_id IS NOT NULL
        ) x GROUP BY uid
      ),
      subs AS (
        SELECT es.supervisor_id AS uid, COALESCE(SUM(cb.c), 0) AS c
          FROM estructura es LEFT JOIN cnt_ambos cb ON cb.uid = es.usuario_id
         WHERE es.cargo = 'usuario' AND es.activo = 1 AND es.supervisor_id IS NOT NULL
         GROUP BY es.supervisor_id
      ),
      total_lider AS (
        SELECT e2.usuario_id AS uid, COALESCE(cl.c, 0) + COALESCE(s.c, 0) AS total
          FROM estructura e2
          LEFT JOIN cnt_lider cl ON cl.uid = e2.usuario_id
          LEFT JOIN subs      s  ON s.uid  = e2.usuario_id
         WHERE e2.cargo = 'lider'
      ),
      total_coord AS (
        SELECT el.supervisor_id AS uid, COALESCE(SUM(tl.total), 0) AS total
          FROM estructura el JOIN total_lider tl ON tl.uid = el.usuario_id
         WHERE el.cargo = 'lider' AND el.activo = 1 AND el.supervisor_id IS NOT NULL
         GROUP BY el.supervisor_id
      )
      SELECT e.*, u.nombre, u.numero_identificacion,
             -- COALESCE y no u.* a secas: en la fila de cargo='testigo' el
             -- puesto/mesa es el que VIGILA (guardado en estructura); en
             -- las demás filas de la misma persona (Líder, Coordinador...)
             -- esas columnas de estructura están vacías y cae al lugar de
             -- votación real de usuarios. Van después de e.* para ganarle
             -- la precedencia a las columnas homónimas que trae el comodín.
             COALESCE(e.departamento_votacion, u.departamento_votacion) AS departamento_votacion,
             COALESCE(e.municipio_votacion, u.municipio_votacion) AS municipio_votacion,
             COALESCE(e.puesto_votacion, u.puesto_votacion) AS puesto_votacion,
             COALESCE(e.mesa_votacion, u.mesa_votacion) AS mesa_votacion,
             u.departamento_residencia, u.ciudad_residencia,
             u.comuna_corregimiento_residencia, u.barrio_residencia, u.genero, u.edad,
             u.tipo_cargo, u.email, u.telefono, u.activo, u.apoya_a, u.no_contactar,
             t.nombre AS territorio_nombre, t.tipo AS territorio_tipo,
             sup.nombre AS supervisor_nombre,
             -- Meta derivada del equipo: Líderes para un Coordinador,
             -- gremiales para un Coordinador Organizaciones. Ver
             -- config/metasEstructura.js — la regla vive en un solo sitio.
             ${sqlMetaEfectiva('e')} AS meta_votos_equipo,
             -- Mismos tres casos que antes, ya resueltos por las
             -- agregaciones de arriba:
             --   coordinador -> suma de sus líderes (con los sublíderes de cada uno)
             --   líder       -> los suyos como líder, más los de sus sublíderes
             --   los demás   -> los que refirió, como líder o como sublíder
             -- Alias con prefijo "ag" (agregado) a propósito: sqlMetaEfectiva()
             -- ya usa el, tl, eg y ug dentro de sus subconsultas, y repetir
             -- uno de esos aquí lo dejaría dependiendo de en qué ámbito
             -- resuelve MySQL cada nombre. (Sin acentos graves en este
             -- comentario: va dentro de un template literal de JavaScript y
             -- cortarían la cadena — pasó al escribirlo.)
             (CASE WHEN e.cargo = 'coordinador' THEN COALESCE(agc.total, 0)
                   WHEN e.cargo = 'lider'       THEN COALESCE(agl.total, 0)
                   ELSE COALESCE(agb.c, 0) END) AS registros
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      LEFT JOIN territorios t ON t.id = e.territorio_id
      LEFT JOIN usuarios sup ON sup.id = e.supervisor_id
      LEFT JOIN total_coord agc ON agc.uid = e.usuario_id
      LEFT JOIN total_lider agl ON agl.uid = e.usuario_id
      LEFT JOIN cnt_ambos   agb ON agb.uid = e.usuario_id`;
    const params = [];
    if (!['admin', 'coordinador'].includes(usuario.rol)) {
      query += ` WHERE e.supervisor_id = ? OR e.usuario_id = ?`;
      params.push(usuario.id, usuario.id);
    }
    query += ` ORDER BY e.cargo, u.nombre`;
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo la estructura.' });
  }
});

/**
 * Mantiene `meta_votos` igual al "piso" manual `meta_votos_base` de la
 * persona. Si el usuarioId no existe en Estructura, no hace nada.
 *
 * NO toca al Coordinador Organizaciones. Antes le guardaba aquí el total
 * (su piso manual MÁS la suma de sus gremiales), y ese total era una
 * segunda fuente de verdad que se desincronizó: ver la nota de
 * config/metasEstructura.js. Hoy su meta se DERIVA al leer, con
 * sqlMetaEfectiva(), y no hay nada que guardar.
 *
 * Se sigue llamando después de CREAR, EDITAR o ELIMINAR a cualquier
 * persona, con su usuario_id y sus supervisor_id de antes y después.
 * Para los gremiales ya no hace falta —su coordinador se recalcula solo
 * al leerlo— pero llamarla de más no cuesta nada y evita tener que
 * acertar en cuál de las rutas sí y en cuál no.
 */
async function recalcularMetaVotosCoordinadorOrganizaciones(conexionOPool, usuarioId) {
  if (!usuarioId) return;
  try {
    // Excluye la fila de testigo electoral (si la persona también tiene
    // esa capacidad, ver asignarEstructuraTestigo): esta función opera
    // sobre el cargo PRINCIPAL de la persona en Estructura territorial,
    // nunca sobre su capacidad de testigo.
    const [[estructuraPersona]] = await conexionOPool.query(
      `SELECT id, cargo, meta_votos_base FROM estructura WHERE usuario_id = ? AND cargo != 'testigo'`, [usuarioId]
    );
    if (!estructuraPersona) return;

    // Los cargos de meta derivada no guardan nada: su número sale de
    // sqlMetaEfectiva() en cada lectura. Escribirles aquí volvería a
    // crear el desajuste que este cambio elimina.
    if (CARGOS_CON_META_DERIVADA.includes(estructuraPersona.cargo)) return;

    await conexionOPool.query(
      `UPDATE estructura SET meta_votos = ? WHERE id = ?`,
      [estructuraPersona.meta_votos_base || 0, estructuraPersona.id]
    );
  } catch (err) {
    // No debe hacer fallar la operación principal (crear/editar/borrar a
    // alguien) por un problema al recalcular este total derivado.
    console.error('Error recalculando la meta de votos:', err);
  }
}

/**
 * Para la importación masiva por Excel: si el teléfono de la fila no
 * tiene exactamente 10 dígitos, no se rechaza la fila completa (sería
 * perder el resto de datos válidos de esa persona por un solo campo) —
 * simplemente se importa esa persona sin teléfono.
 */
function normalizarTelefonoImportado(valor) {
  if (!valor) return null;
  const digitos = String(valor).replace(/\D/g, '');
  return digitos.length === 10 ? digitos : null;
}

// Crear persona en la estructura (crea usuario + registro de estructura)
// La sincronización hacia/desde Votantes y sublíderes vive en
// config/sincronizacionVotantesEstructura.js (compartida con votantes.routes.js).

router.post('/estructura', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  const {
    nombre, numero_identificacion, departamento_votacion, municipio_votacion, puesto_votacion, mesa_votacion,
    departamento_residencia, ciudad_residencia, comuna_corregimiento_residencia, barrio_residencia,
    genero, edad, tipo_cargo, apoya_a, email, telefono, cargo, tipo_area_influencia, organizacion,
    territorio_id, area, supervisor_id, meta_votos, direccion, cliente_uuid, tipo_testigo, mesas_asignadas
  } = req.body;

  /* LO QUE CREA UN ASPIRANTE CUELGA DE ÉL, DIGA LO QUE DIGA EL FORMULARIO.
     `supervisor_id` viene del navegador, así que un aspirante podría colgar a
     su testigo de cualquiera de la campaña madre — y con eso metería gente en
     una rama ajena, o se llevaría la suya a otra. Se ignora y se pone él.

     No es una limitación: es lo que significa «sus testigos». */
  const supervisorFinal = req.sublicencia ? req.sublicencia.usuario_id : (supervisor_id || null);
  // El Área se GUARDA, no se deduce. Deducirla del tipo de territorio deja
  // la columna vacía en cuanto la persona cuelga del municipio, que es lo
  // normal en una campaña sin comunas ni barrios. Se acota a los dos valores
  // válidos: cualquier otra cosa entra como NULL en vez de reventar el ENUM.
  const areaFinal = ['urbano', 'rural'].includes(area) ? area : null;
  // Un Coordinador de puesto (tipo_testigo="puesto") cubre varias mesas del
  // mismo puesto de votación — no una fija, a diferencia del Testigo
  // electoral normal (tipo_testigo="mesa", el valor por defecto).
  const tipoTestigoFinal = tipo_testigo === 'puesto' ? 'puesto' : 'mesa';
  const mesaVotacionFinal = (cargo === 'testigo' && tipoTestigoFinal === 'puesto') ? null : (mesa_votacion || null);
  const mesasAsignadasFinal = Array.isArray(mesas_asignadas) ? mesas_asignadas.map(Number) : [];

  // Reintento idempotente: el panel de escritorio (Windows) guarda el
  // formulario en el dispositivo cuando no hay señal y lo reintenta solo
  // más tarde — si el mismo envío llega dos veces, esto evita crear a la
  // misma persona por duplicado. Sin cliente_uuid sigue de largo como siempre.
  if (cliente_uuid) {
    try {
      const [[yaExiste]] = await pool.query(`SELECT id, usuario_id FROM estructura WHERE cliente_uuid = ?`, [cliente_uuid]);
      if (yaExiste) {
        return res.json({ ok: true, id: yaExiste.id, usuarioId: yaExiste.usuario_id, yaExistia: true });
      }
    } catch (err) {
      console.error('Error verificando cliente_uuid (se sigue con el registro normal):', err);
    }
  }

  const esOrganizacion = tipo_area_influencia === 'organizacion';
  // Un "Coordinador Organizaciones" no tiene territorio geográfico ni una
  // única organización obligatoria — coordina varias, no se le exige
  // ninguna de las dos cosas. El Testigo electoral tampoco: su "ubicación"
  // real es la mesa donde vigila (departamento/municipio/puesto/mesa de
  // votación), no un barrio/vereda de Estructura territorial — se crea
  // desde el formulario aparte de "Testigo electoral", sin territorio.
  const esCoordinadorOrganizaciones = cargo === 'coordinador_organizaciones';
  const esTestigo = cargo === 'testigo';
  if (!nombre || !cargo
      || (!esCoordinadorOrganizaciones && !esTestigo && !esOrganizacion && !territorio_id)
      || (!esCoordinadorOrganizaciones && esOrganizacion && !organizacion)) {
    return res.status(400).json({
      error: esOrganizacion
        ? 'Nombre, cargo y nombre de la organización son obligatorios.'
        : 'Nombre, cargo y territorio son obligatorios.'
    });
  }
  if (!validarTelefono10Digitos(telefono)) {
    return res.status(400).json({ error: 'Error de digitación: el teléfono debe tener 10 dígitos.' });
  }
  if (esTestigo) {
    const mesasSolicitadas = tipoTestigoFinal === 'puesto' ? mesasAsignadasFinal : (mesaVotacionFinal ? [mesaVotacionFinal] : []);
    const conflicto = await verificarMesasDisponibles(pool, puesto_votacion, mesasSolicitadas, 0);
    if (conflicto.length) {
      return res.status(400).json({ error: `La(s) mesa(s) ${conflicto.join(', ')} ya están asignadas a otro testigo de ese puesto.` });
    }

    // Antes de crear una cuenta nueva, se busca si esta cédula/email ya
    // pertenece a alguien (ej. ya es Líder o Coordinador) — sin esta
    // búsqueda, registrar aquí un testigo con la cédula de alguien que ya
    // tenía cuenta creaba una SEGUNDA cuenta duplicada en vez de solo
    // agregarle la capacidad de testigo a la que ya tenía (bug reportado:
    // "al asignar jurado a un líder o votante crea doble usuario").
    const numeroIdentificacionLookup = (numero_identificacion || '').trim();
    const emailLookup = (email || '').trim() ? email.trim().toLowerCase() : null;
    if (numeroIdentificacionLookup || emailLookup) {
      const [[coincidencia]] = await pool.query(
        emailLookup
          ? `SELECT id FROM usuarios WHERE numero_identificacion = ? OR email = ? LIMIT 1`
          : `SELECT id FROM usuarios WHERE numero_identificacion = ? LIMIT 1`,
        emailLookup ? [numeroIdentificacionLookup, emailLookup] : [numeroIdentificacionLookup]
      );
      if (coincidencia) {
        // Esta persona ya tenía cuenta (es Líder, Sublíder, etc.), así que
        // el puesto/mesa de vigilancia va en su fila de "estructura" y no
        // encima de su lugar de votación. Departamento/Municipio se
        // deducen del puesto adentro de la función.
        const resultado = await asegurarEstructuraTestigo(pool, coincidencia.id, {
          puesto_votacion, mesa_votacion: mesaVotacionFinal
        }, tipoTestigoFinal, mesasAsignadasFinal);
        if (resultado.conflicto) {
          return res.status(400).json({ error: `La(s) mesa(s) ${resultado.conflicto.join(', ')} ya están asignadas a otro testigo de ese puesto.` });
        }
        if (!resultado.creado) {
          return res.status(400).json({ error: 'Esta persona ya está registrada como testigo electoral.' });
        }
        await registrarAuditoria(
          req.session.usuario.id, 'crear_estructura', 'estructura', resultado.estructuraId,
          `Se le asignó la capacidad de testigo electoral a ${nombre} (cuenta de acceso ya existente).`, req.ip
        );
        return res.json({ ok: true, estructura_id: resultado.estructuraId, usuarioId: coincidencia.id });
      }
    }
  }
  const conexion = await pool.getConnection();
  let estructuraId, passwordTemporal, usuarioId;
  try {
    await conexion.beginTransaction();

    // "Coordinador Organizaciones" es un cargo distinto dentro de la
    // Estructura, pero para efectos de inicio de sesión/permisos usa el
    // mismo rol que "coordinador" (no se creó un rol nuevo aparte).
    const nombreRolLogin = cargo === 'coordinador_organizaciones' ? 'coordinador' : cargo;
    const [[rol]] = await conexion.query(`SELECT id FROM roles WHERE nombre = ?`, [nombreRolLogin]);
    if (!rol) throw new Error('Cargo/rol inválido.');

    // Para crear la cuenta de acceso solo hace falta el Número de
    // identificación: se usa como Nombre de usuario y como contraseña
    // inicial (obligada a cambiar en el primer ingreso). El correo es
    // opcional — si no se da, la persona entra con su Nombre de usuario.
    // Si no hay ni Número de identificación, se genera una temporal.
    const numeroIdentificacionLimpio = (numero_identificacion || '').trim();
    let nombreUsuarioFinal = null;
    let passwordFinal;
    if (numeroIdentificacionLimpio) {
      nombreUsuarioFinal = numeroIdentificacionLimpio;
      passwordFinal = numeroIdentificacionLimpio;
    } else {
      passwordTemporal = Math.random().toString(36).slice(-10);
      passwordFinal = passwordTemporal;
    }
    const hash = await bcrypt.hash(passwordFinal, 12);

    const [resultUsuario] = await conexion.query(
      `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, departamento_votacion, municipio_votacion,
       puesto_votacion, mesa_votacion, departamento_residencia, ciudad_residencia,
       comuna_corregimiento_residencia, barrio_residencia, genero, edad, tipo_cargo, apoya_a,
       email, password_hash, rol_id, territorio_id, telefono, debe_cambiar_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [nombre, numeroIdentificacionLimpio || null, nombreUsuarioFinal, departamento_votacion || null, municipio_votacion || null,
       puesto_votacion || null, mesaVotacionFinal, departamento_residencia || null, ciudad_residencia || null,
       comuna_corregimiento_residencia || null, barrio_residencia || null, genero || 'prefiero_no_responder', edad || null,
       tipo_cargo || null, JSON.stringify(Array.isArray(apoya_a) ? apoya_a : []),
       (email || '').trim() ? email.trim().toLowerCase() : null, hash, rol.id, territorio_id || null, telefono ? telefono.replace(/\D/g, '') : null]
    );
    usuarioId = resultUsuario.insertId;

    const [resultEstructura] = await conexion.query(
      `INSERT INTO estructura (usuario_id, territorio_id, area, cargo, tipo_testigo, mesas_asignadas, tipo_area_influencia, organizacion, supervisor_id, meta_votos, meta_votos_base, direccion, cliente_uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [resultUsuario.insertId, territorio_id || null, areaFinal, cargo, tipoTestigoFinal,
       (esTestigo && tipoTestigoFinal === 'puesto') ? JSON.stringify(mesasAsignadasFinal) : null,
       esOrganizacion ? 'organizacion' : 'territorio',
       esOrganizacion ? organizacion.trim() : null, supervisorFinal, meta_votos || 0, meta_votos || 0, direccion || null,
       cliente_uuid || null]
    );
    estructuraId = resultEstructura.insertId;

    await conexion.commit();
  } catch (err) {
    await conexion.rollback();
    // Si dos reintentos del mismo registro guardado offline chocan justo al
    // mismo tiempo (carrera poco probable, pero posible), el que llegó de
    // últimas no debe fallar como si fuera un error real.
    if (err.code === 'ER_DUP_ENTRY' && cliente_uuid) {
      const [[existente]] = await pool.query(`SELECT id, usuario_id FROM estructura WHERE cliente_uuid = ?`, [cliente_uuid]).catch(() => [[null]]);
      if (existente) return res.json({ ok: true, id: existente.id, usuarioId: existente.usuario_id, yaExistia: true });
    }
    console.error(err);
    let msg = 'Error creando el registro de estructura.';
    if (err.code === 'ER_DUP_ENTRY') {
      const sqlMsg = err.sqlMessage || '';
      if (sqlMsg.includes('numero_identificacion')) msg = 'Ya registrado por otro líder.';
      else if (sqlMsg.includes('nombre_usuario')) msg = 'Ya existe un usuario con ese nombre de usuario (número de identificación).';
      else msg = 'Ya existe un usuario con ese email.';
    }
    return res.status(400).json({ error: msg });
  } finally {
    conexion.release();
  }

  // La geocodificación se hace después de confirmar la transacción, y nunca
  // hace fallar la creación del registro aunque el servicio no responda.
  // Un Testigo electoral no tiene dirección de residencia en su
  // formulario — se georreferencia por el NOMBRE del Puesto de votación.
  // El resto (Coordinador/Líder/Sublíder/etc.) usa su dirección de
  // RESIDENCIA (no el territorio de influencia), ya que la Dirección
  // corresponde a donde vive la persona.
  const geo = esTestigo
    ? await geocodificarTestigoPorPuestoYGuardar(pool, estructuraId, puesto_votacion, municipio_votacion, departamento_votacion)
    : await geocodificarResidenciaYGuardar(estructuraId, direccion, comuna_corregimiento_residencia, barrio_residencia, departamento_residencia, ciudad_residencia);
  // Si esta persona tiene un Tipo gremial y reporta a un Coordinador
  // Organizaciones, su Meta de votos se suma a la de ese coordinador. Y si
  // ella misma es un Coordinador Organizaciones, su propio total efectivo
  // se calcula a partir del piso que se acaba de escribir.
  await recalcularMetaVotosCoordinadorOrganizaciones(pool, usuarioId);
  if (TIPOS_GREMIALES.includes(tipo_cargo) && supervisorFinal) {
    await recalcularMetaVotosCoordinadorOrganizaciones(pool, supervisorFinal);
  }
  // "Lleva también los datos a Votante" — se sincroniza después de
  // confirmar la transacción, y nunca hace fallar la creación de la
  // persona en Estructura si algo sale mal acá.
  await sincronizarVotanteDesdeEstructura(pool, {
    nombre, numero_identificacion, telefono, email, genero, edad, apoya_a,
    departamento_votacion, municipio_votacion, puesto_votacion, mesa_votacion,
    departamento_residencia, ciudad_residencia, direccion, territorio_id,
    creado_por: req.session.usuario.id
  });
  res.json({ ok: true, estructura_id: estructuraId, password_temporal: passwordTemporal, geocodificado: geo.geocodificado });
});

router.put('/estructura/:id', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  /* MISMA CONFIRMACION QUE AL BORRAR, Y POR LA MISMA RAZON.
     Editar una ficha de la estructura cambia el correo, el telefono y el
     supervisor de una persona que TIENE CUENTA: cambiarle el correo es
     cambiarle por donde recupera la contraseña. No es menos delicado que
     borrarla, solo es mas silencioso.

     La pide tambien Testigos, que edita por esta misma ruta. Si un dia
     aparece un tercer llamador y no la manda, se enterara aqui con un 403
     legible y no editando a medias. */
  if (!(await verificarPasswordPropia(req.session.usuario.id, req.body && req.body.password))) {
    return res.status(403).json({ error: 'Contraseña incorrecta. Escriba la suya para confirmar.' });
  }
  const {
    nombre, numero_identificacion, departamento_votacion, municipio_votacion, puesto_votacion, mesa_votacion,
    departamento_residencia, ciudad_residencia, comuna_corregimiento_residencia, barrio_residencia,
    genero, edad, tipo_cargo, apoya_a, email, telefono, cargo, tipo_area_influencia, organizacion,
    territorio_id, area, supervisor_id, meta_votos, activo, direccion, tipo_testigo, mesas_asignadas
  } = req.body;

  /* UN ASPIRANTE SÓLO EDITA DENTRO DE SU RAMA.
     La guarda de arriba deja entrar; esto decide sobre QUÉ. Sin la comprobación
     tendría el formulario de edición de cualquier persona de la campaña madre
     con sólo cambiar el número de la dirección — y esa es la mitad de la fuga
     que no se ve en pantalla, porque el menú no la ofrece.

     Se responde 403 y no 404: no hay nada que esconder, esa persona existe;
     lo que no es suya es la ficha. */
  if (req.sublicencia) {
    const dentro = subarbolSql(req.sublicencia.usuario_id, 'e.usuario_id');
    const [[suya]] = await pool.query(
      `SELECT 1 AS ok FROM estructura e WHERE e.id = ? AND ${dentro.sql} LIMIT 1`,
      [req.params.id, ...dentro.valores]);
    if (!suya) {
      return res.status(403).json({ error: 'Esa persona no pertenece a su estructura.' });
    }
  }
  const areaFinal = ['urbano', 'rural'].includes(area) ? area : null;
  const esOrganizacion = tipo_area_influencia === 'organizacion';
  const esCoordinadorOrganizaciones = cargo === 'coordinador_organizaciones';
  const esTestigo = cargo === 'testigo';
  const tipoTestigoFinal = tipo_testigo === 'puesto' ? 'puesto' : 'mesa';
  const mesaVotacionFinal = (esTestigo && tipoTestigoFinal === 'puesto') ? null : (mesa_votacion || null);
  const mesasAsignadasFinal = Array.isArray(mesas_asignadas) ? mesas_asignadas.map(Number) : [];
  if (!nombre || !cargo
      || (!esCoordinadorOrganizaciones && !esTestigo && !esOrganizacion && !territorio_id)
      || (!esCoordinadorOrganizaciones && esOrganizacion && !organizacion)) {
    return res.status(400).json({
      error: esOrganizacion
        ? 'Nombre, cargo y nombre de la organización son obligatorios.'
        : 'Nombre, cargo y territorio son obligatorios.'
    });
  }
  if (!validarTelefono10Digitos(telefono)) {
    return res.status(400).json({ error: 'Error de digitación: el teléfono debe tener 10 dígitos.' });
  }
  if (esTestigo) {
    const mesasSolicitadas = tipoTestigoFinal === 'puesto' ? mesasAsignadasFinal : (mesaVotacionFinal ? [mesaVotacionFinal] : []);
    const conflicto = await verificarMesasDisponibles(pool, puesto_votacion, mesasSolicitadas, req.params.id);
    if (conflicto.length) {
      return res.status(400).json({ error: `La(s) mesa(s) ${conflicto.join(', ')} ya están asignadas a otro testigo de ese puesto.` });
    }
  }
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();

    const [[fila]] = await conexion.query(
      `SELECT e.usuario_id, e.direccion AS direccion_anterior, e.supervisor_id AS supervisor_id_anterior,
              u.comuna_corregimiento_residencia AS comuna_residencia_anterior,
              u.barrio_residencia AS barrio_residencia_anterior, u.nombre_usuario AS nombre_usuario_anterior,
              u.tipo_cargo AS tipo_cargo_anterior, u.puesto_votacion AS puesto_votacion_anterior
       FROM estructura e JOIN usuarios u ON u.id = e.usuario_id
       WHERE e.id = ?`,
      [req.params.id]
    );
    if (!fila) throw new Error('Registro no encontrado.');

    // Si todavía no tenía Nombre de usuario asignado y ahora se está
    // completando el Número de identificación, se aprovecha para
    // asignárselo también como Nombre de usuario (sin tocar su contraseña,
    // que puede que ya haya sido cambiada por la persona).
    const numeroIdentificacionLimpio = (numero_identificacion || '').trim();
    const nombreUsuarioFinal = (!fila.nombre_usuario_anterior && numeroIdentificacionLimpio)
      ? numeroIdentificacionLimpio
      : fila.nombre_usuario_anterior;

    await conexion.query(
      `UPDATE usuarios SET nombre = ?, numero_identificacion = ?, nombre_usuario = ?, departamento_votacion = ?, municipio_votacion = ?,
       puesto_votacion = ?, mesa_votacion = ?, departamento_residencia = ?, ciudad_residencia = ?,
       comuna_corregimiento_residencia = ?, barrio_residencia = ?, genero = ?, edad = ?,
       tipo_cargo = ?, apoya_a = ?, email = ?, telefono = ? WHERE id = ?`,
      [nombre, numeroIdentificacionLimpio || null, nombreUsuarioFinal, departamento_votacion || null, municipio_votacion || null,
       puesto_votacion || null, mesaVotacionFinal, departamento_residencia || null, ciudad_residencia || null,
       comuna_corregimiento_residencia || null, barrio_residencia || null, genero || 'prefiero_no_responder', edad || null,
       tipo_cargo || null, JSON.stringify(Array.isArray(apoya_a) ? apoya_a : []),
       (email || '').trim() ? email.trim().toLowerCase() : null, telefono ? telefono.replace(/\D/g, '') : null, fila.usuario_id]
    );

    await conexion.query(
      `UPDATE estructura SET cargo = ?, tipo_testigo = ?, mesas_asignadas = ?, territorio_id = ?, area = ?, tipo_area_influencia = ?, organizacion = ?,
       supervisor_id = ?, meta_votos = ?, meta_votos_base = ?, activo = ?, direccion = ?
       WHERE id = ?`,
      [cargo, tipoTestigoFinal, (esTestigo && tipoTestigoFinal === 'puesto') ? JSON.stringify(mesasAsignadasFinal) : null,
       territorio_id || null, areaFinal, esOrganizacion ? 'organizacion' : 'territorio', esOrganizacion ? organizacion.trim() : null,
       supervisor_id || null, meta_votos || 0, meta_votos || 0, activo ? 1 : 0, direccion || null, req.params.id]
    );

    await conexion.commit();

    // Un Testigo electoral se georreferencia por el NOMBRE del Puesto de
    // votación (no tiene dirección de residencia en su formulario); el
    // resto de cargos sigue usando su dirección de residencia. En los dos
    // casos, solo se vuelve a geocodificar si lo que la ubica realmente
    // cambió, para no gastar consultas al servicio de mapas sin necesidad.
    if (esTestigo) {
      if ((puesto_votacion || '') !== (fila.puesto_votacion_anterior || '')) {
        await geocodificarTestigoPorPuestoYGuardar(pool, req.params.id, puesto_votacion, municipio_votacion, departamento_votacion);
      }
    } else {
      const cambioUbicacion = (direccion || '') !== (fila.direccion_anterior || '')
        || (comuna_corregimiento_residencia || '') !== (fila.comuna_residencia_anterior || '')
        || (barrio_residencia || '') !== (fila.barrio_residencia_anterior || '');
      if (cambioUbicacion) {
        await geocodificarResidenciaYGuardar(req.params.id, direccion, comuna_corregimiento_residencia, barrio_residencia, departamento_residencia, ciudad_residencia);
      }
    }

    // Se recalcula: la propia persona editada (por si es un Coordinador
    // Organizaciones al que se le cambió su piso manual), el supervisor
    // anterior, y el nuevo si cambió — la función internamente no hace
    // nada si ese usuario no es, en efecto, un Coordinador Organizaciones.
    await recalcularMetaVotosCoordinadorOrganizaciones(pool, fila.usuario_id);
    await recalcularMetaVotosCoordinadorOrganizaciones(pool, fila.supervisor_id_anterior);
    if (supervisor_id && supervisor_id !== fila.supervisor_id_anterior) {
      await recalcularMetaVotosCoordinadorOrganizaciones(pool, supervisor_id);
    }
    // "Lleva también los datos a Votante" — igual que al crear.
    await sincronizarVotanteDesdeEstructura(pool, {
      nombre, numero_identificacion, telefono, email, genero, edad, apoya_a,
      departamento_votacion, municipio_votacion, puesto_votacion, mesa_votacion,
      departamento_residencia, ciudad_residencia, direccion, territorio_id,
      creado_por: req.session.usuario.id
    });

    res.json({ ok: true });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    let msg = err.message || 'Error actualizando el registro.';
    if (err.code === 'ER_DUP_ENTRY') {
      msg = (err.sqlMessage || '').includes('numero_identificacion')
        ? 'Ya registrado por otro líder.'
        : 'Ya existe un usuario con ese email.';
    }
    res.status(400).json({ error: msg });
  } finally {
    conexion.release();
  }
});

/**
 * Asigna, ADEMÁS de su cargo actual, la capacidad de testigo electoral a
 * una persona ya registrada en Estructura territorial (ej. un Líder que
 * también es testigo) — sin tocar su fila de Estructura existente, se le
 * agrega una fila nueva con cargo='testigo'. Ver tieneDobleRolTestigo en
 * auth.routes.js: al iniciar sesión se le preguntará con cuál de las dos
 * capacidades quiere entrar.
 */
router.post('/estructura/:id/asignar-testigo', requireRole('admin', 'coordinador'), async (req, res) => {
  // Departamento/Municipio ya no se reciben: se deducen del puesto contra
  // el catálogo territorial. El formulario solo dice DÓNDE VIGILA.
  const { puesto_votacion, mesa_votacion, tipo_testigo, mesas_asignadas } = req.body;
  try {
    const [[fila]] = await pool.query(`SELECT usuario_id, cargo FROM estructura WHERE id = ?`, [req.params.id]);
    if (!fila) return res.status(404).json({ error: 'Registro no encontrado.' });
    if (fila.cargo === 'testigo') {
      return res.status(400).json({ error: 'Esta persona ya está registrada como testigo electoral.' });
    }
    // actualizarSiExiste: este endpoint también sirve para CAMBIARLE el
    // puesto/mesa a quien ya es testigo, no solo para asignárselo la
    // primera vez.
    const resultado = await asegurarEstructuraTestigo(pool, fila.usuario_id, {
      puesto_votacion, mesa_votacion
    }, tipo_testigo, Array.isArray(mesas_asignadas) ? mesas_asignadas : [], { actualizarSiExiste: true });
    if (resultado.conflicto) {
      return res.status(400).json({ error: `La(s) mesa(s) ${resultado.conflicto.join(', ')} ya están asignadas a otro testigo de ese puesto.` });
    }
    if (!resultado.creado && !resultado.actualizado) {
      return res.status(400).json({ error: 'No se pudo guardar la asignación como testigo electoral.' });
    }
    await registrarAuditoria(
      req.session.usuario.id, 'asignar_testigo', 'estructura', req.params.id,
      `Se le asignó la capacidad de testigo electoral a la persona con Estructura #${req.params.id}.`, req.ip
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error asignando la capacidad de testigo electoral.' });
  }
});

// Elimina el registro de estructura Y el usuario asociado (antes solo se
// borraba la fila de estructura, dejando el usuario activo — por eso seguía
// apareciendo en los desplegables de "Reporta a", "Líder", etc., que se
// alimentan de la tabla usuarios). Los FK de supervisor_id/lider_id son
// ON DELETE SET NULL, así que esto no rompe otros registros.
router.delete('/estructura/:id', requireRole('admin', 'coordinador'), async (req, res) => {
  /* SE CONFIRMA CON LA CONTRASEÑA DE QUIEN LO ESTA HACIENDO, igual que al
     borrar un votante (DELETE /votantes/:id).

     Aqui pesa mas que alla: esto no quita a nadie de una lista, borra la fila
     de `estructura` Y la de `usuarios` — o sea la CUENTA de esa persona, con
     su acceso. Hasta hoy no pedia nada, asi que una sesion abierta en un
     celular prestado bastaba para dejar sin cuenta a un lider de un clic.

     La suya y no la del administrador: no se le pide demostrar que conoce una
     credencial ajena, se le pide confirmar que es el.

     Va ANTES de abrir la transaccion: comprobar despues de haber tocado la
     fila no confirma nada. */
  if (!(await verificarPasswordPropia(req.session.usuario.id, req.body && req.body.password))) {
    return res.status(403).json({ error: 'Contraseña incorrecta. Escriba la suya para confirmar.' });
  }
  const conexion = await pool.getConnection();
  let supervisorIdAnterior = null;
  try {
    await conexion.beginTransaction();
    const [[fila]] = await conexion.query(`SELECT usuario_id, supervisor_id FROM estructura WHERE id = ?`, [req.params.id]);
    await conexion.query(`DELETE FROM estructura WHERE id = ?`, [req.params.id]);
    if (fila) {
      await conexion.query(`DELETE FROM usuarios WHERE id = ?`, [fila.usuario_id]);
      supervisorIdAnterior = fila.supervisor_id;
    }
    await conexion.commit();
    // Si quien se borró le reportaba a un Coordinador Organizaciones, se
    // recalcula su Meta de votos sin la contribución de esta persona.
    await recalcularMetaVotosCoordinadorOrganizaciones(pool, supervisorIdAnterior);
    res.json({ ok: true });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error eliminando el registro.' });
  } finally {
    conexion.release();
  }
});

/**
 * Elimina en bloque personas de la Estructura (y sus usuarios asociados),
 * según el tipo indicado: 'coordinador', 'lider' o 'todo' (coordinadores,
 * líderes, usuarios y testigos). Requiere la contraseña de un administrador.
 */
router.post('/estructura/eliminar-masivo', requireRole('admin', 'coordinador'), async (req, res) => {
  const { tipo, password } = req.body;
  const tiposValidos = ['coordinador', 'lider', 'todo'];
  if (!tiposValidos.includes(tipo)) {
    return res.status(400).json({ error: 'Tipo de eliminación no válido.' });
  }
  const autorizado = await verificarPasswordAdmin(password);
  if (!autorizado) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }

  const cargos = tipo === 'coordinador' ? ['coordinador']
    : tipo === 'lider' ? ['lider']
    : ['coordinador', 'lider', 'usuario', 'testigo'];

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const placeholders = cargos.map(() => '?').join(',');
    const [filas] = await conexion.query(`SELECT usuario_id FROM estructura WHERE cargo IN (${placeholders})`, cargos);
    const usuarioIds = filas.map(f => f.usuario_id);

    await conexion.query(`DELETE FROM estructura WHERE cargo IN (${placeholders})`, cargos);
    if (usuarioIds.length) {
      const ph2 = usuarioIds.map(() => '?').join(',');
      await conexion.query(`DELETE FROM usuarios WHERE id IN (${ph2})`, usuarioIds);
    }
    await conexion.commit();

    // Una eliminación en bloque puede haberse llevado gente con Tipo
    // gremial — se recalculan todos los Coordinadores Organizaciones que
    // hayan quedado, para que ninguno se quede con un total inflado por
    // gente que ya no existe.
    const [coordinadoresOrg] = await pool.query(`SELECT usuario_id FROM estructura WHERE cargo = 'coordinador_organizaciones'`);
    for (const c of coordinadoresOrg) {
      await recalcularMetaVotosCoordinadorOrganizaciones(pool, c.usuario_id);
    }

    await registrarAuditoria(
      req.session.usuario.id, 'eliminar_masivo', 'estructura', null,
      `Eliminó en bloque la estructura de tipo "${tipo}" (${usuarioIds.length} personas).`, req.ip
    );
    res.json({ ok: true, eliminados: usuarioIds.length });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error eliminando los registros.' });
  } finally {
    conexion.release();
  }
});

/**
 * Vuelve a intentar geocodificar a todas las personas de la Estructura que
 * tienen Dirección de residencia guardada pero nunca quedaron
 * georreferenciadas (geocodificado_en NULL) — típicamente porque vinieron
 * de una importación de Excel donde un error se silenciaba sin dejar
 * rastro (ya corregido), o porque el servicio de geocodificación falló en
 * su momento. Los procesa de a uno, con una pequeña pausa entre cada uno
 * para respetar el límite de uso de Nominatim/OpenStreetMap (máx. 1
 * solicitud por segundo).
 */
router.post('/estructura/regeocodificar-pendientes', requireRole('admin'), async (req, res) => {
  // Se procesa en lotes pequeños (por defecto 5 personas por solicitud) en
  // vez de todo de una vez, para que cada solicitud al servidor sea corta
  // — con reintentos ante un 429 de Nominatim, procesar muchas de un tirón
  // podría tardar varios minutos y exceder el tiempo límite del servidor o
  // del proxy. El frontend llama a este endpoint varias veces seguidas
  // hasta que "quedanPendientes" llegue a 0.
  //
  // "despues_de" es un CURSOR (el id más alto ya visitado en esta misma
  // corrida) — cada lote solo trae ids MAYORES a ese cursor, avanzando
  // siempre hacia adelante. Esto garantiza que cada persona se visite como
  // máximo una vez por corrida, sin importar si falló o si tuvo éxito —
  // a diferencia de excluir solo a los que fallaban (como se hacía antes),
  // que en el modo "todos" dejaba a los que SÍ tenían éxito sin marca
  // alguna que los sacara de la siguiente vuelta, generando un bucle sin
  // fin sobre el mismo puñado de registros.
  //
  // "todos=1" amplía el alcance: en vez de tomar solo a quienes NUNCA se
  // geocodificaron, reintenta con TODOS los que tengan Dirección — incluso
  // si ya tenían coordenadas (les pisa las que tenían). Sirve para
  // corregir en bloque a quienes quedaron mal ubicados con una versión
  // anterior de la búsqueda. Por lo delicado de sobrescribir coordenadas
  // ya existentes, este modo pide la contraseña de un administrador.
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
    const condicionGeocodificado = incluirTodos ? '' : ' AND e.geocodificado_en IS NULL';

    const [pendientes] = await pool.query(`
      SELECT e.id, e.direccion, u.comuna_corregimiento_residencia, u.barrio_residencia,
             u.departamento_residencia, u.ciudad_residencia
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.direccion IS NOT NULL AND e.direccion != '' AND e.id > ?${condicionGeocodificado}
      ORDER BY e.id LIMIT ?
    `, [despuesDe, tamanoLote]);

    const [[{ totalPendientesDespues }]] = await pool.query(`
      SELECT COUNT(*) AS totalPendientesDespues
      FROM estructura e
      WHERE e.direccion IS NOT NULL AND e.direccion != '' AND e.id > ?${condicionGeocodificado}
    `, [despuesDe]);

    let geocodificados = 0;
    const fallidos = [];
    let cursorSiguiente = despuesDe;
    for (const fila of pendientes) {
      try {
        const resultado = await geocodificarResidenciaYGuardar(
          fila.id, fila.direccion, fila.comuna_corregimiento_residencia, fila.barrio_residencia,
          fila.departamento_residencia, fila.ciudad_residencia
        );
        if (resultado.geocodificado) geocodificados++;
        else fallidos.push(fila.id);
      } catch (err) {
        console.error(`Error re-geocodificando estructura id ${fila.id}:`, err);
        fallidos.push(fila.id);
      }
      cursorSiguiente = fila.id;
      // Pausa entre solicitudes para no exceder el límite de Nominatim.
      await new Promise(resolve => setTimeout(resolve, 600)); // LocationIQ permite hasta 2/seg
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

/** Separador de miles al estilo colombiano (ej. 71.185.551) — mismo criterio
    visual que formatoMillares() en el frontend, pero se necesita también acá
    porque el Excel de Estructura se arma en el servidor. */
function formatoMillaresExcel(numero) {
  if (numero === null || numero === undefined || numero === '') return '';
  const n = Number(numero);
  return Number.isNaN(n) ? String(numero) : n.toLocaleString('es-CO');
}

/** Mismo criterio que formatoTelefonoColombia() en el frontend (### ### ####). */
function formatoTelefonoExcel(valor) {
  const digitos = (valor || '').toString().replace(/\D/g, '').slice(0, 10);
  return [digitos.slice(0, 3), digitos.slice(3, 6), digitos.slice(6, 10)].filter(Boolean).join(' ');
}

// Exporta la Estructura (coordinadores/líderes/sublíderes) a Excel. Los
// testigos electorales NO se incluyen acá: es un rol adicional que se le
// puede asignar a alguien que ya es Coordinador/Líder/Sublíder (ver
// /votantes/:id/asignar-testigo), y esa fila extra en "estructura" hacía
// que esa misma persona apareciera duplicada en este archivo — el listado
// en pantalla (Coordinadores y Líderes) ya la excluye por el mismo motivo.
router.get('/estructura/exportar-excel', requireRole('admin', 'coordinador'), async (req, res) => {
  try {
    const [filas] = await pool.query(`
      SELECT e.id AS estructura_id, u.nombre, u.numero_identificacion, u.email, u.telefono, u.genero, u.edad,
             u.departamento_residencia, u.ciudad_residencia,
             u.comuna_corregimiento_residencia, u.barrio_residencia, u.tipo_cargo,
             e.cargo, e.direccion, e.area, e.tipo_area_influencia, e.organizacion,
             t.tipo AS territorio_tipo, t.nombre AS territorio_nombre,
             padre.nombre AS pertenece,
             e.meta_votos, e.meta_votos_base, e.activo,
             ${sqlMetaEfectiva('e')} AS meta_votos_equipo,
             sup.email AS reporta_a_email
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      LEFT JOIN territorios t ON t.id = e.territorio_id
      LEFT JOIN territorios padre ON padre.id = t.padre_id
      LEFT JOIN usuarios sup ON sup.id = e.supervisor_id
      WHERE e.cargo != 'testigo'
      ORDER BY e.cargo, u.nombre
    `);

    const ETIQUETAS_GENERO = {
      mujer: 'Mujer', hombre: 'Hombre', no_binario: 'No binario', prefiero_no_responder: 'Prefiero no responder'
    };

    const columnas = [
      'ID', 'Nombre', 'Número de identificación', 'Email', 'Teléfono', 'Género', 'Edad',
      'Departamento de residencia', 'Ciudad de residencia',
      'Dirección de residencia', 'Comuna o Corregimiento (residencia)', 'Barrio o Vereda (residencia)',
      'Cargo', 'Tipo', 'Área', 'Comuna', 'Barrio', 'Corregimiento', 'Vereda', 'Organización',
      'Meta votos', 'Meta de votos (total con gremiales)', 'Reporta a', 'Activo'
    ];

    const datos = filas.map(f => {
      // Desde este parche, un Coordinador se asigna directamente a la Comuna
      // o Corregimiento (sin Barrio/Vereda); Líder/Usuario/Testigo siguen
      // asignados a un Barrio o Vereda concreto. Si el área de influencia es
      // una Organización en vez de un Territorio, estos campos quedan vacíos.
      // Lo GUARDADO manda; deducirlo del tipo de territorio es el respaldo
      // para las filas anteriores a que existiera la columna.
      let area = f.area ? (f.area === 'urbano' ? 'Urbano' : 'Rural') : '';
      let comuna = '', barrio = '', corregimiento = '', vereda = '';
      if (f.territorio_tipo === 'barrio') {
        area = 'Urbano'; comuna = f.pertenece || ''; barrio = f.territorio_nombre;
      } else if (f.territorio_tipo === 'vereda') {
        area = 'Rural'; corregimiento = f.pertenece || ''; vereda = f.territorio_nombre;
      } else if (f.territorio_tipo === 'comuna') {
        area = 'Urbano'; comuna = f.territorio_nombre;
      } else if (f.territorio_tipo === 'corregimiento') {
        area = 'Rural'; corregimiento = f.territorio_nombre;
      }
      return {
        'ID': f.estructura_id,
        'Nombre': f.nombre,
        'Número de identificación': formatoMillaresExcel(f.numero_identificacion),
        'Email': f.email,
        'Teléfono': formatoTelefonoExcel(f.telefono),
        'Género': ETIQUETAS_GENERO[f.genero] || '',
        'Edad': f.edad || '',
        'Departamento de residencia': f.departamento_residencia || '',
        'Ciudad de residencia': f.ciudad_residencia || '',
        'Dirección de residencia': f.direccion || '',
        'Comuna o Corregimiento (residencia)': f.comuna_corregimiento_residencia || '',
        'Barrio o Vereda (residencia)': f.barrio_residencia || '',
        'Cargo': f.cargo === 'coordinador_organizaciones' ? 'Coordinador Organizaciones' : (f.cargo === 'usuario' ? 'Sublíder' : (f.cargo.charAt(0).toUpperCase() + f.cargo.slice(1))),
        'Tipo': ETIQUETAS_TIPO_CARGO[f.tipo_cargo] || '',
        'Área': area,
        'Comuna': comuna,
        'Barrio': barrio,
        'Corregimiento': corregimiento,
        'Vereda': vereda,
        'Organización': f.tipo_area_influencia === 'organizacion' ? (f.organizacion || '') : '',
        // "Meta votos" es el número PROPIO de la persona (meta_votos_base)
        // — es lo que se vuelve a leer si reimportas este mismo archivo.
        // Para los cargos de meta derivada va vacío: no tienen número
        // propio, y exportar uno invitaría a reimportarlo como si contara.
        'Meta votos': CARGOS_CON_META_DERIVADA.includes(f.cargo) ? '' : f.meta_votos_base,
        // Columna solo informativa: la meta que suma el equipo de un
        // Coordinador (sus Líderes) o de un Coordinador Organizaciones
        // (sus gremiales). No se lee al reimportar — cámbiala si quieres,
        // no tiene efecto.
        'Meta de votos (total del equipo)': CARGOS_CON_META_DERIVADA.includes(f.cargo) ? (f.meta_votos_equipo ?? 0) : '',
        'Reporta a': f.reporta_a_email || '',
        'Activo': f.activo ? 'Sí' : 'No'
      };
    });

    // Si no hay registros, igual se exporta la hoja con los encabezados
    // (json_to_sheet con un arreglo vacío no genera fila de encabezado).
    const hoja = datos.length
      ? XLSX.utils.json_to_sheet(datos, { header: columnas })
      : XLSX.utils.aoa_to_sheet([columnas]);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Estructura');
    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="estructura.xlsx"');
    await registrarAuditoria(
      req.session.usuario.id, 'exportar_excel', 'estructura', null,
      `Exportó el Excel completo de la estructura (${filas.length} registros).`, req.ip
    );
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error exportando la estructura.' });
  }
});

// Importa personas a la Estructura desde un Excel con columnas: Nombre,
// Número de identificación, Email, Teléfono, Dirección de residencia, Comuna
// o Corregimiento (residencia), Barrio o Vereda (residencia), Cargo, Área,
// Comuna, Barrio, Corregimiento, Vereda, Meta votos, Reporta a (email).
// Para Cargo = Coordinador, basta con Área + Comuna (o Corregimiento); no se
// necesita Barrio/Vereda.
router.post('/estructura/importar-excel', requireRole('admin', 'coordinador'), uploadExcel.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Debe adjuntar un archivo Excel (.xlsx).' });
  try {
    const libro = XLSX.read(req.file.buffer, { type: 'buffer' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });
    const cargosValidos = ['coordinador', 'coordinador_organizaciones', 'lider', 'usuario', 'testigo'];

    let insertados = 0;
    let actualizados = 0;
    const errores = [];

    // El Área/Comuna/Barrio/Corregimiento/Vereda se repiten en muchas filas
    // (ej. varios líderes o sublíderes del mismo barrio). resolverTerritorioDesdeNombres
    // solo LEE de la tabla territorios (nunca crea ni modifica nada), así que
    // su resultado se puede reutilizar sin riesgo durante todo este import.
    const cacheResolucionTerritorio = new Map();
    async function resolverTerritorioConCache(args) {
      const clave = JSON.stringify(args);
      if (cacheResolucionTerritorio.has(clave)) return cacheResolucionTerritorio.get(clave);
      const resultado = await resolverTerritorioDesdeNombres(pool, args);
      cacheResolucionTerritorio.set(clave, resultado);
      return resultado;
    }

    for (const [i, fila] of filas.entries()) {
      const idFila = String(fila['ID'] || fila.id || '').trim() || null;
      const nombre = String(fila.Nombre || fila.nombre || '').trim();
      const email = String(fila.Email || fila.email || '').trim().toLowerCase();
      // Tolerante: si el teléfono de la fila no tiene 10 dígitos, se
      // importa la persona igual, solo que sin teléfono (no se rechaza la
      // fila completa por ese único campo).
      const telefono = normalizarTelefonoImportado(fila.Teléfono || fila.Telefono || fila.telefono || '');
      let cargo = String(fila.Cargo || fila.cargo || '').trim().toLowerCase();
      if (cargo === 'coordinador organizaciones') cargo = 'coordinador_organizaciones';
      if (cargo === 'sublíder' || cargo === 'sublider') cargo = 'usuario';
      const area = String(fila.Área || fila.Area || fila.area || '').trim();
      const comuna = String(fila.Comuna || fila.comuna || '').trim();
      const barrio = String(fila.Barrio || fila.barrio || '').trim();
      const corregimiento = String(fila.Corregimiento || fila.corregimiento || '').trim();
      const vereda = String(fila.Vereda || fila.vereda || '').trim();
      const metaVotos = fila['Meta votos'] || fila.meta_votos || 0;
      const direccion = String(fila['Dirección de residencia'] || fila.Dirección || fila.Direccion || fila.direccion || '').trim() || null;
      const reportaEmail = String(fila['Reporta a'] || fila.reporta_a || '').trim().toLowerCase();
      const numeroIdentificacion = String(fila['Número de identificación'] || fila.numero_identificacion || '').trim() || null;
      const comunaCorregimientoResidencia = String(fila['Comuna o Corregimiento (residencia)'] || fila.comuna_corregimiento_residencia || '').trim() || null;
      const barrioVeredaResidencia = String(fila['Barrio o Vereda (residencia)'] || '').trim() || null;
      const departamentoResidenciaImport = String(fila['Departamento de residencia'] || fila.departamento_residencia || '').trim() || null;
      const ciudadResidenciaImport = String(fila['Ciudad de residencia'] || fila.ciudad_residencia || '').trim() || null;
      const tipoCargoTexto = String(fila.Tipo || fila.tipo_cargo || '').trim();
      const tipoCargoNormalizado = tipoCargoTexto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const tipoCargo = CLAVES_TIPO_CARGO[tipoCargoNormalizado] || null;
      const generoTexto = String(fila.Género || fila.Genero || fila.genero || '').trim().toLowerCase();
      const MAPA_GENERO_IMPORT_ESTRUCTURA = {
        'mujer': 'mujer', 'f': 'mujer', 'femenino': 'mujer',
        'hombre': 'hombre', 'm': 'hombre', 'masculino': 'hombre',
        'no binario': 'no_binario', 'no_binario': 'no_binario', 'otro': 'no_binario',
        'prefiero no responder': 'prefiero_no_responder', 'prefiero_no_responder': 'prefiero_no_responder', 'no informa': 'prefiero_no_responder'
      };
      const genero = MAPA_GENERO_IMPORT_ESTRUCTURA[generoTexto] || 'prefiero_no_responder';
      const edad = parseInt(fila.Edad || fila.edad) || null;
      const organizacionImport = String(fila['Organización'] || fila.organizacion || '').trim() || null;
      // Un Coordinador Organizaciones no tiene territorio geográfico ni una
      // única organización obligatoria — igual que en el formulario de una
      // sola persona (ver parche 105).
      const esCoordinadorOrganizacionesImport = cargo === 'coordinador_organizaciones';
      const tipoAreaInfluenciaImport = organizacionImport ? 'organizacion' : 'territorio';

      if (!nombre || !cargosValidos.includes(cargo)) {
        errores.push({ fila: i + 2, error: 'Nombre y Cargo (Coordinador/Líder/Usuario/Testigo) son obligatorios.' });
        continue;
      }

      // Un Coordinador se asigna directamente a la Comuna o Corregimiento
      // (permitirSoloZona), sin necesidad de Barrio/Vereda. Un Coordinador
      // Organizaciones no necesita territorio en absoluto (ver parche 105).
      let territorioIdImport = null;
      if (!esCoordinadorOrganizacionesImport) {
        const resuelto = await resolverTerritorioConCache({
          area, comuna, barrio, corregimiento, vereda, permitirSoloZona: cargo === 'coordinador'
        });
        if (resuelto.error) { errores.push({ fila: i + 2, error: resuelto.error }); continue; }
        if (!resuelto.territorioId) {
          errores.push({ fila: i + 2, error: cargo === 'coordinador'
            ? 'Debe indicar Área + Comuna (o Corregimiento).'
            : 'Debe indicar Área + (Comuna y Barrio) o (Corregimiento y Vereda).' });
          continue;
        }
        territorioIdImport = resuelto.territorioId;
      } else if (comuna || barrio || corregimiento || vereda) {
        // Si a mano sí trae territorio en el Excel, se respeta (caso poco común).
        const resuelto = await resolverTerritorioConCache({ area, comuna, barrio, corregimiento, vereda, permitirSoloZona: true });
        if (!resuelto.error) territorioIdImport = resuelto.territorioId;
      }

      let supervisorId = null;
      if (reportaEmail) {
        const [[sup]] = await pool.query(`SELECT id FROM usuarios WHERE LOWER(email) = ?`, [reportaEmail]);
        if (sup) supervisorId = sup.id;
      }
      const tocarSupervisor = !!reportaEmail;

      if (idFila) {
        // --- Modo actualizar: la fila trae un ID de Estructura existente.
        // No se toca nombre_usuario, password_hash ni debe_cambiar_password
        // — actualizar datos por Excel nunca debe resetear el acceso de
        // nadie a la aplicación. ---
        try {
          const [[existente]] = await pool.query(`SELECT usuario_id, supervisor_id FROM estructura WHERE id = ?`, [idFila]);
          if (!existente) {
            errores.push({ fila: i + 2, error: `No existe un registro de Estructura con ID ${idFila} — no se puede actualizar. Borra la columna ID en esta fila si quieres crear uno nuevo.` });
            continue;
          }
          const usuarioId = existente.usuario_id;
          const supervisorIdAnteriorFila = existente.supervisor_id;
          if (numeroIdentificacion) {
            const [dupeCed] = await pool.query(`SELECT id FROM usuarios WHERE numero_identificacion = ? AND id != ?`, [numeroIdentificacion, usuarioId]);
            if (dupeCed.length) { errores.push({ fila: i + 2, error: 'Número de identificación duplicado (pertenece a otro usuario).' }); continue; }
          }
          if (email) {
            const [dupeEmail] = await pool.query(`SELECT id FROM usuarios WHERE email = ? AND id != ?`, [email, usuarioId]);
            if (dupeEmail.length) { errores.push({ fila: i + 2, error: 'Ese email ya pertenece a otro usuario.' }); continue; }
          }

          const conexion = await pool.getConnection();
          try {
            await conexion.beginTransaction();
            await conexion.query(
              `UPDATE usuarios SET nombre = ?, numero_identificacion = ?, comuna_corregimiento_residencia = ?, barrio_residencia = ?,
               departamento_residencia = ?, ciudad_residencia = ?, tipo_cargo = ?, email = ?, telefono = ?, genero = ?, edad = ? WHERE id = ?`,
              [nombre, numeroIdentificacion, comunaCorregimientoResidencia, barrioVeredaResidencia,
               departamentoResidenciaImport, ciudadResidenciaImport, tipoCargo, email || null, telefono, genero, edad, usuarioId]
            );
            await conexion.query(
              `UPDATE estructura SET territorio_id = ?, cargo = ?, supervisor_id = COALESCE(?, supervisor_id), meta_votos = ?, meta_votos_base = ?, direccion = ?,
               tipo_area_influencia = ?, organizacion = ? WHERE id = ?`,
              [territorioIdImport, cargo, tocarSupervisor ? supervisorId : null, metaVotos || 0, metaVotos || 0, direccion,
               tipoAreaInfluenciaImport, organizacionImport, idFila]
            );
            await conexion.commit();
            actualizados++;
          } catch (err) {
            await conexion.rollback();
            throw err;
          } finally {
            conexion.release();
          }

          const supervisorIdFinalFila = tocarSupervisor ? supervisorId : supervisorIdAnteriorFila;
          await recalcularMetaVotosCoordinadorOrganizaciones(pool, usuarioId);
          await recalcularMetaVotosCoordinadorOrganizaciones(pool, supervisorIdAnteriorFila);
          if (supervisorIdFinalFila && supervisorIdFinalFila !== supervisorIdAnteriorFila) {
            await recalcularMetaVotosCoordinadorOrganizaciones(pool, supervisorIdFinalFila);
          }

          geocodificarResidenciaYGuardar(idFila, direccion, comunaCorregimientoResidencia, barrioVeredaResidencia, departamentoResidenciaImport, ciudadResidenciaImport)
            .catch(err => console.error(`Error geocodificando la fila actualizada (estructura id ${idFila}):`, err));

          const votanteActualImport = await traerVotanteActualPorCedula(pool, numeroIdentificacion);
          await sincronizarVotanteDesdeEstructura(pool, {
            nombre, numero_identificacion: numeroIdentificacion, telefono, email, genero, edad,
            apoya_a: votanteActualImport ? votanteActualImport.apoya_a : [],
            departamento_votacion: votanteActualImport ? votanteActualImport.departamento_votacion : null,
            municipio_votacion: votanteActualImport ? votanteActualImport.municipio_votacion : null,
            puesto_votacion: votanteActualImport ? votanteActualImport.puesto_votacion : null,
            mesa_votacion: votanteActualImport ? votanteActualImport.mesa_votacion : null,
            departamento_residencia: departamentoResidenciaImport, ciudad_residencia: ciudadResidenciaImport,
            direccion, territorio_id: territorioIdImport, creado_por: req.session.usuario.id
          });
        } catch (err) {
          errores.push({ fila: i + 2, error: err.code === 'ER_DUP_ENTRY' ? 'Ya existe un usuario con ese email o número de identificación.' : 'Error al actualizar esta fila.' });
        }
        continue;
      }

      // Antes de crear una cuenta nueva, se busca si esta cédula/email ya
      // pertenece a alguien (ej. ya es Líder y esta fila lo está importando
      // también como Testigo) — sin esta búsqueda, importar un Excel con
      // gente que ya tenía cuenta creaba una SEGUNDA cuenta duplicada para
      // la misma persona en vez de solo agregarle el cargo nuevo a la que
      // ya tenía (bug reportado: "al asignar jurado crea doble usuario").
      let usuarioIdExistenteImport = null;
      if (numeroIdentificacion || email) {
        const [[coincidenciaImport]] = await pool.query(
          email
            ? `SELECT id FROM usuarios WHERE numero_identificacion = ? OR email = ? LIMIT 1`
            : `SELECT id FROM usuarios WHERE numero_identificacion = ? LIMIT 1`,
          email ? [numeroIdentificacion, email] : [numeroIdentificacion]
        );
        if (coincidenciaImport) usuarioIdExistenteImport = coincidenciaImport.id;
      }

      if (usuarioIdExistenteImport) {
        const [[yaTieneCargo]] = await pool.query(
          `SELECT id FROM estructura WHERE usuario_id = ? AND cargo = ?`,
          [usuarioIdExistenteImport, cargo]
        );
        if (yaTieneCargo) {
          errores.push({ fila: i + 2, error: 'Esta persona ya tiene ese cargo (usa la columna ID para actualizarla en vez de crearla de nuevo).' });
          continue;
        }
        try {
          await pool.query(
            `INSERT INTO estructura (usuario_id, territorio_id, cargo, tipo_area_influencia, organizacion, supervisor_id, meta_votos, meta_votos_base, direccion)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [usuarioIdExistenteImport, territorioIdImport, cargo, tipoAreaInfluenciaImport, organizacionImport, supervisorId, metaVotos || 0, metaVotos || 0, direccion]
          );
          if (supervisorId) await recalcularMetaVotosCoordinadorOrganizaciones(pool, supervisorId);
          await recalcularMetaVotosCoordinadorOrganizaciones(pool, usuarioIdExistenteImport);
          insertados++;

          const votanteActualImportCargo = await traerVotanteActualPorCedula(pool, numeroIdentificacion);
          await sincronizarVotanteDesdeEstructura(pool, {
            nombre, numero_identificacion: numeroIdentificacion, telefono, email, genero, edad,
            apoya_a: votanteActualImportCargo ? votanteActualImportCargo.apoya_a : [],
            departamento_votacion: votanteActualImportCargo ? votanteActualImportCargo.departamento_votacion : null,
            municipio_votacion: votanteActualImportCargo ? votanteActualImportCargo.municipio_votacion : null,
            puesto_votacion: votanteActualImportCargo ? votanteActualImportCargo.puesto_votacion : null,
            mesa_votacion: votanteActualImportCargo ? votanteActualImportCargo.mesa_votacion : null,
            departamento_residencia: departamentoResidenciaImport, ciudad_residencia: ciudadResidenciaImport,
            direccion, territorio_id: territorioIdImport, creado_por: req.session.usuario.id
          });
        } catch (err) {
          errores.push({ fila: i + 2, error: 'Error al agregar el cargo nuevo a la cuenta ya existente.' });
        }
        continue;
      }

      const conexion = await pool.getConnection();
      let estructuraId, usuarioIdImport;
      try {
        await conexion.beginTransaction();
        const nombreRolLogin = cargo === 'coordinador_organizaciones' ? 'coordinador' : cargo;
        const [[rol]] = await conexion.query(`SELECT id FROM roles WHERE nombre = ?`, [nombreRolLogin]);
        // El correo es opcional: si no viene en el Excel, se usa el Número
        // de identificación como Nombre de usuario y contraseña inicial.
        let nombreUsuarioImport = null;
        let passwordImport;
        if (numeroIdentificacion) {
          nombreUsuarioImport = numeroIdentificacion;
          passwordImport = numeroIdentificacion;
        } else {
          passwordImport = Math.random().toString(36).slice(-10);
        }
        const hash = await bcrypt.hash(passwordImport, 12);
        const [resultUsuario] = await conexion.query(
          `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, comuna_corregimiento_residencia, barrio_residencia,
           departamento_residencia, ciudad_residencia,
           tipo_cargo, email, password_hash, rol_id, territorio_id, telefono, genero, edad, debe_cambiar_password)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [nombre, numeroIdentificacion, nombreUsuarioImport, comunaCorregimientoResidencia, barrioVeredaResidencia,
           departamentoResidenciaImport, ciudadResidenciaImport,
           tipoCargo, email || null, hash, rol.id, territorioIdImport, telefono, genero, edad]
        );
        usuarioIdImport = resultUsuario.insertId;
        const [resultEstructura] = await conexion.query(
          `INSERT INTO estructura (usuario_id, territorio_id, cargo, tipo_area_influencia, organizacion, supervisor_id, meta_votos, meta_votos_base, direccion)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [resultUsuario.insertId, territorioIdImport, cargo, tipoAreaInfluenciaImport, organizacionImport, supervisorId, metaVotos || 0, metaVotos || 0, direccion]
        );
        estructuraId = resultEstructura.insertId;
        await conexion.commit();
        insertados++;
      } catch (err) {
        await conexion.rollback();
        errores.push({ fila: i + 2, error: err.code === 'ER_DUP_ENTRY' ? 'Ya existe un usuario con ese email o número de identificación.' : 'Error al insertar esta fila.' });
        continue;
      } finally {
        conexion.release();
      }

      // La geocodificación nunca hace fallar la fila si el servicio no responde.
      geocodificarResidenciaYGuardar(estructuraId, direccion, comunaCorregimientoResidencia, barrioVeredaResidencia, departamentoResidenciaImport, ciudadResidenciaImport)
        .catch(err => console.error(`Error geocodificando la fila importada (estructura id ${estructuraId}):`, err));
      if (supervisorId) {
        await recalcularMetaVotosCoordinadorOrganizaciones(pool, supervisorId);
      }
      await recalcularMetaVotosCoordinadorOrganizaciones(pool, usuarioIdImport);

      const votanteActualImportNuevo = await traerVotanteActualPorCedula(pool, numeroIdentificacion);
      await sincronizarVotanteDesdeEstructura(pool, {
        nombre, numero_identificacion: numeroIdentificacion, telefono, email, genero, edad,
        apoya_a: votanteActualImportNuevo ? votanteActualImportNuevo.apoya_a : [],
        departamento_votacion: votanteActualImportNuevo ? votanteActualImportNuevo.departamento_votacion : null,
        municipio_votacion: votanteActualImportNuevo ? votanteActualImportNuevo.municipio_votacion : null,
        puesto_votacion: votanteActualImportNuevo ? votanteActualImportNuevo.puesto_votacion : null,
        mesa_votacion: votanteActualImportNuevo ? votanteActualImportNuevo.mesa_votacion : null,
        departamento_residencia: departamentoResidenciaImport, ciudad_residencia: ciudadResidenciaImport,
        direccion, territorio_id: territorioIdImport, creado_por: req.session.usuario.id
      });
    }

    res.json({ ok: true, insertados, actualizados, errores });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error procesando el archivo Excel. Verifique que el formato de las columnas sea correcto.' });
  }
});

// Coordinadores asignados directamente a una Comuna o Corregimiento
// (zonaId). Desde este parche, un Coordinador se asigna a la Comuna/
// Corregimiento en sí (no a un Barrio/Vereda bajo ella) — por eso la
// comparación es contra e.territorio_id directamente, no contra el padre_id
// de su territorio. Se usa para autocompletar el campo "Coordinador" en
// Nuevo evento y para el "Reporta a" automático en Agregar a la estructura.
/**
 * Los Coordinadores a los que puede reportar un Líder de esa zona,
 * EMPEZANDO POR EL MÁS CERCANO.
 *
 * Antes esto era un `territorio_id = ?` a secas, y devolvía vacío en cuanto
 * el coordinador estaba un escalón más arriba que el líder. Pasa siempre que
 * la campaña no usa la capa intermedia: en Quindío no hay ni una comuna ni
 * un corregimiento —los coordinadores están puestos en el MUNICIPIO— así que
 * un líder de Buenavista no encontraba a ninguno de los dos coordinadores de
 * Buenavista, y la pantalla caía a listar los 46 coordinadores y líderes de
 * todo el departamento.
 *
 * Ahora se sube por `padre_id` desde la zona hasta el país y se devuelven
 * los coordinadores de cada escalón, `nivel` 0 el de la zona misma. La
 * pantalla los muestra en ese orden, así que el de su propio territorio
 * queda de primero y preseleccionado.
 *
 * El límite de 6 saltos no es un número al azar: la jerarquía del catálogo
 * tiene cinco niveles (país, departamento, municipio, comuna, barrio) y uno
 * de margen. Sin él, un `padre_id` que apuntara en círculo por un error de
 * datos dejaría la consulta girando.
 */
router.get('/coordinadores-por-zona/:zonaId', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      WITH RECURSIVE cadena AS (
        SELECT id, padre_id, 0 AS nivel FROM territorios WHERE id = ?
        UNION ALL
        SELECT t.id, t.padre_id, c.nivel + 1
          FROM territorios t JOIN cadena c ON t.id = c.padre_id
         WHERE c.nivel < 6
      )
      SELECT u.id, u.nombre, c.nivel
        FROM cadena c
        JOIN estructura e ON e.territorio_id = c.id AND e.cargo = 'coordinador' AND e.activo = 1
        JOIN usuarios u ON u.id = e.usuario_id
       ORDER BY c.nivel, u.nombre
    `, [req.params.zonaId]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo coordinadores de la zona.' });
  }
});

// Persona(s) con cargo "Coordinador Organizaciones" — se usa para
// autocompletar "Reporta a" cuando el Tipo (opcional) elegido corresponde
// a un cargo gremial/asociativo/organizacional.
router.get('/coordinador-organizaciones', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.nombre
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.cargo = 'coordinador_organizaciones' AND e.activo = 1
      ORDER BY u.nombre
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo el Coordinador de Organizaciones.' });
  }
});

// Líderes asignados exactamente a un Barrio o Vereda (territorioId). Se usa
// para autocompletar el campo "Líder" en Nuevo evento apenas se elige el Barrio/Vereda.
router.get('/lideres-por-territorio/:territorioId', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.nombre
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.cargo = 'lider' AND e.activo = 1 AND e.territorio_id = ?
      ORDER BY u.nombre
    `, [req.params.territorioId]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo líderes del territorio.' });
  }
});

// Líderes candidatos para "Reporta a" al agregar un Sublíder (Agregar a la
// estructura): los asignados exactamente al Barrio/Vereda elegido, MÁS los
// que reportan al Coordinador que supervisa la Comuna/Corregimiento a la
// que pertenece ese Barrio/Vereda — una lista inicial más amplia que solo
// el barrio puntual, ya que el equipo de un Coordinador suele cubrir varios
// barrios/veredas. El formulario además permite buscar cualquier otro líder
// por nombre si no aparece aquí.
router.get('/lideres-para-sublider/:territorioId', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT u.id, u.nombre
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.cargo = 'lider' AND e.activo = 1
        AND (
          e.territorio_id = ?
          OR e.supervisor_id IN (
            SELECT ec.usuario_id
            FROM estructura ec
            JOIN territorios t ON t.id = ?
            WHERE ec.cargo = 'coordinador' AND ec.activo = 1 AND ec.territorio_id = t.padre_id
          )
        )
      ORDER BY u.nombre
    `, [req.params.territorioId, req.params.territorioId]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo líderes candidatos.' });
  }
});

/**
 * Líderes y coordinadores de un MUNICIPIO, opcionalmente acotados al área.
 *
 * Es el respaldo de la lista de "Líder o coordinador que lo refirió" cuando
 * no hay Barrio/Vereda ni Comuna/Corregimiento con qué acotar — que es
 * SIEMPRE en una campaña departamental, donde esos niveles no existen. Sin
 * esto el desplegable se quedaba con "Yo mismo / no aplica" y no había forma
 * de asignarle un líder a nadie.
 *
 * SE ACEPTAN LOS TRES SITIOS donde puede estar puesta la persona: el
 * municipio mismo, una vereda o barrio que cuelga de él, o un barrio que
 * cuelga de una comuna que cuelga de él. Mismo criterio que el filtro por
 * municipio de la lista de votantes.
 *
 * EL ÁREA SE DEDUCE CUANDO NO ESTÁ GUARDADA, y quien no la tenga ni se pueda
 * deducir ENTRA IGUAL. La columna `area` es nueva: una ficha guardada antes
 * llega vacía, y esconder a esos líderes dejaría la lista casi en blanco
 * justo en las campañas que llevan más tiempo. Mostrar de más se corrige
 * eligiendo; esconder a quien sí correspondía no se nota.
 */
router.get('/referentes-por-municipio/:municipioId', async (req, res) => {
  const area = ['urbano', 'rural'].includes(req.query.area) ? req.query.area : null;
  try {
    // EL ÁREA ORDENA, NO EXCLUYE — y esto es un cambio deliberado.
    //
    // Antes filtraba, y si no había nadie de esa área el desplegable quedaba
    // VACÍO: sin forma de asignarle un líder a nadie, y sin decir por qué.
    // Un desplegable vacío es el peor resultado posible aquí, porque bloquea
    // el registro entero.
    //
    // Y el filtro tampoco era una regla de verdad: nada impide que a alguien
    // del campo lo haya referido un líder urbano. El área es una AYUDA para
    // encontrar antes al que corresponde, no una restricción.
    //
    // Así que ahora salen todos los del municipio, con los del área elegida
    // ARRIBA. Se devuelve `area` en cada uno para que la pantalla pueda
    // decir cuál es cuál.
    const expresionArea = `COALESCE(
      e.area,
      CASE WHEN t.tipo IN ('barrio', 'comuna') THEN 'urbano'
           WHEN t.tipo IN ('vereda', 'corregimiento') THEN 'rural' END)`;
    // LA ORDENACIÓN VA EN UNA CONSULTA DE AFUERA, y no es un rodeo: con
    // DISTINCT, MySQL no deja ordenar por una expresión que no esté en la
    // selección, y si se usa el alias lo resuelve a la COLUMNA e.area, que
    // tampoco está seleccionada. Las dos formas dan el mismo error. Sacando
    // el DISTINCT a una subconsulta, la de afuera ordena por una columna que
    // sin duda existe.
    //
    // (Se descubrió llamando a la ruta. Escrita a mano la consulta parecía
    // correcta las dos veces.)
    const [rows] = await pool.query(`
      SELECT * FROM (
        SELECT DISTINCT u.id, u.nombre, e.cargo, ${expresionArea} AS area
          FROM estructura e
          JOIN usuarios u ON u.id = e.usuario_id
          LEFT JOIN territorios t ON t.id = e.territorio_id
          LEFT JOIN territorios padre ON padre.id = t.padre_id
         WHERE e.activo = 1
           AND e.cargo IN ('lider', 'coordinador')
           AND (e.territorio_id = ? OR t.padre_id = ? OR padre.padre_id = ?)
      ) x
      ORDER BY (? IS NOT NULL AND x.area = ?) DESC,
               FIELD(x.cargo, 'lider', 'coordinador'), x.nombre
    `, [req.params.municipioId, req.params.municipioId, req.params.municipioId, area, area]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo líderes del municipio.' });
  }
});

// Sublíderes (colaboradores, cargo "usuario" en la Estructura) que reportan
// a un Líder específico — para el campo "Sublíder" en Nuevo votante o sublíder.
router.get('/subliders-por-lider/:liderId', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.nombre
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.cargo = 'usuario' AND e.activo = 1 AND e.supervisor_id = ?
      ORDER BY u.nombre
    `, [req.params.liderId]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo los sublíderes del líder.' });
  }
});

// Resumen de cobertura territorial (para dashboard/mapa)
router.get('/cobertura', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.id, t.nombre, t.tipo,
             COUNT(DISTINCT CASE WHEN e.cargo = 'lider' THEN e.id END) AS lideres,
             COUNT(DISTINCT CASE WHEN e.cargo = 'coordinador' THEN e.id END) AS coordinadores,
             COUNT(DISTINCT CASE WHEN e.cargo = 'testigo' THEN e.id END) AS testigos,
             COUNT(DISTINCT v.id) AS votantes
      FROM territorios t
      LEFT JOIN estructura e ON e.territorio_id = t.id AND e.activo = 1
      LEFT JOIN votantes v ON v.territorio_id = t.id
      GROUP BY t.id
      ORDER BY t.tipo, t.nombre
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo cobertura territorial.' });
  }
});

/**
 * Entrega el token público de Mapbox (configurado en el .env) para que
 * el Mapa territorial pueda pintar los tiles de Mapbox. Es un token
 * PÚBLICO por diseño de Mapbox (se restringe por dominio desde el panel
 * de Mapbox, no ocultándolo del navegador) — no es un secreto como las
 * demás API Keys del sistema.
 */
router.get('/mapbox-token', requireRole('admin', 'coordinador', 'aspirante'), (req, res) => {
  res.json({ token: process.env.MAPBOX_ACCESS_TOKEN || null });
});

/**
 * Datos georreferenciados para el Mapa territorial: junta estructura
 * (coordinadores/líderes/testigos/usuarios) y votantes/contactos que ya
 * tengan latitud/longitud. Solo admin/coordinador, porque expone
 * ubicaciones exactas de personas registradas en los formularios.
 */
router.get('/mapa-personas', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  try {
    /* ESTE MAPA ES LA CONSULTA MÁS REVELADORA DE LA APLICACIÓN.
       Devuelve la estructura y los votantes con DIRECCIÓN Y COORDENADAS: una
       sola llamada y se sabe dónde vive cada persona de la campaña. Le bastaba
       con `admin, coordinador` porque nadie más llegaba.

       Al abrírselo al aspirante hay que acotarlo en las tres consultas, no en
       una. Su rama de votantes no le sirve a la de estructura —son tablas
       distintas y se cuelgan distinto— y los eventos no son suyos en absoluto:
       son de la campaña madre, y él ni siquiera tiene ese módulo. */
    const suyo = req.sublicencia ? req.sublicencia.usuario_id : null;
    const enEstructura = suyo ? subarbolSql(suyo, 'e.usuario_id') : null;
    const enVotantes = suyo
      ? condicionAlcanceVotantes({ cargo: 'aspirante', usuarioId: suyo }, 'v')
      : null;
    const parVotantes = suyo
      ? parametrosAlcanceVotantes({ cargo: 'aspirante', usuarioId: suyo })
      : [];

    const [estructura] = await pool.query(`
      SELECT e.id, u.nombre, e.cargo, e.direccion, e.latitud, e.longitud,
             t.nombre AS territorio_nombre
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      LEFT JOIN territorios t ON t.id = e.territorio_id
      WHERE e.latitud IS NOT NULL AND e.longitud IS NOT NULL AND e.activo = 1
      ${enEstructura ? 'AND ' + enEstructura.sql : ''}
    `, enEstructura ? enEstructura.valores : []);
    const [votantes] = await pool.query(`
      SELECT v.id, v.nombre,
             v.direccion, v.latitud, v.longitud, t.nombre AS territorio_nombre
      FROM votantes v
      LEFT JOIN territorios t ON t.id = v.territorio_id
      WHERE v.latitud IS NOT NULL AND v.longitud IS NOT NULL
      ${enVotantes ? 'AND ' + enVotantes : ''}
    `, parVotantes);
    // Los eventos son de la campaña madre. Para el aspirante, ninguno — y una
    // lista vacía es la respuesta correcta, no un error: el mapa se pinta igual.
    const [eventos] = suyo ? [[]] : await pool.query(`
      SELECT e.id, e.titulo, e.tipo, e.fecha_inicio, e.lugar, e.latitud, e.longitud,
             t.nombre AS territorio_nombre
      FROM eventos e
      LEFT JOIN territorios t ON t.id = e.territorio_id
      WHERE e.latitud IS NOT NULL AND e.longitud IS NOT NULL
    `);
    res.json({ estructura, votantes, eventos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo los datos del mapa.' });
  }
});

// ================= Testigos electorales (página propia, aparte de Estructura territorial) =================
// Un testigo no tiene territorio/barrio, meta de votos ni "reporta a" — su
// dato relevante es dónde vigila (departamento/municipio/puesto/mesa de
// votación) — por eso tiene su propia lista, exportación e importación, en
// vez de compartir las de Estructura territorial (pensadas para Coordinador/
// Líder/Sublíder, con columnas que no aplican acá).

router.get('/testigos', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  try {
    /* EL ASPIRANTE VE LOS SUYOS, NO LA NÓMINA DE LA MADRE.
       Esta consulta devolvía TODOS los testigos de la campaña — le bastaba a
       admin y coordinador. Dejar entrar al aspirante sin este filtro le habría
       entregado la lista completa de testigos de la alcaldía con cédula y
       teléfono, que es exactamente lo que la sublicencia existe para separar. */
    const acota = req.sublicencia
      ? subarbolSql(req.sublicencia.usuario_id, 'e.usuario_id') : null;
    const [rows] = await pool.query(`
      SELECT e.id, e.tipo_testigo, e.mesas_asignadas, u.nombre, u.numero_identificacion, u.telefono, u.email,
             COALESCE(e.departamento_votacion, u.departamento_votacion) AS departamento_votacion,
             COALESCE(e.municipio_votacion, u.municipio_votacion) AS municipio_votacion,
             COALESCE(e.puesto_votacion, u.puesto_votacion) AS puesto_votacion,
             COALESCE(e.mesa_votacion, u.mesa_votacion) AS mesa_votacion,
             e.activo
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.cargo = 'testigo'
      ${acota ? 'AND ' + acota.sql : ''}
      ORDER BY u.nombre
    `, acota ? acota.valores : []);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo los testigos.' });
  }
});

router.get('/testigos/exportar-excel', requireRole('admin', 'coordinador'), async (req, res) => {
  try {
    const [filas] = await pool.query(`
      SELECT e.id, e.tipo_testigo, e.mesas_asignadas, u.nombre, u.numero_identificacion, u.telefono, u.email,
             COALESCE(e.departamento_votacion, u.departamento_votacion) AS departamento_votacion,
             COALESCE(e.municipio_votacion, u.municipio_votacion) AS municipio_votacion,
             COALESCE(e.puesto_votacion, u.puesto_votacion) AS puesto_votacion,
             COALESCE(e.mesa_votacion, u.mesa_votacion) AS mesa_votacion,
             e.activo
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.cargo = 'testigo'
      ORDER BY u.nombre
    `);
    const columnas = ['ID', 'Tipo', 'Nombre', 'Número de identificación', 'Teléfono', 'Email', 'Departamento votación', 'Municipio votación', 'Puesto', 'Mesa', 'Activo'];
    const datos = filas.map(f => ({
      'ID': f.id,
      'Tipo': f.tipo_testigo === 'puesto' ? 'Coordinador de puesto' : 'Testigo electoral',
      'Nombre': f.nombre,
      'Número de identificación': f.numero_identificacion || '',
      'Teléfono': f.telefono || '',
      'Email': f.email || '',
      'Departamento votación': f.departamento_votacion || '',
      'Municipio votación': f.municipio_votacion || '',
      'Puesto': f.puesto_votacion || '',
      'Mesa': f.tipo_testigo === 'puesto' ? (f.mesas_asignadas || []).join(', ') : (f.mesa_votacion || ''),
      'Activo': f.activo ? 'Sí' : 'No'
    }));
    const hoja = datos.length
      ? XLSX.utils.json_to_sheet(datos, { header: columnas })
      : XLSX.utils.aoa_to_sheet([columnas]);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Testigos');
    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="testigos.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error exportando los testigos.' });
  }
});

// Importa/actualiza testigos desde un Excel con columnas: ID (opcional, solo
// para actualizar uno ya existente), Nombre, Número de identificación,
// Teléfono, Email, Departamento votación, Municipio votación, Puesto, Mesa.
router.post('/testigos/importar-excel', requireRole('admin', 'coordinador'), uploadExcel.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Debe adjuntar un archivo Excel (.xlsx).' });
  try {
    const libro = XLSX.read(req.file.buffer, { type: 'buffer' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });

    let insertados = 0;
    let actualizados = 0;
    const errores = [];

    for (const [i, fila] of filas.entries()) {
      const idFila = String(fila['ID'] || fila.id || '').trim() || null;
      const nombre = String(fila.Nombre || fila.nombre || '').trim();
      if (!nombre) {
        errores.push({ fila: i + 2, error: 'Nombre es obligatorio.' });
        continue;
      }
      const cedula = String(fila['Número de identificación'] || fila.Cédula || fila.Cedula || fila.cedula || '').trim() || null;
      const telefono = String(fila.Teléfono || fila.Telefono || fila.telefono || '').replace(/\D/g, '') || null;
      if (telefono && telefono.length !== 10) {
        errores.push({ fila: i + 2, error: 'El teléfono debe tener 10 dígitos — se importó sin teléfono.' });
      }
      const email = String(fila.Email || fila.email || '').trim().toLowerCase() || null;
      const departamentoVotacion = String(fila['Departamento votación'] || fila.departamento_votacion || '').trim() || null;
      const municipioVotacion = String(fila['Municipio votación'] || fila.municipio_votacion || '').trim() || null;
      const puestoVotacion = String(fila.Puesto || fila.puesto_votacion || '').trim() || null;
      // "Coordinador de puesto" cubre varias mesas del mismo puesto — no una
      // fija: la columna "Mesa" se interpreta como una lista separada por
      // comas ("3, 7, 9") en vez de un solo número.
      const tipoTestigoTexto = String(fila.Tipo || fila.tipo || '').trim().toLowerCase();
      const tipoTestigo = tipoTestigoTexto.includes('coordinador') ? 'puesto' : 'mesa';
      const mesaTexto = String(fila.Mesa || fila.mesa_votacion || '').trim();
      const mesaVotacion = tipoTestigo === 'puesto' ? null : (mesaTexto || null);
      const mesasAsignadas = tipoTestigo === 'puesto'
        ? mesaTexto.split(',').map(m => Number(m.trim())).filter(m => Number.isInteger(m) && m > 0)
        : [];

      const mesasSolicitadas = tipoTestigo === 'puesto' ? mesasAsignadas : (mesaVotacion ? [mesaVotacion] : []);
      const conflicto = await verificarMesasDisponibles(pool, puestoVotacion, mesasSolicitadas, idFila || 0);
      if (conflicto.length) {
        errores.push({ fila: i + 2, error: `La(s) mesa(s) ${conflicto.join(', ')} ya están asignadas a otro testigo de ese puesto.` });
        continue;
      }

      try {
        if (idFila) {
          const [[existente]] = await pool.query(
            `SELECT e.usuario_id FROM estructura e WHERE e.id = ? AND e.cargo = 'testigo'`,
            [idFila]
          );
          if (!existente) {
            errores.push({ fila: i + 2, error: `No existe un testigo con ID ${idFila}.` });
            continue;
          }
          if (cedula) {
            const [dupe] = await pool.query(`SELECT id FROM usuarios WHERE numero_identificacion = ? AND id != ?`, [cedula, existente.usuario_id]);
            if (dupe.length) { errores.push({ fila: i + 2, error: 'Número de identificación duplicado (pertenece a otra persona).' }); continue; }
          }
          await pool.query(
            `UPDATE usuarios SET nombre = ?, numero_identificacion = ?, telefono = ?, email = ?,
               departamento_votacion = ?, municipio_votacion = ?, puesto_votacion = ?, mesa_votacion = ?
             WHERE id = ?`,
            [nombre, cedula, telefono ? telefono.slice(0, 10) : null, email,
             departamentoVotacion, municipioVotacion, puestoVotacion, mesaVotacion, existente.usuario_id]
          );
          await pool.query(
            `UPDATE estructura SET tipo_testigo = ?, mesas_asignadas = ? WHERE id = ?`,
            [tipoTestigo, tipoTestigo === 'puesto' ? JSON.stringify(mesasAsignadas) : null, idFila]
          );
          await geocodificarTestigoPorPuestoYGuardar(pool, idFila, puestoVotacion, municipioVotacion, departamentoVotacion);
          actualizados++;
        } else {
          // Antes de crear una cuenta nueva, se busca si esta cédula/email ya
          // pertenece a alguien (ej. ya es Líder, Coordinador o Sublíder) —
          // si no se hacía esta búsqueda, importar un Excel de jurados con
          // gente que ya tenía cuenta creaba una SEGUNDA cuenta duplicada
          // para la misma persona en vez de solo agregarle la capacidad de
          // testigo a la que ya tenía.
          let usuarioIdExistente = null;
          if (cedula || email) {
            const [[coincidencia]] = await pool.query(
              email
                ? `SELECT id FROM usuarios WHERE numero_identificacion = ? OR email = ? LIMIT 1`
                : `SELECT id FROM usuarios WHERE numero_identificacion = ? LIMIT 1`,
              email ? [cedula, email] : [cedula]
            );
            if (coincidencia) usuarioIdExistente = coincidencia.id;
          }

          if (usuarioIdExistente) {
            const resultado = await asegurarEstructuraTestigo(pool, usuarioIdExistente, {
              puesto_votacion: puestoVotacion, mesa_votacion: mesaVotacion
            }, tipoTestigo, mesasAsignadas);
            if (resultado.conflicto) {
              errores.push({ fila: i + 2, error: `La(s) mesa(s) ${resultado.conflicto.join(', ')} ya están asignadas a otro testigo de ese puesto.` });
              continue;
            }
            if (!resultado.creado) {
              errores.push({ fila: i + 2, error: 'Esta persona ya está registrada como testigo electoral.' });
              continue;
            }
            insertados++;
            continue;
          }

          const numeroIdentificacionLimpio = cedula || '';
          const passwordFinal = numeroIdentificacionLimpio || Math.random().toString(36).slice(-10);
          const hash = await bcrypt.hash(passwordFinal, 12);
          const [[rolTestigo]] = await pool.query(`SELECT id FROM roles WHERE nombre = 'testigo'`);
          if (!rolTestigo) { errores.push({ fila: i + 2, error: 'El rol "testigo" no está configurado.' }); continue; }

          const [resultUsuario] = await pool.query(
            `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, telefono, email,
               departamento_votacion, municipio_votacion, puesto_votacion, mesa_votacion, password_hash, rol_id, debe_cambiar_password)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [nombre, numeroIdentificacionLimpio || null, numeroIdentificacionLimpio || null, telefono, email,
             departamentoVotacion, municipioVotacion, puestoVotacion, mesaVotacion, hash, rolTestigo.id]
          );
          const [resultEstructuraTestigo] = await pool.query(
            `INSERT INTO estructura (usuario_id, cargo, tipo_testigo, mesas_asignadas, tipo_area_influencia) VALUES (?, 'testigo', ?, ?, 'territorio')`,
            [resultUsuario.insertId, tipoTestigo, tipoTestigo === 'puesto' ? JSON.stringify(mesasAsignadas) : null]
          );
          await geocodificarTestigoPorPuestoYGuardar(pool, resultEstructuraTestigo.insertId, puestoVotacion, municipioVotacion, departamentoVotacion);
          insertados++;
        }
      } catch (err) {
        errores.push({ fila: i + 2, error: err.code === 'ER_DUP_ENTRY' ? 'Número de identificación duplicado.' : 'Error al procesar esta fila.' });
      }
    }

    res.json({ ok: true, insertados, actualizados, errores });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error procesando el archivo Excel. Verifique que el formato de las columnas sea correcto.' });
  }
});

/** Elimina un solo testigo — pide contraseña de administrador, como cualquier borrado sensible de esta app. */
router.delete('/testigos/:id', requireRole('admin'), async (req, res) => {
  const autorizado = await verificarPasswordAdmin(req.body && req.body.password);
  if (!autorizado) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const [[fila]] = await conexion.query(`SELECT usuario_id FROM estructura WHERE id = ? AND cargo = 'testigo'`, [req.params.id]);
    if (!fila) {
      await conexion.rollback();
      return res.status(404).json({ error: 'No encontrado.' });
    }
    await conexion.query(`DELETE FROM estructura WHERE id = ?`, [req.params.id]);
    await conexion.query(`DELETE FROM usuarios WHERE id = ?`, [fila.usuario_id]);
    await conexion.commit();
    res.json({ ok: true });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error eliminando el testigo.' });
  } finally {
    conexion.release();
  }
});

/** Elimina TODOS los testigos — pide contraseña de administrador. */
router.post('/testigos/eliminar-todo', requireRole('admin'), async (req, res) => {
  const autorizado = await verificarPasswordAdmin(req.body && req.body.password);
  if (!autorizado) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const [filas] = await conexion.query(`SELECT usuario_id FROM estructura WHERE cargo = 'testigo'`);
    await conexion.query(`DELETE FROM estructura WHERE cargo = 'testigo'`);
    if (filas.length) {
      await conexion.query(`DELETE FROM usuarios WHERE id IN (?)`, [filas.map(f => f.usuario_id)]);
    }
    await conexion.commit();
    res.json({ ok: true, eliminados: filas.length });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error eliminando los testigos.' });
  } finally {
    conexion.release();
  }
});

module.exports = router;
