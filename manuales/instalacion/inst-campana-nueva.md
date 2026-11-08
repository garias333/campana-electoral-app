---
id: inst-campana-nueva
titulo: Montar una campaña nueva desde la plantilla de instalación
seccion: instalacion
orden: 80
icono: carpeta
modulo:
nivel:
roles: admin
ruta:
captura:
---
La plantilla es el código de la instalación principal, sin nada que sea de ella: sin credenciales, sin licencia activada, sin datos y sin archivos subidos. Declara el parche con el que nació (`.version-parche` y `.version-base`) para que el actualizador no intente bajar todos los parches uno por uno.

## Cómo se genera la plantilla

En la instalación principal, con el número de parche vigente:

```bash
node scripts/generar-plantilla.js --parche <numero>
```

Para revisar sin escribir el zip, agrega `--simular`. El zip queda por omisión en `backups/plantillas/`. Parte de lo que git ve en el árbol y descarta `.env`, `.licencia-cache.json`, `.credenciales-*.txt`, `backups/`, `logs/`, `node_modules/`, `parches/` y el contenido de `uploads/`. Incluye `config/llaves-parches/`, porque sin una llave el actualizador no arranca, y deja vacías las carpetas `logs/` y `uploads/`.

## Pasos para una campaña nueva

1. En el panel de licencias, registra la campaña con su **dominio exacto** y obtén la clave de licencia.
2. Crea el sitio y la base en CloudPanel ({{inst-sitio-bd}}).
3. Descomprime la plantilla en la carpeta del sitio, con la cuenta del sitio.
4. Instala las dependencias, copia el modelo del `.env` y complétalo ({{inst-proyecto-env}}). Usa un puerto propio y un `SESSION_SECRET` nuevo.
5. Pide a quien administra MySQL el permiso de lectura sobre las tres tablas del catálogo ({{inst-init-db}}).
6. Corre `npm run init-db`, lee y borra los archivos `.credenciales-*.txt`.
7. Activa la licencia, una sola vez:

```bash
node scripts/activar-licencia.js
```

8. Arranca con PM2 y deja el arranque tras reinicio del servidor ({{inst-arrancar}}).
9. Conecta el dominio y el certificado ({{inst-dominio-ssl}}).
10. Deja el cron de las 3 a. m. ({{inst-parches}}).
11. Opcional: configura Telegram, el correo, el SMS y los avisos en la app ({{inst-env-push-telegram}}, {{inst-env-correo}}, {{inst-env-sms}}).

## Qué trae y qué no trae de datos

- **Puestos de votación y mesas**: salen del catálogo, que la campaña solo lee. En **Configuración**, pestaña **Día D**, elige el departamento (y el municipio) y usa el panel «Traer puestos del catálogo oficial». Es repetible: lo ya traído no se duplica.
- **Comunas, barrios, corregimientos y veredas**: son una tabla local de la campaña, vacía al nacer. Se llena agregando uno a uno o importando un Excel desde la pantalla de territorios (solo el administrador).
- Para verificar el vínculo con el catálogo, con sesión iniciada, abre `/api/catalogo/salud`: debe responder `"accesible":true`.

::: listo
Puedes iniciar sesión con el administrador por `https://<dominio>`, la licencia está activa, `cat .version-parche` muestra el número de la plantilla y `/api/catalogo/salud` responde accesible.
:::

::: cuidado
Una campaña nueva se monta siempre desde la plantilla, nunca copiando la carpeta de otra campaña: heredarías su `.env`, su licencia y sus datos. Cada campaña necesita su propia licencia, su propio `SESSION_SECRET` y su propio token de Mapbox.
:::

::: consejo
Haz el primer ingreso con el administrador y verifica que el correo de recuperación llega antes de entregar la campaña. Es la prueba más corta de que el SMTP quedó bien.
:::
