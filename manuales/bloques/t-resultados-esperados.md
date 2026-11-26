---
id: t-resultados-esperados
titulo: Comparar los votantes esperados con el resultado oficial
seccion: dia-d
orden: 335
icono: grafico
modulo: resultados_dia_d
nivel: ver
roles:
ruta: Escritorio: Día D > Resultados y reclamaciones
---
Pone lado a lado lo que los líderes **esperaban** (los votantes que inscribieron con su puesto y su mesa) y lo que tu candidato sacó según el resultado **oficial**. Te dice qué líder cumplió, en qué puestos y mesas faltaron votos y cuántos votantes aún no marcan «Ya votó».

## Pasos

1. Entra a **Día D > Resultados y reclamaciones** y abre la subpestaña [[Esperados vs. oficial]].
2. Antes necesitas el oficial de tu candidato en {{t-resultados-oficial}}. Si no hay oficial cargado, la pantalla te lo avisa y no calcula nada. Si cargaste preconteo y escrutinio, abre con el escrutinio; cambia de fuente con [[Preconteo]] o [[Escrutinio]], junto a la tarjeta de puestos.
3. Lee las cuatro tarjetas de arriba: votos esperados, los marcados «Ya votó», los votos oficiales de tu candidato y el cumplimiento (con cuántos votos quedaron por debajo). Debajo, una línea dice qué porcentaje de los esperados tiene mesa, en cuántas mesas hay oficial, cuántos votantes están «sin mesa» y cuántos votos oficiales no se pudieron atribuir a nadie.
4. En **Resumen por líder** toca el título para cerrarlo o abrirlo (la pantalla recuerda cómo lo dejaste). Cada líder muestra sus esperados, cuántos ya votaron, los votos oficiales que se le estiman y su porcentaje consolidado: verde desde 90 %, amarillo de 70 a 89 % y rojo por debajo de 70 %. Toca un líder para ver sus mesas. Con [[Mayor a menor]] y [[Menor a mayor]] cambias el orden; el administrador también puede filtrar por coordinador.
5. En **Esperados vs. oficial por puesto** toca un puesto para ver sus mesas: esperados, ya votó, oficial, la diferencia y los líderes que tenían votantes en cada mesa, con su cantidad entre paréntesis. Filtra por municipio o con [[Solo por debajo del 70 %]]. Con [[⬇ Excel]] bajas las tres hojas: Líderes, Puestos y Mesas.

::: listo
El resumen por líder y la tarjeta de cumplimiento muestran porcentajes, y al desplegar un puesto ves sus mesas con los líderes de cada una.
:::

## Cómo se calcula el estimado

En cada mesa, los votos oficiales de tu candidato se **reparten entre los líderes según cuántos votantes tenía cada uno ahí**. Si en una mesa tu candidato sacó 30 votos y hay 40 votantes inscritos, 30 de un líder y 10 de otro, al primero se le estiman 22,5 votos y al segundo 7,5. El **consolidado** de un líder suma sus votos estimados y los divide entre sus votantes, contando solo las mesas que ya tienen oficial. Un líder puede pasar de 100 %: se marca con un «+» y no se recorta.

::: importante
El voto es secreto. Esto es una **estimación** a partir de los votantes inscritos en cada mesa, no una verificación de quién votó por quién. Úsala para ver tendencias y orientar el trabajo, no para señalar a una persona.
:::

## Qué hacer con los «sin mesa»

Un votante queda «sin mesa» si no tiene mesa o su mesa es mayor que las del puesto. No entra en el reparto de ninguna mesa: cuenta en los esperados de su líder y de su puesto, y sale aparte. Pídele a su líder que complete la mesa desde la ficha de la persona. Los que votan **fuera de lista** (en un puesto que la campaña no cubre) salen en una fila aparte, solo con sus esperados.

::: consejo
Si ves el aviso rojo «No encontramos a … en el resultado oficial», el nombre del candidato en Configuración > Datos de la campaña no es igual al de la lista de Candidatos. Corrígelo y vuelve a abrir la subpestaña. El coordinador ve solo a sus líderes; los demás líderes de una mesa aparecen sumados como «otros líderes».
:::
