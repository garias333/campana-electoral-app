/**
 * ¿ESTA SESIÓN ES LA DEL CANDIDATO PRINCIPAL? (orden 81) — la ÚNICA definición.
 *
 * Es candidato quien tiene el rol «candidato», o quien tiene rol «admin» Y la marca `usuarios.es_candidato = 1` (el administrador que a la vez es el candidato:
 * un solo usuario, con todos sus permisos de administrador). La marca SE CONSULTA, no se lee de la sesión: una sesión dura hasta siete días y quitarle la marca
 * a alguien tiene que valer desde la petición siguiente (el mismo criterio que `es_superadmin` y `es_aspirante` en /auth/me).
 *
 * OJO CON LO QUE ESTO NO DECIDE: la lectura/escritura limitada del candidato (middleware/soloLecturaCandidato.js) se aplica SOLO al rol «candidato». El
 * administrador marcado sigue siendo administrador para el servidor: puede escribir en todo lo que ya podía. Esto solo abre /api/candidato y decide a dónde va.
 */
'use strict';

const pool = require('./db');
const { ROL_CANDIDATO } = require('./rolCandidato');

/** ¿Es un ADMINISTRADOR marcado como el candidato? (la marca se consulta; falla cerrado). */
async function esAdminCandidato(usuario) {
  if (!usuario || usuario.rol !== 'admin' || !usuario.id) return false;
  try {
    const [[f]] = await pool.query('SELECT es_candidato FROM usuarios WHERE id = ? LIMIT 1', [usuario.id]);
    return !!f && Number(f.es_candidato) === 1;
  } catch (err) {
    if (err.code !== 'ER_BAD_FIELD_ERROR') console.error('esCandidato:', err.code || err.message);
    return false;
  }
}

/** ¿Es candidato (rol «candidato», o admin marcado)? `usuario` es el de la sesión ({ id, rol }). Falla cerrado: sin saberlo, no. */
async function esCandidato(usuario) {
  if (!usuario) return false;
  if (usuario.rol === ROL_CANDIDATO) return true;
  return esAdminCandidato(usuario);
}

/** Middleware de /api/candidato: pasa el rol candidato y el administrador marcado. Detrás de requireAuth. */
async function requiereCandidato(req, res, next) {
  if (await esCandidato(req.session && req.session.usuario)) return next();
  return res.status(403).json({ error: 'No tiene permiso para esta sección.' });
}

module.exports = { esCandidato, esAdminCandidato, requiereCandidato };
