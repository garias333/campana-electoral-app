---
id: inst-arrancar
titulo: Arrancar con PM2 y reiniciar sin riesgos
seccion: instalacion
orden: 50
icono: flecha
modulo:
nivel:
roles: admin
ruta:
captura:
---
PM2 mantiene la aplicación viva y la reinicia si cae. Cada cuenta de sitio tiene su propio PM2, así que todo lo que sigue se corre con la cuenta del sitio, salvo lo que diga «como root». El proceso se llama `campana-app` en todas las instancias.

## Primer arranque

1. Entra a la carpeta del sitio con la cuenta del sitio.
2. Arranca la aplicación con la ruta absoluta de Node:

```bash
pm2 start app.js --name campana-app --interpreter "$(command -v node)"
pm2 save
```

3. Revisa el registro:

```bash
pm2 logs campana-app --lines 20 --nostream
```

4. Comprueba que responde en el puerto del `.env`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<puerto>/login.html
```

La ruta absoluta importa: si PM2 guarda el intérprete como `node` a secas, lo busca por `PATH` al reaparecer el proceso y puede fallar con `spawn node EACCES`, dejando la lista en «online» con pid `N/A` y memoria en 0, un estado roto con cara de sano.

## Después de cambiar el .env

`pm2 restart` **no** relee el `.env`. Haz el ciclo completo, con la cuenta del sitio:

```bash
pm2 delete campana-app
pm2 start app.js --name campana-app --interpreter "$(command -v node)"
pm2 save
```

## Reiniciar una instancia (por ejemplo tras un parche)

Como root, con el script del repositorio:

```bash
bash scripts/reiniciar-instancia.sh <usuario-de-la-cuenta>
```

El puerto es opcional: si no lo pasas, lo lee de `PORT` en el `.env`. El script busca la carpeta con `app.js` en `/home/<usuario>/htdocs/` (exige que haya una sola), localiza el `node` y el `pm2` de esa cuenta y reinicia. **Lo que comprueba es que el PID cambió**, no que el puerto responda: un puerto que contesta puede ser el proceso viejo. Si el PID no cambia, recrea el proceso con el intérprete absoluto y hace `pm2 save`.

## Arranque tras reiniciar el servidor

Para que la aplicación vuelva sola cuando se reinicia el VPS, usa **una** de estas dos vías.

**A. Servicio de systemd (como root).** Ajusta la versión de Node de la cuenta:

```bash
env PATH=$PATH:/home/<usuario>/.nvm/versions/node/<versión>/bin \
  /home/<usuario>/.nvm/versions/node/<versión>/bin/pm2 startup systemd -u <usuario> --hp /home/<usuario>
```

Después, como la cuenta del sitio y con la aplicación ya arrancada, corre `pm2 save`. Comprueba con `systemctl status pm2-<usuario>`.

**B. `@reboot` en el crontab de la cuenta**, para sitios donde no hay servicio de systemd. Requiere que exista `~/.pm2/dump.pm2` (lo crea `pm2 save`); sin él, `pm2 resurrect` no revive nada:

```bash
@reboot . $HOME/.nvm/nvm.sh >/dev/null 2>&1; pm2 resurrect
```

::: listo
`pm2 list` muestra `campana-app` en «online» con un pid numérico y memoria mayor que cero, el `curl` devuelve 200 y, tras reiniciar el servidor, el sitio vuelve sin que nadie lo arranque.
:::

::: cuidado
Un `pm2 list` que dice «online» y un puerto que responde no prueban que el reinicio ocurrió. Compara el pid antes y después, o usa `scripts/reiniciar-instancia.sh`, que lo hace por ti.
:::

::: importante
Usa siempre la cuenta del sitio: el PM2 de otra cuenta no ve el proceso. Y no inventes el nombre del proceso; mira el real con `pm2 list`.
:::
