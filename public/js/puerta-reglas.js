/* LAS REGLAS DEL PUERTA A PUERTA (parche 309): UNA sola copia, que usan el servidor (lib/puertaAPuerta.js) y el celular (public/app/puerta-a-puerta.html).

   POR QUÉ UN SOLO ARCHIVO. La franja horaria, el tope de intentos, las 24 horas entre uno y otro y la caducidad de la copia se juzgan en DOS sitios:
   el celular, que no tiene señal y tiene que negarse solo, y el servidor, que no se fía de lo que dice el celular. Dos copias de la misma regla se
   separan sin avisar (ya pasó en este proyecto con otras dos funciones «gemelas»); aquí no pueden separarse porque es el mismo archivo.

   Se carga en el navegador con <script src="/js/puerta-reglas.js"> (queda en `PuertaReglas`) y en Node con require().

   LA HORA ES LA DE COLOMBIA (America/Bogota, UTC-5, sin horario de verano), calculada con Intl y no con la zona del aparato ni la del servidor.

   LAS VISITAS NO GUARDAN LA HORA: solo la FECHA y la FRANJA del día. Para que «al menos 24 horas entre un intento y otro» se pueda cumplir sin
   saber la hora exacta, se cuenta desde el FINAL de la franja en la que se hizo el intento: la visita ocurrió como muy tarde a esa hora, así que
   24 horas después de ella son al menos 24 horas después de la visita. Es una cota prudente (entre 24 y 31 horas), no la hora real. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.PuertaReglas = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RESULTADOS = ['no_abrio', 'no_interesado', 'interesado', 'quiere_registrarse', 'solicitud', 'no_volver'];
  /** Los que cierran la puerta: «no abrió» no (se puede volver, hasta MAX_INTENTOS veces). */
  const RESULTADOS_FINALES = ['no_interesado', 'interesado', 'quiere_registrarse', 'solicitud', 'no_volver'];
  const FRANJAS = ['manana', 'tarde', 'noche'];
  const ETIQUETA_FRANJA = { manana: 'mañana', tarde: 'tarde', noche: 'noche' };

  const MAX_INTENTOS = 3;                    // veces que se puede tocar y que nadie abra
  const HORAS_ENTRE_INTENTOS = 24;
  const DIAS_SIN_REASIGNAR = 60;             // una puerta ya cerrada (o agotada) no vuelve a entrar en una lista antes de esto
  const HORAS_COPIA = 48;                    // lo que dura la lista en el celular
  const MAX_ITEMS_LISTA = 300;               // lo que cabe, con sentido, en una jornada y en un celular
  const FRANJA_MINIMA = '07:00';             // el administrador mueve la franja entre estos dos límites
  const FRANJA_MAXIMA = '19:00';
  const FRANJA_DESDE_DEFECTO = '08:00';
  const FRANJA_HASTA_DEFECTO = '18:00';

  /** «HH:MM» o «HH:MM:SS» → minutos desde la medianoche; null si no es una hora. */
  function aMinutos(t) {
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(t === undefined || t === null ? '' : t).trim());
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 ? h * 60 + mi : null;
  }
  function hhmm(minutos) {
    const m = Math.max(0, Math.min(1440, Number(minutos) || 0));
    if (m === 1440) return '24:00';
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  /** Valida una franja: dentro de los límites y de al menos una hora. Devuelve { ok, desde, hasta } (minutos y texto) o { ok: false, error }. */
  function validarFranja(desde, hasta) {
    const a = aMinutos(desde), b = aMinutos(hasta);
    const min = aMinutos(FRANJA_MINIMA), max = aMinutos(FRANJA_MAXIMA);
    if (a === null || b === null) return { ok: false, error: 'La franja se escribe como hora, por ejemplo 08:00.' };
    if (a < min || b > max) return { ok: false, error: `La franja tiene que estar entre las ${FRANJA_MINIMA} y las ${FRANJA_MAXIMA}.` };
    if (b - a < 60) return { ok: false, error: 'La franja tiene que durar al menos una hora.' };
    return { ok: true, desde: a, hasta: b, desdeTexto: hhmm(a), hastaTexto: hhmm(b) };
  }

  /** { fecha: 'YYYY-MM-DD', minutos } de un instante, en hora de Colombia. */
  function colombiaDe(instante) {
    const d = instante instanceof Date ? instante : new Date(instante);
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
    const hora = Number(p.hour === '24' ? '0' : p.hour);
    return { fecha: `${p.year}-${p.month}-${p.day}`, minutos: hora * 60 + Number(p.minute) };
  }

  /** La franja del día a la que pertenece un minuto: mañana (antes de las 12:00), tarde (hasta las 16:59) o noche (desde las 17:00). */
  function franjaDe(minutos) {
    return minutos < 720 ? 'manana' : (minutos < 1020 ? 'tarde' : 'noche');
  }
  /** El minuto en que TERMINA cada franja. */
  function finDeFranja(franja) {
    return { manana: 720, tarde: 1020, noche: 1440 }[franja] || null;
  }

  /** ¿Cae el minuto dentro de la franja permitida? `desde` incluido, `hasta` excluido. */
  function enFranja(minutos, desde, hasta) {
    return Number.isFinite(minutos) && minutos >= desde && minutos < hasta;
  }

  function sumarDias(fecha, dias) {
    const t = Date.parse(`${fecha}T00:00:00Z`);
    if (!Number.isFinite(t)) return null;
    return new Date(t + dias * 86400000).toISOString().slice(0, 10);
  }

  /** 'YYYY-MM-DD HH:MM' de un instante en hora de Colombia (se compara como texto). */
  function textoColombia(instante) {
    const c = colombiaDe(instante);
    return `${c.fecha} ${hhmm(c.minutos)}`;
  }

  /**
   * Desde cuándo se puede volver a tocar una puerta en la que ya se intentó: 24 horas después del FINAL de la franja del intento.
   * Devuelve 'YYYY-MM-DD HH:MM' (hora de Colombia). Con la franja «noche» el final es la medianoche, o sea las 00:00 del día siguiente al siguiente.
   */
  function reintentoDesde(fecha, franja) {
    const fin = finDeFranja(franja);
    if (fin === null || !/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '').slice(0, 10))) return null;
    const dia = String(fecha).slice(0, 10);
    const total = fin + HORAS_ENTRE_INTENTOS * 60;                 // minutos contados desde las 00:00 de `dia`
    const dias = Math.floor(total / 1440);
    return `${sumarDias(dia, dias)} ${hhmm(total % 1440)}`;
  }
  /** ¿Ya pasaron las 24 horas (contadas como arriba) para volver a tocar? `instante` es el de la captura. */
  function puedeReintentar(ultimaFecha, ultimaFranja, instante) {
    const desde = reintentoDesde(ultimaFecha, ultimaFranja);
    return desde !== null && textoColombia(instante) >= desde;
  }

  /** ¿Es `instante` el día de la elección (hora de Colombia)? `fechaEleccion`: 'YYYY-MM-DD' o vacío. */
  function esDiaDeLaEleccion(fechaEleccion, instante) {
    return !!fechaEleccion && colombiaDe(instante).fecha === String(fechaEleccion).slice(0, 10);
  }

  /** ¿Ya caducó la copia de la lista que se guardó en el celular en `guardadoEn` (ms)? */
  function caducoLaCopia(guardadoEn, ahora) {
    const g = Number(guardadoEn), a = Number(ahora === undefined ? Date.now() : ahora);
    return !Number.isFinite(g) || !Number.isFinite(a) || a - g >= HORAS_COPIA * 3600 * 1000;
  }

  /* ---------------------------------------------------------------------------------------------------------- RUTA */
  /* Port de `distanciaMetros` (lib/jornadaDiaD.js) y de `ordenarPorCercania` (lib/transporteDiaD.js), que corren en el servidor y aquí hacen lo
     mismo EN EL CELULAR, sin señal y sin mandar nada a nadie. scripts/probar-puerta-a-puerta.js compara las dos sobre miles de casos al azar. */
  function distanciaMetros(lat1, lon1, lat2, lon2) {
    const v = [lat1, lon1, lat2, lon2].map(Number);
    if (v.some((n) => !Number.isFinite(n)) || [lat1, lon1, lat2, lon2].some((n) => n === null || n === undefined || n === '')) return null;
    const R = 6371000, rad = (g) => g * Math.PI / 180;
    const dLat = rad(v[2] - v[0]), dLon = rad(v[3] - v[1]);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(v[0])) * Math.cos(rad(v[2])) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))));
  }

  /**
   * El vecino más cercano: empieza en `inicio` ({lat, lon}) o, sin él, en la PRIMERA parada de la lista, y de ahí va siempre a la parada más
   * cercana. Las paradas sin coordenadas van al final, en el orden que ya tenían. No es la ruta óptima, pero es predecible y sirve para unas
   * decenas de puertas. Devuelve los `id` en el orden nuevo.
   */
  function ordenarPorCercania(paradas, inicio) {
    const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x));
    const todas = paradas.map((p) => ({ id: p.id, orden: Number(p.orden) || 0, lat: num(p.lat), lon: num(p.lon) }))
      .sort((a, b) => a.orden - b.orden || a.id - b.id);
    const ok = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon);
    const con = todas.filter(ok), sin = todas.filter((p) => !ok(p));
    const resultado = [];
    let actual = inicio && Number.isFinite(Number(inicio.lat)) && Number.isFinite(Number(inicio.lon))
      ? { lat: Number(inicio.lat), lon: Number(inicio.lon) } : null;
    const pendientes = con.slice();
    if (!actual && pendientes.length) {
      const primera = pendientes.shift();
      resultado.push(primera.id);
      actual = primera;
    }
    while (pendientes.length) {
      let mejor = 0, mejorD = Infinity;
      pendientes.forEach((p, i) => {
        const d = distanciaMetros(actual.lat, actual.lon, p.lat, p.lon);
        if (d < mejorD) { mejorD = d; mejor = i; }
      });
      const [elegida] = pendientes.splice(mejor, 1);
      resultado.push(elegida.id);
      actual = elegida;
    }
    return [...resultado, ...sin.map((p) => p.id)];
  }

  return {
    RESULTADOS, RESULTADOS_FINALES, FRANJAS, ETIQUETA_FRANJA,
    MAX_INTENTOS, HORAS_ENTRE_INTENTOS, DIAS_SIN_REASIGNAR, HORAS_COPIA, MAX_ITEMS_LISTA,
    FRANJA_MINIMA, FRANJA_MAXIMA, FRANJA_DESDE_DEFECTO, FRANJA_HASTA_DEFECTO,
    aMinutos, hhmm, validarFranja, colombiaDe, franjaDe, finDeFranja, enFranja, sumarDias, textoColombia,
    reintentoDesde, puedeReintentar, esDiaDeLaEleccion, caducoLaCopia, distanciaMetros, ordenarPorCercania,
  };
});
