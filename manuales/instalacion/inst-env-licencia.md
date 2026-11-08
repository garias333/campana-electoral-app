---
id: inst-env-licencia
titulo: Variables de licencia, actualizaciones y nombre de la campaña
seccion: instalacion
orden: 32
icono: escudo
modulo:
nivel:
roles: admin
ruta:
captura:
---
La licencia liga esta instalación a un dominio y a un servidor. Estas variables permiten activarla, validarla cada cierto tiempo y recibir parches. Sin ellas la aplicación no valida licencia ni puede actualizarse.

## Licencia y actualizaciones

| Variable | Para qué sirve | Obligatoria |
|---|---|---|
| `LICENCIA_SERVIDOR_URL` | Dirección del servidor central de licencias (el panel de licencias). | Sí |
| `LICENCIA_API_SECRET` | Secreto compartido con el servidor de licencias. Lo usan la validación de licencia, el actualizador y la orden de «Aplicar actualizaciones» que llega desde el panel. | Sí |
| `LICENCIA_DOMINIO` | Dominio de esta campaña, **idéntico** al registrado en el panel de licencias y sin `https://`. De él sale también la huella de la máquina. | Sí |
| `LICENCIA_CLAVE` | Clave de licencia. Solo hace falta para activar, la primera vez; después puede quedar vacía. | Solo al activar |
| `PM2_NOMBRE_PROCESO` | Nombre del proceso en PM2 que reinicia el actualizador. Si está vacía, lo deduce buscando el proceso que corre el `app.js` de esta carpeta. Defínela solo si esa detección falla. | No |
| `PARCHES_PUBLICADOR_SECRET` | Solo para la máquina que **publica** parches. En una campaña no se define nunca. | No |

## Nombre de la campaña

| Variable | Para qué sirve | Obligatoria |
|---|---|---|
| `APP_NOMBRE` | Nombre que muestran los correos del código de ingreso y el aviso de Telegram, para saber de qué campaña vienen. Si está vacía se usa el nombre genérico de la aplicación. | No |
| `CAMPANA_NOMBRE` | Ningún archivo de código la lee. Se conserva por compatibilidad con instalaciones antiguas; puedes dejarla vacía. | No |

## Activar la licencia

1. Pon `LICENCIA_SERVIDOR_URL`, `LICENCIA_API_SECRET`, `LICENCIA_DOMINIO` y `LICENCIA_CLAVE` en el `.env`.
2. Activa, una sola vez, con la cuenta del sitio:

```bash
node scripts/activar-licencia.js
```

3. La activación queda guardada en `.licencia-cache.json`. No copies ese archivo a otra instalación.

## Cómo se comporta después

- La aplicación vuelve a validar la licencia cada 6 horas. Si pasan más de 72 horas sin poder contactar al servidor de licencias, se bloquea por precaución.
- La huella de la máquina sale de `/etc/machine-id` más el dominio. Si mueves la instalación a otro servidor, hay que activar de nuevo.
- Una licencia vencida o suspendida bloquea la aplicación, pero las rutas del actualizador siguen disponibles para poder recibir parches.

::: listo
`node scripts/activar-licencia.js` termina sin error, aparece `.licencia-cache.json` en la carpeta y la pantalla de ingreso carga sin el aviso de licencia.
:::

::: cuidado
Si `LICENCIA_DOMINIO` no coincide letra por letra con el dominio registrado en el panel de licencias, la activación se rechaza. Revisa mayúsculas, guiones y que no lleve `https://` ni barra final.
:::
