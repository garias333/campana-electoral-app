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
Junta en un solo archivo ZIP (una carpeta comprimida) todo lo necesario para reclamar las mesas que marcaste: un Excel con los dos conteos, su diferencia y tu nota de cada mesa; una carpeta por puesto con las fotos del E-14 y los documentos que subió cada testigo; y una lista con la «huella» de cada archivo, un código que cambia si el archivo se altera.

## Pasos

1. Antes, marca las mesas en la subpestaña [[Diferencias]] como «Para reclamar» (ver {{t-resultados-diferencias}}). Cada una necesita tener resultado oficial y reporte del testigo; el paquete incluye las mesas marcadas aunque ya no tengan diferencia.
2. Baja a la tarjeta «Paquete para el abogado». El botón dice cuántas mesas hay marcadas: [[Armar paquete (N marcadas)]]. Si N es 0, está desactivado.
3. Toca el botón. Aparece una fila nueva en la tabla, con tu nombre y la hora del pedido.
4. Espera: el estado pasa de «En cola…» a «Armando…» y luego a «Listo». Mientras se arma, la tabla se revisa sola cada 10 segundos.
5. Cuando diga «Listo», toca [[Descargar]] en esa fila. El archivo se llama `paquete-reclamacion-` más el número del paquete, con terminación `.zip`.
6. Entrega el ZIP al abogado. Debajo del botón Descargar verás el comienzo de la huella (sha256) del ZIP; sirve para comprobar que el archivo no cambió.

::: listo
La fila queda en «Listo», con el número de mesas, archivos y tamaño, la hora de vencimiento y el botón para descargar.
:::

::: cuidado
El paquete vence a las 24 horas: después la fila dice «Venció» (y al rato desaparece de la lista) y hay que armar otro. Solo se arma uno a la vez; si ya hay uno en curso, la pantalla avisa «Ya hay un paquete en curso». Si ninguna mesa marcada tiene a la vez resultado oficial y reporte del testigo, la pantalla avisa que no hay mesas marcadas «para reclamar» con resultado oficial y reporte del testigo. Si el estado es «Error», debajo aparece el motivo; vuelve a intentarlo.
:::

::: consejo
Dentro del ZIP encontrarás un archivo `sha256.txt` con la huella de cada archivo, y el Excel `mesas-para-reclamar.xlsx`. Quien revise el paquete puede comprobar las huellas con el programa `sha256sum -c sha256.txt`. Marca todas las mesas que vas a reclamar antes de armar el paquete, para no pedir varios.
:::
