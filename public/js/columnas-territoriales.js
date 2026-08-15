/**
 * Columnas «Comuna / Corregimiento» y «Barrio / Vereda» en las tablas de
 * listado y en los tableros.
 *
 * QUÉ HACE
 *   1. Le quita a cada encabezado el término que la campaña no usa: con
 *      «¿Utilizar nombre de comunas?» en No, la columna pasa a decir solo
 *      «Corregimiento».
 *   2. Oculta la columna entera **solo si no hay un solo dato** en ninguna
 *      de sus dos mitades, en toda la base — no en la página que se está
 *      viendo.
 *
 * POR QUÉ LAS DOS MITADES, Y NO UNA
 *   Estas columnas son COMBINADAS: la misma casilla muestra lo urbano o lo
 *   rural según dónde viva la persona. Mirar una sola mitad esconde la otra.
 *   Medido el 8 de agosto de 2026 en la campaña departamental de prueba: ni
 *   un solo barrio, pero 82 personas asignadas a veredas. Ocultar
 *   «Barrio / Vereda» porque no hay barrios habría borrado de la pantalla el
 *   único dato territorial que esa campaña tiene.
 *
 *   Es la misma razón por la que a los campos de residencia de los
 *   formularios solo se les acorta la etiqueta mientras quede UNO de sus dos
 *   términos en uso. Con los dos apagados sí desaparecen — pero eso lo
 *   decide la campaña en Configuración, no si hay datos, y la regla vive en
 *   style.css.
 *
 * DE DÓNDE SALE «HAY DATOS»
 *   De `GET /api/configuracion/campana`, que lo pregunta contra toda la base
 *   (`hay_datos_comuna`, `hay_datos_corregimiento`, `hay_datos_barrio`,
 *   `hay_datos_vereda`). No se puede deducir de lo que hay pintado: las
 *   tablas van paginadas y la columna aparecería en la página 3 y no en la 1.
 *
 * SI LAS BANDERAS NO LLEGAN, NO SE OCULTA NADA
 *   Una página servida desde la caché contra un servidor que todavía no las
 *   manda recibe `undefined`, y eso se toma como «sí hay datos». Mostrar una
 *   columna de más es molesto; esconderla deja datos invisibles sin que nadie
 *   se entere.
 *
 * CÓMO SE USA
 *   Después de leer la configuración:
 *
 *     const cfg = await api('/configuracion/campana');
 *     const cols = aplicarColumnasTerritoriales(cfg);
 *
 *   Pone las clases `sin-columna-comuna` / `sin-columna-barrio` en el
 *   `<body>` (el CSS de style.css hace el resto sobre `.col-comuna-correg` y
 *   `.col-barrio-vereda`), reescribe los encabezados marcados con
 *   `data-columna="..."`, y devuelve lo calculado para quien necesite
 *   decidir por su cuenta — por ejemplo el tablero, que esconde paneles
 *   enteros y no columnas.
 */
(function () {
  // Una bandera ausente significa «servidor que todavía no la manda», y eso
  // se trata como que sí hay datos. Ver el encabezado.
  function hayDato(valor) {
    return valor === undefined || valor === null || valor === true || valor === 1;
  }

  function unir(partes) {
    return partes.filter(Boolean).join(' / ');
  }

  /**
   * @param cfg       lo que devuelve GET /configuracion/campana
   * @param opciones  `{ incluirTextoResidencia: true }` SOLO para las tablas
   *                  que muestran el texto libre de residencia como respaldo
   *                  —hoy únicamente Asistentes a reuniones, con su
   *                  `COALESCE(tv.nombre, u.barrio_residencia)`—. Las demás
   *                  leen el árbol de territorios, donde ese texto no
   *                  aparece: si contara, mostrarían una columna vacía.
   */
  window.aplicarColumnasTerritoriales = function (cfg, opciones) {
    cfg = cfg || {};
    const conTexto = !!(opciones && opciones.incluirTextoResidencia);
    const usaComunas = cfg.ciudad_tiene_comunas !== 0;
    const usaBarrios = cfg.usar_nombre_barrios !== 0;
    const usaCorregimientos = cfg.usar_nombre_corregimientos !== 0;
    const usaVeredas = cfg.usar_nombre_veredas !== 0;

    /**
     * El título de una columna combinada, con los términos que la campaña
     * dice usar.
     *
     * SI APAGA LOS DOS, LA COLUMNA CONSERVA SU NOMBRE COMPLETO. Podría
     * quedar sin título, pero la columna solo aparece cuando HAY datos
     * adentro, y una columna visible con el encabezado en blanco es peor
     * que una con un término que la campaña ya no usa: lo segundo se
     * entiende, lo primero parece un error.
     */
    const titulo = (urbano, usaUrbano, rural, usaRural) =>
      unir([usaUrbano ? urbano : null, usaRural ? rural : null]) || unir([urbano, rural]);

    // La ETIQUETA depende de lo que la campaña dice usar; la VISIBILIDAD, de
    // lo que hay guardado. Son dos preguntas distintas y se responden por
    // separado: una campaña puede tener comunas activadas y todavía no haber
    // registrado a nadie en una.
    //
    // El texto libre de residencia nunca toca la etiqueta: es un campo
    // combinado y no se sabe si lo escrito es un barrio o una vereda.
    const resultado = {
      etiquetaComuna: titulo('Comuna', usaComunas, 'Corregimiento', usaCorregimientos),
      etiquetaBarrio: titulo('Barrio', usaBarrios, 'Vereda', usaVeredas),
      mostrarComuna: hayDato(cfg.hay_datos_comuna) || hayDato(cfg.hay_datos_corregimiento)
                     || (conTexto && hayDato(cfg.hay_datos_comuna_texto)),
      mostrarBarrio: hayDato(cfg.hay_datos_barrio) || hayDato(cfg.hay_datos_vereda)
                     || (conTexto && hayDato(cfg.hay_datos_barrio_texto)),
      // Nivel por nivel, ya con la convención de «bandera ausente = sí hay»
      // aplicada. Lo usa el tablero, donde Comunas y Corregimientos son
      // secciones separadas y no dos mitades de una misma columna. Se expone
      // aquí para que ninguna página tenga que reimplementar esa convención.
      niveles: {
        comuna: hayDato(cfg.hay_datos_comuna),
        corregimiento: hayDato(cfg.hay_datos_corregimiento),
        barrio: hayDato(cfg.hay_datos_barrio),
        vereda: hayDato(cfg.hay_datos_vereda),
      },
    };

    document.body.classList.toggle('sin-columna-comuna', !resultado.mostrarComuna);
    document.body.classList.toggle('sin-columna-barrio', !resultado.mostrarBarrio);

    document.querySelectorAll('[data-columna="comuna-corregimiento"]')
      .forEach((el) => { el.textContent = resultado.etiquetaComuna; });
    document.querySelectorAll('[data-columna="barrio-vereda"]')
      .forEach((el) => { el.textContent = resultado.etiquetaBarrio; });

    return resultado;
  };
})();
