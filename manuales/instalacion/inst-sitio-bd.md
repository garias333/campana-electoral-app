---
id: inst-sitio-bd
titulo: Crear el sitio y la base de datos en CloudPanel
seccion: instalacion
orden: 20
icono: respaldo
modulo:
nivel:
roles: admin
ruta:
captura:
---
Cada campaña vive en su propio sitio y con su propia base de datos. Ambos se crean en CloudPanel, no por SQL: el panel lleva su propio registro y una base creada por fuera queda desalineada de él.

## Pasos

1. En CloudPanel, crea el sitio del dominio de la campaña. En este servidor se usa un sitio de tipo **proxy inverso** que apunta a `http://127.0.0.1:<puerto>`, donde `<puerto>` es el que pondrás en `PORT` del `.env`.
2. Anota el usuario de sistema que CloudPanel le asigna al sitio. Es la cuenta que correrá la aplicación.
3. En CloudPanel, crea una base de datos nueva con su usuario dedicado. Anota el nombre de la base, el usuario y la contraseña.
4. Comprueba que la conexión funciona, con los mismos datos que irán al `.env`:

```bash
mysql -h 127.0.0.1 -P 3306 -u <usuario_bd> -p <nombre_bd> -e "SELECT 1"
```

5. Elige un puerto interno que no use ninguna otra instancia del servidor. Para ver los que ya están ocupados:

```bash
ss -ltn | grep 127.0.0.1
```

## Por qué la base no se crea por SQL

`npm run init-db` crea las tablas, **no la base**. La base debe existir antes de correrlo. Y como CloudPanel es quien registra bases y usuarios, créalos siempre desde allí; si los creas con `CREATE DATABASE`, el panel no los verá.

::: listo
El comando `mysql ... -e "SELECT 1"` imprime una tabla con un `1`. Si responde `Access denied`, el usuario, la contraseña o la base no coinciden con lo creado en CloudPanel.
:::

::: consejo
Usa `127.0.0.1` y no `localhost` como servidor de la base. `localhost` hace que el cliente busque un socket y puede fallar de forma intermitente.
:::

::: importante
El usuario de la base de la campaña solo tiene permisos sobre su propia base. Si la campaña va a leer el catálogo territorial de puestos de votación, necesitará además un permiso de solo lectura que concede quien administra MySQL; está explicado en {{inst-init-db}}.
:::

Siguiente paso: {{inst-proyecto-env}}.
