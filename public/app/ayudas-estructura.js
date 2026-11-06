/* Piezas de Estructura territorial para la app del celular (admin-estructura.html).

   COPIAS DE public/js/common.js y de public/territorial.html, a propósito: las pantallas de
   public/app/ NO cargan common.js (define su propio api(), arma el menú lateral de escritorio y
   pesa 1.900 líneas). Si cambia una regla allá, cambia aquí:

     escaparHtml, normalizarTexto, nombreLugar, formatoTelefonoColombia, formatoMillares
                              ← common.js
     esAspiranteAlConcejo, categoriaDeFila, descendientesEn, ordenJerarquico
                              ← territorial.html (1327, 1373, 2671, 2619)

   Las dos de territorial.html reciben la lista por parámetro: allá leen variables globales. */
(function (global) {
  'use strict';

  /* ----------------------------- common.js ----------------------------- */

  /** Escapa también las comillas: se usa dentro de atributos (value="…", title="…"). */
  global.escaparHtml = function (t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  global.normalizarTexto = function (s) {
    return (s || '').toString().trim().toLowerCase()
      .replace(/[áàäâã]/g, 'a')
      .replace(/[éèëê]/g, 'e')
      .replace(/[íìïî]/g, 'i')
      .replace(/[óòöôõ]/g, 'o')
      .replace(/[úùüû]/g, 'u');
  };

  var ENLACES_LUGAR = new Set(['de', 'del', 'y', 'e']);
  var ARTICULOS_LUGAR = new Set(['la', 'las', 'los', 'el']);

  /** «BOGOTÁ, D.C.» → «Bogotá, D.C.»: solo reformatea lo que llega TODO en mayúsculas (como el catálogo). */
  global.nombreLugar = function (texto) {
    var bruto = (texto == null ? '' : String(texto)).trim();
    if (!bruto) return '';
    if (bruto !== bruto.toUpperCase()) return bruto;
    var palabras = bruto.toLowerCase().split(/(\s+)/);
    var anterior = '';
    return palabras.map(function (p) {
      if (/^\s+$/.test(p) || !p) return p;
      var limpia = p.replace(/[(),.]/g, '');
      var salida;
      if (/^(?:[a-záéíóúñü]\.){2,}$/.test(p)) salida = p.toUpperCase();
      else if (anterior && ENLACES_LUGAR.has(limpia)) salida = p;
      else if (anterior && ARTICULOS_LUGAR.has(limpia) && ENLACES_LUGAR.has(anterior)) salida = p;
      else salida = p.replace(/(^|[(\-])([a-záéíóúñü])/g, function (m, sep, letra) { return sep + letra.toUpperCase(); });
      anterior = limpia;
      return salida;
    }).join('');
  };

  global.formatoTelefonoColombia = function (valor) {
    var d = (valor || '').toString().replace(/\D/g, '').slice(0, 10);
    return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 10)].filter(Boolean).join(' ');
  };

  global.formatoMillares = function (numero) {
    var n = Number(numero);
    if (numero === null || numero === undefined || numero === '' || !isFinite(n)) return String(numero == null ? '0' : numero);
    return n.toLocaleString('es-CO');
  };

  /** Los dígitos del teléfono y su forma internacional para wa.me (agrega el 57 si falta). */
  global.datosWhatsApp = function (telefono) {
    var digitos = String(telefono || '').replace(/\D/g, '');
    if (!digitos) return null;
    return {
      visible: digitos.length === 10 ? global.formatoTelefonoColombia(digitos) : digitos,
      url: 'https://wa.me/' + (digitos.indexOf('57') === 0 ? digitos : '57' + digitos)
    };
  };

  /* -------------------------- territorial.html -------------------------- */

  var TIPO_ASPIRANTE_CONCEJO = 'aspirante_concejo';
  global.TIPO_ASPIRANTE_CONCEJO = TIPO_ASPIRANTE_CONCEJO;

  /** Un aspirante al Concejo se guarda como líder con tipo «aspirante_concejo» (territorial.html:1327). */
  global.esAspiranteAlConcejo = function (f) {
    return f.cargo === 'lider' && f.tipo_cargo === TIPO_ASPIRANTE_CONCEJO;
  };

  /** La categoría de una fila, con el aspirante ya distinguido (territorial.html:1373). */
  global.categoriaDeFila = function (f) {
    return global.esAspiranteAlConcejo(f) ? TIPO_ASPIRANTE_CONCEJO : f.cargo;
  };

  /**
   * Todo lo que cuelga de estas personas, a cualquier profundidad (territorial.html:2671).
   * Recibe `usuario_id` (a lo que apunta `supervisor_id`) y devuelve `id` de fila de Estructura.
   * Lleva guarda de ciclos: nada impide que A reporte a B y B a A.
   */
  global.descendientesEn = function (lista, idsRaiz) {
    var hijosDe = new Map();
    lista.forEach(function (f) {
      if (!f.supervisor_id) return;
      if (!hijosDe.has(f.supervisor_id)) hijosDe.set(f.supervisor_id, []);
      hijosDe.get(f.supervisor_id).push(f);
    });
    var filasEquipo = new Set();
    var vistos = new Set(idsRaiz);
    var pendientes = idsRaiz.slice();
    while (pendientes.length) {
      (hijosDe.get(pendientes.pop()) || []).forEach(function (hijo) {
        filasEquipo.add(hijo.id);
        if (!vistos.has(hijo.usuario_id)) { vistos.add(hijo.usuario_id); pendientes.push(hijo.usuario_id); }
      });
    }
    return filasEquipo;
  };

  /**
   * Cada persona justo debajo de su jefe, con `_nivel` y `_tieneHijos` (territorial.html:2619).
   * `colapsados` = Set de usuario_id cuyo equipo está plegado (la fila queda, el equipo no).
   */
  global.ordenJerarquico = function (filas, colapsados) {
    var idsEnLista = new Set(filas.map(function (f) { return f.usuario_id; }));
    var hijosDe = new Map();
    filas.forEach(function (f) {
      if (f.supervisor_id) {
        if (!hijosDe.has(f.supervisor_id)) hijosDe.set(f.supervisor_id, []);
        hijosDe.get(f.supervisor_id).push(f);
      }
    });
    hijosDe.forEach(function (lista) { lista.sort(function (a, b) { return (a.nombre || '').localeCompare(b.nombre || ''); }); });

    var visitados = new Set();
    var resultado = [];
    function agregar(fila, nivel) {
      if (visitados.has(fila.id)) return;
      visitados.add(fila.id);
      var hijos = hijosDe.get(fila.usuario_id) || [];
      resultado.push(Object.assign({}, fila, { _nivel: nivel, _tieneHijos: hijos.length > 0 }));
      if (colapsados.has(fila.usuario_id)) return;
      hijos.forEach(function (hijo) { agregar(hijo, nivel + 1); });
    }
    var pesoCargo = { coordinador: 0, coordinador_organizaciones: 1, lider: 2, usuario: 3 };
    var raices = filas
      .filter(function (f) { return !f.supervisor_id || !idsEnLista.has(f.supervisor_id); })
      .sort(function (a, b) {
        var pa = pesoCargo[a.cargo] != null ? pesoCargo[a.cargo] : 5;
        var pb = pesoCargo[b.cargo] != null ? pesoCargo[b.cargo] : 5;
        return pa !== pb ? pa - pb : (a.nombre || '').localeCompare(b.nombre || '');
      });
    raices.forEach(function (raiz) { agregar(raiz, 0); });
    filas.forEach(function (f) { if (!visitados.has(f.id)) resultado.push(Object.assign({}, f, { _nivel: 0 })); });
    return resultado;
  };

  /** ¿Tiene el lugar de votación completo? La misma regla de territorial.html:2945-2951. */
  global.tieneLugarVotacion = function (f) {
    var tieneMesa = (f.cargo === 'testigo' && f.tipo_testigo === 'puesto')
      ? Array.isArray(f.mesas_asignadas) && f.mesas_asignadas.length > 0
      : !!(f.mesa_votacion && String(f.mesa_votacion).trim());
    return !!(
      f.departamento_votacion && String(f.departamento_votacion).trim() &&
      f.municipio_votacion && String(f.municipio_votacion).trim() &&
      f.puesto_votacion && String(f.puesto_votacion).trim() && tieneMesa);
  };
})(window);
