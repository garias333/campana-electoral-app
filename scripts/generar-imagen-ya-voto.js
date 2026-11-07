#!/usr/bin/env node
/**
 * Genera public/img/ya-vote-og.png: la imagen de la tarjeta (vista previa) del enlace «Ya voté».
 *
 * Uso:   node scripts/generar-imagen-ya-voto.js
 *
 * POR QUÉ UN GUION Y NO SOLO EL PNG. La imagen sale de un SVG dibujado aquí, con `sharp`
 * (que el proyecto ya trae) y sin ninguna dependencia nueva. Dejarlo escrito permite
 * rehacerla si cambia el color de la app o el texto, sin buscar el original.
 *
 * El ✓ es un TRAZO, no un carácter: no depende de qué tipografía tenga el equipo. El
 * texto sí usa la tipografía del sistema (DejaVu Sans Bold) al rasterizar, pero el PNG
 * resultante es el que se sirve, así que el servidor no necesita ninguna.
 *
 * Sin logos de terceros ni datos de nadie: 1200 × 630 (la proporción que usan WhatsApp y
 * Google Mensajes para la tarjeta grande), fondo azul de la app, ✓ y dos líneas de texto.
 * Todo queda dentro del 80 % central: algunos clientes recortan los bordes.
 */
'use strict';
const path = require('path');
const sharp = require('sharp');

const SALIDA = path.join(__dirname, '..', 'public', 'img', 'ya-vote-og.png');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#131F3B"/>
  <rect x="0" y="0" width="1200" height="14" fill="#FFC300"/>
  <circle cx="600" cy="205" r="125" fill="#1E8A4F"/>
  <polyline points="538,208 580,252 664,156" fill="none" stroke="#FFFFFF" stroke-width="30"
            stroke-linecap="round" stroke-linejoin="round"/>
  <text x="600" y="458" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="132"
        text-anchor="middle" fill="#FFFFFF">YA VOTÉ</text>
  <text x="600" y="535" font-family="DejaVu Sans, Arial, sans-serif" font-size="46"
        text-anchor="middle" fill="#A9BBD4">Toca aquí cuando votes</text>
</svg>`;

sharp(Buffer.from(svg)).png({ palette: true, compressionLevel: 9 }).toFile(SALIDA)
  .then((i) => console.log(`${SALIDA}: ${i.width}x${i.height}, ${(i.size / 1024).toFixed(1)} KB`))
  .catch((e) => { console.error(e.message); process.exit(1); });
