---
id: t-finanzas-importar
titulo: Sacar el reporte para Cuentas Claras
seccion: durante
orden: 252
icono: descargar
modulo: finanzas
nivel: importar
roles:
ruta: Escritorio: Finanzas
captura: t-finanzas-importar.webp
---
Sirve para bajar en Excel un reporte de apoyo con tus ingresos y gastos agrupados por categoría, listo para consultarlo al diligenciar Cuentas Claras. Finanzas solo exporta: no tiene importación de movimientos.

## Pasos

1. Entra a **Finanzas**. El botón [[⬇ Cuentas Claras]] solo aparece si tu permiso incluye Importar / Exportar.
2. Pulsa [[⬇ Cuentas Claras]]. Se descarga el archivo `finanzas-cuentas-claras.xlsx`.
3. Ábrelo. Trae tres hojas: **Resumen por categoría** (Tipo, Categoría, Total registrado, Tope legal CNE y % del tope usado; salen todas las categorías, también las que están en cero), **Detalle de movimientos** (Fecha, Tipo, Categoría, Tercero, Documento tercero, Descripción y Monto) y **Notas** (el aviso de que es solo un apoyo).
4. Con esos datos, diligencia el portal de Cuentas Claras del CNE.

::: listo
Se descarga un archivo Excel con las tres hojas, y el resumen coincide con los totales de la pantalla.
:::

::: importante
El archivo es un apoyo, **no se sube directo** al portal. Antes de radicar el informe, confirma allá los códigos y el formato vigentes, porque el CNE los actualiza entre ciclos.
:::

::: consejo
Si algo no cuadra con el portal, revisa en la tabla de Movimientos que cada gasto esté en la categoría correcta. El reporte agrupa por categoría.
:::

::: cuidado
La columna **Tope legal CNE** hoy sale como «Sin tope registrado» y el porcentaje queda vacío: la app no trae los topes cargados ni tiene una pantalla para escribirlos. Consulta el tope vigente en el CNE.
:::

Relacionado: {{mod-finanzas}}, {{t-finanzas-agregar}}.
