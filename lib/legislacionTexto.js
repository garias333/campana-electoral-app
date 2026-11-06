/**
 * Texto de los PDF de legislación: extracción, partición por artículos, caché y
 * búsqueda. Lo usa routes/legislacion.routes.js.
 *
 * QUÉ HERRAMIENTA SACA EL TEXTO. Ninguna dependencia de npm. Se usa lo que haya
 * en el servidor, en este orden:
 *   1. `pdftotext -raw` (poppler-utils), si está en /usr/bin: separa páginas con \f.
 *      EL MODO ES -raw A PROPÓSITO: con el de lectura por defecto, dos encabezados de
 *      la Resolución 09458 («ARTÍCULO DÉCIMO SÉPTIMO», «VIGÉSIMO SEGUNDO») quedan
 *      partidos y el artículo se pierde; con -raw salen enteros y los 9 PDF con texto
 *      dan los mismos artículos que con Ghostscript (medido artículo por artículo).
 *      El conteo de páginas sale de `pdfinfo`.
 *   2. Ghostscript (`gs`, dispositivo txtwrite), que escribe UN archivo por página
 *      (`%05d`) y así se sabe en qué página cae cada cosa. Es lo que hay hoy.
 * Si no hay ninguna, la búsqueda responde vacía y avisa UNA vez en el log.
 *
 * QUÉ SE HACE CON EL TEXTO
 *   · Se normaliza (NFKC: las ligaturas «ﬁ» y «ﬂ» que dejan las copias de la
 *     Función Pública pasan a «fi» y «fl»; si no, «confiere» no se encuentra).
 *   · Se quitan encabezados y pies que se repiten en las páginas (mirando solo los
 *     bordes de cada página, para no borrar un «Parágrafo.» legítimo).
 *   · Se parte en artículos. Un encabezado solo cuenta si su número sigue al
 *     anterior (sin retroceder ni saltar más de 8): así «Artículo 26 del Decreto…»
 *     al comienzo de una línea de una cita no corta nada.
 *   · Lo que no cae en un artículo —epígrafe, considerandos, firmas— queda como
 *     «Texto general», por página.
 *
 * UN PDF ESCANEADO NO SE BUSCA. Su capa de texto, si la tiene, es parcial y
 * engaña: la Resolución 12338 «contiene» la mitad de su cuadro. Se detecta por
 * una imagen por página o por un tamaño por página que solo tiene una imagen, y
 * se omite con un aviso. Mejor decir «no se pudo buscar ahí» que devolver
 * resultados a medias.
 *
 * CACHÉ. En memoria y en disco, por PDF. La clave es nombre + tamaño + fecha de
 * modificación + versión de este extractor; si el PDF cambia, la clave cambia y
 * el archivo viejo se borra. Vive en una carpeta de la instalación FUERA de
 * `legislacion/` (datos/cache-legislacion/): el cron que copia esa carpeta usa
 * --delete y se la llevaría. Solo se borran archivos con el nombre exacto que
 * esta caché escribe.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const VERSION_EXTRACTOR = 4;
const MAX_RESULTADOS = 50;
const UMBRAL_BYTES_POR_PAGINA_ESCANEADO = 150 * 1024;
const TIEMPO_MAXIMO_HERRAMIENTA_MS = 180 * 1000;
const PDF_MAXIMO_BYTES = 60 * 1024 * 1024;

/* ---------------------------------------------------------------------------
   TEXTO: normalización de búsqueda
   --------------------------------------------------------------------------- */

/**
 * Minúsculas y sin tildes. LA Ñ SE CONSERVA: «año» y «ano» son palabras
 * distintas y quien busca «ano» no quiere «año». Devuelve una cadena del mismo
 * largo que la original cuando el texto ya está en NFKC (el navegador usa la
 * misma regla para resaltar sin desfasar las posiciones).
 */
function normalizar(texto) {
  return String(texto == null ? '' : texto)
    .toLowerCase()
    .replace(/ñ/g, '\u0001')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\u0001/g, 'ñ');
}

/* ---------------------------------------------------------------------------
   HERRAMIENTAS DEL SISTEMA
   --------------------------------------------------------------------------- */

function buscarHerramienta() {
  const pdftotext = ['/usr/bin/pdftotext', '/usr/local/bin/pdftotext'].find((r) => fs.existsSync(r));
  if (pdftotext) return { tipo: 'pdftotext', ruta: pdftotext };
  const gs = ['/usr/bin/gs', '/usr/local/bin/gs'].find((r) => fs.existsSync(r));
  if (gs) return { tipo: 'gs', ruta: gs };
  return null;
}

function ejecutar(ruta, args, opciones = {}) {
  return new Promise((resolver, rechazar) => {
    execFile(ruta, args, {
      timeout: TIEMPO_MAXIMO_HERRAMIENTA_MS,
      maxBuffer: 256 * 1024 * 1024,
      encoding: 'utf8',
      ...opciones
    }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; return rechazar(err); }
      resolver({ stdout, stderr });
    });
  });
}

/** Páginas de un PDF con Ghostscript, SIN abrirlo en modo inseguro: solo se le permite leer ese archivo. */
async function contarPaginasGs(gs, rutaPdf) {
  const { stdout } = await ejecutar(gs, [
    '-q', '-dNODISPLAY', '-dSAFER', '-dBATCH', '-dNOPAUSE',
    `--permit-file-read=${rutaPdf}`, `-sPDFname=${rutaPdf}`,
    '-c', 'PDFname (r) file runpdfbegin pdfpagecount = quit'
  ]);
  const n = parseInt(String(stdout).trim().split(/\s+/).pop(), 10);
  if (!Number.isInteger(n) || n < 1) throw new Error('no se pudo contar las páginas');
  return n;
}

/** Páginas con `pdfinfo` (poppler), que viene con pdftotext. */
async function contarPaginasPdfinfo(rutaPdftotext, rutaPdf) {
  const pdfinfo = path.join(path.dirname(rutaPdftotext), 'pdfinfo');
  if (!fs.existsSync(pdfinfo)) throw new Error('no hay pdfinfo');
  const { stdout } = await ejecutar(pdfinfo, [rutaPdf]);
  const m = /^Pages:\s+(\d+)/m.exec(stdout);
  if (!m) throw new Error('pdfinfo no dijo cuántas páginas tiene');
  return parseInt(m[1], 10);
}

async function contarPaginas(herramienta, rutaPdf) {
  if (!herramienta) throw new Error('sin herramienta');
  if (herramienta.tipo === 'pdftotext') return contarPaginasPdfinfo(herramienta.ruta, rutaPdf);
  return contarPaginasGs(herramienta.ruta, rutaPdf);
}

/** El texto de cada página, en un arreglo. */
async function extraerPaginas(herramienta, rutaPdf, carpetaTemporal) {
  if (herramienta.tipo === 'pdftotext') {
    const { stdout } = await ejecutar(herramienta.ruta, ['-raw', '-enc', 'UTF-8', rutaPdf, '-']);
    const paginas = stdout.split('\f');
    if (paginas.length && paginas[paginas.length - 1].trim() === '') paginas.pop();
    return paginas;
  }
  // Ghostscript: un archivo por página, en una carpeta propia que se borra al terminar.
  fs.mkdirSync(carpetaTemporal, { recursive: true, mode: 0o750 });
  const dir = fs.mkdtempSync(path.join(carpetaTemporal, 'gs-'));
  try {
    try {
      await ejecutar(herramienta.ruta, [
        '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=txtwrite',
        `-sOutputFile=${path.join(dir, 'p%05d.txt')}`, rutaPdf
      ]);
    } catch (err) {
      // Ghostscript a veces termina con código distinto de 0 después de escribir todo.
      if (!fs.readdirSync(dir).length) throw err;
    }
    const archivos = fs.readdirSync(dir).filter((f) => /^p\d{5}\.txt$/.test(f)).sort();
    return archivos.map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------------------------
   LIMPIEZA Y PARTICIÓN POR ARTÍCULOS
   --------------------------------------------------------------------------- */

const ORDINALES = {
  PRIMERO: 1, SEGUNDO: 2, TERCERO: 3, CUARTO: 4, QUINTO: 5, SEXTO: 6,
  SEPTIMO: 7, OCTAVO: 8, NOVENO: 9, DECIMO: 10, VIGESIMO: 20, TRIGESIMO: 30, CUADRAGESIMO: 40
};

function valorOrdinal(palabras) {
  const partes = palabras.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/);
  if (partes[0] === 'UNICO') return 1;
  let total = 0;
  for (const p of partes) {
    if (!(p in ORDINALES)) return null;
    total += ORDINALES[p];
  }
  return total;
}

/* «ARTÍCULO 24.» · «Artículo 1°.» · «ARTÍCULO 1o.» · «ARTÍCULO 185A.» · «ARTÍCULO 50 Modificado…»
   El número no puede quedar pegado a otras letras («1abc»): lo que sigue tiene que ser el
   ordinal (°, º u «o» suelta), la letra de un artículo «bis» pegada al número, un punto o un espacio. */
const RE_ARTICULO_NUMERO =
  /^(?:ART[ÍI]CULO|ARTICULO|Art[íi]culo|Articulo)\s+(\d{1,4})(?:([A-Z])(?![A-Za-z]))?(?:[°ºo](?![A-Za-záéíóúñ]))?(?=[\s.:\-]|$)\s*\.?/;
const RE_ARTICULO_ORDINAL =
  /^ART[ÍI]CULO\s+(ÚNICO|UNICO|(?:(?:D[ÉE]CIMO|VIG[ÉE]SIMO|TRIG[ÉE]SIMO|CUADRAG[ÉE]SIMO)\s+)?(?:PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO|S[ÉE]PTIMO|OCTAVO|NOVENO)|D[ÉE]CIMO|VIG[ÉE]SIMO|TRIG[ÉE]SIMO)(?![A-ZÁÉÍÓÚ])\s*[.:]?/i;
const RE_REFERENCIA = /^\s*(?:de|del)\s+(?:la\s+)?(?:ley|decreto|c[oó]digo|constituci|resoluci|acto|presente)/i;
const RE_ESTRUCTURA = /^(?:T[ÍI]TULO|CAP[ÍI]TULO|LIBRO|SECCI[ÓO]N|PARTE)\b/;
const RE_FIRMAS = /^(?:El Presidente|La Presidenta|El Secretario|La Secretaria|Dada en|Dado en|PUBL[ÍI]QUESE|COMUN[ÍI]QUESE|Aprobada en|Aprob[óo]:)/;

/** ¿Esta línea abre un artículo? Devuelve {numero, sufijo, resto} o null. No mira la secuencia. */
function leerEncabezado(linea) {
  let m = RE_ARTICULO_NUMERO.exec(linea);
  if (m) {
    const resto = linea.slice(m[0].length);
    if (/^[,;]/.test(resto) || RE_REFERENCIA.test(resto)) return null;
    return { numero: parseInt(m[1], 10), sufijo: m[2] || '', resto: resto.trim() };
  }
  m = RE_ARTICULO_ORDINAL.exec(linea);
  if (m) {
    const n = valorOrdinal(m[1]);
    if (n == null) return null;
    return { numero: n, sufijo: '', resto: linea.slice(m[0].length).trim() };
  }
  return null;
}

/** Une líneas visuales en párrafos: corta donde una frase termina y la siguiente línea arranca como una nueva. */
function unirLineas(lineas) {
  const salida = [];
  for (const l of lineas) {
    const previo = salida.length ? salida[salida.length - 1] : null;
    const nuevoParrafo = previo !== null && /[.:;]$/.test(previo)
      && /^(?:[A-ZÁÉÍÓÚÑ0-9"“(¿¡]|[a-z]\)|Par[áa]grafo|PAR[ÁA]GRAFO)/.test(l);
    if (previo === null || nuevoParrafo) salida.push(l);
    else salida[salida.length - 1] = previo + ' ' + l;
  }
  return salida.join('\n');
}

/** Quita encabezados y pies que se repiten en las páginas, mirando solo los bordes. */
function quitarEncabezadosRepetidos(paginas) {
  const total = paginas.length;
  if (total < 3) return paginas;
  const clave = (l) => l.replace(/\d+/g, '#').toLowerCase();
  const cuenta = new Map();
  for (const lineas of paginas) {
    const bordes = new Set([...lineas.slice(0, 3), ...lineas.slice(-3)].map(clave));
    for (const k of bordes) cuenta.set(k, (cuenta.get(k) || 0) + 1);
  }
  const repetidas = new Set([...cuenta].filter(([, n]) => n / total >= 0.6).map(([k]) => k));
  return paginas.map((lineas) => lineas.filter((l, i) => {
    const enBorde = i < 3 || i >= lineas.length - 3;
    return !(enBorde && repetidas.has(clave(l)));
  }));
}

/**
 * De las páginas de texto a {articulos, general}.
 *   articulos: [{ numero, sufijo, etiqueta, titulo, seccion, pagina, texto }]
 *   general:   [{ pagina, texto }]
 */
function dividirEnArticulos(paginasTexto) {
  let paginas = paginasTexto.map((t) => String(t).normalize('NFKC').replace(/ /g, ' ')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean));
  paginas = quitarEncabezadosRepetidos(paginas);

  // Ruido propio de las copias de la Función Pública y de los pies de resoluciones.
  const RUIDO = [
    /^Los datos publicados tienen propósitos exclusivamente informativos/,
    /^responsable de la vigencia de la presente norma/,
    /^Página \d+ de \d+$/,
    /^\d{1,3}$/                      // número de nota o de página suelto
  ];
  const lineas = [];
  paginas.forEach((ls, i) => {
    for (const t of ls) {
      if (RUIDO.some((re) => re.test(t))) continue;
      // «Artículo 24. Título» / (pie de página) / «. Cuerpo»: el punto suelto pega con su título.
      if (t.startsWith('. ') && lineas.length && !/[.:]$/.test(lineas[lineas.length - 1].t)) {
        lineas[lineas.length - 1].t += t;
        continue;
      }
      lineas.push({ p: i + 1, t });
    }
  });

  // Encabezados que siguen la secuencia.
  const cabezas = [];
  let ultimo = { n: 0, s: '' };
  lineas.forEach((l, idx) => {
    const h = leerEncabezado(l.t);
    if (!h) return;
    const sigue = (h.numero > ultimo.n && h.numero <= ultimo.n + 8)
      || (h.numero === ultimo.n && h.sufijo && h.sufijo > ultimo.s);
    if (!sigue) return;
    ultimo = { n: h.numero, s: h.sufijo };
    cabezas.push({ idx, ...h });
  });

  const articulos = [];
  const generalLineas = [];
  const primera = cabezas.length ? cabezas[0].idx : lineas.length;
  for (let i = 0; i < primera; i++) generalLineas.push(lineas[i]);

  let seccionPendiente = '';
  cabezas.forEach((c, k) => {
    const fin = k + 1 < cabezas.length ? cabezas[k + 1].idx : lineas.length;
    let cuerpoFin = fin;
    let siguienteSeccion = '';

    // Títulos y capítulos que caen al final del artículo anterior: pertenecen al siguiente.
    for (let i = c.idx + 1; i < fin; i++) {
      if (RE_ESTRUCTURA.test(lineas[i].t) && lineas[i].t.length <= 60 && (fin - i) <= 8 && k + 1 < cabezas.length) {
        cuerpoFin = i;
        siguienteSeccion = lineas.slice(i, fin).map((x) => x.t).join(' — ');
        break;
      }
    }
    // Firmas y fórmulas finales del último artículo.
    if (k + 1 === cabezas.length) {
      for (let i = c.idx + 1; i < cuerpoFin; i++) {
        if (RE_FIRMAS.test(lineas[i].t)) {
          for (let j = i; j < cuerpoFin; j++) generalLineas.push(lineas[j]);
          cuerpoFin = i;
          break;
        }
      }
    }

    const cuerpo = lineas.slice(c.idx, cuerpoFin);
    const etiqueta = `Artículo ${c.numero}${c.sufijo}`;
    articulos.push({
      numero: c.numero,
      sufijo: c.sufijo,
      etiqueta,
      titulo: c.resto.split(/(?<=[.:])\s/)[0].slice(0, 140),
      seccion: seccionPendiente,
      pagina: lineas[c.idx].p,
      texto: unirLineas(cuerpo.map((x) => x.t))
    });
    seccionPendiente = siguienteSeccion;
  });

  // «Texto general»: un bloque por página, para poder decir en cuál está.
  const general = [];
  for (const l of generalLineas) {
    const ultimoBloque = general[general.length - 1];
    if (ultimoBloque && ultimoBloque.pagina === l.p) ultimoBloque.lineas.push(l.t);
    else general.push({ pagina: l.p, lineas: [l.t] });
  }
  return {
    articulos,
    general: general.map((b) => ({ pagina: b.pagina, texto: unirLineas(b.lineas) })).filter((b) => b.texto.length > 0)
  };
}

/* ---------------------------------------------------------------------------
   LA CONSULTA
   --------------------------------------------------------------------------- */

const PALABRAS_DE_REFERENCIA = new Set(['ley', 'decreto', 'resolucion', 'res', 'acuerdo', 'de', 'del', 'la', 'el', 'no', 'num', 'numero']);

/**
 * «artículo 24», «art 24», «art. 24 ley 130», «1475 artículo 35», «ley 130 de 1994 propaganda»…
 * Devuelve { articulo, sufijo, leyes:[numeros], anio, terminos:[palabras] }.
 */
function interpretarConsulta(q, numerosDeNormas) {
  let n = normalizar(q).replace(/\s+/g, ' ').trim();
  let articulo = null;
  let sufijo = '';
  const mArt = /\bart(?:iculos?)?\.?\s*(\d{1,4})([a-z])?(?![a-z0-9])/.exec(n);
  if (mArt) {
    articulo = parseInt(mArt[1], 10);
    sufijo = (mArt[2] || '').toUpperCase();
    n = (n.slice(0, mArt.index) + ' ' + n.slice(mArt.index + mArt[0].length)).replace(/\s+/g, ' ').trim();
  }
  const leyes = [];
  let anio = null;
  const mAnio = /\bde\s+((?:18|19|20)\d{2})\b/.exec(n);
  if (mAnio) { anio = parseInt(mAnio[1], 10); n = n.replace(mAnio[0], ' '); }
  n = n.replace(/\b(?:ley|decreto|resolucion|res|acuerdo)\.?\s*(?:no\.?|num\.?|numero)?\s*(\d{1,5})\b/g, (_, num) => {
    leyes.push(String(parseInt(num, 10)));
    return ' ';
  });
  const resto = [];
  for (const palabra of n.split(' ').filter(Boolean)) {
    if (/^\d{2,5}$/.test(palabra) && numerosDeNormas.has(String(parseInt(palabra, 10)))) {
      leyes.push(String(parseInt(palabra, 10)));
    } else if (!PALABRAS_DE_REFERENCIA.has(palabra) || (!articulo && !leyes.length)) {
      resto.push(palabra);
    }
  }
  // «De» y similares solo estorban cuando acompañan a una referencia.
  const terminos = (articulo || leyes.length) ? resto.filter((p) => !PALABRAS_DE_REFERENCIA.has(p)) : resto;
  return { articulo, sufijo, leyes, anio, terminos };
}

/**
 * Posición de `termino` en `norm` SOLO si empieza una palabra: «eleccion» encuentra
 * «elecciones» pero no «selección»; «ano» no encuentra «ciudadano». (La ñ cuenta como
 * letra, así que «ano» tampoco encuentra «año».) -1 si no hay.
 */
function buscarPalabra(norm, termino, desde = 0) {
  let i = norm.indexOf(termino, desde);
  while (i > 0 && /[a-zñ0-9]/.test(norm[i - 1])) i = norm.indexOf(termino, i + 1);
  return i;
}

function contarPalabra(norm, termino) {
  let n = 0;
  let i = buscarPalabra(norm, termino, 0);
  while (i >= 0) { n += 1; i = buscarPalabra(norm, termino, i + termino.length); }
  return n;
}

function fragmentoAlrededor(texto, normalizado, terminos) {
  const plano = texto.replace(/\s*\n\s*/g, ' ');
  const planoNorm = normalizado.replace(/\s*\n\s*/g, ' ');
  let pos = -1;
  for (const t of terminos) {
    const i = buscarPalabra(planoNorm, t);
    if (i >= 0 && (pos < 0 || i < pos)) pos = i;
  }
  const ANCHO = 250;
  if (pos < 0) return plano.length > ANCHO ? plano.slice(0, ANCHO).trimEnd() + '…' : plano;
  let ini = Math.max(0, pos - Math.floor(ANCHO / 3));
  let fin = Math.min(plano.length, ini + ANCHO);
  ini = Math.max(0, fin - ANCHO);
  // No cortar palabras por los bordes.
  if (ini > 0) { const e = plano.indexOf(' ', ini); if (e > 0 && e < pos) ini = e + 1; }
  if (fin < plano.length) { const e = plano.lastIndexOf(' ', fin); if (e > pos) fin = e; }
  return (ini > 0 ? '…' : '') + plano.slice(ini, fin).trim() + (fin < plano.length ? '…' : '');
}

/* ---------------------------------------------------------------------------
   EL BUSCADOR (CON SU CACHÉ)
   --------------------------------------------------------------------------- */

function crearBuscador({ carpetaPdf, carpetaCache, aviso = console.warn }) {
  const memoria = new Map();            // archivo -> { clave, datos }
  const paginasMemoria = new Map();     // archivo|tamaño|mtime -> páginas
  const avisados = new Set();
  const fallos = new Map();             // clave -> cuándo falló (no se reintenta durante 10 minutos)
  const ESPERA_REINTENTO_MS = 10 * 60 * 1000;
  let construyendo = null;

  const avisarUnaVez = (id, mensaje) => {
    if (avisados.has(id)) return;
    avisados.add(id);
    aviso(`[legislacion] ${mensaje}`);
  };

  const huella = (texto, largo) => crypto.createHash('sha1').update(texto).digest('hex').slice(0, largo);
  const claveDe = (norma) => `${norma.archivo}|${norma.tamano_bytes}|${Date.parse(norma.fecha)}|v${VERSION_EXTRACTOR}`;
  const prefijoDe = (archivo) => `${huella(archivo, 10)}__`;
  const archivoDeCache = (norma) => path.join(carpetaCache, `${prefijoDe(norma.archivo)}${huella(claveDe(norma), 12)}.json`);
  const RE_ARCHIVO_CACHE = /^[0-9a-f]{10}__[0-9a-f]{12}\.json$/;

  /** Páginas de un PDF, para las tarjetas de la lista (no necesita la extracción completa). */
  async function paginasDe(norma) {
    const clave = claveDe(norma);
    if (paginasMemoria.has(clave)) return paginasMemoria.get(clave);
    const herramienta = buscarHerramienta();
    let n = null;
    try {
      const enDisco = archivoDeCache(norma);
      if (fs.existsSync(enDisco)) n = JSON.parse(fs.readFileSync(enDisco, 'utf8')).paginas || null;
      if (n == null && herramienta) n = await contarPaginas(herramienta, path.join(carpetaPdf, norma.archivo));
    } catch (err) {
      avisarUnaVez(`pag|${clave}`, `no se pudo contar las páginas de ${norma.archivo}: ${err.message}`);
    }
    paginasMemoria.set(clave, n);
    return n;
  }

  function esEscaneado(rutaPdf, tamano, paginas) {
    if (!paginas) return false;
    const imagenes = (fs.readFileSync(rutaPdf).toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;
    return imagenes >= paginas || (tamano / paginas) > UMBRAL_BYTES_POR_PAGINA_ESCANEADO;
  }

  async function indexarUna(norma, herramienta) {
    const rutaPdf = path.join(carpetaPdf, norma.archivo);
    const clave = claveDe(norma);
    const cache = archivoDeCache(norma);

    try {
      if (fs.existsSync(cache)) {
        const datos = JSON.parse(fs.readFileSync(cache, 'utf8'));
        if (datos && datos.clave === clave) return datos;
      }
    } catch (err) { /* caché dañada: se rehace */ }

    const base = { clave, archivo: norma.archivo, paginas: null, omitido: null, articulos: [], general: [] };
    if (norma.tamano_bytes > PDF_MAXIMO_BYTES) {
      base.omitido = 'archivo demasiado grande para indexar';
    } else if (!herramienta) {
      const e = new Error('no hay pdftotext ni Ghostscript en el servidor');
      e.sinHerramienta = true;
      throw e;
    } else {
      const MOTIVO_ESCANEADO = 'PDF escaneado (imágenes): no tiene texto confiable y necesitaría OCR';
      let paginas = null;
      try { paginas = await contarPaginas(herramienta, rutaPdf); } catch (e) { /* se cuenta al extraer */ }
      base.paginas = paginas;
      if (paginas && esEscaneado(rutaPdf, norma.tamano_bytes, paginas)) {
        base.omitido = MOTIVO_ESCANEADO;
      } else {
        const textoPaginas = await extraerPaginas(herramienta, rutaPdf, path.join(carpetaCache, 'tmp'));
        base.paginas = textoPaginas.length;
        const total = textoPaginas.reduce((a, t) => a + t.replace(/\s/g, '').length, 0);
        if (!paginas && esEscaneado(rutaPdf, norma.tamano_bytes, textoPaginas.length)) {
          base.omitido = MOTIVO_ESCANEADO;     // el conteo falló y solo se supo al extraer
        } else if (total < 200) {
          base.omitido = 'el PDF no tiene texto extraíble';
        } else {
          const { articulos, general } = dividirEnArticulos(textoPaginas);
          base.articulos = articulos;
          base.general = general;
        }
      }
    }

    // Se guarda (también «omitido») para no repetir el trabajo; los fallos de la herramienta NO se guardan.
    try {
      fs.mkdirSync(carpetaCache, { recursive: true, mode: 0o750 });
      const tmp = `${cache}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(base), { mode: 0o640 });
      fs.renameSync(tmp, cache);
    } catch (err) {
      avisarUnaVez(`esc|${cache}`, `no se pudo guardar la caché de ${norma.archivo}: ${err.code || err.message}`);
    }
    return base;
  }

  function limpiarCacheVieja(normas) {
    let archivos;
    try { archivos = fs.readdirSync(carpetaCache); } catch (err) { return; }
    const vigentes = new Set(normas.map((n) => path.basename(archivoDeCache(n))));
    for (const f of archivos) {
      if (RE_ARCHIVO_CACHE.test(f) && !vigentes.has(f)) {
        try { fs.unlinkSync(path.join(carpetaCache, f)); } catch (err) { /* otro proceso lo borró */ }
      }
    }
    for (const archivo of [...memoria.keys()]) {
      if (!normas.some((n) => n.archivo === archivo)) memoria.delete(archivo);
    }
  }

  /** Deja indexados todos los PDF vigentes. Una sola construcción a la vez. */
  function asegurarIndice(normas) {
    if (construyendo) return construyendo;
    construyendo = (async () => {
      const herramienta = buscarHerramienta();
      const omitidas = [];
      for (const norma of normas) {
        const clave = claveDe(norma);
        const previo = memoria.get(norma.archivo);
        if (previo && previo.clave === clave) {
          if (previo.datos.omitido) omitidas.push({ archivo: norma.archivo, motivo: previo.datos.omitido });
          continue;
        }
        const fallo = fallos.get(clave);
        if (fallo && Date.now() - fallo < ESPERA_REINTENTO_MS) {
          omitidas.push({ archivo: norma.archivo, motivo: 'no se pudo extraer el texto' });
          continue;
        }
        try {
          const datos = await indexarUna(norma, herramienta);
          // Normalizado de cada trozo: se calcula al cargar, no se guarda en disco.
          datos.trozos = [
            ...datos.articulos.map((a) => ({ tipo: 'articulo', ...a })),
            ...datos.general.map((g) => ({ tipo: 'general', etiqueta: 'Texto general', numero: null, sufijo: '', titulo: '', seccion: '', ...g }))
          ].map((t) => ({ ...t, norm: normalizar(t.texto), normTitulo: normalizar(`${t.etiqueta} ${t.titulo}`) }));
          memoria.set(norma.archivo, { clave, datos });
          if (datos.omitido) {
            omitidas.push({ archivo: norma.archivo, motivo: datos.omitido });
            avisarUnaVez(`omit|${clave}`, `${norma.archivo} se omite de la búsqueda: ${datos.omitido}.`);
          }
        } catch (err) {
          memoria.delete(norma.archivo);
          fallos.set(clave, Date.now());
          omitidas.push({ archivo: norma.archivo, motivo: 'no se pudo extraer el texto' });
          avisarUnaVez(`err|${clave}`, `no se pudo extraer el texto de ${norma.archivo}: ${err.sinHerramienta ? err.message : (err.code || err.message)}`);
        }
      }
      limpiarCacheVieja(normas);
      return omitidas;
    })().finally(() => { construyendo = null; });
    return construyendo;
  }

  /**
   * @param {string} q       consulta ya validada (2 a 100 caracteres)
   * @param {object[]} normas  listado vigente (con título, número y año)
   */
  async function buscar(q, normas) {
    const omitidas = await asegurarIndice(normas);
    const numeros = new Set(normas.map((n) => String(parseInt(n.numero, 10))).filter((x) => x !== 'NaN'));
    const consulta = interpretarConsulta(q, numeros);

    let candidatas = normas;
    if (consulta.leyes.length) {
      candidatas = normas.filter((n) => consulta.leyes.includes(String(parseInt(n.numero, 10)))
        && (consulta.anio == null || n.anio === consulta.anio));
    } else if (consulta.anio != null && consulta.articulo != null) {
      candidatas = normas.filter((n) => n.anio === consulta.anio);
    }

    const soloLey = consulta.leyes.length > 0 && consulta.articulo == null && consulta.terminos.length === 0;
    const hallados = [];
    for (const norma of candidatas) {
      const entrada = memoria.get(norma.archivo);
      if (!entrada || entrada.datos.omitido) continue;
      for (const t of entrada.datos.trozos) {
        if (consulta.articulo != null) {
          if (t.tipo !== 'articulo' || t.numero !== consulta.articulo) continue;
          if (consulta.sufijo && t.sufijo !== consulta.sufijo) continue;
        } else if (soloLey) {
          if (t.tipo !== 'articulo') continue;
        }
        let puntaje = 0;
        let todos = true;
        for (const termino of consulta.terminos) {
          const veces = contarPalabra(t.norm, termino);
          if (veces === 0) { todos = false; break; }
          puntaje += Math.min(veces, 5) + (buscarPalabra(t.normTitulo, termino) >= 0 ? 10 : 0);
        }
        if (!todos) continue;
        hallados.push({ norma, t, puntaje });
      }
    }

    // Más relevante primero; a igualdad, el orden de la norma en la lista y el del artículo.
    const ordenNorma = new Map(normas.map((n, i) => [n.archivo, i]));
    hallados.sort((a, b) => (b.puntaje - a.puntaje)
      || (ordenNorma.get(a.norma.archivo) - ordenNorma.get(b.norma.archivo))
      || ((a.t.numero || 0) - (b.t.numero || 0)) || (a.t.pagina - b.t.pagina));

    const resultados = hallados.slice(0, MAX_RESULTADOS).map(({ norma, t }) => ({
      archivo: norma.archivo,
      norma: norma.titulo,
      tipo: norma.tipo || null,
      articulo: t.etiqueta,
      numero_articulo: t.numero,
      titulo_articulo: t.titulo || null,
      seccion: t.seccion || null,
      pagina: t.pagina,
      fragmento: fragmentoAlrededor(t.texto, t.norm, consulta.terminos),
      texto: t.texto
    }));
    const titulos = new Map(normas.map((n) => [n.archivo, n.titulo]));
    return {
      resultados,
      total: hallados.length,
      terminos: consulta.terminos,
      omitidas: omitidas.map((o) => ({ ...o, titulo: titulos.get(o.archivo) || o.archivo }))
    };
  }

  return { buscar, asegurarIndice, paginasDe };
}

module.exports = {
  crearBuscador, normalizar, interpretarConsulta, dividirEnArticulos, leerEncabezado,
  VERSION_EXTRACTOR, MAX_RESULTADOS
};
