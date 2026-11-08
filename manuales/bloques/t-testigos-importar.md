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
2. Pulsa [[Exportar a Excel]]. Se descarga `testigos.xlsx` con las columnas ID, Tipo, Nombre, Número de identificación, Teléfono, Email, Departamento votación, Municipio votación, Puesto, Mesa y Activo.
3. Abre el archivo. Para **actualizar** a un testigo, no borres su **ID**. Para **agregar** uno nuevo, deja el **ID** vacío y llena como mínimo el **Nombre**.
4. En **Tipo** escribe "Testigo electoral" o "Coordinador de puesto". En **Mesa**, un número para el testigo; para el coordinador de puesto, una lista separada por comas, por ejemplo `3, 7, 9`.
5. Guarda el archivo y pulsa [[Importar desde Excel]]. Elige el .xlsx o .xls (hasta 10 MB).

::: listo
Sale el aviso "Importación completada" con cuántos testigos se agregaron y cuántos se actualizaron, y la tabla se recarga con ellos.
:::

::: importante
Si la cédula de una fila ya pertenece a alguien con cuenta (por ejemplo, un líder), no se crea una cuenta repetida: se le agrega la función de testigo. Una persona nueva con cédula entra con ella como usuario y contraseña inicial. Si ya era testigo, la fila da error.
:::

::: cuidado
Una mesa que ya tiene otro testigo en ese puesto se rechaza ("La(s) mesa(s) … ya están asignadas a otro testigo"). Un ID que no existe, o una cédula que es de otra persona, también dan error, con el número de fila. Importar y exportar lo hacen el administrador y el coordinador.
:::

Relacionado: {{mod-testigos}}, {{t-testigo-agregar}}.
