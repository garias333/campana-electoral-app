#!/usr/bin/env node
// scripts/probar-aviso-app-destinatario.js
//
// Prueba de «AVISO EN LA APP» (parche 315): un número TECLEADO llega a la cuenta de quien lo tiene, y cuando no llega la fila dice por qué.
//   Servidor: las rutas reales (scripts/capturas/servidor.js) sobre una base desechable. El envío push se SIMULA (config/push.js::enviarAUsuario
//   anota a quién iba dirigido y no sale a ningún proveedor); lo demás es el código real: el cruce, los motivos, la cola de envíos.
//   Navegador: un Chromium real sobre /enviar-push.html (aviso antes de enviar, mensaje en rojo, detalle con su resultado).
//
// USO (base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada315 node scripts/probar-aviso-app-destinatario.js
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
const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const pushSvc = require('../config/push');
const { lanzar, espera } = require('./capturas/navegador');
const { crear } = require('./capturas/servidor');

const RAIZ = path.join(__dirname, '..');
let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); }
}

// El envío push SIMULADO: anota a qué cuenta iba y responde como si hubiera entrado en un dispositivo.
const llamadas = [];
pushSvc.estadoCanal = () => ({ configurado: true, motivo: null });
pushSvc.enviarAUsuario = async (usuarioId) => { llamadas.push(Number(usuarioId)); return { entregados: 1, eliminados: 0 }; };

const MOTIVO_CUENTA = 'No tiene cuenta en la aplicación. Los votantes no reciben avisos: use Enviar SMS.';
const MOTIVO_DISPOSITIVO = 'Tiene cuenta pero no ha activado los avisos en su celular (Inicio → Avisos).';

(async () => {
  // Activar complementos (parche 318): los complementos nacen APAGADOS; esta prueba enciende los que necesita.
  await require('./fixtures/encender-complementos')(pool, ['alertas_dia_d']);
  let servidor; let navegador;
  try {
    /* ---------- 1. Estático ---------- */
    console.log('\n1. Estático');
    const sw = fs.readFileSync(path.join(RAIZ, 'public/service-worker.js'), 'utf8');
    ok(/CACHE_NAME = 'estrategia-v\d+'/.test(sw), 'service worker: caché versionada');
    const tel = require('../lib/telefono');
    ok(['3104157434', '310 415 7434', '+57 310 415 7434', '573104157434', '(+57) 310-415-7434'].every((t) => tel.ultimos10(t) === '3104157434'), 'ultimos10: 10 dígitos, con espacios, +57, 57 pegado y guiones dan lo mismo');
    ok(tel.ultimos10('abc') === null && tel.ultimos10('604 1234') === null && tel.ultimos10(null) === null, 'ultimos10: lo que no llega a 10 dígitos no se compara');

    /* ---------- 2. Personas de la prueba ---------- */
    const sufijo = String(Date.now()).slice(-6);
    const T = (k) => '31' + sufijo + '0' + k;                      // celulares propios de ESTA corrida (10 dígitos): la prueba se puede repetir
    const conEspacios = (t) => '+57 ' + t.slice(0, 3) + ' ' + t.slice(3, 6) + ' ' + t.slice(6);
    const clave = bcrypt.hashSync('clave-ejemplo', 4);
    const [[admin]] = await pool.query("SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.nombre = 'admin' ORDER BY u.id LIMIT 1");
    const usuario = async (nombre, telefono, rol = 'lider', conEstructura = true) => {
      const [r] = await pool.query(
        `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo, telefono) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1, ?)`,
        [nombre, 'c' + sufijo + Math.floor(Math.random() * 1e4), 'u' + sufijo + Math.floor(Math.random() * 1e6), clave, rol, telefono]);
      let est = null;
      if (conEstructura) { const [e] = await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, NULL, 1)', [r.insertId, 'lider']); est = e.insertId; }
      return { id: r.insertId, est };
    };
    const dispositivo = (id) => pool.query('INSERT INTO push_suscripciones (usuario_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)', [id, 'https://push.prueba/' + id + '/' + sufijo, 'p', 'a']);
    const votante = async (nombre, telefono) => (await pool.query('INSERT INTO votantes (nombre, telefono) VALUES (?, ?)', [nombre, telefono]))[0].insertId;

    // A: un ADMIN sin fila en estructura, con avisos activados (el caso de quien se escribe a sí mismo).
    await pool.query('UPDATE usuarios SET telefono = ?, activo = 1 WHERE id = ?', [T(1), admin.id]);
    await dispositivo(admin.id);
    const [[{ n: filasAdminEstructura }]] = await pool.query('SELECT COUNT(*) AS n FROM estructura WHERE usuario_id = ?', [admin.id]);
    ok(filasAdminEstructura === 0, 'el administrador de la prueba NO tiene fila en estructura');
    // B: un líder en estructura, con avisos activados (para elegirlo desde la lista).
    const B = await usuario('Lideresa Bravo ' + sufijo, T(2)); await dispositivo(B.id);
    // C: la misma persona es VOTANTE y USUARIO con el mismo teléfono, escrito distinto en cada ficha.
    const C = await usuario('Cuenta de Cecilia ' + sufijo, conEspacios(T(3)).slice(4), 'lider', false); await dispositivo(C.id);
    const votanteC = await votante('Cecilia Votante ' + sufijo, '+57 ' + T(3));
    // D: votante sin cuenta.  E: cuenta SIN dispositivo.  F y G: dos cuentas con el mismo número.
    const votanteD = await votante('Dario Votante ' + sufijo, T(4));
    const E = await usuario('Elena Sin Aviso ' + sufijo, T(5)); // sin dispositivo
    const F = await usuario('Fabio Uno ' + sufijo, T(6), 'lider', false); await dispositivo(F.id);
    const Gx = await usuario('Gloria Dos ' + sufijo, T(6), 'lider', false); await dispositivo(Gx.id);

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
    const enviar = async (seleccion, canal = 'push') => {
      const r = await api('POST', '/api/comunicaciones/campanas', { nombre: 'Prueba 315', canal, asunto: 'Prueba', mensaje: 'Hola {nombre}', filtros: { fuente: 'seleccion', seleccion } });
      if (r.status !== 200) return { r, envios: [] };
      for (let i = 0; i < 60; i++) {
        const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM comunicaciones_envios WHERE campana_id = ? AND estado IN ('pendiente','enviando')", [r.cuerpo.campana_id]);
        if (!n) break; await espera(300);
      }
      const [envios] = await pool.query('SELECT * FROM comunicaciones_envios WHERE campana_id = ? ORDER BY id', [r.cuerpo.campana_id]);
      return { r, envios };
    };
    const manual = (t) => ({ tipo: 'manual', id: t, nombre: t, contacto: t });

    /* ---------- 4. Un admin sin estructura se escribe a sí mismo, en tres formatos ---------- */
    console.log('\n4. El administrador (sin fila en estructura) teclea su propio número');
    for (const formato of [T(1), conEspacios(T(1)), '57' + T(1)]) {
      llamadas.length = 0;
      const { r, envios } = await enviar([manual(formato)]);
      ok(r.status === 200 && envios.length === 1 && envios[0].estado === 'enviado' && llamadas.length === 1 && llamadas[0] === admin.id,
        `«${formato}»: el aviso sale hacia SU cuenta`, { estado: envios[0] && envios[0].estado, llamadas });
      ok(envios[0] && envios[0].destinatario_nombre !== formato && /Administrador/.test(envios[0].destinatario_nombre), `«${formato}»: el historial muestra su nombre, no el número`, envios[0] && envios[0].destinatario_nombre);
      ok(r.cuerpo.con_envio === 1 && r.cuerpo.sin_contacto === 0, `«${formato}»: la respuesta dice con_envio=1, sin_contacto=0`, r.cuerpo);
    }
    llamadas.length = 0;
    {
      const { envios } = await enviar([manual(T(1)), manual(conEspacios(T(1))), manual('57' + T(1))]);
      ok(envios.length === 1 && llamadas.length === 1, 'el mismo número tecleado tres veces es UNA sola persona y UN solo aviso', { filas: envios.length, llamadas });
    }

    /* ---------- 5. Votante que es también usuario ---------- */
    console.log('\n5. La misma persona es votante y usuario (teléfono escrito distinto en cada ficha)');
    llamadas.length = 0;
    {
      const { envios } = await enviar([manual(T(3))]);
      const e = envios[0] || {};
      ok(e.estado === 'enviado' && llamadas.length === 1 && llamadas[0] === C.id, 'le llega el aviso, a su cuenta', { e: e.estado, llamadas });
      ok(e.destinatario_tipo === 'votante' && Number(e.destinatario_id) === votanteC && /Cecilia Votante/.test(e.destinatario_nombre), 'se conserva el nombre y el id del VOTANTE (no el de la cuenta)', { tipo: e.destinatario_tipo, id: e.destinatario_id, nombre: e.destinatario_nombre });
    }
    llamadas.length = 0;
    await pool.query('UPDATE usuarios SET no_contactar = 1 WHERE id = ?', [C.id]);
    {
      const { envios } = await enviar([manual(T(3))]);
      ok(envios[0] && envios[0].estado === 'dado_de_baja' && llamadas.length === 0, 'si la CUENTA pidió la baja, se respeta aunque la ficha de votante no', { e: envios[0] && envios[0].estado, llamadas });
    }
    await pool.query('UPDATE usuarios SET no_contactar = 0 WHERE id = ?', [C.id]);

    /* ---------- 6. Los motivos, y que ninguno rompa a los demás ---------- */
    console.log('\n6. Cuatro destinatarios que no pueden recibirlo + uno que sí, en el mismo envío');
    llamadas.length = 0;
    {
      const { r, envios } = await enviar([manual(T(4)), manual(T(5)), manual(T(6)), manual('hola'), manual(conEspacios(T(1)))]);
      const por = (f) => envios.find(f) || {};
      const d = por((e) => /Dario/.test(e.destinatario_nombre));
      const e5 = por((e) => /Elena/.test(e.destinatario_nombre));
      const varios = por((e) => e.destinatario_nombre === T(6));
      const basura = por((e) => e.destinatario_nombre === 'hola');
      const adm = por((e) => /Administrador/.test(e.destinatario_nombre));
      ok(d.estado === 'sin_contacto' && d.error_mensaje === MOTIVO_CUENTA, 'votante sin cuenta → «No tiene cuenta en la aplicación…»', { e: d.estado, m: d.error_mensaje });
      ok(e5.estado === 'sin_contacto' && e5.error_mensaje === MOTIVO_DISPOSITIVO, 'usuario sin dispositivo → «Tiene cuenta pero no ha activado los avisos…»', { e: e5.estado, m: e5.error_mensaje });
      ok(varios.estado === 'sin_contacto' && /varias cuentas/.test(varios.error_mensaje || ''), 'un número en dos cuentas → «Ese número está en varias cuentas», no se adivina', { e: varios.estado, m: varios.error_mensaje });
      ok(basura.estado === 'sin_contacto' && /no es un celular/.test(basura.error_mensaje || ''), 'lo que no es un celular → motivo propio', { e: basura.estado, m: basura.error_mensaje });
      ok(adm.estado === 'enviado' && llamadas.length === 1 && llamadas[0] === admin.id, 'el que SÍ puede recibirlo lo recibe: ningún otro lo rompe', { e: adm.estado, llamadas });
      ok(!llamadas.includes(F.id) && !llamadas.includes(Gx.id), 'a ninguna de las dos cuentas del número repetido se le mandó nada');
      ok(r.cuerpo.total_destinatarios === 5 && r.cuerpo.con_envio === 1 && r.cuerpo.sin_contacto === 4, 'la respuesta cuenta 5 / 1 con envío / 4 sin contacto', r.cuerpo);
    }

    /* ---------- 7. Selección desde la lista: igual que antes ---------- */
    console.log('\n7. Elegido desde la lista (no tecleado)');
    llamadas.length = 0;
    {
      const { envios } = await enviar([{ tipo: 'estructura', id: B.est, nombre: 'x', contacto: 'x' }]);
      ok(envios[0] && envios[0].estado === 'enviado' && envios[0].destinatario_tipo === 'estructura' && llamadas[0] === B.id, 'una persona de estructura elegida de la lista recibe su aviso', { e: envios[0] && envios[0].estado, llamadas });
      const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM comunicaciones_envios WHERE estado = 'enviado' AND error_mensaje IS NOT NULL");
      ok(n === 0, 'ninguna fila enviada lleva motivo');
      const b = await api('GET', '/api/comunicaciones/destinatarios/buscar?canal=push&q=' + encodeURIComponent('Lideresa Bravo'));
      ok(Array.isArray(b.cuerpo) && b.cuerpo.some((x) => x.tipo === 'estructura' && x.id === B.est), 'el buscador sigue ofreciendo a la persona de estructura con avisos');
      const b2 = await api('GET', '/api/comunicaciones/destinatarios/buscar?canal=push&q=' + encodeURIComponent('Administrador'));
      ok(Array.isArray(b2.cuerpo) && !b2.cuerpo.some((x) => /Administrador/.test(x.nombre)), 'el buscador NO ofrece al administrador sin estructura: la lista de selección no cambió (solo lo tecleado)', b2.cuerpo);
    }

    /* ---------- 8. SMS y correo no cambian ---------- */
    console.log('\n8. SMS: el cruce sigue siendo el de siempre');
    {
      const exacto = await api('POST', '/api/comunicaciones/destinatarios/preview', { canal: 'sms', filtros: { fuente: 'seleccion', seleccion: [manual('+57 ' + T(3))] } });
      ok(exacto.cuerpo.muestra && exacto.cuerpo.muestra[0] && exacto.cuerpo.muestra[0].tipo === 'votante', 'SMS: «+57 <teléfono de la ficha>» es exactamente el texto guardado en la ficha de votante → se cruza (como hoy)', exacto.cuerpo.muestra);
      const otroFormato = await api('POST', '/api/comunicaciones/destinatarios/preview', { canal: 'sms', filtros: { fuente: 'seleccion', seleccion: [manual(T(3))] } });
      ok(otroFormato.cuerpo.muestra && otroFormato.cuerpo.muestra[0] && otroFormato.cuerpo.muestra[0].tipo === 'manual', 'SMS: otro formato del mismo número NO se cruza (no se cambió la comparación de SMS)', otroFormato.cuerpo.muestra);
      ok(exacto.cuerpo.sinAvisos === undefined, 'SMS: la respuesta del preview no trae los campos nuevos del aviso en la app');
    }

    /* ---------- 9. /preview del aviso en la app ---------- */
    console.log('\n9. /destinatarios/preview (push)');
    {
      const p = await api('POST', '/api/comunicaciones/destinatarios/preview', { canal: 'push', filtros: { fuente: 'seleccion', seleccion: [manual(T(4)), manual(T(5)), manual(T(1))] } });
      ok(p.cuerpo.total === 3 && p.cuerpo.conContacto === 1 && p.cuerpo.sinAvisos === 2, 'total 3, con contacto 1, sin avisos 2', p.cuerpo);
      const motivos = (p.cuerpo.sinAvisosDetalle || []).map((x) => x.motivo);
      ok(motivos.includes(MOTIVO_CUENTA) && motivos.includes(MOTIVO_DISPOSITIVO), 'el detalle trae el motivo de cada uno', motivos);
    }

    /* ---------- 10. Pantalla ---------- */
    console.log('\n10. Pantalla /enviar-push.html (Chromium)');
    navegador = await lanzar();
    const p = await navegador.pagina('about:blank');
    await p.cmd('Network.clearBrowserCookies');
    await p.cmd('Network.setCacheDisabled', { cacheDisabled: true });
    await p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(admin.id), url: base });
    await p.cmd('Page.navigate', { url: base + '/enviar-push.html' });
    await espera(3500);
    const preparar = () => p.ev(`(() => { window.__conf = []; window.confirm = (m) => { window.__conf.push(m); return true; }; window.__cerr = []; const ce = console.error; console.error = function () { window.__cerr.push([].slice.call(arguments).join(' ')); return ce.apply(console, arguments); }; return true; })()`);
    const enviarDesdePantalla = async (texto) => {
      await preparar();
      await p.ev(`(() => { document.getElementById('input-manual').value = ${JSON.stringify(texto)}; document.getElementById('input-mensaje').value = 'Reunión hoy'; document.getElementById('btn-enviar').click(); return true; })()`);
      await espera(2500);
      return p.ev(`({ conf: window.__conf, error: document.getElementById('form-error').className.includes('visible') ? document.getElementById('form-error').textContent : '', ok: document.getElementById('form-ok').className.includes('visible') ? document.getElementById('form-ok').textContent : '', cerr: window.__cerr })`);
    };
    {
      const a = await enviarDesdePantalla(conEspacios(T(1)));
      ok(a.error === '' && /Enviando a 1 persona/.test(a.ok), 'admin teclea «+57 310 …» : mensaje verde «Enviando a 1 persona(s)»', a);
      ok(a.conf.length === 1 && !/OJO/.test(a.conf[0]), 'el aviso previo no advierte de nada cuando todos pueden recibirlo', a.conf);
      await espera(2500);
      const b = await enviarDesdePantalla(T(4));
      ok(/OJO/.test(b.conf[0] || '') && (b.conf[0] || '').includes('No tiene cuenta en la aplicación'), 'votante sin cuenta: ANTES de enviar se advierte quién no lo recibirá y por qué', b.conf);
      ok(/NO se envió/.test(b.error) && b.ok === '', 'y, si nadie podía recibirlo, el mensaje es ROJO («NO se envió») y no el verde', b);
      await espera(1500);
      await p.ev('cargarHistorial()');   // la tabla se pintó justo al enviar, con la campaña aún «Enviando…»: se vuelve a leer
      await espera(1200);
      const hist = await p.ev(`[...document.querySelectorAll('#tbody-historial tr, tbody tr')].slice(0, 3).map(tr => tr.innerText.replace(/\\s+/g, ' ').trim())`);
      ok(hist.some((f) => /No se envió/.test(f)), 'el historial dice «No se envió» para ese envío', hist);
      // Detalle del último envío (el sin contacto): sin «Estado: Enviado».
      const [[ultima]] = await pool.query("SELECT id FROM comunicaciones_campanas WHERE canal = 'push' ORDER BY id DESC LIMIT 1");
      await p.ev(`verDetalle(${ultima.id})`);
      await espera(1200);
      const det = await p.ev(`({ resumen: document.getElementById('detalle-resumen').textContent, filas: [...document.querySelectorAll('#tbody-detalle-envios tr')].map(tr => tr.innerText.replace(/\\s+/g, ' ').trim()) })`);
      ok(!/Enviado/.test(det.resumen) && /Resultado: No se envió · 0 enviados/.test(det.resumen), 'el detalle dice «Resultado: No se envió», no «Estado: Enviado»', det.resumen);
      ok(det.filas[0] && /Sin avisos activados/.test(det.filas[0]) && /No tiene cuenta en la aplicación/.test(det.filas[0]), 'la fila dice «Sin avisos activados» y su motivo', det.filas);
      ok(b.cerr.length === 0 && a.cerr.length === 0 && p.avisos.length === 0, 'sin errores en la consola ni excepciones', { cerr: b.cerr, avisos: p.avisos });
    }
    p.cerrar();
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
