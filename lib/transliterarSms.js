/**
 * Quita las tildes y la eñe de un SMS ANTES de enviarlo.
 *
 * POR QUÉ. Un SMS cabe en 160 caracteres si usa el alfabeto GSM-7 y en 70 si no
 * (UCS-2); un solo carácter fuera de GSM-7 —una «á», una «í», una «ó», una «ú»— pasa
 * el mensaje ENTERO a 70. Un nombre como «Peña» o «Núñez», puesto por una variable,
 * pagaba ese precio sin que quien escribió el texto lo pudiera ver. Y pasar de un
 * segmento hoy no es solo más caro: el mensaje puede NO llegar.
 *
 * QUÉ HACE: á→a é→e í→i ó→o ú→u ü→u ñ→n, y sus mayúsculas; ¿ y ¡ se eliminan. Se aplica al
 * texto FINAL, con las variables ya reemplazadas, y a TODO SMS que sale de la aplicación.
 * WhatsApp y correo no pasan por aquí.
 *
 * TIENE UNA GEMELA EN EL NAVEGADOR: `transliterarSms` de public/js/segmentos-sms.js, que el
 * contador de la pantalla usa para decir cuántos SMS son. Si las dos divergen, el contador
 * miente justo en el sitio donde importa. Hay una prueba que compara las dos.
 */
'use strict';

const MAPA = {
  'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u', 'ñ': 'n',
  'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Ü': 'U', 'Ñ': 'N',
  '¿': '', '¡': '',
};

function transliterarSms(texto) {
  // Se normaliza primero a NFC: una «á» escrita como «a» + acento combinado (lo que
  // hacen algunos teclados y algunos copiados) tiene que contar como la «á» de siempre.
  return String(texto == null ? '' : texto).normalize('NFC').replace(/[áéíóúüñÁÉÍÓÚÜÑ¿¡]/g, (c) => MAPA[c]);
}

module.exports = { transliterarSms };
