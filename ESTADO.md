# ESTADO — electoral

> Bitácora de handoff entre máquinas. La escribe `/cierre` al final de cada
> sesión y el hook de apertura la inyecta automáticamente al iniciar.
> El contexto permanente (arquitectura, puertos, reglas de despliegue) va en
> CLAUDE.md, no aquí.

## Anclas verificables

*Medidas el 6 de noviembre de 2026 a las ~20:05 desde la cuenta `gariasappelectoral`,
que NO puede leer las otras instalaciones ni la tabla `parches_disponibles`: lo que
dependa de ellas dice «no medido». Las anclas de agosto (parche 249, `v121`, «Árbol
limpio») estaban obsoletas y se reemplazaron.*

- **Último parche generado: 272** (`parches/campana-parche272.zip`, 138.099 bytes,
  sha256 `f4333fcb6a8217d0f3dbac7bbf3c2bafe6dcd566e3d22888c18e1b92e37496b1`, 11 archivos).
  **Publicado** en la carpeta de licencias (`parche-272.zip`, 21:31, mismo sha256, 0644) y
  **registrado y firmado, INACTIVO**, con `toca_base_datos = true` (lo marcó solo el servidor de
  licencias: respuesta `{"ok":true,"numero_parche":272,…,"toca_base_datos":true}`). Es el
  **Día D fase 1** (detalle abajo). El 271 (163.478 bytes, sha256 `983dcbea…`, 12 archivos) y los
  zip 265 a 270 también están publicados; los de 265 a 271 coinciden en tamaño con los locales.
  **Distribución del 272: NO MEDIDA, y hay que fijarla ANTES de activarlo.** `registrar-parche.js`
  no manda `modo_distribucion` y la columna nace en «todos» (pendiente 9 de abajo): en el panel hay
  que ponerlo en «seleccionadas» y marcar solo las campañas elegidas.
- **Registrado / activo / aplicado en las campañas: NO MEDIDO.** Hay que mirar
  `.version-parche` y `logs/actualizaciones.log` de municipal, departamental y c001-2027
  (bloque d) del traspaso, abajo). En la Base, `.version-parche` y `.version-base` = **272**
  (la Base no recibe parches: los genera). El 272 no se ha activado ni aplicado a ninguna campaña.
- **Service worker:** `estrategia-v146` en el código de la Base y dentro del 272 (subió de
  `v145`, que fue el del 271, para que los celulares recojan `app/dia-d.html` y `dia-d.html`).
  Cada campaña lo tendrá cuando reciba el 272.
- **La Base corre el código del 271.** Su proceso (`app.js`, pid 2883929) arrancó a las
  19:18:41, después de la última edición de código de ejecución (19:07:07). Su `.env` tiene
  `TELEGRAM_BOT_TOKEN` y `TELEGRAM_SUPERADMIN_CHAT_ID` con valor (solo se comprobó que no
  estén vacías) y **no** tiene `APP_NOMBRE`: el mensaje dice «Estrategia | App electoral». El
  registro de PM2 muestra **un** «Telegram OK» y ningún «Telegram falló».
- **Plantilla: sigue en v271 y NO lleva el Día D fase 1** (no se regeneró al armar el 272, por
  orden expresa). Para una campaña nueva hay que regenerarla con `--parche 272` (y `--forzar`
  si hace falta) antes de usarla. Del 271: `backups/plantillas/plantilla-nueva-campana-v271.zip`, 194 archivos,
  sha256 `c11c9904876be5bda0fcdf4542488cd4b667b6adbc68b83990b72fa85cec576d`, escaneo de
  secretos en 0. **Quedó desactualizada** por el commit `39b18eb` (su `init-db.js` todavía
  imprime la contraseña del admin y su LEEME no explica los dos archivos de credenciales):
  hay que regenerarla con `--forzar` antes de usarla.
- **`scripts/comparar-instancias.js`** (medido el 31 de agosto, NO re-medido): 137 archivos,
  1 sola diferencia en cada campaña — `scripts/calibrar_cohortes.js`, que existe solo allí;
  el sistema de parches no sabe borrar (`unzip -o`).
- **Rama:** `auditoria-fable`, publicada en GitHub (ver «Remoto» abajo). Árbol: `legislacion/`
  y dos guiones sin versionar (`scripts/respaldar-base-instalacion.sh`,
  `scripts/verificar-parche264.sh`; ya no viajan en plantillas, ver abajo). `CLAUDE.md`
  quedó commiteado (`0c2311a`, «notas de sesión»: el puerto de escucha, 4200 → 3005).

## Parche 272 — Día D fase 1 (6 de noviembre de 2026, INACTIVO)

Zip de 11 archivos: `app.js`, `config/verificarEsquema.js`, `db/init-db.js`, `db/schema.sql`,
`middleware/upload.js`, `public/app/dia-d.html`, `public/dia-d.html`, `public/service-worker.js`
(`v146`), `routes/diaD.routes.js`, `scripts/limpiar-fotos-dia-d.js` y `.version-base` (272).
Commits que recoge: `868e22f`, `e102ab9` (Día D) y `39b18eb` (clave del admin inicial en
`.credenciales-admin.txt`, que viaja porque está dentro de `db/init-db.js`). Los demás commits
posteriores al 271 (`3ab4ddf`, `2f1ce57`, `90b5948`, `9cb3e25`, `8dfca61`, `0c2311a`) son de
documentación y herramientas de la plantilla: no viajan.

- **Verificado sobre el zip:** los 11 archivos coinciden por md5 con el disco; no trae `.env`,
  `.credenciales-*`, `uploads/`, `legislacion/` ni `backups/`; `CACHE_NAME = 'estrategia-v146'`;
  contiene `dia_d_reportes.alertas` en `verificarEsquema.js`, `idx_diad_foto_url`,
  `cerrarFotosDelDiaD` y `GET_LOCK`.
- **`scripts/limpiar-fotos-dia-d.js` SÍ viaja en el 272** (decisión de Gildardo). La plantilla,
  en cambio, no lo lleva todavía.
- **Qué hace:** el testigo solo reporta su mesa (403 si no es suya; 400 si la mesa no está entre 1 y
  la cantidad de mesas del puesto); el testigo asignado siempre puede reemplazar su mesa; un envío
  a la vez por mesa (`GET_LOCK`); alertas que pone el servidor (`suma_distinta`, `fuera_de_lista`,
  `enviado_por_staff`, `puesto_sin_mesas`) sin rechazar, con filtro «Solo con alertas» en el
  tablero; fotos nuevas en `uploads/dia-d/`, servidas solo por
  `/api/dia-d/reportes/:id/foto` y `/documentos/:docId` (testigo dueño, o admin/coordinador/aspirante
  dentro de `acotaJornada`; acepta `X-Device-Token`); `/uploads/dia-d` cerrado y, en la raíz de
  `uploads/`, solo se niegan los archivos que figuren en un reporte del Día D (si la consulta falla,
  503); borrar un reporte borra sus archivos y sus filas de documentos; en el celular: «Subir foto»
  si la cámara falla, Reintentar/Descartar en reportes fallidos, foto de máximo 2400 px a JPEG 0,85.
- **Gildardo lo probó en la Base (navegador y celular) y le funcionó.** Las campañas no.
- **TOCA LA BASE y es obligatorio:** `init-db` agrega `dia_d_reportes.alertas` y dos índices.
  `verificarEsquema.js` exige la columna: **una campaña que reciba el 272 sin correr `npm run init-db`
  no arranca.** El actualizador corre `init-db` solo si el registro dice `toca_base_datos` — y dice que sí.
- **Fotos viejas:** las anteriores al 272 siguen en la raíz de `uploads/`; el filtro las cierra por
  la base, pero el script de limpieza no las toca (un archivo de la raíz sin referencia en el Día D
  puede ser un comprobante de finanzas).

## Parches 266 a 271 (6 de noviembre de 2026) y lo que vino después

| Parche | Hora del zip | Qué trae (según `git log` entre cada «Parche N: .version-base») |
|---|---|---|
| 266 | 13:19 | Sección Legislación: módulo con permiso, lista desde `legislacion/`, vista PWA con Ver/Descargar por token de dispositivo. SW `v134`. |
| 267 | 14:55 | Copia automática de `legislacion/` desde la carpeta central; calendario electoral, buscador dentro de los PDF y tarjetas con epígrafe; periodos en «En curso», pestañas cortas en celular y página del artículo. SW `v135`. |
| 268 | 16:10 | Panel general atado al permiso `panel_general` y sin finanzas para quien no las administra. |
| 269 | 17:11 | App del celular para administradores (Panel, Votantes, Mapa, Compartir), menú en el orden pedido (SW `v137`), Estructura territorial en modo app, Calendario del celular apilado en Cumplidas / En curso / Próximas. |
| 270 | 18:27 | App del admin: lista de Estructura y formulario por pasos; formularios por pasos (lugar de votación antes de la cédula, micrófono, aviso del nombre); registro de votante o sublíder en 4 pasos; copiado automático de la cédula (también en Votantes y Testigos de escritorio). |
| 271 | 19:24 | Código de ingreso del superadmin por Telegram, 2FA obligatorio y sin interruptor; SW `v145`. Archivos: `config/{mailer,superadmin,superadminCorreo,telegram}.js`, `db/init-db.js`, `routes/{auth,usuarios}.routes.js`, `public/{configuracion.html,js/common.js,service-worker.js}`, `scripts/limpiar-copias-env.sh`, `.version-base`. **Toca `db/`**: el actualizador corre `init-db`. `.env.example` NO entra (el generador rechaza todo `.env.*`). |

*Dónde está aplicado:* en la **Base**, todos (271; el 272 está en su código y solo en el zip, ver arriba). En las **campañas**, no medido (ver arriba).

### Superadmin: siempre con código, y por Telegram (parche 271)

- El código de ingreso del superadmin (`correo@gildardoarias.com`, o `SUPERADMIN_EMAIL`) sale
  por el canal de siempre **y** por Telegram, en paralelo (`Promise.allSettled`). Texto:
  «Código de ingreso a `<APP_NOMBRE>`: 123456. Vence en 10 minutos.». En el 2FA tras clave solo
  responde 500 si no salió ninguno. Para los demás usuarios nada cambia ni se nota.
- Variables: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_SUPERADMIN_CHAT_ID` (`config/telegram.js`; sin una
  de las dos no hace nada y devuelve `false`), `APP_NOMBRE` (el nombre del mensaje) y
  `SUPERADMIN_TELEFONO` (por omisión 3104157434). El log nunca lleva token, chat ni URL.
- Se ponen con **`scripts/poner-telegram-env.sh <ruta del .env>`** (como root; pide sin mostrar;
  no duplica líneas). Después, `bash scripts/reiniciar-instancia.sh <usuario>`: `pm2 restart`
  no relee el `.env`. El bot necesita un `/start` previo de Gildardo.
- `init-db` crea al superadmin con `two_factor_enabled = 1` y el celular, y `asegurarSuperadmin`
  (cada corrida) los garantiza en cuentas existentes sin pisar un teléfono puesto.
  `PUT /auth/2fa` y `POST /usuarios/:id/desactivar-2fa` responden 400 «El código de ingreso es
  obligatorio para esta cuenta.»; el interruptor del perfil sale encendido y deshabilitado.
- **Riesgo conocido:** con el 2FA forzado, si el correo de una campaña no funciona y todavía no
  tiene Telegram, el superadmin no entra. Probar el correo antes y poner las variables enseguida.

### Después del 271 (en la Base, SIN parche)

- `2f1ce57`: la plantilla ya no lleva `verificar-parche*.sh`, `comparar-parche*.sh` ni
  `respaldar-base-instalacion.sh` (por patrón); `probar-instalacion-limpia.js` comprueba que el
  superadmin nazca con 2FA y celular y que la 2.ª corrida diga «superadmin asegurado (1)».
  **La prueba limpia NO se ha corrido** (necesita una base vacía creada en CloudPanel).
- `39b18eb`: **la contraseña generada del administrador inicial ya no se imprime.** `init-db`
  la deja en `.credenciales-admin.txt` (0600, formato del del superadmin); si el archivo ya
  existe, `init-db` se detiene sin crear la cuenta. Con `ADMIN_PASSWORD` en el `.env` no se
  escribe archivo. `.gitignore`, `generar-parche.js` y `generar-plantilla.js` bloquean
  `.credenciales-*.txt` por patrón; la prueba limpia verifica el archivo (0600, correo, clave
  ausente de la salida) y se niega a correr si hay uno viejo. **No está en el 271**: solo afecta
  a instalaciones nuevas (el bloque corre cuando no hay admin). **Entra en el 272**, dentro de `db/init-db.js`.
- Commits de la tanda: `38826b6`, `0e06d7d`, `6b803f0`, `7610063`, `3ab4ddf`, `2f1ce57`, `39b18eb`,
  `9cb3e25`, `90b5948` (LEEME: con `ADMIN_PASSWORD` no se escribe archivo) y `0c2311a`.
- **Prueba limpia corrida y pasada** (base desechable `pruebalimpia`, 44 tablas, todas las
  comprobaciones en OK, salida 0): el superadmin nace con 2FA y celular 3104157434; la clave del
  admin queda en `.credenciales-admin.txt` (0600, `admin@campana.local`) y no sale por consola; la
  2.ª corrida imprime «superadmin asegurado (1)». La plantilla v271 se **regeneró** después de
  `39b18eb`: sha256 `c3e4a6715d3365da6990243ed77c0846acdd50e987ca6fdc921c3f9a1c6a8e80`, 194
  archivos, secretos 0, su `init-db` ya no imprime la clave (la de `c11c9904…` de arriba quedó
  obsoleta).

### Remoto en GitHub (6 de noviembre de 2026)

- **Remoto `origin`:** `git@github.com:garias333/campana-electoral-app.git` — repositorio
  **privado**. Se subió de cero (estaba vacío).
- **Acceso:** deploy key **con escritura**, par ed25519 `~/.ssh/campana_github` de la cuenta
  `gariasappelectoral` (huella `SHA256:e1n5q6CP0OrDoJUkqu/JfZbHvfIwHQ3ZO9HRAHmyLPM`), solo para este
  repo. `core.sshCommand` del repo: `ssh -i ~/.ssh/campana_github -o IdentitiesOnly=yes`. La
  huella de `github.com` se verificó contra la publicada antes de guardarla en `known_hosts`.
- **Quién empuja:** **Gildardo, como root, con `su - gariasappelectoral`**. Claude Code deniega los
  `git push` (permiso «Data Exfiltration»); solo deja pasar `--dry-run`. Comando:
  `su - gariasappelectoral -c 'cd /home/appestrategia-electoral/htdocs/electoral.appestrategia.net && git push origin auditoria-fable'`
  (las claves son de esa cuenta: desde otra, `core.sshCommand` no encuentra la llave).
- **Verificado el 6 de nov. con `git ls-remote` y `git branch -vv`:** `origin/auditoria-fable` =
  `0c2311a` (0 adelante / 0 atrás), `origin/main` = `27c22d2` (0 / 0; `main` local **no** tiene
  seguimiento configurado), y los 3 tags `punto-restauracion-2026-08-24`, `-2026-08-31` y
  `-antes-dictado` coinciden con los locales.
- **Los hashes que cita este documento coinciden con GitHub:** los 15 hashes de 7 caracteres que
  aparecen en él son commits de este repo y todos son alcanzables desde `origin/auditoria-fable`.
  (Se comprobó antes de añadir el commit de esta nota, que queda 1 adelante hasta el próximo push.)
- **Autor:** el historial NO se reescribió. Quedan 298 commits con `tu@correo.com` (todos los de
  antes de hoy salvo 3) y los demás con `correo@gildardoarias.com`; el repo ya tiene
  `user.email = correo@gildardoarias.com` (`.git/config`), así que los nuevos salen bien.
- **Seguridad previa al push:** revisión de secretos sobre los 309 commits de todas las ramas y
  tags: 0 hallazgos reales (dos marcadores: `.env.example` y `public/ayuda.html`; la única `.pem`
  es una llave pública; los `.sql` son esquema). El código lleva el correo y el celular del
  superadmin como valores por omisión: **mantener el repositorio privado**.

## Sección Legislación (6 de noviembre de 2026) — parche 266 registrado, INACTIVO

### Lo que se agregó después del 266 (SIN parche; el 267 lo arma Gildardo)

Pantalla de tres pestañas, con `?tab=calendario|buscar|normas` (por omisión,
Calendario). Escritorio y celular comparten `public/js/legislacion-comun.js` y
`public/css/legislacion.css`; cada página solo aporta su marco y cómo abrir un PDF.
Service worker a `estrategia-v135` (las páginas siguen sin precachearse).

- **Datos en la carpeta central** (`legislacion/` de la Base, la que copia el cron):
  `indice.json` con los epígrafes literales de los 10 PDF y `calendario.json` con
  las 35 actividades de la Resolución 12338 de 2026. **Gildardo renombró
  `resolucion-09458-de-2026-CNE.pdf` a `…-de-2025-CNE.pdf`** (el documento es del
  11 de septiembre de 2025); las claves de `indice.json` siguen los nombres
  actuales, así que **si se vuelve a renombrar un PDF hay que cambiar su clave**.
  `scripts/sincronizar-legislacion.sh` ahora copia también `calendario.json`.
- **`calendario.json`**: objeto `{meta, filas, periodos}` (el lector acepta también
  el formato viejo, un arreglo de filas). Cada fila: `{inicio, fin|null, actividad,
  referencia, grupo}` con fechas AAAA-MM-DD, más `plazo` y `soporte_legal` (el texto
  literal del cuadro; las horas van en `plazo`). **`periodos`** son las parejas que la
  resolución une de forma expresa, `{nombre, fila_inicio, fila_fin}`, con las filas
  contadas desde 1 en el orden del archivo (una fila inválida no corre la numeración).
  Hoy hay seis: 1→4 registro de comités inscriptores, 2→20 inscripción por cambio de
  domicilio, 6→10 inscripción de candidatos, 12→16 modificación por renuncia o no
  aceptación, 21→30 espacios gratuitos en medios, 22→28 postulación de testigos.
  **Se dejó fuera 1→11 (recolección de apoyos)**: la fila 1 dice «periodo de recolección
  de apoyos ciudadanos» y la 11 «recolección y entrega de firmas»; no es la misma frase.
  Tampoco se cierra la propaganda en espacio público (fila 7): el cuadro no le da cierre.
  **No se escribe `fin` a mano ni se inventan fechas.**
  **En la pantalla, «En curso» son los PERIODOS** cuyo inicio ya pasó y cuyo fin no, con
  «desde … hasta …», «Termina en N días» y una barra de avance. Las 35 filas van a
  Cumplidas o Próximas; una fila del día de hoy queda en Próximas con la etiqueta «Hoy».
  **Cuatro fechas son dudosas** (filas 14, 15, 23 y 27): el texto dice «60», «30» y
  «8 días» y la fecha impresa solo cuadra con días HÁBILES (ver orden 5); se dejó la
  fecha impresa. El estado lo calcula el navegador con la fecha de Colombia;
  `?hoy=AAAA-MM-DD` simula otro día. A 390 px las pestañas usan rótulos cortos
  («Calendario», «Buscar», «Normas») y en el celular el artículo dice «Está en la
  página N» (Safari ignora `#page`).
- **`GET /api/legislacion/calendario`** (responde `{meta, filas, periodos}`) y **`GET /api/legislacion/buscar?q=`**,
  con el mismo permiso `legislacion`. El buscador está en `lib/legislacionTexto.js`.
- **Extractor de texto: `pdftotext -raw` si está en /usr/bin; si no, Ghostscript.**
  `/usr/bin/pdftotext` y `pdfinfo` **ya existen en el VPS** (poppler 24.02; no
  estaban cuando se midió en la orden 5). El modo es `-raw` a propósito: con el
  modo por defecto dos encabezados de la Resolución 09458 («DÉCIMO SÉPTIMO»,
  «VIGÉSIMO SEGUNDO») salen partidos y se pierden dos artículos. Sin poppler, la
  ruta de Ghostscript da los mismos artículos (probado), pero tarda unas 2,5 veces más.
- **Qué indexa y cómo**: 9 de los 10 PDF por artículo (1.801: 249; Decreto 2241:
  218; 1475: 55; 130: 54; 996: 42; 09458: 29; 163: 18; 6: 14; 0920: 10) más
  «Texto general» por página. Un encabezado cuenta solo si su número sigue al
  anterior. Coincidencia por **inicio de palabra**, sin tildes ni mayúsculas, la ñ
  distinta de la n («elección» no encuentra «selección»; «ano» no encuentra «año»).
  Reconoce «artículo 24», «art. 24 ley 130», «1475 artículo 35»; máximo 50.
- **La Resolución 12338 NO se busca**: es un escaneo (una imagen por página) con una
  capa de texto parcial. Se omite con un aviso en el log y una nota en pantalla; su
  contenido útil es el calendario. Si algún día se le hace OCR, se indexa sola.
- **Caché** en `datos/cache-legislacion/` (fuera de `legislacion/`, porque el cron
  borra lo que sobra ahí; fuera de git y de parches/plantilla). Clave = nombre +
  tamaño + fecha + versión del extractor. Primera búsqueda ≈ 2 s (todo el
  corpus); después, milisegundos. Hay que dejar que la app pueda crear `datos/` en
  cada instalación (la carpeta de la instalación es del usuario de la campaña: sí).

Commits locales en `auditoria-fable` (entonces sin push; hoy publicada, ver «Remoto»). El parche 266 se generó y
registró **inactivo** (ver abajo). Las anclas de arriba son de agosto; lo que
sigue está medido hoy sobre este árbol.

- **Qué es.** Una pantalla «Legislación» (escritorio `/legislacion.html` y
  celular `/app/legislacion.html`) que lista los PDF de la carpeta
  `legislacion/` de la raíz de cada instalación. **La app solo lee**: no sube ni
  borra; los PDF los sube Gildardo por el administrador de archivos de
  CloudPanel. No hay tabla nueva.
- **Permiso.** Módulo `legislacion` en `MODULOS` (`routes/permisos.routes.js`) y
  en `PERMISOS_POR_DEFECTO` (`db/init-db.js`): Ver = 1 para admin y coordinador,
  0 para el resto; Editar/Agregar/Importar en 0 para todos. El servidor lo exige
  con `requiereVerModulo('legislacion')` (nuevo, en `middleware/permisoModulo.js`):
  admin y superadmin siempre pasan, los demás por su fila de `permisos_rol`,
  falla cerrado, y el aspirante con sublicencia queda fuera.
- **Rutas** (`routes/legislacion.routes.js`, montada junto a `/api/recursos`):
  `GET /api/legislacion` y `GET /api/legislacion/archivo/:nombre`
  (`?descargar=1` baja; por omisión se ve en línea). El archivo que se abre
  sale del listado leído del directorio, nunca de lo que escribe la persona.
- **`legislacion/indice.json` es opcional**: `{ "archivo.pdf": { titulo, tipo,
  numero, anio, descripcion, orden } }`. Sin él, o para un PDF que no figure,
  el título sale del nombre («Ley 1475 de 2011», «Resolución 0920 de 2011
  (CNE)»). Un JSON roto se ignora y deja un aviso en el log de PM2.
- **`legislacion/` no viaja en parches ni plantilla**: `scripts/generar-parche.js`
  la tiene en `PROHIBIDOS` (y en el `find` de `--desde-fecha`) y
  `scripts/generar-plantilla.js` en `EXCLUIR`. **Antes no estaba en ninguna de
  las dos**: la plantilla la habría llevado (`git ls-files -o` incluye lo que no
  tiene seguimiento) y `--desde-fecha` también. Los PDF siguen SIN seguimiento
  de git a propósito: no hacer `git add -A`.
- **Service worker** a `estrategia-v134` en el parche 266 (ahora `v135`). La página nueva NO
  se precachea (necesita conexión).
- **En el celular, la entrada del menú depende del permiso.** `inicio.html`
  ahora consulta `/permisos/mios` antes de pintar el menú (espera máx. 2,5 s;
  sin respuesta, las entradas con `modulo` no se pintan). Es la primera entrada
  de ese menú que depende de la matriz; las demás siguen fijas por rol.
- **Para que funcione en una campaña** hace falta: el parche, que corra
  `init-db` (toca `db/`; si no, el coordinador recibe 403 por falta de la fila),
  y que `legislacion/` tenga los PDF — ya no se suben a mano en cada campaña:
  los copia el cron central (siguiente punto).
- **Parche 266** (6 nov): generado, publicado en el servidor de licencias y
  registrado y firmado como **INACTIVO**; toca `db/`. sha256
  `93751f89002f19a7e241c776aad93498c8273067ef75d9f8f0f762a8f2fd1ff9`. Lleva 12
  archivos; no lleva `ESTADO.md` ni `generar-plantilla.js`. Activarlo y aplicarlo
  lo decide Gildardo desde el panel. En la PWA, «Ver» y «Descargar» piden el PDF
  con `fetch` y `X-Device-Token` (commit aparte): un enlace solo lleva la cookie,
  que dura 8 h, y el token 7 días.
- **Una sola carpeta central, copiada por cron** (decisión de Gildardo). La
  fuente es `/home/appestrategia-electoral/htdocs/electoral.appestrategia.net/legislacion`.
  `scripts/sincronizar-legislacion.sh` (corre como **root**, nada se ejecutó aún
  en el VPS) la copia a `legislacion/` de cada campaña con rsync: solo
  `*.pdf`/`*.PDF` e `indice.json`, sin subcarpetas ni enlaces, `--delete`,
  `--delay-updates`, dueño = dueño de la instalación, 750/640, `flock`, registro
  en `/var/log/sincronizar-legislacion.log`. Opciones `--simular` y `--una RUTA`.
  Descubre las campañas por `package.json` con `"name": "campana-electoral-app"`
  y **resuelve enlaces**: el `~/htdocs` de las cuentas SSH es un enlace al de la
  cuenta del sitio y, sin eso, cada campaña saldría dos veces (y electoral
  también). **Si el origen no existe o no tiene ni un PDF, no toca nada**: con
  `--delete` vaciaría todas las campañas; para vaciarlas a propósito hay que
  hacerlo a mano. `scripts/legislacion-excluir.txt` (opcional, no existe) salta
  rutas. Una campaña cuyo `legislacion` sea un enlace simbólico se OMITE.
  El guion está en git y en la plantilla, y **fuera de los parches**
  (`PROHIBIDOS` de `generar-parche.js`): como esa lista cambió después del 266,
  la copia de `generar-parche.js` en las campañas queda atrasada hasta el
  próximo parche que la lleve (lo notará `comparar-instancias.js`, no es fallo).
  Probado sin root con carpetas de prueba; **no probado**: el `--chown` a un
  dueño distinto del que corre (necesita root), ni ninguna campaña real.
- **Probado en desarrollo** con un MySQL desechable (ya borrado), no con las
  bases de campaña: ver el informe de la sesión. Lo no probado: la copia real de
  la base municipal (el usuario de esta cuenta no la puede leer ni crear bases),
  `nginx` de CloudPanel, y abrir un PDF en un iPhone real.

## Hecho y verificado en la última sesión

Del parche **239 al 249**. Todo lo de abajo quedó implementado, probado contra
la base real y aplicado en las tres instalaciones.

- [x] **El E-14 en tres bloques.** `dia_d_candidatos.grupo`
      (`candidato`/`nivelacion`/`otros`) y `dia_d_bloques` para el orden y la
      numeración de cada bloque. Una sola hoja en Configuración → Día D con los
      tres uno debajo de otro; flechas amarillas mueven la fila dentro de su
      bloque, azules mueven el bloque entero.
- [x] **Cada bloque decide si lleva numeración y desde qué número.** Casilla
      «Numerar» + «empieza en» en su cabecera. Sustituyó a una regla implícita
      (`numeracionDesdeCero`) que deducía el 0 de si la campaña era sublicencia;
      esa variable ya no existe.
- [x] **Nivelación y Otros votos solo en campañas de aspirante.** Se decide en
      `configuracionDeBloques()` (routes/diaD.routes.js), el único sitio que
      dice qué bloques existen. La ruta de alta también lo rechaza con 400.
- [x] **El formulario del testigo hereda ese orden y esa numeración.** Antes
      llevaba los bloques fijos en su código.
- [x] **En campañas de aspirante:** sin «Total votantes en la mesa», y «TOTAL
      VOTOS AGRUPACIÓN POLÍTICA» como última fila del bloque de candidatos,
      sumando solo ese bloque. La guarda del servidor que exigía
      `total_votantes_mesa` ahora solo aplica a la campaña madre.
- [x] **La corrección de un reporte vuelve a anular al anterior.** La clave de
      «último reporte por mesa» pasa de `COALESCE(CAST(puesto_id AS CHAR),
      puesto_votacion)` al **nombre del puesto**, en las cinco consultas que la
      repiten. Efecto medido en campanadepruebamunicipal: Diego Alejandro
      Morales 155 → **125**; mesas reportando 4 → 3.
- [x] **La barra amarilla del candidato propio** funciona en las sublicencias.
      Se resolvía contra `configuracion_campana.nombre_candidato` (el de la
      madre) y no cruzaba con nada. Ahora `nombreDelCandidatoPropio(req)`, por
      rama. Arreglaba de paso `votos_candidato`, que quedaba NULL en todos los
      reportes de testigos de un aspirante.
- [x] **Pantalla nueva `public/reportes-puesto.html`** — dónde le fue mejor y
      peor a un candidato, por puesto y por mesa, con el porcentaje sobre los
      votantes de cada mesa. Se llega por un botón del tablero del Día D.
- [x] **El orden de los candidatos lo manda el tarjetón.** Columna `orden`,
      flechas por fila, y el candidato propio **ya no se agrega solo**: hay que
      ponerlo a mano en la hoja, en su posición.
- [x] **Los `confirm()` de configuracion.html** (11) pasaron a
      `confirmarEnModal`. Eran botones mudos: Chrome suprime los diálogos tras
      varios seguidos y `confirm()` devuelve `false` sin preguntar.
- [x] **Limpieza:** 600 KB de maquetas servidas en abierto, dos PNG huérfanos,
      `scripts/calibrar_cohortes.js` (pedía un módulo inexistente y hacía que
      `verificar-requires.js` diera un falso «SIN RESOLVER» en cada revisión),
      CSS muerto y dos `require` inertes. `verificar-requires.js` dice ahora
      «TODO RESUELVE» sobre 216.
- [x] **`olvidarCargoDeLaMadre()` cableado.** Existía desde el principio con el
      comentario «para después de guardar la configuración» y **nadie lo
      llamaba**: al cambiar el cargo, los filtros de rama usaban el valor viejo
      durante 30 s.
- [x] **Permisos:** los doce `.env` del VPS en `640`.

## Pendiente inmediato

1. **Reiniciar electoral** (ver Anclas). Es lo primero.
2. **Los `confirm()` nativos de nueve pantallas más**, con el mismo botón mudo
   esperando: crm (8), votantes (7), enviar-push (6), eventos (3), dia-d (2),
   testigos (2), organigrama (1), asistentes-reuniones (1), whatsapp-lote (1).
   El arreglo es el del parche 239: `await confirmarEnModal(...)` de
   `public/js/common.js`.
3. **`sms_exclusiones` se consulta y nadie la llena.** `estaExcluido()` la lee
   en `lib/sms-cuota.js`, pero `excluir()` no la llama nadie. O el opt-out va
   por `usuarios.no_contactar` y esa tabla sobra, o falta cablearla. Sin mirar.
4. **Los dos reportes del aspirante con `votos_candidato` NULL** (ids 31 y 32 en
   campanadepruebamunicipal) siguen así: el arreglo aplica a los nuevos. Se
   pueden recalcular desde `dia_d_reporte_votos`, que está intacto. **No se hizo
   por no tocar datos ya escritos sin pedirlo.**
5. **`parches/parche-24.zip`** en el servidor de licencias, de 30 KB, parece un
   tecleo de cuando se generó el 224. No es ningún parche; se puede borrar.
6. **Exportados sin usar en `lib/ramas.js` y `lib/sms*.js`** — `filtroAspirante`,
   `enviarLote`, `excluir`, `aE164`. Los dejó la auditoría marcados como
   confirmados pero NO seguros de borrar: el primero es una de las reglas de
   rama que el propio fichero advierte no tocar, y los otros son API de
   biblioteca. Decisión pendiente, no olvido.
7. **Botones «Re-geocodificar pendientes» y «Re-geocodificar todos»**
   (`public/votantes.html:28-29`) **sin guarda de rol.** La ruta es
   `requireRole('admin', 'aspirante')` (`routes/votantes.routes.js:380`), así que
   el coordinador, el líder, el sublíder, el testigo y el invitado los ven y
   reciben 403 al pulsarlos. Lo destapó la auditoría del permiso Importar /
   Exportar (14 de octubre de 2026) y **se dejó fuera de ese commit a propósito**:
   es otra función con otra guarda. Arreglo previsto: esconderlos cuando
   `usuarioActual.rol !== 'admin'` (para el aspirante `rol` ya llega reescrito a
   `'admin'`, y la ruta sí lo admite). Misma familia, solo para el aspirante, que
   la auditoría también anotó y tampoco se tocó: «Ver» firma y «Pedir
   confirmación» (`votantes.html:2000-2014`), casilla «Datos verificados»
   (`votantes.html:1089`, `:2230`), y `finanzas.html:191`, que no lo expulsa.
8. **Dos cuentas con cargo de coordinador y rol de cuenta distinto**, en
   campanadepruebamunicipal: **131** (cuenta `sublider`, 2 líderes a cargo) y
   **124** (cuenta `lider`, cargo coordinador + testigo, 2 líderes). «Avance de
   mis líderes» y el menú del coordinador deciden por el **rol de la cuenta**,
   como el resto de la app, así que a esas dos personas la pantalla les responde
   403. Es un dato inconsistente de la campaña de prueba, no del código; **no se
   tocó**. Decisión pendiente: corregir el rol de las dos cuentas, o decidir que
   el cargo de la estructura manda. Las cuentas con rol `coordinador` que sí
   tienen líderes son 75, 77, 76, 82 y 83 (13, 8, 3, 1 y 1).
9. **Un parche registrado por CLI nace INACTIVO pero con distribución «todos»**
   — **parche aparte, del servidor de licencias** (no de esta aplicación).
   `POST /parches/registrar-y-firmar` inserta `activo = 0` pero no menciona
   `modo_distribucion` (`routes/actualizaciones.routes.js:490-495` en el servidor
   de licencias), y la columna tiene `DEFAULT 'todos'` (`db/schema.sql:117`,
   `db/init-db.js:46-49`, y el volcado real del 12 de agosto de 2026). Mientras
   está inactivo no lo recibe nadie (`:384` y `:411` exigen `activo = 1`), pero
   en cuanto alguien lo activa —el interruptor del panel, `PUT /:id/activo`, o
   «Aplicar ahora», que además fuerza `activo = 1` en `:301`— llega a TODAS las
   instalaciones con actualización automática. Detectado el 14 de octubre de
   2026 al registrar el 263; esa vez se resolvió a mano (poner «seleccionadas»
   con solo la campaña de prueba, ANTES de activar). Arreglo propuesto (opción B):
   que el `INSERT` de `:490-493` incluya `modo_distribucion = 'seleccionadas'`,
   de modo que un parche recién registrado no le llegue a nadie ni aunque lo
   activen por error y haya que elegir a quién se le abre. El comentario de
   `:461-464` dice que unificar ese comportamiento es una decisión aparte.
10. **El botón «Aplicar ahora» falló en la municipal con `spawnSync unzip ENOENT`**
    (`logs/actualizaciones.log`, 13 de octubre de 2026, parche 262: «Firma
    verificada… Aplicando parche #262… Error aplicando el parche #262: … spawnSync
    unzip ENOENT»). El actualizador lanzado desde la app hereda el PATH del
    proceso de la app (`routes/actualizador.routes.js:206-208`;
    `scripts/actualizar-automatico.js:68` solo le antepone la carpeta de
    binarios de node), y ahí no se encuentra `unzip` (`/usr/bin/unzip`). Los
    parches 255 a 259 se aplicaron por ese mismo botón cuando aún funcionaba; el
    cron de las 03:00 nunca ha aplicado uno ahí (solo escribe «Ya estás al día»),
    así que el 263 será su primera prueba real. **Se repitió el 14 de octubre de
    2026 a las 17:55:25 UTC con el 263**, también desde el panel: descarga bien,
    «Firma verificada correctamente (Ed25519, 550889 bytes)», y el mismo
    `spawnSync unzip ENOENT`. Falla en la validación del zip (`unzip -Z1`), ANTES
    de escribir: no quedó nada a medias (ningún archivo nuevo, sin la columna,
    `.version-parche` en 262). **La causa sigue sin demostrarse.** Descartado: no es
    `reiniciar-instancia.sh`, que arranca con `su -` (PATH de login, con
    `/usr/bin`). No se pudo mirar el entorno real de la app ni el `dump.pm2` (EACCES
    desde la cuenta de desarrollo). Pendiente: leerlo como root
    (`/proc/<pid de app.js>/environ`, solo la variable PATH) o hacer que
    `scripts/actualizar-automatico.js:68` añada `/usr/bin:/bin` al PATH, lo que
    arreglaría el botón sin saber la causa.
    **Actualización (14 de octubre de 2026, 23:35 UTC): el botón SÍ funciona en la
    departamental** — aplicó el 262 (13-oct) y el 263 (14-oct) con `init-db` y
    reinicio de PM2, 0 errores `unzip ENOENT` en todo su log. Por tanto el fallo
    es propio del entorno de la app de la **municipal**, no del botón en general.
11. **c001-2027 recibió el 263 sin respaldo previo.** El 14 de octubre de 2026,
    entre las 23:33 y las 23:36 UTC, alguien usó «Aplicar actualización» del panel
    con las tres campañas: la departamental se actualizó a las 23:35:03 (verificada:
    versión 263, 35 de 35 huellas md5 idénticas a la plantilla, HTTP 200 en el
    3102, columna `tinyint(1)/NO/0` con `admin` 9 y `coordinador` 8) y c001 se
    reinició a las 23:36:39 (PID 48008 → 180450). La carpeta de c001 es ilegible
    para la cuenta de desarrollo, así que **no se pudo confirmar** su versión, su
    log ni la columna; solo que hoy el servidor le entrega el 263 (HTTP 200; antes
    daba 403). El respaldo de su base que se había pedido «antes de aplicar» NO
    se sacó. Pendiente como root: leer `.version-parche` y las últimas líneas de
    `logs/actualizaciones.log` de c001, verificar la columna, y sacar un respaldo
    AHORA (ya no será «antes», pero sigue siendo la línea base). Los scripts
    `orden7_parte1.sh` (verifica, y aplica solo si hace falta) y `orden7_parte2.sh`
    (lee c001 y respalda) quedaron preparados, revisados dos veces y probados con
    92 casos, en la carpeta de trabajo de esa sesión.

## Trampas encontradas

- **`unzip -o` conserva la fecha guardada en el zip.** Comparar la fecha de un
  archivo con la hora de arranque del proceso para saber si una campaña corre el
  código nuevo **da una respuesta inventada**: en las campañas los archivos
  quedan con fecha *futura* respecto al reloj. Lo que sí sirve: `md5sum` del
  archivo contra el de electoral, el registro en `logs/actualizaciones.log`, y
  el contador de reinicios de PM2. Casi escribo lo contrario en esta bitácora.
- **Un comentario SQL con acentos graves dentro de una plantilla de
  JavaScript** cierra la cadena. Los comentarios `--` de
  `routes/diaD.routes.js` van sin acentos graves por eso. Lo cazó `node --check`.
- **`verificar-html.py` valida la sintaxis, no las variables.** Una variable
  usada y no declarada pasa el control y revienta al abrir la pantalla. Pasó con
  `hayNumerosE14`.
- **Al renombrar un id de contenedor, los selectores de la hoja de estilos no
  avisan.** Renombrar `#panel-diad-candidatos` dejó doce reglas apuntando al id
  viejo: todos los tamaños de cuatro parches habrían dejado de aplicarse sin un
  solo error.
- **`grep` sin `-w` da falsos vivos.** `geocodificarYGuardar` parecía tener 7
  usos; seis eran `geocodificarYGuardarVotante`, otra función. Es la trampa que
  CLAUDE.md documenta con «CALIMA».includes(«CALI»).
- **La caché del celular guarda la RESPUESTA, no solo la página.** Cambiar la
  forma de lo que devuelve una ruta cacheada sin cambiar la clave deja al
  teléfono leyendo lo viejo con el código nuevo — y la tabla en blanco el día de
  la elección. Por eso `diad_candidatos` → `diad_listas_e14`, y por eso
  `/candidatos-para-reporte` sigue viva devolviendo la forma antigua.
- **Un total que suma «hasta la siguiente cabecera» supone un orden.** El total
  de la agrupación política daba **0** en cuanto la campaña subía «Nivelación de
  la mesa» por encima de Candidatos. Ahora cada fila lleva `data-bloque`.
- **`required` en un campo oculto** bloquea el envío sin mostrar aviso: el
  navegador intenta enfocar algo que no se ve.
- **Un número publicado no se reutiliza.** El 241 y el 242 llegaron a coexistir
  sin aplicar, cada uno reemplazando al anterior. `publicar-parche.sh --forzar`
  existe para un zip aún no aplicado, pero si se activa mientras se cambia, esa
  campaña se queda con el viejo para siempre.

## Candidatos para CLAUDE.md

*A criterio del usuario; no se tocó CLAUDE.md.*

- La trampa de `unzip -o` y las fechas: cómo comprobar de verdad que una campaña
  corre el código de un parche (md5 + log del actualizador + PM2), y por qué la
  fecha del archivo miente.
- Que `dia_d_candidatos` ya no es «los candidatos» sino «lo que el testigo
  cuenta en la mesa», en tres bloques, y que `dia_d_bloques` guarda su orden y
  su numeración por campaña.
- Que la regla de «último reporte por mesa» agrupa por **nombre de puesto**, y
  por qué no por `puesto_id` (mezclar dos numeraciones en una columna rompía la
  anulación de los reportes corregidos).

---
<!-- cierre automático -->
Sesión cerrada: 2026-09-02 11:53 UTC desde srv1807015
Rama: auditoria-fable | Commit: 7b2a1da Parche 251: el logo de WhatsApp en el renglón de Soporte | Sin commitear: 0 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-09-03 17:44 UTC desde srv1807015
Rama: auditoria-fable | Commit: af80452 Parche 253: el gráfico de apoyos por campaña | Sin commitear: 0 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-09-04 20:52 UTC desde srv1807015
Rama: auditoria-fable | Commit: 90274cb Un token de Mapbox por campaña, y una herramienta que lo comprueba | Sin commitear: 4 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-09-19 14:01 UTC desde srv1807015
Rama: auditoria-fable | Commit: 90274cb Un token de Mapbox por campaña, y una herramienta que lo comprueba | Sin commitear: 5 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-14 13:13 UTC desde srv1807015
Rama: auditoria-fable | Commit: a438988 Parche 262: territorios como tabla local editable en campañas nuevas | Sin commitear: 2 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-15 01:15 UTC desde srv1807015
Rama: auditoria-fable | Commit: d7d9efc Parche 263: .version-base a 263 | Sin commitear: 2 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-15 11:20 UTC desde srv1807015
Rama: auditoria-fable | Commit: d7d9efc Parche 263: .version-base a 263 | Sin commitear: 2 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-18 20:19 UTC desde srv1807015
Rama: auditoria-fable | Commit: d7d9efc Parche 263: .version-base a 263 | Sin commitear: 2 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-18 20:20 UTC desde srv1807015
Rama: auditoria-fable | Commit: d7d9efc Parche 263: .version-base a 263 | Sin commitear: 2 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-18 20:20 UTC desde srv1807015
Rama: auditoria-fable | Commit: d7d9efc Parche 263: .version-base a 263 | Sin commitear: 2 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-18 22:37 UTC desde srv1807015
Rama: auditoria-fable | Commit: 092beb4 Parche 264: varios territorios por persona en estructura | Sin commitear: 4 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-19 17:03 UTC desde srv1807015
Rama: auditoria-fable | Commit: 092beb4 Parche 264: varios territorios por persona en estructura | Sin commitear: 4 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-19 17:09 UTC desde srv1807015
Rama: auditoria-fable | Commit: 092beb4 Parche 264: varios territorios por persona en estructura | Sin commitear: 4 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-11-04 18:39 UTC desde srv1807015
Rama: auditoria-fable | Commit: 9fc8fa5 Parche 265: PWA para iPhone | Sin commitear: 4 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-11-06 15:17 UTC desde srv1807015
Rama: auditoria-fable | Commit: 2d8cbf4 Parche 267: .version-base a 267 (Legislación: calendario, buscador y tarjetas) | Sin commitear: 4 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-11-06 15:21 UTC desde srv1807015
Rama: auditoria-fable | Commit: 2d8cbf4 Parche 267: .version-base a 267 (Legislación: calendario, buscador y tarjetas) | Sin commitear: 5 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-11-06 18:43 UTC desde srv1807015
Rama: auditoria-fable | Commit: 5f31a08 Parche 270: .version-base a 270 (Estructura en la app del admin, formularios por pasos y copiado de la cédula) | Sin commitear: 5 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-11-06 20:34 UTC desde srv1807015
Rama: auditoria-fable | Commit: 8dfca61 ESTADO.md: remoto en GitHub (privado, deploy key), verificación y quién empuja | Sin commitear: 3 archivo(s)
