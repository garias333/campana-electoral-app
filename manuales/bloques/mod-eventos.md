---
id: mod-eventos
titulo: Eventos y GOTV
seccion: durante
orden: 230
icono: calendario
modulo: eventos
nivel: ver
roles:
ruta: Escritorio: Logística > Eventos y GOTV
captura: mod-eventos.webp
---
Aquí ves los eventos de la campaña con su fecha, su lugar y quién responde por cada uno. Los que tienen dirección se ubican en el mapa.

## Qué encuentras

- **Tabla de eventos**, ordenada por cercanía a la fecha de hoy. Columnas: Evento, Tipo, Fecha, Lugar, Responsable, Coordinador, Líder, Asistencia y Estado.
- **Tipo**: Reunión, Evento público, GOTV (movilización), Capacitación u Otro.
- **Estado**: Programado, Realizado o Cancelado.
- **Asistencia**: cuántas personas hay registradas en el evento, y la meta si la pusieron (por ejemplo 12/40). Cuenta a las registradas, no confirma quién llegó.
- Un pin junto al lugar significa que el evento ya quedó **georreferenciado**.
- Botón [[+ Nuevo evento]] arriba, y en cada fila [[Editar]] y [[Eliminar]].
- Dos botones de ubicación en el mapa, que solo ve el administrador: [[Re-geocodificar pendientes]] y [[Corregir ubicaciones existentes]].

## Qué puedes hacer según tu permiso

- **Ver**: consultar la tabla. Los testigos e invitados solo pueden mirar.
- **Editar**: cambiar un evento con [[Editar]] (administrador, coordinador y líder).
- **Agregar**: crear eventos con [[+ Nuevo evento]] (administrador, coordinador y líder).
- **Eliminar**: solo el administrador y el coordinador. Al borrar un evento se borran también sus asistentes registrados.

## Tareas frecuentes

- Crear una reunión: {{t-evento-agregar}}.
- Registrar quién asistió: {{t-asistencia}}.
- Ver quién repite en las reuniones: {{mod-asistentes_reuniones}}.

::: consejo
Si un evento no sale en el mapa, revisa que tenga **Dirección del evento**, Departamento y Ciudad. El administrador puede pedir que se vuelva a intentar con [[Re-geocodificar pendientes]].
:::
