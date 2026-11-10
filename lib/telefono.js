/* TELÉFONOS: UNA SOLA FORMA DE COMPARARLOS (parche 315).

   Un celular se escribe de muchas maneras: «3104157434», «310 415 7434», «+57 310 415 7434», «573104157434». Para la
   persona es el mismo número; para una comparación de texto exacta, cuatro números distintos. La parte que identifica
   el celular son sus ÚLTIMOS 10 DÍGITOS: todo lo que venga delante (el +, el 57, los espacios y guiones) es formato.

   Esto es solo para COMPARAR. No decide si el número sirve para enviar un SMS (eso lo hace config/twilio.js y config/sms.js). */

/** Los últimos 10 dígitos de lo que se escribió, o null si hay menos de 10 (no es un celular: no se compara). */
function ultimos10(texto) {
  const digitos = String(texto === null || texto === undefined ? '' : texto).replace(/\D/g, '');
  return digitos.length >= 10 ? digitos.slice(-10) : null;
}

/**
 * La misma regla, escrita para MySQL: se la pone a una columna de teléfono dentro de un `WHERE columna IN (?)`.
 * Una columna con menos de 10 dígitos da una cadena corta que nunca iguala a un ultimos10() de 10 dígitos.
 * (MySQL 8: REGEXP_REPLACE; el mismo recurso que usa ctc_normalizar en el catálogo.)
 */
function sqlUltimos10(columna) {
  return `RIGHT(REGEXP_REPLACE(${columna}, '[^0-9]', ''), 10)`;
}

module.exports = { ultimos10, sqlUltimos10 };
