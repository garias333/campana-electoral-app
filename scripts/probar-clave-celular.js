#!/usr/bin/env node
// scripts/probar-clave-celular.js
//
// Prueba de la orden 66 (servidor, sesión real): la clave de 6 dígitos del celular para TODOS los que entran por un botón.
//   · por omisión, los últimos 6 de la cédula; se genera al crear, al cambiar la cédula (si no la cambió la persona) y en init-db; nunca se pisa la que la persona eligió
//   · POST /auth/login-celular para líder, sublíder, aspirante, testigo, invitado y coordinador; el administrador y los demás, no; mensaje genérico
//   · la pregunta del primer ingreso («dejar» / «cambiar»), «Cambiar mi clave» con la clave actual, validaciones de 6 dígitos, límite 5/15
//   · la transición con la contraseña de hoy, el restablecimiento por el administrador, el sombrero (líder y testigo), el código de verificación
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada66 node scripts/probar-clave-celular.js
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) {
  console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`);
  process.exit(2);
}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';

const http = require('http');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { sembrar, crearApp, CLAVE_ADMIN } = require('./fixtures/coordinadores-celular');
const { claveDeCedula, sincronizarClaveCelular, problemaDeClaveNueva } = require('../lib/claveCelular');
// El correo del código se SIMULA (antes de que auth.routes lo cargue): sin destinatario falla; con destinatario, queda anotado. No sale nada.
const correosDeCodigo = [];
require('../config/mailer').enviarCodigo2FA = async (destino) => {
  if (!destino) throw new Error('No recipients defined');
  correosDeCodigo.push(destino);
};

let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];

let base = '';
function nuevo() {
  let cookie = '';
  const c = {
    async pedir(metodo, ruta, cuerpo) {
      const h = { 'Content-Type': 'application/json' };
      if (cookie) h.Cookie = cookie;
      const r = await fetch(base + ruta, { method: metodo, headers: h, body: cuerpo ? JSON.stringify(cuerpo) : undefined, redirect: 'manual' });
      const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      if (set.length) cookie = set.map((x) => x.split(';')[0]).join('; ');
      const texto = await r.text();
      let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
      return { status: r.status, datos, texto };
    },
  };
  c.GET = (r) => c.pedir('GET', r); c.POST = (r, b) => c.pedir('POST', r, b); c.PUT = (r, b) => c.pedir('PUT', r, b);
  return c;
}
const entrar = (c, cedula, clave) => c.POST('/api/auth/login-celular', { cedula, clave });
const estado = async (id) => (await q('SELECT clave_celular_hash h, clave_celular_cedula c, clave_celular_es_defecto d, clave_celular_pregunta_hecha p, password_hash ph FROM usuarios WHERE id = ?', [id]))[0];

(async () => {
  const servidor = http.createServer(crearApp(pool));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const { ids } = await sembrar(pool, { conPregunta: true });
  await require('./fixtures/encender-complementos')(pool, ['faltan_por_votar']);
  const MSJ = 'Cédula o clave incorrecta.';
  const MSJ_BLOQUEO = 'Demasiados intentos. Espere 15 minutos.';
  const rolId = async (n) => (await q('SELECT id FROM roles WHERE nombre = ?', [n]))[0].id;
  const crear = async (clave, nombre, rol, cedula, extra = {}) => {
    const [r] = await pool.query(
      `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, password_hash, rol_id, telefono) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nombre, cedula, cedula, extra.email || null, bcrypt.hashSync(extra.password || cedula, 4), await rolId(rol), extra.telefono || null]);
    ids[clave] = r.insertId;
    return r.insertId;
  };
  await crear('testigo', 'Tomás Testigo Ejemplo', 'testigo', '1077000001', { telefono: '3011110001' });
  await crear('aspirante', 'Alicia Aspirante Ejemplo', 'aspirante_concejo', '1077000002', { telefono: '3011110002' });
  await crear('invitado', 'Iván Invitado Ejemplo', 'invitado', '1077000003');
  await crear('asistente', 'Ana Asistente Ejemplo', 'asistente_administrativo', '1077000004');
  await q('INSERT INTO estructura (usuario_id, cargo, activo) VALUES (?, ?, 1)', [ids.testigo, 'testigo']);

  const admin = nuevo();
  await admin.POST('/api/auth/login', { email: 'admin.ej@ejemplo.co', password: CLAVE_ADMIN });

  console.log('\n[1] La clave por omisión y cuándo se genera');
  ok(claveDeCedula('1055000001') === '000001' && claveDeCedula('1.023.456.789') === '456789' && claveDeCedula('12345') === '012345', 'los últimos 6 dígitos de la cédula (con ceros si es corta)');
  ok(problemaDeClaveNueva('12345') && problemaDeClaveNueva('12a456') && problemaDeClaveNueva('1234567') && problemaDeClaveNueva('123456') && problemaDeClaveNueva('111111') && !problemaDeClaveNueva('482913'),
    'una clave nueva: exactamente 6 dígitos y no de las que prueba cualquiera');
  let r = await admin.POST('/api/usuarios', { nombre: 'Lucía Líder Nueva Ejemplo', numero_identificacion: '1066000001', email: 'lucia@ejemplo.co', rol: 'lider', telefono: '3011110010' });
  ok(r.status === 200, 'el administrador crea un líder por el formulario de usuarios', r);
  let e = await estado(r.datos.id);
  ok(/^\$2[aby]\$/.test(e.h || '') && e.c === '1066000001' && Number(e.d) === 1 && Number(e.p) === 0, 'al CREARLO ya tiene su clave (hash bcrypt), es la de por omisión y aún no se le preguntó', e);
  ok(await sincronizarClaveCelular(pool, r.datos.id) === 'sin_cambio', 'sincronizar de nuevo no hace nada (idempotente)');
  ok(await sincronizarClaveCelular(pool, ids.ana) === 'generada' && await sincronizarClaveCelular(pool, ids.ana) === 'sin_cambio', 'a un líder ya existente se le genera una vez (init-db) y la segunda vez no cambia nada');
  ok(await sincronizarClaveCelular(pool, ids.asistente) === 'no_aplica' && (await estado(ids.asistente)).h === null, 'quien NO entra por botón (asistente administrativo) no recibe clave del celular');
  ok(await sincronizarClaveCelular(pool, ids.admin) === 'no_aplica', 'ni el administrador');

  console.log('\n[2] Cada rol de botón entra con los últimos 6 de su cédula; los demás no');
  const casos = [['ana', '1055000001', 'lider', 'líder'], ['sara', '1055000006', 'sublider', 'sublíder'], ['aspirante', '1077000002', 'lider', 'aspirante (viaja como líder)'],
    ['testigo', '1077000001', 'testigo', 'testigo'], ['invitado', '1077000003', 'invitado', 'invitado'], ['coord1', '1023456789', 'coordinador', 'coordinador']];
  const clientes = {};
  for (const [clave, cedula, rolSesion, rotulo] of casos) {
    const c = nuevo(); clientes[clave] = c;
    r = await entrar(c, cedula, claveDeCedula(cedula));
    ok(r.status === 200 && r.datos.ok && r.datos.usuario.id === ids[clave] && r.datos.usuario.rol === rolSesion, `${rotulo}: entra con los últimos 6 de su cédula`, r);
    ok(r.datos.usuario.debe_cambiar_password === false && !!r.datos.tokenCierre && r.datos.dispositivoToken === null, `${rotulo}: sin el aviso «cambia tu clave» del computador, con token de cierre y sin token de dispositivo`);
    const me = await c.GET('/api/auth/me');
    ok(me.status === 200 && me.datos.usuario.clave_celular && me.datos.usuario.clave_celular.pregunta === true && me.datos.usuario.clave_celular.desde_clave_anterior === false, `${rotulo}: /auth/me dice que falta la pregunta del primer ingreso`, me.datos && me.datos.usuario && me.datos.usuario.clave_celular);
  }
  r = await entrar(nuevo(), '1055000001', '999999');
  ok(r.status === 401 && r.datos.error === MSJ, 'clave equivocada → «Cédula o clave incorrecta.»');
  const msjAdmin = (await entrar(nuevo(), '1000000001', '000001'));
  const msjFantasma = (await entrar(nuevo(), '1999999999', '999999'));
  ok(msjAdmin.status === 401 && msjAdmin.datos.error === MSJ && msjFantasma.datos.error === MSJ, 'el ADMINISTRADOR y una cédula que no existe: el MISMO mensaje genérico');
  r = await entrar(nuevo(), '1077000004', '000004');
  ok(r.status === 401 && r.datos.error === MSJ, 'el asistente administrativo tampoco entra por los botones');
  r = await nuevo().POST('/api/auth/login-celular', { cedula: '', clave: '' });
  ok(r.status === 401 && r.datos.error === MSJ, 'vacío → mismo mensaje');
  const aud = await q("SELECT accion, detalle FROM auditoria WHERE usuario_id IN (?, ?) ORDER BY id", [ids.ana, ids.sara]);
  ok(aud.some((a) => a.accion === 'login' && /Ingreso por celular lider/.test(a.detalle)) && aud.some((a) => a.accion === 'login' && /Ingreso por celular sublider/.test(a.detalle)), 'la bitácora anota «Ingreso por celular <rol>»', aud.map((a) => a.detalle));
  ok(!aud.some((a) => /000001|000006|1055000001|1055000006/.test(a.detalle)), 'sin clave ni cédula completa en la bitácora');
  ok((await estado(ids.ana)).ph !== null && (await estado(ids.ana)).ph !== (await estado(ids.ana)).h, 'password_hash (la del computador) sigue siendo otra columna distinta');

  console.log('\n[3] «Dejar la que tengo»: se marca y no se vuelve a preguntar');
  const phAnaAntes = (await estado(ids.ana)).ph;
  r = await clientes.ana.POST('/api/auth/clave-celular/primera', { accion: 'dejar' });
  ok(r.status === 200 && r.datos.ok && r.datos.cambiada === false, 'POST primera {dejar} → ok', r);
  e = await estado(ids.ana);
  ok(Number(e.p) === 1 && Number(e.d) === 1 && e.ph === phAnaAntes, 'queda pregunta hecha, sigue la de por omisión y password_hash no se tocó', e);
  r = await clientes.ana.GET('/api/auth/me');
  ok(r.datos.usuario.clave_celular.pregunta === false, '/auth/me ya no pregunta');
  let c2 = nuevo(); await entrar(c2, '1055000001', '000001');
  r = await c2.GET('/api/auth/me');
  ok(r.datos.usuario.clave_celular.pregunta === false, 'al salir y volver a entrar ya no pregunta');
  r = await c2.POST('/api/auth/clave-celular/primera', { accion: 'dejar' });
  ok(r.status === 409, 'contestar de nuevo → 409 (ya la contestó)', r.status);
  r = await nuevo().POST('/api/auth/clave-celular/primera', { accion: 'dejar' });
  ok(r.status === 401, 'sin sesión → 401', r.status);

  console.log('\n[4] «Cambiar mi clave» en la pregunta del primer ingreso (sin pedir la actual)');
  const sara = clientes.sara;
  const rechazos = [['12345', '12345', '5 dígitos'], ['12a456', '12a456', 'con una letra'], ['1234567', '1234567', '7 dígitos'], ['482913', '482914', 'nueva ≠ repetida'], ['123456', '123456', 'demasiado fácil'], ['', '', 'vacía']];
  for (const [n, rep, que] of rechazos) {
    r = await sara.POST('/api/auth/clave-celular/primera', { accion: 'cambiar', nueva: n, repetir: rep });
    ok(r.status === 400 && !!r.datos.error && !r.texto.includes(n || 'zzz'), `rechaza ${que} (400, y el mensaje no trae la clave)`, r.datos);
  }
  ok(Number((await estado(ids.sara)).p) === 0, 'y la pregunta sigue sin contestar');
  r = await sara.POST('/api/auth/clave-celular/primera', { accion: 'cambiar', nueva: '482913', repetir: '482913' });
  ok(r.status === 200 && r.datos.cambiada === true, 'una clave de 6 dígitos válida se acepta', r);
  e = await estado(ids.sara);
  ok(Number(e.d) === 0 && Number(e.p) === 1 && /^\$2[aby]\$/.test(e.h), 'queda como clave ELEGIDA (no es la de por omisión) y la pregunta contestada', e);
  const audS = await q("SELECT detalle FROM auditoria WHERE usuario_id = ? AND accion = 'clave_celular'", [ids.sara]);
  ok(audS.length === 1 && !/482913/.test(audS[0].detalle), 'auditoría del cambio, sin la clave', audS);
  r = await entrar(nuevo(), '1055000006', '000006');
  ok(r.status === 401 && r.datos.error === MSJ, 'con la clave VIEJA (los últimos 6) ya no entra');
  r = await entrar(nuevo(), '1055000006', '482913');
  ok(r.status === 200 && r.datos.usuario.id === ids.sara, 'con la NUEVA sí');
  const cc4 = nuevo(); await entrar(cc4, '1055000006', '482913');
  r = await cc4.GET('/api/auth/me');
  ok(r.datos.usuario.clave_celular.pregunta === false, 'y ya no pregunta');
  // Una sesión que NO entró por el botón (computador) no puede saltarse la clave actual por esta ruta.
  const compu = nuevo(); await compu.POST('/api/auth/login', { email: '1055000002', password: '1055000002' });
  r = await compu.POST('/api/auth/clave-celular/primera', { accion: 'cambiar', nueva: '482915', repetir: '482915' });
  ok(r.status === 403, 'una sesión del computador no puede usar la pregunta del primer ingreso (usa «Cambiar mi clave»)', r.status);
  r = await admin.POST('/api/auth/clave-celular/primera', { accion: 'dejar' });
  ok(r.status === 403, 'el administrador (sin clave del celular) tampoco → 403', r.status);

  console.log('\n[5] «Cambiar mi clave» desde el menú: pide la clave actual; límite 5 / 15');
  const t = clientes.testigo;
  r = await t.POST('/api/auth/cambiar-clave-celular', { actual: '111222', nueva: '482916', repetir: '482916' });
  ok(r.status === 400 && /actual no es correcta/.test(r.datos.error) && !r.texto.includes('111222') && !r.texto.includes('482916'), 'clave actual mala → 400 «La clave actual no es correcta.» (sin mostrar claves)', r.datos);
  r = await t.POST('/api/auth/cambiar-clave-celular', { actual: '000001', nueva: '482916', repetir: '482917' });
  ok(r.status === 400 && /no son iguales/.test(r.datos.error), 'nueva ≠ repetida → 400');
  r = await t.POST('/api/auth/cambiar-clave-celular', { actual: '000001', nueva: '1234', repetir: '1234' });
  ok(r.status === 400 && /6 dígitos/.test(r.datos.error), 'nueva de 4 dígitos → 400');
  r = await t.POST('/api/auth/cambiar-clave-celular', { actual: 'abc', nueva: '482916', repetir: '482916' });
  ok(r.status === 400, 'actual que no son 6 dígitos → 400');
  const phTestigo = (await estado(ids.testigo)).ph;
  r = await t.POST('/api/auth/cambiar-clave-celular', { actual: '000001', nueva: '482916', repetir: '482916' });
  ok(r.status === 200 && r.datos.ok, 'clave actual buena + nueva válida → ok (la sesión sigue abierta)', r);
  ok((await t.GET('/api/auth/me')).status === 200, 'la sesión actual SIGUE abierta');
  e = await estado(ids.testigo);
  ok(Number(e.d) === 0 && Number(e.p) === 1 && e.ph === phTestigo, 'queda elegida, pregunta contestada y password_hash intacto', e);
  r = await entrar(nuevo(), '1077000001', '000001');
  ok(r.status === 401, 'la vieja ya no entra');
  r = await entrar(nuevo(), '1077000001', '482916');
  ok(r.status === 200 && r.datos.usuario.rol === 'testigo', 'la nueva sí');
  // Límite 5/15 de la clave actual (aparte del ingreso)
  const lim = clientes.invitado;
  for (let i = 1; i <= 4; i++) { r = await lim.POST('/api/auth/cambiar-clave-celular', { actual: '99900' + i, nueva: '482918', repetir: '482918' }); }
  ok(r.status === 400, 'los primeros 4 fallos responden 400');
  r = await lim.POST('/api/auth/cambiar-clave-celular', { actual: '999005', nueva: '482918', repetir: '482918' });
  ok(r.status === 423 && r.datos.error === MSJ_BLOQUEO, 'el quinto: «Demasiados intentos. Espere 15 minutos.»', r);
  r = await lim.POST('/api/auth/cambiar-clave-celular', { actual: '000003', nueva: '482918', repetir: '482918' });
  ok(r.status === 423, 'durante el bloqueo la clave actual CORRECTA también falla', r.status);
  r = await entrar(nuevo(), '1077000003', '000003');
  ok(r.status === 200, 'el bloqueo del cambio de clave no impide entrar (son límites distintos)', r.status);
  await q("UPDATE ingresos_celular_intentos SET bloqueado_hasta = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE cedula = ?", [`cc${ids.invitado}`]);
  r = await lim.POST('/api/auth/cambiar-clave-celular', { actual: '000003', nueva: '482918', repetir: '482918' });
  ok(r.status === 200, 'pasado el bloqueo (reloj simulado) funciona', r.status);
  r = await nuevo().POST('/api/auth/cambiar-clave-celular', { actual: '000001', nueva: '482918', repetir: '482918' });
  ok(r.status === 401, 'sin sesión → 401');
  r = await admin.POST('/api/auth/cambiar-clave-celular', { actual: '000001', nueva: '482918', repetir: '482918' });
  ok(r.status === 403, 'el administrador (sin clave del celular) → 403', r.status);

  console.log('\n[6] Cambiar la cédula: con la clave por omisión se recalcula; con la elegida, NUNCA');
  const cuerpo = (id, nombre, rol, cedula, email) => ({ nombre, numero_identificacion: cedula, nombre_usuario: cedula, email, telefono: '3011110099', rol, activo: true, password_confirmacion: CLAVE_ADMIN });
  const antesAs = await estado(ids.aspirante);
  r = await admin.PUT(`/api/usuarios/${ids.aspirante}`, cuerpo(ids.aspirante, 'Alicia Aspirante Ejemplo', 'aspirante_concejo', '1077004444', 'alicia@ejemplo.co'));
  ok(r.status === 200, 'se le cambia la cédula a la aspirante (clave por omisión)', r);
  e = await estado(ids.aspirante);
  ok(e.c === '1077004444' && e.h !== antesAs.h && Number(e.d) === 1, 'la clave por omisión se RECALCULÓ con la cédula nueva', e);
  ok((await entrar(nuevo(), '1077004444', '004444')).status === 200 && (await entrar(nuevo(), '1077004444', '000002')).status === 401, 'entra con los últimos 6 de la cédula nueva; los de la vieja ya no');
  // El invitado ya había ELEGIDO la suya en [5]: su cédula cambia y su clave no.
  const antesIv = await estado(ids.invitado);
  r = await admin.PUT(`/api/usuarios/${ids.invitado}`, cuerpo(ids.invitado, 'Iván Invitado Ejemplo', 'invitado', '1077003333', 'ivan@ejemplo.co'));
  e = await estado(ids.invitado);
  ok(r.status === 200 && e.h === antesIv.h && Number(e.d) === 0 && (await entrar(nuevo(), '1077003333', '482918')).status === 200, 'al invitado, que ya había elegido la suya, la cédula nueva NO le cambia la clave (sigue la elegida)', e);
  const antesSara = await estado(ids.sara);
  r = await admin.PUT(`/api/usuarios/${ids.sara}`, cuerpo(ids.sara, 'Sara Sublíder Alfa', 'sublider', '1055006666', 'sara@ejemplo.co'));
  ok(r.status === 200, 'se le cambia la cédula a Sara (clave elegida)', r);
  e = await estado(ids.sara);
  ok(e.h === antesSara.h && Number(e.d) === 0, 'su clave ELEGIDA no se tocó', e);
  ok((await entrar(nuevo(), '1055006666', '482913')).status === 200, 'con la nueva cédula sigue entrando con la clave que ella eligió');
  ok((await entrar(nuevo(), '1055006666', '006666')).status === 401, 'y los últimos 6 de la cédula nueva NO sirven (no es la de por omisión)');
  // Cambio por fuera de la aplicación: el ingreso recalcula (solo si es la de por omisión).
  await q("UPDATE usuarios SET numero_identificacion = '1055000002', nombre_usuario = '1055000002' WHERE id = ?", [ids.beto]);
  await sincronizarClaveCelular(pool, ids.beto);
  await q("UPDATE usuarios SET numero_identificacion = '1055007777', nombre_usuario = '1055007777' WHERE id = ?", [ids.beto]);
  ok((await entrar(nuevo(), '1055007777', '007777')).status === 200, 'un UPDATE a mano de la cédula: el ingreso recalcula y entra con la nueva');
  ok(await sincronizarClaveCelular(pool, ids.sara) === 'sin_cambio', 'init-db (sincronizar) NO pisa la clave elegida');

  console.log('\n[7] La transición: quien escribe su contraseña de hoy entra una vez más y ve la pregunta');
  const eva = ids.eva; const diego = ids.diego;
  r = await entrar(nuevo(), '1055000004', '1055000004');
  ok(r.status === 200 && r.datos.usuario.id === diego, 'Diego (pregunta sin contestar) entra escribiendo su cédula completa (su contraseña de hoy)', r);
  const cd = nuevo(); await entrar(cd, '1055000004', '1055000004');
  r = await cd.GET('/api/auth/me');
  ok(r.datos.usuario.clave_celular.pregunta === true && r.datos.usuario.clave_celular.desde_clave_anterior === true, '/auth/me: pregunta pendiente y DESDE LA CLAVE ANTERIOR (la pantalla se lo explica)', r.datos.usuario.clave_celular);
  const audD = await q("SELECT detalle FROM auditoria WHERE usuario_id = ? AND accion = 'login' ORDER BY id DESC LIMIT 1", [diego]);
  ok(/contraseña anterior/.test(audD[0].detalle) && !/1055000004/.test(audD[0].detalle), 'la bitácora lo anota (sin la cédula completa)', audD);
  r = await cd.POST('/api/auth/clave-celular/primera', { accion: 'dejar' });
  ok(r.status === 200, 'contesta «Dejar la que tengo»');
  r = await entrar(nuevo(), '1055000004', '1055000004');
  ok(r.status === 401 && r.datos.error === MSJ, 'contestada la pregunta, la contraseña de hoy YA NO sirve por el botón (UNA vez más)');
  r = await entrar(nuevo(), '1055000004', '000004');
  ok(r.status === 200, 'pero los últimos 6 de su cédula sí');
  // Una contraseña de 6 cifras que él había elegido antes (el cambio obligatorio de la app) también sirve la última vez.
  await q('UPDATE usuarios SET password_hash = ? WHERE id = ?', [bcrypt.hashSync('482920', 4), eva]);
  r = await entrar(nuevo(), '1055000005', '482920');
  ok(r.status === 200 && r.datos.usuario.id === eva, 'una contraseña de 6 cifras elegida antes también entra esa vez (transición)');
  r = await entrar(nuevo(), '1055000005', '482999');
  ok(r.status === 401, 'una de 6 cifras equivocada no entra');
  await q('UPDATE usuarios SET clave_celular_pregunta_hecha = 1 WHERE id = ?', [eva]);
  r = await entrar(nuevo(), '1055000005', '482920');
  ok(r.status === 401, 'con la pregunta ya contestada, la contraseña de hoy no entra');
  ok((await estado(eva)).ph !== null, '(password_hash no se tocó)');
  // El alias viejo de coordinadores no admite la contraseña de hoy.
  await q('UPDATE usuarios SET clave_celular_pregunta_hecha = 0, password_hash = ? WHERE id = ?', [bcrypt.hashSync('1034567891', 4), ids.coord2]);
  r = await nuevo().POST('/api/auth/login-coordinador', { cedula: '1034567891', clave: '1034567891' });
  ok(r.status === 401, 'el alias /login-coordinador (la pantalla vieja de la Orden 59) no admite la contraseña de hoy');
  r = await nuevo().POST('/api/auth/login-coordinador', { cedula: '1034567891', clave: '567891' });
  ok(r.status === 200 && r.datos.usuario.rol === 'coordinador', 'pero sí la clave del celular (compatibilidad)');

  console.log('\n[8] Bloqueo 5 fallos / 15 minutos por cédula, mensaje genérico');
  for (let i = 1; i <= 4; i++) { r = await entrar(nuevo(), '1055000007', '00000' + i); ok(r.status === 401 && r.datos.error === MSJ, `fallo ${i}: 401 genérico`); }
  r = await entrar(nuevo(), '1055000007', '000005');
  ok(r.status === 423 && r.datos.error === MSJ_BLOQUEO, 'el quinto fallo: «Demasiados intentos. Espere 15 minutos.»', r);
  r = await entrar(nuevo(), '1055000007', '000007');
  ok(r.status === 423, 'durante el bloqueo la clave CORRECTA también falla');
  for (let i = 1; i <= 4; i++) await entrar(nuevo(), '1999999991', '12345' + i);
  r = await entrar(nuevo(), '1999999991', '123459');
  ok(r.status === 423 && r.datos.error === MSJ_BLOQUEO, 'una cédula que NO existe se bloquea igual y con el mismo mensaje');
  await q("UPDATE ingresos_celular_intentos SET bloqueado_hasta = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE cedula = '1055000007'");
  r = await entrar(nuevo(), '1055000007', '000007');
  ok(r.status === 200, 'pasado el bloqueo (reloj simulado) entra');
  ok((await nuevo().POST('/api/auth/login', { email: 'ana@ejemplo.co', password: '1055000001' })).status === 200, 'y el bloqueo es solo de esta puerta: el ingreso del computador (por correo) sigue');

  console.log('\n[9] El administrador restablece la clave del celular');
  r = await admin.POST(`/api/usuarios/${ids.sara}/restablecer-clave-celular`, { password_confirmacion: 'otra' });
  ok(r.status === 403, 'sin su contraseña de confirmación → 403', r.status);
  r = await admin.POST(`/api/usuarios/${ids.sara}/restablecer-clave-celular`, { password_confirmacion: CLAVE_ADMIN });
  ok(r.status === 200 && r.datos.ok, 'con su contraseña → ok', r);
  e = await estado(ids.sara);
  ok(Number(e.d) === 1 && Number(e.p) === 0 && e.c === '1055006666', 'vuelve a los últimos 6 de la cédula actual, como clave por omisión y con la pregunta activa de nuevo', e);
  ok((await entrar(nuevo(), '1055006666', '482913')).status === 401, 'la que había elegido deja de servir');
  const cs = nuevo(); r = await entrar(cs, '1055006666', '006666');
  ok(r.status === 200, 'entra con los últimos 6 de su cédula');
  r = await cs.GET('/api/auth/me');
  ok(r.datos.usuario.clave_celular.pregunta === true, 'y vuelve a verse la pregunta');
  const audR = await q("SELECT usuario_id, detalle, created_at FROM auditoria WHERE accion = 'restablecer_clave_celular' ORDER BY id DESC LIMIT 1");
  ok(audR.length === 1 && audR[0].usuario_id === ids.admin && !!audR[0].created_at && !/006666|482913/.test(audR[0].detalle), 'queda anotado quién (el administrador) y cuándo, sin la clave', audR);
  r = await admin.POST(`/api/usuarios/${ids.admin}/restablecer-clave-celular`, { password_confirmacion: CLAVE_ADMIN });
  ok(r.status === 400 && /no entra por los botones/.test(r.datos.error), 'a una cuenta que no entra por botón (la del administrador) → 400 claro', r.datos);
  r = await admin.POST('/api/usuarios/99999999/restablecer-clave-celular', { password_confirmacion: CLAVE_ADMIN });
  ok(r.status === 404, 'un id que no existe → 404', r.status);
  r = await clientes.coord1.POST(`/api/usuarios/${ids.sara}/restablecer-clave-celular`, { password_confirmacion: '000001' });
  ok(r.status === 403, 'un coordinador no puede (solo administrador)', r.status);
  // bloqueo levantado al restablecer
  for (let i = 1; i <= 5; i++) await entrar(nuevo(), '1055006666', '99999' + i);
  ok((await entrar(nuevo(), '1055006666', '006666')).status === 423, '(sara está bloqueada tras 5 fallos)');
  await admin.POST(`/api/usuarios/${ids.sara}/restablecer-clave-celular`, { password_confirmacion: CLAVE_ADMIN });
  ok((await entrar(nuevo(), '1055006666', '006666')).status === 200, 'restablecer también libera el bloqueo');

  console.log('\n[10] Líder que además es testigo: el sombrero se elige, y la clave sigue su camino');
  await q("INSERT INTO estructura (usuario_id, cargo, activo) VALUES (?, 'testigo', 1)", [ids.carla]);
  const ccar = nuevo();
  r = await entrar(ccar, '1055000003', '000003');
  ok(r.status === 200 && r.datos.requiereEleccionRol === true && r.datos.opciones.length >= 2, 'el servidor pide elegir cómo entra (principal / testigo)', r.datos);
  r = await ccar.POST('/api/auth/elegir-rol', { entrarComo: 'principal' });
  ok(r.status === 200 && r.datos.usuario.debe_cambiar_password === false && r.datos.usuario.id === ids.carla, 'al elegir entra, también sin el aviso «cambia tu clave» del computador', r);
  r = await ccar.GET('/api/auth/me');
  ok(r.datos.usuario.clave_celular && r.datos.usuario.clave_celular.pregunta === true, 'y la pregunta de la clave sigue pendiente');
  const cc10 = nuevo(); await entrar(cc10, '1055000003', '000003');
  r = await cc10.POST('/api/auth/elegir-rol', { entrarComo: 'testigo' });
  ok(r.status === 200 && r.datos.usuario.rol === 'testigo', 'eligiendo «testigo» entra como testigo', r.datos);

  console.log('\n[11] Código de verificación: el coordinador no lo pide; los demás, como hoy (solo si lo activaron)');
  await q('UPDATE usuarios SET two_factor_enabled = 1, email = ? WHERE id = ?', ['ana2fa@ejemplo.co', ids.ana]);
  await q('UPDATE usuarios SET two_factor_enabled = 1 WHERE id = ?', [ids.coord1]);
  const antesCodigos = correosDeCodigo.length;
  r = await entrar(nuevo(), '1055000001', '000001');
  ok(r.status === 200 && r.datos.requiere2fa === true && correosDeCodigo[correosDeCodigo.length - 1] === 'ana2fa@ejemplo.co', 'un líder con la verificación en dos pasos SIGUE pidiéndola (como hoy)', r);
  r = await entrar(nuevo(), '1023456789', '456789');
  ok(r.status === 200 && !r.datos.requiere2fa && r.datos.usuario.rol === 'coordinador' && correosDeCodigo.length === antesCodigos + 1, 'el coordinador con la marca NO la pide por esta puerta (Orden 62)', r.datos);
  await q('UPDATE usuarios SET two_factor_enabled = 0 WHERE id IN (?, ?)', [ids.ana, ids.coord1]);
  r = await entrar(nuevo(), '1055000001', '000001');
  ok(r.status === 200 && !r.datos.requiere2fa, 'sin la marca, entra directo');

  console.log('\n[12] Lo que NO cambia: el ingreso del computador y «Otros usuarios»');
  r = await nuevo().POST('/api/auth/login', { email: '1055000001', password: '1055000001' });
  ok(r.status === 200 && r.datos.usuario.id === ids.ana, 'POST /auth/login (cédula + password_hash) sigue entrando como antes', r.status);
  r = await nuevo().POST('/api/auth/login', { email: 'admin.ej@ejemplo.co', password: CLAVE_ADMIN });
  ok(r.status === 200 && r.datos.usuario.rol === 'admin', 'el administrador por correo y contraseña sigue entrando');
  r = await nuevo().POST('/api/auth/login', { email: 'marta@ejemplo.co', password: '456789' });
  ok(r.status === 401, 'la clave del celular NO sirve como contraseña de correo (son dos cosas)');
  const compu2 = nuevo(); await compu2.POST('/api/auth/login', { email: '1055000001', password: '1055000001' });
  r = await compu2.POST('/api/auth/cambiar-clave-celular', { actual: '000001', nueva: '482930', repetir: '482930' });
  ok(r.status === 200, '«Cambiar mi clave» también funciona desde una sesión del computador (pide la actual)', r.status);

  console.log('\n[13] El límite por IP (solo gastan cupo los fallos)');
  let primero429 = null;
  for (let i = 1; i <= 80 && !primero429; i++) {
    const x = await entrar(nuevo(), String(7000000000 + i), '123456');
    if (x.status === 429) primero429 = { i, mensaje: x.datos && x.datos.error };
  }
  ok(!!primero429 && primero429.mensaje === MSJ_BLOQUEO, 'tras muchos fallos desde la misma IP responde 429 «Demasiados intentos. Espere 15 minutos.»', primero429);

  await q('DELETE FROM ingresos_celular_intentos');
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO BIEN'} (${pasos} comprobaciones)`);
  servidor.close();
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
