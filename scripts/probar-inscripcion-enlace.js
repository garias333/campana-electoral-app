#!/usr/bin/env node
// scripts/probar-inscripcion-enlace.js
//
// Prueba de extremo a extremo de la inscripción por enlace/QR del líder (orden 23)
// contra una base SIMULADA: levanta las rutas reales (/i, /c, /api/inscripcion,
// /api/votantes, /api/comunicaciones) en un Express de prueba con una sesión
// fingida por cabecera, siembra su propia gente y comprueba cada caso.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada \
//     node scripts/probar-inscripcion-enlace.js
//
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba»: siembra
// usuarios, votantes y puestos, y una prueba que puede ensuciar la campaña de un
// cliente no es una prueba. No manda SMS de verdad: sustituye el envío por un
// registro en memoria. Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) {
  console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`);
  process.exit(2);
}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';

const express = require('express');
const http = require('http');
const pool = require('../config/db');
const smsSvc = require('../config/sms');
const { huellaDePolitica, archivarVersion } = require('../config/politicaVersiones');
const insc = require('../config/inscripcionEnlace');
const reg = require('../config/inscripcionRegistro');
const { analizarTexto } = require('../lib/sms');
const confirm = require('../config/confirmacionConsentimiento');

let fallos = 0, pruebas = 0;
function ok(cond, texto, extra) {
  pruebas++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
const dormir = (ms) => new Promise(r => setTimeout(r, ms));
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }

// ---- SMS fingido y franja controlable ------------------------------------
const geocoderOriginal = require('../config/geocoder').geocodificarDireccion;
const geocodificarInversaOriginal = require('../config/geocoder').geocodificarInversa;
const router_reiniciar = () => require('../routes/inscripcion.routes').reiniciarCupos();
const smsEnviados = [];
let dentroDeFranja = true;
smsSvc.enviarSMS = async (telefono, mensaje) => { smsEnviados.push({ telefono, mensaje }); return { sid: 'prueba' }; };
smsSvc.dentroDeFranja = () => dentroDeFranja;

// ---- Express de prueba ----------------------------------------------------
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use((req, res, next) => {
  const u = req.headers['x-test-user'];
  req.session = { usuario: u ? JSON.parse(u) : undefined };
  req.sublicencia = req.headers['x-test-sublicencia'] ? JSON.parse(req.headers['x-test-sublicencia']) : null;
  next();
});
app.use('/i', express.urlencoded({ extended: false }), require('../routes/inscripcion.routes'));
app.use('/c', express.urlencoded({ extended: false }), require('../routes/confirmacion.routes'));
app.use('/api/inscripcion', require('../routes/inscripcion.panel.routes'));
app.use('/api/votantes', require('../routes/votantes.routes'));
app.use('/api/comunicaciones', require('../routes/comunicaciones.routes'));

let base = '';
let ipN = 10;
const ipNueva = () => `203.0.113.${ipN++}`;
async function pedir(metodo, ruta, { form, json, usuario, sublicencia, ip, ua } = {}) {
  const h = { 'X-Forwarded-For': ip || ipNueva(), 'User-Agent': ua || 'prueba-agente/1.0' };
  let body;
  if (form) { h['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  if (json) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  if (sublicencia) h['X-Test-Sublicencia'] = JSON.stringify(sublicencia);
  const r = await fetch(base + ruta, { method: metodo, headers: h, body, redirect: 'manual' });
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* html */ }
  return { status: r.status, texto, datos };
}

// ---- Siembra ---------------------------------------------------------------
let n = 0;
async function usuario(nombre, rol, telefono) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, telefono, activo)
     VALUES (?, ?, ?, 'x', (SELECT id FROM roles WHERE nombre = ?), ?, 1)`,
    [nombre, `9000000${n}`, `u9000000${n}`, rol, telefono || null]);
  return r.insertId;
}
async function estructura(usuarioId, cargo, supervisorId) {
  await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?,?,?,1)', [usuarioId, cargo, supervisorId || null]);
}
async function votante(cedula, nombre, telefono, liderId, extra = {}) {
  const [r] = await pool.query(
    `INSERT INTO votantes (nombre, cedula, telefono, lider_id, consentimiento_autorizado, origen) VALUES (?,?,?,?,?,?)`,
    [nombre, cedula, telefono, liderId, extra.consent ? 1 : 0, extra.origen || 'manual']);
  return r.insertId;
}

const F = (codigo, huella, extra = {}) => ({
  nombre: 'María Fernanda Gómez', cedula: '1053123456', telefono: '3001234567', email: '',
  autoriza: '1', sitio_web: '', pase: insc.emitirPase(codigo, huella, Date.now() - 10000), ...extra,
});

(async () => {
  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  console.log('\n== Siembra');
  const admin = await usuario('Admin Prueba', 'admin');
  const coord = await usuario('Coordinador Prueba', 'coordinador');
  const l1 = await usuario('Lider Uno Prueba', 'lider');
  const l2 = await usuario('Lider Dos Prueba', 'lider');
  const sub = await usuario('Sublider Prueba', 'sublider');
  const asp = await usuario('Aspirante Prueba', 'lider');
  const l3 = await usuario('Lider Tres Prueba', 'lider');
  await estructura(coord, 'coordinador'); await estructura(l1, 'lider', coord); await estructura(l2, 'lider', coord);
  await estructura(sub, 'usuario', l1); await estructura(asp, 'lider'); await estructura(l3, 'lider', asp);
  await pool.query(`INSERT INTO sublicencias (usuario_id, cargo, nombre, activa) VALUES (?, 'concejo', 'Aspirante Prueba al Concejo', 1)`, [asp]);
  await pool.query(`INSERT INTO dia_d_puestos_votacion (nombre, cantidad_mesas, aspirante_id) VALUES ('PUESTO UNO', 10, 0), ('PUESTO ASPIRANTE', 4, ?)`, [asp]);
  const [[pol]] = await pool.query("SELECT titulo, contenido FROM contenido_paginas WHERE clave = 'politica_privacidad'");
  const HUELLA = huellaDePolitica(pol.contenido);
  await archivarVersion({ clave: 'politica_privacidad', titulo: pol.titulo, contenido: pol.contenido });
  await pool.query('UPDATE inscripcion_config SET habilitado = 1, limite_enlace_dia = 200, limite_telefono_dia = 3, segundos_minimos = 4 WHERE id = 1');

  const e1 = await insc.obtenerOCrearEnlace(l1), e2 = await insc.obtenerOCrearEnlace(l2);
  const eS = await insc.obtenerOCrearEnlace(sub), e3 = await insc.obtenerOCrearEnlace(l3);
  const U = (id, rol) => ({ id, rol, nombre: 'x' });

  console.log('\n== El código');
  ok(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/.test(e1.codigo), 'código de 8 caracteres sin 0/O/1/I/L', e1.codigo);
  const muchos = new Set(Array.from({ length: 2000 }, () => insc.generarCodigo()));
  ok(![...muchos].some(c => /[01OIL]/.test(c)), '2000 códigos generados: ninguno con 0/O/1/I/L');
  ok(muchos.size > 1990, 'los códigos no se repiten');

  console.log('\n== La página: código válido, inexistente, inactivo, líder que salió');
  const g = await pedir('GET', `/i/${e1.codigo}`);
  ok(g.status === 200 && g.texto.includes('Te inscribe') && g.texto.includes('Lider Uno Prueba'), 'código válido pinta el formulario con el líder');
  ok(/noindex/.test(g.texto), 'lleva noindex');
  const gm = await pedir('GET', `/i/${e1.codigo.toLowerCase()}`);
  ok(gm.status === 200 && gm.texto.includes('Te inscribe'), 'acepta el código en minúsculas');
  const inex = await pedir('GET', '/i/ZZZZZZZZ');
  const malo = await pedir('GET', '/i/hola');
  await pool.query('UPDATE inscripcion_enlaces SET activo = 0 WHERE id = ?', [e2.id]);
  const inact = await pedir('GET', `/i/${e2.codigo}`);
  await pool.query('UPDATE inscripcion_enlaces SET activo = 1 WHERE id = ?', [e2.id]);
  await pool.query('UPDATE estructura SET activo = 0 WHERE usuario_id = ?', [l2]);
  const salio = await pedir('GET', `/i/${e2.codigo}`);
  await pool.query('UPDATE estructura SET activo = 1 WHERE usuario_id = ?', [l2]);
  await pool.query('UPDATE usuarios SET activo = 0 WHERE id = ?', [l2]);
  const cuentaInactiva = await pedir('GET', `/i/${e2.codigo}`);
  await pool.query('UPDATE usuarios SET activo = 1 WHERE id = ?', [l2]);
  ok(inex.status === 200 && inex.texto.includes('Enlace no activo'), 'código inexistente → «Enlace no activo» (200)');
  ok(inex.texto === malo.texto && inex.texto === inact.texto && inex.texto === salio.texto && inex.texto === cuentaInactiva.texto,
    'inexistente, mal formado, desactivado, líder fuera de la estructura y cuenta inactiva: LA MISMA respuesta, byte a byte');
  const vivo = await pedir('GET', `/i/${e2.codigo}`);
  ok(vivo.texto.includes('Te inscribe'), 'al volver el líder, el mismo enlace vuelve a servir');

  console.log('\n== Puestos (endpoint público de solo lectura)');
  const ps = await pedir('GET', `/i/${e1.codigo}/puestos`);
  ok(Array.isArray(ps.datos) && ps.datos.length === 1 && ps.datos[0].nombre === 'PUESTO UNO' && ps.datos[0].cantidad_mesas === 10, 'líder de la madre ve los puestos de la madre', ps.datos);
  const ps3 = await pedir('GET', `/i/${e3.codigo}/puestos`);
  ok(Array.isArray(ps3.datos) && ps3.datos.length === 1 && ps3.datos[0].nombre === 'PUESTO ASPIRANTE', 'líder del aspirante ve los puestos del aspirante', ps3.datos);
  const psX = await pedir('GET', '/i/ZZZZZZZZ/puestos');
  ok(Array.isArray(psX.datos) && psX.datos.length === 0, 'código inexistente → lista vacía');

  console.log('\n== Antiabuso');
  let antes = (await q('SELECT COUNT(*) c FROM votantes'))[0].c;
  const hp = await pedir('POST', `/i/${e1.codigo}`, { form: F(e1.codigo, HUELLA, { sitio_web: 'http://spam' }) });
  ok(hp.status === 200 && hp.texto.includes('¡Listo!'), 'honeypot lleno → responde «Listo»');
  ok((await q('SELECT COUNT(*) c FROM votantes'))[0].c === antes, 'honeypot lleno → NO crea a nadie');
  ok((await q("SELECT COUNT(*) c FROM inscripcion_intentos WHERE motivo = 'honeypot'"))[0].c === 1, 'honeypot queda en la bitácora como rechazado');
  const rapido = await pedir('POST', `/i/${e1.codigo}`, { form: F(e1.codigo, HUELLA, { pase: insc.emitirPase(e1.codigo, HUELLA, Date.now()) }) });
  ok(!rapido.texto.includes('¡Listo!') && rapido.texto.includes('en unos segundos'), 'enviar antes de 4 s → pide esperar y repinta el formulario');
  ok((await q('SELECT COUNT(*) c FROM votantes'))[0].c === antes, 'envío demasiado rápido → NO crea a nadie');
  const sinPase = await pedir('POST', `/i/${e1.codigo}`, { form: F(e1.codigo, HUELLA, { pase: 'falso' }) });
  ok(!sinPase.texto.includes('¡Listo!') && sinPase.texto.includes('caducó'), 'pase falsificado → no pasa');
  const paseAjeno = insc.emitirPase(e3.codigo, HUELLA, Date.now() - 10000);
  const conAjeno = await pedir('POST', `/i/${e1.codigo}`, { form: F(e1.codigo, HUELLA, { pase: paseAjeno }) });
  ok(!conAjeno.texto.includes('¡Listo!'), 'el pase de OTRO enlace no sirve en éste');

  console.log('\n== Validación (no crea y no dice nada de la base)');
  for (const [nom, extra] of [
    ['nombre de una palabra', { nombre: 'Maria' }], ['cédula inválida', { cedula: '12' }],
    ['celular que no empieza por 3', { telefono: '6011234567' }], ['celular corto', { telefono: '300123' }],
    ['sin autorización', { autoriza: '' }], ['correo roto', { email: 'a@b' }], ['puesto inexistente', { puesto_id: '99999' }],
    ['mesa fuera de rango', { puesto_id: String(ps.datos[0].id), mesa: '11' }],
  ]) {
    const r = await pedir('POST', `/i/${e1.codigo}`, { form: F(e1.codigo, HUELLA, extra) });
    ok(r.status === 200 && !r.texto.includes('¡Listo!') && r.texto.includes('class="error"'), `rechaza: ${nom}`);
  }
  ok((await q('SELECT COUNT(*) c FROM votantes'))[0].c === antes, 'ninguna validación fallida creó a nadie');

  console.log('\n== a) Cédula nueva con el enlace de un líder');
  const nueva = await pedir('POST', `/i/${e1.codigo}`, {
    ua: 'Mozilla/5.0 (prueba)', ip: '198.51.100.7',
    form: F(e1.codigo, HUELLA, { canal_sms: '1', canal_email: '1', puesto_id: String(ps.datos[0].id), mesa: '3' }),
  });
  ok(nueva.status === 200 && nueva.texto.includes('¡Listo!') && nueva.texto.includes('mensaje de texto'), '«¡Listo!» y avisa del mensaje de confirmación');
  const [v] = await q("SELECT * FROM votantes WHERE cedula = '1053123456'");
  ok(!!v, 'se creó el votante');
  ok(v.lider_id === l1 && v.sublider_id === null, 'queda con el líder dueño del enlace (lider_id, sin sublíder)', { l: v.lider_id, s: v.sublider_id });
  ok(v.origen === 'enlace_lider', "origen = 'enlace_lider'");
  ok(v.consentimiento_confirmado_en === null, 'queda PENDIENTE de confirmar');
  ok(v.consentimiento_autorizado === 1 && v.consentimiento_metodo === 'enlace_lider' && v.consentimiento_fecha, 'consentimiento: autorizado, método enlace_lider, con fecha');
  ok(v.consentimiento_sms === 1 && v.consentimiento_email === 1 && v.consentimiento_whatsapp === 0, 'canales explícitos: SMS sí, correo sí, WhatsApp no (1/0, nunca NULL)');
  ok(v.consentimiento_version === HUELLA && v.consentimiento_version_ok === 1, 'huella de la política mostrada, reconocida por el archivo');
  ok(v.puesto_votacion === 'PUESTO UNO' && v.mesa_votacion === 3, 'puesto y mesa guardados');
  ok(v.rama_aspirante_id === null, 'rama de la madre (sin aspirante)');
  const [ev] = await q('SELECT * FROM votante_consentimiento_evidencia WHERE votante_id = ?', [v.id]);
  ok(ev && ev.ip === '198.51.100.7' && ev.navegador === 'Mozilla/5.0 (prueba)' && ev.metodo === 'enlace_lider' && ev.politica_version === HUELLA && ev.enlace_id === e1.id,
    'evidencia: IP, navegador, método, versión de política y enlace', ev);
  const [it] = await q("SELECT * FROM inscripcion_intentos WHERE votante_id = ? AND resultado = 'nuevo'", [v.id]);
  ok(it && it.otro_lider === 0 && /^[0-9a-f]{64}$/.test(it.cedula_hash) && it.cedula_hash !== '1053123456', 'bitácora: resultado nuevo, cédula solo como hash');

  console.log('\n== El SMS de confirmación (uno, dentro de la franja)');
  for (let i = 0; i < 30 && !smsEnviados.length; i++) await dormir(100);
  await reg.procesarCola();
  ok(smsEnviados.length === 1, 'sale UN SMS', smsEnviados.length);
  const m = smsEnviados[0] && /https:\/\/campana\.prueba\/c\/([A-Za-z0-9_-]{22})$/.exec(smsEnviados[0].mensaje);
  ok(!!m, 'el SMS lleva el enlace de /c con el token corto de 22 caracteres, al final del texto', smsEnviados[0]);
  ok(smsEnviados[0] && smsEnviados[0].mensaje === `Maria, confirma tu inscripcion aqui: https://campana.prueba/c/${m && m[1]}`,
    'el texto es «{primer_nombre}, confirma tu inscripcion aqui: {enlace}»', smsEnviados[0] && smsEnviados[0].mensaje);
  ok(smsEnviados[0] && !/Baja:/i.test(smsEnviados[0].mensaje), 'el SMS NO lleva el «Baja: …» automático');
  await reg.procesarCola(); await reg.procesarCola();
  ok(smsEnviados.length === 1, 'procesar la cola otra vez no lo repite');
  ok((await reg.encolarSmsDeConfirmacion(v.id)) === false, 'encolar de nuevo a la misma persona no crea otro (uno en la vida)');

  console.log('\n== Pendiente de confirmar: fuera de masivos; confirmado: dentro');
  const cuerpoPrev = { filtros: { fuente: 'votantes' }, canal: 'sms', completo: true };
  await votante('2222222222', 'Control Manual', '3109999999', l1, { consent: true });
  let prev = await pedir('POST', '/api/comunicaciones/destinatarios/preview', { json: cuerpoPrev, usuario: U(admin, 'admin') });
  const ids = (prev.datos && prev.datos.destinatarios || []).map(d => d.id);
  ok(prev.status === 200, 'la vista previa de comunicaciones responde', prev.status + ' ' + prev.texto.slice(0, 120));
  ok(!ids.includes(v.id), 'el pendiente NO entra en el envío masivo (SMS)');
  ok(prev.datos && prev.datos.sinAutorizacion >= 1, 'se cuenta aparte como «sin autorización»');
  ok(ids.length >= 1, 'el votante manual de control SÍ entra', ids);
  prev = await pedir('POST', '/api/comunicaciones/destinatarios/preview', { json: { ...cuerpoPrev, canal: 'email' }, usuario: U(admin, 'admin') });
  ok(!(prev.datos.destinatarios || []).map(d => d.id).includes(v.id), 'tampoco por correo');
  const c1 = await pedir('GET', `/c/${m[1]}`);
  ok(c1.status === 200 && c1.texto.includes('Sí, lo confirmo'), '/c muestra el botón (GET no confirma)');
  ok((await q('SELECT consentimiento_confirmado_en c FROM votantes WHERE id = ?', [v.id]))[0].c === null, 'abrir el enlace no confirma');
  const c2 = await pedir('POST', `/c/${m[1]}`);
  ok(c2.status === 200 && c2.texto.includes('Confirmado'), 'POST a /c confirma');
  const [vc] = await q('SELECT consentimiento_confirmado_en c, consentimiento_confirmado_canal k FROM votantes WHERE id = ?', [v.id]);
  ok(vc.c && vc.k === 'sms', 'queda confirmado por SMS');
  prev = await pedir('POST', '/api/comunicaciones/destinatarios/preview', { json: { ...cuerpoPrev, canal: 'sms' }, usuario: U(admin, 'admin') });
  ok((prev.datos.destinatarios || []).map(d => d.id).includes(v.id), 'confirmado → YA entra en los envíos masivos');

  console.log('\n== La respuesta no revela duplicados');
  const igualA = await pedir('POST', `/i/${e2.codigo}`, { form: F(e2.codigo, HUELLA, { canal_sms: '1', puesto_id: '', telefono: '3001234567' }) });
  const nuevaOtra = await pedir('POST', `/i/${e2.codigo}`, { form: F(e2.codigo, HUELLA, { cedula: '1053999001', telefono: '3205550001', canal_sms: '1' }) });
  ok(igualA.status === 200 && igualA.texto === nuevaOtra.texto, 'cédula de OTRO líder y cédula nueva: respuesta idéntica, byte a byte');
  ok(igualA.texto === nueva.texto, '…e idéntica a la de la inscripción nueva con la misma casilla de SMS');

  console.log('\n== c) Cédula de otro líder: no cambia de dueño');
  const [v1] = await q("SELECT lider_id, nombre, telefono FROM votantes WHERE cedula = '1053123456'");
  ok(v1.lider_id === l1, 'sigue siendo del líder 1 después del intento por el enlace del líder 2');
  const [ic] = await q("SELECT * FROM inscripcion_intentos WHERE enlace_id = ? AND votante_id = ? ORDER BY id DESC LIMIT 1", [e2.id, v.id]);
  ok(ic && ic.resultado === 'otro_lider' && ic.otro_lider === 1, "bitácora: 'otro_lider'", ic);
  // consentimiento vacío + celular que coincide → se completa; no coincide → no se toca
  const vSin = await votante('3333333331', 'Sin Consentimiento Uno', '3112223334', l1);
  const vSin2 = await votante('3333333332', 'Sin Consentimiento Dos', '3112223335', l1);
  await pedir('POST', `/i/${e2.codigo}`, { form: F(e2.codigo, HUELLA, { cedula: '3333333331', telefono: '3112223334', canal_whatsapp: '1' }) });
  await pedir('POST', `/i/${e2.codigo}`, { form: F(e2.codigo, HUELLA, { cedula: '3333333332', telefono: '3000000000', canal_whatsapp: '1' }) });
  const [a1] = await q('SELECT lider_id, consentimiento_autorizado a, consentimiento_whatsapp w, consentimiento_metodo m FROM votantes WHERE id = ?', [vSin]);
  const [a2] = await q('SELECT lider_id, consentimiento_autorizado a, consentimiento_metodo m FROM votantes WHERE id = ?', [vSin2]);
  ok(a1.lider_id === l1 && a1.a === 1 && a1.w === 1 && a1.m === 'enlace_lider', 'celular coincide: se COMPLETA el consentimiento vacío y el dueño no cambia', a1);
  ok(a2.lider_id === l1 && a2.a === 0 && a2.m === null, 'celular distinto: la ficha existente NO se toca', a2);
  const [e1ev] = await q('SELECT COUNT(*) c FROM votante_consentimiento_evidencia WHERE votante_id IN (?, ?)', [vSin, vSin2]);
  ok(e1ev.c === 1, 'evidencia solo para el que se completó');

  console.log('\n== b) La misma persona, mismo líder');
  const antesB = (await q('SELECT COUNT(*) c FROM inscripcion_intentos WHERE resultado = ?', ['mismo_lider']))[0].c;
  await pedir('POST', `/i/${e1.codigo}`, { form: F(e1.codigo, HUELLA, { nombre: 'Otro Nombre Distinto', telefono: '3001234567' }) });
  const [vb] = await q("SELECT nombre, lider_id FROM votantes WHERE cedula = '1053123456'");
  ok(vb.nombre === 'María Fernanda Gómez' && vb.lider_id === l1, 'no se pisa el nombre ni el dueño');
  ok((await q('SELECT COUNT(*) c FROM inscripcion_intentos WHERE resultado = ?', ['mismo_lider']))[0].c === antesB + 1, "bitácora: 'mismo_lider'");
  ok((await q("SELECT COUNT(*) c FROM votantes WHERE cedula = '1053123456'"))[0].c === 1, 'sigue habiendo una sola ficha');

  await pedir('POST', `/i/${e1.codigo}`, { form: F(e1.codigo, HUELLA, { cedula: '4444444400', telefono: '3115550000', nombre: 'Segundo Inscrito Uno' }) });

  console.log('\n== Sublíder y aspirante');
  await pedir('POST', `/i/${eS.codigo}`, { form: F(eS.codigo, HUELLA, { cedula: '4444444441', telefono: '3115550001' }) });
  const [vs] = await q("SELECT lider_id, sublider_id, origen FROM votantes WHERE cedula = '4444444441'");
  ok(vs && vs.lider_id === l1 && vs.sublider_id === sub, 'enlace de un sublíder: lider_id = su líder, sublider_id = él (regla de votantes.routes.js)', vs);
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '5555555551', telefono: '3115550002', puesto_id: String(ps3.datos[0].id) }) });
  const [va] = await q("SELECT lider_id, rama_aspirante_id FROM votantes WHERE cedula = '5555555551'");
  ok(va && va.lider_id === l3 && va.rama_aspirante_id === asp, 'líder de un aspirante: la ficha cae en la rama del aspirante', va);

  console.log('\n== d) Otra rama de aspirante: se suma a votante_ramas');
  const vr = await votante('6666666661', 'Persona De Otra Rama', '3127770001', l1, { consent: true });
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '6666666661', telefono: '3127770009' }) });
  ok((await q('SELECT COUNT(*) c FROM votante_ramas WHERE votante_id = ?', [vr]))[0].c === 0, 'con otro celular NO se suma (la cédula sola no basta)');
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '6666666661', telefono: '3127770001' }) });
  const ramas = await q('SELECT aspirante_id, registrado_por FROM votante_ramas WHERE votante_id = ?', [vr]);
  ok(ramas.length === 1 && ramas[0].aspirante_id === asp && ramas[0].registrado_por === l3, 'con el celular que coincide: se suma a la rama del aspirante', ramas);
  ok((await q('SELECT lider_id FROM votantes WHERE id = ?', [vr]))[0].lider_id === l1, 'y el dueño original no cambia');
  ok((await q("SELECT resultado FROM inscripcion_intentos WHERE votante_id = ? ORDER BY id DESC LIMIT 1", [vr]))[0].resultado === 'rama_sumada', "bitácora: 'rama_sumada'");

  console.log('\n== Topes');
  const NOMBRES_TOPE = ['Uno', 'Dos', 'Tres'];
  for (let i = 0; i < 3; i++) await pedir('POST', `/i/${e2.codigo}`, { form: F(e2.codigo, HUELLA, { cedula: `70000000${i}1`, telefono: '3190000001', nombre: `Tope Tel ${NOMBRES_TOPE[i]} Apellido` }) });
  const cuantas = (await q("SELECT COUNT(*) c FROM votantes WHERE telefono = '3190000001'"))[0].c;
  ok(cuantas === 3, '3 inscripciones por teléfono en el día entran', cuantas);
  const cuarta = await pedir('POST', `/i/${e2.codigo}`, { form: F(e2.codigo, HUELLA, { cedula: '7000000041', telefono: '3190000001', nombre: 'Tope Tel Cuatro Apellido' }) });
  ok(cuarta.texto.includes('¡Listo!'), 'la 4.ª responde igual («Listo»): no delata el tope');
  ok((await q("SELECT COUNT(*) c FROM votantes WHERE telefono = '3190000001'"))[0].c === 3, '…pero NO se crea');
  ok((await q("SELECT COUNT(*) c FROM inscripcion_intentos WHERE motivo = 'tope_telefono'"))[0].c === 1, 'queda como rechazado por tope_telefono');
  await pool.query('UPDATE inscripcion_config SET limite_enlace_dia = 1 WHERE id = 1');
  const lleno = await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '8000000001', telefono: '3190000077', nombre: 'Tope Enlace Apellido' }) });
  ok(lleno.texto.includes('límite de inscripciones de hoy'), 'tope diario del enlace (configurable) → lo dice');
  ok((await q("SELECT COUNT(*) c FROM votantes WHERE cedula = '8000000001'"))[0].c === 0, '…y no crea');
  await pool.query('UPDATE inscripcion_config SET limite_enlace_dia = 200 WHERE id = 1');

  console.log('\n== SMS fuera de la franja: se programa, no se pierde');
  dentroDeFranja = false;
  smsEnviados.length = 0;
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9100000001', telefono: '3200000001', canal_sms: '1', nombre: 'Fuera De Franja Apellido' }) });
  const [fx] = await q("SELECT id FROM votantes WHERE cedula = '9100000001'");
  const [cola] = await q('SELECT estado, enviar_desde > NOW() AS futuro FROM inscripcion_sms_cola WHERE votante_id = ?', [fx.id]);
  await dormir(300); await reg.procesarCola();
  ok(cola && cola.estado === 'pendiente' && cola.futuro === 1, 'queda programado para después (enviar_desde en el futuro)', cola);
  ok(smsEnviados.length === 0, 'fuera de la franja NO sale');
  dentroDeFranja = true;
  await pool.query('UPDATE inscripcion_sms_cola SET enviar_desde = NOW() WHERE votante_id = ?', [fx.id]);
  await reg.procesarCola();
  ok(smsEnviados.length === 1, 'al abrir la franja sale (uno)', smsEnviados.length);
  // Sin marcar SMS no se manda nada
  smsEnviados.length = 0;
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9100000002', telefono: '3200000002', canal_email: '1', nombre: 'Sin Sms Apellido' }) });
  await dormir(300); await reg.procesarCola();
  const [fy] = await q("SELECT id FROM votantes WHERE cedula = '9100000002'");
  ok(smsEnviados.length === 0 && (await q('SELECT COUNT(*) c FROM inscripcion_sms_cola WHERE votante_id = ?', [fy.id]))[0].c === 0, 'sin marcar SMS: no se encola ni se manda nada');

  console.log('\n== El SMS de confirmación cabe en 1 SMS (con la firma de 30), con los tres dominios');
  const FIRMA30 = 'F'.repeat(30);
  await pool.query('UPDATE sms_config SET firma = ? WHERE id = 1', [FIRMA30]);
  smsSvc.invalidarCache();
  const DOMINIOS = ['electoral.appestrategia.net', 'campanadepruebamunicipal.appestrategia.net', 'campanadepruebadepartamental.appestrategia.net'];
  let k = 0;
  const largos = [];
  for (const dom of DOMINIOS) {
    process.env.LICENCIA_DOMINIO = dom;
    k++;
    smsEnviados.length = 0;
    // «Bañuelitos» son 10 letras con una eñe: el peor caso de nombre, y se transliterado a «Banuelitos».
    await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: `92000000${k}1`, telefono: `32100000${k}1`, canal_sms: '1', nombre: 'Bañuelitos Pérez Gómez' }) });
    for (let i = 0; i < 30 && !smsEnviados.length; i++) await dormir(100);
    await reg.procesarCola();
    const msg = smsEnviados[0] && smsEnviados[0].mensaje;
    const a = msg ? analizarTexto(msg, FIRMA30) : null;
    largos.push({ dom, texto: msg && msg.length, conFirma: a && a.caracteres });
    ok(!!msg && msg.startsWith('Banuelitos, confirma tu inscripcion aqui: https://' + dom + '/c/'), `${dom}: lleva el nombre transliterado y el enlace`, msg);
    ok(a && a.gsm7 && a.segmentos === 1 && a.caracteres <= 160, `${dom}: 1 SMS (${msg && msg.length} caracteres, ${a && a.caracteres} con la firma de 30)`, a);
    ok(msg && /^[\x20-\x7E]+$/.test(msg), `${dom}: solo ASCII (nada que pase el SMS a 70)`);
    ok(msg && !/Baja:/i.test(msg), `${dom}: sin «Baja: …»`);
  }
  console.log('  largos medidos:', JSON.stringify(largos));
  // Un primer nombre de más de 10 letras: se omite el saludo, y sigue siendo 1 SMS.
  process.env.LICENCIA_DOMINIO = DOMINIOS[2];
  smsEnviados.length = 0;
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9200000091', telefono: '3210000091', canal_sms: '1', nombre: 'Maximiliano Alexander Gómez' }) });
  for (let i = 0; i < 30 && !smsEnviados.length; i++) await dormir(100);
  await reg.procesarCola();
  ok(smsEnviados[0] && smsEnviados[0].mensaje.startsWith('Confirma tu inscripcion aqui: https://') && analizarTexto(smsEnviados[0].mensaje, FIRMA30).segmentos === 1,
    'nombre de más de 10 letras: se omite el saludo y sigue en 1 SMS', smsEnviados[0] && smsEnviados[0].mensaje);
  process.env.LICENCIA_DOMINIO = 'campana.prueba';
  await pool.query('UPDATE sms_config SET firma = NULL WHERE id = 1');
  smsSvc.invalidarCache();

  console.log('\n== /c ofrece «No quiero recibir más mensajes» (como /v)');
  const vBaja = await votante('9300000001', 'Persona Para Baja', '3220000001', l1, { consent: true });
  const tokBaja = (await confirm.crearConfirmacion({ req: { protocol: 'https', get: () => '' }, votanteId: vBaja, canal: 'sms', destino: '3220000001', corto: true })).token;
  const cPag = await pedir('GET', `/c/${tokBaja}`);
  ok(cPag.status === 200 && cPag.texto.includes('href="?baja=1"') && cPag.texto.includes('No quiero recibir más mensajes'), '/c ofrece el enlace de baja junto al botón de confirmar');
  const cBajaGet = await pedir('GET', `/c/${tokBaja}?baja=1`);
  ok(cBajaGet.status === 200 && cBajaGet.texto.includes('Aún no estás dado de baja') && cBajaGet.texto.includes('id="baja-boton"'), 'GET ?baja=1 muestra la confirmación con el botón');
  ok((await q('SELECT no_contactar n FROM votantes WHERE id = ?', [vBaja]))[0].n === 0, 'un GET NO da de baja (los revisores de SMS abren los enlaces solos)');
  const cBajaPost = await pedir('POST', `/c/${tokBaja}?baja=1`);
  ok(cBajaPost.status === 200 && cBajaPost.texto.includes('Ya no recibirás más mensajes'), 'el botón (POST) da de baja');
  ok((await q('SELECT no_contactar n FROM votantes WHERE id = ?', [vBaja]))[0].n === 1, 'queda no_contactar = 1');
  const cMala = await pedir('GET', '/c/' + 'x'.repeat(22) + '?baja=1');
  ok(cMala.status === 404, 'token inexistente en la baja → 404');
  // La baja no depende de la vigencia de 15 días; la confirmación sí.
  const vVenc = await votante('9300000002', 'Persona Vencida', '3220000002', l1, { consent: true });
  const tokVenc = (await confirm.crearConfirmacion({ req: { protocol: 'https', get: () => '' }, votanteId: vVenc, canal: 'sms', destino: '3220000002', corto: true })).token;
  await pool.query('UPDATE consentimiento_confirmaciones SET expira_en = NOW() - INTERVAL 1 DAY WHERE votante_id = ?', [vVenc]);
  ok((await pedir('GET', `/c/${tokVenc}`)).status === 404, 'enlace de confirmación vencido → ya no confirma');
  ok((await pedir('POST', `/c/${tokVenc}?baja=1`)).status === 200 && (await q('SELECT no_contactar n FROM votantes WHERE id = ?', [vVenc]))[0].n === 1, '…pero la baja SÍ funciona con el enlace vencido');
  // Los enlaces de 64 hexadecimales ya enviados siguen sirviendo.
  const vViejo = await votante('9300000003', 'Persona Enlace Viejo', '3220000003', l1, { consent: true });
  const tokViejo = (await confirm.crearConfirmacion({ req: { protocol: 'https', get: () => '' }, votanteId: vViejo, canal: 'sms', destino: '3220000003' })).token;
  ok(/^[0-9a-f]{64}$/.test(tokViejo) && (await pedir('GET', `/c/${tokViejo}`)).texto.includes('Sí, lo confirmo'), 'un enlace de 64 hexadecimales (el formato anterior) sigue confirmando');
  ok((await pedir('POST', `/c/${tokViejo}?baja=1`)).status === 200, '…y también ofrece la baja');

  console.log('\n== Datos de contacto completos (orden 26)');
  { // bloque propio: sus nombres (c1, t1…) no chocan con los de las secciones de arriba
  // Territorio de la campaña: un departamento, un municipio, una comuna, un corregimiento, un barrio de la comuna y una vereda del municipio.
  await pool.query("INSERT INTO territorios (tipo, nombre, padre_id) VALUES ('departamento', 'Caldas', NULL)");
  const [{ id: depC }] = await q("SELECT id FROM territorios WHERE nombre = 'Caldas'");
  await pool.query("INSERT INTO territorios (tipo, nombre, padre_id) VALUES ('municipio', 'Manizales', ?), ('municipio', 'Chinchina', ?)", [depC, depC]);
  const [{ id: munM }] = await q("SELECT id FROM territorios WHERE nombre = 'Manizales'");
  await pool.query("INSERT INTO territorios (tipo, nombre, padre_id) VALUES ('comuna', 'Comuna Uno', ?), ('corregimiento', 'Corregimiento Dos', ?), ('vereda', 'Vereda Directa', ?)", [munM, munM, munM]);
  const [{ id: comU }] = await q("SELECT id FROM territorios WHERE nombre = 'Comuna Uno'");
  await pool.query("INSERT INTO territorios (tipo, nombre, padre_id) VALUES ('barrio', 'Barrio Alfa', ?)", [comU]);
  // Una base recién instalada no tiene fila de configuración hasta que el administrador guarda «Datos de la campaña».
  const sinConfig = await pedir('GET', `/i/${e3.codigo}`);
  ok(sinConfig.texto.includes('name="departamento_residencia" value=""') && sinConfig.texto.includes('name="comuna_corregimiento_residencia"'), 'sin configuración de territorio: campos vacíos y todos visibles (no falla)');
  await pool.query("INSERT IGNORE INTO configuracion_campana (id) VALUES (1)");
  await pool.query("UPDATE configuracion_campana SET territorio_departamento = 'Caldas', territorio_ciudad = 'Manizales', ciudad_tiene_comunas = 1, usar_nombre_barrios = 1 WHERE id = 1");

  const form0 = await pedir('GET', `/i/${e3.codigo}`);
  ok(form0.texto.includes('Datos de contacto') && form0.texto.includes('name="direccion"') && form0.texto.includes('name="departamento_residencia"')
     && form0.texto.includes('name="ciudad_residencia"') && form0.texto.includes('name="comuna_corregimiento_residencia"') && form0.texto.includes('name="barrio_residencia"') && form0.texto.includes('name="email"'),
    'el formulario trae la sección «Datos de contacto» con los seis campos y los nombres de la ficha');
  ok(/name="departamento_residencia" value="Caldas"/.test(form0.texto) && /name="ciudad_residencia" value="Manizales"/.test(form0.texto), 'departamento y ciudad vienen prellenados con los de la campaña');
  ok((form0.texto.match(/<small>\(opcional\)<\/small>/g) || []).length === 6, 'los seis de contacto dicen «(opcional)»');
  ok(form0.texto.indexOf('name="cedula"') < form0.texto.indexOf('Datos de contacto') && form0.texto.indexOf('Datos de contacto') < form0.texto.indexOf('caja-puesto'), 'va DESPUÉS de los datos personales y antes del puesto (desde la orden 27 el celular es de esta sección)');
  ok(!/required[^>]*name="(email|direccion|ciudad_residencia|barrio_residencia)"/.test(form0.texto) && (form0.texto.match(/\brequired\b/g) || []).length === 4, 'obligatorios: los mismos de siempre (nombre, cédula, celular y la autorización)', (form0.texto.match(/\brequired\b/g) || []).length);
  await pool.query('UPDATE configuracion_campana SET ciudad_tiene_comunas = 0, usar_nombre_barrios = 0 WHERE id = 1');
  const form1 = await pedir('GET', `/i/${e3.codigo}`);
  ok(!form1.texto.includes('name="comuna_corregimiento_residencia"') && !form1.texto.includes('name="barrio_residencia"'), 'si la campaña no usa comunas ni barrios, esos campos no se muestran (como en el celular)');
  await pool.query('UPDATE configuracion_campana SET ciudad_tiene_comunas = 1, usar_nombre_barrios = 1 WHERE id = 1');

  console.log('  -- listas de la campaña (endpoint público de solo lectura)');
  const t1 = await pedir('GET', `/i/${e3.codigo}/territorio?departamento=Caldas&ciudad=Manizales`);
  ok(t1.datos && t1.datos.departamentos.includes('Caldas') && t1.datos.municipios.includes('Manizales') && t1.datos.municipios.includes('Chinchina'), 'departamentos y municipios de la campaña', t1.datos);
  ok(t1.datos.zonas.length === 2 && t1.datos.zonas.includes('Comuna Uno') && t1.datos.zonas.includes('Corregimiento Dos'), 'comunas y corregimientos del municipio', t1.datos.zonas);
  ok(t1.datos.barrios.includes('Barrio Alfa') && t1.datos.barrios.includes('Vereda Directa'), 'barrios de las comunas Y veredas que cuelgan directo del municipio', t1.datos.barrios);
  const t2 = await pedir('GET', `/i/${e3.codigo}/territorio?departamento=Caldas&ciudad=Manizales&zona=Comuna%20Uno`);
  ok(t2.datos.barrios.length === 1 && t2.datos.barrios[0] === 'Barrio Alfa', 'al elegir una comuna, solo sus barrios', t2.datos.barrios);
  const t3 = await pedir('GET', '/i/ZZZZZZZZ/territorio?ciudad=Manizales');
  ok(t3.datos && Object.values(t3.datos).every(l => l.length === 0), 'código inexistente → listas vacías');
  const t4 = await pedir('GET', `/i/${e3.codigo}/territorio?ciudad=NoExiste`);
  ok(t4.status === 200 && t4.datos.zonas.length === 0 && t4.datos.barrios.length === 0, 'una ciudad desconocida → sin comunas ni barrios (texto libre)');

  console.log('  -- guardado');
  const geoLlamadas = [];
  const geocoder = require('../config/geocoder');
  geocoder.geocodificarDireccion = async (e) => { geoLlamadas.push(e); return { latitud: 5.0703, longitud: -75.5138 }; };
  const esperar = async (cond, ms = 3000) => { for (let i = 0; i < ms / 50; i++) { if (await cond()) return true; await dormir(50); } return false; };
  const datosC = { email: 'maria@correo.co', direccion: 'Calle 10 #5-20', departamento_residencia: 'Caldas', ciudad_residencia: 'Manizales',
                   comuna_corregimiento_residencia: 'Comuna Uno', barrio_residencia: 'Barrio Alfa' };

  const todo = await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9400000011', telefono: '3230000011', nombre: 'Contacto Completo Uno', ...datosC }) });
  ok(todo.texto.includes('¡Listo!'), 'inscripción con todos los datos → «¡Listo!»');
  const [c1] = await q("SELECT * FROM votantes WHERE cedula = '9400000011'");
  ok(c1.email === 'maria@correo.co' && c1.direccion === 'Calle 10 #5-20' && c1.departamento_residencia === 'Caldas' && c1.ciudad_residencia === 'Manizales'
     && c1.comuna_corregimiento_residencia === 'Comuna Uno' && c1.barrio_residencia === 'Barrio Alfa', 'cédula nueva: se guardan los seis datos de contacto', c1);
  ok(c1.origen === 'enlace_lider' && c1.consentimiento_confirmado_en === null, '…y sigue «sin confirmar»');
  ok(await esperar(async () => (await q("SELECT latitud FROM votantes WHERE cedula = '9400000011'"))[0].latitud !== null), 'con dirección: se geocodifica y quedan las coordenadas');
  ok(geoLlamadas.length === 1 && geoLlamadas[0].calle === 'Calle 10 #5-20, Barrio Alfa' && geoLlamadas[0].ciudad === 'Manizales' && geoLlamadas[0].departamento === 'Caldas', 'se geocodificó la calle con el barrio, la ciudad y el departamento', geoLlamadas[0]);
  const [g1] = await q("SELECT latitud, longitud, geocodificado_en FROM votantes WHERE cedula = '9400000011'");
  ok(Number(g1.latitud) === 5.0703 && Number(g1.longitud) === -75.5138 && g1.geocodificado_en, 'latitud, longitud y la fecha de geocodificación');

  geoLlamadas.length = 0;
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9400000021', telefono: '3230000021', nombre: 'Contacto Minimo Dos' }) });
  const [c2] = await q("SELECT email, direccion, departamento_residencia, ciudad_residencia, comuna_corregimiento_residencia, barrio_residencia, latitud FROM votantes WHERE cedula = '9400000021'");
  ok(c2 && Object.values(c2).every(v => v === null), 'sin ningún dato opcional: se guarda igual, con todo NULL (nada de cadenas vacías)', c2);
  await dormir(200);
  ok(geoLlamadas.length === 0, 'sin dirección no se llama al geocodificador');

  // Recorte y saneo, como el alta normal: espacios colapsados, sin caracteres de control, y al largo de la columna
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9400000031', telefono: '3230000031', nombre: 'Contacto Saneado Tres',
    direccion: '   Carrera   7 \t# 8-9\n   ', departamento_residencia: 'D'.repeat(150), ciudad_residencia: '  Manizales  ',
    comuna_corregimiento_residencia: 'C'.repeat(200), barrio_residencia: 'B'.repeat(300), email: '  PERSONA@Correo.Co ' }) });
  const [c3] = await q("SELECT email, direccion, departamento_residencia, ciudad_residencia, comuna_corregimiento_residencia, barrio_residencia FROM votantes WHERE cedula = '9400000031'");
  ok(c3 && c3.direccion === 'Carrera 7 # 8-9', 'la dirección se recorta y se colapsan los espacios y saltos', c3 && c3.direccion);
  /* Orden 36: la campaña de esta prueba SÍ tiene lista de comunas (sembrada arriba), así que un texto largo que no es una de
     ellas ya no se corta a 120: se descarta entero. El largo de la comuna sin lista queda cubierto por el límite de columna. */
  ok(c3.departamento_residencia.length === 100 && c3.barrio_residencia.length === 120, 'departamento y barrio se cortan al largo de su columna (100 / 120)');
  ok(c3.comuna_corregimiento_residencia === null, 'una «comuna» que no es de la lista de la campaña (200 letras C) no se guarda: queda vacía');
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9400000051', telefono: '3230000051', nombre: 'Contacto Comuna Ciudad',
    ciudad_residencia: 'Manizales', comuna_corregimiento_residencia: 'Manizales' }) });
  const [c5] = await q("SELECT comuna_corregimiento_residencia c FROM votantes WHERE cedula = '9400000051'");
  ok(c5 && c5.c === null, '/i: la ciudad escrita como comuna («Manizales») no se guarda como comuna, y la inscripción sí se hace');
  ok(c3.ciudad_residencia === 'Manizales' && c3.email === 'PERSONA@Correo.Co', 'se recortan los espacios de los extremos');
  const largoDir = await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9400000041', telefono: '3230000041', nombre: 'Contacto Largo Cuatro', direccion: 'X'.repeat(400) }) });
  ok((await q("SELECT direccion d FROM votantes WHERE cedula = '9400000041'"))[0].d.length === 255, 'una dirección de 400 caracteres queda en 255');
  const mal = await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9400000051', telefono: '3230000051', nombre: 'Contacto Correo Cinco', email: 'no-es-correo' }) });
  ok(!mal.texto.includes('¡Listo!') && mal.texto.includes('value="no-es-correo"'), 'un correo mal escrito se rechaza y se repinta con lo que escribió');
  const repintar = await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '12', telefono: '3230000061', nombre: 'Contacto Repinta Seis', ...datosC, ciudad_residencia: '' }) });
  ok(repintar.texto.includes('value="Calle 10 #5-20"') && repintar.texto.includes('name="ciudad_residencia" value=""') && repintar.texto.includes('value="Barrio Alfa"'),
    'tras un error se repintan todos los datos de contacto, y una ciudad que la persona vació se respeta (no se vuelve a prellenar)');

  console.log('  -- ficha existente: solo se completan los vacíos');
  const vEx = await votante('9500000011', 'Ficha Con Datos', '3240000011', l1, { consent: true });
  await pool.query("UPDATE votantes SET direccion = 'Cra 1 # 2-3', departamento_residencia = 'Antioquia', email = '', latitud = 4.5, longitud = -75.1 WHERE id = ?", [vEx]);
  geoLlamadas.length = 0;
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9500000011', telefono: '3240000011', nombre: 'Otro Nombre Cualquiera', ...datosC, email: 'nuevo@correo.co' }) });
  const [x1] = await q('SELECT * FROM votantes WHERE id = ?', [vEx]);
  ok(x1.direccion === 'Cra 1 # 2-3' && x1.departamento_residencia === 'Antioquia', 'celular coincide: la dirección y el departamento que YA tenía NO se pisan', { d: x1.direccion, dep: x1.departamento_residencia });
  ok(x1.ciudad_residencia === 'Manizales' && x1.comuna_corregimiento_residencia === 'Comuna Uno' && x1.barrio_residencia === 'Barrio Alfa', 'se completan los vacíos: ciudad, comuna y barrio');
  ok(x1.email === 'nuevo@correo.co', 'un correo en cadena vacía cuenta como vacío y se completa');
  ok(x1.nombre === 'Ficha Con Datos' && x1.lider_id === l1, 'ni el nombre ni el dueño cambian');
  await dormir(250);
  ok(geoLlamadas.length === 0 && Number(x1.latitud) === 4.5, 'la dirección ya existía: no se geocodifica ni se tocan sus coordenadas');

  const vSinDir = await votante('9500000021', 'Ficha Sin Direccion', '3240000021', l1, { consent: true });
  geoLlamadas.length = 0;
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9500000021', telefono: '3240000021', nombre: 'Ficha Sin Direccion', ...datosC }) });
  ok((await q('SELECT direccion d FROM votantes WHERE id = ?', [vSinDir]))[0].d === 'Calle 10 #5-20', 'una ficha sin dirección la recibe');
  ok(await esperar(async () => (await q('SELECT latitud l FROM votantes WHERE id = ?', [vSinDir]))[0].l !== null) && geoLlamadas.length === 1, '…y se geocodifica');

  const vConCoord = await votante('9500000031', 'Ficha Con Coordenadas', '3240000031', l1, { consent: true });
  await pool.query('UPDATE votantes SET latitud = 4.9, longitud = -75.9 WHERE id = ?', [vConCoord]);
  geoLlamadas.length = 0;
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9500000031', telefono: '3240000031', nombre: 'Ficha Con Coordenadas', ...datosC }) });
  await dormir(300);
  const [x3] = await q('SELECT direccion, latitud FROM votantes WHERE id = ?', [vConCoord]);
  ok(x3.direccion === 'Calle 10 #5-20' && Number(x3.latitud) === 4.9 && geoLlamadas.length === 0, 'una ficha con coordenadas recibe la dirección pero NO se geocodifica ni se pisan sus coordenadas', x3);

  const vOtro = await votante('9500000041', 'Ficha De Otro Lider', '3240000041', l1, { consent: true });
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9500000041', telefono: '3240000041', nombre: 'Ficha De Otro Lider', ...datosC }) });
  const [x4] = await q('SELECT lider_id, direccion, barrio_residencia FROM votantes WHERE id = ?', [vOtro]);
  ok(x4.lider_id === l1 && x4.direccion === 'Calle 10 #5-20' && x4.barrio_residencia === 'Barrio Alfa', 'ficha de OTRO líder con el celular que coincide: se completan los vacíos y el dueño no cambia');

  const vOtroCel = await votante('9500000051', 'Ficha Otro Celular', '3240000051', l1, { consent: true });
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9500000051', telefono: '3249999999', nombre: 'Ficha Otro Celular', ...datosC }) });
  const [x5] = await q('SELECT direccion, email, ciudad_residencia FROM votantes WHERE id = ?', [vOtroCel]);
  ok(x5.direccion === null && x5.email === null && x5.ciudad_residencia === null, 'con un celular que NO coincide: no se completa nada (la cédula sola no basta)');

  console.log('  -- el geocodificador no está, falla o tarda');
  geocoder.geocodificarDireccion = async () => { throw new Error('Falta GOOGLE_MAPS_API_KEY en el archivo .env. Crea una API Key…'); };
  const avisos = []; const warnOriginal = console.warn; console.warn = (...a) => avisos.push(a.join(' '));
  const sinClave = await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9600000011', telefono: '3250000011', nombre: 'Sin Clave Geocodificador', ...datosC }) });
  await dormir(300);
  const [s1] = await q("SELECT direccion, latitud FROM votantes WHERE cedula = '9600000011'");
  ok(sinClave.texto.includes('¡Listo!') && s1.direccion === 'Calle 10 #5-20' && s1.latitud === null, 'sin GOOGLE_MAPS_API_KEY: la inscripción responde «Listo», guarda todo y deja las coordenadas vacías');
  ok(avisos.length === 0, 'y no ensucia el registro con una advertencia por cada inscripción', avisos);
  geocoder.geocodificarDireccion = async () => { throw new Error('boom de red'); };
  const conFallo = await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9600000021', telefono: '3250000021', nombre: 'Con Fallo Geocodificador', ...datosC }) });
  await dormir(300);
  ok(conFallo.texto.includes('¡Listo!') && (await q("SELECT COUNT(*) c FROM votantes WHERE cedula = '9600000021'"))[0].c === 1, 'si el servicio falla por otra causa: igual se inscribe');
  geocoder.geocodificarDireccion = async () => null;
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9600000031', telefono: '3250000031', nombre: 'Sin Resultado Geocodificador', ...datosC }) });
  await dormir(300);
  ok((await q("SELECT latitud l FROM votantes WHERE cedula = '9600000031'"))[0].l === null, 'si no encuentra la dirección: sin coordenadas, sin error');
  console.warn = warnOriginal;
  geocoder.geocodificarDireccion = async () => { await dormir(1500); return { latitud: 5.1, longitud: -75.2 }; };
  const t0 = Date.now();
  const lento = await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9600000041', telefono: '3250000041', nombre: 'Geocodificador Lento Cinco', ...datosC }) });
  const ms = Date.now() - t0;
  ok(lento.texto.includes('¡Listo!') && ms < 1000, `la respuesta NO espera al geocodificador (tardó ${ms} ms con un servicio de 1500 ms)`, ms);
  ok(await esperar(async () => (await q("SELECT latitud l FROM votantes WHERE cedula = '9600000041'"))[0].l !== null, 4000), '…y las coordenadas llegan después');
  geocoder.geocodificarDireccion = geocoderOriginal;

  } // fin del bloque de la orden 26

  console.log('\n== Formulario por secciones y GPS (orden 27)');
  { // bloque propio
  const geocoder = require('../config/geocoder');
  const geoLlamadas = [];
  geocoder.geocodificarDireccion = async (e) => { geoLlamadas.push(e); return { latitud: 5.0703, longitud: -75.5138 }; };
  const esperar = async (cond, ms = 3000) => { for (let i = 0; i < ms / 50; i++) { if (await cond()) return true; await dormir(50); } return false; };
  await pool.query("UPDATE configuracion_campana SET territorio_departamento = 'Caldas', territorio_ciudad = 'Manizales', ciudad_tiene_comunas = 1, usar_nombre_barrios = 1 WHERE id = 1");

  console.log('  -- orden, estilo y obligatorios');
  const fm = (await pedir('GET', `/i/${e3.codigo}`)).texto;
  const titulos = [...fm.matchAll(/<h2 class="seccion[^"]*">([^<]+)<\/h2>/g)].map(m => m[1]);
  ok(JSON.stringify(titulos) === JSON.stringify(['Datos personales', 'Datos de contacto', 'Dónde votas', 'Tratamiento de datos personales']), 'cuatro secciones, en el orden pedido', titulos);
  const pos = (t) => fm.indexOf(t);
  const orden = ['Datos personales', 'name="cedula"', 'name="nombre"', 'Datos de contacto', 'id="btn-gps"', 'name="direccion"', 'name="departamento_residencia"',
    'name="ciudad_residencia"', 'name="comuna_corregimiento_residencia"', 'name="barrio_residencia"', 'name="telefono"', 'name="email"',
    'Dónde votas', 'Consultar mi lugar de votación', 'id="buscar-puesto"', 'name="puesto_id"', 'name="mesa"',
    'Tratamiento de datos personales', 'name="autoriza"', 'name="canal_sms"', 'name="canal_whatsapp"', 'name="canal_email"', 'id="btn"'];
  const idx = orden.map(pos);
  ok(idx.every(i => i >= 0) && idx.every((i, k) => k === 0 || i > idx[k - 1]), 'cédula → nombre; GPS → dirección → depto → ciudad → comuna → barrio → celular → correo; puesto → mesa; política → autorización → canales → botón',
    orden.filter((t, k) => idx[k] < 0 || (k > 0 && idx[k] <= idx[k - 1])));
  const etiqueta = (id) => (fm.match(new RegExp(`<label for="${id}">([^<]*(?:<small>[^<]*</small>)?)`)) || [])[1] || '';
  ok(/obligatorio/.test(etiqueta('cedula')) && /obligatorio/.test(etiqueta('nombre')) && /obligatorio/.test(etiqueta('telefono')), 'cédula, nombre y celular dicen «(obligatorio)»', [etiqueta('cedula'), etiqueta('nombre'), etiqueta('telefono')]);
  ok(/opcional/.test(etiqueta('email')) && fm.indexOf('name="email"') > fm.indexOf('name="telefono"'), 'el correo dice «(opcional)» y va después del celular');
  ok(/obligatorio/.test(fm.slice(pos('name="autoriza"'), pos('name="canal_sms"'))), 'la casilla de autorización dice «(obligatorio)»');
  ok((fm.match(/\brequired\b/g) || []).length === 4, 'campos required: cédula, nombre, celular y autorización (no se añadió ninguno)');
  ok(!/name="canal_(sms|whatsapp|email)" value="1" checked/.test(fm) && !/name="autoriza" value="1" checked/.test(fm), 'las casillas de canal y la autorización salen SIN marcar');
  const css = fm.match(/h2\.seccion\{[^}]*\}/)[0];
  ok(/text-transform:uppercase/.test(css) && /font-weight:700/.test(css) && /color:#0B5ED7/.test(css) && /border-bottom:1px solid/.test(css), 'títulos en mayúsculas, negrita, azul de la marca (#0B5ED7) y línea fina debajo', css);
  ok(/<a href="\/i\/[A-Z0-9]+\/politica" target="_blank"/.test(fm.slice(pos('Tratamiento de datos personales'))), 'enlace a la política vigente (otra pestaña) dentro de la sección 4');
  ok(fm.includes('<input type="search" id="buscar-puesto"') && /<select id="puesto" name="puesto_id"><option value="">No sé<\/option>/.test(fm) && /<select id="mesa" name="mesa"><option value="">No sé<\/option>/.test(fm), 'puesto con buscador, y «No sé» en puesto y en mesa');
  // (la dirección y el botón de la Registraduría se prueban en la sección de la orden 28)
  ok(/<button type="button" class="gps" id="btn-gps">Usar mi ubicación \(GPS\)<\/button>/.test(fm), 'el botón GPS es type="button" (no envía el formulario)');
  const iClick = fm.indexOf("bGps.addEventListener('click'"), iUsar = fm.indexOf('ubicar({enableHighAccuracy');
  ok(iClick > 0 && iUsar > iClick && (fm.match(/getCurrentPosition/g) || []).length === 1, 'el navegador solo se consulta dentro del clic: getCurrentPosition aparece una vez y su primera llamada está en el manejador');
  ok(/id="gps_lat" value=""/.test(fm) && /id="gps_lon" value=""/.test(fm), 'dos campos ocultos para latitud y longitud, vacíos al abrir');
  await pool.query('UPDATE configuracion_campana SET ciudad_tiene_comunas = 0, usar_nombre_barrios = 0 WHERE id = 1');
  const fm0 = (await pedir('GET', `/i/${e3.codigo}`)).texto;
  ok(!fm0.includes('name="comuna_corregimiento_residencia"') && !fm0.includes('name="barrio_residencia"'), 'comuna y barrio siguen ocultos si la campaña no los usa');
  await pool.query('UPDATE configuracion_campana SET ciudad_tiene_comunas = 1, usar_nombre_barrios = 1 WHERE id = 1');

  console.log('  -- coordenadas del GPS: validación y guardado');
  const D = { direccion: 'Calle 10 #5-20' };
  geoLlamadas.length = 0;
  const g1 = await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9700000011', telefono: '3260000011', nombre: 'Gps Valido Uno', ...D, gps_lat: '5.0689', gps_lon: '-75.5174' }) });
  const [r1] = await q("SELECT latitud, longitud, geocodificado_en, direccion FROM votantes WHERE cedula = '9700000011'");
  ok(g1.texto.includes('¡Listo!') && Number(r1.latitud) === 5.0689 && Number(r1.longitud) === -75.5174 && r1.geocodificado_en && r1.direccion === 'Calle 10 #5-20', 'coordenadas válidas: se guardan con la fecha, junto a la dirección escrita', r1);
  await dormir(300);
  ok(geoLlamadas.length === 0, 'con GPS NO se geocodifica por dirección (cero consultas)', geoLlamadas);
  const gSan = await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9700000012', telefono: '3260000012', nombre: 'Gps San Andres', gps_lat: '12.5847', gps_lon: '-81.7006' }) });
  ok(gSan.texto.includes('¡Listo!') && Number((await q("SELECT latitud l FROM votantes WHERE cedula = '9700000012'"))[0].l) === 12.5847, 'San Andrés y Providencia también entran en el rango');
  const gRed = await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9700000013', telefono: '3260000013', nombre: 'Gps Redondeado Tres', gps_lat: '5.123456789012', gps_lon: '-75.987654321098' }) });
  const [rRed] = await q("SELECT latitud, longitud FROM votantes WHERE cedula = '9700000013'");
  ok(Number(rRed.latitud) === 5.1234568 && Number(rRed.longitud) === -75.9876543, 'se redondea a los 7 decimales de la columna', rRed);

  const malos = [
    ['texto', 'abc', 'def'], ['fuera de Colombia (Madrid)', '40.4168', '-3.7038'], ['longitud de otro continente', '5.07', '-100.2'],
    ['(0, 0)', '0', '0'], ['NaN', 'NaN', 'NaN'], ['Infinity', 'Infinity', '-Infinity'], ['notación científica', '5e0', '-7.5e1'],
    ['con inyección', "5.0; DROP TABLE votantes", '-75.5'], ['solo la latitud', '5.07', ''], ['solo la longitud', '', '-75.5'],
    ['latitud 91', '91', '-75.5'], ['con coma decimal', '5,0689', '-75,5174'],
  ];
  let k = 0, malosBien = 0; const detalleMalos = [];
  for (const [que, la, lo] of malos) {
    k++;
    const ced = `97000001${String(20 + k).padStart(2, '0')}`;
    const r = await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: ced, telefono: `32600002${String(k).padStart(2, '0')}`, nombre: 'Gps Invalido Prueba', gps_lat: la, gps_lon: lo }) });
    const [fila] = await q('SELECT latitud, longitud, geocodificado_en FROM votantes WHERE cedula = ?', [ced]);
    if (r.texto.includes('¡Listo!') && fila && fila.latitud === null && fila.longitud === null && fila.geocodificado_en === null) malosBien++;
    else detalleMalos.push([que, r.status, fila]);
  }
  ok(malosBien === malos.length, `${malos.length} coordenadas inválidas: se descartan SIN error, la inscripción se guarda y la ficha queda sin coordenadas`, detalleMalos);
  geoLlamadas.length = 0;
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9700000091', telefono: '3260000091', nombre: 'Gps Invalido Direccion', ...D, gps_lat: '40.4168', gps_lon: '-3.7038' }) });
  ok(await esperar(async () => (await q("SELECT latitud l FROM votantes WHERE cedula = '9700000091'"))[0].l !== null) && geoLlamadas.length === 1, 'GPS inválido + dirección: se geocodifica por la dirección, como antes');
  ok(Number((await q("SELECT latitud l FROM votantes WHERE cedula = '9700000091'"))[0].l) === 5.0703, '…y las coordenadas son las de la dirección, no las del GPS descartado');

  const rep = await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '12', telefono: '3260000099', nombre: 'Gps Repinta Prueba', gps_lat: '5.0689', gps_lon: '-75.5174' }) });
  ok(/id="gps_lat" value="5.0689"/.test(rep.texto) && /id="gps_lon" value="-75.5174"/.test(rep.texto) && rep.texto.includes('Ubicación tomada.'), 'tras un error de validación las coordenadas tomadas se conservan (y el aviso lo dice)');
  const rep2 = await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '12', telefono: '3260000098', nombre: 'Gps Repinta Dos', gps_lat: '40.4', gps_lon: '-3.7' }) });
  ok(/id="gps_lat" value=""/.test(rep2.texto), '…pero unas inválidas no se repintan');

  console.log('  -- ficha existente: coordenadas solo si no tenía');
  const vSin = await votante('9710000011', 'Ficha Sin Coordenadas', '3270000011', l1, { consent: true });
  geoLlamadas.length = 0;
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9710000011', telefono: '3270000011', nombre: 'Ficha Sin Coordenadas', ...D, gps_lat: '5.0689', gps_lon: '-75.5174' }) });
  await dormir(300);
  const [e1r] = await q('SELECT latitud, longitud, geocodificado_en, direccion FROM votantes WHERE id = ?', [vSin]);
  ok(Number(e1r.latitud) === 5.0689 && Number(e1r.longitud) === -75.5174 && e1r.geocodificado_en && e1r.direccion === 'Calle 10 #5-20' && geoLlamadas.length === 0,
    'ficha sin coordenadas, celular coincide: recibe el GPS (y su dirección) y no se geocodifica por dirección', e1r);
  const vCon = await votante('9710000021', 'Ficha Con Coordenadas Dos', '3270000021', l1, { consent: true });
  await pool.query('UPDATE votantes SET latitud = 4.9, longitud = -75.9, geocodificado_en = ? WHERE id = ?', ['2026-01-02 03:04:05', vCon]);
  geoLlamadas.length = 0;
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9710000021', telefono: '3270000021', nombre: 'Ficha Con Coordenadas Dos', ...D, gps_lat: '5.0689', gps_lon: '-75.5174' }) });
  await dormir(300);
  const [e2r] = await q('SELECT latitud, longitud, DATE_FORMAT(geocodificado_en, "%Y-%m-%d %H:%i:%s") g, direccion FROM votantes WHERE id = ?', [vCon]);
  ok(Number(e2r.latitud) === 4.9 && Number(e2r.longitud) === -75.9 && e2r.g === '2026-01-02 03:04:05' && e2r.direccion === 'Calle 10 #5-20' && geoLlamadas.length === 0,
    'ficha CON coordenadas: el GPS no las pisa (ni su fecha), la dirección sí se completa y no se geocodifica', e2r);
  const vOtro = await votante('9710000031', 'Ficha Otro Celular Dos', '3270000031', l1, { consent: true });
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9710000031', telefono: '3279999999', nombre: 'Ficha Otro Celular Dos', gps_lat: '5.0689', gps_lon: '-75.5174' }) });
  ok((await q('SELECT latitud l FROM votantes WHERE id = ?', [vOtro]))[0].l === null, 'con un celular que NO coincide: no se le pone nada (la cédula sola no basta)');
  const vMitad = await votante('9710000041', 'Ficha Una Coordenada', '3270000041', l1, { consent: true });
  await pool.query('UPDATE votantes SET latitud = 4.9 WHERE id = ?', [vMitad]);
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '9710000041', telefono: '3270000041', nombre: 'Ficha Una Coordenada', gps_lat: '5.0689', gps_lon: '-75.5174' }) });
  const [e4r] = await q('SELECT latitud, longitud FROM votantes WHERE id = ?', [vMitad]);
  ok(Number(e4r.latitud) === 5.0689 && Number(e4r.longitud) === -75.5174, 'una ficha con la latitud sin la longitud cuenta como sin coordenadas y se completa el par', e4r);

  console.log('  -- puesto y mesa');
  const psE1 = (await pedir('GET', `/i/${e1.codigo}/puestos`)).datos;
  const puestoUno = psE1.find(p => p.nombre === 'PUESTO UNO');
  const psE3 = (await pedir('GET', `/i/${e3.codigo}/puestos`)).datos;
  ok(psE1.length === 1 && puestoUno && puestoUno.cantidad_mesas === 10, 'el endpoint de puestos da id, nombre y cantidad de mesas del puesto de la campaña', puestoUno);
  const p1 = await pedir('POST', `/i/${e1.codigo}`, { form: F(e1.codigo, HUELLA, { cedula: '9720000011', telefono: '3280000011', nombre: 'Puesto Mesa Diez', puesto_id: String(puestoUno.id), mesa: '10' }) });
  const [pm1] = await q("SELECT puesto_votacion, mesa_votacion FROM votantes WHERE cedula = '9720000011'");
  ok(p1.texto.includes('¡Listo!') && pm1.puesto_votacion === 'PUESTO UNO' && pm1.mesa_votacion === 10, 'puesto y mesa 10 (la última del puesto)', pm1);
  const p2 = await pedir('POST', `/i/${e1.codigo}`, { form: F(e1.codigo, HUELLA, { cedula: '9720000021', telefono: '3280000021', nombre: 'Puesto Mesa Once', puesto_id: String(puestoUno.id), mesa: '11' }) });
  ok(!p2.texto.includes('¡Listo!') && p2.texto.includes('Esa mesa no existe en el puesto.') && (await q("SELECT COUNT(*) c FROM votantes WHERE cedula = '9720000021'"))[0].c === 0, 'mesa 11 en un puesto de 10: se rechaza y no se crea la ficha');
  const p3 = await pedir('POST', `/i/${e1.codigo}`, { form: F(e1.codigo, HUELLA, { cedula: '9720000031', telefono: '3280000031', nombre: 'Puesto Mesa Cero', puesto_id: String(puestoUno.id), mesa: '0' }) });
  ok(!p3.texto.includes('¡Listo!') && p3.texto.includes('Esa mesa no existe'), 'mesa 0 se rechaza');
  const p4 = await pedir('POST', `/i/${e1.codigo}`, { form: F(e1.codigo, HUELLA, { cedula: '9720000041', telefono: '3280000041', nombre: 'Puesto Sin Mesa', puesto_id: String(puestoUno.id), mesa: '' }) });
  const [pm4] = await q("SELECT puesto_votacion, mesa_votacion FROM votantes WHERE cedula = '9720000041'");
  ok(p4.texto.includes('¡Listo!') && pm4.puesto_votacion === 'PUESTO UNO' && pm4.mesa_votacion === null, 'puesto sin mesa («No sé» en mesa): se guarda el puesto y la mesa queda vacía', pm4);
  const p5 = await pedir('POST', `/i/${e1.codigo}`, { form: F(e1.codigo, HUELLA, { cedula: '9720000051', telefono: '3280000051', nombre: 'Puesto No Se', puesto_id: '', mesa: '3' }) });
  const [pm5] = await q("SELECT puesto_votacion, mesa_votacion FROM votantes WHERE cedula = '9720000051'");
  ok(p5.texto.includes('¡Listo!') && pm5.puesto_votacion === null && pm5.mesa_votacion === null, '«No sé» en el puesto: ni puesto ni mesa (una mesa suelta no significa nada)', pm5);
  const p6 = await pedir('POST', `/i/${e1.codigo}`, { form: F(e1.codigo, HUELLA, { cedula: '9720000061', telefono: '3280000061', nombre: 'Puesto Ajeno Prueba', puesto_id: String(psE3[0].id), mesa: '1' }) });
  ok(!p6.texto.includes('¡Listo!') && p6.texto.includes('Elige un puesto de la lista'), 'un puesto de OTRA campaña (aspirante) con el enlace de este líder: se rechaza');

  console.log('  -- geocodificación inversa: /i/<código>/ubicacion');
  const inversaLlamadas = [];
  const propuesta = { direccion: 'Cra. 23 #20-30, Manizales, Caldas, Colombia', detalle: { city: 'Manizales', state: 'Caldas', suburb: 'Palogrande', road: 'Carrera 23' } };
  geocoder.geocodificarInversa = async (la, lo) => { inversaLlamadas.push([la, lo]); return propuesta; };
  router_reiniciar();
  const u1 = await pedir('POST', `/i/${e3.codigo}/ubicacion`, { form: { lat: '5.0689', lon: '-75.5174' } });
  ok(u1.status === 200 && u1.datos.disponible === true && u1.datos.direccion === 'Cra. 23 #20-30' && u1.datos.barrio === 'Palogrande' && u1.datos.ciudad === 'Manizales' && u1.datos.departamento === 'Caldas',
    'con inversa: propone dirección (solo la calle), barrio, ciudad y departamento', u1.datos);
  ok(inversaLlamadas.length === 1 && inversaLlamadas[0][0] === 5.0689 && inversaLlamadas[0][1] === -75.5174, 'llamó a Google con las coordenadas validadas', inversaLlamadas);
  ok(Object.keys(u1.datos).sort().join() === 'barrio,ciudad,departamento,direccion,disponible', 'la respuesta trae solo esos cinco campos (nada de la respuesta cruda de Google)');
  geocoder.geocodificarInversa = async () => ({ direccion: 'RJ4X+9P Manizales, Caldas, Colombia', detalle: { city: 'Manizales', state: 'Caldas' } });
  const u2 = await pedir('POST', `/i/${e3.codigo}/ubicacion`, { form: { lat: '5.07', lon: '-75.52' } });
  ok(u2.datos.disponible === true && u2.datos.direccion === '' && u2.datos.ciudad === 'Manizales', 'un «plus code» no se propone como dirección; lo demás sí');
  geocoder.geocodificarInversa = async () => ({ direccion: 'Colombia', detalle: {} });
  const u2b = await pedir('POST', `/i/${e3.codigo}/ubicacion`, { form: { lat: '5.07', lon: '-75.52' } });
  ok(u2b.datos.disponible === false && u2b.datos.direccion === '', 'si Google solo dice «Colombia» no hay nada útil que proponer → disponible:false', u2b.datos);

  const errores = []; const errOriginal = console.error; console.error = (...a) => errores.push(a.join(' '));
  geocoder.geocodificarInversa = async () => { throw new Error('Falta GOOGLE_MAPS_API_KEY en el archivo .env.'); };
  const u3 = await pedir('POST', `/i/${e3.codigo}/ubicacion`, { form: { lat: '5.07', lon: '-75.52' } });
  ok(u3.status === 200 && u3.datos.disponible === false, 'sin clave de Google: {disponible:false} y sin error (solo se guardan las coordenadas)');
  ok(errores.length === 0, '…y sin ensuciar el registro de errores', errores);
  geocoder.geocodificarInversa = async () => { throw new Error('boom de red'); };
  const u4 = await pedir('POST', `/i/${e3.codigo}/ubicacion`, { form: { lat: '5.07', lon: '-75.52' } });
  ok(u4.status === 200 && u4.datos.disponible === false && errores.length === 1, 'si Google falla por otra causa: {disponible:false} y UN aviso en el registro');
  console.error = errOriginal;
  geocoder.geocodificarInversa = async () => null;
  ok((await pedir('POST', `/i/${e3.codigo}/ubicacion`, { form: { lat: '5.07', lon: '-75.52' } })).datos.disponible === false, 'sin resultado → {disponible:false}');

  inversaLlamadas.length = 0;
  geocoder.geocodificarInversa = async (la, lo) => { inversaLlamadas.push([la, lo]); return propuesta; };
  const u5 = await pedir('POST', `/i/${e3.codigo}/ubicacion`, { form: { lat: '40.4', lon: '-3.7' } });
  ok(u5.status === 400 && u5.datos.disponible === false && inversaLlamadas.length === 0, 'coordenadas fuera de Colombia → 400 y NO se consulta a Google');
  const u6 = await pedir('POST', `/i/${e3.codigo}/ubicacion`, { form: { lat: 'abc', lon: 'def' } });
  ok(u6.status === 400 && inversaLlamadas.length === 0, 'coordenadas que no son números → 400 y NO se consulta a Google');
  const u7 = await pedir('POST', '/i/ZZZZZZZZ/ubicacion', { form: { lat: '5.07', lon: '-75.52' } });
  ok(u7.status === 200 && u7.datos.disponible === false && inversaLlamadas.length === 0, 'código inexistente → {disponible:false} y NO se consulta a Google');
  const u8 = await pedir('GET', `/i/${e3.codigo}/ubicacion?lat=5.07&lon=-75.52`);
  ok(u8.status === 404 && inversaLlamadas.length === 0, 'por GET no existe (las coordenadas no viajan en la URL ni quedan en los registros de acceso)', u8.status);

  console.log('  -- topes de la inversa (cada llamada cuesta una consulta)');
  router_reiniciar(); inversaLlamadas.length = 0;
  const ipFija = '198.51.100.7';
  let estados = [];
  for (let i = 0; i < 22; i++) estados.push((await pedir('POST', `/i/${e3.codigo}/ubicacion`, { form: { lat: '5.07', lon: '-75.52' }, ip: ipFija })).status);
  ok(estados.slice(0, 20).every(s => s === 200) && estados[20] === 429 && estados[21] === 429 && inversaLlamadas.length === 20, 'tope por IP: 20 llamadas, la 21 y la 22 dan 429 y no llegan a Google', { estados: estados.join(','), llamadas: inversaLlamadas.length });
  const otraIp = await pedir('POST', `/i/${e3.codigo}/ubicacion`, { form: { lat: '5.07', lon: '-75.52' }, ip: '198.51.100.8' });
  ok(otraIp.status === 200 && otraIp.datos.disponible === true, 'otra IP no se ve afectada');
  router_reiniciar(); inversaLlamadas.length = 0;
  let cont200 = 0, primero429 = 0;
  for (let i = 0; i < 405; i++) {
    const r = await pedir('POST', `/i/${e1.codigo}/ubicacion`, { form: { lat: '5.07', lon: '-75.52' }, ip: `10.${Math.floor(i / 250)}.${i % 250}.9` });
    if (r.status === 200) cont200++; else if (!primero429) primero429 = i + 1;
  }
  ok(cont200 === 400 && primero429 === 401 && inversaLlamadas.length === 400, 'tope por enlace: 400 llamadas al día repartidas en muchas IP; la 401 da 429', { cont200, primero429, llamadas: inversaLlamadas.length });
  const otroEnlace = await pedir('POST', `/i/${e3.codigo}/ubicacion`, { form: { lat: '5.07', lon: '-75.52' } });
  ok(otroEnlace.status === 200, 'el tope de un enlace no afecta al de otro líder');
  router_reiniciar();
  geocoder.geocodificarInversa = geocodificarInversaOriginal;
  geocoder.geocodificarDireccion = geocoderOriginal;
  } // fin del bloque de la orden 27

  console.log('\n== Botón de consulta de puesto y control de cédulas duplicadas (orden 28)');
  { // bloque propio
  const geocoder = require('../config/geocoder');
  geocoder.geocodificarDireccion = geocoderOriginal;   // sin geocodificar: esta sección no lo necesita
  const { normalizarCedula, enmascararCedula } = require('../lib/normalizarCedula');
  const fs = require('fs'), path = require('path');
  const URL_NUEVA = 'https://consultacenso.registraduria.gov.co/';

  console.log('  -- la URL de la Registraduría: la nueva, y la vieja ya no aparece en ningún archivo');
  const raiz = path.join(__dirname, '..');
  const viejas = [];
  (function recorrer(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (/^(node_modules|\.git|parches|backups|legislacion|uploads|conversaciones)$/.test(e.name)) continue;
      const ruta = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (/\.(js|html|css|json|sh)$/.test(e.name) && ruta !== __filename) {
        if (fs.readFileSync(ruta, 'utf8').includes('wsp.registraduria.gov.co/censo/consultar')) viejas.push(path.relative(raiz, ruta));
      }
    }
  })(raiz);
  ok(viejas.length === 0, 'la dirección vieja (wsp.registraduria.gov.co/censo/consultar) ya no está en ningún .js, .html, .css, .json ni .sh del proyecto', viejas);
  const fm = (await pedir('GET', `/i/${e3.codigo}`)).texto;
  ok(fm.includes(`href="${URL_NUEVA}"`) && !fm.includes('wsp.registraduria'), 'la página /i trae la dirección nueva y ninguna vieja');
  ok((fm.match(/registraduria\.gov\.co/g) || []).length === 1, 'la dirección está UNA sola vez en la página (una constante)');

  console.log('  -- el botón dentro de DÓNDE VOTAS, antes de Puesto y Mesa');
  const boton = fm.match(/<a class="btn-consulta" role="button" href="([^"]*)" target="_blank" rel="noopener noreferrer">Consultar mi lugar de votación<\/a>/);
  ok(!!boton && boton[1] === URL_NUEVA, 'botón «Consultar mi lugar de votación», en otra pestaña con rel="noopener noreferrer"', boton && boton[1]);
  ok(boton && !/[?#=]/.test(boton[1]) && !/\d{5}/.test(boton[1]), 'la cédula no viaja por la URL: sin parámetros ni dígitos');
  const iDonde = fm.indexOf('Dónde votas</h2>'), iBoton = fm.indexOf('class="btn-consulta"'), iLinea = fm.indexOf('Consulta y vuelve aquí para elegir tu puesto y mesa'),
        iCaja = fm.indexOf('id="caja-puesto"'), iPuesto = fm.indexOf('name="puesto_id"'), iMesa = fm.indexOf('name="mesa"');
  ok(iDonde > 0 && iDonde < iBoton && iBoton < iLinea && iLinea < iCaja && iCaja < iPuesto && iPuesto < iMesa, 'orden: título → botón → «Consulta y vuelve aquí…» → Puesto → Mesa', [iDonde, iBoton, iLinea, iCaja, iPuesto, iMesa]);
  ok(/<p class="ayuda">Consulta y vuelve aquí para elegir tu puesto y mesa<\/p>/.test(fm), 'la línea de ayuda debajo del botón dice exactamente lo pedido');
  ok(/a\.btn-consulta\{display:block;[^}]*font-size:1rem[^}]*padding:13px/.test(fm), 'el botón ocupa todo el ancho y mide 1rem con 13 px de relleno (legible a 360 px)');
  ok(!fm.includes('¿No sabes dónde votas?'), 'se quitó el enlace de texto que había debajo del selector');
  ok(fm.includes('Consultar mi lugar de votación') && !fm.includes('Consultar mi puesto en la Registraduría'), 'ya no queda el texto del enlace anterior');

  console.log('  -- la cédula repetida no crea una segunda ficha');
  const cuentaFichas = async (digitos) => (await q(
    "SELECT COUNT(*) c FROM votantes WHERE TRIM(LEADING '0' FROM REGEXP_REPLACE(cedula, '[^0-9]', '')) = ?", [digitos]))[0].c;
  ok(normalizarCedula(' 1.053 123.456 ') === '1053123456' && normalizarCedula('0012345678') === '12345678' && normalizarCedula('abc') === '' && normalizarCedula(null) === '',
    'normalizarCedula: solo dígitos y sin ceros a la izquierda');
  ok(enmascararCedula('1.053.123.456') === '***456', 'enmascararCedula: los últimos tres');
  // Fichas que el alta normal guardó TAL COMO se tecleó
  const vPunt = await votante('1.053.999.111', 'Ficha Con Puntos', '3290000011', l1, { consent: true });
  const vCero = await votante('0012345678', 'Ficha Con Ceros', '3290000021', l1, { consent: true });
  const vLimpia = await votante('1053999333', 'Ficha Limpia', '3290000031', l1, { consent: true });
  const vEsp = await votante(' 1 053 999 444 ', 'Ficha Con Espacios', '3290000041', l1, { consent: true });
  const snap = async (id) => JSON.stringify((await q('SELECT nombre, cedula, telefono, email, direccion, ciudad_residencia, barrio_residencia, latitud, lider_id, rama_aspirante_id, consentimiento_autorizado, consentimiento_confirmado_en FROM votantes WHERE id = ?', [id]))[0]);
  const fichasAntes = (await q('SELECT COUNT(*) c FROM votantes'))[0].c;

  const r1 = await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '1 053 999 111', telefono: '3290000011', nombre: 'Otro Nombre Cualquiera', email: 'nuevo1@correo.co' }) });
  ok(r1.texto.includes('¡Listo!') && await cuentaFichas('1053999111') === 1, 'guardada «1.053.999.111» y escrita «1 053 999 111»: sigue habiendo UNA ficha');
  const [p1] = await q('SELECT cedula, email, nombre FROM votantes WHERE id = ?', [vPunt]);
  ok(p1.cedula === '1.053.999.111' && p1.email === 'nuevo1@correo.co' && p1.nombre === 'Ficha Con Puntos', 'celular coincide: se completa lo vacío (el correo), la cédula guardada NO se reescribe y el nombre no cambia', p1);
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '12.345.678', telefono: '3290000021', nombre: 'Ficha Con Ceros' }) });
  ok(await cuentaFichas('12345678') === 1, 'guardada «0012345678» (ceros) y escrita «12.345.678»: UNA ficha');
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '1.053.999.333', telefono: '3290000031', nombre: 'Ficha Limpia' }) });
  ok(await cuentaFichas('1053999333') === 1, 'guardada limpia y escrita con puntos: UNA ficha');
  await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '01053999444', telefono: '3290000041', nombre: 'Ficha Con Espacios' }) });
  ok(await cuentaFichas('1053999444') === 1, 'guardada con espacios y escrita con un cero delante: UNA ficha');
  ok((await q('SELECT COUNT(*) c FROM votantes'))[0].c === fichasAntes, 'en total, ninguna ficha nueva en las cuatro inscripciones');

  console.log('  -- celular que NO coincide: no se modifica nada, y queda en el intento');
  const antes = await snap(vLimpia);
  const nIntentos0 = (await q("SELECT COUNT(*) c FROM inscripcion_intentos WHERE motivo = 'cedula_existente'"))[0].c;
  const rN = await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '1053999333', telefono: '3299999999', nombre: 'Intruso De Prueba',
    email: 'intruso@correo.co', direccion: 'Calle Falsa 123', ciudad_residencia: 'Otra', barrio_residencia: 'Otro', gps_lat: '5.0689', gps_lon: '-75.5174', canal_sms: '1' }) });
  ok(rN.texto.includes('¡Listo!') && await snap(vLimpia) === antes, 'otro celular: la ficha queda EXACTAMENTE igual (correo, dirección, ciudad, barrio, coordenadas, consentimiento, dueño)');
  ok(await cuentaFichas('1053999333') === 1, '…y no se crea otra ficha');
  const [iN] = await q("SELECT resultado, motivo, cedula_fin, celular_coincide, votante_id FROM inscripcion_intentos WHERE motivo = 'cedula_existente' ORDER BY id DESC LIMIT 1");
  ok(iN && iN.motivo === 'cedula_existente' && iN.cedula_fin === '333' && iN.celular_coincide === 0 && iN.votante_id === vLimpia, 'queda en inscripcion_intentos: motivo «cedula_existente», últimos tres dígitos, celular_coincide = 0 y la ficha', iN);
  ok((await q("SELECT COUNT(*) c FROM inscripcion_intentos WHERE motivo = 'cedula_existente'"))[0].c === nIntentos0 + 1, 'y exactamente un intento nuevo');
  ok((await q('SELECT COUNT(*) c FROM inscripcion_sms_cola WHERE votante_id = ?', [vLimpia]))[0].c === 0, 'con otro celular no se encola ningún SMS a la ficha existente');
  const rC = await pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula: '1.053.999.333', telefono: '3290000031', nombre: 'Ficha Limpia' }) });
  const [iC] = await q("SELECT cedula_fin, celular_coincide FROM inscripcion_intentos WHERE motivo = 'cedula_existente' ORDER BY id DESC LIMIT 1");
  ok(iC.cedula_fin === '333' && iC.celular_coincide === 1, 'con el celular que coincide el intento también queda como «cedula_existente», con celular_coincide = 1', iC);
  const [iNuevo] = await q("SELECT motivo, cedula_fin, celular_coincide FROM inscripcion_intentos WHERE resultado = 'nuevo' ORDER BY id DESC LIMIT 1");
  ok(iNuevo.motivo === null && iNuevo.cedula_fin === null && iNuevo.celular_coincide === null, 'una inscripción de cédula nueva NO lleva motivo ni cédula en el intento');

  console.log('  -- el aviso al líder en «Mi enlace»');
  const miL3 = await pedir('GET', '/api/inscripcion/mi-enlace', { usuario: U(l3, 'lider') });
  const av = miL3.datos && miL3.datos.avisos;
  ok(miL3.status === 200 && Array.isArray(av) && av.length >= 3, 'el líder dueño del enlace recibe la lista «avisos»', av && av.length);
  ok(av.every(a => /^\*\*\*\d{3}$/.test(a.cedula)), 'cada cédula viene enmascarada: «***» y los tres últimos dígitos', av.map(a => a.cedula));
  ok(!/1053999|12345678|9810000|98200000/.test(JSON.stringify(miL3.datos)), 'ninguna cédula completa viaja en la respuesta');
  ok(av.some(a => a.cedula === '***333' && a.celular_coincidia === false) && av.some(a => a.cedula === '***333' && a.celular_coincidia === true), 'dice si el celular coincidía, en los dos casos');
  ok(av.every(a => /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(String(a.fecha))), 'trae la fecha de cada intento', av[0] && av[0].fecha);
  const miL1 = await pedir('GET', '/api/inscripcion/mi-enlace', { usuario: U(l1, 'lider') });
  ok(Array.isArray(miL1.datos.avisos) && !miL1.datos.avisos.some(a => a.cedula === '***333'), 'otro líder NO ve los avisos de este enlace');
  const pagina = fs.readFileSync(path.join(__dirname, '..', 'public/app/mi-enlace.html'), 'utf8');
  ok(/id="aviso-cedulas"/.test(pagina) && /pintarAvisos\(d\.avisos/.test(pagina) && /avisos: undefined/.test(pagina), 'la pantalla «Mi enlace» tiene el bloque del aviso, lo pinta, y no guarda las cédulas enmascaradas en el teléfono');
  ok(/li\.textContent/.test(pagina) && !/innerHTML\s*=\s*[^'"\s]*a\./.test(pagina), 'el texto del aviso se pone con textContent (nada del servidor se interpreta como HTML)');
  ok(/estrategia-v1(5[6789]|6[0123456])/.test(fs.readFileSync(path.join(__dirname, '..', 'public/service-worker.js'), 'utf8')), 'el service worker está en v156 o posterior (mi-enlace.html está en su precache)');

  console.log('  -- la respuesta pública: idéntica para cédula nueva y existente');
  const mismoCuerpo = (a, b) => a.status === b.status && a.texto === b.texto;
  const base = (cedula, tel) => F(e3.codigo, HUELLA, { cedula, telefono: tel, nombre: 'Persona De Prueba Cuatro' });
  const rNueva = await pedir('POST', `/i/${e3.codigo}`, { form: base('9810000011', '3300000011') });
  const rExCoincide = await pedir('POST', `/i/${e3.codigo}`, { form: base('1053999111', '3290000011') });
  const rExOtro = await pedir('POST', `/i/${e3.codigo}`, { form: base('1053999444', '3300000012') });
  ok(rNueva.status === 200 && rNueva.texto.includes('¡Listo!'), 'cédula nueva: «¡Listo!»');
  ok(mismoCuerpo(rNueva, rExCoincide) && mismoCuerpo(rNueva, rExOtro), 'la respuesta es la MISMA, byte a byte, para cédula nueva, existente con su celular y existente con otro celular');
  ok(!/ya (est[aá]|existe|fue)|inscrit|registrad|duplicad/i.test(rExOtro.texto.replace('Gracias por inscribirte', '')), 'no dice «ya está inscrita» ni nada parecido');
  const sms = { canal_sms: '1' };
  const sN = await pedir('POST', `/i/${e3.codigo}`, { form: { ...base('9810000021', '3300000021'), ...sms } });
  const sE = await pedir('POST', `/i/${e3.codigo}`, { form: { ...base('1053999444', '3300000022'), ...sms } });
  ok(mismoCuerpo(sN, sE), 'con la casilla de SMS marcada la respuesta también es la misma (depende de lo que se marcó, no de lo que había)');

  // El tiempo: la mediana de varias pruebas de cada tipo. Cédulas y celulares distintos cada vez (el tope es por celular).
  const mediana = (v) => { const o = [...v].sort((x, y) => x - y); return o[Math.floor(o.length / 2)]; };
  const T = { nueva: [], existeCoincide: [], existeOtro: [] };
  for (let i = 0; i < 9; i++) {
    const ced = `98200000${String(i).padStart(2, '0')}`, tel = `33100000${String(i).padStart(2, '0')}`;
    let t0 = process.hrtime.bigint();
    await pedir('POST', `/i/${e3.codigo}`, { form: base(ced, tel) });
    T.nueva.push(Number(process.hrtime.bigint() - t0) / 1e6);
    t0 = process.hrtime.bigint();
    await pedir('POST', `/i/${e3.codigo}`, { form: base(ced, tel) });
    T.existeCoincide.push(Number(process.hrtime.bigint() - t0) / 1e6);
    t0 = process.hrtime.bigint();
    await pedir('POST', `/i/${e3.codigo}`, { form: base(ced, `33200000${String(i).padStart(2, '0')}`) });
    T.existeOtro.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const med = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, Math.round(mediana(v))]));
  console.log(`  (medianas de 9: nueva ${med.nueva} ms · existente con su celular ${med.existeCoincide} ms · existente con otro celular ${med.existeOtro} ms)`);
  ok(Math.max(...Object.values(med)) - Math.min(...Object.values(med)) <= 60, 'el tiempo de respuesta es parecido: las tres medianas difieren en 60 ms o menos', med);

  } // fin del bloque de la orden 28

  console.log('\n== Mensaje de invitación con eslogan y vista previa del enlace (orden 29)');
  { // bloque propio
  const fs = require('fs'), path = require('path');
  const M = require('../config/inscripcionMensaje');
  const routerInsc = require('../routes/inscripcion.routes');
  const sharp = require('sharp');
  const V = { nombre_lider: 'Ana', candidato: 'María Gómez', eslogan: 'Juntos por Manizales', enlace: 'https://electoral.appestrategia.net/i/AB23CD45' };

  console.log('  -- la plantilla y sus variables');
  const completo = M.armarMensaje(M.PLANTILLA_SUGERIDA, V);
  ok(completo === [
    'Hola 👋, soy Ana.', '✨ Juntos por Manizales', 'Te invito a sumarte al equipo de María Gómez. Juntos vamos a lograrlo.',
    '📝 Inscríbete en menos de 1 minuto, desde tu celular:', '👉 https://electoral.appestrategia.net/i/AB23CD45',
    'Tus datos están protegidos y solo se usan para la campaña. ¡Cuento contigo!'].join('\n'), 'con todos los datos: el texto sugerido, tal cual y con las cuatro variables reemplazadas', completo);
  ok(!/[{}]/.test(completo), 'no queda ninguna llave');
  ok(!/cargo|elecci|\bvot|tarjet|alcald|concej|senado|c[aá]mara|gobern/i.test(M.PLANTILLA_SUGERIDA), 'el texto sugerido NO menciona cargo, elección, voto ni tarjetón (precampaña)');
  ok(M.VARIABLES.join() === 'nombre_lider,candidato,eslogan,enlace', 'las únicas variables: nombre_lider, candidato, eslogan y enlace (sin cargo ni tarjetón)');
  ok(M.primerNombre('GILDARDO ARIAS') === 'Gildardo' && M.primerNombre('  maría josé ') === 'María' && M.primerNombre('') === '', 'primerNombre: solo el primero y bien escrito');

  console.log('  -- variable faltante: la línea completa se quita');
  const sinEsl = M.armarMensaje(M.PLANTILLA_SUGERIDA, { ...V, eslogan: '' });
  ok(!sinEsl.includes('✨') && sinEsl.split('\n').length === 5 && !/[{}]/.test(sinEsl), 'sin eslogan: se va la línea ✨ entera (5 líneas) y no queda «{eslogan}»', sinEsl);
  ok(M.armarMensaje(M.PLANTILLA_SUGERIDA, { ...V, eslogan: '   ' }) === sinEsl, 'un eslogan de solo espacios cuenta como faltante');
  const sinCand = M.armarMensaje(M.PLANTILLA_SUGERIDA, { ...V, candidato: '' });
  ok(!/Te invito/.test(sinCand) && !/ de \./.test(sinCand) && sinCand.includes('✨ Juntos por Manizales'), 'sin candidato: se va «Te invito a sumarte…» entera, sin dejar «equipo de .»', sinCand);
  const sinLider = M.armarMensaje(M.PLANTILLA_SUGERIDA, { ...V, nombre_lider: '' });
  ok(!/Hola/.test(sinLider) && sinLider.startsWith('✨'), 'sin nombre del líder: se va el saludo');
  const solo = M.armarMensaje(M.PLANTILLA_SUGERIDA, { enlace: V.enlace });
  ok(solo === ['📝 Inscríbete en menos de 1 minuto, desde tu celular:', '👉 ' + V.enlace, 'Tus datos están protegidos y solo se usan para la campaña. ¡Cuento contigo!'].join('\n'), 'solo con el enlace: quedan las tres líneas que no dependen de nada', solo);
  const conBlancos = M.armarMensaje('Hola\n\n{eslogan}\n\nTe invito\n\n\n{enlace}\n', { ...V, eslogan: '' });
  ok(conBlancos === 'Hola\n\nTe invito\n\n' + V.enlace && !/\n\n\n/.test(conBlancos), 'nunca dos líneas en blanco seguidas, ni blancos al principio o al final', JSON.stringify(conBlancos));
  ok(!/[{}]/.test(M.armarMensaje('Hola {cargo}\nVota {numero_tarjeton}\n{enlace}', V)) && M.armarMensaje('Hola {cargo}\n{enlace}', V) === V.enlace, 'una llave que no existe ({cargo}) no se muestra: su línea se quita');
  ok(!/\{|\}/.test(M.armarMensaje('{candidato} {enlace}', { ...V, candidato: '{eslogan} {enlace}' })) , 'un dato que trae llaves no se vuelve a expandir');
  console.log('  -- lo que el administrador puede guardar');
  ok(M.validarPlantilla(M.PLANTILLA_SUGERIDA).ok, 'el texto sugerido es válido');
  ok(!M.validarPlantilla('Hola {cargo} {enlace}').ok && /\{cargo\}/.test(M.validarPlantilla('Hola {cargo} {enlace}').error), '{cargo} se rechaza y el error lo nombra');
  ok(!M.validarPlantilla('Hola {candidato}').ok && /enlace/.test(M.validarPlantilla('Hola {candidato}').error), 'sin {enlace} se rechaza');
  ok(!M.validarPlantilla('   ').ok && !M.validarPlantilla('x {enlace}' + 'a'.repeat(1000)).ok && !M.validarPlantilla('Hola { {enlace}').ok, 'vacío, demasiado largo y llave suelta se rechazan');

  console.log('  -- la versión SMS (1 segmento, con los tres dominios)');
  const DOMS = ['electoral.appestrategia.net', 'campanadepruebamunicipal.appestrategia.net', 'campanadepruebadepartamental.appestrategia.net'];
  const medidas = [];
  for (const dom of DOMS) {
    const enlaceSms = `https://${dom}/i/AB23CD45`;
    const normal = M.armarSms({ nombre_lider: 'Ana', candidato: 'María Gómez', eslogan: 'Juntos por Manizales', enlace: enlaceSms });
    const peor = M.armarSms({ nombre_lider: 'Bañuelitos', candidato: 'José Ángel Peñuela Rodríguez de la Vega', eslogan: 'Por una Caldas más justa, más segura y con más oportunidades para todos 🇨🇴', enlace: enlaceSms });
    medidas.push({ dom, normal: normal.caracteres, peor: peor.caracteres });
    ok(normal.texto === `Ana: Juntos por Manizales. Inscribete con Maria Gomez aqui: ${enlaceSms}` && normal.segmentos === 1 && !normal.sinEslogan, `${dom}: «Ana: Juntos por Manizales. Inscribete con Maria Gomez aqui: …» = ${normal.caracteres} caracteres, 1 SMS`, normal);
    ok(/^[\x20-\x7E]+$/.test(normal.texto) && /^[\x20-\x7E]+$/.test(peor.texto), `${dom}: solo ASCII (sin emojis ni tildes)`);
    ok(peor.segmentos === 1 && peor.sinEslogan === true && !/Caldas/.test(peor.texto) && peor.texto.includes(enlaceSms), `${dom}: el peor caso (eslogan largo, nombre largo) no cabe con eslogan → se quita y queda en 1 SMS (${peor.caracteres})`, peor);
  }
  console.log('  largos medidos (normal / peor caso):', JSON.stringify(medidas));
  ok(M.armarSms({ nombre_lider: '', candidato: '', eslogan: '', enlace: 'https://x.co/i/AB23CD45' }).texto === 'Inscribete aqui: https://x.co/i/AB23CD45', 'sin ningún dato: «Inscribete aqui: <enlace>»');
  ok(M.armarSms({ nombre_lider: 'Ana', candidato: 'Luis', eslogan: '¡Vamos!', enlace: 'https://x.co/i/A' }).texto === 'Ana: ¡Vamos!'.replace('¡', '') + ' Inscribete con Luis aqui: https://x.co/i/A', 'un eslogan que ya termina en signo no recibe otro punto');

  console.log('  -- «Mi enlace»: el mensaje ya lleno');
  await pool.query("INSERT IGNORE INTO configuracion_campana (id) VALUES (1)");
  await pool.query("UPDATE configuracion_campana SET nombre_candidato = 'María Gómez', slogan_campana = 'Juntos por Manizales', marca_titulo = NULL, marca_subtitulo = NULL, marca_logo_url = NULL WHERE id = 1");
  routerInsc.limpiarTarjeta();
  const m1 = await pedir('GET', '/api/inscripcion/mi-mensaje', { usuario: U(l1, 'lider') });
  const cod1 = (await pedir('GET', '/api/inscripcion/mi-enlace', { usuario: U(l1, 'lider') })).datos.codigo;
  ok(m1.status === 200 && m1.datos.texto.includes('Hola 👋, soy Lider.') && m1.datos.texto.includes('✨ Juntos por Manizales') && m1.datos.texto.includes('equipo de María Gómez')
     && m1.datos.texto.includes(`👉 https://campana.prueba/i/${cod1}`) && !/[{}]/.test(m1.datos.texto), 'trae el primer nombre del líder, el eslogan, el candidato y SU enlace', m1.datos.texto);
  ok(m1.datos.sms.segmentos === 1 && m1.datos.sms.texto.startsWith('Lider: Juntos por Manizales. Inscribete con Maria Gomez aqui: https://campana.prueba/i/'), 'y la versión SMS de 1 segmento', m1.datos.sms);
  ok(m1.datos.falta_eslogan === false && m1.datos.enlace === `https://campana.prueba/i/${cod1}`, 'dice que sí hay eslogan y devuelve el enlace');
  const m3 = await pedir('GET', '/api/inscripcion/mi-mensaje', { usuario: U(l3, 'lider') });
  ok(m3.status === 200 && m3.datos.texto.includes('equipo de Aspirante Prueba') && !m3.datos.texto.includes('María Gómez') && !m3.datos.texto.includes('✨') && m3.datos.falta_eslogan === true,
     'un líder de un aspirante usa el candidato del ASPIRANTE (no el de la campaña madre) y, sin su eslogan, se quita esa línea', m3.datos && m3.datos.texto);
  ok((await pedir('GET', '/api/inscripcion/mi-mensaje', { usuario: U(admin, 'admin') })).status === 403, 'quien no tiene enlace → 403');
  ok((await pedir('GET', '/api/inscripcion/mi-mensaje')).status === 401, 'sin sesión → 401');
  await pool.query("UPDATE configuracion_campana SET slogan_campana = NULL, marca_subtitulo = NULL WHERE id = 1");
  const m1b = await pedir('GET', '/api/inscripcion/mi-mensaje', { usuario: U(l1, 'lider') });
  ok(!m1b.datos.texto.includes('✨') && m1b.datos.falta_eslogan === true && !/[{}]/.test(m1b.datos.texto) && !/\n\n/.test(m1b.datos.texto), 'sin eslogan en la campaña: la línea se quita, sin llaves ni líneas vacías');
  await pool.query("UPDATE configuracion_campana SET slogan_campana = NULL, marca_subtitulo = 'Lema del encabezado' WHERE id = 1");
  ok((await pedir('GET', '/api/inscripcion/mi-mensaje', { usuario: U(l1, 'lider') })).datos.texto.includes('✨ Lema del encabezado'), 'si falta el eslogan pero hay subtítulo de marca, se usa ese');
  await pool.query("UPDATE configuracion_campana SET slogan_campana = 'Juntos por Manizales', marca_subtitulo = NULL WHERE id = 1");

  console.log('  -- la plantilla de la campaña: editar y restaurar (solo el administrador)');
  const g0 = await pedir('GET', '/api/inscripcion/plantilla', { usuario: U(admin, 'admin') });
  ok(g0.status === 200 && g0.datos.personalizada === false && g0.datos.plantilla === M.PLANTILLA_SUGERIDA && g0.datos.sugerida === M.PLANTILLA_SUGERIDA && g0.datos.eslogan_configurado === true,
     'el administrador ve la plantilla sugerida, sin personalizar', g0.datos && g0.datos.personalizada);
  ok(/Hola 👋, soy Ana\./.test(g0.datos.vista_previa) && g0.datos.vista_previa_sms.segmentos === 1, 'con vista previa y la versión SMS de ejemplo');
  ok((await pedir('GET', '/api/inscripcion/plantilla', { usuario: U(coord, 'coordinador') })).status === 403 && (await pedir('PUT', '/api/inscripcion/plantilla', { usuario: U(l1, 'lider'), json: { plantilla: 'x {enlace}' } })).status === 403,
     'un coordinador no la lee y un líder no la guarda (403)');
  const propia = 'Soy {nombre_lider} 🙌\n{eslogan}\nEntra aquí: {enlace}';
  const p1 = await pedir('PUT', '/api/inscripcion/plantilla', { usuario: U(admin, 'admin'), json: { plantilla: propia } });
  ok(p1.status === 200 && p1.datos.personalizada === true && p1.datos.plantilla === propia, 'el administrador guarda su propio texto', p1.datos);
  ok((await q('SELECT mensaje_plantilla t FROM inscripcion_config WHERE id = 1'))[0].t === propia, '…y queda en inscripcion_config.mensaje_plantilla');
  const m1c = await pedir('GET', '/api/inscripcion/mi-mensaje', { usuario: U(l1, 'lider') });
  ok(m1c.datos.texto === `Soy Lider 🙌\nJuntos por Manizales\nEntra aquí: https://campana.prueba/i/${cod1}`, 'y «Mi enlace» ya usa ese texto', m1c.datos.texto);
  const malo1 = await pedir('PUT', '/api/inscripcion/plantilla', { usuario: U(admin, 'admin'), json: { plantilla: 'Vota por {candidato} para {cargo}: {enlace}' } });
  ok(malo1.status === 400 && /\{cargo\}/.test(malo1.datos.error), 'una plantilla con {cargo} se rechaza (400) con el motivo', malo1.datos);
  ok((await pedir('PUT', '/api/inscripcion/plantilla', { usuario: U(admin, 'admin'), json: { plantilla: 'Entra: {candidato}' } })).status === 400, 'una sin {enlace} se rechaza (400)');
  ok((await q('SELECT mensaje_plantilla t FROM inscripcion_config WHERE id = 1'))[0].t === propia, '…y lo rechazado no pisó lo guardado');
  const r1 = await pedir('PUT', '/api/inscripcion/plantilla', { usuario: U(admin, 'admin'), json: { plantilla: null } });
  ok(r1.status === 200 && r1.datos.personalizada === false && r1.datos.plantilla === M.PLANTILLA_SUGERIDA && (await q('SELECT mensaje_plantilla t FROM inscripcion_config WHERE id = 1'))[0].t === null,
     '«Restaurar texto sugerido» (plantilla null) vuelve al sugerido y deja la columna en NULL');
  await pedir('PUT', '/api/inscripcion/plantilla', { usuario: U(admin, 'admin'), json: { plantilla: propia } });
  await pedir('PUT', '/api/inscripcion/plantilla', { usuario: U(admin, 'admin'), json: { plantilla: M.PLANTILLA_SUGERIDA } });
  ok((await q('SELECT mensaje_plantilla t FROM inscripcion_config WHERE id = 1'))[0].t === null, 'guardar un texto idéntico al sugerido lo deja en NULL (así recibe las mejoras futuras)');
  ok((await q("SELECT COUNT(*) c FROM auditoria WHERE accion IN ('editar_mensaje_inscripcion','restaurar_mensaje_inscripcion')"))[0].c >= 3, 'cada cambio queda en la auditoría');

  console.log('  -- una campaña que aún no corrió init-db (sin la columna) no se cae');
  await pool.query('ALTER TABLE inscripcion_config DROP COLUMN mensaje_plantilla');
  const msc = await pedir('GET', '/api/inscripcion/mi-mensaje', { usuario: U(l1, 'lider') });
  ok(msc.status === 200 && msc.datos.texto.includes('Hola 👋, soy Lider.'), 'sin la columna, «Mi enlace» usa el texto sugerido');
  ok((await pedir('GET', `/i/${e3.codigo}`)).texto.includes('Te inscribe'), 'y la página /i sigue sirviendo');
  const psc = await pedir('PUT', '/api/inscripcion/plantilla', { usuario: U(admin, 'admin'), json: { plantilla: propia } });
  ok(psc.status === 409 && /init-db/.test(psc.datos.error), 'guardar dice que falta actualizar la base (409), no un 500', psc.datos);
  await pool.query("ALTER TABLE inscripcion_config ADD COLUMN mensaje_plantilla TEXT NULL");

  console.log('  -- la vista previa del enlace (Open Graph)');
  const og = (html) => (html.match(/<meta (?:property="og:[^"]+"|name="(?:description|twitter:card)")[^>]*>/g) || []).join('\n');
  routerInsc.limpiarTarjeta();
  const gv = await pedir('GET', `/i/${e3.codigo}`);
  const ogv = og(gv.texto);
  ok(ogv.includes('<meta property="og:title" content="María Gómez · Juntos por Manizales">'), 'og:title con eslogan: «María Gómez · Juntos por Manizales»', ogv);
  ok(ogv.includes('<meta property="og:description" content="Súmate al equipo. Inscríbete en menos de 1 minuto.">'), 'og:description: «Súmate al equipo. Inscríbete en menos de 1 minuto.»');
  ok(ogv.includes('<meta property="og:image" content="https://campana.prueba/img/inscripcion-og.png">') && ogv.includes('og:image:width" content="1200"') && ogv.includes('og:image:height" content="630"'), 'sin logo: og:image es la imagen genérica 1200 × 630, con URL absoluta del dominio de la licencia', ogv);
  ok(/noindex/.test(gv.texto) && gv.texto.includes('<meta name="robots" content="noindex, nofollow">'), 'se mantiene noindex');
  ok(!/Lider Uno|Lider Tres|Lider Dos/.test(ogv) && !ogv.includes(e3.codigo), 'la vista previa no lleva el nombre del líder ni el código');
  await pool.query("UPDATE configuracion_campana SET slogan_campana = NULL, marca_subtitulo = NULL WHERE id = 1");
  routerInsc.limpiarTarjeta();
  const ogSin = og((await pedir('GET', `/i/${e3.codigo}`)).texto);
  ok(ogSin.includes('<meta property="og:title" content="Inscríbete con María Gómez">') && !ogSin.includes('·'), 'og:title sin eslogan: «Inscríbete con María Gómez»', ogSin);
  await pool.query("UPDATE configuracion_campana SET nombre_candidato = NULL, marca_titulo = NULL WHERE id = 1");
  routerInsc.limpiarTarjeta();
  ok(og((await pedir('GET', `/i/${e3.codigo}`)).texto).includes('content="Inscríbete con nuestro equipo"'), 'sin candidato ni eslogan: «Inscríbete con nuestro equipo»');
  await pool.query("UPDATE configuracion_campana SET nombre_candidato = 'María <b>&\"Gómez', slogan_campana = 'Juntos por Manizales' WHERE id = 1");
  routerInsc.limpiarTarjeta();
  const ogEsc = og((await pedir('GET', `/i/${e3.codigo}`)).texto);
  ok(!/<b>/.test(ogEsc) && ogEsc.includes('María &lt;b&gt;&amp;&quot;Gómez'), 'los datos de la campaña se escapan en las metas');
  await pool.query("UPDATE configuracion_campana SET nombre_candidato = 'María Gómez', slogan_campana = 'Juntos por Manizales' WHERE id = 1");
  routerInsc.limpiarTarjeta();

  // IDÉNTICO para código inválido
  const ref = og((await pedir('GET', `/i/${e3.codigo}`)).texto);
  await pool.query('UPDATE inscripcion_enlaces SET activo = 0 WHERE id = ?', [e2.id]);
  const casos = { inexistente: await pedir('GET', '/i/ZZZZZZZZ'), 'mal formado': await pedir('GET', '/i/hola'), desactivado: await pedir('GET', `/i/${e2.codigo}`), 'con otro líder': await pedir('GET', `/i/${e1.codigo}`) };
  await pool.query('UPDATE inscripcion_enlaces SET activo = 1 WHERE id = ?', [e2.id]);
  for (const [k, r] of Object.entries(casos)) ok(og(r.texto) === ref && ref.length > 100, `la vista previa de un código ${k} es IDÉNTICA a la de uno válido`);
  ok(casos.inexistente.texto.includes('Enlace no activo') && casos.inexistente.status === 200, '…y la página de un código inválido sigue diciendo «Enlace no activo»');
  ok(casos.inexistente.texto === casos.desactivado.texto && casos.inexistente.texto === casos['mal formado'].texto, 'los códigos inválidos siguen respondiendo lo mismo, byte a byte');
  const politica = await pedir('GET', `/i/${e3.codigo}/politica`);
  ok(politica.status === 200, 'la política sigue abriendo');
  const lic = process.env.LICENCIA_DOMINIO; process.env.LICENCIA_DOMINIO = '';
  ok(!/og:image/.test((await pedir('GET', `/i/${e3.codigo}`)).texto) && /og:title/.test((await pedir('GET', `/i/${e3.codigo}`)).texto), 'sin dominio de licencia no se inventa una URL de imagen (igual que /v)');
  process.env.LICENCIA_DOMINIO = lic;

  console.log('  -- la imagen: el logo de la campaña, o la genérica');
  const generica = await fetch(`${base}/i/og/imagen`);
  const bufG = Buffer.from(await generica.arrayBuffer());
  const metaG = await sharp(bufG).metadata();
  ok(generica.status === 200 && /image\/png/.test(generica.headers.get('content-type')) && metaG.width === 1200 && metaG.height === 630 && bufG.length < 100 * 1024, `sin logo: /i/og/imagen sirve la genérica (PNG 1200×630, ${(bufG.length / 1024).toFixed(1)} KB)`);
  ok(/public/.test(generica.headers.get('cache-control') || ''), 'se puede guardar en caché');
  const carpeta = path.join(__dirname, '..', 'uploads', 'marca'); fs.mkdirSync(carpeta, { recursive: true });
  const archivoLogo = path.join(carpeta, 'logo_prueba_orden29.png');
  try {
    // Un logo pesado a propósito: un PNG de ruido de 1400×1400 (varios MB), el peor caso de lo que una campaña sube.
    const ruido = Buffer.alloc(1400 * 1400 * 3); for (let i = 0; i < ruido.length; i++) ruido[i] = (i * 2654435761 >>> 7) & 255;
    await sharp(ruido, { raw: { width: 1400, height: 1400, channels: 3 } }).png({ compressionLevel: 1 }).toFile(archivoLogo);
    const pesoOriginal = fs.statSync(archivoLogo).size;
    await pool.query("UPDATE configuracion_campana SET marca_logo_url = '/uploads/marca/logo_prueba_orden29.png' WHERE id = 1");
    routerInsc.limpiarTarjeta();
    const conLogo = await pedir('GET', `/i/${e3.codigo}`);
    ok(/<meta property="og:image" content="https:\/\/campana\.prueba\/i\/og\/imagen\?v=[0-9a-z]+">/.test(conLogo.texto), 'con logo: og:image apunta a /i/og/imagen (la copia ligera), con versión para refrescar la caché');
    const rl = await fetch(`${base}/i/og/imagen`);
    const bufL = Buffer.from(await rl.arrayBuffer());
    const metaL = await sharp(bufL).metadata();
    ok(rl.status === 200 && /image\/jpeg/.test(rl.headers.get('content-type')) && metaL.width === 1200 && metaL.height === 630 && bufL.length <= 400 * 1024,
       `la copia del logo es JPEG 1200×630 de ${(bufL.length / 1024).toFixed(0)} KB (el original pesaba ${(pesoOriginal / 1048576).toFixed(1)} MB)`, { pesoOriginal, copia: bufL.length, ancho: metaL.width, alto: metaL.height, tipo: rl.headers.get('content-type'), estado: rl.status });
    // Fondo según el logo: uno claro con transparencia (hecho para fondos oscuros) desaparecería sobre blanco.
    const esquina = async () => { const { data } = await sharp(Buffer.from(await (await fetch(`${base}/i/og/imagen`)).arrayBuffer())).extract({ left: 5, top: 5, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true }); return [...data]; };
    const cuadro = (color) => sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: { create: { width: 300, height: 100, channels: 4, background: color } }, gravity: 'center' }]).png().toFile(archivoLogo);
    await cuadro({ r: 255, g: 255, b: 255, alpha: 1 }); routerInsc.limpiarTarjeta();
    const cClaro = await esquina();
    ok(cClaro[0] < 60 && cClaro[2] < 90, 'un logo BLANCO con transparencia va sobre el azul de la app (no desaparece sobre blanco)', cClaro);
    await cuadro({ r: 20, g: 40, b: 90, alpha: 1 }); routerInsc.limpiarTarjeta();
    const cOscuro = await esquina();
    ok(cOscuro.every(v => v > 245), 'un logo oscuro con transparencia va sobre blanco', cOscuro);
    // Un logo que no es una imagen: no se cae, sale la genérica
    fs.writeFileSync(archivoLogo, 'esto no es una imagen');
    routerInsc.limpiarTarjeta();
    const rr = await fetch(`${base}/i/og/imagen`);
    ok(rr.status === 200 && /image\/png/.test(rr.headers.get('content-type')), 'un archivo de logo ilegible no tumba la tarjeta: sale la genérica');
  } finally { try { fs.unlinkSync(archivoLogo); } catch (_) { /* ya no estaba */ } }
  await pool.query("UPDATE configuracion_campana SET marca_logo_url = '/uploads/marca/../../package.json' WHERE id = 1");
  routerInsc.limpiarTarjeta();
  const rt = await fetch(`${base}/i/og/imagen`);
  ok(rt.status === 200 && /image\/png/.test(rt.headers.get('content-type')), 'una ruta con «..» no sale de /uploads/marca: sale la genérica');
  ok(/inscripcion-og\.png/.test((await pedir('GET', `/i/${e3.codigo}`)).texto), '…y la tarjeta apunta a la genérica');
  await pool.query("UPDATE configuracion_campana SET marca_logo_url = NULL WHERE id = 1");
  routerInsc.limpiarTarjeta();
  ok(fs.existsSync(path.join(__dirname, '..', 'public/img/inscripcion-og.png')), 'public/img/inscripcion-og.png existe');

  console.log('  -- la pantalla «Mi enlace» y el escritorio');
  const pag = fs.readFileSync(path.join(__dirname, '..', 'public/app/mi-enlace.html'), 'utf8');
  ok(/id="mensaje-texto"/.test(pag) && /id="mensaje-sms"/.test(pag) && /id="btn-sms"/.test(pag) && /id="btn-whatsapp"/.test(pag) && />Copiar mensaje</.test(pag), 'Mi enlace: cuadro del mensaje, cuadro del SMS y los botones WhatsApp, SMS y Copiar mensaje');
  ok(/sms:\?&body=/.test(pag) && /wa\.me\/\?text=/.test(pag) && /\/inscripcion\/mi-mensaje/.test(pag), 'los botones usan el texto de los cuadros (WhatsApp con wa.me, SMS con sms:?&body=) y el mensaje viene del servidor');
  ok(!/Inscríbete con mi equipo aquí: ' \+ url\)/.test(pag) && /mensajePorOmision/.test(pag), 'el texto sencillo de antes quedó solo como respaldo sin conexión');
  ok(/Puedes cambiarlo aquí solo para este envío/.test(pag) && !/localStorage\.setItem\([^)]*mensaje-texto/.test(pag), 'se puede editar solo para ese envío (no se guarda)');
  const esc = fs.readFileSync(path.join(__dirname, '..', 'public/votantes.html'), 'utf8');
  ok(/id="aj-insc-plantilla"/.test(esc) && /Restaurar texto sugerido/.test(esc) && /\{nombre_lider\}/.test(esc) && /Slogan de la campaña/.test(fs.readFileSync(path.join(__dirname, '..', 'public/configuracion.html'), 'utf8')),
     'el escritorio tiene el editor de la plantilla con «Restaurar texto sugerido»; el eslogan ya se llena en Configuración');
  ok(/estrategia-v1(5[789]|6[0123456])/.test(fs.readFileSync(path.join(__dirname, '..', 'public/service-worker.js'), 'utf8')), 'el service worker está en v157 o posterior');
  } // fin del bloque de la orden 29

  console.log('\n== Cédulas sin duplicados en el alta, la edición, la importación y los cruces (orden 30)');
  { // bloque propio
  const path = require('path');
  const bcrypt = require('bcryptjs');
  const XLSX = require('xlsx');
  const { spawnSync } = require('child_process');
  const { validarCedula } = require('../lib/validarCedula');
  const { normalizarCedula, buscarFichaConCedula, mapaDeFichasPorCedula, buscarUsuarioPorCedula } = require('../lib/normalizarCedula');
  const ramasLib = require('../lib/ramas');
  const { supervisorDelTestigo } = require('../config/testigoElectoral');
  const sync = require('../config/sincronizacionVotantesEstructura');
  const { reporte, imprimir } = require('./reporte-cedulas');

  await pool.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [await bcrypt.hash('clave-prueba', 4), admin]);
  const cuentaFichas = async (digitos) => (await q("SELECT COUNT(*) c FROM votantes WHERE cedula IS NOT NULL AND TRIM(LEADING '0' FROM REGEXP_REPLACE(cedula, '[^0-9]', '')) = ?", [digitos]))[0].c;
  const alta = (cuerpo, quien = l1) => pedir('POST', '/api/votantes', { usuario: U(quien, 'lider'), json: { categoria: 'votante', telefono: '3310000000', consentimiento_autorizado: true, nombre: 'Persona Alta Prueba', ...cuerpo } });

  console.log('  -- alta normal: se guarda solo con dígitos');
  const a1 = await alta({ cedula: '1.053.777.001', telefono: '3310000001' });
  ok(a1.status === 200 && (await q("SELECT cedula c FROM votantes WHERE id = ?", [a1.datos.id]))[0].c === '1053777001', 'alta con puntos «1.053.777.001»: se guarda «1053777001»', a1.datos);
  const a2 = await alta({ cedula: ' 1 053 777 002 ', telefono: '3310000002' });
  ok(a2.status === 200 && (await q("SELECT cedula c FROM votantes WHERE id = ?", [a2.datos.id]))[0].c === '1053777002', 'alta con espacios: solo dígitos');
  const a3 = await alta({ cedula: '01053777003', telefono: '3310000003' });
  ok(a3.status === 200 && (await q("SELECT cedula c FROM votantes WHERE id = ?", [a3.datos.id]))[0].c === '1053777003', 'alta con un cero delante: sin el cero');
  const a4 = await alta({ telefono: '3310000004', nombre: 'Persona Sin Cedula' });
  ok(a4.status === 200 && (await q("SELECT cedula c FROM votantes WHERE id = ?", [a4.datos.id]))[0].c === null, 'sin cédula sigue siendo posible (queda NULL)');
  for (const [mala, que] of [['abc', 'letras'], ['12', 'demasiado corta'], ['0000000', 'solo ceros'], ['1-053-777-005', 'con guiones']]) {
    const r = await alta({ cedula: mala, telefono: '3310000005' });
    const esperado = validarCedula({ cedula: mala, primerNombre: 'Persona', primerApellido: 'Prueba' }, []).mensajes[0] || 'El número de cédula no es válido.';
    ok(r.status === 400 && r.datos.error === esperado, `cédula «${mala}» (${que}): se rechaza con el MISMO mensaje de siempre`, { got: r.datos, esperado });
  }

  console.log('  -- alta de una variante de una cédula que ya existe');
  const vVieja = await votante('1.053.777.010', 'Ficha Vieja Con Puntos', '3310000010', l1, { consent: true });
  const dup1 = await alta({ cedula: '1053777010', telefono: '3310000011' });
  ok(dup1.status === 400 && dup1.datos.error === 'Ya registrado por otro líder.', 'guardada «1.053.777.010» y escrita «1053777010»: se rechaza con el mensaje de siempre', dup1.datos);
  const dup2 = await alta({ cedula: '01.053.777.010', telefono: '3310000012' });
  ok(dup2.status === 400 && dup2.datos.error === 'Ya registrado por otro líder.', 'escrita con un cero y puntos: también');
  const dup3 = await alta({ cedula: '1053777001', telefono: '3310000013' });
  ok(dup3.status === 400 && dup3.datos.error === 'Ya registrado por otro líder.', 'y la idéntica de siempre, con el mismo mensaje');
  ok(await cuentaFichas('1053777010') === 1 && await cuentaFichas('1053777001') === 1, '…y no se creó ninguna ficha nueva');
  const dupAjena = await alta({ cedula: '1053777010', telefono: '3310000014' }, l2);
  ok(dupAjena.status === 400 && dupAjena.datos.error === 'Ya registrado por otro líder.' && !/Ficha Vieja|3310000010/.test(JSON.stringify(dupAjena.datos)), 'para un líder de otra rama el mensaje es el mismo y no trae datos de la ficha');
  const bu = await pedir('GET', '/api/votantes/buscar-por-cedula?cedula=01053777010', { usuario: U(l1, 'lider') });
  ok(bu.status === 200 && bu.datos && bu.datos.id === vVieja, 'buscar-por-cedula (lo que consulta el formulario antes de guardar) encuentra la ficha vieja con la cédula escrita como sea (para su dueño; a otro líder desde la orden 31 solo le dice que existe)');
  const buAjeno = await pedir('GET', '/api/votantes/buscar-por-cedula?cedula=01053777010', { usuario: U(l2, 'lider') });
  ok(buAjeno.status === 200 && buAjeno.datos && buAjeno.datos.de_otro_lider === true && !('id' in buAjeno.datos), 'y a un líder ajeno la misma cédula con ceros y puntos le responde solo que existe');
  const ve = await pedir('GET', '/api/votantes/verificar-identificacion?numero=1.053.777.010', { usuario: U(l1, 'lider') });
  const ve2 = await pedir('GET', `/api/votantes/verificar-identificacion?numero=1053777010&excluir_id=${vVieja}`, { usuario: U(l1, 'lider') });
  const ve3 = await pedir('GET', '/api/votantes/verificar-identificacion?numero=1053777999', { usuario: U(l1, 'lider') });
  ok(ve.datos.disponible === false && ve2.datos.disponible === true && ve3.datos.disponible === true, 'verificar-identificacion: ocupada, libre para la propia ficha y libre si no existe');

  console.log('  -- edición');
  const vA = await votante('1053777020', 'Ficha Edicion A', '3310000020', l1, { consent: true });
  const vB = await votante('1.053.777.021', 'Ficha Edicion B', '3310000021', l1, { consent: true });
  const editar = (id, cuerpo) => pedir('PUT', `/api/votantes/${id}`, { usuario: U(admin, 'admin'), json: { categoria: 'votante', nombre: 'Ficha Edicion', telefono: '3310000099', password: 'clave-prueba', ...cuerpo } });   // contraseña de ejemplo, inventada para esta prueba (no es de nadie)
  const e1x = await editar(vB, { cedula: '1053777020' });
  ok(e1x.status === 400 && e1x.datos.error === 'Ya registrado por otro líder.' && (await q('SELECT cedula c FROM votantes WHERE id = ?', [vB]))[0].c === '1.053.777.021', 'cambiar B a la cédula de A se rechaza y B queda como estaba');
  const e2x = await editar(vB, { cedula: '01.053.777.020' });
  ok(e2x.status === 400 && e2x.datos.error === 'Ya registrado por otro líder.', '…también escrita con puntos y un cero');
  const e3x = await editar(vB, { cedula: '1.053.777.021' });
  ok(e3x.status === 200 && (await q('SELECT cedula c FROM votantes WHERE id = ?', [vB]))[0].c === '1053777021', 'guardar B con su propia cédula (vieja, con puntos) no choca consigo misma y queda normalizada');
  const e4x = await editar(vA, { cedula: '1.053.777.020' });
  ok(e4x.status === 200 && (await q('SELECT cedula c FROM votantes WHERE id = ?', [vA]))[0].c === '1053777020', 'editar A con puntos: se guarda solo con dígitos');
  const e5x = await editar(vA, { cedula: 'abc' });
  ok(e5x.status === 400, 'una cédula inválida se rechaza también al editar');
  const e6x = await editar(vA, { cedula: '1053777030' });
  ok(e6x.status === 200 && (await q('SELECT cedula c FROM votantes WHERE id = ?', [vA]))[0].c === '1053777030', 'cambiar a una cédula libre sí se puede');

  console.log('  -- importación por Excel');
  const vImp = await votante('1.053.778.099', 'Ficha Para Actualizar Por Excel', '3310000098', l1, { consent: true });
  const importar = async (filas) => {
    const hoja = XLSX.utils.aoa_to_sheet([['ID', 'Nombres y apellidos', 'Número de identificación', 'Teléfono'], ...filas]);
    const libro = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(libro, hoja, 'Votantes');
    const buf = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
    const fd = new FormData(); fd.append('archivo', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'votantes.xlsx');
    const r = await fetch(base + '/api/votantes/importar-excel', { method: 'POST', headers: { 'X-Forwarded-For': ipNueva(), 'X-Test-User': JSON.stringify(U(admin, 'admin')) }, body: fd });
    const texto = await r.text(); let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* html */ }
    return { status: r.status, texto, datos };
  };
  const imp = await importar([
    ['', 'Import Nuevo Uno', '1.053.778.001', '3330000001'],      // fila 2: se importa
    ['', 'Import Repetido Archivo', '1053778001', '3330000002'],  // fila 3: repetida EN EL ARCHIVO (misma que la 2)
    ['', 'Import Contra La Base', '1053777010', '3330000003'],     // fila 4: repetida CONTRA LA BASE («1.053.777.010» guardada)
    ['', 'Import Con Cero', '01053778002', '3330000004'],          // fila 5: se importa, sin el cero
    ['', 'Import Cedula Mala', 'abc', '3330000005'],               // fila 6: inválida
    ['', 'Import Sin Cedula', '', '3330000006'],                   // fila 7: sin cédula, se importa
    [vImp, 'Import Actualiza Propia', '1053778099', '3330000007'], // fila 8: actualiza SU ficha (guardada con puntos): permitido
    [vImp, 'Import Actualiza Ajena', '1053777020x', '3330000008'], // fila 9: cédula con una letra: inválida
  ]);
  ok(imp.status === 200 && imp.datos.insertados === 3 && imp.datos.actualizados === 1, 'importa las que corresponden: 3 nuevas y 1 actualizada', imp.datos);
  const rep = imp.datos.cedulasRepetidas || [];
  ok(rep.length === 2 && rep[0].fila === 3 && rep[0].donde === 'archivo' && rep[0].cedula === '***001' && rep[0].otraFila === 2 && rep[1].fila === 4 && rep[1].donde === 'base' && rep[1].cedula === '***010',
     'las repetidas se saltan y se reportan con su número de fila (3: del archivo, 4: de la base) y la cédula enmascarada', rep);
  ok(!/1053778001|1053777010|1\.053\.7/.test(imp.texto), 'la respuesta NO trae ninguna cédula completa');
  ok((imp.datos.errores || []).some(e => e.fila === 3 && /repetida/i.test(e.error)) && (imp.datos.errores || []).some(e => e.fila === 6) && (imp.datos.errores || []).some(e => e.fila === 9), 'las repetidas y las inválidas aparecen también en «errores» (lo que ya muestra la pantalla)');
  ok(await cuentaFichas('1053778001') === 1 && await cuentaFichas('1053778002') === 1 && await cuentaFichas('1053777010') === 1, 'en la base: una sola ficha por cédula');
  ok((await q("SELECT cedula c FROM votantes WHERE nombre = 'Import Nuevo Uno'"))[0].c === '1053778001' && (await q("SELECT cedula c FROM votantes WHERE nombre = 'Import Con Cero'"))[0].c === '1053778002', 'lo importado queda con solo dígitos');
  ok((await q("SELECT cedula c FROM votantes WHERE id = ?", [vImp]))[0].c === '1053778099', 'la fila que actualiza su propia ficha no choca consigo misma y deja la cédula normalizada');
  ok((await q("SELECT COUNT(*) c FROM votantes WHERE nombre = 'Import Cedula Mala' OR nombre = 'Import Repetido Archivo' OR nombre = 'Import Contra La Base'"))[0].c === 0, 'las saltadas no entraron');
  const imp2 = await importar([[vImp, 'Import Actualiza Ajena', '1.053.777.020', '3330000008']]);   // la cédula de la ficha A (1053777030 ahora; la 020 quedó libre)
  const imp3 = await importar([[vImp, 'Import Actualiza Ajena', '1.053.777.021', '3330000008']]);   // la cédula de B (1053777021)
  ok(imp3.datos.actualizados === 0 && (imp3.datos.cedulasRepetidas || []).length === 1 && imp3.datos.cedulasRepetidas[0].donde === 'base', 'modo actualizar con la cédula de OTRA ficha (escrita con puntos): se salta', imp3.datos);
  ok(imp2.datos.actualizados === 1, 'y con una cédula libre sí actualiza', imp2.datos);
  const jsonImp = await pedir('POST', '/api/votantes/importar', { usuario: U(admin, 'admin'), json: { registros: [
    { nombre: 'Json Nuevo Uno', cedula: '1.053.778.201' }, { nombre: 'Json Repetido', cedula: '1053778201' }, { nombre: 'Json Contra Base', cedula: '01053777010' }, { nombre: 'Json Mala', cedula: 'zzz' },
  ] } });
  ok(jsonImp.status === 200 && jsonImp.datos.insertados === 1 && (jsonImp.datos.cedulasRepetidas || []).length === 2 && (await q("SELECT cedula c FROM votantes WHERE nombre = 'Json Nuevo Uno'"))[0].c === '1053778201', 'la importación JSON (/importar) aplica las mismas reglas', jsonImp.datos);

  console.log('  -- cruces con usuarios, escritos distinto en cada tabla');
  const rolLider = (await q("SELECT id FROM roles WHERE nombre = 'lider'"))[0].id;
  const cuenta = async (numero, nombre) => (await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, 'x', ?, 1)`,
    [nombre, numero, 'u' + String(numero).replace(/\D/g, ''), rolLider]))[0].insertId;
  const uPunt = await cuenta('1.053.779.001', 'Cuenta Con Puntos Uno');
  const fLimpia = await votante('1053779001', 'Ficha Limpia Uno', '3340000001', l1, { consent: true });
  await estructura(uPunt, 'lider', coord);
  ok((await buscarUsuarioPorCedula(pool, '1053779001')).id === uPunt && (await buscarUsuarioPorCedula(pool, normalizarCedula('01.053.779.001'))).id === uPunt && (await buscarUsuarioPorCedula(pool, '1053779999')) === null, 'buscarUsuarioPorCedula: cuenta «1.053.779.001» se encuentra con la cédula limpia, con ceros o con puntos');
  ok(await ramasLib.usuarioDeVotante(pool, { cedula: '1053779001' }) === uPunt && await ramasLib.usuarioDeVotante(pool, { cedula: '1.053.779.001' }) === uPunt, 'lib/ramas: la ficha «1053779001» casa con la cuenta «1.053.779.001» (y al revés)');
  const lista = await pedir('GET', '/api/votantes?limit=1000', { usuario: U(admin, 'admin') });
  const filaLista = (lista.datos.data || []).find(x => x.id === fLimpia);
  ok(lista.status === 200 && filaLista && filaLista.cargo_estructura === 'lider', 'el LISTADO de votantes (unión SQL normalizada) reconoce que esa ficha es la de la cuenta con puntos', filaLista && filaLista.cargo_estructura);
  const uLimpia = await cuenta('1053779002', 'Cuenta Limpia Dos');
  const fPunt = await votante('1.053.779.002', 'Ficha Con Puntos Dos', '3340000002', l1, { consent: true });
  await estructura(uLimpia, 'lider', coord);
  const lista2 = await pedir('GET', '/api/votantes?limit=1000', { usuario: U(admin, 'admin') });
  ok(((lista2.datos.data || []).find(x => x.id === fPunt) || {}).cargo_estructura === 'lider', 'y al revés: ficha «1.053.779.002» con cuenta «1053779002»');
  const exp = await fetch(base + '/api/votantes/exportar-excel', { headers: { 'X-Test-User': JSON.stringify(U(admin, 'admin')), 'X-Forwarded-For': ipNueva() } });
  ok(exp.status === 200, 'la exportación sigue funcionando con la unión normalizada');
  const total = await pedir('GET', '/api/votantes?limit=5', { usuario: U(admin, 'admin') });
  ok(total.status === 200 && Number(total.datos.total) > 50, 'el conteo del listado también (misma unión)', total.datos && total.datos.total);
  const sim = await ramasLib.recalcularTodas(pool, { simular: true });
  ok(sim && sim.revisados > 50 && Array.isArray(sim.cambios), 'recalcularTodas (unión de ramas) corre con la comparación normalizada', sim && sim.revisados);
  const uTest = await cuenta('1.053.779.003', 'Cuenta Testigo Tres');
  await votante('1053779003', 'Ficha Del Testigo Tres', '3340000003', l1, { consent: true });
  ok(await supervisorDelTestigo(pool, uTest) === l1, 'supervisorDelTestigo: la cuenta «1.053.779.003» encuentra a su jefe por la ficha «1053779003»');

  console.log('  -- sincronización con Estructura territorial');
  const uSync = await cuenta('1.053.779.004', 'Cuenta Sync Cuatro');
  const fSync = await votante('1053779004', 'Persona Estructura Cuatro', '3320000004', l1, { consent: true });
  await sync.sincronizarVotanteDesdeEstructura(pool, { numero_identificacion: '1.053.779.004', nombre: 'Persona Estructura Cuatro', telefono: '3320000004', creado_por: admin, supervisor_id: l1 });
  ok(await cuentaFichas('1053779004') === 1 && (await q('SELECT cedula c FROM votantes WHERE id = ?', [fSync]))[0].c === '1053779004', 'estructura → votantes: la cuenta con puntos NO crea una segunda ficha y no toca la cédula de la existente');
  const fSync2 = await votante('1.053.779.007', 'Persona Estructura Siete', '3320000007', l1, { consent: true });
  await sync.sincronizarVotanteDesdeEstructura(pool, { numero_identificacion: '1053779007', nombre: 'Persona Estructura Siete', telefono: '3320000007', creado_por: admin, supervisor_id: l1 });
  ok(await cuentaFichas('1053779007') === 1 && (await q('SELECT cedula c FROM votantes WHERE id = ?', [fSync2]))[0].c === '1.053.779.007', 'y al revés: ficha vieja «1.053.779.007», cuenta «1053779007»: una sola ficha, sin reescribirla');
  await sync.sincronizarVotanteDesdeEstructura(pool, { numero_identificacion: '1.053.779.005', nombre: 'Persona Estructura Cinco', telefono: '3320000005', creado_por: admin, supervisor_id: l1 });
  ok((await q("SELECT cedula c FROM votantes WHERE nombre = 'Persona Estructura Cinco'"))[0].c === '1053779005', 'si no hay ficha, la que se crea nace normalizada');
  await sync.sincronizarEstructuraDesdeVotante(pool, { cedula: '1053779004', nombre: 'Persona Estructura Cuatro', telefono: '3329999999' });
  ok((await q('SELECT telefono t FROM usuarios WHERE id = ?', [uSync]))[0].t === '3329999999', 'votantes → estructura: la ficha «1053779004» actualiza a la cuenta «1.053.779.004»');
  const traida = await sync.traerVotanteActualPorCedula(pool, '01.053.779.004');
  ok(traida !== null, 'traerVotanteActualPorCedula la encuentra escrita de cualquier forma');

  console.log('  -- sumar-a-mi-rama con la cédula escrita distinto');
  const fRama = await votante('1053779010', 'Ficha Para Sumar', '3340000010', l1, { consent: true });
  const U3b = U(l3, 'lider');
  const sm0 = await pedir('POST', `/api/votantes/${fRama}/sumar-a-mi-rama`, { usuario: U3b, json: { cedula: '1.053.779.011' } });
  const sm1 = await pedir('POST', `/api/votantes/${fRama}/sumar-a-mi-rama`, { usuario: U3b, json: { cedula: '1.053.779.010' } });
  ok(sm0.status === 403 && sm1.status === 200 && (await q('SELECT COUNT(*) c FROM votante_ramas WHERE votante_id = ? AND aspirante_id = ?', [fRama, asp]))[0].c === 1, 'acreditar con «1.053.779.010» a la ficha «1053779010» sirve; con otra cédula, 403');
  ok((await pedir('POST', `/api/votantes/${fRama}/sumar-a-mi-rama`, { usuario: U(l2, 'lider'), json: { cedula: '...' } })).status === 403, 'una cédula sin dígitos nunca acredita');

  console.log('  -- mapa de cédulas para importaciones grandes');
  const mapa = await mapaDeFichasPorCedula(pool, ['1053777010', '1053779001', '1053779999', '12345678']);
  ok(mapa.get('1053777010').id === vVieja && mapa.get('1053779001').id === fLimpia && !mapa.has('1053779999'), 'mapaDeFichasPorCedula: por el índice y por las variantes (una consulta + un barrido), no por fila');

  console.log('  -- scripts/reporte-cedulas.js (solo lectura)');
  const gA = await votante('1.053.780.001', 'Reporte Duplicado Con Puntos', '3350000001', l1, { consent: true });
  const gB = await votante('1053780001', 'Reporte Duplicado Limpio', '3350000002', l2, { consent: true });
  await votante('1.053.780.002', 'Reporte Solo Con Puntos', '3350000003', l1, { consent: true });
  await votante('0012345679', 'Reporte Solo Con Ceros', '3350000004', l1, { consent: true });
  const antesCk = (await q('CHECKSUM TABLE votantes'))[0].Checksum;
  const rp = await reporte(pool, {});
  const grupo = rp.detalle.find(g => g.cedula === '***001' && g.miembros.some(m => m.id === gA));
  ok(rp.grupos >= 1 && grupo && grupo.fichas === 2, 'el reporte encuentra el grupo de casi-duplicados («1.053.780.001» y «1053780001»)', rp.detalle.map(d => d.cedula));
  ok(grupo.miembros.map(m => m.id).join() === [gA, gB].join() && grupo.miembros[0].guardada === 'con signos o espacios' && grupo.miembros[1].guardada === 'limpia', 'de cada ficha: id, cómo está guardada, en orden de creación');
  ok(grupo.miembros[0].lider === 'Lider Uno Prueba' && grupo.miembros[1].lider === 'Lider Dos Prueba' && grupo.miembros.every(m => m.creada && /^\*\*\*\d{3}$/.test(m.cedula)), 'con el líder, la fecha de creación y la cédula enmascarada (últimos 3 dígitos)');
  ok(rp.sin_normalizar >= 4 && rp.con_ceros >= 1 && rp.sin_normalizar_sin_duplicado >= 2 && rp.sin_normalizar_sin_duplicado < rp.sin_normalizar, 'cuenta las guardadas con signos o ceros, y de ellas las que NO tienen duplicado', { n: rp.sin_normalizar, sin: rp.sin_normalizar_sin_duplicado });
  const salida = imprimir(rp, 'simulada');
  ok(!/1053780001|1053780002|0012345679|1\.053\.780/.test(salida + JSON.stringify(rp)), 'ni el informe ni su JSON traen una cédula completa');
  ok((await q('CHECKSUM TABLE votantes'))[0].Checksum === antesCk, 'el reporte no modifica nada (checksum de la tabla igual antes y después)');
  const cli = spawnSync(process.execPath, [path.join(__dirname, 'reporte-cedulas.js')], { env: process.env, encoding: 'utf8', cwd: path.join(__dirname, '..') });
  ok(cli.status === 2 && /REPORTE DE CÉDULAS/.test(cli.stdout) && /HAY \d+ grupo/.test(cli.stdout) && !/1053780001/.test(cli.stdout), 'por la línea de comandos: sale con código 2 cuando hay casi-duplicados, y no imprime cédulas completas', { status: cli.status, err: cli.stderr && cli.stderr.slice(0, 200) });
  ok((await q('CHECKSUM TABLE votantes'))[0].Checksum === antesCk, '…y tampoco modifica nada');
  } // fin del bloque de la orden 30

  console.log('\n== Buscar por cédula sin exponer datos ajenos, y SMS al reinscribirse (orden 31)');
  { // bloque propio
  const fs = require('fs'), path = require('path');
  const buscar = (cedula, quien, rol = 'lider', sub) => pedir('GET', `/api/votantes/buscar-por-cedula?cedula=${encodeURIComponent(cedula)}`, { usuario: U(quien, rol), ...(sub ? { sublicencia: sub } : {}) });
  const auditorias = async (accion, uid) => q('SELECT usuario_id, detalle, ip, created_at FROM auditoria WHERE accion = ? AND usuario_id = ? ORDER BY id', [accion, uid]);

  console.log('  -- parte A: lo que devuelve la búsqueda, según quién pregunta');
  const fPropia = await votante('1053900001', 'Pedro Gómez Ruiz', '3360000001', l1, { consent: true });
  await pool.query("UPDATE votantes SET email = 'pedro@correo.co', direccion = 'Calle 9 # 8-7', puesto_votacion = 'PUESTO SECRETO', observaciones = 'nota privada' WHERE id = ?", [fPropia]);
  const propia = await buscar('1053900001', l1);
  ok(propia.status === 200 && propia.datos.id === fPropia && propia.datos.nombre === 'Pedro Gómez Ruiz' && propia.datos.telefono === '3360000001' && propia.datos.cedula === '1053900001' && propia.datos.mia === true && propia.datos.puede_sumar === false,
     'un líder busca una ficha PROPIA y ve todo, como hoy (id, nombre, teléfono, cédula, mia, puede_sumar)', propia.datos);
  ok(Object.keys(propia.datos).sort().join() === 'cedula,id,mia,nombre,puede_sumar,telefono', 'y exactamente esos campos: la forma de siempre');
  const antesAud = (await auditorias('buscar_cedula_ajena', l2)).length;
  const ajena = await buscar('1053900001', l2);
  ok(ajena.status === 200 && JSON.stringify(Object.keys(ajena.datos).sort()) === JSON.stringify(['de_otro_lider', 'existe', 'iniciales', 'puede_sumar']),
     'un líder busca una ficha AJENA y recibe SOLO { existe, de_otro_lider, iniciales, puede_sumar }', ajena.datos);
  ok(ajena.datos.existe === true && ajena.datos.de_otro_lider === true && ajena.datos.iniciales === 'P. R.' && ajena.datos.puede_sumar === false, 'existe, de otro líder, iniciales «P. R.» y sin posibilidad de sumar (no tiene rama de aspirante)', ajena.datos);
  const crudo = ajena.texto;
  ok(!/3360000001|1053900001|\b053900001|Pedro|Gómez|Ruiz|pedro@correo|Calle 9|SECRETO|nota privada|Lider Uno|"id"|"telefono"|"cedula"|"nombre"|"email"|"lider/i.test(crudo), 'el JSON completo NO trae teléfono, cédula, nombre, correo, dirección, puesto, ni quién es el líder dueño ni el id', crudo);
  const ajena2 = await buscar('1.053.900.001', l2);
  ok(JSON.stringify(ajena2.datos) === JSON.stringify(ajena.datos), 'la misma respuesta mínima si la cédula se escribe con puntos');
  const iniciales = (await Promise.all([['Ana', 'A.'], ['María de los Ángeles Pérez del Río', 'M. R.'], ['juan  carlos  Ñíguez', 'J. Ñ.']].map(async ([n, esperado], i) => {
    await votante(`10539001${i}0`, n, `33600001${i}0`, l1, { consent: true });
    return [n, esperado, (await buscar(`10539001${i}0`, l2)).datos.iniciales];
  })));
  ok(iniciales.every(([, e, g]) => e === g), 'iniciales: primera y última palabra, sin partículas («de», «del»…), en mayúscula y con tilde', iniciales);
  ok((await buscar('1053900777', l2)).datos === null, 'una cédula que no existe sigue respondiendo null');

  // La ficha ajena para un coordinador y un administrador
  const fDeAsp = await votante('1053900002', 'Sofía Beltrán Mora', '3360000002', l3, { consent: true });
  const coordAjena = await buscar('1053900002', coord, 'coordinador');
  ok(coordAjena.datos.de_otro_lider === true && !/3360000002|Sofía/.test(coordAjena.texto), 'un coordinador busca una ficha FUERA de su rama (de la de un aspirante): solo iniciales (hoy el coordinador NO tiene alcance total: ve su rama)', coordAjena.datos);
  const coordPropia = await buscar('1053900001', coord, 'coordinador');
  ok(coordPropia.datos.id === fPropia && coordPropia.datos.telefono === '3360000001', 'el mismo coordinador sí ve todo de una ficha de SU rama (de su líder)', coordPropia.datos);
  const admVe = await buscar('1053900002', admin, 'admin');
  ok(admVe.datos.id === fDeAsp && admVe.datos.nombre === 'Sofía Beltrán Mora' && admVe.datos.telefono === '3360000002', 'el administrador ve todo, también lo de la rama de un aspirante');
  const aspVe = await buscar('1053900002', l3);
  ok(aspVe.datos.id === fDeAsp && aspVe.datos.mia === true, 'un líder de un aspirante ve todo de una ficha de su rama');

  console.log('  -- la bitácora de las búsquedas que caen en una ficha ajena');
  const aud = await auditorias('buscar_cedula_ajena', l2);
  ok(aud.length >= antesAud + 5, 'cada búsqueda en una ficha ajena queda en `auditoria` (accion «buscar_cedula_ajena»), con el usuario', aud.length - antesAud);
  ok(aud.every(a => a.created_at && /^Buscó una cédula de otro líder \(\*\*\*\d{3}\)$/.test(a.detalle)) && aud.some(a => a.detalle.endsWith('(***001)')), 'con la fecha y SOLO los tres últimos dígitos de la cédula', aud.slice(-2));
  ok(!/1053900001/.test(JSON.stringify(aud)), '…y nunca la cédula completa');
  const nAud = (await q("SELECT COUNT(*) c FROM auditoria WHERE accion = 'buscar_cedula_ajena'"))[0].c;
  await buscar('1053900001', l1); await buscar('1053900777', l2);
  ok((await q("SELECT COUNT(*) c FROM auditoria WHERE accion = 'buscar_cedula_ajena'"))[0].c === nAud, 'buscar una ficha propia o una cédula inexistente NO deja rastro (solo las ajenas)');

  console.log('  -- sumar a mi rama sigue igual');
  const smPor = await pedir('POST', '/api/votantes/sumar-por-cedula', { usuario: U(l3, 'lider'), json: { cedula: '1.053.900.001' } });
  ok(smPor.status === 200 && (await q('SELECT COUNT(*) c FROM votante_ramas WHERE votante_id = ? AND aspirante_id = ?', [fPropia, asp]))[0].c === 1, 'sumar-por-cedula (sin id: lo resuelve el servidor con la cédula tecleada): suma a la rama de quien lo pide', smPor.datos);
  ok((await pedir('POST', '/api/votantes/sumar-por-cedula', { usuario: U(l3, 'lider'), json: { cedula: '1053900888' } })).status === 404, 'una cédula que no existe → 404');
  ok((await pedir('POST', '/api/votantes/sumar-por-cedula', { usuario: U(l2, 'lider'), json: { cedula: '1053900001' } })).status === 403, 'quien no pertenece a la rama de ningún aspirante → 403 (la misma regla)');
  const tras = await buscar('1053900001', l3);
  ok(tras.datos.id === fPropia && tras.datos.mia === true && tras.datos.puede_sumar === false, 'ya sumada, la búsqueda la devuelve completa y como propia');
  const fParaSumar = await votante('1053900003', 'Rosa Castaño', '3360000003', l1, { consent: true });
  const viejoS = await pedir('POST', `/api/votantes/${fParaSumar}/sumar-a-mi-rama`, { usuario: U(l3, 'lider'), json: { cedula: '1.053.900.003' } });
  ok(viejoS.status === 200, 'la ruta de siempre, /:id/sumar-a-mi-rama con la cédula, sigue funcionando', viejoS.datos);
  const ajenaSum = await buscar('1053900002', l2);   // (l2 sin rama: puede_sumar false) vs un líder de aspirante buscando una ficha de la madre
  const deMadre = await votante('1053900004', 'Tomás Ibáñez', '3360000004', l1, { consent: true });
  const vistaAsp = await buscar('1053900004', l3);
  ok(vistaAsp.datos.de_otro_lider === true && vistaAsp.datos.puede_sumar === true && !/Tomás|3360000004/.test(vistaAsp.texto), 'un líder de aspirante ante una ficha de la campaña madre: iniciales y «puede_sumar: true» (sin nada más)', vistaAsp.datos);

  console.log('  -- el límite: 60 búsquedas cada 10 minutos por usuario');
  const lSpam = await usuario('Lider Spam Prueba', 'lider'); await estructura(lSpam, 'lider', coord);
  const estados = [];
  for (let i = 0; i < 61; i++) estados.push((await buscar(`10539${String(50000 + i)}`, lSpam)).status);
  ok(estados.slice(0, 60).every(s => s === 200) && estados[60] === 429, `las 60 primeras responden 200 y la búsqueda 61 recibe 429`, estados.filter(s => s !== 200));
  const r429 = await buscar('1053950000', lSpam);
  ok(r429.status === 429 && r429.datos.error === 'Demasiadas búsquedas, espera unos minutos', 'con el mensaje «Demasiadas búsquedas, espera unos minutos»', r429.datos);
  ok((await pedir('POST', '/api/votantes/sumar-por-cedula', { usuario: U(lSpam, 'lider'), json: { cedula: '1053950001' } })).status === 429, 'sumar-por-cedula comparte el mismo tope (es la misma pregunta)');
  ok((await buscar('1053900001', l2)).status === 200, 'el tope es por usuario: otro usuario no se ve afectado');
  ok((await pedir('GET', '/api/votantes/buscar-por-cedula?cedula=', { usuario: U(lSpam, 'lider') })).status === 200, 'una consulta sin cédula no cuenta ni se bloquea');

  console.log('  -- las pantallas');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public/js/validacion-cedula-ui.js'), 'utf8');
  const ramaOtro = ui.slice(ui.indexOf('if (r.de_otro_lider) {'), ui.indexOf("if (!r.id) return;"));
  ok(ramaOtro.includes('Esta persona ya está inscrita con otro líder (') && ramaOtro.includes('Sumar a mi rama') && ramaOtro.includes('/votantes/sumar-por-cedula') && !/rellenar\(/.test(ramaOtro) && !/r\.nombre|r\.telefono/.test(ramaOtro),
     'escritorio y app del celular (validacion-cedula-ui.js): «Esta persona ya está inscrita con otro líder (P. G.)», botón «Sumar a mi rama» solo si se puede, y NO rellena el formulario ni usa nombre o teléfono', ramaOtro.length);
  ok(/puede_sumar\s*\?/.test(ramaOtro) && /demasiadas b/i.test(ui), 'el botón sale solo si puede_sumar, y se avisa cuando se pasa el límite');
  ok(/validacion-cedula-ui/.test(fs.readFileSync(path.join(__dirname, '..', 'public/app/registro-votante.html'), 'utf8')) && /validacion-cedula-ui/.test(fs.readFileSync(path.join(__dirname, '..', 'public/votantes.html'), 'utf8')), 'lo cargan la app del celular (registro-votante) y el escritorio (votantes)');
  const asis = fs.readFileSync(path.join(__dirname, '..', 'public/asistentes-reuniones.html'), 'utf8');
  ok(/votante\.de_otro_lider/.test(asis) && /cajaPersonaDeOtroLider/.test(asis) && /sumar-por-cedula/.test(asis) && /Esta persona ya está inscrita con otro líder/.test(asis), 'alta rápida de asistentes: muestra el aviso y el botón, sin fila para agregar a una ficha ajena');

  console.log('  -- parte B: SMS de confirmación al reinscribirse por /i');
  await pool.query('UPDATE inscripcion_config SET limite_telefono_dia = 50 WHERE id = 1');
  const inscribir = (cedula, tel, extra = {}) => pedir('POST', `/i/${e3.codigo}`, { form: F(e3.codigo, HUELLA, { cedula, telefono: tel, nombre: 'Persona Reinscribe Prueba', canal_sms: '1', ...extra }) });
  const esperarSms = async () => { for (let i = 0; i < 30 && !smsEnviados.length; i++) await dormir(100); await reg.procesarCola(); };
  const nadaEnviado = async () => { await dormir(350); await reg.procesarCola(); return smsEnviados.length === 0; };
  const colaDe = async (id) => (await q('SELECT estado, detalle FROM inscripcion_sms_cola WHERE votante_id = ?', [id]))[0];
  const intentoDe = async (id) => (await q('SELECT sms_reenviado, motivo, celular_coincide FROM inscripcion_intentos WHERE votante_id = ? ORDER BY id DESC LIMIT 1', [id]))[0];
  const envejecer = (id) => pool.query("UPDATE inscripcion_sms_cola SET enviado_en = NOW() - INTERVAL 25 HOUR, creado_en = NOW() - INTERVAL 25 HOUR WHERE votante_id = ?", [id]);

  // Persona nueva con SMS marcado: el SMS original, que no se confirma
  smsEnviados.length = 0;
  const rNuevaB = await inscribir('9830000001', '3370000001');
  await esperarSms();
  const vB = (await q("SELECT id FROM votantes WHERE cedula = '9830000001'"))[0].id;
  ok(smsEnviados.length === 1 && /\/c\//.test(smsEnviados[0].mensaje) && (await colaDe(vB)).estado === 'enviado', 'persona nueva: recibe su SMS de confirmación (lo de siempre)');
  ok((await intentoDe(vB)).sms_reenviado === 0, 'y su intento NO figura como «reenviado»');
  const textoBase = rNuevaB.texto;

  smsEnviados.length = 0;
  const r2 = await inscribir('9830000001', '3370000001');
  ok(await nadaEnviado() && (await intentoDe(vB)).sms_reenviado === 0, 'una SEGUNDA vez dentro de 24 horas: no se manda nada, y el intento no marca reenvío');
  ok(r2.texto === textoBase, 'la respuesta pública es la misma que la de la persona nueva (byte a byte)');

  await envejecer(vB);
  smsEnviados.length = 0;
  const r3 = await inscribir('9830000001', '3370000001');
  await esperarSms();
  ok(smsEnviados.length === 1 && smsEnviados[0].telefono === '3370000001' && /\/c\//.test(smsEnviados[0].mensaje), 'reinscripción con el MISMO celular, sin confirmar, SMS marcado y pasadas 24 h: se manda otra vez el SMS de confirmación', smsEnviados);
  ok((await colaDe(vB)).estado === 'enviado' && (await intentoDe(vB)).sms_reenviado === 1 && (await intentoDe(vB)).motivo === 'cedula_existente', 'el intento queda con sms_reenviado = 1 (y sigue como cedula_existente)', await intentoDe(vB));
  ok(r3.texto === textoBase, '…y la respuesta pública sigue idéntica');
  smsEnviados.length = 0;
  await inscribir('9830000001', '3370000001');
  ok(await nadaEnviado(), 'y justo después otra vez: no (una cada 24 horas)');
  ok((await q('SELECT COUNT(*) c FROM inscripcion_sms_cola WHERE votante_id = ?', [vB]))[0].c === 1, 'la cola sigue teniendo UNA fila por ficha (se reutiliza)');

  console.log('  -- los casos en que NO se manda');
  await envejecer(vB);
  smsEnviados.length = 0;
  const rOtroCel = await inscribir('9830000001', '3379999999');
  ok(await nadaEnviado() && (await intentoDe(vB)).sms_reenviado === 0 && rOtroCel.texto === textoBase, 'celular DISTINTO: no se manda nada, no se modifica nada y la respuesta es la misma');
  smsEnviados.length = 0;
  const rSinCasilla = await inscribir('9830000001', '3370000001', { canal_sms: '' });
  ok(await nadaEnviado() && (await intentoDe(vB)).sms_reenviado === 0 && rSinCasilla.texto.includes('¡Listo!'), 'casilla de SMS SIN marcar en este envío: no se manda');
  await pool.query('UPDATE votantes SET consentimiento_confirmado_en = NOW() WHERE id = ?', [vB]);
  smsEnviados.length = 0;
  const rConf = await inscribir('9830000001', '3370000001');
  ok(await nadaEnviado() && (await intentoDe(vB)).sms_reenviado === 0 && rConf.texto === textoBase, 'ficha YA CONFIRMADA: no se manda');
  await pool.query('UPDATE votantes SET consentimiento_confirmado_en = NULL, no_contactar = 1 WHERE id = ?', [vB]);
  smsEnviados.length = 0;
  await inscribir('9830000001', '3370000001');
  ok(await nadaEnviado() && (await intentoDe(vB)).sms_reenviado === 0, 'ficha con no_contactar (la baja): no se manda');
  await pool.query('UPDATE votantes SET no_contactar = 0 WHERE id = ?', [vB]);

  console.log('  -- la evidencia de ESTE envío: solo en los campos vacíos');
  // Ficha de un líder (origen manual), autorizada a mano, con su SMS «no consta» (NULL) y su evidencia ya escrita
  const vM = await votante('9830000011', 'Ficha Manual Autorizada', '3370000011', l1, { consent: true });
  await pool.query("UPDATE votantes SET consentimiento_metodo = 'verbal_formulario_campo', consentimiento_fecha = '2026-01-02 03:04:05', consentimiento_version = 'huella-vieja', consentimiento_whatsapp = 0 WHERE id = ?", [vM]);
  smsEnviados.length = 0;
  await inscribir('9830000011', '3370000011', { canal_whatsapp: '1' });
  await esperarSms();
  const [m1] = await q("SELECT consentimiento_sms s, consentimiento_whatsapp w, consentimiento_metodo m, DATE_FORMAT(consentimiento_fecha, '%Y-%m-%d %H:%i:%s') f, consentimiento_version v FROM votantes WHERE id = ?", [vM]);
  ok(smsEnviados.length === 1 && m1.s === 1, 'ficha manual con el SMS «no consta» (NULL): se llena con este envío (1) y se manda el SMS', m1);
  ok(m1.m === 'verbal_formulario_campo' && m1.f === '2026-01-02 03:04:05' && m1.v === 'huella-vieja' && m1.w === 0, '…y lo que ya tenía (método, fecha, versión de la política, un WhatsApp en 0 puesto por el líder) NO se pisa', m1);
  ok((await q('SELECT COUNT(*) c FROM votante_consentimiento_evidencia WHERE votante_id = ?', [vM]))[0].c === 1, 'queda la fila de evidencia (IP, navegador, enlace, política) de este envío');
  // Un 0 puesto a mano en el SMS de una ficha manual NO se convierte en 1
  const vM0 = await votante('9830000012', 'Ficha Manual Dijo No', '3370000012', l1, { consent: true });
  await pool.query('UPDATE votantes SET consentimiento_sms = 0 WHERE id = ?', [vM0]);
  smsEnviados.length = 0;
  await inscribir('9830000012', '3370000012');
  ok(await nadaEnviado() && (await q('SELECT consentimiento_sms s FROM votantes WHERE id = ?', [vM0]))[0].s === 0 && (await intentoDe(vM0)).sms_reenviado === 0, 'un SMS en 0 de una ficha manual (la persona dijo que no) NO se vuelve 1 ni se manda nada');
  // Una ficha nacida de este mismo formulario sin marcar el SMS (0): lo último que declara la persona manda
  smsEnviados.length = 0;
  await inscribir('9830000013', '3370000013', { canal_sms: '' });
  const vF = (await q("SELECT id FROM votantes WHERE cedula = '9830000013'"))[0].id;
  ok((await q('SELECT consentimiento_sms s FROM votantes WHERE id = ?', [vF]))[0].s === 0 && smsEnviados.length === 0, 'primera inscripción sin marcar el SMS: queda en 0 y no se manda nada');
  await inscribir('9830000013', '3370000013');
  await esperarSms();
  ok(smsEnviados.length === 1 && (await q('SELECT consentimiento_sms s FROM votantes WHERE id = ?', [vF]))[0].s === 1 && (await intentoDe(vF)).sms_reenviado === 1, 'si vuelve y SÍ lo marca: la ficha nacida de este formulario pasa a 1 y se le manda el SMS');
  // ficha de OTRO líder, mismo celular: también (la condición no la excluye), y el dueño no cambia
  const vO = await votante('9830000014', 'Ficha De Otro Lider Reinscribe', '3370000014', l1, { consent: true });
  smsEnviados.length = 0;
  await inscribir('9830000014', '3370000014');
  await esperarSms();
  ok(smsEnviados.length === 1 && (await q('SELECT lider_id l FROM votantes WHERE id = ?', [vO]))[0].l === l1, 'ficha de otro líder con el celular que coincide: se manda, y el dueño no cambia');
  await pool.query('UPDATE inscripcion_config SET limite_telefono_dia = 3 WHERE id = 1');
  } // fin del bloque de la orden 31






  console.log('\n== «Mi enlace»: ver, rotar, el viejo deja de servir');
  const sinSesion = await pedir('GET', '/api/inscripcion/mi-enlace');
  ok(sinSesion.status === 401, 'sin sesión → 401');
  // l1 lleva 5: 2 de las secciones de arriba y 3 del bloque de puesto y mesa de la orden 27.
  const mi = await pedir('GET', '/api/inscripcion/mi-enlace', { usuario: U(l1, 'lider') });
  ok(mi.status === 200 && mi.datos.codigo === e1.codigo && mi.datos.total === 5 && mi.datos.hoy === 5 && mi.datos.ruta === `/i/${e1.codigo}`, 'el líder ve su código y su conteo', mi.datos);
  ok(mi.datos.confirmados === 1 && mi.datos.sin_confirmar === 4, 'confirmados / sin confirmar', mi.datos);
  const noPuede = await pedir('GET', '/api/inscripcion/mi-enlace', { usuario: U(admin, 'admin') });
  ok(noPuede.status === 403, 'un administrador sin estructura no tiene enlace (403)');
  const rot = await pedir('POST', '/api/inscripcion/mi-enlace/rotar', { usuario: U(l1, 'lider'), json: {} });
  ok(rot.status === 200 && rot.datos.codigo && rot.datos.codigo !== e1.codigo, 'rotar da un código nuevo');
  const viejo = await pedir('GET', `/i/${e1.codigo}`);
  const nuevoPg = await pedir('GET', `/i/${rot.datos.codigo}`);
  ok(viejo.texto === (await pedir('GET', '/i/ZZZZZZZZ')).texto, 'el código VIEJO ya no sirve (misma respuesta que uno inexistente, pedida ahora: la tarjeta cambia con la configuración)');
  ok(nuevoPg.texto.includes('Te inscribe'), 'el nuevo sí');
  const eAntes = e1.codigo; e1.codigo = rot.datos.codigo;

  console.log('\n== Cuadro del escritorio y permisos');
  const rLider = await pedir('GET', '/api/inscripcion/resumen', { usuario: U(l1, 'lider') });
  ok(rLider.status === 403, 'un líder NO ve el cuadro (403)');
  const rCoord = await pedir('GET', '/api/inscripcion/resumen', { usuario: U(coord, 'coordinador') });
  const nombresC = (rCoord.datos && rCoord.datos.lideres || []).map(x => x.nombre);
  ok(rCoord.status === 200 && nombresC.includes('Lider Uno Prueba') && nombresC.includes('Lider Dos Prueba') && nombresC.includes('Sublider Prueba'), 'el coordinador ve a SU gente');
  ok(!nombresC.includes('Lider Tres Prueba'), 'y NO ve a la rama de otro (aspirante)');
  const f1 = rCoord.datos.lideres.find(x => x.nombre === 'Lider Uno Prueba');
  ok(f1.total === 5 && f1.confirmados === 1 && f1.sin_confirmar === 4 && f1.hoy === 5, 'conteos por líder: total / hoy / confirmados / sin confirmar', f1);
  const f2 = rCoord.datos.lideres.find(x => x.nombre === 'Lider Dos Prueba');
  ok(f2.intentos_otro_lider >= 1, 'intentos con cédula de otro líder contados', f2);
  const crudo = JSON.stringify(rCoord.datos);
  ok(!/1053123456|3333333331|6666666661/.test(crudo), 'el cuadro NO muestra ninguna cédula');
  const bit = await pedir('GET', '/api/inscripcion/intentos-otro-lider', { usuario: U(coord, 'coordinador') });
  ok(bit.status === 200 && bit.datos.length >= 1 && !/1053123456|3333333331/.test(JSON.stringify(bit.datos)), 'bitácora de otro líder: sin cédula', bit.datos && bit.datos[0]);
  ok(bit.datos.some(x => x.dueno_actual === 'Lider Uno Prueba' && x.lider_del_enlace === 'Lider Dos Prueba'), 'dice de quién era y por el enlace de quién se intentó');
  const rAsp = await pedir('GET', '/api/inscripcion/resumen', { usuario: U(asp, 'lider'), sublicencia: { usuario_id: asp, cargo: 'concejo' } });
  const nombresA = (rAsp.datos && rAsp.datos.lideres || []).map(x => x.nombre);
  ok(rAsp.status === 200 && nombresA.includes('Lider Tres Prueba') && !nombresA.includes('Lider Uno Prueba'), 'el aspirante ve solo su rama');
  const rAdm = await pedir('GET', '/api/inscripcion/resumen', { usuario: U(admin, 'admin') });
  ok((rAdm.datos.lideres || []).length >= 5, 'el administrador ve todo');

  const desact = await pedir('POST', `/api/inscripcion/enlaces/${l2}/activo`, { usuario: U(coord, 'coordinador'), json: { activo: 0 } });
  ok(desact.status === 200 && desact.datos.activo === false, 'el coordinador desactiva el enlace de su líder');
  ok((await pedir('GET', `/i/${e2.codigo}`)).texto === (await pedir('GET', '/i/ZZZZZZZZ')).texto, '…y la página deja de servir');
  const rotLider = await pedir('POST', '/api/inscripcion/mi-enlace/rotar', { usuario: U(l2, 'lider'), json: {} });
  ok(rotLider.status === 403, 'el líder NO puede reactivar su enlace rotándolo (403)');
  const fuera = await pedir('POST', `/api/inscripcion/enlaces/${l3}/activo`, { usuario: U(coord, 'coordinador'), json: { activo: 0 } });
  ok(fuera.status === 404, 'el coordinador NO toca a alguien fuera de su rama (404)');
  const porLider = await pedir('POST', `/api/inscripcion/enlaces/${l2}/rotar`, { usuario: U(l1, 'lider'), json: {} });
  ok(porLider.status === 403, 'un líder NO rota el enlace de otro (403)');
  const react = await pedir('POST', `/api/inscripcion/enlaces/${l2}/activo`, { usuario: U(coord, 'coordinador'), json: { activo: 1 } });
  ok(react.status === 200 && (await pedir('GET', `/i/${e2.codigo}`)).texto.includes('Te inscribe'), 'reactivar lo devuelve a servir');
  const rotCoord = await pedir('POST', `/api/inscripcion/enlaces/${l2}/rotar`, { usuario: U(coord, 'coordinador'), json: {} });
  ok(rotCoord.status === 200 && !('codigo' in rotCoord.datos), 'el coordinador rota el de su líder y NO recibe el código nuevo');
  const ajCoord = await pedir('PUT', '/api/inscripcion/ajustes', { usuario: U(coord, 'coordinador'), json: { habilitado: 0 } });
  ok(ajCoord.status === 403, 'solo el administrador toca los ajustes (403 al coordinador)');
  const ajAdm = await pedir('PUT', '/api/inscripcion/ajustes', { usuario: U(admin, 'admin'), json: { habilitado: 0, limite_telefono_dia: 99999 } });
  ok(ajAdm.status === 200 && ajAdm.datos.ajustes.habilitado === 0 && ajAdm.datos.ajustes.limite_telefono_dia === 3, 'el administrador apaga la inscripción; un valor absurdo se ignora');
  ok((await pedir('GET', `/i/${e1.codigo}`)).texto === (await pedir('GET', '/i/ZZZZZZZZ')).texto, 'apagada: todas las páginas dicen «no activo»');
  await pedir('PUT', '/api/inscripcion/ajustes', { usuario: U(admin, 'admin'), json: { habilitado: 1 } });

  console.log('\n== Listado de votantes: filtros y progreso');
  const lst = await pedir('GET', '/api/votantes?origen=enlace_lider&limit=200', { usuario: U(admin, 'admin') });
  ok(lst.status === 200 && lst.datos.data.length >= 5 && lst.datos.data.every(x => x.origen === 'enlace_lider'), 'filtro «Se inscribió por enlace»', lst.datos && lst.datos.total);
  const sc = await pedir('GET', '/api/votantes?sin_confirmar=1&limit=200', { usuario: U(admin, 'admin') });
  ok(sc.status === 200 && sc.datos.data.length >= 1 && sc.datos.data.every(x => x.origen === 'enlace_lider' && !x.consentimiento_confirmado_en), 'filtro «sin confirmar»: solo los pendientes del enlace');
  ok(!sc.datos.data.some(x => x.id === v.id), 'el ya confirmado no aparece en «sin confirmar»');

  console.log('\n== sumar-a-mi-rama exige acreditar a la persona');
  const aj = await votante('1212121212', 'Persona Ajena A L3', '3141112222', l1, { consent: true });
  const prop = await votante('1313131313', 'Persona Propia De L3', '3141113333', l3, { consent: true });
  const U3 = U(l3, 'lider');
  const s0 = await pedir('POST', `/api/votantes/${aj}/sumar-a-mi-rama`, { usuario: U3, json: {} });
  ok(s0.status === 403, 'ficha ajena, sin cédula → 403', s0.status + ' ' + s0.texto.slice(0, 100));
  const s1 = await pedir('POST', `/api/votantes/${aj}/sumar-a-mi-rama`, { usuario: U3, json: { cedula: '9999999999' } });
  ok(s1.status === 403, 'ficha ajena, cédula equivocada → 403');
  ok((await q('SELECT COUNT(*) c FROM votante_ramas WHERE votante_id = ?', [aj]))[0].c === 0, '…y no se sumó nada');
  const s2 = await pedir('POST', `/api/votantes/${aj}/sumar-a-mi-rama`, { usuario: U3, json: { cedula: '1212121212' } });
  ok(s2.status === 200 && (await q('SELECT COUNT(*) c FROM votante_ramas WHERE votante_id = ? AND aspirante_id = ?', [aj, asp]))[0].c === 1, 'ficha ajena con la cédula correcta (el flujo del formulario) → 200 y se suma');
  const s3 = await pedir('POST', `/api/votantes/${prop}/sumar-a-mi-rama`, { usuario: U3, json: {} });
  ok(s3.status === 200, 'ficha visible por su alcance, sin cédula → 200', s3.status);
  const s4 = await pedir('POST', `/api/votantes/${aj}/sumar-a-mi-rama`, { usuario: U(l2, 'lider'), json: { cedula: '1212121212' } });
  ok(s4.status === 403, 'quien no pertenece a ninguna rama de aspirante → 403 (como antes)');

  servidor.close();
  console.log(`\n${pruebas - fallos}/${pruebas} comprobaciones correctas${fallos ? ` — ${fallos} FALLARON` : ''}.`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch(async (e) => { console.error('ERROR en la prueba:', e); try { await pool.end(); } catch (_) { /* ya cerrado */ } process.exit(1); });
