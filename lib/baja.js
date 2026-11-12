/**
 * lib/baja.js — «¿ESTA PERSONA PIDIÓ NO RECIBIR MENSAJES?», en UN solo sitio.
 *
 * Nació de config/sms.js (`estaDadoDeBaja`, que solo miraba el teléfono) y se generalizó para que el
 * CORREO tenga la misma salida única que el SMS. Hasta el parche 326 el correo (config/mailer.js y
 * config/sendgrid.js) no consultaba la baja: solo lo protegían las lecturas del CRM, así que cualquier
 * otro camino que escribiera por correo (la confirmación de autorización, un contacto del organigrama
 * o escrito a mano) no tenía quien lo parara.
 *
 * LA LISTA DE BAJA ES UNA: la columna `no_contactar` de `votantes` y de `usuarios`. NO la tabla
 * `sms_exclusiones` del módulo de cuota (ver el comentario de config/sms.js: dos listas para lo mismo
 * significan que alguien dado de baja en una pantalla igual recibe el mensaje por el otro camino).
 *
 * LA BAJA ES DE LA PERSONA, NO DE LA FICHA (parche 14): `aplicarBajaDeFicha` marca todas las fichas que
 * comparten teléfono o correo. Por eso aquí se busca POR TELÉFONO (últimos 10 dígitos) o POR CORREO, no
 * por id: un contacto del organigrama o escrito a mano no tiene ficha, pero su teléfono o su correo sí
 * pueden ser los de alguien dado de baja.
 *
 * `operativo: true` NO pasa por aquí: el código de acceso, la recuperación de clave y la prueba de
 * configuración se mandan sin consultar la baja (quien pidió no recibir propaganda sigue necesitando
 * entrar a su cuenta). Esa decisión la toma quien llama, no esta función.
 */
'use strict';

const pool = require('../config/db');

/** Los últimos 10 dígitos de un teléfono, o '' si no hay (el celular colombiano es de 10). */
function diezDigitos(telefono) {
  return String(telefono || '').replace(/\D/g, '').slice(-10);
}

/** El correo en minúsculas y sin espacios, o '' si no parece uno. */
function correoNormal(email) {
  const e = String(email || '').trim().toLowerCase();
  return e.includes('@') ? e : '';
}

/**
 * ¿Pidió la baja quien tiene este teléfono o este correo?
 *
 * El filtro que decide es `no_contactar = 1`, y por eso lleva índice: los dados de baja son pocos, así
 * que MySQL recorre solo esas filas. Un índice sobre `telefono` NO serviría — la columna va envuelta en
 * REGEXP_REPLACE y ningún índice se puede usar sobre una expresión.
 *
 * @param {{telefono?: string, email?: string}} contacto  cualquiera de los dos (o ambos)
 * @param {object} [conexion]  por omisión el pool; las pruebas pueden pasar el suyo
 * @returns {Promise<boolean>}  true si alguno de los dos datos es de alguien dado de baja
 */
async function estaDadoDeBaja(contacto = {}, conexion = pool) {
  const diez = diezDigitos(contacto.telefono);
  const correo = correoNormal(contacto.email);
  if (!diez && !correo) return false;
  const partes = [];
  const valores = [];
  for (const tabla of ['votantes', 'usuarios']) {
    if (diez) {
      partes.push(`EXISTS(SELECT 1 FROM ${tabla}
                           WHERE no_contactar = 1
                             AND RIGHT(REGEXP_REPLACE(telefono, '[^0-9]', ''), 10) = ?)`);
      valores.push(diez);
    }
    if (correo) {
      partes.push(`EXISTS(SELECT 1 FROM ${tabla}
                           WHERE no_contactar = 1 AND LOWER(TRIM(email)) = ?)`);
      valores.push(correo);
    }
  }
  const [[fila]] = await conexion.query(`SELECT (${partes.join(' OR ')}) AS baja`, valores);
  return Boolean(fila.baja);
}

/**
 * Lo mismo, para MUCHOS contactos de una vez (el listado de destinatarios del CRM: una consulta por
 * persona serían cientos de viajes). Devuelve dos conjuntos con las claves que SÍ están de baja:
 *   telefonos → últimos 10 dígitos     correos → en minúsculas
 * y el llamador pregunta con `bajas.telefonos.has(diezDigitos(t))` / `bajas.correos.has(correoNormal(e))`.
 */
async function contactosDeBaja({ telefonos = [], correos = [] } = {}, conexion = pool) {
  const diez = [...new Set(telefonos.map(diezDigitos).filter(Boolean))];
  const mails = [...new Set(correos.map(correoNormal).filter(Boolean))];
  const salida = { telefonos: new Set(), correos: new Set() };
  for (const tabla of ['votantes', 'usuarios']) {
    if (diez.length) {
      const [filas] = await conexion.query(
        `SELECT DISTINCT RIGHT(REGEXP_REPLACE(telefono, '[^0-9]', ''), 10) AS clave
           FROM ${tabla}
          WHERE no_contactar = 1
            AND RIGHT(REGEXP_REPLACE(telefono, '[^0-9]', ''), 10) IN (?)`, [diez]);
      filas.forEach(f => salida.telefonos.add(f.clave));
    }
    if (mails.length) {
      const [filas] = await conexion.query(
        `SELECT DISTINCT LOWER(TRIM(email)) AS clave
           FROM ${tabla}
          WHERE no_contactar = 1 AND LOWER(TRIM(email)) IN (?)`, [mails]);
      filas.forEach(f => salida.correos.add(f.clave));
    }
  }
  return salida;
}

/** El error que lanzan las salidas de envío (SMS y correo) cuando la baja manda. El llamador lo distingue por `codigo`. */
function errorDeBaja(canal) {
  const err = new Error(canal === 'correo'
    ? 'Esa persona pidió no recibir más mensajes (correo dado de baja).'
    : 'Esta persona pidió no recibir más mensajes.');
  err.codigo = 'DADO_DE_BAJA';
  return err;
}

module.exports = { estaDadoDeBaja, contactosDeBaja, errorDeBaja, diezDigitos, correoNormal };
