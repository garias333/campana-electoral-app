#!/usr/bin/env node
/**
 * Prueba de la Orden 46: «que ninguna campaña aplique un parche si le falta el que requiere».
 *
 *   node scripts/probar-requisitos-parches.js
 *
 * No toca ninguna instalación real ni ninguna base: trabaja sobre COPIAS del código en
 * una carpeta temporal (con un .env de mentira que apunta a un puerto cerrado) y el
 * reinicio de PM2 se reemplaza por un contador. Sí corre el `node -e "require('./app')"`
 * de verdad (sin abrir el puerto): es lo que se quiere probar.
 *
 * Qué comprueba:
 *   1. campaña en 327 con el 329 de formato nuevo: se niega y no toca nada
 *   2. campaña en 332 con un 333 que requiere 332: aplica, reinicia, anota el 333
 *   3. zip viejo (sin .parche-requiere) con número no consecutivo: se niega; el consecutivo, aplica
 *   4. parche que rompe app.js a propósito (y otro que importa un nombre que no existe, como el
 *      329): se restaura todo, no se reinicia, no se anota
 *   5. verificar-requires.js detecta el caso del 329 y no acusa a lo que sí exporta
 *   6. generar-parche.js: sin requisito se niega; con requisito lo mete en el zip; si
 *      «base anterior + zip» falla, no genera nada y deja .version-base como estaba
 *   7. registrar-parche.js manda el requisito leído del zip
 *   8. la lista .parches-aplicados: siembra, compactar/descompactar, reglas puras
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');

const PROYECTO = path.join(__dirname, '..');
const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'probar-requisitos-'));
let fallos = 0;
let total = 0;

function ok(condicion, mensaje, detalle) {
  total++;
  if (condicion) { console.log('  ✓ ' + mensaje); return; }
  fallos++;
  console.log('  ✗ ' + mensaje);
  if (detalle !== undefined) console.log('      ' + (typeof detalle === 'string' ? detalle : JSON.stringify(detalle)).split('\n').join('\n      '));
}
function titulo(t) { console.log('\n' + t); }

/* ---------------- ayudas ---------------- */

const NO_COPIAR = /^(parches|legislacion|backups|datos|logs|uploads|manuales|node_modules|\.git)\//;

/** Copia del código actual (lo que git ve) en una carpeta nueva, con un .env de mentira. */
function clonarCampana(nombre, version) {
  const destino = path.join(RAIZ, nombre);
  fs.mkdirSync(destino, { recursive: true });
  const lista = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: PROYECTO, encoding: 'utf8' })
    .split('\n').filter((f) => f && !NO_COPIAR.test(f) && fs.existsSync(path.join(PROYECTO, f)));
  const listaTxt = path.join(RAIZ, `${nombre}.lista`);
  fs.writeFileSync(listaTxt, lista.join('\n') + '\n');
  execFileSync('sh', ['-c', `tar -c -C '${PROYECTO}' -T '${listaTxt}' | tar -x -C '${destino}'`]);
  fs.symlinkSync(path.join(PROYECTO, 'node_modules'), path.join(destino, 'node_modules'));
  fs.writeFileSync(path.join(destino, '.env'), [
    'NODE_ENV=production', 'PORT=39998', 'DB_HOST=127.0.0.1', 'DB_PORT=1', 'DB_USER=x', 'DB_PASSWORD=x', 'DB_NAME=x',
    'SESSION_SECRET=x', 'LICENCIA_SERVIDOR_URL=http://127.0.0.1:1', 'LICENCIA_API_SECRET=x', 'LICENCIA_DOMINIO=prueba.local', '',
  ].join('\n'));
  fs.writeFileSync(path.join(destino, '.version-parche'), String(version));
  return destino;
}

/** Huella de todo el árbol (sin node_modules, .env, los zip ni la lista de aplicados). */
function huella(dir) {
  const h = crypto.createHash('sha1');
  (function recorrer(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === 'node_modules' && d === dir) continue;
      if (d === dir && (e.name === '.env' || e.name === '.parches-aplicados' || /^campana-parche\d+\.zip$/.test(e.name))) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (e.isFile()) h.update(path.relative(dir, p) + '\0' + fs.readFileSync(p).toString('latin1') + '\0');
    }
  })(dir);
  return h.digest('hex');
}

/** Arma un zip de parche a partir de {ruta: contenido|Buffer} y, si se pide, `.parche-requiere`. */
function armarZip(destinoZip, archivos, requiere) {
  const stage = fs.mkdtempSync(path.join(RAIZ, 'stage-'));
  const todos = { ...archivos };
  if (requiere !== null && requiere !== undefined) todos['.parche-requiere'] = String(requiere) + '\n';
  for (const [rel, contenido] of Object.entries(todos)) {
    const p = path.join(stage, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, contenido);
  }
  fs.rmSync(destinoZip, { force: true });
  execFileSync('zip', ['-q', '-X', '-r', destinoZip, '.'], { cwd: stage });
  fs.rmSync(stage, { recursive: true, force: true });
}

function intentar(fn) { try { fn(); return null; } catch (e) { return e; } }

/* ---------------- las pruebas ---------------- */

async function main() {
  // El actualizador lee su .env al cargarse: se carga con el de mentira de una copia, no con el real.
  process.chdir(RAIZ);
  const { instalarZip } = require(path.join(PROYECTO, 'scripts', 'actualizar-automatico.js'));
  const P = require(path.join(PROYECTO, 'config', 'parchesAplicados.js'));
  const verificarRequires = require(path.join(PROYECTO, 'scripts', 'verificar-requires.js'));

  /* ===== 8. la lista y las reglas puras ===== */
  titulo('8. Lista de parches aplicados y reglas');
  {
    ok(P.compactar(new Set([1, 2, 3, 5, 6, 9])) === '1-3,5-6,9', 'compactar agrupa rangos', P.compactar(new Set([1, 2, 3, 5, 6, 9])));
    ok(P.compactar(P.descompactar('1-332,335')) === '1-332,335', 'descompactar y compactar son inversas');
    ok(P.descompactar('1-x') === null && P.descompactar('') === null && P.descompactar('5-3') === null, 'una lista inválida no se adivina (null)');
    ok(P.decidirAplicacion({ numero: 333, requisito: 332, aplicados: new Set([332]), versionActual: 332 }).ok, 'requisito presente: aplica');
    const d = P.decidirAplicacion({ numero: 329, requisito: 328, aplicados: new Set([327]), versionActual: 327 });
    ok(!d.ok && d.motivo === 'fallido: requiere el 328, que no está aplicado', 'requisito ausente: «fallido: requiere el 328, que no está aplicado»', d);
    ok(P.decidirAplicacion({ numero: 333, requisito: null, aplicados: new Set(), versionActual: 332 }).ok, 'sin requisito y número = versión + 1: aplica');
    ok(!P.decidirAplicacion({ numero: 334, requisito: null, aplicados: new Set(), versionActual: 332 }).ok, 'sin requisito y número no consecutivo: no aplica');
    ok(!P.decidirAplicacion({ numero: 332, requisito: null, aplicados: new Set(), versionActual: 332 }).ok, 'sin requisito y número repetido: no aplica');

    const dir = fs.mkdtempSync(path.join(RAIZ, 'lista-'));
    const sembrado = P.leerAplicados(dir, 5);
    ok(sembrado.size === 5 && fs.readFileSync(path.join(dir, '.parches-aplicados'), 'utf8') === '1\n2\n3\n4\n5\n', 'sin .parches-aplicados se siembra con 1..versión actual y se escribe');
    fs.writeFileSync(path.join(dir, '.parches-aplicados'), '1\n2\n# comentario\n\nbasura\n7\n');
    ok(P.compactar(P.leerAplicados(dir, 99)) === '1-2,7', 'con el archivo puesto manda el archivo (ignora comentarios y basura)');
    ok(P.leerAplicados(fs.mkdtempSync(path.join(RAIZ, 'vacia-')), 0).size === 0, 'versión 0: lista vacía y no escribe nada');
  }

  /* ===== 1. campaña en 327 + 329 de formato nuevo ===== */
  titulo('1. Campaña en 327 con el 329 de formato nuevo (requiere el 328)');
  {
    const campana = clonarCampana('c327', 327);
    const antes = huella(campana);
    armarZip(path.join(campana, 'campana-parche329.zip'), {
      'routes/checkinDiaD.routes.js': fs.readFileSync(path.join(PROYECTO, 'routes/checkinDiaD.routes.js')),
      'marca-del-329.txt': 'si esto aparece, se descomprimió\n',
    }, 328);
    let reinicios = 0;
    const err = intentar(() => instalarZip({ numero_parche: 329 }, 'campana-parche329.zip', { carpeta: campana, reiniciar: () => { reinicios++; } }));
    ok(err && err.message === 'fallido: requiere el 328, que no está aplicado', 'se niega con «fallido: requiere el 328, que no está aplicado»', err && err.message);
    ok(huella(campana) === antes, 'no tocó ningún archivo');
    ok(!fs.existsSync(path.join(campana, 'marca-del-329.txt')), 'no descomprimió nada');
    ok(reinicios === 0, 'no reinició');
    ok(fs.readFileSync(path.join(campana, '.version-parche'), 'utf8').trim() === '327', '.version-parche sigue en 327');
    ok(!P.leerAplicados(campana, 327).has(329), '.parches-aplicados no anota el 329');
  }

  /* ===== 2 y 3 y 4. campaña en 332 ===== */
  titulo('2. Campaña en 332 con un 333 que requiere el 332');
  const campana332 = clonarCampana('c332', 332);
  {
    const campana = campana332;
    const readmeAntes = fs.readFileSync(path.join(campana, 'README.md'), 'utf8');
    armarZip(path.join(campana, 'campana-parche333.zip'), {
      'README.md': readmeAntes + '\n<!-- prueba 333 -->\n',
      'lib/nuevo-del-333.js': "module.exports = { hola: () => 'hola' };\n",
    }, 332);
    let reinicios = 0;
    const err = intentar(() => instalarZip({ numero_parche: 333 }, 'campana-parche333.zip', { carpeta: campana, reiniciar: () => { reinicios++; } }));
    ok(!err, 'aplica sin error', err && err.message);
    ok(fs.readFileSync(path.join(campana, 'README.md'), 'utf8').includes('prueba 333') && fs.existsSync(path.join(campana, 'lib/nuevo-del-333.js')), 'descomprimió los archivos');
    ok(reinicios === 1, 'reinició una vez');
    ok(fs.readFileSync(path.join(campana, '.version-parche'), 'utf8').trim() === '333', '.version-parche pasó a 333');
    const lista = P.compactar(P.leerAplicados(campana, 333));
    ok(lista === '1-333', '.parches-aplicados quedó «1-333» (sembrado 1..332 + el 333)', lista);
    ok(!fs.existsSync(path.join(campana, '.parche-requiere')), 'el .parche-requiere del zip no se queda suelto en la carpeta de la app');
    ok(!fs.existsSync(path.join(campana, 'campana-parche333.zip')), 'el zip se borra al terminar');
    ok(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('parche-333-previo-')).length === 0, 'la carpeta temporal de respaldo se descartó');
  }

  titulo('3. Zip viejo (sin .parche-requiere)');
  {
    const campana = clonarCampana('c332b', 332);
    const antes = huella(campana);
    armarZip(path.join(campana, 'campana-parche335.zip'), { 'marca-del-335.txt': 'x\n' }, null);
    let reinicios = 0;
    let err = intentar(() => instalarZip({ numero_parche: 335 }, 'campana-parche335.zip', { carpeta: campana, reiniciar: () => { reinicios++; } }));
    ok(err && /no declara qué parche requiere/.test(err.message) && /^fallido:/.test(err.message), 'número no consecutivo (335 sobre 332): se niega', err && err.message);
    ok(huella(campana) === antes && reinicios === 0 && !fs.existsSync(path.join(campana, 'marca-del-335.txt')), 'no tocó nada ni reinició');
    armarZip(path.join(campana, 'campana-parche333.zip'), { 'marca-del-333.txt': 'x\n' }, null);
    err = intentar(() => instalarZip({ numero_parche: 333 }, 'campana-parche333.zip', { carpeta: campana, reiniciar: () => { reinicios++; } }));
    ok(!err && reinicios === 1 && fs.existsSync(path.join(campana, 'marca-del-333.txt')), 'el consecutivo (333 sobre 332) sí se aplica', err && err.message);
  }

  titulo('4. Parche que rompe la app: se restaura y no se reinicia');
  {
    for (const caso of [
      {
        nombre: 'app.js importa un módulo que no existe',
        archivos: () => ({
          'app.js': "require('./modulo-que-no-existe-46');\n" + fs.readFileSync(path.join(PROYECTO, 'app.js'), 'utf8'),
          'lib/nuevo-que-no-debe-quedar.js': 'module.exports = 1;\n',
        }),
        rota: 'app.js',
      },
      {
        // El caso del 329: el archivo existe, pero el nombre importado no.
        nombre: 'una ruta importa un nombre que el middleware no exporta (el caso del 329)',
        archivos: () => ({
          'routes/checkinDiaD.routes.js': fs.readFileSync(path.join(PROYECTO, 'routes/checkinDiaD.routes.js'), 'utf8') +
            "\nconst { requiereAlgoQueNoExiste } = require('../middleware/permisoModulo');\nrequiereAlgoQueNoExiste('x');\n",
          'lib/nuevo-que-no-debe-quedar.js': 'module.exports = 1;\n',
        }),
        rota: 'routes/checkinDiaD.routes.js',
      },
    ]) {
      const campana = clonarCampana('rota', 332);
      const antes = huella(campana);
      armarZip(path.join(campana, 'campana-parche333.zip'), caso.archivos(), 332);
      let reinicios = 0;
      const err = intentar(() => instalarZip({ numero_parche: 333 }, 'campana-parche333.zip', { carpeta: campana, reiniciar: () => { reinicios++; } }));
      console.log('  — ' + caso.nombre);
      ok(err && /^fallido: la app no arrancaría/.test(err.message), '«fallido: la app no arrancaría…»', err && err.message);
      ok(huella(campana) === antes, 'restauró todos los archivos (la huella del árbol es la de antes)');
      ok(!fs.existsSync(path.join(campana, 'lib/nuevo-que-no-debe-quedar.js')), 'quitó el archivo nuevo que había traído');
      ok(reinicios === 0, 'no reinició');
      ok(fs.readFileSync(path.join(campana, '.version-parche'), 'utf8').trim() === '332' && !P.leerAplicados(campana, 332).has(333), 'ni .version-parche ni .parches-aplicados avanzaron');
      fs.rmSync(campana, { recursive: true, force: true });
    }

    // init-db que falla: también se restaura
    const campana = clonarCampana('initdb', 332);
    const antes = huella(campana);
    armarZip(path.join(campana, 'campana-parche333.zip'), { 'marca-initdb.txt': 'x\n' }, 332);
    let reinicios = 0;
    const err = intentar(() => instalarZip({ numero_parche: 333, toca_base_datos: true }, 'campana-parche333.zip', {
      carpeta: campana, reiniciar: () => { reinicios++; }, initDb: () => { throw new Error('boom'); },
    }));
    console.log('  — init-db falla');
    ok(err && /^fallido: init-db falló/.test(err.message) && reinicios === 0 && huella(campana) === antes, 'se restaura, no reinicia y reporta «fallido: init-db falló»', err && err.message);
  }

  /* ===== 5. verificar-requires ===== */
  titulo('5. verificar-requires.js: nombres importados que no existen');
  {
    const base = path.join(RAIZ, 'vr-base');
    fs.mkdirSync(path.join(base, 'middleware'), { recursive: true });
    fs.mkdirSync(path.join(base, 'routes'), { recursive: true });
    fs.writeFileSync(path.join(base, 'middleware/permiso.js'), "function a() {}\nfunction b() {}\nmodule.exports = { requiereModulo: a, requiereRol: b };\n");
    fs.writeFileSync(path.join(base, 'routes/vieja.js'), "const { requiereModulo } = require('../middleware/permiso');\nmodule.exports = requiereModulo;\n");
    const zip = path.join(RAIZ, 'vr.zip');
    armarZip(zip, {
      'routes/nueva.js': "const { requiereModulo, requiereEditarModulo } = require('../middleware/permiso');\nrequiereEditarModulo('x');\n",
    }, null);
    let r = verificarRequires.verificar(zip, base);
    ok(r.rotos.length === 1 && /requiereEditarModulo/.test(r.rotos[0]) && /no exporta/.test(r.rotos[0]), 'detecta el caso del 329 (nombre importado que no existe)', r.rotos);

    armarZip(zip, {
      'middleware/permiso.js': "module.exports = { requiereRol: () => {} };\n",   // el parche le QUITA un export a un archivo que otros importan
    }, null);
    r = verificarRequires.verificar(zip, base);
    ok(r.rotos.length === 1 && /routes\/vieja\.js/.test(r.rotos[0]) && /NO viaja/.test(r.rotos[0]), 'detecta al importador que no viaja cuando el parche le quita un export', r.rotos);

    armarZip(zip, {
      'middleware/permiso.js': "module.exports = { requiereModulo: () => {}, requiereRol: () => {}, requiereEditarModulo: () => {} };\n",
      'routes/nueva.js': "const { requiereModulo, requiereEditarModulo } = require('../middleware/permiso');\n// const { fantasma } = require('../middleware/permiso')\nrequiereEditarModulo('x');\n",
    }, null);
    r = verificarRequires.verificar(zip, base);
    ok(r.rotos.length === 0, 'lo que sí exporta (y los nombres citados en comentarios) no se acusa', r.rotos);

    const sinArchivo = path.join(RAIZ, 'vr2.zip');
    armarZip(sinArchivo, { 'routes/otra.js': "require('./no-existe');\n" }, null);
    r = verificarRequires.verificar(sinArchivo, base);
    ok(r.rotos.length === 1 && /FALTA/.test(r.rotos[0]), 'sigue detectando el require de un archivo que no existe');

    // exports en todas sus formas
    const E = (src) => verificarRequires.analizarExports(verificarRequires.sinComentarios(src));
    let e = E("module.exports = { a, b: 1, 'c': 2, d() {}, async e() {}, get f() { return 1; }, g: function () { return { x: 1, y: 2 }; } };");
    ok(['a', 'b', 'c', 'd', 'e', 'f', 'g'].every((n) => e.nombres.has(n)) && !e.nombres.has('x') && !e.abierto, 'objeto literal: shorthand, clave, comillas, métodos, getters, valores anidados');
    e = E("exports.a = 1;\nmodule.exports.b = 2;\nmodule.exports['c'] = 3;");
    ok(['a', 'b', 'c'].every((n) => e.nombres.has(n)), 'exports.x / module.exports.x / module.exports[\'x\']');
    e = E("const api = { uno() {} };\nmodule.exports = Object.assign(api, { dos, tres: 3 });");
    ok(['uno', 'dos', 'tres'].every((n) => e.nombres.has(n)) && !e.abierto, 'Object.assign(api, {…})');
    e = E("module.exports = { a, ...otros };");
    ok(e.abierto, 'un ...spread deja el archivo «abierto» (no se acusa a nadie)');
    e = E("const R = {};\nmodule.exports = R;\nrequire('./x').registrar(module.exports);");
    ok(e.abierto, 'module.exports pasado como valor: «abierto»');
    e = E("const router = require('express').Router();\nmodule.exports = router;");
    ok(!e.abierto && e.nombres.size === 0, 'un router no exporta nombres (y se sabe)');
    e = E("const s = 'http://x.com/a'; const re = /\\/\\/ no-comentario/; module.exports = { ok: s, re };\n// module.exports = { fantasma };");
    ok(e.nombres.has('ok') && !e.nombres.has('fantasma'), 'cadenas con // y regex no se confunden con comentarios');
  }

  /* ===== 6. generar-parche.js ===== */
  titulo('6. generar-parche.js');
  {
    const campana = clonarCampana('gen', 332);
    const base = clonarCampana('gen-base', 332);
    fs.writeFileSync(path.join(campana, 'lib/prueba-orden46.js'), "module.exports = { vale: true };\n");
    const correr = (...args) => spawnSync(process.execPath, [path.join(campana, 'scripts/generar-parche.js'), ...args], { cwd: campana, encoding: 'utf8' });
    const versionBase = () => fs.readFileSync(path.join(campana, '.version-base'), 'utf8').trim();
    const baseAntes = versionBase();
    const zipDe = (n) => path.join(campana, 'parches', `campana-parche${n}.zip`);

    let r = correr('333', '--base', base, 'lib/prueba-orden46.js');
    ok(r.status === 1 && /--requiere/.test(r.stderr) && !fs.existsSync(zipDe(333)), 'sin requisito se niega y no genera nada', r.stderr);

    r = correr('333', '--requiere', '332', '--titulo', 'Algo (Requiere el 331)', '--base', base, 'lib/prueba-orden46.js');
    ok(r.status === 0 && fs.existsSync(zipDe(333)), 'con --requiere genera el zip', r.stderr + r.stdout);
    ok(/AVISO: el título dice «Requiere el 331» pero --requiere es 332/.test(r.stdout + r.stderr), 'avisa cuando título y --requiere no coinciden');
    const req = execFileSync('unzip', ['-p', zipDe(333), '.parche-requiere'], { encoding: 'utf8' }).trim();
    ok(req === '332', '.parche-requiere dentro del zip dice 332', req);
    ok(versionBase() === '333', '.version-base pasó a 333');
    ok(!fs.existsSync(path.join(campana, '.parche-requiere')), 'no deja .parche-requiere suelto en el proyecto');

    r = correr('334', '--titulo', 'Otra cosa (Requiere el 333)', '--base', base, 'lib/prueba-orden46.js');
    ok(r.status === 0 && execFileSync('unzip', ['-p', zipDe(334), '.parche-requiere'], { encoding: 'utf8' }).trim() === '333', 'toma el requisito del título si no se da --requiere');

    r = correr('335', '--sin-requisito', '--base', base, 'lib/prueba-orden46.js');
    ok(r.status === 0 && spawnSync('unzip', ['-Z1', zipDe(335)], { encoding: 'utf8' }).stdout.split('\n').indexOf('.parche-requiere') === -1, '--sin-requisito genera un zip sin .parche-requiere');

    r = correr('336', '--requiere', '336', '--base', base, 'lib/prueba-orden46.js');
    ok(r.status === 1 && /no puede requerir/.test(r.stderr), 'un parche no puede requerirse a sí mismo');

    r = correr('336', '--requiere', '335', '--base', base, '.parches-aplicados');
    ok(r.status === 1 && /no pueden ir en un parche/.test(r.stderr), '.parches-aplicados no puede viajar en un parche');

    // base anterior + zip falla: no genera nada y no deja .version-base cambiada
    fs.writeFileSync(path.join(campana, 'routes/prueba-rota-46.js'), "const { requiereEditarModuloQueNoExiste } = require('../middleware/permisoModulo');\nrequiereEditarModuloQueNoExiste('x');\n");
    const antesVB = versionBase();
    r = correr('340', '--requiere', '332', '--base', base, 'routes/prueba-rota-46.js');
    ok(r.status === 1 && /no exporta/.test(r.stdout + r.stderr) && !fs.existsSync(zipDe(340)), 'si «base anterior + zip» falla no genera el zip', r.stdout + r.stderr);
    ok(versionBase() === antesVB, '.version-base quedó como estaba', versionBase());
    void baseAntes;
  }

  /* ===== 7. registrar-parche.js ===== */
  titulo('7. registrar-parche.js manda el requisito leído del zip');
  {
    const campana = clonarCampana('reg', 332);
    fs.mkdirSync(path.join(campana, 'parches'), { recursive: true });
    armarZip(path.join(campana, 'parches/campana-parche333.zip'), { 'x.txt': 'x\n' }, 332);
    let cuerpo = null;
    const servidor = http.createServer((req, res) => {
      let datos = '';
      req.on('data', (c) => { datos += c; });
      req.on('end', () => {
        cuerpo = JSON.parse(datos);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, numero_parche: 333, sha256: 'abc', toca_base_datos: false, requiere_parche: 332, modo_distribucion: 'seleccionadas' }));
      });
    });
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    const puerto = servidor.address().port;
    const r = await new Promise((resolve) => {
      const { spawn } = require('child_process');
      const hijo = spawn(process.execPath, [path.join(campana, 'scripts/registrar-parche.js'), '333', 'Prueba (Requiere el 331)'], {
        cwd: campana, env: { ...process.env, LICENCIA_SERVIDOR_URL: `http://127.0.0.1:${puerto}`, PARCHES_PUBLICADOR_SECRET: 's' },
      });
      let out = '';
      hijo.stdout.on('data', (c) => { out += c; }); hijo.stderr.on('data', (c) => { out += c; });
      hijo.on('close', (codigo) => resolve({ codigo, out }));
    });
    servidor.close();
    ok(r.codigo === 0 && cuerpo && cuerpo.requiere_parche === 332, 'envía requiere_parche = 332 (del zip)', cuerpo);
    ok(/AVISO: el título dice «Requiere el 331» pero el zip requiere el 332/.test(r.out), 'avisa si el título no coincide con el zip');
    ok(/seleccionadas — sin ninguna campaña marcada/.test(r.out), 'dice que la distribución quedó en «seleccionadas» sin campañas');
  }

  console.log(`\n${fallos ? fallos + ' de ' + total + ' comprobación(es) FALLARON.' : 'Las ' + total + ' comprobaciones pasaron.'}`);
}

main()
  .then(() => { fs.rmSync(RAIZ, { recursive: true, force: true }); process.exit(fallos ? 1 : 0); })
  .catch((err) => { console.error('ERROR:', err); console.error('(copias de prueba en ' + RAIZ + ')'); process.exit(1); });

void assert;
