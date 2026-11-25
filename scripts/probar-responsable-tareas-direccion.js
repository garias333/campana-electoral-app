#!/usr/bin/env node
// scripts/probar-responsable-tareas-direccion.js — orden 119: EN «TAREAS DE DIRECCIÓN» EL RESPONSABLE SOLO ES EL CANDIDATO, UNA PERSONA DEL ORGANIGRAMA O UN COORDINADOR.
//
// SERVIDOR: el selector (/responsables: candidato, «Organigrama», «Coordinadores», sin duplicados, sin vacantes, sin inactivos, sin líderes/sublíderes ni el superadministrador);
//   la API rechaza (400) un responsable inventado, escrito a mano, líder o sublíder; el nombre y el cargo salen del ORIGEN (no del cuerpo); el SMS y el WhatsApp usan el celular
//   ACTUAL de la persona (si lo corrigieron en el organigrama o en Estructura, sirve sin editar la tarea); «sin celular» se recupera solo cuando se le agrega; si la persona se
//   borra del organigrama o deja de ser coordinador la tarea sigue, con la marca, y el aviso queda en «sin_celular»; las tareas ANTIGUAS (escritas a mano) se conservan con la
//   marca y obligan a elegir de la lista al editarlas; la migración de init-db enlaza las del candidato y de coordinadores.
// PANTALLAS (Chromium real): el selector abierto en escritorio (1280) y en celular (390×844): grupos, buscador, teclado, solo lectura, «Sin celular registrado», marca de las
//   antiguas, sin desbordes. Capturas en $SALIDA (por omisión ~/capturas-orden119).
//
// USO (base desechable ya inicializada con init-db; NO correr junto a otra prueba con Chromium):
//   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada119 node scripts/probar-responsable-tareas-direccion.js
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
const { execFileSync } = require('child_process');
const pool = require('../config/db');
const { lanzar, espera } = require('./capturas/navegador');
const { crear: crearServidor } = require('./capturas/servidor');
const R = require('../public/js/tareas-direccion-reglas');
const T = require('../lib/tareasDireccion');

const SALIDA = process.env.SALIDA || path.join(os.homedir(), 'capturas-orden119');
fs.mkdirSync(SALIDA, { recursive: true });
let fallos = 0; let pasos = 0;
function ok(cond, texto, extra) {
  pasos++;
  if (cond) console.log('  ok   ' + texto);
  else { fallos++; console.log('  FALLA ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 900) : '')); }
}
const q = async (sql, p) => (await pool.query(sql, p))[0];
const RAIZ = path.join(__dirname, '..');
const MARCA = 'PRUEBA119';
const en = (dia, hh = 8, mm = 0) => { const [y, m, d] = dia.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, hh + 5, mm)); };
const D = '2027-03-10';
const dia = (n) => R.sumarDias(D, n);

function cliente(base, usuarioId, extraCookie) {
  const pedir = async (metodo, ruta, cuerpo) => {
    const cookie = (usuarioId ? `ej_usuario=${usuarioId}` : '') + (extraCookie ? '; ' + extraCookie : '');
    const r = await fetch(base + '/api' + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    const texto = await r.text(); let datos = null; try { datos = JSON.parse(texto); } catch (_) { datos = texto; }
    return { status: r.status, datos };
  };
  return { get: (r) => pedir('GET', r), post: (r, b) => pedir('POST', r, b || {}), put: (r, b) => pedir('PUT', r, b || {}) };
}

(async () => {
  const limpiar = async () => {
    await q('DELETE FROM tareas_direccion');
    await q('DELETE FROM organigrama_nodos WHERE funciones = ?', [MARCA]);
    await q("DELETE FROM usuarios WHERE numero_identificacion BETWEEN '7190001' AND '7190099' AND es_superadmin = 0");
  };
  await limpiar();
  const rolId = async (n) => (await q('SELECT id FROM roles WHERE nombre = ?', [n]))[0].id;
  let ced = 7190000;
  const usuario = async (nombre, rol, extra = {}) => {
    ced++;
    const [r] = await pool.query(`INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, es_candidato) VALUES (?, ?, ?, ?, ?, 'x', ?, ?, ?)`,
      [nombre, String(ced), String(ced), extra.email || `p${ced}@ejemplo.co`, extra.telefono === undefined ? null : extra.telefono, await rolId(rol), extra.activo === 0 ? 0 : 1, extra.es_candidato ? 1 : 0]);
    return r.insertId;
  };
  const nodo = async (cargo, nombres, apellidos, telefono, nivel, email) => (await pool.query(
    'INSERT INTO organigrama_nodos (cargo, nombres, apellidos, telefono, email, nivel, funciones) VALUES (?, ?, ?, ?, ?, ?, ?)', [cargo, nombres, apellidos, telefono, email || null, nivel, MARCA]))[0].insertId;
  const sup = (await q('SELECT id FROM usuarios WHERE es_superadmin = 1 LIMIT 1'))[0];
  const ids = {
    super: sup.id, cand: await usuario('Juan Pérez Candidato', 'candidato', { telefono: '3009990000' }),
    c1: await usuario('Coordinadora Uno', 'coordinador', { telefono: '3105550001' }),
    c2: await usuario('Coordinador Dos', 'coordinador', { telefono: '3105550002', email: 'dos@ejemplo.co' }),
    c3: await usuario('Coordinadora Tres', 'coordinador', { telefono: '3105550003' }),
    c4: await usuario('JOSEFA MUNOZ', 'coordinador', { telefono: '3105550004' }),
    cInactivo: await usuario('Coordinador Inactivo', 'coordinador', { telefono: '3105550005', activo: 0 }),
    lider: await usuario('Líder Ejemplo', 'lider', { telefono: '3105550006' }), sub: await usuario('Sublíder Ejemplo', 'sublider', { telefono: '3105550007' }),
    admSin: await usuario('Admin Sin Casilla', 'admin'),
  };
  const N = {
    secretario: await nodo('Secretario general', 'Pedro', 'Pérez', '3001110000', 'nivel_1'),
    tesorera: await nodo('Tesorera', 'María', 'Gómez', '3001112233', 'nivel_2'),
    prensa: await nodo('Jefe de prensa', 'Luis', 'Mora', null, 'nivel_3'),
    vacante: await nodo('Cargo vacante', null, null, null, 'nivel_2'),
    porCorreo: await nodo('Director jurídico', 'Un', 'Abogado', null, 'nivel_2', 'DOS@ejemplo.co'),       // es el coordinador Dos (mismo correo, sin celular en el nodo)
    porCelular: await nodo('Jefe de logística', 'Otra', 'Persona', '3105550003', 'nivel_3'),              // es la coordinadora Tres (mismo celular)
    porNombre: await nodo('Jefe de eventos', 'Josefa', 'Muñoz', '3201110000', 'nivel_3'),                 // es la coordinadora «JOSEFA MUNOZ» (mismo nombre, sin tildes ni mayúsculas)
  };
  const salidas = []; T.deps.firma = async () => ' - Equipo (aviso)';
  T.deps.enviarSms = async (celular, texto, o) => { salidas.push({ celular, texto, tareaId: o.tareaId }); return 'sid-' + salidas.length; };
  const fila = async (id) => (await q('SELECT * FROM tareas_direccion WHERE id = ?', [id]))[0];
  const servidor = http.createServer(crearServidor(pool, { soloLecturaCandidato: true }));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const C = { cand: cliente(base, ids.cand), super: cliente(base, ids.super), coord: cliente(base, ids.c1), admSin: cliente(base, ids.admSin) };
  const cuerpo = (extra) => Object.assign({ titulo: 'Entregar la rendición de cuentas', responsable_tipo: 'organigrama', responsable_ref_id: N.tesorera, fecha_limite: dia(10), prioridad: 'normal', aviso_activo: true }, extra);
  const crear = async (extra, cuando) => (await T.crear(cuerpo(extra), ids.cand, { ahora: cuando || en(dia(-5), 10) })).tarea;

  try {
    /* ================================================================================== 1. EL SELECTOR (servidor) */
    console.log('\n[1] /responsables: candidato, «Organigrama» y «Coordinadores», sin duplicados');
    const rp = (await C.cand.get('/tareas-direccion/responsables')).datos;
    ok(Array.isArray(rp.candidato) && rp.candidato.length === 1 && rp.candidato[0].tipo === 'candidato' && rp.candidato[0].ref_id === ids.cand && rp.candidato[0].es_candidato, 'el candidato va aparte y primero', rp.candidato);
    const org = rp.organigrama.filter((x) => Object.values(N).includes(x.ref_id));
    const esperadoOrden = ['Pedro Pérez', 'María Gómez', 'Un Abogado', 'Josefa Muñoz', 'Luis Mora', 'Otra Persona'];   // por nivel (1, 2, 3) y, dentro de cada nivel, por nombre
    ok(JSON.stringify(org.map((x) => x.nombre)) === JSON.stringify(esperadoOrden), '«Organigrama»: todas las personas, por nivel y por nombre', org.map((x) => x.nombre));
    ok(!rp.organigrama.some((x) => x.ref_id === N.vacante), 'un cargo vacante (sin persona) no es un responsable');
    const tes = org.find((x) => x.ref_id === N.tesorera);
    ok(tes.cargo === 'Tesorera' && tes.celular === '3001112233' && tes.tipo === 'organigrama' && tes.nivel === 'nivel_2', 'cada uno trae su cargo del organigrama y su celular a 10 dígitos', tes);
    ok(org.find((x) => x.ref_id === N.prensa).celular === null, 'sin celular en el organigrama: celular null (el formulario lo dice)');
    ok(org.find((x) => x.ref_id === N.porCorreo).celular === '3105550002', 'si el nodo no trae celular pero es también coordinador (mismo correo), sirve el de su ficha');
    const nombresCoord = rp.coordinadores.map((x) => x.nombre);
    ok(JSON.stringify(nombresCoord.filter((n) => /^Coordinad|JOSEFA|Inactivo/.test(n))) === JSON.stringify(['Coordinadora Uno']), '«Coordinadores»: solo los activos que NO están ya en el organigrama (Dos por correo, Tres por celular y Josefa por nombre salen solo en «Organigrama»; el inactivo no sale)', nombresCoord);
    ok(rp.coordinadores.every((x) => x.cargo === 'Coordinador' && x.tipo === 'coordinador'), 'su cargo es «Coordinador»');
    const todos = [].concat(rp.candidato, rp.organigrama, rp.coordinadores);
    ok(!todos.some((x) => [ids.super, ids.lider, ids.sub, ids.admSin, ids.cInactivo].includes(x.usuario_id) || /Líder Ejemplo|Sublíder|Super/.test(x.nombre)), 'no salen el superadministrador, líderes, sublíderes ni administradores sin la casilla');
    const dup = todos.map((x) => x.tipo + ':' + x.ref_id); ok(new Set(dup).size === dup.length, 'ninguna opción repetida');
    ok((await C.coord.get('/tareas-direccion/responsables')).status === 403 && (await C.admSin.get('/tareas-direccion/responsables')).status === 403, 'un coordinador y un administrador sin la casilla no pueden ni pedir la lista (403)');

    /* ================================================================================== 2. LA API RECHAZA LO DEMÁS */
    console.log('\n[2] POST y PUT rechazan (400) lo que no sea candidato, organigrama o coordinador activo');
    const malos = [
      [{ responsable_tipo: undefined, responsable_ref_id: undefined }, 'sin responsable'],
      [{ responsable_tipo: undefined, responsable_ref_id: undefined, responsable_nombre: 'Ana Inventada', responsable_cargo: 'Tesorera', responsable_celular: '3001234567' }, 'un responsable escrito a mano'],
      [{ responsable_ref_id: 99999999 }, 'un nodo inventado'], [{ responsable_ref_id: N.vacante }, 'un cargo vacante'], [{ responsable_ref_id: 'abc' }, 'un id que no es número'],
      [{ responsable_tipo: 'coordinador', responsable_ref_id: ids.lider }, 'un líder'], [{ responsable_tipo: 'coordinador', responsable_ref_id: ids.sub }, 'un sublíder'],
      [{ responsable_tipo: 'coordinador', responsable_ref_id: ids.cInactivo }, 'un coordinador inactivo'], [{ responsable_tipo: 'coordinador', responsable_ref_id: ids.super }, 'el superadministrador'],
      [{ responsable_tipo: 'candidato', responsable_ref_id: ids.c1 }, 'un coordinador haciéndose pasar por el candidato'], [{ responsable_tipo: 'lider', responsable_ref_id: ids.lider }, 'un tipo que no existe'],
    ];
    for (const [extra, que] of malos) {
      const r = await C.cand.post('/tareas-direccion', cuerpo(extra));
      // En el PUT, NO mandar responsable (o mandar nombres a mano) deja al que ya tenía: solo se valida lo que el formulario elige.
      const elige = extra.responsable_tipo !== undefined || extra.responsable_ref_id !== undefined;
      const e = elige ? await C.cand.put('/tareas-direccion/' + (await crear({})).id, cuerpo(extra)) : { status: 400 };
      ok(r.status === 400 && r.datos.error && e.status === 400, `${que}: POST${elige ? ' y PUT' : ''} → 400 con mensaje`, { post: r, put: e.status });
    }
    ok((await q('SELECT COUNT(*) AS n FROM tareas_direccion WHERE titulo = ?', ['Entregar la rendición de cuentas']))[0].n === malos.filter(([x]) => x.responsable_tipo !== undefined || x.responsable_ref_id !== undefined).length, 'y no se guardó ninguna de las rechazadas (solo las que creó la prueba para el PUT)');
    await q('DELETE FROM tareas_direccion');

    /* ================================================================================== 3. EL ORIGEN MANDA */
    console.log('\n[3] El nombre, el cargo y el celular salen del origen, no del cuerpo de la petición');
    const forjada = (await C.cand.post('/tareas-direccion', Object.assign(cuerpo({}), { responsable_nombre: 'Hacker', responsable_cargo: 'Presidente', responsable_celular: '3009998888', responsable_usuario_id: ids.super }))).datos.tarea;
    const ff = await fila(forjada.id);
    ok(forjada.responsable.nombre === 'María Gómez' && forjada.responsable.cargo === 'Tesorera' && forjada.responsable.celular === '3001112233' && ff.responsable_usuario_id === null && ff.responsable_tipo === 'organigrama' && ff.responsable_ref_id === N.tesorera,
      'un nombre, cargo, celular o usuario forjado en el cuerpo se ignora', { forjada: forjada.responsable, ff });
    const tc = await crear({ responsable_tipo: 'coordinador', responsable_ref_id: ids.c1 });
    ok(tc.responsable.nombre === 'Coordinadora Uno' && tc.responsable.cargo === 'Coordinador' && tc.responsable.celular === '3105550001' && tc.canal_previsto === 'sms' && tc.responsable.tipo === 'coordinador' && tc.responsable.usuario_id === ids.c1, 'un coordinador: su cargo es «Coordinador» y el celular, el de su ficha', tc.responsable);
    const tk = await crear({ responsable_tipo: 'candidato', responsable_ref_id: ids.cand });
    ok(tk.responsable.es_candidato && tk.canal_previsto === 'app' && tk.responsable.cargo === 'Candidato' && !tk.responsable.fuera_del_organigrama, 'el candidato: aviso por la app y sin marca', tk.responsable);
    ok(!tes.fuera_del_organigrama && !forjada.responsable.fuera_del_organigrama, 'sin la marca «fuera del organigrama» mientras la persona siga en su origen');

    /* ================================================================================== 4. EL SMS USA EL CELULAR ACTUAL */
    console.log('\n[4] El SMS y el WhatsApp toman el celular ACTUAL de la persona');
    await q('DELETE FROM tareas_direccion'); salidas.length = 0; T.reiniciarMemoria();
    const a = await crear({ titulo: 'Tarea con celular que cambia', fecha_limite: dia(3) });
    const b = await crear({ titulo: 'Tarea de la coordinadora', responsable_tipo: 'coordinador', responsable_ref_id: ids.c1, fecha_limite: dia(3) });
    await q('UPDATE organigrama_nodos SET telefono = ? WHERE id = ?', ['3209998877', N.tesorera]);       // lo corrigieron en el organigrama…
    await q('UPDATE usuarios SET telefono = ? WHERE id = ?', ['3114445566', ids.c1]);                       // …y en Estructura / el usuario, sin editar las tareas
    ok((await C.cand.get('/tareas-direccion/' + a.id)).datos.tarea.responsable.celular === '3209998877', 'la tarea ya muestra el celular nuevo (sin editarla)');
    await T.vueltaAvisos({ ahora: en(D, 8) });
    const sa = salidas.find((s) => s.tareaId === a.id); const sb = salidas.find((s) => s.tareaId === b.id);
    ok(sa && sa.celular === '3209998877' && sb && sb.celular === '3114445566', 'el SMS sale al celular de HOY: el nuevo del organigrama y el nuevo de la ficha del coordinador (no a la copia vieja)', salidas);
    ok((await fila(a.id)).responsable_celular === '3209998877', 'la copia de respaldo se pone al día');
    const wa = await T.registrarWhatsapp(a.id, ids.cand, { ahora: en(D, 9) });
    ok(wa.url && wa.url.startsWith('https://wa.me/573209998877?text=') && /Hola%20Mar%C3%ADa/.test(wa.url), 'el WhatsApp también usa el celular y el nombre de hoy', wa);
    await q('UPDATE organigrama_nodos SET telefono = ? WHERE id = ?', ['3001112233', N.tesorera]); await q('UPDATE usuarios SET telefono = ? WHERE id = ?', ['3105550001', ids.c1]);

    /* ================================================================================== 5. SIN CELULAR SE RECUPERA SOLO */
    console.log('\n[5] «Sin celular» vuelve a «programado» cuando le agregan el celular');
    await q('DELETE FROM tareas_direccion'); salidas.length = 0; T.reiniciarMemoria();
    const sc = await crear({ titulo: 'Para alguien sin celular', responsable_ref_id: N.prensa, fecha_limite: dia(8) });
    ok(sc.aviso_estado === 'sin_celular' && sc.canal_previsto === null, 'sin celular en el organigrama: el aviso nace «sin_celular»', sc);
    ok((await C.cand.post('/tareas-direccion/' + sc.id + '/whatsapp')).status === 400, 'y no hay WhatsApp (400)');
    await q('UPDATE organigrama_nodos SET telefono = ? WHERE id = ?', ['3157778899', N.prensa]);
    const v1 = await T.vueltaAvisos({ ahora: en(dia(-3), 8) });
    const fsc = await fila(sc.id);
    ok(v1.recuperadas === 1 && fsc.aviso_estado === 'programado' && fsc.aviso_para === dia(5), 'al agregarle el celular en el organigrama, la vuelta diaria lo recupera: «programado» para el día que toca, sin editar la tarea', { v1, fsc });
    await T.vueltaAvisos({ ahora: en(dia(5), 8) });
    ok(salidas.length === 1 && salidas[0].celular === '3157778899', 'y sale el SMS', salidas);
    await q('UPDATE organigrama_nodos SET telefono = NULL WHERE id = ?', [N.prensa]);

    /* ================================================================================== 6. SE BORRA DEL ORGANIGRAMA / DEJA DE SER COORDINADOR */
    console.log('\n[6] La persona se borra del organigrama o deja de ser coordinador: la tarea sigue, con la marca');
    await q('DELETE FROM tareas_direccion'); salidas.length = 0; T.reiniciarMemoria();
    const nBorrable = await nodo('Cargo que se borra', 'Persona', 'Temporal', '3012223344', 'nivel_3');
    const cTemporal = await usuario('Coordinador Temporal', 'coordinador', { telefono: '3012225566' });
    const t1 = await crear({ titulo: 'De quien saldrá del organigrama', responsable_ref_id: nBorrable, fecha_limite: dia(3) });
    const t2 = await crear({ titulo: 'De quien dejará de ser coordinador', responsable_tipo: 'coordinador', responsable_ref_id: cTemporal, fecha_limite: dia(3) });
    ok(t1.aviso_estado === 'programado' && t2.aviso_estado === 'programado', 'antes: las dos con su aviso programado');
    await q('DELETE FROM organigrama_nodos WHERE id = ?', [nBorrable]); await q('UPDATE usuarios SET activo = 0 WHERE id = ?', [cTemporal]);
    const lista = (await C.cand.get('/tareas-direccion')).datos.tareas;
    const l1 = lista.find((x) => x.id === t1.id); const l2 = lista.find((x) => x.id === t2.id);
    ok(l1 && l2 && l1.responsable.fuera_del_organigrama && l2.responsable.fuera_del_organigrama && l1.responsable.nombre === 'Persona Temporal' && l1.responsable.celular === null && l1.canal_previsto === null, 'las dos siguen en el tablero, con la marca «fuera del organigrama» y conservando su nombre', { l1: l1 && l1.responsable, l2: l2 && l2.responsable });
    const v2 = await T.vueltaAvisos({ ahora: en(D, 8) });
    ok(salidas.length === 0 && v2.sin_celular === 2 && (await fila(t1.id)).aviso_estado === 'sin_celular' && (await fila(t2.id)).aviso_estado === 'sin_celular', 'el día del aviso no sale nada y las dos quedan «sin_celular»', { v2, salidas });
    const e1 = await C.cand.put('/tareas-direccion/' + t1.id, { titulo: 'Se puede renombrar eligiendo otro', responsable_tipo: 'organigrama', responsable_ref_id: N.tesorera });
    ok(e1.status === 200 && !e1.datos.tarea.responsable.fuera_del_organigrama && e1.datos.tarea.responsable.nombre === 'María Gómez', 'eligiendo a otra persona de la lista, la marca desaparece');
    await q('DELETE FROM usuarios WHERE id = ?', [cTemporal]);

    /* ================================================================================== 7. LAS TAREAS ANTIGUAS */
    console.log('\n[7] Tareas de antes (responsable escrito a mano): se conservan, con la marca, y obligan a elegir de la lista');
    await q('DELETE FROM tareas_direccion'); salidas.length = 0; T.reiniciarMemoria();
    const ins = async (titulo, nombre, cargo, cel, uid) => (await pool.query(
      `INSERT INTO tareas_direccion (titulo, responsable_usuario_id, responsable_nombre, responsable_cargo, responsable_celular, fecha_limite, prioridad, estado, aviso_activo, aviso_estado, aviso_para, creada_en)
       VALUES (?, ?, ?, ?, ?, ?, 'normal', 'pendiente', 1, 'programado', ?, NOW())`, [titulo, uid || null, nombre, cargo, cel, dia(3), D]))[0].insertId;
    const vieja = await ins('Antigua escrita a mano', 'Carlos a Mano', 'Tesorero', '3001230000');
    const viejaLider = await ins('Antigua con un líder', 'Líder Ejemplo', 'Líder', '3105550006', ids.lider);
    const viejaCoord = await ins('Antigua con un coordinador', 'Coordinadora Uno', 'Coordinador', '3105550001', ids.c1);
    const viejaCand = await ins('Antigua con el candidato', 'Juan Pérez Candidato', 'Candidato', null, ids.cand);
    const salida = execFileSync(process.execPath, [path.join(RAIZ, 'db/init-db.js')], { env: process.env, encoding: 'utf8', timeout: 240000 });
    const resumen = /Tareas de dirección: responsable enlazado[^\n]*/.exec(salida);
    ok(!!resumen, 'init-db dice cuántas enlazó y cuántas quedaron escritas a mano', resumen && resumen[0]);
    const fv = await Promise.all([vieja, viejaLider, viejaCoord, viejaCand].map(fila));
    ok(fv[0].responsable_tipo === null && fv[1].responsable_tipo === null && fv[2].responsable_tipo === 'coordinador' && fv[2].responsable_ref_id === ids.c1 && fv[3].responsable_tipo === 'candidato' && fv[3].responsable_ref_id === ids.cand,
      'la migración enlaza las del candidato y de coordinadores a su origen; las escritas a mano y la del líder NO (no se inventa un origen)', fv.map((f) => [f.responsable_tipo, f.responsable_ref_id]));
    ok(!(await C.cand.get('/tareas-direccion')).datos.tareas.some((t) => !t.responsable.nombre), 'no se borra nada: las cuatro siguen');
    const lv = (await C.cand.get('/tareas-direccion')).datos.tareas;
    ok(lv.find((t) => t.id === vieja).responsable.fuera_del_organigrama && lv.find((t) => t.id === viejaLider).responsable.fuera_del_organigrama && !lv.find((t) => t.id === viejaCoord).responsable.fuera_del_organigrama && !lv.find((t) => t.id === viejaCand).responsable.fuera_del_organigrama,
      'llevan la marca las escritas a mano y la del líder; no las enlazadas', lv.map((t) => [t.id, t.responsable.fuera_del_organigrama]));
    const rem = await C.cand.put('/tareas-direccion/' + vieja, { titulo: 'Cambio solo el título' });
    ok(rem.status === 400 && /fuera del organigrama/.test(rem.datos.error), 'editar una antigua SIN elegir responsable → 400: obliga a elegir de la lista', rem);
    const rem2 = await C.cand.put('/tareas-direccion/' + vieja, { titulo: 'Cambio solo el título', responsable_tipo: 'organigrama', responsable_ref_id: N.secretario });
    ok(rem2.status === 200 && rem2.datos.tarea.responsable.nombre === 'Pedro Pérez' && !rem2.datos.tarea.responsable.fuera_del_organigrama, 'eligiendo a alguien de la lista, se guarda y la marca desaparece', rem2.datos);
    const mover = await C.cand.post('/tareas-direccion/' + viejaLider + '/whatsapp');
    ok(mover.status === 200 && mover.datos.url.includes('573105550006'), 'mientras no se edite, una antigua sigue usando el celular que se escribió (el aviso no se rompe)', mover.datos);
    await T.vueltaAvisos({ ahora: en(D, 8) });
    ok(salidas.some((s) => s.tareaId === viejaLider && s.celular === '3105550006'), 'y su aviso automático sale como antes', salidas);

    /* ================================================================================== 8. PANTALLAS */
    console.log('\n[8] El selector en Chromium: escritorio 1280 y celular 390×844');
    await q('DELETE FROM tareas_direccion'); T.reiniciarMemoria();
    const insVieja = await ins('Tarea antigua con la marca', 'Carlos a Mano', 'Tesorero', '3001230000');
    await crear({ titulo: 'Tarea normal del organigrama', fecha_limite: dia(20) });
    const navegador = await lanzar();
    const p = await navegador.pagina('about:blank');
    await p.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; const ce = console.error; console.error = function () { window.__errs.push([].slice.call(arguments).join(' ')); ce.apply(console, arguments); }; window.addEventListener('error', (e) => window.__errs.push('ERR ' + e.message)); window.addEventListener('unhandledrejection', (e) => window.__errs.push('PROM ' + (e.reason && e.reason.message || e.reason)));` });
    const ev = (x) => p.ev(x);
    const vista = async (w, h, movil) => p.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: movil ? 2 : 1, mobile: !!movil });
    const entrarComo = async (id) => p.cmd('Network.setCookie', { name: 'ej_usuario', value: String(id), url: base });
    const ir = async (ruta, ms = 2200) => { await p.cmd('Page.navigate', { url: base + ruta }); await espera(ms); };
    const clic = async (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
    const texto = async (sel) => ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
    const foto = async (nombre) => { const r = await p.cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SALIDA, nombre + '.png'), Buffer.from(r.result.data, 'base64')); };
    const buscar = async (t) => ev(`(() => { const b = document.querySelector('#tdf-buscar'); b.value = ${JSON.stringify(t)}; b.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    const opciones = () => ev(`[...document.querySelectorAll('#tdf-lista li')].map((li) => li.classList.contains('grupo') ? '[' + li.textContent + ']' : li.textContent.trim())`);
    const sinDesborde = (raiz) => ev(`(() => { const r = document.querySelector(${JSON.stringify(raiz)}); const a = r.getBoundingClientRect(); return [...r.querySelectorAll('*')].every((e) => { const x = e.getBoundingClientRect(); return !x.width || (x.right <= a.right + 1 && x.left >= a.left - 1); }) && document.documentElement.scrollWidth <= window.innerWidth + 1; })()`);

    // ----- escritorio (superadministrador)
    await vista(1280, 900, false); await entrarComo(ids.super); await ir('/tareas-direccion.html', 2800);
    const cargoFuera = await ev(`(() => { const c = [...document.querySelectorAll('.td-card')].find((x) => /Tarea antigua con la marca/.test(x.textContent)); return c ? c.querySelector('.cargo').textContent.trim() : null; })()`);
    ok(cargoFuera === '⚠ Responsable fuera del organigrama', 'la tarjeta de una tarea antigua lleva «⚠ Responsable fuera del organigrama» en vez del cargo', cargoFuera);
    ok(await ev(`(() => { const hs = [...document.querySelectorAll('.td-card')].map((c) => c.getBoundingClientRect().height); return Math.max(...hs) - Math.min(...hs) <= 1; })()`), 'y las tarjetas siguen midiendo lo mismo (la marca no rompe la alineación)');
    await clic('#btn-nueva'); await espera(900);
    ok(await ev(`!document.querySelector('#tdf-nombre') && !document.querySelector('#tdf-resp[type=text]') && document.querySelector('#tdf-cargo').readOnly && document.querySelector('#tdf-cel').readOnly`), 'el formulario no tiene dónde escribir un responsable: cargo y celular en solo lectura');
    await clic('#tdf-resp'); await espera(250);
    const l0 = await opciones();
    const iOrg = l0.indexOf('[Organigrama]'); const iCoord = l0.indexOf('[Coordinadores]');
    ok(l0[0] === 'Candidato · Juan Pérez Candidato' && iOrg === 1 && iCoord > iOrg && l0.length > 3, 'selector abierto: el candidato arriba (sin título), luego «Organigrama» y luego «Coordinadores»', l0);
    ok(l0[iOrg + 1] === 'Secretario general · Pedro Pérez' && l0.includes('Tesorera · María Gómez') && l0.slice(iCoord + 1).join('|') === 'Coordinador · Coordinadora Uno' && !l0.some((o) => /Escribir otra|Inactivo|Líder|Sublíder|Vacante/i.test(o)),
      'el organigrama por nivel con «Cargo · Nombre»; «Coordinadores» sin los que ya están en el organigrama; nada de «Escribir otra persona»', l0);
    ok(await sinDesborde('#form-cuerpo'), 'sin desbordes con la lista abierta (escritorio)');
    await foto('1-selector-escritorio');
    await buscar('tesor');
    ok(JSON.stringify(await opciones()) === JSON.stringify(['[Organigrama]', 'Tesorera · María Gómez']), 'el buscador filtra por CARGO («tesor»)');
    await buscar('muñoz');
    ok(JSON.stringify(await opciones()) === JSON.stringify(['[Organigrama]', 'Jefe de eventos · Josefa Muñoz']), 'y por NOMBRE, sin importar tildes ni mayúsculas («muñoz» encuentra a Josefa Muñoz)');
    await buscar('zzzz');
    ok(/Nadie coincide con «zzzz»/.test(await texto('#tdf-lista')), 'sin coincidencias lo dice');
    await buscar('prensa');
    await ev(`(() => { const b = document.querySelector('#tdf-buscar'); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`); await espera(250);
    const sel = await ev(`({ btn: document.querySelector('#tdf-resp-txt').textContent, cargo: document.querySelector('#tdf-cargo').value, cel: document.querySelector('#tdf-cel').value, aviso: document.querySelector('#tdf-sincel').textContent, visible: !document.querySelector('#tdf-sincel').hidden, cerrado: document.querySelector('#tdf-panel').hidden })`);
    ok(sel.btn === 'Jefe de prensa · Luis Mora' && sel.cargo === 'Jefe de prensa' && sel.cel === '—' && sel.visible && sel.aviso === 'Sin celular registrado: no habrá SMS ni WhatsApp. Agréguelo en el organigrama o en Estructura.' && sel.cerrado,
      'con el teclado (flecha + Enter) elige a alguien sin celular: el formulario dice «Sin celular registrado: no habrá SMS ni WhatsApp. Agréguelo en el organigrama o en Estructura.»', sel);
    await ev(`(() => { const f = document.querySelector('#tdf-fecha'); f.value = '${dia(20)}'; f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    ok(/Sin celular registrado: no habrá SMS ni WhatsApp/.test(await texto('#tdf-frase')), 'y la frase del aviso (con la fecha elegida) dice lo mismo');
    await clic('#tdf-resp'); await espera(200); await ev(`(() => { document.querySelector('#tdf-buscar').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`); await espera(200);
    ok(await ev(`document.querySelector('#tdf-panel').hidden && document.activeElement.id === 'tdf-resp'`), 'Escape cierra la lista y devuelve el foco al botón');
    await clic('#tdf-resp'); await espera(200); await buscar('coordinadora uno'); await ev(`document.querySelector('#tdf-lista [role=option]').click()`); await espera(250);
    const coord = await ev(`({ cargo: document.querySelector('#tdf-cargo').value, cel: document.querySelector('#tdf-cel').value, oculto: document.querySelector('#tdf-sincel').hidden })`);
    ok(coord.cargo === 'Coordinador' && coord.cel === '310 555 0001' && coord.oculto, 'un coordinador: cargo «Coordinador», su celular y sin aviso de «sin celular»', coord);
    await foto('2-formulario-coordinador-escritorio');
    await clic('#form-cancelar'); await espera(300);
    // la tarea antigua: marca en el detalle y en el formulario
    await clic(`.td-card[data-id="${insVieja}"]`); await espera(800);
    ok(/Responsable fuera del organigrama/.test(await texto('#det-cuerpo')), 'el detalle de una antigua repite la marca');
    await clic('#det-pie [data-d="editar"]'); await espera(900);
    ok(/Responsable fuera del organigrama: Carlos a Mano \(Tesorero\)/.test(await texto('#tdf-fuera')) && /Elija al responsable/.test(await texto('#tdf-resp-txt')), 'al editarla, el formulario muestra quién era y pide elegir a alguien de la lista');
    await clic('#form-guardar'); await espera(500);
    ok(/Elija al responsable de la lista/.test(await texto('#tdf-error')) && await ev(`document.querySelector('#ov-form').classList.contains('abierto')`), 'guardar sin elegir no cierra y lo dice');
    await foto('3-antigua-formulario-escritorio');
    await clic('#tdf-resp'); await espera(200); await buscar('secretario'); await ev(`document.querySelector('#tdf-lista [role=option]').click()`); await espera(250);
    await clic('#form-guardar'); await espera(1200);
    const g = await fila(insVieja);
    ok(g.responsable_tipo === 'organigrama' && g.responsable_ref_id === N.secretario && g.responsable_nombre === 'Pedro Pérez', 'eligiendo a alguien y guardando, la tarea queda con su responsable del organigrama', g);
    ok((await ev('(window.__errs || []).slice()')).length === 0, 'cero errores de consola en escritorio', await ev('(window.__errs || []).slice()'));

    // ----- celular (candidato)
    await vista(390, 844, true); await entrarComo(ids.cand); await ir('/app/candidato-tareas.html', 2800);
    await clic('#btn-nueva'); await espera(900);
    await clic('#tdf-resp'); await espera(300);
    const m0 = await opciones();
    ok(m0[0] === 'Yo (candidato)' && m0[1] === '[Organigrama]' && m0.includes('[Coordinadores]'), 'celular: «Yo (candidato)» arriba, luego «Organigrama» y «Coordinadores»', m0);
    ok(await ev(`parseFloat(getComputedStyle(document.querySelector('#tdf-buscar')).fontSize) >= 16 && parseFloat(getComputedStyle(document.querySelector('#tdf-resp')).fontSize) >= 16`), 'el buscador y el botón del selector tienen letra de 16 px (el teléfono no hace «zoom»)');
    ok(await sinDesborde('#pant-form'), 'sin desbordes con la lista abierta (celular 390 px)');
    await foto('4-selector-celular');
    await buscar('luis'); await ev(`document.querySelector('#tdf-lista [role=option]').click()`); await espera(300);
    ok(/Sin celular registrado: no habrá SMS ni WhatsApp\. Agréguelo en el organigrama o en Estructura\./.test(await texto('#tdf-sincel')), 'celular: elegir a alguien sin celular lo dice');
    await foto('5-formulario-sin-celular-celular');
    ok((await ev('(window.__errs || []).slice()')).length === 0, 'cero errores de consola en el celular', await ev('(window.__errs || []).slice()'));
    navegador.cerrar();
  } finally {
    try { await limpiar(); } catch (_) { /* nada */ }
    servidor.close(); await pool.end();
  }
  console.log(fallos ? `\nFALLÓ: ${fallos} de ${pasos} comprobaciones.` : `\nTODO BIEN: ${pasos} de ${pasos} comprobaciones. Capturas en ${SALIDA}`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
