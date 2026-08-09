# Administración de Campañas Políticas — Estrategia (INGESES S.A.S.)

Aplicación web profesional para la gestión integral de una campaña electoral en Colombia: estructura territorial, base de datos de votantes, finanzas, eventos/GOTV, redes sociales/monitoreo de opinión, e información institucional para compartir con el equipo.

## Módulos incluidos

1. **Estructura territorial** — coordinadores, líderes y testigos, organizados por territorio (departamento → municipio → comuna/corregimiento → barrio/vereda), con jerarquía de reporte y metas de votos.
2. **Votantes y contactos** — base de datos con intención de voto (semáforo: confirmado / probable / indeciso / no apoya / desconocido), búsqueda, filtros e importación masiva.
3. **Finanzas** — ingresos y gastos por categoría, comprobantes adjuntos, balance en tiempo real. Visible solo para `admin` y `coordinador`.
4. **Eventos y GOTV** — agenda de reuniones, eventos públicos y jornadas de movilización, con control de asistentes.
5. **Redes sociales y monitoreo de opinión** — calendario editorial de publicaciones y registro de menciones con análisis de sentimiento.
6. **Información para compartir** — noticias, posts, videos, publicidad digital/impresa y próximas reuniones. **Solo el rol `admin` puede subir o eliminar archivos; los demás roles autenticados solo pueden consultarlos y descargarlos.**

## Roles del sistema

| Rol          | Alcance                                                              |
|--------------|-----------------------------------------------------------------------|
| `admin`      | Control total de la plataforma, incluida la carga/eliminación de recursos y la gestión de finanzas. |
| `coordinador`| Gestión operativa de su zona: estructura, votantes, finanzas, eventos, redes. |
| `lider`      | Gestión de sus propios contactos y eventos territoriales.             |
| `testigo`    | Consulta de información electoral relevante a su puesto/mesa.         |
| `invitado`   | Solo lectura (por ejemplo, descarga de recursos publicados).          |

## Stack técnico

- Node.js + Express
- MySQL (mysql2) con sesiones respaldadas en base de datos (`express-mysql-session`)
- Autenticación con `bcryptjs`, bloqueo por fuerza bruta y cambio de contraseña obligatorio en primer ingreso
- Carga de archivos con `multer`
- Frontend en HTML/CSS/JS puro (sin build step), pensado para desplegarse igual que los proyectos de FODA y Mapa de Manizales

## Instalación local

```bash
npm install
cp .env.example .env
# Editar .env con las credenciales de tu base de datos MySQL local
npm run init-db     # crea las tablas y un usuario admin inicial
npm run dev          # o "npm start" en producción
```

Al finalizar `npm run init-db`, la consola mostrará el correo y la contraseña temporal del usuario administrador. Se le pedirá cambiarla en el primer ingreso.

## Despliegue en Hostinger (Node.js vía Passenger)

Sigue el mismo flujo que ya usas en `foda.gildardoarias.com` y `mapamanizales.gildardoarias.com`:

1. **Base de datos MySQL**: crea la base de datos y el usuario desde hPanel. Usa `127.0.0.1` como `DB_HOST` en `.env` (no `localhost`), para evitar el problema de resolución IPv6/IPv4 que ya conoces.
2. **Subdominio**: crea el subdominio (por ejemplo `campana.gildardoarias.com`) y apunta su carpeta de aplicación Node.js en hPanel.
3. **Variables de entorno**: configura `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `SESSION_SECRET` desde el panel de la aplicación Node de Hostinger (o en un `.env` subido junto al proyecto).
4. **Subida del proyecto**: comprime el proyecto (sin `node_modules`) en un `.zip` y súbelo vía el administrador de archivos, igual que en tus despliegues anteriores.
5. **Instalación de dependencias**: desde la terminal SSH de Hostinger, dentro de la carpeta del proyecto:
   ```bash
   npm install --production
   npm run init-db
   ```
6. **Punto de entrada**: configura `app.js` como archivo de arranque de la aplicación Node en hPanel (Passenger lo ejecuta automáticamente; el `app.listen` interno sigue funcionando porque Passenger inyecta el puerto vía la variable de entorno `PORT`).
7. **Reinicio**: usa el botón "Reiniciar" de la aplicación Node en hPanel cada vez que subas cambios (equivalente al flujo de redeploy que ya usas en tus otros proyectos).

## Seguridad implementada

- Contraseñas con `bcrypt` (12 rondas).
- Bloqueo temporal de cuenta tras 5 intentos fallidos (15 minutos).
- Cambio de contraseña forzado para cuentas creadas por un administrador/coordinador.
- Sesiones persistidas en MySQL (no en memoria), para que sobrevivan a reinicios del proceso en Passenger.
- Control de acceso por rol en cada endpoint de la API.
- Los archivos subidos a "Información para compartir" solo pueden cargarse o eliminarse por el rol `admin`; la descarga está controlada por la API (no se expone la ruta física de `/uploads` para ese módulo).
- Registro de auditoría básico (tabla `auditoria`) para inicios de sesión y acciones sensibles.

## Estructura del proyecto

```
campana-app/
├── app.js                  # Punto de entrada (Express + sesiones + rutas)
├── config/db.js             # Pool de conexión MySQL
├── middleware/               # Autenticación, roles y carga de archivos
├── routes/                   # Un archivo de rutas por módulo (API REST)
├── db/schema.sql             # Esquema completo de la base de datos
├── db/init-db.js             # Script de inicialización + usuario admin
├── public/                   # Frontend (HTML, CSS, JS sin build step)
└── uploads/                  # Archivos subidos (comprobantes y recursos)
```

## Próximos pasos sugeridos

- Integrar este módulo con el mapa territorial de Manizales (mismo sistema de semáforo de colores) y con el Diagnóstico FODA, usando el mismo esquema de usuarios si se desea un inicio de sesión único.
- Agregar exportación de reportes (Excel/PDF) para rendición de cuentas ante el CNE.
- Añadir notificaciones automáticas (WhatsApp/email) para recordatorios de eventos GOTV.
