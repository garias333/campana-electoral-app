/* LA ZONA EN LOS FORMULARIOS DE CAMPO (parche 307). La usan «Registrar una solicitud» y «Aplicar una encuesta».
   Requiere /js/api-core.js y /js/offline-utils.js (obtenerConCacheReferencia).

   LA DEGRADACIÓN la decide el servidor (lib/zonas.js) y es la misma de Tareas:
     nivel 'zona' ....... hay barrios, veredas, comunas o corregimientos: se elige de la lista
     nivel 'municipio' .. no hay ninguno de esos pero sí municipios: se elige el municipio
     nivel 'texto' ...... no hay catálogo: la zona se escribe a mano
   La lista se guarda en este celular (caché de referencia) para elegir la zona SIN SEÑAL. Sin lista y sin señal el nivel cae a 'texto' y
   `sinLista` avisa a la pantalla: lo que se escriba a mano lo rechazará el servidor si la campaña sí tiene catálogo. */

const ZONAS_CLAVE_CACHE = 'zonas_campo';

/** { nivel, zonas: [{id,nombre,tipo,padre}], truncada, sinLista? } de la red o, sin señal, de la última copia. */
async function cargarZonasDeCampo(ruta) {
  try {
    const r = await obtenerConCacheReferencia(ZONAS_CLAVE_CACHE, () => api(ruta));
    if (r && Array.isArray(r.zonas)) return r;
  } catch (_) { /* sin señal y sin copia */ }
  return { nivel: 'texto', zonas: [], truncada: false, sinLista: true };
}

/** El texto de la etiqueta según el nivel. */
function etiquetaDeZona(nivel) {
  if (nivel === 'zona') return 'Barrio, vereda o zona';
  if (nivel === 'municipio') return 'Municipio';
  return 'Barrio o vereda (escríbelo)';
}

/**
 * Arma el campo con su lista de sugerencias y devuelve { elegida(), texto(), nivel }.
 *  · `elegida()` es la zona de la lista que coincide con lo escrito, o null;
 *  · dos zonas con el mismo nombre en municipios distintos se distinguen con su padre («La Esperanza · Chinchiná»).
 */
function armarSelectorDeZona({ input, datalist, lista }) {
  const cuenta = {};
  lista.zonas.forEach((z) => { const k = z.nombre.toLowerCase(); cuenta[k] = (cuenta[k] || 0) + 1; });
  const porEtiqueta = new Map();
  datalist.innerHTML = '';
  lista.zonas.forEach((z) => {
    const etiqueta = cuenta[z.nombre.toLowerCase()] > 1 ? `${z.nombre} · ${z.padre || z.tipo}` : z.nombre;
    const k = etiqueta.toLowerCase().trim();
    if (porEtiqueta.has(k)) return;
    porEtiqueta.set(k, z);
    const o = document.createElement('option');
    o.value = etiqueta;
    datalist.appendChild(o);
  });
  return {
    nivel: lista.nivel,
    elegida() { return porEtiqueta.get(input.value.trim().toLowerCase()) || null; },
    texto() { return input.value.trim(); },
  };
}
