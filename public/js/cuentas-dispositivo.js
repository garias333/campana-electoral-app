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
}

/** Cierra sesión sin "olvidar" la cuenta: deja de haber una cuenta activa, pero sigue disponible en el selector para volver a entrar sin escribir la contraseña de nuevo. */
function desactivarCuentaDispositivo() {
  try { localStorage.removeItem(CUENTA_ACTIVA_CLAVE); } catch (err) {}
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
