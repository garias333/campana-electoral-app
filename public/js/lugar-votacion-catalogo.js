/* global api */
/**
 * Lugar de Votación leído del Catálogo Territorial (CTC).
 *
 * EL PROBLEMA QUE RESUELVE
 *   El desplegable de Puesto se llenaba con `/dia-d/puestos-para-reporte`,
 *   que devuelve los puestos de `dia_d_puestos_votacion` — los que la
 *   campaña va a CUBRIR CON TESTIGOS. Eso es otra cosa que DÓNDE VOTA una
 *   persona.
 *
 *   Se veía así: en una campaña de ámbito Caldas, al elegir Antioquia /
 *   Puerto Berrío el desplegable seguía mostrando los 332 puestos de
 *   Caldas. Un líder que vote fuera del ámbito no se podía registrar.
 *
 *   Ahora la cascada es: Departamento -> Municipio -> Puesto -> Mesa,
 *   con los 33 departamentos, 1.122 municipios y 12.885 puestos del país.
 *
 * DONDE APLICA, Y DONDE NO
 *   Solo en `territorial.html` (sufijo «persona») y `votantes.html`
 *   (sufijo «votante»), donde el Lugar de Votación es dónde vota la
 *   persona.
 *
 *   `testigos.html` queda FUERA a propósito: allí el puesto es el de la
 *   campaña —es donde esa persona va a ser testigo— y debe seguir
 *   saliendo de `dia_d_puestos_votacion`. Cambiarlo rompería el cálculo
 *   de mesas disponibles y dejaría asignar un testigo a un puesto que la
 *   campaña no cubre.
 *
 * EL CASO DEL TESTIGO, DENTRO DE ESTAS DOS PANTALLAS
 *   Ya no hay caso especial. Antes los dos desplegables —el de «Lugar de
 *   Votación» y el del panel de testigo— compartían valor, así que este
 *   módulo tenía que devolver la lista de la campaña cuando se marcaba
 *   «Es también testigo electoral», para que el valor existiera en ambos.
 *
 *   Hoy son datos independientes: dónde vota la persona (catálogo, este
 *   módulo) y dónde vigila (puestos de la campaña, el panel de testigo,
 *   que arma su propia lista). Una persona puede votar en un puesto y ser
 *   testigo en otro, así que este módulo usa SIEMPRE el catálogo.
 *
 * LAS MESAS NO SE CONSULTAN
 *   Medido sobre los 12.885 puestos activos del catálogo: la numeración
 *   es siempre 1..N, sin huecos ni saltos, y `total_mesas` coincide
 *   exactamente con el conteo real en los 12.885. Cero excepciones. El
 *   límite de Mesa sale de ese número, sin una consulta más.
 *
 * NO SE PIERDE LO GUARDADO
 *   Al editar a alguien registrado antes de este cambio, su puesto puede
 *   no estar en la lista del catálogo (nombre viejo, truncado o de otro
 *   municipio). En ese caso se agrega igual como opción, marcado, en vez
 *   de dejar el campo en blanco: perder en silencio un dato ya guardado
 *   es peor que mostrarlo raro.
 */
(function () {
  'use strict';

  // Las dos pantallas donde el Lugar de Votación es «dónde vota».
  const PANTALLAS = ['persona', 'votante'];

  function $(id) { return document.getElementById(id); }

  function escapar(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Campos de una pantalla. Devuelve null si esta página no la tiene. */
  function campos(suf) {
    const depto  = $(`input-departamento-votacion-${suf}`);
    const muni   = $(`input-municipio-votacion-${suf}`);
    const puesto = $(`input-puesto-votacion-${suf}`);
    if (!depto || !muni || !puesto) return null;
    return {
      suf, depto, muni, puesto,
      listaDepto: $(`lista-departamentos-votacion-${suf}`),
      listaMuni:  $(`lista-municipios-votacion-${suf}`),
      mesa:       $(`input-mesa-votacion-${suf}`),
      contador:   $(`contador-mesas-${suf}`)
    };
  }

  // Estado por pantalla: los catálogos ya traídos y para qué municipio se
  // armó la lista de puestos que está en pantalla.
  const estado = {};

  function edo(suf) {
    if (!estado[suf]) {
      estado[suf] = { departamentos: null, municipios: [], puestos: [], municipioDeLaLista: null };
    }
    return estado[suf];
  }

  // --- Consultas al servidor, cada una cacheada lo que tiene sentido ---

  let departamentosPromesa = null;
  function traerDepartamentos() {
    // Los 33 departamentos no cambian: una sola vez por carga de página.
    if (!departamentosPromesa) departamentosPromesa = api('/catalogo/departamentos');
    return departamentosPromesa;
  }

  const municipiosPorDepto = new Map();
  function traerMunicipios(departamentoId) {
    if (!municipiosPorDepto.has(departamentoId)) {
      municipiosPorDepto.set(departamentoId, api(`/catalogo/municipios?departamento_id=${departamentoId}`));
    }
    return municipiosPorDepto.get(departamentoId);
  }

  const puestosPorMuni = new Map();
  function traerPuestos(municipioId) {
    if (!puestosPorMuni.has(municipioId)) {
      puestosPorMuni.set(municipioId, api(`/catalogo/puestos?municipio_id=${municipioId}`));
    }
    return puestosPorMuni.get(municipioId);
  }

  // --- Pintar ----------------------------------------------------------

  function pintarDatalist(el, nombres) {
    if (!el) return;
    el.innerHTML = nombres.map(n => `<option value="${escapar(n)}">`).join('');
  }

  /**
   * Llena el <select> de Puesto conservando lo que ya estuviera elegido.
   * `extra` es el valor guardado que no aparece en la lista: se agrega al
   * final en vez de perderse.
   */
  function pintarPuestos(c, lista, valorPrevio, aviso) {
    const opciones = ['<option value="">' + escapar(aviso || 'Selecciona...') + '</option>'];
    let encontrado = false;
    for (const p of lista) {
      const nombre = typeof p === 'string' ? p : p.nombre;
      if (nombre === valorPrevio) encontrado = true;
      opciones.push(`<option value="${escapar(nombre)}">${escapar(nombre)}</option>`);
    }
    if (valorPrevio && !encontrado) {
      opciones.push(`<option value="${escapar(valorPrevio)}">${escapar(valorPrevio)} — guardado antes</option>`);
    }
    c.puesto.innerHTML = opciones.join('');
    if (valorPrevio) c.puesto.value = valorPrevio;
  }

  /** Busca sin distinguir mayúsculas ni tildes, igual que la base. */
  function normalizar(t) {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  }

  function buscarPorNombre(lista, nombre) {
    const n = normalizar(nombre);
    if (!n) return null;
    return lista.find(x => normalizar(x.nombre) === n) || null;
  }

  // --- La cascada ------------------------------------------------------

  async function cargarDepartamentos(c) {
    const e = edo(c.suf);
    if (e.departamentos) return e.departamentos;
    try {
      e.departamentos = await traerDepartamentos();
      pintarDatalist(c.listaDepto, e.departamentos.map(d => d.nombre));
    } catch (err) {
      // Si el catálogo no responde, NO se vacía el datalist: se deja el
      // que ya puso colombia.json. Peor que una lista imperfecta es una
      // lista vacía sin explicación.
      console.warn('[lugar-votacion] no se pudieron cargar los departamentos:', err.message);
      e.departamentos = [];
    }
    return e.departamentos;
  }

  async function alCambiarDepartamento(c) {
    const e = edo(c.suf);
    await cargarDepartamentos(c);
    const d = buscarPorNombre(e.departamentos, c.depto.value);
    if (!d) { e.municipios = []; return; }
    try {
      e.municipios = await traerMunicipios(d.id);
      pintarDatalist(c.listaMuni, e.municipios.map(m => m.nombre));
    } catch (err) {
      console.warn('[lugar-votacion] municipios:', err.message);
      e.municipios = [];
    }
  }

  /** Arma la lista de Puestos del catálogo según el municipio escrito. */
  async function actualizarPuestos(c, forzar) {
    const e = edo(c.suf);
    const valorPrevio = c.puesto.value;

    const nombreMuni = c.muni.value.trim();
    if (!nombreMuni) {
      pintarPuestos(c, [], valorPrevio, 'Elige primero el municipio…');
      e.municipioDeLaLista = null;
      actualizarLimiteMesa(c);
      return;
    }
    if (e.municipioDeLaLista === normalizar(nombreMuni) && !forzar) return;

    // El municipio se busca dentro del departamento ya escrito: a nivel
    // nacional los nombres se repiten —«EL CARMEN» está en Chocó y en
    // Santander— y sin acotar se metería a la persona en otro lado.
    if (!e.municipios.length) await alCambiarDepartamento(c);
    let m = buscarPorNombre(e.municipios, nombreMuni);

    // Si no cruzó (registro viejo, nombre escrito distinto), se le
    // pregunta a la base, cuya colación ignora mayúsculas y tildes.
    if (!m && c.depto.value.trim()) {
      try {
        const r = await api('/catalogo/resolver?departamento=' +
          encodeURIComponent(c.depto.value.trim()) + '&municipio=' + encodeURIComponent(nombreMuni));
        if (r && r.municipio) m = r.municipio;
      } catch (err) { /* se maneja abajo */ }
    }

    if (!m) {
      pintarPuestos(c, [], valorPrevio, 'No se reconoce ese municipio');
      e.municipioDeLaLista = null;
      actualizarLimiteMesa(c);
      return;
    }

    try {
      e.puestos = await traerPuestos(m.id);
      pintarPuestos(c, e.puestos, valorPrevio,
        e.puestos.length ? 'Selecciona…' : 'Este municipio no tiene puestos registrados');
      e.municipioDeLaLista = normalizar(nombreMuni);
    } catch (err) {
      console.warn('[lugar-votacion] puestos:', err.message);
      pintarPuestos(c, [], valorPrevio, 'No se pudo consultar el catálogo');
    }
    actualizarLimiteMesa(c);
  }

  // --- Mesa ------------------------------------------------------------

  /**
   * Cuántas mesas tiene el puesto elegido, según el catálogo.
   * Devuelve 0 si no se sabe (puesto de la campaña, o no cruzó).
   */
  function mesasDelPuesto(suf) {
    const c = campos(suf);
    if (!c) return 0;
    const e = edo(suf);
    const p = (e.puestos || []).find(x => x.nombre === c.puesto.value);
    return p ? Number(p.total_mesas) || 0 : 0;
  }

  function actualizarLimiteMesa(c) {
    if (!c.mesa) return;
    const total = mesasDelPuesto(c.suf);
    if (total) {
      c.mesa.max = String(total);
      if (Number(c.mesa.value) > total) c.mesa.value = String(total);
      if (c.contador) c.contador.textContent = `Este puesto tiene ${total} mesa(s).`;
    } else {
      c.mesa.removeAttribute('max');
    }
  }

  /**
   * La usa el código del formulario en lugar de `consultarMesasDisponibles`,
   * que consulta `dia_d_puestos_votacion` y no sabe nada de los puestos del
   * catálogo. Este Lugar de Votación siempre viene del catálogo, así que el
   * total de mesas también.
   */
  window.mesasDelPuestoDeVotacion = async function (suf, nombrePuesto) {
    const c = campos(suf);
    if (!c) return 0;
    return mesasDelPuesto(suf);
  };

  // --- Enganche --------------------------------------------------------

  function enganchar(suf) {
    const c = campos(suf);
    if (!c) return;

    cargarDepartamentos(c);

    // El formulario también llena este datalist desde /data/colombia.json,
    // y quien termine último gana — es una carrera entre dos peticiones.
    // Al enfocar se repinta con los nombres del CATALOGO, que es la única
    // forma determinista de que el usuario elija un nombre que sí cruza.
    //
    // Importa: colombia.json dice «Bogotá D.C.» y el catálogo «Bogotá,
    // D.C.» (con coma), y al Archipiélago lo llama de otra manera. Con el
    // nombre de colombia.json el municipio no cruza y la lista de puestos
    // queda vacía, sin decir por qué.
    c.depto.addEventListener('focus', () => {
      const e = edo(c.suf);
      if (e.departamentos && e.departamentos.length) {
        pintarDatalist(c.listaDepto, e.departamentos.map(d => d.nombre));
      }
    });

    c.depto.addEventListener('change', () => { alCambiarDepartamento(c); });
    c.depto.addEventListener('blur',   () => { alCambiarDepartamento(c); });

    c.muni.addEventListener('change', () => { actualizarPuestos(c); });
    c.muni.addEventListener('blur',   () => { actualizarPuestos(c); });

    // El formulario también fija estos campos por código al editar o al
    // limpiar, y asignar `.value` NO dispara ningún evento. Por eso se
    // revisa también al enfocar el desplegable de Puesto: si el municipio
    // cambió desde que se armó la lista, se rearma.
    c.puesto.addEventListener('focus', () => { actualizarPuestos(c); });
    c.puesto.addEventListener('mousedown', () => { actualizarPuestos(c); });
    c.puesto.addEventListener('change', () => { actualizarLimiteMesa(c); });

    if (c.mesa) {
      c.mesa.addEventListener('input', () => {
        const total = mesasDelPuesto(suf);
        if (total && Number(c.mesa.value) > total) c.mesa.value = String(total);
      });
    }
  }

  function iniciar() { PANTALLAS.forEach(enganchar); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
