#!/usr/bin/env node
// scripts/generar-parche.js
//
// Arma el .zip de un parche para subir al panel de licencias
// (licencias.appestrategia.net → Parches). De ahí lo recoge solo
// scripts/actualizar-automatico.js en cada campaña.
//
// Uso:
//   node scripts/generar-parche.js 7 archivo1 archivo2 ...
//   node scripts/generar-parche.js 7 --desde-fecha "2026-08-07 12:00"
//   node scripts/generar-parche.js 7 --lista parche7.txt
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
const path = require('path');
const { execFileSync } = require('child_process');

const PROYECTO = path.join(__dirname, '..');
const SALIDA = path.join(PROYECTO, 'parches');

// Rutas que jamás pueden viajar en un parche.
const PROHIBIDOS = [
  /^\.env$/,
  /^\.env\./,
  /^\.licencia-cache\.json$/,
  /^\.credenciales-superadmin\.txt$/,
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

function main() {
  const args = process.argv.slice(2);
  const numero = parseInt(args[0], 10);
  if (!Number.isInteger(numero) || numero < 1) {
    console.error('Falta el número del parche. Ej: node scripts/generar-parche.js 7 routes/diaD.routes.js');
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
     quien lo aplique diciendo un número más viejo del que tiene. */
  fs.writeFileSync(path.join(PROYECTO, '.version-base'), String(numero) + '\n', 'utf8');
  if (!archivos.includes('.version-base')) archivos.push('.version-base');

  /* Y SE PONE AL DIA `.version-parche` DE ESTA INSTALACION.
     Quien genera parches es la plantilla, y la plantilla NO los recibe: su
     `.version-parche` solo existe para que, si alguien dispara una
     actualizacion contra ella, no encuentre nada que aplicar. Si se queda
     atras, encuentra su propia historia.
     Ya paso: decia 161 con el codigo del 167 —seis parches de diferencia— y no
     lo delataba nada, porque el numero no se usa para nada mas.
     NUNCA LO BAJA. Este archivo viaja en los parches, asi que existe tambien en
     las campañas; si alguien lo corriera alli con un numero menor, bajarle el
     `.version-parche` le haria reaplicar parches ya puestos. */
  const rutaVersion = path.join(PROYECTO, '.version-parche');
  let versionActual = 0;
  try { versionActual = parseInt(fs.readFileSync(rutaVersion, 'utf8').trim()) || 0; } catch (e) { /* no existe */ }
  if (numero > versionActual) fs.writeFileSync(rutaVersion, String(numero) + '\n', 'utf8');

  fs.mkdirSync(SALIDA, { recursive: true });
  const nombreZip = `campana-parche${numero}.zip`;
  const rutaZip = path.join(SALIDA, nombreZip);
  fs.rmSync(rutaZip, { force: true });

  // -X quita metadatos del sistema; el zip queda igual entre corridas.
  execFileSync('zip', ['-q', '-X', rutaZip, ...archivos], { cwd: PROYECTO });

  const tam = (fs.statSync(rutaZip).size / 1024).toFixed(1);
  console.log(`Parche #${numero} generado: parches/${nombreZip} (${tam} KB, ${archivos.length} archivos)`);
  archivos.forEach((a) => console.log('   ' + a));
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

main();
