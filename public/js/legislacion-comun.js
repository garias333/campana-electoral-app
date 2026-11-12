/* Legislación: la pantalla completa (pestañas, calendario, buscador y tarjetas), compartida por
   la versión de escritorio (/legislacion.html) y la de la app del celular (/app/legislacion.html).
   Cada página solo pone su marco (barra, menú) y le dice a este módulo cómo abrir un PDF:

     Legis.montar(elemento, { abrirPdf: async (accion, norma, pagina) => { … } })

   `accion` es 'ver' o 'descargar'. En el escritorio es un enlace normal (lleva la cookie); en el
   celular es un fetch con X-Device-Token, porque un enlace no puede llevarlo (ver
   public/app/legislacion.html).

   Necesita una función global `api(ruta)` que devuelva el JSON (las dos páginas la tienen: la de
   common.js y la de api-core.js) y /css/legislacion.css. */
(function (global) {
  'use strict';

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const TIPOS = { ley: 'Ley', decreto: 'Decreto', resolucion: 'Resolución', acuerdo: 'Acuerdo', circular: 'Circular', sentencia: 'Sentencia', concepto: 'Concepto' };
  const TABS = [
    { id: 'calendario', texto: 'Calendario electoral', corto: 'Calendario' },
    { id: 'buscar', texto: 'Buscar norma', corto: 'Buscar' },
    { id: 'normas', texto: 'Leyes, decretos y resoluciones', corto: 'Normas' }
  ];

  /* ------------------------------------------------------------------ utilidades */

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** La MISMA regla que el servidor (lib/legislacionTexto.js): minúsculas, sin tildes, la ñ se queda. */
  function normalizar(texto) {
    return String(texto == null ? '' : texto).toLowerCase().replace(/ñ/g, '\u0001').normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/\u0001/g, 'ñ');
  }

  /** Normaliza carácter a carácter para que las posiciones coincidan con las del texto original. */
  function normalizarAlineado(texto) {
    let salida = '';
    for (let i = 0; i < texto.length; i++) {
      const c = normalizar(texto[i]);
      salida += c.length === 1 ? c : (texto[i].toLowerCase().charAt(0) || texto[i]);
    }
    return salida;
  }

  /** HTML ya escapado, con `<mark>` en cada aparición de los términos (sin distinguir tildes ni mayúsculas). */
  function resaltar(texto, terminos) {
    const original = String(texto == null ? '' : texto);
    const norm = normalizarAlineado(original);
    const rangos = [];
    for (const t of (terminos || [])) {
      if (!t) continue;
      let i = 0;
      // Solo donde empieza una palabra, igual que el servidor («eleccion» sí en «elecciones», no en «selección»).
      while ((i = norm.indexOf(t, i)) >= 0) {
        if (i === 0 || !/[a-zñ0-9]/.test(norm[i - 1])) rangos.push([i, i + t.length]);
        i += t.length;
      }
    }
    rangos.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const unidos = [];
    for (const r of rangos) {
      const ult = unidos[unidos.length - 1];
      if (ult && r[0] <= ult[1]) ult[1] = Math.max(ult[1], r[1]);
      else unidos.push([r[0], r[1]]);
    }
    let html = '';
    let pos = 0;
    for (const [a, b] of unidos) {
      html += esc(original.slice(pos, a)) + '<mark>' + esc(original.slice(a, b)) + '</mark>';
      pos = b;
    }
    return html + esc(original.slice(pos));
  }

  function parrafosResaltados(texto, terminos) {
    return String(texto || '').split('\n').filter((p) => p.trim()).map((p) => `<p>${resaltar(p, terminos)}</p>`).join('');
  }

  /* ---- fechas: todo se calcula con la fecha de Colombia, no la del aparato ni la del servidor ---- */

  function hoyBogota() {
    // ?hoy=AAAA-MM-DD sirve para ver cómo se vería otro día (pruebas y demostraciones).
    try {
      const forzada = new URLSearchParams(global.location.search).get('hoy');
      if (forzada && /^\d{4}-\d{2}-\d{2}$/.test(forzada)) return forzada;
    } catch (e) { /* sin ?hoy */ }
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  function partes(fecha) { const [a, m, d] = fecha.split('-').map(Number); return { a, m, d }; }
  function diasEntre(desde, hasta) {
    const f = (x) => { const p = partes(x); return Date.UTC(p.a, p.m - 1, p.d); };
    return Math.round((f(hasta) - f(desde)) / 86400000);
  }
  function fechaLarga(fecha) { const p = partes(fecha); return `${p.d} de ${MESES[p.m - 1]} de ${p.a}`; }
  function textoFecha(inicio, fin) {
    if (!fin || fin === inicio) return fechaLarga(inicio);
    const a = partes(inicio); const b = partes(fin);
    if (a.a === b.a) return `${a.d} de ${MESES[a.m - 1]} – ${b.d} de ${MESES[b.m - 1]} de ${b.a}`;
    return `${fechaLarga(inicio)} – ${fechaLarga(fin)}`;
  }

  /** cumplida / proxima. El día de la actividad cuenta como próxima («Hoy»): todavía puede estar por pasar.
      «En curso» no es de las filas sino de los PERIODOS (pareja inicio → cierre de la propia resolución);
      solo una fila con `fin` propio (formato viejo) puede estar en curso. */
  function estadoActividad(item, hoy) {
    if (item.fin && item.fin !== item.inicio) {
      if (hoy < item.inicio) return 'proxima';
      if (hoy <= item.fin) return 'en-curso';
      return 'cumplida';
    }
    return hoy < item.inicio ? 'proxima' : (hoy === item.inicio ? 'proxima' : 'cumplida');
  }

  /** Periodo en curso: su inicio ya pasó (o es hoy) y su cierre no. */
  function periodoEnCurso(p, hoy) { return p.inicio <= hoy && hoy <= p.fin; }

  /* ------------------------------------------------------------------ piezas de HTML */

  function chipEstado(item, estado, hoy) {
    if (estado === 'cumplida') return '<span class="leg-chip leg-chip-cumplida">✓ Cumplida</span>';
    if (estado === 'en-curso') {
      if (!item.fin || item.fin === item.inicio) return '<span class="leg-chip leg-chip-curso">Hoy</span>';
      const faltan = diasEntre(hoy, item.fin);
      return `<span class="leg-chip leg-chip-curso">${faltan === 0 ? 'Termina hoy' : `Termina en ${faltan} ${faltan === 1 ? 'día' : 'días'}`}</span>`;
    }
    const n = diasEntre(hoy, item.inicio);
    if (n === 0) return '<span class="leg-chip leg-chip-proxima">Hoy</span>';
    return `<span class="leg-chip leg-chip-proxima">En ${n} ${n === 1 ? 'día' : 'días'}</span>`;
  }

  function tarjetaCalendario(item, estado, hoy) {
    return `<article class="leg-cal-card ${estado}">
      ${item.grupo ? `<span class="leg-cal-grupo">${esc(item.grupo)}</span>` : ''}
      <div class="leg-cal-fecha">${esc(textoFecha(item.inicio, item.fin))} ${chipEstado(item, estado, hoy)}</div>
      <p class="leg-cal-act">${esc(item.actividad)}</p>
      ${item.plazo ? `<p class="leg-cal-plazo">${esc(item.plazo)}</p>` : ''}
      ${(item.soporte_legal || item.referencia) ? `<p class="leg-cal-ref">${item.soporte_legal ? esc(item.soporte_legal) : ''}${item.soporte_legal && item.referencia ? '<br>' : ''}${item.referencia ? esc(item.referencia) : ''}</p>` : ''}
    </article>`;
  }

  /** Tarjeta de un periodo en curso: desde … hasta …, cuánto falta y una barra de avance. */
  function tarjetaPeriodo(p, hoy) {
    const total = Math.max(1, diasEntre(p.inicio, p.fin));
    const pasados = Math.max(0, Math.min(total, diasEntre(p.inicio, hoy)));
    const pct = Math.round((100 * pasados) / total);
    const faltan = diasEntre(hoy, p.fin);
    const termina = faltan === 0 ? 'Termina hoy' : `Termina en ${faltan} ${faltan === 1 ? 'día' : 'días'}`;
    return `<article class="leg-cal-card en-curso">
      <span class="leg-cal-grupo">Periodo</span>
      <div class="leg-cal-nombre">${esc(p.nombre)}</div>
      <div class="leg-cal-fecha">Desde ${esc(fechaLarga(p.inicio))} hasta ${esc(fechaLarga(p.fin))} <span class="leg-chip leg-chip-curso">${termina}</span></div>
      <div class="leg-prog" role="progressbar" aria-label="Avance del periodo" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
      <p class="leg-prog-txt">${pct} % del periodo transcurrido (${pasados} de ${total} días)</p>
    </article>`;
  }

  function columna(clase, titulo, tarjetas, vacia) {
    return `<section class="leg-col ${clase}" data-col="${clase}">
      <button type="button" class="leg-col-cab" aria-expanded="true"><span>${esc(titulo)}</span><span class="leg-cuenta">${tarjetas.length}</span></button>
      <div class="leg-col-cuerpo">${tarjetas.length ? tarjetas.join('') : `<p class="leg-col-vacia">${esc(vacia)}</p>`}</div>
    </section>`;
  }

  /** `datos` = { filas, periodos } (o, en el formato viejo, un arreglo de filas). */
  function htmlCalendario(datos, hoy) {
    const filas = Array.isArray(datos) ? datos : (datos.filas || []);
    const periodos = Array.isArray(datos) ? [] : (datos.periodos || []);
    const grupos = { cumplida: [], 'en-curso': [], proxima: [] };
    for (const it of filas) grupos[estadoActividad(it, hoy)].push(it);
    grupos.cumplida.reverse();                                           // lo más reciente arriba
    const t = (lista, estado) => lista.map((i) => tarjetaCalendario(i, estado, hoy));
    const enCurso = periodos.filter((p) => periodoEnCurso(p, hoy)).sort((a, b) => a.fin.localeCompare(b.fin) || a.inicio.localeCompare(b.inicio))
      .map((p) => tarjetaPeriodo(p, hoy))
      .concat(t(grupos['en-curso'], 'en-curso'));
    return `<p class="leg-hoy">Hoy: ${esc(fechaLarga(hoy))} (hora de Colombia)</p>
      <div class="leg-cal">
        ${columna('leg-col-cumplidas', 'Cumplidas', t(grupos.cumplida, 'cumplida'), 'Aún no se cumple ninguna actividad.')}
        ${columna('leg-col-en-curso', 'En curso', enCurso, 'No hay ningún periodo en curso hoy.')}
        ${columna('leg-col-proximas', 'Próximas', t(grupos.proxima, 'proxima'), 'No quedan actividades por venir.')}
      </div>`;
  }

  function formatoTamano(bytes) {
    if (!bytes) return '';
    const kb = bytes / 1024;
    return kb >= 1024 ? `${(kb / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.round(kb)} KB`;
  }
  function etiquetaTipo(tipo) {
    if (!tipo) return 'Otra';
    const k = normalizar(tipo);
    return TIPOS[k] || (tipo.charAt(0).toUpperCase() + tipo.slice(1));
  }
  function claseTipo(tipo) { const k = normalizar(tipo || ''); return TIPOS[k] ? `leg-tipo-${k}` : 'leg-tipo-otro'; }

  function tarjetaNorma(n, i) {
    const meta = [n.paginas ? `${n.paginas} ${n.paginas === 1 ? 'página' : 'páginas'}` : '', formatoTamano(n.tamano_bytes)].filter(Boolean).join(' · ');
    return `<article class="leg-norma">
      <div class="leg-norma-cab"><span class="leg-tipo ${claseTipo(n.tipo)}">${esc(etiquetaTipo(n.tipo))}</span>${n.anio ? `<span class="leg-anio">${esc(n.anio)}</span>` : ''}</div>
      <h3>${esc(n.titulo)}</h3>
      ${n.descripcion ? `<p class="leg-epigrafe">${esc(n.descripcion)}</p>` : ''}
      ${meta ? `<p class="leg-meta">${esc(meta)}</p>` : ''}
      <div class="leg-acciones">
        <button type="button" class="leg-btn leg-btn-primario" data-accion="ver" data-i="${i}">Ver</button>
        <button type="button" class="leg-btn" data-accion="descargar" data-i="${i}">Descargar</button>
      </div>
    </article>`;
  }

  /* ------------------------------------------------------------------ el montaje */

  function montar(raiz, opciones) {
    const abrirPdf = opciones.abrirPdf;
    const esAncha = () => global.matchMedia('(min-width: 861px)').matches;
    const cargado = {};
    let normas = [];
    let resultados = [];
    let terminos = [];
    let seleccion = -1;

    raiz.classList.add('leg');
    raiz.innerHTML = `
      <p class="leg-aviso">Consulta siempre la versión vigente en la fuente oficial.</p>
      <div class="leg-error" id="leg-error" role="alert" hidden></div>
      <div class="leg-tabs" role="tablist" aria-label="Secciones de legislación">
        ${TABS.map((t) => `<button type="button" class="leg-tab" role="tab" id="leg-t-${t.id}" data-tab="${t.id}" aria-controls="leg-p-${t.id}" aria-label="${esc(t.texto)}" aria-selected="false" tabindex="-1"><span class="leg-tab-largo">${esc(t.texto)}</span><span class="leg-tab-corto">${esc(t.corto)}</span></button>`).join('')}
      </div>
      <section class="leg-panel" id="leg-p-calendario" role="tabpanel" aria-labelledby="leg-t-calendario" hidden></section>
      <section class="leg-panel" id="leg-p-buscar" role="tabpanel" aria-labelledby="leg-t-buscar" hidden>
        <form class="leg-form" id="leg-form" role="search">
          <input type="search" id="leg-q" name="q" placeholder="Palabra, frase o «artículo 24 ley 130»…" aria-label="Buscar dentro de las normas" autocomplete="off" maxlength="100">
          <button type="submit" class="leg-btn leg-btn-primario" id="leg-buscar-btn">Buscar</button>
        </form>
        <p class="leg-ayuda">Varias palabras: deben estar todas en el mismo artículo. También sirve «art. 24», «art 24 ley 130» o «1475 artículo 35».</p>
        <div id="leg-busq-estado"></div>
        <div class="leg-busq" id="leg-busq" hidden>
          <div class="leg-lista" id="leg-lista"></div>
          <div class="leg-panel-art" id="leg-panel-art"></div>
        </div>
      </section>
      <section class="leg-panel" id="leg-p-normas" role="tabpanel" aria-labelledby="leg-t-normas" hidden></section>
      <div class="leg-visor" id="leg-visor" role="dialog" aria-modal="true" aria-label="Artículo" hidden>
        <div class="leg-visor-barra"><button type="button" class="leg-btn" id="leg-volver">← Volver</button><span id="leg-visor-titulo"></span></div>
        <div class="leg-visor-cuerpo" id="leg-visor-cuerpo"></div>
      </div>`;

    const $ = (id) => raiz.querySelector('#' + id);
    const pCal = $('leg-p-calendario'); const pBus = $('leg-p-buscar'); const pNor = $('leg-p-normas');
    const cajaError = $('leg-error');

    function mostrarError(mensaje) {
      cajaError.textContent = mensaje || 'No se pudo completar la acción.';
      cajaError.hidden = false;
      if (global.scrollTo) global.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function limpiarError() { cajaError.hidden = true; }

    async function conPdf(accion, norma, pagina, boton) {
      limpiarError();
      const texto = boton ? boton.textContent : '';
      if (boton) { boton.disabled = true; boton.textContent = 'Abriendo…'; }
      try { await abrirPdf(accion, norma, pagina); } catch (err) { mostrarError(err && err.message); }
      finally { if (boton) { boton.disabled = false; boton.textContent = texto; } }
    }

    /* ---------- pestañas ---------- */
    function tabDeLaUrl() {
      const t = new URLSearchParams(global.location.search).get('tab');
      return TABS.some((x) => x.id === t) ? t : 'calendario';
    }
    function irA(id) {
      limpiarError();
      raiz.querySelectorAll('.leg-tab').forEach((b) => {
        const activa = b.dataset.tab === id;
        b.setAttribute('aria-selected', activa ? 'true' : 'false');
        b.tabIndex = activa ? 0 : -1;
      });
      pCal.hidden = id !== 'calendario'; pBus.hidden = id !== 'buscar'; pNor.hidden = id !== 'normas';
      try {
        const u = new URL(global.location.href);
        u.searchParams.set('tab', id);
        if (id !== 'buscar') u.searchParams.delete('q');
        global.history.replaceState(global.history.state, '', u);
      } catch (e) { /* sin historial */ }
      if (id === 'calendario') cargarCalendario();
      if (id === 'normas') cargarNormas();
      // En el celular no se enfoca solo: abriría el teclado al cambiar de pestaña.
      if (id === 'buscar' && esAncha()) $('leg-q').focus({ preventScroll: true });
    }
    raiz.querySelector('.leg-tabs').addEventListener('click', (ev) => {
      const b = ev.target.closest('.leg-tab');
      if (b) irA(b.dataset.tab);
    });
    raiz.querySelector('.leg-tabs').addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      const ids = TABS.map((t) => t.id);
      const actual = ids.findIndex((id) => $('leg-t-' + id).getAttribute('aria-selected') === 'true');
      const sig = (actual + (ev.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
      irA(ids[sig]);
      $('leg-t-' + ids[sig]).focus();
    });

    /* ---------- calendario ---------- */
    async function cargarCalendario() {
      if (cargado.calendario) return;
      pCal.innerHTML = '<p class="leg-cargando">Cargando el calendario…</p>';
      try {
        const datos = await global.api('/legislacion/calendario');
        if (!datos) return;
        cargado.calendario = true;
        const hayFilas = Array.isArray(datos) ? datos.length : (datos.filas || []).length;
        if (!hayFilas) { pCal.innerHTML = '<p class="leg-vacio">Aún no se ha cargado el calendario electoral.</p>'; return; }
        pCal.innerHTML = htmlCalendario(datos, hoyBogota());
        // En el celular, lo cumplido arranca plegado.
        const cumplidas = pCal.querySelector('.leg-col-cumplidas');
        if (cumplidas && !esAncha()) { cumplidas.classList.add('plegada'); cumplidas.querySelector('.leg-col-cab').setAttribute('aria-expanded', 'false'); }
      } catch (err) {
        pCal.innerHTML = '';
        mostrarError(err.esErrorDeRed ? 'Se necesita conexión a internet para ver el calendario.' : err.message);
      }
    }
    pCal.addEventListener('click', (ev) => {
      const cab = ev.target.closest('.leg-col-cab');
      if (!cab || esAncha()) return;
      const col = cab.parentElement;
      if (!col.classList.contains('leg-col-cumplidas')) return;
      const plegada = col.classList.toggle('plegada');
      cab.setAttribute('aria-expanded', plegada ? 'false' : 'true');
    });

    /* ---------- buscar ---------- */
    function htmlPanelArticulo(r) {
      const meta = [`Página ${r.pagina}`, r.seccion].filter(Boolean).join(' · ');
      return `<div class="leg-art-norma">${esc(r.norma)}</div>
        <h3 class="leg-art-titulo">${esc(r.articulo)}${r.titulo_articulo ? ' — ' + esc(r.titulo_articulo) : ''}</h3>
        <p class="leg-art-meta">${esc(meta)}</p>
        <div class="leg-art-acciones">
          <button type="button" class="leg-btn leg-btn-primario" data-accion-art="pdf">Ver en el PDF</button>
          <button type="button" class="leg-btn" data-accion-art="copiar">Copiar texto</button>
        </div>
        <p class="leg-art-pagina">Está en la página ${esc(r.pagina)}</p>
        <div class="leg-art-texto">${parrafosResaltados(r.texto, terminos)}</div>`;
    }

    function seleccionar(i, abrirVisor) {
      seleccion = i;
      raiz.querySelectorAll('.leg-res').forEach((b, k) => b.setAttribute('aria-current', k === i ? 'true' : 'false'));
      const r = resultados[i];
      if (!r) return;
      const html = htmlPanelArticulo(r);
      if (esAncha()) { $('leg-panel-art').innerHTML = html; return; }
      if (abrirVisor) {
        $('leg-visor-titulo').textContent = `${r.articulo} · ${r.norma}`;
        $('leg-visor-cuerpo').innerHTML = html;
        $('leg-visor').hidden = false;
        $('leg-visor').scrollTop = 0;
        global.document.body.classList.add('leg-sin-scroll');
        global.history.pushState({ legVisor: true }, '');
      }
    }
    function cerrarVisor() {
      $('leg-visor').hidden = true;
      global.document.body.classList.remove('leg-sin-scroll');
    }
    $('leg-volver').addEventListener('click', () => {
      if (global.history.state && global.history.state.legVisor) global.history.back();
      else cerrarVisor();
    });
    global.addEventListener('popstate', () => { if (!$('leg-visor').hidden) cerrarVisor(); });

    async function accionArticulo(ev) {
      const b = ev.target.closest('[data-accion-art]');
      if (!b || seleccion < 0) return;
      const r = resultados[seleccion];
      if (b.dataset.accionArt === 'copiar') {
        const texto = `${r.norma} — ${r.articulo}\n\n${r.texto}`;
        try {
          if (global.navigator.clipboard && global.navigator.clipboard.writeText) await global.navigator.clipboard.writeText(texto);
          else {
            const t = global.document.createElement('textarea');
            t.value = texto; t.style.position = 'fixed'; t.style.opacity = '0';
            global.document.body.appendChild(t); t.select(); global.document.execCommand('copy'); t.remove();
          }
          const original = b.textContent; b.textContent = '¡Copiado!';
          setTimeout(() => { b.textContent = original; }, 1500);
        } catch (e) { mostrarError('No se pudo copiar el texto en este navegador.'); }
      } else {
        const norma = normas.find((n) => n.archivo === r.archivo) || { archivo: r.archivo, titulo: r.norma };
        conPdf('ver', norma, r.pagina, b);
      }
    }
    $('leg-panel-art').addEventListener('click', accionArticulo);
    $('leg-visor-cuerpo').addEventListener('click', accionArticulo);

    $('leg-lista').addEventListener('click', (ev) => {
      const b = ev.target.closest('.leg-res');
      if (b) seleccionar(Number(b.dataset.i), true);
    });

    async function buscar(q) {
      limpiarError();
      const texto = q.trim();
      const estado = $('leg-busq-estado');
      if (texto.length < 2 || texto.length > 100) {
        estado.innerHTML = '<p class="leg-vacio">Escribe entre 2 y 100 caracteres para buscar.</p>';
        $('leg-busq').hidden = true;
        return;
      }
      try {
        const u = new URL(global.location.href); u.searchParams.set('tab', 'buscar'); u.searchParams.set('q', texto);
        global.history.replaceState(global.history.state, '', u);
      } catch (e) { /* sin historial */ }
      const boton = $('leg-buscar-btn');
      boton.disabled = true;
      estado.innerHTML = '<p class="leg-cargando">Buscando… la primera búsqueda puede tardar unos segundos mientras se prepara el índice.</p>';
      $('leg-busq').hidden = true;
      try {
        const r = await global.api('/legislacion/buscar?q=' + encodeURIComponent(texto));
        if (!r) return;
        resultados = r.resultados; terminos = r.terminos || [];
        let nota = '';
        if (r.omitidas && r.omitidas.length) {
          nota = `<p class="leg-nota-omitidas">Sin buscar en ${r.omitidas.length} documento(s): ${r.omitidas.map((o) => `${esc(o.titulo)} (${esc(o.motivo)})`).join('; ')}.</p>`;
        }
        if (!resultados.length) {
          estado.innerHTML = nota + `<p class="leg-vacio">Ningún artículo coincide con «${esc(texto)}».</p>`;
          return;
        }
        estado.innerHTML = nota + `<p class="leg-resumen">${r.total} ${r.total === 1 ? 'resultado' : 'resultados'}${r.total > r.mostrados ? ` (se muestran los ${r.mostrados} más relevantes)` : ''}.</p>`;
        $('leg-lista').innerHTML = resultados.map((x, i) => `<button type="button" class="leg-res" data-i="${i}" aria-current="false">
            <div class="leg-res-norma">${esc(x.norma)}</div>
            <div class="leg-res-art">${esc(x.articulo)}${x.titulo_articulo ? ' — ' + esc(x.titulo_articulo) : ''} <span class="leg-res-pag">· pág. ${esc(x.pagina)}</span></div>
            <div class="leg-res-frag">${resaltar(x.fragmento, terminos)}</div>
          </button>`).join('');
        $('leg-busq').hidden = false;
        $('leg-panel-art').innerHTML = '';
        if (esAncha()) seleccionar(0, false);
      } catch (err) {
        estado.innerHTML = '';
        mostrarError(err.esErrorDeRed ? 'Se necesita conexión a internet para buscar.' : err.message);
      } finally {
        boton.disabled = false;
      }
    }
    $('leg-form').addEventListener('submit', (ev) => { ev.preventDefault(); buscar($('leg-q').value); });

    /* ---------- leyes, decretos y resoluciones ---------- */
    function pintarNormas() {
      const q = normalizar($('leg-f-q').value).trim();
      const tipo = $('leg-f-tipo').value;
      const visibles = normas.map((n, i) => ({ n, i })).filter(({ n }) => {
        if (tipo && (n.tipo || '__otro') !== tipo) return false;
        if (!q) return true;
        const pajar = normalizar([n.titulo, n.descripcion, n.numero, n.anio, etiquetaTipo(n.tipo)].join(' '));
        return q.split(/\s+/).every((p) => pajar.includes(p));
      });
      $('leg-f-cuenta').textContent = visibles.length === normas.length
        ? `${normas.length} ${normas.length === 1 ? 'norma' : 'normas'}` : `${visibles.length} de ${normas.length} normas`;
      $('leg-grid').innerHTML = visibles.length
        ? visibles.map(({ n, i }) => tarjetaNorma(n, i)).join('')
        : '<p class="leg-vacio" style="grid-column:1/-1">Ninguna norma coincide con la búsqueda.</p>';
    }

    async function cargarNormas() {
      if (cargado.normas) return;
      pNor.innerHTML = '<p class="leg-cargando">Cargando las normas…</p>';
      try {
        normas = (await global.api('/legislacion')) || [];
        cargado.normas = true;
        if (!normas.length) { pNor.innerHTML = '<p class="leg-vacio">Aún no se han cargado normas.</p>'; return; }
        const tipos = [...new Set(normas.map((n) => n.tipo || '__otro'))].sort((a, b) => etiquetaTipo(a === '__otro' ? '' : a).localeCompare(etiquetaTipo(b === '__otro' ? '' : b), 'es'));
        pNor.innerHTML = `<div class="leg-filtros">
            <input type="search" id="leg-f-q" placeholder="Filtrar por nombre, número o año…" aria-label="Filtrar normas" autocomplete="off">
            <select id="leg-f-tipo" aria-label="Filtrar por tipo"><option value="">Todos los tipos</option>${tipos.map((t) => `<option value="${esc(t)}">${esc(etiquetaTipo(t === '__otro' ? '' : t))}</option>`).join('')}</select>
          </div>
          <p class="leg-resumen" id="leg-f-cuenta"></p>
          <div class="leg-grid" id="leg-grid"></div>`;
        $('leg-f-q').addEventListener('input', pintarNormas);
        $('leg-f-tipo').addEventListener('change', pintarNormas);
        $('leg-grid').addEventListener('click', (ev) => {
          const b = ev.target.closest('button[data-accion]');
          if (b) conPdf(b.dataset.accion, normas[Number(b.dataset.i)], null, b);
        });
        pintarNormas();
      } catch (err) {
        pNor.innerHTML = '';
        mostrarError(err.esErrorDeRed ? 'Se necesita conexión a internet para ver las normas.' : err.message);
      }
    }

    /* ---------- arranque ---------- */
    const q0 = new URLSearchParams(global.location.search).get('q');
    irA(tabDeLaUrl());
    if (q0 && tabDeLaUrl() === 'buscar') { $('leg-q').value = q0; buscar(q0); }
  }

  global.Legis = { montar, normalizar, resaltar, estadoActividad, periodoEnCurso, hoyBogota, textoFecha, diasEntre, htmlCalendario };
})(window);
