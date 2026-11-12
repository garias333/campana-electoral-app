/**
 * Selector de Mesa disponible al crear/editar un Testigo electoral (una
 * sola mesa) o un Coordinador de puesto (varias) — usado en testigos.html,
 * territorial.html y votantes.html. Consulta /dia-d/mesas-ocupadas, que
 * calcula qué mesas del puesto ya tiene tomadas OTRO testigo, a partir de
 * la cantidad de mesas configurada en Configuración → Día D → Puestos de
 * votación.
 */

/** Consulta cuáles mesas de un puesto quedan libres (excluyendo, al editar, el propio registro). */
async function consultarMesasDisponibles(puesto, excluirEstructuraId) {
  if (!puesto) return { cantidadMesas: 0, mesasOcupadas: [], mesasDisponibles: [] };
  const params = new URLSearchParams({ puesto });
  if (excluirEstructuraId) params.set('excluir_estructura_id', excluirEstructuraId);
  try {
    return await api(`/dia-d/mesas-ocupadas?${params.toString()}`);
  } catch (err) {
    return { cantidadMesas: 0, mesasOcupadas: [], mesasDisponibles: [] };
  }
}

/** Arma el <select> de Mesa (Testigo electoral, una sola) con las disponibles + la que ya tenía asignada, si se está editando. */
function poblarSelectMesaTestigo(selectEl, disponibilidad, mesaActual) {
  const mesas = new Set(disponibilidad.mesasDisponibles || []);
  if (mesaActual) mesas.add(Number(mesaActual));
  const lista = [...mesas].sort((a, b) => a - b);
  if (!lista.length) {
    selectEl.innerHTML = '<option value="">No hay mesas disponibles en este puesto</option>';
    return;
  }
  selectEl.innerHTML = '<option value="">Selecciona...</option>' +
    lista.map(m => `<option value="${m}">${m}</option>`).join('');
  if (mesaActual) selectEl.value = String(mesaActual);
}

/** Arma las casillas de Mesa (Coordinador de puesto, varias) con las disponibles + las que ya tenía marcadas. */
function poblarCasillasMesasTestigo(contenedorEl, disponibilidad, mesasActuales) {
  const actuales = new Set((mesasActuales || []).map(Number));
  const mesas = new Set([...(disponibilidad.mesasDisponibles || []), ...actuales]);
  const lista = [...mesas].sort((a, b) => a - b);
  if (!lista.length) {
    contenedorEl.innerHTML = '<span style="color:var(--color-text-muted); font-size:0.82rem;">No hay mesas disponibles en este puesto.</span>';
    return;
  }
  contenedorEl.innerHTML = lista.map(m => `
    <label style="display:inline-flex; align-items:center; gap:4px; margin:2px 12px 2px 0; font-weight:400;">
      <input type="checkbox" value="${m}" ${actuales.has(m) ? 'checked' : ''} style="width:auto;"> ${m}
    </label>
  `).join('');
}

/** Números de mesa marcados en un contenedor de casillas de Coordinador de puesto. */
function leerMesasMarcadas(contenedorEl) {
  return Array.from(contenedorEl.querySelectorAll('input[type="checkbox"]:checked')).map(c => Number(c.value));
}
