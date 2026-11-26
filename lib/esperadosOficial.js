/**
 * «ESPERADOS VS. OFICIAL» (orden 127): lo que los líderes dijeron que iban a votar en cada mesa, contra lo que el
 * candidato propio sacó según el resultado OFICIAL. Esta es SOLO la aritmética, sin base de datos ni HTTP, para poder
 * probarla y medirla sola; las consultas y los permisos viven en routes/resultadosDiaD.routes.js (`GET /esperados`).
 *
 * LA IDEA, EN UNA FRASE. El voto es secreto: no se puede saber por quién votó cada persona. Lo que sí se puede es
 * REPARTIR los votos oficiales del candidato en cada mesa entre los líderes, según cuántos votantes tenía cada uno ahí:
 *
 *      estimado del líder en la mesa m  =  V_m × L_m ÷ E_m
 *
 *   V_m  votos oficiales del candidato propio en la mesa
 *   L_m  votantes del líder en la mesa
 *   E_m  votantes esperados en la mesa, de TODOS los líderes y de «Sin líder»
 *
 * Por construcción la suma sobre los líderes de una mesa es V_m: no se pierden ni se inventan votos. Es un reparto
 * proporcional, no una medición: supone que cada inscrito votó como el resto de su mesa. La pantalla lo dice.
 *
 * REGLAS QUE SE DECIDIERON AL ESCRIBIRLA (y que la prueba comprueba):
 *   · Una mesa «tiene oficial» cuando el candidato PROPIO tiene fila ahí. Que existan filas de otros candidatos no
 *     basta: tomar la ausencia del propio por un cero metería un cero que nadie digitó.
 *   · El CONSOLIDADO de un líder es Σ estimado ÷ Σ L_m SOLO en las mesas con oficial. Con todos sus esperados en el
 *     denominador, cada mesa sin cargar bajaría su porcentaje sin ser culpa suya.
 *   · NO se topa a 100 %: un líder puede dar más de lo que prometió, y esconderlo sería mentir.
 *   · Un votante sin mesa (vacía, 0, o mayor que las mesas del puesto) no entra en ningún E_m: cuenta en los
 *     esperados del líder y del puesto, y sale aparte como «sin mesa».
 *   · Un votante cuyo puesto no está en la lista de la campaña («fuera de lista») solo cuenta como tal.
 *   · Las mesas con voto oficial y E_m = 0 no se reparten entre nadie: salen como «votos sin atribuir».
 *   · Vista PARCIAL (el coordinador): el cálculo se hace SIEMPRE con toda la campaña, y DESPUÉS se muestra solo lo suyo.
 *     El estimado de cada líder es el mismo que ve el administrador; lo que cambia son los totales de arriba, que se
 *     suman sobre sus líderes. Los demás líderes de una mesa salen agregados como «otros líderes».
 */
'use strict';

const UMBRAL_VERDE = 90;
const UMBRAL_AMARILLO = 70;

/** ≥ 90 verde, 70–89 amarillo, < 70 rojo. Sin dato, null. (Más de 100 sigue siendo verde: la pantalla le pone «+».) */
function semaforoDe(porcentaje) {
  if (porcentaje === null || porcentaje === undefined || Number.isNaN(porcentaje)) return null;
  if (porcentaje >= UMBRAL_VERDE) return 'verde';
  if (porcentaje >= UMBRAL_AMARILLO) return 'amarillo';
  return 'rojo';
}

const pct = (a, b) => (b > 0 ? (a * 100) / b : null);
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const r3 = (x) => (x === null || x === undefined ? null : Math.round(x * 1000) / 1000);

const SIN_LIDER = 'null';
const claveLider = (id) => (id === null || id === undefined ? SIN_LIDER : String(id));

/**
 * @param {object} e
 * @param {Array}  e.puestos     la lista de puestos de la campaña (id, nombre, cantidad_mesas)
 * @param {Function} e.resolver  crearResolutorDePuestos(puestos, { porCtc: true })
 * @param {Map}    e.municipios  puesto.id → { municipio, departamento }
 * @param {Array}  e.grupos      una fila por (puesto_id, ctc_puesto_id, puesto_votacion, mesa_votacion, lider_id):
 *                               { n, ya_voto, propios, … }. `propios` solo importa si `parcial`.
 * @param {Array}  e.oficial     filas del candidato PROPIO en la fuente elegida: { clave, mesa, votos }
 * @param {Map}    e.lideres     lider_id → { nombre, coordinador_id, coordinador, registro_equipo }
 * @param {boolean} e.parcial    true = mostrar solo lo que `propios` marca como del usuario (coordinador)
 * @param {string} [e.municipio] limita la lista de PUESTOS (no el cálculo ni el resumen de líderes)
 */
function construirEsperados(e) {
  const { puestos, resolver, municipios, grupos, oficial, lideres } = e;
  const parcial = !!e.parcial;
  const puestoPorId = new Map(puestos.map(p => [Number(p.id), p]));
  const nombreMunicipio = (p) => (municipios.get(Number(p.id)) || {}).municipio || 'Sin municipio';

  const mesas = new Map();      // `${clave}|${mesa}` → { clave, puesto, mesa, E, Y, lid: Map, visible }
  const sinMesa = new Map();    // puesto.id → { n, ya }   (solo lo visible)
  const fuera = new Map();      // clave → { puesto, esperados, ya_voto }   (solo lo visible)
  const lt = new Map();         // lider → totales
  const totalLider = (k) => {
    if (!lt.has(k)) lt.set(k, { esperados: 0, ya: 0, sinMesa: 0, fuera: 0, visible: false });
    return lt.get(k);
  };

  // ——— 1. Los votantes, agrupados por mesa —————————————————————————————————————————————
  for (const f of grupos) {
    const n = Number(f.n);
    const ya = Number(f.ya_voto);
    const visible = !parcial || Number(f.propios) > 0;
    const k = claveLider(f.lider_id);
    const L = totalLider(k);
    if (visible) L.visible = true;
    const g = resolver(f);
    if (g.fuera) {
      L.fuera += n;
      if (visible) {
        const x = fuera.get(g.clave) || { puesto: g.nombre, esperados: 0, ya_voto: 0 };
        x.esperados += n; x.ya_voto += ya;
        fuera.set(g.clave, x);
      }
      continue;
    }
    L.esperados += n;
    L.ya += ya;
    const mesaNum = Number(f.mesa_votacion);
    const cant = Number(g.puesto.cantidad_mesas) || 0;
    const mesaValida = f.mesa_votacion !== null && f.mesa_votacion !== undefined
      && Number.isInteger(mesaNum) && mesaNum >= 1 && (cant <= 0 || mesaNum <= cant);
    if (!mesaValida) {
      L.sinMesa += n;
      if (visible) {
        const s = sinMesa.get(g.puesto.id) || { n: 0, ya: 0 };
        s.n += n; s.ya += ya;
        sinMesa.set(g.puesto.id, s);
      }
      continue;
    }
    const mk = `${g.clave}|${mesaNum}`;
    let m = mesas.get(mk);
    if (!m) { m = { clave: g.clave, puesto: g.puesto, mesa: mesaNum, E: 0, Y: 0, lid: new Map(), visible: false }; mesas.set(mk, m); }
    m.E += n; m.Y += ya;
    if (visible) m.visible = true;
    const x = m.lid.get(k) || { n: 0, ya: 0 };
    x.n += n; x.ya += ya;
    m.lid.set(k, x);
  }

  // ——— 2. El oficial del propio, por mesa ———————————————————————————————————————————————
  const oficialPor = new Map();
  for (const o of oficial) {
    const k = `${o.clave}|${o.mesa}`;
    oficialPor.set(k, (oficialPor.get(k) || 0) + Number(o.votos));
  }

  // ——— 3. El reparto: V_m × L_m ÷ E_m ———————————————————————————————————————————————
  const acc = new Map();   // lider → { estimado, espOf, mesasOf, detalle: [] }
  const accDe = (k) => {
    if (!acc.has(k)) acc.set(k, { estimado: 0, espOf: 0, mesasOf: 0, mesas: 0, detalle: [] });
    return acc.get(k);
  };
  for (const [mk, m] of mesas) {
    const tiene = oficialPor.has(mk);
    m.tiene = tiene;
    m.V = tiene ? oficialPor.get(mk) : null;
    for (const [k, x] of m.lid) {
      const a = accDe(k);
      a.mesas += 1;
      const est = tiene ? (m.V * x.n) / m.E : null;
      if (tiene) { a.estimado += est; a.espOf += x.n; a.mesasOf += 1; }
      a.detalle.push({
        puesto_id: m.puesto.id, puesto: m.puesto.nombre, mesa: m.mesa, votantes: x.n, ya_voto: x.ya,
        tiene_oficial: tiene, estimado: tiene ? r3(est) : null, cumplimiento: tiene ? r1(pct(m.V, m.E)) : null,
      });
    }
  }

  // Votos sin atribuir: mesas con voto oficial y nadie inscrito. (Solo en puestos de la lista.)
  const sinAtribuir = [];
  for (const [mk, v] of oficialPor) {
    if (mesas.has(mk) || !(v > 0)) continue;
    const [clave, mesaTxt] = [mk.slice(0, mk.lastIndexOf('|')), mk.slice(mk.lastIndexOf('|') + 1)];
    if (!/^p\d+$/.test(clave)) continue;                       // fuera de lista: sin votantes con quién cruzar
    const p = puestoPorId.get(Number(clave.slice(1)));
    if (!p) continue;
    sinAtribuir.push({ puesto_id: p.id, puesto: p.nombre, mesa: Number(mesaTxt), votos: v });
  }
  sinAtribuir.sort((a, b) => a.puesto.localeCompare(b.puesto) || a.mesa - b.mesa);

  // ——— 4. Los líderes ———————————————————————————————————————————————————————————————
  const filasLideres = [];
  for (const [k, L] of lt) {
    if (!L.visible || L.esperados === 0) continue;
    const a = acc.get(k) || { estimado: 0, espOf: 0, mesasOf: 0, mesas: 0, detalle: [] };
    const info = k === SIN_LIDER ? null : (lideres.get(Number(k)) || { nombre: `Usuario ${k}` });
    const consolidado = pct(a.estimado, a.espOf);
    a.detalle.sort((x, y) => x.puesto.localeCompare(y.puesto) || x.mesa - y.mesa);
    filasLideres.push({
      id: k === SIN_LIDER ? null : Number(k),
      nombre: info ? info.nombre : 'Sin líder',
      sin_lider: k === SIN_LIDER,
      registro_equipo: !!(info && info.registro_equipo),
      coordinador_id: info ? info.coordinador_id || null : null,
      coordinador: info ? info.coordinador || null : null,
      mesas: a.mesas, mesas_con_oficial: a.mesasOf,
      esperados: L.esperados, ya_voto: L.ya, sin_mesa: L.sinMesa, fuera_de_lista: L.fuera,
      esperados_con_oficial: a.espOf, estimado: r3(a.estimado),
      consolidado: r1(consolidado), semaforo: semaforoDe(consolidado), supera_100: consolidado !== null && consolidado > 100,
      detalle: a.detalle,
    });
  }
  filasLideres.sort((x, y) => (x.sin_lider - y.sin_lider)
    || ((y.consolidado === null ? -1 : y.consolidado) - (x.consolidado === null ? -1 : x.consolidado))
    || y.esperados - x.esperados || x.nombre.localeCompare(y.nombre));

  // ——— 5. Los puestos y sus mesas ———————————————————————————————————————————————————————
  const nombreLider = (k) => {
    if (k === SIN_LIDER) return { nombre: 'Sin líder', registro_equipo: false };
    const i = lideres.get(Number(k));
    return { nombre: i ? i.nombre : `Usuario ${k}`, registro_equipo: !!(i && i.registro_equipo) };
  };
  const visiblesLid = new Set(filasLideres.map(l => claveLider(l.id)));
  const porPuesto = new Map();
  const pe = (p) => {
    if (!porPuesto.has(p.id)) porPuesto.set(p.id, { p, mesas: [] });
    return porPuesto.get(p.id);
  };
  for (const m of mesas.values()) {
    if (!m.visible) continue;
    const lids = [...m.lid].map(([k, x]) => ({ id: k === SIN_LIDER ? null : Number(k), ...nombreLider(k), n: x.n, k }))
      .sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre));
    const propios = lids.filter(l => !parcial || visiblesLid.has(l.k));
    const otros = lids.filter(l => !propios.includes(l)).reduce((s, l) => s + l.n, 0);
    pe(m.puesto).mesas.push({
      mesa: m.mesa, esperados: m.E, ya_voto: m.Y, tiene_oficial: m.tiene,
      oficial: m.tiene ? m.V : null, delta: m.tiene ? m.V - m.E : null, cumplimiento: m.tiene ? r1(pct(m.V, m.E)) : null,
      lideres: propios.map(l => ({ id: l.id, nombre: l.nombre, registro_equipo: l.registro_equipo, n: l.n })),
      otros_lideres_n: otros, sin_votantes: false,
    });
  }
  if (!parcial) {
    // Mesas con oficial y sin un solo inscrito: se ven, marcadas, pero no entran en ningún total del puesto.
    for (const s of sinAtribuir) {
      pe(puestoPorId.get(Number(s.puesto_id))).mesas.push({
        mesa: s.mesa, esperados: 0, ya_voto: 0, tiene_oficial: true, oficial: s.votos, delta: null, cumplimiento: null,
        lideres: [], otros_lideres_n: 0, sin_votantes: true,
      });
    }
  }
  for (const [id] of sinMesa) pe(puestoPorId.get(Number(id)));

  const puestosOut = [];
  for (const { p, mesas: ms } of porPuesto.values()) {
    ms.sort((a, b) => a.mesa - b.mesa);
    const con = ms.filter(x => !x.sin_votantes);
    const conOf = con.filter(x => x.tiene_oficial);
    const sm = sinMesa.get(p.id) || { n: 0, ya: 0 };
    const espValidos = con.reduce((s, x) => s + x.esperados, 0);
    const oficialP = conOf.reduce((s, x) => s + x.oficial, 0);
    const espOf = conOf.reduce((s, x) => s + x.esperados, 0);
    puestosOut.push({
      puesto_id: p.id, puesto: p.nombre, municipio: nombreMunicipio(p), cantidad_mesas: Number(p.cantidad_mesas) || 0,
      mesas_con_votantes: con.length, mesas_con_oficial: conOf.length,
      esperados: espValidos + sm.n, ya_voto: con.reduce((s, x) => s + x.ya_voto, 0) + sm.ya,
      esperados_con_oficial: espOf, oficial: conOf.length ? oficialP : null,
      diferencia: conOf.length ? oficialP - espOf : null, cumplimiento: r1(pct(oficialP, espOf)),
      semaforo: semaforoDe(pct(oficialP, espOf)), sin_mesa: sm.n, mesas: ms,
    });
  }
  puestosOut.sort((a, b) => a.puesto.localeCompare(b.puesto));
  const municipios_ = [...new Set(puestosOut.map(p => p.municipio))].sort((a, b) => a.localeCompare(b));
  const filtrados = e.municipio ? puestosOut.filter(p => p.municipio === e.municipio) : puestosOut;

  // ——— 6. Totales, sobre los líderes que se ven ————————————————————————————————————————————
  const T = filasLideres.reduce((t, l) => {
    t.esperados += l.esperados; t.ya += l.ya_voto; t.sinMesa += l.sin_mesa; t.fuera += l.fuera_de_lista;
    t.oficial += l.estimado; t.espOf += l.esperados_con_oficial; return t;
  }, { esperados: 0, ya: 0, sinMesa: 0, fuera: 0, oficial: 0, espOf: 0 });
  const mesasVis = [...mesas.values()].filter(m => m.visible);
  const mesasOf = mesasVis.filter(m => m.tiene).length;
  const cumplimiento = pct(T.oficial, T.espOf);

  const coordinadores = new Map();
  for (const l of filasLideres) if (l.coordinador_id) coordinadores.set(l.coordinador_id, l.coordinador);

  return {
    parcial,
    totales: {
      esperados: T.esperados, ya_voto: T.ya, ya_voto_pct: r1(pct(T.ya, T.esperados)),
      oficial: r3(T.oficial), esperados_con_oficial: T.espOf,
      cumplimiento: r1(cumplimiento), semaforo: semaforoDe(cumplimiento),
      diferencia: T.espOf > 0 ? r3(T.oficial - T.espOf) : null,
      votos_por_debajo: T.espOf > 0 ? r3(Math.max(0, T.espOf - T.oficial)) : null,
      esperados_con_mesa_pct: r1(pct(T.esperados - T.sinMesa, T.esperados)),
      mesas_total: mesasVis.length, mesas_con_oficial: mesasOf,
      sin_mesa: T.sinMesa, fuera_de_lista: T.fuera,
      votos_sin_atribuir: parcial ? null : sinAtribuir.reduce((s, x) => s + x.votos, 0),
    },
    lideres: filasLideres,
    coordinadores: [...coordinadores].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    municipios: municipios_,
    puestos: filtrados,
    rubros: {
      votos_sin_atribuir: parcial ? null : { total: sinAtribuir.reduce((s, x) => s + x.votos, 0), mesas: sinAtribuir },
      sin_mesa: {
        total: T.sinMesa,
        puestos: [...sinMesa].map(([id, s]) => ({ puesto_id: Number(id), puesto: puestoPorId.get(Number(id)).nombre, n: s.n }))
          .sort((a, b) => a.puesto.localeCompare(b.puesto)),
      },
      fuera_de_lista: { total: T.fuera, puestos: [...fuera.values()].sort((a, b) => a.puesto.localeCompare(b.puesto)) },
    },
  };
}

module.exports = { construirEsperados, semaforoDe, UMBRAL_VERDE, UMBRAL_AMARILLO };
