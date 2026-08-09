-- =========================================================
-- Esquema de base de datos
-- Aplicación de Administración de Campañas Políticas
-- Estrategia (INGESES S.A.S.)
-- =========================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------
-- Roles y usuarios
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(30) NOT NULL UNIQUE,
  descripcion VARCHAR(150)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO roles (nombre, descripcion) VALUES
  ('admin', 'Administrador general de la campaña'),
  ('coordinador', 'Coordinador de zona o municipio'),
  ('lider', 'Líder territorial / barrial'),
  ('sublider', 'Sublíder — colaborador registrado desde Votantes y sublíderes'),
  ('usuario', 'Colaborador que registra sus propios contactos, bajo un líder'),
  ('testigo', 'Testigo electoral'),
  ('asistente_administrativo', 'Apoyo administrativo de la campaña'),
  ('invitado', 'Solo consulta información pública de la campaña')
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

-- ---------------------------------------------------------
-- Territorios (jerarquía: departamento > municipio > comuna/corregimiento > barrio/vereda)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS territorios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tipo ENUM('departamento','municipio','comuna','corregimiento','barrio','vereda') NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  padre_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (padre_id) REFERENCES territorios(id) ON DELETE SET NULL,
  INDEX idx_territorio_tipo (tipo),
  INDEX idx_territorio_padre (padre_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Usuarios del sistema
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  numero_identificacion VARCHAR(20) NULL UNIQUE,
  nombre_usuario VARCHAR(60) NULL UNIQUE COMMENT 'Identificador de inicio de sesión (normalmente el mismo número de identificación). VARCHAR(60) porque así existe en la base original. El índice UNIQUE debe llamarse "nombre_usuario": config/erroresUsuarios.js reconoce el campo duplicado por el nombre del índice que MySQL reporta',
  departamento_votacion VARCHAR(100) NULL,
  municipio_votacion VARCHAR(100) NULL,
  puesto_votacion VARCHAR(150) NULL,
  puesto_id INT NULL COMMENT 'id de dia_d_puestos_votacion derivado de puesto_votacion — lo mantienen al día los disparadores trg_usuarios_puesto_id_ins/_upd (ver db/init-db.js)',
  mesa_votacion VARCHAR(20) NULL,
  departamento_residencia VARCHAR(100) NULL COMMENT 'Departamento de residencia (catálogo DANE)',
  ciudad_residencia VARCHAR(100) NULL COMMENT 'Ciudad/municipio de residencia (catálogo DANE)',
  comuna_corregimiento_residencia VARCHAR(150) NULL COMMENT 'Nombre de Comuna o Corregimiento de residencia, tomado del catálogo de Territorios',
  barrio_residencia VARCHAR(150) NULL COMMENT 'Nombre de Barrio o Vereda de residencia, tomado del catálogo de Territorios',
  genero ENUM('mujer','hombre','no_binario','prefiero_no_responder') DEFAULT 'prefiero_no_responder',
  edad SMALLINT UNSIGNED NULL,
  tipo_cargo ENUM(
    'concejal','edil','aspirante_concejo','aspirante_jal','presidente_jal',
    'presidente_jac','miembro_jal','miembro_jac','presidente_gremio','presidente_asociacion',
    'organizaciones_sociales','organizaciones_religiosas'
  ) NULL COMMENT 'Tipo de cargo político/comunitario, opcional, independiente del Cargo en la Estructura',
  apoya_a JSON NULL COMMENT 'A qué cargo(s) apoya esta persona: alcaldia, concejo, jal, gobernacion, asamblea — puede ser más de uno',
  email VARCHAR(150) NULL UNIQUE COMMENT 'Opcional para líderes/sublíderes creados solo con Número de identificación; el login también acepta Nombre de usuario',
  password_hash VARCHAR(255) NOT NULL,
  rol_id INT NOT NULL,
  territorio_id INT NULL,
  telefono VARCHAR(30),
  activo TINYINT(1) DEFAULT 1,
  debe_cambiar_password TINYINT(1) DEFAULT 0,
  two_factor_enabled TINYINT(1) DEFAULT 0,
  intentos_fallidos INT DEFAULT 0,
  bloqueado_hasta DATETIME NULL,
  ultimo_login DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rol_id) REFERENCES roles(id),
  FOREIGN KEY (territorio_id) REFERENCES territorios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Códigos de doble autenticación (2FA por correo, de un solo uso)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS two_factor_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  codigo_hash CHAR(64) NOT NULL,
  intentos INT DEFAULT 0,
  expira_en DATETIME NOT NULL,
  usado TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX idx_2fa_usuario (usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Estructura territorial (líderes, coordinadores, testigos)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS estructura (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  territorio_id INT NULL,
  cargo ENUM('coordinador','coordinador_organizaciones','lider','usuario','testigo') NOT NULL,
  tipo_testigo ENUM('mesa','puesto') NOT NULL DEFAULT 'mesa' COMMENT 'Solo aplica si cargo=testigo: "mesa" es el Testigo electoral normal (una sola mesa), "puesto" es el Coordinador de puesto (varias mesas del mismo puesto de votación)',
  mesas_asignadas JSON NULL COMMENT 'Solo aplica si cargo=testigo y tipo_testigo=puesto: lista de números de mesa que cubre el Coordinador de puesto (ej. [3,7,9]) — el Testigo electoral (tipo_testigo=mesa) usa mesa_votacion, una sola mesa',
  puesto_votacion VARCHAR(200) NULL COMMENT 'Puesto donde VIGILA como testigo — distinto del lugar donde vota la persona (usuarios.puesto_votacion). Solo se llena cuando alguien con otro cargo (Líder, Sublíder, Votante...) es ADEMÁS testigo; el testigo puro sigue guardando en usuarios. Las consultas leen COALESCE(estructura, usuarios)',
  mesa_votacion INT NULL COMMENT 'Mesa que vigila como testigo, cuando tipo_testigo=mesa. Ver nota de puesto_votacion',
  puesto_id INT NULL COMMENT 'id de dia_d_puestos_votacion correspondiente a puesto_votacion — el cruce se hace por id, no comparando textos',
  departamento_votacion VARCHAR(150) NULL COMMENT 'Departamento del puesto que vigila, derivado del catálogo territorial. Se usa para geocodificar',
  municipio_votacion VARCHAR(150) NULL COMMENT 'Municipio del puesto que vigila, derivado del catálogo territorial',
  tipo_area_influencia ENUM('territorio','organizacion') NOT NULL DEFAULT 'territorio' COMMENT 'Si el área de influencia de la persona es geográfica (Territorio) o una Organización',
  organizacion VARCHAR(150) NULL COMMENT 'Nombre de la organización, cuando tipo_area_influencia = organizacion',
  supervisor_id INT NULL COMMENT 'usuario_id del coordinador/líder al que reporta',
  meta_votos INT DEFAULT 0 COMMENT 'Total efectivo — para Coordinador Organizaciones es meta_votos_base + suma de sus gremiales; para todos los demás, es igual a meta_votos_base',
  meta_votos_base INT NOT NULL DEFAULT 0 COMMENT 'Lo que la persona escribe a mano en el formulario — "piso" manual del Coordinador Organizaciones antes de sumarle sus gremiales',
  meta_lideres INT DEFAULT 0,
  direccion VARCHAR(255) NULL,
  latitud DECIMAL(10,7) NULL,
  longitud DECIMAL(10,7) NULL,
  geocodificado_en DATETIME NULL,
  activo TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cliente_uuid CHAR(36) NULL COMMENT 'Identificador generado en el dispositivo al guardar el formulario sin conexión — evita duplicar el registro si el envío se reintenta más de una vez',
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (territorio_id) REFERENCES territorios(id),
  FOREIGN KEY (supervisor_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  INDEX idx_estructura_cargo (cargo),
  INDEX idx_estructura_territorio (territorio_id),
  UNIQUE INDEX uq_estructura_cliente_uuid (cliente_uuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- territorio_id puede ser NULL desde que existe el área de influencia por
-- Organización (una persona con Organización no tiene territorio geográfico).
ALTER TABLE estructura MODIFY territorio_id INT NULL;
ALTER TABLE estructura MODIFY cargo ENUM('coordinador','coordinador_organizaciones','lider','usuario','testigo') NOT NULL;

-- ---------------------------------------------------------
-- Base de datos de votantes y contactos
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS votantes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  categoria ENUM('votante','sublider') NOT NULL DEFAULT 'votante' COMMENT 'Elección obligatoria en el formulario: Votante o Sublíder',
  nombre VARCHAR(300) NOT NULL COMMENT 'Nombres y apellidos en un solo campo (antes eran dos columnas separadas)',
  cedula VARCHAR(20) UNIQUE,
  telefono VARCHAR(30),
  email VARCHAR(150),
  genero ENUM('mujer','hombre','no_binario','prefiero_no_responder') DEFAULT 'prefiero_no_responder',
  edad SMALLINT UNSIGNED NULL,
  fecha_nacimiento DATE NULL,
  territorio_id INT NULL,
  tipo_area_influencia ENUM('territorio','organizacion') NOT NULL DEFAULT 'territorio' COMMENT 'Solo aplica para Sublíder: si su área de influencia es geográfica u una Organización',
  organizacion VARCHAR(150) NULL COMMENT 'Nombre de la organización, cuando tipo_area_influencia = organizacion',
  direccion VARCHAR(255),
  departamento_residencia VARCHAR(100) NULL COMMENT 'Departamento de residencia (catálogo DANE)',
  ciudad_residencia VARCHAR(100) NULL COMMENT 'Ciudad/municipio de residencia (catálogo DANE)',
  area ENUM('urbano','rural') NULL,
  latitud DECIMAL(10,7) NULL,
  longitud DECIMAL(10,7) NULL,
  geocodificado_en DATETIME NULL,
  lider_id INT NULL COMMENT 'usuario_id del líder responsable del contacto',
  sublider_id INT NULL COMMENT 'usuario_id del sublíder (colaborador bajo el líder) que refirió al contacto, opcional',
  intencion_voto ENUM('confirmado','probable','indeciso','no_apoya','desconocido') DEFAULT 'desconocido',
  apoya_a JSON NULL COMMENT 'A qué cargo(s) apoya esta persona: alcaldia, concejo, jal, gobernacion, asamblea — puede ser más de uno',
  departamento_votacion VARCHAR(100) NULL,
  municipio_votacion VARCHAR(100) NULL,
  puesto_votacion VARCHAR(150),
  mesa_votacion VARCHAR(20),
  observaciones TEXT,
  consentimiento_autorizado TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'La persona autorizó expresamente el uso de sus datos (Circular SIC 002 de 2026 / Ley 1581 de 2012)',
  consentimiento_fecha DATETIME NULL COMMENT 'Momento en que se registró la autorización',
  consentimiento_metodo VARCHAR(50) NULL COMMENT 'Cómo se obtuvo: verbal_formulario_campo, escrito, etc.',
  datos_verificados TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Marcado por Administrador o Asistente administrativo cuando ya revisaron/confirmaron la calidad de estos datos',
  cliente_uuid CHAR(36) NULL COMMENT 'Identificador generado en el celular al guardar el formulario (antes de enviarlo) — evita crear un duplicado si el mismo registro se reintenta más de una vez tras un corte de señal',
  origen ENUM('manual','importado','formulario_publico','estructura') DEFAULT 'manual',
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (territorio_id) REFERENCES territorios(id) ON DELETE SET NULL,
  FOREIGN KEY (lider_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (sublider_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES usuarios(id) ON DELETE SET NULL,
  INDEX idx_votante_intencion (intencion_voto),
  INDEX idx_votante_territorio (territorio_id),
  UNIQUE INDEX uq_votante_cliente_uuid (cliente_uuid),
  FULLTEXT INDEX ft_votante_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Finanzas: categorías y movimientos (ingresos/gastos)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS finanzas_categorias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  tipo ENUM('ingreso','gasto') NOT NULL,
  tope_legal DECIMAL(16,2) NULL COMMENT 'Tope CNE si aplica a la categoría',
  UNIQUE KEY uq_categoria (nombre, tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO finanzas_categorias (nombre, tipo) VALUES
  ('Aportes propios candidato', 'ingreso'),
  ('Donaciones personas naturales', 'ingreso'),
  ('Donaciones personas jurídicas', 'ingreso'),
  ('Financiación estatal (reposición de votos)', 'ingreso'),
  ('Créditos', 'ingreso'),
  ('Publicidad y propaganda electoral', 'gasto'),
  ('Producción de material impreso', 'gasto'),
  ('Logística de eventos', 'gasto'),
  ('Transporte y movilización', 'gasto'),
  ('Honorarios de asesoría / consultoría', 'gasto'),
  ('Encuestas y estudios de opinión', 'gasto'),
  ('Arrendamiento sedes', 'gasto'),
  ('Nómina y honorarios equipo de campaña', 'gasto')
ON DUPLICATE KEY UPDATE tipo = VALUES(tipo);

CREATE TABLE IF NOT EXISTS finanzas_movimientos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  categoria_id INT NOT NULL,
  tipo ENUM('ingreso','gasto') NOT NULL,
  monto DECIMAL(16,2) NOT NULL,
  descripcion VARCHAR(255),
  tercero VARCHAR(150) COMMENT 'Nombre del donante o proveedor',
  documento_tercero VARCHAR(20),
  fecha DATE NOT NULL,
  comprobante_url VARCHAR(255),
  territorio_id INT NULL,
  registrado_por INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (categoria_id) REFERENCES finanzas_categorias(id),
  FOREIGN KEY (territorio_id) REFERENCES territorios(id) ON DELETE SET NULL,
  FOREIGN KEY (registrado_por) REFERENCES usuarios(id),
  INDEX idx_finanzas_tipo_fecha (tipo, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Eventos, agenda y movilización (GOTV)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS eventos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(200) NOT NULL,
  descripcion TEXT,
  tipo ENUM('reunion','evento_publico','gotv','capacitacion','otro') DEFAULT 'reunion',
  fecha_inicio DATETIME NOT NULL,
  fecha_fin DATETIME NULL,
  lugar VARCHAR(255),
  territorio_id INT NULL,
  area ENUM('urbano','rural') NULL,
  latitud DECIMAL(10,7) NULL,
  longitud DECIMAL(10,7) NULL,
  geocodificado_en DATETIME NULL,
  responsable_id INT NULL,
  coordinador_id INT NULL COMMENT 'coordinador de la comuna/corregimiento, informativo',
  lider_id INT NULL COMMENT 'líder del barrio/vereda, informativo',
  meta_asistentes INT DEFAULT 0,
  estado ENUM('programado','realizado','cancelado') DEFAULT 'programado',
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (territorio_id) REFERENCES territorios(id) ON DELETE SET NULL,
  FOREIGN KEY (responsable_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (coordinador_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (lider_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES usuarios(id),
  INDEX idx_eventos_fecha (fecha_inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS evento_asistentes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  evento_id INT NOT NULL,
  votante_id INT NULL,
  usuario_id INT NULL,
  nombre_invitado VARCHAR(150) NULL COMMENT 'si no está en votantes ni usuarios',
  confirmado TINYINT(1) DEFAULT 0,
  asistio TINYINT(1) DEFAULT 0,
  FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE,
  FOREIGN KEY (votante_id) REFERENCES votantes(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Redes sociales y monitoreo de opinión
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS redes_publicaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(200) NOT NULL,
  red_social ENUM('facebook','instagram','x','tiktok','youtube','whatsapp') NOT NULL,
  contenido TEXT,
  fecha_programada DATETIME NULL,
  estado ENUM('borrador','programado','publicado') DEFAULT 'borrador',
  url_publicacion VARCHAR(255),
  metricas_alcance INT DEFAULT 0,
  metricas_interacciones INT DEFAULT 0,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS monitoreo_menciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fuente VARCHAR(100) NOT NULL COMMENT 'Medio o red donde se detectó la mención',
  texto TEXT NOT NULL,
  sentimiento ENUM('positivo','neutro','negativo') DEFAULT 'neutro',
  url VARCHAR(255),
  fecha_deteccion DATETIME DEFAULT CURRENT_TIMESTAMP,
  registrado_por INT NULL,
  FOREIGN KEY (registrado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Sección de información para compartir (recursos)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS recursos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(200) NOT NULL,
  tipo ENUM('noticia','post_redes','video','publicidad_digital','publicidad_impresa','proxima_reunion','jingle','foto_campana') NOT NULL,
  descripcion TEXT,
  archivo_nombre VARCHAR(255),
  archivo_url VARCHAR(255),
  archivo_mime VARCHAR(100),
  archivo_tamano_kb INT,
  enlace_externo VARCHAR(255) COMMENT 'para videos de YouTube u otros enlaces sin archivo propio',
  fecha_evento DATETIME NULL COMMENT 'usado cuando tipo = proxima_reunion',
  publicado TINYINT(1) DEFAULT 1,
  subido_por INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subido_por) REFERENCES usuarios(id),
  INDEX idx_recursos_tipo (tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Auditoría básica (para trazabilidad de acciones sensibles)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditoria (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NULL,
  accion VARCHAR(100) NOT NULL,
  entidad VARCHAR(50),
  entidad_id INT NULL,
  detalle TEXT,
  ip VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Recuperación de contraseña por correo (tokens de un solo uso)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expira_en DATETIME NOT NULL,
  usado TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX idx_password_resets_token (token_hash),
  INDEX idx_password_resets_usuario (usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Organigrama manual: árbol libre de Cargo + Nombre, con
-- subestructuras anidadas (no depende del catálogo de Territorios ni de
-- Estructura — es una herramienta aparte para armar organigramas a mano).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS organigrama_nodos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cargo VARCHAR(150) NOT NULL,
  nombre VARCHAR(150) NULL COMMENT 'Campo antiguo (nombre libre) — se conserva por compatibilidad; los cargos nuevos usan nombres/apellidos',
  nombres VARCHAR(100) NULL,
  apellidos VARCHAR(100) NULL,
  telefono VARCHAR(30) NULL,
  email VARCHAR(150) NULL,
  nivel ENUM('nivel_1','nivel_2','nivel_3','nivel_4','nivel_5','nivel_6','asesores') NULL,
  funciones TEXT NULL COMMENT 'Descripción de las funciones/responsabilidades del cargo',
  padre_id INT NULL,
  tipo_relacion ENUM('subordinado','asesor') NOT NULL DEFAULT 'subordinado' COMMENT 'subordinado = línea jerárquica normal; asesor = staff horizontal',
  orden INT DEFAULT 0,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (padre_id) REFERENCES organigrama_nodos(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES usuarios(id) ON DELETE SET NULL,
  INDEX idx_organigrama_padre (padre_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Configuración de la campaña: una sola fila (id = 1) con los datos
-- generales del candidato/campaña. Se administra desde el módulo
-- "Configuración → Datos de la campaña".
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS configuracion_campana (
  id INT PRIMARY KEY DEFAULT 1,
  nombre_candidato VARCHAR(150) NULL,
  cargo_aspira ENUM('senado','camara_representantes','gobernacion','asamblea','alcaldia','concejo','jal') NULL,
  slogan_campana VARCHAR(255) NULL,
  partido_politico VARCHAR(150) NULL,
  departamento VARCHAR(100) NULL,
  ciudad VARCHAR(100) NULL,
  territorio_departamento VARCHAR(100) NULL COMMENT 'Departamento donde se desarrolla la campaña (según el cargo al que aspira)',
  territorio_ciudad VARCHAR(100) NULL COMMENT 'Ciudad donde se desarrolla la campaña (solo para cargos municipales/locales)',
  ciudad_tiene_comunas TINYINT(1) NOT NULL DEFAULT 1 COMMENT '¿Utilizar nombre de comunas? — en 0, el campo Comuna deja de mostrarse en los formularios de captura de persona/evento',
  usar_nombre_barrios TINYINT(1) NOT NULL DEFAULT 1 COMMENT '¿Utilizar nombre de barrios? — en 0, el campo Barrio deja de mostrarse y Líder/Sublíder/Testigo se asignan directo a la Comuna, igual que ya hace Coordinador',
  fecha_eleccion DATE NULL COMMENT 'Fecha de la jornada electoral — se usa para que un testigo caiga directo en Día D al iniciar sesión ese día',
  direccion_sede VARCHAR(255) NULL,
  telefono VARCHAR(30) NULL,
  email VARCHAR(150) NULL,
  actualizado_por INT NULL,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (actualizado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Permisos por rol: qué módulos del menú puede ver/usar cada tipo de
-- usuario. Se administra desde "Configuración → Asignación de permisos".
-- Si una combinación rol+módulo no está aquí, el sistema usa un valor por
-- defecto razonable (ver init-db.js) — nunca deja a alguien sin menú.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS permisos_rol (
  rol VARCHAR(30) NOT NULL,
  modulo VARCHAR(50) NOT NULL,
  permitido TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Ver: si el módulo aparece en el menú y se puede consultar',
  editar TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Editar registros existentes de ese módulo',
  agregar TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Agregar registros nuevos en ese módulo',
  PRIMARY KEY (rol, modulo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- CRM / Comunicaciones: campañas de Email, SMS y WhatsApp
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS comunicaciones_campanas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  canal ENUM('email','sms','whatsapp','email_personal') NOT NULL,
  asunto VARCHAR(200) NULL COMMENT 'Solo aplica a Email',
  mensaje TEXT NOT NULL,
  filtros JSON NULL COMMENT 'Filtros de destinatarios aplicados (territorio, intención, cargo, categoría, etc.)',
  adjunto_nombre VARCHAR(255) NULL COMMENT 'Nombre original del archivo adjunto (solo WhatsApp)',
  adjunto_url VARCHAR(500) NULL COMMENT 'URL pública del adjunto, para que Twilio pueda descargarlo',
  status_callback_url VARCHAR(500) NULL COMMENT 'URL de callback de Twilio guardada al crear la campaña, para poder reanudar el envío tras un reinicio sin depender de la petición HTTP original',
  estado ENUM('borrador','enviando','enviado','fallido') NOT NULL DEFAULT 'borrador',
  total_destinatarios INT NOT NULL DEFAULT 0,
  enviados INT NOT NULL DEFAULT 0,
  fallidos INT NOT NULL DEFAULT 0,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  enviado_en DATETIME NULL,
  FOREIGN KEY (created_by) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS comunicaciones_envios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  campana_id INT NOT NULL,
  destinatario_tipo ENUM('votante','estructura','manual') NOT NULL,
  destinatario_id INT NULL COMMENT 'id en votantes o en estructura, según destinatario_tipo; NULL si es un contacto manual',
  destinatario_nombre VARCHAR(150) NULL,
  destinatario_contacto VARCHAR(150) NULL COMMENT 'Email o teléfono usado para el envío',
  twilio_sid VARCHAR(50) NULL COMMENT 'ID del mensaje en Twilio (SMS/WhatsApp) — para relacionarlo con el aviso de cambio de estado',
  estado ENUM('pendiente','enviado','fallido','sin_contacto') NOT NULL DEFAULT 'pendiente',
  error_mensaje VARCHAR(255) NULL,
  enviado_en DATETIME NULL,
  FOREIGN KEY (campana_id) REFERENCES comunicaciones_campanas(id) ON DELETE CASCADE,
  INDEX idx_envios_campana (campana_id),
  INDEX idx_envios_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Credenciales de Comunicaciones (SendGrid + Twilio), configurables
-- desde la interfaz en vez de tener que editar el .env del servidor.
-- Un solo registro (id = 1), igual que configuracion_campana.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS configuracion_comunicaciones (
  id TINYINT PRIMARY KEY DEFAULT 1,
  sendgrid_api_key VARCHAR(255) NULL,
  sendgrid_from VARCHAR(150) NULL,
  sendgrid_from_name VARCHAR(100) NULL,
  twilio_account_sid VARCHAR(100) NULL,
  twilio_auth_token VARCHAR(100) NULL,
  twilio_sms_from VARCHAR(30) NULL,
  twilio_whatsapp_from VARCHAR(40) NULL,
  actualizado_por INT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (actualizado_por) REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT chk_config_comunicaciones_id CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Día D: reportes de conteo de votos por mesa, hechos por los testigos
-- electorales el día de la jornada. Un testigo puede reportar varias veces
-- para la misma mesa a lo largo del día (parcial, final) — no se asigna la
-- mesa desde un panel de administración, el propio testigo la escribe al
-- reportar (evita tener que construir antes una pantalla de asignación).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS dia_d_reportes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  testigo_id INT NOT NULL,
  departamento VARCHAR(100) NULL,
  municipio VARCHAR(100) NULL,
  puesto_votacion VARCHAR(150) NOT NULL,
  mesa_votacion VARCHAR(20) NOT NULL,
  votos_candidato INT NULL,
  total_votantes_mesa INT NULL COMMENT 'Total de personas que sufragaron en la mesa, si el testigo lo conoce',
  novedad TEXT NULL COMMENT 'Irregularidad u observación a reportar al equipo de campaña',
  foto_e14_url VARCHAR(255) NULL COMMENT 'Foto del formulario de preconteo E-14 que sube el testigo como respaldo',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cliente_uuid CHAR(36) NULL COMMENT 'Identificador generado en el celular al guardar el reporte sin conexión — evita duplicar el reporte si el envío se reintenta más de una vez',
  FOREIGN KEY (testigo_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX idx_diad_testigo (testigo_id),
  INDEX idx_diad_mesa (puesto_votacion, mesa_votacion),
  UNIQUE INDEX uq_diad_reporte_cliente_uuid (cliente_uuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Configuración del Día D: datos de referencia que el equipo de campaña
-- arma ANTES de la jornada (puestos de votación de la ciudad con su
-- cantidad de mesas, y candidatos participando en la elección), para que
-- el formulario de reporte del testigo tenga opciones consistentes.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS dia_d_puestos_votacion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(200) NOT NULL,
  cantidad_mesas INT NOT NULL DEFAULT 0,
  ctc_puesto_id INT NULL COMMENT 'Enlace al puesto oficial en el Catálogo Territorial (territoriosdb.ctc_puestos_votacion). Queda NULL en los puestos escritos a mano antes de existir el catálogo',
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX uq_dia_d_puestos_ctc (ctc_puesto_id),
  FOREIGN KEY (created_by) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dia_d_candidatos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(200) NOT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Votos por candidato de un reporte puntual (un testigo reporta, en una
-- sola foto de E-14, los votos de TODOS los candidatos de esa mesa, no
-- solo los del candidato propio). Se guarda el nombre del candidato tal
-- cual estaba en el momento del reporte (no una FK a dia_d_candidatos)
-- para que el historial no cambie si luego se edita o borra un candidato.
CREATE TABLE IF NOT EXISTS dia_d_reporte_votos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reporte_id INT NOT NULL,
  candidato_nombre VARCHAR(200) NOT NULL,
  votos INT NOT NULL DEFAULT 0,
  FOREIGN KEY (reporte_id) REFERENCES dia_d_reportes(id) ON DELETE CASCADE,
  INDEX idx_reporte_votos_reporte (reporte_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Contenido de páginas informativas simples (Biografía del candidato,
-- Política de privacidad, y cualquier otra similar en el futuro) — un
-- solo bloque de texto editable por página, identificado por "clave".
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS contenido_paginas (
  clave VARCHAR(50) PRIMARY KEY,
  titulo VARCHAR(150) NULL,
  contenido MEDIUMTEXT NULL,
  foto_url VARCHAR(255) NULL,
  video_url VARCHAR(255) NULL,
  actualizado_por INT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (actualizado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
