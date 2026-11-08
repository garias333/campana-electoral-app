/* Cuentas guardadas en este dispositivo: permite que varias personas
   compartan un mismo celular (ej. varios testigos en la jornada
   electoral) y cambien de cuenta sin depender de la cookie de sesión
   normal, incluso sin conexión — cada una se guarda con su propio "token
   de dispositivo" (ver config/tokenDispositivo.js en el servidor), que se
   adjunta como encabezado X-Device-Token en cada solicitud (ver
   obtenerTokenDispositivoActivo() en api-core.js/common.js — está
   duplicada ahí porque api() la necesita incluso en pantallas que no
   cargan este archivo).

   IMPORTANTE (compromiso de seguridad, deliberado): estos tokens quedan
   en localStorage, legible por JavaScript — a diferencia de la cookie de
   sesión normal (httpOnly). Se aceptó esta reducción de protección a
   cambio de poder cambiar de cuenta sin conexión. */

const CUENTAS_DISPOSITIVO_CLAVE = 'app_cuentas_dispositivo';
const CUENTA_ACTIVA_CLAVE = 'app_cuenta_activa_id';

function listarCuentasDispositivo() {
  try {
    const crudo = localStorage.getItem(CUENTAS_DISPOSITIVO_CLAVE);
    return crudo ? JSON.parse(crudo) : {};
  } catch (err) {
    return {};
  }
}

/** Guarda (o reemplaza) una cuenta con su token, y la deja como la activa — se llama justo después de un inicio de sesión exitoso con "Recordar sesión" marcado. */
function guardarCuentaDispositivo(usuario, token) {
  if (usuario && usuario.id !== undefined) registrarUsuarioSinSenal(usuario.id);
  try {
    const cuentas = listarCuentasDispositivo();
    cuentas[usuario.id] = { usuario, token, guardadoEn: Date.now() };
    localStorage.setItem(CUENTAS_DISPOSITIVO_CLAVE, JSON.stringify(cuentas));
    localStorage.setItem(CUENTA_ACTIVA_CLAVE, String(usuario.id));
  } catch (err) {
    // localStorage lleno o deshabilitado — no impide seguir usando la app en línea, solo no queda guardada para cambiar de cuenta después.
  }
}

/** Refresca los datos del perfil (nombre, rol...) de una cuenta ya guardada, sin tocar su token — para que el selector de cuentas muestre información al día tras una consulta en línea exitosa. */
function actualizarPerfilCuentaDispositivo(usuario) {
  if (usuario && usuario.id !== undefined) registrarUsuarioSinSenal(usuario.id);
  try {
    const cuentas = listarCuentasDispositivo();
    if (cuentas[usuario.id]) {
      cuentas[usuario.id].usuario = usuario;
      localStorage.setItem(CUENTAS_DISPOSITIVO_CLAVE, JSON.stringify(cuentas));
    }
  } catch (err) {}
}

function establecerCuentaActiva(usuarioId) {
  try { localStorage.setItem(CUENTA_ACTIVA_CLAVE, String(usuarioId)); } catch (err) {}
  registrarUsuarioSinSenal(usuarioId);
}

/* LO QUE SE GUARDA SIN SEÑAL, POR USUARIO (orden del panel del líder). Ver el encabezado de public/js/offline-utils.js.
   Aquí vive lo que hay que hacer al cambiar de persona: BORRAR las copias de lectura del usuario anterior (la lista de faltantes,
   las alertas, el panel y los datos de referencia de localStorage). Las colas de lo pendiente de subir NO se tocan: son trabajo
   sin enviar, y se les asigna dueño para que solo su sesión las suba. Se hace con IndexedDB «a mano» porque esta pantalla puede
   cargarse sin offline-utils.js. */
const OFFLINE_USUARIO_CLAVE = 'offline_usuario_id';
const COPIAS_SIN_SENAL = ['faltantes_cache', 'alertas_cache', 'panel_lider_cache'];

function purgarCopiasSinSenal(usuarioId) {
  try {
    Object.keys(localStorage).filter((k) => k.indexOf('cache_ref_') === 0).forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
  } catch (err) {}
  try {
    if (!window.indexedDB) return;
    const solicitud = indexedDB.open('estrategia_offline');   // sin pedir versión: la que haya
    solicitud.onsuccess = () => {
      const db = solicitud.result;
      COPIAS_SIN_SENAL.forEach((nombre) => {
        if (!db.objectStoreNames.contains(nombre)) return;
        const cursor = db.transaction(nombre, 'readwrite').objectStore(nombre).openCursor();
        cursor.onsuccess = (ev) => {
          const c = ev.target.result;
          if (!c) return;
          const r = c.value || {};
          // Las del usuario que se va, y las que no traen dueño (guardadas antes de este cambio: no se sabe de quién son).
          if (r.usuarioId === undefined || r.usuarioId === '' || String(r.usuarioId) === String(usuarioId)) c.delete();
          c.continue();
        };
      });
      setTimeout(() => { try { db.close(); } catch (e) {} }, 1500);
    };
  } catch (err) {}
}

/** Anota quién es el usuario de este celular ahora; si es otra persona que la anterior, borra lo guardado de la anterior. */
function registrarUsuarioSinSenal(usuarioId) {
  try {
    const anterior = localStorage.getItem(OFFLINE_USUARIO_CLAVE);
    if (anterior && String(anterior) !== String(usuarioId)) purgarCopiasSinSenal(anterior);
    localStorage.setItem(OFFLINE_USUARIO_CLAVE, String(usuarioId));
  } catch (err) {}
}

/** Cierra sesión sin "olvidar" la cuenta: deja de haber una cuenta activa, pero sigue disponible en el selector para volver a entrar sin escribir la contraseña de nuevo. */
function desactivarCuentaDispositivo() {
  try { localStorage.removeItem(CUENTA_ACTIVA_CLAVE); } catch (err) {}
  // Cerrar sesión borra las copias de lectura de quien se va (no sus pendientes de subir).
  try {
    const actual = localStorage.getItem(OFFLINE_USUARIO_CLAVE);
    purgarCopiasSinSenal(actual || '');
    localStorage.removeItem(OFFLINE_USUARIO_CLAVE);
  } catch (err) {}
}

/** Quita por completo una cuenta guardada de este dispositivo (ej. "Olvidar esta cuenta" en el selector de login). */
function olvidarCuentaDispositivo(usuarioId) {
  try {
    const cuentas = listarCuentasDispositivo();
    delete cuentas[usuarioId];
    localStorage.setItem(CUENTAS_DISPOSITIVO_CLAVE, JSON.stringify(cuentas));
    if (localStorage.getItem(CUENTA_ACTIVA_CLAVE) === String(usuarioId)) {
      localStorage.removeItem(CUENTA_ACTIVA_CLAVE);
    }
  } catch (err) {}
}

/** Perfil guardado de la cuenta activa (para seguir sabiendo quién eres sin conexión), o null si no hay ninguna activa en este dispositivo. */
function obtenerPerfilCuentaActiva() {
  try {
    const activaId = localStorage.getItem(CUENTA_ACTIVA_CLAVE);
    if (!activaId) return null;
    const cuentas = listarCuentasDispositivo();
    return (cuentas[activaId] && cuentas[activaId].usuario) || null;
  } catch (err) {
    return null;
  }
}
