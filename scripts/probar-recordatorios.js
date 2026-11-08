#!/usr/bin/env node
// scripts/probar-recordatorios.js
//
// Prueba de los RECORDATORIOS AUTOMÁTICOS, Fases 0 y 1. No manda nada real: el proveedor de SMS y los canales se reemplazan por
// falsos que cuentan las llamadas.
//
//   FASE 0 (routes/comunicaciones.routes.js): una fila reclamada por otro no se vuelve a mandar · «Reintentar fallidos» dos veces no
//     duplica · la fila queda en 'enviando' ANTES de llamar al proveedor y guarda su id · las filas 'enviando' viejas se reconcilian
//     con la bitácora (no se reenvían) · se vuelve a leer baja, autorización y «ya votó» al despachar · SMS fuera de franja no falla,
//     se reprograma.
//   FASE 1 (lib/recordatorios.js): apagado de fábrica · duplicados (dos vueltas a la vez) · catch-up tras un reinicio · silencio de
//     20:00 a 08:00 · tope diario con reserva y límite del libro central · consentimiento estricto (NULL no autoriza) · bloqueo de
//     precampaña (validador y texto ya armado) · largo de un segmento · reintentos con espera · 'enviando' viejas.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada300 node scripts/probar-recordatorios.js
//
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) {
  console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`);
  process.exit(2);
}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';

const fs = require('fs');
const express = require('express');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const pool = require('../config/db');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const log = console.log;
const logOriginal = console.log;
const errOriginal = console.error;
/** Silencia los console.log/error del código probado (avisos esperados). */
function callado(fn) { return async (...a) => { console.log = () => {}; console.error = () => {}; try { return await fn(...a); } finally { console.log = logOriginal; console.error = errOriginal; } }; }

/** Un instante a partir de una hora de Colombia. */
const col = (y, m, d, h, mi = 0) => new Date(Date.UTC(y, m - 1, d, h + 5, mi, 0));

let secuencia = 0;
let FABRICA = [];
async function votante(o = {}) {
  secuencia++;
  const r = await q(
    `INSERT INTO votantes (categoria, nombre, cedula, telefono, email, consentimiento_sms, consentimiento_email, no_contactar, origen, consentimiento_confirmado_en, puesto_votacion)
     VALUES ('votante', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [o.nombre || `Persona ${secuencia} Prueba`, `8${String(secuencia).padStart(8, '0')}`, o.telefono === undefined ? `3002${String(secuencia).padStart(6, '0')}` : o.telefono,
      `p${secuencia}@ejemplo.co`, o.sms === undefined ? 1 : o.sms, o.email === undefined ? 1 : o.email, o.baja ? 1 : 0,
      o.origen || 'manual', o.confirmado === undefined ? null : o.confirmado, o.puesto || 'Colegio de prueba']);
  return r.insertId;
}
async function usuario(o = {}) {
  secuencia++;
  const r = await q(
    `INSERT INTO usuarios (nombre, email, nombre_usuario, numero_identificacion, password_hash, rol_id, telefono, no_contactar)
     VALUES (?, ?, ?, ?, 'x', 3, ?, ?)`,
    [o.nombre || `Equipo ${secuencia}`, `u${secuencia}@ejemplo.co`, `u${secuencia}`, `7${String(secuencia).padStart(8, '0')}`, `3003${String(secuencia).padStart(6, '0')}`, o.baja ? 1 : 0]);
  return r.insertId;
}
async function configurar(o) {
  const sets = Object.keys(o).map((k) => `${k} = ?`).join(', ');
  await q(`UPDATE configuracion_campana SET ${sets} WHERE id = 1`, Object.values(o));
}

(async () => {
  console.log('RECORDATORIOS AUTOMÁTICOS — base «' + nombreBase + '»\n');

  /* ============================================================ 0. La base (init-db) */
  console.log('[0] Migración: tablas y columnas, y repetible');
  const raiz = path.join(__dirname, '..');
  const corrida = spawnSync(process.execPath, ['db/init-db.js'], { cwd: raiz, env: process.env, encoding: 'utf8' });
  ok(corrida.status === 0, 'init-db sobre una base ya inicializada termina bien (repetible)', corrida.stderr && corrida.stderr.slice(0, 200));
  for (const f of fs.readdirSync(raiz)) if (/^\.credenciales-.*\.txt$/.test(f)) fs.unlinkSync(path.join(raiz, f));
  const tablas = (await q(`SELECT table_name n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'recordatorio%'`)).map((f) => f.n).sort();
  ok(JSON.stringify(tablas) === JSON.stringify(['recordatorio_envios', 'recordatorio_reglas', 'recordatorio_tope_diario']), 'existen recordatorio_reglas, recordatorio_envios y recordatorio_tope_diario', tablas);
  await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');   // la fila única de la campaña (la crea la primera vez que se guarda la configuración)
  const [[cfg0]] = await pool.query(
    `SELECT recordatorios_activos a, fecha_permitida_propaganda f, tope_diario_sms_automaticos t, TIME_FORMAT(silencio_inicio,'%H:%i') si, TIME_FORMAT(silencio_fin,'%H:%i') sf FROM configuracion_campana WHERE id = 1`);
  ok(Number(cfg0.a) === 0 && cfg0.f === null && Number(cfg0.t) === 200 && cfg0.si === '20:00' && cfg0.sf === '08:00', 'configuración de fábrica: apagado, sin fecha permitida, tope 200, silencio 20:00–08:00', cfg0);
  const colEnvios = (await q(`SELECT column_type t FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'comunicaciones_envios' AND column_name = 'estado'`))[0].t;
  ok(/'enviando'/.test(colEnvios) && /'omitido'/.test(colEnvios), 'comunicaciones_envios.estado admite «enviando» y «omitido»', colEnvios);
  FABRICA = await q(`SELECT tipo, canal, plantilla, asunto, activo FROM recordatorio_reglas`);
  const sembradas = await q(`SELECT tipo, canal, activo, desfase_min, TIME_FORMAT(hora_dia,'%H:%i') h FROM recordatorio_reglas ORDER BY id`);
  ok(sembradas.length === 7 && sembradas.every((r) => Number(r.activo) === 0), 'hay 7 reglas de fábrica y TODAS están apagadas', sembradas.length);
  ok(sembradas.filter((r) => r.tipo === 'evento').map((r) => r.desfase_min).sort((a, b) => a - b).join() === '-1440,-1440,-1440,-120,-120', 'las de evento son «24 h antes» y «2 h antes»');
  ok(sembradas.filter((r) => r.tipo === 'dia_d_ya_votaste').map((r) => r.h).join() === '14:00,15:00', 'las del Día D son a las 14:00 y a las 15:00 (la segunda, opcional)');
  const corrida2 = spawnSync(process.execPath, ['db/init-db.js'], { cwd: raiz, env: process.env, encoding: 'utf8' });
  for (const f of fs.readdirSync(raiz)) if (/^\.credenciales-.*\.txt$/.test(f)) fs.unlinkSync(path.join(raiz, f));
  ok(corrida2.status === 0 && (await q(`SELECT COUNT(*) n FROM recordatorio_reglas`))[0].n === 7, 'otra corrida de init-db no duplica las reglas de fábrica');
  ok((await q(`SELECT COUNT(*) n FROM permisos_rol WHERE modulo = 'recordatorios' AND rol = 'admin' AND permitido = 1`))[0].n === 1
    && (await q(`SELECT COUNT(*) n FROM permisos_rol WHERE modulo = 'recordatorios' AND rol <> 'admin' AND permitido = 1`))[0].n === 0, 'el módulo «recordatorios» está en la matriz y de fábrica solo lo ve el administrador');

  /* ============================================================ FASE 0 */
  const smsSvc = require('../config/sms');
  const crm = require('../routes/comunicaciones.routes');
  const llamadasSms = [];
  let comportamientoSms = async () => ({ sid: 'SID-' + (llamadasSms.length), proveedor: 'falso', creditos: 1 });
  smsSvc.enviarSMS = async (tel, msg, cb, op) => { llamadasSms.push({ tel, msg, op }); return comportamientoSms(tel, msg, cb, op, llamadasSms.length); };
  // La config de la campaña: sin Onurix, el CRM no llega a la franja por sí mismo; las pruebas de franja lanzan el error a mano.
  async function campana(canal, mensaje, filas, extra = {}) {
    const [c] = await pool.query(`INSERT INTO comunicaciones_campanas (nombre, canal, mensaje, filtros, estado, total_destinatarios) VALUES (?, ?, ?, ?, 'enviando', ?)`,
      ['Prueba ' + (++secuencia), canal, mensaje, JSON.stringify(extra.filtros || {}), filas.length]);
    for (const f of filas) {
      await q(`INSERT INTO comunicaciones_envios (campana_id, destinatario_tipo, destinatario_id, destinatario_nombre, destinatario_contacto, estado) VALUES (?,?,?,?,?,?)`,
        [c.insertId, f.tipo || 'votante', f.id || null, f.nombre || 'Persona Prueba', f.contacto || '3001234567', f.estado || 'pendiente']);
    }
    return c.insertId;
  }
  const filasDe = (id) => q(`SELECT * FROM comunicaciones_envios WHERE campana_id = ? ORDER BY id`, [id]);

  console.log('\n[1] Fase 0 · una fila reclamada por otro ciclo no se vuelve a mandar');
  {
    const v = [await votante(), await votante(), await votante()];
    const id = await campana('sms', 'Hola {nombre}', v.map((x) => ({ id: x })));
    const filas = await filasDe(id);
    await q(`UPDATE comunicaciones_envios SET estado = 'enviando', reclamado_en = NOW(), proceso = 'otro-proceso' WHERE id = ?`, [filas[1].id]);   // (queda para la prueba de abajo)
    llamadasSms.length = 0;
    await callado(() => Promise.all([crm.procesarEnvioCampana(id), crm.procesarEnvioCampana(id)]))();
    const despues = await filasDe(id);
    ok(llamadasSms.length === 2, 'dos ciclos a la vez sobre la misma campaña mandan 2 mensajes (la fila ajena no se toca), no 4', llamadasSms.length);
    ok(despues[1].estado === 'enviando' && despues[1].proceso === 'otro-proceso', 'la fila reclamada por otro sigue siendo de ese otro');
    ok(despues[0].estado === 'enviado' && despues[2].estado === 'enviado', 'las otras dos quedaron enviadas');
    ok(crm.campanasEnProceso.size === 0, 'el candado en memoria se libera al terminar');
  }

  console.log('\n[2] Fase 0 · «Reintentar fallidos» dos veces no lanza otro envío sobre las mismas filas');
  {
    const v = [await votante(), await votante()];
    const id = await campana('sms', 'Hola', v.map((x) => ({ id: x, estado: 'fallido' })));
    llamadasSms.length = 0;
    comportamientoSms = async () => { await dormir(250); return { sid: 'R-' + llamadasSms.length }; };
    const [r1, r2] = await callado(() => Promise.all([crm.reintentarFallidos(id), crm.reintentarFallidos(id)]))();
    await dormir(1800);
    ok((r1.reintentados === 2) !== (r2.reintentados === 2), 'solo UNO de los dos clics reclama las 2 filas', [r1, r2]);
    ok(llamadasSms.length === 2, 'el proveedor recibió 2 mensajes, no 4', llamadasSms.length);
    const [[c]] = await pool.query(`SELECT estado FROM comunicaciones_campanas WHERE id = ?`, [id]);
    ok(c.estado === 'enviado', 'la campaña terminó en «enviado»', c.estado);
    // Y con la campaña en marcha, el segundo clic dice que espere.
    const id2 = await campana('sms', 'Hola', [{ id: v[0], estado: 'fallido' }]);
    llamadasSms.length = 0;
    const primero = callado(() => crm.reintentarFallidos(id2))();
    await dormir(40);
    const segundo = await crm.reintentarFallidos(id2);
    await primero; await dormir(1000);
    ok(segundo.enProceso === true || segundo.reintentados === 0, 'un segundo clic con la campaña en marcha no reclama nada', segundo);
    ok(llamadasSms.length === 1, 'un solo mensaje salió', llamadasSms.length);
    comportamientoSms = async () => ({ sid: 'SID-' + llamadasSms.length });
  }

  console.log('\n[3] Fase 0 · «enviando» ANTES de llamar al proveedor, y se guarda su id');
  {
    const v = await votante();
    const id = await campana('sms', 'Hola', [{ id: v }]);
    let visto = null;
    comportamientoSms = async () => { visto = (await filasDe(id))[0]; return { sid: 'PROV-123' }; };
    await callado(() => crm.procesarEnvioCampana(id))();
    const f = (await filasDe(id))[0];
    ok(visto && visto.estado === 'enviando' && visto.reclamado_en, 'durante la llamada al proveedor la fila ya estaba «enviando» y con su hora', visto && visto.estado);
    ok(f.estado === 'enviado' && f.twilio_sid === 'PROV-123' && f.enviado_en, 'después queda «enviado» con el id del proveedor', f.estado);
    ok(llamadasSms[llamadasSms.length - 1].op.loteId === `crm-${id}` && Number(llamadasSms[llamadasSms.length - 1].op.contactoId) === f.id, 'el SMS lleva lote «crm-<campaña>» y la fila como contacto (para reconciliar)');
    comportamientoSms = async () => ({ sid: 'SID-' + llamadasSms.length });
  }

  console.log('\n[4] Fase 0 · tras un reinicio, las «enviando» viejas se reconcilian y NO se reenvían');
  {
    const v = [await votante(), await votante(), await votante()];
    const id = await campana('sms', 'Hola', v.map((x) => ({ id: x, estado: 'enviando' })));
    await q(`UPDATE comunicaciones_campanas SET estado = 'enviando' WHERE id = ?`, [id]);
    const filas = await filasDe(id);
    await q(`UPDATE comunicaciones_envios SET reclamado_en = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE campana_id = ?`, [id]);
    await q(`INSERT INTO sms_envios (destino, mensaje, estado, proveedor_id, lote_id, contacto_id) VALUES ('573001111111','Hola','aceptado','OK-9',?,?)`, [`crm-${id}`, filas[0].id]);
    await q(`INSERT INTO sms_envios (destino, mensaje, estado, error_mensaje, lote_id, contacto_id) VALUES ('573001111112','Hola','rechazado','Número inválido',?,?)`, [`crm-${id}`, filas[1].id]);
    llamadasSms.length = 0;
    const n = await callado(() => crm.reconciliarEnviando({ todas: true }))();
    const f = await filasDe(id);
    ok(n >= 3, 'se reconciliaron las 3', n);
    ok(f[0].estado === 'enviado' && f[0].twilio_sid === 'OK-9', 'con rastro «aceptado» → enviado, con su id');
    ok(f[1].estado === 'fallido' && /inválido/.test(f[1].error_mensaje), 'con rastro «rechazado» → fallido con el motivo del proveedor');
    ok(f[2].estado === 'fallido' && /no se pudo confirmar/.test(f[2].error_mensaje), 'sin rastro → fallido con la advertencia (no se pudo confirmar)');
    ok(llamadasSms.length === 0, 'NO se mandó ni un mensaje a ciegas', llamadasSms.length);
    const [[c]] = await pool.query(`SELECT estado FROM comunicaciones_campanas WHERE id = ?`, [id]);
    ok(c.estado === 'enviado' || c.estado === 'fallido', 'la campaña se cierra al reconciliar', c.estado);
    // Una «enviando» RECIENTE de una campaña que este proceso está enviando no se toca (solo con «todas» o si es vieja).
    const v2 = await votante();
    const id2 = await campana('sms', 'Hola', [{ id: v2, estado: 'enviando' }]);
    await q(`UPDATE comunicaciones_envios SET reclamado_en = NOW() WHERE campana_id = ?`, [id2]);
    const n2 = await crm.reconciliarEnviando({ minutos: 10 });
    ok((await filasDe(id2))[0].estado === 'enviando', 'una «enviando» de hace segundos no se toca en la vuelta normal', n2);
    await q(`DELETE FROM comunicaciones_envios WHERE campana_id = ?`, [id2]);
  }

  console.log('\n[5] Fase 0 · al despachar se vuelve a leer baja, autorización y «ya votó»');
  {
    const vBaja = await votante(), vRetiro = await votante(), vVoto = await votante(), vOk = await votante(), vNull = await votante({ sms: null });
    const uBaja = await usuario({ baja: true });
    const [e] = await pool.query(`INSERT INTO estructura (usuario_id, cargo, activo) VALUES (?, 'lider', 1)`, [uBaja]);
    // La lista se armó cuando todos podían recibir: AHORA cambia lo que cambia.
    const idDiaD = await campana('sms', 'Hola {nombre}', [vBaja, vRetiro, vVoto, vOk].map((x) => ({ id: x })), { filtros: { fuente: 'mis_votantes_sin_voto' } });
    await q(`UPDATE votantes SET no_contactar = 1 WHERE id = ?`, [vBaja]);
    await q(`UPDATE votantes SET consentimiento_sms = 0 WHERE id = ?`, [vRetiro]);
    await q(`INSERT INTO votante_votos (votante_id, origen) VALUES (?, 'equipo')`, [vVoto]);
    llamadasSms.length = 0;
    await callado(() => crm.procesarEnvioCampana(idDiaD))();
    const f = await filasDe(idDiaD);
    ok(f[0].estado === 'omitido' && /no recibir más/.test(f[0].error_mensaje), 'quien pidió la baja DESPUÉS de armar la campaña queda «omitido», con motivo', f[0]);
    ok(f[1].estado === 'omitido' && /autorización/.test(f[1].error_mensaje), 'quien retiró su autorización por SMS queda «omitido»', f[1]);
    ok(f[2].estado === 'omitido' && /Ya votó/.test(f[2].error_mensaje), 'en una campaña de Día D, quien ya votó queda «omitido»', f[2]);
    ok(f[3].estado === 'enviado', 'quien sigue pudiendo recibir, recibe');
    ok(llamadasSms.length === 1, 'salió UN solo mensaje', llamadasSms.length);

    // «Ya votó» solo cuenta si la campaña es de Día D.
    const idNormal = await campana('sms', 'Hola {nombre}', [{ id: vVoto }]);
    llamadasSms.length = 0;
    await callado(() => crm.procesarEnvioCampana(idNormal))();
    ok((await filasDe(idNormal))[0].estado === 'enviado', 'una campaña que NO es de Día D le escribe igual a quien votó');

    // La regla general deja pasar el NULL; la del enlace «Ya voté» no.
    const idNull = await campana('sms', 'Hola {nombre}', [{ id: vNull }]);
    const idEstricta = await campana('sms', 'Ya votaste? {enlace_ya_vote}', [{ id: vNull }]);
    llamadasSms.length = 0;
    await callado(() => crm.procesarEnvioCampana(idNull))();
    await callado(() => crm.procesarEnvioCampana(idEstricta))();
    ok((await filasDe(idNull))[0].estado === 'enviado', 'campaña común: el NULL («no consta») sigue pasando, como siempre');
    const fe = (await filasDe(idEstricta))[0];
    ok(fe.estado === 'omitido' && /enlace «Ya voté»|No consta/.test(fe.error_mensaje), 'con {enlace_ya_vote} el NULL NO autoriza (regla estricta)', fe);

    // La baja de una persona del EQUIPO también se respeta (antes no se miraba en correo ni push).
    const idEq = await campana('push', 'Aviso', [{ tipo: 'estructura', id: e.insertId, contacto: String(uBaja) }]);
    llamadasSms.length = 0;
    await callado(() => crm.procesarEnvioCampana(idEq))();
    const feq = (await filasDe(idEq))[0];
    ok(feq.estado === 'omitido' && /no recibir más/.test(feq.error_mensaje), 'una persona del equipo con baja queda «omitido» también en push/correo', feq);
  }

  console.log('\n[6] Fase 0 · SMS fuera de franja: no queda «fallido», se reprograma para la apertura');
  {
    const v = [await votante(), await votante()];
    const id = await campana('sms', 'Hola', v.map((x) => ({ id: x })));
    await q(`UPDATE sms_config SET horario_inicio = 8, horario_fin = 8 WHERE id = 1`);   // fin = inicio: SIEMPRE fuera de franja
    smsSvc.invalidarCache();
    comportamientoSms = async () => { const e = new Error('Fuera del horario permitido'); e.codigo = 'FUERA_DE_FRANJA'; throw e; };
    llamadasSms.length = 0;
    await callado(() => crm.procesarEnvioCampana(id))();
    const f = await filasDe(id);
    const [[c]] = await pool.query(`SELECT estado, programado_para > NOW() AS futura, programado_para FROM comunicaciones_campanas WHERE id = ?`, [id]);
    ok(f.every((x) => x.estado === 'pendiente'), 'ninguna fila quedó «fallido»: todas siguen pendientes', f.map((x) => x.estado));
    ok(llamadasSms.length === 1, 'se detuvo al primer rechazo por hora (no insiste con las demás)', llamadasSms.length);
    ok(c.estado === 'borrador' && Number(c.futura) === 1, 'la campaña quedó en borrador con una hora futura', c);
    // Llega la apertura: se despacha y sale.
    await q(`UPDATE sms_config SET horario_inicio = 8, horario_fin = 20 WHERE id = 1`);
    smsSvc.invalidarCache();
    comportamientoSms = async () => ({ sid: 'SID-' + llamadasSms.length });
    await q(`UPDATE comunicaciones_campanas SET programado_para = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?`, [id]);
    llamadasSms.length = 0;
    await callado(() => crm.despacharCampanasProgramadas())();
    await dormir(1800);
    const f2 = await filasDe(id);
    ok(f2.every((x) => x.estado === 'enviado') && llamadasSms.length === 2, 'en la apertura el despachador la envía completa', f2.map((x) => x.estado));
  }

  /* ============================================================ FASE 1 */
  const R = require('../lib/recordatorios');
  const enviados = [];
  let falloEnvio = null;
  R.deps.enviar = async (canal, o) => {
    if (falloEnvio) { const e = typeof falloEnvio === 'function' ? falloEnvio(canal, o) : falloEnvio; if (e) throw e; }
    enviados.push({ canal, texto: o.texto, asunto: o.asunto, ficha: o.ficha.id, filaId: o.filaId, prueba: !!o.prueba, telefono: o.ficha.telefono });
    return 'FALSO-' + enviados.length;
  };
  let central = null;
  R.deps.cuotaCentral = async () => central;
  R.deps.configSms = async () => ({ firma: '', bajaAutomatica: true });
  let CANDIDATOS = [];
  // Fuentes FALSAS (las de las Fases 0 y 1): sin la limpieza de eventos, que busca eventos reales. Más abajo se restauran las verdaderas.
  R.registrarTipo('evento', { candidatos: async () => CANDIDATOS, limpiar: undefined });
  R.registrarTipo('dia_d_ya_votaste', { candidatos: async () => CANDIDATOS, completarDatos: undefined, limpiar: undefined });
  const D = (y, m, d, h, mi) => col(y, m, d, h, mi);
  const AHORA = D(2026, 11, 8, 10, 0);
  const cand = (id, ocurrencia, debe, datos = {}, tipo = 'votante') => ({ destinatario_tipo: tipo, destinatario_id: id, ocurrencia, debe_salir_en: debe, datos });
  async function regla(o = {}) {
    const r = await q(`INSERT INTO recordatorio_reglas (tipo, nombre, canal, activo, plantilla, asunto, gracia_min) VALUES (?,?,?,1,?,?,?)`,
      [o.tipo || 'evento', o.nombre || 'Regla de prueba', o.canal || 'sms', o.plantilla || 'Hola {nombre}, te esperamos en {evento}.', o.asunto || null, o.gracia === undefined ? 180 : o.gracia]);
    return r.insertId;
  }
  async function limpiar() { await q(`DELETE FROM recordatorio_envios`); await q(`DELETE FROM recordatorio_reglas`); await q(`DELETE FROM recordatorio_tope_diario`); enviados.length = 0; falloEnvio = null; central = null; CANDIDATOS = []; }
  const envios = () => q(`SELECT * FROM recordatorio_envios ORDER BY id`);

  console.log('\n[7] Fase 1 · apagado de fábrica');
  {
    await limpiar();
    await regla();
    const vv = await votante();
    CANDIDATOS = [cand(vv, 'ev:1', D(2026, 11, 8, 9, 55), { evento: 'Reunión' })];
    const r = await R.vuelta({ ahora: AHORA });
    ok(r.omitida === 'apagado' && enviados.length === 0, 'con el interruptor en 0 no se manda nada (solo se lee la configuración)', r);
    ok((await envios()).length === 0, 'y no se escribe ninguna fila');
    await configurar({ recordatorios_activos: 1, fecha_permitida_propaganda: '2020-01-01', tope_diario_sms_automaticos: 200 });
  }

  console.log('\n[8] Fase 1 · duplicados: dos vueltas a la vez mandan UNA vez');
  {
    await limpiar();
    await regla();
    const vv = await votante();
    CANDIDATOS = [cand(vv, 'ev:1', D(2026, 11, 8, 9, 55), { evento: 'Reunión' })];
    const rs = await Promise.all([R.vuelta({ ahora: AHORA }), R.vuelta({ ahora: AHORA }), R.vuelta({ ahora: AHORA })]);
    ok(enviados.length === 1, 'tres vueltas simultáneas → 1 envío', enviados.length);
    ok(rs.reduce((a, x) => a + x.duplicados, 0) === 2, 'las otras dos cuentan como duplicado', rs.map((x) => x.duplicados));
    const r2 = await R.vuelta({ ahora: AHORA });
    ok(enviados.length === 1 && r2.enviados === 0, 'una vuelta posterior no reenvía lo ya registrado');
    const f = await envios();
    ok(f.length === 1 && f[0].estado === 'enviado' && f[0].proveedor_id === 'FALSO-1' && f[0].intentos === 1, 'una fila «enviado» con el id del proveedor y 1 intento', f[0]);
    ok(/Hola Persona/.test(enviados[0].texto) && /Reunion/.test(enviados[0].texto), 'el texto se armó con sus variables (y sin tildes: es un SMS)', enviados[0].texto);
  }

  console.log('\n[9] Fase 1 · catch-up tras un reinicio, sin reenviar');
  {
    await limpiar();
    await regla();
    const a = await votante(), b = await votante(), c = await votante();
    // «El proceso estuvo caído»: lo de las 09:00 tocaba hace una hora; lo de las 03:00 tocaba en pleno silencio; lo de las 05:00, hace mucho.
    CANDIDATOS = [cand(a, 'ev:a', D(2026, 11, 8, 9, 0), { evento: 'A' }), cand(b, 'ev:b', D(2026, 11, 8, 3, 0), { evento: 'B' })];
    const r = await R.vuelta({ ahora: D(2026, 11, 8, 8, 30) });
    ok(r.enviados === 1 && enviados[0].ficha === b, 'a las 08:30 sale lo que tocaba de madrugada (la gracia cuenta desde el fin del silencio) y no lo de las 09:00 (aún no toca)', enviados.map((x) => x.ficha));
    const r2 = await R.vuelta({ ahora: D(2026, 11, 8, 10, 0) });
    ok(r2.enviados === 1 && enviados.length === 2 && enviados[1].ficha === a, 'a las 10:00 sale lo de las 09:00, una sola vez', enviados.map((x) => x.ficha));
    const r3 = await R.vuelta({ ahora: D(2026, 11, 8, 10, 1) });
    ok(r3.enviados === 0 && enviados.length === 2, 'otra vuelta (o un reinicio) no repite nada');
    // Lo que tocaba hace más de su gracia ya no sale: se registra como vencido para no reevaluarlo.
    CANDIDATOS = [cand(c, 'ev:c', D(2026, 11, 8, 5, 0), { evento: 'C' })];
    const r4 = await R.vuelta({ ahora: D(2026, 11, 8, 12, 30) });
    const fc = (await envios()).find((x) => x.ocurrencia === 'ev:c');
    ok(r4.vencidos === 1 && enviados.length === 2 && fc && fc.estado === 'omitido' && /ventana/.test(fc.motivo), 'lo que tocaba a las 05:00 (efectiva 08:00) no sale a las 12:30: pasó su ventana de 3 h', fc);
  }

  console.log('\n[10] Fase 1 · silencio de 20:00 a 08:00');
  {
    await limpiar();
    await regla();
    const vv = await votante();
    CANDIDATOS = [cand(vv, 'ev:s', D(2026, 11, 8, 20, 30), { evento: 'Cena' })];   // tocaba en pleno silencio
    const noche = await R.vuelta({ ahora: D(2026, 11, 8, 21, 0) });
    ok(noche.omitida === 'silencio' && enviados.length === 0 && (await envios()).length === 0, 'a las 21:00 no sale nada y no se registra nada', noche);
    const justo = await R.vuelta({ ahora: D(2026, 11, 8, 20, 0) });
    ok(justo.omitida === 'silencio', 'a las 20:00 en punto ya es silencio');
    const madrugada = await R.vuelta({ ahora: D(2026, 11, 9, 7, 59) });
    ok(madrugada.omitida === 'silencio' && enviados.length === 0, 'a las 07:59 todavía es silencio');
    const manana = await R.vuelta({ ahora: D(2026, 11, 9, 8, 0) });
    ok(manana.enviados === 1 && enviados.length === 1, 'a las 08:00 sale lo que quedó esperando (efectiva 08:00: dentro de la gracia)', manana);
    // Lo mismo para push y correo: el silencio no es solo del SMS.
    ok(R.enSilencio({ silencio_inicio: '20:00:00', silencio_fin: '08:00:00' }, D(2026, 11, 8, 23, 0)) && !R.enSilencio({ silencio_inicio: '20:00:00', silencio_fin: '08:00:00' }, D(2026, 11, 8, 12, 0)), 'enSilencio: 23:00 sí, 12:00 no');
    await limpiar();
    await regla({ canal: 'push', plantilla: 'Mañana hay reunión.', asunto: 'Recordatorio' });
    const u = await usuario();
    CANDIDATOS = [cand(u, 'ev:p', D(2026, 11, 8, 20, 45), {}, 'usuario')];
    const p1 = await R.vuelta({ ahora: D(2026, 11, 8, 22, 0) });
    const p2 = await R.vuelta({ ahora: D(2026, 11, 9, 8, 5) });
    ok(p1.omitida === 'silencio' && p2.enviados === 1 && enviados[0].canal === 'push', 'el aviso en la app (push) también espera al fin del silencio');
  }

  console.log('\n[11] Fase 1 · tope diario de SMS automáticos, con reserva y límite del libro central');
  {
    await limpiar();
    await regla();
    await configurar({ tope_diario_sms_automaticos: 2 });
    const v = [await votante(), await votante(), await votante()];
    CANDIDATOS = v.map((x, i) => cand(x, 'ev:t' + i, D(2026, 11, 8, 9, 50 + i), { evento: 'T' }));
    // Tres a la vez: la reserva es un UPDATE condicional, así que no se pasan del tope.
    const rs = await Promise.all([R.vuelta({ ahora: AHORA }), R.vuelta({ ahora: AHORA })]);
    const total = rs.reduce((a, x) => a + x.enviados, 0);
    const dif = rs.reduce((a, x) => a + x.diferidos, 0);
    ok(total === 2 && enviados.length === 2, 'con tope 2 salen 2 SMS (aunque haya dos vueltas a la vez)', { total, enviados: enviados.length });
    ok(dif === 1, 'el tercero queda «diferido»', dif);
    const f = await envios();
    const difFila = f.find((x) => x.estado === 'diferido');
    ok(difFila && difFila.proximo_intento && difFila.proximo_intento.slice(0, 16) === '2026-11-09 08:00' && /Tope diario/.test(difFila.motivo), 'su nuevo intento es mañana a las 08:00, con el motivo', difFila);
    ok(Number((await q(`SELECT segmentos_usados s FROM recordatorio_tope_diario WHERE fecha = '2026-11-08'`))[0].s) === 2, 'el contador del día marca 2 segmentos');
    // Nunca más que el libro central.
    ok(R.topeEfectivo({ tope_diario_sms_automaticos: 200 }, { limiteDiario: 50 }) === 50, 'topeEfectivo: el del libro central (50) manda sobre 200');
    ok(R.topeEfectivo({ tope_diario_sms_automaticos: 30 }, { limiteDiario: 50 }) === 30, 'topeEfectivo: 30 < 50 → 30');
    ok(R.topeEfectivo({ tope_diario_sms_automaticos: 200 }, { limiteDiario: 0 }) === 200, 'topeEfectivo: el libro central en 0 («sin límite») no recorta');
    ok(R.topeEfectivo({ tope_diario_sms_automaticos: 200 }, null) === 200, 'topeEfectivo: sin libro central, el de la campaña');
    await limpiar();
    await regla();
    await configurar({ tope_diario_sms_automaticos: 200 });
    central = { limiteDiario: 1, disponibleHoy: 1 };
    const w = [await votante(), await votante()];
    CANDIDATOS = w.map((x, i) => cand(x, 'ev:c' + i, D(2026, 11, 9, 9, 50 + i), { evento: 'T' }));
    const rc = await R.vuelta({ ahora: D(2026, 11, 9, 10, 0) });
    ok(rc.enviados === 1 && rc.diferidos === 1, 'con 200 en la campaña pero límite 1 en el libro central, sale 1', rc);
    central = { limiteDiario: 100, disponibleHoy: 0 };
    CANDIDATOS = [cand(w[0], 'ev:sinsaldo', D(2026, 11, 9, 9, 59), { evento: 'T' })];
    const rs2 = await R.vuelta({ ahora: D(2026, 11, 9, 10, 1) });
    ok(rs2.enviados === 0 && rs2.diferidos === 1, 'sin cupo hoy en el libro central no sale', rs2);
    // Si el envío falla, el cupo se devuelve.
    await limpiar();
    await regla();
    central = null;
    const x = await votante();
    CANDIDATOS = [cand(x, 'ev:dev', D(2026, 11, 10, 9, 0), { evento: 'T' })];
    falloEnvio = new Error('el proveedor no responde');
    await R.vuelta({ ahora: D(2026, 11, 10, 10, 0) });
    ok(Number((await q(`SELECT segmentos_usados s FROM recordatorio_tope_diario WHERE fecha = '2026-11-10'`))[0].s) === 0, 'un envío que falla devuelve su cupo');
    falloEnvio = null;
    await configurar({ tope_diario_sms_automaticos: 200 });
  }

  console.log('\n[12] Fase 1 · consentimiento estricto (el NULL no autoriza) y baja');
  {
    await limpiar();
    await regla();
    const vOk = await votante(), vNull = await votante({ sms: null }), vCero = await votante({ sms: 0 }), vBaja = await votante({ baja: true });
    const vSinTel = await votante({ telefono: '' }), vEnlace = await votante({ origen: 'enlace_lider' }), vEnlaceOk = await votante({ origen: 'enlace_lider', confirmado: '2026-11-01 10:00:00' });
    CANDIDATOS = [vOk, vNull, vCero, vBaja, vSinTel, vEnlace, vEnlaceOk].map((x, i) => cand(x, 'ev:k' + i, D(2026, 11, 8, 9, 30), { evento: 'K' }));
    const r = await R.vuelta({ ahora: AHORA });
    const f = await envios();
    const de = (i) => f.find((x) => x.ocurrencia === 'ev:k' + i);
    ok(de(0).estado === 'enviado', 'autorizó por SMS → sale');
    ok(de(1).estado === 'omitido' && /NULL no autoriza/.test(de(1).motivo), 'consentimiento NULL → omitido («el NULL no autoriza»)', de(1).motivo);
    ok(de(2).estado === 'omitido' && /No autorizó/.test(de(2).motivo), 'consentimiento 0 → omitido', de(2).motivo);
    ok(de(3).estado === 'omitido' && /no recibir más/.test(de(3).motivo), 'con baja (no_contactar) → omitido', de(3).motivo);
    ok(de(4).estado === 'omitido' && /teléfono/.test(de(4).motivo), 'sin teléfono → omitido', de(4).motivo);
    ok(de(5).estado === 'omitido' && /no confirma/.test(de(5).motivo), 'inscrito por enlace y sin confirmar → omitido', de(5).motivo);
    ok(de(6).estado === 'enviado', 'inscrito por enlace y YA confirmado → sale');
    ok(r.enviados === 2 && r.omitidos === 5 && enviados.length === 2, 'en total salieron 2 de 7', r);
    // Push: solo a quien tiene cuenta, y la baja cuenta. WhatsApp: nunca.
    const { puedeEscribirseEstricto } = require('../lib/canalesDelEnlace');
    ok(puedeEscribirseEstricto({ telefono: '3001', consentimiento_sms: 1 }, 'whatsapp').ok === false, 'WhatsApp automático: nunca');
    await limpiar();
    await regla({ canal: 'push', plantilla: 'Recordatorio.', asunto: 'Aviso' });
    const uOk = await usuario(), uBaja = await usuario({ baja: true }), vPush = await votante();
    CANDIDATOS = [cand(uOk, 'ev:u1', D(2026, 11, 8, 9, 30), {}, 'usuario'), cand(uBaja, 'ev:u2', D(2026, 11, 8, 9, 30), {}, 'usuario'), cand(vPush, 'ev:u3', D(2026, 11, 8, 9, 30), {}, 'votante')];
    await R.vuelta({ ahora: AHORA });
    const fp = await envios();
    ok(fp.find((x) => x.ocurrencia === 'ev:u1').estado === 'enviado', 'push a alguien del equipo → sale');
    ok(fp.find((x) => x.ocurrencia === 'ev:u2').estado === 'omitido', 'push a alguien del equipo con baja → omitido');
    ok(fp.find((x) => x.ocurrencia === 'ev:u3').estado === 'omitido', 'push a un votante (no tiene cuenta) → omitido');
    // «Ya votó» en el tipo de Día D.
    await limpiar();
    await regla({ tipo: 'dia_d_ya_votaste', plantilla: 'Hola {nombre}, ya votaste?' });
    const yv = await votante(), nv = await votante();
    await q(`INSERT INTO votante_votos (votante_id, origen) VALUES (?, 'equipo')`, [yv]);
    CANDIDATOS = [cand(yv, 'dia:1', D(2026, 11, 8, 9, 30)), cand(nv, 'dia:1', D(2026, 11, 8, 9, 30))];
    await R.vuelta({ ahora: AHORA });
    const fy = await envios();
    ok(fy.find((x) => x.destinatario_id === yv).estado === 'omitido' && /Ya votó/.test(fy.find((x) => x.destinatario_id === yv).motivo), '«¿ya votaste?» no le llega a quien ya votó', fy.map((x) => x.estado));
    ok(fy.find((x) => x.destinatario_id === nv).estado === 'enviado', 'y sí a quien no ha votado');
  }

  console.log('\n[13] Fase 1 · bloqueo de precampaña');
  {
    await limpiar();
    await configurar({ fecha_permitida_propaganda: null, cargo_aspira: null });
    const base = { tipo: 'evento', canal: 'sms', nombre: 'P', desfase_min: -120 };
    const malas = [
      'Te esperamos para votar el domingo', 'Recuerda tu voto', 'Ya hay elecciones, {nombre}', 'Pasa por las urnas', 'Con el tarjetón en la mano',
      'Apóyanos para el cargo', 'Vota por {candidato}', 'La Alcaldía te necesita', 'Un concejal más', 'Gobernación para todos', 'ELECCIÓN 2026', 'Tu votación cuenta', 'Asamblea departamental', 'Hola, ¿ya votaste?',
    ];
    for (const m of malas) {
      let rechazo = null;
      try { await R.guardarRegla({ ...base, plantilla: m }); } catch (e) { rechazo = e; }
      ok(rechazo && rechazo.errores && /Antes de la fecha permitida/.test(rechazo.errores[0]), `antes de la fecha permitida se rechaza «${m}»`, rechazo && rechazo.message);
    }
    await configurar({ cargo_aspira: 'camara_representantes' });
    let r2 = null; try { await R.guardarRegla({ ...base, plantilla: 'Gracias por apoyar a la camara representantes' }); } catch (e) { r2 = e; }
    ok(r2 && /camara representantes/i.test(r2.message), 'también se rechaza el cargo que la campaña tiene configurado (camara_representantes)', r2 && r2.message);
    await configurar({ cargo_aspira: null });
    let buena = null; try { buena = await R.guardarRegla({ ...base, plantilla: 'Hola {nombre}, te esperamos en {evento}.' }); } catch (e) { buena = e; }
    ok(typeof buena === 'number', 'una plantilla neutra sí se guarda', buena && buena.message);
    ok(Number((await q(`SELECT activo FROM recordatorio_reglas WHERE id = ?`, [buena]))[0].activo) === 0, 'y una regla nueva nace APAGADA');
    let asuntoMalo = null; try { await R.guardarRegla({ ...base, canal: 'email', plantilla: 'Hola', asunto: 'Tu voto importa' }); } catch (e) { asuntoMalo = e; }
    ok(asuntoMalo && /voto/i.test(asuntoMalo.message), 'el asunto también se revisa');
    // Con fecha permitida futura sigue bloqueado; con la de hoy o pasada, no.
    await configurar({ fecha_permitida_propaganda: '2026-11-20' });
    let fut = null; try { await R.guardarRegla({ ...base, plantilla: 'Recuerda votar' }); } catch (e) { fut = e; }
    ok(fut, 'con una fecha permitida FUTURA sigue bloqueado');
    ok(R.propagandaPermitida({ fecha_permitida_propaganda: '2026-11-08' }, D(2026, 11, 8, 0, 1)) === true && R.propagandaPermitida({ fecha_permitida_propaganda: '2026-11-09' }, D(2026, 11, 8, 23, 59)) === false && R.propagandaPermitida({ fecha_permitida_propaganda: null }, AHORA) === false,
      'propagandaPermitida: el mismo día sí, el día antes no, vacía nunca');
    await configurar({ fecha_permitida_propaganda: '2026-11-01' });
    let desp = null; try { desp = await R.guardarRegla({ ...base, plantilla: 'Recuerda votar el domingo' }); } catch (e) { desp = e; }
    ok(typeof desp === 'number', 'pasada la fecha permitida, la misma plantilla se guarda', desp && desp.message);

    // Y otra vez al enviar, con el texto armado: una regla que ya estaba guardada se frena si la fecha se mueve.
    await limpiar();
    await configurar({ fecha_permitida_propaganda: null, cargo_aspira: null });
    await regla({ plantilla: 'Hola {nombre}, ya votaste?' });          // se coló directo a la base (o la fecha se movió después)
    const vv = await votante();
    CANDIDATOS = [cand(vv, 'dia:p', D(2026, 11, 8, 9, 30), { evento: 'x' })];
    await R.vuelta({ ahora: AHORA });
    const f = (await envios())[0];
    ok(f.estado === 'omitido' && /Precampaña/.test(f.motivo) && enviados.length === 0, 'al enviar, una regla con texto de voto antes de la fecha permitida queda «omitido» (precampaña) y no sale', f);
    await configurar({ fecha_permitida_propaganda: '2020-01-01' });
  }

  console.log('\n[14] Fase 1 · variables cerradas y un solo segmento');
  {
    const cfg = { nombre_candidato: 'Campaña de ejemplo', slogan_campana: 'Juntos por el barrio', fecha_permitida_propaganda: '2020-01-01' };
    const sms = { firma: '', bajaAutomatica: true };
    const v = (o) => R.validarPlantilla({ tipo: 'evento', canal: 'sms', ...o }, { cfg, sms, ahora: AHORA });
    ok(v({ plantilla: 'Hola {nombre}, te esperamos en {evento}.' }).ok, 'una plantilla corta con variables permitidas pasa');
    const mala = v({ plantilla: 'Hola {nombre}, {clave_secreta} y {telefono}' });
    ok(!mala.ok && /clave_secreta/.test(mala.errores[0]) && /telefono/.test(mala.errores[0]), 'una variable fuera de la lista cerrada se rechaza', mala.errores);
    ok(!R.validarPlantilla({ tipo: 'inventado', canal: 'sms', plantilla: 'x' }, { cfg, sms, ahora: AHORA }).ok, 'un tipo que no existe se rechaza');
    ok(!v({ plantilla: 'Hola {nombre' }).ok, 'una llave suelta se rechaza');
    ok(!v({ plantilla: '   ' }).ok, 'una plantilla vacía se rechaza');
    const larga = v({ plantilla: 'Hola {nombre}, te escribimos desde {candidato} para contarte que {evento} se hará en {lugar} el {fecha} a las {hora}. Cuenta con nosotros siempre, gracias.' });
    ok(!larga.ok && /pasa de un SMS/.test(larga.errores.join(' ')), 'pasar de un SMS (160) contando firma y enlace de baja se rechaza', larga.errores);
    // El enlace de baja cuenta en los tipos que lo llevan (aquí uno de prueba): lo que cabe sin él, con él ya no.
    R.registrarTipo('con_baja', { variables: ['nombre', 'candidato', 'eslogan'], conBaja: true });
    const vb = (o) => R.validarPlantilla({ tipo: 'con_baja', canal: 'sms', ...o }, { cfg, sms, ahora: AHORA });
    const justo = 'x'.repeat(160 - R.LARGO_BAJA_SMS);
    ok(vb({ plantilla: justo }).ok && !vb({ plantilla: justo + 'xy' }).ok, `con el enlace de baja (${R.LARGO_BAJA_SMS}) caben ${160 - R.LARGO_BAJA_SMS} caracteres y uno más no`);
    // El recordatorio de evento NO lleva el enlace de baja al final (es operativo): caben los 160 enteros.
    ok(v({ plantilla: 'x'.repeat(160) }).ok && !v({ plantilla: 'x'.repeat(161) }).ok, 'el tipo «evento» no lleva enlace de baja: caben 160 caracteres y 161 no');
    // La firma del operador también cuenta.
    const conFirma = R.validarPlantilla({ tipo: 'evento', canal: 'sms', plantilla: 'x'.repeat(150) }, { cfg, sms: { firma: ' Equipo Prueba', bajaAutomatica: true }, ahora: AHORA });
    ok(!conFirma.ok, 'la firma del operador se suma al largo');
    // El texto de fábrica de los eventos y el del «¿ya votaste?» caben en UN segmento con los datos más largos.
    const fabrica = FABRICA;   // las que sembró init-db, leídas antes de que las pruebas borren las reglas
    ok(fabrica.length > 0 && fabrica.every((r) => R.validarPlantilla(r, { cfg: { ...cfg, fecha_permitida_propaganda: '2020-01-01' }, sms: { firma: '', bajaAutomatica: true }, ahora: AHORA }).ok), 'las 7 plantillas de fábrica pasan el validador (un segmento, variables permitidas) una vez permitida la propaganda', fabrica.length);
    const sinFecha = R.validarPlantilla({ tipo: 'evento', canal: 'sms', plantilla: fabrica.find((r) => r.tipo === 'evento').plantilla }, { cfg: { ...cfg, fecha_permitida_propaganda: null }, sms, ahora: AHORA });
    ok(sinFecha.ok, 'la plantilla de fábrica de eventos NO nombra ni cargo ni voto: pasa también ANTES de la fecha permitida', sinFecha.errores);
    const yv = fabrica.find((r) => r.tipo === 'dia_d_ya_votaste');
    const yvAntes = R.validarPlantilla({ ...yv, activo: 0 }, { cfg: { ...cfg, fecha_permitida_propaganda: null }, sms, ahora: AHORA });
    ok(yvAntes.ok && yvAntes.avisos.length === 1, 'la del «¿ya votaste?» se puede guardar apagada antes de la fecha (con aviso)', yvAntes);
    ok(!R.validarPlantilla({ ...yv, activo: 1 }, { cfg: { ...cfg, fecha_permitida_propaganda: null }, sms, ahora: AHORA }).ok, 'pero ACTIVA antes de la fecha permitida no pasa');
    // Y sin enlace de baja (Día D), cabe más.
    const dia = R.validarPlantilla({ tipo: 'dia_d_ya_votaste', canal: 'sms', plantilla: 'x'.repeat(100) }, { cfg, sms, ahora: AHORA });
    ok(dia.ok, 'el tipo de Día D no lleva enlace de baja al final: 100 caracteres caben');
    // Una tilde no cuenta contra el límite: se transliteran antes de medir.
    ok(v({ plantilla: 'á'.repeat(60) }).ok, 'las tildes se transliteran antes de medir (no bajan el límite a 70)');
    ok(!R.validarPlantilla({ tipo: 'evento', canal: 'push', asunto: 'x'.repeat(51), plantilla: 'Hola' }, { cfg, sms, ahora: AHORA }).ok, 'el título de un push pasa de 50: se rechaza');
    ok(!R.validarPlantilla({ tipo: 'evento', canal: 'email', plantilla: 'Hola' }, { cfg, sms, ahora: AHORA }).ok, 'un correo sin asunto se rechaza');
    // Armado: si falta un dato, no se manda a medias.
    await limpiar();
    await regla({ plantilla: 'Hola {nombre}, {evento} en {lugar}.' });
    const vv = await votante();
    CANDIDATOS = [cand(vv, 'ev:falta', D(2026, 11, 8, 9, 30), { evento: 'Reunión' })];   // sin lugar
    await R.vuelta({ ahora: AHORA });
    const f = (await envios())[0];
    ok(f.estado === 'omitido' && /lugar/.test(f.motivo) && enviados.length === 0, 'si falta el dato de una variable no se manda a medias', f);
    // Armado con un nombre larguísimo: pasa de un segmento y no sale.
    await limpiar();
    await regla({ plantilla: 'Hola {nombre}, te esperamos en {evento}. Es muy importante que vengas puntual y que traigas a tus vecinos y familiares para conversar con calma sobre el barrio.' });   // (directo a la base: el validador la habría rechazado)
    const largo = await votante({ nombre: 'Anastasiaextraordinariamente Pérez' });
    CANDIDATOS = [cand(largo, 'ev:largo', D(2026, 11, 8, 9, 30), { evento: 'La reunión grande del sector norte de la ciudad' })];
    await R.vuelta({ ahora: AHORA });
    const fl = (await envios())[0];
    ok(fl.estado === 'omitido' && /pasa de un SMS/.test(fl.motivo), 'armado el mensaje con datos largos pasa de un SMS: no se manda', fl);
  }

  console.log('\n[15] Fase 1 · reintentos con espera, y «enviando» viejas reconciliadas');
  {
    await limpiar();
    await regla();
    const vv = await votante();
    CANDIDATOS = [cand(vv, 'ev:r', D(2026, 11, 8, 9, 0), { evento: 'R' })];
    let intentos = 0;
    falloEnvio = () => (++intentos < 3 ? new Error('proveedor caído') : null);
    const r1 = await R.vuelta({ ahora: D(2026, 11, 8, 10, 0) });
    let f = (await envios())[0];
    ok(r1.reintentos === 1 && f.estado === 'reclamado' && f.intentos === 1 && f.proximo_intento === '2026-11-08 10:05:00', 'el 1.er fallo: a reintentar en 5 minutos', f);
    const r2 = await R.vuelta({ ahora: D(2026, 11, 8, 10, 4) });
    ok(r2.enviados === 0 && r2.duplicados === 1 && intentos === 1, 'a los 4 minutos todavía no se reintenta', r2);
    const r3 = await R.vuelta({ ahora: D(2026, 11, 8, 10, 6) });
    f = (await envios())[0];
    ok(r3.reintentos === 1 && f.intentos === 2 && f.proximo_intento === '2026-11-08 10:21:00', 'a los 6 minutos reintenta; el 2.º fallo espera 15 minutos', f);
    const r4 = await R.vuelta({ ahora: D(2026, 11, 8, 10, 25) });
    f = (await envios())[0];
    ok(r4.enviados === 1 && f.estado === 'enviado' && f.intentos === 3 && enviados.length === 1, 'al 3.er intento sale, una sola vez', f);
    // Siempre falla: al tercero queda «fallido» y se acabó.
    await limpiar();
    await regla();
    CANDIDATOS = [cand(vv, 'ev:r2', D(2026, 11, 8, 9, 0), { evento: 'R' })];
    falloEnvio = new Error('no hay forma');
    await R.vuelta({ ahora: D(2026, 11, 8, 10, 0) });
    await R.vuelta({ ahora: D(2026, 11, 8, 10, 6) });
    await R.vuelta({ ahora: D(2026, 11, 8, 10, 30) });
    const r5 = await R.vuelta({ ahora: D(2026, 11, 8, 11, 30) });
    f = (await envios())[0];
    ok(f.estado === 'fallido' && f.intentos === 3 && /3 intentos/.test(f.motivo) && r5.enviados === 0, 'tres intentos fallidos → «fallido» definitivo', f);
    falloEnvio = null;
    // Fuera de la franja del proveedor: se difiere sin gastar un intento.
    await limpiar();
    await regla();
    CANDIDATOS = [cand(vv, 'ev:fr', D(2026, 11, 8, 9, 0), { evento: 'F' })];
    falloEnvio = () => { const e = new Error('hora'); e.codigo = 'FUERA_DE_FRANJA'; return e; };
    const rf = await R.vuelta({ ahora: D(2026, 11, 8, 10, 0) });
    f = (await envios())[0];
    ok(rf.diferidos === 1 && f.estado === 'diferido' && f.intentos === 0, 'FUERA_DE_FRANJA → diferido, sin gastar intento', f);
    falloEnvio = null;

    // «enviando» viejas: se reconcilian con la bitácora de SMS, sin reenviar.
    await limpiar();
    const idRegla = await regla();
    const a = await votante(), b = await votante();
    const [r] = await pool.query(`INSERT INTO recordatorio_envios (regla_id, destinatario_tipo, destinatario_id, ocurrencia, canal, estado, debe_salir_en, reclamado_en) VALUES (?, 'votante', ?, 'ev:e1', 'sms', 'enviando', '2026-11-08 09:00:00', '2026-11-08 09:00:00')`, [idRegla, a]);
    const [r2b] = await pool.query(`INSERT INTO recordatorio_envios (regla_id, destinatario_tipo, destinatario_id, ocurrencia, canal, estado, debe_salir_en, reclamado_en) VALUES (?, 'votante', ?, 'ev:e2', 'sms', 'enviando', '2026-11-08 09:00:00', '2026-11-08 09:00:00')`, [idRegla, b]);
    await q(`INSERT INTO sms_envios (destino, mensaje, estado, proveedor_id, lote_id, contacto_id) VALUES ('573001111113','Hola','aceptado','REC-77',?,?)`, [`rec-${idRegla}`, r.insertId]);
    CANDIDATOS = [cand(a, 'ev:e1', D(2026, 11, 8, 9, 0), { evento: 'E' }), cand(b, 'ev:e2', D(2026, 11, 8, 9, 0), { evento: 'E' })];
    await R.vuelta({ ahora: D(2026, 11, 8, 10, 0) });
    const fe = await envios();
    ok(fe[0].estado === 'enviado' && fe[0].proveedor_id === 'REC-77', 'una «enviando» vieja con rastro «aceptado» queda enviada con su id', fe[0]);
    ok(fe[1].estado === 'fallido' && /no se pudo confirmar/.test(fe[1].motivo), 'una «enviando» vieja SIN rastro queda «fallido» con la advertencia', fe[1]);
    ok(enviados.length === 0, 'y no se mandó nada a ciegas', enviados.length);
    // Una «reclamado» vieja sin hora (el proceso murió antes de llamar al proveedor) se libera y sale.
    await limpiar();
    const idR = await regla();
    const c = await votante();
    await q(`INSERT INTO recordatorio_envios (regla_id, destinatario_tipo, destinatario_id, ocurrencia, canal, estado, debe_salir_en, reclamado_en) VALUES (?, 'votante', ?, 'ev:z', 'sms', 'reclamado', '2026-11-08 09:00:00', '2026-11-08 09:00:00')`, [idR, c]);
    CANDIDATOS = [cand(c, 'ev:z', D(2026, 11, 8, 9, 0), { evento: 'Z' })];
    const rz1 = await R.vuelta({ ahora: D(2026, 11, 8, 10, 0) });
    const rz2 = await R.vuelta({ ahora: D(2026, 11, 8, 10, 1) });
    ok(rz1.enviados + rz2.enviados === 1 && enviados.length === 1, 'una «reclamado» abandonada antes de llamar al proveedor se libera y sale UNA vez', [rz1, rz2]);
  }

  console.log('\n[16] Fase 1 · sin fuente no hace nada, y el arranque no estorba');
  {
    await limpiar();
    await regla({ tipo: 'evento' });
    const sinFuente = R.TIPOS.evento.candidatos;
    delete R.TIPOS.evento.candidatos;
    const r = await callado(() => R.vuelta({ ahora: AHORA }))();
    ok(r.sinFuente === 1 && enviados.length === 0, 'una regla de un tipo sin fuente de candidatos no hace nada (los eventos llegan en la fase siguiente)', r);
    R.TIPOS.evento.candidatos = sinFuente;
    const t = R.iniciar();
    ok(t && typeof t.unref === 'function', 'iniciar() devuelve un temporizador que no retiene el proceso');
    clearInterval(t);
  }

  /* ============================================================ FASES 2, 3 y 4: con las fuentes VERDADERAS */
  require('../lib/recordatoriosFuentes').registrar(R);   // restaura las fuentes reales de eventos y «¿ya votaste?»
  R.deps.enlaceYaVoto = async (id) => `https://campana.prueba/v/TOK${id}`;
  const fechaTxt = (d) => R.aTexto(d);
  async function evento(o) {
    const r = await q(`INSERT INTO eventos (titulo, tipo, fecha_inicio, lugar, estado, created_by, created_at) VALUES (?, 'reunion', ?, ?, ?, 1, ?)`,
      [o.titulo || 'Reunión del sector', fechaTxt(o.inicio), o.lugar === undefined ? 'Salón comunal' : o.lugar, o.estado || 'programado', o.creado || '2026-11-01 08:00:00']);
    return r.insertId;
  }
  const asistente = (evId, o) => q(`INSERT INTO evento_asistentes (evento_id, votante_id, usuario_id, nombre_invitado) VALUES (?,?,?,?)`, [evId, o.votante || null, o.usuario || null, o.invitado || null]);
  const PLANTILLA_EVENTO = '{nombre}, te esperamos en {evento} el {fecha} a las {hora} en {lugar}.';
  async function reglaEvento(canal, desfase, asunto) {
    const id = await regla({ tipo: 'evento', canal, plantilla: PLANTILLA_EVENTO, asunto: asunto || (canal === 'push' ? 'Recordatorio de evento' : canal === 'email' ? 'Recordatorio: {evento}' : null), nombre: `Evento ${canal} ${desfase}` });
    await q(`UPDATE recordatorio_reglas SET desfase_min = ? WHERE id = ?`, [desfase, id]);
    return id;
  }
  const reglasDe = (id) => q(`SELECT * FROM recordatorio_reglas WHERE id = ?`, [id]).then((f) => f[0]);
  async function fijarDesfase(id, desfase) { await q(`UPDATE recordatorio_reglas SET desfase_min = ? WHERE id = ?`, [desfase, id]); }
  await q(`UPDATE configuracion_campana SET nombre_candidato = 'Campaña de ejemplo', slogan_campana = NULL, cargo_aspira = NULL WHERE id = 1`);

  console.log('\n[17] Fase 2 · eventos: «X horas antes», equipo por push y votantes por SMS o correo con consentimiento');
  {
    await limpiar();
    await configurar({ recordatorios_activos: 1, fecha_permitida_propaganda: null, tope_diario_sms_automaticos: 200 });
    const rSms = await reglaEvento('sms', -1440), rEmail = await reglaEvento('email', -1440), rPush = await reglaEvento('push', -120);
    await fijarDesfase(rSms, -1440); await fijarDesfase(rEmail, -1440); await fijarDesfase(rPush, -120);
    const A = await votante({ nombre: 'Ana Ejemplo', sms: 1, email: 1 }), B = await votante({ sms: null, email: 1 }), Cb = await votante({ baja: true }), Dv = await votante({ sms: 1, email: null });
    const U1 = await usuario({ nombre: 'Laura Equipo' }), U2 = await usuario({ baja: true });
    const ev = await evento({ inicio: D(2026, 11, 9, 10, 0) });
    for (const x of [{ votante: A }, { votante: B }, { votante: Cb }, { votante: Dv }, { usuario: U1 }, { usuario: U2 }, { invitado: 'Invitado sin ficha' }]) await asistente(ev, x);
    const r0 = await R.vuelta({ ahora: D(2026, 11, 8, 9, 0) });
    ok(r0.enviados === 0 && enviados.length === 0, 'a las 09:00 (25 h antes) todavía no sale nada');
    const r1 = await R.vuelta({ ahora: D(2026, 11, 8, 10, 5) });
    const sms = enviados.filter((e) => e.canal === 'sms'), cor = enviados.filter((e) => e.canal === 'email');
    ok(sms.length === 2 && sms.map((e) => e.ficha).sort().join() === [A, Dv].sort().join(), 'a las 10:05 (24 h antes) el SMS sale a los votantes asistentes con SMS autorizado (A y D), no a B (NULL) ni a C (baja)', sms.map((e) => e.ficha));
    ok(cor.length === 2 && cor.map((e) => e.ficha).sort().join() === [A, B].sort().join(), 'el correo, a quienes autorizaron correo (A y B); D no, y C tiene baja', cor.map((e) => e.ficha));
    ok(sms.find((e) => e.ficha === A).texto === 'Ana, te esperamos en Reunion del sector el lun 9 nov a las 10:00 am en Salon comunal.', 'el texto de fábrica se arma con su fecha y hora, sin tildes', sms[0].texto);
    ok(cor[0].asunto === 'Recordatorio: Reunión del sector', 'el asunto del correo lleva el evento (con tildes: es correo)', cor[0].asunto);
    ok(!enviados.some((e) => e.canal === 'push') && !enviados.some((e) => [U1, U2].includes(e.ficha) && e.canal !== 'push'), 'el equipo NO recibe SMS ni correo');
    const rp = await R.vuelta({ ahora: D(2026, 11, 9, 8, 5) });
    const push = enviados.filter((e) => e.canal === 'push');
    ok(push.length === 1 && push[0].ficha === U1 && push[0].asunto === 'Recordatorio de evento', 'a las 08:05 (2 h antes) el equipo invitado recibe el aviso en la app (U1)', push.length);
    const filaU2 = (await envios()).find((e) => e.destinatario_id === U2 && e.canal === 'push');
    ok(filaU2 && filaU2.estado === 'omitido' && /no recibir más/.test(filaU2.motivo), 'quien del equipo pidió la baja queda «omitido»', filaU2);
    const antes = enviados.length;
    await R.vuelta({ ahora: D(2026, 11, 9, 8, 6) }); await R.vuelta({ ahora: D(2026, 11, 8, 10, 6) });
    ok(enviados.length === antes, 'otra vuelta no repite nada');
  }

  console.log('\n[18] Fase 2 · un evento que cambia de fecha o se cancela: los pendientes se recalculan o se cancelan');
  {
    await limpiar();
    await configurar({ recordatorios_activos: 1, tope_diario_sms_automaticos: 0 });   // tope 0: todo queda «diferido» (pendiente)
    const rSms = await reglaEvento('sms', -120);
    const V = [await votante(), await votante()];
    const ev = await evento({ inicio: D(2026, 11, 10, 10, 0) });
    await asistente(ev, { votante: V[0] });
    await R.vuelta({ ahora: D(2026, 11, 10, 8, 10) });
    let f = await envios();
    ok(f.length === 1 && f[0].estado === 'diferido' && /Tope diario/.test(f[0].motivo), 'con el tope en 0 el recordatorio queda «diferido»', f);
    // El evento se mueve un día: lo pendiente de la fecha vieja se cancela y se recalcula con la nueva.
    await q(`UPDATE eventos SET fecha_inicio = ? WHERE id = ?`, [fechaTxt(D(2026, 11, 11, 10, 0)), ev]);
    await R.vuelta({ ahora: D(2026, 11, 10, 8, 12) });
    f = await envios();
    ok(f[0].estado === 'omitido' && /cambió de fecha/.test(f[0].motivo), 'el pendiente de la fecha vieja se cancela («cambió de fecha»)', f[0]);
    await configurar({ tope_diario_sms_automaticos: 200 });
    const r = await R.vuelta({ ahora: D(2026, 11, 11, 8, 5) });
    f = await envios();
    ok(r.enviados === 1 && f.length === 2 && f[1].estado === 'enviado' && /2026-11-11T10:00/.test(f[1].ocurrencia), 'a las 2 h de la fecha NUEVA sale el recordatorio nuevo (otra ocurrencia)', f.map((x) => x.ocurrencia));
    ok(/el mar 11 nov a las 10:00 am/.test(enviados[enviados.length - 1].texto) || /mie 11 nov/.test(enviados[enviados.length - 1].texto), 'y dice la fecha nueva', enviados[enviados.length - 1].texto);
    // Cancelado: lo pendiente se cancela (también al llamarlo desde la ruta de eventos, sin esperar a la vuelta).
    await configurar({ tope_diario_sms_automaticos: 0 });
    const ev2 = await evento({ inicio: D(2026, 11, 12, 10, 0) });
    await asistente(ev2, { votante: V[1] });
    await R.vuelta({ ahora: D(2026, 11, 12, 8, 10) });
    ok((await envios()).find((x) => x.ocurrencia.startsWith(`evento:${ev2}:`)).estado === 'diferido', 'otro evento: pendiente («diferido»)');
    await q(`UPDATE eventos SET estado = 'cancelado' WHERE id = ?`, [ev2]);
    const n = await R.limpiarRecordatoriosDeEvento(ev2);
    const fc = (await envios()).find((x) => x.ocurrencia.startsWith(`evento:${ev2}:`));
    ok(n === 1 && fc.estado === 'omitido' && /cancelado/.test(fc.motivo), 'al cancelar el evento su recordatorio pendiente se cancela de inmediato', fc);
    // Borrado: la fila pendiente se cancela con su motivo.
    const ev3 = await evento({ inicio: D(2026, 11, 12, 18, 0) });
    await asistente(ev3, { votante: V[0] });
    await R.vuelta({ ahora: D(2026, 11, 12, 16, 10) });
    await q(`DELETE FROM eventos WHERE id = ?`, [ev3]);
    await R.limpiarRecordatoriosDeEvento(ev3);
    ok(/ya no existe/.test((await envios()).find((x) => x.ocurrencia.startsWith(`evento:${ev3}:`)).motivo), 'si el evento se borra, su recordatorio pendiente se cancela');
  }

  console.log('\n[19] Fase 2 · diferido por tope o silencio: sale mientras el evento no haya empezado; si ya empezó, se descarta con motivo');
  {
    await limpiar();
    await configurar({ recordatorios_activos: 1, tope_diario_sms_automaticos: 1 });
    await reglaEvento('sms', -120);
    const [a, b] = [await votante(), await votante()];
    const ev = await evento({ inicio: D(2026, 11, 13, 15, 0) });
    await asistente(ev, { votante: a }); await asistente(ev, { votante: b });
    const r = await R.vuelta({ ahora: D(2026, 11, 13, 13, 5) });
    let f = await envios();
    ok(r.enviados === 1 && f.filter((x) => x.estado === 'diferido').length === 1, 'tope 1: sale uno y el otro queda diferido para mañana', f.map((x) => x.estado));
    await R.vuelta({ ahora: D(2026, 11, 14, 8, 5) });
    f = await envios();
    const dif = f.find((x) => x.destinatario_id !== f.find((y) => y.estado === 'enviado').destinatario_id);
    ok(dif.estado === 'omitido' && /ya empezó/.test(dif.motivo), 'al día siguiente el evento ya empezó: el diferido se descarta con motivo', dif);
    // Diferido por el SILENCIO: el recordatorio tocaba a las 07:00 (silencio); a las 08:05 el evento de las 09:00 NO ha empezado → sale.
    await limpiar();
    await configurar({ recordatorios_activos: 1, tope_diario_sms_automaticos: 200 });
    await reglaEvento('sms', -120);
    const c = await votante(), d = await votante();
    const evA = await evento({ inicio: D(2026, 11, 15, 9, 0), titulo: 'Taller de las nueve' }), evB = await evento({ inicio: D(2026, 11, 15, 7, 0), titulo: 'Caminata temprana' });
    await asistente(evA, { votante: c }); await asistente(evB, { votante: d });
    await R.vuelta({ ahora: D(2026, 11, 15, 6, 0) });
    ok(enviados.length === 0 && (await envios()).length === 0, 'en pleno silencio no sale ni se registra nada');
    const rs = await R.vuelta({ ahora: D(2026, 11, 15, 8, 5) });
    f = await envios();
    const fa = f.find((x) => x.destinatario_id === c), fb = f.find((x) => x.destinatario_id === d);
    ok(fa.estado === 'enviado' && /Taller de las nueve/.test(enviados[0].texto), 'el evento de las 09:00 (recordatorio de las 07:00, en silencio) sale a las 08:05, antes de empezar', fa);
    ok(fb.estado === 'omitido' && /ya empezó/.test(fb.motivo), 'el de las 07:00 ya había empezado al terminar el silencio: se descarta con motivo', fb);
    // Un evento CREADO después de la hora del recordatorio no recibe uno tardío.
    await limpiar();
    await configurar({ recordatorios_activos: 1 });
    await reglaEvento('sms', -1440); await reglaEvento('sms', -120);
    const e = await votante();
    const evL = await evento({ inicio: D(2026, 11, 16, 10, 0), creado: '2026-11-16 09:00:00' });
    await asistente(evL, { votante: e });
    const rl = await R.vuelta({ ahora: D(2026, 11, 16, 9, 30) });
    ok(rl.candidatos === 0 && enviados.length === 0, 'un evento creado 1 h antes no recibe un «24 h antes» ni un «2 h antes» tardíos');
  }

  console.log('\n[20] Fase 3 · «¿ya votaste?»: solo la fecha de elección, a la hora H, a quien no ha votado y con SMS estricto');
  {
    await limpiar();
    await q('DELETE FROM votantes');   // solo las personas de ESTA prueba: la fuente real mira a todos los votantes
    await configurar({ recordatorios_activos: 1, fecha_permitida_propaganda: '2020-01-01', tope_diario_sms_automaticos: 200, fecha_eleccion: '2026-11-08', jornada_apertura: '08:00:00', jornada_cierre: '16:00:00' });
    const PL = '{nombre}, ¿ya votaste? Si ya lo hiciste, avísanos aquí: {enlace_ya_vote}';
    const r1 = await regla({ tipo: 'dia_d_ya_votaste', nombre: 'Ronda 1', plantilla: PL, gracia: 60 }); await q(`UPDATE recordatorio_reglas SET hora_dia = '14:00:00' WHERE id = ?`, [r1]);
    const r2 = await regla({ tipo: 'dia_d_ya_votaste', nombre: 'Ronda 2', plantilla: PL, gracia: 60 }); await q(`UPDATE recordatorio_reglas SET hora_dia = '15:00:00', activo = 0 WHERE id = ?`, [r2]);
    const V1 = await votante({ nombre: 'Uno Pendiente' }), V2 = await votante({ nombre: 'Dos Voto' }), V3 = await votante({ sms: null }), V4 = await votante({ sms: 0 }), V5 = await votante({ baja: true });
    const V6 = await votante({ nombre: 'Seis Pendiente' }), V7 = await votante({ telefono: '' });
    await q(`INSERT INTO votante_votos (votante_id, origen) VALUES (?, 'equipo')`, [V2]);   // votó ANTES de la hora
    const a0 = await R.vuelta({ ahora: D(2026, 11, 8, 13, 59) });
    ok(a0.candidatos === 0 && enviados.length === 0, 'a las 13:59 todavía no es la hora H: no sale nada');
    const a1 = await R.vuelta({ ahora: D(2026, 11, 8, 14, 0) });
    ok(a1.enviados === 2 && enviados.map((e) => e.ficha).sort().join() === [V1, V6].sort().join(), 'a las 14:00 salen SOLO V1 y V6: no votaron y autorizaron SMS', enviados.map((e) => e.ficha));
    ok(enviados.length === 2 && !enviados.some((e) => [V2, V3, V4, V5, V7].includes(e.ficha)), 'no sale a quien votó antes de la hora, ni sin consentimiento (NULL o 0), ni con baja, ni sin teléfono');
    ok(enviados[0].texto === `Uno, ya votaste? Si ya lo hiciste, avisanos aqui: https://campana.prueba/v/TOK${V1}`, 'el SMS lleva su propio enlace «Ya voté» y va sin tildes', enviados[0].texto);
    await R.vuelta({ ahora: D(2026, 11, 8, 14, 5) });
    ok(enviados.length === 2, 'una sola ronda por persona y regla: a las 14:05 no se repite');
    // La segunda ronda está apagada: a las 15:00 no sale nada hasta que se active.
    await q(`INSERT INTO votante_votos (votante_id, origen) VALUES (?, 'equipo')`, [V6]);   // V6 vota a las 14:30
    const b0 = await R.vuelta({ ahora: D(2026, 11, 8, 15, 1) });
    ok(b0.enviados === 0, 'la 2.ª ronda apagada no sale a las 15:00');
    await q(`UPDATE recordatorio_reglas SET activo = 1 WHERE id = ?`, [r2]);
    const b1 = await R.vuelta({ ahora: D(2026, 11, 8, 15, 2) });
    ok(b1.enviados === 1 && enviados[2].ficha === V1, 'activada, la 2.ª ronda le llega a V1 (sigue sin votar) y NO a V6 (votó a las 14:30)', enviados.map((e) => e.ficha));
    ok((await envios()).filter((e) => e.destinatario_id === V1).length === 2, 'V1 tiene un envío por regla: dos en total, ninguno repetido');
    // Otro día que no es la elección: nada.
    await configurar({ fecha_eleccion: '2026-11-09' });
    const c0 = await R.vuelta({ ahora: D(2026, 11, 8, 14, 30) });
    ok(c0.candidatos === 0, 'si hoy no es la fecha de elección, no sale nada');
    await configurar({ fecha_eleccion: '2026-11-08' });
    // Cerrada la jornada: lo que quedó esperando se descarta con motivo y no sale más.
    await q(`INSERT INTO recordatorio_envios (regla_id, destinatario_tipo, destinatario_id, ocurrencia, canal, estado, debe_salir_en, proximo_intento, motivo) VALUES (?, 'votante', ?, 'dia:2026-11-08', 'sms', 'diferido', '2026-11-08 14:00:00', '2026-11-09 08:00:00', 'Tope diario')`, [r1, V3]);
    const d0 = await R.vuelta({ ahora: D(2026, 11, 8, 16, 5) });
    const dif = (await envios()).find((e) => e.destinatario_id === V3);
    ok(d0.candidatos === 0 && dif.estado === 'omitido' && /Se cerró la jornada/.test(dif.motivo), 'pasado el cierre de la jornada no sale nada y lo pendiente se descarta con motivo', dif);
    // Si el enlace «Ya voté» no se puede armar, no sale un mensaje con el enlace en blanco.
    await limpiar();
    await configurar({ recordatorios_activos: 1 });
    const r3 = await regla({ tipo: 'dia_d_ya_votaste', plantilla: PL, gracia: 60 }); await q(`UPDATE recordatorio_reglas SET hora_dia = '14:00:00' WHERE id = ?`, [r3]);
    const W = await votante();
    R.deps.enlaceYaVoto = async () => { throw new Error('No se pudo armar el enlace «Ya voté»: falta el dominio de la licencia.'); };
    await R.vuelta({ ahora: D(2026, 11, 8, 14, 1) });
    const fw = (await envios())[0];
    ok(fw.estado === 'omitido' && /enlace/.test(fw.motivo) && enviados.length === 0, 'sin enlace «Ya voté» no se manda: queda «omitido» con el motivo', fw);
    R.deps.enlaceYaVoto = async (id) => `https://campana.prueba/v/TOK${id}`;
  }

  console.log('\n[21] Fase 3 · activar el «¿ya votaste?» exige que la fecha permitida ya haya llegado');
  {
    await limpiar();
    const PL = '{nombre}, ¿ya votaste? Si ya lo hiciste, avísanos aquí: {enlace_ya_vote}';
    const id = await R.guardarRegla({ tipo: 'dia_d_ya_votaste', canal: 'sms', nombre: 'Ronda de prueba', plantilla: PL, hora_dia: '14:00', gracia_min: 60 });
    ok(Number((await reglasDe(id)).activo) === 0, 'se puede GUARDAR apagada antes de la fecha permitida (nace apagada)');
    const intenta = async () => { try { await R.activarRegla(id, true, { ahora: D(2026, 11, 8, 9, 0) }); return null; } catch (e) { return e; } };
    await configurar({ fecha_permitida_propaganda: null });
    let e1 = await intenta();
    ok(e1 && /fecha permitida/.test(e1.message), 'con la fecha permitida VACÍA no se puede activar', e1 && e1.message);
    await configurar({ fecha_permitida_propaganda: '2026-11-20' });
    e1 = await intenta();
    ok(e1 && /todavía no llega|fecha permitida/.test(e1.message), 'con la fecha permitida FUTURA no se puede activar', e1 && e1.message);
    await configurar({ fecha_permitida_propaganda: '2026-11-08' });
    e1 = await intenta();
    ok(e1 === null && Number((await reglasDe(id)).activo) === 1, 'con la fecha permitida de hoy, sí');
    const { reglasApagadas } = await R.guardarConfig({ fecha_permitida_propaganda: '' }, { ahora: D(2026, 11, 8, 9, 0) });
    ok(reglasApagadas === 1 && Number((await reglasDe(id)).activo) === 0, 'vaciar la fecha permitida APAGA las reglas que la exigen', reglasApagadas);
    ok((await R.activarRegla(id, false)).activo === 0, 'apagar siempre se puede');
    // Una de evento (no exige la fecha) se activa sin ella, siempre que su plantilla no hable de voto.
    const ide = await R.guardarRegla({ tipo: 'evento', canal: 'sms', nombre: 'E', plantilla: PLANTILLA_EVENTO, desfase_min: -120 });
    ok((await R.activarRegla(ide, true)).activo === 1, 'una regla de evento con plantilla neutra se activa sin fecha permitida');
    await q(`UPDATE recordatorio_reglas SET plantilla = 'Recuerda votar, {nombre}' WHERE id = ?`, [ide]);
    await R.activarRegla(ide, false);
    let e2 = null; try { await R.activarRegla(ide, true, { ahora: D(2026, 11, 8, 9, 0) }); } catch (e) { e2 = e; }
    ok(e2 && /Antes de la fecha permitida/.test(e2.message), 'y no se activa si su plantilla habla de voto antes de la fecha');
    // Programación: «cuánto antes» y la hora se validan.
    const malo = async (d) => { try { await R.guardarRegla(d); return null; } catch (e) { return e; } };
    ok(await malo({ tipo: 'evento', canal: 'sms', plantilla: PLANTILLA_EVENTO, desfase_min: 30 }), 'un evento con «cuánto antes» positivo se rechaza');
    ok(await malo({ tipo: 'dia_d_ya_votaste', canal: 'sms', plantilla: PL, hora_dia: '25:00' }), 'una hora imposible se rechaza');
  }

  console.log('\n[22] Fase 3 · una lista grande se reparte entre vueltas');
  {
    await limpiar();
    await q('DELETE FROM votantes');
    await configurar({ recordatorios_activos: 1, fecha_permitida_propaganda: '2020-01-01', tope_diario_sms_automaticos: 1000, fecha_eleccion: '2026-11-08' });
    const r = await regla({ tipo: 'dia_d_ya_votaste', plantilla: '{nombre}, ¿ya votaste? {enlace_ya_vote}', gracia: 60 }); await q(`UPDATE recordatorio_reglas SET hora_dia = '14:00:00' WHERE id = ?`, [r]);
    for (let i = 0; i < 130; i++) await votante({ nombre: `Masivo ${i}` });
    const a = await R.vuelta({ ahora: D(2026, 11, 8, 14, 0) });
    ok(a.enviados === R.MAX_POR_VUELTA && a.restantes >= 30, `la primera vuelta manda ${R.MAX_POR_VUELTA} y deja el resto para la siguiente`, a);
    const b = await R.vuelta({ ahora: D(2026, 11, 8, 14, 1) });
    ok(b.enviados >= 30 && enviados.length >= 130, 'la siguiente vuelta sigue donde quedó', b);
    const c = await R.vuelta({ ahora: D(2026, 11, 8, 14, 2) });
    ok(c.enviados === 0 && new Set(enviados.map((e) => e.ficha)).size === enviados.length, 'y nadie recibió dos veces');
  }

  console.log('\n[23] Fase 4 · la pantalla: permisos, configuración, reglas, validador, prueba, historial y auditoría');
  {
    await limpiar();
    await configurar({ recordatorios_activos: 0, fecha_permitida_propaganda: null, tope_diario_sms_automaticos: 200 });
    // Se vuelven a sembrar las reglas de fábrica con la misma consulta de init-db (borradas por las pruebas de arriba).
    const corridaR = spawnSync(process.execPath, ['db/init-db.js'], { cwd: raiz, env: process.env, encoding: 'utf8' });
    for (const f of fs.readdirSync(raiz)) if (/^\.credenciales-.*\.txt$/.test(f)) fs.unlinkSync(path.join(raiz, f));
    ok(corridaR.status === 0 && (await q(`SELECT COUNT(*) n FROM recordatorio_reglas`))[0].n === 7, 'init-db vuelve a sembrar las 7 reglas de fábrica (apagadas)');
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { const u = req.headers['x-test-user']; req.session = { usuario: u ? JSON.parse(u) : undefined }; req.sublicencia = null; next(); });
    app.use('/api/recordatorios', require('../routes/recordatorios.routes'));
    const servidor = http.createServer(app);
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${servidor.address().port}`;
    async function pedir(metodo, ruta, { json, usuario } = {}) {
      const h = { 'X-Forwarded-For': '198.51.100.8', 'User-Agent': 'prueba/1.0' };
      if (json !== undefined) h['Content-Type'] = 'application/json';
      if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
      const r = await fetch(base + '/api/recordatorios' + ruta, { method: metodo, headers: h, body: json !== undefined ? JSON.stringify(json) : undefined });
      const texto = await r.text(); let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
      return { status: r.status, datos };
    }
    const admin = { id: 1, rol: 'admin', nombre: 'Admin Ejemplo' };
    const uCoord = await usuario({ nombre: 'Coordinadora' }), uLider = await usuario({ nombre: 'Lider' });
    const coord = { id: uCoord, rol: 'coordinador', nombre: 'Coordinadora' }, lider = { id: uLider, rol: 'lider', nombre: 'Lider' };

    // ---- permisos
    ok((await pedir('GET', '/estado')).status === 401, 'sin sesión: 401');
    ok((await pedir('GET', '/estado', { usuario: lider })).status === 403, 'un líder (sin el módulo): 403');
    ok((await pedir('GET', '/estado', { usuario: coord })).status === 403, 'un coordinador sin el módulo (de fábrica solo el administrador): 403');
    ok((await pedir('GET', '/estado', { usuario: admin })).status === 200, 'el administrador: 200');
    await q(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES ('coordinador', 'recordatorios', 1, 0, 0) ON DUPLICATE KEY UPDATE permitido = 1, editar = 0, agregar = 0`);
    ok((await pedir('GET', '/reglas', { usuario: coord })).status === 200, 'con «Ver» el coordinador ve las reglas');
    const sinEditar = await pedir('PUT', '/config', { usuario: coord, json: { recordatorios_activos: 1 } });
    ok(sinEditar.status === 403 && /no cambiarlos/.test(sinEditar.datos.error), 'con «Ver» pero sin «Editar» no puede cambiar nada (403)');
    ok((await pedir('POST', '/reglas/1/activar', { usuario: coord, json: { activo: true } })).status === 403 && (await pedir('POST', '/reglas/1/probar', { usuario: coord })).status === 403, 'ni activar reglas ni pedir pruebas');
    await q(`UPDATE permisos_rol SET editar = 1 WHERE rol = 'coordinador' AND modulo = 'recordatorios'`);
    ok((await pedir('PUT', '/config', { usuario: coord, json: { tope_diario_sms_automaticos: 150 } })).status === 200, 'con «Editar» sí puede');
    await q(`DELETE FROM permisos_rol WHERE rol = 'coordinador' AND modulo = 'recordatorios'`);

    // ---- estado: libro central y tope
    central = { asignados: 1000, consumidos: 400, disponibles: 600, limiteDiario: 120, consumidoHoy: 30, disponibleHoy: 90 };
    const est = (await pedir('GET', '/estado', { usuario: admin })).datos;
    ok(est.libroCentral && est.libroCentral.limiteDiario === 120 && est.libroCentral.disponibles === 600 && est.topeEfectivo === 120, 'el estado muestra el saldo y el límite del libro central, y el tope efectivo (el menor)', est.libroCentral);
    ok(est.config.recordatorios_activos === 0 && est.config.silencio_inicio === '20:00' && est.config.silencio_fin === '08:00' && Array.isArray(est.tipos) && est.tipos.some((t) => t.clave === 'evento'), 'y la configuración de fábrica y los tipos');
    central = null;

    // ---- configuración
    const auditoria = (accion) => q(`SELECT * FROM auditoria WHERE accion = ? ORDER BY id DESC`, [accion]);
    central = { limiteDiario: 50, disponibleHoy: 50, disponibles: 500 };
    const tope = await pedir('PUT', '/config', { usuario: admin, json: { tope_diario_sms_automaticos: 500 } });
    ok(tope.status === 400 && /libro central \(50\)/.test(tope.datos.error), 'el tope no puede pasar del límite del libro central (400)', tope.datos);
    central = null;
    ok((await pedir('PUT', '/config', { usuario: admin, json: { silencio_inicio: '9:00' } })).status === 400, 'una hora de silencio inválida se rechaza');
    ok((await pedir('PUT', '/config', { usuario: admin, json: { fecha_permitida_propaganda: '2026-13-45' } })).status === 400, 'una fecha inválida se rechaza');
    const antesAud = (await auditoria('recordatorios_configuracion')).length;
    const cfgOk = await pedir('PUT', '/config', { usuario: admin, json: { recordatorios_activos: 1, tope_diario_sms_automaticos: 80, silencio_inicio: '21:00', silencio_fin: '07:30', fecha_permitida_propaganda: '2026-11-01' } });
    ok(cfgOk.status === 200 && cfgOk.datos.estado.config.tope_diario_sms_automaticos === 80 && cfgOk.datos.estado.config.silencio_inicio === '21:00' && cfgOk.datos.estado.config.recordatorios_activos === 1, 'la configuración válida se guarda', cfgOk.datos);
    const aud = await auditoria('recordatorios_configuracion');
    ok(aud.length === antesAud + 1 && /tope_diario_sms_automaticos: «150» → «80»/.test(aud[0].detalle) && /silencio_inicio: «20:00» → «21:00»/.test(aud[0].detalle) && aud[0].usuario_id === 1, 'el cambio de configuración queda en auditoría, con lo de antes y lo de después', aud[0] && aud[0].detalle);
    const igual = await pedir('PUT', '/config', { usuario: admin, json: { tope_diario_sms_automaticos: 80 } });
    ok(igual.status === 200 && (await auditoria('recordatorios_configuracion')).length === antesAud + 1, 'guardar lo mismo no ensucia la auditoría');

    // ---- reglas
    const lista = (await pedir('GET', '/reglas', { usuario: admin })).datos.reglas;
    ok(lista.length === 7 && lista.every((r) => r.activo === 0), 'la lista trae las 7 reglas, apagadas');
    const rEv = lista.find((r) => r.tipo === 'evento' && r.canal === 'sms' && r.desfase_min === -1440), rYv = lista.find((r) => r.tipo === 'dia_d_ya_votaste' && r.hora_dia.startsWith('14'));
    const mala = await pedir('PUT', `/reglas/${rEv.id}`, { usuario: admin, json: { plantilla: 'Te esperamos para votar, {nombre}' } });
    ok(mala.status === 400 && /Antes de la fecha permitida|votar/.test(mala.datos.error) === false || mala.status === 200, 'con fecha permitida ya llegada, una plantilla con «votar» sí se acepta (se verifica abajo con la fecha vacía)');
    await pedir('PUT', '/config', { usuario: admin, json: { fecha_permitida_propaganda: '' } });
    const mala2 = await pedir('PUT', `/reglas/${rEv.id}`, { usuario: admin, json: { plantilla: 'Te esperamos para votar, {nombre}' } });
    ok(mala2.status === 400 && /Antes de la fecha permitida/.test(mala2.datos.error), 'con la fecha permitida vacía, la plantilla de un evento no puede hablar de voto (400)');
    const variable = await pedir('PUT', `/reglas/${rEv.id}`, { usuario: admin, json: { plantilla: 'Hola {nombre} {secreto}' } });
    ok(variable.status === 400 && /secreto/.test(variable.datos.error), 'ni usar una variable que no existe');
    const antesR = (await auditoria('recordatorios_regla_editar')).length;
    const edit = await pedir('PUT', `/reglas/${rEv.id}`, { usuario: admin, json: { plantilla: '{nombre}, te esperamos en {evento} el {fecha} a las {hora}.', desfase_min: -300 } });
    const aud2 = await auditoria('recordatorios_regla_editar');
    ok(edit.status === 200 && edit.datos.regla.desfase_min === -300 && aud2.length === antesR + 1 && /plantilla/.test(aud2[0].detalle) && /desfase_min: «-1440» → «-300»/.test(aud2[0].detalle), 'editar una regla la guarda y deja su apunte (qué campo cambió)', aud2[0] && aud2[0].detalle);
    const act = await pedir('POST', `/reglas/${rYv.id}/activar`, { usuario: admin, json: { activo: true } });
    ok(act.status === 400 && /fecha permitida/.test(act.datos.error), 'el «¿ya votaste?» no se activa sin fecha permitida (400)');
    await pedir('PUT', '/config', { usuario: admin, json: { fecha_permitida_propaganda: '2026-11-01' } });
    const antesA = (await auditoria('recordatorios_regla_activar')).length;
    const act2 = await pedir('POST', `/reglas/${rYv.id}/activar`, { usuario: admin, json: { activo: true } });
    ok(act2.status === 200 && act2.datos.activo === 1 && (await auditoria('recordatorios_regla_activar')).length === antesA + 1, 'con la fecha permitida llegada se activa y queda en auditoría');
    const repite = await pedir('POST', `/reglas/${rYv.id}/activar`, { usuario: admin, json: { activo: true } });
    ok(repite.status === 200 && (await auditoria('recordatorios_regla_activar')).length === antesA + 1, 'activar lo ya activo no repite el apunte');
    const apaga = await pedir('PUT', '/config', { usuario: admin, json: { fecha_permitida_propaganda: '' } });
    ok(apaga.datos.reglasApagadas === 1 && /Se apagaron 1 regla/.test((await auditoria('recordatorios_configuracion'))[0].detalle), 'vaciar la fecha permitida apaga esa regla y lo dice en la auditoría');

    // ---- validador en vivo
    const v1 = (await pedir('POST', '/validar', { usuario: admin, json: { tipo: 'evento', canal: 'sms', plantilla: '{nombre}, te esperamos en {evento} el {fecha} a las {hora} en {lugar}.' } })).datos;
    ok(v1.ok && v1.segmentos === 1 && v1.caracteres > 60 && v1.caracteres <= 160, 'el validador en vivo da el visto bueno y cuenta los segmentos y caracteres de la plantilla de fábrica', v1);
    const v2 = (await pedir('POST', '/validar', { usuario: admin, json: { tipo: 'evento', canal: 'sms', plantilla: 'x'.repeat(170) } })).datos;
    ok(!v2.ok && v2.segmentos === 2 && /pasa de un SMS/.test(v2.errores.join(' ')), 'una plantilla larga: 2 segmentos y el error', v2);
    const v3 = (await pedir('POST', '/validar', { usuario: admin, json: { tipo: 'evento', canal: 'sms', plantilla: 'Vota por {candidato}' } })).datos;
    ok(!v3.ok && /Antes de la fecha permitida/.test(v3.errores[0]) && v3.propagandaPermitida === false, 'y avisa de la precampaña mientras se escribe', v3);
    const v4 = (await pedir('POST', '/validar', { usuario: admin, json: { tipo: 'dia_d_ya_votaste', canal: 'sms', plantilla: '{nombre}, ¿ya votaste? {enlace_ya_vote}' } })).datos;
    ok(v4.ok && v4.avisos.length === 1, 'el «¿ya votaste?» (apagado) pasa con un aviso en vez de un error', v4);

    // ---- «Enviarme una prueba»
    await q(`UPDATE usuarios SET telefono = '3001234567', email = 'admin@ejemplo.co' WHERE id = 1`);
    const antesEnv = enviados.length, antesTope = (await q(`SELECT COALESCE(SUM(segmentos_usados),0) n FROM recordatorio_tope_diario`))[0].n, antesFilas = (await envios()).length;
    const prueba = await pedir('POST', `/reglas/${rEv.id}/probar`, { usuario: admin });
    const ultimo = enviados[enviados.length - 1];
    ok(prueba.status === 200 && enviados.length === antesEnv + 1 && ultimo.prueba === true && ultimo.ficha === 1 && ultimo.telefono === '3001234567', 'la prueba sale al teléfono del propio administrador', prueba.datos);
    ok(prueba.datos.destino === '*** 4567' && /Reunion de ejemplo/.test(prueba.datos.texto), 'responde a dónde fue (enmascarado) y qué texto salió', prueba.datos);
    ok(Number((await q(`SELECT COALESCE(SUM(segmentos_usados),0) n FROM recordatorio_tope_diario`))[0].n) === Number(antesTope) && (await envios()).length === antesFilas, 'la prueba NO cuenta en el tope diario ni deja una fila en el historial');
    ok((await auditoria('recordatorios_prueba')).length === 1, 'pero sí queda en auditoría');
    await q(`UPDATE usuarios SET telefono = NULL WHERE id = 1`);
    const sinTel = await pedir('POST', `/reglas/${rEv.id}/probar`, { usuario: admin });
    ok(sinTel.status === 400 && /no tiene teléfono/.test(sinTel.datos.error), 'sin teléfono en su usuario la prueba por SMS se explica (400)');
    const rPush = lista.find((r) => r.canal === 'push');
    const pp = await pedir('POST', `/reglas/${rPush.id}/probar`, { usuario: admin });
    ok(pp.status === 200 && enviados[enviados.length - 1].canal === 'push', 'la prueba de un aviso en la app va a la cuenta de quien la pide');
    falloEnvio = () => { const e = new Error('Fuera del horario permitido para mensajería de campaña (8:00 a 20:00, hora de Colombia).'); e.codigo = 'FUERA_DE_FRANJA'; return e; };
    await q(`UPDATE usuarios SET telefono = '3001234567' WHERE id = 1`);
    const franja = await pedir('POST', `/reglas/${rEv.id}/probar`, { usuario: admin });
    ok(franja.status === 502 && /Fuera del horario/.test(franja.datos.error), 'si el proveedor rechaza la prueba, se dice tal cual (502)');
    falloEnvio = null;

    // ---- historial con filtros
    await q(`INSERT INTO recordatorio_envios (regla_id, destinatario_tipo, destinatario_id, ocurrencia, canal, estado, motivo, debe_salir_en) VALUES
      (?, 'votante', 1, 'h:1', 'sms', 'omitido', 'No consta su autorización por este medio (el NULL no autoriza).', '2026-11-08 10:00:00'),
      (?, 'votante', 2, 'h:2', 'sms', 'omitido', 'Pidió no recibir más mensajes.', '2026-11-08 10:00:00'),
      (?, 'votante', 3, 'h:3', 'sms', 'enviado', NULL, '2026-11-08 10:00:00'),
      (?, 'usuario', 1, 'h:4', 'push', 'fallido', 'proveedor caído', '2026-11-08 10:00:00')`, [rEv.id, rEv.id, rEv.id, rPush.id]);
    const h = (await pedir('GET', '/envios', { usuario: admin })).datos;
    ok(h.total === 4 && h.porEstado.omitido === 2 && h.porEstado.enviado === 1 && h.porEstado.fallido === 1 && h.filas[0].regla, 'el historial trae las filas, los totales por estado y el nombre de la regla', h.porEstado);
    ok(h.motivosDeOmision.length === 2 && h.motivosDeOmision.some((m) => /NULL/.test(m.motivo)), 'y la lista de motivos de omisión para filtrar', h.motivosDeOmision);
    ok((await pedir('GET', '/envios?estado=omitido', { usuario: admin })).datos.total === 2, 'filtro por estado');
    ok((await pedir('GET', '/envios?motivo=NULL', { usuario: admin })).datos.total === 1 && (await pedir('GET', '/envios?motivo=no%20recibir', { usuario: admin })).datos.total === 1, 'filtro por motivo de omisión');
    ok((await pedir('GET', `/envios?regla=${rPush.id}`, { usuario: admin })).datos.total === 1, 'filtro por regla');
    ok((await pedir('GET', '/envios', { usuario: lider })).status === 403, 'el historial tampoco se ve sin el módulo');
    servidor.close();
  }

  await limpiar();
  console.log(fallos ? `\n${fallos} comprobación(es) FALLARON.` : '\nTODO BIEN');
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
