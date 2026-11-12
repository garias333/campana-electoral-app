/**
 * lib/importarCeldas.js — LO QUE SIGNIFICA UNA CELDA EN LAS TRES IMPORTACIONES DE EXCEL (parche 328, orden 42).
 *
 * LA REGLA ÚNICA (votantes, estructura y testigos):
 *   · CELDA VACÍA = NO TOCA EL DATO. Hasta el 327 las tres importaciones pisaban con NULL (o con un valor por defecto:
 *     género «prefiero no responder», meta 0, tipo de testigo «mesa») todo lo que venía en blanco, de modo que reimportar
 *     un Excel con una sola columna llena borraba el resto de la ficha, y el de estructura borraba además datos en Votantes.
 *   · «-» (un guion solo) = BORRAR A PROPÓSITO, y solo en las columnas OPCIONALES: correo, teléfono, dirección,
 *     observaciones, puesto, mesa, residencia, fecha de nacimiento y edad.
 *   · En nombre, cédula, cargo, territorio, líder, supervisor y metas el «-» NUNCA borra: esa fila da un error claro en el
 *     resumen (y no se procesa).
 *
 * Esto es lo único que decide «qué se escribe»; las rutas arman su `UPDATE` con `Cambios`, que solo lleva las columnas
 * de las celdas que traen algo.
 */
'use strict';

const MARCA_BORRAR = '-';

const MENSAJE_COLUMNAS_OPCIONALES =
  'El «-» solo borra en correo, teléfono, dirección, observaciones, puesto, mesa, residencia, fecha de nacimiento y edad.';

/** El texto de una celda, sin espacios; una celda nunca escrita es ''. */
function texto(valor) {
  return String(valor === undefined || valor === null ? '' : valor).trim();
}

const esVacia = (valor) => texto(valor) === '';
const esMarcaBorrar = (valor) => texto(valor) === MARCA_BORRAR;

/**
 * La primera celda con algo, probando varios nombres de columna (las plantillas viejas y las nuevas se llaman distinto).
 * Misma regla que el `a || b || c` de siempre: gana la primera que no esté vacía.
 */
function crudoDe(fila, ...nombres) {
  for (const n of nombres) {
    if (fila[n] !== undefined && !esVacia(fila[n])) return fila[n];
  }
  return '';
}

/**
 * Las celdas de columnas que NO se pueden borrar: si alguna trae «-» devuelve el mensaje de error de la fila (y la
 * fila no se procesa); si ninguna, null. `pares` es una lista de [nombre de la columna, celda].
 */
function marcaEnColumnaNoBorrable(pares) {
  const mal = pares.filter(([, celda]) => esMarcaBorrar(celda)).map(([nombre]) => nombre);
  if (!mal.length) return null;
  return `El «-» no borra en ${mal.length === 1 ? 'la columna' : 'las columnas'} ${mal.map((n) => `«${n}»`).join(', ')}: `
    + 'es un dato que la fila no puede quedar sin. Deje la celda vacía si no quiere cambiarlo. ' + MENSAJE_COLUMNAS_OPCIONALES;
}

/** Las columnas que cambia una fila al ACTUALIZAR: solo las de celdas con valor, más las que se borran con «-». */
class Cambios {
  constructor() { this.columnas = []; this.valores = []; this.borrados = 0; }
  poner(columna, valor) { this.columnas.push(`${columna} = ?`); this.valores.push(valor); }
  borrar(columna) { this.columnas.push(`${columna} = NULL`); this.borrados++; }
  get hay() { return this.columnas.length > 0; }
  sql() { return this.columnas.join(', '); }
}

/**
 * Una celda OPCIONAL al ACTUALIZAR. Devuelve:
 *   'nada'     vacía: no se toca
 *   'borrar'   «-»: la columna queda NULL (cuenta como campo borrado)
 *   'poner'    trae valor: se escribe (ya convertido)
 *   'invalido' trae algo que no se puede entender: no se toca (el llamador avisa «se dejó el que tenía»)
 * `convertir` recibe el texto y devuelve el valor a guardar, o null/undefined si no sirve.
 */
function aplicarOpcional(cambios, columna, crudo, convertir = (t) => t) {
  if (esVacia(crudo)) return 'nada';
  if (esMarcaBorrar(crudo)) { cambios.borrar(columna); return 'borrar'; }
  const valor = convertir(typeof crudo === 'string' ? crudo.trim() : crudo);
  if (valor === undefined || valor === null || valor === '') return 'invalido';
  cambios.poner(columna, valor);
  return 'poner';
}

/**
 * Una celda opcional en una fila NUEVA: no hay nada que conservar ni que borrar, así que vacía y «-» valen null.
 * Devuelve { valor, invalido }: `invalido` es true si traía algo que no se pudo entender (el llamador avisa).
 */
function valorNuevo(crudo, convertir = (t) => t) {
  if (esVacia(crudo) || esMarcaBorrar(crudo)) return { valor: null, invalido: false };
  const valor = convertir(typeof crudo === 'string' ? crudo.trim() : crudo);
  if (valor === undefined || valor === null || valor === '') return { valor: null, invalido: true };
  return { valor, invalido: false };
}

/** Un entero positivo, o undefined si no lo es (edad, metas). */
function enteroPositivo(t) {
  const n = parseInt(String(t).replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Un entero >= 0, o undefined (metas: cero es un valor válido). */
function enteroNoNegativo(t) {
  const s = texto(t);
  if (!/^\d+$/.test(s)) return undefined;
  return parseInt(s, 10);
}

module.exports = {
  MARCA_BORRAR, MENSAJE_COLUMNAS_OPCIONALES, texto, esVacia, esMarcaBorrar, crudoDe, marcaEnColumnaNoBorrable,
  Cambios, aplicarOpcional, valorNuevo, enteroPositivo, enteroNoNegativo,
};
