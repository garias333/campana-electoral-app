/**
 * La pantalla del CONDUCTOR (/t/<código>, orden 33). Sin cuenta: el código del enlace es la credencial.
 *
 * QUÉ HACE: pide la lista de SUS paradas del día (GET /t/<código>/lista), las pinta en orden con el mapa y deja marcar
 * «Recogido», «Llevado al puesto» y «No estaba». Cada marca lleva un `cliente_uuid` y se guarda PRIMERO en la cola de este
 * teléfono (localStorage): sube sola cuando hay señal y el servidor es idempotente, así que tocar dos veces o reintentar
 * no cambia nada. La hora que cuenta es la del TOQUE. La ubicación se pide SOLO al tocar una marca y nunca la bloquea.
 *
 * «VOY EN CAMINO» (orden 35): en cada parada por recoger, un botón que le manda al votante un SMS «tu transporte va en camino», una
 * sola vez. A diferencia de las marcas, NECESITA señal (lo manda el servidor) y no entra en la cola: sin señal avisa y se puede
 * volver a tocar. Resultado: «Aviso enviado», o «Esta persona no recibe SMS» (nunca el motivo); el botón no se repite.
 *
 * Una parada cerrada (llevado, no estaba, o el votante ya votó) se colapsa y el servidor ya no manda su dirección ni su
 * teléfono. El teléfono solo vive dentro del enlace «Llamar»: no se escribe en la pantalla.
 *
 * El mapa es Leaflet servido desde /vendor/leaflet con fondo de OpenStreetMap. Sin mapa (sin señal para las teselas, o sin
 * coordenadas) la lista funciona igual.
 */
(function () {
  'use strict';
  var COD = document.body.getAttribute('data-codigo');
  var BASE = '/t/' + encodeURIComponent(COD);
  var CLAVE_COLA = 't_cola_' + COD, CLAVE_LISTA = 't_lista_' + COD;
  var datos = null;          // { conductor, placa, fecha, paradas }
  var sinSenal = false;
  var mapa = null, capa = null;

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function leer(clave, def) { try { var v = JSON.parse(localStorage.getItem(clave)); return v == null ? def : v; } catch (e) { return def; } }
  function guardar(clave, v) { try { localStorage.setItem(clave, JSON.stringify(v)); } catch (e) { /* sin almacenamiento: se sigue en memoria */ } }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'x' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }
  function hora12(hhmm) {
    var m = /^(\d{2}):(\d{2})$/.exec(hhmm || ''); if (!m) return '';
    var h = parseInt(m[1], 10), suf = h >= 12 ? 'p. m.' : 'a. m.';
    return ((h % 12) || 12) + ':' + m[2] + ' ' + suf;
  }

  // ------------------------------------------------------------ la cola sin señal
  function cola() { return leer(CLAVE_COLA, []); }
  function avisoCola() {
    var n = cola().length, a = $('aviso-cola');
    if (!n && !sinSenal) { a.hidden = true; return; }
    a.hidden = false;
    a.textContent = (sinSenal ? 'Sin señal: se muestra la última lista guardada. ' : '') +
      (n ? n + (n === 1 ? ' marca espera' : ' marcas esperan') + ' subir y subirán solas con señal.' : '');
  }
  var subiendo = false;
  function subirCola() {
    if (subiendo) return;
    var q = cola(); if (!q.length) { avisoCola(); return; }
    subiendo = true;
    (function siguiente() {
      q = cola();
      if (!q.length) { subiendo = false; avisoCola(); return; }
      var m = q[0];
      fetch(BASE + '/marcar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { st: r.status, j: j }; }); })
        .then(function (x) {
          if (x.st >= 500) throw new Error('servidor');           // se reintenta luego
          guardar(CLAVE_COLA, cola().slice(1));                    // 200 (aplicada o no) o 4xx definitivo: sale de la cola
          sinSenal = false; siguiente();
        })
        .catch(function () { subiendo = false; sinSenal = true; avisoCola(); });
    })();
  }

  // ------------------------------------------------------------ ubicación, solo al tocar
  function ubicacion(cb) {
    if (!navigator.geolocation) return cb(null);
    var listo = false, fin = function (p) { if (!listo) { listo = true; cb(p); } };
    setTimeout(function () { fin(null); }, 4000);
    try {
      navigator.geolocation.getCurrentPosition(
        function (pos) { fin({ latitud: pos.coords.latitude, longitud: pos.coords.longitude }); },
        function () { fin(null); },
        { timeout: 3500, maximumAge: 60000, enableHighAccuracy: false });
    } catch (e) { fin(null); }
  }

  // ------------------------------------------------------------ marcar
  function aplicarLocal(id, accion, hhmm) {
    datos.paradas.forEach(function (p) {
      if (p.id !== id || p.cerrada) return;
      if (accion === 'recogido' && p.estado === 'asignado') { p.estado = 'recogido'; p.hora = hhmm; }
      else if (accion === 'llevado') { p.estado = 'en_puesto'; p.cerrada = true; p.hora = hhmm; }
      else if (accion === 'no_estaba' && p.estado === 'asignado') { p.estado = 'no_estaba'; p.cerrada = true; p.hora = hhmm; }
      if (p.cerrada) { delete p.direccion; delete p.barrio; delete p.tel; delete p.latitud; delete p.longitud; delete p.puesto; delete p.mesa; delete p.nota; }
    });
  }
  function marcar(id, accion) {
    if (accion === 'no_estaba' && !window.confirm('¿Marcar que esta persona no estaba?')) return;
    var ahora = new Date();
    var m = { parada_id: id, accion: accion, cliente_uuid: uuid(), marcado_en: ahora.toISOString() };
    // LA PANTALLA RESPONDE DE INMEDIATO: la marca entra a la cola y la parada cambia en el acto. La ubicación se pide aparte, solo
    // al tocar, y si llega a tiempo se le agrega a la marca que aún espera; la subida espera a que llegue (o a que se rinda, 4 s).
    var q = cola(); q.push(m); guardar(CLAVE_COLA, q);
    aplicarLocal(id, accion, ('0' + ahora.getHours()).slice(-2) + ':' + ('0' + ahora.getMinutes()).slice(-2));
    guardar(CLAVE_LISTA, datos);
    pintar();
    ubicacion(function (pos) {
      if (pos) {
        var c = cola();
        for (var i = 0; i < c.length; i++) if (c[i].cliente_uuid === m.cliente_uuid) { c[i].latitud = pos.latitud; c[i].longitud = pos.longitud; }
        guardar(CLAVE_COLA, c);
      }
      subirCola();
      // Con el servidor al día, se vuelve a pedir la lista: la parada de otro conductor o un «ya votó» llegan así.
      setTimeout(cargar, 1500);
    });
  }

  // ------------------------------------------------------------ enlaces de navegación (sin API: solo URL)
  function enlaceGoogle(lat, lon, texto) {
    var d = (lat != null && lon != null) ? lat + ',' + lon : encodeURIComponent(texto || '');
    return 'https://www.google.com/maps/dir/?api=1&destination=' + d;
  }
  function enlaceWaze(lat, lon) { return 'https://waze.com/ul?ll=' + lat + ',' + lon + '&navigate=yes'; }

  // ------------------------------------------------------------ pintar
  function pintarParada(p, n) {
    if (p.cerrada) {
      var que = p.ya_voto && p.estado !== 'en_puesto' ? 'Ya votó' : (p.estado === 'no_estaba' ? 'No estaba' : 'Llevado al puesto');
      return '<div class="cerrada">✓ <b>' + esc(p.nombre) + '</b> — ' + que + (p.hora ? ' · ' + esc(hora12(p.hora)) : '') + '</div>';
    }
    var dir = [p.direccion, p.barrio].filter(Boolean).join(' · ');
    var h = '<article class="parada" data-id="' + p.id + '"><header><span class="n">' + n + '</span><strong>' + esc(p.nombre) + '</strong>' +
      '<span class="per">' + p.personas + (p.personas === 1 ? ' persona' : ' personas') + '</span>' +
      '<span class="estado' + (p.estado === 'recogido' ? ' rec' : '') + '">' + (p.estado === 'recogido' ? 'En el vehículo' : 'Por recoger') + '</span></header>';
    h += '<p class="dir">' + (dir ? esc(dir) : 'Sin dirección registrada') + '</p>';
    if (p.nota) h += '<p class="sec">' + esc(p.nota) + '</p>';
    h += '<p class="sec">Puesto: ' + esc(p.puesto || 'sin puesto registrado') + (p.mesa ? ' · Mesa ' + esc(p.mesa) : '') + '</p><div class="acc">';
    if (p.tel) h += '<a href="tel:' + esc(p.tel) + '">Llamar</a>';
    h += '<a href="' + esc(enlaceGoogle(p.latitud, p.longitud, dir)) + '" target="_blank" rel="noopener">Navegar</a>';
    if (p.latitud != null && p.longitud != null) h += '<a href="' + esc(enlaceWaze(p.latitud, p.longitud)) + '" target="_blank" rel="noopener">Waze</a>';
    if (p.puesto_latitud != null && p.puesto_longitud != null) h += '<a href="' + esc(enlaceGoogle(p.puesto_latitud, p.puesto_longitud)) + '" target="_blank" rel="noopener">Cómo llegar al puesto</a>';
    else if (p.puesto) h += '<a href="' + esc(enlaceGoogle(null, null, p.puesto)) + '" target="_blank" rel="noopener">Cómo llegar al puesto</a>';
    h += '</div><div class="marcas">';
    if (p.aviso === 'enviado') h += '<p class="avisado">✓ Aviso enviado</p>';
    else if (p.estado === 'asignado' && p.aviso === 'no_recibe') h += '<p class="avisado no">Esta persona no recibe SMS</p>';
    else if (p.estado === 'asignado' && p.aviso === 'disponible') h += '<button type="button" class="cam" data-aviso="1">Voy en camino</button>';
    if (p.avisoError) h += '<p class="avisado mal">' + esc(p.avisoError) + '</p>';
    if (p.estado === 'asignado') h += '<button type="button" class="rec" data-accion="recogido">Recogido</button>';
    h += '<button type="button" class="lle" data-accion="llevado">Llevado al puesto</button>';
    if (p.estado === 'asignado') h += '<button type="button" class="no" data-accion="no_estaba">No estaba</button>';
    return h + '</div></article>';
  }

  function pintarMapa() {
    var cont = $('mapa');
    var conCoord = datos.paradas.filter(function (p) { return !p.cerrada && p.latitud != null && p.longitud != null; });
    if (!window.L || !conCoord.length) { cont.hidden = true; return; }
    cont.hidden = false;
    if (!mapa) {
      mapa = L.map('mapa', { zoomControl: true, attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; contribuidores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(mapa);
      capa = L.layerGroup().addTo(mapa);
    }
    capa.clearLayers();
    var puntos = [], vistos = {};
    datos.paradas.forEach(function (p, i) {
      if (p.cerrada) return;
      if (p.latitud != null && p.longitud != null) {
        L.marker([p.latitud, p.longitud], { icon: L.divIcon({ className: '', html: '<div class="pin">' + (i + 1) + '</div>', iconSize: [26, 26], iconAnchor: [13, 13] }) })
          .bindPopup(esc(p.nombre)).addTo(capa);
        puntos.push([p.latitud, p.longitud]);
      }
      if (p.puesto_latitud != null && p.puesto_longitud != null && !vistos[p.puesto_latitud + ',' + p.puesto_longitud]) {
        vistos[p.puesto_latitud + ',' + p.puesto_longitud] = true;
        L.marker([p.puesto_latitud, p.puesto_longitud], { icon: L.divIcon({ className: '', html: '<div class="pin puesto">P</div>', iconSize: [26, 26], iconAnchor: [13, 13] }) })
          .bindPopup('Puesto: ' + esc(p.puesto)).addTo(capa);
        puntos.push([p.puesto_latitud, p.puesto_longitud]);
      }
    });
    setTimeout(function () { mapa.invalidateSize(); if (puntos.length) mapa.fitBounds(puntos, { padding: [24, 24], maxZoom: 16 }); }, 50);
  }

  function pintar() {
    if (!datos) return;
    $('quien').textContent = (datos.conductor ? datos.conductor : '') + (datos.placa ? ' · ' + datos.placa : '') + (datos.fecha ? ' · ' + datos.fecha : '');
    var pend = datos.paradas.filter(function (p) { return !p.cerrada && p.estado === 'asignado'; }).length;
    var ruta = datos.paradas.filter(function (p) { return !p.cerrada && p.estado === 'recogido'; }).length;
    var cerr = datos.paradas.filter(function (p) { return p.cerrada; }).length;
    $('c-pend').textContent = pend; $('c-ruta').textContent = ruta; $('c-cerr').textContent = cerr;
    $('cifras').hidden = false;
    var html = '', n = 0;
    datos.paradas.forEach(function (p) { n++; html += pintarParada(p, n); });
    $('lista').innerHTML = html || '<div class="vacio">Todavía no tienes paradas asignadas. Esta pantalla se actualiza sola.</div>';
    pintarMapa();
    avisoCola();
  }

  // «Voy en camino»: el servidor manda el SMS (una sola vez) y responde qué ve el conductor.
  function avisar(id, boton) {
    var p = null; datos.paradas.forEach(function (x) { if (x.id === id) p = x; });
    if (!p) return;
    boton.disabled = true; boton.textContent = 'Avisando…';
    fetch(BASE + '/avisar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parada_id: id }) })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        if (j && j.activo === false) { inactivo(); return; }
        if (j && j.ok && (j.aviso === 'enviado' || j.aviso === 'no_recibe')) { p.aviso = j.aviso; delete p.avisoError; }
        else if (j && j.ok) { p.aviso = null; delete p.avisoError; }                         // 'no_aplica': la parada ya avanzó
        else p.avisoError = (j && j.error) || 'No se pudo enviar el aviso. Intenta de nuevo.';
        guardar(CLAVE_LISTA, datos); pintar();
      })
      .catch(function () { p.avisoError = 'Sin señal: no se pudo enviar el aviso. Intenta de nuevo.'; pintar(); });
  }

  $('lista').addEventListener('click', function (e) {
    var av = e.target.closest ? e.target.closest('button[data-aviso]') : null;
    if (av) { var a = av.closest('.parada'); if (a) avisar(parseInt(a.getAttribute('data-id'), 10), av); return; }
    var b = e.target.closest ? e.target.closest('button[data-accion]') : null;
    if (!b) return;
    var art = b.closest('.parada'); if (!art) return;
    marcar(parseInt(art.getAttribute('data-id'), 10), b.getAttribute('data-accion'));
  });

  // ------------------------------------------------------------ carga
  function inactivo() {
    document.body.innerHTML = '<div class="caja"><h1>Este enlace no está activo</h1><p>Si te lo dio alguien de la campaña, pídele que te envíe el actual.</p></div>';
  }
  function cargar() {
    fetch(BASE + '/lista', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { if (r.status >= 500) throw new Error('servidor'); return r.json(); })
      .then(function (d) {
        sinSenal = false;
        if (!d || d.activo === false) { inactivo(); return; }
        datos = d;
        // Lo que aún espera en la cola se vuelve a aplicar encima: sin esto, una lista pedida antes de que suba la marca la desharía en pantalla.
        cola().forEach(function (m) {
          var t = new Date(m.marcado_en);
          aplicarLocal(m.parada_id, m.accion, ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2));
        });
        guardar(CLAVE_LISTA, datos); pintar(); subirCola();
      })
      .catch(function () {
        sinSenal = true;
        var c = leer(CLAVE_LISTA, null);
        if (c) { datos = c; pintar(); }
        else $('lista').innerHTML = '<div class="vacio">Sin señal y todavía no hay una lista guardada. Abre este enlace una vez con señal.</div>';
        avisoCola();
      });
  }

  window.addEventListener('online', function () { subirCola(); cargar(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) cargar(); });
  setInterval(function () { if (!document.hidden) { subirCola(); cargar(); } }, 45000);
  cargar();
})();
