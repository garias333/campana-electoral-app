/**
 * A QUÉ PUESTO PERTENECE UN REPORTE (o una cifra oficial) — la ÚNICA función que lo decide.
 *
 * El tablero del Día D agrupa por el TEXTO `puesto_votacion`, y eso tiene un defecto que se
 * paga caro en un consolidado: el mismo puesto escrito de dos maneras («COLEGIO  SAN JOSE»,
 * «Colegio San José») son dos puestos, y sus mesas se cuentan dos veces. Los reportes
 * anteriores a la fase 1 no tienen `puesto_id`, y nunca se rellenó retroactivamente.
 *
 * LA REGLA, en este orden:
 *   1. `puesto_id`, si el reporte lo trae Y ese id está en la lista de puestos DE ESTA
 *      campaña (un id de otra campaña, o inventado, no cuenta).
 *   2. Si no, coincidencia EXACTA NORMALIZADA del texto con el nombre de un puesto de la
 *      lista: mayúsculas, sin tildes y sin espacios dobles. Exacta: «COLEGIO SAN JOSE» no
 *      es «COLEGIO SAN JOSE DE LA MONTAÑA». Un parecido NO basta (el error más caro del
 *      catálogo fue un prefijo que se comió al más largo: ver CLAUDE.md).
 *   3. Si no coincide, «Fuera de lista», con el texto ORIGINAL.
 *
 * RESPALDO OPCIONAL POR `ctc_puesto_id` (orden 127, solo si se pide: `{ porCtc: true }`). Entre el paso 2 y el 3
 * se mira el id del puesto en el CATÁLOGO de la fila (`fila.ctc_puesto_id`) contra el de cada puesto de la lista.
 * Existe para los votantes de una campaña departamental: sus puestos se siembran con el municipio pegado
 * («LA FLORESTA (SALAMINA)») y el texto que el votante eligió en el catálogo no lleva el sufijo, así que el nombre
 * exacto no cruza; el id sí. Va DESPUÉS del nombre y APAGADO por omisión: la jornada (reportes y oficial) no trae
 * `ctc_puesto_id` y su comportamiento no cambia ni un carácter.
 *
 * NO REESCRIBE NADA: es una deducción al consultar. Los reportes viejos quedan como están.
 *
 * MUNICIPIO Y DEPARTAMENTO salen del catálogo territorial por `ctc_puesto_id`; sin él, «Sin
 * municipio». No salen del texto que el cliente mandó en el reporte (no se valida).
 */
'use strict';

/** Mayúsculas, sin tildes, sin espacios dobles. Se usa para comparar, nunca para mostrar. */
function normalizar(texto) {
  return String(texto == null ? '' : texto)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * @param {Array<{id:number, nombre:string, cantidad_mesas:number, ctc_puesto_id?:number}>} puestos
 *        la lista de puestos de la campaña (dia_d_puestos_votacion).
 * @param {{porCtc?: boolean}} [opciones]  `porCtc: true` activa el respaldo por `ctc_puesto_id` (ver arriba).
 * @returns {(fila:{puesto_id?:number|null, puesto_votacion?:string}) =>
 *           {clave:string, puesto:object|null, nombre:string, fuera:boolean}}
 */
function crearResolutorDePuestos(puestos, opciones = {}) {
  const porCtc = opciones && opciones.porCtc ? new Map() : null;
  const porId = new Map();
  const porNombre = new Map();
  for (const p of puestos || []) {
    porId.set(Number(p.id), p);
    const k = normalizar(p.nombre);
    // Dos puestos de la lista no pueden llamarse igual (uq_puesto_nombre), pero si por algún
    // motivo pasara, gana el primero: más vale uno que un empate al azar.
    if (!porNombre.has(k)) porNombre.set(k, p);
    // `ctc_puesto_id` es único por campaña (uq_dia_d_puestos_ctc); si algo lo duplicara, gana el primero.
    if (porCtc && p.ctc_puesto_id && !porCtc.has(Number(p.ctc_puesto_id))) porCtc.set(Number(p.ctc_puesto_id), p);
  }
  return function resolver(fila) {
    const id = Number(fila && fila.puesto_id);
    let p = id && porId.has(id) ? porId.get(id) : null;
    if (!p) p = porNombre.get(normalizar(fila && fila.puesto_votacion)) || null;
    if (!p && porCtc && fila && fila.ctc_puesto_id) p = porCtc.get(Number(fila.ctc_puesto_id)) || null;
    if (p) return { clave: `p${p.id}`, puesto: p, nombre: p.nombre, fuera: false };
    const texto = String((fila && fila.puesto_votacion) || '').trim();
    return { clave: `t${normalizar(texto)}`, puesto: null, nombre: texto || '(sin puesto)', fuera: true };
  };
}

/**
 * Municipio y departamento de cada puesto de la lista: Map(puesto.id → {municipio, departamento}).
 * Un puesto sin `ctc_puesto_id`, o si el catálogo no se puede leer, no aparece en el mapa: el
 * llamador dice «Sin municipio». Que falle el catálogo no puede tumbar el consolidado.
 */
async function cargarMunicipios(pool, puestos, catalogo = process.env.CATALOGO_DB || 'territoriosdb') {
  const salida = new Map();
  const conCatalogo = (puestos || []).filter(p => p.ctc_puesto_id);
  if (!conCatalogo.length) return salida;
  try {
    const [filas] = await pool.query(
      `SELECT p.id AS puesto_id, m.nombre AS municipio, d.nombre AS departamento
         FROM dia_d_puestos_votacion p
         JOIN ${catalogo}.ctc_puestos_votacion cp ON cp.id = p.ctc_puesto_id
         JOIN ${catalogo}.ctc_territorios m ON m.id = cp.municipio_id
         LEFT JOIN ${catalogo}.ctc_territorios d ON d.id = m.padre_id
        WHERE p.id IN (?)`, [conCatalogo.map(p => p.id)]);
    for (const f of filas) salida.set(Number(f.puesto_id), { municipio: f.municipio, departamento: f.departamento || '' });
  } catch (err) {
    console.warn('No se pudo leer el municipio de los puestos desde el catálogo:', err.code || err.message);
  }
  return salida;
}

module.exports = { normalizar, crearResolutorDePuestos, cargarMunicipios };
