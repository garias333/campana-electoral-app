/**
 * Token de dispositivo: una credencial de larga duración (7 días, igual
 * que "Recordar sesión") que un celular guarda para poder retomar la
 * sesión de un usuario que ya inició sesión ahí antes, SIN depender de
 * la cookie de sesión normal — pensado para que varias personas puedan
 * cambiar de cuenta en un mismo celular compartido (ej. varios testigos
 * usando el mismo dispositivo) incluso sin conexión, ya que cambiar de
 * cuenta así no puede esperar a validar una contraseña contra el servidor.
 *
 * Es un token firmado (HMAC-SHA256 con SESSION_SECRET), no un identificador
 * guardado en la base de datos: el servidor puede verificar que es
 * auténtico sin consultar nada, con solo recalcular la firma. No hay lista
 * de revocación — si se necesita invalidarlo antes de que expire (ej. la
 * persona ya no debería tener acceso), hay que desactivar su usuario.
 *
 * IMPORTANTE (compromiso de seguridad, deliberado y explicado al usuario):
 * a diferencia de la cookie de sesión (httpOnly, no la puede leer
 * JavaScript), este token SÍ vive en localStorage, legible por JavaScript
 * — es lo que permite que el navegador lo adjunte al cambiar de cuenta.
 * Si el celular llega a ejecutar un script malicioso (XSS), ese token
 * podría robarse igual que cualquier credencial en localStorage. Se pidió
 * expresamente esta función a pesar de esa reducción de protección.
 */

const crypto = require('crypto');

const DURACION_TOKEN_DISPOSITIVO_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * "entrarComo" guarda con qué capacidad se firmó el token cuando la
 * cuenta tiene doble rol (Líder/Sublíder que también es testigo
 * electoral, ver /auth/elegir-rol): 'testigo' o null (capacidad
 * principal). Va DENTRO del token firmado (no se puede falsificar sin
 * SESSION_SECRET) para que un dispositivo que guardó "entrar como
 * testigo" siga entrando con esa capacidad en cada solicitud, sin
 * depender de la cookie de sesión normal.
 */
function firmarTokenDispositivo(usuarioId, entrarComo) {
  const expira = Date.now() + DURACION_TOKEN_DISPOSITIVO_MS;
  const capacidad = entrarComo || '';
  const payload = `${usuarioId}.${capacidad}.${expira}`;
  const firma = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${firma}`;
}

/**
 * Devuelve { usuarioId, entrarComo } si el token es auténtico y no ha
 * vencido, o null si no. Acepta también el formato anterior (sin
 * capacidad, 3 partes) para no invalidar de golpe los tokens ya
 * guardados en los dispositivos antes de este cambio.
 */
function verificarTokenDispositivo(token) {
  if (!token || typeof token !== 'string') return null;
  const partes = token.split('.');
  let usuarioIdStr, capacidad, expiraStr, firma, payload;
  if (partes.length === 4) {
    [usuarioIdStr, capacidad, expiraStr, firma] = partes;
    payload = `${usuarioIdStr}.${capacidad}.${expiraStr}`;
  } else if (partes.length === 3) {
    [usuarioIdStr, expiraStr, firma] = partes;
    capacidad = '';
    payload = `${usuarioIdStr}.${expiraStr}`;
  } else {
    return null;
  }
  const firmaEsperada = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
  const bufFirma = Buffer.from(firma);
  const bufEsperada = Buffer.from(firmaEsperada);
  if (bufFirma.length !== bufEsperada.length || !crypto.timingSafeEqual(bufFirma, bufEsperada)) return null;
  if (!Number.isFinite(Number(expiraStr)) || Date.now() > Number(expiraStr)) return null;
  const usuarioId = Number(usuarioIdStr);
  if (!Number.isInteger(usuarioId)) return null;
  return { usuarioId, entrarComo: capacidad || null };
}

module.exports = { firmarTokenDispositivo, verificarTokenDispositivo };
