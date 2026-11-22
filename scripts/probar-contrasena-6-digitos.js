#!/usr/bin/env node
// scripts/probar-contrasena-6-digitos.js
//
// Prueba de la orden 90 (servidor, sesión real): la contraseña de TODOS los usuarios es de exactamente 6 números; por omisión, los últimos 6 de la identificación.
//   · crear usuario sin contraseña con cédula 71185185 → su contraseña es 185185 y entra con ella (y sigue obligado a cambiarla)
//   · crear/editar con «12345», «abcdef», «1234567» → 400 «La contraseña debe tener 6 números.» (el servidor, no el navegador)
//   · cédula de menos de 6 dígitos (o ninguna) y sin contraseña → 400: la contraseña es obligatoria
//   · cambiar mi clave: 6 dígitos OK; 8 (o letras) → rechazo; recuperar por correo: igual
//   · un usuario viejo con contraseña de 8+ caracteres sigue entrando; coordinador por cédula + 6 dígitos sigue igual
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada90 node scripts/probar-contrasena-6-digitos.js
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
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { sembrar, crearApp, CLAVE_ADMIN } = require('./fixtures/coordinadores-celular');
const { claveDeCedula } = require('../lib/claveCelular');
const clave6 = require('../lib/contrasenaSeisDigitos');
// El correo se SIMULA: no sale nada.
require('../config/mailer').enviarCodigo2FA = async () => {};

let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];
const MSJ = 'La contraseña debe tener 6 números.';

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
const porCorreo = (email, password) => nuevo().POST('/api/auth/login', { email, password });

(async () => {
  const servidor = http.createServer(crearApp(pool));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const { ids } = await sembrar(pool);
  const sello = String(Date.now()).slice(-7);
  const admin = nuevo();
  let r = await admin.POST('/api/auth/login', { email: 'admin.ej@ejemplo.co', password: CLAVE_ADMIN });
  ok(r.status === 200, 'el administrador (contraseña larga de antes) sigue entrando', r);

  console.log('\n[1] Las reglas (lib)');
  ok(clave6.esContrasenaValida('185185') && clave6.esContrasenaValida('000123'), '6 dígitos valen');
  ok(!clave6.esContrasenaValida('12345') && !clave6.esContrasenaValida('abcdef') && !clave6.esContrasenaValida('1234567') && !clave6.esContrasenaValida('12 456') && !clave6.esContrasenaValida(''), '5 dígitos, letras, 7 dígitos, espacio y vacío no valen');
  ok(clave6.porDefectoDeIdentificacion('71185185') === '185185' && clave6.porDefectoDeIdentificacion('71.185.185') === '185185' && clave6.porDefectoDeIdentificacion('12345') === null && clave6.porDefectoDeIdentificacion('') === null,
    'por omisión: los últimos 6 dígitos; con menos de 6 o ninguno, null');

  console.log('\n[2] Crear usuario sin contraseña, con cédula 71185185');
  const cedula = '71185185';
  r = await admin.POST('/api/usuarios', { nombre: 'Luis Líder Seis Ejemplo', numero_identificacion: cedula, email: `luis${sello}@ejemplo.co`, rol: 'lider', telefono: '3011110090' });
  ok(r.status === 200 && r.datos.password_temporal === '185185' && r.datos.password_por_defecto === true, 'se crea y la contraseña por omisión es 185185', r);
  const luisId = r.datos && r.datos.id;
  const fila = (await q('SELECT password_hash h, debe_cambiar_password d FROM usuarios WHERE id = ?', [luisId]))[0];
  ok(bcrypt.compareSync('185185', fila.h) && !bcrypt.compareSync(cedula, fila.h), 'en la base está el hash de 185185 (no el de la cédula completa)');
  ok(Number(fila.d) === 1, 'sigue obligado a cambiarla al próximo ingreso (como hoy)');
  r = await porCorreo(`luis${sello}@ejemplo.co`, '185185');
  ok(r.status === 200 && r.datos.usuario && r.datos.usuario.debe_cambiar_password === true, 'entra por el computador con 185185 y se le pide cambiarla', r);
  r = await porCorreo(`luis${sello}@ejemplo.co`, cedula);
  ok(r.status === 401, 'con la cédula completa ya no entra');
  r = await nuevo().POST('/api/auth/login-celular', { cedula, clave: '185185' });
  ok(r.status === 200, 'y entra por el botón del celular con 185185 (la clave del celular es la misma por omisión)', r);

  console.log('\n[3] El servidor rechaza lo que no son 6 números');
  for (const mala of ['12345', 'abcdef', '1234567', '12345678', 'clave-larga-88']) {
    r = await admin.POST('/api/usuarios', { nombre: 'Malo Ejemplo', numero_identificacion: `72${sello}${mala.length}`, email: `malo${mala.length}${sello}@ejemplo.co`, rol: 'lider', password: mala });
    ok(r.status === 400 && r.datos.error === MSJ, `crear con «${mala}» → 400 «${MSJ}»`, r);
  }
  const creados = (await q('SELECT COUNT(*) n FROM usuarios WHERE email LIKE ?', [`malo%${sello}@ejemplo.co`]))[0].n;
  ok(Number(creados) === 0, 'y no se creó ningún usuario con esas contraseñas');
  r = await admin.POST('/api/usuarios', { nombre: 'Bien Ejemplo', numero_identificacion: `73${sello}`, email: `bien${sello}@ejemplo.co`, rol: 'lider', password: '482913' });
  ok(r.status === 200 && r.datos.password_temporal === null, 'con 6 números escritos sí se crea (y no se le muestra de vuelta)', r);
  r = await porCorreo(`bien${sello}@ejemplo.co`, '482913');
  ok(r.status === 200, 'y entra con ella', r);

  console.log('\n[4] Cédula corta o ausente: la contraseña es obligatoria');
  r = await admin.POST('/api/usuarios', { nombre: 'Corta Ejemplo', numero_identificacion: '12345', email: `corta${sello}@ejemplo.co`, rol: 'lider' });
  ok(r.status === 400 && /obligatoria|Escribe la contraseña/i.test(r.datos.error), 'cédula de 5 dígitos y sin contraseña → 400', r);
  r = await admin.POST('/api/usuarios', { nombre: 'Sin Cédula Ejemplo', email: `sinced${sello}@ejemplo.co`, rol: 'lider' });
  ok(r.status === 400 && /obligatoria|Escribe la contraseña/i.test(r.datos.error), 'sin cédula y sin contraseña → 400', r);
  r = await admin.POST('/api/usuarios', { nombre: 'Corta Con Clave Ejemplo', numero_identificacion: '12345', email: `cortac${sello}@ejemplo.co`, rol: 'lider', password: '482913' });
  ok(r.status === 200, 'cédula corta pero con contraseña de 6 números → se crea', r);

  console.log('\n[5] Editar: 6 números cambia; otra cosa se rechaza; en blanco no cambia');
  const bienId = (await q('SELECT id FROM usuarios WHERE email = ?', [`bien${sello}@ejemplo.co`]))[0].id;
  const cuerpoEd = (extra) => ({ nombre: 'Bien Ejemplo', numero_identificacion: `73${sello}`, email: `bien${sello}@ejemplo.co`, rol: 'lider', activo: true, password_confirmacion: CLAVE_ADMIN, ...extra });
  for (const mala of ['12345', 'abcdef', '1234567']) {
    r = await admin.PUT(`/api/usuarios/${bienId}`, cuerpoEd({ password: mala }));
    ok(r.status === 400 && r.datos.error === MSJ, `editar con «${mala}» → 400`, r);
  }
  r = await admin.PUT(`/api/usuarios/${bienId}`, cuerpoEd({ password: '' }));
  ok(r.status === 200, 'en blanco → 200', r);
  r = await porCorreo(`bien${sello}@ejemplo.co`, '482913');
  ok(r.status === 200, 'y la contraseña de antes sigue sirviendo', r);
  r = await admin.PUT(`/api/usuarios/${bienId}`, cuerpoEd({ password: '730516' }));
  ok(r.status === 200, 'con 6 números → 200', r);
  ok((await porCorreo(`bien${sello}@ejemplo.co`, '730516')).status === 200 && (await porCorreo(`bien${sello}@ejemplo.co`, '482913')).status === 401, 'la nueva entra y la anterior ya no');
  ok(Number((await q('SELECT debe_cambiar_password d FROM usuarios WHERE id = ?', [bienId]))[0].d) === 1, 'y queda obligado a cambiarla (como hoy)');

  console.log('\n[6] «Cambiar mi clave»');
  const luis = nuevo();
  await luis.POST('/api/auth/login', { email: `luis${sello}@ejemplo.co`, password: '185185' });
  for (const mala of ['12345678', 'abcdef', '1234567', '12345', 'una-contraseña-larga']) {
    r = await luis.POST('/api/auth/cambiar-password', { passwordActual: '185185', passwordNueva: mala });
    ok(r.status === 400 && r.datos.error === MSJ, `con «${mala}» → 400 «${MSJ}»`, r);
  }
  r = await luis.POST('/api/auth/cambiar-password', { passwordActual: '185185', passwordNueva: '123456' });
  ok(r.status === 400, '123456 sigue rechazada por fácil (regla de antes)');
  r = await luis.POST('/api/auth/cambiar-password', { passwordActual: '185185', passwordNueva: '908172' });
  ok(r.status === 200, 'con 6 dígitos → OK', r);
  ok((await porCorreo(`luis${sello}@ejemplo.co`, '908172')).status === 200 && (await porCorreo(`luis${sello}@ejemplo.co`, '185185')).status === 401, 'entra con la nueva, no con la vieja');

  console.log('\n[7] Recuperar por correo (enlace)');
  const token = crypto.randomBytes(16).toString('hex');
  await q('INSERT INTO password_resets (usuario_id, token_hash, expira_en) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))', [luisId, crypto.createHash('sha256').update(token).digest('hex')]);
  r = await nuevo().POST('/api/auth/resetear-password', { token, nuevaPassword: '12345678' });
  ok(r.status === 400 && r.datos.error === MSJ, '8 caracteres → 400', r);
  r = await nuevo().POST('/api/auth/resetear-password', { token, nuevaPassword: '615243' });
  ok(r.status === 200, '6 números → OK', r);
  ok((await porCorreo(`luis${sello}@ejemplo.co`, '615243')).status === 200, 'y entra con ella');

  console.log('\n[8] Restablecer clave (administrador)');
  r = await admin.POST(`/api/usuarios/${luisId}/restablecer-password`, { password_confirmacion: CLAVE_ADMIN });
  ok(r.status === 200 && r.datos.password_temporal === '185185' && r.datos.es_cedula === true, 'con cédula: la temporal son los últimos 6 dígitos', r);
  const corta = (await q('SELECT id FROM usuarios WHERE email = ?', [`cortac${sello}@ejemplo.co`]))[0].id;
  r = await admin.POST(`/api/usuarios/${corta}/restablecer-password`, { password_confirmacion: CLAVE_ADMIN });
  ok(r.status === 200 && /^\d{6}$/.test(r.datos.password_temporal) && r.datos.es_cedula === false, 'sin 6 dígitos de cédula: un código de 6 números', r);

  console.log('\n[9] Lo que ya existía no se toca');
  const viejoId = (await q(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, password_hash, rol_id) VALUES ('Viejo Ejemplo', ?, ?, ?, ?, (SELECT id FROM roles WHERE nombre='lider'))`,
    [`74${sello}`, `74${sello}`, `viejo${sello}@ejemplo.co`, bcrypt.hashSync('contrasena-de-ocho', 4)])).insertId;
  r = await porCorreo(`viejo${sello}@ejemplo.co`, 'contrasena-de-ocho');
  ok(r.status === 200 && viejoId > 0, 'usuario con contraseña de 8+ caracteres sigue entrando por el computador', r);
  const cm = nuevo();
  r = await cm.POST('/api/auth/login-celular', { cedula: '1023456789', clave: claveDeCedula('1023456789') });
  ok(r.status === 200 && r.datos.usuario.rol === 'coordinador', 'coordinador por cédula + 6 dígitos entra igual', r);
  r = await porCorreo('marta@ejemplo.co', 'clave-correo-ej');
  ok(r.status === 200, 'y la coordinadora con su contraseña larga de correo también', r);

  console.log(`\n${pasos - fallos}/${pasos} pasos bien, ${fallos} fallos.`);
  servidor.close(); await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('Error en la prueba:', e); process.exit(1); });
