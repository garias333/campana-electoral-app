/**
 * Las rutas de la API (con sesión) de la AUTORIZACIÓN DE DATOS por enlace, escritas UNA vez y montadas en dos routers:
 * /api/votantes/:id/autorizacion/… y /api/territorial/estructura/:id/autorizacion/… (parche 325). La página pública del enlace es
 * routes/autorizacion.routes.js; la lógica, config/autorizacionDatos.js.
 *
 *   GET  …/:id/autorizacion             el estado: sin | pendiente | vencida | firmada | verbal
 *   POST …/:id/autorizacion/enlace      crea el enlace (anula el pendiente anterior) y devuelve el mensaje de WhatsApp listo
 *   GET  …/:id/autorizacion/constancia  la constancia imprimible — SOLO administrador y coordinador
 *
 * `buscarPersona(req, id)` la pone cada router: es quien sabe de qué alcance es la persona (un líder ve a los suyos; un aspirante, a su
 * rama). Devuelve null si no existe o no es de quien pregunta, y la ruta responde 404.
 */
'use strict';

const A = require('../config/autorizacionDatos');
const { nombreDeLaCampana } = require('../config/politicaPublica');

function montarRutasAutorizacion(router, { tipo, roles, buscarPersona, requireRole, prefijo = '' }) {
  const base = prefijo + '/:id(\\d+)/autorizacion';

  router.get(base, requireRole(...roles), async (req, res) => {
    try {
      const p = await buscarPersona(req, req.params.id);
      if (!p) return res.status(404).json({ error: 'Esa persona no existe.' });
      res.json(await A.estadoDePersona(tipo, p.id));
    } catch (err) {
      console.error('autorizacion estado:', err.code || err.message);
      res.status(500).json({ error: 'No se pudo consultar la autorización.' });
    }
  });

  router.post(base + '/enlace', requireRole(...roles), async (req, res) => {
    try {
      const p = await buscarPersona(req, req.params.id);
      if (!p) return res.status(404).json({ error: 'Esa persona no existe.' });
      const estado = await A.estadoDePersona(tipo, p.id);
      if (estado.estado === 'firmada') {
        return res.status(409).json({ error: 'Esa persona ya firmó su autorización.', estado });
      }
      const canal = req.body && req.body.canal === 'copiado' ? 'copiado' : 'whatsapp';
      const { enlace, expira } = await A.crearEnlace({ req, tipo, personaId: p.id, usuario: req.session.usuario, canal });
      const campana = await nombreDeLaCampana(p.rama);
      res.json({
        ok: true, enlace, expira_en: expira,
        mensaje: A.mensajeWhatsapp({ nombre: p.nombre, campana, enlace }),
        estado: await A.estadoDePersona(tipo, p.id),
      });
    } catch (err) {
      console.error('autorizacion enlace:', err.code || err.message);
      res.status(500).json({ error: 'No se pudo crear el enlace.' });
    }
  });

  router.get(base + '/constancia', requireRole('admin', 'coordinador'), async (req, res) => {
    try {
      const p = await buscarPersona(req, req.params.id);
      if (!p) return res.status(404).json({ error: 'Esa persona no existe.' });
      const html = await A.constanciaHtml(tipo, p.id);
      if (!html) return res.status(404).json({ error: 'Esa persona no tiene una autorización registrada.' });
      res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
      res.send(html);
    } catch (err) {
      console.error('autorizacion constancia:', err.code || err.message);
      res.status(500).json({ error: 'No se pudo armar la constancia.' });
    }
  });
}

module.exports = { montarRutasAutorizacion };
