---
id: mod-puerta_listas
titulo: Puerta a puerta (armar listas)
seccion: durante
orden: 256
icono: check
modulo: puerta_listas
nivel: ver
roles:
ruta: Escritorio: Electoral > Puerta a puerta
captura:
---
Aquí armas la lista de visitas de un líder o de un sublíder con personas que **ya están registradas** en su equipo. Él la recibe en su celular, la recorre (también sin señal) y anota el resultado de cada puerta. Tú solo ves **cuántas** personas hay en cada lista, cuántas quedan por visitar y cuántas se cerraron: nunca nombres ni direcciones.

## Qué encuentras

- **Armar una lista**: el nombre, quién va a visitar, una zona (opcional) y el máximo de personas. La lista se arma con las personas que ESE líder o sublíder puede ver, no con las tuyas.
- **Las listas**: cada una con su estado (*Activa*, *Cerrada* o *Cancelada*), cuántas personas tiene, cuántas faltan, cuántas se cerraron y cuántas quedaron sin respuesta tras tres intentos.
- **El horario de las visitas** (solo el administrador): por omisión de 8:00 a 18:00, hora de Colombia; se puede mover entre las 7:00 y las 19:00.

## Quién entra en una lista

Solo entra quien dio su autorización, tiene dirección y **no pidió que no lo visiten**. Quedan fuera, y la pantalla te dice cuántas:

- las personas sin autorización o sin dirección;
- las que ya están en otra lista activa;
- las que ya se visitaron hace menos de **60 días** (por ejemplo, quien dijo «no estoy interesado»).

Una persona que pidió no volver no entra en ninguna lista nueva. Una lista tiene hasta **300** personas.

## Qué puedes hacer según tu permiso

- **Ver**: abrir la pantalla y ver las listas con sus conteos.
- **Agregar**: armar y asignar listas. El administrador puede asignar a cualquier líder o sublíder; el coordinador, a los de su equipo.
- **Editar**: **cerrar** una lista (quien la tiene deja de recibirla; lo que ya visitó se conserva) o **cancelarla**. El horario solo lo cambia el administrador.

- **Solo el administrador**, en la ficha del votante: si alguien pidió no volver y luego pide que sí lo visiten, el botón **Volver a permitir visitas** quita esa marca. Pide el día en que lo pidió y un motivo, y queda en la auditoría. No cambia los mensajes: eso es aparte.

De fábrica este módulo está **apagado**: solo el administrador lo ve. Para abrirlo al equipo, el administrador lo hace en Asignación de permisos.

## Tareas frecuentes

- Armar y asignar una lista de visitas: {{t-puerta-armar}}

## Reglas que conviene saber

- **Fuera del horario y el día de la elección no se guarda ninguna visita**: ni en el celular ni en el servidor. El día de la elección el módulo queda bloqueado.
- **No abrió**: se puede volver hasta **tres veces**, con al menos 24 horas entre una y otra.
- La lista del celular **caduca a las 48 horas** y se borra al cerrar sesión o cambiar de cuenta.
- De cada visita solo se guarda el **día**, si fue en la mañana, la tarde o la noche, y el resultado. No se guarda la hora exacta ni dónde estaba quien visitó.
- Seis meses después de la elección se corta el vínculo entre cada visita y la persona visitada; quedan solo las cifras.

::: importante
Antes de encender este módulo para el equipo, la **política de privacidad** debe mencionar la visita domiciliaria de la campaña. Si el administrador no ha editado la política, el sistema agrega ese párrafo solo; si ya la editó, Configuración → Política de privacidad muestra un aviso con el párrafo para que lo agregue a mano.
:::
