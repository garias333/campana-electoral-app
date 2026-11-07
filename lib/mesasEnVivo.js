/**
 * El ESTADO EN VIVO de una mesa el día de la jornada — una sola regla para la cobertura (colores de las fichas) y para el
 * cuadro de alertas, para que las dos pantallas digan lo mismo de la misma mesa.
 *
 *   sin_testigo  rojo    la mesa no tiene a nadie asignado
 *   asignada     gris    tiene testigo, que todavía no ha marcado su llegada
 *   llego        azul    el testigo marcó «Llegué a mi puesto»
 *   e14          verde   ya hay E-14 subido (gana sobre lo demás: es lo que se quería)
 *   tarde        ámbar   el testigo llegó, pasó el plazo para el E-14 (cierre + plazo) y no hay E-14
 *
 * «Pasó el plazo» se mide con la hora de Colombia contra `jornada_cierre + plazo_e14_min`. Antes de esa hora una mesa
 * sin E-14 sigue en «llegó»: todavía no es tarde.
 */
'use strict';

/** ¿Ya pasó el plazo para subir el E-14? */
function pasoElPlazoDelE14(cfg, ahora) {
  return ahora.minutos >= cfg.cierre_min + cfg.plazo_e14_min;
}

/**
 * @param {{testigo:object|null, llego:boolean, e14:boolean, cfg:object, ahora:{minutos:number}}} x
 * @returns {'sin_testigo'|'asignada'|'llego'|'e14'|'tarde'}
 */
function estadoDeMesa({ testigo, llego, e14, cfg, ahora }) {
  if (!testigo) return 'sin_testigo';
  if (e14) return 'e14';
  if (llego && pasoElPlazoDelE14(cfg, ahora)) return 'tarde';
  if (llego) return 'llego';
  return 'asignada';
}

module.exports = { estadoDeMesa, pasoElPlazoDelE14 };
