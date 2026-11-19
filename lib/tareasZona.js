/**
 * QUIÉN «CORRESPONDE» A UN BARRIO O VEREDA, PARA ASIGNARLE UNA TAREA (Orden 58, parche 340).
 *
 * Una tarea con barrio solo se le asigna a alguien que es de ese barrio. Esta es la ÚNICA definición, y la usan las dos puntas:
 * la lista que se le ofrece a quien crea (`GET /api/tareas/responsables?territorio_id=`) y el rechazo del servidor (crear y reasignar).
 *
 * UN LÍDER (O SUBLÍDER) CORRESPONDE A UNA ZONA SI CUMPLE AL MENOS UNA DE DOS COSAS:
 *   1. TERRITORIO DE SU FICHA. La zona, o algo que cuelga de ella, es uno de los territorios que tiene asignados en la estructura
 *      (`estructura.territorio_id` y `estructura_territorios`). Sirve para quien acaba de entrar y aún no registró a nadie.
 *      Un territorio MÁS AMPLIO que la zona NO cuenta: un líder asignado a todo el municipio no es, por eso, «de» cada barrio.
 *   2. GENTE. Tiene al menos UNA persona suya en la zona (la misma regla de alcance de Votantes: lo que registró él o su equipo).
 *      Es el criterio de Puerta a puerta (Orden 54) sin sus reglas de visita: aquí no importa si autorizó, si tiene dirección o si
 *      pidió que no la visiten — solo si hay gente de ese líder ahí.
 *
 * El administrador, el coordinador y el asistente administrativo NO se filtran: su «gente» es la de todo su equipo, así que decir que «son de»
 * un barrio no distingue nada. Con un barrio elegido no se les ofrece una tarea, y el servidor no los rechaza (un administrador o un
 * coordinador todavía puede quedarse con una tarea que él mismo crea; lo que la regla impide es mandarla a un líder que no es de ahí).
 *
 * «Zona» es cualquiera de las que acepta la tarea (barrio, vereda, comuna, corregimiento y, en la meta de registros, el municipio):
 * «la zona y todo lo que cuelga de ella» sale de lib/zonas.js, la misma función que usan las metas.
 *
 * Solo conteos: ni nombres ni datos de las personas de la zona.
 */
'use strict';

const pool = require('../config/db');
const Z = require('./zonas');
const { condicionAlcanceVotantes, parametrosAlcanceVotantes } = require('./alcanceVotantes');

const ROLES_CON_TERRITORIO = ['lider', 'sublider'];
const err = (estado, mensaje) => { const e = new Error(mensaje); e.estado = estado; e.mensaje = mensaje; return e; };

const alcanceDe = (u) => ({ usuarioId: Number(u.id), cargo: u.rol, cargoMadre: null });

/** De estos usuarios, los que tienen en su ficha la zona o algo que cuelga de ella. Set de ids. */
async function conTerritorioEnFicha(usuarioIds, ids) {
  if (!usuarioIds.length || !ids.length) return new Set();
  const consulta = (conPuente) =>
    `SELECT DISTINCT e.usuario_id FROM estructura e
      WHERE e.activo = 1 AND e.usuario_id IN (?)
        AND (e.territorio_id IN (?)${conPuente ? ' OR EXISTS (SELECT 1 FROM estructura_territorios et WHERE et.estructura_id = e.id AND et.territorio_id IN (?))' : ''})`;
  let filas;
  try { [filas] = await pool.query(consulta(true), [usuarioIds, ids, ids]); }
  catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;            // el código llegó antes que init-db: solo el territorio principal
    [filas] = await pool.query(consulta(false), [usuarioIds, ids]);
  }
  return new Set(filas.map((f) => Number(f.usuario_id)));
}

/** Cuántas personas tiene ese usuario en la zona (campaña madre, dentro de su alcance). */
async function personasEnZona(u, ids) {
  const a = alcanceDe(u);
  const [[f]] = await pool.query(
    `SELECT COUNT(*) AS n FROM votantes v WHERE ${condicionAlcanceVotantes(a, 'v')} AND v.rama_aspirante_id IS NULL AND v.territorio_id IN (?)`,
    [...parametrosAlcanceVotantes(a), ids]);
  return Number(f.n);
}

/**
 * De una lista de personas asignables ({ id, nombre, rol }), las que corresponden a la zona, con cuántas personas tienen ahí.
 * Devuelve [{ id, nombre, rol, personas, por_ficha }] ordenada por nombre. Zona sin catálogo (o que no se ve): lista vacía.
 */
async function responsablesDeZona(filas, territorioId) {
  const ids = await Z.zonaYDescendientes(territorioId);
  if (!ids.length) return [];
  const posibles = filas.filter((u) => ROLES_CON_TERRITORIO.includes(u.rol));
  const enFicha = await conTerritorioEnFicha(posibles.map((u) => u.id), ids);
  const salida = [];
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < posibles.length) {
      const u = posibles[siguiente++];
      const personas = await personasEnZona(u, ids);
      const porFicha = enFicha.has(Number(u.id));
      if (personas > 0 || porFicha) salida.push({ id: u.id, nombre: u.nombre, rol: u.rol, personas, por_ficha: porFicha });
    }
  };
  await Promise.all([trabajador(), trabajador(), trabajador(), trabajador()]);
  return salida.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

/**
 * Lo que rechaza el servidor: asignarle una tarea de ESA zona a alguien que no corresponde. 422 con un mensaje claro.
 * No hace nada con una zona sin id de catálogo (zona escrita a mano) ni con quien no tiene territorio por naturaleza.
 */
async function exigirQueCorresponda(usuarioId, territorioId, zonaNombre) {
  if (!territorioId) return;
  const [[u]] = await pool.query('SELECT u.id, u.nombre, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?', [Number(usuarioId)]);
  if (!u || !ROLES_CON_TERRITORIO.includes(u.rol)) return;
  const ids = await Z.zonaYDescendientes(territorioId);
  if (!ids.length) return;
  if ((await conTerritorioEnFicha([u.id], ids)).has(Number(u.id))) return;
  if ((await personasEnZona(u, ids)) > 0) return;
  throw err(422, `${u.nombre} no tiene gente ni territorio asignado en ${zonaNombre || 'ese barrio o vereda'}: elige a alguien de ahí.`);
}

module.exports = { responsablesDeZona, exigirQueCorresponda, ROLES_CON_TERRITORIO };
