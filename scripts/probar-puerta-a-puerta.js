#!/usr/bin/env node
// scripts/probar-puerta-a-puerta.js
//
// Prueba del PUERTA A PUERTA (parche 309), Fases 0 y 1, del lado del servidor:
//   · migración repetible: tres tablas, `votantes.no_visitar`, la franja, y DOS módulos apagados de fábrica (solo el administrador);
//   · LISTA CERRADA DE COLUMNAS de las tres tablas y de lo que baja al celular (la lista mínima): nunca cédula, teléfono, correo, `apoya_a`,
//     observaciones ni el id de la ficha; y una puerta ya cerrada no manda ni nombre, ni dirección, ni coordenadas;
//   · ninguna columna guarda la HORA de la visita (solo fecha y franja) ni la ubicación de quien visita;
//   · permisos EXIGIDOS en el servidor, en los dos módulos y en cada nivel; el aspirante con sublicencia no llega;
//   · el ALCANCE: el de quien va a visitar (líder, sublíder), igual al que calcula el middleware; el de quien arma; la re-validación al leer;
//   · la franja horaria (bordes incluidos, configurable entre 07:00 y 19:00), el tope de 3 intentos, las 24 horas entre uno y otro, los 60 días sin
//     volver a asignar, el bloqueo del día de la elección (con la fecha de CAPTURA) y la idempotencia por cliente_uuid;
//   · `no_visitar` NO toca `no_contactar` (salvo la casilla «tampoco quiere mensajes»), «interesado» no escribe `apoya_a`;
//   · la auditoría de cada lista armada y de cada descarga; la retención; el código del celular (cola, copia, service worker, sin mapas ni compartir).
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada309 node scripts/probar-puerta-a-puerta.js
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
const pool = require('../config/db');
const R = require('../public/js/puerta-reglas');
const P = require('../lib/puertaAPuerta');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }
const uuid = () => crypto.randomUUID();
const raiz = path.join(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const mismo = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
app.use('/api/puerta-a-puerta', require('../routes/puertaAPuerta.routes'));
let base = '';
async function pedir(metodo, ruta, { json, usuario, aspirante } = {}) {
  const h = { 'X-Forwarded-For': '198.51.100.9', 'User-Agent': 'prueba/1.0' };
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  if (aspirante) h['X-Test-Aspirante'] = String(aspirante);
  const r = await fetch(base + '/api/puerta-a-puerta' + ruta, { method: metodo, headers: h, body });
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
  return { status: r.status, datos, texto, cabeceras: r.headers };
}

let n = 0;
const sello = String(Date.now()).slice(-7);            // para poder correr la prueba más de una vez sobre la misma base
async function usuario(nombre, rol) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, `97${sello}${n}`, `u97${sello}${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  return { id: r.insertId, rol, nombre };
}
async function estructura(u, cargo, supervisor) {
  await pool.query('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo) VALUES (?, ?, ?, 1)', [u.id, cargo, supervisor ? supervisor.id : null]);
}
async function permisos(rol, modulo, ver, editar, agregar) {
  await pool.query(`INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE permitido = VALUES(permitido), editar = VALUES(editar), agregar = VALUES(agregar)`, [rol, modulo, ver, editar, agregar]);
}
async function config(c) {
  const sets = [], v = [];
  for (const [k, val] of Object.entries(c)) { sets.push(`${k} = ?`); v.push(val); }
  await q(`UPDATE configuracion_campana SET ${sets.join(', ')} WHERE id = 1`, v);
}
let nv = 0;
async function votante(o) {
  nv++;
  const [r] = await pool.query(
    `INSERT INTO votantes (nombre, cedula, telefono, email, direccion, latitud, longitud, territorio_id, lider_id, sublider_id, consentimiento_autorizado, no_visitar, apoya_a, observaciones, categoria)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'votante')`,
    [o.nombre, `96${sello}${String(nv).padStart(3, '0')}`, o.telefono || `3${sello}${nv}`.slice(0, 10), `v${sello}${nv}@secreto.test`,
      o.sinDireccion ? '' : (o.direccion || `Calle ${nv} # 1-${nv}`), o.lat === undefined ? 5.07 + nv * 0.001 : o.lat, o.lon === undefined ? -75.51 - nv * 0.001 : o.lon,
      o.zona || null, o.lider ? o.lider.id : null, o.sublider ? o.sublider.id : null, o.sinConsentimiento ? 0 : 1, o.noVisitar ? 1 : 0,
      JSON.stringify(['alcaldia']), `OBS-SECRETA-${sello}-${nv}`]);
  return { id: r.insertId, nombre: o.nombre };
}
async function territorio(tipo, nombre, padre) {
  const [r] = await pool.query('INSERT INTO territorios (tipo, nombre, padre_id) VALUES (?, ?, ?)', [tipo, nombre, padre ? padre.id : null]);
  return { id: r.insertId, nombre };
}
const hoyCol = () => R.colombiaDe(new Date()).fecha;
/** El instante (ISO) de «hace `dias` días a las HH:MM de Colombia». */
const inst = (dias, hhmm) => new Date(`${R.sumarDias(hoyCol(), -dias)}T${hhmm}:00-05:00`).toISOString();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
  await config({ fecha_eleccion: null, puerta_franja_desde: '08:00', puerta_franja_hasta: '18:00', anonimizar_solicitudes_meses: 6 });
  await q(`DELETE FROM permisos_rol WHERE modulo IN ('puerta_listas','puerta_visitas') AND rol <> 'admin'`);

  /* ============================================================================================ 1. la migración */
  console.log('\n[1] La migración: tablas, columnas y módulos apagados de fábrica');
  const tablas = (await q(`SELECT table_name t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'puerta\\_%'`)).map((f) => f.t || f.T).sort();
  ok(mismo(tablas, ['puerta_items', 'puerta_listas', 'puerta_visitas']), 'las tres tablas existen', tablas);
  const colV = await q(`SELECT column_name c, column_type t, column_default d, is_nullable nul FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'votantes' AND column_name LIKE 'no\\_visitar%'`);
  ok(colV.length === 2 && colV.find((c) => c.c === 'no_visitar') && String(colV.find((c) => c.c === 'no_visitar').d) === '0', 'votantes.no_visitar (por omisión 0) y no_visitar_fecha', colV);
  const modulos = await q(`SELECT rol, modulo, permitido FROM permisos_rol WHERE modulo IN ('puerta_listas','puerta_visitas')`);
  ok(['puerta_listas', 'puerta_visitas'].every((m) => modulos.some((x) => x.modulo === m && x.rol === 'admin' && Number(x.permitido) === 1)), 'el administrador tiene los dos módulos');
  ok(modulos.filter((x) => x.rol !== 'admin' && Number(x.permitido) === 1).length === 0, 'APAGADOS de fábrica: ningún otro rol los tiene', modulos.filter((x) => Number(x.permitido) === 1));
  const cfg0 = await q(`SELECT puerta_franja_desde d, puerta_franja_hasta h FROM configuracion_campana WHERE id = 1`);
  ok(cfg0[0] && cfg0[0].d === '08:00' && cfg0[0].h === '18:00', 'la franja de fábrica es 08:00 a 18:00', cfg0);
  ok(leer('routes/permisos.routes.js').includes("'puerta_listas'") && leer('routes/permisos.routes.js').includes("'puerta_visitas'"), 'los dos módulos están en la matriz de permisos (Asignación de permisos)');
  const politica = await q(`SELECT contenido FROM contenido_paginas WHERE clave = 'politica_privacidad'`);
  ok(politica.length && !/visita domiciliaria/i.test(politica[0].contenido), 'la política de privacidad NO se tocó: la finalidad nueva espera el visto bueno del dueño');

  /* ====================================================================== 2. la lista cerrada de columnas */
  console.log('\n[2] Lista cerrada de columnas: sin hora exacta, sin ubicación de quien visita, sin datos de la persona');
  const columnas = async (t) => (await q(`SELECT column_name c, data_type dt FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position`, [t]));
  const cL = await columnas('puerta_listas'), cI = await columnas('puerta_items'), cVi = await columnas('puerta_visitas');
  const nombresDe = (f) => f.map((x) => x.c || x.C);
  ok(mismo(nombresDe(cL), ['id', 'cliente_uuid', 'nombre', 'territorio_id', 'zona_texto', 'asignada_a', 'creada_por', 'estado', 'rama_aspirante_id', 'aspirante_id', 'creada_en', 'cerrada_en']), 'puerta_listas: columnas exactas', nombresDe(cL));
  ok(mismo(nombresDe(cI), ['id', 'lista_id', 'votante_id', 'estado', 'intentos', 'ultimo_resultado', 'ultima_fecha', 'ultima_franja', 'anonimizado_en']), 'puerta_items: columnas exactas (sin nombre, dirección ni teléfono: se leen de la ficha)', nombresDe(cI));
  ok(mismo(nombresDe(cVi), ['id', 'cliente_uuid', 'item_id', 'lista_id', 'resultado', 'fecha', 'franja', 'territorio_id', 'registrada_por']), 'puerta_visitas: columnas exactas', nombresDe(cVi));
  const instantes = (f) => f.filter((x) => ['datetime', 'timestamp', 'time'].includes(String(x.dt || x.DT).toLowerCase())).map((x) => x.c || x.C);
  ok(instantes(cVi).length === 0, 'puerta_visitas NO tiene ninguna columna con hora (solo fecha y franja)', instantes(cVi));
  ok(mismo(instantes(cI), ['anonimizado_en']), 'puerta_items solo tiene el instante en que se cortó el vínculo (no el de una visita)', instantes(cI));
  const lista = nombresDe(cL).concat(nombresDe(cI), nombresDe(cVi));
  ok(!lista.some((c) => /lat|lon|lng|ubicacion|gps|cedula|telefono|email|direccion|hora|apoya|observ|solicitud_id|nombre_votante/i.test(c.replace(/^nombre$/, ''))), 'ninguna columna de identidad, de ubicación, de hora ni de vínculo con Solicitudes', lista);
  const fk = await q(`SELECT delete_rule r FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND table_name = 'puerta_items' AND referenced_table_name = 'votantes'`);
  ok(fk.length === 1 && (fk[0].r || fk[0].R) === 'SET NULL', 'la llave de puerta_items hacia votantes es ON DELETE SET NULL (borrar la ficha deja la puerta sin nadie)', fk);

  /* ==================================================================================== 3. las reglas puras */
  console.log('\n[3] Las reglas (public/js/puerta-reglas.js, el mismo archivo del servidor y del celular)');
  ok(R.MAX_INTENTOS === 3 && R.HORAS_ENTRE_INTENTOS === 24 && R.DIAS_SIN_REASIGNAR === 60 && R.HORAS_COPIA === 48 && R.MAX_ITEMS_LISTA === 300, 'tres intentos, 24 horas, 60 días, copia de 48 horas, 300 por lista');
  ok(R.validarFranja('08:00', '18:00').ok && R.validarFranja('07:00', '19:00').ok, 'franjas válidas: 08:00–18:00 y los extremos 07:00–19:00');
  ok(!R.validarFranja('06:59', '18:00').ok && !R.validarFranja('08:00', '19:01').ok && !R.validarFranja('10:00', '10:30').ok && !R.validarFranja('12:00', '09:00').ok && !R.validarFranja('abc', '18:00').ok, 'franjas inválidas: antes de 07:00, después de 19:00, de menos de una hora, al revés o sin ser hora');
  ok(R.franjaDe(0) === 'manana' && R.franjaDe(719) === 'manana' && R.franjaDe(720) === 'tarde' && R.franjaDe(1019) === 'tarde' && R.franjaDe(1020) === 'noche', 'las franjas del día: mañana hasta 11:59, tarde hasta 16:59, noche desde las 17:00');
  const f8 = R.validarFranja('08:00', '18:00');
  ok(R.enFranja(480, f8.desde, f8.hasta) && R.enFranja(1079, f8.desde, f8.hasta) && !R.enFranja(479, f8.desde, f8.hasta) && !R.enFranja(1080, f8.desde, f8.hasta), 'la franja incluye las 08:00 y las 17:59 y excluye las 07:59 y las 18:00');
  ok(R.reintentoDesde('2026-11-03', 'manana') === '2026-11-04 12:00' && R.reintentoDesde('2026-11-03', 'tarde') === '2026-11-04 17:00' && R.reintentoDesde('2026-11-03', 'noche') === '2026-11-05 00:00' && R.reintentoDesde('2026-12-31', 'noche') === '2027-01-02 00:00', 'las 24 horas se cuentan desde el FINAL de la franja del intento (cota prudente)');
  const t = (s) => new Date(s + '-05:00');
  ok(!R.puedeReintentar('2026-11-03', 'manana', t('2026-11-04T11:59:00')) && R.puedeReintentar('2026-11-03', 'manana', t('2026-11-04T12:00:00')), 'mañana del día 3 → no se puede volver el 4 a las 11:59, sí a las 12:00');
  ok(R.esDiaDeLaEleccion('2026-11-08', t('2026-11-08T00:00:00')) && R.esDiaDeLaEleccion('2026-11-08', t('2026-11-08T23:59:00')) && !R.esDiaDeLaEleccion('2026-11-08', t('2026-11-09T00:00:00')) && !R.esDiaDeLaEleccion(null, t('2026-11-08T10:00:00')), 'el día de la elección se juzga por la fecha de Colombia (de las 00:00 a las 23:59)');
  ok(!R.caducoLaCopia(1000, 1000 + 48 * 3600 * 1000 - 1) && R.caducoLaCopia(1000, 1000 + 48 * 3600 * 1000) && R.caducoLaCopia('x', 5), 'la copia del celular caduca a las 48 horas exactas (y una fecha ilegible caduca)');
  // El puerto de ordenarPorCercania contra el original del servidor, sobre miles de casos.
  const T = require('../lib/transporteDiaD'), J = require('../lib/jornadaDiaD');
  let igual = 0, distIgual = 0; const total = 3000;
  for (let i = 0; i < total; i++) {
    const k = 1 + Math.floor(Math.random() * 14);
    const ps = Array.from({ length: k }, (_, j) => ({ id: 100 + j, orden: Math.floor(Math.random() * 6),
      lat: Math.random() < 0.15 ? null : 5 + Math.random() * 0.05, lon: Math.random() < 0.15 ? (Math.random() < 0.5 ? '' : null) : -75.5 + Math.random() * 0.05 }));
    const ini = Math.random() < 0.5 ? { lat: 5 + Math.random() * 0.05, lon: -75.5 + Math.random() * 0.05 } : null;
    if (mismo(T.ordenarPorCercania(ps, ini), R.ordenarPorCercania(ps, ini))) igual++;
    const a = [5 + Math.random(), -75 - Math.random(), 5 + Math.random(), -75 - Math.random()];
    if (J.distanciaMetros(...a) === R.distanciaMetros(...a)) distIgual++;
  }
  ok(igual === total, `ordenarPorCercania del celular da EXACTAMENTE el orden del servidor en ${total} casos al azar (con y sin punto de partida, con coordenadas vacías)`, igual);
  ok(distIgual === total && R.distanciaMetros(null, 1, 2, 3) === null && R.distanciaMetros('', 1, 2, 3) === null, 'distanciaMetros igual a la del servidor, y nula sin coordenadas');

  /* ===================================================================================== 4. la gente de prueba */
  const admin = await usuario('Admin Prueba', 'admin');
  const coord = await usuario('Coordinador Prueba', 'coordinador'); await estructura(coord, 'coordinador', null);
  const lid1 = await usuario('Líder Uno', 'lider'); await estructura(lid1, 'lider', coord);
  const lid2 = await usuario('Líder Dos', 'lider'); await estructura(lid2, 'lider', coord);
  const lid3 = await usuario('Líder Tres (de otra rama)', 'lider'); await estructura(lid3, 'lider', null);
  const sub1 = await usuario('Sublíder Uno', 'sublider'); await estructura(sub1, 'usuario', lid1);
  const test1 = await usuario('Testigo Uno', 'testigo');
  const com = await territorio('comuna', `Comuna ${sello}`), b1 = await territorio('barrio', `Barrio Uno ${sello}`, com), b2 = await territorio('barrio', `Barrio Dos ${sello}`, com), b3 = await territorio('barrio', `Barrio Tres ${sello}`);

  /* ================================================================================================ 5. los permisos */
  console.log('\n[5] Permisos exigidos en el servidor, en los dos módulos y en cada nivel');
  ok((await pedir('GET', '/mias')).status === 401 || (await pedir('GET', '/mias')).status === 403, 'sin sesión no entra');
  ok((await pedir('GET', '/mias', { usuario: lid1 })).status === 403, 'de fábrica el líder NO ve su lista (módulo apagado)');
  ok((await pedir('GET', '/listas', { usuario: coord })).status === 403 && (await pedir('POST', '/listas', { usuario: coord, json: {} })).status === 403, 'de fábrica el coordinador NO arma ni ve listas');
  ok((await pedir('GET', '/mias', { usuario: admin })).status === 200 && (await pedir('GET', '/listas', { usuario: admin })).status === 200, 'el administrador pasa siempre');
  await permisos('lider', 'puerta_visitas', 1, 0, 0); await permisos('sublider', 'puerta_visitas', 1, 0, 1);
  ok((await pedir('GET', '/mias', { usuario: lid1 })).status === 200, 'con «Ver» el líder baja su lista');
  ok((await pedir('POST', '/visitas', { usuario: lid1, json: { cliente_uuid: uuid(), item_id: 1, resultado: 'no_abrio', marcado_en: inst(1, '10:00') } })).status === 403, 'sin «Agregar» el líder no puede enviar un resultado');
  await permisos('lider', 'puerta_visitas', 1, 0, 1);
  await permisos('coordinador', 'puerta_listas', 1, 0, 1);
  ok((await pedir('POST', '/listas/1/cerrar', { usuario: coord })).status === 403, 'sin «Editar» el coordinador no cierra ni cancela');
  ok((await pedir('PUT', '/config', { usuario: coord, json: { franja_desde: '07:00', franja_hasta: '19:00' } })).status === 403, 'cambiar la franja pide «Editar» Y ser administrador');
  await permisos('coordinador', 'puerta_listas', 1, 1, 1);
  ok((await pedir('PUT', '/config', { usuario: coord, json: { franja_desde: '07:00', franja_hasta: '19:00' } })).status === 403, 'aunque tenga «Editar», la franja es solo del administrador');
  ok((await pedir('GET', '/mias', { usuario: lid1, aspirante: lid1.id })).status === 403 && (await pedir('GET', '/listas', { usuario: admin, aspirante: admin.id })).status === 403 && (await pedir('POST', '/visitas', { usuario: lid1, aspirante: lid1.id, json: {} })).status === 403,
    'el aspirante con sublicencia NO llega (ni a bajar, ni a armar, ni a enviar)');
  ok(!require('../middleware/aspirante').PERMITIDOS.some((p) => /puerta/.test(p)), 'y la ruta no está en la lista blanca de lo que el aspirante alcanza');

  /* ======================================================================================== 6. el alcance */
  console.log('\n[6] El alcance de quien visita: el mismo que calcula el middleware');
  const { calcularAlcance } = require('../middleware/auth');
  async function alcanceReal(u) { const req = { session: { usuario: { id: u.id, rol: u.rol, territorio_id: null } }, sublicencia: null }; await calcularAlcance(req, {}, () => {}); return req.alcance; }
  const { condicionAlcanceVotantes, parametrosAlcanceVotantes } = require('../lib/alcanceVotantes');
  let coincide = true;
  for (const u of [lid1, sub1, lid2]) {
    const real = await alcanceReal(u), mio = P.alcanceDeUsuario(u);
    if (condicionAlcanceVotantes(real, 'v') !== condicionAlcanceVotantes(mio, 'v') || !mismo(parametrosAlcanceVotantes(real), parametrosAlcanceVotantes(mio))) coincide = false;
  }
  ok(coincide, 'alcanceDeUsuario(líder) y (sublíder) producen la MISMA condición y los MISMOS parámetros que calcularAlcance para esa persona');

  // Los votantes.
  const vA = await votante({ nombre: 'Ana Alcance', lider: lid1, zona: b1.id, telefono: '3001112233' });
  const vB = await votante({ nombre: 'Bruno SinConsentimiento', lider: lid1, zona: b1.id, sinConsentimiento: true });
  const vC = await votante({ nombre: 'Carla SinDireccion', lider: lid1, zona: b1.id, sinDireccion: true });
  const vD = await votante({ nombre: 'Darío NoVisitar', lider: lid1, zona: b1.id, noVisitar: true });
  const vE = await votante({ nombre: 'Elena DelSublider', lider: lid1, sublider: sub1, zona: b2.id });
  const vF = await votante({ nombre: 'Fabio Cierra', lider: lid1, zona: b2.id });
  const vK = await votante({ nombre: 'Karla Retira', lider: lid1, zona: b2.id });
  const vL = await votante({ nombre: 'Luis NoVuelve', lider: lid1, zona: b2.id });
  const vM = await votante({ nombre: 'Marta Horario', lider: lid1, zona: b2.id });
  const vN = await votante({ nombre: 'Nora Cambia', lider: lid1, zona: b2.id });
  const vG = await votante({ nombre: 'Gloria Dos', lider: lid2, zona: b1.id, telefono: '3105556666' });
  const vH = await votante({ nombre: 'Hugo Dos', lider: lid2, zona: b2.id });
  const vI = await votante({ nombre: 'Irene Sola', lider: lid2, zona: b3.id });
  const vJ = await votante({ nombre: 'Jorge Solicita', lider: lid2, zona: b3.id });
  const l3 = []; for (let i = 0; i < 4; i++) l3.push(await votante({ nombre: `Tres ${i}`, lider: lid3, zona: b3.id }));

  /* ============================================================================================ 7. armar listas */
  console.log('\n[7] Armar: se filtra con el alcance de quien VA A VISITAR, y solo entra quien se puede visitar');
  const aSub = await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Lista del sublíder', asignada_a: sub1.id, cliente_uuid: uuid() } });
  ok(aSub.status === 201 && aSub.datos.personas === 1, 'una lista para el SUBLÍDER trae solo lo que él registró (1 persona), no lo de su líder', aSub.datos);
  const uuidL1 = uuid();
  const aL1 = await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Lista de Uno', asignada_a: lid1.id, cliente_uuid: uuidL1 } });
  ok(aL1.status === 201 && aL1.datos.personas === 6, 'la lista del LÍDER trae sus 6 personas visitables (incluye lo que registran sus sublíderes, salvo lo ya asignado)', aL1.datos);
  ok(aL1.datos.omitidas && aL1.datos.omitidas.sin_autorizacion === 1 && aL1.datos.omitidas.pidio_no_volver === 1 && aL1.datos.omitidas.sin_direccion === 1 && aL1.datos.omitidas.en_otra_lista === 1 && aL1.datos.omitidas.visitada_hace_poco === 0,
    'quedan fuera, con su conteo: sin autorización, pidió no volver, sin dirección y la que ya está en la lista del sublíder', aL1.datos.omitidas);
  const dup = await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Lista de Uno', asignada_a: lid1.id, cliente_uuid: uuidL1 } });
  ok(dup.status === 200 && dup.datos.duplicado === true && dup.datos.id === aL1.datos.id && (await q('SELECT COUNT(*) n FROM puerta_listas WHERE cliente_uuid = ?', [uuidL1]))[0].n === 1, 'armar dos veces con el mismo cliente_uuid no crea dos listas');
  const repetida = await pedir('POST', '/listas', { usuario: coord, json: { nombre: 'Otra de Uno', asignada_a: lid1.id } });
  ok(repetida.status === 422 && repetida.datos.omitidas.en_otra_lista === 7, 'VISITAS REPETIDAS: una persona que ya está en una lista activa no entra en otra (las 6 del líder y la que está en la lista de su sublíder)', repetida.datos);
  ok((await pedir('POST', '/listas', { usuario: coord, json: { nombre: 'De otra rama', asignada_a: lid3.id } })).status === 400, 'el coordinador no le arma lista a quien no es de su rama');
  ok((await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Al testigo', asignada_a: test1.id } })).status === 400, 'solo se asigna a un líder o a un sublíder');
  ok((await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'x', asignada_a: lid1.id } })).status === 400, 'el nombre de la lista pide al menos 3 letras');
  ok((await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Zona mala', asignada_a: lid2.id, territorio_id: 99999999 } })).status === 400, 'una zona que no está en el catálogo se rechaza');
  const listasCoord = await pedir('GET', '/listas', { usuario: coord });
  ok(listasCoord.status === 200 && listasCoord.datos.listas.length === 2 && Object.keys(listasCoord.datos.listas[0]).sort().join() === ['agotadas', 'asignada_a', 'asignada_nombre', 'cerradas', 'creada', 'estado', 'id', 'nombre', 'pendientes', 'total', 'zona'].sort().join(), 'quien arma ve SOLO conteos (nunca nombres ni direcciones de las personas)', listasCoord.datos.listas[0]);
  ok(!/Ana|Alcance|Calle|OBS-SECRETA/.test(listasCoord.texto), 'ni en el texto de la respuesta aparece una persona');
  ok((await pedir('GET', '/listas', { usuario: coord })).datos.listas.every((l) => l.asignada_a === lid1.id || l.asignada_a === sub1.id), 'el coordinador ve las listas de su rama');
  // La zona.
  const z1 = await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Dos en barrio uno', asignada_a: lid2.id, territorio_id: b1.id } });
  ok(z1.status === 201 && z1.datos.personas === 1, 'armar por BARRIO: solo las personas de ese barrio', z1.datos);
  await pedir('POST', `/listas/${z1.datos.id}/cancelar`, { usuario: admin });
  const mun = await territorio('municipio', `Municipio ${sello}`);
  const z2 = await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Dos en el municipio', asignada_a: lid2.id, territorio_id: mun.id } });
  ok(z2.status === 400, 'con barrios en el catálogo, elegir un MUNICIPIO como zona se rechaza (sería no decir nada)', z2.datos);
  const z3 = await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Dos, barrios 1 y 2', asignada_a: lid2.id, territorio_id: com.id } });
  ok(z3.status === 201 && z3.datos.personas === 2, 'armar por COMUNA trae lo que cuelga de ella (2 barrios, 2 personas de Dos) y no el barrio de afuera', z3.datos);
  const tope = await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Tres con tope', asignada_a: lid3.id, max: 2 } });
  ok(tope.status === 201 && tope.datos.personas === 2 && tope.datos.sin_cupo === 2, 'el tope de personas por lista se respeta y avisa cuántas quedaron fuera', tope.datos);
  const dosC = await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Dos, sin zona', asignada_a: lid2.id } });
  ok(dosC.status === 201 && dosC.datos.personas === 2, 'Dos, sin zona: solo quedan las dos del barrio de afuera (las otras ya están en su lista)', dosC.datos);
  const idListaL1 = aL1.datos.id, idListaSub = aSub.datos.id, idListaDosC = z3.datos.id, idListaDosB = dosC.datos.id, idListaTres = tope.datos.id;
  // Una lista cancelada ya no bloquea a sus personas.
  const rearm = await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Dos otra vez en barrio uno', asignada_a: lid2.id, territorio_id: b1.id } });
  ok(rearm.status === 422 && rearm.datos.omitidas.en_otra_lista === 1, 'la persona de Dos en el barrio uno sigue ocupada por la lista de la comuna', rearm.datos);

  /* ============================================================================ 8. lo que baja al celular */
  console.log('\n[8] La lista mínima del celular: columnas cerradas, nada de más, y de lo cerrado no viaja la persona');
  const mia1 = await pedir('GET', '/mias', { usuario: lid1 });
  ok(mia1.status === 200 && mia1.cabeceras.get('cache-control') === 'no-store', 'GET /mias responde con Cache-Control: no-store');
  const L = mia1.datos.listas[0];
  ok(mia1.datos.listas.length === 1 && L.id === idListaL1 && L.items.length === 6, 'el líder recibe SOLO su lista, con 6 puertas', mia1.datos.listas.length);
  ok(mismo(Object.keys(mia1.datos).sort(), ['bloqueo', 'config', 'listas']), 'la respuesta tiene exactamente: bloqueo, config y listas', Object.keys(mia1.datos));
  ok(mismo(Object.keys(L).sort(), P.CAMPOS_LISTA.slice().sort()) && mismo(P.CAMPOS_LISTA.slice().sort(), ['agotadas', 'cerradas', 'id', 'items', 'nombre', 'pendientes', 'total', 'zona']), 'la lista tiene columnas CERRADAS', Object.keys(L));
  ok(L.items.every((it) => mismo(Object.keys(it).sort(), P.CAMPOS_ITEM.slice().sort())) && mismo(P.CAMPOS_ITEM.slice().sort(), ['direccion', 'estado', 'id', 'intentos', 'latitud', 'longitud', 'nombre', 'reintento_desde', 'ultima_fecha', 'ultima_franja', 'ultimo_resultado']),
    'cada puerta tiene las columnas CERRADAS: id, nombre, dirección, coordenadas y estado (más lo que hace falta para los reintentos)', Object.keys(L.items[0]));
  ok(mismo(Object.keys(mia1.datos.config).sort(), P.CAMPOS_CONFIG.slice().sort()), 'la configuración que baja: franja, fecha de la elección, topes y caducidad', Object.keys(mia1.datos.config));
  const secretos = [`96${sello}`, `OBS-SECRETA-${sello}`, '@secreto.test', '3001112233', 'alcaldia', 'apoya_a', 'observaciones', 'cedula', 'telefono', 'email', 'consentimiento', 'no_visitar', 'votante_id'];
  ok(!secretos.some((s) => mia1.texto.includes(s)), 'NO viajan cédula, teléfono, correo, apoya_a, observaciones, consentimiento ni el id de la ficha', secretos.filter((s) => mia1.texto.includes(s)));
  const nombresL = L.items.map((i) => i.nombre).sort();
  ok(mismo(nombresL, ['Ana Alcance', 'Fabio Cierra', 'Karla Retira', 'Luis NoVuelve', 'Marta Horario', 'Nora Cambia'].sort()), 'las 6 puertas son las del líder (ni Bruno, ni Carla, ni Darío, ni Elena, ni nadie de Dos)', nombresL);
  const mia2 = await pedir('GET', '/mias', { usuario: lid2 });
  ok(mia2.datos.listas.length === 2 && !mia2.texto.includes('Ana Alcance') && !mia2.texto.includes('Fabio'), 'el otro líder recibe sus listas y ninguna ficha del primero');
  const miaSub = await pedir('GET', '/mias', { usuario: sub1 });
  ok(miaSub.datos.listas.length === 1 && miaSub.datos.listas[0].items.length === 1 && miaSub.datos.listas[0].items[0].nombre === 'Elena DelSublider', 'el sublíder recibe solo lo suyo');
  const itemDe = (datos, nombre) => datos.listas.flatMap((l) => l.items).find((i) => i.nombre === nombre);
  const iA = itemDe(mia1.datos, 'Ana Alcance'), iF = itemDe(mia1.datos, 'Fabio Cierra'), iK = itemDe(mia1.datos, 'Karla Retira'), iL = itemDe(mia1.datos, 'Luis NoVuelve'), iM = itemDe(mia1.datos, 'Marta Horario'), iN = itemDe(mia1.datos, 'Nora Cambia');
  const iE = miaSub.datos.listas[0].items[0];
  ok(iA && iA.estado === 'pendiente' && iA.intentos === 0 && iA.latitud !== null && iA.direccion, 'una puerta pendiente trae nombre, dirección y coordenadas');
  const sinSena = await votante({ nombre: 'Sin Coordenadas', lider: lid3, lat: null, lon: null });
  ok(sinSena.id > 0, 'una ficha sin coordenadas es válida (va al final de la ruta en el celular)');

  /* ================================================================== 9. re-validación al leer (no se fía de la tabla) */
  console.log('\n[9] Al leer se vuelve a validar con el alcance de quien visita');
  await q('UPDATE votantes SET consentimiento_autorizado = 0 WHERE id = ?', [vK.id]);
  await q('UPDATE votantes SET no_visitar = 1 WHERE id = ?', [vL.id]);
  await q('UPDATE votantes SET lider_id = ? WHERE id = ?', [lid2.id, vN.id]);
  let m = await pedir('GET', '/mias', { usuario: lid1 });
  const nm = m.datos.listas[0].items.map((i) => i.nombre);
  ok(m.datos.listas[0].items.length === 3 && !nm.includes('Karla Retira') && !nm.includes('Luis NoVuelve') && !nm.includes('Nora Cambia'), 'la que retiró su autorización, la que pidió no volver y la que cambió de líder DEJAN de salir', nm);
  const rv1 = await pedir('POST', '/visitas', { usuario: lid1, json: { cliente_uuid: uuid(), item_id: iN.id, resultado: 'no_abrio', marcado_en: inst(1, '10:00') } });
  ok(rv1.status === 409 && /ya no está en tu lista/.test(rv1.datos.error), 'y tampoco se puede registrar una visita a la que ya no es suya', rv1.datos);
  const rv2 = await pedir('POST', '/visitas', { usuario: lid1, json: { cliente_uuid: uuid(), item_id: iL.id, resultado: 'no_abrio', marcado_en: inst(1, '10:00') } });
  ok(rv2.status === 409 && /pidió que no la visiten/.test(rv2.datos.error), 'ni a la que pidió que no la visiten', rv2.datos);
  const rv3 = await pedir('POST', '/visitas', { usuario: lid1, json: { cliente_uuid: uuid(), item_id: iK.id, resultado: 'no_abrio', marcado_en: inst(1, '10:00') } });
  ok(rv3.status === 409, 'ni a la que retiró su autorización', rv3.datos);
  await q('UPDATE votantes SET consentimiento_autorizado = 1, no_visitar = 0 WHERE id IN (?, ?)', [vK.id, vL.id]);
  await q('UPDATE votantes SET lider_id = ? WHERE id = ?', [lid1.id, vN.id]);
  m = await pedir('GET', '/mias', { usuario: lid1 });
  ok(m.datos.listas[0].items.length === 6, 'y vuelven a salir cuando la ficha vuelve a estar en regla');

  /* ============================================================================ 10. la franja y los bordes */
  console.log('\n[10] La franja horaria: se juzga con la hora de la CAPTURA, bordes incluidos');
  const visita = (usr, item, resultado, marcado, extra = {}) => pedir('POST', '/visitas', { usuario: usr, json: Object.assign({ cliente_uuid: uuid(), item_id: item.id, resultado, marcado_en: marcado }, extra) });
  const contar = async (tabla) => Number((await q(`SELECT COUNT(*) n FROM ${tabla}`))[0].n);
  let antes = await contar('puerta_visitas');
  const f1 = await visita(lid1, iM, 'no_abrio', inst(1, '07:59'));
  const f2 = await visita(lid1, iM, 'no_abrio', inst(1, '18:00'));
  const f3 = await visita(lid1, iM, 'no_abrio', inst(1, '23:30'));
  ok(f1.status === 422 && f2.status === 422 && f3.status === 422 && /horario permitido/.test(f1.datos.error), 'fuera de la franja (07:59, 18:00 y 23:30) NO se guarda', [f1.status, f2.status, f3.status]);
  ok(await contar('puerta_visitas') === antes, 'y no queda ninguna fila');
  ok((await pedir('PUT', '/config', { usuario: admin, json: { franja_desde: '06:00', franja_hasta: '18:00' } })).status === 400
    && (await pedir('PUT', '/config', { usuario: admin, json: { franja_desde: '08:00', franja_hasta: '19:30' } })).status === 400
    && (await pedir('PUT', '/config', { usuario: admin, json: { franja_desde: '10:00', franja_hasta: '10:30' } })).status === 400
    && (await pedir('PUT', '/config', { usuario: admin, json: { franja_desde: 'tarde', franja_hasta: '18:00' } })).status === 400, 'el administrador no puede poner una franja fuera de 07:00–19:00, de menos de una hora ni que no sea hora');
  const put = await pedir('PUT', '/config', { usuario: admin, json: { franja_desde: '07:00', franja_hasta: '19:00' } });
  ok(put.status === 200 && (await pedir('GET', '/config', { usuario: admin })).datos.franja_hasta === '19:00', 'el administrador mueve la franja a 07:00–19:00 (los extremos)');
  ok((await q(`SELECT COUNT(*) n FROM auditoria WHERE accion = 'puerta_config'`))[0].n >= 1, 'y el cambio queda en la auditoría');
  const f4 = await visita(lid1, iM, 'no_abrio', inst(1, '18:30'));
  ok(f4.status === 201 && f4.datos.estado === 'pendiente' && f4.datos.reintento_desde, 'con la franja ampliada, las 18:30 SÍ entran', f4.datos);
  const filaM = (await q('SELECT v.* FROM puerta_visitas v WHERE v.item_id = ?', [iM.id]))[0];
  ok(filaM && filaM.franja === 'noche' && String(filaM.fecha).slice(0, 10) === R.sumarDias(hoyCol(), -1) && filaM.registrada_por === lid1.id, 'guarda la FECHA y la FRANJA (noche), nunca la hora', filaM);
  await config({ puerta_franja_desde: '08:00', puerta_franja_hasta: '18:00' });
  const f5 = await visita(lid1, iA, 'no_abrio', inst(3, '08:00'));
  ok(f5.status === 201, 'con la franja de fábrica, las 08:00 en punto SÍ entran (el borde de abajo está incluido)', f5.datos);
  const fut = await visita(lid1, iF, 'no_abrio', new Date(Date.now() + 3600 * 1000).toISOString());
  const vieja = await visita(lid1, iF, 'no_abrio', inst(9, '10:00'));
  const sinHora = await visita(lid1, iF, 'no_abrio', 'ayer');
  ok(fut.status === 400 && vieja.status === 422 && sinHora.status === 400, 'una hora futura, una de hace más de 7 días o una ilegible se rechazan', [fut.status, vieja.status, sinHora.status]);

  /* ================================================================ 11. intentos y 24 horas entre uno y otro */
  console.log('\n[11] «No abrió»: máximo 3 intentos, con al menos 24 horas entre uno y otro');
  const segundo = await visita(lid1, iA, 'no_abrio', inst(3, '11:00'));
  ok(segundo.status === 409 && /Todavía no/.test(segundo.datos.error), 'el segundo intento el mismo día se rechaza', segundo.datos);
  const dia2a = await visita(lid1, iA, 'no_abrio', inst(2, '11:59'));
  ok(dia2a.status === 409, 'a las 11:59 del día siguiente (23 h 59 min después del final de la franja de mañana… falta un minuto) todavía no', dia2a.datos);
  const dia2b = await visita(lid1, iA, 'no_abrio', inst(2, '12:00'));
  ok(dia2b.status === 201 && dia2b.datos.estado === 'pendiente', 'a las 12:00 del día siguiente SÍ (segundo intento)', dia2b.datos);
  const dia1a = await visita(lid1, iA, 'no_abrio', inst(1, '16:59'));
  ok(dia1a.status === 409, 'el tercero a las 16:59 todavía no (el segundo fue en la franja de la tarde)', dia1a.datos);
  const dia1b = await visita(lid1, iA, 'no_abrio', inst(1, '17:00'));
  ok(dia1b.status === 201 && dia1b.datos.estado === 'agotada', 'el tercero a las 17:00 SÍ, y la puerta queda «agotada» (sin respuesta)', dia1b.datos);
  const cuarto = await visita(lid1, iA, 'no_abrio', inst(1, '17:30'));
  ok(cuarto.status === 409 && /ya tiene un resultado/.test(cuarto.datos.error), 'un cuarto intento no existe', cuarto.datos);
  const filaA = (await q('SELECT estado, intentos, ultimo_resultado FROM puerta_items WHERE id = ?', [iA.id]))[0];
  ok(filaA.estado === 'agotada' && Number(filaA.intentos) === 3, 'el ítem quedó agotada con 3 intentos', filaA);
  const fechas = (await q('SELECT fecha, franja FROM puerta_visitas WHERE item_id = ? ORDER BY id', [iA.id])).map((f) => `${String(f.fecha).slice(0, 10)}|${f.franja}`);
  ok(mismo(fechas, [`${R.sumarDias(hoyCol(), -3)}|manana`, `${R.sumarDias(hoyCol(), -2)}|tarde`, `${R.sumarDias(hoyCol(), -1)}|noche`]), 'las tres visitas guardaron fecha y franja (mañana, tarde, noche)', fechas);

  /* =============================================================================== 12. idempotencia y resultados */
  console.log('\n[12] Idempotencia por cliente_uuid y los resultados');
  const u1 = uuid();
  const cierre1 = await pedir('POST', '/visitas', { usuario: lid1, json: { cliente_uuid: u1, item_id: iF.id, resultado: 'no_interesado', marcado_en: inst(1, '10:00') } });
  const cierre2 = await pedir('POST', '/visitas', { usuario: lid1, json: { cliente_uuid: u1, item_id: iF.id, resultado: 'no_interesado', marcado_en: inst(1, '10:00') } });
  ok(cierre1.status === 201 && cierre2.status === 200 && cierre2.datos.duplicado === true && cierre1.datos.id === cierre2.datos.id, 'el mismo cliente_uuid dos veces devuelve la misma visita');
  ok(Number((await q('SELECT COUNT(*) n FROM puerta_visitas WHERE cliente_uuid = ?', [u1]))[0].n) === 1, 'y no duplica la fila');
  const carrera = await Promise.all([1, 2, 3].map(() => pedir('POST', '/visitas', { usuario: lid1, json: { cliente_uuid: u1, item_id: iF.id, resultado: 'no_interesado', marcado_en: inst(1, '10:00') } })));
  ok(carrera.every((r) => [200, 201].includes(r.status)) && Number((await q('SELECT COUNT(*) n FROM puerta_visitas WHERE cliente_uuid = ?', [u1]))[0].n) === 1, 'tres reintentos a la vez tampoco duplican');
  const otraVez = await visita(lid1, iF, 'interesado', inst(1, '11:00'));
  ok(otraVez.status === 409, 'una puerta con resultado final no admite otro', otraVez.datos);
  ok((await visita(lid1, iF, 'invento', inst(1, '10:00'))).status === 400 && (await pedir('POST', '/visitas', { usuario: lid1, json: { cliente_uuid: 'no-es-uuid', item_id: iF.id, resultado: 'no_abrio', marcado_en: inst(1, '10:00') } })).status === 400, 'un resultado que no existe o un identificador mal formado se rechazan');
  ok((await visita(lid2, iM, 'no_abrio', inst(1, '10:00'))).status === 404, 'otro líder no puede registrar sobre una puerta que no es suya (404, no dice de quién es)');
  ok((await visita(lid1, iE, 'no_abrio', inst(1, '10:00'))).status === 404, 'ni el líder sobre la puerta de la lista de su sublíder (es de la persona asignada)');
  // El resultado «interesado» y la ficha.
  const apoyaAntes = (await q('SELECT apoya_a, observaciones FROM votantes WHERE id = ?', [vE.id]))[0];
  const intE = await visita(sub1, iE, 'interesado', inst(1, '10:00'));
  const apoyaDespues = (await q('SELECT apoya_a, observaciones FROM votantes WHERE id = ?', [vE.id]))[0];
  ok(intE.status === 201 && mismo(apoyaAntes, apoyaDespues), '«Interesado» NO escribe apoya_a ni toca la ficha', [apoyaAntes, apoyaDespues]);
  const miaTras = await pedir('GET', '/mias', { usuario: lid1 });
  const cerrada = miaTras.datos.listas[0].items.find((i) => i.id === iF.id), agot = miaTras.datos.listas[0].items.find((i) => i.id === iA.id);
  ok(cerrada && cerrada.estado === 'cerrada' && cerrada.nombre === null && cerrada.direccion === null && cerrada.latitud === null && cerrada.longitud === null, 'de una puerta CERRADA ya no viajan ni el nombre, ni la dirección, ni las coordenadas', cerrada);
  ok(agot && agot.estado === 'agotada' && agot.nombre === null && agot.direccion === null, 'ni de una agotada', agot);
  const resumen = miaTras.datos.listas[0];
  ok(resumen.cerradas === 1 && resumen.agotadas === 1 && resumen.pendientes === 4, 'el resumen de la lista cuenta cerradas, agotadas y pendientes', [resumen.cerradas, resumen.agotadas, resumen.pendientes]);
  const sinLink = await q(`SELECT column_name c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name IN ('puerta_visitas','puerta_items') AND column_name LIKE '%solicitud%'`);
  ok(sinLink.length === 0, '«Dejó una solicitud» y «quiere registrarse» no guardan de cuál visita vinieron (no existe ninguna columna de enlace)');

  /* ================================================== 13. «pidió no volver» NO es «no contactar» (y la casilla aparte sí) */
  console.log('\n[13] «Pidió no volver» = no_visitar, separado de no_contactar; «tampoco quiere mensajes» llama a la baja con canal en_persona');
  const miaDos = await pedir('GET', '/mias', { usuario: lid2 });
  const iG = itemDe(miaDos.datos, 'Gloria Dos'), iH = itemDe(miaDos.datos, 'Hugo Dos'), iI = itemDe(miaDos.datos, 'Irene Sola'), iJ = itemDe(miaDos.datos, 'Jorge Solicita');
  ok(iG && iH && iI && iJ, 'Dos recibe sus cuatro puertas');
  const contactoAntes = (await q('SELECT no_contactar, no_contactar_fecha, no_contactar_canal, updated_at FROM votantes WHERE id IN (?, ?) ORDER BY id', [vG.id, vH.id]));
  await dormir(1200);
  const nvH = await visita(lid2, iH, 'no_volver', inst(1, '10:00'));
  const hDespues = (await q('SELECT no_visitar, no_visitar_fecha, no_contactar, no_contactar_fecha, no_contactar_canal, updated_at FROM votantes WHERE id = ?', [vH.id]))[0];
  ok(nvH.status === 201 && Number(hDespues.no_visitar) === 1 && String(hDespues.no_visitar_fecha).slice(0, 10) === R.sumarDias(hoyCol(), -1), '«Pidió no volver» marca no_visitar con la FECHA', hDespues);
  ok(Number(hDespues.no_contactar) === 0 && hDespues.no_contactar_fecha === null && hDespues.no_contactar_canal === null, 'y NO toca no_contactar: puede seguir recibiendo mensajes', hDespues);
  ok(String(hDespues.updated_at) === String(contactoAntes[1].updated_at), 'ni deja en la ficha la hora exacta de la visita (updated_at no se movió)', [contactoAntes[1].updated_at, hDespues.updated_at]);
  const otroConMismoTel = await votante({ nombre: 'Vecino mismo teléfono', lider: lid2, telefono: '3105556666' });
  const nvG = await visita(lid2, iG, 'no_volver', inst(1, '10:30'), { tampoco_mensajes: true });
  const gDespues = (await q('SELECT no_visitar, no_contactar, no_contactar_canal, no_contactar_origen, no_contactar_motivo FROM votantes WHERE id = ?', [vG.id]))[0];
  ok(nvG.status === 201 && Number(gDespues.no_visitar) === 1 && Number(gDespues.no_contactar) === 1 && gDespues.no_contactar_canal === 'en_persona' && gDespues.no_contactar_origen === 'puerta_a_puerta', 'con la casilla «tampoco quiere mensajes» SÍ marca no_contactar, por canal en_persona', gDespues);
  ok(Number((await q('SELECT no_contactar n FROM votantes WHERE id = ?', [otroConMismoTel.id]))[0].n) === 1, 'y la baja se extiende a la otra ficha con el mismo teléfono (es lo que ya hace aplicarBajaDeFicha)');
  const rearmaH = await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Sin los que pidieron no volver', asignada_a: lid2.id } });
  ok(rearmaH.status === 422 || (rearmaH.status === 201 && rearmaH.datos.omitidas.pidio_no_volver >= 2), 'quien pidió no volver ya no entra en ninguna lista nueva', rearmaH.datos);
  const qr = await visita(lid2, iI, 'quiere_registrarse', inst(1, '10:00'));
  const sol = await visita(lid2, iJ, 'solicitud', inst(1, '10:00'));
  ok(qr.status === 201 && sol.status === 201 && qr.datos.estado === 'cerrada' && sol.datos.estado === 'cerrada', '«quiere registrarse» y «solicitud» cierran la puerta');

  /* ==================================================== 14. 60 días, otras listas, cierre y cancelación */
  console.log('\n[14] 60 días sin volver a asignar; cerrar y cancelar listas');
  const lid4 = await usuario('Líder Cuatro', 'lider'); await estructura(lid4, 'lider', coord);
  const vP = await votante({ nombre: 'Paula Reciente', lider: lid4, zona: b1.id });
  const lp = await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Cuatro', asignada_a: lid4.id } });
  await permisos('lider', 'puerta_visitas', 1, 0, 1);
  const iP = (await pedir('GET', '/mias', { usuario: lid4 })).datos.listas[0].items[0];
  await visita(lid4, iP, 'no_interesado', inst(1, '10:00'));
  await pedir('POST', `/listas/${lp.datos.id}/cancelar`, { usuario: admin });
  const r60 = await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Cuatro otra vez', asignada_a: lid4.id } });
  ok(r60.status === 422 && r60.datos.omitidas.visitada_hace_poco === 1, '«No interesado»: no se vuelve a asignar en 60 días', r60.datos);
  await q('UPDATE puerta_items SET ultima_fecha = DATE_SUB(CURDATE(), INTERVAL 61 DAY) WHERE id = ?', [iP.id]);
  const r61 = await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Cuatro a los 61 días', asignada_a: lid4.id } });
  ok(r61.status === 201 && r61.datos.personas === 1, 'a los 61 días SÍ vuelve a entrar', r61.datos);
  await q('UPDATE puerta_items SET ultima_fecha = DATE_SUB(CURDATE(), INTERVAL 59 DAY) WHERE id = ?', [iP.id]);
  await pedir('POST', `/listas/${r61.datos.id}/cancelar`, { usuario: admin });
  const r59 = await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Cuatro a los 59 días', asignada_a: lid4.id } });
  ok(r59.status === 422, 'a los 59 días todavía no', r59.datos);
  // Cierre y cancelación.
  const iT = (await pedir('GET', '/mias', { usuario: lid3 })).datos.listas[0].items[0];
  ok((await pedir('POST', `/listas/${idListaTres}/cerrar`, { usuario: coord })).status === 404, 'un coordinador no cierra la lista de otra rama (404)');
  ok((await pedir('POST', `/listas/${idListaTres}/cerrar`, { usuario: admin })).status === 200 && (await pedir('POST', `/listas/${idListaTres}/cerrar`, { usuario: admin })).status === 409, 'cerrar una lista: la primera vez sí, la segunda avisa que ya está cerrada');
  ok((await pedir('GET', '/mias', { usuario: lid3 })).datos.listas.length === 0, 'una lista cerrada deja de bajar al celular');
  const trasCierre = await visita(lid3, iT, 'no_abrio', inst(1, '10:00'));
  ok(trasCierre.status === 201, 'pero lo que se capturó ANTES de cerrar se acepta aunque suba después', trasCierre.datos);
  await q("UPDATE puerta_listas SET cerrada_en = '2000-01-01 00:00:00' WHERE id = ?", [idListaTres]);
  ok((await visita(lid3, iT, 'no_abrio', inst(0, '09:00'))).status !== 201, 'y lo capturado después del cierre no');
  await q("UPDATE puerta_listas SET estado = 'cancelada' WHERE id = ?", [idListaTres]);
  ok((await visita(lid3, iT, 'no_abrio', inst(1, '10:00'))).status === 409, 'una lista cancelada no acepta nada');
  ok(Object.values((await pedir('GET', '/listas', { usuario: admin })).datos.listas.find((l) => l.id === idListaTres) || {}).includes('cancelada'), 'el administrador ve la lista como cancelada');

  /* ================================================================= 15. el día de la elección (fecha de CAPTURA) */
  console.log('\n[15] El día de la elección el módulo queda bloqueado, con la fecha de captura (también sin señal)');
  const ayer = R.sumarDias(hoyCol(), -1);
  await config({ fecha_eleccion: ayer });
  const eleccion = await visita(lid1, iM, 'no_abrio', inst(1, '10:00'));
  ok(eleccion.status === 422 && /día de la elección/.test(eleccion.datos.error), 'una visita CAPTURADA el día de la elección se rechaza aunque suba después', eleccion.datos);
  const otroDia = await visita(lid1, iM, 'no_abrio', inst(0, '09:00'));
  ok(otroDia.status !== 422 || !/elección/.test(otroDia.datos.error || ''), 'y una capturada otro día no se juzga por la elección', otroDia.status);
  await config({ fecha_eleccion: hoyCol() });
  const hoy = await pedir('GET', '/mias', { usuario: lid1 });
  ok(hoy.status === 200 && hoy.datos.bloqueo && hoy.datos.bloqueo.codigo === 'dia_de_la_eleccion' && hoy.datos.listas.length === 0 && !hoy.texto.includes('Ana'), 'ese día GET /mias no devuelve listas, solo el aviso', hoy.datos);
  ok(hoy.datos.config.fecha_eleccion === hoyCol(), 'y avisa la fecha de la elección para que el celular también se bloquee sin señal');
  await config({ fecha_eleccion: R.sumarDias(hoyCol(), 30) });
  ok((await pedir('GET', '/mias', { usuario: lid1 })).datos.bloqueo === null, 'otro día, sin bloqueo');
  await config({ fecha_eleccion: null });

  /* ======================================================================== 16. la auditoría */
  console.log('\n[16] Auditoría: cada lista armada y cada descarga al celular');
  const aud = async (accion) => q('SELECT usuario_id, detalle FROM auditoria WHERE accion = ? ORDER BY id', [accion]);
  const armadas = await aud('puerta_lista_armar');
  ok(armadas.length >= 8 && armadas.every((a) => /^Armó la lista n\.º \d+ con \d+ persona\(s\)/.test(a.detalle)), `cada lista armada deja su renglón (${armadas.length})`);
  ok(!armadas.some((a) => /Ana|Gloria|Calle|OBS/.test(a.detalle)), 'y ningún renglón lleva nombres ni direcciones');
  const d0 = (await aud('puerta_lista_descarga')).length;
  await pedir('GET', '/mias', { usuario: lid1 });
  await pedir('GET', '/mias', { usuario: lid1 });
  const d1 = await aud('puerta_lista_descarga');
  ok(d1.length === d0 + 2 && /^Bajó al celular 1 lista\(s\) con \d+ persona\(s\)/.test(d1[d1.length - 1].detalle) && d1[d1.length - 1].usuario_id === lid1.id, 'cada descarga al celular queda registrada, con quién y cuántas (nunca quiénes)', d1[d1.length - 1]);
  const d2 = (await aud('puerta_lista_descarga')).length;
  await pedir('GET', '/mias', { usuario: lid3 });                                   // su lista está cancelada: no baja nada
  ok((await aud('puerta_lista_descarga')).length === d2, 'una descarga sin listas no deja renglón');
  ok((await aud('puerta_lista_cerrar')).length >= 1 && (await aud('puerta_lista_cancelar')).length >= 1, 'cerrar y cancelar también');

  /* =================================================================================== 17. la retención */
  console.log('\n[17] Retención: 6 meses después de la elección se corta el vínculo con la persona');
  const sinFecha = await P.anonimizarVencidas({ aplicar: true });
  ok(sinFecha.aplicado === false && /fecha de elección/.test(sinFecha.motivo), 'sin fecha de elección no se toca nada');
  await config({ fecha_eleccion: R.sumarDias(hoyCol(), 20) });
  const temprano = await P.anonimizarVencidas({ aplicar: true });
  ok(temprano.aplicado === false && /Todavía no/.test(temprano.motivo) && Number((await q('SELECT COUNT(*) n FROM puerta_items WHERE votante_id IS NOT NULL'))[0].n) > 0, 'antes del plazo tampoco');
  const visitasAntes = await contar('puerta_visitas');
  await config({ fecha_eleccion: '2024-01-15' });
  const simula = await P.anonimizarVencidas({ aplicar: false });
  ok(simula.aplicado === false && simula.vencen > 0 && Number((await q('SELECT COUNT(*) n FROM puerta_items WHERE votante_id IS NOT NULL'))[0].n) === simula.vencen, 'la simulación solo cuenta');
  const mant = await require('../lib/solicitudesMantenimiento').vueltaDiaria({ forzar: true });
  ok(mant.puerta && mant.puerta.aplicado === true && mant.puerta.anonimizados > 0, 'la vuelta diaria de mantenimiento la corre sola', mant.puerta);
  ok(Number((await q('SELECT COUNT(*) n FROM puerta_items WHERE votante_id IS NOT NULL'))[0].n) === 0 && Number((await q('SELECT COUNT(*) n FROM puerta_items WHERE anonimizado_en IS NOT NULL'))[0].n) > 0, 'ninguna puerta queda ligada a una persona');
  ok(await contar('puerta_visitas') === visitasAntes, 'las visitas se conservan (resultado, fecha, franja y barrio), ya sin nadie detrás');
  ok((await aud('puerta_anonimizar_auto')).length >= 1, 'y queda el renglón de auditoría de la vuelta');
  ok((await pedir('GET', '/mias', { usuario: lid1 })).datos.listas.every((l) => l.items.length === 0), 'sin vínculo, nada baja al celular');
  await config({ fecha_eleccion: null });
  // Borrar una ficha deja la puerta sin nadie (ON DELETE SET NULL).
  const vZ = await votante({ nombre: 'Zoe Borrada', lider: lid4, zona: b1.id });
  const lz = await pedir('POST', '/listas', { usuario: admin, json: { nombre: 'Para borrar', asignada_a: lid4.id } });
  ok(lz.status === 201, 'una lista nueva con la ficha por borrar', lz.datos);
  await q('DELETE FROM votantes WHERE id = ?', [vZ.id]);
  ok(Number((await q('SELECT COUNT(*) n FROM puerta_items WHERE lista_id = ? AND votante_id IS NULL', [lz.datos.id]))[0].n) === 1, 'si se borra la ficha (derecho a la supresión), la puerta queda sin nadie y no estorba');

  /* ============================================================ 18. el código del celular y del escritorio */
  console.log('\n[18] El código del celular: copia de 48 horas por usuario, cola, service worker, sin mapas ni compartir');
  const pag = leer('public/app/puerta-a-puerta.html'), off = leer('public/js/offline-utils.js'), cuentas = leer('public/js/cuentas-dispositivo.js'), sw = leer('public/service-worker.js');
  ok(/OFFLINE_DB_VERSION = 10;/.test(off), 'OFFLINE_DB_VERSION = 10');
  const stores = /const OFFLINE_STORES = \[([\s\S]*?)\];/.exec(off)[1];
  ok(/'puerta_pendientes'/.test(stores) && /'puerta_cache'/.test(stores) && /'encuestas_cache'/.test(stores) && /'tareas_pendientes'/.test(stores), 'los cajones nuevos están y los anteriores siguen');
  ok(/OFFLINE_STORES_COPIA = \[[^\]]*'puerta_cache'[^\]]*\]/.test(off) && !/OFFLINE_STORES_COPIA = \[[^\]]*'puerta_pendientes'/.test(off), 'puerta_cache es una COPIA (por usuario) y puerta_pendientes es una COLA (con dueño)');
  ok(/COPIAS_SIN_SENAL = \[[^\]]*'puerta_cache'[^\]]*\]/.test(cuentas), 'cuentas-dispositivo.js borra la copia al cerrar sesión o cambiar de cuenta (lista duplicada a propósito)');
  ok(/estrategia-v179/.test(sw) && ["'/app/puerta-a-puerta.html'", "'/js/puerta-reglas.js'"].every((u) => sw.includes(u)), 'service worker v179 con la pantalla y las reglas en la coraza');
  ok(/respuesta === undefined\) break;/.test(off), 'sincronizarCola solo borra lo que el servidor confirmó (un 401 devuelve undefined y no se borra nada)');
  ok(/sincronizarCola\(STORE_COLA, '\/puerta-a-puerta\/visitas'/.test(pag) && /caducoLaCopia\(copia\.guardadoEn\)/.test(pag) && /guardarCopiaOffline\(STORE_COPIA/.test(pag), 'la pantalla usa la cola, la copia por usuario y la caducidad de 48 horas');
  ok(/R\.esDiaDeLaEleccion/.test(pag) && /R\.enFranja\(/.test(pag) && /R\.puedeReintentar\(/.test(pag) && /fuera del horario|Fuera del horario/.test(pag), 'el celular se niega solo: día de la elección, fuera de la franja y antes de las 24 horas');
  ok(/R\.ordenarPorCercania\(/.test(pag) && /inicioGps/.test(pag) && !/body:\s*\{[^}]*inicioGps/.test(pag), 'ordena en el celular, con el punto de partida solo en memoria');
  const cuerpo = /function cuerpoDeVisita\(r\) \{([\s\S]*?)\n\}/.exec(pag)[1];
  ok(['cliente_uuid', 'item_id', 'resultado', 'marcado_en', 'tampoco_mensajes'].every((k) => cuerpo.includes(k)) && !/lat|lon|ubic|nombre|direccion/i.test(cuerpo), 'lo que sube a la red: el identificador, la puerta, el resultado, el instante del toque y la casilla; ninguna ubicación');
  const reg = /const registro = \{([\s\S]*?)\n  \};/.exec(pag)[1];
  ok(!/nombre|direccion|latitud|longitud|telefono|cedula/i.test(reg.replace(/payload|clienteUuid/g, '')), 'el registro de la cola no lleva nombre ni dirección de nadie');
  ok(!/google\.com\/maps|maps\.google|geo:|navigator\.share|window\.print|tel:|mailto:|wa\.me|createObjectURL|download=|\.csv|XLSX|leaflet/i.test(pag), 'sin botón de Google Maps, sin compartir, sin imprimir, sin exportar, sin llamar, sin mapa');
  ok(/@media print \{ body \{ display: none !important; \} \}/.test(pag), 'y al imprimir la página sale en blanco');
  ok(/robots/.test(pag) && /puerta-reglas\.js/.test(pag), 'noindex y las reglas compartidas');
  ok(!/api\(['"`]\/puerta-a-puerta\/listas/.test(pag), 'el celular de quien visita no pide las listas de quien arma');
  ok(leer('public/js/common.js').includes("/puerta-listas.html") && leer('public/app/inicio.html').includes("'/app/puerta-a-puerta.html'"), 'las entradas de menú de escritorio y de celular están');
  const html = leer('public/puerta-listas.html');
  ok(!/cedula|telefono|latitud|longitud|\.direccion|\.nombre_votante/i.test(html), 'la pantalla de armar no maneja datos de las personas');
  ok(/app\.use\('\/api\/puerta-a-puerta'/.test(leer('app.js')), 'la ruta está montada en app.js');

  /* ======================================================================================== 19. repetible */
  console.log('\n[19] Otra corrida de init-db no duplica ni rompe nada');
  const { spawnSync } = require('child_process');
  const tablasAntes = Number((await q(`SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE()`))[0].n);
  const editadoAntes = await q(`SELECT rol, modulo, permitido, editar, agregar FROM permisos_rol WHERE modulo LIKE 'puerta%' AND permitido = 1 ORDER BY rol, modulo`);
  const corr = spawnSync(process.execPath, [path.join(raiz, 'db/init-db.js')], { env: process.env, encoding: 'utf8', timeout: 240000 });
  ok(corr.status === 0, 'init-db sale con 0 en la segunda corrida', (corr.stderr || '').slice(-300));
  const tablasDespues = Number((await q(`SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE()`))[0].n);
  const editadoDespues = await q(`SELECT rol, modulo, permitido, editar, agregar FROM permisos_rol WHERE modulo LIKE 'puerta%' AND permitido = 1 ORDER BY rol, modulo`);
  const filasPuerta = Number((await q(`SELECT COUNT(*) n FROM permisos_rol WHERE modulo LIKE 'puerta%'`))[0].n);
  ok(tablasDespues === tablasAntes, 'mismas tablas', { tablasAntes, tablasDespues });
  ok(mismo(editadoAntes, editadoDespues) && editadoAntes.length >= 4, 'los permisos que el administrador abrió NO se pisan (init-db solo siembra los que faltan)', { editadoAntes, editadoDespues });
  ok(filasPuerta === 18, 'y quedan las 18 filas de fábrica (2 módulos × 9 roles), las que faltaban cerradas', filasPuerta);
  const pol2 = await q(`SELECT contenido FROM contenido_paginas WHERE clave = 'politica_privacidad'`);
  ok(!/visita domiciliaria/i.test(pol2[0].contenido), 'y la política sigue sin la finalidad nueva');
  for (const f of ['.credenciales-admin.txt', '.credenciales-superadmin.txt']) { try { if (fs.statSync(path.join(raiz, f)).mtimeMs > Date.now() - 600000) fs.unlinkSync(path.join(raiz, f)); } catch (_) { /* no existe */ } }

  servidor.close();
  await pool.end();
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR en la prueba:', e); process.exit(1); });
