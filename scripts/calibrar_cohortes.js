#!/usr/bin/env node
'use strict';
/**
 * calibrar_cohortes.js — Construye/actualiza `cedula_cohorte`.
 *
 * DOS FUENTES POSIBLES
 * --------------------
 *  A) Autocalibración desde los propios registros capturados (por defecto).
 *     No requiere nada externo. Arranca a servir cuando cada bucket acumula
 *     muestra suficiente. Con ~3.000 capturas ya discrimina razonablemente.
 *
 *  B) Importación de un padrón externo con cédula + año de nacimiento (+ sexo).
 *     Si se consigue, el validador arranca calibrado desde el primer día.
 *
 * Correr por cron semanal mientras la campaña captura:
 *   0 3 * * 1 cd /home/garias.../app && node scripts/calibrar_cohortes.js >> logs/cohortes.log 2>&1
 *
 * Uso:
 *   node scripts/calibrar_cohortes.js                        # autocalibrar
 *   node scripts/calibrar_cohortes.js --dry-run
 *   node scripts/calibrar_cohortes.js --padron padron.csv \
 *        --col-cedula CEDULA --col-anio ANIO_NAC --col-sexo SEXO
 *   node scripts/calibrar_cohortes.js --bucket 300      # 300 observaciones por bucket
 */

const fs = require('fs');
const mysql = () => require('mysql2/promise');

// Observaciones objetivo por bucket. Más bajo = más resolución, menos robustez.
// 160 da un margen cómodo sobre el mínimo de 40 que exige el validador.
const OBJETIVO_POR_BUCKET = 160;   // observaciones por bucket (frecuencia igual)
const MIN_MUESTRAS = 40;
const UMBRAL_SEXO_DOMINANTE = 0.93;

function percentil(arrOrdenado, p) {
  if (!arrOrdenado.length) return null;
  const i = (arrOrdenado.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return Math.round(lo === hi ? arrOrdenado[lo] : arrOrdenado[lo] + (arrOrdenado[hi] - arrOrdenado[lo]) * (i - lo));
}

/**
 * Agrupa observaciones {cedula, anio, sexo} en buckets de FRECUENCIA IGUAL
 * (cada bucket contiene aproximadamente el mismo número de observaciones).
 *
 * Por qué no buckets de ancho fijo: la serie antigua de cédulas ocupa el rango
 * 1–30 millones aproximadamente, mientras la serie nueva se extiende sobre más
 * de mil millones. Con ancho fijo, la serie nueva se fragmenta en miles de
 * buckets sin muestra suficiente, y queda sin validar justo la población más
 * numerosa. Con frecuencia igual, la resolución se adapta sola a la densidad
 * real de los datos.
 *
 * @param {Array} observaciones  {cedula, anio, sexo}
 * @param {number} objetivoPorBucket  observaciones deseadas por bucket
 * @returns {Array} filas listas para cedula_cohorte
 */
function construirBuckets(observaciones, objetivoPorBucket = MIN_MUESTRAS * 4) {
  const anioMax = new Date().getFullYear();

  const limpias = observaciones
    .map(o => ({
      n: Number(String(o.cedula).replace(/\D/g, '')),
      anio: Number(o.anio),
      sexo: o.sexo === 'M' || o.sexo === 'F' ? o.sexo : null,
    }))
    .filter(o => Number.isFinite(o.n) && o.n > 0)
    .sort((a, b) => a.n - b.n);

  if (!limpias.length) return [];

  const nBuckets = Math.max(1, Math.min(150, Math.floor(limpias.length / objetivoPorBucket)));
  const tam = Math.ceil(limpias.length / nBuckets);

  const filas = [];
  for (let i = 0; i < limpias.length; i += tam) {
    const grupo = limpias.slice(i, i + tam);
    const anios = grupo.map(o => o.anio)
      .filter(a => Number.isFinite(a) && a > 1890 && a <= anioMax)
      .sort((a, b) => a - b);

    const sexos = { M: 0, F: 0 };
    for (const o of grupo) if (o.sexo) sexos[o.sexo]++;
    const totalSexo = sexos.M + sexos.F;

    let sexoDom = null, sexoPct = null;
    if (totalSexo >= MIN_MUESTRAS) {
      const dom = sexos.M >= sexos.F ? 'M' : 'F';
      const pct = Math.max(sexos.M, sexos.F) / totalSexo;
      sexoDom = pct >= UMBRAL_SEXO_DOMINANTE ? dom : 'MIXTO';
      sexoPct = +pct.toFixed(3);
    }

    // Los límites cubren el espacio completo sin huecos: el primer bucket
    // arranca en 1 y el último llega al techo, para que ninguna cédula quede
    // fuera de todo bucket.
    const esPrimero = i === 0;
    const esUltimo = i + tam >= limpias.length;
    const siguiente = limpias[i + tam];

    filas.push({
      bucket_ini: esPrimero ? 1 : grupo[0].n,
      bucket_fin: esUltimo ? 9999999999 : (siguiente ? siguiente.n - 1 : grupo[grupo.length - 1].n),
      anio_p05: percentil(anios, 0.05),
      anio_p50: percentil(anios, 0.50),
      anio_p95: percentil(anios, 0.95),
      sexo_dominante: sexoDom,
      sexo_pct: sexoPct,
      n_muestras: Math.max(anios.length, totalSexo),
    });
  }
  return filas;
}

/**
 * Suaviza buckets con muestra escasa usando los vecinos.
 * La relación cédula->año de nacimiento es monótona creciente, así que un bucket
 * sin datos puede interpolarse entre el anterior y el siguiente que sí los tengan.
 */
function interpolarVacios(filas) {
  const util = i => filas[i] && filas[i].n_muestras >= MIN_MUESTRAS && filas[i].anio_p50 != null;
  for (let i = 0; i < filas.length; i++) {
    if (util(i)) continue;
    let a = i - 1, b = i + 1;
    while (a >= 0 && !util(a)) a--;
    while (b < filas.length && !util(b)) b++;
    if (a < 0 || b >= filas.length) continue;
    const t = (filas[i].bucket_ini - filas[a].bucket_ini) /
              (filas[b].bucket_ini - filas[a].bucket_ini);
    const lerp = (x, y) => Math.round(x + (y - x) * t);
    filas[i].anio_p05 = lerp(filas[a].anio_p05, filas[b].anio_p05);
    filas[i].anio_p50 = lerp(filas[a].anio_p50, filas[b].anio_p50);
    filas[i].anio_p95 = lerp(filas[a].anio_p95, filas[b].anio_p95);
    filas[i].interpolado = true;
    // n_muestras se deja como está: el validador seguirá ignorándolo por muestra
    // insuficiente. La interpolación es informativa, no habilitante.
  }
  return filas;
}

/** Detecta buckets que rompen la monotonía: señal de datos sucios. */
function detectarAnomalias(filas) {
  const anom = [];
  const usables = filas.filter(f => f.n_muestras >= MIN_MUESTRAS && f.anio_p50 != null);
  for (let i = 1; i < usables.length; i++) {
    if (usables[i].anio_p50 < usables[i - 1].anio_p50 - 3) {
      anom.push({
        bucket: usables[i].bucket_ini,
        p50: usables[i].anio_p50,
        p50_anterior: usables[i - 1].anio_p50,
        nota: 'mediana decrece respecto al bucket anterior',
      });
    }
  }
  return anom;
}

// ============================================================
// Fuentes
// ============================================================

async function desdeCapturas(conn) {
  // Solo registros sin advertencias: no se calibra con datos ya sospechosos,
  // eso realimentaría el error.
  const [rows] = await conn.query(`
    SELECT c.id, c.cedula_enc, c.sexo, YEAR(c.fecha_nacimiento) AS anio
    FROM ciudadano c
    WHERE c.fecha_nacimiento IS NOT NULL
      AND c.validacion_nivel <> 'advertencia'
  `);
  const { descifrarCedula } = require('../lib/cedulaCrypto');
  const obs = [];
  for (const r of rows) {
    try {
      obs.push({ cedula: descifrarCedula(r.cedula_enc), anio: r.anio, sexo: r.sexo });
    } catch { /* registro con clave distinta o corrupto: se omite */ }
  }
  return obs;
}

function desdePadron(ruta, cols) {
  const texto = fs.readFileSync(ruta, 'utf8');
  const lineas = texto.split(/\r?\n/).filter(Boolean);
  const delim = (lineas[0].match(/;/g) || []).length > (lineas[0].match(/,/g) || []).length ? ';' : ',';
  const cab = lineas[0].split(delim).map(h => h.trim().replace(/^"|"$/g, ''));
  const iC = cab.indexOf(cols.cedula), iA = cab.indexOf(cols.anio), iS = cab.indexOf(cols.sexo);
  if (iC < 0 || iA < 0) {
    throw new Error(`Columnas no encontradas. Disponibles: ${cab.join(', ')}`);
  }
  return lineas.slice(1).map(l => {
    const c = l.split(delim).map(x => x.trim().replace(/^"|"$/g, ''));
    return { cedula: c[iC], anio: +String(c[iA]).slice(0, 4), sexo: iS >= 0 ? c[iS] : null };
  });
}

// ============================================================
// Main
// ============================================================

function args() {
  const a = process.argv.slice(2);
  const g = f => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : null; };
  return {
    dryRun: a.includes('--dry-run'),
    padron: g('--padron'),
    bucket: +(g('--bucket') || OBJETIVO_POR_BUCKET),
    cols: { cedula: g('--col-cedula') || 'CEDULA',
            anio:   g('--col-anio')   || 'ANIO_NAC',
            sexo:   g('--col-sexo')   || 'SEXO' },
  };
}

async function main() {
  const opt = args();
  const conn = await mysql().createConnection({
    host: process.env.DB_HOST || '127.0.0.1',   // NO 'localhost'
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  const fuente = opt.padron ? 'padron_importado' : 'capturado';
  const obs = opt.padron ? desdePadron(opt.padron, opt.cols) : await desdeCapturas(conn);
  console.log(`Observaciones: ${obs.length} (fuente: ${fuente})`);

  if (obs.length < 200) {
    console.log('\nMuestra insuficiente para calibrar. El validador seguirá operando');
    console.log('solo con reglas de formato, que es el comportamiento correcto.');
    console.log('Vuelva a correr cuando haya al menos ~2.000 capturas.');
    await conn.end();
    return;
  }

  let filas = interpolarVacios(construirBuckets(obs, opt.bucket));
  const usables = filas.filter(f => f.n_muestras >= MIN_MUESTRAS);
  const anomalias = detectarAnomalias(filas);

  console.log(`Buckets generados: ${filas.length} | con muestra suficiente: ${usables.length}`);
  if (anomalias.length) {
    console.log(`\n⚠ ${anomalias.length} buckets rompen la monotonía esperada:`);
    anomalias.slice(0, 10).forEach(a =>
      console.log(`   ${a.bucket}: p50=${a.p50} vs anterior ${a.p50_anterior}`));
    console.log('   Suele indicar datos de captura con fechas erróneas.');
  }

  if (opt.dryRun) {
    console.log('\n--- DRY RUN: buckets usables ---');
    usables.forEach(f => console.log(
      `  ${String(f.bucket_ini).padStart(12)} - ${String(f.bucket_fin).padStart(12)}  `
      + `p05=${f.anio_p05} p50=${f.anio_p50} p95=${f.anio_p95}  `
      + `sexo=${f.sexo_dominante ?? '-'}(${f.sexo_pct ?? '-'})  n=${f.n_muestras}`));
    await conn.end();
    return;
  }

  await conn.beginTransaction();
  try {
    await conn.query('DELETE FROM cedula_cohorte WHERE fuente <> ?', ['manual']);
    for (const f of filas) {
      await conn.query(
        `INSERT INTO cedula_cohorte
           (bucket_ini, bucket_fin, anio_p05, anio_p50, anio_p95,
            sexo_dominante, sexo_pct, n_muestras, fuente, calibrado_en)
         VALUES (?,?,?,?,?,?,?,?,?,NOW())
         ON DUPLICATE KEY UPDATE
           anio_p05=VALUES(anio_p05), anio_p50=VALUES(anio_p50), anio_p95=VALUES(anio_p95),
           sexo_dominante=VALUES(sexo_dominante), sexo_pct=VALUES(sexo_pct),
           n_muestras=VALUES(n_muestras), fuente=VALUES(fuente), calibrado_en=NOW()`,
        [f.bucket_ini, f.bucket_fin, f.anio_p05, f.anio_p50, f.anio_p95,
         f.sexo_dominante, f.sexo_pct, f.n_muestras, fuente]);
    }
    await conn.commit();
    console.log(`\nOK. ${filas.length} buckets escritos, ${usables.length} activos para validación.`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { construirBuckets, interpolarVacios, detectarAnomalias, percentil };
