/**
 * «MIS LÍDERES» del coordinador en el celular (orden 59). Montado en /api/coordinador.
 *
 *   GET /mis-lideres    su rama entera: cifras del encabezado y cada líder y sublíder con avance, semáforo, último registro y semanas.
 *   GET /lider/:id      la ficha de uno de ellos (con lo que solo se conoce en vivo: el Día D). 404 si no es de SU rama.
 *
 * QUIÉN ES, SALE DE LA SESIÓN. El coordinador ve SIEMPRE los suyos: un `coordinador_id` que mande se IGNORA. El administrador (y el
 * superadministrador, que conserva el rol 'admin') eligen a cuál mirar con `?coordinador_id=`, igual que en /dashboard/avance-mis-lideres.
 * El aspirante con sublicencia no pasa: su rol es 'lider' y lo suyo es «Progreso del equipo».
 *
 * EL ALCANCE SE APLICA AQUÍ, EN EL SERVIDOR: `/lider/:id` busca el id DENTRO de la rama calculada (lib/coordinadorEquipo.js). Un id de otra
 * rama, de un líder inactivo, de un testigo o que no existe recibe la MISMA respuesta: 404. Así la ruta no sirve para sondear ids.
 *
 * NUNCA devuelve cédula ni correo de los líderes: lo que hace falta para trabajar es el nombre, el celular y las cifras.
 */
'use strict';

const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { filtroOcultar } = require('../config/superadmin');
const { equipoDelCoordinador, coordinadorDeLaPeticion, UMBRAL_ROJO, UMBRAL_VERDE, DIAS_SIN_REGISTRAR } = require('../lib/coordinadorEquipo');
const { normalizarCedula } = require('../lib/normalizarCedula');
const { permisosDeSesion } = require('./permisos.routes');

const router = express.Router();
router.use(requireAuth, requireRole('coordinador', 'admin'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/mis-lideres', async (req, res) => {
  try {
    const r = await coordinadorDeLaPeticion(pool, req);
    if (r.error) return res.status(r.status).json({ error: r.error });
    const ocultar = await filtroOcultar(req.session.usuario, 'u');
    const equipo = await equipoDelCoordinador(pool, r.coordinador.id, ocultar);
    res.json({
      coordinador: r.coordinador,
      generado_en: new Date().toISOString(),
      reglas: { umbral_rojo: UMBRAL_ROJO, umbral_verde: UMBRAL_VERDE, dias_sin_registrar: DIAS_SIN_REGISTRAR },
      ...equipo,
    });
  } catch (err) {
    console.error('Mis líderes:', err.code || err.message);   // solo el código y el mensaje: `err.sql` lleva la consulta entera
    res.status(500).json({ error: 'No se pudo cargar la información de sus líderes.' });
  }
});

/**
 * El Día D de UNA persona de la rama: si ya votó y cuántos de los que registró ya votaron. Solo con el módulo encendido (complemento «Faltan por votar»)
 * y «Ver» en `rescate_votos` — el mismo criterio de la tarjeta «Faltan por votar» del panel del líder. Devuelve null si no aplica.
 */
async function diaDeLaPersona(req, miembro, equipo) {
  try {
    const { permisos } = await permisosDeSesion(req);
    if (!(permisos && permisos.rescate_votos && permisos.rescate_votos.ver)) return null;
    if (!(await require('../lib/complementos').complementoActivo('faltan_por_votar'))) return null;

    let eleccion = { fecha: null, esHoy: false };
    try { eleccion = await require('../config/yaVotoEnlace').estadoDeLaElección(); } catch (_) { /* sin fecha: modo prueba */ }

    // Los que registró: un líder, lo suyo y lo de sus sublíderes; un sublíder, lo que él registró.
    const ids = miembro.rol === 'lider'
      ? [miembro.id, ...equipo.miembros.filter((x) => x.rol === 'sublider' && x.supervisor_id === miembro.id).map((x) => x.id)]
      : [miembro.id];
    const condicion = miembro.rol === 'lider' ? 'v.lider_id IN (?)' : '(v.lider_id IN (?) OR v.sublider_id IN (?))';
    const valores = miembro.rol === 'lider' ? [ids] : [ids, ids];
    const [[t]] = await pool.query(
      `SELECT COUNT(DISTINCT v.id) AS total, COUNT(DISTINCT vv.votante_id) AS votaron
         FROM votantes v LEFT JOIN votante_votos vv ON vv.votante_id = v.id WHERE ${condicion}`, valores);

    // ¿Ya votó la persona misma? Solo se sabe si figura también como votante (la cédula es el puente entre las dos tablas).
    let yaVoto = null;
    const [[u]] = await pool.query('SELECT numero_identificacion FROM usuarios WHERE id = ?', [miembro.id]);
    const cedula = normalizarCedula(u && u.numero_identificacion);
    if (cedula) {
      const { buscarFichaConCedula } = require('../lib/normalizarCedula');
      const ficha = await buscarFichaConCedula(pool, cedula);
      if (ficha) {
        const [[voto]] = await pool.query('SELECT 1 AS si FROM votante_votos WHERE votante_id = ? LIMIT 1', [ficha.id]);
        yaVoto = !!voto;
      }
    }
    const total = Number(t.total); const votaron = Number(t.votaron);
    return { modo_prueba: !eleccion.esHoy, fecha_eleccion: eleccion.fecha || null, ya_voto: yaVoto, total, votaron, faltan: total - votaron };
  } catch (err) {
    console.error('Mis líderes (Día D):', err.code || err.message);
    return null;
  }
}

router.get('/lider/:id', async (req, res) => {
  try {
    const r = await coordinadorDeLaPeticion(pool, req);
    if (r.error) return res.status(r.status).json({ error: r.error });
    const id = Number(req.params.id);
    const noExiste = () => res.status(404).json({ error: 'Esa persona no está en su equipo.' });
    if (!Number.isInteger(id) || id <= 0) return noExiste();

    const ocultar = await filtroOcultar(req.session.usuario, 'u');
    const equipo = await equipoDelCoordinador(pool, r.coordinador.id, ocultar);
    const miembro = equipo.miembros.find((x) => x.id === id);
    if (!miembro) return noExiste();

    res.json({
      coordinador: r.coordinador,
      hoy: equipo.hoy,
      miembro,
      sublideres: miembro.rol === 'lider' ? equipo.miembros.filter((x) => x.rol === 'sublider' && x.supervisor_id === id) : [],
      dia_d: await diaDeLaPersona(req, miembro, equipo),
    });
  } catch (err) {
    console.error('Mis líderes (ficha):', err.code || err.message);
    res.status(500).json({ error: 'No se pudo cargar la ficha.' });
  }
});

module.exports = router;
