#!/usr/bin/env node
// scripts/probar-puerta-fases-3-4.js
//
// Prueba del PUERTA A PUERTA, Fases 3 y 4 (parche 312), del lado del servidor y en un Chromium real:
//   FASE 3 — el guion
//     · por defecto NEUTRO (sin voto, elección, cargo, candidato, partido ni apoyo, ni con el nombre del candidato en la configuración);
//     · editable SOLO por el administrador, de 3 a 5 pasos, cada cambio una versión con su huella; cada visita guarda la HUELLA, nunca el texto;
//     · precampaña (`revisarPrecampana`): al guardar no se guarda; al mostrar, una versión vieja con palabras prohibidas se cambia por la de por defecto;
//     · en el celular: «Ver guion» plegado arriba de cada puerta, y sin señal se usa la copia guardada con la lista (y la huella de esa copia);
//     · «Alguien quiere registrarse»: «Mostrar código QR» con el enlace de inscripción del visitante, y solo si lo tiene.
//   FASE 4 — el panel
//     · lista CERRADA de columnas del panel y del Excel; solo conteos (ni nombres de votantes ni direcciones);
//     · mínimo por celda y «Otras zonas» (sin dejar restar); alcance del coordinador; filtro por fechas y franja; permisos;
//   MAPA — dos pines casi encima se separan al dibujarlos, sin cambiar las coordenadas guardadas.
//
// USO (sobre una base desechable ya inicializada con init-db; hace falta Chromium, ver scripts/capturas/navegador.js):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada312 node scripts/probar-puerta-fases-3-4.js
//
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) {
  console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`);
  process.exit(2);
}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
delete process.env.MAPBOX_ACCESS_TOKEN;
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const pool = require('../config/db');
const R = require('../public/js/puerta-reglas');
const G = require('../lib/puertaGuion');
const Panel = require('../lib/puertaPanel');
const Reglas = require('../lib/encuestasReglas');
const { lanzar, espera } = require('./capturas/navegador');
const { crear } = require('./capturas/servidor');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }
const uuid = () => crypto.randomUUID();
const leer = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const mismo = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hoyCol = () => R.colombiaDe(new Date()).fecha;
const inst = (dias, hhmm) => new Date(`${R.sumarDias(hoyCol(), -dias)}T${hhmm}:00-05:00`).toISOString();
const fechaSql = async (expr) => String((await q(`SELECT DATE_FORMAT(${expr}, '%Y-%m-%d') AS d`))[0].d);

/* ------------------------------------------------------------------------------------------------------ el servidor de la API */
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use((req, res, next) => {
  const u = req.headers['x-test-user'];
  req.session = { usuario: u ? JSON.parse(u) : undefined };
  req.sublicencia = null;
  next();
});
app.use('/api/puerta-a-puerta', require('../routes/puertaAPuerta.routes'));
let base = '';
async function pedir(metodo, ruta, { json, usuario, binario } = {}) {
  const h = { 'X-Forwarded-For': '198.51.100.9', 'User-Agent': 'prueba/1.0' };
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  const r = await fetch(base + '/api/puerta-a-puerta' + ruta, { method: metodo, headers: h, body });
  if (binario) return { status: r.status, buffer: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') || '', disp: r.headers.get('content-disposition') || '' };
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
  return { status: r.status, datos, texto };
}

const sello = String(Date.now()).slice(-7);
let n = 0, nv = 0;
async function usuario(nombre, rol) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, `92${sello}${n}`, `u92${sello}${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  return { id: r.insertId, rol, nombre };
}
async function estructura(u, cargo, supervisor) {
  await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, ?, 1)', [u.id, cargo, supervisor ? supervisor.id : null]);
}
async function permisos(rol, modulo, ver, editar, agregar, imp) {
  await pool.query(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar, importar_exportar) VALUES (?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE permitido = VALUES(permitido), editar = VALUES(editar), agregar = VALUES(agregar), importar_exportar = VALUES(importar_exportar)`, [rol, modulo, ver, editar, agregar, imp || 0]);
}
async function territorio(tipo, nombre, padre) {
  const [r] = await pool.query('INSERT INTO territorios (tipo, nombre, padre_id) VALUES (?, ?, ?)', [tipo, nombre, padre ? padre.id : null]);
  return { id: r.insertId, nombre };
}
async function votante(o) {
  nv++;
  const [r] = await pool.query(
    `INSERT INTO votantes (nombre, cedula, telefono, email, direccion, latitud, longitud, territorio_id, lider_id, consentimiento_autorizado, no_visitar, apoya_a, observaciones, categoria)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, 'OBS-SECRETA', 'votante')`,
    [`Persona P${nv} ${sello}`, `91${sello}${String(nv).padStart(3, '0')}`, `3${sello}${nv}`.slice(0, 10), `x${sello}${nv}@secreto.test`, `Calle ${nv} # 3-${nv}`,
      o.lat === undefined ? 5.07 + nv * 0.001 : o.lat, o.lon === undefined ? -75.51 - nv * 0.001 : o.lon, o.zona ? o.zona.id : null, o.lider.id, JSON.stringify(['alcaldia'])]);
  return r.insertId;
}
const config = (c) => q(`UPDATE configuracion_campana SET ${Object.keys(c).map((k) => `${k} = ?`).join(', ')} WHERE id = 1`, Object.values(c));

/**
 * Una lista armada A MANO con visitas ya hechas, para tener cifras conocidas. `puertas`: [{ zona, visitas: [{ res, fecha, franja }] }].
 * Cada puerta es un votante nuevo del líder. La lista se «creó» hace 10 días (las visitas nunca son anteriores a su lista).
 */
async function sembrar(lider, puertas, { nombre = 'Lista sembrada', hace = 10 } = {}) {
  const [l] = await pool.query(`INSERT INTO puerta_listas (nombre, asignada_a, creada_por, estado, aspirante_id, creada_en) VALUES (?, ?, ?, 'activa', 0, DATE_SUB(NOW(), INTERVAL ? DAY))`, [nombre, lider.id, lider.id, hace]);
  for (const p of puertas) {
    const vid = await votante({ lider, zona: p.zona });
    const vs = p.visitas || [];
    const ult = vs[vs.length - 1];
    const intentos = vs.filter((v) => v.res === 'no_abrio').length;
    const estado = !ult ? 'pendiente' : (ult.res === 'no_abrio' ? (intentos >= 3 ? 'agotada' : 'pendiente') : 'cerrada');
    const [it] = await pool.query('INSERT INTO puerta_items (lista_id, votante_id, estado, intentos, ultimo_resultado, ultima_fecha, ultima_franja) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [l.insertId, vid, estado, intentos, ult ? ult.res : null, ult ? ult.fecha : null, ult ? ult.franja : null]);
    for (const v of vs) {
      await pool.query('INSERT INTO puerta_visitas (cliente_uuid, item_id, lista_id, resultado, fecha, franja, territorio_id, registrada_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [uuid(), it.insertId, l.insertId, v.res, v.fecha, v.franja, p.zona ? p.zona.id : null, lider.id]);
    }
  }
  return l.insertId;
}

(async () => {
  // Activar complementos (parche 318): los complementos nacen APAGADOS; esta prueba enciende los que necesita.
  await require('./fixtures/encender-complementos')(pool, ['puerta_a_puerta', 'puerta_panel']);
  let servidor, servidorWeb, navegador;
  try {
    servidor = http.createServer(app);
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${servidor.address().port}`;
    await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
    await config({ fecha_eleccion: null, puerta_franja_desde: '07:00', puerta_franja_hasta: '19:00', nombre_candidato: 'Ana Maria Rojas', fecha_permitida_propaganda: null, encuesta_min_celda: 5 });
    await q(`DELETE FROM permisos_rol WHERE modulo IN ('puerta_listas','puerta_visitas') AND rol <> 'admin'`);
    await permisos('coordinador', 'puerta_listas', 1, 1, 1, 0);
    await permisos('lider', 'puerta_visitas', 1, 0, 1, 0); await permisos('sublider', 'puerta_visitas', 1, 0, 1, 0);

    const admin = await usuario('Admin Fases', 'admin');
    const coord1 = await usuario('Coordinador Uno', 'coordinador'); await estructura(coord1, 'coordinador', null);
    const coord2 = await usuario('Coordinador Dos', 'coordinador'); await estructura(coord2, 'coordinador', null);
    const lid1 = await usuario('Líder Uno', 'lider'); await estructura(lid1, 'lider', coord1);
    const lid2 = await usuario('Líder Dos', 'lider'); await estructura(lid2, 'lider', coord1);
    const lid3 = await usuario('Líder Tres', 'lider'); await estructura(lid3, 'lider', coord2);
    console.log('PUERTA A PUERTA, FASES 3 Y 4 (312) — base «' + nombreBase + '»');

    /* ===================================================================================== F3-1. el guion por defecto */
    console.log('\n[1] El guion por defecto es NEUTRO');
    const defecto = G.PASOS_POR_DEFECTO;
    ok(defecto.length >= 3 && defecto.length <= 5, 'tiene de 3 a 5 pasos', defecto.length);
    ok(defecto.every((p) => p.length >= G.MIN_LARGO && p.length <= G.MAX_LARGO), 'cada paso es corto de leer');
    const cfgConCandidato = { nombre_candidato: 'Ana Maria Rojas', cargo_aspira: 'alcaldia', fecha_permitida_propaganda: null };
    for (const cfg of [cfgConCandidato, { nombre_candidato: 'Pedro Gomez Lopez', cargo_aspira: 'concejo', fecha_permitida_propaganda: null }, {}]) {
      ok(G.hallazgoDePrecampana(defecto, cfg) === null, `pasa el validador de precampaña de las encuestas (candidato «${cfg.nombre_candidato || '—'}», cargo «${cfg.cargo_aspira || '—'}»)`, G.hallazgoDePrecampana(defecto, cfg));
    }
    ok(!defecto.some((p) => /\b(vot\w*|elecci\w*|electoral\w*|cargo\w*|candidat\w*|partid\w*|apoy\w*|alcald\w*|concej\w*|campana)\b/i.test(p.normalize('NFD').replace(/[̀-ͯ]/g, ''))), 'sin voto, elección, cargo, candidato, partido ni apoyo (ni «campaña»)', defecto);
    ok(/Salude/.test(defecto[0]) && /Preséntese/.test(defecto[1]) && /necesidades/.test(defecto[2]) && /Despídase/.test(defecto[3]), 'saludo, presentación del equipo, escuchar las necesidades y despedida');
    ok(/^[0-9a-f]{16}$/.test(G.HUELLA_POR_DEFECTO) && G.huellaDe(defecto) === G.HUELLA_POR_DEFECTO, 'tiene huella (sha256 de los pasos, 16 hex)');

    /* ===================================================================================== F3-2. guardar y versionar */
    console.log('\n[2] Editar el guion: solo el administrador; de 3 a 5 pasos; una versión por cambio, con su huella');
    const g0 = await pedir('GET', '/guion', { usuario: admin });
    ok(g0.status === 200 && g0.datos.rige.por_defecto === true && g0.datos.rige.huella === G.HUELLA_POR_DEFECTO && g0.datos.guardado === null && mismo(g0.datos.por_defecto.pasos, defecto), 'sin guion propio rige el de por defecto', g0.datos);
    ok(mismo(Object.keys(g0.datos).sort(), ['guardado', 'historial', 'limites', 'por_defecto', 'rige']), 'GET /guion: claves exactas', Object.keys(g0.datos));
    ok((await pedir('GET', '/guion', { usuario: coord1 })).status === 200, 'el coordinador con el módulo lo VE');
    ok((await pedir('GET', '/guion', { usuario: lid1 })).status === 403, 'el líder (sin el módulo de armar listas) no');
    const propio = ['Salude con calma y sonría: «Buenas tardes, ¿cómo está usted?»', 'Dígale que viene del equipo con el que se registró y que pasaba a saludarle.', 'Pregunte qué necesita el barrio y escuche sin interrumpir.', 'Agradezca y despídase con respeto.'];
    ok((await pedir('PUT', '/guion', { usuario: coord1, json: { pasos: propio } })).status === 403, 'el coordinador, aunque pueda «Editar» las listas, NO cambia el guion (solo el administrador)');
    ok((await pedir('PUT', '/guion', { usuario: lid1, json: { pasos: propio } })).status === 403, 'ni el líder');
    const antes = (await q('SELECT COUNT(*) c FROM puerta_guiones'))[0].c;
    ok((await pedir('PUT', '/guion', { usuario: admin, json: { pasos: propio.slice(0, 2) } })).status === 400, 'dos pasos: 400 (van de 3 a 5)');
    ok((await pedir('PUT', '/guion', { usuario: admin, json: { pasos: [...propio, ...propio] } })).status === 400, 'ocho pasos: 400');
    ok((await pedir('PUT', '/guion', { usuario: admin, json: { pasos: [propio[0], propio[1], 'no'] } })).status === 400, 'un paso de dos letras: 400');
    ok((await pedir('PUT', '/guion', { usuario: admin, json: { pasos: [propio[0], propio[1], 'x'.repeat(G.MAX_LARGO + 1)] } })).status === 400, 'un paso larguísimo: 400 (se lee de pie, en la puerta)');
    ok((await pedir('PUT', '/guion', { usuario: admin, json: { pasos: 'texto suelto' } })).status === 400, 'que no sea una lista: 400');
    ok((await q('SELECT COUNT(*) c FROM puerta_guiones'))[0].c === antes, 'y de todo eso no se guardó nada');
    const s1 = await pedir('PUT', '/guion', { usuario: admin, json: { pasos: propio } });
    ok(s1.status === 200 && s1.datos.sin_cambio === false && s1.datos.huella === G.huellaDe(propio), 'el administrador guarda: versión nueva con la huella de sus pasos', s1.datos);
    const filas = await q('SELECT huella, pasos, creado_por FROM puerta_guiones ORDER BY id');
    ok(filas.length === antes + 1 && filas[filas.length - 1].creado_por === admin.id && mismo(typeof filas[filas.length - 1].pasos === 'string' ? JSON.parse(filas[filas.length - 1].pasos) : filas[filas.length - 1].pasos, propio), 'la versión queda con sus pasos y quién la guardó');
    const s2 = await pedir('PUT', '/guion', { usuario: admin, json: { pasos: propio.map((p) => '  ' + p + '  ') } });
    ok(s2.status === 200 && s2.datos.sin_cambio === true && (await q('SELECT COUNT(*) c FROM puerta_guiones'))[0].c === antes + 1, 'guardar lo mismo (con espacios de más) no crea una versión nueva');
    ok((await q(`SELECT COUNT(*) c FROM auditoria WHERE accion = 'puerta_guion_guardar'`))[0].c === 1, 'el cambio quedó en la auditoría (una vez)');
    const g1 = await pedir('GET', '/guion', { usuario: admin });
    ok(g1.datos.rige.por_defecto === false && g1.datos.rige.huella === G.huellaDe(propio) && g1.datos.guardado.por === 'Admin Fases' && g1.datos.historial.length === 1 && Object.keys(g1.datos.historial[0]).sort().join() === 'creado_en,huella,id,por,visitas', 'ahora rige el propio; el historial trae cuándo, quién y la huella (no el texto)', g1.datos.historial);

    /* ============================================================================================== F3-3. precampaña */
    console.log('\n[3] Precampaña: al guardar no se guarda; al mostrar, una versión vieja con palabras prohibidas se cambia por la de por defecto');
    const versiones = async () => (await q('SELECT COUNT(*) c FROM puerta_guiones'))[0].c;
    let v0 = await versiones();
    for (const [paso, palabra] of [['Pregunte por quién piensa votar en la elección y anótelo con calma.', /vot|elecci/i], ['Cuénteles de la candidata y de lo que propone para el barrio.', /candidat/i], ['Salude de parte de Rojas y preséntese con amabilidad.', /rojas/i], ['Hable del partido y pida su apoyo para la lista.', /partido|apoy/i]]) {
      const r = await pedir('PUT', '/guion', { usuario: admin, json: { pasos: [propio[0], propio[1], paso] } });
      ok(r.status === 422 && palabra.test(r.datos.error) && /El paso 3/.test(r.datos.error), `«${paso.slice(0, 28)}…»: 422, dice la palabra y el paso`, r.datos);
    }
    ok((await versiones()) === v0, 'ninguno se guardó (antes de la fecha permitida de propaganda)');
    const ayerSql = await fechaSql('DATE_SUB(CURDATE(), INTERVAL 1 DAY)'), mananaSql = await fechaSql('DATE_ADD(CURDATE(), INTERVAL 1 DAY)');
    await config({ fecha_permitida_propaganda: ayerSql });
    const conVoto = [propio[0], propio[1], 'Si le preguntan, cuénteles que usted va a votar por la lista y que lo invite a hacerlo.'];
    const sv = await pedir('PUT', '/guion', { usuario: admin, json: { pasos: conVoto } });
    ok(sv.status === 200 && (await versiones()) === v0 + 1, 'con la fecha permitida ya cumplida, un guion que habla de voto SÍ se guarda', sv.datos);
    let m = await pedir('GET', '/guion', { usuario: admin });
    ok(m.datos.rige.sustituido === false && m.datos.rige.huella === G.huellaDe(conVoto), 'y rige');
    // Al mostrar: la fecha cambia (o llega una versión vieja) y la precampaña vuelve a regir.
    await config({ fecha_permitida_propaganda: mananaSql });
    m = await pedir('GET', '/guion', { usuario: admin });
    ok(m.datos.rige.sustituido === true && m.datos.rige.por_defecto === true && m.datos.rige.huella === G.HUELLA_POR_DEFECTO && /El paso 3 dice/.test(m.datos.rige.motivo || ''), 'al MOSTRAR, esa versión (ya con palabras prohibidas) se cambia por la de por defecto, y se dice por qué', m.datos.rige);
    ok(m.datos.guardado && m.datos.guardado.huella === G.huellaDe(conVoto), 'la versión guardada sigue ahí (para el administrador)');
    // Lo que baja al celular: una lista asignada a lid1.
    const zA = await territorio('barrio', `Barrio Eme ${sello}`);
    await sembrar(lid1, [{ zona: zA }, { zona: zA }], { nombre: 'Lista del guion' });
    const mi = await pedir('GET', '/mias', { usuario: lid1 });
    ok(mi.status === 200 && mi.datos.guion && mismo(Object.keys(mi.datos.guion).sort(), ['huella', 'pasos', 'sustituido']) && mi.datos.guion.sustituido === true && mi.datos.guion.huella === G.HUELLA_POR_DEFECTO && mismo(mi.datos.guion.pasos, defecto),
      'al celular le llega el guion POR DEFECTO, marcado «sustituido», sin el motivo (el motivo es del administrador)', mi.datos.guion);
    await config({ fecha_permitida_propaganda: ayerSql });
    const mi2 = await pedir('GET', '/mias', { usuario: lid1 });
    ok(mi2.datos.guion.sustituido === false && mi2.datos.guion.huella === G.huellaDe(conVoto) && mismo(mi2.datos.guion.pasos, conVoto), 'con la fecha cumplida, llega la versión de la campaña');
    // Alguien tocó la base por fuera: el contenido ya no coincide con la huella.
    await q('UPDATE puerta_guiones SET pasos = ? ORDER BY id DESC LIMIT 1', [JSON.stringify([...conVoto.slice(0, 2), 'Otro texto distinto escrito directamente en la base.'])]);
    const mi3 = await pedir('GET', '/mias', { usuario: lid1 });
    ok(mi3.datos.guion.sustituido === true && mi3.datos.guion.huella === G.HUELLA_POR_DEFECTO, 'una versión cuyo texto ya no coincide con su huella tampoco se muestra: rige la de por defecto');
    await q('UPDATE puerta_guiones SET pasos = ? ORDER BY id DESC LIMIT 1', [JSON.stringify(conVoto)]);
    await config({ fecha_permitida_propaganda: null });
    // Dejamos un guion propio SIN palabras prohibidas como vigente para lo que sigue.
    await pedir('PUT', '/guion', { usuario: admin, json: { pasos: propio.slice(0, 3) } });
    const HUELLA_VIGENTE = G.huellaDe(propio.slice(0, 3));

    /* ===================================================================================== F3-4. la huella en la visita */
    console.log('\n[4] Cada visita guarda la HUELLA del guion que se mostró, nunca el texto');
    const cols = (await q(`SELECT column_name c, data_type t, character_maximum_length l FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'puerta_visitas' AND column_name LIKE '%guion%'`));
    ok(cols.length === 1 && (cols[0].c || cols[0].C) === 'guion_huella' && Number(cols[0].l || cols[0].L) === 16, 'puerta_visitas solo tiene guion_huella (CHAR 16): no hay dónde guardar el texto', cols);
    const mi4 = await pedir('GET', '/mias', { usuario: lid1 });
    const items = mi4.datos.listas.flatMap((l) => l.items.map((i) => i.id));
    ok(mi4.datos.guion.huella === HUELLA_VIGENTE && !mi4.datos.guion.sustituido, 'el celular recibe la versión vigente', mi4.datos.guion);
    const post = (item, extra) => pedir('POST', '/visitas', { usuario: lid1, json: { cliente_uuid: uuid(), item_id: item, resultado: 'no_interesado', marcado_en: inst(1, '10:00'), ...extra } });
    const huellaDe = async (id) => (await q('SELECT guion_huella h FROM puerta_visitas WHERE id = ?', [id]))[0].h;
    const a = await post(items[0], { guion_huella: HUELLA_VIGENTE });
    ok(a.status === 201 && (await huellaDe(a.datos.id)) === HUELLA_VIGENTE, 'con la huella de una versión guardada: queda anotada', a.datos);
    const b = await post(items[1], { guion_huella: G.HUELLA_POR_DEFECTO });
    ok(b.status === 201 && (await huellaDe(b.datos.id)) === G.HUELLA_POR_DEFECTO, 'con la huella del guion por defecto: también');
    const sinHuella = await sembrar(lid1, [{ zona: zA }], { nombre: 'Para huellas' });
    const [it3] = await q('SELECT id FROM puerta_items WHERE lista_id = ?', [sinHuella]);
    const c = await post(it3.id, { guion_huella: 'deadbeefdeadbeef' });
    ok(c.status === 201 && (await huellaDe(c.datos.id)) === null, 'una huella que no es de ninguna versión se ignora (la visita se guarda, sin huella): no se inventa una versión');
    ok((await q(`SELECT COUNT(*) c FROM puerta_visitas WHERE guion_huella IS NOT NULL AND guion_huella NOT REGEXP '^[0-9a-f]{16}$'`))[0].c === 0, 'y nunca hay en esa columna otra cosa que una huella');
    const g2 = await pedir('GET', '/guion', { usuario: admin });
    ok(g2.datos.historial.find((h) => h.huella === HUELLA_VIGENTE).visitas === 1, 'el historial cuenta cuántas visitas usaron cada versión', g2.datos.historial);

    /* ================================================================================ F3-5. el enlace de inscripción */
    console.log('\n[5] El enlace de inscripción del visitante (para el código QR)');
    const insc = mi4.datos.inscripcion;
    const enlace = (await q('SELECT codigo, activo FROM inscripcion_enlaces WHERE usuario_id = ?', [lid1.id]))[0];
    ok(insc && enlace && insc.ruta === `/i/${enlace.codigo}` && insc.base === 'https://campana.prueba' && mismo(Object.keys(insc).sort(), ['base', 'ruta']), 'quien puede tener enlace lo recibe: su ruta /i/CÓDIGO y la base del sitio (nada de la persona visitada)', insc);
    await q('UPDATE inscripcion_enlaces SET activo = 0 WHERE usuario_id = ?', [lid1.id]);
    ok((await pedir('GET', '/mias', { usuario: lid1 })).datos.inscripcion === null, 'con el enlace DESACTIVADO por la coordinación: null (no hay QR)');
    await q('UPDATE inscripcion_enlaces SET activo = 1 WHERE usuario_id = ?', [lid1.id]);
    await q('INSERT INTO inscripcion_config (id, habilitado) VALUES (1, 0) ON DUPLICATE KEY UPDATE habilitado = 0');
    ok((await pedir('GET', '/mias', { usuario: lid1 })).datos.inscripcion === null, 'con la inscripción por enlace APAGADA en la campaña: null');
    await q('UPDATE inscripcion_config SET habilitado = 1 WHERE id = 1');
    const sinEstructura = await usuario('Líder Sin Estructura', 'lider');
    await sembrar(sinEstructura, [{ zona: zA }], { nombre: 'Sin estructura' });
    ok((await pedir('GET', '/mias', { usuario: sinEstructura })).datos.inscripcion === null, 'quien no está en la estructura (no puede tener enlace): null');
    ok((await pedir('GET', '/mias', { usuario: lid1 })).datos.inscripcion !== null, 'y al reactivarlo, vuelve');

    /* ===================================================================================== F4-1. el panel: los datos */
    console.log('\n[6] El panel: cifras conocidas');
    const zB1 = await territorio('barrio', `Barrio Uno ${sello}`), zB2 = await territorio('barrio', `Barrio Dos ${sello}`), zB3 = await territorio('barrio', `Barrio Tres ${sello}`), zB4 = await territorio('barrio', `Barrio Cuatro ${sello}`);
    const d1 = R.sumarDias(hoyCol(), -1), d3 = R.sumarDias(hoyCol(), -3);
    const V = (res, fecha, franja) => ({ res, fecha, franja });
    // Para empezar de cero: se quitan las listas de las secciones anteriores (el panel cuenta TODAS las del alcance).
    await q('DELETE FROM puerta_listas');
    const LA = await sembrar(lid1, [
      { zona: zB1, visitas: [V('no_abrio', d1, 'manana')] }, { zona: zB1, visitas: [V('no_interesado', d1, 'manana')] }, { zona: zB1, visitas: [V('interesado', d1, 'manana')] },
      { zona: zB1, visitas: [V('quiere_registrarse', d1, 'tarde')] }, { zona: zB1, visitas: [V('solicitud', d1, 'tarde')] }, { zona: zB1, visitas: [V('no_volver', d1, 'tarde')] },
      { zona: zB1 }, { zona: zB1 }], { nombre: 'LA' });
    await sembrar(lid1, [
      ...Array(3).fill(0).map(() => ({ zona: zB2, visitas: [V('no_abrio', d3, 'tarde')] })), ...Array(2).fill(0).map(() => ({ zona: zB2, visitas: [V('no_interesado', d3, 'tarde')] })),
      ...Array(2).fill(0).map(() => ({ zona: zB2, visitas: [V('interesado', d3, 'tarde')] }))], { nombre: 'LB' });
    await sembrar(lid2, [{ zona: zB3, visitas: [V('no_abrio', d1, 'manana')] }, { zona: zB3, visitas: [V('no_abrio', d1, 'manana')] }, { zona: zB4, visitas: [V('no_abrio', d1, 'manana')] }], { nombre: 'LC' });
    await sembrar(lid3, Array(6).fill(0).map(() => ({ zona: zB1, visitas: [V('no_abrio', d1, 'noche')] })), { nombre: 'LD (otra rama)' });

    const pa = await pedir('GET', '/panel', { usuario: admin });
    const P = pa.datos;
    ok(pa.status === 200 && mismo(Object.keys(P).sort(), ['celdas_omitidas', 'filtros', 'marca', 'minimo', 'oculto', 'otras', 'total', 'visitantes', 'zonas']), 'GET /panel: claves exactas', Object.keys(P || {}));
    ok(P.marca === 'Uso interno – no publicable' && P.minimo === 5 && P.oculto === false, 'trae la marca «Uso interno – no publicable» y el mínimo de 5');
    ok(P.zonas.every((z) => mismo(Object.keys(z), Panel.CLAVES_ZONA)) && mismo(Object.keys(P.otras), [...Panel.CLAVES_ZONA, 'zonas']) && mismo(Object.keys(P.total), Panel.CLAVES_ZONA), 'cada fila de zona, «Otras zonas» y el total traen EXACTAMENTE las columnas fijadas', { z: Object.keys(P.zonas[0] || {}), o: Object.keys(P.otras || {}) });
    ok(P.visitantes.every((v) => mismo(Object.keys(v), Panel.CLAVES_VISITANTE)), 'cada visitante: solo conteos, columnas exactas', P.visitantes[0]);
    // Administrador, mínimo 5: b1 12 visitas (LA 6 + LD 6), b2 7, b3 2, b4 1 → b3+b4 = 3 < 5: se les suma la visible más chica (b2) → Otras = 10.
    ok(P.zonas.length === 1 && P.zonas[0].zona === zB1.nombre, 'solo la zona con visitas de sobra se muestra con nombre (Barrio Uno)', P.zonas.map((z) => z.zona));
    const z1 = P.zonas[0];
    ok(z1.visitas === 12 && z1.listas === 2 && z1.asignadas === 14 && z1.visitadas === 12 && z1.no_abrio === 7 && z1.no_interesado === 1 && z1.interesado === 1 && z1.quiere_registrarse === 1 && z1.solicitud === 1 && z1.no_volver === 1,
      'Barrio Uno: 2 listas, 14 puertas asignadas, 12 visitadas y los resultados por tipo', z1);
    ok(P.otras.zonas === 3 && P.otras.visitas === 10 && P.otras.zona === 'Otras zonas (3)' && P.celdas_omitidas === 3, '«Otras zonas»: las 3 celdas chicas (la visible más pequeña se le sumó para que llegue al mínimo)', P.otras);
    ok(P.total.visitas === 22 && P.total.listas === 4 && P.zonas.reduce((t, z) => t + z.visitas, 0) + P.otras.visitas === P.total.visitas, 'el total (22 visitas, 4 listas) es la suma de lo que se ve: nada se puede restar para destapar una celda', P.total);
    ok(!JSON.stringify(P).includes(zB2.nombre) && !JSON.stringify(P).includes(zB3.nombre) && !JSON.stringify(P).includes(zB4.nombre), 'los nombres de las zonas agrupadas NO aparecen en ninguna parte de la respuesta');
    const vl1 = P.visitantes.find((v) => v.visitante === 'Líder Uno');
    ok(vl1 && vl1.listas === 2 && vl1.asignadas === 15 && vl1.visitadas === 13 && vl1.visitas === 13 && vl1.por_visitar === 6 && vl1.cerradas === 9 && vl1.sin_respuesta === 0, 'avance por visitante: Líder Uno', vl1);
    ok(P.visitantes.length === 3 && P.visitantes[0].visitas >= P.visitantes[1].visitas, 'tres visitantes, del que más visitó al que menos', P.visitantes.map((v) => [v.visitante, v.visitas]));
    const crudo = pa.texto;
    ok(!/Persona P|Calle \d|OBS-SECRETA|@secreto|alcaldia|91\d{9}/.test(crudo), 'ni un nombre de votante, ni una dirección, ni una cédula en la respuesta', crudo.match(/Persona P|Calle \d|OBS-SECRETA|@secreto|alcaldia|91\d{9}/));

    /* ================================================================================ F4-2. el alcance del coordinador */
    console.log('\n[7] El coordinador solo ve su alcance');
    const pc = (await pedir('GET', '/panel', { usuario: coord1 })).datos;
    ok(pc.total.visitas === 16 && pc.total.listas === 3 && pc.visitantes.length === 2 && !pc.visitantes.some((v) => v.visitante === 'Líder Tres'), 'Coordinador Uno: 16 visitas, 3 listas y 2 visitantes (nada de la otra rama)', { total: pc.total, v: pc.visitantes.map((v) => v.visitante) });
    ok(pc.zonas.length === 1 && pc.zonas[0].zona === zB2.nombre && pc.zonas[0].visitas === 7 && pc.otras && pc.otras.visitas === 9 && pc.otras.zonas === 3,
      'y el mínimo se aplica a lo SUYO: con 6, 7, 2 y 1 visitas, queda Barrio Dos y «Otras zonas» suma 9 (3 zonas)', { z: pc.zonas.map((z) => [z.zona, z.visitas]), o: pc.otras });
    ok(!JSON.stringify(pc).includes(zB1.nombre), 'Barrio Uno (6 visitas suyas, 12 con las de la otra rama) no sale con nombre');
    const pc2 = (await pedir('GET', '/panel', { usuario: coord2 })).datos;
    ok(pc2.oculto === false && pc2.zonas.length === 1 && pc2.zonas[0].visitas === 6 && pc2.otras === null && pc2.total.visitas === 6, 'Coordinador Dos: sus 6 visitas son de una sola zona y llegan al mínimo: se ven (solo las suyas)', { oculto: pc2.oculto, z: pc2.zonas });
    ok((await pedir('GET', '/panel', { usuario: lid1 })).status === 403, 'un líder no ve el panel (sin el módulo)');

    /* ====================================================================================== F4-3. el mínimo por celda */
    console.log('\n[8] El mínimo por celda: el de las encuestas, solo hacia arriba');
    await config({ encuesta_min_celda: 8 });
    const p8 = (await pedir('GET', '/panel', { usuario: admin })).datos;
    ok(p8.minimo === 8 && p8.zonas.length === 1 && p8.zonas[0].visitas === 12 && p8.otras.visitas === 10 && p8.otras.zonas === 3, 'con mínimo 8: Barrio Uno (12) se ve; Dos, Tres y Cuatro (7+2+1 = 10) forman «Otras zonas»', { z: p8.zonas.map((z) => z.visitas), o: p8.otras });
    await config({ encuesta_min_celda: 25 });
    const p25 = (await pedir('GET', '/panel', { usuario: admin })).datos;
    ok(p25.oculto === true && p25.zonas.length === 0 && p25.otras === null && p25.total === null, 'ni zonas, ni «Otras zonas», ni el total (con tan pocas visitas, cualquier cifra señalaría a una casa)');
    await config({ encuesta_min_celda: 5 });

    /* ============================================================================ F4-4. el filtro por fechas y franja */
    console.log('\n[9] El filtro: fechas y la franja del día como máximo detalle');
    const f1 = (await pedir('GET', `/panel?desde=${d1}`, { usuario: admin })).datos;
    ok(f1.total.visitas === 15 && f1.filtros.desde === d1 && f1.zonas.every((z) => z.visitas === 0) && f1.otras.visitas === 15, 'desde ayer: se van las 7 de hace tres días (15 visitas); con 12, 2 y 1 por zona, la visible más chica se une y todo queda en «Otras zonas»', { t: f1.total, o: f1.otras, z: f1.zonas.length });
    const f2 = (await pedir('GET', `/panel?hasta=${R.sumarDias(hoyCol(), -2)}`, { usuario: admin })).datos;
    ok(f2.total.visitas === 7 && f2.zonas.some((z) => z.zona === zB2.nombre && z.visitas === 7) && f2.zonas.some((z) => z.zona === zB1.nombre && z.visitas === 0 && z.asignadas === 14), 'hasta antier: solo las 7 de Barrio Dos; las zonas SIN visitas se muestran tal cual (no cuentan para el mínimo)', f2.zonas.map((z) => [z.zona, z.visitas, z.asignadas]));
    const f3 = (await pedir('GET', '/panel?franja=noche', { usuario: admin })).datos;
    ok(f3.total.visitas === 6 && f3.filtros.franja === 'noche' && f3.zonas.some((z) => z.zona === zB1.nombre && z.visitas === 6 && z.no_abrio === 6), 'franja «noche»: las 6 de la otra rama, todas en Barrio Uno', f3.zonas.map((z) => [z.zona, z.visitas]));
    const f4 = (await pedir('GET', `/panel?desde=${d1}&hasta=${d1}&franja=manana`, { usuario: admin })).datos;
    ok(f4.total.visitas === 6, 'ayer por la mañana: 3 de Barrio Uno + 3 de Tres y Cuatro', f4.total);
    const f5 = (await pedir('GET', '/panel?franja=noche', { usuario: coord1 })).datos;
    ok(f5.oculto === true && f5.total === null && f5.zonas.length === 0, 'el coordinador con franja «noche»: no tiene ninguna visita de noche en su alcance → nada que mostrar');
    const f6 = (await pedir('GET', '/panel?desde=' + d1, { usuario: coord2 })).datos;
    ok(f6.oculto === false && f6.total.visitas === 6, 'Coordinador Dos desde ayer: 6 visitas (exactamente el mínimo: se ven)');
    for (const [ruta, que] of [['?desde=ayer', 'una fecha que no es fecha'], ['?desde=2026-13-45', 'una fecha imposible'], [`?desde=${d1}&hasta=${d3}`, '«desde» posterior a «hasta»'], ['?franja=10:30', 'una hora (no hay detalle más fino que la franja)'], ['?franja=madrugada', 'una franja que no existe']]) {
      const r = await pedir('GET', '/panel' + ruta, { usuario: admin });
      ok(r.status === 400, `${que}: 400`, r.datos);
    }
    ok(!(Panel.FRANJAS.includes('hora')) && Panel.FRANJAS.join() === 'manana,tarde,noche', 'las franjas son mañana, tarde y noche: no hay otra');

    /* ====================================================================================================== F4-5. el Excel */
    console.log('\n[10] El Excel: lo mismo que el panel, columnas cerradas, nunca una lista de casas ni de personas');
    ok((await pedir('GET', '/panel/exportar', { usuario: lid1, binario: true })).status === 403, 'un líder no exporta');
    ok((await pedir('GET', '/panel/exportar', { usuario: coord1, binario: true })).status === 403, 'el coordinador SIN la casilla «Importar / Exportar» no exporta, aunque vea el panel');
    await permisos('coordinador', 'puerta_listas', 1, 1, 1, 1);
    const xa = await pedir('GET', `/panel/exportar?desde=${d3}`, { usuario: admin, binario: true });
    ok(xa.status === 200 && /spreadsheetml/.test(xa.tipo) && /puerta-a-puerta-\d{4}-\d{2}-\d{2}\.xlsx/.test(xa.disp), 'el administrador descarga un .xlsx', { s: xa.status, t: xa.tipo, d: xa.disp });
    const libro = XLSX.read(xa.buffer, { type: 'buffer' });
    ok(mismo(libro.SheetNames, ['Notas', 'Cobertura por zona', 'Avance por visitante']), 'tres hojas: Notas, Cobertura por zona y Avance por visitante', libro.SheetNames);
    const filasDe = (x, h) => XLSX.utils.sheet_to_json(x.Sheets[h], { header: 1, defval: '' });
    const zonaHoja = filasDe(libro, 'Cobertura por zona'), visHoja = filasDe(libro, 'Avance por visitante'), notasHoja = filasDe(libro, 'Notas');
    ok(zonaHoja[0][0] === 'Uso interno – no publicable' && visHoja[0][0] === 'Uso interno – no publicable' && notasHoja[0][0] === 'Uso interno – no publicable', 'cada hoja empieza con «Uso interno – no publicable»');
    ok(mismo(zonaHoja[2], Panel.COLUMNAS_ZONA) && mismo(zonaHoja[2], ['Zona', 'Listas', 'Puertas asignadas', 'Puertas visitadas', 'Visitas', 'No abrió', 'No interesado', 'Interesado', 'Quiere registrarse', 'Dejó una solicitud', 'Pidió no volver']), 'columnas exactas de «Cobertura por zona»', zonaHoja[2]);
    ok(mismo(visHoja[2], ['Visitante', 'Listas', 'Puertas asignadas', 'Puertas visitadas', 'Por visitar', 'Cerradas', 'Sin respuesta', 'Visitas']), 'columnas exactas de «Avance por visitante»', visHoja[2]);
    const pxa = (await pedir('GET', `/panel?desde=${d3}`, { usuario: admin })).datos;
    const cuerpoZ = zonaHoja.slice(3);
    ok(cuerpoZ.length === pxa.zonas.length + (pxa.otras ? 1 : 0) + 1 && cuerpoZ[cuerpoZ.length - 1][0] === 'Total' && cuerpoZ[cuerpoZ.length - 1][4] === pxa.total.visitas, 'las filas del Excel son las del panel (zonas, «Otras zonas», Total) y el total coincide', { filas: cuerpoZ.length, total: cuerpoZ[cuerpoZ.length - 1] });
    ok(visHoja.length - 3 === pxa.visitantes.length, 'y los visitantes también');
    const todasLasCeldas = [...notasHoja, ...zonaHoja, ...visHoja].flat().map(String);
    ok(!todasLasCeldas.some((c) => /Persona P|Calle \d|OBS-SECRETA|@secreto|91\d{9}/.test(c)), 'ninguna celda lleva el nombre, la dirección ni la cédula de nadie', todasLasCeldas.filter((c) => /Persona P|Calle \d/.test(c)));
    ok(todasLasCeldas.some((c) => /Nunca trae una lista de casas ni de personas|nunca trae una lista de casas ni de personas/i.test(c)) || todasLasCeldas.some((c) => /una lista de casas ni de personas/.test(c)), 'y la hoja de notas lo dice: «nunca una lista de casas ni de personas»');
    ok(todasLasCeldas.some((c) => /Mínimo de visitas por celda/.test(c)) && notasHoja.some((f) => f[0] === 'Desde' && f[1] === d3), 'las notas dicen el mínimo y el filtro usado');
    const xc = await pedir('GET', '/panel/exportar', { usuario: coord1, binario: true });
    const libroC = XLSX.read(xc.buffer, { type: 'buffer' });
    const zC = filasDe(libroC, 'Cobertura por zona'), vC = filasDe(libroC, 'Avance por visitante');
    ok(xc.status === 200 && zC[zC.length - 1][4] === 16 && !vC.flat().some((c) => /Líder Tres/.test(String(c))) && notasHoja.length > 0, 'con la casilla, el coordinador exporta SOLO su alcance (16 visitas, sin la otra rama)', zC[zC.length - 1]);
    ok((await q(`SELECT COUNT(*) c FROM auditoria WHERE accion = 'exportar_excel' AND entidad = 'puerta_listas'`))[0].c === 2, 'cada descarga queda en la auditoría');
    ok((await pedir('GET', '/panel/exportar?franja=hora', { usuario: admin, binario: true })).status === 400, 'el Excel respeta las mismas validaciones del filtro');

    /* ============================================================================ las pantallas y el celular, en Chromium */
    console.log('\n[11] El celular: «Ver guion», sin señal, el QR y los pines separados — en un Chromium real');
    ok(/<h1>Puerta a puerta · panel<\/h1>/.test(leer('public/puerta-panel.html')) && !/datalist/.test(leer('public/puerta-panel.html')), 'estático: existe la pantalla del panel');
    ok(/href: '\/puerta-panel\.html'/.test(leer('public/js/common.js')), 'estático: el panel está en el menú de escritorio (grupo Electoral)');

    await q('DELETE FROM puerta_listas');
    await q('UPDATE inscripcion_enlaces SET activo = 1');
    // La lista del celular: dos puertas CASI ENCIMA (a un metro una de otra), dos lejos y tres para «quiere registrarse».
    await q('UPDATE votantes SET consentimiento_autorizado = 0 WHERE lider_id = ?', [lid1.id]);        // los de las secciones anteriores no entran en esta lista
    const zC1 = await territorio('barrio', `Barrio Celular ${sello}`);
    const coords = { P1: [5.0700, -75.5100], P2: [5.07001, -75.51001], P3: [5.0800, -75.5200], P4: [5.0750, -75.5150], P5: [5.0760, -75.5160], P6: [5.0770, -75.5170], P7: [5.0780, -75.5180] };
    const vot = {};
    for (const [k, [la, lo]] of Object.entries(coords)) vot[k] = await votante({ lider: lid1, zona: zC1, lat: la, lon: lo });
    const lis = await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Lista del celular', asignada_a: lid1.id, cliente_uuid: uuid() } });
    ok(lis.status === 201 && lis.datos.personas === 7, 'armo la lista del celular con 7 puertas', lis.datos);
    const itemDe = {};
    for (const k of Object.keys(coords)) itemDe[k] = (await q('SELECT id FROM puerta_items WHERE lista_id = ? AND votante_id = ?', [lis.datos.id, vot[k]]))[0].id;

    const web = crear(pool);
    servidorWeb = http.createServer(web);
    await new Promise((r) => servidorWeb.listen(0, '127.0.0.1', r));
    const urlWeb = `http://127.0.0.1:${servidorWeb.address().port}`;
    navegador = await lanzar();
    const p = await navegador.pagina('about:blank');
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
    await p.cmd('Network.clearBrowserCookies');
    const AHORA = new Date(`${R.sumarDias(hoyCol(), -1)}T10:00:00-05:00`).getTime();
    await p.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `
      (() => { const T = ${AHORA}; const RD = Date;
        class FD extends RD { constructor(...a) { if (a.length === 0) super(T); else super(...a); } static now() { return T; } }
        window.Date = FD; })();
      try { window.__sinSenal = sessionStorage.getItem('sinSenal') === '1'; } catch (_) { window.__sinSenal = false; }
      window.__cuerpos = [];
      const f = window.fetch.bind(window);
      window.fetch = (...a) => { try { window.__cuerpos.push(String((a[1] && a[1].body) || '')); } catch (_) {} return window.__sinSenal ? Promise.reject(new TypeError('Failed to fetch')) : f(...a); };` });
    const sinSenal = (off) => p.ev(`window.__sinSenal = ${off ? 'true' : 'false'}; sessionStorage.setItem('sinSenal', '${off ? 1 : 0}')`);
    const entrarComo = (id) => p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(id), url: urlWeb });
    const ir = async (ruta, ms = 2600) => { await p.cmd('Page.navigate', { url: urlWeb + ruta }); await espera(ms); };
    const clic = (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
    const idb = (store) => p.ev(`(async () => { const db = await abrirBaseOffline();
      return await new Promise((ok, ko) => { const r = db.transaction(${JSON.stringify(store)}, 'readonly').objectStore(${JSON.stringify(store)}).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); }); })()`);
    const textoDe = (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
    const guionEnPantalla = () => p.ev(`Array.from(document.querySelectorAll('#lista-servidor .caja-pp[data-item] details.guion-pp')).map((d) => ({ item: Number(d.dataset.guion), abierto: d.open, titulo: d.querySelector('summary').textContent.trim(), pasos: Array.from(d.querySelectorAll('li')).map((li) => li.textContent.trim()) }))`);

    await entrarComo(lid1.id);
    await ir('/app/puerta-a-puerta.html', 3200);
    let gp = await guionEnPantalla();
    const cajas = await p.ev(`document.querySelectorAll('#lista-servidor .caja-pp[data-item]').length`);
    ok(cajas === 7 && gp.length === 7 && gp.every((g) => g.titulo === 'Ver guion' && g.abierto === false), 'cada una de las 7 fichas trae «Ver guion», plegado', { cajas, gp: gp.length });
    ok(gp.every((g) => mismo(g.pasos, propio.slice(0, 3))), 'con los pasos del guion vigente de la campaña', gp[0] && gp[0].pasos);
    const posGuion = await p.ev(`(() => { const c = document.querySelector('#lista-servidor .caja-pp[data-item]'); const d = c.querySelector('details.guion-pp'); const f = c.querySelector('.fila'); return d.getBoundingClientRect().bottom <= f.getBoundingClientRect().top + 1; })()`);
    ok(posGuion, 'el guion queda ARRIBA de la ficha de la puerta');
    await p.ev(`document.querySelector('#lista-servidor details.guion-pp summary').click()`);
    await espera(400);
    ok((await guionEnPantalla())[0].abierto === true, 'al tocar «Ver guion» se despliega');

    // --- los pines
    const dm = await p.ev('window.__ppMapa');
    ok(dm.pines.length === 7, 'el mapa dibuja 7 pines', dm.pines.length);
    const porNum = Object.fromEntries(dm.pines.map((x) => [x.n, x]));
    const guardadas = Object.fromEntries((await q('SELECT id, latitud, longitud FROM votantes WHERE lider_id = ?', [lid1.id])).map((v) => [v.id, [Number(v.latitud), Number(v.longitud)]]));
    ok(dm.pines.every((x) => { const v = Object.entries(coords).find(([k, c]) => Math.abs(c[0] - x.lat) < 1e-9 && Math.abs(c[1] - x.lon) < 1e-9); return !!v; }), 'las coordenadas de cada pin son EXACTAMENTE las guardadas (no se movieron los datos)', dm.pines);
    const rects = await p.ev(`Array.from(document.querySelectorAll('.pin-pp')).map((e) => { const r = e.getBoundingClientRect(); return { n: Number(e.textContent), x: r.left + r.width / 2, y: r.top + r.height / 2 }; })`);
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let minimo = Infinity; const pares = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const d = dist(rects[i], rects[j]); if (d < minimo) minimo = d; if (d < 20) pares.push([rects[i].n, rects[j].n, Math.round(d)]); }
    ok(rects.length === 7 && minimo >= 24 && !pares.length, `ningún par de pines queda encima de otro (la distancia mínima en pantalla es ${Math.round(minimo)} px; un pin mide 28)`, { pares, minimo });
    ok(dm.separados && dm.separados.some((g) => g.length === 2), 'el mapa registra qué números separó (el par de puertas casi encimadas)', dm.separados);
    const copiaMapa = await idb('puerta_cache');
    const itemsCopia = copiaMapa[0].datos.listas[0].items;
    ok(itemsCopia.every((i) => Object.values(coords).some((c) => Math.abs(c[0] - Number(i.latitud)) < 1e-9 && Math.abs(c[1] - Number(i.longitud)) < 1e-9)), 'y la copia guardada en el celular conserva las coordenadas originales');
    ok(dm.linea.length === 7, 'la línea guía une los 7 puntos reales', dm.linea.length);

    // --- una visita con señal: la huella del guion que se mostró
    await clic(`[data-resultado="no_abrio"][data-id="${itemDe.P3}"]`);
    await espera(2000);
    const v1 = (await q('SELECT guion_huella h, resultado FROM puerta_visitas WHERE item_id = ?', [itemDe.P3]))[0];
    ok(v1 && v1.h === HUELLA_VIGENTE, 'la visita se guardó con la HUELLA del guion que estaba en pantalla', v1);

    // --- sin señal: se usa la copia guardada (guion incluido) y se anota la huella de ESA copia
    await sinSenal(true);
    await p.ev('refrescar()');                                  // sin señal NO se recarga la página (pediría la sesión): se repinta desde la copia, como en la otra prueba del celular
    await espera(1200);
    gp = await guionEnPantalla();
    ok(gp.length === 6 && gp.every((g) => mismo(g.pasos, propio.slice(0, 3))), 'sin señal, la lista sale de la copia y el guion también (6 puertas por visitar)', { n: gp.length });
    ok(/Sin señal/.test(await textoDe('#nota-copia') || ''), 'y la pantalla dice que es la copia guardada');
    // Mientras tanto la campaña cambia el guion: el celular sigue con el suyo y anota SU huella.
    const nuevo = ['Un saludo cordial para empezar la conversación con la persona.', 'Presente al equipo y diga con claridad a qué viene.', 'Escuche lo que el barrio necesita y tome nota si quiere.', 'Despídase dando las gracias por su tiempo.'];
    await pedir('PUT', '/guion', { usuario: admin, json: { pasos: nuevo } });
    await clic(`[data-resultado="no_interesado"][data-id="${itemDe.P1}"]`);
    await espera(1500);
    const cola = await idb('puerta_pendientes');
    ok(cola.length === 1 && cola[0].payload.guion_huella === HUELLA_VIGENTE, 'en la cola sin señal queda la huella de la versión que SE LEYÓ (no el texto)', cola.map((c) => c.payload));
    ok(!JSON.stringify(cola).includes('Escuche lo que el barrio') && !JSON.stringify(cola).includes('Salude con calma'), 'la cola no lleva el texto del guion');
    await sinSenal(false);
    await ir('/app/puerta-a-puerta.html', 3500);
    const v2 = (await q('SELECT guion_huella h FROM puerta_visitas WHERE item_id = ?', [itemDe.P1]))[0];
    ok(v2 && v2.h === HUELLA_VIGENTE, 'al volver la señal sube con la huella de la copia, aunque la campaña ya cambió el guion', v2);
    gp = await guionEnPantalla();
    ok(gp.length > 0 && mismo(gp[0].pasos, nuevo), 'y con señal ya se ve la versión nueva');

    // --- «Alguien quiere registrarse»: el QR
    const lugarQR = await q('SELECT codigo FROM inscripcion_enlaces WHERE usuario_id = ?', [lid1.id]);
    const urlEsperada = `https://campana.prueba/i/${lugarQR[0].codigo}`;
    await clic(`[data-resultado="quiere_registrarse"][data-id="${itemDe.P4}"]`);
    await espera(2500);
    ok(await p.ev(`!!document.getElementById('velo-registro')`) && (await p.ev('location.pathname')) === '/app/puerta-a-puerta.html', 'con enlace propio, «Alguien quiere registrarse» ofrece el cuadro (y ya guardó el resultado)');
    ok(await p.ev(`Array.from(document.querySelectorAll('#velo-registro button')).map((b) => b.textContent.trim()).join('|')`) === 'Mostrar código QR|Abrir el registro|Listo', 'con tres botones: «Mostrar código QR», «Abrir el registro» y «Listo»');
    ok((await q('SELECT resultado FROM puerta_visitas WHERE item_id = ?', [itemDe.P4])).length === 1, 'la visita quedó registrada');
    await clic('#vr-qr-btn');
    await espera(500);
    const qr = await p.ev(`(() => { const c = document.getElementById('vr-lienzo'); const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let oscuros = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 60) oscuros++; return { url: document.getElementById('vr-url').textContent, ancho: c.width, oscuros, visible: getComputedStyle(document.getElementById('vr-qr')).display !== 'none' }; })()`);
    ok(qr.visible && qr.url === urlEsperada && qr.ancho > 100 && qr.oscuros > 500, `«Mostrar código QR» dibuja el QR del enlace del visitante (${urlEsperada})`, qr);
    await clic('#vr-cerrar');
    await espera(1800);
    ok(!(await p.ev(`!!document.getElementById('velo-registro')`)), '«Listo» cierra el cuadro');
    // El QR también sin señal (el enlace viaja con la copia).
    await sinSenal(true);
    await p.ev('refrescar()');
    await espera(1200);
    await clic(`[data-resultado="quiere_registrarse"][data-id="${itemDe.P5}"]`);
    await espera(1500);
    await clic('#vr-qr-btn');
    await espera(400);
    const qr2 = await p.ev(`(() => { const c = document.getElementById('vr-lienzo'); return c ? { url: document.getElementById('vr-url').textContent, w: c.width } : null; })()`);
    ok(qr2 && qr2.url === urlEsperada, 'sin señal también: el enlace viaja con la copia de la lista', qr2);
    ok((await q('SELECT id FROM puerta_visitas WHERE item_id = ?', [itemDe.P5])).length === 0 && (await idb('puerta_pendientes')).length === 1, 'y el resultado queda en la cola, esperando señal');
    await clic('#vr-cerrar');
    await sinSenal(false);
    await ir('/app/puerta-a-puerta.html', 3500);
    ok((await q('SELECT id FROM puerta_visitas WHERE item_id = ?', [itemDe.P5])).length === 1, 'al volver la señal sube');
    // Sin enlace: no hay QR; se abre el registro normal.
    await q('UPDATE inscripcion_enlaces SET activo = 0 WHERE usuario_id = ?', [lid1.id]);
    await ir('/app/puerta-a-puerta.html', 3200);
    await clic(`[data-resultado="quiere_registrarse"][data-id="${itemDe.P6}"]`);
    await espera(3200);
    ok(!(await p.ev(`!!document.getElementById('velo-registro') || !!document.getElementById('vr-qr-btn')`)) && (await p.ev('location.pathname')) === '/app/registro-votante.html', 'sin enlace (desactivado): NO se ofrece el QR y se abre el registro normal de una vez', await p.ev('location.pathname'));
    ok(!(await q('SELECT 1 FROM puerta_visitas WHERE item_id = ? AND resultado <> ?', [itemDe.P6, 'quiere_registrarse'])).length, 'y el resultado quedó guardado igual');

    ok(!p.avisos.length, 'ninguna excepción de JavaScript en el celular', p.avisos);

    /* ============================================================================ las pantallas de escritorio */
    console.log('\n[12] Las pantallas de escritorio: el editor del guion y el panel');
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await entrarComo(admin.id);
    await ir('/puerta-listas.html', 3000);
    const ed = await p.ev(`(() => { const s = document.getElementById('pp-guion'); return s ? { pasos: Array.from(s.querySelectorAll('textarea')).map((t) => t.value), visible: getComputedStyle(document.getElementById('g-edicion')).display !== 'none', rige: document.getElementById('g-versiones').textContent } : null; })()`);
    ok(ed && ed.visible && ed.pasos.length === 4 && mismo(ed.pasos, nuevo), 'el administrador ve el editor del guion con los pasos vigentes', ed);
    await p.ev(`(() => { const t = document.querySelector('#g-pasos textarea'); t.value = 'Salude y pregunte por quién piensa votar en la elección.'; })()`);
    await config({ fecha_permitida_propaganda: null });
    await clic('#g-guardar');
    await espera(1500);
    const mp = await textoDe('#g-msg');
    ok(/El paso 1 dice/.test(mp || '') && /vot|elecci/i.test(mp || ''), 'al guardar un guion con palabras prohibidas, la pantalla muestra el mensaje y no lo guarda', mp);
    ok(await p.ev(`(() => { const b = document.getElementById('g-pasos').querySelectorAll('[data-quitar]'); return b.length === 4; })()`), 'y tiene «Quitar» por paso');
    await clic('#g-defecto'); await espera(300);
    ok((await p.ev(`Array.from(document.querySelectorAll('#g-pasos textarea')).map((t) => t.value)`)).length === defecto.length, '«Poner el guion por defecto» llena los pasos con los de por defecto');
    await clic('#g-guardar'); await espera(1500);
    ok(/Guion guardado/.test(await textoDe('#g-msg') || '') && (await versiones()) > 0, 'y guardar el de por defecto crea su versión');
    await entrarComo(coord1.id);
    await ir('/puerta-listas.html', 3000);
    ok(await p.ev(`getComputedStyle(document.getElementById('g-edicion')).display === 'none' && document.querySelectorAll('#g-lectura li').length > 0`), 'el coordinador ve el guion de lectura, sin editor');
    await entrarComo(admin.id);
    await ir('/puerta-panel.html', 3000);
    const pan = await p.ev(`({ zonas: Array.from(document.querySelectorAll('#z-cuerpo tr')).map((tr) => tr.textContent.replace(/\\s+/g, ' ').trim()), cab: Array.from(document.querySelectorAll('#z-cab th')).map((t) => t.textContent.trim()), vis: document.querySelectorAll('#v-cuerpo tr').length, excel: getComputedStyle(document.getElementById('f-excel-caja')).display !== 'none' })`);
    ok(mismo(pan.cab, Panel.COLUMNAS_ZONA) && pan.excel, 'el panel pinta las columnas fijadas y el administrador ve «Descargar en Excel»', pan);
    await p.ev(`(() => { document.getElementById('f-franja').value = 'noche'; document.getElementById('f-ver').click(); })()`);
    await espera(1500);
    ok(/menos de 5 visitas/.test(await textoDe('#z-cuerpo') || '') || (await p.ev(`document.querySelectorAll('#z-cuerpo tr').length`)) >= 1, 'el filtro de la franja se aplica (sin visitas suficientes, lo dice)');
    ok(/franja=noche/.test(await p.ev(`document.getElementById('f-excel').getAttribute('href')`)), 'y el enlace del Excel lleva el mismo filtro');
    await entrarComo(coord1.id);
    await ir('/puerta-panel.html', 3000);
    ok(await p.ev(`getComputedStyle(document.getElementById('f-excel-caja')).display !== 'none'`), 'el coordinador con la casilla de exportar ve el botón de Excel');
    await permisos('coordinador', 'puerta_listas', 1, 1, 1, 0);
    await ir('/puerta-panel.html', 3000);
    ok(await p.ev(`getComputedStyle(document.getElementById('f-excel-caja')).display === 'none'`), 'y sin la casilla, no');
    ok(!p.avisos.length, 'ninguna excepción de JavaScript en las pantallas de escritorio', p.avisos);
  } catch (e) {
    fallos++;
    console.log('  FALLA la prueba se cayó:', e && (e.stack || e.message));
  } finally {
    try { if (navegador) navegador.cerrar(); } catch (_) { /* ya cerrado */ }
    try { if (servidorWeb) servidorWeb.close(); } catch (_) { /* ya cerrado */ }
    try { if (servidor) servidor.close(); } catch (_) { /* ya cerrado */ }
    await pool.end().catch(() => {});
  }
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO EN ORDEN');
  process.exit(fallos ? 1 : 0);
})();
