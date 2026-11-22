#!/usr/bin/env node
// scripts/probar-equipos-al-panel.js — ORDEN 92: los equipos de la campaña siempre suben al panel de licencias, y un equipo nuevo pendiente avisa al momento.
//
// Con un PANEL SIMULADO (un servidor HTTP que atiende POST /api/licencia/validar y anota lo que recibe):
//   · la validación manda los equipos de la base, con su estado (un pendiente incluido);
//   · un equipo NUEVO que queda pendiente (cupo lleno o aprobación a mano) provoca una validación al panel en ese momento, sin esperar 6 horas;
//   · un pendiente que vuelve a intentar entrar también avisa (si la primera vez no llegó);
//   · con tope: dentro de la ventana no se manda una por intento, queda UNA programada para cuando termine, y varias peticiones comparten esa;
//   · un error al LEER los equipos queda en el registro (no se traga) y la licencia se valida igual; sin la tabla no se escribe nada (no hay equipos que contar);
//   · el ciclo de 6 horas sigue igual (setInterval de 6 h y una validación al arrancar);
//   · sin servidor de licencias configurado no se avisa a nadie.
//
// USO (base desechable con init-db; no abre Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada92 node scripts/probar-equipos-al-panel.js
// Se niega a correr si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) { console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`); process.exit(2); }
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');

let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // El panel simulado: anota cada validación y responde «válida» con cupo 4 y aprobación a mano.
  const recibidas = [];
  const panel = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      try { recibidas.push({ ruta: req.url, secreto: req.headers['x-api-secret'], cuerpo: JSON.parse(cuerpo || '{}'), t: Date.now() }); } catch (_) { /* cuerpo ilegible */ }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ valido: true, dias_restantes: 100, sublicencias: [], equipos_config: { max_equipos: 4, requiere_aprobacion: true }, equipos_estados: [] }));
    });
  });
  await new Promise((r) => panel.listen(0, '127.0.0.1', r));
  process.env.LICENCIA_SERVIDOR_URL = `http://127.0.0.1:${panel.address().port}`;
  process.env.LICENCIA_API_SECRET = 'secreto-del-panel-simulado';
  process.env.LICENCIA_DOMINIO = 'campana.prueba';
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
  process.env.LICENCIA_VALIDACION_PRONTA_MS = '1500';   // la «ventana de 2 minutos», en pequeño

  const pool = require('../config/db');
  const licencia = require('../config/licencia');
  const equipos = require('../config/equiposAutorizados');
  const q = async (sql, p) => (await pool.query(sql, p))[0];
  const registro = []; const errores = [];
  const consolaLog = console.log; const consolaError = console.error;
  const escucharConsola = () => {
    console.log = (...a) => { registro.push(a.join(' ')); consolaLog(...a); };
    console.error = (...a) => { errores.push(a.join(' ')); consolaError(...a); };
  };
  escucharConsola();

  await q("INSERT IGNORE INTO licencia_equipos_config (id, max_equipos, requiere_aprobacion) VALUES (1, 4, 1)");
  await q('UPDATE licencia_equipos_config SET max_equipos = 4, requiere_aprobacion = 1 WHERE id = 1');
  await q('DELETE FROM equipos_autorizados');
  const peticion = (ua) => ({ headers: { 'user-agent': ua, 'x-forwarded-for': '10.0.0.7' }, ip: '10.0.0.7' });
  const respuesta = () => { const r = { cookies: [] }; r.cookie = (n, v) => r.cookies.push([n, v]); return r; };
  /** Un equipo nuevo que intenta entrar: sin cookie, así que se registra uno nuevo. */
  const equipoNuevo = async (ua) => equipos.reconocerEquipo(peticion(ua), respuesta(), null);
  const ultimaConIdentificador = (ident) => recibidas.filter((v) => (v.cuerpo.equipos || []).some((e) => e.identificador === ident));

  console.log('\n[1] La validación manda los equipos de la base');
  await q(`INSERT INTO equipos_autorizados (identificador, estado, primer_uso, ultimo_uso, user_agent, ultima_ip) VALUES ('equipo-viejo-aprobado', 'autorizado', NOW(), NOW(), 'Chrome en Windows', '10.0.0.1')`);
  await q(`INSERT INTO equipos_autorizados (identificador, estado, primer_uso, ultimo_uso, user_agent, ultima_ip) VALUES ('equipo-viejo-pendiente', 'pendiente', NOW(), NOW(), 'Celular Xiaomi Poco', '10.0.0.2')`);
  await licencia.validar();
  const v1 = recibidas[recibidas.length - 1];
  ok(v1 && v1.ruta === '/api/licencia/validar' && v1.secreto === 'secreto-del-panel-simulado', 'la validación llega al panel con su secreto', v1 && { ruta: v1.ruta });
  const ids1 = ((v1 && v1.cuerpo.equipos) || []).map((e) => e.identificador + ':' + e.estado).sort();
  ok(ids1.join(',') === 'equipo-viejo-aprobado:autorizado,equipo-viejo-pendiente:pendiente', 'viajan los dos equipos, con su estado (el pendiente también)', ids1);
  ok(registro.some((l) => /Equipos que se reportan al panel: 2 \(1 pendiente/.test(l)), 'el registro dice cuántos equipos se reportaron y cuántos están pendientes', registro.slice(-3));

  console.log('\n[2] Un equipo NUEVO pendiente avisa al panel en ese momento (sin esperar 6 horas)');
  await espera(1700);   // la ventana de la validación manual ya pasó
  const antes = recibidas.length;
  const r1 = await equipoNuevo('Chrome en el equipo de Diego');
  ok(r1.permitido === false && r1.motivo === 'pendiente', 'el equipo nuevo queda pendiente (aprobación a mano)', r1);
  const identNuevo = (await q("SELECT identificador FROM equipos_autorizados WHERE user_agent = 'Chrome en el equipo de Diego'"))[0].identificador;
  await espera(600);
  const llegaron = recibidas.slice(antes);
  ok(llegaron.length === 1, 'se hizo UNA validación al panel de inmediato', llegaron.length);
  ok(ultimaConIdentificador(identNuevo).length === 1 && llegaron[0] && llegaron[0].cuerpo.equipos.find((e) => e.identificador === identNuevo).estado === 'pendiente',
    'lo que se mandó al panel trae el equipo nuevo, como pendiente', llegaron[0] && llegaron[0].cuerpo.equipos.map((e) => e.estado));

  console.log('\n[3] Con tope: dentro de la ventana no se manda una por intento, y lo que llega no se pierde');
  const antes3 = recibidas.length;
  const r2 = await equipoNuevo('Equipo B'); const r3 = await equipoNuevo('Equipo C');
  ok(r2.motivo === 'pendiente' && r3.motivo === 'pendiente', 'dos equipos nuevos más quedan pendientes');
  await espera(300);
  ok(recibidas.length === antes3, 'dentro de la ventana NO se manda otra validación', recibidas.length - antes3);
  await espera(2200);   // termina la ventana: sale UNA validación con los dos
  const tarde = recibidas.slice(antes3);
  ok(tarde.length === 1, 'al terminar la ventana sale UNA sola validación para los dos', tarde.length);
  ok(tarde[0] && ['Equipo B', 'Equipo C'].every((ua) => tarde[0].cuerpo.equipos.some((e) => e.user_agent === ua)), 'y trae a los dos equipos nuevos', tarde[0] && tarde[0].cuerpo.equipos.map((e) => e.user_agent));

  console.log('\n[4] Un pendiente que vuelve a intentar entrar también avisa');
  await espera(1700);
  const antes4 = recibidas.length;
  const cookieDelViejo = equipos.crearIdentificador();
  await q(`INSERT INTO equipos_autorizados (identificador, estado, primer_uso, ultimo_uso, user_agent) VALUES (?, 'pendiente', NOW(), NOW(), 'Equipo atascado')`, [equipos.leerIdentificador(cookieDelViejo)]);
  const reintento = await equipos.reconocerEquipo({ headers: { cookie: 'equipo=' + encodeURIComponent(cookieDelViejo), 'user-agent': 'Equipo atascado' }, ip: '10.0.0.9' }, respuesta(), null);
  ok(reintento.permitido === false && reintento.motivo === 'pendiente', 'el equipo que ya estaba pendiente sigue sin entrar', reintento);
  await espera(600);
  ok(recibidas.length === antes4 + 1 && recibidas[recibidas.length - 1].cuerpo.equipos.some((e) => e.user_agent === 'Equipo atascado'), 'su reintento provoca una validación que lo lleva al panel', recibidas.length - antes4);

  console.log('\n[5] Un equipo autorizado que entra NO pide validación');
  await q("UPDATE equipos_autorizados SET estado = 'autorizado' WHERE user_agent = 'Equipo atascado'");
  await espera(1700);
  const antes5 = recibidas.length;
  const entra = await equipos.reconocerEquipo({ headers: { cookie: 'equipo=' + encodeURIComponent(cookieDelViejo), 'user-agent': 'Equipo atascado' }, ip: '10.0.0.9' }, respuesta(), null);
  await espera(600);
  ok(entra.permitido === true && recibidas.length === antes5, 'un equipo ya autorizado entra y no provoca ninguna validación', recibidas.length - antes5);

  console.log('\n[6] Un error al LEER los equipos queda en el registro (no se traga) y la licencia se valida igual');
  await espera(1700);
  const consultaOriginal = pool.query;
  const antes6 = recibidas.length; errores.length = 0;
  pool.query = async (sql, ...resto) => {
    if (/FROM equipos_autorizados e/.test(String(sql))) throw Object.assign(new Error("Unknown column 'e.ultima_ip' in 'field list'"), { code: 'ER_BAD_FIELD_ERROR' });
    return consultaOriginal.call(pool, sql, ...resto);
  };
  await licencia.validar();
  pool.query = consultaOriginal;
  ok(errores.some((l) => /No se pudieron leer los equipos/.test(l) && /ER_BAD_FIELD_ERROR/.test(l) && /ultima_ip/.test(l)), 'el fallo de lectura se escribe en el registro con su código y su mensaje', errores);
  ok(recibidas.length === antes6 + 1 && Array.isArray(recibidas[recibidas.length - 1].cuerpo.equipos) && recibidas[recibidas.length - 1].cuerpo.equipos.length === 0, 'la licencia se valida igual (llega al panel, con la lista vacía)');
  ok(licencia.obtenerEstado().valido === true, 'y la campaña sigue válida');
  // Sin la tabla no hay nada que contar: no es un error y no se escribe nada.
  errores.length = 0;
  pool.query = async (sql, ...resto) => {
    if (/FROM equipos_autorizados e/.test(String(sql))) throw Object.assign(new Error("Table 'x.equipos_autorizados' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' });
    return consultaOriginal.call(pool, sql, ...resto);
  };
  const sinTabla = await equipos.equiposParaReportar().catch((e) => e);
  pool.query = consultaOriginal;
  ok(Array.isArray(sinTabla) && sinTabla.length === 0 && errores.length === 0, 'sin la tabla de equipos: lista vacía y nada escrito en el registro', { sinTabla: String(sinTabla), errores });
  // Y un fallo al AVISAR no estorba el ingreso.
  const licenciaVieja = licencia.validarPronto;
  licencia.validarPronto = () => { throw new Error('explotó'); };
  errores.length = 0;
  const conFallo = await equipoNuevo('Equipo D');
  licencia.validarPronto = licenciaVieja;
  ok(conFallo.permitido === false && conFallo.motivo === 'pendiente' && errores.some((l) => /No se pudo avisar al panel/.test(l)), 'si avisar al panel falla, se escribe y el ingreso responde igual (pendiente)', { conFallo, errores });

  console.log('\n[7] El ciclo de 6 horas sigue igual');
  await espera(1700);
  const intervalosOriginal = global.setInterval; const intervalos = [];
  global.setInterval = (fn, ms) => { intervalos.push({ fn, ms }); return { unref() {} }; };
  const antes7 = recibidas.length;
  licencia.iniciarValidacionPeriodica();
  global.setInterval = intervalosOriginal;
  await espera(700);
  ok(intervalos.length === 1 && intervalos[0].ms === 6 * 60 * 60 * 1000 && intervalos[0].fn === licencia.validar, 'se programa validar() cada 6 horas exactas', intervalos.map((i) => i.ms));
  ok(recibidas.length === antes7 + 1, 'y se valida una vez al arrancar', recibidas.length - antes7);

  console.log('\n[8] Sin servidor de licencias configurado no se avisa a nadie');
  const sin = execFileSync(process.execPath, ['-e', `
    delete process.env.LICENCIA_SERVIDOR_URL; process.env.LICENCIA_API_SECRET = ''; process.env.LICENCIA_DOMINIO = 'x';
    const l = require(${JSON.stringify(path.join(__dirname, '..', 'config', 'licencia.js'))});
    process.stdout.write(String(l.validarPronto()));`], { encoding: 'utf8', env: { ...process.env, LICENCIA_SERVIDOR_URL: '' } });
  ok(sin === 'sin_licencia', 'validarPronto() devuelve «sin_licencia» y no llama a nadie', sin);

  console.log = consolaLog; console.error = consolaError;
  panel.close(); await q('DELETE FROM equipos_autorizados'); await pool.end();
  console.log(`\n${fallos === 0 ? 'TODO BIEN' : 'HAY FALLOS'}: ${pasos - fallos} de ${pasos} comprobaciones.`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch(async (e) => { console.error('Error en la prueba:', e); process.exit(1); });
