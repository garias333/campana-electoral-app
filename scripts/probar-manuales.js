#!/usr/bin/env node
// scripts/probar-manuales.js
//
// Prueba de los MANUALES DE AYUDA (orden Manuales 2): lib/manuales.js, routes/manuales.routes.js y el contenido de manuales/.
//   · Contenido: cero avisos al validar (ningún bloque huérfano: módulo, nivel, rol o ruta inexistente; ids repetidos), la estructura
//     que se pidió (para qué sirve, pasos, «Así sabes que funcionó», consejo o cuidado), todas las referencias {{id}}, un bloque por
//     cada módulo de la matriz, ningún «Consulta con tu administrador», NINGÚN cargo de elección (con y sin tildes).
//   · Escape: un texto con <script> no sale como etiqueta.
//   · Validación al arrancar: ids repetidos, módulo o ruta inexistentes y bloques sin módulo ni roles se avisan y se omiten.
//   · Permisos: para cada rol (admin, coordinador, lider, aspirante, sublider, testigo, usuario, asistente, administrativo, invitado)
//     `/api/manuales/mio` responde 200 y trae EXACTAMENTE los bloques que sus permisos permiten (se calculan aparte, leyendo la base y
//     las cabeceras de los archivos). Quitar un permiso saca su bloque; darlo lo agrega.
//   · `/rol/:rol` e `/instalacion`: 403 a quien no es administrador.
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada295 node scripts/probar-manuales.js
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
const os = require('os');
const path = require('path');
const express = require('express');
const http = require('http');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const manuales = require('../lib/manuales');
const { PERMISOS_ASPIRANTE, MODULOS_ASPIRANTE } = require('../middleware/aspirante');
const { moduloTieneImportarExportar } = require('../config/importarExportar');
const { MODULOS } = require('../routes/permisos.routes');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];

// ----------------------------------------------------------------------------------------------- servidor de prueba
let sublicencia = null;
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const u = req.headers['x-test-user'];
  req.session = { usuario: u ? JSON.parse(u) : undefined };
  req.sublicencia = req.headers['x-test-aspirante'] ? sublicencia : null;
  next();
});
app.use('/api/permisos', require('../routes/permisos.routes'));
app.use('/api/manuales', require('../routes/manuales.routes'));

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
async function crearUsuario(nombre, rol) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo)
     VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, `8500000${n}`, `u8500000${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  return { id: r.insertId, rol, nombre };
}

// ----------------------------------------------------------------------------------------------- lo esperado, calculado APARTE
function cabecerasDeArchivos(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const { meta, cuerpo } = manuales.partirArchivo(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { archivo: f, meta, cuerpo, texto: fs.readFileSync(path.join(dir, f), 'utf8') };
  });
}

function nivelOk(p, nivel) {
  if (!p || !p.ver) return false;
  if (nivel === 'ver') return true;
  if (nivel === 'editar') return !!p.editar;
  if (nivel === 'agregar') return !!p.agregar;
  if (nivel === 'importar') return !!p.importar_exportar;
  return false;
}

async function permisosEsperados(rol) {
  const p = {};
  if (rol === 'admin') { MODULOS.forEach((m) => { p[m.clave] = { ver: 1, editar: 1, agregar: 1, importar_exportar: moduloTieneImportarExportar(m.clave) ? 1 : 0 }; }); return p; }
  if (rol === 'aspirante') { MODULOS_ASPIRANTE.forEach((m) => { p[m] = { ver: PERMISOS_ASPIRANTE[m].ver, editar: PERMISOS_ASPIRANTE[m].editar, agregar: PERMISOS_ASPIRANTE[m].agregar, importar_exportar: PERMISOS_ASPIRANTE[m].importar_exportar }; }); return p; }
  (await q('SELECT modulo, permitido, editar, agregar, importar_exportar FROM permisos_rol WHERE rol = ?', [rol])).forEach((f) => {
    p[f.modulo] = { ver: f.permitido, editar: f.editar, agregar: f.agregar, importar_exportar: f.importar_exportar };
  });
  return p;
}

async function idsEsperados(rol, bloquesCrudos) {
  const permisos = await permisosEsperados(rol);
  const roles = new Set(rol === 'aspirante' ? ['aspirante', 'lider'] : [rol]);
  return bloquesCrudos.filter((b) => {
    const modulo = b.meta.modulo || '';
    if (modulo) return nivelOk(permisos[modulo], b.meta.nivel || 'ver');
    const lista = String(b.meta.roles || '').split(',').map((s) => s.trim()).filter(Boolean);
    return lista.includes('todos') || lista.some((r) => roles.has(r));
  }).map((b) => b.meta.id).sort();
}

function idsDeRespuesta(d) {
  const ids = [];
  (d.secciones || []).forEach((s) => s.bloques.forEach((b) => ids.push(b.id)));
  (d.faq || []).forEach((b) => ids.push(b.id));
  (d.glosario || []).forEach((b) => ids.push(b.id));
  return ids.sort();
}

const CARGOS = /\b(alcaldia|alcalde|alcaldesa|concejo|concejal(es)?|concejala|gobernacion|gobernador(a)?|asamblea|diputad[oa]s?|jal|edil(es)?|senad(o|or|ora)|camara de representantes|presidencia)\b/i;

(async () => {
  // Activar complementos (parche 318): los complementos nacen APAGADOS; esta prueba enciende los que necesita.
  await require('./fixtures/encender-complementos')(pool, ['solicitudes', 'tareas', 'puerta_a_puerta', 'puerta_panel', 'alertas_dia_d', 'resultados_dia_d', 'transporte_dia_d', 'logistica_dia_d', 'faltan_por_votar', 'finanzas']);
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;

  // ============================================================== 1. EL CONTENIDO
  console.log('\n[1] El contenido de manuales/');
  const estado = manuales.cargar({ forzar: true, silencioso: true });
  ok(estado.avisos.length === 0, 'al validar no hay ningún aviso (ningún bloque huérfano ni id repetido)', estado.avisos);
  const crudos = cabecerasDeArchivos(manuales.DIR_BLOQUES);
  const crudosInst = cabecerasDeArchivos(manuales.DIR_INSTALACION);
  ok(estado.bloques.length === crudos.length, `se cargaron todos los bloques (${estado.bloques.length} de ${crudos.length} archivos)`);
  ok(estado.instalacion.length === crudosInst.length && crudosInst.length >= 10, `se cargaron los bloques de instalación (${estado.instalacion.length} de ${crudosInst.length})`);

  const porSeccion = (s) => estado.bloques.filter((b) => b.seccion === s).length;
  console.log(`  · bloques: ${estado.bloques.length - porSeccion('faq') - porSeccion('glosario')} guías, ${porSeccion('faq')} preguntas, ${porSeccion('glosario')} términos, ${estado.instalacion.length} de instalación`);
  ok(porSeccion('faq') >= 28, 'hay unas 30 preguntas frecuentes', porSeccion('faq'));
  ok(porSeccion('glosario') >= 36, 'hay unos 40 términos de glosario', porSeccion('glosario'));

  // Un bloque por cada módulo de la matriz (27 con enviar_push).
  MODULOS.forEach((m) => {
    const b = estado.bloques.find((x) => x.id === 'mod-' + m.clave);
    ok(b && b.modulo === m.clave && b.nivel === 'ver', `existe el bloque del módulo ${m.clave}`);
  });
  ok(MODULOS.some((m) => m.clave === 'enviar_push'), 'enviar_push ya está en la matriz de permisos');

  // Estructura de cada bloque.
  const malos = [];
  estado.bloques.concat(estado.instalacion).forEach((b) => {
    const c = b.cuerpo;
    if (/consulta con tu administrador/i.test(c)) malos.push(`${b.id}: «consulta con tu administrador»`);
    // (Las capturas ya se llenan —orden Manuales 4—; su existencia, peso y nombre se revisan más abajo.)
    if (/<script|<\/?[a-z][^>]*>/i.test(c.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, ''))) malos.push(`${b.id}: HTML en el cuerpo`);
    if (b.seccion === 'faq' || b.seccion === 'glosario' || b.seccion === 'instalacion') return;
    if (b.id.startsWith('mod-')) {
      if (!/## Qué encuentras/.test(c)) malos.push(`${b.id}: sin «Qué encuentras»`);
      if (!/## Qué puedes hacer según tu permiso/.test(c)) malos.push(`${b.id}: sin «Qué puedes hacer según tu permiso»`);
      if (!/## Tareas frecuentes/.test(c)) malos.push(`${b.id}: sin «Tareas frecuentes»`);
    } else {
      // Pasos numerados (la mayoría bajo «## Pasos»; unas pocas guías traen dos flujos o una hoja para imprimir, con otros subtítulos).
      if (!/^\s*1\.\s/m.test(c)) malos.push(`${b.id}: sin pasos numerados`);
    }
    // «Así sabes que funcionó» es de las TAREAS; el bloque de un módulo describe la pantalla y no lo necesita.
    if (!b.id.startsWith('mod-') && !/^:::\s*listo\s*$/m.test(c)) malos.push(`${b.id}: sin «Así sabes que funcionó»`);
    if (!/^:::\s*(consejo|cuidado|importante)\s*$/m.test(c)) malos.push(`${b.id}: sin consejo ni cuidado`);
    if (!c.split(/\n## /)[0].replace(/^---[\s\S]*?\n---/, '').trim()) malos.push(`${b.id}: sin «para qué sirve»`);
  });
  ok(malos.length === 0, 'cada tarea trae para qué sirve, pasos, «Así sabes que funcionó» y un consejo o cuidado (y cada módulo, sus tres apartados); sin HTML', malos);

  // Los recuadros abren y cierran.
  const desbalance = estado.bloques.concat(estado.instalacion).filter((b) => {
    const abre = (b.cuerpo.match(/^:::\s*[a-z]+\s*$/gm) || []).length;
    const cierra = (b.cuerpo.match(/^:::\s*$/gm) || []).length;
    return abre !== cierra;
  }).map((b) => b.id);
  ok(desbalance.length === 0, 'todos los recuadros ::: cierran', desbalance);

  // Precampaña: ningún cargo, con o sin tildes, en ningún archivo de manuales/.
  const archivosTexto = [];
  const recorrer = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) recorrer(p); else if (/\.(md|txt)$/.test(e.name)) archivosTexto.push(p);
  });
  recorrer(manuales.RAIZ);
  const conCargo = [];
  archivosTexto.forEach((f) => {
    manuales.sinTildes(fs.readFileSync(f, 'utf8')).split('\n').forEach((linea, i) => {
      const m = linea.match(CARGOS);
      if (m) conCargo.push(`${path.relative(manuales.RAIZ, f)}:${i + 1} «${m[0]}»`);
    });
  });
  ok(conCargo.length === 0, `ningún texto nombra un cargo de elección (${archivosTexto.length} archivos revisados)`, conCargo);

  // Datos personales: ni cédulas completas ni teléfonos completos.
  const personales = [];
  archivosTexto.forEach((f) => {
    const t = fs.readFileSync(f, 'utf8');
    if (/\b3\d{9}\b/.test(t)) personales.push(path.relative(manuales.RAIZ, f) + ': teléfono de 10 dígitos');
    if (/\b\d{8,10}\b/.test(t.replace(/\b3\d{9}\b/g, ''))) personales.push(path.relative(manuales.RAIZ, f) + ': número largo (¿cédula?)');
  });
  ok(personales.length === 0, 'sin teléfonos ni cédulas completos', personales);

  // Capturas de pantalla (orden Manuales 4): cada una referenciada existe, no sobra ningún archivo, ninguna pasa de 150 KB.
  const todosLosBloques = estado.bloques.concat(estado.instalacion);
  const referenciadas = new Map();   // archivo → id de la guía
  const sinArchivo = [];
  todosLosBloques.forEach((b) => {
    String(b.captura || '').split(',').map((x) => x.trim()).filter(Boolean).forEach((f) => {
      referenciadas.set(f, b.id);
      if (!fs.existsSync(path.join(manuales.DIR_IMG, f))) sinArchivo.push(`${b.id}: ${f}`);
    });
  });
  ok(sinArchivo.length === 0, 'cada captura referenciada en una guía existe en public/manuales/img/', sinArchivo);
  const enDisco = fs.existsSync(manuales.DIR_IMG) ? fs.readdirSync(manuales.DIR_IMG) : [];
  const sobran = enDisco.filter((f) => !referenciadas.has(f));
  ok(sobran.length === 0, `no sobra ningún archivo en public/manuales/img/ (${enDisco.length} archivos, ${referenciadas.size} referenciados)`, sobran);
  ok(enDisco.length >= 50, `hay unas 60 capturas (${enDisco.length})`);
  const pesadas = enDisco.filter((f) => fs.statSync(path.join(manuales.DIR_IMG, f)).size > manuales.PESO_MAXIMO_CAPTURA);
  ok(pesadas.length === 0, 'ninguna captura pesa más de 150 KB', pesadas);
  const noWebp = enDisco.filter((f) => !/\.webp$/.test(f) || !manuales.medirWebp(fs.readFileSync(path.join(manuales.DIR_IMG, f))));
  ok(noWebp.length === 0, 'todas las capturas son WebP legibles', noWebp);
  const malNombradas = [...referenciadas].filter(([f, id]) => !(f === id + '.webp' || f === id + '-2.webp')).map(([f, id]) => `${id}: ${f}`);
  ok(malNombradas.length === 0, 'cada captura se llama como su guía (<id>.webp o <id>-2.webp)', malNombradas);
  const dePorMas = todosLosBloques.filter((b) => String(b.captura || '').split(',').filter((x) => x.trim()).length > 2).map((b) => b.id);
  ok(dePorMas.length === 0, 'ninguna guía lleva más de dos capturas', dePorMas);
  ok(todosLosBloques.every((b) => (b.capturas || []).length === String(b.captura || '').split(',').filter((x) => x.trim()).length), 'el servidor entiende todas las capturas declaradas');

  // ============================================================== 2. ESCAPE
  console.log('\n[2] Escape del HTML');
  const sucio = manuales.renderMarkdown('Hola <script>alert(1)</script> y <img src=x onerror=alert(1)> **negrita** [[Guardar]]\n\n```\n<b>codigo</b>\n```\n\n| a | b |\n|---|---|\n| <i>x</i> | y |\n\n::: cuidado\n<u>texto</u>\n:::');
  ok(!/<script|<img|<b>|<i>|<u>/.test(sucio), 'las etiquetas escritas en el texto salen escapadas', sucio);
  ok(sucio.includes('&lt;script&gt;') && sucio.includes('<strong>negrita</strong>') && sucio.includes('<span class="boton-app">Guardar</span>'), 'lo que el convertidor genera sí sale como etiqueta');

  // ============================================================== 3. VALIDACIÓN AL ARRANCAR
  console.log('\n[3] Validación al cargar: lo que falla se avisa y se omite');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'manuales-prueba-'));
  const mod = manuales.catalogoDeModulos();
  const cab = (o) => '---\n' + Object.entries({ seccion: 'durante', orden: 1, icono: 'lista', ...o }).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n---\nTexto.\n';
  const escribir = (id, o) => fs.writeFileSync(path.join(tmp, id + '.md'), cab({ id, titulo: 'T ' + id, ...o }));
  escribir('bueno', { modulo: 'votantes', nivel: 'ver' });
  escribir('mod-malo', { modulo: 'modulo_que_no_existe', nivel: 'ver' });
  escribir('nivel-malo', { modulo: 'votantes', nivel: 'mandar' });
  escribir('importar-malo', { modulo: 'agenda', nivel: 'importar' });
  escribir('sin-roles', { modulo: '' });
  escribir('rol-malo', { roles: 'rey' });
  escribir('ruta-mala', { roles: 'todos', ruta: 'Menú > Pantalla que no existe' });
  escribir('ruta-buena', { roles: 'todos', ruta: 'Escritorio: Electoral > Votantes y sublíderes' });
  fs.writeFileSync(path.join(tmp, 'sin-cabecera.md'), 'Solo texto\n');
  fs.writeFileSync(path.join(tmp, 'id-distinto.md'), cab({ id: 'otro-id', titulo: 'x', roles: 'todos' }));
  const r = manuales.cargarDirectorio(tmp, { modulos: mod });
  const ids = r.bloques.map((b) => b.id).sort();
  ok(JSON.stringify(ids) === JSON.stringify(['bueno', 'ruta-buena']), 'solo sobreviven los bloques válidos', ids);
  ok(r.avisos.length >= 8, 'cada bloque malo deja su aviso', r.avisos);
  ok(r.avisos.some((a) => /no existe en la matriz/.test(a)) && r.avisos.some((a) => /no termina en una entrada real de menú/.test(a))
    && r.avisos.some((a) => /sin módulo y sin roles/.test(a)) && r.avisos.some((a) => /sin importar\/exportar/.test(a)),
  'los avisos dicen por qué (módulo, ruta, roles, importar)');
  // Escape también por el archivo: un bloque con <script> no sale como etiqueta.
  fs.writeFileSync(path.join(tmp, 'xss.md'), '---\nid: xss\ntitulo: Prueba\nseccion: durante\norden: 9\nicono: lista\nroles: todos\n---\n<script>alert(1)</script>\n');
  const r2 = manuales.cargarDirectorio(tmp, { modulos: mod });
  const xss = r2.bloques.find((b) => b.id === 'xss');
  ok(xss && !/<script/.test(manuales.renderMarkdown(xss.cuerpo, { titulos: new Map() })), 'un bloque con <script> escrito en el archivo se pinta como texto');
  fs.rmSync(tmp, { recursive: true, force: true });

  // ============================================================== 4. PERMISOS REALES POR ROL
  console.log('\n[4] /api/manuales/mio con los permisos de cada rol');
  const usuarios = {};
  const roles = ['admin', 'coordinador', 'lider', 'sublider', 'testigo', 'usuario', 'asistente_administrativo', 'administrativo', 'invitado'];
  for (const rol of roles) usuarios[rol] = await crearUsuario('Prueba ' + rol, rol);
  usuarios.aspirante = await crearUsuario('Prueba aspirante', 'lider');
  sublicencia = { usuario_id: usuarios.aspirante.id, cargo: 'cargo-de-prueba', nombre: 'Campaña de prueba', activa: 1 };

  const cuentas = {};
  for (const rol of [...roles, 'aspirante']) {
    const esAsp = rol === 'aspirante';
    const res = await pedir('/api/manuales/mio', usuarios[rol], esAsp);
    ok(res.status === 200, `${rol}: /mio responde 200`, res.texto.slice(0, 200));
    if (res.status !== 200) continue;
    const esperado = await idsEsperados(rol, crudos);
    const real = idsDeRespuesta(res.datos);
    const faltan = esperado.filter((x) => !real.includes(x));
    const sobran = real.filter((x) => !esperado.includes(x));
    ok(!faltan.length && !sobran.length, `${rol}: trae EXACTAMENTE los ${esperado.length} bloques que sus permisos permiten`, { faltan, sobran });
    ok(res.datos.rol === rol && typeof res.datos.titulo === 'string' && res.datos.permisos && res.datos.permisos.votantes !== undefined, `${rol}: trae su título, su rol y los permisos por módulo para las insignias`);
    ok(/^\d{4}-\d{2}-\d{2}$/.test(res.datos.fecha_contenido || ''), `${rol}: trae la fecha del contenido (${res.datos.fecha_contenido})`);
    cuentas[rol] = res.datos.totales;
    // Las capturas viajan con su tamaño (para reservar el espacio y saber si es de celular), nunca como ruta de archivo del servidor.
    const conCaptura = res.datos.secciones.flatMap((sec) => sec.bloques).filter((b) => b.capturas && b.capturas.length);
    ok(conCaptura.every((b) => b.capturas.every((c) => /^[a-z0-9][a-z0-9_-]*\.webp$/.test(c.archivo) && c.ancho > 0 && c.alto > 0 && typeof c.celular === 'boolean')),
      `${rol}: sus capturas traen archivo, ancho, alto y si son de celular (${conCaptura.length} guías con captura)`);
    ok(res.datos.totales.bloques + res.datos.totales.faq + res.datos.totales.glosario === real.length, `${rol}: los totales cuadran con lo que trae`);
    // Las insignias dicen lo mismo que el filtro.
    const e = await permisosEsperados(rol);
    const inc = Object.keys(res.datos.permisos).filter((k) => !!res.datos.permisos[k].ver !== !!(e[k] && e[k].ver));
    ok(!inc.length, `${rol}: las insignias de «Puede ver» coinciden con sus permisos`, inc);
    if (rol === 'admin') ok(Array.isArray(res.datos.tarjetas) && res.datos.tarjetas.length === 11, 'admin: la portada trae 11 tarjetas (10 roles incluido aspirante, y la instalación)', (res.datos.tarjetas || []).length);
    else ok(!res.datos.tarjetas, `${rol}: no trae las tarjetas de los demás manuales`);
  }
  console.log('  · bloques por rol (guías / preguntas / términos): ' + Object.entries(cuentas).map(([r, t]) => `${r} ${t.bloques}/${t.faq}/${t.glosario}`).join(' · '));

  // Contenido que depende de a quién va.
  const idsDe = async (rol, asp) => idsDeRespuesta((await pedir('/api/manuales/mio', usuarios[rol], asp)).datos);
  const idsLider = await idsDe('lider');
  ok(idsLider.includes('t-qr-enlace') && !idsLider.includes('mod-usuarios') && !idsLider.includes('t-backup'), 'el líder ve su QR y no ve Usuarios ni Backup');
  ok((await idsDe('testigo')).includes('t-testigo-llegue') && !(await idsDe('lider')).includes('t-testigo-llegue'), 'el testigo ve «Llegué a mi puesto» y el líder no');
  ok((await idsDe('admin')).includes('t-backup') && !(await idsDe('coordinador')).includes('t-backup'), 'solo el administrador ve Backup');

  // ============================================================== 5. QUITAR Y DAR UN PERMISO
  console.log('\n[5] Quitar un permiso saca su bloque; darlo lo agrega');
  const filaVotantes = (await q("SELECT permitido, editar, agregar, importar_exportar FROM permisos_rol WHERE rol = 'lider' AND modulo = 'votantes'"))[0];
  ok(!!filaVotantes, 'el rol líder tiene su fila de Votantes');
  const lider = usuarios.lider;
  const tiene = async (id) => (await idsDe('lider')).includes(id);
  try {
    await q("UPDATE permisos_rol SET permitido = 1, editar = 1, agregar = 1, importar_exportar = 1 WHERE rol = 'lider' AND modulo = 'votantes'");
    ok(await tiene('mod-votantes') && await tiene('t-votante-agregar') && await tiene('t-votante-editar') && await tiene('t-votantes-importar'), 'con todo encendido salen ver, agregar, editar e importar de Votantes');
    await q("UPDATE permisos_rol SET importar_exportar = 0 WHERE rol = 'lider' AND modulo = 'votantes'");
    ok(!(await tiene('t-votantes-importar')) && await tiene('t-votante-agregar'), 'sin Importar/Exportar sale solo el bloque de importar');
    await q("UPDATE permisos_rol SET agregar = 0 WHERE rol = 'lider' AND modulo = 'votantes'");
    ok(!(await tiene('t-votante-agregar')) && await tiene('t-votante-editar'), 'sin Agregar sale solo el bloque de agregar');
    await q("UPDATE permisos_rol SET editar = 0 WHERE rol = 'lider' AND modulo = 'votantes'");
    ok(!(await tiene('t-votante-editar')) && await tiene('mod-votantes'), 'sin Editar sale solo el bloque de editar');
    await q("UPDATE permisos_rol SET permitido = 0, editar = 1, agregar = 1, importar_exportar = 1 WHERE rol = 'lider' AND modulo = 'votantes'");
    ok(!(await tiene('mod-votantes')) && !(await tiene('t-votante-agregar')) && !(await tiene('t-votantes-importar')), 'sin «Ver» no sale NADA de Votantes, aunque las demás casillas estén encendidas');
    const sinVer = (await idsDe('lider')).filter((id) => /votante/.test(id) && id !== 't-cedula-privacidad');
    ok(!sinVer.some((id) => id.startsWith('mod-votantes')), 'y el bloque del módulo tampoco', sinVer);
    // La vista del administrador sobre el rol dice lo mismo.
    const vistaAdmin = await pedir('/api/manuales/rol/lider', usuarios.admin);
    ok(vistaAdmin.status === 200 && !idsDeRespuesta(vistaAdmin.datos).includes('mod-votantes'), '/rol/lider (administrador) también lo refleja');
  } finally {
    await q('UPDATE permisos_rol SET permitido = ?, editar = ?, agregar = ?, importar_exportar = ? WHERE rol = ? AND modulo = ?',
      [filaVotantes.permitido, filaVotantes.editar, filaVotantes.agregar, filaVotantes.importar_exportar, 'lider', 'votantes']);
  }
  ok(await tiene('mod-votantes'), 'al devolver el permiso, el bloque vuelve');

  // ============================================================== 6. SOLO EL ADMINISTRADOR
  console.log('\n[6] /rol/:rol e /instalacion: solo administrador');
  for (const rol of ['coordinador', 'lider', 'sublider', 'testigo', 'asistente_administrativo', 'invitado']) {
    const a = await pedir('/api/manuales/rol/admin', usuarios[rol]);
    const b = await pedir('/api/manuales/instalacion', usuarios[rol]);
    ok(a.status === 403 && b.status === 403, `${rol}: /rol/admin e /instalacion dan 403`, [a.status, b.status]);
  }
  const asp = await pedir('/api/manuales/instalacion', usuarios.aspirante, true);
  ok(asp.status === 403, 'el aspirante con sublicencia tampoco: 403');
  ok((await pedir('/api/manuales/mio')).status === 401, 'sin sesión: 401');
  const inst = await pedir('/api/manuales/instalacion', usuarios.admin);
  ok(inst.status === 200 && inst.datos.secciones[0].bloques.length === estado.instalacion.length, 'el administrador abre el manual de instalación');
  ok(!/DB_PASSWORD=\S/.test(inst.texto.replace(/DB_PASSWORD=(<|\.\.\.|$)/g, '')), 'el manual de instalación no trae valores de claves');
  const todosRoles = ['admin', 'coordinador', 'lider', 'sublider', 'testigo', 'usuario', 'asistente_administrativo', 'administrativo', 'invitado', 'aspirante'];
  for (const rol of todosRoles) {
    const res = await pedir('/api/manuales/rol/' + rol, usuarios.admin);
    ok(res.status === 200 && res.datos.modo === 'rol', `administrador: /rol/${rol} responde 200`);
  }
  ok((await pedir('/api/manuales/rol/rey', usuarios.admin)).status === 404, '/rol/rey: 404');
  // El manual del rol, visto por el administrador, es el que vería esa persona.
  for (const rol of ['coordinador', 'lider', 'testigo']) {
    const a = idsDeRespuesta((await pedir('/api/manuales/rol/' + rol, usuarios.admin)).datos);
    const b = await idsDe(rol);
    ok(JSON.stringify(a) === JSON.stringify(b), `/rol/${rol} es el mismo manual que /mio de un ${rol}`);
  }

  // ============================================================== 7. LA FECHA ES DE LOS ARCHIVOS
  console.log('\n[7] Fecha del contenido');
  let masNuevo = 0;
  archivosTexto.filter((f) => /manuales[\\/](bloques|instalacion)[\\/]/.test(f) || /LEEME/.test(f)).forEach((f) => { masNuevo = Math.max(masNuevo, fs.statSync(f).mtimeMs); });
  const esperadaFecha = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(masNuevo));
  ok(estado.fecha === esperadaFecha, `la fecha es la del último cambio de manuales/ (${esperadaFecha})`, estado.fecha);

  // ------------------------------------------------------------------------------------------------ limpieza
  await q('DELETE FROM usuarios WHERE nombre_usuario LIKE ?', ['u8500000%']);
  servidor.close();
  await pool.end();
  console.log(fallos ? `\n${fallos} comprobación(es) fallaron.` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
