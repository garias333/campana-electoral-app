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
const { buscarEnlaceActivo, buscarVotantePorToken, registrarVoto, baseDelSitio } = require('../config/yaVotoEnlace');
const { aplicarBajaDeFicha } = require('../config/bajaContacto');
const { confirmacionDeBaja, ANTES, LISTO } = require('../config/paginaBaja');

const router = express.Router();

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* LA TARJETA (vista previa) del enlace. WhatsApp y Google Mensajes piden el enlace por su cuenta al
   escribir el mensaje y arman una tarjeta con lo que haya en <head>: con estos metadatos sale una
   tarjeta grande, con el ✓, que se toca como un botón. NO se pueden poner botones de verdad en un
   SMS ni en el WhatsApp que se manda con wa.me; esto es lo más cercano.

   Quien pide la vista previa es un ROBOT, no la persona, y la ve cualquiera que mire el celular: por eso
   NADA del votante entra aquí —ni nombre, ni puesto, ni mesa— y los metadatos son IDÉNTICOS para un
   token válido, inexistente o vencido, y antes, durante y después del día de la elección (la misma regla
   de respuesta idéntica de esta ruta). Que el robot pida el enlace tampoco marca nada: el GET no cambia
   estado, el voto es un POST. */
const TITULO_TARJETA = 'Avísanos cuando votes ✓';
const DESCRIPCION_TARJETA = 'Toca aquí el día de la elección cuando ya hayas votado.';
const ALT_TARJETA = 'Ya voté: toca aquí cuando votes';

let marcaEnMemoria = { texto: '', hasta: 0 };
/** El nombre de la campaña (`marca_titulo`), con memoria de 5 minutos: lo piden los robots, sin sesión. */
async function nombreDeLaCampana() {
  if (Date.now() < marcaEnMemoria.hasta) return marcaEnMemoria.texto;
  let texto = '';
  try {
    const [[c]] = await pool.query('SELECT marca_titulo FROM configuracion_campana WHERE id = 1');
    texto = String((c && c.marca_titulo) || '').trim();
  } catch (_) { /* sin nombre: la tarjeta sale igual */ }
  marcaEnMemoria = { texto, hasta: Date.now() + 5 * 60 * 1000 };
  return texto;
}

/** Los <meta> de la tarjeta grande «Ya voté». La imagen va con URL ABSOLUTA, del dominio de la licencia (nunca de la cabecera Host). */
async function metasDeLaTarjeta() {
  const marca = await nombreDeLaCampana();
  const base = baseDelSitio();
  const imagen = base ? `${base}/img/ya-vote-og.png` : '';
  return [
    `<meta property="og:type" content="website">`,
    marca ? `<meta property="og:site_name" content="${esc(marca)}">` : '',
    `<meta property="og:title" content="${esc(TITULO_TARJETA)}">`,
    `<meta property="og:description" content="${esc(DESCRIPCION_TARJETA)}">`,
    `<meta name="description" content="${esc(DESCRIPCION_TARJETA)}">`,
    imagen ? `<meta property="og:image" content="${esc(imagen)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(ALT_TARJETA)}">` : '',
    `<meta name="twitter:card" content="summary_large_image">`,
  ].filter(Boolean).join('\n');
}

/** La página de la BAJA no lleva tarjeta grande —sólo título— para no confundirla con «Ya voté». */
const METAS_BAJA = `<meta property="og:type" content="website">
<meta property="og:title" content="Dejar de recibir mensajes">
<meta name="twitter:card" content="summary">`;

function pagina({ titulo, cuerpo, extra = '', ok = false, head = '', tituloPestana = null }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(tituloPestana || titulo)}</title>
${head}
<link rel="stylesheet" href="/app/estilos-app.css">
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background: var(--fondo, #f4f6fb); color: var(--texto, #1b2333); margin: 0;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
  .caja { background: #fff; border-radius: var(--radio, 18px); padding: 30px 24px; max-width: 420px; width: 100%;
          box-shadow: var(--sombra-flot, 0 8px 24px rgba(8,66,152,.13)); text-align: center; }
  h1 { font-size: 1.45rem; font-weight: 800; color: var(--marca-azul-osc, #084298); margin: 0 0 10px; }
  p { font-size: 1.02rem; line-height: 1.55; color: var(--texto-2, #6a7590); margin: 0 0 16px; }
  .lugar { background: var(--campo, #f1f4fa); border-radius: var(--radio-campo, 14px); padding: 14px; margin: 0 0 20px; color: var(--marca-azul-osc, #084298); }
  .lugar strong { display: block; font-size: 1.1rem; }
  button.grande { background: var(--marca-amarillo, #FFC300); color: #1b2333; border: 0; border-radius: 999px; width: 100%;
                  font-size: 1.35rem; font-weight: 800; padding: 20px 16px; cursor: pointer; box-shadow: 0 8px 20px rgba(255,195,0,.4); font-family: inherit; }
  button.grande:active { filter: brightness(.94); }
  a.baja { display: block; margin-top: 22px; color: var(--texto-2, #6a7590); font-size: 0.9rem; text-decoration: underline; padding: 8px; }
  a.mapa { display: block; margin-top: 16px; color: var(--marca-azul, #0B5ED7); font-weight: 700; text-decoration: none; padding: 10px; }
  .ok { color: var(--ok, #1e6b2e); font-weight: 700; }
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

/* «NO ACTIVO» RESPONDE 200, NO 404. Es la misma página para un token inexistente, mal formado, vencido,
   antes del día y después del día, y un cliente de mensajería puede descartar la tarjeta (vista previa) de
   una respuesta 404 y cachearla así. Con 200 la tarjeta sale igual en todos los casos; lo único que cambia
   es el código, y nadie que adivine tokens puede distinguir uno que existe de uno que no.

   PERO EL LÍMITE DE INTENTOS CONTABA LOS 404, y por eso se marca aparte: sin esta marca, adivinar tokens
   ya no gastaría el cupo (un 200 no cuenta) y el límite dejaría de proteger. `res.locals.noActivo` es lo
   que lee `requestWasSuccessful` aquí abajo. */
function responderNoActivo(res, head) {
  res.locals.noActivo = true;
  return res.status(200).send(pagina({ ...NO_ACTIVO, head, tituloPestana: TITULO_TARJETA }));
}

/* Solo las respuestas fallidas gastan el cupo: las >= 400 y las páginas «no activo» (que responden 200). */
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode < 400 && !res.locals.noActivo,
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
      if (!v) return res.status(404).send(pagina({ ...BAJA_NO_VALIDA, head: METAS_BAJA }));
      return res.send(pagina({
        head: METAS_BAJA,
        titulo: ANTES.titulo,
        cuerpo: ANTES.cuerpo,
        // El botón (config/paginaBaja.js, el mismo bloque que /b) es lo único que da la baja:
        // la página NO envía nada sola. La URL es la de esta página, con el token.
        extra: confirmacionDeBaja(`/v/${encodeURIComponent(req.params.token)}?baja=1`),
      }));
    }
    const fila = await buscarEnlaceActivo(req.params.token);
    // La tarjeta se arma ANTES de mirar si hay fila, y es la misma en las tres respuestas de abajo.
    const head = await metasDeLaTarjeta();
    if (!fila) return responderNoActivo(res, head);
    const hola = primerNombre(fila.nombre);
    if (fila.voto_en) {
      return res.send(pagina({
        head, tituloPestana: TITULO_TARJETA,
        titulo: hola ? `Hola, ${hola}` : 'Hola',
        cuerpo: 'Gracias, ya teníamos tu voto.', ok: true, extra: ENLACE_BAJA,
      }));
    }
    res.send(pagina({
      head, tituloPestana: TITULO_TARJETA,
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
      if (!v) return res.status(404).send(pagina({ ...BAJA_NO_VALIDA, head: METAS_BAJA }));
      await aplicarBajaDeFicha(pool, 'votantes', v.votante_id);
      return res.send(pagina({ titulo: LISTO.titulo, cuerpo: LISTO.cuerpo, ok: true }));
    }
    const fila = await buscarEnlaceActivo(req.params.token);
    // Misma página que el GET, byte a byte (también con la tarjeta): quien pide por POST no debe
    // poder distinguir «no existe» de «no es el día» por una diferencia que el GET no tiene.
    if (!fila) return responderNoActivo(res, await metasDeLaTarjeta());
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
