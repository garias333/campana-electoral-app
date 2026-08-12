const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { invalidarCache: invalidarCacheComunicaciones } = require('../config/comunicacionesConfig');
const { registrarAuditoria } = require('../config/auditoria');
const { verificarPasswordAdmin, validarTelefono10Digitos } = require('../config/verificaciones');
const { estadoCanal: estadoCanalSms, enviarSMS } = require('../config/sms');
const { estadoCanal: estadoCanalSendgrid, enviarCorreoMasivo } = require('../config/sendgrid');

const router = express.Router();
router.use(requireAuth);

const CARGOS_VALIDOS = ['senado', 'camara_representantes', 'gobernacion', 'asamblea', 'alcaldia', 'concejo', 'jal'];

/**
 * Qué apoyos puede ofrecer una campaña según el cargo al que aspira.
 *
 * Una campaña municipal (Alcaldía/Concejo/JAL) puede apoyarse en
 * estructuras de cualquier nivel, así que ve las cinco. Una departamental
 * (Gobernación/Asamblea) solo tiene sentido con las dos de su nivel: no va
 * a pedirle a su gente que apoye a un concejo en particular, porque su
 * territorio abarca muchos municipios.
 *
 * Senado y Cámara no usan esta función: su campaña no ofrece apoyos y la
 * sección no se muestra.
 */
const APOYOS_POR_CARGO = {
  alcaldia: ['alcaldia', 'concejo', 'jal', 'gobernacion', 'asamblea'],
  concejo:  ['alcaldia', 'concejo', 'jal', 'gobernacion', 'asamblea'],
  jal:      ['alcaldia', 'concejo', 'jal', 'gobernacion', 'asamblea'],
  gobernacion: ['gobernacion', 'asamblea'],
  asamblea:    ['gobernacion', 'asamblea']
};

/** Los apoyos permitidos para un cargo, o lista vacía si ese cargo no ofrece apoyos. */
function apoyosPermitidos(cargo) {
  return APOYOS_POR_CARGO[cargo] || [];
}

/**
 * ¿La campaña tiene gente registrada en cada nivel territorial?
 *
 * PARA QUÉ
 *   Las tablas de listado muestran dos columnas COMBINADAS —«Comuna /
 *   Corregimiento» y «Barrio / Vereda»—, y la campaña puede haber apagado
 *   comunas o barrios en Configuración. Con estas banderas la tabla puede
 *   quitar el término que no se usa y esconder la columna solo cuando de
 *   verdad no hay nada que mostrar.
 *
 * POR QUÉ CUATRO Y NO DOS
 *   Cada columna tiene dos mitades y hay que preguntar por las dos. En la
 *   campaña departamental de prueba no hay ni un barrio, pero sí hay 82
 *   personas asignadas a veredas: ocultar «Barrio / Vereda» por la primera
 *   mitad habría escondido la segunda, que es la única que tiene datos.
 *   Es la misma trampa que ya obligó a NO ocultar esos campos en los
 *   formularios de residencia.
 *
 * POR QUÉ AQUÍ Y NO EN EL NAVEGADOR
 *   Las tablas van paginadas. Mirar solo lo pintado haría que la columna
 *   apareciera en la página 3 y no en la 1, que es peor que cualquiera de
 *   las dos opciones. Esto se pregunta una vez, contra toda la base.
 *
 * El nivel se deduce del ÁRBOL de territorios, no de una columna de texto:
 * un votante «de la comuna 5» es en realidad un votante de un barrio cuyo
 * padre es esa comuna, que es como lo arma el listado (`padre.nombre AS
 * pertenece`).
 *
 * PERO HAY UNA SEGUNDA FUENTE, Y NO ES EL ÁRBOL
 *   `usuarios.barrio_residencia` y `usuarios.comuna_corregimiento_residencia`
 *   son TEXTO LIBRE, y la tabla de Asistentes a reuniones los usa como
 *   respaldo cuando la persona no tiene territorio
 *   (`COALESCE(tv.nombre, u.barrio_residencia)` en eventos.routes.js).
 *   Sin mirarlos, una campaña con residencias escritas a mano y sin
 *   territorios asignados daría «no hay datos» y la columna se escondería
 *   **con datos adentro**. Medido el 8 de agosto de 2026: la campaña
 *   departamental de prueba tiene 34 usuarios así.
 *
 *   Ese texto no se puede repartir entre barrio y vereda —es un solo campo
 *   combinado—, así que va en banderas aparte y solo cuenta para decidir si
 *   la columna se muestra.
 */
async function hayDatosPorNivel() {
  const porArbol = (tabla, tipo) =>
    `EXISTS(SELECT 1 FROM ${tabla} x
              JOIN territorios t ON t.id = x.territorio_id
              LEFT JOIN territorios p ON p.id = t.padre_id
             WHERE t.tipo = '${tipo}' OR p.tipo = '${tipo}')`;
  const porTerritorio = (tabla, tipo) =>
    `EXISTS(SELECT 1 FROM ${tabla} x
              JOIN territorios t ON t.id = x.territorio_id
             WHERE t.tipo = '${tipo}')`;

  // Comuna y corregimiento se buscan también en el padre (quien vive en un
  // barrio pertenece a la comuna de ese barrio); barrio y vereda son el
  // territorio mismo.
  const conTexto = (columna) =>
    `EXISTS(SELECT 1 FROM usuarios WHERE ${columna} IS NOT NULL AND ${columna} <> '')`;

  const [filas] = await pool.query(`
    SELECT ${porArbol('votantes', 'comuna')}        OR ${porArbol('estructura', 'comuna')}        AS comuna,
           ${porArbol('votantes', 'corregimiento')} OR ${porArbol('estructura', 'corregimiento')} AS corregimiento,
           ${porTerritorio('votantes', 'barrio')}   OR ${porTerritorio('estructura', 'barrio')}   AS barrio,
           ${porTerritorio('votantes', 'vereda')}   OR ${porTerritorio('estructura', 'vereda')}   AS vereda,
           ${conTexto('comuna_corregimiento_residencia')}                                         AS comuna_texto,
           ${conTexto('barrio_residencia')}                                                       AS barrio_texto`);
  const f = filas[0] || {};
  return {
    comuna: !!f.comuna, corregimiento: !!f.corregimiento,
    barrio: !!f.barrio, vereda: !!f.vereda,
    comunaTexto: !!f.comuna_texto, barrioTexto: !!f.barrio_texto,
  };
}

router.get('/campana', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM configuracion_campana WHERE id = 1`);
    const cfg = rows[0] || {};
    // La regla de qué apoyos aplican vive en el servidor; el frontend solo
    // pinta lo que le llega. Así no hay dos copias que se puedan separar.
    cfg.apoyos_posibles = apoyosPermitidos(cfg.cargo_aspira);

    // Si esto falla, se responde que SÍ hay datos en todos los niveles: la
    // tabla muestra las columnas y no se esconde nada. Fallar mostrando de
    // más es molesto; fallar escondiendo deja datos invisibles sin que nadie
    // se entere. Y `territorios` es una vista sobre OTRA base (el catálogo),
    // así que este es el punto de la configuración que más fácil se cae.
    try {
      const hay = await hayDatosPorNivel();
      cfg.hay_datos_comuna = hay.comuna;
      cfg.hay_datos_corregimiento = hay.corregimiento;
      cfg.hay_datos_barrio = hay.barrio;
      cfg.hay_datos_vereda = hay.vereda;
      cfg.hay_datos_comuna_texto = hay.comunaTexto;
      cfg.hay_datos_barrio_texto = hay.barrioTexto;
    } catch (errNiveles) {
      console.error('No se pudo averiguar qué niveles territoriales tienen datos:', errNiveles.message);
      cfg.hay_datos_comuna = true;
      cfg.hay_datos_corregimiento = true;
      cfg.hay_datos_barrio = true;
      cfg.hay_datos_vereda = true;
      cfg.hay_datos_comuna_texto = true;
      cfg.hay_datos_barrio_texto = true;
    }

    res.json(cfg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo la configuración de la campaña.' });
  }
});

/**
 * Qué apoyos aplicarían para un cargo dado. Lo usa la pantalla de
 * Configuración cuando se cambia el Cargo al que aspira, para rearmar las
 * casillas sin tener que guardar primero — y sin repetir la regla en el
 * navegador, donde se podría quedar desactualizada.
 */
router.get('/apoyos-posibles', requireRole('admin'), (req, res) => {
  res.json({ apoyos: apoyosPermitidos(String(req.query.cargo || '')) });
});

// Crea o actualiza (upsert) el registro único de configuración. Solo admin.
router.put('/campana', requireRole('admin'), async (req, res) => {
  const {
    nombre_candidato, cargo_aspira, slogan_campana, partido_politico,
    departamento, ciudad, direccion_sede, telefono, email,
    territorio_departamento, territorio_ciudad, fecha_eleccion, ciudad_tiene_comunas,
    usar_nombre_barrios, password_ciudad_comunas, password_usar_barrios,
    apoyos_activos
  } = req.body;

  if (cargo_aspira && !CARGOS_VALIDOS.includes(cargo_aspira)) {
    return res.status(400).json({ error: 'Cargo al que aspira no válido.' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'El correo electrónico no es válido.' });
  }
  if (!validarTelefono10Digitos(telefono)) {
    return res.status(400).json({ error: 'Error de digitación: el teléfono debe tener 10 dígitos.' });
  }

  // Los apoyos se filtran contra lo que el cargo permite en vez de
  // confiar en lo que llegue: si alguien cambia el cargo a Gobernación,
  // los apoyos municipales que hubiera marcado antes dejan de ser válidos
  // y no deben quedarse guardados.
  let apoyosFinal = null;
  if (apoyos_activos !== undefined) {
    const permitidos = apoyosPermitidos(cargo_aspira);
    const pedidos = Array.isArray(apoyos_activos) ? apoyos_activos : [];
    apoyosFinal = apoyos_activos === null ? null : pedidos.filter(a => permitidos.includes(a));
  }

  const aBooleano = (valor) => (valor === false || valor === 0 || valor === '0' ? 0 : 1);
  const ciudadTieneComunasFinal = aBooleano(ciudad_tiene_comunas);
  const usarNombreBarriosFinal = aBooleano(usar_nombre_barrios);

  try {
    // "¿Utilizar nombre de comunas?" / "¿Utilizar nombre de barrios?"
    // cambian cómo se ven los campos Comuna/Barrio en 5 formularios
    // distintos de captura — cambiar cualquiera de las dos exige la
    // contraseña de un administrador como confirmación extra, además del
    // rol admin que ya exige toda esta pantalla.
    const [[actual]] = await pool.query(`SELECT ciudad_tiene_comunas, usar_nombre_barrios FROM configuracion_campana WHERE id = 1`);
    const comunasActual = actual ? Number(actual.ciudad_tiene_comunas) : 1;
    const barriosActual = actual ? Number(actual.usar_nombre_barrios) : 1;

    if (ciudadTieneComunasFinal !== comunasActual) {
      const autorizado = await verificarPasswordAdmin(password_ciudad_comunas);
      if (!autorizado) {
        return res.status(403).json({ error: 'Contraseña de administrador incorrecta. No se guardó el cambio de "¿Utilizar nombre de comunas?".' });
      }
    }
    if (usarNombreBarriosFinal !== barriosActual) {
      const autorizado = await verificarPasswordAdmin(password_usar_barrios);
      if (!autorizado) {
        return res.status(403).json({ error: 'Contraseña de administrador incorrecta. No se guardó el cambio de "¿Utilizar nombre de barrios?".' });
      }
    }

    await pool.query(
      `INSERT INTO configuracion_campana
         (id, nombre_candidato, cargo_aspira, slogan_campana, partido_politico, departamento, ciudad, direccion_sede, telefono, email,
          territorio_departamento, territorio_ciudad, fecha_eleccion, ciudad_tiene_comunas, usar_nombre_barrios, apoyos_activos, actualizado_por)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         nombre_candidato = VALUES(nombre_candidato),
         cargo_aspira = VALUES(cargo_aspira),
         slogan_campana = VALUES(slogan_campana),
         partido_politico = VALUES(partido_politico),
         departamento = VALUES(departamento),
         ciudad = VALUES(ciudad),
         direccion_sede = VALUES(direccion_sede),
         telefono = VALUES(telefono),
         email = VALUES(email),
         territorio_departamento = VALUES(territorio_departamento),
         territorio_ciudad = VALUES(territorio_ciudad),
         fecha_eleccion = VALUES(fecha_eleccion),
         ciudad_tiene_comunas = VALUES(ciudad_tiene_comunas),
         usar_nombre_barrios = VALUES(usar_nombre_barrios),
         apoyos_activos = VALUES(apoyos_activos),
         actualizado_por = VALUES(actualizado_por)`,
      [nombre_candidato || null, cargo_aspira || null, (slogan_campana || '').trim() || null, partido_politico || null,
       departamento || null, ciudad || null, direccion_sede || null, telefono ? telefono.replace(/\D/g, '') : null, email || null,
       territorio_departamento || null, territorio_ciudad || null, fecha_eleccion || null,
       ciudadTieneComunasFinal, usarNombreBarriosFinal,
       apoyosFinal === null ? null : JSON.stringify(apoyosFinal),
       req.session.usuario.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error guardando la configuración de la campaña.' });
  }
});

// Enmascara un secreto para mostrarlo en la interfaz sin exponerlo por
// completo — solo se ven los últimos 4 caracteres, el resto queda como
// puntos. Sirve para que el admin pueda confirmar "sí, algo hay
// guardado ahí" sin que el valor completo viaje de vuelta al navegador.
function enmascarar(valor) {
  if (!valor) return null;
  const texto = String(valor);
  if (texto.length <= 4) return '••••';
  return '••••••••' + texto.slice(-4);
}

// Verifica la contraseña de administrador para DESBLOQUEAR la pantalla de
// Configurar CRM (candado extra, además del rol admin que ya exigen los
// otros endpoints de /comunicaciones) — no guarda ni cambia nada, solo
// confirma la contraseña.
router.post('/comunicaciones/verificar-acceso', requireRole('admin'), async (req, res) => {
  try {
    const autorizado = await verificarPasswordAdmin(req.body && req.body.password);
    if (!autorizado) {
      return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error verificando la contraseña de administrador.' });
  }
});

// Trae la configuración de Comunicaciones (SendGrid + Twilio). Los
// campos secretos (API Key, Auth Token) viajan ENMASCARADOS — nunca se
// manda el valor completo de vuelta al navegador una vez guardado.
router.get('/comunicaciones', requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM configuracion_comunicaciones WHERE id = 1`);
    const fila = rows[0] || {};
    res.json({
      sendgrid_api_key_mascara: enmascarar(fila.sendgrid_api_key),
      sendgrid_from: fila.sendgrid_from || '',
      sendgrid_from_name: fila.sendgrid_from_name || '',
      twilio_account_sid_mascara: enmascarar(fila.twilio_account_sid),
      twilio_auth_token_mascara: enmascarar(fila.twilio_auth_token),
      twilio_sms_from: fila.twilio_sms_from || ''
      // twilio_whatsapp_from no se devuelve: el canal está desactivado
      // (Meta prohíbe las campañas políticas en su API de negocios) y la
      // pantalla ya no tiene ese campo. La columna sigue en la base.
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo la configuración de comunicaciones.' });
  }
});

// Guarda (upsert) la configuración de Comunicaciones. Solo admin.
//
// Para los campos secretos (sendgrid_api_key, twilio_account_sid,
// twilio_auth_token): si llegan vacíos o sin cambios, se CONSERVA lo que
// ya había guardado — así el formulario no obliga a re-escribir la clave
// completa cada vez que se edita solo, por ejemplo, el número de SMS.
// Para reemplazar un secreto, basta con escribir el valor nuevo.
router.put('/comunicaciones', requireRole('admin'), async (req, res) => {
  // twilio_whatsapp_from NO se lee del body a propósito: el canal está
  // desactivado y nadie debe poder configurarlo, ni siquiera llamando a
  // esta API directo. El valor que ya estuviera guardado se conserva.
  const {
    sendgrid_api_key, sendgrid_from, sendgrid_from_name,
    twilio_account_sid, twilio_auth_token, twilio_sms_from
  } = req.body;

  try {
    const [rows] = await pool.query(`SELECT * FROM configuracion_comunicaciones WHERE id = 1`);
    const actual = rows[0] || {};

    const valores = {
      sendgrid_api_key: (sendgrid_api_key && sendgrid_api_key.trim()) ? sendgrid_api_key.trim() : (actual.sendgrid_api_key || null),
      sendgrid_from: sendgrid_from !== undefined ? (sendgrid_from.trim() || null) : (actual.sendgrid_from || null),
      sendgrid_from_name: sendgrid_from_name !== undefined ? (sendgrid_from_name.trim() || null) : (actual.sendgrid_from_name || null),
      twilio_account_sid: (twilio_account_sid && twilio_account_sid.trim()) ? twilio_account_sid.trim() : (actual.twilio_account_sid || null),
      twilio_auth_token: (twilio_auth_token && twilio_auth_token.trim()) ? twilio_auth_token.trim() : (actual.twilio_auth_token || null),
      twilio_sms_from: twilio_sms_from !== undefined ? (twilio_sms_from.trim() || null) : (actual.twilio_sms_from || null),
      twilio_whatsapp_from: actual.twilio_whatsapp_from || null
    };

    await pool.query(
      `INSERT INTO configuracion_comunicaciones
         (id, sendgrid_api_key, sendgrid_from, sendgrid_from_name,
          twilio_account_sid, twilio_auth_token, twilio_sms_from, twilio_whatsapp_from, actualizado_por)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         sendgrid_api_key = VALUES(sendgrid_api_key),
         sendgrid_from = VALUES(sendgrid_from),
         sendgrid_from_name = VALUES(sendgrid_from_name),
         twilio_account_sid = VALUES(twilio_account_sid),
         twilio_auth_token = VALUES(twilio_auth_token),
         twilio_sms_from = VALUES(twilio_sms_from),
         twilio_whatsapp_from = VALUES(twilio_whatsapp_from),
         actualizado_por = VALUES(actualizado_por)`,
      [valores.sendgrid_api_key, valores.sendgrid_from, valores.sendgrid_from_name,
       valores.twilio_account_sid, valores.twilio_auth_token, valores.twilio_sms_from, valores.twilio_whatsapp_from,
       req.session.usuario.id]
    );

    invalidarCacheComunicaciones();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error guardando la configuración de comunicaciones.' });
  }
});

// Estado de cada canal, para que la pantalla de configuración diga si
// Email y SMS están listos SIN tener que esperar a que falle una campaña.
//
// No calcula nada por su cuenta: reutiliza las mismas funciones que ya
// usa el CRM (estadoCanal de sendgrid.js y estadoCanales de twilio.js),
// para que la pantalla y el envío real nunca puedan discrepar.
router.get('/comunicaciones/estado', requireRole('admin'), async (req, res) => {
  try {
    const [email, sms] = await Promise.all([estadoCanalSendgrid(), estadoCanalSms()]);
    res.json({ email, sms });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando el estado de los canales.' });
  }
});

// Envío de prueba. Existe por un incidente real: un número de Twilio
// guardado con espacios hacía que el SMS nunca saliera, y la pantalla
// mostraba el canal como configurado — el fallo solo se descubría cuando
// una campaña entera no llegaba. Aquí el error de Twilio o SendGrid se
// devuelve TAL CUAL, sin envolverlo en un mensaje genérico, porque es
// justo el dato que hacía falta para diagnosticar.
//
// ESTO ENVÍA DE VERDAD: gasta saldo de la cuenta de Twilio y el mensaje
// llega al destinatario. Por eso exige admin y va detrás del candado de
// contraseña que ya protege esta pantalla.
router.post('/comunicaciones/probar', requireRole('admin'), async (req, res) => {
  const { canal, destino } = req.body || {};
  if (canal !== 'email' && canal !== 'sms') {
    return res.status(400).json({ error: 'Canal no válido. Debe ser "email" o "sms".' });
  }
  if (!destino || !String(destino).trim()) {
    return res.status(400).json({ error: 'Falta a dónde enviar la prueba.' });
  }

  const cuando = new Date().toLocaleString('es-CO');
  try {
    if (canal === 'email') {
      await enviarCorreoMasivo(
        String(destino).trim(),
        'Prueba de configuración — Mensajería',
        `Este es un mensaje de prueba enviado desde Configurar mensajería el ${cuando}.\n\n`
        + 'Si lo estás leyendo, las credenciales de SendGrid y el remitente quedaron bien configurados.'
      );
    } else {
      // `operativo: true`: es una prueba que un administrador se manda a sí
      // mismo desde la pantalla de configuración, no mensajería de campaña.
      // Consume crédito, como cualquier SMS.
      await enviarSMS(
        String(destino).trim(),
        `Prueba de configuracion de mensajeria (${cuando}). Si recibiste esto, el canal SMS quedo bien configurado.`,
        null,
        { origen: 'prueba', operativo: true, usuarioId: req.session.usuario.id }
      );
    }
    // El envío quedó registrado en auditoría igual que cualquier otro
    // cambio sensible: envía a un destinatario real y cuesta dinero.
    await registrarAuditoria(
      req.session.usuario.id, 'comunicaciones_prueba', 'configuracion', null,
      `Envío de prueba por ${canal === 'email' ? 'correo' : 'SMS'} a ${String(destino).trim()}.`, req.ip
    );
    res.json({ ok: true, mensaje: `Mensaje de prueba enviado por ${canal === 'email' ? 'correo' : 'SMS'} a ${String(destino).trim()}.` });
  } catch (err) {
    console.error('Prueba de mensajería falló:', err);
    res.status(400).json({ error: err.message || 'No se pudo enviar el mensaje de prueba.' });
  }
});

// --- Eliminar información (submenú de Configuración) ---
//
// Cada "área" corresponde a la información que la campaña ha ido
// registrando en un módulo de la aplicación — NO borra catálogos ni
// configuración del sistema (usuarios, roles, territorios, categorías de
// finanzas, permisos, configuración de la campaña), solo los REGISTROS
// que se han ido cargando. Las tablas hijas (asistentes de eventos,
// envíos de CRM, subordinados de organigrama) se borran solas por el
// ON DELETE CASCADE ya definido en el esquema.
const AREAS_ELIMINABLES = {
  estructura_territorial: { etiqueta: 'Estructura territorial', tablas: ['estructura'] },
  votantes: { etiqueta: 'Votantes y sublíderes', tablas: ['votantes'] },
  organigrama: { etiqueta: 'Organigrama', tablas: ['organigrama_nodos'] },
  eventos: { etiqueta: 'Eventos y agenda', tablas: ['eventos'] },
  finanzas: { etiqueta: 'Finanzas (movimientos registrados)', tablas: ['finanzas_movimientos'] },
  redes: { etiqueta: 'Redes y Opinión (publicaciones y menciones)', tablas: ['redes_publicaciones', 'monitoreo_menciones'] },
  recursos: { etiqueta: 'Información para compartir (Recursos)', tablas: ['recursos'] },
  crm_historial: { etiqueta: 'CRM y mensajería (historial de campañas y envíos)', tablas: ['comunicaciones_campanas'] }
};

// Lista las áreas disponibles para eliminar (solo admin) — el frontend
// arma los botones a partir de esta lista, así los nombres y el orden
// quedan controlados desde un solo lugar.
router.get('/areas-eliminables', requireRole('admin'), (req, res) => {
  const areas = Object.entries(AREAS_ELIMINABLES).map(([clave, def]) => ({ clave, etiqueta: def.etiqueta }));
  res.json(areas);
});

// Elimina TODOS los registros de un área — acción irreversible, exige
// contraseña de administrador (verificada de nuevo aquí, no basta con
// haber entrado a la pantalla con el candado ya abierto).
router.delete('/eliminar-datos/:area', requireRole('admin'), async (req, res) => {
  const definicion = AREAS_ELIMINABLES[req.params.area];
  if (!definicion) {
    return res.status(404).json({ error: 'Esa área no existe o no se puede eliminar desde acá.' });
  }
  const autorizado = await verificarPasswordAdmin(req.body && req.body.password);
  if (!autorizado) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }
  try {
    let eliminadas = 0;
    for (const tabla of definicion.tablas) {
      const [resultado] = await pool.query(`DELETE FROM ${tabla}`);
      eliminadas += resultado.affectedRows;
    }
    await registrarAuditoria(
      req.session.usuario.id, 'eliminar_datos_area', 'configuracion', null,
      `Eliminó todos los registros del área "${definicion.etiqueta}" (${eliminadas} registros).`, req.ip
    );
    res.json({ ok: true, eliminadas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error eliminando la información de "${definicion.etiqueta}".` });
  }
});

module.exports = router;
