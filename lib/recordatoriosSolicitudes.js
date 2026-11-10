/**
 * LA FUENTE «SOLICITUD SIN MOVIMIENTO» DEL MOTOR DE RECORDATORIOS (parche 304). Le dice al motor (lib/recordatorios.js) quién tiene una
 * solicitud abierta que lleva N días sin cambios. N sale de configuracion_campana.solicitud_dias_sin_movimiento (15 de fábrica).
 *
 * APAGADA DE FÁBRICA, con los dos interruptores de siempre: el general de los recordatorios y el de la regla (sembrada en init-db, activo = 0).
 *
 * LA OCURRENCIA ES `solicitud:<id>:<último movimiento>`. Mientras la solicitud siga quieta se avisa UNA vez (la clave única del motor es el
 * candado); si alguien la mueve y vuelve a quedar quieta, es otra ocurrencia y se vuelve a avisar. Si cambia el responsable, el cambio queda
 * en el historial, así que también es otra ocurrencia, y el aviso va a la persona nueva.
 *
 * SOLO AL RESPONSABLE, y solo si puede ver el módulo: un aviso que no lleva a ninguna parte no se manda. Las solicitudes sin responsable
 * no avisan a nadie (no hay a quién): el panel las cuenta.
 *
 * A DIFERENCIA DE UN EVENTO, ESTO NO CADUCA. Un recordatorio de evento pierde sentido cuando el evento empieza; una solicitud quieta sigue
 * quieta. Por eso `vence_en` queda muy lejos y lo que se haya acumulado mientras el motor estaba apagado sale en cuanto se enciende, a razón
 * de MAX_POR_VUELTA por minuto, en vez de descartarse en silencio.
 */
'use strict';

const pool = require('../config/db');

function registrar(R) {
  const { aTexto, deTexto } = R;
  const Seg = require('./solicitudesSeguimiento');
  const S = require('./solicitudes');
  const DIA = 24 * 60 * 60 * 1000;
  const ULT = Seg.ULTIMO_MOVIMIENTO;
  const MARCA = `DATE_FORMAT(${ULT}, '%Y-%m-%dT%H:%i')`;

  async function candidatos(regla, ahora) {
    if (regla.canal !== 'push') return [];       // solo el equipo, y solo por la app: nunca al ciudadano
    // Activar complementos (parche 318): con «Solicitudes ciudadanas» apagado esta fuente no genera nada.
    if (!(await require('./complementos').complementoActivo('solicitudes'))) return [];
    const dias = await Seg.diasSinMovimiento();
    const ahoraTxt = aTexto(ahora);
    const [filas] = await pool.query(
      `SELECT s.id, s.responsable_id, c.nombre AS categoria, s.barrio_texto,
              DATE_FORMAT(${ULT}, '%Y-%m-%d %H:%i:%s') AS ultimo, ${MARCA} AS marca
         FROM solicitudes s JOIN solicitud_categorias c ON c.id = s.categoria_id
        WHERE s.estado <> 'cerrada' AND s.responsable_id IS NOT NULL
          AND ${ULT} <= DATE_SUB(?, INTERVAL ? DAY)
          AND NOT EXISTS (
              SELECT 1 FROM recordatorio_envios re
               WHERE re.regla_id = ? AND re.destinatario_tipo = 'usuario' AND re.destinatario_id = s.responsable_id
                 AND re.ocurrencia = CONCAT('solicitud:', s.id, ':', ${MARCA})
                 AND NOT (re.estado IN ('reclamado','diferido') AND re.proximo_intento IS NOT NULL AND re.proximo_intento <= ?))
        ORDER BY ${ULT}, s.id LIMIT 300`, [ahoraTxt, dias, regla.id, ahoraTxt]);
    if (!filas.length) return [];
    // Solo a quien puede ver el módulo y tiene la cuenta activa.
    const ids = [...new Set(filas.map((f) => f.responsable_id))];
    const [us] = await pool.query(`SELECT u.id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id IN (?) AND u.activo = 1`, [ids]);
    const conAcceso = new Set();
    for (const u of us) { if ((await S.permisosDe({ id: u.id, rol: u.rol })).ver) conAcceso.add(Number(u.id)); }
    const lejos = new Date(ahora.getTime() + 3650 * DIA);
    return filas.filter((f) => conAcceso.has(Number(f.responsable_id))).map((f) => {
      const desde = deTexto(f.ultimo);
      return {
        destinatario_tipo: 'usuario', destinatario_id: Number(f.responsable_id), ocurrencia: `solicitud:${f.id}:${f.marca}`,
        debe_salir_en: new Date(desde.getTime() + dias * DIA),
        vence_en: lejos, motivo_vencido: 'La solicitud ya no está quieta.',
        datos: {
          categoria: String(f.categoria || '').slice(0, 30), barrio: String(f.barrio_texto || 'su barrio').slice(0, 30),
          dias: Math.max(dias, Math.floor((ahora.getTime() - desde.getTime()) / DIA)),
        },
      };
    });
  }

  /**
   * Lo que quedó esperando un reintento y ya no tiene sentido (la solicitud se cerró, se movió o cambió de responsable) se descarta con
   * su motivo. Solo toca filas en espera: lo ya enviado es historia.
   */
  async function limpiar() {
    const [pend] = await pool.query(
      `SELECT r.id, r.ocurrencia, r.destinatario_id FROM recordatorio_envios r JOIN recordatorio_reglas g ON g.id = r.regla_id
        WHERE g.tipo = 'solicitud_sin_movimiento' AND r.estado IN ('reclamado','diferido')`);
    let n = 0;
    // Con el complemento apagado, lo que quedó esperando un reintento tampoco sale: se descarta con su motivo (si se enciende, vuelve a generarse).
    const apagado = !(await require('./complementos').complementoActivo('solicitudes'));
    for (const p of pend) {
      const m = /^solicitud:(\d+):(.+)$/.exec(String(p.ocurrencia));
      if (!m) continue;
      let motivo = null;
      let s = null;
      if (apagado) motivo = 'El complemento «Solicitudes ciudadanas» está apagado: el aviso se canceló.';
      else [[s]] = await pool.query(`SELECT s.estado, s.responsable_id, ${MARCA} AS marca FROM solicitudes s WHERE s.id = ?`, [Number(m[1])]);
      if (apagado) { /* ya tiene su motivo */ }
      else if (!s) motivo = 'La solicitud ya no existe: el aviso se canceló.';
      else if (s.estado === 'cerrada') motivo = 'La solicitud se cerró: el aviso se canceló.';
      else if (Number(s.responsable_id) !== Number(p.destinatario_id)) motivo = 'La solicitud cambió de responsable: el aviso se canceló.';
      else if (s.marca !== m[2]) motivo = 'La solicitud tuvo movimiento: el aviso se canceló.';
      if (!motivo) continue;
      const [r] = await pool.query(
        `UPDATE recordatorio_envios SET estado = 'omitido', motivo = ?, proximo_intento = NULL WHERE id = ? AND estado IN ('reclamado','diferido')`, [motivo, p.id]);
      n += r.affectedRows;
    }
    return n;
  }

  R.registrarTipo('solicitud_sin_movimiento', {
    etiqueta: 'Solicitud ciudadana sin movimiento',
    complemento: 'solicitudes',
    variables: ['nombre', 'candidato', 'eslogan', 'categoria', 'barrio', 'dias'],
    conBaja: false, omiteSiYaVoto: false,
    candidatos: ({ regla, ahora }) => candidatos(regla, ahora),
    limpiar: () => limpiar(),
  });
}

module.exports = { registrar };
