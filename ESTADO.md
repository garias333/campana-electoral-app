# ESTADO — electoral

> Bitácora de handoff entre máquinas. La escribe `/cierre` al final de cada
> sesión y el hook de apertura la inyecta automáticamente al iniciar.
> El contexto permanente (arquitectura, puertos, reglas de despliegue) va en
> CLAUDE.md, no aquí.

## Anclas verificables

*Medidas el 6 de noviembre de 2026 a las ~20:05 desde la cuenta `gariasappelectoral`,
que NO puede leer las otras instalaciones ni la tabla `parches_disponibles`: lo que
dependa de ellas dice «no medido». Las anclas de agosto (parche 249, `v121`, «Árbol
limpio») estaban obsoletas y se reemplazaron.*

- **Último parche generado: 316** (`parches/campana-parche316.zip`, 57.028 bytes,
  sha256 `21d55b3b720b55ace20e1a732fe2fcbe4b8aacab438d33bd43b96a96b02ee8a1`, 7 archivos): «Mis avisos: al tocar un aviso en la app se abre el mensaje completo». **GENERADO el 10 de noviembre de 2026; los 6 archivos son idénticos a los del disco (cmp); `verificar-requires.js`: «TODO RESUELVE» (22 requires locales).** **NO TOCA LA BASE.** **Requiere el 315** (y por tanto el 314). Service worker `v186`. **PUBLICADO Y REGISTRADO el 10 de noviembre de 2026 (INACTIVO: falta cambiar la distribución a «seleccionadas» —municipal, departamental y c001, nunca la Base—, activarlo y aplicarlo desde el panel).** Detalle en «Parche 316».
- **El anterior, el 315** (`parches/campana-parche315.zip`, 50.649 bytes,
  sha256 `f476c7cee4a6eae8845db8652f3636646d795af5ef16374a62d6455f726022ea`, 5 archivos): «Aviso en la app: cruce por teléfono con la cuenta y motivo claro cuando no llega». **GENERADO el 10 de noviembre de 2026; los 4 archivos son idénticos a los del disco (cmp); `verificar-requires.js`: «TODO RESUELVE» (18 requires locales).** **NO TOCA LA BASE.** **Requiere el 314** (el service worker `v185` lleva `/js/mapa-fondo.js`, que el 314 trae). **PUBLICADO Y REGISTRADO el 10 de noviembre de 2026 (INACTIVO: falta cambiar la distribución a «seleccionadas» —municipal, departamental y c001, nunca la Base—, activarlo y aplicarlo desde el panel).** Detalle en «Parche 315».
- **El anterior, el 314** (`parches/campana-parche314.zip`, 59.442 bytes,
  sha256 `651aeb542812d3358cb24497726fc1186d94163f733d0ca00112dee36c05e332`, 8 archivos): «Fondo de mapa común: arregla el mapa bloqueado en Solicitudes y Tareas». **GENERADO el 9 de noviembre de 2026; los 7 archivos son idénticos a los del disco (cmp); `verificar-requires.js`: «TODO RESUELVE».** **NO TOCA LA BASE.** **Requiere el 313** (el service worker `v184` lleva las entradas del 313). Detalle en «Parche 314».
  Estado de publicación: ver «Parche 314».
- **El anterior, el 313** (`parches/campana-parche313.zip`, 124.600 bytes,
  sha256 `2bdacd3a60892459ea35f77fc815a6899a21973f361502ca81dabe6536788370`, 13 archivos): «Eventos en el celular y marcar asistencia (escritorio y celular, también sin señal) (Requiere el 312)».
  **GENERADO el 9 de noviembre de 2026, PUBLICADO Y REGISTRADO ESE MISMO DÍA (INACTIVO: falta activarlo y aplicarlo desde el panel, y probarlo antes).** Lo corrió el usuario como root con `su - gariasappelectoral` (salida pegada): `parche-313.zip` en el servidor de licencias con huella igual a la local (`2bdacd3a60892459`), registro **HTTP 200**, firmado (Ed25519), **`toca_base_datos = true`**, estado INACTIVO. Los 13 archivos del zip son idénticos a los del disco (md5, uno a uno); `verificar-requires.js`: «TODO RESUELVE» (22 requires locales); nada de `.env`, credenciales ni `.sql`.
  **TOCA LA BASE** (`db/init-db.js`: `evento_asistentes.asistio_ms` y `asistio_por`; repetible; al registrarlo el script marca `toca_base_datos` solo). **Requiere el 312.** Service worker **`v183`**. **`OFFLINE_DB_VERSION = 11`** (cola `eventos_pendientes` y copia `eventos_cache`). Detalle en «Parche 313».
  Ya está publicado y registrado; falta activarlo en el panel de licencias.
- **El anterior, el 312** (`parches/campana-parche312.zip`, 167.401 bytes, sha256 `c3d601a9a8076749ab03d7aa9da601b96c4bd784eee67629f62b220d6bcdd46b`, 14 archivos): **PUBLICADO Y REGISTRADO el 9 de noviembre de 2026, INACTIVO** (el usuario aplicó `init-db` y el reinicio en la Base; falta activarlo en el panel). Detalle en «Parche 312».
- **El anterior, el 311** (`parches/campana-parche311.zip`, 176.420 bytes,
  sha256 `874817043e135839b7eae4e685e720dc3d19796646d5dd39ad354a22442f16cd`, 14 archivos; incluía el 310): **PUBLICADO Y APLICADO** (lo dijo el usuario el 9 de noviembre de 2026; **la prueba en municipal salió bien: mapa, cola sin señal y botones**. No se pudo comprobar desde esta cuenta, que no lee el servidor de licencias ni las otras instalaciones; el 310 nunca se publicó por separado: lo llevó el 311). Detalle en «Parche 311».
- **Antes, el 310** (`parches/campana-parche310.zip`, 54.660 bytes,
  sha256 `4c3ab964ea00b1da1351d21831ac9123ca353412914bee4544370fe89c9aa1c4`, 9 archivos): «Puerta a puerta, Fase 2: mapa y ruta, Leaflet local también en Tareas y Solicitudes (Requiere el 309)».
  **GENERADO el 9 de noviembre de 2026; NUNCA SE PUBLICÓ: lo llevó el 311, que está aplicado.** Los 9 archivos del zip son idénticos a los del disco (comparados uno a uno); `verificar-requires.js`: «TODO RESUELVE»; nada de `db/`, `.env`, credenciales ni `.sql`.
  **NO TOCA LA BASE** (`toca_base_datos = false`: no hay cambios en `db/`). **Requiere el 309.** Service worker **`v180`**. `OFFLINE_DB_VERSION` sigue en 10. Detalle en «Parche 310».
  El anterior, el 309 (`parches/campana-parche309.zip`, 240.347 bytes,
  sha256 `7383d456e37283d2a413d75ced71e06492e634e4f86d5bbe014a3d00b25b8fec`, 23 archivos): «Puerta a puerta, Fases 0 y 1: listas de visitas a votantes registrados, recorrido en el celular sin señal (Requiere el 308)».
  **REGENERADO el 9 de noviembre de 2026 (segunda orden) y luego PUBLICADO, ACTIVADO Y APLICADO en municipal, departamental y c001** (el usuario lo confirmó en el panel al pedir el 310; no se pudo comprobar desde esta cuenta, que no lee el servidor de licencias ni esas instalaciones). El primer zip, de 171.700 bytes y 19 archivos, quedó sustituido y nunca se publicó. Los 23 archivos del zip son idénticos a los del disco (comparados uno a uno); `verificar-requires.js`: «TODO RESUELVE»; ningún `.env`, credencial ni `.sql`.
  **TOCA LA BASE** (`db/init-db.js`: 3 tablas `puerta_*`, `votantes.no_visitar` y `no_visitar_fecha`, la franja en `configuracion_campana`, los módulos `puerta_listas` y `puerta_visitas` —ambos APAGADOS de fábrica— **y la finalidad de las visitas en la política de privacidad**; repetible; **probado sobre una base creada con la plantilla del 308**). **Requiere el 308.** Service worker `v179`. Cola sin señal: **`OFFLINE_DB_VERSION = 10`**. Detalle en «Parche 309».
  **Ya está en las tres campañas** (ver arriba). Cada campaña corrió `init-db` al aplicarlo: en las que tienen la política SIN editar, se agregó el párrafo de las visitas; en las que la editaron, no (el aviso de Configuración → Política de privacidad lo cubre). **Qué pasó en cada una: NO MEDIDO**; se mira en el `logs/actualizaciones.log` de cada instalación, como root.
  El anterior, el 308 (`parches/campana-parche308.zip`, 129.197 bytes,
  sha256 `c016133c24f235728cab40cd537823907b6380afab101950c2dcc7812eeda297`, 17 archivos): «Encuestas internas, Fases 3 y 4: resultados con mínimo por celda, calidad y arreglos de las colas sin señal (Requiere el 307)».
  **Publicado y registrado el 9 de noviembre de 2026** (lo corrió el usuario como root con `su - gariasappelectoral`; salida pegada): `parche-308.zip` en el servidor de licencias con huella igual a la local (`c016133c24f23572`), **HTTP 200**, firmado (Ed25519), **`toca_base_datos = true`**. **Activado y aplicado en municipal, departamental y c001** (confirmado por el usuario en el panel, 9 de noviembre de 2026).
  **TOCA LA BASE** (`db/init-db.js`: `configuracion_campana.encuesta_min_celda`, 5 columnas de revisión en `encuesta_respuestas`, `texto_revisado`, la tabla `encuesta_cuotas` y la finalidad de las encuestas en la política de privacidad con su versión archivada; repetible; **probado sobre una base creada con la plantilla del 307**). **Requiere el 307.** Service worker `v178`. Cola sin señal: sigue `OFFLINE_DB_VERSION = 9`. Detalle en «Parche 308».
  **El 307 también está publicado, activado y aplicado en las tres campañas** (lo dijo el usuario; la salida de sus comandos no se vio desde esta cuenta, así que la huella, el HTTP y la firma no constan aquí).
  El anterior, el 307 (`parches/campana-parche307.zip`, 195.819 bytes,
  sha256 `e06ac395d77e9146d4adb5d607e698566c01f888c494a4f15841b6045dc1b274`, 26 archivos): «Encuestas internas, Fases 1 y 2: constructor y campo sin señal (Requiere el 306)».
  Generado el 9 de noviembre de 2026; **publicado, activado y aplicado en municipal, departamental y c001** según el usuario (confirmado en el panel; sin la salida de su comando no constan desde aquí la huella, el HTTP ni la firma).
  **TOCA LA BASE** (`db/init-db.js`: 4 tablas `encuesta*` y los módulos `encuestas` y `encuestas_campo`, ambos APAGADOS de fábrica; repetible; **probado sobre una base creada con la plantilla del 306**). **Requiere el 306** (`lib/zonas.js` y la vuelta diaria de `solicitudesMantenimiento`). Service worker `v177`. Cola sin señal: **`OFFLINE_DB_VERSION = 9`**. Detalle en «Parche 307».
  El anterior, el 306 (`parches/campana-parche306.zip`, 168.452 bytes,
  sha256 `0f80b27e7b9fada7879f17cdc7c4f30e60fabbd42c1138b9c67abc2d161cbe5c`, 24 archivos): «Tareas, Fases 3 y 4: metas medibles, reuniones, por reasignar, cumplimiento y conservación de fotos (Requiere el 305)».
  **Publicado y registrado el 8 de noviembre de 2026** (lo corrió el usuario como root): `parche-306.zip` en el servidor de licencias con huella igual a la local (`0f80b27e7b9fada7`), **HTTP 200**, firmado (Ed25519), **`toca_base_datos = true`** y **estado INACTIVO**: ninguna instalación lo descarga hasta que se active en el panel.
  **TOCA LA BASE** (`db/init-db.js`: amplía el ENUM de `tareas.tipo` y agrega 6 columnas; repetible; **probado sobre una base creada con la plantilla del 305**). **Requiere el 305** (las tablas de tareas). Service worker `v176`. Detalle en «Parche 306».
  El anterior, el 305 (`parches/campana-parche305.zip`, 217.708 bytes,
  sha256 `68485c5b1f60fe90ee4770d73524f5dbc339589f782745f41598bff07e3c68ad`, 25 archivos): «Eventos con permiso y alcance + Tareas, Fases 1 y 2 (Requiere el 304)».
  **Publicado y registrado el 8 de noviembre de 2026** (lo corrió el usuario como root): `parche-305.zip` en el servidor de licencias con huella igual a la local (`68485c5b1f60fe90`), **HTTP 200**, firmado (Ed25519), **`toca_base_datos = true`** y **estado INACTIVO**: ninguna instalación lo descarga hasta que se active en el panel.
  **TOCA LA BASE** (`db/init-db.js`: tablas `tareas`, `tarea_historial`, `tarea_fotos`, módulo `tareas` solo para el administrador y 2 reglas de recordatorio `tarea_vence` apagadas; repetible). **Requiere el 304** (`lib/recordatorios.js` carga `recordatoriosSolicitudes`). Service worker `v175`. Cola sin señal: `OFFLINE_DB_VERSION = 8`. Detalle en «Parche 305».
  **Ojo: la Parte A (eventos) CIERRA UNA FUGA Y CAMBIA LO QUE VE CADA ROL apenas se aplique** (no depende de ningún interruptor): ver «Parche 305».
  El anterior, el 304 (`parches/campana-parche304.zip`, 176.354 bytes,
  sha256 `fd64378af9e3c17219e361b22b59636583a15f3cfeceb40903b43c7c7774ecfc`, 18 archivos): «Solicitudes ciudadanas, Fases 3 a 5 (Requiere el 303)».
  **Publicado y registrado el 8 de noviembre de 2026** (lo corrió el usuario como root): `parche-304.zip` en el servidor de licencias con huella igual a la local (`fd64378af9e3c172`), **HTTP 200**, firmado (Ed25519), **`toca_base_datos = true`** y **estado INACTIVO**: ninguna instalación lo descarga hasta que se active en el panel.
  **TOCA LA BASE** (`db/init-db.js`: columna `configuracion_campana.solicitud_dias_sin_movimiento` = 15 y la regla de fábrica `solicitud_sin_movimiento`, APAGADA; repetible). **Requiere el 303** (las tablas `solicitud*`). Service worker `v174`. Detalle en «Parche 304».
  **La anonimización YA NO necesita cron**: corre sola dentro del proceso, una vez al día (ver «Parche 304»). El crontab que se pensó para el 303 no hace falta.
  El anterior, el 303 (`parches/campana-parche303.zip`, 159.399 bytes,
  sha256 `3a5d903b4909a7421173d0c588b1639e72a8ed97d211d7230da556e537b301cd`, 18 archivos): «Solicitudes ciudadanas, Fases 1 y 2 (Requiere el 302)».
  Generado el 8 de noviembre de 2026; **el usuario pegó el comando de publicación y registro, pero su salida NO se ha visto** (no consta HTTP, firma ni estado): hasta que la pegue, el 303 cuenta como generado y no verificado como publicado.
  **TOCA LA BASE** (`db/init-db.js`: 4 tablas `solicitud*`, columna `configuracion_campana.anonimizar_solicitudes_meses`, 9 categorías, módulo `solicitudes` solo para el administrador, y el párrafo de finalidad en la política de privacidad con su versión archivada; repetible). Service worker `v173`. Cola sin señal: `OFFLINE_DB_VERSION = 7`.
  El anterior, el 302 (`parches/campana-parche302.zip`, 96.635 bytes,
  sha256 `8029948a745d122d66c99df9e373dd2a4d026e9bd153014cd983c8d135299f1e`, 8 archivos): «Recordatorios: SMS de evento con enlace de baja (Requiere el 301)».
  **Publicado y registrado el 8 de noviembre de 2026** (lo corrió el usuario como root): `parche-302.zip` en el servidor de licencias con huella igual a la local (`8029948a745d122d`), **HTTP 200**, firmado (Ed25519), **`toca_base_datos = true`** y **estado INACTIVO**: ninguna instalación lo descarga hasta que se active en el panel.
  **TOCA LA BASE** (`db/init-db.js`: pasa a la plantilla nueva las reglas de evento sin editar; repetible); **requiere el 301**. Service worker sin cambio (`v172`).
  El anterior, el 301 (`parches/campana-parche301.zip`, 193.492 bytes, sha256 `e0720f3235f8b30163644b0365d6811497c6d0287a182b4eca4fdb37a4598442`, 14 archivos):
  **publicado** (`parche-301.zip` en el servidor de licencias, misma huella, comprobado el 8 de noviembre de 2026); el registro y la activación los hizo el usuario («Lo corro yo»), no verificables desde esta cuenta.
  El anterior, el 300 (`parches/campana-parche300.zip`, 148.675 bytes, sha256 `53b49e358ffd0eb6096aa6bb3f1543e71cfa42765fc73383ea61ab70fdadc8f9`, 10 archivos):
  **publicado** (`parche-300.zip` en el servidor de licencias, misma huella, comprobado el 8 de noviembre de 2026); el registro y la activación los hizo el usuario («Lo corro yo»), no verificables desde esta cuenta.
  El anterior, el 299 (`parches/campana-parche299.zip`, 1.060.532 bytes, sha256 `aed6980626137a65fad3dfbe303fb421637bd68d508f258c3a0aa2cbbd957cad`, 154 archivos):
  **publicado** (`parche-299.zip` en el servidor de licencias, misma huella, comprobado el 8 de noviembre de 2026); el registro y la activación los hizo el usuario («Lo corro yo»), no verificables desde esta cuenta.
  El anterior, el 298 (`parches/campana-parche298.zip`, 4.002.523 bytes, sha256 `3f17c575d8737022682e033aaab75e3d008424b2936d12352e233a4430b5ccff`, 150 archivos):
  **publicado** (`parche-298.zip` en el servidor de licencias, misma huella, comprobado el 8 de noviembre de 2026); el usuario dijo «Lo corro yo» para publicarlo y registrarlo;
  el registro y la activación no se pueden leer desde esta cuenta.
  El anterior, el 297 (`parches/campana-parche297.zip`, 27.585 bytes, sha256 `e57fe588a7b28a33d14f9a7dd2be65cf311ba67228204f3be77f698b9fef6ecc`, 6 archivos).
  **Publicado** (`parche-297.zip` en el servidor de licencias, misma huella, comprobado el 8 de noviembre de 2026) y **activado por el usuario** ese día («Ya activé…»; el registro y la activación no se pueden leer desde esta cuenta).
  «Manuales: diseño final (Requiere el 296)»; no toca la base; requiere el 296. Service worker `v170`. El anterior, el 296 (`parches/campana-parche296.zip`, 144.103 bytes,
  sha256 `f275335882197ff5d7f7068edb574d522dd43b9116ecbf050300850b2be83161`, 17 archivos).
  **Publicado** (`parche-296.zip`, misma huella) y **registrado y firmado (Ed25519), INACTIVO**, con **`toca_base_datos = false`**;
  nombre en el panel: «Panel del líder en el celular y cierre de fugas de alcance (Requiere el 295)» (detalle abajo); **requiere el 295** (la orden decía 294: ya estaba publicado el 295).
  Service worker `v169`. El anterior, el 295 (`parches/campana-parche295.zip`, 273.318 bytes,
  sha256 `771998dbb049b2c7abfc7c7ea9f64ebaf815de6cf80254b1017db77832562342`, 190 archivos).
  **Publicado** (`parche-295.zip`, misma huella) y **registrado y firmado (Ed25519), INACTIVO**, con **`toca_base_datos = false`**;
  nombre en el panel: «Manuales de ayuda nuevos por rol (Requiere el 294)» (detalle abajo); **requiere el 294**.
  Service worker `v168`. El anterior, el 294 (`parches/campana-parche294.zip`, 261.170 bytes,
  sha256 `e10d16f80c27390cac2154603d182ccb6eaf14cf718678f1961f88827a4199f7`, 16 archivos).
  **Publicado** (`parche-294.zip`, misma huella) y **registrado y firmado (Ed25519), INACTIVO**, con **`toca_base_datos = false`**;
  nombre en el panel: «Escritorio: encabezados de las tablas alineados en Votantes, Estructura, Configuración y demás pantallas (Requiere el 293)» (detalle abajo); **requiere el 293**.
  Service worker `v167`. El anterior, el 293 (`parches/campana-parche293.zip`, 116.813 bytes,
  sha256 `c737ffffd2b5b257a9ceb41be91966d08754c869e00f7dfb2887b15b4eefe326`, 7 archivos).
  **Publicado** (`parche-293.zip`, misma huella) y **registrado y firmado (Ed25519), INACTIVO**, con **`toca_base_datos = false`**;
  nombre en el panel: «Día D: encabezados de las tablas alineados con sus celdas (Requiere el 292)» (detalle abajo); **requiere el 292**.
  Service worker `v166`. El anterior, el 292 (`parches/campana-parche292.zip`, 99.600 bytes,
  sha256 `7090310c92b53642e50c765b045a2603733324e198c1be75cfbb3d4631e19e69`, 6 archivos).
  **Publicado** (`parche-292.zip`, misma huella) y **registrado y firmado (Ed25519), INACTIVO**, con **`toca_base_datos = false`**;
  nombre en el panel: «Menú del celular y tablas de Logística alineadas (Requiere el 290; reemplaza al 291)» (detalle abajo); **requiere el 290**.
  Service worker `v165`. **Aplicado en las tres campañas** (confirmado por el usuario el 8 de noviembre de 2026; no medido desde aquí). **Reemplaza al 291, que NUNCA se instaló** (confirmado por el usuario): sigue registrado e inactivo, y así debe quedar; trae lo mismo menos la alineación de las tablas. El anterior, el 291 (`parches/campana-parche291.zip`, 95.914 bytes,
  sha256 `665a3fa0d08eac5a6c0d927a11f904dda06456a2954624560ce4a81c852ec396`, 5 archivos).
  **Publicado** (`parche-291.zip`, misma huella) y **registrado y firmado (Ed25519), INACTIVO**, con **`toca_base_datos = false`**;
  nombre en el panel: «Menú del celular: se cierra al tocar un ítem y muestra la vista (Requiere el 290)» (detalle abajo); **requiere el 290**.
  Service worker `v165`. El anterior, el 290 (`parches/campana-parche290.zip`, 24.454 bytes,
  sha256 `9aa6f863614e3fa5328f11f6ee15292b83e5a1fe7b0ced974f28e406ce0bc828`, 6 archivos).
  **Publicado** (`parche-290.zip`, misma huella) y **registrado y firmado (Ed25519), INACTIVO**, con **`toca_base_datos = false`**;
  nombre en el panel: «Páginas del celular: contenedor main.app-cuerpo y service worker v164 (Requiere el 289)» (detalle abajo); **requiere el 289**.
  Service worker `v164`. El anterior, el 289 (`parches/campana-parche289.zip`, 210.581 bytes,
  sha256 `33dee58cfeed248031c944ed91202e65d849ffb876eeb8411028f07cbf0ab6c7`, 21 archivos).
  **Publicado** (`parche-289.zip`, misma huella) y **registrado y firmado (Ed25519), INACTIVO**, con **`toca_base_datos = true`**;
  nombre en el panel: «Día D: logística (refrigerios y kits) y Panel por rol (Requiere el 288)» (detalle abajo); **requiere el 288**.
  Service worker `v163`. El anterior, el 288 (`parches/campana-parche288.zip`, 12.664 bytes,
  sha256 `ad6c6bf1a07c7825e04484a4d54cec833787fd6dcf1a9858e6bc34f4544961fa`, 2 archivos: `routes/dashboard.routes.js` y `.version-base`).
  **Publicado** (`parche-288.zip`, misma huella) y **registrado y firmado (Ed25519), INACTIVO**, `toca_base_datos = false`; nombre en el panel:
  «Panel general por alcance (Requiere el 287)» (detalle abajo); **requiere el 287**. No cambia el service worker (sigue `v162`).
  El anterior, el 287 (`parches/campana-parche287.zip`, 138.322 bytes,
  sha256 `1af4844083ce9152529bfd336ff820e4b7022f6aff97da792ba8119b9bbafbad`, 9 archivos).
  **Publicado** en la carpeta de licencias (`parche-287.zip`, misma huella) y
  **registrado y firmado (Ed25519), INACTIVO**, con **`toca_base_datos = false`**; nombre en el panel:
  «Comunas validadas y dashboard por zona (Requiere el 286)» (detalle abajo); **requiere el 286**.
  El anterior, el 286 (`parches/campana-parche286.zip`, 244.821 bytes,
  sha256 `edac98f0d40f3229aa4370deb1fb9a90f1e0d40435f3cffd27adba8bffda54c2`, 21 archivos, transporte parte 2,
  `toca_base_datos = true`, requiere el 285), sigue publicado e inactivo, igual que el 285 (`parches/campana-parche285.zip`, 101.622 bytes,
  sha256 `767fd7efbe66bb93d38e0fd8286b02ab3d96c992bd240f536be741c2a841cc93`, 5 archivos, menú de Día D,
  `toca_base_datos = false`, requiere el 284), sigue publicado e inactivo, igual que el 284 (`parches/campana-parche284.zip`, 282.785 bytes,
  sha256 `00eacb9230ab661b1a9ffac49cd51b70151df4af91939ca70fc6104ab73c6333`, 28 archivos, transporte parte 1,
  `toca_base_datos = true`, requiere el 283), sigue publicado e inactivo, igual que el 283 (`parches/campana-parche283.zip`, 110.782 bytes,
  sha256 `60fecc764fba702e864f7dac158075c9e980ba185eebdd8a70a81e4dcd398f52`, 6 archivos, privacidad al buscar
  cédula y SMS al reinscribirse, `toca_base_datos = true`, requiere el 282), sigue publicado e inactivo, igual que el 282 (`parches/campana-parche282.zip`, 79.606 bytes,
  sha256 `cfe2292831b80eb8246134fd7f1a478fc646b1bc91ebc73b5cb738a50ccca32c`, 9 archivos, cédulas sin duplicados,
  `toca_base_datos = false`, requiere el 281), sigue publicado e inactivo, igual que el 281 (`parches/campana-parche281.zip`, 152.925 bytes,
  sha256 `bb30c0ffcb0fd1327790009cd780b09a1fcb2373d900ef7e6d2d7ed7f22a7298`, 10 archivos, mensaje de invitación con
  eslogan, `toca_base_datos = true`, requiere el 280), sigue publicado e inactivo, igual que el 280 (`parches/campana-parche280.zip`, 119.765 bytes,
  sha256 `dd45aec9f83de9ec25e8d633657cf7106337fd372cec712f4516806ef9faa40a`, 9 archivos, botón a la Registraduría y
  control de cédulas, `toca_base_datos = true`, requiere el 279), sigue publicado e inactivo, igual que el 279
  (`parches/campana-parche279.zip`, 22.390 bytes, sha256 `27ceca3c28a0a081866e18a50e50ddd0845c2b8f45610121e50f1e329ec1e0ee`,
  3 archivos, formulario por secciones y GPS, `toca_base_datos = false`, requiere el 278), sigue publicado e inactivo, igual que el 278 (`parches/campana-parche278.zip`, 18.199 bytes,
  sha256 `673b60c0f58bec76b55b688a9555c23f2194bb496dc407e425183e66ad6ee02b`, 3 archivos, datos de contacto completos,
  `toca_base_datos = false`, requiere el 277), sigue publicado e inactivo, igual que el 277 (`parches/campana-parche277.zip`,
  278.601 bytes, sha256 `c1804c429d701fbcb03890b892a089e0cb41be5d945a71563fbbe10178700fc4`, 22 archivos, inscripción
  por enlace/QR del líder, `toca_base_datos = true`, requiere el 276), sigue publicado e inactivo, igual que el 276 (551.144 bytes,
  `28471a84304ebc590121351690020621f2adb288a9b0783a2b9f5b1e1d46a40c`, 36 archivos, Día D fase 4, requiere
  el 275), sigue publicado e inactivo, igual que los anteriores —275 (33.002 bytes, `da76d397…`, 5 archivos, tarjeta «Ya voté»), 274 (456.956 bytes,
  `3c69dddb…`, 30), 273 (`11b498b6…`, 22) y 272 (`f4333fcb…`, 11)— siguen publicados e inactivos; los zip
  265 a 271 también están publicados.
  **Distribución del 289 (y del 288, 287, 286, 285, 284, 283, 282, 281, 280, 279, 278, 277, 276, 275, 274, 273 y 272): NO MEDIDA, y la fija Gildardo en el panel ANTES de
  activar.** `registrar-parche.js` no manda `modo_distribucion` y la columna nace en «todos» (pendiente 9 de
  abajo): hay que ponerlo en «seleccionadas» y marcar solo las campañas elegidas —**las mismas en los
  siete**—, nunca la Base. El sistema no declara dependencias entre parches (ver «Cómo exige el 273», en el 274).
- **Registrado / activo / aplicado en las campañas: NO MEDIDO.** Hay que mirar
  `.version-parche` y `logs/actualizaciones.log` de municipal, departamental y c001-2027
  (bloque d) del traspaso, abajo). En la Base, `.version-parche` y `.version-base` = **273**
  (la Base no recibe parches: los genera); desde el 289, `.version-parche` y `.version-base` = **289**. Ni el 272, ni el 273, ni el 274, ni el 275, ni el 276, ni el 277, ni el 278, ni el 279, ni el 280, ni el 281, ni el 282, ni el 283 ni el 284 se han activado ni aplicado a ninguna campaña.
- **Service worker:** `estrategia-v169` en el código de la Base y dentro del 296; `v168` dentro del 295; `v167` dentro del 294; `v166` dentro del 293; `v165` dentro del 291 y del 292; `v164` dentro del 290; `v163` dentro del 289 (el 288 no lo toca; el 287 lleva `v162`; el 286 lleva `v161`; el 285 lleva `v159`; el 284 lleva `v158`; el 281 lleva `v157`; el 282 y el 283 no lo tocan; el 280 lleva `v156`; el 278 y el 279 no lo tocan; el 277 lleva `v155`; el 276 lleva `v154`; el 275 lleva `v151`; el 274, `v150`; el 273 lleva `v147`;
  el 272, `v146`; el 271, `v145`). Cada campaña lo tendrá cuando reciba el 273. Las páginas nuevas
  `app/faltantes.html` y `app/ranking-dia-d.html` van en su precache.
- **La Base corre el código del 271.** Su proceso (`app.js`, pid 2883929) arrancó a las
  19:18:41, después de la última edición de código de ejecución (19:07:07). Su `.env` tiene
  `TELEGRAM_BOT_TOKEN` y `TELEGRAM_SUPERADMIN_CHAT_ID` con valor (solo se comprobó que no
  estén vacías) y **no** tiene `APP_NOMBRE`: el mensaje dice «Estrategia | App electoral». El
  registro de PM2 muestra **un** «Telegram OK» y ningún «Telegram falló».
- **Plantilla vigente: v308** (9 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v308.zip`,
  6.828.456 bytes, sha256 `1a4a18134abaef9a09f814539983829f8dd5f264d56742b508bd4f1ee41502d1`, service worker `estrategia-v178`, `.version-base` y `.version-parche` = 308.
  Generada con `node scripts/generar-plantilla.js --parche 308`; escaneo de secretos sin hallazgos. Probada de DOS maneras: (1) extraída aparte, `init-db.js` sobre una base vacía, dos veces: **79 tablas** las dos veces, 2 versiones de política archivadas, y los módulos `encuestas` y `encuestas_campo` solo para el administrador; (2) **la migración sobre una base ya creada con la plantilla del 307** (78 tablas, con una encuesta «centinela» dentro): pasa a 79, la encuesta se conserva, la política gana su segunda versión y una segunda corrida no cambia nada;
  `probar-encuestas.js` (203), `probar-encuestas-resultados.js` (120) y `probar-encuestas-celular.js` (92, en Chromium) desde la plantilla, todo bien.
- **Plantilla v307 (reemplazada por la v308)** (9 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v307.zip`,
  6.784.435 bytes, sha256 `be2d4bdc73bd053437f723727f2a2cc78212571872244c618f3f4c3dff1adcb6`, service worker `estrategia-v177`, `.version-base` y `.version-parche` = 307.
  Generada con `node scripts/generar-plantilla.js --parche 307`; escaneo de secretos sin hallazgos. Probada de DOS maneras: (1) extraída aparte, `init-db.js` sobre una base vacía, dos veces: **78 tablas** las dos veces, y los módulos `encuestas` y `encuestas_campo` solo para el administrador; (2) **la migración sobre una base ya creada con la plantilla del 306** (74 tablas, con una categoría de solicitud «centinela» dentro): pasa a 78, la categoría se conserva y una segunda corrida no cambia nada;
  `probar-encuestas.js` (202 comprobaciones) y `probar-encuestas-celular.js` (68, en Chromium) desde la plantilla, todo bien.
- **Plantilla v306 (reemplazada por la v307)** (8 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v306.zip`,
  6.712.883 bytes, sha256 `bf8811e9f9e67c1797292123f2a43704459bb71b8fa70989339070fe338b978e`, service worker `estrategia-v176`, `.version-base` y `.version-parche` = 306.
  Generada con `node scripts/generar-plantilla.js --parche 306`; escaneo de secretos sin hallazgos. Probada de DOS maneras: (1) extraída aparte, `init-db.js` sobre una base vacía, dos veces; (2) **la migración sobre una base ya creada con la plantilla del 305** (con una tarea vieja dentro): el ENUM se amplía, las 6 columnas aparecen, la tarea se conserva, y una segunda corrida no cambia nada;
  `probar-tareas.js`, `probar-tareas-metas.js` y `probar-recordatorios.js` desde la plantilla, todo bien.
- **Plantilla v305 (reemplazada por la v306)** (8 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v305.zip`,
  6.673.549 bytes, sha256 `83cab84f1e5688338547480926c90697cf72c65b561dd93168d758d025236e82`, service worker `estrategia-v175`, `.version-base` y `.version-parche` = 305.
  Generada con `node scripts/generar-plantilla.js --parche 305`; escaneo de secretos sin hallazgos. Probada: extraída aparte, `init-db.js` sobre una base vacía (mysqld privado), dos veces,
  deja **74 tablas**, **10 reglas de recordatorio de fábrica, todas apagadas** (5 de evento, 2 del Día D, 1 de solicitudes y 2 de tareas por vencer) y el módulo `tareas` solo para el administrador;
  `probar-tareas.js`, `probar-eventos-alcance.js` y `probar-recordatorios.js` desde la plantilla, todo bien.
- **Plantilla v304 (reemplazada por la v305)** (8 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v304.zip`,
  6.599.570 bytes, sha256 `fd61a274f1b9645cb623363d83fc8cba3ddf5d7fa09d04d0a28536386dce8040`, service worker `estrategia-v174`, `.version-base` y `.version-parche` = 304.
  Generada con `node scripts/generar-plantilla.js --parche 304`; escaneo de secretos sin hallazgos. Probada: extraída aparte, `init-db.js` sobre una base vacía (mysqld privado), dos veces,
  deja **71 tablas**, 9 categorías, **8 reglas de recordatorio de fábrica (la nueva, `solicitud_sin_movimiento`, apagada)**, `solicitud_dias_sin_movimiento = 15`, el módulo `solicitudes` solo para el administrador (con la casilla Importar / Exportar) y una sola versión de política archivada;
  `probar-solicitudes-seguimiento.js` y `probar-recordatorios.js` desde la plantilla, todo bien.
- **Plantilla v303 (reemplazada por la v304)** (8 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v303.zip`,
  6.559.658 bytes, sha256 `4768f7da6c65a9ee50506cabfc6b0b7e016cab278c7886d8b3fa243e1cae742a`, service worker `estrategia-v173`, `.version-base` y `.version-parche` = 303.
  Generada con `node scripts/generar-plantilla.js --parche 303`; escaneo de secretos sin hallazgos. Probada: extraída aparte, `init-db.js` sobre una base vacía (mysqld privado), dos veces,
  deja **71 tablas**, 9 categorías, el módulo `solicitudes` solo para el administrador y una sola versión de política archivada; `scripts/probar-solicitudes.js` desde la plantilla, todo bien.
- **Plantilla v302 (reemplazada por la v303)** (8 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v302.zip`,
  6.498.551 bytes, sha256 `4cfecb117023cfff8ba0228edf895c50f4d35ab85fb1d99ea4e9dc1ab003645e`, service worker `estrategia-v172`, `.version-base` y `.version-parche` = 302.
  Generada con `node scripts/generar-plantilla.js --parche 302`; escaneo de secretos sin hallazgos. Probada: extraída aparte, `init-db.js` sobre una base vacía (mysqld privado)
  deja **67 tablas** y las reglas de evento con la plantilla nueva, igual en una segunda corrida; la migración respeta una regla editada; `scripts/probar-recordatorios.js` desde la plantilla, todo bien.
  (El 302 quedó registrado INACTIVO con ese número.)
- **Plantilla v301 (reemplazada por la v302)** (8 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v301.zip`,
  6.493.944 bytes, sha256 `2ef0d29bf215d16ca5c9b938a2a67f408d7c0a9e4ce9136f8456606a4f139c8f`, service worker `estrategia-v172`, `.version-base` y `.version-parche` = 301.
  Generada con `node scripts/generar-plantilla.js --parche 301`; escaneo de secretos sin hallazgos. Probada: extraída aparte, `init-db.js` sobre una base vacía (mysqld privado)
  deja **67 tablas** y **7 reglas de fábrica apagadas** y el módulo `recordatorios` solo para el administrador, igual en una segunda corrida; `lib/manuales.js` da 163 bloques sin avisos; `scripts/probar-recordatorios.js` desde la plantilla, todo bien.
  (El 301 ya está publicado.)
- **Plantilla v300 (reemplazada por la v301)** (8 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v300.zip`,
  6.459.990 bytes, sha256 `f0c238761f6c184e5c3d147b0ace51442a3d0019e65d10e9dc1777845e34b60f`, service worker `estrategia-v171`, `.version-base` y `.version-parche` = 300.
  Generada con `node scripts/generar-plantilla.js --parche 300`; escaneo de secretos sin hallazgos. Probada: extraída aparte, `init-db.js` sobre una base vacía (mysqld privado)
  deja **67 tablas** (las 64 de antes + `recordatorio_reglas`, `recordatorio_envios`, `recordatorio_tope_diario`) y una segunda corrida deja lo mismo; `scripts/probar-recordatorios.js` desde la plantilla, todo bien.
  (El 300 ya está publicado.)
- **Plantilla v299 (reemplazada por la v300)** (8 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v299.zip`,
  6.431.108 bytes, sha256 `e958e35f63966021f4d7eff41a094269125c0eda33f125aaf01aa77a1bbb5e77`, service worker `estrategia-v171`, `.version-base` y `.version-parche` = 299.
  Generada con `node scripts/generar-plantilla.js --parche 299`; escaneo de secretos sin hallazgos. Probada: extraída aparte, `init-db.js` sobre una base vacía (mysqld privado)
  deja **64 tablas** y una segunda corrida deja lo mismo; `lib/manuales.js` da 161 bloques y 15 de instalación sin avisos; 79 imágenes; `scripts/probar-manuales.js` desde la plantilla, todo bien.
  (El 299 ya está publicado.)
- **Plantilla v298 (reemplazada por la v299)** (8 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v298.zip`,
  6.143.044 bytes, **558 entradas** (con las 76 capturas, `scripts/capturar-manuales.js` y `scripts/capturas/`), sha256 `044aa8eb63b0fc5188d6255019db273b68ed77101f696b57c0a25a105eea9053`,
  service worker `estrategia-v171`, `.version-parche` y `.version-base` = 298. Generada con `node scripts/generar-plantilla.js --parche 298`; escaneo de secretos sin hallazgos;
  sin `.env`, `.licencia-cache.json`, `.credenciales-*`, `node_modules`, `backups/` ni `parches/`.
  Probada: extraída aparte, `init-db.js` sobre una base vacía (mysqld privado) deja **64 tablas** y una segunda corrida deja lo mismo; `lib/manuales.js` da 161 bloques, 15 de instalación, **cero avisos** y 68 guías con captura; `scripts/probar-manuales.js` desde la plantilla, todo bien; `verificar-html.py` en `ayuda.html`.
  (El 298 ya está publicado.)
- **Plantilla v297 (reemplazada por la v298)** (8 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v297.zip`,
  2.225.398 bytes, **474 entradas** (las mismas que la v296), sha256 `78e356bee07a6dd2a88d2834b5c14c4c91dd2adcca2945e3c66020d7bf4cff09`,
  service worker `estrategia-v170`, `.version-parche` y `.version-base` = 297. Generada con `node scripts/generar-plantilla.js --parche 297`; escaneo de secretos sin hallazgos;
  sin `.env`, `.licencia-cache.json`, `.credenciales-*`, `node_modules`, `backups/` ni `parches/` (la única `.pem` es la pública de los parches).
  Probada: extraída aparte, `init-db.js` sobre una base vacía (mysqld privado) deja **64 tablas** y una segunda corrida deja lo mismo; `lib/manuales.js` da 161 bloques y 15 de instalación; `scripts/probar-manuales.js` desde la plantilla, todo bien; `verificar-html.py` en `ayuda.html`.
  **OJO: la plantilla dice 297 aunque el 297 aún no está publicado.** Una campaña nacida de ella no recibirá el 297 por el panel (ya lo trae); si finalmente se publica con otro número, hay que regenerarla.
  **La v296 y las anteriores siguen en la carpeta pero ya no sirven** para una campaña nueva. Si después se publica otro parche, hay que regenerarla (`--parche N`, y `--forzar` si el nombre ya existe).
- **Plantilla v296 (reemplazada por la v297)** (8 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v296.zip`,
  2.222.304 bytes, **448 archivos** (474 entradas con las carpetas), sha256 `dd408606fc7a262a5731191d3742d62ec7ca9234f01ef8fb229910c8fbcd045e`,
  service worker `estrategia-v169`, `.version-parche` y `.version-base` = 296. Generada con
  `node scripts/generar-plantilla.js --parche 296`; escaneo de secretos del generador sin hallazgos. Revisión aparte sobre el zip: sin `.env`
  (sólo `.env.example`, con los secretos vacíos), `.licencia-cache.json`, `.credenciales-*`, `node_modules`, `backups/` (ahí quedan los PDF y las capturas de verificación) ni `parches/`; la única `.pem` es la pública de los parches.
  El patrón de asignación de secretos coincide sólo en marcadores de ejemplo (`config/mailer.js` y los ocho `scripts/probar-*.js`, con su `SESSION_SECRET` de reserva).
  Trae 5 archivos más que la v295 (`lib/panelLider.js`, `routes/panelLider.routes.js`, `public/app/panel-lider.js`, `public/app/panel-lider.css` y `scripts/probar-panel-lider.js`); los demás del parche 296 cambian por dentro.
  Probada: extraída en una carpeta aparte, `init-db.js` sobre una base vacía (mysqld privado) deja **64 tablas** y una segunda corrida deja lo mismo; `scripts/probar-panel-lider.js` corrido desde la plantilla da **87 comprobaciones, todo bien**; `scripts/probar-manuales.js`, todo bien (161 bloques, 0 avisos); `verificar-html.py` en `inicio.html` y `node --check` en `panel-lider.js`.
  **La v295 y las anteriores siguen en la carpeta pero ya no sirven** para una campaña nueva: usar la v296. Si después se publica otro parche, hay que regenerarla
  (`--parche N`, y `--forzar` si el nombre ya existe) antes de crear una campaña.
- **Plantilla v295 (reemplazada por la v296)** (8 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v295.zip`,
  2.198.203 bytes, **443 archivos** (469 entradas con las carpetas), sha256 `d7907fca5844f91e6fe62cbf62d38083f6c90021a5c4b790ccb124187dc3e151`,
  service worker `estrategia-v168`, `.version-parche` y `.version-base` = 295. Generada con
  `node scripts/generar-plantilla.js --parche 295`; escaneo de secretos del generador sin hallazgos. Revisión aparte sobre el zip: sin `.env`
  (sólo `.env.example`, con los secretos vacíos), `.licencia-cache.json`, `.credenciales-*`, `node_modules`, `backups/` (ahí quedaron los PDF y las capturas de la verificación) ni `parches/`; la única `.pem`
  es la pública de los parches. El patrón de asignación de secretos coincide sólo en marcadores de ejemplo (`config/mailer.js` y los siete `scripts/probar-*.js`, con su `SESSION_SECRET` de reserva); `ayuda.html` dejó de coincidir porque el manual de instalación ya no vive ahí.
  Trae 185 archivos más que la v294: los 177 de `manuales/` (161 bloques, 15 de instalación y `LEEME.md`), `lib/manuales.js`, `routes/manuales.routes.js`, `public/css/ayuda.css`, `public/js/ayuda.js`, `scripts/probar-manuales.js`, y los demás ya existentes cambian por dentro (los del parche 295).
  Probada: extraída en una carpeta aparte, `init-db.js` sobre una base vacía (mysqld privado) deja **64 tablas** y las 9 filas de `enviar_push` en `permisos_rol` (permitido para admin, asistente administrativo, coordinador y líder); una segunda corrida deja lo mismo;
  `lib/manuales.js` cargado desde la plantilla da 161 bloques, 15 de instalación y **cero avisos**; y `scripts/probar-manuales.js` corrido desde la plantilla sobre esa base da **150 comprobaciones, todo bien**; `verificar-html.py` en `ayuda.html` e `inicio.html`.
  **La v294 y las anteriores siguen en la carpeta pero ya no sirven** para una campaña nueva: usar la v295. Si después se publica otro parche, hay que regenerarla
  (`--parche N`, y `--forzar` si el nombre ya existe) antes de crear una campaña.
- **Plantilla v294 (reemplazada por la v295)** (8 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v294.zip`,
  2.012.567 bytes, **261 archivos** (284 entradas con las carpetas), sha256 `5b039a473a37814a44cff54d2ba3161cb994ae8e4b381c88561882b12a617528`,
  service worker `estrategia-v167`, `.version-parche` y `.version-base` = 294. Generada con
  `node scripts/generar-plantilla.js --parche 294`; escaneo de secretos del generador sin hallazgos. Revisión aparte sobre el zip: sin `.env`
  (sólo `.env.example`, con los secretos vacíos), `.licencia-cache.json`, `.credenciales-*`, `node_modules`, `backups/` ni `parches/`; la única `.pem`
  es la pública de los parches. El patrón de asignación de secretos coincide en los mismos ocho archivos de siempre, todos marcadores de ejemplo.
  Mismos 261 archivos que la v293; cambian por dentro los 16 del parche 294 (las 14 pantallas con `tabla-alineada`, `public/service-worker.js` y las dos versiones).
  Probada: extraída en una carpeta aparte, `init-db.js` sobre una base vacía (mysqld privado) deja **64 tablas**, con los tres ítems de fábrica de logística y `logistica_dia_d`
  sembrado para admin y coordinador; una segunda corrida deja 3 ítems y 64 tablas; `verificar-html.py` en seis de las páginas tocadas y `node --check` en `common.js` y `transporte-dia-d.js`.
  **La v293 y las anteriores siguen en la carpeta pero ya no sirven** para una campaña nueva: usar la v294. Si después se publica otro parche, hay que regenerarla
  (`--parche N`, y `--forzar` si el nombre ya existe) antes de crear una campaña.
- **Plantilla v293 (reemplazada por la v294)** (8 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v293.zip`,
  2.012.338 bytes, **261 archivos** (284 entradas con las carpetas), sha256 `a4a112fea478b9a64d2c96333489e7f16bcf820f39cd8e741191d7cc38b87dc7`,
  service worker `estrategia-v166`, `.version-parche` y `.version-base` = 293. Generada con
  `node scripts/generar-plantilla.js --parche 293`; escaneo de secretos del generador sin hallazgos. Revisión aparte sobre el zip: sin `.env`
  (sólo `.env.example`, con los secretos vacíos), `.licencia-cache.json`, `.credenciales-*`, `node_modules`, `backups/` ni `parches/`; la única `.pem`
  es la pública de los parches. El patrón de asignación de secretos coincide en los mismos ocho archivos de siempre, todos marcadores de ejemplo.
  Mismos 261 archivos que la v292; cambian por dentro los del parche 293 (`public/dia-d.html`, `public/js/transporte-dia-d.js`, `public/testigos.html`, `public/configuracion.html`,
  `public/css/style.css` con la regla `.tabla-alineada`, `public/service-worker.js` y las dos versiones).
  Probada: extraída en una carpeta aparte, `init-db.js` sobre una base vacía (mysqld privado) deja **64 tablas**, con los tres ítems de fábrica de logística y `logistica_dia_d`
  sembrado para admin y coordinador; una segunda corrida deja 3 ítems y 64 tablas; `verificar-html.py` en las tres páginas tocadas y `node --check` en `transporte-dia-d.js` y `common.js`.
  **La v292 y las anteriores siguen en la carpeta pero ya no sirven** para una campaña nueva: usar la v293. Si después se publica otro parche, hay que regenerarla
  (`--parche N`, y `--forzar` si el nombre ya existe) antes de crear una campaña.
- **Plantilla v292 (reemplazada por la v293)** (8 de noviembre de 2026): `backups/plantillas/plantilla-nueva-campana-v292.zip`,
  2.011.889 bytes, **261 archivos** (284 entradas con las carpetas), sha256 `37591043c93fe7d7b15ffb767458f2335ca33dcf0e1b60d9d8ec4af9f1c31a14`,
  service worker `estrategia-v165`, `.version-parche` y `.version-base` = 292. Generada con
  `node scripts/generar-plantilla.js --parche 292`; escaneo de secretos del generador sin hallazgos. Revisión aparte sobre el zip: sin `.env`
  (sólo `.env.example`, con los secretos vacíos), `.licencia-cache.json`, `.credenciales-*`, `node_modules`, `backups/` ni `parches/`; la única `.pem`
  es la pública de los parches (`BEGIN PUBLIC KEY`). El patrón de asignación de secretos coincide en los mismos ocho archivos de la v289 y la v290, todos marcadores de ejemplo
  (los `SESSION_SECRET` de reserva de los seis `scripts/probar-*.js`, `public/ayuda.html` con `DB_PASSWORD=tu_clave` y el comentario de `config/mailer.js`).
  Mismos 261 archivos que la v290; cambian por dentro los del parche 292: `public/js/common.js` y `public/css/style.css` (menú plegable en el celular), `public/js/logistica-dia-d.js`
  (tablas alineadas), `public/votantes-dashboard.html`, `public/service-worker.js` (v165), `.version-base` y `.version-parche`. Comprobado en el zip: la barra `menu-movil-barra` está en `common.js` y en `style.css`
  y ya no queda `class="num"` en la pestaña Logística.
  Probada: la plantilla extraída en una carpeta aparte, `init-db.js` sobre una base vacía (mysqld privado) deja **64 tablas**, con los tres ítems de fábrica de logística
  (Kit de testigo 07:00, Refrigerio 12:00, Almuerzo 14:00) y `logistica_dia_d` sembrado para admin y coordinador; una segunda corrida deja 3 ítems y 64 tablas;
  `verificar-html.py` da etiquetas balanceadas y JS válido en las seis páginas tocadas desde la v289 y `node --check` pasa en `common.js` y `logistica-dia-d.js`.
  **La v290, la v289, la v286, la v271 y las v261/v262 siguen en la carpeta pero ya no sirven** para una campaña nueva: usar la v292. Si después se publica otro parche,
  hay que regenerarla (`--parche N`, y `--forzar` si el nombre ya existe) antes de crear una campaña.
- **Ranking y Alertas del Día D, contenedor** (commit `d48db1d`, 8 de noviembre de 2026): `public/app/ranking-dia-d.html` y `public/app/alertas-dia-d.html`
  envolvían todo en `<div class="app-contenido">`, una clase que **no existe** en `estilos-app.css` (no faltaba en el HTML: faltaba el CSS), así que las
  tarjetas salían pegadas a los bordes. Pasan a `<main class="app-cuerpo">`, la de `dia-d.html`, `inicio.html` y `logistica.html`. Service worker `v164`; las
  pruebas que fijaban la versión (`probar-inscripcion-enlace`, `probar-transporte-diad`, `probar-logistica`) aceptan v164. **Mismo defecto sin tocar** en
  `app/faltantes.html` y `app/mis-registros.html`; se arreglaron después (commit `75076e3`) y viajan juntos en el parche 290.
- **`scripts/comparar-instancias.js`** (medido el 31 de agosto, NO re-medido): 137 archivos,
  1 sola diferencia en cada campaña — `scripts/calibrar_cohortes.js`, que existe solo allí;
  el sistema de parches no sabe borrar (`unzip -o`).
- **Rama:** `auditoria-fable`, publicada en GitHub (ver «Remoto» abajo). Árbol: `legislacion/`
  y dos guiones sin versionar (`scripts/respaldar-base-instalacion.sh`,
  `scripts/verificar-parche264.sh`; ya no viajan en plantillas, ver abajo). `CLAUDE.md`
  quedó commiteado (`0c2311a`, «notas de sesión»: el puerto de escucha, 4200 → 3005).

## c001: base y usuario renombrados (10 de noviembre de 2026, HECHO Y VERIFICADO; NO ES UN PARCHE)

- **Qué cambió:** base `c00-2027db` → **`c001-2027db`** y usuario MySQL `c00-2027user` → **`c001-2027user`** (host `%`). Sitio `c001-2027.appestrategia.net`, cuenta `appestrategia-c001-2027`, puerto 3201, PM2 `c001-2027`.
  Lo corrió el usuario como root, con la salida pegada en la sesión. Base y usuario nuevos con `clpctl db:add`; volcado de la vieja con `mysqldump --single-transaction --routines --triggers --events`; importación como root con el `DEFINER` reemplazado por `sed` (`c00-2027user` → `c001-2027user`); `.env` cambiado (sin imprimir la clave); `npm run init-db` como la cuenta de c001; `pm2 restart c001-2027`.
- **Verificado:** 84 tablas, 6 disparadores, 0 vistas/rutinas/eventos, misma colación (`utf8mb4_general_ci`); filas idénticas en 81 tablas y solo **más** en la nueva en `auditoria` (+2), `sessions` (+4) y `two_factor_codes` (+1), que son inicios de sesión posteriores al arranque (cero tablas con más filas en la vieja). Los 6 disparadores quedaron a nombre de `c001-2027user`. Procesos de MySQL: solo `c001-2027user` sobre `c001-2027db`. `init-db` sin el aviso «Catálogo no accesible». El usuario probó en el navegador (ingreso, Votantes, Territorial, Puestos de Día D, `/api/catalogo/salud` y un votante de prueba) y dijo «está bien».
- **GRANT de catálogo del usuario nuevo** (los mismos tres que tenía el viejo): `SELECT` sobre `territoriosdb`.`ctc_territorios`, `ctc_puestos_votacion` y `ctc_alias`. Nunca `territoriosdb.*`.
- **Borrado:** `clpctl db:delete --databaseName=c00-2027db` borró **también el usuario** `c00-2027user` (comprobado en `mysql.user`). No hizo falta tocar CloudPanel a mano.
- **Respaldos** (en `/root/respaldos-c001-renombrar/`, modo 600, con aviso «borrar después del 2026-12-10»; llevan datos personales de votantes): el original, el volcado final, el volcado con el `DEFINER` nuevo y una línea base con el nombre nuevo (84 tablas, cero `DEFINER` del usuario viejo). Copia del panel de la app descargada por el usuario a su PC (`backup-estrategia-2026-11-10.zip`).
- **A tener en cuenta:** las copias de `backups/` y del panel hechas **antes** del cambio traen ``DEFINER=`c00-2027user` `` y no se restauran limpias con el panel (`restaurarBaseDatos` no quita el `DEFINER` y `mysql` se detiene en el primer error). Para restaurar una, pasarla antes por ``sed 's/DEFINER=`c00-2027user`@`%`/DEFINER=`c001-2027user`@`%`/g'``.
- **Cosas que no se midieron:** el servidor de licencias (carpeta ilegible desde esta cuenta); el `grep` como root no encontró el nombre viejo allí. Lo que la instalación le envía (`clave_licencia`, `dominio`, `fingerprint`, `version_actual`) no incluye la base ni el usuario.
- **Se arrancó sola antes de tiempo:** en la sesión c001 salió `online` antes del `pm2 restart` que se pidió, estando detenida; no se supo por qué y no dejó huella en los conteos.
- **Cambios de código de esta sesión** (commiteados en `auditoria-fable`, sin push; **no van en ningún parche**; `scripts/` no viaja salvo que se empaquete): `scripts/reiniciar-instancia.sh` ahora elige el node **más nuevo que tenga pm2** (con la instancia caída tomaba v24.21.0 sin pm2 y moría con «No hay pm2 ejecutable»; probado con un árbol de nvm simulado) y arma el `PATH` sin dejar `$PATH` literal; `scripts/probar-instalacion-limpia.js` agrega `c001-2027db` y `c00-2027db` a `BASES_PROHIBIDAS`.

## Parche 316 — «Mis avisos»: tocar un aviso abre el mensaje completo (10 de noviembre de 2026, publicado y registrado INACTIVO; NO TOCA LA BASE)

**Publicado y registrado el 10 de noviembre de 2026** (lo corrió el usuario como root con `su - gariasappelectoral`; salida pegada): `parche-316.zip` en el servidor de licencias con huella igual a la local (`21d55b3b720b55ac`), registro **HTTP 200**, firmado (Ed25519), **`toca_base_datos = false`**, estado INACTIVO. Falta: distribución «seleccionadas» (municipal, departamental, c001; NUNCA la Base), activarlo y aplicarlo desde el panel (requiere el 315 aplicado; reiniciar las campañas, sin `init-db`).

**El síntoma** (orden 43, Manizales, con el 315 aplicado). El aviso ya llega al celular, pero el teléfono recorta el texto y, al tocarlo, la app abría Inicio: el mensaje completo no se podía leer. Además, un envío de las 7:23 p. m. quedó en «Enviando…» con 1 destinatario, 0 enviados, 0 fallidos y 1 omitido.

**Lo que había** (leído en el código). El push del CRM mandaba `{titulo, cuerpo, url}` sin `url` propia (caía en `/app/inicio.html`) y sin `tag` (todo bajo «estrategia-general»: un aviso REEMPLAZA al anterior en la bandeja). `notificationclick` del service worker ya enfocaba una ventana abierta y navegaba a `data.url`, o abría esa dirección: **no hizo falta tocarlo**. No existía ninguna pantalla con los avisos recibidos. Y el título que se escribía en la pantalla de envío NO se guardaba para push (`asunto` solo se guardaba en los canales de correo): siempre salía «Aviso de la campaña». Se corrigió de paso.

**Por qué quedó en «Enviando…» (causa probable; no medido en Manizales, esta cuenta no lee esa base).** Tres mecanismos, los tres corregidos:
1. `web-push` no tenía tiempo máximo: si el servicio de push no respondía, la petición se quedaba colgada, la fila en `enviando` y la campaña en «Enviando…» (el reconciliador no toca campañas que ESTE proceso cree estar enviando). Ahora `timeout` de 20 s: vence como un error cualquiera, la fila queda `fallida` con su motivo y la campaña se cierra.
2. El listado contaba una fila `enviando` como «omitida» (`estado NOT IN ('enviado','fallido','pendiente')`): por eso decía «1 omitido» sin que nadie hubiera omitido nada. Ahora `enviando` también queda fuera de esa cuenta.
3. Una campaña sin filas por enviar se cierra al terminar el ciclo (`cerrarCampanaSiTermino`), pero si ese cierre se perdía (reinicio entre crear las filas y cerrar) nadie volvía a mirarla: el reconciliador solo mira FILAS, no campañas. Nueva `cerrarCampanasSinFilasAbiertas`, en el ciclo de cada minuto, cierra las campañas `enviando` que no tienen filas abiertas y que este proceso no está enviando. Un envío con todos omitidos o sin contacto queda cerrado y el listado dice «No se envió».

**Qué cambió.**
- `public/app/mis-avisos.html` (nueva): bandeja del celular, los más nuevos arriba; cada aviso con título, fecha y vista previa; al tocarlo (o al llegar por la notificación, `?id=`) se abre el mensaje COMPLETO. Si el id no es de la persona o no existe: «Ese aviso no está disponible» (y su propia lista se ve normal).
- `routes/push.routes.js`: `GET /api/push/mis-avisos`, `/mis-avisos/contar?desde=` y `/mis-avisos/:id`. **Solo filas push `enviado` cuyo `destinatario_contacto` es el usuario de la SESIÓN** (filtro en la consulta, no un dato del navegador); otra persona recibe **404** —el mismo que un aviso que no existe—. Pide solo sesión (como el resto del archivo): un testigo o un sublíder tienen que poder leer lo que reciben. El texto se arma igual que al enviar (`textoDeAvisoRecibido`, exportada de `comunicaciones.routes.js`), porque el envío no guarda el texto ya personalizado.
- `routes/comunicaciones.routes.js` + `config/push.js`: el aviso del CRM lleva `url = /app/mis-avisos.html?id=<fila>` y `tag = aviso-<fila>`; título guardado para push; `omitidos` sin `enviando`; `cerrarCampanasSinFilasAbiertas`; `timeout` de 20 s. **Los otros llamadores de push no cambian**: las alertas del Día D siguen con `/app/alertas-dia-d.html`; recordatorios, tareas y solicitudes siguen abriendo Inicio.
- `public/app/inicio.html`: «Mis avisos» 🔔 en el menú del líder (el coordinador lo hereda) y del administrador, con una insignia «N» de nuevos.
- `public/service-worker.js`: `/app/mis-avisos.html` en la coraza; caché **`v186`**.

**Lo que NO se hizo, a propósito.** No hay «leído» en el servidor (pediría una columna: migración). La insignia cuenta los avisos de los últimos 7 días con id mayor que el último que se abrió **en ese celular** (`localStorage`): en otro dispositivo vuelve a contar. El **testigo** no ve Inicio (va directo a su pantalla del Día D), así que no tiene el acceso; sí le funciona la dirección de la notificación. El **aspirante con sublicencia** no alcanza `/api/push` (no está en `PERMITIDOS` de `middleware/aspirante.js`, ni lo estaba para suscribirse): no se amplió.

**Pruebas** (`scripts/probar-mis-avisos.js`, 40 comprobaciones; base desechable; `web-push` SIMULADO —captura carga y opciones—, service worker REAL cargado en un entorno de pruebas, Chromium real; corrida varias veces: «TODO BIEN»). Regresión en verde sobre la misma base: `probar-aviso-app-destinatario.js` (41), `probar-recordatorios.js` (246) y `probar-inscripcion-enlace.js` (467).

**Pendientes.** (1) **Publicar y registrar el 316** (distribución «seleccionadas» con municipal, departamental y c001; nunca la Base; requiere el 315 aplicado; sí reinicio de las campañas, no `init-db`). (2) La causa exacta del «Enviando…» de las 7:23 no se pudo medir; si vuelve a pasar, mirar `comunicaciones_envios` de esa campaña (¿una fila `enviando`?). (3) «Leído» en el servidor, si se quiere que el contador no dependa del celular.

## Parche 315 — «Aviso en la app» llega al número tecleado y dice por qué no llega (10 de noviembre de 2026, publicado y registrado INACTIVO; NO TOCA LA BASE)

**Publicado y registrado el 10 de noviembre de 2026** (lo corrió el usuario como root con `su - gariasappelectoral`; salida pegada): `parche-315.zip` en el servidor de licencias con huella igual a la local (`f476c7cee4a6eae8`), registro **HTTP 200**, firmado (Ed25519), **`toca_base_datos = false`**, estado INACTIVO. Falta: distribución «seleccionadas» (municipal, departamental, c001; NUNCA la Base), activarlo y aplicarlo desde el panel. No requiere `init-db`; sí reinicio de las campañas (la ruta de comunicaciones cambia en el servidor).

**El síntoma** (campaña de Manizales, 9 de noviembre, orden 41). Gildardo tecleó su propio celular en CRM y Mensajería → «Aviso en la app». El historial dijo «No se envió» (1 omitido); el detalle, «Estado: Enviado · 0 enviados» y, en la fila, «Sin dato de contacto» con el contacto en «–». Ese celular tenía los avisos activados.

**La causa (leída en el código y reproducida en la prueba; la base de Manizales no es legible desde esta cuenta, ver pendientes).** Un número tecleado se cruzaba con **Votantes primero** y esa ficha pisaba a la de estructura (`resolverManualesContraLaBase`). Un votante no tiene cuenta, así que el destinatario nacía **sin `usuario_id`**; el aviso va a la cuenta (`push_suscripciones.usuario_id`), no al teléfono; el contacto quedaba nulo y la fila `sin_contacto`, **con el motivo en blanco**. Además: (1) la comparación era de texto exacto («+57 310…» no iguala a «310…»); (2) solo se buscaba en usuarios que estuvieran en `estructura`, y un admin no tiene esa fila; (3) el detalle imprimía el estado del PROCESO (`enviado` aunque todos se omitan) y el listado el resultado real, así que decían cosas distintas del mismo envío. El cambio que lo destapó fue `36a09f7` (28 de agosto): desde entonces lo tecleado se cruza con la base y cae en la ficha de votante; antes quedaba manual puro y tampoco llegaba (el aviso del 22 de agosto salió, con toda probabilidad, elegido desde la lista).

**Qué cambió.**
- `lib/telefono.js` (nuevo): `ultimos10()` y `sqlUltimos10()` (los últimos 10 dígitos; quita espacios, guiones, `+57` y `57` pegado). Para comparar, no para validar.
- `routes/comunicaciones.routes.js`: **`resolverManualesPush`**, solo para canal push y solo para lo TECLEADO. Busca en `votantes` y en `usuarios` activos **directamente** (con o sin fila en estructura), por los últimos 10 dígitos en los dos lados. Si la misma persona es votante y usuario, conserva **nombre e id del votante** y le agrega el `usuario_id` (si cualquiera de las dos fichas pidió la baja, se respeta). Si el número está en **varias cuentas** no se adivina. SMS y correo no se tocaron (la prueba lo comprueba).
  Motivos en `error_mensaje` (columna que ya existía; sin migración): **«No tiene cuenta en la aplicación. Los votantes no reciben avisos: use Enviar SMS.»**, **«Tiene cuenta pero no ha activado los avisos en su celular (Inicio → Avisos).»**, **«Ese número está en varias cuentas…»** y, añadido por mí, **«Lo escrito no es un celular de 10 dígitos…»** (la orden no lo pedía; sin él quedaba un caso con motivo vacío). El bloque de push de `obtenerDestinatarios` pone los dos primeros también a lo elegido de la lista y a los grupos.
  `POST /campanas` responde además `con_envio` y `sin_contacto`; `/destinatarios/preview` responde, **solo en push**, `sinAvisos` y `sinAvisosDetalle` (hasta 15 con su motivo).
- `public/enviar-push.html`: `sin_contacto` se rotula **«Sin avisos activados»** en esta pantalla; antes de enviar, el `confirm` lista quién NO lo recibirá y por qué; si nadie puede recibirlo sale un mensaje **ROJO** («El aviso NO se envió…») en vez del verde «Enviando a 1 persona(s)»; el detalle dice **«Resultado: …»** con la misma función que el listado (`resultadoEnvio`), no «Estado: Enviado» con 0 enviados.
- `service-worker.js`: caché **`v185`**.

**Lo que NO cambió, a propósito.** Quién aparece en el buscador de la lista de selección (el admin sin estructura sigue sin aparecer: la orden pidió cambiar solo lo tecleado). Permisos: nadie recibe nada que no estuviera ya escrito.

**Una cuenta sin fila en estructura** (un admin) se guarda con `destinatario_tipo = 'manual'` y `destinatario_id = NULL` (el enum no tiene valor para «cuenta»), pero con su nombre. No se ve el cargo; sí el nombre. Y la baja de esa cuenta se mira al armar la lista, no de nuevo al enviar (como cualquier manual).

**Pruebas** (`scripts/probar-aviso-app-destinatario.js`, 41 comprobaciones; base desechable, push SIMULADO —anota a qué cuenta iba y no sale a ningún proveedor—, Chromium real; repetible, corrida dos veces: «TODO BIEN» las dos). Con la ruta del commit anterior la misma prueba **reproduce el defecto** (admin tecleándose en los tres formatos → `sin_contacto`, motivo `NULL`; 24 de 41 fallan). También pasan sin cambios `probar-inscripcion-enlace.js` (467) y `probar-recordatorios.js` (246).

**Pendientes.** (1) **Publicar y registrar el 315** (ver el comando en el informe; distribución «seleccionadas» con municipal, departamental y c001, nunca la Base). (2) **No medido en Manizales**: esta cuenta no lee esa base; las consultas para confirmar que Gildardo es votante 228 y usuario con el mismo teléfono están en el informe de la orden 41. (3) Si un admin sin estructura debe poder **elegirse en la lista** (no solo teclearse), hay que decidirlo: hoy no.

## Parche 314 — Fondo de mapa común (9 de noviembre de 2026, GENERADO; NO TOCA LA BASE)

**El síntoma.** En Solicitudes ciudadanas (y en Tareas) el fondo del mapa salía lleno de cuadros amarillos «Access blocked — App is not following the tile usage policy of OpenStreetMap's volunteer-run servers» (403). Los controles y el círculo de la zona sí aparecían: lo roto eran las teselas.

**La causa (medida, no supuesta).** Las dos pantallas pedían SIEMPRE `tile.openstreetmap.org`, sin mirar si había token de Mapbox, y no tenían `<meta name="referrer">`. A `/`, a `/solicitudes.html` y a todo lo estático le llegan **dos** `Referrer-Policy`: la de helmet (`strict-origin-when-cross-origin`, `app.js:88`) y una **`same-origin` que no sale del código Node** (`curl -sI https://electoral.appestrategia.net/` la muestra; `/api/*` trae solo una). El navegador junta las dos y se queda con la última: `same-origin` = ningún Referer hacia otro dominio. OSM exige Referer y responde 403. helmet NO era el culpable. Las demás pantallas con mapa se salvaban porque llevan su `<meta name="referrer">` (que gana a la cabecera).

**Qué cambió.**
- `public/js/mapa-fondo.js` (nuevo): `obtenerTokenMapa({rol})` (token público o `null` ante cualquier fallo, sin avisos), `fondosMapa(token)` (los tres fondos de siempre: OpenStreetMap, Mapbox Calles, Mapbox Satélite) y `fondoMapa(mapa,{token,estilo})`. Cada capa lleva `referrerPolicy: 'origin'` (solo el dominio, nunca la ruta), así que el fondo **ya no depende de lo que mande nginx**. Sin token, o si Mapbox no entrega ninguna tesela (4 errores seguidos, o Leaflet avisa con `load` que terminó sin una sola cargada), cae a OSM. No escribe nada en la consola; el token no entra en la atribución.
- `solicitudes.html` y `tareas.html`: `<meta name="referrer" content="strict-origin-when-cross-origin">` y `fondoMapa(...)`. **Ahora usan Mapbox si la campaña tiene token** (antes eran solo OSM).
- `mapa.html`, `dashboard.html`, `admin-mapa.html`: su bloque de `L.tileLayer` pasó a `fondosMapa(token)`, con el selector de fondos como estaba. Diferencias mínimas: el Dashboard ahora trae la atribución con enlaces y `maxZoom` 22 en Mapbox (antes 19 y sin enlaces).
- `service-worker.js`: `/js/mapa-fondo.js` en la coraza; caché **`v184`**.
- NO se tocó `puerta-a-puerta.html` ni `transporte-conductor.js` (ya mandaban Referer), ni helmet, ni nginx.

**Roles y token.** La ruta `/api/territorial/mapbox-token` sigue **solo para admin, coordinador y aspirante** (no se amplió). Solicitudes y Tareas las ve quien tenga «Ver» en la matriz (de fábrica el menú las ofrece a admin, coordinador y líder; el módulo viene apagado): **el líder (y el sublíder) NO puede leer el token → cae a OpenStreetMap, ahora con Referer.** `obtenerTokenMapa({rol})` ni siquiera pregunta si el rol no está en esa lista, para no dejar un 403 en la red; el servidor sigue siendo quien decide.

**Un defecto que la prueba destapó y se corrigió antes de empaquetar.** La primera versión abandonaba Mapbox tras 4 `tileerror`; el mapa del Dashboard y el del celular muestran 2 o 3 teselas y nunca llegaban a 4. Ahora también se mira el evento `load`. Y el cambio de capa se pospone un instante (`setTimeout 0`): hecho dentro del propio evento, Leaflet lanzaba `Cannot read properties of null (reading '_fadeAnimated')`.

### Pruebas (Chromium real, base simulada, `scripts/probar-mapa-fondo.js`: TODO BIEN)
- **Control negativo:** la pantalla de Solicitudes del commit anterior, con las dos cabeceras, pide las teselas de OSM **sin Referer**. (OSM respondió 200 desde este servidor a esa petición sin Referer: **el 403 no se reprodujo aquí**, solo la causa —el Referer ausente—. El bloqueo de OSM depende de su lado y de la IP.)
- Solicitudes y Tareas, administrador y líder, sin token y con un token que Mapbox rechaza: teselas de OSM 200, todas con Referer = el dominio solo; con token falso Mapbox falla (`net::ERR_BLOCKED_BY_ORB`) y cae a OSM; el líder no pide el token (ningún 403 en la red).
- Mapa territorial, Dashboard y Admin móvil: igual que antes (selector de fondos intacto), sin excepciones.
- `obtenerTokenMapa()` ante 403, sin red y con rol sin acceso: `null`, sin lanzar.
- Las dos pruebas que fijaban `estrategia-v183` (`probar-puerta-a-puerta.js`, `probar-eventos-asistencia.js`) ahora aceptan cualquier versión; ambas pasan.
- `scripts/capturas/navegador.js` ahora también guarda `respuestas` (URL y código) y `detalle` (URL y Referer) de cada petición.

### Pendientes
- **nginx (root):** la cabecera `Referrer-Policy: same-origin` duplicada sigue ahí. No se tocó. Para ubicarla (como root, en el servidor): `grep -rn -i "referrer" /etc/nginx/ /home/clp 2>/dev/null`. En CloudPanel suele estar en el vhost de cada sitio (Vhost editor). Quitarla deja una sola cabecera (la de helmet) y los enlaces externos mandan el origen, no la ruta. Con este parche los mapas ya no dependen de ello.
- **Token por campaña:** cuántas campañas tienen `MAPBOX_ACCESS_TOKEN` en su `.env` no se pudo medir desde esta cuenta (solo se lee la de la Base: tiene token).
- Puerta a puerta y Transporte siguen con su capa de OSM propia (funcionan); pueden pasar a `fondoMapa` cuando se quiera unificar.

## Parche 313 — Eventos en el celular y marcar asistencia (9 de noviembre de 2026, PUBLICADO Y REGISTRADO, INACTIVO, TOCA LA BASE)

**Requiere el 312.** Service worker `v183`. **`OFFLINE_DB_VERSION = 11`.** **Toca la base:** `evento_asistentes.asistio_ms BIGINT UNSIGNED NULL` (instante en ms de la última marca) y `asistio_por INT NULL`; repetible. **Hay que correr `init-db` y reiniciar** (rutas y lib nuevas).

**Contexto (investigado antes, solo lectura):** `/app/inicio.html` NUNCA tuvo un acceso a Eventos o Agenda (la búsqueda `git log -S` solo halla el commit `48f0429`, que puso «eventos» en un texto del menú del administrador); el 305 no quitó nada: solo cerró la API (`lib/alcanceEventos.js`). Y la API aceptaba `asistio` desde siempre pero **ninguna pantalla la llamaba**: el contador «asistieron» solo valía lo que alguien escribiera en la base.

### Servidor (`lib/asistenciaEventos.js`, `routes/eventos.routes.js`)
- **`PUT /api/eventos/asistentes/:id`** ahora acepta `asistio` y/o `confirmado` y **solo cambia lo que llega** (antes escribía las DOS columnas siempre: mandar solo `asistio` habría borrado la confirmación). Admite `marcado_en` opcional.
- **`POST /api/eventos/asistencias`** `{ cliente_uuid, asistente_id, asistio, marcado_en }`: la misma regla, en POST porque la cola de `offline-utils.js` sube con POST. **Idempotente y en orden:** la marca es un ESTADO con el instante de su captura; una marca más vieja que la guardada se IGNORA (`ignorada: true`), así lo marcado sin señal el martes no pisa lo del miércoles, y subir dos veces lo mismo no cuenta doble. Se acepta hasta 7 días de antigüedad (422 después), nada en el futuro (400). Auditoría `evento_asistencia` (solo si algo cambió).
- **Quién marca:** administrador, coordinador y líder en los eventos que **gestionan** (`alcanceEventos(…, soloGestion)`); **sublíder** solo `asistio`, y solo en eventos donde es el **responsable** o está **invitado** (si manda `confirmado`, 403). No agrega ni quita asistentes, ni edita ni borra el evento. Testigo, invitado y demás: 403. Un líder que solo está invitado a un evento ve la lista y NO marca.
- **`GET /api/eventos/movil`:** los eventos de hoy, próximos y de los últimos 7 días (hasta 60) dentro del **mismo alcance** que `GET /`, con `puede_marcar` / `puede_agregar` y los invitados reducidos a `{ id, nombre, barrio, asistio }`. **Nunca teléfono ni cédula, ni al administrador ni al responsable** (la copia que queda en el teléfono no debe llevarlos). Pide «Ver» en `eventos`, `agenda` o `asistentes_reuniones` (la puerta de siempre).
- **`POST /api/eventos/:id/asistentes-por-cedula`** (administrador, coordinador, líder; solo eventos que gestionan; límite de 60 búsquedas por 10 minutos como el resto): resuelve la cédula **solo entre los votantes de su alcance**; una cédula ajena responde EXACTAMENTE lo mismo que una que no existe; si ya está en el evento devuelve la misma fila. Responde solo `{ id, nombre, barrio, asistio }`.
- `GET /:id/asistentes` agrega `puede_marcar` por fila (el escritorio ofrece el botón solo a quien puede).

### Escritorio
En «Asistentes a reuniones»: la ventana de asistentes trae la columna **Asistencia** con **«Asistió» / «No asistió»** por persona y el título dice «asistieron N de M»; la tabla de reuniones y la de «Eventos y GOTV» muestran **«asistieron N»** bajo los invitados, al día tras cada marca. **No existe una pantalla de «detalle del evento»** en el escritorio: la ventana de asistentes es el detalle; `eventos.html` solo tiene el contador.

### Celular (`/app/eventos.html`)
- **Mis eventos:** Hoy, Próximos y «Anteriores, últimos 7 días» (decisión mía: se marca al día siguiente), cada tarjeta con fecha, lugar y «N / meta invitados» y «asistieron N».
- **Al abrir un evento:** invitados con nombre y barrio, botón grande **«Asistió»** (se vuelve «✔ Asistió»; tocarlo otra vez la desmarca), buscador por nombre (sin tildes ni mayúsculas), y «Agregar asistente por cédula» solo si `puede_agregar` (necesita señal: lo dice).
- **Sin señal:** copia `eventos_cache` de 48 horas con dueño (se borra al cerrar sesión o cambiar de cuenta: está en las dos listas, `OFFLINE_STORES_COPIA` y `COPIAS_SIN_SENAL`) y cola `eventos_pendientes` con dueño, que **no lleva nombres** (solo `asistenteId`, el valor y el instante); varias marcas a la misma persona sin señal se **funden en la última**; las subidas van en fila; un rechazo del servidor queda «fallido» con el motivo y Reintentar / Descartar. Contadores locales = copia + cola.
- **Menú:** «Eventos» en `/app/inicio.html` (`MENU_LIDER`, que hereda el coordinador, y `MENU_ADMIN`) con `modulos: ['eventos', 'agenda', 'asistentes_reuniones']`: aparece con «Ver» en **cualquiera** de los tres (`pintarMenu` aprendió la clave `modulos`). El sublíder lo ve de fábrica (tiene `agenda`).

### Decisiones y cosas que conviene saber
- **Sublíder (decisión del dueño):** «solo marca asistencia». La orden decía además «y agregar asistentes»; el mensaje posterior dijo «solo marca asistencia, que es lo que ya trae la orden». **Lo leí de forma estricta: el sublíder NO agrega.** Ensancharlo es cambiar `ROLES_QUE_AGREGAN` en `lib/asistenciaEventos.js` y quitar el `requireRole` de la ruta por cédula (2 líneas) — y avisar antes de generar.
- **El sublíder no abre la lista del escritorio** (de fábrica solo tiene `agenda`, y esa ruta pide `eventos` o `asistentes_reuniones`): su camino es el celular.
- **Día de la elección:** no se mezcla con el check-in del Día D (tablas, rutas y pantallas distintas) y tampoco se bloquea esta marca ese día.
- El menú del celular del coordinador hereda el de líder, así que lo ve.

### Pruebas
- **`scripts/probar-eventos-asistencia.js` (nueva, 118; API + Chromium real):** alcance de líder, sublíder (invitado/responsable), coordinador, administrador y líder de otra rama; claves exactas y **ni un teléfono, cédula, correo ni dirección** en `GET /movil` (tampoco al administrador); permisos (403/404) en todas las rutas, incluido que el sublíder no confirma, no agrega, no quita y no edita; marca repetida sin doble conteo; el PUT ya no borra la confirmación; marca vieja ignorada y cuatro marcas desordenadas; validaciones (futuro, 7 días, uuid, valor); agregar por cédula (duplicada, ajena = no existe, corta, sublíder); escritorio; menú según permiso (con uno de los tres basta, con ninguno no aparece; sublíder); en el celular: grupos, tarjetas, buscador, botón de 48 px, cola sin señal con dueño y sin nombres, fusión de marcas, subida al volver la señal, copia que caduca (47 h sí, 49 h no) y se borra al cambiar de cuenta, marca rechazada «fallido».
- Ajustadas por la versión nueva de la base del celular (acepta 11): `probar-puerta-a-puerta`, `probar-encuestas`, `probar-logistica`, `probar-solicitudes`.
- **Regresión, 26 suites sobre bases clonadas nuevas: todas bien** (a la primera esta vez).

### En la Base (aplicado el 9 de noviembre de 2026, por el usuario, como root; salida pegada)
- **`init-db`** corrió sin error: «Columna asistio_ms agregada a evento_asistentes» y «Columna asistio_por agregada a evento_asistentes» (`guion_huella` ya existía: el 312 estaba aplicado).
- **Reinicio:** «OK: pid 3783232 -> 3796873 y el puerto 3002 responde».
- **La política de la Base sigue SIN el párrafo de las visitas** (la editó el administrador): pendiente que lo pegue antes de encender el puerta a puerta para el equipo.
- **No se probó la pantalla `/app/eventos.html` con un navegador real contra la Base** (solo en bases desechables). El 312 y el 313 siguen inactivos en el servidor de licencias.

### Pendientes
- Guion y panel del 312 siguen sin probarse en navegador real contra la Base; el 312 está inactivo.
- «Marcar asistencia» no tiene todavía reporte (p. ej. asistencia por barrio): el contador por evento es lo único que hay.

## Parche 312 — Puerta a puerta, Fases 3 y 4 (9 de noviembre de 2026, PUBLICADO Y REGISTRADO, INACTIVO, TOCA LA BASE)

**Requiere el 311.** Service worker `v182`. `OFFLINE_DB_VERSION = 10`. **Toca la base:** `puerta_guiones` (tabla: `id, huella CHAR(16), pasos JSON, creado_por, creado_en`) y `puerta_visitas.guion_huella CHAR(16) NULL`; repetible. **Hay que correr `init-db` y reiniciar** en cada campaña.

### Fase 3 — el guion (`lib/puertaGuion.js`)
- **De 3 a 5 pasos** de 5 a 220 caracteres, editables **solo por el administrador** en la sección «Guion de la visita» de `/puerta-listas.html` (el coordinador lo ve, no lo cambia). **Cada cambio es una versión** en `puerta_guiones` con su **huella** (sha256 de los pasos, 16 hex, igual que las encuestas); la vigente es la última; guardar lo mismo no crea otra. **Cada visita guarda solo la huella** del guion que se mostró (`guion_huella`), nunca el texto: el celular la manda en el registro; el servidor la anota solo si es la de por defecto o la de una versión guardada (si no, la visita se guarda sin huella: no se inventa una versión).
- **Por defecto, neutro:** saludo, presentación del equipo, escuchar las necesidades del barrio y despedida. Sin voto, elección, cargo, candidato, partido, apoyo ni «campaña»; la prueba lo pasa por el validador de las encuestas con y sin nombre de candidato.
- **Precampaña** (`revisarPrecampana` de `lib/encuestasReglas.js`, el MISMO validador): **al guardar**, antes de `fecha_permitida_propaganda` un guion con palabras prohibidas no se guarda (422, dice la palabra y el paso); **al mostrar** (cada `GET /mias` y la pantalla del administrador), si la versión vigente las trae —o su texto ya no coincide con su huella— el celular recibe el guion por defecto, `sustituido: true` (el motivo solo lo ve el administrador). Lo que el celular ya bajó no se vuelve a juzgar sin señal.
- **En el celular:** «Ver guion» plegado arriba de cada ficha de la ruta; sin señal, el guion viaja con la copia de la lista (`guion` en `GET /mias`, que ahora devuelve `{ bloqueo, listas, config, guion, inscripcion }`; con la lista vacía no trae los dos últimos).
- **«Alguien quiere registrarse» + QR:** si quien visita tiene enlace de inscripción (`config/inscripcionEnlace.js`: puede tenerlo, la inscripción por enlace está habilitada y su enlace está activo), el cuadro ofrece «Mostrar código QR» (el de `/js/qrcode-generator.js`, el mismo de «Mi enlace de inscripción»), «Abrir el registro» y «Listo»; el enlace viaja con la copia, así que el QR sale también sin señal. **Sin enlace no se ofrece**: se abre el registro de una vez, como antes. **Decisión mía:** `mias` usa `obtenerOCrearEnlace`, o sea que a un líder elegible que nunca abrió «Mi enlace» se le crea al bajar la lista (es lo que ya hace esa pantalla).
- API: `GET /guion` (ver), `PUT /guion` (administrador, auditado `puerta_guion_guardar`).

### Fase 4 — el panel (`lib/puertaPanel.js`, `public/puerta-panel.html`, menú «Puerta a puerta · panel»)
- **Quién:** módulo `puerta_listas` · Ver (administrador; coordinador cuando se le abra), **acotado al alcance de las listas** (`alcanceTareas`). Solo conteos.
- **Cobertura por zona:** listas, puertas asignadas, puertas visitadas, visitas y el resultado por tipo (seis). **Mínimo por celda: el de las encuestas** (`minimoPorCelda`, 5 de fábrica, solo hacia arriba) sobre las VISITAS de la zona; lo que no llega va a «Otras zonas» **sin dejar restar** (`aplicarMinimo` de las encuestas: si el grupo no llega, se le suma la zona visible más pequeña; si nada llega, ni zonas ni total). **Decisión mía:** una zona con CERO visitas en el período se muestra tal cual y no cuenta para el mínimo (no dice nada de nadie; si no, una zona con 14 puertas y ninguna visita arrastraba a la única zona visible a «Otras zonas»).
- **Avance por visitante:** listas, asignadas, visitadas, por visitar, cerradas, sin respuesta, visitas. **Sin** desglose por resultado (por eso no lleva mínimo). «Por visitar/Cerradas/Sin respuesta» son el estado de hoy; no siguen el filtro.
- **Filtro** `desde`, `hasta` y `franja` (mañana/tarde/noche; no hay nada más fino: la base ni guarda la hora). **El precio, dicho en `lib/puertaPanel.js`:** las encuestas NO tienen filtro por fecha justo porque dos consultas que difieren en un día se pueden restar; aquí se pidió, y el mínimo se aplica a CADA consulta (cada cifra mostrada tiene ≥5 visitas detrás) pero una resta puede dejar al descubierto un grupo de 1 a 4 visitas de un día. Un día de recorrido es «un grupo de visitas», nunca «una casa».
- **Qué se cuenta:** «listas» y «asignadas» son las de las listas creadas hasta `hasta`; «visitadas» y las visitas, solo las del período y la franja. **La zona de una puerta es la de su última visita** (el barrio al momento de visitar) y, si nunca se visitó, la de la ficha hoy; al vencer la retención (6 meses después de la elección) las nunca visitadas pasan a «Sin zona».
- **Excel** (`GET /panel/exportar`): tres hojas (Notas, Cobertura por zona, Avance por visitante), cada una con «Uso interno – no publicable», las MISMAS columnas del panel (listas cerradas `COLUMNAS_ZONA` y `COLUMNAS_VISITANTE`, fijadas por la prueba), la nota «nunca una lista de casas ni de personas», auditado `exportar_excel`. Pide Ver **y** la casilla «Importar / Exportar» del módulo: `config/importarExportar.js` ahora trae `puerta_listas: ['admin', 'coordinador']`, pero la migración solo actualiza filas que existan: **un coordinador sin fila de `puerta_listas` en la matriz no exporta hasta que el administrador abra el módulo**.

### Mapa: pines encimados
`separarPines()` en `puerta-a-puerta.html`: los pines a menos de 30 px en pantalla se abren en círculo alrededor de su centro, cada uno con su número, y se recalcula al hacer zoom (al acercarse vuelven a su sitio). **Solo al dibujar:** las coordenadas guardadas, la copia del celular y la línea guía no cambian (la prueba lo comprueba con dos puertas a un metro).

### Pruebas
- **`scripts/probar-puerta-fases-3-4.js` (nueva, 138; API + Chromium real):** guion por defecto neutro; permisos; 3–5 pasos; versiones y huellas; precampaña al guardar y al mostrar (incluido el contenido que ya no coincide con su huella); la huella en la visita y que no hay dónde guardar el texto; el enlace (desactivado, inscripción apagada, sin estructura); panel con cifras conocidas (columnas cerradas, mínimo, «Otras zonas», total que suma, **alcance de dos coordinadores**, mínimo configurable 8 y 25, filtros por fecha y franja, validaciones); Excel (hojas, columnas, ninguna celda con nombres ni direcciones, alcance, auditoría, permiso de exportar); y en el celular: «Ver guion» arriba y plegado, sin señal con la copia **y la huella de la copia aunque la campaña cambie el guion mientras tanto**, QR dibujado con el enlace correcto (también sin señal), sin QR cuando no hay enlace, pines separados sin tocar las coordenadas; el editor del guion y el panel en las pantallas de escritorio.
- Ajustadas: `probar-puerta-a-puerta.js` (cuatro tablas, `guion_huella`, claves de `GET /mias`, `v182`) y `probar-puerta-a-puerta-celular.js` ([8]: con enlace, primero el cuadro y «Abrir el registro»).
- **Regresión, 25 suites sobre bases clonadas nuevas:** 24 bien. `probar-puerta-a-puerta-celular` falló UNA vez en la corrida en paralelo («el servidor guardó el resultado…», un tiempo bajo carga) y **pasa sola** (82 de 82).
- **Una prueba sin sentido que me encontré al escribir la mía:** sin señal NO se recarga la página (pide la sesión): se repinta con `refrescar()` desde la copia, como hace la prueba del celular de siempre.

### En la Base (aplicado el 9 de noviembre de 2026, por el usuario, como root; salida pegada)
- **`init-db`** corrió sin error: «Columna guion_huella agregada a puerta_visitas» y «Tablas del puerta a puerta listas»; `puerta_listas.oculta` ya existía (el 311 ya estaba aplicado). La tabla `puerta_guiones` se crea con `CREATE TABLE IF NOT EXISTS` y no deja renglón propio en la salida.
- **Reinicio:** «OK: pid 3737583 -> 3783232 y el puerto 3002 responde».
- **La política de la Base sigue SIN el párrafo de las visitas:** «la editó el administrador, así que NO se agregó la finalidad de las visitas». Sigue pendiente que el administrador lo pegue (Configuración → Política de privacidad) antes de encender el puerta a puerta para el equipo.
- **No se probó la pantalla nueva con un navegador real contra la Base** (solo en bases desechables).

### Pendientes / a tener en cuenta
- El guion aún no pasa por la política de privacidad ni por el abogado: es texto de la campaña. La finalidad de las visitas ya lo cubre en lo general.
- El panel agrupa por la zona de la ficha (barrio o vereda); no hay agrupar «por la zona que la contiene» como en las encuestas.
- Un guion editado no avisa al celular: lo recibe al bajar la lista otra vez (la copia dura 48 horas).
- Siguen pendientes: Leaflet de unpkg en `mapa.html`, `dashboard.html` y `app/admin-mapa.html`; la carrera de doble envío en las colas de Tareas y Solicitudes; la comprobación vieja de `probar-instalacion-limpia` («territorio_id indexado en 6 tablas»).

## Parche 311 — Puerta a puerta: ajustes (9 de noviembre de 2026, PUBLICADO Y APLICADO según el usuario, TOCA LA BASE: una columna)

Orden del dueño: cinco ajustes del puerta a puerta, sumados a la entrada «Política de privacidad» (`0a340e2`). **Como el 310 no se ha publicado, el 311 lo INCLUYE** (lleva los 8 archivos del 310 más los de este lote) y por tanto **requiere el 309**, no el 310. **Si el 310 se publica antes, el 311 sigue sirviendo** (los archivos son los mismos más lo nuevo); no hace falta publicar el 310.

**Toca la base:** `db/init-db.js` agrega `puerta_listas.oculta` (TINYINT, 0 por omisión) con `agregarColumnaSiFalta`; repetible. **Hay que correr `init-db` y reiniciar** en cada campaña (la lista de la pantalla consulta esa columna: sin ella, «Listas» no carga).

### 0. Entrada «Política de privacidad» en Configuración (commit `0a340e2` / `35a3373`, `public/js/common.js`)

**La pantalla ya existía y estaba en el menú — pero no para el superadministrador.** Dirección exacta: **`/contenido.html?clave=politica_privacidad`** (en el servidor de cada campaña: `https://<dominio>/contenido.html?clave=politica_privacidad`). Es la pantalla donde se edita (botón «✎ Editar», admin y coordinador; el servidor solo deja guardar al administrador, ver `routes/contenido.routes.js`) y donde sale el recuadro ámbar «Falta la finalidad de las visitas» (solo admin). Se llegaba desde el menú lateral → **«Contenido para compartir» → «Política de privacidad»**, y desde el enlace del formulario de registro de votantes. **Causa de que el dueño no la viera:** el menú del superadministrador se arma con el catálogo `MODULOS` (`routes/permisos.routes.js`), que no trae `politica_privacidad` ni `biografia_candidato`; el grupo «Contenido para compartir» se le encoge a un solo enlace («Información para compartir»). Medido con un Chromium: el superadministrador de la base de prueba solo veía ese enlace.

**Arreglo:** una entrada nueva en el grupo «Configuración» del menú de escritorio: **«Política de privacidad»**, `modulo: 'configuracion'`, `roles: ['admin']` (misma regla que sus hermanas: aparece al administrador y al superadministrador; el coordinador no ve Configuración). Misma dirección que la otra: al administrador que ve las dos le llevan al mismo sitio (en el menú queda marcada la primera, la de «Contenido para compartir»). **El menú del celular se resuelve en el punto 5 de abajo.**

**Prueba:** `scripts/probar-menu-politica.js` (Chromium real, 13 comprobaciones): superadministrador, administrador y coordinador ven lo que deben; la entrada abre la pantalla; el recuadro ámbar aparece (con el párrafo exacto) para el superadministrador y el administrador cuando la política editada no trae la finalidad, no aparece para el coordinador y se va cuando la política la trae. **Sin el arreglo, la prueba falla** (comprobado). Con él: `probar-manuales`, `probar-ordenar-select`, `probar-puerta-a-puerta-celular` y `probar-tareas-celular` siguen bien. Primera vez que el recuadro ámbar se prueba en un navegador (el parche 309 lo probó solo por la API).

**En la Base:** el cambio ya está en disco (`common.js` es un archivo estático: no hace falta reiniciar). Para verlo, recargar la página (Ctrl+Shift+R): el service worker sirve la red primero. En las campañas llegará con el 311.

### 1. Editar y reactivar listas cerradas o canceladas
- `PUT /api/puerta-a-puerta/listas/:id` (nombre, quién visita, máximo de personas; módulo `puerta_listas` · Editar) y `POST …/reactivar`. Una lista **activa no se edita** (el celular tiene una copia): se cierra o cancela primero. Una oculta tampoco.
- **Cambiar quién visita** vuelve a juzgar el alcance del NUEVO visitante: salen de la lista las puertas «pendientes» que él no ve. Las que ya tienen resultado se conservan (son historia). Una puerta pendiente **con visitas** no se borra —borrarla se llevaría las visitas por la cascada—: se suelta de la persona (`votante_id = NULL`) y queda «agotada» (sin respuesta); al soltarla queda libre para otra lista.
- **Máximo:** si baja, salen las últimas pendientes (id más alto); si sube, entran más personas de la **misma zona** con las reglas de armar (`candidatos()`, compartido con armar); si lo que sobra ya tiene resultado, 422 y no se cambia nada.
- **Reactivar** vuelve a «activa» con las mismas reglas: quien visita sigue siendo asignable; de las pendientes salen las que hoy están fuera de alcance, sin autorización, sin dirección, con `no_visitar`, **ya en otra lista activa** (una lista activa por persona) o **visitadas en otra lista hace menos de 60 días**. Si ninguna cumple, 422 y nada cambia. `cerrada_en` vuelve a NULL.
- Auditoría: `puerta_lista_editar`, `puerta_lista_reactivar`.

### 2. Eliminar u ocultar (solo administrador)
- `DELETE …/listas/:id`: solo cerrada o cancelada **sin ninguna visita**; borra la lista y sus puertas. `POST …/ocultar` y `…/mostrar`: la lista sale de la tabla (filtro «Ver ocultas», solo para el administrador) y **se conserva todo**. Auditoría: `puerta_lista_eliminar`, `_ocultar`, `_mostrar`.
- La pantalla ofrece «Eliminar» si se puede y «Ocultar» si no (`eliminable` viene de `GET /listas`).
- **Decisión mía, no pedida, que hay que saber:** una lista **cerrada hace menos de 7 días** no se puede eliminar aunque no tenga visitas (se oculta), porque un celular todavía puede subir visitas anotadas antes del cierre (la ventana de captura es de 7 días, `VENTANA_CAPTURA_DIAS`) y borrarla las perdería en silencio. Una **cancelada** sí se elimina de inmediato (el servidor ya rechaza sus visitas). Pasados los 7 días, se elimina.
- También agregué «Mostrar de nuevo» (no estaba en la orden): una lista oculta sin forma de volver sería una trampa.

### 3. La zona al armar es un desplegable
`<select id="a-zona">` agrupado por tipo (Barrios, Veredas, Comunas, Corregimientos, Municipios) con la opción «Todas sus personas»; si dos del mismo tipo y nombre chocan, lleva «· <padre>». Ya no se escribe: el `<datalist>` exigía coincidir con la etiqueta exacta. **No pude reproducir cómo terminaba «La Enea» en «—»** (la versión de hoy rechazaba con un mensaje si no coincidía); el desplegable cierra el camino de todos modos. En la prueba, «La Enea» existe como barrio Y como vereda (como en Manizales): aparece en los dos grupos y la lista armada muestra «La Enea» en la tabla.

### 4. Mensaje de lista vacía
Sin NADIE de partida: «Este líder no tiene votantes en su alcance.» (con zona: «…para esa zona.»), **sin** `omitidas` ni desglose. Con personas pero ninguna visitable: «Hay N persona(s) en su alcance, pero ninguna se puede visitar: 1 sin autorización, …» con **solo los motivos distintos de cero**. Se acabó la frase «todas están sin autorización, sin dirección…». La pantalla ya no repite el paréntesis de cifras.

### 5. Menú del celular
`public/app/inicio.html`, `MENU_ADMIN`: «Política de privacidad» (🔒) → `/contenido.html?clave=politica_privacidad`. Solo administrador (el coordinador y el líder ya tienen la lectura, `/app/politica-privacidad.html`). **Esa pantalla es la de escritorio** (como Solicitudes o Tareas): en el celular se ve, no es una versión móvil.

### Y de paso
- Service worker **`v181`**. Manuales: `mod-puerta_listas` (sección «Editar y reactivar una lista») y `t-puerta-armar`.
- `GET /listas` devuelve ahora `oculta`, `visitas`, `eliminable` (conteos y marcas; nunca nombres). La prueba que fija la lista cerrada de claves se actualizó.

### Pruebas
- **`scripts/probar-puerta-ajustes-311.js` (nueva, 87 comprobaciones; API + Chromium real):** los cinco puntos, incluida la pantalla (desplegable, cuadro «Editar la lista», Reactivar, Eliminar, Ocultar, «Ver ocultas», «Mostrar de nuevo», el coordinador sin Eliminar/Ocultar) y el menú del celular para administrador, coordinador y líder. **La prueba encontró un fallo real mío**: al sacar a quien no es del alcance del nuevo visitante usé `NOT (condición)`, que con `NULL` (un votante sin sublíder) no devuelve la fila: «sacó 0» en vez de 5. Corregido con `COALESCE`.
- `probar-puerta-a-puerta.js` (194): actualizadas la lista cerrada de columnas de `puerta_listas` (+`oculta`), la de claves de `GET /listas` y `v181`.
- **Regresión, 25 suites (cada una sobre una base clonada nueva; mysqld privado, ya apagado):** 22 bien a la primera. Tres fallaron y se miraron una por una: `probar-inscripcion-enlace` («persona nueva: recibe su SMS de confirmación») y `probar-recordatorios` («enviado → enviando») **pasan solas** — el fallo de tiempo bajo carga, ya documentado; y **`probar-encuestas` era un fallo real de la prueba, no del código**: fijaba el service worker en `v177–v180` y con `v181` fallaba; ahora acepta «v177 o posterior» (como ya hacían las de logística, solicitudes y transporte). Con eso pasa.
- **`probar-instalacion-limpia.js`** (la clave de una base vacía creada con un usuario sin SUPER; hizo falta `log_bin_trust_function_creators`): crea las 82 tablas y todo pasa **salvo una comprobación que ya estaba desactualizada**: «`territorio_id` indexado en las 6 tablas» cuenta 12 (hay 10 tablas distintas: se sumaron solicitudes, tareas y `puerta_*` en los parches 303–309). No es de este lote (no agregué ningún índice); **la cifra de la prueba (6) debería ser 10 tablas / 12 índices**, pendiente de confirmar con el dueño qué se quiso comprobar.

### En la Base (esta instalación)
Los archivos ya están en disco (las pantallas estáticas se sirven al recargar). **Faltan dos pasos de root**, porque el servidor carga `lib/` y `routes/` al arrancar y la columna `oculta` no existe todavía: (1) `init-db` (agrega la columna) y (2) reiniciar la Base. **No se ejecutó nada contra la base real** (`electoraldb`); todo se probó en bases desechables. Orden: primero `init-db`, después el reinicio (al revés, `GET /listas` fallaría por la columna).

### Pendientes / a tener en cuenta
- Las listas **editadas o reactivadas** no avisan al celular de quien las recorre: la copia de 48 horas sigue siendo la vieja hasta que baje la lista otra vez (por eso una lista activa no se edita: se cierra o cancela primero). Una visita capturada sin señal mientras la lista estuvo cerrada, subida después de reactivarla, se acepta (la lista ya está activa); una anterior al cierre también.
- Al sacar una puerta con visitas de una lista (cambio de visitante o máximo menor) se suelta de la persona: su cuenta de intentos queda en esa puerta «sin respuesta», y la persona queda libre para otra lista (la regla de los 60 días mira las puertas ligadas a ella).
- Sigue pendiente: Leaflet de unpkg en `mapa.html`, `dashboard.html` y `app/admin-mapa.html`; Fases 3 (guion) y 4 (panel) sin construir; la carrera de doble envío de las colas de Tareas y Solicitudes.

## Parche 310 — Puerta a puerta, Fase 2: mapa y ruta (9 de noviembre de 2026, GENERADO, SIN PUBLICAR, NO TOCA LA BASE)

**Requiere el 309** (el 307, el 308 y el 309 están publicados y aplicados en municipal, departamental y c001, según el usuario). Service worker `v180`. **No hay migración**: `init-db` no hace falta; sí hace falta **reiniciar** la Base (hay una ruta nueva y un arreglo en el servidor).

### Lo que se construyó (`public/app/puerta-a-puerta.html`)
1. **Mapa con el Leaflet local** (`/vendor/leaflet/leaflet.js` y `.css`, 1.9.4), nunca de unpkg. Pines **numerados en el orden de la ruta** (los mismos números de la lista). Tocar un pin resalta **la misma ficha de la lista** (con sus botones de resultado) y se desplaza hasta ella; tocar el número de una ficha resalta su pin y centra el mapa.
2. **Línea simple** que une los pines en orden (discontinua, solo guía; la pantalla dice «no es una ruta por calles»).
3. **«Mi ubicación»** (antes «Ordenar desde donde estoy»): una sola lectura, **solo en memoria**; reordena la ruta desde ahí, dibuja el punto de partida y la línea sale de él. La prueba revisa todas las peticiones: la ubicación no llega al servidor.
4. **Fichas sin coordenadas**: al final de la lista, con «Sin ubicación en el mapa».
5. **Sin señal**: los pines y la línea se dibujan igual sobre un **fondo liso** (`#E6ECF3`) y la lista sigue operando. **No se descargan teselas por adelantado y no se guardan** (no hay `fetch`/`Image` a teselas; el service worker no toca recursos de otro origen, comprobado por prueba). Las teselas se piden **solo con señal** (`navigator.onLine`): al cortarse se quita la capa, al volver se pone.
6. **El fondo usa la misma fuente que el mapa territorial**: Mapbox Calles (`streets-v12`) si hay `MAPBOX_ACCESS_TOKEN`, OpenStreetMap si no. Los líderes y sublíderes no pueden llamar a `/territorial/mapbox-token` (es de admin, coordinador y aspirante), así que hay una ruta nueva **`GET /api/puerta-a-puerta/mapa-config`** (módulo `puerta_visitas`, «Ver») que devuelve `{ mapbox_token }`: el token es PÚBLICO por diseño de Mapbox (se restringe por dominio en su panel). Una tesela pide solo `zoom/x/y` de la zona que se mira; la prueba verifica que **toda petición externa es una tesela con ese formato** y que ninguna lleva un nombre ni una dirección. `<meta name="referrer" content="origin">` y `referrerPolicy: 'origin'` en las teselas: al servidor de teselas solo llega el dominio de la app.
7. **Sin botón de Google Maps ni de otra app de navegación** (comprobado en el HTML y en las peticiones).

### Corregido de paso
- **`tareas.html` y `solicitudes.html`** cargaban Leaflet de unpkg: pasan al `/vendor/leaflet` local. **Quedan en unpkg, sin tocar** (no estaban en la orden): `mapa.html`, `dashboard.html` y `app/admin-mapa.html`.
- **Una carrera real, encontrada por la prueba nueva:** si el aviso «volvió la señal» y el toque de un resultado subían la cola a la vez, el mismo registro viajaba dos veces; el servidor guardaba el primero y al segundo le contestaba **409 «Todavía no / ya tiene un resultado»**, así que el celular dejaba «fallido» algo que SÍ se había guardado. Dos arreglos: (a) el servidor, al entrar en la transacción de la puerta, mira si ya existe una visita con ese `cliente_uuid` y la devuelve como duplicada; (b) la pantalla pone las subidas **en fila** (la segunda ya no encuentra nada que subir). Probado con cuatro envíos simultáneos del mismo registro sobre una puerta pendiente: todos reciben éxito, una visita, un intento. **Ojo:** `mis-tareas.html` y `mis-solicitudes.html` suben con `sincronizarCola` sin fila; el servidor de Tareas/Solicitudes puede tener la misma carrera. No se tocó (no estaba en la orden).
- `scripts/capturas/navegador.js` ahora registra la URL de cada petición de la página (`peticiones`), para poder comprobar a dónde NO llama.
- Las pruebas se aíslan del `.env`: borran `MAPBOX_ACCESS_TOKEN` (la Base tiene uno real) antes de correr.

### Base
El usuario reinició la Base el 9 de noviembre de 2026 (como root; salida pegada): «OK: pid 3643873 -> 3653820 y el puerto 3002 responde». Verificado desde esta cuenta: el proceso tiene minutos de vida. No hizo falta `init-db` (el 310 no toca la base). Los archivos de `public/` ya se servían desde el disco; el reinicio cargó `GET /mapa-config` y el arreglo de la carrera. **No se probó la pantalla con un navegador real contra la Base** (solo en bases desechables).

### Pruebas (cada suite sobre una base desechable nueva; mysqld privado, ya apagado y borrado)
- **`probar-puerta-a-puerta-celular.js` (81, Chromium real):** la sección [13] nueva: Leaflet 1.9.4 de `/vendor/leaflet`; **cero peticiones a unpkg ni a Google**; pines numerados en el mismo orden que `ordenarPorCercania` (calculado en Node con las coordenadas de la base); línea en orden; ficha sin coordenadas al final; tocar un pin/un número; lo único que sale a la red son teselas `zoom/x/y`; «Mi ubicación» (reorden, línea desde el punto, **ni en un cuerpo ni en una URL**, ni guardada); **con la red cortada (CDP offline)** los 4 pines y la línea siguen, sin teselas, sobre fondo liso, y la lista opera y sube al volver; con token el fondo es Mapbox; `/tareas.html` y `/solicitudes.html` abren su mapa con el Leaflet local.
- **`probar-puerta-a-puerta.js` (194):** `GET /mapa-config`, service worker `v180` con Leaflet en la coraza, sin unpkg en las tres pantallas, referrer, y la carrera.
- **Regresión, 22 suites:** todas bien salvo `probar-recordatorios` en la corrida paralela («la campaña terminó en enviado → enviando»), **el fallo de tiempo bajo carga que ya estaba documentado**; corrida sola, **pasa 2 de 2**.

### Pendientes / a tener en cuenta
- **Sin precalentar el mapa:** el fondo con calles solo aparece con señal y solo en la zona que se mira. En campo sin señal el mapa es un esquema de pines y línea.
- La línea une los pines en orden de cercanía (vecino más cercano): no es la ruta óptima ni por calles.
- La puerta que ya se tocó y espera sus 24 horas («Para volver más tarde») no tiene pin: no está en la ruta.
- Fase 3 (guion y derivaciones) y Fase 4 (panel de cobertura) siguen sin hacerse.

## Parche 309 — Puerta a puerta, Fases 0 y 1 (9 de noviembre de 2026, publicado, activado y aplicado en las tres campañas según el usuario, TOCA LA BASE)

**Requiere el 308.** Service worker `v179`; `OFFLINE_DB_VERSION = 10`. Todo **apagado de fábrica**: los módulos `puerta_listas` (armar) y `puerta_visitas` (visitar) solo los ve el administrador. **Solo el modo (a)**: visitas a votantes YA REGISTRADOS. El modo (b) no se construye.

**La finalidad de las visitas viaja DENTRO del 309** (el dueño aprobó el texto el 9 de noviembre de 2026, con un cambio: «en la mañana o en la tarde»). Si el administrador ya editó la política, `init-db` NO la toca y la pantalla de Administración muestra un aviso con el párrafo: **antes de encender el puerta a puerta para el equipo, comprobar en cada campaña que la política lo trae.**

### Fase 0 — decisiones del dueño, tal como se aplicaron
1. «Pidió no volver» = `votantes.no_visitar` (+ `no_visitar_fecha`, solo la fecha), **separada de `no_contactar`**. Casilla aparte «tampoco quiere mensajes» → `aplicarBajaDeFicha` con canal `en_persona` y origen `puerta_a_puerta`; se aplica **antes** de guardar la visita (si algo falla después, la persona ya quedó protegida). Lo hereda lo que ya hacía esa función: la baja se extiende a otras fichas con el mismo teléfono o correo.
2. Copia local de la lista: por usuario (`puerta_cache`), **caduca a las 48 horas**, se borra al cerrar sesión o cambiar de cuenta (`COPIAS_SIN_SENAL`, en `cuentas-dispositivo.js`, y `OFFLINE_STORES_COPIA`, en `offline-utils.js`: la lista está duplicada a propósito). Sin cédula, teléfono, correo, `apoya_a`, observaciones ni consentimiento.
3. Franja horaria **08:00–18:00** (hora de Colombia), configurable por el administrador entre 07:00 y 19:00 y de al menos una hora (`configuracion_campana.puerta_franja_desde/hasta`; `PUT /api/puerta-a-puerta/config`, auditado). Fuera de la franja **no se guarda** ni en el celular ni en el servidor. Se juzga con la hora de CAPTURA.
4. «No abrió»: máximo 3 intentos con al menos 24 h entre uno y otro. «No interesado»: no se vuelve a asignar en 60 días.
5. El día de la elección el módulo queda bloqueado (fecha de captura, también sin señal: el celular lee `fecha_eleccion` de su copia). **Los días previos no se bloquearon**: los consulta el abogado.
6. Las visitas guardan **fecha y franja** (mañana < 12:00, tarde < 17:00, noche), nunca la hora. Ninguna columna de `puerta_visitas` lleva hora ni ubicación. La ubicación del líder, si la da, vive solo en memoria de la pantalla (nunca en IndexedDB ni en una petición).
7. Retención: 6 meses después de la elección (`anonimizar_solicitudes_meses`), la vuelta diaria de `lib/solicitudesMantenimiento.js` pone `puerta_items.votante_id = NULL`; las visitas quedan con resultado, fecha, franja y barrio, sin persona.
8. Política: la finalidad está en `init-db` (ver «Política de privacidad», abajo).

### Lo que se construyó
- **Esquema** (`db/init-db.js`): `puerta_listas`, `puerta_items` (`votante_id` NULL-able, FK `ON DELETE SET NULL`), `puerta_visitas` (idempotente por `cliente_uuid`; copia el `territorio_id` de la ficha para el panel futuro), `votantes.no_visitar`, `votantes.no_visitar_fecha`, franja, y los dos módulos en `PERMISOS_POR_DEFECTO` y en la matriz (`routes/permisos.routes.js`).
- **`public/js/puerta-reglas.js`**: UN archivo, en el servidor y en el celular, con franja, tope de intentos, las 24 horas, caducidad de la copia y el **puerto de `ordenarPorCercania`/`distanciaMetros`** (la prueba lo compara con el original del servidor sobre 3.000 casos al azar: idéntico). Las 24 horas se cuentan desde el FINAL de la franja del intento (no hay hora exacta que contar): es una cota prudente de 24 a 31 horas.
- **`lib/puertaAPuerta.js`** y **`routes/puertaAPuerta.routes.js`** (`/api/puerta-a-puerta`): `GET/PUT /config`, `GET /zonas`, `GET /responsables`, `GET/POST /listas`, `POST /listas/:id/cerrar|cancelar`, `GET /mias`, `POST /visitas`. Quien arma ve **solo conteos**.
- **Alcance de quien NO es quien arma** (`alcanceDeUsuario`): `{ usuarioId, cargo: rol, cargoMadre: null }`. Para líder y sublíder, `condicionAlcanceVotantes` solo mira `cargo` y `usuarioId`, así que es exactamente lo que `calcularAlcance` produciría si esa persona abriera la sesión (la prueba lo compara contra el middleware real). Al ARMAR se aplican **las dos** condiciones (la del que va a visitar y la de quien arma) más `rama_aspirante_id IS NULL`; al LEER se vuelve a aplicar la del visitante. Se le puede asignar solo a líder o sublíder activo de la campaña madre y dentro de `asignablesPara`.
- **Aspirante con sublicencia: fuera.** La ruta no está en `PERMITIDOS` de `middleware/aspirante.js` y el router además la cierra con 403 por si alguien la agregara a esa lista.
- **`GET /mias`**: respuesta `{ bloqueo, listas, config }` con `Cache-Control: no-store`. Por puerta, **exactamente**: `id, nombre, direccion, latitud, longitud, estado, intentos, ultimo_resultado, ultima_fecha, ultima_franja, reintento_desde` (lista cerrada comprobada por prueba). De una puerta **cerrada o agotada no viaja ni nombre, ni dirección, ni coordenadas**. Auditado cada vez que baja una lista (`puerta_lista_descarga`, con cuántas listas y personas, nunca quiénes); cada lista armada, cerrada y cancelada también.
- **`public/app/puerta-a-puerta.html`**: ruta ordenada por cercanía en el celular, GPS opcional de una lectura solo en memoria, los seis resultados, cola `puerta_pendientes` (sin nombre ni dirección: solo la puerta, el resultado y el instante del toque, que se borra al subirse) con `sincronizarCola` (solo borra lo que el servidor confirmó), copia `puerta_cache`. Sin Google Maps, sin compartir, sin imprimir (la página sale en blanco), sin llamar, sin mapa. «Alguien quiere registrarse» abre `/app/registro-votante.html` y «Dejó una solicitud» abre `/app/solicitud-nueva.html`; **no se guarda de cuál visita vino** (no existe columna de enlace).
- **`public/puerta-listas.html`** (escritorio, menú «Puerta a puerta»): armar, ver conteos, cerrar/cancelar y —solo el administrador— la franja. No estaba en la orden pero sin ella nadie podía armar una lista.
- **Manuales**: `mod-puerta_listas`, `mod-puerta_visitas`, `t-puerta-armar`, `t-puerta-recorrer` (la prueba de manuales exige un bloque por módulo de la matriz).

### Decisiones mías que conviene revisar
- **Los 60 días se aplican a TODA puerta cerrada o agotada**, no solo a «no interesado»: de lo contrario, quien dijo «interesado» entraba en la lista siguiente al día siguiente (visitas repetidas). Es una constante (`DIAS_SIN_REASIGNAR`).
- **Tope de 300 personas por lista** (`MAX_ITEMS_LISTA`), y una persona ya pendiente en otra lista activa no entra en una nueva.
- **«Quiere registrarse» en el modo (a)**: la persona visitada ya está registrada, así que el botón se rotuló «Alguien quiere registrarse» (otra persona de la casa).
- Una lista cerrada acepta lo capturado **antes** del cierre; una cancelada no acepta nada.
- Al cortar el vínculo (retención) se pierde también la memoria de «60 días»: solo ocurre 6 meses después de la elección.
- `votantes.updated_at` no se mueve cuando una visita marca `no_visitar` (`updated_at = updated_at`), para que la ficha no guarde la hora exacta de la visita. `aplicarBajaDeFicha` sí escribe `no_contactar_fecha` con la hora (evidencia de la baja; es existente).
- **No hay pantalla para quitar `no_visitar`**: si alguien cambia de opinión, hoy es un `UPDATE` a mano.

### Conteos de coordenadas (solo números; medidos el 9 de noviembre de 2026 con `scripts/contar-coordenadas-votantes.sh`, corrido por el usuario como root)
La tabla `votantes` no tiene columna de activo/inactivo: «activos» = todas las fichas.

| Instalación | Fichas | Con coordenadas | Sin coordenadas | Sin coord. pero con dirección | Sin dirección | Con autorización | Autorizadas con dirección |
|---|---|---|---|---|---|---|---|
| Base (`electoraldb`) | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Municipal | 116 | 113 | 3 | 1 | 2 | 116 | 114 |
| Departamental | 81 | 81 | 0 | 0 | 0 | 81 | 81 |
| c001 (`c00-2027db`; desde el 10 de noviembre de 2026 es `c001-2027db`) | 17 | 11 | 6 | 5 | 1 | 17 | 16 |
| **Total campañas** | **214** | **205 (96 %)** | **9** | **6** | **3** | **214** | **211** |

Lectura: de 214 fichas, 211 tienen autorización y dirección (la base visitable antes de los demás filtros) y 205 tienen coordenadas, o sea que se pueden ordenar por cercanía; **9 quedan al final de la ruta, 6 de ellas con dirección que «Re-geocodificar pendientes» (Votantes) podría resolver** (5 en c001). Las fichas de las campañas de prueba son pocas: en una campaña real la proporción dependerá de cuántas se registren con dirección y de la precisión de la geocodificación de Google, que **no se guarda** (solo si hay coordenadas). Sigue sin medirse qué tan exactas son.

### Política de privacidad — la finalidad de las visitas (aprobada, viaja en el 309)
- **Texto** en `config/politicaVisitas.js` (un solo sitio: lo usan `init-db`, la pantalla y las pruebas). Es el propuesto el 9 de noviembre de 2026 y aprobado por el dueño con **un** cambio: «…el día, si fue en la mañana o en la tarde, y el resultado…» (antes: «en la mañana, la tarde o la noche»). Frase de control: `visita domiciliaria de la campaña`.
  **Ojo:** el sistema guarda TRES franjas (mañana < 12:00, tarde < 17:00 y noche desde las 17:00, hasta las 19:00 como máximo). La política dice «mañana o tarde»: es verdad si «la tarde» incluye el atardecer. Si el abogado prefiere exactitud, se puede reducir a dos franjas (cambio de ENUM y de `finDeFranja`).
- **Mecanismo** (`agregarFinalidadVisitas`, en `db/init-db.js`, después de la de encuestas): si la política YA trae la frase, no hace nada; si el administrador la **editó** (`contenido_paginas.actualizado_por` no es NULL —solo se llena al guardar desde la pantalla; la siembra y las finalidades automáticas lo dejan NULL—) **no la toca** y lo dice en su salida; si no la editó, **archiva la versión anterior** (si su huella aún no estaba archivada; si ya lo estaba, p. ej. por la de encuestas, no se duplica), agrega el párrafo al final de la sección 2 y **archiva la nueva** con su huella. Repetible.
- **Aviso para el administrador** cuando la política no la trae: `GET /api/puerta-a-puerta/politica` (solo administrador) → `{ incluye, editada, existe, parrafo }`. Lo muestra un recuadro en **Configuración → Política de privacidad** (`contenido.html`, con el párrafo para pegar al final de la sección 2) y un aviso en la pantalla **Puerta a puerta** (`puerta-listas.html`). Se va solo en cuanto la política trae la frase. No bloquea armar listas.
- **Salvedad:** `actualizado_por` tiene `ON DELETE SET NULL`. Si la cuenta del administrador que editó la política se borrara, esa política pasaría a verse «sin editar» y la próxima corrida de `init-db` le agregaría el párrafo (al texto vigente, archivando antes la versión anterior).
- **Autorizaciones anteriores — NOTA PARA EL ABOGADO (decisión suya, NO implementada):** quienes autorizaron antes de que existiera esta finalidad no la conocían. `votantes.consentimiento_version` guarda la huella de la política que se les mostró, así que se podría exigir que solo entren en una lista las fichas cuya versión ya mencione la visita (dejaría el módulo vacío hasta renovar autorizaciones). Por orden del dueño **no se filtra por versión de política por ahora**. Otros dos puntos para el abogado: «interesado» bordea la opinión política (dato sensible, Ley 1581, art. 5) aunque no se escriba en la ficha, y los días previos a la elección no se bloquearon.

### «Volver a permitir visitas» (segunda orden)
- **Botón en la ficha del votante** (`votantes.html`, junto a la baja de mensajes; **solo el administrador**): si la ficha tiene `no_visitar`, dice «Pidió no recibir más visitas (desde el …)» y el administrador ve **«Volver a permitir visitas»** (`public/js/permitir-visitas.js`, en la coraza del service worker). El coordinador ve la línea pero no el botón.
- **Servidor:** `POST /api/puerta-a-puerta/votantes/:id/permitir-visitas` (solo administrador; 403 a los demás). **Motivo obligatorio** (≥ 5 letras, p. ej. «el ciudadano lo pidió») y **fecha obligatoria** (el día en que el ciudadano lo pidió: ni futura ni anterior a cuando pidió no volver). 404 si la ficha no existe o no es de su campaña; 409 si no tiene la marca. Quita `no_visitar` y `no_visitar_fecha`; **no toca `no_contactar`**. **Auditoría** `votante_permitir_visitas` con quién, el motivo y las dos fechas (sin el nombre).
- La persona vuelve a poder entrar en una lista **cuando pasen los 60 días de su última puerta cerrada** (la regla de «visitas repetidas» sigue en pie; si no tuvo visita, entra de inmediato).

### Pruebas (cada suite sobre una base desechable nueva; mysqld privado, ya apagado y borrado)
- **`probar-puerta-a-puerta.js` (nueva, 187):** migración y módulos apagados; lista cerrada de columnas de las tres tablas (sin hora, sin ubicación, sin identidad); reglas puras (franja con bordes, las 24 horas, caducidad, elección) y el puerto de `ordenarPorCercania` contra el original en 3.000 casos; permisos en los dos módulos y cada nivel; aspirante fuera; `alcanceDeUsuario` contra `calcularAlcance`; armar (sublíder solo lo suyo, omitidas por motivo, visitas repetidas, zona, tope); la lista mínima (columnas cerradas, sin secretos, cerradas sin persona); re-validación al leer; franja 08:00 incluida / 18:00 excluida y configurable; 3 intentos con 24 h; idempotencia (también en carrera); `no_visitar` no toca `no_contactar` y la casilla sí; 60 días; cerrar/cancelar; día de la elección por fecha de captura; auditoría; retención; código del celular; segunda corrida de init-db; la finalidad en la política (sin editar: se agrega y archiva; editada: no se toca y el aviso lo dice; una versión anterior sin archivar se archiva); «Volver a permitir visitas» (403 a quien no es administrador, motivo y fecha obligatorios, 409/404, no toca `no_contactar`, auditoría, la persona vuelve a entrar en una lista). La de Chromium agrega el botón (solo administrador) y el diálogo.
- **`probar-puerta-a-puerta-celular.js` (nueva, 56, Chromium real, hora fija):** ruta por cercanía, GPS solo en memoria (ninguna petición lo lleva), copia sin secretos y con dueño, cola sin nombre ni dirección, subida única, rechazo que queda «fallido» (Reintentar/Descartar), «pidió no volver» con y sin mensajes, fuera de franja y elección también sin señal, caducidad 47/49 h, cambio de cuenta.
- **Ajustadas** (fijaban la versión): `probar-encuestas` (IndexedDB 9 o 10; service worker v177–v179), `probar-solicitudes` y `probar-logistica`; `scripts/capturas/servidor.js` monta la ruta nueva.
- **Regresión, 22 suites, todas bien, DOS veces** (la primera con el zip de 19 archivos; la segunda tras la segunda orden). `probar-manuales` falló a la primera por los bloques de manual que faltaban; ya están y pasa. No se corrió `probar-instalacion-limpia` (pide base y usuario de CloudPanel).

### Lo que NO se hizo
- **Base: el 309 regenerado YA está aplicado** (9 de noviembre de 2026, el usuario como root; salida pegada). `init-db` terminó en «Listo» con todo «ya existía» (repetible, comprobado en vivo) y `reiniciar-instancia.sh` dio «OK: pid 3628150 -> 3643873 y el puerto 3002 responde»; desde esta cuenta, el proceso tiene minutos de vida. La primera corrida (la del primer 309) había creado lo de los parches 303 a 308 y agregado a la política de la Base las finalidades de solicitudes (`36000dd9d4356c93`) y de encuestas (`f0e96722ddabfdda`).
  **La finalidad de las visitas NO quedó en la política de la Base, y es el comportamiento diseñado:** `init-db` dijo «la editó el administrador, así que NO se agregó». Medido en la Base: `actualizado_por` no es NULL (alguien guardó la política desde la pantalla; última vez el 8 de noviembre de 2026 a las 21:11), no trae la frase `visita domiciliaria de la campaña`, y **conserva 9 marcadores entre corchetes sin llenar** (nombre del responsable, NIT, correo, teléfono, fecha…). **Pendiente del administrador de la Base:** abrir Configuración → Política de privacidad —debe mostrar el recuadro ámbar con el párrafo— y pegarlo al final de la sección 2. Esto es lo que el aviso nuevo está hecho para cubrir; no se comprobó con un navegador contra la Base.
- No se generó la plantilla v309 (la vigente sigue siendo la v308).
- Sin precampaña nueva ni guion (Fase 3), sin mapa (Fase 2), sin panel de cobertura (Fase 4).

## Parche 308 — Encuestas internas, Fases 3 y 4 + arreglos de las colas sin señal (9 de noviembre de 2026, publicado y registrado INACTIVO, TOCA LA BASE)

**Requiere el 307.** Service worker `v178`. Sigue todo **apagado de fábrica**: los resultados son del módulo `encuestas`; Calidad, Textos libres y el mínimo por celda son solo del administrador.

**Cómo se publicó** (ya hecho). Con `su - gariasappelectoral`, como se pidió (dos comandos cortos, de a uno; el segundo registra INACTIVO y firma):

```
su - gariasappelectoral -c 'cd /home/appestrategia-electoral/htdocs/electoral.appestrategia.net && bash scripts/publicar-parche.sh 308'
```
```
su - gariasappelectoral -c 'cd /home/appestrategia-electoral/htdocs/electoral.appestrategia.net && "$(ls -d /home/appestrategia-electoral/.nvm/versions/node/*/bin/node | sort -V | tail -1)" scripts/registrar-parche.js 308 "Encuestas internas, Fases 3 y 4: resultados con mínimo por celda, calidad y arreglos de las colas sin señal (Requiere el 307)" "Resultados de las encuestas agregados por zona y pregunta con mínimo de 5 respuestas por celda y Otras zonas, cobertura frente a los votantes, cuotas y Excel con la marca Uso interno no publicable. Control de calidad con señales de respuestas sospechosas, revisión del administrador y cola de textos libres. Finalidad de las encuestas en la política de privacidad. Arregla las colas sin señal: sincronizarCola no borra ante un 401, api pone error.status y Mis tareas deja lo rechazado visible. Toca la base de datos."'
```

El guion de publicar debe terminar con la misma huella que la local (`c016133c24f23572`) y el registro con `toca_base_datos = true`.

### Arreglos de las colas sin señal (primero, como se pidió)
1. **`sincronizarCola` (`public/js/offline-utils.js`) ya no borra ante un 401.** Cuando la sesión vence, `api()` redirige al login y **devuelve `undefined`** en vez de lanzar; la función lo tomaba por éxito y borraba el registro —trabajo de campo sin subir—. Ahora **solo se borra lo que el servidor confirmó** (un objeto, o `null` si no hay cuerpo); `undefined` detiene la subida y todo queda pendiente. Un error de red también (ya era así). Además, **429, 408, 502, 503 y 504 ya no marcan «fallido»**: se dejan en espera y se reintentan en la siguiente subida (`ESTADOS_TRANSITORIOS`). Lo demás (400, 409, 422, 500…) sigue marcándose «fallido» y **nunca se borra**. **Aplica a todas las colas que la usan:** votantes, estructura, reportes del Día D, marcas «ya votó», check-in, transporte, logística, solicitudes y tareas. La cola de encuestas (`encuestas-cola.js`) usa el mismo criterio.
2. **`api()` (`public/js/api-core.js`) pone `error.status` y `error.datos`** (la de `common.js`, del escritorio, ya lo hacía). Esto **cambia lo que hacían dos pantallas**: `mis-tareas.html` y `mis-solicitudes.html` tenían una rama `e.status === 403` que **nunca se ejecutaba**; ahora sí. En «Mis tareas» había un segundo defecto: aunque la rama se ejecutara, `pintar()` la tapaba con «No tienes tareas asignadas»; ahora se recuerda (`sinAcceso`) y dice «Tu tipo de usuario no tiene habilitadas las tareas». Se revisó todo uso de `.status` en `public/`: no hay otro que dependa de esto.
3. **«Mis tareas»: un rechazo del servidor queda «fallido»**, visible en «En este celular, sin subir», con su motivo, **Reintentar** y **Descartar** (antes se borraba al mostrar el error). Probado: una acción sobre una tarea que se canceló mientras tanto se rechaza, sigue en IndexedDB, **Reintentar** la vuelve a intentar y Descartar la quita.

### Fase 3 — Resultados
- **`lib/alcanceEncuestas.js`** (hermana de `alcanceSolicitudes`, sin reutilizar `alcanceVotantes`): administrador toda la campaña madre; coordinador sus líderes, los sublíderes de estos y lo suyo; líder lo suyo y de sus sublíderes; sublíder lo suyo; cualquier otro rol lo que él aplicó; las respuestas de la rama de un aspirante no las ve la madre. **El mínimo se aplica DESPUÉS del alcance**: un líder con 3 respuestas propias en una zona la ve omitida.
- **`lib/encuestasResultados.js`**: agregados **por zona y pregunta**, solo con las respuestas `revision = 'ok'`. Opción única y múltiple: cuántas personas por opción y %; escala: distribución 1-5 y promedio; número: **promedio y mediana, nunca mínimo ni máximo**; todas: «no sabe / no responde». **Los textos libres no entran** (la pregunta de texto dice «sin agregado»).
- **Mínimo por celda: 5, configurable solo hacia arriba (hasta 1.000), igual para el administrador** (`PUT /api/encuestas/config`, solo el administrador, auditado `encuesta_config`; 400 por debajo de 5). Es `configuracion_campana.encuesta_min_celda`; el servidor además nunca usa menos de 5 aunque la columna diga otra cosa.
- **«Otras zonas» para que no se pueda restar:** las celdas chicas se agrupan; el grupo se muestra solo si suma el mínimo; si no llega, **se le suma la celda visible más pequeña**, y así hasta llegar; si ni todas juntas llegan, **no se muestra nada, ni el total**. La propiedad se probó con **2.000 casos al azar** (lo visible nunca es menor que k; «Otras zonas» suma al menos k; nada se pierde; total − visibles nunca queda entre 1 y k−1). **Las celdas omitidas están a la vista** («3 celdas con menos de 5 respuestas se agruparon…») sin decir cuáles.
- **Sin filtros por fecha ni por aplicador, a propósito:** dos consultas que difieren en un día o en una persona podrían restarse y dejar al descubierto a UNA respuesta. Lo único que cambia la vista es el alcance y el nivel de agrupación (`agrupar=zona|padre`, para juntar barrios chicos en su comuna: dos barrios de 3 respuestas no llegan solos, juntos —6— sí).
- **Cobertura frente a votantes registrados:** por zona, respuestas contra votantes (con el alcance de quien mira, `condicionAlcanceVotantes`, y la zona **con sus descendientes**), % de la muestra contra % de los votantes y respuestas por cada 100; marca **sobre / sub / parejo** (razón ≥ 1,5 o ≤ 0,5). Las zonas chicas se agrupan con la misma regla. **Los votantes se cuentan UNA vez** aunque dos zonas se solapen (comuna y municipio).
- **Cuotas por zona, opcionales** (`encuesta_cuotas`; `GET/PUT /:id/cuotas`; «Editar» para fijarlas): meta entera de al menos el mínimo por celda, de una zona del catálogo (nivel vigente); la cuota de una comuna cuenta sus barrios. **El avance exacto solo se muestra si llega al mínimo** («menos de 5» si no). No son parte de la versión congelada.
- **Excel agregado** (`GET /:id/exportar`): solo con la casilla **Importar / Exportar** (ahora registrada para `encuestas`; de fábrica solo el administrador; el administrador la tiene siempre), con **auditoría** `exportar_excel`. Cuatro hojas —Notas, Resultados, Cobertura, Cuotas—, **la marca «Uso interno – no publicable» como primera fila de CADA hoja** y en las propiedades del libro, y la hoja de notas dice qué es, cuántas respuestas, el mínimo, cuántas quedaron fuera por revisión, que es agregado y que es una muestra de conveniencia. Sin textos libres, sin aplicadores, sin detalle por respuesta (no hay equivalente del `/exportar/detalle` de solicitudes).
- **Pantalla** (`public/encuestas.html`): bajo el editor, de una encuesta publicada o cerrada, pestañas **Resultados** (con la franja, el mínimo, tablas por pregunta, cobertura, cuotas y el botón de Excel), **Cuotas por zona**, y —solo el administrador— **Calidad** y **Textos libres**.

### Fase 4 — Calidad (`lib/encuestasCalidad.js`)
- **Señales**, calculadas al registrar cada respuesta (nunca se le muestran a quien aplica: la respuesta del servidor sigue siendo solo `{ok, id, duplicado}`): **ritmo** (8 o más respuestas del mismo aplicador en cualquier tramo de 10 minutos, por la hora de **CAPTURA**, y marca todas las del tramo, también las que ya estaban: probado subiéndolas en desorden y probado que 9 tomadas cada 20 minutos y subidas juntas **no** son sospechosas); **duración** (menos de 2 s por pregunta, mínimo 5 s, o menos de la cuarta parte de la mediana de las demás con al menos 10 de muestra); **misma opción** (4 o más únicas con la misma posición, o 4 o más escalas con el mismo valor); **vector repetido** (3 o más idénticas del mismo aplicador, huella sin textos: la tercera marca las tres); **celda lejos** (a más de 15 km del centro de las demás de su zona, con al menos 5 de comparación); **zona ajena** (la zona ni está dentro de los territorios de quien aplica ni los contiene; solo si esa persona tiene territorios).
- **Sospechosas fuera de los agregados hasta revisión:** `revision` = `ok` | `sospechosa` | `excluida`. El administrador **aprueba**, **excluye** o **restaura** (`POST /:id/calidad/revisar`, hasta 500 a la vez): todo **reversible** y **auditado** (`encuesta_revisar_aprobar|excluir|restaurar`). Una respuesta que el administrador ya aprobó **no se vuelve a marcar** (`revisada_por`).
- **Panel por aplicador, solo del administrador y sin respuestas:** cuántas, cuántas sospechosas/excluidas, % fuera, mediana de lo que tarda, qué señales le saltan y entre qué días. La lista de respuestas por revisar trae aplicador, zona, hora de captura, segundos y señales: **ni una opción, valor ni texto** (probado con un texto «secreto»).
- **Cola de revisión de textos libres, solo del administrador:** el texto, su pregunta, la zona y el día —**sin aplicador y sin hora**—. **Conservar** lo marca visto; **Borrar** lo borra para siempre (`encuesta_texto_borrar|conservar`, auditados). Los textos nunca salen de esa cola.
- **Finalidad de las encuestas en la política de privacidad** (`agregarFinalidadEncuestas`, como la de solicitudes): un párrafo al final de la sección 2 —anónimas y voluntarias, sin nombre ni cédula ni teléfono, solo agregadas, no se publican, zona aproximada, textos y ubicación se borran pasado el plazo— y **nueva versión archivada con su huella** (`f0e96722ddabfdda` en la base de pruebas). Repetible: la segunda corrida no agrega nada.

### Pruebas (cada suite sobre una base desechable nueva; mysqld privado, ya apagado y borrado)
- **`probar-encuestas-resultados.js` (nueva, 120, repetible):** migración 308 y política; el mínimo (unidad y propiedad de 2.000 casos); alcance con los seis roles; agregados por tipo con las cuentas verificadas a mano; mínimo 5/10/17; solo las «ok»; agrupar por la zona que contiene; cobertura y sesgo; cuotas y sus errores; Excel (hojas, marca en cada una, sin textos, casilla, auditoría); las seis señales una por una; aprobar/excluir/restaurar; panel y listas sin respuestas; cola de textos.
- **`probar-encuestas-celular.js` (ampliada, 92):** lo nuevo es la sección [10] (`sincronizarCola` con ocho casos: 401, red, 429, 503, 400, 500, éxito con y sin cuerpo; `error.status`; el 403 en «Mis tareas» y «Mis solicitudes»; el rechazo de «Mis tareas» con Reintentar y Descartar) y la [11] (la pantalla de resultados: tablas, cobertura, Excel solo con la casilla, Calidad y Textos libres solo del administrador, borrar un texto, agregar una cuota).
- **`probar-encuestas.js` (203):** la lista cerrada de columnas ahora incluye las del 308 (siguen sin existir nombre, cédula, teléfono, `votante_id` ni GPS crudo) y las cinco tablas.
- **Regresión, 20 suites en total, todas bien:** las 16 de siempre —`probar-solicitudes` (+ `-seguimiento`, `-celular`), `probar-tareas` (+ `-metas`, `-celular`), `probar-eventos-alcance`, `probar-recordatorios` (esta vez sin el fallo de tiempo), `probar-panel-lider`, `probar-panel-alcance`, `probar-logistica`, `probar-comunas-dashboard`, `probar-inscripcion-enlace`, `probar-transporte-diad`, `probar-transporte-parte2`, `probar-manuales` y `probar-ordenar-select`— más las tres de encuestas. `probar-instalacion-limpia` no se corrió (pide base y usuario de CloudPanel).
- El zip: md5 de cada archivo contra el disco, sin diferencias; `verificar-requires.js`: «TODO RESUELVE»; `node --check` de cada `.js`.

### Pendientes / decisiones a tener en cuenta
- **«Celda incompatible con la zona» se mide contra las demás respuestas de esa zona**, no contra el polígono de la zona: el catálogo de la campaña no trae coordenadas. Necesita 5 de comparación; las primeras respuestas de una zona no se pueden juzgar así.
- **«Zona fuera de la rama»** usa los territorios de la estructura (`estructura.territorio_id` y `estructura_territorios`). Quien no tiene territorios (administrador, coordinadores sin zona) nunca la dispara.
- **Los umbrales** (8 en 10 minutos, 2 s por pregunta, 4 opciones, 3 vectores, 15 km) son constantes de `lib/encuestasCalidad.js`, no configuración. Si resultan altos o bajos en campo, es cambiar un número.
- **Las señales se calculan al llegar la respuesta:** las respuestas del 307 que ya estaban en la base quedan `ok` sin evaluar (no hay reevaluación masiva).
- **La fila `configuracion_campana` id = 1 tiene que existir** para que `PUT /config` guarde (el resto de la aplicación ya lo da por hecho); sin ella el mínimo vale 5.
- **Quien aplica ve todas las encuestas publicadas:** no hay asignación de una encuesta a ciertos líderes o zonas todavía. Tampoco ve las cuotas (a propósito: sabría dónde «faltan» y sesgaría dónde aplica).
- **La ley de encuestas de 2025** sigue sin estar en `legislacion/` ni verificada (ver «Parche 307»).
- La retención de textos y celdas usa el plazo de **solicitudes** (`anonimizar_solicitudes_meses`); confirmado que se **borran textos y celdas y se conservan las cifras**.
- **Fuera de alcance, sin tocar:** `faltantes.html` y `dia-d.html` tienen sus propios botones para descartar de la cola (acciones de la persona, no borrados automáticos): no cambian.

## Parche 307 — Encuestas internas, Fases 1 y 2 (9 de noviembre de 2026, publicado y registrado INACTIVO según el usuario, TOCA LA BASE)

**Requiere el 306.** Service worker `v177`. Cola sin señal: `OFFLINE_DB_VERSION = 9`. Todo vive en **dos módulos nuevos de la matriz, APAGADOS de fábrica** (solo el administrador): `encuestas` (construir) y `encuestas_campo` (aplicar en el celular). Quien aplica no ve resultados; los resultados son la Fase 3.
Más dos arreglos de Solicitudes que se pidieron aparte (abajo, «Solicitudes»).

**Para publicarlo (lo corre el usuario, como root, en el servidor).** Dos comandos cortos, de a uno:

```
cd /home/appestrategia-electoral/htdocs/electoral.appestrategia.net && bash scripts/publicar-parche.sh 307
```
```
cd /home/appestrategia-electoral/htdocs/electoral.appestrategia.net && "$(ls -d /home/appestrategia-electoral/.nvm/versions/node/*/bin/node | sort -V | tail -1)" scripts/registrar-parche.js 307 "Encuestas internas, Fases 1 y 2: constructor y campo sin señal (Requiere el 306)" "Nuevos módulos encuestas y encuestas_campo, apagados de fábrica. Constructor de encuestas anónimas con versión congelada, aplicación en el celular sin señal (OFFLINE_DB_VERSION 9), zona con degradación, bloqueo el día de la elección y retención de textos y celdas. Arregla en Solicitudes la lista de zonas y que un rechazo no se borre de la cola. Toca la base de datos."
```

Nace INACTIVO: ninguna instalación lo descarga hasta que se active en el panel. El guion `publicar-parche.sh` debe terminar con la misma huella que la local (`e06ac395d77e9146`) y el registro con `toca_base_datos = true`.

### Lo que se hizo (las decisiones de la Fase 0, tal como se aprobaron)
- **Anónimas por construcción** (`db/init-db.js`, 4 tablas: `encuestas`, `encuesta_preguntas`, `encuesta_respuestas`, `encuesta_respuesta_items`). Las tablas de respuestas **no tienen** nombre, cédula, teléfono, `votante_id`, IP ni GPS crudo. Lo único «de alguien» es `aplicada_por`: la cuenta del equipo. **La prueba automática** (`probar-encuestas.js`, sección 2) compara las columnas de las cuatro tablas con una **lista cerrada** (agregar una a mano la rompe), con una lista negra de nombres de identidad y revisa que ninguna llave foránea apunte a votantes o solicitudes. Nunca se liga a una persona: no hay camino «con autorización».
- **Constructor** (`lib/encuestas.js`, `routes/encuestas.routes.js`, `public/encuestas.html`): borrador → publicada → cerrada, duplicar y eliminar borrador. Tipos: opción única, múltiple, escala 1-5, número (mín/máx) y texto corto; hasta 40 preguntas y 12 opciones. **«No sabe / No responde» es automático** en toda pregunta menos la de texto (no se guarda: se agrega sola; si el autor la escribe, se quita). **«Sensible» y «obligatoria» se excluyen** (400 al guardar; en pantalla la casilla se deshabilita). Una encuesta con alguna pregunta sensible **no admite texto libre**.
- **Versión congelada:** al publicar se calcula una huella (sha256 del contenido, 16 caracteres) y la encuesta **no se edita** (409; la función que guarda también se niega, no solo la ruta). Las preguntas con respuestas no se pueden borrar (llaves RESTRICT). Para cambiar algo: **duplicar** como borrador. La huella se **recalcula al servir**: si alguien tocó las preguntas por fuera, esa encuesta no se sirve al celular ni recibe respuestas (probado). *No hay tabla `encuesta_versiones`:* las preguntas publicadas son inmutables y la huella basta; una tabla aparte habría sido una segunda copia que podría desviarse.
- **Reglas electorales** (`lib/encuestasReglas.js`): **precampaña** envolviendo `propagandaPermitida` y `palabraProhibida` de los recordatorios (sin tocarlos) y agregando el nombre del candidato (completo y cada palabra de 4 letras o más), «candidato», «partido(s)», «apoyo», «favorabilidad» e «imagen»; el mensaje dice **qué palabra** lo causó y dónde. Se evalúa al **publicar**, al **servir** (si borran la fecha permitida, la encuesta queda *suspendida*) y al **recibir cada respuesta, con su fecha de captura**. Lo que habla de política **hay que marcarlo sensible** o no se publica. **El día de la elección no se aplica ninguna encuesta** (más estricto que la Ley 996, art. 28: cubre todas, no solo las electorales): el servidor sirve la lista vacía con `bloqueo`, rechaza lo capturado ese día y el celular lo bloquea también sin señal con la fecha guardada en su copia.
- **Zona obligatoria con degradación** (`lib/zonas.js`, ampliado): `listaDeZonas` y `resolverZonaDeCampo`. Nivel **zona** (barrios, veredas, comunas y corregimientos) → **municipio** → **texto**. Con zonas finas, el municipio ya no vale como zona. La lista (hasta 2.500) se guarda en el celular para elegir sin señal.
- **Ubicación: solo la celda de 0,005°.** El celular manda los índices de la celda, nunca latitud ni longitud (comprobado sobre lo que queda en IndexedDB); el servidor guarda el centro (`celda_lat`, `celda_lng`, `DECIMAL(8,4)`) y solo si la encuesta la pide. Opcional y nunca bloquea.
- **Sin señal** (`public/js/offline-utils.js`, `public/js/encuestas-cola.js`): `OFFLINE_DB_VERSION = 9` con dos cajones: `encuestas_pendientes` (COLA, con dueño: otra cuenta del mismo celular no la ve ni la sube y no se borra al cambiar de cuenta) y `encuestas_cache` (COPIA de lectura por usuario: se borra al cambiar de cuenta; **está en las DOS listas**, `offline-utils.js` y `cuentas-dispositivo.js`, que están duplicadas a propósito). Idempotente por `cliente_uuid` (también en carrera: dos envíos a la vez dejan una fila). La hora que cuenta es la del toque, acotada a **7 días** y sin pasar del futuro; **lo capturado antes de cerrar la encuesta se acepta aunque suba después**.
- **Un rechazo NO se borra:** queda «fallido», visible en «Encuestas» con su motivo, **Reintentar** y **Descartar**. La cola de encuestas **no usa `sincronizarCola`** (ver «Pendientes»).
- **Retención:** `anonimizar_solicitudes_meses` (6) meses después de la fecha de la elección se **borran los textos libres y las celdas de ubicación** de las encuestas, en la **misma vuelta diaria** de las solicitudes (`lib/solicitudesMantenimiento.js`, apunte `encuesta_anonimizar_auto`, sin usuario). **Interpretación a confirmar:** «retención de respuestas» se tomó como en Solicitudes —se quita lo que podría identificar y se **conservan las cifras sin texto ni ubicación** (opciones, escalas, números)—, no como borrar las respuestas enteras.
- **Pantallas:** `public/encuestas.html` (constructor, escritorio), `public/app/encuestas-campo.html` (lista y cola) y `public/app/encuesta-aplicar.html` (una pregunta por pantalla, 360 px). Las tres llevan «Uso interno – no publicable». La encuesta a aplicar viaja por `sessionStorage` y no por `?id=` porque la caché del service worker distingue por dirección completa. Tarjetas en `inicio.html` (líder/coordinador: «Aplicar una encuesta»; administrador: también «Encuestas internas») y entrada en el menú del escritorio. El aspirante con sublicencia no llega (la ruta no está en `PERMITIDOS`; probado).
- **Guías de Ayuda:** `mod-encuestas`, `mod-encuestas_campo`, `t-encuesta-crear` y `t-encuesta-aplicar` (174 bloques en total, sin avisos).

### Solicitudes (pedido aparte)
- **(a) Zonas:** `solicitud-nueva.html` pedía todo `/territorial/territorios` y se quedaba con `barrio` y `vereda`; una campaña con comunas y sin barrios veía la lista vacía. Ahora usa `GET /api/solicitudes/zonas-lista` (la **misma** degradación). Dos zonas con el mismo nombre se distinguen con su padre («La Esperanza · Chinchiná»). *La orden decía «la misma degradación que Tareas»:* el código de Tareas (`buscarZonas`) tiene los cuatro tipos y texto, pero **no** el nivel municipio; ese nivel se agregó en `lib/zonas.js` para Solicitudes y Encuestas, y **Tareas no se tocó**.
- **(b) Rechazo:** la pantalla de registro **borraba de la cola** lo que el servidor rechazaba. Ahora queda «fallido» y la pantalla manda a «Mis solicitudes», que ahora ofrece **Reintentar** además de Descartar. Probado en Chromium: la solicitud rechazada sigue en IndexedDB.

### Pruebas (cada suite sobre una base desechable nueva; mysqld privado, ya apagado y borrado)
- **`probar-encuestas.js` (nueva, 202 comprobaciones, repetible):** migración y módulos apagados; **esquema anónimo contra lista cerrada**; permisos de los dos módulos en cada nivel y para el aspirante; constructor (validaciones, NS/NR, ids estables, duplicar, eliminar); precampaña con cada palabra y con el nombre del candidato; congelado, huella y manipulación por fuera; zona en sus tres niveles; lista del celular, día de la elección y encuesta suspendida; registrar una respuesta (idempotencia también en carrera, cada validación, texto libre, celda, atribución al líder y sublíder, ventana de captura, cierre, elección y precampaña por fecha de captura); retención y su enganche en la vuelta diaria; código del celular y service worker.
- **`probar-encuestas-celular.js` (nueva, 68, Chromium real):** lista y copia con dueño; aplicar con señal (zona, obligatorias, límites, texto con teléfono, ubicación como celda); sin señal (cola con dueño y sin coordenadas); otra cuenta; vuelve la señal (una vez); **rechazo que no se borra** (con Reintentar y Descartar); día de la elección con y sin señal; Solicitudes (zonas y rechazo); constructor del escritorio (la palabra que impide publicar, sensible ⇒ no obligatoria, publicar congela, duplicar, eliminar).
- **Regresión, 16 suites:** `probar-solicitudes` (+ `-seguimiento`, `-celular`), `probar-tareas` (+ `-metas`, `-celular`), `probar-eventos-alcance`, `probar-recordatorios`, `probar-panel-lider`, `probar-panel-alcance`, `probar-logistica`, `probar-comunas-dashboard`, `probar-inscripcion-enlace`, `probar-transporte-diad`, `probar-transporte-parte2`, `probar-manuales` y `probar-ordenar-select`: todas bien. Dos ajustes de prueba, no de código: `probar-solicitudes.js` fijaba `OFFLINE_DB_VERSION` en 7 u 8 (ahora acepta 9); `probar-recordatorios.js` falló **dos** veces (una en paralelo con otras suites y otra justo después) en «la campaña terminó en enviado» —duerme 1,8 s y la máquina iba cargada— y pasó **3 de 3** corridas siguientes y también en el HEAD limpio: es una prueba sensible al tiempo, sin relación con este parche. `probar-instalacion-limpia` no se corrió (pide base y usuario de CloudPanel).
- El zip: md5 de cada archivo contra el disco, sin diferencias; `verificar-requires.js`: «TODO RESUELVE» (95 `require`); `node --check` de cada `.js` del zip.

### Pendientes / lo que no se hizo
- **Fase 3 (siguiente orden): resultados.** `lib/alcanceEncuestas.js` (hermano de `alcanceSolicitudes`), agregados por zona y pregunta con **mínimo por celda 5 (configurable solo hacia arriba, igual para el administrador)** y «Otras zonas» para que los totales no permitan restar, panel con cobertura y el **Excel agregado con la marca «Uso interno – no publicable»**. Ese Excel traerá la casilla «Importar / Exportar» de `encuestas` (**no está registrada todavía** en `config/importarExportar.js`: una casilla sin nada que exportar sería una casilla que miente) y la columna `configuracion_campana.encuesta_min_celda` (tampoco existe aún).
- **Fase 4: control de calidad** (ritmo y duración, mismo vector de respuestas, zona ajena a la rama, `revision` ok/sospechosa/excluida, panel por aplicador sin respuestas) y cuotas por zona. `duracion_seg` y `aplicada_por` ya se guardan para eso. Como las respuestas son anónimas, **no hay contra-llamada** para verificarlas: solo señales.
- **Aviso legal por revisar:** la Ley 996 de 2005 (art. 28) y la Ley 130 de 1994 (art. 30) están en `legislacion/`; **no encontré una ley de encuestas de 2025** en esa carpeta y no la verifiqué. Si existe, puede haber modificado el art. 28: que un abogado lo confirme antes de poner mensajes legales en pantalla.
- **Defectos que NO se corrigieron fuera de las encuestas** (descubiertos al leer): (1) `sincronizarCola` (`offline-utils.js`) toma por éxito el `undefined` que devuelve `api()` ante un 401 y **borra el registro**: afecta a TODAS las demás colas (votantes, solicitudes, tareas…). (2) `api()` no pone `error.status`, así que `mis-tareas.html` y `mis-solicitudes.html` (`e.status === 403`) nunca entran en esa rama. (3) `mis-tareas.html` también borra de la cola lo rechazado tras mostrar el error, igual que hacía Solicitudes. Los tres son arreglos pequeños; no se tocaron porque no se pidieron.
- La retención de textos usa el plazo de **solicitudes** (`anonimizar_solicitudes_meses`): si se quiere un plazo propio para las encuestas, es una columna más.
- Quien aplica ve **todas** las encuestas publicadas: no hay asignación por zona o por persona (una encuesta para ciertos líderes) todavía.

## Parche 306 — Tareas, Fases 3 y 4 (8 de noviembre de 2026, publicado y registrado INACTIVO, TOCA LA BASE)

**Requiere el 305.** Service worker `v176`. Todo vive dentro del módulo `tareas`, que sigue **apagado de fábrica**; los avisos y recordatorios nuevos solo llegan a quien tenga ese módulo.

**1. Meta de registros** (`lib/tareasMetas.js`, `lib/zonas.js`). Tipo nuevo, con `meta_n`, `desde` (por omisión hoy) y `fecha_limite` obligatoria (= hasta). Zona opcional: del catálogo y puede ser un **municipio** (las demás tareas no admiten municipio); una zona solo escrita a mano se rechaza (no se puede medir).
- **La cuenta es la del panel del líder:** `condicionAlcanceVotantes` con el alcance del **RESPONSABLE** (no el de quien mira) + `created_at` entre `desde` y `hasta` (días completos) + la zona **y sus descendientes** + **sin las fichas por enlace sin confirmar** (`origen = 'enlace_lider'` y sin `consentimiento_confirmado_en`). Con todo confirmado y todo el periodo, la cifra es **exactamente** `meta.inscritos` del panel de ese líder y del sublíder; con 2 sin confirmar, es `inscritos − por_enlace_sin_confirmar` (probado contra `/api/panel-lider`). Una cuenta inactiva no se mide (`null`).
- **Función compartida de zonas:** `zonaYDescendientes(territorio_id)` (CTE recursiva sobre `padre_id`, tope 6 niveles). Una comuna trae sus barrios; **en el catálogo nacional las veredas cuelgan del MUNICIPIO**, así que la comuna NO las trae y el municipio sí. Una zona que no existe en la vista da **0, nunca «todo»**.
- **«Hecha» sola** al llegar a la meta (`cerrarMetasAlcanzadas`): la corre un reloj de 5 minutos y también quien abre «Mis tareas» o el detalle (no espera al reloj). Escribe `hecha_nota` («Llegó a la meta: X de Y registros.») y un apunte en el historial **sin usuario** («Automático»). **No requiere verificación** (`TIPOS.meta_registros.medible = true`): no cuenta como «por verificar», verificarla es opcional, **no se puede terminar a mano (409) ni devolver (409)**; sí «empecé» y «no pude». Registros que lleguen después de `hasta` no cuentan.

**2. Reunión enlazada a un evento.** `evento_id`; el evento debe estar en el **alcance de eventos del 305** de quien crea (y quien crea necesita «Ver» en eventos, agenda o asistentes a reuniones: 403 si no) y tener `meta_asistentes > 0`. El avance es `asistio = 1` contra `meta_asistentes` y **solo lo ve quien puede ver el evento** (si no, `avance: null` y la pantalla lo dice); trae solo cifras y el título del evento, **ningún asistente**. **No se cierra sola:** la termina quien la tiene (sin evidencia obligatoria) y se verifica como cualquiera. `GET /api/tareas/eventos` ofrece los eventos elegibles (los de su alcance, con meta, de hace menos de 30 días en adelante).

**3. Panel, mapa y Excel** (`lib/tareasPanel.js`; pestañas en `tareas.html`). Mismo alcance que la lista. **Cumplimiento** = (hechas + verificadas) / (todas menos las canceladas), por **zona**, por **persona** (el responsable, gente del equipo) y por tipo, con abiertas, vencidas y por reasignar; filtros por fecha y tipo. **Mapa:** celdas de 0,005° (~550 m), solo el **centro de la celda**, la cuenta y cuántas por tipo; sin nombres, títulos, fotos ni puntos exactos. **Excel** `GET /exportar/cumplimiento` (zona × tipo × estado) **sin nombres de nadie**, para quien tenga **Importar / Exportar** en `tareas` (casilla nueva en la matriz; de fábrica solo el administrador), acotado a su alcance y con auditoría (`exportar_excel`).

**4. Tareas por reasignar** (`lib/tareasHuerfanas.js`, bandeja «Por reasignar»). Una tarea **abierta o hecha** queda marcada (`huerfana_desde`, `huerfana_motivo`) cuando: la cuenta del responsable se **desactivó** (`cuenta_inactiva`), el responsable ahora cuelga de **otra rama** de aspirante (`otra_campana`), o quien la asignó (coordinador o líder, con cuenta activa) **ya no podría asignársela** hoy (`fuera_de_rama`: cambió de supervisor o dejó la estructura). **NADA se reasigna solo** (el código de la revisión no contiene ninguna reasignación; probado). Se avisa **por push a quien la asignó, una vez por tarea**, y el aviso dice **cuántas** («Tienes 2 tareas por reasignar…»), nunca títulos ni nombres. La bandeja (`GET /por-reasignar`, pestaña con contador) se acota con el alcance de **gestión**: la ven quien la asignó, su coordinador y el administrador; reasignar es el `PUT /:id` de siempre (una **hecha** se devuelve o verifica antes) y sale de la bandeja. Si el motivo desaparece (reactivan la cuenta, vuelve a su equipo), la marca se quita sola y queda escrito. **Cuándo se revisa:** cada 5 minutos (`lib/tareasMantenimiento.js`) y de inmediato tras **editar o cambiar el estado de una cuenta** (`routes/usuarios.routes.js`) y tras **cambiar a alguien de supervisor** (`lib/ramas.js`, `recalcularRamaEnSegundoPlano`, que ya se llamaba en todos esos caminos). Una tarea que alguien se puso a sí mismo y quedó inactivo queda en la bandeja sin push (la cuenta del creador no existe para avisar); la ve su coordinador.

**5. Conservación de las fotos de tareas.** Mismo plazo que las solicitudes (`estadoDelPlazo()` ahora es compartido: `anonimizar_solicitudes_meses` meses después de la fecha de la elección) y **la misma vuelta diaria** de `lib/solicitudesMantenimiento.js` (03:30, hora de Colombia). Borra las filas de `tarea_fotos` y los **archivos**; la tarea se conserva marcada con `fotos_borradas_en` y un apunte en su historial; queda UN apunte `tarea_fotos_borrar_auto` en la auditoría, sin usuario, solo si borró algo. Sin fecha de elección, o antes del plazo, o con un plazo configurado mayor, **no toca nada** (probado). Es independiente de lo de solicitudes: si una falla, la otra corre. **La posición de «terminé» (latitud y longitud) NO se borra:** no es una foto y la orden pedía fotos; si se quiere que también venza, es un `UPDATE` más en `borrarFotosVencidas`.

**Pantallas.** `tareas.html`: pestañas Lista, Por reasignar, Cumplimiento y Mapa; el formulario ofrece los dos tipos nuevos; el detalle muestra el avance, el motivo de «por reasignar» y si las fotos se borraron; en una meta cumplida, «Verificar» es opcional y no hay «Devolver». `mis-tareas.html`: barra de avance, sin «Terminé» en la meta, y el grupo «Cerradas y cumplidas» (las metas cumplidas no esperan verificación). Guías: `mod-tareas` y `t-tarea-asignar` actualizadas; nuevas `t-tarea-reasignar` y `t-tarea-cumplimiento`.

### Pruebas (cada suite sobre una base desechable nueva; mysqld privado)
- **`probar-tareas-metas.js` (nueva):** zonas y descendientes; crear metas (todas las validaciones); el avance con el alcance del responsable (líder, sublíder, otro líder, coordinadora), por zona (barrio, comuna, municipio, zona vacía), por fechas (hasta es un día completo) y sin enlaces sin confirmar; **coincidencia exacta con `/api/panel-lider`**; «hecha» sola (historial automático, idempotente, sin devolver ni terminar a mano, el reloj); reunión (alcance de eventos, sin meta, otra coordinación, sin permiso, cifras solo para quien ve el evento, lista fila por fila); por reasignar (cuenta inactiva, supervisor, otra rama, aviso único, bandeja con alcance, reactivar, reasignar, nada automático); panel, mapa y Excel con alcance y sin nombres; conservación de fotos (cinco casos de plazo, borrado real, historial, auditoría, repetible); textos.
- **`probar-tareas-celular.js`:** sección [10] en Chromium real (barra de avance en el celular, meta cumplida al abrir, aviso y bandeja del escritorio, reasignar desde la bandeja, cumplimiento, mapa con Leaflet y su popup sin datos). 
- Todas las demás siguen bien: `probar-eventos-alcance`, `probar-tareas`, `probar-solicitudes` (+ `-seguimiento`, `-celular`), `probar-manuales`, `comunas-dashboard`, `inscripcion-enlace` (467/467), `logistica`, `panel-alcance`, `panel-lider`, `recordatorios`, `transporte-diad` (123/123), `transporte-parte2` y `probar-ordenar-select`. `probar-instalacion-limpia` no se corrió (pide base y usuario de CloudPanel).
- Un fallo de prueba, no de código, que apareció y se corrigió: la prueba de eventos del 305 no es repetible sobre una base ya usada (se corre sobre una nueva).

### Pendientes / lo que no se hizo
- **Cuando una meta llega a su meta no se avisa a nadie** (ni a quien la asignó): queda «hecha» en la lista. Si se quiere un push al asignador, es un aviso más (cuidado con la sobrecarga de avisos).
- **Reunión:** no se cierra sola ni mide por «verificada»; una reunión cuyo evento se borra pierde su avance (la pantalla lo dice).
- **Solo asignables por la regla de siempre:** quien tiene una tarea abierta y se pasa a otra rama de aspirante queda en la bandeja (`otra_campana`) pero el aspirante sigue sin acceso a tareas.
- **Las posiciones de «terminé» no vencen** (ver arriba).
- **El primer arranque tras aplicar el parche:** el reloj revisa todas las tareas abiertas una vez; si alguna ya cumplía alguna condición de «por reasignar» (por ejemplo, una cuenta desactivada antes), se marcará y se avisará UNA vez a quien la asignó.

## Parche 305 — Eventos con permiso y alcance + Tareas, Fases 1 y 2 (8 de noviembre de 2026, publicado y registrado INACTIVO, TOCA LA BASE)

**Requiere el 304.** Service worker `v175`. Dos cosas con riesgo muy distinto: la Parte A es un **cierre de seguridad que rige apenas se aplica**; las Partes B y C son un módulo nuevo **apagado de fábrica**.

### Parte A — La fuga de eventos (rige desde que se aplica el parche)
**Qué pasaba:** `routes/eventos.routes.js` solo pedía sesión. Cualquier rol con cuenta (líder, sublíder, testigo, invitado…) listaba TODOS los eventos y, con `GET /:id/asistentes` y `GET /asistentes-consolidado`, leía nombre, teléfono y **cédula** de todos los asistentes de la campaña; también podía editar o borrar eventos ajenos y tocar sus asistentes. No medí cuántos roles lo alcanzaban en producción.
- **Permiso por módulo, en el servidor** (falla cerrado; administrador y superadministrador pasan siempre): hace falta «Ver» en `eventos`, `agenda` o `asistentes_reuniones` (las tres pantallas llaman a esta API); los asistentes piden `eventos` o `asistentes_reuniones`; el consolidado, `asistentes_reuniones`.
- **Alcance** (`lib/alcanceEventos.js`): administrador todo; coordinador los de su rama (él, sus líderes y los sublíderes de estos como creador, responsable, coordinador o líder del evento) y a los que está invitado; líder, sublíder y demás, donde figuran en esos cuatro campos o están **invitados** (`evento_asistentes.usuario_id`). El aspirante no llega. Un evento fuera del alcance responde **404 igual que uno que no existe**. Se agregó `GET /api/eventos/:id` (no existía).
- **Contactos:** el teléfono y la cédula de los asistentes solo para el administrador y el **responsable** del evento (`responsable_id`; `coordinador_id` y `lider_id` son informativos y no los dan). Los demás reciben nombre, barrio y asistencia, con `telefono_resuelto` e `identidad_resuelta` en `null` y `contactos_visibles: false` (la pantalla lo avisa). El **consolidado** y su **Excel** siguen la misma regla por persona: se ven los contactos de quien asistió a algún evento que uno responde.
- **Escribir (no estaba en la orden, pero es la misma fuga):** editar, borrar, agregar o quitar asistentes y marcar asistencia exigen **gestionar** el evento (figurar en los cuatro campos); estar invitado no basta. Antes cualquier líder, coordinador o administrador tocaba cualquiera. **Efecto visible:** un líder ya no edita el evento de otro líder, ni un coordinador el de otra coordinación.
- **Quién pierde qué (según la siembra de fábrica):** la LISTA de eventos la sigue teniendo todo rol con «Ver» en `agenda` (casi todos), pero acotada a su alcance; los ASISTENTES y el consolidado exigen `eventos` o `asistentes_reuniones`, que de fábrica NO tienen `sublider`, `usuario` ni `asistente_administrativo`: ahora reciben 403 donde antes leían todo. El `administrativo` solo tiene los módulos de su lista inicial. Las matrices que el administrador ya editó pueden diferir: no se midió ninguna instalación.

### Parte B — Tareas, Fase 1 (módulo `tareas`, apagado de fábrica: solo el administrador)
- **Tablas** `tareas`, `tarea_historial` (con `cliente_uuid` único por tarea: lo que sube la cola sin señal no se duplica) y `tarea_fotos`. Fotos en `uploads/tareas/`, cerrada a `/uploads` (`lib/carpetasPrivadas.js` + `app.js`).
- **Alcance propio** (`lib/alcanceTareas.js`; no reutiliza `alcanceVotantes`): administrador la campaña madre; coordinador lo creado o asignado a su rama; **líder lo que creó, lo que tiene asignado y lo asignado a sus sublíderes**; sublíder y demás, lo creado y lo asignado. Aspirante: ninguno (la rama existe en SQL, sin acceso). **Gestionar** (editar, reasignar, cancelar, verificar, devolver) es más estrecho: administrador y coordinador (su rama) lo que ven; los demás, solo lo que **crearon**; y **nadie gestiona lo que le asignaron a él** salvo el administrador (no se verifica lo propio; sí si se la asignó a sí mismo). Quien ejecuta es únicamente el asignado.
- **Quién asigna a quién:** administrador a cualquiera; coordinador a sí mismo, sus líderes y los sublíderes de estos; **líder a sí mismo y a sus sublíderes**; sublíder a nadie (403). Cuenta inactiva o rol que no es de trabajo: 400. **La tarea y su responsable deben ser de la misma rama de aspirante** (el administrador no puede asignar a la rama de un aspirante: 400); `GET /responsables` ya no ofrece a quien no se puede asignar.
- **Tipos:** libre; **visita** (zona obligatoria; evidencia: foto o ubicación, con una basta); **entrega** (cantidad entregada entera y positiva + al menos una foto; cantidad prevista opcional). El tipo no se cambia al editar. `TIPOS.<tipo>.medible` ya existe (hoy `false` en los tres): el día que haya un tipo medible llegará a «hecha» solo.
- **Zona:** `territorio_id` se valida contra la vista `territorios` (barrio, vereda, comuna o corregimiento; un municipio o un id inexistente → 400) y completa el nombre; sin catálogo de barrios o veredas, `GET /zonas` dice `hay: false` y la zona se escribe a mano (como `comunasDeLaCampana.js`).
- **Estados guardados:** pendiente, en_curso, hecha, verificada, cancelada (motivo obligatorio). **«Vencida»** (abierta con la fecha límite pasada) y **«sin responsable activo»** (abierta u hecha cuyo responsable tiene la cuenta inactiva) **se calculan al leer**, no hay columna ni estado. Una tarea **hecha no está vencida**. Verificada y cancelada son terminales. «Verificada» es obligatoria solo en los tipos no medibles (hoy los tres): sin verificar queda «hecha».
- **Acciones del asignado** (`POST /accion`, multipart, idempotente por `cliente_uuid`): *empecé* (→ en curso), *terminé* (→ hecha, con la evidencia del tipo; hasta 3 fotos por tarea en total, también si se devuelve y se completa), *no pude* (motivo obligatorio; vuelve a pendiente y queda marcada «No pudo» para quien asignó). La **hora que cuenta es la del toque** (si viene de la cola y no es del futuro ni de hace más de 7 días). Quien gestiona: editar/reasignar (reasignar deja la tarea pendiente; una hecha se devuelve antes), **devolver** (hecha → en curso, con lo que falta), **verificar**, **cancelar**.
- **Fotos** con el patrón de solicitudes (1.280 px, JPEG, sin EXIF, `tar_*.jpg`) por `GET /:id/fotos/:fotoId`, que comprueba el alcance. **Ubicación** con el patrón de `checkin.js`: opcional, con tiempo límite, **nunca bloquea**, fuera de Colombia se descarta, **una sola posición** (columnas en la propia tarea; ninguna tabla de recorridos) que **solo ven quien gestiona y el asignado** (los demás, dentro del alcance, ven que existe).
- **Escritorio** (`public/tareas.html`, menú «Tareas» para admin/coordinador/líder): resumen por estado más vencidas y sin responsable, filtros (estado, tipo, responsable, zona, título, vencidas, sin responsable), lista paginada, **crear y asignar** (con zonas del catálogo o escritas), detalle con fotos, ubicación, historial y **verificar / devolver / cancelar / editar / reasignar**. **Celular** (`public/app/mis-tareas.html`): lista agrupada (Para hacer, Esperando verificación, Cerradas), etiquetas (vencida, vence hoy, devuelta, no pude), **Empecé / Terminé / No pude**, formulario de evidencia por tipo, y la cola `tareas_pendientes` (**`OFFLINE_DB_VERSION = 8`**, con dueño: otra cuenta del mismo celular no la ve ni la sube; fotos como Blob; lo fallido se descarta a mano).

### Parte C — Tareas, Fase 2
- **Push** (`lib/tareasAvisos.js`) **al asignar, reasignar, verificar y devolver:** solo el **tipo y la zona** («Tarea de visita en El Carmen. Ábrela para empezar.»), **nunca el título, la descripción ni la nota de la devolución**. Inmediato (no pasa por el silencio). No avisa a quien actúa sobre lo suyo, a quien pidió no recibir avisos ni a quien no puede ver el módulo (en ese caso la respuesta trae `aviso` y la pantalla se lo dice al administrador). Si falla, la acción queda hecha.
- **Tarjeta «mis tareas»** en `GET /api/panel-lider` (clave `tareas`; `null` si no tiene «Ver» en `tareas`; en su propio `try` para que una campaña sin la migración no pierda el resto del panel): pendientes, vencen hoy, vencidas y devueltas, **solo cifras**; dibujada en `panel-lider.js`.
- **Recordatorios** (`lib/recordatoriosTareas.js`, tipo `tarea_vence`): dos reglas de fábrica **apagadas**, «Tarea · 3 días antes» (`desfase_min = -4320`) y «Tarea · el día que vence» (`0`), por la app y solo al responsable, a las **8 a. m.** del día que toca; respetan el silencio y la precampaña; **máximo 3 avisos por tarea** (se cuentan los del motor, aunque cambie la fecha); no avisan de la tarea creada después de esa hora, ni de una cerrada, ni a quien no ve el módulo. Un reintento pendiente se cancela con su motivo si la tarea se cerró, cambió de responsable o de fecha. «Enviarme una prueba» y la pantalla de reglas (al final, con su etiqueta; en el editor, texto fijo de cuándo sale) las conocen.
- **Guías:** `mod-tareas` y `t-tarea-asignar`. Textos sin votos, elección ni cargos (comprobado en pantallas, guías, avisos y plantillas).

### Pruebas (cada suite sobre una base desechable nueva; mysqld privado)
- **`probar-eventos-alcance.js` (nueva):** permiso por módulo con los cinco roles; alcance de la lista y del detalle (administrador, 2 coordinadores, 3 líderes, sublíder, testigo, invitado, aspirante); 404 igual al inexistente; teléfono y cédula solo para administrador y responsable (también en el consolidado y en su Excel); escribir exige gestionar (estar invitado no basta).
- **`probar-tareas.js` (nueva):** migración y reglas apagadas, permisos, quién asigna a quién con todos los roles, alcance de lectura y de gestión, los tres tipos y la zona (con y sin catálogo), empecé/terminé/no pude y la evidencia por tipo, idempotencia, fotos (1.280 px, sin EXIF, privadas, ruta con alcance), una sola posición, verificar/devolver/cancelar/editar/reasignar, derivados, historial, push (contenido, no a sí mismo, sin acceso, falla), tarjeta del panel y recordatorios (apagado, silencio, 3 días antes y hoy, tope de 3 avisos, reintento cancelado, prueba) y textos.
- **`probar-tareas-celular.js` (nueva, Chromium real):** «Mis tareas» (lista, cifras, etiquetas), empecé / no pude / evidencia, **sin señal** (cola con fotos como Blob y dueño), otra cuenta no ve ni sube lo ajeno, al volver la señal sube **una vez** con foto sin EXIF, la ubicación no bloquea, la tarjeta en el panel y el escritorio (lista, foto protegida, verificar, devolver, crear y asignar). Corrida 3 veces seguidas: bien.
- `probar-recordatorios.js` ahora espera **10** reglas de fábrica (eran 8) y que las de tareas vayan al final; `probar-solicitudes.js` acepta `OFFLINE_DB_VERSION` 7 u 8.
- Siguen bien: `probar-solicitudes`, `probar-solicitudes-seguimiento`, `probar-solicitudes-celular`, `probar-manuales`, `comunas-dashboard`, `inscripcion-enlace` (467/467), `logistica`, `panel-alcance`, `panel-lider`, `transporte-diad` (123/123), `transporte-parte2` y `probar-ordenar-select`. `probar-instalacion-limpia` no se corrió (pide base y usuario de CloudPanel).
- **Un tropiezo de prueba, no de código:** en la corrida completa la tarjeta del panel tardó más que la espera fija y la prueba falló una vez; solo. Ahora espera hasta 12 s a que aparezca.

### Pendientes / lo que no se hizo
- **Metas medibles, reunión enlazada a un evento, panel del coordinador y exportación** van en la siguiente orden (el campo `medible` y el cálculo con el alcance del responsable ya están pensados; las fichas por enlace sin confirmar **no** cuentan para metas, decisión tomada).
- **El aspirante con sublicencia sigue sin acceso** a tareas.
- **Eventos:** tras aplicar, revisar que nadie pierda una pantalla que sí usaba (sobre todo quien consultaba asistentes sin «Ver» en `eventos` ni `asistentes_reuniones`); se le abre en Asignación de permisos. La pantalla de asistentes avisa cuando no muestra los contactos.
- Quien se desactive con tareas abiertas deja «sin responsable activo»: el panel de escritorio las cuenta y las filtra, pero **nada las reasigna solo** ni avisa al que las asignó.
- Para encender los recordatorios: Configuración → Recordatorios → interruptor general y las dos reglas «Tarea · …». Hasta entonces no sale nada.

## Parche 304 — Solicitudes ciudadanas, Fases 3 a 5 (8 de noviembre de 2026, publicado y registrado INACTIVO, TOCA LA BASE)

Orden: anonimización automática, seguimiento, panel y mapa, exportación y arreglo del ordenador de desplegables. **Requiere el 303.** Service worker `v174`. Las pantallas de escritorio y los avisos siguen **apagados de fábrica** (el módulo `solicitudes` es solo del administrador; la regla de seguimiento nace apagada).

**1. Anonimización automática** (`lib/solicitudesMantenimiento.js`, arrancada desde `app.js`). Una vuelta al día **dentro del proceso**: cada 10 minutos mira la hora de Colombia y corre la primera vez que son las 03:30 o más y hoy no ha corrido (o 30 s después de arrancar si ya pasó la hora). Usa la lógica de siempre (`anonimizarVencidas({ aplicar: true })`): `anonimizar_solicitudes_meses` meses **después** de la fecha de la elección; sin fecha, o antes del plazo, **no toca nada**. Deja un apunte `solicitud_anonimizar_auto` en la auditoría (sin usuario) **solo si anonimizó algo**: cuántas solicitudes y fotos y desde qué fecha. No depende de que el módulo esté encendido para nadie. Repetible: una segunda pasada no encuentra nada. `scripts/anonimizar-solicitudes.js` queda para probar y simular (su encabezado lo dice); si ya estaba en un cron se puede quitar, y dejarlo no hace daño.

**2. Seguimiento** (`lib/solicitudesSeguimiento.js`, `lib/recordatoriosSolicitudes.js`).
- **Aviso al asignar:** al asignar una solicitud el responsable recibe un push («Te asignaron una solicitud» + categoría y barrio; **nunca** nombre, teléfono ni texto; abre `solicitudes.html` si es admin/coordinador o `app/mis-solicitudes.html`). Es inmediato (lo dispara una persona, no el reloj) y **no pasa por la franja de silencio**. No avisa a quien se asigna a sí mismo, a quien pidió no recibir avisos ni a quien **no puede ver el módulo** (el aviso no llevaría a ninguna parte); en ese último caso la respuesta de `PUT /:id/responsable` trae `aviso` y la pantalla se lo dice al administrador. Si el push falla (sin dispositivo, sin llaves VAPID) la asignación queda igual.
- **Sin movimiento hace N días:** tipo nuevo `solicitud_sin_movimiento` del motor de recordatorios, canal push, **solo al responsable**. «Movimiento» = cualquier fila del historial (registro, estado, responsable, nota), no la anonimización. N sale de `configuracion_campana.solicitud_dias_sin_movimiento` (15; 1–365; se cambia al final de la pantalla de Solicitudes y queda en la auditoría; rige en la vuelta siguiente). Una vez por ocurrencia (`solicitud:<id>:<último movimiento>`): si la mueven y vuelve a quedar quieta, avisa de nuevo; si cambia el responsable, el siguiente aviso va a la persona nueva. Solo avisa si el responsable puede ver el módulo y su cuenta está activa; las abiertas **sin responsable** no avisan a nadie (el panel las cuenta). No caduca: lo acumulado mientras el motor estaba apagado sale al encenderlo, a razón de 100 por minuto. Un reintento pendiente se cancela con su motivo si la solicitud se cerró, se movió o cambió de responsable. **Apagada de fábrica con los dos interruptores de siempre:** el general (`recordatorios_activos`) y la regla sembrada («Solicitud ciudadana · sin movimiento · aviso en la app (responsable)», `activo = 0`). Respeta la franja de silencio y la precampaña (su texto no habla de voto, elección ni cargo). «Enviarme una prueba» funciona con datos de muestra. En Configuración → Recordatorios la regla sale al final y no pide «hora del día».

**3. Panel y mapa** (`lib/solicitudesPanel.js`, rutas `GET /panel` y `GET /mapa`, pestañas en `solicitudes.html`). Mismo **alcance** que la lista (cada quien cuenta lo suyo; el administrador, la campaña madre sin la rama de un aspirante; «me la asignaron» entra), y el aspirante con sublicencia sigue sin acceso. Panel: total y conteo por estado, por categoría y por barrio o vereda (los 25 primeros), días promedio de registrada a remitida y a cerrada (con cuántas solicitudes entran en cada promedio) y cuántas abiertas llevan N días o más sin movimiento; se acota por fechas de registro. **Mapa:** Leaflet con OpenStreetMap; el GPS se agrupa en **celdas de 0,005° (~550 m)** y solo viaja el **centro de la celda**, el número de solicitudes y cuántas hay por categoría. **Nunca** un punto exacto, ni nombre, ni teléfono, ni foto, ni texto, ni número de solicitud, ni barrio (comprobado). Las que no tienen GPS no aparecen y la nota dice cuántas son.

**4. Exportación** (`GET /exportar/diagnostico`, `GET /exportar/detalle`). La casilla **Importar / Exportar** existe ahora para el módulo `solicitudes` (`config/importarExportar.js`; de fábrica solo el administrador, que pasa siempre).
- **«Diagnóstico de necesidades del territorio»**: Excel agregado con tres hojas (*Diagnóstico*: categoría × barrio × estado; *Por categoría*; *Cómo leerlo*, con filtros, conteo y tiempos). **Sin datos personales de ninguna clase.** Para quien tenga Exportar, **dentro de su alcance**. Queda en la auditoría (`exportar_excel`).
- **Detalle por solicitud**: **solo el administrador** (aunque otro rol tenga la casilla; coordinador, líder, sublíder y aspirante reciben 403), con el **teléfono enmascarado** (`*** *** 6543`), el nombre solo donde el ciudadano autorizó, sin coordenadas, y el texto libre (puede nombrar a alguien: la hoja *Aviso* lo advierte). Auditoría `exportar_excel_detalle` con cuántas filas y que salió enmascarado; los intentos rechazados no dejan apunte.
- Los dos botones están en la pestaña Panel (el del detalle solo se ve al administrador) y respetan las fechas elegidas.

**5. `common.js`: el ordenador de desplegables ya no cambia la opción elegida.** Causa: al ordenar, se sacaba del `<select>` la opción vacía (que era la seleccionada); el navegador marcaba la primera opción real y, al volver a meter la vacía —que conserva su marca—, quedaban dos marcadas y **gana la última**. La versión anterior solo restauraba la selección si el valor previo no era `''`, justo el caso roto. Ahora se guarda **el elemento** `<option>` elegido (no su valor: dos opciones pueden compartirlo) y se vuelve a marcar; también cubre múltiples, grupos y «ninguna elegida». **Reproducido primero** con el ordenador anterior (fixture `scripts/fixtures/ordenar-select-anterior.js`) en Chromium real, y luego comprobado con el nuevo. **Pantallas expuestas** (selects que se llenan con `innerHTML` empezando por la opción vacía, así que podían cambiar solos): 11 archivos y 26 filtros — `configuracion.html` (filtro-usuarios-rol), `enviar-email/-push/-sms.html` (grupo-territorio, grupo-puesto-votacion), `eventos.html` (3), `territorial.html` (4), `votantes.html` (5), `js/transporte-dia-d.js` (2), `app/admin-estructura.html` (2), `app/admin-votantes.html` (1), `app/registro-votante.html` (2). **Quedan todas cubiertas por el arreglo central** (nadie más llama a `ordenarSelect`: no hay otra copia que corregir); no se tocó ninguna. Los tres filtros de `solicitudes.html` conservan `data-sin-ordenar` a propósito (su orden es el de las categorías definidas por el administrador y la escala de estados).

### Pruebas (cada suite sobre una base desechable nueva; mysqld privado)
- **`probar-solicitudes-seguimiento.js` (nueva):** migración y regla apagada; anonimización (sin fecha de elección, elección en el futuro, 5 meses con plazo de 6, 7 meses con plazo CONFIGURADO en 12: **no toca nada** ni escribe en la auditoría; con el plazo cumplido anonimiza una solicitud y 2 fotos —filas y archivos—, conserva texto, categoría, barrio y estado, deja un solo apunte sin usuario, una segunda vuelta no escribe otro, y la regla del «una vez al día» en hora de Colombia); push al asignar (contenido sin datos personales, no a sí mismo, no a quien no ve el módulo, falla sin tumbar la asignación, no a quien pidió no recibir); alerta por el motor (apagada, silencio, una vez por ocurrencia, N configurable, movimiento, cambio de responsable, reintento cancelado); **panel, mapa y exportación con alcance** para administrador, coordinadores, líderes, sublíder, testigo, «me la asignaron» y aspirante (el panel cuenta lo mismo que la lista en cada caso; el mapa no lleva nada de personas ni puntos exactos; el diagnóstico sin datos personales y limitado al alcance; el detalle solo del administrador, enmascarado y auditado); y los textos nuevos sin cargos, voto, elección ni promesas.
- **`probar-ordenar-select.js` (nueva, Chromium real):** reproduce el fallo con el ordenador anterior y comprueba siete variantes con el nuevo, más el barrio estático de pantallas.
- **`probar-solicitudes-celular.js`:** sección nueva [7] en Chromium real (pestañas Lista/Panel/Mapa, Leaflet, el círculo, el popup sin datos personales, los botones de descarga).
- **`probar-recordatorios.js`:** ahora 8 reglas de fábrica (eran 7) y la nueva va al final de la lista. `listarReglas` ordena por tipo y la nueva se colaba PRIMERA; la prueba «un aviso en la app» tomaba esa regla con datos de muestra de otro tipo (se corrigió en `lib/recordatorios.js`: orden y datos de muestra).
- Siguen bien: `probar-solicitudes` (backend, sin cambios), `probar-manuales`, `comunas-dashboard`, `inscripcion-enlace` (467/467), `logistica`, `panel-alcance`, `panel-lider`, `transporte-diad` (123/123) y `transporte-parte2`. `probar-instalacion-limpia` no se corrió (pide base y usuario de CloudPanel).

### Pendientes / lo que no se hizo
- **El aspirante con sublicencia sigue sin acceso** a solicitudes (ni panel, mapa ni exportación); es una decisión aparte.
- El aviso al asignar es **inmediato** (no pasa por el silencio de 20:00–08:00) a propósito: lo dispara una persona. Si se prefiere diferirlo de noche, es un cambio pequeño en `avisarAsignacion`.
- La descripción de una solicitud es texto libre y puede nombrar a alguien; el detalle exportado la lleva (solo administrador). La anonimización no reescribe descripciones.
- **Para encender el seguimiento:** Configuración → Recordatorios → interruptor general, y la regla «Solicitud ciudadana · sin movimiento…». Hasta entonces no sale nada.

## Parche 303 — Solicitudes ciudadanas, Fases 1 y 2 (8 de noviembre de 2026, generado, SIN publicar, TOCA LA BASE)

Módulo nuevo `solicitudes`: las necesidades que la gente cuenta en su barrio o vereda. **Apagado de fábrica** (solo el administrador, con Ver; el servidor exige Agregar y Editar).
- **Sin vínculo con votantes**: ni `votante_id`, ni cédula, ni `apoya_a`, ni intención de voto; no se muestran junto a fichas. Estados `registrada, en_revision, remitida, cerrada` (nunca «resuelta»/«cumplida»); remitir exige la entidad y cerrar, el motivo.
- **Datos del ciudadano** (nombre, teléfono): solo con `autoriza_datos` (con fecha y versión de la política); sin autorización queda solo el barrio/vereda. Nunca cédula. El teléfono lo ven solo el administrador y el responsable asignado; la lista y la respuesta de registrar no lo traen.
- **Alcance** en `lib/alcanceSolicitudes.js` (madre/coordinador/líder/sublíder/aspirante, más «me la asignaron»); fuera de alcance responde igual que inexistente.
  **El aspirante (sublicencia) NO tiene acceso todavía** (la lista blanca de `middleware/aspirante.js` no incluye solicitudes, a propósito); el alcance de su rama existe en SQL y está probado.
- **Fotos**: máximo 3, 1.280 px, JPEG, sin EXIF, en `uploads/solicitudes/` (cerrada a `/uploads` por `lib/carpetasPrivadas.js`); se sirven por `/api/solicitudes/:id/fotos/:fotoId` comprobando alcance.
- **Retención**: `anonimizar_solicitudes_meses` (6 de fábrica) después de la fecha principal de la campaña; `scripts/anonimizar-solicitudes.js --aplicar` borra nombre, teléfono y fotos. (Falta ponerlo en el cron: **resuelto en el 304**, que la corre sola dentro del proceso.)
- **Celular**: `app/solicitud-nueva.html` (4 pasos, ubicación opcional que nunca bloquea, hasta 3 fotos, casilla de autorización) y `app/mis-solicitudes.html`; cola `solicitudes_pendientes` con dueño (otra cuenta del mismo celular no la ve ni la sube) y fotos como Blob. Tarjetas en `inicio.html` y entrada en el menú de escritorio.
- **Escritorio**: `solicitudes.html` (lista con filtros, detalle, historial, estado, responsable, notas internas, categorías y plazo para el administrador).
- **Política de privacidad**: párrafo con la finalidad «registrar y remitir necesidades del territorio», versión nueva archivada con su huella.
- Guías: `mod-solicitudes`, `t-solicitud-registrar`.
- **Pruebas** (bases desechables nuevas): `probar-solicitudes` (backend, todo bien), `probar-solicitudes-celular` (Chromium real: pasos, sin señal, cola por dueño, sincronización idempotente, fotos sin EXIF, escritorio; 3 corridas seguidas, todo bien), más manuales, comunas-dashboard, inscripcion-enlace (467/467), panel-alcance, panel-lider, recordatorios, transporte-diad (123/123), transporte-parte2 y logística. `probar-logistica` exigía `OFFLINE_DB_VERSION` 5 o 6: se aflojó a 5–9. `probar-instalacion-limpia` no se corrió (pide base y usuario de CloudPanel).
- **Tropiezo**: el ordenador automático de desplegables de `common.js` a veces deja el filtro en la primera opción real en vez de «Todas»; se esquivó con `data-sin-ordenar` en los tres filtros. (**Arreglado en el 304.**)
- **Siguiente orden**: panel, mapa y exportación (con el teléfono enmascarado), y el acceso del aspirante.

## Parche 302 — SMS de evento con enlace de baja y meta de campaña solo para la dirección (8 de noviembre de 2026, publicado y registrado INACTIVO, TOCA LA BASE)

Orden: «SMS de recordatorio de evento con enlace de baja». **Requiere el 301.** **Toca la base** (`db/init-db.js` actualiza la plantilla de fábrica). **Service worker sigue en v172**: no cambió ningún archivo de la precarga.

**1. El SMS de recordatorio de evento lleva el enlace de baja** (`conBaja: true` en `lib/recordatorios.js`; deja sin efecto lo decidido en el parche 301).
- **Antes el motor solo CONTABA el enlace** y nunca lo agregaba (ningún tipo lo llevaba). Ahora lo agrega de verdad: « Baja: <enlace>» al final, con el enlace firmado de ESA persona (`config/bajaContacto.js`, base `sms_config.url_baja_base` o el dominio de la licencia). Sin llave para firmar (sin `SESSION_SECRET`) sale sin él, como en el CRM. Si la campaña apagó «Agregar el enlace de baja a cada SMS», no se agrega ni se cuenta.
- **Plantilla de fábrica nueva:** «{nombre}: te esperamos en {evento}, {fecha} {hora}, {lugar}.» (las cinco reglas de evento). Para ganar sitio, `{fecha}` pasó a «20 nov» y `{hora}` a «10:30am» (antes «vie 20 nov» y «10:30 am»). Con datos típicos ocupa 157 caracteres **con el enlace de baja más largo (dominio de 42 letras, 78 caracteres)**: cabe en un segmento GSM-7.
- **Migración:** las reglas de evento cuyo texto sigue siendo EXACTAMENTE el de fábrica anterior pasan al nuevo; **una que el administrador editó no se toca** (probado).
- **Recorte (`ajustarSms`):** si con los datos de ese evento el SMS no cabe en un segmento, se acorta `{lugar}` y, si hace falta, después `{evento}`, de un carácter en un carácter hasta un mínimo de 6 letras más «...». **Tres puntos ASCII y no «…»**: ese carácter no es GSM-7 y mandaría el mensaje a 70. **El enlace de baja NUNCA se toca.** Si ni así cabe (por ejemplo, una firma de operador muy larga), la fila queda `omitido` («aun recortando lo posible») y no sale en dos segmentos. El historial deja escrito qué se recortó («Se recortó {lugar} y {evento} con «...» para caber en un SMS»). «Enviarme una prueba» usa el mismo armado, con el enlace de baja de quien la pide.
- Las variables que se pueden recortar son una propiedad del tipo (`recortables: ['lugar', 'evento']`).

**2. El validador en vivo cuenta el enlace de baja en las reglas SMS.** `validarPlantilla` mide con la firma del operador y con el largo REAL del enlace de ESTA campaña (`largoDeLaBaja`: base + «/b/» + hasta 18 de código; antes era una constante de 78). Valida el peor caso razonable: lo recortable, al mínimo (9 caracteres); lo demás, al máximo; si ni así cabe, rechaza («incluso recortando {lugar} y {evento}…»). Los números que muestra la pantalla son con datos **típicos** y dice cuánto ocupa el enlace de baja («contando el enlace de baja (N)») y qué se recorta si hace falta (`bajaCaracteres` y `recortables` en la respuesta de `POST /validar`).

**3. `GET /api/dashboard/resumen` ya no manda `metaVotosCampana`** a líder, sublíder, testigo, usuario ni invitado (se omite la **llave**; un cero diría «no hay meta»). La reciben el administrador, el coordinador, el asistente administrativo y el administrativo, y **el aspirante con sublicencia** (es la meta de su propia campaña, aunque su rol de fila sea «lider»). `dashboard.html` y `admin-panel.html` ya toleraban la llave ausente (`metaVotosCampana > 0 ? … : '—'`). La cifra tampoco aparece en ninguna otra parte de la respuesta.

### Pruebas
- **`probar-recordatorios.js` — 245 comprobaciones** (de 225): el texto exacto con la baja y los formatos nuevos; recorte de solo el lugar, de lugar y evento, con firma de 25 caracteres, imposible (omitido), sin baja (apagada) y sin llave; todo en un segmento GSM-7, sin tildes ni «…»; el enlace de baja siempre completo al final; el historial dice qué se recortó; la plantilla de fábrica cabe con el dominio de 42 letras (157 caracteres, baja de 78); el largo del enlace sale del dominio; el validador en vivo cuenta la baja y dice qué se recorta; la prueba a uno mismo lleva su enlace.
- **`probar-panel-alcance.js` — 59 comprobaciones** (de 47): `metaVotosCampana` SÍ llega a administrador, coordinador, asistente administrativo y administrativo (4000) y NO viaja —ni la cifra— a líder, sublíder, testigo, usuario ni invitado; el resto del tablero del líder sigue igual; el aspirante SÍ la recibe.
- Las otras siete suites, cada una sobre una base nueva, siguen bien (467 y 123 comprobaciones en inscripción por enlace y transporte).
- Migración probada sobre la plantilla extraída: 67 tablas en dos corridas; una regla sin editar con el texto anterior pasa al nuevo y una editada se conserva.
- **Sin probar:** contra un proveedor real de SMS (no hay canal en el entorno de prueba): el enlace de baja real, `url_baja_base` y el límite de 160 del operador se verificaron con el contador propio del repositorio.


## Parche 301 — Recordatorios automáticos, Fases 2, 3 y 4 (8 de noviembre de 2026, publicado; registro y activación por el usuario; TOCA LA BASE)

Orden: «Recordatorios, Fases 2, 3 y 4». **Requiere el 300.** **Toca la base** (siembra, no cambia el esquema de las tablas de la Fase 1). **Service worker v172**: la entrada «Recordatorios» del menú está en `common.js`, que va en la precarga. Sigue **apagado de fábrica**: `recordatorios_activos = 0`, las siete reglas nacen apagadas y el módulo solo lo ve el administrador.

**Decisiones tomadas (de la orden):** el **equipo recibe recordatorios solo por push** (no se le pide consentimiento de SMS ni correo por ahora); un recordatorio de evento **diferido por el tope o por el silencio sale mientras el evento no haya empezado; si ya empezó, se descarta con motivo**.

### Fase 2 — eventos (`lib/recordatoriosFuentes.js`, tipo `evento`)
- Reglas «X horas antes»: `desfase_min` negativo (24 h = −1440, 2 h = −120). Siembra de fábrica, todas apagadas: SMS 24 h y 2 h, aviso en la app (equipo) 24 h y 2 h, y correo 24 h.
- **Destinatarios:** `evento_asistentes`. Por **push**, las cuentas del equipo (`usuario_id`). Por **SMS o correo**, los asistentes con ficha de votante, con ese medio autorizado (el motor vuelve a exigir el consentimiento estricto al enviar: el NULL no autoriza) y sin baja. Un «invitado» con solo nombre no tiene dónde recibir nada. Solo eventos en estado `programado`.
- **Plantilla de fábrica** (sin cargo ni voto): «{nombre}, te esperamos en {evento} el {fecha} a las {hora} en {lugar}.» Variables nuevas: `{evento}`, `{fecha}` («vie 20 nov»), `{hora}` («10:30 am») y `{lugar}`. Validada a **un solo segmento** con los datos más largos (124 caracteres) y también **antes** de la fecha permitida. Si al evento le falta el lugar, el mensaje no se manda a medias (queda `omitido`).
- **Cambios del evento:** la ocurrencia lleva la fecha de inicio (`evento:<id>:<fecha>`). Si el evento **se mueve**, lo pendiente (en cola o diferido) de la fecha vieja se cancela («cambió de fecha») y la fecha nueva genera su propio recordatorio. Si se **cancela** o se marca realizado, o se **borra**, lo pendiente se cancela. `routes/eventos.routes.js` lo avisa al motor al editar o borrar (no espera la vuelta de 60 s), y la vuelta lo revisa siempre, también en silencio.
- **Vence cuando empieza el evento** (`vence_en`): un recordatorio diferido por el tope o por el silencio sale mientras el evento no haya empezado; si ya empezó, queda `omitido` con «El evento ya empezó». Se miran los eventos de las últimas 12 h para que ese motivo quede escrito en vez de que el recordatorio simplemente no aparezca.
- Un evento **creado después** de la hora del recordatorio no recibe uno tardío (un evento creado 1 h antes no recibe el «24 h antes»).
- **(Reemplazado por el parche 302: ahora SÍ lleva el enlace de baja.)** Sin enlace de baja al final del SMS de evento (`conBaja: false`): es un recordatorio operativo de algo a lo que la persona fue invitada y con el enlace de 78 caracteres el texto de fábrica no cabe en un segmento (igual que el aviso al testigo y el enlace «Ya voté»). La baja se respeta igual. **Es una decisión de producto que conviene confirmar**: para volver a ponerlo, `conBaja: true` en `lib/recordatorios.js` y acortar la plantilla.

### Fase 3 — «¿ya votaste?» (tipo `dia_d_ya_votaste`)
- **Solo la fecha de elección** (`configuracion_campana.fecha_eleccion` = hoy), **a la hora H de la regla** (14:00 por defecto) y hasta el cierre de la jornada. Dos reglas de fábrica: **1.ª ronda (14:00)** y **2.ª ronda (15:00, opcional)**; ambas apagadas. (La 1.ª también nace apagada: no se puede activar sin la fecha permitida, y encender algo de campo por defecto sería sorprendente.)
- **Destinatarios:** votantes que **no han votado al momento de enviar** (se relee ficha por ficha), con `consentimiento_sms = 1` estricto, sin baja ni `no_contactar`, con teléfono. Lleva `{enlace_ya_vote}` (el enlace propio de cada persona, `config/yaVotoEnlace.js`); si no se puede armar, la fila queda `omitido` con el motivo y no sale un SMS con el enlace en blanco.
- **Una sola ronda por persona y regla** (la clave única lleva `dia:<fecha>`). Lo que quede esperando al cerrar la jornada se descarta con motivo.
- **No se puede activar** si `fecha_permitida_propaganda` está vacía o es futura (`activarRegla`); vaciar o mover esa fecha **apaga** esas reglas y lo dice. El texto «¿ya votaste?» se puede **guardar apagado** antes de la fecha (la pantalla avisa en vez de rechazar), pero el motor lo vuelve a comprobar al enviar.
- **Una vuelta procesa a lo sumo 100 candidatos** (`MAX_POR_VUELTA`): una lista grande se reparte entre varias vueltas de 60 s. Si el tope de SMS se agota, el resto de esa vuelta ni se intenta (`sinCupo`).

### Fase 4 — la pantalla (Configuración → Recordatorios)
- **Módulo `recordatorios`** en la matriz de permisos (`routes/permisos.routes.js`) y en la siembra (`db/init-db.js`): **solo el administrador** de fábrica. «Ver» abre la pantalla; para **escribir** el servidor exige además «Editar» (el administrador y el superadministrador pasan siempre). Entrada de menú «Recordatorios» (`common.js`) y pestaña en `configuracion.html`.
- **`routes/recordatorios.routes.js`** (`/api/recordatorios`): `GET /estado`, `PUT /config`, `GET /reglas`, `PUT /reglas/:id`, `POST /reglas/:id/activar`, `POST /validar`, `POST /reglas/:id/probar`, `GET /envios`.
- **Pantalla** (`public/js/recordatorios-config.js`, un archivo que dibuja todo dentro de la pestaña): interruptor general; **fecha permitida de propaganda**; **tope diario de SMS** con el saldo, el límite diario y lo gastado hoy del libro central a la vista (y el `max` del campo es ese límite; el servidor lo vuelve a exigir); **horas de silencio**; lista de **reglas** con Activar/Apagar, **Editar** (nombre, horas antes o hora del día, título o asunto, mensaje) con el **validador en vivo del servidor** (variables permitidas, precampaña, caracteres y segmentos, botones para insertar variables) y **«Enviarme una prueba»**; **historial** con filtros por estado, motivo de omisión y regla, con paginación.
- **«Enviarme una prueba»** manda la regla a quien la pide, con datos inventados (SMS a su teléfono, correo a su correo, aviso a su cuenta). **No** se registra en `recordatorio_envios`, **no** cuenta en el tope diario y no pasa por consentimiento ni silencio; el SMS sí gasta un crédito del libro central y el proveedor puede rechazarlo fuera de su franja (se dice tal cual, 502). Su teléfono sale enmascarado en la respuesta.
- **Auditoría** (`auditoria`): `recordatorios_configuracion` (cada campo con su antes y después, y si se apagaron reglas), `recordatorios_regla_editar` (qué campos cambiaron), `recordatorios_regla_activar` / `_apagar` y `recordatorios_prueba`. Guardar lo mismo no ensucia la auditoría.
- **Manual:** guías `mod-recordatorios` y `t-recordatorios-activar` (163 guías; `probar-manuales` exige una por módulo de la matriz).

### Pruebas
- **`scripts/probar-recordatorios.js` — 225 comprobaciones**, sobre una base nueva. Además de lo de las Fases 0 y 1: reglas de fábrica (7, apagadas, sin duplicar) y módulo en la matriz · **eventos** (24 h y 2 h antes, equipo por push y votantes por SMS/correo con consentimiento, texto exacto, movido, cancelado, borrado, diferido por el tope, diferido por el silencio, evento ya empezado, evento creado tarde) · **«¿ya votaste?»** (antes de la hora, a la hora, votó antes, sin consentimiento NULL y 0, con baja, sin teléfono, una ronda por persona, segunda ronda apagada y luego activada, otro día, tras el cierre, enlace que no se puede armar, 130 personas repartidas en vueltas) · **activación** (fecha vacía, futura y de hoy; vaciarla apaga las reglas) · **la pantalla** (permisos: sin sesión, sin módulo, solo «Ver», con «Editar»; estado con el libro central; tope sobre el límite central; fechas y horas inválidas; auditoría de cada cambio; validador en vivo; prueba a sí mismo sin tope ni fila; historial y sus tres filtros).
- Las otras ocho suites, cada una sobre una base nueva, siguen bien (467 y 123 comprobaciones en inscripción por enlace y transporte).
- **Chromium** (base de prueba con la ruta real montada): la pestaña carga, el validador en vivo reacciona al escribir (variable inexistente y «votar» antes de la fecha → error y «Guardar regla» desactivado; plantilla de fábrica → «1 SMS, 124 caracteres») y la entrada «Recordatorios» sale en el menú de Configuración. **No se probó** contra un proveedor real de SMS ni de push.

### Lo que NO está hecho
Más fuentes de candidatos (otras que eventos y «¿ya votaste?») · crear reglas nuevas desde la pantalla (hoy se editan y activan las siete de fábrica) · reporte de entrega del SMS (`entregado`) en el historial · consentimiento del equipo por SMS o correo · capturas de pantalla para las guías nuevas.

## Parche 300 — Recordatorios automáticos, Fases 0 y 1 (8 de noviembre de 2026, publicado; registro y activación por el usuario; TOCA LA BASE)

Orden: «Recordatorios automáticos, Fases 0 y 1 (sin pantalla ni envíos reales todavía)». **Requiere el 299.** **Toca la base** (`db/init-db.js`: el actualizador corre `init-db`; es repetible). No cambia ningún precargado del service worker: las únicas páginas tocadas (`crm.html`, `enviar-sms.html`, `enviar-email.html`, `enviar-push.html`) no están en la precarga, así que **SW sigue en v171**.

**El motor viene APAGADO** (`configuracion_campana.recordatorios_activos = 0`, ninguna regla de fábrica) y **no hay todavía ninguna fuente real de candidatos** (los eventos y el «¿ya votaste?» son las fases siguientes), así que aunque alguien lo encendiera hoy no saldría nada. Sin pantalla. Probado con un script, sin mandar un solo mensaje real.

### Fase 0 — cerrar duplicados y reevaluar al despachar (`routes/comunicaciones.routes.js`)

1. **Cada fila se reclama antes de enviarse.** `UPDATE … SET estado = 'enviando', reclamado_en, proceso WHERE id = ? AND estado = 'pendiente'`: solo un ciclo gana. Además, una campaña que este proceso ya está enviando no arranca un segundo ciclo (`campanasEnProceso`).
2. **«Reintentar fallidos»** (`reintentarFallidos`) reclama los fallidos con una marca de proceso y lanza UN ciclo. Un segundo clic con la campaña en marcha responde 409 («todavía se está enviando»); con una campaña ya reclamada devuelve 0. Antes los dos ciclos leían la misma lista de pendientes.
3. **«enviando» ANTES de llamar al proveedor y se guarda su id** (`twilio_sid`, que desde siempre guarda el del proveedor). El SMS ahora lleva `loteId = crm-<campaña>` y `contactoId = <fila>`, que es lo que permite reconciliar. **Tras un reinicio, las «enviando» se reconcilian, no se reenvían** (`reconciliarEnviando`, al arrancar y cada minuto para las de más de 10 min): con rastro «aceptado/entregado» en `sms_envios` → `enviado` con su id; «fallido/rechazado» → `fallido` con el motivo del proveedor; **sin rastro** (y siempre en correo y push, que no tienen bitácora) → `fallido` con la advertencia «no se pudo confirmar si salió». Reintentarlo lo decide una persona.
4. **Al despachar cada fila se vuelve a leer** (`releerAntesDeEnviar`): baja (`no_contactar`, también la de las personas del EQUIPO, que antes no se miraba en correo ni push masivos), autorización del canal (regla general: solo un 0 bloquea; con `{enlace_ya_vote}` por SMS, la estricta: solo un 1) y, si la campaña es de Día D (lleva `{enlace_ya_vote}` o su fuente es «mis votantes que aún no han votado»), si **ya votó**. Si ya no aplica, la fila queda **`omitido`** con su motivo. La baja por número que descubre el propio envío SMS (`DADO_DE_BAJA`) también queda `omitido`.
5. **SMS fuera de franja ya no es «fallido»:** la fila vuelve a `pendiente`, la campaña pasa a `borrador` con `programado_para` = la apertura de la siguiente franja (`minutosHastaLaFranja`, la de las bienvenidas) y el ciclo se detiene; el despachador de cada minuto la retoma.
- Migración: `comunicaciones_envios.estado` admite `enviando` y `omitido`; columnas `reclamado_en` y `proceso`. Las cuatro pantallas con `ETIQUETAS_ESTADO_ENVIO` traducen los estados nuevos (y los que se pintaban crudos: `dado_de_baja`, `sin_autorizacion`), y el resumen de `GET /campanas/:id` cuenta `sin_autorizacion`, `omitidos` y `enviando`.
- **Esto arregla** la duda de fondo 1 del informe de textos (la baja del equipo en correo y push masivos). Las guías `f-mensaje-omitido`, `g-baja` y `t-no-contactar` dicen «por ningún canal»; con este parche es verdad también para el equipo.

### Fase 1 — el motor (`lib/recordatorios.js`, arrancado desde `app.js`)

**Tablas nuevas** (`db/init-db.js`, `CREATE TABLE IF NOT EXISTS`):
| Tabla | Qué guarda |
|---|---|
| `recordatorio_reglas` | tipo, nombre, canal (`sms`/`push`/`email`), `activo` (0 de fábrica), plantilla, asunto, `desfase_min` (−1440 = un día antes) **o** `hora_dia`, `gracia_min` (180), filtros (JSON) |
| `recordatorio_envios` | **una fila por (regla, destinatario, ocurrencia)** con clave única `uq_rec_envio`; estado (`reclamado`/`enviando`/`enviado`/`omitido`/`fallido`/`diferido`), motivo, intentos, segmentos, id del proveedor, `debe_salir_en`, `proximo_intento`, marcas de tiempo |
| `recordatorio_tope_diario` | los segmentos de SMS automáticos gastados por día (la reserva) |

**Configuración nueva en `configuracion_campana`:** `recordatorios_activos` (0), `fecha_permitida_propaganda` (vacía), `tope_diario_sms_automaticos` (200), `silencio_inicio` (20:00) y `silencio_fin` (08:00).

**Cómo funciona.**
- **Vuelta cada 60 s en este mismo proceso** (`setInterval(...).unref()`, como `avisosAlertas`). Apagado: solo lee la fila de configuración y sale. Una vuelta lenta no se pisa a sí misma.
- **Sin duplicados:** `INSERT IGNORE` en `recordatorio_envios` ANTES de enviar; solo manda quien de verdad insertó. Tres vueltas a la vez mandan una vez.
- **Catch-up sin reenviar:** manda lo que ya toca (`<= ahora`) dentro de `gracia_min`; lo que ya está registrado no se repite; lo que quedó más allá de su ventana se registra `omitido` («pasó su ventana») para no reevaluarlo. Una «enviando» huérfana se reconcilia como arriba; una «reclamado» abandonada antes de llamar al proveedor se libera y sale una vez.
- **Silencio de 20:00 a 08:00 para push, correo y SMS:** nada sale ni se registra; lo que tocaba en ese rato sale a las 08:00 (la gracia se cuenta desde el fin del silencio).
- **Tope diario de SMS automáticos con reserva previa** (`UPDATE … WHERE segmentos_usados + n <= tope`): nunca más que el `limite_diario` del libro central (`topeEfectivo`) ni más que el cupo de hoy; un envío que falla devuelve su cupo; lo que no cabe queda `diferido` para mañana a las 08:00.
- **Reintentos:** a los 5 y a los 15 minutos; al tercero, `fallido`. «Fuera de la franja del proveedor» es `diferido` y no gasta un intento.
- **Consentimiento estricto** (`puedeEscribirseEstricto`, en `lib/canalesDelEnlace.js`, junto a la regla del enlace «Ya voté»): ficha leída justo antes de enviar; **el NULL no autoriza**, la baja manda, la inscripción por enlace sin confirmar excluye, push solo al equipo, WhatsApp nunca. Lo de las personas del equipo por SMS o correo queda fuera (no tienen casilla de consentimiento): para ellas solo push.
- **Precampaña:** antes de `fecha_permitida_propaganda` (vacía = nunca) la plantilla no puede decir voto/votar/votó/votación/votante, elección/electoral, elegir, urnas, tarjetón, cargo, ni el nombre de un cargo (alcaldía, concejo, gobernación, asamblea, senado, cámara de representantes, JAL, edil… y el cargo que la campaña tenga configurado). Lo rechaza `guardarRegla` al guardar **y se vuelve a comprobar con el texto ya armado al enviar** (por si la fecha se mueve). Una plantilla de «¿ya votaste?» no se puede guardar antes de esa fecha: es lo previsto.
- **Plantillas por tipo, variables en lista cerrada:** base `{nombre}`, `{candidato}`, `{eslogan}`; `evento` suma `{titulo_evento}`, `{fecha_evento}`, `{hora_evento}`, `{lugar_evento}`; `ya_votaste` suma `{puesto}`, `{enlace_ya_vote}`. Una variable fuera de la lista se rechaza; si falta el dato de una variable al armar, no se manda a medias.
- **Un solo segmento GSM-7:** el validador mide con el peor caso de cada variable, sin tildes, con la **firma del operador** y con el **enlace de baja de 78 caracteres** (el tipo de Día D no lo lleva), y rechaza lo que pase de 160; al enviar se vuelve a medir con los datos reales. Push: título ≤ 50 y texto ≤ 140. Correo: exige asunto.
- **Fuentes de candidatos:** `registrarTipo(nombre, { candidatos })` — una por tipo, se escribe en las fases siguientes. Una regla activa sin fuente no hace nada (lo avisa una vez en el log).
- `guardarRegla` (para la pantalla): valida y guarda; una regla **nueva nace apagada**.

### Pruebas
- **`scripts/probar-recordatorios.js` — 127 comprobaciones**, sobre una base nueva (se niega a correr si el nombre no empieza por `simulada` o `prueba`): migración repetible y valores de fábrica · Fase 0 (fila ajena no se toca, reintentar dos veces, «enviando» antes de llamar y su id, reconciliación con y sin rastro, relectura de baja/autorización/ya votó/equipo, regla estricta del enlace, fuera de franja → reprogramada y luego enviada) · apagado de fábrica · duplicados (tres vueltas simultáneas) · catch-up (de madrugada, el mismo día, vencido) · silencio (21:00, 20:00, 07:59, 08:00; push también) · tope (con dos vueltas a la vez; límite del libro central; devolución al fallar) · consentimiento (NULL, 0, baja, sin teléfono, enlace sin confirmar, push, «ya votó») · precampaña (14 textos prohibidos, el cargo configurado, el asunto, fecha futura/hoy/vacía, y otra vez al enviar) · un segmento (con firma y baja) · reintentos (5 y 15 min, fallido al tercero, fuera de franja) · «enviando» y «reclamado» abandonadas.
- Las otras ocho suites, cada una sobre una base nueva, siguen bien: `probar-manuales`, `probar-comunas-dashboard`, `probar-inscripcion-enlace` (467), `probar-logistica`, `probar-panel-alcance`, `probar-panel-lider`, `probar-transporte-diad` (123) y `probar-transporte-parte2`.
- **No se arrancó `app.js` entero** (escucha en el puerto de producción y valida la licencia): se comprobó su sintaxis y que `iniciar()` devuelve un temporizador que no retiene el proceso. Tras aplicar el parche en una campaña, mirar el registro de PM2 y que no salga ningún «Recordatorios:» de error.

### Lo que NO está hecho (fases siguientes)
Fuente de candidatos de **eventos** (aviso X horas antes, a asistentes con autorización y al equipo por push) · fuente del **«¿ya votaste?»** a la hora H (solo a quienes no han votado) · **pantalla** del administrador (activar, probar, ver lo enviado; `fecha_permitida_propaganda`, tope y silencio se editan hoy solo en la base) · plantillas guardadas por tipo · reporte de entrega.

## Parche 299 — Manuales: textos revisados (8 de noviembre de 2026, publicado; registro y activación por el usuario)

Zip de **154 archivos** (`.version-base` = 299): **137 guías** de `manuales/bloques/` corregidas, **15 capturas** rehechas y **3 nuevas** (`public/manuales/img/`), `manuales/LEEME.md` y `.version-base`. **Requiere el 298.** Sin `db/`, sin código de la app y sin service worker: no toca la base. Publicado (huella verificada); el registro y la activación los hizo el usuario.

**Cómo se hizo (orden Manuales 5).** Los 161 bloques los habían escrito agentes leyendo el código, sin ver pantallas. Esta vez siete agentes (uno por área) abrieron cada pantalla en Chromium sobre la base desechable con datos inventados (`ver.js`: abre una ruta como un rol, hace los pasos y cuenta lo que se ve, con foto) y la compararon con la guía y con el código. Corrigieron directo los errores claros en SUS archivos y anotaron las dudas de fondo en un informe cada uno. Yo comprobé después una muestra contra el código (horas de las alertas, umbral de 5 votantes de «Baja votación») y unifiqué un término. **No se tocó la app.**

| Área | Guías revisadas | Corregidas |
|---|---|---|
| Básicos (ingreso, menú, ayuda, instalación) | 20 | 15 |
| Votantes (registro, autorizaciones, enlace y QR) | 23 | 19 |
| Estructura (territorial, organigrama, testigos, mapa, dashboard) | 21 | 17 |
| Comunicaciones (CRM, SMS, correo, avisos, agenda, eventos, finanzas…) | 27 | 25 |
| Día D, campo (faltan por votar, alertas, testigo) | 27 | 20 |
| Día D, gestión (resultados, logística, transporte, cobertura) | 26 | 24 |
| Administración (configuración, usuarios, permisos, copia, mensajería) | 17 | 17 |
| **Total** | **161** | **137** |

(Cuenta de archivos con cambios en `git`; cada agente informó cifras algo distintas porque contó guías con varios arreglos o cambios de un solo término.)

**Lo más grave que estaba mal en las guías:** el contador «Diferencias (N)» de Resultados (cuenta el filtro, no todas las mesas; no hay umbral: basta 1 voto) y un permiso «Importar / Exportar» que ese módulo no tiene · el enlace del conductor solo abre el día de «Fecha de elecciones» · «Voy en camino» manda un SMS que gasta crédito y solo si la persona aceptó · las horas de las alertas (testigo que no llegó a las 8:30, mesa sin E-14 a las 6:00 p. m., baja votación solo con 5 votantes o más; transporte y logística no existen fuera del día) · «Editar» no se exige en Faltan por votar (con «Ver» basta) · A los líderes no se les abre portada con tarjetas (solo al administrador) y el administrador no tiene «Panel completo» en el celular · `g-aspirante`: con identificación entra como líder, el aspirante solo entra por la puerta del código · «Cuentas guardadas» no se crea desde la puerta de líderes · una celda vacía al **importar por Excel** borra el dato de la ficha · el paso 2 de `t-crm-campana` (la pantalla abre sin grupos; un grupo sin filtros es toda la base) · de los 160 caracteres de un SMS salen la firma y el enlace de baja (~78) · `g-apoya-a` decía Dashboard de votantes y es el Panel general.

**Metadatos cambiados (quién ve qué):**
- `f-compartir-qr`: de módulo `votantes` a `roles: lider,sublider,coordinador` (admin, asistente y testigo no tienen enlace y la veían).
- `t-organigrama-agregar`: `roles: admin, coordinador` (líder y testigo la recibían sin poder crear cargos; la matriz da «Agregar» pero rutas y botones lo reservan).
- `t-baja-manual`: `roles: admin, coordinador` (antes módulo `votantes` nivel `editar`).
- `t-no-contactar`: `roles: admin, coordinador` (antes módulo `crm`; la ruta es solo de ellos).
- `g-firma-sms`: módulo `enviar_sms` (antes `configurar_crm`, que solo ve el administrador).
- `t-votantes-importar`: se quitó la `ruta:` (el botón de importar no está en el menú).
- Coherencia (mío): donde «cargo» significa el **rol** de la persona (b-ayuda, b-cerrar-sesion, b-entrar, b-menu, b-sin-codigo, f-no-veo-menu, mod-votantes_dashboard, t-dashboard-exportar) pasó a «rol», como `g-rol` y la pantalla de permisos («tipo de usuario»). «Cargo» se conserva donde es el nombre en pantalla (Estructura, organigrama, mapa, filtros de mensajes).

**Capturas** (rehechas con `scripts/capturar-manuales.js --solo …`): `b-menu` (no mostraba ningún botón del menú), `mod-usuarios` (1600 px para que se vean Editar / Restablecer clave / Eliminar), `mod-configuracion` (grupo Configuración abierto con sus cinco entradas), `t-permisos-administrativo` (resalta la fila Administrativo), `t-transporte-alerta` (la alerta de verdad, no la de «mesa sin testigo»), `t-organigrama-agregar` (muestra «Ninguno — cargo raíz»), `t-testigo-reporte` (resalta «Enviar reporte»), `t-asistencia`, `t-no-contactar` (antes salía vacía), `mod-enviar_sms` (con el contador de caracteres), `t-crm-campana` (el grupo) y las **nuevas** `t-crm-campana-2` (Enviar campaña), `t-finanzas-importar` (Cuentas Claras) y `t-conductor-enlace` (la columna «Enlace para el conductor»; la pantalla del conductor pasó a `t-conductor-enlace-2`).
- **Semilla** (`scripts/capturas/semilla.js`): dos personas con baja (una por SMS, otra anotada a mano) y `transporte_alerta_desde = 00:00` para que la alerta de transporte se vea activa.
- **Orden de las imágenes de una guía:** antes se ordenaban con `sort()` plano y el `-2` quedaba **antes** que la imagen base (`t-qr-enlace` mostraba primero la página pública que ve la persona). Ahora van por nombre de archivo sin extensión: base y luego `-2`. Se reordenó el `captura:` de 8 guías (mod-legislacion, mod-votantes, mod-recursos, mod-logistica_dia_d, mod-alertas_dia_d, mod-rescate_votos, t-qr-enlace, t-estructura-agregar). Con `--solo`, si se rehace una imagen de una guía con dos, hay que rehacer las dos (`LEEME.md` lo dice).
- Sin recapturar, aunque los agentes lo sugirieron (mejoras, no errores): `t-votante-agregar-2` (paso 4 con la firma), `t-dashboard-exportar`, `t-estructura-agregar-2`, `t-baja-manual`, `t-push-avisos`, `t-resultados-diferencias` y `t-resultados-oficial` (tablas vacías: hace falta sembrar reportes de mesa), `t-cobertura`/`t-config-puestos` (la tabla de puestos necesita el catálogo, que la prueba no tiene) y `mod-alertas_dia_d` (muestra «00:30» porque la jornada de la base de prueba es 00:00–23:59).

### Dudas de fondo para que decida el dueño del producto (la app NO se tocó)

*Seguridad y datos*
1. **La baja del equipo no se respeta en correo ni aviso masivos** (`comunicaciones.routes.js`, `obtenerDestinatarios`, ramas estructura/testigos/ambos no leen `no_contactar`). En SMS sí se cumple, pero sale «fallido» y no «omitido». Las guías dicen «por ningún canal»: hoy es verdad para votantes, no para el equipo. Es lo más serio.
2. **Un líder ve y puede borrar el historial de TODAS las campañas de mensajes** (`GET /comunicaciones/campanas` no filtra por autor; «Eliminar» sin contraseña), y el **consolidado de asistentes** entrega cédula y teléfono de todos a cualquier líder.
3. **Importar por Excel (votantes, estructura, testigos):** una celda vacía borra el dato de la ficha. Además importar sin cédula crea una cuenta con clave aleatoria que nadie ve, y el aviso de teléfono inválido no coincide con lo que se guarda.
4. **Cerrar sesión sin señal** no cierra la sesión del servidor (la cookie vive hasta 8 h): en un celular compartido, la siguiente persona entra como la anterior.
5. **El permiso «Editar»/«Agregar» de la matriz no se hace cumplir** en Faltan por votar, Alertas, Resultados, Transporte ni Logística (solo «Ver»); tampoco en Estructura territorial ni Organigrama (rol fijo), aunque la nota de la pantalla de permisos lo promete. Opciones: exigirlo en el servidor o corregir la nota y bajar las guías a `nivel: ver`.
6. **Columna «Usuarios» de la matriz sin filas en una instalación nueva:** si el administrador pulsa «Guardar cambios» sin marcarla, se escribe `permitido=0` y se le oculta la pestaña Usuarios (leído en código, no ejecutado).
7. **«Rol / Perfil» al crear usuario nace en «Admin»** y muestra los roles crudos (`Lider`, `Asistente_administrativo`).

*Precampaña (cargos de elección que siguen en la PANTALLA, no en las guías)*
8. «Cargo al que aspira» (Senado, Cámara, Gobernación, Asamblea, Alcaldía, Concejo, JAL), «Activar apoyos»/«Apoya a» (formularios, filtro, columna, Panel general «A quién apoyan», Excel), «Acceso a Aspirantes al Concejo» en el ingreso del celular, el rol interno `aspirante_concejo`, y las tarjetas de campaña de `/app/inicio.html`. Si la regla de precampaña también cubre la interfaz, es trabajo de la app.

*Quién ve qué*
9. **El asistente administrativo** tiene de fábrica «Ver» en Configuración, Finanzas y CRM y ve esas entradas en el menú, pero las pantallas le responden «Solo un administrador…» / «No tiene permisos» (403); además su alcance de Votantes es «lo que yo registré» (ve 0) aunque la guía dice que marca «Datos verificados».
10. **El testigo y el asistente** reciben las guías de registrar y la pantalla les ofrece «+ Nuevo votante o sublíder», pero el servidor les niega el alta. El líder ve «Eliminar registros» y «Re-geocodificar» aunque la ruta es de admin/coordinador.
11. **Ranking:** `t-avance-ranking` y `g-sin-movimiento` las reciben líderes y sublíderes (módulo `rescate_votos`), que no pueden abrir el ranking.
12. **El administrador en celular** aterriza en Panel general, que no tiene Ayuda ni Cerrar sesión en su barra inferior; el celular no tiene versión de Transporte (abre la de escritorio).

*Textos de la app*
13. **«Fecha de elecciones» dice «Informativa»** pero gobierna Modo prueba, el enlace «Ya voté», el enlace del conductor y las alertas de transporte, logística y push.
14. El **ingreso de líderes** (`pattern="[0-9]*"`) rechaza contraseñas con letras, que el correo de recuperación sí permite crear; el bloqueo de 15 min no reinicia el contador (un solo error más bloquea otros 15); «Cuentas guardadas» y «Mantener sesión» no se alcanzan desde la puerta de líderes.
15. Erratas y crudos en pantalla: «Respondio…», «No quedo registrado», «Entro con su numero de identificacion», el rol en crudo en el pie del menú, estados `dado_de_baja` y `sin_autorizacion` sin traducir en «Ver detalle», nota del SMS que dice «Twilio» siendo Onurix, «Eventos y movilización» vs «Eventos y GOTV», mezcla de «usted» y «tú».
16. **Agenda:** el encabezado promete «Pulse un día para ver lo que hay en él» y no hace nada; editar un evento desde la Agenda borra su Departamento y Ciudad; abre «Editar evento» a quien no puede guardar.
17. **SMS:** `forzar_gsm7` borra tildes y emojis antes de enviar (el contador avisa «caben 70»); con la firma y el enlace de baja a un SMS le quedan ~50 caracteres; programar fuera de horario no se rechaza al programar, falla en el envío. El tope legal del reporte de Cuentas Claras sale siempre «Sin tope registrado».
18. **Mensaje rojo «Ya registrado por otro líder»** sale también cuando la ficha es tuya; quien se inscribe por enlace sin marcar SMS queda «sin confirmar» para siempre; un sublíder sin cédula se guarda desde el celular sin cuenta y sin aviso.
19. «Sin movimiento» y «Última marca» del ranking cuentan marcas de cualquier día; el candidato propio se reconoce por nombre exacto (si no coincide, el consolidado muestra 0 sin avisar); desmarcar «Para reclamar» borra la nota.

### Fallos de la app al seguir los pasos
- **Organigrama (admin, coordinador), «+ Agregar cargo raíz»:** «Es subordinado de» abre con otro cargo elegido en vez de «Ninguno — cargo raíz»; guardado así, el «raíz» cuelga de él (probable causa: el reordenado alfabético de selects de `common.js`).
- **`/territorial.html#testigo-nuevo` (admin), «+ Nuevo testigo» de la cobertura:** abre el formulario con la categoría «Líder»; si se guarda, crea un líder.
- **Celular, «Falta la firma de la persona»:** lleva al paso 3 y marca el Teléfono, en vez del paso 4 (la palabra «teléfono» del aviso confunde a `destinoDelError`).
- **Celular, ingreso de líderes:** una contraseña con letras no se puede enviar y no sale ningún mensaje de la app.
- **Agenda:** editar un evento borra Departamento y Ciudad (leído en código).
- Sin catálogo, la prueba da 503 en `/api/catalogo/*` y 500 en `/api/dia-d/config/puestos-votacion?cobertura=1`: es limitación del entorno. El testigo sin logística recibe 403 en `/api/dia-d/logistica/mi-puesto` en cada carga (esperado).

### Pruebas
- `probar-manuales`, `probar-comunas-dashboard`, `probar-inscripcion-enlace` (467), `probar-logistica`, `probar-panel-alcance`, `probar-panel-lider`, `probar-transporte-diad` (123) y `probar-transporte-parte2`: **todas bien, cada una sobre una base nueva**.
- **Chromium a 390 px** como líder, testigo, coordinador y sublíder viendo `/ayuda.html`: sin scroll horizontal en los cuatro; de las imágenes se comprobó que responden (200) las 67 del coordinador; las del líder y el testigo no se comprobaron una por una.
- Plantilla v299 probada sobre base vacía (arriba).
- **Los informes completos de los siete agentes** (tabla de correcciones por guía, antes/ahora) están en el scratchpad de la sesión y NO se guardaron en el repositorio: el detalle está en el historial de `git` de `manuales/bloques/`.

## Parche 298 — Manuales: capturas de pantalla (8 de noviembre de 2026, publicado; registro y activación por el usuario)

Zip de **150 archivos** (`.version-base` = 298): **76 capturas** `public/manuales/img/*.webp`, **68 guías** con su `captura:` llena (`manuales/bloques/`), `manuales/LEEME.md`, `lib/manuales.js`, `public/js/ayuda.js`, `public/css/ayuda.css`, `public/service-worker.js` (**v171**) y `.version-base`. **Requiere el 297.** Sin `db/`: no toca la base. Pesan **3.544.480 bytes en total** (la mayor, 85 KB; el tope es 150).
Publicado (huella verificada); el registro y la activación los hizo el usuario.

- **De dónde salen.** `scripts/capturar-manuales.js` (con `scripts/capturas/{lista,semilla,servidor,navegador}.js`; no viaja en el parche, sí en la plantilla): siembra una base `simulada…` con datos **inventados**, monta las **rutas reales** de la aplicación, entra por cookie con cada rol (admin, coordinador, líder, testigo o sin sesión), navega, hace los pasos, dibuja el recuadro amarillo `#FFC300` de 3 px, recorta y guarda WebP (calidad 75, escala 2 en celular a 390 px y 1 en escritorio a 1280 px; si pasa de 150 KB baja la calidad). Se **niega a correr** si `DB_NAME` no empieza por `simulada`/`prueba`, y **se niega a guardar** una captura cuyo texto visible (dentro del recorte; no cuentan las opciones cerradas de un desplegable) nombre un cargo de elección. Campaña de prueba: «Campaña de ejemplo». Se rehacen todas con un comando; `--solo id1,id2` rehace unas.
- **Precampaña, lo que apareció.** El guardia rechazó tres pantallas por **textos fijos del producto**, no por datos: la pantalla de ingreso del celular («Acceso a Aspirantes al Concejo»; se usó la de escritorio), el Panel general («A quién apoyan: Alcaldía» más abajo; se recortó arriba) y el formulario de «Agregar persona» (opciones de cargo; se muestra la pantalla con el botón resaltado, sin abrirlo). En la primera pasada, cuando miraba **todo** el texto de la página, rechazó otras cuatro por las opciones de desplegables cerrados (Estructura territorial, Votantes, Usuarios, Configuración); se afinó para mirar solo lo visible dentro del recorte. **Esos textos siguen en la aplicación**: si la regla de precampaña también cubre la interfaz, es trabajo aparte.
- **Mostrarlas** (`ayuda.js`/`ayuda.css`): figura con borde suave y radio de 12 px debajo de los pasos (o del «Para qué sirve» si no los hay), texto alternativo «Pantalla de «título de la guía»», `loading="lazy"`, `width`/`height` reservados (el servidor los lee de la cabecera del WebP y los manda en `capturas`), **máximo 360 px las de celular y 100 % las de escritorio**; un toque la abre en grande (visor modal a tamaño real, con scroll; Esc o × la cierra y devuelve el foco). **Impresión:** salen en el PDF y ninguna se parte (el del líder: 36 imágenes y 36 apariciones en `pdfimages -list`; 87 páginas).
- **Service worker:** v171 **solo porque cambiaron `ayuda.js` y `ayuda.css`** (están en la precarga). Las imágenes **no** están en la precarga: el `fetch` del service worker ya guarda en caché toda respuesta 2xx del mismo origen, así que se cachean al verse.
- **`lib/manuales.js`:** valida cada `captura:` al cargar (nombre `.webp`, existe, ≤ 150 KB, es WebP; si no, aviso y se omite esa imagen), lee su ancho y alto, manda `capturas: [{archivo, ancho, alto, celular}]` y la firma de archivos cuenta también las imágenes (si se rehacen, el manual se recarga y su fecha se mueve).
- **Hechos por el camino.** (1) Los **códigos de enlace y de conductor** usan un alfabeto sin I, L, O, 0 ni 1: `LAURA123` y `EJEMPLO1` salían como «Enlace no activo». (2) La semilla marca su final con el eslogan; antes usé `marca_subtitulo` y salía «Datos de ejemplo (listos)» en el menú de todas las capturas. (3) `texto:+ Nuevo evento` elegía el `div` contenedor (mismo texto que el botón) y no abría el modal: ahora se prefiere lo tocable y lo más profundo. (4) `probar-manuales.js` exigía `captura:` vacío; ahora comprueba lo contrario.

### Guías sin captura (23 de 91; las 70 preguntas y términos no explican una pantalla)

- **No es una pantalla de la app:** `b-instalar-app` (el menú del navegador).
- **Llegan por correo, SMS o un enlace firmado y no se envió ninguno:** `b-codigo`, `b-sin-codigo`, `t-confirmacion`.
- **Abren un selector de archivos o la cámara:** `t-estructura-importar`, `t-votantes-importar`, `t-testigos-importar`, `t-finanzas-importar`, `t-testigo-e14`, `t-resultados-paquete`.
- **Su formulario muestra un cargo de elección en las opciones (regla de precampaña):** `t-testigo-agregar`.
- **Viven dentro de la ficha de una persona (piden contraseña o abren un modal) y no las recorrí:** `t-cedula-privacidad`, `t-autorizaciones`, `t-baja-manual`.
- **Pantalla protegida: solo se vería el candado de «Ingresar contraseña de administrador»:** `mod-configurar_crm`, `t-mensajeria`.
- **Comparten pantalla con otra captura:** `t-push-avisos` (Alertas del Día D), `t-catalogo` (Puestos de votación y candidatos), `t-asignacion` y `t-conductor-imprimir` (la lista de conductores de Transporte, ya en `mod-transporte_dia_d`, `t-vehiculos` y `t-conductores`).
- **Sin ruta de menú en la guía o no las intenté:** `t-telegram`, `t-legislacion-admin`, `t-logistica-puesto` (la del testigo necesita un puesto con estado).

### Pruebas

- `probar-manuales` **168 comprobaciones** (con las nuevas: cada captura referenciada existe, no sobra ningún archivo —atrapó mi `dep-evento.webp` de depuración—, ninguna pasa de 150 KB, todas son WebP legibles, cada una se llama como su guía, ninguna guía lleva más de dos, y `/mio` manda `archivo`, `ancho`, `alto` y `celular` a los diez roles), `probar-panel-lider` **87**, `probar-panel-alcance` **43**, `probar-comunas-dashboard` **73**, `probar-logistica` **114**, `probar-transporte-diad` **123**, `probar-transporte-parte2` **80**, `probar-inscripcion-enlace` **467**, cada una sobre su base nueva, todo bien.
- **Chromium a 1280 y 390 px** como líder, testigo y administrador (viendo el manual del líder y el del testigo): sin scroll horizontal, las 36 (líder) y 23 (testigo) capturas cargan, todas con su texto alternativo y `loading="lazy"`, las de celular no pasan de 360 px y las de escritorio ocupan el 100 %, sin errores de JS; el visor abre y cierra con Esc y devuelve el foco. Revisión a ojo de casi todas las capturas en hojas de contacto (de baja resolución, así que lo fino lo cubre el guardia de texto y el hecho de que todo sale de la semilla): ninguna trae datos reales ni un cargo de elección (los textos de la pantalla de Legislación son el calendario electoral público del propio módulo).

## Parche 297 — Manuales: diseño final (8 de noviembre de 2026, publicado; activado por el usuario)

Zip de **6 archivos** (`.version-base` = 297): `public/ayuda.html`, `public/css/ayuda.css`, `public/js/ayuda.js`, `public/app/app-comun.js` (errata «Reptala» → «Repítela» en el cambio obligatorio de clave del celular), `public/service-worker.js` (**v170**) y `.version-base`. **Requiere el 296.** Sin `db/`, sin `lib/` ni `routes/`: el HTML de los manuales lo sigue armando `lib/manuales.js` y los recuadros se pintan solo con CSS.
**Estado:** publicado por el usuario (la sesión no pudo: el permiso de «despliegue a producción» se lo negó al clasificador); el zip del servidor tiene la misma huella que el local. El registro y la activación los hizo el usuario; no se pueden comprobar desde `gariasappelectoral`.

La muestra (`manual-lider-muestra.html`, pegada al final de la orden) **no estaba en disco**; se guardó fuera del repo solo para comparar a 1280 y 390 px.

### Qué difería de la muestra y qué se ajustó

- **Portada:** era una tarjeta redondeada de borde amarillo abajo; ahora ocupa todo el ancho de la columna, con degradado `--color-marca-oscuro` → `--color-marca`, etiqueta amarilla «Centro de ayuda · Manual de uso», «Manual del **Líder**» con el rol en amarillo, **chips** (Tu rol · Se arma con tus permisos de hoy · **Lectura calculada**: palabras del manual ÷ 200 por minuto · fecha del contenido), botones «Imprimir o guardar en PDF» (amarillo) y «Preguntas frecuentes» (blanco), franja amarilla de 6 px y aro decorativo. Los chips de «N guías / preguntas / términos» se quitaron (el índice ya las cuenta).
- **Buscador:** estaba debajo de la portada y pegajoso; ahora va montado sobre la franja, borde azul de 2 px, sombra, lupa SVG, texto de sugerencias, y el mensaje de la muestra cuando no hay resultados. El resaltado sigue en amarillo. Dejó de ser pegajoso (en el celular chocaba con la barra «☰ Menú»).
- **Índice:** numerado con cuadritos azul claro, fijo en escritorio, arriba en celular. Se mantienen los grupos («Primeros pasos», «Antes»…) como rótulos sin número.
- **Guías:** tarjeta blanca de 16 px de radio, ícono 48 px en cuadro azul (**amarillo en las del Día D**), título 23 px en `--color-marca-oscuro`, ruta del menú en **pastillas**, recuadro azul claro «**Para qué sirve:**» en línea, **pasos con círculo amarillo y línea gris**, insignias de permisos **verdes** y las que no tiene **grises y tachadas**.
- **Recuadros:** con borde izquierdo de 5 px, y los colores **estaban cambiados**: «Consejo» era azul y «Importante» amarillo; ahora Consejo = amarillo, Importante = azul, Cuidado = rojo, «Así sabes que funcionó» = verde. El ícono (💡 📌 ⚠️ ✅) sale del CSS (`::before`), así que no hubo que tocar `lib/manuales.js`.
- **Guía del rol (nueva):** cada manual abre con «Tu rol en la campaña» (o «El rol en la campaña» cuando el administrador mira el de otro rol), armada en el navegador con los datos reales: la descripción del rol, la **rejilla Antes / Durante / Día D** (cuántas guías tiene esa fase para esos permisos y las primeras tres; la de Día D con borde amarillo; cada tarjeta lleva a su sección) y los módulos que puede ver, en verde. No aparece en el manual de instalación.
- **Preguntas frecuentes** y **glosario:** cada uno en su tarjeta con ícono; preguntas plegables con «+» y «–»; glosario en dos columnas (término | definición) que pasa a una en el celular (≤ 820 px).
- **`@media print`:** como el de la muestra (sin buscador, botones, índice ni menú; portada con color exacto; preguntas desplegadas).

### Dónde NO se siguió la muestra al pie de la letra, y por qué

1. **Índice plegado en el celular.** La muestra lo trae abierto porque tiene 8 entradas; aquí hay de 12 a 75 (el coordinador), y abierto taparía el manual entero. En ≤ 1099 px arranca cerrado, con «▾», y se pliega solo al elegir; en escritorio va abierto y fijo. El corte pasó de 1000 a **1100 px**: con el menú lateral de 248 px, a 1000 px el contenido quedaba en 470 px.
2. **Impresión: `break-inside: avoid-page` solo en guías cortas.** Puesto en todas, como en la muestra, el PDF del líder pasó de **54 a 89 páginas** (las guías largas saltaban a hoja nueva y dejaban media página en blanco). Ahora el JS marca `.corta` (< 420 px de alto) al imprimir y solo esas no se parten: **60 páginas** el del líder, 47 el del testigo.
3. **Pasos sin título en negrita:** la muestra tiene «**Abre el enlace**» + una línea; los textos de `manuales/bloques/` son una frase por paso. No se inventaron títulos.
4. **Títulos de sección** («Primeros pasos», «Antes: preparar la campaña»…) se conservan sobre las tarjetas: con 39 a 85 guías el orden por fases sí hace falta; la muestra, con 6, no lo necesita.

### Pruebas (sobre mysqld privado, bases `simulada…`)

- **Chromium a 1280 y 390 px** con los diez roles, contra el servidor real de `routes/manuales.routes.js` y la base inicializada: **sin scroll horizontal, sin errores de consola, un elemento del índice por tarjeta**, y la portada del administrador con sus 11 tarjetas. Búsqueda («QR» → 11 resultados con 25 resaltados; «cedula» encuentra «cédula»; una palabra inexistente muestra el mensaje y esconde las dos cajas; borrar restaura todo), el botón «Preguntas frecuentes» baja hasta ellas incluso con la búsqueda vacía de resultados, el administrador ve el del testigo con «← Todos los manuales», y el de instalación sin guía del rol.
- **PDF** del líder (60 páginas) y del testigo (47): sin menú, índice, buscador ni botones. Capturas y PDF en `backups/manuales-verificacion/orden3/` (ignorada por git; no viaja).
- **Suites:** `probar-manuales` **150**, `probar-panel-lider` **87**, `probar-panel-alcance` **43**, `probar-comunas-dashboard` **73**, `probar-logistica` **114**, `probar-transporte-diad` **123**, `probar-transporte-parte2` **80**, `probar-inscripcion-enlace` **467**, todo bien.
  **Dos trampas que aparecieron:** (a) tres suites (`logistica`, `transporte-diad`, `inscripcion-enlace`) comprobaban el service worker con una expresión que llegaba **hasta la v169**: subir a v170 las rompía. Se abrieron hacia arriba (`v1xx` y `v2xx`) para no tener que editarlas en cada subida; viajan solo en la plantilla. (b) Corridas seguidas sobre una misma base dan fallos falsos (`Duplicate entry '0-PUESTO A'`, conteos de otras suites): **cada suite sobre su base nueva** (`fresca.sh`).

## Parche 296 — Panel del líder en el celular y cierre de fugas de alcance (8 de noviembre de 2026, INACTIVO, no toca la base)

Zip de **17 archivos** (`.version-base` = 296): `lib/panelLider.js` y `routes/panelLider.routes.js` (nuevos), `public/app/panel-lider.js` y `public/app/panel-lider.css` (nuevos), `app.js` (una línea), `middleware/aspirante.js`, `routes/dashboard.routes.js`, `routes/votantes.routes.js`, `routes/configuracion.routes.js`,
`public/app/inicio.html`, `public/app/faltantes.html`, `public/app/alertas-dia-d.html`, `public/dashboard.html`, `public/js/offline-utils.js`, `public/js/cuentas-dispositivo.js`, `public/service-worker.js` (**v169**) y `.version-base`. Commit `1b45bd5`. **Requiere el 295.** Sin `db/`: no toca la base (el `PATCH` usa columnas y el disparador de `puesto_id` que ya existían).

### Parte A — cinco fugas de alcance (lo que se midió en la lectura anterior)

1. **`GET /dashboard/tabla-posiciones`.** A un líder sin sublicencia le devolvía el nombre y los registros de hasta 50 personas de **toda** la campaña (y contados sin acotar). Ahora **líder, sublíder, testigo, usuario e invitado** reciben solo **`{ lugar, de }`** (testigo, usuario e invitado, `lugar: null`): el líder se mide contra los líderes activos y el sublíder contra los sublíderes, cada uno con la definición de inscritos
   de SU lista (líder: `lider_id`; sublíder: `sublider_id` o `lider_id`); los empates comparten lugar. Administrador, coordinador, asistente, administrativo y aspirante con sublicencia **siguen recibiendo la lista**, como antes. `dashboard.html` pinta «Vas en el lugar X de N». *La orden nombraba solo líder y sublíder; se extendió a testigo, usuario e invitado porque tienen el mismo alcance propio y la misma fuga.*
2. **`GET /votantes/resumen`.** Sin alcance ni guarda: los 15 territorios con más votantes de toda la campaña a cualquier sesión. Ahora lleva `condicionAlcanceVotantes` (el administrador, que tiene alcance `madre`, sigue viendo todo).
3. **`GET /configuracion/campana`.** Devolvía la fila entera (`SELECT *`): meta de votos de la campaña, dirección de la sede, teléfono y correo. Líder, sublíder, testigo, usuario e invitado reciben ahora una **lista blanca**: candidato, cargo, lema, partido, departamento y ciudad, los niveles territoriales que se usan, `fecha_eleccion` y todo lo que empiece por `marca_`, `hay_datos_` o `apoyos_` (lo que arman sus formularios y la tarjeta de inicio). Una columna nueva de la tabla no sale a la calle hasta que se decida.
   Administrador, coordinador, aspirante y el personal administrativo siguen con la fila completa (el administrativo ve las metas en el Panel de todos modos; recortarlo habría dejado en blanco la pantalla de Configuración que esos roles abren). *Pendiente que NO se tocó:* `GET /dashboard/resumen` sigue enviando `metaVotosCampana` a líder y sublíder.
4. **Copia sin señal (IndexedDB y localStorage).** Las copias de LECTURA (`faltantes_cache`, `alertas_cache` y el nuevo `panel_lider_cache`) llevan el id del usuario en su clave (`u<id>:…`) y `leerCopiaOffline` solo devuelve la de quien está en la sesión; **se borran al cerrar sesión (`desactivarCuentaDispositivo`) y cuando entra una cuenta distinta a la anterior** (`registrarUsuarioSinSenal`,
   que llama `actualizarPerfilCuentaDispositivo` en cada pantalla de la app), junto con los `cache_ref_*` de localStorage. **Las COLAS de lo pendiente de subir (registros, marcas «ya votó», llegadas, transporte, logística…) NO se borran:** son trabajo sin enviar y borrarlas sería perderlo. Se les asigna dueño (`usuarioId`) y solo la sesión de su dueño las ve y las sube; lo guardado antes de este cambio no trae dueño y se le sigue mostrando a quien entre.
   `OFFLINE_DB_VERSION` pasa a 6 (cajón `panel_lider_cache`).
5. **Una sola definición de «inscritos»:** la de la lista (`condicionAlcanceVotantes` con `req.alcance`), en `lib/panelLider.js`. `/dashboard/mi-progreso` la usa (antes contaba `lider_id` suyo o de sus sublíderes de estructura y la barra podía no cuadrar con la lista). Para el aspirante con rol `lider` se cuenta con su alcance de rama y la meta sale de su fila de estructura (`req.alcance.usuarioId`), nunca de `req.session.usuario.id` a secas.

### Parte B — el panel

- **`GET /api/panel-lider`** (solo líder, sublíder y aspirante; el coordinador tiene «Avance de mis líderes»; sin parámetros: quién es sale de la sesión, y mandar el id de otro líder en la URL no cambia nada): `meta` (`tieneMeta`, `meta`, `inscritos`, `porcentaje`, por tu enlace y sin confirmar; con meta 0 o sin fila de estructura, `tieneMeta: false`), `ultimos_7_dias` (por día, hora de Colombia, ceros rellenos, hoy al final),
  `pendientes` (sin teléfono, sin puesto —sin `puesto_id` y sin texto— y sin verificar, este último solo informativo), `equipo` (por sublíder, **solo nombre, registros y meta**), `posicion` (`{lugar, de}`, sin nombres) y `dia_d` (total, votaron, faltan y porcentaje, con `modo_prueba` y `fecha_eleccion`) **solo si tiene «Ver» en `rescate_votos`** (fuera del día de la elección la pantalla trabaja en modo prueba: quien tiene el módulo lo ve siempre, con su etiqueta).
  El aspirante: sus inscritos son los de su rama; su barra se mide contra la meta de SU campaña (`sublicencias.meta_votos`), sin ella «Aún no tienes meta asignada»; sin «lugar»; su equipo son quienes le reportan directo.
- **`GET /api/panel-lider/pendientes?tipo=sin_telefono|sin_puesto&page=`**: 20 por página; solo id, nombre, barrio y lo que falta (sin cédula, teléfono ni correo); con alcance; tipo inválido, 400.
- **`PATCH /api/votantes/:id/datos-basicos`**: solo `telefono`, `puesto_id` y `mesa` (otro campo, 400); 403 fuera del alcance (y para una ficha que no existe, para no decir si existe); roles que registran (admin, coordinador, líder, sublíder, usuario, asistente) y aspirante; teléfono de 10 dígitos; el puesto debe ser de la lista de la campaña (`dia_d_puestos_votacion`, sembrada del catálogo oficial) y se guarda con su nombre completo y su id del catálogo (el disparador resuelve `puesto_id`);
  mesa de 1 hasta las del puesto (cambiar de puesto sin elegir mesa vacía la anterior); **sin contraseña**; auditoría (`completar_datos_basicos`, sin el teléfono completo) y **tope de 120 cambios cada 10 minutos por usuario** (429).
- **`app/inicio.html`** (líder, sublíder y aspirante con rol líder; arriba del menú; `panel-lider.js` y `.css`, en la precarga del service worker): tarjeta «Día D» con «Faltan N por votar» y botón a Faltantes (con «Modo prueba» si no es el día), «Mi meta» con barra (o «Aún no tienes meta asignada» con el conteo), «Vas en el lugar X de N», barras de 7 días, «Por completar» (las de teléfono y puesto abren una hoja con la lista y «Completar», un formulario corto de teléfono, puesto y mesa;
  «sin verificar» solo informa), «Mi equipo». **Sin señal:** la última copia del usuario con su hora («Sin señal: esta es la copia de las 04:03 a. m. Solo puedes mirarla») y **sin acciones**.

### Pruebas
- `scripts/probar-panel-lider.js` (no viaja): **87 comprobaciones sin fallos**, con un líder, su sublíder, otro líder, un aspirante con rol líder, un coordinador, un testigo y el administrador: tabla de posiciones (lugares calculados aparte; la lista sigue para quien debe), `votantes/resumen` por alcance, campos de `configuracion/campana` por rol, `mi-progreso` = total de la lista para líder, sublíder y aspirante, el panel entero (7 días por día, pendientes contados aparte, equipo con solo tres claves, posición, Día D con y sin modo prueba, sin Día D si se apaga el módulo),
  que ningún nombre, teléfono ni cédula de otra persona aparece en ninguna respuesta, que el id de la URL se ignora, `pendientes` con alcance, y el `PATCH` (validaciones, 403 fuera de alcance para líder, sublíder, aspirante y testigo, auditoría sin teléfono, tope por usuario).
- Suites `probar-panel-alcance`, `comunas-dashboard`, `logistica` (su comprobación de la versión de IndexedDB acepta la 6), `transporte-diad`, `transporte-parte2`, `inscripcion-enlace` y `probar-manuales`, sin fallos.
- **Chromium a 390 px** con las rutas reales y datos de ejemplo (líder, sublíder, aspirante, coordinador, otro líder y un 1280 px): el panel se ve arriba del menú y sin scroll horizontal; completar un teléfono y un puesto saca a la persona de la lista (3 → 2) y baja la tarjeta; **sin señal** muestra la copia con su hora y sin botones; **al entrar otro líder se borran las copias del anterior** (panel y faltantes), el nuevo no puede leerlas, y cerrar sesión las borra;
  una marca sin subir de un usuario no la ve ni la sube otro y NO se pierde al cambiar de cuenta; el coordinador no ve el panel. Capturas en `backups/panel-lider-verificacion/` (ignorada por git; no viaja).
- **No probado:** un teléfono real; el service worker instalado (se probó la lógica de copias con IndexedDB real de Chromium, no la PWA instalada); el catálogo territorial real (`territoriosdb` no existe en la base de pruebas: el puesto se valida contra la lista de la campaña y el disparador resuelve el id por nombre); datos de una campaña real (hasta 10 votantes por prueba).

## Parche 295 — Manuales de ayuda nuevos por rol (8 de noviembre de 2026, INACTIVO, no toca la base)

Zip de **190 archivos** (`.version-base` = 295): **177 de `manuales/`** (161 bloques, 15 de instalación y `LEEME.md`) y 13 de código: `lib/manuales.js` y `routes/manuales.routes.js` (nuevos), `app.js` (una línea), `routes/permisos.routes.js`, `middleware/aspirante.js`,
`public/ayuda.html` (reescrita), `public/css/ayuda.css` y `public/js/ayuda.js` (nuevos), `public/css/style.css`, `public/app/inicio.html`, `public/app/dia-d.html`, `public/service-worker.js` (**v168**) y `.version-base`. Commit `95460c1`. **Requiere el 294.** Sin `db/`, sin dependencias nuevas.
**Las capturas de pantalla NO van en este parche: vienen en el siguiente** (el campo `captura:` de cada bloque está vacío a propósito).

**Qué cambió.** El manual de Ayuda estaba escrito dentro de `ayuda.html` (16 textos de módulo, 15 de los 26 módulos de la matriz con el relleno «Consulta con tu administrador») y, además, **solo funcionaba para el administrador**: pedía `/permisos/matriz`, que es de solo admin, así que cualquier otro rol veía «No se pudo generar el manual».
Ahora el contenido está en archivos y el servidor arma el manual de cada persona con sus permisos reales.

- **Contenido** (`manuales/bloques/<id>.md`, formato en `manuales/LEEME.md`): cabecera con `id`, `titulo`, `seccion` (basicos | antes | durante | dia-d | administracion | faq | glosario), `orden`, `icono`, `modulo` + `nivel` (ver | editar | agregar | importar) o `roles`, `ruta` (pasos del menú) y `captura`. Cuerpo en Markdown mínimo, con recuadros
  (`::: consejo | importante | cuidado | listo`), botones `[[…]]` y referencias `{{id}}`. **91 guías** (8 básicas, 27 de módulo —uno por cada módulo de la matriz, ahora con `enviar_push`—, 56 tareas), **30 preguntas frecuentes** y **40 términos de glosario**, más **15 bloques del manual de instalación**
  (`manuales/instalacion/`, solo administrador; cubre las 56 variables de `.env.example`, Node 22, parches desde el panel de licencias y `scripts/reiniciar-instancia.sh`).
- **Convertidor propio** (`lib/manuales.js`, sin dependencias): escapa TODO el texto y solo genera las etiquetas que él mismo conoce. **Al arrancar valida** cada bloque —id repetido o distinto del nombre del archivo, `modulo` fuera de la matriz, `nivel` inválido, `importar` en un módulo sin importar/exportar, bloque sin módulo y sin roles, ícono desconocido, `ruta` cuyo último paso no sea una entrada real de menú
  (se lee de `NAV_ITEMS` en `common.js` y de los menús de `app/inicio.html`, no de una copia) y referencias `{{id}}` rotas—; lo que falla se avisa en el log y se omite, la app sigue.
- **Rutas** (`/api/manuales`): `GET /mio` (los permisos de quien pregunta, con la misma lógica de `/permisos/mios`, que se extrajo a `permisosDeSesion`: superadministrador, aspirante con sublicencia y fila de su rol; el administrador, como en el servidor, lo tiene todo), `GET /rol/:rol` (solo administrador; la fila del rol en `permisos_rol`) y `GET /instalacion` (solo administrador).
  Devuelven las insignias por módulo (ver, editar, agregar, importar/exportar) y la fecha del contenido (la del último cambio de `manuales/`, no la del navegador). El administrador recibe además las tarjetas de los 11 manuales (10 roles, con aspirante, y la instalación).
- **Quién ve qué.** Un bloque con módulo sale solo si la persona tiene «Ver» en ese módulo **y** el nivel que el bloque pide (sin «Ver» no sale nada de ese módulo, aunque las demás casillas estén encendidas); uno sin módulo, según `roles` (el aspirante cuenta como `aspirante` y como su rol de fila, `lider`).
  **Guías / preguntas / términos que ve cada rol (de fábrica):** administrador 85/29/40 · coordinador 72/27/34 · líder 39/20/28 · sublíder 27/18/25 · testigo 30/15/24 · usuario 19/14/22 · asistente administrativo 29/16/25 · administrativo 12/8/19 · invitado 20/14/23 · aspirante 48/24/30.
- **Pantalla** (`ayuda.html` + `ayuda.css` + `ayuda.js`, sin la paleta propia ni Fraunces; Space Grotesk, Inter y los colores corporativos): portada con las tarjetas para el administrador (puede abrir el manual de cualquier rol y el de instalación) y manual directo para los demás; chips, «Imprimir o guardar en PDF» (`window.print()` con `@media print` limpio: sin menú, barra, buscador ni índice, preguntas abiertas) y «Imprimir solo esta guía» en cada bloque;
  buscador sin tildes que filtra y resalta; índice fijo en escritorio y arriba en celular; «Para qué sirve», ruta del menú, pasos numerados, recuadros, preguntas plegables y glosario; íconos en un sprite SVG en línea (sin librería ni emoji). El texto sale del servidor ya escapado.
- **`--color-marca-oscuro: #084298`** en `style.css`, y el `#084298` suelto de la línea 367 (`.sec-hero`) usa las dos variables. Los demás `#084298` de la hoja siguen sueltos.
- **Menú del celular:** «Ayuda» en `MENU_LIDER` (el coordinador lo hereda) y en `MENU_ADMIN`; el testigo, que no pasa por el menú, tiene el botón «Ayuda: mi manual» en `app/dia-d.html`. El aspirante puede usar `/api/manuales` y `/ayuda.html` (`middleware/aspirante.js`).
  `ayuda.html`, `ayuda.css` y `ayuda.js` van en la precarga del service worker (el contenido viene de la API y no se guarda).
- **Matriz de permisos:** `enviar_push` («Aviso en la app») entra en `MODULOS` de `routes/permisos.routes.js`. Ya estaba en la siembra de fábrica de `init-db.js` (`enviar_push`: admin, coordinador, líder y asistente administrativo), así que **no hay filas nuevas ni cambio de base**: nadie gana ni pierde acceso. Efecto colateral bueno: el menú del superadministrador se arma con esa lista y no mostraba «Aviso en la app».

**Pruebas.** `scripts/probar-manuales.js` (no viaja): **150 comprobaciones sin fallos** —cero avisos al validar; un bloque por cada módulo; estructura de cada tarea (para qué sirve, pasos, «Así sabes que funcionó», consejo o cuidado) y de cada módulo; recuadros balanceados; **ningún cargo de elección en ningún archivo de `manuales/`, con y sin tildes**; sin teléfonos ni cédulas completos;
escape de `<script>`; validación (ids repetidos, módulo, rol, ruta, importar) con un directorio de prueba; para cada uno de los 10 roles `/mio` responde 200 con EXACTAMENTE los bloques que sus permisos permiten (calculados aparte, desde la base y las cabeceras); quitar «Ver», Agregar, Editar o Importar/Exportar saca su bloque y devolverlo lo vuelve;
403 en `/rol/:rol` e `/instalacion` a quien no es administrador (incluido el aspirante); la fecha es la de los archivos. Suites `probar-logistica`, `panel-alcance`, `comunas-dashboard`, `transporte-diad`, `transporte-parte2`, `inscripcion-enlace` e `instalacion-limpia` (64 tablas) sin fallos.
**Chromium a 1280 y 390 px** con las rutas reales y la base simulada, como líder, coordinador, testigo, administrador (portada, manual de un rol y de instalación), aspirante, sublíder, usuario, asistente, administrativo e invitado: **sin scroll horizontal**, buscador (con y sin tildes) y resaltado funcionando, índice, insignias y recuadros. Se encontró y arregló un desborde a 390 px (botones `[[…]]` largos que no se partían).
`page.pdf()` del manual del líder (54 páginas) y del testigo: sin menú, barra, buscador ni índice. Los PDF y las capturas quedaron en `backups/manuales-verificacion/` (ignorada por git; no viaja en el parche ni en la plantilla).

**Decisiones y cosas que conviene saber.**
- **No había muestra de diseño.** El encargo decía «te lo pego abajo o lo tienes en `manuales-disenos/manual-lider-muestra.html`», y ni estaba pegada ni existe ese archivo. La pantalla se construyó con la descripción de la orden (portada con el rol, chips, botón de impresión, buscador, índice, recuadros, preguntas plegables, glosario, colores corporativos). Si la muestra difiere, se ajusta `ayuda.css`/`ayuda.js`.
- **La firma del SMS:** la orden pedía «≤30 caracteres y sin tildes». En la pantalla real eso **no se impone**: el límite duro del campo es 80 y solo avisa cuando pasa de 30 o lleva tildes o ñ; además la firma la agrega el proveedor. El texto (`t-mensajeria`) dice lo que hace el código.
- **Mensajería:** la pantalla solo ofrece SendGrid para el correo (no hay SMTP ni correo personal ahí) y WhatsApp está apagado en el código; los bloques lo dicen así.
- **Hallazgos de las pantallas que NO se tocaron:** etiqueta «Reptala» (debería ser «Repítela») en el cambio de clave de `app/app-comun.js`; la cola sin señal de IndexedDB no queda atada a un usuario (celular compartido); `public/social.html` («Redes y Opinión») no tiene entrada de menú; `t-testigo-agregar` describe que **no hay botón de crear** en «Testigos electorales» (se marca «Es también testigo electoral» en la ficha de Estructura, o se importa por Excel).
- **`t-avance-ranking`** quedó con `modulo: rescate_votos` (como el menú «Avance de votación») y `t-cobertura` y `t-config-puestos` con `roles: admin`; no son los del catálogo inicial, que se corrigió al leer las rutas.
- **Reinicio tras tocar el `.env`:** el manual de instalación manda el ciclo completo (`pm2 delete` + `start` + `save`) para cambios de `.env` y `scripts/reiniciar-instancia.sh` para reinicios tras parches; las dos fuentes del proyecto se contradicen un poco y no se pudo probar cuál manda.
- **No probado:** un teléfono real; el menú de CloudPanel, el panel de licencias y las pantallas de Telegram/Onurix descritos en los bloques (se redactaron leyendo el código, no en navegador); los textos de los 161 bloques los revisó un script de estructura y de precampaña, no una persona; los PDF se miraron en dos páginas.

## Parche 294 — Escritorio: encabezados de las tablas alineados en Votantes, Estructura, Configuración y demás pantallas (8 de noviembre de 2026, INACTIVO, no toca la base)

Zip de 16 archivos (`.version-base` = 294): `public/votantes.html`, `public/territorial.html` (Estructura), `public/configuracion.html`, `public/eventos.html`, `public/finanzas.html`, `public/crm.html`, `public/enviar-sms.html`, `public/enviar-email.html`, `public/enviar-push.html`, `public/social.html`,
`public/no-contactar.html`, `public/organigrama.html`, `public/asistentes-reuniones.html`, `public/reportes-puesto.html`, `public/service-worker.js` (**v167**) y `.version-base`. Commit `19c872e`. **Requiere el 293.** Sin `db/`: no toca la base.

**Mismo arreglo del 293, sin tocar la regla global `thead th`:** clase `tabla-alineada` en cada tabla (su encabezado de texto va a la izquierda sobre sus celdas, por la regla de `style.css` del 293) y `col-num` en `<th>` y `<td>` de lo que es número o dato corto.
Se aplicó a 14 pantallas; el service worker sube a v167 porque `votantes.html` y `territorial.html` están en su precache.

**Cómo se midió (distinto al 293).** Esta vez con **las rutas reales** de la aplicación (todas las de `app.js` montadas con una sesión de admin simulada) sobre una base MySQL privada **sembrada** por las suites (124 votantes, 48 usuarios, 25 en la estructura, 20 territorios, 4 eventos…) y unas pocas filas más a mano (campañas de SMS, correo y push, publicaciones y menciones, organigrama, reportes de mesa, asistentes, candidatos), y Chromium a 1280 px.
Por cada columna de cada tabla se compara la alineación del `<th>` con la de sus `<td>`, y se cuenta si cada fila cubre las columnas del encabezado. **Columnas con el encabezado y las celdas en distinta alineación, antes → después:**

| Pantalla · tabla | Columnas | Antes | Después |
|---|---|---|---|
| Votantes · lista | 16 | 13 | 0 |
| Votantes · enlaces de inscripción (líderes) | 9 | 4 | 0 |
| Votantes · intentos con la cédula de otro líder | 3 | 3 | 0 |
| Votantes · estimado por puesto | 5 | 3 | 0 |
| Votantes · puestos no configurados | 2 | 1 | 0 |
| Estructura (territorial) · territorios | 4 | 4 | 0 |
| Eventos | 10 | 10 | 0 |
| Finanzas | 7 | 7 | 0 |
| CRM · campañas | 9 | 9 | 0 |
| CRM · detalle de envíos | 4 | 4 | 0 |
| Enviar SMS · historial / detalle | 8 / 4 | 8 / 4 | 0 / 0 |
| Enviar e-mail · historial | 8 | 8 | 0 |
| Enviar push · historial | 8 | 8 | 0 |
| Redes · publicaciones | 6 | 6 | 0 |
| Redes · menciones | 5 | 5 | 0 |
| No contactar | 5 | 5 | 0 |
| Organigrama · vista Tabla | 9 | 9 | 0 |
| Asistentes a reuniones · reuniones | 6 | 6 | 0 |
| Asistentes a reuniones · consolidado | 6 | 6 | 0 |
| Reportes por puesto · por puesto / por mesa | 4 / 4 | 1 / 1 | 0 / 0 |
| Configuración · Usuarios | 9 | 8 | 0 |
| Configuración · Permisos | 27 | 1 (el rótulo «Rol») | 0 |
| Configuración · Día D · candidatos | 3 | 0 (ya llevaba su regla) | 0 |

Filas con cuenta de columnas que no cuadre, antes y después: **0** en todas (la cuenta de `<th>` y `<td>` ya coincidía; el defecto era la alineación). Las dos últimas pestañas de Votantes («Lugar de votación» y «Datos verificados») tenían las celdas centradas con el encabezado fuera de `col-num`: se corrigieron.
Ya medidas en el 293 y **no tocadas aquí**: las pestañas del Día D, Testigos, la lista de Puestos de Configuración (no se pudo volver a abrir con las rutas reales, porque su consulta pide el catálogo territorial, que no está en la base privada) y Logística (292). **No cambia:** `votantes-dashboard.html` (nueve tablas con su propia alineación, encabezado y celdas a la izquierda o a la derecha a juego; no tiene el defecto), la tabla de dos columnas de la ficha del organigrama (sin encabezado) y Configuración → Campaña, Eliminar y Respaldo (sin tablas).
Los encabezados vacíos sobre las columnas de botones (p. ej. el de la lista de candidatos del Día D, con las celdas a la derecha) siguen marcados por el medidor aunque no tienen rótulo que desalinear: no se tocaron.

**Criterio y lo que cambia a la vista:** ID, Asistencia, Reuniones, Monto, Alcance, Destinatarios/Enviados/Fallidos/Omitidos → `col-num` (centrados). Montos en pesos **centrados, no a la derecha**: se siguió «números centrados o a la derecha» y la columna queda alineada con su rótulo. Todo lo demás es texto y su encabezado va a la izquierda.
Suites `probar-logistica`, `panel-alcance`, `comunas-dashboard`, `transporte-diad`, `transporte-parte2` e `inscripcion-enlace` sin fallos (las que fijaban la versión del service worker aceptan v167); `verificar-html.py` en las 14 páginas.
**No probado:** un teléfono real; la forma de las tablas con datos de una campaña de verdad (aquí hay de 1 a 50 filas por tabla); el desplegado «Ver mesas» del estimado por puesto y la fila «Ver reuniones» del consolidado; Configuración → Día D → puestos con el catálogo cargado.

## Parche 293 — Día D: encabezados de las tablas alineados con sus celdas (8 de noviembre de 2026, INACTIVO, no toca la base)

Zip de 7 archivos (`.version-base` = 293): `public/dia-d.html`, `public/js/transporte-dia-d.js`, `public/testigos.html`, `public/configuracion.html`, `public/css/style.css`, `public/service-worker.js` (**v166**) y `.version-base`. Commit `e4a6035`. **Requiere el 292.** Sin `db/`: no toca la base.

**Defecto (el mismo que tenía Logística):** la regla global `thead th { text-align: center }` centra todos los encabezados y las celdas quedaban a la izquierda; los números sin `col-num` quedaban pegados al borde bajo un rótulo centrado.

**Cómo se midió.** Con un servidor de pruebas (sesión de admin y datos de ejemplo en cada pantalla) y Chromium a 1280 px, para **cada columna de cada tabla visible** se compara la alineación del `<th>` con la de sus `<td>` y se cuenta si cada fila cubre las columnas del encabezado. Antes: **toda** columna de texto de Transporte, Reportes, Avance, Resultados, Testigos y Puestos tenía el encabezado centrado sobre celdas a la izquierda,
y las columnas de números sin `col-num` (Votos de candidatos, Mesa, Votos candidato, Total votos, E-14, Última marca, Foto, casilla de Diferencias, Pers., Carga, Capacidad, ID, Mesa y Activo de Testigos) igual. **Después: 0 columnas con encabezado y celdas en distinta alineación**, y 0 filas con cuenta de columnas que no cuadre.
Tablas medidas: Transporte (personas, conductores, vehículos); Reportes (candidatos, mesas, historial); Avance (líderes, puestos); Resultados (consolidado, digitar oficial, diferencias, paquetes); Testigos; Puestos (configuración → Día D); y Logística, ya arreglada en el 292. **Alertas no tiene tablas** (son tarjetas), así que no hay nada que alinear.

**Criterio:** número o dato corto (mesa, votos, hora de marca, casilla, foto, capacidad, personas, carga, ID, «Sí/No») → `col-num` en `<th>` y `<td>`, centrado en ambos. Texto (nombres, direcciones, novedad, alertas, hora larga, botones) → el encabezado va a la IZQUIERDA sobre sus celdas. Se hace con **una regla en `style.css`** acotada a `#vista-reportes`, `#vista-avance`, `#vista-resultados`, `#vista-transporte` y la clase nueva
`.tabla-alineada` (puesta en la tabla de Testigos y en la de Puestos), no con estilos en cada `<th>`; así una columna nueva de texto nace alineada. **La regla global no se tocó**: otras pantallas tienen tablas de hasta catorce columnas donde un cambio general movería rótulos.

**Lo que NO se tocó, a propósito:** la tabla de Logística (resuelta con estilos en línea en el 292); el encabezado vacío sobre los botones de acciones de Puestos (queda a la izquierda y las celdas a la derecha, pero no hay rótulo que desalinear); y las demás pantallas de la aplicación (Votantes, Estructura, Configuración, etc.), que tienen el mismo patrón pero **no se midieron**.
El service worker sube a v166 porque `style.css` está en su precache. Suites `probar-logistica`, `panel-alcance`, `comunas-dashboard`, `transporte-diad`, `transporte-parte2` e `inscripcion-enlace` sin fallos (las que fijaban la versión del service worker aceptan v166); `verificar-html.py` en las tres páginas.
**No probado:** un teléfono real; datos de una campaña de verdad (las tablas se vieron con 2 a 3 filas); la pestaña Alertas con datos (el simulador no la llenó); la tabla de Puestos con la cobertura «en vivo» ni el desplegado de mesas.

## Parche 292 — Menú del celular y tablas de Logística alineadas (8 de noviembre de 2026, INACTIVO, no toca la base; reemplaza al 291)

Zip de 6 archivos (`.version-base` = 292): `public/js/common.js`, `public/css/style.css`, `public/votantes-dashboard.html`, `public/service-worker.js` (**v165**), `public/js/logistica-dia-d.js` y `.version-base`. Commits `2d5da70` (menú), `e8a1b77` (tablas) y el de `.version-base` y ESTADO.md. **Requiere el 290.** Sin `db/`: no toca la base.
Lleva todo lo del 291 (descrito en su sección, más abajo) **más la alineación de las tablas**.

**Por qué es el 292 y no el 291.** Se pidió meter las tablas «en el mismo parche», y el 291 ya estaba publicado y registrado. Se intentó: se republicó el zip con `publicar-parche.sh 291 --forzar` y se volvió a registrar, y **el Servidor de Licencias contestó 409**
(«El parche #291 ya está registrado. Un número publicado no se reutiliza.»). Eso dejó, por unos segundos, un `parche-291.zip` publicado (sha256 `c745bbd4…`) que no coincidía con la huella y la firma registradas (`665a3fa0…`): de haberse activado, el actualizador lo habría rechazado.
Se restauró enseguida el zip original (copia previa; huellas de origen y destino `665a3fa0…`, verificadas) y los cambios salieron como 292. **Regla para la próxima:** `--forzar` sólo reemplaza el ARCHIVO; la fila registrada (huella y firma) no se puede cambiar, así que un parche ya registrado no admite cambios aunque esté inactivo. Hay que sacar el número siguiente.
**Estado:** el 292 ya está aplicado en las tres campañas y el 291 nunca se instaló (confirmado por el usuario el 8 de noviembre de 2026); el 291 debe quedar sin aplicar. (Si algún día se aplicara por error, el 292 ya aplicado no se vuelve a ofrecer y el 291 lo pisaría con archivos viejos: no activarlo.)

**Las tablas de la pestaña Logística (`public/js/logistica-dia-d.js`).** Reproducido en Chromium (1280 px) midiendo, columna por columna, el centro del encabezado contra el del dato: «Total a comprar» salía 89 px a la izquierda de su encabezado; el plan por puesto, de 7 a 30 px en las columnas de ítems.
- **Causa:** la regla global `thead th { text-align: center }` centra todos los encabezados, y las celdas numéricas llevaban `class="num"`, una clase **que no existe** en `style.css` (la del proyecto para columnas de números es `col-num`). Los números quedaban a la izquierda de la celda bajo un encabezado centrado. La cuenta de `<th>` y `<td>` **sí coincidía** en todas las filas medidas.
- **Arreglo:** números (y casillas) con `col-num` en `th` y `td`, centrados como su encabezado; los encabezados de texto (Ítem, Para, Hasta, Puesto, Nombre) con `text-align:left` sobre datos a la izquierda. Pasa en las tres tablas: «Total para comprar», «Plan por puesto» e «Ítems» (la tercera tenía lo mismo, con las casillas «Incluir suplentes» y «Activo»). El botón ↺ de «volver a la sugerida» pasó a la línea de «entregados» para que el campo numérico quede centrado bajo su encabezado.
- **Una fila que no cuadraba:** cada ítem de conductores bajo «Transporte» llevaba una celda con `colspan = max(1, ítems de testigos)` después de tres celdas: con cero ítems de testigos daba cuatro columnas bajo tres encabezados. Ahora cubre siempre las del encabezado (`3 + N`, o 3 si N = 0).
Medido otra vez después: todas las celdas numéricas a 0 px de su encabezado; las de texto quedan a la izquierda a propósito. Suites `probar-logistica` y `probar-transporte-parte2` sin fallos.
**No probado:** un teléfono real ni la tabla con datos de una campaña de verdad (el simulador trae 2 puestos y 4 ítems); el caso sin ítems de testigos se comprobó por lectura, no en pantalla.

## Parche 291 — Menú del celular: se cierra al tocar un ítem y muestra la vista (8 de noviembre de 2026, INACTIVO, no toca la base; REEMPLAZADO POR EL 292: NO APLICAR)

Zip de 5 archivos (`.version-base` = 291): `public/js/common.js`, `public/css/style.css`, `public/votantes-dashboard.html`, `public/service-worker.js` (**v165**) y `.version-base`. Commit `2d5da70`. **Requiere el 290.** Sin `db/`: no toca la base.

**Síntoma (PWA en el celular):** al tocar «Transporte del Día D» el ítem se resaltaba, el menú no se cerraba y no se veía la pestaña. Igual con Logística, Avance, Alertas y Resultados.

**Causa (reproducida en Chromium a 390 px, con el menú de `dia-d.html`):** no fallaba el cambio de pestaña. El clic en un ítem de la misma página lo atiende `common.js` (`paginaEscuchaHash`): cambia la URL con `pushState` y despacha `hashchange`, y `dia-d.html` lo escucha y muestra la pestaña
(`vista-transporte` pasaba a `display:block` y el ítem quedaba activo). Lo que no existía era un menú que cerrar: hasta 640 px el CSS apila el `.sidebar` como bloque estático **encima** del contenido (`.app-shell` en columna; **880 px de alto**) y siempre abierto. La pestaña quedaba a partir de
y = 880, la pantalla seguía mostrando el menú (`scrollY` 188-227) y nada la llevaba al contenido. Entrar desde otra página tenía la misma forma: la página carga arriba, con el menú abierto y la vista debajo. Sirve igual para `configuracion.html`, que también escucha el ancla.

**Arreglo:** en pantalla angosta el menú nace **cerrado** tras una barra pegajosa «☰ Menú · <vista actual>» (botón de 44 px, `aria-expanded`, la vista actual sale del ítem activo); se abre con el botón y se **cierra** al tocar cualquier ítem (`a[data-nav-href]`; los títulos de grupo no, que sólo despliegan su submenú), al cambiar el ancla (también con el botón «atrás»)
y con Escape. Tras un cambio de vista en la misma página se hace `scrollTo(0, 0)`, de modo que la pestaña queda a la vista. Entrando desde otra página, la página nueva carga con el menú cerrado y la vista del ancla arriba. En pantalla ancha (>640 px) la barra no se ve y no cambia nada (comprobado a 1280 y 820 px: barra oculta, menú pegajoso, un ítem de la misma página cambia la pestaña).
La barra se oculta también en `html.modo-app` (`territorial.html` ya trae su propia barra) y al imprimir (`votantes-dashboard.html`). Código: `common.js` (bloque «MENÚ EN EL CELULAR», `ponerMenuMovil`, `marcarActivoMenu`, los dos manejadores de clic y de `hashchange`) y `style.css` (dentro del `@media (max-width: 640px)` y reglas de la barra).

**Decisión que conviene saber:** el menú plegado cambia **todas** las pantallas de escritorio vistas en un celular, no sólo el Día D: antes se veía abierto arriba en cada una y ahora hay que tocar «☰ Menú». Fue lo más simple que cumple «el menú se cierra»; si se prefiere dejarlo abierto en otras páginas, es acotar la regla CSS.

Probado en Chromium (390 px, servidor de pruebas con la sesión y la API simuladas): carga con el menú cerrado y «Jornada electoral» en la barra; abrir; tocar Transporte, Logística, Avance, Alertas, Resultados y Jornada (sin ancla): en los seis el menú queda cerrado, el hash cambia, la vista correcta es la única visible y queda en pantalla;
Escape lo cierra; la carga directa `dia-d.html#transporte` muestra Transporte con el menú cerrado. Suites `probar-logistica`, `panel-alcance`, `comunas-dashboard`, `transporte-diad`, `transporte-parte2` e `inscripcion-enlace` sin fallos; `verificar-html.py` en `dia-d.html` y `votantes-dashboard.html`.
**No probado:** un teléfono real ni la PWA instalada (se emuló el tamaño y el toque en Chromium); los datos de Avance, Alertas y Resultados en el simulador son vacíos, así que no se comprobó que pinten bien; las otras pantallas de escritorio con el menú plegado sólo se miraron en `dia-d.html`.

## Parche 290 — Páginas del celular: contenedor main.app-cuerpo y service worker v164 (8 de noviembre de 2026, INACTIVO, no toca la base)

Zip de 6 archivos (`.version-base` = 290): `public/app/alertas-dia-d.html`, `public/app/ranking-dia-d.html`, `public/app/faltantes.html`, `public/app/mis-registros.html`,
`public/service-worker.js` (**v164**) y `.version-base`. Commits `d48db1d` (Ranking y Alertas + SW) y `75076e3` (Faltantes y Mis registros). **Requiere el 289.** Sin `db/`: no toca la base.

Las cuatro pantallas envolvían todo en `<div class="app-contenido">`, una clase que no existe en `estilos-app.css`; las tarjetas salían pegadas a los bordes. Pasan a
`<main class="app-cuerpo">` (padding de 18 px y ancho máximo de 560 px), la de `dia-d.html`, `inicio.html` y `logistica.html`. El service worker sube a v164 una sola vez para los cuatro archivos
(estaban en su precache y v164 no se había entregado antes). Ya no queda ningún `app-contenido` en `public/`.
Probado: `verificar-html.py` (etiquetas balanceadas y JS válido) en las cuatro páginas, y las suites `probar-logistica`, `panel-alcance`, `comunas-dashboard`, `transporte-diad`, `transporte-parte2` e `inscripcion-enlace`
sin fallos (las tres que fijaban la versión del service worker ahora aceptan v164). **No probado:** el aspecto en un celular real o en un navegador; ninguna suite toca estas páginas.

## Parche 289 — Día D: logística (refrigerios y kits) y Panel por rol (8 de noviembre de 2026, INACTIVO, TOCA LA BASE)

Zip de 21 archivos (`.version-base` = 289). **Nuevos:** `lib/logisticaDiaD.js`, `lib/logisticaItems.js`, `routes/logisticaDiaD.routes.js`, `public/js/logistica-dia-d.js`, `public/app/logistica.html`.
**Modificados:** `app.js`, `config/importarExportar.js`, `db/init-db.js`, `lib/alertasDiaD.js`, `lib/avisosAlertas.js`, `middleware/aspirante.js`, `public/app/dia-d.html`, `public/app/inicio.html`, `public/dia-d.html`,
`public/js/alertas-dia-d.js`, `public/js/common.js`, `public/js/offline-utils.js`, `public/service-worker.js` (**v163**), `routes/dashboard.routes.js` y `routes/permisos.routes.js`. Commit `caf7d42`.
`scripts/probar-logistica.js` (114), `probar-panel-alcance.js` (43) y las suites tocadas **no viajan**. **Requiere el 288.** **Toca la base** (`init-db` crea 3 tablas y siembra 3 ítems: marcar «toca base de datos», ya viene marcado).

### Parte A — Panel de los demás roles

`ambitoDeResumen` (`routes/dashboard.routes.js`): **testigo, usuario e invitado ven sólo lo suyo**, igual que el sublíder (lo que ellos registraron; ceros si no registran). **Asistente administrativo y administrativo siguen viendo toda la
campaña, sin finanzas.** El mapa del Panel y la tabla de posiciones **no cambian**. Probado en `probar-panel-alcance.js` (testigo 1, usuario 2, invitado 0, administrativo y asistente 14 de 14, ninguno con `finanzas`).

### Parte B — Logística del día D

**Tablas** (`db/init-db.js`, idempotente; `aspirante_id` = dueño, 0 = la madre):
- `logistica_items` — `nombre, destinatario ENUM('testigos','conductores'), hora_limite TIME, incluir_suplentes, activo, orden`; `UNIQUE(aspirante_id, nombre)`. **Se desactivan, no se borran** (una entrega apunta a su ítem).
- `logistica_plan` — sólo las **correcciones a mano** (`item_id, puesto_id, cantidad`); `UNIQUE(item_id, puesto_id)`. Sin fila, manda la sugerida. Borrar la fila = volver a la sugerida.
- `logistica_entregas` — `item_id, puesto_id, receptor_usuario_id, fecha, estado (entregado/anulado), entregado_por, entregado_en` (la hora del TOQUE), `nota, foto_url, cliente_uuid, anulado_por/en`; **`UNIQUE(item_id, receptor_usuario_id, fecha)`**.
- **Ítems de fábrica** (sólo si la madre no tiene ninguno, así volver a correr `init-db` no recrea lo que el administrador renombró o desactivó; un aspirante recibe los suyos al abrir el módulo por primera vez): Kit de testigo 07:00, Refrigerio 12:00, Almuerzo 14:00, todos a testigos y con suplentes apagado.

**Plan** (`lib/logisticaDiaD.js`): sugerido = testigos **activos** asignados al puesto (incluidos los «coordinadores de puesto»), por `cargarTestigos`/`repartirPorPuesto` (id del puesto o texto normalizado); `+ suplentes` sólo si el ítem lo pide (los suplentes que ya son testigos
de ese puesto no se cuentan dos veces). Los **conductores** van en una fila «Transporte» aparte (conductores activos de la campaña) y su total entra en la lista de compras.

**Pantallas**
- *Escritorio:* pestaña **«Logística»** en `dia-d.html` (después de «Transporte», también en el submenú DÍA D): total para comprar, plan por puesto editable (naranja = corregido a mano, ↺ vuelve a la sugerida), fila de conductores, alta y edición de ítems, y **Excel**
  (hojas «Lista de compras», «Por puesto» y «Testigos», con **la cédula enmascarada** `***992`).
- *Celular:* `app/logistica.html`, **a 360 px sin desborde**: por testigo, un botón «Entregado» por ítem y 📷 para entregar con foto; «Deshacer» para un error. El coordinador de puesto llega por un acceso en su pantalla del Día D (`app/dia-d.html`); la coordinación, por una tarjeta del menú (`inicio.html`) con selector de puesto.
  **Sin señal:** la entrega queda en el celular (cajón nuevo `logistica_pendientes`, `offline-utils` versión 5) con su `cliente_uuid` y la hora del toque, y se sube sola al volver la señal; la última lista se guarda para verla sin conexión.
- **Contador** en el cuadro del Día D: «Refrigerio: 38 de 52» por ítem (los de conductores dicen «N por comprar»).

**Permisos y módulo `logistica_dia_d`** — declarado en: `db/init-db.js` (de fábrica **admin y coordinador**), `routes/permisos.routes.js` (la matriz), `config/importarExportar.js` (Excel: admin y coordinador), `middleware/aspirante.js` (`MODULOS_ASPIRANTE`, `PERMISOS_ASPIRANTE` con exportar
encendido, y `HREFS_ASPIRANTE` con `/dia-d.html#logistica`) y `public/js/common.js` (menú). **La pantalla del coordinador de puesto NO va por rol ni por la casilla**: va por su fila de testigo `tipo_testigo = 'puesto'`; ve y entrega **sólo en su puesto** (un `puesto_id` ajeno se ignora). La coordinación con el módulo entra a cualquier puesto de su campaña.
Un líder sin el módulo recibe **403**.

**Alerta `logistica_sin_entregar`** (gravedad **8**; **«mesa sin testigo» pasó a 9** y su chip a gris `.g9`; la logística es ámbar): por puesto y por ítem, **sólo el día de la elección**, «pendiente» antes de la hora del ítem y «activa» después; cuenta **testigos que YA hicieron check-in y no tienen ese ítem hoy**.
Texto: «Puesto X: N testigos sin refrigerio a las 12 m.» («1 testigo» en singular; «7 a. m.», «2 p. m.»). Va en el cuadro (`calcularAlertas`), en `alertasParaUsuario` (pasa igual para el coordinador: no depende de los votantes de quien pregunta) y en `TIPOS_AVISADOS`/`FRASES` del push.
**El campo `mesa` de esta alerta lleva el id del ítem** (así «atendida» y el aviso push funcionan por ítem sin tablas nuevas); el cuadro dejó de escribir «· Mesa N» para este tipo.

### Decisiones mías (2e, «la opción más simple que funcione el día D»)

1. **Los suplentes no reciben desde la pantalla**: no son testigos asignados. Sólo cuentan en el plan si el ítem lo pide. Si un suplente reemplaza a alguien, la coordinación lo asigna como testigo del puesto y desde ese momento recibe.
2. **Sin firma, foto opcional** (8 MB máximo; se reduce a 1.280 px y JPEG calidad 72, se gira por EXIF y se quitan los metadatos). Un archivo que no es imagen no tumba la entrega: queda registrada y la respuesta dice que la foto no se guardó.
3. **Sólo cantidades, sin costo ni pesos.**
4. **A los conductores se les planea y se les compra, pero no se registra su entrega** (no cuelgan de un puesto y el celular del coordinador de puesto no los ve). Si hace falta, otra orden.
5. **Compra y reparto entre puestos: la coordinación, con el Excel.** No hay un rol de «coordinador de zona».
6. **El contador es de la campaña (por dueño), no de la rama del coordinador**: así son los testigos y sus alertas en todo el Día D. Un aspirante ve el suyo.
7. **Entregas del día = hoy en Colombia**, también fuera de `fecha_eleccion` (como el check-in), para poder ensayar; la alerta sí exige que hoy sea el día de la elección.
8. **«Anular»** (Deshacer) existe, y el coordinador de puesto sólo anula las de su puesto; volver a entregar lo anulado lo reactiva.
9. Un **testigo inactivo** no cuenta ni puede recibir.

**Lo que choca con el código (la orden pedía avisar):** nada impedía las decisiones, pero hay dos efectos que conviene saber: (a) para meter la alerta hubo que **renumerar «mesa sin testigo» a gravedad 9** (cambia el color de su franja); (b) el cuadro de alertas
no tenía dónde distinguir «por ítem», y se usó la columna `mesa` (ver arriba).

**Una observación aparte, sin tocar:** `app/ranking-dia-d.html` y `app/alertas-dia-d.html` envuelven su contenido en `<div class="app-contenido">`, una clase que **no existe** en `estilos-app.css` (la buena es `main.app-cuerpo`); por eso sus tarjetas salen pegadas a los bordes. La pantalla nueva sí usa `main.app-cuerpo`.

### Verificación

`scripts/probar-logistica.js` (**114 comprobaciones**, base privada): tablas y clave única; ítems de fábrica; **`init-db` dos veces** (sin recrear lo renombrado); plan sin y con suplentes, corrección a mano y su vuelta, rechazos (negativos, decimales, ítem de conductores); fila de conductores (2 activos de 3); **permisos** (líder 403 en plan, ítems,
celular y Excel; coordinador sí; sin sesión 401; coordinador de puesto 403 en el escritorio y sólo ve su puesto; testigo común 403); **entrega idempotente** (segundo toque, el mismo identificador, **tres toques simultáneos → una sola entrega**, testigo de otro puesto, inactivo, ítem desactivado o de conductores, hora del toque de hace 2 h, hora futura descartada, reintento de la cola, anular/reactivar);
**la foto** (reducida a 1.280×960 y 7 KB desde 44 KB, en `uploads/dia-d/`, visible sólo para su puesto y la coordinación, un segundo toque no deja archivos, un archivo que no es imagen no tumba la entrega); el contador y por dueño (un aspirante ve el suyo en cero); **la alerta** a las 06:00 (pendiente), 08:00 y 13:00, al entregar, atendida por ítem, con la elección mañana y sin fecha, con el ítem desactivado o sin hora; `alertasParaUsuario`; el push; el Excel (3 hojas, cédula enmascarada, sin cédula completa); y las declaraciones del módulo y las pantallas.
**En Chromium sin interfaz** (a 360×740): la pantalla del celular —sin desborde horizontal—, tocar «Entregado» con señal (queda «✓ Entregado 19:52 / Deshacer»), **sin señal** (queda «⏳ Guardado, sin subir» y el aviso «1 entrega guardada en tu celular…») y **al volver la señal** (se sube sola y quedan 2 marcados, sin pendientes);
y la pestaña de escritorio (contador, plan, total, ítems, menú activo «Logística del Día D»), sin errores de consola. Suites: comunas 73/73, inscripción 467/467, transporte 123/123 y 80/80 (se ajustaron dos comprobaciones: Transporte ya no es lo último del submenú, lo es Logística), panel 43/43; `probar-instalacion-limpia.js` **64 tablas**.
**NO se probó:** un teléfono real (la cámara, la señal intermitente de un puesto), el push llegando a un dispositivo, una foto grande en un celular de gama baja, ni el día de la elección con tráfico real; tampoco la tarjeta del menú para un aspirante en un navegador (sí la declaración).

**NOTAS PARA QUIEN LO APLIQUE:** (1) **toca la base**: `init-db` crea las tres tablas y siembra los tres ítems; aplicar después del 288 con la misma lista de campañas. (2) El administrador y el coordinador tendrán el módulo «Logística del Día D» de fábrica; lo ve el aspirante. Los **coordinadores de puesto ya existentes** reciben el acceso sin tocar nada (el servidor lo reconoce por su fila de testigo).
(3) Revisar las horas (07:00, 12:00, 14:00) y los ítems en la pestaña antes del día. (4) Es **visible** para testigo, usuario e invitado: su Panel deja de mostrar la campaña entera.

## Parche 288 — Panel general por alcance (8 de noviembre de 2026, INACTIVO, NO toca la base)

Zip de 2 archivos: `routes/dashboard.routes.js` y `.version-base` = 288. Commit `6c4927f`. **Requiere el 287** (el 287 puso el ámbito del coordinador que éste reutiliza).
`scripts/probar-panel-alcance.js` (35 comprobaciones) **no viaja**. Ninguna pantalla cambia: no hay service worker nuevo.

**Lo que había:** `/api/dashboard/resumen` y `/tendencia-registros` contaban la campaña entera para cualquiera con el Panel encendido que no fuera aspirante: un líder veía el
total de votantes, los coordinadores y líderes de toda la campaña, la meta, los eventos y las menciones.

**Lo que hace ahora** (`ambitoDeResumen`, `routes/dashboard.routes.js`; `/resumen` y `/tendencia-registros` lo usan):

| Quien mira | Qué cuenta |
|---|---|
| Administrador | toda la campaña (sin cambios) |
| Coordinador | él, sus líderes y los sublíderes de éstos (el ámbito del 287); votantes con la misma condición de la lista de Votantes |
| Líder | él y quienes le reportan directo (sus sublíderes); votantes con `lider_id` = él (incluye lo que registran sus sublíderes) |
| Sublíder | sus votantes (`lider_id` o `sublider_id` = él) |
| Aspirante | su rama, como antes |

- **Eventos:** el coordinador, el líder y el sublíder ven los eventos donde ellos o su equipo figuran como responsable, coordinador o líder (`responsable_id`, `coordinador_id`, `lider_id`).
  **Un evento sin ninguna de esas personas sólo lo ve el administrador.** (Comportamiento nuevo para el coordinador: antes veía todos.)
- **Menciones** (monitoreo de redes): no cuelgan de nadie y no se pueden acotar; **sólo el administrador las recibe**. El panel no las pinta, pero el JSON las traía enteras.
- **Finanzas:** igual que en el 268 — sólo administrador, coordinador y aspirante; para el líder la clave `finanzas` no viaja (la prueba lo comprueba, y que el monto no aparezca en ningún lado de la respuesta).
  El coordinador sigue viendo el balance de **toda** la campaña (no se acota: es dinero de la campaña, no de una rama).
- **La meta de la madre** (`filtroMetaMadreEstructura`) ahora también se resta dentro de la rama de un coordinador, no sólo para el administrador.

**Qué cambió de lugar:** `filtroEquipo` ya no excluye siempre «a la cabeza»: sólo lo hace con el aspirante (`ambito.esAspirante`); y las finanzas en cero son sólo del aspirante, no de cualquiera con ámbito.

### Otras tarjetas del Panel (`dashboard.html` y `app/admin-panel.html`)

| Ruta | Quién | Alcance |
|---|---|---|
| `/dashboard/resumen`, `/tendencia-registros` | todos con el Panel | **acotado desde el 288** (tabla de arriba) |
| `/dashboard/progreso-equipo` | admin, coordinador, aspirante | acotado desde el 287 |
| `/dashboard/mi-progreso` | el propio usuario | lo suyo, siempre |
| `/dashboard/avance-mis-lideres` | admin, coordinador | el coordinador ve los suyos; el admin elige |
| **`/dashboard/tabla-posiciones`** | todos con el Panel | **toda la campaña para líder, sublíder y demás roles — A PROPÓSITO**: es un ranking de motivación (sólo nombres y cantidades, 50 filas) y su nota dice que el propio líder tiene que verse en él. El coordinador sí ve sólo su rama (287). Decisión de Gildardo si algún día se acota. |
| `dashboard.html` → `/territorial/mapa-personas` | admin, coordinador, aspirante | **no es de `/api/dashboard`** y no se tocó: el mapa del Panel sigue mostrando a todos los georreferenciados al coordinador |
| Cobertura territorial («Informe») | admin, coordinador | toda la campaña, como se decidió en el 287 |

**Roles que NO se tocaron** (la orden no los nombra): asistente administrativo, testigo, usuario, invitado. Todos tienen `panel_general` por defecto (`db/init-db.js`) y siguen viendo la campaña entera
en `/resumen` y `/tendencia-registros` (sin finanzas). A un asistente administrativo acotarlo lo dejaría en cero; a un testigo o invitado probablemente conviene acotarlo o quitarle el Panel.
**Pendiente a decidir.**

**Probado** (`scripts/probar-panel-alcance.js`, 35 comprobaciones, base privada): administrador (11 votantes, 2 coordinadores, 3 líderes, 4 eventos, menciones, finanzas); coordinador A (6, él y sus 2 líderes, meta 150,
2 eventos, sin menciones, con finanzas) y B; líder (5: los suyos y los de su sublíder; 1 evento; sin finanzas ni su monto); otros dos líderes; sublíder (2); asistente administrativo (sin cambios); aspirante (sin eventos,
finanzas en cero, como antes); y la tendencia de cada uno. **Con el código anterior falla 20.** Suites: comunas-dashboard 73/73, inscripción 467/467, transporte 123/123 y 80/80. `node --check` y `verificar-requires.js`
sobre el zip: «TODO RESUELVE». **NO se probó:** un navegador (la pantalla del Panel con un líder), ni datos reales de ninguna campaña.

**NOTAS PARA QUIEN LO APLIQUE:** (1) no toca la base; aplicar después del 287 con la misma lista de campañas. (2) Es **visible**: un líder o un sublíder que hoy ve «Votantes: 3.200» pasará a ver sólo lo suyo; y un coordinador
deja de ver los eventos que no tienen a nadie de su rama.

### Propuesta (IMPLEMENTADA en el parche 289, con las decisiones de allá): refrigerios, almuerzos y kits del día D

**Qué hay hoy: nada.** Ni tablas, ni columnas, ni pantallas, ni rutas (`grep -rniE "refrigerio|almuerzo|kit|material|entrega"`): sólo dos rastros de **dinero**, no de logística —la categoría de gasto
«Producción de material impreso» (`db/schema.sql:389`) y el texto de ejemplo «Refrigerios para voluntarios» en `public/finanzas.html:67`—, y «Compartir contenido» (materiales de **comunicación**, no físicos).

**De dónde saldría la cantidad por puesto**
- **Testigos asignados:** `estructura` con `cargo = 'testigo'` (`tipo_testigo` 'mesa' o 'puesto', `mesa_votacion`, `mesas_asignadas`, `puesto_id`); `lib/coberturaTestigos.js` ya los reparte por puesto (`cargarTestigos`, `repartirPorPuesto`,
  por id si es de la campaña y, si no, por el texto normalizado). La unidad es la **persona**, no la mesa: un coordinador de puesto cubre varias mesas y come una vez. `dia_d_puestos_votacion.cantidad_mesas` da el tope de mesas.
- **Suplentes:** `dia_d_suplentes_testigo (aspirante_id, puesto_id, usuario_id)`. Convendría un interruptor por tipo de entrega: «incluir suplentes» (sí para refrigerio, tal vez no para chaleco).
- **Coordinadores de puesto:** no son un rol aparte: son testigos con `tipo_testigo = 'puesto'` (así se llaman en `testigos.html`). Ya salen en el reparto; sólo hay que distinguirlos para el kit.
- **Conductores:** `transporte_conductores`, pero **no cuelgan de un puesto** (un conductor recorre varios). Su cantidad iría en una fila «Transporte» (puesto vacío) y no en la suma de los puestos.
- **Presencia real:** `dia_d_checkin` (quién llegó). Para *comprar*, sirve lo asignado; para *alertar*, lo que cuenta es quién llegó y aún no recibió.

**Tablas (esbozo)**
- `logistica_items` — qué se entrega: `id, aspirante_id, nombre, tipo` (refrigerio, almuerzo, kit_testigo, chaleco, otro)`, destinatario` (testigo, coordinador_puesto, suplente, conductor)`, incluir_suplentes, hora_limite TIME NULL` (para la alerta; 12:00 en el refrigerio), `costo_unitario NULL, activo`.
- `logistica_plan` — `item_id, puesto_id, cantidad_planeada, manual` (1 si alguien la ajustó a mano); `UNIQUE(item_id, puesto_id)`. Se **sugiere** desde los testigos del puesto y se puede corregir.
- `logistica_entregas` — `id, aspirante_id, item_id, puesto_id, fecha, receptor_usuario_id NULL, cantidad DEFAULT 1, entregado_por, entregado_en, nota, foto_url NULL, firma_url NULL, cliente_uuid, estado` (entregado/anulado)`;
  UNIQUE(item_id, receptor_usuario_id, fecha)` para que el doble toque o el reintento no entregue dos veces. La foto/firma reutilizaría el manejo de archivos de `dia_d_reporte_documentos` (E-14).

**Pantallas**
- *Escritorio* — pestaña **«Logística»** en `dia-d.html` (como Transporte, al final del submenú): catálogo de items; tabla «planear por puesto» con la cantidad sugerida y editable, y **el total para comprar por item** (suma + margen %
  configurable); botón de Excel (con el permiso de importar/exportar).
- *Celular* — `app/logistica.html` para el **coordinador de puesto** (un testigo `tipo_testigo = 'puesto'`): ve la lista de testigos de SU puesto (de `cargarTestigos`), toca «Entregado» por persona e item; el servidor sólo deja
  marcar en su puesto. Funciona sin señal.

**Contador y alerta**
- Contador en el cuadro del Día D: «Refrigerios: 38 de 52» (por puesto y total), con el alcance de quien pregunta, igual que el de transporte.
- Alerta nueva `logistica_sin_entregar` (mismo molde que `transporte_sin_recoger` en `lib/alertasDiaD.js`): por puesto, **sólo el día de la elección**, «pendiente» antes de `hora_limite` y «activa» después —«Puesto X: N testigos sin refrigerio
  a las 12 m.»—; cuenta testigos que **ya hicieron check-in** y no tienen entrega de ese item. Entra a `TIPOS_AVISADOS` y `FRASES` de `lib/avisosAlertas.js` para el aviso push.

**Permisos y módulo:** módulo nuevo `logistica_dia_d` (por defecto admin y coordinador en `db/init-db.js`; en `MODULOS_ASPIRANTE` / `PERMISOS_ASPIRANTE` y `HREFS_ASPIRANTE` para el aspirante), con el ítem de menú y la tarjeta del celular
(como se hizo con Transporte). La pantalla del coordinador de puesto **no** va por rol sino por tener esa fila de estructura (como el check-in).

**Qué se reutiliza:** del **check-in**, el molde de ruta (idempotente por `cliente_uuid`, `marcado_por`/origen, auditoría, fecha de hoy en Colombia); de **transporte**, la pestaña con contador en `dia-d.html`, `alertasDeTransporte`, el
reclamo atómico (`UPDATE … WHERE … IS NULL`) para no entregar dos veces y el registro del módulo; de la **cola sin señal**, `guardarEnColaOffline` (`public/js/offline-utils.js`) con un cajón `logistica`, la hora del TOQUE (no la de la
subida) y el vaciado al volver la señal. Es un parche **con base de datos** (tres tablas) y con service worker nuevo; no se estimó el tamaño.

**Dudas a resolver antes de construir:** ¿se entrega a *todo* testigo asignado o sólo al que hizo check-in?; ¿el suplente que reemplaza cuenta aparte?; ¿foto, firma o ninguna (la foto cuesta almacenamiento y tiempo en el puesto)?;
¿lleva costo y total en pesos o sólo cantidades?; ¿quién compra y reparte entre puestos —un coordinador de zona—?

## Parche 287 — Comunas validadas y dashboard por zona (8 de noviembre de 2026, INACTIVO, NO toca la base)

Zip de 9 archivos (`.version-base` = 287): `lib/comunasDeLaCampana.js` (**nuevo**) y los modificados `config/sincronizacionVotantesEstructura.js`,
`public/service-worker.js` (**v162**), `public/votantes.html`, `routes/dashboard.routes.js`, `routes/inscripcion.routes.js`, `routes/votantes.routes.js`
y `routes/votantesDashboard.routes.js`. Commit que recoge: `0ecef11`. `scripts/probar-comunas-dashboard.js` (73 comprobaciones) y `scripts/reporte-comunas.js`
**no viajan**. **Requiere el 286** (sin dependencia declarada; las mismas campañas). **No hay `init-db`: no toca la base.**

### La causa: el dato no estaba mal guardado, lo mostraba así el dashboard

«Por Comuna / Corregimiento» **no lee la columna de comuna**. Agrupaba por el **padre del `territorio_id` de la ficha**, sea del tipo que sea. Las veredas del
DANE cuelgan del **municipio** (31.927 de 32.016; ver CLAUDE.md del catálogo) y una ficha asignada «a todo el municipio» cuelga del **departamento**; así que:

| Salía | Qué eran en realidad |
|---|---|
| «MANIZALES» (6) | fichas en veredas/barrios que cuelgan directo del municipio Manizales |
| «Caldas» (2) | fichas asignadas al propio municipio (su padre es el departamento) |
| «Antioquia» (c001) | lo mismo, en un municipio de Antioquia |

La orden suponía que la ciudad o el departamento «cayeron» en el campo de comuna; **no se pudo comprobar con los datos reales** (la Base está vacía y no se puede leer la
municipal ni c001), pero la causa de arriba se reprodujo en la prueba con el código anterior (salen exactamente «MANIZALES» y «Caldas») y explica los tres casos sin
necesidad de que nadie haya escrito nada mal. **Eso cambió el arreglo:** el dashboard ahora dice «Sin comuna» donde antes decía el padre; y, aparte, el texto de comuna también se valida.

### Quién escribe `votantes.comuna_corregimiento_residencia` (y si validaba)

| Entrada | Archivo | ¿Validaba contra la lista? |
|---|---|---|
| Alta (escritorio y celular, mismo `POST /api/votantes`) | `routes/votantes.routes.js` | No: texto libre (el desplegable es sólo sugerencia) |
| Edición `PUT /api/votantes/:id` | `routes/votantes.routes.js` | No |
| Excel `/importar-excel` | `routes/votantes.routes.js` | **No escribe la columna**; usa la columna «Comuna» sólo como filtro para hallar el barrio, y una comuna que no existe rechazaba la fila entera |
| `/importar` (arreglo ya leído) | `routes/votantes.routes.js` | No escribe la columna |
| `/i/<código>` (alta y «completar vacíos») | `routes/inscripcion.routes.js` + `config/inscripcionRegistro.js` | No: sólo saneaba y cortaba a 120 |
| Copia Estructura → Votantes | `config/sincronizacionVotantesEstructura.js` | No: copia el texto libre de `usuarios` |
| **Estructura** (`usuarios.comuna_corregimiento_residencia`: alta, edición e importación en `routes/territorial.routes.js`) | — | **No, y este parche NO lo toca** (fuente del texto que la copia lleva a Votantes) |

### Qué cambió

- **Dashboard** (`routes/votantesDashboard.routes.js`): la zona de una ficha es su territorio si es comuna o corregimiento, o su padre si lo es; si no, **«Sin comuna»**
  (`zona_id = 0`; el filtro de Barrio/Vereda lo entiende). Una ficha asignada **directo a una comuna** ahora cuenta en ella (antes contaba en el municipio). La columna
  «Comuna/Corregimiento» de «Por barrio» dice «Sin comuna» y no la ciudad; «Tipo» sale «—» si no hay zona. Las fichas **sin territorio** siguen sin contarse (como siempre).
- **Validación** (`lib/comunasDeLaCampana.js`): con la campaña **teniendo comunas o corregimientos** en `territorios`, un valor que no está en la lista (sin mirar mayúsculas,
  tildes ni espacios dobles) **se guarda vacío**; la ficha se guarda igual. Sin ninguna comuna en la campaña (Quindío: cero) el texto sigue libre. Aviso al usuario: el alta y
  la edición responden `comuna_descartada` y `votantes.html` lo muestra; el Excel devuelve `avisos` («fila N: comuna "MANIZALES" no existe en la campaña; quedó vacía») y la pantalla
  cuenta cuántos. En el Excel la fila **ya no se pierde** por una comuna falsa: se ignora la comuna, y si trae barrio que existe en **varias** comunas se rechaza esa fila (no se adivina).
  En `/i` se descarta sin mensaje (quien se inscribe no puede arreglarlo). El desplegable de comunas ya existía en `votantes.html`, `territorial.html` y `/i`.
- **Alcance** (`routes/votantesDashboard.routes.js`): `calcularAlcance` y `condicionAlcanceVotantes` / `parametrosAlcanceVotantes` en **todas** las consultas que leen `votantes`:
  resumen, por comuna, por barrio, por líder (y «sin líder»), Excel y Word (por sección y completos) y el estimado por puesto/mesa. Coordinador = su rama (la misma regla que
  la lista de Votantes). **Administrador = toda la campaña, sin tocar**: no se le aplicó la regla de la madre que esconde las ramas de aspirantes (cambiaría lo que ve; no se pidió).
- **Panel general** (`routes/dashboard.routes.js`): **`/progreso-equipo` y `/tabla-posiciones` devolvían a TODOS los coordinadores y líderes de la campaña** a un coordinador
  (`ambitoDelPanel` sólo acotaba al aspirante). Ahora el coordinador ve él, sus líderes y los sublíderes de éstos, y los conteos de cada fila llevan la misma condición de Votantes.
  El administrador y el aspirante no cambian.

**Lo que NO se acotó, a propósito, y conviene saber:**
- **Cobertura territorial** (`/cobertura`, `/cobertura-detalle` y sus Excel/Word, que son el botón «Informe»): leen la estructura de territorios, no `votantes`. Un coordinador sigue
  viendo la cobertura de **toda** la campaña, con los nombres de los líderes que cubren cada barrio. Acotarlo falsearía «cubierto / sin cubrir». Decisión pendiente de Gildardo.
- **`/api/dashboard/resumen` y `/tendencia-registros`** (el resto del Panel) siguen sin acotar para el coordinador: la orden nombraba sólo la tabla de posiciones y el progreso del equipo.
- **Estructura** (`usuarios.comuna_corregimiento_residencia`) sigue siendo texto libre (ver tabla).
- **No se reescribió ninguna ficha existente.**

### Cómo correr `scripts/reporte-comunas.js` (solo lectura; no viaja)

```bash
cp /home/appestrategia-electoral/htdocs/electoral.appestrategia.net/scripts/reporte-comunas.js <carpeta-de-la-campaña>/scripts/
cd <carpeta-de-la-campaña> && node scripts/reporte-comunas.js          # 100 valores por lista; --todos o --json
```
Con el node de la cuenta de esa campaña y su `.env`. Se puede correr **antes** de aplicar el 287 (si `lib/comunasDeLaCampana.js` aún no existe usa una copia idéntica de la comparación). Dice:
(a) cuántas comunas y corregimientos tiene la campaña (sin ninguna, el texto es libre); (b) cada valor de `votantes.comuna_corregimiento_residencia` fuera de la lista, con su cantidad y si
coincide con la **ciudad** o el **departamento** (sin lista, sólo señala los que son una ciudad o un departamento); (c) lo mismo para Estructura; y (d) **cuántas fichas el dashboard
agrupa en «Sin comuna»**, por tipo de territorio y de su padre (es lo que confirma la causa de arriba). Sale con código **2** si hay fichas con comuna ajena, 0 si no, 1 si falla. No modifica nada.
**Sobre la Base** (electoraldb: 0 fichas, 0 comunas) dio: «ninguna ficha con una comuna que no sea de la campaña». No se pudo correr en municipal, departamental ni c001.

### Verificación

`scripts/probar-comunas-dashboard.js` (**73 comprobaciones**, base privada): la regla pura; alta y edición con «MANIZALES», «Caldas», «Antioquia» y una comuna buena; Excel con la ciudad, el departamento
y un corregimiento falso en su columna (resumen de avisos, barrio único, barrio en varias comunas); la copia desde Estructura; una campaña sin comunas; el dashboard con «Sin comuna» y sus filtros; el
administrador viendo 15 de 15; dos coordinadores viendo cada uno sólo lo suyo en resumen, por comuna, por barrio, por líder, Excel completo y por sección, Word completo y por sección; progreso del equipo y
tabla de posiciones; y el reporte sobre datos sembrados (10 fichas ajenas, «MANIZALES» = ciudad, «Caldas» = departamento). **Con el código anterior del dashboard la misma prueba falla 21 comprobaciones**
(salen «MANIZALES» y «Caldas», y el coordinador ve 15 de 15), así que la prueba sí detecta el problema. Más: `probar-inscripcion-enlace.js` **467/467** (se ajustó la de «cada campo se corta a su largo» y se
sumó /i con la ciudad como comuna), `probar-transporte-diad.js` 123/123, `probar-transporte-parte2.js` 80/80 y `probar-instalacion-limpia.js` (61 tablas). `node --check` en todo lo tocado y
`verificar-requires.js` sobre el zip: «TODO RESUELVE».
**NO se probó:** nada con datos reales de la municipal, la departamental ni c001 (no se pueden leer); el dashboard en un navegador (sólo la API y los archivos exportados); un Excel de miles de filas
(la comuna se comprueba contra una lista leída una sola vez); ni qué fichas reales quedarán en «Sin comuna» en cada campaña (para eso, el reporte).

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**
1. **No toca la base.** Aplicar después del 286, con la misma lista de campañas.
2. **Antes y después**, correr `reporte-comunas.js` en cada campaña. Después de aplicar, «Por Comuna» muestra «Sin comuna» en vez de la ciudad o el departamento; los números por comuna pueden subir (las fichas asignadas directo a una comuna ya cuentan en ella).
3. **Un coordinador deja de ver cifras de otras ramas** en el dashboard de votantes, sus exportaciones, el progreso del equipo y la tabla de posiciones. Es el propósito, pero se va a notar.
4. Las fichas que ya tienen una comuna ajena **no se limpian solas**: el reporte las lista y su limpieza se decide aparte.

## Parche 286 — Día D: transporte, parte 2 y orden del menú (7 de noviembre de 2026, INACTIVO, TOCA LA BASE)

Zip de 21 archivos (+ `.version-base` = 286): `lib/canalesDelEnlace.js` y `public/js/firma-sms-aviso.js` (**nuevos**) y los modificados
`db/init-db.js`, `db/schema.sql`, `lib/alertasDiaD.js`, `lib/avisosAlertas.js`, `lib/jornadaDiaD.js`, `lib/transporteDiaD.js`,
`middleware/aspirante.js`, `public/app/inicio.html`, `public/configuracion.html`, `public/configurar-crm.html`, `public/js/alertas-dia-d.js`,
`public/js/common.js`, `public/js/transporte-conductor.js`, `public/service-worker.js` (**v161**), `routes/alertasDiaD.routes.js`,
`routes/configuracion.routes.js`, `routes/rescateVotos.routes.js` y `routes/transporte.routes.js`. Commits que recoge: `e0b7da1` (el orden
del menú, que quedó fuera del 285) y `cd1cb1c` (la parte 2). `scripts/probar-transporte-parte2.js` (80 comprobaciones), `probar-transporte-diad.js`
(123) y `probar-inscripcion-enlace.js` (465) **no viajan**. **Requiere el 285** (sin dependencia declarada: activarlo con el 285 y la misma lista
de campañas).

> **Cada «Voy en camino» con consentimiento cuesta 1 SMS.** Una vez por parada, solo a quien autorizó SMS (`consentimiento_sms = 1`), no está en
> «no contactar», tiene teléfono y —si llegó por `/i`— ya confirmó por `/c`. Con la firma real de cada campaña (ver abajo) el texto mide 1 SMS;
> si una firma lo hiciera pasar, el mensaje se recorta (primero la placa, luego «Ten tu cedula lista.») y, si ni así cabe, **se envía igual y
> queda un aviso en el registro** (`[transporte] el aviso «va en camino» … no cabe en 1 SMS`).

- **Menú (e0b7da1).** «Transporte del Día D» va al final del submenú de escritorio (después de «Puestos de votación y candidatos») y, en las
  tarjetas del celular, después de «Ranking Día D» (coordinador y administrador). En el coordinador NO se partió el menú del líder: su «Faltan por
  votar» (que viene de `MENU_LIDER`) sigue más abajo. Las pestañas de `dia-d.html` ya tenían Transporte al final. **Hallazgo:** la lista de
  direcciones del aspirante con sublicencia (`HREFS_ASPIRANTE`) **no traía `/dia-d.html#transporte`** (el módulo sí era suyo y la API lo servía,
  pero el menú manda la lista de direcciones sobre la de módulos): se agregó.
- **Alerta «Transporte sin recoger»** (`lib/alertasDiaD.js`, `TIPOS`: `transporte_sin_recoger`, gravedad **7**; «mesa sin testigo» pasó a 8 y el
  chip nuevo es verde azulado). Por puesto. **Solo el día de la elección** (`fecha_eleccion` = hoy): con otra fecha, o sin fecha, no existe ni como
  «pendiente». Antes de `transporte_alerta_desde` (14:00) sale «pendiente» y en gris, como las demás que dependen de la hora; desde esa hora, activa.
  Cuenta, sin contar a quien ya votó: **a)** paradas en estado «asignado» (hay conductor, no ha recogido) y **b)** votantes con
  `necesita_transporte = 1` sin parada viva (la cancelada no cuenta). Texto: «Puesto X: N personas con transporte sin recoger (M sin
  conductor)», con N = a + b y M = b; **cuenta filas** (una parada, un votante), no el campo «personas» de la parada, y dice «1 persona» en singular.
  Con el alcance de quien pregunta (la misma condición que el listado de votantes) y **también en `alertasParaUsuario`** (la ruta de los avisos).
  **El aviso push la toma**: entra en `TIPOS_AVISADOS` de `lib/avisosAlertas.js` (esa lista es explícita, no «todas») con la frase «puesto con
  transporte sin recoger». Se avisa una vez por (persona, puesto, día): una vez avisado un puesto, los cambios de N no vuelven a avisar.
- **La hora** se cambia en Configuración → «Jornada del Día D» (campo nuevo «Transporte sin recoger: avisar desde las»), con el resto de los
  horarios (`PUT /api/dia-d/alertas/config`). Una pantalla vieja que no manda el campo **no pisa** la hora guardada (`COALESCE`); una hora inválida da 400.
- **«Voy en camino»** (`POST /t/:codigo/avisar`, botón en `public/js/transporte-conductor.js`). Las reglas viven en `lib/canalesDelEnlace.js` (la
  función se **movió** de `rescateVotos.routes.js`: una sola copia para «Ya voté» y para esto). Sale por `smsSvc.enviarSMS` —transliteración, lista de
  baja y franja horaria—, **sin** la opción `operativo`, con `origen = 'transporte'` (queda en la bitácora de SMS, `sms_envios`) y
  `aviso_enviado_en` en la parada (**columna nueva**). Una sola vez: se **reclama** con un `UPDATE … WHERE aviso_enviado_en IS NULL` antes de enviar, así
  que dos toques a la vez mandan un solo SMS; si el proveedor falla se suelta la reclamación y se puede volver a tocar (respuesta 200 con
  `ok:false`, para no gastar el cupo de intentos fallidos de un conductor en la calle). El conductor ve «Aviso enviado» o «Esta persona no recibe SMS» (**nunca
  el motivo**; la lista lo calcula al cargar, no al tocar) y el botón no se repite. Solo si la parada sigue «asignada»: ya recogida, no hay botón.
  **Necesita señal** (lo manda el servidor): no entra en la cola sin señal.
- **El texto** (el A): «{primer_nombre}, tu transporte va en camino. Conductor {nombre_corto}, placa {placa}. Ten tu cedula lista.», sin enlace y sin
  «Baja». **Medido con la firma real de cada campaña** (`sms_config.firma`, leída en cada envío; NO se supone 30). Medido hoy: sin firma 88 caracteres;
  con la de la **Base** (`« ESTRATEGIA MARKETING POLITICO»`, 30 con el espacio inicial) 118; con la de la **municipal** del panel del proveedor
  (`«Estrategia Marketing Politico - Campaña municipal»`, 49 + separador = 50) **138 → 1 SMS, sin recorte**. Con nombres largos (Maximiliano / Bartolomé
  Rodríguez Hernández) 149, también 1 SMS. De la departamental y c001-2027 **no sé** qué tienen en `sms_config.firma` (esta cuenta no las lee).
- **LA FIRMA: dónde vive y qué hacemos con ella.** La pega **el proveedor** (Onurix; la CRC la exige) y se registra **en su cuenta**: esta aplicación NO la
  escribe en el mensaje, y por eso **no se puede transliterar desde aquí**. `sms_config.firma` (en la base de cada campaña) es solo una **copia para
  CONTAR** lo que ocupa. Hasta hoy **no había ninguna pantalla** para llenarla (se llenaba a mano por SQL) y la columna era `VARCHAR(40)`: la de la
  municipal (~50) no cabía. Ahora: columna `VARCHAR(80)` (`init-db`, `MODIFY`, no toca el contenido) y un campo en **Configurar CRM → SMS** con contador y
  advertencia en vivo («Firma larga: los SMS de confirmación, Ya voté y transporte pueden costar 2 créditos» si pasa de 30 o lleva tildes o ñ). **No la
  cambia sola** y se guarda tal cual (con su ñ: es lo que hay que medir). Una pantalla vieja que no manda el campo no la borra.
- **Una corrección a lo que se creía de la ñ.** La ñ, la é y la ü **sí están en GSM-7** (`lib/sms.js`): una firma con «Campaña» **no** baja el SMS a 70
  caracteres; lo hacen á, í, ó, ú. La advertencia avisa de las dos cosas pero el detalle distingue: con ñ dice «confirme con el proveedor cómo la envía»; con í/ó,
  «baja a 70». **Lo que SÍ pasó con los 2 créditos de la confirmación de `/c` en la municipal** es probablemente otra cosa: si `sms_config.firma` está
  vacía allí, `textoDeConfirmacion` mide sin firma, no recorta y el proveedor cobra 2 al sumar sus ~50 caracteres. **Llenar la firma en cada campaña** arregla
  la medición de todos los SMS. (Hipótesis, no medida: no se puede leer la base de la municipal.)
- **Probado** (`scripts/probar-transporte-parte2.js`, 80 comprobaciones, con el **proveedor de SMS simulado**): el orden del menú; la alerta antes (13:00,
  «pendiente») y después (15:00, activa) de la hora, al día siguiente y sin fecha (no hay), por alcance (dos coordinadores y `alertasParaUsuario`), y con la
  hora cambiada a 15:30; el SMS con y sin consentimiento, con 0, de baja, sin teléfono, sin confirmar por `/c` y confirmado por `/c`; un segundo toque (no reenvía);
  dos toques a la vez; el fallo del proveedor y el `DADO_DE_BAJA`; el recorte con firmas de 50, 89, 110 y 115 caracteres (más una de 80 y una con ó, de extremo a extremo por /t); el texto transliterado;
  el guardado de la firma (recortada, con ñ, sin borrarla desde una pantalla vieja, 80 sí / 81 no) y la advertencia (30 / 31 caracteres, ñ, í). Más: `init-db` dos veces
  y `probar-instalacion-limpia.js` (61 tablas). En **Chromium sin interfaz**: la pantalla del conductor a 360 px con «Voy en camino» (tocarlo lo cambia a «Aviso
  enviado» y el proveedor simulado recibe el texto exacto) y la pantalla de la firma con su advertencia. Suites: transporte 123/123, inscripción 465/465.
  **NO se probó:** un SMS real por Onurix (ni lo que cobra de verdad ni cómo trata la firma), el aviso push llegando a un teléfono, la alerta con tráfico de
  un día de elección, `Voy en camino` desde un teléfono con señal intermitente, ni la firma de la departamental y de c001-2027.

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Toca la base:** `init-db` agrega `transporte_asignaciones.aviso_enviado_en` y ensancha `sms_config.firma` a 80 (ya viene marcado «toca base de datos»).
2. **Cada «Voy en camino» con consentimiento cuesta 1 SMS.**
3. **Llenar la firma** en Configurar CRM → SMS de cada campaña (la que tiene registrada el proveedor, con su espacio inicial si lo lleva): sin ella el contador no la cuenta.
4. La alerta solo existe el día de la elección; la hora (14:00) se cambia en Configuración → Jornada del Día D.
5. Aplicar después del 285, con la misma lista de campañas.

## Parche 285 — Menú Día D: navegación entre pestañas (7 de noviembre de 2026, INACTIVO, NO toca la base)

Zip de 5 archivos: `public/js/common.js`, `public/dia-d.html`, `public/configuracion.html`, `public/service-worker.js` (**v159**) y
`.version-base` (285). Commit que recoge: `10a79c7` (a partir de `9c3a846`, el del 284). Los cuatro archivos coinciden por md5 con
el commit. **Requiere el 284** (el `common.js` y el `dia-d.html` que modifica son los del 284: sin él, el ítem «Transporte» y su
pestaña no existen). Sin dependencia declarada (ver «Cómo exige el 273»): activarlo con el 284 y **la misma lista de campañas**.

**Qué pasaba.** En el menú de escritorio, dentro de DÍA D, «Jornada electoral» y «Avance de votación» salían los dos activos y el
segundo no respondía. Tres causas juntas en `common.js` y `dia-d.html`: (1) el activo se calculaba UNA vez al pintar el menú y para
un ítem sin ancla comparaba solo la ruta, así que «Jornada electoral» (`/dia-d.html`) se marcaba aunque la vista fuera otra;
(2) «Avance de votación» (`/dia-d.html#avance`) lleva a la MISMA página: el navegador solo cambia el `#` y no recarga, y `dia-d.html`
solo leía el ancla al cargar, sin escuchar `hashchange`; (3) las pestañas de la página cambian la URL con `history.replaceState`,
que no avisa a nadie, y por eso el menú nunca se enteraba. Las pestañas nuevas (Alertas, Transporte, Resultados) no rompieron
nada: heredaron el mismo defecto.

**Qué cambia.**
- `common.js`: cada enlace del menú lleva `data-nav-href`; `marcarActivoMenu()` decide el activo por **ruta + ancla** (el ancla
  que coincide exacta; si no hay, el ítem de esa ruta sin ancla; si no, el marcado `porDefecto`) y deja **uno solo**. Se recalcula
  al cargar, en `hashchange`, en `popstate` y cuando la página lo pide (`window.actualizarMenuActivo`). Si la página declara
  `window.paginaEscuchaHash = true`, el clic en un ítem de su misma ruta solo cambia el ancla (`pushState` + `hashchange`), **sin
  recargar**; en cualquier otra página el clic navega como siempre. Con Ctrl/Cmd, botón central o `target`, no se intercepta.
- `dia-d.html`: `pestanaDelAncla()` (`#avance`, `#alertas`, `#transporte`, `#resultados`; otro ancla o uno sin permiso → «Reportes
  de mesas»), listener `hashchange`, y `mostrarPestana` avisa al menú. Los enlaces directos abren la pestaña correcta.
- `configuracion.html`: ya escuchaba `hashchange`; ahora declara `paginaEscuchaHash` y avisa al menú al cambiar de pestaña. **Tenía
  la mitad del problema** (la marca se quedaba pegada y sin ancla no había ítem por defecto): «Datos de la campaña» es ahora
  `porDefecto`.
- Los `href` del menú **no cambian** (el aspirante con sublicencia tiene su lista de `href` exactos). ELECTORAL, LOGÍSTICA, CRM y los
  demás grupos tienen **una página por ítem** y no tenían el problema; en el celular no aplica (la navegación es otra).

**Probado en Chromium** (sin interfaz, por CDP, sesión de administrador contra el código real con la API simulada): estando en
`dia-d.html`, un clic tras otro en Jornada → Avance → Alertas → Transporte → Resultados → Jornada → Avance deja **un solo ítem
activo** y la vista correspondiente, **sin recargar** (marca en `window` intacta); Atrás vuelve a la vista anterior; los botones
de pestaña de la página actualizan el menú; los enlaces directos `#avance`, `#alertas`, `#transporte`, `#resultados`, sin ancla y
con un ancla inventada abren la pestaña correcta; y **se abrieron las 33 direcciones del menú** (incluidos los cuatro `contenido.html?clave=…` y los seis de
Configuración): en cada una queda exactamente un ítem activo y es el suyo. Suites: transporte 123/123, inscripción 465/465 (las
dos aceptan ahora `v159`). **NO se probó:** el menú con un aspirante con sublicencia o un rol con permisos recortados (los `href`
no cambian, pero no se recorrió), Safari/Firefox, ni el menú en un teléfono.

**NOTAS PARA QUIEN LO APLIQUE:** no toca la base y no pide reiniciar nada más allá de lo habitual de un parche; el navegador
recoge `common.js` nuevo al subir el service worker a `v159` (la primera carga puede pedir recargar una vez).

## Parche 284 — Día D: transporte, parte 1 (7 de noviembre de 2026, INACTIVO, TOCA LA BASE)

Zip de 28 archivos (+ `.version-base` = 284): `lib/transporteDiaD.js`, `lib/busquedaCedula.js`, `routes/transporte.routes.js` y
`routes/transporteDiaD.routes.js` (**nuevos**); `public/js/transporte-conductor.js` y `public/js/transporte-dia-d.js`
(**nuevos**); `public/vendor/leaflet/` (**nuevo**: Leaflet 1.9.4, su LICENSE BSD-2 y sus 5 imágenes); y los modificados `app.js`,
`db/init-db.js`, `middleware/aspirante.js`, `public/app/inicio.html`, `public/asistentes-reuniones.html`, `public/dia-d.html`,
`public/js/common.js`, `public/service-worker.js` (**v158**), `routes/checkinDiaD.routes.js`, `routes/permisos.routes.js`,
`routes/usuarios.routes.js` y `routes/votantes.routes.js`. Commit que recoge: `98cf9b2` (a partir de `b0b2afb`).
`scripts/probar-transporte-diad.js` (123 comprobaciones) y `scripts/probar-inscripcion-enlace.js` (465) **no viajan**.

> **El enlace del conductor solo funciona el día de la elección** (la fecha de `configuracion_campana`, de 00:00 a 23:59 hora de
> Colombia). Antes y después dice «Este enlace no está activo»: para ensayar, se cambia la fecha de elección.
>
> **Quien tenga el enlace ve las direcciones de su lista.** Si un conductor lo pierde o lo reenvía, **rotarlo** (botón «Rotar»: el
> anterior deja de servir en el acto). Solo ve SUS paradas, solo ese día, y una parada cerrada ya no manda dirección ni teléfono.
>
> **El fondo del mapa es OpenStreetMap** (`tile.openstreetmap.org`, con su atribución): sin clave ni gasto, pero es un servicio
> comunitario con política de uso justo; para mucho tráfico habría que pasar a otro proveedor o a Mapbox. Sin señal para las
> teselas el mapa queda gris y la lista funciona igual.

- **Lo que ya existía y se reutiliza:** la demanda es `votantes.necesita_transporte` (la marca el líder con `rescate_votos`, no
  cambia); el código del conductor usa el alfabeto y las funciones de `/i` (`generarCodigo`, `normalizarCodigo`); el patrón de
  página pública es el de `/i` (después del candado de licencia, `noindex`, límite de intentos FALLIDOS por IP); las coordenadas
  del puesto salen de `ubicacionDelPuesto` (catálogo, `routes/checkinDiaD.routes.js`); la distancia, de `lib/jornadaDiaD.js`; la
  cola sin señal sigue la idea del check-in (marca con `cliente_uuid`, idempotente en el servidor).
- **Tablas** (`db/init-db.js`, `CREATE TABLE IF NOT EXISTS`, idempotente; todas con `aspirante_id` como dueño, 0 = la madre):
  `transporte_vehiculos` (placa única por campaña, tipo, capacidad, descripción, activo), `transporte_conductores` (nombre,
  celular, `vehiculo_id`, `codigo CHAR(8)` único, activo, `usuario_id` opcional) y `transporte_asignaciones` (`votante_id`,
  `conductor_id`, `fecha`, `orden`, `personas`, `nota`, `estado` asignado/recogido/en_puesto/no_estaba/cancelado, `recogido_en`,
  `llevado_en`, coordenadas del toque, `cliente_uuid`, `asignado_por`; **UNIQUE(votante_id, fecha)**). Y
  `configuracion_campana.transporte_alerta_desde TIME DEFAULT '14:00:00'` (queda creada; **la usa la parte 2**). La prueba corre
  `init-db` dos veces y comprueba las tres tablas, las columnas, el UNIQUE y la hora.
- **Módulo `transporte_dia_d`**, declarado en los cinco sitios: `PERMISOS_POR_DEFECTO` (admin y coordinador), la matriz de
  `routes/permisos.routes.js`, el menú de escritorio (`common.js`, «Transporte del Día D» → `/dia-d.html#transporte`),
  `middleware/aspirante.js` (módulo y permisos del aspirante) y la tarjeta de `app/inicio.html`. Un líder sin el módulo recibe 403;
  **seguirá marcando «necesita transporte»** con `rescate_votos`.
- **Escritorio, pestaña «Transporte»** de `dia-d.html` (`public/js/transporte-dia-d.js`): demanda agrupada por puesto y barrio con
  filtros (todos / sin asignar / asignados / por conductor, e «incluir a quienes ya votaron»), vehículos y conductores (crear,
  editar, desactivar, asignar vehículo; el código se crea solo y se rota), asignar varios a un conductor con **aviso de capacidad
  que no bloquea** (suma de «personas» contra la capacidad del vehículo), quitar, **«Ordenar por cercanía»** (vecino más cercano con
  la distancia de `lib/jornadaDiaD.js`, sin API: desde la primera parada, desde mi ubicación, o desde un puesto con coordenadas en
  el catálogo; las paradas sin coordenadas quedan al final), y **compartir** el enlace por WhatsApp (`wa.me`), SMS (`sms:`) o Copiar
  con el texto «Hola {nombre}, esta es tu lista de recogida del día de elecciones: {enlace}», sin el pie «Baja». Personas y nota por
  parada con el botón ✎.
- **El contador** (`GET /api/dia-d/transporte/resumen`, seis tarjetas en el cuadro del Día D y en la pestaña), con el alcance de quien
  pregunta: *necesitan* (marcados), *asignados* (con conductor, sin recoger), *recogidos*, *en el puesto*, *no estaban* y
  *sin recoger* (marcados, sin «ya votó» y sin recoger: sin conductor o con conductor que no ha llegado). Las paradas son de UN día: con
  otra fecha de elección el contador de asignaciones parte de cero.
- **`/t/<código>`** (`routes/transporte.routes.js`, `public/js/transporte-conductor.js`): pública, **después del candado de licencia**
  como `/i`, `noindex` y `no-store`. Inexistente, mal formado, desactivado, rotado (el código viejo) y fuera de la fecha de elección
  reciben LA MISMA respuesta byte a byte («Este enlace no está activo»; en las rutas JSON `{"activo":false}`). El límite de
  intentos fallidos es el de `/i` (40 cada 15 minutos por IP; las visitas buenas no gastan cupo). Cada parada trae **primer nombre e
  inicial del apellido** (con tres palabras o más, el apellido es la PENÚLTIMA: «Ana María Pérez Gómez» → «Ana P.»), dirección,
  barrio, personas, puesto, mesa; «Llamar» (`tel:`, el número no se escribe en pantalla), «Navegar» (Google Maps
  `…/dir/?api=1&destination=lat,lon` o la dirección) y Waze (con coordenadas), y «Cómo llegar al puesto» con las coordenadas del
  catálogo. **«Recogido», «Llevado al puesto» y «No estaba»** son idempotentes con `cliente_uuid`; la pantalla responde al
  instante y la marca espera en una cola del teléfono (localStorage) que sube sola con señal; la hora que cuenta es la del toque; la
  ubicación se pide **solo al tocar** y nunca bloquea. Después de «Llevado al puesto» o «No estaba» la parada se colapsa y el servidor
  **ya no manda dirección, barrio, teléfono ni coordenadas**; lo mismo si el votante marca «Ya voté» por `/v` (o el equipo). Una marca
  que no hace avanzar el estado (una repetida, o un «recogido» que llega tarde, después de «llevado») no cambia nada.
- **«Llevado al puesto» NO es «ya votó»:** nunca se escribe en `votante_votos`.
- **Mapa:** Leaflet 1.9.4 servido desde `public/vendor/leaflet/` (sin CDN; sha256 de `leaflet.js` `db49d009…641a` y `leaflet.css`
  `a7837102…04c6`, copias sin cambios del paquete npm; ver `LEEME.txt`), pines numerados por parada pendiente con coordenadas y otro
  por cada puesto de destino. La página manda `Referrer-Policy: origin` (OpenStreetMap lo pide para sus teselas).
- **Punto 5 (pendiente de la orden 31): `GET /api/usuarios/buscar-por-cedula`.** Misma regla que votantes: la cuenta **propia, de su
  rama (hacia abajo) o de quien cuelga (hacia arriba)** responde como siempre; **fuera de su alcance, solo
  `{ existe, fuera_de_alcance, iniciales }`**; el administrador (sin sublicencia) ve todo; el aspirante mira desde su propia rama.
  Comparte con la búsqueda de votantes **el MISMO contador de 60 cada 10 minutos** (`lib/busquedaCedula.js`, una sola instancia de
  `express-rate-limit`) y lo ajeno queda en `auditoria` (`buscar_cedula_ajena`, entidad `usuarios`, tres últimos dígitos). Encuentra la
  cédula escrita con puntos o ceros. La alta rápida de asistentes sigue ofreciendo «Agregar» a una cuenta de su alcance y avisa de la
  que está fuera. **Consecuencia que conviene saber:** un líder ya no puede agregar como asistente la cuenta de OTRO líder (fuera de
  su rama); la orden lo pide así.
- **Verificado sobre el zip:** los 27 archivos de código coinciden por md5 con el commit `98cf9b2`; sin `.env`, `.credenciales-*`,
  `uploads/`, `legislacion/`, `backups/`, `scripts/` ni `.sql`; `verificar-requires.js` revisó 118 `require` locales y todos
  resuelven **aplicando el zip sobre una copia del árbol del 283** (`b0b2afb`), con un control negativo.
- **Probado:** 123 comprobaciones del transporte y del punto 5 (init-db dos veces, permisos, asignar y desasignar, el aviso de
  capacidad, el UNIQUE, ordenar por cercanía, `/t` con código vivo, inexistente, inactivo, rotado y fuera de fecha, el conductor que
  no ve paradas de otro, marcar idempotente, la parada cerrada por «Ya voté», el contador por alcance); la suite de inscripción
  (465) y `probar-instalacion-limpia.js` (61 tablas). En **Chromium sin interfaz**: `/t` a 360 px con mapa y OpenStreetMap, la cola sin
  señal (con los POST caídos la marca queda en la cola, la parada cambia al instante y el aviso lo dice; al volver la señal sube sola
  y la cola queda en cero), y la pestaña de escritorio con un arnés mínimo. **NO se probó:** el botón «Navegar» abriendo Google Maps
  o Waze en un teléfono, el GPS real al tocar una marca, la pestaña dentro de `dia-d.html` con una sesión real (solo su JS con un
  arnés y las rutas con la suite), los avisos al conductor por SMS/WhatsApp desde un teléfono, ni un día de elección con tráfico real
  sobre las teselas de OpenStreetMap.
- **Queda para la parte 2:** la alerta «votantes con transporte sin recoger a las 2 p. m.» (la hora ya está en
  `transporte_alerta_desde`; falta calcularla en `lib/alertasDiaD.js`, también en `alertasParaUsuario`) y el SMS «tu transporte va en
  camino» al votante.
- **Cómo exige el 283.** Sin declarar dependencia (ver «Cómo exige el 273»): **activar el 284 con el 283, el 282, el 281, el 280, el
  279, el 278, el 277 y el 276 y los anteriores, con la misma lista de campañas.**

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Toca la base:** `init-db` crea tres tablas y una columna (ya viene marcado «toca base de datos»).
2. **El enlace del conductor solo funciona el día de la elección.** Para ensayar antes, cambiar la fecha de elección en Configuración →
   Datos de la campaña (y devolverla).
3. **Quien tenga el enlace ve las direcciones de su lista: rotarlo si se pierde.**
4. **El fondo del mapa es OpenStreetMap.**
5. El coordinador y el administrador ven la pestaña «Transporte» de fábrica; otro rol, desde «Asignación de permisos».
6. Los líderes dejarán de poder agregar como asistente la cuenta de otro líder fuera de su rama.
7. Aplicar después del 283, con la misma lista de campañas.

## Parche 283 — privacidad al buscar cédula y SMS al reinscribirse (7 de noviembre de 2026, INACTIVO, TOCA LA BASE)

Zip de 6 archivos: `config/inscripcionRegistro.js`, `db/init-db.js`, `public/asistentes-reuniones.html`,
`public/js/validacion-cedula-ui.js`, `routes/votantes.routes.js` y `.version-base` (283). Commit que recoge: `f9e4798` (a
partir de `badeaae`, el del 282). `scripts/probar-inscripcion-enlace.js` (465 comprobaciones) **no viaja**. **Service worker sin
cambio** (`v157`): ninguno de los archivos que cambian está en su precache y los demás se piden «red primero».

### Parte A — buscar por cédula sin exponer datos ajenos

- **Lo que pasaba:** `GET /api/votantes/buscar-por-cedula` (cualquier usuario con sesión; el router solo exige `requireAuth`)
  devolvía **nombre, teléfono y cédula** de la ficha dueña de esa cédula **aunque fuera de otro líder**, y las pantallas
  **rellenaban el formulario** con ese nombre y teléfono. Lo llamaban `public/js/validacion-cedula-ui.js` (cargado por
  `votantes.html` —escritorio—, `territorial.html`, `testigos.html` y `app/registro-votante.html` —celular—) y la alta rápida de
  `public/asistentes-reuniones.html`.
- **Qué devuelve ahora (JSON de ejemplo inventado):**
  - **Ficha propia o dentro de su alcance** (la misma condición del listado, `lib/alcanceVotantes.js`; o `mia`: es suya, o de su
    rama): como siempre. `{ "id": 41, "nombre": "Pedro Gómez Ruiz", "telefono": "3001234567", "cedula": "1053123456", "mia": true, "puede_sumar": false }`
  - **Ficha de otro líder:** solo `{ "existe": true, "de_otro_lider": true, "iniciales": "P. R.", "puede_sumar": false }`. Ni
    teléfono, ni cédula, ni nombre, ni correo, ni dirección, ni puesto, **ni id**, ni quién es el líder dueño. Las iniciales son
    la primera y la última palabra del nombre, sin partículas («de», «del»…).
  - **Administrador** (sin sublicencia): todo, como siempre. **Cédula que no existe:** `null`, como siempre.
  - **Ojo, el coordinador NO tiene «alcance total»:** su alcance es su rama (sus líderes y los de ellos), no toda la campaña. Una
    ficha de otra rama —por ejemplo la de un aspirante— le sale con iniciales. La orden decía «coordinador con alcance total»; no
    existe tal cosa hoy y no lo cambié.
  - **Pasados 60 en 10 minutos:** HTTP 429 `{ "error": "Demasiadas búsquedas, espera unos minutos" }`.
- **El límite:** 60 por **usuario** (no por IP: varios líderes comparten la wifi de un evento) cada 10 minutos, con `express-rate-limit`
  en memoria del proceso (un reinicio de PM2 lo pone en cero). **Cuenta también a `sumar-por-cedula` y a
  `/:id/sumar-a-mi-rama` cuando traen cédula** (son la misma pregunta). Una consulta sin cédula no cuenta.
- **La bitácora:** la tabla `auditoria` que ya existía (`registrarAuditoria`), acción **`buscar_cedula_ajena`**, entidad `votantes`,
  `usuario_id`, `created_at`, `ip` y el detalle «Buscó una cédula de otro líder (***456)»: solo los tres últimos dígitos, nunca la
  cédula completa ni el id de la ficha. **No hay tabla ni columna nueva para esto.** Solo deja rastro una búsqueda que cae en una
  ficha ajena (no la propia ni una cédula inexistente). Para ver a quien recorre cédulas, como administrador en la base:
  `SELECT usuario_id, COUNT(*) n, MIN(created_at), MAX(created_at) FROM auditoria WHERE accion = 'buscar_cedula_ajena' GROUP BY usuario_id ORDER BY n DESC;`
- **Sumar a mi rama:** la regla **no cambió** (se acredita con la cédula o con el alcance; solo quien está en la rama de un aspirante
  puede sumar). Como una ficha ajena ya no trae su id, **nueva ruta `POST /api/votantes/sumar-por-cedula { cedula }`**: el servidor
  encuentra la ficha por la cédula (normalizada, con las variantes guardadas) y aplica la MISMA función que `/:id/sumar-a-mi-rama`
  (que sigue existiendo). Sumada, la búsqueda la devuelve completa y como propia.
- **Las pantallas** (probadas en Chromium con un `api()` simulado): «**Esta persona ya está inscrita con otro líder (P. G.)**»; el
  botón «**Sumar a mi rama**» solo si `puede_sumar`; **no se rellena nada del formulario** y no se muestran campos vacíos; ya sumada
  dice «Listo: esta persona quedó en su rama.». Pasado el límite se dice el mensaje. En la **alta rápida de asistentes** una ficha
  ajena ya no ofrece «Agregar» (no tiene id): primero se suma, y entonces la búsqueda la encuentra como propia.
- **No cambió, y conviene saberlo:** `GET /api/usuarios/buscar-por-cedula` (cuentas del sistema) sigue devolviendo nombre y teléfono
  del usuario con esa cédula a quien pregunte (la alta rápida de asistentes lo usa). Son cuentas de la estructura, no votantes; si se
  quiere tratarlo igual, es otra orden.

### Parte B — SMS de confirmación al reinscribirse por `/i`

- **La regla:** cédula que ya existe + **el celular coincide** → se encola **otra vez el mismo SMS de confirmación** de `/c` si se
  cumplen **las cuatro a la vez**: (1) `consentimiento_confirmado_en` vacío; (2) la persona **marcó el SMS en este envío**; (3) la ficha
  no tiene `no_contactar` (la baja); (4) no se le mandó uno —enviado o en cola— en las **últimas 24 horas**. Celular que no coincide,
  ficha ya confirmada o casilla sin marcar: **no se manda nada y no se modifica nada**. **La respuesta pública no cambia** (la misma
  página «¡Listo!» para nueva, existente con SMS, y existente sin SMS; la prueba lo compara byte a byte).
- **La cola:** `inscripcion_sms_cola` tiene `UNIQUE(votante_id)` (uno por ficha en la vida); para poder repetir se **reutiliza la
  misma fila**: pasa otra vez a `pendiente` y se le renueva `creado_en`. «Hace cuánto» es `COALESCE(enviado_en, creado_en)`.
- **La evidencia de ESTE envío, solo en campos vacíos**, antes de encolar: fecha, método, versión de la política y los canales marcados
  que estén en NULL («no consta»), y la fila de `votante_consentimiento_evidencia` (IP, navegador, enlace, política; si ya había, se
  conserva la primera). **Interpretación que conviene confirmar:** un **0 puesto a mano** en una ficha de un líder (la persona dijo que
  no) **no se convierte en 1**, y entonces no se manda nada; en una ficha que **nació de este mismo formulario** (`origen = enlace_lider`)
  el 0 solo significa «no marcó el SMS», así que lo último que declara la propia persona manda y pasa a 1. Sin ese 1 la cola omite el
  mensaje («no autorizó el SMS»), por eso sin él ni se encola.
- **La anotación:** columna nueva **`inscripcion_intentos.sms_reenviado TINYINT(1) NOT NULL DEFAULT 0`** (por eso toca la base); se pone
  en 1 si se encoló en la reinscripción. Sin la columna (init-db sin correr) la inscripción sigue y simplemente no anota.
- Una ficha de **otro líder** con el celular que coincide también recibe el SMS (la regla no la excluye) y el dueño no cambia.
  Un cambio de pasada: la rama «completar la autorización de una ficha sin consentimiento» ahora también cubre un `NULL` (la columna es
  `NOT NULL DEFAULT 0`, así que en la práctica no cambia nada).

### Verificación y despliegue

- **Verificado sobre el zip:** los 5 archivos de código coinciden por md5 con el commit `f9e4798`; sin `.env`, `.credenciales-*`,
  `uploads/`, `legislacion/`, `backups/`, `scripts/` ni `.sql`; `verificar-requires.js` revisó 41 `require` locales y todos resuelven
  **aplicando el zip sobre una copia del árbol del 282** (`badeaae`), con un control negativo. `express-rate-limit` ya es dependencia.
- **Probado:** 465 comprobaciones sobre una base simulada (las de la orden: ficha propia, ajena —con el JSON completo revisado—,
  coordinador, administrador, aspirante, la 61 con 429, la bitácora, sumar, y los siete casos del SMS) y `probar-instalacion-limpia.js`.
  **Control negativo:** contra el código anterior fallan 21 de las nuevas. **NO se probó:** el envío real del SMS (el proveedor se
  sustituyó por un registro en memoria), las pantallas contra el servidor real (solo el cliente con un `api()` simulado), ni el tope
  de 60 con varios procesos (vive en memoria de cada uno).
- **Cómo exige el 282.** Sin declarar dependencia (ver «Cómo exige el 273»): **activar el 283 con el 282, el 281, el 280, el 279, el
  278, el 277 y el 276 y los anteriores, con la misma lista de campañas.**

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Toca la base:** `init-db` agrega una columna (ya viene marcado «toca base de datos»).
2. Los líderes dejarán de ver nombre y teléfono de personas de otros líderes al teclear su cédula: ahora solo se dice que ya están
   inscritas. Avisar al equipo; es lo esperado.
3. Una persona que se reinscribe puede recibir otro SMS de confirmación (máximo uno cada 24 horas).
4. Aplicar después del 282, con la misma lista de campañas.

## Parche 282 — cédulas sin duplicados en el alta, la importación y la edición (7 de noviembre de 2026, INACTIVO)

Zip de 9 archivos: `config/inscripcionRegistro.js`, `config/sincronizacionVotantesEstructura.js`,
`config/sincronizarSublicencias.js`, `config/testigoElectoral.js`, `lib/normalizarCedula.js`, `lib/ramas.js`,
`routes/coberturaTestigos.routes.js`, `routes/votantes.routes.js` y `.version-base` (282). Commit que recoge: `6d14c9a`
(a partir de `a314d13`, el del 281). **NO toca la base de datos** (sin `db/`) **ni el service worker** (ningún archivo
cacheado cambió). `scripts/probar-inscripcion-enlace.js` (413 comprobaciones) y `scripts/reporte-cedulas.js` **no viajan**.

> **ANTES Y DESPUÉS DE APLICAR, correr `scripts/reporte-cedulas.js` en cada campaña** (ver «Cómo correr el reporte»).
> El parche no limpia nada: deja de CREAR duplicados; los que ya existan los muestra el reporte y se limpian en otra orden.

- **El problema.** `votantes.cedula` es `UNIQUE`, pero el índice solo ve el texto idéntico, y el alta normal, la edición
  y las importaciones guardaban la cédula **como se tecleaba**. «1.053.123.456» y «1053123456» eran dos fichas de la misma
  persona, sin error (la prueba nueva lo confirma: contra la ruta anterior, el alta de la variante responde 200 y crea la
  segunda ficha; la orden 28 solo lo había cerrado en `/i`).
- **Dónde se guarda una cédula en `votantes` (las seis entradas, y qué hacen ahora):**
  1. **Alta normal** (`POST /api/votantes`; la usan el formulario de escritorio, la app del celular y el alta rápida de
     asistentes): valida lo tecleado con `revisarCedula` (mismos mensajes: acepta puntos y espacios; rechaza letras, guiones,
     vacía-de-dígitos, demasiado corta o larga), guarda **solo dígitos sin ceros a la izquierda**, y rechaza con el mensaje de
     siempre —**«Ya registrado por otro líder.»**— si otra ficha ya tiene esa cédula escrita como sea.
  2. **Edición** (`PUT /api/votantes/:id`): igual; la propia ficha no cuenta (puede traer su cédula vieja con puntos y se
     guarda ya normalizada).
  3. **Importación por Excel** (`POST /api/votantes/importar-excel`): valida cada cédula (antes NO validaba nada: una letra
     entraba), la guarda normalizada, y **salta** la fila si la cédula ya está en una fila anterior del archivo o en la base
     (normalizada). Cada una queda en `cedulasRepetidas` —`{ fila, donde: 'archivo'|'base', cedula: '***456', otraFila }`—
     y también en `errores` (lo que la pantalla ya muestra), con el número de fila de Excel y **nunca la cédula completa**.
     La base se consulta **una vez para todo el archivo** (`mapaDeFichasPorCedula`: un `IN` por el índice y un solo barrido de
     las guardadas con signos o ceros), no una vez por fila. En modo «actualizar» (fila con ID) la propia ficha no cuenta.
  4. **Importación JSON** (`POST /api/votantes/importar`, solo admin/coordinador; ninguna pantalla la llama): las mismas reglas.
  5. **Sincronización Estructura → Votantes** (`config/sincronizacionVotantesEstructura.js`, al crear o editar una cuenta de
     la estructura): la ficha se busca escrita como esté y, si existe, se usa **su** escritura como llave del `INSERT … ON
     DUPLICATE KEY` (no crea una segunda ni la reescribe); si no existe, nace normalizada.
  6. **El formulario público `/i`** (orden 28): ya normalizaba; ahora usa la MISMA función de búsqueda (movida a la librería,
     no duplicada).
  **No hay escáner de cédulas en el código** (`SPEC-escaner-cedulas.md` es solo una especificación) ni otra pantalla que escriba
  `votantes.cedula`. `sumar-a-mi-rama` no la escribe: compara (ver abajo).
- **La regla, en un solo sitio:** `lib/normalizarCedula.js` — `normalizarCedula` (solo dígitos, sin ceros delante),
  `buscarFichaConCedula` / `buscarFichaPorCedula` (por el índice y, si no hay, entre las variantes guardadas),
  `mapaDeFichasPorCedula` (para importar) y `buscarUsuarioPorCedula`. **No se reescribe ninguna cédula ya guardada** salvo
  la de la ficha que alguien edita (queda normalizada): otras partes cruzan por texto y la limpieza va aparte.
- **Lo que hoy MUESTRA el sistema de otra ficha (no se cambió, y es lo que preguntaste):** `GET /api/votantes/buscar-por-cedula`
  —lo que el formulario consulta antes de guardar— devuelve **nombre, teléfono y cédula** de la ficha dueña de esa cédula
  **aunque sea de otro líder**, sin filtro de alcance: es una decisión documentada en el propio código («solo confirma quién es
  el dueño de ESA cédula puntual», para poder sumar a esa persona a la rama). Lo único que cambió es que ahora la encuentra
  también si está guardada con puntos o ceros (la misma exposición, ahora completa para las variantes). El alta y la edición
  **no** muestran nada de la otra ficha: solo «Ya registrado por otro líder.».
- **Cruces por texto con `usuarios.numero_identificacion`, ahora comparando normalizado los dos lados** (una ficha vieja
  «1.053.123.456» sigue casando con una cuenta «1053123456» y al revés):
  `routes/votantes.routes.js` (el **listado**, su **conteo** y la **exportación**: `LEFT JOIN usuarios ut ON …`),
  `lib/ramas.js` (`usuarioDeVotante`, `recalcularTodas` y la actualización por sublicencia),
  `config/testigoElectoral.js` (`supervisorDelTestigo` y `resolverOCrearUsuarioParaTestigo`),
  `routes/votantes.routes.js` `procesarSublider` (cuenta del sublíder), `config/sincronizarSublicencias.js`,
  `config/sincronizacionVotantesEstructura.js` (los dos sentidos) y `routes/coberturaTestigos.routes.js` (los conjuntos de cédulas).
  `sumar-a-mi-rama` y `verificar-identificacion` también comparan normalizado.
  **Sin cambiar a propósito:** (a) las altas y ediciones de `usuarios` (`routes/territorial.routes.js`, `routes/usuarios.routes.js`):
  comparan cuentas contra cuentas y `numero_identificacion` es también el nombre de usuario y la clave inicial —normalizarlo
  ahí cambiaría cómo entra la gente—; (b) `db/init-db.js` (unión de una migración de una sola vez); (c) la búsqueda de texto
  del listado (`v.cedula LIKE '%…%'`): buscar «1.053» no encuentra «1053…»; (d) `routes/eventos.routes.js`, que solo muestra
  `COALESCE(v.cedula, u.numero_identificacion)`.
- **MEDIDO ANTES DE CAMBIAR LOS CRUCES SQL** (MySQL 8.4 privado, 200.000 votantes, 3.000 cuentas, 150 de ellas con puntos), con la
  ruta real, mediana de 5 corridas (de 2 en la exportación): el **listado** pasa de **2,4 s a 1,9 s** (páginas 1 y 400), y la
  **exportación completa** de **35,7 s a 33,9 s**. **No es más lento**: igualar por una expresión sobre los dos lados hace que
  MySQL use una unión por hash en vez de 200.000 búsquedas por índice. (Y casa a las 150 cuentas con puntos, que la igualdad
  exacta dejaba sin unir: 2.850 de 3.000.) La variante «solo normalizar la cuenta y dejar un tramo `OR` para fichas viejas»
  **no terminó** en más de 200 s: se descartó. Ojo con un dato aparte: la exportación de 200.000 fichas ya tardaba ~35 s antes.
  `supervisorDelTestigo`, que es UNA cuenta, NO usa la unión (barrería todos los votantes en cada llamada): busca por la función común.
- **Cómo correr el reporte** (solo lectura; **no viaja en el parche**: está en `scripts/` de la Base). Desde la carpeta de cada
  campaña, con el node de SU cuenta y su `.env`, copiando el archivo si hace falta:
  ```bash
  cp /home/appestrategia-electoral/htdocs/electoral.appestrategia.net/scripts/reporte-cedulas.js <carpeta-de-la-campaña>/scripts/
  cd <carpeta-de-la-campaña> && node scripts/reporte-cedulas.js          # 200 grupos; --todos o --json
  ```
  Lista **(a)** los grupos de casi-duplicados —id de ficha, líder, fecha de creación, cédula enmascarada (***456) y cómo está
  guardada— y **(b)** cuántas cédulas están guardadas con signos o ceros sin tener duplicado. Nunca imprime una cédula completa
  y no modifica nada (la prueba compara el `CHECKSUM TABLE`). Sale con código **2 si hay casi-duplicados**, 0 si no, 1 si falla.
  Con 200.000 fichas tarda unos 6 s.
- **Resultado en la Base** (`electoraldb`, 7 de noviembre de 2026): 0 fichas (es la plantilla), índice `UNIQUE` presente, 0
  casi-duplicados, 0 guardadas con signos o ceros. **Las campañas NO se pudieron medir** (esta cuenta no lee sus bases).
- **Verificado sobre el zip:** los 8 archivos de código coinciden por md5 con el commit `6d14c9a`; sin `.env`,
  `.credenciales-*`, `uploads/`, `legislacion/`, `backups/`, `scripts/` ni `.sql`; `verificar-requires.js` revisó 56 `require`
  locales y todos resuelven **aplicando el zip sobre una copia del árbol del 281** (`a314d13`), con un control negativo.
- **Probado:** 413 comprobaciones sobre una base simulada (alta con puntos, espacios y ceros; alta de una variante, con el mismo
  mensaje y sin datos de la otra ficha; edición a una cédula existente; importación con una repetida en el archivo y otra contra
  la base, con su número de fila y sin cédula completa; cruces con cuentas escritas distinto, en el listado, el conteo, la
  exportación, ramas, testigos y sincronización; el reporte sobre datos sembrados) y `probar-instalacion-limpia.js`.
  **Control negativo:** la misma suite contra la ruta `votantes.routes.js` anterior falla 25 comprobaciones. **NO se probó:** una
  campaña real con fichas viejas, el formulario de escritorio ni la app del celular contra el servidor (solo sus rutas), ni el
  orden de magnitud de una importación de miles de filas contra un catálogo grande con muchas variantes.
- **Un cambio de conducta que conviene saber:** la importación por Excel **ahora rechaza** una fila con la cédula inválida (con letras,
  guiones, demasiado corta…); antes la guardaba tal cual. Y una cédula con guiones («1-053-123-456») sigue rechazándose en el alta
  y la edición, como hoy.
- **Cómo exige el 281.** Sin declarar dependencia (ver «Cómo exige el 273»): **activar el 282 con el 281, el 280, el 279, el
  278, el 277 y el 276 y los anteriores, con la misma lista de campañas.**

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Antes:** correr `scripts/reporte-cedulas.js` y guardar el resultado. **Después:** correrlo otra vez; no debe haber grupos
   nuevos. Los que ya existían se limpian en otra orden, con lo que salga.
2. No toca la base: no hace falta `init-db` ni cambia el service worker.
3. Una ficha vieja con la cédula con puntos **se normaliza sola la primera vez que alguien la edita** (queda «1053…»); una cuenta
   con puntos sigue casando con ella.
4. Aplicar después del 281, con la misma lista de campañas.

## Parche 281 — inscripción por enlace: mensaje de invitación con eslogan (7 de noviembre de 2026, INACTIVO, TOCA LA BASE)

Zip de 10 archivos: `config/inscripcionMensaje.js` y `config/inscripcionTarjeta.js` (**nuevos**), `db/init-db.js`,
`public/app/mi-enlace.html`, `public/img/inscripcion-og.png` (**nuevo**, imagen genérica de la tarjeta),
`public/service-worker.js` (**v157**), `public/votantes.html`, `routes/inscripcion.panel.routes.js`,
`routes/inscripcion.routes.js` y `.version-base` (281). Commit que recoge: `82d8637` (a partir de `fae7508`, el del 280).
`scripts/probar-inscripcion-enlace.js` (357 comprobaciones) y `scripts/generar-imagen-inscripcion.js` **no viajan**.

> **LLENAR EL ESLOGAN EN LA CONFIGURACIÓN DE CADA CAMPAÑA** (Configuración → Datos de la campaña → «Slogan de la
> campaña», y el nombre del candidato). Sin eslogan el mensaje sale sin su línea ✨ y la vista previa dice solo
> «Inscríbete con {candidato}»; sin candidato, «Inscríbete con nuestro equipo».

- **Columnas que ya existían (no se creó ninguna de datos de campaña):** `configuracion_campana.slogan_campana VARCHAR(255)`
  (el eslogan; ya se llena en Configuración), `nombre_candidato VARCHAR(150)`, y para la marca `marca_titulo`,
  `marca_subtitulo` y `marca_logo_url` (ruta `/uploads/marca/…`, carpeta que ya es pública). No hay columna de foto.
  Respaldo: si falta `slogan_campana` se usa `marca_subtitulo`; si falta `nombre_candidato`, `marca_titulo`. Un líder que
  cuelga de un **aspirante con sublicencia** usa los DEL ASPIRANTE (su nombre y el subtítulo de su sublicencia), igual que
  `GET /api/configuracion`.
- **La única columna nueva:** `inscripcion_config.mensaje_plantilla TEXT NULL` (por eso toca la base). **NULL = el texto
  sugerido**, que vive en `config/inscripcionMensaje.js`: así las campañas que nunca lo editaron reciben las mejoras
  futuras. Guardar un texto idéntico al sugerido lo deja en NULL.
- **Plantilla y reglas.** Variables: `{nombre_lider}` (primer nombre, bien escrito), `{candidato}`, `{eslogan}`, `{enlace}`;
  **no hay `{cargo}` ni número de tarjetón**, y el texto sugerido no menciona cargo, elección, voto ni tarjetón (una
  prueba lo comprueba). **Si a una línea le falta un dato, se quita la línea entera**; nunca queda «{eslogan}» ni dos
  líneas en blanco seguidas; una llave desconocida cuenta como dato faltante. Un dato que trae llaves no se vuelve a
  expandir. El administrador la edita en **Votantes → Inscripciones por enlace → Ajustes → «Mensaje de invitación»**, con
  vista previa y **«Restaurar texto sugerido»**; el servidor rechaza (400) una variable que no existe, un texto sin
  `{enlace}`, vacío, de más de 1000 caracteres o con una llave suelta. Cada cambio queda en la auditoría.
- **Texto final (datos de ejemplo):**
  ```
  Hola 👋, soy Ana.
  ✨ Juntos por Manizales
  Te invito a sumarte al equipo de María Gómez. Juntos vamos a lograrlo.
  📝 Inscríbete en menos de 1 minuto, desde tu celular:
  👉 https://electoral.appestrategia.net/i/AB23CD45
  Tus datos están protegidos y solo se usan para la campaña. ¡Cuento contigo!
  ```
- **«Mi enlace»** (`GET /api/inscripcion/mi-mensaje`): el líder ve el texto ya lleno en un cuadro y el SMS corto en otro,
  los edita **solo para ese envío** (no se guardan), y los botones **Por WhatsApp**, **Por SMS** (`sms:?&body=`, abre en
  iPhone y Android), **Copiar mensaje** y **Compartir…** usan lo que haya en los cuadros; «Copiar solo el enlace» queda
  como texto. Sin conexión o si el servidor falla, vuelve el texto sencillo de antes. El mensaje se guarda en el
  teléfono junto con el QR; las cédulas enmascaradas del aviso del 280, no.
- **SMS corto** (automático, sin emojis ni tildes): `{nombre_lider}: {eslogan}. Inscribete con {candidato} aqui: {enlace}`.
  Si no cabe en 1 SMS **se quita el eslogan**; si aún no cabe, también el candidato. Lo manda el líder desde SU teléfono:
  no lleva firma ni «Baja:». **Medido con los tres dominios** (enlace de 8 caracteres): `electoral.appestrategia.net`
  106 caracteres, `campanadepruebamunicipal.appestrategia.net` 121, `campanadepruebadepartamental.appestrategia.net` 125; en
  el peor caso (nombre de 39 letras y eslogan de 80) 119 / 134 / 138, **sin eslogan** y en 1 SMS.
- **Vista previa del enlace (Open Graph de `/i/<código>`):** `og:title` «{candidato} · {eslogan}» (o «Inscríbete con
  {candidato}», o «Inscríbete con nuestro equipo»), `og:description` «Súmate al equipo. Inscríbete en menos de 1 minuto.»,
  `og:image` 1200 × 630, `twitter:card`; **`noindex` se mantiene**. **Idéntica para un código válido, inexistente, mal
  formado, desactivado o de otro líder y sin nada del líder** (la prueba compara los `<meta>` de los cinco casos); sale
  también en la página «Enlace no activo». **Usa la campaña madre, no la del aspirante:** si un líder cuelga de un
  aspirante, su MENSAJE nombra al aspirante pero la tarjeta del enlace muestra al candidato de la campaña. Es el precio de
  que la tarjeta no dependa del código; si molesta, se cambia.
- **La imagen.** Con logo (`marca_logo_url`): `/i/og/imagen`, una copia **JPEG de 1200 × 630** hecha con `sharp`
  (el logo no se enlaza: puede pesar hasta 4 MB y WhatsApp descarta lo grande), en memoria, con tope de 400 KB y
  `?v=` que cambia con el logo. Un logo **claro con transparencia** (como el de la plataforma, hecho para fondos
  oscuros) va sobre el azul de la app; uno oscuro o sin transparencia, sobre blanco. Sin logo, o si no se puede
  leer, o si la ruta no está dentro de `/uploads/marca` (se usa solo el nombre del archivo): **`inscripcion-og.png`**,
  «SÚMATE AL EQUIPO · Inscríbete en menos de 1 minuto» con una persona y un «+», generada como `ya-vote-og.png` (el
  guion `scripts/generar-imagen-inscripcion.js` la rehace). Sin `LICENCIA_DOMINIO` no se inventa una URL de imagen.
- **Seguridad de despliegue.** `leerAjustes` (que usa cada visita a `/i`) **no se tocó**: la plantilla se lee aparte y
  tolerante. Una campaña que aplique el parche pero **no corra `init-db`** sigue inscribiendo; «Mi enlace» usa el texto
  sugerido y guardar la plantilla responde 409 «falta actualizar la base de datos», no un 500 (lo prueba la suite
  quitando la columna a propósito).
- **Verificado sobre el zip:** los 9 archivos de código coinciden por md5 con el commit `82d8637`; sin `.env`,
  `.credenciales-*`, `uploads/`, `legislacion/`, `backups/`, `scripts/` ni `.sql`; `verificar-requires.js` revisó 24
  `require` locales y todos resuelven **aplicando el zip sobre una copia del árbol del 280** (`fae7508`), con un control
  negativo (sin `lib/transliterarSms.js` falla). `sharp` ya es dependencia declarada del proyecto.
- **Probado:** 357 comprobaciones sobre una base simulada (reemplazo de variables, línea faltante, validaciones, SMS con
  los tres dominios, plantilla editar/restaurar y permisos, sin la columna, OG con y sin eslogan, OG idéntico para códigos
  inválidos, imagen con un logo de 0,7 MB y uno ilegible, fondo según el logo, y los textos de las dos pantallas) y
  `probar-instalacion-limpia.js` (58 tablas). Capturas a 360 px de «Mi enlace» y de la imagen con el logo real de la
  plataforma. **NO se probó:** la vista previa **en WhatsApp de verdad** (el robot de WhatsApp tiene sus propias reglas de
  caché y de tamaño), el botón «Por SMS» en un iPhone y un Android, ni el editor del escritorio en un navegador con
  sesión (solo su HTML y los endpoints). WhatsApp guarda en caché la tarjeta de un enlace por días: si se prueba con un
  enlace ya compartido, puede seguir mostrando «Inscríbete».
- **Cómo exige el 280.** Sin declarar dependencia (ver «Cómo exige el 273»): **activar el 281 con el 280, el 279, el 278,
  el 277 y el 276 y los anteriores, con la misma lista de campañas.**

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Llenar el eslogan y el nombre del candidato** en Configuración → Datos de la campaña, y subir el logo si hay.
2. **Toca la base:** `init-db` agrega una columna (ya viene marcado «toca base de datos»).
3. Revisar el texto en Votantes → Inscripciones por enlace → Ajustes → «Mensaje de invitación»: es el sugerido y se
   puede cambiar. Para una campaña que ya está en fase de elección, el administrador puede escribir su propio texto con
   cargo o llamado al voto; el texto sugerido es a propósito de precampaña.
4. **Service worker v157:** los teléfonos con la app instalada refrescan solos al tener señal.
5. Aplicar después del 280, con la misma lista de campañas.

## Parche 280 — inscripción por enlace: botón de consulta de puesto y control de cédulas (7 de noviembre de 2026, INACTIVO, TOCA LA BASE)

Zip de 9 archivos: `config/inscripcionRegistro.js`, `db/init-db.js`, `lib/normalizarCedula.js` (**nuevo**),
`public/app/mi-enlace.html`, `public/js/common.js` (solo un comentario), `public/service-worker.js` (**v156**),
`routes/inscripcion.panel.routes.js`, `routes/inscripcion.routes.js` y `.version-base` (280).
Commit que recoge: `539f7e3` (a partir de `bccb7e8`, el del 279). `scripts/probar-inscripcion-enlace.js` (ahora con 274
comprobaciones) **no viaja**.

- **La URL de la Registraduría estaba mal en `/i`** (la que puso el 279, `wsp.registraduria.gov.co/censo/consultar/`, ya no
  existe). Ahora es `https://consultacenso.registraduria.gov.co/`, una constante (`URL_CONSULTA_CENSO`) en
  `routes/inscripcion.routes.js`, igual a la de `public/js/common.js`. Se buscó en todo el repo: la dirección vieja ya no
  está en ningún `.js`, `.html`, `.css`, `.json` ni `.sh` (la prueba lo comprueba); `consulta-censo.js`,
  `app/registro-votante.html` y `app/puesto-votacion.html` ya llevaban la buena. Queda `SPEC-escaner-cedulas.md` con
  `wapp.registraduria.gov.co`: es un documento de especificación de otro servidor, no se tocó.
- **Botón en DÓNDE VOTAS:** «Consultar mi lugar de votación», a todo el ancho, justo bajo el título y antes de Puesto y
  Mesa; abre la Registraduría en otra pestaña (`target="_blank" rel="noopener noreferrer"`), sin cédula en la URL, con la
  línea «Consulta y vuelve aquí para elegir tu puesto y mesa». Es un `<a role="button">` con aspecto de botón (navega, no
  ejecuta código, y no depende de JavaScript ni lo frena un bloqueador de ventanas). A 360 px el texto del botón baja a
  dos líneas y se lee bien (captura revisada).
- **Cédulas: lo que había.** `votantes.cedula` **ya era `UNIQUE`** (en `db/schema.sql`), pero ese índice solo ve el texto
  idéntico y **el alta normal guarda la cédula como se tecleó** (sin normalizar: «1.053.123.456», «01053123456»). Una
  ficha así no chocaba con «1053123456» y `/i` habría creado una **segunda ficha de la misma persona, sin error**. Con
  cédula idéntica, `/i` ya hacía lo correcto (`ER_DUP_ENTRY` → completa solo si el celular coincide).
- **Lo que hace ahora:** `lib/normalizarCedula.js` (solo dígitos, sin ceros a la izquierda; la misma regla de
  `validarFormato`) se usa al guardar y al **buscar**: primero por el índice, y si no hay, contra las variantes guardadas
  con signos o ceros (`REGEXP_REPLACE`, sin índice, solo cuando la cédula es nueva). **No se reescribe ninguna cédula ya
  guardada** (otras pantallas cruzan `votantes.cedula` con `usuarios.numero_identificacion` por texto). Mismo
  comportamiento de antes en los dos casos de cédula existente: **celular coincide → solo se completan los campos
  vacíos; no coincide → no se modifica nada** (comprobado campo por campo, incluidas coordenadas y consentimiento).
- **La bitácora y el aviso al líder:** en los dos casos el intento queda con `motivo = 'cedula_existente'`, `cedula_fin`
  (últimos 3 dígitos) y `celular_coincide` (0/1). «Mi enlace» (`GET /api/inscripcion/mi-enlace` → `avisos`, los 20 más
  recientes de ese enlace) muestra al líder dueño: «Cédula ***456 · 07/11/2026 14:01 · el celular coincidía (se
  completaron solo los campos vacíos)» o «… NO coincidía (no se modificó nada)». Otro líder no los ve; la cédula
  completa no viaja; no se guardan en el teléfono (caché sin conexión). Si la base aún no tiene las columnas, la pantalla
  sigue funcionando sin avisos.
- **Lo que ve la persona:** la misma página «¡Listo!» para cédula nueva, existente con su celular y existente con otro
  celular (igual byte a byte, también con la casilla de SMS marcada; no dice «ya está inscrita»). **Tiempo medido:**
  medianas de 9 en la prueba, 16 ms (nueva), 15 ms (existente con su celular) y 13 ms (existente con otro celular).
  **Es un banco de pruebas con una base casi vacía:** con una campaña de cientos de miles de fichas el barrido por
  variantes costará más, y lo pagan las cédulas nuevas. No se midió.
- **TOCA LA BASE DE DATOS** (`toca_base_datos = true`, lo derivó el servidor de licencias porque el zip trae `db/`): el
  actualizador corre `npm run init-db` en cada campaña. Agrega **dos columnas** a `inscripcion_intentos`
  (`cedula_fin CHAR(3)`, `celular_coincide TINYINT(1)`, nulables; idempotente) y comprueba el índice de
  `votantes.cedula`: **si ya es UNIQUE no hace nada** (lo esperable), si falta y no hay cédulas repetidas lo crea, y **si
  hay repetidas NO lo crea: avisa por consola («AVISO: votantes.cedula NO tiene índice UNIQUE y hay cédulas repetidas…») y
  sigue.** Probado a mano sobre una base de prueba: columnas ausentes → agregadas; sin UNIQUE y con duplicados → aviso y
  sin índice; sin duplicados → índice creado. Y `probar-instalacion-limpia.js` pasó sobre una base vacía (58 tablas).
- **Duplicados en la Base** (`electoraldb`, medido hoy con la cuenta de Electoral): índice `cedula` UNIQUE presente,
  **0 filas** en `votantes` (es la plantilla), 0 duplicados exactos y 0 después de normalizar. **Las campañas NO se
  pudieron medir** (esta cuenta no lee sus bases): hay que correr en cada una, antes de aplicar:
  `SELECT cedula, COUNT(*) FROM votantes GROUP BY cedula HAVING COUNT(*)>1;` y, para los casi-duplicados,
  `SELECT TRIM(LEADING '0' FROM REGEXP_REPLACE(cedula,'[^0-9]','')) c, COUNT(*) FROM votantes WHERE cedula IS NOT NULL AND cedula<>'' GROUP BY c HAVING COUNT(*)>1;`
  (el segundo es el que el índice no ve).
- **No cubierto, a propósito:** el **alta normal** (`routes/votantes.routes.js`) sigue sin normalizar la cédula ni
  detectar variantes («1.053…» frente a «1053…»): el parche arregla el enlace de inscripción, no ese formulario. Si se
  quiere, es otra orden (con cuidado por el cruce con `usuarios.numero_identificacion`).
- **Verificado sobre el zip:** los 8 archivos de código coinciden por md5 con el commit `539f7e3`; `.version-base` = 280;
  sin `.env`, `.credenciales-*`, `uploads/`, `legislacion/`, `backups/`, `scripts/` ni `.sql`; `verificar-requires.js` revisó
  29 `require` locales y todos resuelven **aplicando el zip sobre una copia del árbol del 279** (`bccb7e8`), con un
  control negativo (sin `lib/validarCedula.js` falla, como debe).
- **Probado:** 274 comprobaciones sobre una base simulada (la URL, el botón y su posición, cédula repetida con puntos,
  espacios y ceros, otro celular sin cambios, respuesta idéntica y tiempos, el aviso al líder). **NO se probó:** la
  pantalla «Mi enlace» en un navegador con sesión (solo se probó la respuesta del servidor, el texto del HTML y la
  función de fecha), ni que la Registraduría abra bien desde un celular, ni una campaña real con muchas fichas.
- **Cómo exige el 279.** Sin declarar dependencia (ver «Cómo exige el 273»): **activar el 280 con el 279, el 278, el 277 y
  el 276 y los anteriores, con la misma lista de campañas.**

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Antes, correr las dos consultas de duplicados** de arriba. Si salen filas, hablarlo antes de activar: el índice no
   se crea con duplicados, y el control del enlace trata la primera coincidencia que encuentre.
2. **Toca la base: marcar «toca base de datos»** (ya viene marcado en el registro). Al aplicarlo se corre `init-db`;
   revisar su salida por si dice «AVISO: votantes.cedula…».
3. **Service worker v156:** los teléfonos con la app instalada refrescan solos al tener señal.
4. Aplicar después del 279, con la misma lista de campañas.

## Parche 279 — inscripción por enlace: formulario por secciones y GPS (7 de noviembre de 2026, INACTIVO)

Zip de 3 archivos: `config/inscripcionRegistro.js`, `routes/inscripcion.routes.js` y `.version-base` (279).
Commit que recoge: `8456601` (a partir de `2fa5ce1`, el del 278). `scripts/probar-inscripcion-enlace.js` (ahora con 236
comprobaciones) **no viaja**; el service worker no cambia (`/i` lo arma el servidor; no hay archivo estático nuevo).

- **Qué cambia a la vista:** el formulario `/i/<código>` queda en cuatro secciones, con título en mayúsculas, negrita y
  azul de la marca (`#0B5ED7`) y una línea fina debajo, como «DATOS DE CONTACTO» de la ficha: **DATOS PERSONALES**
  (cédula, nombre), **DATOS DE CONTACTO** (botón GPS, dirección, departamento, ciudad, comuna/corregimiento,
  barrio/vereda, celular, correo), **DÓNDE VOTAS** (puesto con buscador, mesa, enlace a la Registraduría) y
  **TRATAMIENTO DE DATOS PERSONALES** (política vigente, autorización, canales sin marcar, «Inscribirme»). Obligatorios
  con «(obligatorio)»: cédula, nombre, celular y la autorización (los mismos cuatro `required` de antes). Los nombres de
  campo y las validaciones del servidor no cambian. Comuna y barrio siguen ocultos si la campaña no los usa.
- **GPS.** «Usar mi ubicación (GPS)» solo consulta al navegador al tocarlo. Las coordenadas viajan en dos campos
  ocultos (`gps_lat`, `gps_lon`) que **el servidor no da por buenos**: números, dentro de Colombia (caja
  −4,3…13,5 / −82…−66,8, que incluye San Andrés y Providencia) y redondeadas a 7 decimales. Se guardan en
  `votantes.latitud/longitud` con `geocodificado_en` y entonces **no se geocodifica por dirección**. Unas coordenadas
  inválidas se **descartan sin error** (quien se inscribe no puede corregir un campo oculto) y la ficha se geocodifica
  por su dirección como antes. En una ficha existente **solo si no tenía coordenadas** (o le faltaba una del par) y con
  el celular que coincide.
- **Geocodificación inversa: `POST /i/<código>/ubicacion`** (con la misma `GOOGLE_MAPS_API_KEY`, función
  `geocodificarInversa` que ya existía). Propone dirección (solo la calle: lo anterior a la primera coma; un «plus code»
  no se propone), barrio, ciudad y departamento; el navegador los pone **solo en un campo vacío o con el valor por defecto
  de la campaña sin tocar**, nunca sobre lo que la persona escribió. Sin clave o ante cualquier fallo responde
  `{disponible:false}` y solo quedan las coordenadas («Ubicación tomada»). **Cada toque del botón gasta una consulta de
  Google.** Topes que cuentan TAMBIÉN las llamadas buenas: **20 por IP cada 15 minutos y 400 por enlace al día**, en
  memoria (un reinicio los pone en cero); la 21.ª / 401.ª da 429 sin llegar a Google. Una IP compartida (un evento con una
  sola wifi) comparte su cupo.
- **Dónde votas.** El puesto sale del endpoint público de puestos de la campaña (sin cambios), con un buscador sin tildes
  ni mayúsculas; «No sé» en puesto y en mesa; la mesa va de 1 a `cantidad_mesas` del puesto (el servidor ya lo exigía).
  un enlace a la Registraduría abre otra pestaña, sin la cédula ni ningún parámetro en la URL. **Esa dirección estaba
  mal** (la del servidor «wsp» ya no existe): la corrige el 280, con `https://consultacenso.registraduria.gov.co/`.
- **Verificado sobre el zip:** los 2 archivos de código coinciden por md5 con el commit `8456601`; no trae `.env`,
  `.credenciales-*`, `uploads/`, `legislacion/`, `backups/`, `scripts/`, `db/` ni `.sql`; `verificar-requires.js` revisó 19
  `require` locales y todos resuelven **aplicando el zip sobre una copia del árbol del 278** (`2fa5ce1`), con un control
  negativo (sin `config/geocoder.js` falla, como debe).
- **NO toca la base de datos** (`toca_base_datos = false`): no hay cambios en `db/` y no hace falta `init-db`.
- **Probado con una base simulada** (un MySQL privado desechable) y con Google **sustituido por funciones de prueba**:
  236 comprobaciones (orden de las secciones, obligatorios, 12 clases de coordenadas inválidas, ficha existente con y sin
  coordenadas, puesto y mesa, inversa con y sin clave, y los dos topes). Además, el botón se ejercitó en **Chromium sin
  interfaz con un GPS falso**: llena los campos vacíos, **no pisa lo escrito** (ni una ciudad tecleada a mano) y con el
  permiso negado avisa «Escribe tu dirección» sin llenar nada. Captura a 360 px: una columna, sin desborde horizontal.
  **NO se probó:** Google Geocoding real (ni la inversa ni la directa), un GPS de verdad en un teléfono, ni las listas
  con el catálogo nacional.
- **Riesgo conocido, no resuelto:** quien toca el GPS estando en otro sitio (el trabajo) y después teclea su dirección de
  casa queda con las coordenadas del trabajo y **sin** geocodificación por la dirección escrita. El texto del botón lo
  advierte («Tócalo si estás en tu casa»), nada más. Si se quiere cerrar, la salida es descartar las coordenadas cuando la
  dirección escrita difiere de la propuesta.
- **Cómo exige el 278.** Sin declarar dependencia (ver «Cómo exige el 273»): **activar el 279 con el 278, el 277, el 276 y
  los anteriores, con la misma lista de campañas.**

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **La inversa solo funciona si la campaña tiene `GOOGLE_MAPS_API_KEY`** en su `.env` (con la Geocoding API activada).
   Sin ella el botón igual guarda las coordenadas y dice «Ubicación tomada»; no propone dirección.
2. **Gasto:** una consulta de Google por cada toque del botón, con tope de 20 por IP cada 15 minutos y 400 por enlace al
   día. Más lo que ya costaba la geocodificación por dirección (que con GPS ya no se hace).
3. Los topes viven en memoria: tras reiniciar PM2 el contador vuelve a cero.
4. Aplicar después del 278, con la misma lista de campañas. No hace falta `init-db`.

## Parche 278 — inscripción por enlace: datos de contacto completos (7 de noviembre de 2026, INACTIVO)

Zip de 3 archivos: `config/inscripcionRegistro.js`, `routes/inscripcion.routes.js` y `.version-base` (278).
Commit que recoge: `6d7b514` (a partir de `a5a1f6a`, el del 277). `scripts/probar-inscripcion-enlace.js` (ahora con 184
comprobaciones) **no viaja**; el service worker no cambia (el formulario `/i` lo arma el servidor, no hay archivo
estático nuevo).

- **Qué hace:** el formulario `/i/<código>` trae, después del celular, la sección «Datos de contacto»: correo,
  dirección, departamento, ciudad, comuna/corregimiento y barrio/vereda, con los nombres de columna de la ficha
  (`email`, `direccion`, `departamento_residencia`, `ciudad_residencia`, `comuna_corregimiento_residencia`,
  `barrio_residencia`). **Todo es opcional**; los obligatorios siguen siendo nombre, cédula, celular y la
  autorización. Recorte, espacios colapsados, sin caracteres de control y corte al largo de la columna (150, 255,
  100, 100, 120, 120). Departamento y ciudad vienen prellenados con `territorio_departamento` y `territorio_ciudad` de
  la campaña (o `departamento`/`ciudad` si no están) y se pueden editar. `GET /i/<código>/territorio` (solo lectura,
  sin cédulas ni personas) ofrece las listas de la propia vista `territorios` —departamentos, municipios, comunas y
  corregimientos, y barrios y veredas, **estas también cuando cuelgan directo del municipio**—; sin listas, texto libre.
  Si la campaña tiene «¿Utilizar nombre de comunas?» o «de barrios?» en No, ese campo no se muestra, como en el celular.
- **Guardado:** cédula nueva, todo. **Ficha existente con el celular que coincide: solo los campos que tenía vacíos**
  (una cadena vacía cuenta como vacío); nunca se sobrescribe un dato, ni siquiera el de una ficha de otro líder, y
  si el celular no coincide no se toca nada. **Con dirección se geocodifica en segundo plano** (no se espera, no pisa
  unas coordenadas que ya existan, y sin `GOOGLE_MAPS_API_KEY` no falla ni escribe advertencias; «Re-geocodificar
  pendientes» de Votantes recoge después las que quedaron sin coordenadas).
- **Verificado sobre el zip:** los 3 archivos coinciden por md5 con el disco; no trae `.env`, `.credenciales-*`,
  `uploads/`, `legislacion/`, `backups/`, `scripts/`, `db/` ni `.sql`; sin secretos en el texto;
  `verificar-requires.js` revisó 18 `require` locales y todos resuelven **aplicando el zip sobre una copia del árbol
  del 277** (`a5a1f6a`), con un control negativo (sin `config/geocoder.js` falla, como debe).
- **NO toca la base de datos** (`toca_base_datos = false`): no hay cambios en `db/` y no hace falta `init-db`.
- **Probado solo con una base simulada** (un MySQL privado desechable) y con el geocodificador **sustituido por una
  función de prueba**: 184 comprobaciones (no falla sin clave, con error, sin resultado, ni cuando tarda 1,5 s: la
  respuesta sale en menos de un segundo). **No** se probó Google Geocoding real, ni las listas con el catálogo
  nacional (la prueba usó una tabla `territorios` de seis filas), ni el formulario en un celular real (sí se vio en
  una captura de 360 px, en una columna).
- **Cómo exige el 277.** Sin declarar dependencia (ver «Cómo exige el 273»): **activar el 278 con el 277 y el 276 y los
  anteriores, con la misma lista de campañas.** Sin el 277 le faltan `config/inscripcionEnlace.js` y las tablas.

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Revisar «Datos de la campaña» → departamento y ciudad** antes de repartir QR: son lo que el formulario muestra
   ya escrito. En una campaña departamental la ciudad queda vacía (cada persona pone la suya) y la lista de ciudades
   sale de los municipios del ámbito.
2. **Si la campaña no usa comunas o barrios** (los dos interruptores de Datos de la campaña), esos campos no aparecen
   en el formulario público, igual que en el celular del líder.
3. **Una ficha que ya tenía dirección no la cambia el formulario público:** quien quiera corregirla lo hace desde la
   ficha. El formulario solo rellena lo que estaba en blanco, y solo si el celular escrito coincide con el de la ficha.
4. **Cada dirección nueva cuesta una consulta a Google Geocoding** (si la campaña tiene la clave). Hasta 200 inscripciones
   por enlace al día es el tope de la 277; si hace falta limitar el gasto, bajar ese tope en Votantes → «Inscripciones
   por enlace» → Ajustes.
5. **Aplicar después del 277, con la misma lista de campañas.** No hace falta `init-db`.

## Parche 277 — inscripción por enlace/QR del líder (7 de noviembre de 2026, INACTIVO)

Zip de 22 archivos (+ `.version-base` = 277), cada uno con su motivo:
`app.js` (monta `/i` **después** del candado de licencia, `/api/inscripcion` y el reloj de 60 s de la cola de SMS);
`config/confirmacionConsentimiento.js` (token de `/c` de 22 caracteres y búsqueda sin caducidad para la baja);
`config/inscripcionEnlace.js` y `config/inscripcionRegistro.js` (**nuevos**: el código del líder, el pase firmado
del formulario, la inscripción en transacción y el SMS de confirmación); `db/init-db.js` y `db/schema.sql` (tablas
y `origen`); `middleware/aspirante.js` (`/inscripcion` permitido al aspirante); `public/app/inicio.html` (entrada
«Mi enlace de inscripción»); `public/app/mi-enlace.html` (**nuevo**, QR, copiar, WhatsApp, descargar PNG, cambiar
enlace); `public/app/mis-registros.html` («Se inscribió solo · sin confirmar / confirmado» y «N por tu enlace»);
`public/js/qrcode-generator.js` (**nuevo**, librería de QR `qrcode-generator` 1.4.4, **licencia MIT, Kazuhiko
Arase**, con su cabecera de licencia intacta); `public/js/validacion-cedula-ui.js` (manda la cédula a
`sumar-a-mi-rama`); `public/service-worker.js` (`v155`); `public/votantes.html` (filtros, etiqueta y pestaña
«Inscripciones por enlace»); `routes/comunicaciones.routes.js` (los pendientes no entran en masivos);
`routes/confirmacion.routes.js` (`/c` ofrece la baja); `routes/dashboard.routes.js` (`porEnlace`);
`routes/inscripcion.routes.js` (**nuevo**, la página pública `/i/:codigo`) y `routes/inscripcion.panel.routes.js`
(**nuevo**, «Mi enlace» y el cuadro del escritorio); `routes/rescateVotos.routes.js` (el «Ya voté» tampoco sale a
un pendiente) y `routes/votantes.routes.js` (`sumar-a-mi-rama` acredita a la persona, filtros del listado y de la
exportación, y un comentario corregido).
Commits que recoge, en orden: `e2fd450` (`sumar-a-mi-rama`), `39842eb` (esquema), `9f65117` (librería de QR),
`dcbc2ab` (página pública, API y cola de SMS), `379f355` (pendiente de confirmar), `1f73c93` (pantalla del celular),
`8af7fb5` (escritorio) y `5c61a71` (SMS de 1 segmento y baja en `/c`), más `7bada64` (corrige el comentario falso
de `votantes.routes.js`: `config/sms.js` NO pega el «Baja: …»; lo pega `agregarBajaSms`, solo a los envíos de campaña).
`scripts/probar-inscripcion-enlace.js` y las pruebas **no viajan**.

- **Verificado sobre el zip:** los 22 archivos coinciden por md5 con el disco; no trae `.env`, `.credenciales-*`,
  `uploads/`, `legislacion/`, `backups/`, `scripts/` ni pruebas (el único `.sql` es `db/schema.sql`); sin secretos
  en el texto; `CACHE_NAME = 'estrategia-v155'`; `verificar-requires.js` revisó 133 `require` locales y todos
  resuelven **aplicando el zip sobre una copia del árbol del 276** (`40077aa`), y con un control negativo (sin
  `config/paginaBaja.js` falla, como debe). El archivo publicado tiene el mismo sha256 que el local.
- **Toca la base de datos (sí; lo marcó el servidor):** tablas `inscripcion_enlaces`, `inscripcion_intentos`,
  `inscripcion_config` (una fila con los topes), `votante_consentimiento_evidencia` e `inscripcion_sms_cola`;
  `votantes.origen` gana el valor `enlace_lider`. Todo idempotente (`init-db` dos veces seguidas, limpio, sobre una
  base vacía) y `scripts/probar-instalacion-limpia.js` pasa (58 tablas).
- **Probado solo con una base simulada** (un MySQL privado desechable): `scripts/probar-inscripcion-enlace.js`, 141
  comprobaciones. **No** se probó: un SMS real por Onurix o Twilio, escanear el QR con un celular (el QR se dibuja
  con la librería y se vio bien en una captura, pero ningún lector lo decodificó; intentar bajar un decodificador
  fue bloqueado por el clasificador de permisos y no se esquivó), ni la pestaña de escritorio en un navegador con sesión.
- **Cómo exige el 276.** El sistema no declara dependencias (ver «Cómo exige el 273», en el 274): **activar el 277
  con el 276 y los anteriores y con la misma lista de campañas.** Sin el 274 le falta `config/paginaBaja.js` y
  `/c` no arranca.

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Cada líder, sublíder y coordinador tiene su enlace y su QR** en el menú del celular, «Mi enlace de inscripción»
   (el administrador no tiene: no está en la estructura). La gente lo escanea y se inscribe sola: nombre, cédula,
   celular de 10 dígitos (empieza por 3), correo opcional, puesto y mesa opcionales (los del Día D de la campaña) y
   la casilla de autorización. «Cambiar mi enlace» deja de servir el QR anterior: si ya lo imprimieron, hay que
   volver a imprimirlo. El coordinador (y el administrador) puede desactivarlo o cambiarlo desde Votantes →
   «Inscripciones por enlace»; el administrador además fija el interruptor general y los topes (200 por enlace al día,
   3 por teléfono al día, 4 segundos mínimos).
2. **Lo inscrito por enlace queda «sin confirmar» y no recibe masivos ni el enlace «Ya voté» hasta confirmar** por
   el SMS (`/c`). Sale en cualquier canal: SMS, correo y push. Quien se inscribe solo con el correo y sin SMS no
   puede confirmar solo: el coordinador le pide la confirmación por correo con el botón de la ficha.
3. **Cada inscripción con el SMS marcado cuesta 1 SMS.** Es uno por persona en la vida y sale dentro de la franja
   (08:00–20:00; fuera de ella queda para la apertura). Texto: «{primer_nombre}, confirma tu inscripcion aqui:
   {enlace}»; con la firma de 30 caracteres mide 132, 147 y 151 con `electoral`, `campanadepruebamunicipal` y
   `campanadepruebadepartamental`. **No lleva el «Baja: …»**: la baja está en la página de `/c` («No quiero recibir
   más mensajes»). El token de `/c` de este SMS es de 22 caracteres; los enlaces de 64 que ya salieron siguen sirviendo.
4. **Una ficha que ya existía solo se completa si el celular escrito coincide con el que tenía.** Si la cédula es de
   otro líder, no cambia de dueño; el coordinador ve el intento (sin cédula) en la pestaña. La respuesta de la página
   es siempre «¡Listo!»: nunca dice si la cédula ya estaba.
5. **Requiere `LICENCIA_DOMINIO` en el `.env`** (todas las campañas ya la tienen, porque la licencia la exige). Sin
   ella: la licencia no valida y el candado bloquea todo, `/i` incluido; y, si aun así corriera, el SMS de
   confirmación **no sale** (queda `fallido` en `inscripcion_sms_cola` con el motivo, sin reintento) y el QR de
   «Mi enlace» se arma con el dominio desde el que se abrió la pantalla.
6. **`sumar-a-mi-rama` ya no acepta un id suelto:** exige que la ficha esté en el alcance de quien llama o que traiga
   la cédula que coincide (el formulario ya la manda).
7. **Aplicar después del 276, con la misma lista de campañas, y correr `npm run init-db`** (el actualizador lo hace
   solo porque `toca_base_datos` es sí).

## Parche 276 — Día D fase 4: cobertura, check-in, alertas y avisos (7 de noviembre de 2026, INACTIVO)

Zip de 36 archivos: `app.js`, `db/init-db.js`, `db/schema.sql`, `lib/alertasDiaD.js`, `lib/avisosAlertas.js`,
`lib/coberturaTestigos.js`, `lib/jornadaDiaD.js`, `lib/mesasEnVivo.js` (los cinco, nuevos),
`middleware/aspirante.js`, `public/app/alertas-dia-d.html` y `public/app/checkin.js` (nuevos),
`public/app/dia-d.html`, `public/app/faltantes.html`, `public/app/inicio.html`, `public/configuracion.html`,
`public/css/style.css`, `public/dia-d.html`, `public/enviar-sms.html`, `public/js/alertas-dia-d.js` y
`public/js/cobertura-testigos.js` (nuevos), `public/js/common.js`, `public/js/offline-utils.js`,
`public/js/segmentos-sms.js`, `public/service-worker.js` (`v154`), `public/territorial.html`,
`public/votantes.html`, `routes/alertasDiaD.routes.js`, `routes/checkinDiaD.routes.js` y
`routes/coberturaTestigos.routes.js` (nuevos), `routes/comunicaciones.routes.js`, `routes/diaD.routes.js`,
`routes/permisos.routes.js`, `routes/rescateVotos.routes.js`, `routes/resultadosDiaD.routes.js`,
`routes/votantes.routes.js` y `.version-base` (276).
Commits que recoge, en orden: `8c186e1` (cobertura de testigos), `356eb0c` (aviso al testigo por SMS),
`f735d11` (plantilla más corta), `12bed88` (servidor de la fase 4), `eaeb2d4` (pantallas de la fase 4),
`ec3c1fe` (avisos push automáticos) y `cb077c8` (interruptor, diagnóstico y franja).

- **Verificado sobre el zip:** los 36 archivos coinciden por md5 con el disco; no trae `.env`,
  `.credenciales-*`, `uploads/`, `legislacion/`, `backups/`, `scripts/` ni pruebas; `CACHE_NAME =
  'estrategia-v154'`; `verificar-requires.js` revisó 158 `require` locales y todos resuelven, **aplicando el
  zip sobre una copia del árbol del 275** (`ba98b06`).
- **Toca la base de datos (sí; lo marcó el servidor):** tablas `dia_d_suplentes_testigo`, `dia_d_checkin`,
  `dia_d_alertas_atendidas` y `dia_d_alertas_avisadas`; en `configuracion_campana`: `max_mesas_por_testigo` y los
  siete de la jornada (`jornada_apertura`, `jornada_cierre`, `plazo_e14_min`, `alerta_checkin_min`,
  `baja_votacion_pct`, `baja_votacion_desde`, `avisos_alertas_push`); `votantes.necesita_transporte`; el módulo
  de permisos `alertas_dia_d` (admin y coordinador de fábrica) y la plantilla «Testigo - aviso de asignacion».
  Todo idempotente, con «ya existía». IndexedDB del celular sube a la versión 4.
- **Probado solo con bases simuladas.** No se corrió `init-db` en MySQL, ni un push real, ni nada en un celular o
  un navegador. La latencia real de una vuelta de avisos no se midió (solo su CPU: ~230 ms la primera con 300
  alertas y 12 destinatarios, ~50 ms las siguientes).

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Revisar los horarios de la jornada ANTES del día:** Configuración → Datos de la campaña → «Jornada del Día
   D» (apertura 08:00, cierre 16:00, plazo del E-14 120 min, aviso de llegada 30 min, baja votación 40 % desde las
   12:00). Salen con esos valores por omisión; sin la fecha de elección configurada, los avisos automáticos no
   trabajan. Solo el administrador de la campaña principal los edita.
2. **Los coordinadores deben abrir la app del celular y activar los avisos** (casilla «Recibir avisos en este
   dispositivo», en la pantalla de inicio; en iPhone, con la app agregada a la pantalla de inicio). La franja
   «Activa los avisos…» se lo recuerda, y la pestaña Alertas del escritorio muestra «N coordinadores sin avisos
   activados» con nombres y teléfonos.
3. **El Excel de acreditación pone «CC» y separa nombres y apellidos de forma aproximada** (la app no guarda el
   tipo de documento y `usuarios` tiene un solo campo de nombre): revisarlo antes de enviarlo. El formato no es el
   de la Registraduría —no hay rastro de él en el repositorio—; las columnas son las de la orden 18.
4. **Una misma alerta se avisa una sola vez por día** (clave tipo + puesto + mesa + fecha) y a lo sumo un push cada
   5 minutos por persona, agrupado. Una alerta atendida no se avisa. Los avisos son solo de los tipos 1 a 6
   (no «mesa sin testigo y sin votantes propios») y solo activas (no las «pendiente»).
5. **El aviso al testigo por SMS no lleva el «Baja: …» automático** y la plantilla «Testigo - aviso de
   asignacion» cabe en 1 SMS con puestos de hasta 43 caracteres (dominio departamental, firma de 30, una mesa).
6. **Aplicar después del 275, con la misma lista de campañas.** El 276 no declara su dependencia: sin el 275 y los
   anteriores le faltarían `config/paginaBaja.js` y las tablas de la fase 2.
7. **Correr `npm run init-db`** (el actualizador lo hace solo porque `toca_base_datos` es sí).

## Parche 275 — tarjeta de vista previa del enlace «Ya voté» (7 de noviembre de 2026, INACTIVO)

Zip de 5 archivos: `app.js`, `public/img/ya-vote-og.png` (nuevo, **binario**, 13.501 bytes),
`public/service-worker.js` (`v151`), `routes/yaVoto.routes.js` y `.version-base` (275).
Commits que recoge: `3782e85` (la tarjeta Open Graph y su imagen) y `1bbdaac` (la página «no activo» de
`/v` responde 200 en vez de 404). `scripts/generar-imagen-ya-voto.js` (con el que se hizo la imagen) y las
pruebas **no viajan**.

- **Verificado sobre el zip:** los 5 archivos coinciden por md5 con el disco (el PNG, además, byte a byte y
  marcado como binario en el listado del zip); no trae `.env`, `.credenciales-*`, `uploads/`, `legislacion/`,
  `backups/` ni `scripts/`; `CACHE_NAME = 'estrategia-v151'`; `verificar-requires.js` revisó 41 `require`
  locales y todos resuelven **aplicando el zip sobre una copia del árbol del 274** (`7206133`).
- **NO toca la base de datos** (`toca_base_datos = false`): no hay cambios en `db/`, y no hace falta `init-db`.
- **Qué hace:** `GET /v/<token>` lleva en el `<head>` `og:title` «Avísanos cuando votes ✓», `og:description`,
  `og:site_name` (el `marca_titulo` de la campaña), `og:type`, `og:image` absoluta (1200×630, con alt) y
  `twitter:card summary_large_image`; WhatsApp y Google Mensajes arman con eso una tarjeta grande con el ✓,
  que se toca como un botón. **Nada del votante** entra en los metadatos, y son idénticos para un token
  válido, inexistente, mal formado, vencido, ya votado y fuera del día. La página `?baja=1` no lleva tarjeta
  grande, solo título. La imagen se sirve en `/img/ya-vote-og.png` sin sesión, antes del candado de licencia,
  con caché de un día. «No activo» responde ahora **200** (antes 404) con la misma página, porque un cliente
  puede descartar —y cachear así— la tarjeta de una respuesta 404; el **límite de intentos por IP sigue
  contando esas respuestas** (`requestWasSuccessful` + `res.locals.noActivo`), así que adivinar tokens se corta
  igual con 429. La página ya llevaba `<meta robots noindex, nofollow>` y `X-Robots-Tag: noindex, nofollow`.
- **Probado solo con bases simuladas y el servidor de la app.** No se vio la tarjeta en WhatsApp ni en Google
  Mensajes reales, ni la imagen servida por el Nginx de una campaña.

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **Aplicar después del 274, con la misma lista de campañas.** El 275 no declara su dependencia: si una
   campaña lo recibiera sin el 274 le faltaría `config/paginaBaja.js` y `/v?baja=1` fallaría.
2. **La tarjeta solo sale bien si la campaña tiene `marca_titulo` y el dominio de la licencia
   (`LICENCIA_DOMINIO`) correctos.** Sin `marca_titulo`, la tarjeta sale sin nombre de campaña; sin dominio en
   el `.env`, sale **sin imagen** (la URL de `og:image` se arma con ese dominio, nunca con la cabecera Host).
3. **En iPhone, la tarjeta del SMS solo sale si el remitente está en los contactos.** Es del sistema, no de la
   aplicación. WhatsApp y Google Mensajes (Android) no tienen esa condición.
4. **La vista previa se cachea en el cliente.** Si un robot pide el enlace antes del día de la elección, recibe
   la página «no activo» (200, con la misma tarjeta): la tarjeta sale igual, pero conviene mandar los enlaces
   el día de la elección. El correo **no** acepta `{enlace_ya_vote}` (el envío lo rechaza con 400).

## Parche 274 — SMS de 1 segmento, Día D fase 3, baja a mano y enlace desde Faltantes (7 de noviembre de 2026, INACTIVO)

Zip de 30 archivos: `app.js`, `config/bajaContacto.js`, `config/paginaBaja.js` (nuevo), `config/sms.js`,
`config/yaVotoEnlace.js`, `db/init-db.js`, `db/schema.sql`, `lib/puestosDiaD.js` (nuevo),
`lib/transliterarSms.js` (nuevo), `middleware/aspirante.js`, `public/app/dia-d.html`,
`public/app/faltantes.html`, `public/dia-d.html`, `public/enviar-sms.html`, `public/js/baja-manual.js`
(nuevo), `public/js/common.js`, `public/js/segmentos-sms.js`, `public/no-contactar.html`,
`public/service-worker.js` (`v150`), `public/territorial.html`, `public/votantes.html`,
`routes/baja.routes.js`, `routes/comunicaciones.routes.js`, `routes/diaD.routes.js`,
`routes/permisos.routes.js`, `routes/rescateVotos.routes.js`, `routes/resultadosDiaD.routes.js` (nuevo),
`routes/territorial.routes.js`, `routes/yaVoto.routes.js` y `.version-base` (274).
Commits que recoge, en orden: `2505f75` (SMS «Ya voté» en 1 segmento), `6fb6ebb` (Día D fase 3),
`8523964` (baja a mano y confirmación), `e6a0e9c` (quita el envío automático de la baja) y `5a514fc`
(enlace «Ya voté» desde Faltantes). `aa7804a` (ESTADO del 273) es el punto de partida y no viaja.

- **Verificado sobre el zip:** los 30 archivos coinciden por md5 con el disco; no trae `.env`,
  `.credenciales-*`, `uploads/`, `legislacion/` ni `backups/`; `CACHE_NAME = 'estrategia-v150'`;
  `verificar-requires.js` revisó 119 `require` locales y todos resuelven, **también aplicando el zip
  sobre una copia del árbol del 273** (`aa7804a`), que es el estado de una campaña con el 273 puesto.
- **Toca la base de datos (sí; lo marcó el servidor):** columna `dia_d_reporte_votos.grupo`; tablas
  `dia_d_resultado_oficial`, `dia_d_mesa_revision` y `dia_d_paquetes`; columnas `no_contactar_canal` y
  `no_contactar_motivo` en `votantes` y `usuarios`; módulo de permisos `resultados_dia_d` (admin y
  coordinador de fábrica); la plantilla de SMS «Dia D - aviso ya voto» pasa a la corta (o nace
  «… (corto)» si el administrador la había editado) y la de correo «Bienvenida al equipo» deja de decir
  «respóndanos y lo retiramos» (solo si seguía idéntica a la sembrada). Todo idempotente, con «ya existía».
- **Probado solo con bases simuladas.** No se corrió `init-db` en MySQL, ni un SMS por Onurix, ni nada en
  un celular real: según la orden 14, Gildardo probó en la Base las órdenes 9, 11, 12/12b y 13 antes de pedir este parche.

**Cómo exige el 273 (y por qué no lo exige de verdad).** El sistema NO tiene una dependencia
declarada entre parches. `GET /parches/disponibles` (licencias) devuelve **todos los activos con número
mayor** que el de la campaña y que le correspondan por distribución, **en orden ascendente**; el
actualizador los aplica uno tras otro y se detiene si uno falla. O sea: con el 273 y el 274 activos y
en la lista de la campaña, el 273 va siempre primero. Pero **si el 273 queda inactivo, o la campaña no
está en su lista, el 274 le llegaría solo**, sin `config/yaVotoEnlace.js` ni las tablas de la fase 2, y
las pantallas nuevas fallarían. Por eso: **activar el 272, el 273 y el 274 juntos y con la misma
lista de campañas**. El nombre del 274 en el panel dice «Requiere el 273».

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **El SMS «Ya voté» ya cabe en 1 mensaje.** El texto no lleva la baja: va en la página del enlace
   («No quiero recibir más mensajes», `/v/<token>?baja=1`). La plantilla corta
   («{primer_nombre}, hoy votamos. Cuando votes, avisanos aqui: {enlace_ya_vote}») mide menos de 160
   con la firma del operador. Esta nota **reemplaza** a la del 273 que decía que ocupaba 2.
2. **Todo SMS sale sin tildes ni ñ** (á→a, ñ→n, ¿ y ¡ se quitan), el de la campaña y el de Onurix.
   WhatsApp y correo no se tocan. El contador de «Enviar SMS» lo dice.
3. **El enlace «Ya voté» solo sale a votantes con consentimiento = 1 en ese canal.** Con el consentimiento
   sin registrar (NULL) o en 0 no sale: ni por envío masivo ni desde Faltantes en el celular del líder.
   Tampoco sale si `no_contactar = 1`, si no hay fecha de elección o si la persona no tiene teléfono.
4. **La pestaña «Resultados» (Día D) la ven admin y coordinador** (módulo `resultados_dia_d`, activo
   de fábrica solo para ellos; el aspirante la ve por su lista propia). No existe rol de abogado: para
   uno, crear un usuario de rol *administrativo* y darle el módulo `resultados_dia_d` en Permisos.
5. **Los paquetes del abogado se borran a las 24 horas** (al arrancar y cada hora). Si el servidor se
   reinicia mientras arma uno, queda en «error» y hay que pedirlo de nuevo.
6. **La baja se da SOLO al tocar el botón.** `/b` y `/v?baja=1` dicen «Aún no estás dado de baja» y
   tienen un botón grande; no se envía nada al cargar la página (Google abre los enlaces con un Chrome
   real). Quien abre el enlace y se va no queda de baja: para eso está **«Marcar como no contactar»**
   en la ficha del votante y en «Editar persona» (admin y coordinador, con canal y motivo obligatorios;
   queda en «Pidieron no recibir más» y en la auditoría).
7. **En Faltantes, el líder manda el enlace desde su celular:** WhatsApp con enlace, botón «SMS» (sale
   del plan del celular del líder, sin firma ni baja) y «Copiar enlace». Funciona sin señal porque el
   enlace viaja en la lista. No se probó en un iPhone ni en un Android real: el separador de `sms:`
   es `&` en iPhone y `?` en Android.
8. **Correr `npm run init-db`** (el actualizador lo hace solo porque `toca_base_datos` es sí).

## Parche 273 — Día D fase 2: «ya votó» (6 de noviembre de 2026, INACTIVO)

Zip de 22 archivos: `app.js`, `config/yaVotoEnlace.js`, `db/init-db.js`, `db/schema.sql`,
`lib/alcanceVotantes.js`, `middleware/aspirante.js`, `public/app/faltantes.html`,
`public/app/inicio.html`, `public/app/ranking-dia-d.html`, `public/configuracion.html`,
`public/dia-d.html`, `public/enviar-sms.html`, `public/js/common.js`, `public/js/offline-utils.js`,
`public/js/whatsapp-lote.js`, `public/service-worker.js` (`v147`), `public/votantes.html`,
`routes/comunicaciones.routes.js`, `routes/permisos.routes.js`, `routes/rescateVotos.routes.js`,
`routes/yaVoto.routes.js` y `.version-base` (273).
Commits que recoge: `207b195` (la fase 2), `374f434` (la fecha de elección dentro del token y el
ranking en el menú del aspirante) y `67a8a23` (init-db dice «ya existía» para las tablas nuevas).

- **Verificado sobre el zip:** los 22 archivos coinciden por md5 con el disco; no trae `.env`,
  `.credenciales-*`, `uploads/`, `legislacion/` ni `backups/`; `CACHE_NAME = 'estrategia-v147'`;
  `verificar-requires.js` revisó 70 `require` locales y todos resuelven.
- **Qué trae:** tablas `votante_votos` y `votante_voto_tokens`; índices en `votantes` (`sublider_id`,
  `puesto_id`, solo si no había ya uno); módulo de permisos `rescate_votos` (admin, coordinador, líder
  y sublíder de fábrica; el aspirante por `PERMISOS_ASPIRANTE`); dos plantillas de arranque; API
  `/api/dia-d/rescate` (faltantes por puesto, marcar idempotente, desmarcar con auditoría, resumen por
  hora y puesto, ranking de líderes, enlace de WhatsApp, vaciar marcas con la contraseña propia);
  enlace público `/v/<token>`; en el CRM `{enlace_ya_vote}`, `{primer_nombre}` y el filtro «Mis votantes
  que aún no han votado», con regla estricta de consentimiento solo para esos mensajes; pantallas
  `app/faltantes.html` (lista por puesto, cola y copia sin señal), `app/ranking-dia-d.html` y la pestaña
  «Avance de votación» de `dia-d.html`; IndexedDB sube a la versión 3. **Arregla el alcance del
  sublíder**, que veía su lista vacía (`lib/alcanceVotantes.js`).
- **Probado solo con bases simuladas y SQL sobre sqlite.** No se corrió `init-db` en MySQL, ni nada en
  un celular real, ni un SMS real. Esas pruebas las hace Gildardo en la Base antes de activar.

**NOTAS PARA QUIEN LO APLIQUE (cada campaña):**

1. **La campaña necesita `fecha_eleccion` en Configuración → Datos de la campaña.** Sin ella no se
   genera ningún enlace «Ya voté» (el envío se rechaza con ese mensaje) y las pantallas siguen
   funcionando en «modo prueba». El enlace solo sirve el día de esa fecha.
2. **Cambiar la fecha invalida los enlaces ya enviados.** La fecha va dentro del token (HMAC de
   votante + fecha): hay que volver a mandarlos. Configuración lo avisa junto a la fecha y pide
   confirmación al guardar. Vale también para una segunda vuelta.
3. **Correr `npm run init-db`** (el actualizador lo hace solo porque `toca_base_datos` es sí). La
   aplicación no se rompe sin las tablas nuevas, pero las pantallas de rescate sí darían error.
4. **Los votantes sin consentimiento de SMS registrado (NULL) NO reciben el enlace**: la regla estricta
   es solo para esos mensajes y no cambia la del resto del módulo.
5. El token se deriva de `SESSION_SECRET`: rotarlo invalida también estos enlaces (y los de baja).

## Parche 272 — Día D fase 1 (6 de noviembre de 2026, INACTIVO)

Zip de 11 archivos: `app.js`, `config/verificarEsquema.js`, `db/init-db.js`, `db/schema.sql`,
`middleware/upload.js`, `public/app/dia-d.html`, `public/dia-d.html`, `public/service-worker.js`
(`v146`), `routes/diaD.routes.js`, `scripts/limpiar-fotos-dia-d.js` y `.version-base` (272).
Commits que recoge: `868e22f`, `e102ab9` (Día D) y `39b18eb` (clave del admin inicial en
`.credenciales-admin.txt`, que viaja porque está dentro de `db/init-db.js`). Los demás commits
posteriores al 271 (`3ab4ddf`, `2f1ce57`, `90b5948`, `9cb3e25`, `8dfca61`, `0c2311a`) son de
documentación y herramientas de la plantilla: no viajan.

- **Verificado sobre el zip:** los 11 archivos coinciden por md5 con el disco; no trae `.env`,
  `.credenciales-*`, `uploads/`, `legislacion/` ni `backups/`; `CACHE_NAME = 'estrategia-v146'`;
  contiene `dia_d_reportes.alertas` en `verificarEsquema.js`, `idx_diad_foto_url`,
  `cerrarFotosDelDiaD` y `GET_LOCK`.
- **`scripts/limpiar-fotos-dia-d.js` SÍ viaja en el 272** (decisión de Gildardo). La plantilla,
  en cambio, no lo lleva todavía.
- **Qué hace:** el testigo solo reporta su mesa (403 si no es suya; 400 si la mesa no está entre 1 y
  la cantidad de mesas del puesto); el testigo asignado siempre puede reemplazar su mesa; un envío
  a la vez por mesa (`GET_LOCK`); alertas que pone el servidor (`suma_distinta`, `fuera_de_lista`,
  `enviado_por_staff`, `puesto_sin_mesas`) sin rechazar, con filtro «Solo con alertas» en el
  tablero; fotos nuevas en `uploads/dia-d/`, servidas solo por
  `/api/dia-d/reportes/:id/foto` y `/documentos/:docId` (testigo dueño, o admin/coordinador/aspirante
  dentro de `acotaJornada`; acepta `X-Device-Token`); `/uploads/dia-d` cerrado y, en la raíz de
  `uploads/`, solo se niegan los archivos que figuren en un reporte del Día D (si la consulta falla,
  503); borrar un reporte borra sus archivos y sus filas de documentos; en el celular: «Subir foto»
  si la cámara falla, Reintentar/Descartar en reportes fallidos, foto de máximo 2400 px a JPEG 0,85.
- **Gildardo lo probó en la Base (navegador y celular) y le funcionó.** Las campañas no.
- **TOCA LA BASE y es obligatorio:** `init-db` agrega `dia_d_reportes.alertas` y dos índices.
  `verificarEsquema.js` exige la columna: **una campaña que reciba el 272 sin correr `npm run init-db`
  no arranca.** El actualizador corre `init-db` solo si el registro dice `toca_base_datos` — y dice que sí.
- **Fotos viejas:** las anteriores al 272 siguen en la raíz de `uploads/`; el filtro las cierra por
  la base, pero el script de limpieza no las toca (un archivo de la raíz sin referencia en el Día D
  puede ser un comprobante de finanzas).

## Parches 266 a 271 (6 de noviembre de 2026) y lo que vino después

| Parche | Hora del zip | Qué trae (según `git log` entre cada «Parche N: .version-base») |
|---|---|---|
| 266 | 13:19 | Sección Legislación: módulo con permiso, lista desde `legislacion/`, vista PWA con Ver/Descargar por token de dispositivo. SW `v134`. |
| 267 | 14:55 | Copia automática de `legislacion/` desde la carpeta central; calendario electoral, buscador dentro de los PDF y tarjetas con epígrafe; periodos en «En curso», pestañas cortas en celular y página del artículo. SW `v135`. |
| 268 | 16:10 | Panel general atado al permiso `panel_general` y sin finanzas para quien no las administra. |
| 269 | 17:11 | App del celular para administradores (Panel, Votantes, Mapa, Compartir), menú en el orden pedido (SW `v137`), Estructura territorial en modo app, Calendario del celular apilado en Cumplidas / En curso / Próximas. |
| 270 | 18:27 | App del admin: lista de Estructura y formulario por pasos; formularios por pasos (lugar de votación antes de la cédula, micrófono, aviso del nombre); registro de votante o sublíder en 4 pasos; copiado automático de la cédula (también en Votantes y Testigos de escritorio). |
| 271 | 19:24 | Código de ingreso del superadmin por Telegram, 2FA obligatorio y sin interruptor; SW `v145`. Archivos: `config/{mailer,superadmin,superadminCorreo,telegram}.js`, `db/init-db.js`, `routes/{auth,usuarios}.routes.js`, `public/{configuracion.html,js/common.js,service-worker.js}`, `scripts/limpiar-copias-env.sh`, `.version-base`. **Toca `db/`**: el actualizador corre `init-db`. `.env.example` NO entra (el generador rechaza todo `.env.*`). |

*Dónde está aplicado:* en la **Base**, todos (271; el 272 está en su código y solo en el zip, ver arriba). En las **campañas**, no medido (ver arriba).

### Superadmin: siempre con código, y por Telegram (parche 271)

- El código de ingreso del superadmin (`correo@gildardoarias.com`, o `SUPERADMIN_EMAIL`) sale
  por el canal de siempre **y** por Telegram, en paralelo (`Promise.allSettled`). Texto:
  «Código de ingreso a `<APP_NOMBRE>`: 123456. Vence en 10 minutos.». En el 2FA tras clave solo
  responde 500 si no salió ninguno. Para los demás usuarios nada cambia ni se nota.
- Variables: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_SUPERADMIN_CHAT_ID` (`config/telegram.js`; sin una
  de las dos no hace nada y devuelve `false`), `APP_NOMBRE` (el nombre del mensaje) y
  `SUPERADMIN_TELEFONO` (por omisión 3104157434). El log nunca lleva token, chat ni URL.
- Se ponen con **`scripts/poner-telegram-env.sh <ruta del .env>`** (como root; pide sin mostrar;
  no duplica líneas). Después, `bash scripts/reiniciar-instancia.sh <usuario>`: `pm2 restart`
  no relee el `.env`. El bot necesita un `/start` previo de Gildardo.
- `init-db` crea al superadmin con `two_factor_enabled = 1` y el celular, y `asegurarSuperadmin`
  (cada corrida) los garantiza en cuentas existentes sin pisar un teléfono puesto.
  `PUT /auth/2fa` y `POST /usuarios/:id/desactivar-2fa` responden 400 «El código de ingreso es
  obligatorio para esta cuenta.»; el interruptor del perfil sale encendido y deshabilitado.
- **Riesgo conocido:** con el 2FA forzado, si el correo de una campaña no funciona y todavía no
  tiene Telegram, el superadmin no entra. Probar el correo antes y poner las variables enseguida.

### Después del 271 (en la Base, SIN parche)

- `2f1ce57`: la plantilla ya no lleva `verificar-parche*.sh`, `comparar-parche*.sh` ni
  `respaldar-base-instalacion.sh` (por patrón); `probar-instalacion-limpia.js` comprueba que el
  superadmin nazca con 2FA y celular y que la 2.ª corrida diga «superadmin asegurado (1)».
  **La prueba limpia NO se ha corrido** (necesita una base vacía creada en CloudPanel).
- `39b18eb`: **la contraseña generada del administrador inicial ya no se imprime.** `init-db`
  la deja en `.credenciales-admin.txt` (0600, formato del del superadmin); si el archivo ya
  existe, `init-db` se detiene sin crear la cuenta. Con `ADMIN_PASSWORD` en el `.env` no se
  escribe archivo. `.gitignore`, `generar-parche.js` y `generar-plantilla.js` bloquean
  `.credenciales-*.txt` por patrón; la prueba limpia verifica el archivo (0600, correo, clave
  ausente de la salida) y se niega a correr si hay uno viejo. **No está en el 271**: solo afecta
  a instalaciones nuevas (el bloque corre cuando no hay admin). **Entra en el 272**, dentro de `db/init-db.js`.
- Commits de la tanda: `38826b6`, `0e06d7d`, `6b803f0`, `7610063`, `3ab4ddf`, `2f1ce57`, `39b18eb`,
  `9cb3e25`, `90b5948` (LEEME: con `ADMIN_PASSWORD` no se escribe archivo) y `0c2311a`.
- **Prueba limpia corrida y pasada** (base desechable `pruebalimpia`, 44 tablas, todas las
  comprobaciones en OK, salida 0): el superadmin nace con 2FA y celular 3104157434; la clave del
  admin queda en `.credenciales-admin.txt` (0600, `admin@campana.local`) y no sale por consola; la
  2.ª corrida imprime «superadmin asegurado (1)». La plantilla v271 se **regeneró** después de
  `39b18eb`: sha256 `c3e4a6715d3365da6990243ed77c0846acdd50e987ca6fdc921c3f9a1c6a8e80`, 194
  archivos, secretos 0, su `init-db` ya no imprime la clave (la de `c11c9904…` de arriba quedó
  obsoleta).

### Remoto en GitHub (6 de noviembre de 2026)

- **Remoto `origin`:** `git@github.com:garias333/campana-electoral-app.git` — repositorio
  **privado**. Se subió de cero (estaba vacío).
- **Acceso:** deploy key **con escritura**, par ed25519 `~/.ssh/campana_github` de la cuenta
  `gariasappelectoral` (huella `SHA256:e1n5q6CP0OrDoJUkqu/JfZbHvfIwHQ3ZO9HRAHmyLPM`), solo para este
  repo. `core.sshCommand` del repo: `ssh -i ~/.ssh/campana_github -o IdentitiesOnly=yes`. La
  huella de `github.com` se verificó contra la publicada antes de guardarla en `known_hosts`.
- **Quién empuja:** **Gildardo, como root, con `su - gariasappelectoral`**. Claude Code deniega los
  `git push` (permiso «Data Exfiltration»); solo deja pasar `--dry-run`. Comando:
  `su - gariasappelectoral -c 'cd /home/appestrategia-electoral/htdocs/electoral.appestrategia.net && git push origin auditoria-fable'`
  (las claves son de esa cuenta: desde otra, `core.sshCommand` no encuentra la llave).
- **Verificado el 6 de nov. con `git ls-remote` y `git branch -vv`:** `origin/auditoria-fable` =
  `0c2311a` (0 adelante / 0 atrás), `origin/main` = `27c22d2` (0 / 0; `main` local **no** tiene
  seguimiento configurado), y los 3 tags `punto-restauracion-2026-08-24`, `-2026-08-31` y
  `-antes-dictado` coinciden con los locales.
- **Los hashes que cita este documento coinciden con GitHub:** los 15 hashes de 7 caracteres que
  aparecen en él son commits de este repo y todos son alcanzables desde `origin/auditoria-fable`.
  (Se comprobó antes de añadir el commit de esta nota, que queda 1 adelante hasta el próximo push.)
- **Autor:** el historial NO se reescribió. Quedan 298 commits con `tu@correo.com` (todos los de
  antes de hoy salvo 3) y los demás con `correo@gildardoarias.com`; el repo ya tiene
  `user.email = correo@gildardoarias.com` (`.git/config`), así que los nuevos salen bien.
- **Seguridad previa al push:** revisión de secretos sobre los 309 commits de todas las ramas y
  tags: 0 hallazgos reales (dos marcadores: `.env.example` y `public/ayuda.html`; la única `.pem`
  es una llave pública; los `.sql` son esquema). El código lleva el correo y el celular del
  superadmin como valores por omisión: **mantener el repositorio privado**.

## Sección Legislación (6 de noviembre de 2026) — parche 266 registrado, INACTIVO

### Lo que se agregó después del 266 (SIN parche; el 267 lo arma Gildardo)

Pantalla de tres pestañas, con `?tab=calendario|buscar|normas` (por omisión,
Calendario). Escritorio y celular comparten `public/js/legislacion-comun.js` y
`public/css/legislacion.css`; cada página solo aporta su marco y cómo abrir un PDF.
Service worker a `estrategia-v135` (las páginas siguen sin precachearse).

- **Datos en la carpeta central** (`legislacion/` de la Base, la que copia el cron):
  `indice.json` con los epígrafes literales de los 10 PDF y `calendario.json` con
  las 35 actividades de la Resolución 12338 de 2026. **Gildardo renombró
  `resolucion-09458-de-2026-CNE.pdf` a `…-de-2025-CNE.pdf`** (el documento es del
  11 de septiembre de 2025); las claves de `indice.json` siguen los nombres
  actuales, así que **si se vuelve a renombrar un PDF hay que cambiar su clave**.
  `scripts/sincronizar-legislacion.sh` ahora copia también `calendario.json`.
- **`calendario.json`**: objeto `{meta, filas, periodos}` (el lector acepta también
  el formato viejo, un arreglo de filas). Cada fila: `{inicio, fin|null, actividad,
  referencia, grupo}` con fechas AAAA-MM-DD, más `plazo` y `soporte_legal` (el texto
  literal del cuadro; las horas van en `plazo`). **`periodos`** son las parejas que la
  resolución une de forma expresa, `{nombre, fila_inicio, fila_fin}`, con las filas
  contadas desde 1 en el orden del archivo (una fila inválida no corre la numeración).
  Hoy hay seis: 1→4 registro de comités inscriptores, 2→20 inscripción por cambio de
  domicilio, 6→10 inscripción de candidatos, 12→16 modificación por renuncia o no
  aceptación, 21→30 espacios gratuitos en medios, 22→28 postulación de testigos.
  **Se dejó fuera 1→11 (recolección de apoyos)**: la fila 1 dice «periodo de recolección
  de apoyos ciudadanos» y la 11 «recolección y entrega de firmas»; no es la misma frase.
  Tampoco se cierra la propaganda en espacio público (fila 7): el cuadro no le da cierre.
  **No se escribe `fin` a mano ni se inventan fechas.**
  **En la pantalla, «En curso» son los PERIODOS** cuyo inicio ya pasó y cuyo fin no, con
  «desde … hasta …», «Termina en N días» y una barra de avance. Las 35 filas van a
  Cumplidas o Próximas; una fila del día de hoy queda en Próximas con la etiqueta «Hoy».
  **Cuatro fechas son dudosas** (filas 14, 15, 23 y 27): el texto dice «60», «30» y
  «8 días» y la fecha impresa solo cuadra con días HÁBILES (ver orden 5); se dejó la
  fecha impresa. El estado lo calcula el navegador con la fecha de Colombia;
  `?hoy=AAAA-MM-DD` simula otro día. A 390 px las pestañas usan rótulos cortos
  («Calendario», «Buscar», «Normas») y en el celular el artículo dice «Está en la
  página N» (Safari ignora `#page`).
- **`GET /api/legislacion/calendario`** (responde `{meta, filas, periodos}`) y **`GET /api/legislacion/buscar?q=`**,
  con el mismo permiso `legislacion`. El buscador está en `lib/legislacionTexto.js`.
- **Extractor de texto: `pdftotext -raw` si está en /usr/bin; si no, Ghostscript.**
  `/usr/bin/pdftotext` y `pdfinfo` **ya existen en el VPS** (poppler 24.02; no
  estaban cuando se midió en la orden 5). El modo es `-raw` a propósito: con el
  modo por defecto dos encabezados de la Resolución 09458 («DÉCIMO SÉPTIMO»,
  «VIGÉSIMO SEGUNDO») salen partidos y se pierden dos artículos. Sin poppler, la
  ruta de Ghostscript da los mismos artículos (probado), pero tarda unas 2,5 veces más.
- **Qué indexa y cómo**: 9 de los 10 PDF por artículo (1.801: 249; Decreto 2241:
  218; 1475: 55; 130: 54; 996: 42; 09458: 29; 163: 18; 6: 14; 0920: 10) más
  «Texto general» por página. Un encabezado cuenta solo si su número sigue al
  anterior. Coincidencia por **inicio de palabra**, sin tildes ni mayúsculas, la ñ
  distinta de la n («elección» no encuentra «selección»; «ano» no encuentra «año»).
  Reconoce «artículo 24», «art. 24 ley 130», «1475 artículo 35»; máximo 50.
- **La Resolución 12338 NO se busca**: es un escaneo (una imagen por página) con una
  capa de texto parcial. Se omite con un aviso en el log y una nota en pantalla; su
  contenido útil es el calendario. Si algún día se le hace OCR, se indexa sola.
- **Caché** en `datos/cache-legislacion/` (fuera de `legislacion/`, porque el cron
  borra lo que sobra ahí; fuera de git y de parches/plantilla). Clave = nombre +
  tamaño + fecha + versión del extractor. Primera búsqueda ≈ 2 s (todo el
  corpus); después, milisegundos. Hay que dejar que la app pueda crear `datos/` en
  cada instalación (la carpeta de la instalación es del usuario de la campaña: sí).

Commits locales en `auditoria-fable` (entonces sin push; hoy publicada, ver «Remoto»). El parche 266 se generó y
registró **inactivo** (ver abajo). Las anclas de arriba son de agosto; lo que
sigue está medido hoy sobre este árbol.

- **Qué es.** Una pantalla «Legislación» (escritorio `/legislacion.html` y
  celular `/app/legislacion.html`) que lista los PDF de la carpeta
  `legislacion/` de la raíz de cada instalación. **La app solo lee**: no sube ni
  borra; los PDF los sube Gildardo por el administrador de archivos de
  CloudPanel. No hay tabla nueva.
- **Permiso.** Módulo `legislacion` en `MODULOS` (`routes/permisos.routes.js`) y
  en `PERMISOS_POR_DEFECTO` (`db/init-db.js`): Ver = 1 para admin y coordinador,
  0 para el resto; Editar/Agregar/Importar en 0 para todos. El servidor lo exige
  con `requiereVerModulo('legislacion')` (nuevo, en `middleware/permisoModulo.js`):
  admin y superadmin siempre pasan, los demás por su fila de `permisos_rol`,
  falla cerrado, y el aspirante con sublicencia queda fuera.
- **Rutas** (`routes/legislacion.routes.js`, montada junto a `/api/recursos`):
  `GET /api/legislacion` y `GET /api/legislacion/archivo/:nombre`
  (`?descargar=1` baja; por omisión se ve en línea). El archivo que se abre
  sale del listado leído del directorio, nunca de lo que escribe la persona.
- **`legislacion/indice.json` es opcional**: `{ "archivo.pdf": { titulo, tipo,
  numero, anio, descripcion, orden } }`. Sin él, o para un PDF que no figure,
  el título sale del nombre («Ley 1475 de 2011», «Resolución 0920 de 2011
  (CNE)»). Un JSON roto se ignora y deja un aviso en el log de PM2.
- **`legislacion/` no viaja en parches ni plantilla**: `scripts/generar-parche.js`
  la tiene en `PROHIBIDOS` (y en el `find` de `--desde-fecha`) y
  `scripts/generar-plantilla.js` en `EXCLUIR`. **Antes no estaba en ninguna de
  las dos**: la plantilla la habría llevado (`git ls-files -o` incluye lo que no
  tiene seguimiento) y `--desde-fecha` también. Los PDF siguen SIN seguimiento
  de git a propósito: no hacer `git add -A`.
- **Service worker** a `estrategia-v134` en el parche 266 (ahora `v135`). La página nueva NO
  se precachea (necesita conexión).
- **En el celular, la entrada del menú depende del permiso.** `inicio.html`
  ahora consulta `/permisos/mios` antes de pintar el menú (espera máx. 2,5 s;
  sin respuesta, las entradas con `modulo` no se pintan). Es la primera entrada
  de ese menú que depende de la matriz; las demás siguen fijas por rol.
- **Para que funcione en una campaña** hace falta: el parche, que corra
  `init-db` (toca `db/`; si no, el coordinador recibe 403 por falta de la fila),
  y que `legislacion/` tenga los PDF — ya no se suben a mano en cada campaña:
  los copia el cron central (siguiente punto).
- **Parche 266** (6 nov): generado, publicado en el servidor de licencias y
  registrado y firmado como **INACTIVO**; toca `db/`. sha256
  `93751f89002f19a7e241c776aad93498c8273067ef75d9f8f0f762a8f2fd1ff9`. Lleva 12
  archivos; no lleva `ESTADO.md` ni `generar-plantilla.js`. Activarlo y aplicarlo
  lo decide Gildardo desde el panel. En la PWA, «Ver» y «Descargar» piden el PDF
  con `fetch` y `X-Device-Token` (commit aparte): un enlace solo lleva la cookie,
  que dura 8 h, y el token 7 días.
- **Una sola carpeta central, copiada por cron** (decisión de Gildardo). La
  fuente es `/home/appestrategia-electoral/htdocs/electoral.appestrategia.net/legislacion`.
  `scripts/sincronizar-legislacion.sh` (corre como **root**, nada se ejecutó aún
  en el VPS) la copia a `legislacion/` de cada campaña con rsync: solo
  `*.pdf`/`*.PDF` e `indice.json`, sin subcarpetas ni enlaces, `--delete`,
  `--delay-updates`, dueño = dueño de la instalación, 750/640, `flock`, registro
  en `/var/log/sincronizar-legislacion.log`. Opciones `--simular` y `--una RUTA`.
  Descubre las campañas por `package.json` con `"name": "campana-electoral-app"`
  y **resuelve enlaces**: el `~/htdocs` de las cuentas SSH es un enlace al de la
  cuenta del sitio y, sin eso, cada campaña saldría dos veces (y electoral
  también). **Si el origen no existe o no tiene ni un PDF, no toca nada**: con
  `--delete` vaciaría todas las campañas; para vaciarlas a propósito hay que
  hacerlo a mano. `scripts/legislacion-excluir.txt` (opcional, no existe) salta
  rutas. Una campaña cuyo `legislacion` sea un enlace simbólico se OMITE.
  El guion está en git y en la plantilla, y **fuera de los parches**
  (`PROHIBIDOS` de `generar-parche.js`): como esa lista cambió después del 266,
  la copia de `generar-parche.js` en las campañas queda atrasada hasta el
  próximo parche que la lleve (lo notará `comparar-instancias.js`, no es fallo).
  Probado sin root con carpetas de prueba; **no probado**: el `--chown` a un
  dueño distinto del que corre (necesita root), ni ninguna campaña real.
- **Probado en desarrollo** con un MySQL desechable (ya borrado), no con las
  bases de campaña: ver el informe de la sesión. Lo no probado: la copia real de
  la base municipal (el usuario de esta cuenta no la puede leer ni crear bases),
  `nginx` de CloudPanel, y abrir un PDF en un iPhone real.

## Hecho y verificado en la última sesión

Del parche **239 al 249**. Todo lo de abajo quedó implementado, probado contra
la base real y aplicado en las tres instalaciones.

- [x] **El E-14 en tres bloques.** `dia_d_candidatos.grupo`
      (`candidato`/`nivelacion`/`otros`) y `dia_d_bloques` para el orden y la
      numeración de cada bloque. Una sola hoja en Configuración → Día D con los
      tres uno debajo de otro; flechas amarillas mueven la fila dentro de su
      bloque, azules mueven el bloque entero.
- [x] **Cada bloque decide si lleva numeración y desde qué número.** Casilla
      «Numerar» + «empieza en» en su cabecera. Sustituyó a una regla implícita
      (`numeracionDesdeCero`) que deducía el 0 de si la campaña era sublicencia;
      esa variable ya no existe.
- [x] **Nivelación y Otros votos solo en campañas de aspirante.** Se decide en
      `configuracionDeBloques()` (routes/diaD.routes.js), el único sitio que
      dice qué bloques existen. La ruta de alta también lo rechaza con 400.
- [x] **El formulario del testigo hereda ese orden y esa numeración.** Antes
      llevaba los bloques fijos en su código.
- [x] **En campañas de aspirante:** sin «Total votantes en la mesa», y «TOTAL
      VOTOS AGRUPACIÓN POLÍTICA» como última fila del bloque de candidatos,
      sumando solo ese bloque. La guarda del servidor que exigía
      `total_votantes_mesa` ahora solo aplica a la campaña madre.
- [x] **La corrección de un reporte vuelve a anular al anterior.** La clave de
      «último reporte por mesa» pasa de `COALESCE(CAST(puesto_id AS CHAR),
      puesto_votacion)` al **nombre del puesto**, en las cinco consultas que la
      repiten. Efecto medido en campanadepruebamunicipal: Diego Alejandro
      Morales 155 → **125**; mesas reportando 4 → 3.
- [x] **La barra amarilla del candidato propio** funciona en las sublicencias.
      Se resolvía contra `configuracion_campana.nombre_candidato` (el de la
      madre) y no cruzaba con nada. Ahora `nombreDelCandidatoPropio(req)`, por
      rama. Arreglaba de paso `votos_candidato`, que quedaba NULL en todos los
      reportes de testigos de un aspirante.
- [x] **Pantalla nueva `public/reportes-puesto.html`** — dónde le fue mejor y
      peor a un candidato, por puesto y por mesa, con el porcentaje sobre los
      votantes de cada mesa. Se llega por un botón del tablero del Día D.
- [x] **El orden de los candidatos lo manda el tarjetón.** Columna `orden`,
      flechas por fila, y el candidato propio **ya no se agrega solo**: hay que
      ponerlo a mano en la hoja, en su posición.
- [x] **Los `confirm()` de configuracion.html** (11) pasaron a
      `confirmarEnModal`. Eran botones mudos: Chrome suprime los diálogos tras
      varios seguidos y `confirm()` devuelve `false` sin preguntar.
- [x] **Limpieza:** 600 KB de maquetas servidas en abierto, dos PNG huérfanos,
      `scripts/calibrar_cohortes.js` (pedía un módulo inexistente y hacía que
      `verificar-requires.js` diera un falso «SIN RESOLVER» en cada revisión),
      CSS muerto y dos `require` inertes. `verificar-requires.js` dice ahora
      «TODO RESUELVE» sobre 216.
- [x] **`olvidarCargoDeLaMadre()` cableado.** Existía desde el principio con el
      comentario «para después de guardar la configuración» y **nadie lo
      llamaba**: al cambiar el cargo, los filtros de rama usaban el valor viejo
      durante 30 s.
- [x] **Permisos:** los doce `.env` del VPS en `640`.

## Pendiente inmediato

1. **Reiniciar electoral** (ver Anclas). Es lo primero.
2. **Los `confirm()` nativos de nueve pantallas más**, con el mismo botón mudo
   esperando: crm (8), votantes (7), enviar-push (6), eventos (3), dia-d (2),
   testigos (2), organigrama (1), asistentes-reuniones (1), whatsapp-lote (1).
   El arreglo es el del parche 239: `await confirmarEnModal(...)` de
   `public/js/common.js`.
3. **`sms_exclusiones` se consulta y nadie la llena.** `estaExcluido()` la lee
   en `lib/sms-cuota.js`, pero `excluir()` no la llama nadie. O el opt-out va
   por `usuarios.no_contactar` y esa tabla sobra, o falta cablearla. Sin mirar.
4. **Los dos reportes del aspirante con `votos_candidato` NULL** (ids 31 y 32 en
   campanadepruebamunicipal) siguen así: el arreglo aplica a los nuevos. Se
   pueden recalcular desde `dia_d_reporte_votos`, que está intacto. **No se hizo
   por no tocar datos ya escritos sin pedirlo.**
5. **`parches/parche-24.zip`** en el servidor de licencias, de 30 KB, parece un
   tecleo de cuando se generó el 224. No es ningún parche; se puede borrar.
6. **Exportados sin usar en `lib/ramas.js` y `lib/sms*.js`** — `filtroAspirante`,
   `enviarLote`, `excluir`, `aE164`. Los dejó la auditoría marcados como
   confirmados pero NO seguros de borrar: el primero es una de las reglas de
   rama que el propio fichero advierte no tocar, y los otros son API de
   biblioteca. Decisión pendiente, no olvido.
7. **Botones «Re-geocodificar pendientes» y «Re-geocodificar todos»**
   (`public/votantes.html:28-29`) **sin guarda de rol.** La ruta es
   `requireRole('admin', 'aspirante')` (`routes/votantes.routes.js:380`), así que
   el coordinador, el líder, el sublíder, el testigo y el invitado los ven y
   reciben 403 al pulsarlos. Lo destapó la auditoría del permiso Importar /
   Exportar (14 de octubre de 2026) y **se dejó fuera de ese commit a propósito**:
   es otra función con otra guarda. Arreglo previsto: esconderlos cuando
   `usuarioActual.rol !== 'admin'` (para el aspirante `rol` ya llega reescrito a
   `'admin'`, y la ruta sí lo admite). Misma familia, solo para el aspirante, que
   la auditoría también anotó y tampoco se tocó: «Ver» firma y «Pedir
   confirmación» (`votantes.html:2000-2014`), casilla «Datos verificados»
   (`votantes.html:1089`, `:2230`), y `finanzas.html:191`, que no lo expulsa.
8. **Dos cuentas con cargo de coordinador y rol de cuenta distinto**, en
   campanadepruebamunicipal: **131** (cuenta `sublider`, 2 líderes a cargo) y
   **124** (cuenta `lider`, cargo coordinador + testigo, 2 líderes). «Avance de
   mis líderes» y el menú del coordinador deciden por el **rol de la cuenta**,
   como el resto de la app, así que a esas dos personas la pantalla les responde
   403. Es un dato inconsistente de la campaña de prueba, no del código; **no se
   tocó**. Decisión pendiente: corregir el rol de las dos cuentas, o decidir que
   el cargo de la estructura manda. Las cuentas con rol `coordinador` que sí
   tienen líderes son 75, 77, 76, 82 y 83 (13, 8, 3, 1 y 1).
9. **Un parche registrado por CLI nace INACTIVO pero con distribución «todos»**
   — **parche aparte, del servidor de licencias** (no de esta aplicación).
   `POST /parches/registrar-y-firmar` inserta `activo = 0` pero no menciona
   `modo_distribucion` (`routes/actualizaciones.routes.js:490-495` en el servidor
   de licencias), y la columna tiene `DEFAULT 'todos'` (`db/schema.sql:117`,
   `db/init-db.js:46-49`, y el volcado real del 12 de agosto de 2026). Mientras
   está inactivo no lo recibe nadie (`:384` y `:411` exigen `activo = 1`), pero
   en cuanto alguien lo activa —el interruptor del panel, `PUT /:id/activo`, o
   «Aplicar ahora», que además fuerza `activo = 1` en `:301`— llega a TODAS las
   instalaciones con actualización automática. Detectado el 14 de octubre de
   2026 al registrar el 263; esa vez se resolvió a mano (poner «seleccionadas»
   con solo la campaña de prueba, ANTES de activar). Arreglo propuesto (opción B):
   que el `INSERT` de `:490-493` incluya `modo_distribucion = 'seleccionadas'`,
   de modo que un parche recién registrado no le llegue a nadie ni aunque lo
   activen por error y haya que elegir a quién se le abre. El comentario de
   `:461-464` dice que unificar ese comportamiento es una decisión aparte.
10. **El botón «Aplicar ahora» falló en la municipal con `spawnSync unzip ENOENT`**
    (`logs/actualizaciones.log`, 13 de octubre de 2026, parche 262: «Firma
    verificada… Aplicando parche #262… Error aplicando el parche #262: … spawnSync
    unzip ENOENT»). El actualizador lanzado desde la app hereda el PATH del
    proceso de la app (`routes/actualizador.routes.js:206-208`;
    `scripts/actualizar-automatico.js:68` solo le antepone la carpeta de
    binarios de node), y ahí no se encuentra `unzip` (`/usr/bin/unzip`). Los
    parches 255 a 259 se aplicaron por ese mismo botón cuando aún funcionaba; el
    cron de las 03:00 nunca ha aplicado uno ahí (solo escribe «Ya estás al día»),
    así que el 263 será su primera prueba real. **Se repitió el 14 de octubre de
    2026 a las 17:55:25 UTC con el 263**, también desde el panel: descarga bien,
    «Firma verificada correctamente (Ed25519, 550889 bytes)», y el mismo
    `spawnSync unzip ENOENT`. Falla en la validación del zip (`unzip -Z1`), ANTES
    de escribir: no quedó nada a medias (ningún archivo nuevo, sin la columna,
    `.version-parche` en 262). **La causa sigue sin demostrarse.** Descartado: no es
    `reiniciar-instancia.sh`, que arranca con `su -` (PATH de login, con
    `/usr/bin`). No se pudo mirar el entorno real de la app ni el `dump.pm2` (EACCES
    desde la cuenta de desarrollo). Pendiente: leerlo como root
    (`/proc/<pid de app.js>/environ`, solo la variable PATH) o hacer que
    `scripts/actualizar-automatico.js:68` añada `/usr/bin:/bin` al PATH, lo que
    arreglaría el botón sin saber la causa.
    **Actualización (14 de octubre de 2026, 23:35 UTC): el botón SÍ funciona en la
    departamental** — aplicó el 262 (13-oct) y el 263 (14-oct) con `init-db` y
    reinicio de PM2, 0 errores `unzip ENOENT` en todo su log. Por tanto el fallo
    es propio del entorno de la app de la **municipal**, no del botón en general.
11. **c001-2027 recibió el 263 sin respaldo previo.** El 14 de octubre de 2026,
    entre las 23:33 y las 23:36 UTC, alguien usó «Aplicar actualización» del panel
    con las tres campañas: la departamental se actualizó a las 23:35:03 (verificada:
    versión 263, 35 de 35 huellas md5 idénticas a la plantilla, HTTP 200 en el
    3102, columna `tinyint(1)/NO/0` con `admin` 9 y `coordinador` 8) y c001 se
    reinició a las 23:36:39 (PID 48008 → 180450). La carpeta de c001 es ilegible
    para la cuenta de desarrollo, así que **no se pudo confirmar** su versión, su
    log ni la columna; solo que hoy el servidor le entrega el 263 (HTTP 200; antes
    daba 403). El respaldo de su base que se había pedido «antes de aplicar» NO
    se sacó. Pendiente como root: leer `.version-parche` y las últimas líneas de
    `logs/actualizaciones.log` de c001, verificar la columna, y sacar un respaldo
    AHORA (ya no será «antes», pero sigue siendo la línea base). Los scripts
    `orden7_parte1.sh` (verifica, y aplica solo si hace falta) y `orden7_parte2.sh`
    (lee c001 y respalda) quedaron preparados, revisados dos veces y probados con
    92 casos, en la carpeta de trabajo de esa sesión.

## Trampas encontradas

- **`unzip -o` conserva la fecha guardada en el zip.** Comparar la fecha de un
  archivo con la hora de arranque del proceso para saber si una campaña corre el
  código nuevo **da una respuesta inventada**: en las campañas los archivos
  quedan con fecha *futura* respecto al reloj. Lo que sí sirve: `md5sum` del
  archivo contra el de electoral, el registro en `logs/actualizaciones.log`, y
  el contador de reinicios de PM2. Casi escribo lo contrario en esta bitácora.
- **Un comentario SQL con acentos graves dentro de una plantilla de
  JavaScript** cierra la cadena. Los comentarios `--` de
  `routes/diaD.routes.js` van sin acentos graves por eso. Lo cazó `node --check`.
- **`verificar-html.py` valida la sintaxis, no las variables.** Una variable
  usada y no declarada pasa el control y revienta al abrir la pantalla. Pasó con
  `hayNumerosE14`.
- **Al renombrar un id de contenedor, los selectores de la hoja de estilos no
  avisan.** Renombrar `#panel-diad-candidatos` dejó doce reglas apuntando al id
  viejo: todos los tamaños de cuatro parches habrían dejado de aplicarse sin un
  solo error.
- **`grep` sin `-w` da falsos vivos.** `geocodificarYGuardar` parecía tener 7
  usos; seis eran `geocodificarYGuardarVotante`, otra función. Es la trampa que
  CLAUDE.md documenta con «CALIMA».includes(«CALI»).
- **La caché del celular guarda la RESPUESTA, no solo la página.** Cambiar la
  forma de lo que devuelve una ruta cacheada sin cambiar la clave deja al
  teléfono leyendo lo viejo con el código nuevo — y la tabla en blanco el día de
  la elección. Por eso `diad_candidatos` → `diad_listas_e14`, y por eso
  `/candidatos-para-reporte` sigue viva devolviendo la forma antigua.
- **Un total que suma «hasta la siguiente cabecera» supone un orden.** El total
  de la agrupación política daba **0** en cuanto la campaña subía «Nivelación de
  la mesa» por encima de Candidatos. Ahora cada fila lleva `data-bloque`.
- **`required` en un campo oculto** bloquea el envío sin mostrar aviso: el
  navegador intenta enfocar algo que no se ve.
- **Un número publicado no se reutiliza.** El 241 y el 242 llegaron a coexistir
  sin aplicar, cada uno reemplazando al anterior. `publicar-parche.sh --forzar`
  existe para un zip aún no aplicado, pero si se activa mientras se cambia, esa
  campaña se queda con el viejo para siempre.

## Candidatos para CLAUDE.md

*A criterio del usuario; no se tocó CLAUDE.md.*

- La trampa de `unzip -o` y las fechas: cómo comprobar de verdad que una campaña
  corre el código de un parche (md5 + log del actualizador + PM2), y por qué la
  fecha del archivo miente.
- Que `dia_d_candidatos` ya no es «los candidatos» sino «lo que el testigo
  cuenta en la mesa», en tres bloques, y que `dia_d_bloques` guarda su orden y
  su numeración por campaña.
- Que la regla de «último reporte por mesa» agrupa por **nombre de puesto**, y
  por qué no por `puesto_id` (mezclar dos numeraciones en una columna rompía la
  anulación de los reportes corregidos).

---
<!-- cierre automático -->
Sesión cerrada: 2026-09-02 11:53 UTC desde srv1807015
Rama: auditoria-fable | Commit: 7b2a1da Parche 251: el logo de WhatsApp en el renglón de Soporte | Sin commitear: 0 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-09-03 17:44 UTC desde srv1807015
Rama: auditoria-fable | Commit: af80452 Parche 253: el gráfico de apoyos por campaña | Sin commitear: 0 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-09-04 20:52 UTC desde srv1807015
Rama: auditoria-fable | Commit: 90274cb Un token de Mapbox por campaña, y una herramienta que lo comprueba | Sin commitear: 4 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-09-19 14:01 UTC desde srv1807015
Rama: auditoria-fable | Commit: 90274cb Un token de Mapbox por campaña, y una herramienta que lo comprueba | Sin commitear: 5 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-14 13:13 UTC desde srv1807015
Rama: auditoria-fable | Commit: a438988 Parche 262: territorios como tabla local editable en campañas nuevas | Sin commitear: 2 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-15 01:15 UTC desde srv1807015
Rama: auditoria-fable | Commit: d7d9efc Parche 263: .version-base a 263 | Sin commitear: 2 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-15 11:20 UTC desde srv1807015
Rama: auditoria-fable | Commit: d7d9efc Parche 263: .version-base a 263 | Sin commitear: 2 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-18 20:19 UTC desde srv1807015
Rama: auditoria-fable | Commit: d7d9efc Parche 263: .version-base a 263 | Sin commitear: 2 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-18 20:20 UTC desde srv1807015
Rama: auditoria-fable | Commit: d7d9efc Parche 263: .version-base a 263 | Sin commitear: 2 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-18 20:20 UTC desde srv1807015
Rama: auditoria-fable | Commit: d7d9efc Parche 263: .version-base a 263 | Sin commitear: 2 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-18 22:37 UTC desde srv1807015
Rama: auditoria-fable | Commit: 092beb4 Parche 264: varios territorios por persona en estructura | Sin commitear: 4 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-19 17:03 UTC desde srv1807015
Rama: auditoria-fable | Commit: 092beb4 Parche 264: varios territorios por persona en estructura | Sin commitear: 4 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-10-19 17:09 UTC desde srv1807015
Rama: auditoria-fable | Commit: 092beb4 Parche 264: varios territorios por persona en estructura | Sin commitear: 4 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-11-04 18:39 UTC desde srv1807015
Rama: auditoria-fable | Commit: 9fc8fa5 Parche 265: PWA para iPhone | Sin commitear: 4 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-11-06 15:17 UTC desde srv1807015
Rama: auditoria-fable | Commit: 2d8cbf4 Parche 267: .version-base a 267 (Legislación: calendario, buscador y tarjetas) | Sin commitear: 4 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-11-06 15:21 UTC desde srv1807015
Rama: auditoria-fable | Commit: 2d8cbf4 Parche 267: .version-base a 267 (Legislación: calendario, buscador y tarjetas) | Sin commitear: 5 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-11-06 18:43 UTC desde srv1807015
Rama: auditoria-fable | Commit: 5f31a08 Parche 270: .version-base a 270 (Estructura en la app del admin, formularios por pasos y copiado de la cédula) | Sin commitear: 5 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-11-06 20:34 UTC desde srv1807015
Rama: auditoria-fable | Commit: 8dfca61 ESTADO.md: remoto en GitHub (privado, deploy key), verificación y quién empuja | Sin commitear: 3 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-11-07 12:52 UTC desde srv1807015
Rama: auditoria-fable | Commit: 40077aa Parche 276: .version-base a 276 y ESTADO.md (Día D fase 4: cobertura, check-in, alertas y avisos push; publicado y registrado INACTIVO) | Sin commitear: 3 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-11-08 18:28 UTC desde srv1807015
Rama: auditoria-fable | Commit: 61590c3 Recordatorios automáticos, Fases 0 y 1: sin duplicados, relectura al despachar y motor apagado (parche 300 generado, sin publicar) | Sin commitear: 18 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-11-08 23:49 UTC desde srv1807015
Rama: auditoria-fable | Commit: 6fc68ec ESTADO.md: parche 306 publicado y registrado INACTIVO (toca la base, firmado) | Sin commitear: 3 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-11-09 01:26 UTC desde srv1807015
Rama: auditoria-fable | Commit: 781e570 ESTADO.md: parche 308 publicado y registrado INACTIVO (toca la base, firmado) | Sin commitear: 3 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-11-09 22:20 UTC desde srv1807015
Rama: auditoria-fable | Commit: e349e9b ESTADO.md: 313 publicado y registrado (inactivo); init-db y reinicio hechos en la Base | Sin commitear: 3 archivo(s)
