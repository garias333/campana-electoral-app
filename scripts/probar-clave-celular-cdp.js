#!/usr/bin/env node
// scripts/probar-clave-celular-cdp.js
//
// Orden 66 EN CHROMIUM REAL (390×844, toques de verdad): la clave de 6 dígitos del celular para un líder, un sublíder, un aspirante, un testigo y un coordinador.
//   [1] pregunta del primer ingreso → «Dejar la que tengo» → inicio; al salir y volver a entrar ya no pregunta
//   [2] otro usuario → «Cambiar mi clave» → 12345 / 12a456 / nueva≠repetida rechazan; 6 dígitos válidos acepta → inicio; la vieja ya no entra; la nueva sí; el ojito
//   [3] «Cambiar mi clave» desde el menú: clave actual mala rechaza; buena + nueva válida acepta; el ojito en los tres campos
//   [4] la transición (contraseña de hoy), admin por «Otros usuarios», sin desborde y sin errores de consola. Capturas.
//
// USO (sobre una base desechable ya inicializada con init-db; sin otra prueba con Chromium a la vez):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada66 [SALIDA=/ruta/capturas] node scripts/probar-clave-celular-cdp.js
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
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { sembrar, crearApp, CLAVE_ADMIN } = require('./fixtures/coordinadores-celular');
const { lanzar, espera } = require('./capturas/navegador');

const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden66');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];

(async () => {
  const { ids } = await sembrar(pool, { conPregunta: true });
  const rolId = async (n) => (await q('SELECT id FROM roles WHERE nombre = ?', [n]))[0].id;
  const nuevaPersona = async (clave, nombre, rol, cedula, cargo, supervisor) => {
    const [r] = await pool.query('INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, telefono) VALUES (?, ?, ?, ?, ?, ?)',
      [nombre, cedula, cedula, bcrypt.hashSync(cedula, 4), await rolId(rol), '3010000' + cedula.slice(-3)]);
    ids[clave] = r.insertId;
    if (cargo) await q('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, ?, 1)', [r.insertId, cargo, supervisor || null]);
  };
  await nuevaPersona('aspirante', 'Alicia Aspirante Ejemplo', 'aspirante_concejo', '1077000002', 'lider', ids.coord1);
  await nuevaPersona('aspirante2', 'Aurelio Aspirante Muestra', 'aspirante_concejo', '1077000012', 'lider', ids.coord1);
  await nuevaPersona('testigo', 'Tomás Testigo Ejemplo', 'testigo', '1077000001', 'testigo');
  await nuevaPersona('testigo2', 'Teresa Testigo Muestra', 'testigo', '1077000011', 'testigo');
  await q('UPDATE usuarios SET clave_celular_pregunta_hecha = 0 WHERE id IN (?)', [[ids.ana, ids.sara, ids.aspirante, ids.testigo, ids.coord1, ids.beto, ids.tito, ids.aspirante2, ids.testigo2, ids.coord2, ids.diego]]);

  // Orden 69: el botón de testigos nace oculto; esta prueba entra con él, así que se enciende el interruptor.
  await require('./fixtures/encender-complementos')(pool, ['boton_testigos_celular']);
  const servidor = http.createServer(crearApp(pool));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const nav = await lanzar();
  const p = await nav.pagina('about:blank');
  const { cmd, ev } = p;
  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: true });

  const ir = async (ruta, ms = 1000) => { await cmd('Page.navigate', { url: base + ruta }); await espera(ms); };
  const donde = () => ev('location.pathname');
  const esperar = async (expr, ms = 10000) => {
    const hasta = Date.now() + ms;
    while (Date.now() < hasta) { try { if (await ev(expr)) return true; } catch (_) { /* cargando */ } await espera(150); }
    return false;
  };
  const foto = async (nombre, completa) => {
    const clip = completa ? { x: 0, y: 0, width: 390, height: await ev('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)'), scale: 1 } : undefined;
    const r = await cmd('Page.captureScreenshot', Object.assign({ format: 'png' }, clip ? { captureBeyondViewport: true, clip } : {}));
    fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  const sinDesborde = () => ev('document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1');
  const escribir = (sel, valor) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value = ${JSON.stringify(valor)}; e.dispatchEvent(new Event('input', { bubbles: true })); return e.value; })()`);
  const valorDe = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).value`);
  const texto = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ''`);
  const visible = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden' && !e.closest('[hidden]'); })()`);
  async function tocar(sel) {
    await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`);
    await espera(250);
    const c = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const encima = document.elementFromPoint(x, y); return { x, y, esElBoton: !!encima && (encima === e || e.contains(encima)) }; })()`);
    await cmd('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
    await cmd('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await espera(150);
    return c.esElBoton;
  }
  const BOTON = { lider: 'ir-a-lideres-desde-eleccion', aspirante: 'ir-a-aspirantes-desde-eleccion', coordinador: 'ir-a-coordinadores-desde-eleccion', testigo: 'ir-a-testigos-desde-eleccion' };
  const LLEGADA = { lider: '/app/inicio.html', sublider: '/app/inicio.html', aspirante: '/app/inicio.html', testigo: '/app/dia-d.html', coordinador: '/app/inicio.html' };
  /** Entra por el botón del celular y escribe cédula y clave. No espera a nada más. */
  async function entrarPorBoton(boton, cedula, clave) {
    await ir('/login.html');
    await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
    await ev(`document.getElementById(${JSON.stringify(BOTON[boton])}).click()`);
    await escribir('#campo-cedula-coord', cedula); await escribir('#campo-clave-coord', clave);
    await ev("document.querySelector('#form-coordinador button[type=submit]').click()");
  }
  async function salir() {
    const llega = await donde();
    if (!(await visible('#btn-cerrar-sesion'))) await ir(llega);
    await tocar('#btn-cerrar-sesion');
    await esperar("location.pathname === '/login.html'", 8000);
    await espera(500);
  }
  const hayPregunta = () => visible('#capa-clave-celular');
  const mostradoError = async () => ((await texto('#login-error')) || '').trim();

  const PERSONAS = [
    // [rol de botón, cédula para «dejar», cédula para «cambiar», nombre]
    ['lider', '1055000001', '1055000002', 'líder'], ['sublider', '1055000006', '1055000007', 'sublíder'], ['aspirante', '1077000002', '1077000012', 'aspirante'],
    ['testigo', '1077000001', '1077000011', 'testigo'], ['coordinador', '1023456789', '1034567891', 'coordinador'],
  ];
  const botonDe = (rol) => (rol === 'sublider' ? 'lider' : rol);   // los sublíderes entran por el botón de Líderes y Sublíderes
  const ultimos6 = (c) => c.slice(-6);

  console.log('\n[1] Primer ingreso con la clave por omisión: la pregunta, «Dejar la que tengo», y ya no vuelve a preguntar');
  for (const [rol, cedulaDejar, , rotulo] of PERSONAS) {
    await entrarPorBoton(botonDe(rol), cedulaDejar, ultimos6(cedulaDejar));
    ok(await esperar("document.getElementById('capa-clave-celular')"), `${rotulo}: entra con los últimos 6 de su cédula y aparece la pregunta antes del inicio`, await donde());
    if (rol === 'lider') {
      const t = await ev(`({ titulo: document.getElementById('clave-celular-titulo').innerText, parrafos: [...document.querySelectorAll('#clave-paso-pregunta p')].map(x => x.innerText), botones: [...document.querySelectorAll('#clave-paso-pregunta button')].map(b => b.innerText.trim()),
        colorCambiar: getComputedStyle(document.getElementById('clave-btn-cambiar')).backgroundColor })`);
      ok(t.titulo === 'Su clave del celular', 'título «Su clave del celular»', t.titulo);
      ok(t.parrafos[0] === 'Hoy su clave son los últimos 6 dígitos de su cédula. ¿Quiere cambiarla por una que solo usted conozca?', 'el texto de la pregunta, tal cual', t.parrafos);
      ok(t.botones.join('|') === 'Cambiar mi clave|Dejar la que tengo' && /255, ?195, ?0/.test(t.colorCambiar), 'botón amarillo «Cambiar mi clave» y secundario «Dejar la que tengo»', t);
      ok(await sinDesborde(), 'sin desborde horizontal');
      await foto('1-pregunta-primer-ingreso-390x844');
    }
    ok(await tocar('#clave-btn-dejar'), `${rotulo}: el toque cae sobre «Dejar la que tengo»`);
    ok(await esperar("!document.getElementById('capa-clave-celular')", 6000), `${rotulo}: «Dejar la que tengo» cierra la pregunta`);
    ok(await esperar(`location.pathname === ${JSON.stringify(LLEGADA[rol])}`, 8000), `${rotulo}: sigue al inicio (${LLEGADA[rol]})`, await donde());
    const hecha = (await q('SELECT clave_celular_pregunta_hecha p, clave_celular_es_defecto d FROM usuarios WHERE id = ?', [ids[{ lider: 'ana', sublider: 'sara', coordinador: 'coord1' }[rol] || rol]]))[0];
    ok(Number(hecha.p) === 1 && Number(hecha.d) === 1, `${rotulo}: queda «pregunta hecha» y sigue la clave por omisión`, hecha);
    await salir();
    await entrarPorBoton(botonDe(rol), cedulaDejar, ultimos6(cedulaDejar));
    ok(await esperar(`location.pathname === ${JSON.stringify(LLEGADA[rol])}`, 8000), `${rotulo}: al salir y volver a entrar llega directo`, await donde());
    await espera(1800);
    ok(!(await hayPregunta()), `${rotulo}: y YA NO pregunta`);
    await salir();
  }

  console.log('\n[2] Otro usuario elige «Cambiar mi clave» en la pregunta');
  const NUEVA = { lider: '482911', sublider: '482912', aspirante: '482913', testigo: '482914', coordinador: '482915' };
  for (const [rol, , cedulaCambiar, rotulo] of PERSONAS) {
    await entrarPorBoton(botonDe(rol), cedulaCambiar, ultimos6(cedulaCambiar));
    await esperar("document.getElementById('capa-clave-celular')");
    ok(await tocar('#clave-btn-cambiar') && await visible('#clave-paso-cambio'), `${rotulo}: «Cambiar mi clave» abre el formulario de la nueva clave (sin pedir la actual)`);
    ok(!(await visible('#clave-actual')), `${rotulo}: no hay campo de «Clave actual» (acaba de entrar con ella)`);
    if (rol === 'lider') {
      ok(await ev(`(() => { const campos = ['clave-nueva', 'clave-repetir'].map(i => document.getElementById(i)); return campos.every(c => c.type === 'password' && c.inputMode === 'numeric' && c.maxLength === 6); })()`), 'los campos son numéricos, de 6 y ocultos por defecto');
      for (const id of ['clave-nueva', 'clave-repetir']) {
        await escribir('#' + id, '482911');
        const antes = await ev(`document.getElementById(${JSON.stringify(id)}).type`);
        await tocar(`[data-ojo="${id}"]`);
        const visto = await ev(`document.getElementById(${JSON.stringify(id)}).type`);
        await tocar(`[data-ojo="${id}"]`);
        const oculto = await ev(`document.getElementById(${JSON.stringify(id)}).type`);
        ok(antes === 'password' && visto === 'text' && oculto === 'password', `el ojito muestra y oculta «${id}»`, { antes, visto, oculto });
      }
      await escribir('#clave-nueva', ''); await escribir('#clave-repetir', '');
    }
    // Rechazos
    await escribir('#clave-nueva', '12345'); await escribir('#clave-repetir', '12345');
    await ev("document.querySelector('#clave-paso-cambio button[type=submit]').click()");
    await espera(300);
    ok(/exactamente 6 dígitos/.test(await texto('#clave-error-cambio')), `${rotulo}: 12345 (5 dígitos) se rechaza`, await texto('#clave-error-cambio'));
    ok(await escribir('#clave-nueva', '12a456') === '12456' && await escribir('#clave-repetir', '12a456') === '12456', `${rotulo}: 12a456 no deja escribir la letra (solo dígitos)`);
    await ev("document.querySelector('#clave-paso-cambio button[type=submit]').click()"); await espera(300);
    ok(/exactamente 6 dígitos/.test(await texto('#clave-error-cambio')), `${rotulo}: lo que queda (12456) se rechaza`);
    await escribir('#clave-nueva', NUEVA[rol]); await escribir('#clave-repetir', NUEVA[rol].slice(0, 5) + '0');
    await ev("document.querySelector('#clave-paso-cambio button[type=submit]').click()"); await espera(300);
    ok(/no son iguales/.test(await texto('#clave-error-cambio')), `${rotulo}: nueva y repetida distintas se rechaza`, await texto('#clave-error-cambio'));
    if (rol === 'lider') await foto('2-cambiar-con-ojito-390x844');
    await escribir('#clave-repetir', NUEVA[rol]);
    if (rol === 'lider') { await tocar('[data-ojo="clave-nueva"]'); await tocar('[data-ojo="clave-repetir"]'); await foto('2b-cambiar-clave-visible-390x844'); }
    await ev("document.querySelector('#clave-paso-cambio button[type=submit]').click()");
    ok(await esperar("document.getElementById('clave-paso-listo') && !document.getElementById('clave-paso-listo').hidden", 6000), `${rotulo}: una clave de 6 dígitos válida se acepta`);
    ok((await texto('#clave-paso-listo')).includes('Su clave quedó cambiada.'), `${rotulo}: «Su clave quedó cambiada.»`);
    if (rol === 'lider') await foto('3-clave-cambiada-390x844');
    await tocar('#clave-btn-continuar');
    ok(await esperar(`location.pathname === ${JSON.stringify(LLEGADA[rol])}`, 8000) && !(await hayPregunta()), `${rotulo}: sigue al inicio`, await donde());
    await salir();
    await entrarPorBoton(botonDe(rol), cedulaCambiar, ultimos6(cedulaCambiar));
    await esperar("document.getElementById('login-error').classList.contains('visible')", 6000);
    ok((await mostradoError()) === 'Cédula o clave incorrecta.' && (await donde()) === '/login.html', `${rotulo}: con la clave vieja (los últimos 6) YA NO entra`, await mostradoError());
    await entrarPorBoton(botonDe(rol), cedulaCambiar, NUEVA[rol]);
    ok(await esperar(`location.pathname === ${JSON.stringify(LLEGADA[rol])}`, 8000), `${rotulo}: con la nueva SÍ entra`, await donde());
    await espera(1500);
    ok(!(await hayPregunta()), `${rotulo}: y no vuelve a preguntar`);
    await salir();
  }

  console.log('\n[3] «Cambiar mi clave» desde el menú (líder y coordinador)');
  for (const [rol, cedula, clave0, claveNueva, rotulo] of [['lider', '1055000001', '000001', '482921', 'líder'], ['coordinador', '1023456789', '456789', '482922', 'coordinador']]) {
    await entrarPorBoton(botonDe(rol), cedula, clave0);
    await esperar("location.pathname === '/app/inicio.html'", 8000); await espera(1500);
    const menu = await ev("[...document.querySelectorAll('#menu-app .menu-grupo')].map(g => ({ titulo: g.querySelector('h2').innerText, items: [...g.querySelectorAll('.menu-boton strong')].map(e => e.innerText) }))");
    const grupo = menu.find((g) => g.items.includes('Cambiar mi clave'));
    ok(grupo && grupo.titulo === 'Mi cuenta y ayuda', `${rotulo}: «Cambiar mi clave» está en «Mi cuenta y ayuda»`, menu);
    const icono = await ev("[...document.querySelectorAll('#menu-app .menu-boton')].find(a => a.innerText.includes('Cambiar mi clave')).querySelector('.icono').innerText");
    ok(icono === '🔑', `${rotulo}: con el ícono 🔑`, icono);
    if (rol === 'lider') {
      await ev("[...document.querySelectorAll('#menu-app .menu-boton')].find(a => a.innerText.includes('Cambiar mi clave')).scrollIntoView({ block: 'center' })"); await espera(300);
      await foto('4-menu-con-cambiar-mi-clave-390x844');
    }
    await ev("[...document.querySelectorAll('#menu-app .menu-boton')].find(a => a.innerText.includes('Cambiar mi clave')).click()");
    ok(await esperar("location.pathname === '/app/cambiar-clave.html' && document.getElementById('clave-actual')", 8000), `${rotulo}: el menú abre «Cambiar mi clave»`);
    if (rol === 'lider') await foto('5-pagina-cambiar-mi-clave-390x844');
    ok(await ev(`['clave-actual', 'clave-nueva', 'clave-repetir'].every(i => { const c = document.getElementById(i); return c.type === 'password' && c.inputMode === 'numeric' && c.maxLength === 6; })`), `${rotulo}: tres campos numéricos, de 6 y ocultos`);
    for (const id of ['clave-actual', 'clave-nueva', 'clave-repetir']) {
      await escribir('#' + id, '482921');
      await tocar(`[data-ojo="${id}"]`);
      const visto = await ev(`document.getElementById(${JSON.stringify(id)}).type`);
      await tocar(`[data-ojo="${id}"]`);
      ok(visto === 'text' && (await ev(`document.getElementById(${JSON.stringify(id)}).type`)) === 'password', `${rotulo}: el ojito muestra y oculta «${id}»`);
    }
    // clave actual mala
    await escribir('#clave-actual', '999888'); await escribir('#clave-nueva', claveNueva); await escribir('#clave-repetir', claveNueva);
    await ev("document.querySelector('#form-cambiar-clave button[type=submit]').click()"); await espera(900);
    ok(/actual no es correcta/.test(await texto('#aviso')) && !(await texto('#aviso')).includes('999888'), `${rotulo}: clave actual mala se rechaza («La clave actual no es correcta.», sin mostrarla)`, await texto('#aviso'));
    if (rol === 'lider') await foto('6-clave-actual-mala-390x844');
    ok(!(await ev("document.getElementById('formulario').hidden")), `${rotulo}: y el formulario sigue ahí`);
    // validaciones locales
    await escribir('#clave-actual', clave0); await escribir('#clave-nueva', '12345'); await escribir('#clave-repetir', '12345');
    await ev("document.querySelector('#form-cambiar-clave button[type=submit]').click()"); await espera(300);
    ok(/exactamente 6 dígitos/.test(await texto('#aviso')), `${rotulo}: nueva de 5 dígitos se rechaza`);
    await escribir('#clave-nueva', claveNueva); await escribir('#clave-repetir', claveNueva.slice(0, 5) + '0');
    await ev("document.querySelector('#form-cambiar-clave button[type=submit]').click()"); await espera(300);
    ok(/no son iguales/.test(await texto('#aviso')), `${rotulo}: nueva ≠ repetida se rechaza`);
    // buena
    await escribir('#clave-repetir', claveNueva);
    await ev("document.querySelector('#form-cambiar-clave button[type=submit]').click()");
    ok(await esperar("!document.getElementById('listo').hidden", 6000) && (await texto('#listo')).includes('Su clave quedó cambiada.'), `${rotulo}: clave actual buena y nueva válida → «Su clave quedó cambiada.»`, await texto('#aviso'));
    if (rol === 'lider') await foto('7-exito-cambiar-mi-clave-390x844');
    ok(await ev("fetch('/api/auth/me').then(r => r.status)") === 200, `${rotulo}: la sesión actual sigue abierta`);
    ok(await sinDesborde(), `${rotulo}: sin desborde horizontal`);
    await ir('/app/inicio.html', 1200);
    await salir();
    await entrarPorBoton(botonDe(rol), cedula, clave0);
    await esperar("document.getElementById('login-error').classList.contains('visible')", 6000);
    ok((await mostradoError()) === 'Cédula o clave incorrecta.', `${rotulo}: la clave de antes ya no entra`);
    await entrarPorBoton(botonDe(rol), cedula, claveNueva);
    ok(await esperar("location.pathname === '/app/inicio.html'", 8000), `${rotulo}: la nueva entra`);
    await salir();
  }

  console.log('\n[4] La transición, «Otros usuarios» y lo que no cambia');
  await entrarPorBoton('lider', '1055000004', '1055000004');                    // Diego: escribe su cédula completa (su contraseña de hoy)
  ok(await esperar("document.getElementById('capa-clave-celular')", 8000), 'un líder que escribe su contraseña de hoy (la cédula completa) entra una vez y ve la pregunta');
  const aviso = await texto('.aviso-clave-anterior');
  ok(aviso === 'Desde ahora su clave del celular son los últimos 6 dígitos de su cédula, o la que usted elija.', 'con la explicación «Desde ahora su clave del celular son los últimos 6 dígitos de su cédula, o la que usted elija.»', aviso);
  await foto('8-transicion-contrasena-de-hoy-390x844');
  await tocar('#clave-btn-dejar'); await esperar("!document.getElementById('capa-clave-celular')");
  await salir();
  await entrarPorBoton('lider', '1055000004', '1055000004');
  await esperar("document.getElementById('login-error').classList.contains('visible')", 6000);
  ok((await mostradoError()) === 'Cédula o clave incorrecta.', 'contestada la pregunta, la contraseña de hoy ya no sirve por el botón');
  // Administración por «Otros usuarios» (correo y contraseña): sin cambios.
  await ir('/login.html');
  await esperar("document.getElementById('form-elegir-acceso').style.display === 'block'");
  await ev("document.getElementById('ir-a-otros-desde-eleccion').click()");
  await ev("document.getElementById('ir-a-password').click()");
  await escribir('#campo-email', 'admin.ej@ejemplo.co'); await escribir('#campo-password', CLAVE_ADMIN);
  await ev("document.querySelector('#form-login button[type=submit]').click()");
  ok(await esperar("location.pathname === '/app/admin-panel.html'", 10000), '«Otros usuarios» (el administrador por correo y contraseña) sigue entrando a su panel', await donde());
  await ir('/app/cambiar-clave.html', 1500);
  ok(/no tiene clave del celular/.test(await texto('#formulario')), 'el administrador abriendo «Cambiar mi clave» a mano: «Esta cuenta no tiene clave del celular»');
  ok(!(await hayPregunta()), 'y a él nunca se le hace la pregunta de la clave');

  console.log('\n[5] La consola');
  ok(p.avisos.length === 0, 'ninguna excepción de JavaScript en toda la prueba', p.avisos);
  const raros = p.respuestas.filter((r) => r.status >= 400 && !/\/api\/auth\/(me|login-celular|login|logout)\b/.test(r.url) && !/favicon/.test(r.url)
    && !/\/api\/(inscripcion|dia-d|push)\b/.test(r.url)   // rutas que el servidor de pruebas no monta
    && !(r.status === 400 && /\/api\/auth\/cambiar-clave-celular$/.test(r.url)));   // los rechazos que la propia prueba provoca (clave actual mala)
  ok(raros.length === 0, 'ninguna respuesta de error inesperada', raros);

  nav.cerrar(); servidor.close();
  console.log(`\n${fallos ? 'FALLAS: ' + fallos : 'TODO BIEN'} (${pasos} comprobaciones). Capturas en ${SALIDA}`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
