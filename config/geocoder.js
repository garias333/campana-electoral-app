/**
 * Geocodificación de direcciones colombianas usando Google Geocoding API
 * (https://developers.google.com/maps/documentation/geocoding).
 *
 * Se cambió de LocationIQ (basado en datos de OpenStreetMap) a Google
 * porque la cobertura de direcciones de OpenStreetMap en Colombia es
 * más floja que la de Google, lo que causaba ubicaciones inexactas o
 * sin encontrar. Google tiene mejor cobertura de direcciones reales en
 * el país, a cambio de un costo por consulta más alto (con todo,
 * dentro del uso normal de esta aplicación, el crédito gratuito
 * mensual de Google ($200 USD) debería cubrir el volumen sin problema
 * — revisa el consumo real en Google Cloud Console de vez en cuando).
 *
 * Requiere la variable de entorno GOOGLE_MAPS_API_KEY en el .env — una
 * API Key de Google Cloud con la "Geocoding API" activada (ver
 * console.cloud.google.com → APIs & Services).
 *
 * Se mantiene exactamente la misma forma de llamar a estas dos
 * funciones que tenía la versión de LocationIQ (mismos nombres,
 * mismos parámetros, mismo formato de resultado) — así no hace falta
 * tocar ningún otro archivo del proyecto que ya las use.
 */
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Caja delimitadora aproximada de la Colombia continental (no incluye San
// Andrés/Providencia, que quedan muy al norte, en el Caribe). Cualquier
// resultado fuera de este rango se descarta como no confiable — misma
// red de seguridad que ya tenía la versión anterior.
const COLOMBIA_LAT_MIN = -4.3;
const COLOMBIA_LAT_MAX = 13.5;
const COLOMBIA_LON_MIN = -79.1;
const COLOMBIA_LON_MAX = -66.8;

function dentroDeColombia(lat, lon) {
  return lat >= COLOMBIA_LAT_MIN && lat <= COLOMBIA_LAT_MAX &&
         lon >= COLOMBIA_LON_MIN && lon <= COLOMBIA_LON_MAX;
}

async function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function verificarApiKey() {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error(
      'Falta GOOGLE_MAPS_API_KEY en el archivo .env. Crea una API Key en https://console.cloud.google.com ' +
      '(con la "Geocoding API" activada) y agrégala como GOOGLE_MAPS_API_KEY=tu_clave en el .env del servidor.'
    );
  }
}

async function solicitarBusqueda(url, intento) {
  const MAX_INTENTOS = 4;
  const ESPERAS_REINTENTO_MS = [3000, 7000, 15000]; // progresivas: 3s, 7s, 15s

  const resp = await fetch(url);
  if (!resp.ok) {
    // Google casi nunca devuelve un error HTTP (la mayoría de problemas
    // vienen con HTTP 200 y un campo "status" distinto de "OK", ver
    // abajo) — esto solo cubre caídas de red puntuales.
    if (intento < MAX_INTENTOS) {
      const espera = ESPERAS_REINTENTO_MS[intento - 1] || 15000;
      console.warn(`Google Geocoding respondió HTTP ${resp.status} (intento ${intento}/${MAX_INTENTOS}); reintentando en ${espera / 1000}s...`);
      await esperar(espera);
      return solicitarBusqueda(url, intento + 1);
    }
    throw new Error(`Google Geocoding respondió con estado HTTP ${resp.status} tras ${MAX_INTENTOS} intentos.`);
  }

  const datos = await resp.json();

  if (datos.status === 'OVER_QUERY_LIMIT') {
    if (intento < MAX_INTENTOS) {
      const espera = ESPERAS_REINTENTO_MS[intento - 1] || 15000;
      console.warn(`Google Geocoding respondió OVER_QUERY_LIMIT (intento ${intento}/${MAX_INTENTOS}); reintentando en ${espera / 1000}s...`);
      await esperar(espera);
      return solicitarBusqueda(url, intento + 1);
    }
    throw new Error(`Google Geocoding respondió OVER_QUERY_LIMIT tras ${MAX_INTENTOS} intentos (límite de consultas excedido — revisa la facturación/cuota en Google Cloud Console).`);
  }

  // "No encontró nada" no es un error real, simplemente no hay
  // coincidencias para esa búsqueda.
  if (datos.status === 'ZERO_RESULTS') return null;

  if (datos.status !== 'OK') {
    throw new Error(`Google Geocoding respondió con estado "${datos.status}"${datos.error_message ? ': ' + datos.error_message : ''}`);
  }

  const ubicacion = datos.results[0].geometry.location;
  const lat = ubicacion.lat;
  const lon = ubicacion.lng;

  // Red de seguridad: si el resultado cae fuera de Colombia, se descarta
  // como si no se hubiera encontrado nada — mejor no ubicar a alguien en
  // el mapa, que ubicarlo por error en otro país.
  if (!dentroDeColombia(lat, lon)) {
    console.warn(`Geocodificación descartada por caer fuera de Colombia: lat=${lat}, lon=${lon}`);
    return null;
  }

  return { latitud: lat, longitud: lon };
}

/**
 * Geocodifica una dirección colombiana. Admite las mismas dos formas de
 * llamarla que ya existían:
 *
 * 1) Con datos de ciudad/departamento: geocodificarDireccion({
 *      calle: 'Calle 10 # 5-20', ciudad: 'Manizales', departamento: 'Caldas'
 *    })
 *
 * 2) Texto libre directo (compatibilidad): geocodificarDireccion('Calle
 *    10 # 5-20, Barrio X, Manizales, Caldas, Colombia')
 *
 * En los dos casos se arma una sola cadena de texto (Google, al igual
 * que se había comprobado con LocationIQ, da mejores resultados con
 * texto libre que con búsqueda "estructurada" por campos separados) y
 * se restringe con components=country:CO para que no se salga de
 * Colombia buscando coincidencias.
 */
async function geocodificarDireccion(entrada) {
  verificarApiKey();

  let textoCompleto;
  if (typeof entrada === 'string') {
    textoCompleto = entrada;
  } else {
    const { calle, ciudad, departamento } = entrada;
    textoCompleto = [calle, ciudad, departamento, 'Colombia'].filter(Boolean).join(', ');
  }

  const params = new URLSearchParams({
    address: textoCompleto,
    key: GOOGLE_MAPS_API_KEY,
    region: 'co',
    components: 'country:CO'
  });
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
  return solicitarBusqueda(url, 1);
}

/**
 * Geocodificación inversa: a partir de coordenadas GPS devuelve una dirección
 * aproximada en texto. Se usa para el botón "Usar ubicación actual". Se hace
 * en el backend (no directo desde el navegador) para mantener la misma
 * clave de API sin exponerla al frontend.
 */
async function geocodificarInversa(latitud, longitud) {
  verificarApiKey();
  const params = new URLSearchParams({
    latlng: `${latitud},${longitud}`,
    key: GOOGLE_MAPS_API_KEY
  });
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Google Geocoding respondió con estado HTTP ${resp.status}`);
  }
  const datos = await resp.json();
  if (datos.status === 'ZERO_RESULTS') return null;
  if (datos.status === 'OVER_QUERY_LIMIT') return null; // no crítico acá — simplemente no se autocompleta la dirección
  if (datos.status !== 'OK') {
    throw new Error(`Google Geocoding respondió con estado "${datos.status}"${datos.error_message ? ': ' + datos.error_message : ''}`);
  }

  const resultado = datos.results[0];
  // Se mapean los mismos nombres de campo que ya devolvía la versión
  // anterior (estilo Nominatim: city/state/suburb/road), para que
  // cualquier código que ya lea "detalle.city", "detalle.state", etc.
  // siga funcionando igual sin tener que tocarlo.
  const detalle = {};
  let tieneLocalidad = false;
  (resultado.address_components || []).forEach((c) => {
    if (c.types.includes('locality')) { detalle.city = c.long_name; tieneLocalidad = true; }
    if (c.types.includes('administrative_area_level_2') && !detalle.city) detalle.city = c.long_name;
    if (c.types.includes('administrative_area_level_1')) detalle.state = c.long_name;
    if (c.types.includes('sublocality') || c.types.includes('neighborhood')) detalle.suburb = c.long_name;
    if (c.types.includes('route')) detalle.road = c.long_name;
    if (c.types.includes('postal_code')) detalle.postcode = c.long_name;
  });
  // Señal de urbano/rural para el botón GPS de los formularios: se probó
  // con coordenadas reales de varios barrios de Manizales y el "suburb"
  // (sublocality/neighborhood) resultó muy inconsistente — la mitad de
  // los barrios probados no traían ese dato aunque son 100% urbanos. En
  // cambio, "locality" (el municipio) SÍ apareció siempre que el punto
  // cae dentro de una zona urbana reconocida por Google, y estuvo
  // ausente en los puntos rurales de prueba (esos resultados vienen como
  // "Plus Code" en vez de una dirección con calle). Por eso esta bandera
  // usa locality, no suburb, para decidir Urbano/Rural.
  detalle.esUrbano = tieneLocalidad;

  return {
    direccion: resultado.formatted_address || null,
    detalle
  };
}

module.exports = { geocodificarDireccion, geocodificarInversa };
