#!/usr/bin/env node
// scripts/candidato-de-prueba.js
//
// Crea, cambia la clave o quita un CANDIDATO DE PRUEBA (orden 71) para ver la app del candidato en el celular. Todo se reconoce a simple vista:
//   · correo candidato.prueba@ejemplo.co, cédula 9000000700 (el rango 9000… no se asigna a nadie), nombre «Candidato de Prueba».
// La clave NO está escrita en ningún sitio: se genera al azar y se IMPRIME UNA SOLA VEZ en la consola de quien corre el script (guárdela ahí; si se pierde, «clave» da otra).
//
// USO (usa el .env de la instalación en la que se corre):
//   node scripts/candidato-de-prueba.js crear     crea la cuenta e imprime la clave (no hace nada si ya existe)
//   node scripts/candidato-de-prueba.js clave     le pone una clave nueva al azar e imprime la clave
//   node scripts/candidato-de-prueba.js quitar    borra SOLO esa cuenta (y su rastro de sesiones); a nadie más
//
// SE NIEGA A CORRER si la base no tiene el rol «candidato» (falta correr db/init-db.js).

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

const CEDULA = '9000000700';
const CORREO = 'candidato.prueba@ejemplo.co';

function claveAlAzar() {
  const alfabeto = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sin letras que se confunden (l, I, O, 0, 1)
  let c = '';
  for (let i = 0; i < 12; i++) c += alfabeto[crypto.randomInt(0, alfabeto.length)];
  return c;
}

async function existente() {
  const [f] = await pool.query('SELECT id FROM usuarios WHERE numero_identificacion = ? OR email = ?', [CEDULA, CORREO]);
  return f[0] || null;
}

async function crear() {
  const [[rol]] = await pool.query("SELECT id FROM roles WHERE nombre = 'candidato'");
  if (!rol) { console.error('Falta el rol «candidato»: corre primero «node db/init-db.js».'); process.exit(1); }
  if (await existente()) { console.log('Ya existe el candidato de prueba: no se hizo nada. (Para una clave nueva: «clave». Para empezar de nuevo: «quitar» y luego «crear».)'); return; }
  const clave = claveAlAzar();
  await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, debe_cambiar_password)
     VALUES ('Candidato de Prueba', ?, ?, ?, '3000000700', ?, ?, 1, 0)`,
    [CEDULA, 'candidato.prueba', CORREO, await bcrypt.hash(clave, 12), rol.id]);
  console.log('Candidato de prueba creado.');
  console.log('  Correo (o usuario «candidato.prueba»): ' + CORREO);
  console.log('  Clave (se muestra solo esta vez):      ' + clave);
}

async function nuevaClave() {
  const u = await existente();
  if (!u) { console.error('No existe el candidato de prueba: usa «crear».'); process.exit(1); }
  const clave = claveAlAzar();
  await pool.query('UPDATE usuarios SET password_hash = ?, intentos_fallidos = 0, bloqueado_hasta = NULL, debe_cambiar_password = 0 WHERE id = ?', [await bcrypt.hash(clave, 12), u.id]);
  console.log('Clave nueva del candidato de prueba (se muestra solo esta vez): ' + clave);
}

async function quitar() {
  const u = await existente();
  if (!u) { console.log('No hay candidato de prueba: no se hizo nada.'); return; }
  await pool.query('DELETE FROM usuarios WHERE id = ?', [u.id]);
  console.log('Candidato de prueba borrado.');
}

(async () => {
  const accion = process.argv[2];
  try {
    if (accion === 'crear') await crear();
    else if (accion === 'clave') await nuevaClave();
    else if (accion === 'quitar') await quitar();
    else { console.error('Uso: node scripts/candidato-de-prueba.js crear | clave | quitar'); process.exitCode = 2; }
  } catch (err) { console.error('No se pudo:', err.code || err.message); process.exitCode = 1; }
  await pool.end();
})();
