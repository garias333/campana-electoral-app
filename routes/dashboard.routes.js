const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requiereVerModulo } = require('../middleware/permisoModulo');
const { sqlMetaEfectiva } = require('../config/metasEstructura');
const { PROFUNDIDAD_MAXIMA, filtroMetaMadreEstructura, sublicenciaSobre } = require('../lib/ramas');
// La misma regla que usa Configuración para saber qué apoyos ofrece cada
// cargo. Compartida a propósito: el gráfico del tablero y las casillas del
// formulario tienen que decir lo mismo.
const { apoyosPermitidos, unirApoyos } = require('../config/apoyos');
const { condicionAlcanceVotantes, parametrosAlcanceVotantes } = require('../lib/alcanceVotantes');
const { cargoDeLaMadre } = require('../config/cargoMadre');
const { filtroOcultar } = require('../config/superadmin');
const { avanceDeLideres } = require('../lib/avanceLideres');

const router = express.Router();
router.use(requireAuth);

/* LAS TRES RUTAS DEL PANEL QUE CONTABAN LA CAMPAÑA A CUALQUIER SESIÓN.
   `/resumen`, `/tendencia-registros` y `/tabla-posiciones` solo pedían sesión:
   un líder o un testigo recibía las cifras de toda la campaña aunque el
   administrador hubiera apagado el Panel general para su rol, porque esa casilla
   solo gobernaba el menú. Ahora la casilla `panel_general` manda también aquí.
   Admin y superadmin pasan siempre; el aspirante con sublicencia también, porque
   el Panel es suyo (`panel_general` está en MODULOS_ASPIRANTE) y las consultas ya
   vienen acotadas a su rama por `ambitoDelPanel`. Falla cerrado: sin fila o con
   error al leer, niega. NO se aplica a `/mi-progreso`, `/progreso-equipo` ni
   `/avance-mis-lideres`: cada una tiene su propia regla. */
const verPanelGeneral = requiereVerModulo('panel_general', { aspirante: true });

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

router.get('/resumen', verPanelGeneral, async (req, res) => {
  try {
    const ambito = await ambitoDelPanel(req);
    // Cada trozo se arma una vez y se pega donde toca. Con `ambito` nulo todos
    // quedan en cadena vacía y la consulta es LA MISMA de siempre, letra por
    // letra: la campaña madre no cambia de comportamiento por este parche.
    const filtroEst = ambito ? 'AND e.usuario_id IN (?)' : '';
    const parEst = ambito ? [ambito.ids] : [];
    const filtroVot = ambito ? `AND ${ambito.votantesSql}` : '';
    const parVot = ambito ? ambito.votantesPar : [];

    /* LA META DE LA MADRE NO SUMA LAS METAS DE LAS RAMAS DE SUS ASPIRANTES.
       Lo que un aspirante le prometió a la campaña principal ya está en SU
       propia fila de estructura —los votos que pactó al inscribirse—, y esa
       fila sí entra en la suma, porque él es un líder de la madre por derecho
       propio. Las metas de SUS líderes no: son el reparto interno de esa misma
       promesa, y sumarlas encima la cuenta dos veces.

       Medido en la campaña de prueba municipal antes de este cambio: el panel
       decía 4.243 donde la cifra correcta es 4.020. Los 223 de diferencia eran
       las metas de la rama del aspirante, ya representadas por los 2.000 que
       él prometió.

       SOLO CUANDO MIRA LA MADRE. Con `ambito` puesto quien mira es el propio
       aspirante, y su panel tiene que sumar justamente lo que este filtro
       quita — aplicárselo le dejaría la meta en cero.

       Y SOLO A LA META, NO AL AVANCE: un votante que registró un líder del
       aspirante y marcó «alcaldía» sí cuenta para la Alcaldía. Ver la nota
       larga de `filtroMetaMadreEstructura`, en lib/ramas.js. */
    /* EN SU PROPIO PANEL, EL ASPIRANTE NO ES UNO DE LOS SUYOS.
       `ambitoDelPanel` arma la lista de su rama empezando por él mismo
       (`SELECT ? AS usuario_id, 0 AS nivel`), y hace bien: para ver a su gente
       hay que partir de él. Pero contarlo dentro del equipo produce dos cifras
       falsas, las dos vistas en pantalla el 30 de agosto de 2026:

         Líderes ................ decía 3, y sus líderes son 2. El tercero era él.
         Meta de votos (líderes)  decía 2.223 = 2.000 + 100 + 123.

       Esos 2.000 son lo que él le prometió a la Alcaldía al inscribirse en la
       campaña madre; no son la meta de ningún líder suyo, y menos en el panel
       de su campaña al Concejo. Los 223 sí: son los 100 de un líder y los 123
       del otro, que es exactamente como debe crecer esa cifra — sumando la
       meta de cada líder según se registra.

       SOLO SE APLICA A LO QUE ES «SU EQUIPO». Los votantes que él registre en
       persona siguen contando en el avance: ahí lo que manda es quién registró
       la ficha, no de quién cuelga. Por eso hay dos filtros y no uno. */
    const filtroEquipo = ambito ? `${filtroEst} AND e.usuario_id <> ?` : '';
    const parEquipo = ambito ? [...parEst, ambito.aspiranteId] : [];

    /* LA META QUE LA CAMPAÑA SE FIJÓ, que es otra cosa que la suma de las
       metas de sus líderes. Una la decide quien dirige —«necesito 4.000 votos
       para la curul»— y no se mueve; la otra crece sola según se registran
       líderes y cada uno se compromete con un número. Enseñarlas juntas es lo
       que deja ver si el equipo alcanza para la meta o falta gente.

       Cada campaña la guarda donde le corresponde: la principal en
       `configuracion_campana.meta_votos_campana`, y un aspirante en
       `sublicencias.meta_votos`, que es la que él escribe en su propia
       Configuración. No se mezclan nunca: la de la Alcaldía no es asunto suyo.

       Va en su propio try porque la columna es nueva: una campaña que aplicó
       el parche sin marcar la casilla de base de datos no la tiene todavía, y
       el panel entero no puede caerse por una cifra informativa. */
    let metaVotosCampana = 0;
    try {
      if (req.sublicencia) {
        const [[sl]] = await pool.query(
          'SELECT meta_votos FROM sublicencias WHERE usuario_id = ? LIMIT 1', [req.sublicencia.usuario_id]);
        metaVotosCampana = sl ? Number(sl.meta_votos) || 0 : 0;
      } else {
        const [[cfg]] = await pool.query(
          'SELECT meta_votos_campana FROM configuracion_campana WHERE id = 1');
        metaVotosCampana = cfg && cfg.meta_votos_campana !== null ? Number(cfg.meta_votos_campana) || 0 : 0;
      }
    } catch (_) { metaVotosCampana = 0; }

    const soloMadre = ambito ? null : await filtroMetaMadreEstructura(pool);
    const filtroMeta = soloMadre ? `AND ${soloMadre.sql}` : '';
    const parMeta = soloMadre ? soloMadre.valores : [];

    const [[estructura]] = await pool.query(`
      SELECT
        COUNT(CASE WHEN e.cargo='coordinador' THEN 1 END) AS coordinadores,
        COUNT(CASE WHEN e.cargo='lider' THEN 1 END) AS lideres,
        COUNT(CASE WHEN e.cargo='testigo' THEN 1 END) AS testigos
      FROM estructura e WHERE e.activo = 1 ${filtroEquipo}
    `, parEquipo);
    const [[votantes]] = await pool.query(`
      -- Los tres contadores por intencion de voto (confirmados, probables,
      -- indecisos) se quitaron con la propia intencion de voto: el panel
      -- nunca los pinto, asi que se calculaban en cada carga para nada.
      SELECT COUNT(*) AS total
      FROM votantes v WHERE 1 = 1 ${filtroVot}
    `, parVot);
    // Meta de votos = suma de la meta de votos que cada Líder tiene
    // registrada. Avance de registros = suma de los votantes/contactos que
    // tienen como Líder a cada uno de ellos (lo que han "aportado" en total).
    const [[metaYAvanceLideres]] = await pool.query(`
      SELECT
        -- SOLO LÍDERES. La meta de un sublíder NO suma aquí, y sumarla era
        -- contar dos veces lo mismo: un sublíder trabaja PARA su líder, así
        -- que sus 50 votos ya están dentro de los 200 que ese líder se
        -- comprometió a traer. Medido en la campaña de prueba municipal el 30
        -- de agosto de 2026: 4.730 de los líderes más 270 de los sublíderes
        -- daban 5.000, cuando la cifra correcta es 4.730.
        -- LO QUE SÍ CUENTA DE UN SUBLÍDER SON SUS REGISTROS, y por eso la
        -- subconsulta de abajo —el avance— sigue incluyendo el cargo usuario:
        -- cada persona que registra un sublíder empuja la meta de su líder, y
        -- con ella la de la campaña. Misma asimetría que con el aspirante: la
        -- meta se acota, el avance no.
        -- (Comentario SQL y sin comillas invertidas: esto va dentro de un
        --  template literal de JavaScript, y una sola comilla invertida aquí
        --  cierra la cadena y rompe el archivo entero. Ya pasó al escribirlo.)
        COALESCE((SELECT SUM(e.meta_votos) FROM estructura e
                   WHERE e.cargo = 'lider' AND e.activo = 1 ${filtroEquipo} ${filtroMeta}), 0) AS meta_votos_lideres,
        (
          SELECT COUNT(*) FROM votantes v
          WHERE v.lider_id IN (SELECT e.usuario_id FROM estructura e
                                WHERE e.cargo IN ('lider','usuario') AND e.activo = 1 ${filtroEst})
            ${filtroVot}
        ) AS avance_registros_lideres
    `, [...parEquipo, ...parMeta, ...parEst, ...parVot]);
    /* LAS TRES QUE NO SE CONSULTAN SIQUIERA CUANDO MIRA EL ASPIRANTE.
       El dinero, la agenda y las menciones son de la campaña madre entera y no
       tienen a quién colgarse para acotarlas. Se devuelven vacías y el panel
       esconde esas tarjetas — ver `esAspirante` en public/dashboard.html.
       No se consultan en absoluto: lo que no se lee no se puede filtrar mal
       más adelante, y son cuatro viajes menos a la base en su panel. */
    /* EL DINERO SOLO VIAJA A QUIEN LO ADMINISTRA. Administrador (el
       superadministrador conserva ese rol), coordinador y aspirante. A cualquier
       otro rol con el Panel encendido —líder, sublíder, testigo…— ni se le
       consulta ni se le envía: se quita del JSON, no solo de la pantalla, porque
       el navegador recibe la respuesta entera y esconder una tarjeta no oculta
       nada. Sin la clave `finanzas`, dashboard.html esconde la tarjeta. */
    const verFinanzas = !!req.sublicencia
      || ['admin', 'coordinador'].includes(req.session.usuario.rol);
    const [[finanzas]] = !verFinanzas ? [[null]] : ambito ? [[{ ingresos: 0, gastos: 0 }]] : await pool.query(`
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

    /* QUE CORPORACIONES PIDE ESTA CAMPAÑA, junto a sus cifras y en la misma
       respuesta. El grafico del tablero pinta una barra por cada una, y hasta
       ahora las pintaba las cinco: una campaña a la Alcaldia —que solo ofrece
       alcaldia, gobernacion y asamblea— mostraba tambien Concejo y JAL, que son
       marcas reales de la gente de sus aspirantes pero que su propio formulario
       no pregunta.

       VIAJA CON LOS DATOS Y NO SE PIDE APARTE. El primer intento leyo la lista
       de otra llamada que la pantalla ya hacia, y fallo: esa variable vive
       dentro de un `try` distinto, asi que en el grafico no existia y el
       ReferenceError se llevo por delante la tarjeta entera. Mandandola aqui, la
       lista y las cifras no pueden desacoplarse ni depender de donde este
       declarada una variable.

       Vacio o ausente significa «esta campaña no configuro apoyos»: el tablero
       pinta las cinco, que es lo que se veia hasta hoy. */
    /* LA MISMA LISTA QUE VE EL FORMULARIO, no una recalculada aqui.
       Se resuelve igual que en /configuracion/campana, con los ayudantes de
       config/apoyos.js, porque tienen que coincidir: si el tablero pinta una
       barra que el formulario no pregunta —o al reves— una de las dos pantallas
       esta mintiendo y no hay forma de saber cual.

       TRES CASOS:
         · El aspirante en su panel: manda SU cargo. Por eso en la sublicencia al
           Concejo si sale la barra de Concejo, aunque la campaña madre sea de
           Alcaldia y no la pida.
         · Alguien de la campaña madre que cuelga de un aspirante: la lista de la
           madre AMPLIADA con la de su jefe. Registra para las dos.
         · La campaña madre a secas: lo que tenga configurado en `apoyos_activos`.

       Si algo falla se manda vacio y el navegador pinta las cinco, como antes.
       El modo degradado tiene que ser el de siempre, no una tarjeta en blanco. */
    let apoyosActivos = [];
    try {
      if (req.sublicencia && req.sublicencia.cargo) {
        apoyosActivos = apoyosPermitidos(req.sublicencia.cargo);
      } else {
        const [[cfg]] = await pool.query(
          'SELECT apoyos_activos FROM configuracion_campana WHERE id = 1');
        const crudo = cfg && cfg.apoyos_activos;
        const lista = typeof crudo === 'string' ? JSON.parse(crudo) : crudo;
        apoyosActivos = Array.isArray(lista) ? lista : [];

        const jefe = req.session && req.session.usuario
          ? await sublicenciaSobre(pool, req.session.usuario.id)
          : null;
        const suyos = jefe ? apoyosPermitidos(jefe.cargo) : [];
        if (suyos.length) apoyosActivos = unirApoyos(apoyosActivos, suyos);
      }
      apoyosActivos = apoyosActivos.filter((x) => CARGOS_APOYA.includes(x));
    } catch (err) {
      // Que falte o venga mal no puede dejar el tablero sin tarjeta.
      console.error('Resolviendo los apoyos del tablero:', err.message);
      apoyosActivos = [];
    }

    res.json({
      estructura,
      votantes,
      metaVotosCampana,
      metaVotosLideres: Number(metaYAvanceLideres.meta_votos_lideres),
      avanceRegistrosLideres: Number(metaYAvanceLideres.avance_registros_lideres),
      ...(verFinanzas ? { finanzas: {
        ingresos: Number(finanzas.ingresos),
        gastos: Number(finanzas.gastos),
        balance: Number(finanzas.ingresos) - Number(finanzas.gastos)
      } } : {}),
      eventos,
      proximosEventos,
      menciones,
      apoyaA,
      apoyosActivos
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
router.get('/tendencia-registros', verPanelGeneral, async (req, res) => {
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

    const meta = Number(fila.meta_votos) || 0;
    const enviados = fila.enviados || 0;
    const porcentaje = meta > 0 ? Math.min(100, Math.round((enviados / meta) * 100)) : 0;

    /* EL ASPIRANTE TIENE DOS METAS, Y SON DOS COSAS DISTINTAS.
         · La suya, al Concejo: la define él en Datos de la campaña, y avanza
           con TODA su rama — todo el que registra su equipo lo apoya a él, que
           es la razón de que lo estén registrando.
         · La que le prometió a la Alcaldía al inscribirse allá: vive en
           `estructura.meta_votos` y solo avanza con quienes marcan «alcaldía».
       Quien marca las dos casillas suma en las dos; quien marca solo concejo,
       solo en la suya. No es una regla nueva: es `apoya_a`, leída dos veces.

       Se devuelven las dos y la pantalla las pinta como dos barras. Enseñar
       una sola obligaría a elegir cuál, y las dos son ciertas. */
    if (!req.sublicencia) {
      return res.json({ tieneMetaAsignada: true, meta, enviados, porcentaje });
    }

    const cargo = req.sublicencia.cargo;
    const contar = async (apoyo) => {
      const [[r]] = await pool.query(
        `SELECT COUNT(*) AS n FROM votantes v
          WHERE ${ambito.votantesSql} AND JSON_CONTAINS(v.apoya_a, ?)`,
        [...ambito.votantesPar, JSON.stringify(apoyo)]);
      return Number(r.n) || 0;
    };
    let metaPropia = 0;
    try {
      const [[sl]] = await pool.query(
        'SELECT meta_votos FROM sublicencias WHERE usuario_id = ? LIMIT 1', [req.sublicencia.usuario_id]);
      metaPropia = sl ? Number(sl.meta_votos) || 0 : 0;
    } catch (_) { /* sin la columna todavia: 0, y la barra no se pinta */ }

    const avancePropio = await contar(cargo);
    const avanceMadre = await contar(await cargoDeLaMadre());
    const pct = (a, m) => (m > 0 ? Math.min(100, Math.round((a / m) * 100)) : 0);

    return res.json({
      tieneMetaAsignada: true, meta, enviados, porcentaje,
      dosMetas: true,
      propia: { etiqueta: `Mi campaña (${cargo})`, meta: metaPropia, avance: avancePropio, porcentaje: pct(avancePropio, metaPropia) },
      madre:  { etiqueta: 'Comprometido con la campaña principal', meta, avance: avanceMadre, porcentaje: pct(avanceMadre, meta) },
    });
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
      -- El aspirante no sale en la lista de SU equipo: es la cabeza, no un
      -- miembro, y su fila traería como meta los 2.000 que le prometió a la
      -- Alcaldía, que no tienen nada que ver con su campaña al Concejo. Mismo
      -- motivo que en /resumen; ver la nota larga de allí.
      WHERE e.activo = 1 AND e.cargo IN ('coordinador','lider') ${filtroEst}
        ${ambito ? 'AND e.usuario_id <> ?' : ''}
      ORDER BY e.cargo, u.nombre
    `, [...parVot, ...parEst, ...(ambito ? [ambito.aspiranteId] : [])]);

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

/* ---------------------------------------------------------------------------
   AVANCE DE MIS LÍDERES — lo que ve un coordinador, desde el celular

   Qué lleva cada líder de este coordinador frente a la meta que se comprometió.
   La consulta está en lib/avanceLideres.js, que explica qué cuenta como registro
   y por qué.

   NO REUTILIZA `/progreso-equipo`, y no por capricho. Aquella trae a TODOS los
   coordinadores y líderes de la campaña —solo se acota cuando mira un aspirante—
   y, para un coordinador, compara la suma de las metas de sus líderes contra
   solo sus propios registros. Servirla tal cual al celular le habría enseñado a
   cada coordinador la nómina entera con sus metas, y un porcentaje que no mide
   lo que dice.

   QUIÉN LA LLAMA. El coordinador ve SIEMPRE los suyos: el id sale de la sesión y
   cualquier `coordinador_id` que mande se IGNORA. El administrador y el
   superadministrador —que conserva el rol 'admin'— eligen a cuál mirar con
   `?coordinador_id=`. El aspirante con sublicencia no pasa: su rol es 'lider', y
   lo que él necesita ver es «Progreso del equipo», ya acotado a su rama.
   --------------------------------------------------------------------------- */
router.get('/avance-mis-lideres', requireRole('admin', 'coordinador'), async (req, res) => {
  try {
    const sesion = req.session.usuario;
    let coordinador;

    if (sesion.rol === 'admin') {
      const pedido = Number(req.query.coordinador_id);
      if (!Number.isInteger(pedido) || pedido <= 0) {
        return res.status(400).json({
          error: 'Indique de qué coordinador quiere ver el avance (coordinador_id).'
        });
      }
      /* Se comprueba que SEA un coordinador de esta campaña, activo, y se le
         aplica el filtro del superadministrador oculto: sin eso, esta ruta
         serviría para sondear ids de usuario y confirmar cuáles existen. El
         404 es el mismo para «no existe» y «no es coordinador». */
      const ocultarAlConsultado = await filtroOcultar(sesion, 'u');
      const [[fila]] = await pool.query(
        `SELECT u.id, u.nombre
           FROM estructura e JOIN usuarios u ON u.id = e.usuario_id
          WHERE e.usuario_id = ? AND e.cargo = 'coordinador' AND e.activo = 1
                ${ocultarAlConsultado}
          LIMIT 1`,
        [pedido]
      );
      if (!fila) return res.status(404).json({ error: 'Ese coordinador no existe.' });
      coordinador = { id: fila.id, nombre: fila.nombre };
    } else {
      coordinador = { id: sesion.id, nombre: sesion.nombre };
    }

    const ocultar = await filtroOcultar(sesion, 'u');
    const { lideres, total } = await avanceDeLideres(pool, coordinador.id, ocultar);
    res.json({ coordinador, lideres, total });
  } catch (err) {
    // Solo el código y el mensaje: `err.sql` lleva la consulta entera.
    console.error('Avance de mis líderes:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo cargar el avance de sus líderes.' });
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
router.get('/tabla-posiciones', verPanelGeneral, async (req, res) => {
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
