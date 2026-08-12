/**
 * config/reconciliadorSms.js — Averigua qué pasó con los SMS ya enviados.
 *
 * POR QUÉ ESTO EXISTE Y NO UN WEBHOOK
 *   Twilio avisaba: llamaba a una URL nuestra cada vez que un mensaje
 *   cambiaba de estado. Onurix no. Sus webhooks son de WhatsApp; para SMS lo
 *   único que hay es una consulta (`/messages-state`). O sea que el paso de
 *   «aceptado» a «entregado» no puede ser un aviso que llega: tiene que ser
 *   alguien que pregunta. Este archivo es ese alguien.
 *
 * SE PREGUNTA POR EL ID DEL DESPACHO, no por el del mensaje. Onurix devuelve
 * dos ids en cada envío y su consulta solo reconoce el del despacho — medido
 * el 12 de agosto de 2026: con el otro responde `[]`. Por eso los mensajes sin
 * `proveedor_lote_id` (los de Twilio, y los enviados antes de que se guardara)
 * ni se intentan.
 *
 * ES CONSERVADOR A PROPÓSITO, Y ESA ES LA DECISIÓN DE DISEÑO
 *   La documentación de Onurix NO lista los estados posibles. El único
 *   observado es «Enviado». Así que:
 *
 *     - el estado crudo SIEMPRE se guarda en `estado_proveedor`, sin traducir;
 *     - `estado` solo se mueve con una palabra que esté en las listas de abajo;
 *     - cualquier palabra desconocida NO cambia nada y se anota una vez en el
 *       registro, con su valor.
 *
 *   Así el vocabulario se aprende con los primeros envíos reales en vez de
 *   adivinarlo. Adivinar aquí significaría marcar como «entregado» algo que
 *   nunca llegó, que es peor que no saberlo: un reporte que miente se cree.
 */
'use strict';

const pool = require('./db');
const { consultarEstadoOnurix } = require('../lib/sms');
const { obtenerCredenciales } = require('./comunicacionesConfig');

// Cuántos se revisan por vuelta. Cada uno es una petición HTTP a Onurix, así
// que el tope existe para no convertir la reconciliación en una tormenta
// contra su API si un día se acumulan miles.
const POR_VUELTA = 40;

// Después de este tiempo se deja de preguntar. Un mensaje de hace tres días
// que sigue en «aceptado» no va a cambiar, y sin este corte la consulta
// arrastraría para siempre a los que nunca resuelven.
const DIAS_MAXIMO = 3;

// El único estado CONFIRMADO contra el proveedor es 'Enviado' (observado el
// 12 de agosto de 2026). Los demás son hipótesis razonables sobre cómo
// escribe Onurix, y por eso lo que no está aquí NO mueve nada.
const ESTADOS_ENTREGADO = ['entregado', 'delivered', 'recibido'];
const ESTADOS_FALLIDO = ['fallido', 'failed', 'no entregado', 'rechazado', 'error', 'expirado', 'vencido'];
// 'Enviado' significa que salió, no que llegó: se guarda pero no mueve el
// estado. Confundir los dos es exactamente lo que este archivo evita.
const ESTADOS_EN_CAMINO = ['enviado', 'sent', 'pendiente', 'en proceso', 'encolado'];

// Para no repetir la misma advertencia en cada vuelta: un estado desconocido
// se anota la primera vez que aparece.
const desconocidosVistos = new Set();

function traducir(estadoCrudo) {
  const e = String(estadoCrudo || '').trim().toLowerCase();
  if (ESTADOS_ENTREGADO.includes(e)) return 'entregado';
  if (ESTADOS_FALLIDO.includes(e)) return 'fallido';
  if (ESTADOS_EN_CAMINO.includes(e)) return null;   // conocido, pero no mueve nada
  return undefined;                                  // desconocido
}

/**
 * Una vuelta de reconciliación. Devuelve un resumen — útil para probarla sin
 * tener que leer el registro.
 */
async function reconciliar() {
  const resumen = { revisados: 0, entregados: 0, fallidos: 0, sinCambio: 0, desconocidos: 0, errores: 0 };

  let pendientes;
  try {
    [pendientes] = await pool.query(
      `SELECT id, proveedor_lote_id
         FROM sms_envios
        WHERE estado = 'aceptado'
          AND proveedor = 'onurix'
          AND proveedor_lote_id IS NOT NULL
          AND creado_en > (NOW() - INTERVAL ? DAY)
        ORDER BY id
        LIMIT ?`,
      [DIAS_MAXIMO, POR_VUELTA]
    );
  } catch (err) {
    // La tabla puede no existir todavía en una campaña que aún no recibió la
    // migración. No es motivo para ensuciar el registro en cada vuelta.
    if (err.code === 'ER_NO_SUCH_TABLE') return resumen;
    throw err;
  }
  if (!pendientes.length) return resumen;

  const cred = await obtenerCredenciales();
  const config = { onurixClient: cred.onurixClient, onurixKey: cred.onurixKey };

  for (const fila of pendientes) {
    resumen.revisados++;
    const r = await consultarEstadoOnurix(fila.proveedor_lote_id, config);

    if (!r.ok) {
      // 'VACIO' es Onurix diciendo que no reconoce ese id. No es un error de
      // red: no vale la pena reintentarlo cada cinco minutos para siempre, así
      // que se anota en la fila y se deja de preguntar por ella.
      if (r.motivo === 'VACIO') {
        await pool.query(
          `UPDATE sms_envios SET estado_proveedor = 'DESCONOCIDO PARA EL PROVEEDOR' WHERE id = ?`,
          [fila.id]);
      }
      resumen.errores++;
      continue;
    }

    const nuevo = traducir(r.estado);

    if (nuevo === undefined) {
      // Estado que no conocemos. NO se toca `estado`: se guarda el crudo y se
      // avisa una vez, para poder agregarlo a las listas de arriba con un dato
      // real en la mano.
      if (!desconocidosVistos.has(r.estado)) {
        desconocidosVistos.add(r.estado);
        console.warn(`[SMS] Onurix devolvió un estado que no conocemos: "${r.estado}". `
          + 'Se guarda sin traducir; agréguelo a config/reconciliadorSms.js cuando sepa qué significa.');
      }
      resumen.desconocidos++;
      await pool.query('UPDATE sms_envios SET estado_proveedor = ? WHERE id = ?', [r.estado, fila.id]);
      continue;
    }

    if (nuevo === null) {
      resumen.sinCambio++;
      await pool.query('UPDATE sms_envios SET estado_proveedor = ? WHERE id = ?', [r.estado, fila.id]);
      continue;
    }

    await pool.query('UPDATE sms_envios SET estado = ?, estado_proveedor = ? WHERE id = ?',
      [nuevo, r.estado, fila.id]);
    if (nuevo === 'entregado') resumen.entregados++; else resumen.fallidos++;
  }

  return resumen;
}

/**
 * Arranca la reconciliación periódica.
 *
 * Cada cinco minutos y no cada uno, a diferencia del despachador de campañas:
 * aquí cada vuelta son hasta 40 peticiones a un tercero, y un estado de
 * entrega que se sepa cinco minutos más tarde no le cambia la vida a nadie.
 *
 * `unref()` para que este temporizador no mantenga vivo el proceso, igual que
 * el del despachador.
 */
function iniciar() {
  const correr = () => reconciliar().catch(err =>
    console.error('Error reconciliando estados de SMS:', err.message));
  correr();
  return setInterval(correr, 5 * 60 * 1000).unref();
}

module.exports = { reconciliar, iniciar, traducir };
