---
id: t-usuarios
titulo: Crear y administrar una cuenta de usuario
seccion: administracion
orden: 401
icono: persona
modulo: usuarios
nivel: agregar
roles:
ruta: Escritorio: Configuración > Usuarios
captura: t-usuarios.webp
---
Sirve para darle acceso a alguien del equipo, escoger su rol y, cuando haga falta, cambiarle la clave o dejarlo sin acceso. Esto lo hace el administrador.

## Pasos

1. En **Configuración > Usuarios**, pulsa [[+ Crear usuario]].
2. Llena **Nombre completo**, **Número de identificación** y **Teléfono** (10 dígitos; es opcional).
3. Revisa **Nombre de usuario** y **Contraseña (opcional)**. Si no los tocas, se llenan solos con el número de identificación. Si escribes una clave, debe tener mínimo 8 caracteres.
4. Escribe el **Correo electrónico** y elige el **Rol / Perfil**. Nombre, correo y rol son obligatorios.
5. Pulsa [[Guardar]].
6. Si dejaste la clave en blanco y no hay identificación, la pantalla te muestra una contraseña temporal. Anótala, porque no se vuelve a mostrar.
7. Para mandarle sus datos, pulsa el icono de WhatsApp junto a su teléfono en la tabla, confirma y escribe **tu** contraseña. Se le genera una clave nueva, se abre WhatsApp con el mensaje escrito y tú lo envías. La casilla **Credenciales enviadas** queda marcada.

## Cambios después

- **Restablecer clave:** pulsa [[Restablecer clave]]. La clave nueva es su número de identificación (o un código de 4 dígitos si no tiene) y vence en 48 horas. Esto también desbloquea su cuenta si estaba bloqueada.
- **Desactivar:** pulsa [[Editar]], quita la marca **Usuario activo** y [[Guardar]].

::: listo
Debajo del formulario sale «Usuario creado. Contraseña temporal: …» (o «Usuario creado con la contraseña que definiste.»), y la persona aparece en la tabla con su rol y el Estado «Activo». Al entrar por primera vez, la aplicación le pide cambiar la clave.
:::

::: cuidado
El desplegable **Rol / Perfil** nace vacío («Elige un rol…») y es obligatorio: tienes que elegir el rol a propósito, porque «Admin» da control total. Los roles salen con su nombre de pantalla (Líder, Asistente administrativo…). Y si usas el número de identificación como clave, ten en cuenta que debe tener 8 o más caracteres: con una cédula más corta se rechaza la clave: escribe otra o borra el campo para que se genere una temporal.
:::

::: importante
[[Editar]], [[Restablecer clave]], [[Quitar 2FA]] y [[Eliminar]] te piden **tu** contraseña. La casilla Credenciales enviadas no se marca a mano: la marca el envío por WhatsApp (marca que el mensaje se abrió, no que la persona lo recibiera).
:::

Qué ve cada rol se define en {{t-permisos}}.
