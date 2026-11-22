/* ==========================================================================
   js/estructura-vistas.js — ORDEN 105: las cinco vistas nuevas de «Estructura territorial» (ESCRITORIO).

   Tarjetas · Por rol · Ranking · Explorador · Pendientes. «Lista» es la de siempre y la pinta
   `renderizarEstructura()` en territorial.html; este archivo no la toca.

   LAS MISMAS PERSONAS QUE LA LISTA. No pide nada al servidor ni filtra por su cuenta: `renderizarEstructura()` le entrega
   `filas` YA filtradas (búsqueda, cargo, área, zona, territorio, municipio, autorización y «Ver equipo»), que es lo que
   la persona está viendo en la lista, sin ordenar ni plegar. Las reglas de zona, meta, avance y lugar de votación llegan
   por `ctx` desde las mismas funciones que usa la ficha de la lista — nada se recalcula aquí con otra fórmula.

   QUÉ SE CALCULA SOBRE TODA LA ESTRUCTURA Y QUÉ SOBRE LO FILTRADO. «Su equipo», «equipo N», «Personas a cargo» y
   «Sin equipo todavía» miran la estructura completa que ya cargó la pantalla (`ctx.todas()`): que alguien tenga equipo
   no depende de que el filtro de la lista lo esconda. Lo que se LISTA en cada vista sale del filtro.

   ORDEN 112 — LA MISMA INFORMACIÓN QUE LA LISTA. Cada persona se pinta con las piezas que arma `ctx.partes(f)` (territorial.html:
   `partesFichaEstructura`, la misma función de la que sale la ficha de la Lista): número de orden, correo·sexo, WhatsApp, autorización,
   chips, territorio, «Le reporta a», «X de Y» con su leyenda y Σ, estado, Editar y Eliminar. Aquí solo se decide DÓNDE va cada pieza.

   Los TESTIGOS no entran en ninguna vista (ORDEN 111): tienen su propia pantalla, como en la Lista.

   WHATSAPP: el botón verde con el número es el de la Lista (`pildoraWhatsApp`, territorial.html) en las cinco vistas.

   Colores del avance: «Por rol», «Explorador» y «Pendientes» usan rojo < 25 %, ámbar 25–59 %, verde ≥ 60 %. «Tarjetas» y «Ranking»
   (ORDEN 107) pintan todo avance en azul y marcan a quien va bajo 25 % solo con un punto rojo de 8 px junto al %.
   La cifra es la de la lista (incluye a su equipo, la del Σ).
   ========================================================================== */
(function (global) {
  'use strict';

  const VISTAS = ['lista', 'tarjetas', 'rol', 'ranking', 'explorador', 'pendientes'];

  // Colores de marca por rol (fondo = el tono suave para fichas y avatares).
  const COLOR_ROL = {
    coordinador: { c: '#0B5ED7', bg: '#E4EEFC' },
    lider:       { c: '#084298', bg: '#DCE6F6' },
    sublider:    { c: '#8a5a00', bg: '#fff4d1' },
    testigo:     { c: '#2e7d32', bg: '#e6f4e7' },
  };
  const ROJO = '#C62828', AMBAR = '#B26A00', VERDE = '#2e7d32', GRIS = '#6B7482';

  let ctx = null;
  let vista = 'lista';
  let rankingFiltro = 'todos';
  let seleccion = null;               // usuario_id de la persona abierta en el Explorador
  const plegados = new Set();         // usuario_id plegados en el árbol del Explorador
  let ultimo = { filas: [] };
  let hijosPorJefe = new Map();       // usuario_id del jefe -> filas de toda la estructura
  let ramaForzada = null;             // ORDEN 109: usuario_id cuya rama se muestra COMPLETA en el árbol aunque un filtro de la lista la esconda
  let enfocarSeleccion = false;       // ORDEN 109: tras llegar con un clic, llevar la vista al nodo elegido

  /* ---------- utilidades ---------- */
  const esc = (t) => ctx.escapar(t == null ? '' : String(t));
  const millares = (n) => ctx.millares(n);
  const claveVista = () => 'estrategia_estructura_vista_' + (ctx && ctx.usuarioId != null ? ctx.usuarioId : '0');

  function leerVista() {
    try { const v = global.localStorage.getItem(claveVista()); return VISTAS.includes(v) ? v : 'lista'; } catch (e) { return 'lista'; }
  }
  function guardarVista(v) { try { global.localStorage.setItem(claveVista(), v); } catch (e) { /* sin almacenamiento: queda en esta sesión */ } }

  /** Coordinadores (de territorio y organizaciones) | líderes (y aspirantes al Concejo) | sublíderes | testigos. */
  function grupoDe(categoria) {
    if (categoria === 'coordinador' || categoria === 'coordinador_organizaciones') return 'coordinador';
    if (categoria === 'lider' || categoria === 'aspirante_concejo') return 'lider';
    if (categoria === 'usuario') return 'sublider';
    if (categoria === 'testigo') return 'testigo';
    return 'sublider';
  }
  const ETIQUETA_CORTA = {
    coordinador: 'Coordinador', coordinador_organizaciones: 'Coord. organizaciones', aspirante_concejo: 'Aspirante al Concejo',
    lider: 'Líder', usuario: 'Sublíder', testigo: 'Testigo',
  };

  function semaforo(pctReal) {
    if (pctReal == null) return GRIS;
    if (pctReal < 25) return ROJO;
    if (pctReal < 60) return AMBAR;
    return VERDE;
  }
  const pctTexto = (pctReal) => (pctReal == null ? '—' : Math.round(pctReal) + ' %');
  /* ORDEN 109 — TAMAÑO DEL EQUIPO. UNA SOLA CUENTA para Tarjetas, Por rol y Explorador: los DIRECTOS de la persona sobre TODA la estructura
     cargada, que es lo que la lista dice en «Reportan a X · N personas» (la lista cuenta a los que le reportan directamente, no a toda la rama).
     Los testigos no suman: no están en la lista de la estructura. */
  const textoPersonas = (n) => `${millares(n)} persona${n === 1 ? '' : 's'}`;
  const muestraEquipo = (i) => i.grupo === 'coordinador' || i.grupo === 'lider' || i.equipo > 0;
  function descendientesDe(usuarioId) {
    const salida = [], vistos = new Set([usuarioId]), cola = [usuarioId];
    while (cola.length) {
      for (const h of hijosPorJefe.get(cola.pop()) || []) {
        if (vistos.has(h.usuario_id)) continue;
        vistos.add(h.usuario_id); salida.push(h); cola.push(h.usuario_id);
      }
    }
    return salida;
  }

  /** Todo lo que las vistas dicen de una persona, leído con las reglas de la lista. */
  function info(f) {
    const categoria = ctx.categoria(f);
    const t = ctx.territorio(f);
    const a = ctx.avance(f);
    const grupo = grupoDe(categoria);
    let lugar = t.hojaTexto || t.zonaTexto || '';
    if (!lugar && categoria === 'testigo') lugar = f.puesto_votacion || '';
    return {
      f, categoria, grupo, color: COLOR_ROL[grupo],
      etiqueta: ETIQUETA_CORTA[categoria] || f.cargo,
      area: t.areaValor, zona: t.zonaTexto, hoja: t.hojaTexto, lugar,
      meta: a.meta, registros: a.registros, pct: a.pct, pctReal: a.pctReal,
      equipo: (hijosPorJefe.get(f.usuario_id) || []).length,
    };
  }

  const inicial = (f) => esc((f.nombre || '?').trim().charAt(0).toUpperCase());
  const P = (f) => ctx.partes(f);
  // Nombre que lleva al Explorador, con el aspecto y el tamaño del nombre de la Lista (`.nombre-p`).
  const nombreEnlace = (f, extra) => `<button type="button" class="ev-nombre-enlace nombre-p ${extra || ''}" data-accion="explorar" data-uid="${f.usuario_id}">${esc(f.nombre)}</button>`;
  const lineaNombre = (f, p, extra) => `<div class="linea-nombre">${p.numero}${nombreEnlace(f, extra)}</div>`;
  const textoRolLugar = (i) => `${esc(i.etiqueta)}${i.lugar ? ' · ' + esc(i.lugar) : ''}`;
  // «X de Y» de la Lista + el porcentaje con el color de la vista.
  const cifraPct = (i, p, conColor) => `<div class="ev-cifra-pct">${p.cifra}${i.meta > 0 ? `<b class="ev-pct-txt"${conColor ? ` style="color:${semaforo(i.pctReal)}"` : ''}>${Math.round(i.pctReal)} %</b>` : ''}</div>`;
  const avatar = (i, extra) => `<span class="ev-av ${extra || ''}" style="background:${i.color.c}" aria-hidden="true">${inicial(i.f)}</span>`;
  const chipRol = (i) => `<span class="ev-chip" style="color:${i.color.c};background:${i.color.bg}">${esc(i.etiqueta)}</span>`;
  const chipArea = (i) => (i.area ? `<span class="ev-chip ev-chip-${i.area}">${i.area === 'urbano' ? 'URBANO' : 'RURAL'}</span>` : '');
  const chipOrg = (i) => (!i.area && /Organización/.test(i.zona || '') ? '<span class="ev-chip ev-chip-org">ORGANIZACIÓN</span>' : '');

  /* ---------- ORDEN 107: color de rol y avance de «Tarjetas» y «Ranking» ----------
     Coordinador azul, Líder azul oscuro, Sublíder amarillo (texto oscuro), cualquier otro rol (aspirante, coord. de organizaciones,
     testigo…) gris azulado. Las otras vistas siguen con COLOR_ROL. */
  const ROL_NUEVO = {
    coordinador: { c: '#0B5ED7', t: '#fff' },
    lider:       { c: '#084298', t: '#fff' },
    usuario:     { c: '#FFC300', t: '#3d2c00' },
  };
  const ROL_OTROS = { c: '#5b6b86', t: '#fff' };
  const colorRol = (i) => ROL_NUEVO[i.categoria] || ROL_OTROS;
  const estiloRol = (i) => { const r = colorRol(i); return `background:${r.c};color:${r.t}`; };
  const TEXTO_BAJO = 'Menos del 25 % de su meta';
  const puntoBajo = (i) => (i.meta > 0 && i.pctReal < 25 ? `<i class="ev-punto-rojo" title="${TEXTO_BAJO}"></i>` : '');
  const avatarNuevo = (i) => `<span class="ev-av-n" style="${estiloRol(i)}" aria-hidden="true">${inicial(i.f)}</span>`;

  function textoJefe(i) {
    const f = i.f;
    if (f.supervisor_nombre) return `Reporta a <b>${esc(f.supervisor_nombre)}</b>`;
    if (i.grupo === 'coordinador') return 'Cabeza de su rama';
    if (i.grupo === 'testigo') return f.puesto_votacion ? 'Puesto: ' + esc(f.puesto_votacion) : 'Testigo electoral';
    return '<span class="ev-sin-jefe">Sin quién lo coordine</span>';
  }

  function barra(i, grosor) {
    if (!(i.meta > 0)) return `<div class="ev-sin-meta">Sin meta asignada</div>`;
    return `<div class="ev-barra ${grosor || ''}"><i style="width:${i.pct.toFixed(1)}%;background:${semaforo(i.pctReal)}"></i></div>`;
  }

  /* ---------- Tarjetas · «Avatar con anillo» (ORDEN 107; ORDEN 112: todos los datos de la Lista dentro de la tarjeta) ---------- */
  function htmlTarjetas(filas) {
    if (!filas.length) return vacio();
    const ordenadas = filas.map(info).sort(porCategoriaYNombre);
    return `<div class="ev-grid-tarjetas">${ordenadas.map((i) => {
      const p = P(i.f);
      const conMeta = i.meta > 0;
      const grados = conMeta ? (Math.min(100, Math.max(0, i.pct)) * 3.6).toFixed(1) : 0;
      const pastilla = conMeta ? `${puntoBajo(i)}${Math.round(i.pctReal)}%` : 'sin meta';
      return `
      <article class="ev-tarjeta" data-uid="${i.f.usuario_id}">
        <div class="ev-anillo-av${conMeta ? '' : ' ev-anillo-av-vacio'}" style="--g:${grados}deg">
          ${avatarNuevo(i)}
          <span class="ev-pastilla">${pastilla}</span>
        </div>
        ${lineaNombre(i.f, p, 'ev-nombre')}
        ${p.correo}
        ${p.chips}
        <div class="ev-bloque-territorio">${p.territorio}${p.avisoVotacion}</div>
        ${p.reportaA}
        <div class="ev-cifras3">
          <div><b>${millares(i.registros)}</b><span>Registros</span></div>
          <div><b>${conMeta ? millares(i.meta) : '—'}</b><span>Meta</span></div>
          <div><b>${millares(i.equipo)}</b><span>Equipo</span></div>
        </div>
        ${p.pie}
        <div class="ev-contacto">${p.whatsapp}${p.autorizacion}</div>
        <div class="ev-estado">${p.estado}${p.excluido}</div>
        <div class="ev-acciones">${p.editar}${p.eliminar}${p.quitar}<button type="button" class="ev-btn ev-btn-equipo" data-accion="equipo" data-uid="${i.f.usuario_id}">Ver equipo</button></div>
      </article>`;
    }).join('')}</div>`;
  }

  const PESO = { coordinador: 0, coordinador_organizaciones: 1, aspirante_concejo: 2, lider: 3, usuario: 4, testigo: 5 };
  function porCategoriaYNombre(a, b) {
    const pa = PESO[a.categoria] ?? 9, pb = PESO[b.categoria] ?? 9;
    return pa !== pb ? pa - pb : (a.f.nombre || '').localeCompare(b.f.nombre || '', 'es');
  }

  /* ---------- Por rol ---------- */
  const COLUMNAS = [
    { grupo: 'coordinador', titulo: 'Coordinadores', agregar: 'coordinador', rotulo: '+ Agregar coordinador' },
    { grupo: 'lider', titulo: 'Líderes', agregar: 'lider', rotulo: '+ Agregar líder' },
    { grupo: 'sublider', titulo: 'Sublíderes', agregar: 'usuario', rotulo: '+ Agregar sublíder' },
  ];
  function htmlPorRol(filas) {
    const todos = filas.map(info);
    return `<div class="ev-columnas">${COLUMNAS.map((col) => {
      const gente = todos.filter((i) => i.grupo === col.grupo).sort(porCategoriaYNombre);
      let pie = '';
      if (ctx.puedeAgregar(col.agregar)) {
        pie = `<button type="button" class="ev-agregar" data-accion="agregar" data-cat="${col.agregar}">${col.rotulo}</button>`;
      }
      const c = COLOR_ROL[col.grupo];
      return `
      <section class="ev-columna">
        <header class="ev-columna-cab" style="background:${c.c}"><span>${col.titulo}</span><span class="ev-contador">${gente.length}</span></header>
        <div class="ev-columna-cuerpo">
          ${gente.map((i) => {
            const p = P(i.f);
            return `
          <div class="ev-mini" style="--rol:${c.c}" data-uid="${i.f.usuario_id}">
            ${avatar(i)}
            <div class="ev-mini-texto">
              ${lineaNombre(i.f, p)}
              ${p.correo}
              ${p.chips}
              <div class="ev-bloque-territorio">${p.territorio}${p.avisoVotacion}</div>
              ${p.reportaA}
              ${muestraEquipo(i) ? `<span class="ev-sub ev-equipo-linea">👥 Equipo: <b>${textoPersonas(i.equipo)}</b></span>` : ''}
              <div class="avance-p">${cifraPct(i, p, true)}${i.meta > 0 ? barra(i) : ''}${p.pie}</div>
              <div class="ev-contacto">${p.whatsapp}${p.autorizacion}</div>
              <div class="ev-estado">${p.estado}${p.excluido}</div>
              <div class="ev-mini-acciones">${p.editar}${p.eliminar}${p.quitar}<button type="button" class="ev-btn-mini" data-accion="equipo" data-uid="${i.f.usuario_id}">Ver equipo</button></div>
            </div>
          </div>`;
          }).join('') || '<div class="ev-columna-vacia">Nadie en esta columna.</div>'}
        </div>
        ${pie ? `<div class="ev-columna-pie">${pie}</div>` : ''}
      </section>`;
    }).join('')}</div>`;
  }

  /* ---------- Ranking · «Podio» (ORDEN 107) ---------- */
  const FICHAS_RANKING = [['todos', 'Todos'], ['coordinador', 'Coordinadores'], ['lider', 'Líderes'], ['sublider', 'Sublíderes']];
  const quienSub = (i) => textoRolLugar(i);

  function htmlPodio(tres) {
    // Orden visual 2-1-3; con menos de tres se muestran los que haya.
    const orden = [1, 0, 2].filter((k) => tres[k]);
    return `<div class="ev-podio ev-podio-${tres.length}">${orden.map((k) => {
      const i = tres[k];
      const p = P(i.f);
      return `
      <div class="ev-pod ev-pod-${k + 1}" data-uid="${i.f.usuario_id}">
        <span class="ev-medalla">${k + 1}</span>
        <span class="ev-av-n ev-av-pod" style="${estiloRol(i)}" aria-hidden="true">${inicial(i.f)}</span>
        ${lineaNombre(i.f, p, 'ev-pod-nombre')}
        ${p.correo}
        ${p.chips}
        <div class="ev-bloque-territorio">${p.territorio}${p.avisoVotacion}</div>
        ${p.reportaA}
        <div class="ev-pod-pct">${puntoBajo(i)}${Math.round(i.pctReal)}%</div>
        <div class="avance-p">${p.cifra}${p.pie}</div>
        <div class="ev-contacto">${p.whatsapp}${p.autorizacion}</div>
        <div class="ev-estado">${p.estado}${p.excluido}</div>
        <div class="ev-acciones">${p.editar}${p.eliminar}${p.quitar}</div>
      </div>`;
    }).join('')}</div>`;
  }

  /* Fila de 2 líneas. Línea 1: posición, avatar, número+nombre, chips y territorio, barra con «X de Y», %, WhatsApp.
     Línea 2 (más pequeña): correo · sexo · autorización · «Le reporta a» · leyenda · Activo · Editar/Eliminar. */
  function htmlRanking(filas) {
    const todos = filas.map(info);
    const enFicha = todos.filter((i) => rankingFiltro === 'todos' || i.grupo === rankingFiltro);
    const conMeta = enFicha.filter((i) => i.meta > 0)
      .sort((a, b) => (b.pctReal - a.pctReal) || (b.registros - a.registros) || (a.f.nombre || '').localeCompare(b.f.nombre || '', 'es'));
    const sinMeta = enFicha.filter((i) => !(i.meta > 0)).sort(porCategoriaYNombre);
    const resto = conMeta.slice(3);
    return `
      <div class="ev-fichas-filtro" role="group" aria-label="Quiénes entran al ranking">
        ${FICHAS_RANKING.map(([k, t]) => `<button type="button" class="${rankingFiltro === k ? 'activa' : ''}" data-accion="ranking-filtro" data-valor="${k}">${t}</button>`).join('')}
      </div>
      ${conMeta.length ? htmlPodio(conMeta.slice(0, 3)) : ''}
      ${resto.length ? `<ol class="ev-ranking">${resto.map((i, n) => {
        const p = P(i.f);
        return `
        <li class="ev-fila-ranking" data-uid="${i.f.usuario_id}">
          <div class="ev-rk-1">
            <span class="ev-puesto">${n + 4}</span>
            ${avatarNuevo(i)}
            <div class="ev-rk-quien">${lineaNombre(i.f, p)}</div>
            <div class="ev-rk-lugar">${p.chips}${p.territorio}${p.avisoVotacion}</div>
            <div class="ev-rk-barra-caja"><div class="ev-rk-barra"><i style="width:${Math.max(2, Math.min(100, i.pct)).toFixed(1)}%"></i></div>${p.cifra}</div>
            <span class="ev-pct-grande">${puntoBajo(i)}${Math.round(i.pctReal)}%</span>
            ${p.whatsapp}
          </div>
          <div class="ev-rk-2">${p.correo}${p.autorizacion}${p.reportaA}${p.pie}${p.estado}${p.excluido}${p.acciones}</div>
        </li>`;
      }).join('')}</ol>` : ''}
      ${!conMeta.length && !sinMeta.length ? '<div class="ev-vacio">Nadie en esta selección.</div>' : ''}
      ${sinMeta.length ? `<div class="ev-franja-sin-meta"><b>Sin meta asignada (${sinMeta.length}):</b> ${sinMeta.map((i) => esc(i.f.nombre)).join(', ')}. Asígneles meta para que entren al ranking.</div>` : ''}`;
  }

  /* ---------- Explorador ---------- */
  function armarArbol(filas) {
    const ids = new Set(filas.map((f) => f.usuario_id));
    const hijos = new Map();
    filas.forEach((f) => {
      if (f.supervisor_id && ids.has(f.supervisor_id)) {
        if (!hijos.has(f.supervisor_id)) hijos.set(f.supervisor_id, []);
        hijos.get(f.supervisor_id).push(f);
      }
    });
    const orden = (a, b) => {
      const pa = PESO[ctx.categoria(a)] ?? 9, pb = PESO[ctx.categoria(b)] ?? 9;
      return pa !== pb ? pa - pb : (a.nombre || '').localeCompare(b.nombre || '', 'es');
    };
    hijos.forEach((l) => l.sort(orden));
    const raices = filas.filter((f) => !f.supervisor_id || !ids.has(f.supervisor_id)).sort(orden);
    const vistos = new Set();
    const planas = [];
    const bajar = (f, nivel) => {
      if (vistos.has(f.id)) return;
      vistos.add(f.id);
      const hs = hijos.get(f.usuario_id) || [];
      planas.push({ f, nivel, tieneHijos: hs.length > 0 });
      if (plegados.has(f.usuario_id)) return;
      hs.forEach((h) => bajar(h, nivel + 1));
    };
    raices.forEach((r) => bajar(r, 0));
    // Un ciclo (A reporta a B y B a A) deja gente sin visitar: se muestra suelta en vez de perderla.
    filas.forEach((f) => { if (!vistos.has(f.id) && !plegados.size) planas.push({ f, nivel: 0, tieneHijos: false }); });
    return { raices, planas };
  }

  function lugarVotacionTexto(f) {
    const partes = [f.departamento_votacion, f.municipio_votacion, f.puesto_votacion].filter((x) => x && String(x).trim());
    let t = partes.map(esc).join(' · ');
    if (f.mesa_votacion && String(f.mesa_votacion).trim()) t += (t ? ' · ' : '') + 'Mesa ' + esc(f.mesa_votacion);
    return t;
  }

  function htmlFicha(f) {
    const i = info(f);
    const p = P(f);
    const equipo = (hijosPorJefe.get(f.usuario_id) || []).slice()
      .sort((a, b) => (PESO[ctx.categoria(a)] ?? 9) - (PESO[ctx.categoria(b)] ?? 9) || (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    const catEquipo = ctx.categoriaDelEquipo(i.categoria);
    const puedeAgregar = catEquipo && ctx.puedeAgregar(catEquipo);
    const col = semaforo(i.pctReal);
    const lugarV = lugarVotacionTexto(f);
    return `
      <div class="ev-ficha-cab">
        ${avatar(i, 'ev-av-grande')}
        <div class="ev-ficha-id">
          <div class="linea-nombre">${p.numero}<h3 class="nombre-p">${esc(f.nombre)}</h3></div>
          ${p.chips}
          <div class="ev-bloque-territorio">${p.territorio}${p.avisoVotacion}</div>
          ${p.reportaA}
        </div>
        <div class="ev-ficha-botones">${p.editar}${p.eliminar}${p.quitar}${puedeAgregar ? `<button type="button" class="btn-principal-fichas" data-accion="agregar" data-cat="${catEquipo}" data-sup="${f.usuario_id}">+ Agregar</button>` : ''}</div>
      </div>
      <div class="ev-datos">
        <div class="ev-dato"><span>Correo · sexo</span>${p.correo}</div>
        <div class="ev-dato"><span>WhatsApp</span>${p.whatsapp || '<span class="dato-min">Sin teléfono</span>'}</div>
        <div class="ev-dato"><span>Autorización de datos</span>${p.autorizacion}</div>
        <div class="ev-dato"><span>Estado</span><div class="ev-estado">${p.estado}${p.excluido}</div></div>
        <div class="ev-dato"><span>Lugar de votación</span><b>${lugarV || '—'}</b>${ctx.tieneLugarVotacion(f) ? '' : ' <span class="ev-alerta">Incompleto</span>'}</div>
      </div>
      <div class="ev-avance-ficha avance-p">
        ${p.cifra}${i.meta > 0 ? barra(i) : ''}${p.pie}
      </div>
      <div class="ev-indicadores">
        <div class="ev-ind"><span>Registros del equipo</span><b>${millares(i.registros)}</b></div>
        <div class="ev-ind"><span>Meta del equipo</span><b>${i.meta > 0 ? millares(i.meta) : '—'}</b></div>
        <div class="ev-ind"><span>Avance</span><b style="color:${col}">${pctTexto(i.pctReal)}</b></div>
        <div class="ev-ind"><span>Personas a cargo</span><b>${millares(i.equipo)}</b></div>
      </div>
      <h4 class="ev-subtitulo">Su equipo</h4>
      ${equipo.length ? `<ul class="ev-equipo">${equipo.map((h) => {
        const hi = info(h);
        const hp = P(h);
        return `<li data-uid="${h.usuario_id}">${avatar(hi)}
          <div class="ev-eq-quien">${lineaNombre(h, hp, 'ev-eq-nombre').replace('data-accion="explorar"', 'data-accion="seleccionar"')}<span class="ev-sub">${textoRolLugar(hi)}</span></div>
          <div class="ev-eq-estado">${hp.estado}</div>
          <div class="ev-eq-avance">${cifraPct(hi, hp, true)}${hi.meta > 0 ? barra(hi) : ''}</div>
          <div class="ev-eq-wa">${hp.whatsapp}</div>
        </li>`;
      }).join('')}</ul>` : `<div class="ev-vacio-chico ev-sin-equipo">Aún no tiene equipo.${puedeAgregar ? ` <button type="button" class="btn-principal-fichas" data-accion="agregar" data-cat="${catEquipo}" data-sup="${f.usuario_id}">+ Agregar</button>` : ''}</div>`}`;
  }

  function htmlExplorador(filas) {
    if (!filas.length) return vacio();
    const todas = ctx.todas();
    /* ORDEN 109: al llegar con un clic (Por rol, Ranking, Pendientes) el árbol lleva SIEMPRE la rama completa de esa persona, aunque un
       filtro de la lista (búsqueda, cargo, zona…) esconda a su gente: si no, se veía a la persona sola, sin equipo. */
    let base = filas;
    if (ramaForzada != null) {
      const ya = new Set(filas.map((f) => f.id));
      const raiz = todas.find((f) => f.usuario_id === ramaForzada);
      const extra = (raiz ? [raiz] : []).concat(descendientesDe(ramaForzada)).filter((f) => !ya.has(f.id));
      if (extra.length) base = filas.concat(extra);
    }
    const { raices, planas } = armarArbol(base);
    /* La ficha es la de alguien que SE VE en el árbol. Con «Ver equipo» o un filtro, la persona elegida antes puede haber quedado fuera de la
       lista: mostrar su ficha con un árbol que no la trae era mostrar a otra persona sin explicación. En ese caso se abre la cabeza del árbol. */
    const visibles = new Set(base.map((f) => f.usuario_id));
    let elegida = seleccion != null && visibles.has(seleccion) ? todas.find((f) => f.usuario_id === seleccion) : null;
    if (!elegida) elegida = raices[0] || base[0];
    seleccion = elegida.usuario_id;
    const arbol = planas.map(({ f, nivel, tieneHijos }) => {
      const i = info(f);
      const plegado = plegados.has(f.usuario_id);
      return `<div class="ev-nodo${f.usuario_id === seleccion ? ' sel' : ''}" style="padding-left:${8 + nivel * 18}px">
        ${tieneHijos
          ? `<button type="button" class="ev-triangulo" data-accion="plegar" data-uid="${f.usuario_id}" aria-expanded="${plegado ? 'false' : 'true'}" aria-label="${plegado ? 'Mostrar' : 'Ocultar'} el equipo de ${esc(f.nombre)}">${plegado ? '▸' : '▾'}</button>`
          : '<span class="ev-triangulo-hueco"></span>'}
        <button type="button" class="ev-nodo-btn" data-accion="seleccionar" data-uid="${f.usuario_id}">
          ${avatar(i, 'ev-av-chico')}<span class="ev-nodo-nombre">${esc(f.nombre)}</span>${i.equipo > 0 ? `<span class="ev-nodo-n" title="Personas a cargo">(${millares(i.equipo)})</span>` : ''}
          <span class="ev-nodo-pct" style="color:${semaforo(i.pctReal)}">${i.meta > 0 ? Math.round(i.pctReal) + '%' : ''}</span>
        </button>
      </div>`;
    }).join('');
    return `<div class="ev-explorador">
      <aside class="ev-arbol" id="ev-arbol" aria-label="Estructura">${arbol}</aside>
      <section class="ev-ficha" id="ev-ficha">${htmlFicha(elegida)}</section>
    </div>`;
  }

  /* ---------- Pendientes ---------- */
  function htmlPendientes(filas) {
    if (!filas.length) return vacio();
    const gente = filas.map(info).sort(porCategoriaYNombre);
    const autorizado = (i) => ['firmada', 'verbal'].includes(i.f.autorizacion_estado || 'sin');
    const puedeEditar = ctx.puedeEditar();
    const botonEditar = (i, texto) => (puedeEditar ? `<button type="button" class="btn-neutro" data-accion="editar" data-id="${i.f.id}">${texto}</button>` : '');

    const grupos = [
      {
        clave: 'sin-equipo', tono: 'rojo', titulo: 'Sin equipo todavía',
        texto: 'Coordinadores y líderes que todavía no tienen a nadie a cargo.',
        lista: gente.filter((i) => ['coordinador', 'coordinador_organizaciones', 'aspirante_concejo', 'lider'].includes(i.categoria) && i.equipo === 0),
        detalle: () => '',
        accion: (i) => {
          const cat = ctx.categoriaDelEquipo(i.categoria);
          return cat && ctx.puedeAgregar(cat)
            ? `<button type="button" class="btn-neutro" data-accion="agregar" data-cat="${cat}" data-sup="${i.f.usuario_id}">Agregar equipo</button>` : '';
        },
      },
      {
        clave: 'sin-autorizacion', tono: 'ambar', titulo: 'Sin autorización de datos',
        texto: 'No firmaron la autorización: no hay ninguna, está pendiente o su enlace venció. El envío por WhatsApp está en su ficha.',
        lista: gente.filter((i) => !autorizado(i)),
        detalle: (i) => ({ sin: 'Sin autorización', pendiente: 'Pendiente de firma', vencida: 'Enlace vencido' }[i.f.autorizacion_estado || 'sin'] || ''),
        accion: (i) => botonEditar(i, 'Ver'),
      },
      {
        clave: 'sin-lugar', tono: 'ambar', titulo: 'Falta lugar de votación',
        texto: 'Les falta Departamento, Municipio, Puesto o Mesa.',
        lista: gente.filter((i) => !ctx.tieneLugarVotacion(i.f)),
        detalle: () => '',
        accion: (i) => botonEditar(i, 'Completar'),
      },
      {
        clave: 'avance-bajo', tono: 'rojo', titulo: 'Avance bajo (menos de 25 %)',
        texto: 'Tienen meta y van por debajo de la cuarta parte.',
        lista: gente.filter((i) => i.meta > 0 && i.pctReal < 25),
        detalle: (i) => `${millares(i.registros)} de ${millares(i.meta)} · ${Math.round(i.pctReal)} %`,
        accion: (i) => `<button type="button" class="btn-neutro" data-accion="explorar" data-uid="${i.f.usuario_id}">Ver detalle</button>`,
      },
      {
        clave: 'al-dia', tono: 'verde', titulo: 'Al día',
        texto: 'Autorización firmada, lugar de votación completo, meta asignada y avance de 50 % o más.',
        lista: gente.filter((i) => autorizado(i) && ctx.tieneLugarVotacion(i.f) && i.meta > 0 && i.pctReal >= 50),
        detalle: (i) => `${Math.round(i.pctReal)} %`,
        accion: () => '',
      },
    ];
    return `<div class="ev-grid-pendientes">${grupos.map((g) => `
      <section class="ev-pend ev-pend-${g.tono}" data-grupo="${g.clave}">
        <header><h4>${g.titulo}</h4><span class="ev-contador">${g.lista.length}</span></header>
        <p class="ev-pend-texto">${g.texto}</p>
        <ul class="ev-pend-lista">
          ${g.lista.map((i) => {
            const p = P(i.f);
            const det = g.detalle(i);
            return `<li data-uid="${i.f.usuario_id}">
            <div class="ev-pd-1">
              ${avatar(i, 'ev-av-chico')}
              <div class="ev-pend-quien">${lineaNombre(i.f, p)}${det ? `<span class="ev-sub">${esc(det)}</span>` : ''}</div>
              <div class="ev-rk-lugar">${p.chips}${p.territorio}${p.avisoVotacion}</div>
              <div class="ev-pd-accion">${g.accion(i)}</div>
              ${p.whatsapp}
            </div>
            <div class="ev-pd-2">${p.correo}${p.autorizacion}${p.reportaA}${p.cifra}${p.pie}${p.estado}${p.excluido}${p.acciones}</div>
          </li>`;
          }).join('') || '<li class="ev-pend-nadie">Nadie en este grupo.</li>'}
        </ul>
      </section>`).join('')}</div>`;
  }

  function vacio() { return '<div class="ev-vacio">No hay personas que coincidan con los filtros.</div>'; }

  /* ---------- pintar y eventos ---------- */
  function contenedor() { return document.getElementById('vistas-estructura'); }

  function pintar(datos) {
    if (!ctx || vista === 'lista') return;
    ultimo = datos;
    hijosPorJefe = new Map();
    ctx.todas().forEach((f) => {
      if (!f.supervisor_id) return;
      if (!hijosPorJefe.has(f.supervisor_id)) hijosPorJefe.set(f.supervisor_id, []);
      hijosPorJefe.get(f.supervisor_id).push(f);
    });
    const caja = contenedor();
    const antes = document.getElementById('ev-arbol');
    const scrollArbol = antes ? antes.scrollTop : 0;
    let html = '';
    if (vista === 'tarjetas') html = htmlTarjetas(datos.filas);
    else if (vista === 'rol') html = datos.filas.length ? htmlPorRol(datos.filas) : vacio();
    else if (vista === 'ranking') html = datos.filas.length ? htmlRanking(datos.filas) : vacio();
    else if (vista === 'explorador') html = htmlExplorador(datos.filas);
    else if (vista === 'pendientes') html = htmlPendientes(datos.filas);
    caja.innerHTML = html;
    caja.dataset.vista = vista;
    const arbol = document.getElementById('ev-arbol');
    if (arbol) arbol.scrollTop = scrollArbol;
    if (enfocarSeleccion) {
      enfocarSeleccion = false;
      const nodo = arbol && arbol.querySelector('.ev-nodo.sel');
      if (nodo) arbol.scrollTop = Math.max(0, nodo.offsetTop - arbol.offsetTop - 40);
      const r = caja.getBoundingClientRect();
      if (r.top < 0 || r.top > 300) global.scrollBy(0, r.top - 90);
    }
  }

  function marcarBotones() {
    document.querySelectorAll('#selector-vistas-estructura button').forEach((b) => {
      const activa = b.dataset.vista === vista;
      b.classList.toggle('activa', activa);
      b.setAttribute('aria-pressed', activa ? 'true' : 'false');
    });
    const tarjeta = document.getElementById('card-estructura');
    if (tarjeta) tarjeta.dataset.vista = vista;
  }

  function cambiarVista(v, persistir) {
    if (!VISTAS.includes(v) || (ctx.soloLista && v !== 'lista')) v = 'lista';
    vista = v;
    if (persistir) { guardarVista(v); ramaForzada = null; }
    marcarBotones();
    ctx.repintar();
  }

  function irAlExplorador(usuarioId) {
    seleccion = usuarioId;
    ramaForzada = usuarioId;
    enfocarSeleccion = true;
    // Su rama se abre entera: ella y todo lo que cuelga de ella.
    plegados.delete(usuarioId);
    descendientesDe(usuarioId).forEach((h) => plegados.delete(h.usuario_id));
    // Si la persona tiene el árbol plegado por encima, se abre el camino hasta ella.
    let f = ctx.todas().find((x) => x.usuario_id === usuarioId);
    const visitados = new Set();
    while (f && f.supervisor_id && !visitados.has(f.id)) {
      visitados.add(f.id);
      plegados.delete(f.supervisor_id);
      f = ctx.todas().find((x) => x.usuario_id === f.supervisor_id);
    }
    cambiarVista('explorador', false);
  }

  function alHacerClic(e) {
    const el = e.target.closest('[data-accion]');
    if (!el || !contenedor().contains(el)) return;
    const accion = el.dataset.accion;
    const uid = el.dataset.uid ? Number(el.dataset.uid) : null;
    if (accion === 'editar') ctx.editar(Number(el.dataset.id));
    else if (accion === 'equipo') { seleccion = uid; ctx.verEquipo(uid); }   // ORDEN 109: el Explorador abre con la cabeza de esa rama
    else if (accion === 'explorar') irAlExplorador(uid);
    else if (accion === 'agregar') ctx.agregar(el.dataset.cat, el.dataset.sup ? Number(el.dataset.sup) : null);
    else if (accion === 'ranking-filtro') { rankingFiltro = el.dataset.valor; ctx.repintar(); }
    else if (accion === 'seleccionar') { seleccion = uid; ctx.repintar(); }
    else if (accion === 'plegar') {
      if (plegados.has(uid)) plegados.delete(uid); else plegados.add(uid);
      ctx.repintar();
    }
  }

  function iniciar(contexto) {
    ctx = contexto;
    contenedor().addEventListener('click', alHacerClic);
    document.querySelectorAll('#selector-vistas-estructura button').forEach((b) => {
      b.addEventListener('click', () => cambiarVista(b.dataset.vista, true));
    });
    vista = ctx.soloLista ? 'lista' : leerVista();
    marcarBotones();
  }

  global.EstructuraVistas = { iniciar, pintar, vista: () => vista, irAlExplorador, cambiarVista };
})(window);
