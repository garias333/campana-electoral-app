/**
 * EL RELOJ DE LAS TAREAS (parche 306), dentro de este mismo proceso y cada 5 minutos:
 *   1. cierra las metas de registros que ya llegaron a su meta (lib/tareasMetas.js cerrarMetasAlcanzadas);
 *   2. revisa qué tareas quedaron por reasignar (lib/tareasHuerfanas.js revisar) y avisa a quien las asignó.
 * La conservación de las fotos NO va aquí: corre en la vuelta diaria de las solicitudes (lib/solicitudesMantenimiento.js), con el mismo plazo.
 *
 * Una pasada a la vez; los errores se registran sin la sentencia (lleva datos). Sin las tablas de tareas —una campaña que aplicó el parche
 * sin la migración— sale en silencio tras el primer aviso.
 */
'use strict';

const INTERVALO_MS = 5 * 60 * 1000;
let corriendo = false;
let sinTablaAvisada = false;

async function pasada() {
  if (corriendo) return null;
  corriendo = true;
  try {
    // Activar complementos (parche 318): con «Tareas» apagado se detienen el cierre de metas y los avisos de reasignación. (La conservación de
    // las fotos NO va aquí sino en la vuelta diaria de las solicitudes, y esa sigue corriendo: la obligación con los datos no se apaga.)
    if (!(await require('./complementos').complementoActivo('tareas'))) return { apagado: true };
    const metas = await require('./tareasMetas').cerrarMetasAlcanzadas();
    const huerfanas = await require('./tareasHuerfanas').revisar();
    return { metas, huerfanas };
  } catch (err) {
    if (err && err.code === 'ER_NO_SUCH_TABLE') { if (!sinTablaAvisada) { sinTablaAvisada = true; console.log('Tareas: todavía no existen las tablas (falta correr init-db).'); } return null; }
    console.error('Tareas (reloj):', err.code || err.message);
    return null;
  } finally { corriendo = false; }
}

function iniciar() {
  setTimeout(pasada, 60 * 1000).unref();
  return setInterval(pasada, INTERVALO_MS).unref();
}

module.exports = { iniciar, pasada };
