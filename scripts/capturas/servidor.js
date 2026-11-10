'use strict';
/**
 * SERVIDOR DE PRUEBA PARA LAS CAPTURAS (scripts/capturar-manuales.js).
 *
 * Monta las MISMAS rutas reales de app.js sobre la base simulada, pero sin licencia, sin almacén de sesiones y sin CSRF. La «sesión»
 * se decide por la cookie `ej_usuario=<id>`: se lee de la base (como lo haría el inicio de sesión) y nada más. Nada de esto se despliega.
 */
const path = require('path');
const express = require('express');

const RAIZ = path.join(__dirname, '..', '..');

function crear(pool) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use(async (req, res, next) => {
    const m = /(?:^|; )ej_usuario=(\d+)/.exec(req.headers.cookie || '');
    req.session = { csrfToken: 'ejemplo' };
    if (m) {
      const [[u]] = await pool.query('SELECT u.*, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?', [Number(m[1])]);
      if (u) {
        req.session.usuario = {
          id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, rol_real: u.rol, territorio_id: u.territorio_id,
          debe_cambiar_password: false, two_factor_enabled: false, es_aspirante: false,
        };
      }
    }
    req.sublicencia = null;
    next();
  });
  app.get('/api/csrf-token', (req, res) => res.json({ csrfToken: 'ejemplo' }));
  app.get('/api/marca-publica', async (req, res) => {
    const [[c]] = await pool.query('SELECT marca_titulo, marca_subtitulo, marca_logo_url FROM configuracion_campana WHERE id = 1');
    res.json({ titulo: (c && c.marca_titulo) || '', subtitulo: (c && c.marca_subtitulo) || '', logo_url: '' });
  });

  app.use('/b', require(path.join(RAIZ, 'routes/baja.routes')));
  app.use('/c', require(path.join(RAIZ, 'routes/confirmacion.routes')));
  app.use('/v', require(path.join(RAIZ, 'routes/yaVoto.routes')));
  app.use('/i', require(path.join(RAIZ, 'routes/inscripcion.routes')));
  // Activar complementos (parche 318): las mismas puertas que app.js (el enlace del conductor y las pantallas de un complemento apagado).
  const { requiereComplementoPublico, paginasDeComplementos } = require(path.join(RAIZ, 'middleware/complemento'));
  app.use('/t', requiereComplementoPublico('transporte_dia_d'), require(path.join(RAIZ, 'routes/transporte.routes')));

  const { cargarSublicencia, restringirAspirante } = require(path.join(RAIZ, 'middleware/aspirante'));
  app.use('/api', cargarSublicencia, restringirAspirante);
  const montar = (ruta, archivo) => app.use(ruta, require(path.join(RAIZ, 'routes', archivo)));
  montar('/api/auth', 'auth.routes');
  montar('/api/territorial', 'territorial.routes');
  montar('/api/votantes', 'votantes.routes');
  montar('/api/inscripcion', 'inscripcion.panel.routes');
  montar('/api/votantes-dashboard', 'votantesDashboard.routes');
  montar('/api/finanzas', 'finanzas.routes');
  montar('/api/eventos', 'eventos.routes');
  montar('/api/social', 'social.routes');
  montar('/api/recursos', 'recursos.routes');
  montar('/api/legislacion', 'legislacion.routes');
  montar('/api/dashboard', 'dashboard.routes');
  montar('/api/usuarios', 'usuarios.routes');
  montar('/api/geo', 'geo.routes');
  montar('/api/organigrama', 'organigrama.routes');
  montar('/api/configuracion', 'configuracion.routes');
  montar('/api/permisos', 'permisos.routes');
  montar('/api/complementos', 'complementos.routes');
  montar('/api/manuales', 'manuales.routes');
  montar('/api/panel-lider', 'panelLider.routes');
  montar('/api/comunicaciones', 'comunicaciones.routes');
  montar('/api/contenido', 'contenido.routes');
  montar('/api/dia-d/rescate', 'rescateVotos.routes');
  montar('/api/dia-d/resultados', 'resultadosDiaD.routes');
  montar('/api/dia-d/cobertura', 'coberturaTestigos.routes');
  montar('/api/dia-d/checkin', 'checkinDiaD.routes');
  montar('/api/dia-d/alertas', 'alertasDiaD.routes');
  montar('/api/dia-d/transporte', 'transporteDiaD.routes');
  montar('/api/dia-d/logistica', 'logisticaDiaD.routes');
  montar('/api/dia-d', 'diaD.routes');
  montar('/api/catalogo', 'catalogo.routes');
  montar('/api/backup', 'backup.routes');
  montar('/api/push', 'push.routes');
  montar('/api/recordatorios', 'recordatorios.routes');
  montar('/api/solicitudes', 'solicitudes.routes');
  montar('/api/tareas', 'tareas.routes');
  montar('/api/puerta-a-puerta', 'puertaAPuerta.routes');
  app.use('/api', (req, res) => res.status(404).json({ error: 'sin ruta en el servidor de capturas' }));

  app.get('/js/validarCedula.js', (req, res) => { res.type('application/javascript'); res.sendFile(path.join(RAIZ, 'lib', 'validarCedula.js')); });
  app.use(paginasDeComplementos);
  app.use(express.static(path.join(RAIZ, 'public'), { etag: false, lastModified: false, setHeaders: (r) => r.setHeader('Cache-Control', 'no-store') }));
  return app;
}

module.exports = { crear };
