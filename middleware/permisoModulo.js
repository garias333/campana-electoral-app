/**
 * El permiso «Importar / Exportar», aplicado en el SERVIDOR.
 *
 * POR QUÉ EXISTE. La matriz de «Asignación de permisos» gobierna lo que se
 * DIBUJA y, hasta este archivo, nada más: ninguna ruta la consultaba, y
 * `requireRole` decide solo con la lista de roles escrita en cada ruta.
 * Esconder un botón no impide teclear la dirección, y cinco exportaciones —
 * territorios, asistentes de eventos y las dos de organigrama, además de la
 * descarga de recursos— ni siquiera pedían rol: las alcanzaba cualquier cuenta
 * con sesión, incluido un testigo o un invitado, con cédulas y teléfonos dentro.
 *
 * SE SUMA A `requireRole`, NO LO REEMPLAZA. Va después, así que el permiso solo
 * puede QUITAR acceso, nunca darlo: una casilla encendida para un rol que la
 * ruta no admite sigue cerrada. Y va ANTES de `uploadExcel`, para que quien no
 * puede importar no le entregue siquiera el archivo a `xlsx`.
 *
 * QUIÉN PASA, EN ESTE ORDEN
 *   1. El administrador y el superadministrador, siempre. Si pudieran quedar
 *      fuera por una casilla mal puesta, una campaña podría perder la única
 *      cuenta que arregla esa casilla.
 *   2. El aspirante con sublicencia, según SU lista (`PERMISOS_ASPIRANTE` en
 *      middleware/aspirante.js) y no según la matriz de su rol: su rol es
 *      «lider» porque así figura en la campaña madre, y la matriz de «lider»
 *      no dice nada de lo que él compró.
 *   3. Cualquier otro rol, por su fila en `permisos_rol`.
 *
 * SE FALLA CERRADO. Fila ausente, columna ausente (una base que no corrió
 * `init-db`) o un error al leer: todo niega. Es lo contrario de los helpers
 * `puedeVer/puedeEditar/puedeAgregar` del navegador, que ante la duda dejan
 * pasar para no esconderle un botón a nadie por un fallo ajeno — pero aquí lo
 * que se protege son listados de personas, y el coste de equivocarse no es
 * simétrico.
 *
 * SIN CACHÉ. Importar y exportar son operaciones raras, y una caché haría que
 * un administrador que apaga la casilla viera que el cambio «no funciona» hasta
 * que venciera.
 *
 * QUÉ BLOQUEA Y QUÉ NO. Bloquea el ARCHIVO (Excel, Word), no los datos que la
 * pantalla ya muestra: las rutas JSON que alimentan las tablas en pantalla
 * (`GET /api/votantes`, `GET /api/eventos/asistentes-consolidado`,
 * `GET /api/organigrama`…) siguen gobernadas por «Ver» y por el alcance, como
 * antes. Quien puede ver una lista puede, con paciencia, copiarla; este permiso
 * no pretende impedirlo, sino que sacar el archivo completo sea una decisión
 * explícita del administrador. Cerrar también esas listas sería otro trabajo.
 */
'use strict';

const pool = require('../config/db');
const { esSuperadmin } = require('../config/superadmin');
const { moduloTieneImportarExportar } = require('../config/importarExportar');
const { PERMISOS_ASPIRANTE } = require('./aspirante');

const MENSAJE_NEGADO =
  'Su tipo de usuario no tiene permiso para importar ni exportar datos en este módulo. '
  + 'Si lo necesita, pídaselo al administrador de la campaña.';

const MENSAJE_SIN_VERIFICAR =
  'No se pudo comprobar su permiso para importar o exportar, y por seguridad se negó. '
  + 'Vuelva a intentarlo; si el problema sigue, avise al administrador.';

/**
 * @param {string} modulo  Una clave del catálogo de módulos que tenga rutas de
 *                         importar o exportar (config/importarExportar.js).
 */
function requiereImportarExportar(modulo) {
  /* UN NOMBRE MAL ESCRITO NO PUEDE LLEGAR A PRODUCCIÓN CALLADO. Con una errata,
     la ruta quedaría cerrada para todos menos el administrador y nadie sabría
     por qué. Se rompe al CARGAR el archivo de rutas, que es cuando se ve. */
  if (!moduloTieneImportarExportar(modulo)) {
    throw new Error(
      `requiereImportarExportar: «${modulo}» no es un módulo con importar/exportar `
      + '(ver config/importarExportar.js).'
    );
  }

  return async function permisoImportarExportar(req, res, next) {
    const usuario = req.session && req.session.usuario;
    if (!usuario) {
      return res.status(401).json({ error: 'Debe iniciar sesión para continuar.' });
    }

    try {
      if (usuario.rol === 'admin' || await esSuperadmin(usuario)) return next();

      if (req.sublicencia) {
        const suyo = PERMISOS_ASPIRANTE[modulo];
        if (suyo && suyo.importar_exportar === true) return next();
        return res.status(403).json({ error: MENSAJE_NEGADO });
      }

      const [filas] = await pool.query(
        'SELECT importar_exportar FROM permisos_rol WHERE rol = ? AND modulo = ? LIMIT 1',
        [usuario.rol, modulo]
      );
      if (filas.length && Number(filas[0].importar_exportar) === 1) return next();
      return res.status(403).json({ error: MENSAJE_NEGADO });
    } catch (err) {
      // Solo el código y el mensaje: `err.sql` lleva la consulta entera.
      console.error('[importar/exportar] No se pudo comprobar el permiso:', err.code || err.message);
      return res.status(403).json({ error: MENSAJE_SIN_VERIFICAR });
    }
  };
}

/**
 * El permiso «Ver» de un módulo, aplicado en el SERVIDOR.
 *
 * Hermano de `requiereImportarExportar`: aquel protege los ARCHIVOS que salen
 * de un módulo con datos; éste protege un módulo entero cuya única función es
 * mostrar algo (hoy, Legislación). Sin él, esconder la entrada del menú sería
 * toda la protección, y teclear la dirección la saltaría.
 *
 * QUIÉN PASA: el administrador y el superadministrador, siempre (mismo
 * criterio que arriba: no se les puede dejar fuera por una casilla); los demás
 * roles, solo si su fila en `permisos_rol` tiene `permitido = 1`.
 *
 * EL ASPIRANTE CON SUBLICENCIA NO PASA, aunque su rol sea «lider» y la matriz
 * de «lider» diga que sí: lo que compró son cuatro pantallas, y esta no es una.
 * (`restringirAspirante` ya lo corta antes en `/api`; esto es el segundo cerrojo.)
 *
 * SE FALLA CERRADO: fila ausente o error al leer, se niega.
 */
function requiereVerModulo(modulo) {
  return async function permisoVerModulo(req, res, next) {
    const usuario = req.session && req.session.usuario;
    if (!usuario) {
      return res.status(401).json({ error: 'Debe iniciar sesión para continuar.' });
    }
    const negado = (mensaje) => res.status(403).json({ error: mensaje });
    try {
      if (req.sublicencia) {
        return negado('Esta sección no está disponible para su tipo de acceso.');
      }
      if (usuario.rol === 'admin' || await esSuperadmin(usuario)) return next();

      const [filas] = await pool.query(
        'SELECT permitido FROM permisos_rol WHERE rol = ? AND modulo = ? LIMIT 1',
        [usuario.rol, modulo]
      );
      if (filas.length && Number(filas[0].permitido) === 1) return next();
      return negado('Su tipo de usuario no tiene acceso a esta sección. '
        + 'Si lo necesita, pídaselo al administrador de la campaña.');
    } catch (err) {
      console.error(`[ver ${modulo}] No se pudo comprobar el permiso:`, err.code || err.message);
      return negado('No se pudo comprobar su permiso, y por seguridad se negó. Vuelva a intentarlo.');
    }
  };
}

module.exports = { requiereImportarExportar, requiereVerModulo, MENSAJE_NEGADO, MENSAJE_SIN_VERIFICAR };
