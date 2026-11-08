#!/usr/bin/env node
// scripts/probar-transporte-parte2.js
//
// Prueba del TRANSPORTE DEL DÍA D, parte 2 (orden 35): la alerta «Transporte sin recoger», el SMS «Voy en camino», la firma del
// SMS y el orden del menú. Contra una base SIMULADA (levanta las rutas reales en un Express de prueba, sesión fingida por
// cabecera) y con el PROVEEDOR DE SMS SIMULADO: `smsSvc.enviarSMS` se reemplaza por una función que anota lo que recibe. NO manda
// ningún SMS ni usa servicios externos.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada2 node scripts/probar-transporte-parte2.js
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

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const pool = require('../config/db');
const T = require('../lib/transporteDiaD');
const jornada = require('../lib/jornadaDiaD');
const smsSvc = require('../config/sms');
const alertasLib = require('../lib/alertasDiaD');
const avisos = require('../lib/avisosAlertas');
const { calcularAlcance } = require('../middleware/auth');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
const dormir = (ms) => new Promise(r => setTimeout(r, ms));
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }
const leer = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// ---- el proveedor de SMS SIMULADO
const enviados = [];
let falloEnvio = null;                  // si es un Error, el próximo envío lo lanza
smsSvc.enviarSMS = async (telefono, mensaje, cb, opciones = {}) => {
  if (falloEnvio) { const e = falloEnvio; falloEnvio = null; throw e; }
  enviados.push({ telefono, mensaje, opciones });
  return { sid: 'prueba', creditos: 1 };
};
const avisosDeConsola = [];
const warnOriginal = console.warn;
console.warn = (...a) => { avisosDeConsola.push(a.join(' ')); };

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use((req, res, next) => {
  const u = req.headers['x-test-user'];
  req.session = { usuario: u ? JSON.parse(u) : undefined };
  req.sublicencia = null;
  next();
});
app.use('/t', require('../routes/transporte.routes'));
app.use('/api/dia-d/alertas', require('../routes/alertasDiaD.routes'));
app.use('/api/configuracion', require('../routes/configuracion.routes'));

let base = '';
let ipN = 10;
async function pedir(metodo, ruta, { json, usuario } = {}) {
  const h = { 'X-Forwarded-For': `198.51.100.${ipN++}`, 'User-Agent': 'prueba-agente/1.0' };
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  const r = await fetch(base + ruta, { method: metodo, headers: h, body });
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* html */ }
  return { status: r.status, texto, datos };
}
const U = (id, rol) => ({ id, rol, nombre: 'x' });

let n = 0;
async function usuario(nombre, rol) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, telefono, activo)
     VALUES (?, ?, ?, 'x', (SELECT id FROM roles WHERE nombre = ?), NULL, 1)`, [nombre, `8100000${n}`, `u8100000${n}`, rol]);
  return r.insertId;
}
async function estructura(usuarioId, cargo, supervisorId) {
  await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?,?,?,1)', [usuarioId, cargo, supervisorId || null]);
}
let c = 0;
async function votante(nombre, liderId, extra = {}) {
  c++;
  const tel = extra.telefono === undefined ? `3500${String(c).padStart(6, '0')}` : extra.telefono;
  const [r] = await pool.query(
    `INSERT INTO votantes (nombre, cedula, telefono, lider_id, direccion, barrio_residencia, puesto_votacion, mesa_votacion, necesita_transporte,
                           consentimiento_autorizado, consentimiento_sms, no_contactar, origen, consentimiento_confirmado_en)
     VALUES (?, ?, ?, ?, 'Calle 1 # 2-3', 'Barrio Uno', ?, 3, ?, 1, ?, ?, ?, ?)`,
    [nombre, `7200${String(c).padStart(5, '0')}`, tel, liderId, extra.puesto || 'PUESTO A', extra.necesita === undefined ? 1 : extra.necesita,
     extra.sms === undefined ? 1 : extra.sms, extra.noContactar || 0, extra.origen || 'manual', extra.confirmado || null]);
  return r.insertId;
}
async function asignar(votanteId, conductorId, fecha, estado = 'asignado') {
  const [r] = await pool.query(
    `INSERT INTO transporte_asignaciones (aspirante_id, votante_id, conductor_id, fecha, orden, estado) VALUES (0, ?, ?, ?, 1, ?)`,
    [votanteId, conductorId, fecha, estado]);
  return r.insertId;
}
const ayudaRelojEn = (iso) => { jornada.reloj = () => new Date(iso); };

(async () => {
  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  // ============================================================== 1. el orden del menú
  console.log('\n== El orden del menú (Transporte al final de DÍA D)');
  const nav = leer('public/js/common.js');
  const iDia = nav.indexOf("grupo: 'Día D'");
  const bloqueDiaD = nav.slice(iDia, nav.indexOf("grupo: 'Logística'"));
  const orden = [...bloqueDiaD.matchAll(/texto: '([^']+)'/g)].map(m => m[1]);
  // Orden 39: «Logística del Día D» pasó a ir DESPUÉS de Transporte; Transporte sigue justo detrás de «Puestos de votación y candidatos».
  const iT = orden.indexOf('Transporte del Día D');
  ok(iT > 0 && orden[iT - 1] === 'Puestos de votación y candidatos' && orden[iT + 1] === 'Logística del Día D',
    'escritorio: «Transporte del Día D» va después de «Puestos de votación y candidatos» (y ahora lo sigue «Logística del Día D»)', orden);
  const inicio = leer('public/app/inicio.html');
  const menus = ['MENU_COORDINADOR', 'MENU_ADMIN'].map(nom => {
    const cuerpo = inicio.slice(inicio.indexOf(`const ${nom} = [`));
    return cuerpo.slice(0, cuerpo.indexOf('\n];'));
  });
  ok(menus.every(m => m.indexOf("titulo: 'Ranking Día D'") !== -1 && m.indexOf("titulo: 'Transporte Día D'") > m.indexOf("titulo: 'Ranking Día D'")),
    'celular (coordinador y administrador): la tarjeta «Transporte Día D» va después de «Ranking Día D»');
  const pestanas = [...leer('public/dia-d.html').matchAll(/id="pestana-(\w+)"/g)].map(m => m[1]);
  ok(pestanas[pestanas.length - 2] === 'transporte' && pestanas[pestanas.length - 1] === 'logistica', 'las pestañas de dia-d.html: Transporte, y después (orden 39) Logística', pestanas);
  const { HREFS_ASPIRANTE } = require('../middleware/aspirante');
  ok(HREFS_ASPIRANTE.includes('/dia-d.html#transporte') && HREFS_ASPIRANTE.includes('/dia-d.html#alertas'),
    'el aspirante con sublicencia: su lista de direcciones incluye /dia-d.html#transporte (antes faltaba) y no perdió las otras');

  // ============================================================== 2. init-db
  console.log('\n== init-db: dos veces, idempotente');
  const raiz = path.join(__dirname, '..');
  const credenciales = () => fs.readdirSync(raiz).filter(f => /^\.credenciales-.*\.txt$/.test(f));
  const antesCred = credenciales();
  const corridas = [1, 2].map(() => spawnSync(process.execPath, [path.join(raiz, 'db/init-db.js')], { env: process.env, encoding: 'utf8', cwd: raiz }));
  ok(corridas.every(r => r.status === 0), 'init-db corre dos veces sin error', corridas.map(r => r.status + ' ' + (r.stderr || '').slice(0, 200)));
  ok(/aviso_enviado_en ya existía/.test(corridas[1].stdout), 'la segunda dice que aviso_enviado_en ya existía: sin cambios');
  for (const f of credenciales()) if (!antesCred.includes(f)) fs.unlinkSync(path.join(raiz, f));
  const [{ t: tipoFirma }] = await q("SELECT COLUMN_TYPE t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sms_config' AND COLUMN_NAME = 'firma'");
  ok(tipoFirma === 'varchar(80)', 'sms_config.firma mide 80 (la de una campaña real mide ~50)', tipoFirma);
  const [{ k: kAviso }] = await q("SELECT COUNT(*) k FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transporte_asignaciones' AND COLUMN_NAME = 'aviso_enviado_en'");
  ok(kAviso === 1, 'transporte_asignaciones.aviso_enviado_en existe');

  // ============================================================== siembra
  console.log('\n== Siembra');
  await pool.query('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
  const admin = await usuario('Admin Prueba', 'admin');
  const coordA = await usuario('Coordinador Uno Prueba', 'coordinador');
  const coordB = await usuario('Coordinador Dos Prueba', 'coordinador');
  const l1 = await usuario('Lider Uno Prueba', 'lider');
  const l2 = await usuario('Lider Dos Prueba', 'lider');
  await estructura(coordA, 'coordinador'); await estructura(coordB, 'coordinador');
  await estructura(l1, 'lider', coordA); await estructura(l2, 'lider', coordB);
  await pool.query(`INSERT INTO dia_d_puestos_votacion (nombre, cantidad_mesas, aspirante_id) VALUES ('PUESTO A', 10, 0), ('PUESTO B', 6, 0)`);
  const [rv] = await pool.query(`INSERT INTO transporte_vehiculos (aspirante_id, placa, tipo, capacidad) VALUES (0, 'ABC123', 'camioneta', 4)`);
  const codigoCond = await T.codigoNuevo();
  const [rc] = await pool.query(`INSERT INTO transporte_conductores (aspirante_id, nombre, celular, vehiculo_id, codigo, activo) VALUES (0, 'Luis Conductor Prueba', '3001112233', ?, ?, 1)`, [rv.insertId, codigoCond]);
  const conductorId = rc.insertId;

  // ============================================================== 3. la alerta
  console.log('\n== La alerta «Transporte sin recoger»');
  const DIA = '2026-11-08';
  await pool.query('UPDATE configuracion_campana SET fecha_eleccion = ? WHERE id = 1', [DIA]);
  const a1 = await votante('Ana Asignada Uno', l1);                       // A · asignado → cuenta
  const a2 = await votante('Beto Ya Recogido', l1);                       // A · recogido → no
  const a3 = await votante('Carla Sin Conductor', l2);                    // A · sin parada → sin conductor
  const a4 = await votante('Dario Ya Voto', l2);                          // A · asignado pero ya votó → no
  const a5 = await votante('Elena Cancelada', l1);                        // A · parada cancelada → sin conductor
  const a6 = await votante('Fabio Puesto B', l1, { puesto: 'PUESTO B' }); // B · sin parada
  const a7 = await votante('Gina Asignada Sin Marca', l1, { necesita: null }); // A · asignado aunque no esté marcado → cuenta
  await asignar(a1, conductorId, DIA); await asignar(a2, conductorId, DIA, 'recogido'); await asignar(a4, conductorId, DIA);
  await asignar(a5, conductorId, DIA, 'cancelado'); await asignar(a7, conductorId, DIA);
  await pool.query(`INSERT INTO votante_votos (votante_id, origen, voto_en) VALUES (?, 'equipo', NOW())`, [a4]);
  const textoAlerta = (r) => (r.datos.alertas || []).filter(a => a.tipo === 'transporte_sin_recoger');
  const GET = (u) => pedir('GET', '/api/dia-d/alertas', { usuario: u });

  ok(alertasLib.TIPOS.some(t => t.tipo === 'transporte_sin_recoger') && alertasLib.GRAVEDAD.transporte_sin_recoger === 7, 'el tipo transporte_sin_recoger está en TIPOS (gravedad 7)');
  ok(avisos.TIPOS_AVISADOS.has('transporte_sin_recoger') && /1 puesto con transporte sin recoger/.test(avisos.textoDelAviso({ transporte_sin_recoger: 1 })), 'el aviso push la toma: está en TIPOS_AVISADOS y tiene su frase');

  ayudaRelojEn('2026-11-08T18:00:00Z');                                   // 13:00 en Colombia: ANTES de las 14:00
  let r = await GET(U(admin, 'admin'));
  let tr = textoAlerta(r);
  ok(r.status === 200 && tr.length === 2 && tr.every(a => a.estado === 'pendiente' && a.pendiente_hasta === '14:00'),
    'a las 13:00 la alerta sale «pendiente» hasta las 14:00', r.status === 200 ? tr.map(a => [a.estado, a.pendiente_hasta]) : r.texto.slice(0, 200));
  ok(r.datos.total_activas !== undefined && r.datos.tipos.find(t => t.tipo === 'transporte_sin_recoger').pendientes === 2 && r.datos.tipos.find(t => t.tipo === 'transporte_sin_recoger').activas === 0,
    'y se cuenta como pendiente, no como activa (todavía no se avisa)');

  ayudaRelojEn('2026-11-08T20:00:00Z');                                   // 15:00: DESPUÉS
  r = await GET(U(admin, 'admin'));
  tr = textoAlerta(r);
  const A = tr.find(a => a.puesto === 'PUESTO A'), B = tr.find(a => a.puesto === 'PUESTO B');
  ok(tr.length === 2 && tr.every(a => a.estado === 'activa'), 'a las 15:00 la alerta está activa', tr.map(a => a.estado));
  ok(A && A.detalle === 'Puesto PUESTO A: 4 personas con transporte sin recoger (2 sin conductor)',
    'texto exacto, puesto A: 2 asignados sin recoger + 2 sin conductor (la recogida, el que ya votó y la cancelada se cuentan bien)', A && A.detalle);
  ok(B && B.detalle === 'Puesto PUESTO B: 1 persona con transporte sin recoger (1 sin conductor)', 'puesto B, en singular', B && B.detalle);
  ok(A && A.gravedad === 7 && A.nombre_tipo === 'Transporte sin recoger' && A.mesa === null, 'gravedad 7, nombre del tipo y sin mesa (es por puesto)');
  ok(r.datos.total_activas >= 2 && r.datos.tipos.find(t => t.tipo === 'transporte_sin_recoger').activas === 2, 'cuenta 2 activas en el resumen por tipo');

  ayudaRelojEn('2026-11-09T20:00:00Z');                                   // OTRO DÍA: la elección fue el 8
  r = await GET(U(admin, 'admin'));
  ok(r.status === 200 && textoAlerta(r).length === 0, 'fuera del día de la elección (al día siguiente) NO hay alerta, ni pendiente');
  await pool.query('UPDATE configuracion_campana SET fecha_eleccion = NULL WHERE id = 1');
  ayudaRelojEn('2026-11-08T20:00:00Z');
  r = await GET(U(admin, 'admin'));
  ok(r.status === 200 && textoAlerta(r).length === 0, 'sin fecha de elección configurada (modo prueba) NO hay alerta');
  await pool.query('UPDATE configuracion_campana SET fecha_eleccion = ? WHERE id = 1', [DIA]);

  // alcance
  const rA = await GET(U(coordA, 'coordinador')), rB = await GET(U(coordB, 'coordinador'));
  const tA = textoAlerta(rA), tB = textoAlerta(rB);
  ok(rA.status === 200 && tA.find(a => a.puesto === 'PUESTO A').detalle === 'Puesto PUESTO A: 3 personas con transporte sin recoger (1 sin conductor)'
    && tA.find(a => a.puesto === 'PUESTO B').detalle === 'Puesto PUESTO B: 1 persona con transporte sin recoger (1 sin conductor)',
    'por alcance: el coordinador de l1 ve SOLO su gente (A: 2 asignados + 1 sin conductor; B: 1)', tA.map(a => a.detalle));
  ok(rB.status === 200 && tB.length === 1 && tB[0].detalle === 'Puesto PUESTO A: 1 persona con transporte sin recoger (1 sin conductor)',
    'por alcance: el coordinador de l2 ve solo a Carla (el que ya votó no cuenta) y nada del puesto B', tB.map(a => a.detalle));
  // la ruta de los avisos push: el cálculo de la campaña, repartido a quien tiene alcance limitado
  const reqAdmin = { session: { usuario: U(admin, 'admin') }, sublicencia: null };
  await calcularAlcance(reqAdmin, {}, () => {});
  const base2 = await alertasLib.calcularAlertas(reqAdmin, { conContexto: true });
  const reqB = { session: { usuario: U(coordB, 'coordinador') }, sublicencia: null };
  await calcularAlcance(reqB, {}, () => {});
  const paraB = (await alertasLib.alertasParaUsuario(base2, reqB.alcance)).filter(a => a.tipo === 'transporte_sin_recoger');
  ok(base2.alertas.filter(a => a.tipo === 'transporte_sin_recoger').length === 2 && paraB.length === 1
    && paraB[0].detalle === 'Puesto PUESTO A: 1 persona con transporte sin recoger (1 sin conductor)' && paraB[0].estado === 'activa',
    'alertasParaUsuario (lo que reparte el aviso push) la rehace con el alcance de cada quien: 2 en la campaña, 1 para el coordinador de l2', paraB.map(a => a.detalle));
  ok(paraB[0] && paraB[0].id === 'transporte_sin_recoger|' + paraB[0].puesto_id + '|0', 'su clave (para no avisar dos veces) es tipo|puesto|0', paraB[0] && paraB[0].id);

  // la hora se cambia en la configuración de la jornada
  const cfg0 = (await pedir('GET', '/api/dia-d/alertas/config', { usuario: U(admin, 'admin') })).datos;
  ok(cfg0 && cfg0.transporte_alerta_desde === '14:00', 'GET /config trae transporte_alerta_desde (14:00 por omisión)', cfg0 && cfg0.transporte_alerta_desde);
  const cuerpo = (extra) => ({ jornada_apertura: '08:00', jornada_cierre: '16:00', plazo_e14_min: 120, alerta_checkin_min: 30, baja_votacion_pct: 40, baja_votacion_desde: '12:00', avisos_alertas_push: true, ...extra });
  let put = await pedir('PUT', '/api/dia-d/alertas/config', { usuario: U(admin, 'admin'), json: cuerpo({ transporte_alerta_desde: '15:30' }) });
  ok(put.status === 200 && (await q("SELECT TIME_FORMAT(transporte_alerta_desde, '%H:%i') h FROM configuracion_campana WHERE id = 1"))[0].h === '15:30', 'el administrador cambia la hora a 15:30');
  r = await GET(U(admin, 'admin'));
  tr = textoAlerta(r);
  ok(tr.length === 2 && tr.every(a => a.estado === 'pendiente' && a.pendiente_hasta === '15:30'), 'a las 15:00, con la hora en 15:30, vuelve a «pendiente» hasta las 15:30', tr.map(a => [a.estado, a.pendiente_hasta]));
  put = await pedir('PUT', '/api/dia-d/alertas/config', { usuario: U(admin, 'admin'), json: cuerpo({}) });   // una pantalla vieja: sin el campo
  ok(put.status === 200 && (await q("SELECT TIME_FORMAT(transporte_alerta_desde, '%H:%i') h FROM configuracion_campana WHERE id = 1"))[0].h === '15:30', 'guardar desde una pantalla vieja (sin el campo) NO pisa la hora');
  put = await pedir('PUT', '/api/dia-d/alertas/config', { usuario: U(admin, 'admin'), json: cuerpo({ transporte_alerta_desde: '25:99' }) });
  ok(put.status === 400 && /transporte/i.test(put.datos.error), 'una hora inválida → 400', put.datos);
  await pedir('PUT', '/api/dia-d/alertas/config', { usuario: U(admin, 'admin'), json: cuerpo({ transporte_alerta_desde: '14:00' }) });
  const cfgHtml = leer('public/configuracion.html');
  ok(/id="jornada-transporte-desde"/.test(cfgHtml) && /transporte_alerta_desde: document\.getElementById\('jornada-transporte-desde'\)/.test(cfgHtml) && /c\.transporte_alerta_desde/.test(cfgHtml),
    'el formulario de la jornada (Configuración) tiene el campo, lo lee y lo guarda');
  jornada.reloj = () => new Date();

  // ============================================================== 4. el texto del SMS y la firma
  console.log('\n== El texto «va en camino», medido con la firma');
  const T0 = (o) => T.textoEnCamino({ nombreVotante: 'Ana María Pérez Gómez', nombreConductor: 'Luis Conductor Prueba', placa: 'ABC123', ...o });
  const sinFirma = T0({});
  ok(sinFirma.texto === 'Ana, tu transporte va en camino. Conductor Luis C., placa ABC123. Ten tu cedula lista.' && sinFirma.segmentos === 1 && sinFirma.recorte === 'ninguno',
    'el texto A, tal cual, sin firma: «Ana, tu transporte va en camino. Conductor Luis C., placa ABC123. Ten tu cedula lista.»', sinFirma);
  ok(!/https?:|baja/i.test(sinFirma.texto), 'sin enlace y sin el pie «Baja»');
  ok(T0({ placa: '' }).texto === 'Ana, tu transporte va en camino. Conductor Luis C. Ten tu cedula lista.', 'sin placa: se quita esa parte (y no queda «C..»)', T0({ placa: '' }).texto);
  ok(T0({ nombreVotante: 'José Peña', nombreConductor: 'Ángel Núñez Muñoz' }).texto === 'Jose, tu transporte va en camino. Conductor Angel N., placa ABC123. Ten tu cedula lista.',
    'sale transliterado: sin tildes ni ñ (José → Jose, Ángel → Angel)', T0({ nombreVotante: 'José Peña', nombreConductor: 'Ángel Núñez Muñoz' }).texto);
  ok(!/[^\x00-\x7F]/.test(T0({ nombreVotante: 'Ñandú Pérez' }).texto), 'ningún carácter fuera de ASCII en el texto final');
  const L2 = T0({ placa: '' }).caracteres, L3 = L2 - ' Ten tu cedula lista.'.length;
  const f50 = 'Estrategia Marketing Politico - Campana municipal'.padEnd(50, 'x').slice(0, 50);
  ok(f50.length === 50 && T0({ firma: f50 }).segmentos === 1 && T0({ firma: f50 }).recorte === 'ninguno', 'con una firma de 50 caracteres (ASCII) el texto completo sigue cabiendo en 1 SMS', T0({ firma: f50 }));
  const fPlaca = 'f'.repeat(160 - L2);                  // el completo pasa de 160, sin placa cabe justo
  ok(T0({ firma: fPlaca }).recorte === 'sin_placa' && T0({ firma: fPlaca }).segmentos === 1 && !/placa/.test(T0({ firma: fPlaca }).texto) && /Ten tu cedula lista\.$/.test(T0({ firma: fPlaca }).texto),
    `firma de ${fPlaca.length}: pasa de 1 SMS → se quita PRIMERO la placa (y queda «Ten tu cedula lista.»)`, T0({ firma: fPlaca }));
  const fCedula = 'f'.repeat(160 - L3);                 // sin placa tampoco, sin la cédula cabe justo
  ok(T0({ firma: fCedula }).recorte === 'sin_cedula' && T0({ firma: fCedula }).segmentos === 1 && !/cedula|placa/.test(T0({ firma: fCedula }).texto),
    `firma de ${fCedula.length}: se quita DESPUÉS «Ten tu cedula lista.»`, T0({ firma: fCedula }));
  const fNada = 'f'.repeat(160 - L3 + 5);
  ok(T0({ firma: fNada }).cabe === false && T0({ firma: fNada }).segmentos === 2 && T0({ firma: fNada }).recorte === 'sin_cedula',
    `firma de ${fNada.length}: ni así cabe → se queda el texto más corto y se marca que no cabe (2 SMS)`, T0({ firma: fNada }));
  const real = T0({ firma: 'Estrategia Marketing Politico - Campaña municipal' });
  ok(real.cabe === true && real.segmentos === 1 && real.caracteres === 135 && real.recorte === 'ninguno',
    'la firma REAL de la municipal («…Campaña municipal», 49 caracteres): la ñ SÍ está en GSM-7, así que el texto completo mide 135 y cabe en 1 SMS', real);
  const conO = T0({ firma: 'Estrategia Marketing Político - Campaña municipal' });
  ok(conO.cabe === false && conO.segmentos === 2 && conO.recorte === 'sin_cedula',
    'con una ó (fuera de GSM-7) el SMS pasa a 70 por segmento: no cabe ni el texto mínimo → se recorta al mínimo y se marca «no cabe»', conO);

  // ============================================================== 5. «Voy en camino» por /t
  console.log('\n== «Voy en camino»: el SMS al votante');
  await pool.query('UPDATE configuracion_campana SET fecha_eleccion = CURDATE() WHERE id = 1');
  await pool.query('DELETE FROM transporte_asignaciones');
  const hoy = (await q("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') f"))[0].f;
  const v1 = await votante('Ana María Pérez Gómez', l1);                                              // con consentimiento
  const v2 = await votante('Beto Sin Consentimiento', l1, { sms: null });                             // sin consentimiento
  const v3 = await votante('Carla Consentimiento Cero', l1, { sms: 0 });
  const v4 = await votante('Dario De Baja', l1, { noContactar: 1 });
  const v5 = await votante('Elena Sin Telefono', l1, { telefono: '' });
  const v6 = await votante('Fabio Por Enlace Sin Confirmar', l1, { origen: 'enlace_lider' });          // llegó por /i, sin confirmar por /c
  const v7 = await votante('Gina Por Enlace Confirmada', l1, { origen: 'enlace_lider', confirmado: '2026-11-01 10:00:00' });
  const v8 = await votante('Hugo Ya Recogido', l1);
  const v9 = await votante('Irene Sin Conexion', l1);
  const ids = {};
  for (const [k, v] of Object.entries({ v1, v2, v3, v4, v5, v6, v7, v9 })) ids[k] = await asignar(v, conductorId, hoy);
  ids.v8 = await asignar(v8, conductorId, hoy, 'recogido');
  const avisar = (idParada, cod = codigoCond) => pedir('POST', `/t/${cod}/avisar`, { json: { parada_id: idParada } });
  const aviso = async (v) => (await q('SELECT aviso_enviado_en a FROM transporte_asignaciones WHERE id = ?', [ids[v]]))[0].a;
  smsSvc.invalidarCache();
  await pool.query("INSERT INTO sms_config (id, firma) VALUES (1, 'Estrategia - Campana municipal') ON DUPLICATE KEY UPDATE firma = VALUES(firma)");
  smsSvc.invalidarCache();

  const lista0 = (await pedir('GET', `/t/${codigoCond}/lista`)).datos.paradas;
  const avisoDe = (id) => lista0.find(p => p.id === ids[id]).aviso;
  ok(avisoDe('v1') === 'disponible' && avisoDe('v7') === 'disponible', 'la lista del conductor: con consentimiento (o confirmado por /c) → el botón está disponible', lista0.map(p => p.aviso));
  ok(['v2', 'v3', 'v4', 'v5', 'v6'].every(k => avisoDe(k) === 'no_recibe'), 'sin consentimiento, con consentimiento 0, de baja, sin teléfono o sin confirmar por /c → «no recibe» (sin decir por qué)');
  ok(lista0.find(p => p.id === ids.v8).aviso === null, 'una parada ya recogida no ofrece el botón');
  ok(!JSON.stringify(lista0).match(/consentimiento|no_contactar|enlace_lider/), 'la lista no revela el motivo (ni consentimiento, ni baja, ni origen)');

  let a = await avisar(ids.v1);
  ok(a.status === 200 && a.datos.ok && a.datos.aviso === 'enviado', 'con consentimiento: «Aviso enviado»', a.datos);
  ok(enviados.length === 1 && enviados[0].mensaje === 'Ana, tu transporte va en camino. Conductor Luis C., placa ABC123. Ten tu cedula lista.' && enviados[0].telefono === (await q('SELECT telefono t FROM votantes WHERE id = ?', [v1]))[0].t,
    'el proveedor simulado recibió UN mensaje con el texto y al teléfono del votante', enviados);
  ok(enviados[0].opciones.origen === 'transporte' && enviados[0].opciones.operativo !== true && enviados[0].opciones.consentimiento === true,
    'sale por enviarSMS con origen «transporte» y SIN la opción operativo (así rige la lista de baja y la franja horaria)', enviados[0].opciones);
  ok(await aviso('v1') !== null, 'queda registrado en la asignación (aviso_enviado_en)');
  a = await avisar(ids.v1);
  ok(a.datos.ok && a.datos.aviso === 'enviado' && enviados.length === 1, 'un SEGUNDO toque no reenvía (sigue en 1 mensaje)');
  const lista1 = (await pedir('GET', `/t/${codigoCond}/lista`)).datos.paradas;
  ok(lista1.find(p => p.id === ids.v1).aviso === 'enviado', 'y la lista ya muestra «enviado»: el botón no se repite');

  const antes = enviados.length;
  const resultados = {};
  for (const k of ['v2', 'v3', 'v4', 'v5', 'v6']) resultados[k] = (await avisar(ids[k])).datos;
  ok(Object.values(resultados).every(x => x.ok && x.aviso === 'no_recibe') && enviados.length === antes && (await Promise.all(['v2', 'v3', 'v4', 'v5', 'v6'].map(aviso))).every(x => x === null),
    'sin consentimiento / consentimiento 0 / de baja / sin teléfono / sin confirmar por /c: «no recibe SMS» y NO se manda nada', resultados);
  a = await avisar(ids.v7);
  ok(a.datos.aviso === 'enviado' && enviados.length === antes + 1 && enviados[enviados.length - 1].mensaje.startsWith('Gina, '), 'llegó por /i pero YA confirmó por /c: sí se le avisa');
  a = await avisar(ids.v8);
  ok(a.datos.ok && a.datos.aviso === 'no_aplica' && enviados.length === antes + 1, 'si la parada ya no está «asignada» (recogida) no se manda nada: «no aplica»', a.datos);
  ok((await pedir('POST', `/t/${codigoCond}/avisar`, { json: { parada_id: 99999999 } })).status === 404 && (await pedir('POST', `/t/${codigoCond}/avisar`, { json: {} })).status === 400,
    'una parada que no es de este conductor → 404; sin parada → 400');
  ok((await pedir('POST', `/t/ZZZZZZZZ/avisar`, { json: { parada_id: ids.v1 } })).datos.activo === false, 'un código inexistente recibe la misma respuesta «no activo»');

  // dos toques a la vez → un solo SMS
  const antesCarrera = enviados.length;
  const dos = await Promise.all([avisar(ids.v9), avisar(ids.v9)]);
  ok(dos.every(x => x.datos.ok && x.datos.aviso === 'enviado') && enviados.length === antesCarrera + 1, 'dos toques a la vez mandan UN solo SMS (se reclama antes de enviar)', dos.map(x => x.datos));

  // fallo del proveedor: se suelta la reclamación y se puede reintentar
  const vF = await votante('Fernanda Falla Proveedor', l1);
  ids.vF = await asignar(vF, conductorId, hoy);
  falloEnvio = Object.assign(new Error('proveedor caído'), { codigo: 'PROVEEDOR' });
  a = await avisar(ids.vF);
  ok(a.status === 200 && a.datos.ok === false && a.datos.aviso === 'fallo' && await aviso('vF') === null, 'si el proveedor falla: aviso «fallo», HTTP 200 y la reclamación se suelta (aviso_enviado_en vuelve a NULL)', a.datos);
  const antesRe = enviados.length;
  a = await avisar(ids.vF);
  ok(a.datos.aviso === 'enviado' && enviados.length === antesRe + 1 && await aviso('vF') !== null, 'y se puede volver a tocar: esta vez sale');
  const vB = await votante('Beatriz De Baja Por Telefono', l1);
  ids.vB = await asignar(vB, conductorId, hoy);
  falloEnvio = Object.assign(new Error('Esta persona pidió no recibir más mensajes.'), { codigo: 'DADO_DE_BAJA' });
  a = await avisar(ids.vB);
  ok(a.datos.aviso === 'no_recibe' && await aviso('vB') === null, 'si smsSvc dice DADO_DE_BAJA (baja por teléfono en otra ficha) → «no recibe SMS», sin decir por qué');

  // firma con una ó (fuera de GSM-7): a 70 por segmento no cabe: se recorta al mínimo, se envía igual y se registra el aviso
  await pool.query("UPDATE sms_config SET firma = 'Estrategia Marketing Político - Campaña municipal' WHERE id = 1");
  smsSvc.invalidarCache();
  const vL = await votante('Lucia Firma Larga', l1);
  ids.vL = await asignar(vL, conductorId, hoy);
  const avisosAntes = avisosDeConsola.length;
  a = await avisar(ids.vL);
  const ultimo = enviados[enviados.length - 1];
  ok(a.datos.aviso === 'enviado' && ultimo.mensaje === 'Lucia, tu transporte va en camino. Conductor Luis C.', 'con una firma fuera de GSM-7 (con ó): se recorta al mínimo y SE ENVÍA IGUAL', ultimo.mensaje);
  ok(avisosDeConsola.slice(avisosAntes).some(x => /no cabe en 1 SMS/.test(x) && /2 segmentos/.test(x)), 'y queda registrado el aviso de que no cabe (2 segmentos)', avisosDeConsola.slice(avisosAntes));
  // firma de 50 ASCII: texto completo
  await pool.query("UPDATE sms_config SET firma = ? WHERE id = 1", [f50]);
  smsSvc.invalidarCache();
  const vM = await votante('Marta Firma Cincuenta', l1);
  ids.vM = await asignar(vM, conductorId, hoy);
  await avisar(ids.vM);
  ok(enviados[enviados.length - 1].mensaje === 'Marta, tu transporte va en camino. Conductor Luis C., placa ABC123. Ten tu cedula lista.', 'con una firma de 50 caracteres ASCII el mensaje completo cabe y sale completo');
  // firma que obliga a quitar la placa
  await pool.query("UPDATE sms_config SET firma = ? WHERE id = 1", ['f'.repeat(80)]);       // 80 = lo máximo que admite la columna: 86 + 80 > 160, 71 + 80 = 151
  smsSvc.invalidarCache();
  const vN = await votante('Nora Firma Para Placa', l1);
  ids.vN = await asignar(vN, conductorId, hoy);
  await avisar(ids.vN);
  ok(enviados[enviados.length - 1].mensaje === 'Nora, tu transporte va en camino. Conductor Luis C. Ten tu cedula lista.', 'con una firma de 80 caracteres (el máximo), sale sin la placa pero con «Ten tu cedula lista.»', enviados[enviados.length - 1].mensaje);
  await pool.query('UPDATE sms_config SET firma = NULL WHERE id = 1');
  smsSvc.invalidarCache();

  // ============================================================== 6. la firma: dónde vive y cómo se guarda
  console.log('\n== La firma del SMS (Configurar CRM)');
  const rf = await pedir('PUT', '/api/configuracion/comunicaciones', { usuario: U(admin, 'admin'), json: { firma_sms: '  Estrategia Marketing Politico - Campaña municipal  ' } });
  ok(rf.status === 200 && (await q('SELECT firma f FROM sms_config WHERE id = 1'))[0].f === 'Estrategia Marketing Politico - Campaña municipal',
    'PUT /comunicaciones guarda la firma recortada y TAL COMO ES (con la ñ: no se translitera, porque es lo que hay que medir)', rf.datos);
  ok((await pedir('GET', '/api/configuracion/comunicaciones', { usuario: U(admin, 'admin') })).datos.firma_sms === 'Estrategia Marketing Politico - Campaña municipal', 'GET /comunicaciones la devuelve');
  ok((await smsSvc.configCampana()).firma === 'Estrategia Marketing Politico - Campaña municipal', 'y configCampana() (lo que mide cada SMS) ya la ve: se invalida la caché al guardar');
  await pedir('PUT', '/api/configuracion/comunicaciones', { usuario: U(admin, 'admin'), json: { baja_automatica: true } });
  ok((await q('SELECT firma f FROM sms_config WHERE id = 1'))[0].f === 'Estrategia Marketing Politico - Campaña municipal', 'guardar desde una pantalla vieja (sin el campo) NO borra la firma');
  ok((await pedir('PUT', '/api/configuracion/comunicaciones', { usuario: U(admin, 'admin'), json: { firma_sms: 'x'.repeat(81) } })).status === 400, 'más de 80 caracteres → 400 (y no guarda nada a medias)');
  ok((await pedir('PUT', '/api/configuracion/comunicaciones', { usuario: U(admin, 'admin'), json: { firma_sms: 'y'.repeat(80) } })).status === 200, 'justo 80 caracteres → se guarda');
  await pedir('PUT', '/api/configuracion/comunicaciones', { usuario: U(admin, 'admin'), json: { firma_sms: '' } });
  ok((await q('SELECT firma f FROM sms_config WHERE id = 1'))[0].f === null, 'vaciarla la deja en NULL (sin firma conocida)');

  console.log('\n== La advertencia de firma (pantalla, en vivo)');
  const ctx = { window: {}, module: undefined };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(leer('public/js/firma-sms-aviso.js'), ctx);
  const av = ctx.window.avisoDeFirmaSms || ctx.avisoDeFirmaSms;
  const MENSAJE = 'Firma larga: los SMS de confirmación, Ya voté y transporte pueden costar 2 créditos';
  ok(typeof av === 'function', 'la función avisoDeFirmaSms se carga en el navegador (sin dependencias)');
  ok(av('').advertencia === '' && av('').caracteres === 0, 'firma vacía: sin advertencia');
  ok(av('x'.repeat(30)).advertencia === '' && av('x'.repeat(30)).caracteres === 30, 'exactamente 30 caracteres: sin advertencia');
  ok(av('x'.repeat(31)).advertencia === MENSAJE && av('x'.repeat(31)).larga === true, '31 caracteres: «' + MENSAJE + '»');
  ok(av('Campaña').advertencia === MENSAJE && av('Campaña').conTilde === true && av('Campaña').fueraDeGsm7 === false && !/baja a 70/.test(av('Campaña').detalle),
    'corta pero con ñ: la misma advertencia; el detalle NO dice que baje a 70 (la ñ está en GSM-7) sino que se confirme con el proveedor', av('Campaña').detalle);
  ok(av('Política').advertencia === MENSAJE && av('Política').fueraDeGsm7 === true && /baja a 70/.test(av('Política').detalle) && av('Politica').advertencia === '',
    'con una tilde como í: la advertencia, y el detalle dice que el SMS baja a 70; sin tilde, ninguna');
  ok(av('Estrategia Marketing Politico - Campaña municipal').caracteres === 49, 'cuenta los caracteres de la firma real de la municipal (49)');
  ok(av('Estrategia Marketing Politico - Campaña municipal').advertencia === MENSAJE, 'y esa firma dispara la advertencia (larga y con ñ)');
  const crm = leer('public/configurar-crm.html');
  ok(/id="comunicaciones-firma-sms"/.test(crm) && /firma-sms-aviso\.js/.test(crm) && /addEventListener\('input', avisarFirma\)/.test(crm) && /firma_sms: document\.getElementById\('comunicaciones-firma-sms'\)\.value/.test(crm)
    && /c\.firma_sms/.test(crm), 'la pantalla Configurar CRM tiene el campo, el contador en vivo, y lo carga y lo guarda');
  const tc = leer('public/js/transporte-conductor.js');
  ok(/Voy en camino/.test(tc) && /Aviso enviado/.test(tc) && /Esta persona no recibe SMS/.test(tc) && /\/avisar/.test(tc), 'la pantalla del conductor: botón «Voy en camino», «Aviso enviado» y «Esta persona no recibe SMS»');

  console.warn = warnOriginal;
  console.log(`\n${fallos ? fallos + ' FALLAS' : 'TODO OK'}`);
  servidor.close();
  await pool.end().catch(() => {});
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.warn = warnOriginal; console.error('ERROR', e); process.exit(2); });
