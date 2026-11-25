#!/usr/bin/env node
// scripts/probar-aviso-tareas-inicio.js — orden 122: EL AVISO «TAREAS PROGRAMADAS» EN EL INICIO DEL CELULAR, ANTES DE LA META DE VOTANTES.
//
// Chromium REAL, service worker ENCENDIDO, 390×844 y 360×740:
//   · Inicio del candidato y Panel del superadministrador: la tarjeta va ARRIBA de la meta de votantes / de las cifras; la tarjeta vieja (orden 116) y la de la orden 120 ya no están;
//   · hasta 3 renglones, las vencidas primero (la más vieja arriba) y luego la fecha más cercana; vencida (rojo) / hoy y mañana (amarillo) / a tiempo (azul) con sus textos;
//   · «Ver todas (N)» y el toque en un renglón abren lo correcto (la tarea queda abierta); sin tareas pendientes la tarjeta NO se oculta («Sin tareas pendientes» + «＋ Nueva tarea»);
//   · letra: título 15 px, lo demás 13 px como mínimo; renglones del mismo alto; sin desborde;
//   · administrador sin la casilla, coordinador y líder no ven nada ni su espacio, y la API da 403; sin señal se muestra la última copia con «Actualizado hace…»;
//   · la API de resumen trae las 3 tareas con título, responsable, fecha y estado.
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada122 node scripts/probar-aviso-tareas-inicio.js
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) { console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`); process.exit(2); }
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';
process.env.SMS_PROVIDER = 'none';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const pool = require('../config/db');
const T = require('../lib/tareasDireccion');
const R = require('../public/js/tareas-direccion-reglas.js');
const { lanzar, espera } = require('./capturas/navegador');
const { crear: crearServidor } = require('./capturas/servidor');

const RAIZ = path.join(__dirname, '..');
const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden122');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 900) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];
const VERSION_SW = /CACHE_NAME = '([^']+)'/.exec(fs.readFileSync(path.join(RAIZ, 'public/service-worker.js'), 'utf8'))[1];
const D = R.enColombia(new Date()).hoy;
const dia = (n) => R.sumarDias(D, n);
const en = (d, hh = 8) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd, hh + 5, 0)); };

(async () => {
  await q("DELETE FROM tareas_direccion WHERE titulo LIKE 'PRUEBA122%'");
  await q("DELETE FROM usuarios WHERE numero_identificacion BETWEEN '7220101' AND '7220199' AND es_superadmin = 0");
  const rolId = async (n) => (await q('SELECT id FROM roles WHERE nombre = ?', [n]))[0].id;
  let ced = 7220100;
  const usuario = async (nombre, rol, extra = {}) => {
    ced++;
    const [r] = await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, password_hash, rol_id, activo, es_candidato) VALUES (?, ?, ?, ?, 'x', ?, 1, ?)`,
      [nombre, String(ced), String(ced), `p${ced}@ejemplo.co`, await rolId(rol), extra.es_candidato ? 1 : 0]);
    return r.insertId;
  };
  const sup = (await q('SELECT id FROM usuarios WHERE es_superadmin = 1 LIMIT 1'))[0];
  const ids = {
    super: sup.id, cand: await usuario('Candidato Prueba', 'candidato'),
    admSin: await usuario('Admin Sin Casilla', 'admin'), coord: await usuario('Coordinadora', 'coordinador'), lider: await usuario('Lider', 'lider'),
  };
  // Cinco tareas (el aviso trae solo las 3 primeras): vencida hace 5, vencida hace 1, hoy, mañana, en 5 días. El primer título es larguísimo (tiene que cortarse con «…»).
  const nueva = async (titulo, limite) => {
    const r = await T.crear({ titulo: 'PRUEBA122 ' + titulo, responsable_tipo: 'candidato', responsable_ref_id: ids.cand, fecha_limite: limite, prioridad: 'normal', aviso_activo: false }, ids.cand, { ahora: en(dia(-10)) });
    if (!r.tarea) throw new Error('No se pudo sembrar: ' + JSON.stringify(r));
    return r.tarea.id;
  };
  const t = {};
  t.v5 = await nueva('Presentar ante el Consejo Nacional Electoral los informes de ingresos y gastos de la campaña con todos sus soportes', dia(-5));
  t.v1 = await nueva('vencida de ayer', dia(-1));
  t.hoy = await nueva('vence hoy', dia(0));
  t.man = await nueva('vence mañana', dia(1));
  t.f5 = await nueva('vence en cinco días', dia(5));

  const estaticos = express.static(path.join(RAIZ, 'public'), { maxAge: '10m' });
  const externo = express();
  externo.use((req, res, next) => estaticos(req, res, next));
  externo.use(crearServidor(pool, { soloLecturaCandidato: true }));
  const servidor = http.createServer(externo);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const navegador = await lanzar();
  try {
    const p = await navegador.pagina('about:blank');
    await p.cmd('Network.setBypassServiceWorker', { bypass: false });   // SERVICE WORKER ENCENDIDO
    // «Sin señal»: se corta donde la app lo nota (fetch falla como sin red); la bandera vive en localStorage para sobrevivir a las recargas.
    await p.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; const ce = console.error; console.error = function () { window.__errs.push([].slice.call(arguments).join(' ')); ce.apply(console, arguments); }; window.addEventListener('error', (e) => window.__errs.push('EXC ' + e.message));
      const f = window.fetch.bind(window); window.fetch = (...a) => { let off = false; try { off = localStorage.getItem('__sinSenal') === '1'; } catch (e) {} return off ? Promise.reject(new TypeError('Failed to fetch')) : f(...a); };` });
    const vista = (w, h) => p.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    const entrarComo = async (id) => { await p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(id), url: base }); };
    const ir = async (ruta, ms = 2600) => { await p.cmd('Page.navigate', { url: base + ruta }); await espera(ms); };
    const ev = (x) => p.ev(x);
    const foto = async (nombre) => { const r = await p.cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r.result.data, 'base64')); console.log('  captura: ' + path.join(SALIDA, nombre + '.png')); };
    const existe = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
    const visible = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return !e.hidden && s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; })()`);
    const texto = (sel) => ev(`((document.querySelector(${JSON.stringify(sel)}) || {}).textContent || '').replace(/\\s+/g, ' ').trim()`);
    const clic = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
    const llamar = (r) => ev(`fetch(${JSON.stringify(r)}).then((x) => x.status)`);
    const sinDesborde = () => ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
    const sinSenal = (off) => ev(`localStorage.setItem('__sinSenal', ${off ? "'1'" : "'0'"})`);
    const arriba = (a, b) => ev(`(() => { const x = document.querySelector(${JSON.stringify(a)}), y = document.querySelector(${JSON.stringify(b)}); return !!x && !!y && x.getBoundingClientRect().top < y.getBoundingClientRect().top; })()`);
    const filas = () => ev(`[...document.querySelectorAll('#tareas-aviso .tav-fila')].map((f) => ({ t: f.querySelector('.tav-t').textContent, r: f.querySelector('.tav-r').textContent, v: f.querySelector('.tav-venc').textContent.trim().replace(/\\u00a0/g, ' '), c: f.querySelector('.tav-hoja').className.replace('tav-hoja ', ''), dia: f.querySelector('.tav-hoja b').textContent, mes: f.querySelector('.tav-hoja small').textContent, href: f.getAttribute('href'), alto: Math.round(f.getBoundingClientRect().height) }))`);
    // Letra y geometría: título 15 px, todo lo demás ≥ 13 px; nada se sale de la tarjeta.
    const medidas = () => ev(`(() => {
      const c = document.getElementById('tareas-aviso'); const cr = c.getBoundingClientRect(); const r = { menores: [], fuera: [], titulo: null, hoja: null };
      const t = c.querySelector('.tav-t'); if (t) r.titulo = getComputedStyle(t).fontSize;
      const h = c.querySelector('.tav-hoja'); if (h) { const b = h.getBoundingClientRect(); r.hoja = Math.round(b.width) + 'x' + Math.round(b.height); }
      c.querySelectorAll('*').forEach((e) => { const tieneTexto = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); if (tieneTexto && parseFloat(getComputedStyle(e).fontSize) < 13) r.menores.push(e.className + ' ' + getComputedStyle(e).fontSize);
        const b = e.getBoundingClientRect(); if (b.width && (b.right > cr.right + 0.5 || b.left < cr.left - 0.5)) r.fuera.push(e.className); });
      // El encabezado (📋 título, globo y «Ver todas») no se pisa: ningún hijo del título se cruza con «Ver todas».
      const td = c.querySelector('.tav-todas'); if (td) { const a = td.getBoundingClientRect(); r.pisa = [...c.querySelectorAll('.tav-tit, .tav-tit *')].some((e) => { const b = e.getBoundingClientRect(); return b.width && b.left < a.right && b.right > a.left && b.top < a.bottom && b.bottom > a.top; }); }
      return r; })()`);

    // ---------------------------------------------------------------------------------------------------------------------------------
    for (const [w, h] of [[390, 844], [360, 740]]) {
      console.log(`\n[1] Inicio del candidato (${w}×${h}, service worker encendido): tarjeta ARRIBA de la meta, tres renglones ordenados`);
      await vista(w, h); await entrarComo(ids.cand);
      await ir('/app/candidato.html', 3200);
      ok(await visible('#tareas-aviso') && /Tareas programadas/.test(await texto('#tareas-aviso')), 'sale «Tareas programadas»');
      ok(await arriba('#tareas-aviso', '#card-meta'), 'el top de la tarjeta de tareas es MENOR que el de la meta de votantes');
      ok(!(await existe('#tareas-dir')) && !(await existe('#tarjeta-tareas')), 'ya no existe la tarjeta pequeña «Tareas: N vencidas…» de la orden 116');
      ok(await ev(`document.getElementById('tareas-aviso').classList.contains('sube') && !document.getElementById('card-meta').classList.contains('sube')`), 'la de tareas es la que se monta sobre el encabezado azul y la meta baja un puesto');
      const f = await filas();
      ok(f.length === 3, 'hasta 3 renglones', f.length);
      ok(/^PRUEBA122 Presentar ante el Consejo/.test(f[0] && f[0].t) && f[0].v === 'Vencida hace 5 días' && f[0].c === 'rojo', 'primero la vencida más vieja: «Vencida hace 5 días», hoja roja', f[0]);
      ok(/vencida de ayer/.test(f[1] && f[1].t) && f[1].v === 'Vencida hace 1 día' && f[1].c === 'rojo', 'luego «Vencida hace 1 día» (singular)', f[1]);
      ok(/vence hoy/.test(f[2] && f[2].t) && f[2].v === 'Vence hoy' && f[2].c === 'amarillo', 'luego la de hoy: «Vence hoy», hoja amarilla', f[2]);
      ok(f.every((x) => x.r === 'Candidato · Candidato Prueba' || /·.*Candidato Prueba/.test(x.r)), 'cada renglón dice «Cargo · Nombre» del responsable', f.map((x) => x.r));
      ok(f.every((x) => x.alto === f[0].alto), 'todos los renglones del mismo alto', f.map((x) => x.alto));
      ok(f[0].dia === String(Number(dia(-5).slice(8))) && f[0].mes === ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'][Number(dia(-5).slice(5, 7)) - 1], 'la hoja de calendario trae día y mes de la fecha límite', f[0]);
      ok(/Ver todas \(5\)/.test(await texto('#tareas-aviso .tav-todas')) && (await texto('#tareas-aviso .tav-globo')) === '2', '«Ver todas (5)» y el globo rojo con las 2 vencidas');
      const m = await medidas();
      ok(m.titulo === '15px' && m.menores.length === 0 && m.fuera.length === 0 && !m.pisa && m.hoja === '40x46', 'título 15 px, nada menor de 13 px, nada fuera de la tarjeta, hoja de 40×46', m);
      ok(await ev(`(() => { const t = document.querySelector('#tareas-aviso .tav-t'); return t.scrollWidth > t.clientWidth && getComputedStyle(t).textOverflow === 'ellipsis' && t.getBoundingClientRect().height < 24; })()`), 'el título largo se corta en UNA línea con «…»');
      ok(await sinDesborde(), 'sin desborde horizontal');
      await foto(`inicio-candidato-${w}-con-tareas`);

      // Con la tarea de «hoy» y «mañana» y «en 5 días»: amarillo, amarillo, azul
      await q('UPDATE tareas_direccion SET estado = ? WHERE id IN (?, ?)', ['hecha', t.v5, t.v1]);
      await ir('/app/candidato.html', 3000);
      const g = await filas();
      ok(g.length === 3 && g[0].v === 'Vence hoy' && g[0].c === 'amarillo' && g[1].v === 'Vence mañana' && g[1].c === 'amarillo' && g[2].v === 'Vence en 5 días' && g[2].c === 'azul', 'sin vencidas: «Vence hoy» y «Vence mañana» (amarillo) y «Vence en 5 días» (azul)', g);
      ok(!(await visible('#tareas-aviso .tav-globo')) && /Ver todas \(3\)/.test(await texto('#tareas-aviso')), 'sin vencidas no hay globo rojo; «Ver todas (3)»');
      const m2 = await medidas();
      ok(m2.menores.length === 0 && m2.fuera.length === 0 && await sinDesborde(), 'sin desbordes ni letra pequeña', m2);
      ok(await ev(`getComputedStyle(document.querySelector('#tareas-aviso .tav-venc.amarillo')).color === 'rgb(8, 66, 152)'`), 'el amarillo lleva texto azul oscuro');
      await foto(`inicio-candidato-${w}-sin-vencidas`);
      await q('UPDATE tareas_direccion SET estado = ? WHERE id IN (?, ?)', ['pendiente', t.v5, t.v1]);

      // Toques
      await ir('/app/candidato.html', 3000);
      await clic('#tareas-aviso .tav-todas'); await espera(2500);
      ok(/^\/app\/candidato-tareas\.html$/.test(await ev('location.pathname + location.search')) && await existe('.tdm-tabs') && !(await existe('.tdm-pantalla.abierta')), '«Ver todas» abre la pantalla de tareas (la lista)');
      await ir('/app/candidato.html', 3000);
      await ev(`document.querySelectorAll('#tareas-aviso .tav-fila')[1].click()`); await espera(3200);
      ok(/^\/app\/candidato-tareas\.html$/.test(await ev('location.pathname + location.search')) && await existe('.tdm-pantalla.abierta'), 'un renglón abre esa tarea, ya abierta, en la pantalla de tareas', await ev('location.pathname + location.search'));
      ok(/vencida de ayer/.test(await texto('#pant-tarea .cab h2')), 'y es LA tarea que se tocó', await texto('#pant-tarea .cab h2'));
      ok((await ev('window.__errs.slice()')).length === 0, 'cero errores de consola', await ev('window.__errs.slice()'));
    }

    // ---------------------------------------------------------------------------------------------------------------------------------
    console.log('\n[2] Sin tareas pendientes: la tarjeta NO se oculta');
    await vista(390, 844);
    await q("UPDATE tareas_direccion SET estado = 'hecha' WHERE titulo LIKE 'PRUEBA122%'");
    await entrarComo(ids.cand); await ir('/app/candidato.html', 3200);
    ok(await visible('#tareas-aviso') && /^📋 Tareas programadas\s*Sin tareas pendientes\s*＋ Nueva tarea$/.test(await texto('#tareas-aviso')), 'una sola línea «Sin tareas pendientes» con «＋ Nueva tarea»', await texto('#tareas-aviso'));
    ok(await arriba('#tareas-aviso', '#card-meta') && !(await visible('#tareas-aviso .tav-todas')) && !(await visible('#tareas-aviso .tav-globo')), 'sigue arriba de la meta, sin «Ver todas» ni globo');
    await foto('inicio-candidato-390-sin-tareas');
    await clic('#tareas-aviso .tav-vacio a'); await espera(3000);
    ok(/candidato-tareas\.html$/.test(await ev('location.pathname')) && await existe('#pant-form.abierta'), '«＋ Nueva tarea» abre el formulario de una tarea nueva');
    await q("UPDATE tareas_direccion SET estado = 'pendiente' WHERE titulo LIKE 'PRUEBA122%'");

    // ---------------------------------------------------------------------------------------------------------------------------------
    for (const [w, h] of [[390, 844], [360, 740]]) {
      console.log(`\n[3] Panel del celular del superadministrador (${w}×${h}): tarjeta ARRIBA de las cifras`);
      await vista(w, h); await entrarComo(ids.super);
      await ir('/app/admin-panel.html', 3200);
      ok(await visible('#tareas-aviso') && /Tareas programadas/.test(await texto('#tareas-aviso')), 'sale «Tareas programadas»');
      ok(await arriba('#tareas-aviso', '#cifras'), 'el top de la tarjeta de tareas es MENOR que el de las cifras');
      ok(!(await existe('#tarjeta-tareas')), 'ya no está la tarjeta «Tareas de dirección» de la orden 120 bajo las cifras');
      const f = await filas();
      ok(f.length === 3 && f[0].v === 'Vencida hace 5 días' && f[1].v === 'Vencida hace 1 día' && f[2].v === 'Vence hoy' && f.every((x) => x.alto === f[0].alto), 'tres renglones ordenados y del mismo alto', f);
      ok(f.every((x) => /volver=%2Fapp%2Fadmin-panel\.html/.test(x.href)) && /volver=/.test(await ev(`document.querySelector('#tareas-aviso .tav-todas').getAttribute('href')`)), 'los enlaces llevan «volver» al Panel');
      const m = await medidas();
      ok(m.titulo === '15px' && m.menores.length === 0 && m.fuera.length === 0 && !m.pisa && await sinDesborde(), 'letra, sin desbordes y el encabezado no se pisa', m);
      if (w === 390) await foto('panel-superadmin-390');
      else await foto('panel-superadmin-360');
      await ev(`document.querySelectorAll('#tareas-aviso .tav-fila')[2].click()`); await espera(3200);
      ok(/candidato-tareas\.html/.test(await ev('location.pathname')) && await existe('.tdm-pantalla.abierta') && /vence hoy/.test(await texto('#pant-tarea .cab h2')) && await visible('#nav-admin'), 'un renglón abre esa tarea con la barra del administrador');
      await clic('[data-cerrar="pant-tarea"]'); await espera(500);
      await clic('#app-barra .volver'); await espera(2500);
      ok(/^\/app\/admin-panel\.html/.test(await ev('location.pathname')), '«volver» regresa al Panel', await ev('location.pathname'));
    }

    // ---------------------------------------------------------------------------------------------------------------------------------
    console.log('\n[4] Sin permiso: ni tarjeta ni espacio, y la API da 403');
    await vista(390, 844);
    await entrarComo(ids.admSin); await ir('/app/admin-panel.html', 3000);
    ok(!(await visible('#tareas-aviso')) && await ev(`document.getElementById('tareas-aviso').getBoundingClientRect().height === 0 && document.getElementById('tareas-aviso').innerHTML === ''`), 'administrador SIN la casilla: ni la tarjeta ni el espacio (ni siquiera contenido oculto)');
    ok(await llamar('/api/tareas-direccion/resumen') === 403, 'y la API le responde 403');
    for (const [nombre, id] of [['coordinador', ids.coord], ['líder', ids.lider]]) {
      await entrarComo(id); await ir('/app/inicio.html', 2500);
      ok(!(await existe('#tareas-aviso')) && await llamar('/api/tareas-direccion/resumen') === 403, `${nombre}: sin tarjeta y la API responde 403`);
    }

    // ---------------------------------------------------------------------------------------------------------------------------------
    console.log('\n[5] Sin señal: la última copia, con «Actualizado hace…»');
    await entrarComo(ids.cand); await ir('/app/candidato.html', 3200);
    await ir('/app/candidato.html', 2500);   // segunda carga: el service worker ya controla la página
    // Sin señal DENTRO de la pantalla ya abierta (el servidor de pruebas no guarda la identidad sin conexión que sí guarda el inicio de sesión real): el botón ⟳ vuelve a pedirlo.
    await sinSenal(true); await clic('#btn-refrescar'); await espera(2500);
    const off = await ev(`(() => { const a = document.getElementById('tareas-aviso'); if (!a) return { nulo: true, ruta: location.pathname, cuerpo: document.body.innerText.slice(0, 200) }; return {  vis: !document.getElementById('tareas-aviso').hidden, t: document.getElementById('tareas-aviso').textContent.replace(/\\s+/g, ' ').trim(), n: document.querySelectorAll('#tareas-aviso .tav-fila').length, copia: !!document.querySelector('#tareas-aviso .tav-copia') }; })()`);
    ok(off.vis && off.n === 3 && off.copia && /Actualizado hace/.test(off.t), 'sin señal se muestra lo último guardado con «Actualizado hace…»', off);
    await foto('inicio-candidato-390-sin-senal');
    await ev(`localStorage.removeItem(${JSON.stringify('cand_copia:' + ids.cand + ':/tareas-direccion/resumen')})`);
    await clic('#btn-refrescar'); await espera(2500);
    ok(!(await visible('#tareas-aviso')), 'sin señal y sin copia no sale nada');
    await sinSenal(false);

    // ---------------------------------------------------------------------------------------------------------------------------------
    console.log('\n[6] La API de resumen y el service worker');
    const r1 = await ev(`fetch('/api/tareas-direccion/resumen').then((x) => x.json())`);
    ok(r1.tareas.length === 3 && r1.sin_realizar === 5 && r1.vencidas === 2 && r1.vencen_en_3_dias === 2
      && r1.tareas.every((x) => x.id && x.titulo && x.responsable && x.responsable.nombre === 'Candidato Prueba' && x.responsable.cargo && x.fecha_limite && x.estado && x.estado_fecha), 'el resumen trae 3 tareas con título, responsable, fecha y estado (más los contadores de siempre)', r1);
    ok(r1.tareas.map((x) => x.estado_fecha).join() === 'vencida,vencida,hoy', 'en el orden pedido', r1.tareas.map((x) => x.estado_fecha));
    await ir('/app/candidato.html', 3000); await ir('/app/candidato.html', 2500);
    const sw = await ev(`(async () => { const rs = await navigator.serviceWorker.getRegistrations(); const ks = await caches.keys(); const c = await caches.open(ks[0] || 'x'); const a = await c.match('/app/tareas-aviso.js'); const b = await c.match('/app/candidato.html'); return { controlado: !!navigator.serviceWorker.controller, caches: ks, js: !!a, html: b ? (await b.text()).indexOf('tareas-aviso') >= 0 : false, activo: rs.some((r) => !!r.active) }; })()`);
    ok(sw.controlado && sw.activo && sw.caches.join() === VERSION_SW && sw.js && sw.html, `service worker activo, caché ${VERSION_SW}, con el aviso y la pantalla nueva guardados`, sw);
    const errs = await ev('window.__errs.slice()');
    ok(errs.length === 0, 'sin errores de consola ni excepciones en la última pantalla', errs);
  } finally {
    navegador.cerrar(); servidor.close();
    await q("DELETE FROM tareas_direccion WHERE titulo LIKE 'PRUEBA122%'");
    await q("DELETE FROM usuarios WHERE numero_identificacion BETWEEN '7220101' AND '7220199' AND es_superadmin = 0");
    await pool.end();
  }
  console.log(fallos ? `\nFALLÓ: ${fallos} de ${pasos} comprobaciones.` : `\nTODO BIEN: ${pasos} de ${pasos} comprobaciones.`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
