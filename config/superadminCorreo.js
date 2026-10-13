/**
 * El correo con el que nace el superadministrador de una instalación nueva.
 *
 * VIVE EN UN ARCHIVO APARTE, SIN DEPENDENCIAS, y `config/superadmin.js` lo
 * vuelve a exportar. La razón es de `db/init-db.js`: necesita este valor, pero
 * `config/superadmin.js` abre el pool de conexiones de la aplicación al
 * cargarse (`require('./db')`), y un script de una sola pasada como init-db no
 * debe abrir un segundo pool solo para leer una constante.
 *
 * Sale de `SUPERADMIN_EMAIL` (.env) y, si está vacía o no existe, del valor de
 * abajo. Se lee al requerir el módulo: quien lo cargue debe haber corrido
 * `require('dotenv').config()` antes.
 */
'use strict';

const CORREO_SUPERADMIN_POR_OMISION = 'correo@gildardoarias.com';

const CORREO_SUPERADMIN =
  (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase() || CORREO_SUPERADMIN_POR_OMISION;

module.exports = { CORREO_SUPERADMIN, CORREO_SUPERADMIN_POR_OMISION };
