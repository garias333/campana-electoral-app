/**
 * Las PUERTAS de «Activar complementos» (parche 318). El estado y la regla viven en lib/complementos.js; aquí solo se pone la puerta.
 *
 *   requiereComplemento(clave)        en una ruta de API: apagado → 403 { error, motivo: 'complemento_inactivo', complemento }.
 *   requiereComplementoPublico(clave) en una ruta SIN sesión (el enlace del conductor, /t/<código>): apagado → la página «Este complemento no
 *                                     está activo» (si lo que se pidió es una página) o el mismo 403 en JSON (si es una llamada de datos).
 *   paginasDeComplementos             en app.js, ANTES de express.static: el enlace directo a una pantalla de un complemento apagado muestra
 *                                     «Este complemento no está activo» en vez de la pantalla.
 *
 * VAN ANTES DE CUALQUIER SALVOCONDUCTO. El administrador y el superadministrador no pasan: el interruptor es de la CAMPAÑA, no de un rol. Por
 * eso `requiereComplemento` se pone DESPUÉS de `requireAuth` (que sigue contestando 401 a quien no entró) y ANTES de `requiereVerModulo`,
 * `requireRole` y las funciones `permisosDe` de cada módulo.
 *
 * LA PÁGINA ES UN 403 Y NO UN 200. El service worker (public/service-worker.js) solo guarda copia de las respuestas 2xx: así la pantalla de
 * «no activo» nunca queda guardada en el celular como si fuera la pantalla de verdad, ni al revés.
 */
'use strict';

const C = require('../lib/complementos');

/** Una ruta mal escrita no puede llegar a producción callada: se rompe al CARGAR el archivo de rutas. */
function exigirClaveConocida(clave, quien) {
  if (!C.CLAVES.includes(clave)) throw new Error(`${quien}: «${clave}» no es un complemento (ver lib/complementos.js).`);
}

function respuestaJson(res, clave) {
  return res.status(403).json({ error: C.MENSAJE_INACTIVO, motivo: C.MOTIVO, complemento: clave });
}

function requiereComplemento(clave) {
  exigirClaveConocida(clave, 'requiereComplemento');
  return async function complementoActivoOCierra(req, res, next) {
    try {
      if (await C.complementoActivo(clave)) return next();
    } catch (err) {
      console.error(`[complementos] ${clave}:`, err.code || err.message);
    }
    return respuestaJson(res, clave);
  };
}

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** La página: sola, sin menú, que se lee igual en 390 px. `esAdmin` agrega el enlace a Activar complementos. */
function paginaInactiva({ nombre, esAdmin, inicio }) {
  const enlaceAdmin = esAdmin
    ? '<a class="boton" href="/configuracion.html#complementos">Ir a «Activar complementos»</a>' : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Este complemento no está activo</title>
<style>
  *{box-sizing:border-box} body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:#F4F6FA;color:#1B2433;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .caja{max-width:440px;width:100%;background:#fff;border:1px solid #D9DEE8;border-radius:14px;padding:28px 22px;text-align:center}
  h1{font-size:1.25rem;margin:0 0 8px} p{margin:0 0 18px;color:#4A5568;line-height:1.45}
  .boton{display:block;margin:8px 0 0;padding:12px 14px;border-radius:10px;background:#0B5ED7;color:#fff;text-decoration:none;font-weight:600}
  .boton.sec{background:#fff;color:#0B5ED7;border:1px solid #0B5ED7}
  @media (prefers-color-scheme: dark){body{background:#10141C;color:#E6EAF2}.caja{background:#181E29;border-color:#2C3547}p{color:#A9B3C5}.boton.sec{background:transparent;color:#7FB0FF;border-color:#7FB0FF}}
</style></head><body><div class="caja">
<h1>Este complemento no está activo</h1>
<p>«${esc(nombre)}» no está activo en esta campaña. Si lo necesita, pídale al administrador de la campaña que lo active.</p>
${enlaceAdmin}
${inicio ? `<a class="boton sec" href="${esc(inicio)}">Volver al inicio</a>` : ''}
</div></body></html>`;
}

/** Cada pantalla de un complemento (escritorio y /app) → su clave. Las pestañas de dia-d.html no están aquí: son de esa pantalla y las oculta ella. */
const PAGINAS = {
  '/solicitudes.html': 'solicitudes',
  '/app/solicitud-nueva.html': 'solicitudes',
  '/app/mis-solicitudes.html': 'solicitudes',
  '/tareas.html': 'tareas',
  '/app/mis-tareas.html': 'tareas',
  '/puerta-listas.html': 'puerta_a_puerta',
  '/app/puerta-a-puerta.html': 'puerta_a_puerta',
  '/puerta-panel.html': 'puerta_panel',
  '/app/alertas-dia-d.html': 'alertas_dia_d',
  '/app/logistica.html': 'logistica_dia_d',
  '/app/faltantes.html': 'faltan_por_votar',
  '/finanzas.html': 'finanzas',
};
Object.values(PAGINAS).forEach((c) => exigirClaveConocida(c, 'PAGINAS'));

async function paginasDeComplementos(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const clave = PAGINAS[String(req.path || '').toLowerCase()];
  if (!clave) return next();
  let activo = false;
  try { activo = await C.complementoActivo(clave); } catch (err) { console.error(`[complementos] ${clave}:`, err.code || err.message); }
  if (activo) return next();
  const usuario = req.session && req.session.usuario;
  const def = C.CATALOGO.find((c) => c.clave === clave);
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  return res.status(403).type('html').send(paginaInactiva({
    nombre: def.nombre,
    esAdmin: !!(usuario && usuario.rol === 'admin'),
    inicio: req.path.startsWith('/app/') ? '/app/inicio.html' : '/',
  }));
}

function requiereComplementoPublico(clave) {
  exigirClaveConocida(clave, 'requiereComplementoPublico');
  return async function complementoActivoOCierraPublico(req, res, next) {
    try {
      if (await C.complementoActivo(clave)) return next();
    } catch (err) {
      console.error(`[complementos] ${clave}:`, err.code || err.message);
    }
    const def = C.CATALOGO.find((c) => c.clave === clave);
    // Una página (GET /:codigo) → la página; una llamada de datos → el mismo 403 en JSON de la API. Ninguna entrega datos.
    if (req.method === 'GET' && /^\/[^/]+\/?$/.test(req.path)) {
      res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
      return res.status(403).type('html').send(paginaInactiva({ nombre: def.nombre, esAdmin: false, inicio: null }));
    }
    return respuestaJson(res, clave);
  };
}

module.exports = { requiereComplemento, requiereComplementoPublico, paginasDeComplementos, paginaInactiva, PAGINAS, MOTIVO: C.MOTIVO };
