#!/usr/bin/env node
// scripts/capturar-contrasena-6-digitos.js — capturas de la orden 90 (Chromium real).
//   1) Configuración → Usuarios → «Crear usuario» a 1280 px, con el texto de ayuda nuevo (y el rechazo de una contraseña que no son 6 números).
//   2) «Cambiar mi clave» en el celular (390×844): con 8 cifras la pantalla dice «La contraseña debe tener 6 números.»
// USO (base desechable con init-db; sin otra prueba con Chromium a la vez):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada90 [SALIDA=/ruta] node scripts/capturar-contrasena-6-digitos.js
require('dotenv').config();
if (!/^(simulada|prueba)/i.test(process.env.DB_NAME || '')) { console.error('Me niego: DB_NAME debe empezar por «simulada» o «prueba».'); process.exit(2); }
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http'); const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { sembrar, crearApp, CLAVE_ADMIN } = require('./fixtures/coordinadores-celular');
const { lanzar, espera } = require('./capturas/navegador');
const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden90');
fs.mkdirSync(SALIDA, { recursive: true });

(async () => {
  const { ids } = await sembrar(pool);
  const [[rol]] = await pool.query("SELECT id FROM roles WHERE nombre = 'candidato'");
  await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, clave_celular_pregunta_hecha)
    VALUES ('Juan Pérez', '1099000001', 'candidato.prueba', 'candidato.prueba@ejemplo.co', '3001230000', ?, ?, 1, 1)`, [bcrypt.hashSync('482915', 4), rol.id]);
  const servidor = http.createServer(crearApp(pool));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const nav = await lanzar();
  const p = await nav.pagina('about:blank'); const { cmd, ev } = p;
  const foto = async (nombre) => { const r = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r.result.data, 'base64')); console.log('captura', nombre); };
  const ir = async (ruta, ms = 1500) => { await cmd('Page.navigate', { url: base + ruta }); await espera(ms); };
  const login = (email, password) => ev(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} }) }).then(r => r.status)`);

  // 1) Usuarios a 1280
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await ir('/login.html', 800);
  console.log('login admin', await login('admin.ej@ejemplo.co', CLAVE_ADMIN));
  await ir('/configuracion.html', 2000);
  await ev("document.getElementById('btn-tab-usuarios').click()"); await espera(1500);
  await ev('abrirCreacionUsuario()'); await espera(600);
  await ev(`(() => { const s = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    s('usuario-form-nombre', 'Luis Líder Ejemplo'); s('usuario-form-identificacion', '71185185'); s('usuario-form-email', 'luis@ejemplo.co'); s('usuario-form-telefono', '3011110090'); })()`);
  await espera(400);
  await ev("document.getElementById('usuario-form-password').scrollIntoView({ block: 'center' })"); await espera(300);
  await foto('1-usuarios-crear-1280');
  await ev("(() => { const e = document.getElementById('usuario-form-password'); e.removeAttribute('maxlength'); e.removeAttribute('pattern'); e.value = '1234567'; })()");
  await ev("document.querySelector('#form-usuario button[type=submit]').click()"); await espera(1200);
  await foto('2-usuarios-rechazo-1234567-1280');
  console.log('ayuda:', await ev("document.getElementById('nota-password-usuario').textContent"));

  // 2) Cambiar mi clave en el celular
  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: true });
  await cmd('Network.clearBrowserCookies');
  await ir('/login.html', 800);
  console.log('login candidato', await login('candidato.prueba@ejemplo.co', '482915'));
  await ir('/app/candidato-clave.html', 2500);
  await ev(`(() => { actual.value = '482915'; nueva.value = '12345678'; repetir.value = '12345678'; })()`);
  await ev("document.getElementById('form').requestSubmit()"); await espera(800);
  await foto('3-cambiar-mi-clave-390x844-con-8-cifras');
  await ev(`(() => { nueva.value = '908172'; repetir.value = '908172'; })()`);
  await ev("document.getElementById('form').requestSubmit()"); await espera(1500);
  await foto('4-cambiar-mi-clave-390x844-6-cifras-ok');
  nav.cerrar(); servidor.close(); await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
