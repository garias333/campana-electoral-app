---
id: t-logistica-plan
titulo: Armar el plan de logística
seccion: dia-d
orden: 371
icono: lista
modulo: logistica_dia_d
nivel: editar
roles:
ruta: Escritorio: Día D > Logística del Día D
captura:
---
Define qué se entrega, a quién y a qué hora, corrige las cantidades de cada puesto y saca la lista de compras.

## Pasos

1. Abre **Día D > Logística del Día D** y baja a la tarjeta **Ítems**.
2. Para crear uno, escribe el nombre (hasta 80 caracteres), elige **Testigos** o **Conductores**, pon la hora límite si quieres y toca [[Agregar ítem]].
3. Para cambiar uno, edita su fila y toca [[Guardar]]. Puedes cambiar nombre, para quién, hora, **Incluir suplentes** y **Activo**.
4. En **Plan por puesto** cambia la cantidad que quieras. Se guarda sola. Una cantidad en naranja fue corregida a mano.
5. Para volver a la cantidad sugerida, toca ↺ junto a ella.
6. Toca [[⬇ Exportar a Excel]] para bajar el libro con tres hojas: *Lista de compras*, *Por puesto* y *Testigos* (con cédula enmascarada).

Los ítems no se borran: se desactivan quitando la marca **Activo**. Un ítem para conductores no tiene cantidad por puesto; su total es el número de conductores activos.

## La alerta «Logística sin entregar»

El día de la elección sale en **Alertas** cuando un ítem con hora límite ya venció y hay testigos que ya llegaron (marcaron «Llegué») sin recibirlo. Antes de la hora aparece en gris. Dice, por ejemplo, «Puesto Escuela Central: 2 testigos sin refrigerio a las 12 m.».

::: listo
Ves «Ítem guardado.», «Ítem agregado.» o «Cantidad guardada.», y el total a comprar cambia.
:::

::: cuidado
Desactivar un ítem lo quita del total y del contador, pero las entregas ya hechas se conservan. Cambia las cantidades antes del día de la elección.
:::

Ver también: {{mod-logistica_dia_d}}.
