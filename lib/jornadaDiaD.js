/**
 * La JORNADA del Día D: horarios, umbrales y «qué hora es» en Colombia. Una sola copia para el check-in, el cuadro de
 * alertas y los colores de las mesas en vivo.
 *
 * LOS HORARIOS VIVEN EN `configuracion_campana` (Configuración → Datos de la campaña, junto a la fecha de elección):
 *   jornada_apertura 08:00 · jornada_cierre 16:00 · plazo_e14_min 120 · alerta_checkin_min 30
 *   baja_votacion_pct 40 · baja_votacion_desde 12:00 · transporte_alerta_desde 14:00
 * Si las columnas todavía no existen (una instalación que no corrió `init-db`) o la fila no está, se usan esos valores
 * por omisión: el cuadro nunca debe caerse por no tener configuración.
 *
 * HORA DE COLOMBIA, SIEMPRE, y calculada aquí con `Intl` y no con la zona del servidor. «Hoy» y «ahora» se leen en
 * America/Bogota (UTC-5, sin horario de verano). Todo lo que pide la hora pasa por `ahoraColombia()`, y ésta por
 * `reloj()`: es lo que permite probar «antes y después de la hora» sin esperar a que dé la hora.
 *
 * «MODO PRUEBA»: fuera de `fecha_eleccion` todo funciona igual —se puede ensayar la jornada entera—; sólo se avisa. Por eso
 * la FECHA de un check-in o de una alerta atendida es la de HOY, no la de la elección.
 */
'use strict';

const DEFECTOS = {
  jornada_apertura: '08:00', jornada_cierre: '16:00', plazo_e14_min: 120,
  alerta_checkin_min: 30, baja_votacion_pct: 40, baja_votacion_desde: '12:00', avisos_alertas_push: 1,
  transporte_alerta_desde: '14:00',      // la alerta «Transporte sin recoger» (orden 35)
};

/** «hh:mm» o «hh:mm:ss» → minutos desde la medianoche; null si no es una hora. */
function aMinutos(t) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(t == null ? '' : t).trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 ? h * 60 + mi : null;
}

function hhmm(minutos) {
  const m = Math.max(0, Math.min(1439, Number(minutos) || 0));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const api = {
  /** El instante «actual». Se cambia en las pruebas. */
  reloj: () => new Date(),
};

/** Fecha (YYYY-MM-DD) y minutos del día, en hora de Colombia. */
function ahoraColombia(fecha = api.reloj()) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(fecha).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
  const hora = Number(p.hour === '24' ? '0' : p.hour);
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    minutos: hora * 60 + Number(p.minute),
    texto: `${p.year}-${p.month}-${p.day} ${String(hora).padStart(2, '0')}:${p.minute}`,
  };
}

/** La configuración de la jornada, con los valores por omisión donde falte algo. */
async function leerJornada(conexion) {
  let f = null;
  try {
    [[f]] = await conexion.query(
      `SELECT DATE_FORMAT(fecha_eleccion, '%Y-%m-%d') AS fecha_eleccion,
              TIME_FORMAT(jornada_apertura, '%H:%i') AS jornada_apertura,
              TIME_FORMAT(jornada_cierre, '%H:%i') AS jornada_cierre,
              plazo_e14_min, alerta_checkin_min, baja_votacion_pct,
              TIME_FORMAT(baja_votacion_desde, '%H:%i') AS baja_votacion_desde,
              avisos_alertas_push,
              TIME_FORMAT(transporte_alerta_desde, '%H:%i') AS transporte_alerta_desde
         FROM configuracion_campana WHERE id = 1`);
  } catch (_) { f = null; }
  const x = f || {};
  const num = (v, d, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : d; };
  const hora = (v, d) => (aMinutos(v) != null ? hhmm(aMinutos(v)) : d);
  const cfg = {
    fecha_eleccion: x.fecha_eleccion || null,
    jornada_apertura: hora(x.jornada_apertura, DEFECTOS.jornada_apertura),
    jornada_cierre: hora(x.jornada_cierre, DEFECTOS.jornada_cierre),
    plazo_e14_min: num(x.plazo_e14_min, DEFECTOS.plazo_e14_min, 0, 1440),
    alerta_checkin_min: num(x.alerta_checkin_min, DEFECTOS.alerta_checkin_min, 0, 1440),
    baja_votacion_pct: num(x.baja_votacion_pct, DEFECTOS.baja_votacion_pct, 1, 100),
    baja_votacion_desde: hora(x.baja_votacion_desde, DEFECTOS.baja_votacion_desde),
    transporte_alerta_desde: hora(x.transporte_alerta_desde, DEFECTOS.transporte_alerta_desde),
    // Encendido por omisión: sólo un 0 explícito apaga los avisos push automáticos.
    avisos_alertas_push: x.avisos_alertas_push === undefined || x.avisos_alertas_push === null ? true : Number(x.avisos_alertas_push) !== 0,
  };
  cfg.apertura_min = aMinutos(cfg.jornada_apertura);
  cfg.cierre_min = aMinutos(cfg.jornada_cierre);
  cfg.baja_desde_min = aMinutos(cfg.baja_votacion_desde);
  cfg.transporte_desde_min = aMinutos(cfg.transporte_alerta_desde);
  return cfg;
}

/**
 * ¿Está la jornada en la ventana en la que los avisos automáticos trabajan? Sólo el día de la elección y entre
 * `apertura − 60 min` y `cierre + plazo del E-14 + 120 min`. Fuera de eso el proceso no consulta nada más.
 */
function enVentanaDeAvisos(cfg, ahora = ahoraColombia()) {
  if (!cfg.fecha_eleccion || cfg.fecha_eleccion !== ahora.fecha) return false;
  const desde = cfg.apertura_min - 60;
  const hasta = cfg.cierre_min + cfg.plazo_e14_min + 120;
  return ahora.minutos >= desde && ahora.minutos <= hasta;
}

/** Dónde está «ahora» respecto de la jornada. */
function estadoDeLaJornada(cfg, ahora = ahoraColombia()) {
  return {
    hoy: ahora.fecha, minutos: ahora.minutos, ahora: ahora.texto,
    modo_prueba: cfg.fecha_eleccion !== ahora.fecha,
    fecha_eleccion: cfg.fecha_eleccion,
  };
}

/**
 * Valida lo que llega del formulario de Configuración. Devuelve `{ error }` o `{ valores }` (ya en los tipos de la base).
 * Reglas con sentido: el cierre va después de la apertura y los porcentajes y minutos tienen rango.
 */
function validarJornada(b) {
  b = b || {};
  const ap = aMinutos(b.jornada_apertura), ci = aMinutos(b.jornada_cierre), de = aMinutos(b.baja_votacion_desde);
  if (ap == null) return { error: 'La hora de apertura no es válida (use el formato 08:00).' };
  if (ci == null) return { error: 'La hora de cierre no es válida (use el formato 16:00).' };
  if (de == null) return { error: 'La hora desde la que se mira la baja votación no es válida.' };
  // Sin el campo (una pantalla vieja) NO se toca la hora guardada (va null y el UPDATE usa COALESCE): pisarla con el
  // valor por omisión borraría, sin avisar, una hora que el administrador ya cambió.
  const sinTransporte = b.transporte_alerta_desde === undefined || b.transporte_alerta_desde === null || b.transporte_alerta_desde === '';
  const tr = sinTransporte ? null : aMinutos(b.transporte_alerta_desde);
  if (!sinTransporte && tr == null) return { error: 'La hora desde la que se avisa del transporte sin recoger no es válida (use el formato 14:00).' };
  if (ci <= ap) return { error: 'El cierre tiene que ser después de la apertura.' };
  const entero = (v, min, max, nombre) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? null : `${nombre} debe ser un número entero entre ${min} y ${max}.`;
  };
  const e = entero(b.plazo_e14_min, 0, 1440, 'El plazo para subir el E-14 (minutos)')
    || entero(b.alerta_checkin_min, 0, 1440, 'Los minutos para avisar que un testigo no llegó')
    || entero(b.baja_votacion_pct, 1, 100, 'El porcentaje de baja votación');
  if (e) return { error: e };
  return { valores: {
    jornada_apertura: `${hhmm(ap)}:00`, jornada_cierre: `${hhmm(ci)}:00`, baja_votacion_desde: `${hhmm(de)}:00`,
    plazo_e14_min: Number(b.plazo_e14_min), alerta_checkin_min: Number(b.alerta_checkin_min),
    baja_votacion_pct: Number(b.baja_votacion_pct),
    transporte_alerta_desde: tr == null ? null : `${hhmm(tr)}:00`,
    // Sin el campo (una pantalla vieja) se conserva el encendido; sólo un apagado explícito lo apaga.
    avisos_alertas_push: (b.avisos_alertas_push === false || b.avisos_alertas_push === 0 || b.avisos_alertas_push === '0') ? 0 : 1,
  } };
}

/** Distancia en metros entre dos puntos (haversine). null si falta algún dato. */
function distanciaMetros(lat1, lon1, lat2, lon2) {
  const v = [lat1, lon1, lat2, lon2].map(Number);
  if (v.some(n => !Number.isFinite(n)) || [lat1, lon1, lat2, lon2].some(n => n === null || n === undefined || n === '')) return null;
  const R = 6371000, rad = (g) => g * Math.PI / 180;
  const dLat = rad(v[2] - v[0]), dLon = rad(v[3] - v[1]);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(v[0])) * Math.cos(rad(v[2])) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))));
}

module.exports = Object.assign(api, {
  DEFECTOS, aMinutos, hhmm, ahoraColombia, leerJornada, estadoDeLaJornada, enVentanaDeAvisos, validarJornada, distanciaMetros,
});
