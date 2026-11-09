#!/usr/bin/env node
// scripts/probar-encuestas.js
//
// Prueba de las ENCUESTAS INTERNAS (parche 307), Fases 1 y 2, del lado del servidor:
//   · migración repetible: cuatro tablas y DOS módulos apagados de fábrica (solo el administrador);
//   · ANÓNIMAS POR CONSTRUCCIÓN: las columnas de las tablas de respuestas se comparan con una LISTA CERRADA y con una lista negra de nombres de
//     identidad; ninguna llave foránea apunta a votantes; el GPS crudo no tiene dónde guardarse;
//   · permisos EXIGIDOS en el servidor, en los dos módulos y en cada nivel (Ver, Agregar, Editar); el aspirante con sublicencia no llega;
//   · el constructor: tipos, validaciones, «sensible» y «obligatoria» excluyentes, sin texto libre en una encuesta sensible, «No sabe / No responde»
//     automático, borrador → publicada → cerrada, duplicar, eliminar, y la versión CONGELADA con su huella (no se edita; si alguien la toca por fuera,
//     no se sirve);
//   · las reglas electorales: precampaña (con la palabra que lo causó, incluido el nombre del candidato), lo político hay que marcarlo sensible,
//     el día de la elección no se aplica nada, y todo se juzga con la FECHA DE CAPTURA;
//   · la zona con su degradación (zona → municipio → texto);
//   · registrar una respuesta: idempotente por cliente_uuid (también en carrera), validaciones por tipo, texto libre (80 caracteres, sin 7 dígitos ni
//     correos), ubicación SOLO la celda, lo capturado antes de cerrar se acepta después, la ventana de captura;
//   · la retención (textos libres y celdas) y su enganche en la vuelta diaria;
//   · los textos y el código de las pantallas del celular (cola, versión 9 de IndexedDB, service worker, solicitudes).
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada307 node scripts/probar-encuestas.js
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
app.use('/api/solicitudes', require('../routes/solicitudes.routes'));
let base = '';
async function pedir(metodo, ruta, { json, usuario, aspirante, prefijo = '/api/encuestas' } = {}) {
  const h = { 'X-Forwarded-For': '198.51.100.9', 'User-Agent': 'prueba/1.0' };
  let body;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (usuario) h['X-Test-User'] = JSON.stringify(usuario);
  if (aspirante) h['X-Test-Aspirante'] = String(aspirante);
  const r = await fetch(base + prefijo + ruta, { method: metodo, headers: h, body });
  const texto = await r.text();
  let datos = null; try { datos = JSON.parse(texto); } catch (_) { /* no json */ }
  return { status: r.status, datos, texto };
}

let n = 0;
const sello = String(Date.now()).slice(-7);            // para poder correr la prueba más de una vez sobre la misma base
async function usuario(nombre, rol) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, `98${sello}${n}`, `u98${sello}${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol]);
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
const fechaSql = async (expr) => (await q(`SELECT DATE_FORMAT(${expr}, '%Y-%m-%d') f`))[0].f;

/* una encuesta de las de siempre */
const normal = (extra = {}) => Object.assign({
  titulo: 'Necesidades del barrio', descripcion: 'Preguntas cortas para conocer el barrio', pide_ubicacion: 1,
  preguntas: [
    { tipo: 'unica', enunciado: '¿Cuál es el principal problema del barrio?', obligatoria: true, opciones: ['Vías', 'Agua', 'Seguridad'] },
    { tipo: 'multiple', enunciado: '¿Qué servicios usa?', opciones: ['Transporte', 'Salud', 'Colegio'] },
    { tipo: 'escala', enunciado: '¿Qué tan satisfecho está con la limpieza? (1 = nada, 5 = mucho)' },
    { tipo: 'numero', enunciado: '¿Cuántas personas viven en la casa?', num_min: 1, num_max: 30 },
    { tipo: 'texto', enunciado: '¿Qué mejoraría primero?' },
  ],
}, extra);
/* una encuesta que toca la opinión política (sensible) */
const politica = (extra = {}) => Object.assign({
  titulo: 'Percepción del territorio', descripcion: null, pide_ubicacion: 0,
  preguntas: [
    { tipo: 'unica', enunciado: '¿Qué tan de acuerdo está con el apoyo a esta propuesta?', sensible: true, opciones: ['De acuerdo', 'En desacuerdo'] },
    { tipo: 'escala', enunciado: '¿Cómo califica el estado de las vías? (1 = muy mal, 5 = muy bien)' },
  ],
}, extra);

(async () => {
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
  await config({ fecha_permitida_propaganda: null, fecha_eleccion: null, nombre_candidato: null, anonimizar_solicitudes_meses: 6 });
  // Repetible sobre la misma base: lo que esta prueba abrió en una corrida anterior se vuelve a cerrar (lo de fábrica es lo que se prueba primero).
  await q(`DELETE FROM permisos_rol WHERE modulo IN ('encuestas','encuestas_campo') AND rol <> 'admin'`);
  console.log('ENCUESTAS INTERNAS · FASES 1 Y 2 — base «' + nombreBase + '»\n');

  const E = require('../lib/encuestas');
  const Reglas = require('../lib/encuestasReglas');
  const Z = require('../lib/zonas');
  const { MODULOS } = require('../routes/permisos.routes');

  /* ====================================================================================== la gente */
  const admin = { id: 1, rol: 'admin', nombre: 'Admin Prueba' };
  const coord = await usuario('Coordinadora Ejemplo', 'coordinador'); await estructura(coord, 'coordinador');
  const lider = await usuario('Lider Ejemplo', 'lider'); await estructura(lider, 'lider', coord);
  const subl = await usuario('Sublider Ejemplo', 'sublider'); await estructura(subl, 'usuario', lider);
  const testigo = await usuario('Testigo Ejemplo', 'testigo');

  /* ====================================================================================== 1. migración */
  console.log('[1] Migración: tablas y módulos apagados de fábrica');
  const tablas = (await q(`SELECT table_name t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'encuesta%'`)).map((f) => f.t).sort();
  ok(tablas.join(',') === 'encuesta_cuotas,encuesta_preguntas,encuesta_respuesta_items,encuesta_respuestas,encuestas', 'las cinco tablas existen (cuatro del 307 y las cuotas del 308)', tablas);
  for (const m of ['encuestas', 'encuestas_campo']) {
    const abiertos = (await q(`SELECT rol FROM permisos_rol WHERE modulo = ? AND permitido = 1`, [m])).map((f) => f.rol);
    ok(abiertos.length === 1 && abiertos[0] === 'admin', `el módulo ${m} viene apagado de fábrica: solo el administrador`, abiertos);
    ok(MODULOS.some((x) => x.clave === m), `${m} está en el catálogo de la matriz de permisos`);
  }
  ok((await q(`SELECT COUNT(*) n FROM permisos_rol WHERE modulo IN ('encuestas','encuestas_campo') AND rol IN ('lider','sublider','testigo','coordinador') AND permitido = 1`))[0].n === 0, 'ningún otro rol los trae encendidos');

  /* ====================================================================================== 2. anónimas por construcción */
  console.log('\n[2] Anónimas por construcción: el esquema no tiene dónde guardar a una persona');
  const columnas = async (t) => (await q(`SELECT column_name c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position`, [t])).map((f) => f.c);
  const permitidas = {
    encuestas: 'id,titulo,descripcion,estado,pide_ubicacion,sensible,huella,copia_de,creada_por,publicada_en,publicada_por,cerrada_en,cerrada_por,creada_en,actualizada_en',
    encuesta_preguntas: 'id,encuesta_id,orden,tipo,enunciado,obligatoria,sensible,opciones,num_min,num_max',
    encuesta_respuestas: 'id,cliente_uuid,encuesta_id,huella,territorio_id,zona_texto,celda_lat,celda_lng,respondida_en,recibida_en,duracion_seg,aplicada_por,lider_id,sublider_id,rama_aspirante_id,aspirante_id,anonimizada_en,revision,senales,vector_hash,revisada_por,revisada_en',
    encuesta_respuesta_items: 'id,respuesta_id,pregunta_id,opcion_id,valor_num,valor_texto,nsnr,texto_revisado',
    encuesta_cuotas: 'encuesta_id,territorio_id,meta,actualizada_en',
  };
  for (const [t, lista] of Object.entries(permitidas)) {
    const reales = await columnas(t);
    ok(reales.join(',') === lista, `${t}: las columnas son EXACTAMENTE la lista cerrada (agregar una a mano rompe esta prueba)`, { sobran: reales.filter((c) => !lista.split(',').includes(c)), faltan: lista.split(',').filter((c) => !reales.includes(c)) });
  }
  const identidad = /nombre|cedula|cédula|identific|documento|telefono|teléfono|celular|correo|email|direccion|dirección|votante|persona|ciudadano|encuestado|(^|_)ip($|_)|latitud|longitud|gps|foto|firma|apellido/i;
  const deRespuestas = [].concat(await columnas('encuesta_respuestas'), await columnas('encuesta_respuesta_items'));
  ok(!deRespuestas.some((c) => identidad.test(c)), 'ninguna columna de las respuestas se llama como un dato de identidad', deRespuestas.filter((c) => identidad.test(c)));
  ok(!deRespuestas.includes('celda_ix') && deRespuestas.filter((c) => /^(lat|lng)/i.test(c)).length === 0, 'no hay latitud ni longitud crudas: solo celda_lat y celda_lng (el centro de la celda)');
  const fks = await q(`SELECT table_name t, referenced_table_name r FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND table_name LIKE 'encuesta%' AND referenced_table_name IS NOT NULL`);
  ok(!fks.some((f) => /votante|solicitud/.test(f.r)), 'ninguna llave foránea de las encuestas apunta a votantes ni a solicitudes', fks);
  ok(fks.filter((f) => f.t === 'encuesta_respuestas' && f.r === 'usuarios').length >= 1, 'lo único «de alguien» es la cuenta del equipo que aplicó (aplicada_por → usuarios)');
  const codigo = leer('lib/encuestas.js') + leer('routes/encuestas.routes.js');
  ok(!/FROM votantes|JOIN votantes|INTO votantes|votante_id\s*[,=)]/.test(codigo.replace(/\/\*[\s\S]*?\*\//g, '')), 'el código de las encuestas no toca la tabla votantes');
  ok(!/req\.ip|x-forwarded-for|remoteAddress/i.test(leer('lib/encuestas.js')), 'el registro de una respuesta no guarda la IP');

  /* ====================================================================================== 3. permisos */
  console.log('\n[3] Permisos exigidos en el servidor');
  const sin = await pedir('GET', '/', { usuario: lider });
  ok(sin.status === 403, 'sin la fila en la matriz: 403 en la lista del constructor', sin.status);
  ok((await pedir('GET', '/campo', { usuario: lider })).status === 403, 'sin la fila: 403 también en el celular');
  ok((await pedir('POST', '/campo/responder', { usuario: lider, json: {} })).status === 403, 'sin la fila: 403 al enviar una respuesta');
  ok((await pedir('GET', '/campo/zonas-lista', { usuario: testigo })).status === 403, 'el testigo no tiene nada: 403 en la lista de zonas');
  ok((await pedir('GET', '/', { usuario: admin })).status === 200, 'el administrador pasa siempre');
  await permisos('lider', 'encuestas_campo', 1, 0, 1); await permisos('sublider', 'encuestas_campo', 1, 0, 0);
  ok((await pedir('GET', '/campo', { usuario: lider })).status === 200, 'con «Ver» en encuestas_campo el líder abre la lista del celular');
  ok((await pedir('GET', '/', { usuario: lider })).status === 403, 'y APLICAR no da acceso al constructor ni a la lista de encuestas (quien aplica no ve el resto)');
  ok((await pedir('GET', '/1', { usuario: lider })).status === 403, 'ni al detalle');
  ok((await pedir('POST', '/', { usuario: lider, json: normal() })).status === 403, 'ni a crear');
  ok((await pedir('POST', '/campo/responder', { usuario: subl, json: { cliente_uuid: uuid() } })).status === 403, 'el sublíder con solo «Ver» no puede enviar respuestas');
  await permisos('coordinador', 'encuestas', 1, 0, 0);
  ok((await pedir('GET', '/', { usuario: coord })).status === 200, 'el coordinador con «Ver» en encuestas ve la lista');
  ok((await pedir('POST', '/', { usuario: coord, json: normal() })).status === 403, 'sin «Agregar» no crea');
  ok((await pedir('GET', '/campo', { usuario: coord })).status === 403, 'y construir tampoco le da el celular');
  await permisos('coordinador', 'encuestas', 1, 0, 1);
  const creadaPorCoord = await pedir('POST', '/', { usuario: coord, json: normal({ titulo: 'Borrador de la coordinadora' }) });
  ok(creadaPorCoord.status === 201, 'con «Agregar» crea un borrador', creadaPorCoord.datos);
  ok((await pedir('PUT', `/${creadaPorCoord.datos.id}`, { usuario: coord, json: normal() })).status === 403, 'sin «Editar» no guarda cambios');
  ok((await pedir('POST', `/${creadaPorCoord.datos.id}/publicar`, { usuario: coord })).status === 403, 'sin «Editar» no publica');
  ok((await pedir('DELETE', `/${creadaPorCoord.datos.id}`, { usuario: coord })).status === 403, 'ni elimina');
  ok((await pedir('POST', `/${creadaPorCoord.datos.id}/duplicar`, { usuario: coord })).status === 201, 'con «Agregar» sí duplica');
  await permisos('coordinador', 'encuestas', 1, 1, 1);
  ok((await pedir('PUT', `/${creadaPorCoord.datos.id}`, { usuario: coord, json: normal({ titulo: 'Editado' }) })).status === 200, 'con «Editar» guarda');
  const asp = await pedir('GET', '/campo', { usuario: lider, aspirante: lider.id });
  ok([403, 404].includes(asp.status), 'el aspirante con sublicencia no llega a las encuestas', asp.status);
  ok((await pedir('GET', '/', { usuario: admin, aspirante: admin.id })).status !== 200, 'ni siquiera con rol de administrador');

  /* ====================================================================================== 4. constructor */
  console.log('\n[4] El constructor: forma y validaciones');
  const mala = async (cuerpo, regex, texto) => {
    const r = await pedir('POST', '/', { usuario: admin, json: cuerpo });
    ok(r.status === 400 && regex.test(r.datos.error + ' ' + (r.datos.errores || []).join(' ')), texto, r.datos);
  };
  await mala(normal({ titulo: 'ab' }), /título/i, 'un título de dos letras se rechaza');
  await mala(normal({ preguntas: [{ tipo: 'inventado', enunciado: 'xxxxxx' }] }), /tipo/i, 'un tipo que no existe se rechaza');
  await mala(normal({ preguntas: [{ tipo: 'unica', enunciado: '¿Cuál prefiere?', opciones: ['Sola'] }] }), /al menos 2 opciones/i, 'una pregunta de opciones con una sola opción se rechaza');
  await mala(normal({ preguntas: [{ tipo: 'unica', enunciado: '¿Cuál prefiere?', opciones: ['Vías', 'vias'] }] }), /repetida/i, 'opciones repetidas (aunque cambie la tilde) se rechazan');
  await mala(normal({ preguntas: [{ tipo: 'unica', enunciado: '¿Cuál prefiere?', obligatoria: true, sensible: true, opciones: ['A', 'B'] }] }), /sensible no puede ser obligatoria/i, '«sensible» y «obligatoria» se excluyen');
  await mala(normal({ preguntas: [{ tipo: 'unica', enunciado: '¿Cuál prefiere?', sensible: true, opciones: ['A', 'B'] }, { tipo: 'texto', enunciado: '¿Por qué lo prefiere?' }] }), /sensibles no puede tener preguntas de texto/i, 'una encuesta con una pregunta sensible no admite texto libre');
  await mala(normal({ preguntas: [{ tipo: 'numero', enunciado: '¿Cuántos son?', num_min: 10, num_max: 2 }] }), /mínimo no puede ser mayor/i, 'un número con mínimo mayor que el máximo se rechaza');
  await mala(normal({ preguntas: [{ tipo: 'unica', enunciado: '¿Cuál prefiere?', opciones: Array.from({ length: 13 }, (_, i) => 'Opción ' + i) }] }), /máximo 12 opciones/i, 'más de 12 opciones se rechaza');
  await mala(normal({ preguntas: Array.from({ length: 41 }, () => ({ tipo: 'escala', enunciado: '¿Qué tan bien está?' })) }), /hasta 40 preguntas/i, 'más de 40 preguntas se rechaza');

  const creada = await pedir('POST', '/', { usuario: admin, json: normal({ preguntas: [
    { tipo: 'unica', enunciado: '¿Cuál es el principal problema del barrio?', obligatoria: true, opciones: ['Vías', 'Agua', 'No sabe / No responde', 'Seguridad'] },
    { tipo: 'multiple', enunciado: '¿Qué servicios usa?', opciones: 'Transporte\nSalud\nColegio' },
    { tipo: 'escala', enunciado: '¿Qué tan satisfecho está con la limpieza? (1 = nada, 5 = mucho)' },
    { tipo: 'numero', enunciado: '¿Cuántas personas viven en la casa?', num_min: 1, num_max: 30 },
    { tipo: 'texto', enunciado: '¿Qué mejoraría primero?' },
  ] }) });
  ok(creada.status === 201 && creada.datos.ok && Number.isInteger(creada.datos.id), 'se crea un borrador', creada.datos);
  const idN = creada.datos.id;
  let det = (await pedir('GET', `/${idN}`, { usuario: admin })).datos;
  ok(det.estado === 'borrador' && det.editable && det.preguntas.length === 5, 'el detalle trae el borrador con sus cinco preguntas');
  ok(det.preguntas[0].opciones.map((o) => o.texto).join('|') === 'Vías|Agua|Seguridad', '«No sabe / No responde» escrita a mano NO se duplica: se agrega sola', det.preguntas[0].opciones);
  ok(det.preguntas[0].opciones.map((o) => o.id).join(',') === 'o1,o2,o3' && det.preguntas[1].opciones.map((o) => o.texto).join('|') === 'Transporte|Salud|Colegio', 'las opciones reciben ids estables (o1, o2…) y aceptan texto con saltos de línea');
  ok(det.preguntas.filter((p) => p.nsnr).length === 4 && det.preguntas[4].nsnr === false, '«No sabe / No responde» es automático en toda pregunta menos la de texto');
  ok(det.preguntas.map((p) => p.orden).join(',') === '1,2,3,4,5', 'el orden se numera 1..5');
  const lista = (await pedir('GET', '/', { usuario: admin })).datos;
  ok(lista.encuestas.some((e) => e.id === idN && e.preguntas === 5 && e.respuestas === 0 && e.estado === 'borrador'), 'la lista dice estado, preguntas y respuestas (solo la cifra)');
  const reg = await pedir('PUT', `/${idN}`, { usuario: admin, json: normal({ titulo: 'Necesidades del barrio v2', preguntas: normal().preguntas.slice(0, 3) }) });
  det = (await pedir('GET', `/${idN}`, { usuario: admin })).datos;
  ok(reg.status === 200 && det.titulo === 'Necesidades del barrio v2' && det.preguntas.length === 3, 'guardar el borrador REEMPLAZA sus preguntas');
  ok((await pedir('GET', '/999999', { usuario: admin })).status === 404 && (await pedir('GET', '/abc', { usuario: admin })).status === 404, 'una encuesta que no existe: 404');
  ok(Array.isArray(reg.datos.problemas), 'al guardar devuelve lo que todavía impediría publicar (problemas)');
  const vacio = await pedir('POST', '/', { usuario: admin, json: { titulo: 'Sin preguntas aún', preguntas: [] } });
  ok(vacio.status === 201 && vacio.datos.problemas.some((p) => /al menos una pregunta/i.test(p)), 'un borrador vacío se guarda, pero avisa que no se puede publicar así');
  ok((await pedir('POST', `/${vacio.datos.id}/publicar`, { usuario: admin })).status === 422, 'y publicarlo se rechaza (422)');
  const elim = await pedir('DELETE', `/${vacio.datos.id}`, { usuario: admin });
  ok(elim.status === 200 && (await q('SELECT 1 FROM encuestas WHERE id = ?', [vacio.datos.id])).length === 0, 'un borrador se elimina');
  const dup0 = await pedir('POST', `/${idN}/duplicar`, { usuario: admin });
  const detDup = (await pedir('GET', `/${dup0.datos.id}`, { usuario: admin })).datos;
  ok(dup0.status === 201 && detDup.estado === 'borrador' && /^Copia de/.test(detDup.titulo) && detDup.preguntas.length === 3, 'duplicar crea un borrador nuevo con las mismas preguntas');
  ok((await q('SELECT copia_de FROM encuestas WHERE id = ?', [dup0.datos.id]))[0].copia_de === idN, 'y anota de cuál se copió');

  /* ====================================================================================== 5. reglas de publicación */
  console.log('\n[5] Publicar: las reglas electorales (precampaña, lo político es sensible)');
  const publicarFalla = async (cuerpo, regex, texto) => {
    const c = await pedir('POST', '/', { usuario: admin, json: cuerpo });
    const p = await pedir('POST', `/${c.datos.id}/publicar`, { usuario: admin });
    ok(p.status === 422 && regex.test(p.datos.error + ' ' + (p.datos.errores || []).join(' ')), texto, p.datos);
    return c.datos.id;
  };
  await config({ fecha_permitida_propaganda: null, nombre_candidato: 'Ana Maria Rojas' });
  for (const [palabra, texto] of [['vot', '¿Piensa ir a votar este año?'], ['elecci', '¿Qué espera de la elección?'], ['cargo', '¿Qué cargo le gustaría ver ocupado?'],
    ['candidat', '¿Conoce al candidato?'], ['partid', '¿Qué partido prefiere?'], ['apoy', '¿Brindaría su apoyo a una propuesta?'], ['favorab', '¿Cuál es su opinión de la favorabilidad?'], ['imagen', '¿Qué imagen tiene del barrio?']]) {
    await publicarFalla(normal({ preguntas: [{ tipo: 'escala', enunciado: texto, sensible: true }] }), new RegExp(palabra, 'i'), `precampaña: «${palabra}…» en una pregunta se rechaza y dice qué palabra lo causó`);
  }
  await publicarFalla(normal({ titulo: 'Encuesta sobre Rojas' }), /rojas/i, 'precampaña: el APELLIDO del candidato también se rechaza (en el título)');
  await publicarFalla(normal({ descripcion: 'Habla Ana Maria Rojas con la gente' }), /(ana maria rojas|rojas)/i, 'precampaña: el nombre completo del candidato, en la descripción');
  await publicarFalla(normal({ preguntas: [{ tipo: 'unica', enunciado: '¿Qué arreglaría primero?', opciones: ['Las vías', 'El alcalde actual'] }] }), /alcald/i, 'precampaña: una OPCIÓN con el nombre de un cargo también se revisa (la palabra viene del validador de recordatorios)');
  const rr = await pedir('POST', '/', { usuario: admin, json: normal({ preguntas: [{ tipo: 'escala', enunciado: '¿Qué tan bien está el barrio?' }, { tipo: 'unica', enunciado: '¿Votó en la última jornada?', opciones: ['Sí', 'No'] }] }) });
  const rp = await pedir('POST', `/${rr.datos.id}/publicar`, { usuario: admin });
  ok(rp.status === 422 && /«vot/i.test(rp.datos.error), 'el mensaje dice la palabra entre comillas', rp.datos.error);
  ok(R_mensajeCompleto(rp.datos.errores), 'y explica qué hacer (cambiar la redacción o esperar la fecha)', rp.datos.errores);

  await config({ fecha_permitida_propaganda: await fechaSql('DATE_SUB(CURDATE(), INTERVAL 1 DAY)') });
  const polSinMarca = await publicarFalla(normal({ preguntas: [{ tipo: 'escala', enunciado: '¿Qué tan de acuerdo está con el candidato?' }] }), /sensible/i, 'con la fecha ya cumplida, una pregunta política SIN marcar sensible igual se rechaza (hay que marcarla)');
  ok(polSinMarca > 0, 'la encuesta se queda en borrador');
  const polOk = await pedir('POST', '/', { usuario: admin, json: politica() });
  const polPub = await pedir('POST', `/${polOk.datos.id}/publicar`, { usuario: admin });
  ok(polPub.status === 200 && /^[0-9a-f]{16}$/.test(polPub.datos.huella), 'marcada sensible y con la fecha cumplida, se publica y recibe una huella de 16 caracteres', polPub.datos);
  ok((await q('SELECT sensible FROM encuestas WHERE id = ?', [polOk.datos.id]))[0].sensible === 1, 'la encuesta queda marcada sensible');

  /* ====================================================================================== 6. versión congelada */
  console.log('\n[6] La versión congelada: huella, no se edita, duplicar, cerrar');
  await config({ fecha_permitida_propaganda: null, nombre_candidato: null });
  const norm = await pedir('POST', '/', { usuario: admin, json: normal() });
  const idP = norm.datos.id;
  const pub = await pedir('POST', `/${idP}/publicar`, { usuario: admin });
  ok(pub.status === 200 && pub.datos.huella.length === 16, 'una encuesta normal se publica con la fecha vacía (no habla de política)', pub.datos);
  det = (await pedir('GET', `/${idP}`, { usuario: admin })).datos;
  ok(det.estado === 'publicada' && det.editable === false && det.huella === pub.datos.huella && det.huella_ok === true, 'queda publicada, no editable y con la huella verificada');
  const h1 = E.huellaDe(E.contenidoCanonico({ titulo: 'x', descripcion: null, pide_ubicacion: 0 }, [{ orden: 1, tipo: 'escala', enunciado: 'a b c', obligatoria: 0, sensible: 0, opciones: null, num_min: null, num_max: null }]));
  const h2 = E.huellaDe(E.contenidoCanonico({ titulo: 'x', descripcion: null, pide_ubicacion: 0 }, [{ orden: 1, tipo: 'escala', enunciado: 'a b c', obligatoria: 0, sensible: 0, opciones: null, num_min: null, num_max: null }]));
  const h3 = E.huellaDe(E.contenidoCanonico({ titulo: 'x', descripcion: null, pide_ubicacion: 0 }, [{ orden: 1, tipo: 'escala', enunciado: 'a b d', obligatoria: 0, sensible: 0, opciones: null, num_min: null, num_max: null }]));
  ok(h1 === h2 && h1 !== h3, 'la huella es determinista y cambia si cambia una letra');
  const put = await pedir('PUT', `/${idP}`, { usuario: admin, json: normal({ titulo: 'Intento de edición' }) });
  ok(put.status === 409 && /congelada|publicó/i.test(put.datos.error), 'una encuesta publicada NO se edita (409, con el motivo)', put.datos);
  ok((await q('SELECT titulo FROM encuestas WHERE id = ?', [idP]))[0].titulo === 'Necesidades del barrio', 'y el título sigue igual en la base');
  ok((await pedir('POST', `/${idP}/publicar`, { usuario: admin })).status === 409, 'publicar dos veces: 409');
  ok((await pedir('DELETE', `/${idP}`, { usuario: admin })).status === 409, 'una publicada no se elimina: 409');
  // Quien intente editar las preguntas por la puerta de atrás de la lógica tampoco puede.
  let falloGuardar = null;
  try { await E.guardarBorrador(idP, E.normalizarBorrador(normal()).datos, admin); } catch (e) { falloGuardar = e; }
  ok(falloGuardar && falloGuardar.estado === 409, 'la función que guarda también se niega (no solo la ruta)');
  // Tocada por fuera: la huella lo delata.
  const preg1 = (await q('SELECT id, enunciado FROM encuesta_preguntas WHERE encuesta_id = ? ORDER BY orden LIMIT 1', [idP]))[0];
  await q('UPDATE encuesta_preguntas SET enunciado = ? WHERE id = ?', ['Pregunta alterada por fuera', preg1.id]);
  det = (await pedir('GET', `/${idP}`, { usuario: admin })).datos;
  ok(det.huella_ok === false, 'si alguien toca las preguntas por fuera, el detalle lo dice (huella_ok = false)');
  await config({ fecha_eleccion: null });
  ok(!(await pedir('GET', '/campo', { usuario: lider })).datos.encuestas.some((e) => e.id === idP), 'y esa encuesta NO se sirve al celular');
  ok((await pedir('GET', '/campo', { usuario: lider })).datos.suspendidas >= 1, 'se cuenta como suspendida');
  const hojaTocada = await pedir('POST', '/campo/responder', { usuario: lider, json: { cliente_uuid: uuid(), encuesta_id: idP, huella: pub.datos.huella, zona_texto: 'Zona X', respuestas: [{ pregunta_id: preg1.id, nsnr: true }] } });
  ok(hojaTocada.status === 409, 'ni recibe respuestas (409)', hojaTocada.datos);
  await q('UPDATE encuesta_preguntas SET enunciado = ? WHERE id = ?', [preg1.enunciado, preg1.id]);
  ok((await pedir('GET', `/${idP}`, { usuario: admin })).datos.huella_ok === true, 'al restaurarla, la huella vuelve a coincidir');
  const dupP = await pedir('POST', `/${idP}/duplicar`, { usuario: admin });
  ok(dupP.status === 201 && (await pedir('GET', `/${dupP.datos.id}`, { usuario: admin })).datos.editable === true, 'duplicar una publicada da un borrador editable');
  const cierre = await pedir('POST', `/${polOk.datos.id}/cerrar`, { usuario: admin });
  ok(cierre.status === 200 && (await q('SELECT estado, cerrada_en FROM encuestas WHERE id = ?', [polOk.datos.id]))[0].estado === 'cerrada', 'cerrar una publicada la deja cerrada');
  ok((await pedir('POST', `/${polOk.datos.id}/cerrar`, { usuario: admin })).status === 409 && (await pedir('POST', `/${norm.datos.id}/cerrar`, { usuario: admin })).status === 200, 'cerrar dos veces: 409; una publicada, 200');
  // la `norm` se cerró recién: se vuelve a publicar una para lo que sigue
  const aud = (await q(`SELECT accion FROM auditoria WHERE entidad = 'encuestas' ORDER BY id`)).map((f) => f.accion);
  ok(['encuesta_crear', 'encuesta_editar', 'encuesta_publicar', 'encuesta_cerrar', 'encuesta_duplicar', 'encuesta_eliminar'].every((a) => aud.includes(a)), 'la auditoría apunta crear, editar, publicar, cerrar, duplicar y eliminar', [...new Set(aud)]);

  /* ====================================================================================== 7. zona y degradación */
  console.log('\n[7] La zona y su degradación: zona → municipio → texto');
  await q('DELETE FROM territorios');
  let l = await Z.listaDeZonas();
  ok(l.nivel === 'texto' && l.zonas.length === 0, 'sin catálogo: nivel «texto», la zona se escribe');
  let z = await Z.resolverZonaDeCampo({ zona_texto: '  Barrio escrito  ' });
  ok(z.territorio_id === null && z.zona_texto === 'Barrio escrito', 'en nivel texto se acepta lo escrito (limpio)');
  ok(await Z.resolverZonaDeCampo({ zona_texto: '' }).then(() => false, (e) => e.estado === 400), 'y sin nada, 400');
  await q(`INSERT INTO territorios (id, tipo, nombre, padre_id) VALUES (9101, 'municipio', 'Municipio Ejemplo', NULL)`);
  l = await Z.listaDeZonas();
  ok(l.nivel === 'municipio' && l.zonas.length === 1, 'solo municipios: nivel «municipio»');
  z = await Z.resolverZonaDeCampo({ territorio_id: 9101 });
  ok(z.territorio_id === 9101 && z.zona_texto === 'Municipio Ejemplo', 'se acepta el municipio y se completa el nombre');
  ok(await Z.resolverZonaDeCampo({ zona_texto: 'algo escrito' }).then(() => false, (e) => e.estado === 400), 'con municipios en el catálogo, un texto suelto ya no basta');
  await q(`INSERT INTO territorios (id, tipo, nombre, padre_id) VALUES (9102, 'comuna', 'Comuna Centro', 9101), (9103, 'barrio', 'El Carmen', 9102), (9104, 'vereda', 'La Cabaña', 9101), (9105, 'corregimiento', 'Corregimiento Alto', 9101)`);
  l = await Z.listaDeZonas();
  ok(l.nivel === 'zona' && l.zonas.map((x) => x.nombre).sort().join('|') === 'Comuna Centro|Corregimiento Alto|El Carmen|La Cabaña', 'con barrios, veredas, comunas y corregimientos: nivel «zona» con LOS CUATRO tipos (no solo barrio y vereda)', l.zonas);
  ok(l.zonas.find((x) => x.nombre === 'El Carmen').padre === 'Comuna Centro', 'cada zona trae su padre, para distinguir dos con el mismo nombre');
  ok(await Z.resolverZonaDeCampo({ territorio_id: 9101 }).then(() => false, (e) => e.estado === 400), 'con zonas finas, el MUNICIPIO ya no es una zona válida (sería no decir nada)');
  ok((await Z.resolverZonaDeCampo({ territorio_id: 9103 })).zona_texto === 'El Carmen', 'y un barrio sí');
  ok(await Z.resolverZonaDeCampo({ territorio_id: 987654 }).then(() => false, (e) => e.estado === 400), 'un id que no existe: 400');
  const zl = await pedir('GET', '/campo/zonas-lista', { usuario: lider });
  ok(zl.status === 200 && zl.datos.nivel === 'zona' && zl.datos.zonas.length === 4, 'la ruta de las encuestas entrega la lista para guardar en el celular');
  const zs = await pedir('GET', '/zonas-lista', { usuario: admin, prefijo: '/api/solicitudes' });
  ok(zs.status === 200 && zs.datos.nivel === 'zona' && zs.datos.zonas.length === 4, 'y Solicitudes entrega LA MISMA lista (antes solo veía barrios y veredas)');
  ok((await pedir('GET', '/zonas-lista', { usuario: testigo, prefijo: '/api/solicitudes' })).status === 403, 'Solicitudes la protege con su propio módulo');

  /* ====================================================================================== 8. el celular: lista congelada y bloqueos */
  console.log('\n[8] Lo que recibe el celular');
  const norm2 = await pedir('POST', '/', { usuario: admin, json: normal({ titulo: 'Encuesta de campo' }) });
  const idC = norm2.datos.id;
  await pedir('POST', `/${idC}/publicar`, { usuario: admin });
  const campo = (await pedir('GET', '/campo', { usuario: lider })).datos;
  const enC = campo.encuestas.find((e) => e.id === idC);
  ok(enC && enC.preguntas.length === 5 && enC.huella && enC.pide_ubicacion === true, 'la encuesta publicada llega con su contenido congelado, su huella y si pide ubicación');
  ok(!campo.encuestas.some((e) => e.id === dupP.datos.id), 'los borradores NO llegan al celular');
  ok(!campo.encuestas.some((e) => e.id === polOk.datos.id), 'una CERRADA tampoco');
  ok(campo.bloqueo === null && campo.nsnr === 'No sabe / No responde' && campo.hoy && 'fecha_eleccion' in campo, 'trae la fecha de la elección (para bloquear también sin señal) y el texto de «No sabe / No responde»');
  ok(!JSON.stringify(campo).includes('respuestas'), 'y ningún dato de respuestas ajenas');
  const hoy = await fechaSql('CURDATE()');
  await config({ fecha_eleccion: hoy });
  const dia = (await pedir('GET', '/campo', { usuario: lider })).datos;
  ok(dia.bloqueo && dia.bloqueo.codigo === 'dia_de_la_eleccion' && dia.encuestas.length === 0 && /elección/.test(dia.bloqueo.mensaje), 'EL DÍA DE LA ELECCIÓN la lista viene vacía y dice por qué', dia.bloqueo);
  await config({ fecha_eleccion: await fechaSql('DATE_ADD(CURDATE(), INTERVAL 1 DAY)') });
  ok((await pedir('GET', '/campo', { usuario: lider })).datos.encuestas.length >= 1, 'el día antes, normal');
  await config({ fecha_eleccion: null });
  // una encuesta que dejó de pasar la precampaña (alguien movió la fecha permitida)
  await config({ fecha_permitida_propaganda: await fechaSql('DATE_SUB(CURDATE(), INTERVAL 1 DAY)') });
  const polDos = await pedir('POST', '/', { usuario: admin, json: politica({ titulo: 'Percepción dos' }) });
  await pedir('POST', `/${polDos.datos.id}/publicar`, { usuario: admin });
  ok((await pedir('GET', '/campo', { usuario: lider })).datos.encuestas.some((e) => e.id === polDos.datos.id), 'con la fecha permitida cumplida, la encuesta sensible se sirve');
  await config({ fecha_permitida_propaganda: null });
  const sus = (await pedir('GET', '/campo', { usuario: lider })).datos;
  ok(!sus.encuestas.some((e) => e.id === polDos.datos.id) && sus.suspendidas >= 1 && sus.encuestas.some((e) => e.id === idC), 'si borran la fecha permitida, esa encuesta queda SUSPENDIDA (no se sirve) y las demás siguen');

  /* ====================================================================================== 9. responder */
  console.log('\n[9] Registrar una respuesta');
  const ez = (await pedir('GET', `/${idC}`, { usuario: admin })).datos;
  const P = (orden) => ez.preguntas.find((p) => p.orden === orden);
  const ahoraIso = () => new Date().toISOString();
  const cuerpoBueno = (extra = {}) => Object.assign({
    cliente_uuid: uuid(), encuesta_id: idC, huella: ez.huella, respondida_en: ahoraIso(), iniciada_en: new Date(Date.now() - 90000).toISOString(),
    territorio_id: 9103, celda_ix: Math.floor(-75.5 / 0.005), celda_iy: Math.floor(5.07 / 0.005),
    respuestas: [
      { pregunta_id: P(1).id, opcion: 'o2' },
      { pregunta_id: P(2).id, opciones: ['o1', 'o3'] },
      { pregunta_id: P(3).id, valor: 4 },
      { pregunta_id: P(4).id, valor: 5 },
      { pregunta_id: P(5).id, texto: 'Arreglar la calle principal' },
    ],
  }, extra);
  const envia = (u, json) => pedir('POST', '/campo/responder', { usuario: u, json });
  const malaResp = async (json, regex, texto, estado = 400) => {
    const r = await envia(lider, json);
    ok(r.status === estado && regex.test(r.datos.error), texto, r.datos);
  };

  const b1 = cuerpoBueno();
  const r1 = await envia(lider, b1);
  ok(r1.status === 201 && r1.datos.ok && r1.datos.duplicado === false && Number.isInteger(r1.datos.id), 'una respuesta válida se guarda (201)', r1.datos);
  ok(Object.keys(r1.datos).sort().join(',') === 'duplicado,id,ok', 'la respuesta del servidor no devuelve nada de lo respondido');
  const fila = (await q('SELECT * FROM encuesta_respuestas WHERE id = ?', [r1.datos.id]))[0];
  ok(fila.aplicada_por === lider.id && fila.lider_id === lider.id && fila.encuesta_id === idC && fila.huella === ez.huella && fila.territorio_id === 9103 && fila.zona_texto === 'El Carmen', 'queda con quién la aplicó (el equipo), la versión y la zona', fila);
  ok(fila.duracion_seg >= 85 && fila.duracion_seg <= 100, 'y cuánto tardó (para el control de calidad)', fila.duracion_seg);
  const items = await q('SELECT * FROM encuesta_respuesta_items WHERE respuesta_id = ? ORDER BY pregunta_id, opcion_id', [r1.datos.id]);
  ok(items.length === 6, 'seis filas: única (1), múltiple (2 opciones), escala, número y texto', items.length);
  ok(items.filter((i) => i.pregunta_id === P(2).id).map((i) => i.opcion_id).join(',') === 'o1,o3' && items.find((i) => i.pregunta_id === P(3).id).valor_num === '4.00' && items.find((i) => i.pregunta_id === P(5).id).valor_texto === 'Arreglar la calle principal', 'cada tipo guarda su valor');

  // idempotencia
  const r1b = await envia(lider, b1);
  ok(r1b.status === 200 && r1b.datos.duplicado === true && r1b.datos.id === r1.datos.id, 'el mismo cliente_uuid devuelve la MISMA respuesta (200, duplicado), sin duplicar');
  ok((await q('SELECT COUNT(*) n FROM encuesta_respuestas WHERE cliente_uuid = ?', [b1.cliente_uuid]))[0].n === 1, 'sigue habiendo una sola fila');
  const carrera = cuerpoBueno();
  const dos = await Promise.all([E.registrarRespuesta({ usuario: lider, body: carrera }), E.registrarRespuesta({ usuario: lider, body: carrera })]);
  ok(dos[0].id === dos[1].id && (await q('SELECT COUNT(*) n FROM encuesta_respuestas WHERE cliente_uuid = ?', [carrera.cliente_uuid]))[0].n === 1, 'dos envíos A LA VEZ del mismo registro: una sola fila (gana uno, el otro devuelve la misma)', dos);
  ok((await q('SELECT COUNT(*) n FROM encuesta_respuesta_items i JOIN encuesta_respuestas r ON r.id = i.respuesta_id WHERE r.cliente_uuid = ?', [carrera.cliente_uuid]))[0].n === 6, 'y sus filas no se duplicaron');

  // validaciones
  await malaResp(cuerpoBueno({ cliente_uuid: 'no-es-uuid' }), /cliente_uuid/, 'sin un cliente_uuid válido se rechaza');
  await malaResp(cuerpoBueno({ encuesta_id: 999999 }), /no existe/, 'una encuesta que no existe: 404', 404);
  await malaResp(cuerpoBueno({ huella: '0000000000000000' }), /otra versión/, 'otra versión (huella distinta): 409', 409);
  await malaResp(cuerpoBueno({ encuesta_id: dupP.datos.id }), /todavía no está publicada/, 'un borrador no recibe respuestas', 404);
  await malaResp(cuerpoBueno({ territorio_id: null, zona_texto: '' }), /zona/i, 'la zona es OBLIGATORIA');
  await malaResp(cuerpoBueno({ territorio_id: 9101 }), /zona/i, 'y debe ser del nivel vigente (el municipio no sirve si hay barrios)');
  await malaResp(cuerpoBueno({ respuestas: [{ pregunta_id: P(2).id, opciones: ['o1'] }] }), /pregunta 1/, 'una pregunta obligatoria sin respuesta se rechaza y dice cuál');
  await malaResp(cuerpoBueno({ respuestas: [] }), /pregunta 1|vacía/, 'una respuesta vacía se rechaza');
  await malaResp(cuerpoBueno({ respuestas: [{ pregunta_id: P(1).id, opcion: 'o9' }] }), /elige una de las opciones/i, 'una opción que no existe se rechaza');
  await malaResp(cuerpoBueno({ respuestas: [{ pregunta_id: P(1).id, opcion: 'o1' }, { pregunta_id: P(2).id, opciones: ['o1', 'o7'] }] }), /pregunta 2/i, 'una opción múltiple con una opción inexistente se rechaza');
  await malaResp(cuerpoBueno({ respuestas: [{ pregunta_id: P(1).id, opcion: 'o1' }, { pregunta_id: P(3).id, valor: 6 }] }), /escala va de 1 a 5/i, 'la escala fuera de 1-5 se rechaza');
  await malaResp(cuerpoBueno({ respuestas: [{ pregunta_id: P(1).id, opcion: 'o1' }, { pregunta_id: P(3).id, valor: 2.5 }] }), /escala va de 1 a 5/i, 'y no admite decimales');
  await malaResp(cuerpoBueno({ respuestas: [{ pregunta_id: P(1).id, opcion: 'o1' }, { pregunta_id: P(4).id, valor: 31 }] }), /máximo es 30/i, 'un número sobre el máximo se rechaza');
  await malaResp(cuerpoBueno({ respuestas: [{ pregunta_id: P(1).id, opcion: 'o1' }, { pregunta_id: P(4).id, valor: 0 }] }), /mínimo es 1/i, 'y bajo el mínimo');
  await malaResp(cuerpoBueno({ respuestas: [{ pregunta_id: P(1).id, opcion: 'o1' }, { pregunta_id: 987654, valor: 1 }] }), /ninguna pregunta/, 'una pregunta de otra encuesta se rechaza');
  await malaResp(cuerpoBueno({ respuestas: [{ pregunta_id: P(1).id, opcion: 'o1' }, { pregunta_id: P(1).id, opcion: 'o2' }] }), /dos veces/, 'la misma pregunta dos veces se rechaza');
  await malaResp(cuerpoBueno({ respuestas: [{ pregunta_id: P(1).id, opcion: 'o1' }, { pregunta_id: P(5).id, nsnr: true }] }), /no tiene/i, 'una pregunta de texto no tiene «No sabe / No responde»');
  // texto libre
  const conTexto = (t) => cuerpoBueno({ respuestas: [{ pregunta_id: P(1).id, opcion: 'o1' }, { pregunta_id: P(5).id, texto: t }] });
  await malaResp(conTexto('x'.repeat(81)), /80 caracteres/, 'texto libre: más de 80 caracteres se rechaza');
  await malaResp(conTexto('Llámeme al 3001234567'), /siete o más dígitos/, 'texto libre: siete dígitos seguidos (un celular) se rechaza');
  await malaResp(conTexto('Mi cédula es 10.234.567'), /siete o más dígitos/, 'texto libre: una cédula con puntos también');
  await malaResp(conTexto('Es el 300 123 4567'), /siete o más dígitos/, 'texto libre: un teléfono con espacios también');
  await malaResp(conTexto('escríbame a juan@correo.com'), /correo/i, 'texto libre: un correo se rechaza');
  const okTexto = await envia(lider, conTexto('Hay 12 huecos en la calle 5'));
  ok(okTexto.status === 201, 'texto libre: cifras cortas y texto normal sí pasan', okTexto.datos);
  const enBlanco = await envia(lider, cuerpoBueno({ respuestas: [{ pregunta_id: P(1).id, opcion: 'o1' }, { pregunta_id: P(5).id, texto: '   ' }] }));
  ok(enBlanco.status === 201 && (await q('SELECT COUNT(*) n FROM encuesta_respuesta_items i WHERE i.respuesta_id = ? AND i.valor_texto IS NOT NULL', [enBlanco.datos.id]))[0].n === 0, 'un texto en blanco cuenta como «sin responder»');
  // No sabe / No responde
  const nsnr = await envia(lider, cuerpoBueno({ respuestas: [{ pregunta_id: P(1).id, nsnr: true }, { pregunta_id: P(3).id, nsnr: true }] }));
  const itNs = await q('SELECT nsnr, opcion_id, valor_num FROM encuesta_respuesta_items WHERE respuesta_id = ?', [nsnr.datos.id]);
  ok(nsnr.status === 201 && itNs.length === 2 && itNs.every((i) => i.nsnr === 1 && i.opcion_id === null && i.valor_num === null), '«No sabe / No responde» se guarda como tal y cuenta como respuesta a una pregunta obligatoria');

  // ubicación
  const centroLat = Number(((b1.celda_iy + 0.5) * 0.005).toFixed(4)), centroLng = Number(((b1.celda_ix + 0.5) * 0.005).toFixed(4));
  ok(Number(fila.celda_lat) === centroLat && Number(fila.celda_lng) === centroLng && Math.abs(centroLat - 5.07) < 0.005 && Math.abs(centroLng + 75.5) < 0.005, 'la ubicación guardada es el CENTRO de la celda de 0,005° (no la coordenada)', [fila.celda_lat, fila.celda_lng, centroLat, centroLng]);
  const fuera = await envia(lider, cuerpoBueno({ celda_ix: 100000, celda_iy: 100000 }));
  ok(fuera.status === 201 && (await q('SELECT celda_lat FROM encuesta_respuestas WHERE id = ?', [fuera.datos.id]))[0].celda_lat === null, 'una celda fuera de Colombia se descarta (la respuesta se guarda igual)');
  const sinCelda = await envia(lider, cuerpoBueno({ celda_ix: undefined, celda_iy: undefined }));
  ok(sinCelda.status === 201 && (await q('SELECT celda_lat FROM encuesta_respuestas WHERE id = ?', [sinCelda.datos.id]))[0].celda_lat === null, 'la ubicación es opcional: sin ella se guarda igual');
  const sinPedir = await pedir('POST', '/', { usuario: admin, json: normal({ titulo: 'Sin ubicación', pide_ubicacion: 0 }) });
  await pedir('POST', `/${sinPedir.datos.id}/publicar`, { usuario: admin });
  const dSP = (await pedir('GET', `/${sinPedir.datos.id}`, { usuario: admin })).datos;
  const rSP = await envia(lider, { cliente_uuid: uuid(), encuesta_id: dSP.id, huella: dSP.huella, respondida_en: ahoraIso(), territorio_id: 9103, celda_ix: -15100, celda_iy: 1014,
    respuestas: [{ pregunta_id: dSP.preguntas[0].id, opcion: 'o1' }] });
  ok(rSP.status === 201 && (await q('SELECT celda_lat, celda_lng FROM encuesta_respuestas WHERE id = ?', [rSP.datos.id]))[0].celda_lat === null, 'si la encuesta NO pide ubicación, lo que llegue se descarta');

  // atribución para el alcance
  const rSub = await envia(subl, cuerpoBueno()); // sublíder con solo «Ver»: 403
  ok(rSub.status === 403, 'el sublíder sin «Agregar» no envía');
  await permisos('sublider', 'encuestas_campo', 1, 0, 1);
  const rSub2 = await envia(subl, cuerpoBueno());
  const fSub = (await q('SELECT aplicada_por, lider_id, sublider_id FROM encuesta_respuestas WHERE id = ?', [rSub2.datos.id]))[0];
  ok(rSub2.status === 201 && fSub.aplicada_por === subl.id && fSub.sublider_id === subl.id && fSub.lider_id === lider.id, 'la respuesta de un sublíder queda con su líder y su sublíder (para el alcance de los resultados)', fSub);

  // ventana de captura, cierre y elección
  await malaResp(cuerpoBueno({ respondida_en: new Date(Date.now() - 8 * 86400000).toISOString() }), /hace más de 7 días/, 'una respuesta tomada hace más de 7 días ya no se acepta');
  await malaResp(cuerpoBueno({ respondida_en: new Date(Date.now() + 2 * 86400000).toISOString() }), /adelantada/, 'un reloj adelantado más de un día se rechaza');
  const unPoco = await envia(lider, cuerpoBueno({ respondida_en: new Date(Date.now() + 5 * 60000).toISOString() }));
  ok(unPoco.status === 201, 'un reloj adelantado unos minutos se acepta (se ajusta a la hora del servidor)');
  const antes = await envia(lider, cuerpoBueno({ respondida_en: new Date(Date.now() - 3 * 86400000).toISOString() }));
  ok(antes.status === 201 && (await q('SELECT respondida_en FROM encuesta_respuestas WHERE id = ?', [antes.datos.id]))[0].respondida_en < (await q('SELECT NOW() n'))[0].n, 'lo capturado hace tres días se guarda con SU hora, no con la de la subida');
  // cierre: lo capturado antes se acepta, lo capturado después no
  const cerr = await pedir('POST', '/', { usuario: admin, json: normal({ titulo: 'A cerrar' }) });
  await pedir('POST', `/${cerr.datos.id}/publicar`, { usuario: admin });
  const dCe = (await pedir('GET', `/${cerr.datos.id}`, { usuario: admin })).datos;
  await pedir('POST', `/${cerr.datos.id}/cerrar`, { usuario: admin });
  const deCe = (rel) => ({ cliente_uuid: uuid(), encuesta_id: dCe.id, huella: dCe.huella, respondida_en: rel, territorio_id: 9103, respuestas: [{ pregunta_id: dCe.preguntas[0].id, opcion: 'o1' }] });
  const tardia = await envia(lider, deCe(new Date(Date.now() - 3600000).toISOString()));
  ok(tardia.status === 201, 'LO CAPTURADO ANTES DE CERRAR se acepta aunque suba después de cerrar', tardia.datos);
  await new Promise((r) => setTimeout(r, 1500));            // la hora se guarda al segundo: que la captura sea claramente posterior al cierre
  const posterior = await envia(lider, deCe(new Date().toISOString()));
  ok(posterior.status === 409 && /se cerró/.test(posterior.datos.error), 'lo capturado DESPUÉS de cerrar se rechaza (409, dice cuándo se cerró)', posterior.datos);
  // día de la elección: por la fecha de captura
  await config({ fecha_eleccion: await fechaSql('CURDATE()') });
  await malaResp(cuerpoBueno(), /día de la elección/, 'EL DÍA DE LA ELECCIÓN no se recibe una respuesta tomada ese día', 422);
  const ayerCap = await envia(lider, cuerpoBueno({ respondida_en: new Date(Date.now() - 30 * 3600000).toISOString() }));
  ok(ayerCap.status === 201, 'pero lo capturado el día anterior y subido ese día SÍ se acepta (se juzga por el día de la captura)', ayerCap.datos);
  await config({ fecha_eleccion: null });
  // precampaña por la fecha de captura
  await config({ fecha_permitida_propaganda: await fechaSql('DATE_ADD(CURDATE(), INTERVAL 1 DAY)') });
  const polTres = await pedir('POST', '/', { usuario: admin, json: politica({ titulo: 'Percepción tres' }) });
  await config({ fecha_permitida_propaganda: await fechaSql('DATE_SUB(CURDATE(), INTERVAL 1 DAY)') });
  const pubTres = await pedir('POST', `/${polTres.datos.id}/publicar`, { usuario: admin });
  const dTres = (await pedir('GET', `/${polTres.datos.id}`, { usuario: admin })).datos;
  const cTres = (cuando) => ({ cliente_uuid: uuid(), encuesta_id: dTres.id, huella: dTres.huella, respondida_en: cuando, territorio_id: 9103, respuestas: [{ pregunta_id: dTres.preguntas[0].id, opcion: 'o1' }] });
  ok(pubTres.status === 200 && (await envia(lider, cTres(ahoraIso()))).status === 201, 'una encuesta política capturada con la fecha permitida cumplida, se acepta');
  await config({ fecha_permitida_propaganda: null });
  const sinFecha = await envia(lider, cTres(ahoraIso()));
  ok(sinFecha.status === 422 && /«/.test(sinFecha.datos.error), 'si después borran la fecha permitida, la misma respuesta se rechaza y dice la palabra', sinFecha.datos);
  await config({ fecha_permitida_propaganda: await fechaSql('DATE_SUB(CURDATE(), INTERVAL 1 DAY)') });
  ok((await envia(lider, cTres(new Date(Date.now() - 3600000).toISOString()))).status === 201, 'y con la fecha cumplida vuelve a pasar');
  await config({ fecha_permitida_propaganda: null });
  // sin falsos aliados
  ok(Reglas.problemaDeTextoLibre('Calle 5 con carrera 12') === null && Reglas.problemaDeTextoLibre('3001234') !== null && Reglas.problemaDeTextoLibre('123456') === null, 'regla de texto: 6 dígitos pasan, 7 no');
  ok(Reglas.palabraProhibidaEncuesta('¿Está de acuerdo con el apoyo?', null) === 'apoy' || /apoy/.test(Reglas.palabraProhibidaEncuesta('¿Está de acuerdo con el apoyo?', null) || ''), 'las palabras que agrega la encuesta funcionan aun sin configuración');
  ok(Reglas.palabraProhibidaEncuesta('¿Cuántos participantes hay?', null) === null && Reglas.palabraProhibidaEncuesta('Una partida de ajedrez', null) === null, 'y no se confunden «participantes» ni «partida» con «partido»');

  /* ====================================================================================== 10. retención */
  console.log('\n[10] La retención: textos libres y celdas (misma vuelta diaria que las solicitudes)');
  const total0 = (await q('SELECT COUNT(*) n FROM encuesta_respuestas'))[0].n;
  const itemsNum0 = (await q('SELECT COUNT(*) n FROM encuesta_respuesta_items WHERE valor_num IS NOT NULL OR opcion_id IS NOT NULL'))[0].n;
  const conTextos = (await q('SELECT COUNT(*) n FROM encuesta_respuesta_items WHERE valor_texto IS NOT NULL'))[0].n;
  const conCeldas = (await q('SELECT COUNT(*) n FROM encuesta_respuestas WHERE celda_lat IS NOT NULL'))[0].n;
  ok(conTextos > 0 && conCeldas > 0, 'hay textos y celdas guardados para vencer', { conTextos, conCeldas });
  let ret = await E.borrarTextosYCeldasVencidos({ aplicar: true });
  ok(ret.aplicado === false && /No hay fecha de elección/.test(ret.motivo) && (await q('SELECT COUNT(*) n FROM encuesta_respuesta_items WHERE valor_texto IS NOT NULL'))[0].n === conTextos, 'sin fecha de elección no borra NADA');
  await config({ fecha_eleccion: await fechaSql('DATE_ADD(CURDATE(), INTERVAL 10 DAY)') });
  ret = await E.borrarTextosYCeldasVencidos({ aplicar: true });
  ok(ret.aplicado === false && /Todavía no/.test(ret.motivo) && (await q('SELECT COUNT(*) n FROM encuesta_respuestas WHERE celda_lat IS NOT NULL'))[0].n === conCeldas, 'antes del plazo no borra nada');
  await config({ fecha_eleccion: await fechaSql('DATE_SUB(CURDATE(), INTERVAL 8 MONTH)') });
  ret = await E.borrarTextosYCeldasVencidos({ aplicar: false });
  ok(ret.aplicado === false && ret.vencen.textos === conTextos && ret.vencen.celdas === conCeldas && /Simulación/.test(ret.motivo), 'vencido el plazo, la simulación cuenta lo que se borraría y no borra', ret);
  ok((await q('SELECT COUNT(*) n FROM encuesta_respuesta_items WHERE valor_texto IS NOT NULL'))[0].n === conTextos, 'la simulación no tocó nada');
  ret = await E.borrarTextosYCeldasVencidos({ aplicar: true });
  ok(ret.aplicado && ret.textos === conTextos && ret.celdas === conCeldas, 'aplicado: borra todos los textos y todas las celdas', ret);
  ok((await q('SELECT COUNT(*) n FROM encuesta_respuesta_items WHERE valor_texto IS NOT NULL'))[0].n === 0 && (await q('SELECT COUNT(*) n FROM encuesta_respuestas WHERE celda_lat IS NOT NULL OR celda_lng IS NOT NULL'))[0].n === 0, 'ya no queda ningún texto libre ni ninguna celda');
  ok((await q('SELECT COUNT(*) n FROM encuesta_respuestas'))[0].n === total0 && (await q('SELECT COUNT(*) n FROM encuesta_respuesta_items WHERE valor_num IS NOT NULL OR opcion_id IS NOT NULL'))[0].n === itemsNum0, 'las respuestas y sus cifras (opciones, escalas, números) se CONSERVAN');
  ok((await q('SELECT COUNT(*) n FROM encuesta_respuestas WHERE anonimizada_en IS NOT NULL'))[0].n >= 1, 'las tocadas quedan marcadas con anonimizada_en');
  ret = await E.borrarTextosYCeldasVencidos({ aplicar: true });
  ok(ret.aplicado && ret.textos === 0 && ret.celdas === 0, 'repetible: una segunda pasada no encuentra nada');
  // el enganche en la vuelta diaria
  await envia(lider, cuerpoBueno({ respondida_en: ahoraIso() }));
  const SM = require('../lib/solicitudesMantenimiento');
  SM.reiniciarMemoria();
  const auditoriasAntes = (await q(`SELECT COUNT(*) n FROM auditoria WHERE accion = 'encuesta_anonimizar_auto' AND usuario_id IS NULL`))[0].n;
  const vuelta = await SM.vueltaDiaria({ forzar: true });
  ok(vuelta.corrio && vuelta.encuestas && vuelta.encuestas.aplicado && vuelta.encuestas.textos === 1 && vuelta.encuestas.celdas === 1, 'la vuelta diaria de las solicitudes también borra los textos y celdas de las encuestas', vuelta.encuestas);
  ok((await q(`SELECT COUNT(*) n FROM auditoria WHERE accion = 'encuesta_anonimizar_auto' AND usuario_id IS NULL`))[0].n === auditoriasAntes + 1, 'y deja UN apunte «encuesta_anonimizar_auto» en la auditoría, sin usuario');
  await config({ fecha_eleccion: null });

  /* ====================================================================================== 11. el código del celular */
  console.log('\n[11] El código del celular: versión 9, cola, service worker, solicitudes');
  const off = leer('public/js/offline-utils.js');
  ok(/OFFLINE_DB_VERSION = (?:9|10);/.test(off), 'OFFLINE_DB_VERSION = 9 (10 desde el parche 309)');
  const stores = /const OFFLINE_STORES = \[([\s\S]*?)\];/.exec(off)[1];
  ok(/'encuestas_pendientes'/.test(stores) && /'encuestas_cache'/.test(stores) && /'solicitudes_pendientes'/.test(stores) && /'tareas_pendientes'/.test(stores), 'los cajones nuevos están y los anteriores siguen (IndexedDB solo agrega los que faltan)');
  ok(/OFFLINE_STORES_COPIA = \[[^\]]*'encuestas_cache'[^\]]*\]/.test(off) && !/OFFLINE_STORES_COPIA = \[[^\]]*'encuestas_pendientes'/.test(off), 'encuestas_cache es una COPIA (por usuario) y encuestas_pendientes es una COLA (con dueño, no se borra al cambiar de cuenta)');
  ok(/COPIAS_SIN_SENAL = \[[^\]]*'encuestas_cache'[^\]]*\]/.test(leer('public/js/cuentas-dispositivo.js')), 'cuentas-dispositivo.js también borra la copia al cambiar de cuenta (la lista está duplicada a propósito)');
  const sw = leer('public/service-worker.js');
  ok(/estrategia-v17[789]/.test(sw) && ['/app/encuestas-campo.html', '/app/encuesta-aplicar.html', '/js/zona-campo.js', '/js/encuestas-cola.js'].every((u) => sw.includes(`'${u}'`)), 'service worker v177 (v178 desde el 308, v179 desde el 309) con las páginas y los scripts nuevos en la coraza');
  const cola = leer('public/js/encuestas-cola.js');
  ok(!/sincronizarCola\(/.test(cola.replace(/\/\*[\s\S]*?\*\//g, '')), 'la cola de encuestas NO usa sincronizarCola (que toma por éxito el undefined de un 401 y borra el registro)');
  ok(/res\.ok !== true/.test(cola) && /estado = 'fallido'/.test(cola) && !/borrarDeColaOffline\([^)]*\)[^;]*fallido/.test(cola), 'solo se borra lo que el servidor confirmó con ok:true; un rechazo queda «fallido»');
  const aplicar = leer('public/app/encuesta-aplicar.html');
  ok(/celda_ix/.test(aplicar) && !/latitud\s*:/.test(aplicar) && !/longitud\s*:/.test(aplicar), 'aplicar una encuesta manda los índices de la celda, nunca latitud ni longitud');
  ok(!/borrarDeColaOffline/.test(aplicar), 'y la pantalla de captura NO borra de la cola: un rechazo queda visible');
  ok(/hoyEnColombia\(\)/.test(aplicar) && /fecha_eleccion/.test(aplicar), 'bloquea el día de la elección también sin señal (con la fecha guardada en el celular)');
  for (const f of ['public/encuestas.html', 'public/app/encuesta-aplicar.html', 'public/app/encuestas-campo.html']) {
    ok(/Uso interno – no publicable/.test(leer(f)), `${f}: lleva la marca «Uso interno – no publicable»`);
  }
  const sol = leer('public/app/solicitud-nueva.html');
  ok(/cargarZonasDeCampo\('\/solicitudes\/zonas-lista'\)/.test(sol) && /zona-campo\.js/.test(sol) && !/\['barrio', 'vereda'\]\.includes/.test(sol), 'Solicitudes: las zonas salen de la degradación compartida, no del filtro barrio/vereda');
  ok(!/borrarDeColaOffline/.test(sol), 'Solicitudes: la pantalla de registro ya NO borra de la cola un registro rechazado');
  ok(/data-reintentar/.test(leer('public/app/mis-solicitudes.html')) && /data-descartar/.test(leer('public/app/mis-solicitudes.html')), 'y «Mis solicitudes» deja Reintentar y Descartar sobre lo fallido');
  ok(/'tareas_pendientes'/.test(stores) && /OFFLINE_DB_VERSION/.test(off), 'las colas de solicitudes y tareas siguen en la base');

  /* ====================================================================================== fin */
  await q('DELETE FROM territorios WHERE id BETWEEN 9101 AND 9105');
  console.log(fallos ? `\n${fallos} FALLO(S).` : '\nTodo bien.');
  servidor.close();
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch(async (e) => { console.error('ERROR en la prueba:', e); try { await pool.end(); } catch (_) { /* ya cerrado */ } process.exit(1); });

function R_mensajeCompleto(errores) {
  return Array.isArray(errores) && errores.some((m) => /Cambia la redacción o espera/.test(m));
}
