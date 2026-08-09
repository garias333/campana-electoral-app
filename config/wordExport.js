/**
 * Helpers compartidos para armar documentos Word (.docx) — usados por el
 * botón "Word" del Dashboard de votantes y del Organigrama. Misma idea que
 * ya existe para Excel (XLSX) y PDF (imprimir con estilos), pero acá con
 * la librería "docx": arma el documento por completo en el servidor
 * (encabezado/pie de marca, título, gráficos como imagen y tablas).
 *
 * Los gráficos (barras/dona) no se pueden "copiar" del navegador tal cual
 * — Word no entiende SVG ni variables CSS — así que se vuelven a dibujar
 * en el servidor (ver config/graficosServidor.js) a partir de los mismos
 * datos, y esta imagen ya lista (PNG) se incrusta en el documento.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  Header, Footer, WidthType, AlignmentType, ShadingType, HeadingLevel
} = require('docx');
const { construirBarraHorizontalSvg, construirDonaSvg } = require('./graficosServidor');

const RUTA_ENCABEZADO = path.join(__dirname, '..', 'public', 'encabezado.png');
const RUTA_PIE = path.join(__dirname, '..', 'public', 'pie-de-pagina.png');
const ANCHO_PAGINA_PX = 620; // ancho útil aprox. de una hoja carta con márgenes normales, a 96dpi (para gráficos/tablas del CONTENIDO)
const COLOR_MARCA_HEX = '0B5ED7';

// Hoja carta en twips (unidad de Word: 1 pulgada = 1440 twips) y su ancho
// completo en píxeles (a 96dpi) — se usan para que el encabezado/pie
// lleguen de verdad al borde físico de la hoja (arriba, abajo, izquierda y
// derecha), igual que ya hace la versión PDF/impresión, en vez de quedar
// encerrados dentro del margen del cuerpo del documento.
const PAGINA_ANCHO_TWIPS = 12240; // 8.5"
const PAGINA_ALTO_TWIPS = 15840; // 11"
const ANCHO_PAGINA_COMPLETA_PX = 816; // 8.5" a 96dpi
const MARGEN_LATERAL_TWIPS = 1440; // 1" — margen izquierdo/derecho del cuerpo (ancho de lectura normal)
// Margen superior/inferior del CUERPO: un poco más de 1" a propósito —
// tiene que ser más alto que la imagen del encabezado/pie (~1590/1575
// twips a este ancho de hoja) para que el título/tabla nunca arranquen
// tapados por esa imagen, ya que el encabezado/pie quedan a distancia 0
// del borde físico (ver margin.header/footer en generarDocumentoWord).
const MARGEN_VERTICAL_TWIPS = 1750;

/** Convierte un SVG (string) a PNG (Buffer) — sharp/librsvg hace la conversión real. */
async function svgAPngBuffer(svgString) {
  return sharp(Buffer.from(svgString)).png().toBuffer();
}

/**
 * Arma el <Header>/<Footer> de marca (mismas imágenes que usan los PDF) —
 * se repiten en cada hoja del Word automáticamente, eso lo maneja Word solo.
 *
 * Para que la imagen llegue de verdad a los 4 bordes físicos de la hoja
 * (no solo arriba/abajo, sino también izquierda/derecha): la distancia del
 * encabezado/pie al borde se deja en 0 (ver margin.header/footer en
 * generarDocumentoWord) y el párrafo que contiene la imagen se "saca" del
 * margen izquierdo/derecho del cuerpo con sangría NEGATIVA — así el ancho
 * de la imagen puede ser el de la hoja completa en vez del área de
 * contenido, y arranca desde el borde en vez de desde el margen.
 */
function encabezadoYPiePagina() {
  const encabezadoBuf = fs.readFileSync(RUTA_ENCABEZADO);
  const pieBuf = fs.readFileSync(RUTA_PIE);
  // Proporciones reales de los archivos (2550x331 y 2550x327) — se
  // recalculan acá para no depender de detectarlas en cada exportación.
  const altoEncabezado = Math.round(ANCHO_PAGINA_COMPLETA_PX * (331 / 2550));
  const altoPie = Math.round(ANCHO_PAGINA_COMPLETA_PX * (327 / 2550));
  const sangriaBorde = { left: -MARGEN_LATERAL_TWIPS, right: -MARGEN_LATERAL_TWIPS };
  return {
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          indent: sangriaBorde,
          spacing: { before: 0, after: 0 },
          children: [new ImageRun({ type: 'png', data: encabezadoBuf, transformation: { width: ANCHO_PAGINA_COMPLETA_PX, height: altoEncabezado } })]
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          indent: sangriaBorde,
          spacing: { before: 0, after: 0 },
          children: [new ImageRun({ type: 'png', data: pieBuf, transformation: { width: ANCHO_PAGINA_COMPLETA_PX, height: altoPie } })]
        })]
      })
    }
  };
}

/** Tabla genérica: columnas = arreglo de encabezados; filas = arreglo de arreglos (mismo orden que columnas). */
function construirTablaDocx(columnas, filas) {
  const filaEncabezado = new TableRow({
    tableHeader: true,
    children: columnas.map(c => new TableCell({
      shading: { type: ShadingType.CLEAR, fill: COLOR_MARCA_HEX },
      children: [new Paragraph({ children: [new TextRun({ text: String(c), bold: true, color: 'FFFFFF', size: 18 })] })]
    }))
  });
  const filasDatos = filas.map(fila => new TableRow({
    children: fila.map(valor => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: valor === null || valor === undefined || valor === '' ? '—' : String(valor), size: 18 })] })]
    }))
  }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [filaEncabezado, ...filasDatos] });
}

/**
 * Arma los párrafos de UNA sección (título + gráfico opcional + tabla) —
 * es el bloque que se repite para Por Comuna/Barrio/Líder/Puesto/Mesa.
 * tipoGrafico: 'barra' | 'dona' | null (sin gráfico, ej. Cobertura territorial).
 */
async function construirBloqueSeccion({ titulo, subtitulo, tipoGrafico, datosGrafico, colorBarra, columnas, filas }) {
  const bloques = [];
  bloques.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200 }, children: [new TextRun(titulo)] }));
  if (subtitulo) {
    bloques.push(new Paragraph({ children: [new TextRun({ text: subtitulo, italics: true, color: '5B6472', size: 18 })] }));
  }

  if (tipoGrafico && datosGrafico && datosGrafico.length) {
    const svg = tipoGrafico === 'dona' ? construirDonaSvg(datosGrafico) : construirBarraHorizontalSvg(datosGrafico, colorBarra);
    if (svg) {
      const png = await svgAPngBuffer(svg);
      const meta = await sharp(png).metadata();
      const anchoFinal = Math.min(ANCHO_PAGINA_PX, meta.width);
      const altoFinal = Math.round(anchoFinal * (meta.height / meta.width));
      bloques.push(new Paragraph({ spacing: { before: 120, after: 120 }, children: [new ImageRun({ type: 'png', data: png, transformation: { width: anchoFinal, height: altoFinal } })] }));
    }
  }

  if (filas && filas.length) {
    bloques.push(construirTablaDocx(columnas, filas));
  } else {
    bloques.push(new Paragraph({ children: [new TextRun({ text: 'Sin datos para este filtro.', color: '5B6472' })] }));
  }
  bloques.push(new Paragraph({ text: '' }));
  return bloques;
}

/** Arma y devuelve el .docx completo (Buffer) — título + subtítulo + N secciones (cada una ya armada con construirBloqueSeccion). */
async function generarDocumentoWord({ titulo, subtitulo, secciones }) {
  const children = [
    new Paragraph({ children: [new TextRun({ text: titulo, bold: true, size: 32 })] })
  ];
  if (subtitulo) {
    children.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: subtitulo, size: 20, color: '5B6472' })] }));
  }
  for (const bloque of secciones) {
    children.push(...bloque);
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: PAGINA_ANCHO_TWIPS, height: PAGINA_ALTO_TWIPS },
          margin: {
            top: MARGEN_VERTICAL_TWIPS, bottom: MARGEN_VERTICAL_TWIPS,
            left: MARGEN_LATERAL_TWIPS, right: MARGEN_LATERAL_TWIPS,
            // Distancia 0 = el encabezado/pie arrancan justo en el borde
            // físico de la hoja (no dentro del margen del cuerpo).
            header: 0, footer: 0
          }
        }
      },
      ...encabezadoYPiePagina(),
      children
    }]
  });
  return Packer.toBuffer(doc);
}

module.exports = { generarDocumentoWord, construirBloqueSeccion, construirTablaDocx, svgAPngBuffer };
