/**
 * RECORDATORIOS AUTOMÁTICOS — el motor (Fase 1). SIN pantalla y APAGADO de fábrica.
 *
 * Qué hace: cada 60 s, en este mismo proceso, mira las reglas activas (recordatorio_reglas), le pide a la fuente de cada tipo
 * «quiénes y cuándo les toca» y manda lo que YA toca (`<= ahora`) y no se ha mandado. No hay ninguna fuente real todavía
 * (los eventos y el «¿ya votaste?» llegan en las fases siguientes): se registran con `registrarTipo`. Con el interruptor
 * `configuracion_campana.recordatorios_activos` en 0 —de fábrica— solo lee esa fila y sale.
 *
 * LAS CINCO REGLAS QUE NO SE NEGOCIAN
 *   1. NO HAY DUPLICADOS. `recordatorio_envios` tiene clave única (regla, destinatario, ocurrencia) y se hace INSERT IGNORE
 *      ANTES de mandar: solo manda quien de verdad insertó (el mismo candado de lib/avisosAlertas.js). Dos vueltas a la vez,
 *      un reinicio o dos procesos mandan lo mismo UNA vez.
 *   2. CATCH-UP SIN REENVIAR. Lo que tocaba mientras el proceso estaba caído se manda al volver, dentro de `gracia_min`; lo que
 *      ya está registrado no se vuelve a mandar. Una fila que quedó en 'enviando' (el proceso murió con el proveedor en la mano)
 *      se RECONCILIA con la bitácora de SMS, no se reenvía a ciegas.
 *   3. SILENCIO. Entre `silencio_inicio` y `silencio_fin` (20:00–08:00) no sale NADA —ni push, ni correo, ni SMS—. Lo que tocaba
 *      en ese rato sale cuando termina el silencio (la gracia se cuenta desde ahí).
 *   4. CONSENTIMIENTO ESTRICTO. La ficha se vuelve a leer justo antes de enviar y se aplica puedeEscribirseEstricto
 *      (lib/canalesDelEnlace.js): el NULL NO autoriza, la baja manda, la confirmación pendiente excluye.
 *   5. PRECAMPAÑA. Antes de `fecha_permitida_propaganda` (vacía = nunca) ninguna plantilla puede hablar de voto, elección, urnas,
 *      tarjetón ni cargo —ni del nombre del cargo—. Lo rechaza el validador al guardarla Y se vuelve a comprobar con el texto
 *      ya armado, justo antes de enviar.
 *
 * COSTO. El SMS gasta crédito. `tope_diario_sms_automaticos` (200 de fábrica) se RESERVA antes de enviar (UPDATE condicional) y
 * nunca puede pasar del `limite_diario` del libro central de la campaña; si falla el envío, el cupo se devuelve.
 *
 * LAS HORAS. La base habla en hora de Colombia (-05:00) y `dateStrings: true`: las fechas salen y entran como TEXTO. Por eso aquí
 * nunca se le pasa un Date al driver (lo convertiría con la zona del servidor, UTC): se pasa texto Colombia (aTexto).
 */
'use strict';

const pool = require('../config/db');
const { analizarTexto } = require('./sms');
const { transliterarSms } = require('./transliterarSms');
const { puedeEscribirseEstricto } = require('./canalesDelEnlace');

const CINCO_HORAS = 5 * 60 * 60 * 1000;
const DIA = 24 * 60 * 60 * 1000;
const INTERVALO_MS = 60 * 1000;
const MAX_INTENTOS = 3;
const MINUTOS_ENVIANDO_VIEJO = 10;
/** Caracteres del « Baja: <enlace>» que el CRM le pega a un SMS (config/sms.js lo cuenta igual). */
const LARGO_BAJA_SMS = 78;
const MAX_PUSH_TITULO = 50;
const MAX_PUSH_CUERPO = 140;

/* --------------------------------------------------------------------------------------------------------------------------
   HORA DE COLOMBIA
   -------------------------------------------------------------------------------------------------------------------------- */

/** 'YYYY-MM-DD HH:MM:SS' en hora de Colombia: la forma en que esta base guarda y compara fechas. */
function aTexto(fecha) {
  return new Date(fecha.getTime() - CINCO_HORAS).toISOString().replace('T', ' ').slice(0, 19);
}
/** Lo contrario: un texto de la base (hora de Colombia) a un instante. */
function deTexto(texto) {
  return new Date(String(texto).replace(' ', 'T').slice(0, 19) + '-05:00');
}
function hoyTexto(fecha) { return aTexto(fecha).slice(0, 10); }
function minutosDelDia(fecha) { return Math.floor(((fecha.getTime() - CINCO_HORAS) % DIA + DIA) % DIA / 60000); }
function aMinutos(hhmmss) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmmss || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** ¿`fecha` cae en la franja de silencio de la campaña? (puede cruzar la medianoche: 20:00 → 08:00). */
function enSilencio(cfg, fecha) {
  const ini = aMinutos(cfg.silencio_inicio), fin = aMinutos(cfg.silencio_fin);
  if (ini == null || fin == null || ini === fin) return false;
  const m = minutosDelDia(fecha);
  return ini > fin ? (m >= ini || m < fin) : (m >= ini && m < fin);
}

/** El primer instante, desde `fecha`, que NO está en silencio. Si no está en silencio, es la propia fecha. */
function finDelSilencio(cfg, fecha) {
  if (!enSilencio(cfg, fecha)) return fecha;
  const ini = aMinutos(cfg.silencio_inicio), fin = aMinutos(cfg.silencio_fin);
  const cms = fecha.getTime() - CINCO_HORAS;
  const inicioDia = Math.floor(cms / DIA) * DIA;
  const m = minutosDelDia(fecha);
  const dias = (ini > fin && m >= ini) ? 1 : 0;     // después de las 20:00 el silencio termina MAÑANA a las 08:00
  return new Date(inicioDia + dias * DIA + fin * 60000 + CINCO_HORAS);
}

/** Cuándo volver a intentar algo que hoy ya no cabe (el tope del día): la apertura de mañana. */
function aperturaDeManana(cfg, fecha) {
  const fin = aMinutos(cfg.silencio_fin) || 0;
  const cms = fecha.getTime() - CINCO_HORAS;
  return new Date(Math.floor(cms / DIA) * DIA + DIA + fin * 60000 + CINCO_HORAS);
}

/* --------------------------------------------------------------------------------------------------------------------------
   PRECAMPAÑA
   -------------------------------------------------------------------------------------------------------------------------- */

/**
 * Lo que una plantilla NO puede decir antes de la fecha permitida. Se compara sin tildes y en minúsculas, por raíz:
 * «vot» cubre voto, votar, votó, votación, votante; «elecci» y «electoral»; «urna»; «tarjet» (tarjetón); «cargo»; y el nombre de
 * cada cargo de elección. Además se agrega, en tiempo de ejecución, el cargo que la campaña tiene configurado.
 */
const PALABRAS_DE_PROPAGANDA = [
  'vot\\w*', 'elecci\\w*', 'electoral\\w*', 'elegir', 'urnas?', 'tarjet\\w*', 'cargos?',
  'alcald\\w*', 'concej\\w*', 'gobernaci\\w*', 'gobernador\\w*', 'asamble\\w*', 'diputad\\w*', 'senad\\w*',
  'representante\\w*', 'camara de representantes', 'edil\\w*', 'jal',
];

function sinTildes(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** ¿Ya se puede hablar de voto, elección y cargo? Solo con una fecha permitida y que ya llegó. Vacía = nunca. */
function propagandaPermitida(cfg, ahora) {
  const f = cfg && cfg.fecha_permitida_propaganda ? String(cfg.fecha_permitida_propaganda).slice(0, 10) : '';
  return !!f && hoyTexto(ahora) >= f;
}

/** La primera palabra prohibida que trae el texto, o null. */
function palabraProhibida(texto, cfg) {
  const extra = cfg && cfg.cargo_aspira ? [sinTildes(cfg.cargo_aspira).replace(/_/g, ' ').replace(/[^a-z0-9 ]/g, '').trim()].filter(Boolean) : [];
  const patrones = PALABRAS_DE_PROPAGANDA.concat(extra.map((e) => e.replace(/\s+/g, '\\s+')));
  const re = new RegExp('(^|[^a-z0-9])(' + patrones.join('|') + ')(?=[^a-z0-9]|$)', 'i');
  const m = re.exec(sinTildes(texto));
  return m ? m[2] : null;
}

/* --------------------------------------------------------------------------------------------------------------------------
   TIPOS, VARIABLES Y PLANTILLAS
   -------------------------------------------------------------------------------------------------------------------------- */

const VARIABLES_BASE = ['nombre', 'candidato', 'eslogan'];

/**
 * Los tipos conocidos. La LISTA de variables de cada uno es cerrada: una llave que no esté aquí la rechaza el validador.
 * `candidatos` (la fuente: quiénes y cuándo) se registra aparte con registrarTipo; sin ella la regla no hace nada.
 *   conBaja       el SMS lleva «Baja: <enlace>» al final (cuenta en el largo).
 *   omiteSiYaVoto no se manda a quien ya votó (relee votante_votos).
 */
const TIPOS = {
  evento: {
    etiqueta: 'Recordatorio de un evento',
    variables: VARIABLES_BASE.concat(['titulo_evento', 'fecha_evento', 'hora_evento', 'lugar_evento']),
    conBaja: true, omiteSiYaVoto: false,
  },
  ya_votaste: {
    etiqueta: '¿Ya votaste? (Día D)',
    variables: VARIABLES_BASE.concat(['puesto', 'enlace_ya_vote']),
    conBaja: false, omiteSiYaVoto: true,
  },
};

/** Cuánto ocupa, como máximo, el valor de cada variable al MEDIR una plantilla. */
function largoMaximoDe(variable, cfg) {
  switch (variable) {
    case 'nombre': return 12;
    case 'candidato': return String((cfg && cfg.nombre_candidato) || '').length;
    case 'eslogan': return String((cfg && cfg.slogan_campana) || '').length;
    case 'titulo_evento': return 30;
    case 'fecha_evento': return 12;
    case 'hora_evento': return 8;
    case 'lugar_evento': return 30;
    case 'puesto': return 41;
    case 'enlace_ya_vote': return `https://${process.env.LICENCIA_DOMINIO || 'dominio.ejemplo'}/v/`.length + 12;
    default: return 20;
  }
}

/** Registra la fuente de candidatos de un tipo (y, si es nuevo, su lista de variables). */
function registrarTipo(nombre, def) {
  TIPOS[nombre] = Object.assign({ etiqueta: nombre, variables: VARIABLES_BASE.slice(), conBaja: false, omiteSiYaVoto: false }, TIPOS[nombre] || {}, def);
}

/**
 * Valida una plantilla. `ctx`: { cfg (configuracion_campana), sms: { firma, bajaAutomatica }, ahora }.
 * Devuelve { ok, errores: [texto…] }. Lo usa guardarRegla (al guardar) y el motor (con el texto ya armado, al enviar).
 */
function validarPlantilla(def, ctx) {
  const errores = [];
  const tipo = TIPOS[def.tipo];
  if (!tipo) errores.push(`El tipo «${def.tipo}» no existe.`);
  const texto = String(def.plantilla || '');
  if (!texto.trim()) errores.push('La plantilla está vacía.');
  if (!['sms', 'push', 'email'].includes(def.canal)) errores.push('El canal tiene que ser sms, push o email.');
  if (tipo) {
    const usadas = [...texto.matchAll(/\{([a-z_]+)\}/gi)].map((m) => m[1].toLowerCase());
    const sobran = [...new Set(usadas.filter((v) => !tipo.variables.includes(v)))];
    if (sobran.length) errores.push(`Variables que no existen para este tipo: ${sobran.map((v) => '{' + v + '}').join(', ')}. Las permitidas son ${tipo.variables.map((v) => '{' + v + '}').join(', ')}.`);
    if (/[{}]/.test(texto.replace(/\{[a-z_]+\}/gi, ''))) errores.push('Hay una llave suelta: las variables se escriben {así}.');
  }
  const cfg = (ctx && ctx.cfg) || {};
  const ahora = (ctx && ctx.ahora) || new Date();
  if (!propagandaPermitida(cfg, ahora)) {
    for (const campo of [texto, def.asunto || '']) {
      const p = palabraProhibida(campo, cfg);
      if (p) { errores.push(`Antes de la fecha permitida la plantilla no puede decir «${p}» (ni hablar de voto, elección, urnas, tarjetón o cargo).`); break; }
    }
  }
  if (tipo && def.canal === 'sms' && texto.trim()) {
    // Se mide con el peor caso de cada variable, ya sin tildes, con la firma del operador y con el enlace de baja si lleva.
    const peor = texto.replace(/\{([a-z_]+)\}/gi, (m, v) => 'x'.repeat(largoMaximoDe(v.toLowerCase(), cfg)));
    const sms = (ctx && ctx.sms) || {};
    const conBaja = tipo.conBaja && sms.bajaAutomatica !== false;
    const medida = analizarTexto(transliterarSms(peor) + (conBaja ? 'x'.repeat(LARGO_BAJA_SMS) : ''), sms.firma || '');
    if (medida.segmentos > 1) {
      errores.push(`Con la firma${conBaja ? ' y el enlace de baja' : ''} ocupa ${medida.caracteres} caracteres: pasa de un SMS (160). Acórtala.`);
    }
  }
  if (def.canal === 'push') {
    if (String(def.asunto || '').length > MAX_PUSH_TITULO) errores.push(`El título del aviso pasa de ${MAX_PUSH_TITULO} caracteres.`);
    if (texto.length > MAX_PUSH_CUERPO) errores.push(`El texto del aviso pasa de ${MAX_PUSH_CUERPO} caracteres.`);
  }
  if (def.canal === 'email' && String(def.asunto || '').trim().length === 0) errores.push('Un correo necesita asunto.');
  return { ok: errores.length === 0, errores };
}

/** Arma el texto: reemplaza cada {variable}. Devuelve { texto } o { falta: 'variable' } si alguna no tiene valor. */
function renderizar(plantilla, valores) {
  let falta = null;
  const texto = String(plantilla).replace(/\{([a-z_]+)\}/gi, (m, v) => {
    const k = v.toLowerCase();
    const val = valores[k];
    if (val === undefined || val === null || String(val).trim() === '') { falta = falta || k; return ''; }
    return String(val);
  });
  return falta ? { falta } : { texto };
}

/* --------------------------------------------------------------------------------------------------------------------------
   DEPENDENCIAS (se cambian en las pruebas)
   -------------------------------------------------------------------------------------------------------------------------- */

const deps = {
  reloj: () => new Date(),
  /** Lo que de verdad sale por cada canal. Devuelve el id del proveedor. Las pruebas lo reemplazan: no se manda nada real. */
  enviar: async (canal, o) => {
    if (canal === 'sms') {
      const smsSvc = require('../config/sms');
      const { sid } = await smsSvc.enviarSMS(o.ficha.telefono, o.texto, undefined,
        { origen: 'recordatorio', loteId: `rec-${o.regla.id}`, contactoId: o.filaId, consentimiento: true });
      return sid || null;
    }
    if (canal === 'push') {
      const { entregados } = await require('../config/push').enviarAUsuario(o.ficha.usuario_id, { titulo: o.asunto, cuerpo: o.texto });
      return `push:${entregados}`;
    }
    if (canal === 'email') {
      await require('../config/sendgrid').enviarCorreoMasivo(o.ficha.email, o.asunto, o.texto, o.urlBaja || '');
      return null;
    }
    throw new Error('Canal no reconocido.');
  },
  /** { limiteDiario, disponibleHoy } del libro central, o null si no hay (o no responde). */
  cuotaCentral: async () => {
    try { return await require('../config/sms').consultarSaldo(); } catch (_) { return null; }
  },
  /** { firma, bajaAutomatica } del canal de SMS. */
  configSms: async () => {
    try { const c = await require('../config/sms').configCampana(); return { firma: c.firma || '', bajaAutomatica: c.bajaAutomatica !== false }; }
    catch (_) { return { firma: '', bajaAutomatica: true }; }
  },
};

/* --------------------------------------------------------------------------------------------------------------------------
   LECTURAS
   -------------------------------------------------------------------------------------------------------------------------- */

async function leerConfig() {
  try {
    const [[c]] = await pool.query(
      `SELECT recordatorios_activos, fecha_permitida_propaganda, tope_diario_sms_automaticos,
              TIME_FORMAT(silencio_inicio, '%H:%i:%s') AS silencio_inicio, TIME_FORMAT(silencio_fin, '%H:%i:%s') AS silencio_fin,
              nombre_candidato, slogan_campana, cargo_aspira
         FROM configuracion_campana WHERE id = 1`);
    return c || null;
  } catch (_) { return null; }   // una campaña que aún no recibió la migración: apagado
}

/** La ficha de quien va a recibir el mensaje, leída AHORA (no la de cuando se armó la lista). */
async function leerFicha(tipo, id) {
  if (tipo === 'votante') {
    const [[v]] = await pool.query(
      `SELECT v.id, v.nombre, v.telefono, v.email, v.no_contactar, v.consentimiento_sms, v.consentimiento_email, v.consentimiento_whatsapp,
              v.origen AS origen_votante, v.consentimiento_confirmado_en, v.puesto_votacion,
              EXISTS(SELECT 1 FROM votante_votos vv WHERE vv.votante_id = v.id) AS ya_voto
         FROM votantes v WHERE v.id = ?`, [id]);
    return v || null;
  }
  if (tipo === 'usuario') {
    const [[u]] = await pool.query(`SELECT u.id, u.id AS usuario_id, u.nombre, u.telefono, u.email, u.no_contactar FROM usuarios u WHERE u.id = ?`, [id]);
    return u || null;
  }
  return null;
}

/* --------------------------------------------------------------------------------------------------------------------------
   TOPE DIARIO DE SMS AUTOMÁTICOS
   -------------------------------------------------------------------------------------------------------------------------- */

/** El tope real de hoy: el de la campaña, sin pasar nunca del límite diario del libro central (si lo hay: 0 = sin límite). */
function topeEfectivo(cfg, central) {
  let tope = Math.max(0, Number(cfg.tope_diario_sms_automaticos) || 0);
  if (central && Number(central.limiteDiario) > 0) tope = Math.min(tope, Number(central.limiteDiario));
  return tope;
}

/** Reserva `segmentos` ANTES de enviar: un UPDATE condicional, así dos vueltas a la vez no se pasan del tope. */
async function reservarTope(segmentos, cfg, ahora) {
  const central = await deps.cuotaCentral();
  if (central && central.disponibleHoy !== undefined && central.disponibleHoy !== null && Number(central.disponibleHoy) < segmentos) {
    return { ok: false, motivo: 'El libro central no tiene cupo para hoy.' };
  }
  const tope = topeEfectivo(cfg, central);
  const fecha = hoyTexto(ahora);
  await pool.query(`INSERT IGNORE INTO recordatorio_tope_diario (fecha, segmentos_usados) VALUES (?, 0)`, [fecha]);
  const [r] = await pool.query(
    `UPDATE recordatorio_tope_diario SET segmentos_usados = segmentos_usados + ? WHERE fecha = ? AND segmentos_usados + ? <= ?`,
    [segmentos, fecha, segmentos, tope]);
  return r.affectedRows === 1 ? { ok: true } : { ok: false, motivo: `Tope diario de SMS automáticos (${tope}) alcanzado.` };
}

async function devolverTope(segmentos, ahora) {
  await pool.query(`UPDATE recordatorio_tope_diario SET segmentos_usados = GREATEST(0, segmentos_usados - ?) WHERE fecha = ?`, [segmentos, hoyTexto(ahora)]);
}

/* --------------------------------------------------------------------------------------------------------------------------
   UN CANDIDATO → UN ENVÍO
   -------------------------------------------------------------------------------------------------------------------------- */

async function cerrar(id, estado, motivo, extra = {}) {
  await pool.query(
    `UPDATE recordatorio_envios SET estado = ?, motivo = ?, proveedor_id = COALESCE(?, proveedor_id),
            enviado_en = IF(? = 'enviado', ?, enviado_en), proximo_intento = ? WHERE id = ?`,
    [estado, motivo ? String(motivo).slice(0, 250) : null, extra.proveedorId || null, estado, extra.cuando || null, extra.proximo || null, id]);
}

/**
 * Lo que hay que hacer con UN candidato que ya toca. Devuelve una de: 'enviado' | 'omitido' | 'fallido' | 'diferido' |
 * 'duplicado' | 'vencido' | 'reintento'.
 */
async function procesarCandidato(regla, tipo, c, cfg, ahora, contexto) {
  const efectiva = finDelSilencio(cfg, c.debe_salir_en);
  const vencida = ahora.getTime() - efectiva.getTime() > Number(regla.gracia_min) * 60000;
  const ahoraTxt = aTexto(ahora);

  // 1. EL CANDADO: INSERT IGNORE antes de hacer nada. Solo sigue quien de verdad insertó (o reclama un reintento vencido).
  const [ins] = await pool.query(
    `INSERT IGNORE INTO recordatorio_envios (regla_id, destinatario_tipo, destinatario_id, ocurrencia, canal, estado, motivo, debe_salir_en, reclamado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [regla.id, c.destinatario_tipo, c.destinatario_id || 0, c.ocurrencia, regla.canal,
     vencida ? 'omitido' : 'reclamado', vencida ? `Pasó su ventana (${regla.gracia_min} min) sin poder salir.` : null,
     aTexto(c.debe_salir_en), ahoraTxt]);
  let filaId = ins.insertId;
  let intentos = 0;
  if (!ins.affectedRows) {
    const [[fila]] = await pool.query(
      `SELECT id, estado, intentos, proximo_intento FROM recordatorio_envios
        WHERE regla_id = ? AND destinatario_tipo = ? AND destinatario_id = ? AND ocurrencia = ?`,
      [regla.id, c.destinatario_tipo, c.destinatario_id || 0, c.ocurrencia]);
    // Solo se retoma lo que quedó esperando su turno (reintento o diferido) y ya le toca. Lo demás es un duplicado.
    if (!fila || !['reclamado', 'diferido'].includes(fila.estado) || !fila.proximo_intento || fila.proximo_intento > ahoraTxt) return 'duplicado';
    const [r] = await pool.query(
      `UPDATE recordatorio_envios SET estado = 'reclamado', proximo_intento = NULL, reclamado_en = ?
        WHERE id = ? AND estado IN ('reclamado','diferido') AND proximo_intento IS NOT NULL AND proximo_intento <= ?`, [ahoraTxt, fila.id, ahoraTxt]);
    if (!r.affectedRows) return 'duplicado';
    filaId = fila.id;
    intentos = Number(fila.intentos) || 0;
    if (vencida) { await cerrar(filaId, 'omitido', `Pasó su ventana (${regla.gracia_min} min) sin poder salir.`); return 'vencido'; }
  } else if (vencida) {
    return 'vencido';
  }

  // 2. La ficha se vuelve a leer AHORA, y se aplica la regla estricta.
  const ficha = await leerFicha(c.destinatario_tipo, c.destinatario_id);
  const permiso = puedeEscribirseEstricto(ficha, regla.canal);
  if (!permiso.ok) { await cerrar(filaId, 'omitido', permiso.motivo); return 'omitido'; }
  if (tipo.omiteSiYaVoto && Number(ficha.ya_voto) === 1) { await cerrar(filaId, 'omitido', 'Ya votó: no hace falta escribirle.'); return 'omitido'; }
  if (regla.canal === 'push' && c.destinatario_tipo !== 'usuario') { await cerrar(filaId, 'omitido', 'El aviso en la app solo llega al equipo (quien tiene cuenta).'); return 'omitido'; }

  // 3. El texto armado.
  const valores = Object.assign({}, c.datos || {}, {
    nombre: String(ficha.nombre || '').trim().split(/\s+/)[0],
    candidato: cfg.nombre_candidato, eslogan: cfg.slogan_campana,
    puesto: (c.datos && c.datos.puesto) || ficha.puesto_votacion,
  });
  const armado = renderizar(regla.plantilla, valores);
  if (armado.falta) { await cerrar(filaId, 'omitido', `Falta el dato {${armado.falta}}: no se manda a medias.`); return 'omitido'; }
  let texto = armado.texto;
  const asunto = regla.asunto ? (renderizar(regla.asunto, valores).texto || regla.asunto) : null;

  // 4. PRECAMPAÑA, otra vez, con el texto final (la configuración pudo cambiar desde que se guardó la plantilla).
  if (!propagandaPermitida(cfg, ahora)) {
    const p = palabraProhibida(texto, cfg) || palabraProhibida(asunto || '', cfg);
    if (p) { await cerrar(filaId, 'omitido', `Precampaña: el texto dice «${p}» y todavía no es la fecha permitida.`); return 'omitido'; }
  }

  // 5. SMS: un solo segmento (con firma y baja) y cupo del día.
  let segmentos = 0;
  if (regla.canal === 'sms') {
    const sms = contexto.sms;
    texto = transliterarSms(texto);
    const conBaja = tipo.conBaja && sms.bajaAutomatica !== false;
    segmentos = analizarTexto(texto + (conBaja ? 'x'.repeat(LARGO_BAJA_SMS) : ''), sms.firma || '').segmentos;
    if (segmentos > 1) { await cerrar(filaId, 'omitido', 'Armado, el mensaje pasa de un SMS: no se manda.'); return 'omitido'; }
    const cupo = await reservarTope(segmentos, cfg, ahora);
    if (!cupo.ok) {
      await cerrar(filaId, 'diferido', cupo.motivo, { proximo: aTexto(aperturaDeManana(cfg, ahora)) });
      return 'diferido';
    }
  }

  // 6. «enviando» ANTES de llamar al proveedor; después, el id que devuelva.
  const [en] = await pool.query(
    `UPDATE recordatorio_envios SET estado = 'enviando', intentos = ?, segmentos = ?, reclamado_en = ? WHERE id = ? AND estado = 'reclamado'`,
    [intentos + 1, segmentos, ahoraTxt, filaId]);
  if (!en.affectedRows) { if (segmentos) await devolverTope(segmentos, ahora); return 'duplicado'; }
  try {
    const proveedorId = await deps.enviar(regla.canal, { regla, ficha, texto, asunto, filaId, candidato: c });
    await cerrar(filaId, 'enviado', null, { proveedorId, cuando: aTexto(deps.reloj()) });
    return 'enviado';
  } catch (err) {
    if (segmentos) await devolverTope(segmentos, ahora);
    if (err && err.codigo === 'DADO_DE_BAJA') { await cerrar(filaId, 'omitido', 'Ese número pidió no recibir más mensajes.'); return 'omitido'; }
    if (err && err.codigo === 'FUERA_DE_FRANJA') {
      // No es un fallo ni un intento gastado: es la hora. Vuelve a salir cuando abra la franja.
      await pool.query(`UPDATE recordatorio_envios SET intentos = GREATEST(0, intentos - 1) WHERE id = ?`, [filaId]);
      await cerrar(filaId, 'diferido', 'Fuera de la franja del proveedor: sale en la próxima apertura.', { proximo: aTexto(finDelSilencio(cfg, aperturaDeManana(cfg, ahora))) });
      return 'diferido';
    }
    const gastados = intentos + 1;
    const mensaje = String((err && err.message) || err).slice(0, 200);
    if (gastados >= MAX_INTENTOS) { await cerrar(filaId, 'fallido', `${mensaje} (${gastados} intentos)`); return 'fallido'; }
    // Reintento con espera creciente: 5 y 15 minutos. Vuelve a 'reclamado' con su hora; la próxima vuelta lo retoma.
    await cerrar(filaId, 'reclamado', `${mensaje} (intento ${gastados} de ${MAX_INTENTOS})`, { proximo: aTexto(new Date(ahora.getTime() + (gastados === 1 ? 5 : 15) * 60000)) });
    return 'reintento';
  }
}

/* --------------------------------------------------------------------------------------------------------------------------
   RECONCILIAR LO QUE QUEDÓ A MEDIAS
   -------------------------------------------------------------------------------------------------------------------------- */

/**
 * · 'enviando' viejas (el proceso murió con el proveedor en la mano): SMS → se mira la bitácora (lote «rec-<regla>», contacto = la
 *   fila): si el proveedor lo aceptó es 'enviado'; si no hay rastro es 'fallido' con la advertencia. NUNCA se reenvía a ciegas.
 * · 'reclamado' viejas sin hora de reintento (el proceso murió ANTES de llamar al proveedor): no salió nada, así que se liberan.
 * `todas`: al arrancar, todas las 'enviando' son huérfanas (un solo proceso).
 */
async function reconciliar({ todas = false, ahora = deps.reloj() } = {}) {
  const limite = aTexto(new Date(ahora.getTime() - MINUTOS_ENVIANDO_VIEJO * 60000));
  const [filas] = await pool.query(
    `SELECT id, regla_id, canal FROM recordatorio_envios WHERE estado = 'enviando' AND (? OR reclamado_en IS NULL OR reclamado_en < ?)`, [todas ? 1 : 0, limite]);
  let n = 0;
  for (const f of filas) {
    let estado = 'fallido', proveedorId = null;
    let motivo = 'Se interrumpió el envío y no se pudo confirmar si el mensaje salió. Revisa antes de reintentar.';
    if (f.canal === 'sms') {
      try {
        const [[b]] = await pool.query(
          `SELECT estado, proveedor_id, error_mensaje FROM sms_envios WHERE lote_id = ? AND contacto_id = ? ORDER BY id DESC LIMIT 1`, [`rec-${f.regla_id}`, f.id]);
        if (b && (b.estado === 'aceptado' || b.estado === 'entregado')) { estado = 'enviado'; proveedorId = b.proveedor_id || null; motivo = null; }
        else if (b && (b.estado === 'fallido' || b.estado === 'rechazado')) motivo = String(b.error_mensaje || 'El proveedor lo rechazó.').slice(0, 250);
      } catch (_) { /* sin bitácora: queda la advertencia */ }
    }
    const [r] = await pool.query(
      `UPDATE recordatorio_envios SET estado = ?, motivo = ?, proveedor_id = COALESCE(?, proveedor_id), enviado_en = IF(? = 'enviado', ?, enviado_en)
        WHERE id = ? AND estado = 'enviando'`, [estado, motivo, proveedorId, estado, aTexto(ahora), f.id]);
    n += r.affectedRows;
  }
  const [lib] = await pool.query(
    `UPDATE recordatorio_envios SET proximo_intento = ? WHERE estado = 'reclamado' AND proximo_intento IS NULL AND reclamado_en < ?`, [aTexto(ahora), limite]);
  return { reconciliadas: n, liberadas: lib.affectedRows };
}

/* --------------------------------------------------------------------------------------------------------------------------
   LA VUELTA
   -------------------------------------------------------------------------------------------------------------------------- */

const sinFuenteAvisada = new Set();

/**
 * Una pasada. Devuelve un resumen. `o.ahora` fija el instante (pruebas).
 * Apagada, o dentro del silencio, no consulta nada más que la fila de configuración.
 */
async function vuelta(o = {}) {
  const ahora = o.ahora || deps.reloj();
  const r = { omitida: null, reglas: 0, candidatos: 0, enviados: 0, omitidos: 0, fallidos: 0, diferidos: 0, duplicados: 0, vencidos: 0, reintentos: 0, sinFuente: 0 };
  const cfg = await leerConfig();
  if (!cfg || !Number(cfg.recordatorios_activos)) { r.omitida = 'apagado'; return r; }
  await reconciliar({ ahora });
  if (enSilencio(cfg, ahora)) { r.omitida = 'silencio'; return r; }

  const [reglas] = await pool.query(`SELECT * FROM recordatorio_reglas WHERE activo = 1 ORDER BY id`);
  const sms = await deps.configSms();
  for (const regla of reglas) {
    const tipo = TIPOS[regla.tipo];
    if (!tipo || typeof tipo.candidatos !== 'function') {
      r.sinFuente++;
      if (!sinFuenteAvisada.has(regla.tipo)) { sinFuenteAvisada.add(regla.tipo); console.log(`Recordatorios: el tipo «${regla.tipo}» todavía no tiene fuente de candidatos; la regla ${regla.id} no hace nada.`); }
      continue;
    }
    r.reglas++;
    let candidatos = [];
    try { candidatos = await tipo.candidatos({ regla, ahora, cfg, pool }); }
    catch (err) { console.error(`Recordatorios: la fuente «${regla.tipo}» falló:`, err.message); continue; }
    for (const c of candidatos) {
      if (c.debe_salir_en.getTime() > ahora.getTime()) continue;   // todavía no toca
      r.candidatos++;
      try {
        const res = await procesarCandidato(regla, tipo, c, cfg, ahora, { sms });
        if (res === 'enviado') r.enviados++;
        else if (res === 'omitido') r.omitidos++;
        else if (res === 'fallido') r.fallidos++;
        else if (res === 'diferido') r.diferidos++;
        else if (res === 'duplicado') r.duplicados++;
        else if (res === 'vencido') r.vencidos++;
        else if (res === 'reintento') r.reintentos++;
      } catch (err) {
        console.error(`Recordatorios: error con el candidato ${c.ocurrencia}:`, err.message);
      }
    }
  }
  return r;
}

/* --------------------------------------------------------------------------------------------------------------------------
   REGLAS: GUARDAR CON VALIDACIÓN
   -------------------------------------------------------------------------------------------------------------------------- */

/**
 * Guarda (o actualiza) una regla. Valida la plantilla; si no pasa, lanza un error con `errores`. Una regla NUEVA nace apagada.
 * Lo usará la pantalla del administrador (fase siguiente).
 */
async function guardarRegla(d, usuarioId = null) {
  const cfg = await leerConfig() || {};
  const sms = await deps.configSms();
  const v = validarPlantilla(d, { cfg, sms, ahora: deps.reloj() });
  if (!v.ok) { const e = new Error(v.errores.join(' ')); e.errores = v.errores; throw e; }
  const campos = [d.tipo, String(d.nombre || d.tipo).slice(0, 120), d.canal, d.plantilla, d.asunto || null,
    d.desfase_min === undefined || d.desfase_min === '' ? null : d.desfase_min, d.hora_dia || null,
    d.gracia_min || 180, d.filtros ? JSON.stringify(d.filtros) : null];
  if (d.id) {
    await pool.query(`UPDATE recordatorio_reglas SET tipo=?, nombre=?, canal=?, plantilla=?, asunto=?, desfase_min=?, hora_dia=?, gracia_min=?, filtros=? WHERE id=?`, [...campos, d.id]);
    return d.id;
  }
  const [r] = await pool.query(
    `INSERT INTO recordatorio_reglas (tipo, nombre, canal, plantilla, asunto, desfase_min, hora_dia, gracia_min, filtros, activo, creado_por)
     VALUES (?,?,?,?,?,?,?,?,?,0,?)`, [...campos, usuarioId]);
  return r.insertId;
}

/* --------------------------------------------------------------------------------------------------------------------------
   ARRANQUE
   -------------------------------------------------------------------------------------------------------------------------- */

let corriendo = false;
/** Arranca el reloj de 60 s. Se llama una vez desde app.js. Apagada de fábrica: cada vuelta solo lee la configuración. */
function iniciar() {
  const correr = async () => {
    if (corriendo) return;   // una vuelta lenta no se pisa a sí misma
    corriendo = true;
    try { await vuelta(); } catch (err) { console.error('Recordatorios:', err.message); }
    finally { corriendo = false; }
  };
  reconciliar({ todas: true }).catch((err) => console.error('Recordatorios (al arrancar):', err.message));
  return setInterval(correr, INTERVALO_MS).unref();
}

module.exports = {
  iniciar, vuelta, reconciliar, guardarRegla, registrarTipo, validarPlantilla, renderizar,
  propagandaPermitida, palabraProhibida, topeEfectivo, enSilencio, finDelSilencio, aTexto, deTexto,
  TIPOS, deps, MAX_INTENTOS, LARGO_BAJA_SMS, PALABRAS_DE_PROPAGANDA,
};
