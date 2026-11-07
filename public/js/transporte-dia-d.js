/**
 * Pestaña «Transporte» del Día D (public/dia-d.html) y su contador en el cuadro (orden 33).
 *
 * La coordinación ve a quienes necesitan transporte (los que el líder marcó), crea vehículos y conductores, asigna a
 * cada conductor una lista de paradas y le manda su enlace. TODO el cálculo es del servidor (routes/transporteDiaD.routes.js
 * y lib/transporteDiaD.js); aquí solo se pinta y se pide. El conductor no usa esta pantalla: abre su enlace /t/<código>.
 *
 * «Llevado al puesto» NO es «ya votó»: este módulo no toca la marca de voto.
 */
(function () {
  'use strict';
  var estado = { ctx: null, demanda: [], truncado: false, vehiculos: [], conductores: [], sel: {}, filtro: 'todos', conductor: '', votaron: false,
                 editVeh: null, editCond: null, montado: false };
  var temporizador = null;
  var ESTADOS = { asignado: 'Asignado', recogido: 'Recogido', en_puesto: 'En el puesto', no_estaba: 'No estaba' };

  function $(id) { return document.getElementById(id); }
  var esc = function (t) { return (window.escaparHtml ? window.escaparHtml(t) : String(t == null ? '' : t)); };
  function llamar(ruta, opciones) { return window.api('/dia-d/transporte' + ruta, opciones); }
  function aviso(txt, mal) { var a = $('tr-aviso'); if (!a) return; a.textContent = txt || ''; a.style.color = mal ? '#A93226' : '#0A5348'; a.style.display = txt ? 'block' : 'none'; }

  // ---------------------------------------------------------------- contador (también en el cuadro principal)
  function pintarContador(r) {
    var m = { necesitan: r.necesitan, asignados: r.asignados, recogidos: r.recogidos, en_puesto: r.en_puesto, no_estaban: r.no_estaban, sin_recoger: r.sin_recoger };
    Object.keys(m).forEach(function (k) {
      ['stat-tr-' + k, 'tr-c-' + k].forEach(function (id) { var e = $(id); if (e) e.textContent = m[k]; });
    });
  }
  function cargarContador() {
    return llamar('/resumen').then(pintarContador).catch(function () { /* el cuadro sigue sin esta fila */ });
  }
  function iniciarContador() {
    var f = $('fila-transporte'); if (f) f.style.display = 'block';
    cargarContador();
    clearInterval(temporizador);
    temporizador = setInterval(function () { if (!document.hidden) cargarContador(); }, 30000);
  }

  // ---------------------------------------------------------------- la pantalla
  function montar() {
    if (estado.montado) return;
    estado.montado = true;
    $('vista-transporte').innerHTML =
      '<div id="tr-aviso" style="display:none; padding:9px 12px; border-radius:8px; background:#F3F5F8; margin-bottom:12px; font-size:0.9rem;"></div>' +
      '<div class="card" style="margin-bottom:18px;"><div class="toolbar"><h3 style="margin:0;">Transporte del día de elecciones</h3><span class="mono" id="tr-fecha" style="color:var(--color-text-muted);"></span></div>' +
      '<div class="grid grid-6">' + [['necesitan', 'Necesitan'], ['asignados', 'Asignados'], ['recogidos', 'Recogidos'], ['en_puesto', 'En el puesto'], ['no_estaban', 'No estaban'], ['sin_recoger', 'Sin recoger']]
        .map(function (c) { return '<div class="card stat-card"><div class="label">' + c[1] + '</div><div class="valor" id="tr-c-' + c[0] + '">—</div></div>'; }).join('') + '</div>' +
      '<p style="font-size:0.82rem; color:var(--color-text-muted); margin:8px 0 0;">«Llevado al puesto» no es «ya votó»: la marca de voto no se toca. El enlace de cada conductor solo funciona el día de la elección.</p></div>' +

      '<div class="card" style="margin-bottom:18px;"><div class="toolbar"><h3 style="margin:0;">Quienes necesitan transporte</h3></div>' +
      '<div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:10px;">' +
        '<select id="tr-filtro"><option value="todos">Todos</option><option value="sin_asignar">Sin asignar</option><option value="asignados">Asignados</option></select>' +
        '<select id="tr-filtro-conductor"><option value="">Todos los conductores</option></select>' +
        '<label style="display:flex; gap:6px; align-items:center; font-size:0.88rem;"><input type="checkbox" id="tr-votaron" style="width:auto;"> Incluir a quienes ya votaron</label></div>' +
      '<div id="tr-barra" style="display:none; gap:10px; flex-wrap:wrap; align-items:center; background:#E6F4F1; border-radius:8px; padding:9px 12px; margin-bottom:10px;">' +
        '<strong id="tr-n-sel">0 seleccionados</strong><select id="tr-asignar-a"></select>' +
        '<button type="button" class="btn-acento btn-sm" id="tr-btn-asignar">Asignar</button>' +
        '<button type="button" class="btn-secundario btn-sm" id="tr-btn-quitar">Quitar de su conductor</button></div>' +
      '<div class="tabla-contenedor"><table><thead><tr><th style="width:28px;"><input type="checkbox" id="tr-todos" style="width:auto;" title="Elegir todos los que se ven"></th><th>Persona</th><th>Dirección</th><th>Pers.</th><th>Estado</th><th>Conductor</th><th></th></tr></thead><tbody id="tr-tbody-demanda"></tbody></table></div>' +
      '<div class="vacio" id="tr-vacio-demanda" style="display:none;"><div class="icono-vacio">🚐</div>Nadie en esta lista. Los líderes marcan «necesita transporte» en Faltan por votar o en la ficha de la persona.</div></div>' +

      '<div class="card" style="margin-bottom:18px;"><div class="toolbar"><h3 style="margin:0;">Conductores</h3><button type="button" class="btn-acento btn-sm" id="tr-btn-nuevo-cond">+ Nuevo conductor</button></div>' +
      '<form id="tr-form-cond" style="display:none; gap:10px; flex-wrap:wrap; align-items:flex-end; margin-bottom:12px;">' +
        '<label>Nombre<br><input id="tr-c-nombre" maxlength="120" required></label><label>Celular<br><input id="tr-c-celular" inputmode="numeric" maxlength="12" placeholder="3001234567"></label>' +
        '<label>Vehículo<br><select id="tr-c-veh"></select></label><button type="submit" class="btn-acento btn-sm" id="tr-c-guardar">Guardar</button><button type="button" class="btn-secundario btn-sm" id="tr-c-cancelar">Cancelar</button></form>' +
      '<div class="tabla-contenedor"><table><thead><tr><th>Conductor</th><th>Vehículo</th><th>Carga</th><th>Enlace para el conductor</th><th>Ordenar paradas</th><th></th></tr></thead><tbody id="tr-tbody-cond"></tbody></table></div>' +
      '<div class="vacio" id="tr-vacio-cond" style="display:none;">Todavía no hay conductores.</div></div>' +

      '<div class="card"><div class="toolbar"><h3 style="margin:0;">Vehículos</h3><button type="button" class="btn-acento btn-sm" id="tr-btn-nuevo-veh">+ Nuevo vehículo</button></div>' +
      '<form id="tr-form-veh" style="display:none; gap:10px; flex-wrap:wrap; align-items:flex-end; margin-bottom:12px;">' +
        '<label>Placa<br><input id="tr-v-placa" maxlength="12" required style="text-transform:uppercase;"></label><label>Tipo<br><select id="tr-v-tipo"></select></label>' +
        '<label>Capacidad (personas)<br><input id="tr-v-cap" type="number" min="1" max="80" value="4" style="width:90px;"></label><label>Descripción<br><input id="tr-v-desc" maxlength="150"></label>' +
        '<button type="submit" class="btn-acento btn-sm">Guardar</button><button type="button" class="btn-secundario btn-sm" id="tr-v-cancelar">Cancelar</button></form>' +
      '<div class="tabla-contenedor"><table><thead><tr><th>Placa</th><th>Tipo</th><th>Capacidad</th><th>Descripción</th><th></th></tr></thead><tbody id="tr-tbody-veh"></tbody></table></div>' +
      '<div class="vacio" id="tr-vacio-veh" style="display:none;">Todavía no hay vehículos.</div></div>';

    $('tr-filtro').addEventListener('change', function (e) { estado.filtro = e.target.value; recargarDemanda(); });
    $('tr-filtro-conductor').addEventListener('change', function (e) { estado.conductor = e.target.value; recargarDemanda(); });
    $('tr-votaron').addEventListener('change', function (e) { estado.votaron = e.target.checked; recargarDemanda(); });
    $('tr-todos').addEventListener('change', function (e) { estado.demanda.forEach(function (v) { if (e.target.checked) estado.sel[v.id] = true; else delete estado.sel[v.id]; }); pintarDemanda(); });
    $('tr-btn-asignar').addEventListener('click', asignar);
    $('tr-btn-quitar').addEventListener('click', desasignar);
    $('tr-tbody-demanda').addEventListener('change', function (e) { var c = e.target.closest('input[data-sel]'); if (!c) return; if (c.checked) estado.sel[c.dataset.sel] = true; else delete estado.sel[c.dataset.sel]; actualizarBarra(); });
    $('tr-tbody-demanda').addEventListener('click', function (e) { var b = e.target.closest('button[data-detalle]'); if (b) editarParada(Number(b.dataset.detalle)); });
    $('tr-btn-nuevo-cond').addEventListener('click', function () { abrirFormCond(null); });
    $('tr-c-cancelar').addEventListener('click', function () { $('tr-form-cond').style.display = 'none'; });
    $('tr-form-cond').addEventListener('submit', guardarConductor);
    $('tr-btn-nuevo-veh').addEventListener('click', function () { abrirFormVeh(null); });
    $('tr-v-cancelar').addEventListener('click', function () { $('tr-form-veh').style.display = 'none'; });
    $('tr-form-veh').addEventListener('submit', guardarVehiculo);
    $('tr-tbody-cond').addEventListener('click', accionConductor);
    $('tr-tbody-veh').addEventListener('click', accionVehiculo);
  }

  // ---------------------------------------------------------------- carga
  function recargarTodo() {
    return Promise.all([llamar('/contexto'), llamar('/vehiculos'), llamar('/conductores')]).then(function (r) {
      estado.ctx = r[0]; estado.vehiculos = r[1]; estado.conductores = r[2];
      $('tr-fecha').textContent = 'Día de la elección: ' + estado.ctx.fecha + (estado.ctx.fecha_configurada ? '' : ' (sin fecha configurada: se usa hoy)');
      $('tr-v-tipo').innerHTML = estado.ctx.tipos_vehiculo.map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('');
      pintarVehiculos(); pintarConductores();
      return recargarDemanda();
    }).then(cargarContador).catch(function (e) { aviso(e.message || 'No se pudo cargar el transporte.', true); });
  }
  function recargarDemanda() {
    var q = '?filtro=' + estado.filtro + (estado.conductor ? '&conductor_id=' + estado.conductor : '') + (estado.votaron ? '&votaron=1' : '');
    return llamar('/demanda' + q).then(function (r) {
      estado.demanda = r.votantes; estado.truncado = r.truncado;
      var vivos = {}; r.votantes.forEach(function (v) { vivos[v.id] = true; });
      Object.keys(estado.sel).forEach(function (k) { if (!vivos[k]) delete estado.sel[k]; });
      pintarDemanda();
    }).catch(function (e) { aviso(e.message || 'No se pudo cargar la lista.', true); });
  }

  // ---------------------------------------------------------------- demanda
  function pintarDemanda() {
    var cuerpo = '', puesto = null, barrio = null;
    estado.demanda.forEach(function (v) {
      if (v.puesto !== puesto) { puesto = v.puesto; barrio = null; cuerpo += '<tr><td colspan="7" style="background:#EEF2F8; font-weight:700;">' + esc(puesto) + '</td></tr>'; }
      var b = v.barrio || 'Sin barrio';
      if (b !== barrio) { barrio = b; cuerpo += '<tr><td colspan="7" style="background:#F7F9FC; color:var(--color-text-muted); padding-left:24px;">' + esc(b) + '</td></tr>'; }
      var chip = v.ya_voto ? '<span style="color:#0A5348;">Ya votó</span>' : (v.estado ? esc(ESTADOS[v.estado] || v.estado) : '<span style="color:#8A5A00;">Sin asignar</span>');
      cuerpo += '<tr><td><input type="checkbox" data-sel="' + v.id + '" style="width:auto;"' + (estado.sel[v.id] ? ' checked' : '') + (v.ya_voto ? ' disabled' : '') + '></td>' +
        '<td>' + esc(v.nombre) + (v.mesa ? ' <small style="color:var(--color-text-muted);">Mesa ' + esc(v.mesa) + '</small>' : '') + '</td>' +
        '<td>' + esc(v.direccion || '—') + (v.latitud == null ? ' <small title="Sin coordenadas: no entra en «ordenar por cercanía»" style="color:#8A5A00;">📍?</small>' : '') + '</td>' +
        '<td>' + (v.personas || 1) + '</td><td>' + chip + '</td>' +
        '<td>' + (v.conductor ? esc(v.conductor) + (v.orden ? ' <small>#' + v.orden + '</small>' : '') : '—') + '</td>' +
        '<td>' + (v.asignacion_id ? '<button type="button" class="btn-secundario btn-sm" data-detalle="' + v.id + '" title="Personas y nota para el conductor">✎</button>' : '') + '</td></tr>';
    });
    $('tr-tbody-demanda').innerHTML = cuerpo;
    $('tr-vacio-demanda').style.display = estado.demanda.length ? 'none' : 'block';
    actualizarBarra();
  }
  function actualizarBarra() {
    var n = Object.keys(estado.sel).length;
    $('tr-barra').style.display = n ? 'flex' : 'none';
    $('tr-n-sel').textContent = n + (n === 1 ? ' seleccionado' : ' seleccionados');
  }
  function seleccionados() { return Object.keys(estado.sel).map(Number); }

  function asignar() {
    var conductor = Number($('tr-asignar-a').value);
    if (!conductor) { aviso('Elige un conductor.', true); return; }
    llamar('/asignar', { method: 'POST', body: { conductor_id: conductor, votante_ids: seleccionados() } }).then(function (r) {
      var txt = r.asignados + (r.asignados === 1 ? ' persona asignada.' : ' personas asignadas.');
      if (r.omitidos.length) txt += ' ' + r.omitidos.length + ' no se asignaron (ya estaban en camino, ya votaron, no están marcadas o están fuera de tu alcance).';
      // El aviso de capacidad NO bloquea: ya quedó asignado.
      if (r.capacidad && r.capacidad.excede) txt += ' ⚠ Pasa de la capacidad del vehículo: ' + r.capacidad.ocupacion + ' personas para ' + r.capacidad.capacidad + ' lugares.';
      aviso(txt, !!(r.capacidad && r.capacidad.excede));
      estado.sel = {};
      return recargarTodo();
    }).catch(function (e) { aviso(e.message, true); });
  }
  function desasignar() {
    llamar('/desasignar', { method: 'POST', body: { votante_ids: seleccionados() } }).then(function (r) {
      aviso(r.quitados + (r.quitados === 1 ? ' persona quitada de su conductor.' : ' personas quitadas de su conductor.') + (r.omitidos.length ? ' ' + r.omitidos.length + ' ya estaban cerradas y no se tocaron.' : ''));
      estado.sel = {};
      return recargarTodo();
    }).catch(function (e) { aviso(e.message, true); });
  }
  function editarParada(votanteId) {
    var v = estado.demanda.filter(function (x) { return x.id === votanteId; })[0];
    if (!v || !v.asignacion_id) return;
    var p = window.prompt('¿Cuántas personas recoge en esta parada? (la persona y quienes van con ella)', v.personas || 1);
    if (p === null) return;
    var n = window.prompt('Nota para el conductor (opcional):', v.nota || '');
    if (n === null) return;
    llamar('/asignaciones/' + v.asignacion_id, { method: 'PUT', body: { personas: Number(p) || 1, nota: n } }).then(recargarTodo).catch(function (e) { aviso(e.message, true); });
  }

  // ---------------------------------------------------------------- conductores
  function opcionesConductores(conVacio) {
    return (conVacio || '') + estado.conductores.filter(function (c) { return c.activo; }).map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.nombre) + (c.placa ? ' · ' + esc(c.placa) : '') + '</option>'; }).join('');
  }
  function pintarConductores() {
    var sel = estado.conductor;
    $('tr-filtro-conductor').innerHTML = '<option value="">Todos los conductores</option>' + estado.conductores.map(function (c) { return '<option value="' + c.id + '">' + esc(c.nombre) + '</option>'; }).join('');
    $('tr-filtro-conductor').value = sel;
    $('tr-asignar-a').innerHTML = opcionesConductores('<option value="">Asignar a…</option>');
    var puestos = (estado.ctx && estado.ctx.puestos) || [];
    var origen = '<option value="primero">Desde su primera parada</option><option value="gps">Desde mi ubicación (GPS)</option>' +
      puestos.map(function (p) { return '<option value="p' + p.id + '">Desde: ' + esc(p.nombre) + '</option>'; }).join('');
    $('tr-tbody-cond').innerHTML = estado.conductores.map(function (c) {
      var carga = c.capacidad != null ? c.ocupacion + ' / ' + c.capacidad : String(c.ocupacion);
      var wa = 'https://wa.me/' + (c.celular ? '57' + c.celular : '') + '?text=' + encodeURIComponent(c.texto);
      var sms = 'sms:' + (c.celular || '') + '?&body=' + encodeURIComponent(c.texto);
      return '<tr' + (c.activo ? '' : ' style="opacity:.55;"') + '><td><strong>' + esc(c.nombre) + '</strong><br><small>' + esc(c.celular || 'sin celular') + (c.activo ? '' : ' · desactivado') + '</small></td>' +
        '<td><select data-veh="' + c.id + '"><option value="">Sin vehículo</option>' + estado.vehiculos.filter(function (v) { return v.activo || v.id === c.vehiculo_id; }).map(function (v) {
          return '<option value="' + v.id + '"' + (v.id === c.vehiculo_id ? ' selected' : '') + '>' + esc(v.placa) + '</option>'; }).join('') + '</select></td>' +
        '<td><span' + (c.excede ? ' style="color:#A93226; font-weight:700;" title="Pasa de la capacidad del vehículo"' : '') + '>' + carga + (c.excede ? ' ⚠' : '') + '</span><br><small>' + c.paradas + ' paradas</small></td>' +
        '<td><div style="display:flex; gap:6px; flex-wrap:wrap;">' +
          '<a class="btn-secundario btn-sm" href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a><a class="btn-secundario btn-sm" href="' + esc(sms) + '">SMS</a>' +
          '<button type="button" class="btn-secundario btn-sm" data-copiar="' + c.id + '">Copiar</button><button type="button" class="btn-secundario btn-sm" data-rotar="' + c.id + '" title="El enlace anterior deja de servir">Rotar</button></div></td>' +
        '<td><div style="display:flex; gap:6px; flex-wrap:wrap;"><select data-origen="' + c.id + '">' + origen + '</select><button type="button" class="btn-secundario btn-sm" data-ordenar="' + c.id + '">Ordenar por cercanía</button></div></td>' +
        '<td><button type="button" class="btn-secundario btn-sm" data-editar-cond="' + c.id + '">Editar</button> <button type="button" class="btn-secundario btn-sm" data-activo-cond="' + c.id + '">' + (c.activo ? 'Desactivar' : 'Activar') + '</button></td></tr>';
    }).join('');
    $('tr-vacio-cond').style.display = estado.conductores.length ? 'none' : 'block';
  }
  function abrirFormCond(id) {
    estado.editCond = id;
    var c = id ? estado.conductores.filter(function (x) { return x.id === id; })[0] : null;
    $('tr-c-nombre').value = c ? c.nombre : ''; $('tr-c-celular').value = c ? (c.celular || '') : '';
    $('tr-c-veh').innerHTML = '<option value="">Sin vehículo</option>' + estado.vehiculos.filter(function (v) { return v.activo; }).map(function (v) { return '<option value="' + v.id + '">' + esc(v.placa) + ' (' + v.capacidad + ')</option>'; }).join('');
    $('tr-c-veh').value = c && c.vehiculo_id ? c.vehiculo_id : '';
    $('tr-form-cond').style.display = 'flex'; $('tr-c-nombre').focus();
  }
  function guardarConductor(e) {
    e.preventDefault();
    var cuerpo = { nombre: $('tr-c-nombre').value, celular: $('tr-c-celular').value, vehiculo_id: $('tr-c-veh').value || null };
    var p = estado.editCond ? llamar('/conductores/' + estado.editCond, { method: 'PUT', body: cuerpo }) : llamar('/conductores', { method: 'POST', body: cuerpo });
    p.then(function () { $('tr-form-cond').style.display = 'none'; aviso('Conductor guardado.'); return recargarTodo(); }).catch(function (er) { aviso(er.message, true); });
  }
  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(texto);
    var t = document.createElement('textarea'); t.value = texto; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (_) { /* sin portapapeles */ } t.remove(); return Promise.resolve();
  }
  function accionConductor(e) {
    var b = e.target.closest('button'); if (!b) return;
    var d = b.dataset;
    if (d.copiar) { var c = estado.conductores.filter(function (x) { return x.id === Number(d.copiar); })[0]; copiar(c.texto).then(function () { aviso('Mensaje copiado.'); }); }
    else if (d.rotar) {
      if (!window.confirm('¿Cambiar el enlace de este conductor? El anterior deja de servir en el acto.')) return;
      llamar('/conductores/' + d.rotar + '/rotar', { method: 'POST', body: {} }).then(function () { aviso('Enlace cambiado. Mándale el nuevo.'); return recargarTodo(); }).catch(function (er) { aviso(er.message, true); });
    }
    else if (d.editarCond) abrirFormCond(Number(d.editarCond));
    else if (d.activoCond) {
      var cc = estado.conductores.filter(function (x) { return x.id === Number(d.activoCond); })[0];
      llamar('/conductores/' + cc.id, { method: 'PUT', body: { activo: !cc.activo } }).then(recargarTodo).catch(function (er) { aviso(er.message, true); });
    }
    else if (d.ordenar) ordenar(Number(d.ordenar));
  }
  function ordenar(id) {
    var o = document.querySelector('select[data-origen="' + id + '"]').value;
    var enviar = function (inicio) {
      llamar('/conductores/' + id + '/ordenar', { method: 'POST', body: { inicio: inicio } }).then(function (r) {
        aviso(r.ordenadas + ' paradas ordenadas por cercanía.' + (r.sin_coordenadas ? ' ' + r.sin_coordenadas + ' sin coordenadas quedaron al final.' : ''));
        return recargarTodo();
      }).catch(function (er) { aviso(er.message, true); });
    };
    if (o === 'gps') {
      if (!navigator.geolocation) { aviso('Este navegador no da la ubicación.', true); return; }
      navigator.geolocation.getCurrentPosition(function (p) { enviar({ tipo: 'punto', lat: p.coords.latitude, lon: p.coords.longitude }); },
        function () { aviso('No se pudo obtener tu ubicación.', true); }, { timeout: 8000 });
    } else if (o.charAt(0) === 'p') enviar({ tipo: 'puesto', puesto_id: Number(o.slice(1)) });
    else enviar({ tipo: 'primero' });
  }

  // ---------------------------------------------------------------- vehículos
  function pintarVehiculos() {
    $('tr-tbody-veh').innerHTML = estado.vehiculos.map(function (v) {
      return '<tr' + (v.activo ? '' : ' style="opacity:.55;"') + '><td><strong>' + esc(v.placa) + '</strong></td><td>' + esc(v.tipo) + '</td><td>' + v.capacidad + '</td><td>' + esc(v.descripcion || '') + '</td>' +
        '<td><button type="button" class="btn-secundario btn-sm" data-editar-veh="' + v.id + '">Editar</button> <button type="button" class="btn-secundario btn-sm" data-activo-veh="' + v.id + '">' + (v.activo ? 'Desactivar' : 'Activar') + '</button></td></tr>';
    }).join('');
    $('tr-vacio-veh').style.display = estado.vehiculos.length ? 'none' : 'block';
  }
  function abrirFormVeh(id) {
    estado.editVeh = id;
    var v = id ? estado.vehiculos.filter(function (x) { return x.id === id; })[0] : null;
    $('tr-v-placa').value = v ? v.placa : ''; $('tr-v-tipo').value = v ? v.tipo : 'carro'; $('tr-v-cap').value = v ? v.capacidad : 4; $('tr-v-desc').value = v ? (v.descripcion || '') : '';
    $('tr-form-veh').style.display = 'flex'; $('tr-v-placa').focus();
  }
  function guardarVehiculo(e) {
    e.preventDefault();
    var cuerpo = { placa: $('tr-v-placa').value, tipo: $('tr-v-tipo').value, capacidad: Number($('tr-v-cap').value), descripcion: $('tr-v-desc').value };
    var p = estado.editVeh ? llamar('/vehiculos/' + estado.editVeh, { method: 'PUT', body: cuerpo }) : llamar('/vehiculos', { method: 'POST', body: cuerpo });
    p.then(function () { $('tr-form-veh').style.display = 'none'; aviso('Vehículo guardado.'); return recargarTodo(); }).catch(function (er) { aviso(er.message, true); });
  }
  function accionVehiculo(e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.editarVeh) abrirFormVeh(Number(b.dataset.editarVeh));
    else if (b.dataset.activoVeh) {
      var v = estado.vehiculos.filter(function (x) { return x.id === Number(b.dataset.activoVeh); })[0];
      llamar('/vehiculos/' + v.id, { method: 'PUT', body: { activo: !v.activo } }).then(recargarTodo).catch(function (er) { aviso(er.message, true); });
    }
  }

  // ---------------------------------------------------------------- hacia fuera
  // Los cambios de un conductor (el cambio de vehículo) se guardan al elegirlo.
  document.addEventListener('change', function (e) {
    var s = e.target.closest ? e.target.closest('select[data-veh]') : null;
    if (!s) return;
    llamar('/conductores/' + s.dataset.veh, { method: 'PUT', body: { vehiculo_id: s.value || null } }).then(recargarTodo).catch(function (er) { aviso(er.message, true); });
  });

  window.TransporteDiaD = {
    abrir: function () { montar(); recargarTodo(); },
    iniciarContador: iniciarContador,
    cargarContador: cargarContador,
  };
})();
