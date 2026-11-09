#!/usr/bin/env node
// scripts/probar-encuestas-resultados.js
//
// Prueba de las ENCUESTAS INTERNAS (parche 308), Fases 3 y 4, del lado del servidor:
//   · migración repetible: columnas de revisión, cuotas, mínimo por celda, finalidad en la política de privacidad (con su versión archivada);
//   · el ALCANCE de los resultados con todos los roles (administrador, coordinador, líder, sublíder, otro rol);
//   · el MÍNIMO POR CELDA: unidad y propiedad («Otras zonas» nunca deja restar), configurable solo hacia arriba y también para el administrador;
//   · los agregados por tipo de pregunta, solo con las respuestas «ok», sin textos libres, y la agrupación por la zona que contiene;
//   · la cobertura frente a los votantes registrados, y las cuotas;
//   · el Excel: hoja de notas, marca en cada hoja, sin textos, solo con «Importar / Exportar» y con auditoría;
//   · las SEÑALES de calidad una por una (ritmo por hora de CAPTURA, duración, misma opción, vectores repetidos, celda lejos, zona ajena);
//   · revisar: aprobar / excluir / restaurar (reversible, auditado, solo el administrador) y que una aprobada no se vuelva a marcar;
//   · el panel por aplicador y las listas de revisión sin una sola respuesta; la cola de textos libres (conservar y borrar).
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada308 node scripts/probar-encuestas-resultados.js
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
app.use('/api/encuestas', require('../routes/encuestas.routes'));
let base = '';
async function pedir(metodo, ruta, { json, usuario, aspirante, binario } = {}) {
  const h = { 'X-Forwarded-For': '198.51.100.9', 'User-Agent': 'prueba/1.0' };
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  if (aspirante) h['X-Test-Aspirante'] = String(aspirante);
  const r = await fetch(base + '/api/encuestas' + ruta, { method: metodo, headers: h, body });
  if (binario) return { status: r.status, tipo: r.headers.get('content-type') || '', disposicion: r.headers.get('content-disposition') || '', buffer: Buffer.from(await r.arrayBuffer()) };
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
  return { status: r.status, datos, texto };
}

let n = 0;
const sello = String(Date.now()).slice(-7);
async function usuario(nombre, rol) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, `96${sello}${n}`, `u96${sello}${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  return { id: r.insertId, rol, nombre };
}
async function estructura(u, cargo, supervisor, territorio) {
  await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo, territorio_id) VALUES (?, ?, ?, 1, ?)', [u.id, cargo, supervisor ? supervisor.id : null, territorio || null]);
}
async function permisos(rol, modulo, ver, editar, agregar, exportar = 0) {
  await pool.query(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar, importar_exportar) VALUES (?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE permitido = VALUES(permitido), editar = VALUES(editar), agregar = VALUES(agregar), importar_exportar = VALUES(importar_exportar)`, [rol, modulo, ver, editar, agregar, exportar]);
}
async function config(c) {
  const sets = Object.keys(c).map((k) => `${k} = ?`).join(', ');
  await q(`UPDATE configuracion_campana SET ${sets} WHERE id = 1`, Object.values(c));
}

const ENCUESTA = (extra = {}) => Object.assign({
  titulo: 'Necesidades del barrio', descripcion: 'Preguntas cortas', pide_ubicacion: 1,
  preguntas: [
    { tipo: 'unica', enunciado: '¿Cuál es el principal problema del barrio?', opciones: ['Vías', 'Agua', 'Seguridad'] },
    { tipo: 'multiple', enunciado: '¿Qué servicios usa?', opciones: ['Transporte', 'Salud', 'Colegio'] },
    { tipo: 'escala', enunciado: '¿Qué tan satisfecho está con la limpieza? (1 = nada, 5 = mucho)' },
    { tipo: 'numero', enunciado: '¿Cuántas personas viven en la casa?', num_min: 1, num_max: 1000 },
    { tipo: 'texto', enunciado: '¿Qué mejoraría primero?' },
  ],
}, extra);

(async () => {
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
  await config({ fecha_permitida_propaganda: null, fecha_eleccion: null, nombre_candidato: null, encuesta_min_celda: 5 });
  await q(`DELETE FROM permisos_rol WHERE modulo IN ('encuestas','encuestas_campo') AND rol <> 'admin'`);
  // Pizarra limpia (es una base desechable: el nombre se comprobó arriba): las cifras de esta prueba se cuentan desde cero.
  for (const tabla of ['encuesta_respuesta_items', 'encuesta_respuestas', 'encuesta_cuotas', 'encuesta_preguntas', 'encuestas']) await q(`DELETE FROM ${tabla}`);
  await q(`DELETE FROM votantes WHERE nombre LIKE 'Votante 9%'`);
  await q('DELETE FROM territorios');
  await q(`INSERT INTO territorios (id, tipo, nombre, padre_id) VALUES (9101, 'municipio', 'Municipio Ejemplo', NULL), (9102, 'comuna', 'Comuna Centro', 9101),
           (9103, 'barrio', 'El Carmen', 9102), (9106, 'barrio', 'Barrio Dos', 9102), (9104, 'vereda', 'La Cabaña', 9101), (9105, 'corregimiento', 'Corregimiento Alto', 9101)`);
  console.log('ENCUESTAS INTERNAS · FASES 3 Y 4 — base «' + nombreBase + '»\n');

  const E = require('../lib/encuestas');
  const Res = require('../lib/encuestasResultados');
  const Cal = require('../lib/encuestasCalidad');
  const { alcanceEncuestas } = require('../lib/alcanceEncuestas');
  const { MODULOS_CON_IMPORTAR_EXPORTAR } = require('../config/importarExportar');

  const admin = { id: 1, rol: 'admin', nombre: 'Admin Prueba' };
  const coord = await usuario('Coordinadora Ejemplo', 'coordinador'); await estructura(coord, 'coordinador');
  const l1 = await usuario('Lider Uno', 'lider'); await estructura(l1, 'lider', coord);
  const l2 = await usuario('Lider Dos', 'lider'); await estructura(l2, 'lider', coord);
  const s1 = await usuario('Sublider Uno', 'sublider'); await estructura(s1, 'usuario', l1);
  const otro = await usuario('Testigo Ejemplo', 'testigo');
  await permisos('coordinador', 'encuestas', 1, 0, 0); await permisos('lider', 'encuestas', 1, 0, 0);
  await permisos('sublider', 'encuestas', 1, 0, 0); await permisos('testigo', 'encuestas', 1, 0, 0);

  const publicar = async (cuerpo) => {
    const { errores, datos } = E.normalizarBorrador(cuerpo);
    if (errores.length) throw new Error('fixture inválido: ' + errores[0]);
    const id = await E.guardarBorrador(null, datos, admin);
    await E.publicar(id, admin);
    return E.detalle(id);
  };
  const cuerpo = (d, i, over = {}) => {
    const P = (o) => d.preguntas.find((p) => p.orden === o);
    const t = Date.now() - (i + 1) * 180000;                            // una cada 3 minutos: nunca dispara el ritmo
    const normales = () => [
      { pregunta_id: P(1).id, opcion: 'o' + (1 + (i % 3)) }, { pregunta_id: P(2).id, opciones: i % 2 ? ['o1', 'o2'] : ['o3'] },
      { pregunta_id: P(3).id, valor: 1 + (i % 5) }, { pregunta_id: P(4).id, valor: i + 1 }, { pregunta_id: P(5).id, texto: 'SECRETO-DE-TEXTO ' + i },
    ];
    return Object.assign({
      cliente_uuid: uuid(), encuesta_id: d.id, huella: d.huella, respondida_en: new Date(t).toISOString(), iniciada_en: new Date(t - 60000).toISOString(),
      territorio_id: 9103, celda_ix: Math.floor(-75.5 / 0.005), celda_iy: Math.floor(5.07 / 0.005),
      respuestas: over.respuestas || normales(),
    }, over);
  };
  const enviar = (u, d, i, over) => E.registrarRespuesta({ usuario: u, body: cuerpo(d, i, over) });

  /* ====================================================================================== 1. migración */
  console.log('[1] Migración del 308');
  const col = async (t, c) => (await q(`SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [t, c]))[0].n === 1;
  ok(await col('encuesta_respuestas', 'revision') && await col('encuesta_respuestas', 'senales') && await col('encuesta_respuestas', 'vector_hash') && await col('encuesta_respuestas', 'revisada_por') && await col('encuesta_respuesta_items', 'texto_revisado'), 'las columnas de revisión existen');
  ok((await q(`SELECT column_default d FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'encuesta_respuestas' AND column_name = 'revision'`))[0].d === 'ok', 'por omisión una respuesta es «ok» (las del 307 siguen contando)');
  ok(Number((await q('SELECT encuesta_min_celda m FROM configuracion_campana WHERE id = 1'))[0].m) === 5, 'el mínimo por celda es 5 de fábrica');
  ok((await q('SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = \'encuesta_cuotas\'')).length === 1, 'existe la tabla de cuotas');
  ok(MODULOS_CON_IMPORTAR_EXPORTAR.includes('encuestas') && !MODULOS_CON_IMPORTAR_EXPORTAR.includes('encuestas_campo'), 'la casilla «Importar / Exportar» es de encuestas (resultados), no de aplicar en campo');
  const pol = (await q(`SELECT contenido FROM contenido_paginas WHERE clave = 'politica_privacidad'`))[0].contenido;
  const huellaPol = require('../config/politicaVersiones').huellaDePolitica(pol);
  ok(/encuestas internas que aplica el equipo/.test(pol) && /anónimas y voluntarias/.test(pol), 'la política de privacidad trae la finalidad de las encuestas internas');
  ok((await q('SELECT 1 FROM politica_versiones WHERE huella = ?', [huellaPol])).length === 1, 'y su versión nueva quedó ARCHIVADA con su huella');
  ok((await q(`SELECT COUNT(*) n FROM politica_versiones WHERE clave = 'politica_privacidad'`))[0].n >= 2, 'la versión anterior (solicitudes) sigue archivada');
  ok(pol.indexOf('registrar y remitir necesidades del territorio') < pol.indexOf('encuestas internas que aplica el equipo') && pol.indexOf('encuestas internas que aplica el equipo') < pol.indexOf('## 3.'), 'el párrafo va en la sección 2, después del de solicitudes');
  ok(!/nombre, su cédula|publican/.test('') && /no se publican ni se entregan a terceros/.test(pol) && /no le pedimos ni guardamos su nombre/.test(pol), 'y dice lo que se promete: anónimas, sin nombre ni cédula, no se publican');

  /* ====================================================================================== 2. el mínimo por celda (unidad y propiedad) */
  console.log('\n[2] El mínimo por celda y «Otras zonas»');
  const celdas = (...ns) => ns.map((x, i) => ({ clave: 'z' + i, nombre: 'Zona ' + i, zona_id: i + 1, n: x }));
  let m = Res.aplicarMinimo(celdas(3, 3, 4, 10), 5);
  ok(m.visibles.length === 1 && m.visibles[0].n === 10 && m.otras.length === 3 && m.otras.reduce((a, c) => a + c.n, 0) === 10, 'las celdas chicas se agrupan en «Otras zonas» (que suma 10) y queda una visible', m);
  m = Res.aplicarMinimo(celdas(2, 1, 9, 12), 5);
  ok(m.otras.reduce((a, c) => a + c.n, 0) >= 5 && m.visibles.every((c) => c.n >= 5), 'si el grupo no llega al mínimo, se le suma la celda visible más pequeña', m);
  ok(m.visibles.length === 1 && m.visibles[0].n === 12 && m.otras.length === 3, '  (la de 9 se unió al grupo: quedó la de 12 y 3 celdas en «Otras zonas»)');
  m = Res.aplicarMinimo(celdas(2, 1), 5);
  ok(m.oculto === true && m.visibles.length === 0 && m.otras === null, 'si ni todas juntas llegan, no se muestra NADA');
  m = Res.aplicarMinimo(celdas(7, 8, 20), 5);
  ok(m.otras === null && m.visibles.length === 3 && !m.oculto, 'si todas llegan, no hay «Otras zonas»');
  // Propiedad: sobre 2.000 conjuntos al azar, nada que se muestre es menor que k, y total - visibles >= k (la resta no deja ver una celda chica).
  let semilla = 12345; const azar = (max) => { semilla = (semilla * 1103515245 + 12345) & 0x7fffffff; return semilla % max; };
  let malas = 0;
  for (let t = 0; t < 2000; t++) {
    const k = 5 + azar(6);
    const cs = celdas(...Array.from({ length: 1 + azar(8) }, () => 1 + azar(15)));
    const total = cs.reduce((a, c) => a + c.n, 0);
    const r = Res.aplicarMinimo(cs, k);
    const sv = r.visibles.reduce((a, c) => a + c.n, 0);
    const so = r.otras ? r.otras.reduce((a, c) => a + c.n, 0) : 0;
    if (r.visibles.some((c) => c.n < k)) malas++;
    else if (r.oculto) { if (total >= k) malas++; }
    else if (sv + so !== total || (r.otras && so < k) || (total - sv > 0 && total - sv < k)) malas++;
  }
  ok(malas === 0, 'propiedad (2.000 casos al azar): lo visible nunca es menor que k, «Otras zonas» suma al menos k y nada se pierde', malas);

  /* ====================================================================================== 3. el alcance */
  console.log('\n[3] El alcance de los resultados');
  const sA = await publicar(ENCUESTA({ titulo: 'Alcance' }));
  let i = 0;
  const aplic = { admin, coord, l1, l2, s1, otro };
  for (const [nombre, u] of Object.entries(aplic)) for (let j = 0; j < 6; j++) await enviar(u, sA, i++);
  const total = async (u, extra) => (await pedir('GET', `/${sA.id}/resultados`, { usuario: u, ...extra }));
  const cuenta = async (u) => { const r = await total(u); return r.status === 200 ? r.datos.respuestas : r.status; };
  ok(await cuenta(admin) === 36, 'el administrador cuenta toda la campaña (6 personas × 6)', await cuenta(admin));
  ok(await cuenta(coord) === 24, 'la coordinadora: las suyas y las de sus líderes y sublíderes (6+6+6+6), no las del administrador ni las del testigo', await cuenta(coord));
  ok(await cuenta(l1) === 12, 'el líder: las suyas y las de su sublíder', await cuenta(l1));
  ok(await cuenta(l2) === 6, 'el otro líder: solo las suyas', await cuenta(l2));
  ok(await cuenta(s1) === 6, 'el sublíder: solo las suyas', await cuenta(s1));
  ok(await cuenta(otro) === 6, 'cualquier otro rol: solo las que él aplicó', await cuenta(otro));
  ok((await total(l2)).datos.cobertura.zonas.length === 1 && (await total(l2)).datos.minimo === 5, 'el mínimo se aplica DESPUÉS del alcance, también al líder');
  const sinPermiso = await total({ id: 99999, rol: 'invitado', nombre: 'Sin permiso' });
  ok(sinPermiso.status === 403, 'sin «Ver» en encuestas: 403');
  ok([403, 404].includes((await total(l1, { aspirante: l1.id })).status), 'el aspirante con sublicencia no llega a los resultados');
  const a1 = alcanceEncuestas(null, 'r'); const a2 = alcanceEncuestas({ cargo: 'lider', usuarioId: 7 }, 'x');
  ok(a1.sql === '1 = 0' && /x\.lider_id = \?/.test(a2.sql) && a2.valores[0] === 7, 'la regla pura: sin alcance, a nadie; el alias se respeta');
  await q('UPDATE encuesta_respuestas SET rama_aspirante_id = 4242 WHERE aplicada_por = ?', [l2.id]);
  ok(await cuenta(admin) === 30 && await cuenta(coord) === 18, 'las respuestas de la RAMA de un aspirante no las ve ni el administrador ni la coordinadora de la madre', [await cuenta(admin), await cuenta(coord)]);
  await q('UPDATE encuesta_respuestas SET rama_aspirante_id = NULL WHERE aplicada_por = ?', [l2.id]);

  /* ====================================================================================== 4. resultados por zona y pregunta */
  console.log('\n[4] Resultados: agregados, mínimo, textos fuera');
  const sB = await publicar(ENCUESTA({ titulo: 'Resultados por zona' }));
  const ap = await usuario('Aplicador de resultados', 'lider');
  const reparto = [[9103, 7], [9106, 6], [9104, 2], [9105, 1]];
  const hechas = [];
  let k2 = 0;
  for (const [zona, cuantas] of reparto) for (let j = 0; j < cuantas; j++) { await enviar(ap, sB, k2, { territorio_id: zona }); hechas.push({ zona, i: k2 }); k2++; }
  let r = (await pedir('GET', `/${sB.id}/resultados`, { usuario: admin })).datos;
  const q1 = r.preguntas.find((p) => p.orden === 1);
  ok(r.respuestas === 16 && r.minimo === 5 && r.marca === 'Uso interno – no publicable', 'son 16 respuestas, mínimo 5 y la marca «Uso interno – no publicable» viaja en el resultado', [r.respuestas, r.minimo, r.marca]);
  ok(q1.celdas.length === 1 && q1.celdas[0].zona === 'El Carmen' && q1.celdas[0].n === 7, 'solo «El Carmen» (7) se muestra sola; Barrio Dos (6) se une al grupo porque las dos chicas sumaban 3', q1.celdas.map((c) => [c.zona, c.n]));
  ok(q1.otras && q1.otras.zonas === 3 && q1.otras.n === 9 && q1.celdas_omitidas === 3, '«Otras zonas» agrupa 3 zonas con 9 personas, y las celdas omitidas están a la vista', q1.otras);
  ok(q1.total.n === 16 && q1.total.n === q1.celdas[0].n + q1.otras.n, 'el total es la suma exacta de lo mostrado: restar no destapa nada');
  const esperadoOp = (o) => hechas.filter((h) => 1 + (h.i % 3) === o).length;
  ok(q1.total.opciones.every((o, ix) => o.n === esperadoOp(ix + 1)) && q1.total.opciones[0].pct === Math.round((esperadoOp(1) / 16) * 1000) / 10, 'la opción única cuenta bien por opción y da el porcentaje', q1.total.opciones);
  const q2 = r.preguntas.find((p) => p.orden === 2);
  ok(q2.total.opciones.find((o) => o.id === 'o1').n === hechas.filter((h) => h.i % 2).length && q2.total.opciones.find((o) => o.id === 'o3').n === hechas.filter((h) => !(h.i % 2)).length, 'la opción múltiple cuenta cada opción elegida por persona');
  const q3 = r.preguntas.find((p) => p.orden === 3);
  const medio = Math.round((hechas.reduce((a, h) => a + 1 + (h.i % 5), 0) / 16) * 100) / 100;
  ok(q3.total.promedio === medio && q3.total.distribucion.length === 5 && q3.total.distribucion.reduce((a, d) => a + d.n, 0) === 16, 'la escala da el promedio y la distribución del 1 al 5', [q3.total.promedio, medio]);
  const q4 = r.preguntas.find((p) => p.orden === 4);
  ok(q4.total.promedio === 8.5 && q4.total.mediana === 8.5 && !('minimo' in q4.total) && !('maximo' in q4.total), 'el número da promedio y mediana, y NUNCA el mínimo ni el máximo (serían la respuesta de una persona)', q4.total);
  const q5 = r.preguntas.find((p) => p.orden === 5);
  ok(q5.sin_agregado === true && !q5.total && !q5.celdas, 'la pregunta de texto no tiene agregado');
  ok(!JSON.stringify(r).includes('SECRETO-DE-TEXTO'), 'ningún texto libre aparece en los resultados');
  // solo las ok
  await q(`UPDATE encuesta_respuestas SET revision = 'sospechosa' WHERE encuesta_id = ? AND aplicada_por = ? ORDER BY id LIMIT 4`, [sB.id, ap.id]);
  r = (await pedir('GET', `/${sB.id}/resultados`, { usuario: admin })).datos;
  ok(r.respuestas === 12 && r.fuera_por_revision === 4, 'las sospechosas no cuentan y se dice CUÁNTAS están fuera (no cuáles)', [r.respuestas, r.fuera_por_revision]);
  await q(`UPDATE encuesta_respuestas SET revision = 'ok' WHERE encuesta_id = ?`, [sB.id]);
  // agrupar por la zona que contiene
  r = (await pedir('GET', `/${sB.id}/resultados?agrupar=padre`, { usuario: admin })).datos;
  const q1p = r.preguntas.find((p) => p.orden === 1);
  ok(r.agrupar === 'padre' && q1p.celdas.length === 0 && q1p.otras && q1p.otras.zonas === 2 && q1p.otras.n === 16, 'agrupando por la zona que contiene quedan 2 celdas (la comuna con 13 y el municipio con 3): el municipio no llega y arrastra a la comuna a «Otras zonas»', q1p.otras);
  const sP = await publicar(ENCUESTA({ titulo: 'Barrios chicos' }));
  const ap2 = await usuario('Aplicador de barrios', 'lider');
  for (let j = 0; j < 3; j++) { await enviar(ap2, sP, j, { territorio_id: 9103 }); await enviar(ap2, sP, j + 3, { territorio_id: 9106 }); }
  const rz = (await pedir('GET', `/${sP.id}/resultados`, { usuario: admin })).datos;
  const rp = (await pedir('GET', `/${sP.id}/resultados?agrupar=padre`, { usuario: admin })).datos;
  const p1z = rz.preguntas.find((p) => p.orden === 1), p1p = rp.preguntas.find((p) => p.orden === 1);
  ok(p1z.celdas.length === 0 && p1z.otras.n === 6 && p1p.celdas.length === 1 && p1p.celdas[0].zona === 'Comuna Centro' && p1p.celdas[0].n === 6, 'dos barrios de 3 respuestas no llegan solos; agrupados en su comuna (6) sí: para eso sirve agrupar por la zona que contiene', [p1z.celdas.length, p1p.celdas.map((c) => [c.zona, c.n])]);
  // el mínimo se puede subir, no bajar, y vale para el administrador
  const baja = await pedir('PUT', '/config', { usuario: admin, json: { min_celda: 4 } });
  ok(baja.status === 400 && /no se puede bajar de 5/.test(baja.datos.error), 'bajar el mínimo de 5 se rechaza (400)', baja.datos);
  ok((await pedir('PUT', '/config', { usuario: admin, json: { min_celda: 1001 } })).status === 400 && (await pedir('PUT', '/config', { usuario: admin, json: { min_celda: 'x' } })).status === 400, 'y un valor absurdo también');
  await permisos('coordinador', 'encuestas', 1, 1, 1);
  ok((await pedir('PUT', '/config', { usuario: coord, json: { min_celda: 8 } })).status === 403, 'solo el administrador cambia el mínimo, aunque tenga «Editar»');
  ok((await pedir('PUT', '/config', { usuario: admin, json: { min_celda: 10 } })).status === 200 && (await pedir('GET', '/config', { usuario: coord })).datos.min_celda === 10, 'subirlo funciona y todos lo ven');
  r = (await pedir('GET', `/${sB.id}/resultados`, { usuario: admin })).datos;
  const q1b = r.preguntas.find((p) => p.orden === 1);
  ok(r.minimo === 10 && q1b.celdas.length === 0 && q1b.otras && q1b.otras.n === 16 && q1b.total.n === 16, 'con mínimo 10 ninguna zona llega sola: el administrador también ve todo agrupado', q1b.otras);
  await pedir('PUT', '/config', { usuario: admin, json: { min_celda: 17 } });
  r = (await pedir('GET', `/${sB.id}/resultados`, { usuario: admin })).datos;
  const q1c = r.preguntas.find((p) => p.orden === 1);
  ok(q1c.oculta === true && q1c.total === null && r.respuestas === null && r.cobertura.oculto === true && !JSON.stringify(r).includes('"n":16'), 'con mínimo 17 y 16 respuestas no se muestra NADA (ni el total)', [r.respuestas, q1c.oculta]);
  await pedir('PUT', '/config', { usuario: admin, json: { min_celda: 5 } });
  ok((await q(`SELECT COUNT(*) n FROM auditoria WHERE accion = 'encuesta_config'`))[0].n >= 3, 'cada cambio del mínimo queda en la auditoría');
  ok((await pedir('GET', `/${(await publicar(ENCUESTA({ titulo: 'Vacía' }))).id}/resultados`, { usuario: admin })).datos.respuestas === null, 'una encuesta sin respuestas: «menos de 5», no 0 ni error');
  const borr = await pedir('POST', '/', { usuario: admin, json: ENCUESTA({ titulo: 'Solo borrador' }) });
  ok((await pedir('GET', `/${borr.datos.id}/resultados`, { usuario: admin })).status === 404, 'un borrador no tiene resultados (404)');

  /* ====================================================================================== 5. cobertura y cuotas */
  console.log('\n[5] Cobertura frente a los votantes registrados, y cuotas');
  const filasV = [];
  const mas = (zona, cuantos) => { for (let j = 0; j < cuantos; j++) filasV.push([`Votante ${zona}-${j}`, `95${sello}${zona}${String(j).padStart(3, '0')}`.slice(0, 18), zona]); };
  mas(9103, 200); mas(9106, 5); mas(9104, 10);
  await q('INSERT INTO votantes (nombre, cedula, territorio_id) VALUES ?', [filasV]);
  r = (await pedir('GET', `/${sB.id}/resultados`, { usuario: admin })).datos;
  const cz = r.cobertura.zonas[0];
  ok(r.cobertura.zonas.length === 1 && cz.zona === 'El Carmen' && cz.respuestas === 7 && cz.votantes === 200 && cz.por_100 === 3.5, 'El Carmen: 7 respuestas frente a 200 votantes (3,5 por cada 100)', cz);
  ok(r.cobertura.otras && r.cobertura.otras.respuestas === 9 && r.cobertura.otras.votantes === 15 && r.cobertura.otras.zonas === 3, '«Otras zonas»: 9 respuestas frente a 15 votantes', r.cobertura.otras);
  ok(cz.sesgo === 'sub' && r.cobertura.otras.sesgo === 'sobre', 'la zona grande queda subrepresentada y el grupo chico sobrerrepresentado: el sesgo se ve', [cz.sesgo, r.cobertura.otras.sesgo]);
  const rpp = (await pedir('GET', `/${sP.id}/resultados?agrupar=padre`, { usuario: admin })).datos;
  ok(rpp.cobertura.zonas.length === 1 && rpp.cobertura.zonas[0].zona === 'Comuna Centro' && rpp.cobertura.zonas[0].votantes === 205, 'agrupando por la comuna, los votantes de sus dos barrios se suman (205)', rpp.cobertura.zonas[0]);
  const rsb = (await pedir('GET', `/${sB.id}/resultados?agrupar=padre`, { usuario: admin })).datos;
  ok(rsb.cobertura.otras && rsb.cobertura.otras.votantes === 215, 'y si la comuna y el municipio se solapan, los votantes se cuentan UNA vez (215, no 420)', rsb.cobertura.otras);
  const rc = (await pedir('GET', `/${sB.id}/resultados`, { usuario: l1 })).datos;
  ok(rc.respuestas === null, 'y a un líder sin respuestas propias le aparece «menos de 5», sin cobertura');
  // cuotas
  const cu = (lista, usuarioQ = admin) => pedir('PUT', `/${sB.id}/cuotas`, { usuario: usuarioQ, json: { cuotas: lista } });
  ok((await cu([{ territorio_id: 9103, meta: 4 }])).status === 400, 'una meta menor que el mínimo por celda se rechaza');
  ok((await cu([{ territorio_id: 99999, meta: 10 }])).status === 400, 'una zona que no es del catálogo se rechaza');
  ok((await cu([{ territorio_id: 9101, meta: 10 }])).status === 400, 'y con zonas finas, el municipio no sirve para una cuota');
  ok((await cu([{ territorio_id: 9103, meta: 10 }, { territorio_id: 9103, meta: 12 }])).status === 400, 'una zona repetida se rechaza');
  const guardadas = await cu([{ territorio_id: 9103, meta: 10 }, { territorio_id: 9104, meta: 5 }, { territorio_id: 9102, meta: 20 }]);
  ok(guardadas.status === 200 && guardadas.datos.guardadas === 3, 'se guardan las cuotas válidas', guardadas.datos);
  ok((await cu([{ territorio_id: 9103, meta: 10 }], coord)).status === 200, 'con «Editar» (aunque no sea administrador) también se pueden fijar');
  await cu([{ territorio_id: 9103, meta: 10 }, { territorio_id: 9104, meta: 5 }, { territorio_id: 9102, meta: 20 }]);
  const g = (await pedir('GET', `/${sB.id}/cuotas`, { usuario: coord })).datos;
  ok(g.cuotas.length === 3 && g.nivel === 'zona' && g.zonas.length === 5 && g.minimo === 5, 'GET trae las cuotas, el nivel y las zonas para elegir');
  r = (await pedir('GET', `/${sB.id}/resultados`, { usuario: admin })).datos;
  const porZ = Object.fromEntries(r.cuotas.map((c) => [c.zona, c]));
  ok(porZ['El Carmen'].avance === 7 && porZ['El Carmen'].pct === 70 && porZ['El Carmen'].completa === false, 'avance de una cuota: 7 de 10 (70 %)', porZ['El Carmen']);
  ok(porZ['La Cabaña'].avance === null && porZ['La Cabaña'].menos_de === 5, 'una zona con 2 respuestas NO muestra su avance exacto: «menos de 5»', porZ['La Cabaña']);
  ok(porZ['Comuna Centro'].avance === 13 && porZ['Comuna Centro'].completa === false, 'la cuota de una comuna cuenta los barrios que cuelgan de ella (13)', porZ['Comuna Centro']);
  ok((await pedir('PUT', `/${sB.id}/cuotas`, { usuario: l1, json: { cuotas: [] } })).status === 403, 'sin «Editar» no se fijan cuotas');
  ok((await pedir('GET', `/${sB.id}/cuotas`, { usuario: coord })).status === 200 && !JSON.stringify(g).includes('aplicador'), 'las cuotas no hablan de personas');

  /* ====================================================================================== 6. Excel */
  console.log('\n[6] Excel agregado');
  const sinCasilla = await pedir('GET', `/${sB.id}/exportar`, { usuario: coord, binario: true });
  ok(sinCasilla.status === 403, 'sin la casilla «Importar / Exportar» no sale el Excel (403), aunque se pueda ver');
  await permisos('coordinador', 'encuestas', 1, 1, 1, 1);
  const x = await pedir('GET', `/${sB.id}/exportar`, { usuario: admin, binario: true });
  ok(x.status === 200 && /spreadsheetml/.test(x.tipo) && /resultados-encuesta-\d+-\d{4}-\d{2}-\d{2}\.xlsx/.test(x.disposicion), 'el administrador lo descarga como .xlsx con nombre claro', [x.status, x.tipo, x.disposicion]);
  const libro = XLSX.read(x.buffer, { type: 'buffer' });
  ok(libro.SheetNames.join() === 'Notas,Resultados,Cobertura,Cuotas', 'cuatro hojas: Notas, Resultados, Cobertura y Cuotas', libro.SheetNames);
  const filasX = (h) => XLSX.utils.sheet_to_json(libro.Sheets[h], { header: 1, defval: '' });
  ok(libro.SheetNames.every((h) => filasX(h)[0][0] === 'Uso interno – no publicable'), 'LA MARCA «Uso interno – no publicable» es la primera fila de CADA hoja');
  const notas = filasX('Notas').map((f) => f.join(' | ')).join('\n');
  ok(/Resultados de la encuesta \| Resultados por zona/.test(notas) && /Respuestas contadas \| 16/.test(notas) && /Mínimo de respuestas por celda \| 5/.test(notas) && /Es un archivo agregado/.test(notas) && /muestra de conveniencia/.test(notas), 'la hoja de notas dice qué es, cuántas respuestas, el mínimo y que no es publicable', notas.slice(0, 300));
  const todo = libro.SheetNames.map((h) => JSON.stringify(filasX(h))).join();
  ok(!todo.includes('SECRETO-DE-TEXTO') && !/Aplicador de resultados/.test(todo), 'el Excel no trae textos libres ni el nombre de quien aplicó');
  const res1 = filasX('Resultados').filter((f) => /^1\./.test(f[0]));
  ok(res1.some((f) => f[2] === 'El Carmen') && res1.some((f) => /^Otras zonas \(3 zonas\)/.test(f[2])) && !res1.some((f) => f[2] === 'Barrio Dos' || f[2] === 'La Cabaña'), 'las celdas chicas NO aparecen por su nombre: están en «Otras zonas»');
  ok(libro.Props && /Uso interno – no publicable/.test(libro.Props.Title || ''), 'y la marca va también en las propiedades del libro');
  const auditoria = await q(`SELECT detalle FROM auditoria WHERE accion = 'exportar_excel' AND entidad = 'encuestas' ORDER BY id DESC LIMIT 1`);
  ok(auditoria.length === 1 && /sin respuestas sueltas, sin textos libres/.test(auditoria[0].detalle), 'la exportación queda en la auditoría');
  ok((await pedir('GET', `/${sB.id}/exportar`, { usuario: coord, binario: true })).status === 200, 'con la casilla encendida, la coordinadora también la descarga');
  ok((await pedir('GET', `/${borr.datos.id}/exportar`, { usuario: admin, binario: true })).status === 404, 'un borrador no se exporta (404)');

  /* ====================================================================================== 7. señales de calidad */
  console.log('\n[7] Señales de calidad');
  const sC = await publicar(ENCUESTA({ titulo: 'Calidad', pide_ubicacion: 1 }));
  const estado = async (id) => (await q('SELECT revision, senales FROM encuesta_respuestas WHERE id = ?', [id]))[0];
  const tiene = (f, s) => !!f.senales && f.senales.split(',').includes(s);
  // ritmo por hora de captura
  const r1 = await usuario('Ritmo uno', 'lider');
  const t0 = Date.now() - 3 * 3600000;
  const ids1 = [];
  const orden = [4, 0, 7, 2, 8, 1, 5, 3, 6];                            // se SUBEN en desorden: lo que cuenta es cuándo se tomaron
  for (const j of orden) ids1.push((await enviar(r1, sC, j, { respondida_en: new Date(t0 + j * 20000).toISOString(), iniciada_en: new Date(t0 + j * 20000 - 60000).toISOString() })).id);
  const e1 = await Promise.all(ids1.map(estado));
  ok(e1.every((f) => tiene(f, 'ritmo') && f.revision === 'sospechosa'), 'RITMO: 9 respuestas en 3 minutos de un mismo aplicador, subidas en desorden: las 9 quedan sospechosas', e1);
  const r2 = await usuario('Ritmo dos', 'lider');
  const ids2 = [];
  for (let j = 0; j < 9; j++) ids2.push((await enviar(r2, sC, j + 100, { respondida_en: new Date(Date.now() - 6 * 3600000 + j * 20 * 60000).toISOString(), iniciada_en: new Date(Date.now() - 6 * 3600000 + j * 20 * 60000 - 60000).toISOString() })).id);
  ok((await Promise.all(ids2.map(estado))).every((f) => f.revision === 'ok' && !f.senales), 'RITMO: 9 respuestas subidas JUNTAS pero tomadas cada 20 minutos (una cola sin señal) NO son sospechosas');
  const r3 = await usuario('Ritmo tres', 'lider');
  const ids3 = [];
  for (let j = 0; j < 7; j++) ids3.push((await enviar(r3, sC, j + 200, { respondida_en: new Date(t0 + 4000000 + j * 10000).toISOString(), iniciada_en: new Date(t0 + 4000000 + j * 10000 - 60000).toISOString() })).id);
  ok((await Promise.all(ids3.map(estado))).every((f) => f.revision === 'ok'), 'RITMO: 7 en un minuto no llegan al umbral de 8');
  // duración
  const d1 = await usuario('Duracion', 'lider');
  const rapida = await enviar(d1, sC, 300, { iniciada_en: new Date(Date.now() - 180000 * 301 - 3000).toISOString(), respondida_en: new Date(Date.now() - 180000 * 301).toISOString() });
  const normalR = await enviar(d1, sC, 301);
  ok(tiene(await estado(rapida.id), 'duracion') && (await estado(normalR.id)).revision === 'ok', 'DURACIÓN: 3 segundos para 5 preguntas es sospechoso; 60 segundos no');
  // misma opción
  const sM = await publicar({ titulo: 'Misma opcion', preguntas: [1, 2, 3, 4].map((x) => ({ tipo: 'escala', enunciado: `¿Qué tan bien está el servicio ${x}?` })) });
  const m1 = await usuario('Misma uno', 'lider'), m2 = await usuario('Misma dos', 'lider');
  const cm = (u, d, valores, i) => enviar(u, d, i, { respuestas: d.preguntas.map((p, ix) => ({ pregunta_id: p.id, valor: valores[ix] })), celda_ix: undefined, celda_iy: undefined });
  const mi = await cm(m1, sM, [3, 3, 3, 3], 400);
  const mv = await cm(m2, sM, [1, 2, 3, 4], 401);
  ok(tiene(await estado(mi.id), 'misma_opcion') && (await estado(mv.id)).revision === 'ok', 'MISMA OPCIÓN: cuatro escalas con el mismo valor es sospechoso; valores distintos, no');
  // vector repetido
  const v1 = await usuario('Vector uno', 'lider');
  const fijo = (d, i) => cuerpo(d, i, {}).respuestas.map((x) => (x.pregunta_id === d.preguntas[3].id ? { ...x, valor: 42 } : (x.texto ? { ...x, texto: 'igual' } : x)));
  const mismaRespuesta = (i) => enviar(v1, sC, 500 + i * 3, { respuestas: fijo(sC, 0) });
  const va = await mismaRespuesta(0), vb = await mismaRespuesta(1);
  ok((await estado(va.id)).revision === 'ok' && (await estado(vb.id)).revision === 'ok', 'VECTOR REPETIDO: dos respuestas iguales todavía no son sospechosas');
  const vc = await mismaRespuesta(2);
  const evs = await Promise.all([va, vb, vc].map((x) => estado(x.id)));
  ok(evs.every((f) => tiene(f, 'vector_repetido') && f.revision === 'sospechosa'), 'VECTOR REPETIDO: con la tercera idéntica se marcan las TRES (también las dos anteriores)', evs);
  const otroV = await usuario('Vector dos', 'lider');
  const vd = await enviar(otroV, sC, 520, { respuestas: fijo(sC, 0) });
  ok((await estado(vd.id)).revision === 'ok', 'VECTOR REPETIDO: otra persona con las mismas respuestas NO cuenta (es por aplicador)');
  // celda lejos
  const c1 = await usuario('Celda', 'lider');
  const cercanas = [];
  for (let j = 0; j < 5; j++) cercanas.push(await enviar(c1, sC, 600 + j * 4, { territorio_id: 9106 }));
  const lejana = await enviar(c1, sC, 630, { territorio_id: 9106, celda_ix: Math.floor(-75.0 / 0.005), celda_iy: Math.floor(10.0 / 0.005) });
  ok(tiene(await estado(lejana.id), 'celda_lejos') && (await Promise.all(cercanas.map((x) => estado(x.id)))).every((f) => f.revision === 'ok'), 'CELDA LEJOS: a más de 15 km de las otras cinco de su zona es sospechosa; las cercanas no');
  const cercaOtra = await enviar(c1, sC, 640, { territorio_id: 9106 });
  ok((await estado(cercaOtra.id)).revision === 'ok', '  (una más, cercana, sigue bien)');
  // zona ajena
  const z1 = await usuario('Zona uno', 'lider'); await estructura(z1, 'lider', coord, 9103);
  const z2 = await usuario('Zona dos', 'lider'); await estructura(z2, 'lider', coord, 9101);
  const z3 = await usuario('Zona tres', 'lider'); await estructura(z3, 'lider', coord, null);
  const za = await enviar(z1, sC, 700, { territorio_id: 9103, celda_ix: undefined, celda_iy: undefined });
  const zb = await enviar(z1, sC, 705, { territorio_id: 9104, celda_ix: undefined, celda_iy: undefined });
  const zc = await enviar(z2, sC, 710, { territorio_id: 9104, celda_ix: undefined, celda_iy: undefined });
  const zd = await enviar(z3, sC, 715, { territorio_id: 9104, celda_ix: undefined, celda_iy: undefined });
  ok((await estado(za.id)).revision === 'ok' && tiene(await estado(zb.id), 'zona_ajena'), 'ZONA AJENA: quien cubre El Carmen y responde en La Cabaña queda sospechoso; en su zona, no', [await estado(za.id), await estado(zb.id)]);
  ok((await estado(zc.id)).revision === 'ok' && (await estado(zd.id)).revision === 'ok', 'ZONA AJENA: quien cubre el municipio puede aplicar en sus veredas, y quien no tiene territorio asignado no se mide');
  const resp = await pedir('GET', '/', { usuario: admin });
  ok(resp.status === 200, 'el constructor sigue respondiendo');
  const ultima = await E.registrarRespuesta({ usuario: z3, body: cuerpo(sC, 720, { territorio_id: 9104, celda_ix: undefined, celda_iy: undefined }) });
  ok(Object.keys(ultima).sort().join() === 'duplicado,id', 'a quien aplica NO se le dice qué señales saltaron (solo id y duplicado)');

  /* ====================================================================================== 8. revisar, panel, textos */
  console.log('\n[8] Revisar (aprobar, excluir, restaurar), panel por aplicador y cola de textos');
  const revisar = (u, ids, accion, enc = sC.id) => pedir('POST', `/${enc}/calidad/revisar`, { usuario: u, json: { ids, accion } });
  const idsVec = [va.id, vb.id, vc.id];
  ok((await revisar(coord, idsVec, 'aprobar')).status === 403, 'revisar es solo del administrador (la coordinadora, aunque tenga «Editar», recibe 403)');
  ok((await revisar(admin, [], 'aprobar')).status === 400 && (await revisar(admin, idsVec, 'inventar')).status === 400, 'sin ids o con una acción inválida: 400');
  const antes = (await pedir('GET', `/${sC.id}/resultados`, { usuario: admin })).datos;
  const ap1 = await revisar(admin, idsVec, 'aprobar');
  const despuesAp = (await pedir('GET', `/${sC.id}/resultados`, { usuario: admin })).datos;
  ok(ap1.status === 200 && ap1.datos.cambiadas === 3 && despuesAp.respuestas === antes.respuestas + 3 && despuesAp.fuera_por_revision === antes.fuera_por_revision - 3, 'aprobar las tres las devuelve a los resultados', [antes.respuestas, despuesAp.respuestas]);
  const fa = (await q('SELECT revision, revisada_por, revisada_en FROM encuesta_respuestas WHERE id = ?', [va.id]))[0];
  ok(fa.revision === 'ok' && fa.revisada_por === 1 && fa.revisada_en, 'queda anotado quién (el administrador) y cuándo');
  const vcuarta = await mismaRespuesta(3);
  ok((await estado(va.id)).revision === 'ok' && (await estado(vc.id)).revision === 'ok' && tiene(await estado(vcuarta.id), 'vector_repetido'), 'una aprobada NO se vuelve a marcar; la cuarta idéntica sí queda sospechosa');
  const ex = await revisar(admin, [vcuarta.id], 'excluir');
  ok(ex.status === 200 && (await estado(vcuarta.id)).revision === 'excluida', 'excluir la deja excluida');
  const re = await revisar(admin, [vcuarta.id, va.id], 'restaurar');
  const fr = [await estado(vcuarta.id), await estado(va.id)];
  ok(re.datos.cambiadas === 2 && fr[0].revision === 'sospechosa' && fr[1].revision === 'sospechosa', 'restaurar las devuelve a «sospechosa» (todo es reversible)', fr);
  ok((await q(`SELECT revisada_por FROM encuesta_respuestas WHERE id = ?`, [va.id]))[0].revisada_por === null, '  y borra la marca de revisión');
  const nuevaOk = await enviar(otro, sC, 800);
  const rok = await revisar(admin, [nuevaOk.id], 'restaurar');
  ok((await estado(nuevaOk.id)).revision === 'ok', 'restaurar una que nunca tuvo señales la deja «ok»');
  const aud = (await q(`SELECT accion FROM auditoria WHERE entidad = 'encuestas' AND accion LIKE 'encuesta_revisar_%'`)).map((f) => f.accion);
  ok(['encuesta_revisar_aprobar', 'encuesta_revisar_excluir', 'encuesta_revisar_restaurar'].every((a) => aud.includes(a)), 'las tres acciones quedan en la auditoría', [...new Set(aud)]);
  // el panel
  const noAdmin = await pedir('GET', `/${sC.id}/calidad`, { usuario: coord });
  ok(noAdmin.status === 403, 'el panel de calidad es solo del administrador (403 a la coordinadora con «Ver»)');
  const panel = await pedir('GET', `/${sC.id}/calidad`, { usuario: admin });
  const pr1 = panel.datos.aplicadores.find((a) => a.aplicador === 'Ritmo uno');
  ok(panel.status === 200 && pr1 && pr1.total === 9 && pr1.sospechosas === 9 && pr1.pct_sospechosas === 100 && pr1.senales.some((s) => s.codigo === 'ritmo' && s.n === 9), 'el panel dice, por aplicador, cuántas tiene, cuántas sospechosas y qué señales', pr1);
  const pr2 = panel.datos.aplicadores.find((a) => a.aplicador === 'Ritmo dos');
  ok(pr2 && pr2.sospechosas === 0 && pr2.mediana_seg === 60, 'y la mediana de lo que tarda (60 s) en quien no tiene señales', pr2);
  ok(panel.datos.respuestas.length >= 10 && panel.datos.respuestas.every((x) => x.senales.length >= 1 && x.aplicador && x.zona && x.respondida_en), 'la lista de sospechosas trae aplicador, zona, hora y señales');
  ok(!panel.texto.includes('SECRETO-DE-TEXTO') && !/"(opcion|opciones|valor|valor_num|valor_texto)"/.test(panel.texto), 'EL PANEL NO LLEVA NI UNA RESPUESTA: ni opciones, ni valores, ni textos');
  const excl = (await pedir('GET', `/${sC.id}/calidad?ver=excluida`, { usuario: admin })).datos;
  ok(excl.ver === 'excluida' && Array.isArray(excl.respuestas), 'se pueden ver las excluidas y las aprobadas por separado');
  // textos
  const mala = await pedir('GET', `/${sC.id}/textos`, { usuario: coord });
  ok(mala.status === 403, 'la cola de textos libres es solo del administrador');
  const cola = await pedir('GET', `/${sC.id}/textos`, { usuario: admin });
  ok(cola.status === 200 && cola.datos.textos.length > 5 && cola.datos.textos.every((t) => t.texto && t.zona && t.dia && !('aplicador' in t) && !('aplicada_por' in t) && !('respuesta_id' in t)), 'la cola trae el texto, la pregunta, la zona y el día — y NADA de quién aplicó', cola.datos.textos[0]);
  const t1 = cola.datos.textos[0], t2 = cola.datos.textos[1];
  ok((await pedir('POST', `/${sC.id}/textos/${t1.id}`, { usuario: admin, json: { accion: 'borrar' } })).status === 200 && (await q('SELECT valor_texto v, texto_revisado r FROM encuesta_respuesta_items WHERE id = ?', [t1.id]))[0].v === null, 'borrar un texto lo borra de verdad');
  ok((await pedir('POST', `/${sC.id}/textos/${t2.id}`, { usuario: admin, json: { accion: 'conservar' } })).status === 200 && (await q('SELECT valor_texto v, texto_revisado r FROM encuesta_respuesta_items WHERE id = ?', [t2.id]))[0].r === 1, 'conservar lo marca como visto y lo deja');
  const cola2 = (await pedir('GET', `/${sC.id}/textos`, { usuario: admin })).datos.textos;
  const colaTodos = (await pedir('GET', `/${sC.id}/textos?ver=todos`, { usuario: admin })).datos.textos;
  ok(!cola2.some((t) => t.id === t1.id || t.id === t2.id) && colaTodos.some((t) => t.id === t2.id) && !colaTodos.some((t) => t.id === t1.id), 'los vistos salen de «pendientes»; el borrado desaparece; el conservado sigue en «todos»');
  ok((await pedir('POST', `/${sC.id}/textos/${t1.id}`, { usuario: admin, json: { accion: 'borrar' } })).status === 404, 'borrar dos veces: 404');
  ok((await pedir('POST', `/${sB.id}/textos/${t2.id}`, { usuario: admin, json: { accion: 'borrar' } })).status === 404, 'el texto de otra encuesta no se toca (404)');
  ok((await pedir('POST', `/${sC.id}/textos/${cola2[0].id}`, { usuario: admin, json: { accion: 'inventar' } })).status === 400, 'una acción inválida: 400');
  const audT = (await q(`SELECT accion FROM auditoria WHERE accion LIKE 'encuesta_texto_%'`)).map((f) => f.accion);
  ok(audT.includes('encuesta_texto_borrar') && audT.includes('encuesta_texto_conservar'), 'borrar y conservar quedan en la auditoría');

  /* ====================================================================================== 9. el código */
  console.log('\n[9] Código de las pantallas');
  const html = leer('public/encuestas.html');
  ok(['Resultados', 'Cuotas por zona', 'Calidad', 'Textos libres', 'Descargar en Excel', 'Otras zonas', 'Fuera por revisión', 'Cobertura'].every((t) => html.includes(t)), 'encuestas.html trae resultados, cuotas, calidad, textos, Excel y cobertura');
  ok(/esAdmin\(\) \? \[\['calidad'/.test(html), 'las pestañas Calidad y Textos libres solo se ofrecen al administrador');
  ok(/Uso interno – no publicable/.test(leer('lib/encuestasResultados.js')) && !/desde|hasta|filtros/i.test(leer('routes/encuestas.routes.js').split('RESULTADOS (308)')[1].split('CONSTRUCTOR')[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/'[^']*'/g, '')), 'no hay filtros por fecha ni por aplicador en las rutas de resultados');

  console.log(fallos ? `\n${fallos} FALLO(S).` : '\nTodo bien.');
  servidor.close();
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch(async (e) => { console.error('ERROR en la prueba:', e); try { await pool.end(); } catch (_) { /* ya cerrado */ } process.exit(1); });
