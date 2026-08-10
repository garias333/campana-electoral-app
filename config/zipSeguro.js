/**
 * Revisar un .zip ANTES de descomprimirlo.
 *
 * Esta aplicación descomprime archivos de dos sitios distintos: los parches
 * que manda el Servidor de Licencias y los respaldos que sube un
 * administrador. En los dos casos el contenido del zip decide qué se escribe
 * y dónde, así que hay tres cosas que no pueden pasar nunca:
 *
 *   - Rutas absolutas (`/etc/cron.d/x`): escribirían fuera de la carpeta.
 *   - Rutas con `..`: el clásico «zip slip», que sube por el árbol y también
 *     escribe fuera.
 *   - Enlaces simbólicos: un enlace que apunte afuera, y un archivo posterior
 *     escrito «a través» de él, logra lo mismo esquivando las dos
 *     comprobaciones anteriores.
 *
 * VIVE AQUÍ Y NO EN CADA SITIO QUE DESCOMPRIME. La primera versión estaba
 * dentro de scripts/actualizar-automatico.js, y el respaldo iba a necesitar
 * la suya: dos copias de una comprobación de seguridad divergen igual que
 * cualquier otra —esta misma jornada apareció una copia divergida de
 * verificarPasswordAdmin entre ocho—, y aquí divergir significa que un
 * camino queda desprotegido sin que nadie lo note.
 */

const path = require('path');
const { execFileSync } = require('child_process');

/**
 * @param {string} zip          Ruta o nombre del archivo .zip
 * @param {string} carpetaBase  Carpeta donde se va a descomprimir; nada puede
 *                              quedar fuera de ella
 * @param {object} [opciones]
 * @param {object} [opciones.env] Entorno para encontrar `unzip` en el PATH
 * @returns {string[]}          Los nombres que trae el zip, ya validados
 * @throws                      Si algo no cuadra. FALLA CERRADO: si el
 *                              listado no se puede leer, tampoco se aplica.
 */
function validarEntradasDelZip(zip, carpetaBase, opciones = {}) {
  const ejecutar = (args) => execFileSync('unzip', args, {
    cwd: carpetaBase, encoding: 'utf8', env: opciones.env || process.env,
  });

  let nombres;
  try {
    nombres = ejecutar(['-Z1', zip]).split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (err) {
    // `unzip` también sale con error si el archivo está vacío o corrupto.
    // Sea cual sea el motivo, no se puede revisar: no se descomprime.
    throw new Error(`No se pudo leer el contenido del archivo (¿vacío o dañado?), así que no se aplicó: ${err.message}`);
  }

  if (!nombres.length) throw new Error('El archivo no contiene nada, así que no se aplicó.');

  for (const entrada of nombres) {
    if (entrada.startsWith('/') || /^[A-Za-z]:[\\/]/.test(entrada)) {
      throw new Error(`El archivo trae una ruta absoluta y no se aplicó: "${entrada}".`);
    }
    if (entrada.split(/[\\/]/).includes('..')) {
      throw new Error(`El archivo trae una ruta que sale de la carpeta y no se aplicó: "${entrada}".`);
    }
    const destino = path.resolve(carpetaBase, entrada);
    if (destino !== carpetaBase && !destino.startsWith(carpetaBase + path.sep)) {
      throw new Error(`El archivo escribiría fuera de la carpeta y no se aplicó: "${entrada}".`);
    }
  }

  // El listado largo marca el tipo en la primera columna, como `ls`:
  // "l" es enlace simbólico.
  if (ejecutar(['-Z', zip]).split('\n').some((l) => l.startsWith('l'))) {
    throw new Error('El archivo trae enlaces simbólicos y no se aplicó.');
  }

  return nombres;
}

module.exports = { validarEntradasDelZip };
