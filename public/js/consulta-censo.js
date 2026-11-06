/* «CONSULTAR LUGAR DE VOTACIÓN»: copia la cédula al portapapeles antes de abrir la Registraduría.

   POR QUÉ. La consulta del censo (https://consultacenso.registraduria.gov.co/) pide el número de cédula, y
   quien registra ya lo tiene tecleado en el formulario. Copiarlo ahorra teclearlo otra vez en el celular: en la
   Registraduría basta mantener presionado el campo «No. Identificación» y tocar «Pegar».

   NO SE LE PASA LA CÉDULA A LA PÁGINA. Ni por la dirección ni llenándola desde aquí: la Registraduría no
   documenta ningún parámetro público para eso, y su página pasa antes por una verificación de la conexión. Lo
   único que se hace es poner el número en el portapapeles; lo demás lo hace la persona con su dedo.

   LO QUE HAY QUE SABER (por esto va así):

     · EL COPIADO TIENE QUE EMPEZAR DENTRO DEL MISMO TOQUE. Safari de iPhone solo deja escribir en el portapapeles
       durante el gesto de la persona, y abrir la ventana también lo necesita. Por eso aquí NO se espera nada
       (ningún `await`) antes de copiar: `writeText` se llama en seco y el que llama abre la ventana a
       continuación, en la misma pasada.

     · SI EL PORTAPAPELES MODERNO NO ESTÁ (o la promesa se rechaza), se usa el viejo: un textarea oculto y
       `document.execCommand('copy')`.

     · SOLO LOS DÍGITOS. «1.053.123.456» se copia como «1053123456»: es lo que acepta el campo de la Registraduría.

   Se llama desde el escuchador de clic del botón, ANTES de abrir la Registraduría:

       copiarCedulaParaConsulta(campoDeLaCedula, cajaDelAviso);

   No devuelve nada que haya que esperar. Escribe el resultado en `cajaDelAviso` (un <small> o <div> vacío). */
(function (global) {
  'use strict';

  /** Respaldo para navegadores sin portapapeles moderno: textarea oculto + execCommand. Devuelve true si copió. */
  function copiarConTextarea(texto) {
    const t = document.createElement('textarea');
    t.value = texto;
    t.setAttribute('readonly', '');          // sin esto, en iPhone se abre el teclado
    t.style.cssText = 'position:fixed; top:0; left:0; width:1px; height:1px; opacity:0; font-size:16px;';
    document.body.appendChild(t);
    let copio = false;
    try {
      t.focus();
      t.select();
      t.setSelectionRange(0, texto.length);   // iOS no respeta select() a secas
      copio = document.execCommand('copy');
    } catch (e) { copio = false; }
    t.remove();
    return copio;
  }

  function decir(caja, texto, tipo) {
    if (!caja) return;
    caja.textContent = texto;
    caja.style.cssText = 'display:block; margin-top:8px; padding:8px 10px; border-radius:8px; font-size:0.8rem; line-height:1.45;'
      + (tipo === 'ok'
        ? ' background:#E6F4F1; border:1px solid #0F7B6C; color:#0A5348;'
        : ' background:#FFF8E1; border:1px solid #E0A72E; color:#7A5B00;');
  }

  global.copiarCedulaParaConsulta = function (campo, caja) {
    const digitos = String((campo && campo.value) || '').replace(/\D/g, '');

    // Sin cédula no hay nada que copiar: la Registraduría se abre igual (lo decide quien llama) y se avisa.
    if (!digitos) {
      decir(caja, 'Escribe primero la cédula para copiarla.', 'aviso');
      return false;
    }

    const visto = digitos.length > 4 ? digitos.slice(0, 4) + '…' : digitos;
    const mensajeOk = `Cédula ${visto} copiada. En la Registraduría, mantén presionado el campo No. Identificación y toca Pegar.`;
    const mensajeFallo = 'No se pudo copiar la cédula. Cópiala a mano del campo de arriba.';

    // 1) Portapapeles moderno, llamado EN SECO (sin await): sigue dentro del toque.
    let promesa = null;
    if (global.navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try { promesa = navigator.clipboard.writeText(digitos); } catch (e) { promesa = null; }
    }
    if (promesa && typeof promesa.then === 'function') {
      promesa.then(
        () => decir(caja, mensajeOk, 'ok'),
        // 2) Se rechazó (permiso, página no segura…): el respaldo viejo, que sigue valiendo en la misma pasada.
        () => (copiarConTextarea(digitos) ? decir(caja, mensajeOk, 'ok') : decir(caja, mensajeFallo, 'aviso'))
      );
      return true;
    }
    // Sin portapapeles moderno: respaldo directo.
    if (copiarConTextarea(digitos)) { decir(caja, mensajeOk, 'ok'); return true; }
    decir(caja, mensajeFallo, 'aviso');
    return false;
  };
})(window);
