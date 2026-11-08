---
id: inst-dominio-ssl
titulo: Conectar el dominio, el proxy inverso y el certificado SSL
seccion: instalacion
orden: 60
icono: enlace
modulo:
nivel:
roles: admin
ruta:
captura:
---
La aplicación escucha solo en `127.0.0.1` y espera un proxy inverso delante (Nginx, administrado por CloudPanel). Con `NODE_ENV=production` la cookie de sesión lleva el atributo `Secure`, así que **sin HTTPS nadie podrá iniciar sesión**.

## Pasos

1. En tu proveedor de DNS, crea el registro **A** del dominio o subdominio de la campaña apuntando a la IP del servidor.
2. Comprueba que el DNS ya resuelve:

```bash
dig +short <dominio-de-la-campaña>
```

3. En CloudPanel, abre el sitio y deja el proxy inverso apuntando a `http://127.0.0.1:<puerto>`, con el mismo puerto que pusiste en `PORT`.
4. En el mismo sitio, emite el certificado Let's Encrypt desde la sección de SSL/TLS de CloudPanel.
5. Comprueba la aplicación a través del dominio:

```bash
curl -I https://<dominio-de-la-campaña>/login.html
```

6. Verifica que `LICENCIA_DOMINIO` del `.env` sea exactamente este dominio ({{inst-env-licencia}}).

## Qué hace la aplicación por su parte

- Declara `trust proxy`, para saber que la conexión real del navegador es HTTPS aunque llegue por HTTP al puerto interno.
- No incluye configuración de Nginx ni automatiza el certificado: ambos son de CloudPanel.

::: listo
`https://<dominio>/login.html` carga con el candado del navegador y, al iniciar sesión, la cookie `campana_sid` queda guardada.
:::

::: cuidado
Si Let's Encrypt falla con «DNS problem: NXDOMAIN», falta el registro A del dominio (o aún no se propagó). Corrígelo en el proveedor de DNS y vuelve a emitir.
:::

::: consejo
Si la página carga pero no puedes iniciar sesión, revisa primero que estés entrando por `https://` y que `NODE_ENV=production` no esté sin certificado detrás.
:::

Siguiente paso: {{inst-arrancar}} si aún no arrancaste, o {{inst-parches}} para mantenerla al día.
