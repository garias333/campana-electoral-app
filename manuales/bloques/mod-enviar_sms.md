---
id: mod-enviar_sms
titulo: Enviar SMS
seccion: durante
orden: 263
icono: sms
modulo: enviar_sms
nivel: ver
roles:
ruta: Escritorio: CRM y mensajería > Enviar SMS
captura:
---
Sirve para avisos puntuales por mensaje de texto a una persona o a un grupo pequeño, como citar a una reunión. Para envíos masivos usa CRM y Mensajes.

## Qué encuentras

- **Paso 1, a quién**: buscador por nombre, cargo o nivel, cuadro para pegar números a mano, y [[+ Agregar grupo o subgrupo]]. Los elegidos quedan en **Seleccionados**.
- **Paso 2, el mensaje**: el cuadro **Mensaje** con `{nombre}`, plantillas, [[Insertar mensaje de Día D]] y el botón [[Enviar SMS]].
- **Contador** bajo el mensaje: caracteres, cuántos SMS son y cuántos mensajes se facturan. Suma lo que agrega el operador: la **firma** y el **enlace de baja**, que se pega solo al final (unos 78 caracteres; escribe `{baja}` para ponerlo en otro sitio).
- **Historial de envíos**: Nombre, Estado, Destinatarios, Enviados, Fallidos, Omitidos y Fecha.

## Qué puedes hacer según tu permiso

- **Ver**: consultar el historial y el detalle.
- **Agregar**: escribir y enviar SMS (administrador, coordinador y líder).

## Tareas frecuentes

- Redactar de modo que sea **1 SMS**: sin tildes caben 160 caracteres por SMS; la app quita tildes y la ñ al enviar. Más de un segmento puede no llegar.
- Enviar a un grupo pequeño: elige personas, escribe, revisa el contador y pulsa [[Enviar SMS]].
- Ver a quién se omitió: [[Ver detalle]] en el historial.

::: cuidado
Se omite a quien pidió no recibir más, a quien no autorizó SMS, a quien no tiene teléfono y a quien aún no confirma su inscripción por enlace. Fuera del horario permitido (por defecto de 8:00 a 20:00, hora de Colombia) el envío se rechaza; para mandarlo después usa {{t-crm-campana}}.
:::
