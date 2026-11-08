---
id: inst-env-correo
titulo: Variables de correo (SMTP y SendGrid)
seccion: instalacion
orden: 33
icono: correo
modulo:
nivel:
roles: admin
ruta:
captura:
---
Hay dos usos distintos del correo. El **SMTP** envía los correos del sistema: recuperar contraseña y código de ingreso. **SendGrid** es solo para el correo masivo del CRM. Sin SMTP la aplicación arranca, pero no puede enviar ninguno de los correos del sistema.

## SMTP

Crea primero la cuenta de correo en tu proveedor (en Hostinger, desde el panel de correo electrónico).

| Variable | Para qué sirve | Obligatoria |
|---|---|---|
| `SMTP_HOST` | Servidor SMTP del proveedor. | Sí |
| `SMTP_PORT` | Puerto. Por omisión 465. | No |
| `SMTP_SECURE` | `true` para el puerto 465 (valor por omisión) y `false` para 587 con STARTTLS. | No |
| `SMTP_USER` | Cuenta con la que se autentica. Debe ser la dirección exacta del buzón. | Sí |
| `SMTP_PASSWORD` | Contraseña del buzón. Si lleva `#`, va entre comillas dobles. | Sí |
| `SMTP_FROM_NAME` | Nombre que ve quien recibe el correo. Solo el nombre, sin la dirección. | No |
| `SMTP_FROM` | Dirección que ve quien recibe. Va comentada en `.env.example`. Úsala solo si debe ser distinta de `SMTP_USER`; si se omite se usa `SMTP_USER`. | No |

Casi todos los proveedores, Hostinger incluido, rechazan enviar desde una dirección que no sea la de la cuenta autenticada o un alias suyo. Por eso lo normal es no definir `SMTP_FROM`.

## SendGrid (correo masivo)

| Variable | Para qué sirve | Obligatoria |
|---|---|---|
| `SENDGRID_API_KEY` | Llave de SendGrid para el envío masivo. | No |
| `SENDGRID_FROM` | Dirección remitente verificada en SendGrid. | No |
| `SENDGRID_FROM_NAME` | Nombre del remitente. | No |

Los valores guardados en la pantalla **Configurar mensajería** (CRM y mensajería) tienen prioridad sobre estas tres variables; el `.env` solo es el respaldo cuando esa pantalla no tiene nada. La configuración se vuelve a leer cada 30 segundos, así que un cambio hecho en la pantalla no exige reiniciar.

## Cómo probarlo

1. Reinicia la instancia con el ciclo completo ({{inst-arrancar}}).
2. En la pantalla de ingreso, usa el enlace «¿Olvidaste tu contraseña?» con una cuenta de prueba.
3. Revisa que llegue el correo. Si no llega, mira el registro con `pm2 logs campana-app --lines 30 --nostream`.

::: listo
El correo de recuperación llega a la bandeja y el registro de PM2 no muestra errores de autenticación.
:::

::: cuidado
Un error `535 authentication failed` significa que el proveedor rechazó la credencial, y la credencial incluye el **usuario**. Antes de cambiar la contraseña, comprueba que `SMTP_USER` sea exactamente el buzón (un guion de más lo vuelve otro buzón). Un correo que no sale no avisa a nadie: el fallo aparece el día en que alguien pide recuperar su contraseña.
:::
