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
    base: process.env.DB_NAME
  };
}

/** Espacios colapsados: lo único que se normaliza de este lado. */
const limpio = (t) => String(t === undefined || t === null ? '' : t).replace(/\s+/g, ' ').trim();

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
 * Empareja cada territorio local con uno del catálogo.
 * Devuelve { pares: Map(idLocal -> filaCatalogo), sinPar: [...], avisos: [...] }
 */
async function cruzar(conexion, locales, municipio) {
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
    /* El padre en el catálogo: el par del padre local, o el municipio si el
       padre local es el municipio (o no tiene). */
    const padreLocal = t.padre_id ? porId.get(t.padre_id) : null;
    const padreCatalogo = padreLocal && pares.has(padreLocal.id) ? pares.get(padreLocal.id) : municipio;
    if (padreLocal && !pares.has(padreLocal.id)) {
      sinPar.push({ ...t, porque: `su padre local (${padreLocal.nombre}) todavía no tiene par` });
      continue;
    }

    const tipos = TIPOS[t.tipo] || [];
    const [iguales] = await conexion.query(
      `SELECT id, nombre, padre_id, tipo_id FROM ${CATALOGO}.ctc_territorios
        WHERE estado = 'ACTIVO' AND tipo_id IN (?)
          AND ${comparaNombre()}
          AND padre_id = ?`,
      [tipos, limpio(t.nombre), padreCatalogo.id]);

    if (iguales.length === 1) { pares.set(t.id, iguales[0]); continue; }
    if (iguales.length > 1) {
      sinPar.push({ ...t, porque: `el catálogo tiene ${iguales.length} con ese nombre y ese padre` });
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

    const { pares, sinPar, avisos } = await cruzar(conexion, locales, municipio);
    console.log(`\nYa existen en el catálogo: ${pares.size} de ${locales.length}`);
    console.log(`Sin par:                   ${sinPar.length}`);
    if (avisos.length) console.log(`Con otro padre (avisos):   ${avisos.length}`);

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
      const porId = new Map(locales.map((t) => [t.id, t]));
      const AREA = { comuna: 'Urbano', barrio: 'Urbano', corregimiento: 'Rural', vereda: 'Rural' };
      const filas = sinPar
        .filter((t) => ['comuna', 'barrio', 'corregimiento', 'vereda'].includes(t.tipo))
        .map((t) => {
          const padreLocal = t.padre_id ? porId.get(t.padre_id) : null;
          /* Si el padre ya está en el catálogo se usa SU nombre; si no, el local
             (irá en el mismo archivo y el importador lo creará antes). */
          let pertenece = '';
          if (padreLocal && padreLocal.tipo !== 'municipio') {
            pertenece = pares.has(padreLocal.id) ? pares.get(padreLocal.id).nombre : padreLocal.nombre;
          }
          return {
            Departamento: (pares.get((locales.find((x) => x.tipo === 'departamento') || {}).id) || {}).nombre || '',
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
