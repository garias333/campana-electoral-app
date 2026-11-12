/* Helper compartido de llamadas a la API (fetch + manejo de CSRF).
   Extraído de /js/common.js para las pantallas simples de /app/ que
   NO necesitan el resto de utilidades de dashboard (sidebar, permisos,
   formateadores, modales de admin) — mismo comportamiento, mucho menos
   peso. Las páginas de /app/ que sí usan esas otras utilidades
   (ej. registro-votante.html) siguen cargando /js/common.js completo. */

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
 * guardadas en un mismo celular compartido. Está duplicada acá (en vez de
 * depender de cuentas-dispositivo.js) porque api() la necesita incluso en
 * pantallas que no cargan ese archivo.
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
  // Las cabeceras que pida quien llama (p. ej. `X-Cola-Usuario` de sincronizarCola) se SUMAN a las de siempre: antes reemplazaban a `Content-Type`.
  const config = {
    ...opciones,
    headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) }
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
    // app-comun.js: un corte de señal momentáneo en campo no debe forzar
    // a la persona a volver a iniciar sesión).
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
      // Si YA estamos en login.html, redirigir ahí mismo recargaría la
      // misma página en bucle (ver el mismo comentario en common.js).
      if (window.location.pathname !== '/login.html') {
        window.location.href = '/login.html';
        return;
      }
      const e401 = new Error((data && data.error) || 'No autenticado.');
      e401.status = 401;
      throw e401;
    }
    // `status` (parche 308): sin él ninguna pantalla podía distinguir «no tiene acceso» (403) de un fallo cualquiera, y las ramas
    // `e.status === 403` de «Mis tareas» y «Mis solicitudes» nunca se ejecutaban. Igual que la api() de common.js (que ya lo ponía).
    const errorHttp = new Error((data && data.error) || 'Error en la solicitud.');
    errorHttp.status = resp.status;
    // El cuerpo entero de la respuesta, por si una pantalla necesita más que el texto del error.
    errorHttp.datos = data;
    throw errorHttp;
  }
  return data;
}
