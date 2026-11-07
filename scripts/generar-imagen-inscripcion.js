#!/usr/bin/env node
/**
 * Genera public/img/inscripcion-og.png: la imagen GENÉRICA de la tarjeta (vista previa) del enlace de
 * inscripción /i/<código>, la que se usa cuando la campaña no tiene logo. Hermana de generar-imagen-ya-voto.js.
 *
 * Uso:   node scripts/generar-imagen-inscripcion.js
 *
 * Sale de un SVG dibujado aquí, con `sharp` (ya viene con el proyecto). La figura es un TRAZO —una persona y un
 * «+»— y no un carácter, para que no dependa de qué tipografía tenga el equipo. Sin logos ni datos de nadie:
 * 1200 × 630, fondo azul de la app, todo dentro del 80 % central porque algunos clientes recortan los bordes.
 */
'use strict';
const path = require('path');
const sharp = require('sharp');

const SALIDA = path.join(__dirname, '..', 'public', 'img', 'inscripcion-og.png');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#131F3B"/>
  <rect x="0" y="0" width="1200" height="14" fill="#FFC300"/>
  <circle cx="560" cy="150" r="52" fill="#FFFFFF"/>
  <path d="M452 306 C452 234 504 204 560 204 C616 204 668 234 668 306 Z" fill="#FFFFFF"/>
  <circle cx="702" cy="176" r="44" fill="#1E8A4F"/>
  <path d="M702 154 V198 M680 176 H724" stroke="#FFFFFF" stroke-width="12" stroke-linecap="round"/>
  <text x="600" y="420" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="82"
        text-anchor="middle" fill="#FFFFFF">SÚMATE AL EQUIPO</text>
  <text x="600" y="508" font-family="DejaVu Sans, Arial, sans-serif" font-size="44"
        text-anchor="middle" fill="#A9BBD4">Inscríbete en menos de 1 minuto</text>
</svg>`;

sharp(Buffer.from(svg)).png({ palette: true, compressionLevel: 9 }).toFile(SALIDA)
  .then((i) => console.log(`${SALIDA}: ${i.width}x${i.height}, ${(i.size / 1024).toFixed(1)} KB`))
  .catch((e) => { console.error(e.message); process.exit(1); });
