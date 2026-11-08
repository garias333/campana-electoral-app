/**
 * LA VUELTA DIARIA DE LAS SOLICITUDES CIUDADANAS (parche 304): una vez al día, dentro de este mismo proceso (como los recordatorios), corre la
 * anonimización con la misma lógica de scripts/anonimizar-solicitudes.js --aplicar y deja en la auditoría cuántas anonimizó.
 *
 * POR QUÉ DENTRO DEL PROCESO Y NO EN EL CRON. Un cron del servidor hay que acordarse de ponerlo en cada campaña, y el día que falta no avisa:
 * los datos del ciudadano se quedan más allá del plazo que se le prometió. Aquí viaja con la aplicación. El script manual sigue ahí para
 * probar y para quien quiera simular (sin --aplicar solo cuenta).
 *
 * QUÉ ANONIMIZA Y CUÁNDO: lo que decide lib/solicitudes.js anonimizarVencidas — `anonimizar_solicitudes_meses` meses DESPUÉS de la fecha de la
 * elección (la «fecha principal» de la campaña). Antes del plazo no toca nada, y sin fecha de elección tampoco. No depende de que el módulo
 * esté encendido para nadie: la obligación con los datos de la gente no se apaga con un permiso.
 *
 * CUÁNDO CORRE. Cada 10 minutos mira la hora de Colombia; la primera vez que son las 03:30 o más y hoy todavía no corrió, corre. Si el proceso
 * se reinicia a media mañana y no había corrido, corre al arrancar; si ya corrió, no repite (y repetir sería inofensivo: una segunda
 * pasada no encuentra nada). Si falla, no marca el día y lo reintenta en la siguiente revisión.
 *
 * AUDITORÍA. Solo cuando anonimizó algo (un renglón diario que dice «0» es ruido). Sin usuario: la hizo el sistema.
 *
 * TAMBIÉN LAS FOTOS DE LAS TAREAS (parche 306): en la misma pasada y con el MISMO plazo se borran las fotos de la evidencia de las tareas
 * (lib/tareas.js borrarFotosVencidas), con su propio apunte `tarea_fotos_borrar_auto`.
 */
'use strict';

const pool = require('../config/db');
const S = require('./solicitudes');
const { registrarAuditoria } = require('../config/auditoria');

const CINCO_HORAS = 5 * 60 * 60 * 1000;
const HORA_DE_LA_VUELTA = 3 * 60 + 30;          // 03:30, hora de Colombia
const REVISION_MS = 10 * 60 * 1000;

let ultimoDia = null;
let corriendo = false;

/** { dia: 'YYYY-MM-DD', minutos } en hora de Colombia. */
function enColombia(fecha) {
  const c = new Date(fecha.getTime() - CINCO_HORAS);
  return { dia: c.toISOString().slice(0, 10), minutos: c.getUTCHours() * 60 + c.getUTCMinutes() };
}

/**
 * Una revisión. `ahora` fija el instante (pruebas); `forzar` salta la comprobación de la hora y del día (pruebas y quien la llame a mano).
 * Devuelve { corrio, motivo, resultado }.
 */
async function vueltaDiaria({ ahora = new Date(), forzar = false } = {}) {
  const { dia, minutos } = enColombia(ahora);
  if (!forzar) {
    if (ultimoDia === dia) return { corrio: false, motivo: 'ya corrió hoy' };
    if (minutos < HORA_DE_LA_VUELTA) return { corrio: false, motivo: 'todavía no es la hora' };
  }
  const resultado = await S.anonimizarVencidas({ aplicar: true });
  ultimoDia = dia;
  if (resultado.aplicado && resultado.anonimizadas > 0) {
    await registrarAuditoria(null, 'solicitud_anonimizar_auto', 'solicitudes', null,
      `Anonimización automática: ${resultado.anonimizadas} solicitud(es) sin nombre ni teléfono y ${resultado.fotos} foto(s) borrada(s) (plazo desde el ${resultado.desde}).`, null);
    console.log(`Solicitudes: anonimización automática — ${resultado.anonimizadas} solicitud(es), ${resultado.fotos} foto(s).`);
  }
  // Las fotos de las TAREAS (parche 306) siguen el mismo plazo. Aparte: que una campaña sin esas tablas, o un fallo, no frene lo de arriba.
  let tareas = { aplicado: false, tareas: 0, fotos: 0 };
  try {
    tareas = await require('./tareas').borrarFotosVencidas({ aplicar: true });
    if (tareas.aplicado && tareas.fotos > 0) {
      await registrarAuditoria(null, 'tarea_fotos_borrar_auto', 'tareas', null,
        `Conservación de fotos de tareas: ${tareas.fotos} foto(s) de ${tareas.tareas} tarea(s) borrada(s) (plazo desde el ${tareas.desde}).`, null);
      console.log(`Tareas: fotos vencidas — ${tareas.fotos} foto(s) de ${tareas.tareas} tarea(s).`);
    }
  } catch (err) {
    console.error('Tareas (fotos vencidas):', err.code || err.message);
  }
  return { corrio: true, motivo: resultado.motivo, resultado, tareas };
}

/** Arranca el reloj. Se llama una vez desde app.js. */
function iniciar() {
  const correr = async () => {
    if (corriendo) return;
    corriendo = true;
    try { await vueltaDiaria(); }
    catch (err) { console.error('Solicitudes (vuelta diaria):', err.code || err.message); }   // sin la sentencia: lleva datos
    finally { corriendo = false; }
  };
  setTimeout(correr, 30 * 1000).unref();           // al arrancar, sin estorbar el arranque
  return setInterval(correr, REVISION_MS).unref();
}

/** Solo para las pruebas: olvida que ya corrió hoy. */
function reiniciarMemoria() { ultimoDia = null; }

module.exports = { iniciar, vueltaDiaria, reiniciarMemoria, enColombia, HORA_DE_LA_VUELTA };
