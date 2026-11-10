/**
 * Resultados del Día D (fase 3): consolidado por puesto, resultado OFICIAL digitado mesa por
 * mesa, diferencias contra lo que dijo el testigo, y el paquete ZIP para el abogado.
 * Montado en /api/dia-d/resultados.
 *
 * POR QUÉ CUELGA DE /dia-d: `restringirAspirante` (middleware/aspirante.js) deja pasar a un
 * aspirante por prefijos de ruta y /dia-d ya es suyo.
 *
 * DE QUÉ CAMPAÑA ES CADA COSA. Todo se acota igual que el tablero del Día D, con las MISMAS
 * funciones (se importan de routes/diaD.routes.js, no se copian):
 *   · los puestos y los candidatos, por `aspirante_id` = `duenoDeLaCampana(req)`;
 *   · los reportes, por quien los firma (`acotaJornada`).
 * El resultado oficial y la revisión de mesas llevan ese mismo `aspirante_id`.
 *
 * «EL ÚLTIMO REPORTE DE CADA MESA» es el que cuenta (la misma regla de /reportes, /resumen y
 * /rendimiento-candidato), pero la mesa se identifica por el PUESTO RESUELTO (lib/puestosDiaD.js),
 * no por el texto: el mismo puesto escrito de dos maneras es un solo puesto.
 *
 * EL CANDIDATO PROPIO sale de `nombreDelCandidatoPropio` (el mismo de /resumen-candidatos y de
 * /rendimiento-candidato): la configuración de la campaña para la madre, el nombre del
 * aspirante para su rama. Se compara por nombre normalizado; si no coincide con ninguno de la
 * hoja, el consolidado lo dice (propio = null) en vez de inventar un cero.
 */
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { requiereVerModulo } = require('../middleware/permisoModulo');
const { requiereComplemento } = require('../middleware/complemento');
const { registrarAuditoria, registrarAuditoriaEn } = require('../config/auditoria');
const { UPLOAD_DIA_D_DIR } = require('../middleware/upload');
const diaD = require('./diaD.routes').compartido;
const { crearResolutorDePuestos, cargarMunicipios, normalizar } = require('../lib/puestosDiaD');

const router = express.Router();
router.use(requireAuth, requiereComplemento('resultados_dia_d'), requiereVerModulo('resultados_dia_d', { aspirante: true }));

const FUENTES = ['preconteo', 'escrutinio'];
const ESTADOS = ['para_reclamar', 'revisada'];
const SIN_MUNICIPIO = 'Sin municipio';
const FUERA_DE_LISTA = 'Fuera de lista';
const PAQUETES_DIR = path.join(UPLOAD_DIA_D_DIR, 'paquetes');
const HORAS_DE_VIDA_PAQUETE = 24;
const TOPE_VOTOS = 10000000;

/* ——— La jornada de esta campaña, ya cargada ——————————————————————————————— */
/* `conVotos: false` se salta los votos de cada reporte (la consulta más pesada): lo usa el cuadro de alertas, que se
   recalcula cada 30 segundos y sólo necesita QUÉ reportes hay, no cuántos votos trae cada uno. */
async function cargarJornada(req, { conVotos = true } = {}) {
  const dueno = await diaD.duenoDeLaCampana(req);
  const aFuera = await diaD.acotaJornada(req, 'r.testigo_id');
  const [puestos] = await pool.query(
    `SELECT id, nombre, cantidad_mesas, ctc_puesto_id FROM dia_d_puestos_votacion
      WHERE aspirante_id = ? ORDER BY nombre`, [dueno]);
  const resolver = crearResolutorDePuestos(puestos);
  const municipios = await cargarMunicipios(pool, puestos);
  const [reportes] = await pool.query(
    `SELECT r.id, r.testigo_id, r.puesto_id, r.puesto_votacion, r.mesa_votacion AS mesa, r.alertas,
            r.created_at, (r.foto_e14_url IS NOT NULL) AS tiene_foto, u.nombre AS testigo_nombre,
            u.telefono AS testigo_telefono
       FROM dia_d_reportes r JOIN usuarios u ON u.id = r.testigo_id
      ${aFuera ? 'WHERE ' + aFuera.sql : ''}
      ORDER BY r.id`, aFuera ? aFuera.valores : []);

  // El ÚLTIMO reporte de cada mesa, con la mesa identificada por el puesto resuelto.
  const vigentes = new Map();
  for (const r of reportes) {
    r.g = resolver(r);
    r.mesa = Number(r.mesa);
    vigentes.set(`${r.g.clave}|${r.mesa}`, r);
  }

  const [hoja] = await pool.query(
    `SELECT nombre, grupo FROM dia_d_candidatos WHERE aspirante_id = ? ${diaD.ORDEN_CANDIDATOS}`, [dueno]);
  const grupoDeLaHoja = new Map(hoja.map(h => [normalizar(h.nombre), h.grupo]));

  // Los votos de los reportes vigentes, en pocas consultas.
  const votosPor = new Map();
  const ids = conVotos ? [...vigentes.values()].map(r => r.id) : [];
  for (let i = 0; i < ids.length; i += 1000) {
    const [filas] = await pool.query(
      `SELECT reporte_id, candidato_nombre, votos, grupo FROM dia_d_reporte_votos WHERE reporte_id IN (?)`,
      [ids.slice(i, i + 1000)]);
    for (const f of filas) {
      if (!votosPor.has(f.reporte_id)) votosPor.set(f.reporte_id, []);
      votosPor.get(f.reporte_id).push({
        nombre: f.candidato_nombre, norm: normalizar(f.candidato_nombre), votos: Number(f.votos),
        // El bloque guardado al reportar; en los reportes viejos (NULL) se deduce por nombre.
        grupo: f.grupo || grupoDeLaHoja.get(normalizar(f.candidato_nombre)) || 'candidato',
      });
    }
  }
  const propioNombre = await diaD.nombreDelCandidatoPropio(req);
  return {
    dueno, puestos, resolver, municipios, vigentes, votosPor, hoja, grupoDeLaHoja,
    propio: normalizar(propioNombre), propioNombre,
  };
}

function municipioDe(j, g) {
  if (g.fuera || !g.puesto) return { municipio: SIN_MUNICIPIO, departamento: '' };
  return j.municipios.get(Number(g.puesto.id)) || { municipio: SIN_MUNICIPIO, departamento: '' };
}

const esBlanco = (n) => /BLANCO/.test(n);
const esNulo = (n) => /NULO/.test(n);
const esNoMarcado = (n) => /NO MARCAD/.test(n);

/* ——— CONSOLIDADO ————————————————————————————————————————————————————— */
function construirConsolidado(j, { municipio, soloAlertas }) {
  // Totales por candidato del tarjetón en TODA la campaña: de ahí salen los dos rivales.
  const porCandidato = new Map();
  for (const r of j.vigentes.values()) {
    for (const v of j.votosPor.get(r.id) || []) {
      if (v.grupo !== 'candidato') continue;
      const e = porCandidato.get(v.norm) || { nombre: v.nombre, norm: v.norm, votos: 0 };
      e.votos += v.votos;
      porCandidato.set(v.norm, e);
    }
  }
  const rivales = [...porCandidato.values()].filter(c => c.norm !== j.propio)
    .sort((a, b) => b.votos - a.votos || a.nombre.localeCompare(b.nombre)).slice(0, 2);
  const normRival = [rivales[0] ? rivales[0].norm : null, rivales[1] ? rivales[1].norm : null];

  const nueva = (base) => ({
    ...base, mesas_reportadas: 0, propio: 0, rival1: 0, rival2: 0, blanco: 0, nulos: 0, no_marcados: 0, alertas: 0,
  });
  const filas = new Map();
  for (const p of j.puestos) {
    const m = municipioDe(j, { puesto: p, fuera: false });
    filas.set(`p${p.id}`, nueva({
      puesto_id: p.id, puesto: p.nombre, municipio: m.municipio, departamento: m.departamento,
      mesas_total: Number(p.cantidad_mesas) || 0,
    }));
  }
  const fuera = nueva({ puesto_id: null, puesto: FUERA_DE_LISTA, municipio: '', departamento: '', mesas_total: null, textos: new Set() });

  for (const r of j.vigentes.values()) {
    const fila = r.g.fuera ? fuera : filas.get(r.g.clave);
    if (!fila) continue;
    if (r.g.fuera) fuera.textos.add(r.g.nombre);
    fila.mesas_reportadas++;
    if (r.alertas) fila.alertas++;
    for (const v of j.votosPor.get(r.id) || []) {
      if (v.grupo === 'candidato') {
        if (v.norm === j.propio) fila.propio += v.votos;
        else if (v.norm === normRival[0]) fila.rival1 += v.votos;
        else if (v.norm === normRival[1]) fila.rival2 += v.votos;
      } else if (esBlanco(v.norm)) fila.blanco += v.votos;
      else if (esNulo(v.norm)) fila.nulos += v.votos;
      else if (esNoMarcado(v.norm)) fila.no_marcados += v.votos;
    }
  }

  const todas = [...filas.values()];
  const sumar = (lista, k) => lista.reduce((s, f) => s + (Number(f[k]) || 0), 0);
  const conFuera = [...todas, fuera];
  const totales = {
    mesas_total: sumar(todas, 'mesas_total'), mesas_reportadas: sumar(conFuera, 'mesas_reportadas'),
    propio: sumar(conFuera, 'propio'), rival1: sumar(conFuera, 'rival1'), rival2: sumar(conFuera, 'rival2'),
    blanco: sumar(conFuera, 'blanco'), nulos: sumar(conFuera, 'nulos'),
    no_marcados: sumar(conFuera, 'no_marcados'), alertas: sumar(conFuera, 'alertas'),
  };

  const municipiosDisponibles = [...new Set(todas.map(f => f.municipio))]
    .sort((a, b) => (a === SIN_MUNICIPIO) - (b === SIN_MUNICIPIO) || a.localeCompare(b));
  let vista = todas;
  if (municipio) vista = vista.filter(f => normalizar(f.municipio) === normalizar(municipio));
  if (soloAlertas) vista = vista.filter(f => f.alertas > 0);
  const incluirFuera = !municipio && (!soloAlertas || fuera.alertas > 0) && fuera.mesas_reportadas > 0;

  return {
    candidatos: {
      propio: j.propioNombre || null,
      rival1: rivales[0] ? rivales[0].nombre : null,
      rival2: rivales[1] ? rivales[1].nombre : null,
    },
    municipios: municipiosDisponibles,
    filas: vista,
    fuera_de_lista: incluirFuera ? { ...fuera, textos: [...fuera.textos] } : null,
    totales,
  };
}

router.get('/consolidado', async (req, res) => {
  try {
    const j = await cargarJornada(req);
    res.json(construirConsolidado(j, {
      municipio: String(req.query.municipio || '').trim(),
      soloAlertas: req.query.solo_alertas === '1',
    }));
  } catch (err) {
    console.error('resultados/consolidado:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo armar el consolidado.' });
  }
});

router.get('/consolidado/excel', async (req, res) => {
  try {
    const j = await cargarJornada(req);
    const c = construirConsolidado(j, {
      municipio: String(req.query.municipio || '').trim(),
      soloAlertas: req.query.solo_alertas === '1',
    });
    const col = ['Puesto', 'Municipio', 'Departamento', 'Mesas del puesto', 'Mesas reportadas',
      c.candidatos.propio || 'Candidato propio', c.candidatos.rival1 || 'Rival 1', c.candidatos.rival2 || 'Rival 2',
      'Voto en blanco', 'Nulos', 'No marcados', 'Mesas con alertas'];
    const fila = (f) => [f.puesto, f.municipio, f.departamento, f.mesas_total === null ? '' : f.mesas_total,
      f.mesas_reportadas, f.propio, f.rival1, f.rival2, f.blanco, f.nulos, f.no_marcados, f.alertas];
    const datos = [col, ...c.filas.map(fila)];
    if (c.fuera_de_lista) datos.push(fila({ ...c.fuera_de_lista, puesto: `${FUERA_DE_LISTA} (${c.fuera_de_lista.textos.join('; ')})` }));
    const t = c.totales;
    datos.push(['TOTAL GENERAL', '', '', t.mesas_total, t.mesas_reportadas, t.propio, t.rival1, t.rival2, t.blanco, t.nulos, t.no_marcados, t.alertas]);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(datos), 'Consolidado');
    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="consolidado-dia-d.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error('resultados/consolidado/excel:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo exportar el consolidado.' });
  }
});

/* ——— RESULTADO OFICIAL ——————————————————————————————————————————————— */
async function cargarOficial(j, fuente = null) {
  const [filas] = await pool.query(
    `SELECT puesto_id, puesto_texto, mesa, candidato_nombre, grupo, votos, fuente
       FROM dia_d_resultado_oficial WHERE aspirante_id = ? ${fuente ? 'AND fuente = ?' : ''}`,
    fuente ? [j.dueno, fuente] : [j.dueno]);
  for (const f of filas) {
    f.g = j.resolver({ puesto_id: f.puesto_id, puesto_votacion: f.puesto_texto });
    f.mesa = Number(f.mesa);
    f.norm = normalizar(f.candidato_nombre);
    f.votos = Number(f.votos);
  }
  return filas;
}

/** El puesto que pide una ruta: por `puesto_id` de la lista, o por texto (lista o fuera de lista). */
function puestoPedido(j, { puesto_id, puesto_texto }) {
  const id = Number(puesto_id);
  if (id) {
    const p = j.puestos.find(x => x.id === id);
    if (!p) return null;
    return j.resolver({ puesto_id: p.id, puesto_votacion: p.nombre });
  }
  const t = String(puesto_texto || '').trim();
  if (!t) return null;
  return j.resolver({ puesto_votacion: t });
}

const textoDelPuesto = (g) => (g.puesto ? g.puesto.nombre : g.nombre);

router.get('/mesa', async (req, res) => {
  const mesa = Number(req.query.mesa);
  const fuente = String(req.query.fuente || '');
  if (!FUENTES.includes(fuente)) return res.status(400).json({ error: 'Elija la fuente: preconteo o escrutinio.' });
  if (!Number.isInteger(mesa) || mesa < 1) return res.status(400).json({ error: 'Indique la mesa.' });
  try {
    const j = await cargarJornada(req);
    const g = puestoPedido(j, req.query);
    if (!g) return res.status(400).json({ error: 'Indique un puesto de la lista de la campaña.' });
    const testigo = j.vigentes.get(`${g.clave}|${mesa}`) || null;
    const votosTestigo = new Map((testigo ? j.votosPor.get(testigo.id) || [] : []).map(v => [v.norm, v]));
    const oficial = (await cargarOficial(j, fuente)).filter(f => f.g.clave === g.clave && f.mesa === mesa);
    const votosOficial = new Map(oficial.map(f => [f.norm, f]));

    // La lista que se ve: la hoja de candidatos, en su orden, y detrás lo que aparece en el
    // reporte o en el oficial y la hoja no tiene (un candidato renombrado después de la jornada).
    const vistos = new Set();
    const candidatos = [];
    const agregar = (nombre, grupo) => {
      const norm = normalizar(nombre);
      if (vistos.has(norm)) return;
      vistos.add(norm);
      const t = votosTestigo.get(norm), o = votosOficial.get(norm);
      candidatos.push({
        nombre, grupo: grupo || (t && t.grupo) || (o && o.grupo) || 'candidato',
        testigo: t ? t.votos : null, oficial: o ? o.votos : null, es_propio: norm === j.propio,
      });
    };
    j.hoja.forEach(h => agregar(h.nombre, h.grupo));
    votosTestigo.forEach(v => agregar(v.nombre, v.grupo));
    oficial.forEach(f => agregar(f.candidato_nombre, f.grupo));

    res.json({
      puesto: { id: g.puesto ? g.puesto.id : null, nombre: g.nombre, fuera_de_lista: g.fuera,
                cantidad_mesas: g.puesto ? Number(g.puesto.cantidad_mesas) : null,
                municipio: municipioDe(j, g).municipio },
      mesa, fuente,
      reporte: testigo ? {
        id: testigo.id, testigo: testigo.testigo_nombre, hora: testigo.created_at,
        alertas: testigo.alertas || null, tiene_foto: !!testigo.tiene_foto,
        foto_ruta: testigo.tiene_foto ? `/api/dia-d/reportes/${testigo.id}/foto` : null,
      } : null,
      hay_oficial: oficial.length > 0,
      candidatos,
    });
  } catch (err) {
    console.error('resultados/mesa:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo cargar la mesa.' });
  }
});

/** Las mesas de un puesto de la lista que todavía no tienen oficial en esa fuente. */
router.get('/pendientes', async (req, res) => {
  const fuente = String(req.query.fuente || '');
  if (!FUENTES.includes(fuente)) return res.status(400).json({ error: 'Elija la fuente: preconteo o escrutinio.' });
  try {
    const j = await cargarJornada(req);
    const g = puestoPedido(j, req.query);
    if (!g || !g.puesto) return res.json({ mesas: [], cantidad_mesas: null });
    const cargadas = new Set((await cargarOficial(j, fuente)).filter(f => f.g.clave === g.clave).map(f => f.mesa));
    const n = Number(g.puesto.cantidad_mesas) || 0;
    const reportadas = new Set([...j.vigentes.values()].filter(r => r.g.clave === g.clave).map(r => r.mesa));
    res.json({
      cantidad_mesas: n,
      mesas: Array.from({ length: n }, (_, i) => i + 1).map(m => ({ mesa: m, con_oficial: cargadas.has(m), con_reporte: reportadas.has(m) })),
    });
  } catch (err) {
    console.error('resultados/pendientes:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo cargar las mesas.' });
  }
});

router.put('/mesa', async (req, res) => {
  const b = req.body || {};
  const mesa = Number(b.mesa);
  if (!FUENTES.includes(b.fuente)) return res.status(400).json({ error: 'Elija la fuente: preconteo o escrutinio.' });
  if (!Number.isInteger(mesa) || mesa < 1 || mesa > 999999) return res.status(400).json({ error: 'La mesa debe ser un número entero mayor que 0.' });
  if (!Array.isArray(b.votos) || !b.votos.length) return res.status(400).json({ error: 'Falta el resultado de al menos un candidato.' });

  let conexion;
  try {
    const j = await cargarJornada(req);
    const g = puestoPedido(j, b);
    if (!g) return res.status(400).json({ error: 'Indique el puesto.' });
    if (g.puesto && Number(g.puesto.cantidad_mesas) > 0 && mesa > Number(g.puesto.cantidad_mesas)) {
      return res.status(400).json({ error: `La mesa ${mesa} no existe en este puesto: tiene ${g.puesto.cantidad_mesas} mesas.` });
    }
    const testigo = j.vigentes.get(`${g.clave}|${mesa}`) || null;
    const conocidos = new Map(j.hoja.map(h => [normalizar(h.nombre), h.grupo]));
    for (const v of testigo ? j.votosPor.get(testigo.id) || [] : []) if (!conocidos.has(v.norm)) conocidos.set(v.norm, v.grupo);

    const filas = [];
    const vistos = new Set();
    for (const item of b.votos) {
      const nombre = String((item && item.candidato_nombre) || '').trim();
      if (!nombre || nombre.length > 200) return res.status(400).json({ error: 'Cada renglón necesita el nombre del candidato.' });
      const norm = normalizar(nombre);
      if (vistos.has(norm)) return res.status(400).json({ error: `«${nombre}» está repetido.` });
      vistos.add(norm);
      if (!conocidos.has(norm)) return res.status(400).json({ error: `«${nombre}» no está en la hoja de candidatos de esta campaña.` });
      const votos = item.votos;
      if (votos === '' || votos === null || votos === undefined || !/^\d+$/.test(String(votos)) || Number(votos) > TOPE_VOTOS) {
        return res.status(400).json({ error: `Los votos de «${nombre}» deben ser un número entero mayor o igual a 0.` });
      }
      filas.push({ nombre, votos: Number(votos), grupo: diaD.grupoValido(item.grupo) || conocidos.get(norm) || null });
    }

    const puestoTexto = textoDelPuesto(g);
    const puestoId = g.puesto ? g.puesto.id : null;
    const dueno = j.dueno;
    const yo = req.session.usuario.id;
    conexion = await pool.getConnection();
    await conexion.beginTransaction();
    const [previas] = await conexion.query(
      `SELECT candidato_nombre, votos FROM dia_d_resultado_oficial
        WHERE aspirante_id = ? AND puesto_texto = ? AND mesa = ? AND fuente = ? FOR UPDATE`,
      [dueno, puestoTexto, mesa, b.fuente]);
    const antes = new Map(previas.map(p => [normalizar(p.candidato_nombre), Number(p.votos)]));
    const nombreVisible = new Map(previas.map(p => [normalizar(p.candidato_nombre), p.candidato_nombre]));
    filas.forEach(f => nombreVisible.set(normalizar(f.nombre), f.nombre));

    for (const f of filas) {
      await conexion.query(
        `INSERT INTO dia_d_resultado_oficial
           (aspirante_id, puesto_id, puesto_texto, mesa, candidato_nombre, grupo, votos, fuente, cargado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE votos = VALUES(votos), grupo = VALUES(grupo), puesto_id = VALUES(puesto_id),
                                 actualizado_por = ?, actualizado_en = NOW()`,
        [dueno, puestoId, puestoTexto, mesa, f.nombre, f.grupo, f.votos, b.fuente, yo, yo]);
    }
    // Lo que ya estaba cargado y ya no viene en el envío se quita: el envío ES el resultado de la mesa.
    const quedan = filas.map(f => f.nombre);
    await conexion.query(
      `DELETE FROM dia_d_resultado_oficial
        WHERE aspirante_id = ? AND puesto_texto = ? AND mesa = ? AND fuente = ? AND candidato_nombre NOT IN (?)`,
      [dueno, puestoTexto, mesa, b.fuente, quedan]);

    const ahora = new Map(filas.map(f => [normalizar(f.nombre), f.votos]));
    const igual = antes.size === ahora.size && [...ahora].every(([k, v]) => antes.get(k) === v);
    const texto = (m) => [...m].map(([k, v]) => `${nombreVisible.get(k) || k}: ${v}`).join(', ') || '(nada)';
    await registrarAuditoriaEn(conexion, yo, antes.size ? 'actualizar_resultado_oficial' : 'cargar_resultado_oficial',
      'dia_d_resultado_oficial', null,
      `${antes.size ? 'Cambió' : 'Cargó'} el resultado OFICIAL (${b.fuente}) de la mesa ${mesa} del puesto ${puestoTexto}. `
      + (igual ? 'Sin cambios de valor. ' : `Antes: ${texto(antes)}. Ahora: ${texto(ahora)}.`), req.ip);
    await conexion.commit();

    // «Guardar y siguiente mesa»: la primera mesa del puesto, después de esta, sin oficial.
    let siguiente = null;
    if (g.puesto) {
      const cargadas = new Set((await cargarOficial(j, b.fuente)).filter(f => f.g.clave === g.clave).map(f => f.mesa));
      cargadas.add(mesa);
      const n = Number(g.puesto.cantidad_mesas) || 0;
      const orden = [...Array.from({ length: n - mesa }, (_, i) => mesa + 1 + i), ...Array.from({ length: Math.min(mesa - 1, n) }, (_, i) => i + 1)];
      const m = orden.find(x => x >= 1 && x <= n && !cargadas.has(x));
      if (m) siguiente = { puesto_id: g.puesto.id, mesa: m };
    }
    res.json({ ok: true, guardados: filas.length, cambio: !igual, siguiente });
  } catch (err) {
    if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
    console.error('resultados/mesa PUT:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo guardar el resultado oficial.' });
  } finally {
    if (conexion) conexion.release();
  }
});

/* ——— DIFERENCIAS ————————————————————————————————————————————————————— */
async function calcularDiferencias(j, { filtro = 'perdida', fuente = 'todas' } = {}) {
  const oficial = await cargarOficial(j, FUENTES.includes(fuente) ? fuente : null);
  const [revisiones] = await pool.query(
    `SELECT puesto_texto, mesa, estado, nota FROM dia_d_mesa_revision WHERE aspirante_id = ?`, [j.dueno]);
  const revPor = new Map(revisiones.map(r => [`${j.resolver({ puesto_votacion: r.puesto_texto }).clave}|${Number(r.mesa)}`, r]));

  // Un grupo por (puesto resuelto, mesa, fuente).
  const grupos = new Map();
  for (const f of oficial) {
    const k = `${f.g.clave}|${f.mesa}|${f.fuente}`;
    if (!grupos.has(k)) grupos.set(k, { g: f.g, mesa: f.mesa, fuente: f.fuente, filas: [] });
    grupos.get(k).filas.push(f);
  }
  const salida = [];
  for (const gr of grupos.values()) {
    const testigo = j.vigentes.get(`${gr.g.clave}|${gr.mesa}`);
    if (!testigo) continue;                       // sin reporte del testigo no hay contra qué comparar
    const delTestigo = new Map((j.votosPor.get(testigo.id) || []).map(v => [v.norm, v]));
    const diferencias = [];
    let deltaPropio = null;
    for (const f of gr.filas) {
      const t = delTestigo.get(f.norm);
      if (!t) continue;                           // el testigo no lo listó: no se sabe, no es un cero
      const delta = f.votos - t.votos;
      if (f.norm === j.propio) deltaPropio = delta;
      if (delta !== 0) diferencias.push({ candidato: f.candidato_nombre, testigo: t.votos, oficial: f.votos, delta, es_propio: f.norm === j.propio });
    }
    const rev = revPor.get(`${gr.g.clave}|${gr.mesa}`) || null;
    const marcada = !!rev && rev.estado === 'para_reclamar';
    if (filtro === 'perdida' && !(deltaPropio !== null && deltaPropio < 0)) continue;
    if (filtro === 'cualquiera' && !diferencias.length) continue;
    if (filtro === 'marcadas' && !marcada) continue;
    const m = municipioDe(j, gr.g);
    salida.push({
      puesto_id: gr.g.puesto ? gr.g.puesto.id : null, puesto_texto: textoDelPuesto(gr.g), puesto: gr.g.nombre,
      fuera_de_lista: gr.g.fuera, municipio: m.municipio, mesa: gr.mesa, fuente: gr.fuente,
      testigo: testigo.testigo_nombre, reporte_id: testigo.id, hora_reporte: testigo.created_at,
      tiene_foto: !!testigo.tiene_foto, delta_propio: deltaPropio, diferencias,
      estado: rev ? rev.estado : null, nota: rev ? rev.nota : null,
    });
  }
  // Las que más le cuestan al propio, primero; sin dato del propio, al final.
  salida.sort((a, b) => (a.delta_propio === null) - (b.delta_propio === null)
    || (a.delta_propio || 0) - (b.delta_propio || 0) || b.diferencias.length - a.diferencias.length
    || a.puesto.localeCompare(b.puesto) || a.mesa - b.mesa);
  return { filas: salida, hay_oficial: oficial.length > 0 };
}

router.get('/diferencias', async (req, res) => {
  const filtro = ['perdida', 'cualquiera', 'marcadas'].includes(req.query.filtro) ? req.query.filtro : 'perdida';
  const fuente = FUENTES.includes(req.query.fuente) ? req.query.fuente : 'todas';
  try {
    const j = await cargarJornada(req);
    const r = await calcularDiferencias(j, { filtro, fuente });
    const [[m]] = await pool.query(
      `SELECT COUNT(*) AS n FROM dia_d_mesa_revision WHERE aspirante_id = ? AND estado = 'para_reclamar'`, [j.dueno]);
    res.json({ filtro, fuente, total: r.filas.length, hay_oficial: r.hay_oficial, marcadas: Number(m.n),
               propio: j.propioNombre || null, filas: r.filas });
  } catch (err) {
    console.error('resultados/diferencias:', err.code || err.message);
    res.status(500).json({ error: 'No se pudieron calcular las diferencias.' });
  }
});

router.put('/revision', async (req, res) => {
  const b = req.body || {};
  const mesa = Number(b.mesa);
  const estado = String(b.estado || '');
  if (![...ESTADOS, 'ninguno'].includes(estado)) return res.status(400).json({ error: 'Estado no válido.' });
  if (!Number.isInteger(mesa) || mesa < 1) return res.status(400).json({ error: 'Indique la mesa.' });
  const nota = b.nota === undefined || b.nota === null ? null : String(b.nota).trim().slice(0, 2000) || null;
  try {
    const j = await cargarJornada(req);
    const g = puestoPedido(j, b);
    if (!g) return res.status(400).json({ error: 'Indique el puesto.' });
    const puestoTexto = textoDelPuesto(g);
    const [[antes]] = await pool.query(
      `SELECT estado, nota FROM dia_d_mesa_revision WHERE aspirante_id = ? AND puesto_texto = ? AND mesa = ?`,
      [j.dueno, puestoTexto, mesa]);
    if (estado === 'ninguno') {
      await pool.query(`DELETE FROM dia_d_mesa_revision WHERE aspirante_id = ? AND puesto_texto = ? AND mesa = ?`, [j.dueno, puestoTexto, mesa]);
    } else {
      await pool.query(
        `INSERT INTO dia_d_mesa_revision (aspirante_id, puesto_texto, mesa, estado, nota, marcado_por)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE estado = VALUES(estado), nota = VALUES(nota), marcado_por = VALUES(marcado_por), marcado_en = NOW()`,
        [j.dueno, puestoTexto, mesa, estado, nota, req.session.usuario.id]);
    }
    await registrarAuditoria(req.session.usuario.id, 'revision_mesa_dia_d', 'dia_d_mesa_revision', null,
      `Mesa ${mesa} del puesto ${puestoTexto}: ${antes ? `antes «${antes.estado}»${antes.nota ? ` («${String(antes.nota).slice(0, 120)}»)` : ''}` : 'antes sin revisión'}; `
      + `ahora ${estado === 'ninguno' ? 'sin revisión' : `«${estado}»${nota ? ` («${nota.slice(0, 120)}»)` : ''}`}.`, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error('resultados/revision:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo guardar la revisión.' });
  }
});

/* ——— PAQUETE PARA EL ABOGADO ——————————————————————————————————————————
   Un ZIP con: un Excel de las mesas marcadas «para reclamar» (los dos conteos y su diferencia),
   una carpeta por puesto con las fotos del E-14 y los documentos de esas mesas, y un
   sha256.txt con la huella de cada archivo. Se arma FUERA de la petición (carpeta temporal +
   el comando `zip`, como el respaldo) y vence a las 24 horas. Vive en uploads/dia-d/paquetes/,
   que el filtro de /uploads (app.js) NO sirve: solo sale por la ruta de descarga de abajo. */
const limpiarNombre = (t, largo = 50) =>
  String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, largo) || 'x';
const horaCompacta = (t) => String(t || '').replace(/[-: ]/g, '').replace(/^(\d{8})(\d{4}).*$/, '$1-$2') || 'sinhora';
const ejecutar = (cmd, args, opciones) => new Promise((ok, no) => execFile(cmd, args, opciones, (e, so, se) => (e ? no(new Error(se || e.message)) : ok(so))));
const sha256De = (ruta) => new Promise((ok, no) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(ruta).on('data', d => h.update(d)).on('error', no).on('end', () => ok(h.digest('hex')));
});

/** Qué va en el paquete: una entrada por mesa marcada, con sus archivos. Solo consultas, rápido. */
async function planearPaquete(j) {
  const [revs] = await pool.query(
    `SELECT puesto_texto, mesa FROM dia_d_mesa_revision WHERE aspirante_id = ? AND estado = 'para_reclamar'`, [j.dueno]);
  const marcadas = new Set(revs.map(x => `${j.resolver({ puesto_votacion: x.puesto_texto }).clave}|${Number(x.mesa)}`));

  // Las mesas marcadas que tengan oficial Y reporte, aunque ya no haya diferencia (se reclama lo marcado).
  const todas = await calcularDiferencias(j, { filtro: 'marcadas', fuente: 'todas' });
  const porMesa = new Map();
  for (const f of todas.filas) {
    const k = `${j.resolver({ puesto_votacion: f.puesto_texto }).clave}|${f.mesa}`;
    if (!marcadas.has(k)) continue;
    if (!porMesa.has(k)) porMesa.set(k, { puesto: f.puesto, puesto_texto: f.puesto_texto, municipio: f.municipio, mesa: f.mesa,
      reporte_id: f.reporte_id, testigo: f.testigo, hora: f.hora_reporte, nota: f.nota, fuentes: [] });
    porMesa.get(k).fuentes.push(f.fuente);
  }
  const mesas = [...porMesa.values()];
  if (!mesas.length) return { mesas: [], oficial: [] };

  const ids = mesas.map(m => m.reporte_id);
  const [fotos] = await pool.query(`SELECT id, foto_e14_url FROM dia_d_reportes WHERE id IN (?)`, [ids]);
  const [docs] = await pool.query(
    `SELECT reporte_id, url, descripcion, orden FROM dia_d_reporte_documentos WHERE reporte_id IN (?) ORDER BY reporte_id, orden`, [ids]);
  const fotoPor = new Map(fotos.map(f => [f.id, f.foto_e14_url]));
  const docsPor = new Map();
  for (const d of docs) { if (!docsPor.has(d.reporte_id)) docsPor.set(d.reporte_id, []); docsPor.get(d.reporte_id).push(d); }

  const oficial = (await cargarOficial(j)).filter(f => marcadas.has(`${f.g.clave}|${f.mesa}`));
  for (const m of mesas) {
    m.archivos = [];
    if (fotoPor.get(m.reporte_id)) m.archivos.push({ url: fotoPor.get(m.reporte_id), tipo: 'E-14', descripcion: '' });
    (docsPor.get(m.reporte_id) || []).forEach((d, i) => m.archivos.push({ url: d.url, tipo: `documento ${i + 1}`, descripcion: d.descripcion || '' }));
    m.votosTestigo = new Map((j.votosPor.get(m.reporte_id) || []).map(v => [v.norm, v]));
  }
  return { mesas, oficial, resolver: j.resolver };
}

async function armarPaquete(paqueteId, plan, aspiranteId) {
  const tmp = path.join(PAQUETES_DIR, `tmp_${paqueteId}`);
  let rutaZip = null;
  try {
    await pool.query(`UPDATE dia_d_paquetes SET estado = 'armando' WHERE id = ?`, [paqueteId]);
    await fs.promises.mkdir(tmp, { recursive: true });
    const usadas = new Map();      // carpeta saneada → puesto, para no mezclar dos puestos que se sanean igual
    const huellas = [];            // [sha, ruta relativa]
    let nArchivos = 0;

    for (const m of plan.mesas) {
      let carpeta = limpiarNombre(m.puesto, 40);
      if (usadas.has(carpeta) && usadas.get(carpeta) !== m.puesto) carpeta += `_${limpiarNombre(m.mesa)}_${paqueteId}`;
      usadas.set(carpeta, m.puesto);
      await fs.promises.mkdir(path.join(tmp, carpeta), { recursive: true });
      m.foto = { nombre: '', sha: '' };
      let i = 0;
      for (const a of m.archivos) {
        const origen = diaD.rutasDelArchivoDiaD(a.url).find(r => fs.existsSync(r));
        const ext = (path.extname(a.url || '') || '.jpg').toLowerCase();
        const base = `${limpiarNombre(m.puesto, 30)}_Mesa${m.mesa}_${horaCompacta(m.hora)}${a.tipo === 'E-14' ? '' : `_doc${++i}`}`;
        const nombre = `${base}${ext}`;
        if (!origen) { a.nombre = nombre; a.faltante = true; continue; }
        const destino = path.join(tmp, carpeta, nombre);
        await fs.promises.copyFile(origen, destino);
        a.nombre = nombre;
        a.sha = await sha256De(destino);
        a.ruta = `${carpeta}/${nombre}`;
        huellas.push([a.sha, a.ruta]);
        nArchivos++;
        if (a.tipo === 'E-14') m.foto = { nombre: a.ruta, sha: a.sha };
      }
    }

    // El Excel: una fila por (mesa, fuente, candidato).
    const col = ['Puesto', 'Mesa', 'Municipio', 'Candidato', 'Testigo (votos)', 'Oficial (votos)', 'Diferencia',
      'Fuente', 'Testigo que reportó', 'Hora del reporte', 'Nota de revisión', 'Archivo de la foto del E-14', 'sha256 de la foto'];
    const filas = [col];
    for (const m of plan.mesas) {
      const delOficial = plan.oficial.filter(f => plan.resolver({ puesto_votacion: m.puesto_texto }).clave === f.g.clave && f.mesa === m.mesa);
      for (const f of delOficial) {
        const t = m.votosTestigo.get(f.norm);
        filas.push([m.puesto, m.mesa, m.municipio, f.candidato_nombre, t ? t.votos : '', f.votos,
          t ? f.votos - t.votos : '', f.fuente, m.testigo, m.hora, m.nota || '', m.foto.nombre, m.foto.sha]);
      }
    }
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filas), 'Mesas para reclamar');
    const rutaExcel = path.join(tmp, 'mesas-para-reclamar.xlsx');
    XLSX.writeFile(libro, rutaExcel);
    huellas.push([await sha256De(rutaExcel), 'mesas-para-reclamar.xlsx']);
    await fs.promises.writeFile(path.join(tmp, 'sha256.txt'),
      `# sha256 de cada archivo del paquete (formato de sha256sum: «sha256sum -c sha256.txt»)\n`
      + huellas.map(([h, r]) => `${h}  ${r}`).join('\n') + '\n');

    // `zip -0` (sin comprimir): son JPEG, que no se comprimen más, y así el armado es de copiar.
    rutaZip = path.join(PAQUETES_DIR, `paquete_${paqueteId}_${crypto.randomBytes(6).toString('hex')}.zip`);
    await ejecutar('zip', ['-r', '-q', '-0', rutaZip, '.'], { cwd: tmp });
    const [sha, st] = [await sha256De(rutaZip), await fs.promises.stat(rutaZip)];
    await pool.query(
      `UPDATE dia_d_paquetes SET estado = 'listo', archivos = ?, bytes = ?, sha256 = ?, ruta = ?,
              vence_en = DATE_ADD(NOW(), INTERVAL ${HORAS_DE_VIDA_PAQUETE} HOUR), error = NULL WHERE id = ?`,
      [nArchivos, st.size, sha, `paquetes/${path.basename(rutaZip)}`, paqueteId]);
  } catch (err) {
    console.error(`resultados/paquete ${paqueteId}:`, err.message);
    if (rutaZip) fs.promises.rm(rutaZip, { force: true }).catch(() => {});
    await pool.query(`UPDATE dia_d_paquetes SET estado = 'error', error = ? WHERE id = ?`,
      [String(err.message || err).slice(0, 1000), paqueteId]).catch(() => {});
  } finally {
    fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

router.post('/paquete', async (req, res) => {
  let conexion;
  try {
    const j = await cargarJornada(req);
    // UN SOLO PAQUETE EN CURSO POR CAMPAÑA, decidido bajo un bloqueo con nombre: dos clics casi
    // simultáneos no pueden crear dos.
    conexion = await pool.getConnection();
    const clave = `diad_paquete_${j.dueno}`;
    const [[bloqueo]] = await conexion.query('SELECT GET_LOCK(?, 5) AS tomado', [clave]);
    if (Number(bloqueo.tomado) !== 1) return res.status(503).json({ error: 'Intente de nuevo en unos segundos.' });
    try {
      const [[enCurso]] = await conexion.query(
        `SELECT id, estado FROM dia_d_paquetes WHERE aspirante_id = ? AND estado IN ('en_cola','armando') LIMIT 1`, [j.dueno]);
      if (enCurso) return res.status(409).json({ error: 'Ya hay un paquete en curso.', paquete: enCurso });

      const plan = await planearPaquete(j);
      if (!plan.mesas.length) {
        return res.status(400).json({ error: 'No hay mesas marcadas «para reclamar» con resultado oficial y reporte del testigo.' });
      }
      const [r] = await conexion.query(
        `INSERT INTO dia_d_paquetes (aspirante_id, pedido_por, estado, mesas) VALUES (?, ?, 'en_cola', ?)`,
        [j.dueno, req.session.usuario.id, plan.mesas.length]);
      await registrarAuditoriaEn(conexion, req.session.usuario.id, 'pedir_paquete_dia_d', 'dia_d_paquetes', r.insertId,
        `Pidió el paquete para el abogado con ${plan.mesas.length} mesas marcadas para reclamar.`, req.ip);
      res.status(202).json({ ok: true, id: r.insertId, estado: 'en_cola', mesas: plan.mesas.length });
      // Fuera del ciclo de la petición: no bloquea a nadie.
      setImmediate(() => armarPaquete(r.insertId, plan, j.dueno));
    } finally {
      try { await conexion.query('SELECT RELEASE_LOCK(?)', [clave]); } catch (_) { /* la conexión murió: MySQL ya lo soltó */ }
    }
  } catch (err) {
    console.error('resultados/paquete POST:', err.code || err.message);
    if (!res.headersSent) res.status(500).json({ error: 'No se pudo pedir el paquete.' });
  } finally {
    if (conexion) conexion.release();
  }
});

router.get('/paquetes', async (req, res) => {
  try {
    const dueno = await diaD.duenoDeLaCampana(req);
    const [filas] = await pool.query(
      `SELECT p.id, p.estado, p.mesas, p.archivos, p.bytes, p.sha256, p.error, p.pedido_en, p.vence_en,
              (p.estado = 'listo' AND p.vence_en > NOW()) AS descargable, u.nombre AS pedido_por
         FROM dia_d_paquetes p LEFT JOIN usuarios u ON u.id = p.pedido_por
        WHERE p.aspirante_id = ? ORDER BY p.id DESC LIMIT 20`, [dueno]);
    res.json(filas.map(f => ({ ...f, descargable: !!Number(f.descargable), bytes: Number(f.bytes) })));
  } catch (err) {
    console.error('resultados/paquetes:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo leer la lista de paquetes.' });
  }
});

router.get('/paquete/:id/descargar', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Paquete inválido.' });
  try {
    const dueno = await diaD.duenoDeLaCampana(req);
    const [[p]] = await pool.query(
      `SELECT id, estado, ruta, (vence_en > NOW()) AS vigente FROM dia_d_paquetes WHERE id = ? AND aspirante_id = ?`, [id, dueno]);
    if (!p) return res.status(404).json({ error: 'Ese paquete no existe.' });
    if (p.estado !== 'listo' || !Number(p.vigente)) return res.status(410).json({ error: 'Ese paquete no está disponible: venció o no terminó de armarse.' });
    const abs = path.join(UPLOAD_DIA_D_DIR, String(p.ruta || ''));
    // La ruta guardada tiene que quedar DENTRO de la carpeta de paquetes (defensa en profundidad).
    if (!abs.startsWith(PAQUETES_DIR + path.sep) || !fs.existsSync(abs)) return res.status(404).json({ error: 'El archivo ya no está en el servidor.' });
    await registrarAuditoria(req.session.usuario.id, 'descargar_paquete_dia_d', 'dia_d_paquetes', id, 'Descargó el paquete para el abogado.', req.ip);
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.download(abs, `paquete-reclamacion-${id}.zip`);
  } catch (err) {
    console.error('resultados/descargar:', err.code || err.message);
    if (!res.headersSent) res.status(500).json({ error: 'No se pudo descargar el paquete.' });
  }
});

/* ——— MANTENIMIENTO: vencimiento a las 24 h y arranque ————————————————————— */
async function limpiarPaquetesVencidos() {
  try {
    const [vencidos] = await pool.query(`SELECT id, ruta FROM dia_d_paquetes WHERE vence_en IS NOT NULL AND vence_en < NOW()`);
    for (const p of vencidos) {
      if (p.ruta) {
        const abs = path.join(UPLOAD_DIA_D_DIR, p.ruta);
        if (abs.startsWith(PAQUETES_DIR + path.sep)) await fs.promises.rm(abs, { force: true });
      }
      await pool.query(`DELETE FROM dia_d_paquetes WHERE id = ?`, [p.id]);
    }
    return vencidos.length;
  } catch (err) {
    console.warn('No se pudieron limpiar los paquetes vencidos:', err.code || err.message);
    return 0;
  }
}

/** Al arrancar: lo que quedó «armando» no va a terminar solo (se reinició el servidor), y se
 *  barren las carpetas temporales. Después, cada hora, se borran los vencidos. */
async function iniciarMantenimiento() {
  try {
    await pool.query(
      `UPDATE dia_d_paquetes SET estado = 'error', error = 'Se interrumpió porque el servidor se reinició. Pídalo de nuevo.'
        WHERE estado IN ('en_cola','armando')`);
    if (fs.existsSync(PAQUETES_DIR)) {
      for (const n of fs.readdirSync(PAQUETES_DIR)) {
        if (n.startsWith('tmp_')) fs.rmSync(path.join(PAQUETES_DIR, n), { recursive: true, force: true });
      }
    }
  } catch (err) {
    console.warn('Mantenimiento de paquetes al arrancar:', err.code || err.message);
  }
  await limpiarPaquetesVencidos();
  setInterval(limpiarPaquetesVencidos, 60 * 60 * 1000).unref();
}

module.exports = router;
module.exports.iniciarMantenimiento = iniciarMantenimiento;
module.exports.limpiarPaquetesVencidos = limpiarPaquetesVencidos;
module.exports.construirConsolidado = construirConsolidado;
module.exports.cargarJornada = cargarJornada;
module.exports.calcularDiferencias = calcularDiferencias;
