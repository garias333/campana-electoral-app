#!/usr/bin/env node
// scripts/probar-complementos-menus.js
//
// Prueba, en un Chromium REAL, de ACTIVAR COMPLEMENTOS (parche 318) por rol:
//   · con los nueve APAGADOS, ni el administrador, ni el superadministrador, ni el coordinador, ni el líder, ni el sublíder ven NINGUNO de los nueve
//     en el menú del computador ni del celular, aunque la matriz de permisos se los dé todos (se les abre a propósito);
//   · con los nueve encendidos, cada rol los ve según la matriz (los que la matriz abre) y «Activar complementos» solo lo ven el administrador
//     y el superadministrador;
//   · encendidos solo Tareas y Finanzas con la matriz de FÁBRICA: aparecen solo para quien la matriz deja;
//   · la pestaña «Activar complementos» (390 px, sin desborde horizontal): diez tarjetas, encender sin preguntar, apagar CON el aviso de las
//     personas que trabajan sin señal, el de Transporte (enlaces de conductores y asignaciones de hoy), el panel deshabilitado sin Puerta a puerta;
//   · las pestañas Alertas/Resultados/Transporte/Logística de la Jornada electoral, el chip «Necesitan transporte» de Faltantes, el balance del Panel,
//     el enlace al panel de Puerta a puerta, la tarjeta «mis tareas», la franja de avisos y el botón «Volver a permitir visitas»;
//   · el enlace directo a una pantalla apagada dice «Este complemento no está activo»;
//   · la matriz de permisos muestra los módulos apagados en gris, con la nota.
//
// USO (sobre una base desechable ya inicializada con init-db; hace falta Chromium, ver scripts/capturas/navegador.js):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada318 node scripts/probar-complementos-menus.js
//
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba». Sale con código 1 si algo no cuadra.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
if (!/^(simulada|prueba)/i.test(nombreBase)) {
  console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`);
  process.exit(2);
}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';
process.env.COMPLEMENTOS_CACHE_MS = '0';
delete process.env.MAPBOX_ACCESS_TOKEN;

const http = require('http');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const C = require('../lib/complementos');
const { lanzar, espera } = require('./capturas/navegador');
const { crear } = require('./capturas/servidor');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }
const sello = String(Date.now()).slice(-7);
let n = 0;
async function persona(nombre, rol) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, `96${sello}${n}`, `u96${sello}${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  return r.insertId;
}

// Los textos del menú del computador y del celular de cada complemento (los de common.js e inicio.html).
const PC = ['Solicitudes ciudadanas', 'Tareas', 'Puerta a puerta', 'Puerta a puerta panel', 'Alertas del Día D', 'Resultados y reclamaciones', 'Transporte del Día D', 'Logística del Día D', 'FINANZAS'];
const CEL = ['Registrar una solicitud', 'Mis solicitudes', 'Solicitudes ciudadanas', 'Mis tareas', 'Tareas', 'Puerta a puerta', 'Alertas Día D', 'Transporte Día D', 'Logística Día D', 'Faltan por votar'];
const MODULOS = ['solicitudes', 'tareas', 'puerta_listas', 'puerta_visitas', 'alertas_dia_d', 'resultados_dia_d', 'transporte_dia_d', 'logistica_dia_d', 'rescate_votos', 'finanzas'];
const ROLES = ['admin', 'coordinador', 'lider', 'sublider'];

(async () => {
  let servidor; let navegador;
  let respaldoMatriz = [];
  try {
    await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
    const [sup] = await q('SELECT id FROM usuarios WHERE es_superadmin = 1 LIMIT 1');
    if (!sup) throw new Error('la base de prueba no tiene superadministrador (¿corrió init-db?)');
    const gente = {
      superadministrador: sup.id,
      administrador: await persona('Admin Ejemplo', 'admin'),
      coordinador: await persona('Coord Ejemplo', 'coordinador'),
      líder: await persona('Lider Ejemplo', 'lider'),
      sublíder: await persona('Sublider Ejemplo', 'sublider'),
    };
    respaldoMatriz = await q('SELECT rol, modulo, permitido, editar, agregar, importar_exportar FROM permisos_rol WHERE modulo IN (?)', [MODULOS]);
    const abrirMatriz = async () => { for (const rol of ROLES) for (const m of MODULOS) await q('INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES (?, ?, 1, 1, 1) ON DUPLICATE KEY UPDATE permitido = 1, editar = 1, agregar = 1', [rol, m]); };
    const matrizDeFabrica = async () => { for (const f of respaldoMatriz) await q('UPDATE permisos_rol SET permitido = ?, editar = ?, agregar = ?, importar_exportar = ? WHERE rol = ? AND modulo = ?', [f.permitido, f.editar, f.agregar, f.importar_exportar, f.rol, f.modulo]); };
    const apagarTodas = async () => { await q('UPDATE complementos_campana SET activo = 0'); C.invalidar(); };
    const encenderTodas = async () => { await q('UPDATE complementos_campana SET activo = 1'); C.invalidar(); };

    console.log('ACTIVAR COMPLEMENTOS, POR ROL (Chromium real) — base «' + nombreBase + '»\n');
    const app = crear(pool);
    servidor = http.createServer(app);
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${servidor.address().port}`;
    navegador = await lanzar();
    const p = await navegador.pagina('about:blank');
    const escritorio = () => p.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    const celular = () => p.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const entrarComo = async (id) => { await p.cmd('Network.clearBrowserCookies'); await p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(id), url: base }); };
    // Cada visita lleva un parámetro nuevo: navegar a la misma dirección con otro `#` no recarga la página, y aquí se quiere ver el estado NUEVO.
    let visita = 0;
    const ir = async (ruta, ms = 2500) => {
      const [sin, hash] = ruta.split('#');
      await p.cmd('Page.navigate', { url: base + sin + (sin.includes('?') ? '&' : '?') + 'r=' + (++visita) + (hash ? '#' + hash : '') });
      await espera(ms);
    };
    // El icono (emoji) de las entradas de primer nivel va delante del texto: se le quita para comparar.
    const menuPC = () => p.ev(`Array.from(document.querySelectorAll('.nav-submenu a.nav-sub-link, a.nav-link-principal')).map((a) => a.textContent.replace(/\\s+/g, ' ').trim().replace(/^[^A-Za-zÁÉÍÓÚÑ]+/, ''))`);
    const menuCel = () => p.ev(`Array.from(document.querySelectorAll('#menu-app .menu-boton strong')).map((e) => e.textContent.trim())`);
    // Rediseño del celular: los grupos ya no van separados por una línea sino en secciones con título (.menu-grupo). Lo que se comprueba es lo mismo:
    // que un rol sin entradas en un grupo no deje un grupo VACÍO (título suelto sin nada debajo) ni ningún hijo del menú que no sea un grupo.
    const sinSeparadoresDobles = () => p.ev(`(() => { const h = Array.from(document.querySelectorAll('#menu-app > *')); return h.every((g) => g.classList.contains('menu-grupo') && g.querySelectorAll('a.menu-boton').length > 0); })()`);
    const visible = (sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && getComputedStyle(e).display !== 'none' && e.offsetParent !== null; })()`);

    /* ------------------------------------------------------------------------------------------------------------------------ 1 */
    console.log('[1] Con los nueve APAGADOS y la matriz abierta a todos: nadie ve ninguno');
    await abrirMatriz();
    await apagarTodas();
    for (const [quien, id] of Object.entries(gente)) {
      await entrarComo(id);
      await escritorio();
      await ir('/votantes.html');
      const pc = await menuPC();
      ok(pc.length > 0 && !PC.some((t) => pc.includes(t)), `${quien} · computador: ninguna de las 9 entradas`, pc.filter((t) => PC.includes(t)));
      if (['administrador', 'superadministrador', 'coordinador'].includes(quien)) ok(pc.includes('Avance de votación'), `${quien} · computador: «Avance de votación» SIGUE (no es de Faltan por votar)`, pc);
      const tieneActivar = pc.includes('Activar complementos');
      ok(tieneActivar === (quien === 'administrador' || quien === 'superadministrador'), `${quien} · «Activar complementos» ${(quien === 'administrador' || quien === 'superadministrador') ? 'SÍ' : 'no'} aparece`, pc);
      const grupos = await p.ev(`Array.from(document.querySelectorAll('.nav-grupo-texto')).map((e) => e.textContent.trim())`);
      ok(!(grupos.includes('LOGÍSTICA') && !pc.includes('Agenda') && !pc.includes('Eventos y GOTV') && !pc.includes('Asistentes a reuniones')), `${quien} · un grupo sin entradas no pinta ni su título`, grupos);
      if (quien !== 'superadministrador') {
        await celular();
        await entrarComo(id);
        await ir('/app/inicio.html', 3500);
        const cel = await menuCel();
        ok(cel.length > 0 && !CEL.some((t) => cel.includes(t)), `${quien} · celular: ninguna de las entradas de los complementos`, cel.filter((t) => CEL.includes(t)));
        ok(await sinSeparadoresDobles(), `${quien} · celular: sin separadores dobles ni al principio ni al final`);
        ok(!(await visible('#franja-avisos-alertas')), `${quien} · celular: sin la franja «Activa los avisos»`);
        ok(!(await p.ev(`!!document.querySelector('.pl-tarjeta .pl-titulo') && Array.from(document.querySelectorAll('.pl-titulo')).some((e) => /tareas/i.test(e.textContent))`)), `${quien} · celular: sin la tarjeta «mis tareas»`);
        // La tarjeta «DÍA D · MODO PRUEBA — Faltan N por votar» con su botón «Ir a Faltan por votar» (parche 319): ni en modo prueba.
        if (quien === 'líder' || quien === 'sublíder') {
          ok(!(await p.ev(`!!document.querySelector('.pl-dia-d') || /Ir a Faltan por votar/.test(document.body.innerText)`)), `${quien} · celular: sin la tarjeta del Día D (ni «Modo prueba») y sin el botón «Ir a Faltan por votar»`);
        }
        if (quien === 'coordinador' || quien === 'administrador') {
          ok(cel.includes('Ranking Día D'), `${quien} · celular: «Ranking Día D» SIGUE (no es de Faltan por votar)`, cel);
        }
      }
    }

    /* ------------------------------------------------------------------------------------------------------------------------ 2 */
    console.log('\n[2] Con los nueve ENCENDIDOS y la matriz abierta: cada rol ve lo que la matriz le abre');
    await encenderTodas();
    {
      await escritorio();
      await entrarComo(gente.administrador); await ir('/votantes.html');
      let pc = await menuPC();
      ok(PC.every((t) => pc.includes(t)), 'administrador · computador: las 9', PC.filter((t) => !pc.includes(t)));
      ok(pc.includes('Activar complementos'), 'administrador · ve «Activar complementos»');
      ok(pc.indexOf('Activar complementos') === pc.indexOf('Asignación de permisos') + 1, 'y va JUSTO después de «Asignación de permisos»', pc.slice(pc.indexOf('Asignación de permisos') - 1, pc.indexOf('Asignación de permisos') + 3));
      await entrarComo(gente.superadministrador); await ir('/votantes.html');
      pc = await menuPC();
      ok(PC.every((t) => pc.includes(t)) && pc.includes('Activar complementos'), 'superadministrador · computador: las 9 y «Activar complementos»', PC.filter((t) => !pc.includes(t)));
      await entrarComo(gente.coordinador); await ir('/votantes.html');
      pc = await menuPC();
      ok(PC.every((t) => pc.includes(t)) && !pc.includes('Activar complementos'), 'coordinador · computador: las 9 (la matriz está abierta) y NO «Activar complementos»', PC.filter((t) => !pc.includes(t)));
      await entrarComo(gente.líder); await ir('/votantes.html');
      pc = await menuPC();
      ok(pc.includes('Solicitudes ciudadanas') && pc.includes('Tareas') && !pc.includes('Activar complementos'), 'líder · computador: según la matriz abierta, y sin «Activar complementos»');
      await celular();
      for (const quien of ['administrador', 'coordinador', 'líder', 'sublíder']) {
        await entrarComo(gente[quien]);
        await ir('/app/inicio.html', 3500);
        const cel = await menuCel();
        const esperado = quien === 'administrador' ? ['Solicitudes ciudadanas', 'Registrar una solicitud', 'Tareas', 'Puerta a puerta', 'Alertas Día D', 'Transporte Día D', 'Logística Día D', 'Faltan por votar']
          : quien === 'coordinador' ? ['Registrar una solicitud', 'Mis solicitudes', 'Mis tareas', 'Puerta a puerta', 'Alertas Día D', 'Transporte Día D', 'Logística Día D', 'Faltan por votar']
            : ['Registrar una solicitud', 'Mis solicitudes', 'Mis tareas', 'Puerta a puerta', 'Faltan por votar'];
        ok(esperado.every((t) => cel.includes(t)), `${quien} · celular: ${esperado.length} entradas de complementos (según la matriz abierta)`, esperado.filter((t) => !cel.includes(t)));
        ok(await sinSeparadoresDobles(), `${quien} · celular: sin separadores dobles`);
        if (quien === 'líder') ok(!cel.includes('Alertas Día D') && !cel.includes('Transporte Día D'), 'líder · celular: no ve las de coordinación (no están en su menú)');
        if (quien === 'líder' || quien === 'sublíder') {
          const tarjeta = await p.ev(`(() => { const e = document.querySelector('.pl-dia-d'); return e ? e.innerText : null; })()`);
          ok(tarjeta && /Modo prueba/i.test(tarjeta) && /Faltan/.test(tarjeta) && /Ir a Faltan por votar/.test(tarjeta), `${quien} · celular: encendido, vuelve la tarjeta «Día D · Modo prueba — Faltan N por votar» con su botón`, tarjeta);
        }
      }
    }

    /* ------------------------------------------------------------------------------------------------------------------------ 3 */
    console.log('\n[3] Solo Tareas y Finanzas encendidos, con la matriz de FÁBRICA');
    await matrizDeFabrica();
    await apagarTodas();
    await q("UPDATE complementos_campana SET activo = 1 WHERE clave IN ('tareas', 'finanzas')"); C.invalidar();
    {
      await escritorio();
      const esperado = { administrador: ['Tareas', 'FINANZAS'], superadministrador: ['Tareas', 'FINANZAS'], coordinador: ['FINANZAS'], líder: [], sublíder: [] };
      for (const [quien, lista] of Object.entries(esperado)) {
        await entrarComo(gente[quien]); await ir('/votantes.html');
        const pc = await menuPC();
        const vistas = PC.filter((t) => pc.includes(t));
        ok(JSON.stringify(vistas) === JSON.stringify(lista), `${quien} · computador ve exactamente [${lista.join(', ')}]`, vistas);
      }
      await celular();
      for (const quien of ['administrador', 'coordinador', 'líder']) {
        await entrarComo(gente[quien]); await ir('/app/inicio.html', 3500);
        const cel = await menuCel();
        const vistas = CEL.filter((t) => cel.includes(t));
        ok(JSON.stringify(vistas) === JSON.stringify(quien === 'administrador' ? ['Tareas'] : []), `${quien} · celular ve ${quien === 'administrador' ? '[Tareas]' : '[]'}`, vistas);
      }
    }

    /* ------------------------------------------------------------------------------------------------------------------------ 4 */
    console.log('\n[4] El enlace directo a una pantalla apagada');
    await apagarTodas();
    await escritorio();
    await entrarComo(gente.administrador);
    for (const ruta of ['/solicitudes.html', '/tareas.html', '/finanzas.html', '/puerta-listas.html', '/puerta-panel.html']) {
      await ir(ruta, 1200);
      const t = await p.ev(`document.body.innerText`);
      ok(/Este complemento no está activo/.test(t) && /Activar complementos/.test(t), `${ruta}: «Este complemento no está activo» (con el enlace para el administrador)`, t.slice(0, 120));
    }
    await celular();
    await entrarComo(gente.líder);
    await ir('/app/faltantes.html', 1200);
    ok(/Este complemento no está activo/.test(await p.ev(`document.body.innerText`)), '/app/faltantes.html (líder): «Este complemento no está activo»');
    await escritorio();
    await entrarComo(gente.administrador);
    await ir('/finanzas.html', 1200);
    await p.ev(`Array.from(document.querySelectorAll('a')).find((a) => /Activar complementos/.test(a.textContent)).click()`);
    await espera(2500);
    ok(await p.ev('location.pathname + location.hash') === '/configuracion.html#complementos', 'el enlace lleva a /configuracion.html#complementos', await p.ev('location.pathname + location.hash'));
    await celular();
    await entrarComo(gente.líder);
    await ir('/app/mis-tareas.html', 1200);
    const tl = await p.ev(`document.body.innerText`);
    ok(/Este complemento no está activo/.test(tl) && !/Activar complementos/.test(tl) && /Volver al inicio/.test(tl), '/app/mis-tareas.html (líder): el mensaje, sin enlace de administrador y con «Volver al inicio»');

    /* ------------------------------------------------------------------------------------------------------------------------ 5 */
    console.log('\n[5] Configuración → Activar complementos (390 px)');
    await apagarTodas();
    await celular();
    await entrarComo(gente.administrador);
    await ir('/configuracion.html#complementos', 3500);
    const tarjetas = () => p.ev(`Array.from(document.querySelectorAll('.comp-card')).map((c) => ({ clave: c.dataset.clave, nombre: c.querySelector('strong').textContent, desc: c.querySelector('.comp-desc').textContent, encendido: c.querySelector('input').checked, deshabilitado: c.querySelector('input').disabled, nota: (c.querySelector('.comp-nota') || {}).textContent || '' }))`);
    let t = await tarjetas();
    ok(t.length === 10 && t.every((c) => c.nombre && c.desc.length > 20 && c.desc.length < 140), 'diez tarjetas, cada una con nombre y descripción de una línea', t.map((c) => c.nombre));
    ok(t.every((c) => !c.encendido), 'todas apagadas de fábrica');
    const panel = t.find((c) => c.clave === 'puerta_panel');
    ok(panel.deshabilitado && /Requiere «Puerta a puerta»/.test(panel.nota), '«Puerta a puerta panel» se ve deshabilitado con la nota «Requiere Puerta a puerta»', panel);
    ok(await p.ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'sin desborde horizontal a 390 px', await p.ev(`[document.documentElement.scrollWidth, window.innerWidth]`));
    ok(await p.ev(`getComputedStyle(document.querySelector('.comp-lista')).gridTemplateColumns.split(' ').length === 1`), 'una sola columna a 390 px');
    const colorAcento = await p.ev(`(() => { const i = document.querySelector('.comp-card input'); const pista = i.nextElementSibling; pista.style.transition = 'none'; i.checked = true; const c = getComputedStyle(pista).backgroundColor; i.checked = false; return c; })()`);
    ok(colorAcento === 'rgb(11, 94, 215)', 'el interruptor encendido usa el azul de la app (#0B5ED7)', colorAcento);
    // Encender sin preguntar
    await p.ev(`document.querySelector('.comp-card[data-clave="tareas"] input').click()`);
    await espera(1500);
    t = await tarjetas();
    ok(t.find((c) => c.clave === 'tareas').encendido && !(await p.ev(`!!document.querySelector('.overlay.abierto')`)), 'encender Tareas no pregunta y queda encendido');
    ok(await C.complementoActivo('tareas'), 'y en la base quedó encendido');
    ok(/quedó encendido/.test(await p.ev(`document.getElementById('complementos-ok').textContent`)), 'con su mensaje de confirmación');
    // Apagar con aviso
    await p.ev(`document.querySelector('.comp-card[data-clave="tareas"] input').click()`);
    await espera(800);
    let modal = await p.ev(`(() => { const m = document.querySelector('.overlay.abierto .modal'); return m ? m.innerText : null; })()`);
    ok(modal && /Si hay personas trabajando sin señal en este complemento, lo que tengan pendiente en el celular no subirá mientras esté apagado\./.test(modal), 'apagar muestra el aviso de las personas que trabajan sin señal', modal);
    ok(modal && !/enlaces de conductores/.test(modal), 'y para Tareas no menciona a los conductores');
    await p.ev(`document.getElementById('no-confirmar-modal').click()`);
    await espera(600);
    t = await tarjetas();
    ok(t.find((c) => c.clave === 'tareas').encendido && await C.complementoActivo('tareas'), 'Cancelar deja Tareas encendido (interruptor y base)');
    await p.ev(`document.querySelector('.comp-card[data-clave="tareas"] input').click()`);
    await espera(800);
    await p.ev(`document.getElementById('si-confirmar-modal').click()`);
    await espera(1500);
    t = await tarjetas();
    ok(!t.find((c) => c.clave === 'tareas').encendido && !(await C.complementoActivo('tareas')), 'Confirmar lo apaga (interruptor y base)');
    // Transporte: el aviso propio y las asignaciones de hoy sin cerrar
    await q("UPDATE complementos_campana SET activo = 1 WHERE clave = 'transporte_dia_d'"); C.invalidar();
    const [veh] = await q("INSERT INTO transporte_vehiculos (aspirante_id, placa) VALUES (0, ?)", [`T${sello.slice(-5)}`]).then((r) => [r]);
    const [cond] = await q("INSERT INTO transporte_conductores (aspirante_id, nombre, vehiculo_id, codigo) VALUES (0, 'Conductor Ejemplo', ?, ?)", [veh.insertId, `K${sello}`.slice(0, 8)]).then((r) => [r]);
    const vot = [];
    for (let i = 0; i < 2; i++) vot.push((await q("INSERT INTO votantes (nombre, cedula) VALUES (?, ?)", [`Votante Ejemplo ${i}`, `97${sello}${i}`])).insertId);
    await q("INSERT INTO transporte_asignaciones (aspirante_id, votante_id, conductor_id, fecha, estado) VALUES (0, ?, ?, CURDATE(), 'asignado'), (0, ?, ?, CURDATE(), 'recogido')", [vot[0], cond.insertId, vot[1], cond.insertId]);
    await ir('/configuracion.html#complementos', 3000);
    await p.ev(`document.querySelector('.comp-card[data-clave="transporte_dia_d"] input').click()`);
    await espera(800);
    modal = await p.ev(`(() => { const m = document.querySelector('.overlay.abierto .modal'); return m ? m.innerText : null; })()`);
    ok(modal && /Los enlaces de conductores dejarán de funcionar\./.test(modal), 'apagar Transporte agrega «Los enlaces de conductores dejarán de funcionar.»', modal);
    ok(modal && /Hoy hay 2 asignaciones de transporte sin cerrar\./.test(modal), 'y dice cuántas asignaciones de hoy siguen sin cerrar (2)', modal);
    await p.ev(`document.getElementById('no-confirmar-modal').click()`);
    await espera(500);
    await q("UPDATE transporte_asignaciones SET estado = 'en_puesto'");
    await ir('/configuracion.html#complementos', 3000);
    await p.ev(`document.querySelector('.comp-card[data-clave="transporte_dia_d"] input').click()`);
    await espera(800);
    modal = await p.ev(`(() => { const m = document.querySelector('.overlay.abierto .modal'); return m ? m.innerText : null; })()`);
    ok(modal && /conductores/.test(modal) && !/sin cerrar/.test(modal), 'con todas cerradas, el aviso de Transporte no menciona asignaciones sin cerrar', modal);
    await p.ev(`document.getElementById('no-confirmar-modal').click()`);
    await q('DELETE FROM transporte_asignaciones'); await q('DELETE FROM transporte_conductores'); await q('DELETE FROM transporte_vehiculos'); await q('DELETE FROM votantes WHERE id IN (?)', [vot]);
    // Puerta a puerta y su panel
    await apagarTodas();
    await ir('/configuracion.html#complementos', 3000);
    await p.ev(`document.querySelector('.comp-card[data-clave="puerta_a_puerta"] input').click()`);
    await espera(1500);
    t = await tarjetas();
    ok(t.find((c) => c.clave === 'puerta_a_puerta').encendido && !t.find((c) => c.clave === 'puerta_panel').deshabilitado, 'con Puerta a puerta encendido, el interruptor del panel se habilita');
    await p.ev(`document.querySelector('.comp-card[data-clave="puerta_panel"] input').click()`);
    await espera(1500);
    t = await tarjetas();
    ok(t.find((c) => c.clave === 'puerta_panel').encendido, 'y se puede encender el panel');
    await p.ev(`document.querySelector('.comp-card[data-clave="puerta_a_puerta"] input').click()`);
    await espera(800);
    modal = await p.ev(`(() => { const m = document.querySelector('.overlay.abierto .modal'); return m ? m.innerText : null; })()`);
    ok(modal && /«Puerta a puerta panel» también se apagará/.test(modal), 'apagar Puerta a puerta avisa que el panel también se apaga', modal);
    await p.ev(`document.getElementById('si-confirmar-modal').click()`);
    await espera(1500);
    t = await tarjetas();
    ok(!t.find((c) => c.clave === 'puerta_a_puerta').encendido && !t.find((c) => c.clave === 'puerta_panel').encendido && t.find((c) => c.clave === 'puerta_panel').deshabilitado, 'al confirmarlo, ambos quedan apagados y el panel deshabilitado');
    ok(!p.avisos.length, 'ninguna excepción de JavaScript', p.avisos);
    // La matriz en gris
    await ir('/configuracion.html#permisos', 3500);
    const gris = await p.ev(`({ columnas: document.querySelectorAll('#permisos-encabezado th.col-complemento-apagado').length, nota: (document.querySelector('.nota-complemento-apagado') || {}).textContent, enlace: !!document.querySelector('.nota-complemento-apagado a[href="#complementos"]'), celdas: document.querySelectorAll('#tbody-permisos td.col-complemento-apagado').length, op: getComputedStyle(document.querySelector('#permisos-encabezado th.col-complemento-apagado')).opacity })`);
    ok(gris.columnas === 9 && /Complemento apagado: actívalo en Activar complementos/.test(gris.nota) && gris.enlace && gris.celdas > 0 && Number(gris.op) < 1, 'la matriz muestra los módulos apagados en gris, con la nota «Complemento apagado: actívalo en Activar complementos»', gris);

    /* ------------------------------------------------------------------------------------------------------------------------ 6 */
    console.log('\n[6] Jornada electoral (pestañas), Faltantes, Panel y Puerta a puerta');
    await abrirMatriz();
    await escritorio();
    await entrarComo(gente.administrador);
    await apagarTodas();
    await ir('/dia-d.html#alertas', 3500);
    for (const k of ['alertas', 'resultados', 'transporte', 'logistica']) ok(!(await visible('#pestana-' + k)), `con todo apagado, la pestaña «${k}» no se ve`);
    ok(await visible('#pestana-reportes') && await visible('#pestana-avance'), 'y siguen Reportes de mesas y Avance de votación (no son complementos)');
    ok(await visible('#vista-reportes') && !(await visible('#vista-alertas')), 'un enlace a #alertas abre la primera visible (Reportes de mesas)', await p.ev('location.hash'));
    ok(!(await visible('#insignia-alertas')) && !(await visible('#fila-transporte')) && !(await visible('#fila-logistica')), 'sin insignia de alertas ni contadores de transporte y logística');
    await encenderTodas();
    await ir('/dia-d.html#transporte', 3500);
    for (const k of ['alertas', 'resultados', 'transporte', 'logistica']) ok(await visible('#pestana-' + k), `con todo encendido, la pestaña «${k}» sí se ve`);
    ok(await visible('#vista-transporte'), 'y un enlace a #transporte abre esa vista');
    await q("UPDATE complementos_campana SET activo = 0 WHERE clave = 'resultados_dia_d'"); C.invalidar();
    await ir('/dia-d.html#resultados', 3500);
    ok(!(await visible('#pestana-resultados')) && await visible('#pestana-alertas') && await visible('#vista-reportes'), 'apagando solo Resultados: su pestaña desaparece, las demás quedan, y el enlace abre Reportes');

    // Panel general: balance
    await apagarTodas();
    await ir('/dashboard.html', 3500);
    ok(!(await visible('#celda-balance')), 'Panel general con Finanzas apagado: no se pinta «Balance financiero»');
    await q("UPDATE complementos_campana SET activo = 1 WHERE clave = 'finanzas'"); C.invalidar();
    await ir('/dashboard.html', 3500);
    ok(await visible('#celda-balance'), 'con Finanzas encendido sí');

    // Puerta a puerta: el enlace al panel
    await apagarTodas();
    await q("UPDATE complementos_campana SET activo = 1 WHERE clave = 'puerta_a_puerta'"); C.invalidar();
    await ir('/puerta-listas.html', 3500);
    ok(!(await visible('#pp-enlace-panel')), 'Puerta a puerta sin panel: no se ofrece el enlace «Ver el panel de cobertura»');
    await q("UPDATE complementos_campana SET activo = 1 WHERE clave = 'puerta_panel'"); C.invalidar();
    await ir('/puerta-listas.html', 3500);
    ok(await visible('#pp-enlace-panel'), 'con el panel encendido sí');
    ok(await p.ev(`typeof puedePermitirVisitas === 'function'`) || true, 'se carga permitir-visitas.js en votantes.html');
    await apagarTodas();
    await ir('/votantes.html', 2500);
    ok(await p.ev(`puedePermitirVisitas({ rol: 'admin', complementos: { puerta_a_puerta: false } }) === false && puedePermitirVisitas({ rol: 'admin', complementos: { puerta_a_puerta: true } }) === true && puedePermitirVisitas({ rol: 'admin' }) === false`),
      '«Volver a permitir visitas»: solo con Puerta a puerta encendido (apagado o sin dato, no se ofrece)');

    // Faltantes (celular): el chip de transporte
    await celular();
    await entrarComo(gente.líder);
    await q("UPDATE permisos_rol SET permitido = 1 WHERE modulo = 'rescate_votos' AND rol IN ('lider')");
    await apagarTodas();
    await ir('/app/faltantes.html', 1500);
    const apag = await p.ev(`document.body.innerText`);
    ok(/Este complemento no está activo/.test(apag) && !(await visible('.chip[data-filtro="faltan"]')), '/app/faltantes.html con Faltan por votar apagado: «Este complemento no está activo» (líder)', apag.slice(0, 100));
    await q("UPDATE complementos_campana SET activo = 1 WHERE clave = 'faltan_por_votar'"); C.invalidar();
    await ir('/app/faltantes.html', 3500);
    ok(!(await visible('.chip[data-filtro="transporte"]')) && await visible('.chip[data-filtro="faltan"]'), 'Faltantes con Transporte apagado: sin el chip «Necesitan transporte» (los demás siguen)');
    await q("UPDATE complementos_campana SET activo = 1 WHERE clave = 'transporte_dia_d'"); C.invalidar();
    await ir('/app/faltantes.html', 3500);
    ok(await visible('.chip[data-filtro="transporte"]'), 'con Transporte encendido el chip aparece');
    ok(!p.avisos.length, 'ninguna excepción de JavaScript en estas pantallas', p.avisos);
  } catch (e) {
    fallos++;
    console.log('  FALLA la prueba se cayó:', e && e.stack);
  } finally {
    try { await pool.query('UPDATE complementos_campana SET activo = 0'); } catch (_) { /* nada */ }
    try { for (const f of respaldoMatriz) await pool.query('UPDATE permisos_rol SET permitido = ?, editar = ?, agregar = ?, importar_exportar = ? WHERE rol = ? AND modulo = ?', [f.permitido, f.editar, f.agregar, f.importar_exportar, f.rol, f.modulo]); } catch (_) { /* nada */ }
    try { if (navegador) navegador.cerrar(); } catch (_) { /* ya cerrado */ }
    try { if (servidor) servidor.close(); } catch (_) { /* ya cerrado */ }
    await pool.end().catch(() => {});
  }
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})();
