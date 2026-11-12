/**
 * parchesAplicados.js — qué parches tiene de verdad ESTA instalación, y si un
 * parche nuevo se puede aplicar encima de lo que tiene.
 *
 * POR QUÉ EXISTE (Orden 46). La noche del 11 de noviembre de 2026 el panel
 * dejó aplicar el 329 sin el 328, y las tres campañas se cayeron: el 329
 * trae `routes/checkinDiaD.routes.js`, que importa `requiereEditarModulo`
 * de `middleware/permisoModulo.js`, y ESE archivo lo trae el 328. Cada parche
 * es un zip que pisa archivos; si falta el anterior, el nuevo queda apoyado
 * en una pieza que no existe, y nada lo nota hasta que la app arranca. El
 * número de `.version-parche` no lo habría detenido: el 329 es mayor que el
 * 327.
 *
 * LAS DOS PIEZAS
 *   · `.parche-requiere` viaja DENTRO del zip: un número, el parche sobre el
 *     que se apoya. Lo escribe `scripts/generar-parche.js --requiere N`.
 *   · `.parches-aplicados` vive en la carpeta de la app, un número por línea:
 *     lo que esta instalación tiene puesto. NO viaja nunca en un parche (es
 *     estado de cada instalación, como `.version-parche`).
 *
 * LA REGLA: se aplica si el requisito está en `.parches-aplicados`. Un zip sin
 * `.parche-requiere` (los anteriores al 333) solo se aplica si su número es
 * exactamente `.version-parche + 1`.
 *
 * SIEMBRA. Una instalación que nunca ha tenido `.parches-aplicados` (todas, el
 * día que llega el 333) lo recibe con TODOS los números hasta su versión
 * actual: lo que las tres campañas tienen de verdad es todo hasta el 332. Se
 * siembra aquí, la primera vez que se lee, y no dentro del zip: un archivo
 * que viajara en el parche diría «tienes del 1 al 333» a quien lo aplicara
 * aunque no lo tuviera, que es exactamente la mentira que esto viene a impedir.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const NOMBRE_LISTA = '.parches-aplicados';
const NOMBRE_REQUISITO = '.parche-requiere';

/** «1\n2\n3» -> Set{1,2,3}. Ignora líneas vacías, comentarios (#) y todo lo que no sea un entero positivo. */
function parsearLista(texto) {
  const salida = new Set();
  for (const linea of String(texto || '').split('\n')) {
    const t = linea.replace(/#.*/, '').trim();
    if (/^\d+$/.test(t) && Number(t) > 0 && Number.isSafeInteger(Number(t))) salida.add(Number(t));
  }
  return salida;
}

function serializarLista(conjunto) {
  return [...conjunto].sort((a, b) => a - b).join('\n') + '\n';
}

/** {1,2,3,5} -> "1-3,5". Es lo que se manda al Servidor de Licencias (una cadena corta, no 333 números). */
function compactar(conjunto) {
  const nums = [...conjunto].sort((a, b) => a - b);
  const partes = [];
  for (let i = 0; i < nums.length;) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    partes.push(j > i ? `${nums[i]}-${nums[j]}` : String(nums[i]));
    i = j + 1;
  }
  return partes.join(',');
}

/** Inversa de compactar(). Devuelve null si el texto no es una lista válida (no se adivina). */
function descompactar(texto) {
  if (typeof texto !== 'string' || !texto.trim()) return null;
  const salida = new Set();
  for (const parte of texto.split(',')) {
    const m = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(parte);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (!(a > 0) || b < a || b - a > 100000) return null;
    for (let n = a; n <= b; n++) salida.add(n);
  }
  return salida;
}

/**
 * Lee `.parches-aplicados`; si no existe, lo siembra con 1..versionActual y lo
 * escribe. Una versión actual de 0 (instalación sin ningún parche) siembra un
 * conjunto vacío y NO escribe nada: no hay nada que afirmar.
 */
function leerAplicados(carpeta, versionActual) {
  const ruta = path.join(carpeta, NOMBRE_LISTA);
  try {
    return parsearLista(fs.readFileSync(ruta, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const sembrado = new Set();
  for (let n = 1; n <= (versionActual || 0); n++) sembrado.add(n);
  if (sembrado.size) fs.writeFileSync(ruta, serializarLista(sembrado), 'utf8');
  return sembrado;
}

function agregarAplicado(carpeta, numero, versionActual) {
  const conjunto = leerAplicados(carpeta, versionActual);
  conjunto.add(numero);
  fs.writeFileSync(path.join(carpeta, NOMBRE_LISTA), serializarLista(conjunto), 'utf8');
  return conjunto;
}

/** El requisito que declara el zip, `null` si no trae `.parche-requiere`, y lanza si lo trae pero no es un entero. */
function requisitoDelZip(nombresDelZip, zip, carpeta, env) {
  if (!nombresDelZip.includes(NOMBRE_REQUISITO)) return null;
  const texto = execFileSync('unzip', ['-p', zip, NOMBRE_REQUISITO], {
    cwd: carpeta, encoding: 'utf8', env: env || process.env,
  }).trim();
  if (!/^\d+$/.test(texto) || Number(texto) < 1) {
    throw new Error(`fallido: el parche trae un ${NOMBRE_REQUISITO} que no es un número (${JSON.stringify(texto.slice(0, 40))}). No se aplica.`);
  }
  return Number(texto);
}

/**
 * ¿Se puede aplicar este parche? Pura: no toca disco.
 * @returns {{ok: boolean, motivo?: string}}
 */
function decidirAplicacion({ numero, requisito, aplicados, versionActual }) {
  if (requisito !== null && requisito !== undefined) {
    if (aplicados.has(requisito)) return { ok: true };
    return { ok: false, motivo: `fallido: requiere el ${requisito}, que no está aplicado` };
  }
  // Sin `.parche-requiere` (zip anterior al formato nuevo): solo el siguiente número consecutivo.
  if (numero === (versionActual || 0) + 1) return { ok: true };
  return {
    ok: false,
    motivo: `fallido: el zip no declara qué parche requiere y su número (${numero}) no es el siguiente al ` +
      `.version-parche (${versionActual || 0}); no se aplica a ciegas`,
  };
}

module.exports = {
  NOMBRE_LISTA, NOMBRE_REQUISITO,
  parsearLista, serializarLista, compactar, descompactar,
  leerAplicados, agregarAplicado, requisitoDelZip, decidirAplicacion,
};
