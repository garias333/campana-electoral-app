---
id: t-encuesta-resultados
titulo: Leer los resultados de una encuesta y sacarlos a Excel
seccion: durante
orden: 256
icono: grafico
modulo: encuestas
nivel: ver
roles:
ruta: Escritorio: Electoral > Encuestas internas
captura:
---
Sirve para ver qué dicen las respuestas de una encuesta, zona por zona, sin que ninguna cifra señale a una sola persona.

## Pasos

1. En el menú del computador, entra a Encuestas internas y toca la encuesta (publicada o cerrada).
2. Abajo del editor, en la pestaña **Resultados**, elige cómo **agrupar**: por la zona de cada respuesta, o por la zona que la contiene (para juntar barrios chicos en su comuna).
3. Lee cada pregunta: la fila **Todas las zonas** y una fila por zona. Las zonas con pocas respuestas aparecen juntas como **Otras zonas**.
4. Mira la **Cobertura**: cuántas respuestas hay en cada zona frente a los votantes registrados. Una zona marcada como **sobrerrepresentada** aporta mucho más de la muestra de lo que pesa entre los votantes.
5. Para llevártelo, toca [[Descargar en Excel]] (solo si tienes el permiso de Importar / Exportar).

::: listo
Ves las cifras por zona y la franja «Uso interno – no publicable». El Excel trae una hoja de **Notas**, otra de **Resultados**, una de **Cobertura** y una de **Cuotas**, y la marca en cada una.
:::

## Qué NO vas a ver, y por qué

- **Una zona con menos respuestas que el mínimo** (5 o más, según fije el administrador): sus cifras se juntan en «Otras zonas», y si ni juntas llegan al mínimo, no se muestran. Así nadie puede restar un total y descubrir lo que respondió una persona.
- **Las respuestas que el administrador tiene en revisión**: la pantalla dice cuántas hay, no cuáles.
- **Los textos libres**: no entran en los resultados ni en el Excel.
- **Filtros por fecha o por aplicador**: no existen a propósito, porque dos consultas que difieren en un día o en una persona se pueden restar.

::: cuidado
Lo que aplica el equipo es una muestra de conveniencia, no una encuesta técnica. No lo publiques ni lo presentes como encuesta de opinión.
:::
