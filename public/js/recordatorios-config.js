/**
 * CONFIGURACIÓN → RECORDATORIOS (Fase 4). La pantalla del administrador de los recordatorios automáticos.
 *
 * Se dibuja entera dentro de #rec-contenido (configuracion.html) cuando se abre la pestaña. Habla con /api/recordatorios
 * (routes/recordatorios.routes.js) y NO decide nada por su cuenta: lo que valida el servidor es lo que vale; aquí solo se
 * muestra, se avisa en vivo y se pide.
 *
 *   1. Configuración: interruptor general · fecha permitida de propaganda · tope diario de SMS (con el saldo y el límite del
 *      libro central a la vista) · horas de silencio.
 *   2. Reglas: activar / apagar, editar la plantilla (con el validador en vivo y el contador de segmentos) y «Enviarme una prueba».
 *   3. Historial de envíos, con filtros por estado, motivo de omisión y regla.
 *
 * Todo texto que viene del servidor o de la base pasa por escaparHtml (common.js) antes de pintarse.
 */
(function () {
  'use strict';

  const ESTILOS = `
    #seccion-recordatorios .rec-bloque { border: 1px solid var(--color-border, #E2E5EA); border-radius: 12px; padding: 18px; margin: 0 0 18px; background: #fff; }
    #seccion-recordatorios .rec-bloque > h4 { margin: 0 0 4px; font-size: 1.02rem; }
    #seccion-recordatorios .rec-ayuda { color: var(--color-text-muted, #5B6472); font-size: .85rem; margin: 2px 0 12px; line-height: 1.45; }
    #seccion-recordatorios .rec-cuadricula { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; align-items: start; }
    #seccion-recordatorios .rec-campo label { display: block; font-weight: 600; font-size: .85rem; margin-bottom: 4px; }
    #seccion-recordatorios .rec-campo input[type=date], #seccion-recordatorios .rec-campo input[type=number], #seccion-recordatorios .rec-campo input[type=time],
    #seccion-recordatorios .rec-campo input[type=text], #seccion-recordatorios .rec-campo select, #seccion-recordatorios .rec-campo textarea { width: 100%; box-sizing: border-box; }
    #seccion-recordatorios .rec-campo textarea { min-height: 96px; resize: vertical; font-family: inherit; }
    #seccion-recordatorios .rec-pie { display: block; font-size: .78rem; color: var(--color-text-muted, #5B6472); margin-top: 4px; line-height: 1.4; }
    #seccion-recordatorios .rec-interruptor { display: flex; gap: 10px; align-items: flex-start; font-weight: 600; cursor: pointer; }
    #seccion-recordatorios .rec-interruptor input { width: 20px; height: 20px; margin-top: 2px; flex: 0 0 auto; }
    #seccion-recordatorios .rec-estado { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: .78rem; font-weight: 700; }
    #seccion-recordatorios .rec-estado.si { background: #E7F6EE; color: #1E7B4F; }
    #seccion-recordatorios .rec-estado.no { background: #EEF0F3; color: #5B6472; }
    #seccion-recordatorios .rec-estado.alerta { background: #FDF3E0; color: #9A6200; }
    #seccion-recordatorios .rec-estado.mal { background: #FBEAEA; color: #A93226; }
    #seccion-recordatorios .rec-libro { background: #F4F6FA; border-radius: 10px; padding: 10px 12px; font-size: .85rem; line-height: 1.5; margin-top: 8px; }
    #seccion-recordatorios .rec-msg { margin-top: 10px; font-size: .88rem; }
    #seccion-recordatorios .rec-msg.ok { color: #1E7B4F; }
    #seccion-recordatorios .rec-msg.error { color: #A93226; }
    #seccion-recordatorios .rec-msg.aviso { color: #9A6200; }
    #seccion-recordatorios .rec-tabla { width: 100%; border-collapse: collapse; font-size: .88rem; }
    #seccion-recordatorios .rec-tabla th, #seccion-recordatorios .rec-tabla td { text-align: left; padding: 9px 8px; border-bottom: 1px solid var(--color-border, #E2E5EA); vertical-align: top; }
    #seccion-recordatorios .rec-tabla th { font-size: .76rem; text-transform: uppercase; letter-spacing: .03em; color: var(--color-text-muted, #5B6472); }
    #seccion-recordatorios .rec-acciones { display: flex; gap: 6px; flex-wrap: wrap; }
    #seccion-recordatorios .rec-vars { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0; }
    #seccion-recordatorios .rec-vars button { font-family: ui-monospace, Menlo, monospace; font-size: .78rem; padding: 3px 8px; min-height: 0; }
    #seccion-recordatorios .rec-validador { border-radius: 10px; padding: 10px 12px; font-size: .86rem; margin-top: 8px; line-height: 1.5; background: #F4F6FA; }
    #seccion-recordatorios .rec-validador.mal { background: #FBEAEA; color: #7A241B; }
    #seccion-recordatorios .rec-validador.bien { background: #E7F6EE; color: #1E5E3E; }
    #seccion-recordatorios .rec-validador ul { margin: 4px 0 0 18px; padding: 0; }
    #seccion-recordatorios .rec-filtros { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; margin-bottom: 12px; }
    #seccion-recordatorios .rec-filtros .rec-campo { min-width: 160px; flex: 1 1 160px; }
    #seccion-recordatorios .rec-motivo { color: var(--color-text-muted, #5B6472); font-size: .8rem; }
    #seccion-recordatorios .rec-cuenta { white-space: nowrap; font-size: .8rem; color: var(--color-text-muted, #5B6472); }
    @media (max-width: 820px) { #seccion-recordatorios .rec-tabla { display: block; overflow-x: auto; } }
  `;

  const ETIQUETA_ESTADO = { reclamado: 'En cola', enviando: 'Enviando…', enviado: 'Enviado', omitido: 'Omitido', fallido: 'Fallido', diferido: 'Diferido' };
  const CLASE_ESTADO = { enviado: 'si', reclamado: 'alerta', enviando: 'alerta', diferido: 'alerta', omitido: 'no', fallido: 'mal' };
  const ETIQUETA_CANAL = { sms: 'SMS', push: 'Aviso en la app', email: 'Correo' };
  const POR_PAGINA = 25;

  let usuario = null;
  let estado = null;
  let reglas = [];
  let historial = null;
  let editando = null;          // la regla que se está editando (o null)
  let filtros = { estado: '', motivo: '', regla: '', pagina: 1 };
  let temporizadorValidador = null;

  const esc = (t) => escaparHtml(String(t === null || t === undefined ? '' : t));
  const $ = (id) => document.getElementById(id);
  const puedeCambiar = () => !!usuario && (usuario.rol === 'admin' || (typeof puedeEditar === 'function' && puedeEditar(usuario, 'recordatorios')));

  function inyectarEstilos() {
    if (document.getElementById('rec-estilos')) return;
    const s = document.createElement('style');
    s.id = 'rec-estilos';
    s.textContent = ESTILOS;
    document.head.appendChild(s);
  }

  function mensaje(id, texto, tipo) {
    const el = $(id);
    if (!el) return;
    el.className = 'rec-msg ' + (tipo || '');
    el.textContent = texto || '';
  }

  /** «2026-11-08 14:00:00» → «08/11 14:00». */
  function fechaCorta(texto) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(texto || ''));
    return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : '';
  }

  function cuando(r) {
    if (r.tipo === 'dia_d_ya_votaste') return `El día de la elección, a las ${String(r.hora_dia || '').slice(0, 5)}`;
    if (r.tipo === 'solicitud_sin_movimiento') return 'Cuando una solicitud con responsable lleva días sin movimiento';
    const min = Math.abs(Number(r.desfase_min));
    if (!Number.isFinite(min)) return '—';
    return min % 60 === 0 ? `${min / 60} h antes del evento` : `${min} min antes del evento`;
  }

  /* ------------------------------------------------------------------------------------------------------ CONFIGURACIÓN */

  function pintarConfiguracion() {
    const c = estado.config;
    const lc = estado.libroCentral;
    const lectura = !puedeCambiar();
    const dis = lectura ? 'disabled' : '';
    const libro = lc
      ? `Libro central: <b>${esc(lc.disponibles)}</b> créditos disponibles · límite diario <b>${Number(lc.limiteDiario) > 0 ? esc(lc.limiteDiario) : 'sin límite'}</b> · hoy se han gastado <b>${esc(lc.consumidoHoy)}</b>${lc.disponibleHoy !== null && lc.disponibleHoy !== undefined ? ` (quedan ${esc(lc.disponibleHoy)} hoy)` : ''}.`
      : 'El libro central no respondió: no se pudo ver el saldo. El tope de arriba se aplica igual.';
    const maxTope = lc && Number(lc.limiteDiario) > 0 ? `max="${Number(lc.limiteDiario)}"` : '';
    const propaganda = estado.propagandaPermitida
      ? '<span class="rec-estado si">Ya se puede hablar de voto, elección y cargo</span>'
      : '<span class="rec-estado alerta">Todavía NO: la fecha está vacía o no ha llegado</span>';
    $('rec-bloque-config').innerHTML = `
      <h4>Configuración</h4>
      <p class="rec-ayuda">Los recordatorios salen solos, cada minuto, mientras el interruptor esté encendido. Vienen <b>apagados de fábrica</b> y cada regla se activa por separado.</p>
      <div class="rec-cuadricula">
        <div class="rec-campo">
          <label class="rec-interruptor"><input type="checkbox" id="rec-activos" ${c.recordatorios_activos ? 'checked' : ''} ${dis}> <span>Recordatorios automáticos encendidos
            <span class="rec-pie" style="font-weight:400">Es el interruptor general: apagado, no sale NADA aunque haya reglas activas.</span></span></label>
          <div style="margin-top:6px">${c.recordatorios_activos ? '<span class="rec-estado si">Encendidos</span>' : '<span class="rec-estado no">Apagados</span>'}
            ${estado.enSilencio ? '<span class="rec-estado alerta">Ahora es hora de silencio</span>' : ''}</div>
        </div>
        <div class="rec-campo">
          <label for="rec-fecha">Fecha permitida de propaganda</label>
          <input type="date" id="rec-fecha" value="${esc(c.fecha_permitida_propaganda || '')}" ${dis}>
          <span class="rec-pie">Desde esta fecha los mensajes pueden hablar de voto, elección, urnas, tarjetón o cargo. <b>Vacía = nunca</b> (precampaña). El «¿ya votaste?» no se puede activar antes.</span>
          <div style="margin-top:4px">${propaganda}</div>
        </div>
        <div class="rec-campo">
          <label for="rec-tope">Tope diario de SMS automáticos</label>
          <input type="number" id="rec-tope" min="0" ${maxTope} step="1" value="${esc(c.tope_diario_sms_automaticos)}" ${dis}>
          <span class="rec-pie">Segmentos por día. Hoy van <b>${esc(estado.usadoHoy)}</b> de <b>${esc(estado.topeEfectivo)}</b> (el tope efectivo nunca pasa del límite diario del libro central).</span>
        </div>
        <div class="rec-campo">
          <label>Horas de silencio (hora de Colombia)</label>
          <div style="display:flex; gap:8px; align-items:center">
            <input type="time" id="rec-sil-ini" value="${esc(c.silencio_inicio)}" ${dis}> <span>a</span> <input type="time" id="rec-sil-fin" value="${esc(c.silencio_fin)}" ${dis}>
          </div>
          <span class="rec-pie">En ese rato no sale nada: ni aviso en la app, ni correo, ni SMS. Lo que tocaba entonces sale cuando termina.</span>
        </div>
      </div>
      <div class="rec-libro">${libro}</div>
      ${lectura ? '<p class="rec-ayuda" style="margin-top:10px">Puedes ver esta pantalla pero no cambiarla: te falta el permiso «Editar» en Asignación de permisos.</p>'
        : '<div style="margin-top:12px"><button type="button" class="btn-primario btn-sm" id="rec-guardar-config">Guardar configuración</button></div>'}
      <div id="rec-msg-config" class="rec-msg"></div>`;
    const g = $('rec-guardar-config');
    if (g) g.addEventListener('click', guardarConfiguracion);
  }

  async function guardarConfiguracion() {
    const boton = $('rec-guardar-config');
    boton.disabled = true;
    mensaje('rec-msg-config', 'Guardando…', '');
    try {
      const r = await api('/recordatorios/config', {
        method: 'PUT',
        body: {
          recordatorios_activos: $('rec-activos').checked ? 1 : 0,
          fecha_permitida_propaganda: $('rec-fecha').value || null,
          tope_diario_sms_automaticos: $('rec-tope').value === '' ? 0 : Number($('rec-tope').value),
          silencio_inicio: $('rec-sil-ini').value,
          silencio_fin: $('rec-sil-fin').value,
        },
      });
      estado = r.estado;
      await recargarReglas();
      pintarConfiguracion();
      pintarReglas();
      mensaje('rec-msg-config', r.reglasApagadas
        ? `Guardado. Se apagaron ${r.reglasApagadas} regla(s) que exigen la fecha permitida.` : 'Guardado.', r.reglasApagadas ? 'aviso' : 'ok');
    } catch (err) {
      mensaje('rec-msg-config', err.message || 'No se pudo guardar.', 'error');
      boton.disabled = false;
    }
  }

  /* ------------------------------------------------------------------------------------------------------------ REGLAS */

  async function recargarReglas() {
    reglas = (await api('/recordatorios/reglas')).reglas;
  }

  function pintarReglas() {
    const cambiar = puedeCambiar();
    const filas = reglas.map((r) => {
      const e = r.envios || {};
      const cuentas = ['enviado', 'omitido', 'fallido', 'diferido'].filter((k) => e[k]).map((k) => `${ETIQUETA_ESTADO[k].toLowerCase()} ${e[k]}`).join(' · ') || '—';
      const bloqueada = !r.activo && estado.tipos.some((t) => t.clave === r.tipo && t.requierePropagandaPermitida) && !estado.propagandaPermitida;
      return `<tr data-regla="${r.id}">
        <td><b>${esc(r.nombre)}</b><br><span class="rec-motivo">${esc(r.tipo_etiqueta)}</span></td>
        <td>${esc(ETIQUETA_CANAL[r.canal] || r.canal)}</td>
        <td>${esc(cuando(r))}</td>
        <td>${r.activo ? '<span class="rec-estado si">Activa</span>' : '<span class="rec-estado no">Apagada</span>'}
          ${bloqueada ? '<br><span class="rec-motivo">Necesita la fecha permitida</span>' : ''}</td>
        <td class="rec-cuenta">${esc(cuentas)}</td>
        <td><div class="rec-acciones">
          ${cambiar ? `<button type="button" class="btn-secundario btn-sm" data-accion="activar" data-id="${r.id}">${r.activo ? 'Apagar' : 'Activar'}</button>` : ''}
          <button type="button" class="btn-secundario btn-sm" data-accion="editar" data-id="${r.id}">${cambiar ? 'Editar' : 'Ver'}</button>
          ${cambiar ? `<button type="button" class="btn-secundario btn-sm" data-accion="probar" data-id="${r.id}">Enviarme una prueba</button>` : ''}
        </div></td></tr>`;
    }).join('');
    $('rec-bloque-reglas').innerHTML = `
      <h4>Reglas</h4>
      <p class="rec-ayuda">Cada regla es un mensaje y el momento en que sale. Nacen apagadas. «Enviarme una prueba» lo manda a tu propio teléfono o cuenta, con datos inventados, y no cuenta en el tope diario.</p>
      <div style="overflow-x:auto"><table class="rec-tabla"><thead><tr><th>Regla</th><th>Canal</th><th>Cuándo sale</th><th>Estado</th><th>Envíos</th><th></th></tr></thead>
      <tbody>${filas || '<tr><td colspan="6">No hay reglas.</td></tr>'}</tbody></table></div>
      <div id="rec-msg-reglas" class="rec-msg"></div>
      <div id="rec-editor"></div>`;
    $('rec-bloque-reglas').querySelectorAll('button[data-accion]').forEach((b) => b.addEventListener('click', () => accionDeRegla(b.dataset.accion, Number(b.dataset.id))));
    if (editando) pintarEditor();
  }

  async function accionDeRegla(accion, id) {
    const regla = reglas.find((r) => r.id === id);
    if (!regla) return;
    if (accion === 'editar') { editando = regla; pintarEditor(); $('rec-editor').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
    if (accion === 'activar') {
      mensaje('rec-msg-reglas', '', '');
      try {
        await api(`/recordatorios/reglas/${id}/activar`, { method: 'POST', body: { activo: !regla.activo } });
        await recargarReglas();
        pintarReglas();
        mensaje('rec-msg-reglas', `${regla.activo ? 'Apagaste' : 'Activaste'} «${regla.nombre}».`, 'ok');
      } catch (err) { mensaje('rec-msg-reglas', err.message || 'No se pudo cambiar.', 'error'); }
      return;
    }
    if (accion === 'probar') {
      if (!confirm(`Se te enviará UNA prueba de «${regla.nombre}» por ${ETIQUETA_CANAL[regla.canal] || regla.canal}, con datos inventados.${regla.canal === 'sms' ? '\n\nUn SMS gasta un crédito del libro central.' : ''}\n\n¿Enviarla?`)) return;
      mensaje('rec-msg-reglas', 'Enviando la prueba…', '');
      try {
        const r = await api(`/recordatorios/reglas/${id}/probar`, { method: 'POST' });
        mensaje('rec-msg-reglas', `Prueba enviada a ${r.destino}. Dice: «${r.texto}»`, 'ok');
      } catch (err) { mensaje('rec-msg-reglas', err.message || 'No se pudo enviar la prueba.', 'error'); }
    }
  }

  /* ------------------------------------------------------------------------------------------------------------ EDITOR */

  function pintarEditor() {
    const r = editando;
    const cambiar = puedeCambiar();
    const tipo = estado.tipos.find((t) => t.clave === r.tipo) || { variables: [] };
    const esEvento = r.tipo === 'evento';
    const horas = esEvento ? Math.abs(Number(r.desfase_min)) / 60 : '';
    const usaAsunto = r.canal === 'push' || r.canal === 'email';
    $('rec-editor').innerHTML = `
      <div class="rec-bloque" style="margin-top:16px; border-color:#9DB7E8">
        <h4>${cambiar ? 'Editar' : 'Ver'}: ${esc(r.nombre)}</h4>
        <p class="rec-ayuda">${esc(r.tipo_etiqueta)} · ${esc(ETIQUETA_CANAL[r.canal] || r.canal)}. El tipo y el canal no se cambian: para otro, se usa otra regla.</p>
        <div class="rec-cuadricula">
          <div class="rec-campo"><label for="rec-e-nombre">Nombre de la regla</label><input type="text" id="rec-e-nombre" maxlength="120" value="${esc(r.nombre)}" ${cambiar ? '' : 'disabled'}></div>
          ${r.tipo === 'solicitud_sin_movimiento' ? `<div class="rec-campo"><label>Cuándo sale</label>
            <span class="rec-pie">Al responsable de una solicitud abierta que lleva varios días sin cambios. Los días se fijan en Solicitudes ciudadanas, al final de la pantalla.</span></div>`
            : esEvento ? `<div class="rec-campo"><label for="rec-e-horas">Horas antes del evento</label>
            <input type="number" id="rec-e-horas" min="0.5" max="168" step="0.5" value="${esc(horas)}" ${cambiar ? '' : 'disabled'}>
            <span class="rec-pie">De media hora a 7 días. Por ejemplo, 24 o 2.</span></div>`
            : `<div class="rec-campo"><label for="rec-e-hora">Hora del día de la elección</label>
            <input type="time" id="rec-e-hora" value="${esc(String(r.hora_dia || '').slice(0, 5))}" ${cambiar ? '' : 'disabled'}>
            <span class="rec-pie">Solo sale ese día, a esta hora, y hasta el cierre de la jornada.</span></div>`}
          ${usaAsunto ? `<div class="rec-campo"><label for="rec-e-asunto">${r.canal === 'push' ? 'Título del aviso' : 'Asunto del correo'}</label>
            <input type="text" id="rec-e-asunto" maxlength="150" value="${esc(r.asunto || '')}" ${cambiar ? '' : 'disabled'}></div>` : ''}
        </div>
        <div class="rec-campo" style="margin-top:12px">
          <label for="rec-e-plantilla">Mensaje</label>
          <textarea id="rec-e-plantilla" ${cambiar ? '' : 'disabled'}>${esc(r.plantilla)}</textarea>
          ${cambiar ? `<div class="rec-vars">Variables: ${tipo.variables.map((v) => `<button type="button" class="btn-secundario btn-sm" data-variable="{${esc(v)}}">{${esc(v)}}</button>`).join('')}</div>` : ''}
          <div id="rec-validador" class="rec-validador">Comprobando…</div>
        </div>
        ${cambiar ? `<div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap">
          <button type="button" class="btn-primario btn-sm" id="rec-e-guardar">Guardar regla</button>
          <button type="button" class="btn-secundario btn-sm" id="rec-e-cancelar">Cancelar</button></div>`
          : '<div style="margin-top:12px"><button type="button" class="btn-secundario btn-sm" id="rec-e-cancelar">Cerrar</button></div>'}
        <div id="rec-msg-editor" class="rec-msg"></div>
      </div>`;
    $('rec-e-cancelar').addEventListener('click', () => { editando = null; $('rec-editor').innerHTML = ''; });
    const g = $('rec-e-guardar');
    if (g) g.addEventListener('click', guardarRegla);
    $('rec-editor').querySelectorAll('button[data-variable]').forEach((b) => b.addEventListener('click', () => insertarVariable(b.dataset.variable)));
    ['rec-e-plantilla', 'rec-e-asunto'].forEach((id) => { const el = $(id); if (el) el.addEventListener('input', validarEnVivo); });
    validarEnVivo();
  }

  function insertarVariable(texto) {
    const t = $('rec-e-plantilla');
    const ini = t.selectionStart, fin = t.selectionEnd;
    t.value = t.value.slice(0, ini) + texto + t.value.slice(fin);
    t.focus();
    t.selectionStart = t.selectionEnd = ini + texto.length;
    validarEnVivo();
  }

  /** El validador en vivo: lo que responde el SERVIDOR con el texto de ahora (largo, segmentos, variables, precampaña). */
  function validarEnVivo() {
    clearTimeout(temporizadorValidador);
    temporizadorValidador = setTimeout(async () => {
      const caja = $('rec-validador');
      if (!caja || !editando) return;
      try {
        const v = await api('/recordatorios/validar', { method: 'POST', body: {
          regla_id: editando.id, tipo: editando.tipo, canal: editando.canal,
          plantilla: $('rec-e-plantilla').value, asunto: $('rec-e-asunto') ? $('rec-e-asunto').value : null,
        } });
        const partes = [];
        if (editando.canal === 'sms' && v.segmentos !== null && v.segmentos !== undefined) {
          partes.push(`<b>${esc(v.caracteres)}</b> caracteres con datos típicos${v.bajaCaracteres ? `, contando el enlace de baja (${esc(v.bajaCaracteres)})` : ''} · <b>${esc(v.segmentos)}</b> SMS ${v.segmentos > 1 ? '(máximo 1)' : '(cabe en uno)'}`);
        } else if (editando.canal === 'push') {
          partes.push(`<b>${$('rec-e-plantilla').value.length}</b> de 140 caracteres`);
        }
        const errores = (v.errores || []).map((x) => `<li>${esc(x)}</li>`).join('');
        const avisos = (v.avisos || []).map((x) => `<li>${esc(x)}</li>`).join('');
        const recorte = (v.recortables || []).length
          ? `<div style="margin-top:6px">Si con datos largos no cabe en un SMS, se recorta ${v.recortables.map((x) => '{' + esc(x) + '}').join(' y luego ')} con «...». El enlace de baja nunca se recorta.</div>` : '';
        caja.className = 'rec-validador ' + (v.ok ? 'bien' : 'mal');
        caja.innerHTML = `${v.ok ? '✔ La plantilla es válida.' : '✖ Hay que corregir:'} ${partes.join(' ')}${recorte}
          ${errores ? `<ul>${errores}</ul>` : ''}${avisos ? `<div style="margin-top:6px">Aviso:<ul>${avisos}</ul></div>` : ''}`;
        const g = $('rec-e-guardar');
        if (g) g.disabled = !v.ok;
      } catch (err) {
        caja.className = 'rec-validador';
        caja.textContent = err.message || 'No se pudo comprobar la plantilla.';
      }
    }, 280);
  }

  async function guardarRegla() {
    const r = editando;
    const cuerpo = { nombre: $('rec-e-nombre').value, plantilla: $('rec-e-plantilla').value };
    if ($('rec-e-asunto')) cuerpo.asunto = $('rec-e-asunto').value;
    if ($('rec-e-horas')) cuerpo.desfase_min = -Math.round(Number($('rec-e-horas').value) * 60);
    if ($('rec-e-hora')) cuerpo.hora_dia = $('rec-e-hora').value;
    $('rec-e-guardar').disabled = true;
    mensaje('rec-msg-editor', 'Guardando…', '');
    try {
      await api(`/recordatorios/reglas/${r.id}`, { method: 'PUT', body: cuerpo });
      await recargarReglas();
      editando = null;
      pintarReglas();
      mensaje('rec-msg-reglas', `Se guardó «${cuerpo.nombre}».`, 'ok');
    } catch (err) {
      mensaje('rec-msg-editor', err.message || 'No se pudo guardar.', 'error');
      $('rec-e-guardar').disabled = false;
    }
  }

  /* -------------------------------------------------------------------------------------------------------- HISTORIAL */

  async function cargarHistorial() {
    const p = new URLSearchParams();
    if (filtros.estado) p.set('estado', filtros.estado);
    if (filtros.motivo) p.set('motivo', filtros.motivo);
    if (filtros.regla) p.set('regla', filtros.regla);
    p.set('pagina', filtros.pagina);
    p.set('limite', POR_PAGINA);
    historial = await api('/recordatorios/envios?' + p.toString());
    pintarHistorial();
  }

  function pintarHistorial() {
    const h = historial;
    const opcionesEstado = Object.keys(ETIQUETA_ESTADO).map((k) => `<option value="${k}" ${filtros.estado === k ? 'selected' : ''}>${esc(ETIQUETA_ESTADO[k])}${h.porEstado[k] ? ` (${h.porEstado[k]})` : ''}</option>`).join('');
    const opcionesMotivo = h.motivosDeOmision.map((m) => `<option value="${esc(m.motivo.slice(0, 40))}" ${filtros.motivo === m.motivo.slice(0, 40) ? 'selected' : ''}>${esc(m.motivo.slice(0, 70))} (${m.n})</option>`).join('');
    const opcionesRegla = reglas.map((r) => `<option value="${r.id}" ${String(filtros.regla) === String(r.id) ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('');
    const filas = h.filas.map((f) => `<tr>
      <td>${esc(fechaCorta(f.enviado_en || f.debe_salir_en))}</td>
      <td>${esc(f.regla)}</td>
      <td>${esc(f.destinatario || ('#' + f.destinatario_id))}<br><span class="rec-motivo">${f.destinatario_tipo === 'usuario' ? 'Equipo' : 'Votante'}</span></td>
      <td>${esc(ETIQUETA_CANAL[f.canal] || f.canal)}</td>
      <td><span class="rec-estado ${CLASE_ESTADO[f.estado] || 'no'}">${esc(ETIQUETA_ESTADO[f.estado] || f.estado)}</span>${f.intentos > 1 ? `<br><span class="rec-motivo">${esc(f.intentos)} intentos</span>` : ''}</td>
      <td class="rec-motivo">${esc(f.motivo || '')}${f.estado === 'diferido' && f.proximo_intento ? `<br>Reintento: ${esc(fechaCorta(f.proximo_intento))}` : ''}</td></tr>`).join('');
    const total = h.total, paginas = Math.max(1, Math.ceil(total / h.limite));
    $('rec-bloque-historial').innerHTML = `
      <h4>Historial de envíos</h4>
      <p class="rec-ayuda">Lo que el motor mandó, omitió o dejó para después. «Omitido» siempre trae su motivo.</p>
      <div class="rec-filtros">
        <div class="rec-campo"><label for="rec-f-estado">Estado</label><select id="rec-f-estado"><option value="">Todos</option>${opcionesEstado}</select></div>
        <div class="rec-campo"><label for="rec-f-motivo">Motivo de omisión</label><select id="rec-f-motivo"><option value="">Cualquiera</option>${opcionesMotivo}</select></div>
        <div class="rec-campo"><label for="rec-f-regla">Regla</label><select id="rec-f-regla"><option value="">Todas</option>${opcionesRegla}</select></div>
        <div><button type="button" class="btn-secundario btn-sm" id="rec-f-quitar">Quitar filtros</button></div>
      </div>
      <div style="overflow-x:auto"><table class="rec-tabla"><thead><tr><th>Cuándo</th><th>Regla</th><th>Destinatario</th><th>Canal</th><th>Estado</th><th>Motivo</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="6">No hay envíos con esos filtros.</td></tr>'}</tbody></table></div>
      <div style="display:flex; gap:10px; align-items:center; margin-top:10px">
        <button type="button" class="btn-secundario btn-sm" id="rec-h-ant" ${h.pagina <= 1 ? 'disabled' : ''}>← Anterior</button>
        <span class="rec-motivo">Página ${esc(h.pagina)} de ${esc(paginas)} · ${esc(total)} envío(s)</span>
        <button type="button" class="btn-secundario btn-sm" id="rec-h-sig" ${h.pagina >= paginas ? 'disabled' : ''}>Siguiente →</button>
      </div>`;
    const cambio = (id, clave) => $(id).addEventListener('change', () => { filtros[clave] = $(id).value; filtros.pagina = 1; cargarHistorial(); });
    cambio('rec-f-estado', 'estado'); cambio('rec-f-motivo', 'motivo'); cambio('rec-f-regla', 'regla');
    $('rec-f-quitar').addEventListener('click', () => { filtros = { estado: '', motivo: '', regla: '', pagina: 1 }; cargarHistorial(); });
    $('rec-h-ant').addEventListener('click', () => { filtros.pagina = Math.max(1, filtros.pagina - 1); cargarHistorial(); });
    $('rec-h-sig').addEventListener('click', () => { filtros.pagina += 1; cargarHistorial(); });
  }

  /* ------------------------------------------------------------------------------------------------------------ ENTRADA */

  /** La llama configuracion.html cada vez que se abre la pestaña: vuelve a leer todo del servidor. */
  async function cargarRecordatorios(usuarioActual) {
    usuario = usuarioActual;
    inyectarEstilos();
    const raiz = $('rec-contenido');
    if (!raiz) return;
    raiz.innerHTML = `
      <h3 style="margin-top:0">Recordatorios automáticos</h3>
      <p class="rec-ayuda">Mensajes que salen solos —el recordatorio de un evento y el «¿ya votaste?» del Día D— con las mismas reglas de siempre: solo a quien autorizó, nunca a quien pidió la baja, sin molestar de noche y sin gastar más SMS de los que se fijen aquí.</p>
      <div id="rec-bloque-config" class="rec-bloque">Cargando…</div>
      <div id="rec-bloque-reglas" class="rec-bloque"></div>
      <div id="rec-bloque-historial" class="rec-bloque"></div>`;
    editando = null;
    filtros = { estado: '', motivo: '', regla: '', pagina: 1 };
    try {
      estado = await api('/recordatorios/estado');
      await recargarReglas();
      pintarConfiguracion();
      pintarReglas();
      await cargarHistorial();
    } catch (err) {
      raiz.innerHTML = `<p class="mensaje-error visible" style="display:block">${esc(err.message || 'No se pudieron cargar los recordatorios.')}</p>`;
    }
  }

  window.cargarRecordatorios = cargarRecordatorios;
})();
