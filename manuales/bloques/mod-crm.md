---
id: mod-crm
titulo: CRM y Mensajes
seccion: durante
orden: 260
icono: mensaje
modulo: crm
nivel: ver
roles:
ruta: Escritorio: CRM y mensajería > CRM y Mensajes
captura: mod-crm.webp
---
Es la pantalla para armar envíos masivos por correo, SMS o aviso en la app, y para ver cómo le fue a cada campaña de mensajes. Quien pidió no recibir más queda fuera solo.

## Qué encuentras

- **Respuestas recibidas**: aparece arriba solo si hay respuestas. Las que piden la baja salen en rojo. Cada una tiene [[Visto]]; el botón [[Ver todas]] alterna entre las no leídas y todas.
- **Aviso de bajas**: una línea con cuántas personas no reciben mensajes por ningún canal y el botón [[Ver la lista]]. Solo aparece si alguien ya pidió la baja.
- **Tres pasos** para enviar: elegir el canal (Email, SMS o Aviso en la app; el punto verde indica que está configurado), elegir a quién le llega (el grupo aparece al pulsar [[+ Agregar grupo]]) y escribir el mensaje.
- **Historial de campañas**: Nombre, Canal, Estado, Destinatarios, Enviados, Fallidos, Omitidos y Fecha (las últimas 100). El estado puede ser Borrador (programada), Enviando, Enviado, Enviado en parte, No se envió o Fallido. En cada fila hay [[Ver detalle]] y [[Eliminar]].

## Qué puedes hacer según tu permiso

Esta pantalla es de administrador y coordinador; el asistente administrativo también la tiene de fábrica, menos la lista de bajas.

- **Ver**: consultar el historial, el detalle y las respuestas.
- **Agregar**: armar y enviar campañas, y guardar plantillas.
- **Importar / Exportar**: la lista de bajas se exporta desde su propia pantalla.
- Solo el administrador ve los botones **Eliminar todas (Email)**, **Eliminar todas (SMS)** y **Eliminar TODAS las campañas**, que piden su contraseña.

## Tareas frecuentes

- Armar y enviar una campaña: {{t-crm-campana}}.
- Revisar quién no quiere recibir mensajes: {{t-no-contactar}}.
- Entender por qué alguien no recibió: {{t-autorizaciones}}.

::: cuidado
"Enviado" no significa que todos recibieron. Mira las columnas Fallidos y Omitidos, y abre [[Ver detalle]] para ver caso por caso. Al eliminar una campaña se borra también el registro de a quién se le escribió.
:::
