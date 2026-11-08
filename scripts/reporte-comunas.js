#!/usr/bin/env node
/**
 * scripts/reporte-comunas.js — Informe de SOLO LECTURA sobre la comuna/corregimiento de las fichas (orden 36).
 *
 * NO MODIFICA NADA: ni una ficha, ni la base. Corre contra la base del `.env` de la carpeta donde se ejecute, así
 * que se corre una vez en cada campaña.
 *
 * USO (desde la carpeta de la instalación, con el node de su cuenta):
 *     node scripts/reporte-comunas.js            # los 100 primeros valores de cada lista
 *     node scripts/reporte-comunas.js --todos    # todos
 *     node scripts/reporte-comunas.js --json     # lo mismo en JSON (para guardarlo)
 *
 * QUÉ DICE
 *   a. LA LISTA DE LA CAMPAÑA: cuántas comunas y corregimientos tiene (las de la vista `territorios`). Sin lista no hay
 *      contra qué comprobar: el texto es libre y las altas nuevas no lo validan.
 *   b. LOS VALORES FUERA DE LA LISTA en `votantes.comuna_corregimiento_residencia`: cada texto distinto, cuántas fichas
 *      lo tienen y si coincide con la CIUDAD o el DEPARTAMENTO de la campaña (el caso «MANIZALES» / «Caldas»).
 *      Con lista, «fuera de la lista» es todo lo que no es una de sus comunas; sin lista sólo se señalan los que
 *      coinciden con una ciudad o un departamento, que son erróneos con o sin lista.
 *   c. LO MISMO PARA `usuarios` (Estructura): de ahí se copia el texto a Votantes al sincronizar.
 *   d. LAS FICHAS QUE EL DASHBOARD AGRUPA EN «SIN COMUNA»: las que tienen territorio pero ese territorio no es una
 *      comuna/corregimiento ni cuelga de uno (veredas del DANE bajo el municipio, fichas «de todo el municipio»).
 *      El dashboard NO lee el texto de comuna, lee el árbol de territorios; por eso «MANIZALES» (6) o «Caldas» (2) en
 *      «Por Comuna» salían del padre del territorio y no de este campo.
 *
 * CÓDIGO DE SALIDA: 0 = sin valores erróneos; 2 = hay; 1 = falló. No corrige nada: eso se decide aparte.
 */
'use strict';

/* La regla de comparar nombres vive en lib/comunasDeLaCampana.js (viaja en el parche 287). El reporte se corre también ANTES de aplicarlo,
   cuando ese archivo todavía no existe en la campaña: entonces usa esta copia, idéntica. */
let normalizarNombre;
try { ({ normalizarNombre } = require('../lib/comunasDeLaCampana')); } catch (_) {
  normalizarNombre = (t) => String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Lee una lista de nombres de territorio de un tipo dado; sin la vista, vacía. */
async function nombresDe(cx, tipos) {
  try {
    const [f] = await cx.query(`SELECT nombre FROM territorios WHERE tipo IN (${tipos.map(() => '?').join(',')})`, tipos);
    return f.map((x) => x.nombre);
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
    return [];
  }
}

/** Valores distintos de una columna de texto, con su cantidad. */
async function valoresDe(cx, tabla) {
  const [f] = await cx.query(
    `SELECT comuna_corregimiento_residencia AS valor, COUNT(*) AS fichas FROM ${tabla}
      WHERE comuna_corregimiento_residencia IS NOT NULL AND TRIM(comuna_corregimiento_residencia) <> ''
      GROUP BY comuna_corregimiento_residencia ORDER BY fichas DESC, valor`);
  return f.map((x) => ({ valor: x.valor, fichas: Number(x.fichas) }));
}

/**
 * Clasifica los valores de una tabla. Función pura: `valores` = [{valor, fichas}].
 * @returns {{con_valor:number, fuera_de_lista:object[], total_fuera:number}}
 */
function clasificar(valores, ctx) {
  const lista = new Set(ctx.comunas.map(normalizarNombre));
  const ciudades = new Set(ctx.ciudades.map(normalizarNombre));
  const departamentos = new Set(ctx.departamentos.map(normalizarNombre));
  const fuera = [];
  let conValor = 0;
  for (const v of valores) {
    conValor += v.fichas;
    const n = normalizarNombre(v.valor);
    const esCiudad = ciudades.has(n);
    const esDepto = departamentos.has(n);
    const enLista = lista.has(n);
    // Con lista: lo que no está en ella. Sin lista: sólo lo que es claramente una ciudad o un departamento.
    const sobra = ctx.comunas.length > 0 ? !enLista : (esCiudad || esDepto);
    if (!sobra) continue;
    fuera.push({
      valor: v.valor, fichas: v.fichas,
      coincide_con: esCiudad && esDepto ? 'ciudad y departamento' : esCiudad ? 'ciudad' : esDepto ? 'departamento' : 'ninguno',
    });
  }
  return { con_valor: conValor, fuera_de_lista: fuera, total_fuera: fuera.reduce((a, x) => a + x.fichas, 0) };
}

/**
 * @param cx pool o conexión mysql2/promise
 * @param {{limite?: number}} [opciones]  limite = valores a detallar por lista (0 o undefined = todos)
 */
async function reporte(cx, { limite = 0 } = {}) {
  const comunas = await nombresDe(cx, ['comuna', 'corregimiento']);
  const ciudades = await nombresDe(cx, ['municipio']);
  const departamentos = await nombresDe(cx, ['departamento']);
  // Lo que la campaña declaró en Configuración también cuenta como «la ciudad» y «el departamento» de la campaña.
  try {
    const [[c]] = await cx.query(
      'SELECT territorio_departamento, territorio_ciudad, departamento, ciudad FROM configuracion_campana WHERE id = 1');
    if (c) {
      for (const x of [c.territorio_ciudad, c.ciudad]) if (x) ciudades.push(x);
      for (const x of [c.territorio_departamento, c.departamento]) if (x) departamentos.push(x);
    }
  } catch (err) { if (err.code !== 'ER_NO_SUCH_TABLE' && err.code !== 'ER_BAD_FIELD_ERROR') throw err; }
  const ctx = { comunas, ciudades, departamentos };

  const [[tot]] = await cx.query('SELECT COUNT(*) AS fichas FROM votantes');
  const votantes = clasificar(await valoresDe(cx, 'votantes'), ctx);
  const estructura = clasificar(await valoresDe(cx, 'usuarios'), ctx);

  // d. fichas con territorio que el dashboard agrupa en «Sin comuna», por tipo de territorio y de su padre.
  let sinComuna = { total: 0, detalle: [], sin_territorio: 0 };
  try {
    const [det] = await cx.query(`
      SELECT t.tipo AS tipo_territorio, COALESCE(padre.tipo, '(sin padre)') AS tipo_padre, COUNT(*) AS fichas
        FROM votantes v
        JOIN territorios t ON t.id = v.territorio_id
        LEFT JOIN territorios padre ON padre.id = t.padre_id
       WHERE NOT (t.tipo IN ('comuna','corregimiento') OR padre.tipo IN ('comuna','corregimiento'))
       GROUP BY t.tipo, COALESCE(padre.tipo, '(sin padre)') ORDER BY fichas DESC`);
    const [[st]] = await cx.query('SELECT COUNT(*) AS n FROM votantes WHERE territorio_id IS NULL');
    sinComuna = {
      total: det.reduce((a, x) => a + Number(x.fichas), 0),
      detalle: det.map((x) => ({ territorio: x.tipo_territorio, padre: x.tipo_padre, fichas: Number(x.fichas) })),
      sin_territorio: Number(st.n),
    };
  } catch (err) { if (err.code !== 'ER_NO_SUCH_TABLE') throw err; }

  const recorta = (a) => (limite > 0 ? a.slice(0, limite) : a);
  return {
    fichas: Number(tot.fichas),
    comunas_en_lista: comunas.length,
    votantes: { ...votantes, fuera_de_lista: recorta(votantes.fuera_de_lista), distintos_fuera: votantes.fuera_de_lista.length },
    estructura: { ...estructura, fuera_de_lista: recorta(estructura.fuera_de_lista), distintos_fuera: estructura.fuera_de_lista.length },
    sin_comuna_en_dashboard: sinComuna,
  };
}

function imprimir(r, base) {
  const f = (n) => Number(n).toLocaleString('es-CO');
  const L = [];
  L.push(`REPORTE DE COMUNAS — base «${base}» — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} (solo lectura)`);
  L.push('');
  L.push(`Fichas en votantes ............................ ${f(r.fichas)}`);
  L.push(`Comunas y corregimientos de la campaña ........ ${f(r.comunas_en_lista)}${r.comunas_en_lista ? '' : '   (sin lista: el texto es libre y las altas nuevas no lo validan)'}`);
  L.push('');
  const bloque = (titulo, b) => {
    L.push(titulo);
    L.push(`   fichas con comuna escrita: ${f(b.con_valor)}   fuera de lista: ${f(b.total_fuera)} fichas en ${f(b.distintos_fuera)} valor(es) distinto(s)`);
    for (const x of b.fuera_de_lista) L.push(`   · «${x.valor}» — ${f(x.fichas)} ficha(s) — coincide con: ${x.coincide_con}`);
    if (b.distintos_fuera > b.fuera_de_lista.length) L.push(`   … y ${f(b.distintos_fuera - b.fuera_de_lista.length)} valores más (use --todos para verlos).`);
    L.push('');
  };
  bloque('b. VOTANTES — comuna_corregimiento_residencia fuera de la lista', r.votantes);
  bloque('c. ESTRUCTURA (usuarios) — comuna_corregimiento_residencia fuera de la lista', r.estructura);
  L.push('d. FICHAS QUE EL DASHBOARD AGRUPA EN «SIN COMUNA» (tienen territorio, pero no es ni cuelga de una comuna/corregimiento)');
  L.push(`   en total: ${f(r.sin_comuna_en_dashboard.total)}   (fichas sin ningún territorio, que el dashboard no cuenta: ${f(r.sin_comuna_en_dashboard.sin_territorio)})`);
  for (const x of r.sin_comuna_en_dashboard.detalle) L.push(`   · territorio ${x.territorio} bajo ${x.padre} — ${f(x.fichas)} ficha(s)`);
  L.push('');
  const malas = r.votantes.total_fuera;
  L.push(malas
    ? `RESULTADO: ${f(malas)} ficha(s) con una comuna que no es de la campaña. No se corrigió nada: se decide aparte.`
    : 'RESULTADO: ninguna ficha de Votantes con una comuna que no sea de la campaña.');
  return L.join('\n');
}

module.exports = { reporte, imprimir, clasificar };

if (require.main === module) {
  require('dotenv').config();
  const args = process.argv.slice(2);
  const pool = require('../config/db');
  (async () => {
    const [[b]] = await pool.query('SELECT DATABASE() AS nombre');
    const r = await reporte(pool, { limite: args.includes('--todos') ? 0 : 100 });
    console.log(args.includes('--json') ? JSON.stringify({ base: b.nombre, ...r }, null, 2) : imprimir(r, b.nombre));
    await pool.end();
    process.exit(r.votantes.total_fuera ? 2 : 0);
  })().catch(async (e) => {
    console.error('No se pudo generar el reporte:', e.code || e.message);
    try { await pool.end(); } catch (_) { /* ya cerrado */ }
    process.exit(1);
  });
}
