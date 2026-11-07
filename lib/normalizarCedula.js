'use strict';
/**
 * normalizarCedula.js — UNA sola regla para decir «es la misma cédula».
 *
 * SOLO DÍGITOS, SIN CEROS A LA IZQUIERDA: «1.053.123.456», «1 053 123 456» y «01053123456» son la misma
 * persona. Es la regla de `validarFormato` (lib/validarCedula.js: quita lo que no es dígito y luego los
 * ceros del comienzo); aquí está sola para que el formulario público la use también al COMPARAR contra lo que
 * ya hay guardado.
 *
 * POR QUÉ HACE FALTA AL COMPARAR. El alta normal (routes/votantes.routes.js) guarda la cédula TAL COMO SE
 * TECLEÓ, sin normalizarla, y el índice UNIQUE de `votantes.cedula` solo detecta el texto idéntico. Una ficha
 * guardada como «1.053.123.456» no choca con «1053123456»: sin esta regla, el enlace de inscripción crearía
 * una SEGUNDA ficha de la misma persona, sin error y sin aviso.
 *
 * NO se reescribe lo que ya está guardado: otras partes de la aplicación cruzan `votantes.cedula` contra
 * `usuarios.numero_identificacion` por igualdad de texto, y normalizar de un lado solo las rompería.
 */

/** «1.053 123.456» → «1053123456»; «0012345678» → «12345678»; sin dígitos → ''. */
function normalizarCedula(valor) {
  return String(valor == null ? '' : valor).replace(/\D/g, '').replace(/^0+/, '');
}

/** La MISMA regla, escrita en SQL, para una columna que guarda cédulas tecleadas a mano. */
function sqlCedulaNormalizada(columna) {
  return `TRIM(LEADING '0' FROM REGEXP_REPLACE(${columna}, '[^0-9]', ''))`;
}

/** «1053123456» → «***456»: lo que se le muestra a quien NO es dueño de la ficha. */
function enmascararCedula(valor) {
  const d = normalizarCedula(valor);
  return d ? '***' + d.slice(-3) : '***';
}

/** Los últimos tres dígitos (lo único de la cédula que se guarda en la bitácora de intentos). */
function finDeCedula(valor) {
  const d = normalizarCedula(valor);
  return d ? d.slice(-3) : null;
}

module.exports = { normalizarCedula, sqlCedulaNormalizada, enmascararCedula, finDeCedula };
