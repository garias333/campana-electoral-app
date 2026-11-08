---
id: t-resultados-paquete
titulo: Armar el paquete de pruebas para el abogado
seccion: dia-d
orden: 334
icono: carpeta
modulo: resultados_dia_d
nivel: agregar
roles:
ruta: Escritorio: Día D > Resultados y reclamaciones
captura:
---
Junta en un solo archivo ZIP todo lo necesario para reclamar las mesas que marcaste: un Excel con los dos conteos y su diferencia, las fotos del E-14, los documentos que subió cada testigo y una lista con la huella de cada archivo.

## Pasos

1. Antes, marca las mesas en la subpestaña [[Diferencias]] como «Para reclamar» (ver {{t-resultados-diferencias}}). Cada una necesita tener resultado oficial y reporte del testigo.
2. Baja a la tarjeta «Paquete para el abogado». El botón dice cuántas mesas hay marcadas: [[Armar paquete (N marcadas)]]. Si N es 0, está desactivado.
3. Toca el botón. Aparece una fila nueva en la tabla, con tu nombre y la hora del pedido.
4. Espera: el estado pasa de «En cola…» a «Armando…» y luego a «Listo». La tabla se revisa sola cada 10 segundos.
5. Cuando diga «Listo», toca [[Descargar]] en esa fila.
6. Entrega el ZIP al abogado. Abajo del botón verás el comienzo de la huella sha256 del ZIP; sirve para comprobar que el archivo no cambió.

::: listo
La fila queda en «Listo», con el número de mesas, archivos y tamaño, la hora de vencimiento y el botón para descargar.
:::

::: cuidado
El paquete vence a las 24 horas: después la fila dice «Venció» y hay que armar otro. Solo se arma uno a la vez; si ya hay uno en curso, la pantalla avisa «Ya hay un paquete en curso». Si el estado es «Error», debajo aparece el motivo; vuelve a intentarlo.
:::

::: consejo
Dentro del ZIP encontrarás un archivo `sha256.txt` con la huella de cada archivo. El abogado puede verificarlo con `sha256sum -c sha256.txt`. Marca todas las mesas que vas a reclamar antes de armar el paquete, para no pedir varios.
:::
