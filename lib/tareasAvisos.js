/**
 * AVISOS PUSH DE LAS TAREAS (parche 305, Fase 2): al ASIGNAR una tarea (o reasignarla), y cuando quien la asignó la VERIFICA o la DEVUELVE.
 *
 * LO QUE EL AVISO DICE: el tipo de tarea y la zona, nada más. NUNCA el título (lo escribe una persona y podría decir cualquier cosa), ni la
 * nota de la devolución, ni el nombre de nadie. «Tarea de visita en El Carmen. Ábrela para empezar.»
 *
 * Es INMEDIATO —lo dispara una persona, no el reloj— y por eso no pasa por la franja de silencio de los automáticos (igual que el aviso de las
 * solicitudes). No avisa a quien se asigna a sí mismo ni a quien actúa sobre lo suyo, ni a quien pidió no recibir avisos, ni a quien no puede ver el
 * módulo (el aviso no llevaría a ninguna parte). NUNCA lanza: un aviso es una cortesía y no puede tumbar la asignación.
 * Los recordatorios por la fecha límite los manda el motor (lib/recordatoriosTareas.js).
 */
'use strict';

const pool = require('../config/db');
const T = require('./tareas');

const MAX_CUERPO = 140;

/** Lo que de verdad sale. Las pruebas lo reemplazan: no se manda nada real. */
const deps = {
  enviarPush: (usuarioId, carga) => require('../config/push').enviarAUsuario(usuarioId, carga),
};

const recortar = (t, max) => (String(t).length <= max ? String(t) : String(t).slice(0, max - 3).trimEnd() + '...');

const TEXTOS = {
  asignada: { titulo: 'Te asignaron una tarea', cola: 'Ábrela para empezar.' },
  reasignada: { titulo: 'Te asignaron una tarea', cola: 'Ábrela para empezar.' },
  verificada: { titulo: 'Tu tarea fue verificada', cola: 'Gracias por el trabajo.' },
  devuelta: { titulo: 'Te devolvieron una tarea', cola: 'Revisa lo que falta.' },
};

/**
 * @param {'asignada'|'reasignada'|'verificada'|'devuelta'} evento
 * @param {{ id, tipo, zona_texto }} tarea  la fila de `tareas`
 * @param {number} destinatarioId  a quién le llega
 * @param {{ id }} actor  quien hizo el cambio (no se avisa a sí mismo)
 * @returns {Promise<{ enviado: boolean, motivo: string|null }>}
 */
async function avisar(evento, tarea, destinatarioId, actor) {
  try {
    const textos = TEXTOS[evento];
    if (!textos || !destinatarioId) return { enviado: false, motivo: 'sin_destinatario' };
    if (actor && Number(actor.id) === Number(destinatarioId)) return { enviado: false, motivo: 'es_quien_actua' };
    const [[u]] = await pool.query(
      `SELECT u.id, u.no_contactar, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ? AND u.activo = 1`, [destinatarioId]);
    if (!u) return { enviado: false, motivo: 'sin_cuenta' };
    if (Number(u.no_contactar) === 1) return { enviado: false, motivo: 'no_contactar' };
    if (!(await T.permisosDe({ id: u.id, rol: u.rol })).ver) return { enviado: false, motivo: 'sin_acceso' };
    const frase = T.TIPOS[tarea.tipo] ? T.TIPOS[tarea.tipo].frase : 'Tarea';
    const donde = tarea.zona_texto ? ` en ${recortar(tarea.zona_texto, 50)}` : '';
    const url = ['admin', 'coordinador'].includes(u.rol) ? '/tareas.html' : '/app/mis-tareas.html';
    await deps.enviarPush(u.id, { titulo: textos.titulo, cuerpo: recortar(`${frase}${donde}. ${textos.cola}`, MAX_CUERPO), url });
    return { enviado: true, motivo: null };
  } catch (e) {
    return { enviado: false, motivo: 'push', detalle: String((e && (e.code || e.message)) || e).slice(0, 160) };
  }
}

module.exports = { deps, avisar, TEXTOS };
