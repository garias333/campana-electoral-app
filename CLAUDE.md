# CTC — Catálogo Territorial de Colombia

Servicio de datos territoriales del que dependen las siete aplicaciones de
Estrategia / INGESES S.A.S. No es una app más: es la fuente única de verdad
sobre territorios, y su razón de ser es que ninguna campaña vuelva a cargar
la división político-administrativa del país.

- **Producción:** https://territorios.appestrategia.net
- **Ruta:** `/home/appestrategia-territorios/htdocs/territorios.appestrategia.net`
- **Usuario SSH:** `territoriosshh` (su `~/htdocs` es enlace a la ruta anterior)
- **Puerto interno:** 3008 (escucha solo en 127.0.0.1, Nginx hace de proxy)
- **Stack:** Node 22 (nvm) · Express 4 · EJS · MySQL 8.4.10 · PM2
- **Base:** `territoriosdb` · usuario `territoriosuser` · 23 tablas + 2 vistas

Otras apps del ecosistema y sus puertos: mapamanizales 3001, electoral 3002,
proyector 3006, escucha 4200. Todas en el mismo VPS y el mismo MySQL.

---

## Reglas que no se pueden romper

### 1. El ETL nunca borra

Los `id` de `ctc_territorios` son **referencias permanentes** desde las
campañas de la app Electoral. Un `TRUNCATE` y recarga renumera la tabla y
deja todas las campañas históricas apuntando a territorios equivocados, sin
error visible.

Todos los importadores hacen UPSERT y son repetibles. Esa decisión salvó el
proyecto: durante la carga inicial hubo cuatro correcciones sucesivas y cada
una se aplicó volviendo a correr el importador, sin perder trabajo previo.

### 2. `ctc_normalizar()` y `normalizar()` deben coincidir

Existen dos implementaciones de la misma regla:

- `ctc_normalizar()` — función MySQL, en `database/01_schema.sql`
- `normalizar()` — JavaScript, en `services/territorios.service.js`

Si divergen, los cruces fallan **en silencio** y el ETL duplica todo. Ya
pasó: la versión SQL usaba `REPLACE('  ',' ')` una sola vez y no colapsaba
tres espacios seguidos, mientras la de JS usaba `\s+`. La base guardaba
`COMUNA 02  SAN JOSE` y el migrador buscaba `COMUNA 02 SAN JOSE`. Resultado:
194 territorios duplicados en Manizales y cinco scripts de reparación.

Hoy la versión SQL usa `REGEXP_REPLACE`. **Al tocar una, tocar la otra y
verificar con un caso que lleve guion y paréntesis.**

### 3. MySQL invierte los ejes en SRID 4326

`ST_X` devuelve **latitud**, no longitud. Usar siempre:

- Leer: `ST_Latitude(punto)` / `ST_Longitude(punto)`
- Escribir: `ST_GeomFromText(wkt, 4326, 'axis-order=long-lat')` o
  `ST_GeomFromGeoJSON(...)`

`ST_Centroid` **no está implementado** para sistemas geográficos. Para un
punto representativo:
`ST_PointN(ST_ExteriorRing(ST_GeometryN(geom,1)),1)`.

MySQL tampoco tiene `ST_Simplify`; la simplificación se hace en Node
(Douglas-Peucker en `etl/importar_veredas.js`).

### 4. Orientación de anillos en polígonos

Los shapefiles dibujan el anillo exterior en sentido horario; los sistemas
geográficos lo esperan antihorario. Sin corregir, MySQL entiende que el
polígono cubre **todo el planeta menos** la vereda. No falla al insertar:
falla meses después cuando `ST_Contains` devuelve resultados absurdos.
`importar_veredas.js` normaliza exterior antihorario y agujeros horarios.

### 5. PM2 necesita el ciclo completo

`restart` **no** relee el `.env`. Siempre:

```bash
pm2 delete territorios && pm2 start ecosystem.config.js && pm2 save
```

### 6. Contraseñas con `#` en el `.env`

Van entre comillas dobles o dotenv corta el valor en el `#`:
`DB_PASSWORD="mi#clave"`

### 7. Colación insensible a acentos

`utf8mb4_0900_ai_ci` trata `Ã` y `A` como la misma letra. Para detectar
texto mal codificado hay que forzar binario:

```sql
WHERE nombre COLLATE utf8mb4_bin LIKE '%Ã%'
```

### 8. Una columna, un sistema de codificación

`codigo_dane` es **solo DIVIPOLA**. El código de vereda va en `ctc_codigos`
bajo `DANE_VEREDAS`; el de la Registraduría, bajo `REGISTRADURIA`.

Meter dos sistemas en la misma columna única no da error: hace que el
segundo **no entre**. Así se perdieron 5.561 centros poblados, porque una
vereda con el mismo número de ocho dígitos había llegado primero.

Al agregar una fuente nueva, la pregunta no es «¿cabe en `codigo_dane`?»
sino «¿es DIVIPOLA?». Si no lo es, va a `ctc_codigos`.

### 9. `mysqldump` sin `--no-tablespaces` sale vacío

`territoriosuser` no tiene el privilegio `PROCESS`. Sin esa bandera el
dump falla al leer los tablespaces y escribe un archivo **con encabezado
y sin datos**, de tamaño creíble. Verificar siempre el contenido, no el
tamaño:

```bash
grep -ac 'CREATE TABLE' respaldo.sql
```

(`-a` importa: el dump trae geometrías binarias y `grep` lo trata como
binario, dando cero coincidencias en un archivo que sí tiene datos.)

---

## Modelo de datos

Jerarquía por lista de adyacencia (`padre_id`) **más** ruta materializada
(`ruta` = `/1/7/383/1187/`), que permite «todo lo que cuelga de Caldas» con
un `LIKE` indexado sin CTE recursivo.

| Nivel | Contenido | Tipos |
|---|---|---|
| 1 | País | 10 |
| 2 | Departamento | 20, 21 |
| 3 | Municipio / ANM | 30, 31, 32 |
| 4 | Comuna, corregimiento, localidad | 40, 41, 42, 43 |
| 5 | Barrio, vereda, centro poblado | 50, 51, 52, 53, 54 |

Lo urbano y lo rural conviven en el mismo nivel; los distingue el **tipo**,
no la profundidad. Comuna (40) y corregimiento (41) son nivel 4; barrio (50)
y vereda (51) son nivel 5.

**Tablas clave:**

- `ctc_territorios` — la jerarquía
- `ctc_territorio_geom` — polígonos aparte, porque `SPATIAL INDEX` exige
  `NOT NULL` y un multipolígono pesa cientos de KB
- `ctc_codigos` — equivalencia entre sistemas de codificación. **Es la razón
  de ser del catálogo**
- `ctc_alias` — nombres alternativos para cruzar archivos externos
- `ctc_puestos_votacion` / `ctc_mesas_votacion` — capa electoral
- `api_clientes` / `api_llaves` — consumo desde las otras apps

---

## Por qué existe `ctc_codigos`

DANE y Registraduría **no comparten códigos**, y ninguna fórmula traduce
entre ellos:

| Municipio | DANE | Registraduría |
|---|---|---|
| Medellín | 05001 | 01001 |
| Bogotá D.C. | 11001 | 16001 |
| Manizales | 17001 | 09001 |
| Cúcuta | 54001 | 25001 |

Sin esta tabla, cruzar censo electoral con datos censales exige trabajo
manual cada vez. Con ella es un `JOIN`.

---

## Estado actual de los datos

| Nivel | Cantidad |
|---|---|
| Departamentos | 33 |
| Municipios | 1.122 (con coordenadas) — 1.103 municipios, 1 isla y 18 áreas no municipalizadas |
| Veredas | 32.016 activas (32.015 con polígono) |
| Puestos de votación | 12.885 — **12.612 georreferenciados y con dirección** |
| Mesas | 119.745 |
| Equivalencias Registraduría | 1.171 |
| Códigos de vereda (`DANE_VEREDAS`) | 32.015 |
| Centros poblados | 8.560 |

Manizales (id 383, DANE 17001) es el único municipio con los cinco niveles:
12 comunas, 7 corregimientos, 114 barrios, 62 veredas, 23 centros poblados,
91 puestos. (Eran 78 veredas hasta que se fusionaron 16 duplicadas; ver
pendiente 6.)

Las cifras de arriba cuentan **territorios activos**. Desde el 7 de agosto
de 2026 hay 16 filas en `estado = 'FUSIONADO'`, que siguen existiendo y
resolviendo por su `id` pero no aparecen en el panel ni en la API. En bruto
la tabla tiene 41.881 filas y 32.032 veredas.

La única vereda activa sin polígono es La Francia (Manizales), que el DANE
no trae; ver pendiente 6.

**Verificadas contra la base el 7 de agosto de 2026.** Dos venían mal desde
antes: los puestos decían 12.887 (son 12.885) y las equivalencias de
Registraduría decían 1.153 (son 1.171). Si una cifra de esta tabla se usa
para decidir algo, vale la pena volver a contarla.

---

## Los ETL

| Script | Fuente | Notas |
|---|---|---|
| `etl/importar_divipola.js` | DANE, Excel o CSV | Encabezado en dos filas; combina fila de grupo y de campo. Coincidencia por tokens |
| `etl/importar_divipole.js` | Registraduría, zip de 3,2 GB | Streaming; 16 M filas en ~55 s. Cruza dep/mun por nombre y alias |
| `etl/importar_veredas.js` | DANE, shapefile | Lee DBF como **UTF-8**, no latin1 (ver abajo) |
| `etl/importar_puestos_geo.js` | Registraduría, CSV georreferenciado | Cruza por nombre con alias **por departamento**. Escribe `ubicacion` con `axis-order=long-lat` |
| `etl/migrar_campana.js` | Base de una campaña | Solo lee del origen; genera SQL de reapuntado sin ejecutarlo |
| `etl/proponer_alias.js` | Diagnóstico | Propone alias para municipios que no cruzan |

### Trampas ya resueltas, no reintroducir

**DBF en latin1.** El decodificador de la librería `shapefile` usa
Windows-1252, que altera los bytes `0x80–0x9F`. La `Ñ` (`C3 91` en UTF-8)
cae justo ahí y queda irrecuperable, mientras la `í` (`C3 AD`) se salva. Por
eso `SINAÍ` se veía bien y `LA CABAÑA` no. Se lee con `encoding: 'utf-8'` y
se detecta el caso contrario buscando `\uFFFD` en el primer registro.

**Cruce por nombre sin tipo.** Un barrio urbano y una vereda rural pueden
llamarse igual — de hecho suele pasar, porque el barrio creció donde estaba
la vereda. En Manizales: Morrogacho, Minitas, La Enea, El Paraíso. El
importador de veredas filtra `tipo_id = 51` explícitamente.

**Homónimos dentro de un municipio.** Dos veredas distintas con el mismo
nombre normalizado colapsaban en una fila. Regla: un candidato que ya tiene
**otro** código es otro territorio, aunque se llame igual.

(Ese código ya **no** es `codigo_dane`: desde la separación de sistemas vive
en `ctc_codigos` bajo `DANE_VEREDAS`, y `importar_veredas.js` lo trae con un
`LEFT JOIN` en el campo `cod`. La regla es la misma; cambió de dónde sale el
dato.)

**Colisión de id al reapuntar.** Los id viejos de una campaña y los nuevos
del CTC se solapan. El reapuntado va en dos fases: primero se suben todos al
rango `+100000000`, después se bajan. En una sola pasada, un `UPDATE`
posterior alcanza filas ya migradas.

**`CREATE TRIGGER` no admite `IF NOT EXISTS`.** Todo el esquema es repetible
salvo los disparadores; llevan `DROP TRIGGER IF EXISTS` delante.

**Tabla temporal en auto-unión.** MySQL no permite que una `TEMPORARY TABLE`
aparezca dos veces en la misma consulta.

**El shapefile trae 32.130 registros y el catálogo 32.032. No falta nada.**
La diferencia está explicada y verificada (7 de agosto de 2026):

```
32.130  registros en shp_CRVeredas_2024
  − 80  filas repetidas (36 códigos aparecen 2 o 3 veces en el origen)
  −  1  código no numérico: CODIGO_VER = 'PUERTO LOPEZ', en Achí, Bolívar
  − 34  códigos que no se cargaron
  ─────
32.015  = exactamente los códigos DANE_VEREDAS del catálogo
```

Los 34 que faltan **no son veredas reales**: 32 se llaman literalmente
`SIN INFORMACION` y 2 vienen sin nombre. El DANE no supo nombrarlas.

Ojo con la inconsistencia si alguien decide tocarlo: ya hay **601** veredas
llamadas `SIN INFORMACION` cargadas, todas con código y polígono. O sea que
601 entraron y 34 no. No vale la pena cargarlas —a un territorio sin nombre
no se le asigna un líder— pero conviene saber que el criterio no fue
uniforme, y que una corrida nacional del importador **crearía esas 34**.

**Dejar viva la tabla local después de migrar no es neutro: reinyecta los
id viejos.** El paso 6 de `mapeo_campanadepruebamunicipal.sql`
(`DROP TABLE territorios`, comentado como opcional) no era opcional.

El 7 de agosto de 2026 el mapeo repuntó los 88 votantes a las 02:39. A
las **03:13**, alguien editó uno desde la app de Electoral — y la app
escribió `territorio_id = 263`, un id **local**, porque su desplegable
seguía leyendo la tabla local con la numeración vieja. En el catálogo,
263 es **ARCABUCO, en Boyacá**: un votante de Manizales quedó asignado a
un municipio a 300 km.

Con la tabla local ese `JOIN` resolvía a «Fanny González» y nadie habría
notado nada nunca. Se descubrió porque la vista, acotada al ámbito de la
campaña, devolvió `NULL` — Arcabuco no está en Manizales.

Moraleja: mientras la copia local exista, **cada edición puede
reintroducir la numeración vieja**, y el solapamiento de rangos hace que
el error resuelva a un territorio real y equivocado en vez de fallar. La
vista lo impide de raíz; un `DROP TABLE` también, pero sin protección
contra que alguien la recree.

**El prefijo más corto se come al más largo.** Es el error más caro que ha
tenido este catálogo, y estuvo invisible desde la carga inicial hasta el 7 de
agosto de 2026.

`importar_divipole.js` cruzaba los municipios por nombre y, si no había
coincidencia exacta, recorría el índice aceptando **la primera** que encajara
por prefijo:

```js
if (soloNombre.startsWith(cn) || cn.startsWith(soloNombre)) { mm = vv; break; }
```

Como «CALI» es prefijo de «CALIMA», «BUGA» de «BUGALAGRANDE» y «SINCE» de
«SINCELEJO», la Registraduría metió:

```
206 puestos de Santiago de Cali  ->  Calima
 46 puestos de Guadalajara de Buga -> Bugalagrande
  4 puestos de San Luis de Sincé   -> Sincelejo
```

**Cali —la tercera ciudad del país— quedó con CERO puestos en el catálogo.**
Nadie lo notó porque el total seguía dando 12.885: estaban todos, solo que 256
en el municipio equivocado. Una campaña en Cali habría encontrado el catálogo
vacío.

**Cómo se descubrió, y por qué importa el método.** Al georreferenciar, el
importador nuevo resolvió «CALI» correctamente vía alias, no halló puestos allí
y **rechazó 206 filas en vez de adivinar**. Si hubiera usado la misma
coincidencia laxa, habría escrito las coordenadas de Cali sobre los puestos de
Calima y el error habría quedado enterrado más hondo — ahora con coordenadas
que lo harían parecer verificado.

Hoy el prefijo **sólo vale si hay un único candidato**; con varios se avisa y
se deja sin cruzar. Y si el nombre corto es legítimo, va a `ctc_alias` y el
cruce exacto lo resuelve sin llegar al prefijo.

**Pero la causa estaba un nivel más abajo: en `ctc_codigos`.** El importador
sólo cae al cruce por nombre cuando falta la equivalencia por código. Y
faltaba porque **tres equivalencias estaban asignadas al municipio
equivocado** (`database/09_reparar_equivalencias_registraduria.sql`):

```
31001 (CALI)   lo tenía CALIMA        ->  Santiago de Cali
31022 (BUGA)   lo tenía BUGALAGRANDE  ->  Guadalajara de Buga
28260 (SINCE)  lo tenía SINCELEJO     ->  San Luis de Sincé
```

Calima, Bugalagrande y Sincelejo cargaban **dos códigos cada uno**: el suyo y
el del vecino. Y los tres municipios reales se quedaban sin ninguno, cayendo
al cruce por nombre. Un mismo error, en cascada de tres niveles: equivalencia
robada → sin equivalencia → cruce por nombre → prefijo equivocado.

Se auditaron las 1.120 equivalencias contra `MMV_2023_NACIONAL.csv` (el mesa a
mesa de la Registraduría, 3,2 GB, que sí trae los códigos). Las otras 1.117
son correctas.

**Al auditar esto, comparar ESTRICTO.** La primera versión de la comparación
usaba `includes()` para tolerar variantes de nombre —y `«CALIMA».includes(
«CALI»)` da verdadero—, así que la tolerancia ocultó justo el error que la
auditoría buscaba. Los alias son la única excepción admisible, y declarada.

Quedan **2 municipios sin equivalencia, y está bien**: Nuevo Belén de Bajirá
(creado en 2022, en 2023 votaba con Riosucio) y Santiago de Putumayo, que el
archivo mesa a mesa no trae aunque el georreferenciado sí le atribuya 2
puestos — las dos fuentes de la Registraduría se contradicen y no se inventa
un código.

La reparación (`etl/reparar_puestos_municipio.js`) no usa `codigo_reg`: **no es
único a nivel nacional** —1.290 códigos para 12.885 puestos, «99-01» existe en
464 municipios— porque es zona-puesto *dentro* del municipio. Se reparó
cruzando contra el CSV georreferenciado, moviendo sólo lo que el archivo
atribuye inequívocamente a otro municipio confundible por prefijo.

**Cruzar por nombre exige alias, y los alias son por departamento.** El
archivo georreferenciado de la Registraduría («Divipole territoriales 2023»)
identifica los puestos por DEPARTAMENTO + MUNICIPIO + NOMBRE, sin código. Los
nombres de puesto cruzan al **99,98%** —vienen de la misma fuente— pero los de
municipio no: la Registraduría escribe «Cali» donde el DANE escribe «Santiago
de Cali».

Lo que costó cada paso (7 de agosto de 2026):

```
cruce directo ....................... 79,2%
+ 3 alias de departamento ........... 88,7%   VALLE, NORTE DE SAN, SAN ANDRES
+ quitar el paréntesis aclaratorio .. 92,3%   «ALTO BAUDO (PIE DE PATO)»
+ 36 alias de municipio ............. 97,7%   database/08_alias_registraduria_2023.sql
```

Tres alias de departamento resolvieron **el 59% de las pérdidas**: los 155
municipios que fallaban no eran 155 problemas, eran sobre todo un nombre de
departamento abreviado arrastrando a todos sus municipios.

**Los alias se buscan SIEMPRE dentro del departamento ya resuelto.** «EL
CARMEN» existe en Chocó (de Atrato) y en Santander (de Chucurí); «SAN ANDRES»
en Antioquia (de Cuerquía) y en el Archipiélago (la isla). A nivel nacional
serían ambiguos y el cruce metería puestos en otro departamento.

Dos que hubo que verificar a mano y no se dejan a una regla:

- `ANTIOQUIA / ANTIOQUIA` es **Santa Fe de Antioquia**, el municipio — no el
  departamento.
- `ANTIOQUIA / SAN PEDRO` tenía dos candidatos con **nueve puestos cada uno**.
  El conteo no desempataba; se resolvió comparando los nombres de los puestos,
  que coinciden uno a uno con **San Pedro de los Milagros**.

**El separador de miles se come el punto decimal.** Ocho filas del archivo
traen `10,965,899` donde debería decir `10.965899`, o `-701,627,975` por
`-70.1627975`. Es la corrupción típica de exportar CSV con formato regional.

**No se reconstruyen.** `-795.98017415121` podría ser `-79.598` o `-75.98`, y
las dos caen en Colombia — una en el mar frente a Nariño, la otra en Antioquia.
Adivinar el punto decimal mete un puesto en el sitio equivocado sin que nadie
lo note. Quedan rechazadas con su motivo.

**Un archivo no puede pisar lo que no trae.** `importar_divipola.js` fijaba
`tipo_id` en cada `UPDATE` de municipio, aunque la hoja no tuviera columna
de tipo. La hoja "Cabeceras - Centros Poblados" no la trae, así que cada
corrida aplastaba a Municipio (30) las 18 **áreas no municipalizadas** de
Amazonas, Guainía y Vaupés (El Encanto, Tarapacá, Yavaraté…) y la isla.

No era hipotético: el 6 de agosto de 2026 la carga 23 (hoja Municipios,
17:48:10) las tipificó bien y la carga 24 (centros poblados, 17:48:26) las
aplastó **dieciséis segundos después**, sin error ni advertencia. Se
detectó un día más tarde, sólo porque un conteo por tipo dio 1.122
municipios y ningún ANM.

Hoy el `UPDATE` arma sus `SET` dinámicamente: `tipo_id` sólo entra si el
archivo trae la columna. Regla general para todo importador: **si la fuente
no tiene el dato, la columna no se toca** — escribir un valor por defecto
sobre una fila que ya existe es indistinguible de borrarlo.

---

## Pendientes

### 1. Centros poblados de DIVIPOLA — resuelto (6 de agosto de 2026)

La separación de códigos (`database/06_separar_codigos_veredas.sql`) dejó
`codigo_dane` solo para DIVIPOLA y movió los 32.015 códigos de vereda a
`ctc_codigos` bajo `DANE_VEREDAS`. Con el rango de ocho dígitos libre, se
corrió `importar_divipola.js` contra `Listados_DIVIPOLA.xlsx` (hoja
"Cabeceras - Centros Poblados", junio 2026): **8.560 centros poblados
nuevos**, todos con coordenadas, cero colisiones.

Caso de prueba, el mismo que documentaba el problema: `05001001` ahora
resuelve a dos territorios distintos según el sistema — Aguas Frías
(vereda, `DANE_VEREDAS`) y Palmitas (centro poblado, `DANE`/DIVIPOLA).

### 2. Los puestos de la app Electoral — datos verificados (7 de agosto de 2026), falta código

`dia_d_puestos_votacion` en las campañas guarda solo `nombre` y
`cantidad_mesas` — confirmado en `campanadepruebamunicipal`, sin municipio
ni código. Sus nombres vienen truncados a ~32-34 caracteres de una fuente
de la Registraduría, y ya no cruzan con los nombres completos que el
catálogo tiene ahora. `territoriosuser` ya tiene `SELECT` sobre
`electoraldb` y `campanadepruebamunicipal` (ver nota de acceso al final de
esta sección).

`electoraldb.dia_d_puestos_votacion` está **vacía** (0 filas) — parece que
`electoraldb` es la plantilla de esquema desde la que se clonan las
campañas, no una campaña en sí; tiene las mismas 27 tablas que
`campanadepruebamunicipal`.

**Revisado el código de Electoral (7 de agosto de 2026).** La tabla se usa
en solo dos archivos, `config/estimadoPuestos.js` y `routes/diaD.routes.js`,
todo bajo `/api/dia-d`. Pero **no son datos de referencia: es un CRUD
completo** — admin crea, edita y borra puestos desde Configuración → Día D,
y hay importación y exportación por Excel.

Eso descarta la idea original de «que Electoral consulte el catálogo en vez
de tener tabla propia»: el catálogo es compartido y de solo lectura, y aquí
un usuario borra puestos.

**La raíz del problema es otra, y el propio código la documenta:**

> «El testigo no queda ligado por FK al puesto (`usuarios.puesto_votacion`
> es texto libre), así que el cálculo se hace comparando ese texto contra
> el nombre del puesto.»

Todo el Día D se une **por nombre**, no por id:

- `/puestos-para-reporte` devuelve un arreglo de nombres, no de ids
- `/mesas-ocupadas?puesto=<nombre>` cruza texto contra `usuarios.puesto_votacion`
- `/puestos-con-mesas` es el payload que **cachea la app de celular** para
  trabajar sin conexión — también por nombre

(De paso: `estructura.mesas_asignadas = [1,2,3]` son números de mesa
*dentro* del puesto, 1..`cantidad_mesas`; el puesto sale del texto en
`usuarios.puesto_votacion`.)

Por eso **agregar `ctc_puesto_id` no arregla nada por sí solo**: los cruces
siguen siendo por texto.

**Plan en dos etapas:**

*Etapa 1 — sembrar los puestos desde el catálogo*
(`sembrar_puestos_campana.sql`). Al declarar el `campana_ambito`, llenar
`dia_d_puestos_votacion` con los puestos reales del municipio: nombre
**completo** (el catálogo llega a 41 caracteres; los truncados traen 32),
`cantidad_mesas` desde `ctc_puestos_votacion.total_mesas`, y `ctc_puesto_id`
como enlace. Nada más cambia. El desplegable nace consistente, el
truncamiento desaparece en el origen y `migrar_campana.js` deja de recrear
duplicados porque puede enlazar por id.

**Los nombres de puesto son únicos dentro de un municipio, no dentro de un
departamento.** Al sembrar la campaña departamental de prueba,
`uq_puesto_nombre` reventó con `Duplicate entry 'LA FLORESTA'`. Medido: los
332 puestos de Caldas traen solo 302 nombres distintos — **30 chocan**, y
`PUESTO CABECERA MUNICIPAL` existe en **diecisiete** municipios. Dentro de
un mismo municipio no se repite ninguno.

El índice no creó el problema: lo destapó. Como todo el Día D identifica el
puesto por su **texto** (`usuarios.puesto_votacion` es libre), un testigo
departamental que diga «estoy en PUESTO CABECERA MUNICIPAL» sería ambiguo
entre 17 sitios, y en un desplegable de 332 opciones ese nombre no orienta
a nadie. Por eso `sembrar_puestos_campana.sql` **califica el nombre con su
municipio cuando el ámbito abarca más de uno** — `LA FLORESTA (SALAMINA)`.
Quedan 332 nombres distintos, el mayor de 52 caracteres en un
`varchar(200)`. En campaña municipal el sufijo no aparece.

Ojo: el `UPDATE` de refresco usa **la misma expresión** que el `INSERT`. Con
`p.nombre` a secas le quitaría el municipio a los 332 y volvería a chocar,
dejando una parte renombrada y la otra no.

*Etapa 2 — pasar los cruces de nombre a id.* Toca `usuarios.puesto_votacion`,
el formulario de reporte y la caché del móvil. Es un cambio grande; no
ahora.

**Ojo con retrofitear.** Si una campaña ya tiene testigos con nombres
truncados en `usuarios.puesto_votacion`, resembrar con nombres completos
rompe esos cruces **en silencio**. En campañas nuevas no pasa — otra razón
para hacerlo ahora, mientras no hay campañas reales.

Por eso la guarda de `sembrar_puestos_campana.sql` va **dentro** del
`INSERT` y del `UPDATE`, no solo como aviso al principio: si hay testigos
con puesto en texto, las dos sentencias se vuelven no-ops. Probado contra
`campanadepruebamunicipal`, que tiene 51 testigos: el script no cambió
nada y los 51 cruces siguieron intactos. Un aviso impreso no sirve —
quien corre un `.sql` de un tirón no lo ve pasar, y el daño no da error.

### 3. Aplicar el mapeo a la campaña de prueba — resuelto (7 de agosto de 2026)

`mapeo_campanadepruebamunicipal.sql` tenía un bug real en el mapeo de
puestos: 36 de 92 apuntaban a un rango de `ctc_puesto_id` que no existe
(13031-13066; `ctc_puestos_votacion` solo llega a 12.887) — ids que
parecen reservados para filas que una corrida de `migrar_campana.js` iba a
crear y nunca creó. Causa: los nombres truncados no cruzaban contra el
catálogo. Se corrigió por coincidencia de prefijo (34 casos) más uno por
eliminación, y se excluyó una fila de prueba (`id=93,
"PUESTO DE BRUEBA (ELIMINAR)"`).

El mapeo territorial (196 id, no 194 — la cifra vieja no contaba dos casos
que solo difieren en tilde, `Frío`/`FRIO`, verificados iguales con
`ctc_normalizar()`) **sí era correcto**, sin cambios.

Respaldada (`campanadepruebamunicipal_respaldo_2026-08-07.sql`, con
`--single-transaction` porque el usuario de solo lectura no tiene
`LOCK TABLES`) y ejecutada. Verificado después: 91/92 puestos mapeados
dentro de rango, las 5 tablas de reapuntado (`estructura`, `eventos`,
`usuarios`, `votantes`, `finanzas_movimientos`) con `territorio_id` en el
rango real del catálogo y cero filas atascadas en la fase transitoria
(`+100000000`), `campana_ambito` creada con su fila.

**Ojo para la próxima vez:** el script envuelve todo en
`START TRANSACTION`/`COMMIT`, pero tiene `ALTER TABLE`/`DROP FOREIGN KEY`
adentro — en MySQL el DDL hace commit implícito y no se puede deshacer con
`ROLLBACK`. La protección real fue el respaldo, no la transacción.

### 4. Vincular Electoral al catálogo — permiso otorgado (7 de agosto de 2026)

Ambas bases están en el mismo MySQL, así que basta un permiso de lectura.
Ya está dado (`grant_electoral_catalogo.sql`), pero **no como decía la
versión anterior de esta sección**, que proponía:

```sql
GRANT SELECT ON territoriosdb.* TO 'electoraluser'@'localhost';   -- NO
```

Dos cosas mal ahí:

1. **`territoriosdb` no es solo catálogo.** También tiene `usuarios` (con
   los hash de contraseña del panel del CTC), `sessions` y `api_llaves`.
   Ese `GRANT` le habría dado a Electoral las credenciales de otra app. Se
   otorgaron **17 tablas** una por una: las `ctc_*` de datos más las dos
   vistas, dejando fuera las de la app y las bitácoras del ETL
   (`ctc_auditoria`, `ctc_cargas`, `ctc_carga_rechazos`). Si algún día
   hace falta una más, se agrega — es más fácil que explicar por qué una
   app leía las contraseñas de otra.

2. **La cuenta real es `'electoraluser'@'%'`, no `@'localhost'`.** Con el
   host equivocado, `GRANT` no falla por permisos: intenta crear la cuenta
   y muere con *«You are not allowed to create a user with GRANT»*. Por
   eso el script descubre el host en `mysql.user` en vez de suponerlo. El
   mismo tropiezo pasó con `territoriosuser`, que también es `@'%'`.

Con eso Electoral ya puede hacer `JOIN` directo contra
`territoriosdb.ctc_territorios` — sin latencia HTTP, sin sincronización,
sin copias. La API queda para apps que algún día vivan en otro servidor.

**Falta la otra mitad:** que el código de Electoral efectivamente lo use
(declarar el `campana_ambito` y sembrar los puestos con
`sembrar_puestos_campana.sql`, ver pendiente 2). El permiso solo habilita;
no cambia nada por sí solo.

**Ensayo de extremo a extremo, 7 de agosto de 2026** (`ensayo_campana_nueva.sql`).
Se creó una base desechable clonando la plantilla y se corrió el flujo
completo. Resultado:

| Control | Valor |
|---|---|
| Puestos sembrados | 91 |
| Suma de mesas | 1.045 |
| Nombre más largo | **41** (los truncados daban 32) |
| Puestos sin `ctc_puesto_id` | 0 |
| **Territorios cargados** | **0** |

Esa última fila es la tesis del catálogo funcionando: la campaña arrancó
con **una fila de ámbito** en vez de 196 territorios copiados. Y los
nombres que aparecieron completos son justo los que estaban mal mapeados
en el pendiente 3 — `SEM. MENOR DE NUESTRA SEÑORA DEL ROSARIO` (41)
llegaba antes como `SEM. MENOR DE NUESTRA SEÑORA DE` (31).

**Los territorios ya se leen del catálogo** (7 de agosto de 2026,
`vista_territorios_catalogo.sql`). Electoral toca la tabla `territorios`
en 9 archivos, unas 40 veces. En vez de reescribirlos, se reemplazó la
tabla por una **vista con el mismo nombre y la misma forma**
(`id, tipo, nombre, padre_id, created_at`) sobre
`territoriosdb.ctc_territorios`, acotada por `campana_ambito`. Unas 30 de
las 40 referencias funcionan sin tocar una línea; se probaron las cinco
formas reales de consulta (`territorioResolver` ×2, `geoTerritorio`,
`territorial.routes` ×2) y todas responden igual.

El mapeo de tipos es conservador: `tipo_id` 20/21→departamento,
30/31/32→municipio, 40→comuna, 41→corregimiento, 50→barrio, 51→vereda.
Los centros poblados, caseríos, resguardos, localidades y zonas urbanas
quedan **fuera**: el `enum` local no los contempla y meterlos como
«vereda» sería mentir. El alcance incluye los ancestros del ámbito, para
que la subida por `padre_id` de `geoTerritorio.js` no se corte.

**Efecto buscado: las escrituras fallan.** La vista no es actualizable
(lleva `CASE` y subconsulta), así que `INSERT`, `UPDATE` y `DELETE` sobre
`territorios` son rechazados — incluido el `DELETE FROM territorios` sin
`WHERE` de `territorial.routes.js`, que borraba la tabla entera de un
clic. El riesgo queda neutralizado por construcción.

**Decisión tomada: la pantalla queda de solo lectura** (7 de agosto de
2026, `aplicar_parche_territorial.sh`). Se descartó quitarla —la
visibilidad de la jerarquía sí sirve— y se descartó una tabla aparte para
subdivisiones propias de campaña, porque **los 196 territorios que la
campaña había creado a mano existen todos en el catálogo, sin una sola
excepción**: ese CRUD nunca se usó para inventar territorios, sino para
teclear la división oficial por no tener catálogo. Y `crear-zona`, que
sonaba a subdivisión propia, crea los mismos tipos oficiales.

El parche agrega un `catalogoSoloLectura(res)` al inicio de los seis
endpoints de escritura (`POST`, `PUT`, `DELETE`, `eliminar-todo`,
`crear-zona`, `importar-excel`), para que respondan un 409 legible en vez
del `target table is not updatable` de MySQL. No borra código: revertir es
quitar seis líneas. Los `GET` y todo `/estructura` no se tocan.

**Dos cosas que se pierden y hay que saber:**

- La **importación de territorios por Excel** deja de funcionar. La
  exportación sigue.
- El `PUT` propagaba los renombres a `usuarios.comuna_corregimiento_residencia`
  y `usuarios.barrio_residencia`, que son **texto libre**. Ya nadie los
  sincroniza: si el catálogo corrige un nombre, esos campos quedan viejos.
  Es el mismo acoplamiento por nombre de los puestos; se arregla en la
  Etapa 2 del pendiente 2.

Y una que ya estaba rota sin que se notara: `eliminar-todo` confiaba en
las foráneas para no dejar votantes huérfanos, pero la migración al
catálogo **soltó esas foráneas** (MySQL no las admite entre bases). Sin la
vista, ese botón habría borrado los territorios dejando todo colgando.

La tabla original no se borra: queda como `territorios_local`. Para
revertir, `DROP VIEW territorios; RENAME TABLE territorios_local TO territorios;`

Una campaña nueva no «carga» territorios: **declara su ámbito en una fila**.
Ya hay un precedente funcionando: `campana_ambito` se creó y se usó en
`campanadepruebamunicipal` como parte del pendiente 3 (ver arriba).

```sql
CREATE TABLE campana_ambito (
  campana_id        INT UNSIGNED NOT NULL,
  ctc_territorio_id BIGINT UNSIGNED NOT NULL,
  nivel_operativo   ENUM('MUNICIPIO','BARRIO','PUESTO','MESA') NOT NULL,
  PRIMARY KEY (campana_id, ctc_territorio_id)
);
```

### 5. Operación

- Arranque tras reiniciar el VPS — resuelto (6 de agosto de 2026). El sitio
  es Reverse Proxy en CloudPanel, no Node.js nativo, así que no hay
  `pm2-<usuario>.service` automático y `territoriosshh` no tiene sudo real
  (solo `clpctlWrapper`, sin subcomandos de Node/PM2). Se resolvió con un
  `@reboot` en el crontab de `territoriosshh` que corre `pm2 resurrect`
  contra su propio `PM2_HOME`. Ese es el usuario que de verdad corre la
  app — no `appestrategia-territorios`, el site user de CloudPanel, que
  solo es dueño del vhost y los archivos.

  **Faltaba en `campanadepruebamunicipal`.** Revisado el 7 de agosto de
  2026: su crontab estaba vacío con el proceso corriendo desde hacía
  cuatro días. Ese estado se ve perfectamente sano en `pm2 list`; el
  fallo solo aparece al reiniciar el VPS. Electoral sí lo tenía.
  `arreglar_arranque_pm2.sh` recorre los cuatro usuarios, verifica que
  exista `dump.pm2` (sin él `pm2 resurrect` no revive nada) y agrega la
  línea sin duplicarla. Tiene `--simular`.

  Al auditar esto, **revisar todos los usuarios, no una muestra**: la
  primera pasada dejó a `appestrategia-electoral` fuera del bucle y se
  concluyó que también le faltaba. Un inventario incompleto no da error;
  da una conclusión falsa con la misma cara que una verdadera.
- SMTP — resuelto (7 de agosto de 2026). Fallaba con
  `535 authentication failed` y la recuperación de contraseña no enviaba
  nada. **Eran dos errores a la vez, y el primero costó horas:**

  1. **La dirección tenía un guion de más.** El `.env` decía
     `no-reply@appestrategia.net`; el buzón real es `noreply@` sin guion.
     Se confirmó preguntándole al servidor de correo, sin enviar nada —
     una conversación SMTP hasta `RCPT TO` contra `mx1.hostinger.com`:
     `noreply@` respondió `250 Ok` y `no-reply@` respondió
     *«User doesn't exist»*. (Ojo: el remitente de la prueba debe ser un
     dominio que acepte correo; con `example.com` el servidor rechaza por
     `nullMX` antes de mirar al destinatario.)
  2. **La contraseña también estaba mal**, y se regeneró en el panel de
     Emails de Hostinger.

  La lección es la de siempre en esta jornada: `535` significa
  «credencial rechazada», y la credencial incluye **el usuario**. Se dio
  por bueno el nombre del buzón porque estaba escrito en el `.env`.

  Para diagnosticar, `probar_smtp.js` lo dice en un comando: distingue si
  el problema está en el `.env`, en el transporte o en el proveedor, y con
  `--enviar destino@dominio` manda uno de prueba. Después de tocar el
  `.env`, recordar la regla 5: `pm2 restart` no lo relee.

  **Al regenerar esa clave se rompió Electoral, y nadie se enteró.** El
  mismo 7 de agosto de 2026, más tarde: las dos campañas no tenían
  ninguna variable `SMTP_*`, así que se copiaron desde Electoral… y la
  clave de Electoral era la **anterior** a la regeneración. Resultado:
  `535 authentication failed` en las **tres**. Copiar sin comprobar no
  arregló el problema, lo multiplicó.

  **Un correo que no sale no avisa.** El fallo llevaba horas y solo
  aparecería el día en que alguien pidiera recuperar su contraseña.

  Se descubrió por una diferencia que no significaba nada por sí sola:
  **19 caracteres en Electoral contra 16 en territorios**, para el mismo
  buzón. Es el patrón de toda la jornada —el de Cali, el de las ANM, el
  de las veredas duplicadas—: *la pista siempre fue un número que no
  cuadraba, y el error siempre estuvo en algo que se dio por bueno sin
  medirlo.*

  Herramientas que quedaron:
  - `probar_smtp_instancias.sh` — prueba las tres a la vez; sin `--enviar`
    no manda nada, solo pregunta al servidor si acepta la credencial.
  - `completar_smtp_campanas.sh` — iguala la configuración entre
    instancias. **Comprueba la credencial del origen contra el servidor
    antes de escribir nada**, y con `--reemplazar` pisa un valor
    existente. `--solo SMTP_PASSWORD` acota a una variable: hace falta
    porque territorios usa `SMTP_FROM` y Electoral `SMTP_FROM_NAME`, y
    copiar todo dejaría a las tres sin el remitente que su código espera.

  Y una trampa de `.env` que no estaba documentada: **elegir las comillas
  según el valor**. Sin comillas, dotenv corta en el primer `#` (regla 6);
  con comillas dobles corta en la primera `"` interna; con simples, en la
  primera apóstrofe. Si el valor trae de las dos, no hay forma de
  escribirlo y hay que cambiarlo en el proveedor.

  Verificado con entregas reales, no con `verify()`: tres correos, uno
  por instancia, cada uno con su identificador de mensaje.
- `nodemailer` — actualizado el 7 de agosto de 2026, de 6.10.1 a 9.0.4.
  Cierra los 7 avisos altos de `npm audit`; ninguno tocaba este código
  (todos son de `raw`, `envelope`, cabeceras `List-*`, `jsonTransport` u
  OAuth2, y `routes/auth.js` solo usa
  `createTransport({host,port,secure,auth})` + `sendMail({from,to,subject,html})`,
  API que no cambió entre v6 y v9). Se verificó **después** de actualizar
  con `node probar_smtp.js --enviar`: autenticación correcta y correo
  entregado. Se pudo comprobar de verdad porque el SMTP se arregló el
  mismo día; antes no había forma.

  El mismo día se hizo lo propio en **las tres instancias de Electoral**
  (`actualizar_nodemailer.sh`), también desde 6.10.1, a 9.0.5. El script
  se niega a actualizar si encuentra `raw`, `envelope`, `jsonTransport`,
  `List-*` u OAuth2 en `config/` o `routes/` —las opciones que los avisos
  sí tocan—, así que la decisión no depende de que alguien recuerde el
  razonamiento: la comprueba. Verificado con envío real **posterior** a
  la actualización.

  **En Electoral `xlsx` está en otra situación que aquí, y peor.** Allí
  hay **seis rutas que reciben Excel subido por web** (`uploadExcel`, en
  territorial, votantes y Día D), que es exactamente el escenario que el
  punto de abajo declara inaceptable. Y una de ellas
  —`votantes.routes.js` `/importar-excel`— **no tiene `requireRole`**:
  cualquier usuario autenticado puede subir un archivo, no solo un
  administrador. Lo mínimo es ponerle el rol; migrar a `exceljs` es
  harina de otro costal. Pendiente.

  (`multer` **no** es problema, pese a lo que sugiere el aviso de
  deprecación al instalar: `npm audit` no lo reporta. `1.4.5-lts.2` es la
  rama con los parches aplicados. El aviso dice que 1.x «está impactado»
  y eso invita a confundirlo con una alerta abierta.)
- `xlsx` sigue con vulnerabilidad alta y **sin arreglo disponible**. Es la
  única que queda en `npm audit`. Aceptable mientras solo se procesen
  archivos oficiales desde la línea de comandos, **no** si algún día un
  cliente sube su propio Excel por web.

### 5d. Mantenimiento de las tres instancias (7 de agosto de 2026)

Todo lo de esta sección se aplicó a **las tres** —plantilla y dos
campañas— con la regla de que queden iguales. Cada script acepta la ruta
de un sitio y por omisión recorre los tres.

**La importación de votantes por Excel no tenía guarda de rol.**
`votantes.routes.js` tiene `router.use(requireAuth, calcularAlcance)`,
que exige sesión pero **incluye a líderes y sublíderes**. Cualquiera de
ellos podía subir un Excel que `xlsx` parsea —vulnerabilidad alta, sin
arreglo disponible— y que inserta y actualiza votantes en masa.

De las seis rutas de Excel de la app, era la única sin guarda. Se le puso
`requireRole('admin', 'coordinador')` (`aplicar_guarda_importar.sh`).

`requireRole` va **antes** de `uploadExcel`: al revés, multer leería el
archivo entero a memoria y `xlsx` podría verlo antes de comprobar quién
lo manda.

**Pero NO era un olvido, y eso cambia lo que significa el parche.** La
primera lectura fue que faltaba la guarda por descuido, comparando con
`/exportar-excel` del mismo archivo. Al mirar el front apareció otra
cosa: el botón de importar no está atado a esos roles, sino a
`puedeAgregar(usuario, 'votantes')` — que **incluye a los líderes**,
cuyo trabajo es registrar gente. La asimetría era deliberada: exportar
saca toda la base (sensible), importar mete contactos propios
(comodidad). Comparé con la ruta equivocada.

Así que este cambio **quita una función que los líderes tenían**. Fue
una decisión tomada a propósito, no un efecto secundario: reducir al
mínimo quién le puede entregar un archivo a `xlsx`. Si un líder necesita
cargar una lista, ahora la sube un coordinador.

`ocultar_boton_importar.sh` oculta además el botón a quien no tenga el
rol: un permiso que se niega en el servidor pero se ofrece en la
pantalla es peor que no ofrecerlo — la persona cree que algo se rompió.

**El día que se migre de `xlsx` a una librería mantenida, esta
restricción se puede levantar.** Ese es el arreglo de fondo; éste es el
parche mientras tanto.

**Los mensajes de duplicado no decían qué campo.** «Ya existe un usuario
con ese email, número de identificación o nombre de usuario» —los tres a
la vez—. En el log se ve el efecto: alguien cambió el **correo** tres
veces seguidas cuando lo repetido era la **cédula**. Ahora lo nombra,
leyéndolo del `sqlMessage` que MySQL ya envía
(`config/erroresUsuarios.js`).

**El log llevaba el hash de la contraseña.** `console.error(err)` imprime
el objeto entero de mysql2, con `err.sql` dentro — y en la tabla
`usuarios` esa sentencia incluye `password_hash`, que quedaba en texto
plano en el log de PM2. Se registra código, mensaje y traza; la sentencia
no. **La traza se conserva a propósito**: quitarla para tapar el hash
cambiaría un problema por otro.

**Dos falsas alarmas, y las dos por afirmar antes de medir:**

- Los **321 reinicios** de Electoral no eran un bucle. Medido dos veces
  con 20 s de diferencia: el contador no se movía, `unstable restarts: 0`.
  Eran acumulados de la propia jornada.
- El `ER_NO_REFERENCED_ROW_2` al cerrar sesión **ya estaba manejado**. La
  copia local de `registrarAuditoria` en `auth.routes.js` sí tiene
  `try/catch`, igual que la de `config/auditoria.js`. Lo único real es
  que el registro se pierde: `usuario_id` acepta `NULL` y ese evento se
  podría guardar sin autor. Pendiente, y menor.

Y una corrección que importa para no perseguir al fantasma equivocado:
**`multer` no es un problema.** `npm audit` no lo reporta;
`1.4.5-lts.2` es la rama con los parches. El aviso que aparece al
instalar es de **deprecación**, y dice que 1.x «está impactado», lo que
invita a confundirlo con una alerta abierta. El riesgo real era `xlsx`.

### 5c. Lugar de votación desde el catálogo — resuelto (7 de agosto de 2026)

El desplegable de Puesto en «Agregar persona» se llenaba con
`/dia-d/puestos-para-reporte`, que devuelve `dia_d_puestos_votacion`: los
puestos que la campaña va a **cubrir con testigos**. Eso es otra cosa que
**dónde vota** una persona.

Se veía así: en la campaña departamental (ámbito Caldas) se elegía
Antioquia / Puerto Berrío y salían los 332 puestos de Caldas. Un líder que
vote fuera del ámbito no se podía registrar.

Ahora la cascada Departamento → Municipio → Puesto → Mesa lee el catálogo
(`parche_cascada_votacion/`): rutas nuevas en `/api/catalogo`, y un módulo
`public/js/lugar-votacion-catalogo.js` hermano de `mesas-testigo.js`.

**`testigos.html` NO se tocó.** Allí el puesto sí es el de la campaña. Y
dentro de `territorial.html` y `votantes.html`, al marcar «Es también
testigo electoral» el módulo **se hace a un lado** y devuelve la lista de
la campaña: los dos desplegables siguen sincronizados como antes, y el
Día D no cambia.

**Las mesas no se consultan.** Medido sobre los 12.885 puestos activos: la
numeración es siempre 1..N, sin huecos, y `total_mesas` coincide con el
conteo real en los 12.885. Cero excepciones. El límite sale de ese número.

**Un solo nombre en todo el país no cruzaba.** Auditando `colombia.json`
—el archivo estático del que Electoral sacaba los departamentos— contra el
catálogo, con la colación de la base y comparación estricta: 33 de 33
departamentos y **1.121 de 1.122 municipios**. El que faltaba:

```
colombia.json ..... «Bogotá D.C.»
catálogo .......... «BOGOTÁ, D.C.»    (id 213, DANE 11001, 962 puestos)
```

Una coma. `utf8mb4_0900_ai_ci` ignora mayúsculas y tildes, no puntuación.

**Y fallaba solo el municipio, no el departamento.** El departamento
Bogotá ya tenía cuatro alias de una importación anterior; el municipio no
tenía ninguno. Como la cascada resuelve primero el departamento y después
el municipio dentro de él, el primer paso pasaba y el segundo no.
Resuelto en `database/10_alias_bogota_municipio.sql`. **Que un nivel de la
jerarquía cruce no dice nada del siguiente: la auditoría tiene que
recorrer los dos.**

Al agregarlo, `uq_alias` es sobre `alias_normalizado`, no sobre `alias`:
«Bogotá D.C.» y «Bogota D.C.» son la **misma** fila. Meter las variantes
de una hizo que el `INSERT` chocara consigo mismo, donde el `NOT EXISTS`
no ve lo que la propia sentencia inserta. Una por forma normalizada.

### 5b. Campaña departamental de prueba — desplegada (7 de agosto de 2026)

`campanadepruebadepartamental.appestrategia.net`, puerto 3102, ámbito
Caldas (id 7). Es la primera campaña que **nace** vinculada al catálogo,
y la primera donde la siembra de puestos corre de verdad — en la
municipal la guarda la bloquea a propósito, porque sus 51 testigos
tienen el puesto en texto libre.

| Control | Valor |
|---|---|
| Territorios cargados en tabla local | **0** |
| Territorios visibles vía catálogo | 1.162 (27 municipios, 114 barrios, 1.001 veredas, 19 de Manizales) |
| Puestos sembrados | 332, todos con `ctc_puesto_id` |
| Nombres de puesto distintos | 332 |
| Suma de mesas | 2.551 |

Dos scripts nuevos: `crear_campana_departamental.sql` llena la base, y
`desplegar_campana_departamental.sh` copia el código y levanta el
proceso.

**La base y el usuario se crean en CloudPanel, no por SQL** — ver la
nota de acceso al final del documento. El script SQL empieza con `USE`
y un `SIGNAL` que aborta si la base no existe o no está vacía, en vez de
crearla.

**El código se copia de Electoral, no de otra campaña.** Cada instancia
tiene su propia copia; la municipal es una foto del 2 de agosto y no
tiene los parches de hoy. Y no se copian: `.env` (credenciales de otra
base), `node_modules`, `uploads/`, `backups/`, ni
`.licencia-cache.json` — la licencia va atada al dominio y cada campaña
necesita la suya, emitida en `licencias.appestrategia.net`. El
`SESSION_SECRET` se **genera**, nunca se copia: compartirlo haría que
una cookie de sesión de una campaña valiera en la otra.

**Parchear una instancia no parchea las demás, y nada avisa.** Ese mismo
día, tras aplicar el parche de solo lectura a Electoral, se comprobó
`campanadepruebamunicipal` y dio **cero**: su base ya tenía la vista
`territorios` pero su código seguía sin la guarda. Es la peor
combinación — el `DELETE FROM territorios` sin `WHERE` de
`eliminar-todo` sigue en el código y falla con el «target table is not
updatable» crudo de MySQL, que a un usuario no le dice nada. Por eso
`aplicar_parche_territorial.sh` ahora **acepta la ruta del archivo**;
sin argumento sigue apuntando a Electoral.

(Ojo con `--simular`: **no escribe**. Muestra dónde quedarían las seis
guardas y sale. Reiniciar después de una simulación reinicia el mismo
código de antes.)

### 5e. Lo que aprendió Electoral consumiendo el catálogo (8 de agosto de 2026)

Un día entero de trabajo del lado de Electoral, usando el catálogo de verdad
en una campaña departamental. No se tocó nada del CTC; lo que sigue son
hechos sobre su forma que rompieron al consumidor, y que conviene saber
antes de escribir el siguiente.

**Las veredas cuelgan del MUNICIPIO, no del corregimiento.** Medido sobre
las 32.016 activas:

```
padre tipo 30 (Municipio) ...... 31.927
padre tipo 41 (Corregimiento) ..      48
padre tipo 32 (ANM) ............      41
```

La capa de corregimiento existe en el modelo pero **está prácticamente
vacía**: 48 veredas de 32.016. Cualquier consumidor que recorra
vereda → corregimiento → municipio va a encontrar una lista vacía y a
concluir que no hay datos. Electoral lo hacía, y en Quindío mostraba **0 de
232 veredas** sin dar ningún error — la pantalla simplemente decía "No hay
veredas creadas aún".

**El catálogo no trae comunas ni barrios.** Los crea cada campaña en su
propia tabla. El ámbito de Quindío, tal como lo ve una campaña
departamental:

```
12 municipios · 232 veredas · 0 comunas · 0 corregimientos · 0 barrios
```

Por eso Electoral dejó de **exigir** Barrio, Corregimiento o Vereda cuando
no existe ninguno en ese municipio: baja al nivel que sí exista y, en
último caso, al municipio. Un formulario que pide llenar un campo cuyo
desplegable está vacío es imposible de guardar, y nada explica por qué.

**Filtrar puestos por municipio se hace por `municipio_id`, no por el
nombre.** Los puestos que `sembrar_puestos_campana.sql` deja en la campaña
llevan el municipio pegado al nombre —`LA FLORESTA (SALAMINA)`— para
desambiguar dentro del departamento, pero ese texto no sirve para filtrar.
El cruce va por la referencia:

```sql
FROM dia_d_puestos_votacion p
LEFT JOIN territoriosdb.ctc_puestos_votacion cp ON cp.id = p.ctc_puesto_id
LEFT JOIN territoriosdb.ctc_territorios m ON m.id = cp.municipio_id
WHERE p.ctc_puesto_id IS NULL OR m.nombre = ?
```

Los que no tienen `ctc_puesto_id` (creados a mano) se dejan pasar siempre:
no se pueden atribuir a ningún municipio, y esconderlos borraría de la
lista puestos reales que quizá ya tienen testigos asignados. En Quindío el
filtro baja de 130 puestos a 53 en Armenia y 16 en Calarcá.

**Cifras del catálogo verificadas de nuevo el 8 de agosto**, todas iguales
a las de la tabla de arriba: 33 departamentos, 1.122 municipios, 32.016
veredas, 8.560 centros poblados, 12.885 puestos, 119.745 mesas y las 16
filas en `FUSIONADO`. Un día de uso intensivo no movió nada, que es lo
esperable de un catálogo de solo lectura — pero se comprobó en vez de
suponerlo.

### 6. Veredas duplicadas en Manizales — resuelto (7 de agosto de 2026)

Manizales mostraba 78 veredas pero solo 61 eran reales. Las otras 17 eran
fichas que dejó la migración de la campaña: colgando de un corregimiento,
`fuente_id = 8` (MANUAL), sin código y **sin un solo polígono** — las 61
buenas tenían los 61. Se veía buscando «Morrogacho» en el panel: salían
dos veredas, una con código `17001052` y otra sin nada.

**Por qué el importador no las reconciliaba.** No era el fallo de índice
por corregimiento — eso ya estaba resuelto (`importar_veredas.js` indexa
por el municipio de la `ruta`). Era que la fila del DANE **ya existía con
su código**, así que la regla 1 (cruce por código) la encontraba de una y
la ficha vacía nunca entraba a evaluarse. Por eso cada corrida reportaba
«62 reconciliadas, 0 nuevas»: el importador creía que había hecho bien su
trabajo.

**La solución: fusionar, no borrar** (`database/07_fusionar_veredas_manizales.sql`).
El esquema ya traía `estado = 'FUSIONADO'` y `sucesor_id` desde el
principio y **nadie los había usado nunca** — las 41.881 filas estaban en
`ACTIVO`. Usarlos respeta la regla 1 mucho mejor que un `DELETE`: el `id`
sigue resolviendo, queda registrado a dónde fue cada ficha, y se deshace
con un `UPDATE` (documentado al final del script).

Y no hizo falta tocar código: todas las consultas de
`services/territorios.service.js` filtran por `estado = 'ACTIVO'`, así que
las fusionadas desaparecieron del panel solas.

Se fusionaron **16**, no 17. Dos detalles del cotejo:

- Alto Corinto y Bajo Corinto van las dos a la misma vereda: el DANE las
  tiene como una sola, `ALTO Y BAJO CORINTO` (17001008).
- **La Francia (id 1342) NO era duplicado y sigue activa.** El DANE no
  tiene ninguna vereda con ese nombre en Manizales; existe además como
  barrio (id 1211), el patrón de siempre aquí. Es conocimiento de la
  campaña que el catálogo no traía. Por eso Manizales queda con **62**
  veredas activas y no 61.

**Si vuelve a pasar en otro municipio**, el patrón para detectarlo es:
vereda `ACTIVO`, sin fila en `ctc_codigos` para `DANE_VEREDAS` y sin fila
en `ctc_territorio_geom`. Una vereda real del DANE siempre tiene las dos.

### Nota: acceso de solo lectura a bases de otras apps (7 de agosto de 2026)

**Herramienta:** `ejecutar_como_root.sh <archivo.sql> [base]` hace todo el
ciclo (entrar en modo recuperación, ejecutar, restaurar, reiniciar) con la
restauración en un `trap ... EXIT`, así que corre aunque el SQL falle o se
cierre la terminal. Nació porque pegar el bloque a mano se cortó dos veces
en la terminal del navegador, y una de ellas dejó MySQL con
`--skip-networking` durante 13 minutos: las siete apps caídas. Desde
adentro no se nota — el cliente de consola entra por socket y parece que
todo está bien; las apps entran por TCP y no.

`territoriosuser` tiene `GRANT SELECT` sobre `electoraldb.*` y
`campanadepruebamunicipal.*` — útil para investigar los pendientes 2 y 3
sin depender de código ajeno. `territoriosuser` no tiene `GRANT OPTION` ni
privilegio sobre ninguna otra base: cualquier permiso nuevo (en cualquier
sentido) necesita el root de MySQL, gestionado por CloudPanel
(`clpctl db:show:master-credentials` — pero esa contraseña estaba
desincronizada de la real; la vía que funcionó fue reiniciar `mysqld` con
`MYSQLD_OPTS="--skip-grant-tables --skip-networking"` en
`/etc/default/mysql`, aplicar el cambio, y revertir. Ese archivo no existe
por defecto en esta instalación de Percona Server; systemd lee
`ExecStart=/usr/sbin/mysqld $MYSQLD_OPTS` y crea `RuntimeDirectory=mysqld`
solo, así que hay que reiniciar **por systemd**, no con `mysqld_safe` a
mano — sin pasar por systemd, `/var/run/mysqld` no existe y falla.

**El root de MySQL ya entra con contraseña — pero solo por TCP.** Tras
`resincronizar_root_mysql.sql`, la clave de `clpctl` funciona:

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p
```

El `-h 127.0.0.1` **no es opcional**. Sin él el cliente entra por *socket*,
que es la cuenta `root@localhost`, y esa quedó con otra clave — la
resincronización solo alineó la de TCP. Comprobado el 7 de agosto de 2026:
por TCP `root@127.0.0.1` con 70 privilegios; por socket `Access denied`.
Quien olvide la bandera va a creer que la contraseña sigue mala y va a
repetir todo el via crucis del modo recuperación.

**Bases y usuarios se crean en CloudPanel, no por SQL.** CloudPanel lleva
su propio registro; una base creada por fuera no aparece en el panel y
queda desalineada — la misma clase de desincronización que costó seis
reinicios de MySQL. La convención tampoco es la de las apps: éstas usan
`<app>db` / `<app>user`, pero **las campañas van sin sufijo y con
prefijo**:

```
campanadepruebamunicipal          <- la base
usercampanadepruebamunicipal      <- su usuario
```

---

## API v1

Autenticación por llave: `Authorization: Bearer ctc_…` o `X-API-Key: ctc_…`.
Solo lectura. Límite por hora y ámbitos por cliente.

```
GET /api/v1/territorios/buscar?q=manizales&nivel=MUNICIPIO
GET /api/v1/territorios/dane/17001
GET /api/v1/territorios/codigo/REGISTRADURIA/09001
GET /api/v1/territorios/:id/hijos?nivel=SUBMUNICIPAL
GET /api/v1/territorios/:id/descendientes?nivel=LOCAL
GET /api/v1/territorios/punto?lon=-75.51&lat=5.07
GET /api/v1/puestos?dane=17001
GET /api/v1/geo/:id.geojson
GET /salud
```

Niveles: `DEPARTAMENTO`, `MUNICIPIO`, `SUBMUNICIPAL`, `LOCAL`.

---

## Verificación antes de depurar

Confirmar siempre que el archivo desplegado es el que se subió:

```bash
grep -c "cadena_unica" archivo.js
pm2 describe territorios | grep -E "uptime|restarts"
```

Varias sesiones se perdieron depurando código que nunca llegó al servidor.
