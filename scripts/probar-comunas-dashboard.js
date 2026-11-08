#!/usr/bin/env node
// scripts/probar-comunas-dashboard.js
//
// Prueba de la ORDEN 36: (A) la comuna/corregimiento de las fichas se valida contra la lista de la campaña en cada entrada que
// la escribe, el dashboard «Por Comuna» muestra «Sin comuna» donde antes mostraba la ciudad o el departamento, y
// `scripts/reporte-comunas.js` lo cuenta; (B) el dashboard de votantes —todas sus consultas, y Exportar— y el progreso del
// equipo / tabla de posiciones del Panel quedan acotados a la rama de un coordinador, sin cambiar lo que ve el administrador.
// Levanta las rutas reales en un Express de prueba (sesión fingida por cabecera). NO usa servicios externos.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada36 node scripts/probar-comunas-dashboard.js
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
const XLSX = require('xlsx');
const JSZip = require('jszip');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { revisarComuna, listaDeComunas, comunaValida, normalizarNombre } = require('../lib/comunasDeLaCampana');
const { sincronizarVotanteDesdeEstructura } = require('../config/sincronizacionVotantesEstructura');
const reporte = require('./reporte-comunas');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use((req, res, next) => {
  const u = req.headers['x-test-user'];
  req.session = { usuario: u ? JSON.parse(u) : undefined };
  req.sublicencia = null;
  next();
});
app.use('/api/votantes', require('../routes/votantes.routes'));
app.use('/api/votantes-dashboard', require('../routes/votantesDashboard.routes'));
app.use('/api/dashboard', require('../routes/dashboard.routes'));

let base = '';
let ipN = 10;
async function pedir(metodo, ruta, { json, usuario, form, binario } = {}) {
  const h = { 'X-Forwarded-For': `198.51.100.${ipN++}`, 'User-Agent': 'prueba-agente/1.0' };
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  const r = await fetch(base + ruta, { method: metodo, headers: h, body });
  if (binario) return { status: r.status, buffer: Buffer.from(await r.arrayBuffer()) };
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
  return { status: r.status, texto, datos };
}

let n = 0;
async function usuario(nombre, rol) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo)
     VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, `8200000${n}`, `u8200000${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  return { id: r.insertId, rol, nombre };
}
async function estructura(usuarioId, cargo, supervisorId) {
  await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo, meta_votos) VALUES (?,?,?,1,100)', [usuarioId, cargo, supervisorId || null]);
}
async function terr(tipo, nombre, padreId) {
  const [r] = await pool.query('INSERT INTO territorios (tipo, nombre, padre_id) VALUES (?,?,?)', [tipo, nombre, padreId || null]);
  return r.insertId;
}
let c = 0;
async function ficha(liderId, territorioId, extra = {}) {
  c++;
  const [r] = await pool.query(
    `INSERT INTO votantes (nombre, cedula, telefono, lider_id, territorio_id, comuna_corregimiento_residencia, puesto_votacion, mesa_votacion, origen)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'manual')`,
    [extra.nombre || `Persona ${c}`, `6300${String(c).padStart(5, '0')}`, `3600${String(c).padStart(6, '0')}`, liderId, territorioId || null,
     extra.comuna === undefined ? null : extra.comuna, extra.puesto || null]);
  return r.insertId;
}
const ordenar = (a) => [...a].sort();

(async () => {
  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  // ============================================================== 0. el terreno
  // Se puede repetir sobre la misma base: primero se borra lo que sembró una corrida anterior.
  await pool.query('DELETE FROM votantes');
  await pool.query("DELETE FROM estructura WHERE usuario_id IN (SELECT id FROM usuarios WHERE numero_identificacion LIKE '8200000%')");
  await pool.query("DELETE FROM usuarios WHERE numero_identificacion LIKE '8200000%'");
  await pool.query('UPDATE territorios SET padre_id = NULL');
  await pool.query('DELETE FROM territorios');
  await pool.query('UPDATE configuracion_campana SET territorio_ciudad = ?, territorio_departamento = ?, ciudad = ?, departamento = ? WHERE id = 1',
    ['MANIZALES', 'Caldas', 'MANIZALES', 'Caldas']);
  const caldas = await terr('departamento', 'Caldas');
  const antioquia = await terr('departamento', 'Antioquia');
  const manizales = await terr('municipio', 'MANIZALES', caldas);
  const medellin = await terr('municipio', 'MEDELLIN', antioquia);
  const com1 = await terr('comuna', 'Comuna 1 - Atardeceres', manizales);
  const com2 = await terr('comuna', 'Comuna 2 - Ciudadela', manizales);
  const corr = await terr('corregimiento', 'Corregimiento Sur', manizales);
  const barrioA = await terr('barrio', 'Barrio Alfa', com1);
  const barrioB = await terr('barrio', 'Barrio Beta', com2);
  const barrioDup1 = await terr('barrio', 'Barrio Repetido', com1);
  const barrioDup2 = await terr('barrio', 'Barrio Repetido', com2);
  const vereda = await terr('vereda', 'Vereda La Cabaña', corr);
  const veredaSuelta = await terr('vereda', 'Vereda Suelta', manizales);   // como las del DANE: cuelga del MUNICIPIO

  // ============================================================== 1. la regla pura
  console.log('\n== La regla (función pura)');
  const lista = { hay: true, nombres: new Set(['comuna 1 - atardeceres', 'corregimiento sur']) };
  ok(revisarComuna('Comuna 1 - Atardeceres', lista).valor === 'Comuna 1 - Atardeceres', 'una comuna de la lista se guarda tal cual');
  ok(revisarComuna('  comuna  1 - ATARDECERES ', lista).valor === 'comuna  1 - ATARDECERES' || revisarComuna('  comuna  1 - ATARDECERES ', lista).valor !== null,
    'mayúsculas, tildes y espacios repetidos no la tumban');
  const r1 = revisarComuna('MANIZALES', lista);
  ok(r1.valor === null && r1.descartada === 'MANIZALES', '«MANIZALES» (la ciudad) no es una comuna: queda vacía y se dice cuál era', r1);
  ok(revisarComuna('Caldas', lista).valor === null && revisarComuna('Antioquia', lista).valor === null, '«Caldas» y «Antioquia» tampoco');
  ok(revisarComuna('', lista).valor === null && revisarComuna('', lista).descartada === null, 'vacío sigue vacío y no es un descarte');
  ok(revisarComuna('MANIZALES', { hay: false, nombres: new Set() }).valor === 'MANIZALES', 'campaña SIN lista de comunas: el texto queda libre (como siempre)');
  ok(normalizarNombre('Corregimiento  Sur') === 'corregimiento sur' && normalizarNombre('Bogotá') === 'bogota', 'la comparación ignora tildes y espacios dobles');
  const real = await listaDeComunas(pool);
  ok(real.hay && real.nombres.size === 3, 'la lista real sale de la tabla territorios: 2 comunas + 1 corregimiento', [...real.nombres]);
  ok((await comunaValida(pool, 'MANIZALES')).descartada === 'MANIZALES', 'comunaValida contra la base: la ciudad se descarta');

  // ============================================================== 2. cada entrada que escribe la comuna
  console.log('\n== Alta (POST /api/votantes) y edición (PUT)');
  const admin = await usuario('Admin Prueba', 'admin');
  const A = admin;
  const cuerpo = (cedula, comuna, extra = {}) => ({
    categoria: 'votante', nombre: 'Prueba Comuna', cedula, telefono: '3105550101', consentimiento_autorizado: true,
    consentimiento_sms: true, territorio_id: barrioA, comuna_corregimiento_residencia: comuna, ciudad_residencia: 'MANIZALES', ...extra });
  const alta1 = await pedir('POST', '/api/votantes', { usuario: A, json: cuerpo('1053000111', 'MANIZALES') });
  ok(alta1.status === 200 && alta1.datos && alta1.datos.ok, 'alta con comuna «MANIZALES»: la ficha se guarda', alta1.datos || alta1.texto);
  const f1 = (await q('SELECT comuna_corregimiento_residencia c FROM votantes WHERE id = ?', [alta1.datos.id]))[0];
  ok(f1.c === null, 'alta: «MANIZALES» quedó VACÍA en la ficha', f1);
  ok(alta1.datos.comuna_descartada === 'MANIZALES', 'alta: la respuesta dice qué comuna se descartó', alta1.datos);
  const alta2 = await pedir('POST', '/api/votantes', { usuario: A, json: cuerpo('1053000222', 'Comuna 1 - Atardeceres', { telefono: '3105550102' }) });
  const f2 = (await q('SELECT comuna_corregimiento_residencia c FROM votantes WHERE id = ?', [alta2.datos.id]))[0];
  ok(f2.c === 'Comuna 1 - Atardeceres' && alta2.datos.comuna_descartada === null, 'alta con una comuna de la lista: se guarda y no hay aviso', [f2, alta2.datos]);
  const alta3 = await pedir('POST', '/api/votantes', { usuario: A, json: cuerpo('1053000333', 'Caldas', { telefono: '3105550103' }) });
  ok((await q('SELECT comuna_corregimiento_residencia c FROM votantes WHERE id = ?', [alta3.datos.id]))[0].c === null, 'alta con el departamento «Caldas»: vacía');

  const edit = await pedir('PUT', `/api/votantes/${alta2.datos.id}`, { usuario: A, json: { ...cuerpo('1053000222', 'Antioquia', { telefono: '3105550102' }), password: 'clave-ejemplo' } });
  ok(edit.status === 200 && edit.datos && edit.datos.comuna_descartada === 'Antioquia', 'edición con «Antioquia»: responde 200 y dice cuál descartó', edit.datos || edit.texto);
  ok((await q('SELECT comuna_corregimiento_residencia c FROM votantes WHERE id = ?', [alta2.datos.id]))[0].c === null, 'edición: «Antioquia» quedó vacía');
  const edit2 = await pedir('PUT', `/api/votantes/${alta2.datos.id}`, { usuario: A, json: { ...cuerpo('1053000222', 'Corregimiento Sur', { telefono: '3105550102' }), password: 'clave-ejemplo' } });
  ok(edit2.status === 200 && (await q('SELECT comuna_corregimiento_residencia c FROM votantes WHERE id = ?', [alta2.datos.id]))[0].c === 'Corregimiento Sur', 'edición con un corregimiento de la lista: se guarda');

  console.log('\n== Importación por Excel con ciudad y departamento en la columna «Comuna»');
  const filasExcel = [
    { 'Nombres y apellidos': 'Excel Uno', 'Número de identificación': '1053100001', Teléfono: '3115550001', Comuna: 'MANIZALES' },                          // ciudad, sin barrio
    { 'Nombres y apellidos': 'Excel Dos', 'Número de identificación': '1053100002', Teléfono: '3115550002', Comuna: 'Caldas', Barrio: 'Barrio Beta' },       // depto + barrio único
    { 'Nombres y apellidos': 'Excel Tres', 'Número de identificación': '1053100003', Teléfono: '3115550003', Comuna: 'Comuna 1 - Atardeceres', Barrio: 'Barrio Alfa' }, // buena
    { 'Nombres y apellidos': 'Excel Cuatro', 'Número de identificación': '1053100004', Teléfono: '3115550004', Comuna: 'Antioquia', Barrio: 'Barrio Repetido' },    // barrio ambiguo
    { 'Nombres y apellidos': 'Excel Cinco', 'Número de identificación': '1053100005', Teléfono: '3115550005', Corregimiento: 'MANIZALES', Vereda: 'Vereda La Cabaña' },
  ];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filasExcel), 'Hoja1');
  const bufExcel = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
  const fd = new FormData();
  fd.append('archivo', new Blob([bufExcel], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'prueba.xlsx');
  const imp = await pedir('POST', '/api/votantes/importar-excel', { usuario: A, form: fd });
  ok(imp.status === 200 && imp.datos && imp.datos.ok, 'la importación responde', imp.datos || imp.texto);
  const avisosImp = (imp.datos && imp.datos.avisos) || [];
  ok(avisosImp.length === 4, 'el resumen trae un aviso por cada comuna/corregimiento que no existe (4)', avisosImp);
  ok(avisosImp.some(a => a.fila === 2 && /comuna "MANIZALES" no existe en la campaña; quedó vacía/.test(a.aviso)), 'fila 2: «comuna "MANIZALES" no existe en la campaña; quedó vacía»', avisosImp);
  ok(avisosImp.some(a => a.fila === 3 && /"Caldas"/.test(a.aviso)) && avisosImp.some(a => a.fila === 6 && /corregimiento "MANIZALES"/.test(a.aviso)), 'también el departamento y un corregimiento falso', avisosImp);
  ok(!avisosImp.some(a => a.fila === 4), 'la fila con la comuna buena no lleva aviso');
  const porCed = async (ced) => (await q('SELECT id, territorio_id, comuna_corregimiento_residencia c FROM votantes WHERE cedula = ?', [ced]))[0];
  const e1 = await porCed('1053100001'), e2 = await porCed('1053100002'), e3 = await porCed('1053100003'), e4 = await porCed('1053100004'), e5 = await porCed('1053100005');
  ok(e1 && e1.territorio_id === null, 'fila con solo la ciudad en «Comuna»: la persona se importó (antes se perdía) y sin territorio', e1);
  ok(e2 && e2.territorio_id === barrioB, 'comuna falsa + barrio ÚNICO: el barrio se resuelve sin la comuna', e2);
  ok(e3 && e3.territorio_id === barrioA, 'comuna buena + barrio: como siempre', e3);
  ok(!e4 && (imp.datos.errores || []).some(x => x.fila === 5 && /varias comunas/.test(x.error)), 'comuna falsa + barrio que existe en varias comunas: se rechaza esa fila, no se adivina', imp.datos.errores);
  ok(e5 && e5.territorio_id === vereda, 'corregimiento falso + vereda única: la vereda se resuelve', e5);

  console.log('\n== Sincronización Estructura → Votantes');
  await sincronizarVotanteDesdeEstructura(pool, { numero_identificacion: '1053200001', nombre: 'Persona Estructura', telefono: '3125550001',
    comuna_corregimiento_residencia: 'MANIZALES', barrio_residencia: 'Barrio Alfa', territorio_id: barrioA, creado_por: A.id });
  const s1 = (await q("SELECT comuna_corregimiento_residencia c, barrio_residencia b FROM votantes WHERE cedula = '1053200001'"))[0];
  ok(s1 && s1.c === null && s1.b === 'Barrio Alfa', 'la copia de Estructura no lleva «MANIZALES» a la ficha (el barrio sí pasa)', s1);
  await sincronizarVotanteDesdeEstructura(pool, { numero_identificacion: '1053200002', nombre: 'Persona Estructura Dos', telefono: '3125550002',
    comuna_corregimiento_residencia: 'Comuna 2 - Ciudadela', territorio_id: barrioB, creado_por: A.id });
  ok((await q("SELECT comuna_corregimiento_residencia c FROM votantes WHERE cedula = '1053200002'"))[0].c === 'Comuna 2 - Ciudadela', 'y una comuna buena sí pasa');

  console.log('\n== Sin lista de comunas (campaña como Quindío) el texto sigue libre');
  await pool.query("CREATE TEMPORARY TABLE IF NOT EXISTS guarda_t AS SELECT * FROM territorios WHERE tipo IN ('comuna','corregimiento')");
  const guardadas = await q("SELECT id, tipo, nombre, padre_id FROM territorios WHERE tipo IN ('comuna','corregimiento')");
  await pool.query("UPDATE territorios SET padre_id = NULL WHERE padre_id IN (SELECT id FROM (SELECT id FROM territorios WHERE tipo IN ('comuna','corregimiento')) x)");
  await pool.query("DELETE FROM territorios WHERE tipo IN ('comuna','corregimiento')");
  const libre = await pedir('POST', '/api/votantes', { usuario: A, json: cuerpo('1053000444', 'MANIZALES', { telefono: '3105550104', territorio_id: null }) });
  ok(libre.datos && libre.datos.ok && libre.datos.comuna_descartada === null &&
    (await q('SELECT comuna_corregimiento_residencia c FROM votantes WHERE id = ?', [libre.datos.id]))[0].c === 'MANIZALES', 'sin comunas en la campaña: se guarda tal cual, sin aviso', libre.datos);
  // se restauran con los mismos id
  for (const g of guardadas) await pool.query('INSERT INTO territorios (id, tipo, nombre, padre_id) VALUES (?,?,?,?)', [g.id, g.tipo, g.nombre, g.padre_id]);
  await pool.query('UPDATE territorios SET padre_id = ? WHERE id IN (?, ?)', [com1, barrioA, barrioDup1]);
  await pool.query('UPDATE territorios SET padre_id = ? WHERE id IN (?, ?)', [com2, barrioB, barrioDup2]);
  await pool.query('UPDATE territorios SET padre_id = ? WHERE id = ?', [corr, vereda]);

  // ============================================================== 3. el dashboard y su alcance
  console.log('\n== El dashboard: «Sin comuna» en vez de la ciudad o el departamento');
  await pool.query('DELETE FROM votantes');
  const coordA = await usuario('Coordinador A', 'coordinador');
  const coordB = await usuario('Coordinador B', 'coordinador');
  const liderA = await usuario('Lider de A', 'lider');
  const liderB = await usuario('Lider de B', 'lider');
  const subA = await usuario('Sublider de A', 'lider');
  await estructura(coordA.id, 'coordinador', null);
  await estructura(coordB.id, 'coordinador', null);
  await estructura(liderA.id, 'lider', coordA.id);
  await estructura(liderB.id, 'lider', coordB.id);
  await estructura(subA.id, 'usuario', liderA.id);

  // Rama A: 3 en barrio de la comuna 1, 1 directamente en la comuna 2, 2 en la vereda suelta (bajo el municipio), 1 «de todo el municipio»,
  //         1 en medio de un departamento. Rama B: 4 en barrio de la comuna 2, 2 en la vereda del corregimiento, 1 sin territorio.
  for (let i = 0; i < 3; i++) await ficha(liderA.id, barrioA, { puesto: 'PUESTO UNO' });
  await ficha(subA.id, com2, { puesto: 'PUESTO UNO' });
  for (let i = 0; i < 2; i++) await ficha(liderA.id, veredaSuelta);
  await ficha(liderA.id, manizales);                       // «todo el municipio»: su padre es el departamento Caldas
  await ficha(coordA.id, antioquia);                       // un departamento: sin padre
  for (let i = 0; i < 4; i++) await ficha(liderB.id, barrioB, { puesto: 'PUESTO DOS' });
  for (let i = 0; i < 2; i++) await ficha(liderB.id, vereda);
  await ficha(liderB.id, null);
  const totalA = 8, totalB = 7, todos = 15;

  const rAdmin = await pedir('GET', '/api/votantes-dashboard/por-comuna', { usuario: A });
  const nombresAdmin = (rAdmin.datos || []).map(f => f.zona_nombre);
  ok(rAdmin.status === 200 && !nombresAdmin.includes('MANIZALES') && !nombresAdmin.includes('Caldas') && !nombresAdmin.includes('Antioquia'),
    '«Por Comuna»: ya no aparecen «MANIZALES», «Caldas» ni «Antioquia»', nombresAdmin);
  const sinCom = (rAdmin.datos || []).find(f => f.zona_nombre === 'Sin comuna');
  ok(sinCom && sinCom.total === 4 && sinCom.zona_id === 0, 'aparece «Sin comuna» con 4 (2 veredas sueltas + «todo el municipio» + el departamento)', sinCom);
  const c1 = rAdmin.datos.find(f => f.zona_nombre === 'Comuna 1 - Atardeceres'), c2 = rAdmin.datos.find(f => f.zona_nombre === 'Comuna 2 - Ciudadela'), cs = rAdmin.datos.find(f => f.zona_nombre === 'Corregimiento Sur');
  ok(c1 && c1.total === 3 && c2 && c2.total === 5 && cs && cs.total === 2, 'cada comuna cuenta lo suyo; una ficha asignada DIRECTO a la comuna cuenta en ella', rAdmin.datos);
  ok(rAdmin.datos.reduce((a, f) => a + f.total, 0) === todos - 1, 'el total (14) = todas las fichas con territorio (la que no tiene no se cuenta, como siempre)');
  const rBarrioSin = await pedir('GET', '/api/votantes-dashboard/por-barrio?zona_id=0', { usuario: A });
  ok(rBarrioSin.datos.reduce((a, f) => a + f.total, 0) === 4 && rBarrioSin.datos.every(f => f.zona_nombre === 'Sin comuna'), 'por-barrio con zona_id=0 (Sin comuna): sus 4 fichas', rBarrioSin.datos);
  const rBarrioC1 = await pedir('GET', `/api/votantes-dashboard/por-barrio?zona_id=${com1}`, { usuario: A });
  ok(rBarrioC1.datos.reduce((a, f) => a + f.total, 0) === 3 && rBarrioC1.datos[0].barrio_nombre === 'Barrio Alfa', 'por-barrio filtrado por una comuna: lo de esa comuna', rBarrioC1.datos);
  const rBarrioTodos = await pedir('GET', '/api/votantes-dashboard/por-barrio', { usuario: A });
  ok(rBarrioTodos.datos.reduce((a, f) => a + f.total, 0) === todos - 1 && !rBarrioTodos.datos.some(f => f.zona_nombre === 'MANIZALES'), 'por-barrio sin filtro: la columna de comuna dice «Sin comuna», no la ciudad');

  console.log('\n== El administrador ve toda la campaña (sin cambios)');
  const resumenAdmin = await pedir('GET', '/api/votantes-dashboard/resumen', { usuario: A });
  ok(resumenAdmin.datos && resumenAdmin.datos.total === todos, 'resumen: 15', resumenAdmin.datos);
  const lidAdmin = await pedir('GET', '/api/votantes-dashboard/por-lider', { usuario: A });
  ok(lidAdmin.datos.lideres.reduce((a, f) => a + f.total, 0) === todos && lidAdmin.datos.sinLider === 0, 'por-lider: los 15, sin líder 0', lidAdmin.datos);

  console.log('\n== El coordinador ve SOLO su rama, en cada consulta');
  const CA = { id: coordA.id, rol: 'coordinador', nombre: 'Coordinador A' };
  const CB = { id: coordB.id, rol: 'coordinador', nombre: 'Coordinador B' };
  const sum = (a) => a.reduce((x, f) => x + f.total, 0);
  const resA = await pedir('GET', '/api/votantes-dashboard/resumen', { usuario: CA });
  ok(resA.status === 200 && resA.datos.total === totalA, `resumen (coordinador A): ${totalA}`, resA.datos || resA.texto);
  const resB = await pedir('GET', '/api/votantes-dashboard/resumen', { usuario: CB });
  ok(resB.datos.total === 7, 'resumen (coordinador B): 7', resB.datos);
  const zA = await pedir('GET', '/api/votantes-dashboard/por-comuna', { usuario: CA });
  ok(sum(zA.datos) === totalA && !zA.datos.some(f => f.zona_nombre === 'Corregimiento Sur'), 'por-comuna (A): 8 y nada de la rama B', zA.datos);
  const zB = await pedir('GET', '/api/votantes-dashboard/por-comuna', { usuario: CB });
  ok(sum(zB.datos) === 6 && !zB.datos.some(f => f.zona_nombre === 'Comuna 1 - Atardeceres'), 'por-comuna (B): 6 con territorio y nada de la rama A', zB.datos);
  const bA = await pedir('GET', '/api/votantes-dashboard/por-barrio', { usuario: CA });
  ok(sum(bA.datos) === totalA && !bA.datos.some(f => f.barrio_nombre === 'Barrio Beta'), 'por-barrio (A): sólo lo suyo', bA.datos);
  const lA = await pedir('GET', '/api/votantes-dashboard/por-lider', { usuario: CA });
  ok(sum(lA.datos.lideres) === totalA && !lA.datos.lideres.some(f => f.lider_nombre === 'Lider de B'), 'por-lider (A): sólo su gente', lA.datos);
  ok(lA.datos.sinLider === 0, 'sin líder (A): 0, no cuenta las fichas sin líder de otros');

  // Exportar: Excel por sección y completo, Word por sección y completo
  const leerExcel = (buf) => { const l = XLSX.read(buf, { type: 'buffer' }); return Object.fromEntries(l.SheetNames.map(nom => [nom, XLSX.utils.sheet_to_json(l.Sheets[nom])])); };
  const exA = await pedir('GET', '/api/votantes-dashboard/exportar-excel', { usuario: CA, binario: true });
  const hojasA = exA.status === 200 ? leerExcel(exA.buffer) : {};
  ok(exA.status === 200 && ordenar(Object.keys(hojasA)).join() === ordenar(['Por comuna', 'Por barrio', 'Por líder', 'Por puesto y mesa']).join(), 'Excel completo (coordinador A) se genera con sus cuatro hojas', [exA.status, Object.keys(hojasA)]);
  ok((hojasA['Por comuna'] || []).reduce((a, f) => a + f['Total votantes'], 0) === totalA &&
     (hojasA['Por líder'] || []).reduce((a, f) => a + f['Total votantes'], 0) === totalA &&
     (hojasA['Por puesto y mesa'] || []).reduce((a, f) => a + f['Total votantes'], 0) === 4 &&
     !JSON.stringify(hojasA).includes('Lider de B'), 'Excel completo (A): comuna 8, líder 8, puesto/mesa 4 (sólo los de PUESTO UNO de A), nada de B', hojasA);
  ok(!JSON.stringify(hojasA['Por comuna'] || []).includes('MANIZALES') && JSON.stringify(hojasA['Por comuna'] || []).includes('Sin comuna'), 'Excel: «Sin comuna» donde estaba la ciudad');
  for (const [seccion, hoja, total, esperado] of [['comuna', 'Por comuna', 'Total votantes', totalA], ['barrio', 'Por barrio', 'Total votantes', totalA], ['lider', 'Por líder', 'Total votantes', totalA]]) {
    const ex = await pedir('GET', `/api/votantes-dashboard/exportar-excel?seccion=${seccion}`, { usuario: CA, binario: true });
    const h = ex.status === 200 ? leerExcel(ex.buffer) : {};
    ok(ex.status === 200 && (h[hoja] || []).reduce((a, f) => a + f[total], 0) === esperado, `Excel por sección «${seccion}» (A): ${esperado}`, [ex.status, h]);
  }
  const exAdmin = await pedir('GET', '/api/votantes-dashboard/exportar-excel', { usuario: A, binario: true });
  const hojasAdmin = leerExcel(exAdmin.buffer);
  ok((hojasAdmin['Por comuna'] || []).reduce((a, f) => a + f['Total votantes'], 0) === todos - 1 && (hojasAdmin['Por líder'] || []).reduce((a, f) => a + f['Total votantes'], 0) === todos, 'Excel completo (administrador): toda la campaña', hojasAdmin);
  const textoDocx = async (buf) => { const z = await JSZip.loadAsync(buf); return (await z.file('word/document.xml').async('string')).replace(/<[^>]+>/g, ' '); };
  const wA = await pedir('GET', '/api/votantes-dashboard/exportar-word', { usuario: CA, binario: true });
  const tA = wA.status === 200 ? await textoDocx(wA.buffer) : '';
  ok(wA.status === 200 && tA.includes('Lider de A') && !tA.includes('Lider de B') && !tA.includes('Barrio Beta') && !tA.includes('Corregimiento Sur'),
    'Word completo (A): su líder, sin la rama B', [wA.status]);
  const wCom = await pedir('GET', '/api/votantes-dashboard/exportar-word?seccion=comuna', { usuario: CA, binario: true });
  const tCom = wCom.status === 200 ? await textoDocx(wCom.buffer) : '';
  ok(tCom.includes('Sin comuna') && !tCom.includes('MANIZALES') && !tCom.includes('Caldas') && tCom.includes('Comuna 1 - Atardeceres'), 'Word sección «Por comuna» (A): «Sin comuna», no la ciudad ni el departamento', [wCom.status]);
  const wAdmin = await pedir('GET', '/api/votantes-dashboard/exportar-word', { usuario: A, binario: true });
  const tAdmin = wAdmin.status === 200 ? await textoDocx(wAdmin.buffer) : '';
  ok(tAdmin.includes('Lider de A') && tAdmin.includes('Lider de B') && tAdmin.includes('Corregimiento Sur'), 'Word completo (administrador): las dos ramas');
  const wLider = await pedir('GET', '/api/votantes-dashboard/exportar-word?seccion=lider', { usuario: CB, binario: true });
  const tLider = wLider.status === 200 ? await textoDocx(wLider.buffer) : '';
  ok(tLider.includes('Lider de B') && !tLider.includes('Lider de A'), 'Word sección «Por líder» (B): sólo B', [wLider.status]);

  // El estimado por puesto: la parte de «Por puesto» del dashboard (cuenta votantes por su puesto escrito)
  const pa = await pedir('GET', '/api/votantes-dashboard/exportar-excel?seccion=puesto', { usuario: CA, binario: true });
  const pB = await pedir('GET', '/api/votantes-dashboard/exportar-excel?seccion=puesto', { usuario: CB, binario: true });
  ok(pa.status === 200 && pB.status === 200, 'Excel de la sección «Por puesto» responde para los dos coordinadores', [pa.status, pB.status]);

  console.log('\n== Panel general: progreso del equipo y tabla de posiciones');
  const prA = await pedir('GET', '/api/dashboard/progreso-equipo', { usuario: CA });
  const filasA = (prA.datos && prA.datos.data) || [];
  ok(prA.status === 200 && filasA.some(f => f.nombre === 'Coordinador A') && filasA.some(f => f.nombre === 'Lider de A') &&
     !filasA.some(f => f.nombre === 'Coordinador B' || f.nombre === 'Lider de B'), 'progreso-equipo (A): él y su líder; ni el coordinador B ni su líder', filasA.map(f => f.nombre));
  const prAdmin = await pedir('GET', '/api/dashboard/progreso-equipo', { usuario: A });
  const nombresPrAdmin = ((prAdmin.datos && prAdmin.datos.data) || []).map(f => f.nombre);
  ok(['Coordinador A', 'Coordinador B', 'Lider de A', 'Lider de B'].every(x => nombresPrAdmin.includes(x)), 'progreso-equipo (administrador): todos, como siempre', nombresPrAdmin);
  const lidA = filasA.find(f => f.nombre === 'Lider de A');
  const lidAAdmin = ((prAdmin.datos && prAdmin.datos.data) || []).find(f => f.nombre === 'Lider de A');
  ok(lidA && lidAAdmin && lidA.enviados === lidAAdmin.enviados, 'el conteo de un líder de su rama es el mismo para el coordinador que para el administrador', [lidA, lidAAdmin]);
  const tpA = await pedir('GET', '/api/dashboard/tabla-posiciones', { usuario: CA });
  const posA = (tpA.datos || []).map(f => f.nombre);
  ok(tpA.status === 200 && posA.includes('Lider de A') && !posA.includes('Lider de B'), 'tabla de posiciones (A): su líder, no el de B', tpA.datos || tpA.texto);
  const tpAdmin = await pedir('GET', '/api/dashboard/tabla-posiciones', { usuario: A });
  const posAdmin = (tpAdmin.datos || []).map(f => f.nombre);
  ok(posAdmin.includes('Lider de A') && posAdmin.includes('Lider de B'), 'tabla de posiciones (administrador): los dos', posAdmin);

  // ============================================================== 4. el reporte, sobre datos sembrados
  console.log('\n== scripts/reporte-comunas.js sobre datos sembrados');
  await pool.query('DELETE FROM votantes');
  await ficha(liderA.id, barrioA, { comuna: 'Comuna 1 - Atardeceres' });
  for (let i = 0; i < 6; i++) await ficha(liderA.id, veredaSuelta, { comuna: 'MANIZALES' });
  for (let i = 0; i < 2; i++) await ficha(liderA.id, manizales, { comuna: 'Caldas' });
  await ficha(liderA.id, barrioB, { comuna: 'Antioquia' });
  await ficha(liderA.id, barrioB, { comuna: 'Barrio inventado' });
  await ficha(liderA.id, null, { comuna: null });
  await pool.query("UPDATE usuarios SET comuna_corregimiento_residencia = 'MANIZALES' WHERE id = ?", [liderA.id]);
  const ro = await reporte.reporte(pool, { limite: 0 });
  const v = Object.fromEntries(ro.votantes.fuera_de_lista.map(x => [x.valor, x]));
  ok(ro.comunas_en_lista === 3, 'el reporte ve las 3 comunas/corregimientos de la lista', ro.comunas_en_lista);
  ok(v['MANIZALES'] && v['MANIZALES'].fichas === 6 && v['MANIZALES'].coincide_con === 'ciudad', '«MANIZALES»: 6 fichas, coincide con la ciudad', v['MANIZALES']);
  ok(v['Caldas'] && v['Caldas'].fichas === 2 && v['Caldas'].coincide_con === 'departamento', '«Caldas»: 2 fichas, coincide con el departamento', v['Caldas']);
  ok(v['Antioquia'] && v['Antioquia'].fichas === 1 && v['Antioquia'].coincide_con === 'departamento', '«Antioquia»: 1 ficha, departamento (aunque no sea el de la campaña, es un departamento)', v['Antioquia']);
  ok(v['Barrio inventado'] && v['Barrio inventado'].coincide_con === 'ninguno', 'un valor que no es ciudad ni departamento: «ninguno»', v['Barrio inventado']);
  ok(!v['Comuna 1 - Atardeceres'] && ro.votantes.total_fuera === 10, 'la comuna buena no sale; 10 fichas fuera de lista en total', ro.votantes.total_fuera);
  ok(ro.estructura.fuera_de_lista.length === 1 && ro.estructura.fuera_de_lista[0].valor === 'MANIZALES', 'también mira Estructura (usuarios)', ro.estructura.fuera_de_lista);
  ok(ro.sin_comuna_en_dashboard.total === 8 && ro.sin_comuna_en_dashboard.sin_territorio === 1, 'cuenta las 8 fichas que el dashboard agrupa en «Sin comuna» (6 veredas sueltas + 2 de todo el municipio) y 1 sin territorio', ro.sin_comuna_en_dashboard);
  const texto = reporte.imprimir(ro, nombreBase);
  ok(texto.includes('«MANIZALES» — 6 ficha(s) — coincide con: ciudad') && texto.includes('RESULTADO: 10 ficha(s)'), 'el texto impreso lo dice', texto.split('\n').slice(0, 12));
  const antes = await q('SELECT COUNT(*) n, SUM(CRC32(COALESCE(comuna_corregimiento_residencia, ""))) s FROM votantes');
  await reporte.reporte(pool, { limite: 0 });
  const despues = await q('SELECT COUNT(*) n, SUM(CRC32(COALESCE(comuna_corregimiento_residencia, ""))) s FROM votantes');
  ok(JSON.stringify(antes) === JSON.stringify(despues), 'el reporte no modifica nada (solo lectura)');

  servidor.close();
  await pool.end();
  console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})().catch(async (e) => { console.error('ERROR DE LA PRUEBA:', e); try { await pool.end(); } catch (_) { /* ya cerrado */ } process.exit(1); });
