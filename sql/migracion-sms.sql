-- ============================================================================
-- MIGRACION SMS — Onurix como proveedor primario, Twilio como alterno
-- Estrategia Marketing Politico / appestrategia.net
--
-- ATENCION: este archivo tiene DOS bloques que van en BASES DE DATOS DISTINTAS.
--   BLOQUE 1 -> BD central de licencias.appestrategia.net
--   BLOQUE 2 -> BD de CADA campaña (repetir por cada tenant)
-- ============================================================================


-- ============================================================================
-- BLOQUE 1 — EJECUTAR EN LA BD CENTRAL (licencias)
-- Aqui vive el ledger de creditos. El cliente NO puede tocarlo.
-- ============================================================================

-- Cuota de creditos asignada a cada campaña
CREATE TABLE IF NOT EXISTS sms_cuota (
  campana_id            VARCHAR(64)   NOT NULL,
  creditos_asignados    INT UNSIGNED  NOT NULL DEFAULT 0,
  creditos_consumidos   INT UNSIGNED  NOT NULL DEFAULT 0,
  limite_diario         INT UNSIGNED  NOT NULL DEFAULT 0,   -- 0 = sin limite diario
  activo                TINYINT(1)    NOT NULL DEFAULT 1,
  notas                 VARCHAR(255)  NULL,
  creado_en             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                      ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (campana_id),
  CONSTRAINT chk_cuota_coherente CHECK (creditos_consumidos <= creditos_asignados)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Consumo por dia, para el limite diario
CREATE TABLE IF NOT EXISTS sms_consumo_diario (
  campana_id  VARCHAR(64)   NOT NULL,
  fecha       DATE          NOT NULL,
  creditos    INT UNSIGNED  NOT NULL DEFAULT 0,
  PRIMARY KEY (campana_id, fecha),
  KEY idx_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Movimientos del ledger: recargas, consumos, devoluciones, ajustes.
-- Esta tabla es la fuente de verdad para facturar y auditar.
CREATE TABLE IF NOT EXISTS sms_movimientos (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campana_id    VARCHAR(64)     NOT NULL,
  tipo          ENUM('recarga','consumo','devolucion','ajuste') NOT NULL,
  creditos      INT             NOT NULL,   -- positivo suma, negativo resta
  saldo_despues INT             NULL,
  referencia    VARCHAR(128)    NULL,       -- id de Onurix, factura, etc.
  detalle       VARCHAR(255)    NULL,
  usuario       VARCHAR(128)    NULL,       -- quien hizo el ajuste manual
  creado_en     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_campana_fecha (campana_id, creado_en),
  KEY idx_tipo (tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- BLOQUE 2 — EJECUTAR EN LA BD DE CADA CAMPAÑA
-- Bitacora de lo enviado. Sirve para auditoria, soporte y reporte al CNE.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sms_envios (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- Destino y contenido
  destino           VARCHAR(20)   NOT NULL,   -- normalizado: 573001234567
  contacto_id       BIGINT UNSIGNED NULL,     -- FK opcional a su tabla de contactos
  mensaje           TEXT          NOT NULL,
  segmentos         SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  codificacion      ENUM('gsm7','ucs2') NOT NULL DEFAULT 'gsm7',

  -- Proveedor
  proveedor         VARCHAR(20)   NOT NULL,   -- onurix | twilio
  proveedor_id      VARCHAR(128)  NULL,       -- id del mensaje en el proveedor
  fallback_desde    VARCHAR(20)   NULL,       -- si hubo respaldo, de cual vino

  -- Estado
  estado            ENUM('pendiente','aceptado','entregado','fallido','rechazado')
                    NOT NULL DEFAULT 'pendiente',
  error_codigo      VARCHAR(32)   NULL,
  error_mensaje     VARCHAR(255)  NULL,

  -- Contexto operativo
  origen            VARCHAR(64)   NULL,       -- 'testigos', 'coordinadores', 'sistema'
  lote_id           VARCHAR(64)   NULL,       -- agrupa un envio masivo
  usuario_id        BIGINT UNSIGNED NULL,     -- quien disparo el envio

  -- Consentimiento (Ley 1581) — se copia al momento del envio
  consentimiento    TINYINT(1)    NOT NULL DEFAULT 0,

  creado_en         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_destino (destino),
  KEY idx_estado (estado),
  KEY idx_lote (lote_id),
  KEY idx_fecha (creado_en),
  KEY idx_proveedor_id (proveedor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Lista de exclusion: numeros que pidieron no recibir mas mensajes.
-- Se consulta SIEMPRE antes de enviar. Es su defensa ante una queja.
CREATE TABLE IF NOT EXISTS sms_exclusiones (
  destino     VARCHAR(20)   NOT NULL,
  motivo      VARCHAR(128)  NULL,        -- 'solicitud web', 'reporte operador', etc.
  origen      VARCHAR(64)   NULL,
  creado_en   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (destino)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Configuracion del canal por campaña.
-- OJO: aqui NO van las credenciales de Onurix (esas son de la cuenta maestra,
-- viven en el .env del servidor). Aqui solo va lo que el cliente si puede tocar.
CREATE TABLE IF NOT EXISTS sms_config (
  id                    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  firma                 VARCHAR(40)   NULL,   -- prefijo identificador en el texto
  url_baja_base         VARCHAR(255)  NULL,   -- https://appestrategia.net/baja
  forzar_gsm7           TINYINT(1)    NOT NULL DEFAULT 1,
  horario_inicio        TINYINT UNSIGNED NOT NULL DEFAULT 8,   -- no enviar antes
  horario_fin           TINYINT UNSIGNED NOT NULL DEFAULT 20,  -- no enviar despues
  proveedor_preferido   VARCHAR(20)   NOT NULL DEFAULT 'onurix',
  actualizado_en        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                      ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT chk_config_unica CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO sms_config (id, forzar_gsm7) VALUES (1, 1);
