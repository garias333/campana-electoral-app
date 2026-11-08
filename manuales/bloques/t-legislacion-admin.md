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
La pantalla **Legislación** muestra el calendario electoral, un buscador dentro del texto de las normas y los PDF de leyes, decretos y resoluciones. La aplicación solo los lee: no hay botón para subirlos. Las normas las deja en el servidor quien lo administra.

## Pasos (quien administra el servidor)

1. Abre el administrador de archivos del servidor (CloudPanel) y ve a la carpeta `legislacion/`, en la raíz de la instalación.
2. Sube allí el PDF. Nómbralo como `ley-130-de-1994.pdf` o `resolucion-0920-de-2011-CNE.pdf`: así el título sale solo («Ley 130 de 1994»).
3. Si quieres títulos, descripción u orden propios, edita `indice.json` en esa misma carpeta, con una entrada por archivo.
4. Para el calendario electoral, edita `calendario.json`.
5. Abre **Legislación** y recarga la página.

::: listo
La norma nueva aparece como tarjeta en «Leyes, decretos y resoluciones» y se puede abrir, descargar y encontrar en «Buscar norma».
:::

## Quién la ve

El permiso es el módulo **Legislación**, en {{t-permisos}}. De fábrica la ven el administrador y el coordinador; los demás roles solo si les marcas **V**. Editar y Agregar no aplican: nadie cambia las normas desde la pantalla.

::: importante
La primera búsqueda después de agregar un PDF puede tardar unos segundos mientras se prepara el índice. Si `indice.json` o `calendario.json` quedan mal escritos, la aplicación los ignora y usa los nombres de archivo.
:::
