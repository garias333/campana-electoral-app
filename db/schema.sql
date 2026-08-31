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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO roles (nombre, descripcion) VALUES
  ('admin', 'Administrador general de la campaña'),
  ('coordinador', 'Coordinador de zona o municipio'),
  ('lider', 'Líder territorial / barrial'),
  ('sublider', 'Sublíder — colaborador registrado desde Votantes y sublíderes'),
  ('usuario', 'Colaborador que registra sus propios contactos, bajo un líder'),
  ('testigo', 'Testigo electoral'),
  ('asistente_administrativo', 'Apoyo administrativo de la campaña'),
  ('administrativo', 'Perfil administrativo — sus módulos los asigna el administrador'),
  ('invitado', 'Solo consulta información pública de la campaña'),
  -- EN LA SESIÓN SE COMPORTA COMO UN LÍDER, Y ESO NO ES UN ATAJO.
  --
  -- Medido antes de crearlo: hay 32 sitios que comparan contra el rol 'lider'
  -- —25 en el servidor y 7 en el navegador— más 6 `requireRole`. Un rol nuevo
  -- a secas dejaría de coincidir en los 32, y cada uno que se escapara sería
  -- una pantalla que dice «no tiene permisos» sin que nadie sepa por qué.
  --
  -- Por eso `completarSesion` lo traduce a `rol: 'lider'` y guarda el
  -- verdadero en `rol_real`, igual que ya se hacía con el sombrero de testigo.
  -- Los 32 sitios siguen funcionando sin tocar uno solo, y lo que distingue a
  -- un aspirante viaja aparte, en `es_aspirante_concejo`.
  --
  -- Consecuencia buscada: `permisos_rol` tampoco necesita filas nuevas — la
  -- matriz de 'lider' es la que aplica, que es exactamente lo que se quiere.
  ('aspirante_concejo', 'Aspirante al Concejo — dirige su propia estructura de líderes')
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

-- ---------------------------------------------------------
-- Territorios (jerarquía: departamento > municipio > comuna/corregimiento > barrio/vereda)
--
-- ATENCIÓN: EN UNA CAMPAÑA CONECTADA AL CATÁLOGO, ESTO NO ES UNA TABLA.
--
-- Se crea aquí como tabla local vacía para que una instalación desde cero
-- nunca falle, aunque todavía no tenga permisos sobre el catálogo. El paso
-- que la convierte en la VISTA de solo lectura sobre
-- `territoriosdb.ctc_territorios`, acotada por `campana_ambito`, vive en el
-- proyecto del catálogo (`vista_territorios_catalogo.sql`) — y ahí debe
-- seguir: es la definición de la integración, y tener dos copias que puedan
-- divergir es el error que este proyecto ya pagó caro con `ctc_normalizar()`.
--
-- Estado medido el 9 de agosto de 2026: en las dos campañas reales
-- `territorios` es una VISTA; en la plantilla `electoraldb` sigue siendo esta
-- tabla, vacía. O sea que una campaña clonada de la plantilla NO nace
-- conectada: hay que correr ese script.
--
-- POR ESO NINGUNA OTRA TABLA TIENE FK HACIA AQUÍ.
--   Una llave foránea no puede apuntar a una vista, ni cruzar bases de datos.
--   Mientras exista una FK viva contra esta tabla, el cambio a vista falla.
--   Las cinco que había (usuarios, estructura, votantes, eventos,
--   finanzas_movimientos) se quitaron: no existían en NINGUNA de las tres
--   bases reales, así que sólo servían para bloquear la conversión en una
--   instalación nueva.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------
-- Ámbito de la campaña dentro del Catálogo Territorial.
--
-- Una campaña conectada al catálogo NO copia territorios: DECLARA en una fila
-- hasta dónde llega. La vista `territorios` (ver la nota de arriba) se acota
-- con esta tabla, y sin ella no se puede crear.
--
-- Existía en las tres bases pero no la creaba nada en este repositorio, así
-- que una instalación desde cero se quedaba sin ella y la integración con el
-- catálogo no se podía levantar. La tabla se define aquí —es del esquema de
-- la campaña—; la VISTA que la usa sigue viviendo en el proyecto del
-- catálogo. Arranca vacía: la fila la escribe quien aprovisiona la campaña.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS campana_ambito (
  campana_id        INT UNSIGNED NOT NULL,
  ctc_territorio_id BIGINT UNSIGNED NOT NULL COMMENT 'id en territoriosdb.ctc_territorios — sin FK: no se puede cruzar bases',
  nivel_operativo   ENUM('MUNICIPIO','BARRIO','PUESTO','MESA') NOT NULL,
  PRIMARY KEY (campana_id, ctc_territorio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
  mesa_votacion INT NULL COMMENT 'Número de mesa. INT como en estructura.mesa_votacion: las mesas se numeran 1..N (medido en el catálogo, sin excepciones) y tener el mismo dato como texto en unas tablas y número en otras obliga a MySQL a convertir en cada COALESCE que las cruza',
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
  es_superadmin TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Superadministrador: la única cuenta con control total. Conserva rol_id de admin —de ahí saca sus permisos, ver config/superadmin.js— y esta bandera le suma lo demás: nadie más la ve ni la puede tocar. NINGUNA ruta de la aplicación la escribe; se otorga con scripts/elevar-superadmin.js',
  superadmin_unico TINYINT(1) GENERATED ALWAYS AS (IF(es_superadmin = 1, 1, NULL)) VIRTUAL COMMENT 'Existe solo para colgarle el UNIQUE de abajo. Vale 1 para el superadministrador y NULL para todos los demás; como MySQL no compara los NULL entre sí en un índice único, los demás usuarios conviven sin estorbarse y un segundo superadministrador choca con ER_DUP_ENTRY',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rol_id) REFERENCES roles(id),
  -- Sin FK hacia territorios: ver la nota de la tabla `territorios`. El índice
  -- sí hace falta y va explícito: antes lo creaba la propia FK, y al quitarla
  -- una instalación nueva se quedaba sin él (las bases actuales lo conservan,
  -- porque MySQL no borra el índice al soltar la llave).
  INDEX idx_usuarios_territorio (territorio_id),
  -- SOLO PUEDE HABER UN SUPERADMINISTRADOR, Y LO GARANTIZA LA BASE.
  --
  -- No una comprobación en JavaScript: entre un «¿ya hay uno?» y el INSERT
  -- que le sigue cabe otra petición, y sobre todo esa comprobación no cubre
  -- lo que no pasa por la aplicación —la consola de MySQL, un respaldo
  -- restaurado, un script—. Aquí no hay forma de meter el segundo.
  UNIQUE KEY uq_superadmin_unico (superadmin_unico)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
  area ENUM('urbano','rural') NULL COMMENT 'Urbano o Rural, tal como se eligió en el formulario. Se GUARDA en vez de deducirse del tipo de territorio: cuando la persona cuelga directo del municipio —campañas sin comunas ni barrios— no hay tipo del que deducirla y la columna salía vacía. Igual que votantes.area y eventos.area',
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
  -- Sin FK hacia territorios: ver la nota de la tabla `territorios`.
  FOREIGN KEY (supervisor_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  INDEX idx_estructura_cargo (cargo),
  INDEX idx_estructura_territorio (territorio_id),
  UNIQUE INDEX uq_estructura_cliente_uuid (cliente_uuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
  apoya_a JSON NULL COMMENT 'A qué cargo(s) apoya esta persona: alcaldia, concejo, jal, gobernacion, asamblea — puede ser más de uno',
  departamento_votacion VARCHAR(100) NULL,
  municipio_votacion VARCHAR(100) NULL,
  puesto_votacion VARCHAR(150),
  mesa_votacion INT NULL COMMENT 'Número de mesa — ver la nota de usuarios.mesa_votacion',
  observaciones TEXT,
  consentimiento_autorizado TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'La persona autorizó expresamente el uso de sus datos (Circular SIC 002 de 2026 / Ley 1581 de 2012)',
  consentimiento_fecha DATETIME NULL COMMENT 'Momento en que se registró la autorización',
  consentimiento_metodo VARCHAR(50) NULL,
  -- Autorización POR CANAL. NULL no es "no autorizó": es "no consta", y así
  -- quedan los registros anteriores a que existiera esta pregunta — siguen
  -- recibiendo como siempre. Solo un 0 explícito bloquea el envío. Sin esa
  -- distinción, activar esto habría dejado sin mensajes a toda la base
  -- registrada hasta volver a preguntarle a cada persona.
  consentimiento_email TINYINT(1) NULL,
  consentimiento_sms TINYINT(1) NULL,
  consentimiento_whatsapp TINYINT(1) NULL,
  -- Huella del texto de la política que se le MOSTRÓ a la persona. Es lo que
  -- convierte la casilla en evidencia: sin ella, dentro de un año no se puede
  -- demostrar a qué dijo que sí, porque el texto pudo cambiar diez veces.
  consentimiento_version VARCHAR(64) NULL COMMENT 'Cómo se obtuvo: verbal_formulario_campo, escrito, etc.',
  datos_verificados TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Marcado por Administrador o Asistente administrativo cuando ya revisaron/confirmaron la calidad de estos datos',
  cliente_uuid CHAR(36) NULL COMMENT 'Identificador generado en el celular al guardar el formulario (antes de enviarlo) — evita crear un duplicado si el mismo registro se reintenta más de una vez tras un corte de señal',
  origen ENUM('manual','importado','formulario_publico','estructura') DEFAULT 'manual',
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- Sin FK hacia territorios: ver la nota de la tabla `territorios`.
  FOREIGN KEY (lider_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (sublider_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES usuarios(id) ON DELETE SET NULL,
  INDEX idx_votante_territorio (territorio_id),
  UNIQUE INDEX uq_votante_cliente_uuid (cliente_uuid),
  FULLTEXT INDEX ft_votante_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------
-- Finanzas: categorías y movimientos (ingresos/gastos)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS finanzas_categorias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  tipo ENUM('ingreso','gasto') NOT NULL,
  tope_legal DECIMAL(16,2) NULL COMMENT 'Tope CNE si aplica a la categoría',
  UNIQUE KEY uq_categoria (nombre, tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
  -- Sin FK hacia territorios: ver la nota de la tabla `territorios`.
  FOREIGN KEY (registrado_por) REFERENCES usuarios(id),
  INDEX idx_finanzas_tipo_fecha (tipo, fecha),
  -- Explícito por lo mismo que en `usuarios`: lo creaba la FK que se quitó.
  INDEX idx_finanzas_territorio (territorio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
  -- Sin FK hacia territorios: ver la nota de la tabla `territorios`.
  FOREIGN KEY (responsable_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (coordinador_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (lider_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES usuarios(id),
  INDEX idx_eventos_fecha (fecha_inicio),
  -- Explícito por lo mismo que en `usuarios`: lo creaba la FK que se quitó.
  INDEX idx_eventos_territorio (territorio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS monitoreo_menciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fuente VARCHAR(100) NOT NULL COMMENT 'Medio o red donde se detectó la mención',
  texto TEXT NOT NULL,
  sentimiento ENUM('positivo','neutro','negativo') DEFAULT 'neutro',
  url VARCHAR(255),
  fecha_deteccion DATETIME DEFAULT CURRENT_TIMESTAMP,
  registrado_por INT NULL,
  FOREIGN KEY (registrado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
  meta_votos_campana INT UNSIGNED NULL COMMENT 'Meta de votos que se fija la campaña. NULL = no la ha declarado, que no es lo mismo que cero',
  partido_politico VARCHAR(150) NULL,
  departamento VARCHAR(100) NULL,
  ciudad VARCHAR(100) NULL,
  territorio_departamento VARCHAR(100) NULL COMMENT 'Departamento donde se desarrolla la campaña (según el cargo al que aspira)',
  territorio_ciudad VARCHAR(100) NULL COMMENT 'Ciudad donde se desarrolla la campaña (solo para cargos municipales/locales)',
  ciudad_tiene_comunas TINYINT(1) NOT NULL DEFAULT 1 COMMENT '¿Utilizar nombre de comunas? — en 0, el campo Comuna deja de mostrarse en los formularios de captura de persona/evento',
  usar_nombre_barrios TINYINT(1) NOT NULL DEFAULT 1 COMMENT '¿Utilizar nombre de barrios? — en 0, el campo Barrio deja de mostrarse y Líder/Sublíder/Testigo se asignan directo a la Comuna, igual que ya hace Coordinador',
  usar_nombre_corregimientos TINYINT(1) NOT NULL DEFAULT 1 COMMENT '¿Utilizar nombre de corregimientos? — el gemelo rural de ciudad_tiene_comunas: en 0, el campo Corregimiento deja de mostrarse y la Vereda se elige directo',
  usar_nombre_veredas TINYINT(1) NOT NULL DEFAULT 1 COMMENT '¿Utilizar nombre de veredas? — el gemelo rural de usar_nombre_barrios: en 0, el campo Vereda deja de mostrarse y la persona se asigna directo al Corregimiento',
  fecha_eleccion DATE NULL COMMENT 'Fecha de la jornada electoral — se usa para que un testigo caiga directo en Día D al iniciar sesión ese día',
  direccion_sede VARCHAR(255) NULL,
  telefono VARCHAR(30) NULL,
  email VARCHAR(150) NULL,
  actualizado_por INT NULL,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (actualizado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
  INDEX idx_envios_estado (estado),
  -- Twilio avisa por webhook el cambio de estado de CADA mensaje, y ese
  -- aviso busca la fila por su SID. Sin índice es un recorrido completo de
  -- la tabla por aviso — y la tabla tiene una fila por destinatario, así que
  -- el coste se dispara justo cuando más avisos llegan (ver A7 de AUDITORIA.md).
  INDEX idx_envios_twilio_sid (twilio_sid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
  -- Onurix es el proveedor principal de SMS. Normalmente estas dos quedan
  -- VACIAS y se usa la cuenta maestra del .env del servidor, que es el
  -- modelo: una sola cuenta y creditos repartidos por campaña. Solo se
  -- llenan si una campaña trae su PROPIA cuenta de Onurix.
  onurix_client VARCHAR(50) NULL,
  onurix_key VARCHAR(255) NULL,
  actualizado_por INT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (actualizado_por) REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT chk_config_comunicaciones_id CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
  mesa_votacion INT NOT NULL COMMENT 'Número de mesa — ver la nota de usuarios.mesa_votacion',
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Orden de los tres bloques del E-14 dentro de la hoja de candidatos. Una fila
-- por bloque y por campaña (`aspirante_id` 0 es la principal, igual que en el
-- resto del Día D).
--
-- POR QUE UNA TABLA Y NO UNA COLUMNA MAS EN `dia_d_candidatos`: el orden de los
-- bloques es un dato de la CAMPAÑA, no de cada renglón. Repetido en cada fila
-- habría tantas copias como candidatos, y bastaría con que una quedara
-- desactualizada —una importación de Excel que no lo escriba, por ejemplo—
-- para que la hoja y el formulario del testigo mostraran bloques en distinto
-- orden, cada uno con su parte de razón.
CREATE TABLE IF NOT EXISTS dia_d_bloques (
  aspirante_id INT NOT NULL DEFAULT 0,
  grupo ENUM('candidato','nivelacion','otros') NOT NULL,
  orden INT NOT NULL,
  -- Si el bloque se numera y desde qué número. El tarjetón de una corporación
  -- empieza en 0 —el voto solo por la lista— y los candidatos siguen en 1; la
  -- nivelación de la mesa normalmente no lleva número. Antes esto se deducía de
  -- si la campaña era una sublicencia, que acertaba a veces y no se podía
  -- corregir; ahora se pregunta.
  numerado TINYINT(1) NOT NULL DEFAULT 1,
  numero_inicial INT NOT NULL DEFAULT 1,
  PRIMARY KEY (aspirante_id, grupo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS dia_d_candidatos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(200) NOT NULL,
  -- Posición en el tarjetón. El testigo transcribe un E-14 y allí el orden lo
  -- fija la Registraduría, no la campaña: sin esta columna la lista salía por
  -- `id`, es decir por orden de captura, y no había forma de cuadrarla con el
  -- papel. Se ordena por `orden` y se desempata por `id`, así una tabla que
  -- todavía tenga todo en 0 conserva exactamente el orden que tenía antes.
  orden INT NOT NULL DEFAULT 0,
  -- Los tres bloques del E-14. La tabla dejó de ser «los candidatos» para ser
  -- «lo que el testigo cuenta en la mesa», que es lo que el papel trae:
  --   candidato  — los del tarjetón, y los únicos que compiten en el gráfico
  --   nivelacion — la nivelación de la mesa
  --   otros      — en blanco, nulos, no marcados, solo por la lista
  -- `candidato` por defecto NO es un detalle: al agregar la columna, todo lo
  -- que ya existía cae ahí y la aplicación se comporta exactamente igual que
  -- antes. Reorganizarlo en los tres bloques es una decisión de cada campaña,
  -- no algo que la migración haga por su cuenta y sin avisar.
  grupo ENUM('candidato','nivelacion','otros') NOT NULL DEFAULT 'candidato',
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------
-- Mensajería directa: bitácora, exclusiones y ajustes del canal SMS
--
-- POR QUÉ ESTÁN AQUÍ Y NO EN UN .sql APARTE
--   Estaban en sql/migracion-sms-campana.sql, que se corría a mano. Eso
--   funciona para las bases que ya existen, pero `generar-parche.js` rechaza
--   los .sql fuera de db/, así que una campaña NUEVA nacía sin estas tablas y
--   el canal fallaba en cada envío. El esquema de la campaña se crea aquí.
--
-- LOS CRÉDITOS NO ESTÁN AQUÍ, Y ES A PROPÓSITO.
--   El saldo vive en la base central de licencias (sms_cuota,
--   sms_consumo_diario, sms_movimientos), donde la campaña no lo puede
--   editar. Esta base solo guarda QUÉ se envió. Ver
--   sql/migracion-sms-licencias.sql y sql/usuario-sms-ledger.sql.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_envios (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  destino VARCHAR(20) NOT NULL COMMENT 'Normalizado: 573001234567',
  contacto_id BIGINT UNSIGNED NULL,
  mensaje TEXT NOT NULL,
  segmentos SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  codificacion ENUM('gsm7','ucs2') NOT NULL DEFAULT 'gsm7',
  proveedor VARCHAR(20) NULL COMMENT 'onurix | twilio | NULL si no se intentó — un mensaje rechazado por la lista de baja o por falta de créditos nunca llegó a tener proveedor, y con NOT NULL ese INSERT muere después de devolver el crédito',
  proveedor_id VARCHAR(128) NULL COMMENT 'Id del mensaje en el proveedor',
  proveedor_lote_id VARCHAR(128) NULL COMMENT 'Id del despacho. Onurix devuelve dos ids y su consulta de estado solo acepta ÉSTE: con el del mensaje responde [] (medido el 12-ago-2026). Twilio deja esta columna en NULL',
  fallback_desde VARCHAR(20) NULL,
  estado ENUM('pendiente','aceptado','entregado','fallido','rechazado') NOT NULL DEFAULT 'pendiente',
  estado_proveedor VARCHAR(40) NULL COMMENT 'El estado tal como lo escribe el proveedor, sin traducir. Onurix usa palabras en español ("Enviado") y no documenta la lista; guardarlo crudo es como se aprende su vocabulario en vez de adivinarlo',
  error_codigo VARCHAR(32) NULL,
  error_mensaje VARCHAR(255) NULL,
  origen VARCHAR(64) NULL,
  lote_id VARCHAR(64) NULL,
  usuario_id BIGINT UNSIGNED NULL,
  consentimiento TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Ley 1581: se copia al momento del envío',
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_sms_destino (destino),
  INDEX idx_sms_estado (estado),
  INDEX idx_sms_lote (lote_id),
  INDEX idx_sms_fecha (creado_en),
  INDEX idx_sms_proveedor_id (proveedor_id),
  INDEX idx_sms_lote_proveedor (proveedor_lote_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Números que pidieron no recibir más mensajes POR FUERA de la aplicación:
-- una queja al operador, una solicitud de alguien que no está registrado.
-- La baja de una persona registrada NO va aquí: va en `no_contactar` de
-- votantes y usuarios, que es la lista que consulta el envío. Tener dos
-- listas que decidan lo mismo sería que una diga sí y la otra no.
CREATE TABLE IF NOT EXISTS sms_exclusiones (
  destino VARCHAR(20) PRIMARY KEY,
  motivo VARCHAR(128) NULL,
  origen VARCHAR(64) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Ajustes del canal que la campaña SÍ puede tocar. Las credenciales no están
-- aquí: van en configuracion_comunicaciones (las de la campaña) o en el .env
-- del servidor (la cuenta maestra).
CREATE TABLE IF NOT EXISTS sms_config (
  id TINYINT UNSIGNED PRIMARY KEY DEFAULT 1,
  firma VARCHAR(40) NULL COMMENT 'La firma que el proveedor agrega a cada mensaje por exigencia de la CRC. NO la escribe esta aplicación: se guarda para poder CONTAR lo que ocupa, porque le resta caracteres al segmento',
  firma_posicion ENUM('inicio','final') NOT NULL DEFAULT 'final',
  url_baja_base VARCHAR(255) NULL,
  forzar_gsm7 TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Quita tildes antes de enviar: una sola tilde baja el límite de 160 a 70 caracteres y puede triplicar el costo',
  horario_inicio TINYINT UNSIGNED NOT NULL DEFAULT 8,
  horario_fin TINYINT UNSIGNED NOT NULL DEFAULT 20,
  proveedor_preferido VARCHAR(20) NOT NULL DEFAULT 'onurix',
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_sms_config_unica CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO sms_config (id) VALUES (1);

-- ---------------------------------------------------------
-- Otros documentos fotografiados junto al reporte del Día D.
--
-- El E-14 sigue en `dia_d_reportes.foto_e14_url`: es UNO y es el acta que
-- importa. Esto es para lo demás —el acta de escrutinio, una reclamación, la
-- constancia de una novedad— y va en tabla aparte porque son VARIOS por
-- reporte y porque cada uno se ve por separado.
--
-- Sin FK a dia_d_reportes a propósito: el reporte puede llegar desde la cola
-- sin conexión horas después, y la fila de documento se inserta en la misma
-- transacción que él. Se borra en cascada desde el código.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS dia_d_reporte_documentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reporte_id INT NOT NULL,
  url VARCHAR(255) NOT NULL,
  descripcion VARCHAR(150) NULL COMMENT 'Lo que el testigo escribió: "acta de escrutinio", "reclamación"…',
  orden TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_doc_reporte (reporte_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS = 1;
