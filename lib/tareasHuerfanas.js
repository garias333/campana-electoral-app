/**
 * TAREAS «POR REASIGNAR» (parche 306): la tarea ABIERTA cuyo responsable ya no puede tenerla. NADA la reasigna sola: se le avisa por push a quien
 * la asignó y queda en la bandeja «Por reasignar», donde una persona decide a quién pasarla.
 *
 * CUÁNDO UNA TAREA ES HUÉRFANA (estados pendiente, en curso y hecha; las cerradas no):
 *   · cuenta_inactiva ... la cuenta de su responsable se desactivó
 *   · otra_campana ...... su responsable ahora cuelga de la rama de otro aspirante (o dejó la que tenía)
 *   · fuera_de_rama ..... quien la asignó (coordinador o líder) ya no podría asignársela: el responsable cambió de supervisor o dejó la estructura
 * Quien asignó siendo administrador asigna a cualquiera de su campaña, así que solo cuentan las dos primeras.
 *
 * `revisar()` COMPARA, no adivina: marca `huerfana_desde` la primera vez y avisa UNA vez por tarea; si el motivo desaparece (se reactivó la cuenta,
 * volvió a su rama o la reasignaron), la desmarca. Lo corre el reloj de lib/tareasMantenimiento.js y se dispara al desactivar una cuenta
 * (routes/usuarios.routes.js) o cambiar a alguien de supervisor (lib/ramas.js), sin esperar el reloj.
 *
 * EL AVISO dice cuántas son y dónde verlas; nunca títulos ni nombres. Va solo a quien asignó (si su cuenta sigue activa y ve el módulo); el
 * administrador y el coordinador las ven igual en la bandeja, que se acota con el mismo alcance de gestión.
 */
'use strict';

const pool = require('../config/db');
const { asignablesPara } = require('./alcanceTareas');
const Avisos = require('./tareasAvisos');

const MOTIVOS = { cuenta_inactiva: 'La cuenta de su responsable está inactiva.', otra_campana: 'Su responsable ahora es de otra campaña.', fuera_de_rama: 'Su responsable ya no es de tu equipo.' };
let corriendo = false;

async function ramaDe(id) {
  try { return (await require('./ramas').aspiranteDe(pool, id)) || null; } catch (_) { return null; }
}

/** ¿Podría `creador` (una fila con id, rol y activo) asignarle hoy una tarea a `asignadoId`? Memoizado por la pasada. */
async function podriaAsignar(creador, asignadoId, memo) {
  const clave = `${creador.id}>${asignadoId}`;
  if (memo.has(clave)) return memo.get(clave);
  let ok = true;
  if (creador.rol === 'coordinador' || creador.rol === 'lider') {
    const a = asignablesPara({ cargo: creador.rol, usuarioId: creador.id });
    if (a) {
      const [[x]] = await pool.query(`SELECT 1 AS ok FROM usuarios u WHERE u.id = ? AND ${a.sql}`, [asignadoId, ...a.valores]);
      ok = !!x;
    }
  }
  memo.set(clave, ok);
  return ok;
}

/**
 * Una pasada. Devuelve { revisadas, nuevas, resueltas, avisos }. `ahora` no se usa (las fechas las pone la base): queda por simetría con las pruebas.
 * Una pasada a la vez: si ya hay una en curso, la nueva sale sin hacer nada.
 */
async function revisar() {
  if (corriendo) return { revisadas: 0, nuevas: 0, resueltas: 0, avisos: 0, omitida: true };
  corriendo = true;
  try {
    const [tareas] = await pool.query(
      `SELECT t.id, t.creada_por, t.asignada_a, t.rama_aspirante_id, t.huerfana_desde, t.huerfana_motivo,
              ua.id AS ua_id, ua.activo AS ua_activo, uc.id AS uc_id, uc.activo AS uc_activo, rc.nombre AS creador_rol
         FROM tareas t LEFT JOIN usuarios ua ON ua.id = t.asignada_a LEFT JOIN usuarios uc ON uc.id = t.creada_por LEFT JOIN roles rc ON rc.id = uc.rol_id
        WHERE t.estado IN ('pendiente','en_curso','hecha')`);
    const ramas = new Map(), memo = new Map();
    const nuevasPorCreador = new Map();
    let nuevas = 0, resueltas = 0;
    for (const t of tareas) {
      let motivo = null;
      if (!t.ua_id || !Number(t.ua_activo)) motivo = 'cuenta_inactiva';
      else {
        if (!ramas.has(t.asignada_a)) ramas.set(t.asignada_a, await ramaDe(t.asignada_a));
        if ((ramas.get(t.asignada_a) || null) !== (t.rama_aspirante_id || null)) motivo = 'otra_campana';
        else if (t.uc_id && Number(t.uc_activo) && Number(t.creada_por) !== Number(t.asignada_a)
          && !(await podriaAsignar({ id: t.creada_por, rol: t.creador_rol }, t.asignada_a, memo))) motivo = 'fuera_de_rama';
      }
      if (motivo && !t.huerfana_desde) {
        const [r] = await pool.query(`UPDATE tareas SET huerfana_desde = NOW(), huerfana_motivo = ? WHERE id = ? AND huerfana_desde IS NULL`, [motivo, t.id]);
        if (r.affectedRows) {
          nuevas++;
          await pool.query(`INSERT INTO tarea_historial (tarea_id, tipo, nota, usuario_id, usuario_nombre) VALUES (?, 'huerfana', ?, NULL, 'Automático')`, [t.id, MOTIVOS[motivo]]);
          if (t.uc_id && Number(t.uc_activo)) nuevasPorCreador.set(t.creada_por, (nuevasPorCreador.get(t.creada_por) || 0) + 1);
        }
      } else if (motivo && t.huerfana_motivo !== motivo) {
        await pool.query('UPDATE tareas SET huerfana_motivo = ? WHERE id = ?', [motivo, t.id]);
      } else if (!motivo && t.huerfana_desde) {
        const [r] = await pool.query(`UPDATE tareas SET huerfana_desde = NULL, huerfana_motivo = NULL WHERE id = ? AND huerfana_desde IS NOT NULL`, [t.id]);
        if (r.affectedRows) {
          resueltas++;
          await pool.query(`INSERT INTO tarea_historial (tarea_id, tipo, nota, usuario_id, usuario_nombre) VALUES (?, 'huerfana_resuelta', 'Ya no está por reasignar.', NULL, 'Automático')`, [t.id]);
        }
      }
    }
    let avisos = 0;
    for (const [creadorId, n] of nuevasPorCreador) { if ((await Avisos.avisarPorReasignar(creadorId, n)).enviado) avisos++; }
    return { revisadas: tareas.length, nuevas, resueltas, avisos };
  } finally { corriendo = false; }
}

/** Para llamar y olvidarse (después de responder): nunca lanza. */
function revisarEnSegundoPlano(motivo) {
  revisar().then((r) => { if (r.nuevas || r.resueltas) console.log(`Tareas por reasignar tras ${motivo}: ${r.nuevas} nueva(s), ${r.resueltas} resuelta(s).`); })
    .catch((err) => console.error(`No se pudo revisar las tareas por reasignar tras ${motivo}:`, err.code || err.message));
}

module.exports = { revisar, revisarEnSegundoPlano, MOTIVOS };
