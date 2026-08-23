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
  /**
   * La firma que el proveedor le pega a cada SMS por exigencia de la CRC.
   *
   * La pone Onurix, no esta aplicación, pero OCUPA SITIO EN EL SEGMENTO: sin
   * contarla el contador decía «1 SMS» mientras el proveedor cobraba 2. La
   * pantalla la recibe de /comunicaciones/estado-canales y la deja aquí.
   *
   * Medida en un mensaje real el 22 de agosto de 2026 —no supuesta—:
   * «ESTRATEGIA MARKETING POLITICO» al final, 29 caracteres más el separador.
   * Ojo: lo registrado en el portal fue «Estrategia - Marketing Politico», y
   * el proveedor lo manda en mayúsculas y sin el guion. Son dos caracteres de
   * diferencia, que es justo lo que separa un segmento de dos en el límite.
   *
   * Vacía mientras nadie la fije: el conteo se comporta como antes.
   */
  window.firmaSms = '';

  /**
   * El enlace de baja que el servidor agrega solo cuando el mensaje no trae
   * {baja} (ver agregarBajaSms en routes/comunicaciones.routes.js).
   *
   * SE CUENTA AUNQUE NO SE VEA EN EL CUADRO. Son unos 77 caracteres que el
   * servidor pega al final, y con la firma del operador encima pueden empujar
   * el mensaje a un segundo segmento — el doble de factura. Un contador que
   * los ignorara diria «1 SMS» y llegarian dos: el peor momento para
   * enterarse del costo es el recibo.
   *
   * Se arma con el dominio REAL de esta instalacion, que es lo que hace largo
   * al enlace: no es lo mismo «electoral» que «campanadepruebadepartamental».
   */
  function textoBajaAutomatica() {
    if (typeof location === 'undefined') return '';
    return ' Baja: ' + location.origin + '/b/v000000-XXXXXXXXXX';
  }

  /**
   * ¿Esta campana tiene encendido el enlace automatico? Lo fija la pantalla
   * con lo que responde /comunicaciones/estado-canales. Encendido mientras
   * nadie diga lo contrario: contar de mas avisa de un costo que no era, y
   * contar de menos deja que llegue una factura doble sin aviso.
   */
  window.bajaAutomaticaSms = true;

  /** ¿El servidor va a agregar el enlace a ESTE texto? */
  window.llevaBajaAutomatica = function (texto) {
    return window.bajaAutomaticaSms !== false && !/\{baja\}/i.test(String(texto || ''));
  };

  window.calcularSegmentosSms = function (texto) {
    // Se analiza el texto JUNTO con la firma, no por separado: si la firma
    // trajera una tilde, el mensaje entero bajaría de 160 a 70 por segmento.
    const extra = window.llevaBajaAutomatica(texto) ? textoBajaAutomatica() : '';
    const t = String(texto || '') + extra + String(window.firmaSms || '');
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
    const firma = String(window.firmaSms || '');
    // Se muestra lo que la persona escribió, no el total con la firma: el
    // número de al lado ya no cuadraría con lo que ve en el cuadro. La firma
    // se nombra aparte, para que se entienda por qué caben menos.
    const escritos = [...String(textarea.value || '')].length;
    const partes = [`${escritos} caracteres · ${r.segmentos} SMS`];
    if (firma) {
      partes.push(`+${firma.length} de la firma que agrega el operador`);
    }
    // Se nombra aparte, igual que la firma: quien escribe tiene que entender
    // por que caben menos de los que ve, y que puede evitarlo poniendo {baja}
    // donde le convenga en vez de dejarlo al final.
    if (window.llevaBajaAutomatica(textarea.value)) {
      partes.push(`+${textoBajaAutomatica().length} del enlace de baja que se agrega solo`);
    }

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

    /* PASAR DE UN SEGMENTO NO ES SOLO MAS CARO: HOY NO LLEGA.
       Medido el 22 de agosto de 2026 sobre los envios reales de la campana:
       todos los de un segmento llegaron —con enlace y sin el—; los de dos, no.
       Onurix los acepta y los cobra igual, asi que el historial dice "Enviado"
       y nada avisa. Mientras eso no se aclare con el proveedor, el contador
       tiene que decirlo donde se escribe, no despues.

       Va como aviso aparte y en rojo, no como un dato mas de la lista: «2 SMS»
       se lee como un precio, y el problema no es el precio. */
    const noLlega = r.segmentos > 1;
    caja.innerHTML = partes.join(' · ')
      + (noLlega
        ? '<div style="margin-top:6px; font-weight:700;">'
          + '⚠ Con más de un segmento el mensaje puede NO llegar. '
          + 'Acórtelo hasta que diga 1 SMS.</div>'
        : '');
    caja.style.color = noLlega || (r.alfabeto === 'UCS-2' && r.segmentos > 1)
      ? '#A93226'
      : 'var(--color-text-muted)';
  };
})();
