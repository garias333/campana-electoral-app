#!/usr/bin/env node
// scripts/territorios-a-catalogo.js
//
// PASA UNA CAMPAÑA DE TERRITORIOS PROPIOS AL CATÁLOGO TERRITORIAL. Orden 154.
//
// Se corre DENTRO de la carpeta de la campaña (usa su `.env`, como los demás
// guiones de scripts/). Por omisión SIMULA: lee, cruza, cuenta y no escribe.
//
//   node scripts/territorios-a-catalogo.js                      (simula)
//   node scripts/territorios-a-catalogo.js --dane 05579         (simula, municipio fijado)
//   node scripts/territorios-a-catalogo.js --aplicar --vista /ruta/vista.sql
//
// ----------------------------------------------------------------------
// POR QUÉ ESTO NO ES UN «UPDATE territorios SET id = ...»
//
// 1. LOS ID SE SOLAPAN. Los locales de una campaña van de 1 en adelante y los
//    del catálogo también existen en ese rango: Puerto Berrío es el id 144 y
//    sus veredas llegan al 37093. Un reapuntado en una sola pasada hace que un
//    `UPDATE` posterior alcance filas que ya se migraron, y lo peor es que NO
//    falla: el id equivocado resuelve a un territorio real de otro municipio.
//    Ya pasó —un votante de Manizales quedó en Arcabuco, Boyacá— y por eso el
//    reapuntado va en DOS FASES: primero todos al rango +100000000, después a
//    su id definitivo.
//
// 2. NO SON SEIS COLUMNAS, SON CATORCE. La aplicación conoce seis tablas
//    (`TABLAS_CON_TERRITORIO` en config/territoriosValidacion.js), pero una
//    base de campaña real guarda un id de territorio en catorce columnas de
//    doce tablas: encuestas, puerta a puerta, solicitudes y tareas también.
//    Migrar solo las seis deja ocho columnas apuntando a id que ya no
//    significan lo que decían, sin un solo error.
//
// 3. NUNCA ADIVINA UN CRUCE. Un territorio local se empareja con el del
//    catálogo solo si coinciden tipo, nombre y padre. El nombre se compara
//    contra `nombre_normalizado` del catálogo con la colación de la base
//    (`utf8mb4_0900_ai_ci`: ignora mayúsculas y tildes) y colapsando espacios
//    — NO se reimplementa `ctc_normalizar()`, que es la regla 2 del catálogo y
//    ya costó 194 duplicados cuando dos versiones de esa función divergieron.
//    Lo que no cruza exacto se LISTA para que lo mire una persona, y mientras
//    quede uno sin par el script se niega a aplicar.
// ----------------------------------------------------------------------
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pool = require('../config/db');

const CATALOGO = process.env.CATALOGO_DB || 'territoriosdb';

/* LAS CATORCE COLUMNAS, MEDIDAS CONTRA UNA BASE DE CAMPAÑA REAL
   (information_schema, no la lista que la aplicación lleva escrita). Si mañana
   aparece una tabla nueva con `territorio_id`, este arreglo es donde entra — y
   el script avisa si encuentra alguna que no esté aquí. */
const COLUMNAS_CON_ID = [
  ['encuesta_cuotas', 'territorio_id'],
  ['encuesta_respuestas', 'territorio_id'],
  ['estructura', 'territorio_id'],
  ['estructura_territorios', 'territorio_id'],
  ['eventos', 'territorio_id'],
  ['finanzas_movimientos', 'territorio_id'],
  ['puerta_listas', 'territorio_id'],
  ['puerta_visitas', 'territorio_id'],
  ['solicitudes', 'territorio_id'],
  ['tareas', 'territorio_id'],
  ['usuarios', 'territorio_id'],
  ['usuarios', 'comuna_residencia_id'],
  ['usuarios', 'territorio_residencia_id'],
  ['votantes', 'territorio_id']
];

/* Texto libre: NO se reapunta (no son id), pero si el catálogo escribe el
   nombre distinto estos campos quedan diciendo lo de antes. Se cuentan para
   que quien decida lo sepa. */
const COLUMNAS_DE_TEXTO = [
  ['usuarios', 'comuna_corregimiento_residencia'],
  ['usuarios', 'barrio_residencia'],
  ['votantes', 'comuna_corregimiento_residencia'],
  ['votantes', 'barrio_residencia'],
  ['solicitudes', 'barrio_texto'],
  ['tareas', 'zona_texto'],
  ['puerta_listas', 'zona_texto'],
  ['encuesta_respuestas', 'zona_texto']
];

/** Los tipos locales y su `tipo_id` en el catálogo. */
const TIPOS = {
  departamento: [20, 21],
  municipio: [30, 31, 32],
  comuna: [40],
  corregimiento: [41],
  barrio: [50],
  vereda: [51]
};

const DESPLAZAMIENTO = 100000000;   // la fase transitoria del reapuntado

function argumentos() {
  const a = process.argv.slice(2);
  const valor = (nombre) => { const i = a.indexOf(nombre); return i >= 0 ? a[i + 1] : null; };
  return {
    aplicar: a.includes('--aplicar'),
    dane: valor('--dane'),
    vista: valor('--vista'),
    exportar: valor('--exportar-faltantes'),
    informe: valor('--informe'),
    pares: valor('--pares'),
    base: process.env.DB_NAME
  };
}

/** Espacios colapsados: lo único que se normaliza de este lado. */
const limpio = (t) => String(t === undefined || t === null ? '' : t).replace(/\s+/g, ' ').trim();

/* Para buscar un territorio LOCAL por su nombre en el archivo de pares, sin que
   una tilde o una mayúscula decidan. No se usa para cruzar contra el catálogo:
   eso lo hace `ctc_normalizar()` (ver abajo). */
const sinTildes = (t) => limpio(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

/* CÓMO SE COMPARA UN NOMBRE CONTRA EL CATÁLOGO, Y POR QUÉ NO SE REESCRIBE AQUÍ.
   `nombre_normalizado` no es el nombre en mayúsculas: `ctc_normalizar()` también
   QUITA LA PUNTUACIÓN — «BRASIL - LA CARLOTA» se guarda «BRASIL LA CARLOTA»—.
   Comparar el nombre crudo contra esa columna falla en todo nombre con guion o
   paréntesis; lo destapó la simulación de esta misma orden.
   La regla 2 del catálogo prohíbe reimplementar esa función: ya hubo dos
   versiones que divergieron y dejaron 194 duplicados. Así que se LLAMA a la de
   MySQL. Si la campaña no tiene EXECUTE sobre ella, el script no inventa una
   tercera: compara lo que puede y AVISA de que se va a quedar corto, lo que
   manda de más a la lista de «falta» — el lado seguro, porque eso lo revisa una
   persona antes de subir nada. */
let USAR_NORMALIZAR = false;
async function probarNormalizar(conexion) {
  try {
    const [[r]] = await conexion.query(`SELECT ${CATALOGO}.ctc_normalizar('a - b') AS v`);
    USAR_NORMALIZAR = !!(r && r.v);
  } catch (_) {
    USAR_NORMALIZAR = false;
  }
  return USAR_NORMALIZAR;
}
/** El trozo de SQL que compara `nombre_normalizado` con un nombre nuestro. */
const comparaNombre = (alias) => {
  const col = (alias ? alias + '.' : '') + 'nombre_normalizado';
  return USAR_NORMALIZAR
    ? `${col} = ${CATALOGO}.ctc_normalizar(?)`
    : `${col} = ? COLLATE utf8mb4_0900_ai_ci`;
};

async function tablaEsBase(conexion) {
  const [[f]] = await conexion.query(
    `SELECT TABLE_TYPE AS t FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'territorios' LIMIT 1`);
  return f && f.t === 'BASE TABLE';
}

/** ¿Alguna columna con id de territorio que este script no conozca? */
async function columnasNoPrevistas(conexion) {
  const [filas] = await conexion.query(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND (COLUMN_NAME LIKE '%territorio%id' OR COLUMN_NAME LIKE '%comuna%id')
        AND TABLE_NAME <> 'campana_ambito'`);
  const conocidas = new Set(COLUMNAS_CON_ID.map(([t, c]) => `${t}.${c}`));
  return filas.map((f) => `${f.TABLE_NAME}.${f.COLUMN_NAME}`).filter((x) => !conocidas.has(x));
}

/** El municipio del catálogo al que pertenece esta campaña. */
async function municipioDelCatalogo(conexion, dane, nombreLocal) {
  if (dane) {
    const [[m]] = await conexion.query(
      `SELECT id, nombre, padre_id, ruta FROM ${CATALOGO}.ctc_territorios
        WHERE codigo_dane = ? AND estado = 'ACTIVO' LIMIT 1`, [dane]);
    return m || null;
  }
  const [cand] = await conexion.query(
    `SELECT id, nombre, padre_id, ruta FROM ${CATALOGO}.ctc_territorios
      WHERE tipo_id IN (30,31,32) AND estado = 'ACTIVO'
        AND ${comparaNombre()}`, [limpio(nombreLocal)]);
  if (cand.length === 1) return cand[0];
  return null;   // cero o varios: que lo diga el humano con --dane
}

/**
 * LOS PARES ESCRITOS A MANO (--pares).
 *
 * Hay cruces que ninguna regla saca sin inventar: «Calera» y «LA CALERA» son
 * el mismo sitio, «Minas del Vapor» y «MINAS DE VAPOR» también, pero una
 * comparación que los diera por iguales daría por iguales otras cosas que no
 * lo son. Así que los decide una persona, UNA vez, y quedan escritos en un
 * archivo que se puede leer, revisar y volver a correr igual.
 *
 * Formato (CSV, encabezado opcional): `id_local_o_nombre,id_catalogo`.
 * Con el nombre se busca entre los territorios locales sin distinguir
 * mayúsculas ni tildes; si hay dos que se llamen igual, es error — ahí hay que
 * poner el id.
 *
 * CADA PAR SE VALIDA: el id del catálogo tiene que existir, estar ACTIVO, ser
 * del tipo que le toca al local y colgar DENTRO del municipio de la campaña.
 * Un par mal escrito manda a los votantes a otro municipio, que es exactamente
 * lo que pasó con Arcabuco.
 */
async function leerPares(conexion, ruta, locales, municipio) {
  const texto = fs.readFileSync(ruta, 'utf8').replace(/^\ufeff/, '');
  const manuales = new Map();   // idLocal -> fila del catálogo
  const fuera = new Set();      // idLocal que NO va al catálogo, a propósito
  const errores = [];
  const porNombre = new Map();
  locales.forEach((t) => {
    const k = sinTildes(t.nombre);
    porNombre.set(k, porNombre.has(k) ? 'VARIOS' : t);
  });

  for (const [i, linea] of texto.split(/\r?\n/).entries()) {
    const cruda = linea.trim();
    if (!cruda || cruda.startsWith('#')) continue;
    const campos = cruda.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (/^id_local/i.test(campos[0])) continue;            // encabezado
    const [clave, idCat] = campos;
    const numeroDeLinea = i + 1;
    if (!clave || !idCat) { errores.push(`línea ${numeroDeLinea}: faltan columnas`); continue; }

    let local = null;
    if (/^\d+$/.test(clave)) {
      local = locales.find((t) => Number(t.id) === Number(clave)) || null;
      if (!local) { errores.push(`línea ${numeroDeLinea}: no hay territorio local con id ${clave}`); continue; }
    } else {
      const hallado = porNombre.get(sinTildes(clave));
      if (hallado === 'VARIOS') { errores.push(`línea ${numeroDeLinea}: hay varios territorios locales llamados «${clave}»; use el id`); continue; }
      if (!hallado) { errores.push(`línea ${numeroDeLinea}: no hay territorio local llamado «${clave}»`); continue; }
      local = hallado;
    }
    /* FUERA = este territorio NO va al catálogo y es una decisión, no un olvido.
       Así el archivo dice las dos cosas que decidió una persona —con cuál se
       empareja cada uno y cuáles se quedan fuera— en vez de repartirlas entre
       un archivo y la memoria de quien corre el guion. */
    if (/^(FUERA|-)$/i.test(idCat)) { fuera.add(local.id); continue; }
    if (!/^\d+$/.test(idCat)) { errores.push(`línea ${numeroDeLinea}: «${idCat}» no es un id del catálogo ni FUERA`); continue; }

    const [[destino]] = await conexion.query(
      `SELECT id, nombre, padre_id, tipo_id, ruta, estado FROM ${CATALOGO}.ctc_territorios WHERE id = ?`, [idCat]);
    if (!destino) { errores.push(`línea ${numeroDeLinea}: el catálogo no tiene el id ${idCat}`); continue; }
    if (destino.estado !== 'ACTIVO') { errores.push(`línea ${numeroDeLinea}: ${destino.nombre} (${idCat}) está en estado ${destino.estado}`); continue; }
    if (!String(destino.ruta).startsWith(municipio.ruta)) {
      errores.push(`línea ${numeroDeLinea}: ${destino.nombre} (${idCat}) NO cuelga de ${municipio.nombre}`);
      continue;
    }
    const tiposOk = TIPOS[local.tipo] || [];
    if (!tiposOk.includes(Number(destino.tipo_id))) {
      errores.push(`línea ${numeroDeLinea}: «${local.nombre}» es ${local.tipo} y ${destino.nombre} (${idCat}) es de tipo ${destino.tipo_id}`);
      continue;
    }
    manuales.set(local.id, destino);
  }
  return { manuales, fuera, errores };
}

/** Cuántas filas de la campaña apuntan a CADA uno de estos territorios. */
async function referenciasPorTerritorio(conexion, ids) {
  if (!ids.length) return new Map();
  const cuenta = new Map(ids.map((id) => [id, 0]));
  const marcas = ids.map(() => '?').join(',');
  for (const [tabla, columna] of COLUMNAS_CON_ID) {
    try {
      const [filas] = await conexion.query(
        `SELECT \`${columna}\` AS id, COUNT(*) n FROM \`${tabla}\`
          WHERE \`${columna}\` IN (${marcas}) GROUP BY \`${columna}\``, ids);
      filas.forEach((f) => cuenta.set(Number(f.id), (cuenta.get(Number(f.id)) || 0) + Number(f.n)));
    } catch (err) {
      if (err.code !== 'ER_NO_SUCH_TABLE' && err.code !== 'ER_BAD_FIELD_ERROR') throw err;
    }
  }
  return cuenta;
}

/**
 * Empareja cada territorio local con uno del catálogo.
 * Devuelve { pares: Map(idLocal -> filaCatalogo), sinPar: [...], avisos: [...] }
 */
async function cruzar(conexion, locales, municipio, manuales = new Map()) {
  const porId = new Map(locales.map((t) => [t.id, t]));
  const pares = new Map();
  const sinPar = [];
  const avisos = [];

  /* El orden importa: primero lo que cuelga del municipio, después lo que
     cuelga de eso. Así cuando se busca el padre de un barrio ya está resuelto. */
  const orden = ['departamento', 'municipio', 'comuna', 'corregimiento', 'barrio', 'vereda'];
  const porTipo = (t) => orden.indexOf(t.tipo);
  const enOrden = [...locales].sort((a, b) => porTipo(a) - porTipo(b));

  for (const t of enOrden) {
    /* Un par escrito a mano manda sobre cualquier regla: ya lo validó leerPares. */
    if (manuales.has(t.id)) { pares.set(t.id, manuales.get(t.id)); continue; }
    if (t.tipo === 'departamento') {
      const [[d]] = await conexion.query(
        `SELECT id, nombre FROM ${CATALOGO}.ctc_territorios WHERE id = ?`, [municipio.padre_id]);
      if (d) pares.set(t.id, d); else sinPar.push({ ...t, porque: 'no se halló el departamento del municipio' });
      continue;
    }
    if (t.tipo === 'municipio') {
      pares.set(t.id, municipio);
      continue;
    }
    /* DÓNDE BUSCAR EL PADRE EN EL CATÁLOGO, Y POR QUÉ HAY MÁS DE UN SITIO.
       Lo primero es el par del padre local. Pero el catálogo NO modela igual lo
       rural: en Puerto Berrío sus 21 veredas cuelgan del MUNICIPIO, las 21, y
       no hay un solo corregimiento. La campaña de Yimar, en cambio, agrupa sus
       veredas bajo corregimientos propios («Rural 01»…). Exigir el mismo padre
       dejaba las 18 veredas sin cruzar y las habría mandado a cargar de nuevo:
       duplicados de veredas que YA están, que es el error más caro que ha
       tenido este catálogo.
       Así que para una vereda se prueba también el municipio, que es la
       convención del catálogo. No es adivinar: mismo tipo, mismo nombre y
       mismo municipio es el mismo sitio. Lo que cambia es la jerarquía, y eso
       se reporta aparte en vez de pasarlo por alto. */
    const padreLocal = t.padre_id ? porId.get(t.padre_id) : null;
    const candidatos = [];
    if (padreLocal && pares.has(padreLocal.id)) candidatos.push(pares.get(padreLocal.id));
    if (!padreLocal) candidatos.push(municipio);
    if (t.tipo === 'vereda' && !candidatos.some((c) => Number(c.id) === Number(municipio.id))) {
      candidatos.push(municipio);
    }
    if (!candidatos.length) {
      sinPar.push({ ...t, porque: `su padre local (${padreLocal.nombre}) todavía no tiene par` });
      continue;
    }

    const tipos = TIPOS[t.tipo] || [];
    let hallado = null;
    let varios = 0;
    for (const padreCatalogo of candidatos) {
      const [iguales] = await conexion.query(
        `SELECT id, nombre, padre_id, tipo_id FROM ${CATALOGO}.ctc_territorios
          WHERE estado = 'ACTIVO' AND tipo_id IN (?)
            AND ${comparaNombre()}
            AND padre_id = ?`,
        [tipos, limpio(t.nombre), padreCatalogo.id]);
      if (iguales.length > 1) { varios = iguales.length; break; }
      if (iguales.length === 1) {
        hallado = iguales[0];
        /* Cruzó por el municipio aunque la campaña lo tenía bajo otro padre:
           el territorio es el mismo, la jerarquía no. Que se sepa. */
        if (padreLocal && Number(padreCatalogo.id) === Number(municipio.id)
            && padreLocal.tipo !== 'municipio') {
          avisos.push({
            ...t,
            porque: `en el catálogo cuelga del municipio, no de «${padreLocal.nombre}»`,
            idCatalogo: hallado.id
          });
        }
        break;
      }
    }
    if (varios) {
      sinPar.push({ ...t, porque: `el catálogo tiene ${varios} con ese nombre y ese padre` });
      continue;
    }
    if (hallado) { pares.set(t.id, hallado); continue; }
    if (padreLocal && !pares.has(padreLocal.id) && t.tipo !== 'vereda') {
      sinPar.push({ ...t, porque: `su padre local (${padreLocal.nombre}) todavía no tiene par` });
      continue;
    }

    /* No cruzó con ese padre. ¿Existe con OTRO padre dentro del municipio?
       Eso NO se empareja solo: es una diferencia de jerarquía que tiene que
       mirar una persona. */
    const [otroPadre] = await conexion.query(
      `SELECT t.id, t.nombre, pa.nombre AS padre
         FROM ${CATALOGO}.ctc_territorios t
         LEFT JOIN ${CATALOGO}.ctc_territorios pa ON pa.id = t.padre_id
        WHERE t.estado = 'ACTIVO' AND t.tipo_id IN (?)
          AND ${comparaNombre('t')}
          AND t.ruta LIKE ?`,
      [tipos, limpio(t.nombre), municipio.ruta + '%']);
    if (otroPadre.length) {
      avisos.push({ ...t, porque: `existe en el catálogo pero colgando de «${otroPadre[0].padre}»`, idCatalogo: otroPadre[0].id });
      sinPar.push({ ...t, porque: `existe con otro padre («${otroPadre[0].padre}»)` });
      continue;
    }

    /* ¿Y con un nombre parecido? Solo para el informe: jamás se empareja. */
    const [parecidos] = await conexion.query(
      `SELECT nombre FROM ${CATALOGO}.ctc_territorios
        WHERE estado = 'ACTIVO' AND tipo_id IN (?) AND ruta LIKE ?
          AND SOUNDEX(nombre_normalizado) = SOUNDEX(?) LIMIT 3`,
      [tipos, municipio.ruta + '%', limpio(t.nombre)]);
    sinPar.push({
      ...t,
      porque: 'no está en el catálogo',
      parecidos: parecidos.map((x) => x.nombre)
    });
  }
  return { pares, sinPar, avisos };
}

/** Cuántas filas de la campaña usan cada territorio. */
async function contarReferencias(conexion) {
  const cuenta = {};
  let total = 0;
  for (const [tabla, columna] of COLUMNAS_CON_ID) {
    try {
      const [[r]] = await conexion.query(
        `SELECT COUNT(*) n FROM \`${tabla}\` WHERE \`${columna}\` IS NOT NULL`);
      if (Number(r.n)) { cuenta[`${tabla}.${columna}`] = Number(r.n); total += Number(r.n); }
    } catch (err) {
      if (err.code !== 'ER_NO_SUCH_TABLE' && err.code !== 'ER_BAD_FIELD_ERROR') throw err;
    }
  }
  return { cuenta, total };
}

async function contarTextos(conexion) {
  const cuenta = {};
  for (const [tabla, columna] of COLUMNAS_DE_TEXTO) {
    try {
      const [[r]] = await conexion.query(
        `SELECT COUNT(*) n FROM \`${tabla}\` WHERE \`${columna}\` IS NOT NULL AND \`${columna}\` <> ''`);
      if (Number(r.n)) cuenta[`${tabla}.${columna}`] = Number(r.n);
    } catch (err) {
      if (err.code !== 'ER_NO_SUCH_TABLE' && err.code !== 'ER_BAD_FIELD_ERROR') throw err;
    }
  }
  return cuenta;
}

/** El respaldo. Sin `--no-tablespaces` sale un archivo con encabezado y sin datos. */
function respaldar(base, carpeta) {
  fs.mkdirSync(carpeta, { recursive: true });
  const destino = path.join(carpeta, `${base}_antes_del_catalogo_${new Date().toISOString().slice(0, 10)}.sql`);
  const args = ['-h', process.env.DB_HOST || '127.0.0.1', '-P', String(process.env.DB_PORT || 3306),
    '-u', process.env.DB_USER, '--single-transaction', '--no-tablespaces', '--routines', '--triggers', base];
  const salida = execFileSync('mysqldump', args, {
    env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' },
    maxBuffer: 1024 * 1024 * 512
  });
  fs.writeFileSync(destino, salida);
  /* Se comprueba el CONTENIDO, no el tamaño: un dump fallido pesa lo creíble. */
  const tablas = (salida.toString('latin1').match(/CREATE TABLE/g) || []).length;
  if (tablas < 10) throw new Error(`El respaldo salió con ${tablas} tablas: no se sigue.`);
  return { destino, tablas };
}

(async () => {
  const opc = argumentos();
  const conexion = await pool.getConnection();
  let salir = 0;
  try {
    console.log(`Base: ${opc.base}   Catálogo: ${CATALOGO}   Modo: ${opc.aplicar ? 'APLICAR' : 'SIMULAR'}\n`);

    if (!(await tablaEsBase(conexion))) {
      console.log('`territorios` ya NO es una tabla local (es una vista): esta campaña ya lee del catálogo.');
      return;
    }

    if (!(await probarNormalizar(conexion))) {
      console.log('AVISO — esta campaña no puede llamar a ' + CATALOGO + '.ctc_normalizar().');
      console.log('  El cruce se hace solo por mayúsculas y tildes, así que los nombres con guion o');
      console.log('  paréntesis («BRASIL - LA CARLOTA») van a salir como «no está en el catálogo»');
      console.log('  aunque estén. Se queda corto a propósito: nunca empareja de más.');
      console.log('  Para cruzarlos bien hace falta, con el root de MySQL:');
      console.log(`    GRANT EXECUTE ON FUNCTION ${CATALOGO}.ctc_normalizar TO '<usuario de la campaña>'@'%';\n`);
    }

    const noPrevistas = await columnasNoPrevistas(conexion);
    if (noPrevistas.length) {
      console.log('OJO — columnas con id de territorio que este script no conoce:');
      noPrevistas.forEach((c) => console.log('   ' + c));
      console.log('   Agrégalas a COLUMNAS_CON_ID antes de aplicar.\n');
      salir = 1;
    }

    const [locales] = await conexion.query(
      `SELECT id, tipo, nombre, padre_id FROM territorios ORDER BY id`);
    console.log(`Territorios propios: ${locales.length}`);
    const porTipo = {};
    locales.forEach((t) => { porTipo[t.tipo] = (porTipo[t.tipo] || 0) + 1; });
    Object.keys(porTipo).sort().forEach((t) => console.log(`   ${t.padEnd(16)} ${porTipo[t]}`));

    const muniLocal = locales.find((t) => t.tipo === 'municipio');
    const municipio = await municipioDelCatalogo(conexion, opc.dane, muniLocal && muniLocal.nombre);
    if (!municipio) {
      console.log('\nNo se pudo identificar el municipio en el catálogo. Indícalo con --dane <DIVIPOLA>.');
      salir = 1;
      return;
    }
    console.log(`\nMunicipio en el catálogo: ${municipio.nombre} (id ${municipio.id}, ruta ${municipio.ruta})`);

    let manuales = new Map();
    let fuera = new Set();
    if (opc.pares) {
      const leidos = await leerPares(conexion, opc.pares, locales, municipio);
      manuales = leidos.manuales;
      fuera = leidos.fuera;
      console.log(`\nPares escritos a mano: ${manuales.size} (${path.basename(opc.pares)})`);
      if (fuera.size) console.log(`Marcados FUERA del catálogo: ${fuera.size}`);
      if (leidos.errores.length) {
        console.log('  Con problemas — NO se usa ninguno de estos:');
        leidos.errores.forEach((e) => console.log('   ' + e));
        salir = 1;
      }
    }

    const { pares, sinPar, avisos } = await cruzar(conexion, locales, municipio, manuales);
    console.log(`\nYa existen en el catálogo: ${pares.size} de ${locales.length}`);
    console.log(`Sin par:                   ${sinPar.length}`);
    if (avisos.length) console.log(`Con otro padre (avisos):   ${avisos.length}`);

    /* EL INFORME COMPLETO, sin el recorte de la consola. Con 86 territorios la
       lista de arriba se corta en 60 y justo lo que se queda fuera puede ser lo
       que había que mirar — pasó con las 18 veredas de Yimar. */
    if (opc.informe) {
      const porIdInf = new Map(locales.map((t) => [t.id, t]));
      const avisoDe = new Map(avisos.map((a) => [a.id, a]));
      const sinParDe = new Map(sinPar.map((x) => [x.id, x]));
      const esc = (v) => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
      const lineas = [['id_local', 'tipo', 'nombre', 'padre_local', 'veredicto', 'id_catalogo', 'nombre_catalogo', 'nota']
        .map(esc).join(',')];
      for (const t of locales) {
        const padre = t.padre_id && porIdInf.get(t.padre_id) ? porIdInf.get(t.padre_id).nombre : '';
        const par = pares.get(t.id);
        const aviso = avisoDe.get(t.id);
        const falta = sinParDe.get(t.id);
        lineas.push([
          t.id, t.tipo, t.nombre, padre,
          par ? (aviso ? 'ya existe (cambia la jerarquía)' : 'ya existe') : 'falta',
          par ? par.id : '', par ? par.nombre : '',
          (aviso && aviso.porque) || (falta && falta.porque) || ''
        ].map(esc).join(','));
      }
      fs.mkdirSync(path.dirname(opc.informe), { recursive: true });
      fs.writeFileSync(opc.informe, '\ufeff' + lineas.join('\n'), 'utf8');
      console.log(`\nInforme completo de los ${locales.length}: ${opc.informe}`);
    }

    if (avisos.length) {
      console.log('\nCruzan, pero el catálogo los tiene en otro sitio de la jerarquía:');
      avisos.slice(0, 40).forEach((a) => {
        console.log(`   [${String(a.id).padStart(4)}] ${a.tipo.padEnd(14)} ${a.nombre.padEnd(34)} ${a.porque}`);
      });
      if (avisos.length > 40) console.log(`   … y ${avisos.length - 40} más.`);
    }

    if (sinPar.length) {
      console.log('\nLos que NO tienen par (hay que subirlos a Territorios antes):');
      sinPar.slice(0, 60).forEach((t) => {
        const extra = t.parecidos && t.parecidos.length ? `  ¿será «${t.parecidos.join('», «')}»?` : '';
        console.log(`   [${String(t.id).padStart(4)}] ${t.tipo.padEnd(14)} ${t.nombre.padEnd(34)} ${t.porque}${extra}`);
      });
      if (sinPar.length > 60) console.log(`   … y ${sinPar.length - 60} más.`);
    }

    /* EL DESPLAZAMIENTO TIENE QUE CABER. Ocho de las catorce columnas son `int`
       (tope 2.147.483.647): si los id locales ya son grandes, sumarles 100 M
       los truncaría y el reapuntado escribiría en la fila equivocada. Se
       comprueba antes de prometer nada. */
    const idMaximo = locales.reduce((m, t) => Math.max(m, Number(t.id)), 0);
    if (idMaximo + DESPLAZAMIENTO > 2147483647) {
      console.log(`\nNO SE PODRÁ APLICAR: el id local más alto es ${idMaximo} y sumarle ${DESPLAZAMIENTO}`);
      console.log('  se sale del rango de las columnas `int`. Hay que bajar DESPLAZAMIENTO (tiene que');
      console.log('  seguir siendo mayor que el id más alto del catálogo) antes de tocar nada.');
      salir = 1;
    }

    /* CUÁNTA GENTE DEPENDE DE LOS QUE NO TIENEN PAR. Sin esto, «84 sin par» no
       dice si son fichas vacías o si hay votantes colgando de ellas. Y es lo
       que decide qué hacer con los que se queden fuera del catálogo. */
    if (sinPar.length) {
      const usados = await referenciasPorTerritorio(conexion, sinPar.map((t) => t.id));
      const conGente = sinPar.filter((t) => (usados.get(t.id) || 0) > 0);
      if (conGente.length) {
        console.log('\nDe los que NO tienen par, estos SÍ los usa alguien:');
        conGente.sort((a, b) => (usados.get(b.id) || 0) - (usados.get(a.id) || 0))
          .slice(0, 40)
          .forEach((t) => console.log(`   ${t.tipo.padEnd(14)} ${t.nombre.padEnd(34)} ${usados.get(t.id)} fila(s)`));
        if (conGente.length > 40) console.log(`   … y ${conGente.length - 40} más.`);
      } else {
        console.log('\nNinguno de los que falta tiene filas apuntándole.');
      }
    }

    const refs = await contarReferencias(conexion);
    console.log(`\nFilas que apuntan a un territorio: ${refs.total}`);
    Object.entries(refs.cuenta).forEach(([c, n]) => console.log(`   ${c.padEnd(42)} ${n}`));
    const textos = await contarTextos(conexion);
    if (Object.keys(textos).length) {
      console.log('\nCampos de TEXTO con nombre de territorio (no se reapuntan; quedan como están):');
      Object.entries(textos).forEach(([c, n]) => console.log(`   ${c.padEnd(42)} ${n}`));
    }

    /* EL EXCEL DE LOS QUE FALTAN, con las seis columnas del importador de
       Territorios. El «Pertenece» va con el nombre TAL COMO ESTÁ EN EL
       CATÁLOGO cuando el padre ya existe allí — si se pusiera el nombre local,
       el importador no lo cruzaría y crearía un padre duplicado. */
    if (opc.exportar) {
      const XLSX = require('xlsx');
      /* EL DEPARTAMENTO SALE DEL CATÁLOGO, NO DE LA TABLA LOCAL. La campaña de
         Yimar tiene `territorio_departamento` y `territorio_ciudad` en NULL, y
         nada obliga a que su tabla propia traiga una fila de tipo
         `departamento`: si no la trae, esta columna saldría vacía y el
         importador de Territorios rechazaría las 67 filas. Se pide al catálogo,
         que siempre lo tiene — es el padre del municipio. */
      const [[padreMuni]] = await conexion.query(
        `SELECT nombre FROM ${CATALOGO}.ctc_territorios WHERE id = ?`, [municipio.padre_id]);
      const departamentoCatalogo = (padreMuni && padreMuni.nombre) || '';
      if (!departamentoCatalogo) {
        console.log('\nNo se pudo leer el departamento del municipio en el catálogo: no se exporta.');
        salir = 1;
        return;
      }
      const porId = new Map(locales.map((t) => [t.id, t]));
      const AREA = { comuna: 'Urbano', barrio: 'Urbano', corregimiento: 'Rural', vereda: 'Rural' };
      const filas = sinPar
        .filter((t) => ['comuna', 'barrio', 'corregimiento', 'vereda'].includes(t.tipo))
        .filter((t) => !fuera.has(t.id))
        .map((t) => {
          const padreLocal = t.padre_id ? porId.get(t.padre_id) : null;
          /* Si el padre ya está en el catálogo se usa SU nombre; si no, el local
             (irá en el mismo archivo y el importador lo creará antes). */
          /* SI EL PADRE SE QUEDA FUERA DEL CATÁLOGO, LA COLUMNA VA VACÍA Y EL
             TERRITORIO CUELGA DEL MUNICIPIO. Las 7 veredas nuevas de Yimar
             cuelgan de «Rural 01/02/03», que están marcados FUERA: escribir ese
             nombre en «Pertenece» haría que el importador los creara igual —
             deshaciendo la decisión— o rechazara las filas. Y colgar del
             municipio es, además, lo que hace el catálogo con sus veredas. */
          let pertenece = '';
          if (padreLocal && padreLocal.tipo !== 'municipio' && !fuera.has(padreLocal.id)) {
            pertenece = pares.has(padreLocal.id) ? pares.get(padreLocal.id).nombre : padreLocal.nombre;
          }
          return {
            Departamento: departamentoCatalogo,
            Municipio: municipio.nombre,
            'Área': AREA[t.tipo] || '',
            Tipo: t.tipo.charAt(0).toUpperCase() + t.tipo.slice(1),
            Nombre: t.nombre,
            Pertenece: pertenece
          };
        });
      /* El orden importa: el padre antes que el hijo, o el importador no lo
         encuentra al leer la fila del hijo. */
      const peso = { Comuna: 0, Corregimiento: 0, Barrio: 1, Vereda: 1 };
      filas.sort((a, b) => peso[a.Tipo] - peso[b.Tipo] || a.Nombre.localeCompare(b.Nombre, 'es'));
      const hoja = XLSX.utils.json_to_sheet(filas, {
        header: ['Departamento', 'Municipio', 'Área', 'Tipo', 'Nombre', 'Pertenece']
      });
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hoja, 'Territorios');
      fs.mkdirSync(path.dirname(opc.exportar), { recursive: true });
      fs.writeFileSync(opc.exportar, XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }));
      console.log(`\nExcel de los que faltan: ${opc.exportar} (${filas.length} fila(s))`);
    }

    if (!opc.aplicar) {
      console.log('\n--- SIMULACIÓN: no se escribió nada. ---');
      if (sinPar.length) console.log('Faltan territorios en el catálogo: con --aplicar se negaría.');
      return;
    }

    /* ---------------------------------------------------------- APLICAR */
    if (sinPar.length) {
      console.log(`\nNO SE APLICA: ${sinPar.length} territorio(s) sin par en el catálogo (arriba). Súbelos primero.`);
      salir = 1;
      return;
    }
    if (!opc.vista || !fs.existsSync(opc.vista)) {
      console.log('\nNO SE APLICA: falta --vista <archivo.sql> con la vista `territorios` del catálogo.');
      console.log('Sin ella, renombrar la tabla dejaría la campaña sin territorios.');
      salir = 1;
      return;
    }
    const sqlVista = fs.readFileSync(opc.vista, 'utf8');
    if (!/campana_ambito/i.test(sqlVista) || !/CREATE[\s\S]*VIEW/i.test(sqlVista)) {
      console.log('\nNO SE APLICA: ese archivo no parece la vista (no nombra `campana_ambito`).');
      salir = 1;
      return;
    }

    const copia = respaldar(opc.base, path.join(__dirname, '..', 'backups'));
    console.log(`\nRespaldo: ${copia.destino} (${copia.tablas} tablas)`);

    await conexion.beginTransaction();
    /* FASE 1: todos al rango transitorio. FASE 2: a su id definitivo. En una
       sola pasada, un UPDATE posterior alcanza filas ya migradas. */
    for (const [tabla, columna] of COLUMNAS_CON_ID) {
      try {
        await conexion.query(
          `UPDATE \`${tabla}\` SET \`${columna}\` = \`${columna}\` + ? WHERE \`${columna}\` IS NOT NULL`,
          [DESPLAZAMIENTO]);
      } catch (err) {
        if (err.code !== 'ER_NO_SUCH_TABLE' && err.code !== 'ER_BAD_FIELD_ERROR') throw err;
      }
    }
    for (const [idLocal, destino] of pares) {
      for (const [tabla, columna] of COLUMNAS_CON_ID) {
        try {
          await conexion.query(
            `UPDATE \`${tabla}\` SET \`${columna}\` = ? WHERE \`${columna}\` = ?`,
            [destino.id, idLocal + DESPLAZAMIENTO]);
        } catch (err) {
          if (err.code !== 'ER_NO_SUCH_TABLE' && err.code !== 'ER_BAD_FIELD_ERROR') throw err;
        }
      }
    }
    /* Que no quede nadie en la fase transitoria: si queda, algo no se mapeó. */
    let atascados = 0;
    for (const [tabla, columna] of COLUMNAS_CON_ID) {
      try {
        const [[r]] = await conexion.query(
          `SELECT COUNT(*) n FROM \`${tabla}\` WHERE \`${columna}\` > ?`, [DESPLAZAMIENTO]);
        atascados += Number(r.n);
      } catch (err) {
        if (err.code !== 'ER_NO_SUCH_TABLE' && err.code !== 'ER_BAD_FIELD_ERROR') throw err;
      }
    }
    if (atascados) throw new Error(`${atascados} fila(s) quedaron en la fase transitoria: se deshace.`);

    await conexion.query(
      `INSERT IGNORE INTO campana_ambito (campana_id, ctc_territorio_id, nivel_operativo) VALUES (1, ?, 'MUNICIPIO')`,
      [municipio.id]);
    await conexion.commit();
    console.log('Reapuntado y ámbito: hecho.');

    /* El DDL va DESPUÉS del commit: en MySQL no se puede deshacer con ROLLBACK,
       así que la protección es el respaldo, no la transacción. */
    const sello = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    await conexion.query(`RENAME TABLE territorios TO territorios_local_${sello}`);
    for (const sentencia of sqlVista.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) {
      await conexion.query(sentencia);
    }
    console.log(`Tabla vieja: territorios_local_${sello}   ·   vista territorios creada.`);
    console.log('\nFalta: la llave de Territorios en el .env y reiniciar la instancia.');
  } catch (err) {
    try { await conexion.rollback(); } catch (_) { /* ya no hay transacción */ }
    console.error('\nSe detuvo:', err.message);
    salir = 1;
  } finally {
    conexion.release();
    await pool.end();
    process.exit(salir);
  }
})();
