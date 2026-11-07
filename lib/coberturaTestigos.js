/**
 * Cobertura de testigos: QUIÉN CUBRE QUÉ MESA de cada puesto, calculado en UN solo sitio.
 *
 * Lo usan dos consumidores —GET /api/dia-d/config/puestos-votacion (la tabla de cobertura) y
 * routes/coberturaTestigos.routes.js (la ventana de asignación, los sugeridos, el Excel y el aviso)—.
 * Dos copias de esto se separan solas, y aquí separarse significa que la tabla diga «mesa cubierta» y la
 * ventana diga «mesa libre» para el mismo puesto el día de la elección.
 *
 * DÓNDE SE GUARDA HOY QUÉ MESA CUBRE UN TESTIGO (y se respeta tal cual, no se inventa otro formato):
 *   · `estructura` con `cargo = 'testigo'`.
 *   · `tipo_testigo = 'mesa'`   → UNA mesa, en `mesa_votacion`.
 *   · `tipo_testigo = 'puesto'` → varias (el «Coordinador de puesto»), en la lista JSON `mesas_asignadas`;
 *                                 su `mesa_votacion` se ignora.
 *   · puesto y mesa se leen con COALESCE(estructura, usuarios): un testigo PURO los guarda en `usuarios`;
 *     quien es además líder o sublíder los guarda en `estructura`, para no pisar su lugar de votación.
 *
 * EL PUESTO SE CRUZA POR ID, y por el texto normalizado sólo como respaldo. La versión anterior de la tabla
 * lo cruzaba SOLO por texto, así que un puesto escrito distinto en la ficha del testigo («LA FLORESTA» frente
 * a «LA FLORESTA (SALAMINA)») dejaba sus mesas «sin testigo» teniéndolo. El mismo criterio de
 * `verificarMesasDisponibles` (config/testigoElectoral.js), que ya cruzaba por id.
 */
'use strict';

const { normalizar } = require('./puestosDiaD');
const { subarbolSql, filtroTestigosMadre } = require('./ramas');

/** Las mesas (números) que cubre una fila de testigo, según su tipo. */
function mesasDeFila(f) {
  if (f.tipo_testigo === 'puesto') {
    let lista = f.mesas_asignadas;
    if (typeof lista === 'string') { try { lista = JSON.parse(lista); } catch (_) { lista = []; } }
    return [...new Set((Array.isArray(lista) ? lista : []).map(Number).filter(n => Number.isInteger(n) && n > 0))]
      .sort((a, b) => a - b);
  }
  const m = Number(f.mesa_votacion);
  return Number.isInteger(m) && m > 0 ? [m] : [];
}

/** Iniciales para la ficha de la mesa: «Ana María Pérez» → «AP». */
function inicialesDe(nombre) {
  const t = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!t.length) return '?';
  const primera = t[0][0] || '';
  const ultima = t.length > 1 ? (t[t.length > 3 ? 2 : t.length - 1][0] || '') : '';
  return (primera + ultima).toUpperCase();
}

/** «1», «1 y 2», «1, 2 y 3»: para decirle sus mesas a una persona. */
function listaEnPalabras(mesas) {
  const m = (mesas || []).map(String);
  if (m.length <= 1) return m.join('');
  return `${m.slice(0, -1).join(', ')} y ${m[m.length - 1]}`;
}

/** La condición de «testigos de ESTA campaña» (la rama del aspirante, o la madre sin las ramas). */
async function acotaDeLaCampana(conexion, dueno) {
  return dueno ? subarbolSql(dueno, 'e.usuario_id') : await filtroTestigosMadre(conexion, 'e.usuario_id');
}

/** Todos los testigos de la campaña, con lo necesario para saber qué cubren. */
async function cargarTestigos(conexion, dueno) {
  const acota = await acotaDeLaCampana(conexion, dueno);
  const [filas] = await conexion.query(`
    SELECT e.id AS estructura_id, e.usuario_id, e.tipo_testigo, e.mesas_asignadas, e.activo,
           COALESCE(e.puesto_id, u.puesto_id) AS puesto_id,
           COALESCE(e.puesto_votacion, u.puesto_votacion) AS puesto_texto,
           COALESCE(e.mesa_votacion, u.mesa_votacion) AS mesa_votacion,
           COALESCE(e.departamento_votacion, u.departamento_votacion) AS departamento,
           COALESCE(e.municipio_votacion, u.municipio_votacion) AS municipio,
           u.nombre, u.telefono, u.email, u.numero_identificacion, u.no_contactar
      FROM estructura e JOIN usuarios u ON u.id = e.usuario_id
     WHERE e.cargo = 'testigo'
       ${acota ? 'AND ' + acota.sql : ''}
     ORDER BY u.nombre`, acota ? acota.valores : []);
  return filas.map(f => ({ ...f, mesas: mesasDeFila(f), iniciales: inicialesDe(f.nombre) }));
}

/**
 * Reparte los testigos entre los puestos de la campaña: Map(puesto.id → testigos[]). Por id si el id es de
 * ESTA campaña; si no, por el texto normalizado exacto. Un testigo sin puesto reconocido no entra en ninguno.
 * Un testigo con `mesas = []` también se reparte (es del puesto, aunque todavía no cubra mesa).
 */
function repartirPorPuesto(testigos, puestos) {
  const porId = new Map();
  const porNombre = new Map();
  for (const p of puestos) {
    porId.set(Number(p.id), p);
    const k = normalizar(p.nombre);
    if (!porNombre.has(k)) porNombre.set(k, p);
  }
  const salida = new Map(puestos.map(p => [Number(p.id), []]));
  for (const t of testigos) {
    let p = t.puesto_id && porId.has(Number(t.puesto_id)) ? porId.get(Number(t.puesto_id)) : null;
    if (!p) p = porNombre.get(normalizar(t.puesto_texto)) || null;
    if (p) salida.get(Number(p.id)).push(t);
  }
  return salida;
}

/**
 * El detalle de UN puesto: qué testigo cubre cada mesa, cuántos votantes propios hay en cada una y cuántos
 * quedan sin cubrir.
 *
 * `votantesPorMesa` es Map(mesa → cantidad) de los votantes propios que dicen votar ahí (el mismo dato del
 * «Votantes estimados por puesto»: si cada pantalla contara por su cuenta dirían cifras distintas del mismo
 * hecho). `sinMesa` son los de ese puesto sin una mesa reconocida: no se pueden cubrir asignando una mesa, así
 * que no cuentan como «sin cubrir» —no se arreglan asignando a nadie— pero SÍ restan del porcentaje cubierto.
 */
function armarDetallePuesto(puesto, testigosDelPuesto, votantesPorMesa, sinMesa, limite) {
  const cubre = new Map();            // mesa → testigo (el primero gana; un duplicado se marca)
  const duplicadas = new Set();
  for (const t of testigosDelPuesto) {
    for (const m of t.mesas) {
      if (cubre.has(m) && cubre.get(m).estructura_id !== t.estructura_id) duplicadas.add(m);
      else cubre.set(m, t);
    }
  }
  const mesas = [];
  let cubiertas = 0;
  let votantesCubiertos = 0;
  let votantesSinCubrir = 0;
  for (let m = 1; m <= Number(puesto.cantidad_mesas); m++) {
    const t = cubre.get(m) || null;
    const votantes = (votantesPorMesa && votantesPorMesa.get(m)) || 0;
    if (t) { cubiertas++; votantesCubiertos += votantes; } else { votantesSinCubrir += votantes; }
    mesas.push({
      mesa: m, votantes,
      testigo_id: t ? t.estructura_id : null,
      testigo_usuario_id: t ? t.usuario_id : null,
      testigo: t ? t.nombre : null,
      iniciales: t ? t.iniciales : null,
      duplicada: duplicadas.has(m) || undefined,
    });
  }
  const testigos = testigosDelPuesto.map(t => ({
    estructura_id: t.estructura_id, usuario_id: t.usuario_id, nombre: t.nombre, iniciales: t.iniciales,
    telefono: t.telefono || '', tipo: t.tipo_testigo, mesas: t.mesas, activo: !!t.activo,
    // Pasarse del límite NO bloquea nada: avisa. Un testigo con diez mesas no vigila ninguna.
    excede_limite: t.mesas.length > limite,
  }));
  return {
    mesas_detalle: mesas,
    testigos_puesto: testigos,
    mesas_cubiertas: cubiertas,
    votantes_cubiertos: votantesCubiertos,
    votantes_sin_cubrir: votantesSinCubrir,
    votantes_sin_mesa: sinMesa || 0,
  };
}

/** El límite de mesas por testigo (Configuración → Día D). 3 de fábrica; si la columna aún no existe, también. */
async function leerLimiteDeMesas(conexion) {
  try {
    const [[c]] = await conexion.query(`SELECT max_mesas_por_testigo AS n FROM configuracion_campana WHERE id = 1`);
    const n = Number(c && c.n);
    return Number.isInteger(n) && n >= 1 ? n : 3;
  } catch (_) { return 3; }
}

/* LA UBICACIÓN DE CADA PUESTO EN EL CATÁLOGO: municipio y, si el catálogo la trae, comuna.
   La comuna NO está garantizada: la tabla `ctc_puestos_votacion` del catálogo cambia en otro repositorio y aquí
   no se puede asumir una columna. Se pregunta a INFORMATION_SCHEMA qué hay y sólo se usa lo que exista
   (`comuna_id` que apunta a `ctc_territorios`, o una columna `comuna` de texto); si no hay nada, el filtro de
   comuna simplemente no se ofrece. Perder el filtro es aceptable; perder la tabla de cobertura, no. */
let columnasCatalogo = null;
async function columnasDeComuna(conexion, catalogo) {
  if (columnasCatalogo) return columnasCatalogo;
  columnasCatalogo = { comuna_id: false, comuna: false };
  try {
    const [filas] = await conexion.query(
      `SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ctc_puestos_votacion' AND COLUMN_NAME IN ('comuna_id', 'comuna')`,
      [catalogo]);
    for (const f of filas) columnasCatalogo[f.c] = true;
  } catch (_) { /* sin información: sin comuna */ }
  return columnasCatalogo;
}

async function cargarUbicaciones(conexion, puestos, catalogo = process.env.CATALOGO_DB || 'territoriosdb') {
  const salida = new Map();
  const conCatalogo = (puestos || []).filter(p => p.ctc_puesto_id);
  if (!conCatalogo.length) return salida;
  try {
    const col = await columnasDeComuna(conexion, catalogo);
    const comuna = col.comuna_id ? 'c.nombre' : (col.comuna ? 'cp.comuna' : 'NULL');
    const [filas] = await conexion.query(
      `SELECT p.id AS puesto_id, cp.municipio_id, m.nombre AS municipio, ${comuna} AS comuna
         FROM dia_d_puestos_votacion p
         JOIN ${catalogo}.ctc_puestos_votacion cp ON cp.id = p.ctc_puesto_id
         JOIN ${catalogo}.ctc_territorios m ON m.id = cp.municipio_id
         ${col.comuna_id ? `LEFT JOIN ${catalogo}.ctc_territorios c ON c.id = cp.comuna_id` : ''}
        WHERE p.id IN (?)`, [conCatalogo.map(p => p.id)]);
    for (const f of filas) {
      salida.set(Number(f.puesto_id), {
        municipio_id: f.municipio_id, municipio: f.municipio, comuna: f.comuna || null,
      });
    }
  } catch (err) {
    console.warn('No se pudo leer la ubicación de los puestos desde el catálogo:', err.code || err.message);
  }
  return salida;
}

module.exports = {
  mesasDeFila, inicialesDe, listaEnPalabras, acotaDeLaCampana, cargarTestigos, repartirPorPuesto,
  armarDetallePuesto, leerLimiteDeMesas, cargarUbicaciones,
};
