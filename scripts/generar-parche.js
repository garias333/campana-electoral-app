#!/usr/bin/env node
// scripts/generar-parche.js
//
// Arma el .zip de un parche para subir al panel de licencias
// (licencias.appestrategia.net → Parches). De ahí lo recoge solo
// scripts/actualizar-automatico.js en cada campaña.
//
// Uso:
//   node scripts/generar-parche.js 7 --requiere 6 archivo1 archivo2 ...
//   node scripts/generar-parche.js 7 --requiere 6 --desde-fecha "2026-08-07 12:00"
//   node scripts/generar-parche.js 7 --requiere 6 --lista parche7.txt
//   node scripts/generar-parche.js 7 --titulo "Lo que hace (Requiere el 6)" archivo1 ...
//
// EL REQUISITO ES OBLIGATORIO (Orden 46). Cada parche dice sobre cuál se apoya
// (`--requiere N`, o «Requiere el N» en el `--titulo`), y ese número viaja DENTRO
// del zip, en `.parche-requiere`: el actualizador de cada campaña se niega a
// aplicarlo si no tiene el N puesto. Sin requisito el script no genera nada,
// salvo con `--sin-requisito` explícito (el primer parche de una cadena, o uno
// que de verdad no depende de ninguno). Si el título y `--requiere` no
// coinciden, se avisa y manda `--requiere`.
//
// ANTES DE ESCRIBIR EL ZIP SE PRUEBA «base anterior + zip» con
// scripts/verificar-requires.js (¿resuelve cada require? ¿existe cada nombre
// importado con llaves?). Si falla, no se genera nada. La base es el árbol de
// git en el commit que marcó la versión N (`--base <carpeta|commit>` la cambia).
//
// El número es el del parche, y debe ser MAYOR que el de todos los
// anteriores: el actualizador los aplica en orden y cada campaña recuerda
// hasta cuál va (archivo .version-parche).
//
// QUÉ NO ENTRA NUNCA, aunque se pida explícitamente: .env,
// .licencia-cache.json, uploads/, legislacion/, backups/, node_modules/ y cualquier
// .sql de datos. Un parche va a TODAS las campañas; si se colara el .env
// de esta instalación, las demás quedarían apuntando a esta base de datos
// y con estas credenciales. Por eso la exclusión no es opcional ni
// configurable: está aquí y falla ruidosamente.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const PROYECTO = path.join(__dirname, '..');
const SALIDA = path.join(PROYECTO, 'parches');

// Rutas que jamás pueden viajar en un parche.
const PROHIBIDOS = [
  /^\.env$/,
  /^\.env\./,
  /^\.licencia-cache\.json$/,
  // Estado de CADA instalación, nunca de un parche: `.parches-aplicados` es la lista de lo que
  // tiene puesto (un zip que la trajera le diría «tienes del 1 al N» a quien no los tiene), y
  // `.parche-requiere` lo escribe este script al armar el zip, no se lista a mano.
  /^\.parches-aplicados$/,
  /^\.parche-requiere$/,
  /^\.credenciales-[^/]*\.txt$/, // la clave inicial del superadmin y del admin de ESTA instalación
  /^uploads\//,
  /^backups\//,
  /^node_modules\//,
  /^\.git\//,
  // Los PDF de Legislación (y su indice.json) los sube el administrador de
  // cada instalación con el administrador de archivos del servidor. Un parche
  // jamás debe pisarlos ni agregarlos: lo que haya en la carpeta es de ESA
  // instalación (ver routes/legislacion.routes.js).
  /^legislacion\//,
  // Caché del buscador de Legislación: se regenera sola en cada instalación.
  /^datos\//,
  // El guion que copia legislacion/ a las campañas corre SOLO en el VPS, como
  // root, desde esta instalación; en una campaña no tiene nada que hacer (y su
  // lista de exclusión lleva rutas de este servidor).
  /^scripts\/sincronizar-legislacion\.sh$/,
  /^scripts\/legislacion-excluir\.txt$/,
  // Cualquier .sql que NO sea del esquema: los volcados de datos
  // (respaldo_*.sql, datos-campana.sql) llevan votantes reales de ESTA
  // campaña. `db/schema.sql` sí viaja: es la definición de las tablas y
  // init-db.js la necesita al día.
  /^(?!db\/).*\.sql$/,
  /^parches\//,
  /^conversaciones\//,
  /^\.claude\//,
  // La llave pública con la que cada instalación verifica la firma de un
  // parche antes de aplicarlo (ver config/verificarFirmaParche.js). Si un
  // parche pudiera tocar su propia llave de verificación, un solo parche
  // colado sin firma válida bastaría para plantar la llave del atacante y
  // que sus firmas futuras "verificaran". Rotarla es un despliegue manual,
  // nunca un parche.
  /^config\/llaves-parches\//
];

function esProhibido(rel) {
  return PROHIBIDOS.some((re) => re.test(rel));
}

/** Archivos modificados después de una fecha, para no listarlos a mano. */
function archivosDesde(fecha) {
  const salida = execFileSync('find', [
    '.', '-type', 'f', '-newermt', fecha,
    '-not', '-path', './node_modules/*',
    '-not', '-path', './.git/*',
    '-not', '-path', './uploads/*',
    '-not', '-path', './legislacion/*',
    '-not', '-path', './datos/*',
    '-not', '-path', './scripts/sincronizar-legislacion.sh',
    '-not', '-path', './scripts/legislacion-excluir.txt',
    '-not', '-path', './backups/*',
    '-not', '-path', './parches/*'
  ], { cwd: PROYECTO, encoding: 'utf8' });
  return salida.split('\n').filter(Boolean).map((l) => l.replace(/^\.\//, ''));
}

/** Saca las opciones con valor/bandera de los argumentos y deja el resto en orden. */
function separarOpciones(args) {
  const opciones = { requiere: null, sinRequisito: false, titulo: null, base: null };
  const resto = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === '--sin-requisito') opciones.sinRequisito = true;
    else if (a === '--requiere' || a === '--titulo' || a === '--base') {
      if (args[k + 1] === undefined) { console.error(`Falta el valor de ${a}.`); process.exit(1); }
      const v = args[++k];
      if (a === '--requiere') opciones.requiere = v;
      else if (a === '--titulo') opciones.titulo = v;
      else opciones.base = v;
    } else resto.push(a);
  }
  return { opciones, resto };
}

/** El N de «Requiere el N» / «Requiere N» en un título, o null. */
function requisitoDelTitulo(titulo) {
  const m = /\brequiere\s+(?:el\s+)?#?(\d+)\b/i.exec(titulo || '');
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Carpeta con el árbol sobre el que se aplicará el parche («base anterior»):
 *   · `--base <carpeta>`            tal cual
 *   · `--base <commit>`             `git archive` de ese commit
 *   · sin --base, con requisito N   el commit que marcó la versión base N (el
 *                                   primero que escribió «N» en `.version-base`):
 *                                   es el código que tiene una campaña en N
 *   · sin --base ni requisito       HEAD (lo ya confirmado)
 * Devuelve {carpeta, descripcion, limpiar}.
 */
function prepararBase(requisito, baseArg) {
  if (baseArg && fs.existsSync(baseArg) && fs.statSync(baseArg).isDirectory()) {
    return { carpeta: path.resolve(baseArg), descripcion: `carpeta ${baseArg}`, limpiar() {} };
  }
  let commit = baseArg || null;
  let descripcion;
  if (!commit && requisito !== null) {
    const salida = execFileSync('git', ['log', '--format=%H', '--reverse', '-G', `^${requisito}$`, '--', '.version-base'],
      { cwd: PROYECTO, encoding: 'utf8' }).split('\n').filter(Boolean);
    commit = salida[0] || null;
    if (!commit) console.warn(`AVISO: no encontré en git el commit que marcó la versión base ${requisito}; se usa HEAD como base.`);
  }
  if (!commit) commit = 'HEAD';
  descripcion = `git ${commit.slice(0, 7)}`;
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'base-parche-'));
  const tar = spawnSync('sh', ['-c', `git archive ${JSON.stringify(commit)} | tar -x -C ${JSON.stringify(carpeta)}`], { cwd: PROYECTO, encoding: 'utf8' });
  if (tar.status !== 0) {
    fs.rmSync(carpeta, { recursive: true, force: true });
    console.error(`No pude armar la base desde git (${commit}): ${tar.stderr || tar.error}`);
    process.exit(1);
  }
  return { carpeta, descripcion, limpiar() { fs.rmSync(carpeta, { recursive: true, force: true }); } };
}

function main() {
  const { opciones, resto: args } = separarOpciones(process.argv.slice(2));
  const numero = parseInt(args[0], 10);
  if (!Number.isInteger(numero) || numero < 1) {
    console.error('Falta el número del parche. Ej: node scripts/generar-parche.js 7 --requiere 6 routes/diaD.routes.js');
    process.exit(1);
  }

  // ---- El requisito: obligatorio, y coherente con el título ----
  const delTitulo = requisitoDelTitulo(opciones.titulo);
  let requisito = null;
  if (opciones.requiere !== null) {
    if (!/^\d+$/.test(opciones.requiere) || Number(opciones.requiere) < 1) {
      console.error(`--requiere debe ser un número entero positivo (recibí «${opciones.requiere}»).`);
      process.exit(1);
    }
    requisito = Number(opciones.requiere);
    if (delTitulo !== null && delTitulo !== requisito) {
      console.warn(`AVISO: el título dice «Requiere el ${delTitulo}» pero --requiere es ${requisito}. Manda --requiere (${requisito}); corrige el título.`);
    }
  } else if (delTitulo !== null) {
    requisito = delTitulo;
    console.log(`Requisito tomado del título: ${requisito}.`);
  }
  if (opciones.sinRequisito && requisito !== null) {
    console.error('--sin-requisito y un requisito (--requiere o «Requiere el N» en el título) se contradicen. No se generó nada.');
    process.exit(1);
  }
  if (requisito === null && !opciones.sinRequisito) {
    console.error('Este parche no dice sobre cuál se apoya y por eso no se generó nada.');
    console.error('  --requiere N            el número del parche que debe estar aplicado antes');
    console.error('  --titulo "… (Requiere el N)"   (de ahí se toma N si no se da --requiere)');
    console.error('  --sin-requisito         solo si de verdad no depende de ninguno');
    process.exit(1);
  }
  if (requisito !== null && requisito >= numero) {
    console.error(`El parche #${numero} no puede requerir el #${requisito}: un parche solo se apoya en uno anterior.`);
    process.exit(1);
  }

  let archivos;
  const resto = args.slice(1);
  if (resto[0] === '--desde-fecha') {
    if (!resto[1]) { console.error('Falta la fecha. Ej: --desde-fecha "2026-08-07 12:00"'); process.exit(1); }
    archivos = archivosDesde(resto[1]);
  } else if (resto[0] === '--lista') {
    if (!resto[1]) { console.error('Falta la ruta del archivo de lista.'); process.exit(1); }
    archivos = fs.readFileSync(resto[1], 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  } else {
    archivos = resto;
  }

  if (!archivos.length) {
    console.error('No hay archivos que empaquetar.');
    process.exit(1);
  }

  // Se revisa TODO antes de escribir nada: más vale no generar el parche
  // que generar uno con un secreto adentro.
  const colados = archivos.filter(esProhibido);
  if (colados.length) {
    console.error('Estos archivos no pueden ir en un parche y por eso no se generó nada:');
    colados.forEach((a) => console.error('  ' + a));
    console.error('\n(.env y las credenciales son de ESTA instalación; un parche va a todas las campañas.)');
    process.exit(1);
  }

  const faltantes = archivos.filter((a) => !fs.existsSync(path.join(PROYECTO, a)));
  if (faltantes.length) {
    console.error('Estos archivos no existen:');
    faltantes.forEach((a) => console.error('  ' + a));
    process.exit(1);
  }

  // Si el parche toca db/init-db.js, hay migraciones que correr. El panel
  // de licencias tiene una casilla para eso ("toca_base_datos") y el
  // actualizador la lee para decidir si corre npm run init-db.
  const tocaBaseDatos = archivos.some((a) => a.startsWith('db/'));

  /* SE ESTAMPA A QUÉ PARCHE CORRESPONDE ESTE CÓDIGO, y viaja dentro del zip.
     Lo lee `actualizar-automatico.js` cuando una instalación no tiene todavía
     `.version-parche` — o sea, en su primera corrida.
     Sin esto, una campaña recién desplegada se cree en cero y se baja los 156
     parches que ya trae puestos, uno por uno; y mientras eso pueda pasar, no se
     puede borrar ni un zip viejo del servidor de licencias.
     Va SIEMPRE, aunque no se haya pedido: un parche que no lo lleve dejaría a
     quien lo aplique diciendo un número más viejo del que tiene.

     Se anota el valor anterior: si la verificación de abajo falla, se devuelve
     (un parche que no se generó no debe dejar la versión base cambiada). */
  const rutaBase = path.join(PROYECTO, '.version-base');
  const baseAnterior = fs.existsSync(rutaBase) ? fs.readFileSync(rutaBase, 'utf8') : null;
  fs.writeFileSync(rutaBase, String(numero) + '\n', 'utf8');
  if (!archivos.includes('.version-base')) archivos.push('.version-base');

  fs.mkdirSync(SALIDA, { recursive: true });
  const nombreZip = `campana-parche${numero}.zip`;
  const rutaZip = path.join(SALIDA, nombreZip);

  // El zip se arma en una carpeta temporal y solo pasa a parches/ si la verificación pasa.
  const trabajo = fs.mkdtempSync(path.join(os.tmpdir(), 'generar-parche-'));
  const zipTemporal = path.join(trabajo, nombreZip);
  const deshacer = () => {
    fs.rmSync(trabajo, { recursive: true, force: true });
    if (baseAnterior === null) fs.rmSync(rutaBase, { force: true }); else fs.writeFileSync(rutaBase, baseAnterior, 'utf8');
  };
  let base = null;
  try {
    // -X quita metadatos del sistema; el zip queda igual entre corridas.
    execFileSync('zip', ['-q', '-X', zipTemporal, ...archivos], { cwd: PROYECTO });
    if (requisito !== null) {
      fs.writeFileSync(path.join(trabajo, '.parche-requiere'), String(requisito) + '\n', 'utf8');
      execFileSync('zip', ['-q', '-X', zipTemporal, '.parche-requiere'], { cwd: trabajo });
    }

    // ---- «base anterior + zip» ----
    base = prepararBase(requisito, opciones.base);
    console.log(`Verificando «base anterior + zip» (base: ${base.descripcion})...`);
    const ver = spawnSync(process.execPath, [path.join(__dirname, 'verificar-requires.js'), zipTemporal, base.carpeta], { encoding: 'utf8' });
    if (ver.status !== 0) {
      process.stderr.write(ver.stdout || '');
      process.stderr.write(ver.stderr || '');
      console.error('\nverificar-requires.js falló sobre «base anterior + zip»: el parche dejaría la app sin arrancar en una campaña que esté en la base.');
      console.error('No se generó nada (.version-base quedó como estaba).');
      deshacer();
      process.exit(1);
    }
    console.log((ver.stdout || '').trim().split('\n').slice(-2).join(' — '));
  } catch (err) {
    deshacer();
    console.error('No se pudo armar el parche:', err.message);
    process.exit(1);
  } finally {
    if (base) base.limpiar();
  }

  /* Y SE PONE AL DIA `.version-parche` DE ESTA INSTALACION.
     Quien genera parches es la plantilla, y la plantilla NO los recibe: su
     `.version-parche` solo existe para que, si alguien dispara una
     actualizacion contra ella, no encuentre nada que aplicar. Si se queda
     atras, encuentra su propia historia.
     Ya paso: decia 161 con el codigo del 167 —seis parches de diferencia— y no
     lo delataba nada, porque el numero no se usa para nada mas.
     NUNCA LO BAJA. Este archivo viaja en los parches, asi que existe tambien en
     las campañas; si alguien lo corriera alli con un numero menor, bajarle el
     `.version-parche` le haria reaplicar parches ya puestos.
     Solo se toca cuando el parche YA pasó la verificación. */
  const rutaVersion = path.join(PROYECTO, '.version-parche');
  let versionActual = 0;
  try { versionActual = parseInt(fs.readFileSync(rutaVersion, 'utf8').trim()) || 0; } catch (e) { /* no existe */ }
  if (numero > versionActual) fs.writeFileSync(rutaVersion, String(numero) + '\n', 'utf8');

  fs.rmSync(rutaZip, { force: true });
  fs.copyFileSync(zipTemporal, rutaZip);
  fs.rmSync(trabajo, { recursive: true, force: true });

  const listado = execFileSync('unzip', ['-Z1', rutaZip], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const tam = (fs.statSync(rutaZip).size / 1024).toFixed(1);
  console.log(`Parche #${numero} generado: parches/${nombreZip} (${tam} KB, ${listado.length} archivos)`);
  console.log(requisito !== null ? `Requiere el #${requisito} (viaja en .parche-requiere).` : 'SIN REQUISITO (--sin-requisito): el actualizador solo lo aplicará si es el siguiente al .version-parche.');
  listado.forEach((a) => console.log('   ' + a));
  console.log('');
  console.log(tocaBaseDatos
    ? '⚠  TOCA LA BASE DE DATOS: al subirlo, marca la casilla "toca base de datos"\n   para que cada campaña corra npm run init-db al aplicarlo.'
    : 'No toca la base de datos: no hace falta marcar esa casilla.');
  console.log('');
  console.log('Siguiente paso: súbelo en licencias.appestrategia.net → Parches,');
  console.log(`como parche #${numero}, y actívalo cuando lo hayas probado.`);
  console.log('En cuanto quede activo, TODAS las campañas con actualización');
  console.log('automática encendida se lo aplican solas.');
}

if (require.main === module) main();

module.exports = { requisitoDelTitulo };
