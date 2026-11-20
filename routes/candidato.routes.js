/**
 * /api/candidato — lo que ve el CANDIDATO PRINCIPAL en su app del celular (orden 70). SOLO GET, solo rol candidato (y admin, para probar).
 *
 * No devuelve finanzas ni cédulas: son cifras de toda la campaña y, del equipo, nombre, zona, avance y el celular (para llamar o abrir WhatsApp).
 * La lógica vive en lib/candidatoResumen.js, que reutiliza la de «Mi equipo», el alcance del panel del administrador y los paneles de Solicitudes y Tareas.
 *
 *   GET /resumen        Inicio: encabezado, meta con ritmo, cifras, alerta, barras de 7 días, próximos 3 eventos.
 *   GET /equipo         Equipo: coordinadores y líderes con su ranking, y las zonas para el filtro.
 *   GET /equipo/:id     Ficha de un coordinador con sus líderes.
 *   GET /mapa           Mapa: zonas con sus cifras y los eventos con ubicación. GET /mapbox-token: el token público del fondo.
 *   GET /agenda         Agenda: eventos entre ?desde= y ?hasta= (YYYY-MM-DD, hasta 62 días).
 *   GET /mas            Qué secciones de «Más» están encendidas.
 *   GET /solicitudes    Resumen de Solicitudes (solo si el complemento está activo y el módulo permitido).
 *   GET /tareas         Resumen de Tareas (ídem).
 *   GET /puerta-a-puerta  Conteos del panel de Puerta a puerta (si sus dos complementos están encendidos).
 *   GET /dia-d          Avance de votación de la Jornada electoral (si el módulo «Faltan por votar» está permitido para el candidato).
 *
 * La escritura no existe aquí: aunque existiera, middleware/soloLecturaCandidato.js responde 403 a todo lo que no sea GET.
 */
'use strict';

const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { filtroOcultar } = require('../config/superadmin');
const Lib = require('../lib/candidatoResumen');
const { complementoActivo } = require('../lib/complementos');

const router = express.Router();
router.use(requireAuth, requireRole('candidato', 'admin'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const FALLO = 'No se pudo cargar la información. Intente de nuevo.';
function fallar(res, etiqueta, err) {
  console.error(`candidato/${etiqueta}:`, err.code || err.message);   // solo el código y el mensaje: `err.sql` lleva la consulta entera
  res.status(500).json({ error: FALLO });
}

/** ¿El administrador le dejó ver este módulo al candidato (matriz de «Asignación de permisos»)? El administrador, siempre. Falla cerrado. */
async function moduloPermitido(req, modulo) {
  if (req.session.usuario.rol === 'admin') return true;
  try {
    const [f] = await pool.query(`SELECT permitido FROM permisos_rol WHERE rol = 'candidato' AND modulo = ? LIMIT 1`, [modulo]);
    return f.length > 0 && Number(f[0].permitido) === 1;
  } catch (_) { return false; }
}

/** «Registrar en la estructura territorial»: el administrador lo deja si «Estructura territorial» tiene Ver y Agregar para el candidato (matriz de permisos). El administrador, siempre. */
async function puedeRegistrar(req) {
  if (req.session.usuario.rol === 'admin') return true;
  try {
    const [f] = await pool.query(`SELECT permitido, agregar FROM permisos_rol WHERE rol = 'candidato' AND modulo = 'territorial' LIMIT 1`);
    return f.length > 0 && Number(f[0].permitido) === 1 && Number(f[0].agregar) === 1;
  } catch (_) { return false; }
}

async function seccionesEncendidas(req) {
  return {
    registro: await puedeRegistrar(req),
    solicitudes: await complementoActivo('solicitudes') && await moduloPermitido(req, 'solicitudes'),
    tareas: await complementoActivo('tareas') && await moduloPermitido(req, 'tareas'),
    dia_d: await moduloPermitido(req, 'rescate_votos'),
    // Puerta a puerta: el panel de solo conteos existe solo con sus DOS complementos encendidos (puerta_a_puerta y puerta_panel).
    puerta: await complementoActivo('puerta_a_puerta') && await complementoActivo('puerta_panel') && await moduloPermitido(req, 'puerta_listas'),
    legislacion: await moduloPermitido(req, 'legislacion'),
    // «Material de apoyo» y «Mi cuenta» de la cuadrícula de «Más» (orden 75): cada una según su casilla de la matriz (y esas pantallas leen /contenido y /recursos, que el candidato sí puede leer).
    biografia: await moduloPermitido(req, 'biografia_candidato'),
    recursos: await moduloPermitido(req, 'recursos'),
    politica: await moduloPermitido(req, 'politica_privacidad'),
  };
}

router.get('/resumen', async (req, res) => {
  try {
    const ocultar = await filtroOcultar(req.session.usuario, 'u');
    res.json(await Lib.resumen(ocultar));
  } catch (err) { fallar(res, 'resumen', err); }
});

router.get('/equipo', async (req, res) => {
  try {
    const ocultar = await filtroOcultar(req.session.usuario, 'u');
    const e = await Lib.equipoCampana(ocultar);
    res.json({ generado_en: new Date().toISOString(), dias_sin_actividad: Lib.DIAS_SIN_ACTIVIDAD, ...e });
  } catch (err) { fallar(res, 'equipo', err); }
});

router.get('/equipo/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    // El mismo 404 para «no existe» y «no es coordinador»: no sirve para sondear ids de usuario.
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Esa persona no está en el equipo.' });
    const ocultar = await filtroOcultar(req.session.usuario, 'u');
    const f = await Lib.fichaCoordinador(id, ocultar);
    if (!f) return res.status(404).json({ error: 'Esa persona no está en el equipo.' });
    res.json(f);
  } catch (err) { fallar(res, 'equipo/:id', err); }
});

/* El token PÚBLICO de Mapbox para dibujar el fondo (el mismo que sirve /api/territorial/mapbox-token al administrador). Sin token, null: el mapa usa OpenStreetMap. */
router.get('/mapbox-token', (req, res) => { res.json({ token: process.env.MAPBOX_ACCESS_TOKEN || null }); });

router.get('/mapa', async (req, res) => {
  try {
    const ocultar = await filtroOcultar(req.session.usuario, 'u');
    res.json(await Lib.mapaZonas(ocultar));
  } catch (err) { fallar(res, 'mapa', err); }
});

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
router.get('/agenda', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!FECHA.test(String(desde || '')) || !FECHA.test(String(hasta || ''))) {
      return res.status(400).json({ error: 'Indique desde y hasta con el formato AAAA-MM-DD.' });
    }
    const dias = (Date.parse(hasta) - Date.parse(desde)) / 86400000;
    if (!(dias >= 0) || dias > 62) return res.status(400).json({ error: 'El rango de fechas no es válido (máximo 62 días).' });
    res.json({ desde, hasta, eventos: await Lib.eventosEntre(desde, hasta, 200) });
  } catch (err) { fallar(res, 'agenda', err); }
});

router.get('/mas', async (req, res) => {
  try { res.json({ secciones: await seccionesEncendidas(req) }); } catch (err) { fallar(res, 'mas', err); }
});

function cerrada(res) { return res.status(403).json({ error: 'Esta sección no está activa en la campaña.', codigo: 'seccion_apagada' }); }

router.get('/solicitudes', async (req, res) => {
  try {
    if (!(await seccionesEncendidas(req)).solicitudes) return cerrada(res);
    res.json(await Lib.solicitudes());
  } catch (err) { fallar(res, 'solicitudes', err); }
});

router.get('/tareas', async (req, res) => {
  try {
    if (!(await seccionesEncendidas(req)).tareas) return cerrada(res);
    res.json(await Lib.tareas());
  } catch (err) { fallar(res, 'tareas', err); }
});

router.get('/puerta-a-puerta', async (req, res) => {
  try {
    if (!(await seccionesEncendidas(req)).puerta) return cerrada(res);
    res.json(await Lib.puertaAPuerta());
  } catch (err) { fallar(res, 'puerta-a-puerta', err); }
});

router.get('/dia-d', async (req, res) => {
  try {
    if (!(await seccionesEncendidas(req)).dia_d) return cerrada(res);
    res.json(await Lib.diaD());
  } catch (err) { fallar(res, 'dia-d', err); }
});

module.exports = router;
