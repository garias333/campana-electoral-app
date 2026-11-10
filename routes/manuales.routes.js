/**
 * Los manuales de ayuda. Montado en /api/manuales. El contenido y su validación viven en lib/manuales.js; esto solo decide
 * QUÉ PERMISOS se le aplican a quien pregunta.
 *
 *   GET /mio                el manual de quien pregunta, con SUS permisos reales (los mismos de `/permisos/mios`:
 *                           superadministrador, aspirante con sublicencia y fila de su rol). Para el administrador trae
 *                           además las tarjetas de todos los manuales.
 *   GET /rol/:rol           el manual de un rol, con la fila de ese rol en Asignación de permisos. Solo administrador.
 *   GET /instalacion        el manual de instalación. Solo administrador: ya no viaja dentro de un HTML público.
 *
 * Todas devuelven `permisos` por módulo (ver, editar, agregar, importar/exportar) para las insignias de la pantalla, y
 * `fecha_contenido`: la del último cambio de la carpeta manuales/, no la del navegador.
 */
'use strict';

const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { moduloTieneImportarExportar } = require('../config/importarExportar');
const { PERMISOS_ASPIRANTE, MODULOS_ASPIRANTE } = require('../middleware/aspirante');
const permisosRoutes = require('./permisos.routes');
const manuales = require('../lib/manuales');
const complementosLib = require('../lib/complementos');

const router = express.Router();
router.use(requireAuth);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Valida y avisa en el log al arrancar. Nunca tumba la aplicación.
try { manuales.cargar(); } catch (err) { console.error('Manuales: no se pudo cargar:', err.message); }

const MODULOS = permisosRoutes.MODULOS;

/** El administrador lo tiene TODO, sin consultar la matriz (middleware/permisoModulo.js): el manual lo dice igual. */
function permisosDelAdministrador() {
  const p = {};
  MODULOS.forEach((m) => { p[m.clave] = { ver: true, editar: true, agregar: true, importar_exportar: moduloTieneImportarExportar(m.clave) }; });
  return p;
}

function permisosDelAspirante() {
  const p = {};
  MODULOS_ASPIRANTE.forEach((m) => { p[m] = { ...PERMISOS_ASPIRANTE[m] }; });
  return p;
}

const SQL_FILAS = 'SELECT rol, modulo, permitido, editar, agregar, importar_exportar FROM permisos_rol';

/** Las filas de `permisos_rol`; si la base aún no tiene la columna `importar_exportar`, sin ella (queda cerrada). */
async function filasDePermisos(donde, valores) {
  try {
    const [filas] = await pool.query(`${SQL_FILAS} ${donde}`, valores);
    return filas;
  } catch (err) {
    if (err.code !== 'ER_BAD_FIELD_ERROR') throw err;
    const [filas] = await pool.query(`SELECT rol, modulo, permitido, editar, agregar FROM permisos_rol ${donde}`, valores);
    return filas;
  }
}

function permisosDesdeFilas(filas) {
  const p = {};
  filas.forEach((f) => {
    p[f.modulo] = { ver: !!f.permitido, editar: !!f.editar, agregar: !!f.agregar, importar_exportar: !!f.importar_exportar };
  });
  return p;
}

async function permisosDeRol(rol) {
  if (rol === 'admin') return permisosDelAdministrador();
  if (rol === 'aspirante') return permisosDelAspirante();
  return permisosDesdeFilas(await filasDePermisos('WHERE rol = ?', [rol]));
}

/** Lo que va al navegador para las insignias: los permisos de TODOS los módulos de la matriz (ausente = sin nada). */
function permisosParaInsignias(permisos) {
  const salida = {};
  MODULOS.forEach((m) => {
    const p = permisos[m.clave] || {};
    salida[m.clave] = {
      etiqueta: m.etiqueta,
      ver: !!p.ver, editar: !!p.ver && !!p.editar, agregar: !!p.ver && !!p.agregar,
      importar_exportar: !!p.ver && !!p.importar_exportar,
      tiene_importar_exportar: moduloTieneImportarExportar(m.clave),
    };
  });
  return salida;
}

/**
 * ACTIVAR COMPLEMENTOS (parche 318): al perfil se le agrega qué complementos están encendidos (los bloques de un complemento apagado no salen, para
 * NADIE) y se le quitan los permisos de sus módulos (las insignias de la pantalla no prometen lo que no hay).
 */
async function conComplementos(perfil) {
  const complementos = await complementosLib.complementosActivos();
  const permisos = {};
  Object.entries(perfil.permisos || {}).forEach(([m, p]) => {
    const dueno = complementosLib.complementoDelModulo(m);
    permisos[m] = dueno && !complementos[dueno] ? { ...p, ver: false, editar: false, agregar: false, importar_exportar: false } : p;
  });
  return { ...perfil, permisos, complementos };
}

function respuesta(rol, modo, perfil, extras) {
  const titulos = manuales.MANUALES_POR_ROL[rol];
  const manual = manuales.armarManual(perfil, titulos);
  return {
    modo, rol, ...manual,
    permisos: permisosParaInsignias(perfil.permisos),
    ...(extras || {}),
  };
}

/** Las tarjetas de la portada del administrador: un manual por rol, con cuántos bloques trae hoy. */
async function tarjetasParaAdministrador() {
  const filas = await filasDePermisos('', []);
  const porRol = {};
  filas.forEach((f) => { (porRol[f.rol] = porRol[f.rol] || []).push(f); });
  const est = manuales.cargar({ silencioso: true });
  const activosC = await complementosLib.complementosActivos();          // Activar complementos (parche 318)
  const tarjetas = Object.keys(manuales.MANUALES_POR_ROL).map((clave) => {
    const permisos = clave === 'admin' ? permisosDelAdministrador()
      : clave === 'aspirante' ? permisosDelAspirante() : permisosDesdeFilas(porRol[clave] || []);
    const roles = new Set(clave === 'aspirante' ? ['aspirante', 'lider'] : [clave]);
    const visibles = manuales.bloquesVisibles(est.bloques, { permisos, roles, complementos: activosC });
    const n = visibles.filter((b) => b.seccion !== 'faq' && b.seccion !== 'glosario').length;
    return { clave, ...manuales.MANUALES_POR_ROL[clave], bloques: n };
  });
  tarjetas.push({ clave: 'instalacion', ...manuales.INSTALACION, bloques: est.instalacion.length });
  return tarjetas;
}

router.get('/mio', async (req, res) => {
  try {
    const sesion = req.session.usuario;
    const esAspirante = !!req.sublicencia;
    const { permisos: deSesion } = await permisosRoutes.permisosDeSesion(req);
    const permisos = (sesion.rol === 'admin' && !esAspirante) ? permisosDelAdministrador() : deSesion;
    const roles = new Set([sesion.rol]);
    if (esAspirante) roles.add('aspirante');
    const clave = esAspirante ? 'aspirante' : (manuales.MANUALES_POR_ROL[sesion.rol] ? sesion.rol : 'usuario');
    const extras = {};
    if (sesion.rol === 'admin' && !esAspirante) extras.tarjetas = await tarjetasParaAdministrador();
    res.json(respuesta(clave, 'mio', await conComplementos({ permisos, roles }), extras));
  } catch (err) {
    console.error('manuales/mio:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo armar el manual.' });
  }
});

router.get('/rol/:rol', requireRole('admin'), async (req, res) => {
  const rol = String(req.params.rol || '');
  if (!manuales.MANUALES_POR_ROL[rol]) return res.status(404).json({ error: 'Ese manual no existe.' });
  try {
    const permisos = await permisosDeRol(rol);
    const roles = new Set(rol === 'aspirante' ? ['aspirante', 'lider'] : [rol]);
    res.json(respuesta(rol, 'rol', await conComplementos({ permisos, roles })));
  } catch (err) {
    console.error('manuales/rol:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo armar el manual.' });
  }
});

router.get('/instalacion', requireRole('admin'), async (req, res) => {
  try {
    res.json({ modo: 'instalacion', rol: 'instalacion', ...manuales.manualDeInstalacion(), permisos: permisosParaInsignias({}) });
  } catch (err) {
    console.error('manuales/instalacion:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo cargar el manual de instalación.' });
  }
});

module.exports = router;
