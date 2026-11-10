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

- **Armar una lista**: el nombre, quién va a visitar, una **zona** (opcional, se elige de un desplegable: barrios, veredas, comunas…) y el máximo de personas. La lista se arma con las personas que ESE líder o sublíder puede ver, no con las tuyas.
- **Las listas**: cada una con su estado (*Activa*, *Cerrada* o *Cancelada*), cuántas personas tiene, cuántas faltan, cuántas se cerraron y cuántas quedaron sin respuesta tras tres intentos.
- **El guion de la visita**: de 3 a 5 pasos cortos que el visitante lee en su celular. Solo el administrador lo edita; cada cambio es una versión nueva con su huella, y cada visita guarda la huella de la versión que se mostró, nunca el texto. Si la campaña no ha escrito uno, rige uno neutro (saludo, presentación del equipo, escuchar las necesidades del barrio y despedida).
- **El panel** (menú **Puerta a puerta · panel**): la cobertura por zona y el avance por visitante. Ver abajo.
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
- **Editar**: **cerrar** una lista (quien la tiene deja de recibirla; lo que ya visitó se conserva) o **cancelarla**. Una lista cerrada o cancelada también se puede **Editar** (el nombre, quién visita y el máximo de personas) y **Reactivar**. El horario solo lo cambia el administrador.

- **Solo el administrador**, en la tabla de listas: **Eliminar** una lista cerrada o cancelada que nunca tuvo una visita, u **Ocultar** una que sí las tiene (sale de la tabla, las visitas se conservan; con «Ver ocultas» la ves y puedes **Mostrar de nuevo**). Todo queda en la auditoría.
- **Solo el administrador**, en la ficha del votante: si alguien pidió no volver y luego pide que sí lo visiten, el botón **Volver a permitir visitas** quita esa marca. Pide el día en que lo pidió y un motivo, y queda en la auditoría. No cambia los mensajes: eso es aparte.

De fábrica este módulo está **apagado**: solo el administrador lo ve. Para abrirlo al equipo, el administrador lo hace en Asignación de permisos.

## El guion de la visita

En esta pantalla, sección **Guion de la visita**, el administrador escribe los pasos (de 3 a 5, cada uno corto: se leen de pie, en la puerta). **Poner el guion por defecto** deja el neutro para editarlo.

- **Antes de la fecha permitida de propaganda** el guion no puede hablar de voto, elección, cargo, candidato, partido, apoyo, favorabilidad ni imagen (ni nombrar al candidato): si lo hace, no se guarda y el mensaje dice qué palabra y en qué paso.
- **Una versión que ya no pasa esa revisión** (por ejemplo, se guardó cuando sí se podía y la fecha cambió) no llega a los celulares: ellos reciben el guion por defecto y aquí un aviso lo explica.
- El coordinador ve el guion pero no lo cambia.

## El panel

Menú **Puerta a puerta · panel**. Lo ven el administrador y el coordinador (el coordinador, solo lo de su equipo). Son **solo cifras**: nunca una lista de casas ni de personas.

- **Cobertura por zona**: listas, puertas asignadas, puertas visitadas, visitas y el resultado de cada una (no abrió, no interesado, interesado, quiere registrarse, dejó una solicitud, pidió no volver).
- **Mínimo de 5 visitas por celda** (el mismo mínimo que usa el panel en todas sus cifras). Una zona con menos no se muestra con su nombre: se suma en **Otras zonas**, y si el grupo tampoco llega, se le suma la zona visible más pequeña. Con muy pocas visitas en total, no se muestra ninguna zona.
- **Avance por visitante**: sus listas, puertas asignadas, visitadas, por visitar, cerradas y sin respuesta, y sus visitas. «Por visitar», «Cerradas» y «Sin respuesta» son el estado de hoy.
- **Filtro** por fechas (desde, hasta) y por franja del día (mañana, tarde o noche). No hay un detalle más fino que la franja.
- **Descargar en Excel**: lo mismo que ves, con la marca «Uso interno – no publicable». Lo puede descargar el administrador y quien tenga la casilla «Importar / Exportar» de este módulo.

## Editar y reactivar una lista

Una lista **activa** no se edita: primero se cierra o se cancela, porque quien la recorre tiene una copia en su celular. Con la lista cerrada o cancelada, toca **Editar**:

- **Cambiar quién visita**: se vuelve a mirar el alcance de la persona nueva y salen de la lista las personas que ella no puede ver. Si una puerta ya tenía visitas, no se borra: queda como «sin respuesta» y sus visitas se conservan.
- **Subir el máximo** trae más personas de la misma zona (con las mismas reglas de siempre); **bajarlo** saca primero las últimas que faltaban por visitar. No se puede bajar por debajo de las que ya tienen un resultado.
- **Reactivar** la deja otra vez *Activa* para quien la tenía. Se vuelven a revisar las reglas: salen las personas que hoy no las cumplen (sin autorización, sin dirección, que pidieron no volver, que ya están en otra lista activa o que se visitaron hace menos de 60 días). Si ninguna las cumple, no se reactiva.

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
