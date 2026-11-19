#!/usr/bin/env node
// scripts/coordinador-de-prueba.js
//
// Crea (o quita) un COORDINADOR DE PRUEBA con dos líderes de ejemplo, un sublíder y unas pocas personas registradas, para ver «Mis líderes» en el celular
// (orden 59). Todo es inventado y se reconoce a simple vista:
//   · cédulas 9000000590 al 9000000593 y 9000005101 en adelante (el rango 9000… no se asigna a nadie) y teléfonos 300000059x;
//   · nombres «… de Prueba»; las personas registradas se llaman «Persona de prueba N» y cuelgan solo de estos líderes.
//
// USO (usa el .env de la instalación en la que se corre):
//   node scripts/coordinador-de-prueba.js crear
//   node scripts/coordinador-de-prueba.js quitar
//
// «crear» no hace nada si ya existe; «quitar» borra SOLO lo que lleva esas cédulas (y sus fichas de prueba). Ninguna de las dos toca a nadie más.
// SE NIEGA A CORRER si la base NO tiene la columna de la clave del celular (falta correr db/init-db.js).

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { sincronizarClaveCelular } = require('../lib/claveCelular');

const CEDULAS = ['9000000590', '9000000591', '9000000592', '9000000593', '9000000594'];
const PERSONAS = [
  // clave, nombre, rol, cédula, celular, cargo en la estructura, quién la supervisa, meta
  ['coord', 'Coordinador de Prueba', 'coordinador', '9000000590', '3000000590', 'coordinador', null, 0],
  ['uno', 'Líder de Prueba Uno', 'lider', '9000000591', '3000000591', 'lider', 'coord', 20],
  ['dos', 'Líder de Prueba Dos', 'lider', '9000000592', null, 'lider', 'coord', 10],
  ['sub', 'Sublíder de Prueba Tres', 'sublider', '9000000593', '3000000593', 'usuario', 'uno', 5],
];

async function crear() {
  const [ya] = await pool.query('SELECT id FROM usuarios WHERE numero_identificacion IN (?)', [CEDULAS]);
  if (ya.length) { console.log('Ya existe el coordinador de prueba: no se hizo nada. (Para empezar de nuevo: «quitar» y luego «crear».)'); return; }
  const [[col]] = await pool.query(`SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'usuarios' AND column_name = 'clave_celular_hash'`);
  if (!col.n) { console.error('Falta la columna usuarios.clave_celular_hash: corre primero «node db/init-db.js».'); process.exit(1); }

  const ids = {};
  for (const [clave, nombre, rol, cedula, tel, cargo, jefe, meta] of PERSONAS) {
    const [[r]] = await pool.query('SELECT id FROM roles WHERE nombre = ?', [rol]);
    if (!r) throw new Error(`No existe el rol «${rol}».`);
    // Como lo hace la aplicación al crear desde la estructura: usuario y contraseña inicial = la cédula.
    const [u] = await pool.query(
      `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, telefono, debe_cambiar_password)
       VALUES (?, ?, ?, ?, ?, ?, 1)`, [nombre, cedula, cedula, bcrypt.hashSync(cedula, 12), r.id, tel]);
    ids[clave] = u.insertId;
    await pool.query(
      'INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo, meta_votos, meta_votos_base) VALUES (?, ?, ?, 1, ?, ?)',
      [u.insertId, cargo, jefe ? ids[jefe] : null, meta, meta]);
  }
  await sincronizarClaveCelular(pool, ids.coord);

  // Unas pocas personas registradas, repartidas en el tiempo para que se vea el semáforo y el «último registro».
  const fichas = [[ids.uno, null, 0], [ids.uno, null, 2], [ids.uno, null, 4], [ids.uno, ids.sub, 1], [ids.dos, null, 9], [ids.dos, null, 10]];
  let n = 0;
  for (const [lider, sub, dias] of fichas) {
    n++;
    await pool.query(
      `INSERT INTO votantes (nombre, cedula, telefono, lider_id, sublider_id, origen, created_at)
       VALUES (?, ?, ?, ?, ?, 'manual', DATE_SUB(NOW(), INTERVAL ? DAY))`,
      [`Persona de prueba ${n}`, `9000005${100 + n}`, `30000059${String(n).padStart(2, '0')}`, lider, sub, dias]);
  }
  console.log('Listo. Coordinador de prueba creado:');
  console.log('  Ingreso por el celular («Acceso a Coordinadores»):');
  console.log('    Cédula: 9000000590     Clave: 000590   (los últimos 6 dígitos de la cédula)');
  console.log('  Líderes de ejemplo: Líder de Prueba Uno (meta 20, 4 registros), Líder de Prueba Dos (meta 10, 2 registros, sin celular).');
}

async function quitar() {
  const [us] = await pool.query('SELECT id FROM usuarios WHERE numero_identificacion IN (?)', [CEDULAS]);
  const idsU = us.map((u) => u.id);
  const [v] = await pool.query("DELETE FROM votantes WHERE nombre LIKE 'Persona de prueba %' AND cedula LIKE '9000005%'");
  if (idsU.length) {
    await pool.query('DELETE FROM sesiones_cierre WHERE usuario_id IN (?)', [idsU]).catch(() => {});
    await pool.query('DELETE FROM estructura WHERE usuario_id IN (?)', [idsU]);
    await pool.query('DELETE FROM usuarios WHERE id IN (?)', [idsU]);
  }
  await pool.query('DELETE FROM ingresos_celular_intentos WHERE cedula IN (?)', [CEDULAS]).catch(() => {});
  console.log(`Quitado: ${idsU.length} usuario(s) de prueba y ${v.affectedRows} persona(s) registrada(s) de prueba.`);
}

(async () => {
  const modo = process.argv[2];
  if (modo === 'crear') await crear();
  else if (modo === 'quitar') await quitar();
  else { console.error('Uso: node scripts/coordinador-de-prueba.js crear | quitar'); process.exitCode = 2; }
  await pool.end();
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
