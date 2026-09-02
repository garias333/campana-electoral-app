/**
 * QUE CORPORACIONES PUEDE APOYAR LA GENTE DE UNA CAMPAÑA.
 *
 * Vivia dentro de routes/configuracion.routes.js, que era su unico consumidor.
 * Desde que el tablero tambien tiene que saberlo —para no pintar barras de
 * corporaciones que esa campaña no pregunta— hacen falta dos, y dos copias de
 * una regla se separan el dia que alguien toque una. Aqui hay una sola.
 */

/* Las listas estan ENCADENADAS: la de un cargo bajo contiene la de uno alto.
   Quien aspira al Concejo necesita ofrecer tambien Alcaldia, porque su gente
   vota las dos; quien aspira a la Gobernacion no ofrece Concejo, porque su
   campaña no llega ahi.

   NO estan en el mismo orden interno a proposito: `alcaldia` pone «gobernacion»
   antes que «asamblea» y `concejo` al reves. Es el orden en que cada campaña
   quiere ver sus casillas, y unificarlo se las moveria de sitio. */
const APOYOS_POR_CARGO = {
  jal:         ['jal', 'concejo', 'alcaldia', 'asamblea', 'gobernacion'],
  concejo:     ['concejo', 'alcaldia', 'asamblea', 'gobernacion'],
  alcaldia:    ['alcaldia', 'gobernacion', 'asamblea'],
  asamblea:    ['asamblea', 'gobernacion'],
  gobernacion: ['gobernacion']
};

/** Los apoyos permitidos para un cargo, o lista vacía si ese cargo no ofrece apoyos. */
function apoyosPermitidos(cargo) {
  return APOYOS_POR_CARGO[cargo] || [];
}

/**
 * Las dos listas juntas, sin repetidos y sin inventar un orden nuevo.
 *
 * PARA QUIEN TRABAJA PARA DOS CAMPAÑAS A LA VEZ: la gente de un aspirante al
 * Concejo le registra votantes a él Y a la madre, así que necesita las casillas
 * de las dos. Quitarle una de las dos listas le tapa la mitad de su trabajo.
 *
 * MANDA LA LISTA MÁS LARGA, y la otra solo aporta lo que falte. Un orden
 * canónico inventado aquí le movería las casillas de sitio a campañas que no
 * tienen ningún aspirante.
 */
function unirApoyos(a, b) {
  const base = (b.length > a.length) ? b : a;
  const otro = (base === b) ? a : b;
  return base.concat(otro.filter((x) => !base.includes(x)));
}

module.exports = { APOYOS_POR_CARGO, apoyosPermitidos, unirApoyos };
