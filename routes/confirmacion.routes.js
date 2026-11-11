/**
 * routes/confirmacion.routes.js — La página pública de doble confirmación.
 *
 * Va montada ANTES del candado de licencia y sin sesión, por lo mismo que la
 * baja: quien recibe el enlace no tiene cuenta aquí, y confirmar o no su
 * autorización no puede depender de que la campaña tenga la licencia al día.
 *
 * CONFIRMAR ES UN POST, NUNCA UN GET. Los clientes de correo y algunos
 * operadores abren los enlaces por su cuenta para previsualizarlos: con la
 * confirmación en el GET, media lista quedaría "confirmada" sin que nadie
 * tocara nada — y sería una evidencia falsa, que es peor que no tener ninguna.
 * El GET muestra un botón; el POST es el que registra.
 *
 * NO SE MUESTRA NI EL NOMBRE NI LA CÉDULA, igual que en la página de baja: la
 * URL viaja por SMS y puede acabar reenviada o en el historial de un teléfono
 * prestado. Confirmar que un número pertenece a «Fulano de Tal» es más
 * información de la que hace falta para lo que se viene a hacer aquí.
 */
'use strict';

const express = require('express');
const { buscarVigente, buscarParaBaja, confirmar } = require('../config/confirmacionConsentimiento');
const { aplicarBajaDeFicha } = require('../config/bajaContacto');
const { confirmacionDeBaja, ANTES, LISTO } = require('../config/paginaBaja');
const pool = require('../config/db');

const router = express.Router();

function pagina({ titulo, cuerpo, boton, ok, extra }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${titulo}</title>
<link rel="stylesheet" href="/app/estilos-app.css">
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background: var(--fondo, #f4f6fb); color: var(--texto, #1b2333); margin: 0;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
  .caja { background: #fff; border-radius: var(--radio, 18px); padding: 30px 26px; max-width: 420px; width: 100%;
          box-shadow: var(--sombra-flot, 0 8px 24px rgba(8,66,152,.13)); text-align: center; }
  h1 { font-size: 1.25rem; color: var(--marca-azul-osc, #084298); font-weight: 800; margin: 0 0 12px; }
  p { font-size: 1rem; line-height: 1.55; color: var(--texto-2, #6a7590); margin: 0 0 18px; }
  button { display: flex; align-items: center; justify-content: center; background: var(--marca-amarillo, #FFC300); color: #1b2333; border: 0; border-radius: 999px;
           font-size: 16.5px; font-weight: 800; min-height: 54px; padding: 12px 26px; cursor: pointer; width: 100%;
           box-shadow: 0 8px 20px rgba(255,195,0,.4); font-family: inherit; }
  button:disabled { opacity: .6; box-shadow: none; }
  .ok { color: var(--ok, #1e6b2e); font-weight: 700; }
  a.baja { display: block; margin-top: 22px; color: var(--texto-2, #6a7590); font-size: 0.9rem; text-decoration: underline; padding: 8px; }
</style></head><body><div class="caja">
<h1>${titulo}</h1><p${ok ? ' class="ok"' : ''}>${cuerpo}</p>${boton || ''}${extra || ''}
</div></body></html>`;
}

const NO_VALIDO = {
  titulo: 'Enlace no válido',
  cuerpo: 'Este enlace no es válido o ya venció. Si quiere confirmar su autorización, pídale a la campaña que le envíe uno nuevo.'
};

/* «NO QUIERO RECIBIR MÁS MENSAJES». El SMS de confirmación de la inscripción ya no lleva el «Baja: …»
   automático (ocupaba 77 caracteres y lo empujaba a un segundo SMS): la baja vive AQUÍ, igual que en
   /v. Es un enlace RELATIVO a la misma URL (`?baja=1`); como en /v, un GET solo MUESTRA la
   confirmación y el botón es lo único que da la baja (los revisores de SMS abren los enlaces solos). */
const ENLACE_BAJA = '<a class="baja" href="?baja=1">No quiero recibir más mensajes</a>';
const BAJA_NO_VALIDA = {
  titulo: 'Enlace no válido',
  cuerpo: 'Este enlace no es válido. Si quiere dejar de recibir mensajes, escríbale a quien se lo envió.'
};

router.get('/:token', async (req, res) => {
  try {
    if (req.query.baja !== undefined) {
      // La baja no mira la caducidad: pedirla no puede depender de que la confirmación siga vigente.
      const v = await buscarParaBaja(req.params.token);
      if (!v) return res.status(404).send(pagina(BAJA_NO_VALIDA));
      return res.send(pagina({
        titulo: ANTES.titulo,
        cuerpo: ANTES.cuerpo,
        extra: confirmacionDeBaja(`/c/${encodeURIComponent(req.params.token)}?baja=1`)
      }));
    }
    const fila = await buscarVigente(req.params.token);
    if (!fila) return res.status(404).send(pagina(NO_VALIDO));
    if (fila.confirmada_en) {
      return res.send(pagina({
        titulo: 'Ya estaba confirmado',
        cuerpo: 'Su autorización ya había quedado confirmada. No hace falta hacer nada más.',
        ok: true,
        extra: ENLACE_BAJA
      }));
    }
    res.send(pagina({
      titulo: 'Confirme su autorización',
      cuerpo: 'Usted autorizó que la campaña guarde sus datos y le escriba. Confírmelo desde este dispositivo para que quede constancia.',
      boton: `<form method="POST" action="/c/${encodeURIComponent(req.params.token)}">
                <button type="submit">Sí, lo confirmo</button>
              </form>`,
      extra: ENLACE_BAJA
    }));
  } catch (err) {
    console.error(err);
    res.status(500).send(pagina({ titulo: 'No se pudo abrir', cuerpo: 'Intente de nuevo en unos minutos.' }));
  }
});

router.post('/:token', async (req, res) => {
  try {
    if (req.query.baja !== undefined) {
      // La misma baja que /b y /v (`aplicarBajaDeFicha`): marca a la persona y a las fichas que
      // comparten su teléfono o correo.
      const v = await buscarParaBaja(req.params.token);
      if (!v) return res.status(404).send(pagina(BAJA_NO_VALIDA));
      await aplicarBajaDeFicha(pool, 'votantes', v.votante_id);
      return res.send(pagina({ titulo: LISTO.titulo, cuerpo: LISTO.cuerpo, ok: true }));
    }
    const fila = await buscarVigente(req.params.token);
    if (!fila) return res.status(404).send(pagina(NO_VALIDO));
    /* La IP y el navegador se guardan porque son lo que ata la confirmación a
       un dispositivo concreto. `trust proxy` está puesto en app.js, así que
       `req.ip` trae la IP real del visitante y no la del proxy. */
    await confirmar({ fila, ip: req.ip, agente: req.get('user-agent') });
    res.send(pagina({
      titulo: 'Confirmado',
      cuerpo: 'Gracias. Su autorización quedó registrada con la fecha de hoy.',
      ok: true,
      extra: ENLACE_BAJA
    }));
  } catch (err) {
    console.error(err);
    res.status(500).send(pagina({ titulo: 'No se pudo confirmar', cuerpo: 'Intente de nuevo en unos minutos.' }));
  }
});

module.exports = router;
