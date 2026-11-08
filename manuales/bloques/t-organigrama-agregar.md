---
id: t-organigrama-agregar
titulo: Crear o editar un cargo del organigrama
seccion: antes
orden: 101
icono: persona
modulo:
nivel:
roles: admin, coordinador
ruta: Escritorio: Electoral > Organigrama
captura: t-organigrama-agregar.webp
---
Sirve para dejar escrito quién ocupa cada cargo de la campaña, de quién depende y qué funciones tiene. Lo que crees aquí lo ve todo el equipo en el organigrama.

## Pasos

1. Entra a **Electoral > Organigrama**.
2. Para un cargo de primer nivel pulsa [[+ Agregar cargo raíz]]. Para colgar uno de otro cargo, pulsa [[+ Subordinado]] o [[+ Asesor]] en ese cargo (en la vista **Diagrama** los botones se leen [[+ Sub.]] y [[+ Ases.]]). Para cambiar uno existente, pulsa [[Editar]] (en el Diagrama, el ícono del lápiz). La ventana se titula «Agregar cargo raíz», «Agregar subordinado», «Agregar asesor» o «Editar cargo».
3. Escribe el **Cargo** (por ejemplo, GERENTE DE CAMPAÑA). La app lo pone en mayúsculas.
4. Si ya tienes a la persona, llena **Nombres**, **Apellidos**, **Teléfono** (10 dígitos) y **E-mail**.
5. Elige el **Nivel**: de Nivel 1 a Nivel 6, o Asesores. Define el color con que se pinta.
6. En **Es subordinado de (opcional)** elige el cargo del que depende. Si lo dejas en "Ninguno — cargo raíz", queda arriba del todo. Para un cargo raíz, revisa que diga justo eso: a veces la ventana abre con otro cargo ya elegido, y entonces el cargo nuevo quedaría debajo de él.
7. Si elegiste un cargo superior, aparece **Tipo de relación**: **Subordinado (línea jerárquica)** o **Asesor / Staff (horizontal, junto al cargo)**.
8. Describe las **Funciones del cargo** y pulsa [[Guardar]].

::: listo
La ventana se cierra y el cargo aparece en el organigrama, debajo del cargo que elegiste, con el color de su nivel.
:::

::: importante
Solo el **Cargo** es obligatorio. Crear, editar y eliminar cargos lo hacen el administrador y el coordinador; los demás roles solo ven el organigrama, sin estos botones. Si escribes teléfono, debe tener 10 dígitos.
:::

::: cuidado
Un cargo no puede depender de sí mismo ni de uno de sus propios subordinados: la app lo rechaza para que no se forme un círculo.
:::

Relacionado: {{mod-organigrama}}.
