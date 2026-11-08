---
id: t-eliminar
titulo: Eliminar la información de un módulo
seccion: administracion
orden: 440
icono: basura
modulo:
nivel:
roles: admin
ruta: Escritorio: Configuración > Eliminar información
captura: t-eliminar.webp
---
Sirve para vaciar por completo la información que se ha ido cargando en un módulo, por ejemplo al terminar un ensayo y querer empezar limpio. Borra de verdad y no se puede deshacer.

## Pasos

1. Haz primero un backup: {{t-backup}}.
2. Entra a **Configuración > Eliminar información**. Verás «Esta pantalla está protegida».
3. Pulsa [[Ingresar contraseña de administrador]] y escribe tu contraseña.
4. Busca el módulo en la lista. Las áreas son: Estructura territorial, Votantes y sublíderes, Organigrama, Eventos y agenda, Finanzas (movimientos registrados), Redes y Opinión (publicaciones y menciones), Información para compartir (Recursos) y CRM y mensajería (historial de campañas y envíos).
5. Pulsa [[Eliminar todo]] en esa fila.
6. Lee la pregunta «¿Eliminar TODA la información de…?» y confirma con [[Eliminar todo]].
7. Escribe otra vez tu contraseña de administrador.

::: listo
Sale en verde «Se eliminaron N registro(s) de…» con la cantidad borrada.
:::

::: cuidado
No hay papelera: lo borrado solo se recupera restaurando un backup anterior. Cada botón vacía **todo** el módulo, no una parte. Además de la contraseña, la acción queda registrada en la auditoría con la cantidad de filas que se llevó.
:::

::: importante
No se borran los usuarios, los roles, los territorios ni la configuración general de la campaña: solo los registros del módulo que elijas.
:::
