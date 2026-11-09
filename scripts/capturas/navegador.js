'use strict';
/**
 * Un cliente mínimo de Chromium por CDP (WebSocket nativo de Node 22), sin dependencias. Lo usa scripts/capturar-manuales.js.
 * Chromium se busca en CHROMIUM, /snap/bin/chromium, chromium-browser o google-chrome.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function ejecutable() {
  const candidatos = [process.env.CHROMIUM, '/snap/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean);
  const hallado = candidatos.find((c) => fs.existsSync(c));
  if (!hallado) throw new Error('No encontré Chromium. Indica la ruta en CHROMIUM=/ruta/a/chromium.');
  return hallado;
}

const pedir = (metodo, url) => new Promise((ok, ko) => {
  const r = http.request(url, { method: metodo }, (x) => { let d = ''; x.on('data', (c) => { d += c; }); x.on('end', () => { try { ok(JSON.parse(d)); } catch (e) { ko(e); } }); });
  r.on('error', ko); r.end();
});

/** Abre Chromium sin ventana. El perfil va en $HOME (el Chromium de snap no puede escribir en /tmp). */
async function lanzar() {
  const perfil = path.join(os.homedir(), '.cache', 'capturas-manuales-chromium');
  fs.rmSync(perfil, { recursive: true, force: true });
  const proc = spawn(ejecutable(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb',
    '--remote-debugging-port=0', `--user-data-dir=${perfil}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const puerto = await new Promise((ok, ko) => {
    let buf = '';
    const t = setTimeout(() => ko(new Error('Chromium no abrió el puerto de depuración.')), 30000);
    proc.stderr.on('data', (c) => {
      buf += c;
      const m = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(buf);
      if (m) { clearTimeout(t); ok(Number(m[1])); }
    });
    proc.on('exit', () => ko(new Error('Chromium se cerró al arrancar.')));
  });
  return {
    puerto,
    async pagina(url) {
      const t = await pedir('PUT', `http://127.0.0.1:${puerto}/json/new?${encodeURIComponent(url || 'about:blank')}`);
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((r) => ws.addEventListener('open', r));
      let n = 0; const pend = new Map(); const avisos = []; const peticiones = []; const respuestas = []; const detalle = [];   // `peticiones`: la URL de cada petición que hizo la página (para comprobar a dónde NO llama)
      ws.addEventListener('message', (m) => {
        const o = JSON.parse(m.data);
        if (o.method === 'Network.requestWillBeSent') peticiones.push(o.params.request.url);
        // Para comprobar QUÉ cabecera Referer salió y CON QUÉ código respondió cada petición (scripts/probar-mapa-fondo.js).
        if (o.method === 'Network.requestWillBeSent') detalle.push({ id: o.params.requestId, url: o.params.request.url, referer: o.params.request.headers.Referer || o.params.request.headers.referer || null });
        if (o.method === 'Network.responseReceived') respuestas.push({ url: o.params.response.url, status: o.params.response.status });
        if (o.method === 'Network.loadingFailed') respuestas.push({ url: (detalle.find((d) => d.id === o.params.requestId) || {}).url || '', status: 0, error: o.params.errorText });
        if (o.method === 'Runtime.exceptionThrown') avisos.push('EXC ' + JSON.stringify(o.params.exceptionDetails).slice(0, 200));
        if (o.method === 'Page.javascriptDialogOpening') ws.send(JSON.stringify({ id: ++n, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
        if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); }
      });
      const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
      const ev = async (expr) => {
        const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
        return r.result.result.value;
      };
      await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('Network.enable');
      await cmd('Network.setBypassServiceWorker', { bypass: true });
      return { cmd, ev, avisos, peticiones, respuestas, detalle, cerrar: () => { try { ws.close(); } catch (_) { /* ya cerrado */ } pedir('GET', `http://127.0.0.1:${puerto}/json/close/${t.id}`).catch(() => {}); } };
    },
    cerrar() { try { proc.kill('SIGKILL'); } catch (_) { /* ya cerrado */ } fs.rmSync(perfil, { recursive: true, force: true }); },
  };
}

module.exports = { lanzar, espera };
