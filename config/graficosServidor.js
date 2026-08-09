/**
 * Versión "de servidor" de los gráficos SVG de barras y dona que ya
 * existen en public/votantes-dashboard.html (construirBarraHorizontal /
 * construirDona) — se usan para el botón Word, que necesita convertir el
 * gráfico en una imagen (ver config/wordExport.js) y por eso no puede
 * depender del navegador ni de variables CSS (--color-marca, etc.): acá
 * los colores van escritos directo en hexadecimal.
 *
 * A propósito casi idénticas a las del frontend (mismas proporciones,
 * mismo criterio de "Otros") para que el gráfico del Word se vea igual
 * que el de pantalla/PDF.
 */

const MAX_FILAS_BARRA = 15;
const MAX_SLICES_DONA = 6;
const COLOR_MARCA = '#0B5ED7';
const COLOR_TEXTO = '#161B26';
const COLORES_SERIE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const COLOR_SERIE_OTROS = '#9AA3AF';

function escaparXml(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatoMillaresServidor(numero) {
  const n = Number(numero) || 0;
  return n.toLocaleString('es-CO');
}

/** Igual que construirBarraHorizontal() del frontend — devuelve null si no hay datos (para que quien llama decida qué hacer). */
function construirBarraHorizontalSvg(datos, color) {
  const filas = (datos || []).slice(0, MAX_FILAS_BARRA);
  if (!filas.length) return null;
  const max = Math.max(...filas.map(f => f.total), 1);
  const altoFila = 30, padVert = 6, anchoEtiqueta = 170, anchoMax = 300;
  const ancho = anchoEtiqueta + anchoMax + 55;
  const alto = altoFila * filas.length + padVert * 2;
  const barras = filas.map((f, i) => {
    const anchoBarra = (anchoMax * f.total) / max;
    const y = padVert + i * altoFila;
    const nombreCorto = f.etiqueta.length > 24 ? f.etiqueta.slice(0, 23) + '…' : f.etiqueta;
    return `
      <text x="${anchoEtiqueta - 8}" y="${y + altoFila / 2 + 4}" font-size="9" fill="${COLOR_TEXTO}" text-anchor="end">${escaparXml(nombreCorto)}</text>
      <rect x="${anchoEtiqueta}" y="${y + 5}" width="${Math.max(anchoBarra, 1)}" height="${altoFila - 10}" rx="3" fill="${color || COLOR_MARCA}"/>
      <text x="${anchoEtiqueta + anchoBarra + 8}" y="${y + altoFila / 2 + 4}" font-size="9" fill="${COLOR_TEXTO}">${formatoMillaresServidor(f.total)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}"><rect width="100%" height="100%" fill="#ffffff"/>${barras}</svg>`;
}

function puntoEnCirculo(cx, cy, r, anguloGrados) {
  const rad = (anguloGrados * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** Igual que construirDona() del frontend, pero con la leyenda dibujada dentro del mismo SVG (a la derecha) en vez de un <div> aparte. */
function construirDonaSvg(datosCompletos) {
  if (!datosCompletos || !datosCompletos.length) return null;
  let datos = datosCompletos.slice(0, MAX_SLICES_DONA);
  const resto = datosCompletos.slice(MAX_SLICES_DONA);
  if (resto.length) {
    datos = datos.concat([{ etiqueta: `Otros (${resto.length})`, total: resto.reduce((a, b) => a + b.total, 0), esOtros: true }]);
  }
  const total = datos.reduce((a, b) => a + b.total, 0) || 1;
  const size = 200, grosor = 34, cx = size / 2, cy = size / 2, r = size / 2 - grosor / 2 - 2;
  let anguloActual = -90;
  const arcos = datos.map((d, i) => {
    const angulo = (d.total / total) * 360;
    const inicio = anguloActual;
    const fin = anguloActual + Math.max(angulo - 1.5, 0.01);
    anguloActual += angulo;
    const largeArc = (fin - inicio) > 180 ? 1 : 0;
    const [x1, y1] = puntoEnCirculo(cx, cy, r, inicio);
    const [x2, y2] = puntoEnCirculo(cx, cy, r, fin);
    const color = d.esOtros ? COLOR_SERIE_OTROS : COLORES_SERIE[i % COLORES_SERIE.length];
    const pct = Math.round((d.total / total) * 100);
    return {
      path: `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${grosor}"/>`,
      color, etiqueta: d.etiqueta, total: d.total, pct
    };
  });
  const anchoLeyenda = 260;
  const anchoTotal = size + anchoLeyenda;
  const altoTotal = Math.max(size, arcos.length * 22 + 10);
  const leyenda = arcos.map((a, i) => {
    const etiquetaCorta = a.etiqueta.length > 26 ? a.etiqueta.slice(0, 25) + '…' : a.etiqueta;
    return `
      <rect x="${size + 15}" y="${10 + i * 22}" width="12" height="12" rx="2" fill="${a.color}"/>
      <text x="${size + 33}" y="${20 + i * 22}" font-size="11" fill="${COLOR_TEXTO}">${escaparXml(etiquetaCorta)}: ${formatoMillaresServidor(a.total)} (${a.pct}%)</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${anchoTotal} ${altoTotal}" width="${anchoTotal}" height="${altoTotal}"><rect width="100%" height="100%" fill="#ffffff"/>${arcos.map(a => a.path).join('')}${leyenda}</svg>`;
}

module.exports = { construirBarraHorizontalSvg, construirDonaSvg, formatoMillaresServidor, COLOR_MARCA };
