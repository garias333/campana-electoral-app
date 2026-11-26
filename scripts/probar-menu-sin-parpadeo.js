#!/usr/bin/env node
// scripts/probar-menu-sin-parpadeo.js
//
// Prueba, en un Chromium REAL, de LA BARRA LATERAL SIN PARPADEO (orden 130):
//   · la barra se pinta en el PRIMER fotograma con contenido, con la copia guardada de la vez anterior;
//   · el contenido (`main`) NO se corre de lado en ningún fotograma (ni con la primera carga, sin copia: el hueco de style.css);
//   · la barra no se reemplaza ni se reescribe cuando el menú real es igual al de la copia;
//   · no se ve una sección que no corresponde (Configuración#usuarios no enseña «Datos de la campaña»; Día D#alertas no enseña los reportes; el contenido
//     de política no enseña la tarjeta de texto);
//   · cada rol ve SU menú, también en el primer fotograma; cambiar de usuario en el mismo navegador deja el menú del nuevo;
//   · quitar un permiso quita el ítem tras la respuesta del servidor y deja la copia al día;
//   · cerrar sesión (y entrar de nuevo) borra la copia; sin localStorage la página sigue funcionando;
//   · el celular (390 px) conserva su menú plegable y no reserva hueco; el mapa del Panel general sigue funcionando con Leaflet cargado después.
//
// USO (sobre una base desechable ya inicializada con init-db; hace falta Chromium, ver scripts/capturas/navegador.js):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada130 node scripts/probar-menu-sin-parpadeo.js
//
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
delete process.env.MAPBOX_ACCESS_TOKEN;

const http = require('http');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const C = require('../lib/complementos');
const { lanzar, espera } = require('./capturas/navegador');
const { crear } = require('./capturas/servidor');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }
const sello = String(Date.now()).slice(-7);
let n = 0;
async function persona(nombre, rol) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, `94${sello}${n}`, `u94${sello}${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  return r.insertId;
}

// Lo que corre DENTRO de la página desde el primer instante: graba, fotograma a fotograma, dónde está `main`, si hay barra y qué secciones se ven.
const GRABADORA = `(function () {
  if (window.top !== window) return;
  var rec = window.__rec = { frames: [], asideAdds: 0, navMut: 0, t0: performance.now(), menuPrimero: undefined };
  var SEC = ['seccion-campana','seccion-diad','seccion-usuarios','seccion-permisos','seccion-complementos','seccion-eliminar','seccion-recordatorios','seccion-backup',
    'vista-reportes','vista-alertas','vista-resultados','vista-transporte','vista-logistica','card-vista','bio-vista','politica-vista','celda-eventos','celda-balance','panel-proximos-eventos'];
  new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      m.addedNodes.forEach(function (x) { if (x.nodeName === 'ASIDE') { rec.asideAdds++; if (rec.tAside === undefined) rec.tAside = performance.now(); } });
      if (m.type === 'childList' && m.target.nodeName === 'NAV' && m.target.parentNode && m.target.parentNode.className === 'sidebar') { rec.navMut++; rec.navMutInfo = { add: m.addedNodes.length, rem: m.removedNodes.length }; }
    });
  }).observe(document, { childList: true, subtree: true });
  function tick() {
    var m = document.querySelector('.main');
    if (m) {
      var sb = document.querySelector('.sidebar');
      var r = m.getBoundingClientRect();
      var vis = [];
      SEC.forEach(function (id) { var e = document.getElementById(id); if (e) { var cs = getComputedStyle(e); if (cs.display !== 'none' && cs.visibility !== 'hidden') vis.push(id); } });
      if (sb && rec.menuPrimero === undefined) rec.tBarra = performance.now();
      if (sb && rec.menuPrimero === undefined) rec.menuPrimero = Array.prototype.map.call(sb.querySelectorAll('nav a[data-nav-href]'), function (a) { return a.dataset.navHref; }).join('|');
      rec.frames.push({ t: Math.round(performance.now() - rec.t0), sb: !!sb, ml: Math.round(r.left), mw: Math.round(r.width), vis: vis });
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();`;

const PAGINAS_PANEL = ['dashboard', 'votantes', 'votantes-dashboard', 'territorial', 'organigrama', 'mapa', 'testigos', 'dia-d', 'configuracion', 'agenda', 'eventos',
  'asistentes-reuniones', 'finanzas', 'crm', 'enviar-email', 'enviar-sms', 'enviar-push', 'configurar-crm', 'no-contactar', 'recursos', 'contenido', 'social', 'legislacion',
  'ayuda', 'solicitudes', 'tareas', 'puerta-listas', 'puerta-panel', 'tareas-direccion', 'reportes-puesto'];

(async () => {
  let servidor; let navegador;
  try {
    await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
    await q('UPDATE complementos_campana SET activo = 1'); C.invalidar();
    const [sup] = await q('SELECT id FROM usuarios WHERE es_superadmin = 1 LIMIT 1');
    if (!sup) throw new Error('la base de prueba no tiene superadministrador (¿corrió init-db?)');
    const superadmin = sup.id;
    const admin = await persona('Admin Ejemplo', 'admin');
    const coord = await persona('Coord Ejemplo', 'coordinador');
    console.log('BARRA LATERAL SIN PARPADEO — base «' + nombreBase + '»\n');

    const app = crear(pool);
    servidor = http.createServer(app);
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${servidor.address().port}`;
    navegador = await lanzar();
    const p = await navegador.pagina('about:blank');
    await p.cmd('Page.addScriptToEvaluateOnNewDocument', { source: GRABADORA });
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    // Un viaje de 200 ms a cada petición: las esperas de la sesión y los permisos duran lo suficiente para VER un parpadeo si lo hubiera.
    await p.cmd('Network.emulateNetworkConditions', { offline: false, latency: 200, downloadThroughput: -1, uploadThroughput: -1 });
    await p.cmd('Network.clearBrowserCookies');
    const entrarComo = (id) => p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(id), url: base });
    const rec = async () => JSON.parse(await p.ev('JSON.stringify(window.__rec || null)'));
    const ir = async (ruta, ms = 3800) => {
      // Por about:blank: un cambio de «#» en la misma página NO la recarga, y los fotogramas de la anterior se mezclarían con los de la nueva.
      await p.cmd('Page.navigate', { url: 'about:blank' }); await espera(150);
      await p.cmd('Page.navigate', { url: base + ruta }); await espera(ms); return rec();
    };
    /** ¿La barra estaba en pantalla ANTES de que el servidor respondiera /auth/me? (la propiedad que da la copia guardada) */
    const barraAntesDelServidor = async (r) => {
      const fin = await p.ev(`(performance.getEntriesByType('resource').find(e => e.name.indexOf('/api/auth/me') >= 0) || {}).responseEnd`);
      // Se mide al INSERTAR la barra (la microtarea del observador), no en el siguiente fotograma: un fotograma tardío no debe contar como barra tardía.
      return { ok: r.tAside !== undefined && fin !== undefined && r.tAside < fin, tAside: r.tAside && Math.round(r.tAside), tBarraFotograma: r.tBarra && Math.round(r.tBarra), meResponseEnd: fin && Math.round(fin) };
    };
    const menuFinal = () => p.ev(`Array.from(document.querySelectorAll('.sidebar nav a[data-nav-href]')).map(a => a.dataset.navHref).join('|')`);
    const claves = () => p.ev(`JSON.stringify(Object.keys(localStorage).filter(k => k.indexOf('menu-cache:') === 0))`).then(JSON.parse);
    const borrarLS = () => p.ev('localStorage.clear()');
    /** Resumen de lo que se VIO, fotograma a fotograma. */
    const resumen = (r) => {
      const f = r.frames;
      const ml = [...new Set(f.map((x) => x.ml))];
      const mw = [...new Set(f.map((x) => x.mw))];
      let aparecio = false; let desaparecio = false;
      f.forEach((x) => { if (x.sb) aparecio = true; else if (aparecio) desaparecio = true; });
      return { n: f.length, ml, mw, sbPrimero: f.length ? f[0].sb : null, desaparecio, vis: [...new Set(f.flatMap((x) => x.vis))] };
    };

    // ------------------------------------------------------------------ 1. PRIMERA CARGA (sin copia)
    console.log('1. Primera carga, sin copia: el hueco evita el salto');
    await entrarComo(admin);
    await ir('/login.html', 800); await borrarLS();
    let r = await ir('/dashboard.html');
    let s = resumen(r);
    ok(s.n > 20, 'se grabaron fotogramas', s.n);
    ok(s.ml.length === 1 && s.ml[0] === 248, 'main nace a 248 px (el hueco) y NO se mueve cuando llega la barra', s.ml);
    ok(s.mw.length === 1, 'main no cambia de ancho', s.mw);
    ok(s.sbPrimero === false && !s.desaparecio && r.frames[r.frames.length - 1].sb, 'sin copia la barra aparece (una vez) y se queda', { primero: s.sbPrimero, desaparecio: s.desaparecio });
    ok(r.asideAdds === 1, 'se inserta una sola barra', r.asideAdds);
    const guardadas = await claves();
    ok(guardadas.length === 2, 'quedan guardadas la copia y el «último usuario»', guardadas);
    const menuAdmin = await menuFinal();
    ok(menuAdmin.includes('/votantes.html') && menuAdmin.includes('/configuracion.html#usuarios'), 'el administrador ve su menú', menuAdmin.slice(0, 200));

    // ------------------------------------------------------------------ 2. NAVEGAR ENTRE SECCIONES (con copia)
    console.log('\n2. Navegar entre secciones con la copia guardada');
    const RUTAS = ['/dashboard.html', '/votantes.html', '/territorial.html', '/dia-d.html', '/configuracion.html#usuarios', '/agenda.html', '/finanzas.html'];
    for (const ruta of RUTAS) {
      r = await ir(ruta);
      s = resumen(r);
      const mf = await menuFinal();
      const ant = await barraAntesDelServidor(r);
      ok(ant.ok, `${ruta}: la barra ya está en pantalla ANTES de que responda el servidor (/auth/me)`, ant);
      ok(!s.desaparecio, `${ruta}: la barra no desaparece en ningún fotograma`);
      ok(s.ml.length === 1 && s.ml[0] === 248, `${ruta}: el contenido no salta de lado`, s.ml);
      ok(r.asideAdds === 1 && r.navMut === 0, `${ruta}: la barra no se reemplaza ni se reescribe (menú real = copia)`, { asideAdds: r.asideAdds, navMut: r.navMut });
      ok(r.menuPrimero === mf, `${ruta}: el menú del primer fotograma es el definitivo`);
      const activo = await p.ev(`(document.querySelector('.sidebar nav a.activo') || {}).textContent`);
      ok(!!activo, `${ruta}: hay un ítem activo`, activo);
    }

    // ------------------------------------------------------------------ 3. SECCIONES QUE NO CORRESPONDEN
    console.log('\n3. Secciones que no corresponden');
    r = await ir('/configuracion.html#usuarios'); s = resumen(r);
    ok(s.vis.length === 1 && s.vis[0] === 'seccion-usuarios', 'Configuración#usuarios: solo «Usuarios» (jamás «Datos de la campaña») en ningún fotograma', s.vis);
    r = await ir('/configuracion.html'); s = resumen(r);
    ok(s.vis.length === 1 && s.vis[0] === 'seccion-campana', 'Configuración sin ancla: «Datos de la campaña»', s.vis);
    r = await ir('/configuracion.html#diad'); s = resumen(r);
    ok(s.vis.length === 1 && s.vis[0] === 'seccion-diad', 'Configuración#diad: solo Día D', s.vis);
    r = await ir('/dia-d.html#alertas'); s = resumen(r);
    ok(s.vis.length === 1 && s.vis[0] === 'vista-alertas', 'Día D#alertas: solo Alertas (jamás los reportes de mesas)', s.vis);
    ok(await p.ev(`document.getElementById('pestana-alertas').classList.contains('btn-acento') && !document.getElementById('pestana-reportes').classList.contains('btn-acento')`), 'Día D#alertas: la pestaña activa es Alertas');
    r = await ir('/dia-d.html#resultados'); s = resumen(r);
    ok(s.vis.length === 1 && s.vis[0] === 'vista-resultados', 'Día D#resultados: solo Resultados', s.vis);
    r = await ir('/dia-d.html'); s = resumen(r);
    ok(s.vis.length === 1 && s.vis[0] === 'vista-reportes', 'Día D sin ancla: Reportes', s.vis);
    r = await ir('/contenido.html?clave=politica_privacidad'); s = resumen(r);
    ok(s.vis.length === 1 && s.vis[0] === 'politica-vista', 'Política de privacidad: solo su vista (no la tarjeta de texto)', s.vis);
    r = await ir('/contenido.html?clave=biografia_candidato'); s = resumen(r);
    ok(s.vis.length === 1 && s.vis[0] === 'bio-vista', 'Biografía: solo su vista', s.vis);
    r = await ir('/dashboard.html'); s = resumen(r);
    ok(s.vis.includes('celda-eventos') && s.vis.includes('celda-balance') && s.vis.includes('panel-proximos-eventos'), 'Panel general (administrador): eventos, balance y próximos eventos terminan a la vista', s.vis);
    const antesDeLlegar = r.frames[0].vis;
    ok(!antesDeLlegar.includes('celda-eventos') && !antesDeLlegar.includes('panel-proximos-eventos'), 'Panel general: no se ven antes de saber el rol (nacen ocultas)', antesDeLlegar);
    // la sección de configuración que pide el ancla se queda a la vista aunque el arranque falle (red de seguridad): se prueba rompiendo /api/permisos/mios
    await p.cmd('Network.setBlockedURLs', { urls: ['*/api/permisos/mios', '*/api/configuracion/campana'] });
    r = await ir('/configuracion.html#backup'); s = resumen(r);
    ok(s.vis.includes('seccion-backup'), 'Si el arranque falla a mitad, la sección pedida queda a la vista (no se queda en blanco)', s.vis);
    await p.cmd('Network.setBlockedURLs', { urls: [] });

    // ------------------------------------------------------------------ 4. ROLES Y CAMBIO DE USUARIO
    console.log('\n4. Cada rol, SU menú');
    await borrarLS();
    await entrarComo(superadmin); r = await ir('/dashboard.html'); const menuSuper = await menuFinal();
    r = await ir('/dashboard.html'); s = resumen(r);
    ok(r.menuPrimero === menuSuper, 'superadministrador: el primer fotograma ya trae SU menú',
      { primero: (r.menuPrimero || '').split('|').length, definitivo: menuSuper.split('|').length,
        soloPrimero: (r.menuPrimero || '').split('|').filter((x) => !menuSuper.split('|').includes(x)), soloDefinitivo: menuSuper.split('|').filter((x) => !(r.menuPrimero || '').split('|').includes(x)) });
    await borrarLS();
    await entrarComo(coord); r = await ir('/dashboard.html'); const menuCoord = await menuFinal();
    r = await ir('/dashboard.html');
    ok(r.menuPrimero === menuCoord, 'coordinador: el primer fotograma ya trae SU menú');
    ok(menuCoord !== menuAdmin && menuAdmin !== menuSuper, 'los tres menús son distintos', { s: menuSuper.length, a: menuAdmin.length, c: menuCoord.length });
    ok(!menuCoord.includes('/configuracion.html#usuarios'), 'el coordinador NO ve Usuarios');

    console.log('\n   Cambiar de usuario en el MISMO navegador, sin cerrar sesión (peor caso)');
    await borrarLS();
    await entrarComo(admin); await ir('/dashboard.html');
    await entrarComo(coord); r = await ir('/dashboard.html');
    ok((await menuFinal()) === menuCoord, 'el menú definitivo es el del coordinador, no el del administrador anterior');
    const kk = await claves();
    ok(kk.length === 2 && kk.some((k) => k.endsWith(':' + coord)) && !kk.some((k) => k.endsWith(':' + admin)), 'la copia del administrador se borró y quedó la del coordinador', kk);

    // ------------------------------------------------------------------ 5. QUITAR UN PERMISO
    console.log('\n5. Quitar un permiso a un usuario');
    await q("UPDATE permisos_rol SET permitido = 1 WHERE rol = 'coordinador' AND modulo = 'agenda'"); C.invalidar();
    await borrarLS(); await entrarComo(coord);
    await ir('/dashboard.html'); r = await ir('/dashboard.html');
    ok(r.menuPrimero.includes('/agenda.html'), 'con el permiso, «Agenda» está en el menú (y en la copia)');
    await q("UPDATE permisos_rol SET permitido = 0 WHERE rol = 'coordinador' AND modulo = 'agenda'"); C.invalidar();
    r = await ir('/dashboard.html');
    ok(r.menuPrimero.includes('/agenda.html'), 'sin recargar el permiso, el primer fotograma todavía trae «Agenda» (es la copia)');
    ok(!(await menuFinal()).includes('/agenda.html'), 'tras la respuesta del servidor «Agenda» desaparece');
    ok(r.navMut >= 1, 'y el menú se reemplazó una vez', { navMut: r.navMut, info: r.navMutInfo, asideAdds: r.asideAdds });
    const copia = await p.ev(`JSON.parse(localStorage.getItem(Object.keys(localStorage).filter(k => /:[0-9]+$/.test(k))[0])).nav`);
    ok(!copia.includes('/agenda.html'), 'la copia quedó al día (sin «Agenda»)');
    r = await ir('/dashboard.html');
    ok(!r.menuPrimero.includes('/agenda.html') && r.navMut === 0, 'la carga siguiente ya no la muestra ni un fotograma');
    await q("UPDATE permisos_rol SET permitido = 1 WHERE rol = 'coordinador' AND modulo = 'agenda'"); C.invalidar();

    // ------------------------------------------------------------------ 6. CERRAR SESIÓN
    console.log('\n6. Cerrar sesión y entrar con otro usuario');
    await entrarComo(admin); await borrarLS(); await ir('/dashboard.html'); await ir('/dashboard.html');
    ok((await claves()).length === 2, 'antes de cerrar hay copia');
    await p.cmd('Network.setBlockedURLs', { urls: ['*/api/auth/logout', '*/api/auth/cerrar-pendiente'] });   // el servidor de pruebas no tiene sesiones reales: se prueba el cierre «sin señal»
    await p.ev(`document.getElementById('btn-logout').click()`);
    await espera(6500);
    await p.cmd('Network.setBlockedURLs', { urls: [] });
    ok((await claves()).length === 0, 'al cerrar sesión se borran todas las copias de menú', await claves());
    ok((await p.ev('location.pathname')) === '/login.html', 'y se llega al inicio de sesión');
    await entrarComo(coord);
    await p.ev(`localStorage.removeItem('logout_pendiente')`);
    r = await ir('/dashboard.html'); s = resumen(r);
    ok(r.menuPrimero !== undefined && r.menuPrimero === menuCoord, 'el siguiente usuario NO ve ni un fotograma el menú del anterior: lo primero que ve es el suyo', { primero: (r.menuPrimero || '').length });
    ok(r.frames.every((f) => f.sb === false || true) && !(r.menuPrimero || '').includes('/configuracion.html#usuarios'), 'y no aparece «Usuarios» (del administrador anterior)');
    ok((await menuFinal()) === menuCoord, 'y termina con SU menú');
    // iniciar sesión también descarta copias ajenas
    await p.cmd('Network.clearBrowserCookies');     // con una sesión viva login.html te devuelve al panel y no llega a cargar cerrar-sesion.js
    await ir('/login.html', 1800);
    ok(await p.ev('!!window.CerrarSesion'), 'login.html carga cerrar-sesion.js');
    await p.ev(`localStorage.setItem('menu-cache:ajena:1', '{}'); window.CerrarSesion && window.CerrarSesion.guardarTokenCierre('t')`);
    ok((await claves()).length === 0, 'iniciar una sesión nueva (guardarTokenCierre) también borra las copias', await claves());
    // 401: sin sesión
    await entrarComo(admin); await ir('/dashboard.html');
    ok((await claves()).length === 2, 'hay copia otra vez');
    await p.cmd('Network.clearBrowserCookies');
    r = await ir('/dashboard.html', 4500);
    ok((await p.ev('location.pathname')) === '/login.html', 'sin sesión (401) se va al inicio de sesión');
    ok((await claves()).length === 0, 'y la copia se borró ANTES de irse', await claves());

    // ------------------------------------------------------------------ 7. SIN localStorage
    console.log('\n7. Sin localStorage la página funciona como antes');
    const p2 = await navegador.pagina('about:blank');
    await p2.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('bloqueado', 'SecurityError'); } });` });
    await p2.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await p2.cmd('Network.setCookie', { name: 'ej_usuario', value: String(admin), url: base });
    await p2.cmd('Page.navigate', { url: base + '/dashboard.html' }); await espera(4000);
    const items = await p2.ev(`document.querySelectorAll('.sidebar nav a[data-nav-href]').length`);
    ok(items > 10, 'la barra se arma igual sin almacenamiento', items);
    ok(!p2.avisos.some((a) => /EXC/.test(a) && /localStorage|SecurityError|bloqueado/.test(a)), 'sin excepciones por el almacenamiento', p2.avisos.slice(0, 3));
    p2.cerrar();

    // ------------------------------------------------------------------ 8. CELULAR
    console.log('\n8. Celular (390 px)');
    await entrarComo(admin); await ir('/dashboard.html');
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 2, mobile: true });
    for (const pag of ['/territorial.html', '/votantes.html', '/testigos.html', '/dashboard.html']) {
      r = await ir(pag, 3500);
      const m = JSON.parse(await p.ev(`JSON.stringify({
        sidebar: getComputedStyle(document.querySelector('.sidebar')).display,
        barra: getComputedStyle(document.querySelector('.menu-movil-barra')).display,
        hueco: getComputedStyle(document.getElementById('app-shell'), '::before').content,
        desborde: document.documentElement.scrollWidth > window.innerWidth + 1 })`));
      ok(m.sidebar === 'none' && m.barra === 'flex', `${pag}: el menú nace plegado detrás de «☰ Menú»`, m);
      ok(m.hueco === 'none' || m.hueco === 'normal', `${pag}: no reserva hueco en el celular`, m.hueco);
      ok(!m.desborde, `${pag}: sin desborde horizontal`);
    }
    await p.ev(`document.getElementById('menu-movil-btn').click()`); await espera(300);
    ok((await p.ev(`getComputedStyle(document.querySelector('.sidebar')).display`)) === 'flex', 'el botón «☰ Menú» abre la barra');
    await p.ev(`document.querySelector('.sidebar nav a[data-nav-href]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`).catch(() => {});
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

    // ------------------------------------------------------------------ 9. MAPA DEL PANEL GENERAL
    console.log('\n9. Mapa del Panel general con Leaflet cargado después');
    await entrarComo(admin); await borrarLS();
    r = await ir('/dashboard.html', 6000);
    const mapa = await p.ev(`JSON.stringify({ L: typeof window.L, contenedor: !!document.querySelector('#mapa-dashboard.leaflet-container'), teselas: document.querySelectorAll('#mapa-dashboard .leaflet-tile').length, bloque: getComputedStyle(document.getElementById('bloque-mapa-dashboard')).display })`);
    const mm = JSON.parse(mapa);
    ok(mm.L === 'object' && mm.contenedor && mm.bloque !== 'none', 'Leaflet cargó y el mapa se dibujó', mm);
    ok(!p.avisos.some((a) => /EXC/.test(a) && /Leaflet|\bL\b is not defined/.test(a)), 'sin excepciones de Leaflet', p.avisos.slice(0, 3));
    const hojas = await p.ev(`Array.from(document.styleSheets).filter(h => /leaflet/.test(h.href || '')).length`);
    ok(hojas >= 1, 'la hoja de Leaflet se aplicó (media=print → all)', hojas);
    ok(await p.ev(`document.querySelector('link[href*="leaflet.css"]').media === 'all'`), 'media de la hoja de Leaflet pasó a «all»');

    // ------------------------------------------------------------------ 10. RECORRIDO GENERAL
    console.log('\n10. Las páginas del panel: segunda carga con copia, sin errores');
    await entrarComo(admin); await ir('/dashboard.html');
    for (const pag of PAGINAS_PANEL) {
      const ruta = pag === 'contenido' ? '/contenido.html?clave=biografia_candidato' : `/${pag}.html`;
      p.avisos.length = 0;
      r = await ir(ruta, 3200); s = resumen(r);
      const ant = await barraAntesDelServidor(r);
      const bien = s.n > 10 && ant.ok && !s.desaparecio && s.ml.length === 1 && r.asideAdds === 1;
      ok(bien, `${pag}: barra antes de que responda el servidor, sin salto`, { n: s.n, ant, desaparecio: s.desaparecio, ml: s.ml, asideAdds: r.asideAdds, navMut: r.navMut });
      const exc = p.avisos.filter((a) => /^EXC/.test(a));
      ok(exc.length === 0, `${pag}: sin excepciones de JavaScript`, exc.slice(0, 2));
    }

    console.log('\n' + (fallos ? `FALLARON ${fallos}` : 'TODO BIEN'));
  } catch (e) {
    fallos++;
    console.error('ERROR DE LA PRUEBA:', e);
  } finally {
    try { if (navegador) navegador.cerrar(); } catch (_) { /* ya cerrado */ }
    try { if (servidor) servidor.close(); } catch (_) { /* ya cerrado */ }
    try { await pool.end(); } catch (_) { /* ya cerrado */ }
    process.exit(fallos ? 1 : 0);
  }
})();
