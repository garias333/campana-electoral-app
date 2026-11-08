---
id: mod-configuracion
titulo: Configuración de la campaña
seccion: administracion
orden: 410
icono: engranaje
modulo: configuracion
nivel: ver
roles:
ruta: Escritorio: Configuración > Datos de la campaña
captura: mod-configuracion.webp
---
Configuración reúne todo lo que el administrador arregla una sola vez o de vez en cuando: quién es la campaña, quién tiene cuenta, qué ve cada rol y las copias de seguridad. En el menú lateral es un grupo con cinco entradas.

## Qué encuentras

| Entrada del menú | Para qué sirve |
|---|---|
| Datos de la campaña | Nombre del candidato, fecha de elecciones, jornada del Día D (horas de urnas y alertas), meta de votos, contacto, logo y nombre de la campaña en el menú, y zona (departamento y ciudad). |
| Usuarios | Las cuentas del equipo: crear, editar, restablecer clave y eliminar. |
| Asignación de permisos | Una tabla donde marcas qué puede hacer cada rol en cada módulo. |
| Eliminar información | Borra de una vez todos los registros de un módulo. Pide tu contraseña dos veces. |
| Backup | Descarga una copia completa de la aplicación o restaura una anterior. |

Los puestos de votación y los candidatos del Día D se configuran desde otra entrada, **Día D > Puestos de votación y candidatos**, que usa la misma página.

## Qué puedes hacer según tu permiso

- **Ver**: abrir las secciones. Hoy estas pantallas son del administrador; quien no lo sea ve el aviso «Solo un administrador puede ver y editar la Configuración». Le pasa, de fábrica, al Asistente administrativo: el menú le muestra Configuración, pero al abrirla solo ve ese aviso.
- **Editar**: cambiar los datos de la campaña, guardar permisos, restablecer claves y descargar o restaurar copias.
- **Agregar**: crear usuarios y, en el Día D, puestos y candidatos.
- **Importar / Exportar**: lo tiene siempre el administrador (aquí sirve para los puestos y los candidatos del Día D, por Excel).

## Tareas frecuentes

- Llenar la identidad de la campaña: {{t-campana-datos}}.
- Crear una cuenta: {{t-usuarios}}.
- Repartir módulos entre roles: {{t-permisos}}.
- Guardar una copia antes de un cambio grande: {{t-backup}}.

::: cuidado
Dos secciones no tienen vuelta atrás: **Eliminar información** y **Restaurar backup**. Haz siempre una copia antes. Si en la campaña hay aspirantes con su propia sublicencia, ellos solo ven Datos de la campaña (su nombre, lema, logo y meta), el Día D y las cuentas de su equipo.
:::
