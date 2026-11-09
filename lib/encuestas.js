/**
 * ENCUESTAS INTERNAS (parche 307, Fases 1 y 2): formularios cortos que líderes y equipo aplican en campo —también sin señal— para conocer
 * lo que piensa el territorio. Las rutas están en routes/encuestas.routes.js, las reglas electorales en lib/encuestasReglas.js y la zona en
 * lib/zonas.js. Aquí vive el constructor (borrador → publicada → cerrada), la huella que congela una versión y el registro de cada respuesta.
 *
 * LO QUE ESTE MÓDULO NO HACE, A PROPÓSITO
 *   · NO LIGA UNA RESPUESTA A UNA PERSONA. Ni nombre, ni cédula, ni teléfono, ni `votante_id`, ni IP: las tres tablas de respuestas no tienen
 *     una sola columna de identidad (scripts/probar-encuestas.js lo comprueba contra el esquema real, columna por columna). Lo único
 *     «de alguien» es `aplicada_por`: la cuenta del EQUIPO que hizo la encuesta, para el alcance y el control de calidad, nunca el
 *     encuestado. La opinión política es dato sensible (Ley 1581 de 2012, art. 5); la decisión de la campaña es no ligarla nunca, y por eso
 *     tampoco existe el camino «con autorización»: si algún día hiciera falta, sería otro módulo y otra tabla, con autorización expresa,
 *     previa y SEPARADA, y no un campo más de éste.
 *   · NO SE EDITA LO PUBLICADO. Al publicar se calcula una HUELLA (sha256 del contenido) y esa versión queda congelada: las preguntas de una
 *     encuesta que no sea borrador no se tocan, y las que tienen respuestas no se pueden borrar (llaves foráneas RESTRICT). Para cambiar algo,
 *     se DUPLICA como borrador nuevo. La huella se recalcula al servir la encuesta al celular: si no coincide, no se sirve.
 *   · NO GUARDA EL GPS CRUDO. La ubicación es opcional, la pide la encuesta y solo viaja y se guarda la CELDA de 0,005° (unos 550 m): el
 *     celular manda los índices de la celda, no la coordenada.
 *   · NO SE APLICA EL DÍA DE LA ELECCIÓN, ni habla de voto o candidatos antes de la fecha permitida (lib/encuestasReglas.js).
 *   · NO SE PUBLICA: son de uso interno (los textos y los avisos de las pantallas lo dicen).
 *
 * «SENSIBLE» Y «OBLIGATORIA» SE EXCLUYEN. Una pregunta sensible (opinión política) no puede ser obligatoria —el titular puede negarse a
 * responder un dato sensible—, y una encuesta con alguna pregunta sensible no admite texto libre (es donde se cuelan los nombres).
 * TODA pregunta que no es de texto trae «No sabe / No responde» automático. Las preguntas cuyo texto habla de política hay que marcarlas
 * sensibles: el constructor no deja publicar si no.
 *
 * LA CAPTURA MANDA. `respondida_en` es la hora del TOQUE en el celular (acotada: ni futura, ni de hace más de 7 días). Con ella se juzgan
 * el cierre de la encuesta (se acepta lo capturado antes de cerrar aunque suba después), la precampaña y el día de la elección.
 *
 * LA RETENCIÓN: `anonimizar_solicitudes_meses` meses después de la fecha de la elección se BORRAN los textos libres y las celdas de ubicación
 * (la misma vuelta diaria de las solicitudes, lib/solicitudesMantenimiento.js). Las cifras sin texto ni ubicación se conservan: no
 * identifican a nadie.
 */
'use strict';

const crypto = require('crypto');
const pool = require('../config/db');
const Reglas = require('./encuestasReglas');
const R = require('./recordatorios');
const Z = require('./zonas');

const TIPOS = {
  unica: 'Opción única', multiple: 'Opción múltiple', escala: 'Escala de 1 a 5', numero: 'Número', texto: 'Texto corto',
};
const ESTADOS = ['borrador', 'publicada', 'cerrada'];
const ETIQUETA_ESTADO = { borrador: 'Borrador', publicada: 'Publicada', cerrada: 'Cerrada' };
const NSNR = 'No sabe / No responde';
const MIN_TITULO = 3, MAX_TITULO = 150, MAX_DESCRIPCION = 500, MAX_ENUNCIADO = 300, MAX_OPCION = 100;
const MAX_PREGUNTAS = 40, MIN_OPCIONES = 2, MAX_OPCIONES = 12;
const VENTANA_CAPTURA_DIAS = 7;
const PASO_CELDA = 0.005;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIA_MS = 24 * 60 * 60 * 1000;

const err = (estado, mensaje, extra) => { const e = new Error(mensaje); e.estado = estado; e.mensaje = mensaje; if (extra) Object.assign(e, extra); return e; };

/* ------------------------------------------------------------------------------------------------------------ PERMISOS */

/**
 * Lo que la matriz le deja hacer a este usuario en un módulo de encuestas (`encuestas` o `encuestas_campo`): { ver, editar, agregar }.
 * El administrador y el superadministrador siempre pueden todo. Falla CERRADO: sin fila o con un error, nada.
 */
async function permisosDe(usuario, modulo) {
  if (!usuario) return { ver: false, editar: false, agregar: false };
  if (usuario.rol === 'admin') return { ver: true, editar: true, agregar: true };
  try {
    const [[u]] = await pool.query('SELECT es_superadmin FROM usuarios WHERE id = ?', [usuario.id]);
    if (u && Number(u.es_superadmin) === 1) return { ver: true, editar: true, agregar: true };
    const [filas] = await pool.query('SELECT permitido, editar, agregar FROM permisos_rol WHERE rol = ? AND modulo = ? LIMIT 1', [usuario.rol, modulo]);
    if (!filas.length || Number(filas[0].permitido) !== 1) return { ver: false, editar: false, agregar: false };
    return { ver: true, editar: Number(filas[0].editar) === 1, agregar: Number(filas[0].agregar) === 1 };
  } catch (e) {
    console.error('[encuestas] No se pudo comprobar el permiso:', e.code || e.message);
    return { ver: false, editar: false, agregar: false };
  }
}

/* ------------------------------------------------------------------------------------------------------- UTILIDADES */

function limpiarTexto(t, max) {
  return String(t === undefined || t === null ? '' : t).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}
const aBool = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
const aNumero = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const numONull = (v) => (v === undefined || v === null ? null : Number(v));
const claveDeTexto = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const esNsnr = (t) => /^no sabe\s*(\/|o|,)?\s*no responde$/.test(claveDeTexto(t)) || claveDeTexto(t) === 'no sabe' || claveDeTexto(t) === 'no responde' || claveDeTexto(t) === 'ns/nr' || claveDeTexto(t) === 'nsnr';
const soportaNsnr = (tipo) => tipo !== 'texto';
function leerJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (_) { return null; }
}

/* ---------------------------------------------------------------------------------------------------- EL CONSTRUCTOR */

/**
 * Lo que llega del constructor, ya limpio. NO mira las reglas electorales (eso es revisarSemantica, que se corre al guardar para avisar y
 * al publicar para exigir). Devuelve { errores, datos }; un borrador con errores de FORMA no se guarda.
 */
function normalizarBorrador(b) {
  b = b || {};
  const errores = [];
  const datos = {
    titulo: limpiarTexto(b.titulo, MAX_TITULO),
    descripcion: limpiarTexto(b.descripcion, MAX_DESCRIPCION) || null,
    pide_ubicacion: aBool(b.pide_ubicacion) ? 1 : 0,
    preguntas: [],
    sensible: 0,
  };
  if (datos.titulo.length < MIN_TITULO) errores.push('Escribe el título de la encuesta (al menos 3 letras).');
  const crudas = Array.isArray(b.preguntas) ? b.preguntas : [];
  if (crudas.length > MAX_PREGUNTAS) errores.push(`Una encuesta admite hasta ${MAX_PREGUNTAS} preguntas: las encuestas de campo son cortas.`);
  crudas.slice(0, MAX_PREGUNTAS).forEach((c, i) => {
    c = c || {};
    const n = i + 1;
    const q = {
      orden: n, tipo: String(c.tipo || ''), enunciado: limpiarTexto(c.enunciado, MAX_ENUNCIADO),
      obligatoria: aBool(c.obligatoria) ? 1 : 0, sensible: aBool(c.sensible) ? 1 : 0, opciones: null, num_min: null, num_max: null,
    };
    datos.preguntas.push(q);
    if (!TIPOS[q.tipo]) { errores.push(`Pregunta ${n}: elige el tipo de pregunta.`); return; }
    if (q.enunciado.length < 3) errores.push(`Pregunta ${n}: escribe el enunciado.`);
    if (q.sensible && q.obligatoria) {
      errores.push(`Pregunta ${n}: una pregunta sensible no puede ser obligatoria. Quien responde puede negarse a contestar un dato sensible.`);
    }
    if (q.tipo === 'unica' || q.tipo === 'multiple') {
      const bruto = Array.isArray(c.opciones) ? c.opciones : String(c.opciones || '').split(/\r?\n/);
      const textos = bruto.map((o) => limpiarTexto(o && typeof o === 'object' ? o.texto : o, MAX_OPCION)).filter(Boolean);
      const vistas = new Set();
      const lista = [];
      for (const t of textos) {
        if (esNsnr(t)) continue;                                // «No sabe / No responde» se agrega sola
        const k = claveDeTexto(t);
        if (vistas.has(k)) { errores.push(`Pregunta ${n}: la opción «${t}» está repetida.`); continue; }
        vistas.add(k);
        lista.push(t);
      }
      if (lista.length < MIN_OPCIONES) errores.push(`Pregunta ${n}: pon al menos ${MIN_OPCIONES} opciones («${NSNR}» se agrega sola).`);
      if (lista.length > MAX_OPCIONES) errores.push(`Pregunta ${n}: máximo ${MAX_OPCIONES} opciones.`);
      q.opciones = lista.slice(0, MAX_OPCIONES).map((texto, j) => ({ id: 'o' + (j + 1), texto }));
    } else if (q.tipo === 'numero') {
      const mn = aNumero(c.num_min), mx = aNumero(c.num_max);
      if (mn !== null && !Number.isFinite(mn)) errores.push(`Pregunta ${n}: el mínimo no es un número.`); else q.num_min = mn;
      if (mx !== null && !Number.isFinite(mx)) errores.push(`Pregunta ${n}: el máximo no es un número.`); else q.num_max = mx;
      if (q.num_min !== null && q.num_max !== null && q.num_min > q.num_max) errores.push(`Pregunta ${n}: el mínimo no puede ser mayor que el máximo.`);
      if ([q.num_min, q.num_max].some((x) => x !== null && Math.abs(x) > 999999999999)) errores.push(`Pregunta ${n}: el número es demasiado grande.`);
    }
  });
  datos.sensible = datos.preguntas.some((p) => p.sensible) ? 1 : 0;
  if (datos.sensible && datos.preguntas.some((p) => p.tipo === 'texto')) {
    errores.push('Una encuesta con preguntas sensibles no puede tener preguntas de texto corto: el texto libre es donde se cuelan los nombres. Quita el texto o quita la marca de sensible.');
  }
  return { errores, datos };
}

/** Todos los textos de la encuesta, con el lugar donde están, para revisar la precampaña. */
function textosDe(c) {
  const t = [{ donde: 'El título', texto: c.titulo }, { donde: 'La descripción', texto: c.descripcion }];
  (c.preguntas || []).forEach((p) => {
    t.push({ donde: `La pregunta ${p.orden}`, texto: p.enunciado });
    (p.opciones || []).forEach((o) => t.push({ donde: `Una opción de la pregunta ${p.orden}`, texto: o.texto }));
  });
  return t;
}

/**
 * Las reglas de FONDO: lo que hace falta para PUBLICAR. Devuelve una lista de textos (vacía = se puede publicar).
 *  · al menos una pregunta;
 *  · la pregunta que habla de política tiene que estar marcada sensible;
 *  · precampaña: sin palabras prohibidas antes de la fecha permitida (con la palabra que lo causó).
 */
function revisarSemantica(datos, cfg, ahora = new Date()) {
  const errores = [];
  if (!datos.preguntas.length) errores.push('Agrega al menos una pregunta.');
  datos.preguntas.forEach((p) => {
    if (p.sensible) return;
    const textos = [p.enunciado].concat((p.opciones || []).map((o) => o.texto));
    for (const t of textos) {
      const palabra = Reglas.palabraProhibidaEncuesta(t, cfg);
      if (palabra) {
        errores.push(`Pregunta ${p.orden}: habla de política («${palabra}»). Márcala como sensible: la opinión política es un dato sensible, no puede ser obligatoria y la encuesta no puede llevar texto libre.`);
        break;
      }
    }
  });
  const hallazgo = Reglas.revisarPrecampana(textosDe(datos), cfg, ahora);
  if (hallazgo) errores.push(hallazgo.mensaje);
  return errores;
}

/* ------------------------------------------------------------------------------------------------------------ HUELLA */

/** El contenido que se congela, con las claves en un orden fijo. Es lo único que entra en la huella. */
function contenidoCanonico(e, preguntas) {
  return {
    titulo: e.titulo, descripcion: e.descripcion || null, pide_ubicacion: Number(e.pide_ubicacion) ? 1 : 0,
    preguntas: preguntas.map((p) => ({
      orden: Number(p.orden), tipo: p.tipo, enunciado: p.enunciado, obligatoria: Number(p.obligatoria) ? 1 : 0, sensible: Number(p.sensible) ? 1 : 0,
      opciones: p.opciones ? p.opciones.map((o) => ({ id: o.id, texto: o.texto })) : null, num_min: numONull(p.num_min), num_max: numONull(p.num_max),
    })),
  };
}
function huellaDe(contenido) { return crypto.createHash('sha256').update(JSON.stringify(contenido), 'utf8').digest('hex').slice(0, 16); }

async function cargarPreguntas(cx, encuestaId) {
  const [filas] = await cx.query(
    'SELECT id, orden, tipo, enunciado, obligatoria, sensible, opciones, num_min, num_max FROM encuesta_preguntas WHERE encuesta_id = ? ORDER BY orden', [encuestaId]);
  return filas.map((f) => ({ ...f, id: Number(f.id), orden: Number(f.orden), opciones: leerJson(f.opciones) }));
}

/* ------------------------------------------------------------------------------------------- GUARDAR, PUBLICAR, CERRAR */

/** Guarda un borrador nuevo (`id` null) o reemplaza las preguntas de uno existente. Solo mientras sea borrador. Devuelve el id. */
async function guardarBorrador(id, datos, usuario) {
  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    let encuestaId = id;
    if (id) {
      const [[e]] = await cx.query('SELECT id, estado FROM encuestas WHERE id = ? FOR UPDATE', [id]);
      if (!e) throw err(404, 'Esa encuesta no existe.');
      if (e.estado !== 'borrador') throw err(409, 'Esta encuesta ya se publicó y su versión quedó congelada: no se puede editar. Duplícala como borrador nuevo para cambiarla.');
      await cx.query('UPDATE encuestas SET titulo = ?, descripcion = ?, pide_ubicacion = ?, sensible = ? WHERE id = ?',
        [datos.titulo, datos.descripcion, datos.pide_ubicacion, datos.sensible, id]);
      await cx.query('DELETE FROM encuesta_preguntas WHERE encuesta_id = ?', [id]);
    } else {
      const [r] = await cx.query('INSERT INTO encuestas (titulo, descripcion, pide_ubicacion, sensible, creada_por) VALUES (?,?,?,?,?)',
        [datos.titulo, datos.descripcion, datos.pide_ubicacion, datos.sensible, usuario ? usuario.id : null]);
      encuestaId = r.insertId;
    }
    for (const p of datos.preguntas) {
      await cx.query(
        'INSERT INTO encuesta_preguntas (encuesta_id, orden, tipo, enunciado, obligatoria, sensible, opciones, num_min, num_max) VALUES (?,?,?,?,?,?,?,?,?)',
        [encuestaId, p.orden, p.tipo, p.enunciado, p.obligatoria, p.sensible, p.opciones ? JSON.stringify(p.opciones) : null, p.num_min, p.num_max]);
    }
    await cx.commit();
    return encuestaId;
  } catch (e) {
    try { await cx.rollback(); } catch (_) { /* ya cerrada */ }
    throw e;
  } finally { cx.release(); }
}

/** Congela el borrador: revisa las reglas de fondo, calcula la huella y la deja publicada. Devuelve { id, huella }. */
async function publicar(id, usuario, ahora = new Date()) {
  const cfg = await Reglas.leerConfig();
  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    const [[e]] = await cx.query('SELECT * FROM encuestas WHERE id = ? FOR UPDATE', [id]);
    if (!e) throw err(404, 'Esa encuesta no existe.');
    if (e.estado !== 'borrador') throw err(409, 'Esta encuesta ya está publicada o cerrada.');
    const preguntas = await cargarPreguntas(cx, id);
    const contenido = contenidoCanonico(e, preguntas);
    const errores = revisarSemantica(contenido, cfg, ahora);
    if (contenido.preguntas.some((p) => p.sensible) && contenido.preguntas.some((p) => p.tipo === 'texto')) {
      errores.push('Una encuesta con preguntas sensibles no puede tener preguntas de texto corto.');
    }
    if (contenido.preguntas.some((p) => p.sensible && p.obligatoria)) errores.push('Una pregunta sensible no puede ser obligatoria.');
    if (errores.length) throw err(422, 'La encuesta todavía no se puede publicar: ' + errores[0], { errores });
    const huella = huellaDe(contenido);
    const sensible = contenido.preguntas.some((p) => p.sensible) ? 1 : 0;
    await cx.query(`UPDATE encuestas SET estado = 'publicada', huella = ?, sensible = ?, publicada_en = NOW(), publicada_por = ? WHERE id = ?`,
      [huella, sensible, usuario ? usuario.id : null, id]);
    await cx.commit();
    return { id, huella };
  } catch (e) {
    try { await cx.rollback(); } catch (_) { /* ya cerrada */ }
    throw e;
  } finally { cx.release(); }
}

async function cerrar(id, usuario) {
  const [r] = await pool.query(`UPDATE encuestas SET estado = 'cerrada', cerrada_en = NOW(), cerrada_por = ? WHERE id = ? AND estado = 'publicada'`, [usuario ? usuario.id : null, id]);
  if (!r.affectedRows) {
    const [[e]] = await pool.query('SELECT estado FROM encuestas WHERE id = ?', [id]);
    if (!e) throw err(404, 'Esa encuesta no existe.');
    throw err(409, e.estado === 'cerrada' ? 'Esa encuesta ya está cerrada.' : 'Solo se cierra una encuesta publicada.');
  }
  return { id };
}

/** Una copia como borrador nuevo (de cualquier estado). Las preguntas viajan tal cual; los ids de las opciones se rehacen al guardar. */
async function duplicar(id, usuario) {
  const [[e]] = await pool.query('SELECT * FROM encuestas WHERE id = ?', [id]);
  if (!e) throw err(404, 'Esa encuesta no existe.');
  const preguntas = await cargarPreguntas(pool, id);
  const copia = normalizarBorrador({
    titulo: ('Copia de ' + e.titulo).slice(0, MAX_TITULO), descripcion: e.descripcion, pide_ubicacion: e.pide_ubicacion,
    preguntas: preguntas.map((p) => ({ tipo: p.tipo, enunciado: p.enunciado, obligatoria: p.obligatoria, sensible: p.sensible,
      opciones: p.opciones ? p.opciones.map((o) => o.texto) : null, num_min: p.num_min, num_max: p.num_max })),
  });
  const nuevoId = await guardarBorrador(null, copia.datos, usuario);
  await pool.query('UPDATE encuestas SET copia_de = ? WHERE id = ?', [id, nuevoId]);
  return { id: nuevoId };
}

/** Solo un borrador se borra. Una publicada o cerrada se conserva (puede tener respuestas). */
async function eliminar(id) {
  const [[e]] = await pool.query('SELECT estado FROM encuestas WHERE id = ?', [id]);
  if (!e) throw err(404, 'Esa encuesta no existe.');
  if (e.estado !== 'borrador') throw err(409, 'Solo se puede eliminar un borrador. Una encuesta publicada se cierra, no se borra.');
  await pool.query(`DELETE FROM encuestas WHERE id = ? AND estado = 'borrador'`, [id]);
  return { id };
}

/* ------------------------------------------------------------------------------------------------------------ LECTURAS */

async function listar() {
  const [filas] = await pool.query(
    `SELECT e.id, e.titulo, e.estado, e.sensible, e.pide_ubicacion, e.huella, e.publicada_en, e.cerrada_en, e.creada_en, e.copia_de,
            (SELECT COUNT(*) FROM encuesta_preguntas p WHERE p.encuesta_id = e.id) AS preguntas,
            (SELECT COUNT(*) FROM encuesta_respuestas r WHERE r.encuesta_id = e.id) AS respuestas
       FROM encuestas e ORDER BY e.id DESC LIMIT 200`);
  return filas.map((f) => ({
    id: f.id, titulo: f.titulo, estado: f.estado, estado_etiqueta: ETIQUETA_ESTADO[f.estado], sensible: !!Number(f.sensible), pide_ubicacion: !!Number(f.pide_ubicacion),
    huella: f.huella, publicada_en: f.publicada_en, cerrada_en: f.cerrada_en, creada_en: f.creada_en, copia_de: f.copia_de,
    preguntas: Number(f.preguntas), respuestas: Number(f.respuestas),
  }));
}

async function detalle(id) {
  const [[e]] = await pool.query('SELECT * FROM encuestas WHERE id = ?', [id]);
  if (!e) return null;
  const preguntas = await cargarPreguntas(pool, id);
  const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM encuesta_respuestas WHERE encuesta_id = ?', [id]);
  const congelada = e.estado !== 'borrador';
  return {
    id: e.id, titulo: e.titulo, descripcion: e.descripcion, estado: e.estado, estado_etiqueta: ETIQUETA_ESTADO[e.estado],
    pide_ubicacion: !!Number(e.pide_ubicacion), sensible: !!Number(e.sensible), huella: e.huella,
    huella_ok: congelada ? huellaDe(contenidoCanonico(e, preguntas)) === e.huella : null,
    publicada_en: e.publicada_en, cerrada_en: e.cerrada_en, creada_en: e.creada_en, copia_de: e.copia_de, respuestas: Number(n.n),
    editable: !congelada,
    preguntas: preguntas.map((p) => ({
      id: p.id, orden: p.orden, tipo: p.tipo, tipo_etiqueta: TIPOS[p.tipo], enunciado: p.enunciado, obligatoria: !!Number(p.obligatoria), sensible: !!Number(p.sensible),
      opciones: p.opciones, num_min: numONull(p.num_min), num_max: numONull(p.num_max), nsnr: soportaNsnr(p.tipo),
    })),
  };
}

/**
 * Lo que el celular recibe y guarda para trabajar sin señal: las encuestas PUBLICADAS, con su contenido congelado y su huella.
 *  · el día de la elección no hay ninguna (y la respuesta dice `bloqueo`);
 *  · una cuya huella no coincide con su contenido no se sirve (alguien tocó la base por fuera);
 *  · una cuyo texto no pasa HOY la precampaña (alguien movió la fecha permitida) queda suspendida: no se sirve.
 */
async function paraCampo(ahora = new Date()) {
  const cfg = await Reglas.leerConfig();
  const base = { hoy: R.hoyTexto(ahora), fecha_eleccion: cfg && cfg.fecha_eleccion ? cfg.fecha_eleccion : null, generada_en: ahora.toISOString(), nsnr: NSNR };
  if (Reglas.esDiaDeLaEleccion(cfg, ahora)) return { ...base, bloqueo: { codigo: 'dia_de_la_eleccion', mensaje: Reglas.MENSAJE_DIA_DE_LA_ELECCION }, encuestas: [], suspendidas: 0 };
  const [filas] = await pool.query(`SELECT * FROM encuestas WHERE estado = 'publicada' ORDER BY publicada_en DESC, id DESC`);
  const encuestas = [];
  let suspendidas = 0;
  for (const e of filas) {
    const preguntas = await cargarPreguntas(pool, e.id);
    const contenido = contenidoCanonico(e, preguntas);
    if (huellaDe(contenido) !== e.huella) { console.error(`[encuestas] La encuesta ${e.id} no coincide con su huella: no se sirve.`); suspendidas++; continue; }
    if (Reglas.revisarPrecampana(textosDe(contenido), cfg, ahora)) { suspendidas++; continue; }
    encuestas.push({
      id: e.id, titulo: e.titulo, descripcion: e.descripcion, huella: e.huella, pide_ubicacion: !!Number(e.pide_ubicacion), sensible: !!Number(e.sensible),
      preguntas: preguntas.map((p) => ({
        id: p.id, orden: p.orden, tipo: p.tipo, enunciado: p.enunciado, obligatoria: !!Number(p.obligatoria), sensible: !!Number(p.sensible),
        opciones: p.opciones, num_min: numONull(p.num_min), num_max: numONull(p.num_max), nsnr: soportaNsnr(p.tipo),
      })),
    });
  }
  return { ...base, bloqueo: null, encuestas, suspendidas };
}

/* -------------------------------------------------------------------------------------------------------- RESPUESTAS */

/** La hora de captura: la del celular, sin pasarse del futuro ni de la ventana. Sin hora, la del servidor. */
function capturaDe(valor, ahora) {
  const t = Date.parse(valor);
  let ms = Number.isFinite(t) ? t : ahora.getTime();
  if (ms > ahora.getTime() + DIA_MS) throw err(400, 'La hora de este celular está adelantada. Corrígela en los ajustes del teléfono y vuelve a intentarlo.');
  if (ms > ahora.getTime()) ms = ahora.getTime();
  if (ahora.getTime() - ms > VENTANA_CAPTURA_DIAS * DIA_MS) throw err(400, `Esta respuesta se tomó hace más de ${VENTANA_CAPTURA_DIAS} días y ya no se acepta.`);
  return new Date(ms);
}

/** El centro de la celda de 0,005° a partir de sus índices (lo que manda el celular), o null si no son válidos o no caen en Colombia. */
function celdaDe(b) {
  const ix = Number(b.celda_ix), iy = Number(b.celda_iy);
  if (b.celda_ix === undefined || b.celda_iy === undefined || b.celda_ix === '' || b.celda_iy === '' || !Number.isInteger(ix) || !Number.isInteger(iy)) return null;
  const lat = (iy + 0.5) * PASO_CELDA, lng = (ix + 0.5) * PASO_CELDA;
  if (!(lat >= -5 && lat <= 14 && lng >= -82 && lng <= -66)) return null;
  return { lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) };
}

/** Revisa las respuestas contra la versión congelada. Devuelve las filas a guardar o lanza un 400 que dice qué pregunta falla. */
function validarRespuestas(preguntas, crudas) {
  const porId = new Map(preguntas.map((p) => [p.id, p]));
  const lista = Array.isArray(crudas) ? crudas : [];
  const vistas = new Set();
  const items = [];
  for (const r of lista) {
    const p = porId.get(Number(r && r.pregunta_id));
    if (!p) throw err(400, 'Una respuesta no corresponde a ninguna pregunta de esta encuesta.');
    if (vistas.has(p.id)) throw err(400, `La pregunta ${p.orden} viene dos veces.`);
    vistas.add(p.id);
    if (aBool(r.nsnr)) {
      if (!soportaNsnr(p.tipo)) throw err(400, `La pregunta ${p.orden} es de texto y no tiene «${NSNR}»: se deja en blanco.`);
      items.push({ pregunta_id: p.id, opcion_id: null, valor_num: null, valor_texto: null, nsnr: 1 });
      continue;
    }
    const ids = new Set((p.opciones || []).map((o) => o.id));
    if (p.tipo === 'unica') {
      const o = String(r.opcion || '');
      if (!ids.has(o)) throw err(400, `Pregunta ${p.orden}: elige una de las opciones.`);
      items.push({ pregunta_id: p.id, opcion_id: o, valor_num: null, valor_texto: null, nsnr: 0 });
    } else if (p.tipo === 'multiple') {
      const lo = Array.isArray(r.opciones) ? [...new Set(r.opciones.map(String))] : [];
      if (!lo.length || lo.some((o) => !ids.has(o))) throw err(400, `Pregunta ${p.orden}: elige al menos una de las opciones.`);
      lo.forEach((o) => items.push({ pregunta_id: p.id, opcion_id: o, valor_num: null, valor_texto: null, nsnr: 0 }));
    } else if (p.tipo === 'escala') {
      const v = Number(r.valor);
      if (!Number.isInteger(v) || v < 1 || v > 5) throw err(400, `Pregunta ${p.orden}: la escala va de 1 a 5.`);
      items.push({ pregunta_id: p.id, opcion_id: null, valor_num: v, valor_texto: null, nsnr: 0 });
    } else if (p.tipo === 'numero') {
      const v = aNumero(r.valor);
      if (v === null || !Number.isFinite(v) || Math.abs(v) > 999999999999) throw err(400, `Pregunta ${p.orden}: escribe un número.`);
      if (p.num_min !== null && p.num_min !== undefined && v < Number(p.num_min)) throw err(400, `Pregunta ${p.orden}: el mínimo es ${Number(p.num_min)}.`);
      if (p.num_max !== null && p.num_max !== undefined && v > Number(p.num_max)) throw err(400, `Pregunta ${p.orden}: el máximo es ${Number(p.num_max)}.`);
      items.push({ pregunta_id: p.id, opcion_id: null, valor_num: Math.round(v * 100) / 100, valor_texto: null, nsnr: 0 });
    } else if (p.tipo === 'texto') {
      const t = limpiarTexto(r.texto, 400);
      if (!t) continue;                                       // texto en blanco = sin responder
      const problema = Reglas.problemaDeTextoLibre(t);
      if (problema) throw err(400, `Pregunta ${p.orden}: ${problema}`);
      items.push({ pregunta_id: p.id, opcion_id: null, valor_num: null, valor_texto: t, nsnr: 0 });
    }
  }
  const respondidas = new Set(items.map((i) => i.pregunta_id));
  for (const p of preguntas) {
    if (p.obligatoria && !respondidas.has(p.id)) throw err(400, `Falta responder la pregunta ${p.orden}: ${p.enunciado.slice(0, 80)}`);
  }
  if (!items.length) throw err(400, 'La respuesta está vacía: contesta al menos una pregunta.');
  return items;
}

/**
 * Registra UNA respuesta. IDEMPOTENTE por `cliente_uuid`: un reintento de la cola sin señal devuelve la misma, sin duplicar.
 * `body`: { cliente_uuid, encuesta_id, huella, respondida_en, iniciada_en?, territorio_id | zona_texto, celda_ix?, celda_iy?, respuestas: [...] }.
 * Devuelve { id, duplicado } o lanza un error con `.estado` (HTTP) y `.mensaje`.
 */
async function registrarRespuesta({ usuario, body, ahora = new Date() }) {
  const b = body || {};
  const uuid = String(b.cliente_uuid || '').trim().toLowerCase();
  if (!UUID.test(uuid)) throw err(400, 'Falta el identificador del registro (cliente_uuid).');
  const [[ya]] = await pool.query('SELECT id FROM encuesta_respuestas WHERE cliente_uuid = ?', [uuid]);
  if (ya) return { id: Number(ya.id), duplicado: true };

  const encuestaId = Number(b.encuesta_id);
  const [[e]] = Number.isInteger(encuestaId) && encuestaId > 0 ? await pool.query('SELECT * FROM encuestas WHERE id = ?', [encuestaId]) : [[null]];
  if (!e || e.estado === 'borrador') throw err(404, 'Esa encuesta no existe o todavía no está publicada.');
  if (String(b.huella || '') !== e.huella) throw err(409, 'Esta respuesta es de otra versión de la encuesta. Abre la lista de encuestas con señal para actualizarla.');

  const captura = capturaDe(b.respondida_en, ahora);
  const cfg = await Reglas.leerConfig();
  if (Reglas.esDiaDeLaEleccion(cfg, captura)) throw err(422, 'Esta respuesta se tomó el día de la elección y ese día no se aplica ninguna encuesta: no se guarda.');
  const capturaTxt = R.aTexto(captura);
  if (e.estado === 'cerrada' && e.cerrada_en && capturaTxt > e.cerrada_en) {
    throw err(409, `La encuesta se cerró el ${e.cerrada_en.slice(0, 16)} y esta respuesta se tomó después.`);
  }
  const preguntas = await cargarPreguntas(pool, e.id);
  const contenido = contenidoCanonico(e, preguntas);
  if (huellaDe(contenido) !== e.huella) throw err(409, 'La encuesta no coincide con su versión publicada. Avisa al administrador.');
  const hallazgo = Reglas.revisarPrecampana(textosDe(contenido), cfg, captura);
  if (hallazgo) throw err(422, hallazgo.mensaje);

  const zona = await Z.resolverZonaDeCampo({ territorio_id: b.territorio_id, zona_texto: b.zona_texto }, { obligatoria: true });
  const celda = Number(e.pide_ubicacion) ? celdaDe(b) : null;          // si la encuesta no pide ubicación, lo que llegue se descarta
  const items = validarRespuestas(preguntas, b.respuestas);

  let duracion = null;
  const ini = Date.parse(b.iniciada_en);
  if (Number.isFinite(ini)) { const s = Math.round((captura.getTime() - ini) / 1000); if (s >= 0 && s <= 6 * 3600) duracion = s; }
  const atribucion = await require('./solicitudes').atribucionDe(usuario);

  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    const [r] = await cx.query(
      `INSERT INTO encuesta_respuestas (cliente_uuid, encuesta_id, huella, territorio_id, zona_texto, celda_lat, celda_lng, respondida_en, duracion_seg,
                                        aplicada_por, lider_id, sublider_id, rama_aspirante_id, aspirante_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uuid, e.id, e.huella, zona.territorio_id, zona.zona_texto, celda ? celda.lat : null, celda ? celda.lng : null, capturaTxt, duracion,
        usuario.id, atribucion.lider_id, atribucion.sublider_id, atribucion.rama_aspirante_id, atribucion.aspirante_id]);
    await cx.query('INSERT INTO encuesta_respuesta_items (respuesta_id, pregunta_id, opcion_id, valor_num, valor_texto, nsnr) VALUES ?',
      [items.map((i) => [r.insertId, i.pregunta_id, i.opcion_id, i.valor_num, i.valor_texto, i.nsnr])]);
    await cx.commit();
    // El control de calidad (parche 308) va DESPUÉS de guardar y nunca se le muestra a quien aplica: si falla, la respuesta ya está a salvo.
    try { await require('./encuestasCalidad').evaluar(r.insertId); } catch (ec) { console.error('[encuestas] No se pudo evaluar la calidad:', ec && (ec.code || ec.message)); }
    return { id: Number(r.insertId), duplicado: false };
  } catch (e2) {
    try { await cx.rollback(); } catch (_) { /* ya cerrada */ }
    if (e2 && e2.code === 'ER_DUP_ENTRY') {                                // dos reintentos a la vez: gana uno, el otro devuelve el mismo
      const [[otra]] = await pool.query('SELECT id FROM encuesta_respuestas WHERE cliente_uuid = ?', [uuid]);
      if (otra) return { id: Number(otra.id), duplicado: true };
    }
    throw e2;
  } finally { cx.release(); }
}

/* ----------------------------------------------------------------------------------------------------------- RETENCIÓN */

/**
 * Borra los textos libres y las celdas de ubicación que ya cumplieron su plazo: `anonimizar_solicitudes_meses` meses DESPUÉS de la fecha
 * de la elección (el mismo plazo que las solicitudes). Sin fecha de elección, o antes del plazo, no toca nada. `aplicar: false` solo cuenta.
 * Las cifras de las demás preguntas se conservan: sin texto ni ubicación no identifican a nadie.
 * Devuelve { aplicado, motivo, desde, vencen: {textos, celdas}, textos, celdas }.
 */
async function borrarTextosYCeldasVencidos({ aplicar = false } = {}) {
  const S = require('./solicitudes');
  const cfg = await S.estadoDelPlazo();
  const vacio = { vencen: { textos: 0, celdas: 0 }, textos: 0, celdas: 0 };
  if (!cfg || !cfg.eleccion) return { aplicado: false, motivo: 'No hay fecha de elección en la configuración: no se borra nada.', ...vacio };
  if (!Number(cfg.vencido)) return { aplicado: false, motivo: `Todavía no: se borra desde el ${cfg.desde} (${cfg.meses} meses después de la elección del ${cfg.eleccion}).`, desde: cfg.desde, ...vacio };
  const [[t]] = await pool.query('SELECT COUNT(*) AS n FROM encuesta_respuesta_items WHERE valor_texto IS NOT NULL');
  const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM encuesta_respuestas WHERE celda_lat IS NOT NULL');
  const vencen = { textos: Number(t.n), celdas: Number(c.n) };
  if (!aplicar) return { aplicado: false, motivo: 'Simulación: no se borró nada.', desde: cfg.desde, vencen, textos: 0, celdas: 0 };
  // Primero se marcan las respuestas tocadas (mientras todavía se sabe cuáles tenían texto), después se borra.
  await pool.query(
    `UPDATE encuesta_respuestas SET anonimizada_en = NOW()
      WHERE anonimizada_en IS NULL AND (celda_lat IS NOT NULL OR id IN (SELECT respuesta_id FROM encuesta_respuesta_items WHERE valor_texto IS NOT NULL))`);
  await pool.query('UPDATE encuesta_respuesta_items SET valor_texto = NULL WHERE valor_texto IS NOT NULL');
  await pool.query('UPDATE encuesta_respuestas SET celda_lat = NULL, celda_lng = NULL WHERE celda_lat IS NOT NULL');
  return { aplicado: true, motivo: 'Aplicado.', desde: cfg.desde, vencen, textos: vencen.textos, celdas: vencen.celdas };
}

module.exports = {
  TIPOS, ESTADOS, ETIQUETA_ESTADO, NSNR, MAX_PREGUNTAS, MAX_OPCIONES, MAX_ENUNCIADO, MAX_TITULO, VENTANA_CAPTURA_DIAS, PASO_CELDA,
  permisosDe, normalizarBorrador, revisarSemantica, textosDe, contenidoCanonico, huellaDe, cargarPreguntas,
  guardarBorrador, publicar, cerrar, duplicar, eliminar, listar, detalle, paraCampo,
  capturaDe, celdaDe, validarRespuestas, registrarRespuesta, borrarTextosYCeldasVencidos, esNsnr,
};
