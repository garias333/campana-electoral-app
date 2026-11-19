#!/usr/bin/env node
// scripts/probar-coordinadores-celular-cdp.js
//
// Prueba de la orden 59 EN CHROMIUM REAL (CDP) a 390×844: el botón «Coordinadores», el formulario (cédula, clave de 6 dígitos con ojo), el ingreso, el
// inicio del coordinador, «Mis líderes» con búsqueda y filtros, la ficha con Llamar / WhatsApp / SMS (no envía nada: solo se lee a dónde apuntan los
// enlaces), el líder sin celular, la copia sin señal, cerrar sesión, y el ingreso de los líderes como siempre. Saca las capturas.
//
// USO (sobre una base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium: comparten el perfil):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada59 \
//   [CARPETA_ANTES=/ruta/a/public-de-HEAD] [SALIDA=/ruta/capturas] node scripts/probar-coordinadores-celular-cdp.js
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

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const pool = require('../config/db');
const { sembrar, crearApp } = require('./fixtures/coordinadores-celular');
const { sincronizarClaveCelular } = require('../lib/claveCelular');
const { lanzar, espera } = require('./capturas/navegador');

const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden59');
fs.mkdirSync(SALIDA, { recursive: true });

let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}

async function escuchar(app) {
  const s = http.createServer(app);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { s, base: `http://127.0.0.1:${s.address().port}` };
}

(async () => {
  const { ids } = await sembrar(pool);
  await sincronizarClaveCelular(pool, ids.coord1);
  await sincronizarClaveCelular(pool, ids.coord2);
  await require('./fixtures/encender-complementos')(pool, ['faltan_por_votar']);

  const actual = await escuchar(crearApp(pool));
  const antes = process.env.CARPETA_ANTES ? await escuchar(crearApp(pool, process.env.CARPETA_ANTES)) : null;
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;

  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: true });

  const ir = async (url) => { await cmd('Page.navigate', { url }); await espera(900); };
  const esperar = async (expr, ms = 8000) => {
    const hasta = Date.now() + ms;
    while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* aún cargando */ } await espera(150); }
    return false;
  };
  const foto = async (nombre) => {
    const r = await cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  const sinDesborde = async () => ev('document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1');
  const escribir = (sel, valor) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value = ${JSON.stringify(valor)}; e.dispatchEvent(new Event('input', { bubbles: true })); return e.value; })()`);
  const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const texto = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ''`);
  const ruta = () => ev('location.pathname');

  console.log('\n[1] La pantalla de ingreso y el botón «Coordinadores»');
  await ir(actual.base + '/login.html');
  ok(await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'"), 'en el celular se ve la pantalla de elección');
  const botones = await ev("[...document.querySelectorAll('#form-elegir-acceso button')].map(b => b.innerText.trim())");
  ok(botones.includes('Acceso a Coordinadores'), 'hay un botón «Acceso a Coordinadores»', botones);
  ok(botones.indexOf('Acceso a Coordinadores') === botones.indexOf('Acceso a Aspirantes al Concejo') + 1, 'va junto a los de líderes, testigos y aspirantes');
  const mismoEstilo = await ev(`(() => { const a = getComputedStyle(document.getElementById('ir-a-lideres-desde-eleccion')); const b = getComputedStyle(document.getElementById('ir-a-coordinadores-desde-eleccion'));
    return ['backgroundColor','fontSize','borderRadius','minHeight','color'].every(k => a[k] === b[k]); })()`);
  ok(mismoEstilo, 'con el mismo estilo que el de líderes');
  ok(await sinDesborde(), 'sin desborde horizontal');
  await foto('1-boton-de-ingreso-390x844');

  console.log('\n[2] El formulario');
  await click('#ir-a-coordinadores-desde-eleccion');
  ok(await esperar("getComputedStyle(document.getElementById('form-coordinador')).display !== 'none'"), 'se abre el formulario de coordinadores');
  const f = await ev(`(() => { const c = document.getElementById('campo-cedula-coord'), k = document.getElementById('campo-clave-coord');
    return { cedula: { modo: c.inputMode, tipo: c.type, label: document.querySelector('label[for=campo-cedula-coord]').innerText },
             clave: { modo: k.inputMode, tipo: k.type, max: k.maxLength, label: document.querySelector('label[for=campo-clave-coord]').innerText },
             ayuda: document.querySelector('#form-coordinador small').innerText.trim(),
             boton: document.querySelector('#form-coordinador button[type=submit]').innerText.trim(),
             colorBoton: getComputedStyle(document.querySelector('#form-coordinador button[type=submit]')).backgroundColor }; })()`);
  ok(f.cedula.label === 'Número de cédula' && f.cedula.modo === 'numeric', '«Número de cédula» con teclado numérico', f.cedula);
  ok(f.clave.label === 'Clave de 6 dígitos' && f.clave.modo === 'numeric' && f.clave.max === 6 && f.clave.tipo === 'password', '«Clave de 6 dígitos»: numérica, 6 como máximo y oculta', f.clave);
  ok(f.ayuda === 'Su clave son los últimos 6 dígitos de su cédula.', 'texto de ayuda pequeño', f.ayuda);
  ok(f.boton.toLowerCase() === 'ingresar' && /255, ?195, ?0/.test(f.colorBoton), 'botón «Ingresar» amarillo', f.colorBoton);
  ok(await escribir('#campo-cedula-coord', '10a23-45 6') === '1023456', 'la cédula solo acepta dígitos (descarta letras y signos)');
  ok(await escribir('#campo-clave-coord', '12ab3456') === '123456', 'la clave solo acepta dígitos (el máximo de 6 lo pone el propio campo)');
  await click('#ojo-clave-coord');
  ok(await ev("document.getElementById('campo-clave-coord').type") === 'text', 'el ojo muestra la clave');
  await foto('2-formulario-con-clave-visible-390x844');
  await click('#ojo-clave-coord');
  ok(await ev("document.getElementById('campo-clave-coord').type") === 'password', 'y la vuelve a ocultar');
  ok(await sinDesborde(), 'sin desborde horizontal');
  await escribir('#campo-cedula-coord', ''); await escribir('#campo-clave-coord', '');
  await foto('2b-formulario-vacio-390x844');

  console.log('\n[3] Errores: genérico, y un líder no entra por aquí');
  await escribir('#campo-cedula-coord', '1023456789'); await escribir('#campo-clave-coord', '000000');
  await click('#form-coordinador button[type=submit]');
  ok(await esperar("document.getElementById('login-error').classList.contains('visible')"), 'una clave equivocada muestra un error');
  const e1 = await texto('#login-error');
  ok(e1.trim() === 'Cédula o clave incorrecta.', 'mensaje genérico «Cédula o clave incorrecta.»', e1);
  await foto('3-error-generico-390x844');
  await escribir('#campo-cedula-coord', '1055000001'); await escribir('#campo-clave-coord', '000001');
  await click('#form-coordinador button[type=submit]');
  await espera(900);
  const e2 = await texto('#login-error');
  ok(e2.trim() === e1.trim() && await ruta() === '/login.html', 'un LÍDER con su cédula por aquí: el mismo mensaje y sigue en el ingreso', { e2, ruta: await ruta() });

  console.log('\n[4] Entra el coordinador y cae en su inicio');
  await escribir('#campo-cedula-coord', '1023456789'); await escribir('#campo-clave-coord', '456789');
  await click('#form-coordinador button[type=submit]');
  ok(await esperar("location.pathname === '/app/inicio.html'", 10000), 'cédula 1023456789 + 456789 → /app/inicio.html', await ruta());
  ok(await esperar("!document.getElementById('panel-coordinador').hidden", 10000), 'aparece el encabezado de su equipo');
  await espera(500);
  const inicio = await ev(`({ saludo: document.getElementById('saludo').innerText, tiles: [...document.querySelectorAll('#panel-coordinador .pc-tile')].map(t => t.innerText.replace(/\\n/g, ' · ')),
    menu: [...document.querySelectorAll('#menu-app .menu-boton strong')].map(e => e.innerText), panelLiderVisible: !document.getElementById('panel-lider').hidden })`);
  ok(/Marta/.test(inicio.saludo), 'saluda por su nombre', inicio.saludo);
  ok(inicio.tiles.length === 5, 'cinco cifras en tarjetas', inicio.tiles);
  ok(/Líderes activos · 4/i.test(inicio.tiles[0]), 'líderes activos: 4', inicio.tiles[0]);
  ok(/Personas registradas · 21/i.test(inicio.tiles[1]), 'personas registradas: 21', inicio.tiles[1]);
  ok(/Compromiso total · 70/i.test(inicio.tiles[2]), 'compromiso total: 70', inicio.tiles[2]);
  ok(/Avance · 30 %/i.test(inicio.tiles[3]), '% de avance: 30 %', inicio.tiles[3]);
  ok(/Últimos 7 días/i.test(inicio.tiles[4]), 'registros de los últimos 7 días', inicio.tiles[4]);
  ok(inicio.menu[0] === 'Mis líderes' && !inicio.menu.includes('Avance de mis líderes'), 'el menú empieza por «Mis líderes» y «Avance de mis líderes» ya no está', inicio.menu);
  // (Alertas Día D no sale aquí: es un complemento y en esta prueba nacen apagados.)
  ok(['Mis líderes', 'Eventos', 'Ranking Día D', 'Biografía del candidato', 'Información para compartir', 'Mis avisos', 'Política de privacidad', 'Legislación', 'Ayuda'].every((x) => inicio.menu.includes(x)), 'lo demás del menú del coordinador sigue', inicio.menu);
  // Orden 63: sin «Panel completo» ni el grupo «Registro» (lo prueba a fondo probar-menu-coordinador-celular.js).
  ok(!['Panel completo', 'Mi enlace de inscripción', 'Registro de votantes y sublíderes', 'Consultar puesto de votación'].some((x) => inicio.menu.includes(x)), 'el menú del coordinador ya no trae «Panel completo» ni el grupo «Registro»', inicio.menu);
  ok(!inicio.panelLiderVisible, 'el panel del líder no aparece para el coordinador');
  ok(await sinDesborde(), 'sin desborde horizontal');
  await foto('4-inicio-del-coordinador-390x844');
  await ev('window.scrollTo(0, 560)'); await espera(300);
  await foto('4b-inicio-del-coordinador-menu-390x844');
  await ev('window.scrollTo(0, 0)');

  console.log('\n[5] «Mis líderes»: lista, búsqueda y filtros');
  await click('a[href="/app/mis-lideres.html"]');
  ok(await esperar("location.pathname === '/app/mis-lideres.html' && document.querySelectorAll('.lider-item').length > 0", 10000), 'abre Mis líderes con la lista');
  let filas = await ev("[...document.querySelectorAll('.lider-item')].map(f => ({ nombre: f.querySelector('.nombre').innerText, sub: f.querySelector('.sub').innerText.replace(/\\n/g,' '), ultimo: f.querySelector('.ultimo').innerText, alerta: f.querySelector('.ultimo').classList.contains('alerta'), color: f.querySelector('.barra-relleno').className }))");
  ok(filas.length === 6, '6 personas: 4 líderes y 2 sublíderes', filas.map((x) => x.nombre));
  ok(filas[0].nombre.startsWith('Ana'), 'orden por defecto: menor avance primero (Ana, 14 %)', filas.map((x) => x.nombre));
  const f2 = (n) => filas.find((x) => x.nombre.startsWith(n));
  ok(/Líder/.test(f2('Ana').sub) && /Los Ejemplos/.test(f2('Ana').sub) && /Sublíder/.test(f2('Sara').sub), 'cada fila dice su rol y su barrio', [f2('Ana').sub, f2('Sara').sub]);
  ok(f2('Ana').color.includes('rojo') && f2('Beto').color.includes('amarillo') && f2('Diego').color.includes('verde') && f2('Carla').color.includes('sin_meta'), 'semáforo: rojo / amarillo / verde / sin meta');
  ok(f2('Beto').alerta && /hace 9 días/.test(f2('Beto').ultimo) && !f2('Ana').alerta && /hoy/.test(f2('Ana').ultimo), '«Último registro: hace 9 días» en rojo para Beto; Ana, hoy, sin alerta', [f2('Beto').ultimo, f2('Ana').ultimo]);
  ok(f2('Carla').alerta && /Aún no ha registrado/.test(f2('Carla').ultimo), 'Carla, que nunca registró, también en rojo');
  ok(await sinDesborde(), 'sin desborde horizontal');
  await foto('5-mis-lideres-lista-390x844');
  await click('[data-filtro="sin7"]');
  await espera(300);
  filas = await ev("[...document.querySelectorAll('.lider-item .nombre')].map(e => e.innerText)");
  ok(filas.length === 3 && filas.every((n) => /Beto|Carla|Tito/.test(n)), 'filtro «Sin registrar hace 7+ días»: Beto, Carla y Tito', filas);
  await foto('5b-mis-lideres-filtro-sin-registrar-390x844');
  await click('[data-filtro="rojo"]'); await espera(300);
  filas = await ev("[...document.querySelectorAll('.lider-item .nombre')].map(e => e.innerText)");
  ok(filas.length === 1 && /Ana/.test(filas[0]), 'filtro rojo (< 40 %): solo Ana', filas);
  await click('[data-filtro="amarillo"]'); await espera(300);
  filas = await ev("[...document.querySelectorAll('.lider-item .nombre')].map(e => e.innerText)");
  ok(filas.length === 2 && filas.every((n) => /Beto|Sara/.test(n)), 'filtro amarillo (40 a 79 %): Sara y Beto', filas);
  await click('[data-filtro="verde"]'); await espera(300);
  filas = await ev("[...document.querySelectorAll('.lider-item .nombre')].map(e => e.innerText)");
  ok(filas.length === 1 && /Diego/.test(filas[0]), 'filtro verde (80 % o más): Diego', filas);
  await click('[data-filtro="todos"]');
  await escribir('#buscador', 'carl'); await espera(300);
  filas = await ev("[...document.querySelectorAll('.lider-item .nombre')].map(e => e.innerText)");
  ok(filas.length === 1 && /Carla/.test(filas[0]), 'búsqueda por nombre: «carl» → Carla', filas);
  await escribir('#buscador', 'BETO LIDER'); await espera(300);
  filas = await ev("[...document.querySelectorAll('.lider-item .nombre')].map(e => e.innerText)");
  ok(filas.length === 1 && /Beto/.test(filas[0]), 'la búsqueda no distingue mayúsculas ni tildes', filas);
  await escribir('#buscador', 'zzzz'); await espera(300);
  ok((await texto('#vacio')).includes('Nadie coincide'), 'sin coincidencias lo dice');
  await escribir('#buscador', '');
  await click('[data-orden="nombre"]'); await espera(300);
  filas = await ev("[...document.querySelectorAll('.lider-item .nombre')].map(e => e.innerText)");
  ok(filas[0].startsWith('Ana') && filas[1].startsWith('Beto') && filas[2].startsWith('Carla'), 'orden por nombre', filas);
  await click('[data-orden="avance"]'); await espera(200);

  console.log('\n[6] La ficha: Llamar, WhatsApp y SMS (no se envía nada)');
  await ev("[...document.querySelectorAll('.lider-item')].find(f => f.innerText.includes('Ana')).click()");
  ok(await esperar("document.getElementById('ficha-overlay').classList.contains('abierto')"), 'tocar a Ana abre su ficha');
  await espera(900);   // llega la ficha en vivo (Día D)
  const ficha = await ev(`({ nombre: document.getElementById('ficha-nombre').innerText, rol: document.getElementById('ficha-rol').innerText, tel: document.getElementById('ficha-telefono').innerText,
    enlaces: [...document.querySelectorAll('#ficha-acciones a')].map(a => ({ t: a.innerText.trim(), href: a.getAttribute('href') })),
    detalle: document.getElementById('ficha-detalle').innerText.replace(/\\n+/g, ' | ') })`);
  ok(ficha.nombre.startsWith('Ana') && /Líder/.test(ficha.rol), 'la ficha dice quién es', ficha);
  ok(ficha.tel === '300 111 2233' || /3001112233|300 111 2233/.test(ficha.tel), 'muestra su celular', ficha.tel);
  const L = (t) => ficha.enlaces.find((x) => x.t === t) || {};
  ok(L('Llamar').href === 'tel:+573001112233', 'Llamar → tel:+573001112233', L('Llamar'));
  ok(/^https:\/\/wa\.me\/573001112233\?text=/.test(L('WhatsApp').href) && decodeURIComponent(L('WhatsApp').href.split('text=')[1]) === 'Hola Ana, ¿cómo vas con los registros?', 'WhatsApp → wa.me/573001112233 con «Hola Ana, ¿cómo vas con los registros?»', L('WhatsApp'));
  ok(/^sms:\+573001112233[?&]body=/.test(L('SMS').href), 'SMS → sms:+573001112233?body=…', L('SMS'));
  ok(!/\b(alcald|concej|gobernac|asamble)/i.test(decodeURIComponent(L('WhatsApp').href) + decodeURIComponent(L('SMS').href)), 'el mensaje no menciona el cargo (precampaña)');
  ok(/su avance/i.test(ficha.detalle) && /7 \| de 50 comprometidos \| 14 %/.test(ficha.detalle), 'resumen de su avance: 7 de 50 (14 %)', ficha.detalle);
  ok(/registrados por semana/i.test(ficha.detalle), 'registrados por semana (4 semanas)');
  ok(await ev("document.querySelectorAll('#ficha-detalle .semana').length") === 4, 'cuatro semanas dibujadas');
  ok(/día d · modo prueba/i.test(ficha.detalle) && /ya votó \| no figura como votante/i.test(ficha.detalle), 'con el módulo encendido, el bloque Día D (modo prueba) con «Ya votó»', ficha.detalle);
  ok(/sus sublíderes \(1\)/i.test(ficha.detalle) && /Sara Sublíder Alfa/.test(ficha.detalle), 'sus sublíderes: Sara', ficha.detalle);
  ok(await sinDesborde(), 'sin desborde horizontal');
  await foto('6-ficha-con-botones-390x844');
  await ev("document.getElementById('ficha').scrollTop = 10000"); await espera(250);
  await foto('6b-ficha-abajo-390x844');
  await ev("document.querySelector('[data-sub]').click()");
  await espera(900);
  ok((await texto('#ficha-nombre')).startsWith('Sara') && /Sublíder/.test(await texto('#ficha-rol')), 'tocar a la sublíder abre la ficha de Sara', await texto('#ficha-rol'));
  await click('#btn-cerrar-ficha');
  // Líder SIN celular
  await ev("[...document.querySelectorAll('.lider-item')].find(f => f.innerText.includes('Carla')).click()");
  await espera(900);
  const sinTel = await ev(`({ tel: document.getElementById('ficha-telefono').innerText, enlaces: document.querySelectorAll('#ficha-acciones a').length,
    desh: [...document.querySelectorAll('#ficha-acciones .deshabilitado')].map(e => e.innerText.trim()) })`);
  ok(sinTel.tel === 'Sin celular registrado' && sinTel.enlaces === 0 && sinTel.desh.join() === 'Llamar,WhatsApp,SMS', 'líder sin celular: «Sin celular registrado» y los tres botones deshabilitados (ni un enlace)', sinTel);
  await foto('6c-ficha-sin-celular-390x844');
  await click('#btn-cerrar-ficha');
  // Quien pidió no recibir mensajes: se puede llamar, no escribir.
  await ev("[...document.querySelectorAll('.lider-item')].find(f => f.innerText.includes('Diego')).click()");
  await espera(900);
  const baja = await ev(`({ enlaces: [...document.querySelectorAll('#ficha-acciones a')].map(a => a.innerText.trim()), desh: [...document.querySelectorAll('#ficha-acciones .deshabilitado')].map(e => e.innerText.trim()), nota: document.getElementById('ficha-nota').innerText })`);
  ok(baja.enlaces.join() === 'Llamar' && baja.desh.join() === 'WhatsApp,SMS' && /no recibir mensajes/.test(baja.nota), 'quien pidió no recibir mensajes: solo Llamar; WhatsApp y SMS deshabilitados con su nota', baja);
  await click('#btn-cerrar-ficha');

  console.log('\n[7] Sin señal: la lista cacheada');
  // (a) Se pierde la señal con la pantalla abierta: se vuelve a pedir y se muestra la última copia guardada.
  await cmd('Network.setBlockedURLs', { urls: ['*/api/*'] });
  await ev('cargar()');
  ok(await esperar("document.getElementById('sin-senal').style.display === 'block' && document.querySelectorAll('.lider-item').length === 6", 10000), 'sin señal se muestra la última lista guardada, con su aviso «Sin señal» y la hora', await texto('#sin-senal'));
  await ev("[...document.querySelectorAll('.lider-item')].find(f => f.innerText.includes('Beto')).click()");
  await espera(500);
  const off = await ev(`({ nombre: document.getElementById('ficha-nombre').innerText, llamar: (document.querySelector('#ficha-acciones a') || {}).href || null, detalle: document.getElementById('ficha-detalle').innerText })`);
  ok(off.nombre.startsWith('Beto') && /^tel:\+573004445566$/.test(off.llamar) && /su avance/i.test(off.detalle), 'y la ficha se arma sola con lo guardado, con sus botones de contacto', off);
  await foto('7-sin-senal-390x844');
  await click('#btn-cerrar-ficha');
  // (b) Se abre la pantalla ya SIN señal en un celular con la cuenta guardada (lo mismo que hoy exige la app del líder para abrir sin señal).
  await cmd('Network.setBlockedURLs', { urls: [] });
  await ev(`api('/auth/me').then(s => guardarCuentaDispositivo(s.usuario, 'token-de-prueba'))`);
  await cmd('Network.setBlockedURLs', { urls: ['*/api/*'] });
  await cmd('Page.reload'); await espera(2500);
  ok(await esperar("location.pathname === '/app/mis-lideres.html' && document.getElementById('sin-senal').style.display === 'block' && document.querySelectorAll('.lider-item').length === 6", 15000), 'recargada la pantalla sin señal (con la cuenta guardada en el celular) sigue mostrando la copia', await ruta());
  await cmd('Network.setBlockedURLs', { urls: [] });
  await ev("localStorage.removeItem('app_cuentas_dispositivo'); localStorage.removeItem('app_cuenta_activa_id')");   // la cuenta guardada era de mentira (token falso): fuera
  // El inicio también (el encabezado del coordinador).
  await ir(actual.base + '/app/inicio.html');
  ok(await esperar("location.pathname === '/app/inicio.html' && !document.getElementById('panel-coordinador').hidden", 10000), 'el inicio abre con señal', await ruta());
  await cmd('Network.setBlockedURLs', { urls: ['*/api/*'] });
  await ev('PanelCoordinador.recargar()'); await espera(800);
  const pie = await texto('#panel-coordinador .pl-sin-senal');
  ok(/Sin señal/.test(pie) && (await ev("document.querySelectorAll('#panel-coordinador .pc-tile').length")) === 5, 'el encabezado del inicio también muestra su copia con el aviso «Sin señal»', pie);
  await cmd('Network.setBlockedURLs', { urls: [] });

  console.log('\n[8] Cerrar sesión');
  await ir(actual.base + '/app/inicio.html');
  ok(await esperar("!document.getElementById('panel-coordinador').hidden", 10000), 'de vuelta en el inicio');
  await click('#btn-cerrar-sesion');
  ok(await esperar("location.pathname === '/login.html'", 10000), 'cerrar sesión lleva al ingreso');
  const me = await ev("fetch('/api/auth/me').then(r => r.status)");
  ok(me === 401, 'y la sesión del servidor ya no existe', me);

  console.log('\n[9] El ingreso de los líderes sigue igual');
  await ir(actual.base + '/login.html');
  await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
  await click('#ir-a-lideres-desde-eleccion');
  await esperar("getComputedStyle(document.getElementById('form-login')).display !== 'none'");
  ok(await ev("document.querySelector('#form-login [name=email]').inputMode") === 'numeric' && (await texto('#form-login label')).startsWith('Número de identificación'), 'el formulario de líderes sigue siendo el de siempre (número de identificación y clave)');
  await escribir('#form-login [name=email]', '1055000001'); await escribir('#form-login [name=password]', '1055000001');
  await click('#form-login button[type=submit]');
  ok(await esperar("location.pathname === '/app/inicio.html'", 10000), 'un líder entra por su puerta y cae en su inicio', await ruta());
  await esperar("!document.getElementById('panel-lider').hidden", 10000);
  ok(await ev("document.getElementById('panel-coordinador').hidden") === true && await ev("!document.getElementById('panel-lider').hidden"), 've SU panel (el del líder), no el del coordinador');
  await espera(600);
  await foto('8-lider-despues-390x844');
  await click('#btn-cerrar-sesion');
  await esperar("location.pathname === '/login.html'");

  if (antes) {
    console.log('\n[10] El inicio del líder ANTES (HEAD) y DESPUÉS: mismo diseño');
    await ir(antes.base + '/login.html');
    await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
    await click('#ir-a-lideres-desde-eleccion');
    await escribir('#form-login [name=email]', '1055000001'); await escribir('#form-login [name=password]', '1055000001');
    await click('#form-login button[type=submit]');
    await esperar("location.pathname === '/app/inicio.html'", 10000);
    await esperar("!document.getElementById('panel-lider').hidden", 10000);
    await espera(600);
    await foto('8-lider-antes-390x844');
    const dAntes = await ev("JSON.stringify([...document.querySelectorAll('#menu-app .menu-boton strong')].map(e => e.innerText))");
    await click('#btn-cerrar-sesion');
    await esperar("location.pathname === '/login.html'");
    await ir(actual.base + '/login.html');
    await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
    await click('#ir-a-lideres-desde-eleccion');
    await escribir('#form-login [name=email]', '1055000001'); await escribir('#form-login [name=password]', '1055000001');
    await click('#form-login button[type=submit]');
    await esperar("location.pathname === '/app/inicio.html'", 10000);
    await esperar("!document.getElementById('panel-lider').hidden", 10000);
    const dDespues = await ev("JSON.stringify([...document.querySelectorAll('#menu-app .menu-boton strong')].map(e => e.innerText))");
    ok(dAntes === dDespues, 'el menú del líder es idéntico antes y después', { dAntes, dDespues });
    await click('#btn-cerrar-sesion');
    await esperar("location.pathname === '/login.html'");
  }

  console.log('\n[11] La consola');
  ok(p.avisos.length === 0, 'ninguna excepción de JavaScript en toda la prueba', p.avisos);
  const raros = p.respuestas.filter((r) => r.status >= 400 && !/\/api\/auth\/(me|login-coordinador|login)\b/.test(r.url) && !/\/api\/\*|favicon/.test(r.url));
  const sinSenal = raros.filter((r) => r.status === 0);
  ok(raros.filter((r) => r.status !== 0).length === 0, 'ninguna respuesta de error inesperada (salvo los 401 del ingreso fallido)', raros.filter((r) => r.status !== 0));
  ok(true, `(${sinSenal.length} peticiones cortadas a propósito en la prueba «sin señal»)`);

  nav.cerrar();
  actual.s.close(); if (antes) antes.s.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO BIEN'} (${pasos} comprobaciones). Capturas en ${SALIDA}`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
