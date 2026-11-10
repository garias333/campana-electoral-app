---
id: mod-configurar_crm
titulo: Configurar mensajería
seccion: administracion
orden: 420
icono: mensaje
modulo: configurar_crm
nivel: ver
roles:
ruta: Escritorio: Mensajería > Configurar mensajería
captura:
---
Esta pantalla guarda las llaves de correo y SMS de tu campaña, muestra si cada canal está listo y permite hacer un envío de prueba. Sin esto configurado, las pantallas de envío no pueden mandar nada.

## Qué encuentras

- **Candado.** Al entrar ves «Esta pantalla está protegida». Pulsa [[Ingresar contraseña de administrador]] para abrirla.
- **Credenciales de los canales**, en tres tarjetas, cada una con su etiqueta de estado («Listo», «Sin configurar»):
  - **Correo · SendGrid**: API Key, correo remitente y nombre del remitente. Alimenta CRM y Mensajes y Enviar E-mail.
  - **SMS · Onurix**: número de cliente y llave, la firma del SMS y tres interruptores: «Agregar el enlace de baja a cada SMS» (viene encendido), «Mandar un SMS de bienvenida a cada persona nueva» (apagado, porque gasta un crédito por registro) y «Pedir la confirmación de autorización por correo» (apagado; no gasta crédito).
  - **Respaldo de SMS · Twilio**: Account SID, Auth Token y número para SMS. Solo entra si falla el envío por Onurix.
- **Estado de los canales**: Correo, SMS y Créditos de SMS, con una barra de consumo. Los créditos no se recargan desde aquí.
- **Enviar un mensaje de prueba**: [[Enviar correo de prueba]] y [[Enviar SMS de prueba]].

## Qué puedes hacer según tu permiso

- **Ver**: abrir la pantalla y ver el estado de los canales. Las claves ya guardadas salen enmascaradas.
- **Editar**: cambiar credenciales, interruptores y firma con [[Guardar cambios]], y hacer envíos de prueba. Esta pantalla es solo del administrador.

## Tareas frecuentes

- Configurar los canales: {{t-mensajeria}}.
- Revisar cuántos créditos de SMS quedan: tarjeta «Créditos de SMS».
- Comprobar que un canal funciona: un envío de prueba.

::: consejo
No hay un canal de WhatsApp en esta pantalla. Y si ves «Fuera de horario» en SMS, no es un fallo: los SMS tienen un horario permitido (la pantalla lo indica; de fábrica, de 8:00 a 20:00) y las campañas se pueden programar para después.
:::
