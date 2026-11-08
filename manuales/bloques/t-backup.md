---
id: t-backup
titulo: Descargar y restaurar una copia de seguridad
seccion: administracion
orden: 441
icono: respaldo
modulo:
nivel:
roles: admin
ruta: Escritorio: Configuración > Backup
captura: t-backup.webp
---
Sirve para guardar una copia completa de la aplicación en tu computador y, si hace falta, volver a ese punto. Es lo primero que haces antes de borrar información o de un cambio grande.

## Descargar el backup

1. Entra a **Configuración > Backup**.
2. Pulsa [[Descargar backup completo]].
3. Escribe tu contraseña de administrador. La pide porque el archivo trae todo, incluidos datos personales.
4. Espera: el botón dice «Generando backup… puede tardar un momento». El navegador descarga un archivo `backup-estrategia-AAAA-MM-DD.zip`.

El .zip trae la base de datos completa (`database.sql`: usuarios, contraseñas cifradas, votantes, configuración, todo), todos los archivos subidos (fotos, documentos, comprobantes E-14) y un `LEEME.txt` con los pasos para instalar la aplicación desde cero en otro servidor. No queda copia guardada en el servidor: el archivo es tuyo, guárdalo en un lugar seguro.

## Restaurar un backup

1. En **Restaurar backup**, elige el archivo .zip generado por esta misma aplicación.
2. Escribe `RESTAURAR` en el campo de confirmación.
3. Pulsa [[Restaurar backup (reemplaza todo)]], confirma y escribe tu contraseña.

::: listo
Al descargar, el navegador guarda el .zip. Al restaurar, sale «Backup restaurado correctamente» con el nombre del respaldo previo.
:::

::: cuidado
Restaurar reemplaza **toda** la información actual por la del archivo y no se puede deshacer; antes de hacerlo, el servidor guarda lo que había en su carpeta `backups/`. Probablemente tú y todos los conectados tendrán que volver a iniciar sesión. Ese respaldo previo queda dentro del servidor, no se descarga: para recuperarlo hay que pedírselo a quien lo administra.
:::

::: consejo
La aplicación no hace backups sola desde esta pantalla: acostúmbrate a descargar uno antes de cada eliminación, de cada restauración y de las fechas clave.
:::
