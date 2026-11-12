#!/usr/bin/env node
// scripts/probar-fallos-menores.js
//
// Prueba del parche 330 (orden 44): FALLOS MENORES Y TEXTOS DE PANTALLA.
//   S1 (servidor, sesión y CSRF reales):
//      · punto 3  el bloqueo de 15 minutos: vencido, el contador vuelve a cero (ni entra bloqueado ni arrastra los intentos);
//      · punto 4  Agenda: el PUT conserva Departamento y Ciudad si no llegan y los borra si llegan vacíos; el listado dice `puede_gestionar`;
//      · punto 5  asistente administrativo: init-db le quita Configuración, Finanzas y CRM UNA sola vez; «Datos verificados» solo dentro de su alcance;
//      · punto 12 SMS programado fuera de horario: se rechaza AL PROGRAMAR con un mensaje claro (no con el respaldo de Twilio);
//      · punto 13 ranking: «Última marca» y «Sin movimiento» cuentan solo las marcas del día de la elección (o de hoy en Modo prueba);
//      · punto 14 desmarcar «Para reclamar» no borra la nota.
//   S2 (Chromium REAL a 390 px):
//      · punto 1  «+ Nuevo testigo» ya no abre el formulario de líder;
//      · punto 2  «Falta la firma» lleva al paso de la firma, no al del teléfono;
//      · punto 3  login: la clave admite letras (el pattern numérico va solo en el usuario);
//      · punto 8  el administrador en celular ve Ayuda y Cerrar sesión en la barra inferior;
//      · punto 9  «Rol / Perfil» al crear usuario no nace en «Admin» y muestra nombres bonitos.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada330 node scripts/probar-fallos-menores.js
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
delete process.env.NODE_ENV;

const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { csrfToken, csrfProtegido } = require('../middleware/csrf');
const smsSvc = require('../config/sms');

const RAIZ = path.join(__dirname, '..');
let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }
async function uno(sql, p) { return (await q(sql, p))[0]; }

function construir() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(session({ key: 'campana_sid', secret: process.env.SESSION_SECRET, store: new MySQLStore({}, pool), resave: false, saveUninitialized: false,
    cookie: { maxAge: 8 * 3600 * 1000, httpOnly: true, secure: false, sameSite: 'lax' } }));
  app.use(csrfToken);
  app.get('/api/csrf-token', (req, res) => res.json({ csrfToken: req.session.csrfToken }));
  app.use('/api', csrfProtegido);
  app.get('/api/marca-publica', (req, res) => res.json({ titulo: '', subtitulo: '', logo_url: '' }));
  app.use('/api/auth', require('../routes/auth.routes'));
  app.use('/api/permisos', require('../routes/permisos.routes'));
  app.use('/api/votantes', require('../routes/votantes.routes'));
  app.use('/api/usuarios', require('../routes/usuarios.routes'));
  app.use('/api/configuracion', require('../routes/configuracion.routes'));
  app.use('/api/territorial', require('../routes/territorial.routes'));
  app.use('/api/eventos', require('../routes/eventos.routes'));
  app.use('/api/dia-d/rescate', require('../routes/rescateVotos.routes'));
  app.use('/api/dia-d/resultados', require('../routes/resultadosDiaD.routes'));
  app.use('/api/comunicaciones', require('../routes/comunicaciones.routes'));
  app.use('/api/dia-d', require('../routes/diaD.routes'));
  for (const [ruta, modulo] of [['dashboard', 'dashboard'], ['geo', 'geo'], ['panel-lider', 'panelLider'], ['contenido', 'contenido'], ['catalogo', 'catalogo'], ['push', 'push']]) {
    app.use('/api/' + ruta, require(`../routes/${modulo}.routes`));
  }
  app.use(express.static(path.join(RAIZ, 'public')));
  return app;
}

let base = '';
let ipN = 0;
function cliente() {
  const c = { cookie: '', csrf: null };
  const ip = `198.51.100.${(ipN++ % 200) + 20}`;
  c.pedir = async (metodo, ruta, { json } = {}) => {
    const h = { 'X-Forwarded-For': ip };
    if (c.cookie) h.Cookie = c.cookie;
    if (json !== undefined) h['Content-Type'] = 'application/json';
    if (metodo !== 'GET') {
      if (!c.csrf) {
        const r0 = await fetch(base + '/api/csrf-token', { headers: h });
        const sc0 = r0.headers.getSetCookie ? r0.headers.getSetCookie() : [];
        const n0 = sc0.find((x) => x.startsWith('campana_sid='));
        if (n0) { c.cookie = n0.split(';')[0]; h.Cookie = c.cookie; }
        c.csrf = (await r0.json()).csrfToken;
      }
      h['X-CSRF-Token'] = c.csrf;
    }
    const r = await fetch(base + '/api' + ruta, { method: metodo, headers: h, body: json !== undefined ? JSON.stringify(json) : undefined });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    const nueva = sc.find((x) => x.startsWith('campana_sid='));
    if (nueva) { c.cookie = nueva.split(';')[0]; c.csrf = null; }
    const texto = await r.text();
    let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
    return { status: r.status, datos, texto };
  };
  return c;
}

let n = 0;
const sello = String(Date.now()).slice(-6);
async function usuario(nombre, rol, extra = {}) {
  n++;
  const cedula = `97${sello}${n}`;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, cedula, cedula, bcrypt.hashSync(extra.clave || 'clave-ejemplo', 4), rol]);
  return { id: r.insertId, rol, nombre, cedula };
}
async function entrar(u, clave) {
  const c = cliente();
  const r = await c.pedir('POST', '/auth/login', { json: { email: u.cedula, password: clave || 'clave-ejemplo', recordar: false } });
  c.login = r;
  return c;
}
async function votante(nombre, liderId) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO votantes (nombre, cedula, telefono, lider_id, categoria) VALUES (?, ?, ?, ?, 'votante')`, [nombre, `98${sello}${n}`, `3${sello}${n}`.slice(0, 10), liderId]);
  return r.insertId;
}

(async () => {
  const servidor = http.createServer(construir());
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  console.log('FALLOS MENORES Y TEXTOS — base «' + nombreBase + '»');

  const admin = await usuario('Admin Menores', 'admin');
  const asis = await usuario('Asistente Menores', 'asistente_administrativo');
  const lid1 = await usuario('Lider Uno Menores', 'lider');
  const lid2 = await usuario('Lider Dos Menores', 'lider');
  const subl = await usuario('Sublider Menores', 'sublider');
  for (const clave of ['resultados_dia_d', 'faltan_por_votar', 'alertas_dia_d']) await pool.query('UPDATE complementos_campana SET activo = 1 WHERE clave = ?', [clave]);
  await pool.query('INSERT INTO configuracion_campana (id) VALUES (1) ON DUPLICATE KEY UPDATE id = id');
  const cAdmin = await entrar(admin);
  ok(cAdmin.login.status === 200, 'el administrador de prueba entra', cAdmin.login.texto);

  // ====================================================================================== 3. BLOQUEO DE 15 MINUTOS
  console.log('\nPunto 3. Bloqueo de 15 minutos: vencido, el contador vuelve a cero');
  const bloq = await usuario('Bloqueado Vencido', 'lider');
  await q(`UPDATE usuarios SET intentos_fallidos = 5, bloqueado_hasta = ? WHERE id = ?`, [new Date(Date.now() - 60000), bloq.id]);
  let c = cliente();
  let r = await c.pedir('POST', '/auth/login', { json: { email: bloq.cedula, password: 'clave-equivocada', recordar: false } });
  let f = await uno('SELECT intentos_fallidos AS i, bloqueado_hasta AS b FROM usuarios WHERE id = ?', [bloq.id]);
  ok(r.status === 401, 'vencido el bloqueo, una clave mala responde «incorrecta» (401), no «cuenta bloqueada»', { status: r.status, texto: r.texto });
  ok(f.i === 1 && f.b === null, 'y el contador arranca de cero: queda en 1 intento (no en 6) y sin fecha de bloqueo', f);
  await q(`UPDATE usuarios SET intentos_fallidos = 5, bloqueado_hasta = ? WHERE id = ?`, [new Date(Date.now() - 60000), bloq.id]);
  c = cliente();
  r = await c.pedir('POST', '/auth/login', { json: { email: bloq.cedula, password: 'clave-ejemplo', recordar: false } });
  f = await uno('SELECT intentos_fallidos AS i, bloqueado_hasta AS b FROM usuarios WHERE id = ?', [bloq.id]);
  ok(r.status === 200 && f.i === 0 && f.b === null, 'vencido el bloqueo, la clave buena entra y deja el contador en cero', { status: r.status, f });
  await q(`UPDATE usuarios SET intentos_fallidos = 5, bloqueado_hasta = ? WHERE id = ?`, [new Date(Date.now() + 10 * 60000), bloq.id]);
  c = cliente();
  r = await c.pedir('POST', '/auth/login', { json: { email: bloq.cedula, password: 'clave-ejemplo', recordar: false } });
  ok(r.status === 423 || r.status === 429 || r.status === 403, 'un bloqueo VIGENTE sigue bloqueando aunque la clave sea buena', { status: r.status, texto: r.texto });
  ok(/Intenta de nuevo/.test(r.texto), 'y el mensaje habla de tú («Intenta de nuevo…»)', r.texto);

  // ====================================================================================== 4. AGENDA
  console.log('\nPunto 4. Agenda: el PUT no borra Departamento ni Ciudad; `puede_gestionar`');
  const [ev] = await pool.query(
    `INSERT INTO eventos (titulo, tipo, fecha_inicio, lugar, departamento, ciudad, lider_id, responsable_id, created_by)
     VALUES ('Reunión de prueba', 'reunion', '2026-12-01 10:00:00', 'Salón', 'Caldas', 'Manizales', ?, ?, ?)`, [lid1.id, lid1.id, admin.id]);
  const evId = ev.insertId;
  const cuerpo = (extra) => ({ titulo: 'Reunión de prueba', tipo: 'reunion', fecha_inicio: '2026-12-01 10:00:00', lugar: 'Salón', lider_id: lid1.id, responsable_id: lid1.id, ...extra });
  r = await cAdmin.pedir('PUT', `/eventos/${evId}`, { json: cuerpo({ titulo: 'Reunión editada desde la Agenda' }) });
  f = await uno('SELECT titulo, departamento, ciudad FROM eventos WHERE id = ?', [evId]);
  ok(r.status === 200 && f.titulo === 'Reunión editada desde la Agenda', 'editar desde la Agenda (sin mandar Departamento ni Ciudad) guarda', { status: r.status, texto: r.texto });
  ok(f.departamento === 'Caldas' && f.ciudad === 'Manizales', 'y NO borra Departamento ni Ciudad', f);
  r = await cAdmin.pedir('PUT', `/eventos/${evId}`, { json: cuerpo({ departamento: 'Caldas', ciudad: '' }) });
  f = await uno('SELECT departamento, ciudad FROM eventos WHERE id = ?', [evId]);
  ok(r.status === 200 && f.departamento === 'Caldas' && f.ciudad === null, 'una Ciudad que llega VACÍA sí se borra (la pantalla de Eventos lo usa para quitarla)', f);
  r = await cAdmin.pedir('PUT', `/eventos/${evId}`, { json: cuerpo({ departamento: 'Antioquia', ciudad: 'Medellín' }) });
  f = await uno('SELECT departamento, ciudad FROM eventos WHERE id = ?', [evId]);
  ok(f.departamento === 'Antioquia' && f.ciudad === 'Medellín', 'y valores nuevos se guardan', f);
  await q(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES ('sublider', 'eventos', 1, 0, 0) ON DUPLICATE KEY UPDATE permitido = 1`);
  await q(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES ('lider', 'eventos', 1, 1, 1) ON DUPLICATE KEY UPDATE permitido = 1`);
  const cL1 = await entrar(lid1), cSub = await entrar(subl);
  r = await cAdmin.pedir('GET', '/eventos');
  let e = (r.datos || []).find((x) => x.id === evId);
  ok(r.status === 200 && e && e.puede_gestionar === true, 'el administrador ve el evento con puede_gestionar = true', e && e.puede_gestionar);
  r = await cL1.pedir('GET', '/eventos');
  e = (r.datos || []).find((x) => x.id === evId);
  ok(r.status === 200 && e && e.puede_gestionar === true, 'el líder responsable lo ve con puede_gestionar = true', { status: r.status, e: e && e.puede_gestionar });
  r = await cSub.pedir('GET', '/eventos');
  e = (r.datos || []).find((x) => x.id === evId);
  ok(r.status === 200 && (!e || e.puede_gestionar === false), 'un sublíder, si lo ve, lo ve con puede_gestionar = false (la Agenda se lo abre en solo lectura)', { status: r.status, e: e && e.puede_gestionar });
  ok(r.datos && r.datos.every((x) => !('puede_gestionar_sql' in x)), 'y la columna auxiliar del SQL no se filtra a la respuesta');

  // ====================================================================================== 5. ASISTENTE ADMINISTRATIVO
  console.log('\nPunto 5. Asistente administrativo: siembra y «Datos verificados» dentro de su alcance');
  const filasFabrica = await q(`SELECT modulo, permitido FROM permisos_rol WHERE rol = 'asistente_administrativo' AND modulo IN ('configuracion','finanzas','crm')`);
  ok(filasFabrica.every((x) => x.permitido === 0), 'una instalación NUEVA no le da Configuración, Finanzas ni CRM al asistente (de fábrica)', filasFabrica);
  // Una instalación anterior: los tres en 1 y sin la marca → init-db se los quita UNA vez
  await q(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES ('asistente_administrativo','configuracion',1,1,1), ('asistente_administrativo','finanzas',1,1,1), ('asistente_administrativo','crm',1,1,1)
           ON DUPLICATE KEY UPDATE permitido = 1, editar = 1, agregar = 1`);
  try { await pool.query('ALTER TABLE configuracion_campana DROP COLUMN permisos_asistente_sembrado'); } catch (_) { /* aún no existía */ }
  const correrInit = () => execFileSync(process.execPath, [path.join(RAIZ, 'db', 'init-db.js')], { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 280000 });
  let salida = correrInit();
  const mods = async () => q(`SELECT modulo, permitido FROM permisos_rol WHERE rol = 'asistente_administrativo' AND modulo IN ('configuracion','finanzas','crm') ORDER BY modulo`);
  ok((await mods()).every((x) => x.permitido === 0), 'la primera corrida de init-db le quita los tres a una instalación que los traía', await mods());
  ok(/Asistente administrativo: se le quitó/.test(salida), 'y lo dice en la salida');
  await q(`UPDATE permisos_rol SET permitido = 1 WHERE rol = 'asistente_administrativo' AND modulo = 'crm'`);   // el administrador se lo vuelve a dar a mano
  salida = correrInit();
  ok((await uno(`SELECT permitido AS p FROM permisos_rol WHERE rol = 'asistente_administrativo' AND modulo = 'crm'`)).p === 1, 'una SEGUNDA corrida NO se lo vuelve a quitar (una sola vez)');
  ok(!/Asistente administrativo: se le quitó/.test(salida), 'y no lo repite en la salida');

  const cAsis = await entrar(asis);
  const vPropio = await votante('Votante del asistente', asis.id);
  const vAjeno = await votante('Votante de otro líder', lid2.id);
  r = await cAsis.pedir('PUT', `/votantes/${vPropio}/verificar`, { json: { datos_verificados: true } });
  ok(r.status === 200, '«Datos verificados» sobre una ficha DENTRO de su alcance: 200', { status: r.status, texto: r.texto });
  r = await cAsis.pedir('PUT', `/votantes/${vAjeno}/verificar`, { json: { datos_verificados: true } });
  ok(r.status === 404, 'sobre una ficha FUERA de su alcance: 404 (como una ficha que no existe)', { status: r.status, texto: r.texto });
  ok((await uno('SELECT datos_verificados AS d FROM votantes WHERE id = ?', [vAjeno])).d === 0, 'y la ficha ajena no quedó verificada');
  r = await cAdmin.pedir('PUT', `/votantes/${vAjeno}/verificar`, { json: { datos_verificados: true } });
  ok(r.status === 200, 'el administrador sí verifica cualquier ficha de la campaña', { status: r.status, texto: r.texto });

  // ====================================================================================== 12. SMS PROGRAMADO FUERA DE HORARIO
  console.log('\nPunto 12. SMS programado fuera de horario: se rechaza AL PROGRAMAR');
  const estadoReal = smsSvc.estadoCanal, cfgReal = smsSvc.configCampana;
  smsSvc.estadoCanal = async () => ({ configurado: true, motivo: null, enFranja: true, franja: { inicio: 8, fin: 20 }, proveedor: 'onurix', respaldo: null, saldo: null });
  smsSvc.configCampana = async () => ({ horarioInicio: 8, horarioFin: 20 });
  const manana = new Date(); manana.setUTCDate(manana.getUTCDate() + 1);
  const aHoraColombia = (h) => new Date(Date.UTC(manana.getUTCFullYear(), manana.getUTCMonth(), manana.getUTCDate(), h + 5, 30, 0)).toISOString();
  const campana = (programado) => ({ nombre: 'SMS programado de prueba', canal: 'sms', mensaje: 'Hola, es una prueba', filtros: { fuente: 'estructura' }, programado_para: programado });
  r = await cAdmin.pedir('POST', '/comunicaciones/campanas', { json: campana(aHoraColombia(21)) });
  ok(r.status === 400 && /Programaste el SMS para las 21:30/.test(r.texto) && /8:00 a 20:00/.test(r.texto), 'programado para las 21:30 (Colombia): 400 con la hora y el horario permitido', { status: r.status, texto: r.texto });
  r = await cAdmin.pedir('POST', '/comunicaciones/campanas', { json: campana(aHoraColombia(5)) });
  ok(r.status === 400 && /Programaste el SMS para las 05:30/.test(r.texto), 'programado para las 05:30 (Colombia): también 400', { status: r.status, texto: r.texto });
  r = await cAdmin.pedir('POST', '/comunicaciones/campanas', { json: campana(aHoraColombia(10)) });
  ok(!/Programaste el SMS/.test(r.texto), 'programado para las 10:30 (dentro de 8:00 a 20:00): NO se rechaza por horario', { status: r.status, texto: r.texto.slice(0, 200) });
  smsSvc.estadoCanal = async () => ({ configurado: true, motivo: null, enFranja: true, franja: null, proveedor: 'twilio', respaldo: null, saldo: null });
  r = await cAdmin.pedir('POST', '/comunicaciones/campanas', { json: campana(aHoraColombia(21)) });
  ok(!/Programaste el SMS/.test(r.texto), 'con el respaldo de Twilio (sin franja) no se le inventa un horario', { status: r.status, texto: r.texto.slice(0, 200) });
  smsSvc.estadoCanal = estadoReal; smsSvc.configCampana = cfgReal;

  // ====================================================================================== 13. RANKING
  console.log('\nPunto 13. Ranking: «Última marca» y «Sin movimiento» cuentan solo las marcas del día');
  const rk1 = await usuario('Líder con marca de hoy', 'lider'), rk2 = await usuario('Líder con marca de ayer', 'lider'), rk3 = await usuario('Líder sin marcas', 'lider');
  const a1 = await votante('Rk1 votó hoy', rk1.id), a2 = await votante('Rk1 pendiente', rk1.id);
  const b1 = await votante('Rk2 votó ayer', rk2.id), b2 = await votante('Rk2 pendiente', rk2.id);
  const d1 = await votante('Rk3 pendiente', rk3.id);
  await q(`INSERT INTO votante_votos (votante_id, voto_en, origen) VALUES (?, DATE_SUB(NOW(), INTERVAL 5 MINUTE), 'equipo')`, [a1]);
  await q(`INSERT INTO votante_votos (votante_id, voto_en, origen) VALUES (?, DATE_SUB(NOW(), INTERVAL 1 DAY), 'equipo')`, [b1]);
  const ranking = async (orden) => (await cAdmin.pedir('GET', `/dia-d/rescate/ranking${orden ? '?orden=' + orden : ''}`));
  const fila = (res, l) => (res.datos.lideres || []).find((x) => x.lider_id === l.id);
  // Modo prueba: la elección es dentro de 10 días → cuenta «hoy»
  await q(`UPDATE configuracion_campana SET fecha_eleccion = DATE_ADD(CURDATE(), INTERVAL 10 DAY) WHERE id = 1`);
  r = await ranking();
  ok(r.status === 200 && r.datos.modo_prueba === true, 'con la elección dentro de 10 días la pantalla está en Modo prueba', r.datos && r.datos.modo_prueba);
  ok(fila(r, rk1) && fila(r, rk1).ultima_marca && fila(r, rk1).sin_movimiento === false, 'Modo prueba: el líder con una marca de HOY tiene «Última marca» y NO está sin movimiento', fila(r, rk1));
  ok(fila(r, rk2) && fila(r, rk2).ultima_marca === null && fila(r, rk2).min_sin_marca === null && fila(r, rk2).sin_movimiento === true, 'Modo prueba: la marca de AYER no cuenta: sin «Última marca» y sí «Sin movimiento»', fila(r, rk2));
  ok(fila(r, rk2).votaron === 1 && fila(r, rk2).pct === 50, 'pero «votaron» y el porcentaje siguen contando todas las marcas (1 de 2 = 50 %)', fila(r, rk2));
  ok(fila(r, rk3) && fila(r, rk3).sin_movimiento === true, 'un líder sin ninguna marca sigue «sin movimiento»', fila(r, rk3));
  r = await ranking('sin_movimiento');
  ok(r.status === 200 && fila(r, rk2) && fila(r, rk3) && !fila(r, rk1), 'el orden «sin movimiento» lista a los de ayer y a los sin marca, no al de hoy', (r.datos.lideres || []).map((x) => x.nombre));
  // El día de la elección es hoy
  await q(`UPDATE configuracion_campana SET fecha_eleccion = CURDATE() WHERE id = 1`);
  r = await ranking();
  ok(r.datos.modo_prueba === false && fila(r, rk1).sin_movimiento === false && fila(r, rk2).ultima_marca === null && fila(r, rk2).sin_movimiento === true,
    'el día de la elección cuenta solo las marcas de ese día (lo mismo que arriba)', { rk1: fila(r, rk1), rk2: fila(r, rk2) });
  // La elección fue hace 3 días: cuenta el día de ESA elección, no hoy
  await q(`UPDATE votante_votos SET voto_en = DATE_SUB(NOW(), INTERVAL 3 DAY) WHERE votante_id = ?`, [b1]);
  await q(`UPDATE configuracion_campana SET fecha_eleccion = DATE_SUB(CURDATE(), INTERVAL 3 DAY) WHERE id = 1`);
  r = await ranking();
  ok(fila(r, rk2).ultima_marca !== null && fila(r, rk1).ultima_marca === null, 'ya pasada la elección, cuentan las marcas del día de ESA elección (no las de hoy)', { rk1: fila(r, rk1).ultima_marca, rk2: fila(r, rk2).ultima_marca });
  await q(`UPDATE configuracion_campana SET fecha_eleccion = NULL WHERE id = 1`);
  r = await ranking();
  ok(r.status === 200 && fila(r, rk1).ultima_marca, 'sin fecha de elección tampoco falla: cuenta hoy', r.status);

  // ====================================================================================== 14. DESMARCAR «PARA RECLAMAR»
  console.log('\nPunto 14. Desmarcar «Para reclamar» no borra la nota');
  const rev = (extra) => cAdmin.pedir('PUT', '/dia-d/resultados/revision', { json: { puesto_texto: 'PUESTO DE PRUEBA 330', mesa: 4, ...extra } });
  const filaRev = () => uno(`SELECT estado, nota FROM dia_d_mesa_revision WHERE puesto_texto LIKE '%PUESTO DE PRUEBA 330%' AND mesa = 4`);
  r = await rev({ estado: 'para_reclamar', nota: 'El E-14 trae un tachón en la casilla 3' });
  ok(r.status === 200, 'marcar «Para reclamar» con nota', { status: r.status, texto: r.texto });
  let rv = await filaRev();
  ok(rv && rv.estado === 'para_reclamar' && /tachón/.test(rv.nota), 'queda marcada con su nota', rv);
  r = await rev({ estado: 'ninguno', nota: 'El E-14 trae un tachón en la casilla 3' });
  rv = await filaRev();
  ok(r.status === 200 && rv && rv.estado === 'sin_revision' && /tachón/.test(rv.nota), 'desmarcar (la casilla de la tabla manda la nota que ya tenía): la fila se queda en «sin_revision» CON su nota', { status: r.status, rv });
  r = await rev({ estado: 'para_reclamar' });
  rv = await filaRev();
  ok(rv && rv.estado === 'para_reclamar' && /tachón/.test(rv.nota), 'volver a marcar sin mandar nota conserva la nota anterior');
  r = await rev({ estado: 'ninguno' });
  rv = await filaRev();
  ok(r.status === 200 && rv && rv.estado === 'sin_revision' && /tachón/.test(rv.nota), 'desmarcar SIN mandar la nota también la conserva (viene de lo guardado)', rv);
  r = await rev({ estado: 'ninguno', nota: '' });
  rv = await filaRev();
  ok(r.status === 200 && !rv, 'desmarcar con la nota BORRADA a propósito: sin nada que conservar, la fila se elimina', rv);
  r = await rev({ estado: 'ninguno' });
  ok(r.status === 200, 'desmarcar una mesa que nunca se marcó no falla', r.status);
  const cuenta = await uno(`SELECT COUNT(*) AS n FROM dia_d_mesa_revision WHERE estado = 'para_reclamar'`);
  ok(cuenta.n === 0, '«sin_revision» no cuenta como marcada para el paquete del abogado', cuenta);

  // ====================================================================================== S2. CHROMIUM A 390 px
  console.log('\nS2. Chromium real, 390 px');
  const { lanzar } = require('./capturas/navegador');
  const nav = await lanzar();
  try {
    const p = await nav.pagina('about:blank');
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const ir = async (ruta, ms = 1800) => { await p.cmd('Page.navigate', { url: base + ruta }); await espera(ms); };
    const donde = () => p.ev('location.pathname + location.hash');

    // ---- punto 3: login con clave de letras
    const conLetras = await usuario('Líder clave de letras', 'lider', { clave: 'Abcd-efgh9' });
    await ir('/login.html', 1500);
    await p.ev(`(() => { const b = document.getElementById('ir-a-lideres-desde-eleccion'); if (b) b.click(); else if (typeof ponerModoLider === 'function') ponerModoLider(); })()`);
    await espera(400);
    const attrs = await p.ev(`(() => { const f = document.getElementById('form-login'); const u = f.email, c = f.password; return { uPattern: u.getAttribute('pattern'), uMode: u.getAttribute('inputmode'), cPattern: c.getAttribute('pattern'), cMode: c.getAttribute('inputmode') }; })()`);
    ok(attrs.uPattern === '[0-9]*' && attrs.uMode === 'numeric', 'el USUARIO conserva pattern numérico y teclado numérico', attrs);
    ok(!attrs.cPattern && !attrs.cMode, 'la CLAVE no lleva pattern ni inputmode (acepta letras)', attrs);
    const valida = await p.ev(`(() => { const f = document.getElementById('form-login'); f.email.value = ${JSON.stringify(conLetras.cedula)}; f.password.value = 'Abcd-efgh9'; return f.password.validity.valid && f.email.validity.valid; })()`);
    ok(valida === true, 'el navegador da por válidos usuario numérico y clave con letras');
    await p.ev(`(() => { const f = document.getElementById('form-login'); f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); })()`);
    for (let i = 0; i < 40 && (await donde()).startsWith('/login.html'); i++) await espera(250);
    ok(!(await donde()).startsWith('/login.html'), 'y el líder con clave de letras ENTRA por el formulario real', await donde());

    // ---- punto 8: administrador en celular, barra inferior
    await p.ev(`fetch('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': '' } }).catch(() => {})`);
    await q('DELETE FROM sessions');
    await ir('/login.html', 1200);
    await p.ev(`(() => { const f = document.getElementById('form-login'); f.email.value = ${JSON.stringify(admin.cedula)}; f.password.value = 'clave-ejemplo'; f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); })()`);
    for (let i = 0; i < 40 && (await donde()).startsWith('/login.html'); i++) await espera(250);
    await ir('/app/admin-panel.html', 2500);
    const dondeAdmin = await donde();
    const barra = await p.ev(`Array.from(document.querySelectorAll('nav a, nav button')).map(e => (e.textContent || '').trim()).filter(Boolean)`);
    ok(dondeAdmin.startsWith('/app/admin-panel'), 'el administrador abre el panel del celular', dondeAdmin);
    ok(barra.some((t) => /Ayuda/i.test(t)) && barra.some((t) => /Salir|Cerrar sesión/i.test(t)), 'la barra inferior del panel trae «Ayuda» y «Salir» (cerrar sesión)', barra);

    // ---- punto 1: «+ Nuevo testigo»
    const hrefs = await p.ev(`fetch('/js/cobertura-testigos.js').then(r => r.text())`);
    ok(/votantes\.html#testigo-nuevo/.test(hrefs) && !/territorial\.html#testigo-nuevo/.test(hrefs), 'cobertura-testigos.js manda «+ Nuevo testigo» a Votantes, no al formulario de líder', hrefs.match(/[a-z]+\.html#[a-z-]+/g));
    await ir('/votantes.html#testigo-nuevo', 3000);
    const form1 = await p.ev(`(() => { const t = document.getElementById('chk-asignar-testigo-votante'); const modal = document.querySelector('.modal-overlay.visible, .modal.visible, .modal-backdrop.visible, [id*="modal"].visible, [id*="modal"][style*="flex"]'); return { chk: t ? t.checked : null, modal: !!modal, url: location.pathname + location.hash }; })()`);
    ok(form1.chk === true, 'Votantes se abre con «Es también testigo electoral» ya marcada', form1);
    await ir('/territorial.html#testigo-nuevo', 1500);
    for (let i = 0; i < 24 && !(await donde()).startsWith('/votantes.html'); i++) await espera(500);
    ok((await donde()).startsWith('/votantes.html#testigo-nuevo'), 'y el enlace viejo a Líderes #testigo-nuevo redirige a Votantes', { donde: await donde(), fallidas: p.respuestas.filter((x) => x.status >= 400 || x.status === 0).map((x) => x.status + ' ' + x.url.replace(base, '')) });

    // ---- punto 9: «Rol / Perfil» al crear usuario
    await ir('/configuracion.html', 3500);
    const roles = await p.ev(`(async () => {
      const b = document.getElementById('btn-nuevo-usuario'); if (!b) return null;
      b.click();
      await new Promise(r => setTimeout(r, 800));
      const s = document.getElementById('usuario-form-rol');
      return s ? { valor: s.value, requerido: s.required, opciones: Array.from(s.options).map(o => ({ v: o.value, t: o.textContent.trim() })) } : null;
    })()`);
    ok(roles && roles.valor === '' && roles.requerido === true, 'el selector «Rol / Perfil» NO nace en «Admin»: nace vacío y es obligatorio', roles && { valor: roles.valor, requerido: roles.requerido });
    ok(roles && roles.opciones[0].t === 'Elige un rol…' && roles.opciones.some((o) => o.v === 'lider' && /^Líder/.test(o.t)) && roles.opciones.some((o) => o.v === 'asistente_administrativo' && /^Asistente administrativo/.test(o.t))
      && !roles.opciones.some((o) => /^(Lider|Asistente_administrativo)\b/.test(o.t)), 'y muestra nombres bonitos («Líder», «Asistente administrativo»), no «Lider» ni «Asistente_administrativo»', roles && roles.opciones.map((o) => o.t));

    // ---- punto 2: «Falta la firma» lleva al paso de la firma
    const destino = await p.ev(`fetch('/app/registro-votante.html').then(r => r.text()).then(src => { const m = src.match(/function destinoDelError[\\s\\S]*?\\n  \\}/); return m ? m[0] : null; })`);
    ok(!!destino, 'registro-votante.html trae destinoDelError');
    if (destino) {
      const res2 = await p.ev(`(() => {
        const campo = (x) => x;
        ${destino}
        const pasos = (t) => (destinoDelError(t) || {}).paso;
        return { firma: pasos('Falta la firma de la persona. Pásale el teléfono para que firme.'), autoriz: pasos('Falta la autorización de tratamiento de datos.'), tel: pasos('El teléfono no es válido.'), cedula: pasos('Cédula ya registrada.') };
      })()`);
      ok(res2.firma === 4 && res2.autoriz === 4, '«Falta la firma» (que nombra el teléfono) y «autorización» llevan al paso 4, el de la firma', res2);
      ok(res2.tel === 3 && res2.cedula === 2, 'y el teléfono y la cédula siguen yendo a su paso (3 y 2)', res2);
    }
    ok(p.avisos.length === 0, 'sin errores de JavaScript en las pantallas probadas', p.avisos);
    p.cerrar();
  } finally {
    nav.cerrar();
  }

  console.log(fallos ? `\n${fallos} comprobación(es) FALLARON.` : '\nTodas las comprobaciones pasaron.');
  servidor.close();
  await pool.end().catch(() => {});
  process.exit(fallos ? 1 : 0);
})().catch(async (err) => { console.error('ERROR:', err); try { await pool.end(); } catch (_) { /* nada */ } process.exit(1); });
