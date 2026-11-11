/**
 * Lo que una página PÚBLICA necesita saber de la campaña para pedirle algo a una persona:
 * cómo se llama la campaña y cuál es la política de tratamiento de datos vigente (con su huella).
 *
 * VIVÍA DENTRO DE routes/inscripcion.routes.js (la inscripción por enlace/QR). La autorización de datos por enlace de
 * WhatsApp (routes/autorizacion.routes.js, parche 325) necesita exactamente lo mismo, así que se movió aquí en vez de
 * copiarla: dos copias de «la política vigente» derivan sin avisar, y la evidencia dejaría de apuntar al mismo texto.
 */
'use strict';

const pool = require('./db');
const { huellaDePolitica, archivarVersion } = require('./politicaVersiones');

let marcaEnMemoria = { clave: null, texto: '', hasta: 0 };

/** El nombre de la campaña —o del aspirante, si la persona que pide cuelga de uno— con memoria de 5 minutos por rama. */
async function nombreDeLaCampana(ramaId) {
  const clave = String(ramaId || 0);
  if (marcaEnMemoria.clave === clave && Date.now() < marcaEnMemoria.hasta) return marcaEnMemoria.texto;
  let texto = '';
  try {
    if (ramaId) {
      const [[s]] = await pool.query('SELECT nombre FROM sublicencias WHERE usuario_id = ? AND activa = 1', [ramaId]);
      texto = String((s && s.nombre) || '').trim();
    }
    if (!texto) {
      const [[c]] = await pool.query('SELECT marca_titulo FROM configuracion_campana WHERE id = 1');
      texto = String((c && c.marca_titulo) || '').trim();
    }
  } catch (_) { /* sin nombre: la página sale igual */ }
  marcaEnMemoria = { clave, texto, hasta: Date.now() + 5 * 60 * 1000 };
  return texto;
}

/** La política vigente y su huella. Se archiva al mostrarla (igual que /api/contenido): es la evidencia. */
async function politicaVigente() {
  let titulo = 'Política de tratamiento de datos', contenido = '';
  try {
    const [[f]] = await pool.query("SELECT titulo, contenido FROM contenido_paginas WHERE clave = 'politica_privacidad'");
    if (f) { titulo = f.titulo || titulo; contenido = f.contenido || ''; }
  } catch (_) { /* sin tabla: sin política */ }
  const huella = contenido.trim() ? huellaDePolitica(contenido) : null;
  if (huella) archivarVersion({ clave: 'politica_privacidad', titulo, contenido, usuarioId: null, usuarioNombre: 'archivado al entregarse' });
  return { titulo, contenido, huella };
}

module.exports = { nombreDeLaCampana, politicaVigente };
