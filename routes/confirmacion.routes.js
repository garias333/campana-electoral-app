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
const { buscarVigente, confirmar } = require('../config/confirmacionConsentimiento');

const router = express.Router();

function pagina({ titulo, cuerpo, boton, ok }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${titulo}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background: #F3F5F8; color: #161B26; margin: 0;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
  .caja { background: #fff; border-radius: 14px; padding: 30px 26px; max-width: 420px; width: 100%;
          box-shadow: 0 10px 34px rgba(16,35,63,.12); text-align: center; }
  h1 { font-size: 1.25rem; color: #10233F; margin: 0 0 12px; }
  p { font-size: 1rem; line-height: 1.55; color: #5B6472; margin: 0 0 18px; }
  button { background: #0B5ED7; color: #fff; border: 0; border-radius: 9px;
           font-size: 1rem; font-weight: 700; padding: 13px 26px; cursor: pointer; width: 100%; }
  button:hover { background: #084298; }
  .ok { color: #1E6B44; font-weight: 600; }
</style></head><body><div class="caja">
<h1>${titulo}</h1><p${ok ? ' class="ok"' : ''}>${cuerpo}</p>${boton || ''}
</div></body></html>`;
}

const NO_VALIDO = {
  titulo: 'Enlace no válido',
  cuerpo: 'Este enlace no es válido o ya venció. Si quiere confirmar su autorización, pídale a la campaña que le envíe uno nuevo.'
};

router.get('/:token', async (req, res) => {
  try {
    const fila = await buscarVigente(req.params.token);
    if (!fila) return res.status(404).send(pagina(NO_VALIDO));
    if (fila.confirmada_en) {
      return res.send(pagina({
        titulo: 'Ya estaba confirmado',
        cuerpo: 'Su autorización ya había quedado confirmada. No hace falta hacer nada más.',
        ok: true
      }));
    }
    res.send(pagina({
      titulo: 'Confirme su autorización',
      cuerpo: 'Usted autorizó que la campaña guarde sus datos y le escriba. Confírmelo desde este dispositivo para que quede constancia.',
      boton: `<form method="POST" action="/c/${encodeURIComponent(req.params.token)}">
                <button type="submit">Sí, lo confirmo</button>
              </form>`
    }));
  } catch (err) {
    console.error(err);
    res.status(500).send(pagina({ titulo: 'No se pudo abrir', cuerpo: 'Intente de nuevo en unos minutos.' }));
  }
});

router.post('/:token', async (req, res) => {
  try {
    const fila = await buscarVigente(req.params.token);
    if (!fila) return res.status(404).send(pagina(NO_VALIDO));
    /* La IP y el navegador se guardan porque son lo que ata la confirmación a
       un dispositivo concreto. `trust proxy` está puesto en app.js, así que
       `req.ip` trae la IP real del visitante y no la del proxy. */
    await confirmar({ fila, ip: req.ip, agente: req.get('user-agent') });
    res.send(pagina({
      titulo: 'Confirmado',
      cuerpo: 'Gracias. Su autorización quedó registrada con la fecha de hoy.',
      ok: true
    }));
  } catch (err) {
    console.error(err);
    res.status(500).send(pagina({ titulo: 'No se pudo confirmar', cuerpo: 'Intente de nuevo en unos minutos.' }));
  }
});

module.exports = router;
