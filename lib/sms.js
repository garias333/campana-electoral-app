/**
 * sms.js — Transporte SMS multi-proveedor (v2)
 * Estrategia Marketing Politico / appestrategia.net
 *
 * CAMBIO CLAVE FRENTE A v1:
 * Este modulo ya NO lee credenciales de process.env directamente en el envio.
 * Recibe la configuracion por parametro, para funcionar en multi-tenant.
 * process.env solo se usa como valor por defecto (cuenta maestra).
 *
 * Este archivo NO sabe nada de cuotas ni de base de datos. Solo transporta.
 * La cuota la maneja sms-cuota.js.
 *
 * Requiere Node 18+.
 */

'use strict';

// Onurix solo acepta IPv4. Sin esto, Node 22 sale por IPv6 y responde 1005.
require('node:dns').setDefaultResultOrder('ipv4first');

const ONURIX_BASE = 'https://www.onurix.com/api/v1';
const ONURIX_SEND = `${ONURIX_BASE}/sms/send`;
const ONURIX_STATE = `${ONURIX_BASE}/messages-state`;
const TIMEOUT_MS = parseInt(process.env.SMS_TIMEOUT_MS || '15000', 10);

// ---------------------------------------------------------------------------
// Mapeo de errores de Onurix
//
// Tabla oficial de docs.onurix.com/errors/, copiada completa el 12 de agosto
// de 2026. Se copia ENTERA —incluidos los codigos de tickets, shows y URLs
// cortas, que esta aplicacion nunca va a ver— porque el proposito de la tabla
// es que ningun codigo caiga en "error no documentado": el dia que aparezca
// uno raro, lo que se necesita es su nombre, no una busqueda en internet.
//
// A los que SI pueden salir enviando un SMS se les agrego que hacer. Ese
// anexo es lo unico que no es de Onurix.
//
// Son 117 codigos. Los huecos —1074, 1100 y del 1116 al 1129— son de la
// numeracion de ellos, no un olvido al copiar: su tabla salta del 1115 al 1130.
// ---------------------------------------------------------------------------

const ERRORES_ONURIX = {
  // --- Credenciales y origen de la peticion ---
  1001: 'Key no especificado',
  1002: 'Cliente no especificado',
  1003: 'Cliente o Key invalido — revise ONURIX_CLIENT y ONURIX_KEY en el .env',
  1004: 'IP no esta permitida — registre la IPv4 del servidor en portal.onurix.com/app/security/security',
  1005: 'IP no aprobada — registre la IPv4 del servidor en portal.onurix.com/app/security/security. '
      + 'Ojo: Onurix solo acepta IPv4, y este modulo fuerza IPv4 en Node por eso mismo',
  1047: 'Acceso no autorizado',

  // --- Estado de la cuenta ---
  1014: 'Cuenta deshabilitada',
  1017: 'La cuenta no esta habilitada por documentacion',
  1048: 'Cuenta inactivada por control antifraude',

  // --- Creditos ---
  1008: 'Necesita mas creditos para hacer el envio — es el saldo de la cuenta MAESTRA en Onurix, '
      + 'no la cuota de la campana (esa la lleva sms-cuota.js)',
  1051: 'No cuenta con suficientes creditos para crear URLs Premium',
  1052: 'No cuenta con suficientes creditos',
  1061: 'Creditos insuficientes',

  // --- Destinatario y mensaje ---
  1006: 'Numero de telefono o mensaje no especificado',
  1007: 'Numero de telefono invalido',
  1009: 'Codigo de Pais invalido',
  1010: 'Numero de telefono bloqueado — el operador o el propio destinatario lo deshabilito',
  1016: 'No se asociaron destinatarios al envio',
  1031: 'Supera el limite de 1000 mensajes por peticion — parta el lote',
  1067: 'No se encontraron numeros de telefono validos',
  1075: 'No se encontro el numero de telefono',
  1079: 'El numero telefonico ya esta en uso',
  1081: 'Destino inaccesible',
  1114: 'El largo del mensaje excede los 960 caracteres',

  // --- Reglas del canal en Colombia ---
  1015: 'Hora fuera del intervalo valido — Onurix solo acepta mensajeria promocional entre las '
      + '08:00 y las 20:00. Es la regla que las columnas horario_inicio/horario_fin de sms_config '
      + 'existen para respetar',
  1077: 'Firma SMS no configurada segun normatividad CRC — la exige el regulador colombiano; '
      + 'es la columna firma de sms_config',

  // --- Programacion de envios ---
  1011: 'Fecha invalida',
  1012: 'Fecha anterior a la actual',
  1013: 'Fecha fuera del intervalo valido',

  // --- Webhooks y respuestas entrantes ---
  1055: 'Mensaje no aceptado en la direccion proporcionada (su webhook lo rechazo)',
  1056: 'El usuario no cuenta con Endpoint receptor',
  1130: 'Ocurrio un error al intentar notificar al webhook — su URL no respondio 200',

  // --- Plantillas ---
  1071: 'Plantilla no especificada',
  1072: 'El usuario no tiene una plantilla asociada',
  1085: 'No es posible leer el JSON con la plantilla seleccionada',
  1086: 'No se encontro la variable "phones" o "group" en el JSON',
  1087: 'Verifique que todas las propiedades incluyan "value" y "type"',
  1099: 'La plantilla seleccionada no esta registrada en mautic',
  1131: 'El parametro template fue descontinuado — use templateId (MetaId)',
  1132: 'La plantilla seleccionada no puede ser utilizada desde este canal',

  // --- Canales y contactos (agenda de Onurix, que esta app no usa) ---
  1084: 'No se puede agregar un grupo de contactos mediante telefonos',
  1088: 'No se encontro el canal solicitado',
  1089: 'El grupo que intenta crear ya existe',
  1090: 'El nombre del grupo no debe contener caracteres especiales',
  1091: 'El grupo no existe',
  1092: 'El grupo tiene contactos asociados',
  1093: 'El contacto esta asociado a un grupo',
  1094: 'El canal seleccionado no es valido o no existe',
  1095: 'El contacto no existe',
  1096: 'El canal no es valido o es incorrecto',
  1097: 'El contacto ya existe',
  1098: 'El contacto no existe o no esta asociado al grupo',
  1112: 'El usuario no tiene grupos asociados',

  // --- Voz y audio ---
  1060: 'La voz seleccionada no es valida',
  1065: 'Numero de reintentos invalido (maximo 3)',
  1066: 'Hacen falta configuraciones',
  1068: 'El audio indicado no fue encontrado',
  1069: 'El parametro audio-code no es valido',

  // --- 2FA y apps ---
  1019: 'Codigo invalido',
  1020: 'El codigo ingresado es incorrecto',
  1021: 'Nombre de App no existente o no especificado',
  1022: 'Codigo expirado',
  1082: 'El tipo de app 2fa no puede ser ALL (debe ser SMS, CALL o WA)',

  // --- Meta / WhatsApp ---
  1080: 'Ocurrio un error enviando a Meta',
  1083: 'Meta no respondio satisfactoriamente',
  1115: 'No se encontro el tipo de propiedad solicitado',

  // --- URLs cortas, dominios y estadisticas ---
  1018: 'URL invalida',
  1032: 'URL invalida, verifique que tenga HTTP o HTTPS',
  1033: 'El numero maximo de links permitidos fue alcanzado',
  1034: 'Ya existe un Link con este nombre o URL',
  1035: 'URL larga no recibida',
  1036: 'La URL no existe',
  1037: 'La URL no cuenta con estadisticas',
  1038: 'Parametro nameUrl no recibido',
  1039: 'URL corta no recibida',
  1040: 'Pagina no encontrada',
  1041: 'No es posible asignar el alias',
  1042: 'URL bloqueada',
  1043: 'Nombre de dominio no encontrado',
  1044: 'Nombre de grupo no encontrado',
  1045: 'El valor para el tiempo de alojamiento es invalido',
  1046: 'Es necesario un rango de fechas',
  1049: 'Categoria no disponible',
  1050: 'Debe convertir la URL a Premium',
  1053: 'Supero el maximo tiempo permitido',
  1054: 'Solo es posible aumentar el tiempo de almacenamiento a las URLs Premium',
  1057: 'El numero minimo de caracteres para el alias es 3',
  1058: 'Limite de links excedidos en este dominio',
  1059: 'Este dominio no se encuentra asociado al usuario',
  1070: 'Creditos insuficientes para modificar un link Premium',
  1076: 'Nombre de url no especificado',
  1078: 'URL invalida: terminacion no permitida o host invalido',
  1104: 'URL ya existe',
  1105: 'El dominio no existe',
  1106: 'El grupo contiene URLs asociadas',
  1107: 'El nombre de dominio ya existe',
  1113: 'El dominio ya se encuentra asociado',

  // --- Tickets y shows (producto aparte de Onurix) ---
  1023: 'Ticket invalido',
  1024: 'Nombre de Show no existente o no especificado',
  1025: 'Este show esta deshabilitado',
  1026: 'Show vencido',
  1027: 'El ingreso aun no es permitido',
  1028: 'El ingreso ya no es permitido',
  1029: 'Ticket usado',
  1030: 'Ticket no existente',
  1062: 'Se requiere correo electronico',
  1063: 'Correo electronico erroneo',

  // --- Cuentas de usuario de Onurix ---
  1101: 'El usuario no existe',
  1102: 'El correo que intenta asociar ya existe',
  1103: 'El telefono que intenta asociar ya existe',
  1108: 'Usuario invalido o envio fuera del tiempo permitido',

  // --- Cargue por Excel ---
  1109: 'La cantidad de columnas no corresponde',
  1110: 'Los encabezados de las columnas no corresponden',
  1111: 'Uno o varios valores no cumplen las condiciones requeridas',

  // --- Otros ---
  1064: 'Los mensajes aun no han sido procesados',
  1073: 'Se ha presentado un error inesperado (JSON mal formado)',
  5000: 'Error interno de Onurix',
};

/**
 * Codigos donde reintentar con el proveedor de respaldo seria un error.
 *
 * No es una lista de "errores graves": es una lista de errores cuya causa
 * viaja con el mensaje, no con el proveedor. Un numero invalido o bloqueado
 * va a fallar igual en Twilio —y en el caso del bloqueado, insistir por el
 * otro proveedor es justamente lo que no se debe hacer— asi que el respaldo
 * solo gastaria saldo. Quedarse sin creditos en Onurix, en cambio, SI es
 * motivo para reintentar por el otro lado: es lo que un respaldo existe para
 * resolver.
 */
const ERRORES_ONURIX_SIN_RESPALDO = new Set([
  '1006', // no se especifico telefono o mensaje
  '1007', // numero invalido
  '1009', // codigo de pais invalido
  '1010', // numero bloqueado
  '1016', // sin destinatarios
  '1114', // mensaje demasiado largo
]);

function describirErrorOnurix(codigo, msgOriginal) {
  const conocido = ERRORES_ONURIX[codigo];
  if (conocido) return `${codigo} - ${conocido}`;
  return `${codigo} - ${msgOriginal || 'error no documentado'}`;
}

// ---------------------------------------------------------------------------
// Normalizacion de numeros colombianos
// ---------------------------------------------------------------------------

function normalizarCelular(entrada) {
  if (entrada === null || entrada === undefined) return null;

  let d = String(entrada).replace(/\D/g, '');
  if (!d) return null;

  d = d.replace(/^0+/, '');

  if (d.length === 12 && d.startsWith('57')) {
    d = d.slice(2);
  }

  if (d.length !== 10 || !d.startsWith('3')) return null;

  return '57' + d;
}

function aE164(entrada) {
  const n = normalizarCelular(entrada);
  return n ? '+' + n : null;
}

// ---------------------------------------------------------------------------
// Analisis de texto: GSM-7 vs UCS-2 y conteo de segmentos
// ---------------------------------------------------------------------------

const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = '^{}\\[~]|€';

function analizarTexto(texto) {
  const t = String(texto || '');
  let unidades = 0;
  let gsm7 = true;

  for (const ch of t) {
    if (GSM7.includes(ch)) unidades += 1;
    else if (GSM7_EXT.includes(ch)) unidades += 2;
    else {
      gsm7 = false;
      break;
    }
  }

  if (!gsm7) {
    unidades = t.length;
    const limite = unidades <= 70 ? 70 : 67;
    const segmentos = Math.max(1, Math.ceil(unidades / limite));
    return { gsm7: false, codificacion: 'ucs2', segmentos, caracteres: unidades,
             restantes: segmentos * limite - unidades };
  }

  const limite = unidades <= 160 ? 160 : 153;
  const segmentos = Math.max(1, Math.ceil(unidades / limite));
  return { gsm7: true, codificacion: 'gsm7', segmentos, caracteres: unidades,
           restantes: segmentos * limite - unidades };
}

function forzarGSM7(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, '');
}

// ---------------------------------------------------------------------------
// Credenciales
// ---------------------------------------------------------------------------

/**
 * Resuelve credenciales. Prioridad:
 *   1. Lo que venga en `config` (por campaña, si algun dia lo necesita)
 *   2. La cuenta maestra del .env
 */
function resolverCredenciales(config = {}) {
  return {
    onurix: {
      client: config.onurixClient || process.env.ONURIX_CLIENT,
      key: config.onurixKey || process.env.ONURIX_KEY,
    },
    twilio: {
      sid: config.twilioSid || process.env.TWILIO_ACCOUNT_SID,
      token: config.twilioToken || process.env.TWILIO_AUTH_TOKEN,
      from: config.twilioFrom || process.env.TWILIO_FROM,
    },
  };
}

// ---------------------------------------------------------------------------
// Driver: Onurix
// ---------------------------------------------------------------------------

async function enviarOnurix({ phone, body, cred }) {
  if (!cred.client || !cred.key) {
    return { ok: false, provider: 'onurix', errorCodigo: 'CONFIG',
             error: 'Faltan ONURIX_CLIENT u ONURIX_KEY' };
  }

  const params = new URLSearchParams();
  params.append('client', cred.client);
  params.append('key', cred.key);
  params.append('phone', phone);
  params.append('sms', body);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ONURIX_SEND, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
      signal: ctrl.signal,
    });

    const texto = await res.text();
    let json = null;
    try { json = JSON.parse(texto); } catch (_) { /* no JSON */ }

    // Formato de error confirmado en produccion: { error: 1005, msg: '...' }
    if (json && json.error) {
      return {
        ok: false,
        provider: 'onurix',
        errorCodigo: String(json.error),
        error: describirErrorOnurix(json.error, json.msg),
        raw: json,
      };
    }

    if (!res.ok) {
      return { ok: false, provider: 'onurix', errorCodigo: `HTTP${res.status}`,
               error: `HTTP ${res.status}`, raw: json || texto };
    }

    const data = (json && json.data) || {};
    const aceptado = Boolean(data.id);

    // Onurix devuelve DOS identificadores y hay que guardar los dos:
    //   json.id   -> id del despacho (dispatch_id en la consulta de estado)
    //   data.id   -> id del mensaje individual
    // La documentacion de /messages-state pide "Id del mensaje" pero su
    // respuesta trae los dos campos, y una consulta con data.id devolvio []
    // (probado el 12 de agosto de 2026 contra un mensaje real). Cual de los
    // dos se pregunta esta sin confirmar; guardar solo uno significa que un
    // mensaje ya enviado no se puede consultar nunca.
    return {
      ok: aceptado,
      provider: 'onurix',
      providerId: data.id || null,
      dispatchId: (json && json.id) || null,
      estadoProveedor: data.state || null,   // el estado inicial, que ya viene en la respuesta
      credits: typeof data.credits === 'number' ? data.credits : null,
      errorCodigo: aceptado ? null : 'SIN_ID',
      error: aceptado ? null : 'Onurix no devolvio id de mensaje',
      raw: json || texto,
    };
  } catch (err) {
    const msg = err.name === 'AbortError' ? `Timeout tras ${TIMEOUT_MS}ms` : err.message;
    return { ok: false, provider: 'onurix', errorCodigo: 'RED', error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Driver: Twilio — respaldo y destinos fuera de Colombia
// ---------------------------------------------------------------------------

async function enviarTwilio({ phone, body, cred }) {
  if (!cred.sid || !cred.token || !cred.from) {
    return { ok: false, provider: 'twilio', errorCodigo: 'CONFIG',
             error: 'Faltan credenciales de Twilio' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${cred.sid}/Messages.json`;
  const params = new URLSearchParams();
  params.append('To', '+' + phone);
  params.append('From', cred.from);
  params.append('Body', body);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${cred.sid}:${cred.token}`).toString('base64'),
      },
      body: params.toString(),
      signal: ctrl.signal,
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        ok: false,
        provider: 'twilio',
        errorCodigo: json ? String(json.code) : `HTTP${res.status}`,
        error: json ? `${json.code}: ${json.message}` : `HTTP ${res.status}`,
        raw: json,
      };
    }

    return { ok: true, provider: 'twilio', providerId: json.sid, raw: json };
  } catch (err) {
    const msg = err.name === 'AbortError' ? `Timeout tras ${TIMEOUT_MS}ms` : err.message;
    return { ok: false, provider: 'twilio', errorCodigo: 'RED', error: msg };
  } finally {
    clearTimeout(timer);
  }
}

const DRIVERS = { onurix: enviarOnurix, twilio: enviarTwilio };

// ---------------------------------------------------------------------------
// Consulta de estado — Onurix NO avisa, hay que preguntarle
// ---------------------------------------------------------------------------

/**
 * Pregunta por el estado de un mensaje ya enviado.
 *
 * Onurix no tiene webhook de estado para SMS: los webhooks de su
 * documentacion son de WhatsApp. Lo unico que hay es este endpoint de
 * consulta, asi que el paso de 'aceptado' a 'entregado' no puede ser un aviso
 * que llega — tiene que ser alguien que pregunta.
 *
 * @param {string} id      identificador del mensaje o del despacho (ver la
 *                         nota de enviarOnurix: cual de los dos sirve esta
 *                         sin confirmar, por eso este parametro es generico)
 * @param {Object} config  credenciales, igual que en sendSMS
 * @returns {Object} { ok, estado, phone, creditos, dispatchId, id, raw }
 *                   `ok:false` con motivo 'VACIO' cuando Onurix responde []
 *                   —que es lo que devuelve para un id que no reconoce—
 */
async function consultarEstadoOnurix(id, config = {}) {
  const cred = resolverCredenciales(config).onurix;
  if (!cred.client || !cred.key) {
    return { ok: false, motivo: 'CONFIG', error: 'Faltan ONURIX_CLIENT u ONURIX_KEY' };
  }
  if (!id) return { ok: false, motivo: 'SIN_ID', error: 'No hay identificador que consultar' };

  const params = new URLSearchParams({ client: cred.client, key: cred.key, id: String(id) });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${ONURIX_STATE}?${params}`, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    const texto = await res.text();
    let json = null;
    try { json = JSON.parse(texto); } catch (_) { /* no JSON */ }

    if (json && json.error) {
      return { ok: false, motivo: String(json.error),
               error: describirErrorOnurix(json.error, json.msg), raw: json };
    }
    // Un id que Onurix no reconoce responde [] — no un error. Sin este caso
    // se leeria como "sin estado" y el mensaje quedaria en revision para
    // siempre sin que nadie sepa por que.
    if (!json || (Array.isArray(json) && json.length === 0)) {
      return { ok: false, motivo: 'VACIO',
               error: 'Onurix no reconoce ese identificador', raw: json || texto };
    }

    const d = Array.isArray(json) ? json[0] : json;
    return {
      ok: true,
      estado: d.state || null,
      phone: d.phone || null,
      creditos: typeof d.credits === 'number' ? d.credits : null,
      creado: d.created || null,
      dispatchId: d.dispatch_id || null,
      id: d.id || null,
      raw: d,
    };
  } catch (err) {
    const msg = err.name === 'AbortError' ? `Timeout tras ${TIMEOUT_MS}ms` : err.message;
    return { ok: false, motivo: 'RED', error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// API publica de transporte
// ---------------------------------------------------------------------------

/**
 * Envia un SMS. NO controla cuota — para eso use sms-cuota.js.
 *
 * @param {Object} opts
 * @param {string} opts.to           Celular en cualquier formato
 * @param {string} opts.body         Texto
 * @param {Object} [opts.config]     { onurixClient, onurixKey, twilioSid, ... }
 * @param {string} [opts.proveedor]  'onurix' | 'twilio' | 'none'
 * @param {string} [opts.respaldo]   proveedor de respaldo si falla el primero
 * @param {boolean}[opts.forzarGSM7] quita tildes para abaratar
 */
async function sendSMS({ to, body, config = {}, proveedor, respaldo, forzarGSM7: forzar } = {}) {
  const phone = normalizarCelular(to);
  if (!phone) {
    return { ok: false, errorCodigo: 'NUMERO', provider: null,
             error: `Numero invalido o no es celular colombiano: ${to}` };
  }

  let texto = String(body || '').trim();
  if (!texto) {
    return { ok: false, errorCodigo: 'VACIO', provider: null, error: 'Mensaje vacio' };
  }
  if (forzar) texto = forzarGSM7(texto);

  const analisis = analizarTexto(texto);
  const creds = resolverCredenciales(config);

  const principal = (proveedor || process.env.SMS_PROVIDER || 'onurix').toLowerCase();
  const alterno = (respaldo !== undefined ? respaldo : process.env.SMS_FALLBACK_PROVIDER || '')
    .toLowerCase();

  if (principal === 'none') {
    console.log(`[SMS:DRYRUN] -> ${phone} (${analisis.segmentos} seg): ${texto}`);
    return { ok: true, provider: 'none', providerId: 'dryrun', analisis, phone, texto };
  }

  const driver = DRIVERS[principal];
  if (!driver) {
    return { ok: false, errorCodigo: 'PROVEEDOR', provider: null,
             error: `Proveedor desconocido: ${principal}` };
  }

  let r = await driver({ phone, body: texto, cred: creds[principal] });

  // No reintentar con respaldo si el error es de configuracion o del numero:
  // fallaria igual y gastaria saldo del otro proveedor sin necesidad. Lo
  // mismo con los codigos de Onurix cuya causa viaja con el mensaje y no con
  // el proveedor — un numero bloqueado sigue bloqueado en Twilio.
  const reintentable = r.errorCodigo !== 'CONFIG'
    && r.errorCodigo !== 'NUMERO'
    && !ERRORES_ONURIX_SIN_RESPALDO.has(String(r.errorCodigo));

  if (!r.ok && reintentable && alterno && DRIVERS[alterno] && alterno !== principal) {
    console.warn(`[SMS] ${principal} fallo (${r.error}). Respaldo: ${alterno}`);
    const r2 = await DRIVERS[alterno]({ phone, body: texto, cred: creds[alterno] });
    r2.fallbackDesde = principal;
    r2.errorPrincipal = r.error;
    r = r2;
  }

  r.analisis = analisis;
  r.phone = phone;
  r.texto = texto;
  return r;
}

module.exports = {
  sendSMS,
  normalizarCelular,
  aE164,
  analizarTexto,
  forzarGSM7,
  ERRORES_ONURIX,
  ERRORES_ONURIX_SIN_RESPALDO,
  consultarEstadoOnurix,
  // Se exporta para poder traducir un codigo a texto desde fuera —el webhook
  // de estado (punto 8) recibe codigos y tiene que escribirlos en la bitacora—
  // y para poder probarla sin salir a la red.
  describirErrorOnurix,
};
