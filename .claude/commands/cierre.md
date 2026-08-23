---
description: Actualiza ESTADO.md con el resumen de esta sesión para retomar en otra máquina
---

Actualiza `ESTADO.md` en la raíz del proyecto para que otra sesión de Claude
Code, en otra máquina y sin contexto previo, pueda retomar el trabajo.

Reglas de redacción, en orden de importancia:

1. **Distingue lo hecho de lo intentado.** Marca `[x]` solo lo que quedó
   implementado Y verificado en esta sesión. Lo planeado, lo dejado a medias o
   lo que no se pudo comprobar va en Pendiente, dicho con esas palabras. Si no
   sabes si algo quedó funcionando, escríbelo así en vez de asumir que sí.
2. **Ancla a hechos comprobables.** Commit, rama, número de parche, rutas de
   archivo con línea, nombre del proceso PM2, endpoint probado. Un pendiente
   sin referencia concreta no le sirve a la próxima sesión.
3. **Registra las trampas.** Lo que costó descubrir aquí y que la próxima
   sesión repetiría: un comando que falla en silencio, un orden de pasos que
   importa, un supuesto que resultó falso.
4. **No toques `CLAUDE.md`.** Es contexto permanente y se edita a mano. Si algo
   de esta sesión merece ser permanente, anótalo al final de ESTADO.md bajo
   "Candidatos para CLAUDE.md" y déjalo a criterio del usuario.
5. **Reescribe el archivo completo** dejando solo el estado vigente. Elimina
   los bloques de "cierre automático" anteriores; no acumules bitácoras viejas.

Conserva la estructura de secciones existente. Al terminar, muéstrame en el
chat un resumen de tres líneas de lo que escribiste.
