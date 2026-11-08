---
id: mod-enviar_email
titulo: Enviar E-mail
seccion: durante
orden: 262
icono: correo
modulo: enviar_email
nivel: ver
roles:
ruta: Escritorio: CRM y mensajería > Enviar E-mail
captura:
---
Sirve para correos puntuales a una persona o a un grupo pequeño, mandados desde el correo de la campaña. Para envíos masivos usa CRM y Mensajes, que sale por un servicio de correo masivo.

## Qué encuentras

- **Paso 1, a quién**: un buscador por nombre, cargo o nivel (Votantes, Estructura, Organigrama), un cuadro para pegar correos a mano con [[Agregar]], y [[+ Agregar grupo o subgrupo]] para sumar un grupo por territorio, cargo o nivel. Quienes eliges quedan en **Seleccionados**, con una equis para quitarlos.
- **Paso 2, el mensaje**: **Asunto**, **Mensaje** con `{nombre}` y plantillas guardadas. El botón [[Enviar E-mail]] manda el correo.
- **Historial de envíos**: Nombre, Estado, Destinatarios, Enviados, Fallidos, Omitidos y Fecha, con [[Ver detalle]] y [[Eliminar]].

## Qué puedes hacer según tu permiso

- **Ver**: consultar el historial y el detalle.
- **Agregar**: escribir y enviar correos (administrador, coordinador y líder).
- El botón **Eliminar todas** del historial lo ve solo el administrador.

## Tareas frecuentes

- Mandar un correo a un grupo pequeño: elige personas, escribe el asunto y el mensaje, y pulsa [[Enviar E-mail]].
- Ver quién se omitió: abre [[Ver detalle]] y mira la columna Estado.
- Un envío grande o programado: usa {{t-crm-campana}}.

::: cuidado
Se omite a quien pidió no recibir más, a quien no autorizó el correo, a quien no tiene correo registrado y a quien se inscribió por enlace y no ha confirmado. La columna **Omitidos** los cuenta.
:::
