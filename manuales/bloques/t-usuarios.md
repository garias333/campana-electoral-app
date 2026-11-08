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
captura:
---
Sirve para darle acceso a alguien del equipo, escoger su rol y, cuando haga falta, cambiarle la clave o dejarlo sin acceso. Esto lo hace el administrador.

## Pasos

1. En **Configuración > Usuarios**, pulsa [[+ Crear usuario]].
2. Llena **Nombre completo**, **Número de identificación**, **Teléfono** (10 dígitos) y **Correo electrónico**. Nombre, correo y rol son obligatorios.
3. Revisa **Nombre de usuario** y **Contraseña (opcional)**. Si no los tocas, se llenan solos con el número de identificación. Si escribes una clave, debe tener mínimo 8 caracteres.
4. Elige el **Rol / Perfil** y pulsa [[Guardar]].
5. Si dejaste la clave en blanco y no hay identificación, la pantalla te muestra una contraseña temporal. Anótala, porque no se vuelve a mostrar.
6. Para mandarle sus datos, pulsa el icono de WhatsApp junto a su teléfono en la tabla. Se le genera una clave nueva y la casilla **Credenciales enviadas** queda marcada.

## Cambios después

- **Restablecer clave:** pulsa [[Restablecer clave]]. La clave nueva es su número de identificación (o un código de 4 dígitos si no tiene) y vence en 48 horas.
- **Desactivar:** pulsa [[Editar]], quita la marca **Usuario activo** y [[Guardar]].

::: listo
La persona aparece en la tabla con su rol y el Estado «Activo»; al entrar por primera vez, la aplicación le pide cambiar la clave.
:::

::: importante
[[Editar]], [[Restablecer clave]], [[Quitar 2FA]] y [[Eliminar]] te piden **tu** contraseña. La casilla Credenciales enviadas no se marca a mano: la marca el envío por WhatsApp.
:::

Qué ve cada rol se define en {{t-permisos}}.
