---
id: mod-usuarios
titulo: Usuarios
seccion: administracion
orden: 400
icono: personas
modulo: usuarios
nivel: ver
roles:
ruta: Escritorio: Configuración > Usuarios
captura: mod-usuarios.webp
---
Aquí está la lista de todas las cuentas que pueden entrar a la aplicación de tu campaña. Sirve para saber quién tiene cuenta, con qué rol, y para arreglar accesos.

## Qué encuentras

- **Título y contador.** «Usuarios del sistema» y, debajo, cuántos usuarios se ven de cuántos hay.
- **Filtros.** Un buscador (nombre, número de identificación, email o teléfono), un desplegable de **Todos los roles**, uno de **Todo territorio**, uno de **Activos e inactivos** y el botón [[Quitar filtros]].
- **Botones de arriba.** [[+ Crear usuario]] y [[Usar Número de identificación como usuario y contraseña]].
- **La tabla**, con estas columnas: Nombre, Número de identificación, Email, Teléfono, Credenciales enviadas (una casilla que solo se mira), Rol, Territorio y Estado (Activo o Inactivo). Los botones de cada fila quedan al extremo derecho; si no los ves, desplaza la tabla hacia la derecha.
- **Botones de cada fila:** [[Editar]], [[Restablecer clave]], [[Eliminar]] y, solo si la persona tiene verificación en dos pasos, [[Quitar 2FA]]. Junto al teléfono hay un icono de WhatsApp para enviarle sus datos de acceso: abre WhatsApp con el mensaje escrito y tú lo envías.

## Qué puedes hacer según tu permiso

- **Ver**: consultar la lista y filtrarla. Esta pestaña se puede apagar en {{t-permisos}} con la columna «Usuarios».
- **Editar**: cambiar los datos de una cuenta, activarla o desactivarla, restablecer su clave y quitarle la verificación en dos pasos. Cada una de estas acciones te pide tu propia contraseña.
- **Agregar**: crear cuentas nuevas con [[+ Crear usuario]].

## Tareas frecuentes

- Crear una cuenta: {{t-usuarios}}.
- Darle clave nueva a quien no puede entrar: [[Restablecer clave]].
- Mandar a alguien sus datos de acceso: el icono de WhatsApp junto al teléfono (genera una clave nueva; la anterior deja de servir).
- Dar de baja a alguien sin borrarlo: [[Editar]] y quitar la marca «Usuario activo».

::: cuidado
La columna **Territorio** sale de la Estructura territorial, no de esta pantalla: aquí no se asigna territorio. [[Usar Número de identificación como usuario y contraseña]] cambia la clave de todos los que tengan identificación; úsalo solo cuando de verdad quieras eso. Y [[Eliminar]] borra la cuenta y su ficha en la Estructura; los votantes que esa persona registró y su equipo no se borran, pero quedan sin líder o sin supervisor. Si solo quieres que no entre más, desactívala con [[Editar]].
:::
