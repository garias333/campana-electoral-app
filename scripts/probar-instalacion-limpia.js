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
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { execFileSync } = require('child_process');

const PROYECTO = path.join(__dirname, '..');

// El celular con el que init-db debe haber creado al superadministrador. Sale del MISMO
// módulo que usa init-db, leído después de dotenv, así que respeta SUPERADMIN_TELEFONO si
// está definido (los procesos hijos heredan este entorno) y, si no, vale 3104157434.
const { TELEFONO_SUPERADMIN: TELEFONO_ESPERADO } = require('../config/superadminCorreo');

// Donde init-db deja la clave del superadministrador (db/init-db.js). Cae en la carpeta
// del proyecto, o sea EN ESTE ÁRBOL aunque la base sea desechable: por eso la prueba
// se niega a empezar si ya hay uno y borra el suyo al terminar.
const ARCHIVO_SUPERADMIN = path.join(PROYECTO, '.credenciales-superadmin.txt');

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

  // Parche 262: una campaña nueva se queda con `territorios` como TABLA local editable y
  // sus ids nacen en 500.000.000, lejos de los del catálogo (db/init-db.js,
  // ajustarContadorTerritorios).
  ['territorios es una TABLA local (BASE TABLE), no una vista',
   `SELECT COUNT(*) n FROM information_schema.tables
     WHERE table_schema=DATABASE() AND table_name='territorios' AND table_type='BASE TABLE'`, 1],

  ['El contador de territorios.id quedó en 500.000.000 o más',
   `SELECT COUNT(*) n FROM information_schema.tables
     WHERE table_schema=DATABASE() AND table_name='territorios' AND auto_increment >= 500000000`, 1],

  ['Ninguna FK apunta a territorios salvo la suya propia (A2: una FK viva impide convertirla en vista)',
   `SELECT COUNT(*) n FROM information_schema.key_column_usage
     WHERE table_schema=DATABASE() AND referenced_table_name='territorios'
       AND table_name <> 'territorios'`, 0],

  // Las cinco de siempre (usuarios, estructura, votantes, eventos, finanzas_movimientos)
  // más estructura_territorios, la lista de territorios por persona (db/schema.sql).
  ['territorio_id sigue indexado en las 6 tablas (A2: al quitar las FK se perdía su índice; la 6.ª es estructura_territorios)',
   `SELECT COUNT(DISTINCT table_name) n FROM information_schema.statistics
     WHERE table_schema=DATABASE() AND column_name='territorio_id'`, 6],

  ['estructura_territorios existe (la crea db/schema.sql; que no tenga FK hacia territorios lo comprueba la prueba de arriba)',
   `SELECT COUNT(*) n FROM information_schema.tables
     WHERE table_schema=DATABASE() AND table_name='estructura_territorios'`, 1],

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

  // 10 filas: db/schema.sql:20-28 (9 roles) + :43 (aspirante_concejo); el
  // INSERT es el de :19 y no hay otro INSERT/REPLACE/UPDATE de roles en
  // db/, routes/ ni config/.
  ['Los 10 roles quedaron sembrados',
   `SELECT COUNT(*) n FROM roles`, 10],

  // El superadministrador también tiene rol admin (config/superadmin.js), así que el
  // administrador corriente se cuenta aparte: rol admin y es_superadmin = 0.
  ['Se creó exactamente un administrador corriente (es_superadmin = 0)',
   `SELECT COUNT(*) n FROM usuarios u JOIN roles r ON r.id=u.rol_id
     WHERE r.nombre='admin' AND u.es_superadmin = 0`, 1],

  ['Se creó exactamente un superadministrador (rol admin, activo)',
   `SELECT COUNT(*) n FROM usuarios u JOIN roles r ON r.id=u.rol_id
     WHERE u.es_superadmin = 1 AND r.nombre='admin' AND u.activo = 1`, 1],

  ['...y debe cambiar la contraseña en el primer ingreso (debe_cambiar_password = 1)',
   `SELECT COUNT(*) n FROM usuarios WHERE es_superadmin = 1 AND debe_cambiar_password = 1`, 1],

  // El superadministrador entra SIEMPRE con código (db/init-db.js: crearSuperadminInicial
  // y asegurarSuperadmin). Sin la bandera, entraría solo con la clave; sin teléfono, el
  // código por SMS no tendría a dónde llegar.
  ['...y nace con el código de ingreso encendido (two_factor_enabled = 1)',
   `SELECT COUNT(*) n FROM usuarios WHERE es_superadmin = 1 AND two_factor_enabled = 1`, 1],

  [`...y con el celular ${TELEFONO_ESPERADO} (SUPERADMIN_TELEFONO o el de por omisión)`,
   `SELECT COUNT(*) n FROM usuarios
     WHERE es_superadmin = 1 AND telefono = ${mysql.escape(TELEFONO_ESPERADO)}`, 1],

  ['...sin cédula ni nombre de usuario (no cruza con ningún votante)',
   `SELECT COUNT(*) n FROM usuarios
     WHERE es_superadmin = 1 AND numero_identificacion IS NULL AND nombre_usuario IS NULL`, 1],

  ['...y su creación quedó en la auditoría',
   `SELECT COUNT(*) n FROM auditoria WHERE accion = 'crear_superadmin'`, 1],

  ['El superadministrador NO está en la estructura (disparadores creados)',
   `SELECT COUNT(*) n FROM information_schema.triggers
     WHERE trigger_schema = DATABASE() AND trigger_name LIKE 'trg_estructura_sin_superadmin_%'`, 2],

  // 9 filas por módulo, una por rol de ROLES_A_SEMBRAR (db/init-db.js:381 =
  // los 8 de ROLES_PERMISOS de :368 + 'administrativo'), con permitido 0 o 1
  // (:424-440). 'aspirante_concejo' NO entra: está en `roles` y no en esa lista.
  ['Los permisos por defecto están sembrados (9 roles x módulo votantes)',
   `SELECT COUNT(*) n FROM permisos_rol WHERE modulo='votantes'`, 9],

  ['La política de privacidad quedó sembrada',
   `SELECT COUNT(*) n FROM contenido_paginas WHERE clave='politica_privacidad'`, 1],
];

async function main() {
  const [base, usuario, claveArg] = process.argv.slice(2);
  // La contraseña se prefiere por variable de entorno. Un argumento de línea
  // de comandos lo ve cualquiera con acceso al servidor mientras el proceso
  // corre (`ps aux`) y además queda en el historial del shell — es el mismo
  // criterio que ya aplica routes/backup.routes.js con MYSQL_PWD. Se sigue
  // aceptando como argumento por comodidad, pero avisando.
  const clave = process.env.DB_PASSWORD_PRUEBA || claveArg;
  if (!base || !usuario || !clave) {
    console.error('Uso:');
    console.error('  DB_PASSWORD_PRUEBA=... node scripts/probar-instalacion-limpia.js <base> <usuario>');
    console.error('  (o bien)  node scripts/probar-instalacion-limpia.js <base> <usuario> <clave>');
    console.error('');
    console.error('La base y el usuario se crean ANTES en CloudPanel (Databases -> Add Database).');
    console.error('La clave es la que CloudPanel genera o la que escribas ahí: no existe de antes.');
    process.exit(1);
  }
  if (claveArg && !process.env.DB_PASSWORD_PRUEBA) {
    console.warn('Aviso: la contraseña va en la línea de comandos, así que queda en el historial\n' +
                 '       del shell y visible en `ps`. Para evitarlo: DB_PASSWORD_PRUEBA=... node ...\n');
  }
  if (BASES_PROHIBIDAS.includes(base.toLowerCase())) {
    console.error(`NO. "${base}" es una base real o del sistema. Esta prueba crea tablas y escribe datos (no borra nada) y solo corre sobre una base desechable y VACÍA.`);
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

  if (fs.existsSync(ARCHIVO_SUPERADMIN)) {
    console.error(`NO. Ya existe ${ARCHIVO_SUPERADMIN}. init-db no crearía el superadministrador ` +
                  'para no pisar una clave sin leer, y la prueba no probaría nada. Léalo (cat) y bórrelo antes.');
    process.exit(1);
  }

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
  // El contador de AUTO_INCREMENT de information_schema viene de una caché de
  // estadísticas (MySQL 8): sin esto la comprobación leería un valor atrasado.
  try { await cx.query('SET SESSION information_schema_stats_expiry = 0'); } catch (_) { /* servidor sin esa variable */ }
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
  const [[superFila]] = await cx.query(`SELECT email FROM usuarios WHERE es_superadmin = 1 LIMIT 1`);

  // --- El archivo con la clave del superadministrador ------------------------
  const informar = (bien, titulo, detalle) => {
    if (!bien) fallos++;
    console.log(`  ${bien ? 'OK  ' : 'FALLA'}  ${titulo}${bien ? '' : `  [${detalle}]`}`);
  };
  console.log('');
  let existe = false, modo = null, contenido = '';
  try {
    const st = fs.statSync(ARCHIVO_SUPERADMIN);
    existe = st.isFile(); modo = st.mode & 0o777;
    contenido = fs.readFileSync(ARCHIVO_SUPERADMIN, 'utf8');
  } catch (_) { /* informar lo dice */ }
  informar(existe, 'Existe .credenciales-superadmin.txt en la carpeta del proyecto', 'no existe');
  informar(modo === 0o600, 'El archivo está en modo 0600',
           `modo ${modo === null ? 'n/a' : '0' + modo.toString(8)}`);
  const claveSuper = (contenido.match(/^Contraseña:\s+(\S+)/m) || [])[1] || '';
  informar(claveSuper.length >= 16, 'Trae una contraseña de 16 o más caracteres', `${claveSuper.length} caracteres`);
  informar(Boolean(superFila) && contenido.includes(superFila.email),
           'Y el correo del archivo es el del superadministrador de la base', 'no coincide');
  // La prueba no deja la clave de una base desechable dentro del árbol del proyecto.
  try { fs.unlinkSync(ARCHIVO_SUPERADMIN); } catch (_) { /* ya no está */ }

  // --- SEGUNDA CORRIDA: sobre una base ya instalada no debe crear nada --------
  console.log('\nSegunda corrida de init-db sobre la base ya instalada (se captura su salida):\n');
  let salida2 = '';
  try {
    salida2 = execFileSync(process.execPath, [path.join(PROYECTO, 'db', 'init-db.js')], {
      cwd: PROYECTO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, DB_NAME: base, DB_USER: usuario, DB_PASSWORD: clave },
    });
  } catch (err) {
    informar(false, 'La segunda corrida termina sin error', String(err.message).split('\n')[0]);
  }
  informar(!fs.existsSync(ARCHIVO_SUPERADMIN), 'No escribió ningún archivo de credenciales', 'apareció el archivo');
  try { fs.unlinkSync(ARCHIVO_SUPERADMIN); } catch (_) { /* no está, como debe */ }
  informar(!/Password:|Contraseña:|Usuario administrador creado|Superadministrador creado/.test(salida2),
           'No imprimió credenciales ni "creado"', 'la salida menciona una creación');
  // asegurarSuperadmin corre en CADA init-db y debe decir cuántos superadmins cubre: uno.
  informar(/superadmin asegurado \(1\)/.test(salida2),
           'Imprimió «superadmin asegurado (1)»',
           (salida2.match(/superadmin asegurado \(\d+\)/) || ['no apareció'])[0]);
  const [[{ n: admins2 }]] = await cx.query(
    `SELECT COUNT(*) n FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE r.nombre='admin' AND u.es_superadmin = 0`);
  const [[{ n: supers2 }]] = await cx.query(`SELECT COUNT(*) n FROM usuarios WHERE es_superadmin = 1`);
  const [[{ n: usuarios2 }]] = await cx.query(`SELECT COUNT(*) n FROM usuarios`);
  informar(supers2 === 1, 'Sigue habiendo exactamente un superadministrador', `hay ${supers2}`);
  informar(admins2 === 1 && supers2 === 1 && usuarios2 === 2,
           'Siguen 1 administrador, 1 superadministrador y 2 usuarios en total',
           `admins ${admins2}, superadmins ${supers2}, usuarios ${usuarios2}`);
  await cx.end();

  console.log(`\n${total} tablas creadas. ${fallos === 0 ? 'Todo correcto.' : `${fallos} comprobación(es) fallida(s).`}`);
  console.log(`Acuérdate de borrar la base "${base}" desde CloudPanel.`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
