#!/usr/bin/env node
/**
 * scripts/reporte-cedulas.js — Informe de SOLO LECTURA sobre las cédulas de `votantes` (orden 30).
 *
 * NO MODIFICA NADA: ni una cédula, ni una ficha, ni la base. Corre contra la base del `.env` de la carpeta
 * donde se ejecute, así que se corre una vez en cada campaña.
 *
 * USO (desde la carpeta de la instalación, con el node de su cuenta):
 *     node scripts/reporte-cedulas.js              # los 200 primeros grupos
 *     node scripts/reporte-cedulas.js --todos      # todos los grupos
 *     node scripts/reporte-cedulas.js --json       # lo mismo en JSON (para guardarlo)
 *
 * QUÉ DICE
 *   a. GRUPOS DE CASI-DUPLICADOS: fichas distintas que tienen la MISMA cédula normalizada (solo dígitos, sin
 *      ceros a la izquierda; lib/normalizarCedula.js). El índice UNIQUE de la tabla solo ve el texto idéntico,
 *      así que «1.053.123.456» y «1053123456» pasaron como dos personas. De cada ficha: id, líder, fecha de
 *      creación, la cédula ENMASCARADA (***456) y cómo está guardada (limpia, con signos o con ceros).
 *   b. CUÁNTAS CÉDULAS ESTÁN GUARDADAS CON SIGNOS O CEROS sin tener duplicado: no estorban hoy, pero son las
 *      que se encuentran por la regla nueva y no por el índice.
 *
 * NUNCA IMPRIME UNA CÉDULA COMPLETA: se saca el informe a un chat o a un correo sin pensarlo dos veces.
 *
 * CÓDIGO DE SALIDA: 0 = sin casi-duplicados; 2 = hay (para usarlo en un cron); 1 = falló.
 * La limpieza de lo que salga se decide en otra orden: aquí no se corrige nada.
 */
'use strict';

const { normalizarCedula, sqlCedulaNormalizada, enmascararCedula } = require('../lib/normalizarCedula');

/** Cómo está escrita una cédula guardada (sin devolverla). */
function formaGuardada(cedula) {
  const t = String(cedula == null ? '' : cedula);
  const f = [];
  if (/[^0-9]/.test(t)) f.push('con signos o espacios');
  if (t.replace(/\D/g, '').startsWith('0')) f.push('con ceros a la izquierda');
  return f.length ? f.join(' y ') : 'limpia';
}

/**
 * @param cx pool o conexión mysql2/promise
 * @param {{limite?: number}} [opciones]  limite = grupos a detallar (0 o undefined = todos)
 */
async function reporte(cx, { limite = 0 } = {}) {
  const N = sqlCedulaNormalizada('cedula');
  const [[tot]] = await cx.query(`SELECT COUNT(*) AS fichas, SUM(cedula IS NOT NULL AND cedula <> '') AS con_cedula FROM votantes`);
  const [[unique]] = await cx.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'votantes' AND COLUMN_NAME = 'cedula' AND NON_UNIQUE = 0 AND SEQ_IN_INDEX = 1`);

  // a. grupos: la misma cédula normalizada en varias fichas
  const [grupos] = await cx.query(
    `SELECT ${N} AS clave, COUNT(*) AS fichas FROM votantes
      WHERE cedula IS NOT NULL AND cedula <> '' GROUP BY clave HAVING clave <> '' AND COUNT(*) > 1
      ORDER BY fichas DESC, clave`);
  const mostrar = limite > 0 ? grupos.slice(0, limite) : grupos;
  const detalle = [];
  for (const g of mostrar) {
    const [miembros] = await cx.query(
      `SELECT v.id, v.cedula, v.lider_id, u.nombre AS lider, v.created_at
         FROM votantes v LEFT JOIN usuarios u ON u.id = v.lider_id
        WHERE v.cedula IS NOT NULL AND ${sqlCedulaNormalizada('v.cedula')} = ? ORDER BY v.created_at, v.id`, [g.clave]);
    detalle.push({
      cedula: enmascararCedula(g.clave), fichas: g.fichas,
      miembros: miembros.map(m => ({
        id: m.id, lider: m.lider || (m.lider_id ? `(usuario ${m.lider_id})` : '(sin líder)'),
        creada: m.created_at, cedula: enmascararCedula(m.cedula), guardada: formaGuardada(m.cedula),
      })),
    });
  }
  const fichasEnGrupos = grupos.reduce((a, g) => a + Number(g.fichas), 0);

  // b. guardadas con signos o ceros, sin duplicado
  const [[sinNormalizar]] = await cx.query(
    `SELECT COUNT(*) AS n,
            SUM(cedula REGEXP '[^0-9]') AS con_signos,
            SUM(cedula NOT REGEXP '[^0-9]' AND cedula REGEXP '^0') AS con_ceros
       FROM votantes WHERE cedula IS NOT NULL AND cedula <> '' AND cedula REGEXP '[^0-9]|^0'`);
  const [[enGrupo]] = await cx.query(
    `SELECT COUNT(*) AS n FROM votantes v
      WHERE v.cedula IS NOT NULL AND v.cedula <> '' AND v.cedula REGEXP '[^0-9]|^0'
        AND ${sqlCedulaNormalizada('v.cedula')} IN (
          SELECT c FROM (SELECT ${N} AS c FROM votantes WHERE cedula IS NOT NULL AND cedula <> '' GROUP BY c HAVING COUNT(*) > 1) g)`);
  const [[vacias]] = await cx.query(`SELECT COUNT(*) AS n FROM votantes WHERE cedula = '' OR (cedula IS NOT NULL AND ${N} = '')`);

  return {
    fichas: Number(tot.fichas), con_cedula: Number(tot.con_cedula || 0), indice_unique: unique.n > 0,
    grupos: grupos.length, fichas_en_grupos: fichasEnGrupos, detalle, detallados: detalle.length,
    sin_normalizar: Number(sinNormalizar.n || 0), con_signos: Number(sinNormalizar.con_signos || 0), con_ceros: Number(sinNormalizar.con_ceros || 0),
    sin_normalizar_sin_duplicado: Number(sinNormalizar.n || 0) - Number(enGrupo.n || 0),
    sin_digitos: Number(vacias.n || 0),
  };
}

function imprimir(r, base) {
  const f = (n) => Number(n).toLocaleString('es-CO');
  const lineas = [];
  lineas.push(`REPORTE DE CÉDULAS — base «${base}» — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} (solo lectura)`);
  lineas.push('');
  lineas.push(`Fichas en votantes ........................ ${f(r.fichas)}   (con cédula: ${f(r.con_cedula)})`);
  lineas.push(`Índice UNIQUE sobre votantes.cedula ....... ${r.indice_unique ? 'sí' : 'NO — falta (init-db lo crea si no hay duplicados exactos)'}`);
  lineas.push('');
  lineas.push('a. CASI-DUPLICADOS (misma cédula normalizada en varias fichas)');
  lineas.push(`   grupos: ${f(r.grupos)}   fichas involucradas: ${f(r.fichas_en_grupos)}`);
  for (const g of r.detalle) {
    lineas.push(`   · cédula ${g.cedula} — ${g.fichas} fichas`);
    for (const m of g.miembros) {
      lineas.push(`       ficha ${String(m.id).padEnd(8)} líder: ${String(m.lider).padEnd(28).slice(0, 28)} creada: ${String(m.creada).slice(0, 16)}   ${m.cedula}   (${m.guardada})`);
    }
  }
  if (r.grupos > r.detallados) lineas.push(`   … y ${f(r.grupos - r.detallados)} grupos más (use --todos para verlos).`);
  lineas.push('');
  lineas.push('b. CÉDULAS GUARDADAS CON SIGNOS O CEROS A LA IZQUIERDA');
  lineas.push(`   en total: ${f(r.sin_normalizar)}   (con puntos o espacios: ${f(r.con_signos)} · solo ceros delante: ${f(r.con_ceros)})`);
  lineas.push(`   de ellas, SIN duplicado: ${f(r.sin_normalizar_sin_duplicado)}   (las demás están en los grupos de arriba)`);
  if (r.sin_digitos) lineas.push(`   cédulas vacías o sin ningún dígito: ${f(r.sin_digitos)}`);
  lineas.push('');
  lineas.push(r.grupos
    ? `RESULTADO: HAY ${f(r.grupos)} grupo(s) de casi-duplicados. No se corrigió nada: la limpieza se decide aparte.`
    : 'RESULTADO: sin casi-duplicados.');
  return lineas.join('\n');
}

module.exports = { reporte, imprimir, formaGuardada };

if (require.main === module) {
  require('dotenv').config();
  const args = process.argv.slice(2);
  const pool = require('../config/db');
  (async () => {
    const [[b]] = await pool.query('SELECT DATABASE() AS nombre');
    const r = await reporte(pool, { limite: args.includes('--todos') ? 0 : 200 });
    console.log(args.includes('--json') ? JSON.stringify({ base: b.nombre, ...r }, null, 2) : imprimir(r, b.nombre));
    await pool.end();
    process.exit(r.grupos ? 2 : 0);
  })().catch(async (e) => {
    console.error('No se pudo generar el reporte:', e.code || e.message);
    try { await pool.end(); } catch (_) { /* ya cerrado */ }
    process.exit(1);
  });
}
