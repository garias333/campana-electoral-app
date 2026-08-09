/**
 * Interruptor de «Recibir avisos» en la app.
 *
 * TRES ESTADOS, NO DOS. Es lo que hace que esto sea usable:
 *   - sin decidir  -> se puede activar
 *   - activo       -> se puede apagar
 *   - BLOQUEADO    -> la persona dijo que no alguna vez, y el navegador ya
 *                     no vuelve a preguntar. Hay que decírselo y explicarle
 *                     dónde cambiarlo; un interruptor que no responde al
 *                     tocarlo parece una aplicación rota.
 *
 * EN IPHONE hay que agregar la app a la pantalla de inicio primero. Abierta
 * como pestaña de Safari no existe la API y el interruptor no aparecería
 * nunca: se dice por qué, en vez de dejar un hueco sin explicación.
 */
(function () {
  const soportado = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  function base64ABytes(base64) {
    const pad = '='.repeat((4 - (base64.length % 4)) % 4);
    const limpio = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const crudo = atob(limpio);
    return Uint8Array.from([...crudo].map(c => c.charCodeAt(0)));
  }

  /** Nombre legible del aparato, para que la persona reconozca cuál es. */
  function nombreDispositivo() {
    const ua = navigator.userAgent;
    const so = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad'
             : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'Otro';
    return so + ' · ' + (navigator.platform || '');
  }

  window.montarAvisosPush = async function (contenedor) {
    if (!contenedor) return;
    const pintar = (html) => { contenedor.innerHTML = html; };

    if (!soportado) {
      pintar('<p style="font-size:0.82rem; color:var(--muted, #6b6b6b); margin:0;">'
        + 'Este dispositivo no permite avisos. En iPhone, primero agrega la aplicación a la '
        + 'pantalla de inicio (Compartir → Agregar a inicio) y vuelve a entrar desde ahí.</p>');
      return;
    }
    if (Notification.permission === 'denied') {
      pintar('<p style="font-size:0.82rem; color:#A93226; margin:0;">'
        + 'Los avisos están bloqueados en este navegador. Para volver a activarlos: abre la '
        + 'configuración del sitio en tu navegador y permite las notificaciones.</p>');
      return;
    }

    let clave = null;
    try {
      const r = await api('/push/clave-publica');
      if (!r.disponible) { pintar(''); return; }   // la campaña no tiene push configurado
      clave = r.clave;
    } catch (e) { pintar(''); return; }

    const registro = await navigator.serviceWorker.ready;
    let suscripcion = await registro.pushManager.getSubscription();

    const dibujar = () => pintar(
      `<label style="display:flex; align-items:center; gap:8px; font-size:0.9rem;">
         <input type="checkbox" id="chk-avisos-push" ${suscripcion ? 'checked' : ''} style="width:auto;">
         Recibir avisos en este dispositivo
       </label>
       <small style="color:var(--muted, #6b6b6b); font-size:0.76rem;">
         Para recordatorios de la jornada y mensajes del equipo.</small>`);

    dibujar();

    contenedor.addEventListener('change', async (e) => {
      if (e.target.id !== 'chk-avisos-push') return;
      const casilla = e.target;
      casilla.disabled = true;
      try {
        if (casilla.checked) {
          const permiso = await Notification.requestPermission();
          if (permiso !== 'granted') { suscripcion = null; dibujar(); return; }
          suscripcion = await registro.pushManager.subscribe({
            userVisibleOnly: true,                       // obligatorio en Chrome
            applicationServerKey: base64ABytes(clave),
          });
          const s = suscripcion.toJSON();
          await api('/push/suscribir', { method: 'POST', body: {
            endpoint: s.endpoint, keys: s.keys, dispositivo: nombreDispositivo() } });
        } else {
          const s = suscripcion && suscripcion.toJSON();
          // Se avisa al servidor ANTES de cancelar en el navegador: si se
          // hiciera al revés y fallara la red, el dispositivo quedaría
          // registrado en la base sin poder recibir nada, y cada envío
          // gastaría un intento en él.
          if (s) await api('/push/desuscribir', { method: 'POST', body: { endpoint: s.endpoint } });
          if (suscripcion) await suscripcion.unsubscribe();
          suscripcion = null;
        }
      } catch (err) {
        alert('No se pudo cambiar la configuración de avisos: ' + err.message);
      } finally {
        casilla.disabled = false;
        dibujar();
      }
    });
  };
})();
