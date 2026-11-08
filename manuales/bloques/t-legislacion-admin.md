---
id: t-legislacion-admin
titulo: Publicar normas en Legislación
seccion: administracion
orden: 470
icono: balanza
modulo:
nivel:
roles: admin
ruta: Escritorio: Legislación
captura:
---
La pantalla **Legislación** tiene tres pestañas: «Calendario electoral», «Buscar norma» y «Leyes, decretos y resoluciones» (los PDF). La aplicación solo los lee: ni el administrador ve un botón para subirlos o borrarlos. Las normas las deja en el servidor quien lo administra.

## Pasos (quien administra el servidor)

1. Abre el administrador de archivos del servidor (CloudPanel) y ve a la carpeta `legislacion/`, en la raíz de la instalación.
2. Sube allí el PDF. Nómbralo como `ley-130-de-1994.pdf` o `resolucion-0920-de-2011-CNE.pdf`: así el título sale solo («Ley 130 de 1994»).
3. Si quieres títulos, descripción u orden propios, edita `indice.json` en esa misma carpeta, con una entrada por archivo.
4. Para el calendario electoral, edita `calendario.json`.
5. Abre **Legislación** y recarga la página.

::: listo
La norma nueva aparece como tarjeta en «Leyes, decretos y resoluciones», con los botones [[Ver]] y [[Descargar]], y se puede encontrar en «Buscar norma».
:::

## Quién la ve

El permiso es el módulo **Legislación**, en {{t-permisos}}. De fábrica la ven el administrador y el coordinador; los demás roles solo si les marcas **V**. Editar y Agregar no aplican: nadie cambia las normas desde la pantalla.

::: importante
La primera búsqueda después de agregar un PDF puede tardar unos segundos mientras se prepara el índice. Si `indice.json` queda mal escrito, la aplicación lo ignora y pone los títulos según el nombre de cada archivo. Si `calendario.json` queda mal escrito o falta, la pestaña «Calendario electoral» sale vacía.
:::
