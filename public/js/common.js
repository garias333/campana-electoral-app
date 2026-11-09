/* Utilidades comunes: sesión, sidebar dinámico y helpers de fetch */

/**
 * La consulta de lugar de votación de la Registraduría.
 *
 * VIVE EN UN SOLO SITIO A PROPÓSITO. La dirección anterior
 * (la del servidor «wsp» de la Registraduría) estaba escrita a mano en
 * seis archivos, y cuando la Registraduría la movió, los seis botones
 * quedaron abriendo una ventana con un 404. Nada falla del lado de la
 * aplicación: el botón responde, la ventana se abre, y solo quien la mira
 * se entera. Con una constante, el próximo cambio es una línea.
 *
 * Las dos pantallas de la app del celular (`app/registro-votante.html` y
 * `app/puesto-votacion.html`) NO cargan este archivo y llevan la dirección
 * en el `href` del enlace. Si vuelve a cambiar, son esas dos y esta línea.
 */
const URL_CONSULTA_CENSO = 'https://consultacenso.registraduria.gov.co/';

/**
 * La celda de Área de una tabla: Urbano y Rural como etiqueta de color, para
 * poder recorrer la columna sin leer.
 *
 * Vive aquí porque la usan las DOS tablas que tienen esa columna —Estructura
 * territorial y Votantes y sublíderes— y son la misma cosa: con una copia en
 * cada una, la que se olvide queda con el estilo viejo y parece un error de
 * datos, no de estilo.
 *
 * Cualquier otro valor devuelve una raya sin etiqueta: un guion no es un
 * valor, y pintarlo de color diría que sí lo es.
 */
function etiquetaArea(area) {
  if (area !== 'urbano' && area !== 'rural') return '—';
  return `<span class="tag-tipo tag-area-${area}">${area === 'urbano' ? 'Urbano' : 'Rural'}</span>`;
}

/**
 * Pone en un <select> un valor GUARDADO, agregando la opción si no está.
 *
 * `select.value = "algo"` cuando no existe una opción con ese texto NO da
 * error: el navegador deja el campo en vacío. Y al guardar, ese vacío pisa
 * el dato que ya estaba.
 *
 * Le pasaba al Puesto de votación al abrir Editar. Medido el 15 de agosto de
 * 2026 en la campaña departamental: de 50 personas con puesto guardado, 31
 * tenían uno que NO estaba en la lista con la que se llena el desplegable.
 * Esa lista sale de `dia_d_puestos_votacion` —los puestos que la campaña
 * cubre con testigos— mientras que el lugar donde alguien VOTA sale del
 * catálogo nacional: dos listas distintas para el mismo campo. Abrir Editar
 * y guardar le borraba el puesto a 3 de cada 5.
 *
 * La opción se agrega y punto, sin esperar a que ningún catálogo responda:
 * lo que ya estaba guardado tiene que seguir en pantalla aunque la red falle.
 * Después, quien repinte la lista (public/js/lugar-votacion-catalogo.js) la
 * conserva, porque lee el valor que encuentra en el desplegable.
 *
 * LA OPCIÓN SE CREA CON `new Option`, NO CON HTML. Armar
 * `<option value="...">` obliga a escapar, y el escaparHtml de esta casa
 * —textContent a innerHTML— NO escapa las comillas dobles: un puesto que se
 * llamara `ESCUELA "LA CEIBA"` habría cortado el atributo y perdido el valor,
 * o sea el mismo fallo que esta función viene a arreglar. Con la API del DOM
 * el valor se asigna como propiedad y no hay nada que escapar.
 *
 * (Hoy ningún nombre del catálogo trae comillas, ni < > ni &: medido, cero de
 * 12.885. Pero el nombre lo escribe la Registraduría, no nosotros.)
 */
function fijarValorGuardadoEnSelect(select, valor) {
  if (!select) return;
  const v = valor == null ? '' : String(valor);
  if (v && !Array.from(select.options).some(o => o.value === v)) {
    select.add(new Option(v, v));
  }
  select.value = v;
}

/* ------------------------------------------------------------------
   AVISO EN EL PROPIO BOTÓN DE GUARDAR

   Al pulsar Guardar no pasaba nada visible hasta que la respuesta volvía: en
   una conexión lenta uno no sabe si el clic entró, y vuelve a pulsar. Ahora
   el botón se pone en «Guardando…» con un girador, y al terminar dice
   «Guardado» un momento antes de volver a lo suyo.

   DE PASO IMPIDE EL DOBLE ENVÍO, que es más que un adorno: dos clics
   seguidos en Guardar creaban dos veces a la misma persona.

   SE ENGANCHA UNA SOLA VEZ, AL FORMULARIO, no botón por botón: hay 23
   botones de guardar repartidos en 14 pantallas, cada uno con su propio
   manejador, y tocarlos todos habría sido tocar 14 archivos y olvidarse del
   siguiente que se agregue.

   PARA SABER CUÁNDO TERMINÓ no se puede esperar al manejador de la página
   —es suyo y no lo devuelve—, así que se mira lo que la pantalla YA hace al
   acabar: enseñar un mensaje de resultado, o cerrar la ventana. Y por si
   alguna no hace ninguna de las dos, hay un plazo de seguridad: un botón que
   se quedara diciendo «Guardando…» para siempre sería peor que no avisar.
   ------------------------------------------------------------------ */
const PLAZO_MAXIMO_GUARDANDO = 12000;

function restaurarBotonGuardar(boton) {
  if (boton.dataset.guardando !== 'si') return;
  clearTimeout(Number(boton.dataset.plazoGuardando));
  boton.disabled = false;
  boton.classList.remove('btn-guardando', 'btn-guardado');
  boton.innerHTML = boton.dataset.textoOriginal || boton.innerHTML;
  delete boton.dataset.guardando;
}

function terminarBotonGuardar(boton, ok) {
  if (boton.dataset.guardando !== 'si') return;
  clearTimeout(Number(boton.dataset.plazoGuardando));
  if (!ok) { restaurarBotonGuardar(boton); return; }
  boton.classList.remove('btn-guardando');
  boton.classList.add('btn-guardado');
  boton.innerHTML = '✓ Guardado';
  boton.dataset.plazoGuardando = String(setTimeout(() => restaurarBotonGuardar(boton), 1500));
}

/**
 * Pone un botón en «Guardando…» con su girador.
 *
 * Se expone porque NO TODO LO QUE GUARDA ES UN FORMULARIO. La matriz de
 * permisos, por ejemplo, es un botón suelto con su manejador de clic: el
 * enganche por `submit` de abajo no lo veía nunca, así que era el único
 * «Guardar» de la aplicación que no daba señal de vida. Una pantalla que
 * guarda 160 casillas sin decir nada es justo donde más falta hace.
 *
 * El final lo sigue detectando el vigilante: cuando aparece el mensaje de
 * resultado, devuelve el botón a su estado.
 */
function marcarBotonGuardando(boton) {
  if (!boton || boton.dataset.guardando === 'si') return;
  boton.dataset.textoOriginal = boton.innerHTML;
  boton.dataset.guardando = 'si';
  boton.disabled = true;
  boton.classList.add('btn-guardando');
  boton.innerHTML = '<span class="girador" aria-hidden="true"></span> Guardando…';
  boton.dataset.plazoGuardando = String(setTimeout(() => restaurarBotonGuardar(boton), PLAZO_MAXIMO_GUARDANDO));
}

function activarAvisoBotonesGuardar() {
  document.addEventListener('submit', (evento) => {
    const form = evento.target;
    if (!form || form.tagName !== 'FORM') return;
    const boton = form.querySelector('button[type="submit"]') ||
      Array.from(form.querySelectorAll('button')).find(b => !b.type || b.type === 'submit');
    marcarBotonGuardando(boton);
  }, true);   // en captura: corre ANTES que el manejador de la página

  // El final se detecta por lo que la pantalla ya hace: mostrar el mensaje de
  // resultado o cerrar la ventana emergente.
  const vigilante = new MutationObserver((cambios) => {
    for (const c of cambios) {
      const el = c.target;
      if (!(el instanceof Element)) continue;

      if (el.classList.contains('mensaje-ok') || el.classList.contains('mensaje-error')) {
        // Se busca el botón EN EL FORMULARIO Y, SI NO HAY, en la tarjeta o la
        // ventana que contiene el mensaje. Antes solo miraba dentro de un
        // <form>: un botón suelto se quedaba en «Guardando…» hasta que
        // saltara el plazo de seguridad, aunque el guardado hubiera salido
        // bien y el mensaje verde ya estuviera a la vista.
        const contenedor = el.closest('.modal') || el.closest('.card') || document;
        const form = el.closest('form') || el.parentElement?.querySelector('form') ||
          contenedor.querySelector('form');
        const boton = (form && form.querySelector('button[data-guardando="si"]')) ||
          contenedor.querySelector('button[data-guardando="si"]');
        if (boton && el.classList.contains('visible')) {
          terminarBotonGuardar(boton, el.classList.contains('mensaje-ok'));
        }
      }
      // Ventana cerrada: se restaura sin más, que si no reaparecería
      // diciendo «Guardando…» la próxima vez que se abra.
      if (el.classList.contains('overlay') && !el.classList.contains('abierto')) {
        el.querySelectorAll('button[data-guardando="si"]').forEach(restaurarBotonGuardar);
      }
    }
  });
  vigilante.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', activarAvisoBotonesGuardar);
} else {
  activarAvisoBotonesGuardar();
}

const NAV_ITEMS = [
  { href: '/dashboard.html', icono: '📊', texto: 'Panel general', modulo: 'panel_general', roles: null },
  {
    grupo: 'Electoral', iconoGrupo: '🗳️',
    items: [
      { href: '/organigrama.html', texto: 'Organigrama', modulo: 'organigrama', roles: ['admin', 'coordinador', 'lider', 'testigo', 'invitado'] },
      { href: '/territorial.html', texto: 'Estructura territorial', modulo: 'territorial', roles: ['admin', 'coordinador', 'lider', 'testigo', 'invitado'] },
      { href: '/votantes.html', texto: 'Votantes y sublíderes', modulo: 'votantes', roles: null },
      { href: '/votantes-dashboard.html', texto: 'Dashboard de votantes', modulo: 'votantes_dashboard', roles: ['admin', 'coordinador'] },
      { href: '/mapa.html', texto: 'Mapa territorial', modulo: 'mapa', roles: ['admin', 'coordinador'] },
      // Solicitudes ciudadanas (parche 303). Apagado de fábrica: solo aparece a quien la matriz le dé «Ver» en `solicitudes`.
      { href: '/solicitudes.html', texto: 'Solicitudes ciudadanas', modulo: 'solicitudes', roles: ['admin', 'coordinador', 'lider'] },
      // Tareas (parche 305). Apagado de fábrica: solo aparece a quien la matriz le dé «Ver» en `tareas`.
      { href: '/tareas.html', texto: 'Tareas', modulo: 'tareas', roles: ['admin', 'coordinador', 'lider'] },
      // Encuestas internas (parche 307). Apagado de fábrica: solo aparece a quien la matriz le dé «Ver» en `encuestas`. Aplicarlas es del celular (/app/encuestas-campo.html).
      { href: '/encuestas.html', texto: 'Encuestas internas', modulo: 'encuestas', roles: ['admin', 'coordinador'] },
    ]
  },
  {
    grupo: 'Día D', iconoGrupo: '⏱️',
    items: [
      { href: '/dia-d.html', texto: 'Jornada electoral', modulo: 'dia_d', roles: ['admin', 'coordinador'] },
      // Avance de votación: es una pestaña de la misma pantalla (hash #avance). Lleva su propio
      // módulo para que la matriz de permisos pueda abrirlo o cerrarlo sin tocar la Jornada.
      { href: '/dia-d.html#avance', texto: 'Avance de votación', modulo: 'rescate_votos', roles: ['admin', 'coordinador'] },
      { href: '/dia-d.html#alertas', texto: 'Alertas del Día D', modulo: 'alertas_dia_d', roles: ['admin', 'coordinador'] },
      { href: '/dia-d.html#resultados', texto: 'Resultados y reclamaciones', modulo: 'resultados_dia_d', roles: ['admin', 'coordinador'] },
      { href: '/testigos.html', texto: 'Testigos electorales', modulo: 'testigos', roles: ['admin', 'coordinador'] },
      { href: '/configuracion.html#diad', texto: 'Puestos de votación y candidatos', modulo: 'configuracion', roles: ['admin'] },
      // Transporte va al final del grupo (orden 35). Es otra pestaña de la misma pantalla (hash #transporte), con su propio módulo (orden 33).
      { href: '/dia-d.html#transporte', texto: 'Transporte del Día D', modulo: 'transporte_dia_d', roles: ['admin', 'coordinador'] },
      // Logística va después de Transporte (orden 39): otra pestaña de la misma pantalla.
      { href: '/dia-d.html#logistica', texto: 'Logística del Día D', modulo: 'logistica_dia_d', roles: ['admin', 'coordinador'] },
    ]
  },
  {
    grupo: 'Logística', iconoGrupo: '📋',
    items: [
      { href: '/agenda.html', texto: 'Agenda', modulo: 'agenda', roles: null },
      { href: '/eventos.html', texto: 'Eventos y GOTV', modulo: 'eventos', roles: ['admin', 'coordinador', 'lider', 'testigo', 'invitado'] },
      { href: '/asistentes-reuniones.html', texto: 'Asistentes a reuniones', modulo: 'asistentes_reuniones', roles: ['admin', 'coordinador', 'lider'] },
    ]
  },
  {
    grupo: 'CRM y mensajería', iconoGrupo: '💬',
    items: [
      { href: '/crm.html', texto: 'CRM y Mensajes', modulo: 'crm', roles: ['admin', 'coordinador'] },
      { href: '/enviar-email.html', texto: 'Enviar E-mail', modulo: 'enviar_email', roles: ['admin', 'coordinador', 'lider'] },
      { href: '/enviar-sms.html', texto: 'Enviar SMS', modulo: 'enviar_sms', roles: ['admin', 'coordinador', 'lider'] },
      /* Vivía como una tarjeta dentro de CRM y Mensajes, empujando hacia abajo
         los tres pasos del envío. Es una lista que se consulta y se exporta,
         no un paso para mandar un mensaje: tiene su propia pantalla.
         EL MÓDULO SIGUE SIENDO 'crm', y no uno nuevo: los permisos se guardan
         por módulo, y un nombre que no exista en `permisos.modulos` esconde el
         ítem a TODA campaña que tenga permisos configurados (ver la línea de
         `modulosPermitidos.includes` más abajo). Comparte pantalla de permisos
         con CRM, que es de donde salió. */
      { href: '/no-contactar.html', texto: 'Pidieron no recibir más', modulo: 'crm', roles: ['admin', 'coordinador'] },
      { href: '/enviar-push.html', texto: 'Aviso en la app', modulo: 'enviar_push', roles: ['admin', 'coordinador', 'lider'] },
      // El módulo sigue siendo 'configurar_crm' (gobierna permisos) y el
      // archivo conserva su nombre: solo cambia el texto visible, porque
      // la pantalla configura mensajería, no el CRM.
      { href: '/configurar-crm.html', texto: 'Configurar mensajería', modulo: 'configurar_crm', roles: ['admin'] },
    ]
  },
  { href: '/finanzas.html', icono: '💰', texto: 'Finanzas', modulo: 'finanzas', roles: ['admin', 'coordinador'] },
  /* CONTENIDO PARA COMPARTIR — antes «Comunicaciones», y antes de Finanzas.
     Son tres pantallas, no una: la de recursos y las dos de `contenido.html`.
     Al superadministrador le aparece UNA sola porque `biografia_candidato` y
     `politica_privacidad` no están en el catálogo MODULOS de
     routes/permisos.routes.js, y a él el menú se le arma con ese catálogo.
     Por eso el grupo no se convirtió en un enlace suelto: la regla de
     «un solo hijo visible» de más abajo lo pinta como enlace directo a quien
     ve uno, y como grupo a quien ve los tres. */
  {
    grupo: 'Contenido para compartir', iconoGrupo: '📣', colapsarSiUno: true,
    items: [
      { href: '/recursos.html', texto: 'Información para compartir', modulo: 'recursos', roles: null },
      { href: '/contenido.html?clave=biografia_candidato', texto: 'Biografía del candidato', modulo: 'biografia_candidato', roles: null },
      { href: '/contenido.html?clave=politica_privacidad', texto: 'Política de privacidad', modulo: 'politica_privacidad', roles: null },
    ]
  },
  {
    grupo: 'Configuración', iconoGrupo: '⚙️',
    items: [
      { href: '/configuracion.html#campana', texto: 'Datos de la campaña', modulo: 'configuracion', roles: ['admin'], porDefecto: true },
      { href: '/configuracion.html#usuarios', texto: 'Usuarios', modulo: 'configuracion', roles: ['admin'] },
      { href: '/configuracion.html#permisos', texto: 'Asignación de permisos', modulo: 'configuracion', roles: ['admin'] },
      { href: '/configuracion.html#eliminar', texto: 'Eliminar información', modulo: 'configuracion', roles: ['admin'] },
      { href: '/configuracion.html#backup', texto: 'Backup', modulo: 'configuracion', roles: ['admin'] },
      // Recordatorios automáticos: módulo propio en la matriz (de fábrica, solo el administrador). Sin su fila en permisos_rol la entrada no sale.
      { href: '/configuracion.html#recordatorios', texto: 'Recordatorios', modulo: 'recordatorios', roles: ['admin'] },
    ]
  },
  /* LEGISLACIÓN, JUSTO ANTES DE AYUDA. Lleva `modulo`: se oculta a quien no
     tenga «Ver» en Asignación de permisos. `roles` solo entra si esa consulta
     falla (ver itemVisible), y repite la siembra de fábrica. El
     módulo `legislacion` está en MODULOS (routes/permisos.routes.js) y en la
     siembra de db/init-db.js; sin esa fila nadie lo vería. El aspirante con
     sublicencia tampoco: su lista de direcciones (HREFS_ASPIRANTE) no la trae. */
  { href: '/legislacion.html', icono: '⚖️', texto: 'Legislación', modulo: 'legislacion', roles: ['admin', 'coordinador'] },
  { href: '/ayuda.html', icono: '❔', texto: 'Ayuda', roles: null },
];

let _csrfTokenCache = null;

async function obtenerCsrfToken() {
  if (_csrfTokenCache) return _csrfTokenCache;
  const resp = await fetch('/api/csrf-token');
  const data = await resp.json();
  _csrfTokenCache = data.csrfToken;
  return _csrfTokenCache;
}

/**
 * Token de la cuenta activa guardada en este dispositivo (ver
 * /js/cuentas-dispositivo.js) — se manda en cada solicitud para poder
 * identificar a esa persona aunque no haya señal para verificar la
 * cookie de sesión normal, y para poder cambiar entre varias cuentas
 * guardadas en un mismo celular compartido. En las pantallas de
 * escritorio normalmente no hay ninguna guardada (esta función solo
 * aplica en la práctica a login.html y a la app móvil), así que acá no
 * cambia nada del comportamiento habitual.
 */
function obtenerTokenDispositivoActivo() {
  try {
    const activaId = localStorage.getItem('app_cuenta_activa_id');
    if (!activaId) return null;
    const cuentas = JSON.parse(localStorage.getItem('app_cuentas_dispositivo') || '{}');
    return (cuentas[activaId] && cuentas[activaId].token) || null;
  } catch (err) {
    return null;
  }
}

async function api(path, opciones = {}) {
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...opciones
  };
  if (opciones.body && !(opciones.body instanceof FormData)) {
    config.body = JSON.stringify(opciones.body);
  } else if (opciones.body instanceof FormData) {
    delete config.headers['Content-Type'];
    config.body = opciones.body;
  }

  const tokenDispositivo = obtenerTokenDispositivoActivo();
  if (tokenDispositivo) config.headers['X-Device-Token'] = tokenDispositivo;

  const metodo = (config.method || 'GET').toUpperCase();

  // Pedir el token CSRF también puede fallar por falta de señal (ej. la
  // pestaña se abrió sin conexión y todavía no hay ningún token en caché)
  // — antes quedaba FUERA del try/catch de abajo, así que ese fallo salía
  // como un "Failed to fetch" crudo en vez de marcarse esErrorDeRed, y la
  // cola offline nunca se activaba. Por eso ahora se pide DENTRO del mismo
  // try que ya distingue "no hay señal" de un error real del servidor.
  let resp;
  try {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(metodo)) {
      config.headers['X-CSRF-Token'] = await obtenerCsrfToken();
    }
    resp = await fetch(`/api${path}`, config);
  } catch (errRed) {
    // fetch() solo lanza esto cuando la solicitud ni siquiera llegó al
    // servidor (sin señal/datos móviles, dominio inalcanzable, etc.) —
    // se distingue de un 401 real para no confundir "no hay internet en
    // este momento" con "la sesión expiró" (ver requerirSesionApp en
    // app-comun.js).
    const error = new Error('No se pudo conectar con el servidor. Verifica tu conexión a internet.');
    error.esErrorDeRed = true;
    throw error;
  }

  // Si el token quedó obsoleto (sesión nueva, etc.), lo renovamos una vez y reintentamos.
  if (resp.status === 403 && !['GET', 'HEAD', 'OPTIONS'].includes(metodo)) {
    try {
      _csrfTokenCache = null;
      config.headers['X-CSRF-Token'] = await obtenerCsrfToken();
      resp = await fetch(`/api${path}`, config);
    } catch (errRed) {
      const error = new Error('No se pudo conectar con el servidor. Verifica tu conexión a internet.');
      error.esErrorDeRed = true;
      throw error;
    }
  }

  let data = null;
  try { data = await resp.json(); } catch (_) { /* respuesta sin cuerpo JSON */ }
  if (!resp.ok) {
    if (resp.status === 401) {
      // Si YA estamos en login.html (ej. la propia pantalla de login
      // consultando si hay una sesión en vivo), redirigir a "/login.html"
      // recarga la misma página — y como quien no tiene sesión activa
      // siempre recibe 401, eso es un bucle de recarga infinito. Ahí se
      // deja que el 401 llegue como un error normal (login.html ya sabe
      // interpretarlo como "no hay sesión, mostrar el formulario").
      if (window.location.pathname !== '/login.html') {
        window.location.href = '/login.html';
        return;
      }
      throw new Error((data && data.error) || 'No autenticado.');
    }
    // `status` para que una pantalla pueda distinguir «no tiene acceso» (403)
    // de un fallo cualquiera sin comparar textos (ver dashboard.html).
    const errorHttp = new Error((data && data.error) || 'Error en la solicitud.');
    errorHttp.status = resp.status;
    // El cuerpo entero de la respuesta, para quien necesite algo mas que el texto del error
    // (por ejemplo un 409 que pide confirmar: viene con QUE hay que confirmar).
    errorHttp.datos = data;
    throw errorHttp;
  }
  return data;
}

function formatoMoneda(valor) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(valor || 0);
}

/**
 * Fecha para mostrar.
 *
 * UNA FECHA SIN HORA NO SE CONVIERTE DE ZONA, Y ESO NO ES UN DETALLE.
 * `new Date('2026-10-25')` no da el 25 de octubre: el estándar manda leer esa
 * forma como MEDIANOCHE EN UTC, y en Colombia (UTC-5) esa medianoche cae a
 * las 7 de la noche del día ANTERIOR. Resultado: toda columna DATE se veía un
 * día antes — y el 1 de enero se veía como 31 de diciembre del año pasado.
 *
 * Por eso una fecha suelta se arma pieza por pieza, en hora local: el 25 es
 * el 25, sin aritmética de por medio. Una fecha CON hora sí puede pasar por
 * `new Date` — la base ya la entrega en hora de Colombia (ver el
 * `SET time_zone` de config/db.js).
 */
function formatoFecha(fechaIso, conHora = false) {
  if (!fechaIso) return '—';
  const texto = String(fechaIso);
  const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(texto);
  const d = soloFecha
    ? new Date(Number(texto.slice(0, 4)), Number(texto.slice(5, 7)) - 1, Number(texto.slice(8, 10)))
    : new Date(texto);
  if (isNaN(d)) return '—';
  const opts = conHora && !soloFecha
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' };
  return d.toLocaleString('es-CO', opts);
}

/**
 * Activa un botón de "Usar ubicación actual": pide el GPS del dispositivo,
 * consulta al backend la dirección aproximada (geocodificación inversa) y la
 * escribe en el campo de dirección indicado. Reutilizado en los formularios
 * de Estructura territorial y de Votantes/contactos.
 *
 * @param {string} botonId - id del botón que dispara la acción
 * @param {string} inputDireccionId - id del <input> de dirección a llenar
 * @param {function} [onDespues] - callback opcional (direccion, lat, lon, detalle)
 *   `detalle` trae lo que Google Geocoding haya podido identificar de esa
 *   ubicación (detalle.state = departamento, detalle.city = ciudad/municipio,
 *   detalle.suburb = barrio/vereda) — puede venir incompleto o vacío según
 *   qué tan precisa sea la cobertura de Google en esa zona.
 */
function activarBotonGps(botonId, inputDireccionId, onDespues) {
  const boton = document.getElementById(botonId);
  if (!boton) return;

  boton.addEventListener('click', async () => {
    if (!navigator.geolocation) {
      alert('Este dispositivo o navegador no permite obtener la ubicación GPS.');
      return;
    }
    const textoOriginal = boton.textContent;
    boton.disabled = true;
    boton.textContent = 'Obteniendo ubicación...';

    /** getCurrentPosition en forma de promesa, para poder encadenar el reintento. */
    const ubicar = (opciones) => new Promise((resolver, rechazar) => {
      navigator.geolocation.getCurrentPosition(resolver, rechazar, opciones);
    });

    try {
      let posicion;
      try {
        // Primer intento: por satélite, el más preciso.
        posicion = await ubicar({ enableHighAccuracy: true, timeout: 30000 });
      } catch (errPreciso) {
        // En un teléfono recién estrenado el GPS no tiene datos asistidos
        // guardados y el primer arranque en frío puede tardar bastante más
        // que cualquier espera razonable — por eso "no funcionaba" en una
        // instalación nueva y sí después. Se reintenta por red (antenas y
        // wifi): 20-100 m en zona urbana, de sobra para deducir la
        // dirección, que es lo único para lo que se usa esto.
        posicion = await ubicar({ enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
      }
      const { latitude, longitude } = posicion.coords;
      const data = await api('/geo/inverso', { method: 'POST', body: { lat: latitude, lon: longitude } });
      const inputDireccion = document.getElementById(inputDireccionId);
      if (inputDireccion) inputDireccion.value = data.direccion || '';
      if (onDespues) onDespues(data.direccion, latitude, longitude, data.detalle || {});
    } catch (err) {
      // Los errores de geolocalización traen `code`; los de la consulta de
      // dirección, no. Se distinguen para no decirle a alguien que falló el
      // GPS cuando lo que falló fue la red.
      alert(err && typeof err.code === 'number'
        ? 'No se pudo obtener la ubicación: ' + err.message
        : 'No se pudo determinar la dirección a partir del GPS: ' + err.message);
    } finally {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  });
}

/**
 * Normaliza texto para comparaciones que no distingan tildes (ej. "lider"
 * debe coincidir con "líder"). Se usa en búsquedas y en la resolución de
 * nombres de territorios (Comuna/Barrio/Corregimiento/Vereda) en los
 * formularios, para que no haga falta escribir la tilde exacta.
 */
function normalizarTexto(s) {
  return (s || '').toString().trim().toLowerCase()
    .replace(/[áàäâã]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöôõ]/g, 'o')
    .replace(/[úùüû]/g, 'u');
}

/**
 * Da formato de Nombre Propio: "juan PÉREZ gómez" -> "Juan Pérez Gómez".
 * Se usa en todos los campos de nombre de persona de la app.
 */
function formatoNombrePropio(s) {
  return (s || '').toString().trim().toLowerCase()
    .replace(/(^|[\s'-])([a-záéíóúñü])/g, (m, sep, letra) => sep + letra.toUpperCase());
}

/**
 * Aplica formatoNombrePropio automáticamente, en el evento "blur" (al salir
 * del campo, no mientras se escribe, para no saltar el cursor), a todos los
 * campos de nombre de persona indicados por selector CSS. Uso típico:
 *   aplicarFormatoNombrePropio('#form-estructura [name="nombre"], #form-votante [name="nombre"]');
 */
function aplicarFormatoNombrePropio(selector) {
  document.querySelectorAll(selector).forEach(input => {
    input.addEventListener('blur', (e) => { e.target.value = formatoNombrePropio(e.target.value); });
  });
}

/**
 * El nombre de un LUGAR en formato de nombre propio.
 *
 * NO SIRVE formatoNombrePropio, que es para nombres de PERSONA y capitaliza
 * todas las palabras: dejaría «Santa Fe De Antioquia» y «Bogotá, D.c.». Un
 * topónimo tiene tres cosas que aquella no sabe.
 *
 * 1. LOS ENLACES VAN EN MINÚSCULA: de, del, y, e. «Loma del Guamo», «Santa
 *    Fe de Siapana», «Brisas del Oriente».
 *
 * 2. EL ARTÍCULO SOLO BAJA SI VIENE DETRÁS DE UN ENLACE. «Alto de las
 *    Palmas» y «Hato de la Virgen», pero «Honduras La Motilona» y «Canoas La
 *    Vega», donde «La Motilona» es un nombre por su cuenta. Bajarlo siempre
 *    arreglaba el primer caso y estropeaba el segundo; los dos existen en el
 *    catálogo.
 *
 * 3. LAS SIGLAS NO SE TOCAN: «Bogotá, D.C.», no «D.c.». Son 89 nombres con
 *    punto en el catálogo nacional.
 *
 * Y se capitaliza también detrás de un paréntesis, que formatoNombrePropio
 * no contempla: hay 135 nombres con paréntesis —«Pital (Chimbuzal)»— y sin
 * esto quedaban «Pital (chimbuzal)».
 */
const ENLACES_LUGAR = new Set(['de', 'del', 'y', 'e']);
const ARTICULOS_LUGAR = new Set(['la', 'las', 'los', 'el']);

function nombreLugar(texto) {
  const bruto = (texto == null ? '' : String(texto)).trim();
  if (!bruto) return '';
  // Si ya viene en minúsculas o mezclado, se respeta: solo se reformatea lo
  // que llega TODO en mayúsculas, que es como lo guarda el catálogo. Así un
  // nombre escrito a mano por la campaña no se «corrige» a la fuerza.
  if (bruto !== bruto.toUpperCase()) return bruto;

  const palabras = bruto.toLowerCase().split(/(\s+)/);
  let anterior = '';
  return palabras.map((p) => {
    if (/^\s+$/.test(p) || !p) return p;
    const limpia = p.replace(/[(),.]/g, '');
    let salida;
    if (/^(?:[a-záéíóúñü]\.){2,}$/.test(p)) {
      salida = p.toUpperCase();                       // sigla: D.C.
    } else if (anterior && ENLACES_LUGAR.has(limpia)) {
      salida = p;                                     // de, del, y, e
    } else if (anterior && ARTICULOS_LUGAR.has(limpia) && ENLACES_LUGAR.has(anterior)) {
      salida = p;                                     // «de las Palmas»
    } else {
      // Mayúscula en la primera letra, y también detrás de «(» o «-».
      salida = p.replace(/(^|[(\-])([a-záéíóúñü])/g, (m, sep, letra) => sep + letra.toUpperCase());
    }
    anterior = limpia;
    return salida;
  }).join('');
}

/**
 * Escapa texto para meterlo en HTML sin que un dato con `<` o `&` rompa la
 * página —o peor, inyecte etiquetas—.
 *
 * VIVE AQUÍ, en el archivo que cargan las 24 pantallas, y no copiada en cada
 * una. Nueve pantallas tienen su propia copia idéntica y siguen funcionando
 * (una declaración de función no choca con otra), pero la décima —Votantes—
 * la llamó sin tenerla y el botón «Editar» dejó de abrir el formulario: un
 * ReferenceError que solo aparece al hacer clic. Es el mismo fallo que ya
 * había pasado en CRM y Mensajes con esta misma función.
 *
 * Definirla una vez donde todas la ven es lo que impide que vuelva a pasar.
 * Las copias de las otras pantallas se pueden ir quitando sin apuro.
 */
/* apoyosEnOrden() y APOYOS_SI_NO_LLEGA_LA_LISTA se mudaron a
   /js/apoyos.js: el formulario de la app de celular las necesita y NO carga
   este archivo. Ver la explicación completa allí. */

/**
 * NOMBRES DE LUGAR EN NOMBRE PROPIO, EN TODA LA APLICACIÓN.
 *
 * El catálogo guarda los territorios en mayúscula sostenida —«LA ENEA», «SAN
 * PEREGRINO»— y así llegaban a las pantallas. Aquí se corrige la SALIDA, sin
 * tocar el dato: nombreLugar() decide cómo se escribe y este vigilante lo
 * aplica allí donde aparece.
 *
 * DOS SITIOS, Y SE TRATAN DISTINTO:
 *
 *   <datalist> — la opción ES el texto que se escribe en el campo, así que se
 *                reformatea su `value`. Cambiarlo no rompe nada: quien
 *                compara esos nombres lo hace ignorando mayúsculas y tildes.
 *
 *   <select>   — se reformatea SOLO el texto visible, NUNCA el `value`. Ahí
 *                el value suele ser un id, y en algunos filtros es el nombre
 *                exacto con el que se compara contra la base; tocarlo dejaría
 *                el filtro sin encontrar nada.
 *
 * VA EN common.js Y NO EN listas-desplegables.js porque este archivo se carga
 * en las 25 pantallas y aquel solo en seis. Con el vigilante allí, los
 * desplegables de Enviar SMS, CRM, Configuración o el tablero se quedaban en
 * mayúscula sostenida sin que nada lo explicara.
 *
 * Se acota por el id o el name del elemento: hay listas de documentos, de
 * eventos o de cuentas del dispositivo a las que este formato no les aplica.
 */
const ES_NOMBRE_DE_LUGAR = /(departamento|depto|municipio|ciudad|comuna|corregimiento|barrio|vereda|territorio|zona)/i;

function vigilarNombresDeLugar(elemento, campo) {
  if (elemento.dataset.nombrePropio === 'si') return;
  elemento.dataset.nombrePropio = 'si';

  const aplicar = () => {
    for (const opcion of elemento.options || []) {
      if (campo === 'valor') {
        const bonito = nombreLugar(opcion.value);
        if (bonito !== opcion.value) opcion.value = bonito;
        // En un datalist el texto sobra: el navegador muestra el value.
        if (opcion.textContent && opcion.textContent !== opcion.value) opcion.textContent = '';
      } else {
        // Las opciones de encabezado —«Todas», «Seleccione...»— no son
        // lugares: se reconocen porque su value está vacío.
        if (!opcion.value) continue;
        const bonito = nombreLugar(opcion.textContent);
        if (bonito !== opcion.textContent) opcion.textContent = bonito;
      }
    }
  };

  // Se desconecta mientras escribe, o se llamaría a sí mismo sin parar.
  const observador = new MutationObserver(() => {
    observador.disconnect();
    aplicar();
    observador.observe(elemento, { childList: true });
  });
  aplicar();
  observador.observe(elemento, { childList: true });
}

/** Engancha los datalist y select de lugares que haya ahora mismo en la página. */
function normalizarNombresDeLugar(raiz) {
  if (typeof nombreLugar !== 'function') return;
  const base = raiz || document;
  base.querySelectorAll('datalist').forEach((l) => {
    if (ES_NOMBRE_DE_LUGAR.test(l.id || '')) vigilarNombresDeLugar(l, 'valor');
  });
  base.querySelectorAll('select').forEach((sel) => {
    if (ES_NOMBRE_DE_LUGAR.test((sel.id || '') + ' ' + (sel.name || ''))) vigilarNombresDeLugar(sel, 'texto');
  });
}
window.normalizarNombresDeLugar = normalizarNombresDeLugar;

(function engancharNombresDeLugar() {
  // Los desplegables que una pantalla crea DESPUÉS —CRM arma uno por cada
  // grupo de destinatarios— no existirían en la primera pasada. En vez de
  // pedirle a cada pantalla que se acuerde de avisar, se vuelve a mirar
  // cuando el documento cambia. La revisión es barata: los ya enganchados
  // llevan una marca y se saltan.
  let pendiente = false;
  const revisar = () => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => { pendiente = false; normalizarNombresDeLugar(); });
  };
  const arrancar = () => {
    normalizarNombresDeLugar();
    new MutationObserver((cambios) => {
      for (const c of cambios) {
        for (const nodo of c.addedNodes) {
          if (nodo.nodeType === 1 && (nodo.tagName === 'SELECT' || nodo.tagName === 'DATALIST' || nodo.querySelector)) {
            revisar();
            return;
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();
})();

/* ------------------------------------------------------------------
   Marca de la barra lateral: el nombre, la bajada y el logo que cada
   campana puede cambiar desde Configuracion -> Datos de la campana.     */
/**
 * La identidad de la CAMPANA. Vacia por defecto — y vacia significa que no
 * se pinta nada, no que se pinte un texto de relleno.
 *
 * Antes traia aqui el nombre de la plataforma. Dejo de tener sentido cuando
 * la firma de la plataforma paso a su propio bloque (MARCA_PLATAFORMA, justo
 * abajo): una instalacion recien creada mostraba «ESTRATEGIA» dos veces, una
 * encima de la otra.
 */
const MARCA_POR_DEFECTO = {
  titulo: '',
  subtitulo: '',
  logo_url: '',
};

/**
 * La firma de quien hace la herramienta. NO es configurable: la campana
 * edita lo de arriba, esto es de la plataforma y va igual en todas.
 */
const MARCA_PLATAFORMA = {
  nombre: 'ESTRATEGIA | Marketing Político',
  // Dos lineas EXPLICITAS, no una sola que se parta donde alcance. Dejada al
  // ancho, quedaba «...de Campanas / Electorales», con una palabra suelta
  // abajo. El corte es una decision de como se lee, no del tamano de la barra.
  bajada: ['Administración Integral', 'de Campañas Electorales'],
};
const CLAVE_MARCA = 'marca_barra_lateral';

function leerMarcaGuardada() {
  try {
    const crudo = localStorage.getItem(CLAVE_MARCA);
    if (crudo) return JSON.parse(crudo);
  } catch (err) { /* si no se puede leer, se usa lo de siempre */ }
  return { ...MARCA_POR_DEFECTO };
}

/**
 * Trae la marca del servidor y actualiza la barra si cambio.
 *
 * Solo toca el DOM cuando hay diferencia: reescribirlo en cada carga hace
 * parpadear el logo aunque no haya cambiado nada.
 */
async function refrescarMarca() {
  let m;
  try {
    m = await api('/configuracion/marca');
  } catch (err) { return; }   // sin red se queda con lo guardado, que es lo correcto
  try { localStorage.setItem(CLAVE_MARCA, JSON.stringify(m)); } catch (e) {}

  const titulo = m.titulo || '';
  const subtitulo = m.subtitulo || '';
  const logo = m.logo_url || '/img/logo.png';
  const elTitulo = document.getElementById('marca-titulo');
  const elSub = document.getElementById('marca-subtitulo');
  const elLogo = document.getElementById('marca-logo-img');
  // Vacio se OCULTA. Con textContent = '' el div sigue ocupando su margen y
  // deja un hueco entre el logo y la firma que parece un error de dibujo.
  if (elTitulo) {
    if (elTitulo.textContent !== titulo) elTitulo.textContent = titulo;
    elTitulo.style.display = titulo ? '' : 'none';
  }
  if (elSub) {
    if (elSub.textContent !== subtitulo) elSub.textContent = subtitulo;
    elSub.style.display = subtitulo ? '' : 'none';
  }
  if (elLogo && !elLogo.src.endsWith(logo)) elLogo.src = logo;
  pintarSoporte(m.telefono_soporte);
}

/* EL GLIFO DE WHATSAPP, EN LINEA Y NO COMO IMAGEN.

   Sin fichero nuevo y sin peticion de red: la barra lateral se pinta tambien
   sin señal —el cascaron esta en la cache del navegador— y un <img> a un
   archivo que no estuviera cacheado dejaria el renglon con el hueco justo
   cuando mas falta hace escribir al soporte.

   `currentColor` en el relleno para que el color viva en la hoja de estilos y
   no aqui: hoy es el verde de la marca, fijo, y cambiarlo es una linea en
   `.nav-soporte .icono` sin volver a tocar el glifo.

   `aria-hidden` porque al lado va la palabra «Soporte»: un lector de pantalla
   que anunciara el icono diria dos veces lo mismo. */
const ICONO_WHATSAPP =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false">'
  + '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164'
  + '-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458'
  + '.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612'
  + '-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016'
  + '-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227'
  + ' 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347'
  + 'm-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26'
  + 'c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437'
  + ' 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588'
  + ' 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0'
  + ' 0 0-3.48-8.413Z"/></svg>';

/**
 * EL ENLACE DE SOPORTE DE LA BARRA LATERAL.
 *
 * El número lo escribe el Administrador de la aplicación en su propia cuenta y
 * llega con la marca, así que esto se llama dos veces: al pintar la barra con
 * lo guardado —para que el enlace esté desde el primer instante, incluso sin
 * señal— y otra vez cuando el servidor responde.
 *
 * Sin número no se pinta nada. Un «Soporte» que abre un WhatsApp vacío es peor
 * que no ofrecerlo: la persona cree que escribió y nadie recibe.
 */
function pintarSoporte(telefono) {
  const el = document.getElementById('nav-soporte');
  if (!el) return;
  const digitos = String(telefono || '').replace(/\D/g, '');
  if (!digitos) { el.style.display = 'none'; return; }
  const internacional = digitos.startsWith('57') ? digitos : '57' + digitos;
  const visible = digitos.length === 10 ? formatoTelefonoColombia(digitos) : digitos;
  el.href = 'https://wa.me/' + internacional;
  el.title = 'Escribir al soporte por WhatsApp';
  // `abrirWhatsApp` ya existe y anula `window.opener` antes de soltar la
  // pestaña nueva; se reutiliza en vez de repetir aquí esa precaución.
  el.onclick = (e) => abrirWhatsApp(e, internacional);
  el.innerHTML = '<span class="icono">' + ICONO_WHATSAPP + '</span>'
    + '<span>Soporte<small>' + escaparHtml(visible) + '</small></span>';
  el.style.display = '';
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto == null ? '' : String(texto);
  return div.innerHTML;
}

/**
 * Formatea un teléfono colombiano de 10 dígitos: "3001234567" ->
 * "300 123 4567". Se usa en todos los campos de teléfono personal de la
 * app (candidato, usuarios, cargos del organigrama...) — NO aplica a los
 * números de SendGrid/Twilio de Configurar CRM, que son identificadores
 * internacionales con otro formato (+15017122661, whatsapp:+...).
 */
function formatoTelefonoColombia(valor) {
  const digitos = (valor || '').toString().replace(/\D/g, '').slice(0, 10);
  const partes = [digitos.slice(0, 3), digitos.slice(3, 6), digitos.slice(6, 10)].filter(Boolean);
  return partes.join(' ');
}

/**
 * Celda de teléfono con el enlace para escribirle por WhatsApp.
 *
 * POR QUÉ UN ENLACE Y NO UN ENVÍO DESDE EL SERVIDOR
 *   Escribir por la API de WhatsApp Business obliga a plantillas aprobadas
 *   por Meta y mete a la campaña en su política de contenido. Un enlace
 *   `wa.me` no es la API: abre WhatsApp Web en el computador —o la app en el
 *   celular— con el chat de esa persona listo, y el mensaje lo escribe y lo
 *   manda quien está sentado ahí, desde su propia cuenta. No cuesta créditos
 *   ni pasa por ningún proveedor.
 *
 * Es el mismo patrón que la app móvil ya usa en «Mis registros».
 *
 * El 57 se agrega solo si no viene: los teléfonos se capturan a 10 dígitos,
 * pero algunos vienen ya con indicativo. Sin esa comprobación, un número que
 * ya lo traía terminaría en 5757…
 *
 * Devuelve el guion largo si no hay teléfono — la celda nunca queda vacía.
 */
/**
 * Abre WhatsApp reutilizando SIEMPRE la misma pestaña.
 *
 * Con `target="_blank"` cada clic abría una pestaña nueva, y tras revisar
 * diez contactos quedaban diez pestañas de WhatsApp. Con un nombre de
 * ventana fijo, el navegador reutiliza la que ya existe y `focus()` la trae
 * al frente: si WhatsApp Web ya está abierto ahí, solo cambia el chat.
 *
 * LO QUE NO SE PUEDE HACER, PARA NO PROMETERLO: si la pestaña de WhatsApp la
 * abrió la persona por su cuenta, ninguna página puede apoderarse de ella —
 * un sitio solo alcanza las ventanas que él mismo abrió. La primera vez se
 * abrirá una pestaña nueva; a partir de ahí se reutiliza esa.
 *
 * `opener = null` va DESPUÉS de abrirla, y no con rel="noopener" en el
 * enlace: `noopener` obliga al navegador a crear una ventana anónima cada
 * vez, o sea que habría anulado justo la reutilización que se busca. Así se
 * consiguen las dos cosas — se reutiliza y la página abierta no conserva un
 * puntero a esta.
 */
/**
 * Abre WhatsApp con este número, reutilizando la pestaña si ya está abierta.
 *
 * `texto` es opcional: si viene, el mensaje va escrito y listo para enviar.
 * Va codificado porque lleva saltos de línea y el enlace de la aplicación.
 */
function abrirWhatsApp(evento, numeroInternacional, texto) {
  if (evento && evento.preventDefault) evento.preventDefault();
  const conTexto = texto ? `?text=${encodeURIComponent(texto)}` : '';
  const ventana = window.open(`https://wa.me/${numeroInternacional}${conTexto}`, 'whatsappWeb');
  if (!ventana) return;                       // el navegador la bloqueó
  try { ventana.opener = null; } catch (err) { /* algunos navegadores no dejan */ }
  try { ventana.focus(); } catch (err) { /* si no deja enfocar, ya se abrió */ }
}

function celdaTelefonoWhatsApp(telefono) {
  const digitos = String(telefono || '').replace(/\D/g, '');
  if (!digitos) return '—';

  const visible = digitos.length === 10 ? formatoTelefonoColombia(digitos) : digitos;
  const internacional = digitos.startsWith('57') ? digitos : '57' + digitos;

  // El número y el ícono van dentro de un mismo contenedor que NO se parte:
  // el número lleva espacios («300 123 1234») y en una columna angosta la
  // tabla lo cortaba en dos renglones, dejando el ícono suelto abajo. El
  // `nowrap` está en la hoja, no aquí, para poder ajustarlo sin tocar el JS.
  //
  // rel="noopener" no es adorno: sin él, la pestaña que se abre puede tocar
  // la que la abrió a través de window.opener.
  return `<span class="tel-whatsapp">${visible}
    <a href="https://wa.me/${internacional}" target="whatsappWeb"
       onclick="abrirWhatsApp(event, '${internacional}')"
       class="enlace-whatsapp" title="Escribir por WhatsApp a este número"
       aria-label="Escribir por WhatsApp">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.06c-.24.68-1.42 1.31-1.96 1.35-.5.04-.98.22-3.3-.69-2.79-1.1-4.55-3.96-4.69-4.14-.13-.18-1.11-1.48-1.11-2.82 0-1.34.7-2 .95-2.27.25-.27.54-.34.72-.34.18 0 .36 0 .52.01.17.01.39-.06.61.47.24.55.8 1.9.87 2.04.07.14.12.3.02.48-.09.18-.14.29-.28.45-.14.16-.29.36-.42.48-.14.14-.28.29-.12.57.16.28.72 1.19 1.55 1.93 1.07.95 1.97 1.25 2.25 1.39.28.14.44.12.61-.07.17-.19.7-.82.89-1.1.19-.28.37-.23.62-.14.25.09 1.6.75 1.87.89.28.14.46.21.53.32.07.12.07.66-.17 1.34z"/>
      </svg>
    </a>
  </span>`;
}

/** Quita el mensaje de error (si lo había) y el resaltado rojo de un campo de teléfono. */
function ocultarErrorTelefono(input) {
  input.style.borderColor = '';
  const siguiente = input.nextElementSibling;
  if (siguiente && siguiente.classList && siguiente.classList.contains('error-telefono')) siguiente.remove();
}

/**
 * Valida que un campo de teléfono, SI tiene algo escrito, tenga
 * exactamente 10 dígitos — si no, resalta el campo en rojo y muestra
 * "Error de digitación" justo debajo. Campo vacío se considera válido
 * (el teléfono es opcional en toda la app). Devuelve true/false.
 */
function validarTelefonoCampo(input) {
  ocultarErrorTelefono(input);
  const digitos = input.value.replace(/\D/g, '');
  if (digitos.length === 0 || digitos.length === 10) return true;
  input.style.borderColor = '#c0392b';
  const aviso = document.createElement('small');
  aviso.className = 'error-telefono';
  aviso.style.cssText = 'color:#c0392b; display:block; margin-top:4px; font-size:0.78rem;';
  aviso.textContent = 'Error de digitación';
  input.insertAdjacentElement('afterend', aviso);
  return false;
}

/**
 * Valida TODOS los campos de teléfono que coincidan con el selector —
 * pensado para llamarse justo antes de enviar un formulario. Devuelve
 * true solo si todos son válidos (o están vacíos).
 */
function validarTelefonosFormulario(selector) {
  let todosValidos = true;
  document.querySelectorAll(selector).forEach(input => {
    if (!validarTelefonoCampo(input)) todosValidos = false;
  });
  return todosValidos;
}

/**
 * Aplica el formato "### ### ####" mientras la persona escribe (así ve
 * los espacios de una vez), limita a 10 dígitos, y valida al salir del
 * campo (blur). Uso típico:
 *   aplicarFormatoTelefono('#form-campana [name="telefono"], #usuario-form-telefono');
 */
function aplicarFormatoTelefono(selector) {
  document.querySelectorAll(selector).forEach(input => {
    input.addEventListener('input', (e) => {
      const alFinal = e.target.selectionStart === e.target.value.length;
      e.target.value = formatoTelefonoColombia(e.target.value);
      if (alFinal) e.target.setSelectionRange(e.target.value.length, e.target.value.length);
      ocultarErrorTelefono(e.target);
    });
    input.addEventListener('blur', (e) => validarTelefonoCampo(e.target));
  });
}

/**
 * Formatea un número entero con separador de miles estilo Colombia/
 * Latinoamérica (punto cada tres dígitos: 1.234.567). Se usa en toda la
 * app para mostrar cifras (metas, registros, conteos, cifras de
 * finanzas) — nunca para IDs, teléfonos, cédulas ni años.
 */
function formatoMillares(numero) {
  const n = Number(numero);
  if (numero === null || numero === undefined || numero === '' || !Number.isFinite(n)) return String(numero ?? '0');
  return n.toLocaleString('es-CO');
}

/**
 * Texto de la cuenta regresiva para elecciones — a partir de la Fecha de
 * elecciones guardada en Configuración → Datos de la campaña (fecha_eleccion,
 * formato "YYYY-MM-DD"), comparada contra la fecha de hoy. Se usa en el
 * Panel general y en el Dashboard de votantes, antes de sus tarjetas de
 * resumen — mismo texto y mismas reglas en los dos lugares.
 */
function diasParaLasElecciones(fechaEleccionIso) {
  if (!fechaEleccionIso) {
    return { dias: null, cifra: null, leyenda: 'Configure la fecha en Configuración' };
  }
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fecha = new Date(fechaEleccionIso + 'T00:00:00');
  const dias = Math.round((fecha - hoy) / 86400000);
  if (dias > 1)  return { dias, cifra: String(dias), leyenda: 'días para las elecciones' };
  if (dias === 1) return { dias, cifra: '1', leyenda: 'día para las elecciones' };
  if (dias === 0) return { dias, cifra: null, leyenda: '¡Hoy son las elecciones!' };
  return { dias, cifra: null, leyenda: 'Ya se realizaron las elecciones' };
}

/**
 * La cuenta regresiva EN UNA FRASE, para quien la muestre de corrido.
 *
 * SE ARMA SOBRE `diasParaLasElecciones` Y NO REPITE LA CUENTA. El Panel general
 * necesita el número y la leyenda por separado —el número va a 92px y la
 * leyenda debajo, en versalitas— y la tentación era escribir esa resta una
 * segunda vez allá. Dos implementaciones de la misma regla es exactamente la
 * clase de cosa que se separa sin que nadie lo note: la de aquí redondea con
 * `Math.round` sobre milisegundos, y una copia hecha a ojo con `Math.floor`
 * daría un día menos la mitad del año.
 */
function textoCuentaRegresivaElecciones(fechaEleccionIso) {
  const c = diasParaLasElecciones(fechaEleccionIso);
  if (c.cifra === null) return c.leyenda;
  return `${c.dias === 1 ? 'Falta' : 'Faltan'} ${c.cifra} ${c.leyenda}`;
}

/**
 * Revisan el permiso de Editar/Agregar nuevo de un módulo para el usuario
 * actual (definidos en Configuración → Asignación de permisos). Si no hay
 * datos de permisos para ese módulo (por ejemplo, la consulta falló, o el
 * módulo no tiene esta granularidad todavía), se asume permitido por
 * defecto — para no ocultarle de golpe un botón a alguien por un problema
 * ajeno a sus permisos reales.
 */
function puedeEditar(usuario, modulo) {
  const permiso = usuario && usuario.permisos && usuario.permisos[modulo];
  return permiso ? !!permiso.editar : true;
}
function puedeAgregar(usuario, modulo) {
  const permiso = usuario && usuario.permisos && usuario.permisos[modulo];
  return permiso ? !!permiso.agregar : true;
}
/**
 * El tercer permiso, «Ver», que faltaba.
 *
 * Para el menú lateral esto lo decidía itemVisible(), dentro de la función que
 * lo pinta y sin exponerse a nadie. Hacía falta fuera: la pestaña Usuarios de
 * Configuración no es un elemento del menú y necesita la misma pregunta.
 *
 * Misma convención que sus dos hermanas: sin datos de permisos se asume que sí
 * —esconderle algo a alguien porque una consulta falló es peor que mostrarlo—.
 */
function puedeVer(usuario, modulo) {
  const permiso = usuario && usuario.permisos && usuario.permisos[modulo];
  return permiso ? !!permiso.ver : true;
}

/**
 * El cuarto permiso, «Importar / Exportar»: los botones de importar, exportar e
 * imprimir a PDF de un módulo.
 *
 * FALLA CERRADO, y es lo contrario de sus tres hermanas. Aquéllas, sin datos de
 * permisos, dicen que sí para no esconderle un botón a nadie por un fallo ajeno.
 * Éste dice que no: lo que abre son listados de personas con cédula y teléfono, y
 * si `/permisos/mios` falló —o la fila del módulo no existe— el botón no debe
 * salir. El servidor lo exige igual (middleware/permisoModulo.js); esto solo
 * evita ofrecer lo que va a responder 403.
 *
 * SE PREGUNTA POR `rol_sesion` Y NO POR `rol`. Para el aspirante, `inicializarLayout`
 * reescribe `rol` a 'admin' para poder DIBUJAR el panel de administración; con
 * `rol` aquí, el aspirante pasaría por administrador. La regla está escrita en
 * `inicializarLayout`: quien decida permisos pregunta por `rol_sesion`.
 *
 * EL ADMINISTRADOR SIEMPRE PUEDE: el servidor no le pregunta a la matriz por él,
 * y la casilla del administrador no existe como decisión de nadie.
 */
function puedeImportarExportar(usuario, modulo) {
  if (!usuario) return false;
  if (usuario.rol_sesion === 'admin') return true;
  const permiso = usuario.permisos && usuario.permisos[modulo];
  return !!(permiso && permiso.importar_exportar);
}

/**
 * La clase que esconde un control cuando el permiso falta, para armarla DENTRO de
 * las plantillas de texto que pintan botones desde JavaScript:
 *
 *   `<a class="btn ${claseImportarExportar(usuarioActual, 'organigrama')}" ...>`
 *
 * Devuelve '' si se puede y 'sin-importar-exportar' si no —y si no hay usuario
 * todavía, también esconde: el control nace oculto salvo que se demuestre lo
 * contrario, no al revés.
 */
function claseImportarExportar(usuario, modulo) {
  return puedeImportarExportar(usuario, modulo) ? '' : 'sin-importar-exportar';
}

/**
 * Recorre la página y deja visibles solo los controles `[data-ie="modulo"]` que el
 * usuario puede usar. Se llama sola al terminar `inicializarLayout`; hay que
 * llamarla a mano solo tras pintar controles nuevos desde JavaScript.
 *
 * LOS CONTROLES NACEN OCULTOS en el HTML (`class="sin-importar-exportar"`) y esta
 * función solo les quita la clase. Si el script falla, o `/permisos/mios` tarda,
 * no hay un instante en que se vean — que es lo que pasaría con la lógica al
 * revés (visibles hasta que se compruebe).
 *
 * Se esconde con una CLASE y no con `style.display`: varias pantallas ponen
 * `style.display = ''` por su cuenta al decidir qué mostrar, y esto no puede
 * dejarse deshacer por ellas.
 */
function aplicarImportarExportar(usuario, raiz) {
  (raiz || document).querySelectorAll('[data-ie]').forEach((el) => {
    el.classList.toggle('sin-importar-exportar', !puedeImportarExportar(usuario, el.dataset.ie));
  });
}

/**
 * Muestra un modal pidiendo la contraseña de un administrador y devuelve la
 * contraseña ingresada (o null si se cancela). Se usa como confirmación
 * extra antes de acciones destructivas (eliminaciones masivas). La
 * verificación real de la contraseña ocurre en el servidor, en el mismo
 * endpoint que ejecuta la acción.
 */
/**
 * Pide la contraseña de QUIEN esta usando la aplicacion.
 *
 * Hermano de solicitarPasswordAdmin, con otra pregunta: aquel dice «¿es usted
 * administrador?», este dice «¿es usted?». Se usa al editar o eliminar un
 * votante, que un lider SI puede hacer: pedirle la clave del administrador le
 * quitaria esa capacidad, pedirle la suya solo le pide confirmar.
 *
 * Devuelve la contraseña escrita, o null si cancelo.
 */
/**
 * Confirmar SIN `confirm()`, con el modal de la propia aplicación.
 *
 * POR QUÉ EXISTE. `confirm()` es una ventana del navegador, y el navegador la
 * apaga: tras varias seguidas ofrece «impedir que esta página cree más
 * diálogos», y si alguien lo marca —o lo marca sin querer— a partir de ahí
 * `confirm()` devuelve `false` de inmediato, sin preguntar nada. El código lo
 * lee como «el usuario dijo que no» y se va en silencio.
 *
 * El efecto es un botón muerto: se pulsa y NO PASA NADA DE NADA. Ni diálogo,
 * ni error, ni nada en la consola. Es imposible de diagnosticar mirando la
 * pantalla, y le pasa justo a quien más usa la aplicación, porque la
 * supresión se activa después de varios diálogos seguidos.
 *
 * Esto pinta un modal propio, que es DOM de la página: el navegador no tiene
 * ninguna forma de suprimirlo. Devuelve una promesa que resuelve a true o a
 * false, así que sustituye a `confirm()` con sólo poner `await` delante.
 */
function confirmarEnModal(titulo, explicacion, textoBoton) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay abierto';
    overlay.innerHTML = `
      <div class="modal" style="max-width:430px;">
        <div class="modal-header"><h3>${escaparHtml(titulo || '¿Confirma?')}</h3></div>
        <p style="color:var(--color-text-muted); font-size:0.9rem; line-height:1.5; white-space:pre-line;">${escaparHtml(explicacion || '')}</p>
        <div style="display:flex; gap:10px; margin-top:14px;">
          <button type="button" class="btn-primario" id="si-confirmar-modal">${escaparHtml(textoBoton || 'Confirmar')}</button>
          <button type="button" class="btn-secundario" id="no-confirmar-modal">Cancelar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const cerrar = (valor) => { overlay.remove(); resolve(valor); };
    overlay.querySelector('#si-confirmar-modal').addEventListener('click', () => cerrar(true));
    overlay.querySelector('#no-confirmar-modal').addEventListener('click', () => cerrar(false));
    // Clic fuera y Escape cancelan, como en el resto de los modales.
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(false); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', esc); cerrar(false); }
    });
    overlay.querySelector('#si-confirmar-modal').focus();
  });
}

function solicitarPasswordPropia(titulo, explicacion) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay abierto';
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px;">
        <div class="modal-header"><h3>${escaparHtml(titulo || 'Confirme con su contraseña')}</h3></div>
        <p style="color:var(--color-text-muted); font-size:0.85rem;">${escaparHtml(explicacion || 'Escriba su propia contraseña para confirmar.')}</p>
        <div class="mensaje-error" id="error-password-propia"></div>
        <form id="form-password-propia">
          <div class="campo"><label>Su contraseña</label>
            <input type="password" name="password" autocomplete="current-password" required></div>
          <div style="display:flex; gap:10px;">
            <button type="submit" class="btn-primario">Confirmar</button>
            <button type="button" class="btn-secundario" id="cancelar-password-propia">Cancelar</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    activarVerContrasena(overlay);
    const campo = overlay.querySelector('input[name="password"]');
    setTimeout(() => campo.focus(), 50);
    const cerrar = (valor) => { overlay.remove(); resolve(valor); };
    overlay.querySelector('#cancelar-password-propia').addEventListener('click', () => cerrar(null));
    overlay.querySelector('#form-password-propia').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = campo.value;
      if (!v) return;
      cerrar(v);
    });
  });
}

/**
 * Pide la contraseña propia Y LA COMPRUEBA CONTRA EL SERVIDOR en ese instante.
 *
 * Es lo que hace falta para pedirla AL PULSAR el botón en vez de al guardar.
 * Sin la comprobación, «preguntar al abrir» es teatro: el formulario se abriría
 * con cualquier cosa escrita y el rechazo llegaría igual al final, que es justo
 * lo que se quería evitar. El patrón ya estaba en Configuración → Usuarios; esto
 * lo saca a un solo sitio para que Estructura y Votantes no lo copien.
 *
 * NO AUTORIZA NADA. Lo comprueba el navegador, y lo que diga el navegador no es
 * una autorización: la ruta que ejecuta la acción vuelve a exigir la contraseña
 * por su cuenta. Quien la llame directamente se topa con la misma comprobación.
 *
 * Devuelve la contraseña ya comprobada, o null si cancelaron o no era la suya.
 */
/**
 * LOS ROLES QUE PUEDEN TENER GENTE A CARGO, TAL COMO LOS DEVUELVE /usuarios.
 *
 * Ojo con de dónde sale el rol, que es lo que hace falta entender aquí:
 * `req.session.usuario.rol` viene TRADUCIDO —un `aspirante_concejo` viaja en la
 * sesión como `lider`, y por eso los `requireRole` y la matriz de permisos no
 * hubo que tocarlos—. Pero `/usuarios` devuelve el rol CRUDO de la base, sin
 * pasar por esa traducción.
 *
 * Así que los filtros del navegador que se arman con esa lista SÍ ven
 * `aspirante_concejo`, y los que decían `['coordinador','lider']` dejaron de
 * encontrar a los aspirantes en cuanto la categoría empezó a darles su rol:
 * desaparecían del buscador de líderes, del filtro «Todos los líderes» y de
 * «Reporta a». La lista va aquí para que sean uno y no tres.
 */
const ROLES_CON_GENTE_A_CARGO = ['coordinador', 'aspirante_concejo', 'lider'];

/* NOMBRE_DEL_ROL y no ETIQUETAS_ROL: ese nombre YA existe, declarado en el
   script de configuracion.html para su matriz de permisos. common.js y el
   script de cada pagina comparten el mismo ambito global, asi que dos `const`
   con el mismo nombre no se pisan: revientan con SyntaxError y el navegador
   descarta el BLOQUE ENTERO de la pagina.
   Paso de verdad —parche 164— y el sintoma no apuntaba a esto: Configuracion
   se quedaba con los campos vacios y en la pestaña equivocada, porque su
   script no llego a ejecutarse ni una linea. `node --check` sobre common.js no
   lo ve: cada archivo por separado es valido; el choque solo existe cuando el
   navegador los junta. */
const NOMBRE_DEL_ROL = {
  coordinador: 'coordinador',
  aspirante_concejo: 'Aspirante al Concejo',
  lider: 'líder',
  sublider: 'sublíder',
  usuario: 'sublíder',
};
function etiquetaRol(rol) { return NOMBRE_DEL_ROL[rol] || rol; }

async function confirmarConPasswordPropia(titulo, explicacion) {
  const clave = await solicitarPasswordPropia(titulo, explicacion);
  if (!clave) return null;
  try {
    await api('/auth/verificar-password', { method: 'POST', body: { password: clave } });
  } catch (err) {
    // El mensaje del servidor distingue «no es la suya» de «demasiados
    // intentos», y son dos cosas muy distintas para quien está esperando.
    alert(err.message || 'Contraseña incorrecta.');
    return null;
  }
  return clave;
}

function solicitarPasswordAdmin(titulo) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay abierto';
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px;">
        <div class="modal-header"><h3>${titulo || 'Confirmar con contraseña de administrador'}</h3><button class="modal-cerrar" id="cerrar-modal-password-admin">×</button></div>
        <p style="color:var(--color-text-muted); font-size:0.85rem;">Esta acción no se puede deshacer. Ingrese la contraseña de un administrador para continuar.</p>
        <div id="password-admin-error" class="mensaje-error"></div>
        <form id="form-password-admin">
          <div class="campo"><label>Contraseña de administrador</label><input type="password" name="password" required></div>
          <button type="submit" class="btn-primario">Confirmar</button>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    activarVerContrasena(overlay);   // el campo nace aquí, no estaba al cargar

    const inputPassword = overlay.querySelector('input[name="password"]');
    setTimeout(() => inputPassword.focus(), 50);

    function cerrar(valor) {
      overlay.remove();
      resolve(valor);
    }

    overlay.querySelector('#cerrar-modal-password-admin').addEventListener('click', () => cerrar(null));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) cerrar(null); });
    overlay.querySelector('#form-password-admin').addEventListener('submit', (e) => {
      e.preventDefault();
      cerrar(inputPassword.value);
    });
  });
}

async function inicializarLayout(paginaActiva) {
  // El favicon se agrega acá (en vez de en el <head> de cada página) para
  // no tener que editar decenas de archivos HTML cada vez que cambie.
  if (!document.querySelector('link[rel="icon"]')) {
    document.head.insertAdjacentHTML('beforeend',
      '<link rel="icon" type="image/x-icon" href="/favicon.ico">' +
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png">'
    );
  }

  // Si falla por falta de señal (no un 401 real), se usa la última sesión
  // verificada con éxito en este navegador en vez de mandar a iniciar
  // sesión de nuevo — mismo criterio que requerirSesionApp() en
  // app-comun.js, para que las pantallas de captura de escritorio
  // (Votantes, Estructura territorial, Testigos) también puedan abrir sin
  // conexión y no solo sus formularios de guardar.
  let sesion;
  try {
    sesion = await api('/auth/me');
    try { localStorage.setItem('app_usuario_verificado', JSON.stringify(sesion.usuario)); } catch (e) {}
  } catch (e) {
    if (e && e.esErrorDeRed) {
      try {
        const guardado = localStorage.getItem('app_usuario_verificado');
        if (guardado) sesion = { usuario: JSON.parse(guardado) };
      } catch (err) {}
    }
    if (!sesion) {
      window.location.href = '/login.html';
      return null;
    }
  }
  const usuario = sesion.usuario;

  /* EN SU PROPIA CAMPAÑA, EL ASPIRANTE ES EL ADMINISTRADOR.
     En la estructura de la campaña madre es un lider, y ese es su rol de
     verdad. Pero dentro de su sublicencia no le manda nadie: su gente, sus
     testigos y su marca son suyos, y las pantallas preguntaban por el rol para
     decidir si dibujar el boton de crear o el de editar.

     Con el rol crudo, DOS pantallas que ya tenian sus rutas abiertas y acotadas
     —Testigos electorales y Mapa territorial— le respondian «No tiene permisos
     para ver esta seccion» y se quedaban en blanco. El servidor decia que si y
     el navegador que no.

     ESTO SOLO CAMBIA LO QUE SE DIBUJA. La sesion del servidor sigue diciendo
     'lider', y ahi es donde se decide de verdad: cada ruta que el alcanza lleva
     su 'aspirante' escrito en la guarda y su filtro de rama. Si esta linea
     fuera la que da los permisos, bastaria con abrir la consola del navegador
     para ser administrador de la campaña madre.

     Se guarda el rol real por si alguna pantalla necesita distinguirlos. */
  /* EL ROL QUE DECIDE EN EL SERVIDOR, GUARDADO ANTES DE REESCRIBIRLO.
     La linea de abajo cambia `rol` para dibujar, y hay que saber que existen
     DOS valores del rol que pueden discrepar. Costo dos vueltas descubrirlo:
     la casilla de autorizacion de datos en Votantes se mostraba segun el rol,
     y para el aspirante con sublicencia el servidor decia 'lider' mientras el
     navegador decia 'admin' — asi que el guardado se rechazaba pidiendo marcar
     una casilla que la pantalla no dibujaba, porque se creia administradora.
     (Aquella pantalla ya no mira el rol: se le pide a todo el que registra. La
     trampa sigue estando, y por eso sigue anotado.)
     `rol_real` NO sirve para esto: para un aspirante al concejo SIN
     sublicencia vale 'aspirante_concejo', y el servidor en ese caso mira
     'lider'. El unico valor fiable es el que vino, sin tocar.
     REGLA: `rol` es para dibujar. Cualquier pantalla que necesite saber que va
     a decidir el servidor -permisos, guardas, campos obligatorios- pregunta
     por `rol_sesion`. Hoy no lo usa nadie; esta puesto para que el siguiente
     no tenga que volver a descubrirlo. */
  if (usuario) usuario.rol_sesion = usuario.rol;

  if (usuario && usuario.es_aspirante) {
    usuario.rol_real = usuario.rol;
    usuario.rol = 'admin';
  }

  const shell = document.getElementById('app-shell');

  const paginaBase = paginaActiva.split('#')[0];

  // Permisos por módulo del propio rol (Configuración → Asignación de
  // permisos). Si la consulta falla por cualquier motivo (tabla recién
  // creada, error de red, etc.), se usan los roles fijos de cada ítem como
  // respaldo — así nadie se queda sin menú por un problema de permisos.
  let modulosPermitidos = null;
  let hrefsPermitidos = null;
  try {
    const permisos = await api('/permisos/mios');
    modulosPermitidos = permisos.modulos;
    // Sólo el aspirante con sublicencia recibe esta lista, y recorta entrada por
    // entrada: «configuracion» son seis pantallas y a él le toca una.
    hrefsPermitidos = permisos.hrefs || null;
    // Se deja disponible en el objeto de usuario para que cada página
    // pueda mostrar/ocultar sus botones de Editar/Agregar nuevo según lo
    // configurado en Asignación de permisos (además de "Ver", que ya
    // controla el menú). Ej: usuarioActual.permisos.territorial.editar
    usuario.permisos = permisos.permisos || {};
  } catch (e) {
    modulosPermitidos = null;
    hrefsPermitidos = null;
    usuario.permisos = {};
  }
  function itemVisible(item) {
    // La lista de direcciones manda sobre la de módulos cuando llega: es más
    // fina. El servidor sólo la envía a quien la necesita.
    if (hrefsPermitidos) return hrefsPermitidos.includes(item.href);
    if (modulosPermitidos && item.modulo) return modulosPermitidos.includes(item.modulo);
    return !item.roles || item.roles.includes(usuario.rol);
  }

  const navHtml = NAV_ITEMS.map((item, indice) => {
    if (item.items) {
      // Menú principal con submenú: se muestra si al menos un hijo es visible
      // para el rol del usuario. Se puede contraer/expandir con un clic; por
      // defecto arranca expandido solo el grupo de la página actual. El
      // alto se anima con grid-template-rows (ver .nav-submenu en
      // style.css) en vez de un display:none/block instantáneo.
      const hijosVisibles = item.items.filter(itemVisible);
      if (!hijosVisibles.length) return '';
      /* UN GRUPO CON UN SOLO HIJO VISIBLE NO ES UN GRUPO: obligar a desplegar
         un menú para encontrar una única entrada es un clic que no informa de
         nada. Se pinta como entrada de primer nivel, con el NOMBRE DEL GRUPO,
         llevando derecho a esa página.

         VA POR GRUPO (`colapsarSiUno`) Y NO PARA TODOS, y la razón se puede
         medir. Aplicándola a todos, con la matriz de permisos de hoy:

           asistente_administrativo   «DÍA D»            -> Jornada electoral
           líder                      «CRM Y MENSAJERÍA» -> Aviso en la app
           testigo                    «LOGÍSTICA»        -> Eventos y GOTV

         Ese segundo caso es un rótulo que miente sobre su destino: quien lee
         «CRM y mensajería» no espera aterrizar en «Aviso en la app». En
         «Contenido para compartir» no pasa, porque el nombre del grupo y el
         de la pantalla dicen lo mismo. De ahí la bandera: se activa donde el
         nombre del grupo sirve de rótulo, no en todas partes por simetría.

         Y es una regla del pintado, no un ítem suelto escrito a mano, porque
         quien VE las tres pantallas debe seguir viendo el grupo con las tres.
         Al superadministrador le aparece una sola por el catálogo MODULOS
         (ver la nota en la definición del grupo), no porque haya una sola. */
      if (item.colapsarSiUno && hijosVisibles.length === 1) {
        const uno = hijosVisibles[0];
        // El «activo» NO se decide aquí sino en marcarActivoMenu(), que corre al pintar y en cada cambio de vista.
        return `<a href="${uno.href}" data-nav-href="${uno.href}"${uno.porDefecto ? ' data-nav-defecto="1"' : ''} class="nav-link-principal">
        <span class="icono">${item.iconoGrupo || '♜'}</span> ${item.grupo.toUpperCase()}
      </a>`;
      }
      const grupoId = `nav-grupo-${indice}`;
      const contieneActivo = hijosVisibles.some(sub => sub.href.split('#')[0] === paginaBase);
      const subHtml = hijosVisibles.map(sub =>
        `<a href="${sub.href}" data-nav-href="${sub.href}"${sub.porDefecto ? ' data-nav-defecto="1"' : ''} class="nav-sub-link">${sub.texto}</a>`).join('');
      return `
        <div class="nav-grupo-titulo ${contieneActivo ? 'grupo-abierto' : ''}" data-grupo="${grupoId}">
          <span class="icono">${item.iconoGrupo || '♜'}</span>
          <span class="nav-grupo-texto">${item.grupo.toUpperCase()}</span>
          <span class="nav-chevron">▸</span>
        </div>
        <div class="nav-submenu ${contieneActivo ? 'abierto' : ''}" data-submenu="${grupoId}">
          <div class="nav-submenu-inner">${subHtml}</div>
        </div>`;
    }
    // Ítem de primer nivel, sin submenú: misma fuente y mayúsculas que los
    // títulos de grupo, para que todos los "menús principales" se vean igual.
    if (!itemVisible(item)) return '';
    return `<a href="${item.href}" data-nav-href="${item.href}" class="nav-link-principal">
        <span class="icono">${item.icono || '♜'}</span> ${item.texto.toUpperCase()}
      </a>`;
  }).join('');

  // ---------------------------------------------------------------
  // LA MARCA DE LA BARRA LATERAL
  //
  // Se pinta PRIMERO con lo guardado en este navegador y DESPUES se
  // refresca contra el servidor. Al reves —esperar la respuesta— la barra
  // aparecería con la marca de la plataforma y cambiaría a la de la campaña
  // un instante despues, que es el parpadeo que se ve como un error.
  //
  // Vacio significa «use lo que trae la plataforma». Por eso los valores por
  // defecto viven aqui y no en la base: una instalacion que no configure nada
  // sigue viendose igual que siempre.
  const marcaInicial = leerMarcaGuardada();
  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  sidebar.innerHTML = `
    <div class="marca-logo" style="text-align:center; padding: 2px 0 4px;">
      <img id="marca-logo-img" src="${marcaInicial.logo_url || '/img/logo.png'}" alt="Logo"
           style="width:100%; max-width:170px; height:auto;">
    </div>
    <div class="marca" id="marca-titulo"${marcaInicial.titulo ? '' : ' style="display:none;"'}>${escaparHtml(marcaInicial.titulo || '')}</div>
    <div class="submarca" id="marca-subtitulo"${marcaInicial.subtitulo ? '' : ' style="display:none;"'}>${escaparHtml(marcaInicial.subtitulo || '')}</div>
    <div class="marca-plataforma">
      <div class="marca-plataforma-nombre">${escaparHtml(MARCA_PLATAFORMA.nombre)}</div>
      ${MARCA_PLATAFORMA.bajada.map(l => `<div class="marca-plataforma-bajada">${escaparHtml(l)}</div>`).join('')}
    </div>
    <nav>${navHtml}</nav>
    <!-- SOPORTE, DEBAJO DE AYUDA Y FUERA DEL ARREGLO NAV_ITEMS. No es una
         pantalla de la aplicacion sino un enlace a WhatsApp, y su numero viene
         del servidor: metido en el menu habria que reconstruirlo entero cada
         vez que llega la marca. Nace oculto y lo enciende pintarSoporte().
         SIN ACENTOS GRAVES: esto va dentro de una plantilla de JavaScript, que
         se delimita igual, y cada cita cerraria la cadena. -->
    <a class="nav-soporte" id="nav-soporte" target="whatsappWeb" rel="noopener" style="display:none;"></a>
    <div class="usuario-box">
      <div class="nombre">${usuario.nombre}</div>
      <div class="rol">${usuario.es_aspirante ? 'Administrador de su campaña' : usuario.rol}</div>
      <label style="display:flex; align-items:center; gap:6px; font-size:0.76rem; color:var(--color-text-muted); margin: 8px 0;"${usuario.es_superadmin ? ' title="El código de ingreso es obligatorio para esta cuenta."' : ''}>
        <input type="checkbox" id="chk-2fa" style="width:auto;" ${(usuario.two_factor_enabled || usuario.es_superadmin) ? 'checked' : ''}${usuario.es_superadmin ? ' disabled' : ''}>
        Verificación en dos pasos por correo
      </label>
      <button class="btn-secundario btn-sm" id="btn-logout">Cerrar sesión</button>
    </div>
  `;
  shell.prepend(sidebar);

  /* MENÚ EN EL CELULAR (orden 41). Hasta 640 px el CSS apila todo en una columna: el menú quedaba ENTERO arriba (unos 880 px) y el contenido
     debajo. Tocar un ítem de la misma página cambiaba la pestaña y el ancla, pero el menú seguía abierto y a la vista y la pestaña quedaba
     fuera de pantalla: «el ítem se resalta y no pasa nada». Ahora, en pantalla angosta, el menú nace CERRADO detrás de una barra
     «☰ Menú · <vista actual>», se abre con ella y se cierra solo al tocar cualquier ítem (o al cambiar el ancla, o con Escape). En pantalla
     ancha la barra no se ve y nada cambia. Entrar desde OTRA página ya funcionaba igual: la página nueva carga con el menú cerrado y la vista
     del ancla a la vista. */
  const barraMenuMovil = document.createElement('div');
  barraMenuMovil.className = 'menu-movil-barra';
  barraMenuMovil.innerHTML = '<button type="button" class="menu-movil-btn" id="menu-movil-btn" aria-expanded="false" aria-controls="menu-movil-sidebar">' +
    '<span class="menu-movil-ico" aria-hidden="true">☰</span> <span>Menú</span></button><span class="menu-movil-vista" id="menu-movil-vista"></span>';
  sidebar.id = 'menu-movil-sidebar';
  shell.prepend(barraMenuMovil);
  const botonMenuMovil = barraMenuMovil.querySelector('#menu-movil-btn');
  function ponerMenuMovil(abierto) {
    shell.classList.toggle('menu-abierto', abierto);
    botonMenuMovil.setAttribute('aria-expanded', abierto ? 'true' : 'false');
  }
  botonMenuMovil.addEventListener('click', () => ponerMenuMovil(!shell.classList.contains('menu-abierto')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ponerMenuMovil(false); });
  // Cualquier ítem cierra el menú; los títulos de grupo (que solo despliegan su submenú) no son `a[data-nav-href]`.
  sidebar.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('a[data-nav-href]')) ponerMenuMovil(false);
  });
  // Con lo guardado, antes de que responda el servidor: si hay número de la
  // vez anterior, el enlace está desde el primer instante.
  pintarSoporte(marcaInicial.telefono_soporte);
  // Se refresca DESPUES de pintar y sin esperar: si el servidor tarda, la
  // barra ya esta puesta con lo de la ultima vez.
  refrescarMarca();

  // Contraer/expandir cada menú principal al hacer clic en su título — solo
  // uno puede quedar expandido a la vez: al abrir uno, se cierran todos los
  // demás (si el que se clickeó ya estaba abierto, simplemente se cierra).
  // La animación de alto y la rotación de la flechita corren por CSS (ver
  // .nav-submenu/.nav-chevron en style.css), acá solo se alternan las clases.
  const todosLosTitulos = sidebar.querySelectorAll('.nav-grupo-titulo');
  todosLosTitulos.forEach(titulo => {
    titulo.addEventListener('click', () => {
      const grupoId = titulo.dataset.grupo;
      const submenu = sidebar.querySelector(`[data-submenu="${grupoId}"]`);
      const yaAbierto = submenu.classList.contains('abierto');

      todosLosTitulos.forEach(t => {
        t.classList.remove('grupo-abierto');
        sidebar.querySelector(`[data-submenu="${t.dataset.grupo}"]`).classList.remove('abierto');
      });

      if (!yaAbierto) {
        submenu.classList.add('abierto');
        titulo.classList.add('grupo-abierto');
      }
    });
  });

  /* QUÉ ÍTEM DEL MENÚ ESTÁ ACTIVO, Y CÓMO SE NAVEGA ENTRE VISTAS DE LA MISMA PÁGINA (orden 34).

     Varios ítems apuntan a UNA sola página con otra ancla (Día D: Jornada, Avance, Alertas, Transporte y Resultados son
     dia-d.html con #avance, #alertas…; Configuración: seis secciones de configuracion.html). Dos fallos juntos:
       · «activo» se calculaba SOLO al pintar el menú y solo comparaba la ruta cuando el ítem no llevaba ancla: «Jornada
         electoral» (sin ancla) quedaba activo en CUALQUIER vista de la página, y el que sí llevaba ancla se quedaba pegado
         al de la carga aunque la vista cambiara. Por eso salían dos con la barra amarilla.
       · estando ya en la página, tocar otro ítem solo cambia el ancla y la página no lo escuchaba (dia-d.html no tenía
         `hashchange`): «no pasa nada».
     La regla ahora, para los ítems de la página actual: gana el que coincide con el ancla de la URL; si ninguno, el que no
     lleva ancla (la vista inicial) o, en su defecto, el marcado `porDefecto`. Solo uno queda activo. Se recalcula en cada
     cambio de ancla y las páginas que cambian de vista por su cuenta (con history.replaceState, que no avisa) llaman a
     window.actualizarMenuActivo(). */
  function marcarActivoMenu() {
    const hash = window.location.hash;
    const enlaces = Array.from(sidebar.querySelectorAll('a[data-nav-href]'));
    const deEstaPagina = enlaces.filter(a => a.dataset.navHref.split('#')[0] === paginaBase);
    const ancla = (a) => (a.dataset.navHref.includes('#') ? '#' + a.dataset.navHref.split('#')[1] : '');
    const elegido = (hash && deEstaPagina.find(a => ancla(a) === hash))
      || deEstaPagina.find(a => ancla(a) === '')
      || deEstaPagina.find(a => a.dataset.navDefecto === '1')
      || null;
    enlaces.forEach(a => a.classList.toggle('activo', a === elegido));
    const etiqueta = document.getElementById('menu-movil-vista');
    if (etiqueta) etiqueta.textContent = elegido ? elegido.textContent.replace(/\s+/g, ' ').trim() : '';
  }
  marcarActivoMenu();
  window.addEventListener('hashchange', () => { marcarActivoMenu(); ponerMenuMovil(false); });
  window.addEventListener('popstate', marcarActivoMenu);
  window.actualizarMenuActivo = marcarActivoMenu;
  /* Las páginas que ESCUCHAN el cambio de ancla (dia-d.html y configuracion.html lo declaran con
     `window.paginaEscuchaHash = true`) cambian de vista sin recargar. Un enlace del menú a la MISMA página se resuelve aquí:
     se cambia la URL sin recargar y se avisa con `hashchange` (que el navegador no manda si la URL queda sin ancla). A las
     demás páginas no se les toca el clic: un ítem hacia la misma página las sigue recargando, como siempre. */
  sidebar.addEventListener('click', (e) => {
    if (!window.paginaEscuchaHash || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest ? e.target.closest('a[data-nav-href]') : null;
    if (!a || (a.target && a.target !== '_self')) return;
    const destino = new URL(a.href, window.location.href);
    if (destino.pathname !== window.location.pathname) return;
    e.preventDefault();
    if (destino.hash === window.location.hash) return;                 // ya está en esa vista
    history.pushState(null, '', destino.pathname + destino.search + destino.hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    window.scrollTo(0, 0);                                              // con el menú ya cerrado, la vista queda arriba y a la vista
  });

  document.getElementById('chk-2fa').addEventListener('change', async (e) => {
    const activar = e.target.checked;
    // APAGARLO PIDE LA CONTRASEÑA; encenderlo no. Quien se haga con una sesión
    // ajena no debe poder quitarle el segundo factor a esa cuenta sin saber
    // siquiera la contraseña. El servidor lo exige igual: esto solo evita que
    // la petición salga condenada al fallo.
    let password = null;
    if (!activar) {
      password = prompt('Para desactivar la verificación en dos pasos, escriba su contraseña actual:');
      if (password === null) { e.target.checked = true; return; }
    }
    try {
      await api('/auth/2fa', { method: 'PUT', body: { activar, password } });
    } catch (err) {
      alert(err.message);
      e.target.checked = !activar;
    }
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    // Si la solicitud falla (sin señal, servidor caído), igual hay que
    // cerrar del lado del navegador: quedarse dentro porque no hubo red es
    // lo contrario de lo que la persona pidió.
    try { await api('/auth/logout', { method: 'POST' }); } catch (err) { /* se cierra igual */ }

    // Si no se borra, un cierre de sesión sin conexión justo después
    // dejaría una identidad vieja en caché que podría reabrir la sesión
    // sola la próxima vez que la pantalla se cargue sin señal.
    try { localStorage.removeItem('app_usuario_verificado'); } catch (e) {}

    // Y HAY QUE DEJAR DE TENER UNA CUENTA ACTIVA DE DISPOSITIVO.
    //
    // Sin esto el cierre de sesión no se nota: el servidor destruye la
    // sesión y responde 200, pero `api()` sigue mandando el token de
    // dispositivo en cada solicitud (`X-Device-Token`), y `resolverUsuario`
    // la RECONSTRUYE a partir de él. Comprobado: con el token y sin ninguna
    // cookie, `GET /api/auth/me` responde 200. Resultado: se cierra, y un
    // segundo después login.html ve una sesión viva y devuelve al tablero.
    //
    // La app móvil ya lo hacía (`desactivarCuentaDispositivo()` en
    // app/inicio.html); al encabezado de escritorio le faltaba. La cuenta NO
    // se olvida: sigue en el selector de login.html para volver a entrar.
    if (typeof desactivarCuentaDispositivo === 'function') {
      desactivarCuentaDispositivo();
    } else {
      // Las pantallas de escritorio no cargan cuentas-dispositivo.js. El
      // nombre de la clave ya estaba repetido aquí arriba, en
      // obtenerTokenDispositivoActivo(); si cambia, cambian los dos sitios.
      try { localStorage.removeItem('app_cuenta_activa_id'); } catch (e) {}
    }

    window.location.href = '/login.html';
  });

  if (usuario.debe_cambiar_password) {
    mostrarAvisoCambioPassword();
  }

  // Con los permisos ya cargados, se muestran los botones de importar/exportar
  // que le corresponden. Van aquí y no en cada pantalla para que ninguna se
  // olvide: basta con que el control lleve `data-ie="módulo"`.
  aplicarImportarExportar(usuario);

  return usuario;
}

function mostrarAvisoCambioPassword() {
  const overlay = document.createElement('div');
  overlay.className = 'overlay abierto';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3>Actualice su contraseña</h3></div>
      <p style="color:var(--color-text-muted); font-size:0.88rem;">Por seguridad, debe establecer una nueva contraseña antes de continuar.</p>
      <div id="cambio-password-error" class="mensaje-error"></div>
      <form id="form-cambio-password">
        <div class="campo"><label>Contraseña actual (temporal)</label><input type="password" name="passwordActual" required></div>
        <div class="campo"><label>Nueva clave</label><input type="password" name="passwordNueva" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required placeholder="6 cifras" autocomplete="new-password"></div>
        <small style="display:block; color:var(--color-text-muted); font-size:0.8rem; margin:-8px 0 12px;">Un número de 6 cifras, fácil de recordar. Evite 123456 y los seis números iguales.</small>
        <button type="submit" class="btn-primario">Guardar y continuar</button>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  activarVerContrasena(overlay);   // igual que el anterior: creado al vuelo
  overlay.querySelector('#form-cambio-password').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/auth/cambiar-password', { method: 'POST', body: Object.fromEntries(f) });
      overlay.remove();
    } catch (err) {
      const el = overlay.querySelector('#cambio-password-error');
      el.textContent = err.message;
      el.classList.add('visible');
    }
  });
}

/* ------------------------------------------------------------------
   Ojo para ver u ocultar la contraseña.

   POR QUÉ VIVE AQUÍ Y NO EN UN ARCHIVO APARTE
     Los campos de contraseña de esta aplicación son siete, y tres de
     ellos los crea este mismo archivo al vuelo: el modal de contraseña
     de administrador (que abren diez pantallas) y el de «actualice su
     contraseña». Un archivo nuevo obligaría a agregar la etiqueta
     <script> en las doce pantallas que pueden abrirlos, sin ganar nada:
     common.js ya lo carga todo el mundo.

   HAY UN GEMELO EN EL SERVIDOR DE LICENCIAS
     public/js/comun.js de licencias.appestrategia.net tiene esta misma
     función, porque son dos aplicaciones distintas y no comparten
     archivos. Si se toca una, tocar la otra.
   ------------------------------------------------------------------ */

const OJO_ABIERTO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const OJO_TACHADO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><line x1="3" y1="21" x2="21" y2="3"/></svg>';

/**
 * Le pone el ojo a cada campo de contraseña que encuentre.
 *
 * @param raiz  dónde buscar. Se le pasa el modal recién creado cuando el
 *              campo no existía al cargar la página; sin argumento, mira
 *              todo el documento.
 *
 * Marca cada campo ya tratado (`data-ojo`), así que llamarla dos veces
 * sobre lo mismo no deja dos ojos.
 */
function activarVerContrasena(raiz) {
  const campos = (raiz || document).querySelectorAll('input[type="password"]:not([data-ojo])');
  campos.forEach((campo) => {
    campo.dataset.ojo = '1';

    const envoltura = document.createElement('span');
    envoltura.className = 'campo-clave';
    campo.parentNode.insertBefore(envoltura, campo);
    envoltura.appendChild(campo);

    const boton = document.createElement('button');
    // Sin type="button" un <button> dentro de un <form> lo ENVÍA al hacer
    // clic: mirar la contraseña intentaría iniciar sesión.
    boton.type = 'button';
    boton.className = 'btn-ver-clave';

    const pintar = () => {
      const visible = campo.type === 'text';
      boton.innerHTML = visible ? OJO_TACHADO : OJO_ABIERTO;
      boton.title = visible ? 'Ocultar contraseña' : 'Mostrar contraseña';
      boton.setAttribute('aria-label', boton.title);
      boton.setAttribute('aria-pressed', visible ? 'true' : 'false');
    };

    boton.addEventListener('click', () => {
      campo.type = campo.type === 'password' ? 'text' : 'password';
      pintar();
      // Devolver el foco al campo, con el cursor al final: si no, hay que
      // volver a hacer clic para seguir escribiendo.
      campo.focus();
      const fin = campo.value.length;
      try { campo.setSelectionRange(fin, fin); } catch (e) { /* varios navegadores no dejan mover el cursor mientras el campo es password */ }
    });

    pintar();
    envoltura.appendChild(boton);
  });
}

document.addEventListener('DOMContentLoaded', () => activarVerContrasena());

/* ==========================================================================
   DESPLEGABLES ORDENADOS SOLOS
   ==========================================================================

   SE ORDENA LO QUE VIENE DE DATOS; SE RESPETA LO QUE ESCRIBIÓ UNA PERSONA.
   Los territorios llegan por `api()`, los líderes se repueblan al cambiar de
   barrio, los puestos de votación se filtran por municipio: esas listas
   nacen en la base de datos, no tienen orden propio y se ordenan solas.

   POR QUÉ NO SE ORDENA TODO. Se clasificaron los 144 desplegables uno a uno
   y 44 tienen un orden que significa algo: escalas, la cadena de mando
   (RANGO_CATEGORIA), los ordinales del organigrama, los pares Sí/No, el
   ciclo de vida de un evento, la convención urbano→rural que también está
   en el ENUM de la base. Casi todos son opciones escritas a mano en el HTML.
   Ordenarlos pondría «Hombre» delante de «Mujer» y «Rural» delante de
   «Urbano», deshaciendo elecciones deliberadas.

   Y no valía marcarlos uno por uno: la misma lista de Género, idéntica letra
   por letra, está en tres pantallas, y el par urbano/rural en siete. Cualquier
   marca que se olvide deja el MISMO campo con dos órdenes distintos en la
   misma aplicación, que es peor que no ordenar. La regla de arriba no se
   puede olvidar: no depende de que nadie marque nada.

   El coste del error también cambia de lado. Si esta regla se equivoca, una
   lista se queda sin ordenar: se ve y se arregla. Al revés —ordenar lo que no
   se debía— el daño es silencioso y nadie lo mira dos veces.

   POR QUÉ UN OBSERVADOR. Obligar a cada sitio que llena un desplegable a
   llamar a `ordenarSelect()` es repartir la responsabilidad entre ochenta
   llamadas: basta que una se olvide para que ese desplegable quede
   desordenado sin que nada avise. El observador no se puede olvidar.

   Y el observador distingue solo las dos cosas: opciones que APARECEN dentro
   de un select que ya estaba son datos y se ordenan; un select que LLEGA ya
   lleno lo pintó una plantilla y su orden es de quien la escribió.

   LO QUE NO SE ORDENA, Y POR QUÉ:

   · La opción vacía se queda arriba. «Seleccione...», «Ninguno», «Todos los
     cargos», «Toda comuna/corregimiento» son la etiqueta del campo, no un
     valor entre los demás; ordenarlas las mandaría al medio de la lista.
   · Dentro de cada `<optgroup>` por separado. Los grupos son una
     clasificación deliberada: mezclarlos la borraría.
   · Los números se ordenan como números. Con la comparación de texto, las
     mesas 1, 2, 10 salen como 1, 10, 2. `Intl.Collator` con `numeric: true`
     lo resuelve sin tener que adivinar si una lista es numérica.
   · Un `<select data-sin-ordenar>` se deja intacto. Es la salida para los que
     tienen un orden con sentido: una escala como la intención de voto
     (confirmado > probable > indeciso), unos ordinales como los niveles del
     organigrama, o una lista ya ordenada a propósito por cercanía o por rango,
     como «Reporta a».
*/

/* Comparación en español: la Ñ va después de la N, las tildes no separan
   palabras, y `numeric` hace que 2 vaya antes que 10. Se crea UNA vez: un
   `Intl.Collator` nuevo por comparación es de lo más caro que hay en una lista
   de mil opciones. */
const COMPARADOR_OPCIONES = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

/**
 * Ordena las opciones de un desplegable. Devuelve true si tuvo que moverlas.
 *
 * SI YA ESTABA ORDENADO NO TOCA EL DOM, y no es una optimización cosmética:
 * cada movimiento despierta al observador de abajo, así que reordenar a lo
 * tonto se realimenta. Comprobar primero corta ese ciclo en el caso normal.
 */
function ordenarSelect(select) {
  if (!select || select.tagName !== 'SELECT') return false;
  if (select.hasAttribute('data-sin-ordenar')) return false;

  // El propio select y cada grupo son contenedores independientes.
  const contenedores = [select, ...select.querySelectorAll('optgroup')];
  let cambio = false;

  for (const contenedor of contenedores) {
    const opciones = Array.from(contenedor.children).filter((n) => n.tagName === 'OPTION');
    if (opciones.length < 2) continue;

    // La opción sin valor es el rótulo del campo: se queda donde está.
    const fijas = opciones.filter((o) => o.value === '');
    const movibles = opciones.filter((o) => o.value !== '');
    if (movibles.length < 2) continue;

    const ordenadas = movibles.slice().sort((a, b) =>
      COMPARADOR_OPCIONES.compare((a.textContent || '').trim(), (b.textContent || '').trim()));
    if (ordenadas.every((o, i) => o === movibles[i])) continue;   // ya estaba

    /* SE GUARDA LA SELECCIÓN Y SE RESTAURA. Mover el <option> que está
       seleccionado hace que algunos navegadores devuelvan el select a su
       primera opción; el usuario vería su elección cambiar sola mientras
       escribe en otro campo. */
    /* LA SELECCIÓN SE RESTAURA POR LA OPCIÓN, NO POR SU VALOR, Y TAMBIÉN CUANDO ES LA VACÍA.
       La versión anterior solo restauraba si el valor previo no era '' — y justo ese es el caso que se rompía: un filtro con «Todas»
       elegido cuyo desplegable se llena después de pintarse. Sacar del select la opción vacía (que es la seleccionada) hace que el
       navegador marque la primera opción real; al volver a meter la vacía, que conserva su marca de «seleccionada», quedan dos marcadas y
       gana la ÚLTIMA. Resultado: el filtro cambiaba solo a la primera categoría, y la lista salía filtrada sin que nadie lo hubiera pedido.
       Se guarda el elemento <option> (no su texto ni su valor: dos opciones pueden compartirlos) y se vuelve a marcar. */
    const seleccionadas = new Set(Array.from(select.options).filter((o) => o.selected));
    const indicePrevio = select.selectedIndex;

    const trozo = document.createDocumentFragment();
    fijas.forEach((o) => trozo.appendChild(o));
    ordenadas.forEach((o) => trozo.appendChild(o));
    contenedor.appendChild(trozo);

    if (select.multiple) {
      Array.from(select.options).forEach((o) => { o.selected = seleccionadas.has(o); });
    } else if (seleccionadas.size) {
      const opcion = Array.from(seleccionadas)[0];
      if (!opcion.selected || select.selectedOptions[0] !== opcion) opcion.selected = true;
    } else if (indicePrevio === -1) {
      select.selectedIndex = -1;          // no había ninguna elegida: tampoco la hay ahora
    }
    cambio = true;
  }
  return cambio;
}

/** Ordena todos los desplegables que haya bajo `raiz` (por omisión, la página). */
function ordenarTodosLosSelects(raiz) {
  const donde = raiz && raiz.querySelectorAll ? raiz : document;
  donde.querySelectorAll('select').forEach(ordenarSelect);
}

/* EL OBSERVADOR. Mira toda la página y ordena el desplegable que acabe de
   recibir opciones.

   SE DESACTIVA MIENTRAS ORDENA, y después se tiran los registros que él mismo
   provocó con `takeRecords()`. Sin eso el ciclo es inevitable: la llamada del
   observador es asíncrona, así que los movimientos hechos con la bandera
   puesta llegarían igualmente cuando ya está quitada, y volvería a ordenar
   para siempre.

   Se agrupa el trabajo en un `requestAnimationFrame` porque llenar un
   desplegable con `innerHTML` de mil opciones dispara una avalancha de
   mutaciones: ordenar en cada una sería ordenar mil veces la misma lista. */
let observadorSelects = null;
let pendientesDeOrdenar = new Set();
let ordenadoProgramado = false;

function procesarPendientes() {
  ordenadoProgramado = false;
  const lista = Array.from(pendientesDeOrdenar);
  pendientesDeOrdenar.clear();
  if (!lista.length || !observadorSelects) return;
  observadorSelects.disconnect();
  try {
    lista.forEach((s) => { if (s.isConnected) ordenarSelect(s); });
  } finally {
    observadorSelects.takeRecords();
    observadorSelects.observe(document.documentElement, { childList: true, subtree: true });
  }
}

function vigilarDesplegables() {
  if (observadorSelects || typeof MutationObserver === 'undefined') return;
  observadorSelects = new MutationObserver((mutaciones) => {
    for (const m of mutaciones) {
      // El contenedor que cambió: el select mismo, o el optgroup que lo lleva.
      const destino = m.target && m.target.closest ? m.target.closest('select') : null;
      if (destino) pendientesDeOrdenar.add(destino);
      /* UN DESPLEGABLE QUE LLEGA YA LLENO NO SE TOCA, y esta es la linea
         entera del diseño. Si las opciones aparecen DENTRO de un select que
         ya estaba en la pagina, vienen de la base de datos y se ordenan. Si
         llega un trozo de pagina que TRAE el select escrito dentro, lo
         escribio una persona en una plantilla y su orden es suyo:
         plantillaGrupo() en crm.html pinta asi cuatro desplegables cuyo orden
         es un rango, y el primero de ellos lleva `selected` en una opcion con
         valor real, que el alfabeto moveria de sitio. */
    }
    if (pendientesDeOrdenar.size && !ordenadoProgramado) {
      ordenadoProgramado = true;
      requestAnimationFrame(procesarPendientes);
    }
  });
  observadorSelects.observe(document.documentElement, { childList: true, subtree: true });
}

/* NO SE ORDENA LA PAGINA AL CARGAR, A PROPOSITO. Ver la nota de arriba: lo
   que ya esta escrito en el HTML lo puso una persona y su orden significa
   algo. Solo se vigila lo que llegue despues, que es lo que viene de la base
   de datos. `ordenarTodosLosSelects()` queda disponible para la pantalla que
   quiera pedirlo a mano; no la llama nadie sola. */
document.addEventListener('DOMContentLoaded', () => {
  vigilarDesplegables();
});
