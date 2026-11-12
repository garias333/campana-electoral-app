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
const os = require('os');
const { execSync, execFileSync } = require('child_process');
// La revisión del zip vive en config/, compartida con el respaldo:
// dos copias de una comprobación de seguridad divergen igual que
// cualquier otra, y aquí divergir deja un camino sin proteger.
const { validarEntradasDelZip } = require('../config/zipSeguro');
const { verificarFirmaParche } = require('../config/verificarFirmaParche');
// Qué parches tiene puestos ESTA instalación y si uno nuevo se puede aplicar
// encima (Orden 46). Ver el encabezado de ese archivo.
const {
  NOMBRE_REQUISITO, compactar, leerAplicados, agregarAplicado, requisitoDelZip, decidirAplicacion,
} = require('../config/parchesAplicados');

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
function leerVersionBase(carpeta = CARPETA_PROYECTO) {
  try {
    return parseInt(fs.readFileSync(path.join(carpeta, '.version-base'), 'utf8').trim()) || 0;
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
function leerVersionActual(carpeta = CARPETA_PROYECTO) {
  try {
    return parseInt(fs.readFileSync(path.join(carpeta, '.version-parche'), 'utf8').trim()) || 0;
  } catch (e) {
    const base = leerVersionBase(carpeta);
    if (base > 0) {
      console.log(`Primera corrida en esta instalación: el código que trae corresponde al parche #${base}.`);
      guardarVersionActual(base, carpeta);   // se anota, para no volver a deducirlo
    }
    return base;
  }
}
function guardarVersionActual(numero, carpeta = CARPETA_PROYECTO) {
  fs.writeFileSync(path.join(carpeta, '.version-parche'), String(numero), 'utf8');
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
 * PRUEBA QUE `app.js` CARGA, SIN ABRIR EL PUERTO NI ARRANCAR NADA.
 *
 * Es lo que habría parado el 329 sin el 328: `app.js` importa las rutas y una
 * de ellas llamaba a una función que no existía, así que el `require` lanza
 * ANTES de llegar a `listen`. Un parche así no se ve comparando lo que llegó
 * (los archivos eran idénticos a los de electoral); solo se ve cargando.
 *
 * CÓMO SIN ABRIR EL PUERTO. `app.listen` termina en `net.Server.prototype.listen`;
 * se le pone un reemplazo que no hace nada, ANTES de cargar `app.js`. Así no
 * depende de que `app.js` tenga un «modo de prueba» (el de una campaña vieja
 * no lo tiene) y tampoco choca con la instancia que sigue corriendo en el
 * mismo puerto. Tras cargar se sale a la fuerza: `app.js` deja temporizadores
 * (`setInterval`, la validación periódica de la licencia) que mantendrían vivo
 * el proceso, y lo que alcanza a quedar a medias en el aire ni siquiera llegó
 * a conectarse.
 *
 * Corre con el `node` de quien ejecuta el actualizador y en la carpeta de la
 * instalación, o sea con SU `.env` y SUS `node_modules`.
 */
function probarQueLaAppCarga(carpeta = CARPETA_PROYECTO, env = ENTORNO) {
  const codigo = "require('net').Server.prototype.listen = function () { return this; };" +
    "require('./app'); process.exit(0);";
  try {
    execFileSync(process.execPath, ['-e', codigo], {
      cwd: carpeta, env: { ...env, PARCHE_PRUEBA_CARGA: '1' }, timeout: 60 * 1000,
      stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
    });
    return { ok: true };
  } catch (err) {
    const texto = String(err.stderr || err.message || '').trim();
    // De la traza interesa la línea del error, no el árbol de llamadas.
    const linea = texto.split('\n').find((l) => /\b\w*Error\b|Cannot find module|is not a function/.test(l)) || texto.split('\n')[0] || '';
    return { ok: false, detalle: linea.trim().slice(0, 300), completo: texto };
  }
}

/**
 * Guarda una copia de cada archivo que el zip va a SOBRESCRIBIR, en una carpeta
 * temporal, y apunta cuáles son nuevos (no existían), para poder deshacer.
 * `restaurar()` devuelve lo sobrescrito Y quita lo que el parche creó: dejar
 * un archivo nuevo suelto, con el resto ya vuelto atrás, es otra forma de dejar
 * la app a medias.
 */
function respaldarArchivosDelZip(entradas, carpeta, numero) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), `parche-${numero}-previo-`));
  const sobrescritos = [];
  const nuevos = [];
  for (const rel of entradas) {
    if (rel.endsWith('/')) continue;
    const origen = path.join(carpeta, rel);
    let st;
    try { st = fs.lstatSync(origen); } catch (err) { nuevos.push(rel); continue; }
    if (!st.isFile()) continue;   // un directorio o algo raro con ese nombre: no se toca
    const copia = path.join(raiz, rel);
    fs.mkdirSync(path.dirname(copia), { recursive: true });
    fs.copyFileSync(origen, copia);
    sobrescritos.push({ rel, mode: st.mode, atime: st.atime, mtime: st.mtime });
  }
  return {
    carpetaTemporal: raiz,
    sobrescritos, nuevos,
    restaurar() {
      for (const f of sobrescritos) {
        const destino = path.join(carpeta, f.rel);
        fs.mkdirSync(path.dirname(destino), { recursive: true });
        fs.copyFileSync(path.join(raiz, f.rel), destino);
        try { fs.chmodSync(destino, f.mode & 0o7777); fs.utimesSync(destino, f.atime, f.mtime); } catch (e) { /* cosmético */ }
      }
      for (const rel of nuevos) fs.rmSync(path.join(carpeta, rel), { force: true });
    },
    descartar() { fs.rmSync(raiz, { recursive: true, force: true }); },
  };
}

function reiniciarConPm2(carpeta, env) {
  const proceso = nombreDelProcesoPm2();
  if (!proceso) {
    throw new Error(
      'El parche quedó aplicado en disco, pero no se encontró el proceso de PM2 de esta instalación ' +
      'para reiniciarlo, así que sigue corriendo el código anterior. Reinícialo a mano ' +
      '(pm2 list para ver el nombre) o define PM2_NOMBRE_PROCESO en el .env.'
    );
  }
  execSync(`pm2 restart ${proceso}`, { cwd: carpeta, stdio: 'inherit', env });
}

/**
 * Aplica un zip YA descargado y verificado (firma, sha256). Separado de
 * `aplicarParche` para poder probarlo sin servidor de licencias.
 *
 * ORDEN, y por qué:
 *   1. Revisar el zip (rutas, enlaces).
 *   2. Comprobar el REQUISITO. Si no se cumple: no se descomprime, no se
 *      reinicia, se reporta. Es lo único que habría evitado la caída del 11 de
 *      noviembre de 2026.
 *   3. Guardar copia de lo que se va a pisar.
 *   4. Descomprimir, instalar dependencias y PROBAR QUE LA APP CARGA. Si algo
 *      falla aquí se restaura todo y no se reinicia: un parche roto no tumba
 *      una campaña, queda reportado como fallido y la app sigue con el código
 *      que ya tenía.
 *   5. Solo entonces `init-db` (no se migra la base por un código que no
 *      arranca; si falla, también se restaura) y el reinicio.
 *   6. Anotar el parche como aplicado.
 *
 * @param {{numero_parche: number, toca_base_datos?: boolean}} parcheInfo
 * @param {string} nombreZip   archivo (relativo a `carpeta`) con el zip
 * @param {object} [opciones]  `carpeta`, `env`, `reiniciar(carpeta, env)` — para las pruebas
 */
function instalarZip(parcheInfo, nombreZip, opciones = {}) {
  const carpeta = opciones.carpeta || CARPETA_PROYECTO;
  const env = opciones.env || ENTORNO;
  const reiniciar = opciones.reiniciar || reiniciarConPm2;
  const numeroParche = parcheInfo.numero_parche;
  const rutaZip = path.join(carpeta, nombreZip);

  // 1. Revisar el zip. Si algo no cuadra, lanza y el parche NO se descomprime.
  const entradas = validarEntradasDelZip(nombreZip, carpeta, { env });
  const traeDependencias = entradas.includes('package.json');

  // 2. El requisito.
  const requisito = requisitoDelZip(entradas, nombreZip, carpeta, env);
  const versionActual = leerVersionActual(carpeta);
  const aplicados = leerAplicados(carpeta, versionActual);
  const decision = decidirAplicacion({ numero: Number(numeroParche), requisito, aplicados, versionActual });
  if (!decision.ok) throw new Error(decision.motivo);
  console.log(requisito === null
    ? `Zip sin ${NOMBRE_REQUISITO} (formato anterior): es el #${versionActual + 1}, el siguiente al actual. Se aplica.`
    : `Requisito #${requisito}: ya está aplicado.`);

  // 3. Copia de lo que se va a pisar. El `.parche-requiere` no se descomprime:
  // es del zip, no de la instalación.
  const aDescomprimir = entradas.filter((e) => e !== NOMBRE_REQUISITO);
  const respaldo = respaldarArchivosDelZip(aDescomprimir, carpeta, numeroParche);

  // 4. Descomprimir, dependencias, y probar que carga.
  try {
    console.log(`Aplicando parche #${numeroParche}...`);
    // El `.parche-requiere` es del zip, no de la instalación: no se descomprime (y `-x` de un nombre que el
    // zip no trae imprime un aviso, así que solo se pasa cuando está).
    const sinRequisito = entradas.includes(NOMBRE_REQUISITO) ? ['-x', NOMBRE_REQUISITO] : [];
    execFileSync('unzip', ['-o', nombreZip, ...sinRequisito, '-d', '.'], { cwd: carpeta, stdio: 'inherit', env });

    // INSTALAR DEPENDENCIAS NUEVAS.
    //
    // Hasta el parche 14 esto no existía, y por eso NINGUNA dependencia nueva
    // podía viajar en un parche: el código llegaba, la librería no, y la
    // campaña arrancaba con "Cannot find module" — caída hasta que alguien
    // entrara por SSH.
    //
    // Va ANTES del reinicio a propósito. Corre con el mismo usuario que lanzó
    // el actualizador, que es el dueño del sitio — importante: `npm install`
    // con otro usuario deja los archivos ilegibles para la aplicación (ya
    // tumbó licencias con un 502).
    if (traeDependencias) {
      console.log('El parche trae package.json — instalando dependencias...');
      try {
        (opciones.npmInstall || (() => execSync('npm install --omit=dev --no-audit --no-fund', {
          cwd: carpeta, stdio: 'inherit', env, timeout: 5 * 60 * 1000,
        })))();
      } catch (err) {
        throw new Error(
          'fallido: el parche se descomprimió pero `npm install` falló; se restauraron los archivos anteriores y NO se ' +
          'reinició, así que la aplicación sigue con el código que tenía. Revisa la conexión a internet del servidor ' +
          'y vuelve a aplicar el parche. Detalle: ' + err.message);
      }
    }

    const carga = (opciones.probarCarga || probarQueLaAppCarga)(carpeta, env);
    if (!carga.ok) {
      console.error('La app NO cargaría con este parche:\n' + (carga.completo || carga.detalle));
      throw new Error(`fallido: la app no arrancaría (${carga.detalle || 'sin detalle'}); se restauraron los archivos anteriores y NO se reinició`);
    }
    console.log('Prueba de arranque: app.js carga sin error.');

    // La base, solo con un código que ya se sabe que arranca. `init-db` es seguro correrlo de más (las
    // migraciones son defensivas), no lo es saltárselo cuando sí hace falta. Si falla se restaura el
    // código anterior: dejar el nuevo en disco con la base a medias es lo que habría arrancado mal
    // en el próximo reinicio de PM2.
    if (parcheInfo.toca_base_datos) {
      console.log('Este parche toca la base de datos — corriendo npm run init-db...');
      try {
        (opciones.initDb || (() => execSync('npm run init-db', { cwd: carpeta, stdio: 'inherit', env })))();
      } catch (err) {
        throw new Error(`fallido: init-db falló (${String(err.message).split('\n')[0]}); se restauraron los archivos anteriores y NO se reinició`);
      }
    }
  } catch (err) {
    console.error('Restaurando los archivos que el parche había sobrescrito...');
    try {
      respaldo.restaurar();
      console.error(`Restaurados ${respaldo.sobrescritos.length} archivo(s); ${respaldo.nuevos.length} nuevo(s) quitado(s).`);
      respaldo.descartar();
    } catch (errRestauro) {
      // Lo peor que puede pasar: no se pudo deshacer. Se deja la copia donde está y se dice dónde.
      err.message += ` | ADEMÁS NO SE PUDO RESTAURAR (${errRestauro.message}); la copia de lo anterior está en ${respaldo.carpetaTemporal}`;
    }
    throw err;
  }

  // 5. Reinicio. (`init-db` ya corrió arriba, dentro de la zona protegida.)
  reiniciar(carpeta, env);

  // 6. Aplicado de verdad.
  respaldo.descartar();
  fs.rmSync(rutaZip, { force: true });
  guardarVersionActual(Math.max(Number(numeroParche), versionActual), carpeta);
  agregarAplicado(carpeta, Number(numeroParche), versionActual);
}

async function aplicarParche(parcheInfo, opciones = {}) {
  const numeroParche = parcheInfo.numero_parche;
  if (!numeroDeParcheValido(numeroParche)) {
    throw new Error(`El Servidor de Licencias mandó un número de parche que no es un entero: ${JSON.stringify(numeroParche)}.`);
  }
  const carpeta = opciones.carpeta || CARPETA_PROYECTO;
  const nombreZip = `campana-parche${numeroParche}.zip`;
  const rutaZip = path.join(carpeta, nombreZip);

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
     toquen disco, así sea transitoriamente. `validarEntradasDelZip` ya invoca
     `unzip -Z1` sobre el archivo para listarlo; que ese archivo exista
     siquiera debe depender de que la firma haya verificado, no al revés.

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
  try {
    instalarZip(parcheInfo, nombreZip, opciones);
  } finally {
    // Aplicado o rechazado, el zip descargado no se queda en la carpeta del sitio.
    fs.rmSync(rutaZip, { force: true });
  }
}

async function main() {
  if (!SERVIDOR_LICENCIAS || !API_SECRET || !DOMINIO_INSTALACION) {
    console.error('Faltan variables de entorno (LICENCIA_SERVIDOR_URL, LICENCIA_API_SECRET, LICENCIA_DOMINIO). Nada que hacer.');
    process.exit(1);
  }

  const versionActual = leerVersionActual();
  /* SE LE DICE AL SERVIDOR QUÉ PARCHES SE TIENEN, no solo el último número: con
     ello el servidor no ofrece un parche cuyo requisito no esté en la lista
     (ver config/parchesAplicados.js). Va compactada («1-332»). */
  const aplicados = compactar(leerAplicados(CARPETA_PROYECTO, versionActual));
  const resp = await llamarConSecreto(`/parches/disponibles?version_actual=${versionActual}&dominio=${encodeURIComponent(DOMINIO_INSTALACION)}` +
    (aplicados ? `&aplicados=${encodeURIComponent(aplicados)}` : ''));
  const disponibles = await resp.json();
  if (!Array.isArray(disponibles)) {
    console.error('El Servidor de Licencias no devolvió una lista de parches:', JSON.stringify(disponibles));
    process.exit(1);
  }

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
        body: JSON.stringify({
          dominio: DOMINIO_INSTALACION, numero_parche: parche.numero_parche, resultado: 'exitoso',
          aplicados: compactar(leerAplicados(CARPETA_PROYECTO, leerVersionActual())),
        })
      });
    } catch (err) {
      console.error(`Error aplicando el parche #${parche.numero_parche}:`, err.message);
      await llamarConSecreto('/parches/confirmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dominio: DOMINIO_INSTALACION, numero_parche: parche.numero_parche, resultado: 'fallido', detalle: err.message.slice(0, 1000) })
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

module.exports = { numeroDeParcheValido, aplicarParche, instalarZip, probarQueLaAppCarga, EXIGIR_FIRMA_DESDE_PARCHE };
