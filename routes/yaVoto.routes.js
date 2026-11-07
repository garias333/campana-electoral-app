/**
 * routes/yaVoto.routes.js — La página pública «Ya voté» (Día D, fase 2).
 *
 * Montada junto a /b y /c: SIN SESIÓN, ANTES del candado de licencia y FUERA de
 * /api. Quien recibe el enlace es un votante, no tiene cuenta, y avisar que votó
 * no puede depender de que la licencia de la campaña esté al día ese domingo.
 * Fuera de /api también por el CSRF: `csrfProtegido` cubre todo /api y exige un
 * token que el votante no puede tener.
 *
 * REGISTRAR ES UN POST, NUNCA UN GET. Los clientes de SMS y de correo abren los
 * enlaces por su cuenta para previsualizarlos; con el voto en el GET, media lista
 * quedaría «votó» sin que nadie tocara nada, y eso sería un dato electoral falso.
 * El GET muestra un botón; el POST es el que registra.
 *
 * LO QUE LA PÁGINA MUESTRA: el primer nombre, el puesto y la mesa. NI cédula, NI
 * teléfono, NI nada más: la URL viaja por SMS y puede acabar reenviada o en un
 * teléfono prestado.
 *
 * TOKEN INEXISTENTE, VENCIDO, ANTES DEL DÍA y DESPUÉS DEL DÍA responden LO MISMO
 * (mismo código, misma página): quien adivina tokens no debe poder distinguir uno
 * que existe de uno que no. El límite de intentos por IP cuenta solo las
 * respuestas fallidas, así que un votante legítimo —varios comparten la IP del
 * operador— no lo gasta abriendo su enlace.
 */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../config/db');
const { buscarEnlaceActivo, buscarVotantePorToken, registrarVoto } = require('../config/yaVotoEnlace');
const { aplicarBajaDeFicha } = require('../config/bajaContacto');
const { confirmacionDeBaja, LISTO } = require('../config/paginaBaja');

const router = express.Router();

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function pagina({ titulo, cuerpo, extra = '', ok = false }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(titulo)}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background: #F3F5F8; color: #161B26; margin: 0;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
  .caja { background: #fff; border-radius: 16px; padding: 30px 24px; max-width: 420px; width: 100%;
          box-shadow: 0 10px 34px rgba(16,35,63,.12); text-align: center; }
  h1 { font-size: 1.45rem; color: #10233F; margin: 0 0 10px; }
  p { font-size: 1.02rem; line-height: 1.55; color: #5B6472; margin: 0 0 16px; }
  .lugar { background: #F3F5F8; border-radius: 12px; padding: 14px; margin: 0 0 20px; color: #10233F; }
  .lugar strong { display: block; font-size: 1.1rem; }
  button.grande { background: #1E6B44; color: #fff; border: 0; border-radius: 14px; width: 100%;
                  font-size: 1.35rem; font-weight: 800; padding: 20px 16px; cursor: pointer; }
  button.grande:active { background: #155233; }
  a.baja { display: block; margin-top: 22px; color: #5B6472; font-size: 0.9rem; text-decoration: underline; padding: 8px; }
  a.mapa { display: block; margin-top: 16px; color: #0B5ED7; font-weight: 700; text-decoration: none; padding: 10px; }
  .ok { color: #1E6B44; font-weight: 700; }
</style></head><body><div class="caja">
<h1>${esc(titulo)}</h1><p${ok ? ' class="ok"' : ''}>${cuerpo}</p>${extra}
</div></body></html>`;
}

/* «NO QUIERO RECIBIR MÁS MENSAJES». El enlace del SMS ya no trae el enlace de baja aparte
   (ocupaba 78 caracteres y empujaba el mensaje a dos segmentos): la baja vive AQUÍ.
   Es un enlace RELATIVO a la misma URL (`?baja=1`) y no lleva el token, a propósito: así la
   página «no activo» —la misma para un token inexistente, vencido o fuera del día— puede
   ofrecerla sin cambiar un solo byte entre un caso y otro. Es quien valida el token. */
const ENLACE_BAJA = `<a class="baja" href="?baja=1">No quiero recibir más mensajes</a>`;

// La misma página para «no existe», «venció» y «no es el día».
const NO_ACTIVO = {
  titulo: 'Enlace no activo',
  cuerpo: 'Este enlace no está activo. Solo funciona el día de la elección. '
        + 'Si necesita ayuda, escríbale a quien se lo envió.',
  extra: ENLACE_BAJA,
};

// La misma página para un token que no existe, en la baja.
const BAJA_NO_VALIDA = {
  titulo: 'Enlace no válido',
  cuerpo: 'Este enlace no es válido. Si quiere dejar de recibir mensajes, escríbale a quien se lo envió.',
};

function cabeceras(res) {
  res.set({
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
  });
}

/* Solo las respuestas fallidas (>= 400) gastan el cupo: ver el encabezado. */
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => { cabeceras(res); res.status(429).send(pagina({
    titulo: 'Demasiados intentos',
    cuerpo: 'Se hicieron demasiados intentos desde esta conexión. Espere unos minutos y vuelva a abrir su enlace.',
  })); },
}));

function primerNombre(nombre) {
  const n = String(nombre || '').trim().split(/\s+/)[0] || '';
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
}

function enlaceMapa(fila) {
  const consulta = [fila.puesto_votacion, fila.municipio_votacion, fila.departamento_votacion]
    .map(x => String(x || '').trim()).filter(Boolean).join(', ');
  return consulta
    ? `<a class="mapa" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(consulta)}" rel="noopener noreferrer">Cómo llegar a mi puesto</a>`
    : '';
}

function lugar(fila) {
  const puesto = String(fila.puesto_votacion || '').trim();
  if (!puesto) return '';
  const mesa = String(fila.mesa_votacion || '').trim();
  return `<div class="lugar"><strong>${esc(puesto)}</strong>${mesa ? `Mesa ${esc(mesa)}` : ''}</div>`;
}

router.get('/:token', async (req, res) => {
  cabeceras(res);
  try {
    if (req.query.baja !== undefined) {
      // La BAJA: no mira la fecha ni la vigencia. Muestra la confirmación; NO da de baja
      // (un GET no cambia nada: los clientes de SMS abren los enlaces por su cuenta).
      const v = await buscarVotantePorToken(req.params.token);
      if (!v) return res.status(404).send(pagina(BAJA_NO_VALIDA));
      return res.send(pagina({
        titulo: 'No recibir más mensajes',
        cuerpo: 'Si confirma, esta campaña dejará de enviarle mensajes de texto, correos y avisos.',
        // La página envía sola el POST (config/paginaBaja.js, el mismo bloque que /b): el
        // botón queda para quien no tiene JavaScript o si el envío falla. La URL es la
        // misma de esta página, con el token, para que el POST llegue a este mismo router.
        extra: confirmacionDeBaja(`/v/${encodeURIComponent(req.params.token)}?baja=1`,
          '<button type="submit" class="grande" style="background:#10233F;">Confirmar mi baja</button>'),
      }));
    }
    const fila = await buscarEnlaceActivo(req.params.token);
    if (!fila) return res.status(404).send(pagina(NO_ACTIVO));
    const hola = primerNombre(fila.nombre);
    if (fila.voto_en) {
      return res.send(pagina({
        titulo: hola ? `Hola, ${hola}` : 'Hola',
        cuerpo: 'Gracias, ya teníamos tu voto.', ok: true, extra: ENLACE_BAJA,
      }));
    }
    res.send(pagina({
      titulo: hola ? `Hola, ${hola}` : 'Hola',
      cuerpo: 'Cuando hayas votado, avísanos con un toque.',
      extra: `${lugar(fila)}
<form method="post" action="/v/${encodeURIComponent(req.params.token)}">
  <button type="submit" class="grande">Ya voté</button>
</form>${enlaceMapa(fila)}${ENLACE_BAJA}`,
    }));
  } catch (err) {
    console.error('ya-voto GET:', err.code || err.message);
    res.status(500).send(pagina({ titulo: 'No se pudo abrir', cuerpo: 'Intente de nuevo en unos minutos.' }));
  }
});

router.post('/:token', async (req, res) => {
  cabeceras(res);
  try {
    if (req.query.baja !== undefined) {
      // Misma baja que /b (`aplicarBajaDeFicha`): marca a la persona y a las fichas que
      // comparten su teléfono o correo, con origen «enlace».
      const v = await buscarVotantePorToken(req.params.token);
      if (!v) return res.status(404).send(pagina(BAJA_NO_VALIDA));
      await aplicarBajaDeFicha(pool, 'votantes', v.votante_id);
      return res.send(pagina({ titulo: LISTO.titulo, cuerpo: LISTO.cuerpo, ok: true }));
    }
    const fila = await buscarEnlaceActivo(req.params.token);
    if (!fila) return res.status(404).send(pagina(NO_ACTIVO));
    const r = await registrarVoto({
      votanteId: fila.votante_id, puestoId: fila.puesto_id, origen: 'enlace', marcadoPor: null,
    });
    const hola = primerNombre(fila.nombre);
    res.send(pagina({
      titulo: hola ? `¡Gracias, ${hola}!` : '¡Gracias!',
      cuerpo: r.yaEstaba ? 'Gracias, ya teníamos tu voto.' : 'Registramos tu voto. ¡Gracias por participar!',
      ok: true, extra: ENLACE_BAJA,
    }));
  } catch (err) {
    console.error('ya-voto POST:', err.code || err.message);
    res.status(500).send(pagina({ titulo: 'No se pudo registrar', cuerpo: 'Intente de nuevo en unos minutos.' }));
  }
});

module.exports = router;
