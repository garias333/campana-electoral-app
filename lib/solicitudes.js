/**
 * SOLICITUDES CIUDADANAS (parche 303): necesidades del barrio o la vereda (vías, agua, luz, empleo, salud…) que los líderes registran en
 * campo y la campaña sigue hasta cerrarlas. Las rutas están en routes/solicitudes.routes.js; aquí vive la regla.
 *
 * LO QUE ESTE MÓDULO NO HACE, A PROPÓSITO
 *   · No se liga a votantes: no hay `votante_id`, ni `apoya_a`, ni intención de voto, ni se muestra junto a una ficha de votante. Una
 *     solicitud atendida no puede quedar al lado de «cómo piensa votar» quien la pidió.
 *   · No promete nada: los estados son registrada, en_revision, remitida y cerrada. Nunca «resuelta» ni «cumplida».
 *   · No pide cédula, ni diagnósticos, ni denuncias con nombres.
 *
 * DATOS DEL CIUDADANO. Son opcionales y solo se guardan si quien registra marca que el ciudadano LO AUTORIZA (`autoriza_datos`, con
 * fecha y la huella de la política que se le mostró). Sin autorización la solicitud es anónima: solo barrio o vereda; si llegan nombre o
 * teléfono igual, se DESCARTAN. El teléfono lo ve únicamente el administrador y quien tiene la solicitud asignada.
 *
 * FOTOS. Hasta tres. Se reducen a 1.280 px, se giran según EXIF y se DESCARTAN los metadatos (la ubicación del teléfono incluida), y se
 * guardan en uploads/solicitudes/, que /uploads no sirve (lib/carpetasPrivadas.js). Salen por una ruta que comprueba el alcance.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');

const ESTADOS = ['registrada', 'en_revision', 'remitida', 'cerrada'];
const ETIQUETA_ESTADO = { registrada: 'Registrada', en_revision: 'En revisión', remitida: 'Remitida', cerrada: 'Cerrada' };
const MAX_FOTOS = 3;
const LADO_MAXIMO = 1280;
const TAMANO_MAXIMO_FOTO = 10 * 1024 * 1024;     // lo que se ACEPTA del celular; lo que se GUARDA es el JPEG reducido
const MIN_DESCRIPCION = 10;
const MAX_DESCRIPCION = 2000;
const MAX_NOTA = 1000;
const ROLES_ASIGNABLES = ['admin', 'coordinador', 'lider', 'sublider', 'asistente_administrativo'];
const DIR_FOTOS = path.join(__dirname, '..', 'uploads', 'solicitudes');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asegurarCarpeta() {
  if (!fs.existsSync(DIR_FOTOS)) fs.mkdirSync(DIR_FOTOS, { recursive: true });
}

/* ------------------------------------------------------------------------------------------------------------ PERMISOS */

/**
 * Lo que la matriz le deja hacer a este usuario en el módulo `solicitudes`: { ver, editar, agregar }. El administrador y el
 * superadministrador siempre pueden todo. Falla CERRADO: sin fila o con un error, nada.
 */
async function permisosDe(usuario) {
  if (!usuario) return { ver: false, editar: false, agregar: false };
  // Activar complementos (parche 318): apagado para TODOS los roles, el administrador incluido. Va ANTES del salvoconducto del administrador.
  if (!(await require('./complementos').complementoActivo('solicitudes'))) return { ver: false, editar: false, agregar: false };
  if (usuario.rol === 'admin') return { ver: true, editar: true, agregar: true };
  try {
    const [[u]] = await pool.query('SELECT es_superadmin FROM usuarios WHERE id = ?', [usuario.id]);
    if (u && Number(u.es_superadmin) === 1) return { ver: true, editar: true, agregar: true };
    const [filas] = await pool.query('SELECT permitido, editar, agregar FROM permisos_rol WHERE rol = ? AND modulo = ? LIMIT 1', [usuario.rol, 'solicitudes']);
    if (!filas.length || Number(filas[0].permitido) !== 1) return { ver: false, editar: false, agregar: false };
    return { ver: true, editar: Number(filas[0].editar) === 1, agregar: Number(filas[0].agregar) === 1 };
  } catch (err) {
    console.error('[solicitudes] No se pudo comprobar el permiso:', err.code || err.message);
    return { ver: false, editar: false, agregar: false };
  }
}

/** El teléfono del ciudadano: solo el administrador y quien tiene la solicitud asignada. */
function puedeVerTelefono(usuario, fila) {
  if (!usuario || !fila) return false;
  return usuario.rol === 'admin' || (fila.responsable_id !== null && fila.responsable_id !== undefined && Number(fila.responsable_id) === Number(usuario.id));
}

/* ----------------------------------------------------------------------------------------------------------- VALIDACIÓN */

/** «300 123 4567» → «3001234567». Un celular colombiano: 10 dígitos que empiezan por 3. Devuelve null si no lo es. */
function normalizarTelefono(texto) {
  let d = String(texto || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
  return /^3\d{9}$/.test(d) ? d : null;
}

/** «3001234567» → «*** *** 4567»: de un teléfono solo se deja ver el final. Lo que no es un celular de 10 dígitos sale tapado del todo. */
function enmascararTelefono(texto) {
  const d = String(texto || '').replace(/\D/g, '');
  return d.length === 10 ? `*** *** ${d.slice(-4)}` : (d ? '***' : '');
}

function limpiarTexto(t, max) {
  return String(t === undefined || t === null ? '' : t).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

const aBool = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
const aNumero = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/**
 * Revisa lo que llega al registrar. Devuelve { errores: [texto…], datos } con los campos ya limpios.
 * El ciudadano sin autorización NO conserva nombre ni teléfono (se descartan aunque lleguen).
 */
function validarRegistro(b) {
  const errores = [];
  const datos = {};
  datos.cliente_uuid = String(b.cliente_uuid || '').trim().toLowerCase();
  if (!UUID.test(datos.cliente_uuid)) errores.push('Falta el identificador del registro (cliente_uuid).');
  datos.categoria_id = Number(b.categoria_id);
  if (!Number.isInteger(datos.categoria_id) || datos.categoria_id < 1) errores.push('Elige una categoría.');
  datos.descripcion = limpiarTexto(b.descripcion, MAX_DESCRIPCION);
  if (datos.descripcion.length < MIN_DESCRIPCION) errores.push(`Cuenta la necesidad en al menos ${MIN_DESCRIPCION} letras.`);
  datos.barrio_texto = limpiarTexto(b.barrio_texto, 120) || null;
  datos.territorio_id = Number.isInteger(aNumero(b.territorio_id)) && aNumero(b.territorio_id) > 0 ? aNumero(b.territorio_id) : null;
  if (!datos.barrio_texto && !datos.territorio_id) errores.push('Indica el barrio o la vereda.');
  // La ubicación es un dato, NUNCA un requisito: si no es válida se descarta y la solicitud se guarda igual.
  const lat = aNumero(b.latitud), lng = aNumero(b.longitud);
  const enColombia = Number.isFinite(lat) && Number.isFinite(lng) && lat >= -5 && lat <= 14 && lng >= -82 && lng <= -66;
  datos.latitud = enColombia ? Number(lat.toFixed(7)) : null;
  datos.longitud = enColombia ? Number(lng.toFixed(7)) : null;
  const prec = aNumero(b.precision_m);
  datos.precision_m = enColombia && Number.isFinite(prec) && prec >= 0 && prec < 100000 ? Math.round(prec) : null;
  // El ciudadano.
  datos.autoriza_datos = aBool(b.autoriza_datos) ? 1 : 0;
  datos.ciudadano_nombre = null;
  datos.ciudadano_telefono = null;
  if (datos.autoriza_datos) {
    datos.ciudadano_nombre = limpiarTexto(b.ciudadano_nombre, 150) || null;
    const tel = limpiarTexto(b.ciudadano_telefono, 40);
    datos.ciudadano_telefono = tel ? normalizarTelefono(tel) : null;
    if (tel && !datos.ciudadano_telefono) errores.push('El teléfono tiene que ser un celular de 10 dígitos.');
    if (!datos.ciudadano_nombre && !datos.ciudadano_telefono && !errores.some((e) => /teléfono/.test(e))) errores.push('Si el ciudadano autoriza, escribe su nombre o su teléfono.');
  }
  datos.politica_version = /^[0-9a-f]{16}$/.test(String(b.politica_version || '')) ? String(b.politica_version) : null;
  return { errores, datos };
}

/* ------------------------------------------------------------------------------------------------------------- FOTOS */

/**
 * Reduce la foto (lado mayor 1.280 px, JPEG calidad 72, la gira según EXIF y DESCARTA los metadatos: sharp no los copia a la salida)
 * y la guarda en uploads/solicitudes/. Devuelve { archivo, ancho, alto, bytes }. Lanza si no es una imagen.
 */
async function guardarFoto(buffer) {
  const sharp = require('sharp');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('La foto llegó vacía.');
  if (buffer.length > TAMANO_MAXIMO_FOTO) throw new Error('La foto pesa demasiado.');
  const { data, info } = await sharp(buffer, { failOn: 'error' }).rotate()
    .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72 }).toBuffer({ resolveWithObject: true });
  asegurarCarpeta();
  const archivo = `sol_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.jpg`;
  await fs.promises.writeFile(path.join(DIR_FOTOS, archivo), data);
  return { archivo, ancho: info.width, alto: info.height, bytes: data.length };
}

function rutaDeFoto(archivo) {
  // Solo nombres que esta aplicación generó: nunca una ruta que venga de afuera.
  if (!/^sol_\d+_[0-9a-f]{12}\.jpg$/.test(String(archivo || ''))) return null;
  return path.join(DIR_FOTOS, archivo);
}

async function borrarArchivo(archivo) {
  const ruta = rutaDeFoto(archivo);
  if (!ruta) return;
  try { await fs.promises.unlink(ruta); } catch (err) { if (err.code !== 'ENOENT') console.error('[solicitudes] No se pudo borrar una foto:', err.code || err.message); }
}

/* --------------------------------------------------------------------------------------------------------- ATRIBUCIÓN */

/**
 * De quién cuelga una solicitud, para el alcance (igual que las fichas de votantes):
 *   líder → él; sublíder → él y SU líder (`estructura.supervisor_id`); cualquier otro → él. La rama es la del aspirante que tenga
 *   sublicencia sobre quien registra (lib/ramas.js), o ninguna.
 */
async function atribucionDe(usuario) {
  const r = { lider_id: usuario.id, sublider_id: null, rama_aspirante_id: null, aspirante_id: 0 };
  try {
    if (usuario.rol === 'sublider') {
      const [[e]] = await pool.query(`SELECT supervisor_id FROM estructura WHERE usuario_id = ? AND cargo = 'usuario'`, [usuario.id]);
      r.lider_id = e ? e.supervisor_id : null;
      r.sublider_id = usuario.id;
    }
    const { aspiranteDe } = require('./ramas');
    const rama = await aspiranteDe(pool, usuario.id);
    if (rama) { r.rama_aspirante_id = rama; r.aspirante_id = rama; }
  } catch (err) {
    console.error('[solicitudes] No se pudo resolver la rama:', err.code || err.message);
  }
  return r;
}

/* -------------------------------------------------------------------------------------------------------- REGISTRAR */

async function historial(cx, solicitudId, o) {
  await cx.query(
    `INSERT INTO solicitud_historial (solicitud_id, tipo, estado_antes, estado_despues, responsable_antes, responsable_despues, entidad, nota, usuario_id, usuario_nombre)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [solicitudId, o.tipo, o.estado_antes || null, o.estado_despues || null, o.responsable_antes || null, o.responsable_despues || null,
      o.entidad || null, o.nota ? String(o.nota).slice(0, MAX_NOTA) : null, o.usuario ? o.usuario.id : null, o.usuario ? String(o.usuario.nombre || '').slice(0, 150) : null]);
}

/**
 * Registra una solicitud. `datos` ya pasó por validarRegistro; `fotos` es una lista de Buffers (a lo sumo MAX_FOTOS).
 * IDEMPOTENTE por `cliente_uuid`: un reintento desde el celular devuelve la misma solicitud, sin duplicarla ni volver a guardar fotos.
 * Devuelve { id, duplicado, fotos } o lanza un error con `.estado` (HTTP) y `.mensaje`.
 */
async function registrar({ datos, fotos = [], usuario }) {
  const [[existente]] = await pool.query('SELECT id, registrado_por FROM solicitudes WHERE cliente_uuid = ?', [datos.cliente_uuid]);
  if (existente) {
    if (Number(existente.registrado_por) !== Number(usuario.id) && usuario.rol !== 'admin') {
      const e = new Error('Ese identificador de registro ya existe.'); e.estado = 409; e.mensaje = e.message; throw e;
    }
    const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM solicitud_fotos WHERE solicitud_id = ?', [existente.id]);
    return { id: existente.id, duplicado: true, fotos: Number(n.n) };
  }
  const [[cat]] = await pool.query('SELECT id, nombre FROM solicitud_categorias WHERE id = ? AND activa = 1', [datos.categoria_id]);
  if (!cat) { const e = new Error('Esa categoría no existe o está desactivada.'); e.estado = 400; e.mensaje = e.message; throw e; }
  if (fotos.length > MAX_FOTOS) { const e = new Error(`Máximo ${MAX_FOTOS} fotos.`); e.estado = 400; e.mensaje = e.message; throw e; }

  // El barrio o la vereda: si trae id y existe en la vista territorios, se confirma (y se completa el texto); si no, se conserva el texto.
  let territorioId = datos.territorio_id, barrioTexto = datos.barrio_texto;
  if (territorioId) {
    try {
      const [[t]] = await pool.query(`SELECT id, nombre FROM territorios WHERE id = ? AND tipo IN ('barrio','vereda','comuna','corregimiento')`, [territorioId]);
      if (t) { barrioTexto = barrioTexto || t.nombre; } else { territorioId = null; }
    } catch (_) { territorioId = null; }
  }
  if (!territorioId && !barrioTexto) { const e = new Error('Indica el barrio o la vereda.'); e.estado = 400; e.mensaje = e.message; throw e; }

  // La versión de la política que se le mostró: solo vale si el servidor la tiene archivada; si no, la vigente.
  let version = null;
  if (datos.autoriza_datos) {
    const { versionConocida, huellaDePolitica } = require('../config/politicaVersiones');
    version = datos.politica_version && await versionConocida(datos.politica_version) ? datos.politica_version : null;
    if (!version) {
      const [[p]] = await pool.query(`SELECT contenido FROM contenido_paginas WHERE clave = 'politica_privacidad'`);
      version = p && p.contenido ? huellaDePolitica(p.contenido) : null;
    }
  }

  const atr = await atribucionDe(usuario);
  const guardadas = [];
  const cx = await pool.getConnection();
  try {
    for (const buf of fotos) guardadas.push(await guardarFoto(buf));
    await cx.beginTransaction();
    const [r] = await cx.query(
      `INSERT INTO solicitudes (cliente_uuid, categoria_id, descripcion, estado, territorio_id, barrio_texto, latitud, longitud, precision_m,
         ciudadano_nombre, ciudadano_telefono, autoriza_datos, autoriza_fecha, politica_version, registrado_por, lider_id, sublider_id, rama_aspirante_id, aspirante_id)
       VALUES (?,?,?,'registrada',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [datos.cliente_uuid, datos.categoria_id, datos.descripcion, territorioId, barrioTexto, datos.latitud, datos.longitud, datos.precision_m,
        datos.ciudadano_nombre, datos.ciudadano_telefono, datos.autoriza_datos, null, version,
        usuario.id, atr.lider_id, atr.sublider_id, atr.rama_aspirante_id, atr.aspirante_id]);
    // `autoriza_fecha` con NOW() de la sesión (hora de Colombia) y no con el Date de Node (UTC): se corrige aquí.
    if (datos.autoriza_datos) await cx.query('UPDATE solicitudes SET autoriza_fecha = NOW() WHERE id = ?', [r.insertId]);
    let orden = 0;
    for (const f of guardadas) {
      orden++;
      await cx.query('INSERT INTO solicitud_fotos (solicitud_id, orden, archivo, ancho, alto, bytes) VALUES (?,?,?,?,?,?)', [r.insertId, orden, f.archivo, f.ancho, f.alto, f.bytes]);
    }
    await historial(cx, r.insertId, { tipo: 'registro', estado_despues: 'registrada', usuario });
    await cx.commit();
    return { id: r.insertId, duplicado: false, fotos: guardadas.length, categoria: cat.nombre };
  } catch (err) {
    try { await cx.rollback(); } catch (_) { /* sin transacción */ }
    for (const f of guardadas) await borrarArchivo(f.archivo);
    // Dos celulares (o un doble toque) con el mismo uuid a la vez: el segundo choca con la clave única y devuelve el mismo registro.
    if (err && err.code === 'ER_DUP_ENTRY') {
      const [[ya]] = await pool.query('SELECT id FROM solicitudes WHERE cliente_uuid = ?', [datos.cliente_uuid]);
      if (ya) return { id: ya.id, duplicado: true, fotos: 0 };
    }
    throw err;
  } finally {
    cx.release();
  }
}

/* ------------------------------------------------------------------------------------------------------- CAMBIOS */

const err = (estado, mensaje) => { const e = new Error(mensaje); e.estado = estado; e.mensaje = mensaje; return e; };

/**
 * Cambia el estado. Cualquiera de los cuatro a cualquiera de los otros (se puede reabrir), con estas condiciones:
 *   · «remitida» pide la entidad a la que se remitió;
 *   · «cerrada» pide el motivo (una nota corta).
 * Todo queda en solicitud_historial, con quién y cuándo.
 */
async function cambiarEstado({ id, estado, entidad, nota, usuario }) {
  if (!ESTADOS.includes(estado)) throw err(400, 'Ese estado no existe.');
  const [[s]] = await pool.query('SELECT id, estado FROM solicitudes WHERE id = ?', [id]);
  if (!s) throw err(404, 'Esa solicitud no existe.');
  if (s.estado === estado) throw err(400, 'La solicitud ya está en ese estado.');
  const entidadLimpia = limpiarTexto(entidad, 150);
  const notaLimpia = limpiarTexto(nota, MAX_NOTA);
  if (estado === 'remitida' && !entidadLimpia) throw err(400, 'Escribe a qué entidad se remitió.');
  if (estado === 'cerrada' && notaLimpia.length < 3) throw err(400, 'Escribe el motivo del cierre.');
  const sets = ['estado = ?'];
  const valores = [estado];
  if (estado === 'remitida') { sets.push('entidad_remitida = ?', 'remitida_en = NOW()'); valores.push(entidadLimpia); }
  if (estado === 'cerrada') { sets.push('cerrada_en = NOW()', 'motivo_cierre = ?'); valores.push(notaLimpia.slice(0, 255)); }
  if (estado !== 'cerrada') sets.push('cerrada_en = NULL');
  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    const [r] = await cx.query(`UPDATE solicitudes SET ${sets.join(', ')} WHERE id = ? AND estado = ?`, [...valores, id, s.estado]);
    if (!r.affectedRows) { await cx.rollback(); throw err(409, 'La solicitud cambió mientras tanto. Vuelve a abrirla.'); }
    await historial(cx, id, { tipo: 'estado', estado_antes: s.estado, estado_despues: estado, entidad: estado === 'remitida' ? entidadLimpia : null, nota: notaLimpia || null, usuario });
    await cx.commit();
  } catch (e) {
    try { await cx.rollback(); } catch (_) { /* ya cerrada */ }
    throw e;
  } finally { cx.release(); }
  return { id, estado_antes: s.estado, estado_despues: estado };
}

/** Asigna (o quita) el responsable. `asignables` es la condición del alcance de quien asigna (lib/alcanceSolicitudes.asignablesPara). */
async function asignarResponsable({ id, responsableId, usuario, asignables }) {
  const [[s]] = await pool.query('SELECT id, responsable_id FROM solicitudes WHERE id = ?', [id]);
  if (!s) throw err(404, 'Esa solicitud no existe.');
  let nuevo = null;
  if (responsableId !== null && responsableId !== undefined && responsableId !== '') {
    nuevo = Number(responsableId);
    if (!Number.isInteger(nuevo) || nuevo < 1) throw err(400, 'Ese responsable no es válido.');
    if (!asignables) throw err(403, 'No puedes asignar solicitudes.');
    const [[u]] = await pool.query(
      `SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.id = ? AND u.activo = 1 AND r.nombre IN (?) AND ${asignables.sql}`, [nuevo, ROLES_ASIGNABLES, ...asignables.valores]);
    if (!u) throw err(400, 'No puedes asignarle la solicitud a esa persona.');
  }
  if ((s.responsable_id || null) === nuevo) throw err(400, 'Esa persona ya es la responsable.');
  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    await cx.query('UPDATE solicitudes SET responsable_id = ? WHERE id = ?', [nuevo, id]);
    await historial(cx, id, { tipo: 'responsable', responsable_antes: s.responsable_id, responsable_despues: nuevo, usuario });
    await cx.commit();
  } catch (e) { try { await cx.rollback(); } catch (_) { /* ya cerrada */ } throw e; } finally { cx.release(); }
  return { id, responsable_id: nuevo };
}

/** Una nota interna (solo la ven quienes pueden editar). */
async function agregarNota({ id, nota, usuario }) {
  const texto = limpiarTexto(nota, MAX_NOTA);
  if (texto.length < 2) throw err(400, 'Escribe la nota.');
  const [[s]] = await pool.query('SELECT id FROM solicitudes WHERE id = ?', [id]);
  if (!s) throw err(404, 'Esa solicitud no existe.');
  await historial(pool, id, { tipo: 'nota', nota: texto, usuario });
  return { id };
}

/* --------------------------------------------------------------------------------------------------- ANONIMIZAR */

/**
 * Borra de UNA solicitud el nombre, el teléfono y las fotos (archivos y filas). Deja lo demás —categoría, barrio, estado, historial—,
 * que ya no identifica a nadie. Queda anotado en el historial. Devuelve cuántas fotos se borraron.
 * (La descripción es texto libre y puede nombrar a alguien: quien la anonimiza la revisa si hace falta; no se reescribe sola.)
 */
async function anonimizarSolicitud(id, usuario = null) {
  const [fotos] = await pool.query('SELECT archivo FROM solicitud_fotos WHERE solicitud_id = ?', [id]);
  const [r] = await pool.query(
    `UPDATE solicitudes SET ciudadano_nombre = NULL, ciudadano_telefono = NULL, anonimizada_en = COALESCE(anonimizada_en, NOW()) WHERE id = ?`, [id]);
  if (!r.affectedRows) return null;
  await pool.query('DELETE FROM solicitud_fotos WHERE solicitud_id = ?', [id]);
  for (const f of fotos) await borrarArchivo(f.archivo);
  await historial(pool, id, { tipo: 'anonimizada', nota: `Se borraron los datos del ciudadano y ${fotos.length} foto(s).`, usuario });
  return { fotos: fotos.length };
}

/**
 * El plazo de conservación: { eleccion, meses, desde, vencido } o null. LO COMPARTEN las solicitudes y las fotos de las tareas (parche 306):
 * `anonimizar_solicitudes_meses` meses DESPUÉS de la fecha de la elección. Sin fecha de elección, `eleccion` es null y no se borra nada.
 */
async function estadoDelPlazo() {
  const [[cfg]] = await pool.query(
    `SELECT DATE_FORMAT(fecha_eleccion, '%Y-%m-%d') AS eleccion, anonimizar_solicitudes_meses AS meses,
            DATE_FORMAT(DATE_ADD(fecha_eleccion, INTERVAL anonimizar_solicitudes_meses MONTH), '%Y-%m-%d') AS desde,
            (CURDATE() >= DATE_ADD(fecha_eleccion, INTERVAL anonimizar_solicitudes_meses MONTH)) AS vencido
       FROM configuracion_campana WHERE id = 1`);
  return cfg || null;
}

/**
 * Anonimiza lo que ya cumplió su plazo: `anonimizar_solicitudes_meses` meses DESPUÉS de la fecha de la elección. Sin fecha de elección no
 * hace nada. `aplicar: false` solo cuenta. Lo corre scripts/anonimizar-solicitudes.js (cron del servidor).
 * Devuelve { aplicado, motivo, vencen, anonimizadas, fotos, desde }.
 */
async function anonimizarVencidas({ aplicar = false } = {}) {
  const cfg = await estadoDelPlazo();
  if (!cfg || !cfg.eleccion) return { aplicado: false, motivo: 'No hay fecha de elección en la configuración: no se anonimiza nada.', vencen: 0, anonimizadas: 0, fotos: 0 };
  if (!Number(cfg.vencido)) return { aplicado: false, motivo: `Todavía no: se anonimiza desde el ${cfg.desde} (${cfg.meses} meses después de la elección del ${cfg.eleccion}).`, desde: cfg.desde, vencen: 0, anonimizadas: 0, fotos: 0 };
  const [pendientes] = await pool.query(
    `SELECT s.id FROM solicitudes s
      WHERE s.ciudadano_nombre IS NOT NULL OR s.ciudadano_telefono IS NOT NULL OR EXISTS (SELECT 1 FROM solicitud_fotos f WHERE f.solicitud_id = s.id)`);
  if (!aplicar) return { aplicado: false, motivo: 'Simulación: no se borró nada.', desde: cfg.desde, vencen: pendientes.length, anonimizadas: 0, fotos: 0 };
  let fotos = 0, n = 0;
  for (const p of pendientes) { const r = await anonimizarSolicitud(p.id, null); if (r) { n++; fotos += r.fotos; } }
  return { aplicado: true, motivo: 'Aplicado.', desde: cfg.desde, vencen: pendientes.length, anonimizadas: n, fotos };
}

module.exports = {
  ESTADOS, ETIQUETA_ESTADO, MAX_FOTOS, TAMANO_MAXIMO_FOTO, MIN_DESCRIPCION, MAX_DESCRIPCION, ROLES_ASIGNABLES, DIR_FOTOS,
  permisosDe, puedeVerTelefono, normalizarTelefono, enmascararTelefono, validarRegistro, guardarFoto, rutaDeFoto, borrarArchivo, atribucionDe,
  registrar, cambiarEstado, asignarResponsable, agregarNota, anonimizarSolicitud, anonimizarVencidas, estadoDelPlazo, historial,
};
