---
id: t-testigos-importar
titulo: Importar y exportar testigos con Excel
seccion: antes
orden: 132
icono: subir
modulo: testigos
nivel: importar
roles:
ruta: Escritorio: Día D > Testigos electorales
captura:
---
Sirve para bajar la lista de testigos a Excel, corregirla y volverla a subir, o para cargar de una vez a muchos testigos nuevos con su puesto y su mesa.

## Pasos

1. Entra a **Día D > Testigos electorales**.
2. Pulsa [[Exportar a Excel]]. Se descarga `testigos.xlsx` con las columnas ID, Tipo, Nombre, Número de identificación, Teléfono, Email, Departamento votación, Municipio votación, Puesto, Mesa y Activo. La columna Activo es solo informativa: al importar no se lee; para activar o desactivar a alguien usa [[Editar]] en la pantalla.
3. Abre el archivo. Para **actualizar** a un testigo, no borres su **ID**. Para **agregar** uno nuevo, deja el **ID** vacío y llena como mínimo el **Nombre**.
4. En **Tipo** escribe "Testigo electoral" o "Coordinador de puesto". En **Mesa**, un número para el testigo; para el coordinador de puesto, una lista separada por comas, por ejemplo `3, 7, 9`.
5. Guarda el archivo y pulsa [[Importar desde Excel]]. Elige el .xlsx o .xls (hasta 10 MB).

::: listo
Sale una ventana de aviso: «Importación completada: X testigo(s) creado(s), Y actualizado(s)», con cuántos campos se borraron con «-» (si hubo), cuántas filas fallaron y el motivo de la primera, y cuántos avisos hubo; la tabla se recarga con ellos.
:::

::: importante
Si la cédula de una fila ya pertenece a alguien con cuenta (por ejemplo, un líder), no se crea una cuenta repetida: se le agrega la función de testigo. Una persona nueva con cédula entra con ella como usuario y contraseña inicial; **sin cédula no se crea la cuenta** y la fila da el error «Falta la cédula para crear la cuenta». Si ya era testigo, la fila da error.
:::

::: cuidado
Una mesa que ya tiene otro testigo en ese puesto se rechaza ("La(s) mesa(s) … ya están asignadas a otro testigo"). Un ID que no existe, o una cédula que es de otra persona, también dan error, con el número de fila. Importar y exportar lo hacen el administrador y el coordinador.
:::

::: importante
**Una celda vacía no cambia nada.** En una fila que actualiza, lo que dejes vacío (teléfono, correo, lugar de votación, mesa) se queda como estaba, y si no traes la columna **Tipo** no cambia el tipo de testigo ni las mesas del coordinador de puesto. Para **borrar un dato a propósito**, escribe **-** (un guion solo): solo funciona en teléfono, correo, departamento, municipio, puesto y mesa. En nombre, cédula y tipo el «-» no borra: la fila da error. Un teléfono que no tenga 10 dígitos no se guarda: en una persona nueva se importa sin teléfono y en una que ya existe se deja el que tenía, y sale un aviso.
:::

Relacionado: {{mod-testigos}}, {{t-testigo-agregar}}.
