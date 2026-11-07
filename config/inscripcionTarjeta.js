/**
 * La TARJETA (vista previa) del enlace /i/<código> cuando se pega en WhatsApp, Telegram o Mensajes (orden 29).
 *
 * ANTES la vista previa decía solo «Inscríbete». Ahora lleva el nombre del candidato, el eslogan y una imagen.
 *
 * QUIEN LA PIDE ES UN ROBOT, no la persona, y la ve cualquiera que mire el celular. Por eso, igual que /v
 * (routes/yaVoto.routes.js): NADA DEL LÍDER entra aquí —ni nombre ni código— y los metadatos son IDÉNTICOS para un
 * código válido, inexistente o desactivado. Lo único que cambia entre campañas es la propia campaña.
 *
 * LA IMAGEN: el logo de la campaña (`configuracion_campana.marca_logo_url`, que ya es público bajo /uploads/marca)
 * si existe; si no, `public/img/inscripcion-og.png`, una imagen genérica hecha como `ya-vote-og.png`. Un logo
 * puede pesar hasta 4 MB y WhatsApp descarta las imágenes grandes, así que no se enlaza el archivo: se sirve
 * una copia de 1200 × 630 en JPEG (`/i/og/imagen`), generada con `sharp` y guardada en memoria.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const pool = require('./db');
const { baseDelSitio } = require('./inscripcionEnlace');

const DESCRIPCION = 'Súmate al equipo. Inscríbete en menos de 1 minuto.';
const CARPETA_MARCA = path.join(__dirname, '..', 'uploads', 'marca');
const GENERICA = path.join(__dirname, '..', 'public', 'img', 'inscripcion-og.png');
const TOPE_IMAGEN = 400 * 1024;   // por encima, WhatsApp suele ignorarla

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const limpio = (t, max) => String(t == null ? '' : t).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

let memoria = { hasta: 0, datos: null };
/** Candidato, eslogan y logo de la campaña, con memoria de 5 minutos: los piden robots, sin sesión. */
async function datosDeLaCampana() {
  if (memoria.datos && Date.now() < memoria.hasta) return memoria.datos;
  let datos = { candidato: '', eslogan: '', logo: '' };
  try {
    const [[c]] = await pool.query(
      'SELECT nombre_candidato, slogan_campana, marca_titulo, marca_subtitulo, marca_logo_url FROM configuracion_campana WHERE id = 1');
    if (c) datos = {
      candidato: limpio(c.nombre_candidato || c.marca_titulo, 80),
      eslogan: limpio(c.slogan_campana || c.marca_subtitulo, 100),
      logo: String(c.marca_logo_url || ''),
    };
  } catch (_) { /* sin datos: la tarjeta sale genérica */ }
  memoria = { hasta: Date.now() + 5 * 60 * 1000, datos };
  return datos;
}

/** El archivo del logo si existe y está en la carpeta pública de la marca; si no, null. Solo el nombre: nada de rutas. */
function archivoDelLogo(logoUrl) {
  if (!String(logoUrl).startsWith('/uploads/marca/')) return null;
  const f = path.join(CARPETA_MARCA, path.basename(logoUrl));
  try { return fs.statSync(f).isFile() ? { ruta: f, version: fs.statSync(f).mtimeMs } : null; } catch (_) { return null; }
}

function tituloDe({ candidato, eslogan }) {
  if (candidato && eslogan) return `${candidato} · ${eslogan}`;
  if (candidato) return `Inscríbete con ${candidato}`;
  return 'Inscríbete con nuestro equipo';
}

/** Los <meta> de la tarjeta. La imagen va con URL ABSOLUTA, del dominio de la licencia (nunca de la cabecera Host). */
async function metasDeLaTarjeta() {
  const d = await datosDeLaCampana();
  const base = baseDelSitio();
  const titulo = tituloDe(d);
  let imagen = '';
  if (base) {
    const logo = archivoDelLogo(d.logo);
    imagen = logo ? `${base}/i/og/imagen?v=${Math.round(logo.version).toString(36)}` : `${base}/img/inscripcion-og.png`;
  }
  return [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(titulo)}">`,
    `<meta property="og:description" content="${esc(DESCRIPCION)}">`,
    `<meta name="description" content="${esc(DESCRIPCION)}">`,
    imagen ? `<meta property="og:image" content="${esc(imagen)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(d.candidato ? 'Inscríbete con ' + d.candidato : 'Inscríbete con nuestro equipo')}">` : '',
    `<meta name="twitter:card" content="summary_large_image">`,
  ].filter(Boolean).join('\n');
}

const FONDO_CLARO = '#ffffff';
const FONDO_OSCURO = '#131F3B';   // el azul de la app: el de ya-vote-og.png e inscripcion-og.png

/**
 * El fondo del lienzo. Un logo con TRANSPARENCIA que es casi todo blanco (como el de la propia plataforma, hecho
 * para fondos oscuros) desaparece sobre blanco: se le pone el azul de la app. Los logos sin transparencia (un
 * JPG o un PNG con su propio fondo) se dejan sobre blanco, tal como vienen.
 */
async function fondoPara(sharp, ruta) {
  try {
    const { data, info } = await sharp(ruta).resize(64, 64, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (!(await sharp(ruta).metadata()).hasAlpha) return FONDO_CLARO;
    let suma = 0, n = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] < 128) continue;                         // lo transparente no cuenta
      suma += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; n++;
    }
    return n && suma / n > 215 ? FONDO_OSCURO : FONDO_CLARO;
  } catch (_) { return FONDO_CLARO; }
}

let imagenEnMemoria = { clave: '', buffer: null };
/**
 * La copia del logo para la tarjeta: 1200 × 630, el logo entero sobre blanco, JPEG. null = usar la genérica
 * (no hay logo, no se puede leer, o la copia pesa demasiado aun con la calidad más baja).
 */
async function imagenDelLogo() {
  const d = await datosDeLaCampana();
  const logo = archivoDelLogo(d.logo);
  if (!logo) return null;
  const clave = `${logo.ruta}|${logo.version}`;
  if (imagenEnMemoria.clave === clave) return imagenEnMemoria.buffer;
  let buffer = null;
  try {
    const sharp = require('sharp');
    // El logo entero (hasta 1000 × 480), centrado sobre un lienzo blanco de 1200 × 630. En DOS pasos: en una sola
    // cadena `sharp` aplica el «resize» antes que el «extend» sin importar el orden en que se escriban.
    const fondo = await fondoPara(sharp, logo.ruta);
    const interior = await sharp(logo.ruta).rotate()
      .resize(1000, 480, { fit: 'inside' }).flatten({ background: fondo }).png().toBuffer();
    for (const calidad of [85, 70, 55]) {
      const b = await sharp({ create: { width: 1200, height: 630, channels: 3, background: fondo } })
        .composite([{ input: interior, gravity: 'center' }])
        .jpeg({ quality: calidad }).toBuffer();
      if (b.length <= TOPE_IMAGEN) { buffer = b; break; }
    }
  } catch (err) {
    console.warn('Tarjeta de inscripción: no se pudo preparar el logo:', String(err && err.message).slice(0, 100));
  }
  imagenEnMemoria = { clave, buffer };
  return buffer;
}

module.exports = {
  metasDeLaTarjeta, imagenDelLogo, tituloDe, DESCRIPCION, GENERICA,
  limpiarMemoria: () => { memoria = { hasta: 0, datos: null }; imagenEnMemoria = { clave: '', buffer: null }; },
};
