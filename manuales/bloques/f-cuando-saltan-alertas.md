---
id: f-cuando-saltan-alertas
titulo: ¿Cuándo salta cada alerta del Día D?
seccion: faq
orden: 605
icono: alerta
modulo: alertas_dia_d
nivel: ver
roles:
ruta:
captura:
---
Algunas alertas dependen de la hora y salen en gris, «Pendiente», hasta que les toca. Con los valores de fábrica:

| Alerta | Cuándo salta |
|---|---|
| Mesa sin testigo | Siempre que la mesa no tenga testigo (la de «con votantes» es la más grave) |
| Testigo que no llegó | A las 8:30: 30 minutos después de abrir las urnas (8:00), si el testigo no ha tocado «Llegué a mi puesto» |
| Mesa sin E-14 | A las 6:00 p. m.: 120 minutos después del cierre (4:00 p. m.), si la mesa con testigo no tiene la foto del E-14 |
| Baja votación | Desde las 12:00, si un puesto con al menos 5 de tus votantes tiene menos del 40 % marcado «ya votó» |
| Transporte sin recoger | Desde las 2:00 p. m., solo el día de la elección |
| Logística sin entregar | Vencida la hora límite del ítem, solo el día de la elección, para los testigos que ya marcaron su llegada |

«Reporte con alertas» y «Diferencia con el oficial» salen en cuanto existe el caso (la diferencia necesita que haya un resultado oficial cargado). Fuera del día de la elección, «Transporte sin recoger» y «Logística sin entregar» no salen ni en gris. El administrador cambia horas y umbrales en Configuración > Datos de la campaña, bloque «Jornada del Día D». Baja votación, transporte y mesa sin testigo con votantes se miden con los votantes de quien mira la pantalla. Ver {{mod-alertas_dia_d}}.
