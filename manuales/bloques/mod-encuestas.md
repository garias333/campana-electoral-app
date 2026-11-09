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
- **Resultados** (en una encuesta publicada o cerrada): las cifras por zona y por pregunta, con un **mínimo de respuestas por celda** (5 como mínimo; se puede subir, no bajar). Las zonas con pocas respuestas se agrupan en «Otras zonas» para que ninguna cifra señale a una sola persona. Trae además la **cobertura**: cuántas respuestas hay en cada zona frente a los votantes registrados, para ver si una zona pesa de más.
- **Cuotas por zona**: metas opcionales de respuestas por zona, para ver dónde falta.
- **Calidad** y **Textos libres** (solo el administrador): las respuestas que parecen inventadas quedan **fuera de los resultados** hasta que las revisas, y los textos libres se leen y se borran uno por uno. Nada de esto muestra lo que la gente respondió.

## Qué puedes hacer según tu permiso

- **Ver**: abrir la lista y el detalle de las encuestas, y sus resultados dentro de tu alcance (cada quien cuenta lo de su equipo).
- **Agregar**: crear un borrador y duplicar una encuesta como borrador nuevo.
- **Editar**: guardar el borrador, publicar, cerrar y eliminar un borrador, y fijar las cuotas por zona.
- **Importar / Exportar**: descargar los resultados en Excel, agregados y con la marca «Uso interno – no publicable».

De fábrica este módulo está **apagado**: solo el administrador lo ve. Aplicar las encuestas en el celular es otro permiso (*Encuestas internas, aplicar en campo*), para que quien aplica no vea cómo van las cifras. Para abrirlos al equipo, el administrador lo hace en Asignación de permisos.

## Reglas que el sistema hace cumplir

- **Antes de la fecha permitida de propaganda** (Configuración → Recordatorios) una encuesta no puede hablar de voto, elección, cargo, candidatos, partidos, apoyo, favorabilidad ni imagen. Si el texto trae una de esas palabras, el sistema dice cuál es y no deja publicar.
- **El día de la elección no se aplica ninguna encuesta.** Ese día la lista del celular aparece vacía y el servidor no recibe respuestas tomadas ese día.
- **Sin texto libre en encuestas sensibles**, y en las demás, máximo 80 caracteres, sin números largos (cédulas, teléfonos) ni correos.
- **Plazo de conservación**: pasados los meses que fije la campaña después de la fecha de la elección, el sistema borra los textos libres y las ubicaciones. Las cifras sin texto ni ubicación se conservan.
- **Mínimo por celda**: una cifra por zona solo se muestra si tiene al menos 5 respuestas (o el mínimo que fije el administrador, que solo puede subirlo). Vale igual para el administrador.

## Tareas frecuentes

- Crear, publicar y cerrar una encuesta: {{t-encuesta-crear}}
- Aplicarla en el celular: {{t-encuesta-aplicar}}
- Leer los resultados y sacarlos a Excel: {{t-encuesta-resultados}}
- Revisar la calidad de lo que se aplicó: {{t-encuesta-calidad}}

::: importante
Una encuesta publicada **no se edita**. Si encuentras un error, duplícala como borrador, corrígela y publícala: la anterior se cierra y sus respuestas se conservan con la versión con la que se tomaron.
:::
