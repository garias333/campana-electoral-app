#!/usr/bin/env node
// scripts/actualizar-automatico.js
//
// Pensado para correr por cron cada cierto tiempo (ej. una vez al día,
// de madrugada). Consulta al Servidor de Licencias si hay parches
// nuevos, los descarga y se los aplica solo — mismo formato de parche
// que ya usas manualmente (unzip encima del proyecto, npm run init-db
// si toca base de datos, pm2 restart). Reporta el resultado de vuelta.
//
// Uso recomendado en crontab (como el usuario dueño de la app, NO root):
//   0 3 * * * cd /ruta/a/electoral.appestrategia.net && node scripts/actualizar-automatico.js >> logs/actualizaciones.log 2>&1
//
// IMPORTANTE: revisa primero cada parche en un ambiente de pruebas antes
// de marcarlo "Activo" en el panel de licencias — en cuanto lo actives
// ahí, TODAS las instalaciones con actualización automática encendida
// se lo van a aplicar solas, sin que tú lo revises fila por fila.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const SERVIDOR_LICENCIAS = process.env.LICENCIA_SERVIDOR_URL;
const API_SECRET = process.env.LICENCIA_API_SECRET;
const DOMINIO_INSTALACION = process.env.LICENCIA_DOMINIO;
const CARPETA_PROYECTO = path.join(__dirname, '..');
const ARCHIVO_VERSION = path.join(CARPETA_PROYECTO, '.version-parche');

/**
 * Node y PM2 están instalados por usuario (nvm), no en todo el sistema.
 * Eso hace que `npm` y `pm2` existan cuando uno los corre a mano en una
 * terminal —porque el perfil del usuario carga nvm— y NO existan cuando
 * el mismo comando lo lanza el cron o un shell no interactivo, que traen
 * un PATH mínimo. Es el clásico «a mí me funciona».
 *
 * La solución no es adivinar la ruta: el binario de Node que está
 * ejecutando este archivo ya se conoce (process.execPath), y npm y pm2
 * viven en esa misma carpeta. Se antepone al PATH y el problema
 * desaparece, sin depender de cómo se haya arrancado el script.
 */
const CARPETA_BINARIOS = path.dirname(process.execPath);
const ENTORNO = { ...process.env, PATH: `${CARPETA_BINARIOS}:${process.env.PATH || ''}` };

function leerVersionActual() {
  try {
    return parseInt(fs.readFileSync(ARCHIVO_VERSION, 'utf8').trim()) || 0;
  } catch (e) {
    return 0; // si no existe el archivo todavía, se asume que no hay ningún parche aplicado por este sistema
  }
}
function guardarVersionActual(numero) {
  fs.writeFileSync(ARCHIVO_VERSION, String(numero), 'utf8');
}

async function llamarConSecreto(ruta, opciones = {}) {
  const resp = await fetch(`${SERVIDOR_LICENCIAS}${ruta}`, {
    ...opciones,
    headers: { ...(opciones.headers || {}), 'X-API-Secret': API_SECRET }
  });
  return resp;
}

/**
 * Averigua cómo se llama el proceso PM2 de ESTA instalación.
 *
 * No se puede dar por hecho «campana-app»: cada campaña le pone el nombre
 * que quiere al crearlo (campana-app-prueba, campana-municipal…), y con el
 * nombre equivocado el reinicio falla — el parche queda aplicado en disco
 * pero corriendo el código viejo, que es la peor de las dos situaciones
 * porque no se nota hasta que algo se comporta raro.
 *
 * Se busca por la RUTA del script, que sí es única y no depende de cómo
 * alguien haya bautizado el proceso. Se puede forzar con PM2_NOMBRE_PROCESO
 * en el .env si hiciera falta.
 */
function nombreDelProcesoPm2() {
  if (process.env.PM2_NOMBRE_PROCESO) return process.env.PM2_NOMBRE_PROCESO;
  const rutaApp = path.join(CARPETA_PROYECTO, 'app.js');
  try {
    const lista = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: ENTORNO }));
    const propio = lista.find((p) => p.pm2_env && p.pm2_env.pm_exec_path === rutaApp);
    if (propio) return propio.name;
    console.error(`Aviso: ningún proceso de PM2 corre ${rutaApp}.`);
    console.error('Procesos vistos:', lista.map((p) => `${p.name} -> ${p.pm2_env && p.pm2_env.pm_exec_path}`).join(', ') || '(ninguno)');
  } catch (err) {
    console.error('No se pudo consultar la lista de procesos de PM2:', err.message);
  }
  return null;
}

/**
 * El número de parche llega del Servidor de Licencias (viene en su JSON) y
 * termina formando el nombre de un archivo. Se comprueba que sea de verdad
 * un entero antes de usarlo para nada.
 *
 * NO ES PARANOIA: antes se interpolaba tal cual en una orden de shell
 * (`unzip -o campana-parche${n}.zip`), así que un valor como
 * `1.zip; curl … | sh` se habría EJECUTADO. Hoy las órdenes van por
 * execFileSync con argumentos separados —sin shell de por medio—, y además
 * el valor se valida aquí. Las dos cosas, porque una sola se puede deshacer
 * sin querer en un cambio futuro.
 */
function numeroDeParcheValido(valor) {
  // Hoy llega como número: en el Servidor de Licencias la columna es
  // `numero_parche INT`, y mysql2 lo entrega así. Se admite también la forma
  // en texto ("18") porque es el mismo valor y evita rechazar un parche
  // legítimo si algún día ese JSON cambia de forma — pero SOLO dígitos, que
  // es lo que cierra la puerta a que el nombre del archivo lleve nada más.
  if (typeof valor === 'number') return Number.isSafeInteger(valor) && valor > 0;
  if (typeof valor === 'string') {
    const limpio = valor.trim();
    return /^\d+$/.test(limpio) && Number(limpio) > 0 && Number.isSafeInteger(Number(limpio));
  }
  return false;
}

/**
 * Revisa lo que trae el .zip ANTES de descomprimirlo.
 *
 * Un parche se descomprime encima del árbol del proyecto, así que el
 * contenido del archivo decide qué se escribe y dónde. Tres cosas no pueden
 * pasar nunca:
 *
 *   - Rutas absolutas (`/etc/cron.d/x`): escribirían fuera del proyecto.
 *   - Rutas con `..`: el clásico «zip slip», que sube por el árbol y
 *     también escribe fuera.
 *   - Enlaces simbólicos: un enlace que apunte afuera, y un archivo
 *     posterior escrito «a través» de él, logra lo mismo esquivando las dos
 *     comprobaciones anteriores.
 *
 * SE FALLA CERRADO. Si el listado no se puede leer, se aborta: antes esto
 * iba en un try/catch que solo avisaba y seguía descomprimiendo — o sea que
 * un zip ilegible para `unzip -Z1` se aplicaba igual, sin revisar.
 */
function validarEntradasDelZip(nombreZip, carpetaDestino) {
  let nombres;
  try {
    nombres = execFileSync('unzip', ['-Z1', nombreZip], {
      cwd: carpetaDestino, encoding: 'utf8', env: ENTORNO,
    }).split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (err) {
    // `unzip` también sale con error si el archivo está vacío o corrupto.
    // Sea cual sea el motivo, no se puede revisar: no se aplica.
    throw new Error(`No se pudo leer el contenido del parche (¿archivo vacío o dañado?), así que no se aplicó: ${err.message}`);
  }

  if (!nombres.length) throw new Error('El parche no contiene ningún archivo, así que no se aplicó.');

  for (const entrada of nombres) {
    if (entrada.startsWith('/') || /^[A-Za-z]:[\\/]/.test(entrada)) {
      throw new Error(`El parche trae una ruta absoluta y no se aplicó: "${entrada}".`);
    }
    if (entrada.split(/[\\/]/).includes('..')) {
      throw new Error(`El parche trae una ruta que sale del proyecto y no se aplicó: "${entrada}".`);
    }
    const destino = path.resolve(carpetaDestino, entrada);
    if (destino !== carpetaDestino && !destino.startsWith(carpetaDestino + path.sep)) {
      throw new Error(`El parche escribiría fuera del proyecto y no se aplicó: "${entrada}".`);
    }
  }

  // El listado largo marca el tipo en la primera columna, como `ls`:
  // "l" es enlace simbólico.
  const largo = execFileSync('unzip', ['-Z', nombreZip], {
    cwd: carpetaDestino, encoding: 'utf8', env: ENTORNO,
  });
  if (largo.split('\n').some((l) => l.startsWith('l'))) {
    throw new Error('El parche trae enlaces simbólicos y no se aplicó.');
  }

  return nombres;
}

async function aplicarParche(numeroParche) {
  if (!numeroDeParcheValido(numeroParche)) {
    throw new Error(`El Servidor de Licencias mandó un número de parche que no es un entero: ${JSON.stringify(numeroParche)}.`);
  }
  const nombreZip = `campana-parche${numeroParche}.zip`;
  const rutaZip = path.join(CARPETA_PROYECTO, nombreZip);

  console.log(`Descargando parche #${numeroParche}...`);
  const resp = await llamarConSecreto(`/parches/descargar/${numeroParche}?dominio=${encodeURIComponent(DOMINIO_INSTALACION)}`);
  if (!resp.ok) throw new Error(`No se pudo descargar el parche #${numeroParche} (HTTP ${resp.status})`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(rutaZip, buffer);

  console.log(`Aplicando parche #${numeroParche}...`);

  // ¿El parche trae package.json? Se mira ANTES de descomprimir, sobre el
  // listado del zip: después ya no se sabría si el del disco es el que
  // venía en el parche o el que ya estaba.
  // El mismo listado sirve para las dos cosas: comprobar que ninguna ruta
  // escape del proyecto (ver validarEntradasDelZip) y ver si trae
  // dependencias. Si algo no cuadra, lanza y el parche NO se descomprime.
  const entradas = validarEntradasDelZip(nombreZip, CARPETA_PROYECTO);
  const traeDependencias = entradas.includes('package.json');

  execFileSync('unzip', ['-o', nombreZip, '-d', '.'], { cwd: CARPETA_PROYECTO, stdio: 'inherit', env: ENTORNO });

  // INSTALAR DEPENDENCIAS NUEVAS.
  //
  // Hasta el parche 14 esto no existía, y por eso NINGUNA dependencia nueva
  // podía viajar en un parche: el código llegaba, la librería no, y la
  // campaña arrancaba con "Cannot find module" — caída hasta que alguien
  // entrara por SSH. No se había notado porque en catorce parches no se
  // agregó ninguna.
  //
  // Va ANTES del reinicio a propósito. Si la instalación falla, se lanza el
  // error y la campaña queda reportada como fallida SIN reiniciar: el
  // proceso viejo sigue en pie con el código que ya tenía cargado en
  // memoria, en vez de reiniciarse contra archivos nuevos a los que les
  // falta una librería.
  //
  // Corre con el mismo usuario que lanzó el actualizador, que es el dueño
  // del sitio — importante: `npm install` con otro usuario deja los
  // archivos ilegibles para la aplicación (ya tumbó licencias con un 502).
  if (traeDependencias) {
    console.log('El parche trae package.json — instalando dependencias...');
    try {
      execSync('npm install --omit=dev --no-audit --no-fund', {
        cwd: CARPETA_PROYECTO, stdio: 'inherit', env: ENTORNO, timeout: 5 * 60 * 1000,
      });
    } catch (err) {
      throw new Error(
        'El parche se descomprimió pero `npm install` falló, así que NO se reinició: ' +
        'la aplicación sigue corriendo con el código anterior. Revisa la conexión a ' +
        'internet del servidor y vuelve a aplicar el parche. Detalle: ' + err.message);
    }
  }

  // Se corre npm run init-db SIEMPRE que el parche lo requiera según el
  // catálogo (el servidor de licencias nos dice cuáles lo necesitan) —
  // es seguro correrlo de más (las migraciones son defensivas), no lo es
  // saltárselo cuando sí hace falta.
  const infoDisponibles = await (await llamarConSecreto(`/parches/disponibles?version_actual=${numeroParche - 1}&dominio=${encodeURIComponent(DOMINIO_INSTALACION)}`)).json();
  const infoEsteParche = infoDisponibles.find((p) => p.numero_parche === numeroParche);
  if (infoEsteParche && infoEsteParche.toca_base_datos) {
    console.log('Este parche toca la base de datos — corriendo npm run init-db...');
    execSync('npm run init-db', { cwd: CARPETA_PROYECTO, stdio: 'inherit', env: ENTORNO });
  }

  const proceso = nombreDelProcesoPm2();
  if (!proceso) {
    throw new Error(
      'El parche quedó aplicado en disco, pero no se encontró el proceso de PM2 de esta instalación ' +
      'para reiniciarlo, así que sigue corriendo el código anterior. Reinícialo a mano ' +
      '(pm2 list para ver el nombre) o define PM2_NOMBRE_PROCESO en el .env.'
    );
  }
  execSync(`pm2 restart ${proceso}`, { cwd: CARPETA_PROYECTO, stdio: 'inherit', env: ENTORNO });
  fs.unlinkSync(rutaZip);
  guardarVersionActual(numeroParche);
}

async function main() {
  if (!SERVIDOR_LICENCIAS || !API_SECRET || !DOMINIO_INSTALACION) {
    console.error('Faltan variables de entorno (LICENCIA_SERVIDOR_URL, LICENCIA_API_SECRET, LICENCIA_DOMINIO). Nada que hacer.');
    process.exit(1);
  }

  const versionActual = leerVersionActual();
  const resp = await llamarConSecreto(`/parches/disponibles?version_actual=${versionActual}&dominio=${encodeURIComponent(DOMINIO_INSTALACION)}`);
  const disponibles = await resp.json();

  if (!disponibles.length) {
    console.log(`Ya estás al día (versión ${versionActual}). Nada que aplicar.`);
    return;
  }

  console.log(`Hay ${disponibles.length} parche(s) nuevo(s): ${disponibles.map((p) => '#' + p.numero_parche).join(', ')}`);

  for (const parche of disponibles) {
    try {
      await aplicarParche(parche.numero_parche);
      console.log(`Parche #${parche.numero_parche} aplicado correctamente.\n`);
      await llamarConSecreto('/parches/confirmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dominio: DOMINIO_INSTALACION, numero_parche: parche.numero_parche, resultado: 'exitoso' })
      });
    } catch (err) {
      console.error(`Error aplicando el parche #${parche.numero_parche}:`, err.message);
      await llamarConSecreto('/parches/confirmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dominio: DOMINIO_INSTALACION, numero_parche: parche.numero_parche, resultado: 'fallido', detalle: err.message })
      });
      // Se detiene la cadena aquí — los parches son acumulativos, no
      // tiene sentido intentar el siguiente si este falló.
      break;
    }
  }
}

// Solo corre cuando se invoca como programa (`node scripts/actualizar-automatico.js`).
// Así las comprobaciones de arriba se pueden cargar y probar desde otro
// archivo sin disparar una actualización de verdad.
if (require.main === module) {
  main().catch((err) => {
    console.error('Error en la actualización automática:', err);
    process.exit(1);
  });
}

module.exports = { validarEntradasDelZip, numeroDeParcheValido };
