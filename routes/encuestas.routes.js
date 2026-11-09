/**
 * ENCUESTAS INTERNAS: las rutas (parche 307, Fases 1 y 2). La regla vive en lib/encuestas.js, las reglas electorales en
 * lib/encuestasReglas.js y la zona en lib/zonas.js. DOS módulos de la matriz, los dos APAGADOS de fábrica (solo el administrador):
 *
 *   `encuestas` ......... construir (Ver la lista y el detalle · Agregar crear y duplicar · Editar guardar, publicar, cerrar y eliminar)
 *   `encuestas_campo` ... aplicar en campo (Ver las encuestas publicadas en el celular · Agregar enviar respuestas)
 *
 * Quien APLICA no ve resultados —ni siquiera los suyos— y quien construye no necesita aplicar: separados para que quien mira cómo van las
 * cifras no sea quien las produce. Los resultados (agregados por zona, con mínimo por celda) llegan en la siguiente fase.
 *
 *   GET    /                         la lista de encuestas, con su estado y cuántas respuestas lleva (cifra total, nunca una respuesta)   [encuestas · Ver]
 *   POST   /                         crear un borrador                                                                                      [encuestas · Agregar]
 *   GET    /:id                      el detalle, con sus preguntas                                                                          [encuestas · Ver]
 *   PUT    /:id                      guardar el borrador (reemplaza sus preguntas). Una encuesta publicada NO se edita: 409                [encuestas · Editar]
 *   POST   /:id/publicar             congelar la versión (huella) y dejarla disponible en campo                                              [encuestas · Editar]
 *   POST   /:id/cerrar               dejar de recibir respuestas (lo capturado antes de cerrar se acepta aunque suba después)                [encuestas · Editar]
 *   POST   /:id/duplicar             una copia como borrador nuevo (de cualquier estado)                                                    [encuestas · Agregar]
 *   DELETE /:id                      eliminar un borrador                                                                                   [encuestas · Editar]
 *   GET    /campo                    las encuestas publicadas, con su contenido congelado, para el celular (y su copia sin señal)            [encuestas_campo · Ver]
 *   GET    /campo/zonas-lista        las zonas para elegir, con la degradación zona → municipio → texto (lib/zonas.js)                      [encuestas_campo · Ver]
 *   POST   /campo/responder          UNA respuesta, anónima. Idempotente por cliente_uuid                                                    [encuestas_campo · Agregar]
 *
 * Se exigen AQUÍ, en el servidor (el administrador y el superadministrador pasan siempre). Un aspirante con sublicencia no llega: la ruta no
 * está en la lista de lo que puede alcanzar (middleware/aspirante.js).
 */
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { registrarAuditoria } = require('../config/auditoria');
const E = require('../lib/encuestas');
const Reglas = require('../lib/encuestasReglas');
const Z = require('../lib/zonas');

const router = express.Router();
router.use(requireAuth);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const NOMBRE_MODULO = { encuestas: 'las encuestas', encuestas_campo: 'aplicar encuestas' };

/** Exige un nivel de la matriz en un módulo y deja `req.permisos` listo. */
const exigir = (modulo, nivel) => async (req, res, next) => {
  const p = await E.permisosDe(req.session.usuario, modulo);
  req.permisos = p;
  if (!p.ver) return res.status(403).json({ error: `Su tipo de usuario no tiene acceso a ${NOMBRE_MODULO[modulo]}. Si lo necesita, pídaselo al administrador de la campaña.` });
  if (nivel === 'agregar' && !p.agregar) return res.status(403).json({ error: `Su tipo de usuario puede ver ${NOMBRE_MODULO[modulo]} pero no agregar.` });
  if (nivel === 'editar' && !p.editar) return res.status(403).json({ error: `Su tipo de usuario puede ver ${NOMBRE_MODULO[modulo]} pero no cambiarlas.` });
  next();
};

const responder = (res, e) => {
  if (e && e.estado) return res.status(e.estado).json({ error: e.mensaje || e.message, ...(e.errores ? { errores: e.errores } : {}) });
  console.error('[encuestas]', e && (e.code || e.message));          // sin la sentencia: lleva datos
  return res.status(500).json({ error: 'No se pudo completar la operación.' });
};

const idDe = (req) => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };
const json = express.json({ limit: '300kb' });

/* ------------------------------------------------------------------------------------------------------------ CAMPO */
// Van ANTES de `/:id`: «campo» no es un id.

router.get('/campo', exigir('encuestas_campo', 'ver'), async (req, res) => {
  try { res.json(await E.paraCampo()); } catch (e) { responder(res, e); }
});

router.get('/campo/zonas-lista', exigir('encuestas_campo', 'ver'), async (req, res) => {
  try { res.json(await Z.listaDeZonas()); } catch (e) { responder(res, e); }
});

router.post('/campo/responder', exigir('encuestas_campo', 'agregar'), json, async (req, res) => {
  try {
    const r = await E.registrarRespuesta({ usuario: req.session.usuario, body: req.body });
    // La respuesta no devuelve nada de lo respondido: el celular ya lo tiene y la respuesta no tiene por qué llevarlo.
    res.status(r.duplicado ? 200 : 201).json({ ok: true, id: r.id, duplicado: r.duplicado });
  } catch (e) { responder(res, e); }
});

/* -------------------------------------------------------------------------------------------------------- CONSTRUCTOR */

router.get('/', exigir('encuestas', 'ver'), async (req, res) => {
  try { res.json({ encuestas: await E.listar(), permisos: req.permisos, tipos: E.TIPOS, nsnr: E.NSNR }); } catch (e) { responder(res, e); }
});

/** Guarda lo que llegó (crea con id null, reemplaza con id) y devuelve el id y lo que todavía impediría publicar. */
async function guardar(req, res, id) {
  const { errores, datos } = E.normalizarBorrador(req.body);
  if (errores.length) return res.status(400).json({ error: errores[0], errores });
  const nuevoId = await E.guardarBorrador(id, datos, req.session.usuario);
  const problemas = E.revisarSemantica(datos, await Reglas.leerConfig());
  await registrarAuditoria(req.session.usuario.id, id ? 'encuesta_editar' : 'encuesta_crear', 'encuestas', nuevoId,
    `${id ? 'Guardó' : 'Creó'} el borrador de la encuesta «${datos.titulo}» (${datos.preguntas.length} pregunta(s)).`, req.ip);
  return res.status(id ? 200 : 201).json({ ok: true, id: nuevoId, problemas });
}

router.post('/', exigir('encuestas', 'agregar'), json, async (req, res) => {
  try { await guardar(req, res, null); } catch (e) { responder(res, e); }
});

router.get('/:id', exigir('encuestas', 'ver'), async (req, res) => {
  try {
    const id = idDe(req);
    const d = id ? await E.detalle(id) : null;
    if (!d) return res.status(404).json({ error: 'Esa encuesta no existe.' });
    d.problemas = d.editable ? E.revisarSemantica({ titulo: d.titulo, descripcion: d.descripcion, preguntas: d.preguntas }, await Reglas.leerConfig()) : [];
    res.json({ ...d, permisos: req.permisos, tipos: E.TIPOS, nsnr: E.NSNR });
  } catch (e) { responder(res, e); }
});

router.put('/:id', exigir('encuestas', 'editar'), json, async (req, res) => {
  try {
    const id = idDe(req);
    if (!id) return res.status(404).json({ error: 'Esa encuesta no existe.' });
    await guardar(req, res, id);
  } catch (e) { responder(res, e); }
});

router.post('/:id/publicar', exigir('encuestas', 'editar'), async (req, res) => {
  try {
    const id = idDe(req);
    if (!id) return res.status(404).json({ error: 'Esa encuesta no existe.' });
    const r = await E.publicar(id, req.session.usuario);
    await registrarAuditoria(req.session.usuario.id, 'encuesta_publicar', 'encuestas', id, `Publicó la encuesta n.º ${id}; versión congelada ${r.huella}.`, req.ip);
    res.json({ ok: true, id, huella: r.huella });
  } catch (e) { responder(res, e); }
});

router.post('/:id/cerrar', exigir('encuestas', 'editar'), async (req, res) => {
  try {
    const id = idDe(req);
    if (!id) return res.status(404).json({ error: 'Esa encuesta no existe.' });
    await E.cerrar(id, req.session.usuario);
    await registrarAuditoria(req.session.usuario.id, 'encuesta_cerrar', 'encuestas', id, `Cerró la encuesta n.º ${id}.`, req.ip);
    res.json({ ok: true, id });
  } catch (e) { responder(res, e); }
});

router.post('/:id/duplicar', exigir('encuestas', 'agregar'), async (req, res) => {
  try {
    const id = idDe(req);
    if (!id) return res.status(404).json({ error: 'Esa encuesta no existe.' });
    const r = await E.duplicar(id, req.session.usuario);
    await registrarAuditoria(req.session.usuario.id, 'encuesta_duplicar', 'encuestas', r.id, `Duplicó la encuesta n.º ${id} como el borrador n.º ${r.id}.`, req.ip);
    res.status(201).json({ ok: true, id: r.id });
  } catch (e) { responder(res, e); }
});

router.delete('/:id', exigir('encuestas', 'editar'), async (req, res) => {
  try {
    const id = idDe(req);
    if (!id) return res.status(404).json({ error: 'Esa encuesta no existe.' });
    await E.eliminar(id);
    await registrarAuditoria(req.session.usuario.id, 'encuesta_eliminar', 'encuestas', id, `Eliminó el borrador n.º ${id}.`, req.ip);
    res.json({ ok: true, id });
  } catch (e) { responder(res, e); }
});

module.exports = router;
