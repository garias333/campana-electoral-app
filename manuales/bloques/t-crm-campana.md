---
id: t-crm-campana
titulo: Armar y enviar una campaña de mensajes
seccion: durante
orden: 261
icono: mensaje
modulo: crm
nivel: agregar
roles:
ruta: Escritorio: Mensajería > Mensajería masiva
captura: t-crm-campana.webp, t-crm-campana-2.webp
---
Sirve para mandar un mismo mensaje a muchas personas por correo, SMS o aviso en la app, ahora o a una hora programada, y para revisar después a quién le llegó.

## Pasos

1. Entra a **CRM y mensajería > CRM y Mensajes**. En el paso 1 elige el canal: [[Email]], [[SMS]] o [[Aviso en la app]].
2. En el paso 2 pulsa [[+ Agregar grupo]]: aparece el **Grupo 1**. Elige la **Fuente** (Votantes, Estructura y Organigrama; Solo Votantes y sublíderes; Solo Estructura; Testigos y Coordinadores de puesto; o Solo Organigrama) y, si quieres acotar, el **Territorio (Comuna/Corregimiento)**, la **Categoría** (solo Votantes) o el **Cargo** (solo Estructura); el **Puesto de votación** aparece al cambiar la Fuente. Con [[+ Agregar grupo]] sumas otro grupo y con **Quitar grupo** lo sacas. También puedes escribir teléfonos o correos a mano en el cuadro de abajo. Si eres líder o asistente administrativo, cualquier fuente que elijas incluye solo a tu gente (lo que ves en Votantes y tu equipo); el Organigrama no aparece.
3. Pulsa [[Ver cuántos van a recibir el mensaje]] para ver cuántas personas coinciden, cuántas tienen teléfono o correo y cuántas no.
4. En el paso 3 escribe el **Nombre de la campaña** (solo interno), el **Asunto** si es correo (en el aviso en la app hace de título) y el **Mensaje**. Usa `{nombre}` para el primer nombre de cada quien. Si vas a repetirlo, guárdalo con [[Guardar como plantilla]].
5. Si quieres que salga después, llena **Programar el envío (opcional)**; la hora es la de tu equipo. Vacío sale de inmediato.
6. Pulsa [[Enviar campaña]] y confirma «Vas a enviar esta campaña por … a todas las personas que coincidan con el filtro elegido. ¿Confirmas?».
7. Sigue el resultado en el historial y abre [[Ver detalle]].

## Leer el detalle

El resumen cuenta enviados, fallidos, pendientes, sin contacto, sin lugar de votación y los que pidieron no recibir. El botón **Reintentar los N fallidos** vuelve a intentar solo con ellos. A alguien se le **omite** (no se le escribe y no cuenta como fallido) porque:

- No tiene teléfono o correo («Sin dato de contacto»).
- Pidió no recibir más mensajes.
- Dijo expresamente que no a ese canal, o se inscribió por el enlace de un líder y aún no confirma.
- Tu mensaje usa el lugar de votación y no lo tiene registrado («Sin lugar de votación»).

Quien está repetido, con el mismo teléfono o correo en dos grupos, recibe el mensaje una sola vez. Las bajas valen también para el equipo y para los cargos del Organigrama (se compara el teléfono o el correo), y quedan como «omitido». Las bajas y las faltas de autorización pueden aparecer en la columna Estado con las palabras «dado_de_baja» y «sin_autorizacion».

::: listo
Sale el aviso «Campaña creada — se están enviando N mensajes en segundo plano» y en el historial aparece la campaña como Enviando y luego Enviado. Una programada avisa «Campaña programada para el…» y queda como Borrador hasta su hora.
:::

::: cuidado
Un grupo sin filtros es TODA la base: mira siempre el conteo del paso 3 antes de enviar. El aviso en la app solo llega a Estructura o Testigos con cuenta: elige **Solo Estructura** o **Testigos y Coordinadores de puesto**. Un SMS se rechaza fuera del horario permitido (por defecto, de 8:00 a 20:00, hora de Colombia), y también si lo programas para una hora fuera de ese rango: la app te lo dice al programar («Programaste el SMS para las 21:30…») y no queda nada guardado. Elige una hora dentro del rango.
:::

Relacionado: {{t-autorizaciones}}, {{t-no-contactar}}.
