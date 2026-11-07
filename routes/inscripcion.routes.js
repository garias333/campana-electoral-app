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
const { huellaDePolitica, archivarVersion } = require('../config/politicaVersiones');
const {
  buscarEnlaceActivo, leerAjustes, emitirPase, verificarPase,
} = require('../config/inscripcionEnlace');
const { inscribir, contarRecientes, anotarRechazo, sha256, ultimos10 } = require('../config/inscripcionRegistro');

const router = express.Router();

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
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#F3F5F8;color:#161B26;margin:0;padding:18px 14px 40px}
  .caja{background:#fff;border-radius:16px;padding:24px 20px;max-width:460px;margin:0 auto;box-shadow:0 10px 34px rgba(16,35,63,.12)}
  h1{font-size:1.3rem;color:#10233F;margin:0 0 6px}
  .quien{color:#5B6472;font-size:.95rem;margin:0 0 18px;line-height:1.4}
  p{font-size:1rem;line-height:1.55;color:#5B6472;margin:0 0 14px}
  label{display:block;font-weight:600;font-size:.9rem;margin:14px 0 5px;color:#10233F}
  label small{font-weight:400;color:#6B7280}
  input[type=text],input[type=tel],input[type=email],input[type=number],select{width:100%;font-size:16px;padding:12px;border:1px solid #C9D1DC;border-radius:10px;background:#fff;color:#161B26}
  input:focus,select:focus{outline:2px solid #0B5ED7;outline-offset:1px}
  .fila{display:flex;gap:10px}.fila>div{flex:1}
  .acepto{display:flex;gap:10px;align-items:flex-start;margin:16px 0 4px;font-size:.92rem;line-height:1.4;color:#161B26;font-weight:400}
  .acepto input{margin-top:3px;width:20px;height:20px;flex:none}
  .canales{background:#F3F5F8;border-radius:10px;padding:10px 12px;margin:10px 0}
  .canales .tit{font-size:.85rem;color:#5B6472;margin:0 0 6px}
  .canales label{display:flex;gap:8px;align-items:center;font-weight:400;margin:6px 0;font-size:.92rem}
  .canales input{width:18px;height:18px}
  button.enviar{background:#1E6B44;color:#fff;border:0;border-radius:12px;width:100%;font-size:1.1rem;font-weight:800;padding:16px;cursor:pointer;margin-top:18px}
  button.enviar:disabled{background:#8AA896}
  a{color:#0B5ED7}
  .error{background:#FDECEA;border:1px solid #E5A5A0;color:#8A1C13;border-radius:10px;padding:10px 12px;margin:0 0 14px;font-size:.92rem}
  .error ul{margin:0;padding-left:18px}
  .ok{color:#1E6B44;font-weight:700}
  .trampa{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
  .pie{font-size:.78rem;color:#6B7280;margin-top:16px;text-align:center}
  .politica{white-space:pre-wrap;font-size:.95rem;line-height:1.55;color:#161B26}
`;

function pagina({ titulo, cuerpo, ok = false, extra = '' }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(titulo)}</title>
<style>${CSS}</style></head><body><div class="caja">
<h1>${esc(titulo)}</h1><p${ok ? ' class="ok"' : ''}>${cuerpo}</p>${extra}
</div></body></html>`;
}

// La MISMA página para código inexistente, desactivado, de alguien que ya no está, o inscripción apagada.
const NO_ACTIVO = {
  titulo: 'Enlace no activo',
  cuerpo: 'Este enlace no está activo. Si te lo dio alguien de la campaña, pídele que te envíe el actual.',
};

function responderNoActivo(res) {
  res.locals.fallo = true;
  return res.status(200).send(pagina(NO_ACTIVO));
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

function nombreCorto(nombre) {
  return String(nombre || '').trim().split(/\s+/).slice(0, 3).join(' ').slice(0, 60);
}

/** El formulario. `v` son los valores a repintar tras un error; `errores` una lista de textos. */
async function formulario(enlace, { v = {}, errores = [], aviso = '' } = {}) {
  const ramaId = await aspiranteDe(pool, enlace.usuario_id).catch(() => null);
  const campana = await nombreDeLaCampana(ramaId);
  const pol = await politicaVigente();
  const pase = emitirPase(enlace.codigo, pol.huella);
  const quien = `Te inscribe <strong>${esc(nombreCorto(enlace.nombre))}</strong>${campana ? ` · ${esc(campana)}` : ''}`;
  const val = (k) => esc(v[k] || '');
  const chk = (k) => (v[k] ? ' checked' : '');
  const cod = encodeURIComponent(enlace.codigo);
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Inscríbete</title>
<style>${CSS}</style></head><body><div class="caja">
<h1>Inscríbete</h1>
<p class="quien">${quien}</p>
${errores.length ? `<div class="error"><ul>${errores.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
${aviso ? `<div class="error">${esc(aviso)}</div>` : ''}
<form method="post" action="/i/${cod}" autocomplete="on" id="f">
  <label for="nombre">Nombre completo</label>
  <input type="text" id="nombre" name="nombre" value="${val('nombre')}" autocomplete="name" required maxlength="120">
  <label for="cedula">Número de cédula</label>
  <input type="text" id="cedula" name="cedula" value="${val('cedula')}" inputmode="numeric" autocomplete="off" required maxlength="15">
  <label for="telefono">Celular</label>
  <input type="tel" id="telefono" name="telefono" value="${val('telefono')}" inputmode="numeric" autocomplete="tel-national" required maxlength="16" placeholder="3001234567">
  <label for="email">Correo <small>(opcional)</small></label>
  <input type="email" id="email" name="email" value="${val('email')}" autocomplete="email" maxlength="150">

  <div id="caja-puesto" style="display:none">
    <label for="puesto">Puesto de votación <small>(si lo sabes)</small></label>
    <select id="puesto" name="puesto_id"><option value="">No lo sé / lo completo después</option></select>
    <label for="mesa">Mesa <small>(si la sabes)</small></label>
    <select id="mesa" name="mesa"><option value="">—</option></select>
  </div>

  <label class="acepto"><input type="checkbox" name="autoriza" value="1"${chk('autoriza')} required>
    <span>Autorizo que la campaña guarde y trate mis datos personales según la
    <a href="/i/${cod}/politica" target="_blank" rel="noopener">política de tratamiento de datos</a>.</span></label>
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
  var selP=document.getElementById('puesto'), selM=document.getElementById('mesa');
  var previoP=${JSON.stringify(v.puesto_id || '')}, previoM=${JSON.stringify(v.mesa || '')};
  var puestos=[];
  function mesas(){
    var p=puestos.filter(function(x){return String(x.id)===selP.value})[0];
    selM.innerHTML='<option value="">—</option>';
    if(!p||!p.cantidad_mesas) return;
    for(var i=1;i<=p.cantidad_mesas;i++){var o=document.createElement('option');o.value=i;o.textContent='Mesa '+i;selM.appendChild(o);}
    if(previoM){selM.value=previoM;previoM='';}
  }
  fetch('/i/'+encodeURIComponent(cod)+'/puestos',{headers:{Accept:'application/json'}}).then(function(r){return r.ok?r.json():[]}).then(function(l){
    if(!Array.isArray(l)||!l.length) return;
    puestos=l;
    l.forEach(function(p){var o=document.createElement('option');o.value=p.id;o.textContent=p.nombre;selP.appendChild(o);});
    if(previoP){selP.value=previoP;previoP='';mesas();}
    document.getElementById('caja-puesto').style.display='block';
  }).catch(function(){});
  selP.addEventListener('change',mesas);
  var f=document.getElementById('f'),b=document.getElementById('btn');
  f.addEventListener('submit',function(){b.disabled=true;b.textContent='Enviando…';});
  window.addEventListener('pageshow',function(){b.disabled=false;b.textContent='Inscribirme';});
})();
</script></body></html>`;
}

// ---------------------------------------------------------------------------

router.get('/:codigo', async (req, res) => {
  cabeceras(res);
  try {
    const ajustes = await leerAjustes();
    const enlace = ajustes.habilitado ? await buscarEnlaceActivo(req.params.codigo) : null;
    if (!enlace) return responderNoActivo(res);
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

router.get('/:codigo/politica', async (req, res) => {
  cabeceras(res);
  try {
    const ajustes = await leerAjustes();
    const enlace = ajustes.habilitado ? await buscarEnlaceActivo(req.params.codigo) : null;
    if (!enlace) return responderNoActivo(res);
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
  const nombre = String(cuerpo.nombre || '').replace(/\s+/g, ' ').trim();
  const cedulaCruda = String(cuerpo.cedula || '').replace(/[\s.\-]/g, '');
  let telefono = String(cuerpo.telefono || '').replace(/\D/g, '');
  if (telefono.length === 12 && telefono.startsWith('57')) telefono = telefono.slice(2);
  const email = String(cuerpo.email || '').trim().slice(0, 150);
  const valores = {
    nombre, cedula: cedulaCruda, telefono, email,
    puesto_id: String(cuerpo.puesto_id || ''), mesa: String(cuerpo.mesa || ''),
    autoriza: cuerpo.autoriza === '1', canal_sms: cuerpo.canal_sms === '1',
    canal_whatsapp: cuerpo.canal_whatsapp === '1', canal_email: cuerpo.canal_email === '1',
  };

  if (nombre.length < 5 || nombre.length > 120 || nombre.split(' ').length < 2 || !RE_NOMBRE.test(nombre)) {
    errores.push('Escribe tu nombre completo (nombre y apellido).');
  }
  let cedula = null;
  const r = validarCedula({
    cedula: cedulaCruda,
    primerNombre: nombre.split(' ')[0] || '', primerApellido: nombre.split(' ').slice(-1)[0] || '',
  }, []);
  if (r.nivel === 'bloqueo' || !r.cedula) errores.push('El número de cédula no es válido. Revísalo.');
  else cedula = String(r.cedula);
  if (!/^3\d{9}$/.test(telefono)) errores.push('Escribe tu celular de 10 dígitos (empieza por 3).');
  if (email && !RE_EMAIL.test(email)) errores.push('El correo no parece válido.');
  if (!valores.autoriza) errores.push('Para inscribirte debes aceptar el tratamiento de tus datos.');

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
      nombre, cedula, telefono, email: email || null, puesto, mesa,
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
    if (!enlace) return responderNoActivo(res);

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
        v: { nombre: cuerpo.nombre, cedula: cuerpo.cedula, telefono: cuerpo.telefono, email: cuerpo.email },
        aviso: 'La página caducó. Revisa tus datos y vuelve a enviar.',
      }));
    }
    if (pase.edadSeg < Number(ajustes.segundos_minimos)) {
      res.locals.fallo = true;
      await anotarRechazo({ enlaceId: enlace.enlace_id, motivo: 'muy_rapido', ip, navegador });
      return res.send(await formulario(enlace, {
        v: { nombre: cuerpo.nombre, cedula: cuerpo.cedula, telefono: cuerpo.telefono, email: cuerpo.email },
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
