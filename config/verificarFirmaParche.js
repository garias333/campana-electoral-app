/**
 * verificarFirmaParche.js — Comprueba que el .zip de un parche lo firmó de
 * verdad el Servidor de Licencias, antes de que scripts/actualizar-automatico.js
 * lo descomprima encima de esta instalación.
 *
 * POR QUÉ EXISTE
 *   Hasta el parche #260, `unzip -o` se aplicaba sobre lo que fuera que
 *   respondiera /parches/descargar/:n, con el único secreto compartido
 *   (X-API-Secret) como autenticación de la DESCARGA — nada autenticaba el
 *   CONTENIDO. Si licencias.appestrategia.net se viera suplantado (DNS, un
 *   proxy comprometido) o su capa de aplicación tuviera un bug que dejara
 *   escribir en `parches_disponibles` o en la carpeta `parches/`, esta
 *   instalación aplicaría ese código sin nada que lo notara.
 *
 * QUÉ SE FIRMA
 *   Los bytes completos del .zip, con Ed25519 (`crypto.sign(null, ...)` —
 *   Ed25519 no necesita pre-hashear, ya usa SHA-512 internamente). La firma
 *   viaja en el JSON de GET /parches/disponibles (campo `firma`, base64),
 *   junto a `sha256` como huella legible para comparar a simple vista si
 *   hiciera falta depurar algo a mano — no la usa este verificador, que
 *   compara la firma contra los bytes directamente.
 *
 * POR QUÉ UN ARRAY DE LLAVES Y NO UNA SOLA CONSTANTE
 *   El día que haga falta rotar la llave (sospecha de compromiso, o
 *   simplemente rutina), hay una ventana donde parches viejos pueden seguir
 *   firmados con la anterior mientras los nuevos ya usan la que reemplaza.
 *   Aceptar un array desde el día uno evita tener que tocar esta función
 *   otra vez para algo que se sabe que va a pasar tarde o temprano — solo
 *   hace falta agregar un .pem nuevo a la carpeta.
 *
 * POR QUÉ LAS LLAVES SE LEEN DE ARCHIVOS Y NO DE UNA CONSTANTE EN CÓDIGO
 *   Rotar una llave así es agregar un archivo .pem, no editar una línea de
 *   JavaScript — y sobre todo, permite que `scripts/generar-parche.js`
 *   BLOQUEE esta carpeta de la lista de lo que un parche puede tocar (ver
 *   ese archivo). Un parche que pudiera reemplazar su propia llave de
 *   verificación dejaría de proteger nada: bastaría un solo parche colado
 *   sin firma válida para plantar la llave del atacante y que sus firmas
 *   futuras "verificaran". Con el modo de fallo cerrado (ver
 *   scripts/actualizar-automatico.js) esa primera vez no debería llegar a
 *   pasar nunca — esto es la segunda capa, por si acaso la primera fallara.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CARPETA_LLAVES = path.join(__dirname, 'llaves-parches');

function cargarLlavesPublicas() {
  let archivos;
  try {
    archivos = fs.readdirSync(CARPETA_LLAVES).filter((f) => f.endsWith('.pem'));
  } catch (err) {
    throw new Error(
      `No se pudo leer ${CARPETA_LLAVES} (${err.code || err.message}). ` +
      'Sin llaves públicas no hay con qué verificar ningún parche.'
    );
  }
  if (!archivos.length) {
    throw new Error(
      `${CARPETA_LLAVES} no tiene ningún archivo .pem. ` +
      'Sin al menos una llave pública, ningún parche puede verificarse — y por diseño, ' +
      'eso significa que ninguno se aplica (ver EXIGIR_FIRMA_DESDE_PARCHE).'
    );
  }
  return archivos.map((nombre) => {
    const pem = fs.readFileSync(path.join(CARPETA_LLAVES, nombre), 'utf8');
    try {
      return crypto.createPublicKey(pem);
    } catch (err) {
      throw new Error(`${nombre} no es una llave pública PEM válida: ${err.message}`);
    }
  });
}

// Se cargan una vez, al requerir el módulo — este archivo lo usa un script
// de vida corta (una corrida de actualizar-automatico.js), no un servidor
// de larga duración, así que no hace falta recargar en caliente.
const LLAVES_PUBLICAS = cargarLlavesPublicas();

/**
 * @param {Buffer} zipBuffer   Los bytes exactos descargados, ANTES de
 *                             escribirlos a disco (ver la nota de orden en
 *                             scripts/actualizar-automatico.js).
 * @param {string} firmaBase64 El campo `firma` que trae /parches/disponibles
 *                             para este número de parche.
 * @returns {boolean}          true si CUALQUIERA de las llaves conocidas
 *                             valida la firma contra estos bytes exactos.
 */
function verificarFirmaParche(zipBuffer, firmaBase64) {
  if (!Buffer.isBuffer(zipBuffer) || !zipBuffer.length) return false;
  if (!firmaBase64 || typeof firmaBase64 !== 'string') return false;

  let firma;
  try {
    firma = Buffer.from(firmaBase64, 'base64');
  } catch (err) {
    return false;
  }
  if (!firma.length) return false;

  return LLAVES_PUBLICAS.some((llave) => {
    try {
      return crypto.verify(null, zipBuffer, llave, firma);
    } catch (err) {
      // Una firma con forma inválida (longitud incorrecta, etc.) hace que
      // crypto.verify lance en vez de devolver false — se trata igual que
      // "no verificó", nunca como error que interrumpa el intento con la
      // siguiente llave del array.
      return false;
    }
  });
}

module.exports = { verificarFirmaParche, CARPETA_LLAVES };
