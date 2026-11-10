---
id: t-no-contactar
titulo: Consultar y reactivar a quienes pidieron no recibir más
seccion: durante
orden: 266
icono: candado
modulo:
nivel:
roles: admin, coordinador
ruta: Escritorio: Mensajería > Pidieron no recibir más
captura: t-no-contactar.webp
---
Es la lista de personas que se salieron de los envíos. A ellas no se les manda nada, por ningún canal, y la app lo respeta sola en cada envío.

## Pasos

1. Entra a **CRM y mensajería > Pidieron no recibir más**. Arriba ves tres datos: **Personas**, **En los últimos 30 días** y **Por dónde lo pidieron**.
2. Busca a alguien por nombre, teléfono o correo, o filtra con las listas «Votantes y equipo» (Solo votantes, Solo equipo) y «Por cualquier vía». La tabla muestra Persona, Está en, Cuándo lo pidió y Por dónde.
3. Mira **Por dónde** para saber de dónde viene la baja: *Enlace del mensaje* (incluye el botón de cancelar suscripción del correo), *Respondio al SMS*, *Respondio por WhatsApp* o *Anotada a mano* (con el medio, por ejemplo «Anotada a mano · Llamada», y el motivo). Así salen escritas hoy en la pantalla. Si responde con palabras como BAJA, STOP o SALIR y la respuesta llega a la app, se registra sola; con el proveedor de SMS actual casi nunca llega.
4. Para sacar la lista, pulsa [[⬇ Exportar a Excel]] (si tu permiso lo incluye).
5. Para volver a habilitar a alguien, pulsa [[Reactivar]] en su fila, confirma el aviso y escribe el motivo en la ventana «¿Por qué se reactiva?». Esto lo hace solo el administrador; el coordinador ve la lista sin ese botón.

::: listo
Tras reactivar sale el aviso «Listo. Se reactivaron N ficha(s) de esta persona.» y la persona desaparece de la lista.
:::

::: cuidado
Reactiva **solo si ella misma lo pidió**. Revocar la autorización de datos es un derecho (Ley 1581) y volver a escribirle sin que lo pida va contra la norma. El motivo queda en la auditoría con tu nombre.
:::

::: consejo
Para anotar una baja que llegó por teléfono o en persona, usa {{t-baja-manual}}. Para entender por qué otro mensaje se omitió, mira {{t-autorizaciones}}.
:::
