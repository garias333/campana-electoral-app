/**
 * whatsapp-lote.js — Escribir por WhatsApp a las personas de un filtro.
 *
 * LO QUE ESTO NO ES, Y CONVIENE QUE QUEDE ESCRITO
 *   No es un envío masivo. WhatsApp Web no tiene uno: un enlace `wa.me` abre
 *   UN chat. Mandar a ochenta personas de un clic solo se puede por la API de
 *   WhatsApp Business —que esta aplicación descartó a propósito, porque obliga
 *   a plantillas aprobadas por Meta y mete a la campaña en su política— o con
 *   un automatizador no oficial, que es la vía corta a que le cierren la línea.
 *
 * LO QUE SÍ ES
 *   Un asistente: el mensaje se escribe UNA vez y la aplicación va abriendo el
 *   chat de cada persona con el texto ya puesto. El «enviar» sigue siendo suyo,
 *   uno por persona; lo que desaparece es buscar el contacto, volver a teclear
 *   y llevar la cuenta de por quién iba.
 *
 * POR QUÉ UN CLIC POR PERSONA Y NO OCHENTA PESTAÑAS DE GOLPE
 *   No es una elección de diseño: el navegador bloquea toda ventana que no
 *   venga de un clic directo de la persona. La segunda pestaña ya no abriría.
 *   Abrir de a una es lo único que funciona de verdad.
 *
 * QUIÉN QUEDA FUERA
 *   Quien no tiene teléfono —no hay a dónde escribirle— y quien pidió no
 *   recibir mensajes (`no_contactar`), que es la misma lista que respeta el
 *   canal de SMS. Los dos grupos se CUENTAN en pantalla en vez de desaparecer:
 *   un total que no cuadra sin explicación hace que alguien los agregue a mano.
 *
 * El mensaje sale de la cuenta personal de quien está en el computador, con su
 * número. No pasa por ningún proveedor y no gasta créditos.
 */
'use strict';

(function () {
  // Los dos primeros cambian POR PERSONA; los dos últimos son de la campaña
  // y valen lo mismo para todos. Se separan porque los de campaña se leen una
  // sola vez al abrir el asistente, y no una por destinatario.
  const MARCADORES_PERSONA = ['{nombre}', '{primer_nombre}'];
  const MARCADORES_CAMPANA = ['{candidato}', '{slogan}'];
  const MARCADORES = [...MARCADORES_PERSONA, ...MARCADORES_CAMPANA];

  function soloDigitos(t) { return String(t || '').replace(/\D/g, ''); }

  /** 57 delante, pero solo si no lo trae ya: si no, quedaría 5757… */
  function aInternacional(telefono) {
    const d = soloDigitos(telefono);
    if (!d) return null;
    return d.startsWith('57') ? d : '57' + d;
  }

  function reemplazarMarcadores(texto, persona, campana = {}) {
    const nombre = String(persona.nombre || '').trim();
    // Los de campaña se reemplazan por cadena vacía si no están configurados,
    // no por el marcador crudo: mandar «Hola Ana, {slogan}» es peor que
    // mandar la frase sin él. Quien configure el eslogan lo verá aparecer.
    return String(texto || '')
      .replace(/\{nombre\}/gi, nombre)
      .replace(/\{primer_nombre\}/gi, nombre.split(/\s+/)[0] || nombre)
      .replace(/\{candidato\}/gi, String(campana.candidato || '').trim())
      .replace(/\{slogan\}/gi, String(campana.slogan || '').trim())
      .replace(/[ \t]{2,}/g, ' ')       // sin marcador, no queda doble espacio
      .trim();
  }

  function escapar(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * @param {Object} opciones
   * @param {string} opciones.titulo     qué lista es, para el encabezado
   * @param {Function} opciones.obtenerPersonas  async () => [{nombre, telefono, no_contactar}]
   *        Cada pantalla sabe cómo conseguir SUS filtrados: Estructura los
   *        tiene en memoria, Votantes tiene que volver a preguntarle al
   *        servidor porque su tabla está paginada y solo muestra 50.
   */
  async function abrir({ titulo, obtenerPersonas }) {
    let personas;
    try {
      personas = await obtenerPersonas();
    } catch (err) {
      alert('No se pudo armar la lista: ' + err.message);
      return;
    }

    // El nombre del candidato y el eslogan son los mismos para todos, así que
    // se piden UNA vez. Si la consulta falla, el asistente sigue funcionando
    // con los marcadores de persona: quedarse sin escribir por no poder leer
    // el eslogan sería desproporcionado.
    let campana = {};
    try {
      const cfg = await api('/configuracion/campana');
      campana = { candidato: cfg.nombre_candidato || '', slogan: cfg.slogan_campana || '' };
    } catch (_) { /* se sigue sin ellos */ }

    const conTelefono = [];
    let sinTelefono = 0, dadosDeBaja = 0;
    for (const p of personas || []) {
      if (p.no_contactar) { dadosDeBaja++; continue; }
      if (!soloDigitos(p.telefono)) { sinTelefono++; continue; }
      conTelefono.push(p);
    }

    if (!conTelefono.length) {
      alert('Ninguna de las personas del filtro tiene teléfono al que escribirle'
        + (dadosDeBaja ? `, y ${dadosDeBaja} pidieron no recibir mensajes.` : '.'));
      return;
    }

    // Si un marcador de campaña está vacío se dice en pantalla: escribirlo en
    // el mensaje y que salga en blanco es el fallo que nadie nota hasta que ya
    // se mandó.
    const sinConfigurar = [];
    if (!campana.candidato) sinConfigurar.push('{candidato}');
    if (!campana.slogan) sinConfigurar.push('{slogan}');

    const fondo = document.createElement('div');
    fondo.className = 'wa-lote-fondo';
    fondo.innerHTML = `
      <div class="wa-lote-caja" role="dialog" aria-modal="true" aria-label="Escribir por WhatsApp">
        <div class="wa-lote-cabeza">
          <h3>Escribir por WhatsApp · ${escapar(titulo)}</h3>
          <button type="button" class="wa-lote-cerrar" aria-label="Cerrar">&times;</button>
        </div>

        <div class="wa-lote-cuerpo">
          <p class="wa-lote-aviso">
            El mensaje se escribe una vez y se abre el chat de cada persona con el texto ya puesto:
            usted solo presiona enviar en WhatsApp. Sale de <strong>su</strong> cuenta, con su número.
            No cuesta créditos.
          </p>

          <label for="wa-lote-texto">Mensaje</label>
          <textarea id="wa-lote-texto" rows="4"
            placeholder="Hola {nombre}, le recuerdo la reunión del jueves a las 6 p.m."></textarea>
          <p class="wa-lote-marcadores">
            Marcadores: ${MARCADORES.map(m => `<button type="button" class="wa-lote-marcador">${m}</button>`).join(' ')}
            ${sinConfigurar.length
              ? `<br><span class="wa-lote-falta">Sin configurar todavía: ${sinConfigurar.join(' y ')} — en Configuración → Datos de la campaña.</span>`
              : ''}
          </p>

          <div class="wa-lote-resumen">
            <strong id="wa-lote-progreso">0 de ${conTelefono.length}</strong> abiertos
            ${sinTelefono ? ` · <span title="No hay a dónde escribirles">${sinTelefono} sin teléfono</span>` : ''}
            ${dadosDeBaja ? ` · <span title="Pidieron no recibir mensajes">${dadosDeBaja} dados de baja</span>` : ''}
          </div>

          <ul class="wa-lote-lista" id="wa-lote-lista"></ul>
        </div>
      </div>`;
    document.body.appendChild(fondo);

    const lista = fondo.querySelector('#wa-lote-lista');
    const texto = fondo.querySelector('#wa-lote-texto');
    const progreso = fondo.querySelector('#wa-lote-progreso');
    let abiertos = 0;

    conTelefono.forEach((p, i) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="wa-lote-persona">
          <span class="wa-lote-nombre">${escapar(p.nombre)}</span>
          <span class="wa-lote-tel">${escapar(p.telefono)}</span>
        </span>
        <button type="button" class="btn-secundario btn-sm wa-lote-abrir">Abrir chat</button>`;
      lista.appendChild(li);

      li.querySelector('.wa-lote-abrir').addEventListener('click', () => {
        const cuerpo = reemplazarMarcadores(texto.value, p, campana);
        // El texto va como parámetro `text`: WhatsApp lo deja escrito en el
        // chat y la persona presiona enviar. Sin encodeURIComponent, un signo
        // de interrogación o un & cortan el mensaje a la mitad.
        const url = `https://wa.me/${aInternacional(p.telefono)}`
          + (cuerpo.trim() ? `?text=${encodeURIComponent(cuerpo)}` : '');
        window.open(url, '_blank', 'noopener');

        if (!li.classList.contains('wa-lote-hecho')) {
          li.classList.add('wa-lote-hecho');
          abiertos++;
          progreso.textContent = `${abiertos} de ${conTelefono.length}`;
        }
        // La siguiente pendiente se marca para no perder el hilo al volver de
        // WhatsApp, que es justo cuando uno no se acuerda por dónde iba.
        const siguiente = lista.querySelector('li:not(.wa-lote-hecho)');
        if (siguiente) {
          lista.querySelectorAll('.wa-lote-siguiente').forEach(x => x.classList.remove('wa-lote-siguiente'));
          siguiente.classList.add('wa-lote-siguiente');
          siguiente.scrollIntoView({ block: 'nearest' });
        }
      });
    });

    const primera = lista.querySelector('li');
    if (primera) primera.classList.add('wa-lote-siguiente');

    fondo.querySelectorAll('.wa-lote-marcador').forEach(b => {
      b.addEventListener('click', () => {
        texto.value += b.textContent;
        texto.focus();
      });
    });

    const cerrar = () => fondo.remove();
    fondo.querySelector('.wa-lote-cerrar').addEventListener('click', cerrar);
    fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { cerrar(); document.removeEventListener('keydown', esc); }
    });
    texto.focus();
  }

  window.EnvioWhatsApp = { abrir, aInternacional, reemplazarMarcadores };
})();
