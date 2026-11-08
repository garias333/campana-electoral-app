---
id: t-mensajeria
titulo: Configurar el envío de correo y SMS
seccion: administracion
orden: 421
icono: mensaje
modulo: configurar_crm
nivel: editar
roles:
ruta: Escritorio: CRM y mensajería > Configurar mensajería
captura:
---
Sirve para dejar listos el correo y los SMS de la campaña y comprobar con una prueba que de verdad salen. Esto lo hace el administrador.

## Pasos

1. Abre **CRM y mensajería > Configurar mensajería** y pulsa [[Ingresar contraseña de administrador]].
2. En **Correo · SendGrid** escribe la **API Key**, el **Correo remitente** (verificado en SendGrid) y el **Nombre del remitente**.
3. En **SMS · Onurix**, lo normal es dejar **Número de cliente** y **Llave (key)** vacíos: así se usa la cuenta del proveedor del servicio y se descuenta de los créditos de la campaña. Llénalos solo si la campaña tiene su propia cuenta.
4. En **Firma que el proveedor agrega a cada SMS** anota la firma tal como la tiene registrada el proveedor.
5. Revisa los tres interruptores (enlace de baja, SMS de bienvenida, confirmación por correo) y pulsa [[Guardar cambios]].
6. Más abajo, escribe tu correo o tu celular y pulsa [[Enviar correo de prueba]] o [[Enviar SMS de prueba]].

::: listo
Tras guardar sale «Credenciales guardadas correctamente.» y los chips pasan a «Listo». Tras la prueba aparece el mensaje de envío y el SMS llega a tu celular.
:::

## Sobre la firma

La aplicación no escribe la firma: la agrega el proveedor y se cambia en su cuenta. Aquí solo se anota para contar sus caracteres. Si pasa de 30 caracteres o lleva tildes o ñ, la pantalla avisa que los SMS pueden costar 2 créditos.

::: cuidado
Los envíos de prueba son reales: el SMS gasta un crédito. Las claves ya guardadas salen con puntos y no se muestran; si las dejas así, se conservan. Twilio exige el número como +573000000000.
:::
