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

let fallos = 0, pruebas = 0;
function ok(cond, texto, extra) {
  pruebas++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
const dormir = (ms) => new Promise(r => setTimeout(r, ms));
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }

// ---- SMS fingido y franja controlable ------------------------------------
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
  const m = smsEnviados[0] && /https:\/\/campana\.prueba\/c\/([0-9a-f]{64})/.exec(smsEnviados[0].mensaje);
  ok(!!m, 'el SMS lleva el enlace de /c', smsEnviados[0]);
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

  console.log('\n== «Mi enlace»: ver, rotar, el viejo deja de servir');
  const sinSesion = await pedir('GET', '/api/inscripcion/mi-enlace');
  ok(sinSesion.status === 401, 'sin sesión → 401');
  const mi = await pedir('GET', '/api/inscripcion/mi-enlace', { usuario: U(l1, 'lider') });
  ok(mi.status === 200 && mi.datos.codigo === e1.codigo && mi.datos.total === 2 && mi.datos.hoy === 2 && mi.datos.ruta === `/i/${e1.codigo}`, 'el líder ve su código y su conteo', mi.datos);
  ok(mi.datos.confirmados === 1 && mi.datos.sin_confirmar === 1, 'confirmados / sin confirmar', mi.datos);
  const noPuede = await pedir('GET', '/api/inscripcion/mi-enlace', { usuario: U(admin, 'admin') });
  ok(noPuede.status === 403, 'un administrador sin estructura no tiene enlace (403)');
  const rot = await pedir('POST', '/api/inscripcion/mi-enlace/rotar', { usuario: U(l1, 'lider'), json: {} });
  ok(rot.status === 200 && rot.datos.codigo && rot.datos.codigo !== e1.codigo, 'rotar da un código nuevo');
  const viejo = await pedir('GET', `/i/${e1.codigo}`);
  const nuevoPg = await pedir('GET', `/i/${rot.datos.codigo}`);
  ok(viejo.texto === inex.texto, 'el código VIEJO ya no sirve (misma respuesta que uno inexistente)');
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
  ok(f1.total === 2 && f1.confirmados === 1 && f1.sin_confirmar === 1 && f1.hoy === 2, 'conteos por líder: total / hoy / confirmados / sin confirmar', f1);
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
  ok((await pedir('GET', `/i/${e2.codigo}`)).texto === inex.texto, '…y la página deja de servir');
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
  ok((await pedir('GET', `/i/${e1.codigo}`)).texto === inex.texto, 'apagada: todas las páginas dicen «no activo»');
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
