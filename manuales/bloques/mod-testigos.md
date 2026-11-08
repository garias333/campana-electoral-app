---
id: mod-testigos
titulo: Testigos electorales
seccion: antes
orden: 130
icono: escudo
modulo: testigos
nivel: ver
roles:
ruta: Escritorio: Día D > Testigos electorales
captura: mod-testigos.webp
---
Aquí ves quién cubre cada puesto y cada mesa el día de la elección y cómo contactarlo. La pantalla es para el administrador y el coordinador.

## Qué encuentras

- **Tabla de testigos**, con las columnas ID, Nombre, Tipo, Número de identificación, Teléfono, Puesto de votación, Mesa, Activo.
- **Tipo**: "Testigo electoral" vigila una sola mesa. "Coordinador de puesto" cubre varias mesas del mismo puesto; en la columna Mesa dice "Varias".
- **Filtros**: buscar por nombre, cédula o teléfono, por puesto ("Todos los puestos"), por tipo ("Todos los tipos") y por estado ("Todos", "Activos", "Inactivos"). [[Quitar filtros]] los borra. A la derecha ves cuántos testigos coinciden.
- El teléfono lleva un acceso directo a WhatsApp.
- Botones arriba: [[Exportar a Excel]], [[Importar desde Excel]] y, solo para el administrador, [[Eliminar todos]].
- En cada fila: [[Editar]] y, solo para el administrador, [[Eliminar]].

## Qué puedes hacer según tu permiso

- **Ver**: consultar la tabla y filtrarla.
- **Editar**: cambiar los datos, el puesto, la mesa, el tipo o el estado (casilla «Persona activa») de un testigo con [[Editar]]. Antes de abrir la ficha te pide tu contraseña.
- **Agregar**: aquí no hay botón para crear testigos. El alta se hace desde la ficha de la persona en Estructura territorial ({{t-testigo-agregar}}), o cargando un Excel.
- **Importar / Exportar**: cargar o bajar la lista con Excel ({{t-testigos-importar}}).

## Tareas frecuentes

- Asignar a una persona como testigo: {{t-testigo-agregar}}.
- Cargar muchos testigos de una vez: {{t-testigos-importar}}.
- Ver quién no tiene mesa: filtra por puesto y revisa la columna Mesa.
- Ver qué mesas siguen sin testigo: el administrador lo ve en la ventana de cobertura de **Día D > Puestos de votación y candidatos**.

::: cuidado
[[Eliminar]] y [[Eliminar todos]] borran al testigo y su cuenta, piden la contraseña del administrador y no se pueden deshacer.
:::
