/**
 * Aviso en pantalla al digitar una cédula.
 *
 * QUÉ HACE
 *   Al salir del campo, muestra debajo un mensaje si el número tiene algo
 *   raro. NO impide seguir llenando el formulario ni guardar: la decisión
 *   de bloquear la toma el servidor, y solo con formatos imposibles.
 *
 * POR QUÉ AQUÍ NO SE BLOQUEA
 *   Este archivo es comodidad para quien captura. La guarda de verdad está
 *   en el servidor (ver revisarCedula en routes/votantes.routes.js): un
 *   formulario se puede saltar llamando a la API directo, y de hecho así
 *   se probó. Si esto bloqueara y el servidor no, tendríamos dos reglas.
 *
 * UNA SOLA COPIA DEL VALIDADOR
 *   Las reglas viven en lib/validarCedula.js, el MISMO archivo que usa el
 *   servidor, servido en /js/validarCedula.js. No se duplica a propósito:
 *   dos copias divergen tarde o temprano y el formulario diría una cosa y
 *   la API otra, que es el peor de los mundos.
 *
 * SE ENGANCHA SOLO
 *   Busca los campos de cédula por id en cada pantalla. Basta con incluir
 *   este archivo; si la pantalla no tiene ninguno, no hace nada.
 */
(function () {
  // id del campo de cédula -> id del campo de nombre, para poder avisar
  // también de nombres de relleno («XX», «NN») cuando los haya.
  const CAMPOS = {
    'input-numero-votante': 'input[name="nombre"]',
    'input-numero-persona': 'input[name="nombre"]',
    'input-numero-testigo': 'input[name="nombre"]',
    'f-cedula': '#f-nombre',
  };

  function cajaDeAviso(campo) {
    const id = `aviso-cedula-${campo.id}`;
    let caja = document.getElementById(id);
    if (!caja) {
      caja = document.createElement('small');
      caja.id = id;
      caja.style.cssText = 'display:none; color:#A93226; font-size:0.78rem; margin-top:3px;';
      campo.insertAdjacentElement('afterend', caja);
    }
    return caja;
  }

  function revisar(campo, selectorNombre) {
    if (!window.ValidarCedula) return; // el validador no cargó: se calla
    const caja = cajaDeAviso(campo);
    const valor = (campo.value || '').trim();
    if (!valor) { caja.style.display = 'none'; return; } // la cédula no es obligatoria

    const campoNombre = selectorNombre ? document.querySelector(selectorNombre) : null;
    const nombre = campoNombre ? (campoNombre.value || '').trim() : '';
    const partes = nombre.split(/\s+/).filter(Boolean);

    const r = window.ValidarCedula.validarCedula({
      cedula: valor,
      primerNombre: partes[0] || '',
      primerApellido: partes.length > 1 ? partes[partes.length - 1] : '',
    }, []);

    if (r.nivel === 'ok' || !r.mensajes.length) { caja.style.display = 'none'; return; }
    caja.textContent = r.mensajes[0];
    caja.style.display = 'block';
  }

  document.addEventListener('DOMContentLoaded', () => {
    for (const [idCampo, selectorNombre] of Object.entries(CAMPOS)) {
      const campo = document.getElementById(idCampo);
      if (!campo) continue;
      campo.addEventListener('blur', () => revisar(campo, selectorNombre));
      // Al corregir, el aviso se va sin esperar a salir del campo.
      campo.addEventListener('input', () => {
        const caja = document.getElementById(`aviso-cedula-${campo.id}`);
        if (caja) caja.style.display = 'none';
      });
    }
  });
})();
