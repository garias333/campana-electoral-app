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

  /* DÓNDE VA UN AVISO «DEBAJO DEL CAMPO». Si el campo lleva el micrófono del dictado (js/dictado.js), el
     campo vive dentro de una caja `.campo-con-dictado` —micrófono + campo, en fila—, y un aviso insertado
     «después del campo» quedaría DENTRO de esa fila, al lado. Se pone después de la caja. Sin micrófono, el
     ancla es el propio campo, como siempre. */
  function anclaDe(campo) {
    const padre = campo.parentElement;
    return padre && padre.classList.contains('campo-con-dictado') ? padre : campo;
  }

  function cajaDeAviso(campo) {
    const id = `aviso-cedula-${campo.id}`;
    let caja = document.getElementById(id);
    if (!caja) {
      caja = document.createElement('small');
      caja.id = id;
      caja.style.cssText = 'display:none; color:#A93226; font-size:0.78rem; margin-top:3px;';
      anclaDe(campo).insertAdjacentElement('afterend', caja);
    }
    return caja;
  }

  /* EL AVISO DEL NOMBRE VA DEBAJO DEL NOMBRE, no debajo de la cédula. «Revise la escritura del nombre y el
     apellido» sale de revisar la cédula junto con los nombres, y por eso aparecía bajo el campo de la
     cédula: la persona lo leía como un problema del número. Es de otro campo y se muestra en el otro. */
  function cajaDeAvisoNombre(idCedula, campoNombre) {
    const id = `aviso-nombre-${idCedula}`;
    let caja = document.getElementById(id);
    if (!caja) {
      caja = document.createElement('small');
      caja.id = id;
      caja.style.cssText = 'display:none; color:#A93226; font-size:0.78rem; margin-top:3px;';
      anclaDe(campoNombre).insertAdjacentElement('afterend', caja);
    }
    return caja;
  }
  const esMensajeDelNombre = (m) => /nombre y el apellido/i.test(m);

  function revisar(campo, selectorNombre) {
    if (!window.ValidarCedula) return; // el validador no cargó: se calla
    const caja = cajaDeAviso(campo);
    const campoNombre = selectorNombre ? document.querySelector(selectorNombre) : null;
    const cajaNombre = campoNombre ? cajaDeAvisoNombre(campo.id, campoNombre) : null;
    const valor = (campo.value || '').trim();
    caja.style.display = 'none';
    if (cajaNombre) cajaNombre.style.display = 'none';
    if (!valor) return; // la cédula no es obligatoria

    const nombre = campoNombre ? (campoNombre.value || '').trim() : '';
    const partes = nombre.split(/\s+/).filter(Boolean);

    const r = window.ValidarCedula.validarCedula({
      cedula: valor,
      primerNombre: partes[0] || '',
      primerApellido: partes.length > 1 ? partes[partes.length - 1] : '',
    }, []);

    if (r.nivel === 'ok' || !r.mensajes.length) return;
    // Cada mensaje en el campo del que habla. Sin campo de nombre en la pantalla, todo va bajo la cédula.
    const delNombre = cajaNombre ? r.mensajes.filter(esMensajeDelNombre) : [];
    const delNumero = r.mensajes.filter((m) => !cajaNombre || !esMensajeDelNombre(m));
    if (delNumero.length) { caja.textContent = delNumero[0]; caja.style.display = 'block'; }
    if (delNombre.length) { cajaNombre.textContent = delNombre[0]; cajaNombre.style.display = 'block'; }
  }

  /* ------------------------------------------------------------------
     UNA CEDULA QUE YA EXISTE NO ES UN ERROR: ES OTRA SITUACION

     Antes, teclear una cedula ya registrada no decia nada aqui y reventaba al
     guardar con «Ya registrado por otro lider» — con la persona delante y sin
     nada que hacer. Con dos aspirantes al Concejo en la misma campaña, eso pasa
     a diario.

     NO ES UN DIALOGO DE CONFIRMACION, y es deliberado: lo que ocurre todos los
     dias se acepta sin leerlo, asi que no protege de nada y solo estorba. Se
     resuelve en el propio formulario, mientras se escribe.

     Tres desenlaces:
       no existe ....... no se dice nada, formulario en blanco como siempre
       ya es suya ...... se avisa, para que no la registre dos veces
       es de otra rama . se rellenan nombre y telefono, y se ofrece sumarla

     El tercero es el que ahorra el trabajo: nadie vuelve a teclear lo que ya
     esta escrito.
     ------------------------------------------------------------------ */
  function cajaDeExistente(campo) {
    const id = `existe-cedula-${campo.id}`;
    let caja = document.getElementById(id);
    if (!caja) {
      caja = document.createElement('div');
      caja.id = id;
      caja.style.cssText = 'display:none; font-size:0.82rem; margin-top:6px; padding:9px 11px;'
        + ' border-radius:8px; line-height:1.45;';
      anclaDe(campo).insertAdjacentElement('afterend', caja);
    }
    return caja;
  }

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Rellena un campo del formulario si existe y esta vacio. */
  function rellenar(selector, valor) {
    const el = document.querySelector(selector);
    if (el && !((el.value || '').trim()) && valor) el.value = valor;
  }

  async function revisarExistente(campo, selectorNombre) {
    const caja = cajaDeExistente(campo);
    const valor = (campo.value || '').trim();
    caja.style.display = 'none';
    if (!valor || typeof window.api !== 'function') return;

    let r;
    try {
      r = await window.api('/votantes/buscar-por-cedula?cedula=' + encodeURIComponent(valor));
    } catch (e) { return; }   // sin red se calla; el guardado dira lo que haya que decir
    if (!r || !r.id) return;

    if (r.mia) {
      caja.style.cssText += 'display:block; background:#FFF8E1; border:1px solid #E0A72E; color:#7A5B00;';
      caja.innerHTML = `<strong>${esc(r.nombre)}</strong> ya está en su estructura. `
        + 'No hace falta registrarla otra vez.';
      return;
    }

    // Existe en otra rama: se rellena lo que ya se sabe y se ofrece sumarla.
    rellenar(selectorNombre, r.nombre);
    rellenar('input[name="telefono"]', r.telefono);

    caja.style.cssText += 'display:block; background:#E6F4F1; border:1px solid #0F7B6C; color:#0A5348;';
    caja.innerHTML = `<strong>${esc(r.nombre)}</strong> ya está registrada en la campaña.`
      + (r.puede_sumar
          ? ' <button type="button" class="btn-sumar-rama" data-id="' + r.id + '"'
            + ' style="margin-left:6px; padding:4px 11px; border:none; border-radius:999px;'
            + ' background:#0F7B6C; color:#fff; font-size:0.8rem; cursor:pointer;">'
            + 'Agregar a mi estructura</button>'
          : ' No hace falta volver a escribirla.');

    const boton = caja.querySelector('.btn-sumar-rama');
    if (boton) {
      boton.addEventListener('click', async () => {
        boton.disabled = true;
        boton.textContent = 'Agregando...';
        try {
          await window.api('/votantes/' + r.id + '/sumar-a-mi-rama', { method: 'POST' });
          caja.innerHTML = `<strong>${esc(r.nombre)}</strong> quedó en su estructura.`;
        } catch (e) {
          boton.disabled = false;
          boton.textContent = 'Agregar a mi estructura';
          caja.insertAdjacentHTML('beforeend',
            '<div style="color:#A93226; margin-top:5px;">No se pudo: ' + esc(e.message) + '</div>');
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    for (const [idCampo, selectorNombre] of Object.entries(CAMPOS)) {
      const campo = document.getElementById(idCampo);
      if (!campo) continue;
      campo.addEventListener('blur', () => revisar(campo, selectorNombre));
      campo.addEventListener('blur', () => revisarExistente(campo, selectorNombre));
      /* Al salir del NOMBRE también: en los formularios donde la cédula va ANTES (Registro de votantes y el
         de Estructura, que consultan primero el lugar de votación) el nombre todavía no existía cuando se
         salió de la cédula, y el aviso de la escritura del nombre no habría salido nunca. */
      const campoDelNombre = selectorNombre ? document.querySelector(selectorNombre) : null;
      if (campoDelNombre) {
        campoDelNombre.addEventListener('blur', () => revisar(campo, selectorNombre));
        campoDelNombre.addEventListener('input', () => {
          const c = document.getElementById(`aviso-nombre-${campo.id}`);
          if (c) c.style.display = 'none';
        });
      }
      // Al corregir, el aviso se va sin esperar a salir del campo.
      campo.addEventListener('input', () => {
        const caja = document.getElementById(`aviso-cedula-${campo.id}`);
        if (caja) caja.style.display = 'none';
        const otra = document.getElementById(`existe-cedula-${campo.id}`);
        if (otra) otra.style.display = 'none';
      });
    }
  });
})();
