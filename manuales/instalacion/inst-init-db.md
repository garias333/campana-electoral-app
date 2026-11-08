---
id: inst-init-db
titulo: Crear las tablas con npm run init-db y recoger las credenciales iniciales
seccion: instalacion
orden: 40
icono: respaldo
modulo:
nivel:
roles: admin
ruta:
captura:
---
`npm run init-db` prepara la base de la campaña: crea las tablas, aplica las migraciones, deja los permisos por omisión y, si no hay ningún administrador, crea el primero. No pregunta nada. Lo que le falta lo toma del `.env`.

## Qué hace

- Aplica el esquema completo (`db/schema.sql`) y las migraciones.
- Deja los permisos por omisión de cada rol.
- Crea el administrador inicial **solo si no existe ninguno**.
- En esa misma corrida, y solo en una instalación nueva, crea el superadministrador.
- **No crea la base**: debe existir ya ({{inst-sitio-bd}}).

Es **repetible**: usa `CREATE TABLE IF NOT EXISTS` y migraciones defensivas, así que correrlo de nuevo no duplica ni borra nada. El actualizador lo corre solo en cada parche que toca la base.

## Pasos

1. Con el `.env` ya completo, corre como la cuenta del sitio:

```bash
npm run init-db
```

2. Lee las credenciales iniciales. Ninguna contraseña generada se imprime: cada una se deja en un archivo de la carpeta del sitio, con modo 0600, y la consola solo muestra su ruta.

```bash
cat .credenciales-admin.txt .credenciales-superadmin.txt
```

3. Guarda las contraseñas donde corresponda y **borra los archivos**:

```bash
rm .credenciales-admin.txt .credenciales-superadmin.txt
```

4. Entra a la aplicación con cada cuenta y cambia la contraseña. Ambas cuentas nacen obligadas a cambiarla en el primer ingreso.

## Los archivos de credenciales

| Archivo | Qué guarda | Cuándo se crea |
|---|---|---|
| `.credenciales-admin.txt` | Correo y contraseña del administrador inicial. | Solo si no definiste `ADMIN_PASSWORD`; con esa variable la clave ya es la del `.env`. |
| `.credenciales-superadmin.txt` | Correo y contraseña del superadministrador. | Solo en la corrida que crea también al administrador. |

La contraseña del archivo es la **única copia**: en la base solo queda su hash. Los archivos no viajan en las plantillas ni en los parches, y están en `.gitignore`. Si al volver a correr `init-db` ya existe uno, no lo pisa: en el del administrador se detiene con un mensaje (sin él no habría cómo entrar), y en el del superadministrador avisa y no crea esa cuenta. En ambos casos, léelo, bórralo y vuelve a correr `init-db`.

El superadministrador entra siempre con código de verificación (correo o SMS y, si lo configuraste, Telegram), así que {{inst-env-correo}} debe funcionar antes de su primer ingreso.

## Permiso sobre el catálogo de puestos de votación

La campaña lee tres tablas del catálogo territorial, solo con `SELECT`. Lo hace quien administra MySQL, como root y **por TCP** (sin `-h 127.0.0.1` el cliente entra por socket con otra cuenta):

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p
```

```sql
GRANT SELECT ON `territoriosdb`.`ctc_territorios`      TO '<usuario_bd>'@'%';
GRANT SELECT ON `territoriosdb`.`ctc_puestos_votacion` TO '<usuario_bd>'@'%';
GRANT SELECT ON `territoriosdb`.`ctc_alias`            TO '<usuario_bd>'@'%';
```

Cambia `<usuario_bd>` por el usuario de la base de la campaña y el host por el que tenga en `mysql.user` (suele ser `%`). Si el host no coincide, `GRANT` intenta crear la cuenta y falla con «You are not allowed to create a user with GRANT».

Después del permiso, vuelve a correr `npm run init-db` como la cuenta del sitio: así recrea los disparadores de puestos con el cruce por catálogo (sin el permiso avisó «Catálogo no accesible» y los creó solo por nombre).

::: listo
`init-db` termina sin errores, no imprime «Catálogo no accesible» y, ya con sesión iniciada, `/api/catalogo/salud` responde con `"accesible":true`.
:::

::: cuidado
Nunca concedas `GRANT SELECT ON territoriosdb.*`. Esa base también guarda las contraseñas del panel del catálogo; concede las tres tablas, una por una.
:::

::: consejo
Si `init-db` se detiene con «Ya existe ... credenciales», no es un fallo: había un archivo sin leer. Léelo con `cat`, bórralo y repite.
:::

Siguiente paso: {{inst-arrancar}}.
