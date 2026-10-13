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
const crypto = require('crypto');
const { execSync, execFileSync } = require('child_process');
// La revisión del zip vive en config/, compartida con el respaldo:
// dos copias de una comprobación de seguridad divergen igual que
// cualquier otra, y aquí divergir deja un camino sin proteger.
const { validarEntradasDelZip } = require('../config/zipSeguro');
const { verificarFirmaParche } = require('../config/verificarFirmaParche');

/**
 * A PARTIR DE ESTE NÚMERO, LA FIRMA ES OBLIGATORIA. SIN EXCEPCIÓN.
 *
 * El #260 es el parche que TRAE este verificador — no puede exigirse su
 * propia firma a sí mismo, porque cuando se generó no existía todavía nada
 * que lo firmara. Es la única ventana que no se puede cerrar por diseño: no
 * se puede verificar criptográficamente el parche que instala la primera
 * verificación criptográfica. Por eso el corte es el SIGUIENTE número, no
 * una fecha de calendario — en cuanto exista un parche #261, ya tiene que
 * venir firmado o no se aplica.
 *
 * Del #260 hacia atrás, ningún parche antiguo trae firma (nunca la tuvo) y
 * eso está bien: ya se aplicaron, esto no los vuelve a tocar.
 * Del #260 en adelante, si el campo `firma` viene presente pero no
 * verifica, se rechaza igual que si la exigencia ya estuviera activa — el
 * modo puente tolera la AUSENCIA de firma, nunca una firma presente pero
 * inválida.
 */
const EXIGIR_FIRMA_DESDE_PARCHE = 261;

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

/**
 * A QUÉ PARCHE CORRESPONDE EL CÓDIGO QUE ESTÁ EN EL DISCO.
 *
 * Lo escribe `generar-parche.js` cada vez que se arma un parche, y viaja
 * DENTRO del parche. Así, una campaña nueva —que se despliega copiando el
 * código de electoral, ya parcheado— sabe con qué número nació.
 */
function leerVersionBase() {
  try {
    return parseInt(fs.readFileSync(path.join(CARPETA_PROYECTO, '.version-base'), 'utf8').trim()) || 0;
  } catch (e) {
    return 0;
  }
}

/**
 * SIN `.version-parche`, LA RESPUESTA NO ES CERO.
 *
 * Cero significa «a esta instalación no se le ha aplicado ningún parche», y de
 * ahí el actualizador se baja y aplica TODOS los que existan — hoy 156, uno por
 * uno, sobre un código que ya los trae puestos. Es trabajo inútil en el mejor
 * caso, y en el peor se rompe: la cadena se detiene en el primer zip que ya no
 * esté en el servidor, y entonces la campaña queda a medias con un error que
 * habla de un parche de hace meses.
 *
 * Y ES LO QUE IMPIDE BORRAR LOS ZIP VIEJOS. Mientras una instalación nueva
 * pueda pedir el parche #1, hay que conservar los 156.
 *
 * Una campaña recién desplegada no está en cero: está en el número del código
 * que se le copió. Eso es lo que dice `.version-base`.
 *
 * Se sigue prefiriendo `.version-parche` cuando existe — es el estado real de
 * ESTA instalación, y manda sobre lo que diga el código.
 */
function leerVersionActual() {
  try {
    return parseInt(fs.readFileSync(ARCHIVO_VERSION, 'utf8').trim()) || 0;
  } catch (e) {
    const base = leerVersionBase();
    if (base > 0) {
      console.log(`Primera corrida en esta instalación: el código que trae corresponde al parche #${base}.`);
      guardarVersionActual(base);   // se anota, para no volver a deducirlo
    }
    return base;
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


async function aplicarParche(parcheInfo) {
  const numeroParche = parcheInfo.numero_parche;
  if (!numeroDeParcheValido(numeroParche)) {
    throw new Error(`El Servidor de Licencias mandó un número de parche que no es un entero: ${JSON.stringify(numeroParche)}.`);
  }
  const nombreZip = `campana-parche${numeroParche}.zip`;
  const rutaZip = path.join(CARPETA_PROYECTO, nombreZip);

  console.log(`Descargando parche #${numeroParche}...`);
  const resp = await llamarConSecreto(`/parches/descargar/${numeroParche}?dominio=${encodeURIComponent(DOMINIO_INSTALACION)}`);
  if (!resp.ok) throw new Error(`No se pudo descargar el parche #${numeroParche} (HTTP ${resp.status})`);
  const buffer = Buffer.from(await resp.arrayBuffer());

  /* SE REGISTRA EL SHA-256 DE LO QUE DE VERDAD LLEGÓ, ANTES DE USARLO PARA
     NADA — ni para verificar la firma, ni para escribirlo a disco. La vez
     que hizo falta reconstruir esta evidencia (parches #260/#261) no
     existía ningún rastro de qué bytes había recibido cada instalación:
     el .zip se borra al terminar con éxito, así que la única forma de
     confirmarlo después fue una cadena de inferencias (el hash publicado,
     que ninguna instalación fue rechazada). Con esto en el log, la próxima
     vez la respuesta está ahí directamente, sin reconstruir nada. */
  const sha256Descargado = crypto.createHash('sha256').update(buffer).digest('hex');
  console.log(`Descargado: ${buffer.length} bytes, sha256 ${sha256Descargado}`);

  /* LA FIRMA SE COMPRUEBA AQUÍ, SOBRE LOS BYTES EN MEMORIA — antes de que
     toquen disco, así sea transitoriamente. `validarEntradasDelZip` de abajo
     ya invoca `unzip -Z1` sobre el archivo para listarlo; que ese archivo
     exista siquiera debe depender de que la firma haya verificado, no al
     revés.

     "Presente pero inválida" se rechaza SIEMPRE, exija o no la versión
     actual la firma — el modo puente tolera la AUSENCIA de firma en
     parches anteriores al #261, nunca una firma presente que no verifica.
     Ver EXIGIR_FIRMA_DESDE_PARCHE arriba para el porqué del número. */
  if (parcheInfo.firma) {
    if (!verificarFirmaParche(buffer, parcheInfo.firma)) {
      throw new Error(`La firma del parche #${numeroParche} no coincide con el contenido descargado. No se aplica.`);
    }
    console.log(`Firma verificada correctamente (Ed25519, ${buffer.length} bytes).`);
  } else if (numeroParche >= EXIGIR_FIRMA_DESDE_PARCHE) {
    throw new Error(
      `El parche #${numeroParche} no trae firma y la verificación es obligatoria desde el ` +
      `#${EXIGIR_FIRMA_DESDE_PARCHE}. No se aplica.`
    );
  } else {
    console.log('Sin firma — permitido por el modo puente (parche anterior al #' + EXIGIR_FIRMA_DESDE_PARCHE + ').');
  }

  fs.writeFileSync(rutaZip, buffer);

  console.log(`Aplicando parche #${numeroParche}...`);

  // ¿El parche trae package.json? Se mira ANTES de descomprimir, sobre el
  // listado del zip: después ya no se sabría si el del disco es el que
  // venía en el parche o el que ya estaba.
  // El mismo listado sirve para las dos cosas: comprobar que ninguna ruta
  // escape del proyecto (ver validarEntradasDelZip) y ver si trae
  // dependencias. Si algo no cuadra, lanza y el parche NO se descomprime.
  const entradas = validarEntradasDelZip(nombreZip, CARPETA_PROYECTO, { env: ENTORNO });
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
  //
  // YA NO SE VUELVE A CONSULTAR /parches/disponibles PARA ESTO: `main()` ya
  // tiene el objeto completo de este parche desde la lista que pidió antes
  // de empezar, y nos lo pasa entero — pedirlo dos veces era una llamada de
  // red redundante por cada parche que se aplicaba.
  if (parcheInfo.toca_base_datos) {
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
      await aplicarParche(parche);
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

module.exports = { numeroDeParcheValido, aplicarParche, EXIGIR_FIRMA_DESDE_PARCHE };
