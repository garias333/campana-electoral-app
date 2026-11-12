const express = require('express');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const { limiteBuscarCedula, limiteVerificarDuplicado, inicialesDe } = require('../lib/busquedaCedula');
const { cedulaPara } = require('../lib/enmascarar');
const IC = require('../lib/importarCeldas');
const pool = require('../config/db');
const { requireAuth, requireRole, calcularAlcance } = require('../middleware/auth');
const { requiereImportarExportar } = require('../middleware/permisoModulo');
const { requiereComplemento } = require('../middleware/complemento');
const { encolarBienvenida } = require('../config/bienvenidaAutomatica');
const { recalcularRamaEnSegundoPlano, duenoDeLaCampana } = require('../lib/ramas');
const { geocodificarDireccion } = require('../config/geocoder');
const { resolverTerritorioDesdeNombres } = require('../config/territorioResolver');
const { uploadExcel } = require('../middleware/upload');
const { aspiranteDe, ramaDeVotante, subarbolSql } = require('../lib/ramas');
const { condicionAlcanceVotantes, parametrosAlcanceVotantes,
        filtroAlcanceEstimado } = require('../lib/alcanceVotantes');
const { armarWhereSql } = require('../config/filtros');
const { registrarAuditoria, registrarAuditoriaEn } = require('../config/auditoria');
const rateLimit = require('express-rate-limit');
const { validarCedula } = require('../lib/validarCedula');
// UNA regla de «es la misma cédula» para todas las entradas (orden 30): ver lib/normalizarCedula.js.
const { normalizarCedula, enmascararCedula, buscarFichaConCedula, buscarFichaPorCedula,
        mapaDeFichasPorCedula, buscarUsuarioPorCedula, sqlCedulaNormalizada } = require('../lib/normalizarCedula');
const { asegurarEstructuraTestigo, resolverOCrearUsuarioParaTestigo } = require('../config/testigoElectoral');
const { sincronizarEstructuraDesdeVotante } = require('../config/sincronizacionVotantesEstructura');
// Los territorios de una persona de la estructura se escriben SOLO por este módulo.
const territoriosPersona = require('../lib/territoriosPersona');
const { calcularEstimadoPorPuesto } = require('../config/estimadoPuestos');
const { verificarPasswordAdmin, validarTelefono10Digitos, verificarPasswordPropia } = require('../config/verificaciones');

const { versionConocida } = require('../config/politicaVersiones');
const { guardarFirma } = require('../config/firmaConsentimiento');
const sqlAut = require('../lib/sqlAutorizacion');
const { montarRutasAutorizacion } = require('../lib/rutasAutorizacion');
const { crearConfirmacion } = require('../config/confirmacionConsentimiento');
const { pedirConfirmacionSiProcede } = require('../config/confirmacionAutomatica');
const { comunaValida, listaDeComunas, revisarComuna } = require('../lib/comunasDeLaCampana');
const router = express.Router();

/**
 * Valida la cédula digitada y devuelve el resultado listo para responder.
 *
 * Se valida AQUÍ, en el servidor, aunque el formulario ya avise: el aviso
 * del navegador es comodidad, y cualquiera puede llamar a la API sin pasar
 * por él. El mismo módulo corre en los dos lados para que no puedan
 * divergir las reglas.
 *
 * Solo el formato imposible impide guardar. Lo dudoso —dígitos repetidos,
 * nombres de relleno— vuelve como aviso junto con el registro ya creado:
 * una cédula legítima puede salirse de todo patrón (nacionalizados,
 * reposiciones, expediciones tardías) y dejar a un ciudadano real fuera es
 * peor que admitir un registro señalado.
 *
 * Sin cédula no se valida nada: en esta aplicación no es obligatoria.
 */
function revisarCedula(b) {
  if (!b.cedula || !String(b.cedula).trim()) return { bloqueo: null, avisos: [] };
  const r = validarCedula({
    cedula: b.cedula,
    primerNombre: (b.nombre || '').trim().split(/\s+/)[0] || '',
    primerApellido: (b.nombre || '').trim().split(/\s+/).slice(-1)[0] || '',
    sexo: b.genero || null,
    fechaNacimiento: b.fecha_nacimiento || null,
  }, []); // tabla de cohortes vacía: por ahora solo reglas de formato
  return {
    bloqueo: r.nivel === 'bloqueo' ? (r.mensajes[0] || 'El número de cédula no es válido.') : null,
    avisos: r.nivel === 'advertencia' ? r.mensajes : [],
  };
}

/**
 * DESPUÉS de revisarCedula (que valida lo que se tecleó, con los mismos mensajes de siempre: acepta puntos y
 * espacios): lo que se GUARDA es solo dígitos y sin ceros a la izquierda. «1.053.123.456» y «01053123456» quedan
 * como «1053123456». Vacío, o sin cédula, queda null.
 */
function normalizarCedulaDelCuerpo(b) {
  b.cedula = (b.cedula != null && String(b.cedula).trim() !== '') ? (normalizarCedula(b.cedula) || null) : null;
}

/** La unión de `votantes` con `usuarios` por cédula, comparando NORMALIZADO de los dos lados (ver la nota de la orden 30 en ESTADO.md: medido, no es más lento). */
const SQL_UNION_USUARIO_POR_CEDULA = `${sqlCedulaNormalizada('ut.numero_identificacion')} = ${sqlCedulaNormalizada('v.cedula')}`;

router.use(requireAuth, calcularAlcance);


/**
 * Para la importación masiva por Excel: si el teléfono de la fila no
 * tiene exactamente 10 dígitos, no se rechaza la fila completa — se
 * importa esa persona igual, solo que sin teléfono.
 */
function normalizarTelefonoImportado(valor) {
  if (!valor) return null;
  const digitos = String(valor).replace(/\D/g, '');
  return digitos.length === 10 ? digitos : null;
}



/**
 * Sube por la cadena de padres de un territorio (ej. Barrio -> Comuna ->
 * Municipio -> Departamento) y devuelve los nombres, del más específico al
 * más general. Se usa para armar una dirección completa para geocodificar.
 * (Misma lógica que en territorial.routes.js, duplicada intencionalmente
 * para mantener cada archivo de rutas autocontenido.)
 */
async function resolverCadenaTerritorioVotante(territorioId) {
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

/** Geocodifica la dirección de un votante/contacto y guarda lat/lon. No lanza error si falla. */
/**
 * Ciudad/Departamento de respaldo cuando el votante no tiene su propia
 * Ciudad/Departamento de residencia registrada — se usa el Territorio en
 * el que se desarrolla la campaña (o, si no hay, la sede de la campaña).
 * Es INDISPENSABLE tener siempre algún ancla de ciudad: sin ella, el
 * buscador de mapas termina buscando la dirección en TODO el país.
 */
async function obtenerCiudadDepartamentoPorDefectoVotante() {
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

async function geocodificarYGuardarVotante(votanteId, direccion, territorioId, departamentoResidencia, ciudadResidencia) {
  if (!direccion || !direccion.trim()) return { geocodificado: false };
  try {
    const cadena = territorioId ? await resolverCadenaTerritorioVotante(territorioId) : [];
    // Ciudad/Departamento de residencia se mandan como campos ESTRUCTURADOS
    // y separados al buscador de mapas (no mezclados en un solo texto),
    // para que no tenga margen de interpretar la dirección como si
    // estuviera en otro municipio con nombre de calle o barrio parecido.
    // El Barrio/Vereda (si el Área tiene territorio asignado) se agrega a
    // la calle, para ubicar la cuadra exacta dentro de esa ciudad.
    //
    // Si el votante no tiene su propia Ciudad/Departamento de residencia,
    // NUNCA se manda la búsqueda sin ancla de ciudad — se usa como
    // respaldo el Territorio de la campaña (Configuración).
    let ciudadFinal = ciudadResidencia && ciudadResidencia.trim() ? ciudadResidencia.trim() : null;
    let departamentoFinal = departamentoResidencia && departamentoResidencia.trim() ? departamentoResidencia.trim() : null;
    if (!ciudadFinal && !departamentoFinal) {
      const porDefecto = await obtenerCiudadDepartamentoPorDefectoVotante();
      ciudadFinal = porDefecto.ciudad;
      departamentoFinal = porDefecto.departamento;
    }
    const calleConBarrio = [direccion.trim(), cadena[0] || null].filter(Boolean).join(', ');
    const resultado = await geocodificarDireccion({
      calle: calleConBarrio,
      ciudad: ciudadFinal,
      departamento: departamentoFinal
    });
    if (!resultado) return { geocodificado: false };
    await pool.query(
      `UPDATE votantes SET latitud = ?, longitud = ?, geocodificado_en = NOW() WHERE id = ?`,
      [resultado.latitud, resultado.longitud, votanteId]
    );
    return { geocodificado: true, ...resultado };
  } catch (err) {
    console.error('Error geocodificando dirección de votante:', err);
    return { geocodificado: false };
  }
}

// Listado con filtros (búsqueda, territorio, intención de voto) y paginación
  // Filtro por MUNICIPIO — solo lo usa la campaña departamental, donde
  // Comuna/Corregimiento y Barrio/Vereda no existen y el municipio es el
  // único eje territorial con el que vale la pena filtrar.
  //
  // Se aceptan los TRES sitios donde puede estar la persona, porque el nivel
  // al que se asigna depende de lo que la campaña tenga creado:
  //   - en el municipio mismo (lo normal sin comunas ni barrios),
  //   - en una vereda o barrio que cuelga directo del municipio,
  //   - en un barrio que cuelga de una comuna que cuelga del municipio.
  // Los dos JOIN que hacen falta (t y padre) ya estaban en la consulta, así
  // que no cuesta una subconsulta por fila.
  const filtroMunicipio = (alias) => `(v.territorio_id = ? OR ${alias}.padre_id = ? OR padre.padre_id = ?)`;

/**
 * El Área de un votante, con la de la Estructura territorial mandando.
 *
 * MUCHA GENTE ESTA EN LAS DOS TABLAS —49 de 82 en la campaña departamental—
 * y cada una guardaba su propia area. Medido el 15 de agosto de 2026: en 22
 * de esas 49 no coincidian, con el MISMO territorio en las dos. O sea que la
 * misma persona salia Urbana en una pantalla y Rural en la otra, y ninguna
 * de las dos era "la mala": eran dos verdades guardadas aparte.
 *
 * Se resuelve AL LEER y no copiando el dato de una tabla a la otra, que es
 * la misma decision que ya se tomo con la Meta derivada: un valor copiado se
 * queda rancio la primera vez que alguien edita solo uno de los dos lados, y
 * nadie se entera.
 *
 * Manda la Estructura porque es donde se define el rol de la persona; para
 * quien no esta en ella —un votante corriente— no hay nada que preferir y
 * queda la suya.
 *
 * VA EN UNA CONSTANTE porque la usan el listado Y el filtro: si el filtro
 * mirara `v.area` y la tabla mostrara otra cosa, filtrar por Urbano dejaria
 * fuera filas que dicen Urbano. Es el fallo que este arreglo viene a quitar,
 * reaparecido un nivel mas abajo.
 */
/**
 * El cargo que la persona tiene en la Estructura territorial, o vacío.
 *
 * Es lo que la columna CATEGORÍA convierte en Votante-COO, -LID o -SUB, y
 * ahora también lo que filtra el desplegable «Todo tipo de votante». Se saca
 * con la MISMA expresión que pinta la etiqueta —incluido el orden por
 * jerarquía— porque filtrar por «Votante-LID» y que salga alguien etiquetado
 * de otra forma es peor que no tener el filtro.
 */
const SQL_CARGO_ESTRUCTURA = `(SELECT e5.cargo FROM estructura e5
    WHERE e5.usuario_id = ut.id AND e5.activo = 1 AND e5.cargo <> 'testigo'
    ORDER BY FIELD(e5.cargo, 'coordinador', 'coordinador_organizaciones', 'lider', 'usuario')
    LIMIT 1)`;

const SQL_AREA_EFECTIVA = `COALESCE(
  (SELECT e4.area FROM estructura e4
    WHERE e4.usuario_id = ut.id AND e4.activo = 1 AND e4.cargo <> 'testigo' AND e4.area IS NOT NULL
    ORDER BY FIELD(e4.cargo, 'coordinador', 'coordinador_organizaciones', 'lider', 'usuario')
    LIMIT 1),
  v.area)`;

router.get('/', async (req, res) => {
  const { q, territorio_id, apoya_a, lider_id, area, zona_id, municipio_id, tipo_votante, categoria, no_contactar, origen, sin_confirmar, autorizacion, page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
  const condiciones = [];
  const params = [];

  if (q) {
    condiciones.push(`(
      v.nombre COLLATE utf8mb4_unicode_ci LIKE ? OR
      v.cedula LIKE ? OR
      v.telefono LIKE ?
    )`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (territorio_id) { condiciones.push(`v.territorio_id = ?`); params.push(territorio_id); }
  if (apoya_a) { condiciones.push(`JSON_CONTAINS(v.apoya_a, JSON_QUOTE(?))`); params.push(apoya_a); }
  if (lider_id) { condiciones.push(`v.lider_id = ?`); params.push(lider_id); }
  if (area) { condiciones.push(`${SQL_AREA_EFECTIVA} = ?`); params.push(area); }
  if (zona_id) { condiciones.push(`t.padre_id = ?`); params.push(zona_id); }
  if (municipio_id) { condiciones.push(filtroMunicipio('t')); params.push(municipio_id, municipio_id, municipio_id); }
  // «ninguno» = quien NO tiene cargo en la Estructura, o sea el votante a
  // secas. Va aparte porque es la ausencia de valor, no un valor.
  if (tipo_votante === 'ninguno') { condiciones.push(`${SQL_CARGO_ESTRUCTURA} IS NULL`); }
  else if (tipo_votante === 'coordinador') {
    // Los dos cargos de coordinación comparten etiqueta (Votante-COO), así
    // que el filtro tiene que traer los dos: si no, elegir Votante-COO
    // escondería al Coordinador de Organizaciones que la tabla sí rotula así.
    condiciones.push(`${SQL_CARGO_ESTRUCTURA} IN ('coordinador', 'coordinador_organizaciones')`);
  } else if (tipo_votante) { condiciones.push(`${SQL_CARGO_ESTRUCTURA} = ?`); params.push(tipo_votante); }
  if (categoria) { condiciones.push(`v.categoria = ?`); params.push(categoria); }
  // Inscripción por el enlace del líder: «se inscribió por enlace» y, dentro de eso, «sin confirmar»
  // (todavía no abrió /c). Valores fijos del servidor: nunca se arma SQL con lo que llega.
  if (origen === 'enlace_lider') condiciones.push(`v.origen = 'enlace_lider'`);
  if (sin_confirmar === '1') condiciones.push(`(v.origen = 'enlace_lider' AND v.consentimiento_confirmado_en IS NULL)`);
  // Quien pidió no recibir mensajes. '1' = solo esos; '0' = solo a quienes sí
  // se les puede escribir. Se comparan como TEXTO porque así llegan en la URL
  // y `if (no_contactar)` dejaría fuera el '0' —es una cadena vacía de
  // significado pero no de valor—, que es justo la mitad útil del filtro.
  if (no_contactar === '1') condiciones.push(`v.no_contactar = 1`);
  if (no_contactar === '0') condiciones.push(`(v.no_contactar = 0 OR v.no_contactar IS NULL)`);
  // Estado de la autorización de datos (parche 325): firmada | pendiente | vencida | verbal | sin. Solo esos cinco valores entran al SQL.
  const condAut = sqlAut.condicionFiltro(autorizacion, sqlAut.estadoVotante('v'));
  if (condAut) condiciones.push(condAut);
  if (req.alcance) { condiciones.push(condicionAlcanceVotantes(req.alcance)); params.push(...parametrosAlcanceVotantes(req.alcance)); }

  const whereSql = armarWhereSql(condiciones);

  try {
    const [rows] = await pool.query(
      `SELECT v.*, t.nombre AS territorio_nombre, padre.nombre AS zona_nombre, u.nombre AS lider_nombre,
              sub.nombre AS sublider_nombre,
              ${sqlAut.estadoVotante('v')} AS autorizacion_estado,
              ${sqlAut.fechaFirmaVotante('v')} AS autorizacion_firmada_en,
              -- El cargo que esta MISMA persona tiene en la Estructura, si
              -- lo tiene: es lo que convierte «Votante» en «Votante-COO»,
              -- «-LID» o «-SUB». Se cruza por cédula, igual que la fila de
              -- testigo de abajo.
              --
              -- SE QUEDA CON EL MÁS ALTO. Nada impide tener dos filas —hay
              -- 47 personas que son testigo ADEMÁS de otra cosa— y una
              -- etiqueta sola no puede decir dos cargos: manda el de arriba
              -- de la cadena. El cargo testigo se excluye porque no es un
              -- escalón de esa cadena sino un papel aparte, y tiene su
              -- propia señal: el fondo rojo.
              --
              -- (Sin acentos graves en este comentario a propósito: va
              -- dentro de una plantilla de JavaScript delimitada por ellos,
              -- y uno solo corta la cadena a la mitad.)
              ${SQL_AREA_EFECTIVA} AS area,
              (SELECT e2.cargo FROM estructura e2
                WHERE e2.usuario_id = ut.id AND e2.activo = 1 AND e2.cargo <> 'testigo'
                ORDER BY FIELD(e2.cargo, 'coordinador', 'coordinador_organizaciones', 'lider', 'usuario')
                LIMIT 1) AS cargo_estructura,
              -- El TIPO de cargo distingue al Aspirante al Concejo, que en la
              -- base es un lider: sin esto no hay forma de reconocerlo.
              ut.tipo_cargo AS tipo_cargo_estructura,
              et.id AS testigo_estructura_id, et.tipo_testigo AS testigo_tipo_testigo, et.mesas_asignadas AS testigo_mesas_asignadas,
              COALESCE(et.puesto_votacion, ut.puesto_votacion) AS testigo_puesto_votacion,
              COALESCE(et.mesa_votacion, ut.mesa_votacion) AS testigo_mesa_votacion,
              COALESCE(et.departamento_votacion, ut.departamento_votacion) AS testigo_departamento_votacion,
              COALESCE(et.municipio_votacion, ut.municipio_votacion) AS testigo_municipio_votacion
       FROM votantes v
       LEFT JOIN territorios t ON t.id = v.territorio_id
       LEFT JOIN territorios padre ON padre.id = t.padre_id
       LEFT JOIN usuarios u ON u.id = v.lider_id
       LEFT JOIN usuarios sub ON sub.id = v.sublider_id
       LEFT JOIN usuarios ut ON ${SQL_UNION_USUARIO_POR_CEDULA}
       -- Se engancha UNA sola fila de testigo, la más reciente. Con un
       -- LEFT JOIN corriente (et.usuario_id = ut.id AND cargo='testigo'),
       -- si una persona llegara a tener dos filas de testigo, su fila de
       -- votante se duplicaría en la lista: el JOIN multiplica. Hoy nadie
       -- las tiene, pero el listado no debe depender de eso — y el
       -- contador de arriba, que no lleva estos JOIN, seguiría dando el
       -- número correcto, así que el descuadre sería difícil de explicar.
       LEFT JOIN estructura et ON et.id = (
         SELECT e2.id FROM estructura e2
          WHERE e2.usuario_id = ut.id AND e2.cargo = 'testigo'
          ORDER BY e2.id DESC LIMIT 1
       )
       ${whereSql}
       ORDER BY v.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    // ESTA CONSULTA COMPARTE EL `whereSql` CON LA DE ARRIBA, ASI QUE NECESITA
    // SUS MISMOS JOIN. Le faltaban `padre` y `ut`, y el filtro por municipio
    // los usa: filtrar por municipio devolvia HTTP 500 y la pantalla se
    // quedaba con un error, aunque la condicion SQL estuviera bien escrita.
    //
    // Se descubrio probando la RUTA; la vez anterior se habia probado solo
    // la condicion suelta contra la base, que pasaba sin enterarse de que a
    // la consulta hermana le faltaba un JOIN. Un WHERE compartido obliga a
    // compartir el FROM.
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM votantes v
       LEFT JOIN territorios t ON t.id = v.territorio_id
       LEFT JOIN territorios padre ON padre.id = t.padre_id
       LEFT JOIN usuarios ut ON ${SQL_UNION_USUARIO_POR_CEDULA}
       ${whereSql}`,
      params
    );
    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando la base de votantes.' });
  }
});

// Resumen estadístico para el dashboard (por intención de voto y territorio)
router.get('/resumen', async (req, res) => {
  try {
    // El desglose por intención de voto se fue con la propia intención.
    /* CON EL ALCANCE DE QUIEN PREGUNTA, el mismo de la lista (orden del panel del líder). Sin esto, cualquier sesión recibía
       los quince territorios con más votantes de TODA la campaña. El administrador (`cargo: 'madre'`) sigue viendo la campaña. */
    const alc = req.alcance ? condicionAlcanceVotantes(req.alcance, 'v') : '1 = 1';
    const par = req.alcance ? parametrosAlcanceVotantes(req.alcance) : [];
    const [porTerritorio] = await pool.query(`
      SELECT t.nombre, COUNT(v.id) AS total
      FROM votantes v JOIN territorios t ON t.id = v.territorio_id
      WHERE ${alc}
      GROUP BY t.id ORDER BY total DESC LIMIT 15
    `, par);
    res.json({ porTerritorio });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generando el resumen.' });
  }
});

/**
 * Estimado de cuántos votantes/sublíderes registrados dicen votar en cada
 * Puesto de votación (Configuración → Día D → Puestos de votación) y en
 * cada una de sus Mesas — es un estimado con base en lo que la propia
 * persona registró en "Lugar de Votación", no un conteo oficial de la
 * Registraduría. Sin alcance de líder (igual que /resumen): es un
 * agregado de toda la base, sin datos personales de por medio.
 */
router.get('/estimados-por-puesto', async (req, res) => {
  try {
    const resultado = await calcularEstimadoPorPuesto(pool, filtroAlcanceEstimado(req), await duenoDeLaCampana(pool, req));
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error calculando el estimado de votantes por puesto de votación.' });
  }
});

// Exporta votantes/contactos a Excel.
/**
 * Vuelve a intentar geocodificar a los votantes/colaboradores que tienen
 * Dirección guardada pero nunca quedaron georreferenciados. Igual que en
 * Estructura territorial: procesa en lotes pequeños (por defecto 5) y con
 * pausa entre solicitudes, para respetar el límite de uso de Nominatim
 * (máx. ~1 solicitud/segundo) y no exceder el tiempo de una sola petición.
 */
router.post('/regeocodificar-pendientes', requireRole('admin', 'aspirante'), async (req, res) => {
  const tamanoLote = Math.min(Math.max(parseInt(req.query.lote) || 5, 1), 20);
  const despuesDe = parseInt(req.query.despues_de) || 0;
  const incluirTodos = req.query.todos === '1';

  if (incluirTodos) {
    /* «Corregir ubicaciones existentes» PISA coordenadas que ya estaban, asi
       que se confirma. Pero la clave que pedia es la del ADMINISTRADOR, y el
       aspirante no la tiene ni debe tenerla: se le pide LA SUYA, igual que al
       borrar un votante. Confirmar que es el, no pedirle una credencial ajena. */
    const autorizado = req.sublicencia
      ? await verificarPasswordPropia(req.session.usuario.id, req.body && req.body.password)
      : await verificarPasswordAdmin(req.body && req.body.password);
    if (!autorizado) {
      return res.status(403).json({
        error: req.sublicencia
          ? 'Contraseña incorrecta. Escribe la suya para confirmar.'
          : 'Contraseña de administrador incorrecta.',
      });
    }
  }

  try {
    const condicionGeocodificado = incluirTodos ? '' : ' AND geocodificado_en IS NULL';

    /* SE GEOCODIFICA LO SUYO, NO LA CAMPAÑA ENTERA.
       Estas dos consultas recorrian `votantes` sin acotar — le bastaba porque
       solo entraba el administrador. Un aspirante sin este filtro pondria a
       correr un proceso de varios minutos sobre los 88 votantes de la campaña
       madre, gastando geocodificaciones ajenas y PISANDO coordenadas que no son
       suyas. El contador tambien: le diria «faltan 60» de gente que no ve. */
    const acota = req.alcance
      ? ' AND ' + condicionAlcanceVotantes(req.alcance, '') : '';
    const parAcota = req.alcance ? parametrosAlcanceVotantes(req.alcance) : [];

    const [pendientes] = await pool.query(`
      SELECT id, direccion, territorio_id, departamento_residencia, ciudad_residencia FROM votantes
      WHERE direccion IS NOT NULL AND direccion != '' AND id > ?${condicionGeocodificado}${acota}
      ORDER BY id LIMIT ?
    `, [despuesDe, ...parAcota, tamanoLote]);

    const [[{ totalPendientesDespues }]] = await pool.query(`
      SELECT COUNT(*) AS totalPendientesDespues FROM votantes
      WHERE direccion IS NOT NULL AND direccion != '' AND id > ?${condicionGeocodificado}${acota}
    `, [despuesDe, ...parAcota]);

    let geocodificados = 0;
    const fallidos = [];
    let cursorSiguiente = despuesDe;
    for (const fila of pendientes) {
      try {
        const resultado = await geocodificarYGuardarVotante(fila.id, fila.direccion, fila.territorio_id, fila.departamento_residencia, fila.ciudad_residencia);
        if (resultado.geocodificado) geocodificados++;
        else fallidos.push(fila.id);
      } catch (err) {
        console.error(`Error re-geocodificando votante id ${fila.id}:`, err);
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

// Acepta los mismos filtros que GET / (q, territorio_id, apoya_a, lider_id,
// area, zona_id, categoria) — si no llega ninguno, exporta la base
// completa (comportamiento de siempre); si llegan, exporta solo lo que
// coincide con el filtro que la persona tenía aplicado en pantalla.
/* El aspirante exporta LO SUYO. La consulta de abajo ya aplica `req.alcance`,
   que para el es su rama: son los mismos siete que ve en pantalla, no los 88 de
   la campaña madre. Comprobado antes de abrirla. */
router.get('/exportar-excel', requireRole('admin', 'coordinador', 'aspirante'), requiereImportarExportar('votantes'), async (req, res) => {
  try {
    const { q, territorio_id, apoya_a, lider_id, area, zona_id, municipio_id, tipo_votante, categoria, no_contactar, origen, sin_confirmar, autorizacion } = req.query;
    const condiciones = [];
    const params = [];
    if (q) {
      condiciones.push(`(
        v.nombre COLLATE utf8mb4_unicode_ci LIKE ? OR
        v.cedula LIKE ? OR
        v.telefono LIKE ?
      )`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (territorio_id) { condiciones.push(`v.territorio_id = ?`); params.push(territorio_id); }
    if (apoya_a) { condiciones.push(`JSON_CONTAINS(v.apoya_a, JSON_QUOTE(?))`); params.push(apoya_a); }
    if (lider_id) { condiciones.push(`v.lider_id = ?`); params.push(lider_id); }
    if (area) { condiciones.push(`${SQL_AREA_EFECTIVA} = ?`); params.push(area); }
    if (zona_id) { condiciones.push(`t.padre_id = ?`); params.push(zona_id); }
    // Tambien aqui: el boton dice "Exportar a Excel (filtrados)", asi que un
    // filtro que la pantalla aplica y la exportacion ignora sacaria un
    // archivo con mas gente de la que se ve, sin avisar.
    if (municipio_id) { condiciones.push(filtroMunicipio('t')); params.push(municipio_id, municipio_id, municipio_id); }
    if (tipo_votante === 'ninguno') { condiciones.push(`${SQL_CARGO_ESTRUCTURA} IS NULL`); }
    else if (tipo_votante === 'coordinador') {
      condiciones.push(`${SQL_CARGO_ESTRUCTURA} IN ('coordinador', 'coordinador_organizaciones')`);
    } else if (tipo_votante) { condiciones.push(`${SQL_CARGO_ESTRUCTURA} = ?`); params.push(tipo_votante); }
    if (categoria) { condiciones.push(`v.categoria = ?`); params.push(categoria); }
  // Quien pidió no recibir mensajes. '1' = solo esos; '0' = solo a quienes sí
  // se les puede escribir. Se comparan como TEXTO porque así llegan en la URL
  // y `if (no_contactar)` dejaría fuera el '0' —es una cadena vacía de
  // significado pero no de valor—, que es justo la mitad útil del filtro.
  if (no_contactar === '1') condiciones.push(`v.no_contactar = 1`);
  if (no_contactar === '0') condiciones.push(`(v.no_contactar = 0 OR v.no_contactar IS NULL)`);
    // Los mismos dos filtros que el listado: «Exportar (filtrados)» tiene que exportar lo que se ve.
    if (origen === 'enlace_lider') condiciones.push(`v.origen = 'enlace_lider'`);
    if (sin_confirmar === '1') condiciones.push(`(v.origen = 'enlace_lider' AND v.consentimiento_confirmado_en IS NULL)`);
    // También el filtro de autorización de datos (parche 325): lo que se exporta es lo que se ve.
    const condAut = sqlAut.condicionFiltro(autorizacion, sqlAut.estadoVotante('v'));
    if (condAut) condiciones.push(condAut);
    /* EL ALCANCE, DE VERDAD (parche 327). El comentario de arriba decía que esta consulta ya aplicaba `req.alcance` y NO
       lo hacía: el coordinador exportaba toda la base (fuera de su rama y de la regla de la madre) y el aspirante toda la
       campaña, no su rama. Es la misma condición del listado: el administrador, toda la campaña (menos lo que le quita la
       regla de la madre); el coordinador, su rama; el aspirante, lo suyo. */
    if (req.alcance) { condiciones.push(condicionAlcanceVotantes(req.alcance)); params.push(...parametrosAlcanceVotantes(req.alcance)); }
    const whereSql = armarWhereSql(condiciones);

    const [filas] = await pool.query(`
      SELECT ${sqlAut.estadoVotante('v')} AS autorizacion_estado, ${sqlAut.fechaFirmaVotante('v')} AS autorizacion_firmada_en,
             v.id, v.categoria, v.nombre, v.cedula, v.telefono, v.email, v.genero, v.edad, v.fecha_nacimiento,
             v.departamento_votacion, v.municipio_votacion, v.puesto_votacion, v.mesa_votacion,
             ${SQL_AREA_EFECTIVA} AS area,
             v.direccion, v.departamento_residencia, v.ciudad_residencia, v.apoya_a, v.observaciones,
             v.tipo_area_influencia, v.organizacion,
             t.tipo AS territorio_tipo, t.nombre AS territorio_nombre, padre.nombre AS pertenece,
             lider.email AS lider_email
      FROM votantes v
      LEFT JOIN territorios t ON t.id = v.territorio_id
      LEFT JOIN territorios padre ON padre.id = t.padre_id
      LEFT JOIN usuarios lider ON lider.id = v.lider_id
      -- Hace falta para el filtro de Área, que mira la Estructura: sin él,
      -- exportar con ese filtro puesto fallaría igual que el conteo.
      LEFT JOIN usuarios ut ON ${SQL_UNION_USUARIO_POR_CEDULA}
      ${whereSql}
      ORDER BY v.nombre
    `, params);

    const ETIQUETAS_GENERO = {
      mujer: 'Mujer', hombre: 'Hombre', no_binario: 'No binario', prefiero_no_responder: 'Prefiero no responder'
    };
    const ETIQUETAS_APOYA_A = {
      alcaldia: 'Alcaldía', concejo: 'Concejo', jal: 'JAL', gobernacion: 'Gobernación', asamblea: 'Asamblea'
    };

    const columnas = [
      'ID', 'Categoría', 'Nombres y apellidos', 'Número de identificación', 'Género', 'Edad', 'Fecha nacimiento',
      'Departamento votación', 'Municipio votación', 'Puesto', 'Mesa',
      'Teléfono', 'Email', 'Departamento de residencia', 'Ciudad de residencia', 'Dirección de Residencia',
      'Área', 'Comuna', 'Barrio', 'Corregimiento', 'Vereda', 'Organización',
      'Líder o coordinador', 'Intención de voto', 'Apoya a', 'Observaciones',
      'Autorización de datos', 'Fecha de firma'
    ];

    const datos = filas.map(f => ({
      'ID': f.id,
      'Categoría': f.categoria === 'sublider' ? 'Sublíder' : 'Votante',
      'Nombres y apellidos': f.nombre,
      // El aspirante es el dueño de su campaña: cédula completa (orden 42). Quien no es administrador, coordinador ni aspirante la recibiría tapada (***456).
      'Número de identificación': cedulaPara(req.session.usuario, f.cedula, req.sublicencia) || '',
      'Género': ETIQUETAS_GENERO[f.genero] || '',
      'Edad': f.edad || '',
      'Fecha nacimiento': f.fecha_nacimiento || '',
      'Departamento votación': f.departamento_votacion || '',
      'Municipio votación': f.municipio_votacion || '',
      'Puesto': f.puesto_votacion || '',
      'Mesa': f.mesa_votacion || '',
      'Teléfono': f.telefono || '',
      'Email': f.email || '',
      'Departamento de residencia': f.departamento_residencia || '',
      'Ciudad de residencia': f.ciudad_residencia || '',
      'Dirección de Residencia': f.direccion || '',
      'Área': f.area ? (f.area === 'urbano' ? 'Urbano' : 'Rural')
        : (f.territorio_tipo === 'barrio' ? 'Urbano' : (f.territorio_tipo === 'vereda' ? 'Rural' : '')),
      'Comuna': f.territorio_tipo === 'barrio' ? (f.pertenece || '') : '',
      'Barrio': f.territorio_tipo === 'barrio' ? f.territorio_nombre : '',
      'Corregimiento': f.territorio_tipo === 'vereda' ? (f.pertenece || '') : '',
      'Vereda': f.territorio_tipo === 'vereda' ? f.territorio_nombre : '',
      'Organización': f.tipo_area_influencia === 'organizacion' ? (f.organizacion || '') : '',
      'Líder o coordinador': f.lider_email || '',
      'Apoya a': (Array.isArray(f.apoya_a) ? f.apoya_a : []).map(v => ETIQUETAS_APOYA_A[v] || v).join(', '),
      'Observaciones': f.observaciones || '',
      'Autorización de datos': sqlAut.ETIQUETAS[f.autorizacion_estado] || '',
      'Fecha de firma': f.autorizacion_firmada_en ? String(f.autorizacion_firmada_en).slice(0, 16) : ''
    }));

    // Si no hay registros, igual se exporta la hoja con los encabezados.
    const hoja = datos.length
      ? XLSX.utils.json_to_sheet(datos, { header: columnas })
      : XLSX.utils.aoa_to_sheet([columnas]);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Votantes');
    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="votantes.xlsx"');
    await registrarAuditoria(
      req.session.usuario.id, 'exportar_excel', 'votantes', null,
      condiciones.length
        ? `Exportó el Excel de votantes con filtro aplicado (${filas.length} registros).`
        : `Exportó el Excel completo de votantes (${filas.length} registros).`,
      req.ip
    );
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error exportando los votantes.' });
  }
});

// Importa votantes/contactos desde un Excel con columnas: ID, Nombres,
// Apellidos, Número de identificación, Género, Fecha nacimiento,
// Departamento votación, Municipio votación, Puesto, Mesa, Teléfono, Email,
// Dirección de Residencia, Área, Comuna, Barrio, Corregimiento, Vereda,
// Líder o coordinador (email), Intención de voto, Observaciones.
//
// La columna ID es la que permite REIMPORTAR PARA ACTUALIZAR: si una fila
// trae un ID que ya existe, esa fila ACTUALIZA ese contacto (no crea uno
// nuevo); si el ID viene vacío, se crea un contacto nuevo, igual que
// siempre. Así, el flujo "exportar -> editar en Excel -> volver a
// importar" queda soportado sin duplicar a nadie.
router.post('/importar-excel', requireRole('admin', 'coordinador'), requiereImportarExportar('votantes'), uploadExcel.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Debe adjuntar un archivo Excel (.xlsx).' });
  try {
    const libro = XLSX.read(req.file.buffer, { type: 'buffer' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });

    let insertados = 0;
    let actualizados = 0;
    let camposBorrados = 0;          // celdas con «-» que borraron un dato a propósito (orden 42)
    const errores = [];
    const posiblesDuplicados = [];
    // Orden 36: la comuna/corregimiento de cada fila se comprueba contra la lista de la campaña (una sola lectura).
    const avisos = [];
    const listaComunasImport = await listaDeComunas(pool);

    /* LA RAMA DE CADA LIDER, PREGUNTADA UNA SOLA VEZ.
       Un Excel trae muchas filas y pocos lideres distintos, y averiguar la rama
       sube por la cadena de mando con una CTE recursiva. Se guarda tambien el
       `null`, que es la respuesta mas comun —la mayoria de los lideres no
       cuelgan de ningun aspirante— y la que mas se repetiria. */
    const ramaPorLider = new Map();
    const ramaMemorizada = async (idLider) => {
      if (!ramaPorLider.has(idLider)) {
        ramaPorLider.set(idLider, await ramaDeVotante(pool, { lider_id: idLider }));
      }
      return ramaPorLider.get(idLider);
    };

    /* LAS CÉDULAS REPETIDAS (orden 30). Una fila cuya cédula —normalizada: «1.053…» y «1053…» son la misma— ya está
       en la base, o en una fila anterior del mismo archivo, se SALTA y queda en el resumen con su número de fila y la
       cédula enmascarada. La base se consulta UNA vez para todo el archivo (no una vez por fila: un Excel de 5.000
       filas contra 200.000 fichas no se puede barrer 5.000 veces). */
    const cedulaCruda = (f) => String(f['Número de identificación'] || f.Cédula || f.Cedula || f.cedula || '').trim();
    const cedulasDelArchivo = filas.map(f => normalizarCedula(cedulaCruda(f))).filter(Boolean);
    const fichasPorCedula = await mapaDeFichasPorCedula(pool, cedulasDelArchivo);
    const cedulaVistaEnFila = new Map();      // cédula normalizada → fila (Excel) donde sí se importó
    const cedulasRepetidas = [];              // { fila, donde: 'archivo' | 'base', cedula: '***456', otraFila? }

    for (const [i, fila] of filas.entries()) {
      const idFila = String(fila['ID'] || fila.id || '').trim() || null;
      // Admite tanto la columna nueva ("Nombres y apellidos", un solo
      // campo) como las dos columnas viejas ("Nombres" + "Apellidos") por
      // si alguien todavía tiene una plantilla de Excel de antes de este
      // cambio guardada en su computador.
      const nombre = String(
        fila['Nombres y apellidos'] || fila.nombre_completo ||
        [fila.Nombres || fila.nombres, fila.Apellidos || fila.apellidos].filter(Boolean).join(' ') || ''
      ).trim();
      /* UNA CELDA VACÍA NO TOCA EL DATO (orden 42, lib/importarCeldas.js). Al ACTUALIZAR (la fila trae ID), un nombre vacío
         es «no lo cambies»; al CREAR sigue siendo obligatorio. El «-» no borra en las columnas obligatorias: error de la fila. */
      const errorMarca = IC.marcaEnColumnaNoBorrable([
        ['Nombres y apellidos', nombre], ['Número de identificación', cedulaCruda(fila)],
        ['Género', IC.crudoDe(fila, 'Género', 'Genero', 'genero')], ['Área', IC.crudoDe(fila, 'Área', 'Area', 'area')],
        ['Comuna', IC.crudoDe(fila, 'Comuna', 'comuna')], ['Barrio', IC.crudoDe(fila, 'Barrio', 'barrio')],
        ['Corregimiento', IC.crudoDe(fila, 'Corregimiento', 'corregimiento')], ['Vereda', IC.crudoDe(fila, 'Vereda', 'vereda')],
        ['Líder o coordinador', IC.crudoDe(fila, 'Líder o coordinador', 'lider_email')],
      ]);
      if (errorMarca) { errores.push({ fila: i + 2, error: errorMarca }); continue; }
      if (!nombre && !idFila) {
        errores.push({ fila: i + 2, error: 'Nombres y apellidos son obligatorios.' });
        continue;
      }
      let cedula = cedulaCruda(fila) || null;
      if (cedula) {
        // Lo que se tecleó se valida como siempre (mismos mensajes); lo que se guarda es solo dígitos.
        const rev = revisarCedula({ cedula, nombre });
        if (rev.bloqueo) { errores.push({ fila: i + 2, error: rev.bloqueo }); continue; }
        cedula = normalizarCedula(cedula) || null;
      }
      if (cedula) {
        const otraFila = cedulaVistaEnFila.get(cedula);
        if (otraFila) {
          cedulasRepetidas.push({ fila: i + 2, donde: 'archivo', cedula: enmascararCedula(cedula), otraFila });
          errores.push({ fila: i + 2, error: `Cédula repetida (${enmascararCedula(cedula)}): ya viene en la fila ${otraFila} de este archivo. Se saltó.` });
          continue;
        }
        const enBase = fichasPorCedula.get(cedula);
        // En modo actualizar, la ficha que se está actualizando no cuenta como «otra».
        if (enBase && String(enBase.id) !== String(idFila || '')) {
          cedulasRepetidas.push({ fila: i + 2, donde: 'base', cedula: enmascararCedula(cedula) });
          errores.push({ fila: i + 2, error: `Cédula repetida (${enmascararCedula(cedula)}): ya existe en la base${idFila ? ' en otro contacto' : ''}. Se saltó.` });
          continue;
        }
      }
      /* LAS CELDAS OPCIONALES SE LEEN CRUDAS: vacía = no toca, «-» = borra, otra cosa = valor (orden 42). En una fila NUEVA
         vacía y «-» valen lo mismo (null); al ACTUALIZAR cada una decide si su columna entra en el UPDATE. */
      const crudo = {
        telefono: IC.crudoDe(fila, 'Teléfono', 'Telefono', 'telefono'),
        email: IC.crudoDe(fila, 'Email', 'email'),
        edad: IC.crudoDe(fila, 'Edad', 'edad'),
        fechaNacimiento: IC.crudoDe(fila, 'Fecha nacimiento', 'fecha_nacimiento'),
        departamentoVotacion: IC.crudoDe(fila, 'Departamento votación', 'departamento_votacion'),
        municipioVotacion: IC.crudoDe(fila, 'Municipio votación', 'municipio_votacion'),
        puestoVotacion: IC.crudoDe(fila, 'Puesto', 'Puesto de votación', 'puesto_votacion'),
        mesaVotacion: IC.crudoDe(fila, 'Mesa', 'Mesa de votación', 'mesa_votacion'),
        direccion: IC.crudoDe(fila, 'Dirección de Residencia', 'Dirección', 'Direccion', 'direccion'),
        departamentoResidencia: IC.crudoDe(fila, 'Departamento de residencia', 'departamento_residencia'),
        ciudadResidencia: IC.crudoDe(fila, 'Ciudad de residencia', 'ciudad_residencia'),
        observaciones: IC.crudoDe(fila, 'Observaciones', 'observaciones'),
      };
      const generoTexto = String(fila.Género || fila.Genero || fila.genero || '').trim().toLowerCase();
      const MAPA_GENERO_IMPORT = {
        'mujer': 'mujer', 'f': 'mujer', 'femenino': 'mujer',
        'hombre': 'hombre', 'm': 'hombre', 'masculino': 'hombre',
        'no binario': 'no_binario', 'no_binario': 'no_binario', 'otro': 'no_binario',
        'prefiero no responder': 'prefiero_no_responder', 'prefiero_no_responder': 'prefiero_no_responder', 'no informa': 'prefiero_no_responder'
      };
      // Con valor y sin reconocer queda «prefiero no responder», como siempre; VACÍO no toca (en una fila nueva, ese es el valor).
      const genero = MAPA_GENERO_IMPORT[generoTexto] || 'prefiero_no_responder';
      // Los valores para una fila NUEVA (y los que usa el geocodificador). Al ACTUALIZAR se arma `cambios` más abajo.
      const nTel = IC.valorNuevo(crudo.telefono, normalizarTelefonoImportado);
      const nEdad = IC.valorNuevo(crudo.edad, IC.enteroPositivo);
      const telefono = nTel.valor;
      const email = IC.valorNuevo(crudo.email).valor;
      const edad = nEdad.valor;
      const fechaNacimiento = IC.valorNuevo(crudo.fechaNacimiento, (t) => t).valor;
      const departamentoVotacion = IC.valorNuevo(crudo.departamentoVotacion).valor;
      const municipioVotacion = IC.valorNuevo(crudo.municipioVotacion).valor;
      const puestoVotacion = IC.valorNuevo(crudo.puestoVotacion).valor;
      const mesaVotacion = IC.valorNuevo(crudo.mesaVotacion).valor;
      const area = String(fila.Área || fila.Area || fila.area || '').trim();
      let comuna = String(fila.Comuna || fila.comuna || '').trim();
      const barrio = String(fila.Barrio || fila.barrio || '').trim();
      let corregimiento = String(fila.Corregimiento || fila.corregimiento || '').trim();
      const vereda = String(fila.Vereda || fila.vereda || '').trim();
      /* LA CIUDAD O EL DEPARTAMENTO EN LA COLUMNA «COMUNA» (orden 36). Con la campaña teniendo lista de comunas, lo que no
         está en ella se IGNORA y se avisa en el resumen: antes la fila se perdía entera («Falta el Barrio…»), o peor,
         el barrio se buscaba dentro de una comuna que no existe. Sin lista (campaña sin comunas) no se toca nada. */
      for (const [campo, etiqueta] of [['comuna', 'comuna'], ['corregimiento', 'corregimiento']]) {
        const valor = campo === 'comuna' ? comuna : corregimiento;
        const rev = revisarComuna(valor, listaComunasImport);
        if (rev.descartada) {
          avisos.push({ fila: i + 2, aviso: `fila ${i + 2}: ${etiqueta} "${rev.descartada}" no existe en la campaña; quedó vacía.` });
          if (campo === 'comuna') comuna = ''; else corregimiento = '';
        }
      }
      const direccion = IC.valorNuevo(crudo.direccion).valor;
      const departamentoResidenciaImport = IC.valorNuevo(crudo.departamentoResidencia).valor;
      const ciudadResidenciaImport = IC.valorNuevo(crudo.ciudadResidencia).valor;
      const liderEmail = String(fila['Líder o coordinador'] || fila.lider_email || '').trim().toLowerCase();
      const observaciones = IC.valorNuevo(crudo.observaciones).valor;

      // Si estas columnas vienen vacías en una fila que SÍ trae ID (modo
      // actualizar), no se borra lo que ya tenía guardado ese contacto —
      // solo se cambia el Territorio o el Líder si la fila trae algo en
      // esas columnas. En una fila nueva (sin ID) esto no aplica.
      const tocarTerritorio = !!(comuna || barrio || corregimiento || vereda);
      const tocarLider = !!liderEmail;

      let territorioId = null;
      if (tocarTerritorio) {
        /* Si la comuna se ignoró y la fila trae barrio, el barrio ya no tiene comuna que lo desempate: si el
           nombre existe en varias comunas se rechaza la fila en vez de adivinar cuál (mismo criterio de siempre:
           un barrio en el sitio equivocado no da error, sólo cuentas malas). */
        if (barrio && !comuna && avisos.some(x => x.fila === i + 2)) {
          const [[rep]] = await pool.query(
            `SELECT COUNT(*) AS n FROM territorios WHERE tipo = 'barrio' AND LOWER(nombre) COLLATE utf8mb4_unicode_ci = LOWER(?) COLLATE utf8mb4_unicode_ci`, [barrio]);
          if (Number(rep.n) > 1) {
            errores.push({ fila: i + 2, error: `Barrio "${barrio}" existe en varias comunas y la comuna de la fila no es válida. Indica una comuna de la lista.` });
            continue;
          }
        }
        const resuelto = await resolverTerritorioDesdeNombres(pool, { area, comuna, barrio, corregimiento, vereda });
        if (resuelto.error) { errores.push({ fila: i + 2, error: resuelto.error }); continue; }
        territorioId = resuelto.territorioId;
      }

      let liderId = null;
      if (tocarLider) {
        const [[u]] = await pool.query(`SELECT id FROM usuarios WHERE LOWER(email) = ?`, [liderEmail]);
        if (u) liderId = u.id;
      }

      if (idFila) {
        // --- Modo actualizar: la fila trae un ID existente ---
        try {
          const [[existente]] = await pool.query(`SELECT id FROM votantes WHERE id = ?`, [idFila]);
          if (!existente) {
            errores.push({ fila: i + 2, error: `No existe un contacto con ID ${idFila} — no se puede actualizar. Borra la columna ID en esta fila si quieres crear uno nuevo.` });
            continue;
          }
          /* EL UPDATE LLEVA SOLO LAS COLUMNAS DE LAS CELDAS QUE TRAEN ALGO (orden 42). Hasta el 327 pisaba toda la ficha con lo
             que viniera, y lo vacío era NULL (o el valor por defecto: género «prefiero no responder»). */
          const cambios = new IC.Cambios();
          if (nombre) cambios.poner('nombre', nombre);
          if (cedula) cambios.poner('cedula', cedula);
          const avisoFila = (texto) => avisos.push({ fila: i + 2, aviso: `fila ${i + 2}: ${texto}` });
          if (IC.aplicarOpcional(cambios, 'telefono', crudo.telefono, normalizarTelefonoImportado) === 'invalido') avisoFila('teléfono inválido, se dejó el que tenía.');
          IC.aplicarOpcional(cambios, 'email', crudo.email);
          if (!IC.esVacia(generoTexto)) cambios.poner('genero', genero);
          if (IC.aplicarOpcional(cambios, 'edad', crudo.edad, IC.enteroPositivo) === 'invalido') avisoFila('edad inválida, se dejó la que tenía.');
          IC.aplicarOpcional(cambios, 'fecha_nacimiento', crudo.fechaNacimiento, (t) => t);
          IC.aplicarOpcional(cambios, 'direccion', crudo.direccion);
          IC.aplicarOpcional(cambios, 'departamento_residencia', crudo.departamentoResidencia);
          IC.aplicarOpcional(cambios, 'ciudad_residencia', crudo.ciudadResidencia);
          if (area) cambios.poner('area', area);
          if (tocarTerritorio) cambios.poner('territorio_id', territorioId);
          if (tocarLider && liderId) cambios.poner('lider_id', liderId);
          IC.aplicarOpcional(cambios, 'departamento_votacion', crudo.departamentoVotacion);
          IC.aplicarOpcional(cambios, 'municipio_votacion', crudo.municipioVotacion);
          IC.aplicarOpcional(cambios, 'puesto_votacion', crudo.puestoVotacion);
          IC.aplicarOpcional(cambios, 'mesa_votacion', crudo.mesaVotacion);
          IC.aplicarOpcional(cambios, 'observaciones', crudo.observaciones);
          if (!cambios.hay) {
            avisoFila('no trae ningún dato para cambiar (las celdas vacías no tocan la ficha).');
            continue;
          }
          await pool.query(`UPDATE votantes SET ${cambios.sql()} WHERE id = ?`, [...cambios.valores, idFila]);
          actualizados++;
          camposBorrados += cambios.borrados;
          if (cedula) cedulaVistaEnFila.set(cedula, i + 2);
          // Solo se vuelve a ubicar si la fila trae una dirección nueva (la borrada o la que no cambió no se geocodifica).
          if (direccion) {
            geocodificarYGuardarVotante(idFila, direccion, tocarTerritorio ? territorioId : null, departamentoResidenciaImport, ciudadResidenciaImport)
              .catch(err => console.error(`Error geocodificando la fila actualizada (votante id ${idFila}):`, err));
          }
        } catch (err) {
          errores.push({ fila: i + 2, error: err.code === 'ER_DUP_ENTRY' ? 'Número de identificación duplicado.' : 'Error al actualizar esta fila.' });
        }
        continue;
      }

      // --- Modo agregar: la fila no trae ID, se crea un contacto nuevo ---
      if (nTel.invalido) avisos.push({ fila: i + 2, aviso: `fila ${i + 2}: teléfono inválido, se importó sin teléfono.` });
      if (nEdad.invalido) avisos.push({ fila: i + 2, aviso: `fila ${i + 2}: edad inválida, se importó sin edad.` });
      // Si la fila no trae cédula, la restricción UNIQUE de la tabla no
      // puede avisar de un duplicado — se busca a mano por teléfono o
      // nombre parecido y se avisa en el resultado (sin dejar de
      // importar la fila: puede ser una persona distinta con el mismo
      // nombre, la decisión la toma quien revise el resultado).
      if (!cedula) {
        try {
          const condicionesDup = [];
          const paramsDup = [];
          if (telefono) { condicionesDup.push('telefono = ?'); paramsDup.push(telefono); }
          // SOUNDEX en vez de un buscador de texto libre: en la práctica un
          // apellido común (ej. "Arias") hacía que MATCH...AGAINST
          // encontrara a cualquiera que lo comparta, aunque el resto del
          // nombre no se parezca en nada.
          condicionesDup.push('SOUNDEX(nombre) = SOUNDEX(?)');
          paramsDup.push(nombre);
          const [posibles] = await pool.query(
            `SELECT id, nombre, telefono FROM votantes WHERE (${condicionesDup.join(' OR ')}) LIMIT 1`,
            paramsDup
          );
          if (posibles.length) {
            posiblesDuplicados.push({ fila: i + 2, nombre, coincideCon: `${posibles[0].nombre} (id ${posibles[0].id})` });
          }
        } catch (errDup) {
          console.error('Error verificando duplicado en importación (no detiene la fila):', errDup);
        }
      }

      try {
        const [result] = await pool.query(
          `INSERT INTO votantes
           (nombre, cedula, telefono, email, genero, edad, fecha_nacimiento, territorio_id,
            direccion, departamento_residencia, ciudad_residencia, area, lider_id, departamento_votacion, municipio_votacion,
            puesto_votacion, mesa_votacion, observaciones, created_by, origen, rama_aspirante_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'importado', ?)`,
          [nombre, cedula, telefono, email, genero, edad, fechaNacimiento || null, territorioId,
           direccion, departamentoResidenciaImport, ciudadResidenciaImport, area || null, liderId || req.session.usuario.id,
           departamentoVotacion, municipioVotacion, puestoVotacion, mesaVotacion,
           observaciones, req.session.usuario.id,
           /* MISMA REGLA QUE EN EL FORMULARIO: la rama se escribe al guardar.
              Aqui se memoriza por lider porque un Excel de 5.000 filas suele
              traer dos o tres lideres distintos, y cada consulta sube por la
              cadena de mando con una CTE recursiva. */
           await ramaMemorizada(liderId || req.session.usuario.id)]
        );
        insertados++;
        if (cedula) cedulaVistaEnFila.set(cedula, i + 2);
        geocodificarYGuardarVotante(result.insertId, direccion, territorioId, departamentoResidenciaImport, ciudadResidenciaImport)
          .catch(err => console.error(`Error geocodificando la fila importada (votante id ${result.insertId}):`, err));
      } catch (err) {
        errores.push({ fila: i + 2, error: err.code === 'ER_DUP_ENTRY' ? 'Número de identificación duplicado.' : 'Error al insertar esta fila.' });
      }
    }

    res.json({ ok: true, insertados, actualizados, camposBorrados, errores, avisos, posiblesDuplicados, cedulasRepetidas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error procesando el archivo Excel. Verifica que el formato de las columnas sea correcto.' });
  }
});

// Verifica en tiempo real (antes de guardar) si un número de identificación
// ya está registrado por otro contacto. excluir_id se usa en modo edición
// para no contarse a sí mismo como duplicado.
router.get('/verificar-identificacion', async (req, res) => {
  const { numero, excluir_id } = req.query;
  if (!numero || !numero.trim()) return res.json({ disponible: true });
  try {
    // Normalizado y con las variantes guardadas («1.053…», ceros): lo mismo que comprueba el guardado.
    const hay = await buscarFichaPorCedula(pool, normalizarCedula(numero), excluir_id || null);
    if (!hay) return res.json({ disponible: true });
    /* ¿LA FICHA ES DE QUIEN PREGUNTA? (parche 327, duda 18 del 299). El aviso rojo «Ya registrado por otro líder» salía
       también cuando la persona ya era suya, y no era cierto. Se dice aparte (`mia`) para que la pantalla muestre otro
       texto; sigue sin dar un solo dato de la ficha. */
    const [[f]] = await pool.query('SELECT lider_id, sublider_id FROM votantes WHERE id = ?', [hay]);
    const miId = req.session.usuario.id;
    res.json({ disponible: false, mia: !!f && (f.lider_id === miId || f.sublider_id === miId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error verificando el número de identificación.' });
  }
});

/**
 * Búsqueda por cédula EXACTA, sin el filtro de "solo mis contactos" que sí
 * aplica el listado general (GET /) para líderes/sublíderes — un asistente
 * a una reunión puede haber sido referido por otro líder distinto al que
 * está pasando lista, y aun así hay que poder encontrarlo por su número de
 * identificación para agregarlo (y para no intentar registrarlo de nuevo,
 * lo que fallaría por la cédula duplicada). A diferencia de una búsqueda
 * por nombre, esto no expone el resto del libro de contactos de otro
 * líder: solo confirma quién es el dueño de ESA cédula puntual.
 */
/* El límite de búsquedas por cédula (60 por usuario cada 10 minutos) y las iniciales viven en lib/busquedaCedula.js: las comparte
   la búsqueda de cuentas (routes/usuarios.routes.js), con el MISMO contador. */

/**
 * LA FICHA, SEGÚN QUIÉN PREGUNTA (orden 31). Antes devolvía nombre, teléfono y cédula de la ficha dueña de esa cédula
 * a CUALQUIERA con sesión, fuera o no de su alcance: bastaba teclear cédulas para averiguar quién estaba inscrito con
 * otro líder y cómo llamarlo. Ahora:
 *   · si la ficha está en su alcance (la ve en su listado) o es suya: responde como siempre;
 *   · si es de otro líder: SOLO { existe, de_otro_lider, iniciales, puede_sumar }. Ni teléfono, ni cédula, ni correo,
 *     ni dirección, ni puesto, ni quién es el líder dueño;
 *   · el administrador ve todo.
 * Cada búsqueda que cae en una ficha ajena queda en `auditoria` con los tres últimos dígitos de la cédula, para
 * detectar a quien recorre cédulas.
 */
router.get('/buscar-por-cedula', limiteBuscarCedula, async (req, res) => {
  const cedula = (req.query.cedula || '').trim();
  if (!cedula) return res.json(null);
  try {
    // Por la cédula normalizada y con las variantes guardadas: la misma persona se encuentra se escriba como se escriba.
    const cedulaNormalizada = normalizarCedula(cedula);
    const hallada = await buscarFichaPorCedula(pool, cedulaNormalizada);
    if (!hallada) return res.json(null);
    const [[fila]] = await pool.query(
      `SELECT id, nombre, telefono, cedula, lider_id, sublider_id, rama_aspirante_id
         FROM votantes WHERE id = ?`,
      [hallada]
    );
    if (!fila) return res.json(null);

    /* CON QUIEN PREGUNTA, LA MISMA CEDULA SIGNIFICA COSAS DISTINTAS.
       `mia` para abrir la ficha en vez de intentar crearla, y `puede_sumar` para ofrecer agregarla a su rama.
       Lo que NO se agrega es la valoracion ni las observaciones de la otra rama. */
    let miRama = null;
    try {
      miRama = await aspiranteDe(pool, req.session.usuario.id);
    } catch (err) {
      // Campaña sin las tablas de sublicencias: se responde como siempre.
      if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
    }

    let yaEnMiRama = false;
    if (miRama) {
      const [[c]] = await pool.query(
        'SELECT COUNT(*) n FROM votante_ramas WHERE votante_id = ? AND aspirante_id = ?',
        [fila.id, miRama]);
      yaEnMiRama = c.n > 0;
    }

    const mia = fila.lider_id === req.session.usuario.id
             || fila.sublider_id === req.session.usuario.id
             || !!(miRama && (fila.rama_aspirante_id === miRama || yaEnMiRama));
    // Sin rama propia no hay donde sumarla, y ofrecerlo seria un boton que se niega al pulsarlo.
    const puedeSumar = !!miRama && !mia;

    // ¿La ve en su listado? La misma condición que el listado (lib/alcanceVotantes.js). El administrador, sin sublicencia, ve todo.
    let enMiAlcance = mia || (req.session.usuario.rol === 'admin' && !req.sublicencia) || !req.alcance;
    if (!enMiAlcance) {
      const [[visible]] = await pool.query(
        `SELECT 1 AS ok FROM votantes v WHERE v.id = ? AND ${condicionAlcanceVotantes(req.alcance, 'v')}`,
        [fila.id, ...parametrosAlcanceVotantes(req.alcance)]);
      enMiAlcance = !!visible;
    }

    if (enMiAlcance) {
      return res.json({
        id: fila.id,
        nombre: fila.nombre,
        telefono: fila.telefono,
        cedula: fila.cedula,
        mia,
        puede_sumar: puedeSumar,
      });
    }

    // Ficha de otro líder: queda el rastro (quién, cuándo —lo pone la tabla— y los tres últimos dígitos) y se responde lo mínimo.
    await registrarAuditoria(req.session.usuario.id, 'buscar_cedula_ajena', 'votantes', null,
      `Buscó una cédula de otro líder (${enmascararCedula(cedulaNormalizada)})`, req.ip);
    res.json({ existe: true, de_otro_lider: true, iniciales: inicialesDe(fila.nombre), puede_sumar: puedeSumar });
  } catch (err) {
    console.error(err.code || err.message);
    res.status(500).json({ error: 'Error buscando por número de identificación.' });
  }
});

/**
 * Alerta (sin bloquear) si ya existe un contacto parecido — por el mismo
 * teléfono, o por nombre muy similar — antes de guardar uno SIN cédula
 * (con cédula, la restricción UNIQUE de la tabla ya evita el duplicado de
 * raíz). No es un bloqueo duro a propósito: dos personas distintas pueden
 * compartir nombre, así que la decisión final queda en quien registra —
 * esto solo le muestra la coincidencia para que la revise.
 */
router.get('/verificar-duplicado', limiteVerificarDuplicado, async (req, res) => {
  const { nombre, telefono, excluir_id } = req.query;
  if (!nombre || !nombre.trim()) return res.json({ coincidencias: [] });

  const telefonoLimpio = (telefono || '').replace(/\D/g, '');
  const condiciones = [];
  const params = [];

  if (telefonoLimpio) {
    condiciones.push(`v.telefono = ?`);
    params.push(telefonoLimpio);
  }
  // SOUNDEX en vez de un buscador de texto libre (MATCH...AGAINST): en la
  // práctica cualquier apellido común (ej. "Arias") hacía que encontrara a
  // todo el que lo comparta, aunque el resto del nombre no se pareciera en
  // nada. No atrapa errores de digitación en la primera letra (limitación
  // conocida del algoritmo).
  condiciones.push(`SOUNDEX(v.nombre) = SOUNDEX(?)`);
  params.push(nombre.trim());

  /* LO MÍNIMO PARA AVISAR (parche 327). Antes devolvía nombre, teléfono y CÉDULA COMPLETA de hasta cinco fichas a
     cualquier sesión (un testigo, un invitado), sin límite y sin alcance: bastaba teclear un teléfono para averiguar
     de quién era y su cédula. Ahora responde como `buscar-por-cedula` con una ficha ajena: que existe, las iniciales y
     quién la registró. Ni teléfono, ni cédula, ni nombre completo. Lleva límite de consultas por usuario. */
  let query = `SELECT v.id, v.nombre, v.telefono, v.lider_id, v.sublider_id, ul.nombre AS lider_nombre
                 FROM votantes v LEFT JOIN usuarios ul ON ul.id = v.lider_id
                WHERE (${condiciones.join(' OR ')})`;
  if (excluir_id) { query += ` AND v.id != ?`; params.push(excluir_id); }
  query += ` LIMIT 5`;

  try {
    const [rows] = await pool.query(query, params);
    res.json({
      coincidencias: rows.map(r => {
        const mia = r.lider_id === req.session.usuario.id || r.sublider_id === req.session.usuario.id;
        return {
          existe: true,
          iniciales: inicialesDe(r.nombre),
          mia,
          // Quién la registró: «usted» si es suya; si no, el nombre de su líder (solo el nombre, nada más).
          registrado_por: mia ? 'usted' : (r.lider_nombre || null),
          porTelefono: !!(telefonoLimpio && r.telefono === telefonoLimpio)
        };
      })
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error verificando posibles duplicados.' });
  }
});

/**
 * Resuelve automáticamente el "Referido por" para quien está registrando
 * un votante — pensado para la app móvil de captura (Líderes/Sublíderes),
 * donde ese campo no se elige a mano, se autocompleta según quién inició
 * sesión. SIEMPRE se calcula desde la Estructura territorial guardada en
 * el servidor (nunca se recibe del cliente), así ninguna app pueda
 * hacerse pasar por otro líder/sublíder.
 * - Si quien entra es Líder: el referido es él mismo.
 * - Si quien entra es Sublíder: el referido es el Líder del que depende
 *   (estructura.supervisor_id), y el campo Sublíder queda con él mismo.
 * - Cualquier otro rol (admin, coordinador...): no hay autocompletado,
 *   se sigue eligiendo a mano como ya funciona en el panel de escritorio.
 */
router.get('/mi-referido', async (req, res) => {
  const usuario = req.session.usuario;
  try {
    /* Al aspirante NO se le autocompleta, por lo mismo que no se le coacciona
       al guardar: su sesion dice 'lider' pero el registra bajo la gente de su
       rama, no bajo si mismo. Devolverle su propio nombre aqui le llenaba el
       campo con la respuesta equivocada antes de que pudiera elegir.
       LA MISMA LLAVE QUE LA GUARDA, `req.sublicencia`. Lo que se ofrece y lo
       que se acepta tienen que decidirse igual: a quien cumpliera un criterio
       y no el otro, esta ruta le dejaba el campo en blanco para que eligiera y
       despues el guardado se lo reescribia igual. */
    if (req.sublicencia) {
      return res.json({ lider_id: null, lider_nombre: null, sublider_id: null, sublider_nombre: null });
    }
    if (usuario.rol === 'lider') {
      return res.json({ lider_id: usuario.id, lider_nombre: usuario.nombre, sublider_id: null, sublider_nombre: null });
    }
    if (usuario.rol === 'sublider') {
      const [[fila]] = await pool.query(
        `SELECT e.supervisor_id, u.nombre AS lider_nombre
         FROM estructura e LEFT JOIN usuarios u ON u.id = e.supervisor_id
         WHERE e.usuario_id = ? AND e.cargo = 'usuario'`,
        [usuario.id]
      );
      return res.json({
        lider_id: fila ? fila.supervisor_id : null,
        lider_nombre: fila && fila.supervisor_id ? (fila.lider_nombre || 'Líder asignado') : null,
        sublider_id: usuario.id,
        sublider_nombre: usuario.nombre
      });
    }
    res.json({ lider_id: null, lider_nombre: null, sublider_id: null, sublider_nombre: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error resolviendo el líder/sublíder de referencia.' });
  }
});

/* PEDIRLE A LA PERSONA QUE CONFIRME DESDE SU PROPIO CANAL.
   POR SMS, SIEMPRE A MANO: cada mensaje gasta crédito real del saldo, y una
   campaña que registre mil personas en un día se gastaría mil créditos sin
   que nadie lo hubiera decidido. Por correo puede ser automático, pero solo
   si la campaña lo enciende — ver `config/confirmacionAutomatica.js`, que
   nace apagado y aplica exactamente estos mismos filtros.
   Tampoco se manda a quien no autorizó ese canal: pedirle permiso por un medio
   que dijo que no quería es exactamente lo que la autorización prohíbe. */
router.post('/:id/pedir-confirmacion', requireRole('admin', 'coordinador'), async (req, res) => {
  const canal = req.body && req.body.canal;
  if (canal !== 'sms' && canal !== 'email') {
    return res.status(400).json({ error: 'El canal debe ser sms o email.' });
  }
  try {
    /* TAMBIÉN ACOTADO POR RAMA, y aquí importa el doble: este botón gasta
       crédito real de SMS de la campaña. Sin el filtro, un coordinador podía
       disparar mensajes contra toda la base, no solo contra su gente. */
    let sqlV = `SELECT id, nombre, telefono, email, consentimiento_autorizado,
                       consentimiento_sms, consentimiento_email, consentimiento_confirmado_en, no_contactar
                  FROM votantes WHERE id = ?`;
    const paramsV = [req.params.id];
    if (req.alcance) {
      sqlV += ` AND ${condicionAlcanceVotantes(req.alcance, '')}`;
      paramsV.push(...parametrosAlcanceVotantes(req.alcance));
    }
    const [[v]] = await pool.query(sqlV, paramsV);
    if (!v) return res.status(404).json({ error: 'Esa persona no existe.' });
    if (!v.consentimiento_autorizado) {
      return res.status(400).json({ error: 'Esa persona no tiene autorización registrada.' });
    }
    /* QUIEN PIDIÓ LA BAJA NO RECIBE NI SIQUIERA ESTA CONFIRMACIÓN (parche 327). Es un mensaje más: pedirle que
       confirme lo que autorizó, después de que pidió no recibir nada, es justo lo que la baja prohíbe. */
    if (Number(v.no_contactar) === 1) {
      return res.status(400).json({ error: 'Esa persona pidió no recibir más mensajes: no se le puede escribir.' });
    }
    if (v.consentimiento_confirmado_en) {
      return res.json({ ok: true, yaConfirmado: true, en: v.consentimiento_confirmado_en });
    }
    // Un 0 explícito es un no; NULL es "no consta" y se deja pasar, igual que
    // hace `autorizaCanal` en comunicaciones — si no, las fichas anteriores a
    // que existiera la pregunta quedarían fuera de todo.
    const autorizaEse = canal === 'sms' ? v.consentimiento_sms !== 0 : v.consentimiento_email !== 0;
    if (!autorizaEse) {
      return res.status(400).json({ error: `Esa persona no autorizó que se le escriba por ${canal === 'sms' ? 'mensaje de texto' : 'correo'}.` });
    }
    const destino = canal === 'sms' ? v.telefono : v.email;
    if (!destino) return res.status(400).json({ error: `No hay ${canal === 'sms' ? 'teléfono' : 'correo'} registrado.` });

    /* NO REENVIAR ANTES DE 24 HORAS. Cada SMS gasta crédito del saldo de la
       campaña —y uno con enlace ocupa dos segmentos, o sea dos créditos—, así
       que una pantalla que reenvíe de un clic puede quemar el saldo sin que
       nadie se dé cuenta. Y para la persona, recibir el mismo enlace cuatro
       veces se parece mucho al acoso que la autorización pretende evitar.
       Con `?forzar=1` se salta, para el caso legítimo de un número corregido. */
    if (!req.query.forzar) {
      const [[reciente]] = await pool.query(
        `SELECT enviada_en FROM consentimiento_confirmaciones
          WHERE votante_id = ? AND canal = ? AND enviada_en > NOW() - INTERVAL 24 HOUR
          ORDER BY enviada_en DESC LIMIT 1`, [v.id, canal]
      );
      if (reciente) {
        return res.status(429).json({
          error: 'Ya se le envió una confirmación por ese medio en las últimas 24 horas.',
          enviadaEn: reciente.enviada_en
        });
      }
    }

    const { enlace } = await crearConfirmacion({ req, votanteId: v.id, canal, destino });

    if (canal === 'email') {
      const { enviarCorreoMasivo } = require('../config/mailer');
      await enviarCorreoMasivo(destino,
        'Confirme su autorización de datos',
        'Usted autorizó que la campaña guarde sus datos y le escriba.\n\n' +
        'Para dejar constancia, abra este enlace y pulse el botón:\n' + enlace + '\n\n' +
        'Si no reconoce esta solicitud, ignore este mensaje: sin su confirmación no pasa nada.',
        null);
    } else {
      const { enviarSMS } = require('../config/sms');
      // Corto a propósito: cada segmento de más es otro crédito. Este mensaje sale DIRECTO por
      // `enviarSMS`, que NO pega ningún «Baja: …»: ese pie lo agrega `agregarBajaSms`
      // (routes/comunicaciones.routes.js) solo a los envíos de campaña. La salida de quien lo recibe
      // es la página de /c («No quiero recibir más mensajes», `/c/<token>?baja=1`).
      await enviarSMS(destino, 'Confirme su autorizacion de datos: ' + enlace);
    }
    res.json({ ok: true, canal, destino });
  } catch (err) {
    console.error(err);
    // Los errores del canal traen mensajes que sí sirven a quien los lee
    // (fuera de franja, dado de baja, sin saldo): se dejan pasar tal cual.
    res.status(400).json({ error: err.message || 'No se pudo enviar la confirmación.' });
  }
});

/* EXHIBIR LA FIRMA. Sin esto la firma se guarda y no la ve nadie, que es
   tanto como no tenerla: la evidencia sirve cuando se puede enseñar.
   Va ANTES de /:id porque Express casa por orden y '/:id' se tragaría
   cualquier cosa de un solo segmento — aquí son dos, pero el orden se
   respeta igual para que nadie tenga que verificarlo mentalmente.
   Restringida a quien administra: la firma es un dato biométrico de la
   persona y no tiene por qué verla el líder que la capturó ni nadie más. */
router.get('/:id/firma', requireRole('admin', 'coordinador'), async (req, res) => {
  try {
    /* ACOTADA POR RAMA, igual que GET /:id. Sin esto, un coordinador podía
       leer la firma —un dato biométrico— de CUALQUIER persona de la campaña,
       no solo de las que cuelgan de él. La ruta hermana sí filtraba: la
       incoherencia entre dos rutas del mismo recurso es la peor clase de
       agujero, porque parece cubierto. */
    let sql = `SELECT f.firma, f.creada_en, v.nombre
                 FROM votante_firmas f JOIN votantes v ON v.id = f.votante_id
                WHERE f.votante_id = ?`;
    const params = [req.params.id];
    if (req.alcance) {
      // Sin segundo argumento el helper usa el alias `v.`, que es justo el de
      // esta consulta. Pasarle 'v.' con punto daría `v..lider_id`.
      sql += ` AND ${condicionAlcanceVotantes(req.alcance)}`;
      params.push(...parametrosAlcanceVotantes(req.alcance));
    }
    const [[fila]] = await pool.query(sql, params);
    if (!fila) return res.status(404).json({ error: 'Esa persona no tiene firma registrada.' });
    res.json(fila);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo la firma.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const params = [req.params.id];
    let query = `SELECT * FROM votantes WHERE id = ?`;
    // Igual que el listado (GET /): fuera de admin/coordinador, cada quien
    // solo puede ver los votantes que él mismo refirió.
    if (req.alcance) { query += ` AND ${condicionAlcanceVotantes(req.alcance, '')}`; params.push(...parametrosAlcanceVotantes(req.alcance)); }
    const [rows] = await pool.query(query, params);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error consultando el registro.' });
  }
});

/**
 * Cuando un registro de Votantes queda marcado como "Sublíder":
 * 1. Le crea (o reutiliza, si ya existía por correo/cédula) una cuenta de
 *    acceso con rol "sublider": Nombre de usuario y contraseña iguales a
 *    su Número de identificación, obligada a cambiarla en el primer login.
 * 2. Lo deja registrado en Estructura territorial como subalterno (cargo
 *    "usuario") del Líder que lo refirió, con el mismo Territorio/
 *    Organización que tiene en su ficha de Votantes.
 * Solo requiere Número de identificación (sirve como Nombre de usuario y
 * contraseña inicial) — el Correo electrónico es opcional. Si falta la
 * cédula, no se crea nada, pero el votante se guarda igual.
 */
/**
 * CADA QUIEN REGISTRA UN ESCALÓN POR DEBAJO DEL SUYO.
 *
 *   Aspirante al Concejo  ->  Líder      (rol `lider`,    estructura `lider`)
 *   Líder                 ->  Sublíder   (rol `sublider`, estructura `usuario`)
 *   Sublíder              ->  nadie      (la pantalla no le ofrece el botón)
 *
 * El escalón NO lo manda el navegador: lo decide el servidor mirando si la
 * sesión entró con sublicencia (`req.sublicencia`). Si viajara en el cuerpo,
 * cualquier líder podría pedir «créame un líder» y darse un subalterno de un
 * nivel que no le corresponde.
 */
const NIVELES_SUBALTERNO = {
  sublider: { rol: 'sublider', cargo: 'usuario', etiqueta: 'sublíder' },
  lider:    { rol: 'lider',    cargo: 'lider',   etiqueta: 'líder' },
};

/**
 * ¿QUIÉN REGISTRA? La respuesta sale de la ESTRUCTURA, no de la licencia.
 *
 * El primer intento derivaba el escalón de `req.sublicencia`, o sea de si la
 * persona entró con el sombrero de aspirante. Son dos cosas distintas:
 *
 *   sublicencia  -> licencia: qué pantallas alcanza, qué ve del panel
 *   categoría    -> jerarquía: a quién manda y a quién registra
 *
 * La regla que se pidió —«un aspirante registra Líderes»— es de jerarquía. Y
 * alguien puede estar marcado como Aspirante al Concejo en la estructura sin
 * tener sublicencia vendida; con el criterio anterior, ese registraba
 * sublíderes bajo un botón que decía otra cosa.
 *
 * Se mira la sublicencia TAMBIÉN, con un OR: quien tiene una es un aspirante
 * aunque nadie se haya acordado de marcarlo en la estructura.
 */
/**
 * ¿Quien registra es Aspirante al Concejo?
 *
 * Estaba dentro de `nivelQueRegistra`, que solo lo usaba para decidir que
 * escalon crea. Hace falta en mas sitios —el aspirante es CABEZA DE RAMA y hay
 * guardas escritas para un lider raso que a el no le sirven— y la regla no se
 * puede copiar: son dos formas de serlo y mirar una sola deja fuera a la mitad
 * de la gente segun cuando se la registro.
 */
async function esAspiranteAlConcejo(req) {
  if (req.sublicencia) return true;
  const [[fila]] = await pool.query(
    /* DOS FORMAS DE SERLO, Y LAS DOS VALEN.
       El ROL es lo que se le asigna en Editar usuario y manda; la CATEGORIA
       (tipo_cargo) es como se marcaba antes de que el rol existiera, y sigue
       viva en las fichas ya creadas. Mirar solo una dejaria fuera a la mitad
       de la gente segun cuando se la registro. */
    `SELECT 1 AS ok FROM usuarios u
       LEFT JOIN roles r ON r.id = u.rol_id
       LEFT JOIN estructura e ON e.usuario_id = u.id AND e.cargo = 'lider'
      WHERE u.id = ?
        AND (r.nombre = 'aspirante_concejo'
             OR (e.id IS NOT NULL AND u.tipo_cargo = 'aspirante_concejo'))
      LIMIT 1`,
    [req.session.usuario.id]);
  return !!fila;
}

/* EL FALLO NO SE TRAGA AQUI, Y ESO CAMBIA QUIEN LO DECIDE.
   Antes esta consulta tenia su propio try/catch y devolvia `false`: con un
   hipo de MySQL el aspirante se degradaba a lider raso y volvia la coaccion
   —su eleccion de lider y sublider reescrita en silencio, que es justo el
   fallo que este parche vino a arreglar—. Un error transitorio no puede
   cambiar a nombre de quien queda una ficha.
   La excepcion sube, y cada uso decide qué hacer con ella:
     · `nivelQueRegistra` la atrapa y se queda en el escalon bajo, como antes:
       crear un sublider de mas es recuperable; crear un lider por error, menos.
     · `/mi-referido` la atrapa en su propio try y responde 500, que es lo
       correcto: sin saber quien es, no hay autocompletado que ofrecer.
   Quien ya no la llama es `resolverAtribucion`: decide con `req.sublicencia`,
   que no consulta nada y por tanto no puede fallar. Esa es la otra mitad del
   arreglo — la decision de a nombre de quien queda una ficha dejo de depender
   de que una consulta responda. */
async function nivelQueRegistra(req) {
  try {
    return (await esAspiranteAlConcejo(req)) ? 'lider' : 'sublider';
  } catch (err) {
    console.error('Leyendo la categoría de quien registra:', err.message);
    return 'sublider';
  }
}

async function procesarSublider({ nombre, cedula, email, telefono, liderId, territorioId, territorioIds, tipoAreaInfluencia, organizacion, metaVotos, nivel }) {
  const destino = NIVELES_SUBALTERNO[nivel] || NIVELES_SUBALTERNO.sublider;
  if (!cedula) {
    return { creado: false, estructuraCreada: false, etiqueta: destino.etiqueta, motivo: 'Falta el Número de identificación.' };
  }
  /* VARIOS TERRITORIOS. `territorioIds` es la lista (el primero es el principal);
     sin ella vale `territorioId` suelto, como hasta ahora. Se resuelve ANTES de
     crear la cuenta: una lista mal formada no debe dejar una cuenta sin su
     estructura. Una Organización no tiene territorios. */
  const esOrganizacionSublider = tipoAreaInfluencia === 'organizacion';
  const { lista: territoriosSublider, error: errorTerritoriosSublider } = territoriosPersona.listaDesdeCuerpo(
    esOrganizacionSublider ? {} : { territorio_ids: territorioIds, territorio_id: territorioId });
  if (errorTerritoriosSublider) {
    return { creado: false, estructuraCreada: false, etiqueta: destino.etiqueta, motivo: errorTerritoriosSublider };
  }
  const emailLimpio = (email || '').trim().toLowerCase() || null;

  let usuarioId = null;
  let cuentaCreada = false;

  try {
    // Por correo, o por cédula escrita como sea («1.053…» y «1053…» son la misma cuenta).
    let existente = null;
    if (emailLimpio) [[existente]] = await pool.query(`SELECT id FROM usuarios WHERE email = ? LIMIT 1`, [emailLimpio]);
    if (!existente) existente = await buscarUsuarioPorCedula(pool, normalizarCedula(cedula));

    if (existente) {
      usuarioId = existente.id;
    } else {
      const [[rolDestino]] = await pool.query(`SELECT id FROM roles WHERE nombre = ?`, [destino.rol]);
      if (!rolDestino) return { creado: false, estructuraCreada: false, etiqueta: destino.etiqueta, motivo: `El rol "${destino.rol}" no está configurado.` };

      const hash = await bcrypt.hash(cedula, 12);
      const [result] = await pool.query(
        `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, password_hash, rol_id, telefono, debe_cambiar_password)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [(nombre || '').trim(), cedula, cedula, emailLimpio, hash, rolDestino.id, telefono || null]
      );
      usuarioId = result.insertId;
      cuentaCreada = true;
    }
  } catch (err) {
    console.error('Error creando/verificando la cuenta de acceso del sublíder:', err);
    return { creado: false, estructuraCreada: false, etiqueta: destino.etiqueta, motivo: 'Error interno creando la cuenta de acceso.' };
  }

  // Se asegura el registro en Estructura territorial (cargo "usuario",
  // subordinado del Líder que lo refirió). Si ya existía, se le actualiza
  // la Meta de votos y a quién reporta, por si cambiaron en este guardado.
  let estructuraCreada = false;
  try {
    // Filtrado por cargo='usuario' (no solo usuario_id): desde que existe
    // "asignar como testigo" (ver /votantes/:id/asignar-testigo), la misma
    // persona puede tener una SEGUNDA fila de Estructura con
    // cargo='testigo' — sin este filtro, este SELECT podía encontrar esa
    // otra fila en vez de la del propio Sublíder y sobrescribirla.
    // El cargo que se busca es el del ESCALÓN que toca crear, no siempre
    // 'usuario': un Aspirante al Concejo crea líderes. Buscar por el cargo
    // equivocado encontraría otra fila de la misma persona y la pisaría.
    const [[yaExiste]] = await pool.query(`SELECT id FROM estructura WHERE usuario_id = ? AND cargo = ?`, [usuarioId, destino.cargo]);
    const esOrganizacion = esOrganizacionSublider;
    /* LA FILA Y SU LISTA DE TERRITORIOS, EN UNA SOLA TRANSACCIÓN: o se guardan las
       dos o ninguna. `estructura.territorio_id` ya no se nombra en estas
       sentencias; lo escribe `territoriosPersona.guardar`. */
    const conexionEstructura = await pool.getConnection();
    try {
      await conexionEstructura.beginTransaction();
      if (!yaExiste) {
        const [resultNueva] = await conexionEstructura.query(
          `INSERT INTO estructura (usuario_id, cargo, tipo_area_influencia, organizacion, supervisor_id, meta_votos, activo)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
          [usuarioId, destino.cargo,
           esOrganizacion ? 'organizacion' : 'territorio',
           esOrganizacion ? (organizacion || null) : null, liderId || null, metaVotos || 0]
        );
        await territoriosPersona.guardar(conexionEstructura, resultNueva.insertId, territoriosSublider);
      } else {
        await conexionEstructura.query(
          `UPDATE estructura SET tipo_area_influencia = ?, organizacion = ?, supervisor_id = ?, meta_votos = ?
           WHERE id = ?`,
          [esOrganizacion ? 'organizacion' : 'territorio',
           esOrganizacion ? (organizacion || null) : null, liderId || null, metaVotos || 0, yaExiste.id]
        );
        await territoriosPersona.guardar(conexionEstructura, yaExiste.id, territoriosSublider);
      }
      await conexionEstructura.commit();
    } catch (errEstructura) {
      await conexionEstructura.rollback();
      throw errEstructura;
    } finally {
      conexionEstructura.release();
    }
    if (!yaExiste) {
      estructuraCreada = true;
    } else {
      /* Aquí también cambia el `supervisor_id`: a un sublíder que ya existía
         se le puede estar poniendo otro líder. Ver la nota del PUT en
         routes/territorial.routes.js. */
      recalcularRamaEnSegundoPlano(pool, usuarioId, 'reasignar un sublíder desde Votantes');
    }
  } catch (err) {
    console.error('Error creando/actualizando el registro de Estructura territorial del sublíder:', err);
  }

  // `etiqueta` viaja al navegador para que el aviso diga «líder» o «sublíder»
  // segun lo que DE VERDAD se creo. Que lo adivine el navegador seria repetir
  // en dos sitios la regla de quien crea a quien.
  return { creado: cuentaCreada, estructuraCreada, yaExistiaCuenta: !cuentaCreada, etiqueta: destino.etiqueta };
}

/**
 * QUIÉN PUEDE DAR DE ALTA A UNA PERSONA.
 *
 * Esta ruta no tenía ninguna guarda de rol: bastaba con tener sesión. Un
 * `testigo` —cuyo trabajo es reportar el día de las elecciones— y un
 * `invitado` —descrito en middleware/auth.js como «solo lectura»— podían
 * insertar votantes, y el único requisito era que el nombre no viniera vacío.
 *
 * Se nombran los roles que SÍ pueden en vez de excluir a los dos que no: una
 * lista de exclusión deja entrar solo a los roles que se inventen después, que
 * es justo al revés de lo que conviene.
 *
 * Ojo: `permisos_rol` (Configuración → Asignación de permisos) puede AFINAR
 * esto por campaña, pero hoy solo lo consulta el frontend — el servidor no lo
 * aplica en ningún módulo. Esta guarda es el piso mínimo, no un sustituto de
 * aplicar esa tabla del lado del servidor.
 */
const ROLES_QUE_REGISTRAN = ['admin', 'coordinador', 'lider', 'sublider', 'usuario', 'asistente_administrativo'];

/**
 * El id del puesto en el CATÁLOGO, resuelto al guardar.
 *
 * El disparador ya deja `ctc_puesto_id` escrito cuando el puesto está
 * sembrado en la campaña (ver db/init-db.js). Esto cubre el caso que aquel no
 * puede: quien vota FUERA del ámbito de la campaña —alguien registrado en
 * Manizales que vota en Neiva— no tiene fila local de la que derivar el id, y
 * sin esto se quedaría sin enlace al catálogo para siempre.
 *
 * SE PREFIERE LO QUE MANDE EL FORMULARIO. public/js/lugar-votacion-catalogo.js
 * ya recibe el id desde /api/catalogo/puestos, pero hoy solo conserva el
 * nombre en el <option>. Se acepta `ctc_puesto_id` desde ya para que el día
 * que lo mande no haya que tocar nada más aquí.
 *
 * El municipio se busca DENTRO de su departamento: «Córdoba» es municipio de
 * Quindío, de Bolívar y de Nariño, y sin acotar se enlazaría al del otro lado
 * del país.
 */
async function resolverCtcPuestoId(b) {
  if (b.ctc_puesto_id) return Number(b.ctc_puesto_id) || null;
  const puesto = (b.puesto_votacion || '').trim();
  const municipio = (b.municipio_votacion || '').trim();
  const departamento = (b.departamento_votacion || '').trim();
  if (!puesto || !municipio || !departamento) return null;
  try {
    const [[fila]] = await pool.query(
      `SELECT cp.id
         FROM territoriosdb.ctc_puestos_votacion cp
         JOIN territoriosdb.ctc_territorios m ON m.id = cp.municipio_id
         JOIN territoriosdb.ctc_territorios d ON d.id = m.padre_id
        WHERE cp.nombre = ? AND m.nombre = ? AND d.nombre = ?
        LIMIT 1`,
      [puesto, municipio, departamento]
    );
    return fila ? fila.id : null;
  } catch (err) {
    // Sin permiso sobre el catálogo se sigue sin id: registrar un votante no
    // puede fallar por esto.
    console.warn('[lugar-votacion] no se pudo resolver el puesto en el catálogo:', err.code || err.message);
    return null;
  }
}

/**
 * QUIEN QUEDA COMO LIDER Y COMO SUBLIDER DE UNA FICHA, Y QUIEN PUEDE DECIDIRLO.
 *
 * Vive en un solo sitio porque estaba en uno solo: el POST. El PUT escribia
 * `b.lider_id` y `b.sublider_id` en crudo, sin nada, asi que la regla entera se
 * saltaba editando. Dos agujeros medidos: el aspirante creaba una ficha valida
 * y acto seguido la editaba poniendo un lider de la alcaldia; y un LIDER RASO
 * podia plantarle una ficha suya a otro lider, que es literalmente lo que la
 * coaccion existe para impedir. De paso movia `rama_aspirante_id`, o sea el
 * conteo de una campana a otra, sin dejar rastro.
 *
 * `anterior` es lo que distingue crear de editar, y no es un detalle:
 *
 *   · CREAR: para un lider o sublider los dos campos SE CALCULAN desde la
 *     estructura. Nadie registra a nombre de otro.
 *   · EDITAR: se CONSERVA lo que la ficha ya tiene. Calcularlos aqui seria
 *     destructivo — un lider corrigiendo el telefono de un votante de SU
 *     sublider le borraria el sublider a esa ficha, porque la regla de crear
 *     dice `sublider_id = null` para un lider. La ficha ya esta atribuida; esto
 *     solo impide reatribuirla.
 *
 * El ASPIRANTE es el caso aparte, y vale igual creando que editando: es cabeza
 * de rama y reasignar entre SU gente es su trabajo. Se le comprueba que los dos
 * ids esten dentro de su subarbol.
 *
 * Admin y coordinador no se tocan.
 *
 * Devuelve null si todo bien, o {status, error} para rechazar.
 */
async function resolverAtribucion(req, b, anterior) {
  /* SE DECIDE CON `req.sublicencia`, LA MISMA LLAVE QUE LLENA LOS DESPLEGABLES.
     Aqui habia `esAspiranteAlConcejo(req)`, que es un superconjunto: vale
     tambien por el rol o por `tipo_cargo`, sin sublicencia. Y todo el resto de
     la aplicacion —las listas que se le ofrecen, el alcance de cada pantalla,
     el middleware— acota por `req.sublicencia` a secas. Con dos llaves
     distintas, a quien cumpliera una y no la otra se le ofrecia gente que
     despues el 403 le rechazaba: la pantalla prometiendo lo que el servidor
     niega. Que la guarda y la lista se decidan igual no es elegancia, es lo
     unico que hace que el 403 sea imposible de encontrar usando la aplicacion.
     `nivelQueRegistra` si conserva el superconjunto: eso es jerarquia -que
     escalon crea- y su comentario justifica mirar las dos formas de serlo. */
  if (req.sublicencia) {
    const dentro = subarbolSql(req.session.usuario.id, 'u.id');
    for (const campo of ['lider_id', 'sublider_id']) {
      if (!b[campo]) continue;
      const [[fila]] = await pool.query(
        `SELECT 1 AS ok FROM usuarios u WHERE ${dentro.sql} AND u.id = ? LIMIT 1`,
        [...dentro.valores, b[campo]]);
      if (!fila) {
        return { status: 403, error: 'Solo puedes registrar bajo lideres y sublideres de tu propio equipo.' };
      }
    }
    return null;
  }

  if (!['lider', 'sublider'].includes(req.session.usuario.rol)) return null;

  if (anterior) {
    b.lider_id = anterior.lider_id;
    b.sublider_id = anterior.sublider_id;
    return null;
  }

  if (req.session.usuario.rol === 'lider') {
    b.lider_id = req.session.usuario.id;
    b.sublider_id = null;
    return null;
  }
  // Filtrado por cargo='usuario': si esta cuenta también es testigo
  // electoral (dos filas en Estructura para el mismo usuario_id), esto
  // evita quedarse con la fila equivocada y perder a qué Líder reporta.
  const [[estructuraPropia]] = await pool.query(
    `SELECT supervisor_id FROM estructura WHERE usuario_id = ? AND cargo = 'usuario'`, [req.session.usuario.id]);
  b.lider_id = estructuraPropia ? estructuraPropia.supervisor_id : null;
  b.sublider_id = req.session.usuario.id;
  return null;
}

router.post('/', requireRole(...ROLES_QUE_REGISTRAN), async (req, res) => {
  const b = req.body;

  // Reintento idempotente: la app de líderes guarda el formulario en el
  // celular cuando no hay señal y lo reintenta sola más tarde — si por un
  // corte justo al recibir la confirmación el mismo envío llega dos veces,
  // esto evita crear a la misma persona por duplicado. Sin cliente_uuid
  // (ej. panel de escritorio) sigue de largo como siempre.
  if (b.cliente_uuid) {
    try {
      const [[yaExiste]] = await pool.query(`SELECT id FROM votantes WHERE cliente_uuid = ?`, [b.cliente_uuid]);
      if (yaExiste) {
        return res.json({ ok: true, id: yaExiste.id, yaExistia: true });
      }
    } catch (err) {
      console.error('Error verificando cliente_uuid (se sigue con el registro normal):', err);
    }
  }

  if (!b.nombre) {
    return res.status(400).json({ error: 'Nombres y apellidos son obligatorios.' });
  }
  if (!['votante', 'sublider'].includes(b.categoria)) {
    return res.status(400).json({ error: 'Debe elegir si es Votante o Sublíder.' });
  }
  const revision = revisarCedula(b);
  if (revision.bloqueo) return res.status(400).json({ error: revision.bloqueo });
  normalizarCedulaDelCuerpo(b);
  /* UNA CÉDULA, UNA FICHA, escrita como se escriba. El índice UNIQUE solo ve el texto idéntico y una ficha vieja
     puede estar guardada como «1.053.123.456»: se busca también entre las variantes. Mismo mensaje de siempre. */
  try {
    if (b.cedula && await buscarFichaPorCedula(pool, b.cedula)) {
      return res.status(400).json({ error: 'Ya registrado por otro líder.' });
    }
  } catch (err) {
    console.error('votantes (alta, revisando la cédula):', err.code || err.message);
    return res.status(400).json({ error: 'Error registrando el votante.' });
  }
  const esOrganizacion = b.categoria === 'sublider' && b.tipo_area_influencia === 'organizacion';
  if (esOrganizacion && !(b.organizacion || '').trim()) {
    return res.status(400).json({ error: 'Escribe el nombre de la organización.' });
  }
  if (!validarTelefono10Digitos(b.telefono)) {
    return res.status(400).json({ error: 'Error de digitación: el teléfono debe tener 10 dígitos.' });
  }
  b.telefono = b.telefono ? b.telefono.replace(/\D/g, '') : null;
  if (!validarTelefono10Digitos(b.telefono)) {
    return res.status(400).json({ error: 'Error de digitación: el teléfono debe tener 10 dígitos.' });
  }
  b.telefono = b.telefono ? b.telefono.replace(/\D/g, '') : null;

  /* Consentimiento (Circular SIC 002 de 2026 / Ley 1581 de 2012): se exige a
     TODO EL QUE CREE POR AQUI, sea cual sea su cargo.
     Antes se pedia solo a Lider y Sublider, razonando que un admin corrigiendo
     o importando datos no presencio la captura. Pero esta ruta no corrige
     -corregir es el PUT, que no lo exige- ni importa -importar es
     /importar-excel, que tampoco pasa por aqui-: esto es dar de alta a una
     persona nueva, y ahi el cargo de quien teclea no cambia que a esa persona
     hubo que informarle.
     No rompe a nadie: los tres clientes que crean por esta ruta ya lo mandan
     -el formulario de Votantes, la app movil de captura y el alta rapida de
     Asistentes a reuniones-, verificado antes de apretar la regla.
     Y va en el servidor y no solo en la pantalla porque lo que compruebe el
     navegador no autoriza nada. */
  /* PARCHE 325 — LA ÚNICA EXCEPCIÓN: `autorizacion_pendiente_enlace === true`. La manda SOLO el botón «Enviar autorización por WhatsApp»
     (computador y celular): la persona se registra SIN autorización y queda con `consentimiento_autorizado = 0` y los tres canales en 0, o sea
     que NO se le puede escribir hasta que firme el enlace que se le manda (/a/<token>). Sin esa bandera la regla de arriba sigue igual. */
  const pendientePorEnlace = b.autorizacion_pendiente_enlace === true && !b.consentimiento_autorizado;
  if (!b.consentimiento_autorizado && !pendientePorEnlace) {
    return res.status(400).json({ error: 'Debes confirmar que la persona autorizó el uso de sus datos antes de guardar el registro.' });
  }

  // Igual que en /mi-referido: si quien registra es Líder o Sublíder, el
  // servidor IGNORA lo que haya mandado el cliente en lider_id/sublider_id
  // y calcula esos dos valores siempre desde la Estructura guardada —
  // esto protege tanto al panel de escritorio como a la app móvil de
  // captura, para que nadie pueda registrar un votante "a nombre" de otro
  // líder/sublíder distinto al de su propia sesión.
  const rechazo = await resolverAtribucion(req, b, null);
  if (rechazo) return res.status(rechazo.status).json({ error: rechazo.error });

  /* LA COMUNA SOLO SE GUARDA SI ES UNA DE LA CAMPAÑA (orden 36). «MANIZALES» o «Caldas» —la ciudad o el
     departamento— no son una comuna: con la campaña teniendo lista, se guarda vacío y se avisa. Sin lista
     (campaña sin comunas) el texto sigue libre. La ficha se guarda igual. */
  const comunaRevisada = await comunaValida(pool, b.comuna_corregimiento_residencia);
  b.comuna_corregimiento_residencia = comunaRevisada.valor;

  let votanteId;
  try {
    const [result] = await pool.query(
      `INSERT INTO votantes
       (categoria, nombre, cedula, telefono, email, genero, edad, fecha_nacimiento, territorio_id,
        tipo_area_influencia, organizacion,
        direccion, departamento_residencia, ciudad_residencia,
        comuna_corregimiento_residencia, barrio_residencia, area, lider_id, sublider_id, apoya_a,
        departamento_votacion, municipio_votacion,
        puesto_votacion, ctc_puesto_id, mesa_votacion, observaciones,
        consentimiento_autorizado, consentimiento_fecha, consentimiento_metodo,
        consentimiento_email, consentimiento_sms, consentimiento_whatsapp, consentimiento_version,
        consentimiento_version_ok,
        cliente_uuid, created_by, rama_aspirante_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.categoria, b.nombre, b.cedula || null, b.telefono || null, b.email || null,
       b.genero || 'prefiero_no_responder', b.edad || null, b.fecha_nacimiento || null, esOrganizacion ? null : (b.territorio_id || null),
       esOrganizacion ? 'organizacion' : 'territorio', esOrganizacion ? b.organizacion.trim() : null,
       b.direccion || null, b.departamento_residencia || null, b.ciudad_residencia || null,
       b.comuna_corregimiento_residencia || null, b.barrio_residencia || null,
       esOrganizacion ? null : (b.area || null), b.lider_id || req.session.usuario.id, b.sublider_id || null,
       JSON.stringify(Array.isArray(b.apoya_a) ? b.apoya_a : []),
       b.departamento_votacion || null, b.municipio_votacion || null,
       b.puesto_votacion || null, await resolverCtcPuestoId(b), b.mesa_votacion || null, b.observaciones || null,
       b.consentimiento_autorizado ? 1 : 0,
       b.consentimiento_autorizado ? new Date() : null,
       b.consentimiento_autorizado ? (b.consentimiento_metodo || 'verbal_formulario_campo') : null,
       // Cada canal se guarda como 1 o 0 EXPLÍCITO, nunca NULL: aquí sí se
       // preguntó. El NULL queda reservado para los registros anteriores a
       // que existiera la pregunta —"no consta"— y es lo que permite que
       // sigan recibiendo mensajes como siempre.
       b.consentimiento_autorizado ? (b.consentimiento_email ? 1 : 0) : 0,
       b.consentimiento_autorizado ? (b.consentimiento_sms ? 1 : 0) : 0,
       b.consentimiento_autorizado ? (b.consentimiento_whatsapp ? 1 : 0) : 0,
       /* LA HUELLA SE GUARDA TAL COMO LLEGA, Y APARTE SI EL SERVIDOR LA
          RECONOCE. No se recalcula contra la política vigente, y es
          deliberado: la cola sin señal puede reenviar días después un
          registro capturado cuando la política era otra. Sobrescribir esa
          huella con la de hoy diría que la persona vio un texto que no vio
          — sería fabricar la evidencia, no guardarla.
          Lo que sí hace el servidor es COMPROBARLA contra el archivo. Antes
          se guardaba a ciegas: cualquier cliente autenticado podía mandar
          una huella inventada y quedaba archivada como si fuera la prueba.
          Un 0 aquí no acusa a nadie —una campaña que estrena esto tendrá
          muchos— pero distingue lo que se puede exhibir de lo que no. */
       (b.consentimiento_version || '').slice(0, 64) || null,
       (await versionConocida(b.consentimiento_version)) ? 1 : 0,
       b.cliente_uuid || null,
       req.session.usuario.id,
       /* DE QUE RAMA CUELGA, CALCULADO AL GUARDAR.
          `lib/alcanceVotantes.js` ya daba por hecho que esta columna estaba
          puesta —«su gente es la de su rama, calculada al guardar»— pero nadie
          la escribia: `ramaDeVotante` solo se llamaba desde
          `recalcularTodas()`, que corre con la sincronizacion de sublicencias.
          O sea que un votante nuevo pasaba horas con `rama_aspirante_id` en
          NULL, y NULL no es neutro: sale en la campaña madre pase lo que pase
          (asi lo pide `filtroMadre`) y no sale en la del aspirante.

          Medido el 27 de agosto de 2026 en la campaña municipal: Boston Dos,
          que apoya a concejo, asamblea y gobernacion pero NO a la alcaldia,
          aparecia igual en la madre; y ni el ni Boston Tres aparecian en la
          sublicencia. Boston Uno, registrado dos horas y media antes, si
          estaba bien — la unica diferencia era que a el ya lo habia alcanzado
          una sincronizacion. Un fallo que se cura solo al rato es peor que uno
          permanente: parece cosa de la pantalla.

          Se calcula ANTES del INSERT y con los mismos datos que se van a
          guardar, no despues con una segunda escritura: asi la fila nace
          completa y no existe el instante en que esta a medias. */
       await ramaDeVotante(pool, {
         cedula: b.cedula || null,
         lider_id: b.lider_id || req.session.usuario.id,
         sublider_id: b.sublider_id || null
       })]
    );
    votanteId = result.insertId;
  } catch (err) {
    // Si dos reintentos del mismo registro guardado offline chocan justo
    // al mismo tiempo (carrera poco probable, pero posible), el que llegó
    // de últimas no debe fallar como si fuera un error real — se detecta
    // por cliente_uuid y se responde igual que una repetición idempotente.
    if (err.code === 'ER_DUP_ENTRY' && b.cliente_uuid) {
      const [[existente]] = await pool.query(`SELECT id FROM votantes WHERE cliente_uuid = ?`, [b.cliente_uuid]).catch(() => [[null]]);
      if (existente) return res.json({ ok: true, id: existente.id, yaExistia: true });
    }
    console.error(err);
    const msg = err.code === 'ER_DUP_ENTRY' ? 'Ya registrado por otro líder.' : 'Error registrando el votante.';
    return res.status(400).json({ error: msg });
  }

  /* LA FIRMA, EN SU PROPIA TABLA Y DESPUÉS DEL INSERT.
     No puede ir dentro del INSERT porque necesita el id que ese INSERT
     genera. Y va con `await` pero sin poder tumbar nada: `guardarFirma` no
     lanza. Si la firma llega ilegible o la tabla falla, la persona queda
     registrada igual y el motivo se anota en el log — perder el registro de
     alguien por un fallo al guardar su firma sería cambiar un problema por
     otro peor.
     Solo se guarda si además autorizó: una firma sin autorización marcada no
     es evidencia de nada, y guardarla sería quedarse con el trazo de alguien
     sin razón para tenerlo. */
  if (b.consentimiento_autorizado && b.consentimiento_firma) {
    await guardarFirma(pool, votanteId, b.consentimiento_firma);
  }

  /* EL SMS DE BIENVENIDA, si la campaña lo tiene encendido (apagado de
     fábrica; se enciende en Configurar mensajería). Ver la nota gemela en
     routes/territorial.routes.js: va después de que el votante esté guardado
     y no puede hacer fallar el registro. */
  encolarBienvenida({ tipo: 'votante', id: votanteId, nombre: b.nombre, telefono: b.telefono })
    .catch(err => console.error('Bienvenida automática (votante):', err.message));

  /* Y la doble confirmación por correo, si la campaña la tiene encendida.
     Mismo trato que la bienvenida: sin `await` para no hacer esperar a quien
     está registrando de pie en la calle, y con `.catch()` aunque el módulo no
     lance — una promesa rechazada sin manejar tumba el proceso de Node. */
  pedirConfirmacionSiProcede(req, votanteId, {
    email: b.email,
    consentimiento_autorizado: b.consentimiento_autorizado,
    consentimiento_email: b.consentimiento_autorizado ? (b.consentimiento_email ? 1 : 0) : 0
  }).catch(err => console.error('Confirmación automática (votante):', err.message));

  // La geocodificación se hace después de confirmar el registro, y nunca
  // hace fallar la creación del contacto aunque el servicio no responda
  // (si el área de influencia es una Organización, no hay territorio que geocodificar).
  const geo = esOrganizacion
    ? { geocodificado: false }
    : await geocodificarYGuardarVotante(votanteId, b.direccion, b.territorio_id, b.departamento_residencia, b.ciudad_residencia);

  // Si quedó marcado como Sublíder: se le crea (o reutiliza) su cuenta de
  // acceso y su registro en Estructura territorial como subalterno del
  // Líder que lo refirió. Una vez procesado, queda guardado en Votantes y
  // sublíderes simplemente como "Votante" — su rol organizacional ya vive
  // en Estructura territorial, no hace falta duplicarlo aquí.
  let usuarioSublider = null;
  if (b.categoria === 'sublider') {
    usuarioSublider = await procesarSublider({
      nombre: b.nombre, cedula: b.cedula, email: b.email, telefono: b.telefono,
      liderId: b.lider_id || null,
      territorioId: esOrganizacion ? null : (b.territorio_id || null),
      territorioIds: esOrganizacion ? [] : b.territorio_ids,
      tipoAreaInfluencia: esOrganizacion ? 'organizacion' : 'territorio',
      organizacion: esOrganizacion ? b.organizacion.trim() : null,
      metaVotos: b.meta_votos_sublider || 0,
      // El escalon lo decide el SERVIDOR mirando quien registra, no el
      // cuerpo de la peticion. Ver nivelQueRegistra().
      nivel: await nivelQueRegistra(req)
    });
    if (usuarioSublider.creado || usuarioSublider.yaExistiaCuenta) {
      await pool.query(`UPDATE votantes SET categoria = 'votante' WHERE id = ?`, [votanteId]);
    }
  }

  // "Y viceversa": si esta persona (por cédula) también está en Estructura
  // territorial, le lleva los mismos datos personales/de contacto para allá.
  await sincronizarEstructuraDesdeVotante(pool, {
    cedula: b.cedula, nombre: b.nombre, telefono: b.telefono, email: b.email,
    genero: b.genero, edad: b.edad, apoya_a: b.apoya_a,
    departamento_votacion: b.departamento_votacion, municipio_votacion: b.municipio_votacion,
    puesto_votacion: b.puesto_votacion, mesa_votacion: b.mesa_votacion,
    departamento_residencia: b.departamento_residencia, ciudad_residencia: b.ciudad_residencia,
    direccion: b.direccion
  });

  res.json({ ok: true, id: votanteId, geocodificado: geo.geocodificado, usuario_sublider: usuarioSublider, avisos: revision.avisos, comuna_descartada: comunaRevisada.descartada });
});

/**
 * «Necesita transporte el día de la elección», desde la ficha del votante. Va aparte del PUT de la ficha: es una marca
 * operativa que se enciende o se apaga sola, sin pedir la contraseña ni reenviar la ficha entera. Con el MISMO alcance
 * que el resto de la ficha: quien no ve al votante, no lo marca (404).
 */
/**
 * COMPLETAR LOS DATOS BÁSICOS de una persona: teléfono, puesto y mesa, y NADA más (orden del panel del líder). Es lo que el
 * líder hace desde el celular con las fichas que le faltan; la edición completa (`PUT /:id`) pide el cuerpo entero y su
 * contraseña, y eso no cabe en «Completar».
 *
 *   · Con alcance: una ficha fuera del de quien pregunta responde 403 (y no 404: no se dice si existe).
 *   · Teléfono: 10 dígitos, como en el resto de la aplicación.
 *   · Puesto: tiene que ser uno de la lista de la campaña (`dia_d_puestos_votacion`, sembrada del catálogo oficial); se guarda su
 *     nombre completo y su id del catálogo. Mesa: de 1 hasta la cantidad de mesas de ese puesto.
 *   · No pide contraseña (completar no borra nada ni cambia a quién pertenece la ficha), pero queda en auditoría y tiene tope por
 *     usuario.
 */
const limiteDatosBasicos = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  // Por USUARIO y no por IP: varios líderes comparten la wifi de un evento.
  keyGenerator: (req) => 'datos-basicos:' + ((req.session && req.session.usuario && req.session.usuario.id) || 'sin-sesion'),
  handler: (req, res) => res.status(429).json({ error: 'Demasiados cambios seguidos. Espera unos minutos.' }),
});

router.patch('/:id/datos-basicos', requireRole(...ROLES_QUE_REGISTRAN, 'aspirante'), limiteDatosBasicos, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Persona inválida.' });
  const b = req.body || {};
  const cambios = ['telefono', 'puesto_id', 'mesa'].filter((k) => b[k] !== undefined);
  if (!cambios.length) return res.status(400).json({ error: 'No hay nada que completar: manda teléfono, puesto o mesa.' });
  const extra = Object.keys(b).filter((k) => !['telefono', 'puesto_id', 'mesa'].includes(k));
  if (extra.length) return res.status(400).json({ error: 'Solo se puede completar el teléfono, el puesto y la mesa.' });

  try {
    const alc = req.alcance ? condicionAlcanceVotantes(req.alcance, 'v') : '1 = 1';
    const par = req.alcance ? parametrosAlcanceVotantes(req.alcance) : [];
    const [[ficha]] = await pool.query(
      `SELECT v.id, v.nombre, v.puesto_id, v.puesto_votacion FROM votantes v WHERE v.id = ? AND ${alc}`, [id, ...par]);
    if (!ficha) return res.status(403).json({ error: 'Esa persona no está entre tus votantes.' });

    const sets = []; const valores = []; const tocados = [];
    if (b.telefono !== undefined) {
      const digitos = String(b.telefono == null ? '' : b.telefono).replace(/\D/g, '');
      if (digitos.length !== 10) return res.status(400).json({ error: 'El teléfono debe tener 10 dígitos.' });
      sets.push('telefono = ?'); valores.push(digitos); tocados.push('teléfono');
    }

    let puestoDestino = null;           // la fila de la campaña de ese puesto, si lo hay
    if (b.puesto_id !== undefined) {
      const puestoId = Number(b.puesto_id);
      if (!Number.isInteger(puestoId) || puestoId < 1) return res.status(400).json({ error: 'Elige un puesto de la lista.' });
      const [[p]] = await pool.query(
        'SELECT id, nombre, cantidad_mesas, ctc_puesto_id FROM dia_d_puestos_votacion WHERE id = ? AND aspirante_id = ?',
        [puestoId, await duenoDeLaCampana(pool, req)]);
      if (!p) return res.status(400).json({ error: 'Ese puesto no está en la lista de puestos de la campaña.' });
      puestoDestino = p;
      sets.push('puesto_votacion = ?', 'ctc_puesto_id = ?');
      valores.push(p.nombre, p.ctc_puesto_id || null);
      tocados.push('puesto');
      // Cambiar de puesto sin elegir mesa deja la mesa anterior, que ya no corresponde.
      if (b.mesa === undefined && Number(ficha.puesto_id) !== p.id) { sets.push('mesa_votacion = NULL'); }
    }

    if (b.mesa !== undefined) {
      const mesa = Number(b.mesa);
      if (!Number.isInteger(mesa) || mesa < 1) return res.status(400).json({ error: 'La mesa debe ser un número desde 1.' });
      let destino = puestoDestino;
      if (!destino && ficha.puesto_id) {
        [[destino]] = await pool.query('SELECT id, nombre, cantidad_mesas FROM dia_d_puestos_votacion WHERE id = ?', [ficha.puesto_id]);
      }
      if (!destino) return res.status(400).json({ error: 'Para poner la mesa, elige primero el puesto.' });
      if (destino.cantidad_mesas && mesa > destino.cantidad_mesas) {
        return res.status(400).json({ error: `Ese puesto tiene ${destino.cantidad_mesas} mesas.` });
      }
      sets.push('mesa_votacion = ?'); valores.push(mesa); tocados.push('mesa');
    }

    await pool.query(`UPDATE votantes SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
    await registrarAuditoria(
      req.session.usuario.id, 'completar_datos_basicos', 'votantes', id,
      `Completó ${tocados.join(', ')} de ${ficha.nombre} (id ${id}).`, req.ip);
    const [[nueva]] = await pool.query('SELECT id, puesto_id, puesto_votacion, mesa_votacion FROM votantes WHERE id = ?', [id]);
    res.json({ ok: true, id, completado: tocados, puesto: nueva.puesto_votacion || '', mesa: nueva.mesa_votacion || null });
  } catch (err) {
    console.error('votantes/datos-basicos:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo guardar. Intenta de nuevo.' });
  }
});

// Activar complementos (parche 318): «necesita transporte» es de Transporte; apagado, esta ruta responde 403 (la columna no se toca).
router.put('/:id/transporte', requiereComplemento('transporte_dia_d'), async (req, res) => {
  const necesita = req.body && (req.body.necesita === true || req.body.necesita === 1) ? 1 : null;
  try {
    const params = [req.params.id];
    let sql = `SELECT id FROM votantes WHERE id = ?`;
    if (req.alcance) { sql += ` AND ${condicionAlcanceVotantes(req.alcance, '')}`; params.push(...parametrosAlcanceVotantes(req.alcance)); }
    const [[v]] = await pool.query(sql, params);
    if (!v) return res.status(404).json({ error: 'No encontrado.' });
    await pool.query(`UPDATE votantes SET necesita_transporte = ? WHERE id = ?`, [necesita, v.id]);
    res.json({ ok: true, necesita_transporte: necesita === 1 });
  } catch (err) {
    console.error('votantes/transporte:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo guardar.' });
  }
});

router.put('/:id', async (req, res) => {
  /* SE CONFIRMA CON LA CONTRASEÑA DE QUIEN LO ESTA HACIENDO.
     No es la del administrador: un lider tiene derecho a corregir a su gente,
     y pedirle la clave ajena le quitaria esa capacidad. Pedirle la suya solo
     le pide confirmar — y cierra el caso de una sesion abierta y sin dueño en
     un celular prestado, que es el riesgo real en campaña.
     Va ANTES de cualquier validacion o escritura: comprobar despues de haber
     tocado la fila no confirma nada. */
  if (!(await verificarPasswordPropia(req.session.usuario.id, req.body && req.body.password))) {
    return res.status(403).json({ error: 'Contraseña incorrecta. Escribe la suya para confirmar.' });
  }
  const b = req.body;
  if (!b.nombre) {
    return res.status(400).json({ error: 'Nombres y apellidos son obligatorios.' });
  }
  if (!['votante', 'sublider'].includes(b.categoria)) {
    return res.status(400).json({ error: 'Debe elegir si es Votante o Sublíder.' });
  }
  const revision = revisarCedula(b);
  if (revision.bloqueo) return res.status(400).json({ error: revision.bloqueo });
  normalizarCedulaDelCuerpo(b);
  const esOrganizacion = b.categoria === 'sublider' && b.tipo_area_influencia === 'organizacion';
  if (esOrganizacion && !(b.organizacion || '').trim()) {
    return res.status(400).json({ error: 'Escribe el nombre de la organización.' });
  }
  if (!validarTelefono10Digitos(b.telefono)) {
    return res.status(400).json({ error: 'Error de digitación: el teléfono debe tener 10 dígitos.' });
  }
  b.telefono = b.telefono ? b.telefono.replace(/\D/g, '') : null;
  try {
    // Igual que el listado y el GET de un solo registro: fuera de
    // admin/coordinador, solo se puede editar un votante que uno mismo refirió.
    if (req.alcance) {
      const [[propio]] = await pool.query(
        `SELECT id FROM votantes WHERE id = ? AND ${condicionAlcanceVotantes(req.alcance, '')}`,
        [req.params.id, ...parametrosAlcanceVotantes(req.alcance)]
      );
      if (!propio) return res.status(404).json({ error: 'No encontrado.' });
    }

    const [[anterior]] = await pool.query(
      `SELECT direccion, territorio_id, lider_id, sublider_id FROM votantes WHERE id = ?`, [req.params.id]
    );

    /* LA MISMA REGLA QUE AL CREAR. Sin esto el PUT escribia lider_id y
       sublider_id en crudo y toda la guarda del POST se saltaba editando. */
    const rechazo = await resolverAtribucion(req, b, anterior || {});
    if (rechazo) return res.status(rechazo.status).json({ error: rechazo.error });

    /* Cambiarle la cédula a una que ya tiene OTRA ficha (escrita como sea) se rechaza, con el mismo mensaje que daba el
       índice UNIQUE. La propia ficha no cuenta: puede traer su cédula vieja («1.053…») y se guarda ya normalizada. */
    if (b.cedula && await buscarFichaPorCedula(pool, b.cedula, req.params.id)) {
      return res.status(400).json({ error: 'Ya registrado por otro líder.' });
    }

    // La misma regla que al crear (orden 36): una comuna que no es de la campaña se guarda vacía.
    const comunaRevisada = await comunaValida(pool, b.comuna_corregimiento_residencia);
    b.comuna_corregimiento_residencia = comunaRevisada.valor;

    await pool.query(
      `UPDATE votantes SET categoria=?, nombre=?, cedula=?, telefono=?, email=?, genero=?, edad=?,
       fecha_nacimiento=?, territorio_id=?, tipo_area_influencia=?, organizacion=?, direccion=?,
       departamento_residencia=?, ciudad_residencia=?,
       comuna_corregimiento_residencia=?, barrio_residencia=?,
       area=?, lider_id=?, sublider_id=?, apoya_a=?,
       departamento_votacion=?, municipio_votacion=?, puesto_votacion=?, ctc_puesto_id=?, mesa_votacion=?, observaciones=?,
       rama_aspirante_id=? WHERE id = ?`,
      [b.categoria, b.nombre, b.cedula || null, b.telefono || null, b.email || null,
       b.genero || 'prefiero_no_responder', b.edad || null, b.fecha_nacimiento || null, esOrganizacion ? null : (b.territorio_id || null),
       esOrganizacion ? 'organizacion' : 'territorio', esOrganizacion ? b.organizacion.trim() : null,
       b.direccion || null, b.departamento_residencia || null, b.ciudad_residencia || null,
       b.comuna_corregimiento_residencia || null, b.barrio_residencia || null,
       esOrganizacion ? null : (b.area || null), b.lider_id || null, b.sublider_id || null,
       JSON.stringify(Array.isArray(b.apoya_a) ? b.apoya_a : []),
       b.departamento_votacion || null, b.municipio_votacion || null,
       b.puesto_votacion || null, await resolverCtcPuestoId(b), b.mesa_votacion || null, b.observaciones || null,
       /* SE RECALCULA, no se conserva: cambiarle el lider a un votante lo
          cambia de rama, y dejar la anterior lo dejaria contando para un
          aspirante que ya no lo tiene. */
       await ramaDeVotante(pool, {
         cedula: b.cedula || null,
         lider_id: b.lider_id || null,
         sublider_id: b.sublider_id || null
       }),
       req.params.id]
    );

    // Solo se vuelve a geocodificar si la dirección o el territorio cambiaron
    // (y si el área de influencia sigue siendo geográfica).
    const cambioUbicacion = !esOrganizacion && anterior && (
      (b.direccion || '') !== (anterior.direccion || '') ||
      Number(b.territorio_id || 0) !== Number(anterior.territorio_id || 0)
    );
    if (cambioUbicacion) {
      await geocodificarYGuardarVotante(req.params.id, b.direccion, b.territorio_id, b.departamento_residencia, b.ciudad_residencia);
    }

    // Si quedó marcado como Sublíder: se asegura su cuenta de acceso y su
    // registro en Estructura territorial (si ya existían, no se duplican).
    // Una vez procesado, queda guardado como "Votante" — su rol
    // organizacional ya vive en Estructura territorial.
    let usuarioSublider = null;
    if (b.categoria === 'sublider') {
      usuarioSublider = await procesarSublider({
        nombre: b.nombre, cedula: b.cedula, email: b.email, telefono: b.telefono,
        liderId: b.lider_id || null,
        territorioId: esOrganizacion ? null : (b.territorio_id || null),
        territorioIds: esOrganizacion ? [] : b.territorio_ids,
        tipoAreaInfluencia: esOrganizacion ? 'organizacion' : 'territorio',
        organizacion: esOrganizacion ? b.organizacion.trim() : null,
        metaVotos: b.meta_votos_sublider || 0,
        // Mismo criterio que al crear. Ver nivelQueRegistra().
        nivel: await nivelQueRegistra(req)
      });
      if (usuarioSublider.creado || usuarioSublider.yaExistiaCuenta) {
        await pool.query(`UPDATE votantes SET categoria = 'votante' WHERE id = ?`, [req.params.id]);
      }
    }

    // "Y viceversa": si esta persona (por cédula) también está en
    // Estructura territorial, le lleva los mismos datos personales/de
    // contacto para allá.
    await sincronizarEstructuraDesdeVotante(pool, {
      cedula: b.cedula, nombre: b.nombre, telefono: b.telefono, email: b.email,
      genero: b.genero, edad: b.edad, apoya_a: b.apoya_a,
      departamento_votacion: b.departamento_votacion, municipio_votacion: b.municipio_votacion,
      puesto_votacion: b.puesto_votacion, mesa_votacion: b.mesa_votacion,
      departamento_residencia: b.departamento_residencia, ciudad_residencia: b.ciudad_residencia,
      direccion: b.direccion
    });

    res.json({ ok: true, usuario_sublider: usuarioSublider, avisos: revision.avisos, comuna_descartada: comunaRevisada.descartada });
  } catch (err) {
    console.error(err);
    const msg = err.code === 'ER_DUP_ENTRY' ? 'Ya registrado por otro líder.' : 'Error actualizando el registro.';
    res.status(400).json({ error: msg });
  }
});

/**
 * Asigna, ADEMÁS de su categoría actual (Votante o Sublíder), la
 * capacidad de testigo electoral a una persona ya registrada acá — sin
 * tocar su fila existente. Si todavía no tiene cuenta de acceso (un
 * Votante puro nunca la tiene), se le crea una con rol "testigo"; si ya
 * tiene una (ej. ya es Sublíder), se reutiliza sin tocar su rol
 * principal. Ver tieneDobleRolTestigo en auth.routes.js: al iniciar
 * sesión se le preguntará con cuál de las dos capacidades quiere entrar.
 */
router.post('/:id/asignar-testigo', async (req, res) => {
  // Departamento/Municipio ya no se reciben: se deducen del puesto contra
  // el catálogo territorial. El formulario solo dice DÓNDE VIGILA.
  const { puesto_votacion, mesa_votacion, tipo_testigo, mesas_asignadas } = req.body;
  try {
    const params = [req.params.id];
    let query = `SELECT * FROM votantes WHERE id = ?`;
    if (req.alcance) { query += ` AND ${condicionAlcanceVotantes(req.alcance, '')}`; params.push(...parametrosAlcanceVotantes(req.alcance)); }
    const [[votante]] = await pool.query(query, params);
    if (!votante) return res.status(404).json({ error: 'No encontrado.' });
    if (!votante.cedula) {
      return res.status(400).json({ error: 'Falta el Número de identificación de esta persona para poder asignarla como testigo electoral.' });
    }

    const resolucion = await resolverOCrearUsuarioParaTestigo(pool, {
      nombre: votante.nombre, cedula: votante.cedula,
      email: votante.email, telefono: votante.telefono
    });
    if (!resolucion.usuarioId) {
      return res.status(400).json({ error: resolucion.motivo || 'No se pudo crear la cuenta de acceso.' });
    }

    // actualizarSiExiste: este endpoint también sirve para CAMBIARLE el
    // puesto/mesa a quien ya es testigo, no solo para asignárselo la
    // primera vez.
    const resultado = await asegurarEstructuraTestigo(pool, resolucion.usuarioId, {
      puesto_votacion, mesa_votacion
    }, tipo_testigo, Array.isArray(mesas_asignadas) ? mesas_asignadas : [], { actualizarSiExiste: true });
    if (resultado.conflicto) {
      return res.status(400).json({ error: `La(s) mesa(s) ${resultado.conflicto.join(', ')} ya están asignadas a otro testigo de ese puesto.` });
    }
    if (!resultado.creado && !resultado.actualizado) {
      return res.status(400).json({ error: 'No se pudo guardar la asignación como testigo electoral.' });
    }

    await registrarAuditoria(
      req.session.usuario.id, 'asignar_testigo', 'votantes', req.params.id,
      `Se le asignó la capacidad de testigo electoral a ${votante.nombre}.`, req.ip
    );
    res.json({ ok: true, cuenta_creada: resolucion.creado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error asignando la capacidad de testigo electoral.' });
  }
});

/**
 * "Datos verificados": solo Administrador y Asistente administrativo pueden
 * marcar/desmarcar esta casilla en el listado de Votantes y sublíderes — se
 * valida el rol aquí en el servidor (no solo deshabilitando la casilla en
 * el frontend), para que nadie pueda marcarla llamando a la API a mano.
 */
router.put('/:id/verificar', requireRole('admin', 'asistente_administrativo'), async (req, res) => {
  const verificado = req.body.datos_verificados ? 1 : 0;
  // Desmarcar (quitar una verificación ya hecha) exige contraseña de
  // administrador — marcarla no, ahí basta con la confirmación del
  // frontend. Se valida aquí también (no solo en el frontend) para que
  // nadie la desmarque llamando a la API a mano.
  if (!verificado) {
    const autorizado = await verificarPasswordAdmin(req.body.password);
    if (!autorizado) {
      return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
    }
  }
  try {
    /* DENTRO DE SU ALCANCE (parche 330). El asistente administrativo ve en Votantes solo lo que él registró; verificar una ficha ajena tecleando el id
       saltaba eso. El administrador ve toda la campaña (su alcance es el de la madre). Lo que está fuera responde 404, como una ficha que no existe. */
    const acota = req.alcance ? ` AND ${condicionAlcanceVotantes(req.alcance, '')}` : '';
    const [resultado] = await pool.query(
      `UPDATE votantes SET datos_verificados = ? WHERE id = ?${acota}`,
      [verificado, req.params.id, ...(req.alcance ? parametrosAlcanceVotantes(req.alcance) : [])]
    );
    if (!resultado.affectedRows) return res.status(404).json({ error: 'No encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error actualizando los datos verificados.' });
  }
});

/**
 * El texto del apunte de auditoría cuando se borra la ficha de una persona.
 *
 * TIENE QUE BASTARSE SOLO, porque aquí no queda absolutamente nada. Al borrar
 * a alguien de la Estructura sobrevive su ficha de votante —así se pudo
 * reconstruir al aspirante el 29 de agosto de 2026—, pero al revés no: un
 * votante corriente, que nunca recibió una comunicación, no deja rastro en
 * ninguna otra tabla. Ni `usuarios`, ni `comunicaciones_envios`, ni
 * `sms_envios`. Este texto es la única copia.
 *
 * SE NOMBRA LO QUE SE VA EN CASCADA, no solo la ficha. Tres foráneas cuelgan
 * de `votantes` con ON DELETE CASCADE —`evento_asistentes`, `votante_ramas` y
 * asistió y de qué ramas formaba parte. Contado antes de borrar, el apunte
 * dice cuánto trabajo se perdió; sin contarlo, el borrado parece una fila.
 *
 * Y SE DEJA CONSTANCIA DEL CONSENTIMIENTO. Los tres campos de la Ley 1581
 * —autorización, fecha y versión de la política— son justamente lo que hay que
 * poder demostrar ante la SIC. Borrada la ficha, la prueba desaparece; el
 * apunte al menos conserva que existió, de cuándo era y contra qué texto.
 */
function descripcionDeVotanteBorrado(v) {
  const partes = [
    `Eliminó la ficha de ${v.nombre || 'una persona sin nombre'}`,
    v.cedula ? ` (cédula ${v.cedula})` : ' (sin cédula)',
    `, ${v.categoria === 'sublider' ? 'Sublíder' : 'Votante'}`,
    v.territorio_nombre ? ` de ${v.territorio_nombre}` : '',
    '.',
    ` El identificador de la ficha era ${v.id}`,
    v.telefono ? `, el teléfono ${v.telefono}` : '',
    v.email ? `, el correo ${v.email}` : '',
    v.lider_nombre ? `; la había registrado ${v.lider_nombre}.` : '.',
  ];

  /* La autorización de datos, en sus propias palabras: «no consta» y «no
     autorizó» no son lo mismo, y la columna distingue el 0 del NULL a
     propósito (ver la nota del esquema). El apunte respeta esa diferencia. */
  if (v.consentimiento_autorizado) {
    const cuando = v.consentimiento_fecha
      ? new Date(v.consentimiento_fecha).toISOString().slice(0, 10) : 'sin fecha';
    partes.push(` Tenía autorización de tratamiento de datos (${cuando}`
      + (v.consentimiento_version ? `, política ${v.consentimiento_version}` : '') + ').');
  } else {
    partes.push(' No constaba autorización de tratamiento de datos.');
  }

  const arrastre = [];
  if (v.eventos > 0)   arrastre.push([v.eventos, `${v.eventos} ${v.eventos === 1 ? 'asistencia a un evento' : 'asistencias a eventos'}`]);
  if (v.ramas > 0)     arrastre.push([v.ramas, `${v.ramas} ${v.ramas === 1 ? 'vínculo con la rama de un aspirante' : 'vínculos con ramas de aspirantes'}`]);
  if (arrastre.length) {
    const textos = arrastre.map(a => a[1]);
    const lista = textos.length === 1 ? textos[0]
      : `${textos.slice(0, -1).join(', ')} y ${textos[textos.length - 1]}`;
    const enSingular = arrastre.length === 1 && arrastre[0][0] === 1;
    partes.push(` Con la ficha se ${enSingular ? 'borró' : 'borraron'} ${lista}.`);
  }

  return partes.join('');
}

router.delete('/:id', async (req, res) => {
  /* SE CONFIRMA CON LA CONTRASEÑA DE QUIEN LO ESTA HACIENDO.
     No es la del administrador: un lider tiene derecho a corregir a su gente,
     y pedirle la clave ajena le quitaria esa capacidad. Pedirle la suya solo
     le pide confirmar — y cierra el caso de una sesion abierta y sin dueño en
     un celular prestado, que es el riesgo real en campaña.
     Va ANTES de cualquier validacion o escritura: comprobar despues de haber
     tocado la fila no confirma nada. */
  if (!(await verificarPasswordPropia(req.session.usuario.id, req.body && req.body.password))) {
    return res.status(403).json({ error: 'Contraseña incorrecta. Escribe la suya para confirmar.' });
  }
  try {
    /* UN ASPIRANTE NO BORRA LA FICHA: LA QUITA DE SU VISTA.
       Esa persona casi nunca es suya en exclusiva — la registro un lider de la
       campaña madre, y puede estar tambien en la rama de otro aspirante. Un
       `DELETE` aqui se la borraria a todos, y ni la madre ni el otro aspirante
       verian jamas quien lo hizo ni por que les falta gente.

       Se marca `excluido` en su propia rama. La ficha sigue entera, el deja de
       verla, y se puede deshacer con un UPDATE — que es lo que hay que poder
       hacer cuando alguien se equivoca de fila. */
    if (req.sublicencia) {
      const [[visible]] = await pool.query(
        `SELECT 1 AS ok FROM votantes v WHERE v.id = ? AND ${condicionAlcanceVotantes(req.alcance, 'v')} LIMIT 1`,
        [req.params.id, ...parametrosAlcanceVotantes(req.alcance)]);
      if (!visible) return res.status(404).json({ error: 'No encontrado.' });
      await pool.query(
        `INSERT INTO votante_ramas (votante_id, aspirante_id, registrado_por, excluido)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE excluido = 1`,
        [req.params.id, req.sublicencia.usuario_id, req.session.usuario.id]);
      return res.json({ ok: true, quitadoDeMiRama: true,
        mensaje: 'Se quitó de su estructura. La ficha no se borró: sigue en la campaña principal.' });
    }

    /* QUEDA CONSTANCIA, PORQUE AQUÍ NO SOBREVIVE NADA.
       Este es el borrado más destructivo de la aplicación y hasta el 29 de
       agosto de 2026 era también el más silencioso: el masivo de aquí abajo
       —`eliminar-todo`— sí registraba, y el de una sola persona no dejaba una
       línea. La misma asimetría que tenía la Estructura, y por la misma razón
       equivocada: el masivo se hace a propósito, el de uno es el que se hace
       por error.

       SE LEE ANTES DE BORRAR Y DENTRO DE LA TRANSACCIÓN, las dos cosas por
       necesidad. Antes, porque después del `DELETE` no hay dónde consultar el
       nombre. Y dentro, porque el apunte tiene que valer exactamente lo mismo
       que el borrado: si el `DELETE` no alcanza ninguna fila —la ficha se fue
       entre medias, o queda fuera del alcance de quien lo pide— se deshacen
       los dos juntos y no queda registrado un borrado que no ocurrió.

       LA CLÁUSULA DE ALCANCE SE MANTIENE EN EL `DELETE`, aunque el `SELECT` de
       arriba ya la haya aplicado. Es a propósito: quitarla dejaría que un
       error en la consulta de lectura ensanchara lo que se puede borrar, y ese
       es un fallo que no avisa. Comprobarlo dos veces no cuesta nada. */
    const condicionAlcance = req.alcance ? ` AND ${condicionAlcanceVotantes(req.alcance, 'v')}` : '';
    const paramsAlcance = req.alcance ? parametrosAlcanceVotantes(req.alcance) : [];

    /* MISMA FORMA QUE LOS OTROS CATORCE MANEJADORES DE BORRADO. Aquí el
       `try` exterior ya cubría un fallo de `getConnection()`, así que
       funcionaba; pero era el único con una estructura distinta, y un caso
       especial que hay que volver a razonar cada vez cuesta más que la línea
       que ahorra. */
    let conexion;
    try {
      conexion = await pool.getConnection();
      await conexion.beginTransaction();

      const [[ficha]] = await conexion.query(
        `SELECT v.id, v.nombre, v.cedula, v.telefono, v.email, v.categoria,
                v.consentimiento_autorizado, v.consentimiento_fecha, v.consentimiento_version,
                t.nombre AS territorio_nombre,
                l.nombre AS lider_nombre,
                (SELECT COUNT(*) FROM evento_asistentes ea WHERE ea.votante_id = v.id) AS eventos,
                (SELECT COUNT(*) FROM votante_ramas vr    WHERE vr.votante_id = v.id) AS ramas
           FROM votantes v
           LEFT JOIN territorios t ON t.id = v.territorio_id
           LEFT JOIN usuarios l    ON l.id = v.lider_id
          WHERE v.id = ?${condicionAlcance}`,
        [req.params.id, ...paramsAlcance]);

      if (!ficha) {
        await conexion.rollback();
        return res.status(404).json({ error: 'No encontrado.' });
      }

      await registrarAuditoriaEn(
        conexion, req.session.usuario.id, 'eliminar_persona', 'votantes', ficha.id,
        descripcionDeVotanteBorrado(ficha), req.ip
      );

      const params = [req.params.id];
      let query = `DELETE FROM votantes WHERE id = ?`;
      // Igual que GET/PUT: fuera de admin/coordinador, solo se puede borrar
      // un votante que uno mismo refirió.
      if (req.alcance) { query += ` AND ${condicionAlcanceVotantes(req.alcance, '')}`; params.push(...parametrosAlcanceVotantes(req.alcance)); }
      const [resultado] = await conexion.query(query, params);
      if (resultado.affectedRows === 0) {
        await conexion.rollback();
        return res.status(404).json({ error: 'No encontrado.' });
      }

      await conexion.commit();
      res.json({ ok: true });
    } catch (err) {
      /* EL ROLLBACK VA PROTEGIDO O SE COME EL ERROR ORIGINAL. Sobre una
         conexión muerta —MySQL reiniciado, `wait_timeout`, un KILL— el propio
         `rollback()` rechaza, y entonces el `throw err` de abajo no llega a
         ejecutarse: al log y al usuario les llega el fallo del rollback en
         vez de la causa real. */
      if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
      throw err;
    } finally {
      if (conexion) conexion.release();
    }
  } catch (err) {
    /* El `console.error` faltaba, y era el mismo agujero en pequeño: un
       borrado que falla respondía 500 y tampoco dejaba nada escrito en
       ninguna parte. Casi todos los demás handlers de este archivo sí lo
       tienen. */
    console.error(err);
    res.status(500).json({ error: 'Error eliminando el registro.' });
  }
});

/**
 * Elimina TODOS los votantes/contactos. Requiere la contraseña de un
 * administrador. Los asistentes a eventos asociados se eliminan en cascada
 * (evento_asistentes.votante_id tiene ON DELETE CASCADE).
 */
router.post('/eliminar-todo', requireRole('admin', 'coordinador'), async (req, res) => {
  const { password } = req.body;
  const autorizado = await verificarPasswordAdmin(password);
  if (!autorizado) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }
  /* SE APUNTA DENTRO DE LA TRANSACCIÓN Y ANTES DE BORRAR, como los demás.
     Antes se escribía DESPUÉS y por el pool, o sea por otra conexión y con el
     error tragado: si el apunte fallaba, el borrado ya estaba confirmado y no
     quedaba constancia de nada. En el borrado más destructivo de la
     aplicación era donde peor sentaba. */
  let conexion;
  try {
    conexion = await pool.getConnection();
    await conexion.beginTransaction();
    const [[antes]] = await conexion.query(
      `SELECT COUNT(*) AS total,
              SUM(categoria = 'sublider') AS sublideres,
              SUM(consentimiento_autorizado = 1) AS con_autorizacion
         FROM votantes`);
    await registrarAuditoriaEn(
      conexion, req.session.usuario.id, 'eliminar_todo', 'votantes', null,
      `Eliminó todos los votantes y contactos de la campaña: ${antes.total} fichas`
      + `, de las cuales ${antes.sublideres || 0} eran de sublíderes`
      + ` y ${antes.con_autorizacion || 0} tenían autorización de tratamiento de datos.`
      + ' Con ellas se fueron sus asistencias a eventos, sus vínculos con ramas de aspirantes y las opiniones registradas.',
      req.ip);
    const [result] = await conexion.query(`DELETE FROM votantes`);
    await conexion.commit();
    res.json({ ok: true, eliminados: result.affectedRows });
  } catch (err) {
    if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
    console.error(err);
    res.status(500).json({ error: 'Error eliminando los votantes.' });
  } finally {
    if (conexion) conexion.release();
  }
});

/* Importación masiva (arreglo de objetos ya parseado en el frontend desde CSV/Excel).
 *
 * LLEVA EL MISMO ROL QUE `/importar-excel`, Y NO LO LLEVABA. Colgaba solo del
 * `router.use(requireAuth, calcularAlcance)` de arriba, que exige sesion pero
 * incluye a lideres y sublideres: cualquiera de ellos podia insertar votantes
 * en masa, sin guarda de rol y sin la autorizacion de datos que el alta de uno
 * en uno si exige. Era la puerta de al lado de la que acabamos de cerrar.
 * No rompe ninguna pantalla: ninguna la llama —la importacion de la aplicacion
 * va por `/importar-excel`—, asi que la guarda no le quita nada a nadie.
 */
router.post('/importar', requireRole('admin', 'coordinador'), requiereImportarExportar('votantes'), async (req, res) => {
  const { registros } = req.body;
  if (!Array.isArray(registros) || registros.length === 0) {
    return res.status(400).json({ error: 'No se recibieron registros para importar.' });
  }
  let insertados = 0;
  const errores = [];
  // Mismas reglas que /importar-excel: cédula normalizada, y la repetida (en la base o en el mismo envío) se salta.
  const cedulasRepetidas = [];
  const fichasPorCedula = await mapaDeFichasPorCedula(pool, registros.map(r => normalizarCedula(r && r.cedula)).filter(Boolean));
  const vistaEnFila = new Map();
  for (const [i, b] of registros.entries()) {
    if (!b.nombre) { errores.push({ fila: i + 1, error: 'Falta el nombre' }); continue; }
    if (b.cedula != null && String(b.cedula).trim() !== '') {
      const rev = revisarCedula({ cedula: b.cedula, nombre: b.nombre });
      if (rev.bloqueo) { errores.push({ fila: i + 1, error: rev.bloqueo }); continue; }
    }
    normalizarCedulaDelCuerpo(b);
    if (b.cedula) {
      const donde = vistaEnFila.has(b.cedula) ? 'archivo' : (fichasPorCedula.has(b.cedula) ? 'base' : null);
      if (donde) {
        cedulasRepetidas.push({ fila: i + 1, donde, cedula: enmascararCedula(b.cedula) });
        errores.push({ fila: i + 1, error: `Cédula repetida (${enmascararCedula(b.cedula)}): ${donde === 'base' ? 'ya existe en la base' : 'ya viene en este envío'}. Se saltó.` });
        continue;
      }
    }
    try {
      await pool.query(
        `INSERT INTO votantes (nombre, cedula, telefono, territorio_id, created_by, origen, rama_aspirante_id)
         VALUES (?,?,?,?,?, 'importado', ?)`,
        [b.nombre, b.cedula || null, b.telefono || null, b.territorio_id || null,
         req.session.usuario.id,
         /* ESTAS FILAS NO GUARDAN `lider_id`, asi que la rama solo puede salir
            de la cedula: si esa persona esta en la estructura de un aspirante,
            cuelga de el. NO se usa quien importa como si fuera su lider —seria
            inventar un vinculo que la fila no registra— y ademas dejaria de
            coincidir con lo que `recalcularTodas()` calcularia despues. */
         await ramaDeVotante(pool, { cedula: b.cedula || null })]
      );
      insertados++;
      if (b.cedula) vistaEnFila.set(b.cedula, i + 1);
    } catch (err) {
      errores.push({ fila: i + 1, error: err.code === 'ER_DUP_ENTRY' ? 'Cédula duplicada' : 'Error al insertar' });
    }
  }
  res.json({ ok: true, insertados, errores, cedulasRepetidas });
});

/**
 * Suma un votante que ya existe a la rama de quien lo pide.
 *
 * NO copia la ficha ni la toca: escribe una fila en `votante_ramas` y ya. La
 * persona sigue siendo una sola, con un telefono y una direccion; lo que se
 * agrega es que esta rama tambien la ve.
 */
async function sumarARama(req, res, votanteId, cedulaCruda) {
  try {
    const miRama = await aspiranteDe(pool, req.session.usuario.id);
    if (!miRama) {
      return res.status(403).json({ error: 'No perteneces a la estructura de ningún aspirante con licencia propia.' });
    }
    const [[v]] = await pool.query('SELECT id, cedula FROM votantes WHERE id = ?', [votanteId]);
    if (!v) return res.status(404).json({ error: 'Esa persona ya no existe.' });

    /* QUIEN LLAMA TIENE QUE PODER ACREDITAR A ESA PERSONA. Antes bastaba con un
       id: cualquiera con sesión y rama propia podía recorrer ids y sumar a su
       base a gente que nunca vio. Se acepta una de dos cosas:
         a) la ficha ya es visible para él según su alcance (la misma condición
            del listado), o
         b) trae la cédula de la persona y coincide: es el flujo normal, donde la
            persona está en OTRA rama (no es visible, por definición) y quien
            registra la tecleó y el formulario la verificó con /buscar-por-cedula.
       La visibilidad sola rompería el caso de uso: `puede_sumar` solo se ofrece
       para fichas que NO son suyas. */
    let acreditada = false;
    const cedulaEnviada = String(cedulaCruda || '').trim();
    // Normalizadas las dos: «1.053.123.456» acredita a quien está guardado como «1053123456» y al revés.
    if (cedulaEnviada && v.cedula && normalizarCedula(cedulaEnviada) !== '' && normalizarCedula(cedulaEnviada) === normalizarCedula(v.cedula)) acreditada = true;
    if (!acreditada && req.alcance) {
      const [[visible]] = await pool.query(
        `SELECT 1 AS ok FROM votantes v WHERE v.id = ? AND ${condicionAlcanceVotantes(req.alcance, 'v')}`,
        [v.id, ...parametrosAlcanceVotantes(req.alcance)]);
      acreditada = !!visible;
    }
    if (!acreditada) {
      return res.status(403).json({ error: 'No puede agregar a esa persona: no está en su alcance ni acreditó su número de identificación.' });
    }

    await pool.query(
      `INSERT IGNORE INTO votante_ramas (votante_id, aspirante_id, registrado_por)
       VALUES (?, ?, ?)`,
      [v.id, miRama, req.session.usuario.id]);
    res.json({ ok: true, id: v.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo agregar a su estructura.' });
  }
}

router.post('/:id/sumar-a-mi-rama', limiteBuscarCedula, (req, res) => sumarARama(req, res, req.params.id, req.body && req.body.cedula));

/**
 * Lo mismo, pero SIN id (orden 31): la búsqueda por cédula ya no devuelve el id de una ficha ajena, así que el servidor
 * la resuelve con la cédula. La regla es EXACTAMENTE la de arriba (se acredita con la cédula, y se suma a la rama de
 * quien lo pide); aquí solo cambia cómo se encuentra la ficha.
 */
router.post('/sumar-por-cedula', limiteBuscarCedula, async (req, res) => {
  const cedula = String((req.body && req.body.cedula) || '').trim();
  try {
    const id = normalizarCedula(cedula) ? await buscarFichaPorCedula(pool, normalizarCedula(cedula)) : null;
    if (!id) return res.status(404).json({ error: 'Esa persona ya no existe.' });
    return sumarARama(req, res, id, cedula);
  } catch (err) {
    console.error(err.code || err.message);
    res.status(500).json({ error: 'No se pudo agregar a su estructura.' });
  }
});

/* AUTORIZACIÓN DE DATOS POR ENLACE (parche 325): estado, enlace y constancia de UN votante. Lo ve y lo envía quien lo tiene en su alcance. */
montarRutasAutorizacion(router, {
  tipo: 'votante', roles: [...ROLES_QUE_REGISTRAN, 'aspirante'], requireRole,
  buscarPersona: async (req, id) => {
    let sql = 'SELECT id, nombre, rama_aspirante_id AS rama FROM votantes WHERE id = ?';
    const params = [id];
    if (req.alcance) { sql += ` AND ${condicionAlcanceVotantes(req.alcance, '')}`; params.push(...parametrosAlcanceVotantes(req.alcance)); }
    const [[f]] = await pool.query(sql, params);
    return f || null;
  },
});

module.exports = router;
