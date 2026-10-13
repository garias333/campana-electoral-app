# Instalación de una campaña nueva

Esta plantilla declara tener aplicado el **parche {{PARCHE}}** (archivo
`.version-parche`). No trae datos, credenciales, licencia activada ni archivos
subidos: todo eso se crea en los pasos de abajo.

Cada paso dice de dónde sale. Lo que no se pudo comprobar en el código está
marcado como **(a confirmar)**.

## Requisitos

- **Node 18 o superior** (`package.json`, `engines`). La cuenta del sitio debe
  tener su propio Node y PM2 (con nvm, cada cuenta lleva el suyo).
- **MySQL 8**: el esquema usa la colación `utf8mb4_0900_ai_ci`.
- Salida a internet: `npm install` baja `xlsx` desde `cdn.sheetjs.com`
  (`package.json`) y la app habla con el servidor de licencias.
- Una clave de licencia emitida en el panel de licencias para el dominio
  exacto de esta campaña.

## 1. Descomprimir

Descomprima la plantilla en la carpeta del sitio. Las carpetas `uploads/contenido`
y `uploads/marca` vienen vacías a propósito.

## 2. Base de datos vacía

Cree la base y su usuario **en el panel de hosting** (CloudPanel), no por SQL:
el panel lleva su propio registro y una base creada por fuera queda desalineada.
`db/init-db.js` **no crea la base**, solo las tablas: la base debe existir antes
del paso 4.

## 3. Archivo `.env`

```bash
cp .env.example .env
```

Complete al menos las variables marcadas **obligatoria** en `.env.example`:

- `NODE_ENV=production`
- `DB_USER`, `DB_PASSWORD`, `DB_NAME` (y `DB_HOST=127.0.0.1`)
- `SESSION_SECRET`: una cadena larga y aleatoria, distinta en cada instancia.
  Sin ella la app no arranca (`app.js`).
- `LICENCIA_SERVIDOR_URL`, `LICENCIA_API_SECRET`, `LICENCIA_DOMINIO` (idéntico al
  registrado en el panel de licencias) y `LICENCIA_CLAVE`
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` si la campaña va a enviar correo
  (recuperar contraseña, código de doble factor)
- `PORT`: **uno distinto por cada instancia** del servidor (por omisión, 3000).
  La app escucha solo en `127.0.0.1`.

Una contraseña que contenga `#` debe ir entre comillas dobles, o dotenv la corta.

Opcional: `ADMIN_EMAIL` y `ADMIN_PASSWORD` fijan el administrador inicial. Si no
se define la contraseña, el paso 4 genera una al azar.

## 4. Dependencias y tablas

Como el **usuario del sitio** (no como root: root no tiene npm):

```bash
npm install --omit=dev
npm run init-db
```

`init-db` aplica `db/schema.sql`, las migraciones, los permisos por omisión y
crea el administrador inicial. **Imprime una sola vez el correo y la contraseña**
del administrador; anótelos. Debe cambiar la contraseña en el primer ingreso.

También crea el **superadministrador**, una cuenta que ningún otro rol ve (ni
siquiera el administrador). Su correo es `SUPERADMIN_EMAIL` del `.env` o, si está
vacío, el de por omisión de `config/superadminCorreo.js`. **Su contraseña no se
imprime**: queda en `.credenciales-superadmin.txt`, en la carpeta del sitio, con
modo 0600. Léala y bórrela:

```bash
cat .credenciales-superadmin.txt
rm .credenciales-superadmin.txt
```

Debe cambiarla en el primer ingreso. Solo se crea en una instalación nueva (cuando
`init-db` crea también al administrador); en una segunda corrida no hace nada. Si
el archivo ya existe, `init-db` no crea la cuenta y lo avisa. El archivo no viaja
en las plantillas ni en los parches.
Está escrito para poder repetirse (`CREATE TABLE IF NOT EXISTS`, y solo crea
un administrador si no hay ninguno).

## 5. Activar la licencia

Una sola vez, con `LICENCIA_CLAVE` ya en el `.env`:

```bash
node scripts/activar-licencia.js
```

Sale con error y un mensaje si el servidor de licencias rechaza la activación.
La activación queda en `.licencia-cache.json`; no se copia a otra instalación.

## 6. Arranque

**Con el script del repo, como root** (comprueba que el proceso de verdad se
reinició, comparando el PID):

```bash
bash scripts/reiniciar-instancia.sh <usuario-de-la-cuenta> [puerto]
```

- Si no se pasa el puerto, lo lee de `PORT` en el `.env`.
- Busca la carpeta con `app.js` en `/home/<usuario>/htdocs/` y exige que haya una sola.
- Necesita `pm2` instalado junto al `node` de esa cuenta; si no lo encuentra,
  se detiene y lo dice.
- En una instancia que nunca ha corrido, `pm2 restart all` no cambia ningún PID;
  entonces el script recrea el proceso con el intérprete absoluto (nombre
  `campana-app`) y ejecuta `pm2 save`. **(a confirmar en una instalación nueva:
  el script está escrito para este caso, pero no se probó sobre una cuenta vacía)**

**A mano, con PM2**, usando la ruta absoluta de `node` de la cuenta (un
`pm2 restart` a secas puede dejar el proceso "online" pero roto, con el
intérprete anotado como `node`):

```bash
pm2 start app.js --name campana-app --interpreter /ruta/absoluta/al/node
pm2 save
```

Comprobación: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<puerto>/login.html`

## 7. Dominio y SSL

La app escucha solo en `127.0.0.1` y asume un proxy delante (`trust proxy`,
`app.js`). Con `NODE_ENV=production` la cookie de sesión lleva el atributo
`Secure`: **sin HTTPS no se podrá iniciar sesión**. Configure el sitio como
proxy inverso hacia `http://127.0.0.1:<puerto>` y emita el certificado desde
el panel de hosting; este repositorio no incluye configuración de Nginx ni
automatiza el certificado.

## 8. Superadministrador en una campaña que ya existía (opcional)

Una instalación nueva ya lo trae (paso 4). Para elevar una cuenta de una campaña
anterior, o mover la categoría, la cuenta debe existir y estar activa. El correo es
opcional: sin él se usa el de por omisión y el script lo dice.

```bash
node scripts/elevar-superadmin.js --simular
node scripts/elevar-superadmin.js [correo@dominio.com]
node scripts/elevar-superadmin.js --estado
```

## 9. Actualizaciones automáticas y arranque tras reinicio

`scripts/actualizar-automatico.js` baja y aplica los parches nuevos (necesita
`LICENCIA_API_SECRET`). El actualizador necesita `config/llaves-parches/` (viene en
esta plantilla): sin un `.pem` ahí, el script se detiene al arrancar. La carpeta
`logs/` también viene (vacía): el cron escribe en `logs/actualizaciones.log` y, sin
la carpeta, falla en silencio.

**El Node por defecto del usuario debe ser el de producción.** El cron carga nvm y
usa el `node` por defecto de esa cuenta. Como el usuario del sitio:

```bash
nvm alias default <versión-de-producción>
nvm alias default        # debe mostrar esa versión
```

**Cron (como root).** Reemplace `<usuario>` por la cuenta del sitio y `<SITIO>` por
la carpeta de `~/htdocs`. La línea es la que ya funciona en las instalaciones de prueba:

```bash
(crontab -u <usuario> -l 2>/dev/null; cat <<'EOF'
SHELL=/bin/bash
0 3 * * * . $HOME/.nvm/nvm.sh >/dev/null 2>&1; cd $HOME/htdocs/<SITIO> && node scripts/actualizar-automatico.js >> logs/actualizaciones.log 2>&1
EOF
) | crontab -u <usuario> -
```

Verifique que quedó:

```bash
crontab -u <usuario> -l
```

Si el usuario ya tenía un crontab con `SHELL=/bin/bash`, no repita esa línea (quedaría
duplicada).

**Arranque tras reiniciar el servidor (como root).** Para que PM2 levante la
aplicación sola, genere su servicio de systemd; ajuste `PATH` y la ruta a la carpeta
`bin` del Node de esa cuenta:

```bash
env PATH=$PATH:/home/<usuario>/.nvm/versions/node/<versión>/bin \
  /home/<usuario>/.nvm/versions/node/<versión>/bin/pm2 startup systemd -u <usuario> --hp /home/<usuario>
```

Después, como el usuario y con la aplicación ya arrancada, `pm2 save` (el paso 6 ya
lo hace con `reiniciar-instancia.sh`).

## 10. Canal SMS (opcional)

Requiere las variables `SMS_LEDGER_*`, `ONURIX_*` y una cuota asignada en la
base central de licencias. Esa parte vive fuera de esta plantilla.

## Qué no incluye esta plantilla

`.env`, `.licencia-cache.json`, `.credenciales-superadmin.txt`, `backups/`, `node_modules/`, `parches/`
y el contenido de `uploads/` y de `logs/` (las carpetas vienen vacías).
