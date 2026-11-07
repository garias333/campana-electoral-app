/**
 * public/app/checkin.js — el botón «Llegué a mi puesto» de la app del testigo (app/dia-d.html).
 *
 * LA REGLA: nada de esto bloquea. Si el teléfono no da la ubicación, o la persona la niega, la llegada se guarda igual,
 * sin coordenadas. Si no hay señal, la llegada queda en la cola de este celular (IndexedDB, con su `cliente_uuid`) y sube
 * sola cuando vuelva; el servidor es idempotente —una llegada por persona y día—, así que reintentar o tocar dos veces no
 * cambia la hora. La hora que cuenta es la del TOQUE (`marcado_en`), no la de la subida.
 *
 * Usa `api`, `listarColaOffline`, `guardarEnColaOffline`, `borrarDeColaOffline`, `sincronizarCola` y `generarUuid`
 * (api-core.js / offline-utils.js). Marcar el DOM: #caja-llegada, #btn-llegue, #estado-llegada, #cola-llegada, #franja-prueba-llegada.
 */
(function () {
  'use strict';

  var STORE = 'checkin_pendientes';
  var CLAVE_LOCAL = 'checkin_estado_hoy';    // la última llegada conocida, para mostrarla sin señal
  var estadoServidor = null;

  function $(id) { return document.getElementById(id); }
  function horaCorta(texto) { return texto ? String(texto).slice(11, 16) : ''; }

  function leerLocal() { try { return JSON.parse(localStorage.getItem(CLAVE_LOCAL) || 'null'); } catch (_) { return null; } }
  function guardarLocal(o) { try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(o)); } catch (_) { /* sin almacenamiento */ } }

  async function pendientes() { try { return await listarColaOffline(STORE); } catch (_) { return []; } }

  /** La ubicación, si se puede y en poco tiempo. NUNCA lanza ni espera de más: sin ella se marca igual. */
  function ubicacion() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve(null);
      var listo = false;
      var fin = function (v) { if (!listo) { listo = true; resolve(v); } };
      setTimeout(function () { fin(null); }, 9000);
      try {
        navigator.geolocation.getCurrentPosition(
          function (p) { fin({ latitud: p.coords.latitude, longitud: p.coords.longitude }); },
          function () { fin(null); },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
      } catch (_) { fin(null); }
    });
  }

  function pintar() {
    var caja = $('caja-llegada');
    if (!estadoServidor || !estadoServidor.tiene_puesto) { caja.style.display = 'none'; return; }
    caja.style.display = 'block';
    $('franja-prueba-llegada').style.display = estadoServidor.modo_prueba ? 'block' : 'none';
    var btn = $('btn-llegue');
    var ll = estadoServidor.llegada;
    var estado = $('estado-llegada');
    if (ll) {
      btn.disabled = true;
      btn.textContent = '✓ Ya marcaste tu llegada';
      estado.textContent = 'Llegaste a las ' + horaCorta(ll.llegado_en) + ' a ' + (estadoServidor.puesto ? estadoServidor.puesto.nombre : 'tu puesto') +
        (ll.origen === 'coordinador' ? ' (la marcó tu coordinador).' : '.') +
        (ll.lejos ? ' Estabas a ' + ll.distancia_m + ' m del puesto: se guardó igual.' : '');
      estado.className = 'estado-llegada ok';
    } else {
      btn.disabled = false;
      btn.textContent = 'Llegué a mi puesto';
      estado.textContent = estadoServidor.puesto ? 'Tu puesto: ' + estadoServidor.puesto.nombre + '.' : '';
      estado.className = 'estado-llegada';
    }
  }

  async function pintarCola() {
    var cola = await pendientes();
    var pend = cola.filter(function (r) { return r.estado !== 'fallido'; });
    var fall = cola.filter(function (r) { return r.estado === 'fallido'; });
    var el = $('cola-llegada');
    if (!pend.length && !fall.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
    el.innerHTML = (pend.length ? '<div>📶 Tu llegada quedó guardada en este celular y se enviará sola al volver la señal. ' +
        '<button type="button" class="btn-mini" id="btn-subir-llegada">Subir ahora</button></div>' : '') +
      fall.map(function (f) {
        return '<div style="color:#A93226; margin-top:8px;">⚠ No se pudo subir tu llegada: ' + (f.error || 'error desconocido') +
          ' <button type="button" class="btn-mini" data-reintentar="' + f.clienteUuid + '">Reintentar</button> ' +
          '<button type="button" class="btn-mini" data-descartar="' + f.clienteUuid + '">Descartar</button></div>';
      }).join('');
  }

  async function subir() {
    var r = await sincronizarCola(STORE, '/dia-d/checkin', function (reg) { return reg.payload; });
    await pintarCola();
    if (r && r.subidos) await consultar();
    return r;
  }

  async function consultar() {
    try {
      estadoServidor = await api('/dia-d/checkin/mio');
      if (estadoServidor.llegada) guardarLocal({ fecha: estadoServidor.fecha, llegada: estadoServidor.llegada, puesto: estadoServidor.puesto });
    } catch (err) {
      // Sin señal: se muestra lo último que se supo hoy (la llegada ya marcada, si la hubo).
      var loc = leerLocal();
      if (!estadoServidor) estadoServidor = loc ? { tiene_puesto: true, puesto: loc.puesto, llegada: loc.llegada, modo_prueba: false } : null;
    }
    pintar();
  }

  async function marcar() {
    var btn = $('btn-llegue');
    btn.disabled = true;
    // Un toque ya guardado (esperando señal) no se duplica: el segundo no hace nada.
    if ((await pendientes()).some(function (r) { return r.estado !== 'fallido'; })) { await subir(); return; }
    $('estado-llegada').textContent = 'Marcando tu llegada…';
    var pos = await ubicacion();
    var uuid = generarUuid();
    await guardarEnColaOffline(STORE, {
      clienteUuid: uuid, creadoEn: Date.now(), estado: 'pendiente',
      payload: {
        cliente_uuid: uuid, marcado_en: new Date().toISOString(),
        latitud: pos ? pos.latitud : null, longitud: pos ? pos.longitud : null,
      },
    });
    await subir();
    if (!(estadoServidor && estadoServidor.llegada)) {
      // Quedó en cola (sin señal): se dice y el botón vuelve a quedar disponible para «Subir ahora».
      btn.disabled = false;
      $('estado-llegada').textContent = 'Sin señal: tu llegada quedó guardada y se enviará sola.';
    }
  }

  window.iniciarCheckin = async function () {
    if (!$('caja-llegada')) return;
    $('btn-llegue').addEventListener('click', marcar);
    $('cola-llegada').addEventListener('click', async function (e) {
      if (e.target.id === 'btn-subir-llegada') { await subir(); return; }
      var re = e.target.closest('[data-reintentar]'), de = e.target.closest('[data-descartar]');
      if (!re && !de) return;
      var uuid = (re || de).getAttribute(re ? 'data-reintentar' : 'data-descartar');
      var cola = await pendientes();
      var reg = cola.filter(function (r) { return r.clienteUuid === uuid; })[0];
      if (!reg) { await pintarCola(); return; }
      if (de) {
        if (confirm('¿Descartar tu llegada guardada? No se enviará.')) { await borrarDeColaOffline(STORE, uuid); await pintarCola(); }
        return;
      }
      reg.estado = 'pendiente'; delete reg.error;
      await guardarEnColaOffline(STORE, reg);
      await subir();
    });
    await consultar();
    await pintarCola();
    await subir();                                   // lo que quedó pendiente de antes
    window.addEventListener('online', function () { subir(); });
  };
})();
