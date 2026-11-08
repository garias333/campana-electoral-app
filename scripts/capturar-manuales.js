#!/usr/bin/env node
// scripts/capturar-manuales.js
//
// REHACE LAS CAPTURAS DE PANTALLA DE LOS MANUALES (orden Manuales 4). Cada guía de manuales/bloques/ que explica una pantalla muestra
// su captura real, tomada con datos inventados, en public/manuales/img/<id-de-la-guía>.webp (o <id>-2.webp para una segunda).
//
// QUÉ HACE, DE PUNTA A PUNTA:
//   1. Siembra datos de ejemplo en una base `simulada…` recién inicializada (scripts/capturas/semilla.js; es idempotente).
//   2. Levanta un servidor con las rutas REALES de la aplicación (scripts/capturas/servidor.js) y abre Chromium sin ventana.
//   3. Para cada entrada de scripts/capturas/lista.js: entra con el rol que dice (por cookie), navega, hace los pasos, dibuja el
//      recuadro amarillo #FFC300 de 3 px donde se indique, recorta la zona útil y guarda un WebP (calidad ~75; deviceScaleFactor 2 en
//      celular, 1 en escritorio; si pasa de 150 KB baja la calidad).
//   4. Se NIEGA a guardar una captura si el texto de la pantalla trae un cargo de elección (precampaña) o el aviso de datos reales.
//   5. Llena el campo `captura:` de cada guía capturada (a menos que se pase --sin-md).
//
// USO (sobre una base desechable ya inicializada con init-db):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada298 node scripts/capturar-manuales.js
//   ...  --solo t-votante-agregar,mod-organigrama     (solo esas)
//   ...  --lista                                       (muestra lo que haría, sin abrir nada)
//   ...  --sin-md                                      (no toca manuales/bloques/*.md)
//
// SE NIEGA A CORRER si DB_NAME no empieza por «simulada» o «prueba»: jamás debe tocar una campaña real.

require('dotenv').config();
const nombreBase = process.env.DB_NAME || '';
const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(n); return i === -1 ? null : (args[i + 1] || ''); };
const SOLO_LISTAR = args.includes('--lista');
if (!SOLO_LISTAR && !/^(simulada|prueba)/i.test(nombreBase)) {
  console.error(`Me niego: DB_NAME="${nombreBase}" no empieza por «simulada» ni «prueba».`);
  process.exit(2);
}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'secreto-de-prueba';
process.env.LICENCIA_DOMINIO = 'campana.prueba';
process.env.CATALOGO_DB = 'catalogo_prueba_inexistente';

const fs = require('fs');
const path = require('path');
const http = require('http');
const LISTA = require(process.env.LISTA_ARCHIVO || './capturas/lista');

const RAIZ = path.join(__dirname, '..');
const SALIDA = path.join(RAIZ, 'public', 'manuales', 'img');
const BLOQUES = path.join(RAIZ, 'manuales', 'bloques');
const TOPE_BYTES = 150 * 1024;
const ANCHOS = { cel: 390, pc: 1280 };
const CARGOS = /alcald|concej|gobernaci|asamble|senad|c[aá]mara de representantes|\bjal\b|\bedil/i;

const solo = opcion('--solo') ? opcion('--solo').split(',').map((s) => s.trim()).filter(Boolean) : null;
const entradas = LISTA.filter((e) => !solo || solo.includes(e.id));

if (SOLO_LISTAR) {
  entradas.forEach((e) => console.log(`${e.id.padEnd(30)} ${(e.rol || 'público').padEnd(12)} ${e.ancho}  ${e.url}`));
  console.log(`${entradas.length} capturas`);
  process.exit(0);
}

const { lanzar, espera } = require('./capturas/navegador');
const { sembrar } = require('./capturas/semilla');
const { crear } = require('./capturas/servidor');
const pool = require('../config/db');

/** Funciones que viven en la página: buscar un elemento por selector CSS o por «texto:…», y dibujar el recuadro amarillo. */
const AYUDANTES = `(() => {
  const norm = (t) => String(t || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/\\s+/g, ' ').trim();
  const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  window.__ej = {
    buscar(sel) {
      if (sel.startsWith('texto:')) {
        const t = norm(sel.slice(6));
        const c = [...document.querySelectorAll('button, a, label, summary, h1, h2, h3, h4, th, td, li, span, p, div, option, input[type=submit], input[type=button]')]
          .filter((e) => visible(e) && norm(e.value && /submit|button/.test(e.type) ? e.value : e.textContent).includes(t));
        // El más corto; a igual texto, el que se puede tocar (botón, enlace…) y el más profundo (no el contenedor que lo envuelve).
        const hondo = (e) => { let n = 0; for (let x = e; x.parentElement; x = x.parentElement) n++; return n; };
        const tocable = (e) => (/^(BUTTON|A|SUMMARY|INPUT|LABEL)$/.test(e.tagName) ? 0 : 1);
        c.sort((a, b) => (norm(a.textContent).length - norm(b.textContent).length) || (tocable(a) - tocable(b)) || (hondo(b) - hondo(a)));
        return c[0] || null;
      }
      return document.querySelector(sel);
    },
    caja(el, pad) {
      const r = el.getBoundingClientRect();
      return { x: Math.max(0, r.left + scrollX - pad), y: Math.max(0, r.top + scrollY - pad), w: r.width + pad * 2, h: r.height + pad * 2 };
    },
    resaltar(sel) {
      const el = this.buscar(sel);
      if (!el) return false;
      const b = this.caja(el, 3);
      const d = document.createElement('div');
      d.className = '__ej_resalte';
      d.style.cssText = 'position:absolute;pointer-events:none;z-index:2147483647;box-sizing:border-box;border:3px solid #FFC300;border-radius:8px;left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px';
      document.body.appendChild(d);
      return true;
    },
  };
})()`;

function encuadre(entrada) {
  return { ancho: ANCHOS[entrada.ancho] || entrada.ancho, movil: (ANCHOS[entrada.ancho] || entrada.ancho) < 600 };
}

async function capturar(navegador, base, ids, entrada) {
  const { ancho, movil } = encuadre(entrada);
  const alto = entrada.alto || (movil ? 844 : 800);
  const p = await navegador.pagina('about:blank');
  try {
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: movil ? 2 : 1, mobile: movil });
    await p.cmd('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' });
    await p.cmd('Network.clearBrowserCookies');
    if (entrada.rol) await p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(ids[entrada.rol]), url: base });
    await p.cmd('Page.navigate', { url: base + entrada.url });
    await espera(entrada.esperar || 2200);
    await p.ev(AYUDANTES);

    const api = {
      ev: p.ev,
      espera,
      buscar: (sel) => p.ev(`!!window.__ej.buscar(${JSON.stringify(sel)})`),
      async clic(sel) {
        const ok = await p.ev(`(() => { const e = window.__ej.buscar(${JSON.stringify(sel)}); if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true; })()`);
        if (!ok) throw new Error('no encontré para tocar: ' + sel);
        await espera(700);
      },
      async desplazar(sel) {
        const ok = await p.ev(`(() => { const e = window.__ej.buscar(${JSON.stringify(sel)}); if (!e) return false; e.scrollIntoView({block:'center'}); return true; })()`);
        if (!ok) throw new Error('no encontré para desplazar: ' + sel);
        await espera(400);
      },
      async escribir(sel, valor) {
        const ok = await p.ev(`(() => { const e = window.__ej.buscar(${JSON.stringify(sel)}); if (!e) return false; e.focus(); e.value = ${JSON.stringify(valor)};
          e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);
        if (!ok) throw new Error('no encontré para escribir: ' + sel);
        await espera(300);
      },
      async elegir(sel, texto) {
        const ok = await p.ev(`(() => { const e = window.__ej.buscar(${JSON.stringify(sel)}); if (!e) return false; const o = [...e.options].find((x) => x.text.toLowerCase().includes(${JSON.stringify(texto.toLowerCase())}));
          if (!o) return false; e.value = o.value; e.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);
        if (!ok) throw new Error('no encontré la opción «' + texto + '» en ' + sel);
        await espera(500);
      },
    };
    if (entrada.antes) await entrada.antes(api);

    for (const sel of entrada.resaltar || []) {
      const ok = await p.ev(`window.__ej.resaltar(${JSON.stringify(sel)})`);
      if (!ok) throw new Error('no encontré para resaltar: ' + sel);
    }

    let clip;
    if (entrada.recorte) {
      const c = await p.ev(`(() => { let e = window.__ej.buscar(${JSON.stringify(entrada.recorte)}); for (let i = 0; e && i < ${entrada.subir || 0}; i++) e = e.parentElement;
        return e ? window.__ej.caja(e, ${entrada.margen === undefined ? 8 : entrada.margen}) : null; })()`);
      if (!c) throw new Error('no encontré para recortar: ' + entrada.recorte);
      clip = { x: 0, y: c.y, width: ancho, height: Math.min(c.h, entrada.altoMax || 1400) };
    } else {
      const y = await p.ev('scrollY');
      clip = { x: 0, y, width: ancho, height: alto };
    }
    if (entrada.recorteAlto) clip.height = Math.min(clip.height, entrada.recorteAlto);

    // Precampaña: ningún cargo de elección en lo que SE VE dentro del recorte (no cuentan las opciones cerradas de un desplegable).
    const visible = await p.ev(`(() => {
      const y0 = ${clip.y}, y1 = ${clip.y + clip.height}, salida = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const n = w.currentNode; const t = n.nodeValue.trim(); if (!t) continue;
        const e = n.parentElement; if (!e || e.closest('select, option, script, style, noscript, template, [hidden], .__ej_resalte')) continue;
        const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        const top = b.top + scrollY, bot = b.bottom + scrollY;
        if (bot > y0 && top < y1) salida.push(t);
      }
      return salida.join(' | ');
    })()`);
    const hallado = CARGOS.exec(visible || '');
    if (hallado && !entrada.permitirTexto) {
      const i = visible.toLowerCase().indexOf(hallado[0].toLowerCase());
      throw new Error(`se ve «${visible.slice(Math.max(0, i - 25), i + 35)}» (un cargo de elección); no se guarda`);
    }

    let calidad = 75; let datos = null;
    for (; calidad >= 35; calidad -= 10) {
      const r = await p.cmd('Page.captureScreenshot', { format: 'webp', quality: calidad, captureBeyondViewport: true, clip: { ...clip, scale: 1 } });
      datos = Buffer.from(r.result.data, 'base64');
      if (datos.length <= TOPE_BYTES) break;
    }
    if (datos.length > TOPE_BYTES) throw new Error(`pesa ${Math.round(datos.length / 1024)} KB aun con calidad ${calidad + 10}: recórtala`);
    fs.mkdirSync(SALIDA, { recursive: true });
    fs.writeFileSync(path.join(SALIDA, entrada.id + '.webp'), datos);
    return { bytes: datos.length, calidad: calidad > 35 ? calidad : calidad + 10, avisos: p.avisos.length };
  } finally {
    p.cerrar();
  }
}

/** Escribe `captura:` en la cabecera de cada guía; si ya había otra imagen de la misma guía (-2) las junta en orden. */
function escribirCapturas(hechas) {
  const porGuia = {};
  hechas.forEach((e) => { const guia = e.guia || e.id.replace(/-\d+$/, ''); (porGuia[guia] = porGuia[guia] || []).push(e.id + '.webp'); });
  Object.keys(porGuia).forEach((guia) => {
    const archivo = path.join(BLOQUES, guia + '.md');
    if (!fs.existsSync(archivo)) { console.log(`  (sin guía ${guia}.md: no se escribió captura:)`); return; }
    const texto = fs.readFileSync(archivo, 'utf8');
    const nuevo = texto.replace(/^captura:.*$/m, 'captura: ' + porGuia[guia].sort((a, b) => a.replace(/\.webp$/, '').localeCompare(b.replace(/\.webp$/, ''))).join(', '));
    if (nuevo !== texto) fs.writeFileSync(archivo, nuevo);
  });
}

(async () => {
  let servidor; let navegador;
  const hechas = []; const fallas = [];
  try {
    const ids = await sembrar(pool);
    const app = crear(pool);
    servidor = http.createServer(app);
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${servidor.address().port}`;
    navegador = await lanzar();
    for (const e of entradas) {
      try {
        const r = await capturar(navegador, base, ids, e);
        hechas.push(e);
        console.log(`  ok   ${e.id.padEnd(30)} ${String(Math.round(r.bytes / 1024)).padStart(4)} KB  q${r.calidad}${r.avisos ? '  (' + r.avisos + ' errores de JS en la página)' : ''}`);
      } catch (err) {
        fallas.push([e.id, err.message]);
        console.log(`  FALLA ${e.id.padEnd(30)} ${err.message}`);
      }
    }
  } finally {
    if (navegador) navegador.cerrar();
    if (servidor) servidor.close();
    await pool.end().catch(() => {});
  }
  if (!args.includes('--sin-md') && hechas.length) escribirCapturas(hechas);
  console.log(`\n${hechas.length} capturas guardadas en public/manuales/img/, ${fallas.length} fallas.`);
  process.exit(fallas.length ? 1 : 0);
})();
