/**
 * Cobertura de testigos — lo que se HACE desde la pantalla (Configuración → Día D → Puestos de votación):
 * asignar y quitar una mesa, ver a quién proponer, suplentes, el Excel para acreditar y el aviso al testigo.
 * Montado en /api/dia-d/cobertura. (La tabla misma la sirve GET /api/dia-d/config/puestos-votacion.)
 *
 * DE QUIÉN ES CADA COSA. Todo se acota igual que el resto del Día D: los puestos por `aspirante_id` =
 * `duenoDeLaCampana(req)`, los testigos por la rama (lib/coberturaTestigos.js), los votantes por el alcance
 * de quien pregunta. El permiso es el de hoy para EDITAR testigos (admin, coordinador y aspirante); un líder
 * recibe 403.
 *
 * ASIGNAR ESCRIBE EN EL MISMO LUGAR Y FORMATO DE SIEMPRE, y por la MISMA función que usan las otras
 * pantallas (`asegurarEstructuraTestigo`, config/testigoElectoral.js): `estructura.tipo_testigo`,
 * `mesa_votacion` / `mesas_asignadas`, `puesto_id`. No hay una vía nueva de escritura.
 *   · una sola mesa  → tipo 'mesa' (si ya era 'puesto', sigue siendo 'puesto': nunca se le cambia el cargo);
 *   · varias mesas   → tipo 'puesto' con la lista;
 *   · sin ninguna    → tipo 'puesto' con la lista vacía. NO 'mesa' sin mesa: con `mesa_votacion` nula el
 *     COALESCE caería a `usuarios.mesa_votacion` —la mesa donde la persona VOTA— y la daría por testigo ahí.
 *
 * UN BLOQUEO POR PUESTO (GET_LOCK). Dos personas de la coordinación asignando mesas del mismo puesto a la vez
 * leerían las dos «mesa libre» y la segunda pisaría a la primera sin que nadie lo viera. Como el resto del
 * Día D, es GET_LOCK y no SELECT … FOR UPDATE; se suelta siempre antes de devolver la conexión.
 *
 * NO CREA CUENTAS NI CAMBIA ROLES. Asignar acepta a alguien que ya tiene cuenta en la campaña. Quien es solo un
 * votante no tiene cuenta: para volverlo testigo hay que pasar por el alta de testigo, donde se confirma.
 */
'use strict';

const express = require('express');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { requireAuth, requireRole, calcularAlcance } = require('../middleware/auth');
const { requiereImportarExportar } = require('../middleware/permisoModulo');
const { registrarAuditoria } = require('../config/auditoria');
const { asegurarEstructuraTestigo } = require('../config/testigoElectoral');
const diaD = require('./diaD.routes').compartido;
const { normalizarCedula } = require('../lib/normalizarCedula');
const { condicionAlcanceVotantes, parametrosAlcanceVotantes } = require('../lib/alcanceVotantes');
const {
  cargarTestigos, repartirPorPuesto, acotaDeLaCampana, leerLimiteDeMesas, cargarUbicaciones, listaEnPalabras,
} = require('../lib/coberturaTestigos');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'coordinador', 'aspirante'), calcularAlcance);

const TOPE_LIMITE = 20;

/* ——— utilidades ——————————————————————————————————————————————————————— */

async function cargarPuesto(conexion, dueno, id) {
  const [[p]] = await conexion.query(
    `SELECT id, nombre, cantidad_mesas, ctc_puesto_id FROM dia_d_puestos_votacion WHERE id = ? AND aspirante_id = ?`,
    [Number(id) || 0, dueno]);
  return p || null;
}

/** ¿Esta persona (usuarios.id) hace parte de la campaña? Tiene alguna fila de estructura dentro de su rama. */
async function usuarioEsDeLaCampana(conexion, dueno, usuarioId) {
  const acota = await acotaDeLaCampana(conexion, dueno);
  const [[fila]] = await conexion.query(
    `SELECT e.id FROM estructura e WHERE e.usuario_id = ? ${acota ? 'AND ' + acota.sql : ''} LIMIT 1`,
    [usuarioId, ...(acota ? acota.valores : [])]);
  return !!fila;
}

/** Ejecuta `fn(conexion)` con el bloqueo del puesto tomado; lo suelta siempre. Lanza con `codigo='BLOQUEADO'` si no lo obtiene. */
async function conBloqueoDelPuesto(dueno, puestoId, fn) {
  const conexion = await pool.getConnection();
  const nombre = `diad_cobertura_${dueno}_${puestoId}`;
  let tomado = false;
  try {
    const [[b]] = await conexion.query('SELECT GET_LOCK(?, 5) AS tomado', [nombre]);
    tomado = Number(b && b.tomado) === 1;
    if (!tomado) { const e = new Error('El puesto está siendo editado por otra persona.'); e.codigo = 'BLOQUEADO'; throw e; }
    return await fn(conexion);
  } finally {
    if (tomado) { try { await conexion.query('SELECT RELEASE_LOCK(?)', [nombre]); } catch (_) { /* la conexión ya no sirve */ } }
    conexion.release();
  }
}

/** Reescribe las mesas de un testigo EN ESTE PUESTO, con la regla de tipo de arriba. Devuelve el resultado de asegurarEstructuraTestigo. */
async function escribirMesas(conexion, puesto, testigo, mesas) {
  const lista = [...new Set(mesas.map(Number))].sort((a, b) => a - b);
  const tipo = (testigo && testigo.tipo_testigo === 'puesto') || lista.length !== 1 ? 'puesto' : 'mesa';
  return asegurarEstructuraTestigo(
    conexion, testigo.usuario_id,
    { puesto_votacion: puesto.nombre, mesa_votacion: tipo === 'mesa' ? lista[0] : null },
    tipo, tipo === 'puesto' ? lista : [], { actualizarSiExiste: true });
}

/** Quién cubre la mesa `m` de este puesto, de la lista de testigos de la campaña, o null. */
function quienCubre(testigosDelPuesto, m) {
  return testigosDelPuesto.find(t => t.mesas.includes(m)) || null;
}

const textoMesas = (mesas) => (mesas.length ? mesas.join(', ') : 'ninguna');

/* ——— la asignación, en un solo sitio ———————————————————————————————————— */
/**
 * @returns {{status:number, body:object}}
 *   409 + `requiere_confirmacion` si hace falta que la persona confirme (la mesa ya tiene otro testigo, o el
 *   testigo está en OTRO puesto y asignarlo lo MUEVE). Se repite la llamada con `confirmar: true`.
 */
async function asignarMesa({ dueno, puesto, usuarioId, mesa, confirmar, actorId, ip }) {
  return conBloqueoDelPuesto(dueno, puesto.id, async (conexion) => {
    if (!Number.isInteger(mesa) || mesa < 1 || mesa > Number(puesto.cantidad_mesas)) {
      return { status: 400, body: { error: `La mesa debe estar entre 1 y ${puesto.cantidad_mesas}.` } };
    }
    if (!(await usuarioEsDeLaCampana(conexion, dueno, usuarioId))) {
      return { status: 404, body: { error: 'Esa persona no hace parte de esta campaña.' } };
    }
    const testigos = await cargarTestigos(conexion, dueno);
    const delPuesto = repartirPorPuesto(testigos, [puesto]).get(Number(puesto.id)) || [];
    const propio = testigos.find(t => t.usuario_id === usuarioId) || null;
    const propioEnEstePuesto = propio ? delPuesto.some(t => t.estructura_id === propio.estructura_id) : false;
    const actual = quienCubre(delPuesto, mesa);

    if (actual && propio && actual.estructura_id === propio.estructura_id) {
      return { status: 200, body: { ok: true, ya_estaba: true, mesas: propio.mesas } };
    }
    // ¿Asignarlo aquí lo SACA de otro puesto? Sólo si ya es testigo en uno distinto.
    const loMueve = !!propio && !propioEnEstePuesto && (propio.puesto_id || propio.puesto_texto);
    if ((actual || loMueve) && !confirmar) {
      return { status: 409, body: {
        requiere_confirmacion: true,
        mesa_ocupada_por: actual ? { estructura_id: actual.estructura_id, nombre: actual.nombre } : null,
        lo_mueve_de: loMueve ? { puesto: propio.puesto_texto || '(otro puesto)', mesas: propio.mesas } : null,
      } };
    }

    // 1. Quitarle la mesa a quien la tenía.
    if (actual) {
      const r = await escribirMesas(conexion, puesto, actual, actual.mesas.filter(m => m !== mesa));
      if (r.conflicto) return { status: 409, body: { error: 'No se pudo liberar la mesa.' } };
      await registrarAuditoria(actorId, 'quitar_mesa_testigo', 'estructura', actual.estructura_id,
        `Antes: ${actual.nombre} cubría las mesas ${textoMesas(actual.mesas)} del puesto ${puesto.nombre}. `
        + `Ahora: ${textoMesas(actual.mesas.filter(m => m !== mesa))}. Motivo: se reasignó la mesa ${mesa}.`, ip);
    }
    // 2. Ponérsela a quien corresponde (si ya está en este puesto suma; si viene de otro, empieza de cero aquí).
    const antes = propioEnEstePuesto ? propio.mesas : [];
    const nuevas = [...antes, mesa];
    const r = await escribirMesas(conexion, puesto, propio || { usuario_id: usuarioId, tipo_testigo: 'mesa' }, nuevas);
    if (r.conflicto) return { status: 409, body: { error: `La mesa ${r.conflicto.join(', ')} sigue ocupada por otro testigo.` } };
    if (!r.creado && !r.actualizado) return { status: 500, body: { error: 'No se pudo guardar la asignación.' } };

    // Quien se vuelve titular deja de ser suplente de este puesto.
    await conexion.query(
      `DELETE FROM dia_d_suplentes_testigo WHERE aspirante_id = ? AND puesto_id = ? AND usuario_id = ?`,
      [dueno, puesto.id, usuarioId]);

    const [[u]] = await conexion.query(`SELECT nombre FROM usuarios WHERE id = ?`, [usuarioId]);
    const limite = await leerLimiteDeMesas(conexion);
    await registrarAuditoria(actorId, 'asignar_mesa_testigo', 'estructura', r.estructuraId || 0,
      `Antes: ${u ? u.nombre : 'la persona'} cubría las mesas ${textoMesas(antes)}`
      + `${loMueve ? ` del puesto ${propio.puesto_texto || 'anterior'} (se le movió a este puesto)` : ''}. `
      + `Ahora: las mesas ${textoMesas(nuevas.sort((a, b) => a - b))} del puesto ${puesto.nombre}`
      + `${actual ? `, quitándole la mesa ${mesa} a ${actual.nombre}` : ''}.`, ip);
    return { status: 200, body: {
      ok: true, mesas: nuevas.sort((a, b) => a - b), estructura_id: r.estructuraId || null,
      aviso: nuevas.length > limite ? `Este testigo queda con ${nuevas.length} mesas (el límite configurado es ${limite}).` : null,
    } };
  });
}

/* ——— configuración: el límite de mesas por testigo —————————————————————— */
router.get('/config', async (req, res) => {
  res.json({ max_mesas_por_testigo: await leerLimiteDeMesas(pool) });
});

router.put('/config', requireRole('admin', 'aspirante'), async (req, res) => {
  const n = Number(req.body && req.body.max_mesas_por_testigo);
  if (!Number.isInteger(n) || n < 1 || n > TOPE_LIMITE) {
    return res.status(400).json({ error: `El límite debe ser un número entero entre 1 y ${TOPE_LIMITE}.` });
  }
  try {
    const antes = await leerLimiteDeMesas(pool);
    await pool.query(`UPDATE configuracion_campana SET max_mesas_por_testigo = ? WHERE id = 1`, [n]);
    await registrarAuditoria(req.session.usuario.id, 'config_limite_mesas_testigo', 'configuracion_campana', 1,
      `Antes: ${antes} mesas por testigo. Ahora: ${n}.`, req.ip);
    res.json({ ok: true, max_mesas_por_testigo: n });
  } catch (err) {
    console.error('cobertura/config:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo guardar el límite.' });
  }
});

/* ——— la ventana de un puesto ——————————————————————————————————————————— */
router.get('/puesto/:id', async (req, res) => {
  try {
    const dueno = await diaD.duenoDeLaCampana(req);
    const puesto = await cargarPuesto(pool, dueno, req.params.id);
    if (!puesto) return res.status(404).json({ error: 'Puesto no encontrado.' });

    const todos = await cargarTestigos(pool, dueno);
    const delPuesto = repartirPorPuesto(todos, [puesto]).get(Number(puesto.id)) || [];
    const idsDelPuesto = new Set(delPuesto.map(t => t.estructura_id));
    const limite = await leerLimiteDeMesas(pool);

    const mesas = [];
    for (let m = 1; m <= Number(puesto.cantidad_mesas); m++) {
      const t = quienCubre(delPuesto, m);
      mesas.push({ mesa: m, testigo_id: t ? t.estructura_id : null, testigo: t ? t.nombre : null, iniciales: t ? t.iniciales : null });
    }

    const [suplentes] = await pool.query(
      `SELECT s.id, s.usuario_id, u.nombre, u.telefono
         FROM dia_d_suplentes_testigo s JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.aspirante_id = ? AND s.puesto_id = ? ORDER BY u.nombre`, [dueno, puesto.id]);

    /* LOS SUGERIDOS: gente de la campaña que VOTA en este puesto y todavía no es testigo. */
    const idsTestigos = new Set(todos.map(t => t.usuario_id));
    // Normalizadas (solo dígitos): «1.053…» y «1053…» son la misma persona al cotejar votantes con cuentas.
    const cedulasTestigos = new Set(todos.map(t => normalizarCedula(t.numero_identificacion)).filter(Boolean));
    const acota = await acotaDeLaCampana(pool, dueno);
    const [usuarios] = await pool.query(
      `SELECT u.id AS usuario_id, u.nombre, u.telefono, u.numero_identificacion, u.no_contactar,
              u.mesa_votacion, MIN(e.cargo) AS cargo, MIN(e.id) AS estructura_id
         FROM usuarios u JOIN estructura e ON e.usuario_id = u.id
        WHERE e.cargo IN ('coordinador', 'lider', 'usuario', 'coordinador_organizaciones')
          AND (u.puesto_id = ? OR u.puesto_votacion = ?)
          ${acota ? 'AND ' + acota.sql : ''}
        GROUP BY u.id, u.nombre, u.telefono, u.numero_identificacion, u.no_contactar, u.mesa_votacion
        ORDER BY u.nombre`, [puesto.id, puesto.nombre, ...(acota ? acota.valores : [])]);
    const etiquetas = { coordinador: 'Coordinador', coordinador_organizaciones: 'Coordinador', lider: 'Líder', usuario: 'Sublíder' };
    const sugeridosUsuarios = usuarios
      .filter(u => !idsTestigos.has(u.usuario_id))
      .map(u => ({
        tipo: 'usuario', usuario_id: u.usuario_id, nombre: u.nombre, telefono: u.telefono || '',
        mesa: u.mesa_votacion || null, cargo: etiquetas[u.cargo] || u.cargo, no_contactar: !!u.no_contactar,
        cedula: u.numero_identificacion || null, estructura_id: u.estructura_id,
      }));
    const cedulasUsuarios = new Set(usuarios.map(u => normalizarCedula(u.numero_identificacion)).filter(Boolean));

    const a = req.alcance ? { sql: condicionAlcanceVotantes(req.alcance, 'v'), valores: parametrosAlcanceVotantes(req.alcance) } : null;
    let sugeridosVotantes = [];
    if (a) {
      const [votantes] = await pool.query(
        `SELECT v.id, v.nombre, v.telefono, v.email, v.cedula, v.mesa_votacion, v.no_contactar, v.categoria
           FROM votantes v
          WHERE (v.puesto_id = ? OR v.puesto_votacion = ?) AND ${a.sql}
          ORDER BY v.nombre LIMIT 300`, [puesto.id, puesto.nombre, ...a.valores]);
      sugeridosVotantes = votantes
        .filter(v => { const c = normalizarCedula(v.cedula); return !(c && (cedulasTestigos.has(c) || cedulasUsuarios.has(c))); })
        .map(v => ({
          tipo: 'votante', votante_id: v.id, nombre: v.nombre, telefono: v.telefono || '', email: v.email || '',
          cedula: v.cedula || null, mesa: v.mesa_votacion || null,
          cargo: v.categoria === 'sublider' ? 'Sublíder' : 'Votante', no_contactar: !!v.no_contactar,
        }));
    }

    res.json({
      puesto: { id: puesto.id, nombre: puesto.nombre, cantidad_mesas: puesto.cantidad_mesas },
      max_mesas_por_testigo: limite,
      mesas,
      testigos_del_puesto: delPuesto.map(t => ({ estructura_id: t.estructura_id, usuario_id: t.usuario_id, nombre: t.nombre, mesas: t.mesas, iniciales: t.iniciales })),
      // Todos los testigos de la campaña, para poder asignar a uno que hoy está en otro puesto (pide confirmar: lo MUEVE).
      testigos: todos.map(t => ({
        estructura_id: t.estructura_id, usuario_id: t.usuario_id, nombre: t.nombre, telefono: t.telefono || '',
        mesas: t.mesas, puesto: t.puesto_texto || '', en_este_puesto: idsDelPuesto.has(t.estructura_id),
        no_contactar: !!t.no_contactar,
      })),
      suplentes,
      sugeridos: [...sugeridosUsuarios, ...sugeridosVotantes],
    });
  } catch (err) {
    console.error('cobertura/puesto:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo abrir el puesto.' });
  }
});

/* ——— asignar y quitar ——————————————————————————————————————————————————— */
router.post('/asignar', async (req, res) => {
  const b = req.body || {};
  try {
    const dueno = await diaD.duenoDeLaCampana(req);
    const puesto = await cargarPuesto(pool, dueno, b.puesto_id);
    if (!puesto) return res.status(404).json({ error: 'Puesto no encontrado.' });
    const usuarioId = Number(b.usuario_id);
    if (!Number.isInteger(usuarioId) || usuarioId < 1) return res.status(400).json({ error: 'Falta la persona.' });
    const r = await asignarMesa({
      dueno, puesto, usuarioId, mesa: Number(b.mesa), confirmar: b.confirmar === true,
      actorId: req.session.usuario.id, ip: req.ip,
    });
    res.status(r.status).json(r.body);
  } catch (err) {
    if (err.codigo === 'BLOQUEADO') return res.status(409).json({ error: err.message });
    console.error('cobertura/asignar:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo asignar la mesa.' });
  }
});

router.post('/quitar', async (req, res) => {
  const b = req.body || {};
  try {
    const dueno = await diaD.duenoDeLaCampana(req);
    const puesto = await cargarPuesto(pool, dueno, b.puesto_id);
    if (!puesto) return res.status(404).json({ error: 'Puesto no encontrado.' });
    const mesa = Number(b.mesa);
    if (!Number.isInteger(mesa) || mesa < 1 || mesa > Number(puesto.cantidad_mesas)) {
      return res.status(400).json({ error: `La mesa debe estar entre 1 y ${puesto.cantidad_mesas}.` });
    }
    const r = await conBloqueoDelPuesto(dueno, puesto.id, async (conexion) => {
      const todos = await cargarTestigos(conexion, dueno);
      const delPuesto = repartirPorPuesto(todos, [puesto]).get(Number(puesto.id)) || [];
      const t = quienCubre(delPuesto, mesa);
      if (!t) return { status: 200, body: { ok: true, ya_estaba_libre: true } };
      const quedan = t.mesas.filter(m => m !== mesa);
      const w = await escribirMesas(conexion, puesto, t, quedan);
      if (w.conflicto || (!w.creado && !w.actualizado)) return { status: 500, body: { error: 'No se pudo quitar la mesa.' } };
      await registrarAuditoria(req.session.usuario.id, 'quitar_mesa_testigo', 'estructura', t.estructura_id,
        `Antes: ${t.nombre} cubría las mesas ${textoMesas(t.mesas)} del puesto ${puesto.nombre}. `
        + `Ahora: ${textoMesas(quedan)}. Se le quitó la mesa ${mesa}.`, req.ip);
      return { status: 200, body: { ok: true, mesas: quedan, testigo: t.nombre } };
    });
    res.status(r.status).json(r.body);
  } catch (err) {
    if (err.codigo === 'BLOQUEADO') return res.status(409).json({ error: err.message });
    console.error('cobertura/quitar:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo quitar la mesa.' });
  }
});

/* ——— suplentes ————————————————————————————————————————————————————————— */
router.post('/suplentes', async (req, res) => {
  const b = req.body || {};
  try {
    const dueno = await diaD.duenoDeLaCampana(req);
    const puesto = await cargarPuesto(pool, dueno, b.puesto_id);
    if (!puesto) return res.status(404).json({ error: 'Puesto no encontrado.' });
    const usuarioId = Number(b.usuario_id);
    if (!Number.isInteger(usuarioId) || usuarioId < 1) return res.status(400).json({ error: 'Falta la persona.' });
    if (!(await usuarioEsDeLaCampana(pool, dueno, usuarioId))) {
      return res.status(404).json({ error: 'Esa persona no hace parte de esta campaña.' });
    }
    const [r] = await pool.query(
      `INSERT IGNORE INTO dia_d_suplentes_testigo (aspirante_id, puesto_id, usuario_id, creado_por) VALUES (?, ?, ?, ?)`,
      [dueno, puesto.id, usuarioId, req.session.usuario.id]);
    const [[u]] = await pool.query(`SELECT nombre FROM usuarios WHERE id = ?`, [usuarioId]);
    if (r.affectedRows) {
      await registrarAuditoria(req.session.usuario.id, 'agregar_suplente_testigo', 'dia_d_suplentes_testigo', r.insertId,
        `Agregó a ${u ? u.nombre : 'una persona'} como suplente del puesto ${puesto.nombre}.`, req.ip);
    }
    res.json({ ok: true, ya_estaba: !r.affectedRows });
  } catch (err) {
    console.error('cobertura/suplentes:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo agregar el suplente.' });
  }
});

router.delete('/suplentes/:id', async (req, res) => {
  try {
    const dueno = await diaD.duenoDeLaCampana(req);
    const [[s]] = await pool.query(
      `SELECT s.id, s.puesto_id, p.nombre AS puesto, u.nombre FROM dia_d_suplentes_testigo s
         JOIN dia_d_puestos_votacion p ON p.id = s.puesto_id JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.id = ? AND s.aspirante_id = ?`, [Number(req.params.id) || 0, dueno]);
    if (!s) return res.status(404).json({ error: 'Suplente no encontrado.' });
    await pool.query(`DELETE FROM dia_d_suplentes_testigo WHERE id = ?`, [s.id]);
    await registrarAuditoria(req.session.usuario.id, 'quitar_suplente_testigo', 'dia_d_suplentes_testigo', s.id,
      `Quitó a ${s.nombre} como suplente del puesto ${s.puesto}.`, req.ip);
    res.json({ ok: true });
  } catch (err) {
    console.error('cobertura/suplentes/borrar:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo quitar el suplente.' });
  }
});

/** Un suplente pasa a titular de una mesa: es una asignación como cualquier otra (y deja de ser suplente). */
router.post('/suplentes/:id/titular', async (req, res) => {
  try {
    const dueno = await diaD.duenoDeLaCampana(req);
    const [[s]] = await pool.query(
      `SELECT id, puesto_id, usuario_id FROM dia_d_suplentes_testigo WHERE id = ? AND aspirante_id = ?`,
      [Number(req.params.id) || 0, dueno]);
    if (!s) return res.status(404).json({ error: 'Suplente no encontrado.' });
    const puesto = await cargarPuesto(pool, dueno, s.puesto_id);
    if (!puesto) return res.status(404).json({ error: 'Puesto no encontrado.' });
    const r = await asignarMesa({
      dueno, puesto, usuarioId: s.usuario_id, mesa: Number(req.body && req.body.mesa),
      confirmar: !!(req.body && req.body.confirmar === true), actorId: req.session.usuario.id, ip: req.ip,
    });
    res.status(r.status).json(r.body);
  } catch (err) {
    if (err.codigo === 'BLOQUEADO') return res.status(409).json({ error: err.message });
    console.error('cobertura/suplentes/titular:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo volver titular al suplente.' });
  }
});

/* ——— el Excel para acreditar —————————————————————————————————————————— */
/** Separa «nombres» y «apellidos» de un nombre completo. NO es exacto: `usuarios` guarda un solo campo. */
function separarNombre(completo) {
  const t = String(completo || '').trim().split(/\s+/).filter(Boolean);
  if (t.length <= 1) return { nombres: t.join(' '), apellidos: '' };
  if (t.length === 2) return { nombres: t[0], apellidos: t[1] };
  if (t.length === 3) return { nombres: t[0], apellidos: `${t[1]} ${t[2]}` };
  return { nombres: t.slice(0, 2).join(' '), apellidos: t.slice(2).join(' ') };
}

const COLUMNAS_ACREDITACION = [
  'Tipo de documento', 'Número de documento', 'Nombres', 'Apellidos', 'Teléfono', 'Correo',
  'Departamento', 'Municipio', 'Puesto', 'Mesa', 'Titular o suplente', 'Falta',
];

/** Las filas del Excel: una por testigo y mesa, y una por suplente de cada puesto. Exportada para probarla sola. */
async function filasDeAcreditacion(conexion, dueno) {
  const [puestos] = await conexion.query(
    `SELECT id, nombre, cantidad_mesas, ctc_puesto_id FROM dia_d_puestos_votacion WHERE aspirante_id = ? ORDER BY nombre`, [dueno]);
  const testigos = await cargarTestigos(conexion, dueno);
  const porPuesto = repartirPorPuesto(testigos, puestos);
  const ubic = new Map();
  try {
    const catalogo = process.env.CATALOGO_DB || 'territoriosdb';
    const [f] = await conexion.query(
      `SELECT p.id AS puesto_id, m.nombre AS municipio, d.nombre AS departamento
         FROM dia_d_puestos_votacion p
         JOIN ${catalogo}.ctc_puestos_votacion cp ON cp.id = p.ctc_puesto_id
         JOIN ${catalogo}.ctc_territorios m ON m.id = cp.municipio_id
         LEFT JOIN ${catalogo}.ctc_territorios d ON d.id = m.padre_id
        WHERE p.aspirante_id = ?`, [dueno]);
    f.forEach(x => ubic.set(Number(x.puesto_id), x));
  } catch (_) { /* sin catálogo: se usa lo que traiga la ficha del testigo */ }

  const [suplentes] = await conexion.query(
    `SELECT s.puesto_id, u.nombre, u.telefono, u.email, u.numero_identificacion
       FROM dia_d_suplentes_testigo s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.aspirante_id = ? ORDER BY u.nombre`, [dueno]);

  const filas = [];
  const fila = (p, persona, mesa, rol, ficha) => {
    const { nombres, apellidos } = separarNombre(persona.nombre);
    const faltas = [];
    if (!String(persona.numero_identificacion || '').trim()) faltas.push('documento');
    if (!String(persona.telefono || '').replace(/\D/g, '')) faltas.push('teléfono');
    const u = ubic.get(Number(p.id)) || {};
    return {
      'Tipo de documento': persona.numero_identificacion ? 'CC' : '',
      'Número de documento': persona.numero_identificacion || '',
      'Nombres': nombres, 'Apellidos': apellidos,
      'Teléfono': persona.telefono || '', 'Correo': persona.email || '',
      'Departamento': u.departamento || ficha.departamento || '',
      'Municipio': u.municipio || ficha.municipio || '',
      'Puesto': p.nombre, 'Mesa': mesa, 'Titular o suplente': rol,
      'Falta': faltas.length ? `Sin ${faltas.join(' ni ')}` : '',
    };
  };
  for (const p of puestos) {
    for (const t of porPuesto.get(Number(p.id)) || []) {
      const mesas = t.mesas.filter(m => m <= Number(p.cantidad_mesas));
      if (!mesas.length) filas.push(fila(p, t, '', 'Titular (sin mesa)', t));
      for (const m of mesas) filas.push(fila(p, t, m, 'Titular', t));
    }
    for (const s of suplentes.filter(x => Number(x.puesto_id) === Number(p.id))) filas.push(fila(p, s, '', 'Suplente', {}));
  }
  return filas;
}

router.get('/excel', requiereImportarExportar('configuracion'), async (req, res) => {
  try {
    const dueno = await diaD.duenoDeLaCampana(req);
    const filas = await filasDeAcreditacion(pool, dueno);
    const hoja = filas.length
      ? XLSX.utils.json_to_sheet(filas, { header: COLUMNAS_ACREDITACION })
      : XLSX.utils.aoa_to_sheet([COLUMNAS_ACREDITACION]);
    hoja['!cols'] = COLUMNAS_ACREDITACION.map(c => ({ wch: Math.max(12, c.length + 2) }));
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Acreditación');
    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
    await registrarAuditoria(req.session.usuario.id, 'exportar_acreditacion_testigos', 'estructura', 0,
      `Descargó el Excel de acreditación de testigos (${filas.length} filas).`, req.ip);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="acreditacion-de-testigos.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error('cobertura/excel:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo armar el Excel de acreditación.' });
  }
});

/* ——— avisar al testigo ————————————————————————————————————————————————
   NO manda nada: arma la lista y el texto y los entrega a «Enviar SMS», el módulo de mensajería de siempre
   (que ya aplica el horario, la firma, las bajas y el conteo de segmentos). Un canal nuevo habría tenido que
   repetir todo eso, y la regla de «no_contactar» se habría separado el día que alguien arreglara una sola. */
router.get('/avisar', async (req, res) => {
  try {
    const dueno = await diaD.duenoDeLaCampana(req);
    const ids = String(req.query.estructura_ids || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);
    const todos = await cargarTestigos(pool, dueno);
    const puestoId = Number(req.query.puesto_id) || 0;
    let elegidos = ids.length ? todos.filter(t => ids.includes(t.estructura_id)) : todos.filter(t => t.mesas.length);
    if (puestoId) {
      const p = await cargarPuesto(pool, dueno, puestoId);
      if (!p) return res.status(404).json({ error: 'Puesto no encontrado.' });
      const delPuesto = new Set((repartirPorPuesto(elegidos, [p]).get(Number(p.id)) || []).map(t => t.estructura_id));
      elegidos = elegidos.filter(t => delPuesto.has(t.estructura_id));
    }
    res.json({
      destinatarios: elegidos.map(t => ({
        tipo: 'estructura', id: t.estructura_id, nombre: t.nombre, contacto: t.telefono || null,
        detalle: `Testigo · ${t.puesto_texto || ''}${t.mesas.length ? ' · mesa ' + listaEnPalabras(t.mesas) : ''}`,
        dado_de_baja: !!t.no_contactar,
      })),
      plantilla: '{primer_nombre}, testigo en {puesto_testigo}, mesa {mesas_testigo}. {enlace_app}',
    });
  } catch (err) {
    console.error('cobertura/avisar:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo preparar el aviso.' });
  }
});

module.exports = router;
module.exports.filasDeAcreditacion = filasDeAcreditacion;
module.exports.separarNombre = separarNombre;
module.exports.COLUMNAS_ACREDITACION = COLUMNAS_ACREDITACION;
