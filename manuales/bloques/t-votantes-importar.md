---
id: t-votantes-importar
titulo: Importar y exportar votantes con Excel
seccion: antes
orden: 123
icono: subir
modulo: votantes
nivel: importar
roles:
ruta:
captura:
---
Sirve para sacar la base de votantes a Excel, corregirla en el computador y volver a cargarla, o para meter muchas personas de una vez. Se hace en el escritorio, y solo lo hacen el administrador y el coordinador.

## Pasos

1. Entra a **Electoral > Votantes y sublíderes**. Si quieres exportar solo una parte, aplica antes los filtros.
2. Pulsa [[Exportar a Excel]] para bajar la base que ves, o [[Exportar a Excel (filtrados)]] para bajar solo lo filtrado. El archivo se llama `votantes.xlsx`.
3. Abre el archivo. Para **actualizar** a una persona, no borres su columna **ID**. Para **agregar** una nueva, deja el **ID** vacío.
4. En cada fila llena como mínimo **Nombres y apellidos**. Lo demás es opcional: Número de identificación, Teléfono, Email, Departamento y Municipio votación, Puesto, Mesa, Área, Comuna, Barrio, Corregimiento, Vereda, Líder o coordinador (su correo) y Observaciones. Si dejas vacío el Líder o coordinador, o ese correo no existe, la persona queda a tu nombre.
5. Guarda el archivo y pulsa [[Importar desde Excel]]. Elige el .xlsx o .xls (hasta 10 MB).

::: listo
Sale un aviso que dice «Importación completada» con cuántos contactos se crearon y cuántos se actualizaron, cuántos campos se borraron con «-» (si hubo), cuántas filas dieron error y cuántos avisos hubo, y la lista se recarga con ellos.
:::

::: importante
Qué se rechaza o se corrige: una cédula que ya existe en la base o repetida dentro del archivo se salta ("Cédula repetida"); un ID que no existe da error; una fila sin nombre no entra. Un teléfono que no tenga 10 dígitos no se guarda: en una persona nueva se importa sin teléfono, y en una que ya existe se deja el que tenía; en los dos casos sale un aviso. La comuna se valida contra la lista de la campaña: si no está, queda vacía y el aviso final la nombra. El aviso final cita solo el primer error.
:::

::: importante
**Una celda vacía no cambia nada.** Al actualizar una fila con ID, solo se cambian las columnas que traen algo; lo que dejes vacío se queda como estaba en la ficha. Para **borrar un dato a propósito**, escribe **-** (un guion solo) en la celda. Eso solo funciona en correo, teléfono, dirección, observaciones, puesto, mesa, departamento y municipio de votación, residencia, fecha de nacimiento y edad. En nombre, cédula, género, área, territorio y líder el «-» no borra: la fila da error y no se importa.
:::

::: cuidado
El archivo tampoco trae la autorización de tratamiento de datos que se captura al registrar a mano. Y la opción solo sale si tienes el permiso de Importar / Exportar.
:::

::: consejo
Si una fila no trae cédula, la app avisa cuando hay una persona parecida por teléfono o nombre, pero la importa igual.
:::

Relacionado: {{mod-votantes}}.
