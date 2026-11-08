/**
 * TAREAS (parche 305): lo que la coordinación le asigna a su equipo para hacer en el territorio — una visita a un barrio o vereda, una
 * entrega de material, o una tarea libre — y el seguimiento hasta que alguien la verifica. Las rutas están en routes/tareas.routes.js, el
 * alcance en lib/alcanceTareas.js y los avisos en lib/tareasAvisos.js; aquí vive la regla.
 *
 * LO QUE ESTE MÓDULO NO HACE, A PROPÓSITO
 *   · No guarda datos de personas del territorio: ni nombres ni teléfonos de ciudadanos. Una tarea habla de una ZONA y de un EQUIPO.
 *   · No sigue a nadie: la ubicación es UNA sola posición, la del «terminé», opcional y que nunca bloquea. Nunca recorridos.
 *   · No cuenta votos ni habla de elecciones: los textos de las pantallas y de los avisos hablan de tareas, zonas y entregas.
 *
 * ESTADOS GUARDADOS: pendiente, en_curso, hecha, verificada, cancelada.
 * DERIVADOS (no se guardan; se calculan al leer): «vencida» (abierta con la fecha límite pasada) y «sin responsable activo» (abierta cuyo
 * responsable ya no tiene la cuenta activa). Una tarea «hecha» no está vencida: ya hizo su parte, solo espera que la verifiquen.
 *
 * QUIÉN HACE QUÉ
 *   el ASIGNADO ejecuta ......... empecé (pendiente → en curso), terminé (→ hecha, con evidencia), no pude (vuelve a pendiente con su motivo)
 *   quien GESTIONA (creó la tarea; el coordinador, su rama; el administrador, todo) edita, reasigna, cancela (con motivo), verifica
 *   (hecha → verificada) o devuelve (hecha → en curso, con lo que falta). Nadie verifica lo que hizo él mismo, salvo que se la asignara a sí mismo.
 *
 * EVIDENCIA DE «TERMINÉ», por tipo
 *   libre ..... ninguna obligatoria (nota, fotos y ubicación opcionales)
 *   visita .... al menos una: una foto o la ubicación
 *   entrega ... la cantidad entregada y al menos una foto
 * «VERIFICADA» ES OBLIGATORIA SOLO EN LOS TIPOS NO MEDIBLES: hoy los tres lo son; el día que haya un tipo que se mide solo (una meta de
 * registros), TIPOS.<tipo>.medible será true y llegará a «hecha» por sí mismo.
 *
 * FOTOS. Hasta tres por tarea, 1.280 px, JPEG, sin EXIF (sharp no copia los metadatos), en uploads/tareas/, que /uploads no sirve
 * (lib/carpetasPrivadas.js). Salen por una ruta que comprueba el alcance.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');

const TIPOS = {
  libre: { etiqueta: 'Tarea libre', corta: 'libre', frase: 'Tarea libre', medible: false },
  visita: { etiqueta: 'Visita a un barrio o vereda', corta: 'visita', frase: 'Tarea de visita', medible: false },
  entrega: { etiqueta: 'Entrega de material', corta: 'entrega de material', frase: 'Tarea de entrega de material', medible: false },
};
const ESTADOS = ['pendiente', 'en_curso', 'hecha', 'verificada', 'cancelada'];
const ETIQUETA_ESTADO = { pendiente: 'Pendiente', en_curso: 'En curso', hecha: 'Hecha', verificada: 'Verificada', cancelada: 'Cancelada' };
const ABIERTAS = ['pendiente', 'en_curso'];
const TIPOS_ZONA = ['barrio', 'vereda', 'comuna', 'corregimiento'];
const ROLES_ASIGNABLES = ['admin', 'coordinador', 'lider', 'sublider', 'asistente_administrativo'];
const MAX_FOTOS = 3;
const LADO_MAXIMO = 1280;
const TAMANO_MAXIMO_FOTO = 10 * 1024 * 1024;
const MIN_TITULO = 3, MAX_TITULO = 150, MAX_DESCRIPCION = 2000, MAX_NOTA = 500;
const MAX_CANTIDAD = 1000000;
const DIR_FOTOS = path.join(__dirname, '..', 'uploads', 'tareas');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const CINCO_HORAS = 5 * 60 * 60 * 1000;

const err = (estado, mensaje) => { const e = new Error(mensaje); e.estado = estado; e.mensaje = mensaje; return e; };

/* ------------------------------------------------------------------------------------------------------------ PERMISOS */

/** Lo que la matriz le deja hacer a este usuario en el módulo `tareas`: { ver, editar, agregar }. Falla CERRADO. */
async function permisosDe(usuario) {
  if (!usuario) return { ver: false, editar: false, agregar: false };
  if (usuario.rol === 'admin') return { ver: true, editar: true, agregar: true };
  try {
    const [[u]] = await pool.query('SELECT es_superadmin FROM usuarios WHERE id = ?', [usuario.id]);
    if (u && Number(u.es_superadmin) === 1) return { ver: true, editar: true, agregar: true };
    const [filas] = await pool.query('SELECT permitido, editar, agregar FROM permisos_rol WHERE rol = ? AND modulo = ? LIMIT 1', [usuario.rol, 'tareas']);
    if (!filas.length || Number(filas[0].permitido) !== 1) return { ver: false, editar: false, agregar: false };
    return { ver: true, editar: Number(filas[0].editar) === 1, agregar: Number(filas[0].agregar) === 1 };
  } catch (e) {
    console.error('[tareas] No se pudo comprobar el permiso:', e.code || e.message);
    return { ver: false, editar: false, agregar: false };
  }
}

/* ---------------------------------------------------------------------------------------------------------- VALIDACIÓN */

function limpiarTexto(t, max) {
  return String(t === undefined || t === null ? '' : t).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}
const aNumero = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const fechaValida = (t) => FECHA.test(String(t)) && !Number.isNaN(Date.parse(`${t}T00:00:00Z`)) && new Date(`${t}T00:00:00Z`).toISOString().slice(0, 10) === t;

/** La fecha de hoy en Colombia, 'YYYY-MM-DD' (la base corre en -05:00). */
async function hoy() {
  const [[r]] = await pool.query(`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoy`);
  return r.hoy;
}

/**
 * Revisa lo que llega al crear o editar. `parcial` (edición): solo valida lo que viene. Devuelve { errores, datos }.
 * La zona (territorio_id / zona_texto) se resuelve aparte, contra la vista `territorios` (ver resolverZona).
 */
function validarTarea(b, { parcial = false, hoyTexto = null } = {}) {
  const errores = [], datos = {};
  const tiene = (k) => b[k] !== undefined;
  if (!parcial || tiene('tipo')) {
    datos.tipo = String(b.tipo || '');
    if (!TIPOS[datos.tipo]) errores.push('Elige el tipo de tarea: libre, visita o entrega de material.');
  }
  if (!parcial || tiene('titulo')) {
    datos.titulo = limpiarTexto(b.titulo, MAX_TITULO);
    if (datos.titulo.length < MIN_TITULO) errores.push(`Escribe el título de la tarea (al menos ${MIN_TITULO} letras).`);
  }
  if (!parcial || tiene('descripcion')) datos.descripcion = limpiarTexto(b.descripcion, MAX_DESCRIPCION) || null;
  if (!parcial || tiene('fecha_limite')) {
    const f = limpiarTexto(b.fecha_limite, 10);
    if (!f) datos.fecha_limite = null;
    else if (!fechaValida(f)) errores.push('La fecha límite tiene que ser una fecha válida (año-mes-día).');
    else if (hoyTexto && f < hoyTexto) errores.push('La fecha límite no puede ser anterior a hoy.');
    else datos.fecha_limite = f;
  }
  if (!parcial || tiene('cantidad_prevista')) {
    const c = aNumero(b.cantidad_prevista);
    if (c === null) datos.cantidad_prevista = null;
    else if (!Number.isInteger(c) || c < 1 || c > MAX_CANTIDAD) errores.push('La cantidad prevista tiene que ser un número entero positivo.');
    else datos.cantidad_prevista = c;
  }
  if (tiene('territorio_id')) { const t = aNumero(b.territorio_id); datos.territorio_id = Number.isInteger(t) && t > 0 ? t : null; }
  if (tiene('zona_texto')) datos.zona_texto = limpiarTexto(b.zona_texto, 120) || null;
  return { errores, datos };
}

/* -------------------------------------------------------------------------------------------------------------- ZONA */

/**
 * La zona de una tarea. `territorio_id` se valida contra la vista `territorios` (barrio, vereda, comuna o corregimiento) y, si existe, el
 * texto se completa con su nombre. Si no hay catálogo —una campaña sin barrios ni veredas— la zona escrita a mano es la zona, como en
 * lib/comunasDeLaCampana.js: exigir un nivel que no existe haría imposible guardar la tarea. Un id que NO está en el catálogo se rechaza.
 * Devuelve { territorio_id, zona_texto }.
 */
async function resolverZona({ territorio_id, zona_texto }) {
  let id = territorio_id || null, texto = zona_texto || null;
  if (id) {
    let t = null;
    try { [[t]] = await pool.query('SELECT id, nombre FROM territorios WHERE id = ? AND tipo IN (?)', [id, TIPOS_ZONA]); } catch (_) { t = null; }
    if (!t) throw err(400, 'Esa zona no está en el catálogo de la campaña. Elígela de la lista o escríbela a mano.');
    texto = t.nombre;
  }
  return { territorio_id: id, zona_texto: texto };
}

/** Busca zonas para el formulario: las que empiezan o contienen `q`. `hay` dice si la campaña tiene alguna (si no, se escribe a mano). */
async function buscarZonas(q) {
  const texto = String(q || '').replace(/[%_]/g, '').trim().slice(0, 60);
  let filas = [], hay = false;
  try {
    const [[h]] = await pool.query('SELECT COUNT(*) AS n FROM (SELECT 1 FROM territorios WHERE tipo IN (?) LIMIT 1) x', [TIPOS_ZONA]);
    hay = Number(h.n) > 0;
    if (hay) {
      [filas] = await pool.query(
        `SELECT t.id, t.nombre, t.tipo, p.nombre AS padre FROM territorios t LEFT JOIN territorios p ON p.id = t.padre_id
          WHERE t.tipo IN (?) ${texto ? 'AND t.nombre LIKE ?' : ''} ORDER BY (t.nombre LIKE ?) DESC, t.nombre LIMIT 30`,
        texto ? [TIPOS_ZONA, `%${texto}%`, `${texto}%`] : [TIPOS_ZONA, `${texto}%`]);
    }
  } catch (_) { hay = false; }
  return { hay, zonas: filas };
}

/* ------------------------------------------------------------------------------------------------------------- FOTOS */

function asegurarCarpeta() { if (!fs.existsSync(DIR_FOTOS)) fs.mkdirSync(DIR_FOTOS, { recursive: true }); }

/** Reduce la foto (lado mayor 1.280 px, JPEG calidad 72, la gira según EXIF y DESCARTA los metadatos) y la guarda en uploads/tareas/. */
async function guardarFoto(buffer) {
  const sharp = require('sharp');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('La foto llegó vacía.');
  if (buffer.length > TAMANO_MAXIMO_FOTO) throw new Error('La foto pesa demasiado.');
  const { data, info } = await sharp(buffer, { failOn: 'error' }).rotate()
    .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72 }).toBuffer({ resolveWithObject: true });
  asegurarCarpeta();
  const archivo = `tar_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.jpg`;
  await fs.promises.writeFile(path.join(DIR_FOTOS, archivo), data);
  return { archivo, ancho: info.width, alto: info.height, bytes: data.length };
}
function rutaDeFoto(archivo) {
  if (!/^tar_\d+_[0-9a-f]{12}\.jpg$/.test(String(archivo || ''))) return null;   // solo nombres que esta aplicación generó
  return path.join(DIR_FOTOS, archivo);
}
async function borrarArchivo(archivo) {
  const ruta = rutaDeFoto(archivo);
  if (!ruta) return;
  try { await fs.promises.unlink(ruta); } catch (e) { if (e.code !== 'ENOENT') console.error('[tareas] No se pudo borrar una foto:', e.code || e.message); }
}

/* ----------------------------------------------------------------------------------------------------------- LECTURA */

/** Las columnas derivadas y los datos de las personas, para toda consulta que lea tareas con el alias `t`. */
const COLUMNAS = `t.*, COALESCE(t.zona_texto, tz.nombre) AS zona, ua.nombre AS asignada_nombre, ua.activo AS asignada_activa, uc.nombre AS creada_nombre,
  (t.fecha_limite IS NOT NULL AND t.fecha_limite < CURDATE() AND t.estado IN ('pendiente','en_curso')) AS vencida,
  (t.fecha_limite IS NOT NULL AND t.fecha_limite = CURDATE() AND t.estado IN ('pendiente','en_curso')) AS vence_hoy,
  (t.estado IN ('pendiente','en_curso','hecha') AND (ua.id IS NULL OR ua.activo = 0)) AS sin_responsable_activo,
  (SELECT COUNT(*) FROM tarea_fotos f WHERE f.tarea_id = t.id) AS n_fotos`;
const UNIONES = `FROM tareas t LEFT JOIN territorios tz ON tz.id = t.territorio_id LEFT JOIN usuarios ua ON ua.id = t.asignada_a LEFT JOIN usuarios uc ON uc.id = t.creada_por`;

/** La forma que viaja al navegador (sin la posición exacta: esa solo la ven quien gestiona y el asignado). */
function filaPublica(f) {
  return {
    id: f.id, tipo: f.tipo, tipo_etiqueta: TIPOS[f.tipo] ? TIPOS[f.tipo].etiqueta : f.tipo, titulo: f.titulo,
    estado: f.estado, estado_etiqueta: ETIQUETA_ESTADO[f.estado], zona: f.zona || null, territorio_id: f.territorio_id,
    fecha_limite: f.fecha_limite || null, asignada_a: f.asignada_a, asignado: f.asignada_nombre || null, creada_por: f.creada_por, creador: f.creada_nombre || null,
    vencida: !!Number(f.vencida), vence_hoy: !!Number(f.vence_hoy), sin_responsable_activo: !!Number(f.sin_responsable_activo),
    no_pudo: !!f.no_pudo_en && ABIERTAS.includes(f.estado), devuelta: !!f.devuelta_nota && f.estado === 'en_curso',
    fotos: Number(f.n_fotos || 0), con_ubicacion: f.latitud !== null && f.latitud !== undefined,
    creada_en: f.creada_en, actualizada_en: f.actualizada_en, hecha_en: f.hecha_en || null,
  };
}

/**
 * La tarjeta «mis tareas» del panel del líder: solo las que tiene ASIGNADAS. Cuenta aparte lo que vence hoy, lo pendiente (abiertas) y lo
 * vencido. Sin títulos ni nombres de nadie.
 */
async function resumenMisTareas(usuarioId) {
  const [[r]] = await pool.query(
    `SELECT COALESCE(SUM(t.estado IN ('pendiente','en_curso')), 0) AS pendientes,
            COALESCE(SUM(t.estado IN ('pendiente','en_curso') AND t.fecha_limite = CURDATE()), 0) AS vencen_hoy,
            COALESCE(SUM(t.estado IN ('pendiente','en_curso') AND t.fecha_limite < CURDATE()), 0) AS vencidas,
            COALESCE(SUM(t.estado = 'en_curso' AND t.devuelta_nota IS NOT NULL), 0) AS devueltas
       FROM tareas t WHERE t.asignada_a = ?`, [usuarioId]);
  return { pendientes: Number(r.pendientes), vencen_hoy: Number(r.vencen_hoy), vencidas: Number(r.vencidas), devueltas: Number(r.devueltas) };
}

/* -------------------------------------------------------------------------------------------------------- HISTORIAL */

async function historial(cx, tareaId, o) {
  await cx.query(
    `INSERT INTO tarea_historial (tarea_id, tipo, estado_antes, estado_despues, asignada_antes, asignada_despues, nota, usuario_id, usuario_nombre, cliente_uuid)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [tareaId, o.tipo, o.estado_antes || null, o.estado_despues || null, o.asignada_antes || null, o.asignada_despues || null,
      o.nota ? String(o.nota).slice(0, 1000) : null, o.usuario ? o.usuario.id : null, o.usuario ? String(o.usuario.nombre || '').slice(0, 150) : null, o.cliente_uuid || null]);
}

/* ------------------------------------------------------------------------------------------------------- RAMA Y ASIGNADO */

/** El asignado, si está activo, tiene un rol de trabajo y entra en lo que `asignables` (lib/alcanceTareas.js) deja asignar. */
async function asignadoValido(asignables, usuarioId) {
  if (!asignables) throw err(403, 'No puedes asignar tareas.');
  const id = Number(usuarioId);
  if (!Number.isInteger(id) || id < 1) throw err(400, 'Elige a quién se le asigna la tarea.');
  const [[u]] = await pool.query(
    `SELECT u.id, u.nombre FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.id = ? AND u.activo = 1 AND r.nombre IN (?) AND ${asignables.sql}`, [id, ROLES_ASIGNABLES, ...asignables.valores]);
  if (!u) throw err(400, 'No puedes asignarle una tarea a esa persona.');
  return u;
}

/** La rama de aspirante de una persona (o null). La tarea y su responsable tienen que ser de la MISMA campaña. */
async function ramaDe(usuarioId) {
  try { return await require('./ramas').aspiranteDe(pool, usuarioId); } catch (e) { console.error('[tareas] No se pudo resolver la rama:', e.code || e.message); return null; }
}

/**
 * De una lista de personas, las de la MISMA rama que `usuarioId` (las que se le pueden asignar de verdad). Si la campaña no tiene ningún
 * aspirante activo —lo normal— no hay nada que filtrar y no cuesta ninguna consulta por persona.
 */
async function soloMismaRama(usuarioId, filas) {
  let hay = false;
  try { const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM sublicencias WHERE activa = 1'); hay = Number(c.n) > 0; } catch (_) { hay = false; }
  if (!hay) return filas;
  const mia = (await ramaDe(usuarioId)) || null;
  const salida = [];
  for (const f of filas) if (((await ramaDe(f.id)) || null) === mia) salida.push(f);
  return salida;
}

/* ------------------------------------------------------------------------------------------------------------ CREAR */

/**
 * Crea y asigna una tarea. `datos` ya pasó por validarTarea; `asignables` es la condición de lib/alcanceTareas.asignablesPara.
 * Devuelve { id, asignado }. Lanza un error con `.estado` (HTTP) y `.mensaje`.
 */
async function crear({ datos, asignadaA, usuario, asignables }) {
  const asignado = await asignadoValido(asignables, asignadaA);
  const zona = await resolverZona({ territorio_id: datos.territorio_id, zona_texto: datos.zona_texto });
  if (datos.tipo === 'visita' && !zona.territorio_id && !zona.zona_texto) throw err(400, 'Una visita necesita el barrio o la vereda.');
  const ramaCreador = await ramaDe(usuario.id), ramaAsignado = await ramaDe(asignado.id);
  if ((ramaCreador || null) !== (ramaAsignado || null)) throw err(400, 'Esa persona es de otra campaña: no se le puede asignar desde aquí.');
  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    const [r] = await cx.query(
      `INSERT INTO tareas (tipo, titulo, descripcion, estado, territorio_id, zona_texto, fecha_limite, cantidad_prevista, creada_por, asignada_a, rama_aspirante_id, aspirante_id)
       VALUES (?,?,?,'pendiente',?,?,?,?,?,?,?,?)`,
      [datos.tipo, datos.titulo, datos.descripcion || null, zona.territorio_id, zona.zona_texto, datos.fecha_limite || null,
        datos.tipo === 'entrega' ? (datos.cantidad_prevista || null) : null, usuario.id, asignado.id, ramaCreador || null, ramaCreador || 0]);
    await historial(cx, r.insertId, { tipo: 'creada', estado_despues: 'pendiente', asignada_despues: asignado.id, usuario });
    await cx.commit();
    return { id: r.insertId, asignado };
  } catch (e) {
    try { await cx.rollback(); } catch (_) { /* sin transacción */ }
    throw e;
  } finally { cx.release(); }
}

/* ------------------------------------------------------------------------------------------- EJECUTAR (el asignado) */

/** El instante de un toque hecho sin señal, como texto de hora de Colombia, o null si no sirve (futuro, de hace más de 7 días o inválido). */
function horaDeMarca(iso, ahora = new Date()) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > ahora.getTime() + 5 * 60000 || d.getTime() < ahora.getTime() - 7 * 24 * 3600000) return null;
  return new Date(d.getTime() - CINCO_HORAS).toISOString().replace('T', ' ').slice(0, 19);
}

/** La posición del «terminé», o nulls. NUNCA es un requisito de por sí: fuera de Colombia o incompleta se descarta. */
function posicionValida(b) {
  const lat = aNumero(b.latitud), lng = aNumero(b.longitud);
  const ok = Number.isFinite(lat) && Number.isFinite(lng) && lat >= -5 && lat <= 14 && lng >= -82 && lng <= -66;
  const prec = aNumero(b.precision_m);
  return {
    latitud: ok ? Number(lat.toFixed(7)) : null, longitud: ok ? Number(lng.toFixed(7)) : null,
    precision_m: ok && Number.isFinite(prec) && prec >= 0 && prec < 100000 ? Math.round(prec) : null,
  };
}

/**
 * Lo que hace el ASIGNADO: 'empece' | 'termine' | 'no_pude'. IDEMPOTENTE por `cliente_uuid` (la cola sin señal reintenta).
 * `fotos`: lista de Buffers. Devuelve { id, estado, duplicado }.
 */
async function ejecutar({ tareaId, accion, usuario, b = {}, fotos = [] }) {
  const id = Number(tareaId);
  if (!Number.isInteger(id) || id < 1) throw err(404, 'Esa tarea no existe o no es tuya.');
  if (!['empece', 'termine', 'no_pude'].includes(accion)) throw err(400, 'Esa acción no existe.');
  const uuid = String(b.cliente_uuid || '').trim().toLowerCase();
  if (uuid && !UUID.test(uuid)) throw err(400, 'El identificador del registro no es válido.');
  const [[t]] = await pool.query('SELECT * FROM tareas WHERE id = ? AND asignada_a = ?', [id, usuario.id]);
  if (!t) throw err(404, 'Esa tarea no existe o no es tuya.');
  if (uuid) {
    const [[ya]] = await pool.query('SELECT 1 AS x FROM tarea_historial WHERE tarea_id = ? AND cliente_uuid = ?', [id, uuid]);
    if (ya) return { id, estado: t.estado, duplicado: true };
  }
  if (!ABIERTAS.includes(t.estado)) throw err(409, `La tarea ya está ${ETIQUETA_ESTADO[t.estado].toLowerCase()}.`);

  if (accion === 'empece') {
    if (t.estado === 'en_curso') return { id, estado: 'en_curso', duplicado: false };       // ya empezada: no hay nada que cambiar
    return cambio(id, t, { tipo: 'empezada', estado: 'en_curso', sets: ['iniciada_en = NOW()', 'no_pudo_en = NULL', 'no_pudo_nota = NULL'], usuario, uuid });
  }
  if (accion === 'no_pude') {
    const nota = limpiarTexto(b.nota, 255);
    if (nota.length < 3) throw err(400, 'Cuenta por qué no pudiste (al menos 3 letras).');
    return cambio(id, t, { tipo: 'no_pudo', estado: 'pendiente', sets: ['no_pudo_en = NOW()', 'no_pudo_nota = ?'], valores: [nota], nota, usuario, uuid });
  }

  // TERMINÉ: la evidencia que pide el tipo.
  const nota = limpiarTexto(b.nota, MAX_NOTA) || null;
  const pos = posicionValida(b);
  const [[cf]] = await pool.query('SELECT COUNT(*) AS n FROM tarea_fotos WHERE tarea_id = ?', [id]);
  const previas = Number(cf.n);
  if (previas + fotos.length > MAX_FOTOS) throw err(400, `Máximo ${MAX_FOTOS} fotos por tarea.`);
  const hayFoto = previas + fotos.length > 0;
  let cantidad = null;
  if (t.tipo === 'visita' && !hayFoto && pos.latitud === null) throw err(400, 'Una visita se termina con una foto o con la ubicación.');
  if (t.tipo === 'entrega') {
    cantidad = aNumero(b.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD) throw err(400, 'Escribe la cantidad que entregaste (un número entero positivo).');
    if (!hayFoto) throw err(400, 'Una entrega se termina con una foto.');
  }
  const marcada = horaDeMarca(b.marcado_en);
  const guardadas = [];
  const cx = await pool.getConnection();
  try {
    for (const buf of fotos) guardadas.push(await guardarFoto(buf));
    await cx.beginTransaction();
    const sets = ['estado = ?', 'hecha_en = COALESCE(?, NOW())', 'hecha_nota = ?', 'cantidad_entregada = ?', 'latitud = ?', 'longitud = ?', 'precision_m = ?',
      'no_pudo_en = NULL', 'no_pudo_nota = NULL', 'devuelta_nota = NULL', 'iniciada_en = COALESCE(iniciada_en, NOW())'];
    const [r] = await cx.query(
      `UPDATE tareas SET ${sets.join(', ')} WHERE id = ? AND estado = ?`,
      ['hecha', marcada, nota, cantidad, pos.latitud, pos.longitud, pos.precision_m, id, t.estado]);
    if (!r.affectedRows) { await cx.rollback(); throw err(409, 'La tarea cambió mientras tanto. Vuelve a abrirla.'); }
    let orden = previas;
    for (const f of guardadas) {
      orden++;
      await cx.query('INSERT INTO tarea_fotos (tarea_id, orden, archivo, ancho, alto, bytes) VALUES (?,?,?,?,?,?)', [id, orden, f.archivo, f.ancho, f.alto, f.bytes]);
    }
    await historial(cx, id, { tipo: 'hecha', estado_antes: t.estado, estado_despues: 'hecha', nota, usuario, cliente_uuid: uuid || null });
    await cx.commit();
    return { id, estado: 'hecha', duplicado: false, fotos: guardadas.length };
  } catch (e) {
    try { await cx.rollback(); } catch (_) { /* ya cerrada */ }
    for (const f of guardadas) await borrarArchivo(f.archivo);
    if (e && e.code === 'ER_DUP_ENTRY') return { id, estado: 'hecha', duplicado: true };      // dos celulares con el mismo uuid a la vez
    throw e;
  } finally { cx.release(); }
}

/** Un cambio de estado simple, con su historial, en una transacción. `sets` son fragmentos SQL; `valores`, los de sus «?». */
async function cambio(id, t, { tipo, estado, sets = [], valores = [], nota = null, usuario, uuid = null }) {
  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    const [r] = await cx.query(`UPDATE tareas SET estado = ?${sets.length ? ', ' + sets.join(', ') : ''} WHERE id = ? AND estado = ?`, [estado, ...valores, id, t.estado]);
    if (!r.affectedRows) { await cx.rollback(); throw err(409, 'La tarea cambió mientras tanto. Vuelve a abrirla.'); }
    await historial(cx, id, { tipo, estado_antes: t.estado, estado_despues: estado, nota, usuario, cliente_uuid: uuid || null });
    await cx.commit();
    return { id, estado, duplicado: false };
  } catch (e) {
    try { await cx.rollback(); } catch (_) { /* ya cerrada */ }
    if (e && e.code === 'ER_DUP_ENTRY') return { id, estado: t.estado, duplicado: true };
    throw e;
  } finally { cx.release(); }
}

/* ---------------------------------------------------------------------------------------------- GESTIONAR (el que asignó) */

/**
 * La tarea que `usuario` puede GESTIONAR (condición de lib/alcanceTareas.gestionTareas), o lanza 404. Quien es SOLO el asignado —no la creó—
 * no la gestiona aunque la vea: no verifica lo que hizo él mismo.
 */
async function tareaGestionable(id, usuario, gestion) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) throw err(404, 'Esa tarea no existe o no es de tu equipo.');
  const [[t]] = await pool.query(`SELECT t.* FROM tareas t WHERE t.id = ? AND ${gestion.sql}`, [n, ...gestion.valores]);
  if (!t) throw err(404, 'Esa tarea no existe o no es de tu equipo.');
  if (usuario.rol !== 'admin' && Number(t.asignada_a) === Number(usuario.id) && Number(t.creada_por) !== Number(usuario.id)) {
    throw err(403, 'No puedes verificar, devolver ni cambiar una tarea que te asignaron a ti: lo hace quien te la asignó.');
  }
  return t;
}

/** Verificar (hecha → verificada), devolver (hecha → en curso, con lo que falta) o cancelar (con motivo). */
async function resolver({ id, accion, nota, usuario, gestion }) {
  const t = await tareaGestionable(id, usuario, gestion);
  const texto = limpiarTexto(nota, accion === 'cancelar' ? 255 : MAX_NOTA);
  if (accion === 'verificar') {
    if (t.estado !== 'hecha') throw err(409, 'Solo se verifica una tarea que ya está hecha.');
    return { t, r: await cambio(t.id, t, { tipo: 'verificada', estado: 'verificada', sets: ['verificada_en = NOW()', 'verificada_por = ?'], valores: [usuario.id], nota: texto || null, usuario }) };
  }
  if (accion === 'devolver') {
    if (t.estado !== 'hecha') throw err(409, 'Solo se devuelve una tarea que ya está hecha.');
    if (texto.length < 3) throw err(400, 'Escribe lo que le falta (al menos 3 letras).');
    return { t, r: await cambio(t.id, t, { tipo: 'devuelta', estado: 'en_curso', sets: ['devuelta_nota = ?'], valores: [texto], nota: texto, usuario }) };
  }
  if (accion === 'cancelar') {
    if (!['pendiente', 'en_curso', 'hecha'].includes(t.estado)) throw err(409, 'Esa tarea ya no se puede cancelar.');
    if (texto.length < 3) throw err(400, 'Escribe el motivo de la cancelación.');
    return { t, r: await cambio(t.id, t, { tipo: 'cancelada', estado: 'cancelada', sets: ['cancelada_en = NOW()', 'motivo_cancelacion = ?'], valores: [texto], nota: texto, usuario }) };
  }
  throw err(400, 'Esa acción no existe.');
}

/**
 * Editar (título, descripción, fecha, zona, cantidad) y/o REASIGNAR. Solo mientras no esté verificada ni cancelada; reasignar, solo si
 * sigue abierta (si ya está hecha, primero se devuelve). Reasignar la deja pendiente de nuevo. Devuelve { t, reasignada, asignado }.
 */
async function editar({ id, b, usuario, gestion, asignables }) {
  const t = await tareaGestionable(id, usuario, gestion);
  if (!['pendiente', 'en_curso', 'hecha'].includes(t.estado)) throw err(409, 'Esa tarea ya está cerrada: no se puede cambiar.');
  const { errores, datos } = validarTarea(b, { parcial: true, hoyTexto: await hoy() });
  delete datos.tipo;                                     // el tipo no se cambia: otra evidencia sería otra tarea
  if (errores.length) throw err(400, errores.join(' '));
  const sets = [], valores = [], cambios = [];
  for (const k of ['titulo', 'descripcion', 'fecha_limite']) if (datos[k] !== undefined && String(datos[k] || '') !== String(t[k] || '')) { sets.push(`${k} = ?`); valores.push(datos[k]); cambios.push(k); }
  if (datos.cantidad_prevista !== undefined && t.tipo === 'entrega' && (datos.cantidad_prevista || null) !== (t.cantidad_prevista || null)) { sets.push('cantidad_prevista = ?'); valores.push(datos.cantidad_prevista || null); cambios.push('cantidad_prevista'); }
  if (b.territorio_id !== undefined || b.zona_texto !== undefined) {
    const z = await resolverZona({ territorio_id: datos.territorio_id, zona_texto: datos.zona_texto });
    if (t.tipo === 'visita' && !z.territorio_id && !z.zona_texto) throw err(400, 'Una visita necesita el barrio o la vereda.');
    sets.push('territorio_id = ?', 'zona_texto = ?'); valores.push(z.territorio_id, z.zona_texto); cambios.push('zona');
  }
  let reasignada = false, asignado = null;
  if (b.asignada_a !== undefined && Number(b.asignada_a) !== Number(t.asignada_a)) {
    if (!ABIERTAS.includes(t.estado)) throw err(409, 'Para cambiar de responsable, primero devuelve la tarea.');
    asignado = await asignadoValido(asignables, b.asignada_a);
    if ((await ramaDe(usuario.id) || null) !== (await ramaDe(asignado.id) || null)) throw err(400, 'Esa persona es de otra campaña: no se le puede asignar desde aquí.');
    sets.push('asignada_a = ?', "estado = 'pendiente'", 'no_pudo_en = NULL', 'no_pudo_nota = NULL', 'iniciada_en = NULL'); valores.push(asignado.id);
    reasignada = true;
  }
  if (!sets.length) return { t, reasignada: false, asignado: null, cambios: [] };
  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    const [r] = await cx.query(`UPDATE tareas SET ${sets.join(', ')} WHERE id = ? AND estado = ?`, [...valores, t.id, t.estado]);
    if (!r.affectedRows) { await cx.rollback(); throw err(409, 'La tarea cambió mientras tanto. Vuelve a abrirla.'); }
    if (reasignada) await historial(cx, t.id, { tipo: 'reasignada', estado_antes: t.estado, estado_despues: 'pendiente', asignada_antes: t.asignada_a, asignada_despues: asignado.id, usuario });
    if (cambios.length) await historial(cx, t.id, { tipo: 'editada', nota: `Cambió: ${cambios.join(', ')}.`, usuario });
    await cx.commit();
  } catch (e) {
    try { await cx.rollback(); } catch (_) { /* ya cerrada */ }
    throw e;
  } finally { cx.release(); }
  return { t, reasignada, asignado, cambios };
}

module.exports = {
  TIPOS, ESTADOS, ETIQUETA_ESTADO, ABIERTAS, TIPOS_ZONA, ROLES_ASIGNABLES, MAX_FOTOS, TAMANO_MAXIMO_FOTO, DIR_FOTOS, COLUMNAS, UNIONES,
  permisosDe, validarTarea, resolverZona, buscarZonas, guardarFoto, rutaDeFoto, borrarArchivo, filaPublica, resumenMisTareas, hoy,
  crear, ejecutar, resolver, editar, tareaGestionable, soloMismaRama, horaDeMarca, posicionValida, historial, asignadoValido,
};
