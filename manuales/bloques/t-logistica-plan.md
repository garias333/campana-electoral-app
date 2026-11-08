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
captura: t-logistica-plan.webp
---
Define qué se entrega, a quién y a qué hora, corrige las cantidades de cada puesto y saca la lista de compras.

## Pasos

1. Abre **Día D > Logística del Día D** y baja a la tarjeta **Ítems**. De fábrica trae *Kit de testigo* (hasta las 07:00), *Refrigerio* (12:00) y *Almuerzo* (14:00).
2. Para crear uno, escribe el nombre en «Nuevo ítem» (hasta 80 caracteres; no puede repetirse), elige **Testigos** o **Conductores**, pon la hora límite si quieres y toca [[Agregar ítem]].
3. Para cambiar uno, edita su fila y toca [[Guardar]]. Puedes cambiar nombre, para quién, hora, **Incluir suplentes** y **Activo**.
4. En **Plan por puesto** cambia la cantidad que quieras (un número entero de 0 a 9999). Se guarda sola al salir de la casilla.
5. Una cantidad corregida a mano se ve con el borde de color ocre y trae junto a ella el botón ↺. Tócalo (o deja la casilla vacía) para volver a la cantidad sugerida.
6. Toca [[⬇ Exportar a Excel]] para bajar el libro con tres hojas: *Lista de compras*, *Por puesto* y *Testigos* (con cédula enmascarada).

Los ítems no se borran: se desactivan quitando la marca **Activo**. Un ítem para conductores no tiene cantidad por puesto; su total es el número de conductores activos.

## La alerta «Logística sin entregar»

El día de la elección sale en **Alertas** cuando un ítem para testigos, activo y con hora límite, no se ha entregado a testigos que ya llegaron (tocaron «Llegué a mi puesto»). Cuenta por testigo y por ítem. Antes de la hora límite aparece en gris, como «Pendiente»; desde esa hora, activa. Dice, por ejemplo, «Puesto Escuela Central: 2 testigos sin refrigerio a las 12 m.». Si el ítem no tiene hora límite, no genera alerta. Fuera del día de la elección no aparece.

::: listo
Ves «Ítem guardado.», «Ítem agregado.» o «Cantidad guardada.», y el total a comprar cambia.
:::

::: cuidado
Desactivar un ítem lo quita del total y del contador, pero las entregas ya hechas se conservan. Cambia las cantidades antes del día de la elección.
:::

Ver también: {{mod-logistica_dia_d}}.
