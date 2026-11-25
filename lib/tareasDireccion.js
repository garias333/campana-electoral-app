/**
 * «TAREAS DE DIRECCIÓN» (orden 116) — la sección privada del candidato y del superadministrador.
 *
 * NO es «Tareas» (public/tareas.html, parches 305 y 306: las tareas de CAMPO de los líderes por barrio, con evidencia y metas). Son tablas, rutas y pantallas aparte:
 * `tareas_direccion` y `tareas_direccion_eventos`, /api/tareas-direccion, public/tareas-direccion.html y /app/candidato-tareas.html. Aquí vive TODA la lógica:
 *   · quién entra (candidato y superadministrador, y nadie más: ni un administrador sin la casilla «Es el candidato»);
 *   · crear, editar, mover entre columnas, marcar realizada, reabrir, eliminar y el historial;
 *   · el AVISO AUTOMÁTICO 3 días antes (SMS, o «Aviso en la app» si el responsable es el candidato), una sola vez por tarea y por fecha límite.
 * Las reglas de fechas y textos están en public/js/tareas-direccion-reglas.js (el mismo archivo que usan las pantallas: así lo que dice el formulario es lo que hace el servidor).
 *
 * EL AVISO, EN UNA FRASE: cada día a las 08:00 de Colombia se revisan las tareas no realizadas con el aviso programado cuya fecha ya llegó; cada una se RECLAMA con un
 * UPDATE condicional (`aviso_estado = 'programado'` → `'enviado'`) ANTES de hablar con el proveedor. Dos procesos, o un reinicio a media vuelta, no pueden mandar dos veces:
 * el segundo UPDATE no encuentra nada que cambiar. Si el proveedor falla, la fila queda `fallido` con el motivo y NO se reintenta sola (un SMS repetido molesta más de lo que ayuda).
 *
 * PRIVACIDAD. Las tareas no salen en ningún otro módulo: ni exportaciones, ni dashboards, ni búsquedas. Y el «Aviso en la app» se guarda como una campaña `push` de nombre
 * «Tarea de dirección · aviso» (así lo lee «Mis avisos»); lib/alcanceCampanas.js la saca del historial del CRM para que ningún administrador lea el título de una tarea ajena.
 */
'use strict';

const pool = require('../config/db');
const R = require('../public/js/tareas-direccion-reglas');
const { transliterarSms } = require('./transliterarSms');
const { analizarTexto } = require('./sms');
const { esCandidato } = require('../config/esCandidato');
const { esSuperadmin } = require('../config/superadmin');

const NOMBRE_CAMPANA_AVISO = 'Tarea de dirección · aviso';
const ESTADOS = ['pendiente', 'en_curso', 'hecha'];
const PRIORIDADES = ['normal', 'urgente'];

/* Todo lo que sale a la calle, reemplazable en las pruebas (no se manda nada real). */
const deps = {
  reloj: () => new Date(),
  /** Manda el SMS y devuelve el id del proveedor. Lanza si no salió (con `.codigo` 'FUERA_DE_FRANJA' si es la hora). */
  enviarSms: async (celular, texto, o) => {
    const { sid } = await require('../config/sms').enviarSMS(celular, texto, undefined,
      { origen: 'tarea_direccion', loteId: `tareadir-${o.tareaId}`, contactoId: o.tareaId, consentimiento: true });
    return sid || null;
  },
  /** Deja el aviso en «Mis avisos» del usuario y, si hay dispositivo, lo empuja al teléfono. */
  enviarApp: async (usuarioId, nombre, titulo, texto) => {
    const [c] = await pool.query(
      `INSERT INTO comunicaciones_campanas (nombre, canal, asunto, mensaje, filtros, estado, total_destinatarios, enviados, enviado_en)
       VALUES (?, 'push', ?, ?, '{}', 'enviado', 1, 1, NOW())`, [NOMBRE_CAMPANA_AVISO, titulo, texto]);
    await pool.query(
      `INSERT INTO comunicaciones_envios (campana_id, destinatario_tipo, destinatario_id, destinatario_nombre, destinatario_contacto, estado, enviado_en)
       VALUES (?, 'manual', NULL, ?, ?, 'enviado', NOW())`, [c.insertId, String(nombre || '').slice(0, 150), String(usuarioId)]);
    try { await require('../config/push').enviarAUsuario(usuarioId, { titulo, cuerpo: texto, url: '/app/candidato-tareas.html', tag: `tarea-dir-${c.insertId}` }); }
    catch (_) { /* sin dispositivo o sin llaves: el aviso queda en «Mis avisos» igual */ }
    return `app:${c.insertId}`;
  },
  /** La firma que el proveedor pega a cada SMS (cuenta en el segmento). */
  firma: async () => {
    try { return (await require('../config/sms').configCampana()).firma || ''; } catch (_) { return ''; }
  },
};

/* ---------------------------------------------------------------------------------------------------------------------------------
   QUIÉN ENTRA
   --------------------------------------------------------------------------------------------------------------------------------- */

/** El candidato (rol candidato, o administrador marcado, también en sesión «solo candidato») y el superadministrador. NADIE más: no es un permiso de la matriz. */
async function puedeEntrar(usuario) {
  if (!usuario || !usuario.id) return false;
  try { return (await esCandidato(usuario)) || (await esSuperadmin(usuario)); }
  catch (_) { return false; }   // falla cerrado
}

/** Middleware de /api/tareas-direccion. Detrás de requireAuth. */
async function requiereDireccion(req, res, next) {
  if (await puedeEntrar(req.session && req.session.usuario)) return next();
  return res.status(403).json({ error: 'No tiene permiso para esta sección.' });
}

/* ---------------------------------------------------------------------------------------------------------------------------------
   TEXTOS
   --------------------------------------------------------------------------------------------------------------------------------- */

/** Un texto libre apto para un SMS GSM-7: sin tildes ni eñe, sin comillas rizadas ni caracteres fuera del alfabeto, en una sola línea. */
function limpiarParaSms(texto) {
  return transliterarSms(String(texto == null ? '' : texto))
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .,;:!?\-()/&%$#@"'+=*]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * «Hola {primer nombre}, recuerda tu tarea: {titulo}. Vence el {d mmm}.» en UN solo segmento CONTANDO la firma del proveedor. Si no cabe, el título se recorta con «...».
 * Nunca menciona el cargo al que aspira el candidato (precampaña). Devuelve null si ni con el título mínimo cabe.
 */
function armarSms({ nombre, titulo, fechaLimite, firma }) {
  const quien = limpiarParaSms(R.primerNombre(nombre)).slice(0, 20) || 'hola';
  const vence = R.formatoCorto(fechaLimite);
  const t0 = limpiarParaSms(titulo);
  const armar = (t) => `Hola ${quien}, recuerda tu tarea: ${t}${/[.!?]$/.test(t) ? '' : '.'} Vence el ${vence}.`;
  const cabe = (texto) => analizarTexto(texto, firma || '').segmentos <= 1;
  if (cabe(armar(t0))) return armar(t0);
  for (let n = t0.length - 1; n >= 6; n--) {
    const t = t0.slice(0, n).trimEnd().replace(/[.,;:\-]+$/, '') + '...';
    if (cabe(armar(t))) return armar(t);
  }
  return null;
}

/** El texto del «Aviso en la app» (sin llaves: «Mis avisos» sustituye {variables}). */
function armarTextoApp({ titulo, fechaLimite }) {
  const t = String(titulo || '').replace(/[{}]/g, '').trim();
  return `Recuerde su tarea: ${t}. Vence el ${R.formatoCorto(fechaLimite)}.`;
}

/* ---------------------------------------------------------------------------------------------------------------------------------
   FECHAS Y SELLOS (hora de Colombia, igual que la sesión de MySQL: -05:00)
   --------------------------------------------------------------------------------------------------------------------------------- */

const CINCO_HORAS = 5 * 60 * 60 * 1000;
/** «AAAA-MM-DD hh:mm:ss» en hora de Colombia, para escribirlo en un DATETIME. */
function aSello(fecha) { return new Date(fecha.getTime() - CINCO_HORAS).toISOString().slice(0, 19).replace('T', ' '); }

/* ---------------------------------------------------------------------------------------------------------------------------------
   EL CANDIDATO COMO RESPONSABLE, Y EL CANAL DEL AVISO
   --------------------------------------------------------------------------------------------------------------------------------- */

/** Los ids de usuario que son EL candidato: rol «candidato» o administrador marcado «Es el candidato». */
async function idsDeCandidato() {
  try {
    const [f] = await pool.query(
      `SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.activo = 1 AND u.es_superadmin = 0 AND (r.nombre = 'candidato' OR (r.nombre = 'admin' AND u.es_candidato = 1))`);
    return new Set(f.map((x) => Number(x.id)));
  } catch (_) { return new Set(); }
}

async function tieneDispositivo(usuarioId) {
  try {
    const [f] = await pool.query('SELECT 1 FROM push_suscripciones WHERE usuario_id = ? LIMIT 1', [usuarioId]);
    return f.length > 0;
  } catch (_) { return false; }
}

/** 'app' | 'sms' | null (sin forma de avisarle). Es la regla de las tareas ANTIGUAS (responsable escrito a mano); las nuevas usan canalDeTarea(). */
async function canalDe(usuarioId, celular, candidatos) {
  if (usuarioId && candidatos.has(Number(usuarioId))) return 'app';
  if (R.normalizarCelular(celular)) return 'sms';
  if (usuarioId && await tieneDispositivo(usuarioId)) return 'app';
  return null;
}

/* ---------------------------------------------------------------------------------------------------------------------------------
   EL RESPONSABLE (orden 119): SOLO el candidato, una persona del organigrama o un coordinador activo.
   La tarea guarda DE DÓNDE salió (`responsable_tipo` + `responsable_ref_id`) y copias del nombre, el cargo y el celular. Lo que manda es el ORIGEN: el nombre, el cargo y
   —sobre todo— el celular se leen del organigrama o de la ficha del coordinador cuando se muestra la tarea y cuando sale el aviso. Si alguien corrige un celular en el
   organigrama o en Estructura, el aviso lo usa sin editar la tarea; la copia (`responsable_celular`) solo sirve de respaldo para las tareas antiguas y para el historial.
   Una tarea con `responsable_tipo` NULL es de ANTES de la orden 119 (el responsable se escribió a mano): sigue viva, con la marca «Responsable fuera del organigrama».
   --------------------------------------------------------------------------------------------------------------------------------- */

const TIPOS_RESPONSABLE = ['candidato', 'organigrama', 'coordinador'];
const ROTULO_NIVEL = { nivel_1: 'Nivel 1', nivel_2: 'Nivel 2', nivel_3: 'Nivel 3', nivel_4: 'Nivel 4', nivel_5: 'Nivel 5', nivel_6: 'Nivel 6', asesores: 'Asesores' };
const ORDEN_NIVEL = { nivel_1: 1, nivel_2: 2, nivel_3: 3, nivel_4: 4, nivel_5: 5, nivel_6: 6, asesores: 7 };
const MENSAJE_ELEGIR = 'Elija al responsable de la lista: el candidato, una persona del organigrama o un coordinador.';

/** Para comparar nombres: sin tildes, sin mayúsculas, un solo espacio. */
function claveNombre(t) { return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function nombreDeNodo(n) { return limpiarTexto([n.nombres, n.apellidos].filter(Boolean).join(' ') || n.nombre || '', 150); }

/**
 * Todo lo necesario para resolver responsables, leído UNA vez por petición (el organigrama y los coordinadores son cientos de filas, no miles):
 *   candidatos: Map id → { id, nombre, telefono }      coords: Map id → { id, nombre, telefono, email }      nodos: Map id → { id, cargo, nombre, nivel, telefono, email, coordId }
 * `coordId`: el coordinador que es la MISMA persona que el nodo (no hay llave entre las tablas: coincide el correo, el celular o el nombre completo).
 * `enOrganigrama`: ids de coordinadores que ya salen como nodo (en el selector van una sola vez, en «Organigrama»).
 */
async function cargarOrigen() {
  const o = { candidatos: new Map(), coords: new Map(), nodos: new Map(), enOrganigrama: new Set() };
  try {
    const [c] = await pool.query(
      `SELECT u.id, u.nombre, u.telefono FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.activo = 1 AND u.es_superadmin = 0 AND (r.nombre = 'candidato' OR (r.nombre = 'admin' AND u.es_candidato = 1))`);
    c.forEach((x) => o.candidatos.set(Number(x.id), { id: Number(x.id), nombre: x.nombre, telefono: x.telefono }));
  } catch (_) { /* sin candidato: falla cerrado */ }
  try {
    const [c] = await pool.query(
      `SELECT u.id, u.nombre, u.telefono, u.email FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.activo = 1 AND u.es_superadmin = 0 AND r.nombre = 'coordinador' ORDER BY u.nombre`);
    c.forEach((x) => o.coords.set(Number(x.id), { id: Number(x.id), nombre: x.nombre, telefono: x.telefono, email: x.email }));
  } catch (_) { /* sin coordinadores */ }
  try {
    const [n] = await pool.query('SELECT id, cargo, nombre, nombres, apellidos, telefono, email, nivel FROM organigrama_nodos');
    const porCorreo = new Map(); const porCelular = new Map(); const porNombre = new Map();
    for (const u of o.coords.values()) {
      const e = String(u.email || '').trim().toLowerCase(); if (e) porCorreo.set(e, u.id);
      const t = R.normalizarCelular(u.telefono); if (t) porCelular.set(t, u.id);
      const k = claveNombre(u.nombre); if (k) porNombre.set(k, u.id);
    }
    n.forEach((x) => {
      const nombre = nombreDeNodo(x);
      if (!nombre) return;   // un cargo sin persona (vacante) no es un responsable
      const coordId = porCorreo.get(String(x.email || '').trim().toLowerCase()) || porCelular.get(R.normalizarCelular(x.telefono)) || porNombre.get(claveNombre(nombre)) || null;
      if (coordId) o.enOrganigrama.add(coordId);
      o.nodos.set(Number(x.id), { id: Number(x.id), cargo: limpiarTexto(x.cargo, 100), nombre, nivel: x.nivel || null, telefono: x.telefono, email: x.email, coordId });
    });
  } catch (_) { /* sin organigrama */ }
  return o;
}

/** El responsable tal como está AHORA en su origen: { tipo, ref_id, usuario_id, nombre, cargo, celular }, o null si ya no existe (o nunca fue del origen que dice). */
function resolverResponsable(tipo, refId, o) {
  const id = Number(refId);
  if (!TIPOS_RESPONSABLE.includes(tipo) || !Number.isInteger(id) || id < 1) return null;
  if (tipo === 'candidato') {
    const u = o.candidatos.get(id);
    return u ? { tipo, ref_id: id, usuario_id: id, nombre: u.nombre, cargo: 'Candidato', celular: R.normalizarCelular(u.telefono) || null } : null;
  }
  if (tipo === 'coordinador') {
    const u = o.coords.get(id);
    return u ? { tipo, ref_id: id, usuario_id: id, nombre: u.nombre, cargo: 'Coordinador', celular: R.normalizarCelular(u.telefono) || null } : null;
  }
  const n = o.nodos.get(id);
  if (!n) return null;
  const hermano = n.coordId ? o.coords.get(n.coordId) : null;   // si es también coordinador y el nodo no trae celular, sirve el de su ficha
  return { tipo, ref_id: id, usuario_id: null, nombre: n.nombre, cargo: n.cargo || 'Organigrama', celular: R.normalizarCelular(n.telefono) || (hermano && R.normalizarCelular(hermano.telefono)) || null };
}

/** El responsable VIVO de una fila (null si es una tarea antigua, de responsable escrito a mano, o si la persona ya no está en su origen). */
function responsableDeFila(f, o) { return f.responsable_tipo ? resolverResponsable(f.responsable_tipo, f.responsable_ref_id, o) : null; }

/** El celular con el que HOY se le avisa: el de su origen; en una tarea antigua, el que se escribió a mano. */
function celularDeFila(f, o) {
  if (!f.responsable_tipo) return R.normalizarCelular(f.responsable_celular) || null;
  const r = responsableDeFila(f, o);
  return r ? r.celular : null;
}

/** 'app' | 'sms' | null. El candidato, por la app; los demás, por SMS al celular ACTUAL de su origen; sin celular, por la app solo si tienen cuenta con dispositivo. */
async function canalDeFila(f, o) {
  if (!f.responsable_tipo) return canalDe(f.responsable_usuario_id, f.responsable_celular, new Set(o.candidatos.keys()));
  const r = responsableDeFila(f, o);
  if (!r) return null;
  if (r.tipo === 'candidato') return 'app';
  if (r.celular) return 'sms';
  if (r.usuario_id && await tieneDispositivo(r.usuario_id)) return 'app';
  return null;
}

/**
 * QUÉ PASA CON EL AVISO. Devuelve { aviso_estado, aviso_para }.
 *   t:   { estado, aviso_activo, aviso_estado, aviso_para, fecha_limite }
 *   ctx: { hoy, minutos, canal, cambio } — `cambio`: hubo un cambio que obliga a recalcular (fecha límite, celular, responsable o el interruptor).
 *        { fechaMasAdelante } — la fecha límite se movió hacia adelante: un aviso nuevo por cada fecha límite.
 */
function planAviso(t, ctx) {
  if (t.estado === 'hecha') {
    // Se conserva `aviso_para` para saber, al reabrir, si su fecha ya pasó.
    return t.aviso_estado === 'programado' ? { aviso_estado: 'cancelado', aviso_para: t.aviso_para } : { aviso_estado: t.aviso_estado, aviso_para: t.aviso_para };
  }
  if (!Number(t.aviso_activo)) return { aviso_estado: 'cancelado', aviso_para: null };
  if (t.aviso_estado === 'enviado' && !ctx.fechaMasAdelante) return { aviso_estado: 'enviado', aviso_para: t.aviso_para };
  if (t.aviso_estado === 'fallido' && !ctx.cambio) return { aviso_estado: 'fallido', aviso_para: t.aviso_para };
  if (!ctx.canal) return { aviso_estado: 'sin_celular', aviso_para: null };
  const ap = R.avisoPara(t.fecha_limite, ctx.hoy, ctx.minutos);
  return ap ? { aviso_estado: 'programado', aviso_para: ap } : { aviso_estado: 'no_aplica', aviso_para: null };
}

/* ---------------------------------------------------------------------------------------------------------------------------------
   SERIALIZAR
   --------------------------------------------------------------------------------------------------------------------------------- */

function serializar(f, o, hoy) {
  const r = responsableDeFila(f, o);
  const esCand = f.responsable_tipo ? !!(r && r.tipo === 'candidato') : (!!f.responsable_usuario_id && o.candidatos.has(Number(f.responsable_usuario_id)));
  const celular = celularDeFila(f, o);
  const fuera = !r;   // antigua (escrita a mano) o ya no está en el organigrama ni entre los coordinadores
  return {
    id: f.id,
    titulo: f.titulo,
    responsable: {
      usuario_id: (r ? r.usuario_id : f.responsable_usuario_id) || null, nombre: r ? r.nombre : f.responsable_nombre, cargo: r ? r.cargo : f.responsable_cargo,
      celular: celular || null, es_candidato: esCand, tipo: f.responsable_tipo || null, ref_id: f.responsable_ref_id || null, fuera_del_organigrama: fuera,
    },
    fecha_limite: f.fecha_limite,
    prioridad: f.prioridad,
    estado: f.estado,
    aviso_activo: Number(f.aviso_activo) === 1,
    aviso_estado: f.aviso_estado,
    aviso_canal: f.aviso_canal || null,
    aviso_para: f.aviso_para || null,
    aviso_enviado_en: f.aviso_enviado_en || null,
    // Lo que se prevé usar (para la línea de la tarjeta): el candidato recibe en la app; el resto por SMS.
    canal_previsto: esCand ? 'app' : (celular ? 'sms' : null),
    realizada_en: f.realizada_en || null,
    creada_en: f.creada_en,
    actualizada_en: f.actualizada_en,
    estado_fecha: R.estadoFecha(f.fecha_limite, hoy, f.estado === 'hecha'),
  };
}

const COLUMNAS = `id, titulo, responsable_usuario_id, responsable_tipo, responsable_ref_id, responsable_nombre, responsable_cargo, responsable_celular, fecha_limite, prioridad, estado,
  aviso_activo, aviso_estado, aviso_canal, aviso_para, aviso_enviado_en, realizada_en, creada_por, creada_en, actualizada_en`;

async function leerFila(id, conexion = pool) {
  const [[f]] = await conexion.query(`SELECT ${COLUMNAS} FROM tareas_direccion WHERE id = ?`, [id]);
  return f || null;
}

async function evento(tareaId, tipo, detalle, usuarioId, cuando) {
  await pool.query(
    'INSERT INTO tareas_direccion_eventos (tarea_id, tipo, detalle, usuario_id, creado_en) VALUES (?, ?, ?, ?, ?)',
    [tareaId, tipo, detalle ? String(detalle).slice(0, 250) : null, usuarioId || null, aSello(cuando || deps.reloj())]);
}

/* ---------------------------------------------------------------------------------------------------------------------------------
   VALIDAR LO QUE LLEGA DEL FORMULARIO
   --------------------------------------------------------------------------------------------------------------------------------- */

function limpiarTexto(t, max) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, max); }

/** Devuelve { error } o { valores }. `parcial`: en una edición solo se validan los campos que llegan. */
function validar(d, parcial) {
  const v = {};
  const tiene = (k) => d[k] !== undefined;
  if (!parcial || tiene('titulo')) {
    v.titulo = limpiarTexto(d.titulo, 200);
    if (!v.titulo) return { error: 'Escriba qué hay que hacer.' };
  }
  // El responsable NO se valida aquí: se resuelve contra su origen (validarResponsable).
  if (!parcial || tiene('fecha_limite')) {
    if (!R.valida(d.fecha_limite) || d.fecha_limite < '2000-01-01' || d.fecha_limite > '2100-12-31') return { error: 'Elija la fecha límite.' };
    v.fecha_limite = d.fecha_limite;
  }
  if (!parcial || tiene('prioridad')) {
    const p = d.prioridad === undefined ? 'normal' : String(d.prioridad);
    if (!PRIORIDADES.includes(p)) return { error: 'La prioridad es Normal o Urgente.' };
    v.prioridad = p;
  }
  if (!parcial || tiene('aviso_activo')) {
    v.aviso_activo = d.aviso_activo === undefined ? 1 : (d.aviso_activo === true || d.aviso_activo === 1 || d.aviso_activo === '1' || d.aviso_activo === 'true' ? 1 : 0);
  }
  return { valores: v };
}

/* ---------------------------------------------------------------------------------------------------------------------------------
   LISTAR, CREAR, EDITAR, MOVER, ELIMINAR
   --------------------------------------------------------------------------------------------------------------------------------- */

/**
 * El tablero. En «Hechas» solo van las de los últimos 30 días (las más recientes arriba) salvo `todasLasHechas`. Orden de las otras dos: por fecha límite, lo vencido arriba.
 */
async function listar({ todasLasHechas = false, ahora = deps.reloj() } = {}) {
  const { hoy } = R.enColombia(ahora);
  const desde = aSello(new Date(ahora.getTime() - 30 * 86400000));
  const [filas] = await pool.query(
    `SELECT ${COLUMNAS} FROM tareas_direccion
      WHERE estado <> 'hecha' OR ? OR realizada_en >= ?
      ORDER BY (estado = 'hecha'), IF(estado = 'hecha', 0, UNIX_TIMESTAMP(fecha_limite)), realizada_en DESC, id DESC`,
    [todasLasHechas ? 1 : 0, desde]);
  const [[tot]] = await pool.query(`SELECT COUNT(*) AS n FROM tareas_direccion WHERE estado = 'hecha'`);
  const origen = await cargarOrigen();
  const tareas = filas.map((f) => serializar(f, origen, hoy));
  const hechasMostradas = tareas.filter((t) => t.estado === 'hecha').length;
  return { hoy, tareas, hechas_total: Number(tot.n) || 0, hechas_mostradas: hechasMostradas };
}

async function detalle(id, { ahora = deps.reloj() } = {}) {
  const f = await leerFila(id);
  if (!f) return null;
  const { hoy } = R.enColombia(ahora);
  const [ev] = await pool.query('SELECT id, tipo, detalle, creado_en FROM tareas_direccion_eventos WHERE tarea_id = ? ORDER BY id', [id]);
  return { hoy, tarea: serializar(f, await cargarOrigen(), hoy), eventos: ev };
}

/** Lo que el celular pone en Inicio y en «Más»: cuántas vencidas y cuántas vencen en los próximos 3 días. */
async function resumen({ ahora = deps.reloj() } = {}) {
  const { hoy } = R.enColombia(ahora);
  const [[r]] = await pool.query(
    `SELECT SUM(fecha_limite < ?) AS vencidas, SUM(fecha_limite >= ? AND fecha_limite <= ?) AS proximas
       FROM tareas_direccion WHERE estado <> 'hecha'`, [hoy, hoy, R.sumarDias(hoy, 3)]);
  return { vencidas: Number(r.vencidas) || 0, vencen_en_3_dias: Number(r.proximas) || 0 };
}

/**
 * El responsable que llega del formulario: { responsable_tipo, responsable_ref_id }. Devuelve { error } o { valores } con las columnas a guardar.
 * Se rechaza (400) todo lo que no sea el candidato, una persona del organigrama o un coordinador activo: un líder, un sublíder, un id inventado o un nombre escrito a mano.
 * El nombre, el cargo y el celular NUNCA se toman del cuerpo de la petición: se leen del origen.
 */
function validarResponsable(d, o) {
  const tipo = d.responsable_tipo === undefined || d.responsable_tipo === null ? '' : String(d.responsable_tipo);
  if (!tipo || d.responsable_ref_id === undefined || d.responsable_ref_id === null || d.responsable_ref_id === '') return { error: MENSAJE_ELEGIR };
  if (!TIPOS_RESPONSABLE.includes(tipo)) return { error: MENSAJE_ELEGIR };
  const r = resolverResponsable(tipo, d.responsable_ref_id, o);
  if (!r) return { error: 'Ese responsable no está en el organigrama ni entre los coordinadores de la campaña. ' + MENSAJE_ELEGIR };
  return { valores: {
    responsable_tipo: r.tipo, responsable_ref_id: r.ref_id, responsable_usuario_id: r.usuario_id, responsable_nombre: limpiarTexto(r.nombre, 150),
    responsable_cargo: limpiarTexto(r.cargo, 100), responsable_celular: r.celular,
  } };
}

async function crear(datos, usuarioId, { ahora = deps.reloj() } = {}) {
  const val = validar(datos || {}, false);
  if (val.error) return { error: val.error };
  const origen = await cargarOrigen();
  const rv = validarResponsable(datos || {}, origen);
  if (rv.error) return { error: rv.error };
  const v = Object.assign({}, val.valores, rv.valores);
  const { hoy, minutos } = R.enColombia(ahora);
  const canal = await canalDeFila(v, origen);
  const plan = planAviso({ estado: 'pendiente', aviso_activo: v.aviso_activo, aviso_estado: 'programado', fecha_limite: v.fecha_limite },
    { hoy, minutos, canal, cambio: true });
  const [r] = await pool.query(
    `INSERT INTO tareas_direccion (titulo, responsable_usuario_id, responsable_tipo, responsable_ref_id, responsable_nombre, responsable_cargo, responsable_celular, fecha_limite, prioridad,
        estado, aviso_activo, aviso_estado, aviso_para, creada_por, creada_en, actualizada_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?)`,
    [v.titulo, v.responsable_usuario_id, v.responsable_tipo, v.responsable_ref_id, v.responsable_nombre, v.responsable_cargo, v.responsable_celular, v.fecha_limite, v.prioridad,
     v.aviso_activo, plan.aviso_estado, plan.aviso_para, usuarioId || null, aSello(ahora), aSello(ahora)]);
  await evento(r.insertId, 'creada', `Responsable: ${v.responsable_nombre} (${v.responsable_cargo}). Vence el ${R.formatoCorto(v.fecha_limite)}.`, usuarioId, ahora);
  return { tarea: (await detalle(r.insertId, { ahora })).tarea };
}

const ROTULOS = { titulo: 'la tarea', responsable_nombre: 'el responsable', responsable_cargo: 'el cargo', responsable_celular: 'el celular', fecha_limite: 'la fecha límite',
  prioridad: 'la prioridad', aviso_activo: 'el aviso automático', responsable_usuario_id: 'el responsable', responsable_tipo: 'el responsable', responsable_ref_id: 'el responsable' };

async function editar(id, datos, usuarioId, { ahora = deps.reloj() } = {}) {
  const f = await leerFila(id);
  if (!f) return { noExiste: true };
  const val = validar(datos || {}, true);
  if (val.error) return { error: val.error };
  const origen = await cargarOrigen();
  const v = val.valores;
  const eligio = datos && (datos.responsable_tipo !== undefined || datos.responsable_ref_id !== undefined);
  if (eligio) {
    const rv = validarResponsable(datos, origen);
    if (rv.error) return { error: rv.error };
    Object.assign(v, rv.valores);
  } else if (!f.responsable_tipo) {
    // Una tarea de ANTES de la orden 119 (responsable escrito a mano): para tocarla hay que elegir uno de la lista.
    return { error: 'El responsable de esta tarea está fuera del organigrama. ' + MENSAJE_ELEGIR };
  }
  const cambios = [];
  for (const k of Object.keys(v)) {
    const antes = f[k] === undefined || f[k] === null ? null : (k === 'aviso_activo' ? Number(f[k]) : f[k]);
    if (String(antes) !== String(v[k] === undefined ? null : v[k])) cambios.push(k);
  }
  if (!cambios.length) return { tarea: (await detalle(id, { ahora })).tarea, sinCambios: true };
  const nuevo = Object.assign({}, f, v);
  const { hoy, minutos } = R.enColombia(ahora);
  const relevante = cambios.some((k) => ['fecha_limite', 'responsable_celular', 'responsable_usuario_id', 'responsable_tipo', 'responsable_ref_id', 'aviso_activo'].includes(k));
  const canal = await canalDeFila(nuevo, origen);
  const plan = planAviso(nuevo, { hoy, minutos, canal, cambio: relevante, fechaMasAdelante: cambios.includes('fecha_limite') && v.fecha_limite > f.fecha_limite });
  const sets = []; const par = [];
  for (const k of cambios) { sets.push(`${k} = ?`); par.push(v[k]); }
  sets.push('aviso_estado = ?', 'aviso_para = ?', 'actualizada_en = ?'); par.push(plan.aviso_estado, plan.aviso_para, aSello(ahora));
  // Una fecha nueva abre un aviso nuevo: se olvida el envío anterior.
  if (plan.aviso_estado === 'programado' && f.aviso_estado === 'enviado') { sets.push('aviso_enviado_en = NULL', 'aviso_canal = NULL'); }
  par.push(id);
  await pool.query(`UPDATE tareas_direccion SET ${sets.join(', ')} WHERE id = ?`, par);
  const que = [...new Set(cambios.map((k) => ROTULOS[k]))];
  await evento(id, 'editada', `Cambió ${que.join(', ')}.`, usuarioId, ahora);
  if (cambios.includes('aviso_activo')) {
    if (!v.aviso_activo && f.aviso_estado === 'programado') await evento(id, 'aviso_cancelado', 'Se apagó el aviso automático.', usuarioId, ahora);
  }
  return { tarea: (await detalle(id, { ahora })).tarea };
}

/**
 * Pasa la tarea a `pendiente`, `en_curso` o `hecha`.
 *   · a `hecha` (también antes de tiempo): realizada_en = ahora; un aviso programado se CANCELA.
 *   · de `hecha` a otra columna (reabrir, o deshacer): borra realizada_en y re-programa el aviso SI su fecha no ha pasado.
 */
async function cambiarEstado(id, nuevoEstado, usuarioId, { ahora = deps.reloj(), deshacer = false } = {}) {
  if (!ESTADOS.includes(nuevoEstado)) return { error: 'Ese estado no existe.' };
  const f = await leerFila(id);
  if (!f) return { noExiste: true };
  if (f.estado === nuevoEstado) return { tarea: (await detalle(id, { ahora })).tarea, estado_anterior: f.estado, sinCambios: true };
  const { hoy } = R.enColombia(ahora);

  if (nuevoEstado === 'hecha') {
    const [r] = await pool.query(
      `UPDATE tareas_direccion SET estado = 'hecha', realizada_en = ?, actualizada_en = ?,
              aviso_estado = IF(aviso_estado = 'programado', 'cancelado', aviso_estado)
        WHERE id = ? AND estado = ?`, [aSello(ahora), aSello(ahora), id, f.estado]);
    if (!r.affectedRows) return { conflicto: true };
    await evento(id, 'realizada', `Marcada como realizada${f.fecha_limite ? ' · ' + R.textoOportunidad(f.fecha_limite, hoy) : ''}.`, usuarioId, ahora);
    if (f.aviso_estado === 'programado') await evento(id, 'aviso_cancelado', 'Se canceló el aviso automático porque la tarea quedó realizada.', usuarioId, ahora);
    return { tarea: (await detalle(id, { ahora })).tarea, estado_anterior: f.estado };
  }

  if (f.estado === 'hecha') {
    // Reabrir / deshacer: el aviso vuelve solo si estaba cancelado por haberla marcado y su fecha todavía no pasó.
    let avisoEstado = f.aviso_estado; let avisoPara = f.aviso_para;
    if (f.aviso_estado === 'cancelado' && Number(f.aviso_activo)) {
      const canal = await canalDeFila(f, await cargarOrigen());
      if (!canal) { avisoEstado = 'sin_celular'; avisoPara = null; }
      else if (f.aviso_para && f.aviso_para >= hoy && f.fecha_limite >= hoy) { avisoEstado = 'programado'; }
      else { avisoEstado = 'no_aplica'; avisoPara = null; }
    }
    const [r] = await pool.query(
      `UPDATE tareas_direccion SET estado = ?, realizada_en = NULL, aviso_estado = ?, aviso_para = ?, actualizada_en = ? WHERE id = ? AND estado = 'hecha'`,
      [nuevoEstado, avisoEstado, avisoPara, aSello(ahora), id]);
    if (!r.affectedRows) return { conflicto: true };
    await evento(id, 'reabierta', deshacer ? 'Se deshizo «realizada».' : `Se reabrió y volvió a ${nuevoEstado === 'en_curso' ? 'En curso' : 'Pendientes'}.`, usuarioId, ahora);
    return { tarea: (await detalle(id, { ahora })).tarea, estado_anterior: 'hecha' };
  }

  await pool.query('UPDATE tareas_direccion SET estado = ?, actualizada_en = ? WHERE id = ?', [nuevoEstado, aSello(ahora), id]);
  await evento(id, nuevoEstado === 'en_curso' ? 'en_curso' : 'editada', nuevoEstado === 'en_curso' ? 'Pasó a En curso.' : 'Volvió a Pendientes.', usuarioId, ahora);
  return { tarea: (await detalle(id, { ahora })).tarea, estado_anterior: f.estado };
}

async function eliminar(id) {
  const [r] = await pool.query('DELETE FROM tareas_direccion WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/** Anota en el historial que se abrió WhatsApp para recordar la tarea. Devuelve la URL (o null si no hay celular válido). */
async function registrarWhatsapp(id, usuarioId, { ahora = deps.reloj() } = {}) {
  const f = await leerFila(id);
  if (!f) return { noExiste: true };
  const origen = await cargarOrigen();
  const viva = responsableDeFila(f, origen);   // el celular y el nombre de HOY, no la copia
  const url = R.urlWhatsapp(celularDeFila(f, origen), viva ? viva.nombre : f.responsable_nombre, f.titulo, f.fecha_limite);
  if (!url) return { error: 'Sin celular registrado: no hay a quién escribirle por WhatsApp. Agréguelo en el organigrama o en Estructura.' };
  await evento(id, 'whatsapp', `Recordatorio por WhatsApp a ${f.responsable_nombre}.`, usuarioId, ahora);
  return { url };
}

/** Los territorios de cada coordinador (Estructura): { usuario_id → «Manizales, Villamaría» }. Sin tabla o sin territorios, queda vacío. */
async function territoriosDeCoordinadores() {
  const m = new Map();
  try {
    const [f] = await pool.query(
      `SELECT e.usuario_id, t.nombre FROM estructura e JOIN territorios t ON t.id = e.territorio_id
        WHERE e.cargo IN ('coordinador', 'coordinador_organizaciones') AND e.activo = 1 ORDER BY t.nombre`);
    f.forEach((x) => { const k = Number(x.usuario_id); const lista = m.get(k) || []; if (x.nombre && !lista.includes(x.nombre)) lista.push(x.nombre); m.set(k, lista); });
  } catch (_) { /* sin estructura: los coordinadores salen sin territorio */ }
  return new Map([...m].map(([k, v]) => [k, v.slice(0, 3).join(', ') + (v.length > 3 ? '…' : '')]));
}

/**
 * Quién puede ser responsable, en el orden del selector: el candidato arriba; «Organigrama» (las personas del organigrama, por nivel y nombre) y «Coordinadores»
 * (los coordinadores activos que NO están ya en el organigrama: quien sale en los dos aparece una sola vez, en Organigrama). El superadministrador NUNCA aparece.
 * Cada opción trae { tipo, ref_id, nombre, cargo, celular } — el celular ya normalizado (null si no tiene: el formulario lo dice).
 */
async function responsables() {
  const o = await cargarOrigen();
  const terr = await territoriosDeCoordinadores();
  const candidato = [...o.candidatos.values()].map((u) => resolverResponsable('candidato', u.id, o)).map((r) => Object.assign({ es_candidato: true }, r));
  const organigrama = [...o.nodos.values()]
    .sort((a, b) => (ORDEN_NIVEL[a.nivel] || 99) - (ORDEN_NIVEL[b.nivel] || 99) || a.nombre.localeCompare(b.nombre, 'es') || a.id - b.id)
    .map((n) => Object.assign(resolverResponsable('organigrama', n.id, o), { nivel: n.nivel, nivel_rotulo: ROTULO_NIVEL[n.nivel] || '' }));
  const coordinadores = [...o.coords.values()].filter((u) => !o.enOrganigrama.has(u.id))
    .map((u) => Object.assign(resolverResponsable('coordinador', u.id, o), { territorio: terr.get(u.id) || '' }));
  return { candidato, organigrama, coordinadores };
}

/* ---------------------------------------------------------------------------------------------------------------------------------
   EL AVISO AUTOMÁTICO
   --------------------------------------------------------------------------------------------------------------------------------- */

/** Devuelve 'enviado' | 'sin_celular' | 'fallido' | 'diferido' | 'ya' (otro proceso la reclamó, o dejó de aplicar). */
async function procesarAviso(f, ahora, origen) {
  if (origen instanceof Set) origen = await cargarOrigen();   // quien llame con la lista de candidatos de antes
  const canal = await canalDeFila(f, origen);
  if (!canal) {
    const [r] = await pool.query(`UPDATE tareas_direccion SET aviso_estado = 'sin_celular', aviso_para = NULL WHERE id = ? AND aviso_estado = 'programado'`, [f.id]);
    return r.affectedRows ? 'sin_celular' : 'ya';
  }
  // 1. RECLAMAR: un solo proceso gana este UPDATE. Va ANTES de llamar al proveedor.
  const [rec] = await pool.query(
    `UPDATE tareas_direccion SET aviso_estado = 'enviado', aviso_canal = ?, aviso_enviado_en = ?
      WHERE id = ? AND aviso_estado = 'programado' AND estado <> 'hecha' AND aviso_activo = 1`, [canal, aSello(ahora), f.id]);
  if (rec.affectedRows !== 1) return 'ya';

  // 2. ENVIAR
  try {
    if (canal === 'sms') {
      // El celular de HOY, de su origen (organigrama o ficha del coordinador): si lo corrigieron, sirve sin editar la tarea.
      const viva = responsableDeFila(f, origen);
      const celular = celularDeFila(f, origen);
      const texto = armarSms({ nombre: viva ? viva.nombre : f.responsable_nombre, titulo: f.titulo, fechaLimite: f.fecha_limite, firma: await deps.firma() });
      if (!texto) throw new Error('El texto no cabe en un SMS.');
      await deps.enviarSms(celular, texto, { tareaId: f.id });
      if (celular && celular !== R.normalizarCelular(f.responsable_celular)) await pool.query('UPDATE tareas_direccion SET responsable_celular = ? WHERE id = ?', [celular, f.id]);   // la copia de respaldo
      await evento(f.id, 'aviso_enviado', `SMS al ${R.enmascarar(celular)}.`, null, ahora);
    } else {
      await deps.enviarApp(((responsableDeFila(f, origen) || {}).usuario_id) || f.responsable_usuario_id, f.responsable_nombre, 'Tarea por vencer', armarTextoApp({ titulo: f.titulo, fechaLimite: f.fecha_limite }));
      await evento(f.id, 'aviso_enviado', 'Aviso en la app.', null, ahora);
    }
    return 'enviado';
  } catch (err) {
    if (err && err.codigo === 'FUERA_DE_FRANJA') {
      // No es un fallo: es la hora. Se devuelve a «programado» y sale cuando abra la franja.
      await pool.query(`UPDATE tareas_direccion SET aviso_estado = 'programado', aviso_canal = NULL, aviso_enviado_en = NULL WHERE id = ? AND aviso_estado = 'enviado'`, [f.id]);
      return 'diferido';
    }
    const motivo = String((err && err.message) || err).slice(0, 200);
    await pool.query(`UPDATE tareas_direccion SET aviso_estado = 'fallido' WHERE id = ? AND aviso_estado = 'enviado'`, [f.id]);
    await evento(f.id, 'aviso_fallido', motivo, null, ahora);
    return 'fallido';
  }
}

/**
 * Las tareas cuyo aviso quedó en «sin_celular» y a las que YA se les agregó el celular (en el organigrama o en Estructura) vuelven a «programado» sin editar la tarea.
 * Devuelve cuántas se recuperaron.
 */
async function recuperarSinCelular({ ahora, hoy }) {
  const { minutos } = R.enColombia(ahora);
  const [filas] = await pool.query(
    `SELECT ${COLUMNAS} FROM tareas_direccion WHERE estado <> 'hecha' AND aviso_activo = 1 AND aviso_estado = 'sin_celular' AND fecha_limite >= ? ORDER BY id LIMIT 500`, [hoy]);
  if (!filas.length) return 0;
  const origen = await cargarOrigen();
  let n = 0;
  for (const f of filas) {
    const canal = await canalDeFila(f, origen);
    if (!canal) continue;
    const plan = planAviso(f, { hoy, minutos, canal, cambio: true });
    if (plan.aviso_estado === 'sin_celular') continue;
    const [u] = await pool.query(`UPDATE tareas_direccion SET aviso_estado = ?, aviso_para = ? WHERE id = ? AND aviso_estado = 'sin_celular'`, [plan.aviso_estado, plan.aviso_para, f.id]);
    n += u.affectedRows;
  }
  return n;
}

/**
 * Una vuelta del aviso. `ahora` es inyectable (pruebas). Las programadas cuyo vencimiento ya pasó sin salir quedan «no_aplica»: su momento pasó.
 * Devuelve los conteos; `diferidos > 0` quiere decir «hubo SMS fuera de la franja del proveedor: reintentar más tarde».
 */
async function vueltaAvisos({ ahora = deps.reloj() } = {}) {
  const { hoy } = R.enColombia(ahora);
  const r = { revisadas: 0, enviados: 0, sin_celular: 0, fallidos: 0, diferidos: 0, ya: 0, caducadas: 0, recuperadas: 0 };
  const [cad] = await pool.query(
    `UPDATE tareas_direccion SET aviso_estado = 'no_aplica', aviso_para = NULL
      WHERE estado <> 'hecha' AND aviso_estado = 'programado' AND fecha_limite < ?`, [hoy]);
  r.caducadas = cad.affectedRows;
  r.recuperadas = await recuperarSinCelular({ ahora, hoy });
  const [filas] = await pool.query(
    `SELECT ${COLUMNAS} FROM tareas_direccion
      WHERE estado <> 'hecha' AND aviso_activo = 1 AND aviso_estado = 'programado' AND aviso_para IS NOT NULL AND aviso_para <= ? AND fecha_limite >= ?
      ORDER BY id LIMIT 500`, [hoy, hoy]);
  const origen = await cargarOrigen();
  for (const f of filas) {
    r.revisadas++;
    let res;
    try { res = await procesarAviso(f, ahora, origen); }
    catch (err) { console.error('Tareas de dirección (aviso):', err.code || err.message); continue; }
    if (res === 'enviado') r.enviados++;
    else if (res === 'sin_celular') r.sin_celular++;
    else if (res === 'fallido') r.fallidos++;
    else if (res === 'diferido') r.diferidos++;
    else r.ya++;
  }
  return r;
}

/* ---------------------------------------------------------------------------------------------------------------------------------
   EL RELOJ: todos los días a las 08:00 de Colombia, dentro de este mismo proceso (como las demás vueltas diarias: no depende de ningún cron del servidor)
   --------------------------------------------------------------------------------------------------------------------------------- */

const REVISION_MS = 10 * 60 * 1000;
let ultimoDia = null;
let corriendo = false;

/** Una revisión del reloj. La primera vez que son las 08:00 o más y hoy no corrió, corre; un reinicio tardío corre al arrancar. `forzar` (pruebas) salta la hora. */
async function vueltaDiaria({ ahora = deps.reloj(), forzar = false } = {}) {
  const { hoy, minutos } = R.enColombia(ahora);
  if (!forzar) {
    if (ultimoDia === hoy) return { corrio: false, motivo: 'ya corrió hoy' };
    if (minutos < R.HORA_AVISO_MIN) return { corrio: false, motivo: 'todavía no es la hora' };
  }
  const resultado = await vueltaAvisos({ ahora });
  if (resultado.diferidos === 0) ultimoDia = hoy;   // con SMS fuera de franja se vuelve a intentar en la siguiente revisión
  if (resultado.enviados || resultado.fallidos) console.log(`Tareas de dirección: avisos — ${resultado.enviados} enviado(s), ${resultado.fallidos} fallido(s), ${resultado.sin_celular} sin celular.`);
  return { corrio: true, resultado };
}

function iniciar() {
  const correr = async () => {
    if (corriendo) return;
    corriendo = true;
    try { await vueltaDiaria(); }
    catch (err) { if (err && err.code !== 'ER_NO_SUCH_TABLE') console.error('Tareas de dirección (vuelta diaria):', err.code || err.message); }   // sin la sentencia: lleva datos
    finally { corriendo = false; }
  };
  setTimeout(correr, 45 * 1000).unref();      // al arrancar, sin estorbar el arranque
  return setInterval(correr, REVISION_MS).unref();
}

function reiniciarMemoria() { ultimoDia = null; }

module.exports = {
  deps, puedeEntrar, requiereDireccion, limpiarParaSms, armarSms, armarTextoApp, planAviso, canalDe, idsDeCandidato, aSello,
  listar, detalle, resumen, crear, editar, cambiarEstado, eliminar, registrarWhatsapp, responsables,
  procesarAviso, vueltaAvisos, vueltaDiaria, iniciar, reiniciarMemoria, NOMBRE_CAMPANA_AVISO, ESTADOS,
  cargarOrigen, resolverResponsable, validarResponsable, canalDeFila, recuperarSinCelular, TIPOS_RESPONSABLE,
};
