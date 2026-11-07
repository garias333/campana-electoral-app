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

- **Último parche generado: 279** (`parches/campana-parche279.zip`, 22.390 bytes,
  sha256 `27ceca3c28a0a081866e18a50e50ddd0845c2b8f45610121e50f1e329ec1e0ee`, 3 archivos).
  **Publicado** en la carpeta de licencias (`parche-279.zip`, mismo sha256, 0644) y
  **registrado y firmado (Ed25519), INACTIVO**, con `toca_base_datos = false`; nombre en el panel:
  «Inscripción: formulario por secciones y GPS (Requiere el 278)». Es el formulario de inscripción por enlace en cuatro
  secciones, con GPS (detalle abajo) y **requiere el 278**. El anterior, el 278 (`parches/campana-parche278.zip`, 18.199 bytes,
  sha256 `673b60c0f58bec76b55b688a9555c23f2194bb496dc407e425183e66ad6ee02b`, 3 archivos, datos de contacto completos,
  `toca_base_datos = false`, requiere el 277), sigue publicado e inactivo, igual que el 277 (`parches/campana-parche277.zip`,
  278.601 bytes, sha256 `c1804c429d701fbcb03890b892a089e0cb41be5d945a71563fbbe10178700fc4`, 22 archivos, inscripción
  por enlace/QR del líder, `toca_base_datos = true`, requiere el 276), sigue publicado e inactivo, igual que el 276 (551.144 bytes,
  `28471a84304ebc590121351690020621f2adb288a9b0783a2b9f5b1e1d46a40c`, 36 archivos, Día D fase 4, requiere
  el 275), sigue publicado e inactivo, igual que los anteriores —275 (33.002 bytes, `da76d397…`, 5 archivos, tarjeta «Ya voté»), 274 (456.956 bytes,
  `3c69dddb…`, 30), 273 (`11b498b6…`, 22) y 272 (`f4333fcb…`, 11)— siguen publicados e inactivos; los zip
  265 a 271 también están publicados.
  **Distribución del 279 (y del 278, 277, 276, 275, 274, 273 y 272): NO MEDIDA, y la fija Gildardo en el panel ANTES de
  activar.** `registrar-parche.js` no manda `modo_distribucion` y la columna nace en «todos» (pendiente 9 de
  abajo): hay que ponerlo en «seleccionadas» y marcar solo las campañas elegidas —**las mismas en los
  siete**—, nunca la Base. El sistema no declara dependencias entre parches (ver «Cómo exige el 273», en el 274).
- **Registrado / activo / aplicado en las campañas: NO MEDIDO.** Hay que mirar
  `.version-parche` y `logs/actualizaciones.log` de municipal, departamental y c001-2027
  (bloque d) del traspaso, abajo). En la Base, `.version-parche` y `.version-base` = **273**
  (la Base no recibe parches: los genera); desde el 279, `.version-parche` y `.version-base` = **279**. Ni el 272, ni el 273, ni el 274, ni el 275, ni el 276, ni el 277, ni el 278 ni el 279 se han activado ni aplicado a ninguna campaña.
- **Service worker:** `estrategia-v155` en el código de la Base y dentro del 277 (el 278 y el 279 no lo tocan; el 276 lleva `v154`; el 275 lleva `v151`; el 274, `v150`; el 273 lleva `v147`;
  el 272, `v146`; el 271, `v145`). Cada campaña lo tendrá cuando reciba el 273. Las páginas nuevas
  `app/faltantes.html` y `app/ranking-dia-d.html` van en su precache.
- **La Base corre el código del 271.** Su proceso (`app.js`, pid 2883929) arrancó a las
  19:18:41, después de la última edición de código de ejecución (19:07:07). Su `.env` tiene
  `TELEGRAM_BOT_TOKEN` y `TELEGRAM_SUPERADMIN_CHAT_ID` con valor (solo se comprobó que no
  estén vacías) y **no** tiene `APP_NOMBRE`: el mensaje dice «Estrategia | App electoral». El
  registro de PM2 muestra **un** «Telegram OK» y ningún «Telegram falló».
- **Plantilla: sigue en v271 y NO lleva el Día D fase 1** (no se regeneró al armar el 272, por
  orden expresa). Para una campaña nueva hay que regenerarla con `--parche 279` (y `--forzar`
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

## Parche 279 — inscripción por enlace: formulario por secciones y GPS (7 de noviembre de 2026, INACTIVO)

Zip de 3 archivos: `config/inscripcionRegistro.js`, `routes/inscripcion.routes.js` y `.version-base` (279).
Commit que recoge: `8456601` (a partir de `2fa5ce1`, el del 278). `scripts/probar-inscripcion-enlace.js` (ahora con 236
comprobaciones) **no viaja**; el service worker no cambia (`/i` lo arma el servidor; no hay archivo estático nuevo).

- **Qué cambia a la vista:** el formulario `/i/<código>` queda en cuatro secciones, con título en mayúsculas, negrita y
  azul de la marca (`#0B5ED7`) y una línea fina debajo, como «DATOS DE CONTACTO» de la ficha: **DATOS PERSONALES**
  (cédula, nombre), **DATOS DE CONTACTO** (botón GPS, dirección, departamento, ciudad, comuna/corregimiento,
  barrio/vereda, celular, correo), **DÓNDE VOTAS** (puesto con buscador, mesa, enlace a la Registraduría) y
  **TRATAMIENTO DE DATOS PERSONALES** (política vigente, autorización, canales sin marcar, «Inscribirme»). Obligatorios
  con «(obligatorio)»: cédula, nombre, celular y la autorización (los mismos cuatro `required` de antes). Los nombres de
  campo y las validaciones del servidor no cambian. Comuna y barrio siguen ocultos si la campaña no los usa.
- **GPS.** «Usar mi ubicación (GPS)» solo consulta al navegador al tocarlo. Las coordenadas viajan en dos campos
  ocultos (`gps_lat`, `gps_lon`) que **el servidor no da por buenos**: números, dentro de Colombia (caja
  −4,3…13,5 / −82…−66,8, que incluye San Andrés y Providencia) y redondeadas a 7 decimales. Se guardan en
  `votantes.latitud/longitud` con `geocodificado_en` y entonces **no se geocodifica por dirección**. Unas coordenadas
  inválidas se **descartan sin error** (quien se inscribe no puede corregir un campo oculto) y la ficha se geocodifica
  por su dirección como antes. En una ficha existente **solo si no tenía coordenadas** (o le faltaba una del par) y con
  el celular que coincide.
- **Geocodificación inversa: `POST /i/<código>/ubicacion`** (con la misma `GOOGLE_MAPS_API_KEY`, función
  `geocodificarInversa` que ya existía). Propone dirección (solo la calle: lo anterior a la primera coma; un «plus code»
  no se propone), barrio, ciudad y departamento; el navegador los pone **solo en un campo vacío o con el valor por defecto
  de la campaña sin tocar**, nunca sobre lo que la persona escribió. Sin clave o ante cualquier fallo responde
  `{disponible:false}` y solo quedan las coordenadas («Ubicación tomada»). **Cada toque del botón gasta una consulta de
  Google.** Topes que cuentan TAMBIÉN las llamadas buenas: **20 por IP cada 15 minutos y 400 por enlace al día**, en
  memoria (un reinicio los pone en cero); la 21.ª / 401.ª da 429 sin llegar a Google. Una IP compartida (un evento con una
  sola wifi) comparte su cupo.
- **Dónde votas.** El puesto sale del endpoint público de puestos de la campaña (sin cambios), con un buscador sin tildes
  ni mayúsculas; «No sé» en puesto y en mesa; la mesa va de 1 a `cantidad_mesas` del puesto (el servidor ya lo exigía).
  «Consultar mi puesto en la Registraduría» (`https://wsp.registraduria.gov.co/censo/consultar/`) abre otra pestaña, sin la
  cédula ni ningún parámetro en la URL. **Esa dirección NO se pudo verificar desde el servidor** (devolvió 403 a `curl`;
  no se insistió): conviene abrirla a mano una vez.
- **Verificado sobre el zip:** los 2 archivos de código coinciden por md5 con el commit `8456601`; no trae `.env`,
  `.credenciales-*`, `uploads/`, `legislacion/`, `backups/`, `scripts/`, `db/` ni `.sql`; `verificar-requires.js` revisó 19
  `require` locales y todos resuelven **aplicando el zip sobre una copia del árbol del 278** (`2fa5ce1`), con un control
  negativo (sin `config/geocoder.js` falla, como debe).
- **NO toca la base de datos** (`toca_base_datos = false`): no hay cambios en `db/` y no hace falta `init-db`.
- **Probado con una base simulada** (un MySQL privado desechable) y con Google **sustituido por funciones de prueba**:
  236 comprobaciones (orden de las secciones, obligatorios, 12 clases de coordenadas inválidas, ficha existente con y sin
  coordenadas, puesto y mesa, inversa con y sin clave, y los dos topes). Además, el botón se ejercitó en **Chromium sin
  interfaz con un GPS falso**: llena los campos vacíos, **no pisa lo escrito** (ni una ciudad tecleada a mano) y con el
  permiso negado avisa «Escribe tu dirección» sin llenar nada. Captura a 360 px: una columna, sin desborde horizontal.
  **NO se probó:** Google Geocoding real (ni la inversa ni la directa), un GPS de verdad en un teléfono, ni las listas
  con el catálogo nacional.
- **Riesgo conocido, no resuelto:** quien toca el GPS estando en otro sitio (el trabajo) y después teclea su dirección de
  casa queda con las coordenadas del trabajo y **sin** geocodificación por la dirección escrita. El texto del botón lo
  advierte («Tócalo si estás en tu casa»), nada más. Si se quiere cerrar, la salida es descartar las coordenadas cuando la
  dirección escrita difiere de la propuesta.
- **Cómo exige el 278.** Sin declarar dependencia (ver «Cómo exige el 273»): **activar el 279 con el 278, el 277, el 276 y
  los anteriores, con la misma lista de campañas.**

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **La inversa solo funciona si la campaña tiene `GOOGLE_MAPS_API_KEY`** en su `.env` (con la Geocoding API activada).
   Sin ella el botón igual guarda las coordenadas y dice «Ubicación tomada»; no propone dirección.
2. **Gasto:** una consulta de Google por cada toque del botón, con tope de 20 por IP cada 15 minutos y 400 por enlace al
   día. Más lo que ya costaba la geocodificación por dirección (que con GPS ya no se hace).
3. Los topes viven en memoria: tras reiniciar PM2 el contador vuelve a cero.
4. Aplicar después del 278, con la misma lista de campañas. No hace falta `init-db`.

## Parche 278 — inscripción por enlace: datos de contacto completos (7 de noviembre de 2026, INACTIVO)

Zip de 3 archivos: `config/inscripcionRegistro.js`, `routes/inscripcion.routes.js` y `.version-base` (278).
Commit que recoge: `6d7b514` (a partir de `a5a1f6a`, el del 277). `scripts/probar-inscripcion-enlace.js` (ahora con 184
comprobaciones) **no viaja**; el service worker no cambia (el formulario `/i` lo arma el servidor, no hay archivo
estático nuevo).

- **Qué hace:** el formulario `/i/<código>` trae, después del celular, la sección «Datos de contacto»: correo,
  dirección, departamento, ciudad, comuna/corregimiento y barrio/vereda, con los nombres de columna de la ficha
  (`email`, `direccion`, `departamento_residencia`, `ciudad_residencia`, `comuna_corregimiento_residencia`,
  `barrio_residencia`). **Todo es opcional**; los obligatorios siguen siendo nombre, cédula, celular y la
  autorización. Recorte, espacios colapsados, sin caracteres de control y corte al largo de la columna (150, 255,
  100, 100, 120, 120). Departamento y ciudad vienen prellenados con `territorio_departamento` y `territorio_ciudad` de
  la campaña (o `departamento`/`ciudad` si no están) y se pueden editar. `GET /i/<código>/territorio` (solo lectura,
  sin cédulas ni personas) ofrece las listas de la propia vista `territorios` —departamentos, municipios, comunas y
  corregimientos, y barrios y veredas, **estas también cuando cuelgan directo del municipio**—; sin listas, texto libre.
  Si la campaña tiene «¿Utilizar nombre de comunas?» o «de barrios?» en No, ese campo no se muestra, como en el celular.
- **Guardado:** cédula nueva, todo. **Ficha existente con el celular que coincide: solo los campos que tenía vacíos**
  (una cadena vacía cuenta como vacío); nunca se sobrescribe un dato, ni siquiera el de una ficha de otro líder, y
  si el celular no coincide no se toca nada. **Con dirección se geocodifica en segundo plano** (no se espera, no pisa
  unas coordenadas que ya existan, y sin `GOOGLE_MAPS_API_KEY` no falla ni escribe advertencias; «Re-geocodificar
  pendientes» de Votantes recoge después las que quedaron sin coordenadas).
- **Verificado sobre el zip:** los 3 archivos coinciden por md5 con el disco; no trae `.env`, `.credenciales-*`,
  `uploads/`, `legislacion/`, `backups/`, `scripts/`, `db/` ni `.sql`; sin secretos en el texto;
  `verificar-requires.js` revisó 18 `require` locales y todos resuelven **aplicando el zip sobre una copia del árbol
  del 277** (`a5a1f6a`), con un control negativo (sin `config/geocoder.js` falla, como debe).
- **NO toca la base de datos** (`toca_base_datos = false`): no hay cambios en `db/` y no hace falta `init-db`.
- **Probado solo con una base simulada** (un MySQL privado desechable) y con el geocodificador **sustituido por una
  función de prueba**: 184 comprobaciones (no falla sin clave, con error, sin resultado, ni cuando tarda 1,5 s: la
  respuesta sale en menos de un segundo). **No** se probó Google Geocoding real, ni las listas con el catálogo
  nacional (la prueba usó una tabla `territorios` de seis filas), ni el formulario en un celular real (sí se vio en
  una captura de 360 px, en una columna).
- **Cómo exige el 277.** Sin declarar dependencia (ver «Cómo exige el 273»): **activar el 278 con el 277 y el 276 y los
  anteriores, con la misma lista de campañas.** Sin el 277 le faltan `config/inscripcionEnlace.js` y las tablas.

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Revisar «Datos de la campaña» → departamento y ciudad** antes de repartir QR: son lo que el formulario muestra
   ya escrito. En una campaña departamental la ciudad queda vacía (cada persona pone la suya) y la lista de ciudades
   sale de los municipios del ámbito.
2. **Si la campaña no usa comunas o barrios** (los dos interruptores de Datos de la campaña), esos campos no aparecen
   en el formulario público, igual que en el celular del líder.
3. **Una ficha que ya tenía dirección no la cambia el formulario público:** quien quiera corregirla lo hace desde la
   ficha. El formulario solo rellena lo que estaba en blanco, y solo si el celular escrito coincide con el de la ficha.
4. **Cada dirección nueva cuesta una consulta a Google Geocoding** (si la campaña tiene la clave). Hasta 200 inscripciones
   por enlace al día es el tope de la 277; si hace falta limitar el gasto, bajar ese tope en Votantes → «Inscripciones
   por enlace» → Ajustes.
5. **Aplicar después del 277, con la misma lista de campañas.** No hace falta `init-db`.

## Parche 277 — inscripción por enlace/QR del líder (7 de noviembre de 2026, INACTIVO)

Zip de 22 archivos (+ `.version-base` = 277), cada uno con su motivo:
`app.js` (monta `/i` **después** del candado de licencia, `/api/inscripcion` y el reloj de 60 s de la cola de SMS);
`config/confirmacionConsentimiento.js` (token de `/c` de 22 caracteres y búsqueda sin caducidad para la baja);
`config/inscripcionEnlace.js` y `config/inscripcionRegistro.js` (**nuevos**: el código del líder, el pase firmado
del formulario, la inscripción en transacción y el SMS de confirmación); `db/init-db.js` y `db/schema.sql` (tablas
y `origen`); `middleware/aspirante.js` (`/inscripcion` permitido al aspirante); `public/app/inicio.html` (entrada
«Mi enlace de inscripción»); `public/app/mi-enlace.html` (**nuevo**, QR, copiar, WhatsApp, descargar PNG, cambiar
enlace); `public/app/mis-registros.html` («Se inscribió solo · sin confirmar / confirmado» y «N por tu enlace»);
`public/js/qrcode-generator.js` (**nuevo**, librería de QR `qrcode-generator` 1.4.4, **licencia MIT, Kazuhiko
Arase**, con su cabecera de licencia intacta); `public/js/validacion-cedula-ui.js` (manda la cédula a
`sumar-a-mi-rama`); `public/service-worker.js` (`v155`); `public/votantes.html` (filtros, etiqueta y pestaña
«Inscripciones por enlace»); `routes/comunicaciones.routes.js` (los pendientes no entran en masivos);
`routes/confirmacion.routes.js` (`/c` ofrece la baja); `routes/dashboard.routes.js` (`porEnlace`);
`routes/inscripcion.routes.js` (**nuevo**, la página pública `/i/:codigo`) y `routes/inscripcion.panel.routes.js`
(**nuevo**, «Mi enlace» y el cuadro del escritorio); `routes/rescateVotos.routes.js` (el «Ya voté» tampoco sale a
un pendiente) y `routes/votantes.routes.js` (`sumar-a-mi-rama` acredita a la persona, filtros del listado y de la
exportación, y un comentario corregido).
Commits que recoge, en orden: `e2fd450` (`sumar-a-mi-rama`), `39842eb` (esquema), `9f65117` (librería de QR),
`dcbc2ab` (página pública, API y cola de SMS), `379f355` (pendiente de confirmar), `1f73c93` (pantalla del celular),
`8af7fb5` (escritorio) y `5c61a71` (SMS de 1 segmento y baja en `/c`), más `7bada64` (corrige el comentario falso
de `votantes.routes.js`: `config/sms.js` NO pega el «Baja: …»; lo pega `agregarBajaSms`, solo a los envíos de campaña).
`scripts/probar-inscripcion-enlace.js` y las pruebas **no viajan**.

- **Verificado sobre el zip:** los 22 archivos coinciden por md5 con el disco; no trae `.env`, `.credenciales-*`,
  `uploads/`, `legislacion/`, `backups/`, `scripts/` ni pruebas (el único `.sql` es `db/schema.sql`); sin secretos
  en el texto; `CACHE_NAME = 'estrategia-v155'`; `verificar-requires.js` revisó 133 `require` locales y todos
  resuelven **aplicando el zip sobre una copia del árbol del 276** (`40077aa`), y con un control negativo (sin
  `config/paginaBaja.js` falla, como debe). El archivo publicado tiene el mismo sha256 que el local.
- **Toca la base de datos (sí; lo marcó el servidor):** tablas `inscripcion_enlaces`, `inscripcion_intentos`,
  `inscripcion_config` (una fila con los topes), `votante_consentimiento_evidencia` e `inscripcion_sms_cola`;
  `votantes.origen` gana el valor `enlace_lider`. Todo idempotente (`init-db` dos veces seguidas, limpio, sobre una
  base vacía) y `scripts/probar-instalacion-limpia.js` pasa (58 tablas).
- **Probado solo con una base simulada** (un MySQL privado desechable): `scripts/probar-inscripcion-enlace.js`, 141
  comprobaciones. **No** se probó: un SMS real por Onurix o Twilio, escanear el QR con un celular (el QR se dibuja
  con la librería y se vio bien en una captura, pero ningún lector lo decodificó; intentar bajar un decodificador
  fue bloqueado por el clasificador de permisos y no se esquivó), ni la pestaña de escritorio en un navegador con sesión.
- **Cómo exige el 276.** El sistema no declara dependencias (ver «Cómo exige el 273», en el 274): **activar el 277
  con el 276 y los anteriores y con la misma lista de campañas.** Sin el 274 le falta `config/paginaBaja.js` y
  `/c` no arranca.

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Cada líder, sublíder y coordinador tiene su enlace y su QR** en el menú del celular, «Mi enlace de inscripción»
   (el administrador no tiene: no está en la estructura). La gente lo escanea y se inscribe sola: nombre, cédula,
   celular de 10 dígitos (empieza por 3), correo opcional, puesto y mesa opcionales (los del Día D de la campaña) y
   la casilla de autorización. «Cambiar mi enlace» deja de servir el QR anterior: si ya lo imprimieron, hay que
   volver a imprimirlo. El coordinador (y el administrador) puede desactivarlo o cambiarlo desde Votantes →
   «Inscripciones por enlace»; el administrador además fija el interruptor general y los topes (200 por enlace al día,
   3 por teléfono al día, 4 segundos mínimos).
2. **Lo inscrito por enlace queda «sin confirmar» y no recibe masivos ni el enlace «Ya voté» hasta confirmar** por
   el SMS (`/c`). Sale en cualquier canal: SMS, correo y push. Quien se inscribe solo con el correo y sin SMS no
   puede confirmar solo: el coordinador le pide la confirmación por correo con el botón de la ficha.
3. **Cada inscripción con el SMS marcado cuesta 1 SMS.** Es uno por persona en la vida y sale dentro de la franja
   (08:00–20:00; fuera de ella queda para la apertura). Texto: «{primer_nombre}, confirma tu inscripcion aqui:
   {enlace}»; con la firma de 30 caracteres mide 132, 147 y 151 con `electoral`, `campanadepruebamunicipal` y
   `campanadepruebadepartamental`. **No lleva el «Baja: …»**: la baja está en la página de `/c` («No quiero recibir
   más mensajes»). El token de `/c` de este SMS es de 22 caracteres; los enlaces de 64 que ya salieron siguen sirviendo.
4. **Una ficha que ya existía solo se completa si el celular escrito coincide con el que tenía.** Si la cédula es de
   otro líder, no cambia de dueño; el coordinador ve el intento (sin cédula) en la pestaña. La respuesta de la página
   es siempre «¡Listo!»: nunca dice si la cédula ya estaba.
5. **Requiere `LICENCIA_DOMINIO` en el `.env`** (todas las campañas ya la tienen, porque la licencia la exige). Sin
   ella: la licencia no valida y el candado bloquea todo, `/i` incluido; y, si aun así corriera, el SMS de
   confirmación **no sale** (queda `fallido` en `inscripcion_sms_cola` con el motivo, sin reintento) y el QR de
   «Mi enlace» se arma con el dominio desde el que se abrió la pantalla.
6. **`sumar-a-mi-rama` ya no acepta un id suelto:** exige que la ficha esté en el alcance de quien llama o que traiga
   la cédula que coincide (el formulario ya la manda).
7. **Aplicar después del 276, con la misma lista de campañas, y correr `npm run init-db`** (el actualizador lo hace
   solo porque `toca_base_datos` es sí).

## Parche 276 — Día D fase 4: cobertura, check-in, alertas y avisos (7 de noviembre de 2026, INACTIVO)

Zip de 36 archivos: `app.js`, `db/init-db.js`, `db/schema.sql`, `lib/alertasDiaD.js`, `lib/avisosAlertas.js`,
`lib/coberturaTestigos.js`, `lib/jornadaDiaD.js`, `lib/mesasEnVivo.js` (los cinco, nuevos),
`middleware/aspirante.js`, `public/app/alertas-dia-d.html` y `public/app/checkin.js` (nuevos),
`public/app/dia-d.html`, `public/app/faltantes.html`, `public/app/inicio.html`, `public/configuracion.html`,
`public/css/style.css`, `public/dia-d.html`, `public/enviar-sms.html`, `public/js/alertas-dia-d.js` y
`public/js/cobertura-testigos.js` (nuevos), `public/js/common.js`, `public/js/offline-utils.js`,
`public/js/segmentos-sms.js`, `public/service-worker.js` (`v154`), `public/territorial.html`,
`public/votantes.html`, `routes/alertasDiaD.routes.js`, `routes/checkinDiaD.routes.js` y
`routes/coberturaTestigos.routes.js` (nuevos), `routes/comunicaciones.routes.js`, `routes/diaD.routes.js`,
`routes/permisos.routes.js`, `routes/rescateVotos.routes.js`, `routes/resultadosDiaD.routes.js`,
`routes/votantes.routes.js` y `.version-base` (276).
Commits que recoge, en orden: `8c186e1` (cobertura de testigos), `356eb0c` (aviso al testigo por SMS),
`f735d11` (plantilla más corta), `12bed88` (servidor de la fase 4), `eaeb2d4` (pantallas de la fase 4),
`ec3c1fe` (avisos push automáticos) y `cb077c8` (interruptor, diagnóstico y franja).

- **Verificado sobre el zip:** los 36 archivos coinciden por md5 con el disco; no trae `.env`,
  `.credenciales-*`, `uploads/`, `legislacion/`, `backups/`, `scripts/` ni pruebas; `CACHE_NAME =
  'estrategia-v154'`; `verificar-requires.js` revisó 158 `require` locales y todos resuelven, **aplicando el
  zip sobre una copia del árbol del 275** (`ba98b06`).
- **Toca la base de datos (sí; lo marcó el servidor):** tablas `dia_d_suplentes_testigo`, `dia_d_checkin`,
  `dia_d_alertas_atendidas` y `dia_d_alertas_avisadas`; en `configuracion_campana`: `max_mesas_por_testigo` y los
  siete de la jornada (`jornada_apertura`, `jornada_cierre`, `plazo_e14_min`, `alerta_checkin_min`,
  `baja_votacion_pct`, `baja_votacion_desde`, `avisos_alertas_push`); `votantes.necesita_transporte`; el módulo
  de permisos `alertas_dia_d` (admin y coordinador de fábrica) y la plantilla «Testigo - aviso de asignacion».
  Todo idempotente, con «ya existía». IndexedDB del celular sube a la versión 4.
- **Probado solo con bases simuladas.** No se corrió `init-db` en MySQL, ni un push real, ni nada en un celular o
  un navegador. La latencia real de una vuelta de avisos no se midió (solo su CPU: ~230 ms la primera con 300
  alertas y 12 destinatarios, ~50 ms las siguientes).

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Revisar los horarios de la jornada ANTES del día:** Configuración → Datos de la campaña → «Jornada del Día
   D» (apertura 08:00, cierre 16:00, plazo del E-14 120 min, aviso de llegada 30 min, baja votación 40 % desde las
   12:00). Salen con esos valores por omisión; sin la fecha de elección configurada, los avisos automáticos no
   trabajan. Solo el administrador de la campaña principal los edita.
2. **Los coordinadores deben abrir la app del celular y activar los avisos** (casilla «Recibir avisos en este
   dispositivo», en la pantalla de inicio; en iPhone, con la app agregada a la pantalla de inicio). La franja
   «Activa los avisos…» se lo recuerda, y la pestaña Alertas del escritorio muestra «N coordinadores sin avisos
   activados» con nombres y teléfonos.
3. **El Excel de acreditación pone «CC» y separa nombres y apellidos de forma aproximada** (la app no guarda el
   tipo de documento y `usuarios` tiene un solo campo de nombre): revisarlo antes de enviarlo. El formato no es el
   de la Registraduría —no hay rastro de él en el repositorio—; las columnas son las de la orden 18.
4. **Una misma alerta se avisa una sola vez por día** (clave tipo + puesto + mesa + fecha) y a lo sumo un push cada
   5 minutos por persona, agrupado. Una alerta atendida no se avisa. Los avisos son solo de los tipos 1 a 6
   (no «mesa sin testigo y sin votantes propios») y solo activas (no las «pendiente»).
5. **El aviso al testigo por SMS no lleva el «Baja: …» automático** y la plantilla «Testigo - aviso de
   asignacion» cabe en 1 SMS con puestos de hasta 43 caracteres (dominio departamental, firma de 30, una mesa).
6. **Aplicar después del 275, con la misma lista de campañas.** El 276 no declara su dependencia: sin el 275 y los
   anteriores le faltarían `config/paginaBaja.js` y las tablas de la fase 2.
7. **Correr `npm run init-db`** (el actualizador lo hace solo porque `toca_base_datos` es sí).

## Parche 275 — tarjeta de vista previa del enlace «Ya voté» (7 de noviembre de 2026, INACTIVO)

Zip de 5 archivos: `app.js`, `public/img/ya-vote-og.png` (nuevo, **binario**, 13.501 bytes),
`public/service-worker.js` (`v151`), `routes/yaVoto.routes.js` y `.version-base` (275).
Commits que recoge: `3782e85` (la tarjeta Open Graph y su imagen) y `1bbdaac` (la página «no activo» de
`/v` responde 200 en vez de 404). `scripts/generar-imagen-ya-voto.js` (con el que se hizo la imagen) y las
pruebas **no viajan**.

- **Verificado sobre el zip:** los 5 archivos coinciden por md5 con el disco (el PNG, además, byte a byte y
  marcado como binario en el listado del zip); no trae `.env`, `.credenciales-*`, `uploads/`, `legislacion/`,
  `backups/` ni `scripts/`; `CACHE_NAME = 'estrategia-v151'`; `verificar-requires.js` revisó 41 `require`
  locales y todos resuelven **aplicando el zip sobre una copia del árbol del 274** (`7206133`).
- **NO toca la base de datos** (`toca_base_datos = false`): no hay cambios en `db/`, y no hace falta `init-db`.
- **Qué hace:** `GET /v/<token>` lleva en el `<head>` `og:title` «Avísanos cuando votes ✓», `og:description`,
  `og:site_name` (el `marca_titulo` de la campaña), `og:type`, `og:image` absoluta (1200×630, con alt) y
  `twitter:card summary_large_image`; WhatsApp y Google Mensajes arman con eso una tarjeta grande con el ✓,
  que se toca como un botón. **Nada del votante** entra en los metadatos, y son idénticos para un token
  válido, inexistente, mal formado, vencido, ya votado y fuera del día. La página `?baja=1` no lleva tarjeta
  grande, solo título. La imagen se sirve en `/img/ya-vote-og.png` sin sesión, antes del candado de licencia,
  con caché de un día. «No activo» responde ahora **200** (antes 404) con la misma página, porque un cliente
  puede descartar —y cachear así— la tarjeta de una respuesta 404; el **límite de intentos por IP sigue
  contando esas respuestas** (`requestWasSuccessful` + `res.locals.noActivo`), así que adivinar tokens se corta
  igual con 429. La página ya llevaba `<meta robots noindex, nofollow>` y `X-Robots-Tag: noindex, nofollow`.
- **Probado solo con bases simuladas y el servidor de la app.** No se vio la tarjeta en WhatsApp ni en Google
  Mensajes reales, ni la imagen servida por el Nginx de una campaña.

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Aplicar después del 274, con la misma lista de campañas.** El 275 no declara su dependencia: si una
   campaña lo recibiera sin el 274 le faltaría `config/paginaBaja.js` y `/v?baja=1` fallaría.
2. **La tarjeta solo sale bien si la campaña tiene `marca_titulo` y el dominio de la licencia
   (`LICENCIA_DOMINIO`) correctos.** Sin `marca_titulo`, la tarjeta sale sin nombre de campaña; sin dominio en
   el `.env`, sale **sin imagen** (la URL de `og:image` se arma con ese dominio, nunca con la cabecera Host).
3. **En iPhone, la tarjeta del SMS solo sale si el remitente está en los contactos.** Es del sistema, no de la
   aplicación. WhatsApp y Google Mensajes (Android) no tienen esa condición.
4. **La vista previa se cachea en el cliente.** Si un robot pide el enlace antes del día de la elección, recibe
   la página «no activo» (200, con la misma tarjeta): la tarjeta sale igual, pero conviene mandar los enlaces
   el día de la elección. El correo **no** acepta `{enlace_ya_vote}` (el envío lo rechaza con 400).

## Parche 274 — SMS de 1 segmento, Día D fase 3, baja a mano y enlace desde Faltantes (7 de noviembre de 2026, INACTIVO)

Zip de 30 archivos: `app.js`, `config/bajaContacto.js`, `config/paginaBaja.js` (nuevo), `config/sms.js`,
`config/yaVotoEnlace.js`, `db/init-db.js`, `db/schema.sql`, `lib/puestosDiaD.js` (nuevo),
`lib/transliterarSms.js` (nuevo), `middleware/aspirante.js`, `public/app/dia-d.html`,
`public/app/faltantes.html`, `public/dia-d.html`, `public/enviar-sms.html`, `public/js/baja-manual.js`
(nuevo), `public/js/common.js`, `public/js/segmentos-sms.js`, `public/no-contactar.html`,
`public/service-worker.js` (`v150`), `public/territorial.html`, `public/votantes.html`,
`routes/baja.routes.js`, `routes/comunicaciones.routes.js`, `routes/diaD.routes.js`,
`routes/permisos.routes.js`, `routes/rescateVotos.routes.js`, `routes/resultadosDiaD.routes.js` (nuevo),
`routes/territorial.routes.js`, `routes/yaVoto.routes.js` y `.version-base` (274).
Commits que recoge, en orden: `2505f75` (SMS «Ya voté» en 1 segmento), `6fb6ebb` (Día D fase 3),
`8523964` (baja a mano y confirmación), `e6a0e9c` (quita el envío automático de la baja) y `5a514fc`
(enlace «Ya voté» desde Faltantes). `aa7804a` (ESTADO del 273) es el punto de partida y no viaja.

- **Verificado sobre el zip:** los 30 archivos coinciden por md5 con el disco; no trae `.env`,
  `.credenciales-*`, `uploads/`, `legislacion/` ni `backups/`; `CACHE_NAME = 'estrategia-v150'`;
  `verificar-requires.js` revisó 119 `require` locales y todos resuelven, **también aplicando el zip
  sobre una copia del árbol del 273** (`aa7804a`), que es el estado de una campaña con el 273 puesto.
- **Toca la base de datos (sí; lo marcó el servidor):** columna `dia_d_reporte_votos.grupo`; tablas
  `dia_d_resultado_oficial`, `dia_d_mesa_revision` y `dia_d_paquetes`; columnas `no_contactar_canal` y
  `no_contactar_motivo` en `votantes` y `usuarios`; módulo de permisos `resultados_dia_d` (admin y
  coordinador de fábrica); la plantilla de SMS «Dia D - aviso ya voto» pasa a la corta (o nace
  «… (corto)» si el administrador la había editado) y la de correo «Bienvenida al equipo» deja de decir
  «respóndanos y lo retiramos» (solo si seguía idéntica a la sembrada). Todo idempotente, con «ya existía».
- **Probado solo con bases simuladas.** No se corrió `init-db` en MySQL, ni un SMS por Onurix, ni nada en
  un celular real: según la orden 14, Gildardo probó en la Base las órdenes 9, 11, 12/12b y 13 antes de pedir este parche.

**Cómo exige el 273 (y por qué no lo exige de verdad).** El sistema NO tiene una dependencia
declarada entre parches. `GET /parches/disponibles` (licencias) devuelve **todos los activos con número
mayor** que el de la campaña y que le correspondan por distribución, **en orden ascendente**; el
actualizador los aplica uno tras otro y se detiene si uno falla. O sea: con el 273 y el 274 activos y
en la lista de la campaña, el 273 va siempre primero. Pero **si el 273 queda inactivo, o la campaña no
está en su lista, el 274 le llegaría solo**, sin `config/yaVotoEnlace.js` ni las tablas de la fase 2, y
las pantallas nuevas fallarían. Por eso: **activar el 272, el 273 y el 274 juntos y con la misma
lista de campañas**. El nombre del 274 en el panel dice «Requiere el 273».

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **El SMS «Ya voté» ya cabe en 1 mensaje.** El texto no lleva la baja: va en la página del enlace
   («No quiero recibir más mensajes», `/v/<token>?baja=1`). La plantilla corta
   («{primer_nombre}, hoy votamos. Cuando votes, avisanos aqui: {enlace_ya_vote}») mide menos de 160
   con la firma del operador. Esta nota **reemplaza** a la del 273 que decía que ocupaba 2.
2. **Todo SMS sale sin tildes ni ñ** (á→a, ñ→n, ¿ y ¡ se quitan), el de la campaña y el de Onurix.
   WhatsApp y correo no se tocan. El contador de «Enviar SMS» lo dice.
3. **El enlace «Ya voté» solo sale a votantes con consentimiento = 1 en ese canal.** Con el consentimiento
   sin registrar (NULL) o en 0 no sale: ni por envío masivo ni desde Faltantes en el celular del líder.
   Tampoco sale si `no_contactar = 1`, si no hay fecha de elección o si la persona no tiene teléfono.
4. **La pestaña «Resultados» (Día D) la ven admin y coordinador** (módulo `resultados_dia_d`, activo
   de fábrica solo para ellos; el aspirante la ve por su lista propia). No existe rol de abogado: para
   uno, crear un usuario de rol *administrativo* y darle el módulo `resultados_dia_d` en Permisos.
5. **Los paquetes del abogado se borran a las 24 horas** (al arrancar y cada hora). Si el servidor se
   reinicia mientras arma uno, queda en «error» y hay que pedirlo de nuevo.
6. **La baja se da SOLO al tocar el botón.** `/b` y `/v?baja=1` dicen «Aún no estás dado de baja» y
   tienen un botón grande; no se envía nada al cargar la página (Google abre los enlaces con un Chrome
   real). Quien abre el enlace y se va no queda de baja: para eso está **«Marcar como no contactar»**
   en la ficha del votante y en «Editar persona» (admin y coordinador, con canal y motivo obligatorios;
   queda en «Pidieron no recibir más» y en la auditoría).
7. **En Faltantes, el líder manda el enlace desde su celular:** WhatsApp con enlace, botón «SMS» (sale
   del plan del celular del líder, sin firma ni baja) y «Copiar enlace». Funciona sin señal porque el
   enlace viaja en la lista. No se probó en un iPhone ni en un Android real: el separador de `sms:`
   es `&` en iPhone y `?` en Android.
8. **Correr `npm run init-db`** (el actualizador lo hace solo porque `toca_base_datos` es sí).

## Parche 273 — Día D fase 2: «ya votó» (6 de noviembre de 2026, INACTIVO)

Zip de 22 archivos: `app.js`, `config/yaVotoEnlace.js`, `db/init-db.js`, `db/schema.sql`,
`lib/alcanceVotantes.js`, `middleware/aspirante.js`, `public/app/faltantes.html`,
`public/app/inicio.html`, `public/app/ranking-dia-d.html`, `public/configuracion.html`,
`public/dia-d.html`, `public/enviar-sms.html`, `public/js/common.js`, `public/js/offline-utils.js`,
`public/js/whatsapp-lote.js`, `public/service-worker.js` (`v147`), `public/votantes.html`,
`routes/comunicaciones.routes.js`, `routes/permisos.routes.js`, `routes/rescateVotos.routes.js`,
`routes/yaVoto.routes.js` y `.version-base` (273).
Commits que recoge: `207b195` (la fase 2), `374f434` (la fecha de elección dentro del token y el
ranking en el menú del aspirante) y `67a8a23` (init-db dice «ya existía» para las tablas nuevas).

- **Verificado sobre el zip:** los 22 archivos coinciden por md5 con el disco; no trae `.env`,
  `.credenciales-*`, `uploads/`, `legislacion/` ni `backups/`; `CACHE_NAME = 'estrategia-v147'`;
  `verificar-requires.js` revisó 70 `require` locales y todos resuelven.
- **Qué trae:** tablas `votante_votos` y `votante_voto_tokens`; índices en `votantes` (`sublider_id`,
  `puesto_id`, solo si no había ya uno); módulo de permisos `rescate_votos` (admin, coordinador, líder
  y sublíder de fábrica; el aspirante por `PERMISOS_ASPIRANTE`); dos plantillas de arranque; API
  `/api/dia-d/rescate` (faltantes por puesto, marcar idempotente, desmarcar con auditoría, resumen por
  hora y puesto, ranking de líderes, enlace de WhatsApp, vaciar marcas con la contraseña propia);
  enlace público `/v/<token>`; en el CRM `{enlace_ya_vote}`, `{primer_nombre}` y el filtro «Mis votantes
  que aún no han votado», con regla estricta de consentimiento solo para esos mensajes; pantallas
  `app/faltantes.html` (lista por puesto, cola y copia sin señal), `app/ranking-dia-d.html` y la pestaña
  «Avance de votación» de `dia-d.html`; IndexedDB sube a la versión 3. **Arregla el alcance del
  sublíder**, que veía su lista vacía (`lib/alcanceVotantes.js`).
- **Probado solo con bases simuladas y SQL sobre sqlite.** No se corrió `init-db` en MySQL, ni nada en
  un celular real, ni un SMS real. Esas pruebas las hace Gildardo en la Base antes de activar.

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **La campaña necesita `fecha_eleccion` en Configuración → Datos de la campaña.** Sin ella no se
   genera ningún enlace «Ya voté» (el envío se rechaza con ese mensaje) y las pantallas siguen
   funcionando en «modo prueba». El enlace solo sirve el día de esa fecha.
2. **Cambiar la fecha invalida los enlaces ya enviados.** La fecha va dentro del token (HMAC de
   votante + fecha): hay que volver a mandarlos. Configuración lo avisa junto a la fecha y pide
   confirmación al guardar. Vale también para una segunda vuelta.
3. **Correr `npm run init-db`** (el actualizador lo hace solo porque `toca_base_datos` es sí). La
   aplicación no se rompe sin las tablas nuevas, pero las pantallas de rescate sí darían error.
4. **Los votantes sin consentimiento de SMS registrado (NULL) NO reciben el enlace**: la regla estricta
   es solo para esos mensajes y no cambia la del resto del módulo.
5. El token se deriva de `SESSION_SECRET`: rotarlo invalida también estos enlaces (y los de baja).

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

---
<!-- cierre automático -->
Sesión cerrada: 2026-11-07 12:52 UTC desde srv1807015
Rama: auditoria-fable | Commit: 40077aa Parche 276: .version-base a 276 y ESTADO.md (Día D fase 4: cobertura, check-in, alertas y avisos push; publicado y registrado INACTIVO) | Sin commitear: 3 archivo(s)
