const express = require('express');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requiereImportarExportar } = require('../middleware/permisoModulo');
const sqlAut = require('../lib/sqlAutorizacion');
const { montarRutasAutorizacion } = require('../lib/rutasAutorizacion');
const { subarbolSql, filtroMadreEstructura, filtroTestigosMadre, recalcularRamaEnSegundoPlano } = require('../lib/ramas');
/* EL CARGO DE LA MADRE SE PIDE AQUÍ, NO SE LEE DE `req.alcance`.
   Este router monta `requireAuth` y nada más: `calcularAlcance` solo se aplica
   en routes/votantes.routes.js, así que `req.alcance` es SIEMPRE undefined en
   este archivo — comprobado. Un filtro colgado de él no se habría aplicado
   nunca y la pantalla habría seguido igual, sin dar ningún error.
   `cargoDeLaMadre()` es la misma fuente que usa el alcance, con 30 s de caché.
   (Montar `calcularAlcance` en este router habría sido la otra salida, pero
   activaría de golpe los `if (req.alcance)` dormidos de otras rutas.) */
const { cargoDeLaMadre } = require('../config/cargoMadre');

/* ¿EXISTE YA `estructura_exclusiones`? Se pregunta UNA vez por proceso.
   Sin esto, una campaña que todavía no aplicó el parche vería reventar la
   pantalla entera de Coordinadores y líderes por una tabla que no usa. Es el
   mismo criterio de `sublicenciaSobre` con `sublicencias`: lo que no está,
   no rompe. */
let _hayExclusiones = null;
async function hayExclusiones() {
  if (_hayExclusiones !== null) return _hayExclusiones;
  try {
    const [f] = await pool.query("SHOW TABLES LIKE 'estructura_exclusiones'");
    _hayExclusiones = f.length > 0;
  } catch (_) { _hayExclusiones = false; }
  return _hayExclusiones;
}
const { encolarBienvenida } = require('../config/bienvenidaAutomatica');
const { condicionAlcanceVotantes,
        parametrosAlcanceVotantes } = require('../lib/alcanceVotantes');
const { geocodificarDireccion } = require('../config/geocoder');
const { resolverTerritorioDesdeNombres } = require('../config/territorioResolver');
const { uploadExcel } = require('../middleware/upload');
const { registrarAuditoria, registrarAuditoriaEn } = require('../config/auditoria');
const {
  asegurarEstructuraTestigo, verificarMesasDisponibles, geocodificarTestigoPorPuestoYGuardar
} = require('../config/testigoElectoral');
const {
  sincronizarVotanteDesdeEstructura, traerVotanteActualPorCedula
} = require('../config/sincronizacionVotantesEstructura');
const { TIPOS_GREMIALES, CARGOS_CON_META_DERIVADA, sqlMetaEfectiva } = require('../config/metasEstructura');
/* LOS TERRITORIOS DE UNA PERSONA SE ESCRIBEN SOLO POR ESTE MÓDULO.
   `estructura.territorio_id` (el principal) y la lista de `estructura_territorios`
   tienen que moverse juntos; ningún SQL de este archivo vuelve a nombrar esa
   columna en un INSERT o un UPDATE de `estructura`. Ver lib/territoriosPersona.js. */
const territoriosPersona = require('../lib/territoriosPersona');
const { verificarPasswordAdmin, verificarPasswordPropia, validarTelefono10Digitos } = require('../config/verificaciones');
// El superadministrador no está en la estructura (lo impide un disparador de la base), pero
// estas rutas escriben en `usuarios` a partir de una fila de estructura: si algún día la
// hubiera, que no sirvan para editarlo ni borrarlo. Ver config/superadmin.js.
const { protegerObjetivo } = require('../config/superadmin');
const { territoriosEsVista } = require('../config/territoriosModo');
const {
  validarNombre, validarTipo, validarPadre, municipioDe, buscarDuplicado,
  referenciasDe, referenciasGlobales, describirReferencias, limpiarNombre, abreviar
} = require('../config/territoriosValidacion');

const { sqlDeMiRama } = require('../lib/alcanceCampanas');
const IC = require('../lib/importarCeldas');
const router = express.Router();

/**
 * LA CATEGORIA DA EL ROL. Una sola tabla, tres sitios que la usan.
 *
 *   Coordinador de territorio     -> coordinador
 *   Coordinador de organizaciones -> coordinador   (no tiene rol propio)
 *   Aspirante al Concejo          -> aspirante_concejo
 *   Lider                         -> lider
 *   Sublider                      -> usuario
 *   Testigo                       -> testigo
 *
 * «Aspirante al Concejo» no es un `cargo`: es lider + tipo_cargo, la misma
 * deduccion que hacen los botones de la pantalla. Por eso recibe los dos.
 */
function rolDeLaCategoria(cargo, tipoCargo) {
  if (cargo === 'lider' && tipoCargo === 'aspirante_concejo') return 'aspirante_concejo';
  if (cargo === 'coordinador_organizaciones') return 'coordinador';
  return cargo;
}

/**
 * QUE ROLES PUEDE CAMBIAR LA CATEGORIA, Y CUALES NO SE TOCAN NUNCA.
 *
 * Al editar una ficha de Estructura hay que reajustar el rol, porque si no
 * cambiar la categoria no cambia nada: es lo que le paso a Camilo, que paso a
 * Aspirante al Concejo y se quedo con rol `lider`.
 *
 * Pero un `admin` o un `asistente_administrativo` que ademas tenga fila de
 * Estructura NO puede ser degradado por editarle el barrio. Solo se reajustan
 * los roles que describen un puesto en la estructura.
 */
const ROLES_QUE_DA_LA_CATEGORIA = ['coordinador', 'lider', 'aspirante_concejo', 'usuario', 'sublider', 'testigo'];

/**
 * `usuario` y `sublider` son la MISMA categoria con dos nombres historicos:
 * el primero lo pone Estructura y el segundo Votantes. Tratarlos como
 * distintos haria que editar a un sublider le cambiara el rol de ida y vuelta
 * segun por que pantalla se le tocara, y con el sus filas de `permisos_rol`.
 */
function mismaCategoria(rolA, rolB) {
  const nivel = (r) => (r === 'sublider' ? 'usuario' : r);
  return nivel(rolA) === nivel(rolB);
}

router.use(requireAuth);

/**
 * En una campaña CONECTADA al Catalogo Territorial (CTC), `territorios` es una
 * VISTA de solo lectura sobre territoriosdb (vista_territorios_catalogo.sql, en
 * el proyecto del catalogo). Las seis rutas de escritura de Territorios
 * preguntan primero `territoriosEsVista()` (config/territoriosModo.js) y, si lo
 * es, responden con esto. En una campaña nueva `territorios` es una TABLA local
 * y esas rutas funcionan.
 *
 * Sin esta guarda MySQL rechaza igual la escritura sobre una vista, pero con un
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

/**
 * ¿Se pueden editar los territorios de esta campaña? Solo si `territorios` es una
 * TABLA local. En una campaña conectada al catálogo es una vista y no se edita.
 * La pantalla lo usa para mostrar u ocultar los botones de agregar e importar.
 * (config/territoriosModo.js: falla cerrado — ante la duda responde `false`.)
 */
router.get('/territorios/modo', async (req, res) => {
  res.json({ editable: !(await territoriosEsVista()) });
});

/**
 * Agrega un territorio a la tabla local. Solo corre si `territorios` es una tabla
 * (ver config/territoriosModo.js); en una campaña conectada al catálogo responde 409.
 */
router.post('/territorios', requireRole('admin', 'coordinador'), async (req, res) => {
  if (await territoriosEsVista()) return catalogoSoloLectura(res);
  const tipo = validarTipo(req.body.tipo);
  if (tipo.error) return res.status(400).json({ error: tipo.error });
  const nombre = validarNombre(req.body.nombre);
  if (nombre.error) return res.status(400).json({ error: nombre.error });
  try {
    const padre = await validarPadre(pool, tipo.valor, req.body.padre_id);
    if (padre.error) return res.status(400).json({ error: padre.error });
    if (await buscarDuplicado(pool, tipo.valor, nombre.valor, padre.padreId)) {
      return res.status(409).json({ error: 'Ya existe un territorio con ese nombre, de ese tipo, en esa ubicación.' });
    }
    const [result] = await pool.query(
      `INSERT INTO territorios (tipo, nombre, padre_id) VALUES (?, ?, ?)`,
      [tipo.valor, nombre.valor, padre.padreId]
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
 *
 * El nombre no puede pasar de 120 caracteres ni repetir uno existente (mismo
 * tipo y padre, sin distinguir mayúsculas ni tildes). Un nuevo padre debe existir,
 * ser de un tipo compatible, colgar del MISMO municipio y no crear un ciclo.
 */
router.put('/territorios/:id', requireRole('admin', 'coordinador'), async (req, res) => {
  if (await territoriosEsVista()) return catalogoSoloLectura(res);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Identificador no válido.' });
  const nombreOk = validarNombre(req.body.nombre);
  if (nombreOk.error) return res.status(400).json({ error: nombreOk.error });
  const { padre_id } = req.body;

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();

    const [[actual]] = await conexion.query(
      `SELECT tipo, nombre, padre_id FROM territorios WHERE id = ? FOR UPDATE`, [id]
    );
    if (!actual) throw new Error('Territorio no encontrado.');
    if (!['comuna', 'corregimiento', 'barrio', 'vereda'].includes(actual.tipo)) {
      throw new Error('Solo se pueden editar Comunas, Corregimientos, Barrios y Veredas.');
    }

    const nombreAnterior = actual.nombre;
    const nombreNuevo = nombreOk.valor;
    // Solo Barrio/Vereda pueden reasignarse a otra Comuna/Corregimiento;
    // para Comuna/Corregimiento el padre (Municipio) no se toca aquí.
    let padreNuevo = actual.padre_id;
    const piden = padre_id !== undefined && padre_id !== null && padre_id !== '';
    if (['barrio', 'vereda'].includes(actual.tipo) && piden && Number(padre_id) !== Number(actual.padre_id)) {
      const validacion = await validarPadre(conexion, actual.tipo, padre_id, {
        territorioId: id, municipioEsperado: await municipioDe(conexion, id)
      });
      if (validacion.error) throw new Error(validacion.error);
      padreNuevo = validacion.padreId;
    }

    if (await buscarDuplicado(conexion, actual.tipo, nombreNuevo, padreNuevo, id)) {
      throw new Error('Ya existe otro territorio con ese nombre en la misma ubicación.');
    }

    await conexion.query(
      `UPDATE territorios SET nombre = ?, padre_id = ? WHERE id = ?`,
      [nombreNuevo, padreNuevo, id]
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

/**
 * Elimina UN territorio — solo si no cuelga nada de él.
 *
 * Se rechaza con 409 si tiene hijos o si alguien lo usa como `territorio_id`
 * (usuarios, estructura, votantes, eventos, finanzas). Antes lo rechazaba MySQL por
 * las llaves foráneas; ya no existen (db/schema.sql), y sin esta comprobación el
 * borrado dejaría personas apuntando a un id que no existe. El apunte de auditoría
 * va en la misma transacción: si no se puede dejar constancia, no se borra.
 */
router.delete('/territorios/:id', requireRole('admin'), async (req, res) => {
  if (await territoriosEsVista()) return catalogoSoloLectura(res);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Identificador no válido.' });
  let conexion;
  try {
    conexion = await pool.getConnection();
    await conexion.beginTransaction();
    const [[t]] = await conexion.query(`SELECT id, tipo, nombre FROM territorios WHERE id = ? FOR UPDATE`, [id]);
    if (!t) {
      await conexion.rollback();
      return res.status(404).json({ error: 'Ese territorio ya no existe.' });
    }
    const refs = await referenciasDe(conexion, [id]);
    if (refs.hijos > 0 || refs.total > 0) {
      await conexion.rollback();
      const motivos = [];
      if (refs.hijos > 0) motivos.push(`${refs.hijos} territorio(s) que cuelgan de él`);
      if (refs.total > 0) motivos.push(describirReferencias(refs));
      return res.status(409).json({
        error: `No se puede eliminar "${t.nombre}": tiene ${motivos.join(' y ')}. ` +
               'Elimine o reasigne eso primero.',
        hijos: refs.hijos, referencias: refs.porTabla
      });
    }
    await registrarAuditoriaEn(
      conexion, req.session.usuario.id, 'eliminar_territorio', 'territorios', t.id,
      `Eliminó el territorio ${t.tipo} "${t.nombre}" (id ${t.id}).`, req.ip
    );
    await conexion.query(`DELETE FROM territorios WHERE id = ?`, [id]);
    await conexion.commit();
    res.json({ ok: true });
  } catch (err) {
    if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
    console.error(err);
    res.status(500).json({ error: err.auditoria ? err.message : 'No se pudo eliminar el territorio.' });
  } finally {
    if (conexion) conexion.release();
  }
});

/**
 * Elimina TODOS los territorios locales. Requiere la contraseña de un
 * administrador.
 *
 * Se rechaza con 409 si alguna persona, votante, evento o movimiento de finanzas
 * todavía usa un territorio: antes lo impedían las llaves foráneas, y ya no
 * existen. La comprobación y el borrado van en una transacción, con su apunte de
 * auditoría dentro: si no se puede dejar constancia, no se borra.
 */
router.post('/territorios/eliminar-todo', requireRole('admin'), async (req, res) => {
  if (await territoriosEsVista()) return catalogoSoloLectura(res);
  const { password } = req.body;
  const autorizado = await verificarPasswordAdmin(password);
  if (!autorizado) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }
  let conexion;
  try {
    conexion = await pool.getConnection();
    await conexion.beginTransaction();
    const refs = await referenciasGlobales(conexion);
    if (refs.total > 0) {
      await conexion.rollback();
      return res.status(409).json({
        error: `No se pueden eliminar los territorios: hay ${describirReferencias(refs)} que todavía dependen de alguno. ` +
               'Elimine o reasigne eso primero.',
        referencias: refs.porTabla
      });
    }
    const [[{ n }]] = await conexion.query(`SELECT COUNT(*) AS n FROM territorios`);
    if (n === 0) {
      await conexion.rollback();
      return res.json({ ok: true, eliminados: 0 });
    }
    await registrarAuditoriaEn(
      conexion, req.session.usuario.id, 'eliminar_todo', 'territorios', null,
      `Eliminó todos los territorios locales (${n} filas).`, req.ip
    );
    await conexion.query(`DELETE FROM territorios`);
    await conexion.commit();
    res.json({ ok: true, eliminados: Number(n) });
  } catch (err) {
    if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
    console.error(err);
    res.status(500).json({ error: err.auditoria ? err.message : 'Error eliminando los territorios.' });
  } finally {
    if (conexion) conexion.release();
  }
});

/**
 * Crea una zona (Comuna/Barrio/Corregimiento/Vereda) resolviendo automáticamente
 * el Departamento y Municipio como padres (los crea si aún no existen).
 *
 * Si la zona ya existe en esa ubicación responde 409 (sin distinguir mayúsculas ni
 * tildes). `padreZonaId`, si se indica, debe existir, ser una Comuna (para un Barrio)
 * o un Corregimiento (para una Vereda) y colgar de ese mismo municipio.
 */
router.post('/territorios/crear-zona', requireRole('admin', 'coordinador'), async (req, res) => {
  if (await territoriosEsVista()) return catalogoSoloLectura(res);
  const { tipoZona, padreZonaId } = req.body;
  const tiposValidos = ['comuna', 'barrio', 'corregimiento', 'vereda'];
  if (!req.body.departamento || !req.body.municipio || !tiposValidos.includes(tipoZona) || !req.body.nombreZona) {
    return res.status(400).json({ error: 'Departamento, municipio, tipo de zona y nombre son obligatorios.' });
  }
  const departamento = validarNombre(req.body.departamento, 'El departamento');
  const municipio = validarNombre(req.body.municipio, 'El municipio');
  const nombreZona = validarNombre(req.body.nombreZona, 'El nombre de la zona');
  const malo = [departamento, municipio, nombreZona].find((v) => v.error);
  if (malo) return res.status(400).json({ error: malo.error });

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const departamentoId = await buscarOCrearTerritorio(conexion, 'departamento', departamento.valor, null);
    const municipioId = await buscarOCrearTerritorio(conexion, 'municipio', municipio.valor, departamentoId);
    // Un Barrio puede colgar de una Comuna, y una Vereda de un Corregimiento;
    // si no se especifica, cuelga directamente del municipio.
    const hayPadre = padreZonaId !== undefined && padreZonaId !== null && padreZonaId !== '';
    const padre = await validarPadre(conexion, tipoZona, hayPadre ? padreZonaId : municipioId,
                                     { municipioEsperado: municipioId });
    if (padre.error) {
      await conexion.rollback();
      return res.status(400).json({ error: padre.error });
    }
    if (await buscarDuplicado(conexion, tipoZona, nombreZona.valor, padre.padreId)) {
      await conexion.rollback();
      return res.status(409).json({ error: 'Ya existe una zona con ese nombre en esa ubicación.' });
    }
    const zonaId = await buscarOCrearTerritorio(conexion, tipoZona, nombreZona.valor, padre.padreId);
    await conexion.commit();
    res.json({ ok: true, departamentoId, municipioId, zonaId });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    res.status(400).json({ error: 'No se pudo crear la zona. Revisa los datos e inténtelo de nuevo.' });
  } finally {
    conexion.release();
  }
});

// Exporta comunas/barrios/corregimientos/veredas a Excel, con su departamento,
// municipio y de qué comuna/corregimiento depende cada barrio/vereda
// (columna "Pertenece", necesaria para que la importación reconstruya la
// jerarquía correctamente).
router.get('/territorios/exportar-excel', requiereImportarExportar('territorial'), async (req, res) => {
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
router.post('/territorios/importar-excel', requireRole('admin'), requiereImportarExportar('territorial'), uploadExcel.single('archivo'), async (req, res) => {
  if (await territoriosEsVista()) return catalogoSoloLectura(res);
  if (!req.file) return res.status(400).json({ error: 'Debe adjuntar un archivo Excel (.xlsx).' });

  /* SOLO ADMINISTRADOR, Y ESTO ES DELIBERADO. `xlsx` tiene una vulnerabilidad alta
     sin arreglo publicado y esta ruta le entrega un archivo subido por la web; se
     reduce al mínimo quién puede hacerlo (igual que la importación de votantes). El
     tope de 10 MB lo pone `uploadExcel` (middleware/upload.js). */
  try {
    const libro = XLSX.read(req.file.buffer, { type: 'buffer' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });
    const tiposValidos = ['comuna', 'barrio', 'corregimiento', 'vereda'];
    const [[{ n: antes }]] = await pool.query(`SELECT COUNT(*) AS n FROM territorios`);

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
      const numFila = i + 2;   // la fila 1 del Excel es el encabezado
      let departamento = limpiarNombre(fila.Departamento || fila.departamento);
      let municipio = limpiarNombre(fila.Municipio || fila.municipio);
      const tipoOriginal = limpiarNombre(fila.Tipo || fila.tipo);
      const tipo = tipoOriginal.toLowerCase();
      const nombre = limpiarNombre(fila.Nombre || fila.nombre);
      const pertenece = limpiarNombre(
        fila.Pertenece || fila.pertenece || fila['Pertenece a'] || fila['pertenece a']
      );

      if (!departamento) departamento = ultimoDepartamento;
      if (!municipio) municipio = ultimoMunicipio;

      // Cada error dice QUÉ falta o QUÉ está mal y en qué fila — no «posible duplicado».
      const faltan = [];
      if (!departamento) faltan.push('Departamento');
      if (!municipio) faltan.push('Municipio');
      if (!tipo) faltan.push('Tipo');
      if (!nombre) faltan.push('Nombre');
      if (faltan.length) {
        errores.push({ fila: numFila, error: `Falta ${faltan.join(', ')}.` });
        continue;
      }
      if (!tiposValidos.includes(tipo)) {
        errores.push({ fila: numFila, error: `Tipo "${abreviar(tipoOriginal)}" no válido. Use Comuna, Barrio, Corregimiento o Vereda.` });
        continue;
      }
      const largo = [['Departamento', departamento], ['Municipio', municipio], ['Nombre', nombre], ['Pertenece', pertenece]]
        .filter(([, valor]) => valor)
        .map(([etiqueta, valor]) => validarNombre(valor, `El campo ${etiqueta}`))
        .find((v) => v.error);
      if (largo) {
        errores.push({ fila: numFila, error: largo.error });
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

        /* EL PADRE («Pertenece») SE CREA SI NO EXISTE, y es a propósito: el archivo
           que exporta esta misma pantalla ordena por tipo, y «barrio» va antes que
           «comuna», así que un archivo exportado trae los barrios ANTES de sus
           comunas. Exigir que la comuna ya exista rompería la importación de lo que
           la propia aplicación exportó. */
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
        try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ }
        // Sin volcar la sentencia (lleva los valores del archivo): solo el código.
        console.error(`[territorios] importar-excel, fila ${numFila}:`, err.code || err.message);
        errores.push({ fila: numFila, error: describirErrorDeFila(err) });
      } finally {
        conexion.release();
      }
    }

    const [[{ n: despues }]] = await pool.query(`SELECT COUNT(*) AS n FROM territorios`);
    const creados = Number(despues) - Number(antes);

    // La constancia de lo importado. `registrarAuditoria` no lanza: un fallo del
    // apunte no deshace una importación que ya terminó.
    await registrarAuditoria(
      req.session.usuario.id, 'importar_territorios', 'territorios', null,
      `Importó territorios desde "${abreviar(req.file.originalname || 'archivo', 80)}": ` +
      `${filas.length} fila(s) leída(s), ${insertados} procesada(s), ${creados} territorio(s) nuevo(s), ` +
      `${reparentados} con jerarquía corregida, ${errores.length} con error` +
      (errores.length ? ` (primera: fila ${errores[0].fila}, ${errores[0].error})` : '') + '.',
      req.ip
    );

    res.json({
      ok: true, insertados, reparentados, creados,
      errores: errores.slice(0, 500), erroresTotal: errores.length
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error procesando el archivo Excel. Verifica que el formato de las columnas sea correcto.' });
  }
});

/** Una excepción de MySQL, dicha en palabras. Nunca el SQL ni los valores. */
function describirErrorDeFila(err) {
  switch (err && err.code) {
    case 'ER_DATA_TOO_LONG': return 'Un valor es demasiado largo para su columna.';
    case 'ER_DUP_ENTRY': return 'Ya existe un territorio igual.';
    case 'ER_NO_REFERENCED_ROW':
    case 'ER_NO_REFERENCED_ROW_2': return 'El padre indicado no existe.';
    default: return `Error inesperado al guardar esta fila (${(err && err.code) || 'sin código'}).`;
  }
}

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
    /* ESTA LÍNEA VA AQUÍ Y NO MÁS ABAJO, Y NO ES UN DETALLE DE ESTILO.
       Se usa DENTRO de la plantilla `let query = \`…\`` que empieza unas
       líneas más abajo, y una plantilla se evalúa entera en el momento en que
       se escribe. Declarada después, cada petición moría con
       «Cannot access 'conExcl' before initialization» — un 500 en CADA carga
       de Coordinadores y líderes, que en pantalla se ve como una lista vacía
       sin ningún mensaje. Así llegó en el parche 192 y así se descubrió. */
    const conExcl = await hayExclusiones();
    // Los conteos de "registros" se calculan UNA vez para toda la tabla, no
    // una vez por fila. Antes cada fila disparaba subconsultas anidadas
    // (líderes -> sublíderes -> votantes), así que el costo crecía con el
    // cuadrado del tamaño del equipo y no tenía tope. Estas cinco
    // agregaciones dan exactamente los mismos números —comprobado fila por
    // fila contra las dos campañas de prueba, 115 filas, cero diferencias—
    // pero recorren `votantes` una sola vez.
    let query = `
      WITH
      -- Cada votante, con cada persona por la que cuenta: su líder y su
      -- sublíder son dos filas distintas del mismo votante.
      pares AS (
        SELECT id AS vid, lider_id    AS uid FROM votantes WHERE lider_id    IS NOT NULL
        UNION ALL
        SELECT id AS vid, sublider_id AS uid FROM votantes WHERE sublider_id IS NOT NULL
      ),
      -- COUNT(DISTINCT) y no COUNT(*): si alguien figura como líder Y como
      -- sublíder del mismo votante, esa persona cuenta una sola vez, igual
      -- que hacía el "OR" de la consulta anterior.
      cnt_ambos AS (
        SELECT uid, COUNT(DISTINCT vid) AS c FROM pares GROUP BY uid
      ),
      -- El líder y su gente, como pares (líder, miembro). El líder se incluye
      -- a sí mismo: los que registró directamente también son suyos.
      miembros AS (
        SELECT e2.usuario_id AS lider, e2.usuario_id AS miembro
          FROM estructura e2 WHERE e2.cargo = 'lider'
        UNION
        SELECT es.supervisor_id, es.usuario_id
          FROM estructura es
         WHERE es.cargo = 'usuario' AND es.activo = 1 AND es.supervisor_id IS NOT NULL
      ),
      /* CONTAR PERSONAS DISTINTAS, NO SUMAR DOS CUENTAS QUE SE PISAN.
         Antes era cnt_lider + subs, y eso contaba dos veces a todo votante
         registrado por un sublíder: el POST de votantes le pone SIEMPRE el
         lider_id del líder del sublíder, ademas del sublider_id. Asi que
         entraba por cnt_lider (por su lider_id) y otra vez por subs (por su
         sublider_id).
         Medido con un caso real: un lider con 2 votantes propios, 2
         sublideres y 2 votantes por cada sublider son 8 personas, y la ficha
         decia 12 — los 4 de los sublideres, dos veces. Reproducido en una
         transaccion contra el esquema de verdad antes de tocar nada.
         El coordinador suma estos totales, asi que su cifra estaba inflada
         por lo mismo y se arregla sola. */
      total_lider AS (
        SELECT m.lider AS uid, COUNT(DISTINCT p.vid) AS total
          FROM miembros m JOIN pares p ON p.uid = m.miembro
         GROUP BY m.lider
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
             u.tipo_cargo, u.email, u.telefono, u.activo, u.apoya_a, u.no_contactar, u.no_contactar_origen, u.no_contactar_canal, u.no_contactar_motivo,
             t.nombre AS territorio_nombre, t.tipo AS territorio_tipo,
             sup.nombre AS supervisor_nombre,
             ${sqlAut.estadoEstructura('e')} AS autorizacion_estado,
             ${sqlAut.fechaFirmaEstructura('e')} AS autorizacion_firmada_en,
             ${conExcl ? `(SELECT GROUP_CONCAT(ua.nombre ORDER BY ua.nombre SEPARATOR ', ')
                             FROM estructura_exclusiones ee
                             JOIN usuarios ua ON ua.id = ee.aspirante_id
                            WHERE ee.estructura_id = e.id)` : 'NULL'} AS excluido_por,
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
    /* LAS CONDICIONES VAN EN UNA LISTA Y NO PEGADAS A LA CADENA.
       La versión anterior escribía `WHERE e.supervisor_id = ? OR e.usuario_id = ?`
       directamente. Añadirle detrás un `AND` habría dado
       `WHERE a OR b AND c`, que MySQL lee como `a OR (b AND c)`: el líder
       habría seguido viendo a todo su equipo sin filtrar. Con la lista, cada
       condición llega ya entre paréntesis y el orden no depende de acordarse. */
    const condiciones = [];
    const params = [];

    if (req.sublicencia) {
      /* EL ASPIRANTE VE SU RAMA ENTERA, NO UN SOLO NIVEL.
         Caía en la rama de abajo —su rol es 'lider'— y esa condición devuelve
         a quien cuelga DIRECTAMENTE de él. Con dos niveles de equipo, la mitad
         de su gente no aparecía en su propia pantalla. Es la misma pieza que
         ya usan /mapa-personas y /testigos para acotarlo. */
      const suya = subarbolSql(req.sublicencia.usuario_id, 'e.usuario_id');
      condiciones.push(suya.sql);
      params.push(...suya.valores);
      /* Y fuera los que él mismo quitó de su equipo. La fila sigue viva para
         la campaña madre; lo que desaparece es de SU lista. */
      if (conExcl) {
        condiciones.push(`NOT EXISTS (SELECT 1 FROM estructura_exclusiones ee
                                       WHERE ee.estructura_id = e.id AND ee.aspirante_id = ?)`);
        params.push(req.sublicencia.usuario_id);
      }
    } else if (usuario.rol === 'coordinador') {
      /* EL COORDINADOR VE SU RAMA, NO TODA LA ESTRUCTURA (parche 327). Hasta el 326 recibía el nombre, la cédula, el
         correo y el teléfono de TODAS las personas de la campaña, aunque su pantalla de Votantes sí estuviera acotada a
         su rama. Es la misma condición de lib/alcanceVotantes.js: él, sus líderes y los sublíderes de esos líderes.
         El administrador sigue viendo todo. */
      const rama = sqlDeMiRama('e.usuario_id', usuario.id);
      condiciones.push(rama.sql);
      params.push(...rama.params);
    } else if (usuario.rol !== 'admin') {
      condiciones.push('(e.supervisor_id = ? OR e.usuario_id = ?)');
      params.push(usuario.id, usuario.id);
    }

    /* LA CAMPAÑA MADRE NO VE LA GENTE DE LA RAMA DE UN ASPIRANTE QUE NO MARQUE
       SU CARGO EN «APOYA A». La regla ya estaba escrita en lib/ramas.js y
       conectada para los VOTANTES; a la estructura no llegaba, así que un
       líder inscrito por un aspirante al concejo que no apoya a la alcaldía
       salía igual en la estructura de la campaña madre.

       SOLO A ADMIN Y COORDINADOR, igual que en los votantes y por lo mismo:
       el alcance de un líder es su propio equipo, y si ese líder cuelga de un
       aspirante, aplicárselo le vaciaría la pantalla sin decirle por qué. */
    if (!req.sublicencia && ['admin', 'coordinador'].includes(usuario.rol)) {
      const deLaMadre = await filtroMadreEstructura(pool, await cargoDeLaMadre());
      if (deLaMadre) {
        condiciones.push(deLaMadre.sql);
        params.push(...deLaMadre.valores);
      }
    }

    if (condiciones.length) query += ` WHERE ${condiciones.join(' AND ')}`;
    query += ` ORDER BY e.cargo, u.nombre`;
    const [rows] = await pool.query(query, params);
    /* La lista completa de territorios de cada persona. Si falla, el listado
       sale igual con el principal de siempre: un 500 aquí se vería como una
       pantalla de estructura VACÍA, sin ningún mensaje (ya pasó con `conExcl`). */
    try {
      await territoriosPersona.adjuntarListas(pool, rows);
    } catch (errLista) {
      console.error('Estructura: no se pudo leer la lista de territorios (se devuelve solo el principal):', errLista.message);
    }
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
    area, supervisor_id, meta_votos, direccion, cliente_uuid, tipo_testigo, mesas_asignadas
  } = req.body;

  /* VARIOS TERRITORIOS POR PERSONA. El cuerpo trae `territorio_ids` (arreglo,
     el primero es el principal) o, como siempre, solo `territorio_id`. Desde
     aquí `territorio_id` es EL PRINCIPAL, y el resto de la ruta lo usa igual
     que antes: la validación, la copia a `usuarios` y la sincronización con
     Votantes no cambian. La lista completa se guarda más abajo, dentro de la
     transacción, por lib/territoriosPersona.js. */
  const { lista: territoriosPedidos, error: errorTerritorios } = territoriosPersona.listaDesdeCuerpo(req.body);
  if (errorTerritorios) return res.status(400).json({ error: errorTerritorios });
  const territorio_id = territoriosPedidos.length ? territoriosPedidos[0] : null;

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
  /* AL ASPIRANTE AL CONCEJO NO SE LE EXIGE ÁREA DE INFLUENCIA.
     Hace campaña en toda la ciudad, así que obligarlo a escoger una comuna es
     pedirle que declare una frontera que no tiene. El formulario ya lo trataba
     como opcional; el servidor no, y por eso al guardar respondía «Nombre,
     cargo y territorio son obligatorios» — un rechazo que no se podía
     satisfacer sin inventarse un barrio.

     `tipo_cargo` es lo que lo distingue: un aspirante se guarda con
     cargo = 'lider', así que por el cargo no se le puede reconocer. */
  const esAspiranteConcejo = tipo_cargo === 'aspirante_concejo';
  if (!nombre || !cargo
      || (!esCoordinadorOrganizaciones && !esTestigo && !esAspiranteConcejo && !esOrganizacion && !territorio_id)
      || (!esCoordinadorOrganizaciones && !esAspiranteConcejo && esOrganizacion && !organizacion)) {
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

    const nombreRolLogin = rolDeLaCategoria(cargo, tipo_cargo);
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
      `INSERT INTO estructura (usuario_id, area, cargo, tipo_testigo, mesas_asignadas, tipo_area_influencia, organizacion, supervisor_id, meta_votos, meta_votos_base, direccion, cliente_uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [resultUsuario.insertId, areaFinal, cargo, tipoTestigoFinal,
       (esTestigo && tipoTestigoFinal === 'puesto') ? JSON.stringify(mesasAsignadasFinal) : null,
       esOrganizacion ? 'organizacion' : 'territorio',
       esOrganizacion ? organizacion.trim() : null, supervisorFinal, meta_votos || 0, meta_votos || 0, direccion || null,
       cliente_uuid || null]
    );
    estructuraId = resultEstructura.insertId;
    // El principal y la lista, juntos y en la misma transacción.
    await territoriosPersona.guardar(conexion, estructuraId, territoriosPedidos);

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

  /* EL SMS DE BIENVENIDA, si la campaña lo tiene encendido (apagado de
     fábrica; se enciende en Configurar mensajería). Va DESPUÉS del commit y
     por la misma razón que la geocodificación: la persona ya está guardada y
     un problema de mensajería no puede deshacer eso. `encolarBienvenida` no
     lanza nunca, pero el `catch` queda igual — una promesa rechazada sin
     manejar tumba el proceso de Node entero en las versiones nuevas.
     `destinatario_id` es el id de ESTRUCTURA, no el de usuario: es lo que
     espera `lugarDeVotacionDe` y lo que usa el resto del CRM. */
  encolarBienvenida({ tipo: 'estructura', id: estructuraId, nombre, telefono })
    .catch(err => console.error('Bienvenida automática (estructura):', err.message));

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
    departamento_residencia, ciudad_residencia,
    comuna_corregimiento_residencia, barrio_residencia, direccion, territorio_id,
    creado_por: req.session.usuario.id,
    supervisor_id: supervisorFinal
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
    return res.status(403).json({ error: 'Contraseña incorrecta. Escribe la suya para confirmar.' });
  }
  const {
    nombre, numero_identificacion, departamento_votacion, municipio_votacion, puesto_votacion, mesa_votacion,
    departamento_residencia, ciudad_residencia, comuna_corregimiento_residencia, barrio_residencia,
    genero, edad, tipo_cargo, apoya_a, email, telefono, cargo, tipo_area_influencia, organizacion,
    area, supervisor_id, meta_votos, activo, direccion, tipo_testigo, mesas_asignadas
  } = req.body;

  // Igual que en el POST: `territorio_id` pasa a ser EL PRINCIPAL de la lista.
  const { lista: territoriosPedidos, error: errorTerritorios } = territoriosPersona.listaDesdeCuerpo(req.body);
  if (errorTerritorios) return res.status(400).json({ error: errorTerritorios });
  const territorio_id = territoriosPedidos.length ? territoriosPedidos[0] : null;

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
  /* AL ASPIRANTE AL CONCEJO NO SE LE EXIGE ÁREA DE INFLUENCIA.
     Hace campaña en toda la ciudad, así que obligarlo a escoger una comuna es
     pedirle que declare una frontera que no tiene. El formulario ya lo trataba
     como opcional; el servidor no, y por eso al guardar respondía «Nombre,
     cargo y territorio son obligatorios» — un rechazo que no se podía
     satisfacer sin inventarse un barrio.

     `tipo_cargo` es lo que lo distingue: un aspirante se guarda con
     cargo = 'lider', así que por el cargo no se le puede reconocer. */
  const esAspiranteConcejo = tipo_cargo === 'aspirante_concejo';
  if (!nombre || !cargo
      || (!esCoordinadorOrganizaciones && !esTestigo && !esAspiranteConcejo && !esOrganizacion && !territorio_id)
      || (!esCoordinadorOrganizaciones && !esAspiranteConcejo && esOrganizacion && !organizacion)) {
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
              u.tipo_cargo AS tipo_cargo_anterior, u.puesto_votacion AS puesto_votacion_anterior,
              u.numero_identificacion AS cedula_anterior
       FROM estructura e JOIN usuarios u ON u.id = e.usuario_id
       WHERE e.id = ?`,
      [req.params.id]
    );
    if (!fila) throw new Error('Registro no encontrado.');
    if (await protegerObjetivo(req, res, fila.usuario_id)) { await conexion.rollback(); return; }

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

    /* EL ROL SIGUE A LA CATEGORIA, TAMBIEN AL EDITAR.
       Hasta aqui el PUT no tocaba `rol_id`: se podia cambiar a alguien de
       Lider a Aspirante al Concejo y su rol seguia diciendo `lider`. Es lo que
       le paso a Camilo — la categoria decia una cosa y el ingreso otra.

       Se reajusta SOLO si su rol actual es uno de los que describe la
       estructura: un `admin` con ficha de Estructura no puede quedar degradado
       a lider por haberle corregido el barrio.

       Y no se toca cuando el rol nuevo y el viejo son la misma categoria con
       otro nombre (`usuario`/`sublider`): eso solo generaria idas y vueltas
       segun por que pantalla se le edite. */
    const rolQueToca = rolDeLaCategoria(cargo, tipo_cargo);
    const [[rolActual]] = await conexion.query(
      `SELECT r.nombre FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`, [fila.usuario_id]);
    if (rolActual && ROLES_QUE_DA_LA_CATEGORIA.includes(rolActual.nombre)
        && !mismaCategoria(rolActual.nombre, rolQueToca)) {
      const [[rolNuevo]] = await conexion.query(`SELECT id FROM roles WHERE nombre = ?`, [rolQueToca]);
      // Si el rol no existe todavia —una campaña que aun no aplico el parche
      // que lo crea— se deja el que tenia. Degradarla a nada seria peor.
      if (rolNuevo) {
        await conexion.query(`UPDATE usuarios SET rol_id = ? WHERE id = ?`, [rolNuevo.id, fila.usuario_id]);
      }
    }

    /* UN ASPIRANTE NO PUEDE DEJAR A ALGUIEN SIN JEFE DESDE ESTE FORMULARIO.
       El POST ya lo tenía resuelto (linea 943: el supervisor de todo lo que
       crea un aspirante es él mismo); este UPDATE escribia `supervisor_id`
       en crudo, y un formulario guardado con ese campo en blanco desenganchaba
       a la persona de su rama — se caia de su estructura sin error y sin
       aviso, y ni el que edita ni la campaña madre se enteraban.

       Con la lista de «Reporta a» acotada a su rama eso dejo de ser teorico:
       basta con cambiar el Area dentro del formulario para que el desplegable
       se repueble y pierda la opcion que estaba puesta.

       Vacio significa «no lo toques», no «quitaselo». Para sacar a alguien de
       su equipo esta el boton «Quitar de mi equipo», que anota una exclusion
       en vez de romper la cadena de mando de la campaña madre. */
    const supervisorGuardado = req.sublicencia
      ? (supervisor_id || fila.supervisor_id_anterior || req.sublicencia.usuario_id)
      : (supervisor_id || null);

    await conexion.query(
      `UPDATE estructura SET cargo = ?, tipo_testigo = ?, mesas_asignadas = ?, area = ?, tipo_area_influencia = ?, organizacion = ?,
       supervisor_id = ?, meta_votos = ?, meta_votos_base = ?, activo = ?, direccion = ?
       WHERE id = ?`,
      [cargo, tipoTestigoFinal, (esTestigo && tipoTestigoFinal === 'puesto') ? JSON.stringify(mesasAsignadasFinal) : null,
       areaFinal, esOrganizacion ? 'organizacion' : 'territorio', esOrganizacion ? organizacion.trim() : null,
       supervisorGuardado, meta_votos || 0, meta_votos || 0, activo ? 1 : 0, direccion || null, req.params.id]
    );
    // La lista guardada REEMPLAZA a la anterior (el formulario manda la lista entera).
    await territoriosPersona.guardar(conexion, req.params.id, territoriosPedidos);

    await conexion.commit();

    /* MOVER A ALGUIEN DE SUPERVISOR LE CAMBIA LA RAMA A SUS VOTANTES.
       `rama_aspirante_id` es un dato derivado que hasta ahora sólo se escribía
       al guardar un votante: reasignar un líder que colgaba de un aspirante
       dejaba sus fichas —con cédula y teléfono— visibles para ese aspirante
       indefinidamente. Va en segundo plano porque cuesta una consulta por
       votante afectado y la edición ya está confirmada. */
    if (String(supervisor_id || '') !== String(fila.supervisor_id_anterior || '')) {
      recalcularRamaEnSegundoPlano(pool, fila.usuario_id, `mover a ${fila.usuario_id} de supervisor`);
    }

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
      departamento_residencia, ciudad_residencia,
      comuna_corregimiento_residencia, barrio_residencia, direccion, territorio_id,
      creado_por: req.session.usuario.id,
      // Para que un cambio de cédula MUEVA la ficha de Votantes en vez de
      // dejar la vieja suelta, y para que «Líder que registró» diga a quién
      // reporta. Ver la nota larga en config/sincronizacionVotantesEstructura.js.
      cedula_anterior: fila.cedula_anterior,
      supervisor_id: supervisorGuardado
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
/**
 * El texto del apunte de auditoría cuando se borra a una persona.
 *
 * TIENE QUE BASTARSE SOLO. Se lee meses después, cuando de la persona no
 * queda ni la fila de `usuarios`: nada de lo que diga aquí se puede volver a
 * consultar en ninguna tabla. Por eso el nombre y la cédula van escritos, y
 * por eso el cargo va traducido a palabras y no como la clave del `enum`.
 *
 * Los cargos se nombran aquí y no se importan de otro sitio porque en el
 * servidor no existía ese diccionario: las etiquetas viven en el navegador
 * (ETIQUETAS_CATEGORIA, en public/territorial.html). Duplicar cinco palabras
 * es preferible a que un apunte de auditoría dependa de un archivo del front.
 */
const NOMBRE_DEL_CARGO = {
  coordinador: 'Coordinador de territorio',
  coordinador_organizaciones: 'Coordinador de organizaciones',
  lider: 'Líder',
  usuario: 'Sublíder',
  testigo: 'Testigo electoral',
};
function descripcionDePersonaBorrada(fila) {
  const cargo = fila.tipo_cargo === 'aspirante_concejo'
    ? 'Aspirante al Concejo'
    : (NOMBRE_DEL_CARGO[fila.cargo] || fila.cargo || 'sin cargo');
  const partes = [
    `Eliminó a ${fila.nombre || 'una persona sin nombre'}`,
    fila.numero_identificacion ? ` (cédula ${fila.numero_identificacion})` : '',
    `, ${cargo}. Se borró también su cuenta de acceso.`,
    ` El identificador de usuario era ${fila.usuario_id}`,
    fila.supervisor_nombre ? `; le reportaba a ${fila.supervisor_nombre}.` : '; no le reportaba a nadie.',
  ];
  if (fila.a_su_cargo > 0) {
    partes.push(` ${fila.a_su_cargo} ${fila.a_su_cargo === 1 ? 'persona quedó' : 'personas quedaron'} sin quién ${fila.a_su_cargo === 1 ? 'la' : 'las'} coordine.`);
  }
  return partes.join('');
}

router.delete('/estructura/:id', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  /* EL ASPIRANTE NO BORRA: SE QUITA A ESA PERSONA DE SU EQUIPO.
     Abajo, este mismo endpoint borra la fila de `estructura` Y la cuenta de
     `usuarios`. Las dos son de la campaña madre —él no las creó, las hereda
     por colgar de ella—, así que dejarle pasar por ahí significaría que un
     aspirante al concejo puede dejar sin cuenta a un líder de la alcaldía.
     Se apunta la exclusión y se sale. Es exactamente lo que ya hace
     `votante_ramas.excluido` con los votantes: mismo gesto, mismo significado.

     NO SE LE PIDE LA CONTRASEÑA, y es deliberado: abajo se pide porque aquello
     es irreversible. Esto no destruye nada y se deshace con un DELETE de una
     fila. Pedirla enseñaría que las dos cosas son igual de graves, y no lo son.

     La campaña madre lo ve: `GET /estructura` devuelve el nombre de quien
     excluyó a cada persona, y la ficha lo muestra. */
  if (req.sublicencia) {
    const dentro = subarbolSql(req.sublicencia.usuario_id, 'e.usuario_id');
    const [[suyo]] = await pool.query(
      `SELECT 1 AS ok FROM estructura e WHERE e.id = ? AND ${dentro.sql} LIMIT 1`,
      [req.params.id, ...dentro.valores]
    );
    if (!suyo) return res.status(403).json({ error: 'Esa persona no pertenece a su equipo.' });
    try {
      await pool.query(
        `INSERT IGNORE INTO estructura_exclusiones (estructura_id, aspirante_id) VALUES (?, ?)`,
        [req.params.id, req.sublicencia.usuario_id]
      );
      return res.json({ ok: true, excluido: true });
    } catch (err) {
      console.error('Excluyendo de la rama:', err.message);
      return res.status(500).json({ error: 'No se pudo quitar a esa persona de su equipo.' });
    }
  }

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
    return res.status(403).json({ error: 'Contraseña incorrecta. Escribe la suya para confirmar.' });
  }
  /* QUEDA CONSTANCIA, PORQUE DESPUÉS DE ESTO NO HAY DÓNDE MIRAR.
     Hasta el 29 de agosto de 2026 este endpoint no registraba nada. El
     borrado masivo sí —`eliminar_masivo`, unas líneas más abajo—, y el de uno
     solo no: al revés de como debería, porque el masivo se hace a propósito y
     el de uno es el que se hace por error.

     Se supo cuando alguien eliminó por equivocación a un aspirante al Concejo
     de la campaña de prueba. Reconstruirlo fue posible, pero la auditoría no
     ayudó en nada: no se pudo saber quién lo había borrado ni a qué hora.

     LOS DATOS SE LEEN ANTES DE BORRAR, Y VAN EN TEXTO, NO EN IDENTIFICADORES.
     Después del `DELETE` la fila de `usuarios` ya no existe, así que un apunte
     que dijera «eliminó al usuario 275» no se podría traducir a un nombre
     nunca más. El nombre, la cédula y el cargo van escritos en `detalle`, que
     es TEXT y no depende de ninguna otra tabla.

     PERO EL NÚMERO TAMBIÉN VA, y por una razón concreta: otras tablas siguen
     apuntando a ese id después del borrado —`votantes.rama_aspirante_id` sin
     ir más lejos— y son las que permiten reconstruir a la persona. Recuperar
     al aspirante consistió justamente en volver a crear la cuenta CON SU ID
     VIEJO; sin ese número habría habido que deducirlo.

     CUÁNTOS QUEDAN COLGANDO SE CUENTA AQUÍ, antes de borrar. La foránea de
     `supervisor_id` es ON DELETE SET NULL: al irse un jefe su equipo no se
     borra, se queda sin nadie encima, en silencio. Es lo que le pasó a los dos
     líderes del aspirante. Dicho en el apunte, se sabe a quién hay que
     reasignar sin tener que buscarlo. */
  /* LA CONEXIÓN SE PIDE DENTRO DEL `try`, y aquí importa más que en otras
     rutas: desde que `registrarAuditoriaEn` LANZA cuando el apunte falla, el
     `catch` de abajo es lo que convierte ese fallo en un rollback. Si la
     conexión se pidiera fuera y el pool estuviera agotado, la promesa moriría
     en el `unhandledRejection` de app.js y el cliente no recibiría ninguna
     respuesta: el botón girando hasta que corte Nginx. */
  let conexion;
  let supervisorIdAnterior = null;
  try {
    conexion = await pool.getConnection();
    await conexion.beginTransaction();
    const [[fila]] = await conexion.query(
      `SELECT e.id AS estructura_id, e.usuario_id, e.supervisor_id, e.cargo,
              u.nombre, u.numero_identificacion, u.tipo_cargo,
              sup.nombre AS supervisor_nombre,
              (SELECT COUNT(*) FROM estructura h WHERE h.supervisor_id = e.usuario_id) AS a_su_cargo
         FROM estructura e
         LEFT JOIN usuarios u   ON u.id = e.usuario_id
         LEFT JOIN usuarios sup ON sup.id = e.supervisor_id
        WHERE e.id = ?`, [req.params.id]);
    if (fila && await protegerObjetivo(req, res, fila.usuario_id)) { await conexion.rollback(); return; }
    if (fila) {
      await registrarAuditoriaEn(
        conexion, req.session.usuario.id, 'eliminar_persona', 'estructura', fila.estructura_id,
        descripcionDePersonaBorrada(fila), req.ip
      );
    }
    /* SE COMPRUEBA `affectedRows`. El SELECT de arriba es una lectura
       consistente que no bloquea —la base corre en REPEATABLE-READ—, así que
       dos administradores, o un doble clic, ven los dos la fila y los dos
       escriben su apunte. El segundo borraría cero filas y confirmaría igual,
       dejando UN borrado con DOS apuntes. */
    const [borrado] = await conexion.query(`DELETE FROM estructura WHERE id = ?`, [req.params.id]);
    if (!borrado.affectedRows) {
    /* El rollback va protegido: si lo que falló fue la conexión misma —MySQL
       reiniciado, `wait_timeout`, un KILL— también lanza, y sin esto el
       `res.status(500)` de abajo no llegaría a ejecutarse. */
    if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
      return res.status(404).json({ error: 'Esa persona ya no está en la estructura.' });
    }
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
    if (conexion) conexion.release();
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

  /* LA CONEXIÓN SE PIDE DENTRO DEL `try`, y aquí importa más que en otras
     rutas: desde que `registrarAuditoriaEn` LANZA cuando el apunte falla, el
     `catch` de abajo es lo que convierte ese fallo en un rollback. Si la
     conexión se pidiera fuera y el pool estuviera agotado, la promesa moriría
     en el `unhandledRejection` de app.js y el cliente no recibiría ninguna
     respuesta: el botón girando hasta que corte Nginx. */
  let conexion;
  try {
    conexion = await pool.getConnection();
    await conexion.beginTransaction();
    const placeholders = cargos.map(() => '?').join(',');
    const [filas] = await conexion.query(
      `SELECT e.usuario_id, u.nombre FROM estructura e
         LEFT JOIN usuarios u ON u.id = e.usuario_id
        WHERE e.cargo IN (${placeholders})
          AND COALESCE(u.es_superadmin, 0) = 0`, cargos);
    const usuarioIds = filas.map(f => f.usuario_id);

    /* EL APUNTE, DENTRO DE LA TRANSACCIÓN Y ANTES DE BORRAR. Estaba después
       del commit y por el pool —o sea por otra conexión, con el error
       tragado—: si fallaba, el bloque quedaba borrado y sin constancia. Y se
       guardan los nombres, no solo el número: son decenas, caben, y son lo
       único con lo que se puede volver a montar el equipo. */
    const nombres = filas.map(f => f.nombre).filter(Boolean).join(', ');
    await registrarAuditoriaEn(
      conexion, req.session.usuario.id, 'eliminar_masivo', 'estructura', null,
      `Eliminó en bloque la estructura de tipo "${tipo}": ${usuarioIds.length} personas, con sus cuentas de acceso.`
      + (nombres ? ` Eran: ${nombres}.` : ''), req.ip);

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

    res.json({ ok: true, eliminados: usuarioIds.length });
  } catch (err) {
    /* El rollback va protegido: si lo que falló fue la conexión misma —MySQL
       reiniciado, `wait_timeout`, un KILL— también lanza, y sin esto el
       `res.status(500)` de abajo no llegaría a ejecutarse. */
    if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
    console.error(err);
    res.status(500).json({ error: 'Error eliminando los registros.' });
  } finally {
    if (conexion) conexion.release();
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
router.get('/estructura/exportar-excel', requireRole('admin', 'coordinador'), requiereImportarExportar('territorial'), async (req, res) => {
  try {
    /* MISMA REGLA QUE EN LA PANTALLA, y no por simetría: sin esto el Excel
       traería a las personas de la rama de un aspirante que la pantalla acaba
       de esconder. Una lista que se ve y otra que se descarga, distintas, es
       peor que no filtrar — nadie sospecha de un archivo. */
    const deLaMadre = await filtroMadreEstructura(pool, await cargoDeLaMadre());
    /* Y SOLO SU RAMA, igual que en la pantalla (parche 327): el coordinador exportaba la estructura entera. */
    const ramaCoord = req.session.usuario.rol === 'coordinador' ? sqlDeMiRama('e.usuario_id', req.session.usuario.id) : null;
    const [filas] = await pool.query(`
      SELECT e.id AS estructura_id, u.nombre, u.numero_identificacion, u.email, u.telefono, u.genero, u.edad,
             u.departamento_residencia, u.ciudad_residencia,
             u.comuna_corregimiento_residencia, u.barrio_residencia, u.tipo_cargo,
             e.cargo, e.direccion, e.area, e.tipo_area_influencia, e.organizacion,
             t.tipo AS territorio_tipo, t.nombre AS territorio_nombre,
             padre.nombre AS pertenece,
             e.meta_votos, e.meta_votos_base, e.activo,
             ${sqlMetaEfectiva('e')} AS meta_votos_equipo,
             sup.email AS reporta_a_email,
             ${sqlAut.estadoEstructura('e')} AS autorizacion_estado,
             ${sqlAut.fechaFirmaEstructura('e')} AS autorizacion_firmada_en
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      LEFT JOIN territorios t ON t.id = e.territorio_id
      LEFT JOIN territorios padre ON padre.id = t.padre_id
      LEFT JOIN usuarios sup ON sup.id = e.supervisor_id
      WHERE e.cargo != 'testigo'
      ${deLaMadre ? 'AND ' + deLaMadre.sql : ''}
      ${ramaCoord ? 'AND ' + ramaCoord.sql : ''}
      ORDER BY e.cargo, u.nombre
    `, [...(deLaMadre ? deLaMadre.valores : []), ...(ramaCoord ? ramaCoord.params : [])]);

    const ETIQUETAS_GENERO = {
      mujer: 'Mujer', hombre: 'Hombre', no_binario: 'No binario', prefiero_no_responder: 'Prefiero no responder'
    };

    /* Los territorios que NO son el principal, por persona. Si no se pueden
       leer, la columna sale vacía: la exportación no debe fallar por eso. */
    let listasPorPersona = new Map();
    try {
      listasPorPersona = await territoriosPersona.leerListas(pool, filas.map(f => f.estructura_id));
    } catch (errLista) {
      console.error('Exportación: no se pudo leer la lista de territorios (la columna «Otros territorios» saldrá vacía):', errLista.message);
    }

    const columnas = [
      'ID', 'Nombre', 'Número de identificación', 'Email', 'Teléfono', 'Género', 'Edad',
      'Departamento de residencia', 'Ciudad de residencia',
      'Dirección de residencia', 'Comuna o Corregimiento (residencia)', 'Barrio o Vereda (residencia)',
      'Cargo', 'Tipo', 'Área', 'Comuna', 'Barrio', 'Corregimiento', 'Vereda', 'Otros territorios', 'Organización',
      'Meta votos', 'Meta de votos (total con gremiales)', 'Reporta a', 'Activo',
      'Autorización de datos', 'Fecha de firma'
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
        // Informativa, como «Meta de votos (total…)»: la importación NO la lee.
        // Los nombres de los demás territorios de la persona, separados por «; ».
        'Otros territorios': territoriosPersona.nombresOtros(listasPorPersona.get(f.estructura_id)),
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
        'Activo': f.activo ? 'Sí' : 'No',
        'Autorización de datos': sqlAut.ETIQUETAS[f.autorizacion_estado] || '',
        'Fecha de firma': f.autorizacion_firmada_en ? String(f.autorizacion_firmada_en).slice(0, 16) : ''
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
router.post('/estructura/importar-excel', requireRole('admin', 'coordinador'), requiereImportarExportar('territorial'), uploadExcel.single('archivo'), async (req, res) => {
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

    let camposBorrados = 0;          // celdas con «-» que borraron un dato a propósito (orden 42)
    const avisos = [];

    for (const [i, fila] of filas.entries()) {
      const idFila = String(fila['ID'] || fila.id || '').trim() || null;
      const avisoFila = (texto) => avisos.push({ fila: i + 2, aviso: `fila ${i + 2}: ${texto}` });
      /* LAS CELDAS SE LEEN CRUDAS (orden 42, lib/importarCeldas.js): vacía = no toca el dato, «-» = lo borra (solo en las
         columnas opcionales), otra cosa = el valor. Hasta el 327 lo vacío pisaba la ficha con NULL y con valores por defecto
         (género, metas 0), y además se copiaba a Votantes. */
      const nombreCrudo = IC.crudoDe(fila, 'Nombre', 'nombre');
      const nombre = IC.texto(nombreCrudo);
      const cedulaCrudaE = IC.crudoDe(fila, 'Número de identificación', 'numero_identificacion');
      const cargoCrudo = IC.crudoDe(fila, 'Cargo', 'cargo');
      let cargo = IC.texto(cargoCrudo).toLowerCase();
      if (cargo === 'coordinador organizaciones') cargo = 'coordinador_organizaciones';
      if (cargo === 'sublíder' || cargo === 'sublider') cargo = 'usuario';
      const area = String(fila.Área || fila.Area || fila.area || '').trim();
      const comuna = String(fila.Comuna || fila.comuna || '').trim();
      const barrio = String(fila.Barrio || fila.barrio || '').trim();
      const corregimiento = String(fila.Corregimiento || fila.corregimiento || '').trim();
      const vereda = String(fila.Vereda || fila.vereda || '').trim();
      const reportaEmail = String(fila['Reporta a'] || fila.reporta_a || '').trim().toLowerCase();
      const tipoCargoTexto = String(fila.Tipo || fila.tipo_cargo || '').trim();
      const generoTexto = String(fila.Género || fila.Genero || fila.genero || '').trim().toLowerCase();
      const organizacionCruda = IC.crudoDe(fila, 'Organización', 'organizacion');
      const metaCruda = IC.crudoDe(fila, 'Meta votos', 'meta_votos');

      // El «-» no borra en nombre, cédula, cargo, territorio, supervisor, metas ni en lo demás que no es opcional.
      const errorMarca = IC.marcaEnColumnaNoBorrable([
        ['Nombre', nombreCrudo], ['Número de identificación', cedulaCrudaE], ['Cargo', cargoCrudo],
        ['Área', area], ['Comuna', comuna], ['Barrio', barrio], ['Corregimiento', corregimiento], ['Vereda', vereda],
        ['Meta votos', metaCruda], ['Reporta a', reportaEmail], ['Tipo', tipoCargoTexto], ['Género', generoTexto],
        ['Organización', organizacionCruda],
      ]);
      if (errorMarca) { errores.push({ fila: i + 2, error: errorMarca }); continue; }

      const crudo = {
        email: IC.crudoDe(fila, 'Email', 'email'),
        telefono: IC.crudoDe(fila, 'Teléfono', 'Telefono', 'telefono'),
        edad: IC.crudoDe(fila, 'Edad', 'edad'),
        direccion: IC.crudoDe(fila, 'Dirección de residencia', 'Dirección', 'Direccion', 'direccion'),
        comunaResidencia: IC.crudoDe(fila, 'Comuna o Corregimiento (residencia)', 'comuna_corregimiento_residencia'),
        barrioResidencia: IC.crudoDe(fila, 'Barrio o Vereda (residencia)'),
        departamentoResidencia: IC.crudoDe(fila, 'Departamento de residencia', 'departamento_residencia'),
        ciudadResidencia: IC.crudoDe(fila, 'Ciudad de residencia', 'ciudad_residencia'),
      };
      const convertirEmail = (t) => (String(t).includes('@') ? String(t).toLowerCase() : undefined);
      const convertirMeta = (t) => IC.enteroNoNegativo(String(t).replace(/[.,\s]/g, ''));
      const tipoCargoNormalizado = tipoCargoTexto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const tipoCargo = CLAVES_TIPO_CARGO[tipoCargoNormalizado] || null;
      const MAPA_GENERO_IMPORT_ESTRUCTURA = {
        'mujer': 'mujer', 'f': 'mujer', 'femenino': 'mujer',
        'hombre': 'hombre', 'm': 'hombre', 'masculino': 'hombre',
        'no binario': 'no_binario', 'no_binario': 'no_binario', 'otro': 'no_binario',
        'prefiero no responder': 'prefiero_no_responder', 'prefiero_no_responder': 'prefiero_no_responder', 'no informa': 'prefiero_no_responder'
      };
      // Con valor y sin reconocer queda «prefiero no responder», como siempre; VACÍO no toca (en una fila nueva, ese es el valor).
      const genero = MAPA_GENERO_IMPORT_ESTRUCTURA[generoTexto] || 'prefiero_no_responder';
      const generoDado = !IC.esVacia(generoTexto);
      const organizacionImport = IC.texto(organizacionCruda) || null;

      /* La fila a ACTUALIZAR se lee ANTES: sin cargo, sin tipo o sin territorio en la celda, se conserva lo que ya tenía. */
      let existenteFila = null;
      if (idFila) {
        const [[ex]] = await pool.query(
          `SELECT e.usuario_id, e.supervisor_id, e.cargo, u.tipo_cargo, u.numero_identificacion
             FROM estructura e JOIN usuarios u ON u.id = e.usuario_id WHERE e.id = ?`, [idFila]);
        if (!ex) {
          errores.push({ fila: i + 2, error: `No existe un registro de Estructura con ID ${idFila} — no se puede actualizar. Borra la columna ID en esta fila si quieres crear uno nuevo.` });
          continue;
        }
        existenteFila = ex;
      }
      if (cargo && !cargosValidos.includes(cargo)) {
        errores.push({ fila: i + 2, error: 'Cargo no válido (Coordinador/Líder/Usuario/Testigo).' });
        continue;
      }
      if (!existenteFila && (!nombre || !cargo)) {
        errores.push({ fila: i + 2, error: 'Nombre y Cargo (Coordinador/Líder/Usuario/Testigo) son obligatorios.' });
        continue;
      }
      // Una fila NUEVA sin cédula ni correo es, sin duda, una cuenta nueva sin cédula: se dice ya, antes de revisar el territorio.
      if (!existenteFila && IC.esVacia(cedulaCrudaE) && (IC.esVacia(crudo.email) || IC.esMarcaBorrar(crudo.email))) {
        errores.push({ fila: i + 2, error: 'Falta la cédula para crear la cuenta.' });
        continue;
      }
      const cargoEfectivo = cargo || (existenteFila && existenteFila.cargo);
      const tipoCargoEfectivo = tipoCargo || (existenteFila && existenteFila.tipo_cargo) || null;
      if (tipoCargoTexto && !tipoCargo) avisoFila('el Tipo no se reconoce, se dejó el que tenía.');
      // Un Coordinador Organizaciones no tiene territorio geográfico ni una
      // única organización obligatoria — igual que en el formulario de una
      // sola persona (ver parche 105).
      const esCoordinadorOrganizacionesImport = cargoEfectivo === 'coordinador_organizaciones';
      const hayTerritorioEnFila = !!(comuna || barrio || corregimiento || vereda);

      /* Un Coordinador se asigna directamente a la Comuna o Corregimiento
         (permitirSoloZona), sin necesidad de Barrio/Vereda. Un Coordinador
         Organizaciones no necesita territorio en absoluto (ver parche 105).

         Y EL ASPIRANTE AL CONCEJO, IGUAL QUE EL COORDINADOR. Manda sobre una
         zona entera, no sobre una manzana. Hay que preguntarlo por el TIPO y
         no por el cargo: en la base se guarda como `lider` —así conserva su
         equipo, su meta y su rama— así que `cargo === 'coordinador'` no lo
         distingue de un líder cualquiera. Es la misma deducción que hace
         `esAspiranteAlConcejo()` en la pantalla, y si las dos no coincidieran,
         un aspirante que se puede crear a mano sin barrio fallaría al
         importarlo por Excel. */
      let territorioIdImport = null;
      if (existenteFila && !hayTerritorioEnFila && !area) {
        // Al ACTUALIZAR sin ninguna celda de territorio: no se toca el territorio (antes era un error «Debe indicar Área…»).
      } else if (!esCoordinadorOrganizacionesImport) {
        const soloZonaImport = cargoEfectivo === 'coordinador'
          || (cargoEfectivo === 'lider' && tipoCargoEfectivo === 'aspirante_concejo');
        const resuelto = await resolverTerritorioConCache({
          area, comuna, barrio, corregimiento, vereda, permitirSoloZona: soloZonaImport
        });
        if (resuelto.error) { errores.push({ fila: i + 2, error: resuelto.error }); continue; }
        if (!resuelto.territorioId) {
          errores.push({ fila: i + 2, error: cargoEfectivo === 'coordinador'
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
      /* El Excel trae UN territorio por persona. Es el principal; los demás
         territorios que la persona ya tenga no se borran (ver `conservarExtras`
         en lib/territoriosPersona.js). */
      const listaImport = territorioIdImport ? [territorioIdImport] : [];

      let supervisorId = null;
      if (reportaEmail) {
        const [[sup]] = await pool.query(`SELECT id FROM usuarios WHERE LOWER(email) = ?`, [reportaEmail]);
        if (sup) supervisorId = sup.id;
      }
      const tocarSupervisor = !!reportaEmail;

      // Los valores para una fila NUEVA. Al ACTUALIZAR se arma `cambios` más abajo.
      const nTel = IC.valorNuevo(crudo.telefono, normalizarTelefonoImportado);
      const nEdad = IC.valorNuevo(crudo.edad, IC.enteroPositivo);
      const nMeta = IC.valorNuevo(metaCruda, convertirMeta);
      const nEmail = IC.valorNuevo(crudo.email, convertirEmail);
      const telefono = nTel.valor;
      const email = nEmail.valor || '';
      const edad = nEdad.valor;
      const metaVotos = nMeta.valor || 0;                 // una fila NUEVA sin meta nace en 0; al actualizar vacío no toca
      const direccion = IC.valorNuevo(crudo.direccion).valor;
      const numeroIdentificacion = IC.texto(cedulaCrudaE) || null;
      const comunaCorregimientoResidencia = IC.valorNuevo(crudo.comunaResidencia).valor;
      const barrioVeredaResidencia = IC.valorNuevo(crudo.barrioResidencia).valor;
      const departamentoResidenciaImport = IC.valorNuevo(crudo.departamentoResidencia).valor;
      const ciudadResidenciaImport = IC.valorNuevo(crudo.ciudadResidencia).valor;
      const tipoAreaInfluenciaImport = organizacionImport ? 'organizacion' : 'territorio';

      /* LO QUE SE COPIA A VOTANTES (orden 42): solo lo que la fila trae. `conservar_vacios` hace que lo que no viene (o que
         se borró con «-» en Estructura) NO pise la ficha de Votantes: un Excel de estructura no puede borrar datos de ahí. */
      const sincronizarConVotantes = async (cedulaFicha, nombreFicha) => {
        const votanteActual = await traerVotanteActualPorCedula(pool, cedulaFicha);
        await sincronizarVotanteDesdeEstructura(pool, {
          nombre: nombreFicha, numero_identificacion: cedulaFicha, telefono, email, genero, genero_dado: generoDado, edad,
          apoya_a: votanteActual ? votanteActual.apoya_a : [],
          departamento_votacion: votanteActual ? votanteActual.departamento_votacion : null,
          municipio_votacion: votanteActual ? votanteActual.municipio_votacion : null,
          puesto_votacion: votanteActual ? votanteActual.puesto_votacion : null,
          mesa_votacion: votanteActual ? votanteActual.mesa_votacion : null,
          departamento_residencia: departamentoResidenciaImport, ciudad_residencia: ciudadResidenciaImport,
          comuna_corregimiento_residencia: comunaCorregimientoResidencia, barrio_residencia: barrioVeredaResidencia,
          direccion, territorio_id: territorioIdImport, creado_por: req.session.usuario.id,
          conservar_vacios: true
        });
      };

      if (idFila) {
        // --- Modo actualizar: la fila trae un ID de Estructura existente.
        // No se toca nombre_usuario, password_hash ni debe_cambiar_password
        // — actualizar datos por Excel nunca debe resetear el acceso de
        // nadie a la aplicación. ---
        try {
          const usuarioId = existenteFila.usuario_id;
          const supervisorIdAnteriorFila = existenteFila.supervisor_id;
          if (numeroIdentificacion) {
            const [dupeCed] = await pool.query(`SELECT id FROM usuarios WHERE numero_identificacion = ? AND id != ?`, [numeroIdentificacion, usuarioId]);
            if (dupeCed.length) { errores.push({ fila: i + 2, error: 'Número de identificación duplicado (pertenece a otro usuario).' }); continue; }
          }
          if (email) {
            const [dupeEmail] = await pool.query(`SELECT id FROM usuarios WHERE email = ? AND id != ?`, [email, usuarioId]);
            if (dupeEmail.length) { errores.push({ fila: i + 2, error: 'Ese email ya pertenece a otro usuario.' }); continue; }
          }

          // SOLO LAS COLUMNAS DE LAS CELDAS QUE TRAEN ALGO.
          const cambiosU = new IC.Cambios();
          if (nombre) cambiosU.poner('nombre', nombre);
          if (numeroIdentificacion) cambiosU.poner('numero_identificacion', numeroIdentificacion);
          IC.aplicarOpcional(cambiosU, 'comuna_corregimiento_residencia', crudo.comunaResidencia);
          IC.aplicarOpcional(cambiosU, 'barrio_residencia', crudo.barrioResidencia);
          IC.aplicarOpcional(cambiosU, 'departamento_residencia', crudo.departamentoResidencia);
          IC.aplicarOpcional(cambiosU, 'ciudad_residencia', crudo.ciudadResidencia);
          if (tipoCargo) cambiosU.poner('tipo_cargo', tipoCargo);
          if (IC.aplicarOpcional(cambiosU, 'email', crudo.email, convertirEmail) === 'invalido') avisoFila('correo inválido, se dejó el que tenía.');
          if (IC.aplicarOpcional(cambiosU, 'telefono', crudo.telefono, normalizarTelefonoImportado) === 'invalido') avisoFila('teléfono inválido, se dejó el que tenía.');
          if (generoDado) cambiosU.poner('genero', genero);
          if (IC.aplicarOpcional(cambiosU, 'edad', crudo.edad, IC.enteroPositivo) === 'invalido') avisoFila('edad inválida, se dejó la que tenía.');

          const cambiosE = new IC.Cambios();
          if (cargo) cambiosE.poner('cargo', cargo);
          if (tocarSupervisor && supervisorId) cambiosE.poner('supervisor_id', supervisorId);
          if (!IC.esVacia(metaCruda)) {
            if (nMeta.invalido) avisoFila('la meta de votos no es un número, se dejó la que tenía.');
            else { cambiosE.poner('meta_votos', metaVotos); cambiosE.poner('meta_votos_base', metaVotos); }
          }
          IC.aplicarOpcional(cambiosE, 'direccion', crudo.direccion);
          if (organizacionImport) { cambiosE.poner('tipo_area_influencia', 'organizacion'); cambiosE.poner('organizacion', organizacionImport); }

          if (!cambiosU.hay && !cambiosE.hay && !territorioIdImport) {
            avisoFila('no trae ningún dato para cambiar (las celdas vacías no tocan la ficha).');
            continue;
          }

          const conexion = await pool.getConnection();
          try {
            await conexion.beginTransaction();
            if (cambiosU.hay) await conexion.query(`UPDATE usuarios SET ${cambiosU.sql()} WHERE id = ?`, [...cambiosU.valores, usuarioId]);
            if (cambiosE.hay) await conexion.query(`UPDATE estructura SET ${cambiosE.sql()} WHERE id = ?`, [...cambiosE.valores, idFila]);
            if (territorioIdImport) await territoriosPersona.guardar(conexion, idFila, listaImport, { conservarExtras: true });
            await conexion.commit();
            // Igual que en el PUT: la importación también puede mover a alguien
            // de supervisor, y entonces sus votantes cambian de rama.
            if (tocarSupervisor && supervisorId) recalcularRamaEnSegundoPlano(pool, usuarioId, 'importar estructura por Excel');
            actualizados++;
            camposBorrados += cambiosU.borrados + cambiosE.borrados;
          } catch (err) {
            await conexion.rollback();
            throw err;
          } finally {
            conexion.release();
          }

          const supervisorIdFinalFila = (tocarSupervisor && supervisorId) ? supervisorId : supervisorIdAnteriorFila;
          await recalcularMetaVotosCoordinadorOrganizaciones(pool, usuarioId);
          await recalcularMetaVotosCoordinadorOrganizaciones(pool, supervisorIdAnteriorFila);
          if (supervisorIdFinalFila && supervisorIdFinalFila !== supervisorIdAnteriorFila) {
            await recalcularMetaVotosCoordinadorOrganizaciones(pool, supervisorIdFinalFila);
          }

          if (direccion) {
            geocodificarResidenciaYGuardar(idFila, direccion, comunaCorregimientoResidencia, barrioVeredaResidencia, departamentoResidenciaImport, ciudadResidenciaImport)
              .catch(err => console.error(`Error geocodificando la fila actualizada (estructura id ${idFila}):`, err));
          }

          // La cédula y el nombre de la persona DESPUÉS del cambio (la fila puede no traerlos).
          const [[personaFinal]] = await pool.query(`SELECT nombre, numero_identificacion FROM usuarios WHERE id = ?`, [usuarioId]);
          await sincronizarConVotantes(personaFinal.numero_identificacion, personaFinal.nombre);
        } catch (err) {
          errores.push({ fila: i + 2, error: err.code === 'ER_DUP_ENTRY' ? 'Ya existe un usuario con ese email o número de identificación.' : 'Error al actualizar esta fila.' });
        }
        continue;
      }

      // --- Modo agregar: la fila no trae ID. Los avisos de lo que no se pudo entender ---
      if (nTel.invalido) avisoFila('teléfono inválido, se importó sin teléfono.');
      if (nEdad.invalido) avisoFila('edad inválida, se importó sin edad.');
      if (nEmail.invalido) avisoFila('correo inválido, se importó sin correo.');
      if (nMeta.invalido) avisoFila('la meta de votos no es un número, quedó en 0.');

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
          // La fila y su lista de territorios, juntas: o entran las dos o ninguna.
          const conexionCargo = await pool.getConnection();
          try {
            await conexionCargo.beginTransaction();
            const [resultCargo] = await conexionCargo.query(
              `INSERT INTO estructura (usuario_id, cargo, tipo_area_influencia, organizacion, supervisor_id, meta_votos, meta_votos_base, direccion)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [usuarioIdExistenteImport, cargo, tipoAreaInfluenciaImport, organizacionImport, supervisorId, metaVotos, metaVotos, direccion]
            );
            await territoriosPersona.guardar(conexionCargo, resultCargo.insertId, listaImport);
            await conexionCargo.commit();
          } catch (errCargo) {
            await conexionCargo.rollback();
            throw errCargo;
          } finally {
            conexionCargo.release();
          }
          if (supervisorId) await recalcularMetaVotosCoordinadorOrganizaciones(pool, supervisorId);
          await recalcularMetaVotosCoordinadorOrganizaciones(pool, usuarioIdExistenteImport);
          insertados++;

          const [[personaExistente]] = await pool.query(`SELECT nombre, numero_identificacion FROM usuarios WHERE id = ?`, [usuarioIdExistenteImport]);
          await sincronizarConVotantes(personaExistente.numero_identificacion, nombre || personaExistente.nombre);
        } catch (err) {
          errores.push({ fila: i + 2, error: 'Error al agregar el cargo nuevo a la cuenta ya existente.' });
        }
        continue;
      }

      /* SIN CÉDULA NO SE CREA LA CUENTA (orden 42). Antes se creaba con una clave aleatoria que nadie veía: una cuenta a la
         que no entraba nadie. La cédula es el usuario y la clave inicial. */
      if (!numeroIdentificacion) {
        errores.push({ fila: i + 2, error: 'Falta la cédula para crear la cuenta.' });
        continue;
      }

      const conexion = await pool.getConnection();
      let estructuraId, usuarioIdImport;
      try {
        await conexion.beginTransaction();
        const nombreRolLogin = rolDeLaCategoria(cargo, tipoCargo);
        const [[rol]] = await conexion.query(`SELECT id FROM roles WHERE nombre = ?`, [nombreRolLogin]);
        // El correo es opcional; el Número de identificación es el Nombre de usuario y la contraseña inicial.
        const nombreUsuarioImport = numeroIdentificacion;
        const passwordImport = numeroIdentificacion;
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
          `INSERT INTO estructura (usuario_id, cargo, tipo_area_influencia, organizacion, supervisor_id, meta_votos, meta_votos_base, direccion)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [resultUsuario.insertId, cargo, tipoAreaInfluenciaImport, organizacionImport, supervisorId, metaVotos, metaVotos, direccion]
        );
        estructuraId = resultEstructura.insertId;
        await territoriosPersona.guardar(conexion, estructuraId, listaImport);
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

      await sincronizarConVotantes(numeroIdentificacion, nombre);
    }

    res.json({ ok: true, insertados, actualizados, camposBorrados, errores, avisos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error procesando el archivo Excel. Verifica que el formato de las columnas sea correcto.' });
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
    /* A UN ASPIRANTE, SOLO LOS SUYOS. Esta lista llena «Reporta a» al crear
       una persona, y sin acotar le ofrecía los coordinadores de la campaña
       MADRE: medido el 30 de agosto de 2026, dos nombres que no eran suyos.
       Se usa `subarbolSql`, la misma condición con la que ve su estructura,
       para que el desplegable no pueda ofrecer a nadie que no aparezca en su
       propia pantalla. Para la campaña madre no cambia nada: `suyos` es null
       y la consulta queda igual, letra por letra. */
    const suyos = req.sublicencia ? subarbolSql(req.sublicencia.usuario_id, 'u.id') : null;
    // Un coordinador con varios territorios aparece en cada uno de ellos.
    const puente = await territoriosPersona.hayPuente();
    /* SE BUSCA HACIA ARRIBA Y TAMBIÉN HACIA ABAJO.
       Antes solo subía: desde la comuna hacia el municipio. Bastaba mientras
       un Coordinador se guardara SIEMPRE en la comuna, que es como estaba
       forzado el formulario.

       Desde que el barrio es opcional y no obligatorio, un Coordinador puede
       concentrarse en un barrio — y subiendo desde la comuna nunca se le
       encontraba. El efecto habría sido mudo y desconcertante: sus propios
       líderes dejarían de verlo en «Reporta a», sin ningún error, y quien lo
       notara no tendría forma de relacionarlo con el barrio que eligió.

       La rama de abajo solo AÑADE: antes ningún coordinador podía estar ahí,
       así que a nadie le aparece alguien que antes no le apareciera. */
    const [rows] = await pool.query(`
      WITH RECURSIVE arriba AS (
        SELECT id, padre_id, 0 AS nivel FROM territorios WHERE id = ?
        UNION ALL
        SELECT t.id, t.padre_id, a.nivel + 1
          FROM territorios t JOIN arriba a ON t.id = a.padre_id
         WHERE a.nivel < 6
      ),
      abajo AS (
        SELECT id, padre_id, 0 AS nivel FROM territorios WHERE id = ?
        UNION ALL
        SELECT t.id, t.padre_id, b.nivel + 1
          FROM territorios t JOIN abajo b ON t.padre_id = b.id
         WHERE b.nivel < 3
      ),
      cadena AS (
        SELECT id, nivel FROM arriba
        UNION
        SELECT id, nivel FROM abajo
      )
      SELECT u.id, u.nombre, MIN(c.nivel) AS nivel
        FROM cadena c
        JOIN estructura e ON ${territoriosPersona.sqlAsignado('e', 'c.id', puente)} AND e.cargo = 'coordinador' AND e.activo = 1
        JOIN usuarios u ON u.id = e.usuario_id
       WHERE 1 = 1 ${suyos ? `AND ${suyos.sql}` : ''}
       GROUP BY u.id, u.nombre
       ORDER BY nivel, u.nombre
    `, [req.params.zonaId, req.params.zonaId, ...(suyos ? suyos.valores : [])]);
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
    // Mismo motivo que en `/coordinadores-por-zona`: alimenta el mismo
    // desplegable «Reporta a», así que a un aspirante solo le puede ofrecer
    // gente de su rama. Para la madre la consulta queda igual.
    const suyos = req.sublicencia ? subarbolSql(req.sublicencia.usuario_id, 'u.id') : null;
    const [rows] = await pool.query(`
      SELECT u.id, u.nombre
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.cargo = 'coordinador_organizaciones' AND e.activo = 1
        ${suyos ? `AND ${suyos.sql}` : ''}
      ORDER BY u.nombre
    `, suyos ? suyos.valores : []);
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
    /* A UN ASPIRANTE, SOLO SU GENTE. Mismo motivo y misma pieza que en
       `/coordinadores-por-zona`: estas listas llenan desplegables donde no
       puede aparecer nadie que no esté en su propia estructura. Con la madre
       `suyos` es null y la consulta queda igual, letra por letra. */
    const suyos = req.sublicencia ? subarbolSql(req.sublicencia.usuario_id, 'u.id') : null;
    // Un líder con tres barrios sale en los tres.
    const puente = await territoriosPersona.hayPuente();
    const [rows] = await pool.query(`
      SELECT u.id, u.nombre
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.cargo = 'lider' AND e.activo = 1 AND ${territoriosPersona.sqlAsignado('e', '?', puente)}
        ${suyos ? `AND ${suyos.sql}` : ''}
      ORDER BY u.nombre
    `, [...territoriosPersona.paramsAsignado(puente, req.params.territorioId), ...(suyos ? suyos.valores : [])]);
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
    /* A UN ASPIRANTE, SOLO SU GENTE. Misma pieza que en las otras listas de
       este archivo. Con la madre `suyos` es null y la consulta no cambia. */
    const suyos = req.sublicencia ? subarbolSql(req.sublicencia.usuario_id, 'u.id') : null;
    // Líderes con el territorio entre los suyos, o que reportan a un coordinador
    // que tiene entre los suyos la comuna/corregimiento del que cuelga.
    const puente = await territoriosPersona.hayPuente();
    const [rows] = await pool.query(`
      SELECT DISTINCT u.id, u.nombre
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.cargo = 'lider' AND e.activo = 1
        AND (
          ${territoriosPersona.sqlAsignado('e', '?', puente)}
          OR e.supervisor_id IN (
            SELECT ec.usuario_id
            FROM estructura ec
            JOIN territorios t ON t.id = ?
            WHERE ec.cargo = 'coordinador' AND ec.activo = 1 AND ${territoriosPersona.sqlAsignado('ec', 't.padre_id', puente, 'etc')}
          )
        )
        ${suyos ? `AND ${suyos.sql}` : ''}
      ORDER BY u.nombre
    `, [...territoriosPersona.paramsAsignado(puente, req.params.territorioId), req.params.territorioId, ...(suyos ? suyos.valores : [])]);
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
    /* A UN ASPIRANTE, SOLO SU GENTE. Misma pieza que en las otras listas de
       este archivo. Con la madre `suyos` es null y la consulta no cambia. */
    const suyos = req.sublicencia ? subarbolSql(req.sublicencia.usuario_id, 'u.id') : null;

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
    /* CON VARIOS TERRITORIOS, UNA PERSONA CABE POR CUALQUIERA DE ELLOS.
       Se recorren los pares (persona, territorio) —el principal y los demás—
       y se agrupa de vuelta por persona, para que no salga repetida. El área
       que se devuelve es la guardada; si no la hay, la del territorio que
       coincide, prefiriendo la que se pidió cuando alguno la tiene. */
    const puente = await territoriosPersona.hayPuente();
    const areaDelTerritorio = `CASE WHEN t.tipo IN ('barrio', 'comuna') THEN 'urbano'
                                    WHEN t.tipo IN ('vereda', 'corregimiento') THEN 'rural' END`;
    const expresionArea = `COALESCE(
      e.area,
      CASE WHEN ? IS NOT NULL AND SUM((${areaDelTerritorio}) = ?) > 0 THEN ?
           ELSE MIN(${areaDelTerritorio}) END)`;
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
        SELECT u.id, u.nombre, e.cargo, ${expresionArea} AS area
          FROM estructura e
          JOIN usuarios u ON u.id = e.usuario_id
          JOIN ${territoriosPersona.sqlParesPersonaTerritorio(puente)} pt ON pt.estructura_id = e.id
          LEFT JOIN territorios t ON t.id = pt.territorio_id
          LEFT JOIN territorios padre ON padre.id = t.padre_id
         WHERE e.activo = 1
           AND e.cargo IN ('lider', 'coordinador')
           AND (pt.territorio_id = ? OR t.padre_id = ? OR padre.padre_id = ?)
           -- El acotado va AQUI DENTRO, no en la consulta de afuera: el alias
           -- u solo existe en esta subconsulta. Puesto fuera, MySQL no
           -- encuentra la columna y la ruta responde 500.
           -- (Sin comillas invertidas: esto vive dentro de un template
           --  literal y una sola cerraria la cadena.)
           ${suyos ? `AND ${suyos.sql}` : ''}
         GROUP BY e.id, u.id, u.nombre, e.cargo, e.area
      ) x
      ORDER BY (? IS NOT NULL AND x.area = ?) DESC,
               FIELD(x.cargo, 'lider', 'coordinador'), x.nombre
    `, [area, area, area,
        req.params.municipioId, req.params.municipioId, req.params.municipioId,
        ...(suyos ? suyos.valores : []), area, area]);
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
    /* A UN ASPIRANTE, SOLO SU GENTE. Mismo motivo y misma pieza que en
       `/coordinadores-por-zona`: estas listas llenan desplegables donde no
       puede aparecer nadie que no esté en su propia estructura. Con la madre
       `suyos` es null y la consulta queda igual, letra por letra. */
    const suyos = req.sublicencia ? subarbolSql(req.sublicencia.usuario_id, 'u.id') : null;
    const [rows] = await pool.query(`
      SELECT u.id, u.nombre
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.cargo = 'usuario' AND e.activo = 1 AND e.supervisor_id = ?
        ${suyos ? `AND ${suyos.sql}` : ''}
      ORDER BY u.nombre
    `, [req.params.liderId, ...(suyos ? suyos.valores : [])]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo los sublíderes del líder.' });
  }
});

// Resumen de cobertura territorial (para dashboard/mapa)
router.get('/cobertura', async (req, res) => {
  try {
    /* LAS CIFRAS TAMBIÉN SON DATOS. Las filas de aquí son territorios, que el
       aspirante comparte legítimamente con la madre —trabaja en el mismo
       municipio—, pero los cuatro conteos de cada fila son de la campaña
       entera: cuántos líderes, coordinadores, testigos y votantes tiene la
       madre en cada barrio. Acotado, cada aspirante ve su propia cobertura.

       El acotado va sobre el ON de cada LEFT JOIN y no en un WHERE: en el
       WHERE, un territorio sin gente suya desaparecería de la lista en vez de
       aparecer con ceros, y el mapa de cobertura perdería justo los sitios
       donde no tiene a nadie, que son los que hay que ver.

       Hoy no lo llama ninguna pantalla —comprobado— pero es alcanzable a mano,
       y eso basta. */
    const suyos = req.sublicencia ? subarbolSql(req.sublicencia.usuario_id, 'e.usuario_id') : null;
    // Una persona con tres barrios cuenta en los tres.
    const puenteCobertura = await territoriosPersona.hayPuente();
    const [rows] = await pool.query(`
      SELECT t.id, t.nombre, t.tipo,
             COUNT(DISTINCT CASE WHEN e.cargo = 'lider' THEN e.id END) AS lideres,
             COUNT(DISTINCT CASE WHEN e.cargo = 'coordinador' THEN e.id END) AS coordinadores,
             COUNT(DISTINCT CASE WHEN e.cargo = 'testigo' THEN e.id END) AS testigos,
             COUNT(DISTINCT v.id) AS votantes
      FROM territorios t
      LEFT JOIN estructura e ON ${territoriosPersona.sqlAsignado('e', 't.id', puenteCobertura)} AND e.activo = 1
        ${suyos ? `AND ${suyos.sql}` : ''}
      LEFT JOIN votantes v ON v.territorio_id = t.id
        ${suyos ? 'AND v.rama_aspirante_id = ?' : ''}
      GROUP BY t.id
      ORDER BY t.tipo, t.nombre
    `, suyos ? [...suyos.valores, req.sublicencia.usuario_id] : []);
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
    /* `territorio_nombre` sigue siendo el principal. Se añade `otros_territorios`
       (texto «A; B») para quien cubre más de uno; si no se puede leer la lista,
       el pin sale igual con el principal. */
    try {
      await territoriosPersona.adjuntarListas(pool, estructura);
      for (const fila of estructura) {
        fila.otros_territorios = fila.territorios
          .filter(t => !t.es_principal && t.nombre).map(t => t.nombre).join('; ');
      }
    } catch (errLista) {
      console.error('Mapa: no se pudo leer la lista de territorios (se devuelve solo el principal):', errLista.message);
    }
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
    /* Y LA MADRE VE LOS SUYOS, NO LOS DEL ASPIRANTE. Faltaba la otra mitad:
       el aspirante ya quedaba acotado a su rama, pero la campaña principal no
       filtraba nada, asi que el testigo que nombraba el aspirante aparecia en
       las DOS listas. Un testigo es una asignacion de mesa: si las dos
       campañas lo cuentan como suyo, el dia de la eleccion una de las dos se
       queda sin nadie en esa mesa creyendo que la tenia cubierta. */
    const acota = req.sublicencia
      ? subarbolSql(req.sublicencia.usuario_id, 'e.usuario_id')
      : await filtroTestigosMadre(pool, 'e.usuario_id');
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

router.get('/testigos/exportar-excel', requireRole('admin', 'coordinador'), requiereImportarExportar('testigos'), async (req, res) => {
  try {
    /* MISMO ALCANCE QUE LA PANTALLA. Si la lista deja fuera a los testigos del
       aspirante y la exportacion no, el Excel entrega con nombre, cedula y
       telefono exactamente lo que la sublicencia existe para separar — y por
       una puerta que nadie mira. */
    const acota = await filtroTestigosMadre(pool, 'e.usuario_id');
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
      ${acota ? 'AND ' + acota.sql : ''}
      ORDER BY u.nombre
    `, acota ? acota.valores : []);
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
router.post('/testigos/importar-excel', requireRole('admin', 'coordinador'), requiereImportarExportar('testigos'), uploadExcel.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Debe adjuntar un archivo Excel (.xlsx).' });
  try {
    const libro = XLSX.read(req.file.buffer, { type: 'buffer' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });

    let insertados = 0;
    let actualizados = 0;
    const errores = [];

    let camposBorrados = 0;          // celdas con «-» que borraron un dato a propósito (orden 42)
    const avisos = [];
    const convertirEmail = (t) => (String(t).includes('@') ? String(t).toLowerCase() : undefined);

    for (const [i, fila] of filas.entries()) {
      const idFila = String(fila['ID'] || fila.id || '').trim() || null;
      const avisoFila = (texto) => avisos.push({ fila: i + 2, aviso: `fila ${i + 2}: ${texto}` });
      /* LAS CELDAS SE LEEN CRUDAS (orden 42, lib/importarCeldas.js): vacía = no toca el dato, «-» = lo borra (solo en puesto,
         mesa, correo, teléfono y lugar de votación), otra cosa = el valor. Sin la columna Tipo NO se cambia el tipo de testigo
         ni sus mesas asignadas (antes un coordinador de puesto volvía a testigo de mesa y perdía sus mesas). */
      const nombreCrudo = IC.crudoDe(fila, 'Nombre', 'nombre');
      const nombre = IC.texto(nombreCrudo);
      const cedulaCrudaT = IC.crudoDe(fila, 'Número de identificación', 'Cédula', 'Cedula', 'cedula');
      const tipoCrudo = IC.crudoDe(fila, 'Tipo', 'tipo');
      const errorMarca = IC.marcaEnColumnaNoBorrable([
        ['Nombre', nombreCrudo], ['Número de identificación', cedulaCrudaT], ['Tipo', tipoCrudo],
      ]);
      if (errorMarca) { errores.push({ fila: i + 2, error: errorMarca }); continue; }
      if (!nombre && !idFila) {
        errores.push({ fila: i + 2, error: 'Nombre es obligatorio.' });
        continue;
      }
      const cedula = IC.texto(cedulaCrudaT) || null;
      const crudo = {
        telefono: IC.crudoDe(fila, 'Teléfono', 'Telefono', 'telefono'),
        email: IC.crudoDe(fila, 'Email', 'email'),
        departamentoVotacion: IC.crudoDe(fila, 'Departamento votación', 'departamento_votacion'),
        municipioVotacion: IC.crudoDe(fila, 'Municipio votación', 'municipio_votacion'),
        puestoVotacion: IC.crudoDe(fila, 'Puesto', 'puesto_votacion'),
        mesa: IC.crudoDe(fila, 'Mesa', 'mesa_votacion'),
      };
      // "Coordinador de puesto" cubre varias mesas del mismo puesto — no una
      // fija: la columna "Mesa" se interpreta como una lista separada por
      // comas ("3, 7, 9") en vez de un solo número.
      const tipoDado = !IC.esVacia(tipoCrudo);
      const tipoDeLaFila = IC.texto(tipoCrudo).toLowerCase().includes('coordinador') ? 'puesto' : 'mesa';
      const listaDeMesas = (t) => {
        const l = String(t).split(',').map(m => Number(m.trim())).filter(m => Number.isInteger(m) && m > 0);
        return l.length ? l : undefined;
      };

      try {
        if (idFila) {
          const [[existente]] = await pool.query(
            `SELECT e.usuario_id, e.tipo_testigo, u.departamento_votacion, u.municipio_votacion, u.puesto_votacion
               FROM estructura e JOIN usuarios u ON u.id = e.usuario_id WHERE e.id = ? AND e.cargo = 'testigo'`,
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

          const tipoEfectivo = tipoDado ? tipoDeLaFila : (existente.tipo_testigo || 'mesa');
          const cambiosU = new IC.Cambios();
          const cambiosE = new IC.Cambios();
          if (nombre) cambiosU.poner('nombre', nombre);
          if (cedula) cambiosU.poner('numero_identificacion', cedula);
          if (IC.aplicarOpcional(cambiosU, 'telefono', crudo.telefono, normalizarTelefonoImportado) === 'invalido') avisoFila('teléfono inválido, se dejó el que tenía.');
          if (IC.aplicarOpcional(cambiosU, 'email', crudo.email, convertirEmail) === 'invalido') avisoFila('correo inválido, se dejó el que tenía.');
          IC.aplicarOpcional(cambiosU, 'departamento_votacion', crudo.departamentoVotacion);
          IC.aplicarOpcional(cambiosU, 'municipio_votacion', crudo.municipioVotacion);
          IC.aplicarOpcional(cambiosU, 'puesto_votacion', crudo.puestoVotacion);

          // El lugar de votación DESPUÉS del cambio (para revisar las mesas y para ubicar el puesto).
          const efectivo = (cruda, actual) => (IC.esVacia(cruda) ? actual : (IC.esMarcaBorrar(cruda) ? null : IC.texto(cruda)));
          const puestoEf = efectivo(crudo.puestoVotacion, existente.puesto_votacion);
          const municipioEf = efectivo(crudo.municipioVotacion, existente.municipio_votacion);
          const departamentoEf = efectivo(crudo.departamentoVotacion, existente.departamento_votacion);

          // El tipo: solo si la fila trae la columna Tipo con algo. Pasar a «mesa» suelta las mesas asignadas.
          if (tipoDado) {
            cambiosE.poner('tipo_testigo', tipoDeLaFila);
            if (tipoDeLaFila === 'mesa') cambiosE.poner('mesas_asignadas', null);
          }
          // La mesa: vacía no toca; «-» la borra (y las mesas asignadas); con valor depende del tipo.
          let mesasSolicitadas = [];
          if (IC.esMarcaBorrar(crudo.mesa)) {
            cambiosU.borrar('mesa_votacion');
            cambiosE.poner('mesas_asignadas', null);
          } else if (!IC.esVacia(crudo.mesa)) {
            if (tipoEfectivo === 'puesto') {
              const lista = listaDeMesas(crudo.mesa);
              if (!lista) avisoFila('las mesas no son números separados por comas, se dejaron las que tenía.');
              else { mesasSolicitadas = lista; cambiosE.poner('mesas_asignadas', JSON.stringify(lista)); cambiosU.poner('mesa_votacion', null); }
            } else {
              mesasSolicitadas = [IC.texto(crudo.mesa)];
              cambiosU.poner('mesa_votacion', IC.texto(crudo.mesa));
            }
          }
          if (mesasSolicitadas.length) {
            const conflicto = await verificarMesasDisponibles(pool, puestoEf, mesasSolicitadas, idFila);
            if (conflicto.length) {
              errores.push({ fila: i + 2, error: `La(s) mesa(s) ${conflicto.join(', ')} ya están asignadas a otro testigo de ese puesto.` });
              continue;
            }
          }

          if (!cambiosU.hay && !cambiosE.hay) {
            avisoFila('no trae ningún dato para cambiar (las celdas vacías no tocan la ficha).');
            continue;
          }
          if (cambiosU.hay) await pool.query(`UPDATE usuarios SET ${cambiosU.sql()} WHERE id = ?`, [...cambiosU.valores, existente.usuario_id]);
          if (cambiosE.hay) await pool.query(`UPDATE estructura SET ${cambiosE.sql()} WHERE id = ?`, [...cambiosE.valores, idFila]);
          // Solo se vuelve a ubicar el puesto si la fila tocó el puesto, el municipio o el departamento.
          if (!IC.esVacia(crudo.puestoVotacion) || !IC.esVacia(crudo.municipioVotacion) || !IC.esVacia(crudo.departamentoVotacion)) {
            await geocodificarTestigoPorPuestoYGuardar(pool, idFila, puestoEf, municipioEf, departamentoEf);
          }
          actualizados++;
          camposBorrados += cambiosU.borrados + cambiosE.borrados;
        } else {
          // --- Fila nueva. Vacía y «-» valen null; la mesa y el tipo siguen la regla de siempre. ---
          const nTel = IC.valorNuevo(crudo.telefono, normalizarTelefonoImportado);
          const nEmail = IC.valorNuevo(crudo.email, convertirEmail);
          if (nTel.invalido) avisoFila('teléfono inválido, se importó sin teléfono.');
          if (nEmail.invalido) avisoFila('correo inválido, se importó sin correo.');
          const telefono = nTel.valor;
          const email = nEmail.valor;
          const departamentoVotacion = IC.valorNuevo(crudo.departamentoVotacion).valor;
          const municipioVotacion = IC.valorNuevo(crudo.municipioVotacion).valor;
          const puestoVotacion = IC.valorNuevo(crudo.puestoVotacion).valor;
          const tipoTestigo = tipoDeLaFila;
          const mesaTexto = IC.esMarcaBorrar(crudo.mesa) ? '' : IC.texto(crudo.mesa);
          const mesaVotacion = tipoTestigo === 'puesto' ? null : (mesaTexto || null);
          const mesasAsignadas = tipoTestigo === 'puesto' ? (listaDeMesas(mesaTexto) || []) : [];

          const mesasSolicitadas = tipoTestigo === 'puesto' ? mesasAsignadas : (mesaVotacion ? [mesaVotacion] : []);
          const conflicto = await verificarMesasDisponibles(pool, puestoVotacion, mesasSolicitadas, 0);
          if (conflicto.length) {
            errores.push({ fila: i + 2, error: `La(s) mesa(s) ${conflicto.join(', ')} ya están asignadas a otro testigo de ese puesto.` });
            continue;
          }

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

          /* SIN CÉDULA NO SE CREA LA CUENTA (orden 42). Antes se creaba con una clave aleatoria que nadie veía. */
          if (!cedula) {
            errores.push({ fila: i + 2, error: 'Falta la cédula para crear la cuenta.' });
            continue;
          }
          const hash = await bcrypt.hash(cedula, 12);
          const [[rolTestigo]] = await pool.query(`SELECT id FROM roles WHERE nombre = 'testigo'`);
          if (!rolTestigo) { errores.push({ fila: i + 2, error: 'El rol "testigo" no está configurado.' }); continue; }

          const [resultUsuario] = await pool.query(
            `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, telefono, email,
               departamento_votacion, municipio_votacion, puesto_votacion, mesa_votacion, password_hash, rol_id, debe_cambiar_password)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [nombre, cedula, cedula, telefono, email,
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

    res.json({ ok: true, insertados, actualizados, camposBorrados, errores, avisos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error procesando el archivo Excel. Verifica que el formato de las columnas sea correcto.' });
  }
});

/** Elimina un solo testigo — pide contraseña de administrador, como cualquier borrado sensible de esta app. */
router.delete('/testigos/:id', requireRole('admin'), async (req, res) => {
  const autorizado = await verificarPasswordAdmin(req.body && req.body.password);
  if (!autorizado) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }
  /* LA CONEXIÓN SE PIDE DENTRO DEL `try`, y aquí importa más que en otras
     rutas: desde que `registrarAuditoriaEn` LANZA cuando el apunte falla, el
     `catch` de abajo es lo que convierte ese fallo en un rollback. Si la
     conexión se pidiera fuera y el pool estuviera agotado, la promesa moriría
     en el `unhandledRejection` de app.js y el cliente no recibiría ninguna
     respuesta: el botón girando hasta que corte Nginx. */
  let conexion;
  try {
    conexion = await pool.getConnection();
    await conexion.beginTransaction();
    /* Mismo apunte que al borrar a cualquier otra persona, y por lo mismo:
       esto se lleva la fila de `estructura` Y la cuenta de `usuarios`. Un
       testigo borrado el día antes de la elección deja un puesto sin cubrir,
       y hasta hoy no había forma de saber quién lo quitó. */
    /* Mismo alcance que la lista: un id que no sale en la pantalla tampoco se
       borra tecleandolo. Sin esto, la unica proteccion de los testigos del
       aspirante seria que a nadie se le ocurriera el numero. */
    const acotaUno = await filtroTestigosMadre(conexion, 'e.usuario_id');
    const [[fila]] = await conexion.query(
      `SELECT e.id AS estructura_id, e.usuario_id, e.cargo, u.nombre, u.numero_identificacion, u.tipo_cargo,
              sup.nombre AS supervisor_nombre,
              (SELECT COUNT(*) FROM estructura h WHERE h.supervisor_id = e.usuario_id) AS a_su_cargo
         FROM estructura e
         LEFT JOIN usuarios u   ON u.id = e.usuario_id
         LEFT JOIN usuarios sup ON sup.id = e.supervisor_id
        WHERE e.id = ? AND e.cargo = 'testigo'
          ${acotaUno ? 'AND ' + acotaUno.sql : ''}`,
      acotaUno ? [req.params.id, ...acotaUno.valores] : [req.params.id]);
    if (!fila) {
    /* El rollback va protegido: si lo que falló fue la conexión misma —MySQL
       reiniciado, `wait_timeout`, un KILL— también lanza, y sin esto el
       `res.status(500)` de abajo no llegaría a ejecutarse. */
    if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
      return res.status(404).json({ error: 'No encontrado.' });
    }
    if (await protegerObjetivo(req, res, fila.usuario_id)) { await conexion.rollback(); return; }
    await registrarAuditoriaEn(
      conexion, req.session.usuario.id, 'eliminar_persona', 'estructura', fila.estructura_id,
      descripcionDePersonaBorrada(fila), req.ip
    );
    const [borrado] = await conexion.query(`DELETE FROM estructura WHERE id = ?`, [req.params.id]);
    if (!borrado.affectedRows) {   // mismo motivo que en /estructura/:id
      await conexion.rollback();
      return res.status(404).json({ error: 'Ese testigo ya no existe.' });
    }
    await conexion.query(`DELETE FROM usuarios WHERE id = ?`, [fila.usuario_id]);
    await conexion.commit();
    res.json({ ok: true });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error eliminando el testigo.' });
  } finally {
    if (conexion) conexion.release();
  }
});

/** Elimina TODOS los testigos — pide contraseña de administrador. */
router.post('/testigos/eliminar-todo', requireRole('admin'), async (req, res) => {
  const autorizado = await verificarPasswordAdmin(req.body && req.body.password);
  if (!autorizado) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }
  /* LA CONEXIÓN SE PIDE DENTRO DEL `try`, y aquí importa más que en otras
     rutas: desde que `registrarAuditoriaEn` LANZA cuando el apunte falla, el
     `catch` de abajo es lo que convierte ese fallo en un rollback. Si la
     conexión se pidiera fuera y el pool estuviera agotado, la promesa moriría
     en el `unhandledRejection` de app.js y el cliente no recibiría ninguna
     respuesta: el botón girando hasta que corte Nginx. */
  let conexion;
  try {
    conexion = await pool.getConnection();
    await conexion.beginTransaction();
    /* NO SE BORRA LO QUE NO SE VE. La pantalla de la madre deja fuera a los
       testigos de las ramas de los aspirantes; sin el mismo filtro aqui, este
       boton se los llevaba igual. Es el peor reparto posible: invisibles para
       revisarlos, alcanzables para destruirlos, y el aspirante se queda sin
       equipo del dia D sin que nadie de su lado haya tocado nada.
       Se recogen tambien los `id` de estructura y el DELETE va POR ESOS ID, no
       repitiendo el WHERE: asi la lista que se audita y las filas que se
       borran no pueden discrepar nunca. */
    const acotaBorrado = await filtroTestigosMadre(conexion, 'e.usuario_id');
    const [filas] = await conexion.query(
      `SELECT e.id AS estructura_id, e.usuario_id, u.nombre FROM estructura e
         LEFT JOIN usuarios u ON u.id = e.usuario_id
        WHERE e.cargo = 'testigo'
          AND COALESCE(u.es_superadmin, 0) = 0
        ${acotaBorrado ? 'AND ' + acotaBorrado.sql : ''}`,
      acotaBorrado ? acotaBorrado.valores : []);
    /* SE GUARDAN LOS NOMBRES, NO SÓLO EL NÚMERO. `eliminar_masivo` anota
       cuántas personas se llevó por delante, que sirve para saber qué pasó
       pero no para deshacerlo. Aquí caben: los testigos de una campaña son
       decenas, no miles, y con la lista escrita se puede volver a montar el
       equipo del día D sin depender de que exista un respaldo de esa noche.

       EL RECORTE LO HACE `registrarAuditoriaEn`, y cuenta BYTES. Aquí había un
       `slice(0, 60000)` con un comentario que afirmaba que pasarse «no da un
       error visible, MySQL recorta por lo sano». Las dos cosas eran falsas.
       `detalle` aguanta 65.535 BYTES y en utf8mb4 una eñe ocupa dos: los 2.551
       testigos de Caldas dan 60.000 caracteres = 67.200 bytes. Y este servidor
       corre con `STRICT_TRANS_TABLES` —comprobado—, así que MySQL no recorta:
       responde ERROR 1406 y rechaza la fila. Con la versión anterior de este
       código el error se tragaba y los testigos se borraban sin apunte, justo
       en la campaña más grande. */
    /* SIN TESTIGOS NO SE APUNTA NADA. Pulsar el botón con la lista vacía
       dejaba escrito «Eliminó de un golpe a los 0 testigos», y quien mañana
       busque en la auditoría quién barrió el equipo del Día D se encontraría
       ese renglón con la misma cara que uno de verdad. */
    if (!filas.length) {
      await conexion.commit();
      return res.json({ ok: true, eliminados: 0 });
    }
    const listaNombres = filas.map(f => f.nombre).filter(Boolean).join(', ');
    const detalle = `Eliminó de un golpe a los ${filas.length} testigos electorales de la campaña, y con ellos sus cuentas de acceso.`
      + (listaNombres ? ` Eran: ${listaNombres}.` : '');
    await registrarAuditoriaEn(
      conexion, req.session.usuario.id, 'eliminar_masivo', 'estructura', null,
      detalle, req.ip
    );
    if (filas.length) {
      await conexion.query(`DELETE FROM estructura WHERE id IN (?)`, [filas.map(f => f.estructura_id)]);
      await conexion.query(`DELETE FROM usuarios WHERE id IN (?)`, [filas.map(f => f.usuario_id)]);
    }
    await conexion.commit();
    res.json({ ok: true, eliminados: filas.length });
  } catch (err) {
    /* El rollback va protegido: si lo que falló fue la conexión misma —MySQL
       reiniciado, `wait_timeout`, un KILL— también lanza, y sin esto el
       `res.status(500)` de abajo no llegaría a ejecutarse. */
    if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
    console.error(err);
    res.status(500).json({ error: 'Error eliminando los testigos.' });
  } finally {
    if (conexion) conexion.release();
  }
});

/* AUTORIZACIÓN DE DATOS POR ENLACE (parche 325): estado, enlace y constancia de UNA persona de la estructura. Quien edita la estructura
   (admin, coordinador, aspirante) lo ve; un aspirante solo dentro de su rama (la misma guarda de `PUT /estructura/:id`). */
montarRutasAutorizacion(router, {
  tipo: 'estructura', prefijo: '/estructura', roles: ['admin', 'coordinador', 'aspirante'], requireRole,
  buscarPersona: async (req, id) => {
    if (req.sublicencia) {
      const dentro = subarbolSql(req.sublicencia.usuario_id, 'e.usuario_id');
      const [[suya]] = await pool.query(`SELECT 1 AS ok FROM estructura e WHERE e.id = ? AND ${dentro.sql} LIMIT 1`, [id, ...dentro.valores]);
      if (!suya) return null;
    }
    const [[f]] = await pool.query(
      `SELECT e.id, u.nombre, NULL AS rama FROM estructura e JOIN usuarios u ON u.id = e.usuario_id WHERE e.id = ?`, [id]);
    return f || null;
  },
});

module.exports = router;
