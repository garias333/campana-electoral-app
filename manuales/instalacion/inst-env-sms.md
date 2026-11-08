---
id: inst-env-sms
titulo: Variables de SMS (Onurix, Twilio y libro de consumo)
seccion: instalacion
orden: 34
icono: sms
modulo:
nivel:
roles: admin
ruta:
captura:
---
El canal de SMS usa **Onurix** como proveedor principal para Colombia y, si quieres, **Twilio** como respaldo. Los créditos se reparten por campaña con un libro de consumo (ledger) que vive en la base central de licencias, para que la campaña no pueda editarse su propio saldo. Sin las variables de Onurix y del libro, el canal SMS no funciona; el resto de la aplicación sigue igual y el registro de PM2 lista lo que falta.

## Proveedor y respaldo

| Variable | Para qué sirve | Obligatoria |
|---|---|---|
| `SMS_PROVIDER` | Proveedor principal. Por omisión `onurix`. El valor `none` es un interruptor de seguridad: apaga los envíos aunque la base diga otra cosa. | No |
| `SMS_FALLBACK_PROVIDER` | Proveedor de respaldo si falla el principal. Vacío significa sin respaldo. Con `twilio` usa las credenciales de Twilio. | No |
| `SMS_TIMEOUT_MS` | Tiempo máximo de espera por envío, en milisegundos. Por omisión 15000. | No |

## Onurix (cuenta maestra)

| Variable | Para qué sirve | Obligatoria |
|---|---|---|
| `ONURIX_CLIENT` | Identificador de la cuenta maestra de Onurix. | Para usar el canal |
| `ONURIX_KEY` | Llave de esa cuenta. | Para usar el canal |
| `ONURIX_WEBHOOK_TOKEN` | Token que Onurix debe enviar como `verify_token` en sus avisos. Si falta, el webhook rechaza todo (queda cerrado a propósito). | Para recibir estados y bajas |

Onurix **solo acepta IPv4**. Registra la IPv4 del servidor en la sección de seguridad del portal de Onurix; sin eso responde error 1005. La aplicación ya fuerza IPv4 en sus llamadas.

Las direcciones que debes registrar en el panel de Onurix para los avisos son:

```text
https://<dominio-de-la-campaña>/webhooks/onurix/estado?verify_token=<ONURIX_WEBHOOK_TOKEN>
https://<dominio-de-la-campaña>/webhooks/onurix/entrante?verify_token=<ONURIX_WEBHOOK_TOKEN>
```

## Twilio (respaldo)

Todas son opcionales. La base (pantalla **Configurar mensajería**) tiene prioridad y el `.env` es el respaldo.

| Variable | Para qué sirve | Obligatoria |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Identificador de la cuenta de Twilio. | No |
| `TWILIO_AUTH_TOKEN` | Token de autenticación de Twilio. | No |
| `TWILIO_SMS_FROM` | Número remitente de SMS, en formato internacional con `+`. Los espacios y guiones se limpian al leerlo. | No |
| `TWILIO_WHATSAPP_FROM` | Número remitente de WhatsApp en Twilio. | No |
| `TWILIO_FROM` | Remitente que lee solo el módulo de envío (`lib/sms.js`). El resto del código usa `TWILIO_SMS_FROM`. | No |

## Libro de consumo (ledger)

Son obligatorias solo si usas el canal SMS. La cuenta de esa base solo tiene permiso sobre tres tablas, y `UPDATE` únicamente sobre la columna del consumo; su script de creación vive en el repositorio de origen y no viaja en la plantilla.

| Variable | Para qué sirve | Obligatoria |
|---|---|---|
| `SMS_LEDGER_HOST` | Servidor MySQL de la base de licencias. | Con SMS |
| `SMS_LEDGER_PORT` | Puerto. Por omisión 3306. | No |
| `SMS_LEDGER_USER` | Usuario de la base de licencias con permisos mínimos. | Con SMS |
| `SMS_LEDGER_PASSWORD` | Contraseña de ese usuario. | Con SMS |
| `SMS_LEDGER_DB` | Base del libro. En este servidor es `licenciasdb`. | Con SMS |
| `SMS_CAMPANA_ID` | Quién es esta campaña en el libro. Si falta, se usa `LICENCIA_DOMINIO`. | No |

La cuota de créditos de la campaña la asigna quien administra la base de licencias.

::: listo
El registro de PM2 no muestra el aviso «El canal por Onurix no está configurado» y un SMS de prueba a un número tuyo sale por Onurix.
:::

::: cuidado
Aunque Onurix acepta el mensaje, no siempre avisa que llegó al teléfono. Que el envío salga como aceptado significa que Onurix lo recibió, no que el destinatario lo tiene. Para ver la entrega real hace falta el webhook de estado registrado.
:::

::: consejo
Para probar sin gastar créditos ni escribirle a nadie, pon `SMS_PROVIDER=none` y haz el ciclo completo de reinicio. Quítalo después de la prueba.
:::
