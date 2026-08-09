const pool = require('./db');
const { geocodificarDireccion } = require('./geocoder');

/**
 * Sube por la cadena de padres de un territorio y devuelve los nombres, del
 * más específico al más general. Se usa para armar una dirección completa
 * para geocodificar (misma lógica ya usada en territorial.routes.js y
 * votantes.routes.js, centralizada aquí para reutilizarla en Eventos y en
 * las importaciones masivas sin volver a duplicarla).
 */
async function resolverCadenaTerritorio(territorioId) {
  const nombres = [];
  let actualId = territorioId;
  let profundidad = 0;
  while (actualId && profundidad < 6) {
    const [[fila]] = await pool.query(`SELECT nombre, padre_id FROM territorios WHERE id = ?`, [actualId]);
    if (!fila) break;
    nombres.push(fila.nombre);
    actualId = fila.padre_id;
    profundidad++;
  }
  return nombres;
}

/**
 * Geocodifica dirección + territorio. Devuelve {latitud, longitud} o null
 * si falla (nunca lanza error).
 *
 * `ciudad` y `departamento` son opcionales y solo los manda Eventos, que
 * ahora los pide aparte: un evento puede ser fuera de la ciudad sede, y
 * sin ese dato la misma dirección ("Calle 10 #5-20") resolvería al
 * municipio equivocado. Solo se agregan si no vienen ya en la cadena de
 * territorios, para no repetirlos en la consulta.
 */
async function geocodificarConTerritorio(direccion, territorioId, ciudad, departamento) {
  if (!direccion || !direccion.trim()) return null;
  try {
    const cadena = territorioId ? await resolverCadenaTerritorio(territorioId) : [];
    const yaEsta = (n) => n && cadena.some(c => c.toLowerCase() === String(n).toLowerCase());
    for (const extra of [ciudad, departamento]) {
      if (extra && String(extra).trim() && !yaEsta(extra)) cadena.push(String(extra).trim());
    }
    const direccionCompleta = `${direccion.trim()}${cadena.length ? ', ' + cadena.join(', ') : ''}, Colombia`;
    return await geocodificarDireccion(direccionCompleta);
  } catch (err) {
    console.error('Error geocodificando:', err);
    return null;
  }
}

module.exports = { resolverCadenaTerritorio, geocodificarConTerritorio };
