/**
 * La política de tratamiento de datos, archivada por versión.
 *
 * UNA SOLA IMPLEMENTACIÓN DE LA HUELLA. Antes se calculaba dentro del GET de
 * `contenido.routes.js` y nadie más la tocaba. Ahora la necesitan tres sitios
 * —el GET que se la manda al celular, el PUT que archiva, y el alta de votante
 * que la verifica—, así que vive aquí. Dos copias de la misma regla derivan sin
 * avisar, y el día que deriven los cruces fallan en silencio: la huella
 * guardada dejaría de resolver contra el archivo y toda la evidencia quedaría
 * marcada como no verificada sin que nada falle.
 */
const crypto = require('crypto');
const pool = require('./db');

/**
 * Huella del texto de una política. 16 hexadecimales de un sha256.
 *
 * SOBRE EL TEXTO EN CRUDO, SIN NORMALIZAR, y es a propósito: la evidencia es
 * el texto que se mostró, byte a byte. Si se normalizara, dos textos distintos
 * podrían compartir huella y el archivo guardaría solo uno de los dos.
 * La contrapartida es que un espacio de más produce una versión nueva — que es
 * justo lo que se quiere: la persona vio otro documento.
 */
function huellaDePolitica(contenido) {
  return crypto.createHash('sha256')
    .update(String(contenido || ''), 'utf8').digest('hex').slice(0, 16);
}

/**
 * Guarda una versión en el archivo. Repetible: si esa huella ya está, no
 * hace nada — el mismo texto guardado dos veces es la misma versión.
 *
 * No lanza nunca. Archivar es importante, pero no tanto como para que un
 * fallo aquí impida guardar la política; el que llama ya respondió al usuario.
 */
async function archivarVersion({ clave, titulo, contenido, usuarioId, usuarioNombre }) {
  const huella = huellaDePolitica(contenido);
  try {
    await pool.query(
      `INSERT IGNORE INTO politica_versiones
         (huella, clave, titulo, contenido, archivada_por, archivada_por_nombre)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [huella, clave, titulo || null, String(contenido || ''), usuarioId || null, usuarioNombre || null]
    );
  } catch (err) {
    console.error('No se pudo archivar la versión de la política:', err.code || err.message);
  }
  return huella;
}

/**
 * ¿Esta huella corresponde a alguna versión que el servidor tenga archivada?
 *
 * Es lo que convierte `consentimiento_version` en evidencia en vez de en un
 * dato que el cliente escribe a su antojo. Devuelve false ante cualquier fallo:
 * «no consta» es la respuesta honesta cuando no se pudo comprobar.
 */
async function versionConocida(huella) {
  if (!huella || !/^[0-9a-f]{16}$/.test(String(huella))) return false;
  try {
    const [[fila]] = await pool.query(
      `SELECT 1 AS existe FROM politica_versiones WHERE huella = ? LIMIT 1`, [String(huella)]
    );
    return !!fila;
  } catch (err) {
    console.error('No se pudo verificar la versión de la política:', err.code || err.message);
    return false;
  }
}

module.exports = { huellaDePolitica, archivarVersion, versionConocida };
