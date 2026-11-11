require('dotenv').config();

/* ---------------------------------------------------------------------------
   EL PROCESO CORRE EN HORA DE COLOMBIA

   El servidor es UTC. La sesion de MySQL ya habla en -05:00 (ver config/db.js),
   pero JavaScript seguia en UTC, y eso dejaba las fechas partidas en dos:
   `NOW()` escribia las 13:06 y un `new Date()` de JavaScript escribia las 18:06
   para el mismo instante. Se veia en el bloqueo por intentos fallidos, que
   anunciaba una hora cinco horas mas tarde de la real, y en el vencimiento de
   las claves temporales.

   Con esto todo queda en el mismo reloj: lo que escribe MySQL, lo que escribe
   JavaScript, y lo que JavaScript lee de vuelta —una fecha sin zona horaria se
   interpreta en la zona del proceso, asi que tiene que ser la misma que la de
   la sesion de la base—.

   VA ANTES QUE CUALQUIER OTRA COSA a proposito: fijarlo despues de que algun
   modulo ya haya creado una fecha deja esa fecha en la zona vieja, y el error
   resultante seria intermitente segun el orden de carga.

   Se puede sobrescribir con TZ en el .env si algun dia hay una campana fuera
   de Colombia.
--------------------------------------------------------------------------- */
process.env.TZ = process.env.TZ || 'America/Bogota';
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const path = require('path');

const pool = require('./config/db');
const { requireAuth } = require('./middleware/auth');
const { csrfToken, csrfProtegido } = require('./middleware/csrf');
const { verificarColumnasCriticas } = require('./config/verificarEsquema');

const app = express();
const PORT = process.env.PORT || 3000;

// Sin SESSION_SECRET no hay una clave segura para firmar las cookies de
// sesión — mejor que la app no arranque a que arranque en silencio firmando
// con un valor visible en el código fuente.
if (!process.env.SESSION_SECRET) {
  throw new Error('Falta la variable de entorno SESSION_SECRET (revise el archivo .env).');
}

// Igual de temprano: si a esta base le falta una columna crítica (p. ej.
// usuarios.nombre_usuario, sin la cual TODO inicio de sesión responde 500),
// el proceso termina con un mensaje que dice qué correr, en vez de arrancar
// "sano" y fallar en cada login. Ver config/verificarEsquema.js.
verificarColumnasCriticas();

// Necesario detrás de Nginx/CloudPanel: sin esto, Express no detecta que la
// conexión real del navegador es HTTPS, lo que puede afectar cookies "secure".
app.set('trust proxy', 1);

// Registro de accesos (IP, método, ruta, estado, tiempo de respuesta) — para
// poder reconstruir qué pasó después de un incidente, no solo mientras se
// está mirando la consola en vivo.
app.use(morgan('combined'));

// Encabezados de seguridad estándar. Tres partes de Helmet se ajustan a
// propósito, no por descuido:
// - contentSecurityPolicy: casi todas las páginas de este proyecto usan
//   <script> embebido directamente en el HTML (no archivos .js aparte)
//   — armar un CSP que permita eso sin abrir la puerta a XSS es un
//   trabajo aparte, más grande que "agregar higiene técnica".
// - crossOriginEmbedderPolicy: la app carga recursos de otros dominios
//   (Google Fonts, tiles de Mapbox, Leaflet vía unpkg) que no mandan los
//   encabezados CORP/CORS que exige — con esto activado, el navegador los
//   bloquea y la app se rompe en silencio.
// - referrerPolicy: el valor por defecto de Helmet ("no-referrer") hacía
//   que el navegador no mandara NINGÚN Referer al pedir los tiles de
//   Mapbox — y el token de Mapbox (público, pero restringido por dominio
//   desde el panel de Mapbox) rechaza justamente las solicitudes sin
//   Referer, así que el Mapa territorial se veía en blanco/gris (los
//   pines sí pintaban, porque esos no dependen de una solicitud aparte).
//   "strict-origin-when-cross-origin" es el mismo valor que usan los
//   navegadores cuando no hay ninguna política explícita: solo manda el
//   origen (sin la ruta) a otros dominios, suficiente para que Mapbox
//   reconozca el dominio permitido sin exponer en qué pantalla exacta
//   estaba la persona.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// Límite general de solicitudes por IP — una red de seguridad contra abuso
// o scraping de la API, sin relación con el bloqueo por intentos fallidos
// de /auth/login (ese es por cuenta, no por IP; los dos se complementan).
// El número es generoso a propósito: la app de líderes en campo hace
// bastantes solicitudes normales (verificar cédula, duplicados, CSRF,
// GPS...) y esto no debe interponerse en el uso real.
const limitadorApi = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes desde esta red. Intente de nuevo en unos minutos.' }
});
app.use('/api', limitadorApi);

/* El cuerpo TAL CUAL LLEGO, antes de convertirlo a objeto. Una firma se
   calcula sobre los bytes exactos: si se recalcula desde el objeto ya
   convertido, cualquier diferencia de orden o de espacios da otro resultado y
   la comprobacion falla sin que se entienda por que. Lo usa el webhook de
   estado de Onurix (cabecera X-Signature). */
app.use(express.json({
  limit: '5mb',
  verify: (req, res, buf) => { req.cuerpoCrudo = buf ? buf.toString('utf8') : ''; },
}));
app.use(express.urlencoded({ extended: true }));

// --- Sesión respaldada en MySQL (evita problemas de sesión en memoria en Hostinger/Passenger) ---
const sessionStore = new MySQLStore({}, pool);

app.use(session({
  key: 'campana_sid',
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000, // 8 horas
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Declarado y no dejado al criterio del navegador: los actuales aplican
    // 'Lax' por omisión, pero eso es una convención reciente y no una
    // garantía. 'lax' —y no 'strict'— porque la cookie tiene que seguir
    // valiendo cuando alguien llega desde el enlace de un correo o de
    // WhatsApp, que es justo como entra el equipo de campaña.
    sameSite: 'lax'
  }
}));

// --- CSRF: asigna token a la sesión y lo expone al frontend ---
app.use(csrfToken);
app.get('/api/csrf-token', (req, res) => {
  res.json({ csrfToken: req.session.csrfToken });
});
app.use('/api', csrfProtegido);

// --- Webhooks de proveedores externos (Twilio, etc.) — deliberadamente
// fuera de /api (sin CSRF) y antes del candado de licencia, para que
// los avisos de cambio de estado de mensajes se procesen siempre, sin
// depender de que la sesión de nadie esté activa. ---
app.use('/webhooks', require('./routes/webhooks.routes'));

// --- Disparador de actualización remota — también fuera de /api (sin
// CSRF: quien llama es el Servidor de Licencias, no un navegador con
// sesión) y ANTES del candado de licencia a propósito: una instalación
// con la licencia vencida o suspendida tiene que poder recibir parches
// igual, porque a veces el parche es justamente lo que arregla el
// problema. Va protegido con el secreto compartido, no con sesión. ---
app.use('/actualizador', require('./routes/actualizador.routes'));

// La imagen de la tarjeta (vista previa) del enlace «Ya voté». Sin sesión y ANTES del candado de
// licencia, como /v: la piden los robots de WhatsApp y de Google Mensajes (y los teléfonos de quien
// recibe el mensaje), nunca alguien con cuenta. Caché de un día; `cross-origin` porque helmet manda
// `same-origin` por omisión y un cliente de mensajería que la incruste desde otro origen la perdería.
// (Va por una ruta propia y no por el express.static de más abajo, que la serviría con 10 minutos de caché.)
app.get('/img/ya-vote-og.png', (req, res) => {
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.sendFile(path.join(__dirname, 'public', 'img', 'ya-vote-og.png'), { maxAge: '1d' });
});

// Baja de contacto por enlace. Sin sesión y ANTES del candado de licencia, por
// la misma razón que el actualizador y una más: quien recibe un mensaje no
// tiene cuenta aquí, y revocar la autorización de datos no puede depender de
// que la campaña tenga la licencia al día. El mensaje ya salió.
app.use('/b', express.urlencoded({ extended: false }), require('./routes/baja.routes'));

// Doble confirmación de la autorización de datos. Junto a /b y por lo mismo:
// sin sesión y antes del candado. Y FUERA DE /api a propósito — `csrfProtegido`
// cubre todo /api y exige un token que la persona, que no tiene cuenta aquí,
// no puede tener; su confirmación fallaría con un 403.
app.use('/c', express.urlencoded({ extended: false }), require('./routes/confirmacion.routes'));

// Enlace «Ya voté» del Día D. Junto a /b y /c y por lo mismo: sin sesión, antes del
// candado de licencia y fuera de /api (sin CSRF). Ver routes/yaVoto.routes.js.
app.use('/v', express.urlencoded({ extended: false }), require('./routes/yaVoto.routes'));

// Autorización de datos por enlace de WhatsApp (parche 325): la persona lee la política, marca lo que autoriza y firma con el dedo. Junto a
// /b, /c y /v y por lo mismo: sin sesión, antes del candado de licencia y fuera de /api (el token del enlace es la credencial). Ver
// routes/autorizacion.routes.js. El cuerpo JSON (la firma en PNG) lo lee el express.json de arriba.
app.use('/a', require('./routes/autorizacion.routes'));

// --- Candado de licencia: bloquea TODO lo de abajo (rutas de API y
// frontend) si esta instalación no tiene una licencia vigente. Va antes
// de montar cualquier ruta real, para que nada funcione sin pasar por
// acá primero. Deja pasar sin bloquear la propia pantalla de
// "suspendida.html" (para no crear un bucle de redirección). ---
const middlewareLicencia = require('./middleware/licencia');
const { iniciarValidacionPeriodica } = require('./config/licencia');
app.use(middlewareLicencia);
iniciarValidacionPeriodica();

// Inscripción por enlace/QR del líder (/i/:codigo). A DIFERENCIA de /b, /c y /v va DESPUÉS del
// candado de licencia: aquellas atienden a quien ya recibió un mensaje y no puede quedarse sin
// salida porque la campaña no pagó; ésta capta datos nuevos, y con la licencia vencida no debe
// seguir captando. Sin sesión y fuera de /api (sin CSRF): lo abre gente que no tiene cuenta. El
// pase firmado del formulario hace de antiforgería. Ver routes/inscripcion.routes.js.
app.use('/i', express.urlencoded({ extended: false }), require('./routes/inscripcion.routes'));

// Transporte del Día D, la puerta del CONDUCTOR (/t/<código>, orden 33). Igual que /i: sin sesión, fuera de /api (sin CSRF)
// y DESPUÉS del candado de licencia —guarda datos operativos y con la licencia vencida no debe seguir—. Solo sirve el día
// de la elección. Ver routes/transporte.routes.js. La puerta de la coordinación es /api/dia-d/transporte (más abajo).
app.use('/t', require('./middleware/complemento').requiereComplementoPublico('transporte_dia_d'), require('./routes/transporte.routes'));

// --- Rutas de API ---
/* La marca de la campaña, SIN sesión: es lo que pinta la pantalla de ingreso.
   Se expone solo lo que ya se ve en esa pantalla —logo, nombre y eslogan—,
   nada más de la configuración. Devuelve vacío si algo falla, para que un
   problema aquí no deje a nadie sin poder entrar. */
app.get('/api/marca-publica', async (req, res) => {
  try {
    const pool = require('./config/db');
    const [[c]] = await pool.query(
      'SELECT marca_titulo, marca_subtitulo, marca_logo_url FROM configuracion_campana WHERE id = 1');
    res.json({
      titulo: (c && c.marca_titulo) || '',
      subtitulo: (c && c.marca_subtitulo) || '',
      logo_url: (c && c.marca_logo_url) || '',
    });
  } catch (err) {
    res.json({ titulo: '', subtitulo: '', logo_url: '' });
  }
});

/* EL ASPIRANTE CON SUBLICENCIA SOLO ALCANZA SUS CUATRO PANTALLAS.
   Va aquí, antes de montar ninguna ruta, porque es lo único que garantiza que
   un módulo nuevo nazca cerrado para él: si se pusiera dentro de cada router,
   el que se agregue mañana quedaría abierto y nadie se enteraría.
   Sin sublicencia activa no hace absolutamente nada. */
const { cargarSublicencia, restringirAspirante } = require('./middleware/aspirante');
app.use('/api', cargarSublicencia, restringirAspirante);

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/territorial', require('./routes/territorial.routes'));
app.use('/api/votantes', require('./routes/votantes.routes'));
app.use('/api/inscripcion', require('./routes/inscripcion.panel.routes'));
app.use('/api/votantes-dashboard', require('./routes/votantesDashboard.routes'));
app.use('/api/finanzas', require('./routes/finanzas.routes'));
app.use('/api/eventos', require('./routes/eventos.routes'));
app.use('/api/social', require('./routes/social.routes'));
app.use('/api/recursos', require('./routes/recursos.routes'));
// Legislación: lista y sirve los PDF de la carpeta `legislacion/` (raíz del
// proyecto, fuera de public/ y de uploads/). Pide sesión y permiso «legislacion».
app.use('/api/legislacion', require('./routes/legislacion.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/usuarios', require('./routes/usuarios.routes'));
app.use('/api/geo', require('./routes/geo.routes'));
app.use('/api/organigrama', require('./routes/organigrama.routes'));
app.use('/api/configuracion', require('./routes/configuracion.routes'));
app.use('/api/permisos', require('./routes/permisos.routes'));
// Activar complementos (parche 318): el interruptor general por campaña de nueve complementos. Solo administrador y superadministrador.
app.use('/api/complementos', require('./routes/complementos.routes'));
// Manuales de ayuda por rol: el contenido está en manuales/ (lib/manuales.js) y se filtra por los permisos de quien pregunta.
app.use('/api/manuales', require('./routes/manuales.routes'));
// Panel del líder en el celular (una llamada con meta, 7 días, pendientes, equipo, posición y Día D). Todo acotado con req.alcance.
app.use('/api/panel-lider', require('./routes/panelLider.routes'));
const comunicacionesRouter = require('./routes/comunicaciones.routes');
app.use('/api/comunicaciones', comunicacionesRouter);
app.use('/api/contenido', require('./routes/contenido.routes'));
// Rescate de votos (quién ya votó, faltantes, ranking). ANTES de /api/dia-d: son rutas
// distintas, pero así la ruta hija se resuelve sin pasar por las del tablero.
app.use('/api/dia-d/rescate', require('./routes/rescateVotos.routes'));
// Resultados del Día D (fase 3): consolidado, resultado oficial, diferencias y paquete para el
// abogado. Al arrancar se limpia lo que quedó a medias y se programa el borrado de los vencidos.
const resultadosDiaD = require('./routes/resultadosDiaD.routes');
app.use('/api/dia-d/resultados', resultadosDiaD);
resultadosDiaD.iniciarMantenimiento();
// Cobertura de testigos (asignar, suplentes, Excel, aviso). Antes de /api/dia-d, que si no la tomaría por suya.
app.use('/api/dia-d/cobertura', require('./routes/coberturaTestigos.routes'));
// Fase 4 del Día D: check-in del testigo («Llegué a mi puesto») y cuadro de alertas. Antes de /api/dia-d, por lo mismo.
app.use('/api/dia-d/checkin', require('./routes/checkinDiaD.routes'));
app.use('/api/dia-d/alertas', require('./routes/alertasDiaD.routes'));
// Transporte del Día D (vehículos, conductores, asignar). Antes de /api/dia-d, por lo mismo que las demás.
app.use('/api/dia-d/transporte', require('./routes/transporteDiaD.routes'));
// Logística del Día D (refrigerios, almuerzos, kits; orden 39). Antes de /api/dia-d, por lo mismo.
app.use('/api/dia-d/logistica', require('./routes/logisticaDiaD.routes'));
app.use('/api/dia-d', require('./routes/diaD.routes'));
app.use('/api/catalogo', require('./routes/catalogo.routes'));
app.use('/api/backup', require('./routes/backup.routes'));
// Push: va con requireAuth y sin restricción de rol — los avisos los
// reciben sobre todo testigos y sublíderes (ver routes/push.routes.js).
app.use('/api/push', require('./routes/push.routes'));
// Solicitudes ciudadanas (parche 303): módulo apagado de fábrica (solo el administrador). Un aspirante con sublicencia no pasa: no está en PERMITIDOS.
app.use('/api/solicitudes', require('./routes/solicitudes.routes'));
// Tareas (parche 305): módulo apagado de fábrica (solo el administrador). Un aspirante con sublicencia no pasa: no está en PERMITIDOS.
app.use('/api/tareas', require('./routes/tareas.routes'));
// Puerta a puerta (parche 309): dos módulos apagados de fábrica (solo el administrador). Un aspirante con sublicencia no pasa: no está en PERMITIDOS.
app.use('/api/puerta-a-puerta', require('./routes/puertaAPuerta.routes'));
// Recordatorios automáticos: la pestaña «Recordatorios» de Configuración (solo con el módulo `recordatorios`).
app.use('/api/recordatorios', require('./routes/recordatorios.routes'));

// Retoma cualquier campaña de Email/SMS que haya quedado a medias
// si el proceso se reinició en medio de un envío grande (ver
// procesarEnvioCampana en comunicaciones.routes.js).
comunicacionesRouter.reanudarCampanasPendientes();

// Campañas programadas: se revisa al arrancar y luego cada minuto. El
// minuto es de sobra — nadie programa un envío al segundo — y evita
// depender de un cron del sistema, que en este servidor va por usuario.
comunicacionesRouter.despacharCampanasProgramadas();
setInterval(() => comunicacionesRouter.despacharCampanasProgramadas(), 60 * 1000).unref();

// Estados de los SMS: Onurix no avisa cuando un mensaje se entrega, hay que
// preguntarle. Se revisa al arrancar y luego cada cinco minutos — cada vuelta
// son hasta 40 peticiones a un tercero, así que no tiene sentido el ritmo de
// un minuto que sí tienen las campañas programadas.
require('./config/reconciliadorSms').iniciar();

// Avisos push automáticos de las alertas del Día D (fase 4, parte 2): cada minuto, pero SOLO el día de la elección y dentro de
// la ventana de la jornada; fuera de ella no consulta nada más que la configuración. Ver lib/avisosAlertas.js.
require('./lib/avisosAlertas').iniciar();
// El SMS de confirmación de quien se inscribió por enlace: sale dentro de la franja, uno por persona.
require('./config/inscripcionRegistro').iniciarCola();

// Recordatorios automáticos (Fase 1): APAGADOS de fábrica. Cada minuto, solo lee configuracion_campana.recordatorios_activos y,
// si está en 0, sale. Ver lib/recordatorios.js: sin duplicados, con catch-up, silencio de 20:00 a 08:00 y consentimiento estricto.
require('./lib/recordatorios').iniciar();

// Solicitudes ciudadanas (parche 304): una vez al día, a partir de las 03:30 (Colombia), anonimiza lo que ya cumplió el plazo y lo deja en la
// auditoría. No depende de ningún cron: viaja con la aplicación. Ver lib/solicitudesMantenimiento.js.
require('./lib/solicitudesMantenimiento').iniciar();

// Tareas (parche 306): cada 5 minutos cierra las metas de registros alcanzadas y revisa las tareas por reasignar. Ver lib/tareasMantenimiento.js.
require('./lib/tareasMantenimiento').iniciar();

// --- Archivos subidos (los recursos se descargan de forma controlada vía /api/recursos/:id/descargar,
//     pero comprobantes de finanzas y otros usos internos se sirven directamente) ---
/* LOS LOGOS DE LA MARCA SON PÚBLICOS, el resto de uploads no.
   La pantalla de ingreso tiene que poder pintar el logo de la campaña ANTES
   de que nadie haya iniciado sesión — si no, la app del celular saluda con el
   logo de la plataforma mientras la web ya muestra el de la campaña. Va
   ANTES del montaje protegido: Express toma el primero que coincida.
   Solo /uploads/marca. Todo lo demás (fotos de votantes, adjuntos, Excel
   subidos) sigue exigiendo sesión. */
app.use('/uploads/marca', express.static(path.join(__dirname, 'uploads', 'marca')));
/* LAS FOTOS DEL DÍA D NO SE SIRVEN POR AQUÍ.
   Un E-14 es el respaldo de un resultado electoral, y por /uploads lo abría
   cualquier sesión —un líder de otra rama incluido— con solo tener el enlace.
   Ahora salen únicamente por GET /api/dia-d/reportes/:id/foto (y
   /documentos/:docId), que comprueba quién pregunta y de qué campaña es el
   reporte. Dos cierres, porque hay dos ubicaciones:
     · uploads/dia-d/  — donde caen las fotos nuevas. Se niega siempre.
     · la RAÍZ de uploads/ — donde cayeron las anteriores, mezcladas con
       comprobantes de finanzas y adjuntos de comunicaciones. Ahí solo se
       niega el archivo que figure en un reporte del Día D.
   Las subcarpetas contenido/ y marca/ no pasan por el filtro de la raíz. */
const SUBCARPETA_PRIVADA_DIA_D = 'dia-d';
const { carpetaPrivadaDe } = require('./lib/carpetasPrivadas');
async function cerrarFotosDelDiaD(req, res, next) {
  // Las fotos de las solicitudes ciudadanas (parche 303) tampoco se sirven por aquí: salen por /api/solicitudes/:id/fotos/:fotoId.
  // La lista de subcarpetas privadas es la de lib/carpetasPrivadas.js (la misma que prueba scripts/probar-solicitudes.js).
  if (carpetaPrivadaDe(req.path) === 'solicitudes') {
    return res.status(403).json({ error: 'Esta foto se abre desde la pantalla de Solicitudes ciudadanas.' });
  }
  // Y las de la evidencia de las tareas (parche 305): salen por /api/tareas/:id/fotos/:fotoId.
  if (carpetaPrivadaDe(req.path) === 'tareas') {
    return res.status(403).json({ error: 'Esta foto se abre desde la pantalla de Tareas.' });
  }
  let relativa;
  try {
    // Misma normalización que hará express.static: así `//archivo`,
    // `/./archivo` o `/contenido/../archivo` no esquivan la comprobación.
    relativa = path.posix.normalize(decodeURIComponent(req.path)).replace(/^\/+/, '');
  } catch (err) {
    return res.status(400).end();
  }
  const partes = relativa.split('/').filter(Boolean);
  if (!partes.length) return next();
  if (partes[0].toLowerCase() === SUBCARPETA_PRIVADA_DIA_D) {
    return res.status(403).json({ error: 'Esta foto se abre desde el tablero del Día D.' });
  }

  // Solo los archivos sueltos de la raíz. Las demás subcarpetas siguen igual.
  if (partes.length > 1) return next();
  try {
    const url = '/uploads/' + partes[0];
    const [[hallado]] = await pool.query(
      `SELECT 1 AS x FROM dia_d_reportes WHERE foto_e14_url = ?
       UNION ALL
       SELECT 1 FROM dia_d_reporte_documentos WHERE url = ?
       LIMIT 1`, [url, url]);
    if (hallado) {
      return res.status(403).json({ error: 'Esta foto se abre desde el tablero del Día D.' });
    }
    next();
  } catch (err) {
    // SI LA CONSULTA FALLA SE NIEGA: abrir "por si acaso" dejaría la foto de
    // un acta al alcance de cualquiera justo cuando la base está en problemas.
    console.error('No se pudo comprobar si el archivo es del Día D; se niega por seguridad:', err.code || err.message);
    res.status(503).json({ error: 'No se pudo abrir el archivo en este momento. Intente de nuevo.' });
  }
}
app.use('/uploads', requireAuth, cerrarFotosDelDiaD, express.static(path.join(__dirname, 'uploads')));

// --- Frontend estático ---
// El propio archivo del Service Worker NUNCA debe quedar en caché HTTP: el
// navegador decide si hay una versión nueva comparando este archivo byte a
// byte, y si el caché general (10 min, ver abajo) le sirve una copia
// vieja de ESTE archivo en particular, ni se entera de que hay una
// versión nueva — así que cada corrección publicada podía tardar hasta
// 10 minutos (o más, si el navegador no revalidaba) en notarse, aunque la
// persona cerrara y volviera a abrir la app. Por eso esta ruta va ANTES
// del express.static de abajo, con su propio encabezado sin caché.
app.get('/service-worker.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'service-worker.js'));
});

// maxAge corto (no "immutable"): no hay hashing de nombres de archivo en
// este proyecto (los .css/.js se editan en el mismo nombre), así que un
// caché largo dejaría a la gente viendo una versión vieja de la app hasta
// que expire. 10 minutos evita la revalidación en cada navegación dentro
// de una misma sesión de uso (lo más común), sin arriesgar que un cambio
// publicado tarde horas o días en llegarle a alguien.
// Activar complementos (parche 318): el enlace directo a la pantalla de un complemento apagado muestra «Este complemento no está activo». Va ANTES del
// express.static, que serviría el archivo sin preguntar (ver middleware/complemento.js).
app.use(require('./middleware/complemento').paginasDeComplementos);
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '10m' }));

// El validador de cédulas vive en lib/ —fuera de public/— porque lo usa
// también el servidor. Se sirve desde aquí en vez de copiarlo a public/:
// dos copias del mismo validador divergirían tarde o temprano, y el
// formulario terminaría diciendo una cosa y la API otra.
app.get('/js/validarCedula.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'lib', 'validarCedula.js'));
});

app.get('/', (req, res) => {
  if (req.session && req.session.usuario) {
    // Testigo cae directo y siempre en Día D — es su única pantalla de
    // trabajo, no tiene que buscar nada más en el menú.
    if (req.session.usuario.rol === 'testigo') {
      return res.redirect('/app/dia-d.html');
    }
    // El Invitado entra a registrar y a nada más: se le lleva directo al
    // formulario, sin pasar por un menú donde casi todo le está vedado.
    if (req.session.usuario.rol === 'invitado') {
      return res.redirect('/app/registro-votante.html');
    }
    // Líder y Sublíder trabajan principalmente desde la app de captura
    // (public/app/...); el resto de roles sigue yendo al panel de escritorio.
    const rolesApp = ['lider', 'sublider'];
    return res.redirect(rolesApp.includes(req.session.usuario.rol) ? '/app/inicio.html' : '/dashboard.html');
  }
  res.redirect('/login.html');
});

// --- Manejo de errores de subida de archivos (multer) y otros errores no capturados ---
app.use((err, req, res, next) => {
  /* UN ARCHIVO MÁS PESADO QUE EL LÍMITE ES UN 413, NO UN 500.
     multer lanza LIMIT_FILE_SIZE y, sin este caso, caía en el 500 genérico de abajo
     («Ocurrió un error interno»): quien subía un video de 80 MB creía que el servidor
     se había roto. El límite depende de la ruta (cada una tiene su multer):
       /api/recursos ......................... 50 MB (middleware/upload.js)
       /api/contenido/:clave/foto ............  8 MB (routes/contenido.routes.js)
       /api/contenido/:clave/video ........... 100 MB (routes/contenido.routes.js)
       importaciones de Excel ................ 10 MB (uploadExcel)
     Si aparece otra ruta con otro límite, se dice sin cifra en vez de inventarla. */
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    const ruta = req.originalUrl || '';
    let limite = null;
    if (/^\/api\/recursos(\/|\?|$)/.test(ruta)) limite = '50 MB';
    else if (/^\/api\/contenido\/[^/]+\/foto/.test(ruta)) limite = '8 MB';
    else if (/^\/api\/contenido\/[^/]+\/video/.test(ruta)) limite = '100 MB';
    else if (/importar/i.test(ruta)) limite = '10 MB';
    return res.status(413).json({
      error: limite
        ? `El archivo es demasiado grande. El límite es de ${limite}. Redúcelo e inténtalo de nuevo${/^\/api\/recursos/.test(ruta) ? ' o súbelo como enlace (por ejemplo, un video de YouTube)' : ''}.`
        : 'El archivo es demasiado grande para este envío. Redúcelo e inténtalo de nuevo.'
    });
  }
  console.error('Error no controlado:', err);
  if (err.message && err.message.includes('no permitido')) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Ocurrió un error interno en el servidor.' });
});

// --- Red de seguridad de último nivel: si algún error de una promesa queda
// sin capturar (por ejemplo, una ruta nueva que olvide su try/catch), se
// registra en el log en vez de dejar que tumbe el proceso completo para
// todos los usuarios conectados. ---
// Una promesa rechazada sin capturar suele ser una consulta que falló en una
// ruta concreta: registrarla y seguir es lo correcto, porque el resto de la
// aplicación está sano y tumbarla dejaría sin servicio a todos por el error
// de uno.
process.on('unhandledRejection', (err) => {
  console.error('Promesa rechazada sin manejar:', err);
});

// UNA EXCEPCIÓN NO CAPTURADA ES OTRA COSA: SE SALE.
//
// Node no garantiza en qué estado queda el proceso después de una — puede
// haber quedado un archivo a medio escribir, una conexión a medio liberar o
// una transacción abierta. Seguir atendiendo peticiones con ese estado es
// justamente cómo se corrompen datos sin que nadie lo note, que es la clase
// de fallo que esta aplicación no se puede permitir el día de las
// elecciones. Se sale con código 1 y PM2 levanta un proceso limpio.
//
// SE COMPROBÓ ANTES DE CAMBIARLO: en todo el historial de registros de PM2
// este manejador no se ha disparado NI UNA VEZ, así que salir no puede
// meter a la aplicación en un bucle de reinicios por algo que ya estuviera
// ocurriendo. Y si algún día pasara, PM2 corta tras varios reinicios
// seguidos y lo deja visible en `pm2 list` — que es mejor que una campaña
// funcionando a medias en silencio.
process.on('uncaughtException', (err) => {
  console.error('Excepción no capturada, el proceso se reinicia:', err);
  process.exit(1);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Aplicación de Administración de Campañas escuchando en el puerto ${PORT}`);
});

module.exports = app;
