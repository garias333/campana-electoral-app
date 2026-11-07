/**
 * Lo que pasa cuando alguien se inscribe por el enlace de un líder.
 *
 * QUIÉN LLAMA: routes/inscripcion.routes.js (la página pública /i/:codigo). Este
 * módulo no sabe de HTTP: recibe datos ya validados y devuelve qué ocurrió.
 *
 * LA PÁGINA NUNCA DICE QUÉ OCURRIÓ. Que la cédula ya existiera, y de quién, es un
 * dato de otra persona: si la respuesta cambiara, el formulario serviría para
 * averiguar quién está en la base de la campaña. Lo que pasó queda en
 * `inscripcion_intentos` para el coordinador, nunca en la respuesta.
 *
 * LOS CUATRO CASOS
 *   a) cédula nueva  → se crea con el líder/sublíder del dueño del enlace
 *      (atribucionDe), su rama (ramaDeVotante) y origen 'enlace_lider'. Queda
 *      PENDIENTE DE CONFIRMAR: sin `consentimiento_confirmado_en`.
 *   b) la misma persona ya era de este líder → no se toca nada, salvo completar
 *      el consentimiento si faltaba.
 *   c) ya era de OTRO líder → NO cambia de dueño. Solo se completa el
 *      consentimiento si estaba vacío, y el intento queda anotado (`otro_lider`).
 *   d) el dueño del enlace cuelga de un aspirante y la ficha no está en su rama →
 *      se suma a `votante_ramas` (la persona sigue siendo una sola).
 *
 * UNA SALVEDAD QUE LA ORDEN NO PEDÍA Y ES DE SEGURIDAD: en b, c y d solo se
 * MODIFICA una ficha existente (completar el consentimiento, sumarla a una rama)
 * si el celular que se escribió COINCIDE con el que la ficha ya tenía. La cédula
 * no es secreta; sin esta condición, cualquiera que supiera la de otra persona
 * podría "completarle" una autorización que nunca dio, o regalarle su ficha a la
 * rama de un aspirante rival. Si no coincide, el intento se anota y no pasa nada.
 *
 * EL SMS DE CONFIRMACIÓN: UNO por persona en la vida (`uq_insc_sms_votante`), con
 * el enlace de /c. Se crea el token AL ENVIAR, no al encolar: de /c solo se
 * guarda el hash, y la cola no debe guardar un token que sirve para confirmar.
 */
'use strict';

const crypto = require('crypto');
const pool = require('./db');
const { ramaDeVotante, aspiranteDe } = require('../lib/ramas');
const { versionConocida } = require('./politicaVersiones');
const { crearConfirmacion } = require('./confirmacionConsentimiento');
const { atribucionDe } = require('./inscripcionEnlace');

const sha256 = (t) => crypto.createHash('sha256').update(String(t), 'utf8').digest('hex');
const ultimos10 = (t) => String(t || '').replace(/\D/g, '').slice(-10);

const METODO = 'enlace_lider';

/** Inscripciones que ya cuentan hoy (24 h móviles) para un enlace / un teléfono. Las rechazadas no gastan cupo. */
async function contarRecientes({ enlaceId, telefonoHash }, conexion = pool) {
  const porEnlace = enlaceId
    ? (await conexion.query(
        `SELECT COUNT(*) AS n FROM inscripcion_intentos
          WHERE enlace_id = ? AND resultado <> 'rechazado' AND creado_en > NOW() - INTERVAL 24 HOUR`, [enlaceId]))[0][0].n
    : 0;
  const porTelefono = telefonoHash
    ? (await conexion.query(
        `SELECT COUNT(*) AS n FROM inscripcion_intentos
          WHERE telefono_hash = ? AND resultado <> 'rechazado' AND creado_en > NOW() - INTERVAL 24 HOUR`, [telefonoHash]))[0][0].n
    : 0;
  return { porEnlace, porTelefono };
}

/** Anota un rechazo antiabuso (honeypot, muy rápido, tope por teléfono). Nunca lanza. */
async function anotarRechazo({ enlaceId, motivo, telefonoHash = null, ip, navegador }) {
  try {
    await pool.query(
      `INSERT INTO inscripcion_intentos (enlace_id, resultado, motivo, telefono_hash, ip, navegador)
       VALUES (?, 'rechazado', ?, ?, ?, ?)`,
      [enlaceId, motivo, telefonoHash, (ip || '').slice(0, 45), (navegador || '').slice(0, 255)]);
  } catch (err) {
    console.error('No se pudo anotar el rechazo de inscripción:', err.code || err.message);
  }
}

/**
 * @param {object} p
 * @param {object} p.enlace   fila de buscarEnlaceActivo
 * @param {object} p.datos    { nombre, cedula, telefono (10 dígitos), email|null, puesto|null, mesa|null,
 *                              canales: { sms, whatsapp, email } }
 * @param {string|null} p.huellaPolitica  la versión de la política que se MOSTRÓ
 * @returns {Promise<{resultado, votanteId, otroLider, quiereSms, smsEncolado}>}
 */
async function inscribir({ enlace, datos, ip, navegador, huellaPolitica }) {
  const cx = await pool.getConnection();
  const cedulaHash = sha256(datos.cedula);
  const telefonoHash = sha256(ultimos10(datos.telefono));
  const ipRec = (ip || '').slice(0, 45);
  const navRec = (navegador || '').slice(0, 255);
  const canales = datos.canales || {};
  const versionOk = (await versionConocida(huellaPolitica)) ? 1 : 0;
  let salida;
  try {
    await cx.beginTransaction();
    const atrib = await atribucionDe(enlace, cx);
    const miRama = await aspiranteDe(cx, enlace.usuario_id);

    const campos = {
      autorizado: 1,
      metodo: METODO,
      email: canales.email ? 1 : 0,
      sms: canales.sms ? 1 : 0,
      whatsapp: canales.whatsapp ? 1 : 0,
    };

    let votanteId = null;
    let resultado = 'nuevo';
    let otroLider = 0;
    let existente = null;

    // ¿Ya existe? El INSERT decide (la cédula es UNIQUE): no hay carrera entre dos envíos a la vez.
    try {
      const rama = await ramaDeVotante(cx, { cedula: datos.cedula, lider_id: atrib.lider_id, sublider_id: atrib.sublider_id });
      const [ins] = await cx.query(
        `INSERT INTO votantes
           (categoria, nombre, cedula, telefono, email, lider_id, sublider_id, apoya_a,
            departamento_votacion, municipio_votacion, puesto_votacion, ctc_puesto_id, mesa_votacion,
            consentimiento_autorizado, consentimiento_fecha, consentimiento_metodo,
            consentimiento_email, consentimiento_sms, consentimiento_whatsapp,
            consentimiento_version, consentimiento_version_ok,
            origen, created_by, rama_aspirante_id)
         VALUES ('votante', ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, 1, NOW(), ?, ?, ?, ?, ?, ?, 'enlace_lider', NULL, ?)`,
        [datos.nombre, datos.cedula, datos.telefono, datos.email || null, atrib.lider_id, atrib.sublider_id,
         datos.puesto ? datos.puesto.departamento || null : null,
         datos.puesto ? datos.puesto.municipio || null : null,
         datos.puesto ? datos.puesto.nombre : null,
         datos.puesto ? datos.puesto.ctc_puesto_id || null : null,
         datos.puesto && datos.mesa ? datos.mesa : null,
         METODO, campos.email, campos.sms, campos.whatsapp,
         huellaPolitica || null, versionOk, rama]);
      votanteId = ins.insertId;
      await cx.query(
        `INSERT INTO votante_consentimiento_evidencia (votante_id, metodo, ip, navegador, enlace_id, politica_version)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [votanteId, METODO, ipRec, navRec, enlace.enlace_id, huellaPolitica || null]);
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      [[existente]] = await cx.query(
        `SELECT id, lider_id, sublider_id, telefono, consentimiento_autorizado, rama_aspirante_id
           FROM votantes WHERE cedula = ? FOR UPDATE`, [datos.cedula]);
      if (!existente) throw err;   // choque por otra causa: que suba
    }

    let consentimientoCompletado = false;
    if (existente) {
      votanteId = existente.id;
      const mismoLider = existente.lider_id === atrib.lider_id
        || existente.lider_id === enlace.usuario_id || existente.sublider_id === enlace.usuario_id;
      otroLider = mismoLider ? 0 : 1;
      resultado = mismoLider ? 'mismo_lider' : 'otro_lider';

      // Solo quien aporta el celular que la ficha ya tenía puede modificarla (ver encabezado).
      const acreditado = ultimos10(existente.telefono) !== '' && ultimos10(existente.telefono) === ultimos10(datos.telefono);
      if (acreditado) {
        if (!existente.consentimiento_autorizado) {
          await cx.query(
            `UPDATE votantes
                SET consentimiento_autorizado = 1, consentimiento_fecha = NOW(), consentimiento_metodo = ?,
                    consentimiento_email = ?, consentimiento_sms = ?, consentimiento_whatsapp = ?,
                    consentimiento_version = ?, consentimiento_version_ok = ?
              WHERE id = ? AND consentimiento_autorizado = 0`,
            [METODO, campos.email, campos.sms, campos.whatsapp, huellaPolitica || null, versionOk, existente.id]);
          await cx.query(
            `INSERT IGNORE INTO votante_consentimiento_evidencia (votante_id, metodo, ip, navegador, enlace_id, politica_version)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [existente.id, METODO, ipRec, navRec, enlace.enlace_id, huellaPolitica || null]);
          consentimientoCompletado = true;
          if (!otroLider) resultado = 'consentimiento_completado';
        }
        if (miRama && existente.rama_aspirante_id !== miRama) {
          const [r] = await cx.query(
            `INSERT IGNORE INTO votante_ramas (votante_id, aspirante_id, registrado_por) VALUES (?, ?, ?)`,
            [existente.id, miRama, enlace.usuario_id]);
          if (r.affectedRows > 0) resultado = 'rama_sumada';
        }
      }
    }

    await cx.query(
      `INSERT INTO inscripcion_intentos
         (enlace_id, resultado, votante_id, cedula_hash, telefono_hash, otro_lider, ip, navegador)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [enlace.enlace_id, resultado, votanteId, cedulaHash, telefonoHash, otroLider, ipRec, navRec]);
    await cx.commit();

    const nuevo = resultado === 'nuevo';
    salida = { resultado, votanteId, otroLider: !!otroLider, nuevo, consentimientoCompletado };
  } catch (err) {
    try { await cx.rollback(); } catch (_) { /* conexión ya cerrada */ }
    throw err;
  } finally {
    cx.release();
  }

  // El SMS va DESPUÉS de confirmar la transacción, y su fallo no deshace la inscripción.
  salida.smsEncolado = false;
  if (canales.sms && (salida.nuevo || salida.consentimientoCompletado)) {
    try { salida.smsEncolado = await encolarSmsDeConfirmacion(salida.votanteId); }
    catch (err) { console.error('Inscripción: no se pudo encolar el SMS de confirmación:', err.code || err.message); }
  }
  return salida;
}

// ---------------------------------------------------------------------------
// El SMS de confirmación (un solo envío, respetando la franja de mensajería)
// ---------------------------------------------------------------------------

/** Encola el SMS. Devuelve true si quedó encolado ahora (false si ya estaba: es uno por persona). */
async function encolarSmsDeConfirmacion(votanteId) {
  const smsSvc = require('./sms');
  const { minutosHastaLaFranja } = require('./bienvenidaAutomatica');
  let minutos = 0;
  try { minutos = minutosHastaLaFranja(await smsSvc.configCampana()); } catch (_) { /* sin config: se intenta ya */ }
  const [r] = await pool.query(
    // DATE_ADD(NOW(), …) y no una hora escrita a mano: correcto en los tres husos a la vez
    // (la razón está en config/bienvenidaAutomatica.js).
    `INSERT IGNORE INTO inscripcion_sms_cola (votante_id, enviar_desde)
     VALUES (?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`, [votanteId, minutos]);
  if (r.affectedRows > 0 && minutos === 0) {
    // Dentro de la franja: sale ya, sin esperar al reloj de 60 s. Sin await: la persona no espera.
    setImmediate(() => procesarCola().catch(e => console.error('Cola SMS de inscripción:', e.message)));
  }
  return r.affectedRows > 0;
}

let procesando = false;

/** Despacha los SMS cuya hora llegó. Se llama cada 60 s (app.js) y al encolar. */
async function procesarCola() {
  if (procesando) return { enviados: 0 };
  procesando = true;
  let enviados = 0;
  try {
    const smsSvc = require('./sms');
    const { minutosHastaLaFranja } = require('./bienvenidaAutomatica');
    const [filas] = await pool.query(
      `SELECT c.id, c.votante_id, v.telefono, v.consentimiento_sms, v.consentimiento_confirmado_en
         FROM inscripcion_sms_cola c JOIN votantes v ON v.id = c.votante_id
        WHERE c.estado = 'pendiente' AND c.enviar_desde <= NOW()
        ORDER BY c.id LIMIT 25`);
    for (const f of filas) {
      // Se reclama la fila ANTES de enviar: si el proceso muere a media faena queda como
      // 'fallido/procesando' y no se manda dos veces. Un SMS de menos se ve; uno repetido, el cliente.
      const [claim] = await pool.query(
        `UPDATE inscripcion_sms_cola SET estado = 'fallido', detalle = 'procesando'
          WHERE id = ? AND estado = 'pendiente'`, [f.id]);
      if (!claim.affectedRows) continue;
      const cerrar = (estado, detalle) => pool.query(
        `UPDATE inscripcion_sms_cola SET estado = ?, detalle = ?, enviado_en = IF(? = 'enviado', NOW(), NULL) WHERE id = ?`,
        [estado, String(detalle || '').slice(0, 200), estado, f.id]);
      try {
        if (Number(f.consentimiento_sms) !== 1) { await cerrar('omitido', 'no autorizó el SMS'); continue; }
        if (f.consentimiento_confirmado_en) { await cerrar('omitido', 'ya estaba confirmado'); continue; }
        if (ultimos10(f.telefono).length !== 10) { await cerrar('omitido', 'sin celular válido'); continue; }
        if (!process.env.LICENCIA_DOMINIO) { await cerrar('fallido', 'falta LICENCIA_DOMINIO: no se puede armar el enlace'); continue; }
        const { enlace } = await crearConfirmacion({
          req: { protocol: 'https', get: () => '' }, votanteId: f.votante_id, canal: 'sms', destino: f.telefono });
        await smsSvc.enviarSMS(f.telefono, `Confirma tu inscripcion y la autorizacion de tus datos: ${enlace}`);
        await cerrar('enviado', 'ok');
        enviados++;
      } catch (err) {
        if (err.codigo === 'FUERA_DE_FRANJA') {
          // Se cerró la franja entre que se programó y ahora: vuelve a la cola para la apertura.
          let min = 60;
          try { min = minutosHastaLaFranja(await smsSvc.configCampana()) || 60; } catch (_) { /* 60 min */ }
          await pool.query(
            `UPDATE inscripcion_sms_cola SET estado = 'pendiente', detalle = 'fuera de franja',
                    enviar_desde = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?`, [min, f.id]);
        } else if (err.codigo === 'DADO_DE_BAJA') {
          await cerrar('omitido', 'pidió no recibir mensajes');
        } else {
          await cerrar('fallido', err.message || 'error al enviar');
        }
      }
    }
  } finally {
    procesando = false;
  }
  return { enviados };
}

function iniciarCola() {
  return setInterval(() => procesarCola().catch(e => console.error('Cola SMS de inscripción:', e.message)), 60 * 1000).unref();
}

module.exports = {
  inscribir, contarRecientes, anotarRechazo, procesarCola, iniciarCola, encolarSmsDeConfirmacion,
  sha256, ultimos10, METODO,
};
