---
id: inst-problemas
titulo: Problemas frecuentes de instalación y cómo resolverlos
seccion: instalacion
orden: 90
icono: alerta
modulo:
nivel:
roles: admin
ruta:
captura:
---
Esta lista junta los fallos que más se repiten al instalar o mantener una campaña, con su causa y el arreglo. Empieza siempre por el registro: `pm2 logs campana-app --lines 30 --nostream`.

## Tabla de diagnóstico

| Síntoma | Causa más probable | Arreglo |
|---|---|---|
| La página no carga después de un parche | Falta una dependencia nueva, hay un error de sintaxis, o la aplicación quedó sin reiniciar. | Lee el registro. Si dice `Cannot find module`, corre `npm install --omit=dev` como la cuenta del sitio y reinicia con `scripts/reiniciar-instancia.sh`. |
| `Access denied` al conectar con MySQL | La base o el usuario no existen, o la contraseña del `.env` no coincide exactamente. | Prueba `mysql -h 127.0.0.1 -u <usuario_bd> -p <base>`. Revisa `DB_USER`, `DB_PASSWORD` y `DB_NAME`, y que la contraseña con `#` esté entre comillas dobles. |
| La aplicación no arranca y el registro dice «Falta la variable de entorno SESSION_SECRET» | `SESSION_SECRET` vacía o ausente. | Genera una y pégala ({{inst-env-base}}). Ciclo completo de reinicio. |
| El registro dice «ESQUEMA INCOMPLETO» | A la base le faltan columnas críticas. | Corre `npm run init-db` y arranca de nuevo. |
| No se puede iniciar sesión por HTTPS | Sin certificado o sin `NODE_ENV=production` correcto. | Emite el SSL ({{inst-dominio-ssl}}). Entra siempre por `https://`. |
| Let's Encrypt falla con NXDOMAIN | Falta el registro A del dominio. | Créalo en el proveedor de DNS hacia la IP del servidor y espera la propagación. |
| `535 authentication failed` al enviar correo | El proveedor rechazó la credencial; incluye el usuario. | Comprueba que `SMTP_USER` sea el buzón exacto y que la contraseña sea la vigente ({{inst-env-correo}}). Ciclo completo. |
| El correo no sale y nadie lo notó | El fallo solo se ve cuando alguien lo necesita. | Prueba el envío con «¿Olvidaste tu contraseña?» tras cada cambio. |
| Los avisos en la app no llegan | Faltan las llaves VAPID, o la persona no aceptó los avisos o no tiene cuenta. | Define `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` ({{inst-env-push-telegram}}), ciclo completo, y que la persona los active en su teléfono. Solo reciben push quienes tienen cuenta. |
| El código de ingreso no llega por Telegram | Falta una de las dos variables, o el bot nunca recibió un `/start`. | Completa `TELEGRAM_BOT_TOKEN` y `TELEGRAM_SUPERADMIN_CHAT_ID`; escribe `/start` al bot desde el chat del superadministrador. |
| Los SMS no salen y Onurix responde 1005 | La IPv4 del servidor no está registrada en el portal de Onurix. | Regístrala en la sección de seguridad del portal ({{inst-env-sms}}). |
| El Mapa territorial solo ofrece OpenStreetMap | Falta `MAPBOX_ACCESS_TOKEN`. | Pon el token de esa campaña ({{inst-env-otros}}). |
| Cambié el `.env` y no pasa nada | `pm2 restart` no relee el `.env`. | Ciclo completo: `pm2 delete`, `pm2 start`, `pm2 save` ({{inst-arrancar}}). |
| Una variable parece ignorada | Está duplicada en el `.env` o su valor se cortó en un `#`. | `grep -c '^NOMBRE=' .env` debe dar 1; el valor con `#` va entre comillas dobles. |
| La licencia se rechaza al activar | `LICENCIA_DOMINIO` no es idéntico al registrado, o la clave no corresponde. | Corrige el dominio (sin `https://`) y repite `node scripts/activar-licencia.js`. |
| Tras reiniciar el servidor la aplicación no vuelve | No hay servicio de systemd ni `@reboot`, o falta `dump.pm2`. | Configura el arranque y corre `pm2 save` ({{inst-arrancar}}). |
| `pm2` o `npm` «no se encuentra» | Estás como root, o en un shell que no cargó nvm. | Entra con la cuenta del sitio; o usa la ruta absoluta del Node de esa cuenta. |
| Un parche no se aplica y dice «no está habilitado» | El parche no se ha habilitado para esa campaña. | Habilítalo en el panel de licencias ({{inst-parches}}). |
| Un comando de terminal se queda colgado | Espera una respuesta o hay un proceso previo. | `Ctrl+C` para cancelar y vuelve a intentar. |

::: consejo
Cuando algo falle, mide antes de suponer: compara el pid antes y después de un reinicio, cuenta caracteres o líneas de lo que copiaste, y lee el registro completo. Casi todos los fallos de esta lista se ven en el registro desde el primer minuto.
:::

::: cuidado
No pegues el contenido del `.env` ni capturas con contraseñas en chats o correos para pedir ayuda. Describe qué variable crees que falla, nunca su valor.
:::
