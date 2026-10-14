/**
 * Las cifras del TOTAL de «Avance de mis líderes», ya listas para escribir en
 * pantalla.
 *
 * VIVE EN UN ARCHIVO APARTE porque lo pintan DOS pantallas: la propia
 * (`avance-lideres.html`) y la tarjeta de progreso de «Mis registros» cuando
 * quien entra es un coordinador. Deben decir lo mismo cifra por cifra; si cada
 * una armara sus textos, la primera corrección dejaría dos versiones. Y es un
 * archivo NUEVO, no una función añadida a `app-comun.js`, a propósito: el
 * navegador guarda los .js hasta 10 minutos, y una pantalla nueva que llegara
 * junto a un `app-comun.js` viejo en caché se encontraría con una función que
 * no existe. Un archivo que nunca estuvo en la caché no puede estar viejo.
 *
 * `total` es el objeto `total` que devuelve
 * GET /api/dashboard/avance-mis-lideres (ver lib/avanceLideres.js):
 *   { lideres, con_meta, sin_meta, meta, registros, registros_sin_meta,
 *     sin_meta_total, cumplida, porcentaje }
 *
 * Devuelve:
 *   grande   · la cifra grande («10»)
 *   meta     · lo que va junto a ella (« de 327 registros»)
 *   pct      · «3,1 %», o «Sin meta» si ningún líder tiene meta
 *   ancho    · ancho de la barra, 0–100 (la CIFRA puede pasar de 100; la caja no)
 *   cumplida · true si llegó o pasó la meta; lo decide el servidor, no el
 *              redondeo: 1.999 de 2.000 se muestra «99,9 %» y NO se pinta verde
 *   detalle  · «3 líderes · 1 sin meta asignada (90 registros aparte)»
 *
 * El total solo suma a los líderes QUE TIENEN META: sumar los registros de
 * quien no se comprometió a nada inflaría el porcentaje (10 de 100 más 90 de
 * un líder sin meta daría 100 %). Esos registros se dicen aparte, en `detalle`.
 */
function resumenTotalAvance(total) {
  const numero = (n) => Number(n).toLocaleString('es-CO');
  // Un decimal solo cuando hace falta: 12,5 %, pero 9 % y no 9,0 %.
  const porcentaje = (p) => Number(p).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' %';
  const plural = (n, uno, varios) => `${numero(n)} ${n === 1 ? uno : varios}`;

  const detalle = [plural(total.lideres, 'líder', 'líderes')];
  let grande, meta, pct, ancho, cumplida;

  if (total.sin_meta_total) {
    // Ningún líder tiene meta: un porcentaje sobre cero no existe, y un «0 %» se
    // leería como «no han hecho nada» cuando lo que falta es la meta. La cifra
    // grande son entonces los registros que sí hay, todos «sin meta».
    grande = numero(total.registros_sin_meta || 0);
    meta = ' registros';
    pct = 'Sin meta';
    ancho = 0;
    cumplida = false;
    detalle.push('ninguno tiene meta asignada');
  } else {
    grande = numero(total.registros);
    meta = ` de ${numero(total.meta)} registros`;
    pct = porcentaje(total.porcentaje);
    ancho = Math.min(100, total.porcentaje);
    cumplida = !!total.cumplida;
    if (total.sin_meta > 0) {
      // `registros_sin_meta` lo manda el servidor; si por cualquier razón no llegara,
      // se omite el paréntesis en vez de escribir «NaN registros aparte».
      const aparte = Number.isFinite(total.registros_sin_meta)
        ? ` (${plural(total.registros_sin_meta, 'registro', 'registros')} aparte)` : '';
      detalle.push(`${total.sin_meta} sin meta asignada${aparte}`);
    }
  }
  return { grande, meta, pct, ancho, cumplida, detalle: detalle.join(' · ') };
}
