/**
 * LOS MANUALES DE AYUDA: contenido en archivos, armado en el servidor.
 *
 * Cada «bloque» es un archivo Markdown de `manuales/bloques/` con una cabecera de metadatos (ver `manuales/LEEME.md`). El
 * manual de cada persona se arma al pedirlo, mostrando SOLO los bloques que sus permisos permiten. El texto se convierte a
 * HTML aquí, con un convertidor propio y mínimo que ESCAPA todo: lo único que sale como etiqueta es lo que este archivo
 * genera. No hay dependencias nuevas.
 *
 * AL CARGAR SE VALIDA TODO, y lo que no cuadra se avisa en el log y se OMITE; nunca tumba la aplicación:
 *   · ids repetidos (queda el primero);
 *   · `modulo` que no existe en la matriz de permisos (routes/permisos.routes.js);
 *   · `nivel` inválido, o `importar` en un módulo sin importar/exportar (config/importarExportar.js);
 *   · bloque sin módulo y sin `roles`;
 *   · `ruta` cuyo último paso no es una entrada real de menú (NAV_ITEMS de public/js/common.js o los menús de
 *     public/app/inicio.html). Se lee de esos archivos, no de una copia: si se renombra una entrada, el bloque lo avisa.
 *
 * QUIÉN VE QUÉ (`bloquesVisibles`):
 *   · bloque con `modulo`: sale si el usuario tiene «Ver» en ese módulo Y el nivel que el bloque pide (editar, agregar,
 *     importar/exportar). Sin «Ver» no se ofrece nada de ese módulo: la pantalla ni siquiera está en su menú.
 *   · bloque sin `modulo`: sale según `roles` (`todos`, o la lista). El aspirante con sublicencia cuenta como `aspirante` y
 *     también como su rol de fila, `lider`.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { moduloTieneImportarExportar } = require('../config/importarExportar');
const { CLAVES: CLAVES_COMPLEMENTO, complementoDelModulo } = require('./complementos');

const RAIZ = path.join(__dirname, '..', 'manuales');
const DIR_BLOQUES = path.join(RAIZ, 'bloques');
const DIR_INSTALACION = path.join(RAIZ, 'instalacion');
/** Las capturas de pantalla de las guías (scripts/capturar-manuales.js las rehace). Se sirven como archivos estáticos desde /manuales/img/. */
const DIR_IMG = path.join(__dirname, '..', 'public', 'manuales', 'img');
const PESO_MAXIMO_CAPTURA = 150 * 1024;

const SECCIONES = {
  basicos: 'Primeros pasos',
  antes: 'Antes: preparar la campaña',
  durante: 'Durante: el trabajo de cada día',
  'dia-d': 'El Día D',
  administracion: 'Administración',
  faq: 'Preguntas frecuentes',
  glosario: 'Glosario',
};
const ORDEN_SECCIONES = ['basicos', 'antes', 'durante', 'dia-d', 'administracion', 'faq', 'glosario'];

/** Los íconos del sprite de public/ayuda.html. Un nombre que no esté aquí se cambia por `lista` y se avisa. */
const ICONOS = ['inicio', 'persona', 'personas', 'organigrama', 'mapa', 'calendario', 'grafico', 'mensaje', 'correo', 'sms',
  'campana', 'moneda', 'documento', 'carpeta', 'llave', 'escudo', 'candado', 'engranaje', 'urna', 'alerta', 'camion', 'comida',
  'ubicacion', 'qr', 'enlace', 'reloj', 'check', 'ayuda', 'buscar', 'imprimir', 'celular', 'pc', 'descargar', 'subir',
  'estrella', 'libro', 'balanza', 'bandera', 'telefono', 'foto', 'lista', 'flecha', 'basura', 'respaldo', 'megafono'];

const NIVELES = ['ver', 'editar', 'agregar', 'importar'];
const ROLES_VALIDOS = ['admin', 'coordinador', 'lider', 'sublider', 'testigo', 'usuario', 'asistente_administrativo',
  'administrativo', 'invitado', 'aspirante'];

/** Los manuales que el administrador puede abrir, con su nombre y para quién son. */
const MANUALES_POR_ROL = {
  admin: { titulo: 'Manual del administrador', descripcion: 'Control de la campaña: usuarios, permisos, configuración y todos los módulos.', icono: 'llave' },
  coordinador: { titulo: 'Manual del coordinador', descripcion: 'Supervisión de tu zona y tu equipo: territorio, votantes, mensajes y Día D.', icono: 'bandera' },
  lider: { titulo: 'Manual del líder', descripcion: 'Registro y seguimiento de tu gente en el territorio que te asignaron.', icono: 'persona' },
  sublider: { titulo: 'Manual del sublíder', descripcion: 'Registro de las personas que refieres para tu líder.', icono: 'personas' },
  testigo: { titulo: 'Manual del testigo', descripcion: 'Tu trabajo el día de la elección: llegar a tu puesto y reportar tu mesa.', icono: 'urna' },
  usuario: { titulo: 'Manual del usuario', descripcion: 'Acceso operativo básico dentro de la estructura de la campaña.', icono: 'inicio' },
  asistente_administrativo: { titulo: 'Manual del asistente administrativo', descripcion: 'Apoyo administrativo: datos, mensajes y finanzas, sin la configuración más delicada.', icono: 'documento' },
  administrativo: { titulo: 'Manual del perfil administrativo', descripcion: 'Verás los módulos que el administrador te asigne.', icono: 'carpeta' },
  invitado: { titulo: 'Manual del invitado', descripcion: 'Consulta de la información pública de la campaña.', icono: 'ayuda' },
  aspirante: { titulo: 'Manual del aspirante', descripcion: 'Tu campaña con sublicencia: tu gente, tus testigos y tu Día D.', icono: 'estrella' },
};
const INSTALACION = { titulo: 'Manual de instalación', descripcion: 'Cómo instalar y mantener el servidor de la aplicación (para quien lo administra).', icono: 'engranaje' };

// ---------------------------------------------------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------------------------------------------------

/** Mide un WebP leyendo solo su cabecera (VP8, VP8L o VP8X): lo justo para reservar el espacio de la imagen y saber si es de celular. */
function medirWebp(buf) {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const tipo = buf.toString('ascii', 12, 16);
  if (tipo === 'VP8 ') return { ancho: buf.readUInt16LE(26) & 0x3fff, alto: buf.readUInt16LE(28) & 0x3fff };
  if (tipo === 'VP8L') { const b = buf.readUInt32LE(21); return { ancho: (b & 0x3fff) + 1, alto: ((b >> 14) & 0x3fff) + 1 }; }
  if (tipo === 'VP8X') return { ancho: 1 + buf.readUIntLE(24, 3), alto: 1 + buf.readUIntLE(27, 3) };
  return null;
}

/**
 * `captura:` de la cabecera → [{ archivo, ancho, alto, celular }]. Una lista separada por comas (a lo más dos por guía). Una captura que no
 * existe, que no es WebP o que pesa más de 150 KB se AVISA y se omite: la guía sale igual, sin ella.
 */
function leerCapturas(valor, donde, avisos) {
  const salida = [];
  String(valor || '').split(',').map((x) => x.trim()).filter(Boolean).forEach((archivo) => {
    if (!/^[a-z0-9][a-z0-9_-]*\.webp$/.test(archivo)) { avisos.push(`${donde}: captura «${archivo}» no es un nombre .webp válido; se omite`); return; }
    let buf;
    try { buf = fs.readFileSync(path.join(DIR_IMG, archivo)); } catch (_) { avisos.push(`${donde}: la captura «${archivo}» no existe en public/manuales/img/; se omite`); return; }
    if (buf.length > PESO_MAXIMO_CAPTURA) { avisos.push(`${donde}: la captura «${archivo}» pesa ${Math.round(buf.length / 1024)} KB (el tope es 150); se omite`); return; }
    const m = medirWebp(buf);
    if (!m) { avisos.push(`${donde}: «${archivo}» no es un WebP legible; se omite`); return; }
    salida.push({ archivo, ancho: m.ancho, alto: m.alto, celular: m.ancho <= 800 });
  });
  if (salida.length > 2) { avisos.push(`${donde}: más de dos capturas; se usan las dos primeras`); salida.length = 2; }
  return salida;
}

function escapar(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sinTildes(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Marcas en línea. TODO el texto se escapa primero; después solo se reconocen las marcas de abajo. */
function enLinea(texto, ctx) {
  const partes = String(texto).split(/(`[^`]+`)/g);
  return partes.map((p, i) => {
    if (i % 2 === 1) return `<code>${escapar(p.slice(1, -1))}</code>`;
    let h = escapar(p);
    h = h.replace(/\[\[([^\]]+)\]\]/g, (_, b) => `<span class="boton-app">${b}</span>`);
    h = h.replace(/\{\{([a-z0-9][a-z0-9_-]*)\}\}/g, (_, id) => {
      const titulo = ctx && ctx.titulos && ctx.titulos.get(id);
      if (!titulo) return '';
      return `<a class="ref-bloque" href="#b-${id}" data-ref="${id}">Ver: ${escapar(titulo)}</a>`;
    });
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    return h;
  }).join('');
}

const ETIQUETA_LLAMADO = { consejo: 'Consejo', importante: 'Importante', cuidado: 'Cuidado', listo: 'Así sabes que funcionó' };

/** Markdown mínimo → HTML. Títulos (## y ###), párrafos, listas, tablas, código, recuadros ::: tipo. */
function renderMarkdown(fuente, ctx, dentroDeLlamado) {
  const lineas = String(fuente).replace(/\r\n?/g, '\n').split('\n');
  const salida = [];
  let i = 0;
  const esEspecial = (l) => /^```/.test(l) || /^:::\s*[a-z]+\s*$/.test(l) || /^#{2,3}\s/.test(l) || /^\s*\d+\.\s+/.test(l)
    || /^\s*[-*]\s+/.test(l) || /^\s*\|/.test(l);

  while (i < lineas.length) {
    const l = lineas[i];
    if (!l.trim()) { i++; continue; }

    if (/^```/.test(l)) {
      const codigo = [];
      i++;
      while (i < lineas.length && !/^```/.test(lineas[i])) { codigo.push(lineas[i]); i++; }
      i++;
      salida.push(`<pre class="codigo"><code>${escapar(codigo.join('\n'))}</code></pre>`);
      continue;
    }

    let m = l.match(/^:::\s*([a-z]+)\s*$/);
    if (m && !dentroDeLlamado) {
      const tipo = ETIQUETA_LLAMADO[m[1]] ? m[1] : 'consejo';
      const cuerpo = [];
      i++;
      while (i < lineas.length && !/^:::\s*$/.test(lineas[i])) { cuerpo.push(lineas[i]); i++; }
      i++;
      salida.push(`<div class="llamado llamado-${tipo}"><div class="llamado-titulo">${ETIQUETA_LLAMADO[tipo]}</div>`
        + `<div class="llamado-cuerpo">${renderMarkdown(cuerpo.join('\n'), ctx, true)}</div></div>`);
      continue;
    }

    m = l.match(/^(#{2,3})\s+(.*)$/);
    if (m) {
      const nivel = m[1].length + 1;   // el título del bloque es h2
      salida.push(`<h${nivel}>${enLinea(m[2].trim(), ctx)}</h${nivel}>`);
      i++;
      continue;
    }

    if (/^\s*\|/.test(l)) {
      const filas = [];
      while (i < lineas.length && /^\s*\|/.test(lineas[i])) { filas.push(lineas[i]); i++; }
      const celdas = (f) => f.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const hayCabecera = filas.length > 1 && /^\s*\|?[\s:-]+(\|[\s:-]+)+\|?\s*$/.test(filas[1]);
      const cabecera = hayCabecera ? celdas(filas[0]) : null;
      const cuerpo = (hayCabecera ? filas.slice(2) : filas).map(celdas);
      salida.push('<div class="tabla-manual"><table>'
        + (cabecera ? `<thead><tr>${cabecera.map((c) => `<th>${enLinea(c, ctx)}</th>`).join('')}</tr></thead>` : '')
        + `<tbody>${cuerpo.map((f) => `<tr>${f.map((c) => `<td>${enLinea(c, ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(l)) {
      const items = [];
      while (i < lineas.length && /^\s*\d+\.\s+/.test(lineas[i])) {
        let t = lineas[i].replace(/^\s*\d+\.\s+/, '');
        i++;
        // Continuación del mismo paso: líneas con sangría.
        while (i < lineas.length && /^\s{2,}\S/.test(lineas[i]) && !/^\s*\d+\.\s+/.test(lineas[i])) { t += ' ' + lineas[i].trim(); i++; }
        items.push(t);
      }
      salida.push(`<ol class="pasos">${items.map((t) => `<li>${enLinea(t, ctx)}</li>`).join('')}</ol>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(l)) {
      const items = [];
      while (i < lineas.length && /^\s*[-*]\s+/.test(lineas[i])) {
        let t = lineas[i].replace(/^\s*[-*]\s+/, '');
        i++;
        while (i < lineas.length && /^\s{2,}\S/.test(lineas[i]) && !/^\s*[-*]\s+/.test(lineas[i])) { t += ' ' + lineas[i].trim(); i++; }
        items.push(t);
      }
      salida.push(`<ul>${items.map((t) => `<li>${enLinea(t, ctx)}</li>`).join('')}</ul>`);
      continue;
    }

    const parrafo = [];
    while (i < lineas.length && lineas[i].trim() && !(parrafo.length && esEspecial(lineas[i]))) { parrafo.push(lineas[i].trim()); i++; }
    salida.push(`<p>${enLinea(parrafo.join(' '), ctx)}</p>`);
  }
  return salida.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// Archivos
// ---------------------------------------------------------------------------------------------------------------------

/** Cabecera `---\nclave: valor\n---` + cuerpo. Devuelve `{ meta, cuerpo }` o lanza con un motivo legible. */
function partirArchivo(contenido) {
  const t = String(contenido).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!t.startsWith('---\n')) throw new Error('falta la cabecera «---»');
  const cierre = t.indexOf('\n---', 4);
  if (cierre === -1) throw new Error('la cabecera no cierra con «---»');
  const meta = {};
  t.slice(4, cierre).split('\n').forEach((linea) => {
    if (!linea.trim()) return;
    const k = linea.indexOf(':');
    if (k < 1) throw new Error(`línea de cabecera sin «clave: valor»: «${linea.slice(0, 40)}»`);
    meta[linea.slice(0, k).trim()] = linea.slice(k + 1).trim();
  });
  return { meta, cuerpo: t.slice(cierre + 4).replace(/^\n/, '') };
}

function listarMd(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch (_) { return []; }
}

/** Las etiquetas reales de menú, leídas de los archivos que las dibujan (nada copiado). */
function etiquetasDeMenu() {
  const etiquetas = new Set();
  const leer = (archivo, re) => {
    try {
      const t = fs.readFileSync(path.join(__dirname, '..', archivo), 'utf8');
      let m;
      while ((m = re.exec(t))) etiquetas.add(sinTildes(m[1]));
    } catch (_) { /* sin el archivo no se valida la ruta de nadie: se avisa abajo */ }
  };
  leer('public/js/common.js', /\b(?:texto|grupo):\s*'([^']+)'/g);
  leer('public/app/inicio.html', /\btitulo:\s*'([^']+)'/g);
  return etiquetas;
}

/** `ruta` → [{ plataforma, pasos[] }]. Una o dos alternativas separadas por « | ». */
function leerRuta(valor) {
  if (!valor) return [];
  return valor.split(/\s+\|\s+/).map((alt) => {
    let plataforma = '';
    const m = alt.match(/^(Escritorio|Celular):\s*(.*)$/);
    if (m) { plataforma = m[1]; alt = m[2]; }
    return { plataforma, pasos: alt.split(/\s+>\s+/).map((s) => s.trim()).filter(Boolean) };
  }).filter((r) => r.pasos.length);
}

function listaDe(valor) {
  return String(valor || '').split(',').map((s) => s.trim()).filter(Boolean);
}

let _modulosCache = null;
function catalogoDeModulos() {
  // Se pide aquí y no arriba: permisos.routes.js carga la base de datos, y este archivo se puede usar sin ella.
  if (!_modulosCache) {
    const { MODULOS } = require('../routes/permisos.routes');
    _modulosCache = new Map(MODULOS.map((m) => [m.clave, m.etiqueta]));
  }
  return _modulosCache;
}

/**
 * Lee y valida todos los bloques de un directorio.
 * @returns {{ bloques: object[], avisos: string[] }}
 */
function cargarDirectorio(dir, { instalacion = false, modulos } = {}) {
  const avisos = [];
  const bloques = [];
  const vistos = new Set();
  const etiquetas = etiquetasDeMenu();
  if (!etiquetas.size) avisos.push('no se pudieron leer las etiquetas de menú: no se validaron las rutas');

  for (const archivo of listarMd(dir)) {
    const donde = `${path.basename(dir)}/${archivo}`;
    let meta; let cuerpo;
    try {
      ({ meta, cuerpo } = partirArchivo(fs.readFileSync(path.join(dir, archivo), 'utf8')));
    } catch (err) { avisos.push(`${donde}: ${err.message}; se omite`); continue; }

    const id = meta.id || '';
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) { avisos.push(`${donde}: id inválido «${id}»; se omite`); continue; }
    if (id + '.md' !== archivo) { avisos.push(`${donde}: el id «${id}» no coincide con el nombre del archivo; se omite`); continue; }
    if (vistos.has(id)) { avisos.push(`${donde}: id repetido «${id}»; se omite`); continue; }
    if (!meta.titulo) { avisos.push(`${donde}: sin titulo; se omite`); continue; }
    const seccion = instalacion ? 'instalacion' : meta.seccion;
    if (!instalacion && !SECCIONES[seccion]) { avisos.push(`${donde}: seccion «${meta.seccion}» no existe; se omite`); continue; }
    if (instalacion && meta.seccion && meta.seccion !== 'instalacion') { avisos.push(`${donde}: seccion «${meta.seccion}» no es «instalacion»; se omite`); continue; }
    const orden = Number(meta.orden);
    if (!Number.isFinite(orden)) { avisos.push(`${donde}: orden no numérico; se omite`); continue; }

    // `complemento` (parche 318, Activar complementos): el bloque solo sale si ese complemento está ENCENDIDO. Los bloques con `modulo` de un complemento ya
    // dependen de él sin decirlo (ver `bloquesVisibles`); esta clave es para los que van por otro módulo o por roles (p. ej. «¿Cómo marco que necesita transporte?»).
    const complemento = meta.complemento || '';
    if (complemento && !CLAVES_COMPLEMENTO.includes(complemento)) { avisos.push(`${donde}: el complemento «${complemento}» no existe; se omite`); continue; }
    const modulo = meta.modulo || '';
    const nivel = modulo ? (meta.nivel || 'ver') : '';
    const roles = modulo ? [] : listaDe(meta.roles);
    if (modulo) {
      if (!modulos.has(modulo)) { avisos.push(`${donde}: el módulo «${modulo}» no existe en la matriz de permisos; se omite`); continue; }
      if (!NIVELES.includes(nivel)) { avisos.push(`${donde}: nivel «${nivel}» inválido; se omite`); continue; }
      if (nivel === 'importar' && !moduloTieneImportarExportar(modulo)) { avisos.push(`${donde}: «importar» en un módulo sin importar/exportar («${modulo}»); se omite`); continue; }
      if (meta.roles) avisos.push(`${donde}: tiene módulo y roles a la vez; se ignoran los roles`);
    } else {
      if (!roles.length) { avisos.push(`${donde}: sin módulo y sin roles; se omite`); continue; }
      const malo = roles.find((r) => r !== 'todos' && !ROLES_VALIDOS.includes(r));
      if (malo) { avisos.push(`${donde}: rol «${malo}» desconocido; se omite`); continue; }
    }

    const ruta = leerRuta(meta.ruta);
    if (etiquetas.size) {
      const sinMenu = ruta.find((r) => !etiquetas.has(sinTildes(r.pasos[r.pasos.length - 1])));
      if (sinMenu) { avisos.push(`${donde}: la ruta «${sinMenu.pasos.join(' > ')}» no termina en una entrada real de menú; se omite`); continue; }
    }

    let icono = meta.icono || 'lista';
    if (!ICONOS.includes(icono)) { avisos.push(`${donde}: ícono «${icono}» no existe; se usa «lista»`); icono = 'lista'; }

    vistos.add(id);
    bloques.push({
      id, titulo: meta.titulo, seccion, orden, icono, modulo, nivel, roles, ruta, complemento,
      captura: meta.captura || '', capturas: leerCapturas(meta.captura, donde, avisos), cuerpo,
    });
  }

  // Referencias {{id}} a bloques que no existen: se avisa (se pintan como nada).
  const ids = new Set(bloques.map((b) => b.id));
  bloques.forEach((b) => {
    for (const m of b.cuerpo.matchAll(/\{\{([a-z0-9][a-z0-9_-]*)\}\}/g)) {
      if (!ids.has(m[1])) avisos.push(`${path.basename(dir)}/${b.id}.md: la referencia {{${m[1]}}} no existe`);
    }
  });
  return { bloques, avisos };
}

// ---------------------------------------------------------------------------------------------------------------------
// Estado en memoria (se recarga solo si cambió algún archivo)
// ---------------------------------------------------------------------------------------------------------------------

let estado = null;

function firmaDeArchivos() {
  const partes = [];
  let masNuevo = 0;
  for (const dir of [DIR_BLOQUES, DIR_INSTALACION]) {
    for (const f of listarMd(dir)) {
      try {
        const s = fs.statSync(path.join(dir, f));
        partes.push(`${dir}/${f}:${s.mtimeMs}:${s.size}`);
        if (s.mtimeMs > masNuevo) masNuevo = s.mtimeMs;
      } catch (_) { /* desapareció entre el listado y la lectura */ }
    }
  }
  // Las capturas también cuentan: si se rehacen, el manual se recarga y su fecha se mueve.
  try {
    for (const f of fs.readdirSync(DIR_IMG)) {
      if (!f.endsWith('.webp')) continue;
      const s = fs.statSync(path.join(DIR_IMG, f));
      partes.push(`img/${f}:${s.mtimeMs}:${s.size}`);
      if (s.mtimeMs > masNuevo) masNuevo = s.mtimeMs;
    }
  } catch (_) { /* sin carpeta de capturas: las guías salen sin imagen */ }
  try { masNuevo = Math.max(masNuevo, fs.statSync(path.join(RAIZ, 'LEEME.md')).mtimeMs); } catch (_) { /* opcional */ }
  return { firma: partes.join('|'), masNuevo };
}

function fechaDelContenido(ms) {
  if (!ms) return null;
  // En hora de Colombia, que es la de las personas que leen.
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

function cargar({ forzar = false, silencioso = false } = {}) {
  const { firma, masNuevo } = firmaDeArchivos();
  if (!forzar && estado && estado.firma === firma) return estado;

  const modulos = catalogoDeModulos();
  const a = cargarDirectorio(DIR_BLOQUES, { modulos });
  const b = cargarDirectorio(DIR_INSTALACION, { instalacion: true, modulos });
  const todos = [...a.bloques, ...b.bloques];
  const titulos = new Map(todos.map((x) => [x.id, x.titulo]));
  // Un id no puede repetirse entre los dos directorios tampoco.
  const avisos = [...a.avisos, ...b.avisos];
  const contexto = { titulos };
  const preparar = (x) => ({ ...x, html: renderMarkdown(x.cuerpo, contexto), etiqueta_modulo: x.modulo ? modulos.get(x.modulo) : '' });
  const bloques = a.bloques.map(preparar).sort(comparar);
  const instalacion = b.bloques.map(preparar).sort(comparar);
  // Los ids repetidos entre directorios.
  const idsA = new Set(bloques.map((x) => x.id));
  instalacion.forEach((x) => { if (idsA.has(x.id)) avisos.push(`manuales: id «${x.id}» repetido entre bloques/ e instalacion/`); });

  estado = { firma, bloques, instalacion, avisos, fecha: fechaDelContenido(masNuevo), cargadoEn: Date.now() };
  if (!silencioso) {
    if (avisos.length) {
      console.warn(`Manuales: ${avisos.length} aviso(s) al validar los bloques (los que fallan se omiten):`);
      avisos.forEach((m) => console.warn('  · ' + m));
    }
    console.log(`Manuales: ${bloques.length} bloques y ${instalacion.length} de instalación cargados.`);
  }
  return estado;
}

function comparar(x, y) {
  return (ORDEN_SECCIONES.indexOf(x.seccion) - ORDEN_SECCIONES.indexOf(y.seccion)) || (x.orden - y.orden) || x.id.localeCompare(y.id);
}

// ---------------------------------------------------------------------------------------------------------------------
// Permisos → bloques
// ---------------------------------------------------------------------------------------------------------------------

/** ¿Tiene este usuario ese nivel en ese módulo? Sin «Ver» no hay nada de ese módulo. */
function tieneNivel(permisos, modulo, nivel) {
  const p = permisos && permisos[modulo];
  if (!p || !p.ver) return false;
  if (nivel === 'ver') return true;
  if (nivel === 'editar') return !!p.editar;
  if (nivel === 'agregar') return !!p.agregar;
  if (nivel === 'importar') return !!p.importar_exportar;
  return false;
}

/**
 * @param {object[]} bloques
 * @param {{ permisos: object, roles: Set<string> }} perfil
 */
function bloquesVisibles(bloques, perfil) {
  /* ACTIVAR COMPLEMENTOS (parche 318): `perfil.complementos` es { clave: true|false }. Un bloque de un complemento APAGADO no sale para nadie, el administrador
     incluido: ni los `mod-*` (cuyo módulo cuelga de un complemento) ni los que declaran `complemento:`. Sin `perfil.complementos` se toma todo como apagado
     (falla cerrado). */
  const activos = (perfil && perfil.complementos) || {};
  return bloques.filter((b) => {
    if (b.complemento && activos[b.complemento] !== true) return false;
    const dueno = b.modulo ? complementoDelModulo(b.modulo) : null;
    if (dueno && activos[dueno] !== true) return false;
    if (b.modulo) return tieneNivel(perfil.permisos, b.modulo, b.nivel);
    return b.roles.includes('todos') || b.roles.some((r) => perfil.roles.has(r));
  });
}

/** La forma que viaja al navegador. Sin `cuerpo` (solo el HTML ya escapado). */
function paraNavegador(b) {
  return {
    id: b.id, titulo: b.titulo, seccion: b.seccion, orden: b.orden, icono: b.icono, modulo: b.modulo, nivel: b.nivel,
    roles: b.roles, ruta: b.ruta, capturas: b.capturas || [], html: b.html, etiqueta_modulo: b.etiqueta_modulo,
  };
}

/** El manual de un perfil: secciones en orden, y las preguntas frecuentes y el glosario aparte. */
function armarManual(perfil, titulos) {
  const est = cargar({ silencioso: true });
  const visibles = bloquesVisibles(est.bloques, perfil);
  const porSeccion = (s) => visibles.filter((b) => b.seccion === s).map(paraNavegador);
  const secciones = ORDEN_SECCIONES.filter((s) => s !== 'faq' && s !== 'glosario')
    .map((s) => ({ id: s, titulo: SECCIONES[s], bloques: porSeccion(s) }))
    .filter((s) => s.bloques.length);
  const faq = porSeccion('faq');
  const glosario = porSeccion('glosario');
  const total = visibles.length;
  return {
    titulo: titulos.titulo, descripcion: titulos.descripcion, icono: titulos.icono,
    fecha_contenido: est.fecha,
    secciones, faq, glosario,
    totales: { bloques: total - faq.length - glosario.length, faq: faq.length, glosario: glosario.length },
  };
}

function manualDeInstalacion() {
  const est = cargar({ silencioso: true });
  return {
    titulo: INSTALACION.titulo, descripcion: INSTALACION.descripcion, icono: INSTALACION.icono,
    fecha_contenido: est.fecha,
    secciones: [{ id: 'instalacion', titulo: 'Instalación y mantenimiento', bloques: est.instalacion.map(paraNavegador) }],
    faq: [], glosario: [],
    totales: { bloques: est.instalacion.length, faq: 0, glosario: 0 },
  };
}

module.exports = {
  DIR_IMG, PESO_MAXIMO_CAPTURA, medirWebp,
  cargar, armarManual, manualDeInstalacion, bloquesVisibles, tieneNivel, renderMarkdown, partirArchivo, escapar, sinTildes,
  SECCIONES, ORDEN_SECCIONES, ICONOS, NIVELES, ROLES_VALIDOS, MANUALES_POR_ROL, INSTALACION, etiquetasDeMenu,
  // Para las pruebas (scripts/probar-manuales.js):
  cargarDirectorio, catalogoDeModulos, DIR_BLOQUES, DIR_INSTALACION, RAIZ,
};
