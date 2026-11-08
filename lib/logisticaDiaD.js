/**
 * LOGÍSTICA DEL DÍA D (orden 39): refrigerios, almuerzos, kits. Las reglas viven aquí; las rutas (routes/logisticaDiaD.routes.js)
 * sólo las llaman.
 *
 * QUÉ ES CADA COSA
 *   · ÍTEM (`logistica_items`): lo que se entrega, a quién (testigos o conductores) y hasta qué hora. Se siembran tres de fábrica
 *     (lib/logisticaItems.js). Se editan y se desactivan; no se borran.
 *   · PLAN (`logistica_plan`): sólo las CORRECCIONES a mano. La cantidad de un ítem en un puesto es la sugerida —los testigos
 *     activos asignados a ese puesto, incluidos los «coordinadores de puesto»; más los suplentes si el ítem lo pide— salvo que
 *     alguien la haya corregido.
 *   · ENTREGA (`logistica_entregas`): una fila por (ítem, testigo, día). Esa clave única es lo que impide entregar dos veces.
 *
 * LOS CONDUCTORES van aparte: no cuelgan de un puesto (un conductor recorre varios). Un ítem «a conductores» no tiene cantidad por
 * puesto: su total es el número de conductores activos de la campaña, en una fila «Transporte». No se registran sus entregas (ver
 * ESTADO.md): sólo se planea y se compra.
 *
 * QUIÉN PUEDE RECIBIR: cualquier testigo activo asignado al puesto, haya hecho check-in o no. La ALERTA, en cambio, sólo cuenta a los
 * que ya hicieron check-in (llegaron) y todavía no recibieron.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
const { ITEMS_DE_FABRICA } = require('./logisticaItems');
const jornada = require('./jornadaDiaD');
const { cargarTestigos, repartirPorPuesto } = require('./coberturaTestigos');
const { enmascararCedula, normalizarCedula } = require('./normalizarCedula');

const HORA = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;
const DESTINATARIOS = ['testigos', 'conductores'];

/** 'HH:MM:SS' → 'HH:MM' (o null). */
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);
/** Minutos desde medianoche de 'HH:MM[:SS]', o null. */
function minutosDe(t) {
  const m = HORA.exec(String(t || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
/** «12:00» → «12 m.»; «07:00» → «7 a. m.»; «14:30» → «2:30 p. m.». Para el texto de la alerta. */
function horaEnPalabras(t) {
  const min = minutosDe(t);
  if (min === null) return '';
  const h = Math.floor(min / 60), m = min % 60;
  const resto = m ? ':' + String(m).padStart(2, '0') : '';
  if (h === 12 && m === 0) return '12 m.';
  if (h < 12) return `${h === 0 ? 12 : h}${resto} a. m.`;
  return `${h === 12 ? 12 : h - 12}${resto} p. m.`;
}

// ---------------------------------------------------------------------------
// Ítems
// ---------------------------------------------------------------------------

/** Los tres ítems de fábrica para un dueño que todavía no tiene ninguno (la madre ya los recibe en init-db). */
async function asegurarItems(cx, dueno) {
  const [[{ n }]] = await cx.query('SELECT COUNT(*) AS n FROM logistica_items WHERE aspirante_id = ?', [dueno]);
  if (Number(n) > 0) return;
  for (const it of ITEMS_DE_FABRICA) {
    await cx.query('INSERT IGNORE INTO logistica_items (aspirante_id, nombre, destinatario, hora_limite, orden) VALUES (?,?,?,?,?)',
      [dueno, it.nombre, it.destinatario, it.hora, it.orden]);
  }
}

async function listarItems(cx, dueno, { soloActivos = false } = {}) {
  await asegurarItems(cx, dueno);
  const [filas] = await cx.query(
    `SELECT id, nombre, destinatario, TIME_FORMAT(hora_limite, '%H:%i') AS hora_limite, incluir_suplentes, activo, orden
       FROM logistica_items WHERE aspirante_id = ? ${soloActivos ? 'AND activo = 1' : ''} ORDER BY orden, id`, [dueno]);
  return filas.map(f => ({ ...f, incluir_suplentes: !!f.incluir_suplentes, activo: !!f.activo }));
}

/**
 * Valida el cuerpo de un ítem. `parcial` = edición (sólo se valida lo que llegó).
 * @returns {{error?: string, datos?: object}}
 */
function validarItem(b, { parcial = false } = {}) {
  const d = {};
  if (!parcial || b.nombre !== undefined) {
    const nombre = String(b.nombre == null ? '' : b.nombre).replace(/\s+/g, ' ').trim();
    if (!nombre) return { error: 'Escriba el nombre del ítem.' };
    if (nombre.length > 80) return { error: 'El nombre del ítem admite hasta 80 caracteres.' };
    d.nombre = nombre;
  }
  if (!parcial || b.destinatario !== undefined) {
    const dest = b.destinatario === undefined ? 'testigos' : String(b.destinatario);
    if (!DESTINATARIOS.includes(dest)) return { error: 'Elija si se entrega a testigos o a conductores.' };
    d.destinatario = dest;
  }
  if (b.hora_limite !== undefined) {
    if (b.hora_limite === null || b.hora_limite === '') d.hora_limite = null;
    else {
      const m = HORA.exec(String(b.hora_limite));
      if (!m) return { error: 'La hora límite no es válida (use HH:MM).' };
      d.hora_limite = `${String(m[1]).padStart(2, '0')}:${m[2]}:00`;
    }
  }
  if (b.incluir_suplentes !== undefined) d.incluir_suplentes = b.incluir_suplentes ? 1 : 0;
  if (b.activo !== undefined) d.activo = b.activo ? 1 : 0;
  if (b.orden !== undefined) {
    const o = Number(b.orden);
    if (!Number.isInteger(o) || o < 0 || o > 999) return { error: 'El orden no es válido.' };
    d.orden = o;
  }
  return { datos: d };
}

// ---------------------------------------------------------------------------
// El plan
// ---------------------------------------------------------------------------

/** Puestos de la campaña, sus testigos activos y sus suplentes. */
async function cargarPuestosYGente(cx, dueno) {
  const [puestos] = await cx.query(
    'SELECT id, nombre, cantidad_mesas FROM dia_d_puestos_votacion WHERE aspirante_id = ? ORDER BY nombre', [dueno]);
  const testigos = (await cargarTestigos(cx, dueno)).filter(t => Number(t.activo) !== 0);
  const porPuesto = repartirPorPuesto(testigos, puestos);
  const [sup] = await cx.query('SELECT puesto_id, usuario_id FROM dia_d_suplentes_testigo WHERE aspirante_id = ?', [dueno]);
  const suplentes = new Map(puestos.map(p => [Number(p.id), new Set()]));
  for (const s of sup) {
    const lista = suplentes.get(Number(s.puesto_id));
    if (!lista) continue;
    // Un suplente que además es testigo de ese mismo puesto ya está contado como testigo.
    if ((porPuesto.get(Number(s.puesto_id)) || []).some(t => t.usuario_id === s.usuario_id)) continue;
    lista.add(s.usuario_id);
  }
  return { puestos, testigos, porPuesto, suplentes };
}

async function contarConductores(cx, dueno) {
  const [[{ n }]] = await cx.query('SELECT COUNT(*) AS n FROM transporte_conductores WHERE aspirante_id = ? AND activo = 1', [dueno]);
  return Number(n);
}

/**
 * El plan del día: por puesto y por ítem, con lo sugerido, lo que rige (corrección o sugerida), lo entregado, el total a comprar
 * por ítem y la fila «Transporte».
 */
async function planDelDia(cx, dueno, fecha) {
  const items = await listarItems(cx, dueno, { soloActivos: true });
  const { puestos, porPuesto, suplentes } = await cargarPuestosYGente(cx, dueno);
  const [correcciones] = await cx.query('SELECT item_id, puesto_id, cantidad FROM logistica_plan WHERE aspirante_id = ?', [dueno]);
  const corr = new Map(correcciones.map(c => [`${c.item_id}|${c.puesto_id}`, Number(c.cantidad)]));
  const [entregas] = await cx.query(
    `SELECT item_id, puesto_id, COUNT(*) AS n FROM logistica_entregas
      WHERE aspirante_id = ? AND fecha = ? AND estado = 'entregado' GROUP BY item_id, puesto_id`, [dueno, fecha]);
  const entregadas = new Map(entregas.map(e => [`${e.item_id}|${e.puesto_id}`, Number(e.n)]));
  const deTestigos = items.filter(i => i.destinatario === 'testigos');
  const deConductores = items.filter(i => i.destinatario === 'conductores');

  const filas = puestos.map(p => {
    const nT = (porPuesto.get(Number(p.id)) || []).length;
    const nS = (suplentes.get(Number(p.id)) || new Set()).size;
    return {
      puesto_id: p.id, puesto: p.nombre, mesas: p.cantidad_mesas, testigos: nT, suplentes: nS,
      items: deTestigos.map(i => {
        const sugerido = nT + (i.incluir_suplentes ? nS : 0);
        const k = `${i.id}|${p.id}`;
        const manual = corr.has(k);
        return { item_id: i.id, sugerido, cantidad: manual ? corr.get(k) : sugerido, manual, entregados: entregadas.get(k) || 0 };
      }),
    };
  });
  const conductores = await contarConductores(cx, dueno);
  const totales = [
    ...deTestigos.map(i => {
      const celdas = filas.map(f => f.items.find(x => x.item_id === i.id));
      return { item_id: i.id, nombre: i.nombre, destinatario: 'testigos', hora_limite: i.hora_limite,
        total: celdas.reduce((a, c) => a + c.cantidad, 0), entregados: celdas.reduce((a, c) => a + c.entregados, 0) };
    }),
    ...deConductores.map(i => ({ item_id: i.id, nombre: i.nombre, destinatario: 'conductores', hora_limite: i.hora_limite, total: conductores, entregados: null })),
  ];
  return {
    fecha, items, puestos: filas, totales,
    transporte: { conductores, items: deConductores.map(i => ({ item_id: i.id, nombre: i.nombre, cantidad: conductores })) },
  };
}

/** El contador del cuadro del día D: por ítem a testigos, «entregados de planeados». */
async function contador(cx, dueno, fecha) {
  const plan = await planDelDia(cx, dueno, fecha);
  return {
    fecha,
    items: plan.totales.map(t => ({
      item_id: t.item_id, nombre: t.nombre, destinatario: t.destinatario, hora_limite: t.hora_limite,
      planeados: t.total, entregados: t.entregados,
    })),
  };
}

/** Corrige a mano la cantidad de un ítem en un puesto; `cantidad` null borra la corrección y vuelve a la sugerida. */
async function fijarCantidad(cx, { dueno, itemId, puestoId, cantidad, usuarioId }) {
  if (cantidad === null) {
    await cx.query('DELETE FROM logistica_plan WHERE item_id = ? AND puesto_id = ? AND aspirante_id = ?', [itemId, puestoId, dueno]);
    return;
  }
  await cx.query(
    `INSERT INTO logistica_plan (aspirante_id, item_id, puesto_id, cantidad, actualizado_por) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE cantidad = VALUES(cantidad), actualizado_por = VALUES(actualizado_por), actualizado_en = NOW()`,
    [dueno, itemId, puestoId, cantidad, usuarioId || null]);
}

// ---------------------------------------------------------------------------
// La alerta «sin entregar»
// ---------------------------------------------------------------------------

/**
 * Borradores de la alerta `logistica_sin_entregar`, por puesto y por ítem. SOLO el día de la elección (`fecha_eleccion` = hoy).
 * Cuenta testigos que YA hicieron check-in y no tienen entrega de ese ítem hoy. La clave de la alerta lleva el id del ítem en el
 * lugar de la mesa (`mesa` = item_id): así «atendida» y el aviso push se llevan por ítem sin tablas nuevas.
 *
 * @param {object} p  { dueno, cfg, ahora, puestos, porPuesto: Map(puesto.id → testigos[]), llegoPor: Map(usuario_id → llegada) }
 */
async function alertasDeLogistica(cx, { dueno, cfg, ahora, puestos, porPuesto, llegoPor }) {
  if (!cfg.fecha_eleccion || cfg.fecha_eleccion !== ahora.fecha) return [];
  let items, entregas;
  try {
    items = (await listarItems(cx, dueno, { soloActivos: true })).filter(i => i.destinatario === 'testigos' && i.hora_limite);
    if (!items.length) return [];
    [entregas] = await cx.query(
      `SELECT item_id, receptor_usuario_id FROM logistica_entregas WHERE aspirante_id = ? AND fecha = ? AND estado = 'entregado'`,
      [dueno, ahora.fecha]);
  } catch (err) {
    console.warn('alertas: sin el dato de logística:', err.code || err.message);
    return [];
  }
  const recibio = new Set(entregas.map(e => `${e.item_id}|${e.receptor_usuario_id}`));
  const salida = [];
  for (const it of items) {
    const limite = minutosDe(it.hora_limite);
    const yaToca = ahora.minutos >= limite;
    for (const p of puestos) {
      const faltan = (porPuesto.get(Number(p.id)) || [])
        .filter(t => Number(t.activo) !== 0 && llegoPor.has(t.usuario_id) && !recibio.has(`${it.id}|${t.usuario_id}`)).length;
      if (faltan < 1) continue;
      salida.push({
        tipo: 'logistica_sin_entregar', puesto_id: p.id, puesto: p.nombre, mesa: it.id,
        detalle: `Puesto ${p.nombre}: ${faltan} ${faltan === 1 ? 'testigo' : 'testigos'} sin ${it.nombre.toLowerCase()} a las ${horaEnPalabras(it.hora_limite)}`,
        estado: yaToca ? 'activa' : 'pendiente', pendiente_hasta: yaToca ? null : it.hora_limite,
        desde: `${ahora.fecha} ${it.hora_limite}`,
      });
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Entregar
// ---------------------------------------------------------------------------

const UUID = /^[A-Za-z0-9_-]{8,64}$/;

/** El puesto de la campaña donde es testigo (activo) esta persona, con su fila de testigo; null si no es de ninguno. */
async function puestoDeTestigo(cx, dueno, usuarioId) {
  const { puestos, testigos, porPuesto } = await cargarPuestosYGente(cx, dueno);
  const t = testigos.find(x => x.usuario_id === usuarioId);
  if (!t) return null;
  for (const p of puestos) {
    if ((porPuesto.get(Number(p.id)) || []).some(x => x.usuario_id === usuarioId)) return { puesto: p, testigo: t };
  }
  return { puesto: null, testigo: t };
}

/**
 * Lo que ve el coordinador de puesto (o quien lo supla): los testigos de UN puesto con lo que ya recibió cada uno.
 * No lleva cédulas ni teléfonos: sólo nombre, tipo y mesas.
 */
async function vistaDelPuesto(cx, dueno, puestoId, fecha) {
  const items = (await listarItems(cx, dueno, { soloActivos: true })).filter(i => i.destinatario === 'testigos');
  const { puestos, porPuesto } = await cargarPuestosYGente(cx, dueno);
  const puesto = puestos.find(p => Number(p.id) === Number(puestoId));
  if (!puesto) return null;
  const gente = porPuesto.get(Number(puesto.id)) || [];
  const [llegadas] = await cx.query('SELECT usuario_id FROM dia_d_checkin WHERE aspirante_id = ? AND fecha = ?', [dueno, fecha]);
  const llegaron = new Set(llegadas.map(l => l.usuario_id));
  const [entregas] = await cx.query(
    `SELECT id, item_id, receptor_usuario_id, DATE_FORMAT(entregado_en, '%H:%i') AS hora, (foto_url IS NOT NULL) AS con_foto
       FROM logistica_entregas WHERE aspirante_id = ? AND puesto_id = ? AND fecha = ? AND estado = 'entregado'`,
    [dueno, puesto.id, fecha]);
  const por = new Map(entregas.map(e => [`${e.item_id}|${e.receptor_usuario_id}`, e]));
  return {
    fecha, puesto: { id: puesto.id, nombre: puesto.nombre },
    items: items.map(i => ({ id: i.id, nombre: i.nombre, hora_limite: i.hora_limite })),
    testigos: gente.map(t => ({
      usuario_id: t.usuario_id, nombre: t.nombre, iniciales: t.iniciales, coordinador_de_puesto: t.tipo_testigo === 'puesto',
      mesas: t.mesas, llego: llegaron.has(t.usuario_id),
      entregas: Object.fromEntries(items.map(i => {
        const e = por.get(`${i.id}|${t.usuario_id}`);
        return [i.id, e ? { id: e.id, hora: e.hora, con_foto: !!e.con_foto } : null];
      })),
    })),
  };
}

/**
 * Registra una entrega. IDEMPOTENTE Y ATÓMICA: la clave única (ítem, testigo, día) decide. Un segundo toque, el reintento de la cola
 * sin señal o dos coordinadores a la vez no entregan dos veces: devuelven `ya_estaba` con la entrega que ya había.
 * Una entrega ANULADA se reactiva con un UPDATE condicionado a que siga anulada (el reclamo atómico).
 *
 * @returns {Promise<{resultado: 'entregado'|'reactivada'|'ya_estaba', id: number}>} ; lanza Error con `.estado` HTTP si algo no cuadra.
 */
async function entregar(cx, { dueno, usuarioId, puestoId, itemId, receptorId, clienteUuid, marcadoEn, nota }) {
  const rechazo = (estado, mensaje) => Object.assign(new Error(mensaje), { estado });
  if (clienteUuid && !UUID.test(String(clienteUuid))) throw rechazo(400, 'Identificador de reintento no válido.');
  const [[item]] = await cx.query(
    'SELECT id, destinatario, activo FROM logistica_items WHERE id = ? AND aspirante_id = ?', [itemId, dueno]);
  if (!item) throw rechazo(404, 'Ese ítem no existe.');
  if (!item.activo) throw rechazo(409, 'Ese ítem está desactivado.');
  if (item.destinatario !== 'testigos') throw rechazo(400, 'Ese ítem no se entrega a testigos.');
  const { puestos, porPuesto } = await cargarPuestosYGente(cx, dueno);
  const puesto = puestos.find(p => Number(p.id) === Number(puestoId));
  if (!puesto) throw rechazo(404, 'Ese puesto no es de esta campaña.');
  if (!(porPuesto.get(Number(puesto.id)) || []).some(t => t.usuario_id === receptorId)) {
    throw rechazo(400, 'Esa persona no es testigo de este puesto.');
  }
  // El día es HOY en Colombia (como el check-in), también fuera de `fecha_eleccion`: en «modo prueba» se puede ensayar la jornada.
  const fecha = jornada.ahoraColombia().fecha;
  const notaLimpia = String(nota || '').replace(/\s+/g, ' ').trim().slice(0, 255) || null;
  const [ins] = await cx.query(
    `INSERT IGNORE INTO logistica_entregas (aspirante_id, item_id, puesto_id, receptor_usuario_id, fecha, entregado_por, entregado_en, nota, cliente_uuid)
     VALUES (?,?,?,?,?,?,COALESCE(?, NOW()),?,?)`,
    [dueno, item.id, puesto.id, receptorId, fecha, usuarioId, marcadoEn || null, notaLimpia, clienteUuid || null]);
  if (ins.affectedRows === 1) return { resultado: 'entregado', id: ins.insertId };
  const [[previa]] = await cx.query(
    'SELECT id, estado FROM logistica_entregas WHERE item_id = ? AND receptor_usuario_id = ? AND fecha = ?', [item.id, receptorId, fecha]);
  if (previa && previa.estado === 'anulado') {
    const [r] = await cx.query(
      `UPDATE logistica_entregas SET estado = 'entregado', entregado_por = ?, entregado_en = COALESCE(?, NOW()), puesto_id = ?,
              nota = ?, cliente_uuid = ?, anulado_por = NULL, anulado_en = NULL, foto_url = NULL
        WHERE id = ? AND estado = 'anulado'`,
      [usuarioId, marcadoEn || null, puesto.id, notaLimpia, clienteUuid || null, previa.id]);
    if (r.affectedRows === 1) return { resultado: 'reactivada', id: previa.id };
  }
  return { resultado: 'ya_estaba', id: previa ? previa.id : 0 };
}

/** Anula una entrega hecha por error. Devuelve false si ya no existía o ya estaba anulada. */
async function anular(cx, { dueno, entregaId, usuarioId, puestoId = null }) {
  const [r] = await cx.query(
    `UPDATE logistica_entregas SET estado = 'anulado', anulado_por = ?, anulado_en = NOW()
      WHERE id = ? AND aspirante_id = ? AND estado = 'entregado' ${puestoId ? 'AND puesto_id = ?' : ''}`,
    puestoId ? [usuarioId, entregaId, dueno, puestoId] : [usuarioId, entregaId, dueno]);
  return r.affectedRows === 1;
}

// ---------------------------------------------------------------------------
// La foto
// ---------------------------------------------------------------------------

const TAMANO_MAXIMO_FOTO = 8 * 1024 * 1024;
const LADO_MAXIMO = 1280;

/**
 * Reduce la foto (lado mayor 1.280 px, JPEG calidad 72, gira según EXIF y descarta metadatos) y la guarda en la carpeta PROTEGIDA
 * del Día D (`uploads/dia-d/`, que no se sirve por /uploads). Devuelve el nombre del archivo. Lanza si no es una imagen.
 */
async function guardarFoto(buffer, carpeta) {
  const sharp = require('sharp');
  const reducida = await sharp(buffer, { failOn: 'error' }).rotate()
    .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72 }).toBuffer();
  const nombre = `logistica_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.jpg`;
  await fs.promises.writeFile(path.join(carpeta, nombre), reducida);
  return nombre;
}

// ---------------------------------------------------------------------------
// El Excel
// ---------------------------------------------------------------------------

/** Filas de las tres hojas. Los testigos van por nombre y con la cédula ENMASCARADA (***456): una lista de compras circula. */
async function datosParaExcel(cx, dueno, fecha) {
  const plan = await planDelDia(cx, dueno, fecha);
  const { puestos, porPuesto } = await cargarPuestosYGente(cx, dueno);
  const deTestigos = plan.items.filter(i => i.destinatario === 'testigos');
  const [entregas] = await cx.query(
    `SELECT item_id, receptor_usuario_id FROM logistica_entregas WHERE aspirante_id = ? AND fecha = ? AND estado = 'entregado'`, [dueno, fecha]);
  const recibio = new Set(entregas.map(e => `${e.item_id}|${e.receptor_usuario_id}`));

  const compras = plan.totales.map(t => ({
    'Ítem': t.nombre, 'Para': t.destinatario === 'conductores' ? 'Conductores' : 'Testigos',
    'Hasta': t.hora_limite || '', 'Total a comprar': t.total,
  }));
  const porPuestoHoja = plan.puestos.map(f => {
    const fila = { 'Puesto': f.puesto, 'Testigos': f.testigos, 'Suplentes': f.suplentes };
    for (const i of deTestigos) fila[i.nombre] = f.items.find(x => x.item_id === i.id).cantidad;
    return fila;
  });
  if (plan.transporte.conductores || plan.transporte.items.length) {
    const fila = { 'Puesto': 'Transporte (conductores)', 'Testigos': 0, 'Suplentes': 0 };
    for (const i of deTestigos) fila[i.nombre] = 0;
    for (const i of plan.transporte.items) fila[i.nombre] = i.cantidad;
    porPuestoHoja.push(fila);
  }
  const testigosHoja = [];
  for (const p of puestos) {
    for (const t of porPuesto.get(Number(p.id)) || []) {
      const fila = {
        'Puesto': p.nombre, 'Testigo': t.nombre, 'Cargo': t.tipo_testigo === 'puesto' ? 'Coordinador de puesto' : 'Testigo electoral',
        'Cédula': enmascararCedula(normalizarCedula(t.numero_identificacion)),
      };
      for (const i of deTestigos) fila[i.nombre] = recibio.has(`${i.id}|${t.usuario_id}`) ? 'Entregado' : '';
      testigosHoja.push(fila);
    }
  }
  return { compras, porPuesto: porPuestoHoja, testigos: testigosHoja };
}

/** Hoy en Colombia (AAAA-MM-DD): el día al que pertenecen las entregas y el contador. */
const hoy = () => jornada.ahoraColombia().fecha;

module.exports = {
  hoy, ITEMS_DE_FABRICA, DESTINATARIOS, TAMANO_MAXIMO_FOTO,
  hhmm, minutosDe, horaEnPalabras,
  asegurarItems, listarItems, validarItem,
  cargarPuestosYGente, planDelDia, contador, fijarCantidad,
  alertasDeLogistica, puestoDeTestigo, vistaDelPuesto, entregar, anular, guardarFoto, datosParaExcel,
};
