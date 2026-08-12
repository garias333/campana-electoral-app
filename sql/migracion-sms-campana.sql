-- ============================================================================
-- MIGRACION SMS — BLOQUE 2 de 2:  BASE DE CADA CAMPAÑA
-- Estrategia Marketing Politico / appestrategia.net
--
-- Bitacora de lo enviado, lista de exclusion y configuracion del canal.
-- Se repite en CADA base de campaña (electoraldb, campanadepruebamunicipal,
-- campanadepruebadepartamental, y las que vengan).
--
-- COMO EJECUTARLO (con el usuario de la propia campaña)
--   mysql -h 127.0.0.1 -P 3306 -u electoraluser -p electoraldb < sql/migracion-sms-campana.sql
--
-- OJO, PENDIENTE DE FONDO: mientras esto sea un .sql que se corre a mano,
-- una campaña NUEVA nacera sin estas tablas — el esquema de una campaña se
-- crea con db/init-db.js, y generar-parche.js rechaza los .sql fuera de db/.
-- Lo correcto es que estas tres tablas terminen en db/init-db.js (y en
-- db/schema.sql) para que viajen por el mecanismo de parches. Ver punto 6.
--
-- COLACION: utf8mb4_0900_ai_ci, la de 29 de las 31 tablas de electoraldb.
-- El archivo original traia utf8mb4_unicode_ci: cualquier JOIN de
-- sms_envios.destino contra usuarios.telefono o votantes.telefono habria
-- fallado con "Illegal mix of collations".
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
  --
  -- NULL a proposito: hay tres caminos que registran el mensaje SIN haber
  -- elegido proveedor —numero en la lista de exclusion, creditos agotados y
  -- limite diario alcanzado—. Con NOT NULL, esos tres INSERT mueren con
  -- ER_BAD_NULL_ERROR *despues* de devolver el credito, y quien llame recibe
  -- una excepcion en vez de un rechazo legible. Encontrado ejecutandolo, no
  -- leyendolo: un mensaje que nunca se intento no tiene proveedor.
  proveedor         VARCHAR(20)   NULL,       -- onurix | twilio | NULL si no se intento
  proveedor_id      VARCHAR(128)  NULL,       -- id del mensaje en el proveedor
  -- Onurix devuelve DOS identificadores: el del mensaje (data.id) y el del
  -- despacho (id, que su consulta de estado llama dispatch_id). Se guardan
  -- los dos porque su documentacion no dice cual acepta /messages-state, y
  -- una consulta con el del mensaje devolvio [] — probado el 12 de agosto de
  -- 2026. Guardar solo uno deja los mensajes ya enviados sin forma de
  -- consultarlos nunca. Twilio deja esta columna en NULL: solo tiene un SID.
  proveedor_lote_id VARCHAR(128)  NULL,       -- id del despacho en el proveedor
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- Lista de exclusion: numeros que pidieron no recibir mas mensajes.
-- Se consulta SIEMPRE antes de enviar. Es su defensa ante una queja.
--
-- OJO: la app ya tiene otra baja de contacto — las columnas no_contactar /
-- no_contactar_fecha / no_contactar_origen en votantes y usuarios (parche 14).
-- Son dos listas para lo mismo. Unificarlas es parte del punto 6; mientras
-- tanto, un numero dado de baja en el CRM NO esta en sms_exclusiones.
CREATE TABLE IF NOT EXISTS sms_exclusiones (
  destino     VARCHAR(20)   NOT NULL,
  motivo      VARCHAR(128)  NULL,        -- 'solicitud web', 'reporte operador', etc.
  origen      VARCHAR(64)   NULL,
  creado_en   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (destino)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO sms_config (id, forzar_gsm7) VALUES (1, 1);

-- ----------------------------------------------------------------------------
-- Para deshacer este bloque:
--   DROP TABLE IF EXISTS sms_config, sms_exclusiones, sms_envios;
-- ----------------------------------------------------------------------------
