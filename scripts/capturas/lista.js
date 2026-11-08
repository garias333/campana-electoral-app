'use strict';
/**
 * LA LISTA DE CAPTURAS de los manuales. Cada entrada produce public/manuales/img/<id>.webp y llena `captura:` de la guía <id>
 * (una segunda imagen de la misma guía se llama <id>-2).
 *
 *   id        nombre del archivo (y de la guía; con sufijo -2 si es la segunda imagen)
 *   rol       con quién se entra: admin | coordinador | lider | sublider | testigo | asistente | null (pantalla pública)
 *   ancho     'cel' (390 px, escala 2) o 'pc' (1280 px, escala 1)
 *   url       la pantalla (admite #pestaña)
 *   antes     pasos antes de capturar: clic('texto:…' | selector), escribir(sel, valor), elegir(sel, texto), desplazar(sel), espera(ms)
 *   resaltar  recuadros amarillos #FFC300 de 3 px sobre estos elementos ('texto:…' o selector CSS)
 *   recorte   selector del elemento que se recorta (sin él, se toma la ventana: 390×844 en celular, 1280×800 en escritorio)
 *   subir     cuántos niveles sube el recorte desde el elemento hallado (el título de una tarjeta → la tarjeta)
 *   alto      altura de la ventana si no es la de siempre
 *
 * Reglas del encargo: datos inventados (scripts/capturas/semilla.js) y ningún cargo de elección en lo que se ve (el script se niega).
 */
const cel = (id, rol, url, o) => ({ id, rol, ancho: 'cel', url, ...(o || {}) });
const pc = (id, rol, url, o) => ({ id, rol, ancho: 'pc', url, ...(o || {}) });

module.exports = [
  // ------------------------------------------------------------------------------------------------ primeros pasos
  pc('b-entrar', null, '/login.html'),
  cel('b-cambiar-clave', null, '/forgot-password.html', { resaltar: ['texto:Enviar enlace de recuperación'] }),
  cel('b-menu', 'lider', '/app/inicio.html'),
  cel('b-cerrar-sesion', 'lider', '/app/inicio.html', { antes: (p) => p.desplazar('texto:Cerrar sesión'), resaltar: ['texto:Cerrar sesión'] }),
  cel('b-ayuda', 'lider', '/ayuda.html'),

  // ------------------------------------------------------------------------------------------------ celular: registrar y enlace
  cel('mod-votantes', 'lider', '/app/mis-registros.html', { resaltar: ['texto:Registrar una persona'] }),
  cel('t-votante-agregar', 'lider', '/app/registro-votante.html', { resaltar: ['texto:Siguiente'] }),
  cel('t-qr-enlace', 'lider', '/app/mi-enlace.html'),
  cel('t-qr-enlace-2', null, '/i/MUESTRA2'),
  cel('t-qr-mensaje', 'lider', '/app/mi-enlace.html', { antes: (p) => p.desplazar('texto:Mensaje que vas a mandar'), recorte: 'texto:Mensaje que vas a mandar', subir: 1, margen: 0 }),
  cel('t-registraduria', 'lider', '/app/puesto-votacion.html', { resaltar: ['texto:Consultar en registraduria.gov.co'] }),

  // ------------------------------------------------------------------------------------------------ celular: Día D
  cel('mod-rescate_votos', 'lider', '/app/faltantes.html'),
  cel('t-faltan-por-votar', 'lider', '/app/faltantes.html', { resaltar: ['texto:Faltan', 'input[type=search], input[placeholder^="Buscar"]'] }),
  cel('t-marcar-ya-voto', 'lider', '/app/faltantes.html', { antes: (p) => p.desplazar('texto:Ya votó'), resaltar: ['texto:Ya votó'] }),
  cel('t-ya-vote-enlace', 'lider', '/app/faltantes.html', { antes: (p) => p.desplazar('texto:Copiar enlace'), resaltar: ['texto:Copiar enlace'] }),
  cel('t-transporte-marcar', 'lider', '/app/faltantes.html', { antes: (p) => p.desplazar('texto:Necesita transporte'), resaltar: ['texto:Necesita transporte'] }),
  cel('t-avance-ranking', 'coordinador', '/app/ranking-dia-d.html'),
  cel('mod-alertas_dia_d', 'coordinador', '/app/alertas-dia-d.html'),
  cel('t-transporte-alerta', 'coordinador', '/app/alertas-dia-d.html', { resaltar: ['texto:3 faltantes necesitan transporte'] }),
  cel('mod-logistica_dia_d', 'coordinador', '/app/logistica.html', { antes: (p) => p.elegir('select', 'Ejemplo Norte') }),
  cel('t-testigo-llegue', 'testigo', '/app/dia-d.html', { resaltar: ['texto:Llegué a mi puesto'] }),
  cel('t-testigo-reporte', 'testigo', '/app/dia-d.html', { antes: (p) => p.desplazar('texto:Reportar conteo de mi mesa'), resaltar: ['texto:Reportar conteo de mi mesa'] }),
  cel('t-conductor-enlace', null, '/t/CAMPANA2'),

  // ------------------------------------------------------------------------------------------------ celular: otras pantallas
  cel('mod-legislacion', 'admin', '/app/legislacion.html'),
  cel('mod-recursos', 'lider', '/app/informacion.html?modo=informacion'),
  cel('t-estructura-agregar-2', 'admin', '/app/admin-estructura.html'),

  // ------------------------------------------------------------------------------------------------ escritorio: antes
  pc('mod-panel_general', 'admin', '/dashboard.html', { alto: 640 }),
  pc('mod-organigrama', 'admin', '/organigrama.html'),
  pc('t-organigrama-agregar', 'admin', '/organigrama.html', { antes: (p) => p.clic('texto:+ Agregar cargo raíz'), resaltar: ['texto:Guardar'] }),
  pc('mod-territorial', 'admin', '/territorial.html'),
  // (El formulario de «Agregar persona» lista un cargo de elección en sus opciones: se muestra el botón, no el formulario.)
  pc('t-estructura-agregar', 'admin', '/territorial.html', { resaltar: ['texto:+ Agregar persona'] }),
  pc('mod-votantes-2', 'admin', '/votantes.html', { resaltar: ['texto:+ Nuevo votante o sublíder'] }),
  pc('t-votante-editar', 'admin', '/votantes.html', { resaltar: ['texto:Editar'] }),
  pc('mod-testigos', 'admin', '/testigos.html'),
  pc('mod-votantes_dashboard', 'admin', '/votantes-dashboard.html'),
  pc('t-dashboard-exportar', 'admin', '/votantes-dashboard.html', { resaltar: ['texto:Excel', 'texto:Informe'] }),
  pc('mod-mapa', 'admin', '/mapa.html'),

  // ------------------------------------------------------------------------------------------------ escritorio: durante
  pc('mod-agenda', 'admin', '/agenda.html'),
  pc('mod-eventos', 'admin', '/eventos.html'),
  pc('t-evento-agregar', 'admin', '/eventos.html', { antes: (p) => p.clic('texto:+ Nuevo evento'), resaltar: ['texto:Guardar evento'] }),
  pc('mod-asistentes_reuniones', 'admin', '/asistentes-reuniones.html'),
  pc('t-asistencia', 'admin', '/asistentes-reuniones.html', { antes: (p) => p.clic('texto:Registrar asistencia'), resaltar: ['texto:+ Agregar'] }),
  pc('mod-social', 'admin', '/social.html'),
  pc('t-social-agregar', 'admin', '/social.html', { antes: (p) => p.clic('texto:+ Nueva publicación'), resaltar: ['texto:Guardar'] }),
  pc('mod-finanzas', 'admin', '/finanzas.html'),
  pc('t-finanzas-agregar', 'admin', '/finanzas.html', { antes: (p) => p.clic('texto:+ Registrar movimiento'), resaltar: ['texto:Guardar movimiento'] }),
  pc('mod-crm', 'admin', '/crm.html'),
  pc('t-crm-campana', 'admin', '/crm.html', { antes: (p) => p.desplazar('texto:Enviar campaña'), resaltar: ['texto:Enviar campaña'] }),
  pc('mod-enviar_email', 'admin', '/enviar-email.html'),
  pc('mod-enviar_sms', 'admin', '/enviar-sms.html'),
  pc('mod-enviar_push', 'admin', '/enviar-push.html'),
  pc('t-no-contactar', 'admin', '/no-contactar.html'),
  pc('mod-recursos-2', 'admin', '/recursos.html'),
  pc('mod-legislacion-2', 'admin', '/legislacion.html'),

  // ------------------------------------------------------------------------------------------------ escritorio: Día D
  pc('mod-dia_d', 'admin', '/dia-d.html'),
  pc('mod-rescate_votos-2', 'admin', '/dia-d.html#avance'),
  pc('mod-alertas_dia_d-2', 'admin', '/dia-d.html#alertas'),
  pc('mod-resultados_dia_d', 'admin', '/dia-d.html#resultados'),
  pc('t-resultados-consolidado', 'admin', '/dia-d.html#resultados', { resaltar: ['texto:Consolidado'] }),
  pc('t-resultados-oficial', 'admin', '/dia-d.html#resultados', { antes: (p) => p.clic('texto:Resultado oficial'), resaltar: ['texto:Resultado oficial'] }),
  pc('t-resultados-diferencias', 'admin', '/dia-d.html#resultados', { antes: (p) => p.clic('texto:Diferencias'), resaltar: ['texto:Diferencias'] }),
  pc('mod-transporte_dia_d', 'admin', '/dia-d.html#transporte'),
  pc('mod-logistica_dia_d-2', 'admin', '/dia-d.html#logistica'),
  pc('t-vehiculos', 'admin', '/dia-d.html#transporte', { antes: (p) => p.desplazar('texto:+ Nuevo vehículo'), resaltar: ['texto:+ Nuevo vehículo'] }),
  pc('t-conductores', 'admin', '/dia-d.html#transporte', { antes: (p) => p.desplazar('texto:+ Nuevo conductor'), resaltar: ['texto:+ Nuevo conductor'] }),
  pc('t-logistica-plan', 'admin', '/dia-d.html#logistica', { antes: (p) => p.desplazar('texto:Agregar ítem'), resaltar: ['texto:Agregar ítem'] }),
  pc('t-config-puestos', 'admin', '/configuracion.html#diad'),
  pc('t-cobertura', 'admin', '/configuracion.html#diad', { antes: (p) => p.desplazar('texto:Avisar a todos'), resaltar: ['texto:Avisar a todos'] }),

  // ------------------------------------------------------------------------------------------------ escritorio: administración
  pc('mod-usuarios', 'admin', '/configuracion.html#usuarios'),
  pc('t-usuarios', 'admin', '/configuracion.html#usuarios', { resaltar: ['texto:+ Crear usuario'] }),
  pc('mod-configuracion', 'admin', '/configuracion.html#campana', { alto: 700 }),
  pc('t-permisos', 'admin', '/configuracion.html#permisos'),
  pc('t-permisos-administrativo', 'admin', '/configuracion.html#permisos', { resaltar: ['texto:Guardar cambios'] }),
  pc('t-campana-datos', 'admin', '/configuracion.html#campana', { antes: (p) => p.desplazar('texto:Guardar'), resaltar: ['texto:Guardar'] }),
  pc('t-eliminar', 'admin', '/configuracion.html#eliminar'),
  pc('t-backup', 'admin', '/configuracion.html#backup'),
];
