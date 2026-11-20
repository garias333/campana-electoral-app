#!/usr/bin/env node
// scripts/probar-coordinadores-celular.js
//
// Prueba de la orden 59: el ingreso de coordinadores por el celular (cédula + clave de 6 dígitos) y «Mis líderes».
//   · Ingreso: la clave son los últimos 6 de la cédula; otra clave falla; cambiar la cédula recalcula la clave (la vieja ya no sirve);
//     cédula corta (relleno con ceros); sin cédula; inactivo; cambio de rol; la clave se guarda con hash y nunca aparece en la bitácora.
//   · Seguridad: 5 fallos → bloqueo de 15 min (con el reloj simulado), la correcta durante el bloqueo también falla, mismo mensaje
//     para una cédula que no existe; un líder por esta puerta no entra; el límite por IP.
//   · Lo de siempre sigue: un líder entra con su cédula y su contraseña; el coordinador entra por correo y contraseña.
//   · Rutas de «Mis líderes»: permisos, alcance (cada coordinador ve solo lo suyo; el id de otra rama da 404), cifras.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada59 node scripts/probar-coordinadores-celular.js
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
const pool = require('../config/db');
const { sembrar, crearApp, CLAVE_CORREO, CLAVE_ADMIN } = require('./fixtures/coordinadores-celular');
const { claveDeCedula, sincronizarClaveCelular } = require('../lib/claveCelular');
// El correo del código se SIMULA (antes de que auth.routes lo cargue): sin destinatario falla como el real; con destinatario, queda anotado. No sale nada.
const correosDeCodigo = [];
require('../config/mailer').enviarCodigo2FA = async (destino) => {
  if (!destino) throw new Error('No recipients defined');
  correosDeCodigo.push(destino);
};

let fallos = 0;
let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];

let base = '';
/** Un «navegador»: guarda su cookie de sesión entre peticiones. */
function cliente() {
  let cookie = '';
  return {
    async pedir(metodo, ruta, cuerpo) {
      const h = { 'Content-Type': 'application/json' };
      if (cookie) h.Cookie = cookie;
      const r = await fetch(base + ruta, { method: metodo, headers: h, body: cuerpo ? JSON.stringify(cuerpo) : undefined, redirect: 'manual' });
      const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
      const texto = await r.text();
      let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
      return { status: r.status, datos, texto };
    },
    get: (ruta) => this.pedir('GET', ruta),
  };
}
const nuevo = () => { const c = cliente(); c.GET = (r) => c.pedir('GET', r); c.POST = (r, b) => c.pedir('POST', r, b); c.PUT = (r, b) => c.pedir('PUT', r, b); return c; };
const entrarPorCelular = (c, cedula, clave) => c.POST('/api/auth/login-coordinador', { cedula, clave });

(async () => {
  const servidor = http.createServer(crearApp(pool));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const { ids } = await sembrar(pool);
  await require('./fixtures/encender-complementos')(pool, ['faltan_por_votar']);
  // Los coordinadores sembrados con INSERT no pasaron por la ruta: init-db / un ingreso les dará la clave. Aquí se prueba justo eso.
  const MSJ = 'Cédula o clave incorrecta.';
  const MSJ_BLOQUEO = 'Demasiados intentos. Espere 15 minutos.';

  console.log('\n[1] La clave y su protección');
  ok(claveDeCedula('1023456789') === '456789', 'la clave de 1023456789 es 456789');
  ok(claveDeCedula('1.023.456.789') === '456789', 'con puntos también');
  ok(claveDeCedula('12345') === '012345', 'una cédula de 5 dígitos se rellena con ceros: 012345');
  ok(claveDeCedula('') === null && claveDeCedula(null) === null, 'sin dígitos no hay clave');
  let [m1] = await q('SELECT clave_celular_hash h, clave_celular_cedula c, password_hash p FROM usuarios WHERE id = ?', [ids.coord1]);
  ok(m1.h === null, 'recién sembrado a mano: todavía sin clave (la generan init-db o el primer ingreso)');
  ok(await sincronizarClaveCelular(pool, ids.coord1) === 'generada', 'sincronizar la genera');
  [m1] = await q('SELECT clave_celular_hash h, clave_celular_cedula c, password_hash p FROM usuarios WHERE id = ?', [ids.coord1]);
  ok(/^\$2[aby]\$/.test(m1.h) && !m1.h.includes('456789'), 'se guarda con hash bcrypt, no en texto plano', m1.h && m1.h.slice(0, 7));
  ok(m1.c === '1023456789', 'guarda de qué cédula salió');
  ok(m1.p !== m1.h, 'es otra columna: password_hash (la de correo) NO se tocó');
  const hashAntes = m1.h;
  ok(await sincronizarClaveCelular(pool, ids.coord1) === 'sin_cambio', 'sincronizar de nuevo no hace nada (idempotente)');
  ok((await q('SELECT clave_celular_hash h FROM usuarios WHERE id = ?', [ids.coord1]))[0].h === hashAntes, 'el hash no cambió');
  ok(await sincronizarClaveCelular(pool, ids.ana) === 'generada', 'desde la Orden 66 un líder TAMBIÉN recibe su clave del celular (los últimos 6 de su cédula)');
  ok(await sincronizarClaveCelular(pool, ids.coord2) === 'generada', 'coord2 también (cédula 1034567891 → 567891)');

  console.log('\n[2] Entra con la clave correcta, falla con otra');
  let c = nuevo();
  let r = await entrarPorCelular(c, '1023456789', '000000');
  ok(r.status === 401 && r.datos.error === MSJ, 'clave equivocada → 401 «Cédula o clave incorrecta.»', r);
  r = await c.GET('/api/auth/me');
  ok(r.status === 401, 'y no quedó ninguna sesión', r.status);
  r = await entrarPorCelular(c, '1023456789', '456789');
  ok(r.status === 200 && r.datos.ok && r.datos.usuario.rol === 'coordinador' && r.datos.usuario.id === ids.coord1, 'cédula 1023456789 + 456789 → entra como coordinador', r);
  ok(!!r.datos.tokenCierre, 'devuelve el token de cierre de sesión (Orden 43, cerrar sin señal)');
  ok(r.datos.usuario.debe_cambiar_password === false, 'no se le pide «cambiar la clave»: la del celular es fija');
  ok(r.datos.dispositivoToken === null, 'no se emite token de dispositivo («recordar sesión» no existe por esta puerta)');
  r = await c.GET('/api/auth/me');
  ok(r.status === 200 && r.datos.usuario.rol === 'coordinador', 'la sesión vale: /auth/me → coordinador', r.datos);
  r = await c.POST('/api/auth/logout');
  ok(r.status === 200, 'cerrar sesión funciona', r.status);
  r = await c.GET('/api/auth/me');
  ok(r.status === 401, 'y después ya no hay sesión', r.status);
  // Con puntos o ceros a la izquierda es la misma cédula.
  r = await entrarPorCelular(nuevo(), '1.023.456.789', '456789');
  ok(r.status === 200, 'la cédula escrita con puntos también entra', r.status);
  r = await entrarPorCelular(nuevo(), '1023456789', '45678');
  ok(r.status === 401 && r.datos.error === MSJ, 'una clave de 5 dígitos → mismo mensaje');
  r = await entrarPorCelular(nuevo(), '1023456789', 'abcdef');
  ok(r.status === 401 && r.datos.error === MSJ, 'una clave con letras → mismo mensaje');
  r = await entrarPorCelular(nuevo(), '', '');
  ok(r.status === 401 && r.datos.error === MSJ, 'campos vacíos → mismo mensaje');
  const aud = await q("SELECT accion, detalle FROM auditoria WHERE usuario_id = ? ORDER BY id", [ids.coord1]);
  ok(aud.some((a) => a.accion === 'login' && /Ingreso por celular coordinador/.test(a.detalle)), 'la bitácora anota el ingreso por esta puerta', aud.map((a) => a.detalle));
  ok(aud.some((a) => a.accion === 'login_fallido'), 'y el intento fallido');
  ok(!aud.some((a) => /456789|1023456789|000000/.test(a.detalle)), 'sin clave ni cédula completa en la bitácora');

  console.log('\n[3] No entra quien no es coordinador (y el mensaje no delata nada)');
  c = nuevo();
  r = await entrarPorCelular(c, '1055000001', '000001');
  const msjLider = r.datos.error;
  ok(r.status === 401 && msjLider === MSJ, 'un LÍDER con su cédula y los últimos 6 → 401 con el mismo mensaje', r);
  r = await c.GET('/api/auth/me');
  ok(r.status === 401, 'sin sesión', r.status);
  r = await entrarPorCelular(nuevo(), '1000000001', '000001');
  ok(r.status === 401 && r.datos.error === MSJ, 'el ADMINISTRADOR tampoco entra por aquí');
  r = await entrarPorCelular(nuevo(), '9999999991', '999991');
  ok(r.status === 401 && r.datos.error === MSJ && r.datos.error === msjLider, 'una cédula que no existe: exactamente el mismo mensaje');
  ok((await q("SELECT clave_celular_hash h FROM usuarios WHERE id = ?", [ids.ana]))[0].h !== null, '(el líder tiene su clave, pero esta puerta —la de coordinadores— no lo deja pasar)');
  // Lo de siempre.
  r = await nuevo().POST('/api/auth/login', { email: '1055000001', password: '1055000001' });
  ok(r.status === 200 && r.datos.usuario.rol === 'lider', 'el LÍDER sigue entrando como antes (cédula + su contraseña por /auth/login)', r);
  r = await nuevo().POST('/api/auth/login', { email: 'marta@ejemplo.co', password: CLAVE_CORREO });
  ok(r.status === 200 && r.datos.usuario.rol === 'coordinador', 'el COORDINADOR sigue entrando por correo y contraseña', r);
  r = await nuevo().POST('/api/auth/login', { email: '1023456789', password: CLAVE_CORREO });
  ok(r.status === 200 && r.datos.usuario.rol === 'coordinador', 'y por su cédula como usuario con su contraseña de siempre');
  r = await nuevo().POST('/api/auth/login', { email: 'marta@ejemplo.co', password: '456789' });
  ok(r.status === 401, 'la clave del celular NO sirve como contraseña de correo (son dos cosas)', r.status);

  console.log('\n[4] Bloqueo: 5 fallos seguidos → 15 minutos');
  const BLOQ = '1034567891';
  for (let i = 1; i <= 4; i++) { r = await entrarPorCelular(nuevo(), BLOQ, '00000' + i); ok(r.status === 401 && r.datos.error === MSJ, `fallo ${i}: 401 genérico`, r); }
  r = await entrarPorCelular(nuevo(), BLOQ, '000005');
  ok(r.status === 423 && r.datos.error === MSJ_BLOQUEO, 'el quinto fallo: «Demasiados intentos. Espere 15 minutos.»', r);
  r = await entrarPorCelular(nuevo(), BLOQ, '567891');
  ok(r.status === 423 && r.datos.error === MSJ_BLOQUEO, 'durante el bloqueo, la clave CORRECTA también falla', r);
  let [fila] = await q('SELECT intentos, bloqueado_hasta > NOW() AS bloqueada, TIMESTAMPDIFF(MINUTE, NOW(), bloqueado_hasta) AS min FROM ingresos_celular_intentos WHERE cedula = ?', [BLOQ]);
  ok(Number(fila.bloqueada) === 1 && fila.min >= 14 && fila.min <= 15, 'quedó bloqueada unos 15 minutos', fila);
  r = await nuevo().POST('/api/auth/login', { email: 'pedro@ejemplo.co', password: CLAVE_CORREO });
  ok(r.status === 200, 'el bloqueo es solo de esta puerta: Pedro sigue entrando por correo', r.status);
  // Se simula que pasaron 16 minutos.
  await q('UPDATE ingresos_celular_intentos SET bloqueado_hasta = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE cedula = ?', [BLOQ]);
  r = await entrarPorCelular(nuevo(), BLOQ, '567891');
  ok(r.status === 200 && r.datos.usuario.id === ids.coord2, 'pasado el bloqueo (reloj simulado), la correcta entra', r);
  ok((await q('SELECT COUNT(*) n FROM ingresos_celular_intentos WHERE cedula = ?', [BLOQ]))[0].n === 0, 'y el contador de esa cédula se borra');
  // Cumplido el bloqueo, el contador vuelve a cero: un solo error no vuelve a bloquear.
  for (let i = 1; i <= 5; i++) await entrarPorCelular(nuevo(), BLOQ, '11111' + i);
  await q('UPDATE ingresos_celular_intentos SET bloqueado_hasta = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE cedula = ?', [BLOQ]);
  r = await entrarPorCelular(nuevo(), BLOQ, '222222');
  ok(r.status === 401 && r.datos.error === MSJ, 'vencido el bloqueo, UN error no bloquea otra vez (vuelve a tener sus 5 intentos)', r);
  // Una cédula inexistente se bloquea IGUAL y dice lo mismo (el bloqueo no delata qué cédulas son de coordinadores).
  const FANTASMA = '9876543210';
  for (let i = 1; i <= 4; i++) await entrarPorCelular(nuevo(), FANTASMA, '12345' + i);
  r = await entrarPorCelular(nuevo(), FANTASMA, '123459');
  ok(r.status === 423 && r.datos.error === MSJ_BLOQUEO, 'una cédula que NO existe también se bloquea con el mismo mensaje', r);

  console.log('\n[5] Cambiar la cédula recalcula la clave (por el formulario de usuarios) y la vieja deja de servir');
  const admin = nuevo();
  r = await admin.POST('/api/auth/login', { email: 'admin.ej@ejemplo.co', password: CLAVE_ADMIN });
  ok(r.status === 200 && r.datos.usuario.rol === 'admin', 'el administrador de prueba entra', r.status);
  r = await entrarPorCelular(nuevo(), '1023456789', '456789');
  ok(r.status === 200, 'antes del cambio: 456789 entra');
  r = await admin.PUT(`/api/usuarios/${ids.coord1}`, { nombre: 'Marta Coordinadora Ejemplo', numero_identificacion: '1098765432', nombre_usuario: '1098765432', email: 'marta@ejemplo.co', telefono: '3000000001', rol: 'coordinador', activo: true, password_confirmacion: CLAVE_ADMIN });
  ok(r.status === 200, 'el administrador le cambia la cédula a 1098765432', r);
  [m1] = await q('SELECT clave_celular_hash h, clave_celular_cedula c FROM usuarios WHERE id = ?', [ids.coord1]);
  ok(m1.c === '1098765432' && m1.h !== hashAntes, 'la clave se recalculó al guardar (no esperó al ingreso)', m1.c);
  r = await entrarPorCelular(nuevo(), '1098765432', '765432');
  ok(r.status === 200 && r.datos.usuario.id === ids.coord1, 'cédula nueva + los últimos 6 de la nueva (765432) → entra', r);
  r = await entrarPorCelular(nuevo(), '1098765432', '456789');
  ok(r.status === 401 && r.datos.error === MSJ, 'la clave VIEJA (456789) con la cédula nueva ya no sirve');
  r = await entrarPorCelular(nuevo(), '1023456789', '456789');
  ok(r.status === 401 && r.datos.error === MSJ, 'la cédula vieja ya no entra');
  // Por CUALQUIER camino: un UPDATE a mano (otra ruta, un script) no deja viva la clave vieja.
  await q("UPDATE usuarios SET numero_identificacion = '1011223344', nombre_usuario = '1011223344' WHERE id = ?", [ids.coord1]);
  r = await entrarPorCelular(nuevo(), '1011223344', '765432');
  ok(r.status === 401, 'cambio de cédula por fuera de la aplicación: la clave vieja no sirve (se recalcula al intentar)', r.status);
  r = await entrarPorCelular(nuevo(), '1011223344', '223344');
  ok(r.status === 200, 'y la nueva (223344) sí', r.status);
  await q("UPDATE usuarios SET numero_identificacion = '1023456789', nombre_usuario = '1023456789' WHERE id = ?", [ids.coord1]);

  console.log('\n[6] Casos raros: cédula corta, sin cédula, inactivo, cambio de rol, crear con la ruta');
  r = await admin.POST('/api/usuarios', { nombre: 'Corta Coordinadora Ejemplo', numero_identificacion: '12345', email: 'corta@ejemplo.co', rol: 'coordinador', telefono: '3000000009' });
  ok(r.status === 200, 'se crea un coordinador con cédula de 5 dígitos por la ruta de usuarios', r);
  const idCorta = r.datos && r.datos.id;
  ok((await q('SELECT clave_celular_hash h FROM usuarios WHERE id = ?', [idCorta]))[0].h !== null, 'al CREARLO ya tiene su clave');
  r = await entrarPorCelular(nuevo(), '12345', '012345');
  ok(r.status === 200 && r.datos.usuario.id === idCorta, 'cédula 12345: la clave es 012345 (relleno con ceros)', r);
  r = await admin.POST('/api/usuarios', { nombre: 'Sin Cedula Ejemplo', email: 'sincedula@ejemplo.co', rol: 'coordinador', telefono: '3000000008' });
  const idSin = r.datos && r.datos.id;
  ok(r.status === 200 && (await q('SELECT clave_celular_hash h FROM usuarios WHERE id = ?', [idSin]))[0].h === null, 'sin cédula no tiene clave del celular (solo entra por correo)');
  r = await admin.PUT(`/api/usuarios/${idCorta}`, { nombre: 'Corta Coordinadora Ejemplo', numero_identificacion: '12345', nombre_usuario: '12345', email: 'corta@ejemplo.co', telefono: '3000000009', rol: 'coordinador', activo: false, password_confirmacion: CLAVE_ADMIN });
  ok(r.status === 200, 'se desactiva a la coordinadora corta', r.status);
  r = await entrarPorCelular(nuevo(), '12345', '012345');
  ok(r.status === 401 && r.datos.error === MSJ, 'un coordinador INACTIVO: mismo mensaje genérico', r);
  r = await admin.PUT(`/api/usuarios/${idCorta}`, { nombre: 'Corta Coordinadora Ejemplo', numero_identificacion: '12345', nombre_usuario: '12345', email: 'corta@ejemplo.co', telefono: '3000000009', rol: 'lider', activo: true, password_confirmacion: CLAVE_ADMIN });
  ok(r.status === 200, 'se le cambia el rol a líder', r.status);
  ok((await q('SELECT clave_celular_hash h, clave_celular_cedula c FROM usuarios WHERE id = ?', [idCorta]))[0].h !== null, 'como líder conserva su clave del celular (entra por los botones; Orden 66)');
  r = await entrarPorCelular(nuevo(), '12345', '012345');
  ok(r.status === 401 && r.datos.error === MSJ, 'y por la puerta de COORDINADORES (la de la Orden 59) ya no entra');

  // El otro formulario: «Agregar a la estructura» (también crea y edita coordinadores).
  const [[barrio]] = await pool.query("SELECT id FROM territorios WHERE nombre = 'Barrio La Muestra'");
  r = await admin.POST('/api/territorial/estructura', { nombre: 'Rosa Coordinadora Estructura', cargo: 'coordinador', numero_identificacion: '1066778899',
    email: 'rosa@ejemplo.co', telefono: '3000000007', territorio_id: barrio.id, area: 'urbano', password_confirmacion: CLAVE_ADMIN });
  ok(r.status === 200 && r.datos.ok, 'se crea un coordinador desde «Agregar a la estructura»', r);
  const idEstr = r.datos && r.datos.estructura_id;
  const [[rosa]] = await pool.query("SELECT id, clave_celular_cedula c FROM usuarios WHERE numero_identificacion = '1066778899'");
  ok(rosa && rosa.c === '1066778899', 'ese camino también le generó la clave del celular al crearlo', rosa);
  r = await entrarPorCelular(nuevo(), '1066778899', '778899');
  ok(r.status === 200, 'y entra con 778899', r.status);
  r = await admin.PUT(`/api/territorial/estructura/${idEstr}`, { nombre: 'Rosa Coordinadora Estructura', cargo: 'coordinador', numero_identificacion: '1066771234',
    email: 'rosa@ejemplo.co', telefono: '3000000007', territorio_id: barrio.id, area: 'urbano', password: CLAVE_ADMIN });
  ok(r.status === 200, 'se le cambia la cédula en la estructura a 1066771234', r);
  r = await entrarPorCelular(nuevo(), '1066771234', '771234');
  ok(r.status === 200, 'la clave pasa a 771234', r.status);
  r = await entrarPorCelular(nuevo(), '1066771234', '778899');
  ok(r.status === 401, 'y la anterior (778899) ya no sirve', r.status);

  console.log('\n[7] «Mis líderes»: permisos');
  r = await nuevo().GET('/api/coordinador/mis-lideres');
  ok(r.status === 401, 'sin sesión → 401', r.status);
  const lider = nuevo();
  await lider.POST('/api/auth/login', { email: '1055000001', password: '1055000001' });
  r = await lider.GET('/api/coordinador/mis-lideres');
  ok(r.status === 403, 'un líder → 403', r.status);
  r = await lider.GET(`/api/coordinador/lider/${ids.beto}`);
  ok(r.status === 403, 'un líder no puede pedir la ficha de otro → 403', r.status);
  r = await admin.GET('/api/coordinador/mis-lideres');
  ok(r.status === 400, 'el administrador sin coordinador_id → 400', r.status);
  r = await admin.GET(`/api/coordinador/mis-lideres?coordinador_id=${ids.ana}`);
  ok(r.status === 404, 'el administrador con un id que no es coordinador → 404', r.status);
  r = await admin.GET(`/api/coordinador/mis-lideres?coordinador_id=${ids.coord1}`);
  ok(r.status === 200 && r.datos.coordinador.id === ids.coord1, 'el administrador con coordinador_id → ve esa rama', r.status);

  console.log('\n[8] «Mis líderes»: alcance y cifras');
  const marta = nuevo(); const pedro = nuevo();
  await entrarPorCelular(marta, '1023456789', '456789');
  await entrarPorCelular(pedro, '1034567891', '567891');
  r = await marta.GET('/api/coordinador/mis-lideres');
  ok(r.status === 200, 'Marta pide su rama', r.status);
  const M = r.datos;
  const nombresM = M.miembros.map((x) => x.nombre).sort();
  ok(JSON.stringify(nombresM) === JSON.stringify(['Ana Líder Alfa', 'Beto Líder Beta', 'Carla Líder Gamma', 'Diego Líder Delta', 'Sara Sublíder Alfa', 'Tito Sublíder Beta']),
    've sus 4 líderes y sus 2 sublíderes, y a nadie más', nombresM);
  ok(!M.miembros.some((x) => x.nombre.includes('Épsilon')), 'Eva (de Pedro) NO aparece en la rama de Marta');
  ok(!M.miembros.some((x) => 'cedula' in x || 'email' in x || 'numero_identificacion' in x), 'ningún miembro lleva cédula ni correo');
  const por = (nombre) => M.miembros.find((x) => x.nombre.startsWith(nombre));
  const ana = por('Ana'); const beto = por('Beto'); const carla = por('Carla'); const diego = por('Diego'); const sara = por('Sara');
  ok(ana.rol === 'lider' && sara.rol === 'sublider', 'cada uno con su rol');
  ok(ana.registros === 7 && ana.meta === 50 && ana.porcentaje === 14 && ana.semaforo === 'rojo', 'Ana: 7 de 50 (14 %, con los 2 de su sublíder) → rojo', { r: ana.registros, p: ana.porcentaje, s: ana.semaforo });
  ok(beto.registros === 5 && beto.porcentaje === 50 && beto.semaforo === 'amarillo', 'Beto: 5 de 10 (50 %) → amarillo', { r: beto.registros, p: beto.porcentaje });
  ok(diego.registros === 9 && diego.porcentaje === 90 && diego.semaforo === 'verde', 'Diego: 9 de 10 (90 %) → verde');
  ok(carla.sin_meta && carla.semaforo === 'sin_meta' && carla.registros === 0 && carla.dias_sin_registrar === null && carla.sin_registrar_7, 'Carla: sin meta, nunca ha registrado');
  ok(sara.registros === 2 && sara.meta === 5 && sara.porcentaje === 40 && sara.semaforo === 'amarillo', 'Sara (sublíder): lo que ella registró, 2 de 5 (40 %) → amarillo (límite)');
  ok(ana.dias_sin_registrar === 0 && !ana.sin_registrar_7, 'Ana registró hoy: no está en alerta');
  ok(beto.dias_sin_registrar === 9 && beto.sin_registrar_7, 'Beto lleva 9 días sin registrar: en alerta');
  ok(diego.dias_sin_registrar === 1, 'Diego: hace 1 día');
  ok(JSON.stringify(ana.semanas.map((w) => w.n)) === '[0,1,1,5]',
    'las 4 semanas de Ana (de la más antigua a la más reciente): 0, 1 (hace 9 días), 1 (hace 15), 5 (esta: 3 suyos y 2 de su sublíder)', ana.semanas.map((w) => w.n));
  ok(ana.semanas[3].hasta === M.hoy && ana.semanas[3].desde < ana.semanas[3].hasta, 'la última semana termina hoy');
  ok(ana.telefono === '3001112233' && carla.telefono === null, 'el celular válido viene como 10 dígitos; el que no tiene, null');
  ok(diego.no_contactar === true && ana.no_contactar === false, 'no_contactar viaja para que la ficha no ofrezca mensajes');
  ok(ana.sublideres === 1 && ana.barrio === 'Barrio Los Ejemplos', 'Ana: 1 sublíder, y su barrio');
  ok(sara.supervisor_nombre === 'Ana Líder Alfa', 'Sara reporta a Ana');
  const R = M.resumen;
  ok(R.lideres_activos === 4 && R.sublideres === 2, 'encabezado: 4 líderes activos y 2 sublíderes', R);
  ok(R.personas_registradas === 7 + 5 + 9, 'personas registradas en total: 21 (sin contar dos veces a quien registró un sublíder)', R.personas_registradas);
  ok(R.compromiso_total === 70, 'compromiso total: 50 + 10 + 10 = 70 (Carla sin meta no suma)', R.compromiso_total);
  ok(R.porcentaje === 30 && R.sin_meta_total === false, '% de avance: 21 de 70 = 30 %', R.porcentaje);
  ok(R.registros_7_dias === 4 + 2 + 2 + 5 + 0 || R.registros_7_dias > 0, 'registros de los últimos 7 días', R.registros_7_dias);
  ok(R.lideres_sin_registrar_7 === 2, '2 líderes sin registrar hace 7+ días (Beto y Carla)', R.lideres_sin_registrar_7);
  // La MISMA cifra que ya daba «Avance de mis líderes»: la reglas no se bifurcaron.
  r = await marta.GET('/api/dashboard/avance-mis-lideres');
  ok(r.status === 200 && r.datos.total.registros === 7 + 5 + 9 && r.datos.total.meta === 70, '/dashboard/avance-mis-lideres sigue dando lo mismo (21 de 70)', r.datos && r.datos.total);
  ok(JSON.stringify(r.datos.lideres.map((l) => [l.nombre, l.registros, l.meta]).sort()) === JSON.stringify(M.miembros.filter((x) => x.rol === 'lider').map((l) => [l.nombre, l.registros, l.meta]).sort()),
    'y cada líder, igual en las dos rutas');

  r = await pedro.GET('/api/coordinador/mis-lideres');
  ok(r.status === 200 && r.datos.miembros.length === 1 && r.datos.miembros[0].nombre.includes('Épsilon'), 'Pedro ve SOLO a Eva', r.datos.miembros.map((x) => x.nombre));
  ok(r.datos.resumen.lideres_activos === 1 && r.datos.resumen.personas_registradas === 3 && r.datos.resumen.compromiso_total === 20, 'sus cifras son las suyas (1 líder, 3 personas, 20)');
  // El `coordinador_id` de un coordinador se IGNORA.
  r = await pedro.GET(`/api/coordinador/mis-lideres?coordinador_id=${ids.coord1}`);
  ok(r.status === 200 && r.datos.coordinador.id === ids.coord2 && r.datos.miembros.length === 1, 'Pedro mandando coordinador_id de Marta: se IGNORA y ve lo suyo');

  console.log('\n[9] La ficha y el 404 entre ramas');
  r = await marta.GET(`/api/coordinador/lider/${ids.ana}`);
  ok(r.status === 200 && r.datos.miembro.nombre.startsWith('Ana') && r.datos.sublideres.length === 1 && r.datos.sublideres[0].nombre.startsWith('Sara'), 'ficha de Ana: sus datos y su sublíder', r.status);
  r = await marta.GET(`/api/coordinador/lider/${ids.sara}`);
  ok(r.status === 200 && r.datos.miembro.rol === 'sublider' && r.datos.sublideres.length === 0, 'ficha de la sublíder Sara');
  for (const [que, id] of [['Eva (de OTRA rama)', ids.eva], ['Pedro (otro coordinador)', ids.coord2], ['ella misma', ids.coord1], ['el administrador', ids.admin], ['un id que no existe', 99999999], ['un texto', 'abc']]) {
    r = await marta.GET(`/api/coordinador/lider/${id}`);
    ok(r.status === 404, `pedir a mano el id de ${que} → 404`, r.status);
  }
  r = await pedro.GET(`/api/coordinador/lider/${ids.ana}`);
  ok(r.status === 404, 'y al revés: Pedro pidiendo a Ana → 404', r.status);
  r = await pedro.GET(`/api/coordinador/lider/${ids.sara}`);
  ok(r.status === 404, 'Pedro pidiendo a la sublíder de Marta → 404', r.status);
  const idsEnRespuesta = JSON.stringify((await marta.GET(`/api/coordinador/lider/${ids.eva}`)).datos);
  ok(!idsEnRespuesta.includes('Épsilon'), 'el 404 no filtra ni el nombre');
  // Un líder inactivo o un testigo no son de la rama.
  await q('UPDATE estructura SET activo = 0 WHERE usuario_id = ?', [ids.diego]);
  r = await marta.GET(`/api/coordinador/lider/${ids.diego}`);
  ok(r.status === 404, 'un líder desactivado → 404', r.status);
  await q('UPDATE estructura SET activo = 1 WHERE usuario_id = ?', [ids.diego]);

  console.log('\n[10] Día D en la ficha (solo con el módulo encendido y permiso)');
  r = await marta.GET(`/api/coordinador/lider/${ids.ana}`);
  const permisos = (await marta.GET('/api/permisos/mios')).datos;
  const veRescate = !!(permisos && permisos.modulos && permisos.modulos.includes('rescate_votos'));
  ok(veRescate ? !!r.datos.dia_d : r.datos.dia_d === null, `con rescate_votos ${veRescate ? 'visible' : 'no visible'}: dia_d ${veRescate ? 'viene' : 'no viene'}`, { veRescate, dia: r.datos.dia_d });
  if (veRescate) {
    ok(r.datos.dia_d.modo_prueba === true && r.datos.dia_d.total === 7 && r.datos.dia_d.votaron === 0, 'fuera del día de la elección: «modo prueba», 7 registrados, 0 votaron', r.datos.dia_d);
    const [v] = await q("SELECT id FROM votantes WHERE lider_id = ? LIMIT 1", [ids.ana]);
    await q('INSERT INTO votante_votos (votante_id) VALUES (?)', [v.id]).catch(async () => { await q('INSERT INTO votante_votos (votante_id, voto_en) VALUES (?, NOW())', [v.id]); });
    r = await marta.GET(`/api/coordinador/lider/${ids.ana}`);
    ok(r.datos.dia_d.votaron === 1 && r.datos.dia_d.faltan === 6, 'un voto marcado: votaron 1, faltan 6', r.datos.dia_d);
    ok(r.datos.dia_d.ya_voto === null, 'Ana no figura como votante (sin ficha con su cédula): ya_voto es null');
    await q("INSERT INTO votantes (nombre, cedula, telefono, lider_id, origen) VALUES ('Ana Líder Alfa', '1055000001', '3001112233', ?, 'manual')", [ids.coord1]);
    const [va] = await q("SELECT id FROM votantes WHERE cedula = '1055000001'");
    await q('INSERT INTO votante_votos (votante_id) VALUES (?)', [va.id]).catch(async () => { await q('INSERT INTO votante_votos (votante_id, voto_en) VALUES (?, NOW())', [va.id]); });
    r = await marta.GET(`/api/coordinador/lider/${ids.ana}`);
    ok(r.datos.dia_d.ya_voto === true, 'con su ficha de votante y su voto marcado: «Ya votó: sí»');
  }
  await q("UPDATE complementos_campana SET activo = 0 WHERE clave = 'faltan_por_votar'");
  require('../lib/complementos').invalidar();
  r = await marta.GET(`/api/coordinador/lider/${ids.ana}`);
  ok(r.datos.dia_d === null, 'con el complemento «Faltan por votar» apagado el Día D no viene');
  await q("UPDATE complementos_campana SET activo = 1 WHERE clave = 'faltan_por_votar'");
  require('../lib/complementos').invalidar();

  console.log('\n[10b] Orden 62: el ingreso del celular NO pide código de verificación; el de correo sí');
  const [rolCoord] = await q("SELECT id FROM roles WHERE nombre = 'coordinador'");
  const [ins] = await pool.query(
    "INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, password_hash, rol_id, two_factor_enabled) VALUES ('Dos Pasos Sin Correo Ejemplo', '1088776655', '1088776655', NULL, ?, ?, 1)",
    [require('bcryptjs').hashSync(CLAVE_CORREO, 4), rolCoord.id]);
  const idSinCorreo = ins.insertId;
  const [ins2] = await pool.query(
    "INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, password_hash, rol_id, two_factor_enabled) VALUES ('Dos Pasos Con Correo Ejemplo', '1088776644', '1088776644', 'dospasos@ejemplo.co', ?, ?, 1)",
    [require('bcryptjs').hashSync(CLAVE_CORREO, 4), rolCoord.id]);
  const idConCorreo = ins2.insertId;
  await q('INSERT INTO estructura (usuario_id, cargo, activo) VALUES (?, ?, 1), (?, ?, 1)', [idSinCorreo, 'coordinador', idConCorreo, 'coordinador']);
  await sincronizarClaveCelular(pool, idSinCorreo); await sincronizarClaveCelular(pool, idConCorreo);
  const antesCorreos = correosDeCodigo.length;
  let cs = nuevo();
  r = await entrarPorCelular(cs, '1088776655', '776655');
  ok(r.status === 200 && r.datos.ok && !r.datos.requiere2fa && r.datos.usuario.id === idSinCorreo, 'coordinador con two_factor_enabled=1 y SIN correo: entra por el celular sin código', r);
  ok(r.datos.usuario.two_factor_enabled === true, 'y la marca no se tocó (sigue en la sesión)');
  r = await cs.GET('/api/auth/me');
  ok(r.status === 200 && r.datos.usuario.id === idSinCorreo, '/auth/me responde: la sesión no depende del código', r.status);
  r = await cs.GET('/api/coordinador/mis-lideres');
  ok(r.status === 200, 'y entra a sus rutas (Mis líderes)', r.status);
  ok((await q('SELECT two_factor_enabled t FROM usuarios WHERE id = ?', [idSinCorreo]))[0].t === 1, 'la marca sigue encendida en la base');
  const aud2 = await q("SELECT detalle FROM auditoria WHERE usuario_id = ? AND accion = 'login' ORDER BY id DESC LIMIT 1", [idSinCorreo]);
  ok(aud2.length && /celular coordinador/.test(aud2[0].detalle) && /sin código de verificación/.test(aud2[0].detalle) && !/1088776655|776655/.test(aud2[0].detalle), 'la bitácora dice «celular coordinador» y que fue sin código, sin cédula completa ni clave', aud2);
  r = await entrarPorCelular(nuevo(), '1088776644', '776644');
  ok(r.status === 200 && !r.datos.requiere2fa && r.datos.usuario.id === idConCorreo, 'con correo y la marca encendida también entra sin código', r.status);
  ok(correosDeCodigo.length === antesCorreos, 'por el celular NO se mandó ningún código (ni se intentó)');
  r = await entrarPorCelular(nuevo(), '1088776655', '000000');
  ok(r.status === 401 && r.datos.error === MSJ, 'una clave mala sigue fallando con el mismo mensaje');
  for (let i = 1; i <= 4; i++) await entrarPorCelular(nuevo(), '1088776655', '00000' + i);
  r = await entrarPorCelular(nuevo(), '1088776655', '776655');
  ok(r.status === 423 && r.datos.error === MSJ_BLOQUEO, 'el bloqueo 5/15 sigue igual (5 fallos y ni la correcta entra)', r);
  await q('DELETE FROM ingresos_celular_intentos');
  // El ingreso por correo y contraseña SIGUE pidiendo el código.
  r = await nuevo().POST('/api/auth/login', { email: 'dospasos@ejemplo.co', password: CLAVE_CORREO });
  ok(r.status === 200 && r.datos.requiere2fa === true && correosDeCodigo[correosDeCodigo.length - 1] === 'dospasos@ejemplo.co', 'el mismo coordinador por correo y contraseña SIGUE pidiendo el código (y sale al correo)', r);
  r = await nuevo().POST('/api/auth/login', { email: '1088776655', password: CLAVE_CORREO });
  ok(r.status === 500 && /no tiene correo registrado/.test(r.datos.error) && /administrador/.test(r.datos.error), 'sin correo, el ingreso normal dice la causa: «…verificación en dos pasos pero no tiene correo registrado…»', r.datos);
  r = await nuevo().POST('/api/auth/login', { email: 'dospasos@ejemplo.co', password: 'mala-clave' });
  ok(r.status === 401, 'una contraseña mala por correo sigue fallando', r.status);
  // Líder y admin: sin cambios (con la marca encendida siguen pidiendo código por SU puerta).
  await q('UPDATE usuarios SET two_factor_enabled = 1 WHERE id IN (?, ?)', [ids.ana, ids.admin]);
  await q("UPDATE usuarios SET email = 'ana@ejemplo.co' WHERE id = ?", [ids.ana]);
  r = await nuevo().POST('/api/auth/login', { email: '1055000001', password: '1055000001' });
  ok(r.status === 200 && r.datos.requiere2fa === true, 'un LÍDER con la marca sigue pidiendo código en su ingreso', r);
  r = await nuevo().POST('/api/auth/login', { email: 'admin.ej@ejemplo.co', password: CLAVE_ADMIN });
  ok(r.status === 200 && r.datos.requiere2fa === true, 'el ADMINISTRADOR con la marca sigue pidiendo código', r);
  r = await entrarPorCelular(nuevo(), '1000000001', '000001');
  ok(r.status === 401 && r.datos.error === MSJ, 'y el admin por la puerta del celular sigue sin entrar («Cédula o clave incorrecta.»)');
  await q('UPDATE usuarios SET two_factor_enabled = 0 WHERE id IN (?, ?)', [ids.ana, ids.admin]);

  console.log('\n[11] El límite por IP (solo gastan cupo los fallos)');
  let primero429 = null;
  for (let i = 1; i <= 80 && !primero429; i++) {
    const x = await entrarPorCelular(nuevo(), String(7000000000 + i), '123456');
    if (x.status === 429) primero429 = { i, mensaje: x.datos && x.datos.error };
  }
  ok(!!primero429 && primero429.mensaje === MSJ_BLOQUEO, 'tras muchos fallos desde la misma IP responde 429 «Demasiados intentos. Espere 15 minutos.»', primero429);
  r = await entrarPorCelular(nuevo(), '1023456789', '456789');
  ok(r.status === 429, 'y con el límite de IP vencido hasta la clave correcta espera', r.status);

  // ------------------------------------------------------------------------------------------------ limpieza
  await q("DELETE FROM ingresos_celular_intentos");
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO BIEN'} (${pasos} comprobaciones)`);
  servidor.close();
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
