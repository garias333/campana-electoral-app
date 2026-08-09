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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const nombreUnico = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, nombreUnico);
  }
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

// Subida de Excel para las importaciones masivas (Territorial, Estructura,
// Votantes) — se procesa en memoria (nunca toca disco) y se descarta al
// terminar la petición. Antes estaba definido igual, por separado, en cada
// archivo de rutas que lo usa.
const uploadExcel = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

module.exports = { upload, UPLOAD_DIR, uploadExcel };
