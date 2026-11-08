#!/usr/bin/env node
// scripts/probar-panel-alcance.js
//
// Prueba de la ORDEN 38, parte A: `/api/dashboard/resumen` y `/tendencia-registros` acotados por alcance (administrador: toda la
// campaña; coordinador: él, sus líderes y los sublíderes de éstos; líder y sublíder: lo suyo y lo de su equipo; aspirante: su rama),
// con eventos y menciones, y las finanzas SOLO para administrador, coordinador y aspirante. Levanta las rutas reales en un Express
// de prueba (sesión fingida por cabecera).
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada38 node scripts/probar-panel-alcance.js
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
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }

let sublicencia = null;                       // se pone a mano para probar al aspirante
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const u = req.headers['x-test-user'];
  req.session = { usuario: u ? JSON.parse(u) : undefined };
  req.sublicencia = req.headers['x-test-aspirante'] ? sublicencia : null;
  next();
});
app.use('/api/dashboard', require('../routes/dashboard.routes'));

let base = '';
async function pedir(ruta, usuario, aspirante) {
  const h = {};
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  if (aspirante) h['X-Test-Aspirante'] = '1';
  const r = await fetch(base + ruta, { headers: h });
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
  return { status: r.status, datos, texto };
}

let n = 0;
async function usuario(nombre, rol) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo)
     VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, `8300000${n}`, `u8300000${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  return { id: r.insertId, rol, nombre };
}
async function estructura(usuarioId, cargo, supervisorId, meta) {
  await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo, meta_votos) VALUES (?,?,?,1,?)', [usuarioId, cargo, supervisorId || null, meta || 0]);
}
let c = 0;
async function ficha(liderId, subliderId, diasAtras = 0) {
  c++;
  await pool.query(
    `INSERT INTO votantes (nombre, cedula, telefono, lider_id, sublider_id, origen, created_at)
     VALUES (?, ?, ?, ?, ?, 'manual', DATE_SUB(NOW(), INTERVAL ? DAY))`,
    [`Persona ${c}`, `6400${String(c).padStart(5, '0')}`, `3700${String(c).padStart(6, '0')}`, liderId, subliderId || null, diasAtras]);
}
async function evento(titulo, { responsable, coordinador, lider } = {}) {
  await pool.query(
    `INSERT INTO eventos (titulo, tipo, fecha_inicio, estado, responsable_id, coordinador_id, lider_id, created_by)
     VALUES (?, 'reunion', DATE_ADD(NOW(), INTERVAL 5 DAY), 'programado', ?, ?, ?, (SELECT id FROM usuarios ORDER BY id LIMIT 1))`,
    [titulo, responsable || null, coordinador || null, lider || null]);
}
const sumaTend = (d) => (d || []).reduce((a, f) => a + f.total, 0);

(async () => {
  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  // ============================================================== el terreno
  await pool.query('DELETE FROM votantes');
  await pool.query('DELETE FROM eventos');
  await pool.query('DELETE FROM monitoreo_menciones');
  await pool.query('DELETE FROM finanzas_movimientos');
  await pool.query("DELETE FROM estructura WHERE usuario_id IN (SELECT id FROM usuarios WHERE numero_identificacion LIKE '8300000%')");
  await pool.query("DELETE FROM usuarios WHERE numero_identificacion LIKE '8300000%'");

  const admin = await usuario('Admin Prueba', 'admin');
  const cA = await usuario('Coordinador A', 'coordinador');
  const cB = await usuario('Coordinador B', 'coordinador');
  const lA = await usuario('Lider de A', 'lider');
  const lA2 = await usuario('Lider de A dos', 'lider');
  const lB = await usuario('Lider de B', 'lider');
  const sA = await usuario('Sublider de A', 'sublider');
  const asistente = await usuario('Asistente Admin', 'asistente_administrativo');
  await estructura(cA.id, 'coordinador', null, 0);
  await estructura(cB.id, 'coordinador', null, 0);
  await estructura(lA.id, 'lider', cA.id, 100);
  await estructura(lA2.id, 'lider', cA.id, 50);
  await estructura(lB.id, 'lider', cB.id, 400);
  await estructura(sA.id, 'usuario', lA.id, 30);

  // Votantes: de A -> 3 de lA, 2 de lA registrados por el sublíder sA (llevan lider_id=lA y sublider_id=sA), 1 de lA2; de B -> 4 de lB; 1 de nadie.
  for (let i = 0; i < 3; i++) await ficha(lA.id, null, i);
  for (let i = 0; i < 2; i++) await ficha(lA.id, sA.id, 1);
  await ficha(lA2.id, null, 2);
  for (let i = 0; i < 4; i++) await ficha(lB.id, null, 3);
  await ficha(null, null, 4);
  const TOTAL = 11, DE_A = 6, DE_LA = 5, DE_LA2 = 1, DE_SA = 2, DE_B = 4;

  await evento('Evento de A', { coordinador: cA.id });
  await evento('Evento del lider A', { lider: lA.id });
  await evento('Evento de B', { responsable: cB.id });
  await evento('Evento sin nadie');
  await pool.query("INSERT INTO monitoreo_menciones (fuente, texto, sentimiento) VALUES ('red', 'una mencion', 'positivo')");
  await pool.query("INSERT INTO finanzas_movimientos (categoria_id, tipo, monto, fecha, registrado_por) VALUES ((SELECT id FROM finanzas_categorias LIMIT 1), 'ingreso', 1000, CURDATE(), ?)", [admin.id]);

  // ============================================================== administrador
  console.log('\n== Administrador: toda la campaña (sin cambios)');
  const rAd = await pedir('/api/dashboard/resumen', admin);
  ok(rAd.status === 200, '/resumen responde 200', rAd.texto.slice(0, 200));
  const d = rAd.datos || {};
  ok(d.votantes && d.votantes.total === TOTAL, `votantes: ${TOTAL}`, d.votantes);
  ok(d.estructura && d.estructura.coordinadores === 2 && d.estructura.lideres === 3, 'estructura: 2 coordinadores y 3 líderes', d.estructura);
  ok(d.metaVotosLideres === 550, 'meta de los líderes: 550', d.metaVotosLideres);
  ok(d.eventos && d.proximosEventos.length === 4, 'los 4 eventos', d.proximosEventos && d.proximosEventos.length);
  ok(Array.isArray(d.menciones) && d.menciones.length === 1, 'las menciones', d.menciones);
  ok(d.finanzas && d.finanzas.ingresos === 1000, 'finanzas: ve el ingreso', d.finanzas);
  const tAd = await pedir('/api/dashboard/tendencia-registros', admin);
  ok(sumaTend(tAd.datos) === TOTAL, `tendencia: ${TOTAL}`, tAd.datos);

  // ============================================================== coordinador
  console.log('\n== Coordinador A: él, sus líderes y los sublíderes de éstos');
  const rA = await pedir('/api/dashboard/resumen', cA);
  const a = rA.datos || {};
  ok(rA.status === 200 && a.votantes.total === DE_A, `votantes: ${DE_A} (no ${TOTAL})`, [rA.status, a.votantes]);
  ok(a.estructura.coordinadores === 1 && a.estructura.lideres === 2, 'estructura: él y sus 2 líderes (no el coordinador B ni su líder)', a.estructura);
  ok(a.metaVotosLideres === 150, 'meta de los líderes: 150 (100 + 50), no 550', a.metaVotosLideres);
  ok(a.avanceRegistrosLideres === DE_A, `avance de registros: ${DE_A}`, a.avanceRegistrosLideres);
  ok(a.proximosEventos.length === 2 && a.proximosEventos.every(e => /A$/.test(e.titulo) || /lider A/.test(e.titulo)), 'eventos: los 2 donde él o su líder figuran; no el de B ni el que no tiene a nadie', a.proximosEventos.map(e => e.titulo));
  ok(a.eventos.proximos === 2, 'contador de eventos próximos: 2', a.eventos);
  ok(Array.isArray(a.menciones) && a.menciones.length === 0, 'menciones: ninguna (no se pueden acotar; sólo el administrador)', a.menciones);
  ok(a.finanzas && a.finanzas.ingresos === 1000, 'finanzas: SÍ ve (coordinador, como en el parche 268)', a.finanzas);
  const tA = await pedir('/api/dashboard/tendencia-registros', cA);
  ok(sumaTend(tA.datos) === DE_A, `tendencia (A): ${DE_A}`, tA.datos);
  const rB = await pedir('/api/dashboard/resumen', cB);
  ok(rB.datos.votantes.total === DE_B && rB.datos.metaVotosLideres === 400 && rB.datos.proximosEventos.length === 1, 'Coordinador B: 4 votantes, meta 400, 1 evento', [rB.datos.votantes, rB.datos.metaVotosLideres]);

  // ============================================================== líder y sublíder
  console.log('\n== Líder: lo suyo y lo de su equipo');
  const rL = await pedir('/api/dashboard/resumen', lA);
  const l = rL.datos || {};
  ok(rL.status === 200 && l.votantes.total === DE_LA, `votantes: ${DE_LA} (los suyos y los de su sublíder), no ${TOTAL}`, [rL.status, l.votantes]);
  ok(l.estructura.coordinadores === 0 && l.estructura.lideres === 1, 'estructura: él (1 líder); ningún coordinador', l.estructura);
  ok(l.metaVotosLideres === 100, 'meta de los líderes: la suya (100)', l.metaVotosLideres);
  ok(l.proximosEventos.length === 1 && l.proximosEventos[0].titulo === 'Evento del lider A', 'eventos: sólo el suyo', l.proximosEventos.map(e => e.titulo));
  ok(Array.isArray(l.menciones) && l.menciones.length === 0, 'menciones: ninguna', l.menciones);
  ok(!('finanzas' in l), 'FINANZAS OCULTAS: la clave `finanzas` no viaja en el JSON', Object.keys(l));
  ok(!rL.texto.includes('1000'), 'y el monto no aparece en ninguna parte de la respuesta');
  const tL = await pedir('/api/dashboard/tendencia-registros', lA);
  ok(sumaTend(tL.datos) === DE_LA, `tendencia (líder): ${DE_LA}`, tL.datos);
  const rL2 = await pedir('/api/dashboard/resumen', lA2);
  ok(rL2.datos.votantes.total === DE_LA2 && !('finanzas' in rL2.datos), 'otro líder: sólo su 1 votante, sin finanzas', rL2.datos.votantes);
  const rLB = await pedir('/api/dashboard/resumen', lB);
  ok(rLB.datos.votantes.total === DE_B, 'el líder de B: sus 4', rLB.datos.votantes);

  console.log('\n== Sublíder: lo suyo');
  const rS = await pedir('/api/dashboard/resumen', sA);
  ok(rS.status === 200 && rS.datos.votantes.total === DE_SA, `votantes: ${DE_SA} (los que él registró)`, [rS.status, rS.datos && rS.datos.votantes]);
  ok(!('finanzas' in rS.datos) && rS.datos.menciones.length === 0 && rS.datos.proximosEventos.length === 0, 'sin finanzas, sin menciones y sin eventos de otros', Object.keys(rS.datos));
  const tS = await pedir('/api/dashboard/tendencia-registros', sA);
  ok(sumaTend(tS.datos) === DE_SA, `tendencia (sublíder): ${DE_SA}`, tS.datos);

  // ============================================================== otros roles
  console.log('\n== Otros roles (sin cambios, por no estar en la orden)');
  const rAsis = await pedir('/api/dashboard/resumen', asistente);
  ok(rAsis.status === 200 && rAsis.datos.votantes.total === TOTAL && !('finanzas' in rAsis.datos), 'asistente administrativo: sigue viendo la campaña entera, y sin finanzas', [rAsis.status, rAsis.datos && rAsis.datos.votantes]);

  // ============================================================== aspirante (lo que ya había)
  console.log('\n== Aspirante: su rama (no cambia)');
  sublicencia = { usuario_id: lA.id, cargo: 'concejo' };
  const rAsp = await pedir('/api/dashboard/resumen', lA, true);
  ok(rAsp.status === 200 && rAsp.datos.eventos.proximos === 0 && rAsp.datos.proximosEventos.length === 0 && rAsp.datos.menciones.length === 0,
    'sin eventos ni menciones de la madre, como antes', [rAsp.status, rAsp.datos && rAsp.datos.eventos]);
  ok(rAsp.datos.finanzas && rAsp.datos.finanzas.ingresos === 0, 'finanzas del aspirante en cero (no ve el dinero de la madre), como antes', rAsp.datos.finanzas);
  ok(rAsp.datos.estructura.lideres === 1 || rAsp.datos.estructura.lideres === 0, 'la estructura es la de su rama, sin él', rAsp.datos.estructura);

  servidor.close();
  await pool.end();
  console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})().catch(async (e) => { console.error('ERROR DE LA PRUEBA:', e); try { await pool.end(); } catch (_) { /* ya cerrado */ } process.exit(1); });
