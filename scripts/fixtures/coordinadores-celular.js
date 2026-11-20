'use strict';
/**
 * DATOS Y SERVIDOR DE PRUEBA PARA «COORDINADORES EN EL CELULAR» (orden 59). Lo usan scripts/probar-coordinadores-celular.js (HTTP) y
 * scripts/probar-coordinadores-celular-cdp.js (navegador).
 *
 * Todo es inventado: nombres «Ejemplo/Muestra», cédulas 1023456789 (la de la orden) y 1055000xxx, teléfonos 300… y 315…, correos @ejemplo.co. Corre SOLO sobre una
 * base `simulada…` o `prueba…` (el llamador lo comprueba). La sesión es la REAL (express-session en memoria + las rutas reales de app.js), no un atajo:
 * lo que se prueba es el ingreso de verdad.
 *
 * LA RAMA DE PRUEBA
 *   Coordinadora Marta (cédula 1023456789):
 *     Ana    líder    meta 50  · 5 registros, el último hoy                      → rojo (10 %)         con sublíder Sara (2 registros propios, meta 5)
 *     Beto   líder    meta 10  · 5 registros, el último hace 9 días              → amarillo (50 %)     «sin registrar hace 7+ días»
 *     Carla  líder    sin meta · 0 registros, SIN celular                        → sin meta, nunca registró
 *     Diego  líder    meta 10  · 9 registros, el último hace 1 día, no_contactar → verde (90 %)
 *   Coordinador Pedro (cédula 1034567891):
 *     Eva    líder    meta 20  · 3 registros                                     → de OTRA rama
 */
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const CLAVE_CORREO = 'clave-correo-ej';
const CLAVE_ADMIN = 'clave-admin-ej';

async function sembrar(pool, { conPregunta = false } = {}) {
  const q = async (sql, p) => (await pool.query(sql, p))[0];
  const hash = (t) => bcrypt.hashSync(t, 4);
  const ids = {};
  const rol = async (nombre) => (await q('SELECT id FROM roles WHERE nombre = ?', [nombre]))[0].id;

  await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
  await q(`UPDATE configuracion_campana SET nombre_candidato = 'Campaña de ejemplo', cargo_aspira = NULL, fecha_eleccion = DATE_ADD(CURDATE(), INTERVAL 10 DAY),
    departamento = 'Departamento de ejemplo', ciudad = 'Ciudad de ejemplo', marca_titulo = 'Campaña de ejemplo' WHERE id = 1`);

  const persona = async (clave, nombre, nombreRol, cedula, extra = {}) => {
    const [r] = await pool.query(
      `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, no_contactar)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nombre, cedula, cedula, extra.email === undefined ? null : extra.email, extra.telefono === undefined ? null : extra.telefono,
        hash(extra.password || cedula || 'sin-clave'), await rol(nombreRol), extra.activo === 0 ? 0 : 1, extra.noContactar ? 1 : 0]);
    ids[clave] = r.insertId;
    return r.insertId;
  };
  const estructura = (usuarioId, cargo, supervisor, meta, territorio) =>
    q('INSERT INTO estructura (usuario_id, cargo, supervisor_id, activo, meta_votos, meta_votos_base, territorio_id) VALUES (?,?,?,1,?,?,?)',
      [usuarioId, cargo, supervisor || null, meta || 0, meta || 0, territorio || null]);

  const [dep] = await pool.query("INSERT INTO territorios (tipo, nombre) VALUES ('departamento', 'Departamento de ejemplo')");
  const [mun] = await pool.query("INSERT INTO territorios (tipo, nombre, padre_id) VALUES ('municipio', 'Ciudad de ejemplo', ?)", [dep.insertId]);
  const [b1] = await pool.query("INSERT INTO territorios (tipo, nombre, padre_id) VALUES ('barrio', 'Barrio Los Ejemplos', ?)", [mun.insertId]);
  const [b2] = await pool.query("INSERT INTO territorios (tipo, nombre, padre_id) VALUES ('barrio', 'Barrio La Muestra', ?)", [mun.insertId]);

  await persona('admin', 'Admin Ejemplo', 'admin', '1000000001', { email: 'admin.ej@ejemplo.co', password: CLAVE_ADMIN });
  await persona('coord1', 'Marta Coordinadora Ejemplo', 'coordinador', '1023456789', { email: 'marta@ejemplo.co', password: CLAVE_CORREO, telefono: '3000000001' });
  await persona('coord2', 'Pedro Coordinador Muestra', 'coordinador', '1034567891', { email: 'pedro@ejemplo.co', password: CLAVE_CORREO });
  await persona('ana', 'Ana Líder Alfa', 'lider', '1055000001', { telefono: '3001112233', email: 'ana@ejemplo.co' });
  await persona('beto', 'Beto Líder Beta', 'lider', '1055000002', { telefono: '3004445566' });
  await persona('carla', 'Carla Líder Gamma', 'lider', '1055000003', {});
  await persona('diego', 'Diego Líder Delta', 'lider', '1055000004', { telefono: '3157778899', noContactar: true });
  await persona('eva', 'Eva Líder Épsilon', 'lider', '1055000005', { telefono: '3009990011' });
  await persona('sara', 'Sara Sublíder Alfa', 'sublider', '1055000006', { telefono: '3012223344' });
  await persona('tito', 'Tito Sublíder Beta', 'sublider', '1055000007', { telefono: '3025556677' });

  await estructura(ids.coord1, 'coordinador', null, 0);
  await estructura(ids.coord2, 'coordinador', null, 0);
  await estructura(ids.ana, 'lider', ids.coord1, 50, b1.insertId);
  await estructura(ids.beto, 'lider', ids.coord1, 10, b2.insertId);
  await estructura(ids.carla, 'lider', ids.coord1, 0, null);
  await estructura(ids.diego, 'lider', ids.coord1, 10, b1.insertId);
  await estructura(ids.eva, 'lider', ids.coord2, 20, b2.insertId);
  await estructura(ids.sara, 'usuario', ids.ana, 5, b1.insertId);
  await estructura(ids.tito, 'usuario', ids.beto, 0, null);

  let c = 0;
  const ficha = async (liderId, subId, dias, nombre) => {
    c++;
    const [r] = await pool.query(
      `INSERT INTO votantes (nombre, cedula, telefono, lider_id, sublider_id, origen, created_at)
       VALUES (?, ?, ?, ?, ?, 'manual', DATE_SUB(NOW(), INTERVAL ? DAY))`,
      [nombre || `Votante Ejemplo ${c}`, `7400${String(c).padStart(6, '0')}`, `3100${String(c).padStart(6, '0')}`, liderId, subId || null, dias]);
    return r.insertId;
  };
  const votantes = { ana: [], beto: [], diego: [], eva: [], sara: [] };
  for (const d of [0, 1, 3, 9, 15]) votantes.ana.push(await ficha(ids.ana, null, d));                 // Ana: 5, el último hoy
  for (const d of [2, 3]) votantes.sara.push(await ficha(ids.ana, ids.sara, d));                        // Sara: 2 que registró ella (con lider_id = Ana)
  for (const d of [9, 12, 16, 20, 27]) votantes.beto.push(await ficha(ids.beto, null, d));            // Beto: 5, el último hace 9 días
  for (const d of [1, 2, 3, 4, 5, 8, 10, 14, 22]) votantes.diego.push(await ficha(ids.diego, null, d)); // Diego: 9
  for (const d of [0, 5, 6]) votantes.eva.push(await ficha(ids.eva, null, d));                          // Eva: 3 (otra rama)
  // Orden 66: quien entra por un botón por primera vez ve la pregunta «¿quiere cambiar su clave?» (tapa la pantalla). Las pruebas que no son de eso la dan por contestada;
  // las que sí lo son piden `conPregunta: true`.
  if (!conPregunta) await q('UPDATE usuarios SET clave_celular_pregunta_hecha = 1');
  return { ids, votantes };
}

/** El servidor con las rutas REALES y una sesión de verdad en memoria. `publico` es la carpeta que se sirve (para comparar con la versión anterior). */
function crearApp(pool, publico, { alertas = false } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(session({ secret: 'secreto-de-prueba', resave: false, saveUninitialized: true, cookie: { httpOnly: true } }));
  app.get('/api/csrf-token', (req, res) => res.json({ csrfToken: 'ejemplo' }));
  // Orden 69: como app.js, dice si se muestra el botón de testigos (el interruptor real, leído de la base; apagado de fábrica).
  app.get('/api/marca-publica', async (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ titulo: 'Campaña de ejemplo', subtitulo: '', logo_url: '', boton_testigos: await require(path.join(RAIZ, 'lib/complementos')).complementoActivo('boton_testigos_celular') }); });
  const { cargarSublicencia, restringirAspirante } = require(path.join(RAIZ, 'middleware/aspirante'));
  app.use('/api', cargarSublicencia, restringirAspirante);
  const montar = (ruta, archivo) => app.use(ruta, require(path.join(RAIZ, 'routes', archivo)));
  montar('/api/auth', 'auth.routes');
  montar('/api/usuarios', 'usuarios.routes');
  montar('/api/territorial', 'territorial.routes');
  montar('/api/dashboard', 'dashboard.routes');
  montar('/api/coordinador', 'coordinador.routes');
  montar('/api/permisos', 'permisos.routes');
  montar('/api/complementos', 'complementos.routes');   // orden 69: el interruptor del botón de testigos
  montar('/api/configuracion', 'configuracion.routes');
  montar('/api/contenido', 'contenido.routes');
  montar('/api/push', 'push.routes');
  montar('/api/panel-lider', 'panelLider.routes');
  if (alertas) montar('/api/dia-d/alertas', 'alertasDiaD.routes');   // orden 68: para que el aviso «Activar los avisos» pueda aparecer
  montar('/api/dia-d', 'diaD.routes');       // la pantalla del testigo (app/dia-d.html)
  montar('/api/catalogo', 'catalogo.routes');
  montar('/api/votantes', 'votantes.routes');
  app.use('/api', (req, res) => res.status(404).json({ error: 'sin ruta en el servidor de pruebas' }));
  app.use(express.static(publico || path.join(RAIZ, 'public'), { etag: false, lastModified: false, setHeaders: (r) => r.setHeader('Cache-Control', 'no-store') }));
  return app;
}

module.exports = { sembrar, crearApp, CLAVE_CORREO, CLAVE_ADMIN };
