const express = require('express');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { requireAuth, requireRole, calcularAlcance } = require('../middleware/auth');
const { esSuperadmin } = require('../config/superadmin');
const { alcanceEventos, veContactos } = require('../lib/alcanceEventos');
const { requiereImportarExportar } = require('../middleware/permisoModulo');
const { geocodificarConTerritorio } = require('../config/geoTerritorio');
const { armarWhereSql } = require('../config/filtros');
const { registrarAuditoria, registrarAuditoriaEn } = require('../config/auditoria');
const { verificarPasswordAdmin } = require('../config/verificaciones');
const Asis = require('../lib/asistenciaEventos');
const { limiteBuscarCedula } = require('../lib/busquedaCedula');
const { normalizarCedula, buscarFichaPorCedula } = require('../lib/normalizarCedula');
const { condicionAlcanceVotantes, parametrosAlcanceVotantes } = require('../lib/alcanceVotantes');

const router = express.Router();
router.use(requireAuth, calcularAlcance);
const json = express.json({ limit: '20kb' });

/* EL PERMISO DEL MÓDULO, EN EL SERVIDOR, Y EL ALCANCE (parche 305). Hasta el 304 este archivo solo pedía sesión: cualquier rol con cuenta
   listaba todos los eventos y leía nombre, teléfono y cédula de todos los asistentes. Ahora:
     · hace falta «Ver» en alguno de los módulos cuyas pantallas llaman a esta API (eventos, agenda y asistentes_reuniones); el
       administrador y el superadministrador pasan siempre. Falla CERRADO.
     · cada ruta acota con lib/alcanceEventos.js; un evento fuera del alcance responde igual que uno que no existe (404).
     · el teléfono y la cédula de los asistentes solo los ve el administrador y el responsable del evento. */
const MODULOS_DE_EVENTOS = ['eventos', 'agenda', 'asistentes_reuniones'];
function permisoVer(modulos) {
  return async (req, res, next) => {
    const u = req.session.usuario;
    try {
      if (u.rol === 'admin' || await esSuperadmin(u)) return next();
      const [filas] = await pool.query('SELECT 1 FROM permisos_rol WHERE rol = ? AND modulo IN (?) AND permitido = 1 LIMIT 1', [u.rol, modulos]);
      if (filas.length) return next();
      return res.status(403).json({ error: 'Su tipo de usuario no tiene acceso a esta sección. Si lo necesita, pídaselo al administrador de la campaña.' });
    } catch (err) {
      console.error('[eventos] No se pudo comprobar el permiso:', err.code || err.message);
      return res.status(403).json({ error: 'No se pudo comprobar su permiso, y por seguridad se negó. Vuelva a intentarlo.' });
    }
  };
}
router.use(permisoVer(MODULOS_DE_EVENTOS));
const verAsistentes = permisoVer(['eventos', 'asistentes_reuniones']);
const verConsolidado = permisoVer(['asistentes_reuniones']);

/** El evento SI está en el alcance de quien pregunta (`soloGestion`: para escribir, sin los eventos a los que solo está invitado). */
async function eventoEnAlcance(req, id, soloGestion = false) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  const a = alcanceEventos(req.alcance, 'e', soloGestion);
  const [[fila]] = await pool.query(`SELECT e.* FROM eventos e WHERE e.id = ? AND ${a.sql}`, [n, ...a.valores]);
  return fila || null;
}
/** La fila de asistente cuyo evento puede GESTIONAR quien pregunta, o null. */
async function asistenteGestionable(req, asistenteId) {
  const n = Number(asistenteId);
  if (!Number.isInteger(n) || n < 1) return null;
  const [[a]] = await pool.query('SELECT evento_id FROM evento_asistentes WHERE id = ?', [n]);
  return a ? eventoEnAlcance(req, a.evento_id, true) : null;
}
const NO_ES_SUYO = { error: 'Ese evento no existe o no es de su equipo.' };

router.get('/', async (req, res) => {
  const { desde, hasta, tipo, territorio_id } = req.query;
  const condiciones = [];
  const params = [];
  if (desde) { condiciones.push('e.fecha_inicio >= ?'); params.push(desde); }
  if (hasta) { condiciones.push('e.fecha_inicio <= ?'); params.push(hasta); }
  if (tipo) { condiciones.push('e.tipo = ?'); params.push(tipo); }
  if (territorio_id) { condiciones.push('e.territorio_id = ?'); params.push(territorio_id); }
  const alcanceE = alcanceEventos(req.alcance, 'e');
  condiciones.push(alcanceE.sql); params.push(...alcanceE.valores);
  const whereSql = armarWhereSql(condiciones);

  try {
    const [rows] = await pool.query(
      `SELECT e.*, t.nombre AS territorio_nombre, u.nombre AS responsable_nombre,
              coord.nombre AS coordinador_nombre, lid.nombre AS lider_nombre,
              (SELECT COUNT(*) FROM evento_asistentes ea WHERE ea.evento_id = e.id) AS total_invitados,
              (SELECT COUNT(*) FROM evento_asistentes ea WHERE ea.evento_id = e.id AND ea.asistio = 1) AS total_asistio
       FROM eventos e
       LEFT JOIN territorios t ON t.id = e.territorio_id
       LEFT JOIN usuarios u ON u.id = e.responsable_id
       LEFT JOIN usuarios coord ON coord.id = e.coordinador_id
       LEFT JOIN usuarios lid ON lid.id = e.lider_id
       ${whereSql}
       ORDER BY ABS(TIMESTAMPDIFF(SECOND, NOW(), e.fecha_inicio)) ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando eventos.' });
  }
});

/**
 * LOS EVENTOS DEL CELULAR (parche 313): los de hoy, los próximos y los de los últimos 7 días, dentro del MISMO alcance que `GET /` (lib/alcanceEventos.js), con sus
 * invitados reducidos a lo que el celular necesita: id, NOMBRE, BARRIO y si asistió. Nunca teléfono ni cédula —ni siquiera para el administrador o el responsable: la pantalla
 * del celular no los necesita y la copia que queda en el teléfono no debe llevarlos—, ni el correo, ni el vínculo con la ficha del votante.
 * `puede_marcar` y `puede_agregar` dicen qué botones ofrecer en cada evento (el servidor vuelve a exigirlo al recibir cada marca).
 */
const MAX_EVENTOS_MOVIL = 60, MAX_ASISTENTES_MOVIL = 600, HORAS_COPIA_EVENTOS = 48;
router.get('/movil', async (req, res) => {
  try {
    const a = alcanceEventos(req.alcance, 'e');
    const [eventos] = await pool.query(
      `SELECT e.id, e.titulo, e.tipo, DATE_FORMAT(e.fecha_inicio, '%Y-%m-%d %H:%i') AS fecha_inicio, DATE_FORMAT(e.fecha_fin, '%Y-%m-%d %H:%i') AS fecha_fin, e.lugar, e.meta_asistentes,
              (SELECT COUNT(*) FROM evento_asistentes ea WHERE ea.evento_id = e.id) AS total_invitados,
              (SELECT COUNT(*) FROM evento_asistentes ea WHERE ea.evento_id = e.id AND ea.asistio = 1) AS total_asistio
         FROM eventos e WHERE ${a.sql} AND e.fecha_inicio >= DATE_SUB(CURDATE(), INTERVAL ${Number(Asis.VENTANA_DIAS)} DAY)
        ORDER BY e.fecha_inicio ASC, e.id ASC LIMIT ${MAX_EVENTOS_MOVIL}`, a.valores);
    const ids = eventos.map((e) => e.id);
    let marcables = new Set(), asistentes = [];
    if (ids.length) {
      const sc = Asis.alcanceMarcar(req.alcance, req.session.usuario.rol, 'e');
      const [m] = await pool.query(`SELECT e.id FROM eventos e WHERE e.id IN (?) AND ${sc.sql}`, [ids, ...sc.valores]);
      marcables = new Set(m.map((f) => Number(f.id)));
      [asistentes] = await pool.query(
        `SELECT ea.id, ea.evento_id, ea.asistio, COALESCE(v.nombre, u.nombre, ea.nombre_invitado) AS nombre, COALESCE(tv.nombre, u.barrio_residencia) AS barrio
           FROM evento_asistentes ea LEFT JOIN votantes v ON v.id = ea.votante_id LEFT JOIN usuarios u ON u.id = ea.usuario_id LEFT JOIN territorios tv ON tv.id = v.territorio_id
          WHERE ea.evento_id IN (?) ORDER BY nombre ASC, ea.id ASC LIMIT ${MAX_ASISTENTES_MOVIL * MAX_EVENTOS_MOVIL}`, [ids]);
    }
    const porEvento = new Map(ids.map((id) => [id, []]));
    asistentes.forEach((f) => { const l = porEvento.get(f.evento_id); if (l && l.length < MAX_ASISTENTES_MOVIL) l.push({ id: f.id, nombre: f.nombre || '(sin nombre)', barrio: f.barrio || null, asistio: Number(f.asistio) === 1 }); });
    const agrega = Asis.ROLES_QUE_AGREGAN.includes(req.session.usuario.rol);
    res.json({
      eventos: eventos.map((e) => ({
        id: e.id, titulo: e.titulo, tipo: e.tipo, fecha_inicio: e.fecha_inicio, fecha_fin: e.fecha_fin, lugar: e.lugar, meta_asistentes: Number(e.meta_asistentes) || 0,
        total_invitados: Number(e.total_invitados), total_asistio: Number(e.total_asistio),
        puede_marcar: marcables.has(Number(e.id)), puede_agregar: agrega && marcables.has(Number(e.id)), asistentes: porEvento.get(e.id),
      })),
      config: { horas_copia: HORAS_COPIA_EVENTOS, caduca_en: new Date(Date.now() + HORAS_COPIA_EVENTOS * 3600 * 1000).toISOString() },
    });
  } catch (err) {
    console.error('[eventos] movil:', err.code || err.message);
    res.status(500).json({ error: 'Error consultando tus eventos.' });
  }
});

router.get('/:id/asistentes', verAsistentes, async (req, res) => {
  try {
    const evento = await eventoEnAlcance(req, req.params.id);
    if (!evento) return res.status(404).json(NO_ES_SUYO);
    // Un asistente puede venir de tres fuentes: un votante registrado, un
    // usuario del sistema (líder, coordinador...) sin fila propia en
    // Votantes, o un invitado escrito a mano — se resuelve un solo
    // nombre/teléfono/identidad/barrio para mostrar, sea cual sea la
    // fuente. El Barrio del votante sale de Estructura territorial (vía
    // territorio_id); el del usuario ya es texto libre en su propia ficha.
    const [rows] = await pool.query(
      `SELECT ea.*,
              COALESCE(v.nombre, u.nombre, ea.nombre_invitado) AS nombre_resuelto,
              COALESCE(v.telefono, u.telefono) AS telefono_resuelto,
              COALESCE(v.cedula, u.numero_identificacion) AS identidad_resuelta,
              COALESCE(tv.nombre, u.barrio_residencia) AS barrio_resuelto
       FROM evento_asistentes ea
       LEFT JOIN votantes v ON v.id = ea.votante_id
       LEFT JOIN usuarios u ON u.id = ea.usuario_id
       LEFT JOIN territorios tv ON tv.id = v.territorio_id
       WHERE ea.evento_id = ?`, [evento.id]
    );
    // El teléfono y la cédula: solo el administrador y el responsable del evento. Los demás reciben nombre, barrio y asistencia.
    const contactos = veContactos(req.alcance, evento);
    // ¿Quien mira puede marcar «asistió» en ESTE evento? (parche 313: el escritorio muestra el botón solo si sí). Un sublíder: solo si es responsable o está invitado.
    const sc = Asis.alcanceMarcar(req.alcance, req.session.usuario.rol, 'e');
    const [[pm]] = await pool.query(`SELECT COUNT(*) AS n FROM eventos e WHERE e.id = ? AND ${sc.sql}`, [evento.id, ...sc.valores]);
    const puedeMarcar = Number(pm.n) > 0;
    res.json(rows.map((r) => (contactos ? { ...r, contactos_visibles: true, puede_marcar: puedeMarcar } : { ...r, telefono_resuelto: null, identidad_resuelta: null, contactos_visibles: false, puede_marcar: puedeMarcar })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando los asistentes del evento.' });
  }
});

/**
 * Trae, para CADA asistencia registrada en cualquier reunión/evento, a qué
 * persona corresponde (mismo criterio de resolución que GET /:id/asistentes)
 * y la agrupa por persona — así se puede ver de un vistazo a qué reuniones
 * ha ido cada quien, y detectar quién repite. Sin cédula (un invitado
 * escrito a mano, sin votante ni usuario asociado), se agrupa por el
 * nombre ya normalizado — es la única pista de identidad que hay para esos
 * casos, así que dos invitados con el mismo nombre pueden aparecer juntos
 * aunque en la vida real sean personas distintas.
 */
async function obtenerConsolidadoAsistentes(alcance) {
  const a = alcanceEventos(alcance, 'e');
  const [filas] = await pool.query(
    `SELECT e.id AS evento_id, e.titulo AS evento_titulo, e.fecha_inicio AS evento_fecha,
            e.responsable_id AS evento_responsable_id,
            COALESCE(v.cedula, u.numero_identificacion) AS identidad_resuelta,
            COALESCE(v.nombre, u.nombre, ea.nombre_invitado) AS nombre_resuelto,
            COALESCE(v.telefono, u.telefono) AS telefono_resuelto,
            COALESCE(tv.nombre, u.barrio_residencia) AS barrio_resuelto
     FROM evento_asistentes ea
     JOIN eventos e ON e.id = ea.evento_id
     LEFT JOIN votantes v ON v.id = ea.votante_id
     LEFT JOIN usuarios u ON u.id = ea.usuario_id
     LEFT JOIN territorios tv ON tv.id = v.territorio_id
     WHERE ${a.sql}
     ORDER BY e.fecha_inicio ASC`, a.valores
  );

  const grupos = new Map();
  for (const f of filas) {
    const clave = f.identidad_resuelta || `inv:${(f.nombre_resuelto || '').trim().toLowerCase()}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        nombre: f.nombre_resuelto, identidad: f.identidad_resuelta,
        telefono: f.telefono_resuelto, barrio: f.barrio_resuelto, reuniones: [], contactos: false
      });
    }
    // Teléfono y cédula de ESTA persona: solo si quien pregunta es administrador o responsable de alguno de los eventos a los que fue.
    if (veContactos(alcance, { responsable_id: f.evento_responsable_id })) grupos.get(clave).contactos = true;
    grupos.get(clave).reuniones.push({ evento_id: f.evento_id, titulo: f.evento_titulo, fecha: f.evento_fecha });
  }

  return [...grupos.values()]
    .map(({ contactos, ...g }) => ({ ...g, ...(contactos ? {} : { identidad: null, telefono: null }), total_reuniones: g.reuniones.length }))
    .sort((a, b) => b.total_reuniones - a.total_reuniones || (a.nombre || '').localeCompare(b.nombre || ''));
}

router.get('/asistentes-consolidado', verConsolidado, async (req, res) => {
  try {
    res.json(await obtenerConsolidadoAsistentes(req.alcance));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consolidando los asistentes.' });
  }
});

router.get('/asistentes-consolidado/exportar-excel', verConsolidado, requiereImportarExportar('asistentes_reuniones'), async (req, res) => {
  try {
    const consolidado = await obtenerConsolidadoAsistentes(req.alcance);
    const columnas = ['Nombre', 'Identidad', 'Teléfono', 'Barrio', 'Total de reuniones', 'Reuniones (fecha - título)'];
    const datos = consolidado.map(p => ({
      'Nombre': p.nombre || '',
      'Identidad': p.identidad || '',
      'Teléfono': p.telefono || '',
      'Barrio': p.barrio || '',
      'Total de reuniones': p.total_reuniones,
      'Reuniones (fecha - título)': p.reuniones
        .map(r => `${new Date(r.fecha).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })} - ${r.titulo}`)
        .join('; ')
    }));
    const hoja = datos.length
      ? XLSX.utils.json_to_sheet(datos, { header: columnas })
      : XLSX.utils.aoa_to_sheet([columnas]);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Consolidado asistentes');
    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="consolidado-asistentes.xlsx"');
    await registrarAuditoria(
      req.session.usuario.id, 'exportar_excel', 'evento_asistentes', null,
      `Exportó el consolidado de asistentes a reuniones (${consolidado.length} persona(s)).`, req.ip
    );
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error exportando el consolidado de asistentes.' });
  }
});

/** Un evento, con su responsable y sus cifras. Fuera del alcance responde igual que uno que no existe. */
router.get('/:id', async (req, res) => {
  try {
    const evento = await eventoEnAlcance(req, req.params.id);
    if (!evento) return res.status(404).json(NO_ES_SUYO);
    const [[fila]] = await pool.query(
      `SELECT e.*, t.nombre AS territorio_nombre, u.nombre AS responsable_nombre, coord.nombre AS coordinador_nombre, lid.nombre AS lider_nombre,
              (SELECT COUNT(*) FROM evento_asistentes ea WHERE ea.evento_id = e.id) AS total_invitados,
              (SELECT COUNT(*) FROM evento_asistentes ea WHERE ea.evento_id = e.id AND ea.asistio = 1) AS total_asistio
         FROM eventos e LEFT JOIN territorios t ON t.id = e.territorio_id LEFT JOIN usuarios u ON u.id = e.responsable_id
         LEFT JOIN usuarios coord ON coord.id = e.coordinador_id LEFT JOIN usuarios lid ON lid.id = e.lider_id
        WHERE e.id = ?`, [evento.id]);
    res.json({ ...fila, puede_ver_contactos: veContactos(req.alcance, evento) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando el evento.' });
  }
});

router.post('/', requireRole('admin', 'coordinador', 'lider'), async (req, res) => {
  const b = req.body;
  if (!b.titulo || !b.fecha_inicio) {
    return res.status(400).json({ error: 'Título y fecha de inicio son obligatorios.' });
  }
  let eventoId;
  try {
    const [result] = await pool.query(
      `INSERT INTO eventos (titulo, descripcion, tipo, fecha_inicio, fecha_fin, lugar, departamento, ciudad,
       territorio_id, area, responsable_id, coordinador_id, lider_id, meta_asistentes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.titulo, b.descripcion || null, b.tipo || 'reunion', b.fecha_inicio, b.fecha_fin || null,
       b.lugar || null, b.departamento || null, b.ciudad || null, b.territorio_id || null, b.area || null,
       b.responsable_id || req.session.usuario.id, b.coordinador_id || null, b.lider_id || null,
       b.meta_asistentes || 0, req.session.usuario.id]
    );
    eventoId = result.insertId;
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error creando el evento.' });
  }

  // La georreferenciación del lugar de la reunión se hace después de crear
  // el evento, y nunca hace fallar la creación aunque el servicio no responda.
  const geo = await geocodificarConTerritorio(b.lugar, b.territorio_id, b.ciudad, b.departamento);
  if (geo) {
    try {
      await pool.query(
        `UPDATE eventos SET latitud = ?, longitud = ?, geocodificado_en = NOW() WHERE id = ?`,
        [geo.latitud, geo.longitud, eventoId]
      );
    } catch (err) {
      console.error('Error guardando la geocodificación del evento:', err);
    }
  }
  res.json({ ok: true, id: eventoId, geocodificado: !!geo });
});

router.put('/:id', requireRole('admin', 'coordinador', 'lider'), async (req, res) => {
  const b = req.body;
  if (!b.titulo || !b.fecha_inicio) {
    return res.status(400).json({ error: 'Título y fecha de inicio son obligatorios.' });
  }
  try {
    if (!(await eventoEnAlcance(req, req.params.id, true))) return res.status(404).json(NO_ES_SUYO);
    const [[anterior]] = await pool.query(
      `SELECT lugar, territorio_id FROM eventos WHERE id = ?`, [req.params.id]
    );

    await pool.query(
      `UPDATE eventos SET titulo=?, descripcion=?, tipo=?, fecha_inicio=?, fecha_fin=?, lugar=?,
       departamento=?, ciudad=?, territorio_id=?, area=?, responsable_id=?, coordinador_id=?, lider_id=?,
       meta_asistentes=?, estado=?
       WHERE id=?`,
      [b.titulo, b.descripcion || null, b.tipo, b.fecha_inicio, b.fecha_fin || null, b.lugar || null,
       b.departamento || null, b.ciudad || null,
       b.territorio_id || null, b.area || null, b.responsable_id || null, b.coordinador_id || null,
       b.lider_id || null, b.meta_asistentes || 0, b.estado || 'programado', req.params.id]
    );

    // Un evento movido o cancelado: sus recordatorios pendientes se cancelan (el de la fecha nueva sale con su propia hora).
    require('../lib/recordatorios').limpiarRecordatoriosDeEvento(Number(req.params.id)).catch((e) => console.error('Recordatorios (evento editado):', e.message));

    const cambioUbicacion = anterior && (
      (b.lugar || '') !== (anterior.lugar || '') ||
      Number(b.territorio_id || 0) !== Number(anterior.territorio_id || 0)
    );
    if (cambioUbicacion) {
      const geo = await geocodificarConTerritorio(b.lugar, b.territorio_id, b.ciudad, b.departamento);
      if (geo) {
        await pool.query(
          `UPDATE eventos SET latitud = ?, longitud = ?, geocodificado_en = NOW() WHERE id = ?`,
          [geo.latitud, geo.longitud, req.params.id]
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error actualizando el evento.' });
  }
});

/* QUEDA CONSTANCIA. Un evento no es una fila: es una convocatoria con su
   lista de asistentes, que se va entera en cascada
   (`evento_asistentes.evento_id`). Borrado el evento, no hay forma de saber
   quién había confirmado ni quién asistió — y esa lista es media jornada de
   trabajo de un líder.

   `affectedRows` importa aquí más de lo que parece: el código anterior
   respondía «ok» aunque el id no existiera, así que quien se equivocaba de
   fila creía haber borrado algo y no sabía cuál. Ahora un id que no está
   devuelve 404. */
router.delete('/:id', requireRole('admin', 'coordinador'), async (req, res) => {
  /* LA CONEXIÓN SE PIDE DENTRO DEL `try`. Fuera, si el pool está agotado o
     MySQL no responde, la promesa se rechaza donde no la ve ningún `catch`:
     Express 4 no envuelve los manejadores `async`, así que muere en el
     `unhandledRejection` de app.js, que solo la imprime. No se envía NINGUNA
     respuesta y el botón se queda girando hasta que corte Nginx. Antes de
     este cambio la consulta iba dentro del try y una base caída salía como un
     500 legible; había que conservarlo. */
  let conexion;
  try {
    if (!(await eventoEnAlcance(req, req.params.id, true))) return res.status(404).json(NO_ES_SUYO);
    conexion = await pool.getConnection();
    await conexion.beginTransaction();
    const [[ev]] = await conexion.query(
      `SELECT e.id, e.titulo, e.tipo, e.fecha_inicio, e.lugar, e.estado,
              r.nombre AS responsable,
              (SELECT COUNT(*) FROM evento_asistentes a WHERE a.evento_id = e.id) AS asistentes
         FROM eventos e
         LEFT JOIN usuarios r ON r.id = e.responsable_id
        WHERE e.id = ?`, [req.params.id]);
    if (!ev) {
      await conexion.rollback();
      return res.status(404).json({ error: 'Ese evento ya no existe.' });
    }

    const cuando = ev.fecha_inicio ? ` del ${new Date(ev.fecha_inicio).toISOString().slice(0, 10)}` : ', sin fecha';
    const detalle = `Eliminó el evento «${ev.titulo}»${cuando}`
      + (ev.lugar ? `, en ${ev.lugar}` : '')
      + `, en estado ${ev.estado || 'sin estado'}.`
      + ` El identificador era ${ev.id}`
      + (ev.responsable ? `; el responsable era ${ev.responsable}.` : '.')
      + (ev.asistentes > 0
          ? ` Con él se ${ev.asistentes === 1 ? 'borró 1 asistente registrado' : `borraron ${ev.asistentes} asistentes registrados`}.`
          : '');

    await registrarAuditoriaEn(
      conexion, req.session.usuario.id, 'eliminar_evento', 'eventos', ev.id,
      detalle, req.ip
    );

    /* SE COMPRUEBA `affectedRows`, y no basta con el 404 del SELECT de arriba.
       La base corre en REPEATABLE-READ —consultado—, así que ese SELECT es una
       lectura consistente que no bloquea: dos administradores en el mismo
       listado, o un doble clic, ven los dos la fila y los dos escriben su
       apunte. El segundo borra cero filas y confirmaría igual, dejando UN
       borrado con DOS apuntes, el segundo mintiendo sobre unos asistentes que
       ya no estaban. */
    const [resultado] = await conexion.query(`DELETE FROM eventos WHERE id = ?`, [req.params.id]);
    if (!resultado.affectedRows) {
      await conexion.rollback();
      return res.status(404).json({ error: 'Ese evento ya no existe.' });
    }
    await conexion.commit();
    // Sus recordatorios pendientes ya no deben salir.
    require('../lib/recordatorios').limpiarRecordatoriosDeEvento(Number(req.params.id)).catch((e) => console.error('Recordatorios (evento borrado):', e.message));
    res.json({ ok: true });
  } catch (err) {
    /* El rollback va protegido: si lo que falló fue la conexión misma —MySQL
       reiniciado, `wait_timeout`, un KILL— también lanza, y sin esto el
       `res.status(500)` de abajo no llegaría a ejecutarse nunca. */
    if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
    console.error(err);
    res.status(500).json({ error: 'Error eliminando el evento.' });
  } finally {
    if (conexion) conexion.release();
  }
});

router.post('/:id/asistentes', requireRole('admin', 'coordinador', 'lider'), async (req, res) => {
  const { votante_id, usuario_id, nombre_invitado } = req.body;
  if (!votante_id && !usuario_id && !nombre_invitado) {
    return res.status(400).json({ error: 'Debe indicar un votante existente, un usuario del sistema o el nombre del invitado.' });
  }
  try {
    if (!(await eventoEnAlcance(req, req.params.id, true))) return res.status(404).json(NO_ES_SUYO);
    const [result] = await pool.query(
      `INSERT INTO evento_asistentes (evento_id, votante_id, usuario_id, nombre_invitado) VALUES (?,?,?,?)`,
      [req.params.id, votante_id || null, usuario_id || null, nombre_invitado || null]
    );
    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error agregando el asistente.' });
  }
});

/**
 * Marca la asistencia (y, solo quien gestiona el evento, la confirmación). Cuerpo: { asistio?, confirmado?, marcado_en? }. SOLO cambia lo que llega: antes (hasta el 312)
 * este PUT escribía las dos columnas siempre, y mandar solo `asistio` habría borrado la confirmación. El sublíder solo puede marcar `asistio`.
 */
router.put('/asistentes/:asistenteId', requireRole('admin', 'coordinador', 'lider', 'sublider'), json, async (req, res) => {
  try {
    const usuario = req.session.usuario;
    const asistio = Asis.aBooleano(req.body && req.body.asistio), confirmado = Asis.aBooleano(req.body && req.body.confirmado);
    if (asistio === undefined && confirmado === undefined) return res.status(400).json({ error: 'Indica si asistió (asistio) o si confirmó (confirmado).' });
    if (usuario.rol === 'sublider' && confirmado !== undefined) return res.status(403).json({ error: 'Tu tipo de usuario solo puede marcar si la persona asistió.' });
    let r = null;
    if (asistio !== undefined) {
      r = await Asis.marcarAsistencia({ asistenteId: req.params.asistenteId, asistio, marcadoMs: Asis.capturaMs(req.body.marcado_en), usuario, alcance: req.alcance });
      if (!r) return res.status(404).json(NO_ES_SUYO);
    }
    if (confirmado !== undefined) {
      if (!(await asistenteGestionable(req, req.params.asistenteId))) return res.status(404).json(NO_ES_SUYO);
      await pool.query('UPDATE evento_asistentes SET confirmado = ? WHERE id = ?', [confirmado ? 1 : 0, req.params.asistenteId]);
    }
    if (r && !r.ignorada) {
      await registrarAuditoria(usuario.id, 'evento_asistencia', 'evento_asistentes', r.id, `Marcó ${r.asistio ? '«asistió»' : '«no asistió»'} en el evento n.º ${r.evento_id}.`, req.ip);
    }
    res.json({ ok: true, ...(r ? { asistio: r.asistio, ignorada: r.ignorada, total_invitados: r.total_invitados, total_asistio: r.total_asistio } : {}) });
  } catch (err) {
    if (err && err.estado) return res.status(err.estado).json({ error: err.mensaje });
    console.error(err);
    res.status(500).json({ error: 'Error actualizando el asistente.' });
  }
});

/**
 * La marca del CELULAR (lo que su cola sin señal sube): la misma regla que el PUT, en POST porque la cola de offline-utils.js sube con POST. Cuerpo:
 * { cliente_uuid, asistente_id, asistio, marcado_en }. Es idempotente por ser un ESTADO con el instante de captura: subirla dos veces, o fuera de orden, deja lo mismo.
 */
router.post('/asistencias', requireRole('admin', 'coordinador', 'lider', 'sublider'), json, async (req, res) => {
  try {
    const b = req.body || {};
    if (!Asis.UUID.test(String(b.cliente_uuid || '').trim())) return res.status(400).json({ error: 'Falta el identificador del registro (cliente_uuid).' });
    const asistio = Asis.aBooleano(b.asistio);
    if (asistio === undefined) return res.status(400).json({ error: 'Indica si asistió (asistio).' });
    if (b.marcado_en === undefined || b.marcado_en === null || b.marcado_en === '') return res.status(400).json({ error: 'Falta la hora en que se hizo la marca (marcado_en).' });
    const marcadoMs = Asis.capturaMs(b.marcado_en);
    const usuario = req.session.usuario;
    const r = await Asis.marcarAsistencia({ asistenteId: b.asistente_id, asistio, marcadoMs, usuario, alcance: req.alcance });
    if (!r) return res.status(404).json({ error: 'Esa persona ya no está en ese evento, o el evento no es de tu equipo.' });
    if (!r.ignorada) await registrarAuditoria(usuario.id, 'evento_asistencia', 'evento_asistentes', r.id, `Marcó ${r.asistio ? '«asistió»' : '«no asistió»'} en el evento n.º ${r.evento_id} (desde el celular).`, req.ip);
    res.json({ ok: true, asistio: r.asistio, ignorada: r.ignorada, total_invitados: r.total_invitados, total_asistio: r.total_asistio });
  } catch (err) {
    if (err && err.estado) return res.status(err.estado).json({ error: err.mensaje });
    console.error('[eventos] asistencias:', err.code || err.message);
    res.status(500).json({ error: 'Error guardando la asistencia.' });
  }
});

/**
 * «Agregar asistente» por cédula, desde el celular: la persona tiene que ser un votante del equipo de quien pregunta (la misma regla de alcance que su lista de votantes).
 * Si no hay nadie con esa cédula en su equipo responde lo mismo que si no existiera —no dice si existe fuera de su alcance—. Si ya está en el evento, devuelve la misma fila.
 * Devuelve solo { id, nombre, barrio, asistio }: nunca el teléfono ni la cédula. Solo administrador, coordinador y líder, y solo en eventos que gestionan.
 */
router.post('/:id/asistentes-por-cedula', requireRole('admin', 'coordinador', 'lider'), limiteBuscarCedula, json, async (req, res) => {
  try {
    const evento = await eventoEnAlcance(req, req.params.id, true);
    if (!evento) return res.status(404).json(NO_ES_SUYO);
    const cedula = normalizarCedula(req.body && req.body.cedula);
    if (!cedula || String(cedula).length < 5) return res.status(400).json({ error: 'Escribe el número de cédula (al menos 5 dígitos).' });
    const NO_ESTA = { error: 'No encontré a nadie con esa cédula en tu equipo. Si es una persona nueva, pídele a quien coordina que la registre.' };
    const hallada = await buscarFichaPorCedula(pool, cedula);
    if (!hallada) return res.status(404).json(NO_ESTA);
    const [[v]] = await pool.query(
      `SELECT v.id, v.nombre, tv.nombre AS barrio FROM votantes v LEFT JOIN territorios tv ON tv.id = v.territorio_id WHERE v.id = ? AND ${condicionAlcanceVotantes(req.alcance, 'v')}`,
      [hallada, ...parametrosAlcanceVotantes(req.alcance)]);
    if (!v) return res.status(404).json(NO_ESTA);
    const [[ya]] = await pool.query('SELECT id, asistio FROM evento_asistentes WHERE evento_id = ? AND votante_id = ? LIMIT 1', [evento.id, v.id]);
    if (ya) return res.json({ ok: true, duplicado: true, asistente: { id: ya.id, nombre: v.nombre, barrio: v.barrio || null, asistio: Number(ya.asistio) === 1 } });
    const [r] = await pool.query('INSERT INTO evento_asistentes (evento_id, votante_id) VALUES (?, ?)', [evento.id, v.id]);
    res.json({ ok: true, duplicado: false, asistente: { id: r.insertId, nombre: v.nombre, barrio: v.barrio || null, asistio: false } });
  } catch (err) {
    console.error('[eventos] asistente por cédula:', err.code || err.message);
    res.status(500).json({ error: 'Error agregando el asistente.' });
  }
});

router.delete('/asistentes/:asistenteId', requireRole('admin', 'coordinador', 'lider'), async (req, res) => {
  try {
    if (!(await asistenteGestionable(req, req.params.asistenteId))) return res.status(404).json(NO_ES_SUYO);
    await pool.query(`DELETE FROM evento_asistentes WHERE id = ?`, [req.params.asistenteId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error quitando el asistente.' });
  }
});

/**
 * Vuelve a intentar geocodificar los eventos que tienen Dirección guardada
 * pero nunca quedaron georreferenciados. Mismo mecanismo que en Votantes y
 * Estructura: lotes pequeños con pausa entre solicitudes, para respetar el
 * límite de Nominatim (~1 por segundo) y no agotar el tiempo de una sola
 * petición.
 *
 * A diferencia de los otros dos, aquí la dirección se completa con el
 * Departamento y la Ciudad **del evento**, no los de la campaña: un evento
 * puede ser fuera de la ciudad sede, y sin ese dato la misma dirección
 * resolvería al municipio equivocado.
 */
router.post('/regeocodificar-pendientes', requireRole('admin'), async (req, res) => {
  const tamanoLote = Math.min(Math.max(parseInt(req.query.lote) || 5, 1), 20);
  const despuesDe = parseInt(req.query.despues_de) || 0;
  const incluirTodos = req.query.todos === '1';

  if (incluirTodos) {
    const autorizado = await verificarPasswordAdmin(req.body && req.body.password);
    if (!autorizado) {
      return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
    }
  }

  try {
    const condicionGeocodificado = incluirTodos ? '' : ' AND geocodificado_en IS NULL';
    const filtro = `lugar IS NOT NULL AND lugar != '' AND id > ?${condicionGeocodificado}`;

    const [pendientes] = await pool.query(
      `SELECT id, lugar, territorio_id, departamento, ciudad FROM eventos
        WHERE ${filtro} ORDER BY id LIMIT ?`, [despuesDe, tamanoLote]);

    const [[{ totalPendientesDespues }]] = await pool.query(
      `SELECT COUNT(*) AS totalPendientesDespues FROM eventos WHERE ${filtro}`, [despuesDe]);

    let geocodificados = 0;
    const fallidos = [];
    let cursorSiguiente = despuesDe;
    for (const fila of pendientes) {
      try {
        const geo = await geocodificarConTerritorio(fila.lugar, fila.territorio_id, fila.ciudad, fila.departamento);
        if (geo) {
          await pool.query(
            `UPDATE eventos SET latitud = ?, longitud = ?, geocodificado_en = NOW() WHERE id = ?`,
            [geo.latitud, geo.longitud, fila.id]
          );
          geocodificados++;
        } else {
          fallidos.push(fila.id);
        }
      } catch (err) {
        console.error(`Error re-geocodificando evento id ${fila.id}:`, err);
        fallidos.push(fila.id);
      }
      cursorSiguiente = fila.id;
      await new Promise(resolve => setTimeout(resolve, 1200));
    }

    res.json({
      ok: true,
      procesados: pendientes.length,
      geocodificados,
      fallidos: fallidos.length,
      idsFallidos: fallidos,
      cursorSiguiente,
      quedanPendientes: Math.max(0, totalPendientesDespues - pendientes.length)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error re-geocodificando pendientes.' });
  }
});

module.exports = router;
