/**
 * EL ROL «candidato» (orden 70): el candidato principal ve TODA la campaña desde el celular y no cambia nada.
 *
 * Archivo de datos puros (sin conexión a la base), como config/importarExportar.js: lo leen la siembra de db/init-db.js, la matriz de «Asignación de
 * permisos» (routes/permisos.routes.js) y el middleware que bloquea las escrituras (middleware/soloLecturaCandidato.js). Una sola lista en tres sitios.
 *
 * SOLO LECTURA SE IMPONE EN EL SERVIDOR, NO ESCONDIENDO BOTONES: todo POST/PUT/PATCH/DELETE de un candidato responde 403 salvo las EXCEPCIONES de abajo.
 */
'use strict';

const ROL_CANDIDATO = 'candidato';

/**
 * Módulos de la matriz en los que el candidato nace con «Ver». Todos son de consulta. Quedan fuera: finanzas, configuracion, usuarios, crm,
 * enviar_email, enviar_sms, enviar_push, configurar_crm, recordatorios, puerta_visitas, transporte/logística (datos de conductores) y
 * los módulos que listan PERSONAS con cédula o teléfono (votantes, testigos, territorial…): esos datos NO le llegan al candidato por ninguna ruta.
 *
 * Los tres primeros de MODULOS_SOLO_APP no tienen pantalla de escritorio para él: los lee su app del celular (/api/candidato/*), que los muestra
 * solo si el administrador los deja encendidos aquí y el complemento está activo en la campaña.
 */
const MODULOS_VER_CANDIDATO = [
  'panel_general', 'rescate_votos', 'solicitudes', 'tareas', 'puerta_listas',
  'legislacion', 'recursos', 'biografia_candidato', 'politica_privacidad',
];
/** Módulos que el candidato tiene en la matriz pero que NO se le ofrecen en el menú del computador (su pantalla de escritorio le respondería 403). */
const MODULOS_SOLO_APP = ['rescate_votos', 'solicitudes', 'tareas', 'puerta_listas'];

/**
 * LO QUE UN CANDIDATO PUEDE LEER (GET). Lista de lo que SÍ pasa, relativa a /api; un prefijo vale para todo lo que cuelga de él.
 * Todo lo demás —listas de votantes, usuarios, estructura, testigos, finanzas, comunicaciones, configuración— le responde 403, aunque una ruta
 * futura se olvide de cerrarlo: así un módulo nuevo nace cerrado para él. Las rutas de /api/candidato acotan solas lo que devuelven (nada de
 * finanzas ni de cédulas); /dashboard es el panel general de escritorio (requiereVerModulo('panel_general')), que no trae finanzas para este rol.
 */
const LECTURAS_PERMITIDAS = [
  '/auth', '/csrf-token', '/permisos/mios', '/candidato',
  '/dashboard/resumen', '/dashboard/tendencia-registros', '/dashboard/tabla-posiciones',
  '/configuracion/campana', '/configuracion/marca',
  '/legislacion', '/recursos', '/contenido',
];

function lecturaPermitida(ruta) {
  const r = String(ruta || '');
  return LECTURAS_PERMITIDAS.some((p) => r === p || r.startsWith(p + '/'));
}

/**
 * LO ÚNICO QUE UN CANDIDATO PUEDE ESCRIBIR. Rutas (relativas a /api) y método. Es la lista de lo que deja entrar, cambiar su propia clave y salir:
 *   · el ingreso y su segundo paso (código de verificación, elegir con qué sombrero entra);
 *   · cerrar sesión (también el cierre pendiente de cuando se cerró sin señal);
 *   · comprobar su propia clave, cambiarla (la de siempre y la de 6 dígitos del celular) y la verificación en dos pasos de su cuenta.
 * Los «equipos autorizados» no tienen ruta propia: se comprueban DENTRO de POST /auth/login, así que no hace falta abrirlos aparte.
 */
const ESCRITURAS_PERMITIDAS = [
  ['POST', '/auth/login'],
  ['POST', '/auth/login-celular'],
  ['POST', '/auth/login-coordinador'],
  ['POST', '/auth/elegir-rol'],
  ['POST', '/auth/solicitar-codigo'],
  ['POST', '/auth/verificar-2fa'],
  ['PUT',  '/auth/2fa'],
  ['POST', '/auth/cerrar-pendiente'],
  ['POST', '/auth/logout'],
  ['POST', '/auth/verificar-password'],
  ['POST', '/auth/cambiar-password'],
  ['POST', '/auth/clave-celular/primera'],
  ['POST', '/auth/cambiar-clave-celular'],
  ['POST', '/auth/olvidar-password'],
  ['POST', '/auth/resetear-password'],
];

/** ¿Puede un candidato hacer esta escritura? `ruta` es req.path dentro de /api. */
function escrituraPermitida(metodo, ruta) {
  const m = String(metodo || '').toUpperCase();
  const r = String(ruta || '').replace(/\/+$/, '') || '/';
  return ESCRITURAS_PERMITIDAS.some(([mm, rr]) => mm === m && rr === r);
}

module.exports = { ROL_CANDIDATO, MODULOS_VER_CANDIDATO, MODULOS_SOLO_APP, LECTURAS_PERMITIDAS, lecturaPermitida, ESCRITURAS_PERMITIDAS, escrituraPermitida };
