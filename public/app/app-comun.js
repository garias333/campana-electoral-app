/* Utilidades compartidas de la app de captura de campo.
   Reutiliza el helper api() (con manejo de CSRF) definido en /js/api-core.js —
   este archivo se carga DESPUÉS de ese, en cada pantalla de la app.

   NINGUNA PANTALLA DE public/app/ CARGA /js/common.js. Antes este comentario
   decía lo contrario, y mandaba a buscar aquí helpers que solo existen en el
   panel de escritorio (como los de permisos, que la app no usa: filtra por rol).
   Lo que sí se comparte con el escritorio vive en js/api-core.js, js/es-celular.js
   y js/cuentas-dispositivo.js. */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}

/**
 * Confirma que hay una sesión activa contra el mismo backend de
 * escritorio (misma cookie de sesión, mismo dominio) — si no la hay,
 * manda a la persona a la pantalla de inicio de sesión de siempre y
 * recuerda a dónde quería llegar, para poder volver ahí después.
 *
 * Al reabrir la app en el celular (después de estar en segundo plano o
 * cerrada), es común que la primera solicitud caiga justo en el momento
 * en que la señal/datos móviles todavía se están reconectando — eso NO
 * significa que la sesión de 7 días haya expirado, así que un error de
 * red se reintenta un par de veces antes de mandar a la persona a
 * digitar sus credenciales de nuevo (lo que antes pasaba en cada corte
 * momentáneo de señal en campo).
 *
 * Si TODOS los reintentos fallan por falta de señal (no por un 401 real
 * del servidor), se usa el perfil guardado de la cuenta activa en este
 * celular (ver /js/cuentas-dispositivo.js) en vez de forzar un inicio de
 * sesión que en ese momento es imposible de completar — así la app
 * arranca en frío en zonas sin cobertura, y además permite cambiar entre
 * varias cuentas guardadas en un mismo celular compartido sin conexión.
 * Un 401 real (sesión vencida o cerrada, confirmado por el servidor)
 * sigue mandando siempre a iniciar sesión de nuevo.
 */
/** Carga /js/cerrar-sesion.js una sola vez (no todas las pantallas de /app/ lo traen). true si quedó disponible (parche 329). */
let _cerrarSesionAppPromesa = null;
function cargarCerrarSesionApp() {
  if (window.CerrarSesion) return Promise.resolve(true);
  if (!_cerrarSesionAppPromesa) {
    _cerrarSesionAppPromesa = new Promise((ok) => {
      const s = document.createElement('script');
      s.src = '/js/cerrar-sesion.js';
      s.onload = () => ok(!!window.CerrarSesion);
      s.onerror = () => ok(false);
      document.head.appendChild(s);
    });
  }
  return _cerrarSesionAppPromesa;
}

async function requerirSesionApp() {
  /* NO SE ENTRA POR LA COOKIE VIEJA (parche 329, orden 43). Si alguien cerró sesión SIN señal, `logout_pendiente` sigue puesto y la cookie del
     servidor todavía vale: entrar por ella sería entrar COMO la persona anterior, con sus datos. Mientras eso dure —y no haya otra cuenta activa
     de dispositivo— se muestra el login (después de intentar cerrar la sesión vieja en el servidor). Con otra cuenta activa la entrada sigue y el
     cierre pendiente se presenta en segundo plano. */
  if (await cargarCerrarSesionApp() && window.CerrarSesion.hayLogoutPendiente()) {
    if (window.CerrarSesion.entradaBloqueada()) {
      await window.CerrarSesion.resolver(2500);
      window.location.href = '/login.html';
      return null;
    }
    window.CerrarSesion.resolver(0);
  }
  const intentosRed = 3;
  let ultimoError = null;
  for (let intento = 1; intento <= intentosRed; intento++) {
    try {
      const sesion = await api('/auth/me');
      /* `api()` NO LANZA en un 401: redirige a login por su cuenta y devuelve
         `undefined` (ver api-core.js). Sin esta linea, la siguiente hacia
         `sesion.usuario` sobre `undefined`. */
      if (!sesion) return null;
      // La sesion resolvio: se borra la marca del rebote. Sin esto, un fallo
      // legitimo mas tarde en esta misma pantalla encontraria la marca puesta
      // de una vez anterior y mostraria el aviso en lugar de mandar a login,
      // que es lo que corresponde cuando la sesion de verdad caduco.
      sessionStorage.removeItem('app_rebote_login');

      /* CON `typeof`, PORQUE ESTA FUNCION PUEDE NO EXISTIR. La define
         /js/cuentas-dispositivo.js, y CUATRO pantallas de /app/ no lo cargan:
         informacion, biografia, politica-privacidad y puesto-votacion.

         Ahi esta llamada lanzaba un ReferenceError que el `catch` de abajo
         interpretaba como «la sesion no vale», mandaba a login.html, login veia
         la sesion viva y devolvia a la misma pantalla —y otra vez—. El sintoma
         era la app parpadeando sin entrar a ningun apartado.

         Es la misma precaucion que ya se toma doce lineas mas abajo con
         `esCelular`, y que common.js toma con `desactivarCuentaDispositivo`.
         Faltaba aqui. */
      if (typeof actualizarPerfilCuentaDispositivo === 'function') {
        actualizarPerfilCuentaDispositivo(sesion.usuario);
      }

      /* EL ASPIRANTE VA AL PANEL EN EL COMPUTADOR. EN EL CELULAR, SE QUEDA.
         Sus cuatro pantallas y su marca estan en el panel, y a eso entra desde
         el computador. Pero en el telefono SI trabaja aqui, como cualquier
         lider: capturando en la calle.

         Antes se le mandaba al panel sin mirar el aparato, asi que el telefono
         lo sacaba de la app en cuanto abria el icono — y el panel en una
         pantalla de 400px no es donde nadie captura de pie.

         Se comprueba aqui y no solo al iniciar sesion porque el `start_url`
         del manifiesto lo trae a esta pantalla cada vez que abre el icono, con
         la sesion ya abierta y sin pasar por el ingreso.

         `esCelular()` puede no estar definido si una pagina nueva de /app/ se
         olvida de cargar /js/es-celular.js. En ese caso se prefiere NO desviar:
         quedarse en la app es recuperable —hay menu para ir al panel— y sacar a
         alguien de la pantalla en la que estaba trabajando, no. */
      const enComputador = typeof window.esCelular === 'function' && !window.esCelular();
      if (sesion.usuario && sesion.usuario.es_aspirante && enComputador) {
        window.location.replace('/votantes.html');
        return sesion.usuario;
      }
      // LA APP DEL CELULAR TAMBIEN TIENE QUE PEDIR EL CAMBIO DE CLAVE.
      // Solo lo hacia el escritorio (common.js), y un lider entra por aqui:
      // se le decia que debia cambiarla y nunca aparecia donde hacerlo.
      if (sesion.usuario && sesion.usuario.debe_cambiar_password) {
        pedirCambioClaveApp();
      }
      // ORDEN 66: quien entró por un botón del celular y todavía no contestó «¿quiere cambiar su clave?» la ve antes de seguir (una sola vez; si cierra la app sin contestar, vuelve).
      if (sesion.usuario && sesion.usuario.clave_celular && sesion.usuario.clave_celular.pregunta) {
        preguntarClaveCelularApp(sesion.usuario.clave_celular);
      }
      return sesion.usuario;
    } catch (err) {
      ultimoError = err;
      if (err && err.esErrorDeRed && intento < intentosRed) {
        await new Promise((resolver) => setTimeout(resolver, 1200));
        continue;
      }
      break;
    }
  }

  if (ultimoError && ultimoError.esErrorDeRed
      && typeof obtenerPerfilCuentaActiva === 'function') {
    const perfil = obtenerPerfilCuentaActiva();
    if (perfil) return perfil;
  }

  /* NO SE VUELVE A LOGIN DOS VECES POR LA MISMA PANTALLA.
     Este salto y el de login.html se llaman entre si: aqui se guarda a donde
     queria entrar la persona, y login —si encuentra la sesion viva— la manda de
     vuelta. Cuando el fallo NO es de sesion, los dos tienen razon y el resultado
     es un ping-pong infinito: la app parpadea y no entra a nada.

     La marca corta el segundo salto y deja el error a la vista. Un mensaje feo
     es infinitamente mejor que una pantalla que parpadea: lo primero se puede
     leer y contar, lo segundo no se puede ni describir. */
  const yaVolvimos = sessionStorage.getItem('app_rebote_login') === window.location.pathname;
  if (yaVolvimos) {
    sessionStorage.removeItem('app_rebote_login');
    const aviso = document.createElement('div');
    aviso.style.cssText = 'position:fixed; inset:0; z-index:9999; background:#fff; padding:24px;'
      + 'font-family:system-ui,sans-serif; color:#10233F; display:flex; flex-direction:column;'
      + 'align-items:center; justify-content:center; text-align:center; gap:14px;';
    aviso.innerHTML = '<strong style="font-size:1.05rem;">No se pudo abrir esta pantalla</strong>'
      + '<p style="margin:0; font-size:.92rem; color:#5B6472; max-width:320px; line-height:1.5;">'
      + 'Tu sesión está activa, pero esta sección falló al cargar. Avisa a soporte y, '
      + 'mientras tanto, vuelve al inicio.</p>'
      + '<a href="/app/inicio.html" style="background:#0B5ED7; color:#fff; text-decoration:none;'
      + 'padding:11px 18px; border-radius:9px; font-weight:600;">Volver al inicio</a>';
    document.body.appendChild(aviso);
    return null;
  }
  sessionStorage.setItem('app_rebote_login', window.location.pathname);
  sessionStorage.setItem('app_destino_post_login', window.location.pathname);
  window.location.href = '/login.html';
  return null;
}

/**
 * El cambio obligatorio de clave, dentro de la app del celular.
 *
 * No se puede cerrar ni saltar: la clave con la que entro es su propia cedula,
 * que no es un secreto —esta en el formulario de registro y la conocen su
 * lider y su coordinador—. Mientras no la cambie, cualquiera que sepa ese
 * numero puede entrar con su cuenta.
 *
 * Pide SEIS CIFRAS, que es lo que el servidor acepta para este caso. El
 * teclado arranca en numeros: en un celular, la diferencia entre teclear seis
 * digitos y pelearse con el corrector es la diferencia entre hacerlo y no.
 */
function pedirCambioClaveApp() {
  if (document.getElementById('capa-cambio-clave')) return;
  const capa = document.createElement('div');
  capa.id = 'capa-cambio-clave';
  capa.style.cssText = 'position:fixed; inset:0; background:rgba(10,25,45,.94); z-index:9999;'
    + 'display:flex; align-items:center; justify-content:center; padding:20px; overflow-y:auto;';
  capa.innerHTML = `
    <div style="background:#fff; border-radius:14px; padding:22px 20px; max-width:360px; width:100%;">
      <h2 style="margin:0 0 6px; font-size:1.15rem; color:#10233F;">Cambia tu clave</h2>
      <p style="font-size:.9rem; color:#5B6472; line-height:1.5; margin:0 0 16px;">
        Entraste con tu número de identificación, que no es un secreto.
        Elige una clave de <strong>6 cifras</strong> que solo tú sepas.
      </p>
      <div id="error-cambio-clave" style="display:none; background:#FBEAEA; color:#A93226;
           padding:9px 12px; border-radius:8px; font-size:.86rem; margin-bottom:12px;"></div>
      <form id="form-cambio-clave-app">
        <div class="campo-app">
          <label>Clave actual (tu número de identificación)</label>
          <input type="password" name="passwordActual" inputmode="numeric" required autocomplete="current-password">
        </div>
        <div class="campo-app">
          <label>Clave nueva</label>
          <input type="password" name="passwordNueva" inputmode="numeric" pattern="[0-9]{6}"
                 maxlength="6" required autocomplete="new-password" placeholder="6 cifras">
        </div>
        <div class="campo-app">
          <label>Repítela</label>
          <input type="password" name="repetir" inputmode="numeric" pattern="[0-9]{6}"
                 maxlength="6" required autocomplete="new-password" placeholder="6 cifras">
        </div>
        <button type="submit" class="btn-app">Guardar y continuar</button>
      </form>
    </div>`;
  document.body.appendChild(capa);
  const error = capa.querySelector('#error-cambio-clave');
  const mostrar = (t) => { error.textContent = t; error.style.display = 'block'; };

  capa.querySelector('#form-cambio-clave-app').addEventListener('submit', async (e) => {
    e.preventDefault();
    error.style.display = 'none';
    const f = new FormData(e.target);
    const nueva = String(f.get('passwordNueva') || '');
    // Se comprueba aqui ADEMAS del servidor: en un celular, enterarse de que
    // las dos claves no coinciden despues de un viaje de red es peor.
    if (nueva !== String(f.get('repetir') || '')) return mostrar('Las dos claves nuevas no son iguales.');
    if (!/^\d{6}$/.test(nueva)) return mostrar('La clave nueva debe ser un número de 6 cifras.');
    const boton = e.target.querySelector('button[type="submit"]');
    boton.disabled = true;
    const antes = boton.textContent;
    boton.textContent = 'Guardando...';
    try {
      await api('/auth/cambiar-password', {
        method: 'POST',
        body: { passwordActual: f.get('passwordActual'), passwordNueva: nueva },
      });
      capa.remove();
    } catch (err) {
      mostrar(err.message || 'No se pudo cambiar la clave.');
    } finally {
      boton.disabled = false;
      boton.textContent = antes;
    }
  });
}

/** Arma la barra superior con botón de volver y título — igual en toda la app. */
function pintarBarraApp(titulo, subtitulo, destinoVolver) {
  document.getElementById('app-barra').innerHTML = `
    ${destinoVolver ? `<button class="volver" onclick="window.location.href='${destinoVolver}'" aria-label="Volver">‹</button>` : ''}
    <div>
      <h1>${titulo}</h1>
      ${subtitulo ? `<p class="subt">${subtitulo}</p>` : ''}
    </div>
  `;
}

/* ------------------------------------------------------------------
   ERRORES JUNTO AL CAMPO Y AVISO FLOTANTE (rediseño del celular).

   Reemplazan a alert() en los formularios de /app:
     · mostrarErrorCampo(campo, mensaje)  — el error es de UN campo: se marca (borde y fondo rojos,
       aria-invalid="true"), se escribe debajo con «⚠ » (aria-live="polite") y se lleva el foco y la
       pantalla hasta el primero.
     · limpiarErrores(form)               — quita todas las marcas y los textos de ese formulario.
     · mostrarToast(texto, tipo)          — el error es general, o viene del servidor, o es un «Guardado»:
       un aviso flotante de 3 s sobre la barra fija de abajo.
   El texto del error se pone como ÚLTIMO hijo del contenedor del campo (.campo-app, o el mismo padre):
   no cambia el orden de lo que ya hay, que es lo que miran pasos-formulario.js y las demás pantallas.
   ------------------------------------------------------------------ */
function limpiarErrorCampo(campo) {
  if (!campo || !campo.removeAttribute) return;
  campo.removeAttribute('aria-invalid');
  campo.classList.remove('campo-error', 'pf-error');
  const id = campo.dataset ? campo.dataset.errorId : null;
  if (id) {
    const msg = document.getElementById(id);
    if (msg) msg.remove();
    delete campo.dataset.errorId;
  }
}

function limpiarErrores(form) {
  const raiz = form || document;
  raiz.querySelectorAll('[aria-invalid="true"], .campo-error, .pf-error').forEach(limpiarErrorCampo);
  raiz.querySelectorAll('.error-campo').forEach((m) => m.remove());
}

function mostrarErrorCampo(campo, mensaje) {
  if (typeof campo === 'string') campo = document.getElementById(campo);
  if (!campo) { mostrarToast(mensaje, 'error'); return; }
  limpiarErrorCampo(campo);
  const esControl = /^(INPUT|SELECT|TEXTAREA|CANVAS)$/.test(campo.tagName);
  if (esControl) { campo.setAttribute('aria-invalid', 'true'); campo.classList.add('campo-error'); }
  /* Donde va el texto: tras la etiqueta que envuelve la casilla, o dentro del contenedor del campo. */
  const envoltura = campo.closest('label');
  const contenedor = campo.closest('.campo-app') || (envoltura && envoltura.parentElement) || campo.parentElement;
  const msg = document.createElement('div');
  msg.className = 'error-campo';
  msg.id = 'err-' + Math.random().toString(36).slice(2, 9);
  msg.setAttribute('aria-live', 'polite');
  msg.textContent = '⚠ ' + mensaje;
  if (contenedor) contenedor.appendChild(msg); else campo.insertAdjacentElement('afterend', msg);
  campo.dataset.errorId = msg.id;
  if (esControl) campo.setAttribute('aria-describedby', msg.id);
  try { (envoltura || campo).scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* navegador viejo */ }
  if (typeof campo.focus === 'function' && campo.tagName !== 'CANVAS') campo.focus({ preventScroll: true });
}

/* Al corregir un campo se le quita el error, sin esperar a que se vuelva a enviar. */
['input', 'change'].forEach((ev) => document.addEventListener(ev, (e) => {
  const c = e.target;
  if (c && c.dataset && c.dataset.errorId) limpiarErrorCampo(c);
}, true));

function mostrarToast(texto, tipo) {
  const viejo = document.getElementById('toast-app');
  if (viejo) viejo.remove();
  const el = document.createElement('div');
  el.id = 'toast-app';
  el.className = 'toast-app' + (tipo === 'ok' ? ' ok' : (tipo === 'error' ? ' error' : ''));
  el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  el.textContent = texto;
  document.body.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 3000);
}

/* EL TECLADO Y LAS BARRAS FIJAS. En Chrome de Android el teclado achica la página y una barra fija sube sola; en
   Safari de iPhone no: la barra se queda donde estaba, detrás del teclado. visualViewport sí dice cuánto se comió el
   teclado, y las barras fijas lo suman a su `bottom` (variable --teclado de estilos-app.css). Sin visualViewport,
   la variable queda en 0 y todo funciona como antes. */
(function ajustarBarrasPorTeclado() {
  const vv = window.visualViewport;
  if (!vv) return;
  const medir = () => {
    const tapado = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--teclado', (tapado > 80 ? tapado : 0) + 'px');
  };
  vv.addEventListener('resize', medir);
  vv.addEventListener('scroll', medir);
  medir();
})();

/** Las iniciales (hasta 2) para el avatar de una fila de lista. */
function inicialesDe(nombre) {
  const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return partes.map((p) => p[0].toUpperCase()).join('') || '—';
}

/** Escapa texto antes de insertarlo como HTML (mismo criterio que el resto de la app). */
function escaparAppHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto == null ? '' : String(texto);
  return div.innerHTML;
}

/* ------------------------------------------------------------------
   ARCHIVOS QUE EXIGEN SESIÓN: SE PIDEN CON fetch, NO CON UN ENLACE.

   Un enlace (`<a href>`, `<img src>`, `<video src>`) es una navegación del
   navegador y SOLO lleva la cookie de sesión, que dura 8 horas; el token de
   dispositivo de «Recordar sesión» dura 7 días y solo viaja como encabezado
   `X-Device-Token`. Con la cookie vencida, el enlace mostraba el JSON «Debe
   iniciar sesión» aunque la sesión del dispositivo siguiera vigente. Es lo
   mismo que ya se arregló en Legislación (`pedirPdf`, app/legislacion.html);
   aquí queda como pieza común para Información para compartir y las
   pantallas de administrador. El token nunca va en la dirección.
   ------------------------------------------------------------------ */

/** Los encabezados de la cuenta activa del dispositivo (vacío si no hay token). */
function encabezadosTokenApp(extra) {
  const h = Object.assign({}, extra || {});
  const token = (typeof obtenerTokenDispositivoActivo === 'function') ? obtenerTokenDispositivoActivo() : null;
  if (token) h['X-Device-Token'] = token;
  return h;
}

/** `filename*=UTF-8''…` primero (acentos), luego `filename="…"`. null si no viene. */
function nombreDeContentDisposition(cabecera) {
  if (!cabecera) return null;
  let m = /filename\*=UTF-8''([^;]+)/i.exec(cabecera);
  if (m) { try { return decodeURIComponent(m[1]); } catch (e) { /* cae al otro */ } }
  m = /filename="?([^";]+)"?/i.exec(cabecera);
  return m ? m[1] : null;
}

/**
 * Pide un archivo a la API (`ruta` SIN el prefijo /api) y lo devuelve como
 * { blob, nombre, tipo }. Lanza con `esErrorDeRed` si no hay señal, y con
 * `status` si el servidor respondió con error. Un 401 manda a iniciar sesión
 * (igual que api()) y devuelve null.
 */
async function pedirArchivoApp(ruta, opciones) {
  const o = opciones || {};
  let resp;
  try {
    resp = await fetch('/api' + ruta, { headers: encabezadosTokenApp(), credentials: 'same-origin', signal: o.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    const e = new Error('Se necesita conexión a internet para obtener el archivo.');
    e.esErrorDeRed = true;
    throw e;
  }
  if (resp.status === 401) { window.location.href = '/login.html'; return null; }
  if (!resp.ok) {
    let mensaje = 'No se pudo obtener el archivo.';
    try { const j = await resp.json(); if (j && j.error) mensaje = j.error; } catch (e) { /* sin cuerpo JSON */ }
    const e = new Error(mensaje);
    e.status = resp.status;
    throw e;
  }
  const blob = await resp.blob();
  return {
    blob,
    nombre: nombreDeContentDisposition(resp.headers.get('Content-Disposition')),
    tipo: resp.headers.get('Content-Type') || blob.type || ''
  };
}

/** Descarga un Blob como archivo. */
function guardarBlobApp(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre || 'archivo';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}


/* ------------------------------------------------------------------
   LA CLAVE DEL CELULAR (orden 66): el campo con su ojito, la pregunta del primer ingreso y la ayuda para «Cambiar mi clave».
   ------------------------------------------------------------------ */

/** El HTML de un campo de clave de 6 dígitos: numérico, solo dígitos, oculto por defecto y con el ojito para verla u ocultarla mientras se escribe. Lo activa `activarOjosClave`. */
function campoClaveConOjo(id, etiqueta, autocompletar) {
  return `
    <div class="campo-app">
      <label for="${id}">${etiqueta}</label>
      <div class="clave-ojo">
        <input id="${id}" name="${id}" class="campo-clave-6" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6"
               autocomplete="${autocompletar || 'off'}" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="••••••">
        <button type="button" class="btn-ojo-app" data-ojo="${id}" aria-label="Mostrar la clave" aria-pressed="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path class="ojo-tachado" d="M3 3l18 18" style="display:none"/>
          </svg>
        </button>
      </div>
    </div>`;
}

/** Deja vivos los campos de `campoClaveConOjo` dentro de `raiz`: solo dígitos (también al pegar o dictar) y el ojito. */
function activarOjosClave(raiz) {
  raiz.querySelectorAll('input.campo-clave-6').forEach((campo) => {
    campo.addEventListener('input', () => {
      const limpio = campo.value.replace(/\D/g, '');
      if (limpio !== campo.value) campo.value = limpio;
    });
  });
  raiz.querySelectorAll('.btn-ojo-app').forEach((boton) => {
    boton.addEventListener('click', () => {
      const campo = raiz.querySelector('#' + boton.dataset.ojo);
      const verla = campo.type === 'password';
      campo.type = verla ? 'text' : 'password';
      boton.setAttribute('aria-pressed', verla ? 'true' : 'false');
      boton.setAttribute('aria-label', verla ? 'Ocultar la clave' : 'Mostrar la clave');
      boton.querySelector('.ojo-tachado').style.display = verla ? '' : 'none';
    });
  });
}

/** Un mensaje de error del servidor o de la red, listo para mostrar (nunca lleva la clave). */
function mensajeDeErrorClave(err) {
  if (err && err.esErrorDeRed) return 'Sin conexión. Intente de nuevo cuando tenga señal.';
  return (err && err.message) || 'No se pudo guardar. Intente de nuevo.';
}

/**
 * LA PREGUNTA DEL PRIMER INGRESO. Una pantalla con el diseño de la app, antes del inicio: «Cambiar mi clave» (formulario de la clave nueva y su repetición; sin la clave actual, porque
 * acaba de entrar con ella) o «Dejar la que tengo». Contestar —de cualquiera de las dos formas— la marca como hecha y no vuelve a preguntar. Sin contestar (cerrar la app), vuelve.
 * `info.desde_clave_anterior`: entró escribiendo su contraseña de antes; se le explica la clave del celular.
 */
function preguntarClaveCelularApp(info) {
  if (document.getElementById('capa-clave-celular')) return;
  const capa = document.createElement('div');
  capa.id = 'capa-clave-celular';
  capa.className = 'capa-clave-celular';
  capa.setAttribute('role', 'dialog');
  capa.setAttribute('aria-modal', 'true');
  capa.setAttribute('aria-labelledby', 'clave-celular-titulo');
  capa.innerHTML = `
    <div class="tarjeta-clave-celular">
      <h2 id="clave-celular-titulo">Su clave del celular</h2>
      <div id="clave-paso-pregunta">
        ${info && info.desde_clave_anterior ? '<p class="aviso-clave-anterior">Desde ahora su clave del celular son los últimos 6 dígitos de su cédula, o la que usted elija.</p>' : ''}
        <p>Hoy su clave son los últimos 6 dígitos de su cédula. ¿Quiere cambiarla por una que solo usted conozca?</p>
        <div id="clave-error-pregunta" class="aviso-app" role="alert"></div>
        <button type="button" class="btn-app btn-app-primario" id="clave-btn-cambiar">Cambiar mi clave</button>
        <button type="button" class="btn-app btn-app-secundario" id="clave-btn-dejar">Dejar la que tengo</button>
      </div>
      <form id="clave-paso-cambio" hidden novalidate>
        <p>Escriba una clave de <strong>6 dígitos</strong> que solo usted conozca.</p>
        <div id="clave-error-cambio" class="aviso-app" role="alert"></div>
        ${campoClaveConOjo('clave-nueva', 'Nueva clave', 'new-password')}
        ${campoClaveConOjo('clave-repetir', 'Repita la nueva clave', 'new-password')}
        <button type="submit" class="btn-app btn-app-primario">Guardar mi clave</button>
        <button type="button" class="btn-app btn-app-secundario" id="clave-btn-volver">Volver</button>
      </form>
      <div id="clave-paso-listo" hidden>
        <p class="exito-clave">Su clave quedó cambiada.</p>
        <button type="button" class="btn-app btn-app-primario" id="clave-btn-continuar">Continuar</button>
      </div>
    </div>`;
  document.body.appendChild(capa);
  activarOjosClave(capa);

  const mostrar = (id, texto) => { const e = capa.querySelector('#' + id); e.textContent = texto; e.className = 'aviso-app visible error'; };
  const ocultarErrores = () => capa.querySelectorAll('.aviso-app').forEach((e) => { e.className = 'aviso-app'; });
  const paso = (cual) => {
    ['clave-paso-pregunta', 'clave-paso-cambio', 'clave-paso-listo'].forEach((id) => { capa.querySelector('#' + id).hidden = (id !== cual); });
    ocultarErrores();
  };
  const cerrar = () => capa.remove();

  capa.querySelector('#clave-btn-cambiar').addEventListener('click', () => { paso('clave-paso-cambio'); capa.querySelector('#clave-nueva').focus(); });
  capa.querySelector('#clave-btn-volver').addEventListener('click', () => paso('clave-paso-pregunta'));
  capa.querySelector('#clave-btn-continuar').addEventListener('click', cerrar);

  capa.querySelector('#clave-btn-dejar').addEventListener('click', async (e) => {
    ocultarErrores();
    e.target.disabled = true;
    try {
      await api('/auth/clave-celular/primera', { method: 'POST', body: { accion: 'dejar' } });
      cerrar();
    } catch (err) {
      e.target.disabled = false;
      mostrar('clave-error-pregunta', mensajeDeErrorClave(err));
    }
  });

  capa.querySelector('#clave-paso-cambio').addEventListener('submit', async (e) => {
    e.preventDefault();
    ocultarErrores();
    const nueva = capa.querySelector('#clave-nueva').value;
    const repetir = capa.querySelector('#clave-repetir').value;
    // Se comprueba aquí ADEMÁS del servidor: enterarse después de un viaje de red de que las dos no coinciden es peor en un celular.
    if (!/^\d{6}$/.test(nueva)) return mostrar('clave-error-cambio', 'La clave nueva debe tener exactamente 6 dígitos numéricos.');
    if (nueva !== repetir) return mostrar('clave-error-cambio', 'La clave nueva y su repetición no son iguales.');
    const boton = e.target.querySelector('button[type="submit"]');
    boton.disabled = true;
    try {
      await api('/auth/clave-celular/primera', { method: 'POST', body: { accion: 'cambiar', nueva, repetir } });
      paso('clave-paso-listo');
    } catch (err) {
      mostrar('clave-error-cambio', mensajeDeErrorClave(err));
    } finally {
      boton.disabled = false;
    }
  });
}


/**
 * A dónde vuelve cada quien desde las pantallas que comparten todos los roles (Biografía, Información para compartir, Política de privacidad, Legislación…).
 * El candidato principal (orden 75) tiene su propia app: vuelve a SU «Más», nunca al menú de /app/inicio.html. Los demás, a /app/inicio.html como siempre.
 */
function inicioDeLaApp(usuario) {
  return usuario && usuario.rol === 'candidato' ? '/app/candidato-mas.html' : '/app/inicio.html';
}
