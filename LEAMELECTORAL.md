# Estado de la sesión — 7 y 8 de agosto de 2026

Documento de traspaso para continuar el trabajo desde otro equipo.
**Todos los datos de aquí fueron verificados contra el servidor y la base**,
no reconstruidos de memoria. Última actualización: 8 de agosto de 2026 (noche),
después del parche 11.

> **Para retomar:** abrir Claude Code en
> `/home/appestrategia-electoral/htdocs/electoral.appestrategia.net` y pedirle
> que lea este archivo y `CLAUDE.md`. Con eso tiene el contexto completo.

> **Este archivo NO debe viajar en los parches.** Si algún día se genera un
> parche con `--desde-fecha`, hay que excluirlo: es documentación interna de
> la instalación base, no código de las campañas.

> `LEAMELECTORAL.md` y `CLAUDE.md` viven **aquí**, y son los archivos reales.
> En `territorios.appestrategia.net` hay dos **enlaces simbólicos** que apuntan
> a ellos: `LEAMELECTORAL.md` → este archivo, y `LEAMETERRITORIOS.md` →
> `CLAUDE.md`. Editar el de aquí actualiza los dos lados. Antes había copias, y
> se desincronizaron.

---

## 1. El terreno

Tres instalaciones de la misma aplicación, más el servidor de licencias. Todas
en el mismo VPS y el mismo MySQL.

| Instalación | Dominio | Puerto | Proceso PM2 | Versión de parche |
|---|---|---|---|---|
| **Base (desarrollo)** | electoral.appestrategia.net | 3002 | `campana-app` | 1 |
| Campaña municipal | campanadepruebamunicipal.appestrategia.net | 3101 | `campana-app-prueba` | 14 |
| Campaña departamental | campanadepruebadepartamental.appestrategia.net | 3102 | `campana-app-departamental` | 14 |
| Licencias | licencias.appestrategia.net | — | — | — |

Rutas: `/home/<usuario-del-sitio>/htdocs/<dominio>/`.
Cada sitio es un **usuario de sistema distinto**, y **cada app corre con el
suyo** (`ps -eo user,args` lo confirma). Hay ACL de lectura/escritura sobre
licencias y sobre las dos campañas.

**Electoral figura en versión 1 y no es un error:** es la instalación base, el
código sale de ahí, y solo el parche 1 se le llegó a registrar. Su número no
dice nada sobre lo que tiene.

**El CTC (Catálogo Territorial de Colombia)** es un cuarto servicio, en
`territorios.appestrategia.net` (puerto 3008, base `territoriosdb`). Electoral
tiene `GRANT SELECT` sobre 17 tablas suyas y hace `JOIN` directo. Todo lo que
hay que saber de él está en `CLAUDE.md`, en la raíz de este proyecto — es
lectura obligatoria antes de tocar territorios, puestos o mesas.

### Variables que hay que exportar en esta shell

Sin esto, `node` y `pm2` no existen (nvm los instala por usuario):

```bash
export PATH="/home/appestrategia-electoral/.nvm/versions/node/v22.23.1/bin:$PATH"
export PM2_HOME="/home/appestrategia-electoral/.pm2"
export NODE_PATH="/home/appestrategia-electoral/htdocs/electoral.appestrategia.net/node_modules"
```

### Cómo probar que algo quedó desplegado

La app **no responde a `127.0.0.1`**: el candado de licencia devuelve 403 a
cualquier dominio no autorizado. Hay que mandar la cabecera `Host`. Y el
puerto es el **3002**, no el 3000 (el 3000 es otro sitio; pegarle da un 403
que parece un error propio y no lo es — ya pasó en esta sesión).

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: electoral.appestrategia.net' http://127.0.0.1:3002/eventos.html
```

---

## 2. Reglas de trabajo que dio el usuario

1. **Los parches se generan SOLO cuando el usuario lo pide.** Se acumulan
   cambios en electoral y, cuando él dice "genera el parche", se empaqueta el
   lote completo. Razón: un parche por cambio llena el catálogo de versiones
   intermedias, y una vez que una campaña aplica un número, **ese número ya no
   se le vuelve a ofrecer** — reescribirlo no sirve.
2. **No ejecutar migraciones ni tocar bases sin aprobación explícita.** A mitad
   de la sesión el usuario detuvo el trabajo para preguntar qué se estaba
   corriendo, sobre qué base, y si había respaldo. Antes de cualquier cambio
   destructivo: respaldo primero, explicación en lenguaje llano, y esperar el
   visto bueno.
3. **Las campañas nunca se editan directamente.** Se desarrolla en electoral y
   se distribuye por parche.
4. **Plan antes de cada bloque de escritura, no un cambio grande de una vez.**
   Regla que el usuario fijó al empezar la etapa 2 del Día D, y que conviene
   mantener: *«el parche es de un solo uso por instalación y no hay forma de
   rehacer el 9 si sale mal»*. En la práctica significa: diagnóstico → plan →
   aprobación → escribir ese bloque → verificar → siguiente bloque.
5. **Diagnóstico primero cuando el cambio es de arquitectura.** Para el paso
   del Día D a id el usuario pidió expresamente *«primero solo diagnóstico, sin
   escribir código»*, e inventariar cada punto de cruce antes de proponer nada.
   Salió bien: el inventario mostró que el parche se podía partir en dos.

---

## 3. Cómo viajan las actualizaciones

```
1. node scripts/generar-parche.js N archivo1 archivo2 ...     (en electoral)
2. cp parches/campana-parcheN.zip  <licencias>/parches/parche-N.zip
3. INSERT en parches_disponibles  (marcar toca_base_datos si hay algo de db/)
4. Panel de licencias → "Aplicar actualizaciones" → elegir campañas → Aplicar
```

La orden llega **al instante** por `POST /actualizador/ejecutar` a cada
campaña; el cron de las 3 a.m. es el respaldo.

`generar-parche.js` **rechaza** `.env`, `uploads/`, `backups/`,
`node_modules/` y cualquier `.sql` fuera de `db/`.

### Catálogo de parches hoy

| Nº | Nombre | Base de datos | Estado |
|---|---|---|---|
| 1 | Catálogo territorial, testigos y app móvil | sí | aplicado en las 3 |
| 2 | Apoyos configurables, filtro de puestos y correcciones de testigos | sí | aplicado en las 2 campañas |
| 3 | Formulario de eventos por apartados y campos de comuna/barrio opcionales | sí | aplicado en las 2 campañas |
| 4 | Re-geocodificar eventos, pin amarillo y área de influencia por municipio | no | aplicado en las 2 campañas |
| 5 | Columna «Apoya a» configurable y puestos de testigo por municipio | no | aplicado en las 2 campañas |
| 6 | «Datos verificados» y mensajes de Día D con el lugar de cada votante | sí | aplicado en las 2 campañas |
| 7 | Apartado «Apoya a» que faltaba, eslogan en el mensaje y dos correcciones | no | aplicado en las 2 campañas |
| 8 | Corrige que una persona apareciera dos veces en Votantes y sublíderes | no | aplicado en las 2 campañas |
| 9 | Día D por id: esquema y backend (etapa 2, primera mitad) | **sí** | aplicado en las 2 campañas |
| 10 | Día D por id: formulario del testigo (etapa 2, segunda mitad) | no | aplicado en las 2 campañas |
| 11 | Validación de cédula al capturar personas | no | aplicado en las 2 campañas |
| 12 | Cierre de sesión, ojo en las contraseñas y columnas territoriales | no | aplicado en las 2 campañas |
| 13 | Ojo de la contraseña bien ubicado y formularios de personas | no | aplicado en las 2 campañas |
| 14 | CRM: baja de contacto, respuestas, contador de SMS, programación y plantillas | **sí** | aplicado en las 2 campañas |
| 15 | WhatsApp fuera, meta derivada, plantillas y arreglo del actualizador | **sí** | aplicado en las 2 — **tumbó las apps, ver 4.gg** |
| 16 | Repara el arranque tras el 15 y la plantilla de correo que faltaba | **sí** | aplicado en las 2 campañas |
| 17 | Avisos push: envío real desde el CRM (**primero con dependencia nueva**) | **sí** | aplicado en las 2 campañas |
| 18-21 | Publicados por la línea de trabajo de `AUDITORIA.md` | — | aplicados en las 2 campañas |
| 22 | Plantillas visibles y la pantalla «Aviso en la app» | no | aplicado en las 2 campañas |
| 23 | Torre de acceso: ingreso por código | no | aplicado en las 2 campañas |

**El siguiente número libre es el 24 — pero PREGÚNTESELO AL CATÁLOGO, no a
esta tabla.** Sobre este repositorio trabaja más de una línea a la vez: el
9 de agosto esta tabla iba por el 17 mientras las campañas ya estaban en el
21, publicados por la auditoría de `AUDITORIA.md`. Generar «el siguiente»
según este documento habría chocado con un número ya usado (ver 4.kk):

```sql
SELECT MAX(numero_parche) FROM parches_disponibles;
```

**`parches_disponibles.id` NO es `numero_parche`.** Van desfasados en uno: el
parche 11 es la fila `id = 12`, porque la tabla arranca en `id = 2`. Un
`INSERT` que dé por hecho que coinciden habilita el parche equivocado, y peor,
un `INSERT` de varias filas donde una ya existe **muere entero** y deja las
otras sin escribir — pasó con el 11, que quedó sin habilitar mientras la fila
del 10 ya estaba. Consultar siempre por `numero_parche`, y usar `INSERT IGNORE`
al habilitar instalaciones.

**El número de parche es de UN SOLO USO por instalación.** Una vez que una
campaña lo aplica queda registrado en su `.version-parche`, y el servidor no
se lo vuelve a ofrecer: reescribir el zip de ese número **no llega a ningún
lado**. Pasó el 8 de agosto — se pidió rehacer el 7 para meterle un archivo
más y, para entonces, las dos campañas ya lo habían aplicado; hubo que sacar
el 8. Antes de proponer rehacer un parche, comprobar si ya se aplicó:

```sql
SELECT COUNT(*) FROM parches_aplicados WHERE numero_parche = N;
```

**Dos parches seguidos podían quedar bloqueados diez minutos** — corregido en
electoral el 8 de agosto (ver punto 4.w), **todavía no en las campañas**: el
arreglo vive en `routes/actualizador.routes.js` y no llega allá hasta que
viaje en un parche. Mientras tanto, en las campañas sigue vigente la regla
vieja: si una corrida termina en *«ya estás al día, nada que aplicar»*, el
siguiente intento recibe *«ya hay una actualización en curso»* durante diez
minutos. No es un fallo del parche: es esperar y volver a darle.

Todos quedan en modo `seleccionadas`: nada se mueve hasta habilitar la
instalación en `parches_instalaciones_permitidas`. Mientras no esté
habilitada, la descarga responde *«Este parche todavía no está habilitado
para esta instalación»* — que es lo correcto, no un fallo.

**Antes de aplicar un parche que toque la base, respaldo.** Lo tocan el 1, 2,
3, 6, 9 y 14 (la columna «Base de datos» de la tabla de arriba lo dice). Los que
solo reemplazan archivos no lo necesitan: el original vive en electoral.
Contar tablas e `INSERT`, nunca mirar el tamaño:

```bash
mysqldump --no-tablespaces --single-transaction --routines --triggers ... > r.sql
grep -ac 'CREATE TABLE' r.sql ; grep -ac 'INSERT INTO' r.sql
```

Los respaldos previos a cada parche quedan en `backups/` **de cada campaña**,
con el número en el nombre (`..._antes_parche9_2026-08-08_1754.sql`).

Y ojo con el ritmo: **el usuario habilita y aplica los parches desde el panel
por su cuenta**, a veces entre un mensaje y el siguiente. Lo que hace un
momento estaba en «0 habilitadas» puede estar aplicado diez minutos después.

---

## 4. Lo que se hizo en esta sesión

En orden. Todo esto ya está **desplegado y verificado en electoral**.

### a) Plantilla de instalación limpia
Zip para campañas nuevas. Se borraron después los archivos con datos
personales que quedaron de la migración (`datos-campana.sql`,
`uploads-campana.zip`), una vez el usuario confirmó.

### b) Usuario administrador y bucle de "actualice su contraseña"
Creado el admin; corregido el bucle que impedía entrar.

### c) Bloque de 6 cambios (plan aprobado en modo plan)
1. y 2. **Puestos de votación filtrados** por el Departamento/Ciudad de la
   campaña. Si Configuración no tiene departamento, la lista sale **vacía**
   (antes salían los 12.885 del país).
3. **Bug del testigo electoral.** Era arquitectural: una sola fila de columnas
   en `usuarios` servía para dos conceptos —dónde vota la persona y dónde
   vigila como testigo— y se pisaban. Se agregaron 5 columnas a `estructura`
   y las lecturas pasaron a `COALESCE(e.campo, u.campo)`. El camino del
   "testigo puro" (`testigos.html`) **no se tocó**, porque ahí no hay lugar de
   votación aparte que proteger.
4. **GPS de la app móvil.** Espera de 30 s (antes 10) y reintento por red.
   Además faltaba `GOOGLE_MAPS_API_KEY` en el `.env` de las dos campañas.
5. **Pantalla "Mis registros"** en el móvil: barra de progreso, buscador,
   listado y botones de WhatsApp y llamar.
6. **Quitado "Usar ubicación actual"** de los formularios de escritorio.

### d) Actualizador automático
Submenú "Aplicar actualizaciones" en licencias, con casillas por campaña.
Nuevo `routes/actualizador.routes.js` en cada instalación, montado en `app.js`
**antes** del candado de licencia.

### e) "Mi cuenta" en licencias
Cambio de contraseña del administrador y verificación en dos pasos por correo.

### f) Copia de datos entre campañas
De `campanadepruebamunicipal` a `campanadepruebadepartamental`, sin testigos.

### g) La campaña departamental pasó de Caldas/Manizales a Quindío/Armenia
Puestos y mesas repartidos al azar, respetando que ninguna mesa se asigne dos
veces dentro del mismo puesto. Script en el scratchpad:
`mover-a-quindio.js`.

### h) "Activar apoyos"
En Configuración → Datos de la campaña. Las casillas dependen del cargo y
definen las opciones de "Apoya a" en los formularios de personas.

### i) Reestructuración del formulario de Eventos

Orden final de los apartados —títulos en `#0B5ED7`, mayúscula y negrita:

```
DATOS DEL EVENTO       Título, Tipo, Meta de asistentes, Estado,
                       Fecha y hora de inicio, Fecha y hora de fin, Descripción
LUGAR DEL EVENTO       Dirección, Departamento, Ciudad, Área,
                       Comuna, Barrio, Corregimiento, Vereda
RESPONSABLES DEL EVENTO  Coordinador, Líder, Responsable de la reunión
```

Se quitó el botón "Usar ubicación actual". Se agregaron las columnas
`eventos.departamento` y `eventos.ciudad` (un evento puede ser fuera de la
ciudad sede; sin ese dato la dirección se geocodificaba al municipio
equivocado).

**Decisión propia que conviene revisar:** el campo *Descripción* quedaba
suelto después de Responsable de la reunión, y el usuario pidió que
Responsables fuera el último apartado. Se movió a Datos del evento.

### j) Comunas y barrios apagados desde Configuración

Cuando Configuración → Datos de la campaña dice **No** a "¿Utilizar nombre de
comunas?" o a "¿Utilizar nombre de barrios?", ese campo no aparece en ningún
formulario.

Lo que se encontró y corrigió:

- **La excepción real** estaba en Estructura territorial: el campo Comuna
  seguía apareciendo para el cargo *Coordinador*. Peor, el validador lo
  exigía — un formulario imposible de guardar, porque pedía llenar un campo
  invisible. Ya no aparece para ningún cargo y el validador dejó de exigirlo.
- **Blindaje por CSS.** La regla vive ahora en `public/css/style.css` y
  `public/app/estilos-app.css` con `!important`, activada por las clases
  `sin-comunas` / `sin-barrios` en el `<body>`:

  ```css
  body.sin-comunas [data-campo="comuna"] { display: none !important; }
  body.sin-barrios [data-campo="barrio"] { display: none !important; }
  body.sin-comunas.sin-barrios [data-fila="urbano"] { display: none !important; }
  ```

  Se hizo así, y no en el JavaScript de cada página, porque varios formularios
  muestran y ocultan esos mismos campos por su cuenta (por área urbana/rural,
  por cargo) con estilos en línea. El `!important` gana siempre, así que la
  opción de Configuración no se puede pisar por accidente.
- Cubre los **5 formularios**: `territorial.html`, `votantes.html`,
  `eventos.html`, `asistentes-reuniones.html` y `app/registro-votante.html`.
- **Gestionar territorios** ya no ofrece crear zonas del tipo que la campaña
  no usa.
- **Service worker a `estrategia-v14`.** Sin subir esa versión, los
  navegadores habrían seguido usando la hoja de estilos vieja y el cambio no
  se habría visto.

**Un caso que se dejó a propósito sin ocultar:** en Estructura territorial los
campos de residencia son combinados —"Comuna / Corregimiento" y
"Barrio / Vereda"—. Ocultarlos borraría también la parte rural, que sí se usa.
Lo que se hizo fue quitarles el término que la campaña no usa: con comunas en
No, la etiqueta pasa a decir solo "Corregimiento".

**Tampoco se tocaron** las columnas de las tablas de listado (por ejemplo la
columna "Barrio" en Asistentes a reuniones) ni los tableros de análisis: son
datos ya guardados, no formularios. Queda pendiente decidir si también se
ajustan.

### k) Parches 3 y 4: creados, habilitados y aplicados (8 de agosto)

Las dos campañas quedaron en la **versión 4**, verificado archivo por archivo
contra electoral (no con el "exitoso" que reportan) y con los datos intactos.

### l) Re-geocodificar eventos

Dos botones en Eventos y movilización, iguales a los de Votantes y Estructura:
**Re-geocodificar pendientes** y **Corregir ubicaciones existentes** (este pide
contraseña de administrador, porque pisa coordenadas ya calculadas).

Hubo que crear `POST /eventos/regeocodificar-pendientes`, que no existía.
Procesa en lotes de 5 con pausa de 1,2 s — Nominatim limita a ~1 solicitud por
segundo — y el cursor solo avanza, así que se puede reanudar tras un fallo.

A diferencia de los otros dos, completa la dirección con el Departamento y la
Ciudad **del evento**, no los de la campaña: para eso se agregaron esas
columnas en el parche 3.

Los botones se ocultan a quien no sea administrador. La ruta lo exige, y
ofrecer un botón para luego negarlo hace creer que algo se rompió.

### m) Pin de Reunión / evento en el mapa

Amarillo `#FFF212` con borde negro (antes `#dc2626` con borde blanco). El pin
dibujaba el borde fijo, así que `crearIconoPin()` estrena un parámetro de
color de borde. **Se cambió también el punto de la leyenda**: si no, la
leyenda diría una cosa y el mapa otra.

### n) Área de influencia por municipio en campaña departamental

El problema tenía **dos causas**, y una era un fallo que nadie había visto:

1. Con Gobernación o Asamblea la campaña no tiene ciudad sede (`ciudad` viene
   vacía), y los formularios anclaban Comuna/Barrio/Corregimiento/Vereda a la
   **Ciudad de residencia**. Sin ciudad, ninguna lista se llenaba.
2. La lista de veredas solo mostraba las que cuelgan de un **corregimiento**.
   En el catálogo nacional las veredas cuelgan directo del municipio, así que
   en Quindío salían **0 de 232**.

Solución, en `territorial.html` (Agregar persona) y `votantes.html` (solo al
marcar Sublíder):

- Campo **Municipio** dentro de "Territorio o área de influencia", visible
  solo con `cargo_aspira` en `gobernacion` o `asamblea`. De él cuelga todo.
- El validador **ya no exige lo que no existe**: si en ese municipio no hay
  barrios creados, baja al nivel que sí exista (comuna y, en último caso, el
  municipio). Igual con corregimientos y veredas.
- La precarga al editar sube por `padre_id` hasta el municipio y lo llena
  **primero**: al revés, las listas de abajo saldrían vacías y borrarían lo ya
  precargado.

Probado replicando el validador contra las dos bases reales:

| Caso | Resultado |
|---|---|
| Quindío · Calarcá · urbano sin barrio | guarda en municipio Calarcá |
| Quindío · Calarcá · rural con vereda real | guarda en la vereda |
| Quindío · sin municipio elegido | pide el municipio |
| **Manizales** · urbano sin barrio | **sigue exigiendo el barrio** |
| **Manizales** · rural sin vereda | **sigue exigiendo la vereda** |

Las dos últimas son la prueba de que la campaña municipal no cambió.

**Ojo:** en Quindío las veredas sí existen, así que ese campo sigue siendo
obligatorio en área rural. La regla es "no exigir lo que no existe", no "no
exigir nunca".

### o) Archivos de Recursos y Biografía copiados a la departamental

Las **filas** ya estaban iguales en las dos campañas (vinieron con la copia de
datos del punto f), pero los **archivos** no: el origen tenía 279 MB y el
destino cero. Cada imagen y cada video apuntaban a un archivo inexistente.

Se copiaron **33 archivos, 210 MB**, en las mismas rutas exactas (las filas ya
las traían escritas): 31 de Recursos —"Información para compartir"— más la
foto y el video de la Biografía del candidato. Comparados byte a byte, y las
33 referencias de la base del destino resuelven: cero enlaces rotos.

Quedaron fuera a propósito **32 archivos huérfanos** (ninguna tabla los
menciona: restos de piezas borradas).

**Permisos:** el proceso del sitio corre como `campanadepruebadepartamental` y
los archivos copiados quedan a nombre de `gariasappelectoral`, así que
necesitan `chmod o+r`. Es la misma trampa que tumbó licencias con un 502.

### p) Parches 5 a 8 (8 de agosto)

- **5** — La columna «Apoya a» y su filtro dejan de tener los cinco cargos
  escritos a mano y salen de Configuración. Y en campaña departamental, al
  marcar «Es también testigo electoral», el desplegable de Puesto se acota
  al municipio del Lugar de votación (130 → 53 en Armenia).
- **6** — Columna **«Datos verificados»** en Votantes (marcar pregunta,
  desmarcar pide contraseña; el backend ya existía, faltaba la casilla). Y
  los mensajes de Día D con el Lugar de votación de cada destinatario.
- **7** — El apartado «Apoya a» que había desaparecido del formulario,
  el marcador `{slogan}` y dos correcciones.
- **8** — La corrección de los duplicados (ver punto r).

### q) Mensajes de Día D personalizados

Marcadores que se reemplazan **por destinatario**: `{lugar_votacion}` (todo
junto), `{puesto}`, `{mesa}`, `{municipio}`, `{departamento}`, más
`{slogan}`, que sale de Datos de la campaña. Un botón deja la plantilla
escrita. El filtro «Puesto de votación» dejó de ser solo para Testigos y
segmenta Votantes, que es el corte natural del Día D.

**A quien no tenga Puesto registrado no se le envía**: le llegaría el lugar
en blanco. Se avisa antes de enviar con los nombres, y después queda en el
reporte como `sin_lugar_votacion`, **contado aparte de los fallidos** —
fallido es que se intentó y el proveedor lo rechazó; esto es que ni se
intentó.

Dos cosas que se encontraron al hacerlo:

- **Enviar SMS aplanaba los destinatarios a una lista de teléfonos** y
  perdía de quién era cada uno. Con los marcadores eso no habría fallado a
  medias: no le habría enviado a **nadie** desde esa pantalla. Ahora manda
  tipo e id, y el servidor **relee el teléfono de la base** — así el lugar
  de votación de una persona solo puede llegar a su propio número.
- Un contacto **escrito a mano** que corresponde a alguien registrado ahora
  se reconoce y sale a su nombre, con su lugar. Antes se enviaba como
  contacto suelto y quedaba saltado aunque su ficha estuviera completa.

### r) Una persona aparecía dos veces en Votantes y sublíderes

**Era un fallo real, y se reprodujo antes de tocar nada.** Agregar a alguien
a Estructura territorial crea su ficha en Votantes usando la **cédula como
llave**. Si la cédula tecleada en Estructura no era idéntica a la que ya
tenía en Votantes —un dígito mal escrito—, no la reconocía y creaba una
**segunda ficha**. La columna `origen` de la fila nueva dice `estructura`:
la creó la sincronización, no una persona.

Ahora, antes de crear una ficha, se busca si esa misma persona ya existe con
otra cédula. El cotejo exige **nombre y teléfono a la vez**: solo el teléfono
no basta (en una familia se comparte) y solo el nombre tampoco (hay
homónimos). Probado que dos personas distintas con el mismo teléfono **no**
se fusionan.

**Quedan duplicados de antes**, que el parche no toca porque hay que decidir
cuál cédula es la buena. Estado al cierre del 8 de agosto:

| Nombre | Municipal | Departamental | cédulas |
|---|---|---|---|
| Carlos Julio Arias | ids 15, 198 | ids 15, 198 | 10232563 · 94492349 |
| Luis Antonio Arias Montoya | ids 14, 189 | ids 14, 189 | 15232363 · 15903941 |
| Gildardo Arias Vidales | **ya no** | ids 2, 228 | 71180330 · 71185330 |

En la municipal quedan **dos**; en la departamental, **tres**. La ficha de
Gildardo con cédula 71180330 desapareció de la municipal en algún momento del
8 de agosto (la que sobrevive, id 228, tiene `origen = 'estructura'`).

Y se endureció el listado: enganchaba la ficha de testigo con un `LEFT JOIN`
que **multiplica filas**. Probado forzando la condición: 87 filas para 84
votantes con el JOIN viejo, 84 con el nuevo.

### s) Twilio: el número remitente con espacios

**Twilio se configura en Configuración → Configurar CRM, no en el `.env`.**
El código lee la base primero y solo cae al `.env` si ahí no hay nada. En la
pantalla el Auth Token se guarda enmascarado y, dejando el campo vacío,
conserva el que ya había.

El remitente se le pasaba a Twilio **tal cual**, y al guardar solo se
recortan los extremos. Escrito con separadores —`+1424 497 5583`, que es lo
natural— los espacios de en medio llegaban intactos y Twilio responde
*Invalid 'From' Number*. **Sin ningún aviso: el canal se ve configurado.**

Corregido en `config/comunicacionesConfig.js` (`soloE164`), **al leer y no al
guardar**, para que también arregle los números ya guardados sin volver a
escribirlos. Viajó en el parche 9. Hoy las dos campañas tienen
`twilio_sms_from = +14244975583`, sin espacios, ya en la base.

### t) Día D: los cruces de puesto pasaron de nombre a id (parches 9 y 10)

Es la **etapa 2 del pendiente 2 del CTC**, la que `CLAUDE.md` describía como
«un cambio grande; no ahora». El usuario pidió **diagnóstico primero, sin
escribir código**.

**El inventario** — dónde se cruzaba el puesto por texto:

| Punto | Qué hacía |
|---|---|
| `usuarios.puesto_votacion` | texto libre, sin foránea al puesto |
| `GET /puestos-para-reporte` | devolvía un **arreglo de nombres** |
| `GET /mesas-ocupadas?puesto=<nombre>` | cruzaba texto contra `usuarios.puesto_votacion` |
| `GET /puestos-con-mesas` | el payload que **cachea el móvil** para trabajar sin conexión, también por nombre |
| `dia_d_reportes.puesto_votacion` | el reporte guardaba solo el texto |
| Tres agregaciones de la jornada | agrupaban por ese texto |

**Las cuatro decisiones del usuario**, todas aplicadas tal cual:

1. **En `dia_d_reportes` se guardan los dos**: el id y el texto. Pero *«el
   texto es una instantánea, no una llave. Que quede documentado en el código,
   o alguien en seis meses lo va a usar para cruzar y reintroduce el
   problema.»* El comentario está en `db/init-db.js`, junto a la columna.
2. **`votantes.puesto_id`, con nulo permitido.** Un votante puede no tener
   puesto y eso no es un error.
3. **El móvil pasa de `<input list>` a `<select>`**, pero con salida:
   una opción explícita **«Mi puesto no aparece en la lista»**
   (`PUESTO_OTRO = '__otro__'`). Elegirla marca el reporte como
   `puesto_fuera_de_lista` en vez de perderlo.
4. **Borrar y resembrar los puestos desde el catálogo.** Ninguna campaña tiene
   datos reales, así que no hay retrofit. (Ver el punto u: al medirlo, borrar
   y resembrar resultó ser lo que **no** había que hacer.)

**Se partió en dos parches, y esa fue la decisión que lo hizo seguro.** El
parche 9 lleva esquema y backend **dejando la forma vieja intacta**:
`/puestos-para-reporte` sigue devolviendo el arreglo de nombres, y solo
entrega `[{id, nombre}]` si se le pide `?con_id=1`. Así el 9 se puede aplicar
solo, con el móvil viejo todavía en los celulares, sin romper nada. El 10
lleva el formulario.

Se verificó consumidor por consumidor antes de partirlo: de todas las rutas
tocadas, la única con forma incompatible era `/puestos-para-reporte`, con tres
consumidores que hacen `.map(p => ...)` sobre el arreglo.

**Las dos trampas de la caché del móvil**, que el usuario pidió probar
explícitamente:

- La lista con ids se guarda bajo una clave **nueva**,
  `diad_puestos_con_id`, sin tocar `diad_puestos`. Un celular con la app vieja
  sigue leyendo su clave de siempre.
- El lector tolera **las dos formas**:
  `typeof p === 'string' ? p : p.nombre`. Un celular que quedó con la caché
  vieja y recibe el HTML nuevo no se rompe.

**Las agregaciones agrupan por una llave compuesta**, no por el id:

```sql
SELECT COALESCE(CAST(puesto_id AS CHAR), puesto_votacion) AS clave_puesto,
       mesa_votacion, MAX(id) AS ultimo_id
  FROM dia_d_reportes GROUP BY clave_puesto, mesa_votacion
```

Por eso los **4 reportes viejos de la campaña municipal** —anteriores al
parche 9, con `puesto_id` nulo— siguen contando bien: caen al texto. Si se
hubiera agrupado solo por id, los cuatro habrían colapsado en un grupo nulo.

**El relleno retroactivo** está en `db/init-db.js` y corre en cada migración:
para `usuarios` y `votantes`, une el texto contra `dia_d_puestos_votacion` y
llena el `puesto_id` que falte. Sin eso, las filas que ya existían se quedaban
con id nulo para siempre y el cambio solo habría servido para lo nuevo. Los
disparadores lo mantienen al día de ahí en adelante.

**Un fallo que se coló y se atrapó midiendo, no leyendo:** la cadena `'0'` es
**verdadera** en JavaScript, así que `b.puesto_fuera_de_lista ? 1 : 0` marcaba
para revisión **todos** los reportes correctos. Se descubrió porque la prueba
consultó el **valor guardado**, no el 200 de la respuesta. La corrección es
una lista blanca:

```js
const marcadoPorElCliente = ['1', 1, true, 'true'].includes(b.puesto_fuera_de_lista);
const fueraDeLista = puestoId === null ? 1 : (marcadoPorElCliente ? 1 : 0);
```

Probado de extremo a extremo en la **departamental** (no en la municipal, por
pedido del usuario, que dejó un candidato de prueba): dos reportes enviados
desde el formulario nuevo, los dos con su `puesto_id` y con
`puesto_fuera_de_lista = 0`.

### u) Los puestos no se borraron: se repuntaron (8 de agosto)

La decisión 4 del punto anterior era *borrar y resembrar*. Al ir a hacerlo, la
medición dijo otra cosa:

- Había **102 referencias sin proteger** que se habrían quedado colgando.
- Y resembrar **no arregla nada**: el catálogo devuelve los mismos nombres
  calificados, y la guarda de `sembrar_puestos_campana.sql` bloquea la
  siembra en cuanto hay testigos con el puesto en texto — que es justo el
  caso de las dos campañas.

Se le dijo al usuario, que delegó la decisión. Se hizo **repunte quirúrgico**
en vez de borrado: cruzar el texto existente contra el catálogo y escribir el
`puesto_id`, sin tocar el texto. Resultado en la departamental: de **17**
personas sin puesto resuelto se pasó a **1**. Respaldo previo en
`backups/..._antes_repunte_puestos_2026-08-08_1808.sql` de cada campaña.

Estado hoy, verificado contra las dos bases:

| | Municipal | Departamental |
|---|---|---|
| usuarios con puesto en texto | 51 | 51 |
| …sin `puesto_id` | 0 | 1 |
| votantes con puesto en texto | 84 | 83 |
| …sin `puesto_id` | 1 | 1 |
| puestos de la campaña | 92 | 130 |
| …sin `ctc_puesto_id` | 1 | 0 |

Los que quedan tienen nombre y apellido, y ninguno es un fallo del código:

- **Karen Cristina Fernandez Rueda** (departamental, como usuaria y como
  votante) tiene registrado `PUESTO CABECERA MUNICIPAL`, que existe en
  **diecisiete** municipios de Caldas y en varios del Quindío. No se puede
  resolver sin preguntarle a ella en cuál vota. Adivinar la metería en el
  municipio equivocado — el error de Cali, otra vez.
- **Sara Corrales** (municipal) vota en `I E LA SULTANA SEDE PRINCIPAL`, que
  está **fuera del ámbito** de la campaña.
- El puesto sin catalogar de la municipal es
  `PUESTO DE BRUEBA (ELIMINAR)`, id 93: una fila de prueba, con la falta de
  ortografía incluida.

### v) Validación de cédula al capturar personas (parche 11)

`lib/validarCedula.js` y `scripts/calibrar_cohortes.js` aparecían como
modificados en la raíz y **no los había creado esta línea de trabajo**. El
usuario pidió examinarlos y aplicarlos si servían. Conclusión distinta para
cada uno:

- **`calibrar_cohortes.js` no sirve aquí.** Lee una tabla `ciudadano` con
  `cedula_enc` y necesita un `lib/cedulaCrypto` — nada de eso existe en este
  proyecto. Se dejó donde está, sin usar.
- **`validarCedula.js` sí**, con dos cambios.

Lo que hace: avisa de cédulas imposibles o sospechosas al capturar una
persona. **No bloquea casi nada**, y eso fue deliberado. Solo rechazan los
formatos que no pueden ser un número de cédula:

```js
CODIGOS_QUE_BLOQUEAN = [
  'vacio', 'sin_digitos', 'solo_ceros',
  'caracteres_no_numericos', 'demasiado_corta', 'demasiado_larga'
]
```

Un `digito_repetido` o una `secuencia_trivial` (`12345678`) **solo advierten**:
existen cédulas reales así, y bloquear una cédula buena es peor que dejar
pasar una rara. La decisión de bloquear la toma **el servidor**
(`revisarCedula` en `routes/votantes.routes.js`), no el formulario: un
formulario se puede saltar llamando a la API directo, y así se probó.

**Una sola copia del validador, no dos.** El mismo archivo `lib/validarCedula.js`
lo carga el servidor con `require` y lo sirve el navegador por una ruta de
`app.js`:

```js
app.get('/js/validarCedula.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'lib', 'validarCedula.js'));
});
```

Para que funcione en los dos mundos lleva una guarda al final: `module.exports`
si existe, y si no `window.ValidarCedula`. Copiarlo a `public/` habría sido más
simple y habría divergido: el formulario diría una cosa y la API otra.

El aviso en pantalla lo pone `public/js/validacion-cedula-ui.js`, que **se
engancha solo** buscando los campos por id (`input-numero-votante`,
`input-numero-persona`, `input-numero-testigo`, `f-cedula`). Incluido en
`votantes.html`, `territorial.html`, `testigos.html` y
`app/registro-votante.html`; si una pantalla no tiene ninguno de esos campos,
no hace nada.

**Doble digitación de la cédula: descartada por el usuario.** Se propuso y
dijo que no.

**De dónde salieron esos dos archivos.** De `SPEC-escaner-cedulas.md`, en la
raíz de este proyecto: la especificación de un **«Módulo de Captura Territorial
(modo declarado)»** que otra línea de trabajo dejó a medias. El parche 11 tomó
de ahí solo la validación de cédula; el resto del módulo —cohortes por año de
expedición, cifrado de la cédula, tabla `ciudadano`— **no está implementado y
no se empezó**. Ese documento se lee como si fuera un `CLAUDE.md` alternativo:
conviene no confundirlo con el estado real de la app.

### w) El candado del actualizador dejó de ser una variable en memoria

**El registro dejó la causa por escrito**, en `logs/actualizaciones.log` de las
dos campañas:

```
18:59:57  «Ya estás al día (versión 10). Nada que aplicar.»   ← no reinicia PM2
19:10:08  «Hay 1 parche(s) nuevo(s): #11»                     ← 10 min 11 s después
```

`routes/actualizador.routes.js` llevaba una bandera `enCurso` en memoria. Una
bandera en memoria **se borra en cada reinicio de PM2 — y aplicar un parche
reinicia PM2**, así que mentía en los dos sentidos:

- Decía «libre» cuando **no** lo estaba: tras el reinicio de media
  actualización, el proceso nuevo nacía con la bandera abajo mientras el
  actualizador seguía trabajando.
- Decía «ocupado» cuando **sí** estaba libre: si la corrida no aplicaba nada,
  no había reinicio que la bajara y quedaba trabada hasta que vencía un
  temporizador de diez minutos.

O sea que **el candado se cerraba justo en el caso inofensivo** y se abría en
el peligroso.

Ahora se le pregunta al sistema: ¿hay un proceso corriendo
`scripts/actualizar-automatico.js` **de esta instalación**? Se recorre `/proc`
comparando **argumentos exactos**, nunca subcadenas, y saltando el PID propio.
Las rutas relativas se resuelven contra el `cwd` del proceso, porque el cron lo
lanza así:

```
cd /ruta/al/sitio && node scripts/actualizar-automatico.js
```

Sin resolverlas, el actualizador de **otra campaña del mismo VPS** —idéntico
argumento relativo, distinta instalación— contaría como propio y bloquearía una
actualización legítima. Y como `/proc/<pid>/cwd` solo lo puede leer el dueño del
proceso, y cada sitio corre con su usuario, los procesos ajenos quedan
descartados sin código extra.

Queda una marca en memoria, pero de **60 segundos**, solo para tapar el hueco
entre el `spawn` y el momento en que el proceso ya figura en `/proc`. En esos
milisegundos dos clics seguidos arrancarían dos actualizadores descomprimiendo
sobre el mismo árbol, que es lo único que este candado existe para impedir.

**Cómo se probó, que es la mitad del trabajo.** `POST /ejecutar` en electoral
aplicaría los parches 2 al 11, así que no se puede llamar a la ligera. Dos
bancos de prueba:

1. El **router real**, montado en un puerto aparte bajo el usuario que lanza
   los procesos de prueba (`/proc/<pid>/cwd` solo lo lee el mismo usuario, así
   que desde otra cuenta el caso del cron no se puede reproducir). Seis casos,
   con procesos de mentira hechos con `tail -f` sobre el propio script —argv
   exacto, cero efectos—: ruta relativa propia (**true**), relativa de otra
   campaña (**false**), relativa con rodeo `./a/../a` (**true**), absoluta
   propia (**true**), absoluta de otra campaña (**false**) y un nombre
   parecido pero distinto (**false**). Los seis, y en los seis se liberó en
   cuanto murió el proceso.
2. Una **caja aislada** con una copia del archivo —comprobada byte a byte con
   `cmp`— y un actualizador de mentira que se acaba de inmediato, para poder
   llamar a `/ejecutar` de verdad: 200, luego 409 a un segundo y medio (con el
   proceso ya muerto: el margen haciendo su trabajo), y 200 otra vez pasados
   los 60 s, con el actualizador corriendo las dos veces.

**Falta que viaje a las campañas en un parche.** Ahí sigue la versión vieja.

### x) Correcciones de datos en las dos campañas (8 de agosto, noche)

Con respaldo previo de cada base
(`..._antes_correcciones_datos_2026-08-08_1952.sql`, 28 tablas cada uno).

| Qué | Dónde | Resultado |
|---|---|---|
| Karen Cristina → `PUESTO CABECERA MUNICIPAL (CÓRDOBA)` | departamental, `usuarios` 76 y `votantes` 53 | `puesto_id` 1874 |
| Sara Corrales → `I.E. LA SULTANA SEDE PRINCIPAL` | municipal, `votantes` 7 | `puesto_id` 37 |
| Fusión de Gildardo y Luis Antonio | se borraron `votantes` 2 y 14 | quedan 228 y 189 |
| Fila de prueba `PUESTO DE BRUEBA (ELIMINAR)` | municipal | borrada |

Las dos campañas quedaron en **cero** usuarios y **cero** votantes con puesto
en texto sin `puesto_id` resuelto.

**La trampa que casi arruina esto: el disparador pisa lo que uno escribe.**
`trg_usuarios_puesto_id_upd` y `trg_votantes_puesto_id_upd` son `BEFORE UPDATE`
y hacen `SET NEW.puesto_id = (SELECT ... WHERE p.nombre = NEW.puesto_votacion)`
**sin condición**. Un `UPDATE ... SET puesto_id = 1874` se habría borrado solo:
el disparador recalcula el id desde el texto, que seguía sin coincidir, y lo
deja en `NULL`. Sin error, sin aviso, y el `UPDATE` reportando una fila
afectada.

La corrección va **por el texto**, y el id lo deduce el disparador — que es
como está diseñado: *el texto es lo que la persona escribió; el id se deduce
de él*.

**Por qué sobrevive la ficha nacida en `estructura` y no la tecleada a mano.**
No es porque tenga mejores datos —la manual traía territorio más específico
(vereda en vez de municipio) y un `apoya_a` más lleno—, sino porque **borrar
la otra no serviría: la sincronización la volvería a crear**. Se pierde ese
detalle territorial, y queda dicho.

**Carlos Julio Arias no se fusionó, a propósito.** Teléfonos distintos,
direcciones distintas y ninguna cuenta de usuario: nada prueba que sean la
misma persona. Es exactamente el caso que la regla nueva —nombre **y**
teléfono— se niega a fusionar.

**Ojo al medir mientras alguien usa la app.** El conteo de votantes de la
municipal dio 85 antes y 85 después de borrar una ficha, y no era un fallo:
entraron **tres registros nuevos** entre las 18:46 y las 19:25, hechos desde la
aplicación mientras se trabajaba. Un total que no se mueve puede estar
tapando dos cambios que se cancelan.

### y) Comuna y Barrio en tablas y tableros (8 de agosto, noche)

Decisión del usuario: la columna desaparece **solo si está vacía**, para no
esconder lo que la campaña alcanzó a capturar antes de apagar la opción.
Cuatro piezas:

1. `GET /api/configuracion/campana` devuelve **seis banderas**:
   `hay_datos_comuna`, `_corregimiento`, `_barrio`, `_vereda` (del árbol de
   territorios) y `_comuna_texto`, `_barrio_texto` (del texto libre de
   residencia).
2. `public/js/columnas-territoriales.js` decide etiqueta y visibilidad.
3. Las tablas de `votantes.html`, `territorial.html` y
   `asistentes-reuniones.html` marcan encabezado y celda con
   `.col-comuna-correg` / `.col-barrio-vereda`; el CSS las esconde con las
   clases `sin-columna-comuna` / `sin-columna-barrio` del `<body>` — el mismo
   idioma que ya usaba «Apoya a».
4. En `votantes-dashboard.html` no son columnas sino **tarjetas enteras** y
   los bloques de cobertura.

**Tres cosas que solo aparecieron al medir, y que cambiaron el diseño:**

**La columna es combinada, y mirar una sola mitad la borra.** La primera
versión traía dos banderas. En la campaña departamental no hay **ni un
barrio**, pero sí 82 personas en veredas: «Barrio / Vereda» se habría
ocultado con la única información territorial que esa campaña tiene. Por eso
son cuatro niveles y la columna se esconde solo si sus dos mitades están
vacías.

**La columna «Barrio» de Asistentes no es lo que dice su encabezado.** El
backend la llena con `COALESCE(tv.nombre, u.barrio_residencia)`
(`eventos.routes.js`): el territorio —que puede ser una vereda— y, si no lo
hay, **texto libre**. Medido: 34 usuarios de la departamental tienen ese
texto. Sin mirarlo, una campaña con residencias escritas a mano y sin
territorios habría perdido de vista una columna con datos.

**Pero sumar ese texto en todas partes es el error contrario.** Votantes y
Estructura leen el árbol y no muestran ese texto: contarlo dejaría una
columna visible y **vacía en todas las filas**. Cada página declara su fuente:

```js
aplicarColumnasTerritoriales(cfg);                                   // lee el árbol
aplicarColumnasTerritoriales(cfg, { incluirTextoResidencia: true }); // Asistentes
```

**Si las banderas no llegan, no se oculta nada.** Una página en caché contra
un servidor que aún no las manda recibe `undefined`, y eso cuenta como «sí
hay datos». Importa por el orden en que viaja un parche: el HTML puede llegar
antes que el backend. Lo mismo si la consulta falla — `territorios` es una
vista sobre **otra base**, y ahí el endpoint responde las seis en `true`.

**Cómo quedó cada campaña**, con las banderas reales pasadas por el ayudante
real:

| | Municipal | Departamental | Plantilla |
|---|---|---|---|
| Votantes/Estructura · Comuna | se ve | **oculta** | oculta |
| Votantes/Estructura · Barrio | se ve | **se ve** | oculta |
| Encabezados | «Comuna / Corregimiento» · «Barrio / Vereda» | «Corregimiento» · «Barrio / Vereda» | «Corregimiento» · «Vereda» |
| Asistentes · Barrio | se ve | **se ve** (por el texto) | oculta |
| Tablero · tarjetas | las dos | solo la de barrio | ninguna |

Probado con 10 casos sobre el archivo real cargado en un DOM mínimo (no hay
navegador en este servidor), más la simulación de punta a punta de la tabla
de arriba. Costo de las seis banderas: **10 ms**, y no crece con el catálogo.

**Lo que NO se tocó:** las exportaciones a Excel, Word y PDF siguen sacando
las columnas siempre. Es defendible —un archivo se guarda y se revisa
aparte— pero conviene saberlo.

### z) El ojo para ver la contraseña (8 de agosto, noche)

Pedido: que todos los campos de contraseña se puedan mostrar u ocultar.

**El inventario cambió dónde convenía escribirlo.** Son **siete campos en
cuatro archivos**, y uno vale por diez:

| Dónde | Campos |
|---|---|
| `login.html` | contraseña de ingreso |
| `reset-password.html` | nueva y confirmación |
| `configuracion.html` | crear/editar usuario |
| `js/common.js` | modal de **contraseña de administrador** —lo abren **10 pantallas**— y el de «actualice su contraseña» (actual + nueva) |

La app móvil no tiene ninguno: usa el mismo `login.html`. Y no hay ningún
`prompt()` pidiendo contraseña, que sería el único caso sin arreglo posible.

Por eso el código vive **dentro de `common.js`** y no en un archivo aparte:
las cuatro páginas ya lo cargan y ahí ya nacen tres de los siete campos. Un
archivo nuevo habría obligado a agregar la etiqueta `<script>` en las doce
pantallas que pueden abrir un modal, sin ganar nada.

`activarVerContrasena(raiz)` envuelve cada `input[type="password"]` y le pega
un botón con el ojo (SVG en línea, sin dependencias). Corre sola al cargar la
página y `common.js` la llama después de insertar cada modal, porque esos
campos no existen todavía cuando la página carga.

**Dónde va el ojo: DENTRO del campo, pegado a su borde derecho.** Hubo una
versión intermedia que lo ponía *al lado* (fuera, con `flex`) y en pantalla
quedó mal: el campo encogido y el botón enorme. No pude reproducirlo —no hay
navegador utilizable en el servidor— así que la corrección no fue afinar ese
diseño sino cambiarlo por uno que **no puede** deformar la fila: el botón va
`position: absolute`, o sea **fuera del flujo**, y el campo conserva intacto
su `width: 100%`. Lo único que se le agrega es `padding-right` para que el
texto no pase por debajo del ojo, y eso cabe dentro del ancho porque las dos
aplicaciones tienen `* { box-sizing: border-box }` — comprobado.

**Cuatro detalles más que no son adorno:**

- **`type="button"` en el botón.** Sin eso, un `<button>` dentro de un
  `<form>` lo **envía**: mirar la contraseña intentaría iniciar sesión.
- **`::-ms-reveal { display: none }`.** Edge dibuja su propio ojo dentro del
  campo; sin apagarlo quedarían dos, uno al lado del otro.
- **El foco vuelve al campo con el cursor al final.** Si no, hay que volver a
  hacer clic para seguir escribiendo.
- **`data-ojo` marca lo ya tratado**, así que llamarla dos veces sobre el
  mismo campo no deja dos ojos. Probado.

**También se hizo en el servidor de licencias** (`public/js/comun.js` y
`public/css/estilos.css`): 4 campos en `login.html` y `mi-cuenta.html`, las
dos cargan ese archivo.

> **Las dos funciones son gemelas y hoy son idénticas byte a byte.** Son
> aplicaciones distintas y no comparten archivos. **Si se toca una, tocar la
> otra** — es la misma regla que `CLAUDE.md` impone a `ctc_normalizar()` y
> `normalizar()`, y por el mismo motivo: dos copias divergen solas.

**Probado con 14 casos por aplicación**, sobre los archivos reales cargados en
un DOM de juguete escrito para esto (aquí no hay navegador): que envuelve el
campo, que el botón no envía el formulario, que alterna en los dos sentidos,
que no pierde lo escrito, que devuelve el foco, que no duplica el ojo al
llamarla dos veces, que no toca los campos que no son contraseña, y que
funciona sobre un campo creado después.

**Lo que NO se pudo comprobar aquí: cómo se ve.** Eso hay que mirarlo en
pantalla.

Una falsa alarma que valió la pena revisar: `login.html` menciona
`common.js` dos veces y estas líneas declaran `const` a nivel global — dos
etiquetas `<script>` habrían roto la página entera con «ya fue declarado».
La segunda mención resultó ser un comentario, y ninguna página lo carga dos
veces.

### aa) Las variables de entorno, en el manual (8 de agosto, noche)

El manual de instalación de `ayuda.html` documentaba **cinco** variables y la
aplicación lee **veinticuatro**. Ahora están todas, sacadas del código y no de
un `.env` de ejemplo: se listaron con
`grep -rhoP 'process\.env\.\K[A-Z0-9_]+'` y se cotejaron una por una contra
lo escrito.

Quedan fuera a propósito las siete de **Twilio y SendGrid**, y el manual dice
por qué: se configuran dentro de la aplicación, en *Configuración → Configurar
CRM*, y el `.env` solo se mira si esa pantalla está vacía. Es la confusión que
costó horas el 7 de agosto.

De paso salieron **dos cosas que el manual decía mal o no decía**:

- **`NODE_ENV=production` no estaba, y decide si la cookie de sesión lleva la
  marca de segura** (`app.js`: `secure: process.env.NODE_ENV === 'production'`).
  Verificado que las cuatro instalaciones la tienen; sin ella la sesión viaja
  sin esa protección y nada avisa.
- **El paso 4 decía que `init-db` «te pide crear el primer usuario
  administrador». No pide nada.** Si no hay `ADMIN_EMAIL` y `ADMIN_PASSWORD`
  en el `.env`, crea `admin@campana.local` con una contraseña escrita en el
  código —la misma en toda instalación nueva—, marcada para cambiarse en el
  primer ingreso. Corregido, con el aviso de poner las dos variables antes de
  correr ese paso.

También se documentaron tres trampas del `.env` que ya habían costado tiempo:
la del `#` (que ya estaba) más la de las comillas, la de que **una variable
repetida gana la última sin avisar**, y que `pm2 restart` no relee el archivo.

### bb) La app no dejaba cerrar sesión (8 de agosto, noche)

Reportado como «no deja cerrar sesión». El registro de accesos lo contaba
entero:

```
20:35:13  POST /api/auth/logout          200
20:35:13  GET  /api/auth/me  (login)     304
20:35:14  GET  /api/auth/me  (dashboard) 304   <- ya está dentro otra vez
20:35:15  POST /api/auth/logout          200   <- lo intenta de nuevo
```

**El cierre funcionaba.** Lo que fallaba es que la sesión **revivía sola un
segundo después**.

**Por qué.** `api()` manda el **token de dispositivo** (`X-Device-Token`) en
cada solicitud, y `resolverUsuario()` en `middleware/auth.js` reconstruye
`req.session.usuario` a partir de él — que es justo para lo que se hizo:
cambiar de cuenta en un celular compartido sin conexión. El cierre de sesión
del encabezado de escritorio borraba `app_usuario_verificado`, pero **no
dejaba de haber una cuenta activa**, así que el token seguía viajando y el
servidor rehacía la sesión que acababa de destruir.

Comprobado, no deducido: firmando un token válido y llamando sin ninguna
cookie, `GET /api/auth/me` responde **200 y devuelve al usuario**.

**La app móvil ya lo hacía bien** — `desactivarCuentaDispositivo()` en
`app/inicio.html` y en `app/dia-d.html`—; al encabezado de escritorio, que es
el de las 24 pantallas, le faltaba. No es un fallo de lo de hoy: viene desde
que existe el token de dispositivo.

Corregido en `public/js/common.js`, con dos cambios:

1. Se deja de tener cuenta activa. **La cuenta no se «olvida»**: sigue en el
   selector de `login.html` para volver a entrar, que es el comportamiento de
   la app móvil.
2. La llamada a `/auth/logout` va dentro de un `try/catch`: si no hay señal,
   igual se cierra del lado del navegador. Quedarse dentro porque falló la red
   es lo contrario de lo que la persona pidió.

Las 24 pantallas de escritorio **no cargan** `cuentas-dispositivo.js`, así que
no se puede llamar a la función compartida: hay un respaldo que borra la clave
directamente. El nombre de esa clave ya estaba repetido en el mismo archivo
(`obtenerTokenDispositivoActivo`), y queda dicho que si cambia, cambian los dos
sitios.

**Las dos campañas tienen el mismo fallo**, porque corren el mismo código. Se
arregla con el parche 12, que ya llevaba `common.js`: la lista de archivos no
cambia.

### cc) Seis mejoras al CRM y Mensajes (9 de agosto de 2026)

Pedidas de corrido tras preguntar «qué más le podemos integrar». En orden:

**1 · Baja de contacto — la otra mitad del consentimiento.** La app pide
autorización al registrar (Ley 1581 de 2012, desde julio) y esa autorización
es revocable; hasta ahora **no había forma de revocarla**: quien respondía
«BAJA» seguía recibiendo mensajes. Columnas `no_contactar`,
`no_contactar_fecha` y `no_contactar_origen` en `votantes` y `usuarios`; el
CRM los excluye del envío pero **los cuenta aparte** en vez de esconderlos
—si desaparecieran, el total bajaría sin explicación y alguien los agregaría
otra vez a mano— y hay un estado nuevo `dado_de_baja`, separado de «fallido»
por la misma razón que ya existía `sin_lugar_votacion`.

**Se marca a la persona, no al número:** un teléfono se comparte en una
familia, así que se marcan todas las fichas que coincidan.

**2 · Respuestas entrantes.** Twilio solo tenía configurado el webhook de
*estado*; lo que la gente contestaba no llegaba a ninguna parte. Nuevo
`POST /webhooks/twilio/entrante` (misma validación de firma que el otro),
tabla `comunicaciones_respuestas`, y una bandeja arriba en CRM y Mensajes.
A un mensaje normal **no** se le responde automáticamente: sería escribirle
a alguien que no lo pidió.

> **Una prueba encontró lo que una revisión no vio.** La primera versión
> comparaba con `includes`, y «estoy **traba ja**ndo» contiene «baja»:
> cualquiera que respondiera eso quedaba dado de baja en silencio. Ahora la
> comparación es por palabra completa, y hay un caso de prueba dedicado.

**3 · Contador de SMS** (`public/js/segmentos-sms.js`). Un SMS se cobra por
**segmento**, y el alfabeto decide el tamaño: sin tildes 160 caracteres, con
una sola tilde **70**. Un mensaje de 111 caracteres es 1 SMS sin tildes y 2
con ellas — con 332 destinatarios, 332 contra 664 mensajes facturados.

> Dato útil y contraintuitivo, medido con las 11 pruebas: **la `ñ` NO
> encarece** (está en GSM-7, junto a `äöñüà`); la que rompe es la **á**. O
> sea que «España» sale barato y «votación», caro.

**4 · Resumen de entrega por campaña** y botón para **reintentar solo los
fallidos** — no los «sin contacto» ni los dados de baja, que no fallaron.

**5 · Programación de envíos.** Columna `programado_para` y un despachador
que corre al arrancar y cada minuto; el `UPDATE` a 'enviando' hace de
candado, así que dos ciclos solapados no envían dos veces.

> **El servidor está en UTC y quien programa está en Colombia.** Mandar
> «07:00» tal cual habría hecho salir el mensaje a las 2 de la mañana. La
> conversión se hace en el navegador, que es donde se sabe el huso.

**6 · Plantillas** reutilizables. Guardar con un nombre que ya existe
**corrige** la plantilla en vez de fallar: quien repite el nombre está
corrigiendo, no creando otra.

> **Dónde están, porque cuestan de encontrar.** Solo en **CRM y Mensajes**,
> paso *3. Escribe el mensaje*: un desplegable «Plantillas guardadas…»
> encima del cuadro de texto. **No hay menú ni sección llamada
> «Plantillas»**, así que quien las busque por su nombre en la navegación no
> las va a ver.
>
> **En «Enviar SMS» NO están, y se decidió dejarlo así** (9 de agosto de
> 2026). Esta sección dice que el parche 14 tocó `enviar-sms.html`, pero lo
> que llegó ahí fue el contador de segmentos; el desplegable se quedó solo
> en el CRM. Lo único que hay en esa pantalla es el botón fijo «Insertar
> mensaje de Día D», que escribe un texto quemado en el código — no es una
> plantilla guardada.
>
> Se propuso llevarlas allá y, de paso, **filtrar el desplegable por canal**
> (hoy muestra las 10 mezcladas, así que en un envío de SMS aparecen las 4
> de correo, que llevan tildes y saldrían a 3 segmentos). **El usuario dijo
> que no.** Es una decisión tomada, no un pendiente: no volver a
> «arreglarlo» sin preguntar.
>
> Verificado el mismo día: las 10 están en las dos campañas y el endpoint
> las devuelve completas a admin, coordinador y líder; sublíder y testigo
> reciben 403, que es lo correcto porque no entran al CRM.
>
> **Y estaban rotas desde el parche 14 — corregido el 9 de agosto.**
> `crm.html` **llamaba a `escaparHtml()` sin tenerla definida**. La línea
> que arma las opciones lanzaba `ReferenceError: escaparHtml is not
> defined`, `sel.innerHTML` no se asignaba nunca y el desplegable se
> quedaba con su texto de ayuda: **igual que si no hubiera ninguna
> plantilla**. El `try/catch` de `cargarPlantillas()` solo envuelve la
> llamada al servidor, no el pintado, así que el fallo moría en la consola
> del navegador sin que nada avisara.
>
> **La bandeja de respuestas fallaba por lo mismo**: sus dos usos de
> `escaparHtml` están en el mismo archivo.
>
> **Por qué no se detectó antes, y es la lección.** Se verificó lo que se
> podía alcanzar desde el servidor —10 filas en la base, y el endpoint
> devolviendo las 10 a admin, coordinador y líder— y **todo daba bien**. El
> fallo estaba en la única capa que no se probó: el pintado en el
> navegador. Aquí no hay navegador, así que se reprodujo cargando la línea
> real en un DOM de juguete, y **hay que modelar el fallo de verdad**: la
> primera versión del banco declaraba `const escaparHtml = undefined` y
> daba `TypeError`, no el `ReferenceError` de un identificador que no
> existe. Cinco casos, incluido que escapa `<script>`.
>
> **`escaparHtml` está copiada en cada pantalla** (`testigos.html`,
> `dia-d.html`, `asistentes-reuniones.html`, `app/dia-d.html`,
> `contenido.html`, `votantes-dashboard.html`) porque no comparten archivo;
> la que se agregó a `crm.html` es **idéntica byte a byte** a las tres
> primeras. `configuracion.html` es la excepción y está bien: usa
> `escaparHtmlDiaD`, que sí define — un `grep` de `function escaparHtml`
> la da por buena por el prefijo, así que **contar llamadas, no
> definiciones**. Y `contenido.html` no lleva la guarda de nulos: pinta
> `undefined` en vez de vacío. Menor, pero está dicho.
>
> Auditado el proyecto entero después del arreglo: **ninguna pantalla llama
> a `escaparHtml` sin definirla**.

**Probado con 33 casos** contra el servidor en marcha: 11 del webhook
(incluida firma inválida rechazada), 4 de que el CRM respeta la baja, 4 de la
bandeja, 11 del contador de SMS, 9 del resumen, 4 del despachador y 5 de las
plantillas. El reintento de fallidos se probó **solo por el camino sin
fallidos**, a propósito: el camino completo dispara envíos reales y no se
prueba con la cuenta de Twilio de un cliente.

**Migraciones aplicadas SOLO en electoral**; las campañas las reciben con el
parche. Corridas dos veces seguidas: 87 pasos idempotentes, 0 errores.

### dd) Ninguna dependencia nueva podía viajar en un parche (9 de agosto)

Apareció al empezar las notificaciones push, que necesitan la librería
`web-push`. **El actualizador nunca corría `npm install`**: descomprime,
corre `init-db` si el parche lo pide, y reinicia. Un parche con una
dependencia nueva habría dejado a las dos campañas arrancando con
`Cannot find module` — caídas hasta que alguien entrara por SSH.

No es un problema de push. **Es del mecanismo de parches**, y llevaba
catorce parches sin notarse porque en ninguno se agregó una dependencia.

Corregido en `scripts/actualizar-automatico.js`:

- Antes de descomprimir, se mira el **listado del zip** para saber si trae
  `package.json`. Después de descomprimir ya no se sabría si el archivo del
  disco es el del parche o el que ya estaba.
- Si lo trae, corre `npm install --omit=dev` **antes del reinicio**. Si esa
  instalación falla, se lanza el error y **no se reinicia**: el proceso
  viejo sigue en pie con el código que ya tenía en memoria, en vez de
  reiniciarse contra archivos a los que les falta una librería.
- Corre con el usuario que lanzó el actualizador, que es el dueño del
  sitio. Correr `npm install` con otro usuario deja archivos ilegibles para
  la aplicación — ya tumbó licencias con un 502.

Probado con zips construidos para eso (uno con `package.json` y otro sin) y
contra los parches 12, 13 y 14 ya publicados: **ninguno** dispararía la
instalación, que es lo correcto.

**El orden importa y hay que respetarlo:** este arreglo tiene que llegar a
las campañas **en un parche que NO agregue dependencias** (el 15). Solo
después puede viajar uno que traiga `web-push`. Al revés, el parche que
agrega la dependencia sería aplicado por el actualizador viejo — el que no
sabe instalarla.

### Estado del plan de push

- **Bloque 0** (este) — hecho en electoral, falta el parche 15.
- **Bloque 1** — tabla `push_suscripciones` creada. Las llaves VAPID se
  generan con el `crypto` de Node, sin librería (probado: 87 y 43
  caracteres, el formato correcto). Falta `web-push`, que es lo único que
  necesita la dependencia: el envío cifrado.
- **Bloque 2** — hecho. `public/service-worker.js` con las escuchas `push` y
  `notificationclick`. Sobrevive a un aviso con contenido vacío (si reventara
  ahí, el navegador mostraría una notificación genérica del sistema, peor que
  un mensaje propio); usa `tag` para que un aviso reemplace al anterior en vez
  de apilarse; y al tocarlo trae al frente una ventana ya abierta en lugar de
  abrir otra. Probado con 7 casos sobre el archivo real con un `self` de
  mentira. **No hay que tocar `CACHE_NAME`**: el navegador reinstala el
  service worker por sus propios bytes.
- **Bloque 3** — hecho. `routes/push.routes.js` (archivo aparte **a
  propósito**: `comunicaciones.routes.js` excluye a testigos y sublíderes, que
  son los que más van a usar los avisos) y `public/js/avisos-push.js` montado
  en `app/inicio.html`. La suscripción se actualiza y **se reasigna** al
  usuario en sesión —en campaña se prestan los teléfonos—, y desuscribir borra
  **por dispositivo**, no por persona. El interruptor tiene **tres estados**:
  el tercero es «bloqueado», porque un navegador donde ya se dijo que no no
  vuelve a preguntar y un control que no responde parece una app rota.
  Llaves VAPID generadas en el `.env` de electoral.
- **Bloque 4** — hecho en electoral (9 de agosto). Ver el punto 4.hh.

**Incidente del 9 de agosto:** se hizo el ciclo completo de PM2 en electoral
con `pm2 start ecosystem.config.js`, y **ese archivo no existe aquí** — es la
convención de territorios, no de esta app. El `delete` funcionó y el `start`
falló: electoral quedó caída cerca de un minuto. Se levantó con
`pm2 start app.js --name campana-app` y se comprobó que el `dump.pm2` NO
quedó vacío (si lo hubiera quedado, un reinicio del VPS no la reviviría).
**En electoral el ciclo correcto es `pm2 start app.js --name campana-app`.**

### ee) WhatsApp fuera (9 de agosto) — pendiente 0a, hecho en electoral

Meta prohíbe las campañas políticas en su API de negocios, así que el canal
salía caro de dos formas: por el riesgo de perder la cuenta y por ofrecer en
pantalla algo que no se debía usar.

**Media tarea ya estaba hecha y no estaba registrada.** La interfaz del CRM
**ya no ofrecía WhatsApp**: los chips de canal de `crm.html` son solo Email y
SMS, `ETIQUETAS_CANAL` no lo incluía, y `enviar-whatsapp.html` estaba en
`archivo-paginas-eliminadas/` **sin que nadie la enlazara**. Debió irse con la
reescritura del CRM del parche 14, sin quedar anotado.

**Pero el servidor sí lo aceptaba, y eso es lo que se cerró.** Un `POST` a
`/api/comunicaciones/campanas` con `canal: 'whatsapp'` pasaba la validación y
llegaba a `enviarWhatsApp`. La pantalla no lo ofrecía; la puerta seguía
abierta — y una pantalla se salta llamando a la API directo.

**El inventario del documento estaba corto: decía ocho archivos, son
catorce.** Y de los que no listaba, dos **había que proteger**, no tocar:

- `public/app/mis-registros.html` — el botón «Escribir por WhatsApp» es un
  enlace `wa.me` para que un líder escriba **desde su propio celular**. Nada
  que ver con la API de Meta, y es justo lo que hay que conservar.
- `db/init-db.js` — el texto de la política de tratamiento de datos (Ley
  1581) declara WhatsApp como medio de contacto. **Sigue siendo cierto** por
  lo anterior; quitarlo sería declarar menos de lo que la campaña hace.

Medido en las tres bases antes de tocar nada: **cero campañas, cero envíos y
cero respuestas** por WhatsApp, y `twilio_whatsapp_from` **vacío en las dos
campañas**. El canal nunca estuvo configurado — no hay nada que preservar.

Se apagó, no se arrancó. Ocho archivos:

| Archivo | Qué |
|---|---|
| `routes/comunicaciones.routes.js` | `whatsapp` sale de los canales válidos con un 400 que dice el motivo; se va la rama de envío y deja de anunciarse en `/estado-canales` |
| `config/twilio.js` | `enviarWhatsApp` **deja de exportarse** (sigue en el archivo, inalcanzable) y el canal sale de `estadoCanales()` |
| `routes/configuracion.routes.js` | `twilio_whatsapp_from` deja de leerse del body y de devolverse; el valor guardado se conserva |
| `public/configurar-crm.html` | Se va el campo «Número de WhatsApp» |
| `public/crm.html` · `ayuda.html` · `organigrama.html` · `app.js` | Restos inertes y textos que ofrecían un canal que ya no existe |

**Lo que NO se tocó, a propósito:** los `ENUM` de la base, la clasificación
de respuestas entrantes de `webhooks.routes.js` (es historia), `social.html`
(compartir una pieza desde el celular), y las dos cosas de arriba. Volver a
encenderlo, si Meta cambia de política, es devolver `'whatsapp'` a la lista
de canales válidos y a `module.exports` de `twilio.js` — está escrito en los
dos archivos.

**Dos detalles que no son cosméticos:**

- **Los adjuntos eran exclusivos de WhatsApp**, así que hoy no los admite
  ningún canal. El mensaje de error habría quedado mintiendo («solo están
  disponibles para el canal WhatsApp»).
- **Un adjunto rechazado dejaba basura en `uploads/`.** `multer` escribe el
  archivo en disco **antes** de que corra la validación, así que ahora se
  borra al rechazarlo. Antes pasaba igual, pero era una rama rara; con
  WhatsApp fuera sería el único camino, y cualquiera podría llenar el disco
  a punta de intentos.

**Probado con 7 casos** montando el router real en un puerto aparte con una
sesión falsa de administrador (`probar-whatsapp-cerrado.js`, en el
scratchpad): `whatsapp` rechazado con su motivo, `WHATSAPP` en mayúsculas
**no se cuela**, un canal inventado sigue dando «no válido», los tres canales
buenos pasan la validación, y `/estado-canales` ya no lo anuncia. Ninguno
envía nada: todos mueren en la validación de entrada.

**Falta que viaje a las campañas** en el parche 15.

### ff) La meta del Coordinador Organizaciones se calcula sola (9 de agosto) — pendiente 0b, hecho en electoral

Antes, ese cargo tenía un «piso» manual (`meta_votos_base`) y el servidor
guardaba en `meta_votos` el piso **más** la suma de sus gremiales. Ahora la
meta se **deriva al leer**, igual que la del Coordinador: no se guarda, no se
teclea, no se puede inflar.

**El número guardado ya estaba rancio, y así se descubrió el porqué del
cambio.** La única persona con ese cargo —Pedro Nel Sánchez, la misma en las
dos campañas— tenía **1150** guardados con un piso de **1000** y **cero**
gremiales. Sobraban 150 de un estado anterior: sin error, sin aviso, y sin
forma de notarlo mirando la pantalla. Eso es lo que pasa con un número
derivado que se guarda: son dos fuentes de verdad para el mismo dato y se
separan solas.

También quedó medido que **la suma nunca se había ejercitado**: hay **cero**
personas con tipo de cargo gremial en las dos campañas.

**Decisión del usuario sobre los pisos ya guardados: ignorarlos.** La columna
se deja intacta pero no se lee para este cargo. El 1000 de Pedro Nel era dato
de prueba, y un Coordinador Organizaciones sin gremiales ahora muestra 0 —
exactamente como un Coordinador sin líderes.

**Una sola copia de la regla, y por eso hay archivo nuevo.** La fórmula del
Coordinador estaba escrita **tres veces** (`territorial.routes.js` y dos en
`dashboard.routes.js`); agregar la rama nueva la habría dejado en seis. Vive
ahora en `config/metasEstructura.js`, que exporta `sqlMetaEfectiva(alias)` y
la usan los cuatro sitios de lectura. Es la misma regla que `CLAUDE.md`
impone a `ctc_normalizar()`/`normalizar()`, y el síntoma de dejarla dividida
sería que el tablero y el listado muestran metas distintas para la misma
persona.

Archivos: `config/metasEstructura.js` (nuevo), `routes/territorial.routes.js`,
`routes/dashboard.routes.js`, `public/territorial.html`.

**Cómo se probó, que es donde estaba el riesgo:**

- **Cero regresiones, medido fila por fila.** Se corrió la expresión **vieja**
  contra la **nueva** sobre todas las filas de las dos campañas: difieren en
  **exactamente una** en cada base, y es Pedro Nel (1150 → 0). Los 8 y 15
  Coordinadores, y todos los demás cargos, dan idéntico.
- **La rama nueva se probó sin escribir nada.** Como no hay gremiales, se
  corrió la misma expresión sustituyendo la lista de tipos por los que sí
  existen en los datos (`presidente_jac`, `aspirante_jal`,
  `aspirante_concejo`): el resultado coincide con la suma hecha a mano en los
  tres supervisores reales.
- **Las cuatro consultas completas corren**, no solo el fragmento: listado de
  Estructura, exportación a Excel y los dos endpoints del tablero, montados
  en un puerto aparte con sesión falsa de administrador
  (`probar-metas.js`). Un fragmento válido puede romper la consulta que lo
  embebe.

**Tres cosas que cambian y conviene saber:**

- **Los inactivos ya no suman.** La rama de gremiales lleva `activo = 1`, que
  la versión vieja no tenía. Es lo que ya hacía el Coordinador con sus
  líderes; dejarlo distinto habría sido una diferencia sin razón.
- **La exportación a Excel cambió dos columnas.** «Meta votos» va **vacía**
  para los dos cargos de coordinación —no tienen número propio, y exportar
  uno invita a reimportarlo como si contara— y la columna informativa pasó a
  llamarse «Meta de votos (total del equipo)», porque ya no es solo de
  gremiales. La reimportación no lee ninguna de las dos, así que no se rompe.
- **La lista de cargos derivados está en dos sitios** —`CARGOS_CON_META_DERIVADA`
  en el módulo y `CARGOS_META_DERIVADA` en `territorial.html`— porque el
  navegador no carga módulos de Node. Está dicho en los dos: si se agrega un
  cargo en uno, agregarlo en el otro, o la pantalla ofrecería un campo
  editable que el servidor ignora.

**Falta que viaje a las campañas** en el parche 15.

### gg) El parche 15 tumbó las dos campañas (9 de agosto) — LEER ANTES DEL 16

**Un `require` a un archivo que el parche no llevaba.** `app.js` entró en el
parche 15 porque se le cambió un comentario de WhatsApp. Pero `app.js` tiene:

```js
app.use('/api/push', require('./routes/push.routes'));
```

…y los **cuatro archivos de push se excluyeron del parche a propósito**,
porque los avisos no funcionan hasta el bloque 4. Las dos campañas quedaron
con un `app.js` que pide un módulo inexistente:

```
Error: Cannot find module './routes/push.routes'
```

PM2 reintentó, agotó los intentos y las dejó **apagadas**. El actualizador
había reportado *«Parche #15 aplicado correctamente»*, y los 15 archivos
**sí** estaban idénticos a electoral: la comparación con `cmp` daba 15 de 15.
Lo que falta no se ve comparando lo que llegó.

**La comprobación que lo habría atrapado no existía, y toma tres segundos:**

```bash
# Todo require local de los archivos del parche debe existir en la campaña
grep -oP "require\('\./\K[^']+" app.js | while read m; do
  [ -f "$D/$m" ] || [ -f "$D/$m.js" ] || echo "FALTA $m"
done
```

**Regla nueva, y es hermana de la del `npm install` (punto 4.dd):** un parche
no solo tiene que traer los archivos que cambiaron, sino **todo lo que esos
archivos requieren**. Al excluir algo a propósito, verificar que nadie que
sí viaja lo llame. El mecanismo no lo comprueba.

**Por qué no se pudo arreglar por parche.** El endpoint que dispara la
actualización, `POST /actualizador/ejecutar`, **lo sirve la aplicación que
está caída**. Con las campañas abajo, el mecanismo de parches no existe. Es
un punto ciego del diseño: todo arreglo de algo que impide arrancar hay que
aplicarlo a mano.

**Y a mano tampoco alcanza del todo desde esta cuenta.** `gariasappelectoral`
puede escribir en `htdocs` de las campañas (hay ACL), pero **no** en su
`~/.pm2` (`drwxrwx---`, sin ACL, y no está en esos grupos), no tiene SSH a
esos usuarios, y su único `sudo` es `clpctlWrapper`, que no trae subcomandos
de Node ni de PM2. **Reiniciar PM2 de una campaña exige al usuario.**

Lo que se hizo:

1. Copiar `routes/push.routes.js` a las dos (solo necesita `express`, el
   pool y el middleware — **no** `web-push`, así que no rompe el orden que
   protegía al parche 15; la tabla `push_suscripciones` ya la creó la
   migración).
2. **`chmod o+r`**: el archivo copiado quedó a nombre de
   `gariasappelectoral` con `other::---` y el usuario del sitio no lo podía
   leer. Los hermanos tienen `other::r--`. Es la misma trampa del 502 de
   licencias, otra vez.
3. Como el reinicio de PM2 no se podía hacer, se levantaron las dos **a mano
   y fuera de PM2** (`setsid nohup node app.js`, con `umask 022` para que lo
   que escriban quede legible para el usuario real). Con eso el 502 se fue.

**Ese arranque provisional NO era el estado bueno:** corría con el usuario
equivocado y **sin PM2**, así que no se reiniciaba solo si moría ni
sobrevivía a un reinicio del VPS. Y **hubo que matarlo antes** del
`pm2 restart`, o PM2 falla con `EADDRINUSE` sin explicar por qué. Ya está
resuelto: ver «Parche 16» más abajo.

**Cuánto duró.** El parche 15 se aplicó a las 05:11 y las dos campañas
quedaron caídas; el arranque provisional las levantó a los pocos minutos y el
estado bueno se restableció con el reinicio de PM2. La causa no fue el
contenido del parche —los 15 archivos eran correctos— sino **lo que no
llevaba**.

### Parche 16 — aplicado, y con eso el incidente cerrado

Dos archivos: `routes/push.routes.js` y `db/init-db.js`. Registrado como
`id = 17`, aplicado en las dos campañas. **Todo verificado en su orden.**

Se generó y registró **sin habilitar**, a propósito, y solo se habilitó
después del reinicio de PM2. Con las campañas fuera de PM2 el actualizador
habría escrito los archivos con el dueño equivocado y su `pm2 restart` no
habría encontrado el proceso; y habilitarlo antes hubiera dejado que **el
cron de las 3 a.m. lo aplicara solo**, chocando con `EADDRINUSE` contra el
arranque provisional.

Estado final, medido: las tres responden 200, las dos campañas en **parche
16** y bajo PM2 con su propio usuario, `push.routes.js` de vuelta a nombre
del usuario del sitio en las dos, **10 plantillas** en cada una, y los datos
donde estaban (86/53/62 en la municipal, 82/52/53 en la departamental, cero
bajas accidentales). `verificar-requires.js` da **TODO RESUELVE** en ambas.

**El reinicio de PM2 dejó dos cosas que conviene saber:**

- **`su -` con guion no basta en la departamental.** En la municipal
  `pm2 restart` funcionó de una; en la departamental salió
  `pm2: command not found` incluso con shell de login. Su perfil no carga
  `nvm`. Lo que sí funciona:

  ```bash
  su - campanadepruebadepartamental -c 'export PATH="$(ls -d ~/.nvm/versions/node/*/bin | tail -1):$PATH"; pm2 restart campana-app-departamental && pm2 save'
  ```

  Vale la pena arreglarle el perfil: quien tenga que levantarla de urgencia
  no va a adivinar esto. (Y **cada campaña tiene su propia versión de node**:
  la departamental corre en v24.19.0, no en la v22 de electoral.)
- **`pm2 save` no es opcional.** Sin él, el `@reboot pm2 resurrect` del
  crontab revive el estado anterior y las campañas volverían a quedar
  caídas en el próximo reinicio del VPS.

**Los tres archivos de push de la interfaz siguen fuera** —`inicio.html`,
`avisos-push.js`, `service-worker.js`—, por la razón de siempre: sin el
bloque 4 nadie recibiría un aviso, y un interruptor que promete algo que no
llega es peor que no tenerlo. Solo viaja `push.routes.js`, que es lo que
`app.js` necesita para arrancar.

**La plantilla que faltaba, arreglada.** Llegaban **9 de 10**: la de correo
«Invitación a evento» chocaba con la de SMS «Invitacion a evento» porque
`utf8mb4_0900_ai_ci` **ignora las tildes** (regla 7 de `CLAUDE.md`), y el
`INSERT IGNORE` la descartaba sin decir nada. El hueco se veía en los `id`.
Ahora la de correo se llama **«Invitación a evento (correo)»**. Verificado en
electoral: 10 de 10, y **10 tras correr la migración dos veces**. Se
comprobaron además los 45 pares de nombres **con la colación real de la
base**, no a ojo: cero colisiones.

### La herramienta que habría evitado todo esto

`scripts/verificar-requires.js` — comprueba que todo `require()` local de los
archivos de un parche exista en la instalación de destino.

```bash
node scripts/verificar-requires.js parches/campana-parche16.zip \
     /home/campanadepruebamunicipal/htdocs/campanadepruebamunicipal.appestrategia.net
```

Probado contra el escenario real: con una copia del proyecto **sin**
`routes/push.routes.js`, señala el parche 15 con una sola línea —
`FALTA app.js -> require('./routes/push.routes')`.

**Es estático a propósito, y esa decisión salió de un error cometido al
escribirlo.** La primera versión comprobaba «¿carga el módulo?» con
`require`, y `db/init-db.js` **ejecuta la migración al importarse** — así
que la comprobación corrió la migración contra las dos campañas. No hubo
daño (es idempotente y ya estaba aplicada: 82 votantes, 52 usuarios y 53
filas de estructura, exactamente las del respaldo previo), pero el
documento ya advertía justo eso y aun así pasó. Hoy solo lee el texto.

Segundo tropiezo, también útil: la primera versión buscaba `require(` sin
quitar los comentarios, y **se acusaba a sí misma** — su cabecera cita
`require('./routes/push.routes')` para explicar por qué existe.

Al barrer el proyecto entero queda **un** hallazgo real y conocido:
`scripts/calibrar_cohortes.js` pide `../lib/cedulaCrypto`, que no existe
aquí (punto 4.v: ese script quedó sin usar a propósito).

Como `verificar-html.py`, es herramienta de desarrollo: **no incluirla en
los parches**.

### hh) Push, bloque 4: el envío (9 de agosto) — hecho en electoral

`web-push` **3.6.7** instalado, `config/push.js` nuevo, y Push agregado como
canal del CRM. Con esto los avisos funcionan de punta a punta.

**El hallazgo que cambió el diseño: push no llega al electorado, llega al
equipo.** La suscripción cuelga de `usuarios.id` y el interruptor solo existe
en `app/inicio.html`, así que solo puede recibir un aviso quien **tenga
cuenta**. Medido en las dos campañas: 53 y 52 cuentas frente a 86 y 82
votantes, y esas cuentas son 36 líderes, 9 coordinadores, 5 sublíderes, un
admin y un testigo. La nota original decía que el envío «vive en el canal del
CRM» — y el CRM apunta a votantes por territorio e intención de voto. Una
campaña de push contra votantes habría reportado casi el 100% «sin contacto».

**Decisión del usuario: canal del CRM, pero acotado.** Push reaprovecha todo
lo del parche 14 (registro de campaña, resumen de entrega, programación,
plantillas, respeto a la baja), y el servidor **rechaza** el envío si el
origen no es `estructura` o `testigos`. Probado: los tres orígenes que no
sirven se rechazan con un mensaje que explica por qué, y los dos que sirven
pasan.

**Organigrama tampoco puede, y no estaba previsto.** El plan aprobado decía
«Estructura, Testigos u Organigrama»; al mirarlo, `organigrama_nodos` es una
tabla aparte **sin `usuario_id`** — sus cargos no son cuentas. Quedó fuera.

**El error que casi se cuela, y es del tipo caro.** Los destinatarios de
estructura viajaban con `id: f.id`, que es el id de la fila de
**`estructura`**, no el de `usuarios`. Mandar el push a ese número lo habría
entregado a **otra persona**: los dos rangos de id se solapan, así que no
habría fallado — habría acertado mal, exactamente como el `territorio_id`
263 que mandó un votante de Manizales a Arcabuco. Ahora `usuario_id` viaja
aparte y está dicho en el código.

**Un dispositivo muerto se borra; uno con error transitorio no.** El servicio
de push responde 404/410 cuando la app se desinstaló o la suscripción caducó:
esa respuesta es definitiva y la fila se elimina. Cualquier otro error (500,
red) conserva la fila. Sin esa distinción la tabla acumularía fantasmas y
cada campaña gastaría envíos en ellos para siempre.

**Probado con 12 casos, sin salir a la red y sin mandarle un aviso a nadie:**
se sustituye `sendNotification` por una función propia, que es lo que permite
provocar un 410 y un 500 a voluntad. Cubre dos dispositivos, el borrado en
410, la conservación en 500, «si uno recibe cuenta como entregado», el aviso
claro cuando no hay dispositivos, y las cinco guardas de origen. Las filas de
prueba se borran en un `finally` **y se comprueba que quedaron en cero**:
`electoraldb` es la plantilla de la que se clonan las campañas, y una fila
olvidada ahí viajaría a todas las campañas nuevas.

**Dos enum ampliados** (`comunicaciones_campanas` y
`comunicaciones_plantillas`). El de `comunicaciones_respuestas` **no**: push
no tiene respuestas. Y `'whatsapp'` se conserva en los enum aunque el canal
esté apagado — quitarlo dejaría a las campañas viejas con un valor que MySQL
no reconoce.

**Ojo con `CREATE TABLE IF NOT EXISTS`:** el de `comunicaciones_plantillas`
solo actúa la primera vez, así que ampliar el ENUM ahí exige un
`modificarColumna` aparte. Sin él, guardar una plantilla de push habría
fallado con *«Data truncated for column 'canal'»* solo en las bases que ya
existían — es decir, en todas menos una nueva.

**Y una trampa de permisos al instalar la dependencia:** `npm install` murió
con `EACCES` sobre `package.json`, que es de `appestrategia-electoral` con
solo lectura para el grupo. Los archivos **sí** se instalaron (falla en el
último paso, al guardar el manifiesto); lo que faltó fue declarar la
dependencia. Se resolvió como manda el propio documento: escribir a un
temporal y `mv`, porque la carpeta sí es escribible. **Declararla no es
opcional** — el actualizador decide si corre `npm install` mirando si el
parche trae `package.json`.

`npm audit`: **web-push no agrega ninguna vulnerabilidad**. Quedan las dos de
siempre — `xlsx` (alta, sin arreglo) y `body-parser` (baja, transitiva de
express, con arreglo disponible pero tocaría express; pendiente aparte).

### Parche 17 — aplicado. El mecanismo de dependencias funcionó

Ocho archivos, incluidos los tres de push de la interfaz (ya no prometen
nada que no llegue) y **`package.json`**, que es lo que dispara la
instalación. Registrado como `id = 18`, aplicado en las dos campañas.

**Era la prueba de fuego del arreglo del punto 4.dd, y pasó.** El registro
de las dos campañas dice *«El parche trae package.json — instalando
dependencias…»*, `web-push` **3.6.7** quedó instalado en las dos **con el
usuario del sitio como dueño** —que era el otro riesgo— y ninguna se cayó.
Antes del 15, este parche habría dejado las dos campañas con
`Cannot find module 'web-push'`.

**Esta vez la comprobación previa se hizo ANTES de generar**, que es lo que
faltó en el 15: `verificar-requires.js` contra las dos campañas, 9 requires,
TODO RESUELVE. De paso hubo que corregir la herramienta — marcaba como
faltantes los archivos que **el propio parche entrega** (`config/push.js` es
nuevo). Ahora un require vale si el destino ya lo tiene **o si el parche se
lo lleva**: lo que importa es cómo queda la instalación después. Un aviso que
grita de más se aprende a ignorar, y ahí es donde se cuela el fallo real.

**Las llaves VAPID no viajan en el parche, y sin ellas el canal no existe.**
Viven en el `.env`, que nunca se empaqueta. Se generó **un par propio para
cada campaña** —igual que `SESSION_SECRET`: compartirlo dejaría que un
servidor firmara avisos para los suscriptores de otra—, verificadas contra
`web-push` (87 y 43 caracteres) y comprobado que **las tres instalaciones
tienen llaves distintas**. Se escribieron antes de aplicar el parche, para
que el reinicio del propio actualizador las tomara.

**El momento importaba:** cambiar las llaves invalida las suscripciones ya
registradas. Había **cero** en las dos, así que era el único momento sin
costo. De aquí en adelante, regenerarlas obliga a que cada persona vuelva a
activar los avisos en su teléfono.

Estado final, medido: las tres responden 200, las dos campañas en **parche
17**, `estadoCanal()` da `configurado: true` en ambas con su propio `.env`,
los tres ENUM como deben (`respuestas` sin push, que no tiene respuestas),
10 plantillas y los datos intactos (86/53 y 82/52).

### ii) Pantalla «Aviso en la app» y plantillas en Enviar SMS (9 de agosto)

Pedido tras ver que push solo existía como canal dentro del CRM. **Decisión
del usuario: pantalla propia**, hermana de Enviar SMS, y **sí llevar las
plantillas a Enviar SMS** (había dicho que no unas horas antes; cambió al
ver la diferencia entre las dos pantallas).

`public/enviar-push.html` sale de `enviar-sms.html` con `CANAL = 'push'`,
más un campo **Título del aviso** —lo único que el teléfono muestra siempre,
el cuerpo lo puede recortar— y **sin el contador de segmentos**: un push no
se cobra por segmento ni lo parte una tilde, así que tampoco carga
`segmentos-sms.js`.

**Dos cosas habrían dejado la pantalla nueva enviando a nadie, en silencio:**

- **La guarda de origen la habría rechazado entera.** Esa pantalla manda
  `fuente: 'seleccion'` (personas elegidas a dedo), y la guarda del canal
  Push solo aceptaba `estructura` y `testigos`. Se agregó `seleccion`: lo
  que hay que impedir es disparar contra un **público** que en su mayoría no
  tiene cuenta, no elegir a alguien uno por uno — ahí la propia lista ya
  muestra quién puede recibirlo.
- **`destinatariosDeSeleccion` no traía `usuario_id`.** Es el mismo hueco
  que ya se había corregido en `obtenerDestinatarios`, en la otra vía: sin
  él, `contacto` queda nulo y la campaña entera sale «sin contacto» sin un
  solo error. Al agregar un canal que se dirige a la **cuenta** y no al
  teléfono, hay que revisar **todos** los caminos que arman destinatarios,
  no solo el principal.

**La entrada del menú necesita un módulo de permisos, o no la ve nadie.**
`common.js` oculta todo ítem cuyo `modulo` no esté en los permisos del
usuario. Se agregó `enviar_push` al mapa de `db/init-db.js` (admin,
coordinador, líder, asistente administrativo) — por eso este parche **toca
la base**. Verificado en `permisos_rol` tras correr la migración.

**Plantillas en las CUATRO pantallas, y el filtro de cada una es distinto
por una razón.** Al probarlo en pantalla aparecieron dos huecos más, cada
uno por un motivo diferente — y los dos se veían igual: desplegable vacío.

| Pantalla | Canales que ofrece | Por qué |
|---|---|---|
| CRM y Mensajes | todas | el canal se elige ahí mismo |
| Enviar SMS | `sms`, `cualquiera` | una tilde de una plantilla de correo parte el SMS de 1 segmento a 3 |
| Enviar E-mail | `email`, `email_personal`, `cualquiera` | **son dos canales para el mismo dato de contacto** |
| Aviso en la app | `push`, `sms`, `cualquiera` | mismo tipo de texto corto; las de correo quedan recortadas |

- **Enviar E-mail no tenía el desplegable**, sin más. Y su `CANAL` es
  `email_personal` (Hostinger), mientras las plantillas de arranque están
  bajo `email` (SendGrid): un filtro exacto por su propio canal habría dado
  **cero**. Por eso acepta los dos. Además es la única que al elegir una
  plantilla llena **también el asunto**.
- **Aviso en la app sí tenía el desplegable, y salía vacío**: filtraba por
  `canal === 'push'` y no existe **ninguna** plantilla de ese canal — las 10
  de arranque son 6 de SMS y 4 de correo.

**El pintado va FUERA del `try`** en las tres pantallas nuevas, a diferencia
de `crm.html`: si la consulta falla, que se vea el fallo y no un desplegable
vacío que parece «no hay plantillas».

**Se probó el filtro REAL, extraído del HTML, contra las plantillas de la
base** (`probar-filtros-plantillas.js`), y no solo que el endpoint
respondiera. Es la comprobación que faltó las dos veces anteriores: el
endpoint devolvía las 10 y aun así el usuario veía un desplegable vacío,
primero por una función inexistente y después por un filtro que no
casaba con ningún dato. Resultado: 6 · 4 · 6 opciones, y ninguna de correo
colándose en SMS ni en los avisos.

### jj) Torre de acceso: ingreso por código (9 de agosto) — backend hecho

Pedido: que **admin, coordinador y asistente administrativo** entren sin
contraseña, con un código de un solo uso pedido desde su correo; los demás
roles siguen con usuario y contraseña.

**Casi nada era nuevo.** La app ya tenía códigos de un solo uso desde el
2FA: tabla `two_factor_codes` con hash SHA-256, 6 dígitos, 10 minutos, uso
único, tope de 5 intentos y auditoría. Solo se disparaba con
`two_factor_enabled`, que **nadie tenía activado**. El trabajo fue cambiar
el disparador de «una casilla por usuario» a «el rol», no construir el
mecanismo.

**Medido antes de decidir:** en las dos campañas **nadie carece de correo**
(y son únicos: 9 coordinadores, 9 correos), pero **el admin no tiene
teléfono en ninguna de las dos**. Es decir, el canal SMS falla justo para la
cuenta que más necesita entrar.

**Decisiones del usuario:** no revelar nunca si una cuenta existe; los dos
canales siempre visibles; y la sesión larga se queda en **7 días** (la
maqueta decía 30), corrigiendo el texto en vez del comportamiento.

**Las dos primeras se contradicen, y mandó la de no revelar.** Con SMS
siempre visible, un error del tipo «esta cuenta no tiene teléfono»
confirmaría que la cuenta existe. Por eso, sin teléfono no se manda nada y
la respuesta es la misma de siempre. Tiene un costo real y queda dicho: un
admin sin teléfono que elija SMS espera un mensaje que nunca llega.

**Son DOS pantallas, y esa es la decisión de diseño que lo hace seguro.**
Preguntarle al servidor «¿esta cuenta entra con código o con contraseña?»
obliga a responder distinto según si existe, y eso convierte el ingreso en
un detector de correos. Aquí el camino lo elige la **persona** —la torre, o
un enlace al formulario de usuario y contraseña— y el servidor nunca tiene
que delatar nada.

**La contraseña sigue funcionando para esos tres roles, a propósito.** Es la
salida de emergencia: el SMTP de este proyecto ya se rompió dos veces, y
dejar al administrador dependiendo solo del correo significa que un fallo de
correo lo saca de su propia campaña sin más vía que el SSH. La torre es el
camino ofrecido; la contraseña, el que queda por si el correo falla. **Si se
quiere cerrar esa puerta, es una decisión aparte y consciente.**

`POST /auth/solicitar-codigo`, limitado a **5 intentos cada 15 minutos por
IP** — sin eso la pantalla es una forma gratuita de mandar correos, y SMS
que se cobran, a cualquier dirección. El `usuario_id` viaja en la **sesión**,
nunca al navegador: si lo mandara el cliente en el paso 2, bastaría con
cambiarlo para pedir el código de una cuenta y validar el de otra.

**Probado con 8 casos, en electoral y contra una campaña** (los transportes
de correo y SMS se sustituyen, no se manda nada real): cuenta que existe y
cuenta que no dan **la misma respuesta byte a byte**, solo se envía a la
real, el código es de 6 dígitos, SMS sin teléfono responde igual y no manda
nada, y **a un líder no se le manda código** aunque la respuesta que ve sea
idéntica. Ese último caso hubo que correrlo contra una campaña: electoral no
tiene líderes.

**La pantalla, hecha** (`public/login.html`). La torre es lo primero que se
ve: correo arriba, los dos canales, la casilla de sesión (**dice 7 días**,
que es lo que de verdad dura) y el botón «Enviar código». El formulario de
usuario y contraseña sigue ahí, detrás del enlace *«Ingresar con usuario y
contraseña»*, con su enlace de vuelta.

Se **reutiliza el `form-2fa` que ya existía** para pedir los 6 dígitos: la
verificación no se tocó. Su texto ya no dice «por correo» fijo — lo escribe
el JS con el mensaje que devolvió el servidor, que es el mismo para todos.

**El selector de cuentas del dispositivo no se tocó**: los roles que lo usan
(líder, sublíder, testigo) siguen entrando igual.

**Probado contra el servidor real, y ahí apareció una trampa:** por HTTP
plano la prueba fallaba siempre con *«Token de seguridad inválido»*, y no
era el CSRF. La cookie de sesión es `secure` porque `NODE_ENV=production`,
así que **por HTTP no se guarda y no hay sesión donde comparar el token**.
Hay que probar por HTTPS:

```bash
curl -k --resolve electoral.appestrategia.net:443:127.0.0.1 ...
```

Con eso: la ruta responde el mensaje único, y el limitador **corta exacto en
el sexto intento**. Además se comprobó que **todos los `getElementById` de
`login.html` tienen su elemento** — la comprobación que faltaba el día que
`escaparHtml` no existía.

**El aspecto, en una segunda vuelta.** Primero se dejó el estilo claro de
siempre y el usuario pidió el de la maqueta: tarjeta oscura, botones y letra
más grandes, fondo beige.

**Los colores no se inventaron: ya estaban en el sistema.** La maqueta calza
con `--color-navy` (#10233F), `--color-accent` (#C98A2C) y el crema #F8F3E9
que usan los formularios de personas desde el parche 13. El «fondo beige» se
interpretó como **los campos** —que es donde ese crema ya se usa en la
aplicación—, no como el fondo de la página, que en la maqueta es oscuro.

**Todo el estilo va acotado a `.login-card`, en el `<style>` de la propia
página y NO en `style.css`.** Esa hoja la comparten 24 pantallas y aquí se
invierte el contraste: suelto, teñiría formularios de toda la aplicación.

**El encabezado cambia con el paso.** Es uno solo para los tres formularios,
así que dejarlo fijo en «TORRE DE ACCESO» diría una cosa mientras se muestra
el de contraseña. Lo fija `mostrarPaso()`, que además es ahora el único
lugar que muestra u oculta pasos — antes había dos sitios que enseñaban el
formulario de código por su cuenta y habrían dejado el título anterior.

`:has()` marca en dorado el canal elegido sin JavaScript; donde no exista,
queda el borde neutro y el radio nativo sigue indicando cuál está elegido —
se degrada, no se rompe.

**Sigue sin poder comprobarse cómo se ve**: no hay navegador en este
servidor. Se verificó que el estilo llega al archivo servido y que el HTML y
el JS son válidos, pero el juicio visual es del usuario.

### kk) Parches 22 y 23 — y una numeración que estaba desfasada

**Al ir a generar «el parche 18» resultó que las campañas iban en el 21.**
Este documento venía llevando la cuenta desde el 17, pero sobre el mismo
repositorio corrió otra línea de trabajo —la auditoría de `AUDITORIA.md`—
que publicó los parches **18, 19, 20 y 21**. Generar el 18 habría chocado
con un número ya usado.

**No se dio por bueno ningún número: se midió.** El catálogo real de
`licenciasdb` y el `.version-parche` de cada campaña dijeron 21, y después
se comparó **archivo por archivo** electoral contra una campaña para saber
qué faltaba de verdad. Eran seis, ni más ni menos.

**Y esa comparación destapó dos fallos en vivo**, los dos por trabajo a
medias entre las dos líneas:

- **El menú ofrecía «Aviso en la app» y daba 404.** `common.js` viajó con un
  parche de la auditoría —con la entrada del menú ya dentro— pero
  `enviar-push.html` no existía allá. Es la misma clase de error que tumbó
  el parche 15: **lo que falta no se ve comparando lo que llegó.**
- **Las plantillas del CRM y la bandeja de respuestas seguían rotas**, sin
  la función `escaparHtml`.

Dos parches, **ninguno toca la base** (el módulo `enviar_push` y la tabla
`two_factor_codes` ya estaban allá; se comprobó antes de generar):

| Nº | Qué | Archivos |
|---|---|---|
| 22 | Plantillas visibles y la pantalla «Aviso en la app» | `crm.html`, `enviar-sms.html`, `enviar-email.html`, `enviar-push.html` |
| 23 | Torre de acceso | `auth.routes.js`, `login.html` |

`verificar-requires.js` contra las dos campañas **antes** de subir nada:
TODO RESUELVE en los cuatro cruces. Aplicados en una sola corrida —el
actualizador aplica los pendientes en orden— y verificado después: **6 de 6
archivos idénticos** en cada campaña, `enviar-push.html` ya responde 200
donde antes daba 404, y la torre responde su mensaje único en las dos.

**Las dos campañas quedan en el parche 23. El siguiente número libre es el
24.** Y la lección para la próxima: **antes de generar, preguntarle el
número al catálogo, no a este documento** — hay más de una mano sobre el
mismo repositorio.

