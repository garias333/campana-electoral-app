const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXTENSIONES_PERMITIDAS = [
  '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.pdf', '.doc', '.docx', '.ppt', '.pptx',
  '.mp4', '.mov', '.avi', '.mp3'
];

function nombreUnicoDeArchivo(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const nombreUnico = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
  cb(null, nombreUnico);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: nombreUnicoDeArchivo
});

function filtroArchivo(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!EXTENSIONES_PERMITIDAS.includes(ext)) {
    return cb(new Error(`Tipo de archivo no permitido: ${ext}`));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter: filtroArchivo,
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB
});

/* LAS FOTOS DEL DÍA D TIENEN CARPETA PROPIA: uploads/dia-d/.
   Hasta ahora el E-14 y los demás documentos de un reporte caían en la RAÍZ de
   uploads/, mezclados con los comprobantes de finanzas, los adjuntos de
   comunicaciones y los recursos. Sin carpeta propia no había forma de cerrar
   el acceso directo a las fotos del acta sin cerrar también todo lo demás.
   Esa carpeta NO se sirve por /uploads (ver app.js): las fotos salen solo por
   GET /api/dia-d/reportes/:id/foto, que comprueba quién pregunta.
   Los reportes anteriores siguen apuntando a /uploads/<archivo> en la raíz, y
   las rutas de archivo aceptan las dos ubicaciones. */
const UPLOAD_DIA_D_DIR = path.join(UPLOAD_DIR, 'dia-d');
if (!fs.existsSync(UPLOAD_DIA_D_DIR)) fs.mkdirSync(UPLOAD_DIA_D_DIR, { recursive: true });

const uploadDiaD = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIA_D_DIR),
    filename: nombreUnicoDeArchivo
  }),
  fileFilter: filtroArchivo,
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB, igual que antes
});

// Subida de Excel para las importaciones masivas (Territorial, Estructura,
// Votantes) — se procesa en memoria (nunca toca disco) y se descarta al
// terminar la petición. Antes estaba definido igual, por separado, en cada
// archivo de rutas que lo usa.
const uploadExcel = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

module.exports = { upload, uploadDiaD, UPLOAD_DIR, UPLOAD_DIA_D_DIR, uploadExcel };
