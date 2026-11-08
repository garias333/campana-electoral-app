#!/usr/bin/env node
// scripts/anonimizar-solicitudes.js
//
// ANONIMIZA las solicitudes ciudadanas que cumplieron su plazo: `anonimizar_solicitudes_meses` meses (6 de fábrica; se cambia en la
// pantalla de Solicitudes) DESPUÉS de la fecha de la elección. Borra el nombre y el teléfono del ciudadano y las fotos (las filas y los
// archivos de uploads/solicitudes/). Deja lo demás —categoría, barrio, estado, historial—, que ya no identifica a nadie.
//
// Sin la fecha de elección en la configuración no hace nada.
//
// DESDE EL PARCHE 304 YA NO HACE FALTA NINGÚN CRON: la propia aplicación corre esta misma lógica una vez al día, a partir de las 03:30
// (hora de Colombia), y deja en la auditoría cuántas solicitudes anonimizó (lib/solicitudesMantenimiento.js). Este script queda para
// PROBAR y para quien quiera SIMULAR desde la consola. Si ya se había puesto en el cron, se puede quitar; dejarlo no hace daño (repetible).
//
// USO (desde la carpeta de la campaña):
//   node scripts/anonimizar-solicitudes.js            SIMULA: dice cuántas vencen y no borra nada
//   node scripts/anonimizar-solicitudes.js --aplicar  borra de verdad
//
// Repetible: una segunda corrida no encuentra nada que hacer. Sale con código 1 si algo falla.

require('dotenv').config();
const pool = require('../config/db');
const { anonimizarVencidas } = require('../lib/solicitudes');

(async () => {
  const aplicar = process.argv.includes('--aplicar');
  const r = await anonimizarVencidas({ aplicar });
  const cuando = new Date().toISOString();
  if (!r.desde && !r.vencen) {
    console.log(`[${cuando}] ${r.motivo}`);
  } else if (!r.aplicado && !aplicar && r.desde && r.motivo.startsWith('Simulación')) {
    console.log(`[${cuando}] Simulación: desde el ${r.desde} vencen ${r.vencen} solicitud(es) con datos del ciudadano o fotos. No se borró nada. Con --aplicar se borran.`);
  } else if (r.aplicado) {
    console.log(`[${cuando}] Aplicado: ${r.anonimizadas} solicitud(es) anonimizada(s) y ${r.fotos} foto(s) borrada(s) (plazo desde el ${r.desde}).`);
  } else {
    console.log(`[${cuando}] ${r.motivo}`);
  }
  await pool.end();
})().catch(async (e) => { console.error('Falló la anonimización:', e.message); try { await pool.end(); } catch (_) { /* ya cerrado */ } process.exit(1); });
