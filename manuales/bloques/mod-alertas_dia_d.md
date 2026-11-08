---
id: mod-alertas_dia_d
titulo: Alertas del Día D
seccion: dia-d
orden: 320
icono: alerta
modulo: alertas_dia_d
nivel: ver
roles:
ruta: Escritorio: Día D > Alertas del Día D | Celular: Alertas Día D
captura: mod-alertas_dia_d-2.webp, mod-alertas_dia_d.webp
---
Es el cuadro de lo que la coordinación debe atender ahora: testigos que no llegan, mesas sin E-14, puestos donde se vota poco. Se recalcula solo, cada 30 segundos en el escritorio y cada minuto en el celular.

## Qué encuentras

- **Chips de tipos**: «Todas» y uno por cada tipo, con su conteo en rojo. Tócalos para filtrar. Lo que aún no toca aparece como «+N pend.».
- **Lista de alertas**: cada una con tipo, puesto y mesa, detalle, desde cuándo, responsable y botones [[Llamar]] y [[WhatsApp]].
- **Insignia roja** en la pestaña «Alertas» del escritorio, con el total de activas.
- **Franja «Modo prueba»** si hoy no es el día de la elección; las alertas se calculan igual.

Estos son los tipos, de más a menos grave: Mesa sin testigo (con votantes), Testigo que no llegó, Mesa sin E-14, Reporte con alertas, Diferencia con el oficial, Baja votación, Transporte sin recoger, Logística sin entregar y Mesa sin testigo (sin votantes).

Las que dependen de la hora salen en gris, «Pendiente: se activa a las…», hasta que les toca. El borde de color indica la gravedad y las atendidas se ven atenuadas. El administrador define horas y umbrales en Configuración > Datos de la campaña, bloque «Jornada del Día D».

## Qué puedes hacer según tu permiso

- **Ver**: consultar el cuadro y contactar al responsable.
- **Editar**: marcar una alerta como [[Atendida]] (con una nota opcional), quitarla con [[Quitar atendida]], o [[Marcar llegada]] de un testigo (sale en «Testigo que no llegó»).
- **Agregar**: no aplica.

## Tareas frecuentes

- Recibir los avisos en el celular: {{t-push-avisos}}.
- Cubrir mesas sin testigo: {{t-cobertura}}.
- Ver diferencias con lo oficial: {{mod-resultados_dia_d}}.

::: consejo
En el escritorio, el botón «N coordinadores sin avisos activados» te da nombres y teléfonos de quienes aún no tienen los avisos en su celular. Tres tipos (mesa sin testigo con votantes, baja votación y transporte) se calculan con los votantes de tu alcance.
:::
