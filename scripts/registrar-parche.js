#!/usr/bin/env node
/**
 * REGISTRA UN PARCHE EN EL PANEL DE LICENCIAS. INACTIVO. NADA MÁS.
 *
 * Uso:
 *   node scripts/registrar-parche.js 156 "Título corto" ["Descripción larga"]
 *
 * Es la otra mitad de scripts/publicar-parche.sh. Aquel deja el .zip en la
 * carpeta desde la que el servidor SIRVE las descargas; éste crea la fila que
 * hace que el panel lo VEA. Sin las dos, el archivo está y no lo ve nadie.
 *
 * ------------------------------------------------------------------------
 * NACE INACTIVO, Y HAY QUE ESCRIBIRLO A MANO
 *
 * En `db/schema.sql` del servidor de licencias:
 *
 *     activo TINYINT(1) DEFAULT 1
 *
 * O sea que una fila insertada sin decir nada nace ACTIVA y empieza a
 * distribuirse a todas las instalaciones con actualización automática. El
 * texto del panel —«mientras un parche esté Inactivo, ninguna instalación lo
 * va a descargar solo»— describe un estado que hay que PONER, no uno en el que
 * se empieza.
 *
 * Por eso aquí `activo` va explícito en 0. Es lo que mantiene la frontera que
 * se pidió: este guion deja el parche listo y visible; activarlo y aplicarlo
 * siguen siendo del panel.
 * ------------------------------------------------------------------------
 *
 * LO QUE NO PUEDE HACER: activar un parche, aplicarlo a ninguna instalación,
 * borrar filas, ni tocar ninguna otra tabla. Una sola sentencia, un INSERT.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const LICENCIAS = '/home/appestrategia-licencias/htdocs/licencias.appestrategia.net';

const numero = parseInt(process.argv[2], 10);
const nombre = process.argv[3];
const descripcion = process.argv[4] || null;

if (!Number.isInteger(numero) || numero < 1 || !nombre) {
  console.error('Uso: node scripts/registrar-parche.js <numero> "<nombre>" ["<descripcion>"]');
  process.exit(1);
}

/** Las credenciales se leen aquí y no se imprimen nunca. */
function credenciales() {
  const texto = fs.readFileSync(path.join(LICENCIAS, '.env'), 'utf8');
  const leer = (clave) => {
    const m = texto.match(new RegExp('^' + clave + '\\s*=\\s*(.*)$', 'm'));
    if (!m) return null;
    // Mismas comillas que dotenv: dobles, simples o ninguna.
    return m[1].trim().replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');
  };
  return { host: leer('DB_HOST') || 'localhost', user: leer('DB_USER'),
           password: leer('DB_PASSWORD'), database: leer('DB_NAME') };
}

(async () => {
  const archivo = `parche-${numero}.zip`;
  const rutaZip = path.join(LICENCIAS, 'parches', archivo);

  // El archivo PRIMERO. Registrar un parche cuyo zip no está deja el panel
  // ofreciendo una descarga que da 404, y la campaña lo reporta como fallido.
  if (!fs.existsSync(rutaZip)) {
    console.error(`No está ${rutaZip}`);
    console.error('Ponlo primero:  bash scripts/publicar-parche.sh ' + numero);
    process.exit(1);
  }

  // `toca_base_datos` se DEDUCE del contenido, no se pregunta. Marcarlo a mano
  // es la clase de dato que alguien pone por si acaso: el 155 se publicó con
  // «Sí» sin traer un solo archivo de db/, y eso hace correr `npm run init-db`
  // en cada campaña sin necesidad.
  const { execFileSync } = require('child_process');
  const listado = execFileSync('unzip', ['-Z1', rutaZip], { encoding: 'utf8' });
  const tocaBaseDatos = listado.split('\n').some((f) => f.startsWith('db/'));

  const conexion = await mysql.createConnection(credenciales());
  try {
    const [[existe]] = await conexion.query(
      'SELECT numero_parche, nombre, activo FROM parches_disponibles WHERE numero_parche = ?', [numero]);
    if (existe) {
      console.error(`El parche #${numero} YA está registrado: «${existe.nombre}» (activo=${existe.activo}).`);
      console.error('Un número ya publicado no se reutiliza: para cambios nuevos, número nuevo.');
      process.exit(1);
    }

    await conexion.query(
      `INSERT INTO parches_disponibles
         (numero_parche, nombre, descripcion, archivo_nombre, toca_base_datos, activo, modo_distribucion)
       VALUES (?, ?, ?, ?, ?, 0, 'todos')`,
      [numero, nombre, descripcion, archivo, tocaBaseDatos ? 1 : 0]
    );

    console.log(`Registrado el parche #${numero}: «${nombre}»`);
    console.log(`  archivo         : ${archivo} (${(fs.statSync(rutaZip).size / 1024).toFixed(1)} KB)`);
    console.log(`  toca base datos : ${tocaBaseDatos ? 'SÍ (trae archivos de db/)' : 'no'}`);
    console.log('  estado          : INACTIVO');
    console.log('');
    console.log('Inactivo a propósito: ninguna instalación lo va a descargar sola.');
    console.log('Actívalo y aplícalo desde el panel cuando lo hayas probado.');
  } finally {
    await conexion.end();
  }
})().catch((err) => {
  console.error('No se pudo registrar:', err.code || err.message);
  process.exit(1);
});
