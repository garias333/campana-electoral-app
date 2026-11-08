---
id: t-testigo-agregar
titulo: Asignar a una persona como testigo electoral
seccion: antes
orden: 131
icono: persona
modulo: testigos
nivel: agregar
roles:
ruta: Escritorio: Electoral > Estructura territorial | Escritorio: Día D > Testigos electorales
captura:
---
Sirve para dejar a alguien cubriendo una mesa, o varias mesas de un mismo puesto, el día de la elección. La pantalla Testigos electorales lista y edita; el alta se hace desde la ficha de la persona.

## Pasos

1. Entra a **Electoral > Estructura territorial**. Si la persona todavía no está, créala con [[+ Agregar persona]] ({{t-estructura-agregar}}).
2. Busca a la persona, pulsa [[Editar]] y escribe tu contraseña.
3. Marca **Es también testigo electoral**.
4. Elige el tipo: **Testigo electoral (una sola mesa)** o **Coordinador de puesto (varias mesas)**.
5. En **Puesto de votación** elige el puesto donde vigila. Puede ser distinto de donde vota.
6. Elige la **Mesa** libre, o marca las **Mesas que cubre** si es coordinador de puesto.
7. Pulsa [[Guardar cambios]].

::: listo
Sale "Registro actualizado correctamente. Se le asignó también la capacidad de testigo electoral." y la persona aparece en Día D > Testigos electorales con su puesto y su mesa.
:::

::: importante
La persona entra a la app con la misma cuenta que ya tiene. Si es nueva y la crea el administrador desde **Votantes y sublíderes** con la misma casilla, necesita número de identificación: ese número es su usuario y su contraseña inicial, que debe cambiar al entrar.
:::

::: cuidado
Una mesa solo puede tener un testigo. Si eliges una ocupada, la app responde "La(s) mesa(s) … ya están asignadas a otro testigo de ese puesto" y no guarda.
:::

::: consejo
Para cargar muchos testigos de una vez usa Excel ({{t-testigos-importar}}). Los suplentes de un puesto se manejan en la ventana de cobertura de testigos de Configuración, no en esta pantalla.
:::

Relacionado: {{mod-testigos}}.
