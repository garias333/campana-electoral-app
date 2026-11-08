---
id: t-transporte-alerta
titulo: La alerta de transporte sin recoger
seccion: dia-d
orden: 366
icono: alerta
modulo: transporte_dia_d
nivel: ver
roles:
ruta: Escritorio: Día D > Alertas del Día D | Celular: Alertas Día D
captura: t-transporte-alerta.webp
---
La alerta «Transporte sin recoger» te avisa que en un puesto hay personas esperando que las recojan, para que actúes antes de que cierren las urnas.

## Cuándo salta

- **Solo el día de la elección.** Sin fecha de elecciones configurada, o en otro día, no aparece.
- **Desde las 2:00 p. m.** por defecto. Antes de esa hora la alerta se ve en gris, como «Pendiente: se activa a las 14:00».
- El administrador cambia la hora en **Configuración > Datos de la campaña**, en el campo «Transporte sin recoger: avisar desde las».

## Qué cuenta

Por cada puesto suma dos grupos de personas que **no han votado**:

- las que tienen conductor y siguen en estado «Asignado» (aún no las recogen);
- las marcadas «necesita transporte» que no tienen conductor.

El texto dice, por ejemplo, «Puesto Escuela Central: 3 personas con transporte sin recoger (1 sin conductor)».

## Pasos

1. Abre **Día D > Alertas del Día D** y toca el chip [[Transporte sin recoger]].
2. Lee el puesto y cuántas personas faltan; entre paréntesis, cuántas no tienen conductor.
3. Si hay personas sin conductor, asígnalas en **Transporte del Día D** ({{t-asignacion}}).
4. Si ya hay conductor, llámalo para saber dónde va.
5. Cuando lo resuelvas, toca [[Atendida]] y, si quieres, escribe qué hiciste.

::: listo
La alerta se ve atenuada con «Atendida por…» y su nota. Si todas las personas son recogidas o votan, la alerta desaparece sola.
:::

::: consejo
Con los avisos por notificación encendidos, la coordinación también recibe un aviso en el celular, como máximo uno cada 5 minutos. Si eres coordinador con una rama, ves solo las personas de tu alcance.
:::
