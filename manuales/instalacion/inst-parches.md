---
id: inst-parches
titulo: Aplicar parches y mantener la campaña al día
seccion: instalacion
orden: 70
icono: subir
modulo:
nivel:
roles: admin
ruta:
captura:
---
Las actualizaciones viajan como **parches** numerados y acumulativos. Se aplican desde el panel de licencias o solas, con el actualizador automático. **Nunca descomprimas un parche a mano**: saltarías la verificación de firma, la instalación de dependencias, el `init-db` cuando hace falta, el reinicio y el registro del número de versión.

## Dos caminos, el mismo programa

| Camino | Cómo funciona |
|---|---|
| Desde el panel de licencias | En licencias.appestrategia.net, entra a **Parches**, elige **Aplicar actualizaciones**, marca las campañas y pulsa aplicar. La orden llega al instante a cada campaña por `/actualizador/ejecutar`, protegida con `LICENCIA_API_SECRET`. La campaña responde «recibido» de inmediato y reporta el resultado al terminar. |
| Automático, a las 3 a. m. | Un cron de la cuenta del sitio corre `scripts/actualizar-automatico.js` todos los días. Es el respaldo si nadie aplicó el parche desde el panel. |

Ambos ejecutan `scripts/actualizar-automatico.js`; no hay lógica duplicada.

## Qué hace el actualizador, en orden

1. Lee la versión actual de `.version-parche` y pregunta al servidor de licencias qué parches hay después de ella.
2. Descarga el parche y registra su huella SHA-256 en el log.
3. Verifica la firma (Ed25519) con las llaves de `config/llaves-parches/`. Desde el parche 261 la firma es obligatoria.
4. Revisa que ninguna ruta del zip escape de la carpeta del proyecto y descomprime encima del sitio.
5. Si el parche trae `package.json`, corre `npm install --omit=dev`.
6. Si el parche está marcado como «toca la base de datos», corre `npm run init-db`.
7. Reinicia el proceso de PM2, anota el número en `.version-parche` y confirma el resultado al servidor.

Si un parche falla, la cadena **se detiene**: los parches son acumulativos y no tiene sentido seguir con el siguiente.

## Pasos para dejar el automático listo (como root)

1. Como la cuenta del sitio, deja Node 22 como versión por omisión (el cron la usa):

```bash
nvm alias default 22
```

2. Como root, agrega la línea al cron de esa cuenta. Cambia `<usuario>` y `<SITIO>`; si ya había `SHELL=/bin/bash`, no repitas esa línea:

```bash
(crontab -u <usuario> -l 2>/dev/null; cat <<'EOF'
SHELL=/bin/bash
0 3 * * * . $HOME/.nvm/nvm.sh >/dev/null 2>&1; cd $HOME/htdocs/<SITIO> && node scripts/actualizar-automatico.js >> logs/actualizaciones.log 2>&1
EOF
) | crontab -u <usuario> -
```

3. Comprueba que quedó y que existen la carpeta `logs/` y al menos un `.pem` en `config/llaves-parches/`:

```bash
crontab -u <usuario> -l
ls config/llaves-parches/
```

## Antes de un parche que toca la base

Haz una copia de la base. El script lee los datos de conexión del `.env` de esa instalación, te pide la contraseña sin mostrarla y comprueba el contenido del respaldo, no su tamaño. Se corre como root, en el servidor:

```bash
bash scripts/respaldar-base-instalacion.sh /home/<usuario>/htdocs/<dominio> <numero-de-parche>
```

El respaldo queda en la carpeta `backups/` de la instalación. Si lo haces a mano, agrega `--no-tablespaces` al `mysqldump` y verifica con `grep -ac 'CREATE TABLE' respaldo.sql`; sin esa bandera el archivo sale con encabezado y sin datos.

## Si un parche falla

1. Mira el registro: `tail -n 60 logs/actualizaciones.log`.
2. Según el mensaje:
   - **`npm install` falló**: el parche quedó en disco pero la aplicación **no** se reinició y sigue con el código anterior. Revisa la conexión a internet del servidor y vuelve a aplicar.
   - **No se encontró el proceso de PM2**: el parche quedó aplicado pero sin reiniciar. Reinicia con `bash scripts/reiniciar-instancia.sh <usuario>` o define `PM2_NOMBRE_PROCESO` en el `.env`.
   - **La firma no coincide** o el parche no trae firma: no se aplicó nada. No lo fuerces; avisa a quien lo publicó.
   - **«Este parche todavía no está habilitado para esta instalación»**: es lo normal hasta que el parche se habilita para esa campaña en el panel de licencias.
   - **«Ya hay una actualización en curso»**: espera unos minutos y reintenta.
3. Corregida la causa, vuelve a aplicar desde el panel o corre a mano, con la cuenta del sitio: `node scripts/actualizar-automatico.js`.

::: listo
`cat .version-parche` muestra el número del último parche, la columna de versión de la campaña en el panel de licencias lo refleja, y el log termina con «Parche #N aplicado correctamente» o con «Ya estás al día».
:::

::: cuidado
El número de cada parche se usa una sola vez por instalación. Si ya se aplicó, reescribir su zip no llega a ninguna parte: se publica un parche nuevo.
:::

::: importante
Aplicar un parche reinicia la aplicación y corta por unos segundos a quien esté conectado. Elige una hora tranquila y, en pleno Día D, no apliques nada que no sea urgente.
:::
