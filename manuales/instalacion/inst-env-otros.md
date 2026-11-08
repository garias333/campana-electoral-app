---
id: inst-env-otros
titulo: Variables de mapas, geocodificación y administrador inicial
seccion: instalacion
orden: 36
icono: mapa
modulo:
nivel:
roles: admin
ruta:
captura:
---
Las últimas cuatro variables: las llaves de Google y Mapbox, que activan la geocodificación y los fondos de mapa, y los datos del primer administrador. Todas son opcionales.

## Mapas y geocodificación

| Variable | Para qué sirve | Obligatoria |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | Llave de Google Cloud con la **Geocoding API** activada. Convierte direcciones en coordenadas. Sin ella no se geocodifican direcciones. | No |
| `MAPBOX_ACCESS_TOKEN` | Token público de Mapbox (empieza por `pk.`) para el Mapa territorial y el mapa del panel. Sin él los mapas funcionan solo con OpenStreetMap. | No |

Sobre Mapbox, ten presente:

- Sin token no se ofrecen los fondos «Mapbox Calles» y «Mapbox Satélite». No hay ningún error visible: solo falta el selector de fondos arriba a la derecha.
- Usa **un token por campaña, nunca compartido**. El token es público (el servidor lo entrega al navegador), así que el riesgo no es que se filtre sino la cuota: con uno compartido, las campañas se gastan el saldo unas a otras.
- Emítelo en tu cuenta de Mapbox y **restríngelo por URL** al dominio de la campaña desde el mismo panel.
- Para revisar todas las instancias y ponerlo sin equivocarte, corre como root:

```bash
bash scripts/mapbox-instancias.sh
bash scripts/mapbox-instancias.sh --poner <usuario> <token>
```

El script comprueba el token con una petición real a Mapbox antes de escribir ningún `.env`.

## Administrador inicial

Solo se usan la **primera vez**, al correr `npm run init-db` en una base sin administrador.

| Variable | Para qué sirve | Obligatoria |
|---|---|---|
| `ADMIN_EMAIL` | Correo del administrador inicial. Si falta, se crea con un correo genérico de instalación. Conviene fijarlo. | No |
| `ADMIN_PASSWORD` | Va comentada en `.env.example`. Si la defines, esa es la contraseña inicial y `init-db` no escribe archivo de credenciales. Si no la defines, `init-db` genera una al azar. | No |

No existe una contraseña por defecto: o la fijas tú o se genera al azar. Una vez creado el administrador, ambas variables ya no hacen nada y puedes borrar `ADMIN_PASSWORD` del `.env`.

::: listo
El Mapa territorial muestra arriba a la derecha el selector de fondos con «Mapbox Calles» y «Mapbox Satélite».
:::

::: consejo
Si defines `ADMIN_PASSWORD`, bórrala del `.env` en cuanto el administrador haya entrado y cambiado su contraseña: es una clave en texto claro en el servidor.
:::
