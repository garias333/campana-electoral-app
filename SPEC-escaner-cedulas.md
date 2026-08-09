# SPEC — Módulo de Captura Territorial (modo declarado)

> Documento de traspaso para Claude Code. Copiar a la raíz del repo como `CLAUDE.md`
> o mantener en `docs/` y referenciarlo al abrir la sesión.

## 0. Contexto para el agente

Proyecto de Estrategia Marketing Político (INGESES S.A.S.). Se integra a la plataforma
de campaña existente (`electoral.appestrategia.net`) y consume el catálogo territorial
de INIT/CTC (`territorios.appestrategia.net`).

Stack: Node.js + Express + MySQL 8, VPS Hostinger (Ubuntu 24.04), CloudPanel, PM2, nvm.

**Convenciones del entorno que NO se deben violar:**
- `DB_HOST=127.0.0.1`, nunca `localhost` (fuerza socket unix y rompe la conexión).
- Contraseñas con `#` en `.env` van entre comillas dobles.
- Para recargar variables de entorno: `pm2 delete <app> && pm2 start <app> && pm2 save`.
  `pm2 restart` **no** relee el `.env`.
- CloudPanel elimina guiones bajos de los nombres de base de datos.
- Antes de depurar un despliegue, verificar que el código llegó: `grep -c <marcador> <archivo>`.

## 1. Alcance

Capturar ciudadanos en terreno mediante **digitación manual** por parte del líder,
validar la coherencia de los datos declarados, asociarlos a su puesto de votación
normalizado, y medir cobertura contra el potencial electoral de cada puesto.

**DECISIÓN DE ARQUITECTURA — leer antes de proponer alternativas.**
Se descartó el escaneo por lector 2D: no es viable entregar hardware a cada líder o
auxiliar de captura. El líder digita el número que le dicta el ciudadano.

En consecuencia, **no existe autocompletado de nombre ni de puesto de votación a partir
del número de cédula**. No hay fuente consultable para eso: el nombre lo tiene la
Registraduría o un proveedor de validación con contrato y costo por consulta; el puesto
solo la Registraduría. El sistema opera en *modo declarado*: el ciudadano dicta sus datos,
el líder los digita, y el sistema valida coherencia interna.

Cuando la campaña obtenga el aval y con él el censo electoral (Ley 1475 de 2011, art. 47),
se importa a base local y **entonces sí** hay autocompletado offline por número de cédula.
Ese importador es fase posterior; el esquema ya lo contempla (`puesto_fuente='censo_partido'`,
`ciudadano.censo_verificado`).

**Dentro del alcance:** validador de cédula digitada, esquema de datos, consentimiento
versionado, ingesta DIVIPOL, geocodificación, PWA offline, deduplicación entre líderes,
autocalibración de cohortes, tablero de cobertura.

**Fuera del alcance (no implementar):**
- Scraping del consultor de puesto de votación de la Registraduría.
- Cualquier forma de "autocompletar el nombre desde la cédula" sin censo importado.
  Si aparece esta necesidad, la respuesta es el importador de censo, no un scraper.
- Validación de identidad contra fuentes oficiales. Requiere convenio o proveedor pago.
- Lectura de PDF417 / NFC. Descartada.

## 2. Archivos entregados

| Archivo | Estado |
|---|---|
| `db/01_schema.sql` | Completo. Aplicar primero. |
| `db/02_geocode.sql` | Completo. Aplicar segundo. |
| `db/03_declarado.sql` | Completo. Aplicar tercero. |
| `lib/validarCedula.js` | Completo y probado. |
| `lib/cedulaCrypto.js` | Completo. |
| `scripts/divipol_loader.js` | Funcional, **ajustar nombres de tablas CTC** (ver §4). |
| `scripts/geocode_puestos.js` | Funcional, **ajustar `syncRef()` a CTC** (ver §4-bis). |
| `scripts/calibrar_cohortes.js` | Completo. Correr por cron semanal. |

`lib/parseCedulaCO.js` queda **obsoleto**. No usar ni mantener.

## 3. TAREA 1 — Validación de cédula digitada

`lib/validarCedula.js` ya está implementado y probado. La tarea es integrarlo.

**La cédula colombiana no tiene dígito de verificación.** Un número mal digitado es
sintácticamente indistinguible de uno correcto. La validación es estadística.

**Regla que no se debe alterar:** el validador ADVIERTE, no rechaza. Solo hay bloqueo por
formato imposible y por doble digitación no coincidente. Existen cédulas legítimas fuera
de todo patrón (nacionalizados, reposiciones, expediciones tardías). Impedirle registrarse
a un ciudadano real es peor error que admitir un registro dudoso marcado como tal.

Niveles de retorno:
- `bloqueo` — no se guarda. Formato imposible o confirmación de últimos 4 fallida.
- `advertencia` — **sí se guarda**, con `validacion_nivel='advertencia'` y las señales en
  `validacion_senales`. El líder ve el mensaje y puede corregir o continuar.
- `ok` — se guarda normalmente.

Autocalibración: `cedula_cohorte` arranca vacía y el validador opera solo con reglas de
formato, que es el comportamiento correcto. Al acumular capturas, `calibrar_cohortes.js`
construye buckets de frecuencia igual y activa la validación cohorte y sexo-serie por
bucket, cuando cada uno supera 40 muestras.

Programar cron semanal:
```
0 3 * * 1 cd <ruta_app> && node scripts/calibrar_cohortes.js >> logs/cohortes.log 2>&1
```

Criterio de aceptación: suite de pruebas en `test/validarCedula.test.js` cubriendo
formato inválido, doble digitación fallida, cohorte inconsistente en ambas series
(antigua y nueva), menor de edad, y nombres de relleno.

## 4. TAREA 2 — Ingesta DIVIPOL

1. Ajustar en `scripts/divipol_loader.js` la función `cargarDaneDesdeCTC()` y la consulta
   de `ctc_departamento` a los nombres reales de tabla/columna de INIT/CTC.
2. Descargar el directorio de puestos por departamento desde el portal público de la
   Registraduría (`wapp.registraduria.gov.co`, consulta de puestos de votación).
   Empezar por Antioquia (05) y Caldas (17).
3. Correr con `--dry-run` primero. Revisar el listado de `sin_match`.
4. Resolver manualmente los `sin_match` en `divipol_municipio` y marcar `match_revisado=1`
   para que reejecuciones del loader no los pisen.
5. Cargar y verificar: cada municipio de Antioquia y Caldas debe tener `cod_dane_mpio`.

Criterio de aceptación: 0 municipios con `match_metodo='sin_match'` y `match_revisado=0`
en los departamentos 05 y 17.

## 4-bis. TAREA 2b — Geocodificación de puestos

Aplicar `db/02_geocode.sql`. Luego:

1. Ajustar `syncRef()` en `scripts/geocode_puestos.js` a los nombres reales de tabla y
   columna de INIT/CTC (`ctc_municipio`, `ctc_territorio`). Requiere que CTC tenga
   centroides de municipio, cabecera, corregimiento y vereda.
2. `node scripts/geocode_puestos.js --sync-ref`
3. `node scripts/geocode_puestos.js --depto 05 --dry-run` — revisar las consultas de
   ejemplo y el costo estimado antes de gastar cuota.
4. `node scripts/geocode_puestos.js --depto 05 --provider google`
5. Repetir con `--depto 17`.
6. Revisar `v_geocode_revision` (ordenada por potencial descendente) y corregir a mano
   los puestos grandes que quedaron en centroide. Marcar `geocode_fijado=1` al corregir.

Reglas que no se deben relajar:
- Todo resultado de geocodificador externo pasa validación territorial. Si cae fuera del
  radio del municipio se descarta y se baja al siguiente nivel de la cascada. **Nunca**
  aceptar una coordenada sin validar, aunque el proveedor reporte alta confianza.
- El nivel N3 (topónimo contra CTC) solo acepta match **único**. Dos veredas homónimas
  en el mismo municipio → no se resuelve, baja a centroide.
- El script es reanudable: `geocode_cache` evita repagar consultas. Si aborta por
  `OVER_QUERY_LIMIT`, basta reejecutar el mismo comando.

Criterio de aceptación: en Antioquia y Caldas, ningún puesto con potencial > 2.000 debe
quedar en `centroide_mpio` o `centroide_cabecera`.

## 5. TAREA 3 — API de captura

`POST /api/captura`

```json
{
  "uuid_cliente": "uuid v4 generado en el dispositivo",
  "campana_id": 1,
  "lider_id": 12,
  "datos": {
    "cedula": "1053812445",
    "confirmacion_ultimos4": "2445",
    "primerNombre": "ANA", "segundoNombre": "MARIA",
    "primerApellido": "GOMEZ", "segundoApellido": "RUIZ",
    "sexo": "F",
    "fechaNacimiento": "1993-05-02",
    "telefono": "3001234567"
  },
  "puesto_id": 4471,
  "mesa": "07",
  "consentimiento": {
    "aviso_version": "1.0",
    "fin_contacto": true, "fin_sms_whatsapp": true, "fin_afinidad_pol": false,
    "firma_png_b64": "...",
    "otorgado_en": "2026-08-08T14:22:00-05:00"
  },
  "geo": { "lat": 6.2442, "lng": -75.5812 },
  "ocurrido_en": "2026-08-08T14:22:03-05:00",
  "forzar_advertencia": false
}
```

Orden de operaciones **obligatorio**:

1. Verificar `uuid_cliente` en `sync_idempotencia`. Si existe, responder 200 con el
   resultado previo. Sin esto, un reintento de red duplica registros.
2. Cargar `cedula_cohorte` (cachear en memoria, refrescar cada hora; no consultarla por
   cada captura).
3. `validarCedula(datos, tablaCohorte)`.
   - `bloqueo` → `captura_evento` con `resultado='formato_invalido'`, responder 422 con
     `mensajes`. No se guarda nada.
   - `advertencia` y `forzar_advertencia` es `false` → responder 409 con `mensajes` y
     `senales`, para que el líder confirme con el ciudadano. No se guarda todavía.
   - `advertencia` y `forzar_advertencia` es `true` → continuar, guardando
     `validacion_nivel='advertencia'` y `validacion_senales`.
   - `ok` → continuar.
4. Si falta consentimiento → `resultado='rechazado_sin_consentimiento'`, responder 403.
   No se guarda el ciudadano. El consentimiento es previo al tratamiento, no posterior.
5. `hashCedula()` → buscar en `ciudadano` por `(campana_id, cedula_hash)`.
   - Existe y mismo `lider_id` → `duplicado_mismo_lider`, 200 informativo.
   - Existe y otro líder → `duplicado_otro_lider`, 409, devolver el nombre del líder
     previo. **Este es el control antifraude principal del sistema; no debilitarlo.**
   - No existe → insertar con `fuente_captura='manual'`.
6. Insertar `consentimiento` en la misma transacción que `ciudadano`.
7. Registrar `captura_evento` siempre, incluidos los rechazos y las advertencias
   (`resultado='guardado_con_advertencia'`).
8. Registrar `sync_idempotencia`.

Restricción: `fin_afinidad_pol` no puede ser condición para completar el registro. La
orientación política es dato sensible y su autorización debe ser separable.

## 6. TAREA 4 — PWA de captura

- Offline-first con IndexedDB y cola de sincronización. **No negociable**: en veredas de
  Antioquia y Caldas no hay señal y el registro presencial se cae si depende de conexión.
- **`cedula_cohorte` se descarga al dispositivo** para validar sin conexión. Son pocas
  filas; cabe sin problema. Refrescar al sincronizar.
- Campo de cédula: `inputmode="numeric"`, acepta puntos y espacios, normaliza al salir.
- **Doble digitación:** tras el número completo, un segundo campo pide los últimos 4
  dígitos. No mostrar el número original mientras se reconfirma. Cuesta dos segundos y
  elimina la mayoría de errores de tecleo.
- Validación en el dispositivo antes de encolar: las advertencias se muestran de
  inmediato, no al sincronizar horas después cuando el ciudadano ya no está presente.
- Ante advertencia: diálogo con el mensaje y dos opciones, "Corregir" y "Confirmar y
  guardar". La segunda envía `forzar_advertencia: true`.
- Selector de puesto en cascada: departamento → municipio → puesto → mesa, contra
  `divipol_puesto`. Nunca campo de texto libre.
- Foto del documento opcional, como evidencia auditable. No se hace OCR sobre ella.
- Firma de consentimiento en `<canvas>`, exportada como PNG.
- Indicador visible de registros pendientes de sincronizar.

## 7. TAREA 5 — Tablero de cobertura

Base: vista `v_cobertura_puesto`.

- Mapa Leaflet con puestos coloreados por `pct_cobertura` (reutilizar la paleta de
  semáforo de `mapamanizales`).
- Tabla por líder: registros nuevos, duplicados intentados, ratio. El ratio de duplicados
  es el indicador de inflación de cifras.
- Cruce con `divipol_potencial` de ciclos anteriores para meta por mesa.
- Panel de calidad de captura desde `v_calidad_captura`: `pct_problematico` por líder.
  Un líder con tasa de advertencias muy por encima del promedio necesita capacitación
  o revisión, no sanción automática.

## 8. Cumplimiento — requisitos no negociables

- Aviso de privacidad versionado y publicado antes de la primera captura.
- Nunca persistir minucias dactilares.
- Cifrado en reposo del número de cédula. Nunca en texto plano en MySQL ni en logs.
- Retención: fijar `campana.purga_programada` al crear la campaña y ejecutar el borrado.
- Contrato de transmisión de datos con cada campaña cliente (INGESES es Encargado,
  la campaña es Responsable).
- Endpoint de revocación de autorización: `POST /api/consentimiento/:id/revocar`.
- Los datos son **declarados por el ciudadano**, no verificados contra fuente oficial.
  No presentarlos ante terceros como verificados. Al llegar el censo del partido, la
  verificación diferida marca `censo_verificado` y registra discrepancias.

## 9. Orden de ejecución sugerido

1. Aplicar `db/01_schema.sql`, `db/02_geocode.sql`, `db/03_declarado.sql`
2. TAREA 2 (DIVIPOL Antioquia + Caldas)
3. TAREA 2b (geocodificación)
4. TAREA 1 (integrar validador) — ya no es bloqueante
5. TAREA 3 (API)
6. TAREA 4 (PWA)
7. TAREA 5 (tablero)
8. Fase posterior: importador de censo electoral, cuando llegue el aval

Ya no hay tarea bloqueante: se puede empezar por DIVIPOL de inmediato.
