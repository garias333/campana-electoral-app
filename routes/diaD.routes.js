const express = require('express');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { registrarAuditoriaEn } = require('../config/auditoria');
const { requireAuth, requireRole } = require('../middleware/auth');
const { upload, uploadExcel } = require('../middleware/upload');
const { verificarPasswordAdmin } = require('../config/verificaciones');
const { aspiranteDe, subarbolSql, filtroTestigosMadre } = require('../lib/ramas');

/**
 * DE QUE CAMPANA SON LOS PUESTOS Y LOS CANDIDATOS DE QUIEN PREGUNTA.
 *
 * La sublicencia del Aspirante al Concejo es una campana aparte: sus puestos
 * del Dia D, con su propia cantidad de mesas, y sus propios candidatos. Antes
 * habia una sola lista y el aspirante veia la de la campana madre.
 *
 * Dos maneras de resolverlo, y hacen falta las dos:
 *   · Con sublicencia -el aspirante en su panel- es el mismo.
 *   · Sin ella, se sube por la cadena de mando hasta el aspirante mas cercano.
 *     Eso es lo que hace que un TESTIGO suyo reporte contra los candidatos de
 *     su campana y no contra los de la madre. (Funciona porque los testigos ya
 *     cuelgan de alguien; antes nacian sin supervisor y esta subida se cortaba.)
 * Si no cuelga de ningun aspirante, 0: la campana principal.
 */
/**
 * LA JORNADA DE CADA CAMPANA, ACOTADA POR QUIEN REPORTA.
 *
 * `dia_d_reportes` no tiene columna de dueno y no le hace falta: la trae quien
 * firma el reporte. Un reporte es del aspirante si su testigo cuelga de el, y
 * de la campana madre si no cuelga de ningun aspirante — la misma regla que
 * separa los testigos, y por el mismo motivo: el reporte de una mesa pertenece
 * a quien puso a la persona que la vigila.
 *
 * OJO, VA EN LAS DOS MITADES DE CADA CONSULTA. Todas agrupan primero «el
 * ultimo reporte por mesa» en una subconsulta y filtran despues. Acotando solo
 * la de fuera, el ultimo reporte de una mesa podria ser el de la OTRA campana:
 * la subconsulta lo elegiria, el filtro de fuera lo descartaria, y esa mesa
 * desapareceria del tablero como si nadie la hubiera reportado. Por eso el
 * ayudante recibe el nombre de la columna: dentro la tabla va sin alias.
 */
async function acotaJornada(req, columna) {
  const dueno = await duenoDeLaCampana(req);
  return dueno ? subarbolSql(dueno, columna) : await filtroTestigosMadre(pool, columna);
}

async function duenoDeLaCampana(req) {
  if (req.sublicencia) return req.sublicencia.usuario_id;
  return (await aspiranteDe(pool, req.session.usuario.id)) || 0;
}

const router = express.Router();
router.use(requireAuth);

// Base del Catálogo Territorial de Colombia. Se deja configurable por si
// algún día vive en otro servidor (mismo criterio que catalogo.routes.js).
const CATALOGO = process.env.CATALOGO_DB || 'territoriosdb';
const NIVEL_DEPARTAMENTO = 2;
const NIVEL_MUNICIPIO = 3;

/**
 * Traduce el Departamento/Ciudad que el admin escribió en Configuración →
 * Datos de la campaña a los ids del catálogo territorial.
 *
 * Se busca por nombre y, si no cruza, por alias: `configuracion_campana`
 * guarda texto libre tomado de /data/colombia.json, que no siempre escribe
 * igual que el catálogo — «Bogotá D.C.» contra «Bogotá, D.C.», por
 * ejemplo; una coma basta para que no cruce.
 *
 * El municipio se busca SIEMPRE dentro del departamento ya resuelto: a
 * nivel nacional los nombres se repiten («El Carmen» está en Chocó y en
 * Santander) y sin acotar se filtraría por el municipio equivocado.
 *
 * Devuelve `{ departamentoId, municipioId }`, cualquiera de los dos en
 * null si no está configurado o no cruzó.
 */
async function ambitoDeLaCampana() {
  const vacio = { departamentoId: null, municipioId: null };
  const [[cfg]] = await pool.query(
    `SELECT departamento, ciudad FROM configuracion_campana WHERE id = 1`);
  if (!cfg || !cfg.departamento || !cfg.departamento.trim()) return vacio;

  const nombreDepto = cfg.departamento.trim();
  const [[depto]] = await pool.query(
    `SELECT t.id FROM ${CATALOGO}.ctc_territorios t
      WHERE t.nivel_id = ? AND t.estado = 'ACTIVO'
        AND (t.nombre = ? OR EXISTS (SELECT 1 FROM ${CATALOGO}.ctc_alias a
                                      WHERE a.territorio_id = t.id AND a.alias = ?))
      LIMIT 1`,
    [NIVEL_DEPARTAMENTO, nombreDepto, nombreDepto]
  );
  if (!depto) return vacio;

  const nombreCiudad = (cfg.ciudad || '').trim();
  if (!nombreCiudad) return { departamentoId: depto.id, municipioId: null };

  const [[muni]] = await pool.query(
    `SELECT t.id FROM ${CATALOGO}.ctc_territorios t
      WHERE t.padre_id = ? AND t.nivel_id = ? AND t.estado = 'ACTIVO'
        AND (t.nombre = ? OR EXISTS (SELECT 1 FROM ${CATALOGO}.ctc_alias a
                                      WHERE a.territorio_id = t.id AND a.alias = ?))
      LIMIT 1`,
    [depto.id, NIVEL_MUNICIPIO, nombreCiudad, nombreCiudad]
  );
  return { departamentoId: depto.id, municipioId: muni ? muni.id : null };
}

/**
 * Lista de candidatos a mostrar en el formulario de reporte y en el
 * tablero: el candidato propio (el de Configuración → Datos de la
 * campaña) SIEMPRE va de primero, así el admin no lo haya agregado
 * también en Configuración → Día D → Candidatos. El resto queda en el
 * mismo orden de ingreso en que se configuraron.
 */
/* RECIBE `req`, Y NO LO RECIBIA. Al separar las listas por campana se le metio
   aqui dentro un `duenoDeLaCampana(req)` sin darse cuenta de que esto es una
   FUNCION AUXILIAR y no un manejador de ruta: `req` no existia en su ambito.
   Resultado, un ReferenceError que tumbaba /resumen-candidatos con un 500, y
   con el el tablero entero del Dia D — todas las tarjetas en blanco, como si
   se hubiera perdido la jornada. No se perdio nada: la pantalla no podia
   pintarse. Los dos llamadores son rutas y tienen `req` a mano. */
async function obtenerCandidatosParaReporte(req) {
  const [[campana]] = await pool.query(`SELECT nombre_candidato FROM configuracion_campana WHERE id = 1`);
  const [configurados] = await pool.query(
      `SELECT nombre FROM dia_d_candidatos WHERE aspirante_id = ? ORDER BY id ASC`, [await duenoDeLaCampana(req)]);

  const nombrePropio = (campana && campana.nombre_candidato || '').trim();
  const resto = configurados
    .map(c => c.nombre)
    .filter(nombre => nombre.trim().toLowerCase() !== nombrePropio.toLowerCase());

  return nombrePropio ? [nombrePropio, ...resto] : resto;
}

/**
 * Datos de votación que ya quedaron guardados en la ficha del testigo al
 * crearlo (ver "+ Testigo electoral" en Estructura territorial) — el
 * formulario de reporte los usa para autocompletar Puesto y Mesa, así el
 * testigo no tiene que volver a escribirlos cada vez que reporta. Si es
 * Coordinador de puesto (tipo_testigo='puesto'), también trae la lista de
 * mesas que tiene asignadas (mesas_asignadas), para que el formulario le
 * muestre casillas de verificación en vez de autocompletar una sola mesa.
 */
router.get('/mi-lugar-votacion', async (req, res) => {
  try {
    // El puesto/mesa donde VIGILA está en "estructura" si la persona tiene
    // otro cargo además del de testigo (así no se le pisa su lugar de
    // votación real), o en "usuarios" si es un testigo puro. Se prefiere
    // el de estructura: es el que corresponde a esta capacidad.
    const [[usuario]] = await pool.query(
      `SELECT COALESCE(e.departamento_votacion, u.departamento_votacion) AS departamento_votacion,
              COALESCE(e.municipio_votacion, u.municipio_votacion)       AS municipio_votacion,
              COALESCE(e.puesto_votacion, u.puesto_votacion)             AS puesto_votacion,
              COALESCE(e.mesa_votacion, u.mesa_votacion)                 AS mesa_votacion,
              -- Campo nuevo. Agregarlo a un objeto que ya se devolvía es
              -- compatible: quien no lo espere sigue leyendo lo mismo.
              COALESCE(e.puesto_id, u.puesto_id)                         AS puesto_id,
              e.tipo_testigo, e.mesas_asignadas
       FROM usuarios u
       LEFT JOIN estructura e ON e.usuario_id = u.id AND e.cargo = 'testigo'
       WHERE u.id = ?`,
      [req.session.usuario.id]
    );
    res.json(usuario || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando tu lugar de votación.' });
  }
});

/** Candidatos a mostrar en el formulario de reporte (candidato propio primero, luego el resto configurado en Día D). */
router.get('/candidatos-para-reporte', async (req, res) => {
  try {
    const nombres = await obtenerCandidatosParaReporte(req);
    res.json(nombres);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando los candidatos.' });
  }
});

/**
 * Nombres de los puestos configurados en Configuración → Día D, para la
 * lista desplegable con autollenado del formulario de reporte.
 *
 * Con `?municipio=<nombre>` devuelve solo los de ese municipio. Hace falta
 * en campañas departamentales, donde la campaña cubre cientos de puestos de
 * doce municipios distintos y ofrecerlos todos al asignar un testigo no
 * orienta a nadie.
 *
 * **La respuesta sigue siendo un arreglo de nombres, con o sin el
 * parámetro.** No se cambió la forma a propósito: este mismo endpoint lo
 * cachea la app del celular para trabajar sin conexión, y devolver objetos
 * habría roto esa caché en los teléfonos que ya la tienen guardada.
 *
 * Los puestos creados a mano (sin `ctc_puesto_id`) no se pueden atribuir a
 * ningún municipio, así que aparecen siempre: esconderlos borraría de la
 * lista puestos reales que quizá ya tienen testigos asignados.
 */
router.get('/puestos-para-reporte', async (req, res) => {
  const municipio = (req.query.municipio || '').trim();
  // `?con_id=1` devuelve [{id, nombre}] en vez del arreglo de nombres.
  //
  // **La forma por omisión NO cambia, y es a propósito.** Los tres
  // desplegables que consumen este endpoint hacen `.map(p => ...)` tratando
  // cada elemento como texto; devolver objetos les pondría "[object
  // Object]" en pantalla. Y el móvil guarda esta respuesta en su caché para
  // trabajar sin señal: un teléfono que no se haya recargado sigue teniendo
  // la forma vieja guardada. Cambiarla aquí rompería a los dos a la vez.
  const conId = req.query.con_id === '1';
  const columnas = conId ? 'id, nombre' : 'nombre';
  const formatear = (filas) => (conId ? filas : filas.map(f => f.nombre));
  try {
    if (!municipio) {
      const [filas] = await pool.query(
        `SELECT ${columnas} FROM dia_d_puestos_votacion WHERE aspirante_id = ? ORDER BY nombre`,
        [await duenoDeLaCampana(req)]);
      return res.json(formatear(filas));
    }
    // La comparación va con la colación de la base, que ignora mayúsculas y
    // tildes: el nombre llega del mismo catálogo, pero tecleado a mano
    // puede venir sin tilde.
    const [filas] = await pool.query(
      `SELECT ${conId ? 'p.id, p.nombre' : 'p.nombre'}
         FROM dia_d_puestos_votacion p
         LEFT JOIN territoriosdb.ctc_puestos_votacion cp ON cp.id = p.ctc_puesto_id
         LEFT JOIN territoriosdb.ctc_territorios m ON m.id = cp.municipio_id
        WHERE p.aspirante_id = ? AND (p.ctc_puesto_id IS NULL OR m.nombre = ?)
        ORDER BY p.nombre`, [await duenoDeLaCampana(req), municipio]);
    res.json(formatear(filas));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando los puestos de votación.' });
  }
});

/**
 * Igual que /puestos-para-reporte, pero con la cantidad de mesas de cada
 * puesto incluida — usado en el registro de Votante/Sublíder de la app de
 * celular para armar el desplegable de Mesa (1..cantidad) sin depender de
 * una consulta aparte por cada puesto elegido: como el número de mesa de
 * un Votante es solo el lugar donde vota (no hay que evitar choques con
 * otros testigos, a diferencia de /mesas-ocupadas), basta con la cantidad
 * configurada — se puede cachear entero y usar sin conexión.
 */
router.get('/puestos-con-mesas', async (req, res) => {
  try {
    // Se agrega `id` al objeto que ya se devolvía. Agregar un campo sí es
    // compatible: los consumidores leen `.nombre` y `.cantidad_mesas` y no
    // se enteran del resto — incluidos los que tengan la respuesta vieja
    // guardada en la caché del teléfono.
    const [filas] = await pool.query(
      `SELECT id, nombre, cantidad_mesas FROM dia_d_puestos_votacion WHERE aspirante_id = ? ORDER BY nombre`,
      [await duenoDeLaCampana(req)]);
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando los puestos de votación.' });
  }
});

/**
 * Para el selector de Mesa al crear/editar un Testigo electoral o
 * Coordinador de puesto (ver testigos.html, territorial.html y
 * votantes.html): con base en la cantidad de mesas configurada para el
 * puesto (Configuración → Día D → Puestos de votación) y las mesas que ya
 * tiene tomadas OTRO testigo de ese mismo puesto (una sola, si es tipo
 * "mesa"; varias, si es tipo "puesto"), calcula cuáles quedan libres. Sin
 * restricción de rol: lo usan tanto admin/coordinador como líderes desde
 * Votantes y sublíderes.
 */
router.get('/mesas-ocupadas', async (req, res) => {
  const puesto = String(req.query.puesto || '').trim();
  // `?puesto_id=` es la forma nueva y directa. `?puesto=<nombre>` se
  // conserva porque es lo que manda el cliente de hoy, y porque un teléfono
  // sin señal puede tener guardada una lista de puestos sin ids.
  const puestoIdPedido = Number(req.query.puesto_id) || 0;
  const excluirEstructuraId = Number(req.query.excluir_estructura_id) || 0;
  if (!puesto && !puestoIdPedido) return res.json({ cantidadMesas: 0, mesasOcupadas: [], mesasDisponibles: [] });
  try {
    // Se resuelve el nombre a id UNA vez y se cruza por id. Comparar dos
    // textos aqui obliga a que usuarios.puesto_votacion y
    // dia_d_puestos_votacion.nombre coincidan caracter por caracter para
    // siempre; el id no depende de eso. usuarios.puesto_id lo mantiene al
    // dia un disparador (ver puesto_id_sincronizado.sql en el CTC).
    const [[config]] = puestoIdPedido
      ? await pool.query(`SELECT id, cantidad_mesas FROM dia_d_puestos_votacion WHERE id = ? AND aspirante_id = ?`, [puestoIdPedido, await duenoDeLaCampana(req)])
      : await pool.query(`SELECT id, cantidad_mesas FROM dia_d_puestos_votacion WHERE nombre = ? AND aspirante_id = ?`, [puesto, await duenoDeLaCampana(req)]);
    const cantidadMesas = config ? config.cantidad_mesas : 0;
    const puestoId = config ? config.id : null;

    // Sin puesto resuelto se corta antes: `puesto_id = NULL` no devuelve
    // filas, y el endpoint diria que TODAS las mesas estan libres -- dos
    // testigos podrian quedar en la misma.
    //
    // COALESCE: el puesto/mesa del testigo vive en "estructura" cuando la
    // persona tiene otro cargo ademas (asi no se le pisa su lugar de
    // votacion real) y en "usuarios" cuando es testigo puro.
    let filas = [];
    if (puestoId !== null) {
      [filas] = await pool.query(
        `SELECT e.tipo_testigo,
                COALESCE(e.mesa_votacion, u.mesa_votacion) AS mesa_votacion,
                e.mesas_asignadas
         FROM estructura e JOIN usuarios u ON u.id = e.usuario_id
         WHERE e.cargo = 'testigo' AND COALESCE(e.puesto_id, u.puesto_id) = ? AND e.id != ?`,
        [puestoId, excluirEstructuraId]
      );
    }
    const ocupadas = new Set();
    for (const f of filas) {
      if (f.tipo_testigo === 'puesto') {
        (f.mesas_asignadas || []).forEach(m => ocupadas.add(Number(m)));
      } else if (f.mesa_votacion) {
        ocupadas.add(Number(f.mesa_votacion));
      }
    }
    const todas = Array.from({ length: cantidadMesas }, (_, i) => i + 1);
    res.json({
      cantidadMesas,
      mesasOcupadas: [...ocupadas].sort((a, b) => a - b),
      mesasDisponibles: todas.filter(m => !ocupadas.has(m))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando las mesas disponibles.' });
  }
});

/**
 * Un testigo reporta el conteo de su mesa — puede reportar varias veces
 * para la misma mesa a lo largo de la jornada (ej. un parcial a mediodía y
 * el conteo final al cierre); no se sobrescribe nada, cada envío queda
 * como una fila nueva y el tablero del equipo de campaña siempre muestra
 * el más reciente por mesa. Admin/coordinador también pueden reportar,
 * por si necesitan corregir o registrar algo a nombre de un testigo.
 * La foto del E-14 y el total de votantes de la mesa son obligatorios: son
 * el respaldo real del conteo, no un dato de relleno.
 */
// `fields` y no `single`: además del E-14 —que es UNO y obligatorio— el
// testigo puede fotografiar otros documentos (acta de escrutinio, una
// reclamación, la constancia de una novedad). El tope de 8 existe para que un
// dedo pegado al botón no llene el disco del servidor.
const MAX_DOCUMENTOS_REPORTE = 8;
router.post('/reportes', requireRole('testigo', 'admin', 'coordinador'),
  upload.fields([{ name: 'foto_e14', maxCount: 1 }, { name: 'documentos', maxCount: MAX_DOCUMENTOS_REPORTE }]),
  async (req, res) => {
  const b = req.body;

  // Reintento idempotente: el celular guarda el reporte cuando no hay señal
  // y lo reintenta solo más tarde — si el mismo envío llega dos veces, esto
  // evita duplicar el reporte (un testigo SÍ puede reportar la misma mesa
  // más de una vez a propósito — parcial y luego final — pero eso siempre
  // trae un cliente_uuid distinto; acá solo se ataja el reintento exacto
  // del mismo envío). Sin cliente_uuid sigue de largo como siempre.
  if (b.cliente_uuid) {
    try {
      const [[yaExiste]] = await pool.query(`SELECT id FROM dia_d_reportes WHERE cliente_uuid = ?`, [b.cliente_uuid]);
      if (yaExiste) {
        return res.json({ ok: true, id: yaExiste.id, yaExistia: true });
      }
    } catch (err) {
      console.error('Error verificando cliente_uuid (se sigue con el registro normal):', err);
    }
  }

  if (!b.puesto_votacion || !String(b.puesto_votacion).trim()) {
    return res.status(400).json({ error: 'El puesto de votación es obligatorio.' });
  }
  // El id es OPCIONAL a propósito, y no se puede volver obligatorio:
  //
  //  - un reporte encolado sin señal ANTES de esta versión llega DESPUÉS,
  //    y solo trae el texto. Rechazarlo lo perdería;
  //  - el testigo puede estar en un puesto que la siembra no incluyó, y
  //    para eso existe la salida de emergencia (puesto_fuera_de_lista).
  //
  // Si no viene el id, se intenta resolver del texto una sola vez, aquí.
  // Lo que se guarde queda fijo: el texto es la instantánea de ese día.
  let puestoId = Number(b.puesto_id) || null;
  if (!puestoId) {
    const [[hallado]] = await pool.query(
      `SELECT id FROM dia_d_puestos_votacion WHERE nombre = ? AND aspirante_id = ?`,
      [String(b.puesto_votacion).trim(), await duenoDeLaCampana(req)]);
    puestoId = hallado ? hallado.id : null;
  }
  // Se marca para revisión lo que no cruza con ningún puesto de la lista:
  // o el testigo usó la salida de emergencia, o el nombre viene de una
  // fuente vieja. En los dos casos alguien tiene que mirarlo.
  // Se compara contra los valores verdaderos EXPLÍCITAMENTE. El reporte
  // llega como multipart, así que todo es texto — y la cadena '0' es
  // *verdadera* en JavaScript. Un `b.puesto_fuera_de_lista ? 1 : 0` marcaba
  // para revisión hasta los reportes correctos, y la lista de revisión
  // habría quedado con todo adentro, que es igual a no tenerla.
  const marcadoPorElCliente = ['1', 1, true, 'true'].includes(b.puesto_fuera_de_lista);
  const fueraDeLista = puestoId === null ? 1 : (marcadoPorElCliente ? 1 : 0);
  if (!b.mesa_votacion || !String(b.mesa_votacion).trim()) {
    return res.status(400).json({ error: 'El número de mesa es obligatorio.' });
  }
  if (b.total_votantes_mesa === undefined || String(b.total_votantes_mesa).trim() === '') {
    return res.status(400).json({ error: 'El total de votantes en la mesa es obligatorio.' });
  }
  // Con `fields`, multer entrega req.files como un objeto por campo: el E-14
  // ya no está en req.file. Dejarlo así habría hecho que TODO reporte se
  // rechazara por "falta la foto" aunque viniera.
  const archivoE14 = req.files && req.files.foto_e14 && req.files.foto_e14[0];
  const archivosDocumentos = (req.files && req.files.documentos) || [];
  if (!archivoE14) {
    return res.status(400).json({ error: 'La foto del E-14 es obligatoria.' });
  }

  // Los votos viajan como un solo campo de texto con JSON adentro (el
  // formulario es multipart por la foto, así que no se puede mandar un
  // array anidado como campos sueltos): [{ nombre, votos }, ...], uno por
  // candidato mostrado en el formulario.
  let votosPorCandidato = [];
  if (b.votos_json) {
    try {
      votosPorCandidato = JSON.parse(b.votos_json);
    } catch (err) {
      return res.status(400).json({ error: 'Los votos por candidato llegaron en un formato inválido.' });
    }
  }
  if (!Array.isArray(votosPorCandidato) || !votosPorCandidato.length) {
    return res.status(400).json({ error: 'Debe reportar los votos de al menos un candidato.' });
  }
  for (const item of votosPorCandidato) {
    if (!item || !String(item.nombre || '').trim()) {
      return res.status(400).json({ error: 'Cada candidato reportado debe tener nombre.' });
    }
    if (item.votos === '' || item.votos === undefined || item.votos === null || !Number.isInteger(Number(item.votos)) || Number(item.votos) < 0) {
      return res.status(400).json({ error: `Los votos de "${item.nombre}" deben ser un número entero mayor o igual a 0.` });
    }
  }

  const fotoE14Url = `/uploads/${archivoE14.filename}`;
  // EL REPORTE Y SUS VOTOS SE GUARDAN JUNTOS O NO SE GUARDAN.
  //
  // Antes eran un INSERT del reporte y luego un INSERT suelto por candidato,
  // todos fuera de transacción. Si el proceso moría a mitad del bucle —o
  // fallaba un solo INSERT—, quedaba un reporte con VOTOS INCOMPLETOS: le
  // faltan candidatos, pero se ve igual de válido que cualquier otro. En el
  // conteo del Día D eso no es un error visible, es un resultado equivocado.
  //
  // Los votos van además en un solo INSERT de varias filas: menos viajes a
  // la base en el momento de más carga de la jornada.
  /* LA CONEXIÓN SE PIDE DENTRO DEL `try`. Fuera, si el pool está agotado o
     MySQL no responde, la promesa se rechaza donde no la ve ningún `catch`:
     Express 4 no envuelve los manejadores `async`, así que muere en el
     `unhandledRejection` de app.js, que solo la imprime. No se envía NINGUNA
     respuesta y el botón se queda girando hasta que corte Nginx. Antes de
     este cambio la consulta iba dentro del try y una base caída salía como un
     500 legible; había que conservarlo. */
  let conexion;
  try {
    conexion = await pool.getConnection();
    await conexion.beginTransaction();

    // votos_candidato se mantiene por compatibilidad con el resumen del
    // tablero: son los votos del candidato propio de la campaña dentro de
    // la lista que mandó el testigo (si no aparece ahí, queda en null).
    const [[campana]] = await conexion.query(`SELECT nombre_candidato FROM configuracion_campana WHERE id = 1`);
    const nombrePropio = (campana && campana.nombre_candidato || '').trim().toLowerCase();
    const votoPropio = votosPorCandidato.find(v => String(v.nombre).trim().toLowerCase() === nombrePropio);
    const votosCandidato = votoPropio ? Number(votoPropio.votos) : null;

    const [result] = await conexion.query(
      `INSERT INTO dia_d_reportes
       (testigo_id, departamento, municipio, puesto_votacion, puesto_id, puesto_fuera_de_lista, mesa_votacion, votos_candidato, total_votantes_mesa, novedad, foto_e14_url, cliente_uuid)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.session.usuario.id,
       b.departamento || null, b.municipio || null,
       String(b.puesto_votacion).trim(), puestoId, fueraDeLista, String(b.mesa_votacion).trim(),
       votosCandidato,
       b.total_votantes_mesa !== '' && b.total_votantes_mesa !== undefined ? Number(b.total_votantes_mesa) : null,
       b.novedad || null, fotoE14Url, b.cliente_uuid || null]
    );

    await conexion.query(
      `INSERT INTO dia_d_reporte_votos (reporte_id, candidato_nombre, votos) VALUES ?`,
      [votosPorCandidato.map(item => [result.insertId, String(item.nombre).trim(), Number(item.votos)])]
    );

    // Los otros documentos van en la MISMA transacción que el reporte, por lo
    // mismo que los votos: un reporte guardado a medias —con acta pero sin sus
    // anexos, o al revés— es peor que uno que no se guardó, porque nadie sabe
    // que falta algo.
    if (archivosDocumentos.length) {
      // La descripción de cada uno viaja en un campo paralelo, en el mismo
      // orden en que se subieron los archivos.
      const descripciones = (() => {
        try { return JSON.parse(b.documentos_descripciones || '[]'); } catch (_) { return []; }
      })();
      await conexion.query(
        `INSERT INTO dia_d_reporte_documentos (reporte_id, url, descripcion, orden) VALUES ?`,
        [archivosDocumentos.map((f, i) => [
          result.insertId,
          `/uploads/${f.filename}`,
          (descripciones[i] || '').toString().trim().slice(0, 150) || null,
          i + 1,
        ])]
      );
    }

    await conexion.commit();
    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    /* El rollback va protegido: si lo que falló fue la conexión misma —MySQL
       reiniciado, `wait_timeout`, un KILL— también lanza, y sin esto el
       `res.status(500)` de abajo no llegaría a ejecutarse nunca. */
    if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
    if (err.code === 'ER_DUP_ENTRY' && b.cliente_uuid) {
      const [[existente]] = await pool.query(`SELECT id FROM dia_d_reportes WHERE cliente_uuid = ?`, [b.cliente_uuid]).catch(() => [[null]]);
      if (existente) return res.json({ ok: true, id: existente.id, yaExistia: true });
    }
    console.error(err);
    res.status(500).json({ error: 'Error guardando el reporte.' });
  } finally {
    if (conexion) conexion.release();
  }
});

/** Historial de reportes ya enviados por el propio testigo — para que vea qué mesas ya reportó y pueda actualizar. */
router.get('/mis-reportes', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM dia_d_reportes WHERE testigo_id = ? ORDER BY created_at DESC`,
      [req.session.usuario.id]
    );
    if (rows.length) {
      const [votos] = await pool.query(
        `SELECT reporte_id, candidato_nombre, votos FROM dia_d_reporte_votos WHERE reporte_id IN (?)`,
        [rows.map(r => r.id)]
      );
      const votosPorReporte = new Map();
      votos.forEach(v => {
        if (!votosPorReporte.has(v.reporte_id)) votosPorReporte.set(v.reporte_id, []);
        votosPorReporte.get(v.reporte_id).push({ nombre: v.candidato_nombre, votos: v.votos });
      });
      rows.forEach(r => { r.votos_por_candidato = votosPorReporte.get(r.id) || []; });

      // Los otros documentos, en una sola consulta para todos los reportes:
      // uno por reporte convertiria un listado de 50 en 51 viajes a la base.
      const [docs] = await pool.query(
        `SELECT reporte_id, url, descripcion FROM dia_d_reporte_documentos
          WHERE reporte_id IN (?) ORDER BY reporte_id, orden`,
        [rows.map(r => r.id)]
      );
      const docsPorReporte = new Map();
      docs.forEach(d => {
        if (!docsPorReporte.has(d.reporte_id)) docsPorReporte.set(d.reporte_id, []);
        docsPorReporte.get(d.reporte_id).push({ url: d.url, descripcion: d.descripcion });
      });
      rows.forEach(r => { r.documentos = docsPorReporte.get(r.id) || []; });
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando tus reportes.' });
  }
});

/**
 * Tablero del equipo de campaña: el reporte MÁS RECIENTE de cada mesa
 * (no la suma de todos los envíos de esa mesa, para no contar dos veces un
 * parcial y su corrección posterior), más el listado completo para ver el
 * historial de cada una si hace falta revisar algo.
 */
router.get('/reportes', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  try {
    const aDentro = await acotaJornada(req, 'testigo_id');
    const aFuera  = await acotaJornada(req, 'r.testigo_id');
    const [ultimosPorMesa] = await pool.query(`
      SELECT r.*, u.nombre AS testigo_nombre,
        (SELECT COALESCE(SUM(v.votos), 0) FROM dia_d_reporte_votos v WHERE v.reporte_id = r.id) AS total_votos_mesa
      FROM dia_d_reportes r
      JOIN usuarios u ON u.id = r.testigo_id
      INNER JOIN (
        -- Se agrupa por el ID del puesto, no por su nombre. El nombre es la
        -- instantánea de ese día: si el puesto se renombra, dos reportes de
        -- la MISMA mesa quedarían en grupos distintos y el panel mostraría
        -- las dos versiones como si fueran mesas diferentes.
        --
        -- COALESCE con el texto para el reporte hecho desde un puesto fuera
        -- de la lista (salida de emergencia): ahí no hay id, y agrupar por
        -- NULL juntaría en uno solo todos los de puestos distintos.
        SELECT COALESCE(CAST(puesto_id AS CHAR), puesto_votacion) AS clave_puesto,
               mesa_votacion, MAX(id) AS ultimo_id
        FROM dia_d_reportes
        ${aDentro ? 'WHERE ' + aDentro.sql : ''}
        GROUP BY clave_puesto, mesa_votacion
      ) mas_reciente ON mas_reciente.ultimo_id = r.id
      ${aFuera ? 'WHERE ' + aFuera.sql : ''}
      ORDER BY r.created_at DESC
    `, [...(aDentro ? aDentro.valores : []), ...(aFuera ? aFuera.valores : [])]);
    const [historialCompleto] = await pool.query(`
      SELECT r.*, u.nombre AS testigo_nombre
      FROM dia_d_reportes r
      JOIN usuarios u ON u.id = r.testigo_id
      ${aFuera ? 'WHERE ' + aFuera.sql : ''}
      ORDER BY r.created_at DESC
      LIMIT 300
    `, aFuera ? aFuera.valores : []);
    // Los otros documentos de TODOS los reportes de las dos tablas, en una
    // sola consulta. Pedirlos por reporte convertiria este tablero —que se
    // recarga solo durante la jornada— en decenas de viajes a la base.
    const idsReportes = [...new Set([...ultimosPorMesa, ...historialCompleto].map(r => r.id))];
    if (idsReportes.length) {
      const [docs] = await pool.query(
        `SELECT reporte_id, url, descripcion FROM dia_d_reporte_documentos
          WHERE reporte_id IN (?) ORDER BY reporte_id, orden`, [idsReportes]);
      const porReporte = new Map();
      docs.forEach(d => {
        if (!porReporte.has(d.reporte_id)) porReporte.set(d.reporte_id, []);
        porReporte.get(d.reporte_id).push({ url: d.url, descripcion: d.descripcion });
      });
      [...ultimosPorMesa, ...historialCompleto].forEach(r => { r.documentos = porReporte.get(r.id) || []; });
    }

    res.json({ mesas: ultimosPorMesa, historial: historialCompleto });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando los reportes del Día D.' });
  }
});

/** Consolidado para las tarjetas del tablero — usa el mismo criterio de "reporte más reciente por mesa" que /reportes. */
router.get('/resumen', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  try {
    const aDentro = await acotaJornada(req, 'testigo_id');
    const aFuera  = await acotaJornada(req, 'r.testigo_id');
    const [[resumen]] = await pool.query(`
      SELECT
        COUNT(*) AS mesas_reportando,
        COALESCE(SUM(votos_candidato), 0) AS total_votos_candidato,
        COALESCE(SUM(total_votantes_mesa), 0) AS total_votantes,
        SUM(CASE WHEN novedad IS NOT NULL AND novedad != '' THEN 1 ELSE 0 END) AS mesas_con_novedad
      FROM dia_d_reportes r
      INNER JOIN (
        -- Se agrupa por el ID del puesto, no por su nombre. El nombre es la
        -- instantánea de ese día: si el puesto se renombra, dos reportes de
        -- la MISMA mesa quedarían en grupos distintos y el panel mostraría
        -- las dos versiones como si fueran mesas diferentes.
        --
        -- COALESCE con el texto para el reporte hecho desde un puesto fuera
        -- de la lista (salida de emergencia): ahí no hay id, y agrupar por
        -- NULL juntaría en uno solo todos los de puestos distintos.
        SELECT COALESCE(CAST(puesto_id AS CHAR), puesto_votacion) AS clave_puesto,
               mesa_votacion, MAX(id) AS ultimo_id
        FROM dia_d_reportes
        ${aDentro ? 'WHERE ' + aDentro.sql : ''}
        GROUP BY clave_puesto, mesa_votacion
      ) mas_reciente ON mas_reciente.ultimo_id = r.id
      ${aFuera ? 'WHERE ' + aFuera.sql : ''}
    `, [...(aDentro ? aDentro.valores : []), ...(aFuera ? aFuera.valores : [])]);
    // Total de mesas de la jornada: la suma de "Cantidad de mesas" de todos
    // los puestos configurados en Configuración → Día D → Puestos de
    // votación — es la referencia contra la que se mide qué tanto se ha
    // reportado, no una cuenta de reportes.
    const [[{ total_mesas: totalMesas }]] = await pool.query(
      `SELECT COALESCE(SUM(cantidad_mesas), 0) AS total_mesas FROM dia_d_puestos_votacion WHERE aspirante_id = ?`,
      [await duenoDeLaCampana(req)]);
    res.json({
      mesasReportando: resumen.mesas_reportando,
      totalMesas: Number(totalMesas),
      totalVotosCandidato: Number(resumen.total_votos_candidato),
      totalVotantes: Number(resumen.total_votantes),
      mesasConNovedad: Number(resumen.mesas_con_novedad)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generando el resumen del Día D.' });
  }
});

/**
 * Votos totales por candidato, para el gráfico de barras y su tabla en el
 * tablero del Día D. Usa el mismo criterio de "reporte más reciente por
 * mesa" que /reportes y /resumen, para no contar dos veces un parcial y su
 * corrección posterior. Incluye a TODOS los candidatos configurados aunque
 * todavía no tengan ningún voto reportado (aparecen con 0), y siempre deja
 * de primero al candidato propio de la campaña.
 */
router.get('/resumen-candidatos', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  try {
    const aDentro = await acotaJornada(req, 'testigo_id');
    const aFuera  = await acotaJornada(req, 'r.testigo_id');
    const nombresCandidatos = await obtenerCandidatosParaReporte(req);
    const [[campana]] = await pool.query(`SELECT nombre_candidato FROM configuracion_campana WHERE id = 1`);
    const nombrePropio = (campana && campana.nombre_candidato || '').trim();

    const [filas] = await pool.query(`
      SELECT v.candidato_nombre, COALESCE(SUM(v.votos), 0) AS votos
      FROM dia_d_reporte_votos v
      INNER JOIN (
        SELECT r.id
        FROM dia_d_reportes r
        INNER JOIN (
          -- Misma regla que arriba: se agrupa por id, con el texto como
          -- respaldo para los de la salida de emergencia.
          SELECT COALESCE(CAST(puesto_id AS CHAR), puesto_votacion) AS clave_puesto,
                 mesa_votacion, MAX(id) AS ultimo_id
          FROM dia_d_reportes
          ${aDentro ? 'WHERE ' + aDentro.sql : ''}
          GROUP BY clave_puesto, mesa_votacion
        ) mas_reciente ON mas_reciente.ultimo_id = r.id
        ${aFuera ? 'WHERE ' + aFuera.sql : ''}
      ) reportes_vigentes ON reportes_vigentes.id = v.reporte_id
      GROUP BY v.candidato_nombre
    `, [...(aDentro ? aDentro.valores : []), ...(aFuera ? aFuera.valores : [])]);

    const votosPorNombre = new Map();
    filas.forEach(f => votosPorNombre.set(f.candidato_nombre.trim().toLowerCase(), Number(f.votos)));

    const resultado = nombresCandidatos.map(nombre => ({
      nombre,
      votos: votosPorNombre.get(nombre.trim().toLowerCase()) || 0,
      esPropio: !!nombrePropio && nombre.trim().toLowerCase() === nombrePropio.toLowerCase()
    }));

    const propio = resultado.filter(r => r.esPropio);
    const resto = resultado.filter(r => !r.esPropio).sort((a, b) => b.votos - a.votos);

    res.json([...propio, ...resto]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generando el resumen por candidato.' });
  }
});

/** Elimina un solo reporte — pide contraseña de administrador, como cualquier borrado en esta app. */
router.delete('/reportes/:id', requireRole('admin'), async (req, res) => {
  const autorizado = await verificarPasswordAdmin(req.body && req.body.password);
  if (!autorizado) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }
  /* QUEDA CONSTANCIA, Y AQUÍ EL DATO NO SE PUEDE VOLVER A PEDIR.
     Un reporte del Día D es el conteo de una mesa en el momento en que se
     cerró: el testigo lo mandó desde el puesto y esa mesa no se vuelve a
     abrir. A diferencia de un votante o un evento, no hay forma de recoger el
     dato otra vez. Por eso el apunte guarda los números —votos y total de la
     mesa— y no solo el identificador: es lo más cerca de una copia que se
     puede dejar.

     Si había foto del E-14, se dice. El archivo sigue en `uploads/` después
     del borrado, así que saber que existía es saber que aún se puede
     recuperar la cifra. */
  /* LA CONEXIÓN SE PIDE DENTRO DEL `try`. Fuera, si el pool está agotado o
     MySQL no responde, la promesa se rechaza donde no la ve ningún `catch`:
     Express 4 no envuelve los manejadores `async`, así que muere en el
     `unhandledRejection` de app.js, que solo la imprime. No se envía NINGUNA
     respuesta y el botón se queda girando hasta que corte Nginx. Antes de
     este cambio la consulta iba dentro del try y una base caída salía como un
     500 legible; había que conservarlo. */
  let conexion;
  try {
    conexion = await pool.getConnection();
    await conexion.beginTransaction();
    const [[rep]] = await conexion.query(
      `SELECT r.id, r.puesto_votacion, r.mesa_votacion, r.municipio,
              r.total_votantes_mesa, r.novedad, r.foto_e14_url,
              u.nombre AS testigo
         FROM dia_d_reportes r
         LEFT JOIN usuarios u ON u.id = r.testigo_id
        WHERE r.id = ?`, [req.params.id]);
    /* LOS VOTOS ESTÁN EN OTRA TABLA, y esta es la que el borrado se lleva por
       cascada. `dia_d_reportes.votos_candidato` guarda SOLO los votos del
       candidato propio, y queda NULL cuando el nombre del reporte no cruza con
       `configuracion_campana.nombre_candidato` —una comparación de texto libre
       en minúsculas—. Comprobado en la base desplegada: `nombre_candidato` es
       NULL, así que HOY todos los reportes tienen `votos_candidato` NULL.

       Apuntar esa columna habría escrito «0 votos» en el momento exacto en que
       desaparecen los votos de todos los candidatos de esa mesa. El desglose
       real vive en `dia_d_reporte_votos`, se va con el reporte, y es lo que
       hay que copiar al apunte. */
    const [votosPorCandidato] = await conexion.query(
      `SELECT candidato_nombre, votos FROM dia_d_reporte_votos
        WHERE reporte_id = ? ORDER BY votos DESC, candidato_nombre`, [req.params.id]);
    if (!rep) {
      await conexion.rollback();
      return res.status(404).json({ error: 'No encontrado.' });
    }

    const detalle = `Eliminó el reporte del Día D de la mesa ${rep.mesa_votacion} del puesto ${rep.puesto_votacion}`
      + (rep.municipio ? ` (${rep.municipio})` : '')
      + '. '
      + (votosPorCandidato.length
          ? `Reportaba ${votosPorCandidato.map(v => `${v.candidato_nombre}: ${v.votos}`).join(', ')}`
          : 'No traía votos por candidato')
      + (rep.total_votantes_mesa !== null ? `, sobre ${rep.total_votantes_mesa} votantes de la mesa` : '')
      + '.'
      + (rep.testigo ? ` Lo había enviado ${rep.testigo}.` : '')
      + (rep.novedad ? ` Tenía anotada una novedad.` : '')
      + (rep.foto_e14_url ? ` Tenía foto del E-14 (${rep.foto_e14_url}), que no se borra con el reporte.` : ' No tenía foto del E-14.')
      + ` El identificador era ${rep.id}.`;

    await registrarAuditoriaEn(
      conexion, req.session.usuario.id, 'eliminar_reporte', 'dia_d_reportes', rep.id,
      detalle, req.ip
    );

    const [resultado] = await conexion.query(`DELETE FROM dia_d_reportes WHERE id = ?`, [req.params.id]);
    if (resultado.affectedRows === 0) {
      await conexion.rollback();
      return res.status(404).json({ error: 'No encontrado.' });
    }
    await conexion.commit();
    res.json({ ok: true });
  } catch (err) {
    /* El rollback va protegido: si lo que falló fue la conexión misma —MySQL
       reiniciado, `wait_timeout`, un KILL— también lanza, y sin esto el
       `res.status(500)` de abajo no llegaría a ejecutarse nunca. */
    if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
    console.error(err);
    res.status(500).json({ error: 'Error eliminando el reporte.' });
  } finally {
    if (conexion) conexion.release();
  }
});

/** Elimina TODOS los reportes del Día D — pide contraseña de administrador. */
router.post('/reportes/eliminar-todo', requireRole('admin', 'aspirante'), async (req, res) => {
  const autorizado = await verificarPasswordAdmin(req.body && req.body.password);
  if (!autorizado) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }
  /* SE GUARDAN LOS TOTALES, no solo cuántas filas eran. Con los reportes
     borrados nadie puede volver a sumar, así que el apunte conserva el conteo
     agregado: es lo único que quedaría de una jornada electoral entera si
     alguien pulsa esto por error. Cabe de sobra en `detalle`. */
  /* LA CONEXIÓN SE PIDE DENTRO DEL `try`. Fuera, si el pool está agotado o
     MySQL no responde, la promesa se rechaza donde no la ve ningún `catch`:
     Express 4 no envuelve los manejadores `async`, así que muere en el
     `unhandledRejection` de app.js, que solo la imprime. No se envía NINGUNA
     respuesta y el botón se queda girando hasta que corte Nginx. Antes de
     este cambio la consulta iba dentro del try y una base caída salía como un
     500 legible; había que conservarlo. */
  let conexion;
  try {
    conexion = await pool.getConnection();
    await conexion.beginTransaction();
    /* CADA CAMPANA BORRA LA SUYA. Este boton arrasaba con `DELETE FROM
       dia_d_reportes` a secas: con la jornada ya separada, el aspirante
       limpiando su prueba se habria llevado por delante los reportes de la
       campana madre, y ella los de el. Se recogen los `id` y se borra POR
       ESOS, no repitiendo la condicion, para que lo que se audita y lo que se
       borra no puedan discrepar — el apunte dice cuantos eran y como se
       repartian los votos, y es lo unico que queda despues. */
    const acota = await acotaJornada(req, 'testigo_id');
    const [aBorrar] = await conexion.query(
      `SELECT id FROM dia_d_reportes ${acota ? 'WHERE ' + acota.sql : ''}`,
      acota ? acota.valores : []);
    const ids = aBorrar.map(f => f.id);
    const [[t]] = ids.length ? await conexion.query(
      `SELECT COUNT(*) AS reportes, COUNT(DISTINCT testigo_id) AS testigos,
              COUNT(DISTINCT puesto_votacion) AS puestos,
              COALESCE(SUM(total_votantes_mesa), 0) AS votantes,
              (SELECT COALESCE(SUM(votos), 0) FROM dia_d_reporte_votos WHERE reporte_id IN (?)) AS votos
         FROM dia_d_reportes WHERE id IN (?)`, [ids, ids])
      : [[{ reportes: 0, testigos: 0, puestos: 0, votantes: 0, votos: 0 }]];
    /* EL DESGLOSE POR CANDIDATO, no solo el total. Borrar todos los reportes
       vacía también `dia_d_reporte_votos` en cascada; si el apunte guarda una
       sola cifra, no queda forma de saber cómo se repartía. Son unos pocos
       candidatos, así que cabe de sobra. */
    const [porCandidato] = ids.length ? await conexion.query(
      `SELECT candidato_nombre, SUM(votos) AS votos FROM dia_d_reporte_votos
        WHERE reporte_id IN (?)
        GROUP BY candidato_nombre ORDER BY votos DESC`, [ids]) : [[]];

    const detalle = t.reportes === 0
      ? 'Pulsó eliminar todos los reportes del Día D, pero no había ninguno.'
      : (t.reportes === 1
          ? 'Eliminó el único reporte del Día D que había'
          : `Eliminó de un golpe los ${t.reportes} reportes del Día D`)
        + `, ${t.reportes === 1 ? 'enviado' : 'enviados'} por ${t.testigos} ${t.testigos === 1 ? 'testigo' : 'testigos'} desde ${t.puestos} ${t.puestos === 1 ? 'puesto' : 'puestos'}.`
        + ` ${t.reportes === 1 ? 'Sumaba' : 'Sumaban'} ${t.votos} votos sobre ${t.votantes} votantes de mesa.`
        + (porCandidato.length
            ? ` El reparto era: ${porCandidato.map(c => `${c.candidato_nombre} ${c.votos}`).join(', ')}.`
            : '');

    await registrarAuditoriaEn(
      conexion, req.session.usuario.id, 'eliminar_masivo', 'dia_d_reportes', null,
      detalle, req.ip
    );

    if (ids.length) await conexion.query(`DELETE FROM dia_d_reportes WHERE id IN (?)`, [ids]);
    await conexion.commit();
    res.json({ ok: true });
  } catch (err) {
    /* El rollback va protegido: si lo que falló fue la conexión misma —MySQL
       reiniciado, `wait_timeout`, un KILL— también lanza, y sin esto el
       `res.status(500)` de abajo no llegaría a ejecutarse nunca. */
    if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
    console.error(err);
    res.status(500).json({ error: 'Error eliminando los reportes.' });
  } finally {
    if (conexion) conexion.release();
  }
});

// ===================================================================
// Configuración del Día D (Puestos de votación y Candidatos) — datos de
// referencia que el equipo de campaña arma ANTES de la jornada electoral,
// para que el formulario de reporte del testigo tenga opciones consistentes
// (evita que cada testigo escriba el mismo puesto con nombres distintos).
// Reservado a admin, igual que el resto de la pestaña Configuración.
// ===================================================================

// El testigo no queda ligado por FK al puesto (usuarios.puesto_votacion es
// texto libre), así que el cálculo se hace comparando ese texto contra el
// nombre del puesto — por eso importa mantener los nombres consistentes
// (de ahí que el testigo elija el puesto de una lista desplegable en vez
// de escribirlo a mano).
/* EL ASPIRANTE LEE LOS PUESTOS, PERO NO LOS TOCA.
   Los necesita para decir dónde va cada testigo suyo, y no son un dato de la
   campaña madre: son los puestos del municipio, sembrados desde el catálogo.
   Las rutas que CREAN, EDITAN o BORRAN puestos siguen siendo sólo de admin —
   ahí sí estaría modificando la configuración de la campaña que lo aloja. */
router.get('/config/puestos-votacion', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  try {
    // La lista se recorta al ámbito declarado en Configuración → Datos de
    // la campaña: solo Departamento, o Departamento + Ciudad si también se
    // eligió ciudad.
    //
    // SIN ÁMBITO NO SE LISTA NADA. Mostrar los puestos de todo el país
    // (12.885) a alguien que todavía no dijo dónde trabaja no le sirve de
    // nada y sí lo confunde: la lista se llena de sitios ajenos y la
    // asignación de testigos deja de tener sentido. La pantalla explica
    // que primero hay que elegir Departamento.
    //
    // Los puestos SIN `ctc_puesto_id` (escritos a mano antes de existir el
    // catálogo) se muestran siempre que haya ámbito: son datos reales, con
    // testigos ya asignados, y esconderlos sería peor que mostrar de más.
    // El frontend los marca como "sin catalogar" para poder re-vincularlos.
    // Se devuelve un arreglo vacío, no un objeto: testigos.html también
    // consume esta ruta y espera siempre una lista.
    const { departamentoId, municipioId: municipioAmbito } = await ambitoDeLaCampana();
    if (!departamentoId) return res.json([]);

    // Filtro opcional por municipio, para campañas que cubren varios.
    // El municipio pedido SIEMPRE se valida contra el departamento del
    // ámbito: si no, bastaría cambiar el número en la dirección para
    // listar puestos de otra parte del país.
    const municipioPedido = Number(req.query.municipio_id) || 0;
    const municipioId = municipioAmbito || municipioPedido;

    // Los puestos sin ctc_puesto_id (escritos a mano) se muestran solo
    // cuando no se está filtrando por un municipio puntual: ahí el filtro
    // es una búsqueda concreta y colarlos sería ruido.
    /* CADA CAMPANA VE SU LISTA. Sin esto el aspirante veia los puestos de la
       campana madre, que es justo lo que middleware/auth.js advierte que pasa
       cuando una ruta admite 'aspirante' y no filtra por su rama. */
    const dueno = await duenoDeLaCampana(req);
    let filtroSql;
    const params = [dueno];
    if (municipioId) {
      const incluirSinCatalogar = municipioPedido ? '' : 'p.ctc_puesto_id IS NULL OR ';
      filtroSql = `WHERE p.aspirante_id = ? AND (${incluirSinCatalogar}EXISTS (
        SELECT 1 FROM ${CATALOGO}.ctc_puestos_votacion cp
          JOIN ${CATALOGO}.ctc_territorios m ON m.id = cp.municipio_id
         WHERE cp.id = p.ctc_puesto_id AND cp.municipio_id = ? AND m.padre_id = ?))`;
      params.push(municipioId, departamentoId);
    } else {
      filtroSql = `WHERE p.aspirante_id = ? AND (p.ctc_puesto_id IS NULL OR EXISTS (
        SELECT 1 FROM ${CATALOGO}.ctc_puestos_votacion cp
          JOIN ${CATALOGO}.ctc_territorios m ON m.id = cp.municipio_id
         WHERE cp.id = p.ctc_puesto_id AND m.padre_id = ?))`;
      params.push(departamentoId);
    }
    const [puestos] = await pool.query(
      `SELECT p.* FROM dia_d_puestos_votacion p ${filtroSql} ORDER BY p.nombre`, params);

    // "Mesas con testigo asignado" cuenta MESAS, no personas: un Testigo
    // electoral aporta su propia mesa; un Coordinador de puesto aporta
    // todas las que tenga en mesas_asignadas — de ahí que no baste con
    // contar filas de Estructura como antes (un solo Coordinador de puesto
    // con 5 mesas debe sumar 5, no 1).
    /* Y SOLO CUENTAN LOS TESTIGOS DE ESTA CAMPANA. Esta consulta no filtraba
       por rama, asi que la columna "mesas con testigos asignados" de la
       principal sumaba tambien los testigos del aspirante — y al reves. Con
       las dos listas ya separadas, seguir contando en comun daria a las dos
       campanas una mesa por cubierta que ninguna cubre. */
    const acotaTestigos = dueno
      ? subarbolSql(dueno, 'e.usuario_id')
      : await filtroTestigosMadre(pool, 'e.usuario_id');
    const [testigos] = await pool.query(`
      SELECT COALESCE(e.puesto_votacion, u.puesto_votacion) AS puesto_votacion,
             e.tipo_testigo,
             COALESCE(e.mesa_votacion, u.mesa_votacion) AS mesa_votacion,
             e.mesas_asignadas
      FROM estructura e JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.cargo = 'testigo'
        AND COALESCE(e.puesto_votacion, u.puesto_votacion) IS NOT NULL
        AND COALESCE(e.puesto_votacion, u.puesto_votacion) != ''
        ${acotaTestigos ? 'AND ' + acotaTestigos.sql : ''}
    `, acotaTestigos ? acotaTestigos.valores : []);
    const mesasPorPuesto = new Map();
    for (const t of testigos) {
      if (!mesasPorPuesto.has(t.puesto_votacion)) mesasPorPuesto.set(t.puesto_votacion, new Set());
      const mesas = mesasPorPuesto.get(t.puesto_votacion);
      if (t.tipo_testigo === 'puesto') {
        (t.mesas_asignadas || []).forEach(m => mesas.add(Number(m)));
      } else if (t.mesa_votacion) {
        mesas.add(Number(t.mesa_votacion));
      }
    }

    const filas = puestos.map(p => {
      const cubiertas = mesasPorPuesto.get(p.nombre) || new Set();
      /* QUE MESAS FALTAN, NO SOLO CUANTAS. La cifra decia «faltan 13» y ahi se
         acababa: para saber cuales habia que abrir el puesto y comparar a mano
         contra la lista de testigos. Se devuelven los numeros que SI estan
         cubiertos y la pantalla calcula el resto sobre 1..cantidad_mesas, que
         es la numeracion real de un puesto -medido sobre los 12.885 del
         catalogo: siempre 1..N, sin huecos-. */
      const faltantes = [];
      for (let m = 1; m <= p.cantidad_mesas; m++) if (!cubiertas.has(m)) faltantes.push(m);
      return {
        ...p,
        mesas_con_testigo: cubiertas.size,
        mesas_por_asignar: Math.max(p.cantidad_mesas - cubiertas.size, 0),
        mesas_faltantes: faltantes
      };
    });
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando los puestos de votación.' });
  }
});

router.post('/config/puestos-votacion', requireRole('admin', 'aspirante'), async (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const cantidadMesas = Number(req.body.cantidad_mesas);
  if (!nombre) return res.status(400).json({ error: 'El nombre del puesto es obligatorio.' });
  if (!Number.isInteger(cantidadMesas) || cantidadMesas < 1) {
    return res.status(400).json({ error: 'La cantidad de mesas debe ser un número entero mayor a 0.' });
  }
  // Enlace al puesto oficial del catálogo. Va nulo si el admin escribió el
  // nombre a mano en vez de elegirlo de la lista.
  const ctcPuestoId = Number(req.body.ctc_puesto_id) || null;
  try {
    const [result] = await pool.query(
      `INSERT INTO dia_d_puestos_votacion (nombre, cantidad_mesas, ctc_puesto_id, created_by, aspirante_id) VALUES (?,?,?,?,?)`,
      [nombre, cantidadMesas, ctcPuestoId, req.session.usuario.id, await duenoDeLaCampana(req)]
    );
    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Ese puesto del catálogo ya está en la lista de la campaña.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Error creando el puesto de votación.' });
  }
});

router.put('/config/puestos-votacion/:id', requireRole('admin', 'aspirante'), async (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const cantidadMesas = Number(req.body.cantidad_mesas);
  if (!nombre) return res.status(400).json({ error: 'El nombre del puesto es obligatorio.' });
  if (!Number.isInteger(cantidadMesas) || cantidadMesas < 1) {
    return res.status(400).json({ error: 'La cantidad de mesas debe ser un número entero mayor a 0.' });
  }
  const ctcPuestoId = Number(req.body.ctc_puesto_id) || null;
  try {
    const [result] = await pool.query(
      `UPDATE dia_d_puestos_votacion SET nombre = ?, cantidad_mesas = ?, ctc_puesto_id = ? WHERE id = ? AND aspirante_id = ?`,
      [nombre, cantidadMesas, ctcPuestoId, req.params.id, await duenoDeLaCampana(req)]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Ese puesto del catálogo ya está en la lista de la campaña.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Error editando el puesto de votación.' });
  }
});

/**
 * Trae de una vez los puestos oficiales del catálogo: los de un municipio
 * (`municipio_id`) o los de un departamento entero (`departamento_id`).
 * Es la alternativa a agregarlos de a uno — Antioquia tiene 1.202.
 *
 * EL NOMBRE SE CALIFICA CON EL MUNICIPIO CUANDO LA CAMPAÑA ABARCA VARIOS.
 * Los nombres de puesto son únicos DENTRO de un municipio, no dentro de un
 * departamento: en Antioquia hay 1.202 puestos pero solo 1.053 nombres
 * distintos, y «PUESTO CABECERA MUNICIPAL» existe en 78 municipios. Como
 * `dia_d_puestos_votacion.nombre` es único y todo el Día D identifica el
 * puesto por su texto, sin calificar se perderían 149 en silencio y un
 * testigo que dijera «PUESTO CABECERA MUNICIPAL» sería ambiguo entre 78
 * sitios. Calificado —«PUESTO CABECERA MUNICIPAL (ABEJORRAL)»— los 1.202
 * quedan únicos, con 68 caracteres en el peor caso del país.
 *
 * En una campaña de un solo municipio (Ciudad definida en Datos de la
 * campaña) el sufijo no aparece: ahí no hay ambigüedad y estorba.
 *
 * Repetible: el índice único sobre `ctc_puesto_id` hace que los que ya
 * estaban no se dupliquen, así que se puede volver a correr sin pensarlo
 * — por ejemplo cuando el catálogo agrega puestos nuevos.
 */
router.post('/config/puestos-votacion/importar-catalogo', requireRole('admin', 'aspirante'), async (req, res) => {
  const municipioId = Number(req.body.municipio_id) || 0;
  const departamentoId = Number(req.body.departamento_id) || 0;
  if (!municipioId && !departamentoId) {
    return res.status(400).json({ error: 'Falta indicar el municipio o el departamento.' });
  }
  try {
    // Si la campaña declaró una Ciudad, cubre un solo municipio y el
    // nombre va limpio. Si no, abarca varios y hay que calificarlo.
    const [[cfg]] = await pool.query(
      `SELECT ciudad FROM configuracion_campana WHERE id = 1`);
    const unSoloMunicipio = !!(cfg && (cfg.ciudad || '').trim());
    const expresionNombre = unSoloMunicipio
      ? 'p.nombre'
      : `CONCAT(p.nombre, ' (', m.nombre, ')')`;

    const condicionZona = municipioId ? 'p.municipio_id = ?' : 'm.padre_id = ?';
    const idZona = municipioId || departamentoId;

    // Cuántos hay en el catálogo para esa zona. Se mira aparte de la
    // inserción porque "el catálogo no tiene nada de esa zona" y "ya
    // estaban todos cargados" son cosas distintas: la primera es un error
    // que hay que reportar, la segunda es normal y esperada (este botón
    // está pensado para volver a usarse).
    const [[enCatalogo]] = await pool.query(
      `SELECT COUNT(*) n
         FROM ${CATALOGO}.ctc_puestos_votacion p
         JOIN ${CATALOGO}.ctc_territorios m ON m.id = p.municipio_id
        WHERE p.estado = 'ACTIVO' AND ${condicionZona}`,
      [idZona]
    );
    if (enCatalogo.n === 0) {
      return res.status(400).json({ error: 'El catálogo oficial no tiene puestos de votación registrados para esa zona.' });
    }

    const dueno = await duenoDeLaCampana(req);
    const [[antes]] = await pool.query(`SELECT COUNT(*) n FROM dia_d_puestos_votacion WHERE aspirante_id = ?`, [dueno]);

    // Una sola sentencia en vez de 1.202 idas y vueltas a la base.
    await pool.query(
      /* EL DUEÑO VA EN EL INSERT, Y SE ME QUEDO FUERA AL SEPARAR LAS LISTAS.
         Esta es la sentencia que trae los puestos del catalogo con sus mesas, y
         era la unica escritura de la tabla que no estampaba `aspirante_id`. Con
         el valor por omision, todo lo que el aspirante importara habria caido
         en la lista de la campana PRINCIPAL: su pantalla seguiria vacia y la de
         ella se llenaria de filas que nadie pidio. La misma fuente para las dos
         campañas —el catalogo oficial— y una copia para cada una. */
      `INSERT IGNORE INTO dia_d_puestos_votacion (nombre, cantidad_mesas, ctc_puesto_id, created_by, aspirante_id)
       SELECT ${expresionNombre}, COALESCE(p.total_mesas, 0), p.id, ?, ?
         FROM ${CATALOGO}.ctc_puestos_votacion p
         JOIN ${CATALOGO}.ctc_territorios m ON m.id = p.municipio_id
        WHERE p.estado = 'ACTIVO' AND ${condicionZona}`,
      [req.session.usuario.id, dueno, idZona]
    );

    const [[despues]] = await pool.query(`SELECT COUNT(*) n FROM dia_d_puestos_votacion WHERE aspirante_id = ?`, [dueno]);
    res.json({
      ok: true,
      agregados: despues.n - antes.n,
      yaEstaban: enCatalogo.n - (despues.n - antes.n),
      enCatalogo: enCatalogo.n,
      total: despues.n
    });
  } catch (err) {
    if (err.code === 'ER_TABLEACCESS_DENIED_ERROR' || err.code === 'ER_DBACCESS_DENIED_ERROR') {
      return res.status(503).json({
        error: 'Esta campaña todavía no tiene permiso de lectura sobre el catálogo territorial.'
      });
    }
    console.error(err);
    res.status(500).json({ error: 'Error trayendo los puestos del catálogo.' });
  }
});

router.delete('/config/puestos-votacion/:id', requireRole('admin', 'aspirante'), async (req, res) => {
  try {
    const [result] = await pool.query(`DELETE FROM dia_d_puestos_votacion WHERE id = ? AND aspirante_id = ?`,
      [req.params.id, await duenoDeLaCampana(req)]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error eliminando el puesto de votación.' });
  }
});

router.get('/config/puestos-votacion/exportar-excel', requireRole('admin', 'aspirante'), async (req, res) => {
  try {
    const [filas] = await pool.query(
      `SELECT id, nombre, cantidad_mesas FROM dia_d_puestos_votacion WHERE aspirante_id = ? ORDER BY nombre`,
      [await duenoDeLaCampana(req)]);
    const columnas = ['ID', 'Nombre del puesto', 'Cantidad de mesas'];
    const datos = filas.map(f => ({ 'ID': f.id, 'Nombre del puesto': f.nombre, 'Cantidad de mesas': f.cantidad_mesas }));
    const hoja = datos.length
      ? XLSX.utils.json_to_sheet(datos, { header: columnas })
      : XLSX.utils.aoa_to_sheet([columnas]);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Puestos de votación');
    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="puestos_votacion.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error exportando los puestos de votación.' });
  }
});

// Importa/actualiza puestos desde un Excel con columnas: ID (opcional, solo
// para editar uno existente), Nombre del puesto, Cantidad de mesas. Sirve
// tanto para una carga manual como para el Excel descargado del sitio de la
// Registraduría al usar el botón "Buscar listado oficial en internet".
router.post('/config/puestos-votacion/importar-excel', requireRole('admin', 'aspirante'), uploadExcel.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Debe adjuntar un archivo Excel (.xlsx).' });
  try {
    const libro = XLSX.read(req.file.buffer, { type: 'buffer' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });
    const dueno = await duenoDeLaCampana(req);   // una vez, no una consulta por fila

    let insertados = 0;
    let actualizados = 0;
    const errores = [];

    for (const [i, fila] of filas.entries()) {
      const idFila = String(fila['ID'] || fila.id || '').trim() || null;
      const nombre = String(fila['Nombre del puesto'] || fila.Nombre || fila.nombre || '').trim();
      const cantidadMesas = Number(fila['Cantidad de mesas'] || fila.cantidad_mesas || 0);
      if (!nombre) {
        errores.push({ fila: i + 2, error: 'El nombre del puesto es obligatorio.' });
        continue;
      }
      if (!Number.isInteger(cantidadMesas) || cantidadMesas < 1) {
        errores.push({ fila: i + 2, error: 'La cantidad de mesas debe ser un número entero mayor a 0.' });
        continue;
      }
      try {
        if (idFila) {
          const [result] = await pool.query(
            `UPDATE dia_d_puestos_votacion SET nombre = ?, cantidad_mesas = ? WHERE id = ? AND aspirante_id = ?`,
            [nombre, cantidadMesas, idFila, dueno]
          );
          if (result.affectedRows === 0) {
            errores.push({ fila: i + 2, error: `No existe un puesto con ID ${idFila}.` });
            continue;
          }
          actualizados++;
        } else {
          await pool.query(
            `INSERT INTO dia_d_puestos_votacion (nombre, cantidad_mesas, created_by, aspirante_id) VALUES (?,?,?,?)`,
            [nombre, cantidadMesas, req.session.usuario.id, dueno]
          );
          insertados++;
        }
      } catch (err) {
        errores.push({ fila: i + 2, error: 'Error guardando esta fila.' });
      }
    }
    res.json({ insertados, actualizados, errores });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error procesando el archivo Excel.' });
  }
});

router.get('/config/candidatos', requireRole('admin', 'coordinador', 'aspirante'), async (req, res) => {
  try {
    const [filas] = await pool.query(`SELECT * FROM dia_d_candidatos WHERE aspirante_id = ? ORDER BY id ASC`,
      [await duenoDeLaCampana(req)]);
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando los candidatos.' });
  }
});

// Mismo algoritmo que formatoNombrePropio() en public/js/common.js — acá se
// repite porque este archivo corre en el servidor (Node), no en el
// navegador. "juan PÉREZ gómez" -> "Juan Pérez Gómez".
function formatoNombrePropio(s) {
  return String(s || '').trim().toLowerCase()
    .replace(/(^|[\s'-])([a-záéíóúñü])/g, (m, sep, letra) => sep + letra.toUpperCase());
}

router.post('/config/candidatos', requireRole('admin', 'aspirante'), async (req, res) => {
  // Siempre en formato Nombre Propio, sin importar cómo lo haya escrito el
  // admin — así el nombre queda consistente entre el formulario de reporte
  // del testigo, el gráfico de resultados y cualquier importación posterior.
  const nombre = formatoNombrePropio(req.body.nombre);
  if (!nombre) return res.status(400).json({ error: 'El nombre del candidato es obligatorio.' });
  try {
    const [result] = await pool.query(
      `INSERT INTO dia_d_candidatos (nombre, created_by, aspirante_id) VALUES (?,?,?)`,
      [nombre, req.session.usuario.id, await duenoDeLaCampana(req)]
    );
    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creando el candidato.' });
  }
});

router.put('/config/candidatos/:id', requireRole('admin', 'aspirante'), async (req, res) => {
  const nombre = formatoNombrePropio(req.body.nombre);
  if (!nombre) return res.status(400).json({ error: 'El nombre del candidato es obligatorio.' });
  try {
    const [result] = await pool.query(`UPDATE dia_d_candidatos SET nombre = ? WHERE id = ? AND aspirante_id = ?`,
      [nombre, req.params.id, await duenoDeLaCampana(req)]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error editando el candidato.' });
  }
});

router.delete('/config/candidatos/:id', requireRole('admin', 'aspirante'), async (req, res) => {
  try {
    const [result] = await pool.query(`DELETE FROM dia_d_candidatos WHERE id = ? AND aspirante_id = ?`,
      [req.params.id, await duenoDeLaCampana(req)]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'No encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error eliminando el candidato.' });
  }
});

router.get('/config/candidatos/exportar-excel', requireRole('admin', 'aspirante'), async (req, res) => {
  try {
    const [filas] = await pool.query(`SELECT id, nombre FROM dia_d_candidatos WHERE aspirante_id = ? ORDER BY id ASC`,
      [await duenoDeLaCampana(req)]);
    const columnas = ['ID', 'Nombre del candidato'];
    const datos = filas.map(f => ({ 'ID': f.id, 'Nombre del candidato': f.nombre }));
    const hoja = datos.length
      ? XLSX.utils.json_to_sheet(datos, { header: columnas })
      : XLSX.utils.aoa_to_sheet([columnas]);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Candidatos');
    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="candidatos.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error exportando los candidatos.' });
  }
});

// Importa candidatos desde un Excel con columnas: ID (opcional, solo para
// editar uno existente), Nombre del candidato. Los nuevos quedan al final,
// respetando el orden de entrada de cada fila del archivo.
router.post('/config/candidatos/importar-excel', requireRole('admin', 'aspirante'), uploadExcel.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Debe adjuntar un archivo Excel (.xlsx).' });
  try {
    const libro = XLSX.read(req.file.buffer, { type: 'buffer' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });
    const dueno = await duenoDeLaCampana(req);   // una vez, no una consulta por fila

    let insertados = 0;
    let actualizados = 0;
    const errores = [];

    for (const [i, fila] of filas.entries()) {
      const idFila = String(fila['ID'] || fila.id || '').trim() || null;
      const nombre = formatoNombrePropio(fila['Nombre del candidato'] || fila.Nombre || fila.nombre || '');
      if (!nombre) {
        errores.push({ fila: i + 2, error: 'El nombre del candidato es obligatorio.' });
        continue;
      }
      try {
        if (idFila) {
          const [result] = await pool.query(`UPDATE dia_d_candidatos SET nombre = ? WHERE id = ? AND aspirante_id = ?`,
      [nombre, idFila, dueno]);
          if (result.affectedRows === 0) {
            errores.push({ fila: i + 2, error: `No existe un candidato con ID ${idFila}.` });
            continue;
          }
          actualizados++;
        } else {
          await pool.query(`INSERT INTO dia_d_candidatos (nombre, created_by, aspirante_id) VALUES (?,?,?)`,
            [nombre, req.session.usuario.id, dueno]);
          insertados++;
        }
      } catch (err) {
        errores.push({ fila: i + 2, error: 'Error guardando esta fila.' });
      }
    }
    res.json({ insertados, actualizados, errores });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error procesando el archivo Excel.' });
  }
});

module.exports = router;
