#!/usr/bin/env node
// scripts/probar-instalacion-limpia.js
//
// Levanta el esquema completo sobre una base VACÍA y comprueba que quedó como
// debe. Es la prueba que faltaba: que `npm run init-db` funcione sobre una
// base que ya existe NO demuestra que `db/schema.sql` sepa crear una desde
// cero, y ese es justamente el camino que usará la primera campaña real.
//
// USO
//   1. Crea una base y su usuario EN CLOUDPANEL (ahí, no por SQL: CloudPanel
//      lleva su propio registro y una base creada por fuera queda desalineada).
//      Por ejemplo:  pruebalimpia  /  userpruebalimpia
//   2. Corre:
//        node scripts/probar-instalacion-limpia.js pruebalimpia userpruebalimpia 'LA-CLAVE'
//   3. Cuando termine, borra la base desde CloudPanel.
//
// Sale con código 1 si algo no cuadra, así que sirve tal cual en un cron o
// antes de dar por bueno un cambio de esquema.
//
// SE NIEGA A TOCAR UNA BASE CON DATOS. Comprueba dos cosas antes de empezar:
// que el nombre no sea el de ninguna instalación conocida, y que la base esté
// vacía. Una prueba que puede destruir la campaña de un cliente no es una
// prueba, es una ruleta.

require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');
const { execFileSync } = require('child_process');

const PROYECTO = path.join(__dirname, '..');

// Nunca, bajo ninguna circunstancia, contra estas.
const BASES_PROHIBIDAS = [
  'electoraldb', 'campanadepruebamunicipal', 'campanadepruebadepartamental',
  'territoriosdb', 'mysql', 'information_schema', 'performance_schema', 'sys',
];

/**
 * Lo que TIENE que ser cierto en una instalación recién creada. Cada entrada
 * es una consulta que devuelve un número y el valor que se espera.
 *
 * No es una lista decorativa: cada línea corresponde a algo que se rompió o
 * se corrigió de verdad (ver AUDITORIA.md), y sin comprobarlo el fallo vuelve
 * a pasar en silencio en la siguiente campaña.
 */
const COMPROBACIONES = [
  ['La tabla usuarios existe',
   `SELECT COUNT(*) n FROM information_schema.tables
     WHERE table_schema=DATABASE() AND table_name='usuarios'`, 1],

  ['usuarios.nombre_usuario existe (A1: sin ella, TODO login responde 500)',
   `SELECT COUNT(*) n FROM information_schema.columns
     WHERE table_schema=DATABASE() AND table_name='usuarios' AND column_name='nombre_usuario'`, 1],

  ['...y tiene su índice UNIQUE llamado exactamente "nombre_usuario"',
   `SELECT COUNT(*) n FROM information_schema.statistics
     WHERE table_schema=DATABASE() AND table_name='usuarios'
       AND index_name='nombre_usuario' AND non_unique=0`, 1],

  ['campana_ambito existe (A26: la vista del catálogo depende de ella)',
   `SELECT COUNT(*) n FROM information_schema.tables
     WHERE table_schema=DATABASE() AND table_name='campana_ambito'`, 1],

  ['Ninguna FK apunta a territorios salvo la suya propia (A2: una FK viva impide convertirla en vista)',
   `SELECT COUNT(*) n FROM information_schema.key_column_usage
     WHERE table_schema=DATABASE() AND referenced_table_name='territorios'
       AND table_name <> 'territorios'`, 0],

  ['territorio_id sigue indexado en las 5 tablas (A2: al quitar las FK se perdía su índice)',
   `SELECT COUNT(DISTINCT table_name) n FROM information_schema.statistics
     WHERE table_schema=DATABASE() AND column_name='territorio_id'`, 5],

  ['mesa_votacion es INT en las 4 tablas (A13)',
   `SELECT COUNT(*) n FROM information_schema.columns
     WHERE table_schema=DATABASE() AND column_name='mesa_votacion' AND data_type='int'`, 4],

  ['comunicaciones_envios.twilio_sid indexado (A7: el webhook lo busca en cada aviso)',
   `SELECT COUNT(*) n FROM information_schema.statistics
     WHERE table_schema=DATABASE() AND table_name='comunicaciones_envios' AND column_name='twilio_sid'`, 1],

  ['Cero tablas con colación distinta de utf8mb4_0900_ai_ci (A15; sessions no cuenta, la crea la librería)',
   `SELECT COUNT(*) n FROM information_schema.tables
     WHERE table_schema=DATABASE() AND table_type='BASE TABLE'
       AND table_name <> 'sessions' AND table_collation <> 'utf8mb4_0900_ai_ci'`, 0],

  ['Los 8 roles quedaron sembrados',
   `SELECT COUNT(*) n FROM roles`, 8],

  ['Se creó exactamente un administrador',
   `SELECT COUNT(*) n FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE r.nombre='admin'`, 1],

  ['Los permisos por defecto están sembrados',
   `SELECT COUNT(*) n FROM permisos_rol WHERE modulo='votantes'`, 8],

  ['La política de privacidad quedó sembrada',
   `SELECT COUNT(*) n FROM contenido_paginas WHERE clave='politica_privacidad'`, 1],
];

async function main() {
  const [base, usuario, clave] = process.argv.slice(2);
  if (!base || !usuario || !clave) {
    console.error('Uso: node scripts/probar-instalacion-limpia.js <base> <usuario> <clave>');
    console.error('La base y el usuario se crean antes en CloudPanel.');
    process.exit(1);
  }
  if (BASES_PROHIBIDAS.includes(base.toLowerCase())) {
    console.error(`NO. "${base}" es una base real o del sistema. Esta prueba escribe y borra: usa una desechable.`);
    process.exit(1);
  }

  const conf = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: usuario, password: clave, database: base,
  };

  let cx;
  try {
    cx = await mysql.createConnection(conf);
  } catch (err) {
    console.error(`No se pudo conectar a "${base}" con ese usuario: ${err.message}`);
    process.exit(1);
  }

  const [[{ n: tablas }]] = await cx.query(
    `SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = ?`, [base]);
  if (tablas > 0) {
    console.error(`NO. La base "${base}" ya tiene ${tablas} tabla(s). La prueba exige una VACÍA — ` +
                  'si no, no se está probando la creación desde cero.');
    await cx.end();
    process.exit(1);
  }
  await cx.end();

  console.log(`Base "${base}": vacía. Levantando el esquema...\n`);
  try {
    execFileSync(process.execPath, [path.join(PROYECTO, 'db', 'init-db.js')], {
      cwd: PROYECTO, stdio: 'inherit',
      env: { ...process.env, DB_NAME: base, DB_USER: usuario, DB_PASSWORD: clave },
    });
  } catch (err) {
    console.error('\n>>> init-db FALLÓ. Ese es el resultado de la prueba: una campaña nueva no se puede crear.');
    process.exit(1);
  }

  console.log('\nComprobando cómo quedó:\n');
  cx = await mysql.createConnection(conf);
  let fallos = 0;
  for (const [titulo, sql, esperado] of COMPROBACIONES) {
    let obtenido;
    try {
      const [[fila]] = await cx.query(sql);
      obtenido = Number(fila.n);
    } catch (err) {
      obtenido = `error: ${err.message}`;
    }
    const bien = obtenido === esperado;
    if (!bien) fallos++;
    console.log(`  ${bien ? 'OK  ' : 'FALLA'}  ${titulo}${bien ? '' : `  [esperado ${esperado}, obtenido ${obtenido}]`}`);
  }
  const [[{ n: total }]] = await cx.query(
    `SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE'`);
  await cx.end();

  console.log(`\n${total} tablas creadas. ${fallos === 0 ? 'Todo correcto.' : `${fallos} comprobación(es) fallida(s).`}`);
  console.log(`Acuérdate de borrar la base "${base}" desde CloudPanel.`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
