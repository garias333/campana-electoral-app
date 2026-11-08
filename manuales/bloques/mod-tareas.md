---
id: mod-tareas
titulo: Tareas
seccion: durante
orden: 248
icono: check
modulo: tareas
nivel: ver
roles:
ruta: Escritorio: Electoral > Tareas | Celular: Mis tareas
captura:
---
Aquí se reparte el trabajo del equipo en el territorio: una visita a un barrio o una vereda, una entrega de material, una meta de registros, una reunión con asistentes o una tarea libre. Quien asigna la tarea le pone un responsable y, si quiere, una fecha límite; el responsable la trabaja desde su celular, la termina con su evidencia y quien la asignó la verifica o la devuelve si falta algo.

Una tarea habla de una **zona y de un equipo**: no lleva nombres ni teléfonos de personas del barrio.

## Qué encuentras

- **Resumen por estado**: cuántas tareas hay *Pendientes*, *En curso*, *Hechas* (esperando verificación), *Verificadas* y *Canceladas*, y cuántas están *vencidas* o *sin responsable activo*.
- **Filtros** por estado, tipo, responsable, zona, título y por las vencidas.
- **Por reasignar**: una bandeja con las tareas cuyo responsable ya no puede tenerlas (su cuenta se desactivó, cambió de equipo o ya no es de tu rama). Tú decides a quién pasarlas; nada se reasigna solo.
- **Cumplimiento**: por zona y por persona de tu equipo, con cuántas tareas hay, cuántas se cumplieron, cuántas están vencidas y cuántas por reasignar; y un Excel por zona, sin nombres.
- **Mapa**: círculos por zona, de unos 500 metros, donde se terminaron tareas con ubicación. No muestra personas, nombres, títulos ni fotos.
- **La lista**, con el tipo, el título, la zona, el responsable, la fecha límite y el estado. Al tocar una fila se abre el detalle.
- **El detalle**: lo que se pidió, lo que el responsable hizo (nota, cantidad, fotos y, si la compartió, la ubicación donde terminó), lo que se le devolvió y el historial de todos los cambios.
- **En el celular, «Mis tareas»**: las tuyas, con un botón para cada paso, que también funciona sin señal.
- **En tu panel del celular**: un cuadro con cuántas tareas tienes pendientes, cuántas vencen hoy y cuántas están vencidas.

## Qué puedes hacer según tu permiso

- **Ver**: abrir la lista y el detalle de las tareas de tu equipo, y trabajar las tuyas: **Empecé**, **Terminé** (con su evidencia) y **No pude** (con el motivo).
- **Agregar**: crear tareas y asignarlas. El administrador puede asignar a cualquiera; el coordinador, a su gente; el líder, a sí mismo y a sus sublíderes.
- **Importar / Exportar**: descargar el cumplimiento por zona en Excel.
- **Editar**: cambiar el título, la fecha o el responsable, **verificar** lo que ya está hecho, **devolverlo** diciendo qué falta, o cancelar la tarea con su motivo. Solo la persona que asignó la tarea (o su coordinador, o el administrador) puede hacerlo: nadie verifica lo que él mismo hizo.

De fábrica este módulo está **apagado**: solo el administrador lo ve. Para abrirlo al equipo, el administrador lo hace en Asignación de permisos.

## Estados

- **Pendiente**: asignada, todavía sin empezar. Si el responsable dice «No pude», vuelve aquí con su motivo.
- **En curso**: ya empezó. También queda así cuando se la devuelven para completar.
- **Hecha**: el responsable la terminó y adjuntó su evidencia; espera la verificación.
- **Verificada**: quien la asignó revisó la evidencia y la dio por buena.
- **Cancelada**: ya no se hace; queda escrito el motivo.

**Vencida** y **sin responsable activo** no son estados: se calculan. Una tarea está vencida si sigue abierta pasada su fecha límite, y no tiene responsable activo si la cuenta de quien la tenía asignada ya no está activa. Una tarea hecha no está vencida: solo espera que la verifiquen.

## Qué evidencia pide cada tipo

- **Tarea libre**: ninguna es obligatoria; se puede dejar una nota, fotos o la ubicación.
- **Visita**: una foto o la ubicación; con una de las dos basta.
- **Entrega de material**: la cantidad entregada y al menos una foto.
- **Meta de registros**: ninguna. Se mide sola (ver abajo).
- **Reunión**: ninguna obligatoria; el avance sale del evento.

Se admiten hasta **tres fotos** por tarea. La ubicación es **opcional y una sola**, la del momento de terminar: si no hay señal o no das el permiso, la tarea se termina igual, y nunca se guarda un recorrido.

## Las tareas que se miden solas

- **Meta de registros**: se pone una meta, una fecha límite y, si se quiere, una zona (del catálogo; cuenta también los barrios y veredas que cuelgan de ella). Cuenta los registros que logra el responsable entre la fecha de inicio y la fecha límite. **No cuentan** las personas que se anotaron por el enlace y todavía no confirman su autorización. Al llegar a la meta la tarea pasa sola a *Hecha*, sin evidencia y sin que nadie tenga que verificarla (verificarla es opcional). La cifra es la misma que ve el responsable en su panel.
- **Reunión**: se enlaza a un evento que tenga meta de asistentes. El avance es cuántos asistieron frente a esa meta, y solo lo ve quien puede ver el evento. La persona la termina y se verifica como cualquier otra.

## Conservación de las fotos

Las fotos de las tareas se guardan el mismo plazo que los datos de las solicitudes ciudadanas: pasados los meses que fije la campaña después de la fecha principal, el sistema las borra solo, una vez al día. La tarea se conserva con todo lo demás y queda anotado en su historial.

## Avisos

La persona que recibe una tarea recibe un aviso en la app, que dice **solo el tipo y la zona**, nunca el título. También se avisa cuando le verifican o le devuelven una tarea, y a quien asignó cuando alguna de sus tareas queda **por reasignar**: el aviso dice cuántas son, no cuáles. Además, la administración puede encender recordatorios automáticos, tres días antes de la fecha límite y el día en que vence, con un máximo de tres avisos por tarea; vienen **apagados** y se encienden en Configuración, en la pestaña de recordatorios.

## Tareas frecuentes

- Crear una tarea y asignarla: {{t-tarea-asignar}}
- Reasignar lo que quedó sin responsable: {{t-tarea-reasignar}}
- Sacar el cumplimiento a Excel: {{t-tarea-cumplimiento}}

::: importante
En una **visita** la zona es obligatoria. Si tu campaña no tiene barrios ni veredas en el catálogo, la zona se escribe a mano.
:::

::: consejo
Cuando devuelvas una tarea, escribe **qué falta** con claridad («falta la foto del acta»): es lo que verá quien la hizo al abrirla de nuevo.
:::
