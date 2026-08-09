/* Utilidades de formulario (teléfono, GPS, comparación sin tildes),
   extraídas de /js/common.js para las páginas de /app/ que las
   necesitan (ej. registro-votante.html) sin cargar el resto del
   archivo (sidebar, permisos, formateadores de dashboard). Requiere
   que /js/api-core.js se cargue antes (usa la función api()). */

/**
 * Activa un botón de "Usar ubicación actual": pide el GPS del dispositivo,
 * consulta al backend la dirección aproximada (geocodificación inversa) y la
 * escribe en el campo de dirección indicado.
 *
 * @param {string} botonId - id del botón que dispara la acción
 * @param {string} inputDireccionId - id del <input> de dirección a llenar
 * @param {function} [onDespues] - callback opcional (direccion, lat, lon, detalle)
 *   `detalle` trae lo que Google Geocoding haya podido identificar de esa
 *   ubicación (detalle.state = departamento, detalle.city = ciudad/municipio,
 *   detalle.suburb = barrio/vereda) — puede venir incompleto o vacío según
 *   qué tan precisa sea la cobertura de Google en esa zona.
 */
function activarBotonGps(botonId, inputDireccionId, onDespues) {
  const boton = document.getElementById(botonId);
  if (!boton) return;

  boton.addEventListener('click', async () => {
    if (!navigator.geolocation) {
      alert('Este dispositivo o navegador no permite obtener la ubicación GPS.');
      return;
    }
    const textoOriginal = boton.textContent;
    boton.disabled = true;
    boton.textContent = 'Obteniendo ubicación...';

    /** getCurrentPosition en forma de promesa, para poder encadenar el reintento. */
    const ubicar = (opciones) => new Promise((resolver, rechazar) => {
      navigator.geolocation.getCurrentPosition(resolver, rechazar, opciones);
    });

    try {
      let posicion;
      try {
        // Primer intento: por satélite, el más preciso.
        posicion = await ubicar({ enableHighAccuracy: true, timeout: 30000 });
      } catch (errPreciso) {
        // En un teléfono recién estrenado el GPS no tiene datos asistidos
        // guardados y el primer arranque en frío puede tardar bastante más
        // que cualquier espera razonable — por eso "no funcionaba" en una
        // instalación nueva y sí después. Se reintenta por red (antenas y
        // wifi): 20-100 m en zona urbana, de sobra para deducir la
        // dirección, que es lo único para lo que se usa esto.
        posicion = await ubicar({ enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
      }
      const { latitude, longitude } = posicion.coords;
      const data = await api('/geo/inverso', { method: 'POST', body: { lat: latitude, lon: longitude } });
      const inputDireccion = document.getElementById(inputDireccionId);
      if (inputDireccion) inputDireccion.value = data.direccion || '';
      if (onDespues) onDespues(data.direccion, latitude, longitude, data.detalle || {});
    } catch (err) {
      // Los errores de geolocalización traen `code`; los de la consulta de
      // dirección, no. Se distinguen para no decirle a alguien que falló el
      // GPS cuando lo que falló fue la red.
      alert(err && typeof err.code === 'number'
        ? 'No se pudo obtener la ubicación: ' + err.message
        : 'No se pudo determinar la dirección a partir del GPS: ' + err.message);
    } finally {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  });
}

/**
 * Normaliza texto para comparaciones que no distingan tildes (ej. "lider"
 * debe coincidir con "líder"). Se usa en búsquedas y en la resolución de
 * nombres de territorios (Comuna/Barrio/Corregimiento/Vereda) en los
 * formularios, para que no haga falta escribir la tilde exacta.
 */
function normalizarTexto(s) {
  return (s || '').toString().trim().toLowerCase()
    .replace(/[áàäâã]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöôõ]/g, 'o')
    .replace(/[úùüû]/g, 'u');
}

/**
 * Da formato de Nombre Propio: "juan PÉREZ gómez" -> "Juan Pérez Gómez".
 * Se usa en todos los campos de nombre de persona de la app.
 */
function formatoNombrePropio(s) {
  return (s || '').toString().trim().toLowerCase()
    .replace(/(^|[\s'-])([a-záéíóúñü])/g, (m, sep, letra) => sep + letra.toUpperCase());
}

/**
 * Aplica formatoNombrePropio automáticamente, en el evento "blur" (al salir
 * del campo, no mientras se escribe, para no saltar el cursor), a todos los
 * campos de nombre de persona indicados por selector CSS.
 */
function aplicarFormatoNombrePropio(selector) {
  document.querySelectorAll(selector).forEach(input => {
    input.addEventListener('blur', (e) => { e.target.value = formatoNombrePropio(e.target.value); });
  });
}

/**
 * Formatea un teléfono colombiano de 10 dígitos: "3001234567" ->
 * "300 123 4567".
 */
function formatoTelefonoColombia(valor) {
  const digitos = (valor || '').toString().replace(/\D/g, '').slice(0, 10);
  const partes = [digitos.slice(0, 3), digitos.slice(3, 6), digitos.slice(6, 10)].filter(Boolean);
  return partes.join(' ');
}

/** Quita el mensaje de error (si lo había) y el resaltado rojo de un campo de teléfono. */
function ocultarErrorTelefono(input) {
  input.style.borderColor = '';
  const siguiente = input.nextElementSibling;
  if (siguiente && siguiente.classList && siguiente.classList.contains('error-telefono')) siguiente.remove();
}

/**
 * Valida que un campo de teléfono, SI tiene algo escrito, tenga
 * exactamente 10 dígitos — si no, resalta el campo en rojo y muestra
 * "Error de digitación" justo debajo. Campo vacío se considera válido.
 * Devuelve true/false.
 */
function validarTelefonoCampo(input) {
  ocultarErrorTelefono(input);
  const digitos = input.value.replace(/\D/g, '');
  if (digitos.length === 0 || digitos.length === 10) return true;
  input.style.borderColor = '#c0392b';
  const aviso = document.createElement('small');
  aviso.className = 'error-telefono';
  aviso.style.cssText = 'color:#c0392b; display:block; margin-top:4px; font-size:0.78rem;';
  aviso.textContent = 'Error de digitación';
  input.insertAdjacentElement('afterend', aviso);
  return false;
}
