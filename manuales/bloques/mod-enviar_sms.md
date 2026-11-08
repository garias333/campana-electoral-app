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
captura: mod-enviar_sms.webp
---
Sirve para avisos puntuales por mensaje de texto a una persona o a un grupo pequeño, como citar a una reunión. Para envíos masivos usa CRM y Mensajes.

## Qué encuentras

- **Paso 1, a quién**: buscador por nombre, cargo o nivel, cuadro para pegar números a mano, y [[+ Agregar grupo o subgrupo]]. Los elegidos quedan en **Seleccionados**.
- **Paso 2, el mensaje**: el cuadro **Mensaje** con `{nombre}`, plantillas, [[Insertar mensaje de Día D]] y el botón [[Enviar SMS]].
- **Contador** bajo el mensaje: «N caracteres · N SMS», cuánto suman la **firma** del operador y el **enlace de baja** que se pega solo al final, salvo que el administrador lo apague (unos 78 caracteres según el dominio de tu campaña; escribe `{baja}` para ponerlo en otro sitio) y, con destinatarios elegidos, cuántos «mensajes facturados» son. Cada SMS (segmento) gasta un crédito de la campaña; el saldo lo ve el administrador en Configurar mensajería.
- **Historial de envíos**: Nombre, Estado, Destinatarios, Enviados, Fallidos, Omitidos y Fecha.

## Qué puedes hacer según tu permiso

- **Ver**: consultar el historial y el detalle.
- **Agregar**: escribir y enviar SMS (administrador, coordinador, líder y asistente administrativo). Al pulsar [[Enviar SMS]], la app pregunta «Vas a enviar este SMS a N persona(s). ¿Confirmas?».

## Tareas frecuentes

- Redactar de modo que sea **1 SMS**: caben 160 caracteres contando la firma y el enlace de baja. La app quita sola las tildes y la ñ, y no cuestan; un emoji o comillas curvas sí bajan el límite a 70. Si pasa de 1 SMS, el contador avisa en rojo que el mensaje puede NO llegar: acórtalo. Mira {{f-caracteres-sms}}.
- Enviar a un grupo pequeño: elige personas, escribe, revisa el contador y pulsa [[Enviar SMS]].
- Ver a quién se omitió: [[Ver detalle]] en el historial.

::: cuidado
Se omite a quien pidió no recibir más, a quien dijo que no a los SMS, a quien no tiene teléfono y a quien aún no confirma su inscripción por enlace. Fuera del horario permitido (por defecto de 8:00 a 20:00, hora de Colombia) el envío se rechaza con un aviso. Esta pantalla no programa: para mandarlo después, usa CRM y Mensajes (administración y coordinación) o vuelve a intentarlo dentro del horario. {{t-crm-campana}}
:::
