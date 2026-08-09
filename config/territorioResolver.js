/**
 * Resuelve un territorio_id a partir de nombres de texto — usado por las
 * importaciones de Excel de Estructura y Votantes, donde el archivo trae el
 * nombre de la Comuna/Barrio o Corregimiento/Vereda en vez de un id. No crea
 * territorios nuevos (a diferencia de la importación del catálogo de
 * Territorios): si no encuentra coincidencia exacta, devuelve un error para
 * que esa fila se reporte como fallida.
 *
 * Con permitirSoloZona=true (usado para Cargo=Coordinador), si no se indica
 * Barrio/Vereda pero sí Comuna/Corregimiento, resuelve directamente a esa
 * Comuna/Corregimiento en vez de exigir un Barrio/Vereda bajo ella.
 */
async function resolverTerritorioDesdeNombres(pool, { area, comuna, barrio, corregimiento, vereda, permitirSoloZona = false }) {
  const areaNorm = (area || '').toString().trim().toLowerCase();

  if (areaNorm === 'urbano' || (!areaNorm && (barrio || comuna))) {
    if (!barrio) {
      if (permitirSoloZona && comuna) {
        const [[fila]] = await pool.query(
          `SELECT id FROM territorios WHERE tipo = 'comuna' AND LOWER(nombre) COLLATE utf8mb4_unicode_ci = LOWER(?) COLLATE utf8mb4_unicode_ci LIMIT 1`,
          [String(comuna).trim()]
        );
        if (!fila) return { error: `Comuna "${comuna}" no encontrada. Créela primero en "Gestionar territorios".` };
        return { territorioId: fila.id, area: 'urbano' };
      }
      return { error: 'Falta el Barrio para el área Urbano.' };
    }
    let query = `SELECT b.id FROM territorios b WHERE b.tipo = 'barrio' AND LOWER(b.nombre) COLLATE utf8mb4_unicode_ci = LOWER(?) COLLATE utf8mb4_unicode_ci`;
    const params = [String(barrio).trim()];
    if (comuna) {
      query += ` AND b.padre_id IN (SELECT id FROM territorios WHERE tipo = 'comuna' AND LOWER(nombre) COLLATE utf8mb4_unicode_ci = LOWER(?) COLLATE utf8mb4_unicode_ci)`;
      params.push(String(comuna).trim());
    }
    query += ' LIMIT 1';
    const [[fila]] = await pool.query(query, params);
    if (!fila) {
      return { error: `Barrio "${barrio}" no encontrado${comuna ? ' en la comuna "' + comuna + '"' : ''}. Créelo primero en "Gestionar territorios".` };
    }
    return { territorioId: fila.id, area: 'urbano' };
  }

  if (areaNorm === 'rural' || (!areaNorm && (vereda || corregimiento))) {
    if (!vereda) {
      if (permitirSoloZona && corregimiento) {
        const [[fila]] = await pool.query(
          `SELECT id FROM territorios WHERE tipo = 'corregimiento' AND LOWER(nombre) COLLATE utf8mb4_unicode_ci = LOWER(?) COLLATE utf8mb4_unicode_ci LIMIT 1`,
          [String(corregimiento).trim()]
        );
        if (!fila) return { error: `Corregimiento "${corregimiento}" no encontrado. Créelo primero en "Gestionar territorios".` };
        return { territorioId: fila.id, area: 'rural' };
      }
      return { error: 'Falta la Vereda para el área Rural.' };
    }
    let query = `SELECT v.id FROM territorios v WHERE v.tipo = 'vereda' AND LOWER(v.nombre) COLLATE utf8mb4_unicode_ci = LOWER(?) COLLATE utf8mb4_unicode_ci`;
    const params = [String(vereda).trim()];
    if (corregimiento) {
      query += ` AND v.padre_id IN (SELECT id FROM territorios WHERE tipo = 'corregimiento' AND LOWER(nombre) COLLATE utf8mb4_unicode_ci = LOWER(?) COLLATE utf8mb4_unicode_ci)`;
      params.push(String(corregimiento).trim());
    }
    query += ' LIMIT 1';
    const [[fila]] = await pool.query(query, params);
    if (!fila) {
      return { error: `Vereda "${vereda}" no encontrada${corregimiento ? ' en el corregimiento "' + corregimiento + '"' : ''}. Créela primero en "Gestionar territorios".` };
    }
    return { territorioId: fila.id, area: 'rural' };
  }

  return { territorioId: null, area: null };
}

module.exports = { resolverTerritorioDesdeNombres };
