/**
 * routes/inscripcion.routes.js — La página pública de inscripción por enlace (/i/:codigo).
 *
 * Es la hermana de /v (routes/yaVoto.routes.js) y copia su patrón: sin sesión, fuera
 * de /api (sin CSRF), `noindex` y `no-store`, la MISMA respuesta para un código
 * inexistente, desactivado o de alguien que ya no está, y un límite de intentos
 * FALLIDOS por IP que no gasta quien entra bien.
 *
 * A DIFERENCIA DE /b, /c Y /v, VA DESPUÉS DEL CANDADO DE LICENCIA (app.js). Aquellas
 * páginas atienden a alguien a quien ya se le mandó un mensaje y que no puede quedar
 * sin salida porque la campaña no pagó (la baja, la confirmación, el «Ya voté»).
 * Esta capta datos nuevos: con la licencia vencida la campaña no debe seguir
 * recogiendo gente. Decisión tomada en la orden 23.
 *
 * LA RESPUESTA NO DEPENDE DE LO QUE PASÓ: «¡Listo! Gracias por inscribirte», haya sido
 * una persona nueva, una cédula repetida, de otro líder, o un envío que el antiabuso
 * descartó. Lo ocurrido queda en `inscripcion_intentos`, que ve el coordinador.
 *
 * LA INSCRIPCIÓN NO ES UN GET. Abrir el enlace solo pinta el formulario.
 */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../config/db');
const { aspiranteDe } = require('../lib/ramas');
const { validarCedula } = require('../lib/validarCedula');
const { normalizarCedula } = require('../lib/normalizarCedula');
const { huellaDePolitica, archivarVersion } = require('../config/politicaVersiones');
const {
  buscarEnlaceActivo, leerAjustes, emitirPase, verificarPase,
} = require('../config/inscripcionEnlace');
const { inscribir, contarRecientes, anotarRechazo, coordenadasValidas, sha256, ultimos10 } = require('../config/inscripcionRegistro');
// Por el objeto y no desestructurado: así una prueba puede sustituir la inversa.
const geocoder = require('../config/geocoder');
const tarjeta = require('../config/inscripcionTarjeta');
const { comunaValida } = require('../lib/comunasDeLaCampana');

const router = express.Router();

/* LA CONSULTA DE LUGAR DE VOTACIÓN DE LA REGISTRADURÍA, escrita UNA vez en esta página. La dirección anterior
   (la del servidor «wsp») dejó de existir y los botones abrían un 404: nada falla del lado
   de la aplicación, solo quien mira la ventana lo nota. Es la misma de `URL_CONSULTA_CENSO` en
   public/js/common.js (aquello es del navegador y esto del servidor: no pueden compartir el archivo).
   SIN CÉDULA EN LA URL: la Registraduría no documenta ningún parámetro para eso, y una cédula en una dirección
   queda en el historial y en los registros de acceso. */
const URL_CONSULTA_CENSO = 'https://consultacenso.registraduria.gov.co/';

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function cabeceras(res) {
  res.set({
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
  });
}

/* Solo las respuestas fallidas gastan el cupo: los >= 400 y las páginas «no activo»
   (que responden 200, para que la tarjeta de un mensajero no se descarte) y los
   envíos que el antiabuso descartó. `res.locals.fallo` es lo que lo marca. */
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode < 400 && !res.locals.fallo,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    cabeceras(res);
    res.status(429).send(pagina({
      titulo: 'Demasiados intentos',
      cuerpo: 'Se hicieron demasiados intentos desde esta conexión. Espera unos minutos y vuelve a abrir el enlace.',
    }));
  },
}));

const CSS = `
  /* Variables y piezas de /app/estilos-app.css (se carga antes, ver pagina()). Aquí solo lo propio de esta página. */
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--fondo,#f4f6fb);color:var(--texto,#1b2333);margin:0;padding:18px 14px 40px}
  .caja{background:#fff;border-radius:var(--radio,18px);padding:24px 20px;max-width:460px;margin:0 auto;box-shadow:var(--sombra-flot,0 8px 24px rgba(8,66,152,.13))}
  h1{font-size:1.3rem;font-weight:800;color:var(--marca-azul-osc,#084298);margin:0 0 6px}
  .quien{color:var(--texto-2,#6a7590);font-size:.95rem;margin:0 0 18px;line-height:1.4}
  p{font-size:1rem;line-height:1.55;color:var(--texto-2,#6a7590);margin:0 0 14px}
  label{display:block;font-weight:700;font-size:13px;margin:14px 0 6px;color:var(--texto,#1b2333)}
  label small{font-weight:400;color:var(--texto-2,#6a7590)}
  input[type=text],input[type=tel],input[type=email],input[type=number],input[type=search],select{display:block;width:100%;min-height:56px;font-size:16px;padding:14px;border:1.5px solid transparent;border-radius:var(--radio-campo,14px);background:var(--campo,#f1f4fa);color:var(--texto,#1b2333);font-family:inherit;-webkit-appearance:none;appearance:none}
  select{padding-right:42px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='9' viewBox='0 0 14 9'%3E%3Cpath d='M1 1.5l6 6 6-6' fill='none' stroke='%236a7590' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 16px center;background-size:14px 9px}
  input::placeholder{color:var(--texto-2,#6a7590);opacity:.8}
  input:focus,select:focus{outline:none;background-color:#fff;border-color:var(--marca-azul,#0B5ED7);box-shadow:0 0 0 4px var(--foco-halo,rgba(11,94,215,.12))}
  button.gps:focus-visible,a.btn-consulta:focus-visible{outline:3px solid var(--marca-azul,#0B5ED7);outline-offset:2px}
  .fila{display:flex;gap:10px}.fila>div{flex:1;min-width:0}
  @media (max-width:479px){.fila{flex-direction:column;gap:0}}
  .acepto{display:flex;gap:10px;align-items:flex-start;margin:16px 0 4px;font-size:.92rem;line-height:1.4;color:var(--texto,#1b2333);font-weight:400}
  .acepto input{margin-top:3px;width:22px;height:22px;min-height:0;flex:none;accent-color:var(--marca-azul,#0B5ED7)}
  .canales{background:var(--campo,#f1f4fa);border-radius:var(--radio-campo,14px);padding:10px 12px;margin:10px 0}
  .canales .tit{font-size:.85rem;color:var(--texto-2,#6a7590);margin:0 0 6px}
  .canales label{display:flex;gap:8px;align-items:center;font-weight:400;margin:6px 0;font-size:.92rem}
  .canales input{width:20px;height:20px;min-height:0;accent-color:var(--marca-azul,#0B5ED7)}
  button.enviar{display:flex;align-items:center;justify-content:center;background:var(--marca-amarillo,#FFC300);color:#1b2333;border:0;border-radius:999px;width:100%;min-height:54px;font-size:16.5px;font-weight:800;padding:12px 20px;cursor:pointer;margin-top:18px;box-shadow:0 8px 20px rgba(255,195,0,.4);font-family:inherit}
  button.enviar:disabled{opacity:.6;box-shadow:none;cursor:not-allowed}
  a{color:var(--marca-azul,#0B5ED7)}
  .error{background:var(--error-fondo,#fff5f5);border:1px solid var(--error-borde,#e04848);color:var(--error,#c62828);border-radius:var(--radio-campo,14px);padding:10px 12px;margin:0 0 14px;font-size:.92rem}
  .error ul{margin:0;padding-left:18px}
  .ok{color:var(--ok,#1e6b2e);font-weight:700}
  .trampa{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
  /* Título de sección: 13px, 700, mayúsculas, azul de la marca y una línea fina debajo (igual que la app). */
  h2.seccion{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--marca-azul,#0B5ED7);
    border-bottom:1px solid var(--borde,#d5dcea);padding-bottom:6px;margin:26px 0 4px}
  h2.seccion.primero{margin-top:6px}
  button.gps{display:flex;align-items:center;justify-content:center;background:#fff;color:var(--marca-azul-osc,#084298);border:1.5px solid var(--borde,#d5dcea);border-radius:999px;width:100%;min-height:48px;font-size:1rem;font-weight:700;padding:12px;cursor:pointer;margin:8px 0 4px;font-family:inherit}
  button.gps:disabled{opacity:.6}
  a.btn-consulta{display:block;text-align:center;text-decoration:none;background:#fff;color:var(--marca-azul-osc,#084298);border:1.5px solid var(--borde,#d5dcea);border-radius:999px;font-size:1rem;font-weight:700;padding:13px 10px;margin:10px 0 4px;line-height:1.25}
  p.ayuda{font-size:.85rem;color:var(--texto-2,#6a7590);margin:0 0 4px;line-height:1.4}
  .pie{font-size:.78rem;color:var(--texto-2,#6a7590);margin-top:16px;text-align:center}
  .politica{white-space:pre-wrap;font-size:.95rem;line-height:1.55;color:var(--texto,#1b2333)}
`;

function pagina({ titulo, cuerpo, ok = false, extra = '', head = '' }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
${head}
<title>${esc(titulo)}</title>
<link rel="stylesheet" href="/app/estilos-app.css">
<style>${CSS}</style></head><body><div class="caja">
<h1>${esc(titulo)}</h1><p${ok ? ' class="ok"' : ''}>${cuerpo}</p>${extra}
</div></body></html>`;
}

// La MISMA página para código inexistente, desactivado, de alguien que ya no está, o inscripción apagada.
const NO_ACTIVO = {
  titulo: 'Enlace no activo',
  cuerpo: 'Este enlace no está activo. Si te lo dio alguien de la campaña, pídele que te envíe el actual.',
};

/* La tarjeta (vista previa) es la MISMA con o sin enlace vivo: ver config/inscripcionTarjeta.js. Si no se pudo
   armar, sale sin ella, igual para todos. */
async function metasDeTarjeta() {
  try { return await tarjeta.metasDeLaTarjeta(); } catch (_) { return ''; }
}

async function responderNoActivo(res) {
  res.locals.fallo = true;
  return res.status(200).send(pagina({ ...NO_ACTIVO, head: await metasDeTarjeta() }));
}

let marcaEnMemoria = { clave: null, texto: '', hasta: 0 };
/** El nombre de la campaña —o del aspirante, si el líder cuelga de uno— con memoria de 5 minutos por rama. */
async function nombreDeLaCampana(ramaId) {
  const clave = String(ramaId || 0);
  if (marcaEnMemoria.clave === clave && Date.now() < marcaEnMemoria.hasta) return marcaEnMemoria.texto;
  let texto = '';
  try {
    if (ramaId) {
      const [[s]] = await pool.query('SELECT nombre FROM sublicencias WHERE usuario_id = ? AND activa = 1', [ramaId]);
      texto = String((s && s.nombre) || '').trim();
    }
    if (!texto) {
      const [[c]] = await pool.query('SELECT marca_titulo FROM configuracion_campana WHERE id = 1');
      texto = String((c && c.marca_titulo) || '').trim();
    }
  } catch (_) { /* sin nombre: la página sale igual */ }
  marcaEnMemoria = { clave, texto, hasta: Date.now() + 5 * 60 * 1000 };
  return texto;
}

/** La política vigente y su huella. Se archiva al mostrarla (igual que /api/contenido): es la evidencia. */
async function politicaVigente() {
  let titulo = 'Política de tratamiento de datos', contenido = '';
  try {
    const [[f]] = await pool.query("SELECT titulo, contenido FROM contenido_paginas WHERE clave = 'politica_privacidad'");
    if (f) { titulo = f.titulo || titulo; contenido = f.contenido || ''; }
  } catch (_) { /* sin tabla: sin política */ }
  const huella = contenido.trim() ? huellaDePolitica(contenido) : null;
  if (huella) archivarVersion({ clave: 'politica_privacidad', titulo, contenido, usuarioId: null, usuarioNombre: 'archivado al entregarse' });
  return { titulo, contenido, huella };
}

/* LOS LARGOS SON LOS DE LAS COLUMNAS de `votantes` (direccion 255, departamento_residencia 100,
   ciudad_residencia 100, comuna_corregimiento_residencia 120, barrio_residencia 120, email 150), que
   es lo que el alta normal acaba respetando en la base. */
const LIMITES = { email: 150, direccion: 255, departamento_residencia: 100, ciudad_residencia: 100,
                  comuna_corregimiento_residencia: 120, barrio_residencia: 120 };

/** Recorta, quita caracteres de control y colapsa espacios. Vacío → ''. */
function sanear(texto, max) {
  return String(texto == null ? '' : texto).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Todo lo que se repinta del cuerpo, ya saneado: la misma forma en cada vuelta al formulario. */
function valoresCrudos(cuerpo) {
  const v = {
    nombre: sanear(cuerpo.nombre, 121),   // 121 y no 120: un nombre más largo se RECHAZA, no se recorta en silencio
    cedula: String(cuerpo.cedula || '').replace(/[\s.\-]/g, '').slice(0, 15),
    telefono: String(cuerpo.telefono || '').replace(/\D/g, '').slice(0, 14),
    puesto_id: String(cuerpo.puesto_id || '').slice(0, 12), mesa: String(cuerpo.mesa || '').slice(0, 4),
    gps_lat: String(cuerpo.gps_lat || '').trim().slice(0, 24), gps_lon: String(cuerpo.gps_lon || '').trim().slice(0, 24),
    autoriza: cuerpo.autoriza === '1', canal_sms: cuerpo.canal_sms === '1',
    canal_whatsapp: cuerpo.canal_whatsapp === '1', canal_email: cuerpo.canal_email === '1',
  };
  for (const [k, max] of Object.entries(LIMITES)) v[k] = sanear(cuerpo[k], max);
  return v;
}

/** Lo que la campaña tiene configurado para el territorio (departamento y ciudad por defecto, y si usa comunas y barrios). */
async function configTerritorio() {
  try {
    const [[c]] = await pool.query(
      `SELECT territorio_departamento, territorio_ciudad, departamento, ciudad, ciudad_tiene_comunas, usar_nombre_barrios
         FROM configuracion_campana WHERE id = 1`);
    if (!c) return { departamento: '', ciudad: '', usaComunas: true, usaBarrios: true };
    return {
      departamento: c.territorio_departamento || c.departamento || '',
      ciudad: c.territorio_ciudad || c.ciudad || '',
      // Como en el formulario del celular: en 0, ese campo deja de mostrarse.
      usaComunas: c.ciudad_tiene_comunas !== 0, usaBarrios: c.usar_nombre_barrios !== 0,
    };
  } catch (_) {
    return { departamento: '', ciudad: '', usaComunas: true, usaBarrios: true };
  }
}

function nombreCorto(nombre) {
  return String(nombre || '').trim().split(/\s+/).slice(0, 3).join(' ').slice(0, 60);
}

/** El formulario. `v` son los valores a repintar tras un error; `errores` una lista de textos. */
async function formulario(enlace, { v: v0 = {}, errores = [], aviso = '' } = {}) {
  let v = v0;
  const ramaId = await aspiranteDe(pool, enlace.usuario_id).catch(() => null);
  const campana = await nombreDeLaCampana(ramaId);
  const pol = await politicaVigente();
  const pase = emitirPase(enlace.codigo, pol.huella);
  const quien = `Te inscribe <strong>${esc(nombreCorto(enlace.nombre))}</strong>${campana ? ` · ${esc(campana)}` : ''}`;
  const terr = await configTerritorio();
  // Primera carga (sin valores): departamento y ciudad de la campaña, editables. Al repintar tras un error
  // se respeta lo que la persona dejó, aunque lo haya vaciado.
  const primera = v.departamento_residencia === undefined;
  if (primera) { v = { ...v, departamento_residencia: terr.departamento, ciudad_residencia: terr.ciudad }; }
  // Esos dos vienen de la campaña, no de la persona: la propuesta del GPS puede reemplazarlos mientras no los toque.
  const autoDep = primera && v.departamento_residencia ? ' data-auto="1"' : '';
  const autoCiu = primera && v.ciudad_residencia ? ' data-auto="1"' : '';
  const metas = await metasDeTarjeta();
  const val = (k) => esc(v[k] || '');
  const chk = (k) => (v[k] ? ' checked' : '');
  const cod = encodeURIComponent(enlace.codigo);
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
${metas}
<title>Inscríbete</title>
<link rel="stylesheet" href="/app/estilos-app.css">
<style>${CSS}</style></head><body><div class="caja">
<h1>Inscríbete</h1>
<p class="quien">${quien}</p>
${errores.length ? `<div class="error"><ul>${errores.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
${aviso ? `<div class="error">${esc(aviso)}</div>` : ''}
<form method="post" action="/i/${cod}" autocomplete="on" id="f">

  <h2 class="seccion primero">Datos personales</h2>
  <label for="cedula">Número de cédula <small>(obligatorio)</small></label>
  <input type="text" id="cedula" name="cedula" value="${val('cedula')}" inputmode="numeric" autocomplete="off" required maxlength="15">
  <label for="nombre">Nombre completo <small>(obligatorio)</small></label>
  <input type="text" id="nombre" name="nombre" value="${val('nombre')}" autocomplete="name" required maxlength="120">

  <h2 class="seccion">Datos de contacto</h2>
  <p class="ayuda">Solo el celular es obligatorio. Lo demás le sirve a la campaña para ubicarte y escribirte mejor.</p>
  <button type="button" class="gps" id="btn-gps">Usar mi ubicación (GPS)</button>
  <p class="ayuda" id="estado-gps" role="status" aria-live="polite">${v.gps_lat ? 'Ubicación tomada.' : 'Tócalo si estás en tu casa; si no, escribe la dirección.'}</p>
  <input type="hidden" name="gps_lat" id="gps_lat" value="${val('gps_lat')}">
  <input type="hidden" name="gps_lon" id="gps_lon" value="${val('gps_lon')}">
  <label for="direccion">Dirección de residencia <small>(opcional)</small></label>
  <input type="text" id="direccion" name="direccion" value="${val('direccion')}" autocomplete="street-address" maxlength="255" placeholder="Ej. Calle 10 #5-20">
  <label for="departamento">Departamento <small>(opcional)</small></label>
  <input type="text" id="departamento" name="departamento_residencia" value="${val('departamento_residencia')}"${autoDep} list="lista-departamentos" autocomplete="off" maxlength="100">
  <datalist id="lista-departamentos"></datalist>
  <label for="ciudad">Ciudad <small>(opcional)</small></label>
  <input type="text" id="ciudad" name="ciudad_residencia" value="${val('ciudad_residencia')}"${autoCiu} list="lista-ciudades" autocomplete="off" maxlength="100">
  <datalist id="lista-ciudades"></datalist>
  ${terr.usaComunas ? `<label for="comuna">Comuna / corregimiento <small>(opcional)</small></label>
  <input type="text" id="comuna" name="comuna_corregimiento_residencia" value="${val('comuna_corregimiento_residencia')}" list="lista-comunas" autocomplete="off" maxlength="120" placeholder="Ej. Comuna 1 - Atardeceres">
  <datalist id="lista-comunas"></datalist>` : ''}
  ${terr.usaBarrios ? `<label for="barrio">Barrio / vereda <small>(opcional)</small></label>
  <input type="text" id="barrio" name="barrio_residencia" value="${val('barrio_residencia')}" list="lista-barrios" autocomplete="off" maxlength="120" placeholder="Ej. Arenillo">
  <datalist id="lista-barrios"></datalist>` : ''}
  <label for="telefono">Celular <small>(obligatorio)</small></label>
  <input type="tel" id="telefono" name="telefono" value="${val('telefono')}" inputmode="numeric" autocomplete="tel-national" required maxlength="16" placeholder="3001234567">
  <label for="email">Correo electrónico <small>(opcional)</small></label>
  <input type="email" id="email" name="email" value="${val('email')}" autocomplete="email" maxlength="150">

  <h2 class="seccion">Dónde votas</h2>
  <a class="btn-consulta" role="button" href="${URL_CONSULTA_CENSO}" target="_blank" rel="noopener noreferrer">Consultar mi lugar de votación</a>
  <p class="ayuda">Consulta y vuelve aquí para elegir tu puesto y mesa</p>
  <div id="caja-puesto" style="display:none">
    <label for="buscar-puesto">Buscar tu puesto <small>(si lo sabes)</small></label>
    <input type="search" id="buscar-puesto" autocomplete="off" placeholder="Escribe parte del nombre">
    <label for="puesto">Puesto de votación</label>
    <select id="puesto" name="puesto_id"><option value="">No sé</option></select>
    <label for="mesa">Mesa</label>
    <select id="mesa" name="mesa"><option value="">No sé</option></select>
  </div>

  <h2 class="seccion">Tratamiento de datos personales</h2>
  <p class="ayuda">Lee cómo la campaña trata tus datos:
    <a href="/i/${cod}/politica" target="_blank" rel="noopener">política de tratamiento de datos vigente</a>.</p>
  <label class="acepto"><input type="checkbox" name="autoriza" value="1"${chk('autoriza')} required>
    <span><strong>(obligatorio)</strong> Autorizo que la campaña guarde y trate mis datos personales según esa política.</span></label>
  <div class="canales">
    <p class="tit">Y que me escriba por (puedes dejar vacío lo que no quieras):</p>
    <label><input type="checkbox" name="canal_sms" value="1"${chk('canal_sms')}> Mensaje de texto (SMS)</label>
    <label><input type="checkbox" name="canal_whatsapp" value="1"${chk('canal_whatsapp')}> WhatsApp</label>
    <label><input type="checkbox" name="canal_email" value="1"${chk('canal_email')}> Correo electrónico</label>
  </div>

  <div class="trampa" aria-hidden="true"><label>No llenar este campo
    <input type="text" name="sitio_web" value="" tabindex="-1" autocomplete="off"></label></div>
  <input type="hidden" name="pase" value="${esc(pase || '')}">
  <button type="submit" class="enviar" id="btn">Inscribirme</button>
</form>
<p class="pie">Puedes pedir en cualquier momento que dejen de escribirte.</p>
</div>
<script>
(function(){
  var cod=${JSON.stringify(enlace.codigo)};
  var selP=document.getElementById('puesto'), selM=document.getElementById('mesa'), bus=document.getElementById('buscar-puesto');
  var previoP=${JSON.stringify(v.puesto_id || '')}, previoM=${JSON.stringify(v.mesa || '')};
  var puestos=[];
  // Sin tildes ni mayúsculas, para que «ESCUELA SAN JOSE» salga al escribir «san josé».
  function plano(t){return String(t||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase();}
  function pintarPuestos(){
    var q=plano(bus.value).trim(), actual=selP.value;
    selP.innerHTML='<option value="">No sé</option>';
    var n=0;
    puestos.forEach(function(p){
      if(q&&plano(p.nombre).indexOf(q)<0&&String(p.id)!==actual) return;
      var o=document.createElement('option');o.value=p.id;o.textContent=p.nombre;selP.appendChild(o);n++;
    });
    if(q&&!n){var s=document.createElement('option');s.value='';s.disabled=true;s.textContent='Ningún puesto coincide';selP.appendChild(s);}
    selP.value=actual;
  }
  function mesas(){
    var p=puestos.filter(function(x){return String(x.id)===selP.value})[0];
    selM.innerHTML='<option value="">No sé</option>';
    if(!p||!p.cantidad_mesas) return;
    for(var i=1;i<=p.cantidad_mesas;i++){var o=document.createElement('option');o.value=i;o.textContent='Mesa '+i;selM.appendChild(o);}
    if(previoM){selM.value=previoM;previoM='';}
  }
  fetch('/i/'+encodeURIComponent(cod)+'/puestos',{headers:{Accept:'application/json'}}).then(function(r){return r.ok?r.json():[]}).then(function(l){
    if(!Array.isArray(l)||!l.length) return;
    puestos=l; pintarPuestos();
    if(previoP){selP.value=previoP;previoP='';mesas();}
    document.getElementById('caja-puesto').style.display='block';
  }).catch(function(){});
  selP.addEventListener('change',mesas);
  bus.addEventListener('input',pintarPuestos);

  // Listas de la campaña para departamento, ciudad, comuna/corregimiento y barrio/vereda. Si no hay (o el
  // servicio no responde) los campos siguen siendo texto libre.
  var iDir=document.getElementById('direccion'), iDep=document.getElementById('departamento'), iCiu=document.getElementById('ciudad'),
      iCom=document.getElementById('comuna'), iBar=document.getElementById('barrio');
  function llenar(id,nombres){var d=document.getElementById(id);if(!d)return;d.innerHTML='';
    (nombres||[]).forEach(function(n){var o=document.createElement('option');o.value=n;d.appendChild(o);});}
  var t=null;
  function listas(){
    var q='?departamento='+encodeURIComponent(iDep?iDep.value:'')+'&ciudad='+encodeURIComponent(iCiu?iCiu.value:'')+
          '&zona='+encodeURIComponent(iCom?iCom.value:'');
    fetch('/i/'+encodeURIComponent(cod)+'/territorio'+q,{headers:{Accept:'application/json'}}).then(function(r){return r.ok?r.json():null}).then(function(d){
      if(!d)return; llenar('lista-departamentos',d.departamentos); llenar('lista-ciudades',d.municipios);
      llenar('lista-comunas',d.zonas); llenar('lista-barrios',d.barrios);
    }).catch(function(){});
  }
  function luego(){clearTimeout(t);t=setTimeout(listas,300);}
  [iDep,iCiu,iCom].forEach(function(e){if(e)e.addEventListener('input',luego);});
  // Lo que la persona escribe deja de ser «valor por defecto» (departamento y ciudad de la campaña).
  [iDir,iDep,iCiu,iCom,iBar].forEach(function(e){if(e)e.addEventListener('input',function(){e.removeAttribute('data-auto');});});
  listas();

  // GPS: el navegador solo pregunta por la ubicación cuando se toca el botón, nunca al abrir la página.
  var bGps=document.getElementById('btn-gps'), estado=document.getElementById('estado-gps');
  var hLat=document.getElementById('gps_lat'), hLon=document.getElementById('gps_lon');
  function aviso(txt){estado.textContent=txt;}
  // Una propuesta no pisa lo escrito: solo entra en un campo vacío o con el valor por defecto sin tocar.
  function proponer(el,valor){
    if(!el||!valor) return;
    if(el.value.trim()===''||el.getAttribute('data-auto')==='1'){el.value=valor;el.removeAttribute('data-auto');}
  }
  function ubicar(opc){return new Promise(function(ok,mal){navigator.geolocation.getCurrentPosition(ok,mal,opc);});}
  bGps.addEventListener('click',function(){
    if(!navigator.geolocation){aviso('Este teléfono o navegador no permite obtener la ubicación. Escribe tu dirección.');return;}
    bGps.disabled=true; aviso('Buscando tu ubicación…');
    ubicar({enableHighAccuracy:true,timeout:15000,maximumAge:60000}).catch(function(e){
      if(e&&e.code===1) throw e;   // permiso negado: no tiene sentido reintentar
      return ubicar({enableHighAccuracy:false,timeout:10000,maximumAge:120000});
    }).then(function(pos){
      var la=pos.coords.latitude, lo=pos.coords.longitude;
      hLat.value=String(la); hLon.value=String(lo);
      aviso('Ubicación tomada.');
      var cuerpo=new URLSearchParams({lat:String(la),lon:String(lo)});
      return fetch('/i/'+encodeURIComponent(cod)+'/ubicacion',{method:'POST',headers:{Accept:'application/json'},body:cuerpo})
        .then(function(r){return r.ok?r.json():null}).then(function(d){
          if(!d||!d.disponible) return;
          proponer(iDir,d.direccion); proponer(iBar,d.barrio); proponer(iCiu,d.ciudad); proponer(iDep,d.departamento);
          aviso('Ubicación tomada. Revisa lo que se llenó y corrígelo si hace falta.');
          listas();
        }).catch(function(){});
    }).catch(function(e){
      aviso(e&&e.code===1?'No diste permiso para usar tu ubicación. Escribe tu dirección.':'No se pudo obtener tu ubicación. Escribe tu dirección.');
    }).then(function(){bGps.disabled=false;});
  });

  var f=document.getElementById('f'),b=document.getElementById('btn');
  f.addEventListener('submit',function(){b.disabled=true;b.textContent='Enviando…';});
  window.addEventListener('pageshow',function(){b.disabled=false;b.textContent='Inscribirme';});
})();
</script></body></html>`;
}

// ---------------------------------------------------------------------------

/* LA IMAGEN DE LA TARJETA. Va ANTES de `/:codigo`. Pública y sin código: la ve el robot de WhatsApp. Con logo de
   la campaña sirve una copia de 1200 × 630 en JPEG (ver config/inscripcionTarjeta.js); sin logo, o si no se puede
   preparar, la imagen genérica. Se puede guardar una hora: lleva `?v=` que cambia cuando cambia el logo. */
router.get('/og/imagen', async (req, res) => {
  try {
    const buffer = await tarjeta.imagenDelLogo();
    res.set({ 'Cache-Control': 'public, max-age=3600', 'X-Robots-Tag': 'noindex' });
    if (buffer) { res.type('image/jpeg'); return res.send(buffer); }
    return res.type('image/png').sendFile(tarjeta.GENERICA);
  } catch (err) {
    console.error('inscripcion og imagen:', err.code || err.message);
    return res.status(404).end();
  }
});

router.get('/:codigo', async (req, res) => {
  cabeceras(res);
  try {
    const ajustes = await leerAjustes();
    const enlace = ajustes.habilitado ? await buscarEnlaceActivo(req.params.codigo) : null;
    if (!enlace) return await responderNoActivo(res);
    res.send(await formulario(enlace));
  } catch (err) {
    console.error('inscripcion GET:', err.code || err.message);
    res.status(500).send(pagina({ titulo: 'No se pudo abrir', cuerpo: 'Intenta de nuevo en unos minutos.' }));
  }
});

/** Los puestos de la campaña (los del Día D de la rama del líder), de solo lectura. */
router.get('/:codigo/puestos', async (req, res) => {
  cabeceras(res);
  try {
    const ajustes = await leerAjustes();
    const enlace = ajustes.habilitado ? await buscarEnlaceActivo(req.params.codigo) : null;
    if (!enlace) { res.locals.fallo = true; return res.json([]); }
    const dueno = (await aspiranteDe(pool, enlace.usuario_id)) || 0;
    const [filas] = await pool.query(
      'SELECT id, nombre, cantidad_mesas FROM dia_d_puestos_votacion WHERE aspirante_id = ? ORDER BY nombre', [dueno]);
    res.json(filas);
  } catch (err) {
    console.error('inscripcion puestos:', err.code || err.message);
    res.json([]);
  }
});

/**
 * Las listas de territorio de la CAMPAÑA para los desplegables del formulario: de solo lectura y acotadas
 * por la propia vista `territorios` (que ya limita lo que ve esta campaña al ámbito que declaró). Mismo
 * criterio que el formulario de la ficha: las comunas/corregimientos cuelgan del municipio; los barrios y
 * veredas, de una comuna o corregimiento Y TAMBIÉN directo del municipio (así cuelgan las veredas del DANE).
 *
 * Sin código vivo devuelve vacío (y gasta cupo, como las demás). Nunca da error: sin listas, texto libre.
 */
router.get('/:codigo/territorio', async (req, res) => {
  cabeceras(res);
  const vacio = { departamentos: [], municipios: [], zonas: [], barrios: [] };
  try {
    const ajustes = await leerAjustes();
    const enlace = ajustes.habilitado ? await buscarEnlaceActivo(req.params.codigo) : null;
    if (!enlace) { res.locals.fallo = true; return res.json(vacio); }
    const dep = sanear(req.query.departamento, 100), ciu = sanear(req.query.ciudad, 100), zona = sanear(req.query.zona, 120);
    const nombres = (filas) => [...new Set(filas.map(f => f.nombre))];

    const [deps] = await pool.query("SELECT nombre FROM territorios WHERE tipo = 'departamento' ORDER BY nombre LIMIT 100");
    let depId = null;
    if (dep) {
      const [[d]] = await pool.query("SELECT id FROM territorios WHERE tipo = 'departamento' AND nombre = ? LIMIT 1", [dep]);
      depId = d ? d.id : null;
    }
    const [munis] = await pool.query(
      `SELECT nombre FROM territorios WHERE tipo = 'municipio' ${depId ? 'AND padre_id = ?' : ''} ORDER BY nombre LIMIT 1500`,
      depId ? [depId] : []);

    let zonas = [], barrios = [];
    if (ciu) {
      const [[m]] = await pool.query(
        `SELECT id FROM territorios WHERE tipo = 'municipio' AND nombre = ? ${depId ? 'AND padre_id = ?' : ''} LIMIT 1`,
        depId ? [ciu, depId] : [ciu]);
      if (m) {
        const [z] = await pool.query(
          "SELECT id, nombre FROM territorios WHERE tipo IN ('comuna','corregimiento') AND padre_id = ? ORDER BY nombre LIMIT 500", [m.id]);
        zonas = z;
        const zonaElegida = zona ? z.find(x => x.nombre.toLowerCase() === zona.toLowerCase()) : null;
        const [b] = zonaElegida
          ? await pool.query("SELECT nombre FROM territorios WHERE tipo IN ('barrio','vereda') AND padre_id = ? ORDER BY nombre LIMIT 3000", [zonaElegida.id])
          : await pool.query(
              `SELECT nombre FROM territorios WHERE tipo IN ('barrio','vereda')
                  AND (padre_id = ? OR padre_id IN (SELECT id FROM territorios WHERE tipo IN ('comuna','corregimiento') AND padre_id = ?))
                ORDER BY nombre LIMIT 3000`, [m.id, m.id]);
        barrios = b;
      }
    }
    res.json({ departamentos: nombres(deps), municipios: nombres(munis), zonas: nombres(zonas), barrios: nombres(barrios) });
  } catch (err) {
    // Sin la tabla/vista de territorios (campaña sin catálogo) el formulario sigue con texto libre.
    if (err.code !== 'ER_NO_SUCH_TABLE') console.error('inscripcion territorio:', err.code || err.message);
    res.json(vacio);
  }
});

/* ---------------------------------------------------------------------------
   /i/:codigo/ubicacion — de coordenadas a una dirección que PROPONER (geocodificación inversa).

   CADA LLAMADA GASTA UNA CONSULTA DE GOOGLE, y la página es pública, así que tiene dos topes que cuentan
   TODAS las llamadas (no solo las fallidas, como el limitador de arriba): por IP y por enlace. Viven en
   memoria: un reinicio los pone en cero, que para un tope de gasto es aceptable. Una IP compartida (un
   evento con una sola wifi) comparte su cupo; por eso es holgado.
   Sin clave de Google, o ante cualquier fallo, responde {disponible:false}: el formulario ya guardó las
   coordenadas en los campos ocultos y sigue su camino. */
const TOPES_UBICACION = { ip: { max: 20, ventanaMs: 15 * 60 * 1000 }, enlace: { max: 400, ventanaMs: 24 * 60 * 60 * 1000 } };
const usosUbicacion = new Map();

function gastarCupo(clave, { max, ventanaMs }) {
  const ahora = Date.now();
  const marcas = (usosUbicacion.get(clave) || []).filter(t => ahora - t < ventanaMs);
  if (marcas.length >= max) { usosUbicacion.set(clave, marcas); return false; }
  marcas.push(ahora);
  usosUbicacion.set(clave, marcas);
  if (usosUbicacion.size > 2000) {   // barrido: las claves cuyas marcas ya vencieron
    for (const [k, m] of usosUbicacion) {
      if (!m.length || ahora - m[m.length - 1] > TOPES_UBICACION.enlace.ventanaMs) usosUbicacion.delete(k);
    }
  }
  return true;
}
router.reiniciarCupos = () => usosUbicacion.clear();   // para la prueba
router.limpiarTarjeta = () => tarjeta.limpiarMemoria();  // para la prueba

// Un «plus code» («RJ4X+9P Manizales») es lo que Google da en el campo; no sirve como dirección.
const RE_PLUS_CODE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{0,3}(\s|$)/i;

router.post('/:codigo/ubicacion', async (req, res) => {
  cabeceras(res);
  const nada = { disponible: false };
  try {
    const ajustes = await leerAjustes();
    const enlace = ajustes.habilitado ? await buscarEnlaceActivo(req.params.codigo) : null;
    if (!enlace) { res.locals.fallo = true; return res.json(nada); }
    const c = coordenadasValidas((req.body || {}).lat, (req.body || {}).lon);
    if (!c) { res.locals.fallo = true; return res.status(400).json(nada); }
    if (!gastarCupo('ip:' + req.ip, TOPES_UBICACION.ip) || !gastarCupo('enlace:' + enlace.enlace_id, TOPES_UBICACION.enlace)) {
      return res.status(429).json(nada);
    }
    const r = await geocoder.geocodificarInversa(c.latitud, c.longitud);
    if (!r) return res.json(nada);
    const d = r.detalle || {};
    // De «Cra. 23 #20-30, Manizales, Caldas, Colombia» solo la primera parte: lo demás va en sus propios campos.
    let direccion = String(r.direccion || '').split(',')[0].trim();
    if (RE_PLUS_CODE.test(direccion) || /^colombia$/i.test(direccion)) direccion = '';
    const salida = {
      direccion: sanear(direccion, LIMITES.direccion), barrio: sanear(d.suburb, LIMITES.barrio_residencia),
      ciudad: sanear(d.city, LIMITES.ciudad_residencia), departamento: sanear(d.state, LIMITES.departamento_residencia),
    };
    res.json({ disponible: !!(salida.direccion || salida.barrio || salida.ciudad || salida.departamento), ...salida });
  } catch (err) {
    // Sin clave de Google es lo esperable en una campaña que no la tiene: no se anota cada vez.
    if (!/GOOGLE_MAPS_API_KEY/.test(String(err && err.message))) console.error('inscripcion ubicacion:', String(err && err.message).slice(0, 120));
    res.json(nada);
  }
});

router.get('/:codigo/politica', async (req, res) => {
  cabeceras(res);
  try {
    const ajustes = await leerAjustes();
    const enlace = ajustes.habilitado ? await buscarEnlaceActivo(req.params.codigo) : null;
    if (!enlace) return await responderNoActivo(res);
    const pol = await politicaVigente();
    res.send(pagina({
      titulo: pol.titulo,
      cuerpo: pol.contenido.trim() ? '' : 'La campaña todavía no ha publicado su política de tratamiento de datos.',
      extra: pol.contenido.trim() ? `<div class="politica">${esc(pol.contenido)}</div>` : '',
    }));
  } catch (err) {
    console.error('inscripcion politica:', err.code || err.message);
    res.status(500).send(pagina({ titulo: 'No se pudo abrir', cuerpo: 'Intenta de nuevo en unos minutos.' }));
  }
});

// ---------------------------------------------------------------------------

const RE_NOMBRE = /^[\p{L}\p{M}'.\- ]+$/u;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Valida el cuerpo. Devuelve { datos, errores, valores } — `valores` es lo que se repinta. */
async function validar(cuerpo, enlace) {
  const errores = [];
  const valores = valoresCrudos(cuerpo);
  const { nombre, email } = valores;
  const cedulaCruda = valores.cedula;
  let telefono = valores.telefono;
  if (telefono.length === 12 && telefono.startsWith('57')) { telefono = telefono.slice(2); valores.telefono = telefono; }

  if (nombre.length < 5 || nombre.length > 120 || nombre.split(' ').length < 2 || !RE_NOMBRE.test(nombre)) {
    errores.push('Escribe tu nombre completo (nombre y apellido).');
  }
  let cedula = null;
  const r = validarCedula({
    cedula: cedulaCruda,
    primerNombre: nombre.split(' ')[0] || '', primerApellido: nombre.split(' ').slice(-1)[0] || '',
  }, []);
  if (r.nivel === 'bloqueo' || !r.cedula) errores.push('El número de cédula no es válido. Revísalo.');
  else cedula = normalizarCedula(r.cedula);   // solo dígitos, sin ceros a la izquierda: lo que se compara y se guarda
  if (!/^3\d{9}$/.test(telefono)) errores.push('Escribe tu celular de 10 dígitos (empieza por 3).');
  if (email && !RE_EMAIL.test(email)) errores.push('El correo no parece válido.');
  if (!valores.autoriza) errores.push('Para inscribirte debes aceptar el tratamiento de tus datos.');

  /* EL GPS. Dos campos ocultos que el servidor NO da por buenos: números, y dentro de Colombia. Unas
     coordenadas que no pasan se descartan SIN error —quien se inscribe no puede corregir un campo oculto, y
     perder la inscripción por eso sería peor— y la ficha se geocodifica por su dirección, como siempre. */
  let gps = null;
  if (valores.gps_lat || valores.gps_lon) gps = coordenadasValidas(valores.gps_lat, valores.gps_lon);
  if (!gps) { valores.gps_lat = ''; valores.gps_lon = ''; }

  /* LA COMUNA, SOLO SI ES DE LA CAMPAÑA (orden 36). La lista del formulario es una sugerencia (<datalist>): la
     persona podía escribir «Manizales» o «Caldas» y quedaba guardado como comuna. Con la campaña teniendo lista,
     lo que no está en ella se guarda vacío; sin error ni mensaje —quien se inscribe no puede arreglarlo y perder
     la inscripción por esto sería peor— y sin lista el texto sigue libre. */
  if (valores.comuna_corregimiento_residencia) {
    const rc = await comunaValida(pool, valores.comuna_corregimiento_residencia);
    if (rc.descartada) valores.comuna_corregimiento_residencia = '';
  }

  let puesto = null, mesa = null;
  if (valores.puesto_id) {
    const dueno = (await aspiranteDe(pool, enlace.usuario_id)) || 0;
    const [[p]] = await pool.query(
      'SELECT id, nombre, cantidad_mesas, ctc_puesto_id FROM dia_d_puestos_votacion WHERE id = ? AND aspirante_id = ?',
      [Number(valores.puesto_id) || 0, dueno]);
    if (!p) errores.push('Elige un puesto de la lista, o déjalo sin elegir.');
    else {
      puesto = { id: p.id, nombre: p.nombre, ctc_puesto_id: p.ctc_puesto_id || null, departamento: null, municipio: null };
      if (p.ctc_puesto_id) {
        try {
          const [[c]] = await pool.query(
            `SELECT m.nombre AS municipio, d.nombre AS departamento
               FROM territoriosdb.ctc_puestos_votacion cp
               JOIN territoriosdb.ctc_territorios m ON m.id = cp.municipio_id
               JOIN territoriosdb.ctc_territorios d ON d.id = m.padre_id WHERE cp.id = ?`, [p.ctc_puesto_id]);
          if (c) { puesto.municipio = c.municipio; puesto.departamento = c.departamento; }
        } catch (_) { /* sin permiso sobre el catálogo: se guarda sin municipio */ }
      }
      if (valores.mesa) {
        const n = Number(valores.mesa);
        if (!Number.isInteger(n) || n < 1 || (p.cantidad_mesas && n > p.cantidad_mesas)) errores.push('Esa mesa no existe en el puesto.');
        else mesa = n;
      }
    }
  }
  return {
    errores, valores,
    datos: errores.length ? null : {
      nombre, cedula, telefono, email: email || null, puesto, mesa, gps,
      // Recortado y saneado arriba (`sanear`); vacío → null, que es lo que significa «no lo dijo».
      contacto: {
        direccion: valores.direccion || null, departamento: valores.departamento_residencia || null,
        ciudad: valores.ciudad_residencia || null, comuna: valores.comuna_corregimiento_residencia || null,
        barrio: valores.barrio_residencia || null,
      },
      canales: { sms: valores.canal_sms, whatsapp: valores.canal_whatsapp, email: valores.canal_email },
    },
  };
}

function gracias(sms) {
  return pagina({
    titulo: '¡Listo!',
    ok: true,
    cuerpo: 'Gracias por inscribirte.' + (sms
      ? ' Te enviaremos un mensaje de texto para confirmar tu autorización: ábrelo y toca el botón.' : ''),
  });
}

router.post('/:codigo', async (req, res) => {
  cabeceras(res);
  const cuerpo = req.body || {};
  const ip = req.ip;
  const navegador = req.get('user-agent');
  try {
    const ajustes = await leerAjustes();
    const enlace = ajustes.habilitado ? await buscarEnlaceActivo(req.params.codigo) : null;
    if (!enlace) return await responderNoActivo(res);

    const quiereSms = cuerpo.canal_sms === '1';

    // 1) Trampa: un campo que una persona no ve y un robot sí llena. Se responde «Listo» igual.
    if (String(cuerpo.sitio_web || '').trim() !== '') {
      res.locals.fallo = true;
      await anotarRechazo({ enlaceId: enlace.enlace_id, motivo: 'honeypot', ip, navegador });
      return res.send(gracias(quiereSms));
    }

    // 2) El pase: la página se pidió hace un rato, y no hace más de 12 horas.
    const pase = verificarPase(enlace.codigo, cuerpo.pase);
    if (!pase.ok) {
      return res.send(await formulario(enlace, {
        v: valoresCrudos(cuerpo),
        aviso: 'La página caducó. Revisa tus datos y vuelve a enviar.',
      }));
    }
    if (pase.edadSeg < Number(ajustes.segundos_minimos)) {
      res.locals.fallo = true;
      await anotarRechazo({ enlaceId: enlace.enlace_id, motivo: 'muy_rapido', ip, navegador });
      return res.send(await formulario(enlace, {
        v: valoresCrudos(cuerpo),
        aviso: 'Revisa tus datos y vuelve a enviar en unos segundos.',
      }));
    }

    // 3) Validación. Errores de digitación se devuelven en la misma página (200: no gastan el cupo por IP).
    const { datos, errores, valores } = await validar(cuerpo, enlace);
    if (!datos) return res.send(await formulario(enlace, { v: valores, errores }));

    // 4) Topes. Por teléfono se responde «Listo» (no se delata nada); el del enlace sí se dice: no es un secreto.
    const telefonoHash = sha256(ultimos10(datos.telefono));
    const { porEnlace, porTelefono } = await contarRecientes({ enlaceId: enlace.enlace_id, telefonoHash });
    if (porTelefono >= Number(ajustes.limite_telefono_dia)) {
      res.locals.fallo = true;
      await anotarRechazo({ enlaceId: enlace.enlace_id, motivo: 'tope_telefono', telefonoHash, ip, navegador });
      return res.send(gracias(quiereSms));
    }
    if (porEnlace >= Number(ajustes.limite_enlace_dia)) {
      res.locals.fallo = true;
      return res.send(pagina({
        titulo: 'Hoy no es posible',
        cuerpo: 'Este enlace alcanzó el límite de inscripciones de hoy. Vuelve a intentarlo mañana o pídele a quien te lo dio que te ayude a registrarte.',
      }));
    }

    // 5) Inscribir. Pase lo que pase adentro, la respuesta es la misma.
    await inscribir({ enlace, datos, ip, navegador, huellaPolitica: pase.huellaPolitica });
    res.send(gracias(datos.canales.sms));
  } catch (err) {
    console.error('inscripcion POST:', err.code || err.message);
    res.status(500).send(pagina({ titulo: 'No se pudo inscribir', cuerpo: 'Intenta de nuevo en unos minutos.' }));
  }
});

module.exports = router;
