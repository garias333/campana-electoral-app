/* ======================================================================
   js/territorios-gestion.js — ORDEN 147: gestionar comunas, barrios,
   corregimientos y veredas de la campaña.

   DE DÓNDE SALE. Hasta la orden 146 esto era un modal dentro de
   `territorial.html` («Gestionar territorios»), con su tabla, su formulario
   de agregar, su modal de editar y sus botones de Excel. Gildardo pidió que
   viviera en Configuración → Datos de la campaña, como séptima ficha. En vez
   de copiar 300 líneas de una pantalla a la otra, el modal se MUDÓ aquí: una
   pieza que se pinta sola dentro del contenedor que se le dé.

   POR QUÉ PINTA SU PROPIO HTML. La alternativa era dejar el marcado en
   `configuracion.html` y que este archivo solo lo cablease por ids. Eso es
   justo lo que hacía el modal, y es lo que hizo que mudarlo costara: el
   marcado y su lógica estaban en archivos distintos y había que casarlos a
   mano. Pintándolo aquí, quien quiera esta ficha en otra pantalla escribe un
   `<div>` vacío y una línea.

   DE QUÉ NO DEPENDE. De nada de `territorial.html`: pide por su cuenta la
   lista de territorios, el catálogo de departamentos y municipios y los
   cuatro interruptores de la campaña. `obtenerConCacheReferencia`
   (js/offline-utils.js) se usa SI está cargada; si no, se baja el catálogo
   directo. Así la ficha funciona en una pantalla que no lleva el resto del
   equipaje de Estructura territorial.

   QUIÉN MANDA LO DECIDE EL SERVIDOR. `GET /territorial/territorios/modo`
   devuelve `editable` (si `territorios` es tabla local y no una vista del
   Catálogo Territorial) y `mando` (si quien mira es administrador o
   superadministrador). La pantalla NO vuelve a deducirlo de `rol` y
   `es_aspirante`: esa doble regla fue lo que dejó al aspirante viendo
   botones que el servidor le negaba con un 403.
   ====================================================================== */
(function (global) {
  'use strict';

  var TIPOS_EDITABLES = ['comuna', 'corregimiento', 'barrio', 'vereda'];

  /* Los helpers de common.js, pedidos en el momento de usarlos y no al
     cargar: este archivo puede ir antes que common.js en el HTML. */
  function esc(t) { return typeof escaparHtml === 'function' ? escaparHtml(t) : String(t == null ? '' : t); }
  function lugar(t) { return typeof nombreLugar === 'function' ? nombreLugar(t) : String(t == null ? '' : t); }
  function norm(t) {
    if (typeof normalizarTexto === 'function') return normalizarTexto(t);
    return String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }
  function aviso(texto, tipo) {
    if (typeof mostrarToast === 'function') mostrarToast(texto, tipo);
    else console.warn('[territorios]', tipo, texto);
  }

  /** El catálogo DANE de departamentos y municipios, con caché si la hay. */
  function bajarCatalogoColombia() {
    var traer = function () { return fetch('/data/colombia.json').then(function (r) { return r.json(); }); };
    if (typeof obtenerConCacheReferencia === 'function') return obtenerConCacheReferencia('colombia', traer);
    return traer();
  }

  /**
   * El marcado de la ficha. `id` prefija TODO, para que dos instancias en la
   * misma página no se pisen los ids (hoy hay una; mañana puede haberla en
   * un asistente de arranque de campaña).
   */
  function marcado(p) {
    return '' +
      '<div class="tg-ayuda" id="' + p + '-ayuda">' +
        '<strong>Cómo subir muchos de una vez.</strong> ' +
        'Suba un Excel con las columnas <b>Departamento</b>, <b>Municipio</b>, <b>Área</b>, <b>Tipo</b>, ' +
        '<b>Nombre</b> y <b>Pertenece</b>. En <b>Tipo</b>: Comuna, Barrio, Corregimiento o Vereda. ' +
        'En <b>Pertenece</b>, la comuna de cada barrio o el corregimiento de cada vereda. ' +
        'Solo se cargan los tipos que estén en «Sí» en la ficha <b>Territorio</b>. ' +
        '<span class="tg-ayuda-nota">La columna Área es informativa: el que manda es el Tipo.</span>' +
        '<div class="tg-ayuda-acc">' +
          '<a class="tg-enlace-plantilla" id="' + p + '-plantilla" ' +
             'href="/api/territorial/territorios/exportar-excel?plantilla=1">⬇ Descargar plantilla de ejemplo</a>' +
        '</div>' +
      '</div>' +

      '<div class="mensaje-error" id="' + p + '-error"></div>' +
      '<div class="mensaje-ok" id="' + p + '-ok"></div>' +

      '<div class="mensaje-ok tg-aviso-catalogo" id="' + p + '-aviso-vista" style="display:none;">' +
        'Los territorios de esta campaña vienen del Catálogo Territorial y no se editan aquí: si falta ' +
        'alguno, o hay un nombre mal escrito, se corrige una vez en el catálogo y el cambio aparece solo ' +
        'en todas las campañas.' +
      '</div>' +

      '<div id="' + p + '-form">' +
        '<div class="dc-sub">Agregar uno</div>' +
        '<div class="dc-g2">' +
          '<div class="campo">' +
            '<label for="' + p + '-departamento">Departamento</label>' +
            '<input id="' + p + '-departamento" list="' + p + '-lista-departamentos" autocomplete="off">' +
            '<datalist id="' + p + '-lista-departamentos"></datalist>' +
          '</div>' +
          '<div class="campo">' +
            '<label for="' + p + '-municipio">Municipio / Ciudad</label>' +
            '<input id="' + p + '-municipio" list="' + p + '-lista-municipios" autocomplete="off">' +
            '<datalist id="' + p + '-lista-municipios"></datalist>' +
          '</div>' +
        '</div>' +
        '<div class="dc-g2">' +
          '<div class="campo">' +
            '<label for="' + p + '-area">Área</label>' +
            '<select id="' + p + '-area">' +
              '<option value="">Selecciona...</option>' +
              '<option value="urbano">Urbano</option>' +
              '<option value="rural">Rural</option>' +
            '</select>' +
          '</div>' +
          '<div class="campo">' +
            '<label for="' + p + '-tipo">Tipo de zona</label>' +
            '<select id="' + p + '-tipo" data-sin-ordenar disabled>' +
              '<option value="">Elige primero el área</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div class="campo" id="' + p + '-campo-comuna" data-campo="comuna" style="display:none;">' +
          '<label for="' + p + '-comuna-padre">Comuna a la que pertenece</label>' +
          '<select id="' + p + '-comuna-padre"><option value="">Sin comuna específica</option></select>' +
        '</div>' +
        '<div class="campo" id="' + p + '-campo-corregimiento" data-campo="corregimiento" style="display:none;">' +
          '<label for="' + p + '-corregimiento-padre">Corregimiento al que pertenece</label>' +
          '<select id="' + p + '-corregimiento-padre"><option value="">Sin corregimiento específico</option></select>' +
        '</div>' +
        '<div class="campo">' +
          '<label for="' + p + '-nombre" id="' + p + '-label-nombre">Nombre de la zona</label>' +
          '<input id="' + p + '-nombre">' +
        '</div>' +
        '<div class="tg-acciones-form">' +
          '<button type="button" class="btn-primario" id="' + p + '-agregar">Agregar</button>' +
        '</div>' +
      '</div>' +

      '<div class="tg-barra" id="' + p + '-barra">' +
        '<a class="btn-secundario btn-sm btn-excel-app" id="' + p + '-exportar" ' +
           'href="/api/territorial/territorios/exportar-excel" target="_blank" rel="noopener">⬇ Exportar a Excel</a>' +
        '<label class="btn-secundario btn-sm btn-excel-app" id="' + p + '-label-importar" style="cursor:pointer; margin:0;">' +
          '⬆ Importar desde Excel' +
          '<input type="file" id="' + p + '-importar" accept=".xlsx,.xls" style="display:none;">' +
        '</label>' +
        '<button type="button" class="btn-peligro btn-sm" id="' + p + '-eliminar-todos">🗑 Eliminar todos</button>' +
      '</div>' +
      '<div class="tg-resultado" id="' + p + '-resultado" style="display:none;"></div>' +

      '<div class="dc-sub">Lo que hay hoy</div>' +
      '<div class="tg-filtros">' +
        '<div class="campo">' +
          '<label for="' + p + '-buscar">Buscar</label>' +
          '<input id="' + p + '-buscar" placeholder="Nombre de la comuna, barrio, corregimiento o vereda" autocomplete="off">' +
        '</div>' +
        '<div class="campo">' +
          '<label for="' + p + '-filtro-tipo">Tipo</label>' +
          '<select id="' + p + '-filtro-tipo" data-sin-ordenar>' +
            '<option value="">Todos los tipos</option>' +
            '<option value="departamento">Departamento</option>' +
            '<option value="municipio">Municipio</option>' +
            '<option value="comuna">Comuna</option>' +
            '<option value="corregimiento">Corregimiento</option>' +
            '<option value="barrio">Barrio</option>' +
            '<option value="vereda">Vereda</option>' +
          '</select>' +
        '</div>' +
        '<div class="tg-conteo" id="' + p + '-conteo"></div>' +
      '</div>' +
      '<div class="tabla-contenedor">' +
        '<table class="tabla-alineada">' +
          '<thead><tr><th>Tipo</th><th>Nombre</th><th>Pertenece a</th><th></th></tr></thead>' +
          '<tbody id="' + p + '-tbody"></tbody>' +
        '</table>' +
      '</div>' +
      '<div class="vacio" id="' + p + '-vacio" style="display:none;"><div class="icono-vacio">▲</div>Aún no hay territorios registrados.</div>';
  }

  /** El modal de editar, que vive en <body> — nunca dentro de otro formulario. */
  function marcadoEditar(p) {
    return '' +
      '<div class="modal" style="max-width:420px;">' +
        '<div class="modal-header"><h3>Editar territorio</h3>' +
          '<button class="modal-cerrar" type="button" id="' + p + '-ed-cerrar">×</button></div>' +
        '<p style="color:var(--color-text-muted); font-size:0.85rem;">Los cambios se reflejan automáticamente en Estructura, Votantes y Eventos que ya usan este territorio. Si cambias el nombre, también se actualizan las personas cuyo campo «Comuna/Corregimiento de residencia» o «Barrio/Vereda de residencia» coincidía con el nombre anterior.</p>' +
        '<div class="mensaje-error" id="' + p + '-ed-error"></div>' +
        '<div class="mensaje-ok" id="' + p + '-ed-ok"></div>' +
        '<form id="' + p + '-ed-form">' +
          '<input type="hidden" id="' + p + '-ed-id">' +
          '<div class="campo"><label for="' + p + '-ed-tipo">Tipo</label><input id="' + p + '-ed-tipo" disabled></div>' +
          '<div class="campo"><label for="' + p + '-ed-nombre">Nombre</label><input id="' + p + '-ed-nombre" required></div>' +
          '<div class="campo" id="' + p + '-ed-campo-padre" style="display:none;">' +
            '<label for="' + p + '-ed-padre" id="' + p + '-ed-label-padre">Pertenece a</label>' +
            '<select id="' + p + '-ed-padre"></select>' +
          '</div>' +
          '<button type="submit" class="btn-primario">Guardar cambios</button>' +
        '</form>' +
      '</div>';
  }

  /**
   * @param {object} opciones
   *   raiz       {HTMLElement|string} contenedor (o su id) donde se pinta.
   *   prefijo    {string}  prefijo de los ids. Por omisión 'tg'.
   *   alCambiar  {function} se llama tras cada cambio que afecte a otros
   *              (crear, editar, borrar, importar). La pantalla que la pase
   *              puede refrescar lo suyo; la ficha no sabe qué hay alrededor.
   */
  function crearGestionTerritorios(opciones) {
    var cfg = opciones || {};
    var raiz = typeof cfg.raiz === 'string' ? document.getElementById(cfg.raiz) : cfg.raiz;
    if (!raiz) throw new Error('crearGestionTerritorios: falta el contenedor.');
    var p = cfg.prefijo || 'tg';
    var alCambiar = typeof cfg.alCambiar === 'function' ? cfg.alCambiar : function () {};

    var lista = [];
    var catalogo = null;
    var editable = true;     // hasta que el servidor diga lo contrario
    var mando = false;       // falla cerrado: sin respuesta, no se ofrece escribir
    var usa = { comunas: true, barrios: true, corregimientos: true, veredas: true };
    var iniciado = false;

    var el = function (sufijo) { return document.getElementById(p + '-' + sufijo); };

    /* ---------------------------------------------------------------- pintar */

    raiz.innerHTML = marcado(p);
    var overlayEditar = document.createElement('div');
    overlayEditar.className = 'overlay';
    overlayEditar.id = p + '-ed-overlay';
    overlayEditar.innerHTML = marcadoEditar(p);
    document.body.appendChild(overlayEditar);

    function mostrar(sufijo, visible) {
      var e = el(sufijo);
      if (e) e.style.display = visible ? '' : 'none';
    }

    function limpiarMensajes() {
      ['error', 'ok'].forEach(function (s) {
        var e = el(s);
        if (e) { e.classList.remove('visible'); e.textContent = ''; }
      });
    }

    function decir(sufijo, texto) {
      var e = el(sufijo);
      if (!e) return;
      e.textContent = texto;
      e.classList.add('visible');
    }

    /* ------------------------------------------------- lo que se puede hacer */

    /**
     * Aplica el modo que dijo el servidor. Lo que decide es `modo`, no el rol:
     * `editable` apaga TODA escritura (campaña conectada al catálogo) y `mando`
     * distingue a quien puede escribir de quien solo mira.
     */
    function aplicarModo() {
      var puedeEscribir = editable && mando;
      mostrar('form', puedeEscribir);
      mostrar('label-importar', puedeEscribir);
      mostrar('eliminar-todos', puedeEscribir);
      mostrar('ayuda', puedeEscribir);
      mostrar('aviso-vista', !editable);
      /* Exportar NO es escribir: se ofrece siempre que la ruta lo acepte, y la
         ruta lo acepta a quien tenga mando o el permiso «Importar / Exportar».
         Si no hay mando se deja igual: un 403 legible es mejor que esconder
         una descarga a quien la matriz sí le dio. */
      var barra = el('barra');
      if (barra) barra.style.display = '';
    }

    /* ------------------------------------------------------------ la tabla */

    function filtradas() {
      var texto = norm(el('buscar') ? el('buscar').value : '');
      var tipo = el('filtro-tipo') ? el('filtro-tipo').value : '';
      return lista.filter(function (t) {
        if (tipo && t.tipo !== tipo) return false;
        if (texto && norm(t.nombre).indexOf(texto) === -1) return false;
        return true;
      });
    }

    function renderTabla() {
      var tbody = el('tbody');
      if (!tbody) return;
      var filas = filtradas();
      var porId = {};
      lista.forEach(function (t) { porId[t.id] = t; });

      var vacio = el('vacio');
      if (vacio) {
        vacio.style.display = filas.length ? 'none' : 'block';
        vacio.lastChild.textContent = lista.length
          ? 'Ningún territorio coincide con la búsqueda.'
          : 'Aún no hay territorios registrados.';
      }
      var conteo = el('conteo');
      if (conteo) {
        conteo.textContent = lista.length
          ? (filas.length === lista.length
              ? filas.length + ' territorio(s)'
              : filas.length + ' de ' + lista.length + ' territorio(s)')
          : '';
      }

      tbody.innerHTML = filas.map(function (t) {
        var padre = t.padre_id && porId[t.padre_id] ? lugar(porId[t.padre_id].nombre) : '—';
        var acciones = '';
        if (editable && mando && TIPOS_EDITABLES.indexOf(t.tipo) !== -1) {
          acciones += '<button type="button" class="btn-secundario btn-sm" data-tg-editar="' + t.id + '" title="Editar">✏️ Editar</button> ';
          acciones += '<button type="button" class="btn-peligro btn-sm" data-tg-eliminar="' + t.id + '">Eliminar</button>';
        }
        return '<tr>' +
          '<td><span class="tag-tipo">' + esc(t.tipo) + '</span></td>' +
          '<td><strong>' + esc(lugar(t.nombre)) + '</strong></td>' +
          '<td>' + esc(padre) + '</td>' +
          '<td style="white-space:nowrap;">' + acciones + '</td>' +
        '</tr>';
      }).join('');
    }

    /* --------------------------------------------------------- cargar datos */

    async function cargarLista() {
      lista = await api('/territorial/territorios');
      renderTabla();
    }

    async function cargarModo() {
      try {
        var r = await api('/territorial/territorios/modo');
        editable = r.editable !== false;
        mando = r.mando === true;
      } catch (_) {
        /* FALLA CERRADO. Sin respuesta no se ofrece escribir: un botón que
           siempre contesta 403 es peor que no estar. */
        mando = false;
      }
      aplicarModo();
    }

    async function cargarFlagsCampana() {
      try {
        var c = await api('/configuracion/campana');
        usa.comunas = c.ciudad_tiene_comunas !== 0;
        usa.barrios = c.usar_nombre_barrios !== 0;
        usa.corregimientos = c.usar_nombre_corregimientos !== 0;
        usa.veredas = c.usar_nombre_veredas !== 0;
      } catch (_) { /* si falla, se asume que los usa todos (como antes) */ }
    }

    async function cargarCatalogo() {
      if (catalogo) return;
      catalogo = await bajarCatalogoColombia();
      var dl = el('lista-departamentos');
      if (dl) {
        dl.innerHTML = catalogo.departamentos.map(function (d) {
          return '<option value="' + esc(d) + '">';
        }).join('');
      }
    }

    function municipiosDelDepartamento() {
      var depto = el('departamento') ? el('departamento').value.trim() : '';
      var municipios = (catalogo && catalogo.municipiosPorDepartamento[depto]) || [];
      var dl = el('lista-municipios');
      if (dl) {
        dl.innerHTML = municipios.map(function (m) {
          return '<option value="' + esc(m) + '">';
        }).join('');
      }
    }

    /* ------------------------------------------------- área, tipo y el padre */

    function tiposDelArea() {
      var sel = el('tipo');
      var label = el('label-nombre');
      var area = el('area') ? el('area').value : '';
      var tipos = [];
      if (area === 'urbano') {
        // Solo los tipos que la campaña sí usa (ficha «Territorio»): ofrecer
        // uno apagado crearía zonas que después ningún formulario deja elegir.
        if (usa.comunas) tipos.push(['comuna', 'Comuna']);
        if (usa.barrios) tipos.push(['barrio', 'Barrio']);
        label.textContent = usa.comunas && usa.barrios ? 'Nombre de la comuna o barrio'
          : (usa.comunas ? 'Nombre de la comuna' : 'Nombre del barrio');
        if (!tipos.length) label.textContent = 'Nombre de la zona';
        sel.innerHTML = tipos.length
          ? tipos.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('')
          : '<option value="">La campaña no usa comunas ni barrios</option>';
        sel.disabled = tipos.length === 0;
      } else if (area === 'rural') {
        if (usa.corregimientos) tipos.push(['corregimiento', 'Corregimiento']);
        if (usa.veredas) tipos.push(['vereda', 'Vereda']);
        label.textContent = usa.corregimientos && usa.veredas ? 'Nombre del corregimiento o vereda'
          : (usa.corregimientos ? 'Nombre del corregimiento' : 'Nombre de la vereda');
        if (!tipos.length) label.textContent = 'Nombre de la zona';
        sel.innerHTML = tipos.length
          ? tipos.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('')
          : '<option value="">La campaña no usa corregimientos ni veredas</option>';
        sel.disabled = tipos.length === 0;
      } else {
        sel.disabled = true;
        sel.innerHTML = '<option value="">Elige primero el área</option>';
        label.textContent = 'Nombre de la zona';
      }
      camposPadre();
    }

    /** El municipio ya creado que coincide con el Departamento + Municipio escritos. */
    function municipioActual() {
      var nd = norm(el('departamento') ? el('departamento').value : '');
      var nm = norm(el('municipio') ? el('municipio').value : '');
      if (!nd || !nm) return null;
      var depto = lista.find(function (t) { return t.tipo === 'departamento' && norm(t.nombre) === nd; });
      if (!depto) return null;
      return lista.find(function (t) {
        return t.tipo === 'municipio' && t.padre_id === depto.id && norm(t.nombre) === nm;
      }) || null;
    }

    /**
     * Muestra y llena el selector de Comuna (para un Barrio) o de
     * Corregimiento (para una Vereda). Sin elegir ninguno, la zona cuelga del
     * municipio — que es lo que significa «Sin comuna específica».
     */
    function camposPadre() {
      var tipo = el('tipo') ? el('tipo').value : '';
      mostrar('campo-comuna', false);
      mostrar('campo-corregimiento', false);
      var muni = municipioActual();
      if (tipo === 'barrio') {
        el('campo-comuna').style.display = 'block';
        var comunas = muni ? lista.filter(function (t) { return t.tipo === 'comuna' && t.padre_id === muni.id; }) : [];
        el('comuna-padre').innerHTML = '<option value="">Sin comuna específica</option>' +
          comunas.map(function (c) { return '<option value="' + c.id + '">' + esc(lugar(c.nombre)) + '</option>'; }).join('');
      } else if (tipo === 'vereda') {
        el('campo-corregimiento').style.display = 'block';
        var corr = muni ? lista.filter(function (t) { return t.tipo === 'corregimiento' && t.padre_id === muni.id; }) : [];
        el('corregimiento-padre').innerHTML = '<option value="">Sin corregimiento específico</option>' +
          corr.map(function (c) { return '<option value="' + c.id + '">' + esc(lugar(c.nombre)) + '</option>'; }).join('');
      }
    }

    /* La última ubicación usada se recuerda en ESTE navegador, con la misma
       clave que usaba el modal — quien ya la tenía no la pierde. */
    function precargarUbicacion() {
      var guardado = null;
      try { guardado = localStorage.getItem('ultimaUbicacionTerritorio'); } catch (_) { return; }
      if (!guardado) return;
      try {
        var u = JSON.parse(guardado);
        el('departamento').value = u.departamento || '';
        municipiosDelDepartamento();
        el('municipio').value = u.municipio || '';
      } catch (_) { /* ignorar */ }
    }

    /* ----------------------------------------------------------- acciones */

    async function agregar() {
      limpiarMensajes();
      var datos = {
        departamento: el('departamento').value.trim(),
        municipio: el('municipio').value.trim(),
        tipoZona: el('tipo').value,
        nombreZona: el('nombre').value.trim()
      };
      if (!datos.departamento || !datos.municipio || !datos.tipoZona || !datos.nombreZona) {
        return decir('error', 'Departamento, municipio, tipo de zona y nombre son obligatorios.');
      }
      if (datos.tipoZona === 'barrio' && el('comuna-padre').value) {
        datos.padreZonaId = el('comuna-padre').value;
      } else if (datos.tipoZona === 'vereda' && el('corregimiento-padre').value) {
        datos.padreZonaId = el('corregimiento-padre').value;
      }
      try {
        await api('/territorial/territorios/crear-zona', { method: 'POST', body: datos });
        try {
          localStorage.setItem('ultimaUbicacionTerritorio', JSON.stringify({
            departamento: datos.departamento, municipio: datos.municipio
          }));
        } catch (_) { /* navegador sin almacenamiento: no importa */ }
        await cargarLista();
        camposPadre();
        decir('ok', 'Zona agregada correctamente.');
        el('nombre').value = '';
        el('nombre').focus();
        alCambiar();
      } catch (err) {
        decir('error', err.message);
      }
    }

    async function eliminar(id) {
      if (!confirm('¿Eliminar este territorio? Esto puede afectar registros que lo usen.')) return;
      try {
        await api('/territorial/territorios/' + id, { method: 'DELETE' });
        await cargarLista();
        alCambiar();
      } catch (err) {
        aviso(err.message, 'error');
      }
    }

    async function eliminarTodos() {
      if (!confirm('¿Está seguro de eliminar TODOS los territorios? Esta acción no se puede deshacer.')) return;
      var password = await solicitarPasswordAdmin('Confirmar eliminación de territorios');
      if (!password) return;
      try {
        await api('/territorial/territorios/eliminar-todo', { method: 'POST', body: { password } });
        aviso('Todos los territorios fueron eliminados.', 'ok');
        await cargarLista();
        alCambiar();
      } catch (err) {
        aviso(err.message, 'error');
      }
    }

    /* EL RESUMEN DE LA IMPORTACIÓN, EN UNA CAJA Y NO EN UN `alert`. Un aviso
       que se cierra con un clic se lleva por delante el número de la fila que
       falló, que es justo el dato que sirve para arreglar el archivo. */
    async function importar(input) {
      var archivo = input.files[0];
      if (!archivo) return;
      var caja = el('resultado');
      caja.className = 'tg-resultado';
      caja.textContent = 'Importando…';
      caja.style.display = 'block';
      var fd = new FormData();
      fd.append('archivo', archivo);
      try {
        var r = await api('/territorial/territorios/importar-excel', { method: 'POST', body: fd });
        var html = '<div class="tg-res-titulo">Importación terminada</div><ul class="tg-res-lista">' +
          '<li><b>' + r.insertados + '</b> fila(s) procesada(s)</li>' +
          '<li><b>' + r.creados + '</b> territorio(s) nuevo(s)</li>' +
          '<li><b>' + r.reparentados + '</b> con la jerarquía corregida' +
            ' <small>(barrio o vereda que colgaba directamente del municipio)</small></li>' +
          '<li><b>' + (r.erroresTotal || 0) + '</b> fila(s) con error</li>' +
        '</ul>';
        if (r.errores && r.errores.length) {
          html += '<div class="tg-res-errores"><b>Filas con problema</b><ul>' +
            r.errores.slice(0, 20).map(function (e) {
              return '<li>Fila ' + e.fila + ': ' + esc(e.error) + '</li>';
            }).join('') + '</ul>' +
            (r.erroresTotal > 20 ? '<small>Se muestran las primeras 20 de ' + r.erroresTotal + '.</small>' : '') +
            '</div>';
        }
        caja.className = 'tg-resultado' + (r.erroresTotal ? ' tg-resultado-aviso' : ' tg-resultado-ok');
        caja.innerHTML = html;
        await cargarLista();
        camposPadre();
        alCambiar();
      } catch (err) {
        caja.className = 'tg-resultado tg-resultado-mal';
        caja.textContent = 'Error importando el archivo: ' + err.message;
      } finally {
        input.value = '';
      }
    }

    /* ------------------------------------------------------------- editar */

    function abrirEditar(id) {
      var t = lista.find(function (x) { return x.id === id; });
      if (!t) return;
      el('ed-id').value = t.id;
      el('ed-tipo').value = t.tipo.charAt(0).toUpperCase() + t.tipo.slice(1);
      el('ed-nombre').value = t.nombre;
      el('ed-error').classList.remove('visible');
      el('ed-ok').classList.remove('visible');

      var campoPadre = el('ed-campo-padre');
      if (t.tipo === 'barrio' || t.tipo === 'vereda') {
        campoPadre.style.display = 'block';
        var tipoPadre = t.tipo === 'barrio' ? 'comuna' : 'corregimiento';
        el('ed-label-padre').textContent = t.tipo === 'barrio'
          ? 'Comuna a la que pertenece' : 'Corregimiento al que pertenece';
        el('ed-padre').innerHTML = lista.filter(function (x) { return x.tipo === tipoPadre; })
          .map(function (o) {
            return '<option value="' + o.id + '"' + (o.id === t.padre_id ? ' selected' : '') + '>' +
              esc(lugar(o.nombre)) + '</option>';
          }).join('');
      } else {
        campoPadre.style.display = 'none';
      }
      overlayEditar.classList.add('abierto');
    }

    function cerrarEditar() { overlayEditar.classList.remove('abierto'); }

    async function guardarEditar(e) {
      e.preventDefault();
      var error = el('ed-error');
      var ok = el('ed-ok');
      error.classList.remove('visible');
      ok.classList.remove('visible');
      var id = el('ed-id').value;
      var datos = { nombre: el('ed-nombre').value.trim() };
      if (el('ed-campo-padre').style.display !== 'none') datos.padre_id = el('ed-padre').value;
      try {
        var r = await api('/territorial/territorios/' + id, { method: 'PUT', body: datos });
        ok.textContent = 'Territorio actualizado.' + (r.actualizadosResidencia
          ? ' Se actualizaron ' + r.actualizadosResidencia + ' persona(s) cuyo campo de residencia hacía referencia al nombre anterior.'
          : '');
        ok.classList.add('visible');
        await cargarLista();
        camposPadre();
        alCambiar();
        setTimeout(cerrarEditar, 1600);
      } catch (err) {
        error.textContent = err.message;
        error.classList.add('visible');
      }
    }

    /* ------------------------------------------------------------- cablear */

    el('departamento').addEventListener('input', function () { municipiosDelDepartamento(); camposPadre(); });
    el('municipio').addEventListener('change', camposPadre);
    el('municipio').addEventListener('input', camposPadre);
    el('area').addEventListener('change', tiposDelArea);
    el('tipo').addEventListener('change', camposPadre);
    el('agregar').addEventListener('click', agregar);
    el('eliminar-todos').addEventListener('click', eliminarTodos);
    el('importar').addEventListener('change', function (e) { importar(e.target); });
    el('buscar').addEventListener('input', renderTabla);
    el('filtro-tipo').addEventListener('change', renderTabla);

    /* ENTER NO PUEDE GUARDAR LA CAMPAÑA. Esta ficha vive DENTRO de
       `form-campana` (no se puede anidar un <form>), así que un Enter en
       cualquiera de sus campos dispararía «Guardar datos de la campaña». Se
       corta aquí y se interpreta como lo que la persona quería: agregar. */
    raiz.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      /* Los enlaces y los botones se activan con Enter y tienen que seguir
         haciéndolo: «Descargar plantilla», «Exportar», «Agregar», «Editar».
         Cortar ahí dejaría la ficha sin teclado. */
      if (e.target.closest('a, button, label')) return;
      var dentro = e.target.closest('#' + p + '-form');
      e.preventDefault();
      if (dentro && editable && mando) agregar();
    });

    /* Un solo oyente para toda la tabla: las filas se repintan en cada
       cambio y volver a cablear botón por botón es cómo se acumulan los
       oyentes duplicados. */
    el('tbody').addEventListener('click', function (e) {
      var bEditar = e.target.closest('[data-tg-editar]');
      if (bEditar) return abrirEditar(Number(bEditar.getAttribute('data-tg-editar')));
      var bBorrar = e.target.closest('[data-tg-eliminar]');
      if (bBorrar) return eliminar(Number(bBorrar.getAttribute('data-tg-eliminar')));
    });

    el('ed-cerrar').addEventListener('click', cerrarEditar);
    el('ed-form').addEventListener('submit', guardarEditar);
    overlayEditar.addEventListener('click', function (e) {
      if (e.target === overlayEditar) cerrarEditar();
    });

    /* --------------------------------------------------------------- API */

    /**
     * Primera carga. Es idempotente: llamarla dos veces no duplica nada ni
     * vuelve a pedir el catálogo (la ficha se abre y se cierra muchas veces).
     */
    async function iniciar() {
      if (iniciado) { renderTabla(); return; }
      iniciado = true;
      aplicarModo();                       // el modo cerrado, antes de pintar nada
      await cargarModo();
      await cargarFlagsCampana();
      try { await cargarCatalogo(); } catch (_) { /* sin catálogo, los datalist quedan vacíos */ }
      await cargarLista();
      tiposDelArea();
      precargarUbicacion();
      camposPadre();
    }

    return {
      iniciar: iniciar,
      recargar: cargarLista,
      /** Para las pruebas y para quien necesite saber si se puede escribir. */
      estado: function () { return { editable: editable, mando: mando, total: lista.length }; }
    };
  }

  global.crearGestionTerritorios = crearGestionTerritorios;
})(window);
