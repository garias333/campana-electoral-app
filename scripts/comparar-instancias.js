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
const { execFileSync } = require('child_process');

const ORIGEN = path.join(__dirname, '..');
const SALIDA_PARCHES = path.join(ORIGEN, 'parches');

// Dónde viven las demás instancias si no se indican por argumento. No se
// descubren solas a propósito: una ruta equivocada daría un informe
// tranquilizador y falso.
const INSTANCIAS_POR_DEFECTO = [
  '/home/campanadepruebamunicipal/htdocs/campanadepruebamunicipal.appestrategia.net',
  '/home/campanadepruebadepartamental/htdocs/campanadepruebadepartamental.appestrategia.net',
];

// Qué se compara: el código que viaja en los parches. Se excluye lo que
// DEBE ser distinto en cada instancia (.env, licencia, subidas, respaldos).
/* SE COMPARA TODO public, NO SOLO public/js, Y TAMBIEN .html Y .css.
   Antes la lista era ['...', 'public/js'] con extensiones ['.js','.sql'], asi
   que las 41 pantallas y las 4 hojas de estilo NO SE COMPARABAN NUNCA. El
   parche 214 fue seis .html y un .css: entero invisible para este script, que
   existe justamente para que no se olvide nada. Habria dicho "sin diferencias"
   con las campanas corriendo pantallas viejas — la respuesta tranquilizadora
   es la peor de las dos.
   public/ no tiene carpetas volatiles (app, css, data, img, js: 40 archivos),
   asi que recorrerlo entero no mete ruido. Los subidos van en uploads/, fuera. */
const CARPETAS = ['routes', 'config', 'middleware', 'lib', 'db', 'scripts', 'public'];
const SUELTOS = ['app.js'];
const EXTENSIONES = ['.js', '.sql', '.html', '.css'];

/* MAQUETAS DE DISEÑO QUE NUNCA VIAJARON, Y NO DEBEN VIAJAR. comparar-disenos
   .html enlaza a las doce *-opcion-A/B/C.html y nada en la aplicacion enlaza a
   ella: es una isla cerrada, trabajo de taller. Sin esta lista el script
   gritaria trece diferencias en cada corrida, y una alarma que siempre suena
   deja de leerse — que es como se pierde la que si importa. Si algun dia una
   de estas pantallas se adopta de verdad, se quita de aqui y empieza a
   compararse como cualquier otra. */
const IGNORAR = [/^public\/comparar-disenos\.html$/, /^public\/[a-z]+-opcion-[A-Z]\.html$/];

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
        const rel = hijo.split(path.sep).join('/');
        if (IGNORAR.some((re) => re.test(rel))) continue;
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

/**
 * QUÉ ARCHIVOS TRAEN LOS PARCHES QUE A ESTA INSTANCIA LE FALTAN.
 *
 * Sin esto, el informe mezcla dos cosas muy distintas: un archivo que difiere
 * porque hay un parche sin aplicar —normal, y se arregla solo en cuanto se
 * active— y uno que difiere sin que ningún parche lo explique, que es el
 * fallo de verdad: código que se toca aquí y nunca viaja.
 *
 * Mezclados, el informe SIEMPRE tiene líneas —basta con publicar un parche—,
 * y una lista de alarmas que nunca está vacía se deja de leer. Es el mismo
 * criterio con el que se separan los avisos benignos en el resto del proyecto.
 *
 * Se lee del zip, que es la fuente: lo que dice el panel es otra cosa, y el
 * panel no se alcanza desde aquí.
 */
function archivosDeParchesPendientes(versionDestino) {
  const desde = parseInt(versionDestino, 10);
  const explicados = new Map();   // archivo -> primer parche que lo trae
  if (!Number.isInteger(desde)) return explicados;
  let nombres = [];
  try { nombres = fs.readdirSync(SALIDA_PARCHES); } catch (err) { return explicados; }
  const numeros = nombres
    .map((n) => (n.match(/^campana-parche(\d+)\.zip$/) || [])[1])
    .filter(Boolean).map(Number).filter((n) => n > desde).sort((a, b) => a - b);
  for (const numero of numeros) {
    let listado = '';
    try {
      listado = execFileSync('unzip', ['-Z1', path.join(SALIDA_PARCHES, `campana-parche${numero}.zip`)],
                             { encoding: 'utf8' });
    } catch (err) { continue; }
    for (const archivo of listado.split('\n').map((x) => x.trim()).filter(Boolean)) {
      if (!explicados.has(archivo)) explicados.set(archivo, numero);
    }
  }
  return explicados;
}

function versionParche(raiz) {
  try {
    return fs.readFileSync(path.join(raiz, '.version-parche'), 'utf8').trim();
  } catch (err) {
    return '(sin archivo)';
  }
}


/**
 * ¿EL PROCESO DE ESTA INSTANCIA ESTA CORRIENDO SUS PROPIOS ARCHIVOS?
 *
 * Node carga los modulos al arrancar. Editar un `routes/*.js` no cambia nada
 * hasta que el proceso se reinicia — y el sitio sigue respondiendo 200 todo el
 * tiempo, asi que nada avisa.
 *
 * A LAS CAMPAÑAS NO LES PASA: cada parche las reinicia. Le pasa a la
 * instalacion BASE, que es donde se edita y que justamente no recibe parches,
 * asi que nadie la reinicia nunca. El 30 de agosto de 2026 la base llevaba
 * 23 horas en pie con un dia entero de cambios en disco: su matriz de permisos
 * seguia sin el rol nuevo mientras las dos campañas ya lo tenian. Se descubrio
 * porque alguien noto que la base iba por detras de sus propias hijas.
 *
 * POR ESO SOLO SE COMPRUEBA EL ORIGEN. Las fechas de los archivos de una
 * campaña vienen del zip del parche y arrastran cinco horas de desfase; aqui
 * los archivos se editan en el sitio, asi que su fecha es la de verdad.
 *
 * La edad del proceso se lee de `/proc/<pid>/stat` via `ps`, no de PM2: PM2
 * llega a decir «online» con el proceso muerto (ver la nota del 24 de agosto
 * de 2026 en las memorias del proyecto).
 */
function procesoDesactualizado(raiz) {
  let salida;
  try {
    salida = execFileSync('ps', ['-eo', 'pid=,lstart=,cmd='], { encoding: 'utf8' });
  } catch (_) { return null; }        // sin `ps` no se puede saber: no se inventa
  const linea = salida.split('\n').find((l) => l.includes(`node `) && l.includes(`${raiz}/app.js`));
  if (!linea) return null;            // no esta corriendo: no es asunto de esto
  const pid = linea.trim().split(/\s+/)[0];
  const arranque = new Date(linea.slice(linea.indexOf(pid) + pid.length, linea.indexOf('node ')).trim());
  if (isNaN(arranque)) return null;

  /* SOLO LO QUE EL SERVIDOR CARGA. `scripts/` son guiones que se corren a
     mano —generar un parche, comparar instancias, elevar un superadmin— y no
     los lee `app.js` nunca: tocarlos no deja el proceso desactualizado, y
     contarlos daba un aviso falso a los diez segundos de editar este mismo
     archivo. `public/` tampoco entra: se sirve desde el disco en cada
     peticion, asi que un cambio ahi ya esta vivo sin reiniciar nada. */
  const CARGADAS_POR_EL_SERVIDOR = (a) => !a.startsWith('scripts/') && !a.startsWith('public/');

  let masNuevo = null;
  for (const archivo of inventario(raiz).keys()) {
    if (!CARGADAS_POR_EL_SERVIDOR(archivo)) continue;
    const completo = path.join(raiz, archivo);
    let m;
    try { m = fs.statSync(completo).mtime; } catch (_) { continue; }
    /* Una fecha en el FUTURO no es un archivo recien tocado: es el desfase de
       cinco horas que traen los zips. Se descarta en vez de dar una alarma
       falsa. */
    if (m > new Date()) continue;
    if (!masNuevo || m > masNuevo) masNuevo = m;
  }
  if (!masNuevo || masNuevo <= arranque) return null;
  return { pid, arranque, masNuevo, horas: (masNuevo - arranque) / 3600000 };
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

    const version = versionParche(destino);
    const pendientes = archivosDeParchesPendientes(version);
    const esperado = (f) => pendientes.get(f);

    const sinExplicar = [...difieren, ...faltan].filter((f) => !esperado(f)).concat(sobran);
    const porAplicar = [...difieren, ...faltan].filter((f) => esperado(f));

    console.log(`${etiqueta}: ${total} diferencia(s) (parche ${version})`);
    if (porAplicar.length) {
      const nums = [...new Set(porAplicar.map(esperado))].sort((a, b) => a - b);
      console.log(`   ${porAplicar.length} explicada(s) por el parche ${nums.join(', ')} — sin aplicar todavía:`);
      porAplicar.forEach((f) => console.log(`      #${esperado(f)}  ${f}`));
    }
    if (sinExplicar.length) {
      huboDeriva = true;
      console.log(`   ${sinExplicar.length} SIN EXPLICAR — ningún parche pendiente las trae:`);
      sinExplicar.forEach((f) => console.log(`      ${sobran.includes(f) ? 'solo ahí: ' : ''}${f}`));
    }
    console.log('');
  }

  /* Se avisa del ORIGEN aunque no haya deriva de archivos: son dos problemas
     distintos y el segundo no se ve en ningun md5. */
  const viejo = procesoDesactualizado(ORIGEN);
  if (viejo) {
    console.log('EL PROCESO DE ESTA INSTANCIA CORRE CODIGO VIEJO.');
    console.log(`   pid ${viejo.pid}, arrancado el ${viejo.arranque.toLocaleString('es-CO')}`);
    console.log(`   el archivo mas nuevo es de ${viejo.masNuevo.toLocaleString('es-CO')}`);
    console.log(`   son ${viejo.horas.toFixed(1)} horas de cambios en disco que nadie ha cargado.`);
    console.log('   Node lee los modulos al arrancar, y el sitio responde 200 igual.');
    console.log('   Como root:  bash scripts/reiniciar-instancia.sh appestrategia-electoral');
    console.log('   La prueba de que reinicio es que el PID cambie.\n');
  }

  if (huboDeriva) {
    console.log('\nHay deriva SIN EXPLICAR: código que se tocó aquí y no viaja en ningún');
    console.log('parche pendiente. Si debe llegar a las campañas, empaquétalo:');
    console.log('  node scripts/generar-parche.js <numero> <archivos...>');
    process.exit(1);
  }
  console.log('\nSin deriva. Lo que difiera está en un parche pendiente de aplicar.');
}

if (require.main === module) main();

module.exports = { inventario, versionParche };
