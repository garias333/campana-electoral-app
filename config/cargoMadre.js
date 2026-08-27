/**
 * A QUÉ CARGO ASPIRA LA CAMPAÑA MADRE. Con caché, porque se pregunta en cada
 * listado de votantes.
 *
 * Es lo que `filtroMadre` (lib/ramas.js) compara contra el `apoya_a` de cada
 * votante: una campaña a la Alcaldía ve a los de la rama de un aspirante que
 * marquen «alcaldia», y una a la Gobernación, a los que marquen «gobernacion».
 * No se escribe a mano en ningún sitio — sale de `configuracion_campana`.
 *
 * TREINTA SEGUNDOS DE CACHÉ, como `esSuperadmin`. Cambiar el cargo de la
 * campaña es de las cosas que se hacen una vez; releerlo en cada consulta de
 * la lista de votantes sería un viaje a la base por cada carga de pantalla.
 * Medio minuto de retraso al cambiarlo no le importa a nadie.
 *
 * SI FALLA, DEVUELVE null, Y ESO APAGA EL FILTRO. Es deliberado: sin cargo no
 * hay con qué comparar, y la alternativa —ocultar por si acaso— dejaría a la
 * campaña sin ver a su propia gente por un error de lectura. Enseñar de más
 * durante treinta segundos se nota y se corrige; enseñar de menos, no.
 */
const pool = require('./db');

const VIGENCIA_MS = 30 * 1000;
let cache = { valor: null, hasta: 0 };

async function cargoDeLaMadre() {
  if (Date.now() < cache.hasta) return cache.valor;
  let valor = null;
  try {
    const [[fila]] = await pool.query(
      `SELECT cargo_aspira FROM configuracion_campana WHERE id = 1 LIMIT 1`);
    valor = (fila && fila.cargo_aspira) || null;
  } catch (err) {
    console.error('Leyendo el cargo de la campaña madre:', err.message);
  }
  cache = { valor, hasta: Date.now() + VIGENCIA_MS };
  return valor;
}

/** Para las pruebas y para después de guardar la configuración. */
function olvidarCargoDeLaMadre() { cache = { valor: null, hasta: 0 }; }

module.exports = { cargoDeLaMadre, olvidarCargoDeLaMadre };
