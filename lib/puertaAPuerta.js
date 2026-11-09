/**
 * PUERTA A PUERTA (parche 309, Fases 0 y 1): el líder recibe una lista de votantes YA REGISTRADOS de su alcance, la recorre en el celular (también
 * sin señal) y anota el resultado de cada puerta. Las rutas están en routes/puertaAPuerta.routes.js; aquí vive la regla.
 * Las reglas que se juzgan en el celular Y en el servidor (franja, intentos, 24 horas, caducidad) están en public/js/puerta-reglas.js: un solo archivo.
 *
 * SOLO EL MODO (a). El modo (b) —recorrer una manzana sin datos de nadie— NO se construye: un «interesado» pegado a una ubicación es opinión
 * política, dato sensible, y no hay a quién pedirle la autorización en la puerta.
 *
 * LO QUE ESTE MÓDULO NO HACE, A PROPÓSITO
 *   · No escribe `apoya_a` ni nada de la intención de voto: «interesado» es un resultado de la visita, no un dato de la ficha.
 *   · No guarda la hora de la visita (solo fecha y franja del día) ni la ubicación de quien visita. La ubicación del celular, si se da, se usa en
 *     la pantalla para ordenar y no viaja.
 *   · No manda ninguna dirección a un tercero: el orden por cercanía sale de las coordenadas que la ficha YA tiene.
 *   · No se liga a Solicitudes ni al registro: «solicitud» y «quiere registrarse» solo abren esas pantallas; ninguna guarda de cuál visita vino.
 *   · No toca `no_contactar`: «pidió no volver» es `no_visitar`. Si además la persona no quiere mensajes, es una casilla aparte que llama a
 *     `aplicarBajaDeFicha` (config/bajaContacto.js) con canal `en_persona`.
 *
 * QUIÉN VE QUÉ
 *   · Arma las listas el módulo `puerta_listas` (administrador y coordinador, cuando se les abra). Solo ve CONTEOS: nunca nombres ni direcciones.
 *   · Visita el módulo `puerta_visitas` (líder y sublíder). Solo recibe SU lista, y de ella solo lo mínimo (ver `mias`).
 *   · Al ARMAR, la lista se filtra con el alcance de quien VA A VISITAR y con el de quien la arma; al LEER, se vuelve a filtrar con el del visitante:
 *     una ficha que cambió de líder, que retiró su autorización o que pidió no volver deja de salir sola.
 *   · El aspirante con sublicencia queda fuera (la ruta no está en la lista blanca de middleware/aspirante.js), y tampoco se le asigna a nadie de su rama.
 */
'use strict';

const pool = require('../config/db');
const R = require('../public/js/puerta-reglas');
const { condicionAlcanceVotantes, parametrosAlcanceVotantes } = require('./alcanceVotantes');
const Z = require('./zonas');
const { aplicarBajaDeFicha } = require('../config/bajaContacto');

const err = (estado, mensaje, extra) => { const e = new Error(mensaje); e.estado = estado; e.mensaje = mensaje; if (extra) Object.assign(e, extra); return e; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES_QUE_VISITAN = ['lider', 'sublider'];
const MAX_NOMBRE = 120, MIN_NOMBRE = 3;
const TOPE_CANDIDATOS = 20000;                  // más de esto en un solo alcance sin elegir zona: hay que acotar
const VENTANA_CAPTURA_DIAS = 7;                 // lo capturado sin señal se acepta hasta una semana después
const MENSAJE_DIA_DE_LA_ELECCION = 'Hoy es el día de la elección y ese día no se hacen visitas. Vuelve a abrirlo mañana.';

/* ------------------------------------------------------------------------------------------------------------ PERMISOS */

/**
 * Lo que la matriz le deja hacer a este usuario en un módulo de puerta a puerta (`puerta_listas` o `puerta_visitas`): { ver, editar, agregar }.
 * El administrador y el superadministrador siempre pueden todo. Falla CERRADO: sin fila o con un error, nada.
 */
async function permisosDe(usuario, modulo) {
  if (!usuario) return { ver: false, editar: false, agregar: false };
  if (usuario.rol === 'admin') return { ver: true, editar: true, agregar: true };
  try {
    const [[u]] = await pool.query('SELECT es_superadmin FROM usuarios WHERE id = ?', [usuario.id]);
    if (u && Number(u.es_superadmin) === 1) return { ver: true, editar: true, agregar: true };
    const [filas] = await pool.query('SELECT permitido, editar, agregar FROM permisos_rol WHERE rol = ? AND modulo = ? LIMIT 1', [usuario.rol, modulo]);
    if (!filas.length || Number(filas[0].permitido) !== 1) return { ver: false, editar: false, agregar: false };
    return { ver: true, editar: Number(filas[0].editar) === 1, agregar: Number(filas[0].agregar) === 1 };
  } catch (e) {
    console.error('[puerta a puerta] No se pudo comprobar el permiso:', e.code || e.message);
    return { ver: false, editar: false, agregar: false };
  }
}

/* ----------------------------------------------------------------------------------------------------------- CONFIG */

/**
 * La configuración que estas reglas necesitan: la franja y la fecha de la elección. A diferencia de la de las encuestas, esta NO se traga un error
 * de lectura: sin ella no se sabe si hoy es el día de la elección, y registrar una visita ese día es justo lo que no puede pasar.
 */
async function leerConfig() {
  const [[c]] = await pool.query(
    `SELECT puerta_franja_desde AS desde, puerta_franja_hasta AS hasta, DATE_FORMAT(fecha_eleccion, '%Y-%m-%d') AS fecha_eleccion
       FROM configuracion_campana WHERE id = 1`);
  const v = R.validarFranja(c && c.desde, c && c.hasta);
  const f = v.ok ? v : R.validarFranja(R.FRANJA_DESDE_DEFECTO, R.FRANJA_HASTA_DEFECTO);
  return { desde: f.desde, hasta: f.hasta, desdeTexto: f.desdeTexto, hastaTexto: f.hastaTexto, fecha_eleccion: (c && c.fecha_eleccion) || null };
}

/** Cambia la franja (solo el administrador; lo exige la ruta). Devuelve { desde, hasta } en texto o lanza 400. */
async function guardarFranja(desde, hasta) {
  const v = R.validarFranja(desde, hasta);
  if (!v.ok) throw err(400, v.error);
  const [r] = await pool.query('UPDATE configuracion_campana SET puerta_franja_desde = ?, puerta_franja_hasta = ? WHERE id = 1', [v.desdeTexto, v.hastaTexto]);
  if (!r.affectedRows) throw err(409, 'Falta la configuración de la campaña (fila id = 1): no se pudo guardar la franja.');
  return { desde: v.desdeTexto, hasta: v.hastaTexto };
}

/* ------------------------------------------------------------------------------------------------------------ ALCANCE */

/**
 * EL ALCANCE DE UNA PERSONA QUE NO ES QUIEN PREGUNTA. `calcularAlcance` (middleware/auth.js) arma `req.alcance` solo para quien hace la petición;
 * para armar la lista de OTRO hay que construir el mismo objeto con sus datos. Para líder y sublíder —los únicos que visitan— `condicionAlcanceVotantes`
 * solo mira `cargo` y `usuarioId` (el cargo de la madre y el territorio se usan en otros roles), así que este objeto es EXACTAMENTE el que calcularía
 * `calcularAlcance` si esa persona abriera la sesión. scripts/probar-puerta-a-puerta.js lo comprueba contra el middleware real.
 */
function alcanceDeUsuario(u) {
  return { usuarioId: Number(u.id), cargo: u.rol, cargoMadre: null };
}

/** La rama de aspirante de una persona (o null): una lista es de la campaña madre, así que quien visita tiene que ser de la madre. */
async function ramaDe(usuarioId) {
  try { return await require('./ramas').aspiranteDe(pool, usuarioId); }
  catch (e) { console.error('[puerta a puerta] No se pudo resolver la rama:', e.code || e.message); return -1; }      // sin saberlo, se cierra
}

/** A quién se le puede asignar: activo, líder o sublíder, dentro de lo que `asignables` deja y de la campaña madre. */
async function asignadoValido(asignables, usuarioId) {
  if (!asignables) throw err(403, 'No puedes asignar listas de visitas.');
  const id = Number(usuarioId);
  if (!Number.isInteger(id) || id < 1) throw err(400, 'Elige quién va a visitar.');
  const [[u]] = await pool.query(
    `SELECT u.id, u.nombre, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.id = ? AND u.activo = 1 AND r.nombre IN (?) AND ${asignables.sql}`, [id, ROLES_QUE_VISITAN, ...asignables.valores]);
  if (!u) throw err(400, 'No puedes asignarle una lista a esa persona. Tiene que ser un líder o un sublíder activo de tu equipo.');
  if ((await ramaDe(u.id)) !== null) throw err(400, 'Esa persona es de la campaña de un aspirante: este módulo todavía no atiende esas campañas.');
  return u;
}

/* ------------------------------------------------------------------------------------------------------------- ARMAR */

function limpiarTexto(t, max) {
  return String(t === undefined || t === null ? '' : t).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Arma y asigna una lista. `datos`: { nombre, asignada_a, territorio_id?, max?, cliente_uuid? }.
 * `alcanceQuienArma`: `req.alcance` de quien la arma; `asignables`: la condición de lib/alcanceTareas.asignablesPara.
 * Devuelve { id, duplicado, personas, omitidas: {...cuántas quedaron fuera y por qué, solo conteos}, sin_cupo }, o lanza un error con `.estado`.
 */
async function armarLista({ datos, usuario, alcanceQuienArma, asignables }) {
  const d = datos || {};
  const uuid = d.cliente_uuid ? String(d.cliente_uuid).trim().toLowerCase() : null;
  if (uuid && !UUID.test(uuid)) throw err(400, 'El identificador de la lista no es válido.');
  if (uuid) {
    const [[ya]] = await pool.query('SELECT id FROM puerta_listas WHERE cliente_uuid = ?', [uuid]);
    if (ya) return { id: Number(ya.id), duplicado: true, personas: null, omitidas: null, sin_cupo: 0 };
  }
  const nombre = limpiarTexto(d.nombre, MAX_NOMBRE);
  if (nombre.length < MIN_NOMBRE) throw err(400, `Ponle un nombre a la lista (al menos ${MIN_NOMBRE} letras).`);
  const asignado = await asignadoValido(asignables, d.asignada_a);
  const tope = Math.min(R.MAX_ITEMS_LISTA, Number.isInteger(Number(d.max)) && Number(d.max) > 0 ? Number(d.max) : R.MAX_ITEMS_LISTA);

  // La zona, si se pidió: del catálogo de la campaña, con todo lo que cuelga de ella. Una zona solo escrita a mano no filtra nada: no se acepta.
  let zona = { territorio_id: null, zona_texto: null }, ids = null;
  if (d.territorio_id !== undefined && d.territorio_id !== null && d.territorio_id !== '') {
    zona = await Z.resolverZonaDeCampo({ territorio_id: d.territorio_id, zona_texto: '' }, { obligatoria: true });
    ids = await Z.zonaYDescendientes(zona.territorio_id);
    if (!ids.length) throw err(400, 'Esa zona no está en el catálogo de la campaña.');
  }

  // El alcance de quien VA A VISITAR y el de quien arma: las dos condiciones. Un coordinador no le arma a su líder lo que él mismo no ve.
  const aV = alcanceDeUsuario(asignado);
  const cV = condicionAlcanceVotantes(aV, 'v'), pV = parametrosAlcanceVotantes(aV);
  const cA = condicionAlcanceVotantes(alcanceQuienArma, 'v'), pA = parametrosAlcanceVotantes(alcanceQuienArma);
  const [filas] = await pool.query(
    `SELECT v.id,
            (v.consentimiento_autorizado = 1) AS autorizo,
            (v.no_visitar = 0) AS visitable,
            (v.direccion IS NOT NULL AND TRIM(v.direccion) <> '') AS con_direccion,
            EXISTS (SELECT 1 FROM puerta_items i JOIN puerta_listas l ON l.id = i.lista_id
                     WHERE i.votante_id = v.id AND i.estado = 'pendiente' AND l.estado = 'activa') AS en_otra_lista,
            EXISTS (SELECT 1 FROM puerta_items i2
                     WHERE i2.votante_id = v.id AND i2.estado IN ('cerrada', 'agotada')
                       AND i2.ultima_fecha >= DATE_SUB(CURDATE(), INTERVAL ${Number(R.DIAS_SIN_REASIGNAR)} DAY)) AS reciente
       FROM votantes v
      WHERE ${cV} AND ${cA} AND v.rama_aspirante_id IS NULL ${ids ? 'AND v.territorio_id IN (?)' : ''}
      ORDER BY v.id LIMIT ${TOPE_CANDIDATOS + 1}`,
    [...pV, ...pA, ...(ids ? [ids] : [])]);
  if (filas.length > TOPE_CANDIDATOS) throw err(400, 'Esa persona tiene demasiadas fichas para armar la lista de una vez. Elige una zona.');

  const omitidas = { sin_autorizacion: 0, pidio_no_volver: 0, sin_direccion: 0, en_otra_lista: 0, visitada_hace_poco: 0 };
  const elegibles = [];
  for (const f of filas) {
    if (!Number(f.autorizo)) omitidas.sin_autorizacion++;
    else if (!Number(f.visitable)) omitidas.pidio_no_volver++;
    else if (!Number(f.con_direccion)) omitidas.sin_direccion++;
    else if (Number(f.en_otra_lista)) omitidas.en_otra_lista++;
    else if (Number(f.reciente)) omitidas.visitada_hace_poco++;
    else elegibles.push(f.id);
  }
  if (!elegibles.length) {
    throw err(422, 'No hay personas para visitar con esos criterios: todas están sin autorización, sin dirección, ya en otra lista o ya visitadas hace poco.', { omitidas, en_alcance: filas.length });
  }
  const elegidas = elegibles.slice(0, tope);

  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    const [r] = await cx.query(
      `INSERT INTO puerta_listas (cliente_uuid, nombre, territorio_id, zona_texto, asignada_a, creada_por, estado, rama_aspirante_id, aspirante_id)
       VALUES (?, ?, ?, ?, ?, ?, 'activa', NULL, 0)`,
      [uuid, nombre, zona.territorio_id, zona.zona_texto, asignado.id, usuario.id]);
    await cx.query('INSERT INTO puerta_items (lista_id, votante_id) VALUES ?', [elegidas.map((vid) => [r.insertId, vid])]);
    await cx.commit();
    return { id: Number(r.insertId), duplicado: false, personas: elegidas.length, omitidas, sin_cupo: elegibles.length - elegidas.length, asignado: { id: asignado.id, nombre: asignado.nombre } };
  } catch (e) {
    try { await cx.rollback(); } catch (_) { /* ya cerrada */ }
    if (e && e.code === 'ER_DUP_ENTRY' && uuid) {                       // dos clics a la vez: gana uno, el otro devuelve la misma
      const [[otra]] = await pool.query('SELECT id FROM puerta_listas WHERE cliente_uuid = ?', [uuid]);
      if (otra) return { id: Number(otra.id), duplicado: true, personas: null, omitidas: null, sin_cupo: 0 };
    }
    throw e;
  } finally { cx.release(); }
}

/** Las listas que quien arma puede ver, SOLO con conteos (nada de nombres ni direcciones). `condicion`: de lib/alcanceTareas.alcanceTareas(alcance, 'l'). */
async function listasDe(condicion) {
  const [filas] = await pool.query(
    `SELECT l.id, l.nombre, l.estado, l.territorio_id, l.zona_texto, l.asignada_a, ua.nombre AS asignada_nombre,
            DATE_FORMAT(l.creada_en, '%Y-%m-%d') AS creada, COUNT(i.id) AS total,
            COALESCE(SUM(i.estado = 'pendiente'), 0) AS pendientes, COALESCE(SUM(i.estado = 'cerrada'), 0) AS cerradas, COALESCE(SUM(i.estado = 'agotada'), 0) AS agotadas
       FROM puerta_listas l
       LEFT JOIN usuarios ua ON ua.id = l.asignada_a
       LEFT JOIN puerta_items i ON i.lista_id = l.id
      WHERE ${condicion.sql}
      GROUP BY l.id, l.nombre, l.estado, l.territorio_id, l.zona_texto, l.asignada_a, ua.nombre, l.creada_en
      ORDER BY l.id DESC LIMIT 200`, condicion.valores);
  return filas.map((f) => ({
    id: f.id, nombre: f.nombre, estado: f.estado, zona: f.zona_texto || null, asignada_a: f.asignada_a, asignada_nombre: f.asignada_nombre || '(cuenta eliminada)',
    creada: f.creada, total: Number(f.total), pendientes: Number(f.pendientes), cerradas: Number(f.cerradas), agotadas: Number(f.agotadas),
  }));
}

/** Cierra o cancela una lista que está dentro del alcance de `condicion`. Devuelve la lista, o null si no existe o no es suya (el mismo 404). */
async function cambiarEstadoLista(id, nuevo, condicion) {
  if (!['cerrada', 'cancelada'].includes(nuevo)) throw err(400, 'Una lista solo se puede cerrar o cancelar.');
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  const [[l]] = await pool.query(`SELECT l.id, l.nombre, l.estado FROM puerta_listas l WHERE l.id = ? AND ${condicion.sql}`, [n, ...condicion.valores]);
  if (!l) return null;
  if (l.estado !== 'activa') throw err(409, `Esa lista ya está ${l.estado === 'cerrada' ? 'cerrada' : 'cancelada'}.`);
  await pool.query('UPDATE puerta_listas SET estado = ?, cerrada_en = NOW() WHERE id = ?', [nuevo, n]);
  return { id: l.id, nombre: l.nombre };
}

/* ---------------------------------------------------------------------------------------------------- LA LISTA DEL CELULAR */

/**
 * LA LISTA MÍNIMA que baja al celular de quien visita. Por ítem, EXACTAMENTE estos campos (la prueba los compara con una lista cerrada):
 *   id, nombre, direccion, latitud, longitud, estado, intentos, ultimo_resultado, ultima_fecha, ultima_franja, reintento_desde
 * Nunca la cédula, el teléfono, el correo, `apoya_a`, las observaciones, el consentimiento, el barrio ni el id de la ficha. Y de una puerta que ya
 * quedó cerrada (con resultado final o agotada) NO viaja ni el nombre, ni la dirección, ni las coordenadas: solo que está cerrada.
 */
const CAMPOS_ITEM = ['id', 'nombre', 'direccion', 'latitud', 'longitud', 'estado', 'intentos', 'ultimo_resultado', 'ultima_fecha', 'ultima_franja', 'reintento_desde'];
const CAMPOS_LISTA = ['id', 'nombre', 'zona', 'total', 'pendientes', 'cerradas', 'agotadas', 'items'];
const CAMPOS_CONFIG = ['franja_desde', 'franja_hasta', 'fecha_eleccion', 'max_intentos', 'horas_copia', 'caduca_en'];

const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x));

/**
 * { bloqueo, listas, config } para quien visita. `usuario`: el de la sesión. Vuelve a validar TODO con su alcance: una ficha que ya no es suya
 * (cambió de líder), que retiró la autorización o que pidió no volver no sale, aunque siga en la tabla de ítems.
 * El día de la elección no devuelve listas.
 */
async function mias(usuario, ahora = new Date()) {
  const cfg = await leerConfig();
  const config = {
    franja_desde: cfg.desdeTexto, franja_hasta: cfg.hastaTexto, fecha_eleccion: cfg.fecha_eleccion, max_intentos: R.MAX_INTENTOS, horas_copia: R.HORAS_COPIA,
    caduca_en: new Date(ahora.getTime() + R.HORAS_COPIA * 3600 * 1000).toISOString(),
  };
  if (R.esDiaDeLaEleccion(cfg.fecha_eleccion, ahora)) {
    return { bloqueo: { codigo: 'dia_de_la_eleccion', mensaje: MENSAJE_DIA_DE_LA_ELECCION }, listas: [], config };
  }
  // Quien cambió de rama (ahora cuelga de un aspirante) ya no es de esta campaña: no se le sirve nada.
  if ((await ramaDe(usuario.id)) !== null) return { bloqueo: null, listas: [], config };

  const [listas] = await pool.query(`SELECT id, nombre, zona_texto FROM puerta_listas WHERE asignada_a = ? AND estado = 'activa' ORDER BY id`, [usuario.id]);
  if (!listas.length) return { bloqueo: null, listas: [], config };
  const a = alcanceDeUsuario(usuario);
  const [filas] = await pool.query(
    `SELECT i.id, i.lista_id, i.estado, i.intentos, i.ultimo_resultado, DATE_FORMAT(i.ultima_fecha, '%Y-%m-%d') AS ultima_fecha, i.ultima_franja,
            v.nombre, v.direccion, v.latitud, v.longitud
       FROM puerta_items i JOIN votantes v ON v.id = i.votante_id
      WHERE i.lista_id IN (?) AND ${condicionAlcanceVotantes(a, 'v')}
        AND v.rama_aspirante_id IS NULL AND v.consentimiento_autorizado = 1 AND v.no_visitar = 0
      ORDER BY i.id`, [listas.map((l) => l.id), ...parametrosAlcanceVotantes(a)]);
  const salida = listas.map((l) => ({ id: l.id, nombre: l.nombre, zona: l.zona_texto || null, total: 0, pendientes: 0, cerradas: 0, agotadas: 0, items: [] }));
  const porId = new Map(salida.map((l) => [l.id, l]));
  for (const f of filas) {
    const l = porId.get(f.lista_id);
    const abierta = f.estado === 'pendiente';
    l.total++;
    if (f.estado === 'pendiente') l.pendientes++; else if (f.estado === 'cerrada') l.cerradas++; else l.agotadas++;
    l.items.push({
      id: f.id,
      nombre: abierta ? f.nombre : null, direccion: abierta ? f.direccion : null,
      latitud: abierta ? num(f.latitud) : null, longitud: abierta ? num(f.longitud) : null,
      estado: f.estado, intentos: Number(f.intentos), ultimo_resultado: f.ultimo_resultado || null,
      ultima_fecha: f.ultima_fecha || null, ultima_franja: f.ultima_franja || null,
      reintento_desde: abierta && f.ultima_fecha ? R.reintentoDesde(f.ultima_fecha, f.ultima_franja) : null,
    });
  }
  return { bloqueo: null, listas: salida, config };
}

/* --------------------------------------------------------------------------------------------------------- LA VISITA */

/** El instante de la captura: el del toque en el celular, con ventana. Devuelve un Date o lanza un error. */
function capturaDe(marcado, ahora = new Date()) {
  const t = Date.parse(marcado);
  if (!Number.isFinite(t)) throw err(400, 'Falta la hora en que se tomó la visita (marcado_en).');
  if (t > ahora.getTime() + 5 * 60 * 1000) throw err(400, 'La hora de la visita está en el futuro. Revisa la hora de tu celular.');
  if (t < ahora.getTime() - VENTANA_CAPTURA_DIAS * 86400 * 1000) throw err(422, `Esta visita se tomó hace más de ${VENTANA_CAPTURA_DIAS} días y ya no se acepta.`);
  return new Date(t);
}

/**
 * Registra UNA visita. IDEMPOTENTE por `cliente_uuid`. `body`: { cliente_uuid, item_id, resultado, marcado_en, tampoco_mensajes? }.
 * Devuelve { id, duplicado, estado, reintento_desde } o lanza un error con `.estado` (HTTP) y `.mensaje`.
 * Todo se juzga con la hora de la CAPTURA (la del toque), no la de la subida: lo que se hace sin señal vale por el día y la hora en que se hizo.
 */
async function registrarVisita({ usuario, body, ahora = new Date() }) {
  const b = body || {};
  const uuid = String(b.cliente_uuid || '').trim().toLowerCase();
  if (!UUID.test(uuid)) throw err(400, 'Falta el identificador del registro (cliente_uuid).');
  const [[ya]] = await pool.query('SELECT id FROM puerta_visitas WHERE cliente_uuid = ?', [uuid]);
  if (ya) return { id: Number(ya.id), duplicado: true, estado: null, reintento_desde: null };

  const resultado = String(b.resultado || '');
  if (!R.RESULTADOS.includes(resultado)) throw err(400, 'Elige el resultado de la visita.');
  const itemId = Number(b.item_id);
  if (!Number.isInteger(itemId) || itemId < 1) throw err(400, 'Falta la puerta (item_id).');

  const captura = capturaDe(b.marcado_en, ahora);
  const cfg = await leerConfig();
  if (R.esDiaDeLaEleccion(cfg.fecha_eleccion, captura)) throw err(422, 'Esta visita se tomó el día de la elección y ese día no se hacen visitas: no se guarda.');
  const c = R.colombiaDe(captura);
  if (!R.enFranja(c.minutos, cfg.desde, cfg.hasta)) {
    throw err(422, `Esta visita se tomó fuera del horario permitido (de ${cfg.desdeTexto} a ${cfg.hastaTexto}): no se guarda.`);
  }
  const franja = R.franjaDe(c.minutos);
  const capturaTxt = R.textoColombia(captura);

  const nm = (m) => err(404, m || 'Esa puerta no está en tu lista.');
  const [[item0]] = await pool.query(
    `SELECT i.id, i.lista_id, i.votante_id, l.asignada_a, l.estado AS lista_estado, DATE_FORMAT(l.cerrada_en, '%Y-%m-%d %H:%i') AS cerrada_en
       FROM puerta_items i JOIN puerta_listas l ON l.id = i.lista_id WHERE i.id = ?`, [itemId]);
  if (!item0 || Number(item0.asignada_a) !== Number(usuario.id)) throw nm();
  if ((await ramaDe(usuario.id)) !== null) throw nm();
  if (item0.lista_estado === 'cancelada' || (item0.lista_estado === 'cerrada' && (!item0.cerrada_en || capturaTxt > item0.cerrada_en))) {
    throw err(409, 'Esa lista ya no está activa: se cerró antes de que se tomara esta visita.');
  }
  if (!item0.votante_id) throw err(409, 'Esa puerta ya no tiene a nadie asociado.');

  // La ficha, otra vez con el alcance de quien visita: si ya no es suya, o retiró la autorización, o pidió no volver, no se registra nada.
  const a = alcanceDeUsuario(usuario);
  const [[v]] = await pool.query(
    `SELECT v.id, v.territorio_id, v.no_visitar, v.consentimiento_autorizado FROM votantes v
      WHERE v.id = ? AND ${condicionAlcanceVotantes(a, 'v')} AND v.rama_aspirante_id IS NULL`, [item0.votante_id, ...parametrosAlcanceVotantes(a)]);
  if (!v) throw err(409, 'Esa persona ya no está en tu lista.');
  if (Number(v.no_visitar) === 1) throw err(409, 'Esa persona pidió que no la visiten más.');
  if (Number(v.consentimiento_autorizado) !== 1) throw err(409, 'Esa persona ya no tiene la autorización vigente.');

  // «Tampoco quiere mensajes»: la baja se aplica ANTES de guardar la visita. Si algo falla después, la persona ya quedó protegida (y el reintento no
  // pisa la baja: aplicarBajaDeFicha conserva la primera). Al revés, una visita guardada sin la baja sería no respetar lo que la persona pidió.
  const tampocoMensajes = resultado === 'no_volver' && (b.tampoco_mensajes === true || b.tampoco_mensajes === 1 || b.tampoco_mensajes === '1' || b.tampoco_mensajes === 'true');
  if (tampocoMensajes) {
    await aplicarBajaDeFicha(pool, 'votantes', v.id, { origen: 'puerta_a_puerta', canal: 'en_persona', motivo: 'Lo pidió en una visita (puerta a puerta)' });
  }

  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    const [[item]] = await cx.query('SELECT estado, intentos, ultima_fecha, ultima_franja FROM puerta_items WHERE id = ? FOR UPDATE', [itemId]);
    if (item.estado !== 'pendiente') { await cx.rollback(); throw err(409, 'Esa puerta ya tiene un resultado.'); }
    if (item.ultima_fecha && !R.puedeReintentar(String(item.ultima_fecha).slice(0, 10), item.ultima_franja, captura)) {
      await cx.rollback();
      throw err(409, `Todavía no: a esa puerta se puede volver a tocar desde ${R.reintentoDesde(String(item.ultima_fecha).slice(0, 10), item.ultima_franja)}.`);
    }
    const intentos = Number(item.intentos) + (resultado === 'no_abrio' ? 1 : 0);
    const nuevoEstado = resultado === 'no_abrio' ? (intentos >= R.MAX_INTENTOS ? 'agotada' : 'pendiente') : 'cerrada';
    const [r] = await cx.query(
      `INSERT INTO puerta_visitas (cliente_uuid, item_id, lista_id, resultado, fecha, franja, territorio_id, registrada_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid, itemId, item0.lista_id, resultado, c.fecha, franja, v.territorio_id || null, usuario.id]);
    await cx.query(
      'UPDATE puerta_items SET estado = ?, intentos = ?, ultimo_resultado = ?, ultima_fecha = ?, ultima_franja = ? WHERE id = ?',
      [nuevoEstado, intentos, resultado, c.fecha, franja, itemId]);
    if (resultado === 'no_volver') {
      // `updated_at = updated_at` evita que la marca de tiempo automática de la ficha guarde la HORA exacta de la visita.
      await cx.query('UPDATE votantes SET no_visitar = 1, no_visitar_fecha = ?, updated_at = updated_at WHERE id = ?', [c.fecha, v.id]);
    }
    await cx.commit();
    return { id: Number(r.insertId), duplicado: false, estado: nuevoEstado, reintento_desde: nuevoEstado === 'pendiente' ? R.reintentoDesde(c.fecha, franja) : null };
  } catch (e) {
    try { await cx.rollback(); } catch (_) { /* ya cerrada */ }
    if (e && e.code === 'ER_DUP_ENTRY') {                                // dos reintentos a la vez: gana uno, el otro devuelve el mismo
      const [[otra]] = await pool.query('SELECT id FROM puerta_visitas WHERE cliente_uuid = ?', [uuid]);
      if (otra) return { id: Number(otra.id), duplicado: true, estado: null, reintento_desde: null };
    }
    throw e;
  } finally { cx.release(); }
}

/* ------------------------------------------------------------------------------------------------- VOLVER A PERMITIR VISITAS */

/**
 * «Volver a permitir visitas»: quita la marca `no_visitar` de una ficha. SOLO el administrador (lo exige la ruta), con motivo y fecha obligatorios, y
 * queda en la auditoría. NO toca `no_contactar`: son dos marcas distintas y la otra se quita (si se quita) por su propio camino.
 * `datos`: { motivo, fecha_pedido: 'YYYY-MM-DD' (el día en que el ciudadano lo pidió) }. `alcance`: el de quien lo hace.
 * Devuelve { desde } (el día en que había pedido no volver) o lanza un error con `.estado`.
 */
async function permitirVisitas({ votanteId, datos, alcance, ahora = new Date() }) {
  const id = Number(votanteId);
  if (!Number.isInteger(id) || id < 1) throw err(404, 'Esa ficha no existe.');
  const d = datos || {};
  const motivo = limpiarTexto(d.motivo, 255);
  if (motivo.length < 5) throw err(400, 'Escribe el motivo (al menos 5 letras), por ejemplo: «el ciudadano lo pidió».');
  const fecha = String(d.fecha_pedido || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || R.sumarDias(fecha, 0) !== fecha) throw err(400, 'Escribe la fecha en que el ciudadano lo pidió.');
  if (fecha > R.colombiaDe(ahora).fecha) throw err(400, 'La fecha en que el ciudadano lo pidió no puede ser futura.');
  const [[v]] = await pool.query(
    `SELECT v.id, v.no_visitar, DATE_FORMAT(v.no_visitar_fecha, '%Y-%m-%d') AS desde FROM votantes v WHERE v.id = ? AND ${condicionAlcanceVotantes(alcance, 'v')}`,
    [id, ...parametrosAlcanceVotantes(alcance)]);
  if (!v) throw err(404, 'Esa ficha no existe o no es de tu campaña.');
  if (Number(v.no_visitar) !== 1) throw err(409, 'Esa persona no tiene la marca de «pidió no volver».');
  if (v.desde && fecha < v.desde) throw err(400, `La fecha no puede ser anterior al ${v.desde}, cuando pidió no volver.`);
  const [r] = await pool.query('UPDATE votantes SET no_visitar = 0, no_visitar_fecha = NULL WHERE id = ? AND no_visitar = 1', [id]);
  if (!r.affectedRows) throw err(409, 'Esa persona ya no tiene la marca de «pidió no volver».');
  return { desde: v.desde || null, motivo, fecha_pedido: fecha };
}

/** ¿La política de privacidad vigente ya menciona la visita domiciliaria? Para el aviso de Administración. */
async function estadoPolitica() {
  const { FRASE_POLITICA_VISITAS, PARRAFO_POLITICA_VISITAS } = require('../config/politicaVisitas');
  const [[p]] = await pool.query(`SELECT contenido, actualizado_por FROM contenido_paginas WHERE clave = 'politica_privacidad'`);
  const contenido = (p && p.contenido) || '';
  return { incluye: contenido.includes(FRASE_POLITICA_VISITAS), editada: !!(p && p.actualizado_por), existe: !!(p && contenido), parrafo: PARRAFO_POLITICA_VISITAS };
}

/* ----------------------------------------------------------------------------------------------------------- RETENCIÓN */

/**
 * Corta el vínculo entre cada visita y la persona visitada `anonimizar_solicitudes_meses` meses DESPUÉS de la fecha de la elección (el mismo plazo
 * que las solicitudes, las fotos de las tareas y los textos de las encuestas). Sin fecha de elección, o antes del plazo, no toca nada.
 * Se conservan los resultados, las fechas, las franjas y la zona: sin persona detrás no identifican a nadie. `aplicar: false` solo cuenta.
 * Devuelve { aplicado, motivo, desde, vencen, anonimizados }.
 */
async function anonimizarVencidas({ aplicar = false } = {}) {
  const cfg = await require('./solicitudes').estadoDelPlazo();
  if (!cfg || !cfg.eleccion) return { aplicado: false, motivo: 'No hay fecha de elección en la configuración: no se anonimiza nada.', vencen: 0, anonimizados: 0 };
  if (!Number(cfg.vencido)) return { aplicado: false, motivo: `Todavía no: se anonimiza desde el ${cfg.desde} (${cfg.meses} meses después de la elección del ${cfg.eleccion}).`, desde: cfg.desde, vencen: 0, anonimizados: 0 };
  const [[p]] = await pool.query('SELECT COUNT(*) AS n FROM puerta_items WHERE votante_id IS NOT NULL');
  const vencen = Number(p.n);
  if (!aplicar) return { aplicado: false, motivo: 'Simulación: no se borró nada.', desde: cfg.desde, vencen, anonimizados: 0 };
  const [r] = await pool.query('UPDATE puerta_items SET votante_id = NULL, anonimizado_en = NOW() WHERE votante_id IS NOT NULL');
  return { aplicado: true, motivo: 'Aplicado.', desde: cfg.desde, vencen, anonimizados: r.affectedRows };
}

module.exports = {
  ROLES_QUE_VISITAN, MENSAJE_DIA_DE_LA_ELECCION, CAMPOS_ITEM, CAMPOS_LISTA, CAMPOS_CONFIG, VENTANA_CAPTURA_DIAS,
  permisosDe, leerConfig, guardarFranja, alcanceDeUsuario, asignadoValido, armarLista, listasDe, cambiarEstadoLista, mias, capturaDe, registrarVisita, permitirVisitas, estadoPolitica, anonimizarVencidas,
};
