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
| Mesa sin testigo | Siempre que la mesa no tenga testigo |
| Testigo que no llegó | 30 minutos después de abrir las urnas (8:00) |
| Mesa sin E-14 | 120 minutos después del cierre (16:00) |
| Baja votación | Desde las 12:00, si un puesto tiene menos del 40 % de «ya votó» |
| Transporte sin recoger | Desde las 14:00, solo el día de la elección |
| Logística sin entregar | Vencida la hora límite del ítem, solo el día de la elección |

«Reporte con alertas» y «Diferencia con el oficial» salen en cuanto existe el caso. El administrador cambia horas y umbrales en Configuración > Datos de la campaña, bloque «Jornada del Día D». Ver {{mod-alertas_dia_d}}.
