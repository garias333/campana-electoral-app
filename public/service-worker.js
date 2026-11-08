// Service worker único de toda la app (celular y escritorio) — cachea el
// "cascarón" (HTML, CSS y JS propios) de las pantallas que deben poder
// abrir sin ninguna conexión: los formularios de captura del celular
// (Registro de votante/sublíder, Día D), las pantallas de crear de
// escritorio (Votantes, Estructura territorial, Testigos) y el login
// (para poder cambiar de cuenta guardada en el dispositivo sin conexión).
// Antes había dos Service Workers separados (uno para /app/ y otro para
// escritorio); se unificaron en uno solo con alcance de todo el sitio
// para que ambos convivan sin pisarse — dos Service Workers con el mismo
// alcance ("/") no pueden coexistir de forma confiable en el mismo
// navegador.
// Deliberadamente NO cachea /api ni /uploads: eso siempre debe ir a la
// red — las pantallas de solo consulta (dashboard, listados completos,
// mapa, finanzas, reportes de Día D) siguen necesitando conexión porque
// muestran información compartida entre varios usuarios en tiempo real.
// Estrategia RED PRIMERO (con la copia guardada solo como respaldo si de
// verdad no hay conexión) — no "caché primero". Con caché primero, cada
// corrección que se publicaba en el servidor quedaba invisible hasta que
// el navegador decidiera por su cuenta revisar si había una versión
// nueva, lo que en la práctica obligaba a cerrar la app por completo cada
// vez. Con red primero, apenas hay señal siempre se usa lo último del
// servidor (y de paso se refresca la copia guardada); la copia guardada
// solo entra en juego cuando el intento de red falla por falta de señal
// — que es exactamente para lo que existe este Service Worker.
const CACHE_NAME = 'estrategia-v169';
const ARCHIVOS_CASCARON = [
  // Compartido / login (para poder cambiar de cuenta guardada sin conexión)
  '/login.html',
  '/css/style.css',
  // Ayuda · Manuales (orden Manuales 2): la pantalla y sus dos archivos propios. El contenido viene de /api/manuales y no se guarda.
  '/ayuda.html',
  '/css/ayuda.css',
  '/js/ayuda.js',
  '/js/common.js',
  '/js/cuentas-dispositivo.js',
  '/data/colombia.json',
  // App de captura (celular)
  '/app/inicio.html',
  '/app/panel-lider.js',   // el panel del líder de la pantalla de inicio; la copia de sus datos va en IndexedDB, por usuario
  '/app/panel-lider.css',
  '/app/estilos-app.css',
  '/app/app-comun.js',
  '/app/manifest.json',
  '/app/icons/icon-192.png',
  '/app/icons/icon-512.png',
  '/app/apple-touch-icon.png',
  '/js/api-core.js',
  '/app/mis-registros.html',
  // «Mi enlace de inscripción»: el QR se dibuja en el teléfono y se puede ENSEÑAR sin señal (el último enlace queda guardado).
  '/app/mi-enlace.html',
  '/js/qrcode-generator.js',
  '/app/avance-lideres.html',
  '/app/avance-resumen.js',
  '/app/registro-votante.html',
  // El formulario de registro, paso a paso: sin estos dos, sin señal se vería el formulario largo (o sin estilos).
  '/app/pasos-formulario.js',
  '/app/pasos-formulario.css',
  '/app/dia-d.html',
  // Día D, fase 2: «Faltan por votar» (se usa sin señal: lista guardada y marcas en cola) y el ranking.
  '/app/faltantes.html',
  // Lo usa Faltantes para quitarle las tildes al SMS del botón «SMS» (se usa sin señal).
  '/js/segmentos-sms.js',
  '/app/ranking-dia-d.html',
  // Día D, fase 4: el cuadro de alertas (con copia sin señal), el «Llegué a mi puesto» del testigo y lo que dibuja las alertas.
  '/app/alertas-dia-d.html',
  '/app/logistica.html',   // orden 39: el coordinador de puesto la usa sin señal
  '/app/checkin.js',
  '/js/alertas-dia-d.js',
  // Pantallas de ADMINISTRADOR del celular (+ su barra inferior). Leaflet NO va: viene de
  // unpkg (otro origen, que este service worker no toca) y sin red el mapa dice «Sin conexión».
  '/app/admin-nav.js',
  '/app/admin-panel.html',
  '/app/admin-votantes.html',
  '/app/admin-mapa.html',
  '/app/admin-contenido.html',
  '/app/admin-estructura.html',
  '/app/ayudas-estructura.js',
  '/js/form-utils.js',
  '/js/offline-utils.js',
  // Las casillas de «Apoya a» del formulario. Si falta, sin conexión el
  // script no carga, apoyosEnOrden() no existe y el formulario entero muere
  // con el mensaje de «no hay conexión» — que en ese caso sería cierto pero
  // por el motivo equivocado, y seguiría fallando al volver la señal.
  '/js/apoyos.js',
  /* El dictado va en la coraza aunque NECESITE señal para funcionar: sin el
     archivo, la persona sin conexión no ve el micrófono y no sabe que existe.
     Con él, ve el botón y este le explica que hace falta señal — que es una
     información distinta de «esta app no dicta». */
  '/js/dictado.js',
  '/js/firma.js',
  '/js/es-celular.js',
  // Copia la cédula antes de abrir la Registraduría (Registro de votantes y Estructura territorial).
  '/js/consulta-censo.js',
  '/js/instalar-app.js',
  '/js/mesas-testigo.js',
  '/js/baja-manual.js',
  // Va en la coraza porque la app del celular lo usa SIN CONEXIÓN: sin él,
  // los campos con lista se quedan con el comportamiento del navegador y
  // hay que borrarlos a mano para volver a ver la lista.
  '/js/listas-desplegables.js',
  // Las fichas de «varios territorios por persona». Las cargan Estructura
  // territorial y Votantes, que SÍ están en la coraza: sin este archivo, esas
  // dos pantallas sin conexión se quedarían en un solo territorio (no se rompen:
  // revisan que exista antes de usarlo).
  '/js/territorios-multiples.js',
  // Formularios de crear (escritorio)
  '/votantes.html',
  '/territorial.html',
  // La misma pantalla con `?app=1`, que es como la abre el menú de la app del administrador.
  // La caché distingue por dirección COMPLETA (consulta incluida): sin esta línea, sin señal y
  // antes de haberla abierto una vez con red, «Estructura territorial» no abriría aunque la
  // versión sin consulta sí esté guardada.
  '/territorial.html?app=1',
  '/testigos.html'
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_CASCARON))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(nombres.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evento) => {
  const url = new URL(evento.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return;
  }
  // Nunca cachear recursos de otro origen (ej. los tiles/estilos de
  // Mapbox en mapa.html): son datos vivos de un tercero, no forman parte
  // del "cascarón" de esta app. Antes se cacheaban igual que cualquier
  // otra solicitud, y si alguna vez fallaban (o llegaban a devolver un
  // error, ver más abajo) esa copia mala quedaba guardada — el mapa se
  // veía gris hasta forzar un refresco (Ctrl+Shift+R) porque el navegador
  // seguía sirviendo esa respuesta cacheada ante cualquier tropiezo de red.
  if (url.origin !== self.location.origin) return;
  // "no-store" en la propia solicitud: sin esto, aunque el Service Worker
  // pida la red primero, un fetch() normal igual puede resolverse con la
  // caché HTTP del navegador (los archivos estáticos se sirven con
  // Cache-Control de 10 minutos) — quedaría "red primero" solo de
  // nombre. Con "no-store" se garantiza ir SIEMPRE al servidor real
  // mientras haya señal.
  const solicitudSinCache = new Request(evento.request, { cache: 'no-store' });
  evento.respondWith(
    fetch(solicitudSinCache)
      .then((respuesta) => {
        // Solo se guarda copia si la respuesta fue exitosa (2xx) — un
        // error (403/500/etc.) nunca se cachea, para que no quede
        // "atrapado" y se sirva de nuevo ante un fallo de red futuro.
        if (respuesta.ok) {
          const copia = respuesta.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(evento.request, copia)).catch(() => {});
        }
        return respuesta;
      })
      .catch(() => caches.match(evento.request))
  );
});

/* ==================================================================
   NOTIFICACIONES PUSH

   El navegador entrega el aviso a este archivo aunque la aplicación esté
   cerrada — por eso vive aquí y no en una página: una página cerrada no
   ejecuta nada.
   ================================================================== */

/**
 * Llega un aviso.
 *
 * EL PAYLOAD PUEDE VENIR VACÍO, y hay que sobrevivir a eso.
 *   Algunos servicios entregan el aviso sin contenido (por tamaño, o
 *   porque el servidor lo mandó así). Si aquí se reventara al leer un JSON
 *   ausente, el navegador mostraría igual una notificación genérica del
 *   sistema, del tipo «Este sitio se actualizó en segundo plano», que es
 *   peor que un mensaje propio y no dice nada.
 *
 * `waitUntil` NO es opcional: sin él, el navegador puede dar por
 * terminado este trabajador antes de que la notificación alcance a
 * mostrarse, y el aviso se pierde sin dejar rastro.
 */
self.addEventListener('push', (evento) => {
  let datos = {};
  try {
    datos = evento.data ? evento.data.json() : {};
  } catch (err) {
    // Vino algo que no era JSON: se usa como texto del aviso.
    datos = { cuerpo: evento.data ? evento.data.text() : '' };
  }

  const titulo = datos.titulo || 'Estrategia';
  const opciones = {
    body: datos.cuerpo || 'Tienes un aviso nuevo.',
    icon: '/app/icons/icon-192.png',
    badge: '/app/icons/icon-192.png',
    // `tag` hace que un aviso nuevo REEMPLACE al anterior del mismo tipo en
    // vez de apilarse. En el Día D importa: tres recordatorios seguidos de
    // la misma mesa deben verse como uno, no como tres.
    tag: datos.tag || 'estrategia-general',
    renotify: true,
    data: { url: datos.url || '/app/inicio.html' },
  };
  evento.waitUntil(self.registration.showNotification(titulo, opciones));
});

/**
 * La persona tocó el aviso.
 *
 * Si ya hay una ventana de la aplicación abierta, se le trae al frente en
 * vez de abrir otra: llegar a un segundo formulario en blanco, con el que
 * ya se estaba llenando perdido detrás, es la peor forma de atender un
 * aviso durante la jornada electoral.
 */
self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const destino = (evento.notification.data && evento.notification.data.url) || '/app/inicio.html';

  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      for (const ventana of ventanas) {
        // Misma aplicación abierta: se enfoca y se le pide navegar. El
        // `focus()` va primero porque en algunos navegadores `navigate()`
        // sobre una ventana sin foco no hace nada visible.
        if ('focus' in ventana) {
          return ventana.focus().then((v) => ('navigate' in v ? v.navigate(destino) : v));
        }
      }
      return self.clients.openWindow(destino);
    })
  );
});
