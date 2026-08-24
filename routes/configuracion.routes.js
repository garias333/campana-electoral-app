const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { invalidarCache: invalidarCacheComunicaciones } = require('../config/comunicacionesConfig');
const { registrarAuditoria } = require('../config/auditoria');
const { verificarPasswordAdmin, validarTelefono10Digitos } = require('../config/verificaciones');
const { estadoCanal: estadoCanalSms, enviarSMS, invalidarCache: invalidarCacheSms } = require('../config/sms');
const { estadoCanal: estadoCanalSendgrid, enviarCorreoMasivo } = require('../config/sendgrid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();
router.use(requireAuth);

/* ------------------------------------------------------------------
   LA MARCA DE LA BARRA LATERAL

   El logo, el nombre y la bajada estaban escritos dentro de common.js.
   Para una plataforma que se licencia a varias campanas eso obligaba a
   tocar codigo y publicar un parche para cambiar un texto, y quien
   administra la campana no deberia depender de nadie para eso.
   ------------------------------------------------------------------ */
const CARPETA_MARCA = path.join(__dirname, '..', 'uploads', 'marca');
fs.mkdirSync(CARPETA_MARCA, { recursive: true });

const subirLogo = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, CARPETA_MARCA),
    // El nombre lo pone el servidor, nunca el que traiga el archivo: un
    // nombre de origen puede llevar barras y salirse de esta carpeta.
    filename: (req, file, cb) =>
      cb(null, `logo_${Date.now()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 4 * 1024 * 1024 },   // un logo no necesita mas
  fileFilter: (req, file, cb) => cb(
    file.mimetype.startsWith('image/') ? null : new Error('El logo debe ser una imagen.'), true),
});

/**
 * La marca, para pintar la barra lateral.
 *
 * Sin restriccion de rol: la barra la ve todo el que entra, no solo el
 * administrador. Y devuelve cadenas VACIAS cuando no hay nada escrito, para
 * que el navegador sepa que debe usar lo de siempre en vez de pintar "null".
 */
router.get('/marca', async (req, res) => {
  try {
    /* EL ASPIRANTE VE SU PROPIA MARCA, NO LA DE LA CAMPANA MADRE.
       Va aqui y no en una ruta nueva porque esta es la UNICA que pinta la barra
       lateral, en las veinte pantallas: cambiarla aqui le cambia la marca en
       todas de una vez, sin tocar una linea del navegador.

       La escribe el SUPERADMINISTRADOR al emitir la sublicencia, no el
       aspirante: por eso no hay un formulario que la edite ni hace falta. El
       aspirante la ve y nada mas.

       Si la sublicencia no trae nombre —recien emitida, todavia sin llenar— se
       cae a la de la madre en vez de dejar la barra en blanco. Una barra vacia
       parece una aplicacion rota; la marca de la madre, al menos, es cierta. */
    if (req.sublicencia && req.sublicencia.nombre) {
      return res.json({
        titulo: req.sublicencia.nombre,
        subtitulo: req.sublicencia.subtitulo || '',
        logo_url: req.sublicencia.logo_url || '',
      });
    }
    const [[c]] = await pool.query(
      'SELECT marca_titulo, marca_subtitulo, marca_logo_url FROM configuracion_campana WHERE id = 1');
    res.json({
      titulo: (c && c.marca_titulo) || '',
      subtitulo: (c && c.marca_subtitulo) || '',
      logo_url: (c && c.marca_logo_url) || '',
    });
  } catch (err) {
    // Una instalacion sin la migracion todavia: se responde vacio y la barra
    // usa lo de siempre, en vez de quedarse sin pintar.
    res.json({ titulo: '', subtitulo: '', logo_url: '' });
  }
});

router.post('/marca/logo', requireRole('admin'), subirLogo.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibio ninguna imagen.' });
  try {
    const [[antes]] = await pool.query('SELECT marca_logo_url FROM configuracion_campana WHERE id = 1');
    const url = `/uploads/marca/${req.file.filename}`;
    await pool.query(
      `INSERT INTO configuracion_campana (id, marca_logo_url, actualizado_por) VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE marca_logo_url = VALUES(marca_logo_url), actualizado_por = VALUES(actualizado_por)`,
      [url, req.session.usuario.id]);
    // Se borra el anterior para no ir dejando logos viejos en el disco. Solo
    // los subidos: el del codigo (/img/logo.png) no vive en uploads.
    if (antes && antes.marca_logo_url && antes.marca_logo_url.startsWith('/uploads/marca/')) {
      fs.unlink(path.join(CARPETA_MARCA, path.basename(antes.marca_logo_url)), () => {});
    }
    await registrarAuditoria(req.session.usuario.id, 'cambiar_logo', 'configuracion', null,
      'Cambio el logo de la barra lateral.', req.ip);
    res.json({ ok: true, logo_url: url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar el logo.' });
  }
});

/** Vuelve al logo que trae la plataforma. */
router.delete('/marca/logo', requireRole('admin'), async (req, res) => {
  try {
    const [[antes]] = await pool.query('SELECT marca_logo_url FROM configuracion_campana WHERE id = 1');
    await pool.query('UPDATE configuracion_campana SET marca_logo_url = NULL WHERE id = 1');
    if (antes && antes.marca_logo_url && antes.marca_logo_url.startsWith('/uploads/marca/')) {
      fs.unlink(path.join(CARPETA_MARCA, path.basename(antes.marca_logo_url)), () => {});
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo quitar el logo.' });
  }
});

const CARGOS_VALIDOS = ['senado', 'camara_representantes', 'gobernacion', 'asamblea', 'alcaldia', 'concejo', 'jal'];

/**
 * Qué apoyos puede ofrecer una campaña según el cargo al que aspira.
 *
 * Una campaña municipal (Alcaldía/Concejo/JAL) puede apoyarse en
 * estructuras de cualquier nivel, así que ve las cinco. Una departamental
 * (Gobernación/Asamblea) solo tiene sentido con las dos de su nivel: no va
 * a pedirle a su gente que apoye a un concejo en particular, porque su
 * territorio abarca muchos municipios.
 *
 * Senado y Cámara no usan esta función: su campaña no ofrece apoyos y la
 * sección no se muestra.
 */
/*
 * EL ORDEN DE ESTAS LISTAS ES EL QUE SE VE EN PANTALLA, y no es alfabético ni
 * casual: cada cargo abre con el SUYO —que es el que la campaña está pidiendo
 * y el que más se marca— y sigue con los demás a los que su gente puede
 * apoyar. Lo consumen la pantalla de Configuración, las casillas del
 * formulario de votantes y la columna «Apoya a» de la tabla, así que el orden
 * se define UNA vez, aquí, y las tres lo respetan.
 *
 * TAMBIÉN DECIDEN CUÁLES APARECEN, no solo en qué orden. Un candidato a
 * Alcaldía no le pide a su gente que apoye a un concejo o a una JAL en
 * particular; uno a Gobernación tampoco reparte apoyos de asamblea. Por eso
 * la lista se acorta a medida que sube el cargo.
 *
 * OJO AL ACORTARLA: lo ya guardado en `votantes.apoya_a` NO se borra, pero
 * deja de mostrarse. Medido el 16 de agosto de 2026 en la campaña municipal
 * (Alcaldía): 70 votantes tenían «concejo» y 43 «jal», y con esta lista esos
 * círculos dejan de pintarse. Si el apoyo se vuelve a permitir, reaparecen
 * solos — el dato siguió ahí todo el tiempo.
 *
 * Senado y Cámara no usan esta función: su campaña no ofrece apoyos y la
 * sección no se muestra.
 */
const APOYOS_POR_CARGO = {
  jal:         ['jal', 'concejo', 'alcaldia', 'asamblea', 'gobernacion'],
  concejo:     ['concejo', 'alcaldia', 'asamblea', 'gobernacion'],
  alcaldia:    ['alcaldia', 'gobernacion', 'asamblea'],
  asamblea:    ['asamblea', 'gobernacion'],
  gobernacion: ['gobernacion']
};

/** Los apoyos permitidos para un cargo, o lista vacía si ese cargo no ofrece apoyos. */
function apoyosPermitidos(cargo) {
  return APOYOS_POR_CARGO[cargo] || [];
}

/**
 * ¿La campaña tiene gente registrada en cada nivel territorial?
 *
 * PARA QUÉ
 *   Las tablas de listado muestran dos columnas COMBINADAS —«Comuna /
 *   Corregimiento» y «Barrio / Vereda»—, y la campaña puede haber apagado
 *   comunas o barrios en Configuración. Con estas banderas la tabla puede
 *   quitar el término que no se usa y esconder la columna solo cuando de
 *   verdad no hay nada que mostrar.
 *
 * POR QUÉ CUATRO Y NO DOS
 *   Cada columna tiene dos mitades y hay que preguntar por las dos. En la
 *   campaña departamental de prueba no hay ni un barrio, pero sí hay 82
 *   personas asignadas a veredas: ocultar «Barrio / Vereda» por la primera
 *   mitad habría escondido la segunda, que es la única que tiene datos.
 *   Es la misma trampa que ya obligó a NO ocultar esos campos en los
 *   formularios de residencia.
 *
 * POR QUÉ AQUÍ Y NO EN EL NAVEGADOR
 *   Las tablas van paginadas. Mirar solo lo pintado haría que la columna
 *   apareciera en la página 3 y no en la 1, que es peor que cualquiera de
 *   las dos opciones. Esto se pregunta una vez, contra toda la base.
 *
 * El nivel se deduce del ÁRBOL de territorios, no de una columna de texto:
 * un votante «de la comuna 5» es en realidad un votante de un barrio cuyo
 * padre es esa comuna, que es como lo arma el listado (`padre.nombre AS
 * pertenece`).
 *
 * PERO HAY UNA SEGUNDA FUENTE, Y NO ES EL ÁRBOL
 *   `usuarios.barrio_residencia` y `usuarios.comuna_corregimiento_residencia`
 *   son TEXTO LIBRE, y la tabla de Asistentes a reuniones los usa como
 *   respaldo cuando la persona no tiene territorio
 *   (`COALESCE(tv.nombre, u.barrio_residencia)` en eventos.routes.js).
 *   Sin mirarlos, una campaña con residencias escritas a mano y sin
 *   territorios asignados daría «no hay datos» y la columna se escondería
 *   **con datos adentro**. Medido el 8 de agosto de 2026: la campaña
 *   departamental de prueba tiene 34 usuarios así.
 *
 *   Ese texto no se puede repartir entre barrio y vereda —es un solo campo
 *   combinado—, así que va en banderas aparte y solo cuenta para decidir si
 *   la columna se muestra.
 */
async function hayDatosPorNivel() {
  const porArbol = (tabla, tipo) =>
    `EXISTS(SELECT 1 FROM ${tabla} x
              JOIN territorios t ON t.id = x.territorio_id
              LEFT JOIN territorios p ON p.id = t.padre_id
             WHERE t.tipo = '${tipo}' OR p.tipo = '${tipo}')`;
  const porTerritorio = (tabla, tipo) =>
    `EXISTS(SELECT 1 FROM ${tabla} x
              JOIN territorios t ON t.id = x.territorio_id
             WHERE t.tipo = '${tipo}')`;

  // Comuna y corregimiento se buscan también en el padre (quien vive en un
  // barrio pertenece a la comuna de ese barrio); barrio y vereda son el
  // territorio mismo.
  const conTexto = (columna) =>
    `EXISTS(SELECT 1 FROM usuarios WHERE ${columna} IS NOT NULL AND ${columna} <> '')`;

  const [filas] = await pool.query(`
    SELECT ${porArbol('votantes', 'comuna')}        OR ${porArbol('estructura', 'comuna')}        AS comuna,
           ${porArbol('votantes', 'corregimiento')} OR ${porArbol('estructura', 'corregimiento')} AS corregimiento,
           ${porTerritorio('votantes', 'barrio')}   OR ${porTerritorio('estructura', 'barrio')}   AS barrio,
           ${porTerritorio('votantes', 'vereda')}   OR ${porTerritorio('estructura', 'vereda')}   AS vereda,
           ${conTexto('comuna_corregimiento_residencia')}                                         AS comuna_texto,
           ${conTexto('barrio_residencia')}                                                       AS barrio_texto`);
  const f = filas[0] || {};
  return {
    comuna: !!f.comuna, corregimiento: !!f.corregimiento,
    barrio: !!f.barrio, vereda: !!f.vereda,
    comunaTexto: !!f.comuna_texto, barrioTexto: !!f.barrio_texto,
  };
}

router.get('/campana', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM configuracion_campana WHERE id = 1`);
    const cfg = rows[0] || {};

    /* EL ASPIRANTE VE SU CAMPAÑA, NO LA DE LA MADRE.
       Esta fila es de la campaña que lo aloja: candidato, lema, marca y CARGO.
       Devolverla tal cual le decia que aspira a la Alcaldia.

       El cargo no es cosmetico, y ahi estaba el daño de verdad. De el salen los
       apoyos que ofrece el formulario, y MEDIDO el 24 de agosto de 2026:

         alcaldia -> alcaldia, gobernacion, asamblea      (sin «concejo»)
         concejo  -> concejo, alcaldia, asamblea, gobernacion

       Con el cargo de la madre, el aspirante al Concejo NO PODIA MARCAR
       «concejo» en su propio formulario. Y «alcaldia», que sigue estando en su
       lista, es justo la casilla que comparte la ficha con la campaña madre:
       las dos cosas que le hacen falta salen de este campo.

       Lo territorial —municipio, comunas, veredas, fecha— se queda como esta:
       es el mismo terreno y el mismo dia de eleccion. Cambiarlo seria inventar
       una campaña distinta donde solo hay una. */
    if (req.sublicencia) {
      const [[persona]] = await pool.query('SELECT nombre FROM usuarios WHERE id = ?',
        [req.sublicencia.usuario_id]);
      cfg.cargo_aspira = req.sublicencia.cargo || cfg.cargo_aspira;
      cfg.nombre_candidato = (persona && persona.nombre) || cfg.nombre_candidato;
      cfg.slogan_campana = req.sublicencia.subtitulo || '';
      cfg.marca_titulo = req.sublicencia.nombre || cfg.marca_titulo;
      cfg.marca_subtitulo = req.sublicencia.subtitulo || '';
      cfg.marca_logo_url = req.sublicencia.logo_url || null;
      cfg.partido_politico = null;
      cfg.direccion_sede = null;
      cfg.telefono = null;
      cfg.email = null;
      cfg.es_sublicencia = true;
      // Sus apoyos activos salen de SU cargo. Los de la madre no le sirven:
      // son los tres de una campaña a la Alcaldia, y ninguno es «concejo».
      cfg.apoyos_activos = apoyosPermitidos(req.sublicencia.cargo);
    }

    // La regla de qué apoyos aplican vive en el servidor; el frontend solo
    // pinta lo que le llega. Así no hay dos copias que se puedan separar.
    cfg.apoyos_posibles = apoyosPermitidos(cfg.cargo_aspira);

    // Si esto falla, se responde que SÍ hay datos en todos los niveles: la
    // tabla muestra las columnas y no se esconde nada. Fallar mostrando de
    // más es molesto; fallar escondiendo deja datos invisibles sin que nadie
    // se entere. Y `territorios` es una vista sobre OTRA base (el catálogo),
    // así que este es el punto de la configuración que más fácil se cae.
    try {
      const hay = await hayDatosPorNivel();
      cfg.hay_datos_comuna = hay.comuna;
      cfg.hay_datos_corregimiento = hay.corregimiento;
      cfg.hay_datos_barrio = hay.barrio;
      cfg.hay_datos_vereda = hay.vereda;
      cfg.hay_datos_comuna_texto = hay.comunaTexto;
      cfg.hay_datos_barrio_texto = hay.barrioTexto;
    } catch (errNiveles) {
      console.error('No se pudo averiguar qué niveles territoriales tienen datos:', errNiveles.message);
      cfg.hay_datos_comuna = true;
      cfg.hay_datos_corregimiento = true;
      cfg.hay_datos_barrio = true;
      cfg.hay_datos_vereda = true;
      cfg.hay_datos_comuna_texto = true;
      cfg.hay_datos_barrio_texto = true;
    }

    res.json(cfg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo la configuración de la campaña.' });
  }
});

/**
 * Qué apoyos aplicarían para un cargo dado. Lo usa la pantalla de
 * Configuración cuando se cambia el Cargo al que aspira, para rearmar las
 * casillas sin tener que guardar primero — y sin repetir la regla en el
 * navegador, donde se podría quedar desactualizada.
 */
router.get('/apoyos-posibles', requireRole('admin'), (req, res) => {
  res.json({ apoyos: apoyosPermitidos(String(req.query.cargo || '')) });
});

/**
 * CUÁNTA GENTE HAY EN CADA NIVEL TERRITORIAL.
 *
 * Apagar un nivel en "Territorio" esconde su campo de los formularios. Lo
 * que ya está guardado no se borra —el `territorio_id` sigue apuntando a la
 * vereda de siempre— pero deja de poder editarse: si alguien abre la ficha
 * de una persona asignada a una vereda con Veredas en No y la guarda, el
 * formulario resuelve el territorio con los campos que SÍ ve y la persona
 * sube de nivel sin que nadie lo note. Es la trampa de siempre: no falla,
 * cambia el dato.
 *
 * Por eso la pantalla avisa CON EL NÚMERO antes de dejar apagar un nivel
 * que tiene gente. Un aviso genérico —"puede haber datos"— no hace que
 * nadie se detenga; "hay 82 personas asignadas a veredas" sí.
 *
 * Va en su propio endpoint y no dentro de GET /campana porque esa la piden
 * cinco pantallas en cada carga y esto solo lo necesita Configuración
 * cuando alguien toca uno de los cuatro selectores.
 *
 * `hay_datos_*` de GET /campana NO sirve para esto: son EXISTS (booleanos)
 * y las tablas de listado los leen con la convención de que un valor que no
 * es `true` ni `1` significa «no hay». Devolver un conteo ahí haría que
 * `hay_datos_barrio = 5` se leyera como «no hay barrios» y la columna
 * desapareciera. Son dos preguntas parecidas que no se pueden mezclar.
 */
router.get('/territorio/uso', requireRole('admin'), async (req, res) => {
  // Comuna y corregimiento se cuentan también por el padre: quien vive en un
  // barrio pertenece a la comuna de ese barrio. Barrio y vereda son el
  // territorio mismo. Es el mismo criterio de hayDatosPorNivel().
  const cuenta = (tabla, tipo, porPadre) => `(SELECT COUNT(*) FROM ${tabla} x
       JOIN territorios t ON t.id = x.territorio_id
       ${porPadre ? 'LEFT JOIN territorios p ON p.id = t.padre_id' : ''}
      WHERE t.tipo = '${tipo}'${porPadre ? ` OR p.tipo = '${tipo}'` : ''})`;
  const total = (tipo, porPadre) =>
    `${cuenta('votantes', tipo, porPadre)} + ${cuenta('estructura', tipo, porPadre)}`;

  try {
    const [[uso]] = await pool.query(`
      SELECT ${total('comuna', true)}         AS comuna,
             ${total('corregimiento', true)}  AS corregimiento,
             ${total('barrio', false)}        AS barrio,
             ${total('vereda', false)}        AS vereda`);
    res.json({
      comuna: Number(uso.comuna), corregimiento: Number(uso.corregimiento),
      barrio: Number(uso.barrio), vereda: Number(uso.vereda),
    });
  } catch (err) {
    // `territorios` es una vista sobre el catálogo, en OTRA base: este es el
    // punto que más fácil se cae. Sin conteo no se puede avisar, y un aviso
    // inventado sería peor que ninguno — se responde `null` y la pantalla
    // pide la confirmación de siempre, sin número.
    console.error('No se pudo contar la gente por nivel territorial:', err.message);
    res.json({ comuna: null, corregimiento: null, barrio: null, vereda: null });
  }
});

// Crea o actualiza (upsert) el registro único de configuración. Solo admin.
router.put('/campana', requireRole('admin'), async (req, res) => {
  const {
    nombre_candidato, cargo_aspira, slogan_campana, partido_politico,
    marca_titulo, marca_subtitulo,
    departamento, ciudad, direccion_sede, telefono, email,
    territorio_departamento, territorio_ciudad, fecha_eleccion, ciudad_tiene_comunas,
    usar_nombre_barrios, usar_nombre_corregimientos, usar_nombre_veredas,
    password_ciudad_comunas, password_usar_barrios,
    password_usar_corregimientos, password_usar_veredas,
    apoyos_activos
  } = req.body;

  if (cargo_aspira && !CARGOS_VALIDOS.includes(cargo_aspira)) {
    return res.status(400).json({ error: 'Cargo al que aspira no válido.' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'El correo electrónico no es válido.' });
  }
  if (!validarTelefono10Digitos(telefono)) {
    return res.status(400).json({ error: 'Error de digitación: el teléfono debe tener 10 dígitos.' });
  }

  // Los apoyos se filtran contra lo que el cargo permite en vez de
  // confiar en lo que llegue: si alguien cambia el cargo a Gobernación,
  // los apoyos municipales que hubiera marcado antes dejan de ser válidos
  // y no deben quedarse guardados.
  let apoyosFinal = null;
  if (apoyos_activos !== undefined) {
    const permitidos = apoyosPermitidos(cargo_aspira);
    const pedidos = Array.isArray(apoyos_activos) ? apoyos_activos : [];
    apoyosFinal = apoyos_activos === null ? null : pedidos.filter(a => permitidos.includes(a));
  }

  const aBooleano = (valor) => (valor === false || valor === 0 || valor === '0' ? 0 : 1);

  // Los cuatro niveles territoriales que la campaña puede apagar. Van en una
  // lista y no en cuatro bloques repetidos porque la regla es idéntica para
  // todos y repetirla cuatro veces es la forma de que el cuarto se quede
  // sin la protección que tienen los otros tres.
  const NIVELES = [
    { columna: 'ciudad_tiene_comunas',        pedido: ciudad_tiene_comunas,        password: password_ciudad_comunas,        etiqueta: '¿Utilizar nombre de comunas?' },
    { columna: 'usar_nombre_barrios',         pedido: usar_nombre_barrios,         password: password_usar_barrios,          etiqueta: '¿Utilizar nombre de barrios?' },
    { columna: 'usar_nombre_corregimientos',  pedido: usar_nombre_corregimientos,  password: password_usar_corregimientos,   etiqueta: '¿Utilizar nombre de corregimientos?' },
    { columna: 'usar_nombre_veredas',         pedido: usar_nombre_veredas,         password: password_usar_veredas,          etiqueta: '¿Utilizar nombre de veredas?' },
  ];

  try {
    const [[actual]] = await pool.query(
      `SELECT ${NIVELES.map(n => n.columna).join(', ')} FROM configuracion_campana WHERE id = 1`);

    // UN FORMULARIO QUE NO TRAE EL CAMPO NO LO PUEDE PISAR. Si la petición
    // llega sin una de estas banderas —una configuracion.html vieja servida
    // desde la caché del navegador, por ejemplo— se conserva lo que ya está
    // guardado. Sin esto, `aBooleano(undefined)` daría 1 y una pantalla
    // desactualizada volvería a encender en silencio un nivel que el admin
    // había apagado. Es la misma regla que ya costó las 18 áreas no
    // municipalizadas del catálogo: si la fuente no trae el dato, la
    // columna no se toca.
    const valores = {};
    for (const nivel of NIVELES) {
      const guardado = actual ? Number(actual[nivel.columna]) : 1;
      valores[nivel.columna] = nivel.pedido === undefined ? guardado : aBooleano(nivel.pedido);

      // Cambiar cualquiera de las cuatro reordena los formularios de captura
      // de toda la aplicación, así que exige la contraseña de un
      // administrador como confirmación extra, además del rol admin que ya
      // pide esta pantalla.
      if (valores[nivel.columna] !== guardado) {
        const autorizado = await verificarPasswordAdmin(nivel.password);
        if (!autorizado) {
          return res.status(403).json({ error: `Contraseña de administrador incorrecta. No se guardó el cambio de "${nivel.etiqueta}".` });
        }
      }
    }

    const ciudadTieneComunasFinal = valores.ciudad_tiene_comunas;
    const usarNombreBarriosFinal = valores.usar_nombre_barrios;
    const usarNombreCorregimientosFinal = valores.usar_nombre_corregimientos;
    const usarNombreVeredasFinal = valores.usar_nombre_veredas;

    await pool.query(
      `INSERT INTO configuracion_campana
         (id, nombre_candidato, cargo_aspira, slogan_campana, partido_politico, departamento, ciudad, direccion_sede, telefono, email,
          territorio_departamento, territorio_ciudad, fecha_eleccion, ciudad_tiene_comunas, usar_nombre_barrios,
          usar_nombre_corregimientos, usar_nombre_veredas, apoyos_activos, marca_titulo, marca_subtitulo, actualizado_por)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         nombre_candidato = VALUES(nombre_candidato),
         cargo_aspira = VALUES(cargo_aspira),
         slogan_campana = VALUES(slogan_campana),
         partido_politico = VALUES(partido_politico),
         departamento = VALUES(departamento),
         ciudad = VALUES(ciudad),
         direccion_sede = VALUES(direccion_sede),
         telefono = VALUES(telefono),
         email = VALUES(email),
         territorio_departamento = VALUES(territorio_departamento),
         territorio_ciudad = VALUES(territorio_ciudad),
         fecha_eleccion = VALUES(fecha_eleccion),
         ciudad_tiene_comunas = VALUES(ciudad_tiene_comunas),
         usar_nombre_barrios = VALUES(usar_nombre_barrios),
         usar_nombre_corregimientos = VALUES(usar_nombre_corregimientos),
         usar_nombre_veredas = VALUES(usar_nombre_veredas),
         apoyos_activos = VALUES(apoyos_activos),
         marca_titulo = VALUES(marca_titulo),
         marca_subtitulo = VALUES(marca_subtitulo),
         actualizado_por = VALUES(actualizado_por)`,
      [nombre_candidato || null, cargo_aspira || null, (slogan_campana || '').trim() || null, partido_politico || null,
       departamento || null, ciudad || null, direccion_sede || null, telefono ? telefono.replace(/\D/g, '') : null, email || null,
       territorio_departamento || null, territorio_ciudad || null, fecha_eleccion || null,
       ciudadTieneComunasFinal, usarNombreBarriosFinal,
       usarNombreCorregimientosFinal, usarNombreVeredasFinal,
       apoyosFinal === null ? null : JSON.stringify(apoyosFinal),
       (marca_titulo || '').trim() || null, (marca_subtitulo || '').trim() || null,
       req.session.usuario.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error guardando la configuración de la campaña.' });
  }
});

// Enmascara un secreto para mostrarlo en la interfaz sin exponerlo por
// completo — solo se ven los últimos 4 caracteres, el resto queda como
// puntos. Sirve para que el admin pueda confirmar "sí, algo hay
// guardado ahí" sin que el valor completo viaje de vuelta al navegador.
function enmascarar(valor) {
  if (!valor) return null;
  const texto = String(valor);
  if (texto.length <= 4) return '••••';
  return '••••••••' + texto.slice(-4);
}

// Verifica la contraseña de administrador para DESBLOQUEAR la pantalla de
// Configurar CRM (candado extra, además del rol admin que ya exigen los
// otros endpoints de /comunicaciones) — no guarda ni cambia nada, solo
// confirma la contraseña.
router.post('/comunicaciones/verificar-acceso', requireRole('admin'), async (req, res) => {
  try {
    const autorizado = await verificarPasswordAdmin(req.body && req.body.password);
    if (!autorizado) {
      return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error verificando la contraseña de administrador.' });
  }
});

// Trae la configuración de Comunicaciones (SendGrid + Twilio). Los
// campos secretos (API Key, Auth Token) viajan ENMASCARADOS — nunca se
// manda el valor completo de vuelta al navegador una vez guardado.
/** Los creditos que le quedan a la cuenta de Onurix de esta campana. */
async function saldoOnurix() {
  try {
    const { consultarSaldoOnurix } = require('../lib/sms');
    const cred = await require('../config/comunicacionesConfig').obtenerCredenciales();
    return await consultarSaldoOnurix({ onurixClient: cred.onurixClient, onurixKey: cred.onurixKey });
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** El ajuste vive en sms_config; si la tabla no existe todavia, va encendido. */
async function leerBajaAutomatica() {
  try {
    const [[c]] = await pool.query('SELECT baja_automatica FROM sms_config WHERE id = 1');
    return c ? Boolean(c.baja_automatica) : true;
  } catch (_) { return true; }
}

router.get('/comunicaciones', requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM configuracion_comunicaciones WHERE id = 1`);
    const fila = rows[0] || {};
    res.json({
      sendgrid_api_key_mascara: enmascarar(fila.sendgrid_api_key),
      sendgrid_from: fila.sendgrid_from || '',
      sendgrid_from_name: fila.sendgrid_from_name || '',
      twilio_account_sid_mascara: enmascarar(fila.twilio_account_sid),
      twilio_auth_token_mascara: enmascarar(fila.twilio_auth_token),
      twilio_sms_from: fila.twilio_sms_from || '',
      // Onurix. El `client` no es un secreto (es el numero de cliente) pero
      // la llave si, y va enmascarada como las demas. Si la campaña no tiene
      // cuenta propia, los dos van vacios y la interfaz muestra que se esta
      // usando la maestra: NUNCA se manda al navegador la del .env.
      onurix_client: fila.onurix_client || '',
      onurix_key_mascara: enmascarar(fila.onurix_key),
      onurix_propio: Boolean(fila.onurix_client && fila.onurix_key),
      // Vive en sms_config, no aquí: es una regla de como se ARMA el SMS, al
      // lado de la firma y de la URL de baja. Se expone en esta pantalla
      // porque es donde el administrador configura las comunicaciones.
      baja_automatica: await leerBajaAutomatica(),
      // El saldo REAL de la cuenta de Onurix. Con el ledger de licencias
      // mandando (es la decision tomada), este numero es el que dice si Onurix
      // puede respaldar lo que el ledger promete: si el ledger reparte 600 y
      // aqui hay 100, la campana cree tener credito hasta que Onurix responde
      // «creditos insuficientes» en pleno envio.
      onurix_saldo: await saldoOnurix()
      // twilio_whatsapp_from no se devuelve: el canal está desactivado
      // (Meta prohíbe las campañas políticas en su API de negocios) y la
      // pantalla ya no tiene ese campo. La columna sigue en la base.
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo la configuración de comunicaciones.' });
  }
});

// Guarda (upsert) la configuración de Comunicaciones. Solo admin.
//
// Para los campos secretos (sendgrid_api_key, twilio_account_sid,
// twilio_auth_token): si llegan vacíos o sin cambios, se CONSERVA lo que
// ya había guardado — así el formulario no obliga a re-escribir la clave
// completa cada vez que se edita solo, por ejemplo, el número de SMS.
// Para reemplazar un secreto, basta con escribir el valor nuevo.
router.put('/comunicaciones', requireRole('admin'), async (req, res) => {
  // twilio_whatsapp_from NO se lee del body a propósito: el canal está
  // desactivado y nadie debe poder configurarlo, ni siquiera llamando a
  // esta API directo. El valor que ya estuviera guardado se conserva.
  const {
    sendgrid_api_key, sendgrid_from, sendgrid_from_name,
    twilio_account_sid, twilio_auth_token, twilio_sms_from,
    onurix_client, onurix_key, baja_automatica
  } = req.body;

  try {
    const [rows] = await pool.query(`SELECT * FROM configuracion_comunicaciones WHERE id = 1`);
    const actual = rows[0] || {};

    const valores = {
      sendgrid_api_key: (sendgrid_api_key && sendgrid_api_key.trim()) ? sendgrid_api_key.trim() : (actual.sendgrid_api_key || null),
      sendgrid_from: sendgrid_from !== undefined ? (sendgrid_from.trim() || null) : (actual.sendgrid_from || null),
      sendgrid_from_name: sendgrid_from_name !== undefined ? (sendgrid_from_name.trim() || null) : (actual.sendgrid_from_name || null),
      twilio_account_sid: (twilio_account_sid && twilio_account_sid.trim()) ? twilio_account_sid.trim() : (actual.twilio_account_sid || null),
      twilio_auth_token: (twilio_auth_token && twilio_auth_token.trim()) ? twilio_auth_token.trim() : (actual.twilio_auth_token || null),
      twilio_sms_from: twilio_sms_from !== undefined ? (twilio_sms_from.trim() || null) : (actual.twilio_sms_from || null),
      twilio_whatsapp_from: actual.twilio_whatsapp_from || null,
      // El numero de cliente SI se puede vaciar (asi se vuelve a la cuenta
      // maestra); la llave sigue la regla de los secretos: vacia = conservar
      // la que habia. Vaciar el cliente sin tocar la llave deja la campaña
      // usando la maestra, que es lo que se espera al "quitar" la cuenta.
      onurix_client: onurix_client !== undefined ? (onurix_client.trim() || null) : (actual.onurix_client || null),
      onurix_key: (onurix_key && onurix_key.trim()) ? onurix_key.trim() : (actual.onurix_key || null)
    };

    await pool.query(
      `INSERT INTO configuracion_comunicaciones
         (id, sendgrid_api_key, sendgrid_from, sendgrid_from_name,
          twilio_account_sid, twilio_auth_token, twilio_sms_from, twilio_whatsapp_from,
          onurix_client, onurix_key, actualizado_por)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         sendgrid_api_key = VALUES(sendgrid_api_key),
         sendgrid_from = VALUES(sendgrid_from),
         sendgrid_from_name = VALUES(sendgrid_from_name),
         twilio_account_sid = VALUES(twilio_account_sid),
         twilio_auth_token = VALUES(twilio_auth_token),
         twilio_sms_from = VALUES(twilio_sms_from),
         twilio_whatsapp_from = VALUES(twilio_whatsapp_from),
         onurix_client = VALUES(onurix_client),
         onurix_key = VALUES(onurix_key),
         actualizado_por = VALUES(actualizado_por)`,
      [valores.sendgrid_api_key, valores.sendgrid_from, valores.sendgrid_from_name,
       valores.twilio_account_sid, valores.twilio_auth_token, valores.twilio_sms_from, valores.twilio_whatsapp_from,
       valores.onurix_client, valores.onurix_key,
       req.session.usuario.id]
    );

    // El enlace de baja automatico vive en sms_config. Solo se toca si el
    // formulario lo mando: asi, guardar desde una pantalla vieja que no
    // conoce el campo no lo apaga sin querer.
    if (baja_automatica !== undefined) {
      await pool.query(
        `INSERT INTO sms_config (id, baja_automatica) VALUES (1, ?)
         ON DUPLICATE KEY UPDATE baja_automatica = VALUES(baja_automatica)`,
        [baja_automatica ? 1 : 0]);
      // Sin esto, configCampana() sigue sirviendo el valor viejo de su cache
      // y el cambio no se nota hasta que expire — parece que no guardo.
      invalidarCacheSms();
    }

    invalidarCacheComunicaciones();

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error guardando la configuración de comunicaciones.' });
  }
});

// Estado de cada canal, para que la pantalla de configuración diga si
// Email y SMS están listos SIN tener que esperar a que falle una campaña.
//
// No calcula nada por su cuenta: reutiliza las mismas funciones que ya
// usa el CRM (estadoCanal de sendgrid.js y estadoCanales de twilio.js),
// para que la pantalla y el envío real nunca puedan discrepar.
router.get('/comunicaciones/estado', requireRole('admin'), async (req, res) => {
  try {
    const [email, sms] = await Promise.all([estadoCanalSendgrid(), estadoCanalSms()]);
    res.json({ email, sms });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando el estado de los canales.' });
  }
});

// Envío de prueba. Existe por un incidente real: un número de Twilio
// guardado con espacios hacía que el SMS nunca saliera, y la pantalla
// mostraba el canal como configurado — el fallo solo se descubría cuando
// una campaña entera no llegaba. Aquí el error de Twilio o SendGrid se
// devuelve TAL CUAL, sin envolverlo en un mensaje genérico, porque es
// justo el dato que hacía falta para diagnosticar.
//
// ESTO ENVÍA DE VERDAD: gasta saldo de la cuenta de Twilio y el mensaje
// llega al destinatario. Por eso exige admin y va detrás del candado de
// contraseña que ya protege esta pantalla.
router.post('/comunicaciones/probar', requireRole('admin'), async (req, res) => {
  const { canal, destino } = req.body || {};
  if (canal !== 'email' && canal !== 'sms') {
    return res.status(400).json({ error: 'Canal no válido. Debe ser "email" o "sms".' });
  }
  if (!destino || !String(destino).trim()) {
    return res.status(400).json({ error: 'Falta a dónde enviar la prueba.' });
  }

  const cuando = new Date().toLocaleString('es-CO');
  try {
    if (canal === 'email') {
      await enviarCorreoMasivo(
        String(destino).trim(),
        'Prueba de configuración — Mensajería',
        `Este es un mensaje de prueba enviado desde Configurar mensajería el ${cuando}.\n\n`
        + 'Si lo estás leyendo, las credenciales de SendGrid y el remitente quedaron bien configurados.'
      );
    } else {
      // `operativo: true`: es una prueba que un administrador se manda a sí
      // mismo desde la pantalla de configuración, no mensajería de campaña.
      // Consume crédito, como cualquier SMS.
      await enviarSMS(
        String(destino).trim(),
        `Prueba de configuracion de mensajeria (${cuando}). Si recibiste esto, el canal SMS quedo bien configurado.`,
        null,
        { origen: 'prueba', operativo: true, usuarioId: req.session.usuario.id }
      );
    }
    // El envío quedó registrado en auditoría igual que cualquier otro
    // cambio sensible: envía a un destinatario real y cuesta dinero.
    await registrarAuditoria(
      req.session.usuario.id, 'comunicaciones_prueba', 'configuracion', null,
      `Envío de prueba por ${canal === 'email' ? 'correo' : 'SMS'} a ${String(destino).trim()}.`, req.ip
    );
    res.json({ ok: true, mensaje: `Mensaje de prueba enviado por ${canal === 'email' ? 'correo' : 'SMS'} a ${String(destino).trim()}.` });
  } catch (err) {
    console.error('Prueba de mensajería falló:', err);
    res.status(400).json({ error: err.message || 'No se pudo enviar el mensaje de prueba.' });
  }
});

// --- Eliminar información (submenú de Configuración) ---
//
// Cada "área" corresponde a la información que la campaña ha ido
// registrando en un módulo de la aplicación — NO borra catálogos ni
// configuración del sistema (usuarios, roles, territorios, categorías de
// finanzas, permisos, configuración de la campaña), solo los REGISTROS
// que se han ido cargando. Las tablas hijas (asistentes de eventos,
// envíos de CRM, subordinados de organigrama) se borran solas por el
// ON DELETE CASCADE ya definido en el esquema.
const AREAS_ELIMINABLES = {
  estructura_territorial: { etiqueta: 'Estructura territorial', tablas: ['estructura'] },
  votantes: { etiqueta: 'Votantes y sublíderes', tablas: ['votantes'] },
  organigrama: { etiqueta: 'Organigrama', tablas: ['organigrama_nodos'] },
  eventos: { etiqueta: 'Eventos y agenda', tablas: ['eventos'] },
  finanzas: { etiqueta: 'Finanzas (movimientos registrados)', tablas: ['finanzas_movimientos'] },
  redes: { etiqueta: 'Redes y Opinión (publicaciones y menciones)', tablas: ['redes_publicaciones', 'monitoreo_menciones'] },
  recursos: { etiqueta: 'Información para compartir (Recursos)', tablas: ['recursos'] },
  crm_historial: { etiqueta: 'CRM y mensajería (historial de campañas y envíos)', tablas: ['comunicaciones_campanas'] }
};

// Lista las áreas disponibles para eliminar (solo admin) — el frontend
// arma los botones a partir de esta lista, así los nombres y el orden
// quedan controlados desde un solo lugar.
router.get('/areas-eliminables', requireRole('admin'), (req, res) => {
  const areas = Object.entries(AREAS_ELIMINABLES).map(([clave, def]) => ({ clave, etiqueta: def.etiqueta }));
  res.json(areas);
});

// Elimina TODOS los registros de un área — acción irreversible, exige
// contraseña de administrador (verificada de nuevo aquí, no basta con
// haber entrado a la pantalla con el candado ya abierto).
router.delete('/eliminar-datos/:area', requireRole('admin'), async (req, res) => {
  const definicion = AREAS_ELIMINABLES[req.params.area];
  if (!definicion) {
    return res.status(404).json({ error: 'Esa área no existe o no se puede eliminar desde acá.' });
  }
  const autorizado = await verificarPasswordAdmin(req.body && req.body.password);
  if (!autorizado) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }
  try {
    let eliminadas = 0;
    for (const tabla of definicion.tablas) {
      const [resultado] = await pool.query(`DELETE FROM ${tabla}`);
      eliminadas += resultado.affectedRows;
    }
    await registrarAuditoria(
      req.session.usuario.id, 'eliminar_datos_area', 'configuracion', null,
      `Eliminó todos los registros del área "${definicion.etiqueta}" (${eliminadas} registros).`, req.ip
    );
    res.json({ ok: true, eliminadas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error eliminando la información de "${definicion.etiqueta}".` });
  }
});

// Los rechazos de multer (subida del logo) no llegan al try/catch de la ruta:
// multer llama a next(err) y SE SALTA el handler. Sin esto caian en el
// manejador global, que responde "error interno del servidor" — y no lo es:
// el archivo pesa mucho o no es una imagen, y eso hay que decirlo tal cual.
// Va DESPUES de las rutas para que solo atrape lo de este router.
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'El logo no puede pesar mas de 4 MB.' });
  }
  if (err && /debe ser una imagen/i.test(err.message || '')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
