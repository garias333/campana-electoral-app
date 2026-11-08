/**
 * LAS TAREAS QUE SE MIDEN SOLAS (parche 306): la «meta de registros» y la «reunión» enlazada a un evento.
 *
 * META DE REGISTROS — cuántos registros logra el RESPONSABLE entre `desde` y `hasta` (= la fecha límite), en una zona si la hay.
 *   · LA CUENTA ES LA DEL PANEL DEL LÍDER. Se usa `condicionAlcanceVotantes` (lib/alcanceVotantes.js) con el alcance del RESPONSABLE —no el
 *     de quien mira—, la misma condición con la que `lib/panelLider.js` cuenta «mis inscritos». Si esta cifra y la de su panel pudieran
 *     diferir, un líder vería «32 de 40» en una pantalla y «30» en otra (ya mordió una vez; ver el encabezado de lib/avanceLideres.js).
 *   · NO CUENTAN LAS FICHAS POR ENLACE SIN CONFIRMAR (`origen = 'enlace_lider'` y sin `consentimiento_confirmado_en`): son personas que se
 *     anotaron solas y aún no autorizaron. El panel del líder las muestra aparte; para una meta no valen todavía. Decisión del 8 de nov. de 2026.
 *   · LA ZONA incluye sus descendientes (lib/zonas.js): una comuna cuenta los registros de sus barrios.
 *   · LA FECHA es la de creación de la ficha (`created_at`, hora de Colombia): de `desde` a `hasta`, ambos días completos.
 *   · «HECHA» LLEGA SOLA al alcanzar la meta (`cerrarMetasAlcanzadas`), sin evidencia y sin verificación obligatoria: un número no se verifica.
 *
 * REUNIÓN — el avance es `evento_asistentes.asistio = 1` contra `eventos.meta_asistentes`. La tarea la termina quien la tiene (con o sin
 * llegar a la meta) y se verifica como cualquiera: aquí el avance solo se MUESTRA. Quien mira el avance tiene que poder ver el evento
 * (lib/alcanceEventos.js, parche 305); si no, ve la tarea pero no sus cifras.
 */
'use strict';

const pool = require('../config/db');
const { condicionAlcanceVotantes, parametrosAlcanceVotantes } = require('./alcanceVotantes');
const { zonaYDescendientes } = require('./zonas');
const { alcanceEventos } = require('./alcanceEventos');

/** Excluye las fichas por enlace que aún no confirman su autorización. */
const SIN_ENLACE_SIN_CONFIRMAR = `NOT (v.origen = 'enlace_lider' AND v.consentimiento_confirmado_en IS NULL)`;

/**
 * El alcance de una persona como lo armaría calcularAlcance si ella hubiera iniciado sesión (middleware/auth.js): el administrador es la
 * campaña madre; el resto, su rol y su id. null si la cuenta no existe o está inactiva (no tiene alcance: no cuenta nada).
 */
async function alcanceDePersona(usuarioId) {
  const [[u]] = await pool.query(`SELECT u.id, u.activo, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`, [usuarioId]);
  if (!u || !Number(u.activo)) return null;
  let cargoMadre = null;
  try { cargoMadre = await require('../config/cargoMadre').cargoDeLaMadre(); } catch (_) { /* sin cargo: el filtro de la madre no se aplica */ }
  if (u.rol === 'admin') return { cargo: 'madre', cargoMadre };
  return { usuarioId: u.id, cargo: u.rol, cargoMadre };
}

const porcentaje = (a, m) => (m > 0 ? Math.min(100, Math.round((a / m) * 100)) : 0);

/**
 * El avance de una meta de registros: { actual, meta, pct, desde, hasta, zona_ids }. `null` en `actual` si no se puede medir (cuenta inactiva).
 * `tarea` trae asignada_a, meta_n, desde (o creada_en), fecha_limite y territorio_id.
 */
async function avanceRegistros(tarea) {
  const meta = Number(tarea.meta_n) || 0;
  const desde = String(tarea.desde || tarea.creada_en || '').slice(0, 10);
  const hasta = String(tarea.fecha_limite || '').slice(0, 10);
  const base = { meta, desde, hasta, pct: 0, actual: null };
  const alcance = await alcanceDePersona(tarea.asignada_a);
  if (!alcance || !desde || !hasta) return base;
  const cond = [condicionAlcanceVotantes(alcance, 'v'), SIN_ENLACE_SIN_CONFIRMAR, 'v.created_at >= ?', 'v.created_at < DATE_ADD(?, INTERVAL 1 DAY)'];
  const valores = [...parametrosAlcanceVotantes(alcance), `${desde} 00:00:00`, hasta];
  if (tarea.territorio_id) {
    const zonas = await zonaYDescendientes(tarea.territorio_id);
    if (!zonas.length) return { ...base, actual: 0 };       // una zona que no se ve no cuenta nada (y nunca cuenta «todo»)
    cond.push('v.territorio_id IN (?)'); valores.push(zonas);
  }
  const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM votantes v WHERE ${cond.join(' AND ')}`, valores);
  const actual = Number(r.n);
  return { ...base, actual, pct: porcentaje(actual, meta) };
}

/**
 * El avance de una reunión: { actual, meta, pct, evento } o null. `lector` es el alcance de quien mira: si no puede ver el evento, null.
 * `evento` trae solo título y fecha.
 */
async function avanceReunion(tarea, lector) {
  if (!tarea.evento_id) return null;
  const a = alcanceEventos(lector, 'e');
  const [[e]] = await pool.query(
    `SELECT e.id, e.titulo, DATE_FORMAT(e.fecha_inicio, '%Y-%m-%d') AS fecha, e.meta_asistentes,
            (SELECT COUNT(*) FROM evento_asistentes ea WHERE ea.evento_id = e.id AND ea.asistio = 1) AS asistieron,
            (SELECT COUNT(*) FROM evento_asistentes ea WHERE ea.evento_id = e.id) AS invitados
       FROM eventos e WHERE e.id = ? AND ${a.sql}`, [tarea.evento_id, ...a.valores]);
  if (!e) return null;
  const meta = Number(e.meta_asistentes) || 0;
  return { actual: Number(e.asistieron), invitados: Number(e.invitados), meta, pct: porcentaje(Number(e.asistieron), meta), evento: { id: e.id, titulo: e.titulo, fecha: e.fecha } };
}

/**
 * Pone «hecha» a las metas de registros abiertas que ya llegaron a su meta. Lo corre el reloj de lib/tareasMantenimiento.js y, para no
 * esperarlo, quien abre su lista. IDEMPOTENTE: el UPDATE exige que siga abierta. Deja su apunte en el historial, sin usuario (lo hizo el sistema).
 * `filtro`: { tareaId } o { asignadaA } para acotar. Devuelve cuántas cerró.
 */
async function cerrarMetasAlcanzadas(filtro = {}) {
  const cond = [`t.tipo = 'meta_registros'`, `t.estado IN ('pendiente','en_curso')`, 't.meta_n IS NOT NULL', 't.fecha_limite IS NOT NULL'];
  const valores = [];
  if (filtro.tareaId) { cond.push('t.id = ?'); valores.push(Number(filtro.tareaId)); }
  if (filtro.asignadaA) { cond.push('t.asignada_a = ?'); valores.push(Number(filtro.asignadaA)); }
  const [filas] = await pool.query(`SELECT t.* FROM tareas t WHERE ${cond.join(' AND ')} ORDER BY t.id LIMIT 500`, valores);
  let n = 0;
  for (const t of filas) {
    const av = await avanceRegistros(t);
    if (av.actual === null || av.actual < av.meta) continue;
    const cx = await pool.getConnection();
    try {
      await cx.beginTransaction();
      const [r] = await cx.query(
        `UPDATE tareas SET estado = 'hecha', hecha_en = NOW(), hecha_nota = ?, iniciada_en = COALESCE(iniciada_en, NOW()), no_pudo_en = NULL, no_pudo_nota = NULL
          WHERE id = ? AND estado IN ('pendiente','en_curso')`, [`Llegó a la meta: ${av.actual} de ${av.meta} registros.`, t.id]);
      if (r.affectedRows) {
        await cx.query(`INSERT INTO tarea_historial (tarea_id, tipo, estado_antes, estado_despues, nota, usuario_id, usuario_nombre) VALUES (?, 'hecha', ?, 'hecha', ?, NULL, 'Automático')`,
          [t.id, t.estado, `Llegó a la meta: ${av.actual} de ${av.meta} registros.`]);
        n++;
      }
      await cx.commit();
    } catch (e) {
      try { await cx.rollback(); } catch (_) { /* ya cerrada */ }
      console.error('[tareas] No se pudo cerrar una meta:', e.code || e.message);
    } finally { cx.release(); }
  }
  return n;
}

module.exports = { SIN_ENLACE_SIN_CONFIRMAR, alcanceDePersona, avanceRegistros, avanceReunion, cerrarMetasAlcanzadas, porcentaje };
