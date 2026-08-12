/* Utilidades comunes: sesión, sidebar dinámico y helpers de fetch */

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
    ]
  },
  {
    grupo: 'Día D', iconoGrupo: '⏱️',
    items: [
      { href: '/dia-d.html', texto: 'Jornada electoral', modulo: 'dia_d', roles: ['admin', 'coordinador'] },
      { href: '/testigos.html', texto: 'Testigos electorales', modulo: 'testigos', roles: ['admin', 'coordinador'] },
      { href: '/configuracion.html#diad', texto: 'Puestos de votación y candidatos', modulo: 'configuracion', roles: ['admin'] },
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
    grupo: 'Comunicaciones', iconoGrupo: '📣',
    items: [
      { href: '/recursos.html', texto: 'Información para compartir', modulo: 'recursos', roles: null },
      { href: '/contenido.html?clave=biografia_candidato', texto: 'Biografía del candidato', modulo: 'biografia_candidato', roles: null },
      { href: '/contenido.html?clave=politica_privacidad', texto: 'Política de privacidad', modulo: 'politica_privacidad', roles: null },
    ]
  },
  {
    grupo: 'CRM y mensajería', iconoGrupo: '💬',
    items: [
      { href: '/crm.html', texto: 'CRM y Mensajes', modulo: 'crm', roles: ['admin', 'coordinador'] },
      { href: '/enviar-email.html', texto: 'Enviar E-mail', modulo: 'enviar_email', roles: ['admin', 'coordinador', 'lider'] },
      { href: '/enviar-sms.html', texto: 'Enviar SMS', modulo: 'enviar_sms', roles: ['admin', 'coordinador', 'lider'] },
      { href: '/enviar-push.html', texto: 'Aviso en la app', modulo: 'enviar_push', roles: ['admin', 'coordinador', 'lider'] },
      // El módulo sigue siendo 'configurar_crm' (gobierna permisos) y el
      // archivo conserva su nombre: solo cambia el texto visible, porque
      // la pantalla configura mensajería, no el CRM.
      { href: '/configurar-crm.html', texto: 'Configurar mensajería', modulo: 'configurar_crm', roles: ['admin'] },
    ]
  },
  { href: '/finanzas.html', icono: '💰', texto: 'Finanzas', modulo: 'finanzas', roles: ['admin', 'coordinador'] },
  {
    grupo: 'Configuración', iconoGrupo: '⚙️',
    items: [
      { href: '/configuracion.html#campana', texto: 'Datos de la campaña', modulo: 'configuracion', roles: ['admin'] },
      { href: '/configuracion.html#usuarios', texto: 'Usuarios', modulo: 'configuracion', roles: ['admin'] },
      { href: '/configuracion.html#permisos', texto: 'Asignación de permisos', modulo: 'configuracion', roles: ['admin'] },
      { href: '/configuracion.html#eliminar', texto: 'Eliminar información', modulo: 'configuracion', roles: ['admin'] },
      { href: '/configuracion.html#backup', texto: 'Backup', modulo: 'configuracion', roles: ['admin'] },
    ]
  },
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
    throw new Error((data && data.error) || 'Error en la solicitud.');
  }
  return data;
}

function formatoMoneda(valor) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(valor || 0);
}

function formatoFecha(fechaIso, conHora = false) {
  if (!fechaIso) return '—';
  const d = new Date(fechaIso);
  const opts = conHora
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
function celdaTelefonoWhatsApp(telefono) {
  const digitos = String(telefono || '').replace(/\D/g, '');
  if (!digitos) return '—';

  const visible = digitos.length === 10 ? formatoTelefonoColombia(digitos) : digitos;
  const internacional = digitos.startsWith('57') ? digitos : '57' + digitos;

  // rel="noopener" no es adorno: sin él, la pestaña que se abre puede tocar
  // la que la abrió a través de window.opener.
  return `${visible}
    <a href="https://wa.me/${internacional}" target="_blank" rel="noopener"
       class="enlace-whatsapp" title="Escribir por WhatsApp a este número"
       aria-label="Escribir por WhatsApp">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.06c-.24.68-1.42 1.31-1.96 1.35-.5.04-.98.22-3.3-.69-2.79-1.1-4.55-3.96-4.69-4.14-.13-.18-1.11-1.48-1.11-2.82 0-1.34.7-2 .95-2.27.25-.27.54-.34.72-.34.18 0 .36 0 .52.01.17.01.39-.06.61.47.24.55.8 1.9.87 2.04.07.14.12.3.02.48-.09.18-.14.29-.28.45-.14.16-.29.36-.42.48-.14.14-.28.29-.12.57.16.28.72 1.19 1.55 1.93 1.07.95 1.97 1.25 2.25 1.39.28.14.44.12.61-.07.17-.19.7-.82.89-1.1.19-.28.37-.23.62-.14.25.09 1.6.75 1.87.89.28.14.46.21.53.32.07.12.07.66-.17 1.34z"/>
      </svg>
    </a>`;
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
function textoCuentaRegresivaElecciones(fechaEleccionIso) {
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
 * Muestra un modal pidiendo la contraseña de un administrador y devuelve la
 * contraseña ingresada (o null si se cancela). Se usa como confirmación
 * extra antes de acciones destructivas (eliminaciones masivas). La
 * verificación real de la contraseña ocurre en el servidor, en el mismo
 * endpoint que ejecuta la acción.
 */
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

  const shell = document.getElementById('app-shell');

  const paginaBase = paginaActiva.split('#')[0];

  // Permisos por módulo del propio rol (Configuración → Asignación de
  // permisos). Si la consulta falla por cualquier motivo (tabla recién
  // creada, error de red, etc.), se usan los roles fijos de cada ítem como
  // respaldo — así nadie se queda sin menú por un problema de permisos.
  let modulosPermitidos = null;
  try {
    const permisos = await api('/permisos/mios');
    modulosPermitidos = permisos.modulos;
    // Se deja disponible en el objeto de usuario para que cada página
    // pueda mostrar/ocultar sus botones de Editar/Agregar nuevo según lo
    // configurado en Asignación de permisos (además de "Ver", que ya
    // controla el menú). Ej: usuarioActual.permisos.territorial.editar
    usuario.permisos = permisos.permisos || {};
  } catch (e) {
    modulosPermitidos = null;
    usuario.permisos = {};
  }
  function itemVisible(item) {
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
      const grupoId = `nav-grupo-${indice}`;
      const contieneActivo = hijosVisibles.some(sub => sub.href.split('#')[0] === paginaBase);
      const subHtml = hijosVisibles.map(sub => {
        const subBase = sub.href.split('#')[0];
        const activo = subBase === paginaBase && (!sub.href.includes('#') || window.location.hash === '#' + sub.href.split('#')[1]);
        return `<a href="${sub.href}" class="nav-sub-link ${activo ? 'activo' : ''}">${sub.texto}</a>`;
      }).join('');
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
    return `<a href="${item.href}" class="nav-link-principal ${item.href === paginaBase ? 'activo' : ''}">
        <span class="icono">${item.icono || '♜'}</span> ${item.texto.toUpperCase()}
      </a>`;
  }).join('');

  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  sidebar.innerHTML = `
    <div class="marca-logo" style="text-align:center; padding: 2px 0 4px;">
      <img src="/img/logo.png" alt="Estrategia" style="width:100%; max-width:125px; height:auto;">
    </div>
    <div class="marca">ESTRATEGIA | Plataforma Electoral</div>
    <div class="submarca">Administración Integral de Campañas</div>
    <nav>${navHtml}</nav>
    <div class="usuario-box">
      <div class="nombre">${usuario.nombre}</div>
      <div class="rol">${usuario.rol}</div>
      <label style="display:flex; align-items:center; gap:6px; font-size:0.76rem; color:var(--color-text-muted); margin: 8px 0;">
        <input type="checkbox" id="chk-2fa" style="width:auto;" ${usuario.two_factor_enabled ? 'checked' : ''}>
        Verificación en dos pasos por correo
      </label>
      <button class="btn-secundario btn-sm" id="btn-logout">Cerrar sesión</button>
    </div>
  `;
  shell.prepend(sidebar);

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

  document.getElementById('chk-2fa').addEventListener('change', async (e) => {
    const activar = e.target.checked;
    try {
      await api('/auth/2fa', { method: 'PUT', body: { activar } });
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
        <div class="campo"><label>Nueva contraseña</label><input type="password" name="passwordNueva" minlength="8" required></div>
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
