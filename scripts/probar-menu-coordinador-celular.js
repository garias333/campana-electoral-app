#!/usr/bin/env node
// scripts/probar-menu-coordinador-celular.js
//
// Prueba de la orden 63 EN CHROMIUM REAL (CDP, 390×844): el menú del inicio del celular. El coordinador ya NO ve «Panel completo» ni el grupo
// «Registro»; el líder y el administrador ven EXACTAMENTE el mismo menú que antes (se compara el árbol de HEAD con el de ahora), los demás grupos del
// coordinador quedan iguales, las páginas quitadas del menú siguen abriendo si se escribe la dirección, y no hay errores de consola. Saca las capturas.
//
// USO (sobre una base desechable ya inicializada con init-db; sin otra prueba con Chromium a la vez):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada63 CARPETA_ANTES=/ruta/a/public-de-HEAD \
//   [SALIDA=/ruta/capturas] node scripts/probar-menu-coordinador-celular.js
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) {
  console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`);
  process.exit(2);
}
if (!process.env.CARPETA_ANTES) { console.error('Falta CARPETA_ANTES (el public/ de HEAD: git archive HEAD public | tar -x -C <carpeta>).'); process.exit(2); }
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const pool = require('../config/db');
const { sembrar, crearApp, CLAVE_ADMIN } = require('./fixtures/coordinadores-celular');
const { sincronizarClaveCelular } = require('../lib/claveCelular');
const { lanzar, espera } = require('./capturas/navegador');

const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden63');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); }
}
async function escuchar(app) {
  const s = http.createServer(app);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { s, base: `http://127.0.0.1:${s.address().port}` };
}

(async () => {
  const { ids } = await sembrar(pool);
  await sincronizarClaveCelular(pool, ids.coord1);
  // Se encienden los complementos para que el menú tenga todo lo que puede tener.
  await require('./fixtures/encender-complementos')(pool, ['solicitudes', 'tareas', 'puerta_a_puerta', 'faltan_por_votar', 'alertas_dia_d', 'transporte_dia_d', 'logistica_dia_d']);

  const actual = await escuchar(crearApp(pool));
  const antes = await escuchar(crearApp(pool, process.env.CARPETA_ANTES));
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: true });

  const ir = async (url) => { await cmd('Page.navigate', { url }); await espera(900); };
  const esperar = async (expr, ms = 10000) => {
    const hasta = Date.now() + ms;
    while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); }
    return false;
  };
  const foto = async (nombre) => {
    const alto = await ev('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)');
    const r = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height: alto, scale: 1 } });
    fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  const sinDesborde = () => ev('document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1');
  const menu = () => ev(`JSON.stringify([...document.querySelectorAll('#menu-app .menu-grupo')].map(g => ({ titulo: g.querySelector('h2').innerText, items: [...g.querySelectorAll('.menu-boton strong')].map(e => e.innerText) })))`).then(JSON.parse);
  const aplanar = (m) => m.flatMap((g) => g.items);

  // Entra con un rol en el servidor dado y deja la pantalla de inicio lista. Cada servidor tiene su sesión: se entra de nuevo en cada uno.
  const ENTRADAS = {
    coordinador: { ruta: '/api/auth/login-coordinador', cuerpo: { cedula: '1023456789', clave: '456789' } },
    lider: { ruta: '/api/auth/login', cuerpo: { email: '1055000001', password: '1055000001' } },
    admin: { ruta: '/api/auth/login', cuerpo: { email: 'admin.ej@ejemplo.co', password: CLAVE_ADMIN } },
  };
  async function verInicio(servidor, rol, nombreFoto) {
    await ir(servidor.base + '/login.html');
    const r = await ev(`fetch('/api/auth/${ENTRADAS[rol].ruta.split('/').pop()}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(ENTRADAS[rol].cuerpo))} }).then(r => r.status)`);
    ok(r === 200, `${rol}: entra (${servidor === actual ? 'ahora' : 'antes'})`, r);
    await ir(servidor.base + '/app/inicio.html');
    ok(await esperar("location.pathname === '/app/inicio.html' && document.querySelectorAll('#menu-app .menu-boton').length > 0"), `${rol}: abre el inicio con su menú`);
    await espera(1200);                     // las tarjetas del panel llegan después del menú
    const m = await menu();
    if (nombreFoto) await foto(nombreFoto);
    return m;
  }

  console.log('\n[1] El coordinador: antes y ahora');
  const cAntes = await verInicio(antes, 'coordinador', 'coordinador-antes-390x844');
  const cAhora = await verInicio(actual, 'coordinador', 'coordinador-despues-390x844');
  console.log('     antes :', cAntes.map((g) => `${g.titulo}[${g.items.length}]`).join(' · '));
  console.log('     ahora :', cAhora.map((g) => `${g.titulo}[${g.items.length}]`).join(' · '));
  ok(aplanar(cAntes).includes('Panel completo') && cAntes.some((g) => g.titulo === 'Registro'), 'antes tenía «Panel completo» y el grupo «Registro» (la prueba mide algo)');
  ok(!aplanar(cAhora).includes('Panel completo'), 'ahora NO hay «Panel completo»');
  ok(!cAhora.some((g) => g.titulo === 'Registro'), 'ahora NO hay grupo «Registro» (ni su título)');
  for (const t of ['Registro de votantes y sublíderes', 'Mi enlace de inscripción', 'Consultar puesto de votación']) ok(!aplanar(cAhora).includes(t), `ahora NO está «${t}»`);
  const resumen = cAhora.find((g) => g.titulo === 'Resumen');
  ok(resumen && resumen.items.join() === 'Mis líderes', 'el grupo «Resumen» queda solo con «Mis líderes»', resumen);
  ok(cAhora.every((g) => g.items.length > 0), 'ningún grupo queda vacío (no se pinta título sin entradas)');
  const igual = (t) => JSON.stringify((cAntes.find((g) => g.titulo === t) || {}).items) === JSON.stringify((cAhora.find((g) => g.titulo === t) || {}).items);
  const otros = cAntes.map((g) => g.titulo).filter((t) => !['Resumen', 'Registro'].includes(t));
  ok(otros.length >= 3 && otros.every(igual), `los demás grupos quedan IGUALES (entrada por entrada): ${otros.join(', ')}`, otros.filter((t) => !igual(t)));
  ok(JSON.stringify(cAhora.map((g) => g.titulo)) === JSON.stringify(cAntes.map((g) => g.titulo).filter((t) => t !== 'Registro')), 'y en el mismo orden');
  const botones = await ev("[...document.querySelectorAll('#panel-coordinador a.pc-boton')].map(a => a.innerText.trim() + ' → ' + a.getAttribute('href'))");
  ok(botones.length === 1 && /Ver mis líderes/.test(botones[0]), 'el botón amarillo «Ver mis líderes» bajo «Mi equipo» se queda', botones);
  const enlacesAPaginasQuitadas = await ev(`[...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => /mis-registros|mi-enlace|puesto-votacion|dashboard\\.html/.test(h))`);
  ok(enlacesAPaginasQuitadas.length === 0, 'en todo el inicio no queda NINGÚN otro enlace a esas cuatro páginas (tarjetas, botones, barra)', enlacesAPaginasQuitadas);
  ok(await sinDesborde(), 'sin desborde horizontal');

  console.log('\n[2] Las páginas quitadas del menú siguen abriendo con su dirección (no es un bloqueo)');
  for (const ruta of ['/app/mis-registros.html', '/app/mi-enlace.html', '/app/puesto-votacion.html', '/dashboard.html']) {
    await ir(actual.base + ruta);
    await espera(1200);
    const donde = await ev('location.pathname');
    const hayCuerpo = await ev('document.body && document.body.innerText.length > 20');
    ok(donde === ruta && hayCuerpo, `el coordinador abre ${ruta} a mano y se queda ahí`, donde);
  }

  console.log('\n[3] Líder y administrador: el MISMO menú de antes');
  for (const rol of ['lider', 'admin']) {
    const a = await verInicio(antes, rol, `${rol}-antes-390x844`);
    const d = await verInicio(actual, rol, `${rol}-despues-390x844`);
    ok(a.length > 0 && JSON.stringify(a) === JSON.stringify(d), `${rol}: grupos y entradas idénticos antes y ahora (${aplanar(d).length} entradas)`, { a, d });
  }
  const lAhora = aplanar(await menu());
  ok(true, `(el administrador tiene ${lAhora.length} entradas)`);
  const lid = await verInicio(actual, 'lider', null);
  ok(['Registro de votantes y sublíderes', 'Mi enlace de inscripción', 'Consultar puesto de votación'].every((t) => aplanar(lid).includes(t)), 'el LÍDER sigue viendo su grupo «Registro» completo');

  console.log('\n[4] La consola');
  ok(p.avisos.length === 0, 'ninguna excepción de JavaScript en toda la prueba', p.avisos);
  const raros = p.respuestas.filter((r) => r.status >= 400 && !/\/api\/auth\/(me|login-coordinador|login)\b/.test(r.url) && !/favicon/.test(r.url)
    // El servidor de pruebas monta solo un subconjunto de las rutas: estas tres NO están montadas (404 «sin ruta en el servidor de pruebas»), no son de la aplicación.
    && !/\/api\/(dia-d|votantes|inscripcion)\b/.test(r.url));
  ok(raros.length === 0, 'ninguna respuesta de error inesperada (salvo las rutas que el servidor de pruebas no monta)', raros);

  nav.cerrar(); actual.s.close(); antes.s.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO BIEN'} (${pasos} comprobaciones). Capturas en ${SALIDA}`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
