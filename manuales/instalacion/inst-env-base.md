---
id: inst-env-base
titulo: Variables de base de datos, servidor y sesión
seccion: instalacion
orden: 31
icono: llave
modulo:
nivel:
roles: admin
ruta:
captura:
---
Estas diez variables hacen que la aplicación arranque, se conecte a su base y mantenga las sesiones de quienes inician sesión. Sin las obligatorias, el proceso no levanta o no deja entrar a nadie.

## Servidor y sesión

| Variable | Para qué sirve | Obligatoria |
|---|---|---|
| `NODE_ENV` | Debe valer `production`. Con ese valor la cookie de sesión sale con el atributo `Secure`; sin él, la sesión viaja sin la marca de segura. | Sí |
| `PORT` | Puerto interno donde escucha la aplicación. Por omisión es 3000. La aplicación escucha solo en `127.0.0.1`, así que solo el proxy inverso la alcanza. Cada instancia del servidor necesita el suyo. | No, pero ponla siempre |
| `TZ` | Zona horaria del proceso. Si queda vacía se usa `America/Bogota`. Solo cámbiala si la campaña está fuera de Colombia. | No |
| `SESSION_SECRET` | Cadena larga y aleatoria con la que se firman las cookies de sesión y los tokens que emite la aplicación. Distinta en cada instalación. Sin ella la aplicación lanza un error y no arranca. | Sí |

## Base de datos

| Variable | Para qué sirve | Obligatoria |
|---|---|---|
| `DB_HOST` | Servidor de MySQL. Por omisión `127.0.0.1`. No uses `localhost`. | No |
| `DB_PORT` | Puerto de MySQL. Por omisión 3306. | No |
| `DB_USER` | Usuario de la base de la campaña, creado en CloudPanel. No tiene valor por omisión. | Sí |
| `DB_PASSWORD` | Contraseña de ese usuario. Si lleva `#`, va entre comillas dobles. | Sí |
| `DB_NAME` | Nombre de la base. Debe existir ya: `npm run init-db` no la crea. | Sí |
| `CATALOGO_DB` | Base del Catálogo Territorial de donde se leen los puestos de votación y las mesas. Por omisión `territoriosdb`. Solo cámbiala si el catálogo se llama distinto en tu servidor. | No |

## Cómo comprobarlas

1. Genera el secreto de sesión (una vez por instalación) y pégalo en `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

2. Prueba la conexión con los mismos datos del `.env`:

```bash
mysql -h 127.0.0.1 -P 3306 -u <usuario_bd> -p <nombre_bd> -e "SELECT 1"
```

3. Al arrancar, la aplicación revisa que existan las columnas críticas del esquema. Si falta alguna, termina con el mensaje «ESQUEMA INCOMPLETO» y te pide correr `npm run init-db` ({{inst-init-db}}).

::: listo
`SELECT 1` responde sin error y, al arrancar, el registro de PM2 no muestra «Falta la variable de entorno SESSION_SECRET» ni «ESQUEMA INCOMPLETO».
:::

::: cuidado
Cambiar `SESSION_SECRET` en una instalación que ya está en uso cierra las sesiones abiertas y puede dejar sin validez los tokens que se firmaron con el valor anterior. Hazlo solo si el secreto se filtró.
:::

::: importante
Si pones `NODE_ENV=production` y el sitio todavía no tiene HTTPS, nadie podrá iniciar sesión, porque el navegador descarta la cookie `Secure`. Configura el certificado en {{inst-dominio-ssl}}.
:::
