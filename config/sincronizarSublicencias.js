/**
 * Trae las sublicencias vendidas y las deja iguales en esta campaña.
 *
 * POR QUÉ VIAJAN CON LA LICENCIA Y NO POR UNA RUTA PROPIA. El Servidor de
 * Licencias NO puede escribir en la base de una campaña —su usuario de MySQL
 * sólo ve `licenciasdb`, comprobado— así que no hay forma de «instalar» una
 * sublicencia desde allá. Pero esta campaña ya le pregunta cada seis horas si
 * su licencia sigue viva, y esa respuesta llega firmada y autenticada. Colgar
 * las sublicencias de ahí usa un camino que ya existe en vez de abrir uno
 * nuevo que habría que proteger igual.
 *
 * EL SERVIDOR DE LICENCIAS MANDA, SIEMPRE. Lo que no venga en la lista se
 * apaga aquí: una sublicencia suspendida por falta de pago, o vencida, deja de
 * funcionar sola en la siguiente validación sin que nadie tenga que entrar a la
 * campaña a apagarla. Es la misma regla que ya gobierna la licencia madre.
 *
 * LA CÉDULA ES EL PUENTE. Allá no se conoce la numeración interna de usuarios
 * de cada campaña; `usuarios.numero_identificacion` es única aquí y significa
 * lo mismo en los dos lados.
 */
const pool = require('./db');
const { recalcularTodas } = require('../lib/ramas');
const { normalizarCedula, buscarUsuarioPorCedula } = require('../lib/normalizarCedula');

/**
 * Deja `sublicencias` igual a lo que dice el Servidor de Licencias.
 * Devuelve un resumen; no lanza nunca — un fallo aquí no puede tumbar la
 * validación de la licencia, que es lo que de verdad mantiene viva la campaña.
 */
async function sincronizar(lista) {
  const resumen = { activadas: 0, actualizadas: 0, apagadas: 0, sinPersona: [] };
  if (!Array.isArray(lista)) return resumen;

  try {
    const idsVigentes = [];

    for (const s of lista) {
      const cedula = String(s.cedula || '').trim();
      if (!cedula) continue;

      // La cédula de la sublicencia puede venir con puntos y la cuenta estar guardada sin ellos, o al revés.
      const u = await buscarUsuarioPorCedula(pool, normalizarCedula(cedula));

      if (!u) {
        // NO se calla: una sublicencia vendida cuya persona no existe en esta
        // campaña es dinero cobrado por algo que no funciona, y el unico sitio
        // donde eso se puede notar es este registro.
        resumen.sinPersona.push(cedula);
        continue;
      }

      idsVigentes.push(u.id);
      /* EL NOMBRE Y EL LEMA NO SE PISAN SI EL ASPIRANTE YA LOS TOCO.
         Los dos lados pueden escribirlos: el superadministrador al vender, y el
         aspirante desde Configuracion. Sin esta condicion, lo que el escribiera
         viviria como mucho seis horas y desapareceria solo — sin error, sin
         aviso, y sin forma de que nadie relacionara una cosa con la otra.

         El resto lo sigue mandando Licencias: el cargo, el logo y si esta
         activa. Lo que se le cede es su marca, que es lo unico suyo. */
      const [r] = await pool.query(
        `INSERT INTO sublicencias (usuario_id, cargo, nombre, subtitulo, logo_url, activa)
         VALUES (?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           cargo = VALUES(cargo),
           nombre    = IF(marca_editada_en IS NULL, VALUES(nombre), nombre),
           subtitulo = IF(marca_editada_en IS NULL, VALUES(subtitulo), subtitulo),
           -- EL LOGO SE PROTEGE IGUAL QUE EL NOMBRE Y EL LEMA.
           -- Estaba sin proteger: se pisaba en cada sincronizacion, cada seis
           -- horas. Mientras el logo solo lo subia el superadministrador desde
           -- el panel daba igual, porque el panel era la unica fuente. Desde
           -- que el aspirante puede subir el suyo, sin este IF su logo duraba
           -- hasta la siguiente pasada y desaparecia sin que nada avisara —
           -- el peor final posible para una funcion que parece funcionar.
           logo_url  = IF(marca_editada_en IS NULL, VALUES(logo_url), logo_url),
           activa = 1`,
        [u.id, s.cargo || 'concejo', s.nombre_campana || null,
         s.subtitulo || null, s.logo_url || null]);
      // affectedRows: 1 = insertada, 2 = actualizada de verdad, 0 = igual.
      if (r.affectedRows === 1) resumen.activadas++;
      else if (r.affectedRows === 2) resumen.actualizadas++;
    }

    // Lo que ya no viene, se apaga. No se BORRA: la fila guarda desde cuándo
    // existió, y borrarla perdería ese rastro justo cuando hace falta para
    // saber por qué alguien dejó de ver sus datos.
    const [apagadas] = idsVigentes.length
      ? await pool.query(
          `UPDATE sublicencias SET activa = 0
            WHERE activa = 1 AND usuario_id NOT IN (${idsVigentes.map(() => '?').join(',')})`,
          idsVigentes)
      : await pool.query('UPDATE sublicencias SET activa = 0 WHERE activa = 1');
    resumen.apagadas = apagadas.affectedRows || 0;

    /* SI ALGO CAMBIO, HAY QUE RECALCULAR LAS RAMAS.
       `votantes.rama_aspirante_id` se deriva de quien tiene sublicencia ACTIVA.
       Activar una sin recalcular la dejaria sin un solo votante —el aspirante
       entraria a una pantalla vacia y pensaria que no funciona—, y apagarla sin
       recalcular dejaria a esos votantes escondidos de la madre para siempre. */
    if (resumen.activadas || resumen.actualizadas || resumen.apagadas) {
      const r = await recalcularTodas(pool);
      resumen.votantesRecalculados = r.cambios.length;
    }
  } catch (err) {
    // Una campaña sin el parche de sublicencias no tiene las tablas: se sigue
    // sin ruido. Cualquier otro fallo si se anota.
    if (err.code !== 'ER_NO_SUCH_TABLE') {
      console.error('[SUBLICENCIAS] No se pudieron sincronizar:', err.message);
    }
  }

  return resumen;
}

module.exports = { sincronizar };
