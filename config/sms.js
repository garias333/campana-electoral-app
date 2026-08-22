/**
 * config/sms.js — El canal SMS de la aplicación.
 *
 * Es la costura entre dos mundos que a propósito no se conocen:
 *
 *   lib/sms.js        transporte puro (Onurix, Twilio de respaldo). No sabe
 *                     de bases de datos ni de esta aplicación.
 *   lib/sms-cuota.js  créditos y bitácora. Genérico: recibe los pools por
 *                     parámetro.
 *   config/sms.js     ESTE archivo. Lo único que sabe de campana-app: de
 *                     dónde salen los pools, quién es esta campaña y quién
 *                     pidió no recibir mensajes.
 *
 * Reemplaza a config/twilio.js como origen de los SMS. La firma de
 * enviarSMS() es la MISMA a propósito —(telefono, mensaje, statusCallbackUrl)
 * y devuelve { sid }— para que los tres sitios que la llaman cambien una
 * línea y no su lógica.
 *
 * DOS COSAS QUE HAY QUE SABER ANTES DE DESPLEGAR ESTO:
 *
 * 1. Necesita variables nuevas en el .env, y el .env NUNCA viaja en un
 *    parche. SIN ELLAS NO FALLA: sigue enviando por Twilio, como antes, y lo
 *    avisa una vez en el registro (ver enviarSMS). Así este archivo puede
 *    llegar por parche a una campaña que aún no tiene ledger ni cuenta de
 *    Onurix sin quitarle el canal que ya funciona. Las variables son:
 *
 *      SMS_LEDGER_HOST / _PORT / _USER / _PASSWORD / _DB   (cuenta smsledger)
 *      SMS_CAMPANA_ID        quién es esta campaña en el ledger
 *      ONURIX_CLIENT / ONURIX_KEY                          (cuenta maestra)
 *      SMS_PROVIDER=onurix
 *      SMS_FALLBACK_PROVIDER=twilio                        (opcional)
 *
 *    Y después, el ciclo completo de PM2: `restart` no relee el .env.
 *
 * 2. ONURIX NO AVISA CUANDO EL MENSAJE SE ENTREGA. Twilio recibía una URL de
 *    `statusCallback` y movía el envío de 'aceptado' a 'entregado' solo. Aquí
 *    ese parámetro se acepta y SE IGNORA —está en la firma para no romper a
 *    quien lo pasa—, así que hasta que exista el webhook de estado (punto 8
 *    del pendiente) un SMS se queda en 'aceptado' para siempre. 'aceptado'
 *    significa que Onurix lo recibió, no que llegó al teléfono.
 */
'use strict';

const mysql = require('mysql2/promise');
const pool = require('./db');
const crearCanal = require('../lib/sms-cuota');
const { obtenerCredenciales } = require('./comunicacionesConfig');

// Quién es esta campaña en el ledger de licencias.
//
// Sale del .env y no del código porque la convención se decide al desplegar:
// hoy la campaña de prueba usa un código corto y mañana podría ser el dominio.
// LICENCIA_DOMINIO es el respaldo natural — es el identificador que el resto
// del sistema ya usa para saber qué instalación es ésta.
const CAMPANA_ID = process.env.SMS_CAMPANA_ID || process.env.LICENCIA_DOMINIO || null;

// ---------------------------------------------------------------------------
// Conexión al ledger (base de licencias)
// ---------------------------------------------------------------------------

let poolLedger = null;

/** Qué falta para que el canal funcione. Devuelve [] si no falta nada. */
function loQueFalta() {
  const falta = [];
  if (!CAMPANA_ID) falta.push('SMS_CAMPANA_ID');
  for (const v of ['SMS_LEDGER_HOST', 'SMS_LEDGER_USER', 'SMS_LEDGER_PASSWORD', 'SMS_LEDGER_DB']) {
    if (!process.env[v]) falta.push(v);
  }
  const proveedor = (process.env.SMS_PROVIDER || 'onurix').toLowerCase();
  if (proveedor === 'onurix' && (!process.env.ONURIX_CLIENT || !process.env.ONURIX_KEY)) {
    falta.push('ONURIX_CLIENT/ONURIX_KEY');
  }
  return falta;
}

// El aviso va una sola vez por proceso: si no, cada mensaje de una campaña de
// 300 escribiría la misma línea 300 veces y taparía lo que sí importa.
let yaAviso = false;
function avisarUnaVez(falta) {
  if (yaAviso) return;
  yaAviso = true;
  console.warn('[SMS] El canal por Onurix no está configurado (falta en el .env: '
    + falta.join(', ') + '). Los mensajes salen por Twilio, como antes.');
}

function obtenerPoolLedger() {
  if (poolLedger) return poolLedger;
  // Pool aparte y pequeño: son dos o tres consultas cortas por mensaje contra
  // OTRA base, y esta cuenta solo puede tocar tres tablas (ver
  // sql/usuario-sms-ledger.sql). No se reutiliza el pool de la campaña porque
  // no es la misma base ni el mismo usuario.
  poolLedger = mysql.createPool({
    host: process.env.SMS_LEDGER_HOST,
    port: parseInt(process.env.SMS_LEDGER_PORT || '3306', 10),
    user: process.env.SMS_LEDGER_USER,
    password: process.env.SMS_LEDGER_PASSWORD,
    database: process.env.SMS_LEDGER_DB,
    waitForConnections: true,
    connectionLimit: 3,
    dateStrings: true,
  });
  return poolLedger;
}

// ---------------------------------------------------------------------------
// Configuración por campaña (tabla sms_config)
// ---------------------------------------------------------------------------

let cfgCache = null;
let cfgCacheEn = 0;
const CFG_CACHE_MS = 60000;

/**
 * Lee sms_config. Si la tabla todavía no existe —una campaña que aún no ha
 * recibido la migración— devuelve los valores por defecto en vez de tumbar el
 * envío: el canal tiene que poder arrancar antes que su tabla de ajustes.
 *
 * De esa tabla se aplican `forzar_gsm7`, `proveedor_preferido`, la franja
 * horaria (`horario_inicio`/`horario_fin`) y `firma`, que no se escribe en el
 * mensaje —la pone el proveedor— pero sí se cuenta, porque ocupa sitio en el
 * segmento. La única que sigue sin leerse es `url_baja_base`.
 */
async function configCampana() {
  const ahora = Date.now();
  if (cfgCache && (ahora - cfgCacheEn) < CFG_CACHE_MS) return cfgCache;

  let fila = null;
  try {
    const [filas] = await pool.query('SELECT * FROM sms_config WHERE id = 1');
    fila = filas[0] || null;
  } catch (_) { /* la tabla no existe todavía: valores por defecto */ }

  // SMS_PROVIDER=none es un INTERRUPTOR DE SEGURIDAD y gana siempre, incluso
  // sobre lo que diga la base. Sin esta línea, poner 'none' en el .env para
  // hacer una prueba no apaga nada: la fila de sms_config manda y el mensaje
  // sale de verdad, a un número real y cobrando el crédito. Pasó el 12 de
  // agosto de 2026 escribiendo este archivo — un SMS a un número inventado.
  //
  // La preferencia normal es la contraria (la base sobre el .env), porque el
  // proveedor es un ajuste de la campaña. 'none' es la excepción: apagar
  // tiene que ser más fácil que encender.
  const forzadoNone = (process.env.SMS_PROVIDER || '').toLowerCase() === 'none';

  cfgCache = {
    forzarGSM7: fila ? Boolean(fila.forzar_gsm7) : true,
    // La firma que el proveedor pega a cada mensaje. NO se escribe aquí: se
    // lleva para poder CONTAR lo que ocupa en el segmento. Mientras la columna
    // esté en NULL —hoy— el conteo se comporta igual que siempre.
    firma: (fila && fila.firma) || '',
    proveedorPreferido: forzadoNone
      ? 'none'
      : ((fila && fila.proveedor_preferido) || process.env.SMS_PROVIDER || 'onurix'),
    horarioInicio: fila && fila.horario_inicio !== null ? Number(fila.horario_inicio) : 8,
    horarioFin: fila && fila.horario_fin !== null ? Number(fila.horario_fin) : 20,
  };
  cfgCacheEn = ahora;
  return cfgCache;
}

// ---------------------------------------------------------------------------
// Franja horaria permitida
// ---------------------------------------------------------------------------

/**
 * La hora en Colombia, que NO es la del servidor.
 *
 * Este servidor corre en UTC y Colombia está en UTC-5 todo el año (no hay
 * horario de verano). Sin restar esas cinco horas, un envío a las 20:30 de
 * Colombia se vería como la 01:30 del día siguiente y quedaría fuera de la
 * franja por un error de zona horaria, no por la regla. Es el mismo cuidado
 * que ya tiene la programación de envíos del CRM.
 */
function horaColombia(ahora = new Date()) {
  return new Date(ahora.getTime() - 5 * 60 * 60 * 1000).getUTCHours();
}

/**
 * ¿Se puede enviar mensajería de campaña en este momento?
 *
 * NO ES UNA REGLA NUESTRA: Onurix rechaza la mensajería promocional fuera de
 * 08:00–20:00 con el error 1015, «Hora fuera del intervalo valido». Antes de
 * esta guarda, un envío nocturno salía, lo rechazaba el proveedor y quien lo
 * mandó veía un error del que no podía deducir nada. Ahora se dice antes, con
 * las horas puestas.
 *
 * Las horas salen de sms_config, que hasta hoy nadie leía.
 */
function dentroDeFranja(cfg, ahora = new Date()) {
  const h = horaColombia(ahora);
  // El fin es la hora en que YA NO se envía: con 20, las 20:30 quedan fuera.
  return h >= cfg.horarioInicio && h < cfg.horarioFin;
}

function invalidarCache() {
  cfgCache = null;
  cfgCacheEn = 0;
}

// ---------------------------------------------------------------------------
// Una sola lista de baja
// ---------------------------------------------------------------------------

/**
 * ¿Esta persona pidió no recibir mensajes?
 *
 * Se consulta `no_contactar` de votantes y usuarios —la lista que el CRM ya
 * respeta desde el parche 14— y NO la tabla sms_exclusiones que trae el
 * módulo de cuota. Es una decisión tomada: dos listas para lo mismo
 * significan que alguien dado de baja en una pantalla igual recibe el
 * mensaje por el otro camino.
 *
 * Por eso todas las llamadas a canal.enviar() de este archivo van con
 * `omitirExclusion: true`: la exclusión se decide aquí, en un solo sitio.
 *
 * Se busca POR TELÉFONO y no por id de persona, que es como el parche 14
 * marca la baja: «se marca a la persona, no al número», y por eso marca
 * todas las fichas que compartan el número.
 */
async function estaDadoDeBaja(telefonoNormalizado) {
  // El número llega como 573001234567; en la base está como lo escribió
  // quien lo capturó. Se comparan los últimos 10 dígitos, que es la parte
  // que identifica al celular en Colombia.
  const diez = telefonoNormalizado.slice(-10);
  // El filtro que decide es `no_contactar = 1`, y por eso lleva índice: los
  // dados de baja son pocos, así que MySQL recorre solo esas filas. Un índice
  // sobre `telefono` NO serviría aquí — la columna va envuelta en
  // REGEXP_REPLACE y ningún índice se puede usar sobre una expresión.
  const [[fila]] = await pool.query(
    `SELECT
       EXISTS(SELECT 1 FROM votantes
               WHERE no_contactar = 1
                 AND RIGHT(REGEXP_REPLACE(telefono, '[^0-9]', ''), 10) = ?)
       OR
       EXISTS(SELECT 1 FROM usuarios
               WHERE no_contactar = 1
                 AND RIGHT(REGEXP_REPLACE(telefono, '[^0-9]', ''), 10) = ?) AS baja`,
    [diez, diez]
  );
  return Boolean(fila.baja);
}

// ---------------------------------------------------------------------------
// El canal
// ---------------------------------------------------------------------------

/**
 * El canal con cuota, o null si este servidor todavía no lo tiene configurado.
 * Se separa de obtenerCanal() para no intentar abrir una conexión al ledger
 * en una instalación que no tiene ni credenciales.
 */
async function obtenerCanal_o_null() {
  return loQueFalta().length ? null : obtenerCanal();
}

async function obtenerCanal() {
  const cfg = await configCampana();
  // Las credenciales de Twilio viven en la BASE (Configuración → Configurar
  // CRM), no en el .env, así que hay que pasárselas al transporte: lib/sms.js
  // solo mira process.env, y además espera TWILIO_FROM donde esta aplicación
  // guarda TWILIO_SMS_FROM. Sin esto, SMS_FALLBACK_PROVIDER=twilio sería una
  // promesa falsa: el respaldo fallaría con «Faltan credenciales».
  const cred = await obtenerCredenciales();

  return crearCanal({
    poolCentral: obtenerPoolLedger(),
    poolCampana: pool,
    campanaId: CAMPANA_ID,
    config: {
      forzarGSM7: cfg.forzarGSM7,
      proveedorPreferido: cfg.proveedorPreferido,
      // Onurix: si la campaña guardó su propia cuenta en Configurar
      // mensajería, manda esa; si no, obtenerCredenciales() ya devuelve la
      // maestra del .env. La cuota se descuenta igual en los dos casos —los
      // créditos son la unidad de medida del servicio, no el saldo de una
      // cuenta concreta.
      onurixClient: cred.onurixClient,
      onurixKey: cred.onurixKey,
      twilioSid: cred.twilioAccountSid,
      twilioToken: cred.twilioAuthToken,
      twilioFrom: cred.twilioSmsFrom,
    },
  });
}

/**
 * Envía un SMS. Misma firma y mismo contrato que la de config/twilio.js:
 * LANZA error si no se pudo enviar, y el llamador decide qué hacer con eso.
 *
 * @param {string} telefono
 * @param {string} mensaje
 * @param {string} [statusCallbackUrl]  se acepta y se ignora (ver encabezado)
 * @param {Object} [opciones]  { origen, usuarioId, contactoId, loteId, operativo }
 *        `operativo: true` es para los mensajes que la aplicación se manda a
 *        sí misma —el código de la Torre de acceso, el envío de prueba—: no
 *        son mensajería de campaña y no se saltan por la lista de baja, pero
 *        SÍ consumen crédito, porque cuestan igual.
 */
async function enviarSMS(telefono, mensaje, statusCallbackUrl, opciones = {}) {
  const canal = await obtenerCanal_o_null();
  const { normalizarCelular } = require('../lib/sms');
  const destino = normalizarCelular(telefono);
  if (!destino) throw new Error('Número de teléfono no válido.');

  // La lista de baja se respeta SIEMPRE, incluso cuando el envío va a salir
  // por Twilio: quien pidió no recibir mensajes no los recibe, por el camino
  // que sea. Es lo único de este archivo que aplica también al respaldo.
  if (!opciones.operativo && await estaDadoDeBaja(destino)) {
    const err = new Error('Esta persona pidió no recibir más mensajes.');
    err.codigo = 'DADO_DE_BAJA';
    throw err;
  }

  const falta = loQueFalta();
  if (falta.length) {
    // EL CANAL NUEVO NO ESTÁ CONFIGURADO: SE USA EL DE SIEMPRE.
    //
    // Antes esto lanzaba un error, y era lo correcto mientras este archivo
    // viviera solo en la instalación base. Pero al viajar en un parche llega a
    // campañas que todavía no tienen ledger ni credenciales de Onurix —el
    // .env nunca se empaqueta—, y fallar ahí seria cambiarles un canal que
    // funciona por uno que no. Twilio sigue siendo su camino hasta que
    // alguien escriba las variables; ese día, sin tocar código, el envío pasa
    // por Onurix.
    //
    // Esto NO tapa una mala configuración: estadoCanal() sigue devolviendo
    // `configurado: false` con la lista de lo que falta, así que la pantalla
    // de Configurar mensajería lo dice, y aquí queda avisado en el registro.
    avisarUnaVez(falta);
    return require('./twilio').enviarSMS(telefono, mensaje, statusCallbackUrl);
  }

  // La franja NO se le aplica a los mensajes operativos, y es deliberado.
  // El código de la Torre de acceso es el caso: alguien que entra a las 21:00
  // necesita su código, y bloquearlo aquí lo dejaría fuera de su propia
  // campaña. Si Onurix lo rechaza por su cuenta, el crédito se devuelve, el
  // error queda legible y todavía le queda entrar con contraseña.
  if (!opciones.operativo) {
    const cfg = await configCampana();
    if (!dentroDeFranja(cfg)) {
      const err = new Error(
        `Fuera del horario permitido para mensajería de campaña (${cfg.horarioInicio}:00 a ${cfg.horarioFin}:00, hora de Colombia). `
        + 'El proveedor rechaza los envíos promocionales fuera de esa franja.');
      err.codigo = 'FUERA_DE_FRANJA';
      throw err;
    }
  }

  const r = await canal.enviar({
    to: destino,
    body: mensaje,
    origen: opciones.origen || 'sistema',
    loteId: opciones.loteId,
    contactoId: opciones.contactoId,
    usuarioId: opciones.usuarioId,
    consentimiento: opciones.consentimiento,
    omitirExclusion: true,   // la exclusión ya se decidió arriba, en un solo sitio
  });

  if (!r.ok) {
    const err = new Error(r.error || 'No se pudo enviar el SMS.');
    err.codigo = r.errorCodigo;
    throw err;
  }

  // `sid` para no romper a quien ya lo esperaba: con Onurix es el id del
  // mensaje en el proveedor, que es lo mismo que era el SID de Twilio.
  return { sid: r.providerId, proveedor: r.provider, creditos: r.creditosUsados, envioId: r.envioId };
}

/** Saldo de la campaña. Devuelve null si no tiene cuota configurada. */
async function consultarSaldo() {
  if (loQueFalta().length) return null;
  const canal = await obtenerCanal();
  return canal.consultarSaldo();
}

/**
 * Estado del canal para la interfaz. Igual que estadoCanales() de twilio.js,
 * dice si está listo ANTES de que falle una campaña entera.
 */
async function estadoCanal() {
  const falta = loQueFalta();
  if (falta.length) {
    // EL CANAL NUEVO NO ESTÁ CONFIGURADO, PERO ESO NO ES «NO SE PUEDE ENVIAR».
    //
    // enviarSMS() cae a Twilio en ese caso, así que hay que preguntarle a
    // Twilio: es lo único que dice la verdad sobre si un mensaje va a salir.
    // Responder `configurado: false` aquí haría que el CRM rechazara con un
    // 400 toda campaña de SMS —tiene esa guarda antes de arrancar— aunque los
    // mensajes salieran perfectamente. Es decir: la pantalla diría que no hay
    // canal y el canal funcionando.
    //
    // `enFranja: true` porque la franja de 08:00–20:00 es una regla de Onurix;
    // Twilio no la tiene, y aplicarla al respaldo sería inventarle una
    // restricción que su proveedor no impone.
    const canalesTwilio = await require('./twilio').estadoCanales();
    const sms = (canalesTwilio && canalesTwilio.sms) || { configurado: false, motivo: null };
    return {
      configurado: sms.configurado,
      motivo: sms.configurado ? null : sms.motivo,
      proveedor: sms.configurado ? 'twilio' : null,
      respaldo: null,
      enFranja: true,
      franja: null,
      saldo: null,
      falta,
    };
  }
  const cfg = await configCampana();
  let saldo = null;
  let error = null;
  try { saldo = await consultarSaldo(); }
  catch (e) { error = e.message; }   // el ledger es otra base: puede no responder

  const enFranja = dentroDeFranja(cfg);
  return {
    configurado: true,
    // `motivo` sigue siendo null: el canal SÍ está configurado. Estar fuera de
    // la franja no es un defecto de configuración, es la hora que es — por eso
    // va en su propio campo y no marca el canal como roto.
    motivo: null,
    enFranja,
    franja: { inicio: cfg.horarioInicio, fin: cfg.horarioFin },
    proveedor: cfg.proveedorPreferido,
    respaldo: process.env.SMS_FALLBACK_PROVIDER || null,
    campanaId: CAMPANA_ID,
    saldo,
    error,
  };
}

module.exports = {
  enviarSMS, estadoCanal, consultarSaldo, estaDadoDeBaja, invalidarCache, CAMPANA_ID,
  // Se exportan para que el CRM pueda preguntar ANTES de arrancar una campaña
  // entera, en vez de descubrirlo destinatario por destinatario.
  dentroDeFranja, configCampana, horaColombia,
};
