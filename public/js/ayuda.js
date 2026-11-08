/**
 * Ayuda · Manuales (public/ayuda.html).
 *
 * El contenido NO está aquí: lo arma el servidor (lib/manuales.js → /api/manuales/…) ya filtrado por permisos y con el HTML
 * escapado. Esta pantalla solo lo pinta, arma el índice, filtra y resalta al buscar, y prepara la impresión.
 *
 * Quién ve qué: el administrador entra a una portada con una tarjeta por manual y puede abrir el de cualquier rol (y el de
 * instalación). Cualquier otro rol entra directo a SU manual (`/manuales/mio`).
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (t) { return window.escaparHtml ? window.escaparHtml(t) : String(t == null ? '' : t); };
  var icono = function (nombre) { return '<svg class="ico" aria-hidden="true"><use href="#i-' + esc(nombre || 'lista') + '"/></svg>'; };

  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var NOMBRE_ROL = {
    admin: 'administrador', coordinador: 'coordinador', lider: 'líder', sublider: 'sublíder', testigo: 'testigo', usuario: 'usuario',
    asistente_administrativo: 'asistente administrativo', administrativo: 'perfil administrativo', invitado: 'invitado', aspirante: 'aspirante',
  };

  var datos = null;            // lo último que dijo el servidor
  var modoAdmin = false;
  var textos = [];             // por elemento buscable: { el, cuerpo, norm, original }

  function fechaLegible(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? (Number(m[3]) + ' ' + MESES[Number(m[2]) - 1] + ' ' + m[1]) : '';
  }

  function sinTildes(t) {
    return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function mostrarEstado(texto) {
    var e = $('estado');
    e.textContent = texto || '';
    e.hidden = !texto;
  }

  // -------------------------------------------------------------------------------------------------- portada (admin)
  function pintarPortada(tarjetas) {
    $('vista-manual').hidden = true;
    $('vista-portada').hidden = false;
    document.title = 'Ayuda · Manuales';
    $('tarjetas').innerHTML = tarjetas.map(function (t) {
      return '<a class="tarjeta" href="/ayuda.html?manual=' + encodeURIComponent(t.clave) + '">' +
        '<span class="tarjeta-icono">' + icono(t.icono) + '</span>' +
        '<h3>' + esc(t.titulo) + '</h3><p>' + esc(t.descripcion) + '</p>' +
        '<span class="tarjeta-n">' + (t.bloques === 1 ? '1 guía' : t.bloques + ' guías') + '</span></a>';
    }).join('');
  }

  // -------------------------------------------------------------------------------------------------- un manual
  function rutaHtml(ruta) {
    return (ruta || []).map(function (r) {
      var pasos = r.pasos.map(function (p) { return '<span>' + esc(p) + '</span>'; }).join('<span class="sep">›</span>');
      var cabeza = r.plataforma === 'Celular' ? 'App del celular' : 'Menú';
      return '<span class="ruta">' + (r.plataforma ? '<span class="ruta-plataforma">' + esc(r.plataforma) + '</span>' : '') +
        '<span>' + cabeza + '</span><span class="sep">›</span>' + pasos + '</span>';
    }).join('');
  }

  var ROLES_LEGIBLES = NOMBRE_ROL;
  function rolesHtml(roles) {
    if (!roles || !roles.length || roles.indexOf('todos') !== -1) return '';
    return '<span class="insignias"><span class="insignia on">Para: ' + esc(roles.map(function (r) { return ROLES_LEGIBLES[r] || r; }).join(', ')) + '</span></span>';
  }

  function insigniasHtml(b) {
    if (!b.modulo) return rolesHtml(b.roles);
    var p = (datos.permisos || {})[b.modulo] || {};
    var casilla = function (clave, texto, amarilla) {
      var on = !!p[clave];
      return '<span class="insignia ' + (on ? 'on' + (amarilla ? ' amarilla' : '') : 'no') + '" title="' + (on ? 'Tienes este permiso' : 'No tienes este permiso') + '">' + texto + '</span>';
    };
    return '<span class="insignias" aria-label="Permisos en ' + esc(b.etiqueta_modulo || b.modulo) + '">' +
      '<span class="insignia" title="Módulo de Asignación de permisos">' + esc(b.etiqueta_modulo || b.modulo) + '</span>' +
      casilla('ver', 'Puede ver') + casilla('editar', 'Puede editar') + casilla('agregar', 'Puede agregar') +
      (p.tiene_importar_exportar ? casilla('importar_exportar', 'Importar / Exportar', true) : '') + '</span>';
  }

  /** «Para qué sirve»: lo que hay antes del primer subtítulo se mete en su recuadro. */
  function envolverParaQueSirve(cuerpo) {
    var primeros = [];
    var nodo = cuerpo.firstElementChild;
    while (nodo && !/^H[34]$/.test(nodo.tagName) && !nodo.classList.contains('llamado')) {
      primeros.push(nodo);
      nodo = nodo.nextElementSibling;
    }
    if (!primeros.length) return;
    var caja = document.createElement('div');
    caja.className = 'para-que';
    caja.innerHTML = '<div class="rotulo">Para qué sirve</div>';
    cuerpo.insertBefore(caja, primeros[0]);
    primeros.forEach(function (n) { caja.appendChild(n); });
  }

  function bloqueHtml(b) {
    return '<article class="bloque buscable" id="b-' + esc(b.id) + '" data-id="' + esc(b.id) + '">' +
      '<div class="bloque-cabecera"><span class="bloque-icono">' + icono(b.icono) + '</span><h2>' + esc(b.titulo) + '</h2>' +
      '<button type="button" class="btn-imprimir-bloque ayuda-no-imprimir" data-imprimir="' + esc(b.id) + '" title="Imprimir solo esta guía" aria-label="Imprimir solo esta guía">' + icono('imprimir') + '</button></div>' +
      '<div class="bloque-meta">' + rutaHtml(b.ruta) + insigniasHtml(b) + '</div>' +
      '<div class="bloque-cuerpo">' + b.html + '</div></article>';
  }

  function faqHtml(b) {
    return '<details class="faq buscable" id="b-' + esc(b.id) + '" data-id="' + esc(b.id) + '"><summary>' + esc(b.titulo) + '</summary>' +
      '<div class="faq-cuerpo bloque-cuerpo">' + b.html + '</div></details>';
  }

  function terminoHtml(b) {
    return '<div class="termino buscable" id="b-' + esc(b.id) + '" data-id="' + esc(b.id) + '"><dt>' + esc(b.titulo) + '</dt><dd class="bloque-cuerpo">' + b.html + '</dd></div>';
  }

  function pintarManual(d, claveManual) {
    datos = d;
    $('vista-portada').hidden = true;
    $('vista-manual').hidden = false;
    mostrarEstado('');
    document.title = d.titulo + ' · Ayuda';

    var instalacion = d.modo === 'instalacion';
    $('manual-eyebrow').textContent = instalacion ? 'Documentación técnica' : (d.modo === 'rol' ? 'Manual de uso · vista del administrador' : 'Manual de uso');
    $('manual-titulo').textContent = d.titulo;
    $('manual-descripcion').textContent = d.descripcion || '';

    var t = d.totales || { bloques: 0, faq: 0, glosario: 0 };
    var chips = [];
    chips.push('<li class="chip-acento">' + t.bloques + (t.bloques === 1 ? ' guía' : ' guías') + '</li>');
    if (t.faq) chips.push('<li>' + t.faq + (t.faq === 1 ? ' pregunta frecuente' : ' preguntas frecuentes') + '</li>');
    if (t.glosario) chips.push('<li>' + t.glosario + (t.glosario === 1 ? ' término' : ' términos') + '</li>');
    if (d.fecha_contenido) chips.push('<li>Contenido actualizado: ' + esc(fechaLegible(d.fecha_contenido)) + '</li>');
    if (d.modo === 'mio') chips.push('<li>Según tus permisos de hoy</li>');
    if (d.modo === 'rol') chips.push('<li>Según los permisos del rol ' + esc(NOMBRE_ROL[d.rol] || d.rol) + '</li>');
    $('manual-chips').innerHTML = chips.join('');

    $('btn-todos').hidden = !modoAdmin;
    var enApp = typeof window.esCelular === 'function' && window.esCelular() && !modoAdmin;
    $('btn-app').hidden = !enApp;

    var partes = [];
    var indice = [];
    (d.secciones || []).forEach(function (s) {
      partes.push('<h2 class="seccion-titulo" id="s-' + esc(s.id) + '" data-seccion="' + esc(s.id) + '">' + esc(s.titulo) + '</h2>');
      s.bloques.forEach(function (b) { partes.push(bloqueHtml(b)); });
      indice.push('<h4 data-seccion="' + esc(s.id) + '">' + esc(s.titulo) + '</h4>' +
        s.bloques.map(function (b) { return '<a href="#b-' + esc(b.id) + '" data-id="' + esc(b.id) + '" data-seccion="' + esc(s.id) + '">' + esc(b.titulo) + '</a>'; }).join(''));
    });
    if ((d.faq || []).length) {
      partes.push('<h2 class="seccion-titulo" id="s-faq" data-seccion="faq">Preguntas frecuentes</h2>');
      partes.push(d.faq.map(faqHtml).join(''));
      indice.push('<h4 data-seccion="faq">Preguntas frecuentes</h4><a href="#s-faq" data-seccion="faq" data-id="faq">Ver las ' + d.faq.length + ' preguntas</a>');
    }
    if ((d.glosario || []).length) {
      partes.push('<h2 class="seccion-titulo" id="s-glosario" data-seccion="glosario">Glosario</h2>');
      partes.push('<dl class="glosario">' + d.glosario.map(terminoHtml).join('') + '</dl>');
      indice.push('<h4 data-seccion="glosario">Glosario</h4><a href="#s-glosario" data-seccion="glosario" data-id="glosario">Ver los ' + d.glosario.length + ' términos</a>');
    }
    if (!partes.length) {
      $('contenido').innerHTML = '<div class="manual-vacio">Este manual todavía no tiene guías para los permisos que tienes hoy.</div>';
      $('indice').innerHTML = '';
    } else {
      $('contenido').innerHTML = partes.join('\n');
      $('indice').innerHTML = indice.join('');
    }

    document.querySelectorAll('#contenido .bloque-cuerpo').forEach(function (c) {
      if (c.closest('.bloque')) envolverParaQueSirve(c);
    });
    prepararBuscador();
    activarIndice();
    abrirSegunAncla();
  }

  // -------------------------------------------------------------------------------------------------- búsqueda
  function prepararBuscador() {
    textos = Array.prototype.map.call(document.querySelectorAll('#contenido .buscable'), function (el) {
      var cuerpo = el.matches('.faq') ? el.querySelector('.faq-cuerpo') : (el.matches('.termino') ? el.querySelector('dd') : el.querySelector('.bloque-cuerpo'));
      var titulo = el.querySelector('h2, summary, dt');
      var plano = (titulo ? titulo.textContent : '') + ' ' + (el.querySelector('.bloque-meta') ? el.querySelector('.bloque-meta').textContent : '') + ' ' + cuerpo.textContent;
      return { el: el, cuerpo: cuerpo, titulo: titulo, norm: sinTildes(plano), original: cuerpo.innerHTML, tituloOriginal: titulo ? titulo.innerHTML : '' };
    });
  }

  function patronDe(token) {
    var mapa = { a: '[aáàäâ]', e: '[eéèëê]', i: '[iíìïî]', o: '[oóòöô]', u: '[uúùüû]', n: '[nñ]' };
    return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[aeioun]/g, function (c) { return mapa[c]; });
  }

  function resaltar(raiz, regex) {
    var camino = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, null);
    var nodos = [];
    while (camino.nextNode()) { if (camino.currentNode.nodeValue.trim()) nodos.push(camino.currentNode); }
    nodos.forEach(function (n) {
      if (n.parentNode.closest('pre')) return;
      var texto = n.nodeValue;
      regex.lastIndex = 0;
      if (!regex.test(texto)) return;
      regex.lastIndex = 0;
      var frag = document.createDocumentFragment();
      var ultimo = 0; var m;
      while ((m = regex.exec(texto))) {
        if (m.index > ultimo) frag.appendChild(document.createTextNode(texto.slice(ultimo, m.index)));
        var marca = document.createElement('mark');
        marca.className = 'resaltar';
        marca.textContent = m[0];
        frag.appendChild(marca);
        ultimo = m.index + m[0].length;
        if (m[0].length === 0) regex.lastIndex++;
      }
      if (ultimo < texto.length) frag.appendChild(document.createTextNode(texto.slice(ultimo)));
      n.parentNode.replaceChild(frag, n);
    });
  }

  function buscar(consulta) {
    var tokens = sinTildes(consulta).split(/\s+/).filter(function (t) { return t.length > 1 || (t.length === 1 && /\d/.test(t)); });
    var regex = tokens.length ? new RegExp(tokens.map(patronDe).join('|'), 'gi') : null;
    var total = 0;
    var porSeccion = {};
    textos.forEach(function (t) {
      t.cuerpo.innerHTML = t.original;
      if (t.titulo) t.titulo.innerHTML = t.tituloOriginal;
      var coincide = !tokens.length || tokens.every(function (k) { return t.norm.indexOf(k) !== -1; });
      t.el.hidden = !coincide;
      if (coincide) {
        total++;
        var sec = t.el.dataset.id;
        porSeccion[sec] = true;
        if (regex) {
          resaltar(t.cuerpo, regex);
          if (t.titulo) resaltar(t.titulo, regex);
          if (t.el.matches('.faq')) t.el.open = true;
        } else if (t.el.matches('.faq')) {
          t.el.open = false;
        }
      }
    });
    // Los títulos de sección y el índice solo muestran lo que quedó.
    var visiblesPorSeccion = {};
    textos.forEach(function (t) {
      if (t.el.hidden) return;
      var cont = t.el.closest('.glosario') ? 'glosario' : (t.el.matches('.faq') ? 'faq' : null);
      var s = cont || (function () { var h = t.el.previousElementSibling; while (h && !h.classList.contains('seccion-titulo')) h = h.previousElementSibling; return h ? h.dataset.seccion : null; })();
      if (s) visiblesPorSeccion[s] = true;
    });
    document.querySelectorAll('#contenido .seccion-titulo').forEach(function (h) { h.hidden = tokens.length > 0 && !visiblesPorSeccion[h.dataset.seccion]; });
    document.querySelectorAll('#indice a').forEach(function (a) {
      var id = a.dataset.id;
      var visible = !tokens.length || (id === 'faq' ? visiblesPorSeccion.faq : id === 'glosario' ? visiblesPorSeccion.glosario : !!porSeccion[id]);
      a.hidden = !visible;
    });
    document.querySelectorAll('#indice h4').forEach(function (h) { h.hidden = tokens.length > 0 && !visiblesPorSeccion[h.dataset.seccion]; });

    var conteo = $('buscador-conteo');
    conteo.textContent = tokens.length ? (total === 1 ? '1 resultado' : total + ' resultados') : '';
    var aviso = $('contenido').querySelector('.sin-resultados');
    if (aviso) aviso.remove();
    if (tokens.length && !total) {
      $('contenido').insertAdjacentHTML('afterbegin', '<div class="sin-resultados">No encontré nada con «' + esc(consulta) + '». Prueba con otra palabra.</div>');
    }
  }

  // -------------------------------------------------------------------------------------------------- índice y anclas
  function activarIndice() {
    if (!('IntersectionObserver' in window)) return;
    var enlaces = {};
    document.querySelectorAll('#indice a[data-id]').forEach(function (a) { enlaces[a.dataset.id] = a; });
    var obs = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) {
        if (!e.isIntersecting) return;
        document.querySelectorAll('#indice a.activo').forEach(function (a) { a.classList.remove('activo'); });
        var a = enlaces[e.target.dataset.id];
        if (a) a.classList.add('activo');
      });
    }, { rootMargin: '-90px 0px -65% 0px' });
    document.querySelectorAll('#contenido .bloque').forEach(function (b) { obs.observe(b); });
  }

  function abrirSegunAncla() {
    var h = location.hash;
    if (!/^#b-/.test(h)) return;
    var el = document.getElementById(h.slice(1));
    if (!el) return;
    if (el.matches('.faq')) el.open = true;
    el.classList.add('resaltado');
    setTimeout(function () { el.classList.remove('resaltado'); }, 2200);
    el.scrollIntoView({ block: 'start' });
  }

  // Un enlace «Ver: …» dentro del texto lleva al bloque, aunque esté filtrado por la búsqueda.
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a.ref-bloque');
    if (a) {
      var id = 'b-' + a.dataset.ref;
      var el = document.getElementById(id);
      if (!el) { ev.preventDefault(); return; }
      if ($('buscador').value) { $('buscador').value = ''; buscar(''); }
      ev.preventDefault();
      if (el.matches('.faq')) el.open = true;
      el.classList.add('resaltado');
      setTimeout(function () { el.classList.remove('resaltado'); }, 2200);
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', '#' + id);
      return;
    }
    // El índice del celular se pliega al elegir.
    var item = ev.target.closest && ev.target.closest('#indice a');
    if (item && window.matchMedia('(max-width: 999px)').matches) $('indice-caja').open = false;
  });
  window.addEventListener('hashchange', abrirSegunAncla);

  // -------------------------------------------------------------------------------------------------- impresión
  var abiertasAntes = null;
  function prepararImpresion() {
    abiertasAntes = Array.prototype.map.call(document.querySelectorAll('details.faq'), function (d) { return d.open; });
    document.querySelectorAll('details.faq').forEach(function (d) { d.open = true; });
  }
  function terminarImpresion() {
    if (!abiertasAntes) return;
    document.querySelectorAll('details.faq').forEach(function (d, i) { d.open = abiertasAntes[i]; });
    abiertasAntes = null;
  }
  window.addEventListener('beforeprint', prepararImpresion);
  window.addEventListener('afterprint', function () {
    terminarImpresion();
    document.body.classList.remove('imprimir-uno');
    document.querySelectorAll('.bloque.solo-este').forEach(function (b) { b.classList.remove('solo-este'); });
  });
  // «Imprimir solo esta guía»: se marca el bloque, el CSS de impresión esconde todo lo demás.
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-imprimir]');
    if (!b) return;
    var bloque = document.getElementById('b-' + b.dataset.imprimir);
    if (!bloque) return;
    bloque.classList.add('solo-este');
    document.body.classList.add('imprimir-uno');
    window.print();
  });

  // -------------------------------------------------------------------------------------------------- carga
  function rutaDeApi(clave) {
    if (clave === 'instalacion') return '/manuales/instalacion';
    return '/manuales/rol/' + encodeURIComponent(clave);
  }

  async function iniciar() {
    var usuario = await window.inicializarLayout('/ayuda.html');
    if (!usuario) return;
    modoAdmin = usuario.rol === 'admin' && !usuario.es_aspirante;
    var clave = new URLSearchParams(location.search).get('manual');

    var temporizador = null;
    $('buscador').addEventListener('input', function (e) {
      clearTimeout(temporizador);
      var v = e.target.value;
      temporizador = setTimeout(function () { buscar(v); }, 160);
    });
    $('btn-imprimir').addEventListener('click', function () { window.print(); });

    mostrarEstado('Cargando el manual…');
    try {
      if (modoAdmin) {
        if (clave) {
          pintarManual(await window.api(rutaDeApi(clave)), clave);
        } else {
          var propio = await window.api('/manuales/mio');
          mostrarEstado('');
          pintarPortada(propio.tarjetas || []);
        }
      } else {
        pintarManual(await window.api('/manuales/mio'), 'mio');
      }
    } catch (err) {
      $('vista-portada').hidden = true;
      $('vista-manual').hidden = true;
      mostrarEstado((err && err.message) ? err.message : 'No se pudo cargar el manual. Intenta de nuevo.');
    }
  }

  iniciar();
})();
