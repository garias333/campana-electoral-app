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

- **Último parche generado: 291** (`parches/campana-parche291.zip`, 95.914 bytes,
  sha256 `665a3fa0d08eac5a6c0d927a11f904dda06456a2954624560ce4a81c852ec396`, 5 archivos).
  **Publicado** (`parche-291.zip`, misma huella) y **registrado y firmado (Ed25519), INACTIVO**, con **`toca_base_datos = false`**;
  nombre en el panel: «Menú del celular: se cierra al tocar un ítem y muestra la vista (Requiere el 290)» (detalle abajo); **requiere el 290**.
  Service worker `v165`. El anterior, el 290 (`parches/campana-parche290.zip`, 24.454 bytes,
  sha256 `9aa6f863614e3fa5328f11f6ee15292b83e5a1fe7b0ced974f28e406ce0bc828`, 6 archivos).
  **Publicado** (`parche-290.zip`, misma huella) y **registrado y firmado (Ed25519), INACTIVO**, con **`toca_base_datos = false`**;
  nombre en el panel: «Páginas del celular: contenedor main.app-cuerpo y service worker v164 (Requiere el 289)» (detalle abajo); **requiere el 289**.
  Service worker `v164`. El anterior, el 289 (`parches/campana-parche289.zip`, 210.581 bytes,
  sha256 `33dee58cfeed248031c944ed91202e65d849ffb876eeb8411028f07cbf0ab6c7`, 21 archivos).
  **Publicado** (`parche-289.zip`, misma huella) y **registrado y firmado (Ed25519), INACTIVO**, con **`toca_base_datos = true`**;
  nombre en el panel: «Día D: logística (refrigerios y kits) y Panel por rol (Requiere el 288)» (detalle abajo); **requiere el 288**.
  Service worker `v163`. El anterior, el 288 (`parches/campana-parche288.zip`, 12.664 bytes,
  sha256 `ad6c6bf1a07c7825e04484a4d54cec833787fd6dcf1a9858e6bc34f4544961fa`, 2 archivos: `routes/dashboard.routes.js` y `.version-base`).
  **Publicado** (`parche-288.zip`, misma huella) y **registrado y firmado (Ed25519), INACTIVO**, `toca_base_datos = false`; nombre en el panel:
  «Panel general por alcance (Requiere el 287)» (detalle abajo); **requiere el 287**. No cambia el service worker (sigue `v162`).
  El anterior, el 287 (`parches/campana-parche287.zip`, 138.322 bytes,
  sha256 `1af4844083ce9152529bfd336ff820e4b7022f6aff97da792ba8119b9bbafbad`, 9 archivos).
  **Publicado** en la carpeta de licencias (`parche-287.zip`, misma huella) y
  **registrado y firmado (Ed25519), INACTIVO**, con **`toca_base_datos = false`**; nombre en el panel:
  «Comunas validadas y dashboard por zona (Requiere el 286)» (detalle abajo); **requiere el 286**.
  El anterior, el 286 (`parches/campana-parche286.zip`, 244.821 bytes,
  sha256 `edac98f0d40f3229aa4370deb1fb9a90f1e0d40435f3cffd27adba8bffda54c2`, 21 archivos, transporte parte 2,
  `toca_base_datos = true`, requiere el 285), sigue publicado e inactivo, igual que el 285 (`parches/campana-parche285.zip`, 101.622 bytes,
  sha256 `767fd7efbe66bb93d38e0fd8286b02ab3d96c992bd240f536be741c2a841cc93`, 5 archivos, menú de Día D,
  `toca_base_datos = false`, requiere el 284), sigue publicado e inactivo, igual que el 284 (`parches/campana-parche284.zip`, 282.785 bytes,
  sha256 `00eacb9230ab661b1a9ffac49cd51b70151df4af91939ca70fc6104ab73c6333`, 28 archivos, transporte parte 1,
  `toca_base_datos = true`, requiere el 283), sigue publicado e inactivo, igual que el 283 (`parches/campana-parche283.zip`, 110.782 bytes,
  sha256 `60fecc764fba702e864f7dac158075c9e980ba185eebdd8a70a81e4dcd398f52`, 6 archivos, privacidad al buscar
  cédula y SMS al reinscribirse, `toca_base_datos = true`, requiere el 282), sigue publicado e inactivo, igual que el 282 (`parches/campana-parche282.zip`, 79.606 bytes,
  sha256 `cfe2292831b80eb8246134fd7f1a478fc646b1bc91ebc73b5cb738a50ccca32c`, 9 archivos, cédulas sin duplicados,
  `toca_base_datos = false`, requiere el 281), sigue publicado e inactivo, igual que el 281 (`parches/campana-parche281.zip`, 152.925 bytes,
  sha256 `bb30c0ffcb0fd1327790009cd780b09a1fcb2373d900ef7e6d2d7ed7f22a7298`, 10 archivos, mensaje de invitación con
  eslogan, `toca_base_datos = true`, requiere el 280), sigue publicado e inactivo, igual que el 280 (`parches/campana-parche280.zip`, 119.765 bytes,
  sha256 `dd45aec9f83de9ec25e8d633657cf7106337fd372cec712f4516806ef9faa40a`, 9 archivos, botón a la Registraduría y
  control de cédulas, `toca_base_datos = true`, requiere el 279), sigue publicado e inactivo, igual que el 279
  (`parches/campana-parche279.zip`, 22.390 bytes, sha256 `27ceca3c28a0a081866e18a50e50ddd0845c2b8f45610121e50f1e329ec1e0ee`,
  3 archivos, formulario por secciones y GPS, `toca_base_datos = false`, requiere el 278), sigue publicado e inactivo, igual que el 278 (`parches/campana-parche278.zip`, 18.199 bytes,
  sha256 `673b60c0f58bec76b55b688a9555c23f2194bb496dc407e425183e66ad6ee02b`, 3 archivos, datos de contacto completos,
  `toca_base_datos = false`, requiere el 277), sigue publicado e inactivo, igual que el 277 (`parches/campana-parche277.zip`,
  278.601 bytes, sha256 `c1804c429d701fbcb03890b892a089e0cb41be5d945a71563fbbe10178700fc4`, 22 archivos, inscripción
  por enlace/QR del líder, `toca_base_datos = true`, requiere el 276), sigue publicado e inactivo, igual que el 276 (551.144 bytes,
  `28471a84304ebc590121351690020621f2adb288a9b0783a2b9f5b1e1d46a40c`, 36 archivos, Día D fase 4, requiere
  el 275), sigue publicado e inactivo, igual que los anteriores —275 (33.002 bytes, `da76d397…`, 5 archivos, tarjeta «Ya voté»), 274 (456.956 bytes,
  `3c69dddb…`, 30), 273 (`11b498b6…`, 22) y 272 (`f4333fcb…`, 11)— siguen publicados e inactivos; los zip
  265 a 271 también están publicados.
  **Distribución del 289 (y del 288, 287, 286, 285, 284, 283, 282, 281, 280, 279, 278, 277, 276, 275, 274, 273 y 272): NO MEDIDA, y la fija Gildardo en el panel ANTES de
  activar.** `registrar-parche.js` no manda `modo_distribucion` y la columna nace en «todos» (pendiente 9 de
  abajo): hay que ponerlo en «seleccionadas» y marcar solo las campañas elegidas —**las mismas en los
  siete**—, nunca la Base. El sistema no declara dependencias entre parches (ver «Cómo exige el 273», en el 274).
- **Registrado / activo / aplicado en las campañas: NO MEDIDO.** Hay que mirar
  `.version-parche` y `logs/actualizaciones.log` de municipal, departamental y c001-2027
  (bloque d) del traspaso, abajo). En la Base, `.version-parche` y `.version-base` = **273**
  (la Base no recibe parches: los genera); desde el 289, `.version-parche` y `.version-base` = **289**. Ni el 272, ni el 273, ni el 274, ni el 275, ni el 276, ni el 277, ni el 278, ni el 279, ni el 280, ni el 281, ni el 282, ni el 283 ni el 284 se han activado ni aplicado a ninguna campaña.
- **Service worker:** `estrategia-v165` en el código de la Base y dentro del 291; `v164` dentro del 290; `v163` dentro del 289 (el 288 no lo toca; el 287 lleva `v162`; el 286 lleva `v161`; el 285 lleva `v159`; el 284 lleva `v158`; el 281 lleva `v157`; el 282 y el 283 no lo tocan; el 280 lleva `v156`; el 278 y el 279 no lo tocan; el 277 lleva `v155`; el 276 lleva `v154`; el 275 lleva `v151`; el 274, `v150`; el 273 lleva `v147`;
  el 272, `v146`; el 271, `v145`). Cada campaña lo tendrá cuando reciba el 273. Las páginas nuevas
  `app/faltantes.html` y `app/ranking-dia-d.html` van en su precache.
- **La Base corre el código del 271.** Su proceso (`app.js`, pid 2883929) arrancó a las
  19:18:41, después de la última edición de código de ejecución (19:07:07). Su `.env` tiene
  `TELEGRAM_BOT_TOKEN` y `TELEGRAM_SUPERADMIN_CHAT_ID` con valor (solo se comprobó que no
  estén vacías) y **no** tiene `APP_NOMBRE`: el mensaje dice «Estrategia | App electoral». El
  registro de PM2 muestra **un** «Telegram OK» y ningún «Telegram falló».
- **Plantilla vigente: v290, ya atrás del parche 291** (menú del celular; su `.version-base` es 290 y su service worker `v164`): **no regenerada, a pedido**; se regenerará con `--parche 291` (o el último) antes de crear una campaña nueva. Hasta entonces la campaña nueva recibe el 291 en su primer ciclo de actualización.
- **Plantilla v290 (8 de noviembre de 2026)** (8 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v290.zip`,
  2.010.775 bytes, **261 archivos** (284 entradas con las carpetas), sha256 `7fae8431d9546c8ddf4c8fc29ddf6880adc323a81b7068162654a45d28a73559`,
  service worker `estrategia-v164`, `.version-parche` y `.version-base` = 290. Generada con
  `node scripts/generar-plantilla.js --parche 290`; escaneo de secretos del generador sin hallazgos. Revisión aparte sobre el zip: sin `.env`
  (sólo `.env.example`, con los secretos vacíos), `.licencia-cache.json`, `.credenciales-*`, `node_modules`, `backups/` ni `parches/`; la única `.pem`
  es la pública de los parches (`BEGIN PUBLIC KEY`). El patrón de asignación de secretos coincide en ocho archivos, todos marcadores de ejemplo (los mismos que en la v289):
  los `SESSION_SECRET` de reserva de los seis `scripts/probar-*.js`, `public/ayuda.html` (`DB_PASSWORD=tu_clave`) y el comentario de `config/mailer.js`.
  Mismos archivos que la v289; cambian cuatro por dentro (`faltantes.html` y `mis-registros.html` ya con `<main class="app-cuerpo">`, y `.version-base` y `.version-parche`):
  no queda ningún `app-contenido` en todo el zip.
  Probada: la plantilla extraída en una carpeta aparte, `init-db.js` sobre una base vacía (mysqld privado) deja **64 tablas**, con los tres ítems de fábrica de logística
  (Kit de testigo 07:00, Refrigerio 12:00, Almuerzo 14:00) y `logistica_dia_d` sembrado para admin y coordinador; una segunda corrida deja 3 ítems y 64 tablas;
  `verificar-html.py` da etiquetas balanceadas y JS válido en las cuatro páginas del celular tocadas. Esta plantilla ya trae lo que entrega el parche 290.
  **La v289, la v286, la v271 y las v261/v262 siguen en la carpeta pero ya no sirven** para una campaña nueva: usar la v290. Si después se publica otro parche,
  hay que regenerarla (`--parche N`, y `--forzar` si el nombre ya existe) antes de crear una campaña.
- **Ranking y Alertas del Día D, contenedor** (commit `d48db1d`, 8 de noviembre de 2026): `public/app/ranking-dia-d.html` y `public/app/alertas-dia-d.html`
  envolvían todo en `<div class="app-contenido">`, una clase que **no existe** en `estilos-app.css` (no faltaba en el HTML: faltaba el CSS), así que las
  tarjetas salían pegadas a los bordes. Pasan a `<main class="app-cuerpo">`, la de `dia-d.html`, `inicio.html` y `logistica.html`. Service worker `v164`; las
  pruebas que fijaban la versión (`probar-inscripcion-enlace`, `probar-transporte-diad`, `probar-logistica`) aceptan v164. **Mismo defecto sin tocar** en
  `app/faltantes.html` y `app/mis-registros.html`; se arreglaron después (commit `75076e3`) y viajan juntos en el parche 290.
- **`scripts/comparar-instancias.js`** (medido el 31 de agosto, NO re-medido): 137 archivos,
  1 sola diferencia en cada campaña — `scripts/calibrar_cohortes.js`, que existe solo allí;
  el sistema de parches no sabe borrar (`unzip -o`).
- **Rama:** `auditoria-fable`, publicada en GitHub (ver «Remoto» abajo). Árbol: `legislacion/`
  y dos guiones sin versionar (`scripts/respaldar-base-instalacion.sh`,
  `scripts/verificar-parche264.sh`; ya no viajan en plantillas, ver abajo). `CLAUDE.md`
  quedó commiteado (`0c2311a`, «notas de sesión»: el puerto de escucha, 4200 → 3005).

## Parche 291 — Menú del celular: se cierra al tocar un ítem y muestra la vista (8 de noviembre de 2026, INACTIVO, no toca la base)

Zip de 5 archivos (`.version-base` = 291): `public/js/common.js`, `public/css/style.css`, `public/votantes-dashboard.html`, `public/service-worker.js` (**v165**) y `.version-base`. Commit `2d5da70`. **Requiere el 290.** Sin `db/`: no toca la base.

**Síntoma (PWA en el celular):** al tocar «Transporte del Día D» el ítem se resaltaba, el menú no se cerraba y no se veía la pestaña. Igual con Logística, Avance, Alertas y Resultados.

**Causa (reproducida en Chromium a 390 px, con el menú de `dia-d.html`):** no fallaba el cambio de pestaña. El clic en un ítem de la misma página lo atiende `common.js` (`paginaEscuchaHash`): cambia la URL con `pushState` y despacha `hashchange`, y `dia-d.html` lo escucha y muestra la pestaña
(`vista-transporte` pasaba a `display:block` y el ítem quedaba activo). Lo que no existía era un menú que cerrar: hasta 640 px el CSS apila el `.sidebar` como bloque estático **encima** del contenido (`.app-shell` en columna; **880 px de alto**) y siempre abierto. La pestaña quedaba a partir de
y = 880, la pantalla seguía mostrando el menú (`scrollY` 188-227) y nada la llevaba al contenido. Entrar desde otra página tenía la misma forma: la página carga arriba, con el menú abierto y la vista debajo. Sirve igual para `configuracion.html`, que también escucha el ancla.

**Arreglo:** en pantalla angosta el menú nace **cerrado** tras una barra pegajosa «☰ Menú · <vista actual>» (botón de 44 px, `aria-expanded`, la vista actual sale del ítem activo); se abre con el botón y se **cierra** al tocar cualquier ítem (`a[data-nav-href]`; los títulos de grupo no, que sólo despliegan su submenú), al cambiar el ancla (también con el botón «atrás»)
y con Escape. Tras un cambio de vista en la misma página se hace `scrollTo(0, 0)`, de modo que la pestaña queda a la vista. Entrando desde otra página, la página nueva carga con el menú cerrado y la vista del ancla arriba. En pantalla ancha (>640 px) la barra no se ve y no cambia nada (comprobado a 1280 y 820 px: barra oculta, menú pegajoso, un ítem de la misma página cambia la pestaña).
La barra se oculta también en `html.modo-app` (`territorial.html` ya trae su propia barra) y al imprimir (`votantes-dashboard.html`). Código: `common.js` (bloque «MENÚ EN EL CELULAR», `ponerMenuMovil`, `marcarActivoMenu`, los dos manejadores de clic y de `hashchange`) y `style.css` (dentro del `@media (max-width: 640px)` y reglas de la barra).

**Decisión que conviene saber:** el menú plegado cambia **todas** las pantallas de escritorio vistas en un celular, no sólo el Día D: antes se veía abierto arriba en cada una y ahora hay que tocar «☰ Menú». Fue lo más simple que cumple «el menú se cierra»; si se prefiere dejarlo abierto en otras páginas, es acotar la regla CSS.

Probado en Chromium (390 px, servidor de pruebas con la sesión y la API simuladas): carga con el menú cerrado y «Jornada electoral» en la barra; abrir; tocar Transporte, Logística, Avance, Alertas, Resultados y Jornada (sin ancla): en los seis el menú queda cerrado, el hash cambia, la vista correcta es la única visible y queda en pantalla;
Escape lo cierra; la carga directa `dia-d.html#transporte` muestra Transporte con el menú cerrado. Suites `probar-logistica`, `panel-alcance`, `comunas-dashboard`, `transporte-diad`, `transporte-parte2` e `inscripcion-enlace` sin fallos; `verificar-html.py` en `dia-d.html` y `votantes-dashboard.html`.
**No probado:** un teléfono real ni la PWA instalada (se emuló el tamaño y el toque en Chromium); los datos de Avance, Alertas y Resultados en el simulador son vacíos, así que no se comprobó que pinten bien; las otras pantallas de escritorio con el menú plegado sólo se miraron en `dia-d.html`.

## Parche 290 — Páginas del celular: contenedor main.app-cuerpo y service worker v164 (8 de noviembre de 2026, INACTIVO, no toca la base)

Zip de 6 archivos (`.version-base` = 290): `public/app/alertas-dia-d.html`, `public/app/ranking-dia-d.html`, `public/app/faltantes.html`, `public/app/mis-registros.html`,
`public/service-worker.js` (**v164**) y `.version-base`. Commits `d48db1d` (Ranking y Alertas + SW) y `75076e3` (Faltantes y Mis registros). **Requiere el 289.** Sin `db/`: no toca la base.

Las cuatro pantallas envolvían todo en `<div class="app-contenido">`, una clase que no existe en `estilos-app.css`; las tarjetas salían pegadas a los bordes. Pasan a
`<main class="app-cuerpo">` (padding de 18 px y ancho máximo de 560 px), la de `dia-d.html`, `inicio.html` y `logistica.html`. El service worker sube a v164 una sola vez para los cuatro archivos
(estaban en su precache y v164 no se había entregado antes). Ya no queda ningún `app-contenido` en `public/`.
Probado: `verificar-html.py` (etiquetas balanceadas y JS válido) en las cuatro páginas, y las suites `probar-logistica`, `panel-alcance`, `comunas-dashboard`, `transporte-diad`, `transporte-parte2` e `inscripcion-enlace`
sin fallos (las tres que fijaban la versión del service worker ahora aceptan v164). **No probado:** el aspecto en un celular real o en un navegador; ninguna suite toca estas páginas.

## Parche 289 — Día D: logística (refrigerios y kits) y Panel por rol (8 de noviembre de 2026, INACTIVO, TOCA LA BASE)

Zip de 21 archivos (`.version-base` = 289). **Nuevos:** `lib/logisticaDiaD.js`, `lib/logisticaItems.js`, `routes/logisticaDiaD.routes.js`, `public/js/logistica-dia-d.js`, `public/app/logistica.html`.
**Modificados:** `app.js`, `config/importarExportar.js`, `db/init-db.js`, `lib/alertasDiaD.js`, `lib/avisosAlertas.js`, `middleware/aspirante.js`, `public/app/dia-d.html`, `public/app/inicio.html`, `public/dia-d.html`,
`public/js/alertas-dia-d.js`, `public/js/common.js`, `public/js/offline-utils.js`, `public/service-worker.js` (**v163**), `routes/dashboard.routes.js` y `routes/permisos.routes.js`. Commit `caf7d42`.
`scripts/probar-logistica.js` (114), `probar-panel-alcance.js` (43) y las suites tocadas **no viajan**. **Requiere el 288.** **Toca la base** (`init-db` crea 3 tablas y siembra 3 ítems: marcar «toca base de datos», ya viene marcado).

### Parte A — Panel de los demás roles

`ambitoDeResumen` (`routes/dashboard.routes.js`): **testigo, usuario e invitado ven sólo lo suyo**, igual que el sublíder (lo que ellos registraron; ceros si no registran). **Asistente administrativo y administrativo siguen viendo toda la
campaña, sin finanzas.** El mapa del Panel y la tabla de posiciones **no cambian**. Probado en `probar-panel-alcance.js` (testigo 1, usuario 2, invitado 0, administrativo y asistente 14 de 14, ninguno con `finanzas`).

### Parte B — Logística del día D

**Tablas** (`db/init-db.js`, idempotente; `aspirante_id` = dueño, 0 = la madre):
- `logistica_items` — `nombre, destinatario ENUM('testigos','conductores'), hora_limite TIME, incluir_suplentes, activo, orden`; `UNIQUE(aspirante_id, nombre)`. **Se desactivan, no se borran** (una entrega apunta a su ítem).
- `logistica_plan` — sólo las **correcciones a mano** (`item_id, puesto_id, cantidad`); `UNIQUE(item_id, puesto_id)`. Sin fila, manda la sugerida. Borrar la fila = volver a la sugerida.
- `logistica_entregas` — `item_id, puesto_id, receptor_usuario_id, fecha, estado (entregado/anulado), entregado_por, entregado_en` (la hora del TOQUE), `nota, foto_url, cliente_uuid, anulado_por/en`; **`UNIQUE(item_id, receptor_usuario_id, fecha)`**.
- **Ítems de fábrica** (sólo si la madre no tiene ninguno, así volver a correr `init-db` no recrea lo que el administrador renombró o desactivó; un aspirante recibe los suyos al abrir el módulo por primera vez): Kit de testigo 07:00, Refrigerio 12:00, Almuerzo 14:00, todos a testigos y con suplentes apagado.

**Plan** (`lib/logisticaDiaD.js`): sugerido = testigos **activos** asignados al puesto (incluidos los «coordinadores de puesto»), por `cargarTestigos`/`repartirPorPuesto` (id del puesto o texto normalizado); `+ suplentes` sólo si el ítem lo pide (los suplentes que ya son testigos
de ese puesto no se cuentan dos veces). Los **conductores** van en una fila «Transporte» aparte (conductores activos de la campaña) y su total entra en la lista de compras.

**Pantallas**
- *Escritorio:* pestaña **«Logística»** en `dia-d.html` (después de «Transporte», también en el submenú DÍA D): total para comprar, plan por puesto editable (naranja = corregido a mano, ↺ vuelve a la sugerida), fila de conductores, alta y edición de ítems, y **Excel**
  (hojas «Lista de compras», «Por puesto» y «Testigos», con **la cédula enmascarada** `***992`).
- *Celular:* `app/logistica.html`, **a 360 px sin desborde**: por testigo, un botón «Entregado» por ítem y 📷 para entregar con foto; «Deshacer» para un error. El coordinador de puesto llega por un acceso en su pantalla del Día D (`app/dia-d.html`); la coordinación, por una tarjeta del menú (`inicio.html`) con selector de puesto.
  **Sin señal:** la entrega queda en el celular (cajón nuevo `logistica_pendientes`, `offline-utils` versión 5) con su `cliente_uuid` y la hora del toque, y se sube sola al volver la señal; la última lista se guarda para verla sin conexión.
- **Contador** en el cuadro del Día D: «Refrigerio: 38 de 52» por ítem (los de conductores dicen «N por comprar»).

**Permisos y módulo `logistica_dia_d`** — declarado en: `db/init-db.js` (de fábrica **admin y coordinador**), `routes/permisos.routes.js` (la matriz), `config/importarExportar.js` (Excel: admin y coordinador), `middleware/aspirante.js` (`MODULOS_ASPIRANTE`, `PERMISOS_ASPIRANTE` con exportar
encendido, y `HREFS_ASPIRANTE` con `/dia-d.html#logistica`) y `public/js/common.js` (menú). **La pantalla del coordinador de puesto NO va por rol ni por la casilla**: va por su fila de testigo `tipo_testigo = 'puesto'`; ve y entrega **sólo en su puesto** (un `puesto_id` ajeno se ignora). La coordinación con el módulo entra a cualquier puesto de su campaña.
Un líder sin el módulo recibe **403**.

**Alerta `logistica_sin_entregar`** (gravedad **8**; **«mesa sin testigo» pasó a 9** y su chip a gris `.g9`; la logística es ámbar): por puesto y por ítem, **sólo el día de la elección**, «pendiente» antes de la hora del ítem y «activa» después; cuenta **testigos que YA hicieron check-in y no tienen ese ítem hoy**.
Texto: «Puesto X: N testigos sin refrigerio a las 12 m.» («1 testigo» en singular; «7 a. m.», «2 p. m.»). Va en el cuadro (`calcularAlertas`), en `alertasParaUsuario` (pasa igual para el coordinador: no depende de los votantes de quien pregunta) y en `TIPOS_AVISADOS`/`FRASES` del push.
**El campo `mesa` de esta alerta lleva el id del ítem** (así «atendida» y el aviso push funcionan por ítem sin tablas nuevas); el cuadro dejó de escribir «· Mesa N» para este tipo.

### Decisiones mías (2e, «la opción más simple que funcione el día D»)

1. **Los suplentes no reciben desde la pantalla**: no son testigos asignados. Sólo cuentan en el plan si el ítem lo pide. Si un suplente reemplaza a alguien, la coordinación lo asigna como testigo del puesto y desde ese momento recibe.
2. **Sin firma, foto opcional** (8 MB máximo; se reduce a 1.280 px y JPEG calidad 72, se gira por EXIF y se quitan los metadatos). Un archivo que no es imagen no tumba la entrega: queda registrada y la respuesta dice que la foto no se guardó.
3. **Sólo cantidades, sin costo ni pesos.**
4. **A los conductores se les planea y se les compra, pero no se registra su entrega** (no cuelgan de un puesto y el celular del coordinador de puesto no los ve). Si hace falta, otra orden.
5. **Compra y reparto entre puestos: la coordinación, con el Excel.** No hay un rol de «coordinador de zona».
6. **El contador es de la campaña (por dueño), no de la rama del coordinador**: así son los testigos y sus alertas en todo el Día D. Un aspirante ve el suyo.
7. **Entregas del día = hoy en Colombia**, también fuera de `fecha_eleccion` (como el check-in), para poder ensayar; la alerta sí exige que hoy sea el día de la elección.
8. **«Anular»** (Deshacer) existe, y el coordinador de puesto sólo anula las de su puesto; volver a entregar lo anulado lo reactiva.
9. Un **testigo inactivo** no cuenta ni puede recibir.

**Lo que choca con el código (la orden pedía avisar):** nada impedía las decisiones, pero hay dos efectos que conviene saber: (a) para meter la alerta hubo que **renumerar «mesa sin testigo» a gravedad 9** (cambia el color de su franja); (b) el cuadro de alertas
no tenía dónde distinguir «por ítem», y se usó la columna `mesa` (ver arriba).

**Una observación aparte, sin tocar:** `app/ranking-dia-d.html` y `app/alertas-dia-d.html` envuelven su contenido en `<div class="app-contenido">`, una clase que **no existe** en `estilos-app.css` (la buena es `main.app-cuerpo`); por eso sus tarjetas salen pegadas a los bordes. La pantalla nueva sí usa `main.app-cuerpo`.

### Verificación

`scripts/probar-logistica.js` (**114 comprobaciones**, base privada): tablas y clave única; ítems de fábrica; **`init-db` dos veces** (sin recrear lo renombrado); plan sin y con suplentes, corrección a mano y su vuelta, rechazos (negativos, decimales, ítem de conductores); fila de conductores (2 activos de 3); **permisos** (líder 403 en plan, ítems,
celular y Excel; coordinador sí; sin sesión 401; coordinador de puesto 403 en el escritorio y sólo ve su puesto; testigo común 403); **entrega idempotente** (segundo toque, el mismo identificador, **tres toques simultáneos → una sola entrega**, testigo de otro puesto, inactivo, ítem desactivado o de conductores, hora del toque de hace 2 h, hora futura descartada, reintento de la cola, anular/reactivar);
**la foto** (reducida a 1.280×960 y 7 KB desde 44 KB, en `uploads/dia-d/`, visible sólo para su puesto y la coordinación, un segundo toque no deja archivos, un archivo que no es imagen no tumba la entrega); el contador y por dueño (un aspirante ve el suyo en cero); **la alerta** a las 06:00 (pendiente), 08:00 y 13:00, al entregar, atendida por ítem, con la elección mañana y sin fecha, con el ítem desactivado o sin hora; `alertasParaUsuario`; el push; el Excel (3 hojas, cédula enmascarada, sin cédula completa); y las declaraciones del módulo y las pantallas.
**En Chromium sin interfaz** (a 360×740): la pantalla del celular —sin desborde horizontal—, tocar «Entregado» con señal (queda «✓ Entregado 19:52 / Deshacer»), **sin señal** (queda «⏳ Guardado, sin subir» y el aviso «1 entrega guardada en tu celular…») y **al volver la señal** (se sube sola y quedan 2 marcados, sin pendientes);
y la pestaña de escritorio (contador, plan, total, ítems, menú activo «Logística del Día D»), sin errores de consola. Suites: comunas 73/73, inscripción 467/467, transporte 123/123 y 80/80 (se ajustaron dos comprobaciones: Transporte ya no es lo último del submenú, lo es Logística), panel 43/43; `probar-instalacion-limpia.js` **64 tablas**.
**NO se probó:** un teléfono real (la cámara, la señal intermitente de un puesto), el push llegando a un dispositivo, una foto grande en un celular de gama baja, ni el día de la elección con tráfico real; tampoco la tarjeta del menú para un aspirante en un navegador (sí la declaración).

**NOTAS PARA QUIEN LO APLIQUE:** (1) **toca la base**: `init-db` crea las tres tablas y siembra los tres ítems; aplicar después del 288 con la misma lista de campañas. (2) El administrador y el coordinador tendrán el módulo «Logística del Día D» de fábrica; lo ve el aspirante. Los **coordinadores de puesto ya existentes** reciben el acceso sin tocar nada (el servidor lo reconoce por su fila de testigo).
(3) Revisar las horas (07:00, 12:00, 14:00) y los ítems en la pestaña antes del día. (4) Es **visible** para testigo, usuario e invitado: su Panel deja de mostrar la campaña entera.

## Parche 288 — Panel general por alcance (8 de noviembre de 2026, INACTIVO, NO toca la base)

Zip de 2 archivos: `routes/dashboard.routes.js` y `.version-base` = 288. Commit `6c4927f`. **Requiere el 287** (el 287 puso el ámbito del coordinador que éste reutiliza).
`scripts/probar-panel-alcance.js` (35 comprobaciones) **no viaja**. Ninguna pantalla cambia: no hay service worker nuevo.

**Lo que había:** `/api/dashboard/resumen` y `/tendencia-registros` contaban la campaña entera para cualquiera con el Panel encendido que no fuera aspirante: un líder veía el
total de votantes, los coordinadores y líderes de toda la campaña, la meta, los eventos y las menciones.

**Lo que hace ahora** (`ambitoDeResumen`, `routes/dashboard.routes.js`; `/resumen` y `/tendencia-registros` lo usan):

| Quien mira | Qué cuenta |
|---|---|
| Administrador | toda la campaña (sin cambios) |
| Coordinador | él, sus líderes y los sublíderes de éstos (el ámbito del 287); votantes con la misma condición de la lista de Votantes |
| Líder | él y quienes le reportan directo (sus sublíderes); votantes con `lider_id` = él (incluye lo que registran sus sublíderes) |
| Sublíder | sus votantes (`lider_id` o `sublider_id` = él) |
| Aspirante | su rama, como antes |

- **Eventos:** el coordinador, el líder y el sublíder ven los eventos donde ellos o su equipo figuran como responsable, coordinador o líder (`responsable_id`, `coordinador_id`, `lider_id`).
  **Un evento sin ninguna de esas personas sólo lo ve el administrador.** (Comportamiento nuevo para el coordinador: antes veía todos.)
- **Menciones** (monitoreo de redes): no cuelgan de nadie y no se pueden acotar; **sólo el administrador las recibe**. El panel no las pinta, pero el JSON las traía enteras.
- **Finanzas:** igual que en el 268 — sólo administrador, coordinador y aspirante; para el líder la clave `finanzas` no viaja (la prueba lo comprueba, y que el monto no aparezca en ningún lado de la respuesta).
  El coordinador sigue viendo el balance de **toda** la campaña (no se acota: es dinero de la campaña, no de una rama).
- **La meta de la madre** (`filtroMetaMadreEstructura`) ahora también se resta dentro de la rama de un coordinador, no sólo para el administrador.

**Qué cambió de lugar:** `filtroEquipo` ya no excluye siempre «a la cabeza»: sólo lo hace con el aspirante (`ambito.esAspirante`); y las finanzas en cero son sólo del aspirante, no de cualquiera con ámbito.

### Otras tarjetas del Panel (`dashboard.html` y `app/admin-panel.html`)

| Ruta | Quién | Alcance |
|---|---|---|
| `/dashboard/resumen`, `/tendencia-registros` | todos con el Panel | **acotado desde el 288** (tabla de arriba) |
| `/dashboard/progreso-equipo` | admin, coordinador, aspirante | acotado desde el 287 |
| `/dashboard/mi-progreso` | el propio usuario | lo suyo, siempre |
| `/dashboard/avance-mis-lideres` | admin, coordinador | el coordinador ve los suyos; el admin elige |
| **`/dashboard/tabla-posiciones`** | todos con el Panel | **toda la campaña para líder, sublíder y demás roles — A PROPÓSITO**: es un ranking de motivación (sólo nombres y cantidades, 50 filas) y su nota dice que el propio líder tiene que verse en él. El coordinador sí ve sólo su rama (287). Decisión de Gildardo si algún día se acota. |
| `dashboard.html` → `/territorial/mapa-personas` | admin, coordinador, aspirante | **no es de `/api/dashboard`** y no se tocó: el mapa del Panel sigue mostrando a todos los georreferenciados al coordinador |
| Cobertura territorial («Informe») | admin, coordinador | toda la campaña, como se decidió en el 287 |

**Roles que NO se tocaron** (la orden no los nombra): asistente administrativo, testigo, usuario, invitado. Todos tienen `panel_general` por defecto (`db/init-db.js`) y siguen viendo la campaña entera
en `/resumen` y `/tendencia-registros` (sin finanzas). A un asistente administrativo acotarlo lo dejaría en cero; a un testigo o invitado probablemente conviene acotarlo o quitarle el Panel.
**Pendiente a decidir.**

**Probado** (`scripts/probar-panel-alcance.js`, 35 comprobaciones, base privada): administrador (11 votantes, 2 coordinadores, 3 líderes, 4 eventos, menciones, finanzas); coordinador A (6, él y sus 2 líderes, meta 150,
2 eventos, sin menciones, con finanzas) y B; líder (5: los suyos y los de su sublíder; 1 evento; sin finanzas ni su monto); otros dos líderes; sublíder (2); asistente administrativo (sin cambios); aspirante (sin eventos,
finanzas en cero, como antes); y la tendencia de cada uno. **Con el código anterior falla 20.** Suites: comunas-dashboard 73/73, inscripción 467/467, transporte 123/123 y 80/80. `node --check` y `verificar-requires.js`
sobre el zip: «TODO RESUELVE». **NO se probó:** un navegador (la pantalla del Panel con un líder), ni datos reales de ninguna campaña.

**NOTAS PARA QUIEN LO APLIQUE:** (1) no toca la base; aplicar después del 287 con la misma lista de campañas. (2) Es **visible**: un líder o un sublíder que hoy ve «Votantes: 3.200» pasará a ver sólo lo suyo; y un coordinador
deja de ver los eventos que no tienen a nadie de su rama.

### Propuesta (IMPLEMENTADA en el parche 289, con las decisiones de allá): refrigerios, almuerzos y kits del día D

**Qué hay hoy: nada.** Ni tablas, ni columnas, ni pantallas, ni rutas (`grep -rniE "refrigerio|almuerzo|kit|material|entrega"`): sólo dos rastros de **dinero**, no de logística —la categoría de gasto
«Producción de material impreso» (`db/schema.sql:389`) y el texto de ejemplo «Refrigerios para voluntarios» en `public/finanzas.html:67`—, y «Compartir contenido» (materiales de **comunicación**, no físicos).

**De dónde saldría la cantidad por puesto**
- **Testigos asignados:** `estructura` con `cargo = 'testigo'` (`tipo_testigo` 'mesa' o 'puesto', `mesa_votacion`, `mesas_asignadas`, `puesto_id`); `lib/coberturaTestigos.js` ya los reparte por puesto (`cargarTestigos`, `repartirPorPuesto`,
  por id si es de la campaña y, si no, por el texto normalizado). La unidad es la **persona**, no la mesa: un coordinador de puesto cubre varias mesas y come una vez. `dia_d_puestos_votacion.cantidad_mesas` da el tope de mesas.
- **Suplentes:** `dia_d_suplentes_testigo (aspirante_id, puesto_id, usuario_id)`. Convendría un interruptor por tipo de entrega: «incluir suplentes» (sí para refrigerio, tal vez no para chaleco).
- **Coordinadores de puesto:** no son un rol aparte: son testigos con `tipo_testigo = 'puesto'` (así se llaman en `testigos.html`). Ya salen en el reparto; sólo hay que distinguirlos para el kit.
- **Conductores:** `transporte_conductores`, pero **no cuelgan de un puesto** (un conductor recorre varios). Su cantidad iría en una fila «Transporte» (puesto vacío) y no en la suma de los puestos.
- **Presencia real:** `dia_d_checkin` (quién llegó). Para *comprar*, sirve lo asignado; para *alertar*, lo que cuenta es quién llegó y aún no recibió.

**Tablas (esbozo)**
- `logistica_items` — qué se entrega: `id, aspirante_id, nombre, tipo` (refrigerio, almuerzo, kit_testigo, chaleco, otro)`, destinatario` (testigo, coordinador_puesto, suplente, conductor)`, incluir_suplentes, hora_limite TIME NULL` (para la alerta; 12:00 en el refrigerio), `costo_unitario NULL, activo`.
- `logistica_plan` — `item_id, puesto_id, cantidad_planeada, manual` (1 si alguien la ajustó a mano); `UNIQUE(item_id, puesto_id)`. Se **sugiere** desde los testigos del puesto y se puede corregir.
- `logistica_entregas` — `id, aspirante_id, item_id, puesto_id, fecha, receptor_usuario_id NULL, cantidad DEFAULT 1, entregado_por, entregado_en, nota, foto_url NULL, firma_url NULL, cliente_uuid, estado` (entregado/anulado)`;
  UNIQUE(item_id, receptor_usuario_id, fecha)` para que el doble toque o el reintento no entregue dos veces. La foto/firma reutilizaría el manejo de archivos de `dia_d_reporte_documentos` (E-14).

**Pantallas**
- *Escritorio* — pestaña **«Logística»** en `dia-d.html` (como Transporte, al final del submenú): catálogo de items; tabla «planear por puesto» con la cantidad sugerida y editable, y **el total para comprar por item** (suma + margen %
  configurable); botón de Excel (con el permiso de importar/exportar).
- *Celular* — `app/logistica.html` para el **coordinador de puesto** (un testigo `tipo_testigo = 'puesto'`): ve la lista de testigos de SU puesto (de `cargarTestigos`), toca «Entregado» por persona e item; el servidor sólo deja
  marcar en su puesto. Funciona sin señal.

**Contador y alerta**
- Contador en el cuadro del Día D: «Refrigerios: 38 de 52» (por puesto y total), con el alcance de quien pregunta, igual que el de transporte.
- Alerta nueva `logistica_sin_entregar` (mismo molde que `transporte_sin_recoger` en `lib/alertasDiaD.js`): por puesto, **sólo el día de la elección**, «pendiente» antes de `hora_limite` y «activa» después —«Puesto X: N testigos sin refrigerio
  a las 12 m.»—; cuenta testigos que **ya hicieron check-in** y no tienen entrega de ese item. Entra a `TIPOS_AVISADOS` y `FRASES` de `lib/avisosAlertas.js` para el aviso push.

**Permisos y módulo:** módulo nuevo `logistica_dia_d` (por defecto admin y coordinador en `db/init-db.js`; en `MODULOS_ASPIRANTE` / `PERMISOS_ASPIRANTE` y `HREFS_ASPIRANTE` para el aspirante), con el ítem de menú y la tarjeta del celular
(como se hizo con Transporte). La pantalla del coordinador de puesto **no** va por rol sino por tener esa fila de estructura (como el check-in).

**Qué se reutiliza:** del **check-in**, el molde de ruta (idempotente por `cliente_uuid`, `marcado_por`/origen, auditoría, fecha de hoy en Colombia); de **transporte**, la pestaña con contador en `dia-d.html`, `alertasDeTransporte`, el
reclamo atómico (`UPDATE … WHERE … IS NULL`) para no entregar dos veces y el registro del módulo; de la **cola sin señal**, `guardarEnColaOffline` (`public/js/offline-utils.js`) con un cajón `logistica`, la hora del TOQUE (no la de la
subida) y el vaciado al volver la señal. Es un parche **con base de datos** (tres tablas) y con service worker nuevo; no se estimó el tamaño.

**Dudas a resolver antes de construir:** ¿se entrega a *todo* testigo asignado o sólo al que hizo check-in?; ¿el suplente que reemplaza cuenta aparte?; ¿foto, firma o ninguna (la foto cuesta almacenamiento y tiempo en el puesto)?;
¿lleva costo y total en pesos o sólo cantidades?; ¿quién compra y reparte entre puestos —un coordinador de zona—?

## Parche 287 — Comunas validadas y dashboard por zona (8 de noviembre de 2026, INACTIVO, NO toca la base)

Zip de 9 archivos (`.version-base` = 287): `lib/comunasDeLaCampana.js` (**nuevo**) y los modificados `config/sincronizacionVotantesEstructura.js`,
`public/service-worker.js` (**v162**), `public/votantes.html`, `routes/dashboard.routes.js`, `routes/inscripcion.routes.js`, `routes/votantes.routes.js`
y `routes/votantesDashboard.routes.js`. Commit que recoge: `0ecef11`. `scripts/probar-comunas-dashboard.js` (73 comprobaciones) y `scripts/reporte-comunas.js`
**no viajan**. **Requiere el 286** (sin dependencia declarada; las mismas campañas). **No hay `init-db`: no toca la base.**

### La causa: el dato no estaba mal guardado, lo mostraba así el dashboard

«Por Comuna / Corregimiento» **no lee la columna de comuna**. Agrupaba por el **padre del `territorio_id` de la ficha**, sea del tipo que sea. Las veredas del
DANE cuelgan del **municipio** (31.927 de 32.016; ver CLAUDE.md del catálogo) y una ficha asignada «a todo el municipio» cuelga del **departamento**; así que:

| Salía | Qué eran en realidad |
|---|---|
| «MANIZALES» (6) | fichas en veredas/barrios que cuelgan directo del municipio Manizales |
| «Caldas» (2) | fichas asignadas al propio municipio (su padre es el departamento) |
| «Antioquia» (c001) | lo mismo, en un municipio de Antioquia |

La orden suponía que la ciudad o el departamento «cayeron» en el campo de comuna; **no se pudo comprobar con los datos reales** (la Base está vacía y no se puede leer la
municipal ni c001), pero la causa de arriba se reprodujo en la prueba con el código anterior (salen exactamente «MANIZALES» y «Caldas») y explica los tres casos sin
necesidad de que nadie haya escrito nada mal. **Eso cambió el arreglo:** el dashboard ahora dice «Sin comuna» donde antes decía el padre; y, aparte, el texto de comuna también se valida.

### Quién escribe `votantes.comuna_corregimiento_residencia` (y si validaba)

| Entrada | Archivo | ¿Validaba contra la lista? |
|---|---|---|
| Alta (escritorio y celular, mismo `POST /api/votantes`) | `routes/votantes.routes.js` | No: texto libre (el desplegable es sólo sugerencia) |
| Edición `PUT /api/votantes/:id` | `routes/votantes.routes.js` | No |
| Excel `/importar-excel` | `routes/votantes.routes.js` | **No escribe la columna**; usa la columna «Comuna» sólo como filtro para hallar el barrio, y una comuna que no existe rechazaba la fila entera |
| `/importar` (arreglo ya leído) | `routes/votantes.routes.js` | No escribe la columna |
| `/i/<código>` (alta y «completar vacíos») | `routes/inscripcion.routes.js` + `config/inscripcionRegistro.js` | No: sólo saneaba y cortaba a 120 |
| Copia Estructura → Votantes | `config/sincronizacionVotantesEstructura.js` | No: copia el texto libre de `usuarios` |
| **Estructura** (`usuarios.comuna_corregimiento_residencia`: alta, edición e importación en `routes/territorial.routes.js`) | — | **No, y este parche NO lo toca** (fuente del texto que la copia lleva a Votantes) |

### Qué cambió

- **Dashboard** (`routes/votantesDashboard.routes.js`): la zona de una ficha es su territorio si es comuna o corregimiento, o su padre si lo es; si no, **«Sin comuna»**
  (`zona_id = 0`; el filtro de Barrio/Vereda lo entiende). Una ficha asignada **directo a una comuna** ahora cuenta en ella (antes contaba en el municipio). La columna
  «Comuna/Corregimiento» de «Por barrio» dice «Sin comuna» y no la ciudad; «Tipo» sale «—» si no hay zona. Las fichas **sin territorio** siguen sin contarse (como siempre).
- **Validación** (`lib/comunasDeLaCampana.js`): con la campaña **teniendo comunas o corregimientos** en `territorios`, un valor que no está en la lista (sin mirar mayúsculas,
  tildes ni espacios dobles) **se guarda vacío**; la ficha se guarda igual. Sin ninguna comuna en la campaña (Quindío: cero) el texto sigue libre. Aviso al usuario: el alta y
  la edición responden `comuna_descartada` y `votantes.html` lo muestra; el Excel devuelve `avisos` («fila N: comuna "MANIZALES" no existe en la campaña; quedó vacía») y la pantalla
  cuenta cuántos. En el Excel la fila **ya no se pierde** por una comuna falsa: se ignora la comuna, y si trae barrio que existe en **varias** comunas se rechaza esa fila (no se adivina).
  En `/i` se descarta sin mensaje (quien se inscribe no puede arreglarlo). El desplegable de comunas ya existía en `votantes.html`, `territorial.html` y `/i`.
- **Alcance** (`routes/votantesDashboard.routes.js`): `calcularAlcance` y `condicionAlcanceVotantes` / `parametrosAlcanceVotantes` en **todas** las consultas que leen `votantes`:
  resumen, por comuna, por barrio, por líder (y «sin líder»), Excel y Word (por sección y completos) y el estimado por puesto/mesa. Coordinador = su rama (la misma regla que
  la lista de Votantes). **Administrador = toda la campaña, sin tocar**: no se le aplicó la regla de la madre que esconde las ramas de aspirantes (cambiaría lo que ve; no se pidió).
- **Panel general** (`routes/dashboard.routes.js`): **`/progreso-equipo` y `/tabla-posiciones` devolvían a TODOS los coordinadores y líderes de la campaña** a un coordinador
  (`ambitoDelPanel` sólo acotaba al aspirante). Ahora el coordinador ve él, sus líderes y los sublíderes de éstos, y los conteos de cada fila llevan la misma condición de Votantes.
  El administrador y el aspirante no cambian.

**Lo que NO se acotó, a propósito, y conviene saber:**
- **Cobertura territorial** (`/cobertura`, `/cobertura-detalle` y sus Excel/Word, que son el botón «Informe»): leen la estructura de territorios, no `votantes`. Un coordinador sigue
  viendo la cobertura de **toda** la campaña, con los nombres de los líderes que cubren cada barrio. Acotarlo falsearía «cubierto / sin cubrir». Decisión pendiente de Gildardo.
- **`/api/dashboard/resumen` y `/tendencia-registros`** (el resto del Panel) siguen sin acotar para el coordinador: la orden nombraba sólo la tabla de posiciones y el progreso del equipo.
- **Estructura** (`usuarios.comuna_corregimiento_residencia`) sigue siendo texto libre (ver tabla).
- **No se reescribió ninguna ficha existente.**

### Cómo correr `scripts/reporte-comunas.js` (solo lectura; no viaja)

```bash
cp /home/appestrategia-electoral/htdocs/electoral.appestrategia.net/scripts/reporte-comunas.js <carpeta-de-la-campaña>/scripts/
cd <carpeta-de-la-campaña> && node scripts/reporte-comunas.js          # 100 valores por lista; --todos o --json
```
Con el node de la cuenta de esa campaña y su `.env`. Se puede correr **antes** de aplicar el 287 (si `lib/comunasDeLaCampana.js` aún no existe usa una copia idéntica de la comparación). Dice:
(a) cuántas comunas y corregimientos tiene la campaña (sin ninguna, el texto es libre); (b) cada valor de `votantes.comuna_corregimiento_residencia` fuera de la lista, con su cantidad y si
coincide con la **ciudad** o el **departamento** (sin lista, sólo señala los que son una ciudad o un departamento); (c) lo mismo para Estructura; y (d) **cuántas fichas el dashboard
agrupa en «Sin comuna»**, por tipo de territorio y de su padre (es lo que confirma la causa de arriba). Sale con código **2** si hay fichas con comuna ajena, 0 si no, 1 si falla. No modifica nada.
**Sobre la Base** (electoraldb: 0 fichas, 0 comunas) dio: «ninguna ficha con una comuna que no sea de la campaña». No se pudo correr en municipal, departamental ni c001.

### Verificación

`scripts/probar-comunas-dashboard.js` (**73 comprobaciones**, base privada): la regla pura; alta y edición con «MANIZALES», «Caldas», «Antioquia» y una comuna buena; Excel con la ciudad, el departamento
y un corregimiento falso en su columna (resumen de avisos, barrio único, barrio en varias comunas); la copia desde Estructura; una campaña sin comunas; el dashboard con «Sin comuna» y sus filtros; el
administrador viendo 15 de 15; dos coordinadores viendo cada uno sólo lo suyo en resumen, por comuna, por barrio, por líder, Excel completo y por sección, Word completo y por sección; progreso del equipo y
tabla de posiciones; y el reporte sobre datos sembrados (10 fichas ajenas, «MANIZALES» = ciudad, «Caldas» = departamento). **Con el código anterior del dashboard la misma prueba falla 21 comprobaciones**
(salen «MANIZALES» y «Caldas», y el coordinador ve 15 de 15), así que la prueba sí detecta el problema. Más: `probar-inscripcion-enlace.js` **467/467** (se ajustó la de «cada campo se corta a su largo» y se
sumó /i con la ciudad como comuna), `probar-transporte-diad.js` 123/123, `probar-transporte-parte2.js` 80/80 y `probar-instalacion-limpia.js` (61 tablas). `node --check` en todo lo tocado y
`verificar-requires.js` sobre el zip: «TODO RESUELVE».
**NO se probó:** nada con datos reales de la municipal, la departamental ni c001 (no se pueden leer); el dashboard en un navegador (sólo la API y los archivos exportados); un Excel de miles de filas
(la comuna se comprueba contra una lista leída una sola vez); ni qué fichas reales quedarán en «Sin comuna» en cada campaña (para eso, el reporte).

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**
1. **No toca la base.** Aplicar después del 286, con la misma lista de campañas.
2. **Antes y después**, correr `reporte-comunas.js` en cada campaña. Después de aplicar, «Por Comuna» muestra «Sin comuna» en vez de la ciudad o el departamento; los números por comuna pueden subir (las fichas asignadas directo a una comuna ya cuentan en ella).
3. **Un coordinador deja de ver cifras de otras ramas** en el dashboard de votantes, sus exportaciones, el progreso del equipo y la tabla de posiciones. Es el propósito, pero se va a notar.
4. Las fichas que ya tienen una comuna ajena **no se limpian solas**: el reporte las lista y su limpieza se decide aparte.

## Parche 286 — Día D: transporte, parte 2 y orden del menú (7 de noviembre de 2026, INACTIVO, TOCA LA BASE)

Zip de 21 archivos (+ `.version-base` = 286): `lib/canalesDelEnlace.js` y `public/js/firma-sms-aviso.js` (**nuevos**) y los modificados
`db/init-db.js`, `db/schema.sql`, `lib/alertasDiaD.js`, `lib/avisosAlertas.js`, `lib/jornadaDiaD.js`, `lib/transporteDiaD.js`,
`middleware/aspirante.js`, `public/app/inicio.html`, `public/configuracion.html`, `public/configurar-crm.html`, `public/js/alertas-dia-d.js`,
`public/js/common.js`, `public/js/transporte-conductor.js`, `public/service-worker.js` (**v161**), `routes/alertasDiaD.routes.js`,
`routes/configuracion.routes.js`, `routes/rescateVotos.routes.js` y `routes/transporte.routes.js`. Commits que recoge: `e0b7da1` (el orden
del menú, que quedó fuera del 285) y `cd1cb1c` (la parte 2). `scripts/probar-transporte-parte2.js` (80 comprobaciones), `probar-transporte-diad.js`
(123) y `probar-inscripcion-enlace.js` (465) **no viajan**. **Requiere el 285** (sin dependencia declarada: activarlo con el 285 y la misma lista
de campañas).

> **Cada «Voy en camino» con consentimiento cuesta 1 SMS.** Una vez por parada, solo a quien autorizó SMS (`consentimiento_sms = 1`), no está en
> «no contactar», tiene teléfono y —si llegó por `/i`— ya confirmó por `/c`. Con la firma real de cada campaña (ver abajo) el texto mide 1 SMS;
> si una firma lo hiciera pasar, el mensaje se recorta (primero la placa, luego «Ten tu cedula lista.») y, si ni así cabe, **se envía igual y
> queda un aviso en el registro** (`[transporte] el aviso «va en camino» … no cabe en 1 SMS`).

- **Menú (e0b7da1).** «Transporte del Día D» va al final del submenú de escritorio (después de «Puestos de votación y candidatos») y, en las
  tarjetas del celular, después de «Ranking Día D» (coordinador y administrador). En el coordinador NO se partió el menú del líder: su «Faltan por
  votar» (que viene de `MENU_LIDER`) sigue más abajo. Las pestañas de `dia-d.html` ya tenían Transporte al final. **Hallazgo:** la lista de
  direcciones del aspirante con sublicencia (`HREFS_ASPIRANTE`) **no traía `/dia-d.html#transporte`** (el módulo sí era suyo y la API lo servía,
  pero el menú manda la lista de direcciones sobre la de módulos): se agregó.
- **Alerta «Transporte sin recoger»** (`lib/alertasDiaD.js`, `TIPOS`: `transporte_sin_recoger`, gravedad **7**; «mesa sin testigo» pasó a 8 y el
  chip nuevo es verde azulado). Por puesto. **Solo el día de la elección** (`fecha_eleccion` = hoy): con otra fecha, o sin fecha, no existe ni como
  «pendiente». Antes de `transporte_alerta_desde` (14:00) sale «pendiente» y en gris, como las demás que dependen de la hora; desde esa hora, activa.
  Cuenta, sin contar a quien ya votó: **a)** paradas en estado «asignado» (hay conductor, no ha recogido) y **b)** votantes con
  `necesita_transporte = 1` sin parada viva (la cancelada no cuenta). Texto: «Puesto X: N personas con transporte sin recoger (M sin
  conductor)», con N = a + b y M = b; **cuenta filas** (una parada, un votante), no el campo «personas» de la parada, y dice «1 persona» en singular.
  Con el alcance de quien pregunta (la misma condición que el listado de votantes) y **también en `alertasParaUsuario`** (la ruta de los avisos).
  **El aviso push la toma**: entra en `TIPOS_AVISADOS` de `lib/avisosAlertas.js` (esa lista es explícita, no «todas») con la frase «puesto con
  transporte sin recoger». Se avisa una vez por (persona, puesto, día): una vez avisado un puesto, los cambios de N no vuelven a avisar.
- **La hora** se cambia en Configuración → «Jornada del Día D» (campo nuevo «Transporte sin recoger: avisar desde las»), con el resto de los
  horarios (`PUT /api/dia-d/alertas/config`). Una pantalla vieja que no manda el campo **no pisa** la hora guardada (`COALESCE`); una hora inválida da 400.
- **«Voy en camino»** (`POST /t/:codigo/avisar`, botón en `public/js/transporte-conductor.js`). Las reglas viven en `lib/canalesDelEnlace.js` (la
  función se **movió** de `rescateVotos.routes.js`: una sola copia para «Ya voté» y para esto). Sale por `smsSvc.enviarSMS` —transliteración, lista de
  baja y franja horaria—, **sin** la opción `operativo`, con `origen = 'transporte'` (queda en la bitácora de SMS, `sms_envios`) y
  `aviso_enviado_en` en la parada (**columna nueva**). Una sola vez: se **reclama** con un `UPDATE … WHERE aviso_enviado_en IS NULL` antes de enviar, así
  que dos toques a la vez mandan un solo SMS; si el proveedor falla se suelta la reclamación y se puede volver a tocar (respuesta 200 con
  `ok:false`, para no gastar el cupo de intentos fallidos de un conductor en la calle). El conductor ve «Aviso enviado» o «Esta persona no recibe SMS» (**nunca
  el motivo**; la lista lo calcula al cargar, no al tocar) y el botón no se repite. Solo si la parada sigue «asignada»: ya recogida, no hay botón.
  **Necesita señal** (lo manda el servidor): no entra en la cola sin señal.
- **El texto** (el A): «{primer_nombre}, tu transporte va en camino. Conductor {nombre_corto}, placa {placa}. Ten tu cedula lista.», sin enlace y sin
  «Baja». **Medido con la firma real de cada campaña** (`sms_config.firma`, leída en cada envío; NO se supone 30). Medido hoy: sin firma 88 caracteres;
  con la de la **Base** (`« ESTRATEGIA MARKETING POLITICO»`, 30 con el espacio inicial) 118; con la de la **municipal** del panel del proveedor
  (`«Estrategia Marketing Politico - Campaña municipal»`, 49 + separador = 50) **138 → 1 SMS, sin recorte**. Con nombres largos (Maximiliano / Bartolomé
  Rodríguez Hernández) 149, también 1 SMS. De la departamental y c001-2027 **no sé** qué tienen en `sms_config.firma` (esta cuenta no las lee).
- **LA FIRMA: dónde vive y qué hacemos con ella.** La pega **el proveedor** (Onurix; la CRC la exige) y se registra **en su cuenta**: esta aplicación NO la
  escribe en el mensaje, y por eso **no se puede transliterar desde aquí**. `sms_config.firma` (en la base de cada campaña) es solo una **copia para
  CONTAR** lo que ocupa. Hasta hoy **no había ninguna pantalla** para llenarla (se llenaba a mano por SQL) y la columna era `VARCHAR(40)`: la de la
  municipal (~50) no cabía. Ahora: columna `VARCHAR(80)` (`init-db`, `MODIFY`, no toca el contenido) y un campo en **Configurar CRM → SMS** con contador y
  advertencia en vivo («Firma larga: los SMS de confirmación, Ya voté y transporte pueden costar 2 créditos» si pasa de 30 o lleva tildes o ñ). **No la
  cambia sola** y se guarda tal cual (con su ñ: es lo que hay que medir). Una pantalla vieja que no manda el campo no la borra.
- **Una corrección a lo que se creía de la ñ.** La ñ, la é y la ü **sí están en GSM-7** (`lib/sms.js`): una firma con «Campaña» **no** baja el SMS a 70
  caracteres; lo hacen á, í, ó, ú. La advertencia avisa de las dos cosas pero el detalle distingue: con ñ dice «confirme con el proveedor cómo la envía»; con í/ó,
  «baja a 70». **Lo que SÍ pasó con los 2 créditos de la confirmación de `/c` en la municipal** es probablemente otra cosa: si `sms_config.firma` está
  vacía allí, `textoDeConfirmacion` mide sin firma, no recorta y el proveedor cobra 2 al sumar sus ~50 caracteres. **Llenar la firma en cada campaña** arregla
  la medición de todos los SMS. (Hipótesis, no medida: no se puede leer la base de la municipal.)
- **Probado** (`scripts/probar-transporte-parte2.js`, 80 comprobaciones, con el **proveedor de SMS simulado**): el orden del menú; la alerta antes (13:00,
  «pendiente») y después (15:00, activa) de la hora, al día siguiente y sin fecha (no hay), por alcance (dos coordinadores y `alertasParaUsuario`), y con la
  hora cambiada a 15:30; el SMS con y sin consentimiento, con 0, de baja, sin teléfono, sin confirmar por `/c` y confirmado por `/c`; un segundo toque (no reenvía);
  dos toques a la vez; el fallo del proveedor y el `DADO_DE_BAJA`; el recorte con firmas de 50, 89, 110 y 115 caracteres (más una de 80 y una con ó, de extremo a extremo por /t); el texto transliterado;
  el guardado de la firma (recortada, con ñ, sin borrarla desde una pantalla vieja, 80 sí / 81 no) y la advertencia (30 / 31 caracteres, ñ, í). Más: `init-db` dos veces
  y `probar-instalacion-limpia.js` (61 tablas). En **Chromium sin interfaz**: la pantalla del conductor a 360 px con «Voy en camino» (tocarlo lo cambia a «Aviso
  enviado» y el proveedor simulado recibe el texto exacto) y la pantalla de la firma con su advertencia. Suites: transporte 123/123, inscripción 465/465.
  **NO se probó:** un SMS real por Onurix (ni lo que cobra de verdad ni cómo trata la firma), el aviso push llegando a un teléfono, la alerta con tráfico de
  un día de elección, `Voy en camino` desde un teléfono con señal intermitente, ni la firma de la departamental y de c001-2027.

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Toca la base:** `init-db` agrega `transporte_asignaciones.aviso_enviado_en` y ensancha `sms_config.firma` a 80 (ya viene marcado «toca base de datos»).
2. **Cada «Voy en camino» con consentimiento cuesta 1 SMS.**
3. **Llenar la firma** en Configurar CRM → SMS de cada campaña (la que tiene registrada el proveedor, con su espacio inicial si lo lleva): sin ella el contador no la cuenta.
4. La alerta solo existe el día de la elección; la hora (14:00) se cambia en Configuración → Jornada del Día D.
5. Aplicar después del 285, con la misma lista de campañas.

## Parche 285 — Menú Día D: navegación entre pestañas (7 de noviembre de 2026, INACTIVO, NO toca la base)

Zip de 5 archivos: `public/js/common.js`, `public/dia-d.html`, `public/configuracion.html`, `public/service-worker.js` (**v159**) y
`.version-base` (285). Commit que recoge: `10a79c7` (a partir de `9c3a846`, el del 284). Los cuatro archivos coinciden por md5 con
el commit. **Requiere el 284** (el `common.js` y el `dia-d.html` que modifica son los del 284: sin él, el ítem «Transporte» y su
pestaña no existen). Sin dependencia declarada (ver «Cómo exige el 273»): activarlo con el 284 y **la misma lista de campañas**.

**Qué pasaba.** En el menú de escritorio, dentro de DÍA D, «Jornada electoral» y «Avance de votación» salían los dos activos y el
segundo no respondía. Tres causas juntas en `common.js` y `dia-d.html`: (1) el activo se calculaba UNA vez al pintar el menú y para
un ítem sin ancla comparaba solo la ruta, así que «Jornada electoral» (`/dia-d.html`) se marcaba aunque la vista fuera otra;
(2) «Avance de votación» (`/dia-d.html#avance`) lleva a la MISMA página: el navegador solo cambia el `#` y no recarga, y `dia-d.html`
solo leía el ancla al cargar, sin escuchar `hashchange`; (3) las pestañas de la página cambian la URL con `history.replaceState`,
que no avisa a nadie, y por eso el menú nunca se enteraba. Las pestañas nuevas (Alertas, Transporte, Resultados) no rompieron
nada: heredaron el mismo defecto.

**Qué cambia.**
- `common.js`: cada enlace del menú lleva `data-nav-href`; `marcarActivoMenu()` decide el activo por **ruta + ancla** (el ancla
  que coincide exacta; si no hay, el ítem de esa ruta sin ancla; si no, el marcado `porDefecto`) y deja **uno solo**. Se recalcula
  al cargar, en `hashchange`, en `popstate` y cuando la página lo pide (`window.actualizarMenuActivo`). Si la página declara
  `window.paginaEscuchaHash = true`, el clic en un ítem de su misma ruta solo cambia el ancla (`pushState` + `hashchange`), **sin
  recargar**; en cualquier otra página el clic navega como siempre. Con Ctrl/Cmd, botón central o `target`, no se intercepta.
- `dia-d.html`: `pestanaDelAncla()` (`#avance`, `#alertas`, `#transporte`, `#resultados`; otro ancla o uno sin permiso → «Reportes
  de mesas»), listener `hashchange`, y `mostrarPestana` avisa al menú. Los enlaces directos abren la pestaña correcta.
- `configuracion.html`: ya escuchaba `hashchange`; ahora declara `paginaEscuchaHash` y avisa al menú al cambiar de pestaña. **Tenía
  la mitad del problema** (la marca se quedaba pegada y sin ancla no había ítem por defecto): «Datos de la campaña» es ahora
  `porDefecto`.
- Los `href` del menú **no cambian** (el aspirante con sublicencia tiene su lista de `href` exactos). ELECTORAL, LOGÍSTICA, CRM y los
  demás grupos tienen **una página por ítem** y no tenían el problema; en el celular no aplica (la navegación es otra).

**Probado en Chromium** (sin interfaz, por CDP, sesión de administrador contra el código real con la API simulada): estando en
`dia-d.html`, un clic tras otro en Jornada → Avance → Alertas → Transporte → Resultados → Jornada → Avance deja **un solo ítem
activo** y la vista correspondiente, **sin recargar** (marca en `window` intacta); Atrás vuelve a la vista anterior; los botones
de pestaña de la página actualizan el menú; los enlaces directos `#avance`, `#alertas`, `#transporte`, `#resultados`, sin ancla y
con un ancla inventada abren la pestaña correcta; y **se abrieron las 33 direcciones del menú** (incluidos los cuatro `contenido.html?clave=…` y los seis de
Configuración): en cada una queda exactamente un ítem activo y es el suyo. Suites: transporte 123/123, inscripción 465/465 (las
dos aceptan ahora `v159`). **NO se probó:** el menú con un aspirante con sublicencia o un rol con permisos recortados (los `href`
no cambian, pero no se recorrió), Safari/Firefox, ni el menú en un teléfono.

**NOTAS PARA QUIEN LO APLIQUE:** no toca la base y no pide reiniciar nada más allá de lo habitual de un parche; el navegador
recoge `common.js` nuevo al subir el service worker a `v159` (la primera carga puede pedir recargar una vez).

## Parche 284 — Día D: transporte, parte 1 (7 de noviembre de 2026, INACTIVO, TOCA LA BASE)

Zip de 28 archivos (+ `.version-base` = 284): `lib/transporteDiaD.js`, `lib/busquedaCedula.js`, `routes/transporte.routes.js` y
`routes/transporteDiaD.routes.js` (**nuevos**); `public/js/transporte-conductor.js` y `public/js/transporte-dia-d.js`
(**nuevos**); `public/vendor/leaflet/` (**nuevo**: Leaflet 1.9.4, su LICENSE BSD-2 y sus 5 imágenes); y los modificados `app.js`,
`db/init-db.js`, `middleware/aspirante.js`, `public/app/inicio.html`, `public/asistentes-reuniones.html`, `public/dia-d.html`,
`public/js/common.js`, `public/service-worker.js` (**v158**), `routes/checkinDiaD.routes.js`, `routes/permisos.routes.js`,
`routes/usuarios.routes.js` y `routes/votantes.routes.js`. Commit que recoge: `98cf9b2` (a partir de `b0b2afb`).
`scripts/probar-transporte-diad.js` (123 comprobaciones) y `scripts/probar-inscripcion-enlace.js` (465) **no viajan**.

> **El enlace del conductor solo funciona el día de la elección** (la fecha de `configuracion_campana`, de 00:00 a 23:59 hora de
> Colombia). Antes y después dice «Este enlace no está activo»: para ensayar, se cambia la fecha de elección.
>
> **Quien tenga el enlace ve las direcciones de su lista.** Si un conductor lo pierde o lo reenvía, **rotarlo** (botón «Rotar»: el
> anterior deja de servir en el acto). Solo ve SUS paradas, solo ese día, y una parada cerrada ya no manda dirección ni teléfono.
>
> **El fondo del mapa es OpenStreetMap** (`tile.openstreetmap.org`, con su atribución): sin clave ni gasto, pero es un servicio
> comunitario con política de uso justo; para mucho tráfico habría que pasar a otro proveedor o a Mapbox. Sin señal para las
> teselas el mapa queda gris y la lista funciona igual.

- **Lo que ya existía y se reutiliza:** la demanda es `votantes.necesita_transporte` (la marca el líder con `rescate_votos`, no
  cambia); el código del conductor usa el alfabeto y las funciones de `/i` (`generarCodigo`, `normalizarCodigo`); el patrón de
  página pública es el de `/i` (después del candado de licencia, `noindex`, límite de intentos FALLIDOS por IP); las coordenadas
  del puesto salen de `ubicacionDelPuesto` (catálogo, `routes/checkinDiaD.routes.js`); la distancia, de `lib/jornadaDiaD.js`; la
  cola sin señal sigue la idea del check-in (marca con `cliente_uuid`, idempotente en el servidor).
- **Tablas** (`db/init-db.js`, `CREATE TABLE IF NOT EXISTS`, idempotente; todas con `aspirante_id` como dueño, 0 = la madre):
  `transporte_vehiculos` (placa única por campaña, tipo, capacidad, descripción, activo), `transporte_conductores` (nombre,
  celular, `vehiculo_id`, `codigo CHAR(8)` único, activo, `usuario_id` opcional) y `transporte_asignaciones` (`votante_id`,
  `conductor_id`, `fecha`, `orden`, `personas`, `nota`, `estado` asignado/recogido/en_puesto/no_estaba/cancelado, `recogido_en`,
  `llevado_en`, coordenadas del toque, `cliente_uuid`, `asignado_por`; **UNIQUE(votante_id, fecha)**). Y
  `configuracion_campana.transporte_alerta_desde TIME DEFAULT '14:00:00'` (queda creada; **la usa la parte 2**). La prueba corre
  `init-db` dos veces y comprueba las tres tablas, las columnas, el UNIQUE y la hora.
- **Módulo `transporte_dia_d`**, declarado en los cinco sitios: `PERMISOS_POR_DEFECTO` (admin y coordinador), la matriz de
  `routes/permisos.routes.js`, el menú de escritorio (`common.js`, «Transporte del Día D» → `/dia-d.html#transporte`),
  `middleware/aspirante.js` (módulo y permisos del aspirante) y la tarjeta de `app/inicio.html`. Un líder sin el módulo recibe 403;
  **seguirá marcando «necesita transporte»** con `rescate_votos`.
- **Escritorio, pestaña «Transporte»** de `dia-d.html` (`public/js/transporte-dia-d.js`): demanda agrupada por puesto y barrio con
  filtros (todos / sin asignar / asignados / por conductor, e «incluir a quienes ya votaron»), vehículos y conductores (crear,
  editar, desactivar, asignar vehículo; el código se crea solo y se rota), asignar varios a un conductor con **aviso de capacidad
  que no bloquea** (suma de «personas» contra la capacidad del vehículo), quitar, **«Ordenar por cercanía»** (vecino más cercano con
  la distancia de `lib/jornadaDiaD.js`, sin API: desde la primera parada, desde mi ubicación, o desde un puesto con coordenadas en
  el catálogo; las paradas sin coordenadas quedan al final), y **compartir** el enlace por WhatsApp (`wa.me`), SMS (`sms:`) o Copiar
  con el texto «Hola {nombre}, esta es tu lista de recogida del día de elecciones: {enlace}», sin el pie «Baja». Personas y nota por
  parada con el botón ✎.
- **El contador** (`GET /api/dia-d/transporte/resumen`, seis tarjetas en el cuadro del Día D y en la pestaña), con el alcance de quien
  pregunta: *necesitan* (marcados), *asignados* (con conductor, sin recoger), *recogidos*, *en el puesto*, *no estaban* y
  *sin recoger* (marcados, sin «ya votó» y sin recoger: sin conductor o con conductor que no ha llegado). Las paradas son de UN día: con
  otra fecha de elección el contador de asignaciones parte de cero.
- **`/t/<código>`** (`routes/transporte.routes.js`, `public/js/transporte-conductor.js`): pública, **después del candado de licencia**
  como `/i`, `noindex` y `no-store`. Inexistente, mal formado, desactivado, rotado (el código viejo) y fuera de la fecha de elección
  reciben LA MISMA respuesta byte a byte («Este enlace no está activo»; en las rutas JSON `{"activo":false}`). El límite de
  intentos fallidos es el de `/i` (40 cada 15 minutos por IP; las visitas buenas no gastan cupo). Cada parada trae **primer nombre e
  inicial del apellido** (con tres palabras o más, el apellido es la PENÚLTIMA: «Ana María Pérez Gómez» → «Ana P.»), dirección,
  barrio, personas, puesto, mesa; «Llamar» (`tel:`, el número no se escribe en pantalla), «Navegar» (Google Maps
  `…/dir/?api=1&destination=lat,lon` o la dirección) y Waze (con coordenadas), y «Cómo llegar al puesto» con las coordenadas del
  catálogo. **«Recogido», «Llevado al puesto» y «No estaba»** son idempotentes con `cliente_uuid`; la pantalla responde al
  instante y la marca espera en una cola del teléfono (localStorage) que sube sola con señal; la hora que cuenta es la del toque; la
  ubicación se pide **solo al tocar** y nunca bloquea. Después de «Llevado al puesto» o «No estaba» la parada se colapsa y el servidor
  **ya no manda dirección, barrio, teléfono ni coordenadas**; lo mismo si el votante marca «Ya voté» por `/v` (o el equipo). Una marca
  que no hace avanzar el estado (una repetida, o un «recogido» que llega tarde, después de «llevado») no cambia nada.
- **«Llevado al puesto» NO es «ya votó»:** nunca se escribe en `votante_votos`.
- **Mapa:** Leaflet 1.9.4 servido desde `public/vendor/leaflet/` (sin CDN; sha256 de `leaflet.js` `db49d009…641a` y `leaflet.css`
  `a7837102…04c6`, copias sin cambios del paquete npm; ver `LEEME.txt`), pines numerados por parada pendiente con coordenadas y otro
  por cada puesto de destino. La página manda `Referrer-Policy: origin` (OpenStreetMap lo pide para sus teselas).
- **Punto 5 (pendiente de la orden 31): `GET /api/usuarios/buscar-por-cedula`.** Misma regla que votantes: la cuenta **propia, de su
  rama (hacia abajo) o de quien cuelga (hacia arriba)** responde como siempre; **fuera de su alcance, solo
  `{ existe, fuera_de_alcance, iniciales }`**; el administrador (sin sublicencia) ve todo; el aspirante mira desde su propia rama.
  Comparte con la búsqueda de votantes **el MISMO contador de 60 cada 10 minutos** (`lib/busquedaCedula.js`, una sola instancia de
  `express-rate-limit`) y lo ajeno queda en `auditoria` (`buscar_cedula_ajena`, entidad `usuarios`, tres últimos dígitos). Encuentra la
  cédula escrita con puntos o ceros. La alta rápida de asistentes sigue ofreciendo «Agregar» a una cuenta de su alcance y avisa de la
  que está fuera. **Consecuencia que conviene saber:** un líder ya no puede agregar como asistente la cuenta de OTRO líder (fuera de
  su rama); la orden lo pide así.
- **Verificado sobre el zip:** los 27 archivos de código coinciden por md5 con el commit `98cf9b2`; sin `.env`, `.credenciales-*`,
  `uploads/`, `legislacion/`, `backups/`, `scripts/` ni `.sql`; `verificar-requires.js` revisó 118 `require` locales y todos
  resuelven **aplicando el zip sobre una copia del árbol del 283** (`b0b2afb`), con un control negativo.
- **Probado:** 123 comprobaciones del transporte y del punto 5 (init-db dos veces, permisos, asignar y desasignar, el aviso de
  capacidad, el UNIQUE, ordenar por cercanía, `/t` con código vivo, inexistente, inactivo, rotado y fuera de fecha, el conductor que
  no ve paradas de otro, marcar idempotente, la parada cerrada por «Ya voté», el contador por alcance); la suite de inscripción
  (465) y `probar-instalacion-limpia.js` (61 tablas). En **Chromium sin interfaz**: `/t` a 360 px con mapa y OpenStreetMap, la cola sin
  señal (con los POST caídos la marca queda en la cola, la parada cambia al instante y el aviso lo dice; al volver la señal sube sola
  y la cola queda en cero), y la pestaña de escritorio con un arnés mínimo. **NO se probó:** el botón «Navegar» abriendo Google Maps
  o Waze en un teléfono, el GPS real al tocar una marca, la pestaña dentro de `dia-d.html` con una sesión real (solo su JS con un
  arnés y las rutas con la suite), los avisos al conductor por SMS/WhatsApp desde un teléfono, ni un día de elección con tráfico real
  sobre las teselas de OpenStreetMap.
- **Queda para la parte 2:** la alerta «votantes con transporte sin recoger a las 2 p. m.» (la hora ya está en
  `transporte_alerta_desde`; falta calcularla en `lib/alertasDiaD.js`, también en `alertasParaUsuario`) y el SMS «tu transporte va en
  camino» al votante.
- **Cómo exige el 283.** Sin declarar dependencia (ver «Cómo exige el 273»): **activar el 284 con el 283, el 282, el 281, el 280, el
  279, el 278, el 277 y el 276 y los anteriores, con la misma lista de campañas.**

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Toca la base:** `init-db` crea tres tablas y una columna (ya viene marcado «toca base de datos»).
2. **El enlace del conductor solo funciona el día de la elección.** Para ensayar antes, cambiar la fecha de elección en Configuración →
   Datos de la campaña (y devolverla).
3. **Quien tenga el enlace ve las direcciones de su lista: rotarlo si se pierde.**
4. **El fondo del mapa es OpenStreetMap.**
5. El coordinador y el administrador ven la pestaña «Transporte» de fábrica; otro rol, desde «Asignación de permisos».
6. Los líderes dejarán de poder agregar como asistente la cuenta de otro líder fuera de su rama.
7. Aplicar después del 283, con la misma lista de campañas.

## Parche 283 — privacidad al buscar cédula y SMS al reinscribirse (7 de noviembre de 2026, INACTIVO, TOCA LA BASE)

Zip de 6 archivos: `config/inscripcionRegistro.js`, `db/init-db.js`, `public/asistentes-reuniones.html`,
`public/js/validacion-cedula-ui.js`, `routes/votantes.routes.js` y `.version-base` (283). Commit que recoge: `f9e4798` (a
partir de `badeaae`, el del 282). `scripts/probar-inscripcion-enlace.js` (465 comprobaciones) **no viaja**. **Service worker sin
cambio** (`v157`): ninguno de los archivos que cambian está en su precache y los demás se piden «red primero».

### Parte A — buscar por cédula sin exponer datos ajenos

- **Lo que pasaba:** `GET /api/votantes/buscar-por-cedula` (cualquier usuario con sesión; el router solo exige `requireAuth`)
  devolvía **nombre, teléfono y cédula** de la ficha dueña de esa cédula **aunque fuera de otro líder**, y las pantallas
  **rellenaban el formulario** con ese nombre y teléfono. Lo llamaban `public/js/validacion-cedula-ui.js` (cargado por
  `votantes.html` —escritorio—, `territorial.html`, `testigos.html` y `app/registro-votante.html` —celular—) y la alta rápida de
  `public/asistentes-reuniones.html`.
- **Qué devuelve ahora (JSON de ejemplo inventado):**
  - **Ficha propia o dentro de su alcance** (la misma condición del listado, `lib/alcanceVotantes.js`; o `mia`: es suya, o de su
    rama): como siempre. `{ "id": 41, "nombre": "Pedro Gómez Ruiz", "telefono": "3001234567", "cedula": "1053123456", "mia": true, "puede_sumar": false }`
  - **Ficha de otro líder:** solo `{ "existe": true, "de_otro_lider": true, "iniciales": "P. R.", "puede_sumar": false }`. Ni
    teléfono, ni cédula, ni nombre, ni correo, ni dirección, ni puesto, **ni id**, ni quién es el líder dueño. Las iniciales son
    la primera y la última palabra del nombre, sin partículas («de», «del»…).
  - **Administrador** (sin sublicencia): todo, como siempre. **Cédula que no existe:** `null`, como siempre.
  - **Ojo, el coordinador NO tiene «alcance total»:** su alcance es su rama (sus líderes y los de ellos), no toda la campaña. Una
    ficha de otra rama —por ejemplo la de un aspirante— le sale con iniciales. La orden decía «coordinador con alcance total»; no
    existe tal cosa hoy y no lo cambié.
  - **Pasados 60 en 10 minutos:** HTTP 429 `{ "error": "Demasiadas búsquedas, espera unos minutos" }`.
- **El límite:** 60 por **usuario** (no por IP: varios líderes comparten la wifi de un evento) cada 10 minutos, con `express-rate-limit`
  en memoria del proceso (un reinicio de PM2 lo pone en cero). **Cuenta también a `sumar-por-cedula` y a
  `/:id/sumar-a-mi-rama` cuando traen cédula** (son la misma pregunta). Una consulta sin cédula no cuenta.
- **La bitácora:** la tabla `auditoria` que ya existía (`registrarAuditoria`), acción **`buscar_cedula_ajena`**, entidad `votantes`,
  `usuario_id`, `created_at`, `ip` y el detalle «Buscó una cédula de otro líder (***456)»: solo los tres últimos dígitos, nunca la
  cédula completa ni el id de la ficha. **No hay tabla ni columna nueva para esto.** Solo deja rastro una búsqueda que cae en una
  ficha ajena (no la propia ni una cédula inexistente). Para ver a quien recorre cédulas, como administrador en la base:
  `SELECT usuario_id, COUNT(*) n, MIN(created_at), MAX(created_at) FROM auditoria WHERE accion = 'buscar_cedula_ajena' GROUP BY usuario_id ORDER BY n DESC;`
- **Sumar a mi rama:** la regla **no cambió** (se acredita con la cédula o con el alcance; solo quien está en la rama de un aspirante
  puede sumar). Como una ficha ajena ya no trae su id, **nueva ruta `POST /api/votantes/sumar-por-cedula { cedula }`**: el servidor
  encuentra la ficha por la cédula (normalizada, con las variantes guardadas) y aplica la MISMA función que `/:id/sumar-a-mi-rama`
  (que sigue existiendo). Sumada, la búsqueda la devuelve completa y como propia.
- **Las pantallas** (probadas en Chromium con un `api()` simulado): «**Esta persona ya está inscrita con otro líder (P. G.)**»; el
  botón «**Sumar a mi rama**» solo si `puede_sumar`; **no se rellena nada del formulario** y no se muestran campos vacíos; ya sumada
  dice «Listo: esta persona quedó en su rama.». Pasado el límite se dice el mensaje. En la **alta rápida de asistentes** una ficha
  ajena ya no ofrece «Agregar» (no tiene id): primero se suma, y entonces la búsqueda la encuentra como propia.
- **No cambió, y conviene saberlo:** `GET /api/usuarios/buscar-por-cedula` (cuentas del sistema) sigue devolviendo nombre y teléfono
  del usuario con esa cédula a quien pregunte (la alta rápida de asistentes lo usa). Son cuentas de la estructura, no votantes; si se
  quiere tratarlo igual, es otra orden.

### Parte B — SMS de confirmación al reinscribirse por `/i`

- **La regla:** cédula que ya existe + **el celular coincide** → se encola **otra vez el mismo SMS de confirmación** de `/c` si se
  cumplen **las cuatro a la vez**: (1) `consentimiento_confirmado_en` vacío; (2) la persona **marcó el SMS en este envío**; (3) la ficha
  no tiene `no_contactar` (la baja); (4) no se le mandó uno —enviado o en cola— en las **últimas 24 horas**. Celular que no coincide,
  ficha ya confirmada o casilla sin marcar: **no se manda nada y no se modifica nada**. **La respuesta pública no cambia** (la misma
  página «¡Listo!» para nueva, existente con SMS, y existente sin SMS; la prueba lo compara byte a byte).
- **La cola:** `inscripcion_sms_cola` tiene `UNIQUE(votante_id)` (uno por ficha en la vida); para poder repetir se **reutiliza la
  misma fila**: pasa otra vez a `pendiente` y se le renueva `creado_en`. «Hace cuánto» es `COALESCE(enviado_en, creado_en)`.
- **La evidencia de ESTE envío, solo en campos vacíos**, antes de encolar: fecha, método, versión de la política y los canales marcados
  que estén en NULL («no consta»), y la fila de `votante_consentimiento_evidencia` (IP, navegador, enlace, política; si ya había, se
  conserva la primera). **Interpretación que conviene confirmar:** un **0 puesto a mano** en una ficha de un líder (la persona dijo que
  no) **no se convierte en 1**, y entonces no se manda nada; en una ficha que **nació de este mismo formulario** (`origen = enlace_lider`)
  el 0 solo significa «no marcó el SMS», así que lo último que declara la propia persona manda y pasa a 1. Sin ese 1 la cola omite el
  mensaje («no autorizó el SMS»), por eso sin él ni se encola.
- **La anotación:** columna nueva **`inscripcion_intentos.sms_reenviado TINYINT(1) NOT NULL DEFAULT 0`** (por eso toca la base); se pone
  en 1 si se encoló en la reinscripción. Sin la columna (init-db sin correr) la inscripción sigue y simplemente no anota.
- Una ficha de **otro líder** con el celular que coincide también recibe el SMS (la regla no la excluye) y el dueño no cambia.
  Un cambio de pasada: la rama «completar la autorización de una ficha sin consentimiento» ahora también cubre un `NULL` (la columna es
  `NOT NULL DEFAULT 0`, así que en la práctica no cambia nada).

### Verificación y despliegue

- **Verificado sobre el zip:** los 5 archivos de código coinciden por md5 con el commit `f9e4798`; sin `.env`, `.credenciales-*`,
  `uploads/`, `legislacion/`, `backups/`, `scripts/` ni `.sql`; `verificar-requires.js` revisó 41 `require` locales y todos resuelven
  **aplicando el zip sobre una copia del árbol del 282** (`badeaae`), con un control negativo. `express-rate-limit` ya es dependencia.
- **Probado:** 465 comprobaciones sobre una base simulada (las de la orden: ficha propia, ajena —con el JSON completo revisado—,
  coordinador, administrador, aspirante, la 61 con 429, la bitácora, sumar, y los siete casos del SMS) y `probar-instalacion-limpia.js`.
  **Control negativo:** contra el código anterior fallan 21 de las nuevas. **NO se probó:** el envío real del SMS (el proveedor se
  sustituyó por un registro en memoria), las pantallas contra el servidor real (solo el cliente con un `api()` simulado), ni el tope
  de 60 con varios procesos (vive en memoria de cada uno).
- **Cómo exige el 282.** Sin declarar dependencia (ver «Cómo exige el 273»): **activar el 283 con el 282, el 281, el 280, el 279, el
  278, el 277 y el 276 y los anteriores, con la misma lista de campañas.**

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Toca la base:** `init-db` agrega una columna (ya viene marcado «toca base de datos»).
2. Los líderes dejarán de ver nombre y teléfono de personas de otros líderes al teclear su cédula: ahora solo se dice que ya están
   inscritas. Avisar al equipo; es lo esperado.
3. Una persona que se reinscribe puede recibir otro SMS de confirmación (máximo uno cada 24 horas).
4. Aplicar después del 282, con la misma lista de campañas.

## Parche 282 — cédulas sin duplicados en el alta, la importación y la edición (7 de noviembre de 2026, INACTIVO)

Zip de 9 archivos: `config/inscripcionRegistro.js`, `config/sincronizacionVotantesEstructura.js`,
`config/sincronizarSublicencias.js`, `config/testigoElectoral.js`, `lib/normalizarCedula.js`, `lib/ramas.js`,
`routes/coberturaTestigos.routes.js`, `routes/votantes.routes.js` y `.version-base` (282). Commit que recoge: `6d14c9a`
(a partir de `a314d13`, el del 281). **NO toca la base de datos** (sin `db/`) **ni el service worker** (ningún archivo
cacheado cambió). `scripts/probar-inscripcion-enlace.js` (413 comprobaciones) y `scripts/reporte-cedulas.js` **no viajan**.

> **ANTES Y DESPUÉS DE APLICAR, correr `scripts/reporte-cedulas.js` en cada campaña** (ver «Cómo correr el reporte»).
> El parche no limpia nada: deja de CREAR duplicados; los que ya existan los muestra el reporte y se limpian en otra orden.

- **El problema.** `votantes.cedula` es `UNIQUE`, pero el índice solo ve el texto idéntico, y el alta normal, la edición
  y las importaciones guardaban la cédula **como se tecleaba**. «1.053.123.456» y «1053123456» eran dos fichas de la misma
  persona, sin error (la prueba nueva lo confirma: contra la ruta anterior, el alta de la variante responde 200 y crea la
  segunda ficha; la orden 28 solo lo había cerrado en `/i`).
- **Dónde se guarda una cédula en `votantes` (las seis entradas, y qué hacen ahora):**
  1. **Alta normal** (`POST /api/votantes`; la usan el formulario de escritorio, la app del celular y el alta rápida de
     asistentes): valida lo tecleado con `revisarCedula` (mismos mensajes: acepta puntos y espacios; rechaza letras, guiones,
     vacía-de-dígitos, demasiado corta o larga), guarda **solo dígitos sin ceros a la izquierda**, y rechaza con el mensaje de
     siempre —**«Ya registrado por otro líder.»**— si otra ficha ya tiene esa cédula escrita como sea.
  2. **Edición** (`PUT /api/votantes/:id`): igual; la propia ficha no cuenta (puede traer su cédula vieja con puntos y se
     guarda ya normalizada).
  3. **Importación por Excel** (`POST /api/votantes/importar-excel`): valida cada cédula (antes NO validaba nada: una letra
     entraba), la guarda normalizada, y **salta** la fila si la cédula ya está en una fila anterior del archivo o en la base
     (normalizada). Cada una queda en `cedulasRepetidas` —`{ fila, donde: 'archivo'|'base', cedula: '***456', otraFila }`—
     y también en `errores` (lo que la pantalla ya muestra), con el número de fila de Excel y **nunca la cédula completa**.
     La base se consulta **una vez para todo el archivo** (`mapaDeFichasPorCedula`: un `IN` por el índice y un solo barrido de
     las guardadas con signos o ceros), no una vez por fila. En modo «actualizar» (fila con ID) la propia ficha no cuenta.
  4. **Importación JSON** (`POST /api/votantes/importar`, solo admin/coordinador; ninguna pantalla la llama): las mismas reglas.
  5. **Sincronización Estructura → Votantes** (`config/sincronizacionVotantesEstructura.js`, al crear o editar una cuenta de
     la estructura): la ficha se busca escrita como esté y, si existe, se usa **su** escritura como llave del `INSERT … ON
     DUPLICATE KEY` (no crea una segunda ni la reescribe); si no existe, nace normalizada.
  6. **El formulario público `/i`** (orden 28): ya normalizaba; ahora usa la MISMA función de búsqueda (movida a la librería,
     no duplicada).
  **No hay escáner de cédulas en el código** (`SPEC-escaner-cedulas.md` es solo una especificación) ni otra pantalla que escriba
  `votantes.cedula`. `sumar-a-mi-rama` no la escribe: compara (ver abajo).
- **La regla, en un solo sitio:** `lib/normalizarCedula.js` — `normalizarCedula` (solo dígitos, sin ceros delante),
  `buscarFichaConCedula` / `buscarFichaPorCedula` (por el índice y, si no hay, entre las variantes guardadas),
  `mapaDeFichasPorCedula` (para importar) y `buscarUsuarioPorCedula`. **No se reescribe ninguna cédula ya guardada** salvo
  la de la ficha que alguien edita (queda normalizada): otras partes cruzan por texto y la limpieza va aparte.
- **Lo que hoy MUESTRA el sistema de otra ficha (no se cambió, y es lo que preguntaste):** `GET /api/votantes/buscar-por-cedula`
  —lo que el formulario consulta antes de guardar— devuelve **nombre, teléfono y cédula** de la ficha dueña de esa cédula
  **aunque sea de otro líder**, sin filtro de alcance: es una decisión documentada en el propio código («solo confirma quién es
  el dueño de ESA cédula puntual», para poder sumar a esa persona a la rama). Lo único que cambió es que ahora la encuentra
  también si está guardada con puntos o ceros (la misma exposición, ahora completa para las variantes). El alta y la edición
  **no** muestran nada de la otra ficha: solo «Ya registrado por otro líder.».
- **Cruces por texto con `usuarios.numero_identificacion`, ahora comparando normalizado los dos lados** (una ficha vieja
  «1.053.123.456» sigue casando con una cuenta «1053123456» y al revés):
  `routes/votantes.routes.js` (el **listado**, su **conteo** y la **exportación**: `LEFT JOIN usuarios ut ON …`),
  `lib/ramas.js` (`usuarioDeVotante`, `recalcularTodas` y la actualización por sublicencia),
  `config/testigoElectoral.js` (`supervisorDelTestigo` y `resolverOCrearUsuarioParaTestigo`),
  `routes/votantes.routes.js` `procesarSublider` (cuenta del sublíder), `config/sincronizarSublicencias.js`,
  `config/sincronizacionVotantesEstructura.js` (los dos sentidos) y `routes/coberturaTestigos.routes.js` (los conjuntos de cédulas).
  `sumar-a-mi-rama` y `verificar-identificacion` también comparan normalizado.
  **Sin cambiar a propósito:** (a) las altas y ediciones de `usuarios` (`routes/territorial.routes.js`, `routes/usuarios.routes.js`):
  comparan cuentas contra cuentas y `numero_identificacion` es también el nombre de usuario y la clave inicial —normalizarlo
  ahí cambiaría cómo entra la gente—; (b) `db/init-db.js` (unión de una migración de una sola vez); (c) la búsqueda de texto
  del listado (`v.cedula LIKE '%…%'`): buscar «1.053» no encuentra «1053…»; (d) `routes/eventos.routes.js`, que solo muestra
  `COALESCE(v.cedula, u.numero_identificacion)`.
- **MEDIDO ANTES DE CAMBIAR LOS CRUCES SQL** (MySQL 8.4 privado, 200.000 votantes, 3.000 cuentas, 150 de ellas con puntos), con la
  ruta real, mediana de 5 corridas (de 2 en la exportación): el **listado** pasa de **2,4 s a 1,9 s** (páginas 1 y 400), y la
  **exportación completa** de **35,7 s a 33,9 s**. **No es más lento**: igualar por una expresión sobre los dos lados hace que
  MySQL use una unión por hash en vez de 200.000 búsquedas por índice. (Y casa a las 150 cuentas con puntos, que la igualdad
  exacta dejaba sin unir: 2.850 de 3.000.) La variante «solo normalizar la cuenta y dejar un tramo `OR` para fichas viejas»
  **no terminó** en más de 200 s: se descartó. Ojo con un dato aparte: la exportación de 200.000 fichas ya tardaba ~35 s antes.
  `supervisorDelTestigo`, que es UNA cuenta, NO usa la unión (barrería todos los votantes en cada llamada): busca por la función común.
- **Cómo correr el reporte** (solo lectura; **no viaja en el parche**: está en `scripts/` de la Base). Desde la carpeta de cada
  campaña, con el node de SU cuenta y su `.env`, copiando el archivo si hace falta:
  ```bash
  cp /home/appestrategia-electoral/htdocs/electoral.appestrategia.net/scripts/reporte-cedulas.js <carpeta-de-la-campaña>/scripts/
  cd <carpeta-de-la-campaña> && node scripts/reporte-cedulas.js          # 200 grupos; --todos o --json
  ```
  Lista **(a)** los grupos de casi-duplicados —id de ficha, líder, fecha de creación, cédula enmascarada (***456) y cómo está
  guardada— y **(b)** cuántas cédulas están guardadas con signos o ceros sin tener duplicado. Nunca imprime una cédula completa
  y no modifica nada (la prueba compara el `CHECKSUM TABLE`). Sale con código **2 si hay casi-duplicados**, 0 si no, 1 si falla.
  Con 200.000 fichas tarda unos 6 s.
- **Resultado en la Base** (`electoraldb`, 7 de noviembre de 2026): 0 fichas (es la plantilla), índice `UNIQUE` presente, 0
  casi-duplicados, 0 guardadas con signos o ceros. **Las campañas NO se pudieron medir** (esta cuenta no lee sus bases).
- **Verificado sobre el zip:** los 8 archivos de código coinciden por md5 con el commit `6d14c9a`; sin `.env`,
  `.credenciales-*`, `uploads/`, `legislacion/`, `backups/`, `scripts/` ni `.sql`; `verificar-requires.js` revisó 56 `require`
  locales y todos resuelven **aplicando el zip sobre una copia del árbol del 281** (`a314d13`), con un control negativo.
- **Probado:** 413 comprobaciones sobre una base simulada (alta con puntos, espacios y ceros; alta de una variante, con el mismo
  mensaje y sin datos de la otra ficha; edición a una cédula existente; importación con una repetida en el archivo y otra contra
  la base, con su número de fila y sin cédula completa; cruces con cuentas escritas distinto, en el listado, el conteo, la
  exportación, ramas, testigos y sincronización; el reporte sobre datos sembrados) y `probar-instalacion-limpia.js`.
  **Control negativo:** la misma suite contra la ruta `votantes.routes.js` anterior falla 25 comprobaciones. **NO se probó:** una
  campaña real con fichas viejas, el formulario de escritorio ni la app del celular contra el servidor (solo sus rutas), ni el
  orden de magnitud de una importación de miles de filas contra un catálogo grande con muchas variantes.
- **Un cambio de conducta que conviene saber:** la importación por Excel **ahora rechaza** una fila con la cédula inválida (con letras,
  guiones, demasiado corta…); antes la guardaba tal cual. Y una cédula con guiones («1-053-123-456») sigue rechazándose en el alta
  y la edición, como hoy.
- **Cómo exige el 281.** Sin declarar dependencia (ver «Cómo exige el 273»): **activar el 282 con el 281, el 280, el 279, el
  278, el 277 y el 276 y los anteriores, con la misma lista de campañas.**

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Antes:** correr `scripts/reporte-cedulas.js` y guardar el resultado. **Después:** correrlo otra vez; no debe haber grupos
   nuevos. Los que ya existían se limpian en otra orden, con lo que salga.
2. No toca la base: no hace falta `init-db` ni cambia el service worker.
3. Una ficha vieja con la cédula con puntos **se normaliza sola la primera vez que alguien la edita** (queda «1053…»); una cuenta
   con puntos sigue casando con ella.
4. Aplicar después del 281, con la misma lista de campañas.

## Parche 281 — inscripción por enlace: mensaje de invitación con eslogan (7 de noviembre de 2026, INACTIVO, TOCA LA BASE)

Zip de 10 archivos: `config/inscripcionMensaje.js` y `config/inscripcionTarjeta.js` (**nuevos**), `db/init-db.js`,
`public/app/mi-enlace.html`, `public/img/inscripcion-og.png` (**nuevo**, imagen genérica de la tarjeta),
`public/service-worker.js` (**v157**), `public/votantes.html`, `routes/inscripcion.panel.routes.js`,
`routes/inscripcion.routes.js` y `.version-base` (281). Commit que recoge: `82d8637` (a partir de `fae7508`, el del 280).
`scripts/probar-inscripcion-enlace.js` (357 comprobaciones) y `scripts/generar-imagen-inscripcion.js` **no viajan**.

> **LLENAR EL ESLOGAN EN LA CONFIGURACIÓN DE CADA CAMPAÑA** (Configuración → Datos de la campaña → «Slogan de la
> campaña», y el nombre del candidato). Sin eslogan el mensaje sale sin su línea ✨ y la vista previa dice solo
> «Inscríbete con {candidato}»; sin candidato, «Inscríbete con nuestro equipo».

- **Columnas que ya existían (no se creó ninguna de datos de campaña):** `configuracion_campana.slogan_campana VARCHAR(255)`
  (el eslogan; ya se llena en Configuración), `nombre_candidato VARCHAR(150)`, y para la marca `marca_titulo`,
  `marca_subtitulo` y `marca_logo_url` (ruta `/uploads/marca/…`, carpeta que ya es pública). No hay columna de foto.
  Respaldo: si falta `slogan_campana` se usa `marca_subtitulo`; si falta `nombre_candidato`, `marca_titulo`. Un líder que
  cuelga de un **aspirante con sublicencia** usa los DEL ASPIRANTE (su nombre y el subtítulo de su sublicencia), igual que
  `GET /api/configuracion`.
- **La única columna nueva:** `inscripcion_config.mensaje_plantilla TEXT NULL` (por eso toca la base). **NULL = el texto
  sugerido**, que vive en `config/inscripcionMensaje.js`: así las campañas que nunca lo editaron reciben las mejoras
  futuras. Guardar un texto idéntico al sugerido lo deja en NULL.
- **Plantilla y reglas.** Variables: `{nombre_lider}` (primer nombre, bien escrito), `{candidato}`, `{eslogan}`, `{enlace}`;
  **no hay `{cargo}` ni número de tarjetón**, y el texto sugerido no menciona cargo, elección, voto ni tarjetón (una
  prueba lo comprueba). **Si a una línea le falta un dato, se quita la línea entera**; nunca queda «{eslogan}» ni dos
  líneas en blanco seguidas; una llave desconocida cuenta como dato faltante. Un dato que trae llaves no se vuelve a
  expandir. El administrador la edita en **Votantes → Inscripciones por enlace → Ajustes → «Mensaje de invitación»**, con
  vista previa y **«Restaurar texto sugerido»**; el servidor rechaza (400) una variable que no existe, un texto sin
  `{enlace}`, vacío, de más de 1000 caracteres o con una llave suelta. Cada cambio queda en la auditoría.
- **Texto final (datos de ejemplo):**
  ```
  Hola 👋, soy Ana.
  ✨ Juntos por Manizales
  Te invito a sumarte al equipo de María Gómez. Juntos vamos a lograrlo.
  📝 Inscríbete en menos de 1 minuto, desde tu celular:
  👉 https://electoral.appestrategia.net/i/AB23CD45
  Tus datos están protegidos y solo se usan para la campaña. ¡Cuento contigo!
  ```
- **«Mi enlace»** (`GET /api/inscripcion/mi-mensaje`): el líder ve el texto ya lleno en un cuadro y el SMS corto en otro,
  los edita **solo para ese envío** (no se guardan), y los botones **Por WhatsApp**, **Por SMS** (`sms:?&body=`, abre en
  iPhone y Android), **Copiar mensaje** y **Compartir…** usan lo que haya en los cuadros; «Copiar solo el enlace» queda
  como texto. Sin conexión o si el servidor falla, vuelve el texto sencillo de antes. El mensaje se guarda en el
  teléfono junto con el QR; las cédulas enmascaradas del aviso del 280, no.
- **SMS corto** (automático, sin emojis ni tildes): `{nombre_lider}: {eslogan}. Inscribete con {candidato} aqui: {enlace}`.
  Si no cabe en 1 SMS **se quita el eslogan**; si aún no cabe, también el candidato. Lo manda el líder desde SU teléfono:
  no lleva firma ni «Baja:». **Medido con los tres dominios** (enlace de 8 caracteres): `electoral.appestrategia.net`
  106 caracteres, `campanadepruebamunicipal.appestrategia.net` 121, `campanadepruebadepartamental.appestrategia.net` 125; en
  el peor caso (nombre de 39 letras y eslogan de 80) 119 / 134 / 138, **sin eslogan** y en 1 SMS.
- **Vista previa del enlace (Open Graph de `/i/<código>`):** `og:title` «{candidato} · {eslogan}» (o «Inscríbete con
  {candidato}», o «Inscríbete con nuestro equipo»), `og:description` «Súmate al equipo. Inscríbete en menos de 1 minuto.»,
  `og:image` 1200 × 630, `twitter:card`; **`noindex` se mantiene**. **Idéntica para un código válido, inexistente, mal
  formado, desactivado o de otro líder y sin nada del líder** (la prueba compara los `<meta>` de los cinco casos); sale
  también en la página «Enlace no activo». **Usa la campaña madre, no la del aspirante:** si un líder cuelga de un
  aspirante, su MENSAJE nombra al aspirante pero la tarjeta del enlace muestra al candidato de la campaña. Es el precio de
  que la tarjeta no dependa del código; si molesta, se cambia.
- **La imagen.** Con logo (`marca_logo_url`): `/i/og/imagen`, una copia **JPEG de 1200 × 630** hecha con `sharp`
  (el logo no se enlaza: puede pesar hasta 4 MB y WhatsApp descarta lo grande), en memoria, con tope de 400 KB y
  `?v=` que cambia con el logo. Un logo **claro con transparencia** (como el de la plataforma, hecho para fondos
  oscuros) va sobre el azul de la app; uno oscuro o sin transparencia, sobre blanco. Sin logo, o si no se puede
  leer, o si la ruta no está dentro de `/uploads/marca` (se usa solo el nombre del archivo): **`inscripcion-og.png`**,
  «SÚMATE AL EQUIPO · Inscríbete en menos de 1 minuto» con una persona y un «+», generada como `ya-vote-og.png` (el
  guion `scripts/generar-imagen-inscripcion.js` la rehace). Sin `LICENCIA_DOMINIO` no se inventa una URL de imagen.
- **Seguridad de despliegue.** `leerAjustes` (que usa cada visita a `/i`) **no se tocó**: la plantilla se lee aparte y
  tolerante. Una campaña que aplique el parche pero **no corra `init-db`** sigue inscribiendo; «Mi enlace» usa el texto
  sugerido y guardar la plantilla responde 409 «falta actualizar la base de datos», no un 500 (lo prueba la suite
  quitando la columna a propósito).
- **Verificado sobre el zip:** los 9 archivos de código coinciden por md5 con el commit `82d8637`; sin `.env`,
  `.credenciales-*`, `uploads/`, `legislacion/`, `backups/`, `scripts/` ni `.sql`; `verificar-requires.js` revisó 24
  `require` locales y todos resuelven **aplicando el zip sobre una copia del árbol del 280** (`fae7508`), con un control
  negativo (sin `lib/transliterarSms.js` falla). `sharp` ya es dependencia declarada del proyecto.
- **Probado:** 357 comprobaciones sobre una base simulada (reemplazo de variables, línea faltante, validaciones, SMS con
  los tres dominios, plantilla editar/restaurar y permisos, sin la columna, OG con y sin eslogan, OG idéntico para códigos
  inválidos, imagen con un logo de 0,7 MB y uno ilegible, fondo según el logo, y los textos de las dos pantallas) y
  `probar-instalacion-limpia.js` (58 tablas). Capturas a 360 px de «Mi enlace» y de la imagen con el logo real de la
  plataforma. **NO se probó:** la vista previa **en WhatsApp de verdad** (el robot de WhatsApp tiene sus propias reglas de
  caché y de tamaño), el botón «Por SMS» en un iPhone y un Android, ni el editor del escritorio en un navegador con
  sesión (solo su HTML y los endpoints). WhatsApp guarda en caché la tarjeta de un enlace por días: si se prueba con un
  enlace ya compartido, puede seguir mostrando «Inscríbete».
- **Cómo exige el 280.** Sin declarar dependencia (ver «Cómo exige el 273»): **activar el 281 con el 280, el 279, el 278,
  el 277 y el 276 y los anteriores, con la misma lista de campañas.**

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Llenar el eslogan y el nombre del candidato** en Configuración → Datos de la campaña, y subir el logo si hay.
2. **Toca la base:** `init-db` agrega una columna (ya viene marcado «toca base de datos»).
3. Revisar el texto en Votantes → Inscripciones por enlace → Ajustes → «Mensaje de invitación»: es el sugerido y se
   puede cambiar. Para una campaña que ya está en fase de elección, el administrador puede escribir su propio texto con
   cargo o llamado al voto; el texto sugerido es a propósito de precampaña.
4. **Service worker v157:** los teléfonos con la app instalada refrescan solos al tener señal.
5. Aplicar después del 280, con la misma lista de campañas.

## Parche 280 — inscripción por enlace: botón de consulta de puesto y control de cédulas (7 de noviembre de 2026, INACTIVO, TOCA LA BASE)

Zip de 9 archivos: `config/inscripcionRegistro.js`, `db/init-db.js`, `lib/normalizarCedula.js` (**nuevo**),
`public/app/mi-enlace.html`, `public/js/common.js` (solo un comentario), `public/service-worker.js` (**v156**),
`routes/inscripcion.panel.routes.js`, `routes/inscripcion.routes.js` y `.version-base` (280).
Commit que recoge: `539f7e3` (a partir de `bccb7e8`, el del 279). `scripts/probar-inscripcion-enlace.js` (ahora con 274
comprobaciones) **no viaja**.

- **La URL de la Registraduría estaba mal en `/i`** (la que puso el 279, `wsp.registraduria.gov.co/censo/consultar/`, ya no
  existe). Ahora es `https://consultacenso.registraduria.gov.co/`, una constante (`URL_CONSULTA_CENSO`) en
  `routes/inscripcion.routes.js`, igual a la de `public/js/common.js`. Se buscó en todo el repo: la dirección vieja ya no
  está en ningún `.js`, `.html`, `.css`, `.json` ni `.sh` (la prueba lo comprueba); `consulta-censo.js`,
  `app/registro-votante.html` y `app/puesto-votacion.html` ya llevaban la buena. Queda `SPEC-escaner-cedulas.md` con
  `wapp.registraduria.gov.co`: es un documento de especificación de otro servidor, no se tocó.
- **Botón en DÓNDE VOTAS:** «Consultar mi lugar de votación», a todo el ancho, justo bajo el título y antes de Puesto y
  Mesa; abre la Registraduría en otra pestaña (`target="_blank" rel="noopener noreferrer"`), sin cédula en la URL, con la
  línea «Consulta y vuelve aquí para elegir tu puesto y mesa». Es un `<a role="button">` con aspecto de botón (navega, no
  ejecuta código, y no depende de JavaScript ni lo frena un bloqueador de ventanas). A 360 px el texto del botón baja a
  dos líneas y se lee bien (captura revisada).
- **Cédulas: lo que había.** `votantes.cedula` **ya era `UNIQUE`** (en `db/schema.sql`), pero ese índice solo ve el texto
  idéntico y **el alta normal guarda la cédula como se tecleó** (sin normalizar: «1.053.123.456», «01053123456»). Una
  ficha así no chocaba con «1053123456» y `/i` habría creado una **segunda ficha de la misma persona, sin error**. Con
  cédula idéntica, `/i` ya hacía lo correcto (`ER_DUP_ENTRY` → completa solo si el celular coincide).
- **Lo que hace ahora:** `lib/normalizarCedula.js` (solo dígitos, sin ceros a la izquierda; la misma regla de
  `validarFormato`) se usa al guardar y al **buscar**: primero por el índice, y si no hay, contra las variantes guardadas
  con signos o ceros (`REGEXP_REPLACE`, sin índice, solo cuando la cédula es nueva). **No se reescribe ninguna cédula ya
  guardada** (otras pantallas cruzan `votantes.cedula` con `usuarios.numero_identificacion` por texto). Mismo
  comportamiento de antes en los dos casos de cédula existente: **celular coincide → solo se completan los campos
  vacíos; no coincide → no se modifica nada** (comprobado campo por campo, incluidas coordenadas y consentimiento).
- **La bitácora y el aviso al líder:** en los dos casos el intento queda con `motivo = 'cedula_existente'`, `cedula_fin`
  (últimos 3 dígitos) y `celular_coincide` (0/1). «Mi enlace» (`GET /api/inscripcion/mi-enlace` → `avisos`, los 20 más
  recientes de ese enlace) muestra al líder dueño: «Cédula ***456 · 07/11/2026 14:01 · el celular coincidía (se
  completaron solo los campos vacíos)» o «… NO coincidía (no se modificó nada)». Otro líder no los ve; la cédula
  completa no viaja; no se guardan en el teléfono (caché sin conexión). Si la base aún no tiene las columnas, la pantalla
  sigue funcionando sin avisos.
- **Lo que ve la persona:** la misma página «¡Listo!» para cédula nueva, existente con su celular y existente con otro
  celular (igual byte a byte, también con la casilla de SMS marcada; no dice «ya está inscrita»). **Tiempo medido:**
  medianas de 9 en la prueba, 16 ms (nueva), 15 ms (existente con su celular) y 13 ms (existente con otro celular).
  **Es un banco de pruebas con una base casi vacía:** con una campaña de cientos de miles de fichas el barrido por
  variantes costará más, y lo pagan las cédulas nuevas. No se midió.
- **TOCA LA BASE DE DATOS** (`toca_base_datos = true`, lo derivó el servidor de licencias porque el zip trae `db/`): el
  actualizador corre `npm run init-db` en cada campaña. Agrega **dos columnas** a `inscripcion_intentos`
  (`cedula_fin CHAR(3)`, `celular_coincide TINYINT(1)`, nulables; idempotente) y comprueba el índice de
  `votantes.cedula`: **si ya es UNIQUE no hace nada** (lo esperable), si falta y no hay cédulas repetidas lo crea, y **si
  hay repetidas NO lo crea: avisa por consola («AVISO: votantes.cedula NO tiene índice UNIQUE y hay cédulas repetidas…») y
  sigue.** Probado a mano sobre una base de prueba: columnas ausentes → agregadas; sin UNIQUE y con duplicados → aviso y
  sin índice; sin duplicados → índice creado. Y `probar-instalacion-limpia.js` pasó sobre una base vacía (58 tablas).
- **Duplicados en la Base** (`electoraldb`, medido hoy con la cuenta de Electoral): índice `cedula` UNIQUE presente,
  **0 filas** en `votantes` (es la plantilla), 0 duplicados exactos y 0 después de normalizar. **Las campañas NO se
  pudieron medir** (esta cuenta no lee sus bases): hay que correr en cada una, antes de aplicar:
  `SELECT cedula, COUNT(*) FROM votantes GROUP BY cedula HAVING COUNT(*)>1;` y, para los casi-duplicados,
  `SELECT TRIM(LEADING '0' FROM REGEXP_REPLACE(cedula,'[^0-9]','')) c, COUNT(*) FROM votantes WHERE cedula IS NOT NULL AND cedula<>'' GROUP BY c HAVING COUNT(*)>1;`
  (el segundo es el que el índice no ve).
- **No cubierto, a propósito:** el **alta normal** (`routes/votantes.routes.js`) sigue sin normalizar la cédula ni
  detectar variantes («1.053…» frente a «1053…»): el parche arregla el enlace de inscripción, no ese formulario. Si se
  quiere, es otra orden (con cuidado por el cruce con `usuarios.numero_identificacion`).
- **Verificado sobre el zip:** los 8 archivos de código coinciden por md5 con el commit `539f7e3`; `.version-base` = 280;
  sin `.env`, `.credenciales-*`, `uploads/`, `legislacion/`, `backups/`, `scripts/` ni `.sql`; `verificar-requires.js` revisó
  29 `require` locales y todos resuelven **aplicando el zip sobre una copia del árbol del 279** (`bccb7e8`), con un
  control negativo (sin `lib/validarCedula.js` falla, como debe).
- **Probado:** 274 comprobaciones sobre una base simulada (la URL, el botón y su posición, cédula repetida con puntos,
  espacios y ceros, otro celular sin cambios, respuesta idéntica y tiempos, el aviso al líder). **NO se probó:** la
  pantalla «Mi enlace» en un navegador con sesión (solo se probó la respuesta del servidor, el texto del HTML y la
  función de fecha), ni que la Registraduría abra bien desde un celular, ni una campaña real con muchas fichas.
- **Cómo exige el 279.** Sin declarar dependencia (ver «Cómo exige el 273»): **activar el 280 con el 279, el 278, el 277 y
  el 276 y los anteriores, con la misma lista de campañas.**

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Antes, correr las dos consultas de duplicados** de arriba. Si salen filas, hablarlo antes de activar: el índice no
   se crea con duplicados, y el control del enlace trata la primera coincidencia que encuentre.
2. **Toca la base: marcar «toca base de datos»** (ya viene marcado en el registro). Al aplicarlo se corre `init-db`;
   revisar su salida por si dice «AVISO: votantes.cedula…».
3. **Service worker v156:** los teléfonos con la app instalada refrescan solos al tener señal.
4. Aplicar después del 279, con la misma lista de campañas.

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
  un enlace a la Registraduría abre otra pestaña, sin la cédula ni ningún parámetro en la URL. **Esa dirección estaba
  mal** (la del servidor «wsp» ya no existe): la corrige el 280, con `https://consultacenso.registraduria.gov.co/`.
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
