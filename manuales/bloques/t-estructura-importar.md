---
id: t-estructura-importar
titulo: Importar y exportar la estructura con Excel
seccion: antes
orden: 112
icono: subir
modulo: territorial
nivel: importar
roles:
ruta: Escritorio: Electoral > Estructura territorial | Celular: Estructura territorial
captura:
---
Sirve para sacar el equipo a un archivo de Excel, corregirlo o ampliarlo allí y volver a cargarlo. Es la forma más rápida de agregar muchas personas a la vez o de cambiar datos de varias.

## Pasos

1. Entra a **Electoral > Estructura territorial**. En el celular (solo el administrador), abre el menú de tres puntos de la pantalla y elige **Exportar a Excel**; **Importar desde Excel** abre la pantalla de escritorio, y ahí se hace.
2. Pulsa [[Exportar a Excel]]. Se descarga el archivo `estructura.xlsx`, con una fila por persona (los testigos no vienen en este archivo; tienen el suyo en {{t-testigos-importar}}).
3. Ábrelo y haz tus cambios. Para **actualizar** a alguien, deja su columna **ID** intacta. Para **crear** a alguien, deja el **ID** vacío.
4. En cada fila nueva llena como mínimo **Nombre** y **Cargo** (Coordinador, Líder, Sublíder o Coordinador Organizaciones), el **Número de identificación** y el territorio: **Área** más Comuna y Barrio, o Corregimiento y Vereda. A un Coordinador le basta la Comuna o el Corregimiento, y a un Coordinador Organizaciones no le hace falta territorio.
5. En **Reporta a** escribe el correo de su jefe, que ya debe estar registrado. Si ese correo no existe, no se asigna jefe y no sale ningún aviso.
6. Guarda el archivo y pulsa [[Importar desde Excel]]. Elige tu archivo (.xlsx o .xls, hasta 10 MB).

::: listo
Sale una ventana de aviso del navegador: «Importación completada: X persona(s) creada(s), Y actualizada(s)», con cuántos campos se borraron con «-» (si hubo), cuántas filas fallaron y el motivo de la primera, y cuántos avisos hubo.
:::

::: importante
Actualizar por Excel nunca cambia la contraseña ni el usuario de nadie. Una fila con un ID que no existe, o una persona que ya tiene ese cargo, se rechaza con su motivo. El teléfono que no tenga 10 dígitos no se guarda: en una persona nueva se importa sin teléfono y en una que ya existe se deja el que tenía, con un aviso. Una persona nueva entra con su número de identificación como usuario y contraseña inicial; **sin cédula no se crea la cuenta** y esa fila da el error «Falta la cédula para crear la cuenta». Lo que importes de la estructura tampoco borra datos en Votantes y sublíderes.
:::

::: importante
**Una celda vacía no cambia nada.** En una fila que **actualiza**, solo se cambian las columnas que traen algo: el teléfono, el correo, la dirección, la meta, el tipo y el género vacíos se quedan como estaban. Para **borrar un dato a propósito**, escribe **-** (un guion solo): solo funciona en correo, teléfono, dirección, residencia y edad. En nombre, cédula, cargo, territorio, «Reporta a», metas, tipo, género y organización el «-» no borra: la fila da error y no se importa. En una fila que actualiza ya no hace falta repetir el cargo ni el territorio.
:::

::: consejo
Los territorios (comunas, barrios, corregimientos y veredas) tienen su propio Excel en [[Gestionar territorios]], con las columnas Departamento, Municipio, Área, Tipo, Nombre y Pertenece. Solo el administrador lo importa, y no aparece si los territorios de tu campaña vienen del Catálogo Territorial.
:::

Relacionado: {{mod-territorial}}, {{t-estructura-agregar}}.
