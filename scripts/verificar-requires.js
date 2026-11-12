#!/usr/bin/env node
/**
 * Comprueba, sobre el árbol «versión actual + parche», que todo `require()`
 * LOCAL resuelva Y que cada nombre importado exista de verdad en lo que ese
 * archivo exporta.
 *
 * POR QUÉ EXISTE. El 9 de agosto de 2026 el parche 15 tumbó las dos
 * campañas. Llevaba `app.js` (le había cambiado un comentario), y `app.js`
 * hace `require('./routes/push.routes')` — un archivo que se excluyó del
 * parche a propósito. Las dos arrancaron contra un módulo inexistente y PM2
 * las apagó. El actualizador reportó «aplicado correctamente» y los 15
 * archivos eran idénticos a electoral: **lo que falta no se ve comparando
 * lo que llegó**.
 *
 * Y EL 11 DE NOVIEMBRE DE 2026, LO MISMO UN NIVEL MÁS ADENTRO. El parche 329
 * trae `routes/checkinDiaD.routes.js`, que hace
 *     const { requiereEditarModulo } = require('../middleware/permisoModulo');
 * El archivo EXISTÍA, así que la comprobación de existencia pasó; pero en la
 * versión de las campañas (sin el 328) `permisoModulo.js` no exportaba esa
 * función, y `requiereEditarModulo(...)` explotó al cargar. Por eso ahora se
 * comprueba también cada nombre importado con llaves contra los exports del
 * archivo que se va a tener DESPUÉS de aplicar el parche.
 *
 * Uso:
 *   node scripts/verificar-requires.js parches/campana-parche16.zip \
 *        /home/campanadepruebamunicipal/htdocs/campanadepruebamunicipal.appestrategia.net
 *
 * Sin destino, comprueba contra el propio proyecto. El primer argumento puede
 * ser también una carpeta (se trata como «lo que entrega el parche»).
 *
 * QUÉ SE REVISA
 *   1. Todo `require('./…')` de los .js que trae el parche: que resuelva.
 *   2. Para los importadores que trae el parche —y también los que YA estaban
 *      en el destino pero apuntan a un archivo que el parche reemplaza—:
 *         const { a, b: c } = require('./x')     cada `a`, `b` debe estar en
 *         require('./x').a                       los exports de x
 *      Un parche que le quita un export a un archivo rompería a los que lo
 *      importan aunque ellos no viajen.
 *
 * ES ESTÁTICO A PROPÓSITO: no hace `require` de verdad. `db/init-db.js`
 * EJECUTA la migración al importarse, así que "comprobar si carga"
 * importándolo escribiría en la base de la campaña. (La comprobación de que
 * la app carga de verdad la hace el actualizador en la campaña, sin tocar
 * la base: ver `probarQueLaAppCarga` en scripts/actualizar-automatico.js.)
 *
 * LÍMITE: los exports se leen del texto. Cuando no se pueden saber (un
 * `...spread`, `module.exports = require(...)`, `Object.assign(module.exports,…)`)
 * el archivo se marca «abierto» y NO se acusa a nadie: más vale callar que
 * un falso positivo que se aprende a ignorar.
 *
 * Herramienta de desarrollo: NO incluirla en los parches.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const OMITIR_DIRECTORIOS = new Set([
  'node_modules', '.git', 'uploads', 'backups', 'parches', 'logs', 'legislacion', 'datos',
  'public', 'manuales', 'tmp', 'capturas', 'fixtures', 'sessions',
]);

/* ------------------------------------------------------------------ */
/* Texto sin comentarios                                               */
/* ------------------------------------------------------------------ */

/**
 * Quita los comentarios respetando cadenas, plantillas y expresiones
 * regulares: un `//` dentro de 'http://x' o de una regex no es un comentario.
 * Los comentarios se sustituyen por espacios (y se conservan los saltos de
 * línea) para no mover los números de línea.
 */
function sinComentarios(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let ultimo = '';            // último carácter significativo fuera de cadenas/comentarios
  let ultimaPalabra = '';
  const pilaPlantilla = [];   // profundidad de llaves de cada `${` abierto
  let llaves = 0;

  const REGEX_TRAS = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
  const PALABRAS_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do']);

  function copiarCadena(comilla) {
    const desde = out.length;
    out += comilla; i++;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { out += c + (src[i + 1] || ''); i += 2; continue; }
      out += c; i++;
      if (c === comilla || c === '\n') break;
    }
    // Un `require('./x')` CITADO dentro de una cadena (código en texto, como la prueba de
    // arranque del actualizador) no es una dependencia: se desactiva para no acusar al archivo.
    out = out.slice(0, desde) + out.slice(desde).replace(/\brequire\(/g, 'require_(');
  }
  function copiarPlantilla() {   // desde el ` de apertura; para en el ` de cierre o en un `${`
    out += '`'; i++;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { out += c + (src[i + 1] || ''); i += 2; continue; }
      if (c === '`') { out += c; i++; return; }
      if (c === '$' && src[i + 1] === '{') {
        out += '${'; i += 2;
        pilaPlantilla.push(llaves); llaves = 0;
        return;   // vuelve el bucle principal (código) hasta la } que cierra
      }
      out += c; i++;
    }
  }

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; }
      i += 2; out += ' ';
      continue;
    }
    if (c === '"' || c === "'") { copiarCadena(c); ultimo = c; continue; }
    if (c === '`') { copiarPlantilla(); ultimo = '`'; continue; }
    if (c === '/') {
      // ¿regex o división?
      if (REGEX_TRAS.has(ultimo) || PALABRAS_REGEX.has(ultimaPalabra)) {
        out += c; i++;
        let enClase = false;
        while (i < n) {
          const e = src[i];
          if (e === '\\') { out += e + (src[i + 1] || ''); i += 2; continue; }
          if (e === '\n') break;
          out += e; i++;
          if (e === '[') enClase = true;
          else if (e === ']') enClase = false;
          else if (e === '/' && !enClase) break;
        }
        ultimo = ')';
        ultimaPalabra = '';
        continue;
      }
    }
    if (c === '{') llaves++;
    if (c === '}') {
      if (llaves === 0 && pilaPlantilla.length) {
        // cierra un `${…}`: se sigue dentro de la plantilla
        llaves = pilaPlantilla.pop();
        out += c; i++;
        copiarPlantilla2();
        continue;
      }
      llaves--;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      ultimaPalabra = src.slice(i, j);
      out += ultimaPalabra; i = j; ultimo = 'a';
      continue;
    }
    if (!/\s/.test(c)) { ultimo = c; ultimaPalabra = ''; }
    out += c; i++;
  }
  return out;

  // Continúa el cuerpo de una plantilla tras el cierre de un `${…}`.
  function copiarPlantilla2() {
    while (i < n) {
      const c = src[i];
      if (c === '\\') { out += c + (src[i + 1] || ''); i += 2; continue; }
      if (c === '`') { out += c; i++; ultimo = '`'; return; }
      if (c === '$' && src[i + 1] === '{') {
        out += '${'; i += 2;
        pilaPlantilla.push(llaves); llaves = 0;
        return;
      }
      out += c; i++;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Imports y exports                                                   */
/* ------------------------------------------------------------------ */

/** Lo que un archivo importa de módulos locales: [{spec, nombres:[...], tipo}] */
function analizarImports(texto) {
  const salida = [];
  // const { a, b: c, d = 1 } = require('./x')   (sin `.algo` ni `(…)` detrás)
  const reDestructurado = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*(['"])(\.[^'"]*)\2\s*\)(?!\s*[.\[(])/gu;
  for (const m of texto.matchAll(reDestructurado)) {
    const nombres = [];
    for (const trozo of m[1].split(',')) {
      const t = trozo.trim();
      if (!t || t.startsWith('...')) continue;
      const k = /^(?:(['"])(.+?)\1|([\p{L}_$][\p{L}\p{N}_$]*))/u.exec(t);
      if (k) nombres.push(k[2] || k[3]);
    }
    salida.push({ spec: m[3], nombres, tipo: 'llaves' });
  }
  // require('./x').nombre
  const reMiembro = /\brequire\(\s*(['"])(\.[^'"]*)\1\s*\)\.([\p{L}_$][\p{L}\p{N}_$]*)/gu;
  for (const m of texto.matchAll(reMiembro)) salida.push({ spec: m[2], nombres: [m[3]], tipo: 'miembro' });
  // todo require local, con o sin nombres (para la comprobación de existencia)
  const reTodos = /\brequire\(\s*(['"])(\.[^'"]*)\1\s*\)/g;
  const specs = new Set();
  for (const m of texto.matchAll(reTodos)) specs.add(m[2]);
  return { importaciones: salida, specs: [...specs] };
}

/** Contenido entre la llave de apertura en `pos` y su pareja; null si no cuadra. */
function contenidoBalanceado(texto, pos) {
  let prof = 0;
  for (let i = pos; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < texto.length && texto[i] !== c; i++) if (texto[i] === '\\') i++;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') prof++;
    else if (c === '}' || c === ')' || c === ']') {
      prof--;
      if (prof === 0) return texto.slice(pos + 1, i);
    }
  }
  return null;
}

/** Parte por comas de nivel 0. */
function partirPorComas(cuerpo) {
  const trozos = [];
  let prof = 0; let ini = 0;
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < cuerpo.length && cuerpo[i] !== c; i++) if (cuerpo[i] === '\\') i++;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') prof++;
    else if (c === '}' || c === ')' || c === ']') prof--;
    else if (c === ',' && prof === 0) { trozos.push(cuerpo.slice(ini, i)); ini = i + 1; }
  }
  trozos.push(cuerpo.slice(ini));
  return trozos.map((t) => t.trim()).filter(Boolean);
}

const ID = '[\\p{L}_$][\\p{L}\\p{N}_$]*';   // identificador (con letras acentuadas: los hay en este proyecto)

/** Claves de un objeto literal. `abierto` si no se puede saber alguna. */
function clavesDeObjetoLiteral(cuerpo, nombres, estado) {
  for (const item of partirPorComas(cuerpo)) {
    if (item.startsWith('...') || item.startsWith('[')) { estado.abierto = true; continue; }
    let m = new RegExp(`^(?:async\\s+)?(?:get\\s+|set\\s+)?\\*?\\s*(${ID})\\s*\\(`, 'u').exec(item);   // método
    if (m) { nombres.add(m[1]); continue; }
    m = /^(['"])(.+?)\1\s*:/.exec(item);                                                              // 'clave': valor
    if (m) { nombres.add(m[2]); continue; }
    m = new RegExp(`^(${ID})\\s*(?::|$)`, 'u').exec(item);                                            // a   |   a: valor
    if (m) { nombres.add(m[1]); continue; }
    estado.abierto = true;   // algo que no se sabe leer
  }
}

/** Nombres que aporta un identificador exportado (`module.exports = api`). */
function nombresDeIdentificador(texto, nombre, nombres, estado) {
  const esc = nombre.replace(/[$]/g, '\\$&');
  const def = new RegExp(`\\b(?:const|let|var)\\s+${esc}\\s*=\\s*`, 'u').exec(texto);
  if (def) {
    const resto = texto.slice(def.index + def[0].length);
    if (resto.startsWith('{')) {
      const cuerpo = contenidoBalanceado(texto, def.index + def[0].length);
      if (cuerpo === null) estado.abierto = true; else clavesDeObjetoLiteral(cuerpo, nombres, estado);
    } else if (!/^(?:express\.)?Router\s*\(|^require\(\s*['"]express['"]\s*\)\.Router\s*\(|^(?:async\s+)?function\b|^(?:async\s*)?\([^)]*\)\s*=>|^(?:async\s+)?[\p{L}_$][\p{L}\p{N}_$]*\s*=>/u.test(resto)) {
      estado.abierto = true;   // `= algo(...)`: no se sabe qué devuelve
    }
  } else if (!new RegExp(`\\b(?:async\\s+)?function\\s*\\*?\\s*${esc}\\b|\\bclass\\s+${esc}\\b`, 'u').test(texto)) {
    estado.abierto = true;     // ni literal, ni función, ni clase: viene de otro sitio
  }
  // y las propiedades que se le cuelgan:  nombre.algo = …
  for (const p of texto.matchAll(new RegExp(`\\b${esc}\\.(${ID})\\s*=[^=]`, 'gu'))) nombres.add(p[1]);
}

/** Qué exporta un archivo: {abierto, nombres:Set}. */
function analizarExports(texto) {
  const nombres = new Set();
  const estado = { abierto: false };

  if (/^\s*export\s+(?:default|const|function|class|\{)/m.test(texto)) estado.abierto = true;   // ESM
  if (/Object\.assign\(\s*(?:module\.)?exports\b/.test(texto)) estado.abierto = true;
  // `module.exports` usado como VALOR (registrar(module.exports), foo(module.exports)): alguien le agrega nombres después
  if (/\bmodule\.exports\b(?!\s*(?:=(?!=)|\.|\[))/.test(texto)) estado.abierto = true;

  // exports.a = …  |  module.exports.a = …  |  module.exports['a'] = …
  for (const m of texto.matchAll(new RegExp(`\\b(?:module\\.)?exports\\s*(?:\\.(${ID})|\\[\\s*(['"])(.+?)\\2\\s*\\])\\s*=[^=]`, 'gu'))) {
    nombres.add(m[1] || m[3]);
  }
  for (const m of texto.matchAll(/Object\.defineProperty\(\s*(?:module\.)?exports\s*,\s*(['"])(.+?)\1/g)) nombres.add(m[2]);

  // module.exports = <algo>
  for (const m of texto.matchAll(/\bmodule\.exports\s*=\s*(?!=)/g)) {
    const pos = m.index + m[0].length;
    const resto = texto.slice(pos);
    if (resto.startsWith('{')) {
      const cuerpo = contenidoBalanceado(texto, pos);
      if (cuerpo === null) estado.abierto = true; else clavesDeObjetoLiteral(cuerpo, nombres, estado);
      continue;
    }
    const asignar = /^Object\.assign\s*\(/.exec(resto);
    if (asignar) {   // Object.assign(api, { a, b })
      const cuerpo = contenidoBalanceado(texto, pos + asignar[0].length - 1);
      if (cuerpo === null) { estado.abierto = true; continue; }
      for (const arg of partirPorComas(cuerpo)) {
        if (arg.startsWith('{')) { const c = contenidoBalanceado(arg, 0); if (c === null) estado.abierto = true; else clavesDeObjetoLiteral(c, nombres, estado); }
        else if (new RegExp(`^${ID}$`, 'u').test(arg)) nombresDeIdentificador(texto, arg, nombres, estado);
        else estado.abierto = true;
      }
      continue;
    }
    const id = new RegExp(`^(${ID})\\s*(?:;|\\n|$)`, 'u').exec(resto);
    if (id && !['function', 'async', 'class', 'require'].includes(id[1])) {
      nombresDeIdentificador(texto, id[1], nombres, estado);
      continue;
    }
    if (/^(?:async\s+)?function\b|^class\b|^(?:async\s*)?\([^)]*\)\s*=>|^(?:async\s+)?[\p{L}_$][\p{L}\p{N}_$]*\s*=>/u.test(resto)) continue;   // función o clase: sin nombres propios
    estado.abierto = true;   // require(...), llamada, condicional…: no se sabe
  }
  return { abierto: estado.abierto, nombres };
}

/* ------------------------------------------------------------------ */
/* Árbol «destino + parche»                                            */
/* ------------------------------------------------------------------ */

function listarArchivos(raiz, soloJs, omitir = true) {
  const salida = [];
  (function recorrer(dir) {
    let entradas;
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entradas) {
      // node_modules y .git no se miran nunca, a ninguna profundidad; las demás carpetas
      // (public, uploads…) solo se omiten al recorrer una INSTALACIÓN, y solo en la raíz.
      if (e.isDirectory() && (e.name === 'node_modules' || e.name === '.git')) continue;
      if (omitir && dir === raiz && OMITIR_DIRECTORIOS.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (!soloJs || e.name.endsWith('.js')) salida.push(path.relative(raiz, p));
    }
  })(raiz);
  return salida;
}

/**
 * @param {string} origen   zip del parche o carpeta con lo que entrega
 * @param {string} destino  carpeta con la versión sobre la que se aplica
 * @returns {{revisados:number, rotos:string[], avisos:string[]}}
 */
function verificar(origen, destino) {
  let carpetaZip = null;
  let limpiar = null;
  if (origen.endsWith('.zip')) {
    carpetaZip = fs.mkdtempSync(path.join(os.tmpdir(), 'verificar-requires-'));
    limpiar = () => fs.rmSync(carpetaZip, { recursive: true, force: true });
    execFileSync('unzip', ['-q', '-o', origen, '-d', carpetaZip]);
  } else {
    carpetaZip = origen;
  }
  try {
    const entrega = new Set(listarArchivos(carpetaZip, false, false));
    const ruta = (rel) => (entrega.has(rel) ? path.join(carpetaZip, rel) : path.join(destino, rel));
    const existe = (rel) => entrega.has(rel) || fs.existsSync(path.join(destino, rel));

    const resolver = (desdeRel, spec) => {
      const rel = path.normalize(path.join(path.dirname(desdeRel), spec));
      for (const cand of [rel, `${rel}.js`, `${rel}.json`, path.join(rel, 'index.js')]) {
        if (existe(cand) && !(fs.existsSync(ruta(cand)) && fs.statSync(ruta(cand)).isDirectory())) return cand;
      }
      return null;
    };

    const cacheExports = new Map();
    const exportsDe = (rel) => {
      if (!cacheExports.has(rel)) cacheExports.set(rel, analizarExports(sinComentarios(fs.readFileSync(ruta(rel), 'utf8'))));
      return cacheExports.get(rel);
    };

    // Importadores: todo .js del árbol resultante.
    const todosJs = new Set([...entrega].filter((f) => f.endsWith('.js')));
    for (const f of listarArchivos(destino, true)) todosJs.add(f);

    let revisados = 0;
    const rotos = [];
    const avisos = [];
    for (const rel of [...todosJs].sort()) {
      const llega = entrega.has(rel);
      let texto;
      try { texto = sinComentarios(fs.readFileSync(ruta(rel), 'utf8')); } catch (e) { continue; }
      const { importaciones, specs } = analizarImports(texto);

      for (const spec of specs) {
        const objetivo = resolver(rel, spec);
        if (llega) {
          revisados++;
          if (!objetivo) rotos.push(`  FALTA  ${rel}  ->  require('${spec}')`);
        }
      }
      for (const imp of importaciones) {
        const objetivo = resolver(rel, imp.spec);
        if (!objetivo || !objetivo.endsWith('.js')) continue;
        // Los de fuera del parche solo importan si el archivo al que apuntan SÍ cambia con él.
        if (!llega && !entrega.has(objetivo)) continue;
        const ex = exportsDe(objetivo);
        for (const nombre of imp.nombres) {
          if (ex.nombres.has(nombre)) continue;
          if (ex.abierto) { avisos.push(`  ?  ${rel}: no se puede saber si ${objetivo} exporta «${nombre}» (exports no analizables)`); continue; }
          const forma = imp.tipo === 'llaves' ? `const { ${nombre} } = require('${imp.spec}')` : `require('${imp.spec}').${nombre}`;
          rotos.push(`  NO EXPORTA  ${rel}  ->  ${forma}   (${objetivo} no exporta «${nombre}»${llega ? '' : '; este importador NO viaja en el parche'})`);
        }
      }
    }
    return { revisados, rotos: [...new Set(rotos)], avisos: [...new Set(avisos)] };
  } finally {
    if (limpiar) limpiar();
  }
}

/* ------------------------------------------------------------------ */

if (require.main === module) {
  const [origen, destinoArg] = process.argv.slice(2);
  if (!origen) {
    console.error('Uso: node scripts/verificar-requires.js <parche.zip|carpeta> [ruta-instalacion]');
    process.exit(2);
  }
  const destino = destinoArg || path.join(__dirname, '..');
  const { revisados, rotos, avisos } = verificar(origen, destino);
  avisos.forEach((a) => console.log(a));
  rotos.forEach((r) => console.log(r));
  console.log(`\n${revisados} require(s) local(es) revisado(s) contra ${destino}`);
  console.log(rotos.length === 0 ? 'TODO RESUELVE' : `${rotos.length} SIN RESOLVER — el parche dejaría la app sin arrancar`);
  process.exit(rotos.length === 0 ? 0 : 1);
}

module.exports = { verificar, sinComentarios, analizarImports, analizarExports };
