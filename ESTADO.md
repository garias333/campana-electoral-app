# ESTADO — electoral

> Bitácora de handoff entre máquinas. La escribe `/cierre` al final de cada
> sesión y el hook de apertura la inyecta automáticamente al iniciar.
> El contexto permanente (arquitectura, puertos, reglas de despliegue) va en
> CLAUDE.md, no aquí.

## Anclas verificables

*Todas medidas al cierre del 31 de agosto de 2026, no heredadas de la sesión
anterior.*

- **Último parche generado, publicado y registrado:** **249**.
- **Aplicado en las tres instalaciones:** **249**, comprobado leyendo
  `.version-parche` de cada una. El registro del actualizador de la campaña
  municipal termina en «Parche #249 aplicado correctamente».
- **Service worker:** `estrategia-v121` en las tres.
- **`scripts/comparar-instancias.js`:** 137 archivos, **1 sola diferencia** en
  cada campaña — `scripts/calibrar_cohortes.js`, que existe solo allí. No es
  deriva real: se borró aquí en la limpieza y **el sistema de parches no sabe
  borrar** (`unzip -o`). Se quita a mano en cada servidor o se deja; no estorba.
- **Rama:** `auditoria-fable`. **Último commit:** ver `git log -1`. Árbol limpio.
- **ELECTORAL CORRE CÓDIGO VIEJO.** Su proceso (pid 1374446) arrancó a las
  03:16:04 y el archivo más nuevo del disco es de las 03:29:37. Las campañas sí
  están al día porque el actualizador las reinicia solo; **electoral no se
  reinicia sola**. Primer comando de la próxima sesión, como root:
  `bash scripts/reiniciar-instancia.sh appestrategia-electoral`
  La prueba es que el PID cambie, no que el puerto responda.

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
