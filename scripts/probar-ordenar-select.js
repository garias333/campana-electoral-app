#!/usr/bin/env node
// scripts/probar-ordenar-select.js
//
// Prueba, en un Chromium REAL, del ORDENADOR AUTOMÁTICO DE DESPLEGABLES de public/js/common.js (parche 304).
//
// EL FALLO QUE CORRIGE. Un filtro con «Todas» (valor vacío) elegido cuyo desplegable se llena DESPUÉS de pintarse la página (con
// innerHTML, desde lo que devolvió la API) quedaba, tras el orden alfabético, con la PRIMERA opción real elegida: el filtro cambiaba solo y
// la lista salía filtrada sin que nadie lo hubiera pedido. Mover el <option> seleccionado hace que el navegador marque otro; la versión
// anterior solo restauraba la selección si su valor no era '' — y ese es justo el caso que se rompía.
//
// QUÉ COMPRUEBA
//   · REPRODUCE el fallo con el ordenador anterior (scripts/fixtures/ordenar-select-anterior.js): sin esto, una prueba verde no demostraría nada.
//   · Con el common.js nuevo: «Todas» se queda elegida y las opciones quedan ordenadas; una opción real elegida se conserva; un select sin
//     opción vacía conserva la suya; uno múltiple conserva TODAS las elegidas; los grupos se ordenan por separado y conservan su elección;
//     dos opciones con el mismo valor no se confunden; un select sin ninguna elegida sigue sin ninguna; data-sin-ordenar no se toca.
//   · Que el cambio es del MISMO archivo para todas las pantallas (una sola función) y que el barrido estático de pantallas expuestas
//     encuentra los filtros que dependían de esto.
//
// USO (hace falta Chromium, ver scripts/capturas/navegador.js; no usa base de datos):
//   node scripts/probar-ordenar-select.js

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const { lanzar, espera } = require('./capturas/navegador');

let fallos = 0;
function ok(cond, texto, extra) {
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); }
}
const raiz = path.join(__dirname, '..');
const commonNuevo = fs.readFileSync(path.join(raiz, 'public/js/common.js'), 'utf8');
// El ordenador TAL COMO ERA antes del parche 304 (copia de git en un fixture, para que la prueba siga reproduciendo el fallo después de
// que el arreglo quede en el historial).
const commonAnterior = fs.readFileSync(path.join(__dirname, 'fixtures/ordenar-select-anterior.js'), 'utf8');

const PAGINA = (script) => `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>prueba</title></head><body>
<select id="a"><option value="">Todas</option></select>
<select id="b"><option value="">Todas</option></select>
<select id="c"></select>
<select id="d" multiple></select>
<select id="e"></select>
<select id="f"></select>
<select id="g"></select>
<select id="h" data-sin-ordenar></select>
<script src="${script}"></script></body></html>`;

(async () => {
  let navegador;
  const servidor = http.createServer((req, res) => {
    if (req.url === '/nuevo.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(PAGINA('/js/nuevo.js')); }
    if (req.url === '/anterior.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(PAGINA('/js/anterior.js')); }
    if (req.url === '/js/nuevo.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); return res.end(commonNuevo); }
    if (req.url === '/js/anterior.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); return res.end(commonAnterior); }
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    console.log('ORDENADOR DE DESPLEGABLES (common.js) — Chromium real\n');
    ok(/valorPrevio !== ''/.test(commonAnterior), 'tengo el ordenador anterior (fixture) para reproducir el fallo');
    ok(!/valorPrevio !== ''/.test(commonNuevo), 'y el nuevo ya no restaura "solo si el valor no es vacío"');
    navegador = await lanzar();
    const p = await navegador.pagina('about:blank');

    // El mismo guion en las dos versiones: llena los desplegables DESPUÉS de pintarse, como hacen las pantallas con lo que devuelve la API.
    const llenar = `(async () => {
      const opc = (v, t) => '<option value="' + v + '">' + t + '</option>';
      const $ = (i) => document.getElementById(i);
      // a: «Todas» elegida (lo normal en un filtro), opciones desordenadas.
      $('a').innerHTML = opc('', 'Todas') + opc(3, 'Zeta') + opc(1, 'Alfa') + opc(2, 'Beta');
      // b: «Todas» y, antes de que se ordene, el usuario (o el código) elige una real.
      $('b').innerHTML = opc('', 'Todas') + opc(3, 'Zeta') + opc(1, 'Alfa') + opc(2, 'Beta');
      $('b').value = '2';
      // c: sin opción vacía; elegida una del medio.
      $('c').innerHTML = opc(3, 'Zeta') + opc(1, 'Alfa') + opc(2, 'Beta'); $('c').value = '2';
      // d: múltiple con dos elegidas.
      $('d').innerHTML = opc(3, 'Zeta') + opc(1, 'Alfa') + opc(2, 'Beta') + opc(4, 'Delta');
      [...$('d').options].forEach((o) => { o.selected = o.value === '3' || o.value === '4'; });
      // e: con grupos; en el segundo, una elegida.
      $('e').innerHTML = '<option value="">Elige</option><optgroup label="G1">' + opc(31, 'Yuca') + opc(11, 'Arepa') + '</optgroup><optgroup label="G2">' + opc(32, 'Zapote') + opc(12, 'Banano') + '</optgroup>';
      $('e').value = '12';
      // f: dos opciones con el MISMO valor; la segunda (la de texto «Beta») elegida.
      $('f').innerHTML = opc('x', 'Zeta') + opc('x', 'Beta') + opc('y', 'Alfa');
      $('f').options[1].selected = true;
      // g: ninguna elegida.
      $('g').innerHTML = opc(3, 'Zeta') + opc(1, 'Alfa') + opc(2, 'Beta'); $('g').selectedIndex = -1;
      // h: no se toca.
      $('h').innerHTML = opc(3, 'Zeta') + opc(1, 'Alfa') + opc(2, 'Beta');
      await new Promise((r) => setTimeout(r, 400));
      const sel = (i) => ({ valor: $(i).value, indice: $(i).selectedIndex, textos: [...$(i).options].map((o) => o.textContent), elegidas: [...$(i).selectedOptions].map((o) => o.textContent) });
      return { a: sel('a'), b: sel('b'), c: sel('c'), d: sel('d'), e: sel('e'), f: sel('f'), g: sel('g'), h: sel('h') };
    })()`;

    /* ============================================================================ 1. el fallo, reproducido */
    console.log('[1] El fallo, con el common.js ANTERIOR');
    await p.cmd('Page.navigate', { url: base + '/anterior.html' }); await espera(700);
    const viejo = await p.ev(llenar);
    ok(viejo.a.valor !== '' && viejo.a.elegidas[0] !== 'Todas', 'con «Todas» elegida y el desplegable lleno después de pintarse, la versión anterior deja elegida la PRIMERA opción real (el fallo)', viejo.a);

    /* ============================================================================ 2. el arreglo */
    console.log('\n[2] Con el common.js NUEVO');
    await p.cmd('Page.navigate', { url: base + '/nuevo.html' }); await espera(700);
    const r = await p.ev(llenar);
    ok(r.a.valor === '' && r.a.elegidas.join() === 'Todas' && r.a.indice === 0, '«Todas» (valor vacío) SE QUEDA elegida', r.a);
    ok(r.a.textos.join() === 'Todas,Alfa,Beta,Zeta', 'y las opciones quedaron ordenadas, con «Todas» arriba', r.a.textos);
    ok(r.b.valor === '2' && r.b.elegidas.join() === 'Beta' && r.b.textos.join() === 'Todas,Alfa,Beta,Zeta', 'una opción real elegida antes de ordenar se conserva (Beta)', r.b);
    ok(r.c.elegidas.join() === 'Beta' && r.c.textos.join() === 'Alfa,Beta,Zeta', 'sin opción vacía: se conserva la elegida y se ordena', r.c);
    ok(r.d.elegidas.sort().join() === 'Delta,Zeta' && r.d.textos.join() === 'Alfa,Beta,Delta,Zeta', 'múltiple: se conservan las DOS elegidas', r.d);
    ok(r.e.valor === '12' && r.e.textos.join() === 'Elige,Arepa,Yuca,Banano,Zapote', 'con grupos: cada grupo se ordena por separado y la elegida (Banano) se conserva', r.e);
    ok(r.f.elegidas.join() === 'Beta' && r.f.indice === 1 || r.f.elegidas.join() === 'Beta', 'dos opciones con el mismo valor: se conserva la que estaba elegida (por elemento, no por valor)', r.f);
    ok(r.g.indice === -1 && r.g.elegidas.length === 0, 'sin ninguna elegida sigue sin ninguna', r.g);
    ok(r.h.textos.join() === 'Zeta,Alfa,Beta', 'data-sin-ordenar no se toca', r.h.textos);

    // El caso real, de punta a punta: un filtro que dispara la lista al cambiar NO debe cambiar solo.
    console.log('\n[3] El caso real: un filtro que se llena tarde no cambia solo');
    const caso = await p.ev(`(async () => {
      const s = document.getElementById('a');
      let cambios = 0; s.addEventListener('change', () => cambios++);
      s.innerHTML = '<option value="">Todas</option><option value="9">Z</option><option value="5">A</option>';
      await new Promise((r) => setTimeout(r, 300));
      s.innerHTML = '<option value="">Todas</option><option value="9">Z</option><option value="5">A</option><option value="7">M</option>';   // una segunda carga
      await new Promise((r) => setTimeout(r, 300));
      return { valor: s.value, texto: s.selectedOptions[0] && s.selectedOptions[0].textContent, cambios, textos: [...s.options].map((o) => o.textContent) };
    })()`);
    ok(caso.valor === '' && caso.texto === 'Todas' && caso.textos.join() === 'Todas,A,M,Z', 'dos cargas seguidas: sigue en «Todas» y ordenado', caso);
    ok(navegador && p.avisos.length === 0, 'sin errores de JavaScript en la página', p.avisos);

    /* ============================================================================ 4. barrido de pantallas */
    console.log('\n[4] Pantallas con filtros que se llenan después de pintarse (las que dependían de esto)');
    const expuestos = [];
    for (const dir of ['public', 'public/js', 'public/app']) {
      for (const f of fs.readdirSync(path.join(raiz, dir))) {
        if (!/\.(html|js)$/.test(f) || f === 'common.js') continue;
        const t = fs.readFileSync(path.join(raiz, dir, f), 'utf8');
        // innerHTML de un select que arranca con la opción vacía: $('id').innerHTML = '<option value="">…
        const re = /(?:getElementById\(\s*['"]([\w-]+)['"]\s*\)|\$\(\s*['"]([\w-]+)['"]\s*\)|document\.querySelector\(\s*['"]#([\w-]+)['"]\s*\))\s*\.innerHTML\s*\+?=\s*[`'"]<option value=["']["']/g;
        const ids = new Set();
        let m;
        while ((m = re.exec(t))) ids.add(m[1] || m[2] || m[3]);
        if (ids.size) expuestos.push({ archivo: `${dir}/${f}`, ids: [...ids] });
      }
    }
    expuestos.forEach((e) => console.log(`       ${e.archivo}: ${e.ids.join(', ')}`));
    const totalFiltros = expuestos.reduce((a, e) => a + e.ids.length, 0);
    ok(expuestos.length > 0 && totalFiltros > 0, `${expuestos.length} archivo(s) y ${totalFiltros} filtro(s) se llenan así: todos quedan cubiertos por el arreglo central (una sola función)`);
    const conExcepcion = expuestos.filter((e) => /data-sin-ordenar/.test(fs.readFileSync(path.join(raiz, e.archivo), 'utf8')));
    console.log(`       de ellos usan data-sin-ordenar en algún desplegable (orden con sentido propio): ${conExcepcion.map((e) => e.archivo).join(', ') || 'ninguno'}`);
    const usos = spawnSync('grep', ['-rn', '-E', "ordenarSelect\\(|ordenarTodosLosSelects\\(", 'public', '--include=*.html', '--include=*.js'], { cwd: raiz, encoding: 'utf8' }).stdout.split('\n').filter((l) => l && !l.startsWith('public/js/common.js'));
    ok(usos.length === 0, 'nadie más llama a ordenarSelect a mano: no hay otra copia de la lógica que corregir', usos.slice(0, 3));
  } finally {
    if (navegador) navegador.cerrar();
    servidor.close();
  }
  console.log(fallos ? `\n${fallos} comprobación(es) FALLARON.` : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('Error inesperado:', e); process.exit(1); });
