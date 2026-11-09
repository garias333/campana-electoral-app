/**
 * PUERTA A PUERTA: las rutas (parche 309, Fases 0 y 1). La regla vive en lib/puertaAPuerta.js; las reglas que también corren en el celular, en
 * public/js/puerta-reglas.js. DOS módulos de la matriz, los dos APAGADOS de fábrica (solo el administrador):
 *
 *   `puerta_listas` ..... armar las listas (Ver las listas y sus conteos · Agregar armar y asignar · Editar cerrar y cancelar)
 *   `puerta_visitas` .... visitar en el celular (Ver bajar la lista · Agregar enviar el resultado de cada puerta)
 *
 * Quien arma NO ve nombres ni direcciones —solo conteos—, y quien visita solo recibe SU lista. Separados a propósito.
 *
 *   GET  /config               la franja horaria permitida                                                           [puerta_listas · Ver]
 *   PUT  /config               cambiar la franja (entre 07:00 y 19:00). Solo el administrador; auditado                [puerta_listas · Editar]
 *   GET  /zonas                las zonas para elegir, con la degradación zona → municipio → texto (lib/zonas.js)       [puerta_listas · Ver]
 *   GET  /responsables         a quién se le puede asignar una lista (líder o sublíder activo de la campaña madre)     [puerta_listas · Agregar]
 *   GET  /listas               las listas que quien pregunta puede ver, SOLO con conteos                               [puerta_listas · Ver]
 *   POST /listas               armar y asignar una lista; filtra con el alcance de quien VISITA; auditado             [puerta_listas · Agregar]
 *   POST /listas/:id/cerrar · /cancelar                                                                              [puerta_listas · Editar]
 *   GET  /politica             ¿la política ya menciona la visita domiciliaria? Solo el administrador                       [administrador]
 *   POST /votantes/:id/permitir-visitas   «Volver a permitir visitas»: motivo y fecha obligatorios, auditado, sin tocar no_contactar   [administrador]
 *   GET  /mapa-config          la fuente del fondo del mapa (token público de Mapbox, o null = OpenStreetMap)                [puerta_visitas · Ver]
 *   GET  /mias                 MI lista, mínima, para el celular. Sin señal, el día de la elección: sin listas; auditada  [puerta_visitas · Ver]
 *   POST /visitas              el resultado de UNA puerta. Idempotente por cliente_uuid                               [puerta_visitas · Agregar]
 *
 * Se exigen AQUÍ, en el servidor (el administrador y el superadministrador pasan siempre). Un aspirante con sublicencia no llega: la ruta no está
 * en la lista de lo que puede alcanzar (middleware/aspirante.js), y aquí además se le cierra por si alguien la agregara a esa lista por error.
 */
'use strict';

const express = require('express');
const pool = require('../config/db');
const { requireAuth, calcularAlcance } = require('../middleware/auth');
const { registrarAuditoria } = require('../config/auditoria');
const { alcanceTareas, asignablesPara } = require('../lib/alcanceTareas');
const P = require('../lib/puertaAPuerta');
const R = require('../public/js/puerta-reglas');
const Z = require('../lib/zonas');

const router = express.Router();
router.use(requireAuth, calcularAlcance);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use((req, res, next) => {
  if (req.sublicencia) return res.status(403).json({ error: 'El puerta a puerta todavía no está disponible para las campañas de un aspirante.' });
  next();
});

const NOMBRE_MODULO = { puerta_listas: 'armar listas de puerta a puerta', puerta_visitas: 'las visitas de puerta a puerta' };

/** Exige un nivel de la matriz en un módulo y deja `req.permisos` listo. */
const exigir = (modulo, nivel) => async (req, res, next) => {
  const p = await P.permisosDe(req.session.usuario, modulo);
  req.permisos = p;
  if (!p.ver) return res.status(403).json({ error: `Su tipo de usuario no tiene acceso a ${NOMBRE_MODULO[modulo]}. Si lo necesita, pídaselo al administrador de la campaña.` });
  if (nivel === 'agregar' && !p.agregar) return res.status(403).json({ error: `Su tipo de usuario puede ver ${NOMBRE_MODULO[modulo]} pero no agregar.` });
  if (nivel === 'editar' && !p.editar) return res.status(403).json({ error: `Su tipo de usuario puede ver ${NOMBRE_MODULO[modulo]} pero no cambiarlas.` });
  next();
};
const soloAdmin = (req, res, next) => (req.session.usuario.rol === 'admin' ? next() : res.status(403).json({ error: 'Esto es solo del administrador.' }));

const responder = (res, e) => {
  if (e && e.estado) return res.status(e.estado).json({ error: e.mensaje || e.message, ...(e.omitidas ? { omitidas: e.omitidas, en_alcance: e.en_alcance } : {}) });
  console.error('[puerta a puerta]', e && (e.code || e.message));          // sin la sentencia: lleva datos
  return res.status(500).json({ error: 'No se pudo completar la operación.' });
};
const json = express.json({ limit: '20kb' });

/* ------------------------------------------------------------------------------------------------------ QUIEN ARMA */

router.get('/config', exigir('puerta_listas', 'ver'), async (req, res) => {
  try {
    const c = await P.leerConfig();
    res.json({ franja_desde: c.desdeTexto, franja_hasta: c.hastaTexto, minimo: R.FRANJA_MINIMA, maximo: R.FRANJA_MAXIMA,
      max_intentos: R.MAX_INTENTOS, horas_entre_intentos: R.HORAS_ENTRE_INTENTOS, dias_sin_reasignar: R.DIAS_SIN_REASIGNAR, horas_copia: R.HORAS_COPIA, max_personas: R.MAX_ITEMS_LISTA });
  } catch (e) { responder(res, e); }
});

router.put('/config', exigir('puerta_listas', 'editar'), soloAdmin, json, async (req, res) => {
  try {
    const antes = await P.leerConfig();
    const ahora = await P.guardarFranja(req.body && req.body.franja_desde, req.body && req.body.franja_hasta);
    if (antes.desdeTexto !== ahora.desde || antes.hastaTexto !== ahora.hasta) {
      await registrarAuditoria(req.session.usuario.id, 'puerta_config', 'configuracion_campana', 1,
        `Franja de visitas del puerta a puerta: de ${antes.desdeTexto} a ${antes.hastaTexto} → de ${ahora.desde} a ${ahora.hasta}.`, req.ip);
    }
    res.json({ ok: true, franja_desde: ahora.desde, franja_hasta: ahora.hasta });
  } catch (e) { responder(res, e); }
});

router.get('/zonas', exigir('puerta_listas', 'ver'), async (req, res) => {
  try { res.json(await Z.listaDeZonas()); } catch (e) { responder(res, e); }
});

router.get('/responsables', exigir('puerta_listas', 'agregar'), async (req, res) => {
  try {
    const as = asignablesPara(req.alcance);
    if (!as) return res.json({ responsables: [] });
    const [filas] = await pool.query(
      `SELECT u.id, u.nombre, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.activo = 1 AND r.nombre IN (?) AND ${as.sql} ORDER BY u.nombre LIMIT 500`, [P.ROLES_QUE_VISITAN, ...as.valores]);
    // Solo de la campaña madre: quien cuelga de un aspirante es de otra rama y no se ofrece (el servidor lo rechazaría al armar).
    res.json({ responsables: await require('../lib/tareas').soloMismaRama(req.session.usuario.id, filas) });
  } catch (e) { responder(res, e); }
});

router.get('/listas', exigir('puerta_listas', 'ver'), async (req, res) => {
  try { res.json({ listas: await P.listasDe(alcanceTareas(req.alcance, 'l')) }); } catch (e) { responder(res, e); }
});

router.post('/listas', exigir('puerta_listas', 'agregar'), json, async (req, res) => {
  try {
    const asignables = asignablesPara(req.alcance);
    const r = await P.armarLista({ datos: req.body, usuario: req.session.usuario, alcanceQuienArma: req.alcance, asignables });
    if (!r.duplicado) {
      await registrarAuditoria(req.session.usuario.id, 'puerta_lista_armar', 'puerta_listas', r.id,
        `Armó la lista n.º ${r.id} con ${r.personas} persona(s) para ${r.asignado.nombre} (id ${r.asignado.id})${r.sin_cupo ? `; ${r.sin_cupo} quedaron fuera por el tope de ${R.MAX_ITEMS_LISTA}` : ''}.`, req.ip);
    }
    res.status(r.duplicado ? 200 : 201).json({ ok: true, id: r.id, duplicado: r.duplicado, personas: r.personas, omitidas: r.omitidas, sin_cupo: r.sin_cupo });
  } catch (e) { responder(res, e); }
});

for (const [accion, estado, verbo] of [['cerrar', 'cerrada', 'Cerró'], ['cancelar', 'cancelada', 'Canceló']]) {
  router.post(`/listas/:id/${accion}`, exigir('puerta_listas', 'editar'), async (req, res) => {
    try {
      const l = await P.cambiarEstadoLista(req.params.id, estado, alcanceTareas(req.alcance, 'l'));
      if (!l) return res.status(404).json({ error: 'Esa lista no existe o no es de tu equipo.' });
      await registrarAuditoria(req.session.usuario.id, `puerta_lista_${accion}`, 'puerta_listas', l.id, `${verbo} la lista n.º ${l.id}.`, req.ip);
      res.json({ ok: true });
    } catch (e) { responder(res, e); }
  });
}

/* ------------------------------------------------------------------------------------------ SOLO EL ADMINISTRADOR */

/** ¿La política ya menciona la visita domiciliaria? Para el aviso de Administración y de esta pantalla. No pide el módulo: es del administrador. */
router.get('/politica', soloAdmin, async (req, res) => {
  try { res.json(await P.estadoPolitica()); } catch (e) { responder(res, e); }
});

/** «Volver a permitir visitas» en la ficha del votante. Motivo y fecha obligatorios, auditado, y no toca `no_contactar`. */
router.post('/votantes/:id/permitir-visitas', soloAdmin, json, async (req, res) => {
  try {
    const r = await P.permitirVisitas({ votanteId: req.params.id, datos: req.body, alcance: req.alcance });
    await registrarAuditoria(req.session.usuario.id, 'votante_permitir_visitas', 'votantes', Number(req.params.id),
      `Volvió a permitir visitas a la ficha n.º ${Number(req.params.id)} (había pedido no volver${r.desde ? ' el ' + r.desde : ''}). El ciudadano lo pidió el ${r.fecha_pedido}. Motivo: ${r.motivo}`, req.ip);
    res.json({ ok: true });
  } catch (e) { responder(res, e); }
});

/* ---------------------------------------------------------------------------------------------------- QUIEN VISITA */

/** La fuente del fondo del mapa: el token PÚBLICO de Mapbox (el mismo del mapa territorial), o null y entonces OpenStreetMap. Es público por diseño de Mapbox
    —se restringe por dominio en su panel—, no un secreto. Es lo único que el mapa de la lista le pide al servidor además de la lista misma. */
router.get('/mapa-config', exigir('puerta_visitas', 'ver'), (req, res) => {
  res.json({ mapbox_token: process.env.MAPBOX_ACCESS_TOKEN || null });
});

router.get('/mias', exigir('puerta_visitas', 'ver'), async (req, res) => {
  try {
    const r = await P.mias(req.session.usuario);
    const personas = r.listas.reduce((s, l) => s + l.items.length, 0);
    // Cada bajada de la lista al celular queda en la auditoría, con cuántas listas y personas (nunca quiénes).
    if (r.listas.length) {
      await registrarAuditoria(req.session.usuario.id, 'puerta_lista_descarga', 'puerta_listas', null,
        `Bajó al celular ${r.listas.length} lista(s) con ${personas} persona(s).`, req.ip);
    }
    res.json(r);
  } catch (e) { responder(res, e); }
});

router.post('/visitas', exigir('puerta_visitas', 'agregar'), json, async (req, res) => {
  try {
    const r = await P.registrarVisita({ usuario: req.session.usuario, body: req.body });
    // La respuesta no repite lo que se registró: solo el estado en que quedó la puerta.
    res.status(r.duplicado ? 200 : 201).json({ ok: true, id: r.id, duplicado: r.duplicado, estado: r.estado, reintento_desde: r.reintento_desde });
  } catch (e) { responder(res, e); }
});

module.exports = router;
