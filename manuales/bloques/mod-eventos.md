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
- **Asistencia**: cuántas personas hay registradas (invitadas) en el evento, la meta si la pusieron (por ejemplo 12/40) y, debajo, **«asistieron N»**: a cuántas se les marcó que llegaron. Las marcas se hacen en [[Asistentes a reuniones]] (escritorio) o en la app del celular.
- Un pin junto al lugar significa que el evento ya quedó **georreferenciado**.
- Botón [[+ Nuevo evento]] arriba, y en cada fila [[Editar]] y [[Eliminar]].
- Dos botones de ubicación en el mapa, que solo ve el administrador: [[Re-geocodificar pendientes]] y [[Corregir ubicaciones existentes]].

## En el celular

En la app, menú **Eventos** (aparece si tienes «Ver» en Eventos, Agenda o Asistentes a reuniones). Ves **tus eventos**: los de hoy, los próximos y los de los últimos 7 días, con su fecha, su lugar y «N / meta invitados». Al abrir uno ves a sus invitados **solo con nombre y barrio** (nunca teléfono ni cédula) y un botón grande **Asistió** por persona; arriba, un buscador por nombre. Quien es líder, coordinador o administrador también puede **Agregar asistente por cédula** (tiene que ser alguien de su equipo y hace falta señal).

- **Sin señal** puedes marcar «Asistió»: la marca queda en tu teléfono y sube sola cuando vuelve la conexión. Si tocas varias veces a la misma persona, vale lo último. Los eventos quedan guardados 48 horas (o hasta que cierres sesión).
- **Sublíder**: solo marca asistencia, y solo en los eventos donde es el responsable o está invitado. No agrega asistentes ni edita el evento.

## Qué puedes hacer según tu permiso

- **Ver**: consultar la tabla. Los testigos e invitados solo pueden mirar.
- **Editar**: cambiar un evento con [[Editar]] (administrador, coordinador y líder).
- **Agregar**: crear eventos con [[+ Nuevo evento]] (administrador, coordinador y líder).
- **Eliminar**: solo el administrador y el coordinador. La app pregunta «¿Eliminar este evento?»; al confirmar con [[Sí, eliminar]] se borran también sus asistentes registrados y no se puede deshacer.

## Tareas frecuentes

- Crear una reunión: {{t-evento-agregar}}.
- Registrar quién asistió: {{t-asistencia}}.
- Ver quién repite en las reuniones: {{mod-asistentes_reuniones}}.

::: consejo
Si un evento no sale en el mapa, revisa que tenga **Dirección del evento**, Departamento y Ciudad. El administrador puede pedir que se vuelva a intentar con [[Re-geocodificar pendientes]].
:::
