/**
 * Legislación: lista y sirve los PDF de la carpeta `legislacion/` de la raíz de
 * la instalación.
 *
 * LA APLICACIÓN SOLO LEE. No hay subida ni borrado: los archivos los deja el
 * equipo técnico con el administrador de archivos del servidor (CloudPanel).
 * Por eso tampoco hay tabla: la carpeta ES el catálogo.
 *
 * DÓNDE VIVE LA CARPETA, Y POR QUÉ IMPORTA. En la raíz del proyecto, NO en
 * `public/` ni en `uploads/`. `express.static(public)` entrega sin sesión todo lo
 * que cuelga de `public/`, y `/uploads` se entrega a cualquiera con sesión, sin
 * mirar permisos. Aquí el único camino es esta ruta, que pide sesión Y el
 * permiso «Ver» del módulo `legislacion`.
 * La ruta se arma desde `__dirname`, no desde `process.cwd()`: PM2 puede
 * arrancar el proceso desde otro directorio y la carpeta «desaparecería».
 *
 * NINGUNA RUTA DE DISCO SE ARMA CON LO QUE MANDA EL USUARIO. `:nombre` solo se
 * usa para BUSCAR en el listado que acaba de leerse del directorio; el archivo
 * que se abre sale de ese listado. Un nombre que no esté, o que traiga una
 * barra, da 404 sin tocar el disco.
 *
 * TÍTULOS. Si existe `legislacion/indice.json` (opcional) se usa:
 *   { "ley_1475-de-2011.pdf": { "titulo": "…", "tipo": "ley", "numero": "1475",
 *     "anio": 2011, "descripcion": "…", "orden": 1 } }
 * Si falta, está mal escrito o no menciona un PDF, el título sale del nombre del
 * archivo. Un JSON dañado NO tumba la página: se ignora y se deja un aviso en el
 * log.
 */
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const { requiereVerModulo } = require('../middleware/permisoModulo');

const router = express.Router();

const CARPETA = path.join(__dirname, '..', 'legislacion');
const ARCHIVO_INDICE = path.join(CARPETA, 'indice.json');
const MAX_BYTES_INDICE = 1024 * 1024;

router.use(requireAuth, requiereVerModulo('legislacion'));

/* ---------------------------------------------------------------------------
   TÍTULOS GENERADOS DESDE EL NOMBRE
   --------------------------------------------------------------------------- */

const TIPOS_CONOCIDOS = {
  ley: 'Ley',
  decreto: 'Decreto',
  resolucion: 'Resolución',
  acuerdo: 'Acuerdo',
  circular: 'Circular',
  sentencia: 'Sentencia',
  concepto: 'Concepto'
};

function quitarAcentos(texto) {
  return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * «ley_1475-de-2011.pdf» → { titulo: 'Ley 1475 de 2011', tipo: 'ley', numero: '1475', anio: 2011 }
 * «resolucion-0920-de-2011-CNE.pdf» → 'Resolución 0920 de 2011 (CNE)'
 * Lo que no encaja en «tipo número de año [resto]» se limpia sin inventar nada.
 */
function tituloDesdeNombre(archivo) {
  const base = archivo.replace(/\.pdf$/i, '');
  const m = base.match(/^([A-Za-zÁÉÍÓÚáéíóúñÑ]+)[-_ ]+(\d+[A-Za-z]?)[-_ ]+de[-_ ]+((?:1[89]|20)\d{2})(?:[-_ ]+(.+))?$/);
  if (m) {
    const clave = quitarAcentos(m[1]).toLowerCase();
    if (TIPOS_CONOCIDOS[clave]) {
      const resto = m[4] ? m[4].replace(/[-_]+/g, ' ').trim() : '';
      return {
        titulo: `${TIPOS_CONOCIDOS[clave]} ${m[2]} de ${m[3]}${resto ? ` (${resto})` : ''}`,
        tipo: clave,
        numero: m[2],
        anio: Number(m[3])
      };
    }
  }
  const limpio = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    titulo: limpio ? limpio.charAt(0).toUpperCase() + limpio.slice(1) : archivo,
    tipo: null, numero: null, anio: null
  };
}

/* ---------------------------------------------------------------------------
   ÍNDICE OPCIONAL
   --------------------------------------------------------------------------- */

let cacheIndice = { firma: null, datos: {} };

/* Solo texto de verdad: un objeto, un arreglo o un booleano en el índice se
   ignoran (sin esto, `{"a":1}` terminaría escrito como «[object Object]»).
   `admiteNumero` es para el número de la norma, que se escribe tanto "1475"
   como 1475. */
function texto(valor, max, admiteNumero = false) {
  const esTexto = typeof valor === 'string' || (admiteNumero && typeof valor === 'number' && Number.isFinite(valor));
  if (!esTexto) return null;
  const t = String(valor).trim();
  return t ? t.slice(0, max) : null;
}

/** Lee el índice. Cualquier problema → {} y un aviso (una sola vez por cambio del archivo). */
function leerIndice() {
  let stat;
  try {
    stat = fs.statSync(ARCHIVO_INDICE);
  } catch (err) {
    cacheIndice = { firma: 'ausente', datos: {} };
    return cacheIndice.datos;
  }
  const firma = `${stat.mtimeMs}:${stat.size}`;
  if (cacheIndice.firma === firma) return cacheIndice.datos;

  let datos = {};
  try {
    if (!stat.isFile()) throw new Error('indice.json no es un archivo');
    if (stat.size > MAX_BYTES_INDICE) throw new Error(`pesa ${stat.size} bytes (máximo ${MAX_BYTES_INDICE})`);
    const crudo = JSON.parse(fs.readFileSync(ARCHIVO_INDICE, 'utf8').replace(/^﻿/, ''));
    if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) {
      throw new Error('debe ser un objeto { "archivo.pdf": { … } }');
    }
    datos = crudo;
  } catch (err) {
    console.warn(`[legislacion] indice.json ignorado (se usarán los nombres de archivo): ${err.message}`);
    datos = {};
  }
  cacheIndice = { firma, datos };
  return datos;
}

function datosDelIndice(indice, archivo) {
  const f = Object.prototype.hasOwnProperty.call(indice, archivo) ? indice[archivo] : null;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return {};
  const anio = Number.parseInt(f.anio, 10);
  const orden = Number(f.orden);
  return {
    titulo: texto(f.titulo, 250),
    tipo: texto(f.tipo, 40) ? texto(f.tipo, 40).toLowerCase() : null,
    numero: texto(f.numero, 40, true),
    anio: Number.isInteger(anio) && anio >= 1800 && anio <= 2200 ? anio : null,
    descripcion: texto(f.descripcion, 1000),
    orden: f.orden !== undefined && f.orden !== null && f.orden !== '' && Number.isFinite(orden) ? orden : null
  };
}

/* ---------------------------------------------------------------------------
   LISTADO
   --------------------------------------------------------------------------- */

/**
 * Los PDF de la carpeta, sin subcarpetas ni archivos ocultos ni enlaces
 * simbólicos. Carpeta inexistente → lista vacía.
 */
function listarNormas() {
  let entradas;
  try {
    entradas = fs.readdirSync(CARPETA, { withFileTypes: true });
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
      console.warn(`[legislacion] no se pudo leer la carpeta: ${err.code || err.message}`);
    }
    return [];
  }

  const indice = leerIndice();
  const normas = [];
  for (const e of entradas) {
    if (!e.isFile()) continue;                              // fuera carpetas y enlaces
    if (e.name.startsWith('.')) continue;                   // fuera ocultos
    if (path.extname(e.name).toLowerCase() !== '.pdf') continue;
    let stat;
    try { stat = fs.statSync(path.join(CARPETA, e.name)); } catch (err) { continue; }

    const auto = tituloDesdeNombre(e.name);
    const dato = datosDelIndice(indice, e.name);
    normas.push({
      archivo: e.name,
      titulo: dato.titulo || auto.titulo,
      tipo: dato.tipo || auto.tipo,
      numero: dato.numero || auto.numero,
      anio: dato.anio || auto.anio,
      descripcion: dato.descripcion || null,
      orden: dato.orden === undefined ? null : dato.orden,   // null = sin orden propio (nunca undefined: el JSON lo omitiría)
      tamano_bytes: stat.size,
      fecha: stat.mtime.toISOString()
    });
  }

  // Primero lo que el índice ordena, luego lo más reciente, luego por título.
  normas.sort((a, b) => {
    const oa = a.orden === null ? Infinity : a.orden;
    const ob = b.orden === null ? Infinity : b.orden;
    if (oa !== ob) return oa < ob ? -1 : 1;
    const ya = a.anio || 0, yb = b.anio || 0;
    if (ya !== yb) return yb - ya;
    return a.titulo.localeCompare(b.titulo, 'es');
  });
  return normas;
}

router.get('/', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(listarNormas());
  } catch (err) {
    console.error('[legislacion] error listando:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo consultar la legislación.' });
  }
});

/* ---------------------------------------------------------------------------
   ARCHIVO
   --------------------------------------------------------------------------- */

function noEncontrado(res) {
  return res.status(404).json({ error: 'Norma no encontrada.' });
}

router.get('/archivo/:nombre', (req, res) => {
  try {
    const pedido = req.params.nombre;
    // Sin barras, sin barras invertidas, sin bytes nulos y sin cambiar al ser
    // reducido a su nombre base: lo que no sea un nombre simple no existe.
    if (typeof pedido !== 'string' || !pedido
        || pedido !== path.basename(pedido)
        || /[\\/\0]/.test(pedido)
        || path.extname(pedido).toLowerCase() !== '.pdf') {
      return noEncontrado(res);
    }

    // El archivo que se abre es el que salió del directorio, no el que escribió
    // la persona: la comparación es exacta contra el listado actual.
    const norma = listarNormas().find((n) => n.archivo === pedido);
    if (!norma) return noEncontrado(res);

    const descargar = req.query.descargar === '1';
    const nombreSeguro = norma.archivo.replace(/["\\\r\n]/g, '_');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        `${descargar ? 'attachment' : 'inline'}; filename="${nombreSeguro}"; filename*=UTF-8''${encodeURIComponent(norma.archivo)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=0, must-revalidate'
    });
    // sendFile atiende rangos (Range) — el visor del celular lo agradece con PDF grandes.
    res.sendFile(norma.archivo, { root: CARPETA, dotfiles: 'deny', cacheControl: false }, (err) => {
      if (err && !res.headersSent) {
        console.error('[legislacion] error sirviendo archivo:', err.code || err.message);
        res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: 'No se pudo abrir la norma.' });
      }
    });
  } catch (err) {
    console.error('[legislacion] error en archivo:', err.code || err.message);
    if (!res.headersSent) res.status(500).json({ error: 'No se pudo abrir la norma.' });
  }
});

/* Un `%` mal formado en la dirección (p. ej. «%E0%A4%A») hace que Express falle
   al decodificar el parámetro con un 400. Aquí eso es «no existe». */
router.use((err, req, res, next) => {
  if (err && (err instanceof URIError || err.status === 400 || err.statusCode === 400)) {
    return noEncontrado(res);
  }
  return next(err);
});

module.exports = router;
module.exports._tituloDesdeNombre = tituloDesdeNombre;   // para las pruebas
