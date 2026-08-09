#!/usr/bin/env node
/**
 * Comprueba que todo `require()` LOCAL de los archivos de un parche exista
 * en la instalación de destino.
 *
 * POR QUÉ EXISTE. El 9 de agosto de 2026 el parche 15 tumbó las dos
 * campañas. Llevaba `app.js` (le había cambiado un comentario), y `app.js`
 * hace `require('./routes/push.routes')` — un archivo que se excluyó del
 * parche a propósito. Las dos arrancaron contra un módulo inexistente y PM2
 * las apagó. El actualizador reportó «aplicado correctamente» y los 15
 * archivos eran idénticos a electoral: **lo que falta no se ve comparando
 * lo que llegó**.
 *
 * Uso:
 *   node scripts/verificar-requires.js parches/campana-parche16.zip \
 *        /home/campanadepruebamunicipal/htdocs/campanadepruebamunicipal.appestrategia.net
 *
 * Sin destino, comprueba contra el propio proyecto (útil para detectar un
 * require roto antes de generar nada).
 *
 * ES ESTÁTICO A PROPÓSITO: no hace `require` de verdad. `db/init-db.js`
 * EJECUTA la migración al importarse, así que "comprobar si carga"
 * importándolo escribiría en la base de la campaña.
 *
 * Herramienta de desarrollo: NO incluirla en los parches.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROYECTO = path.join(__dirname, '..');
const [origen, destinoArg] = process.argv.slice(2);

if (!origen) {
  console.error('Uso: node scripts/verificar-requires.js <parche.zip|carpeta> [ruta-instalacion]');
  process.exit(2);
}
const destino = destinoArg || PROYECTO;

/** Lista los .js que trae el parche (o la carpeta). */
function archivosDelParche(origen) {
  if (origen.endsWith('.zip')) {
    return execFileSync('unzip', ['-Z1', origen], { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(f => f.endsWith('.js'));
  }
  const salida = [];
  (function recorrer(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'uploads', 'backups', 'parches'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (e.name.endsWith('.js')) salida.push(path.relative(origen, p));
    }
  })(origen);
  return salida;
}

/**
 * ¿Resuelve este especificador desde este archivo?
 *
 * Vale si el destino YA lo tiene **o si el propio parche se lo lleva**: lo
 * que importa es cómo queda la instalación DESPUÉS de aplicarlo. Sin esta
 * segunda parte, todo archivo nuevo del parche saldría como si faltara y
 * el aviso se volvería ruido que se aprende a ignorar — que es la forma
 * más segura de que la próxima vez el fallo real pase desapercibido.
 */
function resuelve(desdeRel, especificador, entregaElParche) {
  const rel = path.normalize(path.join(path.dirname(desdeRel), especificador));
  for (const cand of [rel, `${rel}.js`, `${rel}.json`, path.join(rel, 'index.js')]) {
    if (entregaElParche.has(cand)) return true;
    if (fs.existsSync(path.join(destino, cand))) return true;
  }
  return false;
}

// Todo lo que el parche entrega (no solo los .js): un require puede
// apuntar a un .json que el parche también lleva.
const entregaElParche = new Set(
  origen.endsWith('.zip')
    ? execFileSync('unzip', ['-Z1', origen], { encoding: 'utf8' }).split('\n').map(s => s.trim()).filter(Boolean)
    : []
);

let revisados = 0, rotos = 0;
for (const rel of archivosDelParche(origen)) {
  // El contenido se lee del PROYECTO (es la versión que va a viajar);
  // la existencia se comprueba en el DESTINO.
  const fuente = path.join(PROYECTO, rel);
  if (!fs.existsSync(fuente)) { console.log(`  ? ${rel} no está en el proyecto`); continue; }
  // Se quitan los comentarios antes de buscar: si no, un require citado
  // dentro de una explicación cuenta como dependencia real. Pasó con este
  // mismo archivo, que menciona require('./routes/push.routes') en su
  // cabecera para contar por qué existe, y se acusaba a sí mismo.
  const texto = fs.readFileSync(fuente, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const m of texto.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    revisados++;
    if (!resuelve(rel, m[1], entregaElParche)) {
      console.log(`  FALTA  ${rel}  ->  require('${m[1]}')`);
      rotos++;
    }
  }
}

console.log(`\n${revisados} require(s) local(es) revisado(s) contra ${destino}`);
console.log(rotos === 0 ? 'TODO RESUELVE' : `${rotos} SIN RESOLVER — el parche dejaría la app sin arrancar`);
process.exit(rotos === 0 ? 0 : 1);
