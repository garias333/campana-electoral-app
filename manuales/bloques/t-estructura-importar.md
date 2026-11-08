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
Sale una ventana de aviso del navegador: «Importación completada: X persona(s) agregada(s), Y actualizada(s)». Si hubo errores, añade cuántas filas fallaron y el motivo de la primera.
:::

::: importante
Actualizar por Excel nunca cambia la contraseña ni el usuario de nadie. Una fila con un ID que no existe, o una persona que ya tiene ese cargo, se rechaza con su motivo. El teléfono que no tenga 10 dígitos se ignora, pero la persona sí se importa. Una persona nueva entra con su número de identificación como usuario y contraseña inicial; si la dejas vacía, la cuenta se crea con una clave al azar que nadie ve.
:::

::: cuidado
En una fila que **actualiza**, lo que dejes vacío se borra de la ficha: el teléfono, el correo, la dirección y la meta. Por eso exporta primero y no borres celdas de las personas que ya existen.
:::

::: consejo
Los territorios (comunas, barrios, corregimientos y veredas) tienen su propio Excel en [[Gestionar territorios]], con las columnas Departamento, Municipio, Área, Tipo, Nombre y Pertenece. Solo el administrador lo importa, y no aparece si los territorios de tu campaña vienen del Catálogo Territorial.
:::

Relacionado: {{mod-territorial}}, {{t-estructura-agregar}}.
