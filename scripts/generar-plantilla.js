#!/usr/bin/env node
// scripts/generar-plantilla.js
//
// Arma `plantilla-nueva-campana-vNN.zip`: el código de esta instalación SIN
// nada que sea de ella (credenciales, licencia activada, datos, archivos
// subidos, notas internas). Es lo que se descomprime en el sitio de una
// campaña nueva antes de crear su base con `npm run init-db`.
//
// USO
//   node scripts/generar-plantilla.js --parche 261            # genera el zip
//   node scripts/generar-plantilla.js --parche 261 --simular  # todo menos el zip
//   node scripts/generar-plantilla.js --parche 261 --salida /ruta --forzar
//
//   --parche N   Número de parche que la plantilla declara tener aplicado.
//                Se escribe en `.version-parche` y en `.version-base`. Sin
//                `.version-parche`, la primera corrida del actualizador se
//                cree en cero y baja todos los parches uno por uno.
//   --simular    Arma todo en una carpeta temporal, revisa y lista, pero no
//                escribe el zip.
//   --salida     Carpeta del zip. Por omisión `backups/plantillas/` (ignorada
//                por git y excluida de la propia plantilla).
//   --forzar     Sobrescribe un zip que ya exista con ese nombre.
//
// NO TOCA LA BASE DE DATOS: no carga mysql ni lee el .env.
//
// QUÉ ENTRA: lo que git ve en el árbol —versionado o nuevo pero no ignorado—
// (`git ls-files -co --exclude-standard`), menos la lista EXCLUIR de abajo. Se
// parte de git y no de un recorrido del disco para que .gitignore sea la
// primera red; la lista EXCLUIR es la segunda, por si alguien relaja aquélla.
//
// POR QUÉ INCLUYE config/llaves-parches/: `scripts/actualizar-automatico.js`
// hace `require('../config/verificarFirmaParche')` en su línea 27, y ese módulo
// lee la carpeta al cargarse (línea 78) y LANZA si falta o no tiene ningún
// .pem. Sin la llave, el actualizador muere antes de mirar un solo parche —
// también los anteriores al #261, que no exigen firma.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PROYECTO = path.join(__dirname, '..');

// Lo que NUNCA entra en una plantilla.
const EXCLUIR = [
  /^\.git\//,
  /^\.env$/,
  /^\.env\.(?!example$)/,
  /^\.licencia-cache\.json$/,
  /^\.credenciales-superadmin\.txt$/, // la clave inicial del superadministrador de ESTA instalación
  /^backups\//,
  /^logs\//,
  /^node_modules\//,
  /^parches\//,
  /^uploads\//,          // el contenido; las carpetas se recrean vacías abajo
  /^public\/uploads\//,
  /^sessions\//,
  /^tmp\//,
  /^\.claude\//,
  /^ESTADO\.md$/,
  /^CLAUDE\.md$/,
  /^AUDITORIA[^/]*\.md$/,
  /^LEAMELECTORAL\.md$/,
  /^SPEC-[^/]*\.md$/,
  // De la BD central de licencias, no de la de la campaña.
  /^sql\/migracion-sms-licencias\.sql$/,
  /^sql\/usuario-sms-ledger\.sql$/,
  // De ESTE sitio o de quien publica/opera el VPS; una campaña nueva no los usa.
  // Medido con grep que ni la app, ni el actualizador, ni reiniciar-instancia.sh,
  // ni README/LEAMELECTORAL llaman a ninguno de los scripts de esta lista.
  /^public\/126d9d42626f47c9e397cb9a91c5793b\.html$/, // verificación de dominio de Twilio
  /^scripts\/generar-parche\.js$/,
  /^scripts\/registrar-parche\.js$/,
  /^scripts\/publicar-parche\.sh$/,
  /^scripts\/generar-plantilla\.js$/,
  /^scripts\/instalar-llave-ssh\.sh$/,
  /^scripts\/cerrar-ssh-a-contrasenas\.sh$/,
  /^scripts\/revisar-llaves-ssh\.sh$/,
  /^scripts\/limpiar-copias-env\.sh$/,
  /^scripts\/cerrar-permisos-codigo\.sh$/,
  // Herramientas del operador del VPS: recorren o comparan OTRAS instancias, o
  // llevan sus nombres y rutas dentro.
  /^scripts\/comparar-instancias\.js$/,
  /^scripts\/mapbox-instancias\.sh$/,
  /^scripts\/sincronizar-paleta-compartida\.sh$/,
  /^scripts\/paleta-navy-instrucciones\.md$/,
  /^scripts\/diagnosticar-aspirante\.js$/,
  /^scripts\/verificar-requires\.js$/,
  /^scripts\/probar-instalacion-limpia\.js$/,
  /^README\.md$/, // habla de otros despliegues (Hostinger/Passenger) y de otros proyectos
  // La fuente del LEEME-INSTALACION.md: no viaja como archivo suelto, se
  // copia a la raíz de la plantilla (ver main).
  /^scripts\/plantilla\//,
  // Se escriben con el número que se pasa, no se copian del árbol.
  /^\.version-parche$/,
  /^\.version-base$/,
  // Copias que dejan los editores y las herramientas.
  /\.bak(-|\.)/,
  /\.antes-/,
  /\.previo-/,
];

// Si falta cualquiera de éstos, la plantilla nacería con el actualizador roto.
const OBLIGATORIOS = [
  'app.js',
  'package.json',
  'package-lock.json',
  '.env.example',
  'db/init-db.js',
  'db/schema.sql',
  'scripts/actualizar-automatico.js',
  'config/verificarFirmaParche.js',
  'config/licencia.js',
];

const EXTENSIONES_BINARIAS = /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|otf|pdf|zip|mp3|mp4|webm|ogg|wav)$/i;

// Qué se busca en el contenido del zip. Los valores nunca se imprimen enteros.
const PATRONES = [
  { nombre: 'llave privada PEM', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { nombre: 'hash bcrypt', re: /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{50,}/ },
  { nombre: 'clave de proveedor conocida',
    re: /AKIA[0-9A-Z]{16}|sk_live_[A-Za-z0-9]+|sk-[A-Za-z0-9]{20,}|\bAC[0-9a-f]{32}\b|pk\.eyJ[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{30,}|xox[bp]-[A-Za-z0-9-]+|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/ },
  { nombre: 'credencial literal',
    re: /(password|passwd|secret|api[_-]?key|token|private[_ ]key)['"]?\s*[:=]\s*['"][A-Za-z0-9+/_\-.@#!$]{10,}['"]/i,
    // Líneas que son claramente ejemplo o lectura del entorno.
    ignorar: /process\.env|placeholder|ejemplo|example|tu_|xxx|<[^>]+>/i },
];

function ayudaYSalir(msg) {
  if (msg) console.error('ERROR: ' + msg + '\n');
  console.error('Uso: node scripts/generar-plantilla.js --parche N [--simular] [--salida DIR] [--forzar]');
  process.exit(msg ? 1 : 0);
}

function leerArgs(argv) {
  const a = { simular: false, forzar: false, parche: null, salida: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--simular') a.simular = true;
    else if (x === '--forzar') a.forzar = true;
    else if (x === '--parche') a.parche = argv[++i];
    else if (x === '--salida') a.salida = argv[++i];
    else if (x === '-h' || x === '--help') ayudaYSalir();
    else ayudaYSalir('Argumento desconocido: ' + x);
  }
  if (!/^[1-9]\d{0,5}$/.test(String(a.parche || ''))) {
    ayudaYSalir('--parche debe ser un entero positivo (el número de parche que declara la plantilla).');
  }
  a.parche = Number(a.parche);
  a.salida = path.resolve(PROYECTO, a.salida || path.join('backups', 'plantillas'));
  return a;
}

function git(args) {
  return execFileSync('git', args, { cwd: PROYECTO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function listarArchivos() {
  const todos = git(['ls-files', '-co', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const sinSeguimiento = new Set(git(['ls-files', '-o', '--exclude-standard', '-z']).split('\0').filter(Boolean));
  const incluidos = [];
  const excluidos = [];
  for (const rel of [...new Set(todos)].sort()) {
    const abs = path.join(PROYECTO, rel);
    let st;
    try { st = fs.lstatSync(abs); } catch (_) { continue; } // versionado pero borrado del disco
    if (!st.isFile()) continue; // enlaces simbólicos y submódulos no viajan
    if (EXCLUIR.some((re) => re.test(rel))) excluidos.push(rel);
    else incluidos.push(rel);
  }
  return { incluidos, excluidos, sinSeguimiento };
}

// Carpetas que la plantilla lleva VACÍAS además de las de uploads/. `logs/` es una de
// ellas porque el cron del actualizador redirige su salida a logs/actualizaciones.log:
// si la carpeta no existe, el shell falla al abrir la redirección y el actualizador
// ni siquiera arranca — sin dejar rastro en ningún sitio. El contenido de logs/ del
// repo NUNCA viaja (EXCLUIR lo corta); aquí solo se crea la carpeta.
const CARPETAS_VACIAS_EXTRA = ['logs'];

/** Carpetas de uploads/ (sin su contenido), para recrearlas vacías. */
function carpetasDeUploads() {
  const raiz = path.join(PROYECTO, 'uploads');
  const out = [];
  (function walk(dir) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const abs = path.join(dir, e.name);
      out.push(path.relative(PROYECTO, abs));
      walk(abs);
    }
  })(raiz);
  return out.sort();
}

function comprobarLlaves() {
  const dir = path.join(PROYECTO, 'config', 'llaves-parches');
  let pems;
  try { pems = fs.readdirSync(dir).filter((f) => f.endsWith('.pem')); } catch (_) { pems = []; }
  if (!pems.length) {
    throw new Error('config/llaves-parches/ no tiene ningún .pem: el actualizador de la plantilla moriría al arrancar.');
  }
  for (const f of pems) {
    const pem = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/PRIVATE KEY/.test(pem)) throw new Error(`config/llaves-parches/${f} contiene una llave PRIVADA. No se empaqueta.`);
    let k;
    try { k = crypto.createPublicKey(pem); } catch (e) { throw new Error(`config/llaves-parches/${f} no es una llave pública válida: ${e.message}`); }
    if (k.asymmetricKeyType !== 'ed25519') throw new Error(`config/llaves-parches/${f} no es Ed25519 (es ${k.asymmetricKeyType}).`);
  }
  return pems;
}

function copiar(rel, destRaiz) {
  const origen = path.join(PROYECTO, rel);
  const destino = path.join(destRaiz, rel);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(origen, destino);
  fs.chmodSync(destino, fs.statSync(origen).mode & 0o755);
}

function archivosDe(raiz) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) out.push(path.relative(raiz, abs));
    }
  })(raiz);
  return out.sort();
}

function enmascarar(s) {
  return s.length <= 6 ? '***' : s.slice(0, 4) + '…(' + s.length + ' car.)';
}

/** Busca secretos en el CONTENIDO de una carpeta. Devuelve la lista de hallazgos. */
function buscarSecretos(raiz) {
  const hallazgos = [];
  for (const rel of archivosDe(raiz)) {
    if (EXTENSIONES_BINARIAS.test(rel)) continue;
    const buf = fs.readFileSync(path.join(raiz, rel));
    if (buf.includes(0)) continue;
    const lineas = buf.toString('utf8').split('\n');
    const esEnv = /(^|\/)\.env(\.|$)/.test(rel);
    lineas.forEach((linea, i) => {
      for (const p of PATRONES) {
        const m = linea.match(p.re);
        if (!m) continue;
        if (p.ignorar && p.ignorar.test(linea)) continue;
        hallazgos.push({ rel, linea: i + 1, patron: p.nombre, muestra: enmascarar(m[0]) });
      }
      // Un .env de ejemplo con una clave puesta: la plantilla las lleva vacías.
      if (esEnv) {
        const e = linea.match(/^\s*([A-Z0-9_]*(PASSWORD|SECRET|TOKEN|KEY|CLAVE)[A-Z0-9_]*)\s*=\s*(\S.*)$/);
        if (e) hallazgos.push({ rel, linea: i + 1, patron: `${e[1]} con valor en el .env de ejemplo`, muestra: enmascarar(e[3]) });
      }
    });
  }
  return hallazgos;
}

function main() {
  const args = leerArgs(process.argv.slice(2));
  const nombreZip = `plantilla-nueva-campana-v${args.parche}.zip`;
  const rutaZip = path.join(args.salida, nombreZip);

  if (!args.simular && fs.existsSync(rutaZip) && !args.forzar) {
    ayudaYSalir(`${rutaZip} ya existe. Use --forzar para sobrescribirlo.`);
  }

  const { incluidos, excluidos, sinSeguimiento } = listarArchivos();
  const faltan = OBLIGATORIOS.filter((f) => !incluidos.includes(f));
  if (!fs.existsSync(path.join(PROYECTO, 'scripts', 'plantilla', 'LEEME-INSTALACION.md'))) faltan.push('scripts/plantilla/LEEME-INSTALACION.md');
  if (faltan.length) throw new Error('Faltan archivos indispensables en la plantilla: ' + faltan.join(', '));
  const pems = comprobarLlaves();
  if (!incluidos.some((f) => f.startsWith('config/llaves-parches/') && f.endsWith('.pem'))) {
    throw new Error('Las llaves de parches existen pero git las ignora: no entrarían en la plantilla.');
  }

  // Cuánto se parece este árbol al parche pedido: aviso, no error.
  const leer = (f) => { try { return fs.readFileSync(path.join(PROYECTO, f), 'utf8').trim(); } catch (_) { return '(no existe)'; } };
  const vParche = leer('.version-parche');
  const vBase = leer('.version-base');
  console.log(`Árbol: .version-parche=${vParche}  .version-base=${vBase}  ->  la plantilla declarará ${args.parche}`);
  if (String(args.parche) !== vParche || String(args.parche) !== vBase) {
    console.warn('AVISO: el número pedido no coincide con el del árbol. Si el código del árbol no es el del parche ' +
      args.parche + ', la plantilla mentirá sobre qué parches trae.');
  }

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'plantilla-'));
  const extraido = fs.mkdtempSync(path.join(os.tmpdir(), 'plantilla-verif-'));
  const limpiar = () => {
    for (const d of [stage, extraido]) fs.rmSync(d, { recursive: true, force: true });
  };

  try {
    for (const rel of incluidos) copiar(rel, stage);
    for (const rel of [...carpetasDeUploads(), ...CARPETAS_VACIAS_EXTRA]) fs.mkdirSync(path.join(stage, rel), { recursive: true });
    // LEEME-INSTALACION.md: sale de scripts/plantilla/, con el parche estampado.
    const leeme = fs.readFileSync(path.join(PROYECTO, 'scripts', 'plantilla', 'LEEME-INSTALACION.md'), 'utf8')
      .replace(/\{\{PARCHE\}\}/g, String(args.parche));
    if (/\{\{[A-Z_]+\}\}/.test(leeme)) throw new Error('LEEME-INSTALACION.md tiene un marcador {{…}} sin resolver.');
    fs.writeFileSync(path.join(stage, 'LEEME-INSTALACION.md'), leeme);
    fs.writeFileSync(path.join(stage, '.version-parche'), args.parche + '\n');
    fs.writeFileSync(path.join(stage, '.version-base'), args.parche + '\n');

    if (args.simular) {
      console.log('\n--simular: se revisa la carpeta armada, no se escribe ningún zip.');
      var raizRevisada = stage;
    } else {
      fs.mkdirSync(args.salida, { recursive: true });
      if (fs.existsSync(rutaZip)) fs.rmSync(rutaZip);
      execFileSync('zip', ['-r', '-X', '-q', rutaZip, '.'], { cwd: stage });
      execFileSync('unzip', ['-q', rutaZip, '-d', extraido]);
      var raizRevisada = extraido;
    }

    const contenido = archivosDe(raizRevisada);

    // 1. Ninguna ruta prohibida (salvo las dos que se escriben a propósito).
    const colados = contenido.filter((f) => !['.version-parche', '.version-base'].includes(f) && EXCLUIR.some((re) => re.test(f)));
    // 2. Secretos en el contenido.
    const hallazgos = buscarSecretos(raizRevisada);

    console.log(`\nIncluidos: ${contenido.length} archivos` +
      (args.simular ? '' : `  ->  ${rutaZip}`));
    console.log(`Excluidos del árbol: ${excluidos.length}`);
    for (const f of excluidos) console.log('  - ' + f);
    const nuevos = incluidos.filter((f) => sinSeguimiento.has(f));
    if (nuevos.length) {
      console.log(`\nAVISO: ${nuevos.length} archivo(s) viajan sin estar versionados en git:`);
      for (const f of nuevos) console.log('  ? ' + f);
    }
    console.log('\nCarpetas vacías: ' + ([...carpetasDeUploads(), ...CARPETAS_VACIAS_EXTRA].join(', ') || '(ninguna)'));
    console.log('Llaves de parches: ' + pems.join(', '));
    console.log('\nArchivos de la plantilla:');
    for (const f of contenido) console.log('  ' + f);

    console.log('\nRevisión de secretos sobre el contenido ' + (args.simular ? 'armado' : 'del zip') + ':');
    if (colados.length) {
      console.error('  FALLA: rutas prohibidas dentro de la plantilla:');
      for (const f of colados) console.error('    ' + f);
    }
    if (hallazgos.length) {
      console.error(`  FALLA: ${hallazgos.length} hallazgo(s) (valores enmascarados):`);
      for (const h of hallazgos) console.error(`    ${h.rel}:${h.linea}  ${h.patron}  ${h.muestra}`);
    }
    if (colados.length || hallazgos.length) {
      if (!args.simular) {
        fs.rmSync(rutaZip, { force: true });
        console.error('\nSe borró el zip: no sale una plantilla con hallazgos.');
      }
      process.exitCode = 1;
      return;
    }
    console.log('  sin hallazgos.');

    if (!args.simular) {
      const sha = crypto.createHash('sha256').update(fs.readFileSync(rutaZip)).digest('hex');
      console.log(`\nListo: ${rutaZip}\n  ${fs.statSync(rutaZip).size} bytes  sha256 ${sha}`);
    }
  } finally {
    limpiar();
  }
}

try {
  main();
} catch (err) {
  console.error('ERROR: ' + err.message);
  process.exit(1);
}
