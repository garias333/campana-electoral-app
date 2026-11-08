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
const MAX_POR_VUELTA = 100;
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
 *   conBaja       el SMS lleva «Baja: <enlace>» al final (cuenta en el largo y NUNCA se recorta).
 *   recortables   variables que se acortan con «...» —en ese orden— si el SMS no cabe en un segmento.
 *   omiteSiYaVoto no se manda a quien ya votó (relee votante_votos).
 */
const TIPOS = {
  evento: {
    etiqueta: 'Recordatorio de un evento',
    variables: VARIABLES_BASE.concat(['evento', 'fecha', 'hora', 'lugar']),
    /* LLEVA «Baja: <enlace>» al final del SMS, y NUNCA se recorta. Para que con la firma del operador y ese enlace el texto quepa en
       UN segmento GSM-7, la plantilla de fábrica es corta y, si con datos largos no cabe, se recorta `{lugar}` y luego `{evento}` con
       «...» (tres puntos: el carácter «…» no es GSM-7 y mandaría el mensaje a 70). Ver ajustarSms. */
    conBaja: true, omiteSiYaVoto: false,
    recortables: ['lugar', 'evento'],
  },
  dia_d_ya_votaste: {
    etiqueta: '¿Ya votaste? (Día D)',
    variables: VARIABLES_BASE.concat(['puesto', 'enlace_ya_vote']),
    conBaja: false, omiteSiYaVoto: true,
    /* HABLA DE VOTO POR NATURALEZA. Su plantilla puede guardarse apagada antes de la fecha permitida (lo prohibido se avisa, no
       se rechaza), pero NO se puede ACTIVAR si la fecha está vacía o es futura, y el motor lo vuelve a comprobar al enviar. */
    bloqueaAlActivar: true, requierePropagandaPermitida: true,
  },
};

/** Cuánto ocupa, como máximo, el valor de cada variable al MEDIR una plantilla. */
function largoMaximoDe(variable, cfg) {
  switch (variable) {
    case 'nombre': return 12;
    case 'candidato': return String((cfg && cfg.nombre_candidato) || '').length;
    case 'eslogan': return String((cfg && cfg.slogan_campana) || '').length;
    case 'evento': return 30;
    case 'fecha': return 6;      // «20 nov»
    case 'hora': return 7;       // «10:30am»
    case 'lugar': return 30;
    case 'puesto': return 41;
    case 'enlace_ya_vote': return `https://${process.env.LICENCIA_DOMINIO || 'dominio.ejemplo'}/v/`.length + 12;
    default: return 20;
  }
}

/** Lo que ocupa un dato TÍPICO (para decirle a quien escribe cuánto le queda; el peor caso lo mide el validador). */
function largoTipicoDe(variable, cfg) {
  switch (variable) {
    case 'nombre': return 8;
    case 'evento': return 18;
    case 'lugar': return 16;
    case 'puesto': return 24;
    default: return largoMaximoDe(variable, cfg);
  }
}

/** Lo mínimo a lo que se recorta una variable: 6 letras y «...». */
const MIN_BASE_RECORTE = 6;
const MIN_RECORTE = MIN_BASE_RECORTE + 3;

/**
 * Lo que ocupa « Baja: <enlace>» en ESTA campaña: la base (url_baja_base o https://<dominio de la licencia>), «/b/» y un código de
 * hasta 18 caracteres (letra, id de hasta seis cifras, guion y 10 de firma). Depende del dominio: con uno largo llega a unos 78.
 */
function largoDeLaBaja(sms) {
  const base = ((sms && sms.urlBajaBase) || `https://${process.env.LICENCIA_DOMINIO || 'dominio.ejemplo'}`).replace(/\/+$/, '');
  return ' Baja: '.length + base.length + '/b/'.length + 18;
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
  const avisos = [];
  if (!propagandaPermitida(cfg, ahora)) {
    for (const campo of [texto, def.asunto || '']) {
      const p = palabraProhibida(campo, cfg);
      if (p) {
        const msg = `Antes de la fecha permitida la plantilla no puede decir «${p}» (ni hablar de voto, elección, urnas, tarjetón o cargo).`;
        // Un tipo que habla de voto por naturaleza se puede guardar APAGADO (se avisa); activarlo es lo que se bloquea.
        if (tipo && tipo.bloqueaAlActivar && !def.activo) avisos.push(msg); else errores.push(msg);
        break;
      }
    }
  }
  // Las variables también valen en el asunto.
  if (tipo && def.asunto) {
    const malas = [...new Set([...String(def.asunto).matchAll(/\{([a-z_]+)\}/gi)].map((m) => m[1].toLowerCase()).filter((v) => !tipo.variables.includes(v)))];
    if (malas.length) errores.push(`El asunto usa variables que no existen para este tipo: ${malas.map((v) => '{' + v + '}').join(', ')}.`);
  }
  if (def.canal === 'push') {
    if (String(def.asunto || '').length > MAX_PUSH_TITULO) errores.push(`El título del aviso pasa de ${MAX_PUSH_TITULO} caracteres.`);
    if (texto.length > MAX_PUSH_CUERPO) errores.push(`El texto del aviso pasa de ${MAX_PUSH_CUERPO} caracteres.`);
  }
  if (def.canal === 'email' && String(def.asunto || '').trim().length === 0) errores.push('Un correo necesita asunto.');
  /* EL SMS, CON TODO LO QUE OCUPA. Se mide ya sin tildes, con la firma del operador y —en los tipos que lo llevan— con el enlace de baja
     (que nunca se recorta). Valida el PEOR caso razonable: lo que se puede recortar, al mínimo (6 letras y «...»); lo demás, al
     máximo. Si ni así cabe en un segmento, se rechaza. Los números que se muestran son los de datos TÍPICOS. */
  let segmentos = null, caracteres = null, bajaCaracteres = 0, recortables = [];
  if (tipo && def.canal === 'sms' && texto.trim() && !errores.some((e) => /Variables que no existen|llave suelta/.test(e))) {
    const sms = (ctx && ctx.sms) || {};
    const conBaja = tipo.conBaja && sms.bajaAutomatica !== false;
    bajaCaracteres = conBaja ? largoDeLaBaja(sms) : 0;
    const usadas = [...texto.matchAll(/\{([a-z_]+)\}/gi)].map((m) => m[1].toLowerCase());
    recortables = (tipo.recortables || []).filter((v) => usadas.includes(v));
    const medir = (largo) => analizarTexto(transliterarSms(texto.replace(/\{([a-z_]+)\}/gi, (m, v) => 'x'.repeat(largo(v.toLowerCase())))) + 'x'.repeat(bajaCaracteres), sms.firma || '');
    const peor = medir((v) => (recortables.includes(v) ? MIN_RECORTE : largoMaximoDe(v, cfg)));
    if (peor.segmentos > 1) {
      errores.push(`Con la firma${conBaja ? ' y el enlace de baja' : ''} ocupa ${peor.caracteres} caracteres${recortables.length ? ', incluso recortando ' + recortables.map((v) => '{' + v + '}').join(' y ') : ''}: pasa de un SMS (160). Acórtala.`);
    }
    const tipico = medir((v) => largoTipicoDe(v, cfg));
    segmentos = tipico.segmentos; caracteres = tipico.caracteres;
  }
  return { ok: errores.length === 0, errores, avisos, segmentos, caracteres, bajaCaracteres, recortables };
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
        o.prueba
          ? { origen: 'recordatorio_prueba', loteId: 'rec-prueba', usuarioId: o.ficha.id, consentimiento: true }
          : { origen: 'recordatorio', loteId: `rec-${o.regla.id}`, contactoId: o.filaId, consentimiento: true });
      return sid || null;
    }
    if (canal === 'push') {
      const { entregados } = await require('../config/push').enviarAUsuario(o.ficha.usuario_id, { titulo: o.asunto, cuerpo: o.texto });
      return `push:${entregados}`;
    }
    if (canal === 'email') {
      let urlBaja = '';
      try {
        const { codigoDe, urlDeBaja } = require('../config/bajaContacto');
        const codigo = !o.prueba && o.candidato && o.candidato.destinatario_tipo === 'votante' ? codigoDe('votante', o.ficha.id) : null;
        urlBaja = codigo ? urlDeBaja(codigo) : '';
      } catch (_) { /* sin enlace: el correo sale igual */ }
      await require('../config/sendgrid').enviarCorreoMasivo(o.ficha.email, o.asunto, o.texto, urlBaja);
      return null;
    }
    throw new Error('Canal no reconocido.');
  },
  /** { limiteDiario, disponibleHoy } del libro central, o null si no hay (o no responde). */
  cuotaCentral: async () => {
    try { return await require('../config/sms').consultarSaldo(); } catch (_) { return null; }
  },
  /** El enlace «Ya voté» de un votante (se crea o se reutiliza). Lanza si no se puede armar. */
  enlaceYaVoto: async (votanteId) => {
    const yaVoto = require('../config/yaVotoEnlace');
    const base = yaVoto.baseDelSitio();
    if (!base) throw new Error('No se pudo armar el enlace «Ya voté»: falta el dominio de la licencia.');
    const mapa = await yaVoto.asegurarEnlaces([votanteId], base);
    const url = mapa.get(Number(votanteId));
    if (!url) throw new Error('No se pudo armar el enlace «Ya voté» para esta persona.');
    return url;
  },
  /** { firma, bajaAutomatica, urlBajaBase } del canal de SMS. */
  configSms: async () => {
    let urlBajaBase = null;
    try { const [[c]] = await pool.query('SELECT url_baja_base FROM sms_config WHERE id = 1'); urlBajaBase = c && c.url_baja_base ? c.url_baja_base : null; } catch (_) { /* sin la tabla: el dominio de la licencia */ }
    try { const c = await require('../config/sms').configCampana(); return { firma: c.firma || '', bajaAutomatica: c.bajaAutomatica !== false, urlBajaBase }; }
    catch (_) { return { firma: '', bajaAutomatica: true, urlBajaBase }; }
  },
  /** El enlace de baja de una persona («https://dominio/b/v123-Ab3xK9pQ2r»), o '' si no se puede firmar. */
  urlBaja: async (tipo, id, sms) => {
    const { codigoDe, urlDeBaja } = require('../config/bajaContacto');
    const codigo = codigoDe(tipo, id);
    return codigo ? urlDeBaja(codigo, (sms && sms.urlBajaBase) || null) : '';
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
 * Arma el texto de un SMS para que quepa en UN segmento junto con la firma y el sufijo (el enlace de baja, que NUNCA se toca).
 * Si no cabe, acorta con «...» las variables `recortables`, en ese orden: primero la primera hasta 6 letras, luego la siguiente.
 * Devuelve { texto (ya sin tildes y SIN el sufijo), recortado: [variables] } o null si ni así cabe.
 * Se usan tres puntos y no «…»: ese carácter no es GSM-7 y llevaría el mensaje a 70 caracteres.
 */
function ajustarSms({ plantilla, valores, recortables, sufijo, firma }) {
  const v = Object.assign({}, valores);
  const recortado = [];
  for (let vuelta = 0; vuelta < 400; vuelta++) {
    const r = renderizar(plantilla, v);
    if (r.falta) return null;
    const texto = transliterarSms(r.texto);
    if (analizarTexto(texto + sufijo, firma).segmentos <= 1) return { texto, recortado };
    const k = recortables.find((x) => v[x] !== undefined && String(v[x]).replace(/\.\.\.$/, '').length > MIN_BASE_RECORTE);
    if (!k) return null;
    const base = String(v[k]).replace(/\.\.\.$/, '');
    v[k] = base.slice(0, base.length - 1).trimEnd() + '...';
    if (!recortado.includes(k)) recortado.push(k);
  }
  return null;
}

/**
 * Lo que hay que hacer con UN candidato que ya toca. Devuelve una de: 'enviado' | 'omitido' | 'fallido' | 'diferido' |
 * 'duplicado' | 'vencido' | 'reintento'.
 */
async function procesarCandidato(regla, tipo, c, cfg, ahora, contexto) {
  const ahoraTxt = aTexto(ahora);
  /* HASTA CUÁNDO VALE. Una fuente puede fijar el momento límite (`vence_en`): el recordatorio de un evento sale mientras el
     evento no haya empezado, aunque lo hayan diferido el tope o el silencio; el «¿ya votaste?», hasta el cierre de la jornada.
     Sin `vence_en`, vale la gracia de la regla (contada desde el fin del silencio si tocaba en pleno silencio). */
  let vencida, motivoVencida;
  if (c.vence_en) {
    vencida = ahora.getTime() > c.vence_en.getTime();
    motivoVencida = c.motivo_vencido || 'Pasó su momento: ya no tiene sentido mandarlo.';
  } else {
    const efectiva = finDelSilencio(cfg, c.debe_salir_en);
    vencida = ahora.getTime() - efectiva.getTime() > Number(regla.gracia_min) * 60000;
    motivoVencida = `Pasó su ventana (${regla.gracia_min} min) sin poder salir.`;
  }
  // Sin cupo de SMS por hoy: no se registra nada, se vuelve a intentar cuando haya (mañana, tras el silencio).
  if (regla.canal === 'sms' && contexto.topeAgotado && !vencida) return 'sin_cupo';

  // 1. EL CANDADO: INSERT IGNORE antes de hacer nada. Solo sigue quien de verdad insertó (o reclama un reintento vencido).
  const [ins] = await pool.query(
    `INSERT IGNORE INTO recordatorio_envios (regla_id, destinatario_tipo, destinatario_id, ocurrencia, canal, estado, motivo, debe_salir_en, reclamado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [regla.id, c.destinatario_tipo, c.destinatario_id || 0, c.ocurrencia, regla.canal,
     vencida ? 'omitido' : 'reclamado', vencida ? motivoVencida : null,
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
    if (vencida) { await cerrar(filaId, 'omitido', motivoVencida); return 'vencido'; }
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
  if (typeof tipo.completarDatos === 'function' && /\{enlace_ya_vote\}/i.test(regla.plantilla)) {
    try { Object.assign(valores, await tipo.completarDatos({ c, ficha, cfg, ahora })); }
    catch (err) { await cerrar(filaId, 'omitido', String((err && err.message) || 'No se pudieron completar los datos del mensaje.').slice(0, 240)); return 'omitido'; }
  }
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
  let notaDeEnvio = null;
  if (regla.canal === 'sms') {
    const sms = contexto.sms;
    // El enlace de baja de ESTA persona, al final. NUNCA se recorta: lo que se acorta es el contenido.
    let sufijo = '';
    if (tipo.conBaja && sms.bajaAutomatica !== false) {
      let url = '';
      try { url = await deps.urlBaja('votante', ficha.id, sms); } catch (_) { /* sin llave de firma: sale sin enlace, como en el CRM */ }
      if (url) sufijo = ` Baja: ${url}`;
    }
    const ajustado = ajustarSms({ plantilla: regla.plantilla, valores, recortables: tipo.recortables || [], sufijo, firma: sms.firma || '' });
    if (!ajustado) { await cerrar(filaId, 'omitido', 'Armado, el mensaje pasa de un SMS aun recortando lo posible: no se manda.'); return 'omitido'; }
    if (ajustado.recortado.length) notaDeEnvio = `Se recortó ${ajustado.recortado.map((v) => '{' + v + '}').join(' y ')} con «...» para caber en un SMS.`;
    texto = ajustado.texto + sufijo;
    segmentos = analizarTexto(texto, sms.firma || '').segmentos;
    if (segmentos > 1) { await cerrar(filaId, 'omitido', 'Armado, el mensaje pasa de un SMS: no se manda.'); return 'omitido'; }
    const cupo = await reservarTope(segmentos, cfg, ahora);
    if (!cupo.ok) {
      contexto.topeAgotado = true;   // el resto de los SMS de esta vuelta ni se intenta
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
    await cerrar(filaId, 'enviado', notaDeEnvio, { proveedorId, cuando: aTexto(deps.reloj()) });
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
  const r = { omitida: null, reglas: 0, candidatos: 0, enviados: 0, omitidos: 0, fallidos: 0, diferidos: 0, duplicados: 0, vencidos: 0, reintentos: 0, sinFuente: 0, sinCupo: 0, restantes: 0 };
  const cfg = await leerConfig();
  if (!cfg || !Number(cfg.recordatorios_activos)) { r.omitida = 'apagado'; return r; }
  await reconciliar({ ahora });
  // Lo que cambió en el origen (un evento movido o cancelado) se limpia siempre, también en pleno silencio: es solo la base.
  for (const t of Object.values(TIPOS)) {
    if (typeof t.limpiar === 'function') { try { await t.limpiar({ ahora, cfg }); } catch (err) { console.error('Recordatorios (limpiar):', err.message); } }
  }
  if (enSilencio(cfg, ahora)) { r.omitida = 'silencio'; return r; }

  const [reglas] = await pool.query(`SELECT * FROM recordatorio_reglas WHERE activo = 1 ORDER BY id`);
  const sms = await deps.configSms();
  const contexto = { sms, topeAgotado: false };
  let procesados = 0;
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
      // Un tope por vuelta: una lista grande (el «¿ya votaste?») se reparte entre varias vueltas de 60 s y no deja la actual colgada.
      if (procesados >= MAX_POR_VUELTA) { r.restantes++; continue; }
      r.candidatos++;
      try {
        const res = await procesarCandidato(regla, tipo, c, cfg, ahora, contexto);
        if (res !== 'duplicado') procesados++;
        if (res === 'sin_cupo') r.sinCupo++;
        else if (res === 'enviado') r.enviados++;
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
   FORMATOS DE FECHA Y HORA PARA UN SMS (hora de Colombia, sin tildes ni puntos: «vie 20 nov», «10:30 am»)
   -------------------------------------------------------------------------------------------------------------------------- */

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function formatoFecha(fecha) {
  const d = new Date(fecha.getTime() - CINCO_HORAS);
  return `${d.getUTCDate()} ${MESES_CORTOS[d.getUTCMonth()]}`;            // «20 nov»: cada carácter cuenta en un SMS
}
function formatoHora(fecha) {
  const d = new Date(fecha.getTime() - CINCO_HORAS);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;   // «10:30am»
}

/* --------------------------------------------------------------------------------------------------------------------------
   REGLAS: GUARDAR, ACTIVAR, CONFIGURAR (lo usa la pantalla del administrador)
   -------------------------------------------------------------------------------------------------------------------------- */

const CANALES = ['sms', 'push', 'email'];

function conErrores(errores) {
  const e = new Error(errores.join(' '));
  e.errores = errores;
  return e;
}

async function reglaPorId(id) {
  const [[r]] = await pool.query(`SELECT * FROM recordatorio_reglas WHERE id = ?`, [id]);
  return r || null;
}

/** Cuándo toca: «X minutos antes» (eventos) o una hora del día (Día D). */
function validarProgramacion(def) {
  const errores = [];
  const g = Number(def.gracia_min);
  if (!Number.isInteger(g) || g < 1 || g > 1440) errores.push('La gracia tiene que ser un número de minutos entre 1 y 1440.');
  if (def.tipo === 'evento') {
    const d = Number(def.desfase_min);
    if (def.desfase_min === null || def.desfase_min === undefined || def.desfase_min === '' || !Number.isInteger(d) || d >= 0 || d < -10080) {
      errores.push('«Cuánto antes» tiene que ser un número de minutos negativo (por ejemplo -1440 = un día antes), de hasta 7 días.');
    }
  }
  if (def.tipo === 'dia_d_ya_votaste' && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(def.hora_dia || ''))) {
    errores.push('La hora tiene que ser del tipo 14:00.');
  }
  return errores;
}

/**
 * Guarda (o edita) una regla. Valida la plantilla y cuándo toca; si no pasa, lanza un error con `errores`. Una regla NUEVA nace
 * apagada. Al EDITAR no se cambian el tipo ni el canal, y las reglas ACTIVAS se validan completas (también la precampaña).
 */
async function guardarRegla(d, usuarioId = null) {
  let actual = null;
  if (d.id) {
    actual = await reglaPorId(d.id);
    if (!actual) throw conErrores(['La regla no existe.']);
  }
  const def = actual
    ? Object.assign({}, actual, ['nombre', 'plantilla', 'asunto', 'desfase_min', 'hora_dia', 'gracia_min']
      .reduce((o, k) => { if (d[k] !== undefined) o[k] = d[k]; return o; }, {}), { activo: Number(actual.activo) })
    : Object.assign({ gracia_min: 180 }, d, { activo: 0 });
  const cfg = await leerConfig() || {};
  const sms = await deps.configSms();
  const v = validarPlantilla(def, { cfg, sms, ahora: deps.reloj() });
  const errores = v.errores.concat(validarProgramacion(def));
  if (errores.length) throw conErrores(errores);
  const hora = def.hora_dia ? (String(def.hora_dia).length === 5 ? `${def.hora_dia}:00` : def.hora_dia) : null;
  const campos = [def.tipo, String(def.nombre || def.tipo).slice(0, 120), def.canal, def.plantilla, def.asunto || null,
    def.desfase_min === undefined || def.desfase_min === '' ? null : def.desfase_min, hora, def.gracia_min || 180, def.filtros ? JSON.stringify(def.filtros) : null];
  if (actual) {
    await pool.query(`UPDATE recordatorio_reglas SET tipo=?, nombre=?, canal=?, plantilla=?, asunto=?, desfase_min=?, hora_dia=?, gracia_min=?, filtros=? WHERE id=?`, [...campos, actual.id]);
    return actual.id;
  }
  const [r] = await pool.query(
    `INSERT INTO recordatorio_reglas (tipo, nombre, canal, plantilla, asunto, desfase_min, hora_dia, gracia_min, filtros, activo, creado_por)
     VALUES (?,?,?,?,?,?,?,?,?,0,?)`, [...campos, usuarioId]);
  return r.insertId;
}

/** Enciende o apaga una regla. Encender valida TODO (plantilla, programación y, en el «¿ya votaste?», la fecha permitida). */
async function activarRegla(id, activo, ctx = {}) {
  const regla = await reglaPorId(id);
  if (!regla) throw conErrores(['La regla no existe.']);
  if (!activo) {
    await pool.query(`UPDATE recordatorio_reglas SET activo = 0 WHERE id = ?`, [id]);
    return { id: regla.id, activo: 0, antes: Number(regla.activo) };
  }
  const ahora = ctx.ahora || deps.reloj();
  const cfg = await leerConfig() || {};
  const tipo = TIPOS[regla.tipo];
  const errores = [];
  if (!tipo) errores.push(`El tipo «${regla.tipo}» no existe.`);
  if (tipo && tipo.requierePropagandaPermitida && !propagandaPermitida(cfg, ahora)) {
    errores.push('No se puede activar: la fecha permitida de propaganda está vacía o todavía no llega.');
  }
  const v = validarPlantilla(Object.assign({}, regla, { activo: 1 }), { cfg, sms: await deps.configSms(), ahora });
  errores.push(...v.errores, ...validarProgramacion(regla));
  if (errores.length) throw conErrores(errores);
  await pool.query(`UPDATE recordatorio_reglas SET activo = 1 WHERE id = ?`, [id]);
  return { id: regla.id, activo: 1, antes: Number(regla.activo) };
}

/**
 * Cambia la configuración de los recordatorios (interruptor, fecha permitida, tope de SMS, silencio). Valida todo y devuelve
 * { antes, despues, reglasApagadas }. El tope nunca puede pasar del límite diario del libro central. Si la fecha permitida queda
 * vacía o futura, las reglas que exigen esa fecha se APAGAN (y se cuentan).
 */
async function guardarConfig(d, ctx = {}) {
  const antes = await leerConfig();
  if (!antes) throw conErrores(['La configuración de la campaña no está disponible.']);
  const errores = [];
  const sets = {};
  if (d.recordatorios_activos !== undefined) sets.recordatorios_activos = d.recordatorios_activos ? 1 : 0;
  if (d.fecha_permitida_propaganda !== undefined) {
    const f = d.fecha_permitida_propaganda;
    if (f === null || f === '') sets.fecha_permitida_propaganda = null;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(String(f)) && !Number.isNaN(Date.parse(f + 'T00:00:00Z'))) sets.fecha_permitida_propaganda = String(f);
    else errores.push('La fecha permitida tiene que ser una fecha válida (año-mes-día) o quedar vacía.');
  }
  if (d.tope_diario_sms_automaticos !== undefined) {
    const n = Number(d.tope_diario_sms_automaticos);
    if (!Number.isInteger(n) || n < 0 || n > 100000) errores.push('El tope diario de SMS tiene que ser un número entero entre 0 y 100.000.');
    else {
      const central = await deps.cuotaCentral();
      if (central && Number(central.limiteDiario) > 0 && n > Number(central.limiteDiario)) {
        errores.push(`El tope no puede pasar del límite diario del libro central (${central.limiteDiario}).`);
      } else sets.tope_diario_sms_automaticos = n;
    }
  }
  for (const k of ['silencio_inicio', 'silencio_fin']) {
    if (d[k] === undefined) continue;
    if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(d[k]))) errores.push(`La hora de ${k === 'silencio_inicio' ? 'inicio' : 'fin'} del silencio tiene que ser del tipo 20:00.`);
    else sets[k] = String(d[k]).length === 5 ? `${d[k]}:00` : d[k];
  }
  if (errores.length) throw conErrores(errores);
  const claves = Object.keys(sets);
  if (claves.length) {
    await pool.query(`UPDATE configuracion_campana SET ${claves.map((k) => `${k} = ?`).join(', ')} WHERE id = 1`, claves.map((k) => sets[k]));
  }
  const despues = await leerConfig();
  let reglasApagadas = 0;
  if (!propagandaPermitida(despues, ctx.ahora || deps.reloj())) {
    const tipos = Object.keys(TIPOS).filter((t) => TIPOS[t].requierePropagandaPermitida);
    if (tipos.length) {
      const [r] = await pool.query(`UPDATE recordatorio_reglas SET activo = 0 WHERE activo = 1 AND tipo IN (?)`, [tipos]);
      reglasApagadas = r.affectedRows;
    }
  }
  return { antes, despues, reglasApagadas };
}

/** Lo que muestra la pantalla: configuración, tope de hoy, libro central y qué tipos existen. */
async function estado(ahora = deps.reloj()) {
  const cfg = await leerConfig();
  const central = cfg ? await deps.cuotaCentral() : null;
  const [[uso]] = await pool.query(`SELECT COALESCE(SUM(segmentos_usados), 0) AS n FROM recordatorio_tope_diario WHERE fecha = ?`, [hoyTexto(ahora)]);
  return {
    ahora: aTexto(ahora),
    configurado: !!cfg,
    config: cfg && {
      recordatorios_activos: Number(cfg.recordatorios_activos),
      fecha_permitida_propaganda: cfg.fecha_permitida_propaganda ? String(cfg.fecha_permitida_propaganda).slice(0, 10) : null,
      tope_diario_sms_automaticos: Number(cfg.tope_diario_sms_automaticos),
      silencio_inicio: String(cfg.silencio_inicio).slice(0, 5), silencio_fin: String(cfg.silencio_fin).slice(0, 5),
    },
    propagandaPermitida: cfg ? propagandaPermitida(cfg, ahora) : false,
    enSilencio: cfg ? enSilencio(cfg, ahora) : false,
    usadoHoy: Number(uso.n),
    topeEfectivo: cfg ? topeEfectivo(cfg, central) : 0,
    libroCentral: central ? {
      asignados: central.asignados, consumidos: central.consumidos, disponibles: central.disponibles,
      limiteDiario: central.limiteDiario, consumidoHoy: central.consumidoHoy, disponibleHoy: central.disponibleHoy,
    } : null,
    tipos: Object.entries(TIPOS).map(([clave, t]) => ({
      clave, etiqueta: t.etiqueta, variables: t.variables, conBaja: !!t.conBaja,
      requierePropagandaPermitida: !!t.requierePropagandaPermitida, conFuente: typeof t.candidatos === 'function',
    })),
  };
}

/** Las reglas, con su cuenta de envíos por estado. */
async function listarReglas() {
  const [reglas] = await pool.query(`SELECT * FROM recordatorio_reglas ORDER BY FIELD(tipo, 'evento', 'dia_d_ya_votaste', 'solicitud_sin_movimiento'), canal, desfase_min, hora_dia, id`);
  const [cuentas] = await pool.query(`SELECT regla_id, estado, COUNT(*) AS n FROM recordatorio_envios GROUP BY regla_id, estado`);
  return reglas.map((r) => ({
    ...r, activo: Number(r.activo),
    tipo_etiqueta: (TIPOS[r.tipo] || {}).etiqueta || r.tipo,
    envios: cuentas.filter((c) => c.regla_id === r.id).reduce((o, c) => { o[c.estado] = Number(c.n); return o; }, {}),
  }));
}

/** El historial de envíos, con filtros por estado, motivo y regla. */
async function historial({ estado: est, motivo, regla, limite = 50, pagina = 1 } = {}) {
  const cond = [], params = [];
  if (est) { cond.push('e.estado = ?'); params.push(est); }
  if (motivo) { cond.push('e.motivo LIKE ?'); params.push(`%${String(motivo).replace(/[%_]/g, '')}%`); }
  if (regla) { cond.push('e.regla_id = ?'); params.push(Number(regla)); }
  const donde = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const tam = Math.min(200, Math.max(1, Number(limite) || 50));
  const off = (Math.max(1, Number(pagina) || 1) - 1) * tam;
  const [filas] = await pool.query(
    `SELECT e.id, e.regla_id, g.nombre AS regla, g.tipo, e.destinatario_tipo, e.destinatario_id,
            COALESCE(v.nombre, u.nombre) AS destinatario, e.canal, e.estado, e.motivo, e.intentos, e.segmentos,
            e.debe_salir_en, e.enviado_en, e.proximo_intento
       FROM recordatorio_envios e
       JOIN recordatorio_reglas g ON g.id = e.regla_id
       LEFT JOIN votantes v ON e.destinatario_tipo = 'votante' AND v.id = e.destinatario_id
       LEFT JOIN usuarios u ON e.destinatario_tipo = 'usuario' AND u.id = e.destinatario_id
       ${donde} ORDER BY e.id DESC LIMIT ? OFFSET ?`, [...params, tam, off]);
  const [[tot]] = await pool.query(`SELECT COUNT(*) AS n FROM recordatorio_envios e ${donde}`, params);
  const [porEstado] = await pool.query(`SELECT estado, COUNT(*) AS n FROM recordatorio_envios GROUP BY estado`);
  const [motivos] = await pool.query(
    `SELECT motivo, COUNT(*) AS n FROM recordatorio_envios WHERE estado = 'omitido' AND motivo IS NOT NULL GROUP BY motivo ORDER BY n DESC LIMIT 15`);
  return {
    filas, total: Number(tot.n), pagina: Math.max(1, Number(pagina) || 1), limite: tam,
    porEstado: porEstado.reduce((o, f) => { o[f.estado] = Number(f.n); return o; }, {}),
    motivosDeOmision: motivos.map((m) => ({ motivo: m.motivo, n: Number(m.n) })),
  };
}

/** Datos de muestra para una prueba (no son de nadie). */
function datosDeMuestra(tipo, ahora) {
  if (tipo === 'evento') return { evento: 'Reunion de ejemplo', fecha: formatoFecha(new Date(ahora.getTime() + DIA)), hora: '10:30am', lugar: 'Salon de ejemplo' };
  if (tipo === 'solicitud_sin_movimiento') return { categoria: 'Vias', barrio: 'Barrio de ejemplo', dias: 15 };
  const base = `https://${process.env.LICENCIA_DOMINIO || 'dominio.ejemplo'}/v/`;
  return { puesto: 'Colegio de ejemplo', enlace_ya_vote: base + 'EJEMPLOEJEMP' };
}

/**
 * «Enviarme una prueba»: manda la regla a QUIEN LA PIDE, con datos de muestra. NO se registra en recordatorio_envios, NO cuenta en
 * el tope diario y NO pasa por el consentimiento ni por el silencio (es el propio administrador pidiéndola). Sí usa el canal real:
 * un SMS gasta un crédito del libro central y el proveedor puede rechazarlo fuera de su franja. Devuelve a dónde fue (enmascarado).
 */
async function enviarPrueba({ reglaId, usuarioId, ahora = deps.reloj() }) {
  const regla = await reglaPorId(reglaId);
  if (!regla) throw conErrores(['La regla no existe.']);
  const [[u]] = await pool.query(`SELECT id, nombre, telefono, email FROM usuarios WHERE id = ?`, [usuarioId]);
  if (!u) throw conErrores(['No se encontró tu usuario.']);
  const cfg = await leerConfig() || {};
  const valores = Object.assign(datosDeMuestra(regla.tipo, ahora), { nombre: String(u.nombre || '').trim().split(/\s+/)[0] || 'Tu', candidato: cfg.nombre_candidato, eslogan: cfg.slogan_campana });
  const armado = renderizar(regla.plantilla, valores);
  if (armado.falta) throw conErrores([`Falta el dato {${armado.falta}} para armar la prueba.`]);
  let texto = armado.texto;
  const asunto = regla.asunto ? (renderizar(regla.asunto, valores).texto || regla.asunto) : null;
  let destino;
  if (regla.canal === 'sms') {
    const digitos = String(u.telefono || '').replace(/\D/g, '');
    if (!digitos) throw conErrores(['Tu usuario no tiene teléfono registrado: no hay a dónde mandar la prueba por SMS.']);
    const sms = await deps.configSms();
    const tipoDef = TIPOS[regla.tipo] || {};
    let sufijo = '';
    if (tipoDef.conBaja && sms.bajaAutomatica !== false) {
      try { const url = await deps.urlBaja('usuario', u.id, sms); if (url) sufijo = ` Baja: ${url}`; } catch (_) { /* sin llave */ }
    }
    const ajustado = ajustarSms({ plantilla: regla.plantilla, valores, recortables: tipoDef.recortables || [], sufijo, firma: sms.firma || '' });
    if (!ajustado) throw conErrores(['Armado con datos de muestra, el mensaje pasa de un SMS.']);
    texto = ajustado.texto + sufijo;
    destino = '*** ' + digitos.slice(-4);
  } else if (regla.canal === 'email') {
    if (!String(u.email || '').trim()) throw conErrores(['Tu usuario no tiene correo registrado.']);
    destino = String(u.email).replace(/^(.).*(@.*)$/, '$1***$2');
  } else {
    destino = 'este usuario (aviso en la app)';
  }
  await deps.enviar(regla.canal, { regla, ficha: { id: u.id, usuario_id: u.id, telefono: u.telefono, email: u.email, nombre: u.nombre }, texto, asunto, filaId: null, prueba: true, candidato: null });
  return { canal: regla.canal, destino, texto, asunto };
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
  iniciar, vuelta, reconciliar, guardarRegla, activarRegla, guardarConfig, estado, listarReglas, historial, enviarPrueba,
  registrarTipo, validarPlantilla, validarProgramacion, renderizar,
  propagandaPermitida, palabraProhibida, topeEfectivo, enSilencio, finDelSilencio, aTexto, deTexto, hoyTexto, formatoFecha, formatoHora,
  TIPOS, deps, pool, MAX_INTENTOS, MAX_POR_VUELTA, LARGO_BAJA_SMS, PALABRAS_DE_PROPAGANDA, CANALES, largoDeLaBaja, ajustarSms, MIN_RECORTE,
};

// Las fuentes reales de candidatos (eventos y «¿ya votaste?»). Van en su archivo; se registran aquí al cargar el motor.
require('./recordatoriosFuentes').registrar(module.exports);
// La fuente de las solicitudes ciudadanas sin movimiento (parche 304): apagada de fábrica, solo al responsable, solo por la app.
require('./recordatoriosSolicitudes').registrar(module.exports);
