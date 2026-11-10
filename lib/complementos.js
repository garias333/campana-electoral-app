/**
 * «ACTIVAR COMPLEMENTOS» (parche 318): el interruptor GENERAL por campaña de nueve complementos.
 *
 * QUÉ ES. Una tabla (`complementos_campana`, una fila por complemento) que dice si el complemento existe para ESTA campaña. Apagado quiere
 * decir apagado para TODOS: el administrador y el superadministrador tampoco lo ven (ni en el menú, ni en pestañas, tarjetas o botones, ni
 * por la API, que responde 403 `{ motivo: 'complemento_inactivo' }`) y sus procesos automáticos de avisos se detienen. Los DATOS no se borran.
 * Encendido, cada rol lo ve según su fila de `permisos_rol`, como siempre: este archivo no toca esa matriz.
 *
 * DE FÁBRICA, TODOS APAGADOS (`init-db.js` hace INSERT IGNORE con activo = 0: correrlo otra vez NO apaga lo que el administrador encendió).
 *
 * SE FALLA CERRADO. Sin la tabla (código nuevo y `init-db` sin correr) o con un error al leerla, todo cuenta como APAGADO y se deja una línea
 * en el log (a lo sumo una por minuto). Es lo contrario de lo que haría un menú que «ante la duda muestra»: aquí lo que se protege es que un
 * complemento que la campaña NO contrató no aparezca ni responda por un fallo.
 *
 * LA CACHÉ. 10 segundos (se pregunta en cada petición de esos complementos y en cada carga de página), y se invalida al guardar. La
 * aplicación corre en UN solo proceso de PM2 por instalación (se arranca con `pm2 start app.js`, sin `-i` ni modo cluster), así que quien
 * guarda ve el cambio al instante. Si algún día hubiera varios procesos, los demás lo verían a lo sumo 10 segundos después. Un fallo de
 * lectura NO se guarda en la caché: en cuanto la base vuelve, vuelve el estado real.
 *
 * LA DEPENDENCIA. «Puerta a puerta panel» (`puerta_panel`) depende de «Puerta a puerta» (`puerta_a_puerta`): si éste está apagado, aquél
 * cuenta como apagado aunque su fila diga 1, y al apagar el primero el segundo se apaga también (`guardar`).
 *
 * LOS MÓDULOS DE PERMISOS. `modulos` es la lista de claves de `permisos_rol` que cubre cada complemento. El menú se arma con los módulos que
 * trae `/permisos/mios`; ahí se quitan los de un complemento apagado (`quitarModulosApagados`), también para el superadministrador y el
 * aspirante, que tienen listas fijas. `puerta_panel` no lista módulos propios: su permiso por rol sigue siendo `puerta_listas`, que ya cuelga
 * de `puerta_a_puerta` (su entrada de menú y sus rutas se cierran por la clave del complemento, no por el módulo).
 */
'use strict';

const pool = require('../config/db');

const CATALOGO = [
  { clave: 'solicitudes', nombre: 'Solicitudes ciudadanas',
    descripcion: 'Necesidades del barrio que el equipo registra en campo y la campaña sigue hasta cerrarlas.',
    modulos: ['solicitudes'], depende: null },
  { clave: 'tareas', nombre: 'Tareas',
    descripcion: 'Lo que la coordinación le asigna a su equipo por zona y el seguimiento hasta verificarlo.',
    modulos: ['tareas'], depende: null },
  { clave: 'puerta_a_puerta', nombre: 'Puerta a puerta',
    descripcion: 'Listas de visitas a votantes ya registrados, que se recorren en el celular, también sin señal.',
    modulos: ['puerta_listas', 'puerta_visitas'], depende: null },
  { clave: 'puerta_panel', nombre: 'Puerta a puerta panel',
    descripcion: 'Cobertura por zona y avance por visitante del puerta a puerta, solo con conteos.',
    modulos: [], depende: 'puerta_a_puerta' },
  { clave: 'alertas_dia_d', nombre: 'Alertas del día D',
    descripcion: 'El cuadro en vivo de la coordinación: mesas sin testigo, llegadas, E-14 y baja votación, con avisos en la app.',
    modulos: ['alertas_dia_d'], depende: null },
  { clave: 'resultados_dia_d', nombre: 'Resultados y reclamaciones',
    descripcion: 'El consolidado de votos, el resultado oficial, las diferencias y el paquete para el abogado.',
    modulos: ['resultados_dia_d'], depende: null },
  { clave: 'transporte_dia_d', nombre: 'Transporte del día D',
    descripcion: 'Vehículos, conductores y a quién recoge cada uno el día de la elección.',
    modulos: ['transporte_dia_d'], depende: null },
  { clave: 'logistica_dia_d', nombre: 'Logística del día D',
    descripcion: 'Refrigerios, almuerzos y kits por puesto, con la entrega confirmada.',
    modulos: ['logistica_dia_d'], depende: null },
  { clave: 'finanzas', nombre: 'Finanzas',
    descripcion: 'Ingresos y gastos de la campaña, sus categorías y la exportación para Cuentas Claras.',
    modulos: ['finanzas'], depende: null },
];

const CLAVES = CATALOGO.map((c) => c.clave);
const PORCLAVE = new Map(CATALOGO.map((c) => [c.clave, c]));
const MOTIVO = 'complemento_inactivo';
const MENSAJE_INACTIVO = 'Este complemento no está activo.';

// `COMPLEMENTOS_CACHE_MS=0` apaga la caché (solo las pruebas la usan, para encender y apagar en el mismo proceso).
const VIDA_CACHE_MS = process.env.COMPLEMENTOS_CACHE_MS && Number.isFinite(Number(process.env.COMPLEMENTOS_CACHE_MS))
  ? Number(process.env.COMPLEMENTOS_CACHE_MS) : 10 * 1000;
const MINUTO = 60 * 1000;

let cache = null;            // { filas: Map clave → { activo, actualizado_por, actualizado_en }, hasta }
let ultimoAviso = 0;

/** Una línea en el log por fallo, y a lo sumo una por minuto: una base caída no inunda el log con una por petición. */
function avisarFallo(err) {
  const ahora = Date.now();
  if (ahora - ultimoAviso < MINUTO) return;
  ultimoAviso = ahora;
  const motivo = err && err.code === 'ER_NO_SUCH_TABLE'
    ? 'falta la tabla complementos_campana (falta correr init-db)'
    : ((err && (err.code || err.message)) || 'error desconocido');
  console.error(`[complementos] No se pudo leer el estado de los complementos; se toman como APAGADOS: ${motivo}`);
}

/** Las filas tal como están en la base. Lanza si no se pueden leer. */
async function leerFilas() {
  const [filas] = await pool.query('SELECT clave, activo, actualizado_por, actualizado_en FROM complementos_campana');
  const mapa = new Map();
  filas.forEach((f) => mapa.set(f.clave, { activo: Number(f.activo) === 1, actualizado_por: f.actualizado_por, actualizado_en: f.actualizado_en }));
  return mapa;
}

/** Las filas, con la caché. Si la lectura falla, devuelve un mapa vacío (= todo apagado) SIN guardarlo. */
async function filas() {
  const ahora = Date.now();
  if (cache && VIDA_CACHE_MS > 0 && cache.hasta > ahora) return cache.filas;
  try {
    const f = await leerFilas();
    cache = { filas: f, hasta: ahora + VIDA_CACHE_MS };
    return f;
  } catch (err) {
    cache = null;
    avisarFallo(err);
    return new Map();
  }
}

/** Olvida lo guardado: la siguiente pregunta va a la base. Se llama al guardar y en las pruebas. */
function invalidar() { cache = null; }

function efectivo(mapa, clave, visitadas = []) {
  const def = PORCLAVE.get(clave);
  if (!def || visitadas.includes(clave)) return false;
  const fila = mapa.get(clave);
  if (!fila || !fila.activo) return false;
  return def.depende ? efectivo(mapa, def.depende, [...visitadas, clave]) : true;
}

/** ¿Está encendido este complemento (y aquello de lo que depende)? Una clave que no existe cuenta como apagada y se deja en el log. */
async function complementoActivo(clave) {
  if (!PORCLAVE.has(clave)) {
    console.error(`[complementos] Clave desconocida «${clave}»; se toma como APAGADA.`);
    return false;
  }
  return efectivo(await filas(), clave);
}

/** { clave: true|false } de los nueve, ya con la dependencia aplicada. */
async function complementosActivos() {
  const mapa = await filas();
  const r = {};
  CLAVES.forEach((c) => { r[c] = efectivo(mapa, c); });
  return r;
}

/** El complemento al que pertenece un módulo de `permisos_rol`, o null si no es de ninguno. */
function complementoDelModulo(modulo) {
  const c = CATALOGO.find((x) => x.modulos.includes(modulo));
  return c ? c.clave : null;
}

/** La lista de módulos SIN los de un complemento apagado. Lo usa `/permisos/mios` para todos los roles. */
async function quitarModulosApagados(modulos) {
  const activos = await complementosActivos();
  return (modulos || []).filter((m) => {
    const dueno = complementoDelModulo(m);
    return !dueno || activos[dueno];
  });
}

/** Lo que muestra la pantalla «Activar complementos»: una entrada por complemento, en el orden del catálogo. */
async function estado() {
  const mapa = await filas();
  let nombres = new Map();
  const ids = [...new Set([...mapa.values()].map((f) => f.actualizado_por).filter(Boolean))];
  if (ids.length) {
    try {
      const [us] = await pool.query('SELECT id, nombre FROM usuarios WHERE id IN (?)', [ids]);
      nombres = new Map(us.map((u) => [u.id, u.nombre]));
    } catch (_) { /* sin el nombre: solo se pierde ese dato */ }
  }
  return CATALOGO.map((c) => {
    const fila = mapa.get(c.clave) || null;
    return {
      clave: c.clave, nombre: c.nombre, descripcion: c.descripcion, modulos: c.modulos, depende: c.depende,
      activo: !!(fila && fila.activo),                 // lo que dice su fila
      efectivo: efectivo(mapa, c.clave),              // lo que de verdad pasa (con la dependencia)
      actualizado_por: fila && fila.actualizado_por ? (nombres.get(fila.actualizado_por) || null) : null,
      actualizado_en: fila ? fila.actualizado_en : null,
    };
  });
}

/**
 * Enciende o apaga un complemento. Encender uno cuya dependencia está apagada se rechaza (lanza con `estado: 409`); apagar «Puerta a puerta»
 * apaga también su panel. Devuelve los claves que quedaron cambiadas. Siempre invalida la caché.
 */
async function guardar(clave, activo, usuarioId) {
  const def = PORCLAVE.get(clave);
  if (!def) { const e = new Error('Ese complemento no existe.'); e.estado = 404; throw e; }
  const quiere = activo ? 1 : 0;
  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    if (quiere && def.depende) {
      const [[d]] = await cx.query('SELECT activo FROM complementos_campana WHERE clave = ? FOR UPDATE', [def.depende]);
      if (!d || Number(d.activo) !== 1) {
        const e = new Error(`«${def.nombre}» necesita «${PORCLAVE.get(def.depende).nombre}» encendido.`);
        e.estado = 409;
        throw e;
      }
    }
    const tocar = [clave];
    if (!quiere) CATALOGO.filter((c) => c.depende === clave).forEach((c) => tocar.push(c.clave));
    const cambiadas = [];
    for (const k of tocar) {
      const [[antes]] = await cx.query('SELECT activo FROM complementos_campana WHERE clave = ? FOR UPDATE', [k]);
      if (antes && Number(antes.activo) === quiere) continue;
      await cx.query(
        `INSERT INTO complementos_campana (clave, activo, actualizado_por, actualizado_en) VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE activo = VALUES(activo), actualizado_por = VALUES(actualizado_por), actualizado_en = VALUES(actualizado_en)`,
        [k, quiere, usuarioId || null]);
      cambiadas.push(k);
    }
    await cx.commit();
    return cambiadas;
  } catch (err) {
    try { await cx.rollback(); } catch (_) { /* la conexión ya cayó */ }
    throw err;
  } finally {
    cx.release();
    invalidar();
  }
}

module.exports = {
  CATALOGO, CLAVES, MOTIVO, MENSAJE_INACTIVO,
  complementoActivo, complementosActivos, complementoDelModulo, quitarModulosApagados,
  estado, guardar, invalidar,
};
