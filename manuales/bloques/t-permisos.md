---
id: t-permisos
titulo: Asignar permisos a cada rol
seccion: administracion
orden: 430
icono: llave
modulo:
nivel:
roles: admin
ruta: Escritorio: Configuración > Asignación de permisos
captura: t-permisos.webp
---
Sirve para decidir qué puede hacer cada tipo de usuario en cada módulo de la aplicación. Lo que marques aquí manda sobre el menú y los botones de todo el equipo.

## Pasos

1. Entra a **Configuración > Asignación de permisos**. Verás una tabla: cada fila es un rol y cada columna es un módulo.
2. Busca la fila del rol (Administrador, Administrativo, Asistente administrativo, Coordinador, Líder, Sublíder, Testigo o Invitado) y la columna del módulo.
3. En esa casilla marca lo que le permites:
   - **V** (Ver): el módulo aparece en el menú y se puede consultar.
   - **E** (Editar): modificar registros que ya existen.
   - **A** (Agregar nuevo): crear registros.
   - **I/E** (Importar / Exportar): los botones de importar, exportar e imprimir a PDF. Solo sale en los módulos que los tienen.
4. Pulsa [[Guardar cambios]].

::: listo
Aparece «Permisos guardados. Los cambios se verán la próxima vez que cada usuario cargue una página.»
:::

## Lo que conviene saber

- Si quitas **V**, se desmarcan solas E, A e I/E de esa casilla: sin ver no hay nada más.
- En la fila del Administrador, I/E sale marcada y bloqueada: el administrador siempre puede importar y exportar. Deja marcadas también sus otras casillas, porque quitarlas le esconde módulos a él mismo.
- El rol «usuario» no sale en la tabla; su acceso queda como está y no se edita desde aquí.
- E y A solo cambian los botones en las pantallas que ya los respetan (hoy, Estructura territorial y Votantes y sublíderes); el resto de módulos usa solo V.

::: importante
El cambio no es inmediato para quien ya tiene la aplicación abierta: lo verá cuando cargue otra página. Para el perfil Administrativo, mira {{t-permisos-administrativo}}.
:::
