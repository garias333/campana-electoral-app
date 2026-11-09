#!/usr/bin/env node
// scripts/probar-menu-politica.js
//
// Prueba, en un Chromium REAL, de LA ENTRADA «Política de privacidad» en Configuración (parche 311) y del recuadro ámbar de la finalidad de las visitas:
//   · el superadministrador NO veía la entrada de «Contenido para compartir → Política de privacidad» (su menú sale del catálogo MODULOS, que no la trae;
//     el grupo se le encoge a un solo enlace a «Información para compartir»): ahora la ve en Configuración;
//   · el administrador la ve en Configuración (y en Contenido para compartir); el coordinador no ve Configuración;
//   · la entrada lleva a /contenido.html?clave=politica_privacidad;
//   · en esa pantalla, si la política NO trae la finalidad de las visitas, el administrador y el superadministrador ven el recuadro ámbar con el párrafo para
//     pegar; si la trae, no hay recuadro; el coordinador nunca lo ve.
//
// USO (sobre una base desechable ya inicializada con init-db; hace falta Chromium, ver scripts/capturas/navegador.js):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada311m node scripts/probar-menu-politica.js
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
delete process.env.MAPBOX_ACCESS_TOKEN;

const fs = require('fs');
const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { lanzar, espera } = require('./capturas/navegador');
const { crear } = require('./capturas/servidor');
const { FRASE_POLITICA_VISITAS, PARRAFO_POLITICA_VISITAS } = require('../config/politicaVisitas');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); }
}
async function q(sql, p) { const [f] = await pool.query(sql, p); return f; }
const sello = String(Date.now()).slice(-7);
let n = 0;
async function persona(nombre, rol) {
  n++;
  const [r] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, password_hash, rol_id, activo) VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1)`,
    [nombre, `93${sello}${n}`, `u93${sello}${n}`, bcrypt.hashSync('clave-ejemplo', 4), rol]);
  return r.insertId;
}

(async () => {
  let servidor; let navegador;
  try {
    await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
    const [sup] = await q('SELECT id FROM usuarios WHERE es_superadmin = 1 LIMIT 1');
    if (!sup) throw new Error('la base de prueba no tiene superadministrador (¿corrió init-db?)');
    const superadmin = sup.id;
    const admin = await persona('Admin Ejemplo', 'admin');
    const coord = await persona('Coord Ejemplo', 'coordinador');
    console.log('MENÚ «POLÍTICA DE PRIVACIDAD» Y AVISO DE LAS VISITAS — base «' + nombreBase + '»\n');

    const app = crear(pool);
    servidor = http.createServer(app);
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${servidor.address().port}`;
    navegador = await lanzar();
    const p = await navegador.pagina('about:blank');
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await p.cmd('Network.clearBrowserCookies');
    const entrarComo = (id) => p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(id), url: base });
    const ir = async (ruta, ms = 3000) => { await p.cmd('Page.navigate', { url: base + ruta }); await espera(ms); };
    const menu = () => p.ev(`({
      grupos: Array.from(document.querySelectorAll('.nav-submenu')).map((sm) => ({
        grupo: (document.querySelector('[data-grupo="' + sm.dataset.submenu + '"] .nav-grupo-texto') || {}).textContent.trim(),
        items: Array.from(sm.querySelectorAll('a')).map((a) => ({ texto: a.textContent.trim(), href: a.dataset.navHref })) })),
      sueltos: Array.from(document.querySelectorAll('a.nav-link-principal')).map((a) => ({ texto: a.textContent.replace(/\\s+/g, ' ').trim(), href: a.dataset.navHref })),
    })`);
    const RUTA = '/contenido.html?clave=politica_privacidad';
    const ENTRADA = 'Política de privacidad';

    console.log('[1] Quién ve la entrada y dónde');
    await entrarComo(superadmin);
    await ir('/recursos.html');
    let m = await menu();
    const conf = m.grupos.find((g) => /CONFIGURACI/.test(g.grupo));
    ok(conf && conf.items.some((i) => i.texto === ENTRADA && i.href === RUTA), 'el SUPERADMINISTRADOR ve «Política de privacidad» dentro de Configuración', conf);
    ok(!m.grupos.some((g) => /CONTENIDO/.test(g.grupo)) && m.sueltos.some((s) => /CONTENIDO PARA COMPARTIR/.test(s.texto) && s.href === '/recursos.html'),
      'y se confirma por qué no la veía: su «Contenido para compartir» es un solo enlace a Información para compartir', { sueltos: m.sueltos.map((s) => s.texto) });
    await entrarComo(admin);
    await ir('/recursos.html');
    m = await menu();
    ok(m.grupos.find((g) => /CONFIGURACI/.test(g.grupo)).items.some((i) => i.texto === ENTRADA && i.href === RUTA), 'el administrador la ve en Configuración');
    ok(m.grupos.find((g) => /CONTENIDO/.test(g.grupo)).items.some((i) => i.texto === ENTRADA && i.href === RUTA), 'y sigue viéndola en Contenido para compartir (misma dirección)');
    await entrarComo(coord);
    await ir('/recursos.html');
    m = await menu();
    ok(!m.grupos.some((g) => /CONFIGURACI/.test(g.grupo)) && !m.sueltos.some((s) => /CONFIGURACI/.test(s.texto)), 'el coordinador no ve Configuración (y por tanto tampoco esa entrada)');
    ok(m.grupos.some((g) => /CONTENIDO/.test(g.grupo) && g.items.some((i) => i.texto === ENTRADA)) || m.sueltos.some((s) => /CONTENIDO/.test(s.texto)), 'pero conserva su entrada de siempre en Contenido para compartir', m);

    console.log('\n[2] La entrada lleva a la pantalla de la política');
    await entrarComo(superadmin);
    await ir('/recursos.html');
    await p.ev(`Array.from(document.querySelectorAll('.nav-submenu a')).find((a) => a.textContent.trim() === '${ENTRADA}' && a.closest('.nav-submenu') && document.querySelector('[data-grupo="' + a.closest('.nav-submenu').dataset.submenu + '"] .nav-grupo-texto').textContent.includes('CONFIGURACI')).click()`);
    await espera(3000);
    ok(await p.ev('location.pathname + location.search') === RUTA && await p.ev(`!!document.querySelector('#politica-titulo')`), 'al tocarla abre /contenido.html?clave=politica_privacidad', await p.ev('location.pathname + location.search'));

    console.log('\n[3] El recuadro ámbar de la finalidad de las visitas');
    const original = (await q(`SELECT contenido FROM contenido_paginas WHERE clave = 'politica_privacidad'`))[0].contenido;
    const sinParrafo = original.replace('\n\n' + PARRAFO_POLITICA_VISITAS, '');
    ok(sinParrafo !== original, 'preparo una política editada por el administrador y SIN la finalidad');
    await q(`UPDATE contenido_paginas SET contenido = ?, actualizado_por = ? WHERE clave = 'politica_privacidad'`, [sinParrafo, admin]);
    const aviso = () => p.ev(`(() => { const e = document.querySelector('#aviso-visitas-politica'); return e ? { visible: getComputedStyle(e).display !== 'none', texto: e.textContent.replace(/\\s+/g, ' ').trim(), area: (e.querySelector('textarea') || {}).value || '' } : null; })()`);
    for (const [quien, id] of [['superadministrador', superadmin], ['administrador', admin]]) {
      await entrarComo(id);
      await ir(RUTA);
      const a = await aviso();
      ok(a && a.visible && /Falta la finalidad de las visitas/.test(a.texto) && /Como ya la editaste/.test(a.texto) && a.area.includes(FRASE_POLITICA_VISITAS) && a.area === PARRAFO_POLITICA_VISITAS, `el ${quien} ve el recuadro ámbar con el párrafo exacto para pegar`, a && { visible: a.visible, texto: a.texto.slice(0, 80) });
    }
    await entrarComo(coord);
    await ir(RUTA);
    const ac = await aviso();
    ok(!ac || !ac.visible, 'el coordinador no ve el recuadro');
    await q(`UPDATE contenido_paginas SET contenido = ? WHERE clave = 'politica_privacidad'`, [sinParrafo + '\n\n' + PARRAFO_POLITICA_VISITAS]);
    await entrarComo(admin);
    await ir(RUTA);
    const ao = await aviso();
    ok(ao && !ao.visible, 'cuando la política ya trae la finalidad, el recuadro se va');
    await q(`UPDATE contenido_paginas SET contenido = ?, actualizado_por = NULL WHERE clave = 'politica_privacidad'`, [original]);

    ok(!p.avisos.length, 'ninguna excepción de JavaScript en las pantallas', p.avisos);
  } catch (e) {
    fallos++;
    console.log('  FALLA la prueba se cayó:', e && e.message);
  } finally {
    try { if (navegador) navegador.cerrar(); } catch (_) { /* ya cerrado */ }
    try { if (servidor) servidor.close(); } catch (_) { /* ya cerrado */ }
    await pool.end().catch(() => {});
  }
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})();
