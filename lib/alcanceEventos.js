/**
 * A QUÉ EVENTOS LLEGA CADA QUIEN, Y QUIÉN VE LOS CONTACTOS DE LOS ASISTENTES (parche 305).
 *
 * POR QUÉ EXISTE. Hasta el parche 304 `routes/eventos.routes.js` solo pedía sesión: cualquier rol con cuenta (líder, sublíder, testigo,
 * invitado…) podía listar TODOS los eventos y, con `GET /:id/asistentes` y `GET /asistentes-consolidado`, leer el nombre, el teléfono y la
 * CÉDULA de todos los asistentes de la campaña. Aquí está la regla que lo cierra.
 *
 * LA REGLA DE ALCANCE (sobre una consulta con la tabla `eventos` con el alias `e`)
 *   administrador ........... todos
 *   coordinador ............. los de su rama: donde él, uno de sus líderes o un sublíder de estos figuran como creador, responsable,
 *                             coordinador o líder del evento; y aquellos a los que está invitado
 *   líder, sublíder y demás . donde figuran como creador, responsable, coordinador o líder del evento, o están invitados
 *   aspirante ............... ninguno (la lista blanca de middleware/aspirante.js ya no lo deja llegar; esto es el segundo cerrojo)
 *
 * «INVITADO» = una fila de `evento_asistentes` con su `usuario_id`. Estar invitado deja VER el evento y la lista de asistentes, no
 * editarlo: para escribir hace falta GESTIONAR el evento (`soloGestion`), es decir, figurar en alguno de sus cuatro campos.
 *
 * LOS CONTACTOS. El teléfono y la cédula de un asistente los ve el administrador y el RESPONSABLE del evento (`eventos.responsable_id`),
 * nadie más: el coordinador y el líder ven nombre, barrio y asistencia. `coordinador_id` y `lider_id` son campos informativos del evento y
 * no dan acceso a contactos.
 */
'use strict';

const SUBQUERY_LIDERES = `SELECT el.usuario_id FROM estructura el WHERE el.activo = 1 AND el.supervisor_id = ?`;
const SUBQUERY_SUBLIDERES = `SELECT es.usuario_id FROM estructura es
                               JOIN estructura el2 ON el2.usuario_id = es.supervisor_id
                              WHERE es.activo = 1 AND el2.activo = 1 AND el2.supervisor_id = ?`;

/**
 * @param alcance      `req.alcance` (middleware/auth.js `calcularAlcance`)
 * @param alias        alias de `eventos` en la consulta (por defecto «e»)
 * @param soloGestion  true = sin los eventos a los que solo está invitado (para escribir)
 * @returns {{ sql: string, valores: any[] }}
 */
function alcanceEventos(alcance, alias = 'e', soloGestion = false) {
  const a = alias;
  if (!alcance) return { sql: '1 = 0', valores: [] };
  if (alcance.cargo === 'madre') return { sql: '1 = 1', valores: [] };
  if (alcance.cargo === 'aspirante' || !alcance.usuarioId) return { sql: '1 = 0', valores: [] };
  const yo = alcance.usuarioId;
  const campos = ['created_by', 'responsable_id', 'coordinador_id', 'lider_id'];
  const invitado = `EXISTS (SELECT 1 FROM evento_asistentes ea WHERE ea.evento_id = ${a}.id AND ea.usuario_id = ?)`;
  let gestion, valores;
  if (alcance.cargo === 'coordinador') {
    const enRama = (c) => `(${a}.${c} = ? OR ${a}.${c} IN (${SUBQUERY_LIDERES}) OR ${a}.${c} IN (${SUBQUERY_SUBLIDERES}))`;
    gestion = campos.map(enRama).join(' OR ');
    valores = campos.flatMap(() => [yo, yo, yo]);
  } else {
    gestion = campos.map((c) => `${a}.${c} = ?`).join(' OR ');
    valores = campos.map(() => yo);
  }
  if (soloGestion) return { sql: `(${gestion})`, valores };
  return { sql: `((${gestion}) OR ${invitado})`, valores: [...valores, yo] };
}

/** ¿Ve los contactos (teléfono y cédula) de los asistentes de este evento? Administrador y responsable del evento. */
function veContactos(alcance, evento) {
  if (!alcance) return false;
  if (alcance.cargo === 'madre') return true;
  return !!evento && evento.responsable_id !== null && evento.responsable_id !== undefined && Number(evento.responsable_id) === Number(alcance.usuarioId);
}

/**
 * ¿Tiene «Ver» en alguno de los módulos de eventos (eventos, agenda, asistentes_reuniones)? Es la misma puerta de routes/eventos.routes.js; la usan
 * las tareas de tipo «reunión» para no mostrar eventos a quien el servidor de eventos no se los dejaría ver. Falla CERRADO.
 */
async function puedeVerEventos(usuario) {
  if (!usuario) return false;
  if (usuario.rol === 'admin') return true;
  try {
    const pool = require('../config/db');
    if (await require('../config/superadmin').esSuperadmin(usuario)) return true;
    const [filas] = await pool.query(`SELECT 1 FROM permisos_rol WHERE rol = ? AND modulo IN ('eventos','agenda','asistentes_reuniones') AND permitido = 1 LIMIT 1`, [usuario.rol]);
    return filas.length > 0;
  } catch (_) { return false; }
}

module.exports = { alcanceEventos, veContactos, puedeVerEventos };
