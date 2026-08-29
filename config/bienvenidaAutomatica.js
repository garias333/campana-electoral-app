/**
 * SMS DE BIENVENIDA AL REGISTRAR A ALGUIEN NUEVO.
 *
 * Cuando se agrega una persona a la Estructura territorial o se registra un
 * votante, se le manda la plantilla «Bienvenida (primer contacto)».
 *
 * ---------------------------------------------------------------------------
 * NO ENVÍA NADA POR SU CUENTA, Y ESO ES LO IMPORTANTE DEL DISEÑO
 *
 * Este archivo no habla con el proveedor. Deja una campaña en `borrador` con
 * su destinatario y se va. Quien envía es el despachador que ya corre cada 60
 * segundos (`despacharCampanasProgramadas`, en routes/comunicaciones.routes.js,
 * arrancado desde app.js), llamando a `procesarEnvioCampana`.
 *
 * Se hereda gratis todo lo que esa maquinaria ya resuelve, y que reescribir
 * aquí habría significado tener dos versiones de cada regla:
 *
 *   · el reemplazo de {nombre}, {slogan} y {baja}, con enlace de baja firmado
 *     y distinto para cada persona;
 *   · la lista de «pidieron no recibir más»;
 *   · el registro en el Historial de campañas, con su estado por destinatario;
 *   · el reintento tras un reinicio de Node a media faena;
 *   · la pausa entre mensajes para no parecer una ráfaga.
 *
 * ---------------------------------------------------------------------------
 * UNA CAMPAÑA POR DÍA, NO UNA POR PERSONA
 *
 * Lo evidente era crear una campaña por cada registro. Con cincuenta personas
 * al día, el Historial se llena de cincuenta filas de «1 destinatario» y deja
 * de servir para lo que existe.
 *
 * Se reutiliza la campaña del día: si ya se envió, se le añade el
 * destinatario nuevo y se devuelve a `borrador`. `procesarEnvioCampana` solo
 * recorre las filas que siguen en `pendiente` —está escrito así para poder
 * reanudar— así que a nadie se le manda dos veces, y los totales se
 * recalculan sobre todas las filas al terminar. El Historial muestra una
 * línea por día: «Bienvenida automática · 29 de agosto · 12 enviados».
 *
 * ---------------------------------------------------------------------------
 * FUERA DE LA FRANJA SE GUARDA PARA LAS 8:00, NO SE PIERDE
 *
 * Onurix rechaza la mensajería promocional fuera de 08:00–20:00 (hora de
 * Colombia) con el error 1015. Quien se inscriba en un evento que termina a
 * las diez de la noche no puede quedarse sin bienvenida por eso: la campaña
 * queda programada para la hora de apertura del día siguiente.
 *
 * EL RETRASO SE CALCULA EN MINUTOS DESDE AHORA, no como una hora absoluta. La
 * aplicación corre en UTC, Colombia está en UTC-5 y `programado_para` se
 * compara contra el `NOW()` de MySQL, cuyo huso es una tercera cosa que este
 * archivo no tiene por qué conocer. Un `DATE_ADD(NOW(), INTERVAL n MINUTE)`
 * es correcto en los tres husos a la vez; una hora escrita a mano, solo en uno.
 *
 * ---------------------------------------------------------------------------
 * NUNCA LANZA HACIA ARRIBA
 *
 * Se llama desde el alta de una persona. Que falle el SMS no puede hacer que
 * falle el registro: la persona ya está guardada y quien la inscribió no tiene
 * forma de entender un error de mensajería. Todo va envuelto y lo peor que
 * pasa es una línea en el registro.
 */
const pool = require('./db');
const smsSvc = require('./sms');

const NOMBRE_PLANTILLA = 'Bienvenida (primer contacto)';

/**
 * APAGADO MIENTRAS NADIE LO ENCIENDA, y sin tabla también apagado.
 *
 * Cada bienvenida gasta crédito. El resto de los ajustes de este archivo
 * (`baja_automatica`) van encendidos por omisión porque no cuestan nada y
 * protegen a quien recibe; éste gasta, así que la omisión es la contraria.
 */
async function encendida() {
  try {
    const [[c]] = await pool.query('SELECT bienvenida_automatica FROM sms_config WHERE id = 1');
    return !!(c && c.bienvenida_automatica);
  } catch (_) {
    return false;
  }
}

/** Minutos hasta la próxima apertura de la franja. 0 si ya estamos dentro. */
function minutosHastaLaFranja(cfg, ahora = new Date()) {
  if (smsSvc.dentroDeFranja(cfg, ahora)) return 0;
  const colombia = new Date(ahora.getTime() - 5 * 60 * 60 * 1000);
  const h = colombia.getUTCHours();
  const m = colombia.getUTCMinutes();
  // Antes de que abra hoy, o después de que cerró (entonces es mañana).
  const minutosAhora = h * 60 + m;
  const minutosApertura = cfg.horarioInicio * 60;
  const falta = h < cfg.horarioInicio
    ? minutosApertura - minutosAhora
    : (24 * 60 - minutosAhora) + minutosApertura;
  // Un minuto de margen: el despachador compara `programado_para <= NOW()` y
  // caer justo en el borde de la hora deja el envío a merced del segundo exacto.
  return Math.max(1, falta + 1);
}

/** La campaña de bienvenidas de HOY, creándola si aún no existe. */
async function campanaDelDia(mensaje, minutosDeEspera) {
  const [[hoy]] = await pool.query(
    `SELECT id FROM comunicaciones_campanas
      WHERE canal = 'sms' AND nombre LIKE 'Bienvenida automática · %'
        AND DATE(created_at) = CURDATE()
      ORDER BY id DESC LIMIT 1`);

  if (hoy) {
    /* SE REABRE. Aunque ya se hubiera enviado: `procesarEnvioCampana` solo
       toca las filas en `pendiente`, así que las de antes no se repiten. El
       mensaje se refresca con la plantilla actual, para que editarla surta
       efecto el mismo día y no al siguiente. */
    await pool.query(
      `UPDATE comunicaciones_campanas
          SET estado = 'borrador', mensaje = ?,
              programado_para = DATE_ADD(NOW(), INTERVAL ? MINUTE),
              total_destinatarios = total_destinatarios + 1
        WHERE id = ?`,
      [mensaje, minutosDeEspera, hoy.id]);
    return hoy.id;
  }

  const [ins] = await pool.query(
    `INSERT INTO comunicaciones_campanas
       (nombre, canal, mensaje, estado, programado_para, total_destinatarios)
     VALUES (?, 'sms', ?, 'borrador', DATE_ADD(NOW(), INTERVAL ? MINUTE), 1)`,
    [`Bienvenida automática · ${new Date().toISOString().slice(0, 10)}`, mensaje, minutosDeEspera]);
  return ins.insertId;
}

/**
 * Encola la bienvenida de una persona recién registrada.
 *
 * `tipo` es 'votante' o 'estructura', y es el mismo par que usa el resto del
 * CRM en `comunicaciones_envios.destinatario_tipo`: de ahí sale el código con
 * el que se firma su enlace de baja. Un tipo inventado dejaría el {baja} vacío.
 */
async function encolarBienvenida({ tipo, id, nombre, telefono }) {
  try {
    if (!telefono || !nombre || !id) return { encolado: false, motivo: 'faltan datos' };
    if (!['votante', 'estructura'].includes(tipo)) return { encolado: false, motivo: 'tipo no válido' };
    if (!(await encendida())) return { encolado: false, motivo: 'apagado' };

    const [[plantilla]] = await pool.query(
      `SELECT cuerpo FROM comunicaciones_plantillas WHERE nombre = ? LIMIT 1`, [NOMBRE_PLANTILLA]);
    if (!plantilla) {
      console.warn(`Bienvenida automática: no existe la plantilla «${NOMBRE_PLANTILLA}». No se encoló nada.`);
      return { encolado: false, motivo: 'sin plantilla' };
    }

    let cfg;
    try { cfg = await smsSvc.configCampana(); } catch (_) { cfg = { horarioInicio: 8, horarioFin: 20 }; }
    const espera = minutosHastaLaFranja(cfg);

    const campanaId = await campanaDelDia(plantilla.cuerpo, espera);
    await pool.query(
      `INSERT INTO comunicaciones_envios
         (campana_id, destinatario_tipo, destinatario_id, destinatario_nombre, destinatario_contacto, estado)
       VALUES (?, ?, ?, ?, ?, 'pendiente')`,
      [campanaId, tipo, id, nombre, telefono]);

    return { encolado: true, campanaId, esperaMinutos: espera };
  } catch (err) {
    // Se traga a propósito: ver la cabecera. El alta de la persona manda.
    console.error('Bienvenida automática: no se pudo encolar (la persona SÍ quedó registrada):', err.message);
    return { encolado: false, motivo: 'error' };
  }
}

module.exports = { encolarBienvenida, encendida, minutosHastaLaFranja, NOMBRE_PLANTILLA };
