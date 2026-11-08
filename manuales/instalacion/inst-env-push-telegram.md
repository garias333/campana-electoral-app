---
id: inst-env-push-telegram
titulo: Variables de avisos en la app, Telegram y superadministrador
seccion: instalacion
orden: 35
icono: campana
modulo:
nivel:
roles: admin
ruta:
captura:
---
Tres funciones opcionales que se apagan solas si no las configuras: los avisos en la app del celular (push), el aviso por Telegram del código de ingreso del superadministrador y los datos de esa cuenta especial.

## Avisos en la app (VAPID)

Los avisos push llegan a quien tiene cuenta y abrió la app en su teléfono. Sin las dos llaves, el canal queda apagado y el CRM lo muestra como no configurado.

| Variable | Para qué sirve | Obligatoria |
|---|---|---|
| `VAPID_PUBLIC_KEY` | Llave pública; el navegador la usa para suscribirse. Es pública a propósito. | Para push |
| `VAPID_PRIVATE_KEY` | Llave privada con la que se firma cada envío. Nunca sale del servidor. | Para push |
| `VAPID_SUBJECT` | A quién contactar si el servicio de push detecta abuso: un `mailto:` o una dirección `https://`. Por omisión, un `mailto:` de soporte de la plataforma. | No |

Genera el par **una vez por instancia** y no lo compartas entre campañas:

```bash
npx web-push generate-vapid-keys
```

Copia cada valor a su variable y haz el ciclo completo de reinicio ({{inst-arrancar}}). Quien ya había aceptado avisos con otro par de llaves tendrá que volver a suscribirse.

## Telegram (solo para el superadministrador)

Cuando el superadministrador pide un código de ingreso, el mismo código le llega también por Telegram, con el nombre de la campaña (`APP_NOMBRE`) para saber de cuál viene. Hacen falta las **dos** variables; con una sola queda apagado y el ingreso sigue por correo.

| Variable | Para qué sirve | Obligatoria |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Token del bot, el que entrega @BotFather. | Para Telegram |
| `TELEGRAM_SUPERADMIN_CHAT_ID` | Chat al que escribe el bot (el del superadministrador). | Para Telegram |

Para ponerlas sin dejar los valores en el historial del terminal, corre como root:

```bash
bash scripts/poner-telegram-env.sh <ruta-del-.env>
```

El script pide el token, el identificador del chat y el nombre de la campaña sin mostrarlos, y los escribe en el `.env` sin duplicarlos. El bot solo puede escribirle a quien le haya enviado antes un `/start`; sin eso el registro muestra «Telegram falló: HTTP 400» o 403.

## Superadministrador

Es una cuenta que ningún otro rol ve. `npm run init-db` la crea al instalar, con verificación en dos pasos siempre encendida. Su contraseña inicial no se define aquí: queda en `.credenciales-superadmin.txt` ({{inst-init-db}}).

| Variable | Para qué sirve | Obligatoria |
|---|---|---|
| `SUPERADMIN_EMAIL` | Correo de la cuenta. Si está vacío se usa el valor por omisión de `config/superadminCorreo.js`. | No |
| `SUPERADMIN_TELEFONO` | Celular al que llega el código por SMS. `init-db` lo pone solo si la cuenta no tiene ninguno; si queda vacío se usa el valor por omisión del mismo archivo. | No |

Estas dos solo cuentan en una instalación nueva. Para elevar una cuenta de una campaña que ya existía:

```bash
node scripts/elevar-superadmin.js --simular
node scripts/elevar-superadmin.js <correo>
```

::: listo
Con push configurado, el estado del canal en el CRM deja de decir «Faltan las llaves VAPID». Con Telegram configurado, el código de ingreso del superadministrador llega también al chat.
:::

::: importante
El superadministrador siempre necesita un código, así que el correo (`SMTP_*`, {{inst-env-correo}}) tiene que funcionar antes de su primer ingreso. Si el código no sale por ningún canal, esa cuenta no puede entrar.
:::
