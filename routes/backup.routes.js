/**
 * Backup completo de la aplicación (base de datos + archivos subidos en
 * uploads/) — pensado para que, si el servidor se pierde por completo, se
 * pueda instalar la aplicación desde cero en un servidor nuevo y quedar
 * configurada con toda la información que tenía al momento del backup.
 *
 * Solo Administrador. Crear y restaurar un backup piden la contraseña de
 * administrador (igual que "Eliminar registros" en otras pantallas) porque
 * el archivo contiene TODO: contraseñas (hash), datos personales de
 * votantes, etc. Restaurar además exige escribir una frase de
 * confirmación, porque reemplaza la base de datos completa sin poder
 * deshacerse — antes de tocar nada, se guarda un respaldo de seguridad de
 * lo que había, por si algo sale mal.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const multer = require('multer');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { registrarAuditoria } = require('../config/auditoria');
const { verificarPasswordAdmin } = require('../config/verificaciones');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin'));

const RAIZ_APP = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(RAIZ_APP, 'uploads');
const BACKUPS_DIR = path.join(RAIZ_APP, 'backups');
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const uploadZip = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2 GB — la carpeta uploads/ puede crecer con el tiempo
});

/** Corre un comando y espera a que termine; junta stderr para poder mostrar un mensaje de error útil si falla. */
function ejecutar(cmd, args, opciones = {}) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(cmd, args, opciones);
    let stderr = '';
    proceso.stderr && proceso.stderr.on('data', (d) => { stderr += d.toString(); });
    proceso.on('error', reject);
    proceso.on('close', (codigo) => {
      if (codigo === 0) resolve();
      else reject(new Error(`${cmd} terminó con error (código ${codigo}): ${stderr.slice(0, 800)}`));
    });
  });
}

/** mysqldump escribe el volcado directo a un archivo — la contraseña se pasa por variable de entorno (MYSQL_PWD), nunca como argumento de línea de comandos (quedaría visible para cualquiera con acceso al servidor mientras corre). */
function volcarBaseDatos(rutaDestino) {
  return ejecutar('mysqldump', [
    `-h${process.env.DB_HOST || '127.0.0.1'}`,
    `-P${process.env.DB_PORT || '3306'}`,
    `-u${process.env.DB_USER}`,
    '--single-transaction', '--routines', '--triggers', '--events',
    `--result-file=${rutaDestino}`,
    process.env.DB_NAME
  ], { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD } });
}

/** El cliente mysql lee el .sql por la entrada estándar (no hay una bandera equivalente a --result-file para restaurar). */
function restaurarBaseDatos(rutaArchivoSql) {
  return new Promise((resolve, reject) => {
    const proceso = spawn('mysql', [
      `-h${process.env.DB_HOST || '127.0.0.1'}`,
      `-P${process.env.DB_PORT || '3306'}`,
      `-u${process.env.DB_USER}`,
      process.env.DB_NAME
    ], { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD } });
    let stderr = '';
    proceso.stderr.on('data', (d) => { stderr += d.toString(); });
    proceso.on('error', reject);
    proceso.on('close', (codigo) => {
      if (codigo === 0) resolve();
      else reject(new Error(`Error restaurando la base de datos (código ${codigo}): ${stderr.slice(0, 1000)}`));
    });
    fs.createReadStream(rutaArchivoSql).pipe(proceso.stdin);
  });
}

function marcaDeTiempo() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

const LEEME_BACKUP = `BACKUP DE ESTRATEGIA (INGESES S.A.S.)
======================================

Este archivo contiene una copia completa de la aplicación en el momento en
que se generó: la base de datos completa (database.sql) y todos los
archivos subidos por los usuarios (carpeta uploads/, fotos, documentos,
comprobantes E-14, etc.).

CÓMO RESTAURAR EN UN SERVIDOR NUEVO (instalación desde cero)
--------------------------------------------------------------
1. Instala la aplicación normalmente en el servidor nuevo (clona/copia el
   código, corre "npm install", configura el archivo .env con los datos
   de la base de datos NUEVA que vayas a usar allí).
2. Antes de correr "node db/init-db.js", crea la base de datos vacía y
   restaura este volcado en ella:

     mysql -u TU_USUARIO -p NOMBRE_DE_LA_BASE_DE_DATOS < database.sql

   (te pedirá la contraseña de ese usuario de MySQL/MariaDB)
3. Copia el contenido de la carpeta uploads/ de este backup a la carpeta
   uploads/ del proyecto nuevo (reemplázala por completo).
4. Inicia la aplicación (pm2 start app.js, o el método que uses) — debe
   quedar exactamente como estaba al momento de este backup: mismos
   usuarios, contraseñas, votantes, estructura, configuración, etc.

RESTAURAR DESDE DENTRO DE LA APLICACIÓN (servidor ya existente)
--------------------------------------------------------------
También puedes subir este mismo archivo .zip desde Configuración → Backup
→ "Restaurar backup" en una aplicación ya instalada — reemplaza TODA la
información actual de ese servidor por la de este backup, así que solo
debe usarse cuando de verdad se quiere volver a este punto en el tiempo.
`;

/**
 * Crea el backup completo (base de datos + uploads/) y lo entrega como un
 * .zip para descargar. Se arma en una carpeta temporal y se borra apenas
 * termina de enviarse, para no ir acumulando copias en el servidor.
 */
router.post('/exportar', async (req, res) => {
  const autorizado = await verificarPasswordAdmin(req.body && req.body.password);
  if (!autorizado) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }

  const carpetaTemporal = path.join(os.tmpdir(), `backup-estrategia-${marcaDeTiempo()}`);
  const rutaZip = `${carpetaTemporal}.zip`;
  try {
    fs.mkdirSync(carpetaTemporal, { recursive: true });
    await volcarBaseDatos(path.join(carpetaTemporal, 'database.sql'));
    fs.writeFileSync(path.join(carpetaTemporal, 'LEEME.txt'), LEEME_BACKUP);
    if (fs.existsSync(UPLOAD_DIR)) {
      // Se copia (no se mueve) la carpeta uploads/ real dentro de la
      // carpeta temporal, para que quede junto al volcado antes de
      // comprimir todo en un solo .zip.
      fs.cpSync(UPLOAD_DIR, path.join(carpetaTemporal, 'uploads'), { recursive: true });
    }

    await ejecutar('zip', ['-r', '-q', rutaZip, '.'], { cwd: carpetaTemporal });

    const nombreDescarga = `backup-estrategia-${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreDescarga}"`);
    const lectura = fs.createReadStream(rutaZip);
    lectura.pipe(res);
    lectura.on('close', () => {
      fs.rmSync(carpetaTemporal, { recursive: true, force: true });
      fs.rmSync(rutaZip, { force: true });
    });

    await registrarAuditoria(
      req.session.usuario.id, 'crear_backup', 'sistema', null,
      'Descargó un backup completo de la aplicación (base de datos + archivos).', req.ip
    );
  } catch (err) {
    console.error('Error creando el backup:', err);
    fs.rmSync(carpetaTemporal, { recursive: true, force: true });
    fs.rmSync(rutaZip, { force: true });
    if (!res.headersSent) res.status(500).json({ error: 'Error creando el backup: ' + err.message });
  }
});

/**
 * Restaura un backup subido: reemplaza la base de datos completa y la
 * carpeta uploads/. Antes de tocar nada, guarda un respaldo de seguridad
 * de lo que había en backups/ (por si hay que volver atrás). Exige
 * contraseña de administrador Y la frase de confirmación exacta, porque
 * no hay forma de deshacer esto una vez corre.
 */
router.post('/restaurar', uploadZip.single('archivo'), async (req, res) => {
  const limpiarSubida = () => { if (req.file) fs.rm(req.file.path, { force: true }, () => {}); };

  if (!req.file) {
    return res.status(400).json({ error: 'Debes adjuntar el archivo .zip del backup.' });
  }
  const autorizado = await verificarPasswordAdmin(req.body && req.body.password);
  if (!autorizado) {
    limpiarSubida();
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }
  if ((req.body.confirmacion || '').trim().toUpperCase() !== 'RESTAURAR') {
    limpiarSubida();
    return res.status(400).json({ error: 'Debes escribir "RESTAURAR" para confirmar.' });
  }

  const carpetaExtraida = path.join(os.tmpdir(), `restaurar-estrategia-${marcaDeTiempo()}`);
  try {
    fs.mkdirSync(carpetaExtraida, { recursive: true });
    await ejecutar('unzip', ['-q', req.file.path, '-d', carpetaExtraida]);

    const rutaSqlSubido = path.join(carpetaExtraida, 'database.sql');
    if (!fs.existsSync(rutaSqlSubido)) {
      throw new Error('El archivo subido no tiene un "database.sql" adentro — ¿es un backup generado por esta misma aplicación?');
    }

    // Respaldo de seguridad de lo que había ANTES de restaurar, por si hay que deshacer esto.
    const marca = marcaDeTiempo();
    await volcarBaseDatos(path.join(BACKUPS_DIR, `antes-de-restaurar-${marca}.sql`));
    if (fs.existsSync(UPLOAD_DIR)) {
      fs.cpSync(UPLOAD_DIR, path.join(BACKUPS_DIR, `uploads-antes-de-restaurar-${marca}`), { recursive: true });
    }

    await restaurarBaseDatos(rutaSqlSubido);

    const rutaUploadsSubidos = path.join(carpetaExtraida, 'uploads');
    if (fs.existsSync(rutaUploadsSubidos)) {
      fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
      fs.cpSync(rutaUploadsSubidos, UPLOAD_DIR, { recursive: true });
    }

    await registrarAuditoria(
      req.session.usuario.id, 'restaurar_backup', 'sistema', null,
      `Restauró un backup completo (se guardó respaldo previo en backups/antes-de-restaurar-${marca}.sql).`, req.ip
    );

    res.json({ ok: true, respaldoPrevioGuardadoComo: `antes-de-restaurar-${marca}.sql` });
  } catch (err) {
    console.error('Error restaurando el backup:', err);
    res.status(500).json({ error: 'Error restaurando el backup: ' + err.message });
  } finally {
    limpiarSubida();
    fs.rm(carpetaExtraida, { recursive: true, force: true }, () => {});
  }
});

module.exports = router;
