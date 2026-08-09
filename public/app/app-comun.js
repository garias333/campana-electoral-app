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
