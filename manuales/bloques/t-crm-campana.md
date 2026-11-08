---
id: t-crm-campana
titulo: Armar y enviar una campaña de mensajes
seccion: durante
orden: 261
icono: mensaje
modulo: crm
nivel: agregar
roles:
ruta: Escritorio: CRM y mensajería > CRM y Mensajes
captura: t-crm-campana.webp
---
Sirve para mandar un mismo mensaje a muchas personas por correo, SMS o aviso en la app, ahora o a una hora programada, y para revisar después a quién le llegó.

## Pasos

1. Entra a **CRM y mensajería > CRM y Mensajes**. En el paso 1 elige el canal: [[Email]], [[SMS]] o [[Aviso en la app]].
2. En el paso 2 elige la **Fuente** del grupo y sus filtros. Con [[+ Agregar grupo]] sumas otro grupo. También puedes escribir teléfonos o correos a mano.
3. Pulsa [[Ver cuántos van a recibir el mensaje]] para ver cuántos tienen contacto y cuántos no.
4. En el paso 3 escribe el **Nombre de la campaña** (solo interno), el **Asunto** si es correo o aviso, y el **Mensaje**. Usa `{nombre}` para el primer nombre de cada quien.
5. Si quieres que salga después, llena **Programar el envío (opcional)**; vacío sale de inmediato.
6. Pulsa [[Enviar campaña]] y confirma.
7. Sigue el resultado en el historial y abre [[Ver detalle]].

## Leer el detalle

El resumen cuenta enviados, fallidos, pendientes, sin contacto, sin lugar de votación y los que pidieron no recibir. El botón **Reintentar los N fallidos** vuelve a intentar solo con ellos. A alguien se le **omite** porque:

- No tiene teléfono o correo.
- Pidió no recibir más mensajes.
- No autorizó ese canal, o se inscribió por el enlace de un líder y aún no confirma.
- Tu mensaje usa el lugar de votación y no lo tiene registrado.

::: listo
En el historial aparece la campaña como Enviando y luego Enviado; una programada queda como Borrador hasta su hora.
:::

::: cuidado
El aviso en la app solo llega a Estructura o Testigos con cuenta. Un SMS se rechaza fuera del horario permitido, salvo que lo programes.
:::

Relacionado: {{t-autorizaciones}}, {{t-no-contactar}}.
