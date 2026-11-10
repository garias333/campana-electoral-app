#!/usr/bin/env node
// scripts/probar-mis-avisos.js
//
// Prueba de «MIS AVISOS» (parche 316): al tocar un aviso en la app se abre su mensaje COMPLETO, solo para su destinatario; y una campaña
// en la que nadie recibe nada se cierra en vez de quedarse en «Enviando…».
//   · El envío es el REAL (comunicaciones.routes.js → config/push.js); lo único simulado es la librería `web-push` (no sale a ningún proveedor):
//     la prueba captura lo que habría salido —carga y opciones—.
//   · El service worker REAL (public/service-worker.js) se carga en un entorno de pruebas y se le dispara el evento push y el toque.
//   · Un Chromium real abre /app/mis-avisos.html con la sesión de cada persona.
//
// USO (base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada316 node scripts/probar-mis-avisos.js
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
process.env.VAPID_PUBLIC_KEY = 'clave-publica-de-prueba';
process.env.VAPID_PRIVATE_KEY = 'clave-privada-de-prueba';

// `web-push` SIMULADO, antes de que config/push.js lo cargue. Captura carga y opciones; puede fallar a pedido.
const salidas = [];
let modo = 'ok';
const falso = { setVapidDetails() {}, sendNotification: async (sub, carga, opciones) => {
  salidas.push({ endpoint: sub.endpoint, carga: JSON.parse(carga), opciones });
  if (modo === 'tiempo') { const e = new Error('Request timed out'); e.code = 'ETIMEDOUT'; throw e; }
  return { statusCode: 201 };
} };
const rutaWebPush = require.resolve('web-push');
require.cache[rutaWebPush] = { id: rutaWebPush, filename: rutaWebPush, loaded: true, exports: falso, children: [], paths: [] };

const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { lanzar, espera } = require('./capturas/navegador');
const { crear } = require('./capturas/servidor');
const crm = require('../routes/comunicaciones.routes');

const RAIZ = path.join(__dirname, '..');
let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); }
}

(async () => {
  // Activar complementos (parche 318): los complementos nacen APAGADOS; esta prueba enciende los que necesita.
  await require('./fixtures/encender-complementos')(pool, ['alertas_dia_d']);
  let servidor; let navegador;
  try {
    /* ---------- 1. Estático ---------- */
    console.log('\n1. Estático');
    const sw = fs.readFileSync(path.join(RAIZ, 'public/service-worker.js'), 'utf8');
    ok(/CACHE_NAME = 'estrategia-v\d+'/.test(sw) && sw.includes("'/app/mis-avisos.html'"), 'service worker: caché versionada y /app/mis-avisos.html en la coraza');
    ok(fs.existsSync(path.join(RAIZ, 'public/app/mis-avisos.html')), 'existe public/app/mis-avisos.html');
    const inicio = fs.readFileSync(path.join(RAIZ, 'public/app/inicio.html'), 'utf8');
    ok((inicio.match(/href: '\/app\/mis-avisos\.html'/g) || []).length === 2, 'Inicio ofrece «Mis avisos» al líder (y, por herencia, al coordinador) y al administrador');
    ok(/URL_DE_LAS_ALERTAS = '\/app\/alertas-dia-d\.html'/.test(fs.readFileSync(path.join(RAIZ, 'lib/avisosAlertas.js'), 'utf8')), 'las alertas del Día D siguen apuntando a /app/alertas-dia-d.html');

    /* ---------- 2. Personas ---------- */
    const sufijo = String(Date.now()).slice(-6);
    const T = (k) => '31' + sufijo + '0' + k;
    const clave = bcrypt.hashSync('clave-ejemplo', 4);
    const [[admin]] = await pool.query("SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.nombre = 'admin' ORDER BY u.id LIMIT 1");
    await pool.query('UPDATE usuarios SET telefono = ?, activo = 1 WHERE id = ?', [T(1), admin.id]);
    const usuario = async (nombre, telefono) => {
      const [r] = await pool.query(
        `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo, telefono) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = 'lider'), 1, ?)`,
        [nombre, 'c' + sufijo + Math.floor(Math.random() * 1e4), 'u' + sufijo + Math.floor(Math.random() * 1e6), clave, telefono]);
      const [e] = await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, NULL, 1)', [r.insertId, 'lider']);
      return { id: r.insertId, est: e.insertId };
    };
    const dispositivo = (id) => pool.query('INSERT INTO push_suscripciones (usuario_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)', [id, `https://push.prueba/${id}/${sufijo}`, 'p', 'a']);
    await dispositivo(admin.id);
    const otro = await usuario('Otra Persona ' + sufijo, T(2)); await dispositivo(otro.id);
    const sinCuenta = (await pool.query('INSERT INTO votantes (nombre, telefono) VALUES (?, ?)', ['Votante Sin Cuenta ' + sufijo, T(3)]))[0].insertId;

    /* ---------- 3. Servidor ---------- */
    const app = crear(pool);
    servidor = http.createServer(app);
    await new Promise((res) => servidor.listen(0, '127.0.0.1', res));
    const base = `http://127.0.0.1:${servidor.address().port}`;
    const api = (metodo, ruta, cuerpo, como = admin.id) => new Promise((res, rej) => {
      const datos = cuerpo ? JSON.stringify(cuerpo) : null;
      const req = http.request(base + ruta, { method: metodo, headers: { Cookie: `ej_usuario=${como}`, 'Content-Type': 'application/json', ...(datos ? { 'Content-Length': Buffer.byteLength(datos) } : {}) } }, (r) => {
        let t = ''; r.on('data', (c) => { t += c; }); r.on('end', () => { try { res({ status: r.statusCode, cuerpo: JSON.parse(t) }); } catch (_) { res({ status: r.statusCode, cuerpo: t }); } });
      });
      req.on('error', rej); if (datos) req.write(datos); req.end();
    });
    const esperarCierre = async (campanaId) => {
      for (let i = 0; i < 60; i++) {
        const [[c]] = await pool.query('SELECT estado FROM comunicaciones_campanas WHERE id = ?', [campanaId]);
        if (c && c.estado !== 'enviando') return c.estado; await espera(300);
      }
      return 'enviando';
    };
    const enviar = async (seleccion, mensaje, asunto) => {
      const r = await api('POST', '/api/comunicaciones/campanas', { nombre: 'Prueba 316', canal: 'push', asunto, mensaje, filtros: { fuente: 'seleccion', seleccion } });
      const estado = r.status === 200 ? await esperarCierre(r.cuerpo.campana_id) : null;
      const [envios] = r.status === 200 ? await pool.query('SELECT * FROM comunicaciones_envios WHERE campana_id = ? ORDER BY id', [r.cuerpo.campana_id]) : [[]];
      return { r, estado, envios };
    };
    const manual = (t) => ({ tipo: 'manual', id: t, nombre: t, contacto: t });

    /* ---------- 4. El aviso lleva la dirección de su mensaje completo ---------- */
    console.log('\n4. Lo que sale hacia el teléfono');
    const LARGO = 'Reunión de coordinadores MAÑANA a las 7:00 a. m. en la sede. ' + 'Traer la lista de asistencia firmada, el informe de la semana y el formato de gastos. '.repeat(3) + 'FIN-DEL-MENSAJE-COMPLETO';
    salidas.length = 0;
    const A = await enviar([manual(T(1))], 'Hola {nombre}: ' + LARGO, 'Citación de coordinadores');
    const envioA = A.envios[0] || {};
    ok(A.r.status === 200 && envioA.estado === 'enviado' && A.estado === 'enviado', 'el aviso sale y la campaña se cierra «enviado»', { r: A.r.status, e: envioA.estado, c: A.estado });
    const s = salidas[0] || {};
    ok(s.carga && s.carga.url === `/app/mis-avisos.html?id=${envioA.id}`, 'la carga trae la url /app/mis-avisos.html?id=<fila>', s.carga);
    ok(s.carga && s.carga.tag === `aviso-${envioA.id}`, 'cada aviso lleva su propio tag (uno no reemplaza al otro en la bandeja del teléfono)', s.carga && s.carga.tag);
    ok(s.carga && s.carga.titulo === 'Citación de coordinadores', 'el título que escribió quien envía llega como título (antes se perdía y salía «Aviso de la campaña»)', s.carga && s.carga.titulo);
    ok(s.opciones && s.opciones.timeout === 20000, 'la petición al servicio de push lleva un tiempo máximo (20 s): ya no puede quedar colgada', s.opciones);
    ok(s.carga && /^Hola Administrador/.test(s.carga.cuerpo) && s.carga.cuerpo.endsWith('FIN-DEL-MENSAJE-COMPLETO'), 'el cuerpo de la notificación es el mensaje personalizado', s.carga && s.carga.cuerpo.slice(0, 40));
    salidas.length = 0;
    {
      const push = require('../config/push');
      await push.enviarAUsuario(admin.id, { titulo: 'Alertas del Día D', cuerpo: '2 alertas', url: '/app/alertas-dia-d.html' });
      await push.enviarAUsuario(admin.id, { titulo: 'Recordatorio', cuerpo: 'algo' });
      const alerta = (salidas.find((x) => x.carga.titulo === 'Alertas del Día D') || {}).carga || {};   // (un usuario puede tener varios dispositivos: una salida por cada uno)
      const recordatorio = (salidas.find((x) => x.carga.titulo === 'Recordatorio') || {}).carga || {};
      ok(alerta.url === '/app/alertas-dia-d.html' && alerta.tag === undefined, 'las alertas del Día D siguen llevando su propia url y no llevan tag nuevo', alerta);
      ok(recordatorio.url === '/app/inicio.html' && recordatorio.tag === undefined, 'un aviso sin url (recordatorios, tareas) sigue abriendo Inicio, igual que antes', recordatorio);
    }

    /* ---------- 5. El service worker REAL ---------- */
    console.log('\n5. Service worker: mostrar y tocar');
    {
      const manejadores = {}; const mostradas = []; const navegadas = []; let abiertas = [];
      let ventanas = [];
      const caja = {
        addEventListener: (t, f) => { manejadores[t] = f; },
        location: { origin: 'https://campana.prueba' },
        registration: { showNotification: (t, o) => { mostradas.push({ t, o }); return Promise.resolve(); } },
        clients: { matchAll: () => Promise.resolve(ventanas), openWindow: (u) => { abiertas.push(u); return Promise.resolve({}); }, claim: () => Promise.resolve() },
        skipWaiting: () => Promise.resolve(), caches: { open: () => Promise.resolve({ addAll() {}, put() {} }), keys: () => Promise.resolve([]), match: () => Promise.resolve(null), delete: () => Promise.resolve(true) },
        fetch: () => Promise.resolve({ ok: true, clone() { return this; } }), URL, Request, console,
      };
      caja.self = caja;
      vm.createContext(caja);
      vm.runInContext(sw, caja);
      const dispara = async (tipo, evento) => { const esperas = []; evento.waitUntil = (p) => esperas.push(p); manejadores[tipo](evento); await Promise.all(esperas); };
      await dispara('push', { data: { json: () => s.carga } });
      ok(mostradas[0] && mostradas[0].t === 'Citación de coordinadores' && mostradas[0].o.data.url === `/app/mis-avisos.html?id=${envioA.id}` && mostradas[0].o.tag === `aviso-${envioA.id}`, 'la notificación se muestra con su título, su tag y su url', mostradas[0]);
      // Tocar: con la app cerrada → abre la dirección del aviso.
      await dispara('notificationclick', { notification: { close() {}, data: mostradas[0].o.data } });
      ok(abiertas[0] === `/app/mis-avisos.html?id=${envioA.id}`, 'tocar con la app cerrada ABRE /app/mis-avisos.html?id=<fila> (antes abría Inicio)', abiertas);
      // Tocar: con una ventana ya abierta → se enfoca y se navega a esa dirección.
      ventanas = [{ focus() { return Promise.resolve({ navigate: (u) => { navegadas.push(u); return Promise.resolve(); } }); } }];
      await dispara('notificationclick', { notification: { close() {}, data: mostradas[0].o.data } });
      ok(navegadas[0] === `/app/mis-avisos.html?id=${envioA.id}`, 'tocar con la app abierta ENFOCA la ventana y la lleva a esa dirección', navegadas);
      // Las alertas del Día D (otra url) se respetan.
      await dispara('notificationclick', { notification: { close() {}, data: { url: '/app/alertas-dia-d.html' } } });
      ok(navegadas[1] === '/app/alertas-dia-d.html', 'tocar una alerta del Día D sigue llevando a /app/alertas-dia-d.html', navegadas);
    }

    /* ---------- 6. Mis avisos: quién lee qué ---------- */
    console.log('\n6. Rutas de «Mis avisos»');
    const mio = await api('GET', '/api/push/mis-avisos');
    const dentro = (mio.cuerpo.avisos || []).find((a) => a.id === envioA.id);
    ok(mio.status === 200 && dentro && dentro.titulo === 'Citación de coordinadores' && dentro.mensaje.endsWith('FIN-DEL-MENSAJE-COMPLETO') && /^Hola Administrador/.test(dentro.mensaje) && dentro.fecha, 'la bandeja del destinatario trae título, mensaje COMPLETO (personalizado) y fecha', dentro);
    const ajeno = await api('GET', '/api/push/mis-avisos', null, otro.id);
    ok(ajeno.status === 200 && Array.isArray(ajeno.cuerpo.avisos) && !ajeno.cuerpo.avisos.some((a) => a.id === envioA.id), 'otro usuario NO ve ese aviso en su bandeja');
    const uno = await api('GET', `/api/push/mis-avisos/${envioA.id}`);
    ok(uno.status === 200 && uno.cuerpo.mensaje.endsWith('FIN-DEL-MENSAJE-COMPLETO'), 'el destinatario abre su aviso por id');
    const robado = await api('GET', `/api/push/mis-avisos/${envioA.id}`, null, otro.id);
    ok(robado.status === 404 && !JSON.stringify(robado.cuerpo).includes('FIN-DEL-MENSAJE'), 'otro usuario que abre el mismo id recibe 404 y nada del mensaje', robado);
    const inexistente = await api('GET', '/api/push/mis-avisos/99999999');
    const raro = await api('GET', '/api/push/mis-avisos/abc');
    ok(inexistente.status === 404 && raro.status === 404 && JSON.stringify(inexistente.cuerpo) === JSON.stringify(robado.cuerpo), 'un id inexistente o inválido responde exactamente igual (no se revela de quién es)');
    const sinSesion = await new Promise((res) => http.get(base + '/api/push/mis-avisos', (r) => { r.resume(); res(r.statusCode); }));
    ok(sinSesion === 401 || sinSesion === 403, 'sin sesión no se lee nada', sinSesion);
    const cont = await api('GET', '/api/push/mis-avisos/contar?desde=0');
    const cont2 = await api('GET', `/api/push/mis-avisos/contar?desde=${envioA.id}`);
    const cont3 = await api('GET', '/api/push/mis-avisos/contar?desde=0', null, otro.id);
    ok(cont.cuerpo.nuevos >= 1 && cont.cuerpo.ultimo_id >= envioA.id && cont2.cuerpo.nuevos === 0 && cont3.cuerpo.nuevos === 0, 'el contador de nuevos cuenta los míos, respeta «desde» y a otro usuario le da 0', { cont: cont.cuerpo, cont2: cont2.cuerpo, cont3: cont3.cuerpo });

    /* ---------- 7. Una campaña en la que nadie recibe nada se CIERRA ---------- */
    console.log('\n7. Campañas «Enviando…» sin nada que enviar');
    {
      const T1 = await enviar([{ tipo: 'votante', id: sinCuenta, nombre: 'x', contacto: 'x' }], 'Aviso a quien no tiene cuenta', 'Prueba');
      ok(T1.estado === 'enviado' && T1.envios[0].estado === 'sin_contacto' && T1.r.cuerpo.con_envio === 0, 'todos sin contacto: la campaña se cierra al terminar', { c: T1.estado, e: T1.envios[0] && T1.envios[0].estado });
      // Cierre perdido: la campaña quedó «enviando» con sus filas ya resueltas (reinicio entre crear y cerrar).
      const nuevaCampana = async (estados) => {
        const [c] = await pool.query("INSERT INTO comunicaciones_campanas (nombre, canal, mensaje, filtros, estado, total_destinatarios, created_by) VALUES ('Huérfana 316', 'push', 'm', '{}', 'enviando', ?, ?)", [estados.length, admin.id]);
        for (const e of estados) await pool.query("INSERT INTO comunicaciones_envios (campana_id, destinatario_tipo, destinatario_id, destinatario_nombre, destinatario_contacto, estado) VALUES (?, 'manual', NULL, 'x', NULL, ?)", [c.insertId, e]);
        return c.insertId;
      };
      const huerfana = await nuevaCampana(['omitido']);
      const enCamino = await nuevaCampana(['enviando']);
      await pool.query("UPDATE comunicaciones_envios SET reclamado_en = NOW() WHERE campana_id = ?", [enCamino]);   // reclamada AHORA: de verdad en camino (con reclamado_en vacío el reconciliador la tomaría por huérfana)
      const lista = await api('GET', '/api/comunicaciones/campanas');
      const filaEnCamino = (lista.cuerpo || []).find((c) => c.id === enCamino);
      const filaHuerfana = (lista.cuerpo || []).find((c) => c.id === huerfana);
      ok(filaEnCamino && Number(filaEnCamino.omitidos) === 0, 'una fila «enviando» (en camino) ya NO se cuenta como «omitida»', filaEnCamino && filaEnCamino.omitidos);
      ok(filaHuerfana && Number(filaHuerfana.omitidos) === 1, 'una fila omitida SÍ se cuenta como omitida', filaHuerfana && filaHuerfana.omitidos);
      const cerradas = await crm.despacharCampanasProgramadas().then(() => null);
      const [[h]] = await pool.query('SELECT estado, enviados, fallidos FROM comunicaciones_campanas WHERE id = ?', [huerfana]);
      const [[v]] = await pool.query('SELECT estado FROM comunicaciones_campanas WHERE id = ?', [enCamino]);
      ok(h.estado === 'enviado' && Number(h.enviados) === 0, 'el ciclo de cada minuto cierra la campaña huérfana (todos omitidos): queda «enviado» con 0 enviados, que el listado muestra «No se envió»', h);
      ok(v.estado === 'enviando', 'y NO cierra la que todavía tiene una fila en camino', v);
      // Un servicio de push que no responde: ahora es un error con tiempo máximo, y la campaña se cierra.
      modo = 'tiempo'; salidas.length = 0;
      const Tm = await enviar([manual(T(1))], 'Aviso con el servicio caído', 'Prueba');
      modo = 'ok';
      ok(Tm.envios[0] && Tm.envios[0].estado === 'fallido' && /timed out/.test(Tm.envios[0].error_mensaje || '') && Tm.estado === 'fallido', 'si el servicio de push vence el tiempo: la fila queda «fallida» con su motivo y la campaña se cierra', { e: Tm.envios[0] && Tm.envios[0].estado, m: Tm.envios[0] && Tm.envios[0].error_mensaje, c: Tm.estado });
    }

    /* ---------- 8. Pantalla ---------- */
    console.log('\n8. Pantallas (Chromium)');
    navegador = await lanzar();
    const abrirComo = async (id, ruta, ms = 3500) => {
      const p = await navegador.pagina('about:blank');
      await p.cmd('Network.clearBrowserCookies');
      await p.cmd('Network.setCacheDisabled', { cacheDisabled: true });
      await p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(id), url: base });
      await p.cmd('Page.navigate', { url: base + ruta });
      await espera(ms);
      return p;
    };
    {
      const p = await abrirComo(admin.id, `/app/mis-avisos.html?id=${envioA.id}`);
      const v = await p.ev(`({ texto: document.getElementById('lista-avisos').innerText, abiertos: document.querySelectorAll('.aviso-caja.abierto').length, aviso: document.getElementById('aviso').className.includes('visible') ? document.getElementById('aviso').textContent : '' })`);
      ok(v.abiertos === 1 && v.texto.includes('FIN-DEL-MENSAJE-COMPLETO') && v.texto.includes('Citación de coordinadores'), 'abrir la dirección de la notificación muestra el mensaje COMPLETO (con su final) y su título', v.texto.slice(0, 120));
      ok(v.aviso === '', 'sin aviso de error', v.aviso);
      // Otro aviso, más corto, queda en vista previa y se abre al tocarlo.
      const B = await enviar([manual(T(1))], 'Mensaje corto del segundo aviso ' + 'x'.repeat(200) + ' COLA-DEL-SEGUNDO', 'Segundo');
      await p.cmd('Page.navigate', { url: base + '/app/mis-avisos.html' }); await espera(3000);   // sin ?id: ninguno abierto
      const w = await p.ev(`({ cajas: document.querySelectorAll('.aviso-caja').length, primeraAbierta: !!document.querySelector('.aviso-caja.abierto'), texto: document.getElementById('lista-avisos').innerText })`);
      ok(w.cajas >= 2 && !w.primeraAbierta && !w.texto.includes('COLA-DEL-SEGUNDO'), 'la lista (más nuevo arriba) muestra solo una vista previa de cada aviso', { cajas: w.cajas, texto: w.texto.slice(0, 80) });
      await p.ev(`document.querySelector('.aviso-caja .abrir').click(); true`);
      const x = await p.ev(`document.getElementById('lista-avisos').innerText`);
      ok(x.includes('COLA-DEL-SEGUNDO'), 'tocar un aviso lo abre completo');
      ok(p.avisos.length === 0, 'sin excepciones en la página', p.avisos);
      p.cerrar();
    }
    {
      const p = await abrirComo(otro.id, `/app/mis-avisos.html?id=${envioA.id}`);
      const v = await p.ev(`({ texto: document.getElementById('lista-avisos').innerText, aviso: document.getElementById('aviso').textContent })`);
      ok(!v.texto.includes('FIN-DEL-MENSAJE') && /no está disponible/.test(v.aviso), 'otro usuario que abre la misma dirección NO ve el mensaje y lee «Ese aviso no está disponible»', { texto: v.texto.slice(0, 80), aviso: v.aviso });
      ok(p.avisos.length === 0, 'sin excepciones en la página', p.avisos);
      p.cerrar();
    }
    {
      // Inicio: la entrada «Mis avisos» con su insignia; al abrir la bandeja la insignia se apaga en ESTE celular.
      const p = await abrirComo(admin.id, '/app/mis-avisos.html', 2500);
      await p.ev(`localStorage.removeItem('avisos_ultimo_visto'); true`);   // el navegador de la prueba es el mismo: se empieza como un celular que nunca la abrió
      await p.cmd('Page.navigate', { url: base + '/app/inicio.html' }); await espera(4500);
      const a = await p.ev(`({ enlace: !!document.querySelector('a.menu-boton[href="/app/mis-avisos.html"]'), insignia: (document.getElementById('insignia-avisos') || {}).hidden === false ? document.getElementById('insignia-avisos').textContent : null })`);
      ok(a.enlace, 'Inicio ofrece «Mis avisos»', a);
      ok(a.insignia !== null && (a.insignia === '9+' || Number(a.insignia) >= 1), 'y la insignia cuenta los avisos nuevos', a);
      await p.cmd('Page.navigate', { url: base + '/app/mis-avisos.html' }); await espera(3000);
      await p.cmd('Page.navigate', { url: base + '/app/inicio.html' }); await espera(4500);
      const b = await p.ev(`(document.getElementById('insignia-avisos') || {}).hidden`);
      ok(b === true, 'después de abrir la bandeja la insignia desaparece', b);
      ok(p.avisos.length === 0, 'sin excepciones en Inicio', p.avisos);
      p.cerrar();
    }
  } catch (e) {
    fallos++; console.log('  ERROR INESPERADO', e && e.stack || e);
  } finally {
    if (navegador) navegador.cerrar();
    if (servidor) servidor.close();
    await pool.end().catch(() => {});
  }
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})();
