/**
 * LA FUENTE «TAREA POR VENCER» DEL MOTOR DE RECORDATORIOS (parche 305, Fase 2). Le dice al motor (lib/recordatorios.js) a quién avisarle de que
 * una tarea abierta vence: tres días antes y el día en que vence, por aviso en la app y SOLO al responsable.
 *
 * APAGADA DE FÁBRICA, con los dos interruptores de siempre: el general (`recordatorios_activos`) y el de cada regla (sembradas en init-db con
 * activo = 0). Respeta el silencio nocturno (20:00–08:00) y la precampaña: el texto de fábrica habla de tareas, tipo y zona, nunca del título.
 *
 * CUÁNDO SALE. A las 08:00 (hora de Colombia) del día que corresponde: la fecha límite menos 3 días, o la propia fecha límite. Si la tarea se
 * creó DESPUÉS de esa hora no se avisa (ya lo supo al asignársela). El aviso de «3 días antes» vale hasta que llega el día; el de «hoy», durante
 * ese día. Una tarea ya hecha, verificada o cancelada no avisa.
 *
 * MÁXIMO 3 AVISOS POR TAREA. Las dos reglas dan dos por fecha límite; si alguien cambia la fecha, la tarea genera otra ocurrencia y podría
 * avisar de nuevo — por eso se cuentan los avisos que ya tiene (lo enviado, lo reclamado y lo diferido) y a los 3 no sale ninguno más.
 *
 * SOLO SI EL RESPONSABLE PUEDE VER EL MÓDULO y su cuenta está activa: un aviso que no lleva a ninguna parte no se manda.
 * LA OCURRENCIA ES `tarea:<id>:<fecha límite>`: el candado del motor (clave única) impide repetir el mismo aviso.
 */
'use strict';

const pool = require('../config/db');

function registrar(R) {
  const { aTexto, deTexto } = R;
  const T = require('./tareas');
  const MAX_AVISOS = 3;
  const OCURRENCIA = `CONCAT('tarea:', t.id, ':', DATE_FORMAT(t.fecha_limite, '%Y-%m-%d'))`;

  async function candidatos(regla, ahora) {
    if (regla.canal !== 'push') return [];                     // solo el equipo, por la app
    // Activar complementos (parche 318): con «Tareas» apagado esta fuente no genera nada.
    if (!(await require('./complementos').complementoActivo('tareas'))) return [];
    const desfase = Number(regla.desfase_min);
    if (!Number.isInteger(desfase) || desfase > 0) return [];
    const ahoraTxt = aTexto(ahora), hoyTxt = ahoraTxt.slice(0, 10);
    const SALE = `DATE_ADD(TIMESTAMP(t.fecha_limite, '08:00:00'), INTERVAL ${desfase} MINUTE)`;
    const vigente = desfase < 0 ? 't.fecha_limite > ?' : 't.fecha_limite >= ?';
    const [filas] = await pool.query(
      `SELECT t.id, t.asignada_a, t.tipo, COALESCE(t.zona_texto, tz.nombre) AS zona, DATE_FORMAT(t.fecha_limite, '%Y-%m-%d') AS fecha, ${OCURRENCIA} AS ocurrencia
         FROM tareas t LEFT JOIN territorios tz ON tz.id = t.territorio_id
        WHERE t.estado IN ('pendiente','en_curso') AND t.fecha_limite IS NOT NULL
          AND ${SALE} <= ? AND ${vigente} AND t.creada_en <= ${SALE}
          AND (SELECT COUNT(*) FROM recordatorio_envios re
                WHERE re.destinatario_tipo = 'usuario' AND re.ocurrencia LIKE CONCAT('tarea:', t.id, ':%')
                  AND re.estado IN ('enviado','enviando','reclamado','diferido')
                  AND NOT (re.regla_id = ? AND re.ocurrencia = ${OCURRENCIA})) < ${MAX_AVISOS}
          AND NOT EXISTS (
              SELECT 1 FROM recordatorio_envios re
               WHERE re.regla_id = ? AND re.destinatario_tipo = 'usuario' AND re.destinatario_id = t.asignada_a AND re.ocurrencia = ${OCURRENCIA}
                 AND NOT (re.estado IN ('reclamado','diferido') AND re.proximo_intento IS NOT NULL AND re.proximo_intento <= ?))
        ORDER BY t.fecha_limite, t.id LIMIT 300`, [ahoraTxt, hoyTxt, regla.id, regla.id, ahoraTxt]);
    if (!filas.length) return [];
    const ids = [...new Set(filas.map((f) => f.asignada_a))];
    const [us] = await pool.query('SELECT u.id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id IN (?) AND u.activo = 1', [ids]);
    const conAcceso = new Set();
    for (const u of us) { if ((await T.permisosDe({ id: u.id, rol: u.rol })).ver) conAcceso.add(Number(u.id)); }
    return filas.filter((f) => conAcceso.has(Number(f.asignada_a))).map((f) => {
      const sale = deTexto(`${f.fecha} 08:00:00`);
      return {
        destinatario_tipo: 'usuario', destinatario_id: Number(f.asignada_a), ocurrencia: f.ocurrencia,
        debe_salir_en: new Date(sale.getTime() + desfase * 60000),
        vence_en: desfase < 0 ? deTexto(`${f.fecha} 00:00:00`) : deTexto(`${f.fecha} 23:59:59`),
        motivo_vencido: 'Ya llegó el día de la fecha límite: este aviso se descartó.',
        datos: { tipo: (T.TIPOS[f.tipo] || {}).corta || 'libre', zona: String(f.zona || 'tu zona').slice(0, 40) },
      };
    });
  }

  /** Lo que quedó esperando un reintento y ya no tiene sentido (la tarea se hizo, se canceló, cambió de responsable o de fecha) se descarta con su motivo. */
  async function limpiar() {
    const [pend] = await pool.query(
      `SELECT r.id, r.ocurrencia, r.destinatario_id FROM recordatorio_envios r JOIN recordatorio_reglas g ON g.id = r.regla_id
        WHERE g.tipo = 'tarea_vence' AND r.estado IN ('reclamado','diferido')`);
    let n = 0;
    // Con el complemento apagado, lo que quedó esperando un reintento tampoco sale: se descarta con su motivo (si se enciende, vuelve a generarse).
    const apagado = !(await require('./complementos').complementoActivo('tareas'));
    for (const p of pend) {
      const m = /^tarea:(\d+):(\d{4}-\d{2}-\d{2})$/.exec(String(p.ocurrencia));
      if (!m) continue;
      let motivo = null;
      let t = null;
      if (apagado) motivo = 'El complemento «Tareas» está apagado: el aviso se canceló.';
      else [[t]] = await pool.query(`SELECT estado, asignada_a, DATE_FORMAT(fecha_limite, '%Y-%m-%d') AS fecha FROM tareas WHERE id = ?`, [Number(m[1])]);
      if (apagado) { /* ya tiene su motivo */ }
      else if (!t) motivo = 'La tarea ya no existe: el aviso se canceló.';
      else if (!T.ABIERTAS.includes(t.estado)) motivo = 'La tarea ya no está abierta: el aviso se canceló.';
      else if (Number(t.asignada_a) !== Number(p.destinatario_id)) motivo = 'La tarea cambió de responsable: el aviso se canceló.';
      else if (t.fecha !== m[2]) motivo = 'La tarea cambió de fecha límite: el aviso se canceló.';
      if (!motivo) continue;
      const [r] = await pool.query(`UPDATE recordatorio_envios SET estado = 'omitido', motivo = ?, proximo_intento = NULL WHERE id = ? AND estado IN ('reclamado','diferido')`, [motivo, p.id]);
      n += r.affectedRows;
    }
    return n;
  }

  R.registrarTipo('tarea_vence', {
    etiqueta: 'Tarea por vencer',
    complemento: 'tareas',
    variables: ['nombre', 'candidato', 'eslogan', 'tipo', 'zona'],
    conBaja: false, omiteSiYaVoto: false,
    candidatos: ({ regla, ahora }) => candidatos(regla, ahora),
    limpiar: () => limpiar(),
  });
}

module.exports = { registrar };
