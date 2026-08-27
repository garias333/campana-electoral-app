const express = require('express');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireAuth, requireRole, calcularAlcance } = require('../middleware/auth');
const { geocodificarDireccion } = require('../config/geocoder');
const { resolverTerritorioDesdeNombres } = require('../config/territorioResolver');
const { uploadExcel } = require('../middleware/upload');
const { aspiranteDe } = require('../lib/ramas');
const { condicionAlcanceVotantes, parametrosAlcanceVotantes,
        filtroAlcanceEstimado } = require('../lib/alcanceVotantes');
const { armarWhereSql } = require('../config/filtros');
const { registrarAuditoria } = require('../config/auditoria');
const { validarCedula } = require('../lib/validarCedula');
const { asegurarEstructuraTestigo, resolverOCrearUsuarioParaTestigo } = require('../config/testigoElectoral');
const { sincronizarEstructuraDesdeVotante } = require('../config/sincronizacionVotantesEstructura');
const { calcularEstimadoPorPuesto } = require('../config/estimadoPuestos');
const { verificarPasswordAdmin, validarTelefono10Digitos, verificarPasswordPropia } = require('../config/verificaciones');

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
  const { q, territorio_id, apoya_a, lider_id, area, zona_id, municipio_id, tipo_votante, categoria, no_contactar, page = 1, limit = 50 } = req.query;
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
  // Quien pidió no recibir mensajes. '1' = solo esos; '0' = solo a quienes sí
  // se les puede escribir. Se comparan como TEXTO porque así llegan en la URL
  // y `if (no_contactar)` dejaría fuera el '0' —es una cadena vacía de
  // significado pero no de valor—, que es justo la mitad útil del filtro.
  if (no_contactar === '1') condiciones.push(`v.no_contactar = 1`);
  if (no_contactar === '0') condiciones.push(`(v.no_contactar = 0 OR v.no_contactar IS NULL)`);
  if (req.alcance) { condiciones.push(condicionAlcanceVotantes(req.alcance)); params.push(...parametrosAlcanceVotantes(req.alcance)); }

  const whereSql = armarWhereSql(condiciones);

  try {
    const [rows] = await pool.query(
      `SELECT v.*, t.nombre AS territorio_nombre, padre.nombre AS zona_nombre, u.nombre AS lider_nombre,
              sub.nombre AS sublider_nombre,
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
       LEFT JOIN usuarios ut ON ut.numero_identificacion = v.cedula
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
       LEFT JOIN usuarios ut ON ut.numero_identificacion = v.cedula
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
    const [porIntencion] = await pool.query(
      `SELECT intencion_voto, COUNT(*) AS total FROM votantes GROUP BY intencion_voto`
    );
    const [porTerritorio] = await pool.query(`
      SELECT t.nombre, COUNT(v.id) AS total
      FROM votantes v JOIN territorios t ON t.id = v.territorio_id
      GROUP BY t.id ORDER BY total DESC LIMIT 15
    `);
    res.json({ porIntencion, porTerritorio });
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
    const resultado = await calcularEstimadoPorPuesto(pool, filtroAlcanceEstimado(req));
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
          ? 'Contraseña incorrecta. Escriba la suya para confirmar.'
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
router.get('/exportar-excel', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  try {
    const { q, territorio_id, apoya_a, lider_id, area, zona_id, municipio_id, tipo_votante, categoria, no_contactar } = req.query;
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
    const whereSql = armarWhereSql(condiciones);

    const [filas] = await pool.query(`
      SELECT v.id, v.categoria, v.nombre, v.cedula, v.telefono, v.email, v.genero, v.edad, v.fecha_nacimiento,
             v.departamento_votacion, v.municipio_votacion, v.puesto_votacion, v.mesa_votacion,
             ${SQL_AREA_EFECTIVA} AS area,
             v.direccion, v.departamento_residencia, v.ciudad_residencia, v.intencion_voto, v.apoya_a, v.observaciones,
             v.tipo_area_influencia, v.organizacion,
             t.tipo AS territorio_tipo, t.nombre AS territorio_nombre, padre.nombre AS pertenece,
             lider.email AS lider_email
      FROM votantes v
      LEFT JOIN territorios t ON t.id = v.territorio_id
      LEFT JOIN territorios padre ON padre.id = t.padre_id
      LEFT JOIN usuarios lider ON lider.id = v.lider_id
      -- Hace falta para el filtro de Área, que mira la Estructura: sin él,
      -- exportar con ese filtro puesto fallaría igual que el conteo.
      LEFT JOIN usuarios ut ON ut.numero_identificacion = v.cedula
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
      'Líder o coordinador', 'Intención de voto', 'Apoya a', 'Observaciones'
    ];

    const datos = filas.map(f => ({
      'ID': f.id,
      'Categoría': f.categoria === 'sublider' ? 'Sublíder' : 'Votante',
      'Nombres y apellidos': f.nombre,
      'Número de identificación': f.cedula || '',
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
      'Intención de voto': f.intencion_voto,
      'Apoya a': (Array.isArray(f.apoya_a) ? f.apoya_a : []).map(v => ETIQUETAS_APOYA_A[v] || v).join(', '),
      'Observaciones': f.observaciones || ''
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
router.post('/importar-excel', requireRole('admin', 'coordinador'), uploadExcel.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Debe adjuntar un archivo Excel (.xlsx).' });
  try {
    const libro = XLSX.read(req.file.buffer, { type: 'buffer' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });

    let insertados = 0;
    let actualizados = 0;
    const errores = [];
    const posiblesDuplicados = [];

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
      if (!nombre) {
        errores.push({ fila: i + 2, error: 'Nombres y apellidos son obligatorios.' });
        continue;
      }
      const cedula = String(fila['Número de identificación'] || fila.Cédula || fila.Cedula || fila.cedula || '').trim() || null;
      // Tolerante: si el teléfono de la fila no tiene 10 dígitos, se
      // importa la persona igual, solo que sin teléfono (no se rechaza la
      // fila completa por ese único campo).
      const telefono = normalizarTelefonoImportado(fila.Teléfono || fila.Telefono || fila.telefono || '');
      const email = String(fila.Email || fila.email || '').trim() || null;
      const generoTexto = String(fila.Género || fila.Genero || fila.genero || '').trim().toLowerCase();
      const MAPA_GENERO_IMPORT = {
        'mujer': 'mujer', 'f': 'mujer', 'femenino': 'mujer',
        'hombre': 'hombre', 'm': 'hombre', 'masculino': 'hombre',
        'no binario': 'no_binario', 'no_binario': 'no_binario', 'otro': 'no_binario',
        'prefiero no responder': 'prefiero_no_responder', 'prefiero_no_responder': 'prefiero_no_responder', 'no informa': 'prefiero_no_responder'
      };
      const genero = MAPA_GENERO_IMPORT[generoTexto] || 'prefiero_no_responder';
      const edad = parseInt(fila.Edad || fila.edad) || null;
      const fechaNacimiento = fila['Fecha nacimiento'] || fila.fecha_nacimiento || null;
      const departamentoVotacion = String(fila['Departamento votación'] || fila.departamento_votacion || '').trim() || null;
      const municipioVotacion = String(fila['Municipio votación'] || fila.municipio_votacion || '').trim() || null;
      const puestoVotacion = String(fila.Puesto || fila['Puesto de votación'] || fila.puesto_votacion || '').trim() || null;
      const mesaVotacion = String(fila.Mesa || fila['Mesa de votación'] || fila.mesa_votacion || '').trim() || null;
      const area = String(fila.Área || fila.Area || fila.area || '').trim();
      const comuna = String(fila.Comuna || fila.comuna || '').trim();
      const barrio = String(fila.Barrio || fila.barrio || '').trim();
      const corregimiento = String(fila.Corregimiento || fila.corregimiento || '').trim();
      const vereda = String(fila.Vereda || fila.vereda || '').trim();
      const direccion = String(fila['Dirección de Residencia'] || fila.Dirección || fila.Direccion || fila.direccion || '').trim() || null;
      const departamentoResidenciaImport = String(fila['Departamento de residencia'] || fila.departamento_residencia || '').trim() || null;
      const ciudadResidenciaImport = String(fila['Ciudad de residencia'] || fila.ciudad_residencia || '').trim() || null;
      const liderEmail = String(fila['Líder o coordinador'] || fila.lider_email || '').trim().toLowerCase();
      const intencionVoto = String(fila['Intención de voto'] || fila.intencion_voto || '').trim().toLowerCase() || 'desconocido';
      const observaciones = String(fila.Observaciones || fila.observaciones || '').trim() || null;

      // Si estas columnas vienen vacías en una fila que SÍ trae ID (modo
      // actualizar), no se borra lo que ya tenía guardado ese contacto —
      // solo se cambia el Territorio o el Líder si la fila trae algo en
      // esas columnas. En una fila nueva (sin ID) esto no aplica.
      const tocarTerritorio = !!(comuna || barrio || corregimiento || vereda);
      const tocarLider = !!liderEmail;

      let territorioId = null;
      if (tocarTerritorio) {
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
          if (cedula) {
            const [dupe] = await pool.query(`SELECT id FROM votantes WHERE cedula = ? AND id != ?`, [cedula, idFila]);
            if (dupe.length) { errores.push({ fila: i + 2, error: 'Número de identificación duplicado (pertenece a otro contacto).' }); continue; }
          }
          await pool.query(
            `UPDATE votantes SET
               nombre = ?, cedula = ?, telefono = ?, email = ?, genero = ?, edad = ?, fecha_nacimiento = ?,
               direccion = ?, departamento_residencia = ?, ciudad_residencia = ?, area = ?,
               territorio_id = COALESCE(?, territorio_id),
               lider_id = COALESCE(?, lider_id),
               intencion_voto = ?, departamento_votacion = ?, municipio_votacion = ?, puesto_votacion = ?, mesa_votacion = ?, observaciones = ?
             WHERE id = ?`,
            [nombre, cedula, telefono, email, genero, edad, fechaNacimiento || null,
             direccion, departamentoResidenciaImport, ciudadResidenciaImport, area || null,
             tocarTerritorio ? territorioId : null,
             tocarLider ? liderId : null,
             intencionVoto, departamentoVotacion, municipioVotacion, puestoVotacion, mesaVotacion, observaciones,
             idFila]
          );
          actualizados++;
          geocodificarYGuardarVotante(idFila, direccion, tocarTerritorio ? territorioId : null, departamentoResidenciaImport, ciudadResidenciaImport)
            .catch(err => console.error(`Error geocodificando la fila actualizada (votante id ${idFila}):`, err));
        } catch (err) {
          errores.push({ fila: i + 2, error: err.code === 'ER_DUP_ENTRY' ? 'Número de identificación duplicado.' : 'Error al actualizar esta fila.' });
        }
        continue;
      }

      // --- Modo agregar: la fila no trae ID, se crea un contacto nuevo ---
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
            direccion, departamento_residencia, ciudad_residencia, area, lider_id, intencion_voto, departamento_votacion, municipio_votacion,
            puesto_votacion, mesa_votacion, observaciones, created_by, origen)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'importado')`,
          [nombre, cedula, telefono, email, genero, edad, fechaNacimiento || null, territorioId,
           direccion, departamentoResidenciaImport, ciudadResidenciaImport, area || null, liderId || req.session.usuario.id, intencionVoto,
           departamentoVotacion, municipioVotacion, puestoVotacion, mesaVotacion,
           observaciones, req.session.usuario.id]
        );
        insertados++;
        geocodificarYGuardarVotante(result.insertId, direccion, territorioId, departamentoResidenciaImport, ciudadResidenciaImport)
          .catch(err => console.error(`Error geocodificando la fila importada (votante id ${result.insertId}):`, err));
      } catch (err) {
        errores.push({ fila: i + 2, error: err.code === 'ER_DUP_ENTRY' ? 'Número de identificación duplicado.' : 'Error al insertar esta fila.' });
      }
    }

    res.json({ ok: true, insertados, actualizados, errores, posiblesDuplicados });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error procesando el archivo Excel. Verifique que el formato de las columnas sea correcto.' });
  }
});

// Verifica en tiempo real (antes de guardar) si un número de identificación
// ya está registrado por otro contacto. excluir_id se usa en modo edición
// para no contarse a sí mismo como duplicado.
router.get('/verificar-identificacion', async (req, res) => {
  const { numero, excluir_id } = req.query;
  if (!numero || !numero.trim()) return res.json({ disponible: true });
  try {
    let query = `SELECT id FROM votantes WHERE cedula = ?`;
    const params = [numero.trim()];
    if (excluir_id) { query += ` AND id != ?`; params.push(excluir_id); }
    const [rows] = await pool.query(query, params);
    res.json({ disponible: rows.length === 0 });
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
router.get('/buscar-por-cedula', async (req, res) => {
  const cedula = (req.query.cedula || '').trim();
  if (!cedula) return res.json(null);
  try {
    const [[fila]] = await pool.query(
      `SELECT id, nombre, telefono, cedula, lider_id, sublider_id, rama_aspirante_id
         FROM votantes WHERE cedula = ? LIMIT 1`,
      [cedula]
    );
    if (!fila) return res.json(null);

    /* CON QUIEN PREGUNTA, LA MISMA CEDULA SIGNIFICA COSAS DISTINTAS.
       Hasta ahora esto devolvia la ficha y punto, y el formulario no podia
       hacer nada util con ella: si la persona ya existia, registrarla fallaba
       con «Ya registrado por otro lider» y ahi se acababa. Con dos aspirantes
       al Concejo en la misma campaña eso pasa a diario.

       Se agregan dos datos, no una ruta nueva: `mia` para abrir la ficha en vez
       de intentar crearla, y `puede_sumar` para ofrecer agregarla a su rama.

       Lo que NO se agrega es la valoracion ni las observaciones de la otra
       rama: el nombre y el telefono son de la persona; lo que otra campaña
       piense de ella, no. */
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

    res.json({
      id: fila.id,
      nombre: fila.nombre,
      telefono: fila.telefono,
      cedula: fila.cedula,
      mia,
      // Sin rama propia no hay donde sumarla, y ofrecerlo seria un boton que se
      // niega al pulsarlo — peor que no ofrecerlo.
      puede_sumar: !!miRama && !mia,
    });
  } catch (err) {
    console.error(err);
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
router.get('/verificar-duplicado', async (req, res) => {
  const { nombre, telefono, excluir_id } = req.query;
  if (!nombre || !nombre.trim()) return res.json({ coincidencias: [] });

  const telefonoLimpio = (telefono || '').replace(/\D/g, '');
  const condiciones = [];
  const params = [];

  if (telefonoLimpio) {
    condiciones.push(`telefono = ?`);
    params.push(telefonoLimpio);
  }
  // SOUNDEX en vez de un buscador de texto libre (MATCH...AGAINST): en la
  // práctica cualquier apellido común (ej. "Arias") hacía que encontrara a
  // todo el que lo comparta, aunque el resto del nombre no se pareciera en
  // nada. No atrapa errores de digitación en la primera letra (limitación
  // conocida del algoritmo).
  condiciones.push(`SOUNDEX(nombre) = SOUNDEX(?)`);
  params.push(nombre.trim());

  let query = `SELECT id, nombre, telefono, cedula FROM votantes WHERE (${condiciones.join(' OR ')})`;
  if (excluir_id) { query += ` AND id != ?`; params.push(excluir_id); }
  query += ` LIMIT 5`;

  try {
    const [rows] = await pool.query(query, params);
    res.json({
      coincidencias: rows.map(r => ({
        id: r.id,
        nombreCompleto: r.nombre,
        telefono: r.telefono,
        cedula: r.cedula,
        porTelefono: !!(telefonoLimpio && r.telefono === telefonoLimpio)
      }))
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

async function procesarSublider({ nombre, cedula, email, telefono, liderId, territorioId, tipoAreaInfluencia, organizacion, metaVotos, nivel }) {
  const destino = NIVELES_SUBALTERNO[nivel] || NIVELES_SUBALTERNO.sublider;
  if (!cedula) {
    return { creado: false, estructuraCreada: false, etiqueta: destino.etiqueta, motivo: 'Falta el Número de identificación.' };
  }
  const emailLimpio = (email || '').trim().toLowerCase() || null;

  let usuarioId = null;
  let cuentaCreada = false;

  try {
    const [[existente]] = await pool.query(
      emailLimpio
        ? `SELECT id FROM usuarios WHERE email = ? OR numero_identificacion = ? LIMIT 1`
        : `SELECT id FROM usuarios WHERE numero_identificacion = ? LIMIT 1`,
      emailLimpio ? [emailLimpio, cedula] : [cedula]
    );

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
    const esOrganizacion = tipoAreaInfluencia === 'organizacion';
    if (!yaExiste) {
      await pool.query(
        `INSERT INTO estructura (usuario_id, territorio_id, cargo, tipo_area_influencia, organizacion, supervisor_id, meta_votos, activo)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [usuarioId, esOrganizacion ? null : (territorioId || null), destino.cargo,
         esOrganizacion ? 'organizacion' : 'territorio',
         esOrganizacion ? (organizacion || null) : null, liderId || null, metaVotos || 0]
      );
      estructuraCreada = true;
    } else {
      await pool.query(
        `UPDATE estructura SET territorio_id = ?, tipo_area_influencia = ?, organizacion = ?, supervisor_id = ?, meta_votos = ?
         WHERE id = ?`,
        [esOrganizacion ? null : (territorioId || null), esOrganizacion ? 'organizacion' : 'territorio',
         esOrganizacion ? (organizacion || null) : null, liderId || null, metaVotos || 0, yaExiste.id]
      );
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
  const esOrganizacion = b.categoria === 'sublider' && b.tipo_area_influencia === 'organizacion';
  if (esOrganizacion && !(b.organizacion || '').trim()) {
    return res.status(400).json({ error: 'Escriba el nombre de la organización.' });
  }
  if (!validarTelefono10Digitos(b.telefono)) {
    return res.status(400).json({ error: 'Error de digitación: el teléfono debe tener 10 dígitos.' });
  }
  b.telefono = b.telefono ? b.telefono.replace(/\D/g, '') : null;
  if (!validarTelefono10Digitos(b.telefono)) {
    return res.status(400).json({ error: 'Error de digitación: el teléfono debe tener 10 dígitos.' });
  }
  b.telefono = b.telefono ? b.telefono.replace(/\D/g, '') : null;

  // Consentimiento (Circular SIC 002 de 2026 / Ley 1581 de 2012): exigible
  // solo cuando quien registra es Líder o Sublíder — es el momento real de
  // captura frente a la persona, a pie de calle. Un admin/coordinador
  // corrigiendo o importando datos desde el panel de escritorio no está en
  // ese momento, así que ahí no se exige (no tendría sentido pedirle a un
  // admin que "confirme" una autorización que no presenció).
  const exigeConsentimiento = ['lider', 'sublider'].includes(req.session.usuario.rol);
  if (exigeConsentimiento && !b.consentimiento_autorizado) {
    return res.status(400).json({ error: 'Debes confirmar que la persona autorizó el uso de sus datos antes de guardar el registro.' });
  }

  // Igual que en /mi-referido: si quien registra es Líder o Sublíder, el
  // servidor IGNORA lo que haya mandado el cliente en lider_id/sublider_id
  // y calcula esos dos valores siempre desde la Estructura guardada —
  // esto protege tanto al panel de escritorio como a la app móvil de
  // captura, para que nadie pueda registrar un votante "a nombre" de otro
  // líder/sublíder distinto al de su propia sesión.
  if (req.session.usuario.rol === 'lider') {
    b.lider_id = req.session.usuario.id;
    b.sublider_id = null;
  } else if (req.session.usuario.rol === 'sublider') {
    // Filtrado por cargo='usuario': si esta cuenta también es testigo
    // electoral (dos filas en Estructura para el mismo usuario_id), esto
    // evita quedarse con la fila equivocada y perder a qué Líder reporta.
    const [[estructuraPropia]] = await pool.query(`SELECT supervisor_id FROM estructura WHERE usuario_id = ? AND cargo = 'usuario'`, [req.session.usuario.id]);
    b.lider_id = estructuraPropia ? estructuraPropia.supervisor_id : null;
    b.sublider_id = req.session.usuario.id;
  }

  let votanteId;
  try {
    const [result] = await pool.query(
      `INSERT INTO votantes
       (categoria, nombre, cedula, telefono, email, genero, edad, fecha_nacimiento, territorio_id,
        tipo_area_influencia, organizacion,
        direccion, departamento_residencia, ciudad_residencia, area, lider_id, sublider_id, intencion_voto, apoya_a,
        departamento_votacion, municipio_votacion,
        puesto_votacion, ctc_puesto_id, mesa_votacion, observaciones,
        consentimiento_autorizado, consentimiento_fecha, consentimiento_metodo,
        consentimiento_email, consentimiento_sms, consentimiento_whatsapp, consentimiento_version,
        cliente_uuid, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.categoria, b.nombre, b.cedula || null, b.telefono || null, b.email || null,
       b.genero || 'prefiero_no_responder', b.edad || null, b.fecha_nacimiento || null, esOrganizacion ? null : (b.territorio_id || null),
       esOrganizacion ? 'organizacion' : 'territorio', esOrganizacion ? b.organizacion.trim() : null,
       b.direccion || null, b.departamento_residencia || null, b.ciudad_residencia || null,
       esOrganizacion ? null : (b.area || null), b.lider_id || req.session.usuario.id, b.sublider_id || null,
       b.intencion_voto || 'desconocido', JSON.stringify(Array.isArray(b.apoya_a) ? b.apoya_a : []),
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
       (b.consentimiento_version || '').slice(0, 64) || null,
       b.cliente_uuid || null,
       req.session.usuario.id]
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
      tipoAreaInfluencia: esOrganizacion ? 'organizacion' : 'territorio',
      organizacion: esOrganizacion ? b.organizacion.trim() : null,
      metaVotos: b.meta_votos_sublider || 0,
      // El escalon lo decide la SESION, no el cuerpo de la peticion: quien
      // entro con sublicencia crea lideres, los demas crean sublideres.
      nivel: req.sublicencia ? 'lider' : 'sublider'
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

  res.json({ ok: true, id: votanteId, geocodificado: geo.geocodificado, usuario_sublider: usuarioSublider, avisos: revision.avisos });
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
    return res.status(403).json({ error: 'Contraseña incorrecta. Escriba la suya para confirmar.' });
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
  const esOrganizacion = b.categoria === 'sublider' && b.tipo_area_influencia === 'organizacion';
  if (esOrganizacion && !(b.organizacion || '').trim()) {
    return res.status(400).json({ error: 'Escriba el nombre de la organización.' });
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
      `SELECT direccion, territorio_id FROM votantes WHERE id = ?`, [req.params.id]
    );

    await pool.query(
      `UPDATE votantes SET categoria=?, nombre=?, cedula=?, telefono=?, email=?, genero=?, edad=?,
       fecha_nacimiento=?, territorio_id=?, tipo_area_influencia=?, organizacion=?, direccion=?,
       departamento_residencia=?, ciudad_residencia=?,
       area=?, lider_id=?, sublider_id=?, intencion_voto=?, apoya_a=?,
       departamento_votacion=?, municipio_votacion=?, puesto_votacion=?, ctc_puesto_id=?, mesa_votacion=?, observaciones=? WHERE id = ?`,
      [b.categoria, b.nombre, b.cedula || null, b.telefono || null, b.email || null,
       b.genero || 'prefiero_no_responder', b.edad || null, b.fecha_nacimiento || null, esOrganizacion ? null : (b.territorio_id || null),
       esOrganizacion ? 'organizacion' : 'territorio', esOrganizacion ? b.organizacion.trim() : null,
       b.direccion || null, b.departamento_residencia || null, b.ciudad_residencia || null,
       esOrganizacion ? null : (b.area || null), b.lider_id || null, b.sublider_id || null,
       b.intencion_voto || 'desconocido', JSON.stringify(Array.isArray(b.apoya_a) ? b.apoya_a : []),
       b.departamento_votacion || null, b.municipio_votacion || null,
       b.puesto_votacion || null, await resolverCtcPuestoId(b), b.mesa_votacion || null, b.observaciones || null, req.params.id]
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
        tipoAreaInfluencia: esOrganizacion ? 'organizacion' : 'territorio',
        organizacion: esOrganizacion ? b.organizacion.trim() : null,
        metaVotos: b.meta_votos_sublider || 0,
        // Mismo criterio que al crear: lo decide la sesion, no el cuerpo.
        nivel: req.sublicencia ? 'lider' : 'sublider'
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

    res.json({ ok: true, usuario_sublider: usuarioSublider, avisos: revision.avisos });
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
    const [resultado] = await pool.query(
      `UPDATE votantes SET datos_verificados = ? WHERE id = ?`,
      [verificado, req.params.id]
    );
    if (!resultado.affectedRows) return res.status(404).json({ error: 'No encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error actualizando los datos verificados.' });
  }
});

router.delete('/:id', async (req, res) => {
  /* SE CONFIRMA CON LA CONTRASEÑA DE QUIEN LO ESTA HACIENDO.
     No es la del administrador: un lider tiene derecho a corregir a su gente,
     y pedirle la clave ajena le quitaria esa capacidad. Pedirle la suya solo
     le pide confirmar — y cierra el caso de una sesion abierta y sin dueño en
     un celular prestado, que es el riesgo real en campaña.
     Va ANTES de cualquier validacion o escritura: comprobar despues de haber
     tocado la fila no confirma nada. */
  if (!(await verificarPasswordPropia(req.session.usuario.id, req.body && req.body.password))) {
    return res.status(403).json({ error: 'Contraseña incorrecta. Escriba la suya para confirmar.' });
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

    const params = [req.params.id];
    let query = `DELETE FROM votantes WHERE id = ?`;
    // Igual que GET/PUT: fuera de admin/coordinador, solo se puede borrar
    // un votante que uno mismo refirió.
    if (req.alcance) { query += ` AND ${condicionAlcanceVotantes(req.alcance, '')}`; params.push(...parametrosAlcanceVotantes(req.alcance)); }
    const [resultado] = await pool.query(query, params);
    if (resultado.affectedRows === 0) return res.status(404).json({ error: 'No encontrado.' });
    res.json({ ok: true });
  } catch (err) {
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
  try {
    const [result] = await pool.query(`DELETE FROM votantes`);
    await registrarAuditoria(
      req.session.usuario.id, 'eliminar_todo', 'votantes', null,
      `Eliminó todos los votantes/contactos (${result.affectedRows} registros).`, req.ip
    );
    res.json({ ok: true, eliminados: result.affectedRows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error eliminando los votantes.' });
  }
});

// Importación masiva (arreglo de objetos ya parseado en el frontend desde CSV/Excel)
router.post('/importar', async (req, res) => {
  const { registros } = req.body;
  if (!Array.isArray(registros) || registros.length === 0) {
    return res.status(400).json({ error: 'No se recibieron registros para importar.' });
  }
  let insertados = 0;
  const errores = [];
  for (const [i, b] of registros.entries()) {
    if (!b.nombre) { errores.push({ fila: i + 1, error: 'Falta el nombre' }); continue; }
    try {
      await pool.query(
        `INSERT INTO votantes (nombre, cedula, telefono, territorio_id, intencion_voto, created_by, origen)
         VALUES (?,?,?,?,?,?, 'importado')`,
        [b.nombre, b.cedula || null, b.telefono || null, b.territorio_id || null,
         b.intencion_voto || 'desconocido', req.session.usuario.id]
      );
      insertados++;
    } catch (err) {
      errores.push({ fila: i + 1, error: err.code === 'ER_DUP_ENTRY' ? 'Cédula duplicada' : 'Error al insertar' });
    }
  }
  res.json({ ok: true, insertados, errores });
});

/**
 * Suma un votante que ya existe a la rama de quien lo pide.
 *
 * NO copia la ficha ni la toca: escribe una fila en `votante_ramas` y ya. La
 * persona sigue siendo una sola, con un telefono y una direccion; lo que se
 * agrega es que esta rama tambien la ve.
 */
router.post('/:id/sumar-a-mi-rama', async (req, res) => {
  try {
    const miRama = await aspiranteDe(pool, req.session.usuario.id);
    if (!miRama) {
      return res.status(403).json({ error: 'Usted no pertenece a la estructura de ningun aspirante con licencia propia.' });
    }
    const [[v]] = await pool.query('SELECT id FROM votantes WHERE id = ?', [req.params.id]);
    if (!v) return res.status(404).json({ error: 'Esa persona ya no existe.' });

    await pool.query(
      `INSERT IGNORE INTO votante_ramas (votante_id, aspirante_id, registrado_por)
       VALUES (?, ?, ?)`,
      [v.id, miRama, req.session.usuario.id]);
    res.json({ ok: true, id: v.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo agregar a su estructura.' });
  }
});

module.exports = router;
