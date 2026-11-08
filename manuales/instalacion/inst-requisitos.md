---
id: inst-requisitos
titulo: Requisitos del servidor y de la cuenta del sitio
seccion: instalacion
orden: 10
icono: engranaje
modulo:
nivel:
roles: admin
ruta:
captura:
---
Antes de instalar, comprueba que el servidor y la cuenta que va a correr la aplicación tienen todo lo que se lista aquí. Una instalación que arranca "a medias" casi siempre es un requisito que faltaba.

## Qué necesita el servidor

| Requisito | Detalle |
|---|---|
| Sistema | Ubuntu 24.04 en un VPS. |
| Panel | CloudPanel, para crear el sitio, la base de datos, el proxy inverso y el certificado SSL. |
| Node.js | Versión 22 (la de producción). `package.json` exige 18 o superior en `engines`. |
| PM2 | Uno por cuenta de sitio, instalado junto al Node de esa cuenta. |
| MySQL | 8.4. El esquema usa la colación `utf8mb4_0900_ai_ci`, que solo existe en MySQL 8. |
| `unzip` | El actualizador descomprime los parches con `unzip`. |
| Salida a internet | `npm install` baja `xlsx` desde `cdn.sheetjs.com`; la aplicación habla con el servidor de licencias, con el proveedor de correo y, si los usas, con los de SMS, mapas y avisos. |
| Dominio | Un dominio o subdominio propio, con registro A hacia la IP del servidor. |
| Licencia | Una clave emitida en el panel de licencias para ese dominio exacto. |

## Qué necesita la cuenta del sitio

Cada sitio de CloudPanel tiene su propio usuario de sistema. Esa cuenta es la que corre la aplicación, y por eso:

- Lleva **su propio Node y su propio PM2**, instalados con nvm dentro de su carpeta. Root no tiene `npm`.
- Es la dueña de los archivos del sitio. Si instalas dependencias con otro usuario, la aplicación no podrá leerlas.
- Necesita un **puerto interno propio**. Dos instancias no pueden compartirlo.

## Pasos

1. Entra al servidor con la cuenta del sitio (no como root).
2. Comprueba Node y PM2:

```bash
node -v
pm2 -v
```

3. Si `pm2` no existe, instálalo con esa misma cuenta:

```bash
npm install -g pm2
```

4. Deja Node 22 como versión por omisión de la cuenta. El cron de actualizaciones usa esa versión:

```bash
nvm alias default 22
nvm alias default
```

5. Comprueba MySQL y `unzip`:

```bash
mysql --version
unzip -v | head -1
```

::: listo
`node -v` muestra una versión 22, `pm2 -v` responde con un número y `nvm alias default` devuelve la misma versión de Node.
:::

::: cuidado
Nunca instales con `sudo npm` ni como root. Los archivos quedarían de otro dueño y la aplicación caería con un error de permisos.
:::

Siguiente paso: {{inst-sitio-bd}}.
