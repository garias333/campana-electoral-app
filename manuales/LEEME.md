# Manuales de ayuda: cómo se escriben los bloques

Los manuales de **Ayuda** no están escritos en la pantalla: cada tema es un archivo de esta carpeta y el servidor arma el manual de cada
persona con los bloques que sus permisos permiten (`lib/manuales.js`, `routes/manuales.routes.js`).

- `bloques/<id>.md`: un bloque por archivo (guías, preguntas frecuentes y glosario).
- `instalacion/<id>.md`: el manual de instalación, solo para el administrador.

## Cabecera de cada archivo

    ---
    id: t-votante-agregar          (igual al nombre del archivo, sin .md)
    titulo: Registrar a una persona
    seccion: basicos | antes | durante | dia-d | administracion | faq | glosario
    orden: 121
    icono: persona                 (uno del sprite de public/ayuda.html; ver ICONOS en lib/manuales.js)
    modulo: votantes               (clave de la matriz de permisos, o vacío)
    nivel: agregar                 (ver | editar | agregar | importar; solo con módulo)
    roles:                         (solo si no hay módulo: `todos` o una lista; admin, coordinador, lider, sublider, testigo,
                                    usuario, asistente_administrativo, administrativo, invitado, aspirante)
    ruta: Escritorio: Electoral > Votantes y sublíderes | Celular: Registro de votantes y sublíderes
    captura: t-votante-agregar.webp   (la captura de pantalla de la guía, en public/manuales/img/; hasta dos, separadas por coma; la
                                       segunda se llama <id>-2.webp. La llena scripts/capturar-manuales.js, no se escribe a mano)
    ---

- Un bloque **con módulo** sale solo si la persona tiene «Ver» en ese módulo y además el nivel que pide el bloque.
- Un bloque **sin módulo** sale según `roles`.
- El último paso de `ruta` debe ser una entrada real del menú (`NAV_ITEMS` de `public/js/common.js` o los menús de `public/app/inicio.html`).
  Si el tema no está en ningún menú, deja `ruta:` vacío.

## Cuerpo

Markdown mínimo; todo lo demás se escapa. `## Subtítulo`, listas numeradas (pasos) y con viñeta, `**negrita**`, `*cursiva*`,
`` `código` ``, `[[Botón]]` (se pinta como botón azul), `{{id-de-otro-bloque}}` (enlace «Ver: …»), tablas con `|`, bloques de código
con tres comillas invertidas, y recuadros:

    ::: consejo | importante | cuidado | listo      (listo = «Así sabes que funcionó»)
    texto
    :::

Una tarea lleva: para qué sirve (sin subtítulo), `## Pasos`, un recuadro `listo` y un `consejo` o `cuidado`. Un módulo lleva
`## Qué encuentras`, `## Qué puedes hacer según tu permiso` y `## Tareas frecuentes`.

## Reglas

- Nombres de botones y menús tal como salen en pantalla. Tuteo, frases cortas, un paso por acción.
- **Nunca** el cargo al que aspira alguien (ni en ejemplos): «la campaña», «el candidato».
- Sin datos personales; ejemplos inventados y enmascarados.
- `node scripts/probar-manuales.js` (sobre una base `simulada…`) revisa todo esto.

## Capturas de pantalla

Cada guía que explica una pantalla lleva su captura, tomada con **datos inventados** (nunca de una campaña real) y sin ningún cargo de elección
a la vista. Se guardan en `public/manuales/img/<id-de-la-guía>.webp` (WebP, menos de 150 KB cada una; celular a 390 px con escala 2,
escritorio a 1280 px con escala 1).

- **Rehacerlas todas** cuando cambie una pantalla: `scripts/capturar-manuales.js` (ver su cabecera). Siembra una base `simulada…` recién
  inicializada, levanta las rutas reales de la aplicación, entra con cada rol, navega, dibuja el recuadro amarillo `#FFC300` donde se indique y
  recorta. La lista de pantallas es `scripts/capturas/lista.js`; los datos, `scripts/capturas/semilla.js`.
- El script **se niega a guardar** una captura cuyo texto visible nombre un cargo de elección, y a correr sobre una base que no empiece por
  `simulada` o `prueba`.
- `lib/manuales.js` valida cada `captura:` al cargar (que exista, que sea WebP y que no pase de 150 KB; si no, se avisa y esa imagen se omite) y manda al
  navegador su ancho y su alto. `scripts/probar-manuales.js` además revisa que no sobre ningún archivo en la carpeta.
- **Orden en la guía:** primero la imagen sin sufijo y después la «-2» (se ordenan por el nombre del archivo). Con `--solo`, si rehaces una imagen de una guía que lleva dos, rehaz las dos: `captura:` se escribe con las que se hicieron en esa corrida.
- Las imágenes **no** van en la precarga del service worker: se guardan en caché al verse.
