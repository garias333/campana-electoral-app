/**
 * ¿`territorios` es una VISTA (campaña conectada al catálogo) o una TABLA local?
 *
 * Las dos formas conviven:
 *   · Campañas conectadas: `territorios` es una vista de solo lectura sobre
 *     `territoriosdb.ctc_territorios`. Ahí los territorios NO se editan desde la
 *     campaña — se corrigen una vez en el catálogo.
 *   · Campañas nuevas: `territorios` es una tabla local, editable. Agregar e
 *     importar comunas, barrios, corregimientos y veredas afecta solo a esa
 *     campaña; el catálogo se usa únicamente para puestos y mesas.
 *
 * Las rutas de escritura de Territorios preguntan aquí antes de hacer nada.
 *
 * FALLA CERRADO, Y ES LA PROPIEDAD QUE IMPORTA. Si la consulta falla, o la tabla
 * no aparece, la respuesta es «es una vista»: se mantiene el 409 de siempre. El
 * error contrario —creer que es una tabla cuando es una vista— no rompería nada
 * a la vista de nadie: MySQL rechazaría la escritura con un mensaje ilegible, pero
 * un `DELETE` o un `INSERT` mal dirigido es justo lo que este módulo existe para
 * no intentar. Solo `BASE TABLE` abre la edición; `VIEW`, `SYSTEM VIEW` o cualquier
 * otra cosa la cierran.
 *
 * CACHÉ DE 60 s. La respuesta no cambia salvo que alguien convierta la tabla en
 * vista (o al revés), y preguntarlo en cada petición sería gratuito. Un fallo se
 * cachea poco (10 s), para recuperarse pronto de un corte transitorio sin
 * martillar la base mientras dura.
 */
'use strict';

const TTL_MS = 60 * 1000;
const TTL_FALLO_MS = 10 * 1000;

const SQL_TIPO = `SELECT TABLE_TYPE AS tipo FROM information_schema.TABLES
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'territorios' LIMIT 1`;

/**
 * Fábrica con dependencias inyectadas (la base y el reloj) para poder probarla sin
 * conexión. `consultar` devuelve el TABLE_TYPE o lanza.
 */
function crearDetector({ consultar, ahora = Date.now, ttlMs = TTL_MS, ttlFalloMs = TTL_FALLO_MS }) {
  let esVista = true;     // el valor inicial también falla cerrado
  let vence = 0;
  let enCurso = null;     // una sola consulta a la vez, aunque lleguen muchas peticiones

  async function territoriosEsVista() {
    if (ahora() < vence) return esVista;
    if (enCurso) return enCurso;
    enCurso = (async () => {
      try {
        const tipo = await consultar();
        esVista = tipo !== 'BASE TABLE';
        vence = ahora() + ttlMs;
      } catch (err) {
        esVista = true;
        vence = ahora() + ttlFalloMs;
        console.error('[territorios] No se pudo saber si `territorios` es tabla o vista; se trata como vista:',
          err.code || err.message);
      } finally {
        enCurso = null;
      }
      return esVista;
    })();
    return enCurso;
  }

  function olvidarCache() { vence = 0; }

  return { territoriosEsVista, olvidarCache };
}

// La instancia de la aplicación. El pool se pide al usarla, no al cargar el módulo,
// para que los tests puedan requerir este archivo sin abrir conexiones.
const detector = crearDetector({
  async consultar() {
    const pool = require('./db');
    const [[fila]] = await pool.query(SQL_TIPO);
    return fila ? fila.tipo : null;
  }
});

module.exports = {
  crearDetector,
  territoriosEsVista: detector.territoriosEsVista,
  olvidarCache: detector.olvidarCache,
  SQL_TIPO
};
