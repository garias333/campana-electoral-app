---
id: t-telegram
titulo: Avisos por Telegram del superadministrador
seccion: administracion
orden: 450
icono: campana
modulo:
nivel:
roles: admin
ruta:
captura:
---
Cuando el superadministrador pide un código para entrar, la aplicación se lo manda por el canal de siempre (correo o SMS) y, si está configurado, también por Telegram. Así un buzón caído no lo deja fuera y ve de qué campaña viene cada código. No hay pantalla para esto: se configura en el servidor y lo hace quien lo administra.

## Qué avisa

- **Un solo aviso:** el código de ingreso del superadministrador, con el nombre de la campaña y los minutos que le quedan de vigencia.
- A los demás usuarios no les llega nada por Telegram; su ingreso no cambia.

## Pasos (quien administra el servidor)

1. Crea un bot con @BotFather y guarda el token (la clave larga) que te entrega.
2. Desde la cuenta de Telegram del superadministrador, escríbele `/start` al bot. Sin ese primer mensaje, el bot no puede escribirle.
3. Obtén el identificador del chat del superadministrador.
4. En el archivo `.env` de la instalación (el de los ajustes del servidor), escribe el token en `TELEGRAM_BOT_TOKEN` y el identificador en `TELEGRAM_SUPERADMIN_CHAT_ID`. Si prefieres no dejar esos valores en el historial de la terminal, corre como administrador del servidor `bash scripts/poner-telegram-env.sh <ruta del .env>`: te los pide sin mostrarlos.
5. Reinicia la aplicación para que lea el `.env`: con `bash scripts/reiniciar-instancia.sh <usuario>` (mira el manual de instalación, «Arrancar con PM2 y reiniciar sin riesgos»). Un reinicio simple no relee el `.env`.

::: listo
La próxima vez que el superadministrador pida un código de ingreso, le llega también un mensaje de Telegram con ese código.
:::

::: importante
El aviso depende de que **las dos** variables tengan valor. Si falta cualquiera, Telegram queda apagado sin mostrar error y el ingreso sigue por correo o SMS.
:::

::: cuidado
El token es una clave: no lo pegues en chats ni lo compartas. Si crees que se filtró, genera uno nuevo con @BotFather y cámbialo en el `.env`.
:::
