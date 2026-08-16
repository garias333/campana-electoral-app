# Auditoría de seguridad — campana-app (Electoral)

**Fecha:** 16 de agosto de 2026
**Alcance:** `/home/appestrategia-electoral/htdocs/electoral.appestrategia.net` (rama `auditoria-fable`, commit `5e51671`)
**Método:** revisión de código sin modificarlo, más comprobaciones en vivo contra la instalación de producción (solo peticiones inocuas: `GET /login.html` y un `POST` de recuperación con una cuenta inexistente, que no envía correo).
**Superficie:** 80 archivos `.js` (21.374 líneas), 35 pantallas HTML, **200 rutas** en 23 routers.

---

> ## Estado: C-1, A-1 y A-2 corregidos en el parche 81
>
> Aplicado el 16 de agosto de 2026 a las dos campañas (versión 81, `estrategia-v66`).
> **El camino del rol de menor privilegio a la cuenta del administrador está cortado.**
>
> - **C-1** — escapados los 6 campos de persona en `public/votantes.html`.
> - **A-1** — escapados **16 sumideros** en `public/organigrama.html`, no los 6 del informe: al barrer el archivo aparecieron diez más (vistas de árbol y columnas, el `<option>` del cargo superior, y `nombreAbreviado()` en 7 sitios). Se añadió `atribOrg()` para atributos: `escaparOrgHtml` no escapa comillas, así que dentro de un `title="…"` seguía permitiendo salir del atributo y añadir un manejador de evento.
> - **A-2** — `POST /api/votantes` exige rol; `testigo` e `invitado` ya no pueden dar de alta. Sin regresión: la app ya redirige al testigo a Día D y nunca le ofrece el registro (`public/app/inicio.html:137`).
>
> Lo demás de este informe sigue abierto. El resto del orden sugerido no cambia.

---

## Resumen ejecutivo

La aplicación está **bien construida en los frentes que suelen fallar**: el SQL está parametrizado sin una sola excepción, la autenticación tiene igualación de tiempos, bloqueo por intentos atómico y tokens de recuperación guardados como hash, y los webhooks validan firma. Eso no es lo habitual y conviene decirlo antes que nada.

El problema está concentrado en un punto: **los datos que escribe un usuario se pintan en el HTML sin escapar**, y el rol que puede escribirlos es el más bajo del sistema. Eso abre una cadena que termina en la cuenta del administrador.

| Severidad | Nº | Concentración |
|---|---|---|
| **Crítico** | 1 | XSS almacenado en Votantes → toma de cuenta de administrador |
| **Alto** | 3 | XSS en Organigrama · creación de votantes sin rol · ausencia de CSP |
| **Medio** | 9 | Alcance por usuario en un solo módulo · exposición de datos personales · ciclo de vida de credenciales |
| **Bajo** | 6 | Endurecimiento y defensa en profundidad |

Dos aclaraciones que cambian decisiones y que verifiqué en vez de suponer:

- **El enlace de recuperación construido con la cabecera `Host` NO es explotable hoy.** Nginx responde `421` a un `Host` que no coincide, en 443 y en 80. Queda como Bajo, no como Alto.
- **`xlsx` ya no tiene la vulnerabilidad que documenta `CLAUDE.md`.** Está en 0.20.3 desde `cdn.sheetjs.com`, por encima de los dos CVE conocidos. `npm audit` no lo menciona porque no viene del registro npm, no porque esté limpio por casualidad.

---

# CRÍTICO

## C-1 · XSS almacenado en la tabla de Votantes → toma de cuenta de administrador

**Archivos y líneas**

| Punto | Ubicación |
|---|---|
| Sumidero principal | `public/votantes.html:988` — `<td><strong>${v.nombre}</strong>` y `v.cedula` concatenada |
| Sumideros iguales | `public/votantes.html:994` (`v.organizacion`), `:995` (`v.lider_nombre`), `:996` (`v.sublider_nombre`) |
| Entrada sin rol | `routes/votantes.routes.js:951` — `router.post('/', async (req, res) => {` |
| Única validación | `routes/votantes.routes.js:970` — `if (!b.nombre)` |
| Amplificador | `app.js:103` — `GET /api/csrf-token` devuelve el token a cualquier script del mismo origen |
| Amplificador | `app.js:62` — `contentSecurityPolicy: false` |

**Riesgo**

`POST /api/votantes` está detrás de `router.use(requireAuth, calcularAlcance)` (`routes/votantes.routes.js:50`) pero **sin `requireRole`**. Cualquier cuenta autenticada —líder, sublíder, testigo, invitado— puede crear un votante con el `nombre` que quiera; lo único que se comprueba es que no esté vacío. No hay saneamiento en ninguna capa: lo confirmé buscando `sanitize`, `DOMPurify`, `xss-clean` y `striptags` en `routes/`, `config/` y `middleware/` — no hay ninguno.

Ese texto llega crudo al `innerHTML` de la tabla de Votantes. Y quien abre esa tabla **sin filtro de alcance** es precisamente admin y coordinador (`middleware/auth.js:93`: `req.alcance = null`). El atacante de menor privilegio escribe; el de mayor privilegio ejecuta.

La cookie de sesión es `HttpOnly` (verificado en la respuesta real: `HttpOnly; Secure`), así que el script no la lee — pero no la necesita. El navegador del administrador la adjunta sola, y el token CSRF se pide con un `fetch` al propio origen. El script actúa como administrador con las dos piezas en la mano.

**Prueba de concepto (conceptual)**

1. Un líder —o cualquiera con sesión— registra un votante cuyo campo *Nombres y apellidos* contiene un elemento HTML con manejador de evento, del tipo `<img src=x onerror=…>`.
2. El payload, al ejecutarse, hace `GET /api/csrf-token`, toma el valor y lo reenvía en `X-CSRF-Token` en una petición de escritura contra `/api/usuarios` (crear una cuenta admin), `/api/votantes/exportar-excel` (exfiltrar el censo completo) o `/api/configuracion/eliminar-datos/votantes` (borrado masivo).
3. El administrador abre **Votantes y sublíderes** en su navegación normal. No hay clic ni interacción: basta con que la fila se pinte.
4. Las acciones quedan en `auditoria` **a nombre del administrador**.

**Corrección sugerida**

1. Escapar en el punto de pintado. La función ya existe y está probada: `escaparHtml()` en `public/js/common.js:516`, usada 113 veces en el resto de la aplicación. Aquí falta. Envolver `v.nombre`, `v.cedula`, `v.organizacion`, `v.lider_nombre`, `v.sublider_nombre`.
2. Añadir `requireRole('admin', 'coordinador', 'lider', 'sublider')` a `POST /api/votantes`, para que testigo e invitado no puedan insertar.
3. Validar el nombre en el servidor (`routes/votantes.routes.js:970`): rechazar `<` y `>`, que no tienen ningún uso legítimo en un nombre propio.
4. A medio plazo, el arreglo estructural es C-4 (CSP).

> **Nota de método.** El punto 1 por sí solo cierra este hallazgo, pero conviene aplicar los tres: hay 87 interpolaciones sin escapar repartidas por el frontend, y arreglar una a una según se descubren deja el resto vivo. La regla útil es *escapar en el sumidero, siempre*, no *confiar en que ese campo concreto es inocuo*.

---

# ALTO

## A-1 · XSS almacenado en el Organigrama

**Archivo y líneas:** `public/organigrama.html:557-564`

```
557  <td><strong>${n.cargo}</strong></td>
558  <td>${n.nombres || (n.nombre ? n.nombre : '—')}</td>
559  <td>${n.apellidos || '—'}</td>
561  <td class="mono">${n.email || '—'}</td>
564  …title="${n.funciones ? n.funciones.replace(/"/g, '&quot;') : ''}">${n.funciones ? n.funciones : '—'}</td>
```

**Riesgo.** Mismo patrón que C-1. Los escribe `POST/PUT /api/organigrama` (`routes/organigrama.routes.js:112` y `:147`), restringido a `admin` y `coordinador`; los lee **cualquier autenticado**, porque `routes/organigrama.routes.js:9` solo pone `router.use(requireAuth)`. Es escalada de coordinador a administrador.

Detalle de la línea 564: el atributo `title` escapa las comillas dobles, pero **el contenido de la celda no escapa nada**. Es fácil leerlo como si estuviera protegido.

**PoC conceptual.** Un coordinador crea o edita un cargo con un manejador de evento en *Cargo* o *Funciones*; se ejecuta en el navegador de cualquiera que abra Organigrama, incluido el administrador.

**Corrección.** Escapar las seis celdas. `public/organigrama.html` solo tiene **una** llamada a `escaparHtml` frente a 17 interpolaciones: es el archivo con peor proporción de la aplicación.

---

## A-2 · `POST /api/votantes` sin control de rol

**Archivo y línea:** `routes/votantes.routes.js:951`

**Riesgo.** Independientemente del XSS, un `testigo` o un `invitado` —roles pensados para consultar y reportar, no para alimentar la base— pueden insertar votantes en masa. `invitado` está descrito en `middleware/auth.js:7` como *"solo lectura"*, y no lo es.

Contrastar con el criterio del propio proyecto: `/importar-excel` sí recibió `requireRole('admin','coordinador')` (documentado en `CLAUDE.md`, sección 5d) justamente para reducir quién puede escribir. La ruta de alta individual quedó fuera de esa revisión.

**PoC conceptual.** Con una sesión de invitado, `POST /api/votantes` con el cuerpo mínimo (`nombre`); se crea la ficha. Repetido en bucle, contamina el censo y las metas.

**Corrección.** `requireRole('admin', 'coordinador', 'lider', 'sublider')`, coherente con `puedeAgregar(usuario, 'votantes')` del frontend.

---

## A-3 · Sin Content-Security-Policy

**Archivo y línea:** `app.js:62` — `contentSecurityPolicy: false`

**Riesgo.** Está desactivado a propósito y el motivo está escrito en el código (`app.js:42-45`): casi todas las pantallas llevan `<script>` embebido. Es una razón real, no un descuido. Pero el efecto es que **cualquier XSS se ejecuta sin ninguna restricción**: puede llamar a la API, exfiltrar a un dominio externo y persistir.

Con CSP, C-1 y A-1 seguirían siendo defectos, pero el salto a "toma de cuenta" quedaría cortado.

**Corrección.** No exige reescribir las 35 pantallas de golpe:

1. Empezar en modo observación con `Content-Security-Policy-Report-Only`, que no rompe nada y muestra qué se bloquearía.
2. Fijar `script-src 'self' 'nonce-<aleatorio por petición>'` y añadir ese `nonce` a los `<script>` embebidos — es un atributo por etiqueta, no una reescritura.
3. Cerrar con `object-src 'none'; base-uri 'self'`, que son gratis y bloquean dos vectores clásicos.

Priorizar `votantes.html`, `organigrama.html` y `territorial.html`: son las que pintan datos escritos por terceros.

---

# MEDIO

## M-1 · El alcance por usuario existe en un solo módulo

**Archivos:** `middleware/auth.js:91` (definición) · usado **únicamente** en `routes/votantes.routes.js:50`

`calcularAlcance` está bien hecho y bien aplicado: en Votantes lo comprueban los cinco caminos por id (`:237`, `:858`, `:1134`, `:1224`, `:1300`). Un líder no ve votantes de otro. Eso es correcto y conviene mantenerlo.

El problema es que **es el único módulo que lo usa**. Territorial, Eventos, Organigrama, Dashboard, Día D, Finanzas y Comunicaciones no lo aplican: quien tiene sesión ve todo el ámbito de la campaña. Para admin y coordinador da igual —su alcance es total— pero líder, sublíder, testigo e invitado acceden a información que su rol no necesita.

**Corrección.** Decidir explícitamente, módulo por módulo, si el alcance aplica; donde no aplique, dejarlo escrito. Hoy la ausencia de la comprobación no distingue entre "se decidió que no hace falta" y "se olvidó".

---

## M-2 · Datos personales de asistentes a cualquier rol

**Archivo y línea:** `routes/eventos.routes.js:45` — `router.get('/:id/asistentes', …)`

La consulta (`:53-62`) devuelve `nombre_resuelto`, `telefono_resuelto` y **`identidad_resuelta` (la cédula)**. La única guarda es `router.use(requireAuth)` en `routes/eventos.routes.js:11`: sin restricción de rol y sin comprobar que quien pregunta tenga relación con el evento.

**PoC conceptual.** Una sesión de testigo recorre `GET /api/eventos/:id/asistentes` con id 1..N y obtiene nombre, teléfono y cédula de todos los asistentes de todos los eventos. Es un incidente de datos personales bajo la Ley 1581.

**Corrección.** `requireRole('admin','coordinador','lider')` y omitir la cédula salvo para admin y coordinador.

---

## M-3 · Enumeración de la estructura por cualquier autenticado

**Archivo y líneas:** `routes/territorial.routes.js:1826, 1870, 1893, 1938, 1991`

Los cinco endpoints `coordinadores-por-zona`, `lideres-por-territorio`, `lideres-para-sublider`, `referentes-por-municipio` y `subliders-por-lider` devuelven nombres, ids y cargos sin restricción de rol. Recorriendo los ids de territorio se reconstruye el organigrama completo de la campaña.

**Corrección.** Restringir a los roles que de verdad los usan (los formularios de alta: admin, coordinador, líder) y devolver solo los campos que el desplegable necesita.

---

## M-4 · Un líder puede borrar campañas y plantillas de comunicaciones ajenas

**Archivo y líneas:** `routes/comunicaciones.routes.js:544` (`DELETE /plantillas/:id`), `:659` (`DELETE /campanas/:id`), `:673` (`GET /campanas/:id`), `:486` (`POST /campanas/:id/reintentar-fallidos`)

El router exige `admin, coordinador, lider, asistente_administrativo` (`:45`), pero ninguna ruta comprueba **quién creó** el recurso. Un líder puede borrar la campaña de mensajería de otro, o relanzar sus fallidos —lo que consume crédito de SMS real.

**Corrección.** Comparar contra `created_by` salvo para admin y coordinador.

---

## M-5 · Cambiar la contraseña no cierra las sesiones abiertas

**Archivos:** `routes/auth.routes.js:567` (`/cambiar-password`), `:649` (`/resetear-password`) · `config/tokenDispositivo.js:27`

Tras cambiar o restablecer la contraseña siguen siendo válidos: las sesiones en `sessions`, y sobre todo **los tokens de dispositivo, que duran 7 días y no tienen lista de revocación** (documentado en `config/tokenDispositivo.js:12-14`).

El token está bien construido —HMAC-SHA256, `timingSafeEqual`, comprobación de vencimiento y de entero (`:66-72`)— pero vive en `localStorage`, legible por JavaScript, y el propio archivo lo advierte. Es decir: **C-1 permite robarlo, y cambiar la contraseña no lo invalida**. El atacante conserva el acceso hasta 7 días.

**Corrección.** Añadir `usuarios.credenciales_desde` (fecha), incluirla en el token y rechazar los emitidos antes; y borrar las filas de `sessions` de ese usuario al cambiar la contraseña. Es la pieza que hoy convierte un incidente recuperable en uno que no se puede cerrar.

---

## M-6 · Se puede desactivar el 2FA solo con la sesión

**Archivo y línea:** `routes/auth.routes.js:522` — `router.put('/2fa', requireAuth, …)`

No pide la contraseña. Quien se haga con una sesión o un token de dispositivo desactiva la verificación en dos pasos y consolida el acceso.

**Corrección.** Exigir la contraseña actual para **desactivarlo** (activarlo puede seguir siendo libre). El proyecto ya tiene el patrón: `verificarPasswordAdmin` en `config/verificaciones.js:39`.

---

## M-7 · `/olvidar-password` sin limitador

**Archivo y línea:** `routes/auth.routes.js:583`

`/solicitar-codigo` sí tiene `limitadorCodigo` (5 cada 15 min, `routes/auth.routes.js:68`) y el razonamiento está escrito en `:61-66`. `/olvidar-password` quedó fuera: solo lo cubre el limitador general de 1000 cada 15 minutos (`app.js:73`).

**Riesgo.** Inundar el buzón de una persona conocida y quemar la cuota SMTP. Dado el historial de SMTP del proyecto (dos caídas documentadas en `CLAUDE.md`), agotar la cuota deja además sin recuperación a todo el mundo.

**Corrección.** Aplicarle `limitadorCodigo`, que ya existe.

---

## M-8 · El bloqueo por intentos permite dejar fuera al administrador

**Archivo y líneas:** `routes/auth.routes.js:224-230`, constantes en `:28-29`

Cinco fallos bloquean la cuenta 15 minutos. La implementación es correcta —el contador se incrementa en la base, no en JavaScript, y el comentario de `:213-222` explica por qué—. Pero el bloqueo es **por cuenta**, así que quien conozca el correo del administrador puede mantenerlo bloqueado indefinidamente con 5 intentos cada 15 minutos. El día de las elecciones eso es un incidente operativo serio.

**Corrección.** Añadir un limitador por IP a `/login` (que hoy no tiene ninguno propio) y no bloquear la cuenta cuando los fallos vienen de una sola IP: bloquear esa IP. Alternativa razonable: no bloquear a `admin`, y en su lugar exigirle 2FA.

---

## M-9 · `/uploads` se sirve a cualquier autenticado

**Archivo y línea:** `app.js:182` — `app.use('/uploads', requireAuth, express.static(...))`

El propio comentario (`app.js:180-181`) reconoce que por ahí salen *"comprobantes de finanzas y otros usos internos"*. Finanzas está restringido a admin y coordinador (`routes/finanzas.routes.js:12`), pero **el archivo subido no**: basta la URL y cualquier sesión.

Mitigante real: el nombre lo genera el servidor con 48 bits de aleatoriedad (`middleware/upload.js:19`), así que no se adivina. El riesgo es la URL filtrada —un reenvío, un historial, una captura—, no la fuerza bruta.

**Corrección.** Servir los comprobantes por una ruta con comprobación de rol, como ya hace `routes/recursos.routes.js:38` con `/:id/descargar`.

---

# BAJO

## B-1 · El enlace de recuperación se construye con la cabecera `Host` del cliente

**Archivo y línea:** `routes/auth.routes.js:611` — `` const baseUrl = `${req.protocol}://${req.get('host')}` ``

**Comprobado en producción, y hoy no es explotable.** Nginx responde `421 Misdirected Request` a un `Host` que no coincide, tanto en 443 como en el `POST` a `/api/auth/olvidar-password`; en el puerto 80 la conexión con `Host` manipulado ni siquiera se completa. La aplicación, en cambio, acepta cualquier `Host` (probado contra `127.0.0.1:3002`: HTTP 200).

Queda como **Bajo por defensa en profundidad**: la protección vive entera en la configuración de Nginx, fuera del repositorio. Un cambio de vhost, un `default_server` nuevo o una migración de servidor lo reabren sin que nada avise, y el resultado sería que la víctima recibe por correo un enlace legítimo con un token válido apuntando a un dominio del atacante.

**Corrección — trivial, y el patrón ya existe en el proyecto.** `config/bajaContacto.js:92` construye su enlace con `process.env.LICENCIA_DOMINIO`. Usar lo mismo aquí. Afecta también a `routes/comunicaciones.routes.js:1092` y `:1099`.

## B-2 · Cookie de sesión sin `sameSite`

**Archivo y líneas:** `app.js:94-98`. Están `httpOnly` y `secure` (verificado en la respuesta real), falta `sameSite`. Los navegadores actuales aplican `Lax` por omisión y hay CSRF por token, así que el riesgo es bajo; declararlo `sameSite: 'lax'` elimina la dependencia del criterio del navegador.

## B-3 · Cinco respuestas devuelven `err.message` al cliente

`routes/backup.routes.js:169` y `:236`, `routes/configuracion.routes.js:529`, `routes/catalogo.routes.js:268`, `routes/territorial.routes.js:377`. Pueden filtrar rutas del sistema de archivos o detalles del motor MySQL. El manejador global (`app.js:231-237`) sí responde genérico, que es lo correcto; estos cinco lo esquivan. Registrar el detalle y devolver un texto fijo.

## B-4 · La subida valida la extensión, no el contenido

**Archivo y línea:** `middleware/upload.js:25`. Se comprueba `path.extname(file.originalname)` contra una lista blanca (`:9-13`). No se miran los bytes de cabecera.

El riesgo está contenido por tres cosas que sí están bien: el nombre lo genera el servidor (`:19`, sin recorrido de rutas), `.svg` **no** está en la lista blanca —es el vector clásico— y Helmet manda `X-Content-Type-Options: nosniff`. Queda como endurecimiento: comprobar los bytes mágicos de las imágenes y los PDF.

## B-5 · Búsqueda en objeto sin comprobar propiedad propia

**Archivo y línea:** `routes/configuracion.routes.js:565` — `AREAS_ELIMINABLES[req.params.area]`. Con `area=constructor` la búsqueda devuelve algo verdadero heredado de `Object.prototype` y el flujo sigue hasta fallar con un `TypeError` (500 en vez de 404). Sin impacto —la ruta exige `admin` y contraseña—, pero `Object.hasOwn(AREAS_ELIMINABLES, req.params.area)` lo cierra en una línea. El mismo patrón está en `routes/contenido.routes.js` y `routes/comunicaciones.routes.js` con las tablas de etiquetas.

## B-6 · `body-parser < 1.20.6`

Único aviso de `npm audit --omit=dev`, severidad baja (denegación de servicio con un `limit` inválido). Se corrige con `npm audit fix`.

---

# Lo que está bien, y conviene no romper

No es cortesía: son decisiones que ya resolvieron riesgos reales y que un refactor podría deshacer sin querer.

**1. SQL parametrizado, sin una excepción.** Revisé las 66 consultas con interpolación. Todas interpolan **identificadores** (nombres de tabla o columna) que salen de listas blancas u operadores ternarios fijos, nunca valores del cliente:

- `routes/configuracion.routes.js:576` — `DELETE FROM ${tabla}` con `tabla` sacada del diccionario `AREAS_ELIMINABLES` (`:542-551`), con 404 si la clave no existe.
- `routes/comunicaciones.routes.js:94` y `routes/contenido.routes.js:103` — ternarios entre dos literales.
- `routes/baja.routes.js:97,110` — literales y un array fijo.

Los `whereSql` de Comunicaciones, Finanzas, Votantes y Votantes-Dashboard acumulan condiciones con `?` y empujan los valores a `params`. **No hay interpolación en `ORDER BY` ni en `LIMIT`**, que es donde los marcadores no llegan y casi siempre aparece el agujero. Tampoco hay concatenación con `+`.

**2. Igualación de tiempos en el login.** `routes/auth.routes.js:26` y `:194`: cuando la cuenta no existe se compara igual contra un hash de descarte, para que "no existe" cueste lo mismo que "contraseña incorrecta". Es una defensa que rara vez se implementa.

**3. Contador de intentos incrementado en la base.** `routes/auth.routes.js:224-230`. El comentario explica que la versión anterior leía-sumaba-escribía y que cinco intentos simultáneos contaban como uno.

**4. Credenciales y tokens.** bcrypt coste 12 (`:26`, `:567`, `:649`); tokens de recuperación de 32 bytes guardados como SHA-256 (`:602-603`); códigos 2FA hasheados con límite de 5 intentos (`:484`); el `usuario_id` del 2FA vive en la sesión y nunca lo manda el navegador, con el motivo escrito en `:422-424`.

**5. Endpoints públicos protegidos.** Los webhooks validan la firma de Twilio (`routes/webhooks.routes.js:26` y `:156`); el actualizador compara el secreto con `crypto.timingSafeEqual` (`routes/actualizador.routes.js:133-140`).

**6. Secretos.** `.env` está en `.gitignore`, no está rastreado, tiene permisos `640` y no aparece en el historial de git. No hay claves incrustadas en `public/`.

**7. Aislamiento entre campañas.** Es **por base de datos, no por columna**: cada campaña es un proceso y una base propios. Las únicas referencias entre bases son cinco, todas de solo lectura contra el catálogo compartido (`territoriosdb.ctc_territorios`, `territoriosdb.ctc_puestos_votacion`). No existe ninguna consulta que pueda cruzar datos entre campañas, porque no hay conexión por la que hacerlo. La superficie real de este modelo no es la consulta: es el `.env` y el usuario de MySQL de cada instancia, y ahí los permisos ya están separados.

**8. Sin CORS abierto.** No se configura CORS en ningún punto: solo mismo origen.

---

# Corrección a la documentación del proyecto

`CLAUDE.md`, sección 5, afirma:

> «`xlsx` sigue con vulnerabilidad alta y **sin arreglo disponible**. Es la única que queda en `npm audit`.»

**Las dos frases son incorrectas hoy.** Medido:

```
package.json  →  "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
instalado     →  0.20.3
```

- CVE-2023-30533 (contaminación de prototipo) — corregido en 0.19.3
- CVE-2024-22363 (ReDoS) — corregido en 0.20.2

La instalación está por encima de ambos. El paquete del **registro npm** sigue abandonado en 0.18.5 y es el que arrastra los avisos; instalarlo desde el CDN de SheetJS es la vía oficial de arreglo y alguien ya la aplicó.

Y el único aviso que hoy da `npm audit --omit=dev` es `body-parser` (bajo), no `xlsx`.

**Lo que importa para el futuro: `npm audit` no ve este paquete.** No porque esté limpio, sino porque no viene del registro. Hoy eso oculta una buena noticia; el día que aparezca un CVE de SheetJS **va a ocultar la mala con el mismo silencio**. Conviene anotar en `CLAUDE.md` que `xlsx` se vigila a mano en el aviso de seguridad de SheetJS, y actualizar el párrafo: la restricción de rol sobre `/importar-excel` se justificó con una vulnerabilidad que ya no está.

---

# Orden sugerido

| # | Acción | Cierra | Esfuerzo |
|---|---|---|---|
| 1 | Escapar `v.nombre` y los 4 campos vecinos en `votantes.html:988-996` | **C-1** | minutos |
| 2 | Escapar las 6 celdas de `organigrama.html:557-564` | **A-1** | minutos |
| 3 | `requireRole` en `POST /api/votantes` | **A-2** | minutos |
| 4 | `limitadorCodigo` en `/olvidar-password`; contraseña para desactivar 2FA | M-6, M-7 | minutos |
| 5 | `LICENCIA_DOMINIO` en los 3 enlaces construidos con `Host` | B-1 | minutos |
| 6 | `npm audit fix`; `sameSite: 'lax'`; los 5 `err.message` | B-2, B-3, B-6 | una hora |
| 7 | Rol en asistentes, territorial y `/uploads` | M-2, M-3, M-9 | media jornada |
| 8 | Invalidar sesiones y tokens al cambiar contraseña | **M-5** | una jornada |
| 9 | Barrido de las 87 interpolaciones sin escapar | C-1, A-1 de raíz | una jornada |
| 10 | CSP con `nonce`, empezando en `Report-Only` | **A-3** | varias jornadas |

Los tres primeros son ediciones de una línea cada una y cierran el camino que va del rol más bajo a la cuenta del administrador. El resto puede ir por parches sucesivos.

---

## Cómo se verificó

- **Estático:** extracción de las 200 rutas con sus middlewares; recorrido de los 66 literales SQL con interpolación, resolviendo el origen de cada variable; detección de sumideros HTML (`innerHTML`, `insertAdjacentHTML`) descartando lo ya escapado.
- **En vivo, sin efectos:** `GET /login.html` con `Host` manipulado en 443 y 80 (`421` y conexión rechazada); `POST /api/auth/olvidar-password` con `Host` manipulado y **una cuenta inexistente**, para no generar correo (`421`); lectura de la cabecera `Set-Cookie` de un `POST /api/auth/login` vacío.
- **Dependencias:** `npm audit --omit=dev` y comprobación de la versión instalada de `xlsx` frente a los CVE conocidos.
- **No se modificó código, ni se ejecutó ninguna de las pruebas de concepto.** Las de C-1, A-1 y A-2 están descritas en términos conceptuales, sin payload funcional.

**Límite declarado:** no pude leer la configuración de Nginx (sin permiso de lectura desde esta cuenta), así que B-1 se evaluó por comportamiento observado desde fuera, no por el archivo de configuración. Tampoco pude consultar las bases de las campañas desde esta cuenta —`electoraluser` solo alcanza `electoraldb` y `territoriosdb`—, de modo que las afirmaciones sobre datos se limitan a lo que el código determina.
