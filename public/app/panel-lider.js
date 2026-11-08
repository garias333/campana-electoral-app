/**
 * PANEL DEL LÍDER en app/inicio.html (líder, sublíder y aspirante con rol líder).
 *
 * Todo viene de UNA llamada, GET /api/panel-lider (el servidor sabe quién eres por la sesión; aquí nunca se manda un id de
 * persona): meta e inscritos, últimos 7 días, pendientes, equipo, lugar y Día D. Los pendientes abren una lista corta con
 * «Completar»: un formulario de teléfono, puesto y mesa que va a PATCH /api/votantes/:id/datos-basicos.
 *
 * SIN SEÑAL se muestra la última copia DE ESTE USUARIO con su hora, y sin acciones (nada de «Completar» ni de enlaces): una
 * copia es para mirar. La copia se guarda con el id del usuario y se borra al cerrar sesión o al entrar otra cuenta (ver
 * public/js/offline-utils.js y cuentas-dispositivo.js).
 *
 * Requiere api-core.js, offline-utils.js y app-comun.js (escaparAppHtml).
 */
(function () {
  'use strict';

  var STORE = 'panel_lider_cache';
  var esc = function (t) { return (window.escaparAppHtml ? window.escaparAppHtml(t) : String(t == null ? '' : t)); };
  var $ = function (id) { return document.getElementById(id); };
  var numero = function (n) { return Number(n || 0).toLocaleString('es-CO'); };
  var NOMBRES_DIA = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  var NOMBRES_DIA_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  var estado = { datos: null, sinSenal: false, guardadoEn: null, lista: null, puestos: null, completando: null };

  function hora(ms) {
    return new Date(ms).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }

  // ------------------------------------------------------------------------------------------------ dibujo
  function tarjetaMeta(d) {
    var m = d.meta;
    var porEnlace = m.por_enlace > 0
      ? '<div class="pl-detalle">' + numero(m.por_enlace) + ' por tu enlace' + (m.por_enlace_sin_confirmar > 0 ? ' (' + numero(m.por_enlace_sin_confirmar) + ' sin confirmar)' : '') + '</div>'
      : '';
    if (!m.tieneMeta) {
      return '<div class="pl-tarjeta"><div class="pl-titulo">Mi meta</div>' +
        '<div class="pl-vacio">Aún no tienes meta asignada.</div>' +
        '<div class="pl-cifra"><span class="pl-grande">' + numero(m.inscritos) + '</span> <span class="pl-meta">inscritos</span></div>' + porEnlace + '</div>';
    }
    return '<div class="pl-tarjeta"><div class="pl-titulo">Mi meta</div>' +
      '<div class="pl-cifra"><span class="pl-grande">' + numero(m.inscritos) + '</span> <span class="pl-meta">de ' + numero(m.meta) + ' inscritos</span>' +
      '<span class="pl-pct">' + m.porcentaje + '%</span></div>' +
      '<div class="pl-barra"><div class="pl-barra-llena' + (m.porcentaje >= 100 ? ' supera' : '') + '" style="width:' + Math.min(100, m.porcentaje) + '%"></div></div>' + porEnlace + '</div>';
  }

  function tarjetaPosicion(d) {
    var p = d.posicion;
    if (!p || !p.lugar || !p.de) return '';
    return '<div class="pl-tarjeta pl-posicion"><span class="pl-medalla" aria-hidden="true">#</span>' +
      '<div>Vas en el lugar <strong>' + numero(p.lugar) + '</strong> de <strong>' + numero(p.de) + '</strong></div></div>';
  }

  function tarjetaSieteDias(d) {
    var s = d.ultimos_7_dias;
    if (!s || !s.dias) return '';
    var max = Math.max.apply(null, s.dias.map(function (x) { return x.n; }).concat([1]));
    var barras = s.dias.map(function (x) {
      var f = new Date(x.fecha + 'T12:00:00');
      var alto = x.n ? Math.max(6, Math.round((x.n / max) * 100)) : 2;
      var esHoy = x.fecha === s.hoy;
      return '<div class="pl-dia' + (esHoy ? ' hoy' : '') + '" title="' + esc(NOMBRES_DIA_LARGOS[f.getDay()] + ': ' + x.n) + '">' +
        '<span class="pl-dia-n">' + (x.n || '') + '</span>' +
        '<div class="pl-dia-barra"><div style="height:' + alto + '%"></div></div>' +
        '<span class="pl-dia-l">' + NOMBRES_DIA[f.getDay()] + '</span></div>';
    }).join('');
    return '<div class="pl-tarjeta"><div class="pl-titulo">Últimos 7 días</div><div class="pl-dias">' + barras + '</div>' +
      '<div class="pl-detalle">' + (s.total === 1 ? '1 inscrito' : numero(s.total) + ' inscritos') + ' en la semana</div></div>';
  }

  function tarjetaPendientes(d) {
    var p = d.pendientes;
    if (!p) return '';
    var puede = !estado.sinSenal;
    var ficha = function (tipo, n, texto, accion) {
      var contenido = '<span class="pl-pend-n">' + numero(n) + '</span><span class="pl-pend-t">' + texto + '</span>';
      if (accion && n > 0 && puede) return '<button type="button" class="pl-pend" data-pendiente="' + tipo + '">' + contenido + '<span class="pl-pend-flecha" aria-hidden="true">›</span></button>';
      return '<div class="pl-pend pl-pend-info' + (n === 0 ? ' cero' : '') + '">' + contenido + '</div>';
    };
    return '<div class="pl-tarjeta"><div class="pl-titulo">Por completar</div><div class="pl-pends">' +
      ficha('sin_telefono', p.sin_telefono, 'sin teléfono', true) +
      ficha('sin_puesto', p.sin_puesto, 'sin puesto', true) +
      ficha('sin_verificar', p.sin_verificar, 'sin verificar', false) + '</div>' +
      '<div class="pl-detalle">«Sin verificar» es solo para que lo sepas: lo marca la administración.</div></div>';
  }

  // «Mis tareas» (parche 305): solo cifras de lo que tiene ASIGNADO; ningún título. Llega solo si tiene «Ver» en el módulo `tareas`.
  function tarjetaTareas(d) {
    var t = d.tareas;
    if (!t) return '';
    var ficha = function (n, texto, alerta) {
      return '<div class="pl-pend pl-pend-info' + (n === 0 ? ' cero' : '') + '"' + (alerta && n > 0 ? ' style="border-color:#C0392B;color:#C0392B;"' : '') + '><span class="pl-pend-n">' + numero(n) + '</span><span class="pl-pend-t">' + texto + '</span></div>';
    };
    return '<div class="pl-tarjeta" id="pl-tareas"><div class="pl-titulo">Mis tareas</div><div class="pl-pends">' +
      ficha(t.pendientes, 'pendientes', false) + ficha(t.vencen_hoy, 'vencen hoy', false) + ficha(t.vencidas, 'vencidas', true) + '</div>' +
      (t.devueltas > 0 ? '<div class="pl-detalle">' + numero(t.devueltas) + (t.devueltas === 1 ? ' te la devolvieron' : ' te las devolvieron') + ' para completar.</div>' : '') +
      (estado.sinSenal ? '' : '<div class="pl-detalle"><a href="/app/mis-tareas.html">Abrir mis tareas ›</a></div>') + '</div>';
  }

  function tarjetaEquipo(d) {
    var e = d.equipo || [];
    if (!e.length) return '';
    return '<div class="pl-tarjeta"><div class="pl-titulo">Mi equipo</div>' + e.map(function (x) {
      var pct = x.meta > 0 ? Math.min(100, Math.round((x.registros / x.meta) * 100)) : 0;
      return '<div class="pl-miembro"><div class="pl-miembro-fila"><span class="pl-miembro-nombre">' + esc(x.nombre) + '</span>' +
        '<span class="pl-miembro-cifra">' + numero(x.registros) + (x.meta > 0 ? ' / ' + numero(x.meta) : '') + '</span></div>' +
        (x.meta > 0 ? '<div class="pl-barra pl-barra-fina"><div class="pl-barra-llena" style="width:' + pct + '%"></div></div>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function tarjetaDiaD(d) {
    var x = d.dia_d;
    if (!x) return '';
    var boton = estado.sinSenal ? '' : '<a class="btn-app btn-app-primario pl-boton" href="/app/faltantes.html">Ir a Faltan por votar</a>';
    return '<div class="pl-tarjeta pl-dia-d"><div class="pl-titulo">Día D' + (x.modo_prueba ? ' <span class="pl-etiqueta">Modo prueba</span>' : '') + '</div>' +
      '<div class="pl-cifra"><span class="pl-grande">Faltan ' + numero(x.faltan) + '</span> <span class="pl-meta">por votar</span></div>' +
      '<div class="pl-barra"><div class="pl-barra-llena verde" style="width:' + Math.min(100, x.pct) + '%"></div></div>' +
      '<div class="pl-detalle">' + numero(x.votaron) + ' de ' + numero(x.total) + ' ya votaron (' + String(x.pct).replace('.', ',') + ' %)</div>' + boton + '</div>';
  }

  function dibujar() {
    var cont = $('panel-lider');
    if (!cont || !estado.datos) return;
    var d = estado.datos;
    var pie = estado.sinSenal
      ? '<div class="pl-sin-senal">Sin señal: esta es la copia de las ' + hora(estado.guardadoEn) + '. Solo puedes mirarla.</div>'
      : '<div class="pl-pie">Actualizado a las ' + hora(estado.guardadoEn) + '</div>';
    cont.innerHTML = pie + tarjetaDiaD(d) + tarjetaTareas(d) + tarjetaMeta(d) + tarjetaPosicion(d) + tarjetaSieteDias(d) + tarjetaPendientes(d) + tarjetaEquipo(d);
    cont.hidden = false;
  }

  // ------------------------------------------------------------------------------------------------ carga
  async function cargar() {
    try {
      var datos = await window.api('/panel-lider');
      if (!datos) return;
      estado.datos = datos; estado.sinSenal = false; estado.guardadoEn = Date.now();
      try { await window.guardarCopiaOffline(STORE, 'panel', datos); } catch (_) { /* sin copia */ }
    } catch (err) {
      if (!err || !err.esErrorDeRed) return;   // un error de verdad del servidor: el panel simplemente no se muestra
      var copia = null;
      try { copia = await window.leerCopiaOffline(STORE, 'panel'); } catch (_) { copia = null; }
      if (!copia) return;
      estado.datos = copia.datos; estado.sinSenal = true; estado.guardadoEn = copia.guardadoEn;
    }
    dibujar();
  }

  // ------------------------------------------------------------------------------------------------ lista de pendientes
  function hoja(html) {
    var h = $('pl-hoja');
    if (!h) {
      h = document.createElement('div');
      h.id = 'pl-hoja';
      h.className = 'pl-hoja';
      document.body.appendChild(h);
      h.addEventListener('click', function (ev) { if (ev.target === h) cerrarHoja(); });
    }
    h.innerHTML = '<div class="pl-hoja-caja" role="dialog" aria-modal="true">' + html + '</div>';
    h.classList.add('abierta');
    document.body.classList.add('pl-bloqueado');
  }
  function cerrarHoja() {
    var h = $('pl-hoja');
    if (h) { h.classList.remove('abierta'); h.innerHTML = ''; }
    document.body.classList.remove('pl-bloqueado');
    estado.completando = null;
  }

  function faltaTexto(f) {
    return f.map(function (x) { return x === 'telefono' ? 'Sin teléfono' : 'Sin puesto'; }).join(' · ');
  }

  async function abrirLista(tipo, pagina) {
    var titulo = tipo === 'sin_telefono' ? 'Sin teléfono' : 'Sin puesto de votación';
    if (!pagina || pagina === 1) { estado.lista = { tipo: tipo, items: [], total: 0, page: 0 }; hoja('<h2>' + titulo + '</h2><p class="pl-detalle">Cargando…</p>'); }
    try {
      var r = await window.api('/panel-lider/pendientes?tipo=' + encodeURIComponent(tipo) + '&page=' + (pagina || 1));
      if (!r) return;
      estado.lista.items = estado.lista.items.concat(r.items); estado.lista.total = r.total; estado.lista.page = r.page; estado.lista.por = r.por_pagina;
      pintarLista();
    } catch (err) {
      hoja('<h2>' + titulo + '</h2><p class="pl-detalle">' + (err && err.esErrorDeRed ? 'Sin señal. Vuelve a intentar cuando tengas conexión.' : esc((err && err.message) || 'No se pudo cargar la lista.')) +
        '</p><button type="button" class="btn-app btn-app-secundario" data-cerrar-hoja>Cerrar</button>');
    }
  }

  function pintarLista() {
    var l = estado.lista;
    var titulo = l.tipo === 'sin_telefono' ? 'Sin teléfono' : 'Sin puesto de votación';
    var filas = l.items.map(function (x) {
      return '<div class="pl-fila"><div class="pl-fila-datos"><strong>' + esc(x.nombre) + '</strong>' +
        '<span>' + esc(x.barrio || 'Sin barrio') + ' · ' + faltaTexto(x.falta) + '</span></div>' +
        '<button type="button" class="pl-completar" data-completar="' + x.id + '">Completar</button></div>';
    }).join('');
    hoja('<h2>' + titulo + ' <span class="pl-contador">' + numero(l.total) + '</span></h2>' +
      (filas || '<p class="pl-detalle">No queda nadie en esta lista.</p>') +
      (l.items.length < l.total ? '<button type="button" class="btn-app btn-app-secundario" data-mas>Ver más</button>' : '') +
      '<button type="button" class="btn-app btn-app-secundario" data-cerrar-hoja>Cerrar</button>');
  }

  // ------------------------------------------------------------------------------------------------ completar
  async function cargarPuestos() {
    if (estado.puestos) return estado.puestos;
    var f = () => window.api('/dia-d/puestos-con-mesas');
    estado.puestos = typeof window.obtenerConCacheReferencia === 'function'
      ? await window.obtenerConCacheReferencia('diad_puestos_con_mesas', f) : await f();
    return estado.puestos;
  }

  async function abrirFormulario(id) {
    var persona = estado.lista.items.find(function (x) { return x.id === id; });
    if (!persona) return;
    estado.completando = persona;
    hoja('<h2>Completar</h2><p class="pl-detalle">Cargando…</p>');
    var puestos = [];
    try { puestos = await cargarPuestos(); } catch (_) { puestos = []; }
    var ops = '<option value="">Sin cambiar</option>' + puestos.map(function (p) { return '<option value="' + p.id + '" data-mesas="' + (p.cantidad_mesas || 0) + '">' + esc(p.nombre) + '</option>'; }).join('');
    hoja('<h2>Completar</h2><p class="pl-quien"><strong>' + esc(persona.nombre) + '</strong><br><span>' + esc(persona.barrio || 'Sin barrio') + ' · ' + faltaTexto(persona.falta) + '</span></p>' +
      '<div id="pl-error" class="pl-error" hidden></div>' +
      '<div class="campo-app"><label for="pl-tel">Teléfono (10 dígitos)</label><input id="pl-tel" type="tel" inputmode="numeric" maxlength="14" autocomplete="off" placeholder="3001234567"></div>' +
      '<div class="campo-app"><label for="pl-puesto">Puesto de votación</label><select id="pl-puesto">' + ops + '</select></div>' +
      '<div class="campo-app"><label for="pl-mesa">Mesa</label><select id="pl-mesa"><option value="">Sin cambiar</option></select><small>Elige primero el puesto.</small></div>' +
      '<button type="button" class="btn-app btn-app-primario" data-guardar-datos>Guardar</button>' +
      '<button type="button" class="btn-app btn-app-secundario" data-volver-lista>Volver a la lista</button>');
  }

  function llenarMesas() {
    var sel = $('pl-puesto'); var mesa = $('pl-mesa');
    var op = sel.options[sel.selectedIndex];
    var n = Number(op && op.dataset ? op.dataset.mesas : 0) || 0;
    mesa.innerHTML = '<option value="">Sin cambiar</option>' + Array.from({ length: n }, function (_, i) { return '<option value="' + (i + 1) + '">' + (i + 1) + '</option>'; }).join('');
  }

  function mostrarError(texto) {
    var e = $('pl-error');
    e.textContent = texto; e.hidden = !texto;
  }

  async function guardarDatos() {
    var p = estado.completando;
    if (!p) return;
    var cuerpo = {};
    var tel = ($('pl-tel').value || '').replace(/\D/g, '');
    if ($('pl-tel').value.trim()) {
      if (tel.length !== 10) { mostrarError('El teléfono debe tener 10 dígitos.'); return; }
      cuerpo.telefono = tel;
    }
    if ($('pl-puesto').value) cuerpo.puesto_id = Number($('pl-puesto').value);
    if ($('pl-mesa').value) cuerpo.mesa = Number($('pl-mesa').value);
    if (cuerpo.mesa && !cuerpo.puesto_id) { mostrarError('Para poner la mesa, elige primero el puesto.'); return; }
    if (!Object.keys(cuerpo).length) { mostrarError('Escribe el teléfono o elige el puesto.'); return; }
    mostrarError('');
    var boton = document.querySelector('[data-guardar-datos]');
    if (boton) { boton.disabled = true; boton.textContent = 'Guardando…'; }
    try {
      await window.api('/votantes/' + p.id + '/datos-basicos', { method: 'PATCH', body: cuerpo });
      // Ya no le falta lo que se completó: sale de la lista (o se le quita lo que ya tiene) y se recalculan los números.
      var l = estado.lista;
      var completo = (cuerpo.telefono && l.tipo === 'sin_telefono') || (cuerpo.puesto_id && l.tipo === 'sin_puesto');
      if (completo) { l.items = l.items.filter(function (x) { return x.id !== p.id; }); l.total = Math.max(0, l.total - 1); }
      else { p.falta = p.falta.filter(function (f) { return !((f === 'telefono' && cuerpo.telefono) || (f === 'puesto' && cuerpo.puesto_id)); }); }
      estado.completando = null;
      pintarLista();
      cargar();
    } catch (err) {
      if (boton) { boton.disabled = false; boton.textContent = 'Guardar'; }
      mostrarError(err && err.esErrorDeRed ? 'Sin señal: no se pudo guardar. Intenta de nuevo cuando tengas conexión.' : ((err && err.message) || 'No se pudo guardar.'));
    }
  }

  // ------------------------------------------------------------------------------------------------ eventos
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-pendiente],[data-completar],[data-mas],[data-cerrar-hoja],[data-guardar-datos],[data-volver-lista]') : null;
    if (!t) return;
    if (t.hasAttribute('data-pendiente')) abrirLista(t.dataset.pendiente, 1);
    else if (t.hasAttribute('data-completar')) abrirFormulario(Number(t.dataset.completar));
    else if (t.hasAttribute('data-mas')) abrirLista(estado.lista.tipo, estado.lista.page + 1);
    else if (t.hasAttribute('data-cerrar-hoja')) cerrarHoja();
    else if (t.hasAttribute('data-guardar-datos')) guardarDatos();
    else if (t.hasAttribute('data-volver-lista')) { estado.completando = null; pintarLista(); }
  });
  document.addEventListener('change', function (ev) { if (ev.target && ev.target.id === 'pl-puesto') llenarMesas(); });

  window.PanelLider = {
    iniciar: function () {
      cargar();
      window.addEventListener('online', cargar);
    },
    recargar: cargar,
  };
})();
