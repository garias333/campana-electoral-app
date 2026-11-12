/**
 * Dashboard de análisis de Votantes y sublíderes: agregados por Comuna/
 * Corregimiento, Barrio/Vereda, Líder, y Puesto/Mesa de votación — aparte
 * del listado de Votantes y sublíderes en sí (que solo lista personas, no
 * las analiza). Todo de solo lectura; nada de esto crea ni modifica votantes.
 */
const express = require('express');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { requireAuth, requireRole, calcularAlcance } = require('../middleware/auth');
const { requiereImportarExportar } = require('../middleware/permisoModulo');
const { calcularEstimadoPorPuesto } = require('../config/estimadoPuestos');
const { duenoDeLaCampana } = require('../lib/ramas');
const { condicionAlcanceVotantes, parametrosAlcanceVotantes, filtroAlcanceEstimado } = require('../lib/alcanceVotantes');
/* «TIENE LÍDER» / «TIENE COORDINADOR» MIRA TODOS LOS TERRITORIOS DE LA PERSONA.
   Un líder con tres barrios cubre los tres; uno con dos municipios, los dos. La
   regla de siempre se mantiene: quien está asignado a un MUNICIPIO no cubre por
   eso los barrios o veredas que cuelgan de él. Ver lib/territoriosPersona.js. */
const territoriosPersona = require('../lib/territoriosPersona');
const { generarDocumentoWord, construirBloqueSeccion } = require('../config/wordExport');
const { COLOR_MARCA, formatoMillaresServidor } = require('../config/graficosServidor');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin', 'coordinador'));
router.use(calcularAlcance);

/* A QUÉ VOTANTES LLEGA CADA QUIEN EN ESTE DASHBOARD (orden 36).
   Hasta hoy el router no llamaba a `calcularAlcance` y ninguna consulta de votantes llevaba condición: un
   coordinador veía —y exportaba— las cifras de TODA la campaña, aunque en la lista de Votantes sólo ve su rama.

   · Administrador (`cargo: 'madre'`): sin condición, como siempre. Es lo que se pidió («toda la campaña»), y NO se
     le aplica la regla de la madre que esconde las ramas de los aspirantes: eso cambiaría lo que el administrador
     ya ve aquí, y no era el encargo.
   · Coordinador: su rama (él, sus líderes y los sublíderes de éstos), la misma condición que la lista de Votantes.
   · Aspirante: lo suyo, por `rama_aspirante_id` / `votante_ramas`. (Hoy el router exige rol admin o coordinador,
     así que un aspirante no entra; si algún día entra, ya viene acotado.)
   La condición va en TODA consulta que lee `votantes`. Las de cobertura leen la estructura de territorios, no
   votantes, y quedan como están. */
function alcanceDash(req) {
  const a = req.alcance;
  if (!a || a.cargo === 'madre') return { sql: '1 = 1', par: [] };
  return { sql: condicionAlcanceVotantes(a, 'v'), par: parametrosAlcanceVotantes(a) };
}

/** El mismo alcance en la forma que espera el estimado por puesto; null (sin filtro) para el administrador. */
function alcanceEstimadoDash(req) {
  const a = req.alcance;
  if (!a || a.cargo === 'madre') return null;
  return filtroAlcanceEstimado(req);
}

/* LA ZONA DE UNA FICHA ES SU COMUNA O CORREGIMIENTO, Y SI NO TIENE, «SIN COMUNA».
   Antes «Por Comuna/Corregimiento» agrupaba por el PADRE del territorio de la ficha, sea cual sea. Las veredas del
   DANE cuelgan del MUNICIPIO (31.927 de 32.016) y una ficha asignada «a todo el municipio» cuelga del DEPARTAMENTO:
   así aparecían «MANIZALES» (6), «Caldas» (2) o «Antioquia» como si fueran comunas. El dato no estaba mal guardado;
   lo mostraba así el dashboard.
   Ahora la zona es el propio territorio si es comuna o corregimiento, o su padre si lo es; si no, no hay zona. */
const UNION_ZONA = `
      LEFT JOIN territorios padre ON padre.id = t.padre_id
      LEFT JOIN territorios z ON z.id = CASE
            WHEN t.tipo IN ('comuna','corregimiento') THEN t.id
            WHEN padre.tipo IN ('comuna','corregimiento') THEN padre.id END`;
const SIN_COMUNA = 'Sin comuna';

async function totalVotantes(A) {
  const [[r]] = await pool.query(`SELECT COUNT(*) AS total FROM votantes v WHERE ${A.sql}`, A.par);
  return r.total;
}

async function votantesPorZona(A) {
  const [filas] = await pool.query(`
      SELECT COALESCE(z.id, 0) AS zona_id, COALESCE(z.nombre, '${SIN_COMUNA}') AS zona_nombre,
             COALESCE(z.tipo, 'sin_zona') AS zona_tipo, COUNT(*) AS total
      FROM votantes v
      JOIN territorios t ON t.id = v.territorio_id ${UNION_ZONA}
      WHERE ${A.sql}
      GROUP BY COALESCE(z.id, 0), COALESCE(z.nombre, '${SIN_COMUNA}'), COALESCE(z.tipo, 'sin_zona')
      ORDER BY total DESC`, A.par);
  return filas;
}

/** zonaId: undefined/'' = todas; 0 = las que no tienen comuna; otro = esa comuna o corregimiento. */
async function votantesPorBarrio(A, zonaId) {
  const condiciones = [A.sql];
  const params = [...A.par];
  if (zonaId !== undefined && zonaId !== null && zonaId !== '') {
    if (String(zonaId) === '0') condiciones.push('z.id IS NULL');
    else { condiciones.push('z.id = ?'); params.push(zonaId); }
  }
  const [filas] = await pool.query(`
      SELECT t.id AS barrio_id, t.nombre AS barrio_nombre, t.tipo AS barrio_tipo,
             COALESCE(z.nombre, '${SIN_COMUNA}') AS zona_nombre, COUNT(*) AS total
      FROM votantes v
      JOIN territorios t ON t.id = v.territorio_id ${UNION_ZONA}
      WHERE ${condiciones.join(' AND ')}
      GROUP BY t.id, COALESCE(z.nombre, '${SIN_COMUNA}')
      ORDER BY total DESC`, params);
  return filas;
}

async function votantesPorLider(A) {
  const [lideres] = await pool.query(`
      SELECT u.id AS lider_id, u.nombre AS lider_nombre, COUNT(*) AS total
      FROM votantes v
      JOIN usuarios u ON u.id = v.lider_id
      WHERE v.lider_id IS NOT NULL AND ${A.sql}
      GROUP BY u.id
      ORDER BY total DESC`, A.par);
  const [[sinLider]] = await pool.query(`SELECT COUNT(*) AS total FROM votantes v WHERE v.lider_id IS NULL AND ${A.sql}`, A.par);
  return { lideres, sinLider: sinLider.total };
}

async function votantesPorPuestoYMesa(A) {
  const [filas] = await pool.query(`
      SELECT v.puesto_votacion AS puesto, v.mesa_votacion AS mesa, COUNT(*) AS total
      FROM votantes v
      WHERE v.puesto_votacion IS NOT NULL AND TRIM(v.puesto_votacion) <> '' AND ${A.sql}
      GROUP BY v.puesto_votacion, v.mesa_votacion
      ORDER BY v.puesto_votacion, v.mesa_votacion + 0`, A.par);
  return filas;
}

/** Lo que se escribe en la columna «Tipo» de los informes: sin zona no es ni urbano ni rural. */
function etiquetaTipoZona(tipo) {
  return tipo === 'comuna' ? 'Urbano' : (tipo === 'corregimiento' ? 'Rural' : '—');
}

router.get('/resumen', async (req, res) => {
  try {
    const total = await totalVotantes(alcanceDash(req));
    const totales = { total };
    res.json({ total: totales.total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error calculando el resumen del dashboard.' });
  }
});

/** Redondea a 1 decimal el porcentaje de "cantidad" sobre "total" (0 si el total es 0). */
function pct(cantidad, total) {
  return total > 0 ? Math.round((cantidad / total) * 1000) / 10 : 0;
}

/** Mismo texto que textoCuentaRegresivaElecciones() en public/js/common.js, pero del lado del servidor (para el botón Word, que arma el documento completo sin depender del navegador). */
function textoCuentaRegresivaServidor(fechaEleccionIso) {
  if (!fechaEleccionIso) return 'Configure la fecha en Configuración';
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fecha = new Date(fechaEleccionIso + 'T00:00:00');
  const dias = Math.round((fecha - hoy) / 86400000);
  if (dias > 1) return `Faltan ${dias} días para las elecciones`;
  if (dias === 1) return 'Falta 1 día para las elecciones';
  if (dias === 0) return '¡Hoy son las elecciones!';
  return 'Ya se realizaron las elecciones';
}

/**
 * Cobertura territorial: cuántas Comunas/Corregimientos tienen Coordinador
 * asignado (directamente sobre la Comuna/Corregimiento) y cuántos de sus
 * Barrios/Veredas hijos tienen al menos un Líder asignado.
 *
 *  - Cubierta: tiene coordinador Y el 100% de sus barrios/veredas tienen líder.
 *  - Cubrimiento parcial: tiene coordinador Y AL MENOS uno (pero no todos)
 *    de sus barrios/veredas tiene líder.
 *  - Sin cubrimiento: todo lo demás (no tiene coordinador, o tiene
 *    coordinador pero ningún barrio/vereda hijo tiene líder todavía).
 */
function clasificarCobertura(zonas, hijos) {
  const hijosPorPadre = new Map();
  for (const h of hijos) {
    if (!hijosPorPadre.has(h.padre_id)) hijosPorPadre.set(h.padre_id, []);
    hijosPorPadre.get(h.padre_id).push(h);
  }
  let cubiertas = 0, parciales = 0, sinCobertura = 0;
  for (const z of zonas) {
    const hijosZona = hijosPorPadre.get(z.id) || [];
    const conLider = hijosZona.filter(h => !!h.tiene_lider).length;
    const tieneCoordinador = !!z.tiene_coordinador;
    if (tieneCoordinador && hijosZona.length > 0 && conLider === hijosZona.length) cubiertas++;
    else if (tieneCoordinador && conLider > 0) parciales++;
    else sinCobertura++;
  }
  const total = zonas.length;
  return {
    total,
    cubiertas: { total: cubiertas, pct: pct(cubiertas, total) },
    parciales: { total: parciales, pct: pct(parciales, total) },
    sinCobertura: { total: sinCobertura, pct: pct(sinCobertura, total) }
  };
}

router.get('/cobertura', async (req, res) => {
  try {
    const puente = await territoriosPersona.hayPuente();
    const [comunas] = await pool.query(`
      SELECT c.id,
        EXISTS(SELECT 1 FROM estructura e WHERE ${territoriosPersona.sqlAsignado('e', 'c.id', puente)} AND e.cargo = 'coordinador' AND e.activo = 1) AS tiene_coordinador
      FROM territorios c WHERE c.tipo = 'comuna'
    `);
    const [barrios] = await pool.query(`
      SELECT b.id, b.padre_id,
        EXISTS(SELECT 1 FROM estructura e WHERE ${territoriosPersona.sqlAsignado('e', 'b.id', puente)} AND e.cargo = 'lider' AND e.activo = 1) AS tiene_lider
      FROM territorios b WHERE b.tipo = 'barrio'
    `);
    const [corregimientos] = await pool.query(`
      SELECT c.id,
        EXISTS(SELECT 1 FROM estructura e WHERE ${territoriosPersona.sqlAsignado('e', 'c.id', puente)} AND e.cargo = 'coordinador' AND e.activo = 1) AS tiene_coordinador
      FROM territorios c WHERE c.tipo = 'corregimiento'
    `);
    const [veredas] = await pool.query(`
      SELECT v.id, v.padre_id,
        EXISTS(SELECT 1 FROM estructura e WHERE ${territoriosPersona.sqlAsignado('e', 'v.id', puente)} AND e.cargo = 'lider' AND e.activo = 1) AS tiene_lider
      FROM territorios v WHERE v.tipo = 'vereda'
    `);

    const barriosConLider = barrios.filter(b => !!b.tiene_lider).length;
    const veredasConLider = veredas.filter(v => !!v.tiene_lider).length;

    res.json({
      comunas: clasificarCobertura(comunas, barrios),
      corregimientos: clasificarCobertura(corregimientos, veredas),
      barrios: { total: barrios.length, cubiertos: barriosConLider, pct: pct(barriosConLider, barrios.length) },
      veredas: { total: veredas.length, cubiertas: veredasConLider, pct: pct(veredasConLider, veredas.length) }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error calculando la cobertura territorial.' });
  }
});

/**
 * Igual que clasificarCobertura(), pero en vez de solo contar, arma el
 * detalle de las zonas (Comunas/Corregimientos) que caen en UN estado
 * puntual — con la lista completa de sus barrios/veredas y si cada uno
 * tiene líder o no. Es lo que consume el botón "Informe" de cada tarjeta.
 */
function detalleCoberturaPorEstado(zonas, hijos, estado) {
  const hijosPorPadre = new Map();
  for (const h of hijos) {
    if (!hijosPorPadre.has(h.padre_id)) hijosPorPadre.set(h.padre_id, []);
    hijosPorPadre.get(h.padre_id).push(h);
  }
  const resultado = [];
  for (const z of zonas) {
    const hijosZona = hijosPorPadre.get(z.id) || [];
    const conLider = hijosZona.filter(h => !!h.lider_nombre).length;
    const tieneCoordinador = !!z.tiene_coordinador;
    let estadoZona;
    if (tieneCoordinador && hijosZona.length > 0 && conLider === hijosZona.length) estadoZona = 'cubierta';
    else if (tieneCoordinador && conLider > 0) estadoZona = 'parcial';
    else estadoZona = 'sin';
    if (estadoZona === estado) {
      resultado.push({
        zona_id: z.id, zona_nombre: z.nombre,
        hijos: hijosZona.map(h => ({ nombre: h.nombre, tiene_lider: !!h.lider_nombre, lider_nombre: h.lider_nombre || null }))
      });
    }
  }
  return resultado;
}

/**
 * Trae el detalle para el botón "Informe" de una tarjeta puntual de
 * Cobertura territorial:
 *  - tipo=comuna|corregimiento (+ estado=cubierta|parcial|sin): lista de
 *    esas zonas con TODOS sus barrios/veredas y si cada uno tiene líder.
 *  - tipo=barrio|vereda: lista plana de los que SÍ tienen líder (es lo
 *    único que muestra esa tarjeta — un solo número, sin desglose de
 *    "parcial"/"sin").
 */
async function obtenerDetalleCobertura(tipo, estado) {
  const puente = await territoriosPersona.hayPuente();
  if (tipo === 'comuna' || tipo === 'corregimiento') {
    const tipoHijo = tipo === 'comuna' ? 'barrio' : 'vereda';
    const [zonas] = await pool.query(`
      SELECT c.id, c.nombre,
        EXISTS(SELECT 1 FROM estructura e WHERE ${territoriosPersona.sqlAsignado('e', 'c.id', puente)} AND e.cargo = 'coordinador' AND e.activo = 1) AS tiene_coordinador
      FROM territorios c WHERE c.tipo = ?
    `, [tipo]);
    const [hijos] = await pool.query(`
      SELECT h.id, h.nombre, h.padre_id,
        (SELECT u.nombre FROM estructura e JOIN usuarios u ON u.id = e.usuario_id
         WHERE ${territoriosPersona.sqlAsignado('e', 'h.id', puente)} AND e.cargo = 'lider' AND e.activo = 1 LIMIT 1) AS lider_nombre
      FROM territorios h WHERE h.tipo = ?
    `, [tipoHijo]);
    return { modo: 'zonas', tipoHijo, zonas: detalleCoberturaPorEstado(zonas, hijos, estado) };
  }
  if (tipo === 'barrio' || tipo === 'vereda') {
    const [hijos] = await pool.query(`
      SELECT h.id, h.nombre, padre.nombre AS zona_nombre,
        (SELECT u.nombre FROM estructura e JOIN usuarios u ON u.id = e.usuario_id
         WHERE ${territoriosPersona.sqlAsignado('e', 'h.id', puente)} AND e.cargo = 'lider' AND e.activo = 1 LIMIT 1) AS lider_nombre
      FROM territorios h LEFT JOIN territorios padre ON padre.id = h.padre_id
      WHERE h.tipo = ?
    `, [tipo]);
    return { modo: 'plano', hijos: hijos.filter(h => !!h.lider_nombre).map(h => ({ nombre: h.nombre, zona_nombre: h.zona_nombre, lider_nombre: h.lider_nombre })) };
  }
  return null;
}

router.get('/cobertura-detalle', async (req, res) => {
  try {
    const detalle = await obtenerDetalleCobertura(req.query.tipo, req.query.estado);
    if (!detalle) return res.status(400).json({ error: 'Tipo inválido.' });
    res.json(detalle);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error calculando el detalle de cobertura.' });
  }
});

router.get('/cobertura-detalle/exportar-excel', requiereImportarExportar('votantes_dashboard'), async (req, res) => {
  const { tipo } = req.query;
  try {
    const detalle = await obtenerDetalleCobertura(tipo, req.query.estado);
    if (!detalle) return res.status(400).json({ error: 'Tipo inválido.' });

    let filas = [];
    if (detalle.modo === 'zonas') {
      const etiquetaZona = tipo === 'comuna' ? 'Comuna' : 'Corregimiento';
      const etiquetaHijo = detalle.tipoHijo === 'barrio' ? 'Barrio' : 'Vereda';
      detalle.zonas.forEach(z => {
        if (!z.hijos.length) {
          filas.push({ [etiquetaZona]: z.zona_nombre, [etiquetaHijo]: '—', 'Líder asignado': '—' });
        } else {
          z.hijos.forEach(h => filas.push({
            [etiquetaZona]: z.zona_nombre, [etiquetaHijo]: h.nombre, 'Líder asignado': h.lider_nombre || 'Sin asignar'
          }));
        }
      });
    } else {
      const etiquetaHijo = tipo === 'barrio' ? 'Barrio' : 'Vereda';
      const etiquetaZona = tipo === 'barrio' ? 'Comuna' : 'Corregimiento';
      filas = detalle.hijos.map(h => ({ [etiquetaHijo]: h.nombre, [etiquetaZona]: h.zona_nombre || '—', 'Líder asignado': h.lider_nombre }));
    }

    const libro = XLSX.utils.book_new();
    const hoja = filas.length ? XLSX.utils.json_to_sheet(filas) : XLSX.utils.aoa_to_sheet([['Sin datos']]);
    XLSX.utils.book_append_sheet(libro, hoja, 'Informe cobertura');
    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="informe-cobertura.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error exportando el informe de cobertura.' });
  }
});

router.get('/cobertura-detalle/exportar-word', requiereImportarExportar('votantes_dashboard'), async (req, res) => {
  const { tipo } = req.query;
  try {
    const detalle = await obtenerDetalleCobertura(tipo, req.query.estado);
    if (!detalle) return res.status(400).json({ error: 'Tipo inválido.' });

    const secciones = [];
    if (detalle.modo === 'zonas') {
      const etiquetaZona = tipo === 'comuna' ? 'Comuna' : 'Corregimiento';
      const etiquetaHijo = detalle.tipoHijo === 'barrio' ? 'Barrio' : 'Vereda';
      if (!detalle.zonas.length) {
        secciones.push(await construirBloqueSeccion({ titulo: `${etiquetaZona}s`, tipoGrafico: null, columnas: [etiquetaHijo, 'Líder asignado'], filas: [] }));
      } else {
        for (const z of detalle.zonas) {
          secciones.push(await construirBloqueSeccion({
            titulo: `${etiquetaZona}: ${z.zona_nombre}`, tipoGrafico: null,
            columnas: [etiquetaHijo, 'Líder asignado'],
            filas: z.hijos.map(h => [h.nombre, h.tiene_lider ? h.lider_nombre : 'Sin asignar'])
          }));
        }
      }
    } else {
      const etiquetaHijo = tipo === 'barrio' ? 'Barrio' : 'Vereda';
      const etiquetaZona = tipo === 'barrio' ? 'Comuna' : 'Corregimiento';
      secciones.push(await construirBloqueSeccion({
        titulo: `${etiquetaHijo}s cubiertos`, tipoGrafico: null,
        columnas: [etiquetaHijo, etiquetaZona, 'Líder asignado'],
        filas: detalle.hijos.map(h => [h.nombre, h.zona_nombre || '—', h.lider_nombre])
      }));
    }

    const buffer = await generarDocumentoWord({ titulo: 'Informe de cobertura', subtitulo: `Generado el ${new Date().toLocaleString('es-CO')}`, secciones });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="informe-cobertura.docx"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error exportando el informe de cobertura a Word.' });
  }
});

router.get('/por-comuna', async (req, res) => {
  try {
    res.json(await votantesPorZona(alcanceDash(req)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error calculando votantes por comuna/corregimiento.' });
  }
});

router.get('/por-barrio', async (req, res) => {
  try {
    res.json(await votantesPorBarrio(alcanceDash(req), req.query.zona_id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error calculando votantes por barrio/vereda.' });
  }
});

router.get('/por-lider', async (req, res) => {
  try {
    res.json(await votantesPorLider(alcanceDash(req)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error calculando votantes por líder.' });
  }
});

// Nombre de archivo por sección — se usa tanto para el título de la hoja
// como para el nombre del .xlsx descargado.
const NOMBRES_SECCION = {
  cobertura: 'Cobertura territorial',
  comuna: 'Por comuna',
  barrio: 'Por barrio',
  lider: 'Por líder',
  puesto: 'Por puesto de votación',
  mesa: 'Por mesa'
};

router.get('/exportar-excel', requiereImportarExportar('votantes_dashboard'), async (req, res) => {
  const { seccion, puesto } = req.query;
  try {
    const puente = await territoriosPersona.hayPuente();
    const libro = XLSX.utils.book_new();
    const A = alcanceDash(req);

    // --- Exportación de UNA sola sección (botones "⬇ Excel" de cada tarjeta) ---
    if (seccion === 'cobertura') {
      const [comunas] = await pool.query(`
        SELECT c.id, EXISTS(SELECT 1 FROM estructura e WHERE ${territoriosPersona.sqlAsignado('e', 'c.id', puente)} AND e.cargo = 'coordinador' AND e.activo = 1) AS tiene_coordinador
        FROM territorios c WHERE c.tipo = 'comuna'
      `);
      const [barrios] = await pool.query(`
        SELECT b.id, b.padre_id, EXISTS(SELECT 1 FROM estructura e WHERE ${territoriosPersona.sqlAsignado('e', 'b.id', puente)} AND e.cargo = 'lider' AND e.activo = 1) AS tiene_lider
        FROM territorios b WHERE b.tipo = 'barrio'
      `);
      const [corregimientos] = await pool.query(`
        SELECT c.id, EXISTS(SELECT 1 FROM estructura e WHERE ${territoriosPersona.sqlAsignado('e', 'c.id', puente)} AND e.cargo = 'coordinador' AND e.activo = 1) AS tiene_coordinador
        FROM territorios c WHERE c.tipo = 'corregimiento'
      `);
      const [veredas] = await pool.query(`
        SELECT v.id, v.padre_id, EXISTS(SELECT 1 FROM estructura e WHERE ${territoriosPersona.sqlAsignado('e', 'v.id', puente)} AND e.cargo = 'lider' AND e.activo = 1) AS tiene_lider
        FROM territorios v WHERE v.tipo = 'vereda'
      `);
      const barriosConLider = barrios.filter(b => !!b.tiene_lider).length;
      const veredasConLider = veredas.filter(v => !!v.tiene_lider).length;
      const cobComunas = clasificarCobertura(comunas, barrios);
      const cobCorregimientos = clasificarCobertura(corregimientos, veredas);

      const filas = [
        { 'Categoría': 'Comunas', 'Estado': 'Cubiertas', 'Cantidad': cobComunas.cubiertas.total, 'Porcentaje': `${cobComunas.cubiertas.pct}%` },
        { 'Categoría': 'Comunas', 'Estado': 'Cubrimiento parcial', 'Cantidad': cobComunas.parciales.total, 'Porcentaje': `${cobComunas.parciales.pct}%` },
        { 'Categoría': 'Comunas', 'Estado': 'Sin cubrimiento', 'Cantidad': cobComunas.sinCobertura.total, 'Porcentaje': `${cobComunas.sinCobertura.pct}%` },
        { 'Categoría': 'Corregimientos', 'Estado': 'Cubiertos', 'Cantidad': cobCorregimientos.cubiertas.total, 'Porcentaje': `${cobCorregimientos.cubiertas.pct}%` },
        { 'Categoría': 'Corregimientos', 'Estado': 'Cubrimiento parcial', 'Cantidad': cobCorregimientos.parciales.total, 'Porcentaje': `${cobCorregimientos.parciales.pct}%` },
        { 'Categoría': 'Corregimientos', 'Estado': 'Sin cubrimiento', 'Cantidad': cobCorregimientos.sinCobertura.total, 'Porcentaje': `${cobCorregimientos.sinCobertura.pct}%` },
        { 'Categoría': 'Barrios', 'Estado': 'Cubiertos', 'Cantidad': `${barriosConLider} de ${barrios.length}`, 'Porcentaje': `${pct(barriosConLider, barrios.length)}%` },
        { 'Categoría': 'Veredas', 'Estado': 'Cubiertas', 'Cantidad': `${veredasConLider} de ${veredas.length}`, 'Porcentaje': `${pct(veredasConLider, veredas.length)}%` }
      ];
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas), 'Cobertura');
    } else if (seccion === 'comuna') {
      const comunas = await votantesPorZona(A);
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(
        comunas.map(f => ({ 'Comuna/Corregimiento': f.zona_nombre, 'Tipo': etiquetaTipoZona(f.zona_tipo), 'Total votantes': f.total }))
      ), 'Por comuna');
    } else if (seccion === 'barrio') {
      const barrios = await votantesPorBarrio(A);
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(
        barrios.map(f => ({ 'Barrio/Vereda': f.barrio_nombre, 'Comuna/Corregimiento': f.zona_nombre, 'Total votantes': f.total }))
      ), 'Por barrio');
    } else if (seccion === 'lider') {
      const { lideres, sinLider } = await votantesPorLider(A);
      const filas = lideres.map(f => ({ 'Líder': f.lider_nombre, 'Total votantes': f.total }));
      if (sinLider) filas.push({ 'Líder': 'Sin líder asignado', 'Total votantes': sinLider });
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas), 'Por líder');
    } else if (seccion === 'puesto') {
      // Mismo cálculo que ve la pantalla (catálogo de Día D + estimado por
      // mesa), no el groupby crudo — para que el número exportado sea
      // idéntico al que se ve en "Por Puesto de votación".
      const { puestos } = await calcularEstimadoPorPuesto(pool, alcanceEstimadoDash(req), await duenoDeLaCampana(pool, req));
      const filas = puestos.filter(p => p.total > 0).sort((a, b) => b.total - a.total)
        .map(p => ({ 'Puesto de votación': p.puesto, 'Mesas configuradas': p.cantidadMesas, 'Votantes estimados': p.total }));
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas), 'Por puesto');
    } else if (seccion === 'mesa') {
      if (!puesto) return res.status(400).json({ error: 'Elige un puesto de votación para exportar su detalle por mesa.' });
      const { puestos } = await calcularEstimadoPorPuesto(pool, alcanceEstimadoDash(req), await duenoDeLaCampana(pool, req));
      const encontrado = puestos.find(p => p.puesto === puesto);
      if (!encontrado) return res.status(404).json({ error: 'Ese puesto de votación no existe en el catálogo de Día D.' });
      const filas = encontrado.mesas.map(m => ({ 'Mesa': m.mesa, 'Votantes estimados': m.cantidad }));
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas), 'Por mesa');
    } else {
      // --- Exportación completa (botón "⬇ Exportar a Excel" del encabezado) ---
      const comunas = await votantesPorZona(A);
      const barrios = await votantesPorBarrio(A);
      const { lideres } = await votantesPorLider(A);
      const puestosCrudo = await votantesPorPuestoYMesa(A);

      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(
        comunas.map(f => ({ 'Comuna/Corregimiento': f.zona_nombre, 'Tipo': etiquetaTipoZona(f.zona_tipo), 'Total votantes': f.total }))
      ), 'Por comuna');
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(
        barrios.map(f => ({ 'Barrio/Vereda': f.barrio_nombre, 'Comuna/Corregimiento': f.zona_nombre, 'Total votantes': f.total }))
      ), 'Por barrio');
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(
        lideres.map(f => ({ 'Líder': f.lider_nombre, 'Total votantes': f.total }))
      ), 'Por líder');
      XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(
        puestosCrudo.map(f => ({ 'Puesto de votación': f.puesto, 'Mesa': f.mesa || 'Sin mesa', 'Total votantes': f.total }))
      ), 'Por puesto y mesa');
    }

    const nombreArchivo = seccion && NOMBRES_SECCION[seccion]
      ? `dashboard-votantes-${NOMBRES_SECCION[seccion].toLowerCase().replace(/[^a-z0-9]+/g, '-')}.xlsx`
      : 'dashboard-votantes.xlsx';

    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error exportando el dashboard a Excel.' });
  }
});

/**
 * Igual que /exportar-excel (mismas consultas, mismos números), pero arma
 * un documento Word: título/subtítulo, el gráfico de barras o dona (según
 * qué tenga elegido esa sección en pantalla, seg puede requestar
 * "tipo_grafico") como imagen, y la tabla de datos debajo. Ver
 * config/wordExport.js y config/graficosServidor.js.
 */
router.get('/exportar-word', requiereImportarExportar('votantes_dashboard'), async (req, res) => {
  const { seccion, puesto } = req.query;
  const tipoGraficoSeccionUnica = req.query.tipo_grafico === 'dona' ? 'dona' : 'barra';
  try {
    const puente = await territoriosPersona.hayPuente();
    const A = alcanceDash(req);
    let titulo = 'Dashboard de votantes';
    const secciones = [];

    if (seccion === 'cobertura') {
      const [comunas] = await pool.query(`
        SELECT c.id, EXISTS(SELECT 1 FROM estructura e WHERE ${territoriosPersona.sqlAsignado('e', 'c.id', puente)} AND e.cargo = 'coordinador' AND e.activo = 1) AS tiene_coordinador
        FROM territorios c WHERE c.tipo = 'comuna'
      `);
      const [barrios] = await pool.query(`
        SELECT b.id, b.padre_id, EXISTS(SELECT 1 FROM estructura e WHERE ${territoriosPersona.sqlAsignado('e', 'b.id', puente)} AND e.cargo = 'lider' AND e.activo = 1) AS tiene_lider
        FROM territorios b WHERE b.tipo = 'barrio'
      `);
      const [corregimientos] = await pool.query(`
        SELECT c.id, EXISTS(SELECT 1 FROM estructura e WHERE ${territoriosPersona.sqlAsignado('e', 'c.id', puente)} AND e.cargo = 'coordinador' AND e.activo = 1) AS tiene_coordinador
        FROM territorios c WHERE c.tipo = 'corregimiento'
      `);
      const [veredas] = await pool.query(`
        SELECT v.id, v.padre_id, EXISTS(SELECT 1 FROM estructura e WHERE ${territoriosPersona.sqlAsignado('e', 'v.id', puente)} AND e.cargo = 'lider' AND e.activo = 1) AS tiene_lider
        FROM territorios v WHERE v.tipo = 'vereda'
      `);
      const barriosConLider = barrios.filter(b => !!b.tiene_lider).length;
      const veredasConLider = veredas.filter(v => !!v.tiene_lider).length;
      const cobComunas = clasificarCobertura(comunas, barrios);
      const cobCorregimientos = clasificarCobertura(corregimientos, veredas);
      const filas = [
        ['Comunas', 'Cubiertas', cobComunas.cubiertas.total, `${cobComunas.cubiertas.pct}%`],
        ['Comunas', 'Cubrimiento parcial', cobComunas.parciales.total, `${cobComunas.parciales.pct}%`],
        ['Comunas', 'Sin cubrimiento', cobComunas.sinCobertura.total, `${cobComunas.sinCobertura.pct}%`],
        ['Corregimientos', 'Cubiertos', cobCorregimientos.cubiertas.total, `${cobCorregimientos.cubiertas.pct}%`],
        ['Corregimientos', 'Cubrimiento parcial', cobCorregimientos.parciales.total, `${cobCorregimientos.parciales.pct}%`],
        ['Corregimientos', 'Sin cubrimiento', cobCorregimientos.sinCobertura.total, `${cobCorregimientos.sinCobertura.pct}%`],
        ['Barrios', 'Cubiertos', `${barriosConLider} de ${barrios.length}`, `${pct(barriosConLider, barrios.length)}%`],
        ['Veredas', 'Cubiertas', `${veredasConLider} de ${veredas.length}`, `${pct(veredasConLider, veredas.length)}%`]
      ];
      secciones.push(await construirBloqueSeccion({
        titulo: 'Cobertura territorial',
        subtitulo: 'Comunas/Corregimientos con coordinador y todos sus barrios/veredas con líder',
        tipoGrafico: null, columnas: ['Categoría', 'Estado', 'Cantidad', 'Porcentaje'], filas
      }));
      titulo = 'Cobertura territorial';
    } else if (seccion === 'comuna') {
      const comunas = await votantesPorZona(A);
      secciones.push(await construirBloqueSeccion({
        titulo: 'Por Comuna/Corregimiento', subtitulo: '¿Dónde están concentrados los posibles votantes?',
        tipoGrafico: tipoGraficoSeccionUnica, datosGrafico: comunas.map(f => ({ etiqueta: f.zona_nombre, total: f.total })), colorBarra: COLOR_MARCA,
        columnas: ['Comuna/Corregimiento', 'Tipo', 'Total votantes'],
        filas: comunas.map(f => [f.zona_nombre, etiquetaTipoZona(f.zona_tipo), f.total])
      }));
      titulo = 'Por Comuna/Corregimiento';
    } else if (seccion === 'barrio') {
      const barrios = await votantesPorBarrio(A);
      secciones.push(await construirBloqueSeccion({
        titulo: 'Por Barrio/Vereda', subtitulo: 'Detalle dentro de una Comuna/Corregimiento, o de toda la base.',
        tipoGrafico: tipoGraficoSeccionUnica, datosGrafico: barrios.map(f => ({ etiqueta: f.barrio_nombre, total: f.total })), colorBarra: COLOR_MARCA,
        columnas: ['Barrio/Vereda', 'Comuna/Corregimiento', 'Total votantes'],
        filas: barrios.map(f => [f.barrio_nombre, f.zona_nombre, f.total])
      }));
      titulo = 'Por Barrio/Vereda';
    } else if (seccion === 'lider') {
      const { lideres, sinLider } = await votantesPorLider(A);
      const datosGrafico = lideres.map(f => ({ etiqueta: f.lider_nombre, total: f.total }));
      const filas = lideres.map(f => [f.lider_nombre, f.total]);
      if (sinLider) { datosGrafico.push({ etiqueta: 'Sin líder asignado', total: sinLider }); filas.push(['Sin líder asignado', sinLider]); }
      secciones.push(await construirBloqueSeccion({
        titulo: 'Por Líder', subtitulo: '¿Quién ha referido más posibles votantes?',
        tipoGrafico: tipoGraficoSeccionUnica, datosGrafico, colorBarra: COLOR_MARCA,
        columnas: ['Líder', 'Total votantes'], filas
      }));
      titulo = 'Por Líder';
    } else if (seccion === 'puesto') {
      const { puestos } = await calcularEstimadoPorPuesto(pool, alcanceEstimadoDash(req), await duenoDeLaCampana(pool, req));
      const filtrados = puestos.filter(p => p.total > 0).sort((a, b) => b.total - a.total);
      secciones.push(await construirBloqueSeccion({
        titulo: 'Por Puesto de votación', subtitulo: 'Estimado de cuántos votarían en cada puesto, según lo que cada persona escribió en "Lugar de votación".',
        tipoGrafico: tipoGraficoSeccionUnica, datosGrafico: filtrados.map(p => ({ etiqueta: p.puesto, total: p.total })), colorBarra: COLOR_MARCA,
        columnas: ['Puesto de votación', 'Mesas configuradas', 'Votantes estimados'],
        filas: filtrados.map(p => [p.puesto, p.cantidadMesas, p.total])
      }));
      titulo = 'Por Puesto de votación';
    } else if (seccion === 'mesa') {
      if (!puesto) return res.status(400).json({ error: 'Elige un puesto de votación para exportar su detalle por mesa.' });
      const { puestos } = await calcularEstimadoPorPuesto(pool, alcanceEstimadoDash(req), await duenoDeLaCampana(pool, req));
      const encontrado = puestos.find(p => p.puesto === puesto);
      if (!encontrado) return res.status(404).json({ error: 'Ese puesto de votación no existe en el catálogo de Día D.' });
      secciones.push(await construirBloqueSeccion({
        titulo: `Por Mesa — ${puesto}`, subtitulo: 'Elige un Puesto de votación para ver cómo se reparten sus mesas.',
        tipoGrafico: 'barra', datosGrafico: encontrado.mesas.map(m => ({ etiqueta: `Mesa ${m.mesa}`, total: m.cantidad })), colorBarra: COLOR_MARCA,
        columnas: ['Mesa', 'Votantes estimados'], filas: encontrado.mesas.map(m => [`Mesa ${m.mesa}`, m.cantidad])
      }));
      titulo = `Por Mesa — ${puesto}`;
    } else {
      // --- Documento completo (botón "Word" del encabezado) ---
      const totalRow = { total: await totalVotantes(A) };
      const [[config]] = await pool.query('SELECT fecha_eleccion FROM configuracion_campana WHERE id = 1');
      secciones.push(await construirBloqueSeccion({
        titulo: 'Resumen', tipoGrafico: null,
        columnas: ['Indicador', 'Valor'],
        filas: [
          ['Cuenta regresiva', textoCuentaRegresivaServidor(config && config.fecha_eleccion)],
          ['Total registros', formatoMillaresServidor(totalRow.total)]
        ]
      }));

      const [comunasCob] = await pool.query(`
        SELECT c.id, EXISTS(SELECT 1 FROM estructura e WHERE ${territoriosPersona.sqlAsignado('e', 'c.id', puente)} AND e.cargo = 'coordinador' AND e.activo = 1) AS tiene_coordinador
        FROM territorios c WHERE c.tipo = 'comuna'
      `);
      const [barriosCob] = await pool.query(`
        SELECT b.id, b.padre_id, EXISTS(SELECT 1 FROM estructura e WHERE ${territoriosPersona.sqlAsignado('e', 'b.id', puente)} AND e.cargo = 'lider' AND e.activo = 1) AS tiene_lider
        FROM territorios b WHERE b.tipo = 'barrio'
      `);
      const [corregimientosCob] = await pool.query(`
        SELECT c.id, EXISTS(SELECT 1 FROM estructura e WHERE ${territoriosPersona.sqlAsignado('e', 'c.id', puente)} AND e.cargo = 'coordinador' AND e.activo = 1) AS tiene_coordinador
        FROM territorios c WHERE c.tipo = 'corregimiento'
      `);
      const [veredasCob] = await pool.query(`
        SELECT v.id, v.padre_id, EXISTS(SELECT 1 FROM estructura e WHERE ${territoriosPersona.sqlAsignado('e', 'v.id', puente)} AND e.cargo = 'lider' AND e.activo = 1) AS tiene_lider
        FROM territorios v WHERE v.tipo = 'vereda'
      `);
      const barriosConLiderCob = barriosCob.filter(b => !!b.tiene_lider).length;
      const veredasConLiderCob = veredasCob.filter(v => !!v.tiene_lider).length;
      const cobComunasT = clasificarCobertura(comunasCob, barriosCob);
      const cobCorregimientosT = clasificarCobertura(corregimientosCob, veredasCob);
      secciones.push(await construirBloqueSeccion({
        titulo: 'Cobertura territorial', subtitulo: 'Comunas/Corregimientos con coordinador y todos sus barrios/veredas con líder',
        tipoGrafico: null, columnas: ['Categoría', 'Estado', 'Cantidad', 'Porcentaje'],
        filas: [
          ['Comunas', 'Cubiertas', cobComunasT.cubiertas.total, `${cobComunasT.cubiertas.pct}%`],
          ['Comunas', 'Cubrimiento parcial', cobComunasT.parciales.total, `${cobComunasT.parciales.pct}%`],
          ['Comunas', 'Sin cubrimiento', cobComunasT.sinCobertura.total, `${cobComunasT.sinCobertura.pct}%`],
          ['Corregimientos', 'Cubiertos', cobCorregimientosT.cubiertas.total, `${cobCorregimientosT.cubiertas.pct}%`],
          ['Corregimientos', 'Cubrimiento parcial', cobCorregimientosT.parciales.total, `${cobCorregimientosT.parciales.pct}%`],
          ['Corregimientos', 'Sin cubrimiento', cobCorregimientosT.sinCobertura.total, `${cobCorregimientosT.sinCobertura.pct}%`],
          ['Barrios', 'Cubiertos', `${barriosConLiderCob} de ${barriosCob.length}`, `${pct(barriosConLiderCob, barriosCob.length)}%`],
          ['Veredas', 'Cubiertas', `${veredasConLiderCob} de ${veredasCob.length}`, `${pct(veredasConLiderCob, veredasCob.length)}%`]
        ]
      }));

      const comunas = await votantesPorZona(A);
      secciones.push(await construirBloqueSeccion({
        titulo: 'Por Comuna/Corregimiento', subtitulo: '¿Dónde están concentrados los posibles votantes?',
        tipoGrafico: req.query.tipo_grafico_comuna === 'dona' ? 'dona' : 'barra',
        datosGrafico: comunas.map(f => ({ etiqueta: f.zona_nombre, total: f.total })), colorBarra: COLOR_MARCA,
        columnas: ['Comuna/Corregimiento', 'Tipo', 'Total votantes'],
        filas: comunas.map(f => [f.zona_nombre, etiquetaTipoZona(f.zona_tipo), f.total])
      }));

      const barrios = await votantesPorBarrio(A);
      secciones.push(await construirBloqueSeccion({
        titulo: 'Por Barrio/Vereda', subtitulo: 'Detalle dentro de una Comuna/Corregimiento, o de toda la base.',
        tipoGrafico: req.query.tipo_grafico_barrio === 'dona' ? 'dona' : 'barra',
        datosGrafico: barrios.map(f => ({ etiqueta: f.barrio_nombre, total: f.total })), colorBarra: COLOR_MARCA,
        columnas: ['Barrio/Vereda', 'Comuna/Corregimiento', 'Total votantes'],
        filas: barrios.map(f => [f.barrio_nombre, f.zona_nombre, f.total])
      }));

      const { lideres, sinLider } = await votantesPorLider(A);
      const datosGraficoLider = lideres.map(f => ({ etiqueta: f.lider_nombre, total: f.total }));
      const filasLider = lideres.map(f => [f.lider_nombre, f.total]);
      if (sinLider) { datosGraficoLider.push({ etiqueta: 'Sin líder asignado', total: sinLider }); filasLider.push(['Sin líder asignado', sinLider]); }
      secciones.push(await construirBloqueSeccion({
        titulo: 'Por Líder', subtitulo: '¿Quién ha referido más posibles votantes?',
        tipoGrafico: req.query.tipo_grafico_lider === 'dona' ? 'dona' : 'barra',
        datosGrafico: datosGraficoLider, colorBarra: COLOR_MARCA,
        columnas: ['Líder', 'Total votantes'], filas: filasLider
      }));

      const { puestos } = await calcularEstimadoPorPuesto(pool, alcanceEstimadoDash(req), await duenoDeLaCampana(pool, req));
      const filtrados = puestos.filter(p => p.total > 0).sort((a, b) => b.total - a.total);
      secciones.push(await construirBloqueSeccion({
        titulo: 'Por Puesto de votación', subtitulo: 'Estimado de cuántos votarían en cada puesto, según lo que cada persona escribió en "Lugar de votación".',
        tipoGrafico: req.query.tipo_grafico_puesto === 'dona' ? 'dona' : 'barra',
        datosGrafico: filtrados.map(p => ({ etiqueta: p.puesto, total: p.total })), colorBarra: COLOR_MARCA,
        columnas: ['Puesto de votación', 'Mesas configuradas', 'Votantes estimados'],
        filas: filtrados.map(p => [p.puesto, p.cantidadMesas, p.total])
      }));

      const puestosCrudo = await votantesPorPuestoYMesa(A);
      secciones.push(await construirBloqueSeccion({
        titulo: 'Por Puesto y Mesa', tipoGrafico: null,
        columnas: ['Puesto de votación', 'Mesa', 'Total votantes'],
        filas: puestosCrudo.map(f => [f.puesto, f.mesa || 'Sin mesa', f.total])
      }));
    }

    const nombreArchivo = seccion && NOMBRES_SECCION[seccion]
      ? `dashboard-votantes-${NOMBRES_SECCION[seccion].toLowerCase().replace(/[^a-z0-9]+/g, '-')}.docx`
      : 'dashboard-votantes.docx';

    const buffer = await generarDocumentoWord({ titulo, subtitulo: `Generado el ${new Date().toLocaleString('es-CO')}`, secciones });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error exportando el dashboard a Word.' });
  }
});

module.exports = router;
