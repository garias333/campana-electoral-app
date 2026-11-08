/**
 * LAS FUENTES DE CANDIDATOS DE LOS RECORDATORIOS (Fases 2 y 3). El motor (lib/recordatorios.js) no sabe de eventos ni de votos:
 * le pregunta a cada tipo «quiénes y cuándo les toca» y esa respuesta sale de aquí.
 *
 *   evento             «X horas antes» de un evento. Equipo invitado o inscrito → push. Votantes asistentes → SMS o correo
 *                      (el motor les exige consentimiento estricto al enviar; aquí solo se adelanta el filtro).
 *   dia_d_ya_votaste   El día de la elección, a la hora H de la regla: votantes que TODAVÍA no han votado.
 *
 * UNA FUENTE SOLO DEVUELVE LO QUE FALTA. Cada consulta descarta lo que ya tiene fila en recordatorio_envios (salvo los reintentos
 * que ya les toca), así que una lista grande no se vuelve a recorrer y a «insertar» cada 60 s. La clave única del motor sigue
 * siendo el candado de verdad; esto es solo para no gastar la base.
 */
'use strict';

const pool = require('../config/db');

function registrar(R) {
  const { aTexto, deTexto, hoyTexto, formatoFecha, formatoHora, TIPOS } = R;

  /* ------------------------------------------------------------------------------------------------------------ EVENTOS */

  const OCURRENCIA_EVENTO = `CONCAT('evento:', e.id, ':', DATE_FORMAT(e.fecha_inicio, '%Y-%m-%dT%H:%i'))`;

  /** Los candidatos de una regla «X horas antes»: quién y cuándo (ver el encabezado del archivo). */
  async function candidatos(regla, ahora) {
    const desfase = Number(regla.desfase_min);
    if (!Number.isInteger(desfase) || desfase >= 0) return [];
    // Se incluyen los eventos que EMPEZARON hace poco (hasta 12 h): si el recordatorio no pudo salir a tiempo (silencio, tope, proceso
    // caído), el motor los registra como «omitido» con su motivo («el evento ya empezó») en vez de que simplemente no aparezcan.
    const hasta = new Date(ahora.getTime() + (-desfase) * 60000);
    const esPush = regla.canal === 'push';
    const col = esPush ? 'a.usuario_id' : 'a.votante_id';
    const tipoDest = esPush ? 'usuario' : 'votante';
    const filtroPersona = esPush
      ? 'a.usuario_id IS NOT NULL'
      : `a.votante_id IS NOT NULL AND EXISTS (SELECT 1 FROM votantes v WHERE v.id = a.votante_id AND v.no_contactar = 0 AND v.${regla.canal === 'sms' ? 'consentimiento_sms' : 'consentimiento_email'} = 1)`;
    const ahoraTxt = aTexto(ahora);
    const [filas] = await pool.query(
      `SELECT e.id AS evento_id, e.titulo, DATE_FORMAT(e.fecha_inicio, '%Y-%m-%d %H:%i:%s') AS fecha_inicio, e.lugar, ${col} AS destino,
              ${OCURRENCIA_EVENTO} AS ocurrencia
         FROM eventos e JOIN evento_asistentes a ON a.evento_id = e.id
        WHERE e.estado = 'programado' AND e.fecha_inicio > DATE_SUB(?, INTERVAL 12 HOUR) AND e.fecha_inicio <= ?
          AND ${filtroPersona}
          AND e.created_at <= DATE_ADD(e.fecha_inicio, INTERVAL ? MINUTE)
          AND NOT EXISTS (
              SELECT 1 FROM recordatorio_envios re
               WHERE re.regla_id = ? AND re.destinatario_tipo = ? AND re.destinatario_id = ${col}
                 AND re.ocurrencia = ${OCURRENCIA_EVENTO}
                 AND NOT (re.estado IN ('reclamado','diferido') AND re.proximo_intento IS NOT NULL AND re.proximo_intento <= ?))
        ORDER BY e.fecha_inicio, e.id LIMIT 500`,
      [ahoraTxt, aTexto(hasta), desfase, regla.id, tipoDest, ahoraTxt]);
    const vistos = new Set();
    const lista = [];
    for (const f of filas) {
      const clave = `${f.ocurrencia}|${f.destino}`;
      if (vistos.has(clave)) continue;       // la misma persona dos veces en el mismo evento
      vistos.add(clave);
      const inicio = deTexto(f.fecha_inicio);
      lista.push({
        destinatario_tipo: tipoDest, destinatario_id: Number(f.destino), ocurrencia: f.ocurrencia,
        debe_salir_en: new Date(inicio.getTime() + desfase * 60000),
        // El recordatorio de un evento sale mientras el evento no haya empezado, aunque lo difieran el tope o el silencio.
        vence_en: inicio, motivo_vencido: 'El evento ya empezó: el recordatorio se descartó.',
        datos: { evento: f.titulo, fecha: formatoFecha(inicio), hora: formatoHora(inicio), lugar: f.lugar || '' },
      });
    }
    return lista;
  }

  /**
   * Lo que quedó esperando (reclamado o diferido) de un evento que cambió de fecha, se canceló, se realizó o se borró NO debe salir:
   *   · movido → su recordatorio de la fecha vieja se descarta; la fecha nueva genera uno propio (otra ocurrencia).
   *   · cancelado / realizado / borrado → se descarta.
   * `eventoId` limita la limpieza a un evento (lo llama eventos.routes.js al editar o borrar, sin esperar la vuelta de 60 s).
   */
  async function limpiarEventos({ eventoId = null, ahora = R.deps.reloj() } = {}) {
    const [pend] = await pool.query(
      `SELECT r.id, r.ocurrencia FROM recordatorio_envios r JOIN recordatorio_reglas g ON g.id = r.regla_id
        WHERE g.tipo = 'evento' AND r.estado IN ('reclamado','diferido')
          ${eventoId ? `AND r.ocurrencia LIKE CONCAT('evento:', ?, ':%')` : ''}`, eventoId ? [eventoId] : []);
    if (!pend.length) return 0;
    const ids = [...new Set(pend.map((p) => Number(String(p.ocurrencia).split(':')[1])).filter(Boolean))];
    const [evs] = await pool.query(
      `SELECT id, estado, DATE_FORMAT(fecha_inicio, '%Y-%m-%dT%H:%i') AS f FROM eventos WHERE id IN (?)`, [ids.length ? ids : [0]]);
    const porId = new Map(evs.map((e) => [e.id, e]));
    let n = 0;
    for (const p of pend) {
      if (!/^evento:\d+:/.test(String(p.ocurrencia))) continue;   // solo las ocurrencias de eventos reales
      const partes = String(p.ocurrencia).split(':');           // evento:<id>:<2026-11-20T10:00>  (la hora trae «:»)
      const id = Number(partes[1]);
      const fechaDeLaOcurrencia = partes.slice(2).join(':');
      const e = porId.get(id);
      let motivo = null;
      if (!e) motivo = 'El evento ya no existe: el recordatorio se canceló.';
      else if (e.estado !== 'programado') motivo = `El evento está ${e.estado === 'cancelado' ? 'cancelado' : 'marcado como realizado'}: el recordatorio se canceló.`;
      else if (e.f !== fechaDeLaOcurrencia) motivo = 'El evento cambió de fecha: este recordatorio se canceló y se recalcula con la fecha nueva.';
      else if (e.f.replace('T', ' ') <= aTexto(ahora).slice(0, 16)) motivo = 'El evento ya empezó: el recordatorio se descartó.';
      if (!motivo) continue;
      const [r] = await pool.query(
        `UPDATE recordatorio_envios SET estado = 'omitido', motivo = ?, proximo_intento = NULL WHERE id = ? AND estado IN ('reclamado','diferido')`, [motivo, p.id]);
      n += r.affectedRows;
    }
    return n;
  }

  R.registrarTipo('evento', {
    candidatos: ({ regla, ahora }) => candidatos(regla, ahora),
    limpiar: ({ ahora }) => limpiarEventos({ ahora }),
  });
  R.limpiarRecordatoriosDeEvento = (eventoId) => limpiarEventos({ eventoId });

  /* -------------------------------------------------------------------------------------------------- «¿YA VOTASTE?» */

  async function candidatosYaVotaste({ regla, ahora }) {
    const [[c]] = await pool.query(`SELECT DATE_FORMAT(fecha_eleccion, '%Y-%m-%d') AS f FROM configuracion_campana WHERE id = 1`);
    // SOLO EL DÍA DE LA ELECCIÓN.
    if (!c || !c.f || c.f !== hoyTexto(ahora)) return [];
    const hora = String(regla.hora_dia || '').slice(0, 8);
    if (!/^\d{2}:\d{2}/.test(hora)) return [];
    const debe = deTexto(`${c.f} ${hora.length === 5 ? hora + ':00' : hora}`);
    if (ahora.getTime() < debe.getTime()) return [];
    const jornada = await require('./jornadaDiaD').leerJornada(pool);
    const vence = deTexto(`${c.f} ${jornada.jornada_cierre}:00`);
    if (ahora.getTime() > vence.getTime()) return [];
    const ocurrencia = `dia:${c.f}`;
    // Los que NO han votado AL MOMENTO DE ENVIAR (el motor lo vuelve a leer ficha por ficha), con SMS autorizado y sin baja.
    const [filas] = await pool.query(
      `SELECT v.id, v.puesto_votacion
         FROM votantes v LEFT JOIN votante_votos vv ON vv.votante_id = v.id
        WHERE vv.votante_id IS NULL AND v.consentimiento_sms = 1 AND v.no_contactar = 0
          AND v.telefono IS NOT NULL AND TRIM(v.telefono) <> ''
          AND NOT EXISTS (
              SELECT 1 FROM recordatorio_envios re
               WHERE re.regla_id = ? AND re.destinatario_tipo = 'votante' AND re.destinatario_id = v.id AND re.ocurrencia = ?
                 AND NOT (re.estado IN ('reclamado','diferido') AND re.proximo_intento IS NOT NULL AND re.proximo_intento <= ?))
        ORDER BY v.id LIMIT 500`,
      [regla.id, ocurrencia, aTexto(ahora)]);
    return filas.map((f) => ({
      destinatario_tipo: 'votante', destinatario_id: f.id, ocurrencia, debe_salir_en: debe,
      vence_en: vence, motivo_vencido: 'Se cerró la jornada: ya no tiene sentido preguntar si votó.',
      datos: { puesto: f.puesto_votacion || '' },
    }));
  }

  /** Lo que quedó esperando del «¿ya votaste?» cuando la jornada se cierra (o el día pasó) ya no tiene sentido: se descarta con motivo. */
  async function limpiarYaVotaste({ ahora }) {
    const [pend] = await pool.query(
      `SELECT r.id, r.ocurrencia FROM recordatorio_envios r JOIN recordatorio_reglas g ON g.id = r.regla_id
        WHERE g.tipo = 'dia_d_ya_votaste' AND r.estado IN ('reclamado','diferido')`);
    if (!pend.length) return 0;
    const jornada = await require('./jornadaDiaD').leerJornada(pool);
    let n = 0;
    for (const p of pend) {
      const dia = String(p.ocurrencia).replace(/^dia:/, '');
      const cierre = deTexto(`${dia} ${jornada.jornada_cierre}:00`);
      if (ahora.getTime() <= cierre.getTime()) continue;
      const [r] = await pool.query(
        `UPDATE recordatorio_envios SET estado = 'omitido', motivo = 'Se cerró la jornada: ya no tiene sentido preguntar si votó.', proximo_intento = NULL WHERE id = ? AND estado IN ('reclamado','diferido')`, [p.id]);
      n += r.affectedRows;
    }
    return n;
  }

  R.registrarTipo('dia_d_ya_votaste', {
    candidatos: ({ regla, ahora }) => candidatosYaVotaste({ regla, ahora }),
    limpiar: ({ ahora }) => limpiarYaVotaste({ ahora }),
    /** El enlace «Ya voté» de ESTA persona. Si no se puede armar, el motor omite el envío con ese motivo. */
    completarDatos: async ({ ficha }) => ({ enlace_ya_vote: await R.deps.enlaceYaVoto(ficha.id) }),
  });
}

module.exports = { registrar };
