/**
 * El ESTADO de la autorización de datos como expresiones SQL, para los listados, los filtros y los Excel de Votantes y de Estructura (parche 325).
 *
 * Una sola definición: la misma lógica que `estadoDePersona` (config/autorizacionDatos.js), pero por fila. Los valores salen del servidor; lo
 * que llega en la URL nunca se pega en el SQL (el filtro solo acepta los valores de ESTADOS).
 *
 *   firmada   firma por enlace, o (votantes) la firma en pantalla del registro del celular
 *   pendiente enlace enviado, vigente, sin firmar        vencida: el enlace pasó de fecha sin firmarse
 *   verbal    (solo votantes) alguien marcó «la persona autorizó» pero no hay firma suya       sin: nada
 */
'use strict';

const ESTADOS = ['firmada', 'pendiente', 'vencida', 'verbal', 'sin'];
const ETIQUETAS = { firmada: 'Firmada', pendiente: 'Pendiente', vencida: 'Vencida', verbal: 'Verbal (sin firma)', sin: 'Sin autorización' };

const hay = (tipo, a, cond) =>
  `EXISTS (SELECT 1 FROM autorizaciones_datos ad WHERE ad.persona_tipo = '${tipo}' AND ad.persona_id = ${a}.id AND ${cond})`;

function estadoVotante(a = 'v') {
  return `(CASE
    WHEN ${hay('votante', a, "ad.estado = 'firmada'")}
      OR EXISTS (SELECT 1 FROM votante_firmas vf WHERE vf.votante_id = ${a}.id) THEN 'firmada'
    WHEN ${hay('votante', a, "ad.estado = 'pendiente' AND ad.expira_en > NOW()")} THEN 'pendiente'
    WHEN ${hay('votante', a, "ad.estado = 'pendiente'")} THEN 'vencida'
    WHEN ${a}.consentimiento_autorizado = 1 THEN 'verbal'
    ELSE 'sin' END)`;
}

function fechaFirmaVotante(a = 'v') {
  return `COALESCE((SELECT MAX(ad.firmada_en) FROM autorizaciones_datos ad
                     WHERE ad.persona_tipo = 'votante' AND ad.persona_id = ${a}.id AND ad.estado = 'firmada'),
                   (SELECT vf.creada_en FROM votante_firmas vf WHERE vf.votante_id = ${a}.id))`;
}

function estadoEstructura(a = 'e') {
  return `(CASE
    WHEN ${hay('estructura', a, "ad.estado = 'firmada'")} THEN 'firmada'
    WHEN ${hay('estructura', a, "ad.estado = 'pendiente' AND ad.expira_en > NOW()")} THEN 'pendiente'
    WHEN ${hay('estructura', a, "ad.estado = 'pendiente'")} THEN 'vencida'
    ELSE 'sin' END)`;
}

function fechaFirmaEstructura(a = 'e') {
  return `(SELECT MAX(ad.firmada_en) FROM autorizaciones_datos ad
            WHERE ad.persona_tipo = 'estructura' AND ad.persona_id = ${a}.id AND ad.estado = 'firmada')`;
}

/** La condición de un filtro (`?autorizacion=firmada`). Devuelve null si el valor no es uno de los cinco: entonces no se filtra. */
function condicionFiltro(valor, expresionEstado) {
  return ESTADOS.includes(valor) ? `${expresionEstado} = '${valor}'` : null;
}

module.exports = { ESTADOS, ETIQUETAS, estadoVotante, fechaFirmaVotante, estadoEstructura, fechaFirmaEstructura, condicionFiltro };
