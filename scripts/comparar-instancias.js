#!/usr/bin/env node
// scripts/comparar-instancias.js
//
// Dice si las instancias del VPS corren el mismo código que esta, y en qué
// archivos difieren.
//
// POR QUÉ EXISTE
//   El 9 de agosto de 2026 las dos campañas llevaban días con código viejo
//   sin que nada avisara: les faltaban dos arreglos que fallan EN SILENCIO
//   —un mensaje de error que desaparecía y una campaña de avisos que no
//   llegaba a nadie—. Se descubrió comparando a mano, archivo por archivo.
//   Eso es justo lo que hace esto, en un comando.
//
//   «Parchear una instancia no parchea las demás, y nada avisa» está
//   documentado en CLAUDE.md desde antes. Esto lo convierte en una lista.
//
// Uso:
//   node scripts/comparar-instancias.js
//   node scripts/comparar-instancias.js /ruta/a/otra/instancia ...
//
// Sale con código 1 si hay deriva, para poder encadenarlo en un cron o antes
// de dar por buena una jornada de parches.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ORIGEN = path.join(__dirname, '..');

// Dónde viven las demás instancias si no se indican por argumento. No se
// descubren solas a propósito: una ruta equivocada daría un informe
// tranquilizador y falso.
const INSTANCIAS_POR_DEFECTO = [
  '/home/campanadepruebamunicipal/htdocs/campanadepruebamunicipal.appestrategia.net',
  '/home/campanadepruebadepartamental/htdocs/campanadepruebadepartamental.appestrategia.net',
];

// Qué se compara: el código que viaja en los parches. Se excluye lo que
// DEBE ser distinto en cada instancia (.env, licencia, subidas, respaldos).
const CARPETAS = ['routes', 'config', 'middleware', 'lib', 'db', 'scripts', 'public/js'];
const SUELTOS = ['app.js'];
const EXTENSIONES = ['.js', '.sql'];

function huella(archivo) {
  return crypto.createHash('sha256').update(fs.readFileSync(archivo)).digest('hex');
}

/** Todos los archivos comparables de una instalación, como rutas relativas. */
function inventario(raiz) {
  const encontrados = new Map();
  const recorrer = (rel) => {
    const abs = path.join(raiz, rel);
    let entradas;
    try {
      entradas = fs.readdirSync(abs, { withFileTypes: true });
    } catch (err) {
      return; // la carpeta no existe en esa instancia; se reporta como faltante
    }
    for (const e of entradas) {
      const hijo = path.join(rel, e.name);
      if (e.isDirectory()) recorrer(hijo);
      else if (EXTENSIONES.includes(path.extname(e.name))) {
        encontrados.set(hijo, huella(path.join(raiz, hijo)));
      }
    }
  };
  CARPETAS.forEach(recorrer);
  for (const s of SUELTOS) {
    const abs = path.join(raiz, s);
    if (fs.existsSync(abs)) encontrados.set(s, huella(abs));
  }
  return encontrados;
}

function versionParche(raiz) {
  try {
    return fs.readFileSync(path.join(raiz, '.version-parche'), 'utf8').trim();
  } catch (err) {
    return '(sin archivo)';
  }
}

function main() {
  const destinos = process.argv.slice(2).length ? process.argv.slice(2) : INSTANCIAS_POR_DEFECTO;
  const base = inventario(ORIGEN);

  console.log(`Origen: ${ORIGEN}  (parche ${versionParche(ORIGEN)}, ${base.size} archivos)\n`);

  let huboDeriva = false;

  for (const destino of destinos) {
    if (!fs.existsSync(destino)) {
      console.log(`${path.basename(destino)}: NO EXISTE la ruta ${destino}`);
      huboDeriva = true;
      continue;
    }
    const otro = inventario(destino);
    const faltan = [];
    const difieren = [];
    const sobran = [];

    for (const [rel, h] of base) {
      if (!otro.has(rel)) faltan.push(rel);
      else if (otro.get(rel) !== h) difieren.push(rel);
    }
    for (const rel of otro.keys()) if (!base.has(rel)) sobran.push(rel);

    const total = faltan.length + difieren.length + sobran.length;
    const etiqueta = path.basename(destino);
    if (total === 0) {
      console.log(`${etiqueta}: al día (parche ${versionParche(destino)}) — ${otro.size} archivos idénticos`);
      continue;
    }

    huboDeriva = true;
    console.log(`${etiqueta}: ${total} diferencia(s) (parche ${versionParche(destino)})`);
    difieren.forEach((f) => console.log(`   distinto: ${f}`));
    faltan.forEach((f) => console.log(`   le falta: ${f}`));
    sobran.forEach((f) => console.log(`   solo ahí: ${f}`));
    console.log('');
  }

  if (huboDeriva) {
    console.log('\nHay deriva. Si es código que debe viajar, empaquétalo:');
    console.log('  node scripts/generar-parche.js <numero> <archivos...>');
    process.exit(1);
  }
  console.log('\nTodas las instancias corren el mismo código.');
}

if (require.main === module) main();

module.exports = { inventario, versionParche };
