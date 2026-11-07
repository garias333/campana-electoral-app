/**
 * public/js/cobertura-testigos.js — Cobertura de testigos, la parte que se TOCA.
 *
 * La tabla la pinta configuracion.html con los datos de GET /api/dia-d/config/puestos-votacion?cobertura=1;
 * aquí vive lo que hay dentro de cada fila: las fichas de las mesas (una por mesa, coloreadas por testigo),
 * las cifras de arriba y la VENTANA que se abre al tocar una mesa para asignar, quitar, ver a quién proponer,
 * poner suplentes y avisar. Todo lo que escribe va por /api/dia-d/cobertura/* (routes/coberturaTestigos.routes.js),
 * que es quien decide los permisos: aquí un botón visible no autoriza nada.
 *
 * Usa `api` y `escaparHtml` de common.js. Después de cada cambio llama a `window.cargarPuestosVotacion()`.
 */
(function () {
  'use strict';

  var COLORES = ['#1B6CA8', '#7A4FB5', '#C77700', '#1E8A4F', '#B5457A', '#0F8B8D', '#8A6D00', '#5B6472'];
  var estado = null;      // lo que devolvió GET /cobertura/puesto/:id
  var mesaActual = null;

  function esc(t) { return escaparHtml(t == null ? '' : String(t)); }
  function pct(a, b) { return b > 0 ? Math.round(a * 1000 / b) / 10 : 0; }
  function coma(n) { return String(n).replace('.', ','); }

  /* ——— las fichas de la fila ——— */
  function colorDe(p, testigoId) {
    var lista = p.testigos_puesto || [];
    for (var i = 0; i < lista.length; i++) if (lista[i].estructura_id === testigoId) return COLORES[i % COLORES.length];
    return COLORES[0];
  }

  /** Todas las mesas del puesto, una ficha cada una. Libre = rojo (más fuerte si ya hay votantes); cubierta = color del testigo. */
  window.celdaCoberturaMesas = function (p) {
    var mesas = p.mesas_detalle;
    if (!mesas) return '';
    var libres = mesas.filter(function (m) { return !m.testigo_id; }).length;
    var cabeza = libres
      ? '<div class="cobertura-faltan">' + libres + '</div>'
      : '<span class="cobertura-completo">✓ Todas cubiertas</span>';
    var conVotos = mesas.filter(function (m) { return !m.testigo_id && m.votantes > 0; }).length;
    var leyenda = conVotos
      ? '<div class="cobertura-aviso">' + (conVotos === 1 ? 'la resaltada ya tiene' : 'las ' + conVotos + ' resaltadas ya tienen') + ' votantes registrados</div>' : '';
    var fichas = mesas.map(function (m) {
      var votos = m.votantes ? (m.votantes === 1 ? '1 votante registrado vota' : m.votantes + ' votantes registrados votan') + ' en esta mesa. ' : '';
      var base = 'data-puesto="' + p.id + '" data-mesa="' + m.mesa + '"';
      if (m.testigo_id) {
        var t = (p.testigos_puesto || []).filter(function (x) { return x.estructura_id === m.testigo_id; })[0];
        var aviso = 'Testigo ' + (m.testigo || '') + ': mesa' + (t && t.mesas.length > 1 ? 's ' + t.mesas.join(', ') : ' ' + m.mesa) + '. ' + votos + 'Toca para cambiarla.';
        return '<span class="chip-mesa chip-mesa-cubierta' + (t && t.excede_limite ? ' chip-mesa-excede' : '') + '" ' + base +
          ' style="background:' + colorDe(p, m.testigo_id) + ';" data-aviso="' + esc(aviso) + '">' + m.mesa + '<small>' + esc(m.iniciales || '') + '</small></span>';
      }
      var aviso2 = (votos ? votos + 'Conviene cubrirla con un testigo. ' : 'Sin testigo. ') + 'Toca para asignar.';
      return '<span class="chip-mesa chip-mesa-tocable' + (m.votantes ? ' chip-mesa-votos' : '') + '" ' + base +
        ' data-aviso="' + esc(aviso2) + '">' + m.mesa + '</span>';
    }).join('');
    var suplentes = '';
    return cabeza + leyenda + '<div class="mesas-faltantes mesas-todas">' + fichas + '</div>' + suplentes;
  };

  /** Los testigos de un puesto con sus mesas, para el pie de la fila: «AP · Ana Pérez: 1, 2, 3». */
  window.leyendaTestigosPuesto = function (p) {
    var l = p.testigos_puesto || [];
    if (!l.length) return '';
    return '<div class="cobertura-testigos">' + l.map(function (t, i) {
      return '<span class="cobertura-testigo' + (t.excede_limite ? ' excede' : '') + '" style="border-color:' + COLORES[i % COLORES.length] + ';" title="' +
        esc(t.nombre + (t.mesas.length ? ': mesas ' + t.mesas.join(', ') : ': sin mesa')) + (t.excede_limite ? ' (pasa el límite de mesas por testigo)' : '') + '">' +
        '<b style="background:' + COLORES[i % COLORES.length] + ';">' + esc(t.iniciales) + '</b>' + esc(t.nombre.split(' ')[0]) +
        (t.mesas.length ? ' ' + t.mesas.join(',') : '') + (t.excede_limite ? ' ⚠' : '') + '</span>';
    }).join('') + '</div>';
  };

  /** Las cifras de arriba: mesas cubiertas X de Y y votantes propios cubiertos. */
  window.resumenCobertura = function (puestos) {
    var mesas = 0, cubiertas = 0, votCub = 0, votSin = 0, votSinMesa = 0;
    puestos.forEach(function (p) {
      mesas += Number(p.cantidad_mesas) || 0;
      cubiertas += p.mesas_cubiertas != null ? p.mesas_cubiertas : (p.mesas_con_testigo || 0);
      votCub += p.votantes_cubiertos || 0;
      votSin += p.votantes_sin_cubrir || 0;
      votSinMesa += p.votantes_sin_mesa || 0;
    });
    var totalVot = votCub + votSin + votSinMesa;
    return '<span><b>Mesas cubiertas</b> ' + cubiertas + ' de ' + mesas + ' (' + coma(pct(cubiertas, mesas)) + ' %)</span>' +
      '<span><b>Votantes propios cubiertos</b> ' + votCub + ' de ' + totalVot + ' (' + coma(pct(votCub, totalVot)) + ' %)</span>' +
      '<span><b>Sin cubrir</b> ' + votSin + (votSinMesa ? ' · sin mesa registrada ' + votSinMesa : '') + '</span>';
  };

  /* ——— la ventana ——— */
  function crearVentana() {
    var v = document.getElementById('overlay-cobertura');
    if (v) return v;
    v = document.createElement('div');
    v.id = 'overlay-cobertura';
    v.className = 'overlay';
    v.innerHTML = '<div class="modal cobertura-ventana"><div class="modal-header"><h3 id="cov-titulo">Mesa</h3>' +
      '<button class="modal-cerrar" id="cov-cerrar" aria-label="Cerrar">×</button></div><div id="cov-cuerpo"></div></div>';
    document.body.appendChild(v);
    v.querySelector('#cov-cerrar').addEventListener('click', cerrar);
    v.addEventListener('click', function (e) { if (e.target === v) cerrar(); });
    v.addEventListener('click', alTocarEnVentana);
    v.addEventListener('input', function (e) { if (e.target.id === 'cov-buscar') pintarListas(); });
    return v;
  }
  function cerrar() { var v = document.getElementById('overlay-cobertura'); if (v) v.classList.remove('abierto'); }

  async function cargarEstado(puestoId) {
    estado = await api('/dia-d/cobertura/puesto/' + puestoId);
  }

  window.abrirVentanaCobertura = async function (puestoId, mesa) {
    var v = crearVentana();
    mesaActual = Number(mesa);
    document.getElementById('cov-cuerpo').innerHTML = '<p style="padding:14px;">Cargando…</p>';
    v.classList.add('abierto');
    try { await cargarEstado(puestoId); pintar(); }
    catch (err) { document.getElementById('cov-cuerpo').innerHTML = '<p class="mensaje-error visible" style="margin:14px;">' + esc(err.message) + '</p>'; }
  };

  function quienCubre(m) { return (estado.mesas.filter(function (x) { return x.mesa === m; })[0] || {}); }

  function pintar() {
    var p = estado.puesto;
    var cubre = quienCubre(mesaActual);
    document.getElementById('cov-titulo').textContent = p.nombre + ' · mesa ' + mesaActual;
    var opcionesMesa = estado.mesas.map(function (m) {
      return '<option value="' + m.mesa + '"' + (m.mesa === mesaActual ? ' selected' : '') + '>Mesa ' + m.mesa + (m.testigo ? ' — ' + m.testigo : ' — libre') + '</option>';
    }).join('');
    var titular = '';
    if (cubre.testigo_id) {
      var t = estado.testigos_del_puesto.filter(function (x) { return x.estructura_id === cubre.testigo_id; })[0] || { mesas: [mesaActual] };
      titular = '<div class="cov-bloque cov-titular"><b>Cubre esta mesa:</b> ' + esc(cubre.testigo) +
        '<div class="cov-sub">Testigo ' + esc(cubre.testigo) + ': mesas ' + esc(t.mesas.join(', ')) + '</div>' +
        '<div class="cov-botones"><button type="button" class="btn-secundario btn-sm" data-acc="quitar">Quitar de esta mesa</button> ' +
        '<button type="button" class="btn-secundario btn-sm" data-acc="avisar-uno" data-id="' + cubre.testigo_id + '">📣 Avisarle</button></div></div>';
    } else {
      titular = '<div class="cov-bloque cov-libre">Esta mesa <b>no tiene testigo</b>.</div>';
    }
    document.getElementById('cov-cuerpo').innerHTML =
      '<div class="cov-fila"><label for="cov-mesa" style="font-weight:600;">Mesa</label><select id="cov-mesa">' + opcionesMesa + '</select></div>' +
      titular +
      '<div id="cov-error" class="mensaje-error"></div>' +
      '<div class="cov-bloque"><div class="cov-h">Asignar a la mesa ' + mesaActual + '</div>' +
      '<input type="search" id="cov-buscar" placeholder="Buscar por nombre o teléfono…" autocomplete="off">' +
      '<div id="cov-testigos"></div>' +
      '<div class="cov-botones"><button type="button" class="btn-secundario btn-sm" data-acc="nuevo">+ Nuevo testigo</button></div></div>' +
      '<div class="cov-bloque"><div class="cov-h">Votan en este puesto <small>(aún no son testigos)</small></div><div id="cov-sugeridos"></div></div>' +
      '<div class="cov-bloque"><div class="cov-h">Suplentes del puesto</div><div id="cov-suplentes"></div></div>';
    document.getElementById('cov-mesa').addEventListener('change', function (e) { mesaActual = Number(e.target.value); pintar(); });
    pintarListas();
  }

  function filtrar(lista, q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return lista;
    return lista.filter(function (x) { return (x.nombre + ' ' + (x.telefono || '')).toLowerCase().indexOf(q) !== -1; });
  }

  function filaPersona(x, botones) {
    return '<div class="cov-persona"><div><b>' + esc(x.nombre) + '</b>' +
      '<div class="cov-sub">' + esc([x.cargo, x.telefono, x.detalle].filter(Boolean).join(' · ')) +
      (x.no_contactar ? ' · <span style="color:#A93226;">pidió no recibir mensajes</span>' : '') + '</div></div>' +
      '<div class="cov-acciones">' + botones + '</div></div>';
  }

  function pintarListas() {
    if (!estado) return;
    var q = (document.getElementById('cov-buscar') || {}).value || '';
    var cubreId = quienCubre(mesaActual).testigo_id;
    var testigos = filtrar(estado.testigos.filter(function (t) { return t.estructura_id !== cubreId; }), q);
    document.getElementById('cov-testigos').innerHTML = testigos.length ? testigos.map(function (t) {
      var detalle = t.mesas.length ? 'mesa' + (t.mesas.length > 1 ? 's ' : ' ') + t.mesas.join(', ') + (t.en_este_puesto ? '' : ' en ' + t.puesto) : 'sin mesa';
      return filaPersona({ nombre: t.nombre, telefono: t.telefono, detalle: detalle, no_contactar: t.no_contactar },
        '<button type="button" class="btn-primario btn-sm" data-acc="asignar" data-uid="' + t.usuario_id + '">Asignar</button> ' +
        '<button type="button" class="btn-secundario btn-sm" data-acc="suplente" data-uid="' + t.usuario_id + '" title="Dejarlo como suplente de este puesto">Suplente</button> ' +
        '<button type="button" class="btn-secundario btn-sm" data-acc="avisar-uno" data-id="' + t.estructura_id + '" title="Avisarle por SMS">📣</button>');
    }).join('') : '<div class="cov-sub">No hay testigos que coincidan.</div>';

    var sug = filtrar(estado.sugeridos, q);
    document.getElementById('cov-sugeridos').innerHTML = sug.length ? sug.map(function (s) {
      var mesaTxt = s.mesa ? 'vota en la mesa ' + s.mesa : 'sin mesa registrada';
      var boton = s.tipo === 'usuario'
        ? '<button type="button" class="btn-secundario btn-sm" data-acc="proponer-usuario" data-uid="' + s.usuario_id + '">Proponer como testigo</button> ' +
          '<button type="button" class="btn-secundario btn-sm" data-acc="suplente" data-uid="' + s.usuario_id + '">Suplente</button>'
        : '<button type="button" class="btn-secundario btn-sm" data-acc="proponer-votante" data-vid="' + s.votante_id + '">Proponer como testigo</button>';
      return filaPersona({ nombre: s.nombre, cargo: s.cargo, telefono: s.telefono, detalle: mesaTxt, no_contactar: s.no_contactar }, boton);
    }).join('') : '<div class="cov-sub">Nadie más de la campaña vota en este puesto.</div>';

    document.getElementById('cov-suplentes').innerHTML = estado.suplentes.length ? estado.suplentes.map(function (s) {
      return filaPersona({ nombre: s.nombre, telefono: s.telefono },
        '<button type="button" class="btn-primario btn-sm" data-acc="titular" data-sid="' + s.id + '" title="Que cubra la mesa ' + mesaActual + '">Titular de la mesa ' + mesaActual + '</button> ' +
        '<button type="button" class="btn-secundario btn-sm" data-acc="quitar-suplente" data-sid="' + s.id + '">Quitar</button>');
    }).join('') : '<div class="cov-sub">Sin suplentes. Usa «Suplente» en cualquier persona de arriba.</div>';
  }

  function mostrarError(texto) {
    var e = document.getElementById('cov-error');
    if (!e) { alert(texto); return; }
    e.textContent = texto; e.classList.add('visible');
  }

  async function refrescar() {
    await cargarEstado(estado.puesto.id);
    pintar();
    if (typeof window.cargarPuestosVotacion === 'function') window.cargarPuestosVotacion();
  }

  /** POST que pide confirmación cuando el servidor lo dice (409 con `requiere_confirmacion`) y repite con `confirmar: true`. */
  async function conConfirmacion(ruta, cuerpo) {
    try { return await api(ruta, { method: 'POST', body: cuerpo }); }
    catch (err) {
      var d = err.datos || err.data || null;
      if (!(d && d.requiere_confirmacion)) throw err;
      var partes = [];
      if (d.mesa_ocupada_por) partes.push('La mesa ya tiene a ' + d.mesa_ocupada_por.nombre + ' como testigo. Se la quitarás a esa persona.');
      if (d.lo_mueve_de) partes.push('Esta persona ya es testigo en ' + d.lo_mueve_de.puesto + (d.lo_mueve_de.mesas.length ? ' (mesas ' + d.lo_mueve_de.mesas.join(', ') + ')' : '') + '. Se le MOVERÁ a este puesto.');
      if (!confirm(partes.join('\n\n') + '\n\n¿Continuar?')) return null;
      return api(ruta, { method: 'POST', body: Object.assign({}, cuerpo, { confirmar: true }) });
    }
  }

  function guardarPrellenado(datos, destino) {
    try { sessionStorage.setItem('testigo_prellenado', JSON.stringify(datos)); } catch (_) { /* sin sessionStorage: se abre vacío */ }
    window.location.href = destino;
  }

  async function avisar(ids) {
    var qs = ids && ids.length ? 'estructura_ids=' + ids.join(',') : '';
    var r = await api('/dia-d/cobertura/avisar' + (qs ? '?' + qs : ''));
    if (!r.destinatarios.length) { alert('No hay testigos con mesa asignada a quienes avisar.'); return; }
    try { sessionStorage.setItem('sms_preseleccion', JSON.stringify({ destinatarios: r.destinatarios, mensaje: r.plantilla })); } catch (_) { /* se abre sin lista */ }
    window.location.href = '/enviar-sms.html';
  }
  window.avisarATestigos = avisar;

  async function alTocarEnVentana(e) {
    var b = e.target.closest('[data-acc]');
    if (!b || !estado) return;
    var acc = b.getAttribute('data-acc');
    var puestoId = estado.puesto.id;
    var err = document.getElementById('cov-error'); if (err) err.classList.remove('visible');
    b.disabled = true;
    try {
      if (acc === 'asignar') {
        var r = await conConfirmacion('/dia-d/cobertura/asignar', { puesto_id: puestoId, mesa: mesaActual, usuario_id: Number(b.dataset.uid) });
        if (r && r.aviso) alert(r.aviso);
        if (r) await refrescar();
      } else if (acc === 'quitar') {
        var q = quienCubre(mesaActual);
        if (confirm('¿Quitar a ' + q.testigo + ' de la mesa ' + mesaActual + '?')) {
          await api('/dia-d/cobertura/quitar', { method: 'POST', body: { puesto_id: puestoId, mesa: mesaActual } });
          await refrescar();
        }
      } else if (acc === 'suplente') {
        await api('/dia-d/cobertura/suplentes', { method: 'POST', body: { puesto_id: puestoId, usuario_id: Number(b.dataset.uid) } });
        await refrescar();
      } else if (acc === 'quitar-suplente') {
        if (confirm('¿Quitar a este suplente del puesto?')) {
          await api('/dia-d/cobertura/suplentes/' + b.dataset.sid, { method: 'DELETE' });
          await refrescar();
        }
      } else if (acc === 'titular') {
        var r2 = await conConfirmacion('/dia-d/cobertura/suplentes/' + b.dataset.sid + '/titular', { mesa: mesaActual });
        if (r2 && r2.aviso) alert(r2.aviso);
        if (r2) await refrescar();
      } else if (acc === 'nuevo') {
        guardarPrellenado({ puesto: estado.puesto.nombre, mesa: mesaActual }, '/territorial.html#testigo-nuevo');
      } else if (acc === 'proponer-votante') {
        var s = estado.sugeridos.filter(function (x) { return x.tipo === 'votante' && String(x.votante_id) === b.dataset.vid; })[0];
        guardarPrellenado({ puesto: estado.puesto.nombre, mesa: mesaActual, nombre: s.nombre, cedula: s.cedula, telefono: s.telefono, email: s.email }, '/territorial.html#testigo-nuevo');
      } else if (acc === 'proponer-usuario') {
        var u = estado.sugeridos.filter(function (x) { return x.tipo === 'usuario' && String(x.usuario_id) === b.dataset.uid; })[0];
        guardarPrellenado({ puesto: estado.puesto.nombre, mesa: mesaActual }, '/territorial.html#testigo-editar=' + u.estructura_id);
      } else if (acc === 'avisar-uno') {
        await avisar([Number(b.dataset.id)]);
      }
    } catch (ex) {
      mostrarError(ex.message || 'No se pudo hacer el cambio.');
    } finally { b.disabled = false; }
  }
})();
