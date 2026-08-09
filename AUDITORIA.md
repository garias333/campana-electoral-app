# Auditoría de campana-app — informe priorizado

**Fecha:** 9 de agosto de 2026
**Alcance:** todo el repositorio, sin modificar código. Revisado a fondo:
esquema (`db/schema.sql` + `db/init-db.js`), los 24 routers, los ~20 módulos
de `config/`, middlewares, licencias y actualizador, `lib/validarCedula.js`,
dependencias y archivos huérfanos.
**Método:** lectura directa del código y del esquema; verificación de patrones
(interpolación SQL, transacciones, guards de rol, paginación, alcance) con
búsquedas dirigidas. No se ejecutó nada contra la base.

> **La ventana sin datos reales es real y cambia la prioridad.** Los hallazgos
> marcados con **🪟 VENTANA** son mucho más baratos de arreglar ahora —permiten
> cambios destructivos de esquema y rehacer la plantilla— y mucho más caros o
> imposibles una vez entre el primer cliente. Empezar por ellos.

---

## Estado de ejecución (9 de agosto de 2026)

| Hallazgo | Estado | Commits |
|---|---|---|
| **A1** — `usuarios.nombre_usuario` | ✅ **RESUELTO** | `4bedbf9`, `9bdee53` |
| **A7bis** — índices de filtro/join | 🟨 **PARCIAL** | `4bedbf9` (índice de `nombre_usuario`), `3d8bf21` (login sin `LOWER()`). Pendientes: `*.puesto_id` |
| **A3** — esquema fuera de git | ✅ **RESUELTO** (antes de esta sesión) | `db/schema.sql` ya versionado |
| Resto | Sin empezar | — |

**Desplegado en `electoral.appestrategia.net`** (9 de agosto de 2026, 20:25):
`pm2 restart campana-app`, proceso 2424130 → 2433586, `unstable_restarts: 0`.
Verificado en caliente, contra la instalación real:

- `POST /api/auth/login` con un usuario inexistente responde **401
  «Credenciales inválidas»** — no 500. Es la prueba de que la consulta con
  `u.nombre_usuario = ?` corre bien; si la columna o la consulta estuvieran
  rotas, sería error de servidor. Probado también con mayúsculas mezcladas:
  mismo resultado, que es lo que confirma que quitar el `LOWER()` no cambió
  el comportamiento.
- Colación medida en las tres bases: `utf8mb4_0900_ai_ci` en `nombre_usuario`
  y `email`, y la comparación ignora mayúsculas **y** tildes. El `LOWER()` no
  aportaba nada que la colación no hiciera ya.

**Parche #18 generado y listo para subir** (`parches/campana-parche18.zip`,
37,3 KB) con los 5 archivos de A1/A7bis: `db/schema.sql`, `db/init-db.js`,
`config/verificarEsquema.js`, `app.js`, `routes/auth.routes.js`. Verificado:
sin entradas `../` ni absolutas, sin `.env` ni credenciales, y el contenido
extraído pasa `node --check`. **Toca base de datos** → hay que marcar esa
casilla al subirlo. Ambas campañas van en el parche 17, así que el 18 es el
siguiente sin reutilizar número.

Aplicarlo es de bajo riesgo en las dos campañas: **sus bases ya tienen la
columna**, así que la verificación de arranque pasa incluso si se olvidara
marcar la casilla de base de datos. Efecto colateral deseable: como el parche
lleva `routes/auth.routes.js` completo, la campaña **municipal** recibe además
el arreglo `401`→`400` de cambiar-contraseña que le faltaba (ver A25).

### A25 — Las tres instancias han derivado en silencio, y dos van atrasadas en arreglos reales 🟠 Alta (hallazgo nuevo, al ejecutar A1)

Medido archivo por archivo (61 `.js` de `app.js`, `routes/`, `config/`, `db/`,
`lib/`, `middleware/`, `public/js/`) entre `electoral` y cada campaña. Las dos
campañas difieren **exactamente en los mismos 5 archivos** + 1 que les falta —
o sea que no son cambios propios de cada campaña, son **copias viejas**
(municipal es del 30 de julio; departamental, del 2 de agosto):

| Archivo | Qué les falta |
|---|---|
| `app.js`, `db/init-db.js`, `db/schema.sql`, `config/verificarEsquema.js` | El arreglo A1 de hoy (esperado) |
| `routes/auth.routes.js` | A1/A7bis + (**solo municipal**) el cambio de `401`→`400` en cambiar-contraseña, sin el cual el frontend interpreta «sesión vencida», redirige a login y **se traga el mensaje de error** |
| `routes/comunicaciones.routes.js` | 12 líneas del arreglo de Push: sin traer `usuario_id` aparte del id de estructura, un aviso por selección manual **no encuentra el dispositivo de nadie y la campaña entera sale como «sin contacto», sin un solo error** |
| `public/js/common.js` | La entrada de menú «Aviso en la app» (push) |

**Por qué importa más que la suma de sus partes:** los dos arreglos que les
faltan fallan **en silencio** —un mensaje de error que desaparece, una campaña
de avisos que no llega a nadie—, que es justo la clase de fallo que nadie
reporta. Y nada en el sistema avisa de la deriva: hay que ir a compararla a
mano, como se hizo aquí.

**Recomendación:** una comprobación de deriva (un `diff` de los archivos
versionados entre instancias) antes de dar por buena cualquier jornada de
parches. Es barato y convierte un fallo silencioso en una lista.

**No se corrigió:** esas copias no están bajo git, los archivos pertenecen a
otro usuario del sistema, y la vía sancionada para llevarles código es el
sistema de parches. Reemplazarlos a mano cambiaría el dueño de los archivos
—el proyecto ya tuvo un 502 por eso— y dejaría el cambio sin forma de
revertir.

**Hallazgo empírico al aplicar A1, que conviene registrar:** se midieron las
**tres** bases (`electoraldb`, `campanadepruebamunicipal`,
`campanadepruebadepartamental`) y las tres ya tienen la columna **idéntica**:
`varchar(60) NULL`, índice UNIQUE llamado `nombre_usuario`, sin duplicados ni
cadenas vacías. Dos consecuencias:

1. **La migración es no-op en todas las instancias existentes** → aplicarla es
   de riesgo cero; no hay ningún dato que reparar antes.
2. **El arreglo es preventivo, no correctivo.** Ninguna campaña actual tiene el
   login roto: las tres nacieron clonando la base plantilla, que llevaba la
   columna agregada a mano. El fallo aparecía solo por el camino
   `npm run init-db` sobre una base vacía — que es justamente **el camino que
   usa el actualizador automático** cuando un parche "toca base de datos", y el
   que usaría una campaña nueva creada desde el repositorio.

La definición se ajustó a `VARCHAR(60)` (no los 50 propuestos inicialmente)
**porque así está en las bases reales**; con 50, una instalación nueva habría
rechazado nombres de usuario que las campañas actuales aceptan.

---

## Resumen ejecutivo

**La buena noticia primero, porque cambia cómo leer todo lo demás:** el
aislamiento entre inquilinos y la autorización están **bien resueltos**, pero
no como parece pedir el encargo. No hay ninguna columna `campana_id` en el
esquema, y **no debería haberla**: cada campaña es una base de datos y un
proceso PM2 separados, con su propio `.env`, su propio `SESSION_SECRET` y su
propio usuario de MySQL. El aislamiento es **físico**, no lógico. Esto es más
fuerte que filtrar por `campana_id` en cada consulta: no hay ninguna consulta
que filtrar porque el *pool* apunta a una sola base. Se verificó que **ninguna
ruta acepta del request el nombre de la base ni un identificador de campaña**,
que el único acceso entre bases (`territoriosdb`, el catálogo) es **de solo
lectura, parametrizado y con el nombre de la base tomado del entorno**, y que
no hay inyección SQL (todo va parametrizado; las pocas interpolaciones son de
valores de lista blanca). Ver [§1](#1-aislamiento-entre-inquilinos).

**La mala noticia, y es donde vive el riesgo real:** el aislamiento depende
por completo de la infraestructura (los `GRANT` de MySQL y la separación de
`.env`), y **la plantilla de la que se clonan las campañas no es reproducible
desde el repositorio**. `db/schema.sql` está desincronizado de la base que de
verdad corre: le falta al menos una columna de la que depende el **login**
(`nombre_usuario`), define `territorios` como tabla cuando en producción es una
vista, y conserva llaves foráneas que la migración al catálogo eliminó. Además,
`db/schema.sql` **ni siquiera está en git** (lo excluye `*.sql` en
`.gitignore`). El resultado: una campaña nueva levantada desde el repositorio
—en vez de clonando una base opaca— arranca rota, y nadie tiene una definición
versionada de cómo debería ser. Ese es el hallazgo crítico
([§2](#2-la-campaña-plantilla-y-el-aprovisionamiento)).

El resto son mejoras concretas y acotadas: un par de índices, paginar un
listado que crecerá, una escritura que debería ser atómica, y limpieza de
consistencia. La corrección general del código es **alta**: transacciones donde
importan, conexiones liberadas en `finally`, CSRF + Helmet + rate-limit,
`bcrypt(12)`, 2FA y tokens de recuperación con hash/expiración/un-solo-uso,
webhooks con validación de firma, y alcance por líder aplicado en lectura y
escritura de votantes.

### Conteo por severidad

| Severidad | Cantidad | IDs | Abiertos |
|---|---|---|---|
| 🔴 Crítica | 1 | A1 | — (resuelto) |
| 🟠 Alta | 6 | A2, A3, A4, A5, **A25**, **A26** | A2, A4, A5, A25, A26 |
| 🟡 Media | 10 | A6–A15 | A6–A15 (A7bis parcial) |
| ⚪ Baja | 9 | A16–A24 | A16–A24 |

---

## 1. Aislamiento entre inquilinos

**Conclusión: no se encontró ninguna vía por la que un usuario de una campaña
pueda leer o escribir datos de otra.** El modelo es de separación física y se
sostiene. Lo que sigue son las verificaciones hechas y los dos puntos que sí
conviene endurecer (que en realidad son de infraestructura y de la cadena de
actualización, no de una consulta suelta).

### Lo que se verificó y está bien

- **No hay `campana_id` en ningún lado** (confirmado por búsqueda en todo
  `routes/`, `config/`, `db/`). El *pool* (`config/db.js`) se construye con
  `DB_NAME` del `.env` y todas las consultas van a esa única base.
- **La sesión vive en la propia base de la campaña.** `app.js:79` crea el
  *store* con `new MySQLStore({}, pool)` → tabla `sessions` en la base de esta
  campaña. Una cookie `campana_sid` de la campaña A presentada a la app de la
  campaña B no resuelve (ni está en su tabla de sesiones, ni valida contra su
  `SESSION_SECRET`).
- **El token de dispositivo se firma con `SESSION_SECRET`**
  (`config/tokenDispositivo.js:42`), que según la documentación se **genera por
  campaña y nunca se copia**. Un token de una campaña no vale en otra.
  Comparación en tiempo constante (`crypto.timingSafeEqual`), expiración de 7
  días.
- **El único acceso entre bases es de solo lectura y seguro.**
  `routes/catalogo.routes.js` y `routes/diaD.routes.js` consultan
  `territoriosdb` con `JOIN`, pero el nombre de la base sale de
  `process.env.CATALOGO_DB` (`catalogo.routes.js:43`), **nunca del request**, y
  todas las consultas son `SELECT` parametrizadas.
- **No hay inyección SQL.** Se auditaron las 12 interpolaciones `${…}` dentro
  de literales SQL: todas insertan nombres de columna/tabla de **lista blanca**
  (`foto_url`/`video_url` acotado por la ruta `:tipo(foto|video)`,
  `email`/`telefono` según el canal, placeholders `?,?,?`) o literales del
  servidor. Los valores de usuario siempre van como parámetros.
- **Alcance intra-campaña aplicado.** `votantes` recorta por líder en lectura
  y escritura: `GET /` (`votantes.routes.js:201`), `PUT/:id` verifica propiedad
  (`:1042-1044`), `DELETE/:id` (`:1210`), y `POST /` **ignora** el `lider_id`
  del cliente y fuerza el de la sesión (`:929`). `GET /estructura` recorta por
  `supervisor_id`/`usuario_id` para roles no admin (`territorial.routes.js:715`).

### A4 — El secreto del actualizador es una sola llave compartida (y probablemente igual en toda la flota) 🟠 Alta

- **Archivos:** `routes/actualizador.routes.js:143-153`,
  `config/licencia.js:15`, `scripts/actualizar-automatico.js:24`.
- **Qué se rompe:** `LICENCIA_API_SECRET` es lo único que protege
  `POST /actualizador/ejecutar`, que **corre comandos en el servidor**. La
  comparación es en tiempo constante (bien), pero si ese secreto es el **mismo
  en las tres instancias** (la documentación muestra configuración copiada
  entre instancias, y el actualizador usa un único secreto), entonces el
  operador de cualquier campaña que lea su propio `.env` conoce el secreto de
  todas, y puede disparar la actualización remota de otra instancia. No es fuga
  de *datos* entre campañas, pero sí **movimiento lateral** en la cadena de
  despliegue.
- **Esfuerzo:** bajo (generar un secreto por campaña; ya se hace con
  `SESSION_SECRET`). Verificar primero si de hecho está compartido.
- **Ventana:** neutra (hacerlo ahora es más fácil porque no hay que coordinar
  con clientes en vivo).

### A5 — El actualizador aplica parches sin verificar su origen ni su contenido 🟠 Alta

- **Archivos:** `scripts/actualizar-automatico.js:96-114` (descarga y
  `unzip -o … -d .`).
- **Qué se rompe:** el parche es un `.zip` que se descomprime **sobre el árbol
  del proyecto** y luego se ejecuta (`npm install`, `npm run init-db`,
  `pm2 restart`). No hay firma criptográfica del parche ni validación de las
  rutas del zip. Dos consecuencias:
  1. **Confianza total en el Servidor de Licencias + el secreto.** Quien
     controle ese servidor (o el secreto de A4) tiene **ejecución de código**
     en todas las campañas. Es la superficie más delicada de todo el sistema.
  2. **Zip-slip:** una entrada con `../` escaparía del directorio del proyecto
     al descomprimir (`unzip -o` respeta rutas relativas hacia arriba). Un
     parche malicioso o corrupto podría escribir fuera de `htdocs`.
- **Qué mitigaría:** firmar el `.zip` (HMAC/asimétrica) y verificarlo antes de
  descomprimir; rechazar entradas con `..`/absolutas; validar el destino de
  cada archivo.
- **Esfuerzo:** medio.
- **Ventana:** neutra.

> **Verificar en infraestructura (fuera del repo):** que cada usuario de MySQL
> de cada campaña tenga `GRANT` **solo** sobre su propia base + `SELECT` sobre
> las tablas `ctc_*` de `territoriosdb`, y sobre ninguna otra base de campaña.
> El aislamiento del §1 se apoya en eso. El código no puede garantizarlo.

---

## 2. La campaña plantilla y el aprovisionamiento

Aquí está el riesgo estructural. Cualquier defecto de la plantilla se replica
en cada campaña real futura, y hoy la plantilla no es reproducible desde el
repositorio.

### A1 — `usuarios.nombre_usuario`: el login depende de una columna que el esquema no crea 🔴 CRÍTICA 🪟 VENTANA — ✅ RESUELTO (`4bedbf9`, `9bdee53`)

- **Archivos:** se **usa** en `routes/auth.routes.js:125` (login),
  `routes/usuarios.routes.js:88,145,186,194,266`,
  `routes/territorial.routes.js:929,1063,1739,2159`,
  `config/testigoElectoral.js:235`, `routes/votantes.routes.js:824`,
  `config/erroresUsuarios.js:34`. Se **crea** en: **ningún lado** —
  no está en `db/schema.sql` ni en las ~60 migraciones de `db/init-db.js`
  (verificado con búsqueda exhaustiva).
- **Qué se rompe:** una campaña aprovisionada con `npm run init-db` (el método
  documentado, y **lo que corre el actualizador automático** cuando un parche
  "toca base de datos") **no tiene la columna**. La consulta de login
  `… OR LOWER(u.nombre_usuario) = ?` falla con `ER_BAD_FIELD_ERROR` → **el 100%
  de los inicios de sesión responde 500**. También rompe la creación de
  usuarios, testigos y la creación de votante-como-usuario. Hoy funciona sólo
  porque la columna se agregó **a mano** a la base de la plantilla y los clones
  la arrastran — exactamente el patrón que `init-db.js` documenta haber
  corregido para otras tres columnas (`ctc_puesto_id`, etc., líneas 879-916) y
  que aquí quedó sin corregir.
- **Esfuerzo:** trivial. Agregar la columna a `schema.sql` y una migración
  `agregarColumnaSiFalta` en `init-db.js` (con su índice, ver A7bis). Añadir
  una verificación de arranque que falle ruidosamente si falta una columna
  crítica evitaría que vuelva a pasar en silencio.
- **Ventana:** **sí, urgentísimo.** Debe quedar antes de clonar cualquier
  campaña real desde una base posiblemente incompleta.

### A2 — `db/schema.sql` está desincronizado de la base que de verdad corre 🟠 Alta 🪟 VENTANA

- **Archivos:** `db/schema.sql` (todo), contrastado con lo que documentan
  `CLAUDE.md`/`LEAMELECTORAL.md` y el código.
- **Qué se rompe:** no se puede reconstruir una campaña funcional desde el
  repositorio. Divergencias concretas:
  1. **`territorios`** se declara como tabla (`schema.sql:33-42`) pero en las
     campañas integradas al catálogo es una **vista** de solo lectura sobre
     `territoriosdb`. Una instalación desde `schema.sql` la crea como tabla
     local vacía (sin catálogo).
  2. **Llaves foráneas a `territorios`** (`votantes.territorio_id`,
     `estructura.territorio_id`, `eventos.territorio_id`,
     `finanzas_movimientos.territorio_id`, `usuarios.territorio_id`) existen en
     `schema.sql` pero la migración al catálogo **las eliminó** (MySQL no
     admite FK contra una vista ni entre bases). El esquema del repo describe
     una integridad referencial que la base real ya no tiene.
  3. **Columnas manuales** (`nombre_usuario`, ver A1) que sólo viven en la base
     real.

#### Medición del 9 de agosto de 2026 (esta sección era inferencia; ahora son cifras)

| Aspecto | `db/schema.sql` dice | Plantilla `electoraldb` | Campañas reales |
|---|---|---|---|
| `territorios` | TABLE con auto-FK | **TABLE, 0 filas** | **VIEW** (197 y 245 filas) |
| FK a `territorios` desde las otras 5 tablas | **5 declaradas** | **0** | **0** |
| auto-FK `territorios.padre_id` | sí | **sí, todavía presente** | n/a (es vista) |
| `campana_ambito` | **no existe en el repo** | existe, 0 filas | existe, 1 fila |

**Dos correcciones a lo que decía la versión anterior de este informe:**

1. En `electoraldb` —**la plantilla**— `territorios` **no** es una vista: es
   una tabla vacía con su auto-FK `padre_id` todavía puesta. La vista solo
   existe en las dos campañas. La plantilla está en un **estado híbrido**: ya
   tiene `campana_ambito` (artefacto de la era del catálogo) pero conserva
   `territorios` como tabla local (estado pre-catálogo).
2. Por eso el problema de aprovisionamiento es **peor** de lo descrito: una
   campaña clonada de la plantilla **no nace conectada al catálogo**. Nace con
   una tabla `territorios` vacía, y alguien tiene que acordarse de convertirla
   en vista a mano, con un script que vive **en el otro proyecto**
   (`vista_territorios_catalogo.sql`). Nada en este repositorio lo hace ni lo
   menciona.

**Y `schema.sql` no solo desinforma: estorba.** Las 5 FK que declara hacia
`territorios` no existen en ninguna base real y **no pueden existir**. Si
alguien instalara desde `schema.sql` tal cual, se crearían — y después la
conversión a vista fallaría, porque MySQL no deja reemplazar por una vista una
tabla con referencias vivas.

### A26 — `campana_ambito` no la crea nada en el repositorio 🟠 Alta (hallazgo nuevo, al medir A2)

- **Evidencia:** existe en las tres bases; `grep -rn campana_ambito` sobre
  `db/`, `routes/`, `config/`, `middleware/` y `app.js` no devuelve **nada**.
- **Qué se rompe:** acota el ámbito de la campaña, y de ella depende la vista
  `territorios` que reemplaza a la tabla local. Sin ella la integración con el
  catálogo no se puede levantar desde este repositorio.
- **Matiz que la distingue de A1:** el código de la aplicación **nunca la
  consulta** — quien la usa es la definición de la vista, que vive en el
  proyecto territorios. No rompe el arranque como `nombre_usuario`; rompe la
  **reproducibilidad del aprovisionamiento**.
- **Decisión pendiente:** si su definición debe vivir aquí (con el esquema de
  campaña) o allá (con la integración del catálogo). Lo que no puede seguir es
  que no viva en **ninguna** parte versionada.
- **Consecuencia:** la plantilla real es una **base opaca** que se clona; el
  repositorio no es su fuente de verdad. Todo defecto o dato residual de esa
  base se propaga sin que nadie lo vea en el código.
- **Esfuerzo:** medio. Decidir si el arranque desde `schema.sql` es un camino
  soportado; si sí, reconciliarlo con la realidad (vista/FK/columnas). Ver A9.
- **Ventana:** **sí.** Es el momento de definir la plantilla como artefacto
  reproducible.

### A3 — `.gitignore` excluye `db/schema.sql` (el esquema no está versionado) 🟠 Alta — ✅ RESUELTO

- **Archivo:** `.gitignore:12` (`*.sql`). Confirmado con
  `git check-ignore -v db/schema.sql`.
- **Qué se rompe:** el esquema canónico, `03_declarado.sql` y todas las
  migraciones SQL están **fuera de git**. Combinado con A2, la definición de la
  base vive únicamente en los servidores. Un `git clone` para levantar una
  instalación no traería el esquema, y `init-db.js` (que hace
  `readFileSync('db/schema.sql')`) fallaría. También impide revisar cambios de
  esquema en los *diffs*.
- **Esfuerzo:** trivial. Negar la exclusión para el esquema
  (`!db/schema.sql`) o sacar los archivos de esquema del patrón `*.sql`.
- **Ventana:** neutra.
- **Estado:** resuelto antes de esta sesión — `db/schema.sql` ya está
  versionado (`!db/schema.sql` en `.gitignore`). Queda un detalle cosmético:
  esa línea está **repetida tres veces** (`.gitignore:31-33`); es inofensivo.
  Los demás `.sql` del proyecto (`03_declarado.sql` y las migraciones) siguen
  fuera de git.

### A9 — `init-db.js` es el esquema de facto; `schema.sql` engaña 🟡 Media 🪟 VENTANA

- **Archivo:** `db/init-db.js` (1157 líneas; ~60 `ALTER`/`agregarColumnaSiFalta`
  aplicados en orden tras cargar `schema.sql`).
- **Qué se rompe (mantenibilidad):** el esquema real es "`schema.sql` + 60
  migraciones defensivas". Es repetible y robusto, pero `schema.sql` ya no
  describe la base, así que como documentación es engañoso y como punto de
  partida está incompleto (A1). Cada columna nueva vive en dos sitios o en
  ninguno.
- **Recomendación:** con la ventana abierta, **aplanar**: regenerar
  `schema.sql` desde un `SHOW CREATE TABLE` de una base real correcta (con
  vista/FK reales), y dejar `init-db.js` sólo para el sembrado (roles,
  categorías, permisos por defecto, política de privacidad, admin inicial) y
  para migraciones futuras. Una base nueva se crea de un solo `schema.sql`.
- **Esfuerzo:** medio.
- **Ventana:** **sí**, ideal ahora.

### A10 — La plantilla puede arrastrar datos residuales y una contraseña de admin compartida 🟡 Media 🪟 VENTANA

- **Archivos:** `db/init-db.js:603-624` (admin inicial).
- **Qué se rompe:**
  1. **Datos residuales:** si la base plantilla acumula datos de prueba
     (votantes, usuarios más allá del admin sembrado), cada clon los hereda. La
     plantilla debería contener **solo** filas de sembrado.
  2. **Contraseña de admin compartida:** el admin inicial se crea con
     `ADMIN_PASSWORD` o el valor por defecto `CambiarInmediatamente123!`. Un
     **clon de la base** hereda el *hash* del admin de la plantilla → todas las
     campañas clonadas comparten la misma contraseña de admin hasta que alguien
     la cambie (mitigado por `debe_cambiar_password=1`, pero el hash viaja).
- **Recomendación:** un script/afirmación de "plantilla limpia" que verifique
  cero datos operativos antes de clonar, y forzar `ADMIN_PASSWORD` por campaña
  (o regenerarla en el aprovisionamiento).
- **Esfuerzo:** bajo-medio.
- **Ventana:** **sí.**

---

## 3. Esquema de base de datos

### A7 — `comunicaciones_envios.twilio_sid` sin índice (escaneo completo por cada callback de Twilio) 🟡 Media

- **Archivos:** `db/schema.sql:450-464` (define índices en `campana_id` y
  `estado`, **no** en `twilio_sid`); lo consulta
  `routes/webhooks.routes.js:42` (`WHERE twilio_sid = ?`) en **cada** aviso de
  estado de Twilio, y `routes/comunicaciones.routes.js`.
- **Qué se rompe:** en una campaña de SMS grande, `comunicaciones_envios` tiene
  una fila por destinatario (decenas de miles). Cada callback de Twilio
  (uno por mensaje, más los reintentos) hace un *full scan*. Se degrada justo
  cuando más tráfico de callbacks hay.
- **Esfuerzo:** trivial (`ADD INDEX idx_envios_twilio_sid (twilio_sid)`).
- **Ventana:** neutra.

### A7bis — Columnas de filtro/join sin índice 🟡 Media — 🟨 PARCIAL (`4bedbf9`, `3d8bf21`)

- **Archivos:** `db/schema.sql` / `db/init-db.js`.
- **Detalle:**
  - ~~`usuarios.nombre_usuario`~~ ✅ **hecho**: índice UNIQUE creado con A1, y
    se quitó el `LOWER()` del login (`auth.routes.js:129`) porque una función
    sobre la columna la vuelve no indexable. La colación `ai_ci` ya compara sin
    distinguir mayúsculas ni tildes, así que no cambia qué cuentas cruzan.
    Comprobado con `EXPLAIN`: antes `possible_keys: email`; ahora
    `possible_keys: email,nombre_usuario`.
  - `usuarios.puesto_id`, `estructura.puesto_id`, `votantes.puesto_id`: los
    cruces del Día D se hacen por estas columnas y no tienen índice. Importan a
    medida que crezcan los reportes.
  - (Ya indexados y correctos: los FK `lider_id`, `sublider_id`,
    `supervisor_id`, `territorio_id`, `created_by`, y las UNIQUE de `cedula`,
    `email`, `numero_identificacion`, `cliente_uuid` — no hace falta tocarlos.)
- **Esfuerzo:** trivial.
- **Ventana:** neutra (más barato ahora que las tablas están vacías: crear el
  índice es instantáneo).

### A13 — `mesa_votacion` tiene tipos distintos para el mismo concepto 🟡 Media 🪟 VENTANA

- **Archivos:** `usuarios.mesa_votacion VARCHAR(20)` (`schema.sql:55`),
  `votantes.mesa_votacion VARCHAR(20)` (`:170`),
  `estructura.mesa_votacion INT` (agregada en `init-db.js:1142`),
  `dia_d_reportes.mesa_votacion VARCHAR(20)` (`:499`).
- **Qué se rompe:** el mismo dato (número de mesa) es `VARCHAR` en tres tablas
  e `INT` en otra. Cualquier comparación/cruce entre ellas mezcla texto y
  número (conversión implícita, comparaciones sorpresa como `'03' = 3`).
- **Esfuerzo:** bajo (unificar a un solo tipo). Destructivo → **ventana**.
- **Ventana:** **sí.**

### A15 — La colación no se fija explícitamente 🟡 Media 🪟 VENTANA

- **Archivos:** todas las tablas usan `DEFAULT CHARSET=utf8mb4` sin
  `COLLATE` explícito (`db/schema.sql`).
- **Qué se rompe:** el código depende de `utf8mb4_0900_ai_ci` (insensible a
  mayúsculas y tildes) para cruces por nombre —lo dice el propio
  `catalogo.routes.js:151-154` y el CRM—. Si una base de campaña se crea con
  otra colación por defecto del servidor, esos cruces cambian de comportamiento
  **en silencio**. Conviene pinchar la colación en el esquema en vez de
  heredarla del servidor.
- **Esfuerzo:** bajo.
- **Ventana:** **sí** (recrear tablas es gratis ahora).

### Notas de esquema sin acción urgente

- **Denormalización deliberada** (ver A11): datos personales duplicados entre
  `usuarios`/`votantes`/`estructura` y el lugar de votación repetido en cuatro
  tablas. Es por diseño (sincronización), con costos de consistencia conocidos.
- **`comunicaciones_envios.destinatario_id` es polimórfico** (apunta a
  `votantes` o `estructura` según `destinatario_tipo`): no admite FK; riesgo de
  referencias huérfanas en el historial al borrar. Aceptable, documentado.
- **`permisos_rol.rol`** es `VARCHAR` en vez de FK a `roles(nombre)`. Menor.

---

## 4. Corrección

### A8 — El reporte del Día D y sus votos no se guardan de forma atómica 🟡 Media

- **Archivos:** `routes/diaD.routes.js:388-405`. Inserta en `dia_d_reportes` y
  luego, en un **bucle**, inserta cada fila de `dia_d_reporte_votos` — todo con
  `pool` (sin transacción).
- **Qué se rompe:** si el proceso muere entre la inserción del reporte y el
  final del bucle, queda un reporte con **votos parciales** (faltan candidatos).
  En el conteo del Día D eso es un resultado equivocado que parece completo.
- **Esfuerzo:** bajo (envolver reporte + votos en una transacción, como ya se
  hace en `territorial.routes.js`).
- **Ventana:** neutra.

### A11 — La sincronización votante↔estructura no es transaccional 🟡 Media

- **Archivos:** `config/sincronizacionVotantesEstructura.js` (usa `pool`; se
  llama **después** del `commit` en `territorial.routes.js:997`).
- **Qué se rompe:** la copia denormalizada de una persona entre `votantes` y
  `usuarios`/`estructura` se hace best-effort y no atómica. Si falla, las dos
  vistas de la misma persona quedan divergentes hasta la próxima edición
  (documentado y no-fatal a propósito). Además hace un `UPDATE cedula` + `INSERT
  ON DUPLICATE` en dos sentencias sueltas: dos sincronizaciones concurrentes
  podrían competir.
- **Esfuerzo:** medio (o aceptarlo formalmente y documentar el modo de
  reparación).
- **Ventana:** neutra.

### Lo que se verificó y está bien (correctness)

- **Transacciones** donde importa: creación/edición de estructura, permisos y
  borrados masivos usan `getConnection`/`beginTransaction`/`commit`/`rollback`
  con `release()` en `finally`. Se contaron 11 `getConnection` y 11 `release`
  en `territorial.routes.js` — **sin fugas de conexión**.
- **`unhandledRejection`/`uncaughtException`** con red de seguridad en
  `app.js:224-229`; los envíos de fondo tienen `try/catch` y `.catch()`.
- **Idempotencia offline** por `cliente_uuid` con índice UNIQUE en estructura,
  votantes y reportes (maneja el reintento del móvil sin duplicar).

---

## 5. Rendimiento

### A6 — `GET /estructura` sin paginación y con subconsultas correlacionadas por fila 🟡 Media (crece con los datos)

- **Archivos:** `routes/territorial.routes.js:659-720`. La consulta calcula,
  **por cada fila** de estructura, `meta_votos_equipo` y `registros` con
  subconsultas `COUNT` anidadas (líderes → sublíderes → votantes), y **no tiene
  `LIMIT`** (termina en `ORDER BY e.cargo, u.nombre` y devuelve todo).
- **Qué se rompe:** en una campaña departamental la estructura puede tener
  cientos o miles de personas. El costo es O(filas × subconsultas anidadas), sin
  tope, y se manda entero al navegador en cada carga de la pantalla.
- **Esfuerzo:** medio (paginar + precalcular los conteos con agregaciones/`JOIN`
  en vez de subconsultas por fila).
- **Ventana:** neutra, pero conviene antes de la primera campaña grande.

### Lo que se verificó y está bien (rendimiento)

- **`GET /votantes` sí pagina** (`page`/`limit`/`offset`, responde
  `{data,total,page,limit}`) — `votantes.routes.js:182-244`.
- **`lugarDeVotacionDe`** por destinatario en el envío del CRM sólo se consulta
  si el mensaje usa marcadores de lugar (optimización documentada).
- Los "top-N" de dashboards usan `LIMIT` fijo (posiciones, territorios).

---

## 6. Consistencia

Cuántas formas distintas hay hoy, y la propuesta de una sola:

- **Validación de entrada:** al menos tres estilos. `validarTelefono10Digitos`
  está **copiado en 5 archivos** (`configuracion`, `usuarios`, `organigrama`,
  `territorial`, `votantes`); el regex de email vive sólo en `configuracion`;
  la cédula en `lib/validarCedula.js`; muchas rutas no validan y confían en las
  restricciones de la base. **Propuesta:** un módulo `config/validadores.js`
  único (teléfono, email, cédula, enums) reutilizado por todas las rutas.
- **Confirmación por contraseña de admin:** `verificarPasswordAdmin` está
  **copiada casi idéntica en 6 archivos** (`backup`, `configuracion`,
  `usuarios`, `comunicaciones`, `votantes`, `territorial`). **Propuesta:**
  moverla a `config/` y reusarla.
- **Respuestas de error:** mayormente `res.status(n).json({ error })` en
  español (consistente en forma), pero conviven `res.send('texto')` (webhooks,
  adjunto), `503` para problemas de GRANT (catálogo) y códigos elegidos a
  propósito (`400` en cambio de contraseña para no disparar el redirect del
  front). **Propuesta:** un helper `responderError(res, codigo, mensaje)` y una
  convención documentada de códigos (401 no autenticado / 403 sin permiso / 400
  validación / 409 conflicto / 503 dependencia externa).
- **Colocación de guards:** a veces en `router.use`, a veces por ruta, a veces
  ambos. Es correcto pero desparejo; conviene una convención (guard de módulo en
  `router.use`, guard de acción por ruta).

Severidad global de §6: 🟡 Media (mantenibilidad). Esfuerzo: medio, incremental.

### A14 — Duplicación de helpers (incluida en lo anterior) 🟡 Media

`verificarPasswordAdmin` ×6 y `validarTelefono10Digitos` ×5 son el ejemplo más
claro: una corrección (p. ej. comparar en tiempo constante, o cambiar la regla
del teléfono) hoy hay que hacerla en 5-6 sitios y es fácil que uno quede atrás.

---

## 7. Higiene

### A12 — `xlsx@0.18.5`: vulnerabilidad alta sin arreglo, en 6 rutas de importación 🟡 Media

- **Archivos:** `package.json` (`xlsx: ^0.18.5`; instalada 0.18.5, confirmada en
  `package-lock.json`). La usan 6 rutas que **parsean Excel subido por web**:
  `territorial` (×3), `votantes/importar-excel`, `diaD` (×2).
- **Qué se rompe:** 0.18.5 arrastra vulnerabilidades altas conocidas (prototype
  pollution / ReDoS) y **no hay versión corregida en el registro de npm**. Las
  6 rutas están protegidas con `requireRole('admin','coordinador')` (verificado,
  incluida `votantes/importar-excel:470`), lo que **reduce** la exposición pero
  no la elimina: un coordinador es menos confiable que un admin y un archivo
  malicioso podría explotar el parser.
- **Recomendación:** migrar a `exceljs` (mantenida). Mientras tanto, mantener el
  guard de rol y aceptar el riesgo formalmente.
- **Esfuerzo:** medio (migración de API).
- **Ventana:** neutra.

### A16 — Función de cohortes de cédula latente/inconexa ⚪ Baja

- **Archivos:** `lib/validarCedula.js` (rama `validarCohorte`), `03_declarado.sql`
  (crea `cedula_cohorte`), `scripts/calibrar_cohortes.js`.
- **Detalle:** `revisarCedula` en `votantes.routes.js:42` llama a `validarCedula`
  con tabla de cohortes **vacía** (`[]`), y `cedula_cohorte` **no la crea
  `init-db.js`** (sólo `03_declarado.sql`, que no forma parte del
  aprovisionamiento). El feature está dormido: sólo operan las reglas de formato.
  No es un bug (no se consulta la tabla ausente), pero es código/tabla/script sin
  cablear. Decidir: cablearlo o retirarlo.

### A17 — Archivos muertos ⚪ Baja

- `archivo-paginas-eliminadas/` (`enviar-whatsapp.html`,
  `enlaces-personalizados.html`): **fuera de `public/`**, no lo sirve
  `express.static` (verificado), no alcanzable. Es sólo desorden; no viaja en
  parches (el generador sólo empaqueta archivos listados).
- `public/126d9d42626f47c9e397cb9a91c5793b.html`: es el **token de verificación
  de dominio de Twilio** (59 bytes, `twilio-domain-verification=…`). Público a
  propósito y legítimo. **No es un hallazgo.**

### A18 — Enumeración de usuarios por tiempo en el login + carrera en el bloqueo ⚪ Baja

- **Archivos:** `routes/auth.routes.js:129-160`.
- **Detalle:** cuando el usuario no existe se responde 401 **sin** ejecutar
  `bcrypt.compare`; cuando existe, sí. La diferencia de tiempo permite inferir
  qué cuentas existen. Y el contador `intentos_fallidos` se lee y se reescribe
  con un valor calculado (no un `UPDATE … SET intentos = intentos + 1` atómico):
  intentos concurrentes pueden subcontar y debilitar el bloqueo. Bajo impacto
  (hay bloqueo por cuenta y rate-limit global), pero fácil de endurecer.

### A19 — `uncaughtException` mantiene vivo el proceso en estado posiblemente inconsistente ⚪ Baja

- **Archivos:** `app.js:227-229`. Registrar y no salir evita caídas, pero tras
  una excepción no capturada el proceso puede quedar en mal estado. Es un
  compromiso conocido; documentarlo (o reiniciar limpio vía PM2 en ese caso).

### A20 / A21 — Superficies de archivo acotadas ⚪ Baja

- **A20:** `comunicaciones.routes.js:36` hace `res.sendFile(path.join(UPLOAD_DIR,
  campana.adjunto_nombre))` en una ruta **pública**, pero sólo si el nombre
  coincide **exactamente** con un `adjunto_nombre` guardado (gate por BD). Riesgo
  de traversal muy bajo (dependería de que un `adjunto_nombre` almacenado
  contuviera `../`). Confirmar que la escritura de ese campo siempre usa nombres
  generados por multer.
- **A21:** `backup.routes.js:209` descomprime un `.zip` subido para restaurar
  (admin + contraseña + frase "RESTAURAR"). Mismo zip-slip que A5, aquí muy
  gateado. `res.download`/descarga de recursos usa `path.basename` (sin
  traversal) — correcto.

### A24 — Listados de usuarios visibles a cualquier rol autenticado ⚪ Baja

- **Archivos:** `routes/usuarios.routes.js:49` (`/buscar-por-cedula`) y `:66`
  (`GET /`) sólo exigen `requireAuth` (no rol). Un `invitado`/`testigo` puede
  enumerar id/nombre/teléfono/email de usuarios. Exposición intra-campaña menor;
  acotar a los roles que de verdad lo necesitan si aplica.

### Lo que se verificó y está bien (higiene)

- **Sin secretos embebidos** en el código (búsqueda de patrones de claves/tokens:
  sólo falsos positivos). Las credenciales de CRM viven en la base **enmascaradas
  al leerlas** (`configuracion.routes.js:285-290`); el resto en `.env`.
- **`.env`, `.licencia-cache.json`, `backups/`, `uploads/`, `parches/*.zip` no
  están en git** (`.gitignore` correcto en eso).
- **Dependencias:** `multer@1.4.5-lts.2` (parcheada), `nodemailer@9.0.5`,
  `mysql2@3.22.5`, `express@4.22.2`, `helmet@8.3.0` — todas al día. La única
  pendiente es `xlsx` (A12).

---

## Lotes de trabajo (independientes y verificables por separado)

Ordenados por prioridad. Cada lote se puede ejecutar, probar y desplegar solo.

### LOTE 1 — Integridad del aprovisionamiento 🪟 (empezar por aquí)
**Incluye:** ~~A1~~ ✅, ~~A3~~ ✅, y **pendientes: A2, A9, A10**.
**Hecho:** la columna, su índice y la verificación de arranque
(`4bedbf9`, `9bdee53`); el esquema ya está versionado.
**Falta de este lote:** reconciliar `schema.sql` con la base real
(`territorios` como vista, FK eliminadas — A2/A9) y la plantilla limpia con
`ADMIN_PASSWORD` por campaña (A10). Nada de eso se tocó a propósito.
**Objetivo:** que una campaña se pueda crear desde el repositorio de forma
reproducible y correcta.
**Trabajo:** agregar `nombre_usuario` (columna + índice + migración) y una
verificación de arranque de columnas críticas; regenerar `db/schema.sql` desde
una base real correcta (con `territorios` como vista y sin las FK eliminadas, o
documentar el modo "tabla local" como camino alterno); versionar el esquema
(`!db/schema.sql`); afirmar plantilla limpia y forzar `ADMIN_PASSWORD` por
campaña.
**Verificación:** `npm run init-db` sobre una base **vacía** → login funciona,
crear usuario/testigo/votante funciona, sin columnas faltantes.

### LOTE 2 — Endurecer la cadena de actualización/licencia 🔒
**Incluye:** A4, A5.
**Trabajo:** secreto de actualizador **por campaña**; firmar los `.zip` de
parche y verificarlos antes de descomprimir; rechazar entradas de zip con
`..`/rutas absolutas (aplica también a A21).
**Verificación:** un parche sin firma o con `../` se rechaza; un parche legítimo
se aplica; el secreto de una campaña no dispara la de otra.

### LOTE 3 — Índices y paginación 🚀
**Incluye:** A7, A7bis (resto), A6.
**Trabajo:** índices en `comunicaciones_envios.twilio_sid` y `*.puesto_id`
(el de `usuarios.nombre_usuario` ya se hizo con A1); paginar `GET /estructura`
y reemplazar sus subconsultas por-fila por agregaciones.
**Verificación:** `EXPLAIN` sin *full scan* en el callback de Twilio y en el
listado de estructura; la pantalla de estructura responde en tiempo constante
con miles de filas.

### LOTE 4 — Atomicidad de escrituras
**Incluye:** A8, A11.
**Trabajo:** envolver reporte del Día D + sus votos en una transacción; volver
transaccional (o documentar formalmente y dar herramienta de reparación) la
sincronización votante↔estructura.
**Verificación:** matar el proceso a mitad de un reporte no deja votos
parciales.

### LOTE 5 — Tipos y colación del esquema 🪟
**Incluye:** A13, A15.
**Trabajo:** unificar `mesa_votacion` a un solo tipo; fijar
`COLLATE=utf8mb4_0900_ai_ci` explícito en las tablas.
**Verificación:** cruces por nombre y por mesa se comportan igual que hoy, sin
conversiones implícitas.

### LOTE 6 — Consistencia y deduplicación
**Incluye:** A14, A18, A24, y las propuestas del §6.
**Trabajo:** módulos únicos `validadores.js` y `verificarPasswordAdmin`; helper
de error + convención de códigos; `UPDATE … intentos+1` atómico y `bcrypt`
"dummy" para igualar tiempos en login; acotar los listados de usuarios.
**Verificación:** una sola definición de cada regla; el login tarda parejo
exista o no la cuenta.

### LOTE 7 — Higiene y código muerto
**Incluye:** A12, A16, A17, A19, A20.
**Trabajo:** plan de migración `xlsx`→`exceljs`; decidir cablear o retirar la
función de cohortes; borrar `archivo-paginas-eliminadas/`; documentar/ajustar la
política de `uncaughtException`; confirmar la generación segura de
`adjunto_nombre`.
**Verificación:** `npm audit` sin altas (tras `xlsx`); repo sin archivos
muertos.

---

## Apéndice — superficie sin autenticar (inventario completo)

Sólo estas rutas responden sin sesión (todo lo demás pasa por `requireAuth` vía
`router.use`, y muchas por `requireRole`):

| Ruta | Protección |
|---|---|
| `POST /webhooks/twilio/*` | Firma de Twilio validada (`webhooks.routes.js:26,156`) |
| `POST /actualizador/*` | Secreto compartido, comparación en tiempo constante (ver A4/A5) |
| `GET /api/comunicaciones/adjunto-publico/:archivo` | Coincidencia exacta contra BD (ver A20) |
| `POST /api/auth/login`, `/olvidar-password`, `/resetear-password`, `/verificar-2fa`, `/elegir-rol` | Flujos de autenticación; token de reset con hash/expiración/un-solo-uso |
| Estáticos de `public/` | Servidos tras el candado de licencia; login/css/js deben ser públicos |

Todo esto está mediado por el candado de licencia (`middleware/licencia.js`),
salvo `/webhooks` y `/actualizador`, excluidos a propósito.
