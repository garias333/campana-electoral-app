/**
 * AVISOS PUSH AUTOMÁTICOS de las alertas del Día D — para que la coordinación se entere sin tener la pantalla abierta.
 *
 * UN PROCESO DE 60 SEGUNDOS (`iniciar`, registrado en app.js como los demás, con `unref()`), que sólo trabaja el día de la
 * elección y entre `apertura − 60 min` y `cierre + plazo del E-14 + 120 min` (lib/jornadaDiaD.js `enVentanaDeAvisos`). Fuera de
 * esa ventana lo ÚNICO que hace es leer la fila de configuración (una consulta por llave primaria) para saberlo: no calcula ni
 * consulta nada más. Con el interruptor `avisos_alertas_push` apagado tampoco.
 *
 * QUÉ SE AVISA: los tipos 1 a 6 de lib/alertasDiaD.js —no «mesa sin testigo sin votantes propios»—, sólo las ACTIVAS (no las
 * «pendiente», que todavía no tocan) y no las ATENDIDAS.
 *
 * A QUIÉN: usuarios activos con el módulo `alertas_dia_d` (el administrador siempre; los demás roles por `permisos_rol`; el
 * aspirante con sublicencia por su lista) que tengan al menos una suscripción push. Quien no tenga dispositivo no entra en la
 * vuelta: no es un error, y se cuenta aparte para el diagnóstico de la pestaña Alertas.
 *
 * CÓMO SE REPARTE: las alertas se calculan UNA vez por campaña (la misma función del GET /api/dia-d/alertas) y se reparten en
 * memoria; sólo quien no ve la campaña entera (un coordinador con su rama) rehace las dos que leen votantes, con una consulta
 * liviana (`alertasParaUsuario`).
 *
 * SIN DUPLICADOS —ni entre vueltas, ni tras un reinicio, ni con dos procesos—: cada (persona, alerta, día) deja una fila en
 * `dia_d_alertas_avisadas` con clave única, y se hace `INSERT IGNORE` ANTES de mandar: sólo se envía lo que de verdad se insertó.
 * Si el envío falla del todo, esas filas se borran para que se reintente en la vuelta siguiente.
 *
 * AGRUPADO: a lo sumo UN push por persona cada 5 minutos. Mientras corre ese plazo las alertas nuevas esperan (no se pierden:
 * todavía no tienen fila) y salen juntas: «3 alertas nuevas: 2 testigos no llegan, 1 mesa sin E-14». Al tocarlo se abre
 * /app/alertas-dia-d.html.
 *
 * UN BLOQUEO CON NOMBRE POR CAMPAÑA (GET_LOCK, sin esperar) para que dos vueltas —o dos instancias— no se pisen.
 *
 * LA BITÁCORA ES MÍNIMA y sin datos personales: una línea por vuelta que hizo algo, con conteos.
 */
'use strict';

const pool = require('../config/db');
const jornada = require('./jornadaDiaD');
const push = require('../config/push');
const { calcularAlertas, alertasParaUsuario } = require('./alertasDiaD');
const { cargoDeLaMadre } = require('../config/cargoMadre');
const { duenoDeLaCampana } = require('./ramas');

const MINUTOS_ENTRE_AVISOS = 5;
const URL_DE_LAS_ALERTAS = '/app/alertas-dia-d.html';
const INTERVALO_MS = 60 * 1000;

/** Los tipos que se avisan por push: del 1 al 6. */
const TIPOS_AVISADOS = new Set([
  'mesa_sin_testigo_con_votantes', 'testigo_no_llego', 'mesa_sin_e14',
  'reporte_con_alertas', 'diferencia_con_oficial', 'baja_votacion',
]);

/** Cómo se dice cada tipo en el texto del push: [uno, varios]. */
const FRASES = {
  mesa_sin_testigo_con_votantes: ['mesa sin testigo', 'mesas sin testigo'],
  testigo_no_llego: ['testigo no llega', 'testigos no llegan'],
  mesa_sin_e14: ['mesa sin E-14', 'mesas sin E-14'],
  reporte_con_alertas: ['reporte con alertas', 'reportes con alertas'],
  diferencia_con_oficial: ['diferencia con el oficial', 'diferencias con el oficial'],
  baja_votacion: ['puesto con baja votación', 'puestos con baja votación'],
};
const ORDEN = Object.keys(FRASES);

/** «3 alertas nuevas: 2 testigos no llegan, 1 mesa sin E-14». `porTipo` es { tipo: cantidad }. */
function textoDelAviso(porTipo) {
  const total = Object.values(porTipo).reduce((n, c) => n + c, 0);
  const partes = ORDEN.filter(t => porTipo[t] > 0).map(t => `${porTipo[t]} ${FRASES[t][porTipo[t] === 1 ? 0 : 1]}`);
  return `${total} ${total === 1 ? 'alerta nueva' : 'alertas nuevas'}: ${partes.join(', ')}`;
}

/**
 * Los usuarios que RECIBIRÍAN avisos (con el módulo), con cuántos dispositivos tienen. Los que tienen 0 son el diagnóstico
 * «N coordinadores sin avisos activados»; los que tienen ≥ 1, los destinatarios de la vuelta.
 */
async function destinatarios(conexion = pool) {
  const sql = (conSublicencias) => `
    SELECT u.id, u.nombre, u.telefono, u.territorio_id, r.nombre AS rol,
           ${conSublicencias ? '(SELECT sl.id FROM sublicencias sl WHERE sl.usuario_id = u.id AND sl.activa = 1 LIMIT 1)' : 'NULL'} AS sublicencia_id,
           ${conSublicencias ? '(SELECT sl.nombre FROM sublicencias sl WHERE sl.usuario_id = u.id AND sl.activa = 1 LIMIT 1)' : 'NULL'} AS sublicencia_nombre,
           (SELECT COUNT(*) FROM push_suscripciones ps WHERE ps.usuario_id = u.id) AS dispositivos
      FROM usuarios u JOIN roles r ON r.id = u.rol_id
     WHERE u.activo = 1 AND u.es_superadmin = 0
       AND (r.nombre = 'admin'
            OR EXISTS (SELECT 1 FROM permisos_rol p WHERE p.rol = r.nombre AND p.modulo = 'alertas_dia_d' AND p.permitido = 1)
            ${conSublicencias ? 'OR EXISTS (SELECT 1 FROM sublicencias s2 WHERE s2.usuario_id = u.id AND s2.activa = 1)' : ''})
     ORDER BY u.nombre`;
  let filas;
  try {
    [filas] = await conexion.query(sql(true));
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') throw err;       // una base sin sublicencias sigue como siempre
    [filas] = await conexion.query(sql(false));
  }
  return filas.map(f => ({ ...f, dispositivos: Number(f.dispositivos) || 0 }));
}

/** El alcance de un usuario, como lo arma `calcularAlcance` (middleware/auth.js). */
function alcanceDe(u, cargoMadre) {
  if (u.sublicencia_id) return { usuarioId: u.id, cargo: 'aspirante', territorioId: u.territorio_id };
  if (u.rol === 'admin') return { cargo: 'madre', cargoMadre };
  return { usuarioId: u.id, territorioId: u.territorio_id, cargo: u.rol, cargoMadre };
}

/** De qué campaña es cada usuario: la rama del aspirante, o la principal (0). */
async function duenoDe(u, conexion = pool) {
  if (u.sublicencia_id) return u.id;
  return duenoDeLaCampana(conexion, { session: { usuario: { id: u.id } }, sublicencia: null });
}

/** Una petición «de la campaña entera», para calcular las alertas una sola vez. */
function peticionDeLaCampana(dueno, cargoMadre, aspirante) {
  if (dueno) {
    return { session: { usuario: { id: dueno, rol: 'lider', es_aspirante: true } },
      sublicencia: { usuario_id: dueno, nombre: aspirante && aspirante.sublicencia_nombre }, alcance: { cargo: 'aspirante', usuarioId: dueno } };
  }
  return { session: { usuario: { id: 0, rol: 'admin' } }, sublicencia: null, alcance: { cargo: 'madre', cargoMadre } };
}

const fechaHace = (minutos, reloj) => jornada.ahoraColombia(new Date(reloj().getTime() - minutos * 60000)).texto + ':00';

/**
 * Una vuelta. Devuelve un resumen con conteos (nada personal), útil para la bitácora y para las pruebas.
 * @param {{ahora?:object, reloj?:Function}} [o]
 */
async function vuelta(o = {}) {
  const reloj = o.reloj || jornada.reloj;
  const ahora = o.ahora || jornada.ahoraColombia(reloj());
  const resumen = { omitida: null, campanas: 0, usuarios: 0, alertas: 0, avisos: 0, enviados: 0, fallidos: 0, sin_dispositivo: 0 };

  const cfg = await jornada.leerJornada(pool);
  if (!jornada.enVentanaDeAvisos(cfg, ahora)) { resumen.omitida = 'fuera_de_ventana'; return resumen; }
  if (!cfg.avisos_alertas_push) { resumen.omitida = 'apagado'; return resumen; }
  if (!push.estadoCanal().configurado) { resumen.omitida = 'push_sin_configurar'; return resumen; }

  const todos = await destinatarios(pool);
  resumen.sin_dispositivo = todos.filter(u => u.dispositivos === 0).length;
  const lista = todos.filter(u => u.dispositivos > 0);
  if (!lista.length) { resumen.omitida = 'sin_destinatarios'; return resumen; }

  let cargoMadre = null;
  try { cargoMadre = await cargoDeLaMadre(); } catch (_) { /* sin cargo, como en calcularAlcance */ }

  // Por campaña (la rama de cada aspirante, y la principal).
  const porCampana = new Map();
  for (const u of lista) {
    const d = await duenoDe(u, pool);
    if (!porCampana.has(d)) porCampana.set(d, []);
    porCampana.get(d).push(u);
  }

  for (const [dueno, usuarios] of porCampana) {
    const conexion = await pool.getConnection();
    const bloqueo = `diad_avisos_${dueno}`;
    let tomado = false;
    try {
      const [[b]] = await conexion.query('SELECT GET_LOCK(?, 0) AS tomado', [bloqueo]);
      tomado = Number(b && b.tomado) === 1;
      if (!tomado) continue;                                   // otra vuelta (u otra instancia) está con esta campaña
      resumen.campanas++;

      const aspirante = usuarios.find(u => u.sublicencia_id && u.id === dueno);
      const base = await calcularAlertas(peticionDeLaCampana(dueno, cargoMadre, aspirante), { conContexto: true });
      resumen.alertas += base.alertas.filter(a => TIPOS_AVISADOS.has(a.tipo) && a.estado === 'activa' && !a.atendida).length;

      for (const u of usuarios) {
        resumen.usuarios++;
        try {
          const visibles = await alertasParaUsuario(base, alcanceDe(u, cargoMadre), pool);
          const candidatas = visibles
            .filter(a => TIPOS_AVISADOS.has(a.tipo) && a.estado === 'activa' && !a.atendida)
            .map(a => ({ ...a, clave: `${a.id}|${ahora.fecha}` }));
          if (!candidatas.length) continue;

          // Las que todavía no se le han avisado a esta persona.
          const yaAvisadas = new Set();
          for (let i = 0; i < candidatas.length; i += 500) {
            const [f] = await pool.query(
              `SELECT clave FROM dia_d_alertas_avisadas WHERE usuario_id = ? AND clave IN (?)`,
              [u.id, candidatas.slice(i, i + 500).map(c => c.clave)]);
            f.forEach(x => yaAvisadas.add(x.clave));
          }
          const nuevas = candidatas.filter(c => !yaAvisadas.has(c.clave));
          if (!nuevas.length) continue;

          // A lo sumo un push cada 5 minutos por persona: las nuevas esperan (no se pierden) y salen juntas.
          const [[reciente]] = await pool.query(
            `SELECT COUNT(*) AS n FROM dia_d_alertas_avisadas WHERE usuario_id = ? AND avisada_en > ?`,
            [u.id, fechaHace(MINUTOS_ENTRE_AVISOS, reloj)]);
          if (Number(reciente.n) > 0) continue;

          // INSERT IGNORE ANTES de mandar: sólo se manda lo que de verdad se insertó.
          const insertadas = [];
          for (const c of nuevas) {
            const [r] = await pool.query(
              `INSERT IGNORE INTO dia_d_alertas_avisadas (aspirante_id, usuario_id, clave, avisada_en) VALUES (?, ?, ?, ?)`,
              [dueno, u.id, c.clave, `${ahora.texto}:00`]);
            if (r.affectedRows) insertadas.push(c);
          }
          if (!insertadas.length) continue;

          const porTipo = {};
          insertadas.forEach(c => { porTipo[c.tipo] = (porTipo[c.tipo] || 0) + 1; });
          try {
            await push.enviarAUsuario(u.id, { titulo: 'Alertas del Día D', cuerpo: textoDelAviso(porTipo), url: URL_DE_LAS_ALERTAS });
            resumen.enviados++;
            resumen.avisos += insertadas.length;
          } catch (err) {
            // Falló en TODOS sus dispositivos: se devuelven las alertas a «sin avisar» para reintentar en la vuelta siguiente.
            resumen.fallidos++;
            await pool.query(`DELETE FROM dia_d_alertas_avisadas WHERE usuario_id = ? AND clave IN (?)`,
              [u.id, insertadas.map(c => c.clave)]).catch(() => {});
          }
        } catch (err) {
          // Una persona con problemas no tumba la vuelta de las demás.
          resumen.fallidos++;
          console.error('[avisos-alertas] fallo con un destinatario:', err.code || err.message);
        }
      }
    } finally {
      if (tomado) { try { await conexion.query('SELECT RELEASE_LOCK(?)', [bloqueo]); } catch (_) { /* la conexión ya no sirve */ } }
      conexion.release();
    }
  }
  return resumen;
}

let enCurso = false;

/** Arranca el proceso periódico. Se llama una vez, desde app.js. Devuelve el temporizador (con unref). */
function iniciar() {
  const correr = async () => {
    if (enCurso) return;                                  // una vuelta lenta no se solapa con la siguiente
    enCurso = true;
    const t0 = Date.now();
    try {
      const r = await vuelta();
      if (!r.omitida && r.usuarios > 0) {
        console.log(`[avisos-alertas] campañas ${r.campanas}, destinatarios ${r.usuarios}, alertas ${r.alertas}, `
          + `avisos enviados ${r.enviados} (${r.avisos} alertas), fallidos ${r.fallidos}, ${Date.now() - t0} ms`);
      }
    } catch (err) {
      console.error('[avisos-alertas] error en la vuelta:', err.code || err.message);
    } finally {
      enCurso = false;
    }
  };
  return setInterval(correr, INTERVALO_MS).unref();
}

module.exports = {
  iniciar, vuelta, destinatarios, duenoDe, textoDelAviso, TIPOS_AVISADOS, MINUTOS_ENTRE_AVISOS, URL_DE_LAS_ALERTAS,
};
