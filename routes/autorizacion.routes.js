/**
 * routes/autorizacion.routes.js — La página pública donde una persona AUTORIZA el tratamiento de sus datos (parche 325).
 *
 * El enlace /a/<token> se lo manda a la persona quien la registró, desde su propio WhatsApp (ver config/autorizacionDatos.js). Aquí la
 * persona confirma que es ella (nombre de pila y cédula enmascarada), lee la política de tratamiento de datos vigente, marca lo que
 * autoriza, firma con el dedo y queda la constancia.
 *
 * Va montada ANTES del candado de licencia y sin sesión, como /b, /c y /v: quien recibe el enlace no tiene cuenta aquí, y firmar su
 * autorización no puede depender de que la campaña tenga la licencia al día. Y FUERA de /api (sin CSRF): el token del enlace es la
 * credencial.
 *
 * FIRMAR ES UN POST, NUNCA UN GET. Los clientes de mensajería previsualizan los enlaces: un GET que firmara dejaría constancias falsas.
 * El GET solo MUESTRA; el POST registra. Un solo uso: lo garantiza un UPDATE condicionado (config/autorizacionDatos.js `firmar`).
 *
 * LO QUE UNA PÁGINA CON TOKEN NO MUESTRA, aunque el enlace sea válido: nada más que el nombre de pila, la cédula enmascarada y el nombre
 * de la campaña. Con el enlace vencido, usado, anulado o inventado, NINGÚN dato de la persona: la misma respuesta de «no válido».
 */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const A = require('../config/autorizacionDatos');
const { politicaVigente, nombreDeLaCampana } = require('../config/politicaPublica');
const { versionConocida } = require('../config/politicaVersiones');
const pool = require('../config/db');

const router = express.Router();

function esc(t) {
  return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const CSS = `
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--fondo,#f4f6fb);color:var(--texto,#1b2333);margin:0;padding:0 0 40px}
  .barra{background:var(--degradado,linear-gradient(135deg,#0B5ED7,#084298));color:#fff;padding:16px 18px;font-weight:800;font-size:1.05rem}
  .caja{background:#fff;border-radius:var(--radio,18px);padding:24px 20px;max-width:520px;margin:-14px auto 0;position:relative;box-shadow:var(--sombra-flot,0 8px 24px rgba(8,66,152,.13))}
  .envuelve{padding:0 14px}
  h1{font-size:1.25rem;color:var(--marca-azul-osc,#084298);font-weight:800;margin:0 0 10px}
  p{font-size:1rem;line-height:1.55;color:var(--texto-2,#6a7590);margin:0 0 14px}
  .ok{color:var(--ok,#1e6b2e);font-weight:700}
  .quien{background:var(--campo,#f1f4fa);border-radius:14px;padding:12px 14px;margin:0 0 16px;color:var(--texto,#1b2333)}
  .quien b{display:block;font-size:1.05rem}
  .politica{white-space:pre-wrap;font-size:.9rem;line-height:1.5;color:var(--texto,#1b2333);border:1.5px solid var(--borde,#d5dcea);border-radius:14px;padding:12px 14px;max-height:280px;overflow-y:auto;background:#fff}
  .version{font-size:.78rem;color:var(--texto-2,#6a7590);margin:6px 0 16px}
  label.cas{display:flex;gap:10px;align-items:flex-start;margin:0 0 12px;font-size:.98rem;color:var(--texto,#1b2333);font-weight:500}
  label.cas input{width:22px;height:22px;flex:none;margin-top:1px;accent-color:var(--marca-azul,#0B5ED7)}
  .sub{font-weight:700;margin:18px 0 8px;color:var(--texto,#1b2333)}
  .error{background:var(--error-fondo,#fff5f5);color:var(--error,#c62828);border:1px solid var(--error-borde,#e04848);border-radius:14px;padding:10px 12px;margin:0 0 14px;display:none;font-size:.92rem}
  button.firmar{display:flex;align-items:center;justify-content:center;background:var(--marca-amarillo,#FFC300);color:#1b2333;border:0;border-radius:999px;font-size:16.5px;font-weight:800;min-height:54px;padding:12px 26px;cursor:pointer;width:100%;box-shadow:0 8px 20px rgba(255,195,0,.4);font-family:inherit;margin-top:6px}
  button.firmar:disabled{opacity:.6;box-shadow:none}
  .pie{font-size:.78rem;color:var(--texto-2,#6a7590);text-align:center;margin-top:14px}
`;

function pagina({ titulo, cuerpo, ok = false, extra = '', campana = '' }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(titulo)}</title>
<link rel="stylesheet" href="/app/estilos-app.css">
<style>${CSS}</style></head><body>
<div class="barra">${esc(campana || 'Autorización de datos')}</div>
<div class="envuelve"><div class="caja"><h1>${esc(titulo)}</h1><p${ok ? ' class="ok"' : ''}>${cuerpo}</p>${extra}</div></div>
</body></html>`;
}

function cabeceras(res) {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
}

/* Solo las respuestas fallidas gastan el cupo (como en /i): 40 intentos fallidos por IP en 15 minutos. Adivinar un token de 128 bits no es
   viable; esto frena a quien lo intente igual y a un script que martille la página. */
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode < 400,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    cabeceras(res);
    res.status(429).send(pagina({ titulo: 'Demasiados intentos', cuerpo: 'Se hicieron demasiados intentos desde esta conexión. Espere unos minutos y vuelva a abrir el enlace.' }));
  },
}));

/* UNA SOLA RESPUESTA para enlace inexistente, de formato raro, anulado o vencido: no dice cuál de las cosas es ni da ningún dato.
   (Vencido y usado sí se distinguen, porque el mensaje correcto es otro y no revela a quién pertenece.) */
const NO_VALIDO = { titulo: 'Enlace no válido', cuerpo: 'Este enlace no es válido. Si quiere autorizar el tratamiento de sus datos, pídale a quien se lo envió que le mande uno nuevo.' };
const VENCIDO = { titulo: 'Enlace vencido', cuerpo: 'Este enlace ya venció. Pídale a quien se lo envió que le mande uno nuevo.' };
const FIRMADO = { titulo: 'Ya quedó registrada', cuerpo: 'Esta autorización ya fue firmada. No hace falta hacer nada más. Gracias.', ok: true };

/** Resuelve el token a una respuesta de error (o null si está vigente y se puede firmar). */
function respuestaDeEstado(fila) {
  if (!fila) return { codigo: 404, ...NO_VALIDO };
  if (fila.estado === 'firmada') return { codigo: 200, ...FIRMADO };
  if (fila.estado === 'anulada') return { codigo: 404, ...NO_VALIDO };
  if (!fila.vigente) return { codigo: 410, ...VENCIDO };
  return null;
}

router.get('/:token', async (req, res) => {
  cabeceras(res);
  try {
    const fila = await A.buscarPorToken(req.params.token);
    const mal = respuestaDeEstado(fila);
    if (mal) { const { codigo, ...p } = mal; return res.status(codigo).send(pagina(p)); }
    const persona = await A.datosDePersona(fila.persona_tipo, fila.persona_id);
    if (!persona) return res.status(404).send(pagina(NO_VALIDO));
    const campana = await nombreDeLaCampana(persona.rama);
    const pol = await politicaVigente();
    if (!pol.huella) {
      return res.send(pagina({ titulo: 'Todavía no se puede firmar', campana,
        cuerpo: 'La campaña aún no ha publicado su política de tratamiento de datos, así que por ahora no se puede registrar la autorización. Pídale a quien le envió el enlace que lo intente más tarde.' }));
    }
    const nombre = A.primerNombre(persona.nombre);
    const cedula = A.mascaraCedula(persona.cedula);
    const tok = encodeURIComponent(req.params.token);
    res.send(pagina({
      titulo: 'Autorización para el tratamiento de sus datos',
      campana,
      cuerpo: `${esc(campana || 'La campaña')} le pide autorizar el tratamiento de sus datos personales, conforme a la Ley 1581 de 2012. Léala y firme al final.`,
      extra: `
<div class="quien"><b>${esc(nombre || 'Usted')}</b>${cedula ? `<span>Documento ${esc(cedula)}</span>` : ''}<span style="display:block;font-size:.85rem;color:var(--texto-2,#6a7590)">Si esta no es usted, no firme.</span></div>
<div class="sub">${esc(pol.titulo)}</div>
<div class="politica" id="texto-politica" tabindex="0">${esc(pol.contenido)}</div>
<div class="version">Versión de la política: <code>${esc(pol.huella)}</code></div>
<div class="error" id="error" role="alert"></div>
<label class="cas"><input type="checkbox" id="c-autoriza"><span><b>Autorizo el tratamiento de mis datos personales</b> según la política que acabo de leer. (Obligatorio)</span></label>
<div class="sub">¿Por cuáles medios autoriza que le escribamos? (opcional)</div>
<label class="cas"><input type="checkbox" id="c-whatsapp"><span>WhatsApp</span></label>
<label class="cas"><input type="checkbox" id="c-sms"><span>Mensajes de texto (SMS)</span></label>
<label class="cas"><input type="checkbox" id="c-email"><span>Correo electrónico</span></label>
<div class="sub">Su firma</div>
<canvas id="lienzo-firma" class="lienzo-firma"></canvas>
<div class="firma-pie"><span id="firma-estado">Firme con el dedo en el recuadro.</span><button type="button" class="btn-mini" id="btn-borrar-firma">Borrar</button></div>
<button type="button" class="firmar" id="btn-firmar">Firmar y autorizar</button>
<div class="pie">Puede revocar esta autorización cuando quiera pidiéndolo a la campaña.</div>
<script src="/js/firma.js"></script>
<script>
(function () {
  var lienzo = activarFirma({ lienzo: '#lienzo-firma', estado: '#firma-estado', borrar: '#btn-borrar-firma' });
  if (lienzo) lienzo.alMostrar();
  var boton = document.getElementById('btn-firmar'), caja = document.getElementById('error');
  function mostrar(t) { caja.textContent = t; caja.style.display = 'block'; caja.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  boton.addEventListener('click', function () {
    caja.style.display = 'none';
    if (!document.getElementById('c-autoriza').checked) return mostrar('Para continuar marque que autoriza el tratamiento de sus datos.');
    if (!lienzo || !lienzo.hayFirma()) return mostrar('Falta su firma: dibújela con el dedo en el recuadro.');
    boton.disabled = true;
    fetch('/a/${tok}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      autoriza: true, whatsapp: document.getElementById('c-whatsapp').checked, sms: document.getElementById('c-sms').checked,
      email: document.getElementById('c-email').checked, firma: lienzo.comoPNG(), huella: '${esc(pol.huella)}' }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (x.ok) { document.querySelector('.caja').innerHTML = '<h1>Gracias</h1><p class="ok">Gracias, su autorización quedó registrada.</p>'; window.scrollTo(0, 0); }
        else { boton.disabled = false; mostrar((x.j && x.j.error) || 'No se pudo registrar. Intente de nuevo.'); }
      })
      .catch(function () { boton.disabled = false; mostrar('No hay conexión. Intente de nuevo.'); });
  });
})();
</script>`
    }));
  } catch (err) {
    console.error('autorizacion GET:', err.code || err.message);
    res.status(500).send(pagina({ titulo: 'No se pudo abrir', cuerpo: 'Intente de nuevo en unos minutos.' }));
  }
});

router.post('/:token', async (req, res) => {
  cabeceras(res);
  try {
    const fila = await A.buscarPorToken(req.params.token);
    const mal = respuestaDeEstado(fila);
    if (mal) {
      const msg = mal.titulo === FIRMADO.titulo ? 'Esta autorización ya fue firmada.' : mal.titulo === VENCIDO.titulo ? 'Este enlace ya venció.' : 'Este enlace no es válido.';
      return res.status(mal.codigo === 200 ? 409 : mal.codigo).json({ error: msg, motivo: mal.titulo === FIRMADO.titulo ? 'usado' : (mal.codigo === 410 ? 'vencido' : 'no_valido') });
    }
    const b = req.body || {};
    // La huella de la política que la persona LEYÓ (la de la página): vale si el servidor la tiene archivada; si no, la vigente.
    let politica = await politicaVigente();
    const leida = String(b.huella || '');
    if (leida && leida !== politica.huella && await versionConocida(leida)) politica = { ...politica, huella: leida };
    const r = await A.firmar({
      fila, firma: b.firma, autoriza: b.autoriza === true,
      canales: { whatsapp: b.whatsapp === true, sms: b.sms === true, email: b.email === true },
      politica, ip: req.ip, agente: req.get('user-agent'),
    });
    if (!r.ok) {
      const textos = {
        falta_autorizacion: 'Para continuar marque que autoriza el tratamiento de sus datos.',
        firma: 'Falta su firma: dibújela con el dedo en el recuadro.',
        sin_politica: 'La campaña aún no ha publicado su política de datos.',
        usado: 'Esta autorización ya fue firmada o el enlace ya no sirve.',
      };
      return res.status(r.motivo === 'usado' ? 409 : 400).json({ error: textos[r.motivo] || 'No se pudo registrar.', motivo: r.motivo });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('autorizacion POST:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo registrar. Intente de nuevo en unos minutos.' });
  }
});

module.exports = router;
