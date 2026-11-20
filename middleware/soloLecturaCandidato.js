/**
 * SOLO LECTURA DEL CANDIDATO, aplicada en el SERVIDOR (orden 70).
 *
 * Una función única, montada en app.js antes de todas las rutas de /api (junto a `restringirAspirante`): si quien pregunta es un candidato y el método
 * escribe (POST, PUT, PATCH, DELETE), responde 403 — salvo la lista corta de config/rolCandidato.js (ingreso, cerrar sesión, su propia clave).
 * Esconder botones no impide teclear la dirección; esto sí.
 *
 * VA ANTES DE CADA RUTA, así que un módulo nuevo del futuro nace cerrado para el candidato sin que nadie tenga que acordarse. Y la lista es de lo que
 * SÍ pasa, no de lo que se bloquea (mismo criterio que middleware/aspirante.js).
 *
 * QUIÉN ES CANDIDATO se resuelve igual que lo haría `requireAuth` (cookie de sesión o X-Device-Token), porque este middleware corre ANTES que él: con el
 * token del dispositivo la sesión todavía no está armada. Si no se puede saber quién es (token inválido, la base no responde), no se decide aquí: la
 * ruta responde 401 como siempre. Un candidato no puede saltarse esto sin sesión, porque sin sesión no hay nada que escribir.
 *
 * LAS LECTURAS (GET/HEAD/OPTIONS) TAMBIÉN VAN POR LISTA (config/rolCandidato.js, LECTURAS_PERMITIDAS): el candidato ve toda la campaña, pero como CIFRAS y
 * fichas de contacto de su equipo (rutas de /api/candidato), no como listas de personas con cédula o teléfono. Quien no es candidato no se ve afectado.
 */
'use strict';

const { resolverUsuario } = require('./auth');
const { ROL_CANDIDATO, escrituraPermitida, lecturaPermitida } = require('../config/rolCandidato');

const METODOS_DE_LECTURA = ['GET', 'HEAD', 'OPTIONS'];
const MENSAJE = 'Su acceso es de solo consulta: desde aquí no se puede registrar, editar ni enviar nada.';

const MENSAJE_LECTURA = 'Esta información no está disponible para su tipo de acceso.';

async function soloLecturaCandidato(req, res, next) {
  /* Una lectura de alguien que no es candidato pasa sin preguntar nada (cookie de sesión: gratis). Con X-Device-Token cuesta una consulta, igual que en requireAuth. */
  let usuario = null;
  try { usuario = await resolverUsuario(req); } catch (_) { usuario = null; }
  if (!usuario || usuario.rol !== ROL_CANDIDATO) return next();
  if (METODOS_DE_LECTURA.includes(req.method)) {
    // El candidato lee SOLO lo de la lista (config/rolCandidato.js): nunca listas de personas ni finanzas.
    if (lecturaPermitida(req.path)) return next();
    return res.status(403).json({ error: MENSAJE_LECTURA, codigo: 'lectura_no_permitida' });
  }
  if (escrituraPermitida(req.method, req.path)) return next();
  return res.status(403).json({ error: MENSAJE, codigo: 'solo_lectura' });
}

module.exports = { soloLecturaCandidato, MENSAJE };
