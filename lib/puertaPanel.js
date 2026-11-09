/**
 * EL PANEL DEL PUERTA A PUERTA (parche 312, Fase 4): cuánto se ha recorrido, por zona y por visitante. Para el administrador y el coordinador; el
 * coordinador solo ve lo de su alcance (las listas que `lib/alcanceTareas.js` le deja ver). SOLO CONTEOS: ni nombres de votantes, ni direcciones, ni
 * «la lista de las casas visitadas». Lo que sale de aquí —en la pantalla y en el Excel— es lo mismo, y la prueba fija la lista CERRADA de columnas.
 *
 * LAS REGLAS (las de las encuestas, lib/encuestasResultados.js, que se reutilizan tal cual)
 *   1. MÍNIMO POR CELDA. Una celda es una zona. Se muestra solo si tiene al menos `minimoPorCelda()` VISITAS (5 de fábrica, configurable solo hacia
 *      arriba, el mismo número que usan las encuestas). Una zona con una o dos visitas, con resultados por tipo, señalaría a una casa.
 *      Una zona con CERO visitas en el período no tiene qué ocultar (solo dice cuántas puertas tiene asignadas): se muestra y no cuenta para el mínimo.
 *   2. «OTRAS ZONAS» PARA QUE NO SE PUEDA RESTAR. Las celdas chicas se suman en «Otras zonas»; el grupo se muestra solo si llega al mínimo (si no, se
 *      le suma la celda visible más pequeña, y así). Si ni todas juntas llegan, no se muestra ninguna zona ni el total.
 *   3. EL FILTRO POR FECHAS, con la FRANJA del día como MÁXIMO detalle. Desde, hasta y (opcional) mañana, tarde o noche: nunca una hora (la base ni
 *      la guarda). OJO, y es el precio de pedir este filtro: dos consultas que difieren en un día pueden restarse. El mínimo por celda se aplica a CADA
 *      consulta, así que cada cifra mostrada tiene siempre al menos 5 visitas detrás, pero una resta puede dejar al descubierto un grupo de 1 a 4 visitas
 *      de un día. Por eso un día de recorrido se lee como «un grupo de visitas», nunca como una casa.
 *   4. QUÉ SE CUENTA. «Listas» y «Puertas asignadas»: las de las listas creadas hasta la fecha «hasta» (o todas). «Puertas visitadas» y las visitas por
 *      resultado: solo las del período y la franja. «Por visitar», «Cerradas» y «Sin respuesta» por visitante son el estado de hoy (no cambian con el filtro).
 *   5. LA ZONA de una puerta es la de su ÚLTIMA visita (el barrio o la vereda de la ficha al momento de visitar) y, si nunca se visitó, la de la ficha hoy.
 *      Al vencer la retención (6 meses después de la elección) se corta el vínculo con la persona: las puertas nunca visitadas pasan a «Sin zona».
 */
'use strict';

const pool = require('../config/db');
const { alcanceTareas } = require('./alcanceTareas');
const Res = require('./encuestasResultados');
const R = require('../public/js/puerta-reglas');

const MARCA = 'Uso interno – no publicable';
const TIPOS = ['no_abrio', 'no_interesado', 'interesado', 'quiere_registrarse', 'solicitud', 'no_volver'];
const TIPO_TXT = { no_abrio: 'No abrió', no_interesado: 'No interesado', interesado: 'Interesado', quiere_registrarse: 'Quiere registrarse', solicitud: 'Dejó una solicitud', no_volver: 'Pidió no volver' };
const FRANJAS = ['manana', 'tarde', 'noche'];
const FRANJA_TXT = { manana: 'Mañana', tarde: 'Tarde', noche: 'Noche' };

/** Las claves de una fila de zona (y de «Otras zonas» y del total): lista CERRADA, la fija la prueba. */
const CLAVES_ZONA = ['zona', 'listas', 'asignadas', 'visitadas', 'visitas', ...TIPOS];
const CLAVES_VISITANTE = ['visitante', 'listas', 'asignadas', 'visitadas', 'por_visitar', 'cerradas', 'sin_respuesta', 'visitas'];
const COLUMNAS_ZONA = ['Zona', 'Listas', 'Puertas asignadas', 'Puertas visitadas', 'Visitas', ...TIPOS.map((t) => TIPO_TXT[t])];
const COLUMNAS_VISITANTE = ['Visitante', 'Listas', 'Puertas asignadas', 'Puertas visitadas', 'Por visitar', 'Cerradas', 'Sin respuesta', 'Visitas'];

const err = (estado, mensaje) => { const e = new Error(mensaje); e.estado = estado; e.mensaje = mensaje; return e; };
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Valida el filtro: { desde, hasta, franja } con null donde no hay. Lanza 400 si algo no es una fecha o una franja. */
function filtroDe(q) {
  const f = { desde: null, hasta: null, franja: null };
  for (const k of ['desde', 'hasta']) {
    const v = q && q[k] ? String(q[k]).trim() : '';
    if (!v) continue;
    if (!FECHA.test(v) || R.sumarDias(v, 0) !== v) throw err(400, `La fecha «${k}» tiene que ser un día válido (AAAA-MM-DD).`);
    f[k] = v;
  }
  if (f.desde && f.hasta && f.desde > f.hasta) throw err(400, 'La fecha «desde» no puede ser posterior a «hasta».');
  const fr = q && q.franja ? String(q.franja).trim() : '';
  if (fr) {
    if (!FRANJAS.includes(fr)) throw err(400, 'La franja del día es mañana, tarde o noche (no hay un detalle más fino que ése).');
    f.franja = fr;
  }
  return f;
}

const suma = (filas, k) => filas.reduce((t, f) => t + (Number(f[k]) || 0), 0);
const vacia = (zona) => ({ zona, listas: 0, asignadas: 0, visitadas: 0, visitas: 0, ...Object.fromEntries(TIPOS.map((t) => [t, 0])) });

/**
 * El panel. `alcance`: `req.alcance` de quien mira; `filtro`: lo de `filtroDe`.
 * Devuelve { marca, filtros, minimo, zonas, otras, total, oculto, celdas_omitidas, visitantes }.
 */
async function panel({ alcance, filtro = {} }) {
  const cond = alcanceTareas(alcance, 'l');
  const f = { desde: filtro.desde || null, hasta: filtro.hasta || null, franja: filtro.franja || null };
  const k = await Res.minimoPorCelda();

  // Las listas que cuentan: las del alcance, creadas hasta «hasta». Sus visitas se filtran por fecha y franja.
  const lcond = [cond.sql]; const lval = [...cond.valores];
  if (f.hasta) { lcond.push('DATE(l.creada_en) <= ?'); lval.push(f.hasta); }
  const vcond = [...lcond], vval = [...lval];
  if (f.desde) { vcond.push('pv.fecha >= ?'); vval.push(f.desde); }
  if (f.hasta) { vcond.push('pv.fecha <= ?'); vval.push(f.hasta); }
  if (f.franja) { vcond.push('pv.franja = ?'); vval.push(f.franja); }

  const [asig] = await pool.query(
    `SELECT z.zona, COUNT(*) AS asignadas, COUNT(DISTINCT z.lista_id) AS listas FROM (
        SELECT i.id, i.lista_id,
               COALESCE((SELECT pv2.territorio_id FROM puerta_visitas pv2 WHERE pv2.item_id = i.id AND pv2.territorio_id IS NOT NULL ORDER BY pv2.id DESC LIMIT 1), v.territorio_id, 0) AS zona
          FROM puerta_items i JOIN puerta_listas l ON l.id = i.lista_id LEFT JOIN votantes v ON v.id = i.votante_id
         WHERE ${lcond.join(' AND ')}) z GROUP BY z.zona`, lval);
  const [porTipo] = await pool.query(
    `SELECT COALESCE(pv.territorio_id, 0) AS zona, pv.resultado, COUNT(*) AS n
       FROM puerta_visitas pv JOIN puerta_listas l ON l.id = pv.lista_id WHERE ${vcond.join(' AND ')} GROUP BY zona, pv.resultado`, vval);
  const [puertas] = await pool.query(
    `SELECT COALESCE(pv.territorio_id, 0) AS zona, COUNT(DISTINCT pv.item_id) AS visitadas
       FROM puerta_visitas pv JOIN puerta_listas l ON l.id = pv.lista_id WHERE ${vcond.join(' AND ')} GROUP BY zona`, vval);

  const porZona = new Map();
  const de = (z) => { if (!porZona.has(Number(z))) porZona.set(Number(z), vacia(null)); return porZona.get(Number(z)); };
  asig.forEach((a) => { const c = de(a.zona); c.asignadas = Number(a.asignadas); c.listas = Number(a.listas); });
  porTipo.forEach((a) => { const c = de(a.zona); c[a.resultado] = Number(a.n); c.visitas += Number(a.n); });
  puertas.forEach((a) => { de(a.zona).visitadas = Number(a.visitadas); });

  const ids = [...porZona.keys()].filter((z) => z > 0);
  const nombres = new Map();
  if (ids.length) {
    const [ts] = await pool.query('SELECT id, nombre FROM territorios WHERE id IN (?)', [ids]);
    ts.forEach((t) => nombres.set(Number(t.id), t.nombre));
  }
  const celdas = [...porZona.entries()].map(([z, c]) => ({ ...c, zona: z > 0 && nombres.has(z) ? nombres.get(z) : 'Sin zona', n: c.visitas, nombre: z > 0 && nombres.has(z) ? nombres.get(z) : 'Sin zona' }));

  const visitasTotal = suma(celdas, 'visitas');
  // Una zona SIN ninguna visita en el período no dice nada de nadie (solo cuántas puertas tiene asignadas): se muestra tal cual y no cuenta para el mínimo.
  const conVisitas = celdas.filter((c) => c.n > 0), sinVisitas = celdas.filter((c) => c.n === 0).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  let zonas = [], otras = null, total = null, oculto = false, omitidas = 0;
  if (visitasTotal < k) {
    oculto = true;                                                   // ni una zona ni el total: con tan pocas visitas, cualquier cifra señala a una casa
  } else {
    const r = Res.aplicarMinimo(conVisitas, k);
    oculto = r.oculto;
    if (!oculto) {
      const fila = (c) => { const o = {}; CLAVES_ZONA.forEach((key) => { o[key] = c[key]; }); return o; };
      zonas = r.visibles.concat(sinVisitas).map(fila);
      if (r.otras) {
        omitidas = r.otras.length;
        otras = { ...fila({ ...vacia(`Otras zonas (${omitidas})`), ...Object.fromEntries(CLAVES_ZONA.filter((x) => x !== 'zona').map((x) => [x, suma(r.otras, x)])) }), zonas: omitidas };
      }
      const todas = r.visibles.concat(r.otras || [], sinVisitas);
      total = fila({ ...vacia('Total'), ...Object.fromEntries(CLAVES_ZONA.filter((x) => x !== 'zona').map((x) => [x, suma(todas, x)])) });
      // «Listas» no se suma entre zonas (una lista puede cubrir varias): el total cuenta las listas distintas.
      const [[dl]] = await pool.query(`SELECT COUNT(*) AS n FROM puerta_listas l WHERE ${lcond.join(' AND ')}`, lval);
      total.listas = Number(dl.n);
    }
  }

  // Avance por visitante: solo conteos.
  const [vis] = await pool.query(
    `SELECT l.asignada_a AS uid, COUNT(DISTINCT l.id) AS listas, COUNT(i.id) AS asignadas,
            COALESCE(SUM(i.estado = 'pendiente'), 0) AS por_visitar, COALESCE(SUM(i.estado = 'cerrada'), 0) AS cerradas, COALESCE(SUM(i.estado = 'agotada'), 0) AS sin_respuesta
       FROM puerta_listas l LEFT JOIN puerta_items i ON i.lista_id = l.id WHERE ${lcond.join(' AND ')} GROUP BY l.asignada_a`, lval);
  const [visVis] = await pool.query(
    `SELECT pv.registrada_por AS uid, COUNT(*) AS visitas, COUNT(DISTINCT pv.item_id) AS visitadas
       FROM puerta_visitas pv JOIN puerta_listas l ON l.id = pv.lista_id WHERE ${vcond.join(' AND ')} GROUP BY pv.registrada_por`, vval);
  const porUid = new Map();
  const dev = (u) => { const key = u === null || u === undefined ? 0 : Number(u); if (!porUid.has(key)) porUid.set(key, { uid: key, listas: 0, asignadas: 0, visitadas: 0, por_visitar: 0, cerradas: 0, sin_respuesta: 0, visitas: 0 }); return porUid.get(key); };
  vis.forEach((a) => Object.assign(dev(a.uid), { listas: Number(a.listas), asignadas: Number(a.asignadas), por_visitar: Number(a.por_visitar), cerradas: Number(a.cerradas), sin_respuesta: Number(a.sin_respuesta) }));
  visVis.forEach((a) => Object.assign(dev(a.uid), { visitas: Number(a.visitas), visitadas: Number(a.visitadas) }));
  const uids = [...porUid.keys()].filter((u) => u > 0);
  const nom = new Map();
  if (uids.length) { const [us] = await pool.query('SELECT id, nombre FROM usuarios WHERE id IN (?)', [uids]); us.forEach((u) => nom.set(Number(u.id), u.nombre)); }
  const visitantes = [...porUid.values()].map((v) => {
    const o = { visitante: v.uid > 0 ? (nom.get(v.uid) || '(cuenta eliminada)') : '(cuenta eliminada)' };
    CLAVES_VISITANTE.slice(1).forEach((key) => { o[key] = v[key]; });
    return o;
  }).sort((a, b) => b.visitas - a.visitas || b.asignadas - a.asignadas || String(a.visitante).localeCompare(String(b.visitante), 'es'));

  return { marca: MARCA, filtros: f, minimo: k, zonas, otras, total, oculto, celdas_omitidas: omitidas, visitantes };
}

/** El libro de Excel como hojas de filas (aoa): Notas, Cobertura por zona y Avance por visitante. Cada hoja empieza con la marca. */
function hojasDeExcel(p, { fecha, generador, alcanceTexto }) {
  const f = p.filtros;
  const notas = [
    [MARCA], [],
    ['Puerta a puerta: cobertura y avance'],
    ['Generado el', fecha],
    ['Quién lo pidió ve', alcanceTexto],
    ['Desde', f.desde || 'sin límite'], ['Hasta', f.hasta || 'sin límite'], ['Franja del día', f.franja ? FRANJA_TXT[f.franja] : 'todo el día'],
    ['Mínimo de visitas por celda', p.minimo],
    [], ['Cómo leer este archivo'],
    [`Una celda es una zona. Solo se muestra si tiene al menos ${p.minimo} visitas; las demás se agrupan en «Otras zonas» y, si no suman ${p.minimo}, no se muestran.`],
    ['Es un archivo agregado: nunca trae una lista de casas ni de personas, ni direcciones, ni nombres de votantes.'],
    ['La zona de una puerta es la de su última visita; las puertas nunca visitadas, la de la ficha.'],
    ['Por visitar, cerradas y sin respuesta (por visitante) son el estado de hoy y no cambian con el filtro de fechas.'],
    ['Generado por', generador],
  ];
  const zon = [[MARCA], [], COLUMNAS_ZONA];
  if (p.oculto) zon.push([`Todavía hay menos de ${p.minimo} visitas: no se muestra ninguna zona.`]);
  const a = (z) => CLAVES_ZONA.map((key) => z[key]);
  p.zonas.forEach((z) => zon.push(a(z)));
  if (p.otras) zon.push(a(p.otras));
  if (p.total) zon.push(a(p.total));
  const vis = [[MARCA], [], COLUMNAS_VISITANTE];
  p.visitantes.forEach((v) => vis.push(CLAVES_VISITANTE.map((key) => v[key])));
  return { Notas: notas, 'Cobertura por zona': zon, 'Avance por visitante': vis };
}

module.exports = { MARCA, TIPOS, TIPO_TXT, FRANJAS, FRANJA_TXT, CLAVES_ZONA, CLAVES_VISITANTE, COLUMNAS_ZONA, COLUMNAS_VISITANTE, filtroDe, panel, hojasDeExcel };
