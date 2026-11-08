#!/usr/bin/env node
// scripts/probar-solicitudes-seguimiento.js
//
// Prueba de las SOLICITUDES CIUDADANAS, Fases 3, 4 y 5 (parche 304), del lado del servidor:
//   · la anonimización AUTOMÁTICA, una vez al día y dentro del proceso: no toca nada antes del plazo (elección en el futuro, plazo sin
//     cumplir, plazo más largo, sin fecha de elección), borra solo lo vencido, deja constancia en la auditoría, no repite en el día;
//   · el aviso push al responsable cuando se le asigna una solicitud (sin datos del ciudadano; sin avisar a quien no puede verla);
//   · la alerta «sin movimiento hace N días» por el motor de recordatorios: apagada de fábrica, N configurable, una vez por ocurrencia;
//   · el PANEL, el MAPA y la EXPORTACIÓN con ALCANCE: cada quien cuenta lo suyo, el mapa no lleva nada de personas, el diagnóstico no lleva
//     datos personales y el detalle es solo del administrador, con el teléfono enmascarado y la auditoría.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada304 node scripts/probar-solicitudes-seguimiento.js
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

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const XLSX = require('xlsx');
const pool = require('../config/db');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }
const uuid = () => crypto.randomUUID();
const raiz = path.join(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');

/* ------------------------------------------------------------------------------------------------------ el servidor */
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use((req, res, next) => {
  const u = req.headers['x-test-user'];
  req.session = { usuario: u ? JSON.parse(u) : undefined };
  req.sublicencia = req.headers['x-test-aspirante'] ? { usuario_id: Number(req.headers['x-test-aspirante']), cargo: 'concejo' } : null;
  next();
});
const { restringirAspirante } = require('../middleware/aspirante');
app.use('/api', restringirAspirante);
app.use('/api/solicitudes', require('../routes/solicitudes.routes'));
let base = '';
async function pedir(metodo, ruta, { json, usuario, form, aspirante } = {}) {
  const h = { 'X-Forwarded-For': '198.51.100.9', 'User-Agent': 'prueba/1.0' };
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  if (aspirante) h['X-Test-Aspirante'] = String(aspirante);
  const r = await fetch(base + '/api/solicitudes' + ruta, { method: metodo, headers: h, body });
  const ct = r.headers.get('content-type') || '';
  if (/spreadsheetml/.test(ct)) return { status: r.status, tipo: ct, disposicion: r.headers.get('content-disposition') || '', buffer: Buffer.from(await r.arrayBuffer()) };
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
  return { status: r.status, datos, texto };
}

let n = 0;
async function usuario(nombre, rol, extra = {}) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo, telefono) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), ?, ?)`,
    [nombre, `9400000${n}`, `u9400000${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol, extra.activo === 0 ? 0 : 1, extra.telefono || null]);
  return { id: r.insertId, rol, nombre };
}
async function estructura(u, cargo, supervisor) {
  await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, ?, 1)', [u.id, cargo, supervisor ? supervisor.id : null]);
}
async function permisos(rol, ver, editar, agregar, exportar = 0) {
  await pool.query(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar, importar_exportar) VALUES (?, 'solicitudes', ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE permitido = VALUES(permitido), editar = VALUES(editar), agregar = VALUES(agregar), importar_exportar = VALUES(importar_exportar)`, [rol, ver, editar, agregar, exportar]);
}
const formDe = (campos, fotos = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== null) f.append(k, String(v));
  fotos.forEach((b, i) => f.append('fotos', new Blob([b], { type: 'image/jpeg' }), `foto${i}.jpg`));
  return f;
};
const cat = {};
const base1 = (o = {}) => ({ cliente_uuid: uuid(), categoria_id: cat.vias, descripcion: 'Hay un hueco grande frente a la escuela del barrio.', barrio_texto: 'Barrio Los Ejemplos', ...o });
async function registrar(u, o = {}, fotos = []) {
  const r = await pedir('POST', '/', { usuario: u, form: formDe(base1(o), fotos) });
  if (r.status !== 201) throw new Error(`no se pudo registrar: ${r.status} ${r.texto}`);
  return r.datos.id;
}
const foto = () => sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 30, g: 120, b: 200 } } }).jpeg().toBuffer();
const libro = (r) => XLSX.read(r.buffer, { type: 'buffer' });
const filasDe = (wb, hoja) => XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, defval: '' });
const todoElTexto = (wb) => wb.SheetNames.map((h) => JSON.stringify(filasDe(wb, h))).join(' ');

(async () => {
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
  console.log('SOLICITUDES CIUDADANAS · FASES 3, 4 Y 5 — base «' + nombreBase + '»\n');

  const S = require('../lib/solicitudes');
  const Seg = require('../lib/solicitudesSeguimiento');
  const Mant = require('../lib/solicitudesMantenimiento');
  const R = require('../lib/recordatorios');
  const carpeta = S.DIR_FOTOS;
  for (const c of await q('SELECT id, clave FROM solicitud_categorias')) cat[c.clave] = c.id;

  /* ====================================================================================== la gente */
  const admin = { id: 1, rol: 'admin', nombre: 'Admin Prueba' };
  const c1 = await usuario('Coordinadora Uno', 'coordinador'), c2 = await usuario('Coordinador Dos', 'coordinador');
  const l1 = await usuario('Lider Uno', 'lider'), l2 = await usuario('Lider Dos', 'lider'), l3 = await usuario('Lider Tres', 'lider');
  const s1 = await usuario('Sublider Uno', 'sublider');
  const asp = await usuario('Aspirante Prueba', 'lider'), la = await usuario('Lider del Aspirante', 'lider');
  const testigo = await usuario('Testigo Prueba', 'testigo');
  await estructura(c1, 'coordinador', null); await estructura(c2, 'coordinador', null);
  await estructura(l1, 'lider', c1); await estructura(l2, 'lider', c1); await estructura(l3, 'lider', c2);
  await estructura(s1, 'usuario', l1);
  await estructura(asp, 'lider', c1); await estructura(la, 'lider', asp);
  await pool.query(`INSERT INTO sublicencias (usuario_id, cargo, nombre, activa) VALUES (?, 'concejo', 'Aspirante Prueba', 1)`, [asp.id]);
  await permisos('lider', 1, 0, 1); await permisos('sublider', 1, 0, 1); await permisos('testigo', 1, 0, 0);

  /* ====================================================================================== 1. migración */
  console.log('[1] Migración: los días sin movimiento, la regla de fábrica apagada y el permiso de exportar');
  const [[cfg0]] = await pool.query('SELECT solicitud_dias_sin_movimiento d, recordatorios_activos ra FROM configuracion_campana WHERE id = 1');
  ok(Number(cfg0.d) === 15, 'los días sin movimiento son 15 de fábrica', cfg0);
  const regla = (await q(`SELECT * FROM recordatorio_reglas WHERE tipo = 'solicitud_sin_movimiento'`));
  ok(regla.length === 1 && Number(regla[0].activo) === 0 && regla[0].canal === 'push', 'hay UNA regla de fábrica del tipo «solicitud sin movimiento», por aviso en la app y APAGADA', regla.map((r) => [r.nombre, r.activo, r.canal]));
  ok(Number(cfg0.ra) === 0, 'y el interruptor general de los recordatorios sigue apagado');
  const est = await R.estado();
  ok(est.tipos.some((t) => t.clave === 'solicitud_sin_movimiento' && t.conFuente), 'el motor conoce el tipo y tiene su fuente');
  const { moduloTieneImportarExportar } = require('../config/importarExportar');
  ok(moduloTieneImportarExportar('solicitudes'), '«solicitudes» tiene la casilla Importar / Exportar en la matriz');
  const cfgGet = await pedir('GET', '/config', { usuario: admin });
  ok(cfgGet.datos.dias_sin_movimiento === 15, 'la configuración devuelve los días sin movimiento', cfgGet.datos);
  ok((await pedir('PUT', '/config', { usuario: admin, json: { dias_sin_movimiento: 0 } })).status === 400
    && (await pedir('PUT', '/config', { usuario: admin, json: { dias_sin_movimiento: 400 } })).status === 400
    && (await pedir('PUT', '/config', { usuario: admin, json: { dias_sin_movimiento: 'x' } })).status === 400
    && (await pedir('PUT', '/config', { usuario: admin, json: {} })).status === 400, 'los días tienen que ser un entero de 1 a 365 (y algo hay que mandar)');
  ok((await pedir('PUT', '/config', { usuario: l1, json: { dias_sin_movimiento: 5 } })).status === 403, 'cambiar los días es solo del administrador');
  ok((await pedir('PUT', '/config', { usuario: admin, json: { dias_sin_movimiento: 20 } })).status === 200 && await Seg.diasSinMovimiento() === 20
    && (await q(`SELECT 1 FROM auditoria WHERE accion = 'solicitud_config' AND detalle LIKE '%15 → 20%'`)).length === 1, 'el administrador los cambia y queda en la auditoría');
  await pedir('PUT', '/config', { usuario: admin, json: { dias_sin_movimiento: 15 } });
  // Guardar solo los meses no toca los días, y al revés.
  await pedir('PUT', '/config', { usuario: admin, json: { anonimizar_meses: 6 } });
  ok(await Seg.diasSinMovimiento() === 15, 'guardar solo los meses no toca los días');

  /* ====================================================================================== 2. anonimización diaria */
  console.log('\n[2] Anonimización automática: una vuelta al día, dentro del proceso');
  await q('DELETE FROM solicitudes');
  const conDatos = await registrar(l1, { ciudadano_nombre: 'Marta Prueba', ciudadano_telefono: '3151112233', autoriza_datos: '1', descripcion: 'No hay agua desde hace una semana en la cuadra.' }, [await foto(), await foto()]);
  const archivos = (await q('SELECT archivo FROM solicitud_fotos WHERE solicitud_id = ?', [conDatos])).map((f) => f.archivo);
  const hayDatos = async () => (await q('SELECT ciudadano_nombre, ciudadano_telefono FROM solicitudes WHERE id = ?', [conDatos]))[0];
  const intacta = async () => {
    const d = await hayDatos();
    return d.ciudadano_nombre === 'Marta Prueba' && d.ciudadano_telefono === '3151112233'
      && (await q('SELECT COUNT(*) n FROM solicitud_fotos WHERE solicitud_id = ?', [conDatos]))[0].n === 2 && archivos.every((a) => fs.existsSync(path.join(carpeta, a)));
  };
  const audAuto = async () => q(`SELECT * FROM auditoria WHERE accion = 'solicitud_anonimizar_auto'`);
  ok(archivos.length === 2 && await intacta(), 'una solicitud con nombre, teléfono y 2 fotos');
  const vuelta = async () => Mant.vueltaDiaria({ forzar: true });

  await q('UPDATE configuracion_campana SET fecha_eleccion = NULL, anonimizar_solicitudes_meses = 6 WHERE id = 1');
  let v = await vuelta();
  ok(v.corrio && !v.resultado.aplicado && await intacta() && (await audAuto()).length === 0, 'SIN fecha de elección no toca nada ni escribe en la auditoría', v.motivo);
  await q('UPDATE configuracion_campana SET fecha_eleccion = DATE_ADD(CURDATE(), INTERVAL 20 DAY) WHERE id = 1');
  v = await vuelta();
  ok(!v.resultado.aplicado && await intacta() && (await audAuto()).length === 0, 'con la elección en el FUTURO no toca nada', v.motivo);
  await q('UPDATE configuracion_campana SET fecha_eleccion = DATE_SUB(CURDATE(), INTERVAL 5 MONTH) WHERE id = 1');
  v = await vuelta();
  ok(!v.resultado.aplicado && await intacta() && (await audAuto()).length === 0, 'a los 5 meses de la elección, con plazo de 6, NO toca nada', v.motivo);
  await q('UPDATE configuracion_campana SET fecha_eleccion = DATE_SUB(CURDATE(), INTERVAL 7 MONTH), anonimizar_solicitudes_meses = 12 WHERE id = 1');
  v = await vuelta();
  ok(!v.resultado.aplicado && await intacta() && (await audAuto()).length === 0, 'a los 7 meses, pero con el plazo CONFIGURADO en 12, tampoco: se respeta el plazo de la campaña', v.motivo);
  // Y una solicitud sin datos de ciudadano ni fotos no cuenta.
  const sinDatos = await registrar(l1, {});
  await q('UPDATE configuracion_campana SET anonimizar_solicitudes_meses = 6 WHERE id = 1');
  v = await vuelta();
  ok(v.resultado.aplicado && v.resultado.anonimizadas === 1 && v.resultado.fotos === 2, 'vencido el plazo (7 meses, plazo de 6): anonimiza UNA solicitud y 2 fotos (la que no tenía datos no cuenta)', v.resultado);
  const d = await hayDatos();
  ok(d.ciudadano_nombre === null && d.ciudadano_telefono === null && (await q('SELECT COUNT(*) n FROM solicitud_fotos WHERE solicitud_id = ?', [conDatos]))[0].n === 0
    && archivos.every((a) => !fs.existsSync(path.join(carpeta, a))), 'se borran nombre, teléfono, las filas de las fotos y los ARCHIVOS');
  const conserva = (await q('SELECT descripcion, categoria_id, barrio_texto, estado, anonimizada_en FROM solicitudes WHERE id = ?', [conDatos]))[0];
  ok(/No hay agua/.test(conserva.descripcion) && conserva.categoria_id === cat.vias && conserva.barrio_texto && conserva.estado === 'registrada' && conserva.anonimizada_en, 'y se conserva lo que ya no identifica a nadie: texto, categoría, barrio, estado', conserva);
  const aud = await audAuto();
  ok(aud.length === 1 && aud[0].usuario_id === null && /1 solicitud\(es\)/.test(aud[0].detalle) && /2 foto\(s\)/.test(aud[0].detalle), 'queda UN apunte en la auditoría, sin usuario (lo hizo el sistema), con cuántas anonimizó', aud.map((a) => a.detalle));
  ok((await q(`SELECT usuario_id FROM solicitud_historial WHERE solicitud_id = ? AND tipo = 'anonimizada'`, [conDatos])).length === 1, 'y en el historial de la solicitud');
  ok((await q('SELECT ciudadano_nombre FROM solicitudes WHERE id = ?', [sinDatos]))[0].ciudadano_nombre === null && !(await q('SELECT anonimizada_en FROM solicitudes WHERE id = ?', [sinDatos]))[0].anonimizada_en, 'la que nunca tuvo datos no se marca como anonimizada');
  v = await vuelta();
  ok(v.resultado.anonimizadas === 0 && (await audAuto()).length === 1, 'una segunda vuelta no encuentra nada y NO escribe otro apunte (un renglón diario que dice «0» es ruido)');
  // La regla de «una vez al día».
  Mant.reiniciarMemoria();
  const madrugada = new Date('2026-11-09T05:00:00Z'), mañana = new Date('2026-11-09T09:00:00Z'), tarde = new Date('2026-11-09T20:00:00Z'), diaSiguiente = new Date('2026-11-10T09:00:00Z');
  ok(Mant.enColombia(madrugada).minutos === 0 && Mant.enColombia(mañana).minutos === 4 * 60, 'la hora se cuenta en Colombia (UTC-5)');
  ok(!(await Mant.vueltaDiaria({ ahora: madrugada })).corrio, 'a las 00:00 (Colombia) todavía no es la hora: no corre');
  ok((await Mant.vueltaDiaria({ ahora: mañana })).corrio, 'a las 04:00 corre');
  ok((await Mant.vueltaDiaria({ ahora: tarde })).motivo === 'ya corrió hoy', 'esa tarde no repite: ya corrió hoy');
  ok((await Mant.vueltaDiaria({ ahora: diaSiguiente })).corrio, 'al día siguiente vuelve a correr');
  ok(/solicitudesMantenimiento'\)\.iniciar\(\)/.test(leer('app.js')), 'app.js la arranca con el proceso (no depende de ningún cron)');
  await q('UPDATE configuracion_campana SET fecha_eleccion = NULL, anonimizar_solicitudes_meses = 6 WHERE id = 1');
  ok(fs.existsSync(path.join(raiz, 'scripts/anonimizar-solicitudes.js')), 'el script manual sigue ahí, para pruebas');

  /* ====================================================================================== 3. push al asignar */
  console.log('\n[3] Aviso push al responsable cuando se le asigna una solicitud');
  const avisos = [];
  Seg.deps.enviarPush = async (id, carga) => { avisos.push({ id, ...carga }); };
  const secreta = await registrar(s1, { ciudadano_nombre: 'Rosa Secreta', ciudadano_telefono: '3109876543', autoriza_datos: '1', descripcion: 'La casa de la señora Rosa tiene el techo caído', barrio_texto: 'Barrio El Carmen', categoria_id: cat.agua });
  await permisos('coordinador', 0, 0, 0);
  const a1 = await pedir('PUT', `/${secreta}/responsable`, { usuario: admin, json: { responsable_id: l1.id } });
  ok(a1.status === 200 && a1.datos.aviso_enviado === true && avisos.length === 1 && avisos[0].id === l1.id, 'al asignar a un líder que puede ver el módulo, le llega el aviso', [a1.datos, avisos.length]);
  const cuerpo = avisos[0] && avisos[0].cuerpo || '';
  ok(avisos[0] && avisos[0].titulo === 'Te asignaron una solicitud' && /Agua/.test(cuerpo) && /El Carmen/.test(cuerpo) && cuerpo.length <= 140, 'el aviso dice la categoría y el barrio, y cabe en 140 caracteres', avisos[0]);
  ok(!/Rosa|Secreta|3109876543|techo|señora/i.test(JSON.stringify(avisos[0])), 'el aviso NO lleva el nombre, el teléfono ni el texto de la solicitud');
  ok(avisos[0] && avisos[0].url === '/app/mis-solicitudes.html', 'y abre «Mis solicitudes»', avisos[0] && avisos[0].url);
  avisos.length = 0;
  const a2 = await pedir('PUT', `/${secreta}/responsable`, { usuario: admin, json: { responsable_id: admin.id } });
  ok(a2.status === 200 && avisos.length === 0 && a2.datos.aviso_enviado === false, 'quien se asigna a sí mismo no se avisa solo');
  const a3 = await pedir('PUT', `/${secreta}/responsable`, { usuario: admin, json: { responsable_id: c2.id } });
  ok(a3.status === 200 && avisos.length === 0 && /no tiene acceso/.test(a3.datos.aviso || ''), 'a quien no puede ver el módulo NO se le avisa (no llevaría a ninguna parte) y al administrador se le dice', a3.datos);
  const a4 = await pedir('PUT', `/${secreta}/responsable`, { usuario: admin, json: { responsable_id: null } });
  ok(a4.status === 200 && avisos.length === 0, 'quitar el responsable no avisa a nadie');
  Seg.deps.enviarPush = async () => { throw new Error('Esta persona no tiene ningún dispositivo registrado para avisos.'); };
  const a5 = await pedir('PUT', `/${secreta}/responsable`, { usuario: admin, json: { responsable_id: l1.id } });
  ok(a5.status === 200 && a5.datos.aviso_enviado === false && (await q('SELECT responsable_id r FROM solicitudes WHERE id = ?', [secreta]))[0].r === l1.id, 'si el aviso falla (sin dispositivo, sin llaves…), la asignación igual queda hecha');
  Seg.deps.enviarPush = async (id, carga) => { avisos.push({ id, ...carga }); };
  await q('UPDATE usuarios SET no_contactar = 1 WHERE id = ?', [l2.id]);
  avisos.length = 0;
  await pedir('PUT', `/${secreta}/responsable`, { usuario: admin, json: { responsable_id: l2.id } });
  ok(avisos.length === 0, 'quien pidió no recibir avisos no los recibe');
  await q('UPDATE usuarios SET no_contactar = 0 WHERE id = ?', [l2.id]);
  await pedir('PUT', `/${secreta}/responsable`, { usuario: admin, json: { responsable_id: null } });

  /* ====================================================================================== 4. sin movimiento */
  console.log('\n[4] Alerta «sin movimiento hace N días» por el motor de recordatorios');
  await q('DELETE FROM solicitudes');
  const ahora = new Date('2026-11-20T19:00:00Z');                      // 14:00 en Colombia
  const COL = (d) => R.aTexto(new Date(ahora.getTime() - d * 86400000));
  const fijarMovimiento = async (id, dias) => {
    await q('UPDATE solicitudes SET creada_en = ?, actualizada_en = ? WHERE id = ?', [COL(dias), COL(dias), id]);
    await q('UPDATE solicitud_historial SET creado_en = ? WHERE solicitud_id = ?', [COL(dias), id]);
  };
  const vieja = await registrar(l1, { ciudadano_nombre: 'Pedro Secreto', ciudadano_telefono: '3205550000', autoriza_datos: '1', barrio_texto: 'Barrio Viejo', categoria_id: cat.vias });
  const reciente = await registrar(l1, { barrio_texto: 'Barrio Nuevo' });
  const cerrada = await registrar(l1, { barrio_texto: 'Barrio Cerrado' });
  const sinResp = await registrar(l1, { barrio_texto: 'Barrio Sin Responsable' });
  const sinAcceso = await registrar(l1, { barrio_texto: 'Barrio Sin Acceso' });
  for (const [id, r] of [[vieja, l1], [reciente, l1], [cerrada, l1], [sinAcceso, c2]]) await pedir('PUT', `/${id}/responsable`, { usuario: admin, json: { responsable_id: r.id } });
  await pedir('PUT', `/${cerrada}/estado`, { usuario: admin, json: { estado: 'cerrada', nota: 'Ya no aplica' } });
  await fijarMovimiento(vieja, 20); await fijarMovimiento(reciente, 3); await fijarMovimiento(cerrada, 40); await fijarMovimiento(sinResp, 40); await fijarMovimiento(sinAcceso, 40);

  const enviados = [];
  R.deps.enviar = async (canal, o) => { enviados.push({ canal, usuario: o.ficha.usuario_id, texto: o.texto, asunto: o.asunto, regla: o.regla.id, fila: o.filaId }); return 'push:1'; };
  let r = await R.vuelta({ ahora });
  ok(r.omitida === 'apagado' && enviados.length === 0, 'APAGADA de fábrica: con el interruptor general en 0, ni se mira');
  await q('UPDATE configuracion_campana SET recordatorios_activos = 1 WHERE id = 1');
  r = await R.vuelta({ ahora });
  ok(enviados.length === 0 && r.candidatos === 0, 'con el interruptor general encendido pero la regla apagada, tampoco sale nada', r);
  await R.activarRegla(regla[0].id, 1, { ahora });
  ok((await q('SELECT activo FROM recordatorio_reglas WHERE id = ?', [regla[0].id]))[0].activo === 1, 'la plantilla de fábrica pasa el validador (también en precampaña) y la regla se enciende');
  const prueba = await R.enviarPrueba({ reglaId: regla[0].id, usuarioId: admin.id, ahora });
  ok(prueba.canal === 'push' && /Vias en Barrio de ejemplo lleva 15 días/.test(prueba.texto) && enviados.length === 1 && enviados[0].fila === null, '«Enviarme una prueba» funciona con datos de muestra y no se registra como envío', prueba);
  enviados.length = 0;
  r = await R.vuelta({ ahora: new Date('2026-11-21T02:00:00Z') });    // 21:00 en Colombia
  ok(r.omitida === 'silencio' && enviados.length === 0, 'en la franja de silencio (20:00–08:00) no sale nada');
  r = await R.vuelta({ ahora });
  ok(enviados.length === 1 && enviados[0].usuario === l1.id && enviados[0].canal === 'push', 'encendida: sale UN aviso, al responsable de la solicitud quieta', enviados.map((e) => [e.usuario, e.texto]));
  ok(enviados[0] && /Vías/.test(enviados[0].texto) && /Barrio Viejo/.test(enviados[0].texto) && /20 días/.test(enviados[0].texto) && /^Lider/.test(enviados[0].texto), 'dice la categoría, el barrio y los días (20), con el nombre de pila de quien lo recibe', enviados[0] && enviados[0].texto);
  ok(enviados[0] && enviados[0].asunto === 'Solicitud sin movimiento' && !/Pedro|Secreto|3205550000/.test(JSON.stringify(enviados[0])), 'el aviso no lleva datos del ciudadano');
  ok(!enviados.some((e) => /Nuevo|Cerrado|Sin Responsable|Sin Acceso/.test(e.texto)), 'NO avisa de la reciente (3 días), la cerrada, la que no tiene responsable ni la de quien no puede ver el módulo');
  r = await R.vuelta({ ahora: new Date(ahora.getTime() + 60000) });
  ok(enviados.length === 1 && r.candidatos === 0, 'una segunda vuelta no repite el aviso (una vez por ocurrencia)');
  ok((await q(`SELECT estado FROM recordatorio_envios WHERE regla_id = ?`, [regla[0].id])).map((f) => f.estado).join() === 'enviado', 'queda registrado como enviado en el historial del motor');
  // N configurable: una solicitud quieta 20 días no avisa con N = 40 y sí con N = 15.
  const lenta = await registrar(l1, { barrio_texto: 'Barrio Lento', categoria_id: cat.luz });
  await pedir('PUT', `/${lenta}/responsable`, { usuario: admin, json: { responsable_id: l1.id } });
  await fijarMovimiento(lenta, 20);
  await pedir('PUT', '/config', { usuario: admin, json: { dias_sin_movimiento: 40 } });
  r = await R.vuelta({ ahora: new Date(ahora.getTime() + 120000) });
  ok(enviados.length === 1, 'con N = 40, una solicitud quieta 20 días NO avisa');
  await pedir('PUT', '/config', { usuario: admin, json: { dias_sin_movimiento: 15 } });
  r = await R.vuelta({ ahora: new Date(ahora.getTime() + 180000) });
  ok(enviados.length === 2 && /Barrio Lento/.test(enviados[1].texto), 'con N = 15 sí avisa (el cambio rige en la vuelta siguiente, sin reiniciar nada)', enviados.map((e) => e.texto));
  // Movimiento: una nota la «despierta»; si vuelve a quedar quieta, avisa otra vez.
  const deViejo = () => enviados.filter((e) => /Barrio Viejo/.test(e.texto));
  await q('UPDATE solicitud_historial SET creado_en = ? WHERE solicitud_id = ?', [R.aTexto(ahora), vieja]);   // alguien la movió «ahora»
  r = await R.vuelta({ ahora: new Date(ahora.getTime() + 10 * 86400000) });
  ok(deViejo().length === 1, 'con movimiento reciente (10 días después) ya no está quieta: no avisa otra vez');
  r = await R.vuelta({ ahora: new Date(ahora.getTime() + 16 * 86400000 + 3600000) });
  ok(deViejo().length === 2 && /16 días/.test(deViejo()[1].texto), 'si 16 días después sigue sin movimiento, es otra ocurrencia y avisa de nuevo (16 días)', deViejo().map((e) => e.texto));
  // Cambio de responsable: el aviso va a la persona nueva.
  Seg.deps.enviarPush = async () => {};
  await pedir('PUT', `/${vieja}/responsable`, { usuario: admin, json: { responsable_id: l2.id } });
  await q('UPDATE solicitud_historial SET creado_en = ? WHERE solicitud_id = ?', [R.aTexto(ahora), vieja]);
  r = await R.vuelta({ ahora: new Date(ahora.getTime() + 20 * 86400000) });
  ok(deViejo().length === 3 && deViejo()[2].usuario === l2.id, 'si cambia el responsable, el aviso siguiente va a la persona nueva', deViejo().map((e) => e.usuario));
  // Un aviso que falla queda esperando su reintento, y si la solicitud se cierra mientras tanto, se cancela.
  const t0 = new Date(ahora.getTime() + 60 * 86400000);
  const porCerrar = await registrar(l1, { barrio_texto: 'Barrio Por Cerrar', categoria_id: cat.salud });
  await pedir('PUT', `/${porCerrar}/responsable`, { usuario: admin, json: { responsable_id: l1.id } });
  await q('UPDATE solicitudes SET creada_en = ? WHERE id = ?', [R.aTexto(new Date(t0.getTime() - 20 * 86400000)), porCerrar]);
  await q('UPDATE solicitud_historial SET creado_en = ? WHERE solicitud_id = ?', [R.aTexto(new Date(t0.getTime() - 20 * 86400000)), porCerrar]);
  const antes = enviados.length;
  let fallaUnaVez = true;
  R.deps.enviar = async (canal, o) => { if (fallaUnaVez) { fallaUnaVez = false; throw new Error('el servicio de avisos no responde'); } enviados.push({ canal, usuario: o.ficha.usuario_id, texto: o.texto }); return 'push:1'; };
  r = await R.vuelta({ ahora: t0 });
  ok(r.reintentos >= 1 && !enviados.slice(antes).some((e) => /Por Cerrar/.test(e.texto)), 'si el aviso falla, queda esperando su reintento', r);
  await pedir('PUT', `/${porCerrar}/estado`, { usuario: admin, json: { estado: 'cerrada', nota: 'Se atendió por otra vía' } });
  r = await R.vuelta({ ahora: new Date(t0.getTime() + 6 * 60000) });
  const filaEspera = (await q(`SELECT estado, motivo FROM recordatorio_envios WHERE regla_id = ? AND ocurrencia LIKE ? ORDER BY id DESC LIMIT 1`, [regla[0].id, `solicitud:${porCerrar}:%`]))[0];
  ok(!enviados.slice(antes).some((e) => /Por Cerrar/.test(e.texto)) && filaEspera.estado === 'omitido' && /se cerró/.test(filaEspera.motivo), 'si la solicitud se cierra mientras esperaba el reintento, el aviso se cancela con su motivo', filaEspera);
  await q('UPDATE configuracion_campana SET recordatorios_activos = 0 WHERE id = 1');
  await q('UPDATE recordatorio_reglas SET activo = 0 WHERE tipo = ?', ['solicitud_sin_movimiento']);

  /* ====================================================================================== 5. panel, mapa, exportación */
  console.log('\n[5] Panel, mapa y exportación: el alcance');
  await q('DELETE FROM solicitudes'); await q('DELETE FROM auditoria');
  await permisos('coordinador', 1, 0, 1);
  // Puntos del GPS: ninguno cae justo en el centro de su celda de 0,005°.
  const A1 = { latitud: 5.0711, longitud: -75.5120 }, A2 = { latitud: 5.0731, longitud: -75.5131 }, A3 = { latitud: 5.0742, longitud: -75.5111 };
  const B1 = { latitud: 5.0910, longitud: -75.5300 }, C1 = { latitud: 6.2518, longitud: -75.5636 }, Z1 = { latitud: 4.6013, longitud: -74.1017 };
  const sol = {};
  sol.a1 = await registrar(l1, { ...A1, categoria_id: cat.vias, barrio_texto: 'Barrio A', ciudadano_nombre: 'Rosa Secreta', ciudadano_telefono: '3109876543', autoriza_datos: '1', descripcion: 'El hueco de la calle de doña Rosa lleva meses abierto.' });
  sol.a2 = await registrar(l1, { ...A2, categoria_id: cat.vias, barrio_texto: 'Barrio A' });
  sol.a3 = await registrar(s1, { ...A3, categoria_id: cat.agua, barrio_texto: 'Barrio A' });
  sol.b1 = await registrar(l2, { ...B1, categoria_id: cat.luz, barrio_texto: 'Barrio B' });
  sol.c1 = await registrar(l3, { ...C1, categoria_id: cat.empleo, barrio_texto: 'Barrio C' });
  sol.salud = await registrar(c1, { categoria_id: cat.salud, barrio_texto: 'Barrio B' });
  sol.adm = await registrar(admin, { categoria_id: cat.otras, barrio_texto: 'Barrio D' });
  sol.la = await registrar(la, { ...Z1, categoria_id: cat.vias, barrio_texto: 'Barrio Z' });
  // Tiempos: a1 se remite a los 2 días y a2 a los 4 (promedio 3); a1 se cierra a los 10.
  await q(`UPDATE solicitudes SET creada_en = '2026-09-01 10:00:00', remitida_en = '2026-09-03 10:00:00', cerrada_en = '2026-09-11 10:00:00', estado = 'cerrada' WHERE id = ?`, [sol.a1]);
  await q(`UPDATE solicitudes SET creada_en = '2026-09-01 10:00:00', remitida_en = '2026-09-05 10:00:00', estado = 'remitida' WHERE id = ?`, [sol.a2]);
  await q(`UPDATE solicitudes SET creada_en = '2026-10-15 10:00:00' WHERE id = ?`, [sol.a3]);
  const panel = async (u, qs = '', o = {}) => (await pedir('GET', '/panel' + qs, { usuario: u, ...o }));
  const mapa = async (u, qs = '') => (await pedir('GET', '/mapa' + qs, { usuario: u }));
  const total = async (u) => (await pedir('GET', '/?limite=100', { usuario: u })).datos.total;
  const pa = await panel(admin);
  ok(pa.status === 200 && pa.datos.total === 7, 'ADMINISTRADOR: el panel cuenta las 7 de la campaña madre (sin la rama del aspirante)', pa.datos && pa.datos.total);
  ok(!JSON.stringify(pa.datos).includes('Barrio Z') && pa.datos.porZona.length === 4, 'y no aparece el barrio de la rama del aspirante', pa.datos.porZona.map((z) => z.nombre));
  const zA = pa.datos.porZona.find((z) => z.nombre === 'Barrio A');
  ok(pa.datos.porZona[0].nombre === 'Barrio A' && zA.total === 3 && zA.cerrada === 1 && zA.remitida === 1 && zA.registrada === 1, 'por barrio o vereda: Barrio A primero, con 3 y su reparto por estado', zA);
  const cv = pa.datos.porCategoria.find((c) => c.nombre === 'Vías');
  ok(cv && cv.total === 2 && pa.datos.porCategoria.reduce((a, c) => a + c.total, 0) === 7, 'por categoría: Vías 2 y la suma da 7', pa.datos.porCategoria.map((c) => [c.nombre, c.total]));
  ok(pa.datos.porEstado.cerrada === 1 && pa.datos.porEstado.remitida === 1 && pa.datos.porEstado.registrada === 5 && pa.datos.porEstado.en_revision === 0, 'por estado', pa.datos.porEstado);
  ok(pa.datos.tiempos.registrada_a_remitida.n === 2 && pa.datos.tiempos.registrada_a_remitida.dias === 3
    && pa.datos.tiempos.registrada_a_cerrada.n === 1 && pa.datos.tiempos.registrada_a_cerrada.dias === 10, 'tiempos: registrada→remitida 3 días (2 solicitudes) y registrada→cerrada 10 días (1)', pa.datos.tiempos);
  ok(pa.datos.sinMovimiento.dias === 15 && pa.datos.sinMovimiento.n >= 0, 'y trae cuántas llevan días sin movimiento', pa.datos.sinMovimiento);
  const pl1 = (await panel(l1)).datos, pc1 = (await panel(c1)).datos, pc2 = (await panel(c2)).datos, ps1 = (await panel(s1)).datos, pl2 = (await panel(l2)).datos;
  ok(pl1.total === 3 && pl1.porZona.length === 1 && pl1.porZona[0].nombre === 'Barrio A', 'LÍDER 1: las suyas y las de su sublíder (3, todas del Barrio A)', [pl1.total, pl1.porZona]);
  ok(ps1.total === 1, 'SUBLÍDER: solo la suya', ps1.total);
  ok(pc1.total === 5 && !pc1.porZona.some((z) => z.nombre === 'Barrio C' || z.nombre === 'Barrio D'), 'COORDINADOR 1: las de su equipo (5), no las de otra coordinación ni la del administrador', pc1.porZona.map((z) => z.nombre));
  ok(pc2.total === 1 && pc2.porZona[0].nombre === 'Barrio C', 'COORDINADOR 2: solo la de su coordinación', pc2.porZona);
  ok(pl2.total === 1, 'LÍDER 2: la suya', pl2.total);
  for (const [u, nombre] of [[admin, 'admin'], [l1, 'líder 1'], [s1, 'sublíder'], [c1, 'coordinador 1'], [c2, 'coordinador 2'], [l2, 'líder 2'], [testigo, 'testigo']]) {
    const p = (await panel(u)).datos;
    ok(p.total === await total(u), `el panel de ${nombre} cuenta lo MISMO que su lista (${p.total})`, [p.total, await total(u)]);
  }
  ok((await panel(testigo)).datos.total === 0, 'un rol sin trabajo en campo, con el módulo abierto: panel en cero');
  await pedir('PUT', `/${sol.adm}/responsable`, { usuario: admin, json: { responsable_id: l2.id } });
  ok((await panel(l2)).datos.total === 2, 'y «me la asignaron» también entra al panel (líder 2: 2)');
  await pedir('PUT', `/${sol.adm}/responsable`, { usuario: admin, json: { responsable_id: null } });
  ok((await panel(admin, '?desde=2026-10-01')).datos.total === 5 && (await panel(admin, '?hasta=2026-09-30')).datos.total === 2, 'los filtros de fecha acotan el panel (sin tocar el alcance)');
  ok((await panel(admin, '?desde=no-es-fecha')).datos.total === 7, 'una fecha que no es fecha se ignora');
  // Sin permiso, sin sesión, aspirante.
  ok((await pedir('GET', '/panel')).status === 401 && (await pedir('GET', '/mapa')).status === 401, 'sin sesión: 401');
  await permisos('lider', 0, 0, 0);
  ok((await panel(l1)).status === 403 && (await mapa(l1)).status === 403 && (await pedir('GET', '/exportar/diagnostico', { usuario: l1 })).status === 403, 'sin «Ver» en el módulo: ni panel ni mapa ni exportar (403)');
  await permisos('lider', 1, 0, 1);
  ok((await pedir('GET', '/panel', { usuario: la, aspirante: asp.id })).status === 403 && (await pedir('GET', '/mapa', { usuario: la, aspirante: asp.id })).status === 403 && (await pedir('GET', '/exportar/diagnostico', { usuario: la, aspirante: asp.id })).status === 403, 'el aspirante con sublicencia no llega al panel, al mapa ni a la exportación');

  console.log('\n   Mapa');
  const ma = (await mapa(admin)).datos;
  ok(ma.total === 7 && ma.con_ubicacion === 5 && ma.sin_ubicacion === 2 && ma.zonas.length === 3, 'ADMINISTRADOR: 5 solicitudes con GPS en 3 zonas; 2 sin ubicación no aparecen', [ma.total, ma.con_ubicacion, ma.zonas.length]);
  ok(ma.zonas[0].n === 3 && ma.zonas[0].categorias.map((c) => `${c.nombre}:${c.n}`).join() === 'Vías:2,Agua:1', 'la zona del Barrio A agrupa las 3 y las reparte por categoría', ma.zonas[0]);
  ok(ma.zonas.every((z) => Object.keys(z).sort().join() === 'categorias,lat,lng,n' && z.categorias.every((c) => Object.keys(c).sort().join() === 'n,nombre')), 'cada zona trae SOLO lat, lng, n y categorías');
  const crudo = JSON.stringify(ma);
  ok(!/Rosa|Secreta|3109876543|hueco|Barrio|ciudadano|foto|descripcion|telefono|nombre_usuario|cliente_uuid/i.test(crudo.replace(/"nombre":"(Vías|Agua|Luz|Empleo|Salud|Otras)"/g, '')), 'el mapa NO lleva nombres, teléfonos, textos, barrios, fotos ni identificadores', crudo.slice(0, 300));
  const exactos = [A1, A2, A3, B1, C1, Z1].flatMap((p) => [p.latitud, p.longitud]);
  ok(ma.zonas.every((z) => !exactos.includes(z.lat) && !exactos.includes(z.lng)) && ma.zonas[0].lat === 5.0725 && ma.zonas[0].lng === -75.5125, 'y ningún círculo está en un punto exacto del GPS: va el CENTRO de la celda de 0,005° (5,0725 · -75,5125)', ma.zonas.map((z) => [z.lat, z.lng]));
  ok(!JSON.stringify(ma).includes('4.60'), 'la rama del aspirante no sale en el mapa del administrador');
  const ml1 = (await mapa(l1)).datos, mc2 = (await mapa(c2)).datos, mc1 = (await mapa(c1)).datos;
  ok(ml1.zonas.length === 1 && ml1.zonas[0].n === 3, 'LÍDER 1: su zona (3)');
  ok(mc2.zonas.length === 1 && mc2.zonas[0].n === 1 && mc2.zonas[0].lat > 6, 'COORDINADOR 2: solo la de Medellín (1)');
  ok(mc1.zonas.length === 2 && mc1.zonas.reduce((a, z) => a + z.n, 0) === 4, 'COORDINADOR 1: dos zonas, 4 solicitudes con GPS', mc1.zonas);
  ok((await mapa(testigo)).datos.zonas.length === 0, 'el rol sin trabajo en campo: mapa vacío');
  const mFiltro = (await mapa(admin, `?categoria=${cat.vias}`)).datos;
  ok(mFiltro.zonas.length === 1 && mFiltro.zonas[0].n === 2, 'filtrar por categoría (Vías): una zona con 2');
  ok((await mapa(admin, '?estado=cerrada')).datos.zonas.length === 1, 'filtrar por estado (cerrada): una zona');

  console.log('\n   Exportación');
  const d1 = await pedir('GET', '/exportar/diagnostico', { usuario: admin });
  ok(d1.status === 200 && /spreadsheetml/.test(d1.tipo) && /diagnostico-necesidades-territorio-\d{4}-\d{2}-\d{2}\.xlsx/.test(d1.disposicion), 'ADMINISTRADOR: descarga el «Diagnóstico de necesidades del territorio» (.xlsx)', [d1.status, d1.disposicion]);
  const wb1 = libro(d1);
  ok(wb1.SheetNames.join() === 'Diagnóstico,Por categoría,Cómo leerlo', 'con tres hojas', wb1.SheetNames);
  const filasDiag = filasDe(wb1, 'Diagnóstico');
  ok(filasDiag[0].join() === 'Categoría,Barrio o vereda,Registrada,En revisión,Remitida,Cerrada,Total', 'categoría × barrio × estado: la cabecera', filasDiag[0]);
  const vA = filasDiag.find((f) => f[0] === 'Vías' && f[1] === 'Barrio A');
  ok(vA && vA.slice(2).join() === '0,0,1,1,2', 'Vías × Barrio A = 1 remitida + 1 cerrada = 2', vA);
  ok(filasDiag.slice(1).reduce((a, f) => a + Number(f[6]), 0) === 7, 'y las filas suman las 7 solicitudes');
  const textoDiag = todoElTexto(wb1);
  ok(!/Rosa|Secreta|3109876543|hueco|doña|ciudadano_|Pedro|Marta/i.test(textoDiag), 'el diagnóstico NO lleva datos personales ni el texto de ninguna solicitud');
  ok(/3 *\b|3,/.test(JSON.stringify(filasDe(wb1, 'Cómo leerlo'))) && /Solicitudes contadas/.test(textoDiag), 'y su hoja «Cómo leerlo» dice los filtros, el conteo y los tiempos');
  ok((await q(`SELECT detalle FROM auditoria WHERE accion = 'exportar_excel' AND entidad = 'solicitudes'`)).some((a) => /sin datos personales/.test(a.detalle)), 'queda en la auditoría');
  // Quien tenga Exportar: solo lo suyo.
  await permisos('lider', 1, 0, 1, 0);
  ok((await pedir('GET', '/exportar/diagnostico', { usuario: l1 })).status === 403, 'el líder SIN la casilla Importar / Exportar: 403');
  await permisos('lider', 1, 0, 1, 1);
  const dl1 = await pedir('GET', '/exportar/diagnostico', { usuario: l1 });
  const tl1 = dl1.status === 200 ? todoElTexto(libro(dl1)) : '';
  ok(dl1.status === 200 && /Barrio A/.test(tl1) && !/Barrio B|Barrio C|Barrio D|Barrio Z/.test(tl1) && !/Secreta|3109876543/.test(tl1), 'CON la casilla, el líder descarga el diagnóstico de SU alcance (solo el Barrio A) y nada personal', [dl1.status, tl1.slice(0, 200)]);
  const filasL1 = dl1.status === 200 ? filasDe(libro(dl1), 'Diagnóstico').slice(1) : [];
  ok(filasL1.reduce((a, f) => a + Number(f[6]), 0) === 3, 'y suma 3, como su lista');
  // Detalle: solo administrador.
  const dt = await pedir('GET', '/exportar/detalle', { usuario: admin });
  ok(dt.status === 200 && /detalle-solicitudes-\d{4}-\d{2}-\d{2}\.xlsx/.test(dt.disposicion), 'ADMINISTRADOR: descarga el detalle', [dt.status, dt.disposicion]);
  const wbD = libro(dt), filasD = filasDe(wbD, 'Solicitudes');
  ok(filasD.length === 8 && filasD[0][14] === 'Teléfono (enmascarado)', '7 solicitudes más la cabecera', [filasD.length, filasD[0]]);
  const filaRosa = filasD.find((f) => f[0] === sol.a1);
  ok(filaRosa && filaRosa[13] === 'Rosa Secreta' && filaRosa[14] === '*** *** 6543', 'el teléfono sale ENMASCARADO (solo el final) y el nombre, porque el ciudadano autorizó', filaRosa && [filaRosa[13], filaRosa[14]]);
  ok(!JSON.stringify(filasD).includes('3109876543') && !JSON.stringify(wbD.SheetNames.map((h) => filasDe(wbD, h))).includes('3109876543'), 'el teléfono completo no está en NINGUNA hoja ni celda');
  ok(filasD.slice(1).every((f) => f[0] !== sol.la), 'y la rama del aspirante no entra');
  for (const [u, nombre] of [[l1, 'el líder (aunque tenga la casilla de exportar)'], [c1, 'el coordinador'], [s1, 'el sublíder']]) {
    ok((await pedir('GET', '/exportar/detalle', { usuario: u })).status === 403, `${nombre}: el detalle es 403 — solo del administrador`);
  }
  ok((await pedir('GET', '/exportar/detalle', { usuario: la, aspirante: asp.id })).status === 403, 'el aspirante con sublicencia: 403');
  const audD = await q(`SELECT * FROM auditoria WHERE accion = 'exportar_excel_detalle'`);
  ok(audD.length === 1 && audD[0].usuario_id === 1 && /7 fila\(s\)/.test(audD[0].detalle) && /enmascarado/.test(audD[0].detalle), 'el detalle queda en la auditoría: quién, cuántas filas y que salió enmascarado', audD.map((a) => a.detalle));
  ok((await q(`SELECT COUNT(*) n FROM auditoria WHERE accion = 'exportar_excel_detalle'`))[0].n === 1, 'y los intentos rechazados no dejan un apunte de exportación');
  const dtf = await pedir('GET', '/exportar/detalle?estado=cerrada', { usuario: admin });
  ok(dtf.status === 200 && filasDe(libro(dtf), 'Solicitudes').length === 2, 'el detalle respeta los filtros (cerrada: 1 fila)');
  // Los números de MySQL en el panel no son textos.
  ok(typeof pa.datos.total === 'number' && typeof pa.datos.porCategoria[0].total === 'number' && typeof pa.datos.sinMovimiento.n === 'number', 'los conteos viajan como números');

  /* ====================================================================================== 6. textos */
  console.log('\n[6] Los textos nuevos: nada de cargos, voto, elección ni promesas');
  const PROHIBIDO = /\b(alcald\w*|concej\w*|gobernaci\w*|gobernador\w*|asamble\w*|senad\w*|edil\w*|vot\w*|elecci\w*|electoral\w*|urnas?|tarjet\w*|cargos?|resuelt[ao]s?|cumplid[ao]s?|solucionad[ao]s?|se compromet\w*|prometemos|garantizamos)\b/i;
  const sinMarcado = (html) => html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
  const cuerpoGuia = (t) => t.replace(/^---[\s\S]*?---/, '');
  ok(!PROHIBIDO.test(cuerpoGuia(leer('manuales/bloques/mod-solicitudes.md'))) && !PROHIBIDO.test(cuerpoGuia(leer('manuales/bloques/t-solicitud-exportar.md'))), 'las dos guías (módulo y exportar)');
  ok(!PROHIBIDO.test(sinMarcado(leer('public/solicitudes.html'))), 'la pantalla de escritorio (texto visible)');
  const notas = (leer('routes/solicitudes.routes.js').match(/\['[^\]]{40,}'\]/g) || []).join(' ');
  ok(notas.length > 200 && !PROHIBIDO.test(notas), 'las notas que lleva el Excel', notas.slice(0, 120));
  const plantilla = regla[0].plantilla + ' ' + regla[0].asunto;
  ok(!PROHIBIDO.test(plantilla) && !R.palabraProhibida(plantilla, {}), 'la plantilla de fábrica del aviso (también para el validador de precampaña)');
  ok(!PROHIBIDO.test(leer('lib/solicitudesSeguimiento.js').match(/cuerpo: recortar\([^\n]*/)[0]), 'y el texto del aviso al asignar');

  servidor.close();
  console.log(fallos ? `\n${fallos} comprobación(es) FALLARON.` : '\nTODO BIEN');
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
