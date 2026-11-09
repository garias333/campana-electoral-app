/**
 * LA FINALIDAD DE LAS VISITAS EN LA POLÍTICA DE PRIVACIDAD (parche 309): el texto, en UN solo sitio.
 *
 * Lo usan `db/init-db.js` (que lo agrega al final de la sección 2 si la política NO la ha editado el administrador), la pantalla de Administración
 * (que se lo muestra al administrador para que lo pegue cuando sí la editó) y las pruebas. Sin importar nada: `init-db` lo carga sin abrir el pool.
 *
 * El texto lo aprobó el dueño de la campaña el 9 de noviembre de 2026, con un solo cambio sobre la propuesta: «si fue en la mañana o en la tarde»
 * (la propuesta decía «en la mañana, la tarde o la noche»). Ojo: el sistema guarda tres franjas (mañana, tarde —hasta las 16:59— y noche, desde las
 * 17:00): lo que la política llama «la tarde» incluye la noche del sistema, que no pasa de las 19:00.
 */
'use strict';

/** La frase que `init-db` y la pantalla buscan para saber si la política ya trae la finalidad. */
const FRASE_POLITICA_VISITAS = 'visita domiciliaria de la campaña';

/** El párrafo, sin saltos de línea al principio. */
const PARRAFO_POLITICA_VISITAS =
  'Si usted está registrado como votante de esta campaña, una persona del equipo —su líder o un sublíder— puede hacerle una **' + FRASE_POLITICA_VISITAS + '** '
  + 'en la dirección que usted nos dio: saludarlo, presentarle la campaña y anotar cómo fue la visita (si nadie abrió, si no le interesó, si le interesó, '
  + 'si quiere registrar a otra persona de su casa, si nos dejó una necesidad de su barrio o si pidió que no volvamos). Para organizar las visitas, esa persona '
  + 'recibe en su celular una lista con su nombre, su dirección y una ubicación aproximada, que se guarda allí como máximo 48 horas. De cada visita guardamos '
  + 'solamente el día, si fue en la mañana o en la tarde, y el resultado: no guardamos la hora exacta ni el lugar donde estaba quien lo visitó. '
  + '«Le interesó» se refiere a su interés en conversar con la campaña; no registramos por quién va a votar ni lo escribimos en su ficha. Las visitas se hacen '
  + 'de día, nunca el día de la elección, y si nadie abre no volvemos más de tres veces. Usted puede pedirnos en cualquier momento que no lo visitemos más '
  + '—a quien lo visite o por los canales de esta política— y lo respetamos sin ninguna consecuencia para usted; aparte, también puede pedirnos que no le escribamos. '
  + 'Pasado el plazo que fije la campaña después de la elección, separamos cada visita de su nombre y dejamos solo cifras por zona.';

module.exports = { FRASE_POLITICA_VISITAS, PARRAFO_POLITICA_VISITAS };
