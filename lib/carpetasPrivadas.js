/**
 * LAS SUBCARPETAS DE uploads/ QUE `/uploads` NUNCA SIRVE. Una sola lista para app.js y para las pruebas:
 *   · dia-d       las fotos del E-14 y demás documentos del Día D (salen por /api/dia-d/reportes/:id/foto)
 *   · solicitudes las fotos de las solicitudes ciudadanas (salen por /api/solicitudes/:id/fotos/:fotoId, que comprueba el alcance)
 * `carpetaPrivadaDe` normaliza la ruta igual que express.static, así `//solicitudes/a.jpg`, `/./solicitudes/a.jpg`, `/Solicitudes/a.jpg`
 * o `/contenido/../solicitudes/a.jpg` no esquivan la comprobación. Devuelve el nombre de la carpeta o null.
 */
'use strict';
const path = require('path');

const SUBCARPETAS_PRIVADAS = ['dia-d', 'solicitudes'];

function carpetaPrivadaDe(rutaDeLaPeticion) {
  let relativa;
  try { relativa = path.posix.normalize(decodeURIComponent(String(rutaDeLaPeticion || ''))).replace(/^\/+/, ''); }
  catch (_) { return 'ilegible'; }          // una ruta que no se puede leer se trata como privada: no se sirve
  const primera = relativa.split('/').filter(Boolean)[0];
  if (!primera) return null;
  const minuscula = primera.toLowerCase();
  return SUBCARPETAS_PRIVADAS.includes(minuscula) ? minuscula : null;
}

module.exports = { SUBCARPETAS_PRIVADAS, carpetaPrivadaDe };
