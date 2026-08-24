/* Utilidades compartidas de la app de captura de campo.
   Reutiliza el helper api() (con manejo de CSRF) ya definido en
   /js/common.js — este archivo se carga DESPUÉS de ese, en cada página. */

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
async function requerirSesionApp() {
  const intentosRed = 3;
  let ultimoError = null;
  for (let intento = 1; intento <= intentosRed; intento++) {
    try {
      const sesion = await api('/auth/me');
      actualizarPerfilCuentaDispositivo(sesion.usuario);

      /* EL ASPIRANTE CON SUBLICENCIA NO TRABAJA EN ESTA APP.
         En la estructura es un lider, y por eso llega aqui: el icono de la
         aplicacion instalada abre /app/inicio.html sin preguntarle a nadie.
         Pero el no entra a capturar votantes puerta a puerta, entra a dirigir
         SU campaña — y sus cuatro pantallas y su marca estan en el panel.

         Se le manda alla desde aqui y no solo al iniciar sesion porque el
         `start_url` del manifiesto lo traeria a esta pantalla cada vez que
         abriera el icono, con la sesion ya abierta y sin pasar por el ingreso. */
      if (sesion.usuario && sesion.usuario.es_aspirante) {
        window.location.replace('/votantes.html');
        return sesion.usuario;
      }
      // LA APP DEL CELULAR TAMBIEN TIENE QUE PEDIR EL CAMBIO DE CLAVE.
      // Solo lo hacia el escritorio (common.js), y un lider entra por aqui:
      // se le decia que debia cambiarla y nunca aparecia donde hacerlo.
      if (sesion.usuario && sesion.usuario.debe_cambiar_password) {
        pedirCambioClaveApp();
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

  if (ultimoError && ultimoError.esErrorDeRed) {
    const perfil = obtenerPerfilCuentaActiva();
    if (perfil) return perfil;
  }

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
      <h2 style="margin:0 0 6px; font-size:1.15rem; color:#10233F;">Cambie su clave</h2>
      <p style="font-size:.9rem; color:#5B6472; line-height:1.5; margin:0 0 16px;">
        Entro con su numero de identificacion, que no es un secreto.
        Elija una clave de <strong>6 cifras</strong> que solo usted sepa.
      </p>
      <div id="error-cambio-clave" style="display:none; background:#FBEAEA; color:#A93226;
           padding:9px 12px; border-radius:8px; font-size:.86rem; margin-bottom:12px;"></div>
      <form id="form-cambio-clave-app">
        <div class="campo-app">
          <label>Clave actual (su numero de identificacion)</label>
          <input type="password" name="passwordActual" inputmode="numeric" required autocomplete="current-password">
        </div>
        <div class="campo-app">
          <label>Clave nueva</label>
          <input type="password" name="passwordNueva" inputmode="numeric" pattern="[0-9]{6}"
                 maxlength="6" required autocomplete="new-password" placeholder="6 cifras">
        </div>
        <div class="campo-app">
          <label>Reptala</label>
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
    if (!/^\d{6}$/.test(nueva)) return mostrar('La clave nueva debe ser un numero de 6 cifras.');
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
    ${destinoVolver ? `<button class="volver" onclick="window.location.href='${destinoVolver}'">←</button>` : ''}
    <div>
      <h1>${titulo}</h1>
      ${subtitulo ? `<p class="subt">${subtitulo}</p>` : ''}
    </div>
  `;
}

/** Escapa texto antes de insertarlo como HTML (mismo criterio que el resto de la app). */
function escaparAppHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto == null ? '' : String(texto);
  return div.innerHTML;
}
