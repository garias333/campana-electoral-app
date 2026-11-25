#!/usr/bin/env node
// scripts/probar-tareas-direccion.js — orden 116: «TAREAS DE DIRECCIÓN» (la sección privada del candidato y del superadministrador). PRUEBA DEL SERVIDOR.
//
// Cubre: quién entra (y quién NO, método por método), el CRUD y los movimientos entre columnas, «marcar como realizada» antes de tiempo (cancela el aviso) con
// su deshacer y su reapertura, el AVISO AUTOMÁTICO 3 días antes con un reloj inyectable y un proveedor simulado (una sola vez, sin doble envío, sin celular,
// el candidato por «Mis avisos», fecha corta, cambio de fecha, falla, fuera de franja, vuelta diaria a las 08:00), el largo del SMS (1 segmento con firma),
// WhatsApp y que las tareas no se asomen en ningún otro módulo.
//
// USO (base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada116 node scripts/probar-tareas-direccion.js
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) { console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`); process.exit(2); }
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';
process.env.SMS_PROVIDER = 'none';   // nada sale a ningún proveedor

const fs = require('fs');
const path = require('path');
const http = require('http');
const pool = require('../config/db');
const { crear: crearServidor } = require('./capturas/servidor');
const R = require('../public/js/tareas-direccion-reglas');
const T = require('../lib/tareasDireccion');
const { analizarTexto } = require('../lib/sms');

const RAIZ = path.join(__dirname, '..');
let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];

/** Un cliente HTTP: la «sesión» es la cookie ej_usuario (el servidor de pruebas la resuelve contra la base). */
function cliente(base, usuarioId, extraCookie) {
  const pedir = async (metodo, ruta, cuerpo) => {
    const cookie = (usuarioId ? `ej_usuario=${usuarioId}` : '') + (extraCookie ? '; ' + extraCookie : '');
    const r = await fetch(base + '/api' + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    const texto = await r.text(); let datos = null; try { datos = JSON.parse(texto); } catch (_) { datos = texto; }
    return { status: r.status, datos, texto };
  };
  return { get: (r) => pedir('GET', r), post: (r, b) => pedir('POST', r, b || {}), put: (r, b) => pedir('PUT', r, b || {}), patch: (r, b) => pedir('PATCH', r, b || {}), del: (r) => pedir('DELETE', r) };
}

/** Un instante de Colombia: «AAAA-MM-DD» + hora → Date (UTC = Colombia + 5 h). */
const en = (dia, hh = 8, mm = 0) => { const [y, m, d] = dia.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, hh + 5, mm)); };
const HOY_REAL = R.enColombia(new Date()).hoy;

(async () => {
  await q('DELETE FROM tareas_direccion');
  await q("DELETE FROM usuarios WHERE numero_identificacion BETWEEN '7160001' AND '7160099' AND es_superadmin = 0");   // repetible: los usuarios de una corrida anterior
  const rolId = async (n) => (await q('SELECT id FROM roles WHERE nombre = ?', [n]))[0].id;
  let cedula = 7160000;
  const usuario = async (nombre, rol, extra = {}) => {
    cedula++;
    const [r] = await pool.query(
      `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, es_candidato, es_superadmin)
       VALUES (?, ?, ?, ?, ?, 'x', ?, 1, ?, ?)`,
      [nombre, String(cedula), String(cedula), `u${cedula}@ejemplo.co`, extra.telefono || null, await rolId(rol), extra.es_candidato ? 1 : 0, extra.es_superadmin ? 1 : 0]);
    return r.insertId;
  };
  const yaHaySuper = (await q('SELECT id FROM usuarios WHERE es_superadmin = 1 LIMIT 1'))[0];
  const ids = {
    super: yaHaySuper ? yaHaySuper.id : await usuario('Super Admin Oculto', 'admin', { es_superadmin: 1 }),
    cand: await usuario('Juan Pérez Candidato', 'candidato', { telefono: '3009990000' }),
    admCand: await usuario('Admin Que Es Candidato', 'admin', { es_candidato: 1 }),
    admSin: await usuario('Admin Sin Casilla', 'admin'),
    coord: await usuario('Coordinadora Ejemplo', 'coordinador'),
    lider: await usuario('Líder Ejemplo', 'lider'),
    sub: await usuario('Sublíder Ejemplo', 'sublider'),
    testigo: await usuario('Testigo Ejemplo', 'testigo'),
    asist: await usuario('Asistente Ejemplo', 'asistente_administrativo'),
    tesorera: await usuario('María Tesorera', 'asistente_administrativo', { telefono: '300 111 2233' }),
  };
  // Sólo hay UN candidato activo para «responsable = candidato»: el administrador marcado también cuenta; se prueba con `cand`.
  const srv = http.createServer(crearServidor(pool, { soloLecturaCandidato: true }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const C = {
    super: cliente(base, ids.super), cand: cliente(base, ids.cand), admCand: cliente(base, ids.admCand), soloCand: cliente(base, ids.admCand, 'ej_solo_candidato=1'),
    admSin: cliente(base, ids.admSin), coord: cliente(base, ids.coord), lider: cliente(base, ids.lider), sub: cliente(base, ids.sub), testigo: cliente(base, ids.testigo),
    asist: cliente(base, ids.asist), anon: cliente(base, null),
  };
  const manana = R.sumarDias(HOY_REAL, 1);
  const cuerpo = (extra = {}) => Object.assign({ titulo: 'Entregar la rendición de cuentas', responsable_nombre: 'María Tesorera', responsable_cargo: 'Tesorera', responsable_celular: '300 123 4521',
    fecha_limite: R.sumarDias(HOY_REAL, 10), prioridad: 'normal', aviso_activo: true }, extra);

  /* ====================================================================================== 1. QUIÉN ENTRA */
  console.log('\n[1] Quién entra: candidato y superadministrador sí; todos los demás, 403 en todos los métodos');
  const base1 = await C.cand.post('/tareas-direccion', cuerpo());
  ok(base1.status === 201 && base1.datos.tarea && base1.datos.tarea.id > 0, 'el candidato (rol candidato) crea una tarea → 201', base1);
  const idBase = base1.datos.tarea.id;
  const permitidos = { 'superadministrador': C.super, 'candidato (rol)': C.cand, 'administrador «Es el candidato»': C.admCand, 'sesión «solo candidato» (orden 93)': C.soloCand };
  for (const [nombre, c] of Object.entries(permitidos)) {
    const g = await c.get('/tareas-direccion');
    const gi = await c.get('/tareas-direccion/' + idBase);
    const rs = await c.get('/tareas-direccion/resumen');
    const rp = await c.get('/tareas-direccion/responsables');
    const po = await c.post('/tareas-direccion', cuerpo({ titulo: 'Tarea de ' + nombre }));
    const pu = await c.put('/tareas-direccion/' + po.datos.tarea.id, { prioridad: 'urgente' });
    const pa = await c.patch('/tareas-direccion/' + po.datos.tarea.id + '/estado', { estado: 'en_curso' });
    const wa = await c.post('/tareas-direccion/' + po.datos.tarea.id + '/whatsapp');
    const de = await c.del('/tareas-direccion/' + po.datos.tarea.id);
    ok([g.status, gi.status, rs.status, rp.status].every((s) => s === 200) && po.status === 201 && pu.status === 200 && pa.status === 200 && wa.status === 200 && de.status === 200,
      `${nombre}: GET, GET/:id, resumen, responsables, POST, PUT, PATCH, whatsapp y DELETE responden bien`, { g: g.status, gi: gi.status, rs: rs.status, rp: rp.status, po: po.status, pu: pu.status, pa: pa.status, wa: wa.status, de: de.status });
  }
  const denegados = { 'administrador SIN la casilla': C.admSin, 'coordinador': C.coord, 'líder': C.lider, 'sublíder': C.sub, 'testigo': C.testigo, 'asistente administrativo': C.asist };
  for (const [nombre, c] of Object.entries(denegados)) {
    const r = [
      await c.get('/tareas-direccion'), await c.get('/tareas-direccion/' + idBase), await c.get('/tareas-direccion/resumen'), await c.get('/tareas-direccion/responsables'),
      await c.post('/tareas-direccion', cuerpo()), await c.put('/tareas-direccion/' + idBase, { prioridad: 'urgente' }),
      await c.patch('/tareas-direccion/' + idBase + '/estado', { estado: 'hecha' }), await c.post('/tareas-direccion/' + idBase + '/whatsapp'), await c.del('/tareas-direccion/' + idBase),
    ];
    ok(r.every((x) => x.status === 403), `${nombre}: 403 en GET, GET/:id, resumen, responsables, POST, PUT, PATCH, whatsapp y DELETE`, r.map((x) => x.status));
  }
  ok((await C.anon.get('/tareas-direccion')).status === 401, 'sin sesión → 401');
  ok((await C.cand.get('/tareas-direccion/' + idBase)).datos.tarea.titulo === 'Entregar la rendición de cuentas', 'la tarea sigue intacta tras los intentos denegados');
  // El rol candidato sigue de SOLO LECTURA en todo lo demás.
  const otros = [await C.cand.post('/votantes', { nombre: 'x' }), await C.cand.put('/territorial/estructura/1', {}), await C.cand.del('/votantes/1'),
    await C.cand.patch('/tareas/1', {}), await C.cand.post('/tareas', {}), await C.cand.get('/usuarios/admin'), await C.cand.get('/finanzas'), await C.cand.get('/votantes'),
    await C.cand.post('/tareas-direccion-falsa', {}), await C.cand.patch('/votantes/1', {})];
  ok(otros.every((x) => x.status === 403), 'el candidato sigue con 403 en todo lo demás (votantes, estructura, tareas de campo, finanzas, usuarios) y en una ruta parecida como /tareas-direccion-falsa (el prefijo exige «/»)', otros.map((x) => x.status));

  console.log('\n[1b] No va en la matriz de permisos ni se asoma en otros módulos');
  const lectura = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
  const rolCand = require('../config/rolCandidato');
  ok(!/tareas_direccion|tareas-direccion/.test(lectura('routes/permisos.routes.js')) && ![].concat(rolCand.MODULOS_VER_CANDIDATO, rolCand.MODULOS_SOLO_APP).some((m) => /direccion/.test(m)), 'no va en «Asignación de permisos» ni entre los módulos del candidato: el acceso es fijo para esos dos');
  const usan = []; for (const d of ['routes', 'lib', 'config', 'middleware']) for (const f of fs.readdirSync(path.join(RAIZ, d))) if (f.endsWith('.js') && /tareas_direccion|tareasDireccion/.test(lectura(d + '/' + f))) usan.push(d + '/' + f);
  const esperados = ['config/rolCandidato.js', 'lib/tareasDireccion.js', 'routes/auth.routes.js', 'routes/tareasDireccion.routes.js'].sort();   // (lib/alcanceCampanas.js solo esconde el aviso del CRM; no nombra las tablas.) routes/auth.routes.js (orden 118) solo le pregunta a puedeEntrar() si el menú lleva el ítem: no toca las tablas.
  ok(JSON.stringify(usan.sort()) === JSON.stringify(esperados), 'ningún otro módulo (exportaciones, dashboards, búsquedas, panel general) toca las tablas', usan);
  const rp = (await C.cand.get('/tareas-direccion/responsables')).datos;
  ok(![].concat(rp.candidato, rp.personas).some((x) => x.usuario_id === ids.super), 'el superadministrador NO aparece entre los responsables posibles');
  ok(rp.candidato.length >= 1 && rp.candidato.every((c) => c.es_candidato) && rp.personas.some((p) => p.nombre === 'María Tesorera' && p.celular === '3001112233' && p.cargo === 'Asistente administrativo'),
    'responsables: el candidato aparte; las personas con su rol como cargo sugerido y el celular a 10 dígitos', rp.personas.slice(0, 3));

  /* ====================================================================================== 2. CRUD */
  console.log('\n[2] Crear, validar, editar, mover, marcar realizada, deshacer, reabrir, eliminar');
  const malos = [
    [cuerpo({ titulo: '' }), 'sin título'], [cuerpo({ responsable_nombre: '' }), 'sin nombre del responsable'], [cuerpo({ responsable_cargo: '' }), 'sin cargo'],
    [cuerpo({ responsable_celular: '12345' }), 'celular inválido'], [cuerpo({ fecha_limite: '2026-13-45' }), 'fecha inválida'], [cuerpo({ fecha_limite: undefined }), 'sin fecha'],
    [cuerpo({ prioridad: 'mega' }), 'prioridad inválida'],
  ];
  for (const [b, que] of malos) { const r = await C.cand.post('/tareas-direccion', b); ok(r.status === 400 && r.datos.error, `crear ${que} → 400 con mensaje`, r); }
  const ta = (await C.cand.post('/tareas-direccion', cuerpo({ titulo: 'Pagar la sede', responsable_celular: '', fecha_limite: R.sumarDias(HOY_REAL, 20) }))).datos.tarea;
  ok(ta.aviso_estado === 'sin_celular' && ta.canal_previsto === null, 'sin celular: el aviso queda «sin_celular»', ta);
  const tb = (await C.cand.post('/tareas-direccion', cuerpo({ titulo: 'Contratar la pauta', fecha_limite: R.sumarDias(HOY_REAL, 15), prioridad: 'urgente' }))).datos.tarea;
  ok(tb.aviso_estado === 'programado' && tb.aviso_para === R.sumarDias(HOY_REAL, 12) && tb.canal_previsto === 'sms' && tb.responsable.celular === '3001234521' && tb.prioridad === 'urgente',
    'con celular: aviso «programado» 3 días antes (el celular se guarda a 10 dígitos)', tb);
  const ed = await C.cand.put('/tareas-direccion/' + ta.id, { responsable_celular: '311 222 3344' });
  ok(ed.status === 200 && ed.datos.tarea.aviso_estado === 'programado' && ed.datos.tarea.aviso_para === R.sumarDias(HOY_REAL, 17), 'poner el celular a una tarea sin él la programa', ed.datos.tarea);
  const sin = await C.cand.put('/tareas-direccion/' + ta.id, { responsable_celular: '311 222 3344' });
  ok(sin.status === 200 && sin.datos.sinCambios === true, 'guardar sin cambiar nada no escribe (ni ensucia el historial)');
  ok((await C.cand.put('/tareas-direccion/' + ta.id, { titulo: '' })).status === 400, 'editar con el título vacío → 400');
  ok((await C.cand.put('/tareas-direccion/999999', { titulo: 'x' })).status === 404 && (await C.cand.get('/tareas-direccion/999999')).status === 404 && (await C.cand.get('/tareas-direccion/abc')).status === 404, 'una tarea que no existe → 404');

  const enc = (await C.cand.patch('/tareas-direccion/' + tb.id + '/estado', { estado: 'en_curso' })).datos;
  ok(enc.tarea.estado === 'en_curso' && enc.estado_anterior === 'pendiente', 'mover a «En curso»', enc);
  ok((await C.cand.patch('/tareas-direccion/' + tb.id + '/estado', { estado: 'volando' })).status === 400, 'un estado inventado → 400');
  const pend = (await C.cand.patch('/tareas-direccion/' + tb.id + '/estado', { estado: 'pendiente' })).datos;
  ok(pend.tarea.estado === 'pendiente', 'y de vuelta a «Pendientes»');

  // Marcar como realizada ANTES de tiempo
  const hecha = (await C.cand.patch('/tareas-direccion/' + tb.id + '/estado', { estado: 'hecha' })).datos;
  ok(hecha.tarea.estado === 'hecha' && hecha.tarea.realizada_en && hecha.tarea.aviso_estado === 'cancelado' && hecha.estado_anterior === 'pendiente', 'realizada antes de tiempo: estado «hecha», realizada_en = ahora y el aviso programado se CANCELA', hecha.tarea);
  ok(R.textoHecha(hecha.tarea.fecha_limite, hecha.tarea.realizada_en) === `Hecha el ${R.formatoCorto(HOY_REAL)} · 15 días antes`, 'la tarjeta dice «Hecha el … · 15 días antes»', R.textoHecha(hecha.tarea.fecha_limite, hecha.tarea.realizada_en));
  let det = (await C.cand.get('/tareas-direccion/' + tb.id)).datos;
  ok(det.eventos.map((e) => e.tipo).join() === 'creada,en_curso,editada,realizada,aviso_cancelado', 'el historial anota creada, en curso, vuelta a pendiente, realizada y aviso cancelado', det.eventos.map((e) => e.tipo));
  ok((await C.cand.patch('/tareas-direccion/' + tb.id + '/estado', { estado: 'hecha' })).datos.sinCambios === true, 'marcar dos veces no duplica nada');
  const deshecha = (await C.cand.patch('/tareas-direccion/' + tb.id + '/estado', { estado: 'pendiente', deshacer: true })).datos;
  ok(deshecha.tarea.estado === 'pendiente' && deshecha.tarea.realizada_en === null && deshecha.tarea.aviso_estado === 'programado' && deshecha.tarea.aviso_para === R.sumarDias(HOY_REAL, 12),
    'deshacer: vuelve a su estado, borra realizada_en y RE-PROGRAMA el aviso (todavía aplica)', deshecha.tarea);
  await C.cand.patch('/tareas-direccion/' + tb.id + '/estado', { estado: 'hecha' });
  const reab = (await C.cand.patch('/tareas-direccion/' + tb.id + '/estado', { estado: 'en_curso' })).datos;
  ok(reab.tarea.estado === 'en_curso' && reab.tarea.aviso_estado === 'programado', 'reabrir una hecha (a «En curso») re-programa el aviso mientras su fecha no haya pasado', reab.tarea);
  // Reabrir cuando la fecha del aviso YA pasó
  const antes = en(R.sumarDias(HOY_REAL, -30), 10);
  const tc = (await T.crear(cuerpo({ titulo: 'Tarea vieja', fecha_limite: R.sumarDias(HOY_REAL, -20) }), ids.cand, { ahora: antes })).tarea;
  const tcHecha = await T.cambiarEstado(tc.id, 'hecha', ids.cand, { ahora: en(R.sumarDias(HOY_REAL, -28), 10) });
  const tcReab = await T.cambiarEstado(tc.id, 'pendiente', ids.cand, { ahora: en(R.sumarDias(HOY_REAL, -1), 10) });
  ok(tcHecha.tarea.aviso_estado === 'cancelado' && tcReab.tarea.aviso_estado === 'no_aplica', 'reabrir cuando la fecha del aviso ya pasó NO lo re-programa (queda «no aplica»)', tcReab.tarea);

  // Prioridad, edición de campos y borrado
  const up = await C.cand.put('/tareas-direccion/' + tb.id, { titulo: 'Contratar la pauta de radio', prioridad: 'normal', fecha_limite: R.sumarDias(HOY_REAL, 6) });
  ok(up.status === 200 && up.datos.tarea.titulo === 'Contratar la pauta de radio' && up.datos.tarea.prioridad === 'normal' && up.datos.tarea.aviso_para === R.sumarDias(HOY_REAL, 3), 'editar título, prioridad y fecha límite: el aviso se recalcula', up.datos.tarea);
  const del = await C.cand.del('/tareas-direccion/' + ta.id);
  ok(del.status === 200 && (await C.cand.get('/tareas-direccion/' + ta.id)).status === 404, 'eliminar → 200 y la tarea ya no existe');
  ok((await q('SELECT COUNT(*) AS n FROM tareas_direccion_eventos WHERE tarea_id = ?', [ta.id]))[0].n === 0, 'el historial se va con ella');
  const aud = await q("SELECT detalle FROM auditoria WHERE accion = 'tarea_direccion_eliminar'");
  ok(aud.length >= 1 && aud.every((a) => !/Pagar la sede/.test(a.detalle)), 'la auditoría anota el borrado SIN el título (la tarea es privada)');

  // El tablero: columnas, orden, hechas de los últimos 30 días
  await q('DELETE FROM tareas_direccion');
  const mk = async (titulo, dias, extra = {}) => (await T.crear(cuerpo(Object.assign({ titulo, fecha_limite: R.sumarDias(HOY_REAL, dias) }, extra)), ids.cand)).tarea;
  const lejana = await mk('Lejana', 30); const vencida = await mk('Vencida', -3); const proxima = await mk('Próxima', 2); const hoyT = await mk('De hoy', 0);
  const h1 = await mk('Hecha reciente', 5); await T.cambiarEstado(h1.id, 'hecha', ids.cand);
  const h2 = await mk('Hecha vieja', 5); await T.cambiarEstado(h2.id, 'hecha', ids.cand, { ahora: en(R.sumarDias(HOY_REAL, -40), 10) });
  const tab = (await C.cand.get('/tareas-direccion')).datos;
  const pen = tab.tareas.filter((t) => t.estado === 'pendiente').map((t) => t.titulo);
  ok(pen.join() === 'Vencida,De hoy,Próxima,Lejana', 'pendientes por fecha límite: lo vencido arriba', pen);
  ok(tab.tareas.filter((t) => t.estado === 'hecha').map((t) => t.titulo).join() === 'Hecha reciente' && tab.hechas_total === 2 && tab.hechas_mostradas === 1, 'hechas: solo las de los últimos 30 días, y el total de todas', { t: tab.hechas_total, m: tab.hechas_mostradas });
  const todas = (await C.cand.get('/tareas-direccion?hechas=todas')).datos;
  ok(todas.tareas.filter((t) => t.estado === 'hecha').map((t) => t.titulo).join() === 'Hecha reciente,Hecha vieja', '«Ver todas las hechas»: las más recientes arriba', todas.tareas.filter((t) => t.estado === 'hecha').map((t) => t.titulo));
  const rs = (await C.cand.get('/tareas-direccion/resumen')).datos;
  ok(rs.vencidas === 1 && rs.vencen_en_3_dias === 2, 'resumen: 1 vencida y 2 que vencen en 3 días (hoy y pasado mañana)', rs);
  ok(tab.tareas.find((t) => t.titulo === 'Vencida').estado_fecha === 'vencida' && tab.tareas.find((t) => t.titulo === 'De hoy').estado_fecha === 'hoy' && tab.tareas.find((t) => t.titulo === 'Lejana').estado_fecha === 'a_tiempo', 'estado de la fecha: vencida / hoy / a tiempo');

  /* ====================================================================================== 3. EL AVISO AUTOMÁTICO */
  console.log('\n[3] El aviso automático 3 días antes (reloj inyectable, proveedor simulado)');
  await q('DELETE FROM tareas_direccion'); await q("DELETE FROM comunicaciones_campanas WHERE nombre LIKE 'Tarea de dirección%'");
  const FIRMA = ' - Equipo de la Campana Ejemplo SAS (aviso)';
  const salidas = []; let modo = 'ok';
  T.deps.firma = async () => FIRMA;
  T.deps.enviarSms = async (celular, texto, o) => {
    if (modo === 'falla') throw new Error('Proveedor rechazó el mensaje');
    if (modo === 'franja') { const e = new Error('Fuera del horario'); e.codigo = 'FUERA_DE_FRANJA'; throw e; }
    salidas.push({ celular, texto, tareaId: o.tareaId }); return 'sid-' + salidas.length;
  };
  const D = '2027-03-10';                                   // el «día D» de esta prueba (un miércoles lejano, sin relación con hoy)
  const dia = (n) => R.sumarDias(D, n);
  const reset = () => { salidas.length = 0; modo = 'ok'; T.reiniciarMemoria(); };
  const fila = async (id) => (await q('SELECT * FROM tareas_direccion WHERE id = ?', [id]))[0];
  const eventosDe = async (id) => (await q('SELECT tipo, detalle FROM tareas_direccion_eventos WHERE tarea_id = ? ORDER BY id', [id])).map((e) => e.tipo);
  const nueva = async (extra, cuando) => (await T.crear(cuerpo(extra), ids.cand, { ahora: cuando })).tarea;

  // A. a 3 días → 1 SMS; la segunda corrida → 0
  reset();
  const A = await nueva({ titulo: 'Entregar la rendición de cuentas al CNE', responsable_nombre: 'María Tesorera', responsable_celular: '300 123 4521', fecha_limite: dia(3) }, en(dia(-5), 10));
  ok(A.aviso_para === D && A.aviso_estado === 'programado', 'tarea creada 5 días antes con vencimiento a 3 días del día D: aviso para el día D', A);
  let v = await T.vueltaAvisos({ ahora: en(dia(-1), 8) });
  ok(v.enviados === 0 && salidas.length === 0, 'el día anterior no sale nada');
  v = await T.vueltaAvisos({ ahora: en(D, 8) });
  ok(v.enviados === 1 && salidas.length === 1 && salidas[0].celular === '3001234521', 'el día D a las 08:00 sale 1 SMS al celular del responsable', { v, salidas });
  ok(/^Hola María, recuerda tu tarea: Entregar la rendicion de cuentas al CNE\. Vence el 13 mar\.$/.test(salidas[0].texto.replace('María', 'María')) || salidas[0].texto === 'Hola Maria, recuerda tu tarea: Entregar la rendicion de cuentas al CNE. Vence el 13 mar.',
    'el texto: «Hola {nombre}, recuerda tu tarea: {título}. Vence el {d mmm}.» sin tildes ni eñe', salidas[0].texto);
  let fa = await fila(A.id);
  ok(fa.aviso_estado === 'enviado' && fa.aviso_canal === 'sms' && fa.aviso_enviado_en, 'la fila queda «enviado», canal sms, con su hora', fa);
  v = await T.vueltaAvisos({ ahora: en(D, 9) });
  ok(v.enviados === 0 && salidas.length === 1, 'la segunda corrida → 0 (una sola vez por tarea)');
  ok((await eventosDe(A.id)).join() === 'creada,aviso_enviado', 'el historial anota el aviso enviado', await eventosDe(A.id));

  // A2. dos procesos a la vez no mandan doble
  reset();
  const dobles = []; for (let i = 0; i < 3; i++) dobles.push(await nueva({ titulo: 'Doble ' + i, fecha_limite: dia(3) }, en(dia(-5), 10)));
  const [va, vb] = await Promise.all([T.vueltaAvisos({ ahora: en(D, 8) }), T.vueltaAvisos({ ahora: en(D, 8) })]);
  ok(salidas.length === 3 && va.enviados + vb.enviados === 3, 'dos vueltas simultáneas (dos procesos): 3 tareas → 3 SMS, ninguno doble', { n: salidas.length, va, vb });

  // B. realizada antes → 0 y cancelado
  reset();
  const B = await nueva({ titulo: 'Se hizo antes', fecha_limite: dia(3) }, en(dia(-5), 10));
  await T.cambiarEstado(B.id, 'hecha', ids.cand, { ahora: en(dia(-1), 15) });
  await T.vueltaAvisos({ ahora: en(D, 8) });
  ok(salidas.length === 0 && (await fila(B.id)).aviso_estado === 'cancelado', 'realizada antes de tiempo: no sale nada y el aviso queda «cancelado»');

  // C. sin celular
  reset();
  const Cs = await nueva({ titulo: 'Sin celular', responsable_celular: '', fecha_limite: dia(3) }, en(dia(-5), 10));
  await T.vueltaAvisos({ ahora: en(D, 8) });
  ok(salidas.length === 0 && (await fila(Cs.id)).aviso_estado === 'sin_celular', 'sin celular: no sale nada y queda «sin_celular»');

  // D. el candidato como responsable → aviso en la app («Mis avisos»)
  reset();
  const Dd = await nueva({ titulo: 'Grabar el video de cierre', responsable_usuario_id: ids.cand, responsable_nombre: 'Juan Pérez Candidato', responsable_cargo: 'Candidato', responsable_celular: '', fecha_limite: dia(3) }, en(dia(-5), 10));
  ok(Dd.canal_previsto === 'app' && Dd.aviso_estado === 'programado', 'el candidato como responsable: canal previsto «app» aunque no tenga celular en la tarea', Dd);
  v = await T.vueltaAvisos({ ahora: en(D, 8) });
  const fd = await fila(Dd.id);
  ok(salidas.length === 0 && fd.aviso_estado === 'enviado' && fd.aviso_canal === 'app', 'sale como aviso en la app (no como SMS)', { fd, salidas });
  const mis = (await C.cand.get('/push/mis-avisos')).datos;
  ok(mis.avisos && mis.avisos.some((a) => /Grabar el video de cierre/.test(a.mensaje) && /Vence el 13 mar/.test(a.mensaje)), 'el candidato lo lee en «Mis avisos»', mis);
  ok(!((await C.coord.get('/push/mis-avisos')).datos.avisos || []).some((a) => /Grabar el video/.test(a.mensaje)), 'ninguna otra persona lo ve en SUS avisos');
  const crm = (await C.admSin.get('/comunicaciones/campanas')).datos;
  ok(Array.isArray(crm) && !JSON.stringify(crm).includes('Tarea de dirección') && !JSON.stringify(crm).includes('Grabar el video'), 'el historial del CRM del administrador NO muestra el aviso (la tarea es privada)', Array.isArray(crm) ? crm.length : crm);
  const idCamp = (await q("SELECT id FROM comunicaciones_campanas WHERE nombre LIKE 'Tarea de dirección%' ORDER BY id DESC LIMIT 1"))[0].id;
  const detCrm = await C.admSin.get('/comunicaciones/campanas/' + idCamp + '/envios');
  ok([403, 404].includes(detCrm.status) || !JSON.stringify(detCrm.datos).includes('Grabar el video'), 'ni por el id de la campaña se alcanza el detalle desde el CRM', detCrm.status);

  // E. creada a 1 día → sale al día siguiente a las 8:00
  reset();
  const E = await nueva({ titulo: 'Para mañana', fecha_limite: dia(1) }, en(D, 10));
  ok(E.aviso_para === dia(1), 'creada a 1 día del vencimiento: el aviso se programa para el día siguiente', E);
  await T.vueltaAvisos({ ahora: en(D, 12) });
  ok(salidas.length === 0, 'el mismo día no sale');
  await T.vueltaAvisos({ ahora: en(dia(1), 8) });
  ok(salidas.length === 1 && salidas[0].texto.includes('Para manana') && salidas[0].texto.includes('Vence el 11 mar'), 'al día siguiente a las 08:00 sale', salidas);

  // F. cambio de fecha
  reset();
  const F = await nueva({ titulo: 'Cambia de fecha', fecha_limite: dia(3) }, en(dia(-5), 10));
  await T.vueltaAvisos({ ahora: en(D, 8) });
  ok(salidas.length === 1 && (await fila(F.id)).aviso_estado === 'enviado', 'primero sale el aviso de la fecha original');
  const mov = await T.editar(F.id, { fecha_limite: dia(10) }, ids.cand, { ahora: en(D, 9) });
  ok(mov.tarea.aviso_estado === 'programado' && mov.tarea.aviso_para === dia(7) && (await fila(F.id)).aviso_enviado_en === null, 'mover la fecha más adelante: vuelve a «programado» para la nueva fecha (un aviso por cada fecha límite)', mov.tarea);
  await T.vueltaAvisos({ ahora: en(dia(6), 8) }); ok(salidas.length === 1, 'antes de la nueva fecha no sale');
  await T.vueltaAvisos({ ahora: en(dia(7), 8) }); ok(salidas.length === 2 && salidas[1].texto.includes('Vence el 20 mar'), 'en la nueva fecha sale el segundo aviso', salidas.map((s) => s.texto));
  const adelanta = await T.editar(F.id, { fecha_limite: dia(8) }, ids.cand, { ahora: en(dia(7), 9) });
  ok(adelanta.tarea.aviso_estado === 'enviado', 'adelantar la fecha de una tarea ya avisada NO reabre el aviso', adelanta.tarea.aviso_estado);
  const G = await nueva({ titulo: 'Programada que se mueve', fecha_limite: dia(20) }, en(D, 10));
  const g2 = await T.editar(G.id, { fecha_limite: dia(30) }, ids.cand, { ahora: en(D, 11) });
  ok(G.aviso_para === dia(17) && g2.tarea.aviso_para === dia(27), 'cambiar la fecha de una programada recalcula su día', { antes: G.aviso_para, despues: g2.tarea.aviso_para });
  const g3 = await T.editar(G.id, { responsable_celular: '' }, ids.cand, { ahora: en(D, 11) });
  ok(g3.tarea.aviso_estado === 'sin_celular', 'quitar el celular antes de que salga: queda «sin_celular»');
  const g4 = await T.editar(G.id, { responsable_celular: '320 555 6677' }, ids.cand, { ahora: en(D, 11) });
  ok(g4.tarea.aviso_estado === 'programado' && g4.tarea.canal_previsto === 'sms', 'corregir el celular: se recalcula y vuelve a «programado»');

  // H. interruptor
  const Hh = await nueva({ titulo: 'Con interruptor', fecha_limite: dia(20) }, en(D, 10));
  const h0 = await T.editar(Hh.id, { aviso_activo: false }, ids.cand, { ahora: en(D, 11) });
  ok(h0.tarea.aviso_estado === 'cancelado' && h0.tarea.aviso_activo === false && (await eventosDe(Hh.id)).includes('aviso_cancelado'), 'apagar el interruptor: «cancelado» y queda en el historial');
  reset(); await T.vueltaAvisos({ ahora: en(dia(17), 8) }); ok(salidas.length === 0, 'una tarea con el aviso apagado no sale');
  const h1b = await T.editar(Hh.id, { aviso_activo: true }, ids.cand, { ahora: en(D, 12) });
  ok(h1b.tarea.aviso_estado === 'programado' && h1b.tarea.aviso_para === dia(17), 'encenderlo de nuevo: «programado» si todavía aplica', h1b.tarea);

  // I. falla del proveedor: no reintenta sola
  reset(); modo = 'falla';
  const I = await nueva({ titulo: 'El proveedor falla', fecha_limite: dia(3) }, en(dia(-5), 10));
  v = await T.vueltaAvisos({ ahora: en(D, 8) });
  const fi = await fila(I.id);
  ok(v.fallidos === 1 && fi.aviso_estado === 'fallido' && (await eventosDe(I.id)).includes('aviso_fallido'), 'error del proveedor: «fallido» y evento con el motivo', { v, fi: fi.aviso_estado });
  modo = 'ok'; v = await T.vueltaAvisos({ ahora: en(D, 9) });
  ok(salidas.length === 0 && v.revisadas === 0, 'y NO se reintenta sola');
  const motivo = (await q("SELECT detalle FROM tareas_direccion_eventos WHERE tarea_id = ? AND tipo = 'aviso_fallido'", [I.id]))[0].detalle;
  ok(/rechaz/i.test(motivo), 'el evento lleva el error del proveedor', motivo);

  // J. fuera de la franja del proveedor: se aplaza sin gastar el aviso
  reset(); modo = 'franja';
  const J = await nueva({ titulo: 'Fuera de franja', fecha_limite: dia(3) }, en(dia(-5), 10));
  let d1 = await T.vueltaDiaria({ ahora: en(D, 8, 5) });
  ok(d1.corrio && d1.resultado.diferidos === 1 && (await fila(J.id)).aviso_estado === 'programado', 'SMS fuera de franja: queda «programado» (no se gasta ni falla)', d1);
  modo = 'ok';
  d1 = await T.vueltaDiaria({ ahora: en(D, 8, 20) });
  ok(d1.corrio && salidas.length === 1, 'y la revisión siguiente lo manda (el día no se dio por hecho)', { d1, n: salidas.length });

  // K. el reloj diario
  reset();
  const K = await nueva({ titulo: 'Reloj diario', fecha_limite: dia(3) }, en(dia(-5), 10));
  let k = await T.vueltaDiaria({ ahora: en(D, 7, 59) });
  ok(!k.corrio && salidas.length === 0, 'a las 07:59 todavía no corre');
  k = await T.vueltaDiaria({ ahora: en(D, 8, 0) });
  ok(k.corrio && salidas.length === 1, 'a las 08:00 corre y manda');
  k = await T.vueltaDiaria({ ahora: en(D, 8, 10) }); ok(!k.corrio && k.motivo === 'ya corrió hoy', 'el mismo día no vuelve a correr');
  reset();
  const K2 = await nueva({ titulo: 'Reinicio tardío', fecha_limite: dia(3) }, en(dia(-5), 10));
  k = await T.vueltaDiaria({ ahora: en(D, 14, 30) });
  ok(k.corrio && salidas.length === 1 && salidas[0].texto.includes('Reinicio tardio'), 'si el servidor arranca después de las 08:00, envía lo de hoy al arrancar', salidas);
  // Caducadas
  reset();
  const L = await nueva({ titulo: 'Se le pasó', fecha_limite: dia(20) }, en(D, 10));
  await q("UPDATE tareas_direccion SET fecha_limite = ? WHERE id = ?", [dia(-2), L.id]);
  v = await T.vueltaAvisos({ ahora: en(D, 8) });
  ok(salidas.length === 0 && v.caducadas >= 1 && (await fila(L.id)).aviso_estado === 'no_aplica', 'una programada cuyo vencimiento ya pasó sin salir queda «no aplica»');

  /* ====================================================================================== 4. EL SMS */
  console.log('\n[4] El SMS: 1 solo segmento contando la firma, sin tildes ni eñe');
  const firmas = ['', ' - Estrategia', FIRMA, ' - Campana Juan Perez Alcaldia 2027 Medellin SAS Aviso', ' ' + 'F'.repeat(70)];
  const titulos = ['Reunión', 'Entregar la rendición de cuentas “Cuentas Claras” al CNE — urgente', 'Ñandú: pagar a la señora Núñez la nómina de diciembre de todo el equipo de comunicaciones y logística del municipio',
    'x'.repeat(200), 'Revisar {nombre} y [corchetes] ^ ~ | \\ € con símbolos raros 🙂🙂🙂', 'Con salto\nde línea y   espacios   dobles'];
  let todosUno = true; let sinTildes = true; const lecturas = [];
  for (const f of firmas) for (const t of titulos) {
    const s = T.armarSms({ nombre: 'Ana María Núñez', titulo: t, fechaLimite: '2027-03-13', firma: f });
    const seg = s ? analizarTexto(s, f).segmentos : null;
    if (!s || seg !== 1) { todosUno = false; lecturas.push({ f: f.length, t: t.slice(0, 20), s, seg }); }
    if (s && /[^\x20-\x7E]/.test(s)) { sinTildes = false; lecturas.push({ raro: s }); }
  }
  ok(todosUno, `${firmas.length} firmas × ${titulos.length} títulos: SIEMPRE 1 segmento (con la firma más larga de prueba: ${Math.max(...firmas.map((f) => f.length))} caracteres)`, lecturas.slice(0, 3));
  ok(sinTildes, 'ningún SMS lleva un carácter fuera de ASCII (tildes, eñe, comillas rizadas, emojis)');
  const largo = T.armarSms({ nombre: 'Ana', titulo: 'x'.repeat(200), fechaLimite: '2027-03-13', firma: FIRMA });
  ok(/\.\.\. Vence el 13 mar\.$/.test(largo) && largo.length < 160, 'un título que no cabe se recorta con «...» y conserva «Vence el …»', largo);
  ok(!/alcald|concej|senad|gobern|aspir/i.test(T.armarSms({ nombre: 'Ana', titulo: 'Reunión', fechaLimite: '2027-03-13', firma: '' })), 'el texto nunca menciona el cargo al que aspira el candidato (precampaña)');

  /* ====================================================================================== 5. WHATSAPP */
  console.log('\n[5] WhatsApp: la URL y el historial');
  const W = (await C.cand.post('/tareas-direccion', cuerpo({ titulo: 'Confirmar el sonido', responsable_nombre: 'Ana María Gómez', responsable_celular: '+57 300 123 4567', fecha_limite: '2027-03-29' }))).datos.tarea;
  const wa = await C.cand.post('/tareas-direccion/' + W.id + '/whatsapp');
  const esperada = 'https://wa.me/573001234567?text=' + encodeURIComponent('Hola Ana 👋, te recuerdo esta tarea de la campaña: Confirmar el sonido. Fecha límite: 29 mar. ¡Gracias!');
  ok(wa.status === 200 && wa.datos.url === esperada, 'la URL es wa.me/57 + 10 dígitos con el texto codificado', wa.datos);
  ok(R.urlWhatsapp('3001234567', 'Ana María Gómez', 'Confirmar el sonido', '2027-03-29') === esperada, 'la misma URL sale del archivo compartido con las pantallas');
  ok((await eventosDe(W.id)).includes('whatsapp'), 'el evento «whatsapp» queda en el historial');
  const sinCel = (await C.cand.post('/tareas-direccion', cuerpo({ responsable_celular: '' }))).datos.tarea;
  ok((await C.cand.post('/tareas-direccion/' + sinCel.id + '/whatsapp')).status === 400, 'sin celular válido no hay WhatsApp (400)');
  ok(R.normalizarCelular('+57 (300) 123-4567') === '3001234567' && R.normalizarCelular('0057 300 123 4567') === '3001234567' && R.normalizarCelular('573001234567') === '3001234567' && R.normalizarCelular('2001234567') === null && R.normalizarCelular('30012345') === null,
    'normalizarCelular: 10 dígitos colombianos (con o sin prefijo 57), nada más');

  /* ====================================================================================== 6. TEXTOS DE LAS PANTALLAS */
  console.log('\n[6] Las frases de la tarjeta y del formulario');
  const t0 = { estado: 'pendiente', fecha_limite: '2026-11-29', aviso_activo: 1, aviso_estado: 'programado', aviso_para: '2026-11-26', canal_previsto: 'sms' };
  ok(R.lineaAviso(t0, '2026-11-24').texto === 'SMS programado 26 nov', 'SMS programado …');
  ok(R.lineaAviso(Object.assign({}, t0, { aviso_para: '2026-11-25' }), '2026-11-25').texto === 'SMS sale hoy 25 nov', 'SMS sale hoy …');
  ok(R.lineaAviso(Object.assign({}, t0, { aviso_estado: 'enviado', aviso_canal: 'sms', aviso_enviado_en: '2026-11-24 08:00:03' }), '2026-11-25').texto === 'SMS enviado 24 nov', 'SMS enviado …');
  ok(R.lineaAviso(Object.assign({}, t0, { canal_previsto: 'app', aviso_para: '2026-11-23' }), '2026-11-20').texto === 'Aviso en la app 23 nov', 'Aviso en la app …');
  ok(R.lineaAviso(Object.assign({}, t0, { aviso_estado: 'sin_celular' }), '2026-11-20').texto === 'Sin celular: no hay aviso', 'Sin celular: no hay aviso');
  ok(R.lineaAviso(Object.assign({}, t0, { aviso_activo: 0, aviso_estado: 'cancelado' }), '2026-11-20').texto === 'Aviso apagado', 'Aviso apagado');
  ok(R.lineaAviso(Object.assign({}, t0, { estado: 'hecha', realizada_en: '2026-11-24 10:00:00' }), '2026-11-25').texto === '✓ Hecha el 24 nov · 5 días antes', 'en Hechas: ✓ Hecha el 24 nov · 5 días antes', R.lineaAviso(Object.assign({}, t0, { estado: 'hecha', realizada_en: '2026-11-24 10:00:00' }), '2026-11-25'));
  ok(R.textoHecha('2026-11-29', '2026-11-29 10:00:00') === 'Hecha el 29 nov · el mismo día' && R.textoHecha('2026-11-29', '2026-12-01 10:00:00') === 'Hecha el 1 dic · 2 días tarde', '«el mismo día» y «2 días tarde»');
  ok(R.textoPlazo('2026-11-29', '2026-11-24') === 'faltan 5 días' && R.textoPlazo('2026-11-22', '2026-11-24') === 'venció hace 2 días' && R.textoPlazo('2026-11-24', '2026-11-24') === 'vence hoy', 'faltan N días / venció hace N días');
  ok(R.frasePrevia({ activo: true, fechaLimite: '2026-11-27', celular: '300 123 4521', hoy: '2026-11-20', minutos: 600 }) === 'SMS al 300 *** 4521 el 24 nov, si no está realizada.', 'formulario: «SMS al 300 *** 4521 el 24 nov, si no está realizada.»');
  ok(/^Le llega en la app el 24 nov/.test(R.frasePrevia({ activo: true, fechaLimite: '2026-11-27', celular: '', esCandidato: true, hoy: '2026-11-20', minutos: 600 })), 'formulario, responsable candidato: «Le llega en la app el …»');
  ok(R.avisoPara('2026-11-26', '2026-11-25', 600) === '2026-11-26' && R.avisoPara('2026-11-25', '2026-11-25', 600) === null && R.avisoPara('2026-11-28', '2026-11-25', 400) === '2026-11-25', 'avisoPara: mañana si «3 días antes» ya pasó; hoy si aún no son las 8; nada si vence hoy');

  /* ====================================================================================== 7. LA MIGRACIÓN ES REPETIBLE */
  console.log('\n[7] Las tablas');
  const cols = (await q("SELECT COLUMN_NAME c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'tareas_direccion'")).map((x) => x.c);
  ok(['titulo', 'responsable_usuario_id', 'responsable_nombre', 'responsable_cargo', 'responsable_celular', 'fecha_limite', 'prioridad', 'estado', 'aviso_activo', 'aviso_estado', 'aviso_canal', 'aviso_enviado_en', 'realizada_en', 'creada_por', 'creada_en', 'actualizada_en'].every((c) => cols.includes(c)), 'tareas_direccion trae todas las columnas del diseño', cols);
  const idx = (await q("SELECT DISTINCT INDEX_NAME n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'tareas_direccion'")).map((x) => x.n);
  ok(['idx_tareasdir_estado', 'idx_tareasdir_fecha', 'idx_tareasdir_aviso'].every((i) => idx.includes(i)), 'índices por estado, fecha límite y aviso_estado', idx);
  const ev = (await q("SHOW COLUMNS FROM tareas_direccion_eventos LIKE 'tipo'"))[0].Type;
  ok(['creada', 'editada', 'en_curso', 'realizada', 'reabierta', 'aviso_enviado', 'aviso_cancelado', 'aviso_fallido', 'whatsapp'].every((t) => ev.includes("'" + t + "'")), 'los nueve tipos de evento', ev);
  ok((await q("SHOW TABLES LIKE 'tareas'")).length === 1 && (await q('SELECT COUNT(*) AS n FROM tareas'))[0].n >= 0, 'las tablas de «Tareas» de campo siguen ahí, sin tocar');

  await q('DELETE FROM tareas_direccion'); await q("DELETE FROM comunicaciones_campanas WHERE nombre LIKE 'Tarea de dirección%'");
  await q("DELETE FROM usuarios WHERE numero_identificacion BETWEEN '7160001' AND '7160099' AND es_superadmin = 0");
  srv.close(); await pool.end();
  console.log(`\n${fallos ? 'FALLÓ' : 'TODO BIEN'}: ${pasos - fallos} de ${pasos} comprobaciones.`);
  process.exit(fallos ? 1 : 0);
})().catch(async (e) => { console.error('ERROR en la prueba:', e); try { await pool.end(); } catch (_) { /* nada */ } process.exit(1); });
