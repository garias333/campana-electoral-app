/**
 * AUTORIZACIÓN DE DATOS POR ENLACE DE WHATSAPP — la pestaña «Autorización de datos» de Votantes y de Estructura territorial
 * (parche 325). La lógica y la página donde la persona firma están en el servidor (config/autorizacionDatos.js, routes/autorizacion.routes.js);
 * esto solo pinta el estado y los botones, y arma la dirección de WhatsApp.
 *
 * LA APP NO ENVÍA NADA POR SU CUENTA. El servidor crea un enlace de un solo uso (vence en 7 días) y devuelve el mensaje; aquí se abre
 * https://wa.me/57<celular>?text=<mensaje> y es la persona que registra quien lo manda desde su propio WhatsApp.
 *
 *   montarAutorizacionDatos({
 *     tipo: 'votante' | 'estructura', contenedor, ruta: '/votantes' | '/territorial/estructura',
 *     obtenerId(): id de la persona o null si todavía no está guardada,
 *     obtenerCelular(): los dígitos escritos en Contacto, campoCelular(): el campo (para mostrar el error ahí y saltar a su pestaña),
 *     guardarSiNuevo(): guarda a la persona y devuelve su id (o null si el formulario tiene errores),
 *     puedeConstancia: true (o una función que lo diga) para admin y coordinador; el usuario llega después de cargar la página
 *   })  →  { actualizar() }
 * Necesita common.js (api, mostrarToast, mostrarErrorCampo).
 */
(function (global) {
  'use strict';

  const ETIQUETA = { sin: 'Sin autorización', pendiente: 'Pendiente', vencida: 'Vencida', firmada: 'Firmada', verbal: 'Verbal (sin firma)' };

  function fecha(d) {
    if (!d) return '';
    try { return new Date(d).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return String(d); }
  }
  function escapar(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /** La insignia pequeña del estado, para las listas. */
  function pildora(estado) {
    const e = ETIQUETA[estado] ? estado : 'sin';
    return '<span class="aut-pill aut-' + e + '" title="Autorización de datos: ' + escapar(ETIQUETA[e]) + '">' + escapar(ETIQUETA[e]) + '</span>';
  }

  function textoDeEstado(s) {
    switch (s.estado) {
      case 'firmada': return 'Firmada el ' + fecha(s.firmada_en) + (s.politica_version ? ' (versión ' + s.politica_version + ' de la política)' : '')
        + (s.via === 'pantalla' ? ' — firma en pantalla al registrar' : '');
      case 'pendiente': return 'Enlace enviado el ' + fecha(s.enviada_en) + ', pendiente de firma (vence el ' + fecha(s.expira_en) + ')';
      case 'vencida': return 'El enlace enviado el ' + fecha(s.enviada_en) + ' venció sin firmarse';
      case 'verbal': return 'Alguien marcó que la persona autorizó, pero no hay firma suya' + (s.fecha ? ' (' + fecha(s.fecha) + ')' : '');
      default: return 'Sin autorización';
    }
  }

  function montar(op) {
    const cont = op.contenedor;
    if (!cont) return null;
    cont.innerHTML = ''
      + '<div class="aut-estado" data-aut="estado" aria-live="polite"></div>'
      + '<div class="aut-botones">'
      + '<button type="button" class="btn-acento" data-aut="enviar">💬 Enviar autorización por WhatsApp</button>'
      + '<button type="button" class="btn-secundario" data-aut="copiar">Copiar enlace</button>'
      + '<button type="button" class="btn-secundario" data-aut="constancia">Ver constancia</button>'
      + '</div>'
      + '<small class="aut-ayuda" data-aut="ayuda">Se abre WhatsApp con un mensaje para la persona y un enlace donde lee la política de tratamiento de datos, marca lo que autoriza y firma con el dedo. '
      + 'El enlace sirve una sola vez y vence en 7 días. Usted lo envía desde su propio WhatsApp: la plataforma no manda nada por su cuenta.</small>';
    const q = (n) => cont.querySelector('[data-aut="' + n + '"]');
    const btnEnviar = q('enviar'), btnCopiar = q('copiar'), btnConstancia = q('constancia');
    let estado = { estado: 'sin' };
    let ocupado = false;

    function pintar() {
      q('estado').innerHTML = pildora(estado.estado) + ' <span class="aut-texto">' + escapar(textoDeEstado(estado)) + '</span>';
      const firmada = estado.estado === 'firmada';
      const reenvio = estado.estado === 'pendiente' || estado.estado === 'vencida';
      btnEnviar.textContent = reenvio ? '↻ Reenviar por WhatsApp' : '💬 Enviar autorización por WhatsApp';
      btnEnviar.style.display = firmada ? 'none' : '';
      btnCopiar.style.display = firmada ? 'none' : '';
      const puedeConstancia = typeof op.puedeConstancia === 'function' ? op.puedeConstancia() : !!op.puedeConstancia;
      btnConstancia.style.display = puedeConstancia && (firmada || estado.estado === 'verbal') && op.obtenerId() ? '' : 'none';
      q('ayuda').style.display = firmada ? 'none' : '';
      btnEnviar.disabled = btnCopiar.disabled = ocupado;
    }

    async function actualizar() {
      const id = op.obtenerId();
      if (!id) { estado = { estado: 'sin' }; pintar(); return; }
      try { estado = await api(op.ruta + '/' + id + '/autorizacion'); } catch (e) { estado = { estado: 'sin' }; }
      pintar();
    }

    /** Pide el enlace al servidor. Si la persona todavía no está guardada, primero la guarda. */
    async function crearEnlace(canal) {
      let id = op.obtenerId();
      if (!id) {
        id = await op.guardarSiNuevo();
        if (!id) return null;                          // el formulario tenía errores: ya salieron junto a su campo
      }
      const r = await api(op.ruta + '/' + id + '/autorizacion/enlace', { method: 'POST', body: { canal } });
      return r;
    }

    function celularValido() {
      const c = String(op.obtenerCelular() || '').replace(/\D/g, '');
      if (/^\d{10}$/.test(c)) return c;
      mostrarErrorCampo(op.campoCelular(), 'Escribe el celular de 10 dígitos de la persona (en Contacto) para enviarle el enlace por WhatsApp.');
      return null;
    }

    btnEnviar.addEventListener('click', async () => {
      if (ocupado) return;
      const celular = celularValido();
      if (!celular) return;
      /* La ventana se abre YA, dentro del clic: el navegador solo la permite mientras dura el gesto de la persona, y guardar +
         pedir el enlace tarda. Cuando llega el enlace se le pone su dirección. */
      const ventana = window.open('', '_blank');
      ocupado = true; pintar();
      try {
        const r = await crearEnlace('whatsapp');
        if (!r) { if (ventana && ventana.close) ventana.close(); return; }
        const url = 'https://wa.me/57' + celular + '?text=' + encodeURIComponent(r.mensaje);
        if (ventana && ventana.location) ventana.location.href = url; else window.open(url, '_blank');
        mostrarToast('Se abrió WhatsApp con el mensaje. Envíelo desde su cuenta: la persona recibirá el enlace para firmar.', 'ok');
        if (typeof op.alEnviar === 'function') op.alEnviar(r);
      } catch (err) {
        if (ventana && ventana.close) ventana.close();
        mostrarToast(err.message || 'No se pudo crear el enlace.', 'error');
      } finally {
        ocupado = false;
        await actualizar();
      }
    });

    btnCopiar.addEventListener('click', async () => {
      if (ocupado) return;
      ocupado = true; pintar();
      try {
        const r = await crearEnlace('copiado');
        if (!r) return;
        try { await navigator.clipboard.writeText(r.enlace); mostrarToast('Enlace copiado. Vale 7 días y un solo uso; el anterior quedó anulado.', 'ok'); }
        catch (e) { window.prompt('Copie el enlace (Ctrl+C):', r.enlace); }
      } catch (err) {
        mostrarToast(err.message || 'No se pudo crear el enlace.', 'error');
      } finally {
        ocupado = false;
        await actualizar();
      }
    });

    btnConstancia.addEventListener('click', () => {
      const id = op.obtenerId();
      if (id) window.open('/api' + op.ruta + '/' + id + '/autorizacion/constancia', '_blank');
    });

    pintar();
    return { actualizar };
  }

  global.montarAutorizacionDatos = montar;
  global.AutorizacionDatos = { pildora, ETIQUETA };
})(window);
