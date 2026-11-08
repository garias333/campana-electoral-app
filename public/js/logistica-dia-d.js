/**
 * Pestaña «Logística» del Día D (public/dia-d.html) y su contador en el cuadro (orden 39).
 *
 * La coordinación define los ítems (kit, refrigerio, almuerzo…), ve el plan por puesto —lo SUGERIDO es la cantidad de testigos del
 * puesto, y se corrige a mano—, el TOTAL A COMPRAR por ítem, y saca el Excel. Todo el cálculo es del servidor
 * (routes/logisticaDiaD.routes.js y lib/logisticaDiaD.js); aquí sólo se pinta y se pide. Quien entrega es el coordinador de puesto,
 * desde el celular (public/app/logistica.html), no desde esta pantalla.
 */
(function () {
  'use strict';
  var estado = { plan: null, items: [], montado: false };
  var temporizador = null;

  function $(id) { return document.getElementById(id); }
  var esc = function (t) { return (window.escaparHtml ? window.escaparHtml(t) : String(t == null ? '' : t)); };
  function llamar(ruta, opciones) { return window.api('/dia-d/logistica' + ruta, opciones); }
  function aviso(txt, mal) {
    var a = $('lg-aviso'); if (!a) return;
    a.textContent = txt || ''; a.style.color = mal ? '#A93226' : '#0A5348'; a.style.display = txt ? 'block' : 'none';
  }

  // ---------------------------------------------------------------- contador (también en el cuadro principal)
  function pintarContador(r) {
    var caja = $('logi-contador'); if (!caja) return;
    var cartas = (r.items || []).map(function (i) {
      var valor = i.entregados === null ? esc(i.planeados) + ' <span style="font-size:0.7em;">por comprar</span>' : esc(i.entregados) + ' de ' + esc(i.planeados);
      return '<div class="card stat-card"><div class="label">🥪 ' + esc(i.nombre) + '</div><div class="valor">' + valor + '</div></div>';
    });
    caja.innerHTML = cartas.join('');
    var f = $('fila-logistica'); if (f) f.style.display = cartas.length ? 'block' : 'none';
  }
  function cargarContador() {
    return llamar('/contador').then(pintarContador).catch(function () { /* el cuadro sigue sin esta fila */ });
  }
  function iniciarContador() {
    cargarContador();
    clearInterval(temporizador);
    temporizador = setInterval(function () { if (!document.hidden) cargarContador(); }, 30000);
  }

  // ---------------------------------------------------------------- la pantalla
  function montar() {
    if (estado.montado) return;
    estado.montado = true;
    $('vista-logistica').innerHTML =
      '<div id="lg-aviso" style="display:none; padding:9px 12px; border-radius:8px; background:#F3F5F8; margin-bottom:12px; font-size:0.9rem;"></div>' +
      '<div class="card" style="margin-bottom:18px;"><div class="toolbar"><h3 style="margin:0;">Total para comprar</h3>' +
        '<button type="button" class="btn-acento btn-sm" id="lg-excel">⬇ Exportar a Excel</button></div>' +
        '<div class="tabla-contenedor"><table><thead><tr><th>Ítem</th><th>Para</th><th>Hasta</th><th class="num">Total a comprar</th><th class="num">Entregados hoy</th></tr></thead>' +
        '<tbody id="lg-totales"></tbody></table></div>' +
        '<p style="font-size:0.82rem; color:var(--color-text-muted); margin:8px 0 0;">La cantidad por puesto es la <strong>sugerida</strong> (los testigos asignados, con los coordinadores de puesto' +
        '; los suplentes sólo si el ítem lo pide) y se puede corregir. Los conductores van en su propia fila.</p></div>' +
      '<div class="card" style="margin-bottom:18px;"><div class="toolbar"><h3 style="margin:0;">Plan por puesto</h3></div>' +
        '<div class="tabla-contenedor"><table><thead id="lg-cab"></thead><tbody id="lg-puestos"></tbody></table></div>' +
        '<div class="vacio" id="lg-vacio" style="display:none;"><div class="icono-vacio">🥪</div>No hay puestos en la campaña todavía.</div></div>' +
      '<div class="card"><div class="toolbar"><h3 style="margin:0;">Ítems</h3></div>' +
        '<div class="tabla-contenedor"><table><thead><tr><th>Nombre</th><th>Para</th><th>Hasta</th><th>Incluir suplentes</th><th>Activo</th><th></th></tr></thead>' +
        '<tbody id="lg-items"></tbody></table></div>' +
        '<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:12px;">' +
          '<input id="lg-nuevo-nombre" maxlength="80" placeholder="Nuevo ítem (ej. Chaleco)" style="max-width:240px;">' +
          '<select id="lg-nuevo-para"><option value="testigos">Testigos</option><option value="conductores">Conductores</option></select>' +
          '<input id="lg-nuevo-hora" type="time" title="Hasta qué hora debe estar entregado">' +
          '<button type="button" class="btn-secundario btn-sm" id="lg-crear">Agregar ítem</button></div></div>';
    $('lg-excel').addEventListener('click', function () { window.open('/api/dia-d/logistica/exportar-excel', '_blank'); });
    $('lg-crear').addEventListener('click', crearItem);
    $('lg-puestos').addEventListener('change', onCambioCantidad);
    $('lg-puestos').addEventListener('click', onRestaurar);
    $('lg-items').addEventListener('click', onGuardarItem);
  }

  function pintar() {
    var p = estado.plan; if (!p) return;
    var deTestigos = p.items.filter(function (i) { return i.destinatario === 'testigos'; });
    $('lg-totales').innerHTML = p.totales.map(function (t) {
      return '<tr><td>' + esc(t.nombre) + '</td><td>' + (t.destinatario === 'conductores' ? 'Conductores' : 'Testigos') + '</td><td>' + esc(t.hora_limite || '—') +
        '</td><td class="num"><strong>' + esc(t.total) + '</strong></td><td class="num">' + (t.entregados === null ? '—' : esc(t.entregados)) + '</td></tr>';
    }).join('') || '<tr><td colspan="5" style="color:var(--color-text-muted);">No hay ítems activos.</td></tr>';
    $('lg-cab').innerHTML = '<tr><th>Puesto</th><th class="num">Testigos</th><th class="num">Suplentes</th>' +
      deTestigos.map(function (i) { return '<th class="num">' + esc(i.nombre) + '</th>'; }).join('') + '</tr>';
    var filas = p.puestos.map(function (f) {
      return '<tr><td>' + esc(f.puesto) + '</td><td class="num">' + f.testigos + '</td><td class="num">' + f.suplentes + '</td>' +
        f.items.map(function (c) {
          return '<td class="num"><input type="number" min="0" max="9999" style="width:76px;' + (c.manual ? 'border-color:#B7791F;' : '') + '" value="' + c.cantidad + '" data-item="' + c.item_id +
            '" data-puesto="' + f.puesto_id + '" data-sugerido="' + c.sugerido + '" title="Sugerido: ' + c.sugerido + '"> ' +
            (c.manual ? '<button type="button" class="btn-secundario btn-sm" data-volver="1" data-item="' + c.item_id + '" data-puesto="' + f.puesto_id + '" title="Volver a la sugerida (' + c.sugerido + ')">↺</button>' : '') +
            '<div style="font-size:0.72rem; color:var(--color-text-muted);">entregados ' + c.entregados + '</div></td>';
        }).join('') + '</tr>';
    });
    if (p.transporte && p.transporte.items.length) {
      filas.push('<tr style="background:#F3F5F8;"><td><strong>Transporte (conductores)</strong></td><td class="num">—</td><td class="num">—</td>' +
        deTestigos.map(function () { return '<td class="num">—</td>'; }).join('') + '</tr>');
      p.transporte.items.forEach(function (i) {
        filas.push('<tr style="background:#F3F5F8;"><td>&nbsp;&nbsp;' + esc(i.nombre) + ' · ' + p.transporte.conductores + ' conductores activos</td><td></td><td></td><td class="num" colspan="' + Math.max(1, deTestigos.length) + '"><strong>' + esc(i.cantidad) + '</strong></td></tr>');
      });
    }
    $('lg-puestos').innerHTML = filas.join('');
    $('lg-vacio').style.display = p.puestos.length ? 'none' : 'block';
    $('lg-items').innerHTML = estado.items.map(function (i) {
      return '<tr data-id="' + i.id + '"><td><input data-campo="nombre" maxlength="80" value="' + esc(i.nombre) + '"></td>' +
        '<td><select data-campo="destinatario"><option value="testigos"' + (i.destinatario === 'testigos' ? ' selected' : '') + '>Testigos</option><option value="conductores"' + (i.destinatario === 'conductores' ? ' selected' : '') + '>Conductores</option></select></td>' +
        '<td><input data-campo="hora_limite" type="time" value="' + esc(i.hora_limite || '') + '"></td>' +
        '<td><input data-campo="incluir_suplentes" type="checkbox" style="width:auto;"' + (i.incluir_suplentes ? ' checked' : '') + '></td>' +
        '<td><input data-campo="activo" type="checkbox" style="width:auto;"' + (i.activo ? ' checked' : '') + '></td>' +
        '<td><button type="button" class="btn-secundario btn-sm" data-guardar="1">Guardar</button></td></tr>';
    }).join('');
  }

  function recargar() {
    return Promise.all([llamar('/plan'), llamar('/items')]).then(function (r) {
      estado.plan = r[0]; estado.items = r[1].items; pintar();
    }).catch(function (e) { aviso((e && e.message) || 'No se pudo cargar la logística.', true); });
  }

  function onCambioCantidad(ev) {
    var t = ev.target; if (!t.dataset || !t.dataset.item || t.dataset.volver) return;
    var v = String(t.value).trim();
    var cantidad = v === '' ? null : Number(v);
    llamar('/plan', { method: 'PUT', body: { item_id: Number(t.dataset.item), puesto_id: Number(t.dataset.puesto), cantidad: cantidad } })
      .then(function () { aviso('Cantidad guardada.'); return recargar(); })
      .catch(function (e) { aviso((e && e.message) || 'No se pudo guardar.', true); return recargar(); });
  }
  function onRestaurar(ev) {
    var b = ev.target.closest ? ev.target.closest('[data-volver]') : null; if (!b) return;
    llamar('/plan', { method: 'PUT', body: { item_id: Number(b.dataset.item), puesto_id: Number(b.dataset.puesto), cantidad: null } })
      .then(function () { aviso('Volvió a la cantidad sugerida.'); return recargar(); })
      .catch(function (e) { aviso((e && e.message) || 'No se pudo guardar.', true); });
  }
  function onGuardarItem(ev) {
    var b = ev.target.closest ? ev.target.closest('[data-guardar]') : null; if (!b) return;
    var fila = b.closest('tr');
    var campo = function (n) { return fila.querySelector('[data-campo="' + n + '"]'); };
    var cuerpo = {
      nombre: campo('nombre').value, destinatario: campo('destinatario').value, hora_limite: campo('hora_limite').value || null,
      incluir_suplentes: campo('incluir_suplentes').checked, activo: campo('activo').checked,
    };
    llamar('/items/' + fila.dataset.id, { method: 'PUT', body: cuerpo })
      .then(function () { aviso('Ítem guardado.'); return recargar().then(cargarContador); })
      .catch(function (e) { aviso((e && e.message) || 'No se pudo guardar el ítem.', true); });
  }
  function crearItem() {
    var nombre = $('lg-nuevo-nombre').value;
    llamar('/items', { method: 'POST', body: { nombre: nombre, destinatario: $('lg-nuevo-para').value, hora_limite: $('lg-nuevo-hora').value || null } })
      .then(function () { $('lg-nuevo-nombre').value = ''; aviso('Ítem agregado.'); return recargar().then(cargarContador); })
      .catch(function (e) { aviso((e && e.message) || 'No se pudo crear el ítem.', true); });
  }

  function abrir() { montar(); aviso(''); return recargar(); }

  window.LogisticaDiaD = { abrir: abrir, iniciarContador: iniciarContador };
})();
