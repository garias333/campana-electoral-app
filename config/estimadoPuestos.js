/**
 * Estimado de cuántos Votantes/Sublíderes registrados dicen votar en cada
 * Puesto de votación (catálogo de Configuración → Día D) y cómo se
 * reparten entre sus Mesas — según lo que cada persona escribió en "Lugar
 * de votación". Se usa tanto en GET /votantes/estimados-por-puesto (lo que
 * ve la pantalla) como en la exportación a Excel del Dashboard de
 * votantes, para que ambos SIEMPRE muestren los mismos números.
 */
/**
 * Los puestos con su MUNICIPIO, sacado del catálogo.
 *
 * El municipio no está en la tabla de la campaña: se llega por
 * `ctc_puesto_id`, que es la referencia al catálogo que deja la siembra
 * (ver sembrar_puestos_campana.sql). Es el mismo cruce que ya usa el filtro
 * de puestos por municipio.
 *
 * SE CRUZA POR LA REFERENCIA, NO POR EL NOMBRE. En campaña departamental el
 * nombre trae el municipio pegado —«BARCELONA (CALARCÁ)»— para desambiguar
 * dentro del departamento, pero ese texto es para leerlo, no para cruzarlo:
 * hay puestos cuyo nombre ya lleva paréntesis propios, como
 * «COCORA (PALESTINA) (SALENTO)».
 *
 * SI EL CATÁLOGO NO SE PUEDE LEER, SE SIGUE SIN MUNICIPIO. Una instalación a
 * la que le falte el permiso sobre `territoriosdb` haría fallar la consulta
 * entera, y esta pantalla ya estuvo caída una vez por reventar en un detalle
 * (ver el .trim() sobre mesa_votacion). Perder una columna es aceptable;
 * perder la pantalla, no.
 */
/* LOS PUESTOS TAMBIEN SE ACOTAN, no solo los votantes.
   Desde que cada campaña tiene su propia lista, esta consulta las traia TODAS:
   en la campaña de prueba, con la sublicencia del aspirante ya sembrada, la
   pantalla decia «182 puestos configurados» donde Manizales tiene 91, y cada
   puesto salia dos veces, una por campaña. El filtro de abajo ya acotaba los
   VOTANTES a quien pregunta; faltaba la otra mitad. */
async function consultarPuestosConMunicipio(pool, dueno = 0) {
  try {
    const [filas] = await pool.query(
      `SELECT p.id, p.nombre, p.cantidad_mesas, m.nombre AS municipio
         FROM dia_d_puestos_votacion p
         LEFT JOIN territoriosdb.ctc_puestos_votacion cp ON cp.id = p.ctc_puesto_id
         LEFT JOIN territoriosdb.ctc_territorios m ON m.id = cp.municipio_id
        WHERE p.aspirante_id = ?
        ORDER BY p.nombre`, [dueno]
    );
    return filas;
  } catch (err) {
    console.warn('No se pudo leer el municipio de los puestos desde el catálogo:', err.code || err.message);
    const [filas] = await pool.query(
      `SELECT id, nombre, cantidad_mesas, NULL AS municipio FROM dia_d_puestos_votacion
        WHERE aspirante_id = ? ORDER BY nombre`, [dueno]
    );
    return filas;
  }
}

async function calcularEstimadoPorPuesto(pool, filtro, dueno = 0) {
  const puestos = await consultarPuestosConMunicipio(pool, dueno);
  // Se agrupa por `puesto_id` cuando el votante lo tiene, y por el texto
  // cuando no. Ese id lo mantiene al día un disparador desde el propio
  // texto, así que queda lleno para todo el que vote en un puesto de la
  // campaña, y NULL para quien vote fuera del ámbito — alguien registrado
  // en Manizales puede votar en Neiva, y ese puesto no está en la lista.
  //
  // Los de id nulo no desaparecen: caen en "puestos no configurados", que
  // es exactamente lo que son desde el punto de vista de la cobertura.
  /* EL ESTIMADO SE ACOTA A QUIEN PREGUNTA.
     Esta consulta contaba SIEMPRE la campaña entera. Se descubrio el 24 de
     agosto de 2026 mirando la pantalla de un aspirante: su pestaña de votantes
     decia 7 y esta decia 88 — los 88 de la campaña madre. No era solo cosa
     suya: cualquier lider veia aqui el estimado completo, con nombres de puesto
     y mesa, aunque su listado solo le mostrara los que el registro.

     El filtro llega hecho desde la ruta, que es la que sabe quien pregunta. Sin
     filtro (administrador) la consulta queda igual que siempre. */
  const [conteos] = await pool.query(
    `SELECT puesto_id, puesto_votacion, mesa_votacion, COUNT(*) AS total
     FROM votantes v
     WHERE puesto_votacion IS NOT NULL AND TRIM(puesto_votacion) != ''
     ${filtro && filtro.sql ? 'AND ' + filtro.sql : ''}
     GROUP BY puesto_id, puesto_votacion, mesa_votacion`,
    filtro && filtro.valores ? filtro.valores : []
  );

  // Dos índices: uno por id (el bueno) y otro por texto (el respaldo para
  // quien todavía no tenga id, por ejemplo si el hosting no permitió crear
  // el disparador).
  /* EL ID SOLO SIRVE SI ES DE ESTA CAMPAÑA, y esto no era asi.
     `votantes.puesto_id` lo mantiene un disparador que resuelve el TEXTO del
     lugar de votación contra `dia_d_puestos_votacion`. Desde que cada campaña
     tiene su propia lista, dos filas distintas comparten nombre —una por
     campaña— y el disparador se queda con una sola: la de la madre, que es la
     que existía primero. Resultado medido en la campaña de prueba: en la
     sublicencia del aspirante ningún puesto encontraba votantes, porque sus
     filas tienen otros id y la rama del texto ni se probaba —un votante CON id
     no llegaba nunca a ella—. En la campaña madre funcionaba, y por eso el
     fallo solo se veía de un lado.
     Si el id no es de la lista de quien pregunta, se cae al texto. Dentro de
     una misma campaña el nombre es único —lo garantiza uq_puesto_nombre, que
     es (dueño, nombre)—, asi que ese respaldo no puede ser ambiguo. */
  const idsDeEstaCampana = new Set(puestos.map(p => p.id));
  const porId = new Map();
  const porTexto = new Map();
  for (const fila of conteos) {
    const idPropio = fila.puesto_id && idsDeEstaCampana.has(fila.puesto_id);
    const destino = idPropio ? porId : porTexto;
    const clave = idPropio ? fila.puesto_id : fila.puesto_votacion;
    if (!destino.has(clave)) destino.set(clave, new Map());
    const mapaMesas = destino.get(clave);
    // `mesa_votacion` es INT en la base (ver la nota de db/schema.sql:99),
    // así que aquí llega un NÚMERO, no una cadena: `(1 || '').trim()` no
    // existe y reventaba la pantalla entera con «Error calculando el
    // estimado». Se convierte antes de recortar.
    //
    // La clave del mapa tiene que quedar en texto porque más abajo se busca
    // con `mapaMesas.get(String(m))`.
    //
    // `??` y no `||`: con `||`, una mesa 0 —dato inválido, pero lo hubo—
    // caería en '' y se contaría como «sin mesa»; con `??` queda '0' y la
    // comprobación de rango de abajo la clasifica igual, pero sin perder
    // de vista cuál era.
    const mesa = String(fila.mesa_votacion ?? '').trim();
    mapaMesas.set(mesa, (mapaMesas.get(mesa) || 0) + fila.total);
  }

  const resultado = puestos.map(p => {
    // Se juntan los dos caminos: los que ya cruzan por id y los que
    // todavía solo tienen el texto de ese mismo puesto.
    const mapaMesas = new Map(porId.get(p.id) || []);
    for (const [mesa, cantidad] of (porTexto.get(p.nombre) || new Map()).entries()) {
      mapaMesas.set(mesa, (mapaMesas.get(mesa) || 0) + cantidad);
    }
    porId.delete(p.id);
    porTexto.delete(p.nombre);
    const mesas = [];
    let total = 0;
    for (let m = 1; m <= p.cantidad_mesas; m++) {
      const cantidad = mapaMesas.get(String(m)) || 0;
      mesas.push({ mesa: m, cantidad });
      total += cantidad;
    }
    // Votantes de este puesto sin una Mesa reconocida (vacía o fuera del rango 1..cantidad_mesas configurado).
    let sinMesaValida = 0;
    for (const [mesa, cantidad] of mapaMesas.entries()) {
      const num = Number(mesa);
      if (!Number.isInteger(num) || num < 1 || num > p.cantidad_mesas) sinMesaValida += cantidad;
    }
    return { puesto: p.nombre, municipio: p.municipio || null, cantidadMesas: p.cantidad_mesas, total: total + sinMesaValida, mesas, sinMesaValida };
  });

  // Votantes cuyo puesto no es ninguno de los configurados en Día D: texto
  // libre de antes del catálogo, o gente que vota fuera del ámbito de la
  // campaña. Lo que sobre en el índice por id no debería existir (un id
  // siempre viene de la lista), pero se suma igual por si un puesto se
  // borró después de que alguien quedara apuntando a él.
  const puestosNoConfigurados = [...porTexto.entries()].map(([puesto, mapaMesas]) => ({
    puesto,
    total: [...mapaMesas.values()].reduce((a, b) => a + b, 0)
  }));

  return { puestos: resultado, puestosNoConfigurados };
}

module.exports = { calcularEstimadoPorPuesto };
