---
id: mod-recordatorios
titulo: Recordatorios automáticos
seccion: administracion
orden: 480
icono: campana
modulo: recordatorios
nivel: ver
roles:
ruta: Escritorio: Configuración > Recordatorios
captura:
---
Los recordatorios son mensajes que salen solos, sin que nadie los mande: el aviso de un evento horas antes y, el día de la elección, la pregunta «¿ya votaste?». Esta pantalla los enciende, fija cuántos SMS se pueden gastar al día y deja ver todo lo que se mandó.

## Qué encuentras

- **Configuración**:
  - El interruptor **Recordatorios automáticos encendidos**. Apagado, no sale nada, aunque haya reglas activas. Viene apagado de fábrica.
  - La **Fecha permitida de propaganda**. Desde esa fecha los mensajes pueden hablar de voto, elección, urnas, tarjetón o cargo. Vacía quiere decir «nunca», que es lo correcto en precampaña.
  - El **Tope diario de SMS automáticos**, con el saldo y el límite diario del libro central a la vista. Nunca puede pasar de ese límite.
  - Las **Horas de silencio** (de fábrica, de 20:00 a 08:00). En ese rato no sale nada: ni aviso en la app, ni correo, ni SMS.
- **Reglas**: una por cada mensaje automático. De fábrica hay siete, todas apagadas: el recordatorio de un evento 24 horas y 2 horas antes (por SMS, por aviso en la app y por correo) y dos rondas del «¿ya votaste?» (14:00 y 15:00). Cada una muestra cuándo sale, si está activa y cuántos envíos lleva.
- **Historial de envíos**, con filtros por estado, por motivo de omisión y por regla.

## Qué puedes hacer según tu permiso

- **Ver**: abrir la pantalla, ver las reglas y el historial.
- **Editar**: cambiar la configuración, activar o apagar reglas, editar su texto y pedir una prueba. De fábrica, esta pantalla es solo del administrador.

## Tareas frecuentes

- Encender los recordatorios de eventos: {{t-recordatorios-activar}}.
- Ver por qué un mensaje no salió: en el historial, filtra por estado **Omitido** y mira su motivo.
- Revisar cuánto SMS se gastó hoy: bajo el tope diario, «Hoy van … de …».

::: importante
Los recordatorios de un evento le llegan al **equipo** solo como aviso en la app. Por SMS o correo solo le llegan a los votantes inscritos en ese evento que autorizaron ese medio: si la autorización no consta, o la persona pidió no recibir más mensajes, el recordatorio no sale.
:::

::: consejo
El recordatorio de un evento por SMS lleva al final el enlace de baja y tiene que caber en un solo mensaje. Por eso el texto de fábrica es corto, y si el lugar o el nombre del evento son muy largos, se acortan con «...» (primero el lugar, después el evento). El enlace de baja nunca se acorta. Mientras escribes una regla, la pantalla cuenta los caracteres con ese enlace incluido.
:::
