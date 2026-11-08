---
id: inst-proyecto-env
titulo: Subir el proyecto y preparar el archivo .env
seccion: instalacion
orden: 30
icono: documento
modulo:
nivel:
roles: admin
ruta:
captura:
---
Aquí se deja el código en la carpeta del sitio, se instalan las dependencias y se crea el archivo `.env`, que guarda la configuración y los secretos de esa instalación. Las 56 variables que reconoce `.env.example` se explican en los bloques `inst-env-*` (la tabla de abajo dice en cuál está cada una).

## Pasos

1. Si es una campaña nueva, descomprime la plantilla de instalación en la carpeta del sitio (ver {{inst-campana-nueva}}). El `.env` nunca viaja en la plantilla ni en los parches.
2. Entra a la carpeta del sitio con la cuenta del sitio e instala las dependencias:

```bash
cd ~/htdocs/<dominio-del-sitio>
npm install --omit=dev
```

3. Copia el modelo y cierra sus permisos:

```bash
cp .env.example .env
chmod 600 .env
```

4. Genera un `SESSION_SECRET` propio de esta instalación y pégalo en el `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

5. Edita el `.env` con `nano .env` y completa por lo menos las variables obligatorias de la tabla siguiente.
6. Comprueba que no quedó ninguna variable repetida (cambia `CLAVE` por cada nombre que hayas tocado):

```bash
grep -c '^CLAVE=' .env
```

## Dónde se explica cada variable

| Bloque | Variables |
|---|---|
| {{inst-env-base}} | `NODE_ENV`, `PORT`, `TZ`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `CATALOGO_DB`, `SESSION_SECRET` |
| {{inst-env-licencia}} | `LICENCIA_SERVIDOR_URL`, `LICENCIA_API_SECRET`, `LICENCIA_DOMINIO`, `LICENCIA_CLAVE`, `PM2_NOMBRE_PROCESO`, `PARCHES_PUBLICADOR_SECRET`, `APP_NOMBRE`, `CAMPANA_NOMBRE` |
| {{inst-env-correo}} | `SMTP_*` (7) y `SENDGRID_*` (3) |
| {{inst-env-sms}} | `TWILIO_*` (5), `SMS_PROVIDER`, `ONURIX_*` (3), `SMS_FALLBACK_PROVIDER`, `SMS_TIMEOUT_MS`, `SMS_LEDGER_*` (5), `SMS_CAMPANA_ID` |
| {{inst-env-push-telegram}} | `VAPID_*` (3), `TELEGRAM_*` (2), `SUPERADMIN_EMAIL`, `SUPERADMIN_TELEFONO` |
| {{inst-env-otros}} | `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `GOOGLE_MAPS_API_KEY`, `MAPBOX_ACCESS_TOKEN` |

`.env.example` define 54 variables y deja otras dos comentadas (`ADMIN_PASSWORD` y `SMTP_FROM`), por eso la tabla suma 56 nombres.

## Obligatorias para arrancar y entrar

`NODE_ENV`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `SESSION_SECRET`, `LICENCIA_SERVIDOR_URL`, `LICENCIA_API_SECRET`, `LICENCIA_DOMINIO` y, solo la primera vez, `LICENCIA_CLAVE`. Además `SMTP_HOST`, `SMTP_USER` y `SMTP_PASSWORD` si quieres que salgan los correos de recuperación y de código de ingreso. Sin `SESSION_SECRET` la aplicación se niega a arrancar.

## Reglas para escribir el .env

- Una variable por línea, en la forma `NOMBRE=valor`, sin espacios alrededor del signo igual.
- Si el valor lleva `#`, ponlo entre comillas dobles; si no, la lectura se corta en el `#` y la clave queda truncada sin avisar.
- Si el valor lleva comillas dobles, enciérralo en comillas simples. Si lleva de las dos clases, cambia el valor en el proveedor.
- Si una variable aparece dos veces, manda la última y la otra queda muerta sin error.
- Los secretos van solo en el `.env` de cada instancia. No los copies de otra instancia sin probarlos, y no dejes copias fechadas (`.env.bak`, `.env.2026...`) al lado: traen credenciales viejas.
- Después de cambiar el `.env`, `pm2 restart` **no** lo vuelve a leer: usa el ciclo completo de {{inst-arrancar}}.

::: listo
`ls -l .env` muestra permisos `-rw-------` con el usuario del sitio como dueño, y `grep -c` devuelve `1` para cada variable que editaste.
:::

::: cuidado
Nunca pegues un `.env` en un chat, un correo o un repositorio. Y nunca reutilices el `SESSION_SECRET` de otra campaña: una cookie de sesión de una valdría en la otra.
:::
