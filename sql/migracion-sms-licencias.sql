-- ============================================================================
-- MIGRACION SMS — BLOQUE 1 de 2:  BASE CENTRAL DE LICENCIAS  (licenciasdb)
-- Estrategia Marketing Politico / appestrategia.net
--
-- Aqui vive el LEDGER de creditos. La campaña no puede editarselo: por eso
-- esta en otra base y por eso la cuenta que usa campana-app tiene permiso
-- de UPDATE solo sobre la columna del consumo (ver usuario-sms-ledger.sql).
--
-- COMO EJECUTARLO (no necesita root: licenciasuser tiene ALL sobre esta base)
--   mysql -h 127.0.0.1 -P 3306 -u licenciasuser -p licenciasdb < sql/migracion-sms-licencias.sql
--
-- ORDEN: este bloque va ANTES de crear el usuario del ledger. MySQL exige
-- que la tabla exista para conceder un permiso a nivel de tabla.
--
-- COLACION: utf8mb4_0900_ai_ci, la de las 9 tablas que ya tiene licenciasdb.
-- El archivo original traia utf8mb4_unicode_ci, que habria hecho fallar
-- cualquier JOIN de campana_id contra instalaciones con "Illegal mix of
-- collations". (La colacion POR DEFECTO de la base es utf8mb4_general_ci y
-- no coincide con sus propias tablas, asi que aqui va explicita.)
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Consumo por dia, para el limite diario
CREATE TABLE IF NOT EXISTS sms_consumo_diario (
  campana_id  VARCHAR(64)   NOT NULL,
  fecha       DATE          NOT NULL,
  creditos    INT UNSIGNED  NOT NULL DEFAULT 0,
  PRIMARY KEY (campana_id, fecha),
  KEY idx_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------------------------------------------------------
-- Para deshacer este bloque (no hay datos de otra cosa aqui):
--   DROP TABLE IF EXISTS sms_movimientos, sms_consumo_diario, sms_cuota;
-- ----------------------------------------------------------------------------
