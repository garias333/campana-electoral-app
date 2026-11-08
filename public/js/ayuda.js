/**
 * Ayuda · Manuales (public/ayuda.html).
 *
 * El contenido NO está aquí: lo arma el servidor (lib/manuales.js → /api/manuales/…) ya filtrado por permisos y con el HTML
 * escapado. Esta pantalla solo lo pinta, arma el índice, filtra y resalta al buscar, y prepara la impresión.
 * El diseño sigue la muestra «manual-lider-muestra.html» (orden Manuales 3); el CSS está en public/css/ayuda.css.
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
  var PALABRAS_POR_MINUTO = 200;

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

  function mayuscula(t) {
    t = String(t || '');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function mostrarEstado(texto) {
    var e = $('estado');
    e.textContent = texto || '';
    e.hidden = !texto;
  }

  /** «Lectura: 15 minutos» calculado con las palabras que de verdad tiene este manual hoy. */
  function tiempoDeLectura(palabras) {
    var min = Math.max(1, Math.round(palabras / PALABRAS_POR_MINUTO));
    if (min < 60) return min + (min === 1 ? ' minuto' : ' minutos');
    var h = Math.floor(min / 60), r = min % 60;
    return h + ' h' + (r ? ' ' + r + ' min' : '');
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
  /** La ruta del menú: «Escritorio · Menú  [Electoral] › [Votantes]», con cada paso en su pastilla. */
  function rutaHtml(ruta) {
    return (ruta || []).map(function (r) {
      var pasos = r.pasos.map(function (p) { return '<span class="pastilla">' + esc(p) + '</span>'; }).join('<span class="sep">›</span>');
      var cabeza = r.plataforma === 'Celular' ? 'App del celular' : 'Menú';
      return '<div class="ruta">' + (r.plataforma ? esc(r.plataforma) + ' · ' : '') + cabeza + ' ' + pasos + '</div>';
    }).join('');
  }

  function rolesHtml(roles) {
    if (!roles || !roles.length || roles.indexOf('todos') !== -1) return '';
    return '<div class="perm"><span class="mod">Para: ' + esc(roles.map(function (r) { return NOMBRE_ROL[r] || r; }).join(', ')) + '</span></div>';
  }

  /** Insignias de permisos: en verde lo que la persona tiene; en gris y tachado lo que no. */
  function insigniasHtml(b) {
    if (!b.modulo) return rolesHtml(b.roles);
    var p = (datos.permisos || {})[b.modulo] || {};
    var casilla = function (clave, texto) {
      var on = !!p[clave];
      return '<span class="' + (on ? 'si' : 'no') + '" title="' + (on ? 'Tienes este permiso' : 'No tienes este permiso') + '">' + (on ? '✓ ' : '') + texto + '</span>';
    };
    return '<div class="perm" aria-label="Permisos en ' + esc(b.etiqueta_modulo || b.modulo) + '">' +
      '<span class="mod" title="Módulo de Asignación de permisos">' + esc(b.etiqueta_modulo || b.modulo) + '</span>' +
      casilla('ver', 'Puede ver') + casilla('editar', 'Puede editar') + casilla('agregar', 'Puede agregar') +
      (p.tiene_importar_exportar ? casilla('importar_exportar', 'Importar / Exportar') : '') + '</div>';
  }

  /** «Para qué sirve»: lo que hay antes del primer subtítulo se mete en su recuadro azul claro. */
  function envolverParaQueSirve(cuerpo) {
    if (cuerpo.firstElementChild && cuerpo.firstElementChild.classList.contains('para')) return;   // la guía del rol ya trae el suyo
    var primeros = [];
    var nodo = cuerpo.firstElementChild;
    while (nodo && !/^H[34]$/.test(nodo.tagName) && !nodo.classList.contains('llamado')) {
      primeros.push(nodo);
      nodo = nodo.nextElementSibling;
    }
    if (!primeros.length) return;
    var caja = document.createElement('div');
    caja.className = 'para';
    cuerpo.insertBefore(caja, primeros[0]);
    var rotulo = '<b>Para qué sirve:</b> ';
    if (primeros[0].tagName === 'P') primeros[0].insertAdjacentHTML('afterbegin', rotulo);
    else caja.insertAdjacentHTML('afterbegin', '<p>' + rotulo.trim() + '</p>');
    primeros.forEach(function (n) { caja.appendChild(n); });
  }

  function bloqueHtml(b) {
    return '<article class="sec bloque buscable' + (b.seccion === 'dia-d' ? ' dd' : '') + '" id="b-' + esc(b.id) + '" data-id="' + esc(b.id) + '">' +
      '<div class="bloque-cabecera"><span class="bloque-icono">' + icono(b.icono) + '</span>' +
      '<div class="bloque-titulos"><h2>' + esc(b.titulo) + '</h2>' + rutaHtml(b.ruta) + '</div>' +
      '<button type="button" class="btn-imprimir-bloque ayuda-no-imprimir" data-imprimir="' + esc(b.id) + '" title="Imprimir solo esta guía" aria-label="Imprimir solo esta guía">' + icono('imprimir') + '</button></div>' +
      insigniasHtml(b) +
      '<div class="bloque-cuerpo">' + b.html + '</div></article>';
  }

  /** La primera guía de cada manual: el rol en una mirada (Antes / Durante / Día D) y los módulos que hoy puede ver. */
  function rolHtml(d) {
    var porSeccion = {};
    (d.secciones || []).forEach(function (s) { porSeccion[s.id] = s.bloques || []; });
    var fases = [
      { id: 'antes', titulo: 'Antes', dd: false },
      { id: 'durante', titulo: 'Durante', dd: false },
      { id: 'dia-d', titulo: 'Día D', dd: true },
    ];
    var tarjetas = fases.filter(function (f) { return (porSeccion[f.id] || []).length; }).map(function (f) {
      var lista = porSeccion[f.id];
      var nombres = lista.slice(0, 3).map(function (b) { return b.titulo; });
      var resto = lista.length - nombres.length;
      var texto = nombres.join(', ') + (resto > 0 ? ' y ' + resto + (resto === 1 ? ' guía más.' : ' guías más.') : '.');
      return '<a class="tarj' + (f.dd ? ' dd' : '') + '" href="#s-' + f.id + '"><h3>' + f.titulo + '</h3><p>' +
        lista.length + (lista.length === 1 ? ' guía: ' : ' guías: ') + esc(texto) + '</p></a>';
    });
    var modulos = Object.keys(d.permisos || {}).filter(function (k) { return d.permisos[k].ver; }).map(function (k) {
      return '<span class="si">✓ ' + esc(d.permisos[k].etiqueta || k) + '</span>';
    });
    var titulo = d.modo === 'mio' ? 'Tu rol en la campaña' : 'El rol en la campaña';
    return '<article class="sec bloque buscable" id="b-mi-rol" data-id="mi-rol">' +
      '<div class="bloque-cabecera"><span class="bloque-icono">' + icono('bandera') + '</span><div class="bloque-titulos"><h2>' + titulo + '</h2></div></div>' +
      '<div class="bloque-cuerpo"><div class="para"><p><b>Para qué sirve:</b> ' + esc(d.descripcion || '') + '</p></div>' +
      (tarjetas.length ? '<div class="rejilla">' + tarjetas.join('') + '</div>' : '') +
      (modulos.length ? '<h3>Lo que ' + (d.modo === 'mio' ? 'puedes ver hoy' : 'puede ver este rol') + '</h3><div class="perm" title="Esto sale de los permisos reales">' + modulos.join('') + '</div>' : '') +
      '</div></article>';
  }

  /** Las preguntas frecuentes y el glosario van cada uno en su tarjeta, con ícono y título, como en la muestra. */
  function agrupadaHtml(id, titulo, nombreIcono, cuerpo) {
    return '<section class="sec sec-agrupada" id="s-' + id + '" data-id="' + id + '">' +
      '<div class="bloque-cabecera"><span class="bloque-icono">' + icono(nombreIcono) + '</span><div class="bloque-titulos">' +
      '<h2 class="seccion-titulo en-tarjeta" data-seccion="' + id + '">' + esc(titulo) + '</h2></div></div>' + cuerpo + '</section>';
  }

  function faqHtml(b) {
    return '<details class="faq buscable" id="b-' + esc(b.id) + '" data-id="' + esc(b.id) + '"><summary>' + esc(b.titulo) + '</summary>' +
      '<div class="faq-cuerpo bloque-cuerpo">' + b.html + '</div></details>';
  }

  function terminoHtml(b) {
    return '<div class="termino buscable" id="b-' + esc(b.id) + '" data-id="' + esc(b.id) + '"><dt>' + esc(b.titulo) + '</dt><dd class="bloque-cuerpo">' + b.html + '</dd></div>';
  }

  function itemIndice(id, secId, titulo) {
    return '<li class="item" data-id="' + esc(id) + '" data-seccion="' + esc(secId) + '"><a href="#b-' + esc(id) + '" data-id="' + esc(id) + '">' + esc(titulo) + '</a></li>';
  }

  /** «Manual del líder» → «Manual del» + «Líder» en amarillo. Si el título no tiene esa forma, va entero. */
  function pintarTitulo(titulo) {
    var h1 = $('manual-titulo');
    h1.textContent = '';
    var m = /^(Manual (?:del|de la|de los|de))\s+(.+)$/i.exec(titulo || '');
    if (!m) { h1.textContent = titulo || ''; return; }
    h1.appendChild(document.createTextNode(m[1] + ' '));
    var rol = document.createElement('span');
    rol.textContent = mayuscula(m[2]);
    h1.appendChild(rol);
  }

  function pintarChips(d, palabras) {
    var chips = [];
    var rolNombre = mayuscula(NOMBRE_ROL[d.rol] || d.rol);
    if (d.modo === 'instalacion') {
      chips.push('Para: <b>quien administra el servidor</b>');
    } else {
      chips.push((d.modo === 'mio' ? 'Tu rol: ' : 'Rol: ') + '<b>' + esc(rolNombre) + '</b>');
      chips.push('Se arma con <b>' + (d.modo === 'mio' ? 'tus permisos de hoy' : 'los permisos de este rol') + '</b>');
    }
    chips.push('Lectura: <b>' + tiempoDeLectura(palabras) + '</b>');
    if (d.fecha_contenido) chips.push('Actualizado: <b>' + esc(fechaLegible(d.fecha_contenido)) + '</b>');
    $('manual-chips').innerHTML = chips.map(function (c) { return '<span class="chip">' + c + '</span>'; }).join('');
  }

  function pintarManual(d, claveManual) {
    datos = d;
    $('vista-portada').hidden = true;
    $('vista-manual').hidden = false;
    mostrarEstado('');
    document.title = d.titulo + ' · Ayuda';

    var instalacion = d.modo === 'instalacion';
    $('manual-eyebrow').textContent = instalacion ? 'Centro de ayuda · Documentación técnica' : 'Centro de ayuda · Manual de uso';
    pintarTitulo(d.titulo);
    $('manual-descripcion').textContent = d.descripcion || '';

    $('btn-todos').hidden = !modoAdmin;
    var enApp = typeof window.esCelular === 'function' && window.esCelular() && !modoAdmin;
    $('btn-app').hidden = !enApp;
    $('btn-faq').hidden = !(d.faq || []).length;

    var partes = [];
    var indice = [];
    if (!instalacion) {
      partes.push(rolHtml(d));
      indice.push(itemIndice('mi-rol', 'mi-rol', d.modo === 'mio' ? 'Tu rol en la campaña' : 'El rol en la campaña'));
    }
    (d.secciones || []).forEach(function (s) {
      partes.push('<h2 class="seccion-titulo" id="s-' + esc(s.id) + '" data-seccion="' + esc(s.id) + '">' + esc(s.titulo) + '</h2>');
      s.bloques.forEach(function (b) { partes.push(bloqueHtml(b)); });
      indice.push('<li class="grupo" data-seccion="' + esc(s.id) + '">' + esc(s.titulo) + '</li>' +
        s.bloques.map(function (b) { return itemIndice(b.id, s.id, b.titulo); }).join(''));
    });
    if ((d.faq || []).length) {
      partes.push(agrupadaHtml('faq', 'Preguntas frecuentes', 'ayuda', d.faq.map(faqHtml).join('')));
      indice.push('<li class="item" data-id="faq" data-seccion="faq"><a href="#s-faq" data-id="faq">Preguntas frecuentes (' + d.faq.length + ')</a></li>');
    }
    if ((d.glosario || []).length) {
      partes.push(agrupadaHtml('glosario', 'Glosario', 'libro', '<dl class="glosario">' + d.glosario.map(terminoHtml).join('') + '</dl>'));
      indice.push('<li class="item" data-id="glosario" data-seccion="glosario"><a href="#s-glosario" data-id="glosario">Glosario (' + d.glosario.length + ')</a></li>');
    }
    var hayGuias = (d.secciones || []).some(function (s) { return s.bloques.length; });
    if (!hayGuias && !(d.faq || []).length && !(d.glosario || []).length) {
      $('contenido').innerHTML = '<div class="manual-vacio">Este manual todavía no tiene guías para los permisos que tienes hoy.</div>';
      $('indice').innerHTML = '';
    } else {
      $('contenido').innerHTML = partes.join('\n');
      $('indice').innerHTML = indice.join('');
    }

    document.querySelectorAll('#contenido .bloque .bloque-cuerpo').forEach(envolverParaQueSirve);
    pintarChips(d, ($('contenido').textContent.match(/\S+/g) || []).length);

    // El índice es un acordeón en pantallas angostas (ahí 40 enlaces tapan el manual); en el escritorio va fijo y abierto.
    $('indice-caja').open = !window.matchMedia('(max-width: 1099px)').matches;
    prepararBuscador();
    activarIndice();
    abrirSegunAncla();
  }

  // -------------------------------------------------------------------------------------------------- búsqueda
  function prepararBuscador() {
    textos = Array.prototype.map.call(document.querySelectorAll('#contenido .buscable'), function (el) {
      var cuerpo = el.matches('.faq') ? el.querySelector('.faq-cuerpo') : (el.matches('.termino') ? el.querySelector('dd') : el.querySelector('.bloque-cuerpo'));
      var titulo = el.querySelector('h2, summary, dt');
      return { el: el, cuerpo: cuerpo, titulo: titulo, norm: sinTildes(el.textContent), original: cuerpo.innerHTML, tituloOriginal: titulo ? titulo.innerHTML : '' };
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

  /** A qué grupo del índice pertenece cada elemento buscable (una sección de guías, las preguntas o el glosario). */
  function grupoDe(el) {
    if (el.closest('.glosario')) return 'glosario';
    if (el.matches('.faq')) return 'faq';
    if (el.dataset.id === 'mi-rol') return 'mi-rol';
    var h = el.previousElementSibling;
    while (h && !h.classList.contains('seccion-titulo')) h = h.previousElementSibling;
    return h ? h.dataset.seccion : null;
  }

  function buscar(consulta) {
    var tokens = sinTildes(consulta).split(/\s+/).filter(function (t) { return t.length > 1 || (t.length === 1 && /\d/.test(t)); });
    var regex = tokens.length ? new RegExp(tokens.map(patronDe).join('|'), 'gi') : null;
    var total = 0;
    var idsVisibles = {};
    var gruposVisibles = {};
    textos.forEach(function (t) {
      t.cuerpo.innerHTML = t.original;
      if (t.titulo) t.titulo.innerHTML = t.tituloOriginal;
      var coincide = !tokens.length || tokens.every(function (k) { return t.norm.indexOf(k) !== -1; });
      t.el.hidden = !coincide;
      if (!coincide) return;
      total++;
      idsVisibles[t.el.dataset.id] = true;
      var g = grupoDe(t.el);
      if (g) gruposVisibles[g] = true;
      if (regex) {
        resaltar(t.cuerpo, regex);
        if (t.titulo) resaltar(t.titulo, regex);
        if (t.el.matches('.faq')) t.el.open = true;
      } else if (t.el.matches('.faq')) {
        t.el.open = false;
      }
    });

    // Los títulos de sección y el índice solo muestran lo que quedó.
    document.querySelectorAll('#contenido > .seccion-titulo').forEach(function (h) { h.hidden = tokens.length > 0 && !gruposVisibles[h.dataset.seccion]; });
    ['faq', 'glosario'].forEach(function (g) {
      var caja = $('s-' + g);
      if (caja) caja.hidden = tokens.length > 0 && !gruposVisibles[g];
    });
    document.querySelectorAll('#indice li.item').forEach(function (li) {
      var id = li.dataset.id;
      li.hidden = tokens.length > 0 && !(id === 'faq' || id === 'glosario' ? gruposVisibles[id] : idsVisibles[id]);
    });
    document.querySelectorAll('#indice li.grupo').forEach(function (li) { li.hidden = tokens.length > 0 && !gruposVisibles[li.dataset.seccion]; });

    $('buscador-conteo').textContent = tokens.length ? (total === 1 ? '1 resultado' : total + ' resultados') : '';
    $('sin-resultados').hidden = !(tokens.length && !total);
  }

  function limpiarBusqueda() {
    if ($('buscador').value) { $('buscador').value = ''; buscar(''); }
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
    document.querySelectorAll('#contenido .sec').forEach(function (b) { obs.observe(b); });
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

  document.addEventListener('click', function (ev) {
    // Un enlace «Ver: …» dentro del texto lleva al bloque, aunque esté filtrado por la búsqueda.
    var a = ev.target.closest && ev.target.closest('a.ref-bloque');
    if (a) {
      var id = 'b-' + a.dataset.ref;
      var el = document.getElementById(id);
      if (!el) { ev.preventDefault(); return; }
      limpiarBusqueda();
      ev.preventDefault();
      if (el.matches('.faq')) el.open = true;
      el.classList.add('resaltado');
      setTimeout(function () { el.classList.remove('resaltado'); }, 2200);
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', '#' + id);
      return;
    }
    // Las tarjetas «Antes / Durante / Día D», «Preguntas frecuentes» y el índice llevan a un punto del manual: si la búsqueda
    // lo escondió, se limpia primero para que el enlace no caiga en el vacío.
    var ancla = ev.target.closest && ev.target.closest('a[href^="#s-"], #indice a');
    if (ancla) {
      var destino = document.getElementById((ancla.getAttribute('href') || '').slice(1));
      if (destino && destino.hidden) limpiarBusqueda();
    }
    // El índice del celular se pliega al elegir.
    var item = ev.target.closest && ev.target.closest('#indice a');
    if (item && window.matchMedia('(max-width: 1099px)').matches) $('indice-caja').open = false;
  });
  window.addEventListener('hashchange', abrirSegunAncla);

  // -------------------------------------------------------------------------------------------------- impresión
  var abiertasAntes = null;
  function prepararImpresion() {
    abiertasAntes = Array.prototype.map.call(document.querySelectorAll('details.faq'), function (d) { return d.open; });
    document.querySelectorAll('details.faq').forEach(function (d) { d.open = true; });
    // Las guías cortas se imprimen enteras en una página (ver ayuda.css); se mide con las preguntas ya abiertas.
    document.querySelectorAll('.sec').forEach(function (b) { b.classList.toggle('corta', b.offsetHeight < 420); });
  }
  function terminarImpresion() {
    if (!abiertasAntes) return;
    document.querySelectorAll('details.faq').forEach(function (d, i) { d.open = abiertasAntes[i]; });
    abiertasAntes = null;
    document.querySelectorAll('.sec.corta').forEach(function (b) { b.classList.remove('corta'); });
  }
  window.addEventListener('beforeprint', prepararImpresion);
  window.addEventListener('afterprint', function () {
    terminarImpresion();
    document.body.classList.remove('imprimir-uno');
    document.querySelectorAll('.sec.solo-este').forEach(function (b) { b.classList.remove('solo-este'); });
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
