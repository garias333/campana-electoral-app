---
id: mod-encuestas
titulo: Encuestas internas (construir)
seccion: durante
orden: 252
icono: grafico
modulo: encuestas
nivel: ver
roles:
ruta: Escritorio: Electoral > Encuestas internas
captura:
---
Aquí se construyen las encuestas cortas que el equipo aplica en campo desde el celular, también sin señal. Se escribe la encuesta como borrador, se publica y se cierra cuando ya no hace falta. Las respuestas son **anónimas**: no llevan nombre, cédula, teléfono ni ningún vínculo con una ficha de votante.

Son de **uso interno**. Lo que aplica el equipo es una muestra de conveniencia, no una encuesta técnica, y no se divulga: la pantalla lo recuerda con la marca «Uso interno – no publicable».

## Qué encuentras

- **La lista de encuestas**, con su estado (*Borrador*, *Publicada* o *Cerrada*), cuántas preguntas tienen y cuántas respuestas llevan.
- **El editor**: título, descripción, si se ofrece la ubicación y las preguntas en orden. Cada pregunta puede ser de **opción única**, **opción múltiple**, **escala de 1 a 5**, **número** o **texto corto**.
- **Marcas por pregunta**: *Obligatoria* y *Sensible*. Una pregunta sensible (la que toca la opinión política) **nunca** es obligatoria, y una encuesta con alguna pregunta sensible no puede llevar texto corto.
- **«No sabe / No responde»**: se agrega sola a toda pregunta que no sea de texto. No hace falta escribirla.
- **La versión congelada**: al publicar, la encuesta queda con una huella que identifica su contenido exacto. Desde ese momento no se edita.

## Qué puedes hacer según tu permiso

- **Ver**: abrir la lista y el detalle de las encuestas.
- **Agregar**: crear un borrador y duplicar una encuesta como borrador nuevo.
- **Editar**: guardar el borrador, publicar, cerrar y eliminar un borrador.

De fábrica este módulo está **apagado**: solo el administrador lo ve. Aplicar las encuestas en el celular es otro permiso (*Encuestas internas, aplicar en campo*), para que quien aplica no vea cómo van las cifras. Para abrirlos al equipo, el administrador lo hace en Asignación de permisos.

## Reglas que el sistema hace cumplir

- **Antes de la fecha permitida de propaganda** (Configuración → Recordatorios) una encuesta no puede hablar de voto, elección, cargo, candidatos, partidos, apoyo, favorabilidad ni imagen. Si el texto trae una de esas palabras, el sistema dice cuál es y no deja publicar.
- **El día de la elección no se aplica ninguna encuesta.** Ese día la lista del celular aparece vacía y el servidor no recibe respuestas tomadas ese día.
- **Sin texto libre en encuestas sensibles**, y en las demás, máximo 80 caracteres, sin números largos (cédulas, teléfonos) ni correos.
- **Plazo de conservación**: pasados los meses que fije la campaña después de la fecha de la elección, el sistema borra los textos libres y las ubicaciones. Las cifras sin texto ni ubicación se conservan.

## Tareas frecuentes

- Crear, publicar y cerrar una encuesta: {{t-encuesta-crear}}
- Aplicarla en el celular: {{t-encuesta-aplicar}}

::: importante
Una encuesta publicada **no se edita**. Si encuentras un error, duplícala como borrador, corrígela y publícala: la anterior se cierra y sus respuestas se conservan con la versión con la que se tomaron.
:::
