#!/usr/bin/env node
// scripts/probar-login-cedula.js — ORDEN 102: POST /auth/login también encuentra por NÚMERO DE CÉDULA («Acceso a candidato»).
//
// Servidor HTTP con las rutas reales (sin Chromium). Casos:
//   · usuario con nombre_usuario DISTINTO de su cédula entra por la cédula;
//   · cédula con ceros a la izquierda / guardada con puntos: la misma regla que el celular (normalizarCedula);
//   · cédula duplicada (misma cédula normalizada en dos usuarios activos) → «Credenciales inválidas.» genérico y queda en la bitácora;
//   · correo y nombre_usuario siguen igual (y tienen prioridad sobre la cédula);
//   · intentos fallidos por cédula SÍ cuentan y bloquean (5 → 423);
//   · usuario inactivo: no se encuentra por cédula; texto no numérico: no se busca por cédula.
//
// USO (base desechable con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33101 DB_USER=root DB_PASSWORD= DB_NAME=simulada102 node scripts/probar-login-cedula.js
// Se niega a correr si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) { console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`); process.exit(2); }
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.LICENCIA_SERVIDOR_URL = 'http://127.0.0.1:1';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';

const http = require('http');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { sembrar, crearApp } = require('./fixtures/coordinadores-celular');

let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];

(async () => {
  await sembrar(pool);
  const sello = String(Date.now()).slice(-6);
  const hash = (t) => bcrypt.hashSync(t, 4);
  const rolId = async (n) => (await q('SELECT id FROM roles WHERE nombre = ?', [n]))[0].id;
  const nuevo = async ({ nombre, cedula, usuario, email, clave, activo = 1, rol = 'candidato' }) => {
    const r = await pool.query(
      `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, password_hash, rol_id, activo, clave_celular_pregunta_hecha)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`, [nombre, cedula, usuario, email, hash(clave), await rolId(rol), activo]);
    return r[0].insertId;
  };

  const C1 = '88' + sello + '01'; const C2 = '88' + sello + '02'; const C3 = '88' + sello + '03'; const C4 = '88' + sello + '04'; const C5 = '88' + sello + '05';
  const CLAVE = 'Clave-102-xyz';
  // 1) nombre_usuario editado: ya no es su cédula.
  const idEditado = await nuevo({ nombre: 'Candidato Editado', cedula: C1, usuario: 'editado.' + sello, email: `editado${sello}@ejemplo.co`, clave: CLAVE });
  // 2) cédula guardada con ceros a la izquierda (misma regla de normalizarCedula).
  const idCeros = await nuevo({ nombre: 'Candidato Ceros', cedula: '00' + C2, usuario: 'ceros.' + sello, email: `ceros${sello}@ejemplo.co`, clave: CLAVE });
  // 3) cédula duplicada tras normalizar: C3 y 000C3.
  const idDup1 = await nuevo({ nombre: 'Duplicado Uno', cedula: C3, usuario: 'dup1.' + sello, email: `dup1${sello}@ejemplo.co`, clave: CLAVE });
  const idDup2 = await nuevo({ nombre: 'Duplicado Dos', cedula: '000' + C3, usuario: 'dup2.' + sello, email: `dup2${sello}@ejemplo.co`, clave: CLAVE });
  // 4) inactivo.
  await nuevo({ nombre: 'Candidato Inactivo', cedula: C4, usuario: 'inactivo.' + sello, email: `inactivo${sello}@ejemplo.co`, clave: CLAVE, activo: 0 });
  // 5) el nombre_usuario de uno ES la cédula de otro: gana el nombre_usuario (lo de siempre).
  const idPorNombre = await nuevo({ nombre: 'Por Nombre Usuario', cedula: '77' + sello + '09', usuario: C5, email: `pornombre${sello}@ejemplo.co`, clave: CLAVE });
  const idPorCedulaOtro = await nuevo({ nombre: 'Dueño de la cédula', cedula: C5, usuario: 'otro.' + sello, email: `otro${sello}@ejemplo.co`, clave: 'Otra-clave-1' });

  const s = http.createServer(crearApp(pool));
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const entrar = async (email, password) => {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    return { status: r.status, cuerpo: await r.json().catch(() => ({})) };
  };
  const GENERICO = 'Credenciales inválidas.';

  console.log('— Entrada por cédula —');
  let r = await entrar(C1, CLAVE);
  ok(r.status === 200 && r.cuerpo.ok && r.cuerpo.usuario && r.cuerpo.usuario.id === idEditado, 'nombre_usuario distinto de la cédula: entra por la cédula', r);
  r = await entrar('editado.' + sello, CLAVE);
  ok(r.status === 200 && r.cuerpo.usuario && r.cuerpo.usuario.id === idEditado, 'el mismo usuario sigue entrando por su nombre_usuario', r);
  r = await entrar(`editado${sello}@ejemplo.co`, CLAVE);
  ok(r.status === 200 && r.cuerpo.usuario && r.cuerpo.usuario.id === idEditado, 'y por su correo', r);
  r = await entrar(C2, CLAVE);
  ok(r.status === 200 && r.cuerpo.usuario && r.cuerpo.usuario.id === idCeros, 'cédula guardada con ceros a la izquierda: entra con los dígitos sin ceros', r);

  console.log('— Cédula duplicada —');
  const antes = (await q(`SELECT COUNT(*) n FROM auditoria WHERE accion = 'login_fallido' AND usuario_id IS NULL AND detalle LIKE '%más de un usuario%'`))[0].n;
  r = await entrar(C3, CLAVE);
  ok(r.status === 401 && r.cuerpo.error === GENERICO, 'cédula en dos usuarios activos: rechazo genérico, sin pista de duplicados', r);
  r = await entrar('000' + C3, CLAVE);
  ok(r.status === 401 && r.cuerpo.error === GENERICO, 'con ceros también: mismo rechazo', r);
  const despues = (await q(`SELECT COUNT(*) n FROM auditoria WHERE accion = 'login_fallido' AND usuario_id IS NULL AND detalle LIKE '%más de un usuario%'`))[0].n;
  ok(despues - antes === 2, 'el duplicado queda en la bitácora', { antes, despues });
  const detalle = (await q(`SELECT detalle FROM auditoria WHERE detalle LIKE '%más de un usuario%' ORDER BY id DESC LIMIT 1`))[0].detalle;
  ok(!detalle.includes(C3) && detalle.includes(String(idDup1)) && detalle.includes(String(idDup2)), 'la bitácora lleva los ids y solo el final de la cédula, no la cédula entera', detalle);
  r = await entrar('dup1.' + sello, CLAVE);
  ok(r.status === 200 && r.cuerpo.usuario && r.cuerpo.usuario.id === idDup1, 'cada uno de los duplicados sigue entrando por su nombre_usuario', r);

  console.log('— Prioridad y casos que NO usan la cédula —');
  r = await entrar(C5, CLAVE);
  ok(r.status === 200 && r.cuerpo.usuario && r.cuerpo.usuario.id === idPorNombre, 'si un nombre_usuario coincide, gana sobre la cédula de otro', r);
  r = await entrar(C5, 'Otra-clave-1');
  ok(r.status === 401, 'y la clave del dueño de la cédula no sirve por ese camino (lo de siempre)', r);
  r = await entrar(C4, CLAVE);
  ok(r.status === 401 && r.cuerpo.error === GENERICO, 'usuario inactivo: no se encuentra por cédula (genérico)', r);
  r = await entrar('99999999' + sello, CLAVE);
  ok(r.status === 401 && r.cuerpo.error === GENERICO, 'cédula que no existe: genérico', r);
  r = await entrar('ced-' + C1, CLAVE);
  ok(r.status === 401 && r.cuerpo.error === GENERICO, 'texto que no son solo dígitos no se busca por cédula', r);
  r = await entrar('000000', CLAVE);
  ok(r.status === 401 && r.cuerpo.error === GENERICO, 'solo ceros: no se busca por cédula', r);

  console.log('— Intentos fallidos —');
  for (let i = 1; i <= 4; i++) {
    r = await entrar(C1, 'mala-' + i);
    ok(r.status === 401 && r.cuerpo.error === GENERICO, `clave mala ${i} por cédula: genérico`, r);
  }
  let u = (await q('SELECT intentos_fallidos, bloqueado_hasta FROM usuarios WHERE id = ?', [idEditado]))[0];
  ok(Number(u.intentos_fallidos) === 4 && !u.bloqueado_hasta, 'los intentos por cédula cuentan en la cuenta (4)', u);
  r = await entrar(C1, 'mala-5');
  u = (await q('SELECT intentos_fallidos, bloqueado_hasta FROM usuarios WHERE id = ?', [idEditado]))[0];
  ok(r.status === 401 && Number(u.intentos_fallidos) === 5 && u.bloqueado_hasta, 'el quinto fallo bloquea la cuenta', u);
  r = await entrar(C1, CLAVE);
  ok(r.status === 423, 'bloqueada: ni la clave correcta entra, por cédula', r);
  r = await entrar('editado.' + sello, CLAVE);
  ok(r.status === 423, 'ni por nombre_usuario (es la misma cuenta)', r);
  const bit = (await q(`SELECT COUNT(*) n FROM auditoria WHERE usuario_id = ? AND accion IN ('login_fallido','bloqueo_cuenta')`, [idEditado]))[0].n;
  ok(Number(bit) === 6, 'la bitácora anota los 5 fallos y el bloqueo', bit);
  void idPorCedulaOtro;

  s.close();
  await pool.end();
  console.log(`\n${pasos - fallos}/${pasos} correctas`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
