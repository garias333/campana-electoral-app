#!/usr/bin/env node
// scripts/probar-tareas-direccion-pantallas.js — orden 116: «TAREAS DE DIRECCIÓN» EN CHROMIUM REAL.
//
// Escritorio (1280 y 1440 px, superadministrador) y celular del candidato (390×844). Comprueba:
//   · el menú: «Tareas de dirección» justo debajo de «Panel general» para el superadministrador y el administrador «Es el candidato»; NO para un administrador
//     sin la casilla ni para un coordinador (y la página, abierta a mano, dice que no es suya);
//   · la ALINEACIÓN (requisito): todas las tarjetas miden lo mismo (±1 px), el título, el responsable, el aviso y el pie quedan a la misma altura en todas,
//     las tres columnas miden lo mismo y no hay desbordes con títulos, nombres y cargos larguísimos;
//   · arrastrar entre columnas, «✓ Realizada» con «Deshacer», reabrir con confirmación, el modal, crear, editar y eliminar;
//   · el celular: pestañas, botones, pantalla completa de la tarea, formulario con letra de 16 px, «Más» con su globo y el Inicio con su tarjeta;
//   · cero errores de consola. Deja las capturas en $SALIDA (por omisión ~/capturas-orden116).
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada116 node scripts/probar-tareas-direccion-pantallas.js
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) { console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`); process.exit(2); }
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';
process.env.SMS_PROVIDER = 'none';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const pool = require('../config/db');
const { lanzar, espera } = require('./capturas/navegador');
const { crear: crearServidor } = require('./capturas/servidor');
const R = require('../public/js/tareas-direccion-reglas');
const T = require('../lib/tareasDireccion');

const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden116');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];
const HOY = R.enColombia(new Date()).hoy;
const dia = (n) => R.sumarDias(HOY, n);
/** El mayor menos el menor de una lista de números. */
const dispersion = (xs) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);

(async () => {
  await q('DELETE FROM tareas_direccion');
  await q("DELETE FROM usuarios WHERE numero_identificacion BETWEEN '7160101' AND '7160199' AND es_superadmin = 0");
  const rolId = async (n) => (await q('SELECT id FROM roles WHERE nombre = ?', [n]))[0].id;
  let ced = 7160100;
  const usuario = async (nombre, rol, extra = {}) => {
    ced++;
    const [r] = await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, es_candidato) VALUES (?, ?, ?, ?, ?, 'x', ?, 1, ?)`,
      [nombre, String(ced), String(ced), `p${ced}@ejemplo.co`, extra.telefono || null, await rolId(rol), extra.es_candidato ? 1 : 0]);
    return r.insertId;
  };
  const sup = (await q('SELECT id FROM usuarios WHERE es_superadmin = 1 LIMIT 1'))[0];
  const ids = {
    super: sup.id, cand: await usuario('Juan Pérez Candidato', 'candidato', { telefono: '3009990000' }),
    admCand: await usuario('Admin Que Es Candidato', 'admin', { es_candidato: 1 }), admSin: await usuario('Admin Sin Casilla', 'admin'), coord: await usuario('Coordinadora Ejemplo', 'coordinador'),
    tesorera: await usuario('María Tesorera', 'asistente_administrativo', { telefono: '300 111 2233' }),
  };
  const cuerpo = (extra) => Object.assign({ responsable_nombre: 'Carlos Pérez', responsable_cargo: 'Tesorero', responsable_celular: '300 123 4521', prioridad: 'normal', aviso_activo: true }, extra);
  const mk = async (extra) => (await T.crear(cuerpo(extra), ids.cand)).tarea;
  // ---- datos de prueba (se borran al final) ----
  const larga = await mk({ titulo: 'Entregar la rendición de cuentas de la campaña al Consejo Nacional Electoral antes del cierre del período y archivar el soporte físico en la sede principal', responsable_nombre: 'María Fernanda de los Ángeles Rodríguez Hernández-Castellanos', responsable_cargo: 'Gerente administrativa y financiera de la campaña a nivel departamental', fecha_limite: dia(-2), prioridad: 'urgente' });
  await mk({ titulo: 'Pagar la sede', fecha_limite: dia(0) });
  await mk({ titulo: 'Contratar la pauta de radio', responsable_nombre: 'Ana Gómez', responsable_cargo: 'Jefe de comunicaciones', fecha_limite: dia(1) });
  await mk({ titulo: 'Aprobar el volante final', responsable_usuario_id: ids.cand, responsable_nombre: 'Juan Pérez Candidato', responsable_cargo: 'Candidato', responsable_celular: '', fecha_limite: dia(5) });
  await mk({ titulo: 'Revisar el contrato del sonido', responsable_celular: '', fecha_limite: dia(9), aviso_activo: false });
  const enCurso1 = await mk({ titulo: 'Grabar el spot de televisión', responsable_nombre: 'Luis Mora', responsable_cargo: 'Producción', fecha_limite: dia(3) });
  const enCurso2 = await mk({ titulo: 'Reunión con los gremios', responsable_nombre: 'Ana Gómez', responsable_cargo: 'Jefe de comunicaciones', fecha_limite: dia(-1) });
  await T.cambiarEstado(enCurso1.id, 'en_curso', ids.cand); await T.cambiarEstado(enCurso2.id, 'en_curso', ids.cand);
  const h1 = await mk({ titulo: 'Imprimir 5.000 volantes', fecha_limite: dia(4) }); await T.cambiarEstado(h1.id, 'hecha', ids.cand);
  const h2 = await mk({ titulo: 'Cerrar la agenda de noviembre', fecha_limite: dia(-3) }); await T.cambiarEstado(h2.id, 'hecha', ids.cand);

  const servidor = http.createServer(crearServidor(pool, { soloLecturaCandidato: true }));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const navegador = await lanzar();
  try {
    const p = await navegador.pagina('about:blank');
    // Los errores de consola y las excepciones, de cada página que se abra
    await p.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; const ce = console.error; console.error = function () { window.__errs.push([].slice.call(arguments).join(' ')); ce.apply(console, arguments); }; window.addEventListener('error', (e) => window.__errs.push('ERR ' + e.message)); window.addEventListener('unhandledrejection', (e) => window.__errs.push('PROM ' + (e.reason && e.reason.message || e.reason)));` });
    const entrarComo = async (id) => { await p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(id), url: base }); };
    const vista = async (w, h, movil) => p.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: movil ? 2 : 1, mobile: !!movil });
    const ir = async (ruta, ms = 1800) => { await p.cmd('Page.navigate', { url: base + ruta }); await espera(ms); };
    const ev = (x) => p.ev(x);
    const foto = async (nombre) => {
      const r = await p.cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r.result.data, 'base64'));
    };
    const clic = async (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
    const existe = async (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
    const texto = async (sel) => ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
    const errores = async () => ev('(window.__errs || []).slice()');
    const estadoDe = async (id) => (await q('SELECT estado, aviso_estado, realizada_en FROM tareas_direccion WHERE id = ?', [id]))[0];

    /* ===================== MENÚ ===================== */
    console.log('\n[1] El menú de escritorio');
    await vista(1280, 900, false);
    const menu = async () => { for (let i = 0; i < 40; i++) { if (await existe('a[data-nav-href="/dashboard.html"]')) break; await espera(250); } await espera(300); return menuAhora(); };
    const menuAhora = () => ev(`(() => { const a = [...document.querySelectorAll('a[data-nav-href]')]; const i = a.findIndex((x) => x.dataset.navHref === '/tareas-direccion.html'); return { esta: i >= 0, antes: i > 0 ? a[i - 1].textContent.trim() : null, texto: i >= 0 ? a[i].textContent.trim() : null }; })()`);
    for (const [nombre, id, debe] of [['superadministrador', ids.super, true], ['administrador «Es el candidato»', ids.admCand, true], ['administrador SIN la casilla', ids.admSin, false], ['coordinador', ids.coord, false]]) {
      await entrarComo(id); await ir('/dashboard.html', 2200);
      const m = await menu();
      if (debe) ok(m.esta && /PANEL GENERAL/i.test(m.antes) && /TAREAS DE DIRECCI/i.test(m.texto) && m.texto.includes('🔒'), `${nombre}: «Tareas de dirección» con su candado, justo debajo de «Panel general»`, m);
      else ok(!m.esta, `${nombre}: el ítem NO aparece en el menú`, m);
    }
    await entrarComo(ids.admSin); await ir('/tareas-direccion.html', 2200);
    ok(await ev(`getComputedStyle(document.getElementById('sin-acceso')).display !== 'none'`) && !(await existe('.td-card')), 'un administrador sin la casilla que abre la dirección a mano: «es solo del candidato y del superadministrador», sin tareas');
    ok(await ev(`fetch('/api/tareas-direccion').then((r) => r.status)`) === 403, 'y el servidor le responde 403');

    /* ===================== ESCRITORIO ===================== */
    for (const ancho of [1280, 1440]) {
      console.log(`\n[2] Escritorio ${ancho} px: tablero y alineación`);
      await vista(ancho, 900, false); await entrarComo(ids.super); await ir('/tareas-direccion.html', 2500);
      ok((await texto('.td-cab h1')) === 'Tareas de dirección' && /Solo candidato y superadministrador/.test(await texto('.td-cab .priv')) && /aviso automático por SMS 3 días antes/.test(await texto('.td-cab .priv')) && /Nueva tarea/.test(await texto('#btn-nueva')), 'encabezado: título, «Solo candidato y superadministrador · aviso automático por SMS 3 días antes» y «＋ Nueva tarea»');
      const cuentas = await ev(`[...document.querySelectorAll('.td-col')].map((c) => [c.dataset.col, c.querySelector('.n').textContent, c.querySelectorAll('.td-card').length])`);
      ok(JSON.stringify(cuentas) === JSON.stringify([['pendiente', '5', 5], ['en_curso', '2', 2], ['hecha', '2', 2]]), 'tres columnas con su contador: 5 pendientes, 2 en curso, 2 hechas', cuentas);
      const franjas = await ev(`[...document.querySelectorAll('.td-col')].map((c) => getComputedStyle(c).borderTopColor)`);
      ok(franjas[0] === 'rgb(255, 195, 0)' && franjas[1] === 'rgb(11, 94, 215)' && franjas[2] === 'rgb(31, 157, 85)', 'franjas: amarilla, azul y verde', franjas);
      const m = await ev(`(() => { const cards = [...document.querySelectorAll('.td-card')]; return cards.map((c) => { const r = c.getBoundingClientRect(); const rel = (s) => { const e = c.querySelector(s); return e ? Math.round((e.getBoundingClientRect().top - r.top) * 10) / 10 : null; };
        const dentro = [...c.querySelectorAll('*')].every((e) => { const x = e.getBoundingClientRect(); return x.right <= r.right + 0.5 && x.left >= r.left - 0.5 && x.bottom <= r.bottom + 0.5; });
        return { h: r.height, w: r.width, t: rel('.titulo'), r: rel('.resp'), a: rel('.aviso'), p: rel('.pie'), dentro }; }); })()`);
      ok(m.length === 9 && dispersion(m.map((x) => x.h)) <= 1, 'las 9 tarjetas miden lo mismo (±1 px)', m.map((x) => x.h));
      ok(['t', 'r', 'a', 'p'].every((k) => dispersion(m.map((x) => x[k])) <= 1), 'el título, el responsable, la línea del aviso y el pie quedan a la misma altura en TODAS las tarjetas (±1 px)', { t: m.map((x) => x.t), r: m.map((x) => x.r), a: m.map((x) => x.a), p: m.map((x) => x.p) });
      ok(m.every((x) => x.dentro), 'nada se sale de la tarjeta, ni con el título de 170 caracteres ni con el nombre y el cargo larguísimos');
      const cols = await ev(`[...document.querySelectorAll('.td-col')].map((c) => c.getBoundingClientRect().height)`);
      ok(dispersion(cols) <= 1, 'las tres columnas miden lo mismo (±1 px)', cols);
      ok(await ev('document.documentElement.scrollWidth <= window.innerWidth'), 'sin desplazamiento horizontal');
      const hojas = await ev(`(() => { const t = {}; document.querySelectorAll('.td-card').forEach((c) => { const h = c.querySelector('.td-hoja'); const r = h.getBoundingClientRect(); t[c.querySelector('.titulo').textContent.trim().slice(0, 14)] = [Math.round(r.width), Math.round(r.height), [...h.classList].filter((x) => x !== 'td-hoja')[0]]; }); return t; })()`);
      ok(Object.values(hojas).every((h) => h[0] === 48 && h[1] === 56), 'la hoja de calendario mide 48 × 56 px', hojas);
      const colores = (n) => hojas[Object.keys(hojas).find((k) => k.startsWith(n))][2];
      ok(colores('⚡ Entregar la') === 'rojo' && colores('Pagar la sede') === 'amarillo' && colores('Contratar la p') === 'amarillo' && colores('Aprobar el vol') === 'azul' && colores('Imprimir 5.000') === 'verde',
        'colores de la hoja: rojo vencida · amarillo hoy y mañana · azul a tiempo · verde hecha', Object.fromEntries(Object.entries(hojas).map(([k, v]) => [k, v[2]])));
      const lineas = await ev(`[...document.querySelectorAll('.td-card .aviso')].map((e) => e.textContent.trim())`);
      ok(lineas.some((l) => /^🔔 SMS programado \d+ \w+$/.test(l)) && lineas.some((l) => l === '🔔 Aviso en la app ' + R.formatoCorto(dia(2))) && lineas.some((l) => l === '🔕 Sin celular: no hay aviso' || l.includes('Aviso apagado')) && lineas.some((l) => /^✓ Hecha el \d+ \w+ · 4 días antes$/.test(l)) && lineas.some((l) => /^✓ Hecha el \d+ \w+ · 3 días tarde$/.test(l)),
        'las líneas del aviso: SMS programado, Aviso en la app, apagado y «Hecha el … · N días antes / tarde»', lineas);
      const orden = await ev(`[...document.querySelectorAll('.td-col[data-col="pendiente"] .titulo')].map((e) => e.textContent.trim().slice(0, 12))`);
      ok(orden[0].includes('Entregar') && orden[1] === 'Pagar la sed' && orden[2] === 'Contratar la', 'dentro de la columna, lo vencido arriba y luego por fecha límite', orden);
      const pies = await ev(`[...document.querySelectorAll('.td-card')].map((c) => ({ est: c.querySelector('.td-est').textContent.trim(), realizada: !!c.querySelector('.td-btn-realizada'), wa: !!c.querySelector('a.td-wa'), reservado: !!c.querySelector('.td-wa.oculto'), hecha: c.closest('.td-col').dataset.col === 'hecha', cand: !!c.querySelector('.td-avatar.cand') }))`);
      ok(pies.filter((x) => x.hecha).every((x) => !x.realizada && x.est === 'Hecha') && pies.filter((x) => !x.hecha).every((x) => x.realizada), '«✓ Realizada» en todas menos en Hechas, que dicen «Hecha»');
      ok(pies.filter((x) => x.cand || x.hecha).every((x) => !x.wa && x.reservado), 'WhatsApp no sale en las del candidato ni en las hechas, y su espacio queda reservado');
      ok(await ev(`!!document.querySelector('.td-col[data-col="pendiente"] a.td-wa[href^="https://wa.me/573001234521?text="]')`), 'el botón de WhatsApp de una tarea normal abre wa.me/57…');
      if (ancho === 1280) { await foto('1-escritorio-tablero-1280'); } else { await foto('1b-escritorio-tablero-1440'); }
      ok((await errores()).length === 0, 'cero errores de consola', await errores());
    }

    console.log('\n[3] Escritorio: arrastrar, realizada con Deshacer, reabrir, modal');
    await vista(1280, 900, false); await entrarComo(ids.super); await ir('/tareas-direccion.html', 2200);
    const soltar = (id, col) => ev(`(() => { const c = document.querySelector('.td-card[data-id="${id}"]'); const k = document.querySelector('.td-col[data-col="${col}"]'); const dt = new DataTransfer();
      c.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); k.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      k.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); c.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); return true; })()`);
    const pagar = (await q("SELECT id FROM tareas_direccion WHERE titulo = 'Contratar la pauta de radio'"))[0].id;
    await soltar(pagar, 'en_curso'); await espera(900);
    ok((await estadoDe(pagar)).estado === 'en_curso' && await ev(`!!document.querySelector('.td-col[data-col="en_curso"] .td-card[data-id="${pagar}"]')`), 'arrastrar a «En curso» la mueve (en pantalla y en la base)');
    await soltar(pagar, 'hecha'); await espera(900);
    let e = await estadoDe(pagar);
    ok(e.estado === 'hecha' && e.realizada_en && e.aviso_estado === 'cancelado', 'soltar en «Hechas» es «Realizada»: hecha, con su hora, y el aviso cancelado', e);
    ok(/Tarea marcada como realizada/.test(await texto('#td-snack')) && /Deshacer/.test(await texto('#td-snack button')), 'aparece «Tarea marcada como realizada · Deshacer»');
    await foto('2-escritorio-deshacer');
    await clic('#td-snack button'); await espera(900);
    e = await estadoDe(pagar);
    ok(e.estado === 'en_curso' && e.realizada_en === null && e.aviso_estado === 'programado', 'Deshacer la devuelve a «En curso» y re-programa el aviso', e);
    await clic(`.td-card[data-id="${pagar}"] .td-btn-realizada`); await espera(900);
    ok((await estadoDe(pagar)).estado === 'hecha', 'el botón «✓ Realizada» de la tarjeta también la marca');
    await ev('new Promise((r) => setTimeout(r, 6300))');
    ok(!(await existe('#td-snack')), 'el aviso de «Deshacer» dura 6 segundos y desaparece');
    await soltar(pagar, 'pendiente'); await espera(500);
    ok(await existe('.td-overlay.abierto [data-r="1"]') && /Reabrir la tarea/.test(await texto('#td-conf-t')), 'mover una hecha a otra columna pide confirmación');
    await clic('.td-overlay.abierto [data-r="0"]'); await espera(400);
    ok((await estadoDe(pagar)).estado === 'hecha', 'cancelar la confirmación la deja en Hechas');
    await soltar(pagar, 'pendiente'); await espera(500); await clic('.td-overlay.abierto [data-r="1"]'); await espera(900);
    e = await estadoDe(pagar);
    ok(e.estado === 'pendiente' && e.realizada_en === null, 'confirmar la reabre: vuelve a Pendientes y borra la hora de realizada', e);

    const imprimir = (await q("SELECT id FROM tareas_direccion WHERE titulo = 'Imprimir 5.000 volantes'"))[0].id;
    await clic(`.td-card[data-id="${imprimir}"]`); await espera(900);
    const modal = await ev(`(() => { const m = document.querySelector('#ov-detalle'); return { abierto: m.classList.contains('abierto'), t: m.textContent.replace(/\\s+/g, ' ') }; })()`);
    ok(modal.abierto && /Responsable/.test(modal.t) && /Fecha límite/.test(modal.t) && /Prioridad/.test(modal.t) && /Aviso automático/.test(modal.t) && /Historial/.test(modal.t) && /Reabrir/.test(modal.t), 'clic en la tarjeta: el modal con responsable, fecha límite, prioridad, aviso automático e historial', modal.t.slice(0, 300));
    await clic('[data-d="cerrar"]');
    const larg = larga.id;
    await clic(`.td-card[data-id="${larg}"]`); await espera(900);
    const m2 = await ev(`(() => { const m = document.querySelector('#ov-detalle'); const g = m.querySelector('.td-grande'); return { t: m.textContent.replace(/\\s+/g, ' '), grande: g ? g.textContent.trim() : null, fondo: g ? getComputedStyle(g).backgroundColor : null, urgente: m.querySelector('h2').textContent.includes('⚡'), wa: !!m.querySelector('a[data-wa]') }; })()`);
    ok(m2.grande === '✓ Marcar como realizada' && m2.fondo === 'rgb(31, 157, 85)' && /Si la marca hoy, el aviso automático se cancela\./.test(m2.t) && /venció hace 2 días/.test(m2.t) && m2.urgente && /Urgente/.test(m2.t) && m2.wa,
      'el modal de una vencida y urgente: botón verde «✓ Marcar como realizada», su nota, «venció hace 2 días», ⚡, y «Recordar por WhatsApp»', m2);
    await foto('3-escritorio-modal');
    await clic('[data-mover="en_curso"]'); await espera(900);
    ok((await estadoDe(larg)).estado === 'en_curso', 'el modal también mueve entre Pendiente y En curso (para quien no arrastra)');
    await clic('#ov-detalle [data-accion="realizada"]'); await espera(900);
    ok((await estadoDe(larg)).estado === 'hecha' && !(await ev(`document.querySelector('#ov-detalle').classList.contains('abierto')`)), '«✓ Marcar como realizada» del modal la marca y cierra la ventana');
    await clic('#td-snack button'); await espera(700);
    await clic(`.td-card[data-id="${larg}"]`); await espera(800);
    ok((await texto('#det-cuerpo')).includes('N/A') === false, 'sin textos raros en el detalle');
    // WhatsApp deja su huella
    await clic('#det-pie a[data-wa]'); await espera(500);
    ok((await q("SELECT COUNT(*) AS n FROM tareas_direccion_eventos WHERE tarea_id = ? AND tipo = 'whatsapp'", [larg]))[0].n >= 1, 'tocar «Recordar por WhatsApp» anota el evento en el historial');
    await ev(`window.open = () => null; true`);
    // Editar desde el modal
    await clic('#det-pie [data-d="editar"]'); await espera(900);
    ok(await ev(`document.querySelector('#ov-form').classList.contains('abierto') && document.querySelector('#tdf-titulo').value.startsWith('Entregar la rendición')`), '«✏️ Editar» abre el formulario con los datos de la tarea');
    await ev(`(() => { const t = document.querySelector('#tdf-titulo'); t.value = 'Entregar la rendición (corregida)'; t.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-prio="normal"]').click(); return true; })()`);
    await clic('#form-guardar'); await espera(1000);
    const ed = (await q('SELECT titulo, prioridad FROM tareas_direccion WHERE id = ?', [larg]))[0];
    ok(ed.titulo === 'Entregar la rendición (corregida)' && ed.prioridad === 'normal', 'guardar la edición cambia la tarea', ed);

    console.log('\n[4] Escritorio: formulario (nueva tarea) y eliminar');
    await clic('#btn-nueva'); await espera(900);
    const opciones = await ev(`[...document.querySelectorAll('#tdf-resp option, #tdf-resp optgroup')].map((o) => o.tagName === 'OPTGROUP' ? '[' + o.label + ']' : o.textContent.trim())`);
    ok(opciones[0].startsWith('Elija') && opciones.includes('[Candidato]') && opciones.some((o) => o === 'Candidato · Juan Pérez Candidato') && opciones.includes('[Equipo de la campaña]') && opciones.some((o) => o.startsWith('María Tesorera · ')) && opciones.includes('[Escritos antes]') && opciones.some((o) => o === 'Producción · Luis Mora') && opciones[opciones.length - 1].includes('Escribir otra persona'),
      'el selector: candidato arriba, personas con su rol, los escritos a mano antes y «Escribir otra persona…»', opciones);
    ok(!opciones.some((o) => /Super Admin/.test(o)), 'el superadministrador no aparece en el selector');
    await ev(`(() => { const s = document.querySelector('#tdf-resp'); s.value = [...s.options].find((o) => o.textContent.startsWith('María Tesorera')).value; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const lleno = await ev(`({ nombre: document.querySelector('#tdf-nombre').value, ro: document.querySelector('#tdf-nombre').readOnly, cargo: document.querySelector('#tdf-cargo').value, cel: document.querySelector('#tdf-cel').value })`);
    ok(lleno.nombre === 'María Tesorera' && lleno.ro && lleno.cargo === 'Asistente administrativo' && lleno.cel === '3001112233', 'elegir una persona rellena nombre (fijo), cargo sugerido (editable) y celular', lleno);
    ok(/Elija la fecha límite/.test(await texto('#tdf-frase')), 'sin fecha la frase pide elegirla');
    await ev(`(() => { const f = document.querySelector('#tdf-fecha'); f.value = '${dia(10)}'; f.dispatchEvent(new Event('input', { bubbles: true })); const t = document.querySelector('#tdf-titulo'); t.value = 'Tarea creada desde la prueba'; const c = document.querySelector('#tdf-cargo'); c.value = 'Tesorera'; return true; })()`);
    ok((await texto('#tdf-frase')).trim() === `SMS al 300 *** 2233 el ${R.formatoCorto(dia(7))}, si no está realizada.`, 'la frase se actualiza: «SMS al 300 *** 2233 el … si no está realizada.»', await texto('#tdf-frase'));
    await ev(`(() => { const c = document.querySelector('#tdf-cel'); c.value = '300 555 8899'; c.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    ok((await texto('#tdf-frase')).includes('300 *** 8899'), 'y cambia con el celular');
    await ev(`(() => { const a = document.querySelector('#tdf-aviso'); a.checked = false; a.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    ok(/apagado/.test(await texto('#tdf-frase')), 'con el interruptor apagado dice que el aviso está apagado');
    await ev(`(() => { const a = document.querySelector('#tdf-aviso'); a.checked = true; a.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await foto('4-escritorio-formulario');
    await clic('#form-guardar'); await espera(1100);
    const nueva = (await q("SELECT * FROM tareas_direccion WHERE titulo = 'Tarea creada desde la prueba'"))[0];
    ok(nueva && nueva.responsable_nombre === 'María Tesorera' && nueva.responsable_cargo === 'Tesorera' && nueva.responsable_celular === '3005558899' && nueva.aviso_estado === 'programado', 'guardar crea la tarea con el celular corregido y el aviso programado', nueva);
    await clic('#btn-nueva'); await espera(600); await clic('#form-guardar'); await espera(400);
    ok(/Escriba qué hay que hacer/.test(await texto('#tdf-error')), 'un formulario vacío dice qué falta, sin cerrarse');
    await clic('#form-cancelar'); await espera(300);
    await clic(`.td-card[data-id="${nueva.id}"]`); await espera(800); await clic('#det-pie [data-d="eliminar"]'); await espera(500);
    ok(/Eliminar esta tarea/.test(await texto('#td-conf-t')), 'eliminar pide confirmación');
    await clic('.td-overlay.abierto [data-r="1"]'); await espera(900);
    ok((await q('SELECT COUNT(*) AS n FROM tareas_direccion WHERE id = ?', [nueva.id]))[0].n === 0 && !(await existe(`.td-card[data-id="${nueva.id}"]`)), 'confirmar la elimina');
    ok((await errores()).length === 0, 'cero errores de consola en todo el recorrido', await errores());

    /* ===================== CELULAR ===================== */
    console.log('\n[5] Celular 390×844: la pantalla del candidato');
    await vista(390, 844, true); await entrarComo(ids.cand); await ir('/app/candidato-tareas.html', 2500);
    const tabs = await ev(`[...document.querySelectorAll('.tdm-tabs button')].map((b) => [b.dataset.tab, b.querySelector('b').textContent, b.getAttribute('aria-selected')])`);
    const cuenta = async (e2) => String((await q('SELECT COUNT(*) AS n FROM tareas_direccion WHERE estado = ?', [e2]))[0].n);
    ok(JSON.stringify(tabs.map((t) => t.slice(0, 2))) === JSON.stringify([['pendiente', await cuenta('pendiente')], ['en_curso', await cuenta('en_curso')], ['hecha', await cuenta('hecha')]]) && tabs[0][2] === 'true', 'tres pestañas con su número; la elegida es Pendientes', tabs);
    const fondoTab = await ev(`getComputedStyle(document.querySelector('.tdm-tabs button[aria-selected="true"]')).backgroundColor`);
    ok(fondoTab === 'rgb(8, 66, 152)', 'la pestaña elegida va en azul oscuro (#084298)', fondoTab);
    const medidas = async () => ev(`(() => { const cards = [...document.querySelectorAll('.tdm-card')]; return cards.map((c) => { const r = c.getBoundingClientRect(); const rel = (s) => { const e = c.querySelector(s); return e ? Math.round((e.getBoundingClientRect().top - r.top) * 10) / 10 : null; };
      const dentro = [...c.querySelectorAll('*')].every((e) => { const x = e.getBoundingClientRect(); return x.right <= r.right + 0.5 && x.left >= r.left - 0.5 && x.bottom <= r.bottom + 0.5; });
      return { h: r.height, t: rel('.titulo'), r: rel('.resp'), a: rel('.aviso'), e: rel('.estado'), b: rel('.botones'), dentro }; }); })()`);
    for (const pestana of ['pendiente', 'en_curso', 'hecha']) {
      await clic(`.tdm-tabs button[data-tab="${pestana}"]`); await espera(400);
      const m = await medidas();
      ok(m.length >= 2 && dispersion(m.map((x) => x.h)) <= 1 && ['t', 'r', 'a', 'e', 'b'].every((k) => dispersion(m.map((x) => x[k])) <= 1) && m.every((x) => x.dentro), `pestaña ${pestana}: las ${m.length} tarjetas miden lo mismo y título, responsable, aviso, estado y botones quedan alineados, sin desbordes`, m);
    }
    await clic('.tdm-tabs button[data-tab="pendiente"]'); await espera(300);
    const todas = await ev(`(() => { const out = []; for (const t of ['pendiente', 'en_curso', 'hecha']) { document.querySelector('.tdm-tabs button[data-tab="' + t + '"]').click(); out.push(...[...document.querySelectorAll('.tdm-card')].map((c) => c.getBoundingClientRect().height)); } document.querySelector('.tdm-tabs button[data-tab="pendiente"]').click(); return out; })()`);
    ok(dispersion(todas) <= 1, 'en las tres pestañas TODAS las tarjetas miden lo mismo (±1 px)', todas);
    ok(await ev('document.documentElement.scrollWidth <= window.innerWidth'), 'sin desplazamiento horizontal');
    const botonesPend = await ev(`[...document.querySelectorAll('.tdm-card')].map((c) => [...c.querySelectorAll('.botones > *')].map((b) => (b.classList.contains('oculto') ? '(oculto)' : b.textContent.trim().replace(/\\s+/g, ' '))))`);
    ok(botonesPend.every((b) => b.length === 3 && b[0] === '▶ En curso' && b[1] === '✓ Realizada') && botonesPend.some((b) => b[2] === 'Recordar') && botonesPend.some((b) => b[2] === '(oculto)'), 'fila de botones: «▶ En curso», «✓ Realizada» y «Recordar» (oculto para el candidato y sin celular, pero su sitio se reserva)', botonesPend);
    await foto('5-celular-tablero');
    const gk = (await q("SELECT id FROM tareas_direccion WHERE titulo = 'Aprobar el volante final'"))[0].id;
    await clic(`.tdm-card[data-id="${gk}"] [data-mover]`); await espera(900);
    ok((await estadoDe(gk)).estado === 'en_curso', '«▶ En curso» la pasa a En curso');
    await clic('.tdm-tabs button[data-tab="en_curso"]'); await espera(300);
    ok((await ev(`document.querySelector('.tdm-card[data-id="${gk}"] [data-mover]').textContent.trim()`)) === '⏸ Pendiente', 'y en esa pestaña el botón dice «⏸ Pendiente»');
    await clic(`.tdm-card[data-id="${gk}"] [data-mover]`); await espera(800);
    ok((await estadoDe(gk)).estado === 'pendiente', '«⏸ Pendiente» la devuelve');
    await clic('.tdm-tabs button[data-tab="pendiente"]'); await espera(300);
    await clic(`.tdm-card[data-id="${gk}"] [data-realizada]`); await espera(900);
    e = await estadoDe(gk);
    ok(e.estado === 'hecha' && /Tarea marcada como realizada/.test(await texto('#td-snack')) && /Deshacer/.test(await texto('#td-snack button')), '«✓ Realizada» la marca y avisa «Tarea marcada como realizada · Deshacer»', e);
    await clic('#td-snack button'); await espera(800);
    ok((await estadoDe(gk)).estado === 'pendiente', 'Deshacer la devuelve');
    // Tarea abierta
    await clic(`.tdm-card[data-id="${gk}"] .titulo`); await espera(900);
    const abierta = await ev(`(() => { const p = document.querySelector('#pant-tarea'); const g = p.querySelector('.td-grande'); return { abierta: p.classList.contains('abierta'), t: p.textContent.replace(/\\s+/g, ' '), grande: g && g.textContent.trim(), fs: getComputedStyle(p).position }; })()`);
    ok(abierta.abierta && abierta.fs === 'fixed' && abierta.grande === '✓ Marcar como realizada' && /Úselo si la tarea se hizo antes de tiempo\. El aviso automático se cancela\./.test(abierta.t) && /Recordar/.test(abierta.t) && /Editar/.test(abierta.t) && /Historial/.test(abierta.t), 'tocar la tarjeta abre la tarea a pantalla completa con su botón grande, su nota, «Recordar» y «Editar»', abierta.t.slice(0, 260));
    await foto('6-celular-tarea-abierta');
    await clic('#tarea-acciones [data-editar]'); await espera(900);
    const fs16 = await ev(`[...document.querySelectorAll('#pant-form input, #pant-form select')].filter((i) => i.offsetParent !== null && i.type !== 'checkbox').map((i) => parseFloat(getComputedStyle(i).fontSize))`);
    ok(fs16.length >= 6 && fs16.every((x) => x >= 16), 'el formulario: la letra de los campos es de 16 px o más (sin zoom del navegador)', fs16);
    ok(await ev(`document.querySelector('#pant-form').classList.contains('abierta') && document.querySelector('#form-eliminar').style.display === 'block'`), 'al editar, el formulario ocupa la pantalla y ofrece «Eliminar esta tarea»');
    await foto('7-celular-formulario');
    await clic('[data-cerrar="pant-form"]'); await espera(300);
    await clic('#btn-nueva'); await espera(900);
    await ev(`(() => { const s = document.querySelector('#tdf-resp'); s.value = 'otro'; s.dispatchEvent(new Event('change', { bubbles: true })); const set = (id, v) => { const e = document.querySelector(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; set('#tdf-titulo', 'Tarea del celular'); set('#tdf-nombre', 'Pedro Pablo'); set('#tdf-cargo', 'Jefe de logística'); set('#tdf-cel', '315 000 1122'); set('#tdf-fecha', '${dia(8)}'); document.querySelector('[data-prio="urgente"]').click(); return true; })()`);
    await clic('#form-guardar'); await espera(1100);
    const nc = (await q("SELECT * FROM tareas_direccion WHERE titulo = 'Tarea del celular'"))[0];
    ok(nc && nc.prioridad === 'urgente' && nc.responsable_cargo === 'Jefe de logística' && nc.aviso_estado === 'programado', 'crear desde el celular guarda la tarea (responsable escrito a mano, urgente, aviso programado)', nc);
    await clic(`.tdm-card[data-id="${nc.id}"] .titulo`); await espera(800); await clic('#tarea-acciones [data-editar]'); await espera(800); await clic('#form-eliminar'); await espera(500);
    await clic('.td-overlay.abierto [data-r="1"]'); await espera(900);
    ok((await q('SELECT COUNT(*) AS n FROM tareas_direccion WHERE id = ?', [nc.id]))[0].n === 0, 'eliminar desde el formulario del celular (con confirmación)');
    // Hechas: reabrir
    await clic('.tdm-tabs button[data-tab="hecha"]'); await espera(300);
    const rb = await ev(`document.querySelector('.tdm-card [data-reabrir]') ? document.querySelector('.tdm-card [data-reabrir]').dataset.reabrir : null`);
    await clic('.tdm-card [data-reabrir]'); await espera(500);
    ok(/Reabrir la tarea/.test(await texto('#td-conf-t')), 'en Hechas, «↩ Reabrir» pide confirmación');
    await clic('.td-overlay.abierto [data-r="1"]'); await espera(900);
    ok((await estadoDe(+rb)).estado === 'pendiente', 'y la reabre');
    ok((await errores()).length === 0, 'cero errores de consola en el celular', await errores());

    console.log('\n[6] Celular: «Más» e Inicio');
    await ir('/app/candidato-mas.html', 2500);
    const mas = await ev(`(() => { const t = [...document.querySelectorAll('.menu-boton')].find((a) => /Tareas de dirección/.test(a.textContent)); if (!t) return null; const g = t.querySelector('.globo'); return { href: t.getAttribute('href'), globo: g ? g.textContent : null, fondo: g ? getComputedStyle(g).backgroundColor : null, primero: t.closest('.menu-grupo').querySelector('.menu-boton') === t, grupo: t.closest('.menu-grupo').querySelector('.menu-grupo-titulo').textContent }; })()`);
    const vencidas = (await q("SELECT COUNT(*) AS n FROM tareas_direccion WHERE estado <> 'hecha' AND fecha_limite < ?", [HOY]))[0].n;
    ok(mas && mas.href === '/app/candidato-tareas.html' && mas.primero && mas.globo === String(vencidas) && mas.fondo === 'rgb(214, 58, 58)', `«Más»: la tarjeta «Tareas de dirección» abre la sección, va primera de su grupo y lleva el globo rojo con las ${vencidas} vencidas`, mas);
    await foto('8-celular-mas-tarjeta');
    await ir('/app/candidato.html', 3000);
    const ini = await ev(`(() => { const a = document.getElementById('tareas-dir'); return { visible: getComputedStyle(a).display !== 'none', t: a.textContent.replace(/\\s+/g, ' ').trim(), href: a.getAttribute('href') }; })()`);
    ok(ini.visible && ini.href === '/app/candidato-tareas.html' && /Tareas: \d+ vencidas? · \d+ vencen? en 3 días/.test(ini.t), 'Inicio: «Tareas: N vencidas · N vencen en 3 días» abre la sección', ini);
    await foto('9-celular-inicio-tarjeta');
    // Sin tareas por vencer, la tarjeta no aparece
    await q("UPDATE tareas_direccion SET estado = 'hecha', realizada_en = NOW() WHERE estado <> 'hecha'");
    await ir('/app/candidato.html', 3000);
    ok(!(await ev(`getComputedStyle(document.getElementById('tareas-dir')).display !== 'none'`)), 'sin vencidas ni próximas, la tarjeta de Inicio no aparece');
    await ir('/app/candidato-mas.html', 2500);
    ok(await ev(`!document.querySelector('.menu-boton .globo')`), 'y «Más» no lleva globo');
    await ir('/app/candidato-tareas.html', 2200); await clic('.tdm-tabs button[data-tab="pendiente"]'); await espera(300);
    ok(/No hay tareas pendientes/.test(await texto('#lista')) && (await errores()).length === 0, 'la pantalla vacía lo dice con claridad, sin errores', await errores());
    // El administrador «Es el candidato» en modo candidato también entra; el administrador sin la casilla, no
    await entrarComo(ids.admCand); await ir('/app/candidato-tareas.html', 2500);
    ok(/candidato-tareas/.test(await ev('location.pathname')) && await existe('.tdm-tabs'), 'el administrador «Es el candidato» abre la pantalla del celular');
    await entrarComo(ids.admSin); await ir('/app/candidato-tareas.html', 2500);
    ok(!/candidato-tareas/.test(await ev('location.pathname')), 'un administrador sin la casilla no se queda en ella (lo lleva a su app)', await ev('location.pathname'));
    console.log('\n[7] Sin señal: se dice claro y no se guarda nada');
    await q("UPDATE tareas_direccion SET estado = 'pendiente', realizada_en = NULL WHERE estado = 'hecha'");
    await entrarComo(ids.cand); await ir('/app/candidato-tareas.html', 2500);
    const pendId = (await q("SELECT id FROM tareas_direccion WHERE estado = 'pendiente' ORDER BY id LIMIT 1"))[0].id;
    await p.cmd('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await clic(`.tdm-card[data-id="${pendId}"] [data-realizada]`); await espera(1200);
    ok(/Sin señal: no se guardó nada/.test(await texto('#td-snack')), 'sin conexión, «✓ Realizada» responde «Sin señal: no se guardó nada»', await texto('#td-snack'));
    ok((await estadoDe(pendId)).estado === 'pendiente', 'y la tarea no cambió (nada se encola para después)');
    await clic('#btn-refrescar'); await espera(1200);
    ok(/Sin señal/.test(await texto('#snack, #td-snack')) || /Sin señal/.test(await texto('#error-carga')), 'sin conexión, actualizar lo dice con claridad');
    await p.cmd('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  } finally {
    navegador.cerrar();
    servidor.close();
    await q('DELETE FROM tareas_direccion'); await q("DELETE FROM comunicaciones_campanas WHERE nombre LIKE 'Tarea de dirección%'");
    await q("DELETE FROM usuarios WHERE numero_identificacion BETWEEN '7160101' AND '7160199' AND es_superadmin = 0");
    await pool.end();
  }
  console.log(`\n${fallos ? 'FALLÓ' : 'TODO BIEN'}: ${pasos - fallos} de ${pasos} comprobaciones. Capturas en ${SALIDA}`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR en la prueba:', e); process.exit(1); });
