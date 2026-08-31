-- ============================================================
-- 03_declarado.sql — Modo declarado: captura manual con validación
-- Aplicar DESPUÉS de 01_schema.sql y 02_geocode.sql
--
-- Cambio de enfoque: se elimina la dependencia del lector 2D. El líder digita
-- la cédula que le dicta el ciudadano. Como la cédula colombiana NO tiene dígito
-- de verificación, un número mal digitado es indetectable por sí solo; la
-- validación es estadística y probabilística, nunca determinística.
--
-- PRINCIPIO: el validador ADVIERTE, no rechaza. Solo se bloquea por formato
-- imposible. Existen cédulas fuera de todo patrón (nacionalizados, reposiciones,
-- expediciones tardías) y bloquear a un ciudadano real es peor error que admitir
-- un registro dudoso marcado como tal.
-- ============================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- Tabla de cohortes: rango de cédula -> distribución de año de nacimiento.
-- Se autocalibra desde los propios registros capturados.
-- Ver scripts/calibrar_cohortes.js
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cedula_cohorte (
  bucket_ini      BIGINT UNSIGNED NOT NULL,   -- límite inferior del rango de cédula
  bucket_fin      BIGINT UNSIGNED NOT NULL,
  anio_p05        SMALLINT UNSIGNED NULL,     -- percentil 5 del año de nacimiento
  anio_p50        SMALLINT UNSIGNED NULL,
  anio_p95        SMALLINT UNSIGNED NULL,
  sexo_dominante  ENUM('M','F','MIXTO') NULL, -- la serie antigua se asignaba por sexo
  sexo_pct        DECIMAL(4,3) NULL,          -- proporción del sexo dominante
  n_muestras      INT UNSIGNED NOT NULL DEFAULT 0,
  fuente          ENUM('capturado','padron_importado','manual') NOT NULL DEFAULT 'capturado',
  calibrado_en    DATETIME NULL,
  PRIMARY KEY (bucket_ini),
  KEY ix_cohorte_rango (bucket_ini, bucket_fin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Resultado de validación en el ciudadano
-- ------------------------------------------------------------

ALTER TABLE ciudadano
  ADD COLUMN validacion_nivel ENUM('ok','advertencia','sin_validar')
      NOT NULL DEFAULT 'sin_validar' AFTER parser_confianza,
  ADD COLUMN validacion_senales JSON NULL AFTER validacion_nivel,
  -- Confirmación de doble digitación de los últimos 4 dígitos por parte del líder
  ADD COLUMN doble_digitacion TINYINT(1) NOT NULL DEFAULT 0 AFTER validacion_senales,
  -- Verificación diferida contra censo del partido, cuando llegue
  ADD COLUMN censo_verificado TINYINT(1) NOT NULL DEFAULT 0 AFTER doble_digitacion,
  ADD COLUMN censo_verificado_en DATETIME NULL AFTER censo_verificado,
  ADD COLUMN censo_discrepancia JSON NULL AFTER censo_verificado_en,
  ADD KEY ix_ciudadano_validacion (campana_id, validacion_nivel),
  ADD KEY ix_ciudadano_censo (campana_id, censo_verificado);

-- ------------------------------------------------------------
-- Evidencia opcional: foto del documento.
-- Tabla aparte porque son blobs grandes y se purgan antes que el resto.
-- NO se usa para OCR automático: es respaldo auditable cuando un registro
-- se disputa entre líderes.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS evidencia_registro (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ciudadano_id    BIGINT UNSIGNED NOT NULL,
  tipo            ENUM('foto_documento','foto_persona') NOT NULL,
  ruta_archivo    VARCHAR(400) NOT NULL,      -- en disco, no en la base
  sha256          BINARY(32) NOT NULL,
  capturado_en    DATETIME NOT NULL,
  purgado_en      DATETIME NULL,
  PRIMARY KEY (id),
  KEY ix_evidencia_ciudadano (ciudadano_id),
  CONSTRAINT fk_evidencia_ciudadano FOREIGN KEY (ciudadano_id)
    REFERENCES ciudadano (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Nuevos resultados posibles de una captura
-- ------------------------------------------------------------

ALTER TABLE captura_evento
  MODIFY COLUMN resultado ENUM(
    'nuevo',
    'duplicado_mismo_lider',
    'duplicado_otro_lider',
    'parser_fallido',                 -- se conserva por compatibilidad histórica
    'formato_invalido',               -- cédula imposible: bloqueo duro
    'guardado_con_advertencia',       -- señales de riesgo, se guarda y se marca
    'rechazado_sin_consentimiento'
  ) NOT NULL,
  ADD COLUMN validacion_senales JSON NULL AFTER parser_confianza;

-- ------------------------------------------------------------
-- Cola de auditoría de calidad de captura
-- ------------------------------------------------------------

CREATE OR REPLACE VIEW v_calidad_captura AS
SELECT
  l.campana_id,
  l.id                AS lider_id,
  l.nombre            AS lider,
  COUNT(*)                                                     AS intentos,
  SUM(e.resultado = 'nuevo')                                   AS nuevos,
  SUM(e.resultado = 'guardado_con_advertencia')                AS con_advertencia,
  SUM(e.resultado = 'formato_invalido')                        AS formato_invalido,
  SUM(e.resultado = 'duplicado_otro_lider')                    AS choques_con_otros,
  SUM(e.resultado = 'duplicado_mismo_lider')                   AS repetidos_propios,
  ROUND(SUM(e.resultado IN ('guardado_con_advertencia','formato_invalido'))
        / NULLIF(COUNT(*), 0) * 100, 2)                        AS pct_problematico
FROM captura_evento e
JOIN lider l ON l.id = e.lider_id
GROUP BY l.campana_id, l.id, l.nombre;
