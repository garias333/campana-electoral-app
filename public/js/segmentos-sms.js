/**
 * Cuántos SMS son de verdad este mensaje.
 *
 * POR QUÉ HACE FALTA
 *   Un SMS no se cobra por mensaje, se cobra por SEGMENTO. Y el tamaño del
 *   segmento depende del alfabeto:
 *
 *     - Sin tildes ni ñ (GSM-7):  160 caracteres, o 153 si va partido.
 *     - Con una sola tilde (UCS-2): 70 caracteres, o 67 si va partido.
 *
 *   Una sola «á» convierte todo el mensaje a UCS-2 y le quita más de la
 *   mitad del espacio. Un texto de 150 caracteres «bien escrito» son 3
 *   segmentos; el mismo texto sin tildes es 1. Con 332 destinatarios eso
 *   es la diferencia entre 332 y 996 mensajes facturados, y hasta ahora
 *   nada en la pantalla lo decía.
 *
 * NO SE QUITAN LAS TILDES SOLO
 *   Se avisa y se deja decidir. Escribirle a la gente sin tildes es una
 *   decisión de estilo de la campaña, no algo que deba hacer el programa
 *   por su cuenta y sin avisar.
 */
(function () {
  // Alfabeto GSM 03.38 básico. Lo que no esté aquí obliga a UCS-2.
  const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
            + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
  // Estos sí son GSM-7, pero ocupan DOS caracteres (van con un escape).
  const GSM_DOBLES = '^{}\\[~]|€';

  /**
   * @returns {{alfabeto:'GSM-7'|'UCS-2', caracteres:number, segmentos:number, porSegmento:number, restantes:number}}
   */
  window.calcularSegmentosSms = function (texto) {
    const t = String(texto || '');
    let esGsm = true;
    let largo = 0;
    for (const ch of t) {
      if (GSM_DOBLES.includes(ch)) { largo += 2; continue; }
      if (GSM.includes(ch)) { largo += 1; continue; }
      esGsm = false;
      largo += 1;
    }
    if (!esGsm) largo = [...t].length;   // en UCS-2 cada carácter vale 1

    const unico = esGsm ? 160 : 70;
    const partido = esGsm ? 153 : 67;
    let segmentos, porSegmento;
    if (largo === 0) { segmentos = 0; porSegmento = unico; }
    else if (largo <= unico) { segmentos = 1; porSegmento = unico; }
    else { porSegmento = partido; segmentos = Math.ceil(largo / partido); }

    return {
      alfabeto: esGsm ? 'GSM-7' : 'UCS-2',
      caracteres: largo,
      segmentos,
      porSegmento,
      restantes: segmentos === 0 ? unico : (segmentos * porSegmento) - largo,
    };
  };

  /** ¿El texto trae marcadores que cambian de largo en cada destinatario? */
  window.tieneMarcadores = function (texto) {
    return /\{[a-z_]+\}/i.test(String(texto || ''));
  };

  /**
   * Pinta el contador debajo del cuadro de texto.
   *
   * @param textarea  el cuadro donde se escribe
   * @param caja      dónde escribir el aviso
   * @param cantidad  cuántos destinatarios hay (0 si todavía no se sabe)
   */
  window.pintarContadorSms = function (textarea, caja, cantidad) {
    if (!textarea || !caja) return;
    const r = window.calcularSegmentosSms(textarea.value);
    const partes = [`${r.caracteres} caracteres · ${r.segmentos} ${r.segmentos === 1 ? 'SMS' : 'SMS'}`];

    if (r.alfabeto === 'UCS-2') {
      partes.push('con tildes o ñ: caben 70 por SMS en vez de 160');
    }
    if (cantidad > 0 && r.segmentos > 0) {
      partes.push(`${cantidad} destinatarios → <strong>${cantidad * r.segmentos} mensajes facturados</strong>`);
    }
    // El largo final depende de cada persona: {lugar_votacion} puede ser una
    // palabra o cuarenta caracteres. Se dice, en vez de dar un número falso.
    if (window.tieneMarcadores(textarea.value)) {
      partes.push('los marcadores cambian el largo en cada envío, así que esto es aproximado');
    }

    caja.innerHTML = partes.join(' · ');
    caja.style.color = r.alfabeto === 'UCS-2' && r.segmentos > 1
      ? '#A93226'
      : 'var(--color-text-muted)';
  };
})();
