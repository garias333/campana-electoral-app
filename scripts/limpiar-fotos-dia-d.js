#!/usr/bin/env node
/**
 * Limpia las fotos del Día D que ya no tienen reporte.
 *
 * POR QUÉ HACE FALTA. Hasta el parche que creó uploads/dia-d/, borrar un reporte
 * (uno solo o «Eliminar todos») dejaba sus fotos en el disco para siempre, y un
 * reporte rechazado después de subir las fotos también las dejaba. Desde ese
 * parche el servidor las borra solo; este guion recoge las que quedaron.
 *
 *   node scripts/limpiar-fotos-dia-d.js --simular   lista lo que borraría, sin tocar nada
 *   node scripts/limpiar-fotos-dia-d.js             lo borra
 *   --antiguedad-min=N   solo toca archivos con más de N minutos (por omisión 30)
 *
 * CÓRRELO COMO EL USUARIO DE LA CAMPAÑA (el dueño de uploads/), desde cualquier
 * carpeta; lee el .env del proyecto:
 *   sudo -u appestrategia-electoral <node de esa cuenta> scripts/limpiar-fotos-dia-d.js --simular
 * Si se corre como otro usuario y el sistema le niega borrar, lo dice y sigue.
 *
 * QUÉ CONSIDERA «SIN REPORTE»
 *   1. Un archivo de uploads/dia-d/ que no figura ni como foto de E-14 de un
 *      reporte ni como documento de un reporte que exista.
 *   2. Un documento anexo cuyo reporte ya no existe (la tabla no tiene llave
 *      foránea hacia dia_d_reportes y el borrado de antes no se los llevaba):
 *      se borran su archivo —esté en uploads/dia-d/ o en la raíz de uploads/— y
 *      su fila.
 *
 * QUÉ NO TOCA, y es a propósito
 *   · Los archivos sueltos de la RAÍZ de uploads/ que ningún documento huérfano
 *     reclama. Ahí conviven las fotos de reportes anteriores a uploads/dia-d/
 *     con los comprobantes de finanzas y los adjuntos de comunicaciones, y un
 *     archivo de la raíz sin referencia en el Día D NO es por eso basura: puede
 *     ser el soporte de un egreso. Las fotos viejas de un reporte ya borrado
 *     quedaron sin rastro y no se pueden distinguir; si hace falta limpiarlas,
 *     se revisan a mano.
 *   · Archivos con menos de --antiguedad-min minutos: pueden ser una subida en
 *     curso, guardada por multer pero con el reporte todavía sin confirmar.
 *   · Cualquier subcarpeta de uploads/dia-d/.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const SIMULAR = process.argv.includes('--simular');
const argAntiguedad = process.argv.find(a => a.startsWith('--antiguedad-min='));
const ANTIGUEDAD_MIN = argAntiguedad ? Number(argAntiguedad.split('=')[1]) : 30;

const RAIZ = path.join(__dirname, '..', 'uploads');
const CARPETA = path.join(RAIZ, 'dia-d');

const kb = (n) => (n / 1024).toFixed(0) + ' KB';

(async () => {
  try {
    if (!Number.isFinite(ANTIGUEDAD_MIN) || ANTIGUEDAD_MIN < 0) {
      throw new Error('--antiguedad-min debe ser un número de minutos (0 o más).');
    }
    const usuario = (() => { try { return require('os').userInfo().username; } catch (_) { return '?'; } })();
    console.log(`${SIMULAR ? 'SIMULACIÓN — no se borra nada' : 'BORRADO REAL'} · usuario del sistema: ${usuario} · solo archivos de más de ${ANTIGUEDAD_MIN} min`);

    // Lo que SÍ tiene reporte.
    const [fotos] = await pool.query(`SELECT foto_e14_url AS url FROM dia_d_reportes WHERE foto_e14_url IS NOT NULL`);
    const [anexos] = await pool.query(
      `SELECT d.url FROM dia_d_reporte_documentos d JOIN dia_d_reportes r ON r.id = d.reporte_id`);
    const conReporte = new Set([...fotos, ...anexos].map(f => f.url));

    // Documentos cuyo reporte ya no existe.
    const [huerfanos] = await pool.query(
      `SELECT d.id, d.url FROM dia_d_reporte_documentos d
         LEFT JOIN dia_d_reportes r ON r.id = d.reporte_id
        WHERE r.id IS NULL`);

    const limite = Date.now() - ANTIGUEDAD_MIN * 60 * 1000;
    const candidatos = [];   // { ruta, url, motivo, bytes, edadMin }

    const agregar = (ruta, url, motivo) => {
      if (candidatos.some(c => c.ruta === ruta)) return;
      let st;
      try { st = fs.statSync(ruta); } catch (_) { return; }       // ya no está
      if (!st.isFile()) return;
      if (st.mtimeMs > limite) return;                             // muy reciente: puede ser una subida en curso
      candidatos.push({ ruta, url, motivo, bytes: st.size, edadMin: Math.round((Date.now() - st.mtimeMs) / 60000) });
    };

    // 1. Archivos de uploads/dia-d/ sin reporte.
    if (fs.existsSync(CARPETA)) {
      for (const nombre of fs.readdirSync(CARPETA)) {
        if (nombre.startsWith('.')) continue;
        const url = `/uploads/dia-d/${nombre}`;
        if (!conReporte.has(url)) agregar(path.join(CARPETA, nombre), url, 'sin reporte');
      }
    } else {
      console.log('uploads/dia-d/ todavía no existe: no hay fotos nuevas que revisar.');
    }

    // 2. Archivos de documentos huérfanos (en la subcarpeta o en la raíz). La fila
    // solo se borra si su archivo ya no está o se va a borrar ahora; si el
    // archivo es demasiado reciente se deja TODO como está para la próxima vuelta
    // (borrar la fila sola haría perder el rastro de qué archivo era).
    const idsHuerfanos = [];
    for (const h of huerfanos) {
      const nombre = path.basename(h.url || '');
      if (!nombre || nombre === '.' || nombre === '..' || !String(h.url).startsWith('/uploads/')) {
        idsHuerfanos.push(h.id);                       // fila sin archivo posible
        continue;
      }
      const rutas = String(h.url).startsWith('/uploads/dia-d/')
        ? [path.join(CARPETA, nombre)]
        : [path.join(RAIZ, nombre), path.join(CARPETA, nombre)];
      const existentes = rutas.filter(r => fs.existsSync(r));
      if (existentes.some(r => fs.statSync(r).mtimeMs > limite)) continue;   // muy reciente
      idsHuerfanos.push(h.id);
      // Si un reporte vivo apunta al mismo archivo, solo se borra la fila.
      if (conReporte.has(h.url)) continue;
      for (const r of existentes) agregar(r, h.url, 'anexo de un reporte borrado');
    }

    if (!candidatos.length && !idsHuerfanos.length) {
      console.log('Nada que limpiar: no hay fotos sin reporte.');
      return;
    }

    let total = 0;
    for (const c of candidatos) {
      total += c.bytes;
      console.log(`  ${c.url.padEnd(58)} ${kb(c.bytes).padStart(8)}  ${String(c.edadMin).padStart(6)} min  ${c.motivo}`);
    }
    console.log(`\n${candidatos.length} archivo(s), ${kb(total)} en total` +
      (idsHuerfanos.length ? `; ${idsHuerfanos.length} fila(s) de documentos sin reporte.` : '.'));

    if (SIMULAR) {
      console.log('\nSimulación terminada. Quite --simular para borrar.');
      return;
    }

    let borrados = 0, fallidos = 0;
    for (const c of candidatos) {
      try { fs.unlinkSync(c.ruta); borrados++; }
      catch (err) {
        fallidos++;
        console.error(`  No se pudo borrar ${c.ruta}: ${err.code || err.message}` +
          (err.code === 'EACCES' || err.code === 'EPERM' ? ' (¿se corrió como otro usuario? córralo como el dueño de uploads/)' : ''));
      }
    }
    let filas = 0;
    if (idsHuerfanos.length) {
      const [r] = await pool.query(`DELETE FROM dia_d_reporte_documentos WHERE id IN (?)`, [idsHuerfanos]);
      filas = r.affectedRows;
    }
    console.log(`\nBorrados: ${borrados} archivo(s)${fallidos ? `, ${fallidos} con error` : ''}; ${filas} fila(s) de documentos huérfanos.`);
    if (fallidos) process.exitCode = 1;
  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
