#!/usr/bin/env node
// scripts/probar-esperados-127.js
//
// Prueba de la orden 127: «ESPERADOS VS. OFICIAL» (GET /api/dia-d/resultados/esperados y /esperados/excel).
//   · el caso de 3 puestos / 6 mesas / 4 líderes + «Sin líder» + uno que registró el equipo, con un puesto que SOLO cruza por
//     `ctc_puesto_id`, uno fuera de lista, 2 votantes sin mesa, una mesa con oficial y nadie inscrito y una mesa sin oficial;
//   · Σ del estimado por líder = V_m en cada mesa; el consolidado ignora las mesas sin oficial; un líder > 100 % no se topa;
//   · la fuente por omisión, el aviso de candidato no encontrado, el aviso de «sin oficial»;
//   · el coordinador ve solo a sus líderes y el estimado de cada uno es el mismo que ve el administrador;
//   · líder, sublíder y testigo reciben 403; el aspirante ve solo su campaña (sublicencia simulada);
//   · el Excel trae tres hojas;
//   · VOLUMEN: 20.000 votantes y 500 mesas, con el tiempo de la consulta.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada127 node scripts/probar-esperados-127.js
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

const http = require('http');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { csrfToken, csrfProtegido } = require('../middleware/csrf');
const { crearResolutorDePuestos } = require('../lib/puestosDiaD');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); }
}
const cerca = (a, b, tol = 0.01) => typeof a === 'number' && Math.abs(a - b) <= tol;
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }

function construir() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(session({ key: 'campana_sid', secret: process.env.SESSION_SECRET, store: new MySQLStore({}, pool), resave: false, saveUninitialized: false,
    cookie: { maxAge: 8 * 3600 * 1000, httpOnly: true, secure: false, sameSite: 'lax' } }));
  app.use(csrfToken);
  app.get('/api/csrf-token', (req, res) => res.json({ csrfToken: req.session.csrfToken }));
  app.use('/api', csrfProtegido);
  // Una sublicencia SIMULADA para probar al aspirante sin montar todo el panel: la trae el encabezado de la prueba.
  app.use((req, res, next) => {
    if (req.headers['x-prueba-aspirante']) req.sublicencia = { usuario_id: Number(req.headers['x-prueba-aspirante']), cargo: 'concejo' };
    next();
  });
  app.use('/api/auth', require('../routes/auth.routes'));
  app.use('/api/dia-d/resultados', require('../routes/resultadosDiaD.routes'));
  return app;
}

let base = '';
let ipN = 0;
function cliente() {
  const c = { cookie: '', csrf: null, aspirante: null };
  const ip = `198.51.100.${(ipN++ % 200) + 20}`;
  c.pedir = async (metodo, ruta, { json, binario } = {}) => {
    const h = { 'X-Forwarded-For': ip };
    if (c.cookie) h.Cookie = c.cookie;
    if (c.aspirante) h['X-Prueba-Aspirante'] = String(c.aspirante);
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
    if (binario) return { status: r.status, buffer: Buffer.from(await r.arrayBuffer()) };
    const texto = await r.text();
    let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
    return { status: r.status, datos, texto, bytes: texto.length };
  };
  return c;
}

let n = 0;
const sello = String(Date.now()).slice(-6);
async function usuario(nombre, rol, extra = {}) {
  n++;
  const cedula = `96${sello}${n}`;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, cedula, cedula, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  const u = { id: r.insertId, rol, nombre, cedula };
  if (extra.estructura) {
    await pool.query(`INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, ?, 1)`, [u.id, extra.estructura, extra.supervisor || null]);
  }
  return u;
}
async function entrar(u) {
  const c = cliente();
  const r = await c.pedir('POST', '/auth/login', { json: { email: u.cedula, password: 'clave-ejemplo', recordar: false } });
  c.login = r;
  return c;
}

/** Inserta `cuantos` votantes de una combinación y marca `ya` de ellos como «ya votó». */
let nVot = 0;
async function votantes({ lider, texto, mesa, puestoId = null, ctc = null, rama = null }, cuantos, ya = 0) {
  const ids = [];
  for (let i = 0; i < cuantos; i++) {
    nVot++;
    const [r] = await pool.query(
      `INSERT INTO votantes (nombre, cedula, lider_id, puesto_votacion, mesa_votacion, puesto_id, ctc_puesto_id, rama_aspirante_id, categoria)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'votante')`,
      [`Votante ${nVot}`, `7${sello}${nVot}`, lider, texto, mesa, puestoId, ctc, rama]);
    ids.push(r.insertId);
  }
  for (const id of ids.slice(0, ya)) {
    await pool.query(`INSERT INTO votante_votos (votante_id, voto_en, origen, puesto_id) VALUES (?, NOW(), 'equipo', ?)`, [id, puestoId]);
  }
}
async function oficial(aspirante, puestoId, texto, mesa, candidato, votos, fuente) {
  await pool.query(
    `INSERT INTO dia_d_resultado_oficial (aspirante_id, puesto_id, puesto_texto, mesa, candidato_nombre, grupo, votos, fuente) VALUES (?, ?, ?, ?, ?, 'candidato', ?, ?)`,
    [aspirante, puestoId, texto, mesa, candidato, votos, fuente]);
}

const PROPIO = 'Candidata Propia';
const porLider = (r, id) => r.lideres.find((l) => l.id === id);

(async () => {
  const servidor = http.createServer(construir());
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  console.log('ESPERADOS VS. OFICIAL (orden 127) — base «' + nombreBase + '»');

  // Los disparadores derivan puesto_id del texto y taparían justo lo que se prueba (el cruce por ctc_puesto_id): se quitan
  // en la base desechable. En una base real, el caso es un votante cuyo puesto_id es de OTRA campaña o está vacío.
  for (const t of ['trg_votantes_puesto_id_ins', 'trg_votantes_puesto_id_upd']) await q(`DROP TRIGGER IF EXISTS ${t}`);
  await q(`UPDATE complementos_campana SET activo = 1 WHERE clave IN ('resultados_dia_d')`);
  require('../lib/complementos').invalidar();
  await q('INSERT INTO configuracion_campana (id, nombre_candidato) VALUES (1, ?) ON DUPLICATE KEY UPDATE nombre_candidato = VALUES(nombre_candidato)', [PROPIO]);

  // ---------------------------------------------------------------------------------- el equipo
  const admin = await usuario('Admin Esperados', 'admin');
  const c1 = await usuario('Coordinador Uno', 'coordinador', { estructura: 'coordinador' });
  const c2 = await usuario('Coordinador Dos', 'coordinador', { estructura: 'coordinador' });
  const l1 = await usuario('Lider Uno', 'lider', { estructura: 'lider', supervisor: c1.id });
  const l2 = await usuario('Lider Dos', 'lider', { estructura: 'lider', supervisor: c1.id });
  const l3 = await usuario('Lider Tres', 'lider', { estructura: 'lider', supervisor: c2.id });
  const l4 = await usuario('Lider Cuatro', 'lider', { estructura: 'lider', supervisor: c2.id });
  const subl = await usuario('Sublider Esperados', 'sublider', { estructura: 'usuario', supervisor: l1.id });
  const test = await usuario('Testigo Esperados', 'testigo');

  // ---------------------------------------------------------------------------------- los puestos
  const [pa] = await pool.query(`INSERT INTO dia_d_puestos_votacion (aspirante_id, nombre, cantidad_mesas, ctc_puesto_id) VALUES (0, 'COLEGIO A', 3, 9001)`);
  const [pb] = await pool.query(`INSERT INTO dia_d_puestos_votacion (aspirante_id, nombre, cantidad_mesas, ctc_puesto_id) VALUES (0, 'ESCUELA B (SALAMINA)', 3, 9002)`);
  const A = pa.insertId, B = pb.insertId;

  // ---------------------------------------------------------------------------------- los votantes (n, ya votó)
  const ci = (id) => ({ lider: id });
  // COLEGIO A: unos por id, otros solo por texto exacto
  await votantes({ ...ci(l1.id), texto: 'COLEGIO A', mesa: 1, puestoId: A }, 30, 12);
  await votantes({ ...ci(l2.id), texto: 'COLEGIO A', mesa: 1, puestoId: A }, 10, 2);
  await votantes({ ...ci(l1.id), texto: 'COLEGIO A', mesa: 2, puestoId: A }, 10, 5);
  await votantes({ ...ci(l3.id), texto: 'colegio  a', mesa: 2 }, 20, 10);            // solo por texto normalizado
  await votantes({ ...ci(l1.id), texto: 'COLEGIO A', mesa: 3 }, 5, 0);               // mesa 3, sin oficial
  await votantes({ ...ci(l1.id), texto: 'COLEGIO A', mesa: null }, 1, 0);            // sin mesa (vacía)
  await votantes({ ...ci(l2.id), texto: 'COLEGIO A', mesa: 99 }, 1, 0);              // sin mesa (mayor que las del puesto)
  // ESCUELA B (SALAMINA): el texto NO lleva el sufijo y el puesto_id no es de la campaña: solo cruza por ctc_puesto_id
  const porCtc = { texto: 'ESCUELA B', puestoId: 999999, ctc: 9002 };
  await votantes({ ...ci(l3.id), ...porCtc, mesa: 1 }, 6, 0);
  await votantes({ ...ci(l4.id), ...porCtc, mesa: 1 }, 3, 0);
  await votantes({ ...ci(null), ...porCtc, mesa: 1 }, 3, 0);                          // «Sin líder»
  await votantes({ ...ci(admin.id), ...porCtc, mesa: 1 }, 2, 0);                      // lo registró el equipo
  await votantes({ ...ci(l4.id), ...porCtc, mesa: 3 }, 4, 1);
  // Fuera de lista
  await votantes({ ...ci(l2.id), texto: 'COLEGIO LEJANO', mesa: 1 }, 3, 1);

  // ---------------------------------------------------------------------------------- el oficial (preconteo)
  const RIVAL = 'Rival Uno';
  await oficial(0, A, 'COLEGIO A', 1, PROPIO, 40, 'preconteo');   await oficial(0, A, 'COLEGIO A', 1, RIVAL, 7, 'preconteo');
  await oficial(0, A, 'COLEGIO A', 2, PROPIO, 12, 'preconteo');
  await oficial(0, A, 'COLEGIO A', 3, RIVAL, 100, 'preconteo');   // A3: hay oficial de OTRO candidato y ninguno del propio → no cuenta
  await oficial(0, B, 'ESCUELA B (SALAMINA)', 1, PROPIO, 14, 'preconteo');
  await oficial(0, B, 'ESCUELA B (SALAMINA)', 2, PROPIO, 50, 'preconteo');   // B2: voto oficial y NADIE inscrito
  await oficial(0, B, 'ESCUELA B (SALAMINA)', 3, PROPIO, 8, 'preconteo');

  const cAdmin = await entrar(admin);
  ok(cAdmin.login.status === 200, 'el administrador de prueba entra', cAdmin.login.texto);

  // ==================================================================================== 0. EL RESOLUTOR
  console.log('\n0. El resolutor: el respaldo por ctc_puesto_id es OPCIONAL');
  const lista = [{ id: A, nombre: 'COLEGIO A', cantidad_mesas: 3, ctc_puesto_id: 9001 }, { id: B, nombre: 'ESCUELA B (SALAMINA)', cantidad_mesas: 3, ctc_puesto_id: 9002 }];
  const fila = { puesto_id: 999999, puesto_votacion: 'ESCUELA B', ctc_puesto_id: 9002 };
  ok(crearResolutorDePuestos(lista)(fila).fuera === true, 'sin la opción, ese votante queda fuera de lista (el comportamiento de siempre no cambia)');
  const conCtc = crearResolutorDePuestos(lista, { porCtc: true })(fila);
  ok(conCtc.fuera === false && conCtc.puesto.id === B, 'con { porCtc: true } cruza con el puesto departamental', conCtc);
  ok(crearResolutorDePuestos(lista, { porCtc: true })({ puesto_id: A, puesto_votacion: 'otra cosa', ctc_puesto_id: 9002 }).puesto.id === A, 'el id de la campaña y el nombre mandan ANTES que el respaldo');

  // ==================================================================================== 1. LA FUENTE POR OMISIÓN
  console.log('\n1. Fuente por omisión');
  let r = await cAdmin.pedir('GET', '/dia-d/resultados/esperados');
  ok(r.status === 200 && r.datos.fuente === 'preconteo' && r.datos.fuente_por_omision === true, 'sin escrutinio cargado, la fuente por omisión es preconteo', r.datos && { f: r.datos.fuente, o: r.datos.fuente_por_omision, s: r.status, t: r.texto.slice(0, 200) });
  const pre = r.datos;
  ok(pre.calculado === true && pre.hay_oficial === true && pre.aviso_propio_no_encontrado === false, 'calcula, con el oficial del propio');

  // ==================================================================================== 2. LA ARITMÉTICA
  console.log('\n2. El reparto: Σ por líder = V_m');
  const V = { [`${A}|1`]: 40, [`${A}|2`]: 12, [`${B}|1`]: 14, [`${B}|3`]: 8 };
  const suma = new Map();
  for (const l of pre.lideres) for (const d of l.detalle) if (d.tiene_oficial) suma.set(`${d.puesto_id}|${d.mesa}`, (suma.get(`${d.puesto_id}|${d.mesa}`) || 0) + d.estimado);
  for (const [k, v] of Object.entries(V)) ok(cerca(suma.get(k), v, 0.01), `mesa ${k}: la suma de los estimados de los líderes = ${v}`, suma.get(k));
  ok(![...suma.keys()].some((k) => !(k in V)), 'ninguna mesa sin oficial (A3) ni sin votantes (B2) recibe reparto', [...suma.keys()]);
  ok(pre.lideres.every((l) => l.detalle.every((d) => d.tiene_oficial || d.estimado === null)), 'las mesas sin oficial quedan con estimado nulo');

  const L1 = porLider(pre, l1.id), L2 = porLider(pre, l2.id), L3 = porLider(pre, l3.id), L4 = porLider(pre, l4.id), ADM = porLider(pre, admin.id);
  const SL = pre.lideres.find((l) => l.sin_lider);
  ok(cerca(L1.estimado, 34) && L1.esperados_con_oficial === 40 && cerca(L1.consolidado, 85), 'L1: estimado 34 de 40 con oficial → 85 %', L1 && { e: L1.estimado, c: L1.consolidado, o: L1.esperados_con_oficial });
  ok(L1.esperados === 46 && L1.mesas === 3 && L1.mesas_con_oficial === 2, 'L1: 46 esperados, 3 mesas, 2 con oficial (A3 no entra en el consolidado)', L1 && { e: L1.esperados, m: L1.mesas, mo: L1.mesas_con_oficial });
  ok(L1.semaforo === 'amarillo', 'L1 (85 %) en amarillo', L1.semaforo);
  ok(cerca(L2.consolidado, 100) && L2.semaforo === 'verde', 'L2: 100 % en verde', L2 && L2.consolidado);
  ok(cerca(L3.estimado, 14) && cerca(L3.consolidado, 53.8) && L3.semaforo === 'rojo', 'L3: 14 sobre 26 → 53,8 % en rojo (la mesa por ctc cuenta)', L3 && { e: L3.estimado, c: L3.consolidado });
  ok(cerca(L4.consolidado, 157.1) && L4.supera_100 === true && L4.semaforo === 'verde', 'L4: 157,1 % — NO se topa a 100 y queda marcado supera_100', L4 && { c: L4.consolidado, s: L4.supera_100 });
  ok(ADM && ADM.registro_equipo === true && cerca(ADM.estimado, 2), 'el administrador que registró aparece con la marca registro_equipo', ADM);
  ok(SL && SL.sin_lider === true && cerca(SL.estimado, 3) && SL.nombre === 'Sin líder', 'hay un renglón «Sin líder»', SL);
  ok(L1.coordinador === 'Coordinador Uno' && L3.coordinador === 'Coordinador Dos', 'cada líder trae su coordinador', { a: L1.coordinador, b: L3.coordinador });
  ok(pre.lideres[pre.lideres.length - 1].sin_lider === true, '«Sin líder» va al final');
  ok(L1.detalle.find((d) => d.mesa === 3 && !d.tiene_oficial), 'L1 trae su mesa sin oficial en el detalle (para pintarla en gris)');

  // ==================================================================================== 3. TOTALES Y RUBROS
  console.log('\n3. Totales y rubros aparte');
  const t = pre.totales;
  ok(t.esperados === 95, 'esperados en lista = 95 (con y sin mesa; los de fuera de lista aparte)', t.esperados);
  ok(t.ya_voto === 30 && cerca(t.ya_voto_pct, 31.6), 'ya votó = 30 (A1 14 + A2 15 + B3 1; el de fuera de lista no cuenta aquí) = 31,6 %', { y: t.ya_voto, p: t.ya_voto_pct });
  ok(cerca(t.oficial, 74), 'oficial del candidato = 74 (Σ de las mesas con votantes y oficial)', t.oficial);
  ok(t.esperados_con_oficial === 40 + 30 + 14 + 4, 'esperados en mesas con oficial = 88', t.esperados_con_oficial);
  ok(cerca(t.cumplimiento, 84.1) && t.semaforo === 'amarillo', 'cumplimiento 74/88 = 84,1 %', t.cumplimiento);
  ok(cerca(t.votos_por_debajo, 14), 'votos por debajo = 14', t.votos_por_debajo);
  ok(t.sin_mesa === 2, 'sin mesa = 2 (vacía y fuera de rango)', t.sin_mesa);
  ok(cerca(t.esperados_con_mesa_pct, 97.9), 'esperados con mesa = 93/95 = 97,9 %', t.esperados_con_mesa_pct);
  ok(t.mesas_total === 5 && t.mesas_con_oficial === 4, 'mesas con votantes: 5 (A1, A2, A3, B1, B3), 4 con oficial', { m: t.mesas_total, o: t.mesas_con_oficial });
  ok(t.votos_sin_atribuir === 50, 'votos sin atribuir = 50 (B2: oficial y nadie inscrito)', t.votos_sin_atribuir);
  ok(t.fuera_de_lista === 3, 'fuera de lista = 3', t.fuera_de_lista);
  ok(pre.rubros.votos_sin_atribuir.mesas.length === 1 && pre.rubros.votos_sin_atribuir.mesas[0].mesa === 2, 'el rubro dice cuál mesa (B, mesa 2)', pre.rubros.votos_sin_atribuir);
  ok(pre.rubros.sin_mesa.total === 2 && pre.rubros.sin_mesa.puestos[0].puesto === 'COLEGIO A', 'el rubro «sin mesa» dice el puesto', pre.rubros.sin_mesa);
  ok(pre.rubros.fuera_de_lista.puestos.length === 1 && pre.rubros.fuera_de_lista.puestos[0].puesto === 'COLEGIO LEJANO', 'el rubro «fuera de lista» dice cuál', pre.rubros.fuera_de_lista);

  // ==================================================================================== 4. PUESTOS Y MESAS
  console.log('\n4. Puestos y mesas');
  const PA = pre.puestos.find((p) => p.puesto_id === A), PB = pre.puestos.find((p) => p.puesto_id === B);
  ok(PA && PB && pre.puestos.length === 2, 'dos puestos de la lista (el fuera de lista va aparte)', pre.puestos.map((p) => p.puesto));
  ok(PA.esperados === 77 && PA.sin_mesa === 2 && PA.mesas_con_votantes === 3 && PA.mesas_con_oficial === 2, 'COLEGIO A: 77 esperados (75 con mesa + 2 sin mesa), 3 mesas, 2 con oficial', PA && { e: PA.esperados, s: PA.sin_mesa });
  ok(PA.oficial === 52 && PA.diferencia === 52 - 70 && cerca(PA.cumplimiento, 74.3), 'COLEGIO A: oficial 52, diferencia −18 (contra 70 esperados en mesas con oficial), 74,3 %', PA && { o: PA.oficial, d: PA.diferencia, c: PA.cumplimiento });
  ok(PB.esperados === 18 && PB.mesas_con_votantes === 2 && PB.oficial === 22, 'ESCUELA B (SALAMINA): cruzó por ctc_puesto_id: 18 esperados en 2 mesas, oficial 22', PB && { e: PB.esperados, m: PB.mesas_con_votantes, o: PB.oficial });
  const b2 = PB.mesas.find((m) => m.mesa === 2);
  ok(b2 && b2.sin_votantes === true && b2.oficial === 50, 'la mesa B2 se ve, marcada «sin votantes», pero no suma al oficial del puesto', b2);
  const a1 = PA.mesas.find((m) => m.mesa === 1);
  ok(a1.esperados === 40 && a1.ya_voto === 14 && a1.oficial === 40 && a1.delta === 0 && a1.lideres.length === 2, 'A1: 40 esperados, 14 ya votaron, oficial 40, Δ 0, dos líderes', a1);
  ok(a1.lideres[0].nombre === 'Lider Uno' && a1.lideres[0].n === 30, 'los líderes de la mesa vienen con su cantidad, de mayor a menor', a1.lideres);
  const b1 = PB.mesas.find((m) => m.mesa === 1);
  ok(b1.lideres.some((l) => l.nombre === 'Sin líder' && l.n === 3) && b1.lideres.some((l) => l.registro_equipo && l.n === 2), 'B1 nombra a «Sin líder» y al que registró el equipo', b1.lideres);
  const a3 = PA.mesas.find((m) => m.mesa === 3);
  ok(a3.tiene_oficial === false && a3.oficial === null && a3.delta === null, 'A3: sin oficial del propio (aunque haya de otro candidato)', a3);

  // ==================================================================================== 5. FUENTE
  console.log('\n5. Escrutinio por omisión cuando existe');
  await oficial(0, A, 'COLEGIO A', 1, PROPIO, 20, 'escrutinio');
  r = await cAdmin.pedir('GET', '/dia-d/resultados/esperados');
  ok(r.datos.fuente === 'escrutinio' && r.datos.fuente_por_omision === true, 'con filas de escrutinio, la fuente por omisión es escrutinio', r.datos && r.datos.fuente);
  ok(cerca(porLider(r.datos, l1.id).estimado, 15) && cerca(porLider(r.datos, l1.id).consolidado, 50) && porLider(r.datos, l1.id).esperados_con_oficial === 30, 'y el reparto usa el escrutinio: L1 estima 15 de sus 30 votantes en la única mesa con oficial → 50 %', porLider(r.datos, l1.id));
  ok(r.datos.totales.mesas_con_oficial === 1, 'solo A1 tiene escrutinio: una mesa con oficial', r.datos.totales.mesas_con_oficial);
  r = await cAdmin.pedir('GET', '/dia-d/resultados/esperados?fuente=preconteo');
  ok(r.datos.fuente === 'preconteo' && r.datos.fuente_por_omision === false && cerca(r.datos.totales.oficial, 74), 'pidiendo preconteo se usa preconteo y la respuesta lo dice', r.datos.fuente);
  r = await cAdmin.pedir('GET', '/dia-d/resultados/esperados?fuente=cualquiera');
  ok(r.datos.fuente === 'escrutinio' && r.datos.fuente_por_omision === true, 'una fuente inventada se trata como si no viniera', r.datos.fuente);
  await q(`DELETE FROM dia_d_resultado_oficial WHERE fuente = 'escrutinio'`);

  // ==================================================================================== 6. AVISOS
  console.log('\n6. Sin oficial y candidato no encontrado');
  await q(`UPDATE configuracion_campana SET nombre_candidato = 'Otra Persona' WHERE id = 1`);
  r = await cAdmin.pedir('GET', '/dia-d/resultados/esperados');
  ok(r.datos.hay_oficial === true && r.datos.aviso_propio_no_encontrado === true && r.datos.calculado === false && r.datos.propio === 'Otra Persona', 'si el propio no está en el oficial: aviso_propio_no_encontrado con el nombre buscado y nada calculado', r.datos);
  await q(`UPDATE configuracion_campana SET nombre_candidato = ? WHERE id = 1`, [PROPIO]);
  r = await cAdmin.pedir('GET', '/dia-d/resultados/esperados?fuente=escrutinio');
  ok(r.datos.hay_oficial === false && r.datos.calculado === false && r.datos.hay_oficial_en_otra_fuente === 'preconteo', 'sin oficial en la fuente pedida: no calcula y dice que hay en la otra', r.datos);
  r = await cAdmin.pedir('GET', '/dia-d/resultados/esperados/excel?fuente=escrutinio');
  ok(r.status === 409, 'y el Excel responde 409 en vez de un libro vacío', r.status);

  // ==================================================================================== 7. EL COORDINADOR
  console.log('\n7. El coordinador ve solo a sus líderes');
  const cC1 = await entrar(c1), cC2 = await entrar(c2);
  ok(cC1.login.status === 200, 'el coordinador entra', cC1.login.texto);
  r = await cC1.pedir('GET', '/dia-d/resultados/esperados');
  const k1 = r.datos;
  ok(r.status === 200 && k1.parcial === true, 'respuesta parcial', { s: r.status, t: r.texto.slice(0, 200) });
  ok(k1.lideres.map((l) => l.nombre).sort().join() === 'Lider Dos,Lider Uno', 'solo L1 y L2 (ni los de otro coordinador, ni «Sin líder», ni el que registró el equipo)', k1.lideres.map((l) => l.nombre));
  for (const [x, y] of [[l1.id, 'L1'], [l2.id, 'L2']]) {
    const a = porLider(pre, x), b = porLider(k1, x);
    ok(cerca(a.estimado, b.estimado, 0.0005) && a.esperados === b.esperados && a.consolidado === b.consolidado, `${y}: el estimado es EL MISMO que ve el administrador (el denominador incluye a todos)`, { admin: a.estimado, coord: b.estimado });
  }
  ok(k1.totales.esperados === 57 && cerca(k1.totales.oficial, 44) && k1.totales.esperados_con_oficial === 50 && cerca(k1.totales.cumplimiento, 88), 'los totales se calculan sobre sus líderes: 57 esperados, 44 oficial, 88 %', k1.totales);
  ok(k1.totales.votos_sin_atribuir === null && k1.rubros.votos_sin_atribuir === null, 'los votos sin atribuir (mesas sin inscritos) no se le muestran', k1.totales.votos_sin_atribuir);
  ok(k1.puestos.length === 1 && k1.puestos[0].puesto_id === A, 'solo el puesto donde tiene votantes (ESCUELA B ni aparece)', k1.puestos.map((p) => p.puesto));
  const ka2 = k1.puestos[0].mesas.find((m) => m.mesa === 2);
  ok(ka2.esperados === 30 && ka2.otros_lideres_n === 20 && ka2.lideres.length === 1 && ka2.lideres[0].nombre === 'Lider Uno', 'en A2, los de otro coordinador salen agregados: «Otros líderes (20 votantes)»; el esperado de la mesa es el de TODOS (30)', ka2);
  ok(k1.rubros.fuera_de_lista.total === 3 && k1.totales.sin_mesa === 2, 'sus fuera de lista (3) y sus sin mesa (2)', { f: k1.rubros.fuera_de_lista.total, s: k1.totales.sin_mesa });
  ok(JSON.stringify(k1).indexOf('Lider Tres') === -1 && JSON.stringify(k1).indexOf('Lider Cuatro') === -1 && JSON.stringify(k1).indexOf('Admin Esperados') === -1, 'el nombre de los líderes ajenos no viaja en la respuesta');
  r = await cC2.pedir('GET', '/dia-d/resultados/esperados');
  const k2 = r.datos;
  const kb1 = k2.puestos.find((p) => p.puesto_id === B).mesas.find((m) => m.mesa === 1);
  ok(k2.lideres.map((l) => l.nombre).sort().join() === 'Lider Cuatro,Lider Tres' && kb1.otros_lideres_n === 5, 'el otro coordinador ve a L3 y L4, y en B1 los 5 restantes (Sin líder y el equipo) como «otros»', { l: k2.lideres.map((l) => l.nombre), o: kb1.otros_lideres_n });
  ok(cerca(porLider(k2, l3.id).estimado, porLider(pre, l3.id).estimado, 0.0005), 'y L3 sigue con el mismo estimado', porLider(k2, l3.id).estimado);

  // ==================================================================================== 8. 403
  console.log('\n8. Sin el módulo, 403');
  for (const [u, etiqueta] of [[l1, 'líder'], [subl, 'sublíder'], [test, 'testigo']]) {
    const c = await entrar(u);
    const a = await c.pedir('GET', '/dia-d/resultados/esperados');
    const b = await c.pedir('GET', '/dia-d/resultados/esperados/excel');
    ok(a.status === 403 && b.status === 403, `${etiqueta}: 403 en /esperados y en /esperados/excel`, { a: a.status, b: b.status, login: c.login.status });
  }
  const anon = cliente();
  r = await anon.pedir('GET', '/dia-d/resultados/esperados');
  ok(r.status === 401, 'sin sesión: 401', r.status);

  // ==================================================================================== 9. EXCEL
  console.log('\n9. Excel');
  r = await cAdmin.pedir('GET', '/dia-d/resultados/esperados/excel?fuente=preconteo', { binario: true });
  ok(r.status === 200, 'descarga', r.status);
  const libro = XLSX.read(r.buffer, { type: 'buffer' });
  ok(libro.SheetNames.join() === 'Líderes,Puestos,Mesas', 'tres hojas: Líderes, Puestos, Mesas', libro.SheetNames);
  const hoja = (nombre) => XLSX.utils.sheet_to_json(libro.Sheets[nombre], { header: 1 });
  ok(hoja('Líderes').length === 1 + pre.lideres.length, 'Líderes: una fila por líder (con «Sin líder»)', hoja('Líderes').length);
  ok(hoja('Puestos').length === 1 + 2, 'Puestos: los dos de la lista', hoja('Puestos').length);
  const mesasX = hoja('Mesas');
  ok(mesasX.length === 1 + PA.mesas.length + PB.mesas.length, 'Mesas: una fila por mesa', mesasX.length);
  const fa1 = mesasX.find((f) => f[1] === 'COLEGIO A' && f[2] === 1);
  ok(fa1 && /Lider Uno \(30\)/.test(fa1[8]) && /Lider Dos \(10\)/.test(fa1[8]), 'la columna de líderes dice «Nombre (n)»', fa1 && fa1[8]);
  r = await cAdmin.pedir('GET', '/dia-d/resultados/esperados/excel?fuente=preconteo&municipio=Sin%20municipio', { binario: true });
  ok(XLSX.read(r.buffer, { type: 'buffer' }).SheetNames.length === 3 && XLSX.utils.sheet_to_json(XLSX.read(r.buffer, { type: 'buffer' }).Sheets['Puestos'], { header: 1 }).length === 3, 'con ?municipio=Sin municipio salen los dos puestos (sin catálogo todos caen ahí)');
  r = await cAdmin.pedir('GET', '/dia-d/resultados/esperados?fuente=preconteo&municipio=Manizales');
  ok(r.datos.puestos.length === 0 && r.datos.lideres.length === pre.lideres.length, 'el filtro de municipio recorta los PUESTOS, no el resumen de líderes (el reparto no depende del municipio)', { p: r.datos.puestos.length, l: r.datos.lideres.length });
  r = await cC1.pedir('GET', '/dia-d/resultados/esperados/excel?fuente=preconteo', { binario: true });
  const lx = XLSX.utils.sheet_to_json(XLSX.read(r.buffer, { type: 'buffer' }).Sheets['Líderes'], { header: 1 });
  ok(lx.length === 3 && !JSON.stringify(lx).includes('Lider Tres'), 'el Excel del coordinador trae solo a sus líderes', lx.length);

  // ==================================================================================== 10. EL ASPIRANTE
  console.log('\n10. El aspirante (sublicencia simulada) ve solo su campaña');
  const asp = await usuario('Aspirante Prueba', 'aspirante_concejo');
  const la = await usuario('Lider Del Aspirante', 'lider', { estructura: 'lider' });
  const [pp] = await pool.query(`INSERT INTO dia_d_puestos_votacion (aspirante_id, nombre, cantidad_mesas) VALUES (?, 'PUESTO ASP', 3)`, [asp.id]);
  await votantes({ lider: la.id, texto: 'PUESTO ASP', mesa: 1, puestoId: pp.insertId, rama: asp.id }, 10, 3);
  await oficial(asp.id, pp.insertId, 'PUESTO ASP', 1, 'Aspirante Prueba', 5, 'preconteo');
  const cAsp = await entrar(admin);
  cAsp.aspirante = asp.id;
  r = await cAsp.pedir('GET', '/dia-d/resultados/esperados');
  ok(r.status === 200 && r.datos.calculado === true && r.datos.propio === 'Aspirante Prueba', 'el aspirante tiene su propio candidato y su campaña', r.datos && { s: r.status, p: r.datos.propio, t: r.texto.slice(0, 200) });
  ok(r.datos.puestos.length === 1 && r.datos.puestos[0].puesto === 'PUESTO ASP' && r.datos.lideres.length === 1 && r.datos.lideres[0].esperados === 10, 'solo su puesto y sus 10 votantes (no los 95 de la madre)', r.datos.lideres.map((l) => [l.nombre, l.esperados]));
  ok(cerca(r.datos.lideres[0].estimado, 5) && cerca(r.datos.lideres[0].consolidado, 50), 'su líder estima 5 de 10 → 50 %', r.datos.lideres[0]);
  ok(r.datos.parcial === false, 'y no es una vista parcial (ve todo lo suyo)');

  // ==================================================================================== 11. VOLUMEN
  console.log('\n11. Volumen: 20.000 votantes y 500 mesas');
  await q('DELETE FROM votante_votos'); await q('DELETE FROM dia_d_resultado_oficial'); await q('DELETE FROM votantes');
  await q('DELETE FROM dia_d_puestos_votacion');
  const nL = 40, nP = 100, nM = 5, nV = 20000;
  const lids = [];
  for (let i = 0; i < nL; i++) lids.push((await usuario(`Lider Volumen ${i + 1}`, 'lider', { estructura: 'lider', supervisor: i % 2 ? c1.id : c2.id })).id);
  const filasP = [];
  for (let i = 1; i <= nP; i++) filasP.push([0, `PUESTO V${String(i).padStart(3, '0')}`, nM, 80000 + i]);
  await q('INSERT INTO dia_d_puestos_votacion (aspirante_id, nombre, cantidad_mesas, ctc_puesto_id) VALUES ?', [filasP]);
  const puestosV = await q('SELECT id, nombre FROM dia_d_puestos_votacion ORDER BY id');
  let semilla = 12345; const azar = (m) => { semilla = (semilla + 0x6D2B79F5) | 0; let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (((t ^ (t >>> 14)) >>> 0) % m); };   // mulberry32
  const vot = [];
  for (let i = 0; i < nV; i++) {
    const p = puestosV[azar(nP)];
    vot.push([`Volumen ${i}`, `V${sello}${i}`, lids[azar(nL)], p.nombre, 1 + azar(nM), p.id]);
  }
  for (let i = 0; i < vot.length; i += 2000) await q('INSERT INTO votantes (nombre, cedula, lider_id, puesto_votacion, mesa_votacion, puesto_id) VALUES ?', [vot.slice(i, i + 2000)]);
  const ids = await q('SELECT id, puesto_id FROM votantes');
  const yaV = ids.filter((_, i) => i % 3 === 0).map((x) => [x.id, 'equipo', x.puesto_id]);
  for (let i = 0; i < yaV.length; i += 2000) await q(`INSERT INTO votante_votos (votante_id, origen, puesto_id) VALUES ?`, [yaV.slice(i, i + 2000)]);
  const ofi = [];
  for (const p of puestosV) for (let m = 1; m <= nM; m++) {
    ofi.push([0, p.id, p.nombre, m, PROPIO, 'candidato', 5 + azar(40), 'escrutinio']);
    for (let k = 1; k <= 5; k++) ofi.push([0, p.id, p.nombre, m, `Rival ${k}`, 'candidato', azar(60), 'escrutinio']);
  }
  for (let i = 0; i < ofi.length; i += 2000) await q('INSERT INTO dia_d_resultado_oficial (aspirante_id, puesto_id, puesto_texto, mesa, candidato_nombre, grupo, votos, fuente) VALUES ?', [ofi.slice(i, i + 2000)]);
  const [{ n: nGrupos }] = await q('SELECT COUNT(*) AS n FROM (SELECT 1 FROM votantes GROUP BY puesto_id, ctc_puesto_id, puesto_votacion, mesa_votacion, lider_id) g');
  console.log(`  (${nV} votantes, ${nP * nM} mesas, ${ofi.length} filas de oficial, ${nGrupos} grupos puesto-mesa-líder: el peor caso, cada líder en casi todas las mesas)`);

  const medir = async (cl, ruta) => {
    const t = [];
    let ultimo;
    for (let i = 0; i < 5; i++) { const t0 = process.hrtime.bigint(); ultimo = await cl.pedir('GET', ruta); t.push(Number(process.hrtime.bigint() - t0) / 1e6); }
    t.sort((a, b) => a - b);
    return { mediana: t[2], min: t[0], max: t[4], respuesta: ultimo };
  };
  const mA = await medir(cAdmin, '/dia-d/resultados/esperados');
  const dv = mA.respuesta.datos;
  ok(mA.respuesta.status === 200 && dv.calculado === true, 'responde con 20.000 votantes', mA.respuesta.status);
  ok(dv.totales.esperados === nV, `los ${nV} votantes están contados`, dv.totales.esperados);
  const sumaV = new Map();
  for (const l of dv.lideres) for (const d of l.detalle) if (d.tiene_oficial) sumaV.set(`${d.puesto_id}|${d.mesa}`, (sumaV.get(`${d.puesto_id}|${d.mesa}`) || 0) + d.estimado);
  const vReal = new Map((await q(`SELECT puesto_id, mesa, votos FROM dia_d_resultado_oficial WHERE candidato_nombre = ?`, [PROPIO])).map((x) => [`${x.puesto_id}|${x.mesa}`, Number(x.votos)]));
  let peor = 0; for (const [k, v] of vReal) peor = Math.max(peor, Math.abs((sumaV.get(k) || 0) - v));
  ok(sumaV.size === nP * nM && peor < 0.05, `en las ${nP * nM} mesas, Σ estimado por líder = V_m (diferencia máxima ${peor.toFixed(4)})`, { mesas: sumaV.size, peor });
  console.log(`  TIEMPO administrador /esperados: mediana ${mA.mediana.toFixed(0)} ms (mín ${mA.min.toFixed(0)}, máx ${mA.max.toFixed(0)}), respuesta ${(mA.respuesta.bytes / 1024).toFixed(0)} KB`);
  const mC = await medir(cC1, '/dia-d/resultados/esperados');
  console.log(`  TIEMPO coordinador   /esperados: mediana ${mC.mediana.toFixed(0)} ms (mín ${mC.min.toFixed(0)}, máx ${mC.max.toFixed(0)}), respuesta ${(mC.respuesta.bytes / 1024).toFixed(0)} KB`);
  const t0 = process.hrtime.bigint();
  const ex = await cAdmin.pedir('GET', '/dia-d/resultados/esperados/excel?fuente=escrutinio', { binario: true });
  console.log(`  TIEMPO Excel (3 hojas): ${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0)} ms, ${(ex.buffer.length / 1024).toFixed(0)} KB`);
  ok(ex.status === 200, 'el Excel de 500 mesas se genera', ex.status);
  ok(mA.mediana < 2000, 'la consulta del administrador tarda menos de 2 s', mA.mediana);

  servidor.close();
  await pool.end();
  console.log(fallos ? `\n${fallos} PRUEBA(S) FALLARON` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
