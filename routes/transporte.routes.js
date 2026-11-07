/**
 * Transporte del Día D — la puerta DEL CONDUCTOR (orden 33): /t/<código>. Sin cuenta, sin sesión, fuera de /api.
 *
 * ENTRA POR UN ENLACE CON CÓDIGO, como la inscripción por enlace (/i): el código (8 caracteres, el mismo alfabeto, en
 * claro, rotable y revocable por la coordinación) identifica a UN conductor. Va DESPUÉS del candado de licencia, como /i:
 * capta y guarda datos operativos, y con la licencia vencida no debe seguir.
 *
 * VIGENCIA: SOLO EL DÍA DE LA ELECCIÓN de la campaña (`configuracion_campana.fecha_eleccion`, hora de Colombia, de las
 * 00:00 a las 23:59). Un código inexistente, desactivado o fuera de fecha reciben LA MISMA página, «Este enlace no está
 * activo»: ni el código ni la fecha se pueden tantear por la respuesta. Un límite de intentos FALLIDOS por IP (el mismo
 * de /i) frena quien pruebe códigos.
 *
 * QUÉ VE EL CONDUCTOR: solo SUS paradas de ese día, en orden. De cada una: primer nombre e inicial del apellido,
 * dirección, barrio, personas, puesto y mesa. El teléfono viaja solo dentro del botón «Llamar» (no se muestra). Una parada
 * cerrada (llevado al puesto, no estaba, o el votante ya votó) se colapsa y NO manda dirección, teléfono ni coordenadas.
 * Nada más de la campaña. Las reglas viven en lib/transporteDiaD.js.
 *
 * LAS MARCAS SON IDEMPOTENTES (cliente_uuid) para que el teléfono pueda guardarlas sin señal y reintentarlas.
 */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const T = require('../lib/transporteDiaD');

const router = express.Router();

function cabeceras(res) {
  res.set({
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    // «origin» y no «no-referrer»: los mapas de OpenStreetMap piden el sitio de origen al servir sus teselas.
    'Referrer-Policy': 'origin',
  });
}

function esc(t) {
  return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Solo gastan cupo las respuestas fallidas (>= 400, o las que marcan `res.locals.fallo`: el código que no sirve responde
   200 para que la respuesta sea idéntica, y aun así cuenta). El mismo ajuste de /i. */
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode < 400 && !res.locals.fallo,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    cabeceras(res);
    res.status(429).send(paginaSimple('Demasiados intentos', 'Se hicieron demasiados intentos desde esta conexión. Espera unos minutos y vuelve a abrir el enlace.'));
  },
}));

const CSS = `
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#F3F5F8;color:#161B26;margin:0;padding:0 0 40px;font-size:16px}
  .tope{background:#10233F;color:#fff;padding:14px 16px}
  .tope h1{font-size:1.15rem;margin:0 0 2px}
  .tope p{margin:0;font-size:.85rem;color:#C9D6E8}
  main{max-width:560px;margin:0 auto;padding:12px 12px 0}
  .caja{background:#fff;border-radius:14px;padding:22px 18px;max-width:460px;margin:18px auto;box-shadow:0 10px 34px rgba(16,35,63,.12)}
  .caja h1{font-size:1.25rem;color:#10233F;margin:0 0 8px}.caja p{margin:0;color:#5B6472;line-height:1.5}
  .aviso{background:#FFF4D6;border:1px solid #E8C96A;color:#6B4A00;border-radius:10px;padding:9px 12px;margin:10px 0;font-size:.88rem}
  .cifras{display:flex;gap:8px;margin:10px 0}
  .cifras div{flex:1;background:#fff;border:1px solid #DCE2EA;border-radius:10px;padding:8px 4px;text-align:center}
  .cifras strong{display:block;font-size:1.3rem;color:#10233F}.cifras span{font-size:.72rem;color:#6B7280}
  #mapa{height:230px;border-radius:12px;margin:10px 0;border:1px solid #DCE2EA;background:#E5E9F0}
  .parada{background:#fff;border:1px solid #DCE2EA;border-radius:12px;padding:12px;margin:10px 0}
  .parada header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .parada .n{background:#0B5ED7;color:#fff;border-radius:50%;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:.85rem;flex:none}
  .parada strong{font-size:1.05rem}.parada .per{color:#5B6472;font-size:.88rem}
  .parada .estado{margin-left:auto;font-size:.75rem;font-weight:700;color:#8A5A00;background:#FFF4D6;border-radius:999px;padding:2px 9px}
  .parada .estado.rec{color:#0A5348;background:#E6F4F1}
  .parada p{margin:6px 0 0;font-size:.92rem;line-height:1.4}.parada .dir{font-weight:600}.parada .sec{color:#5B6472}
  .acc,.marcas{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
  .acc a{flex:1 1 calc(50% - 8px);text-align:center;text-decoration:none;padding:11px 6px;border:1.5px solid #0B5ED7;color:#0B5ED7;border-radius:10px;font-weight:700;font-size:.9rem;background:#fff}
  .marcas button{flex:1 1 100%;border:0;border-radius:11px;padding:14px 8px;font-size:1rem;font-weight:800;color:#fff;cursor:pointer}
  .marcas .rec{background:#0B5ED7}.marcas .lle{background:#1E6B44}.marcas .no{background:#fff;color:#A93226;border:1.5px solid #A93226;flex:1 1 100%;font-weight:700}
  .marcas button:disabled{opacity:.55}
  .cerrada{background:#EEF1F5;border-radius:10px;padding:9px 12px;margin:8px 0;color:#5B6472;font-size:.9rem}
  .cerrada b{color:#161B26}
  .vacio{text-align:center;color:#5B6472;padding:26px 8px}
  .pin{background:#0B5ED7;color:#fff;border:2px solid #fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.8rem;box-shadow:0 1px 5px rgba(0,0,0,.4)}
  .pin.puesto{background:#1E6B44;border-radius:6px}
  .pie{font-size:.75rem;color:#6B7280;text-align:center;margin:16px 0 0}
`;

function paginaSimple(titulo, cuerpo) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="origin">
<title>${esc(titulo)}</title>
<style>${CSS}</style></head><body><div class="caja"><h1>${esc(titulo)}</h1><p>${esc(cuerpo)}</p></div></body></html>`;
}

// LA MISMA página para código inexistente, desactivado, o fuera del día de la elección.
const NO_ACTIVO = ['Este enlace no está activo', 'Si te lo dio alguien de la campaña, pídele que te envíe el actual.'];
function responderNoActivo(res) {
  res.locals.fallo = true;
  return res.status(200).send(paginaSimple(NO_ACTIVO[0], NO_ACTIVO[1]));
}

router.get('/:codigo', async (req, res) => {
  cabeceras(res);
  try {
    const c = await T.conductorVigente(req.params.codigo);
    if (!c) return responderNoActivo(res);
    res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="origin">
<title>Lista de recogida</title>
<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">
<style>${CSS}</style></head><body data-codigo="${esc(c.codigo)}">
<div class="tope"><h1>Lista de recogida</h1><p id="quien">Cargando…</p></div>
<main>
  <div class="aviso" id="aviso-cola" hidden></div>
  <div class="cifras" id="cifras" hidden>
    <div><strong id="c-pend">0</strong><span>por recoger</span></div>
    <div><strong id="c-ruta">0</strong><span>en el vehículo</span></div>
    <div><strong id="c-cerr">0</strong><span>cerradas</span></div>
  </div>
  <div id="mapa" hidden></div>
  <div id="lista"></div>
  <p class="pie">Mapa © contribuidores de OpenStreetMap. Esta lista solo sirve hoy; si la pierdes, pide otro enlace.</p>
</main>
<script src="/vendor/leaflet/leaflet.js"></script>
<script src="/js/transporte-conductor.js"></script>
</body></html>`);
  } catch (err) {
    console.error('transporte /t GET:', err.code || err.message);
    res.status(500).send(paginaSimple('No se pudo abrir', 'Intenta de nuevo en unos minutos.'));
  }
});

router.get('/:codigo/lista', async (req, res) => {
  cabeceras(res);
  try {
    const c = await T.conductorVigente(req.params.codigo);
    if (!c) { res.locals.fallo = true; return res.json({ activo: false }); }
    res.json({
      activo: true, conductor: T.nombreCorto(c.nombre) || c.nombre.split(' ')[0], placa: c.placa || '', fecha: c.fecha,
      paradas: await T.listaDelConductor(c),
    });
  } catch (err) {
    console.error('transporte /t lista:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo cargar la lista.' });
  }
});

/** Una marca. Cuerpo: { parada_id, accion: 'recogido'|'llevado'|'no_estaba', cliente_uuid, marcado_en, latitud, longitud }. */
router.post('/:codigo/marcar', async (req, res) => {
  cabeceras(res);
  try {
    const c = await T.conductorVigente(req.params.codigo);
    if (!c) { res.locals.fallo = true; return res.json({ activo: false }); }
    const b = req.body || {};
    const paradaId = Number(b.parada_id);
    const uuid = /^[A-Za-z0-9-]{8,64}$/.test(String(b.cliente_uuid || '')) ? String(b.cliente_uuid) : null;
    if (!Number.isInteger(paradaId) || paradaId < 1) { res.locals.fallo = true; return res.status(400).json({ ok: false, error: 'Falta la parada.' }); }
    const r = await T.marcar(c, paradaId, String(b.accion || ''), { clienteUuid: uuid, marcadoEn: b.marcado_en, latitud: b.latitud, longitud: b.longitud });
    // Una parada que no es de este conductor (o ya no existe) responde igual que una inexistente.
    if (!r.encontrada) { res.locals.fallo = true; return res.status(404).json({ ok: false, error: 'No se encontró esa parada.' }); }
    res.json({ ok: true, estado: r.estado, aplicada: r.aplicada });
  } catch (err) {
    console.error('transporte /t marcar:', err.code || err.message);
    res.status(500).json({ ok: false, error: 'No se pudo guardar. Intenta de nuevo.' });
  }
});

module.exports = router;
