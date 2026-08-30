/**
 * EQUIPOS AUTORIZADOS — que solo se entre desde los computadores de la campaña.
 *
 * ---------------------------------------------------------------------------
 * QUÉ ES UN «EQUIPO» AQUÍ, Y QUÉ NO SE PUEDE PROMETER
 *
 * Esto es una aplicación web: no corre en el computador del cliente, corre en
 * el VPS y él la abre con un navegador. Desde un navegador NO existe nada
 * parecido a `/etc/machine-id` —ni número de serie, ni MAC, ni disco—; todos
 * los navegadores lo bloquean a propósito. Así que un «equipo» no se puede
 * medir: hay que MARCARLO.
 *
 * Se le entrega una cookie firmada de larga duración con un identificador al
 * azar. Firmada con HMAC-SHA256 para que nadie invente una, pero lo que decide
 * si ese equipo entra o no vive en la BASE DE DATOS, no en la cookie: así se
 * puede revocar desde el panel, que es la mitad del pedido.
 *
 * LÍMITES HONESTOS, para no vender lo que no es:
 *   · Borrar los datos del navegador borra la marca: ese equipo vuelve a pedir
 *     autorización. Es el precio de que no exista un identificador real.
 *   · Un mismo computador con dos navegadores son dos equipos. Y un navegador
 *     en modo incógnito es un equipo nuevo cada vez.
 *   · Quien controle su navegador puede copiar la cookie a otra máquina. No
 *     hay forma de impedirlo desde la web.
 *
 * Lo que SÍ consigue —y es para lo que sirve una licencia comercial— es que
 * compartir el acceso deje de ser gratis y silencioso: hay que hacerlo a
 * propósito, y cada equipo queda registrado con su fecha, su navegador y quién
 * entró desde él.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ NO SE REUSA `config/tokenDispositivo.js`
 *
 * Aquel identifica a un USUARIO en un celular compartido —«esta persona ya
 * entró aquí antes»— y vive en `localStorage`, legible por JavaScript, un
 * compromiso que su propia cabecera declara y explica. Éste identifica a una
 * MÁQUINA y decide si se entra o no: va en cookie `httpOnly`, que JavaScript
 * no puede leer. Son dos cosas distintas con dos riesgos distintos; juntarlas
 * habría rebajado ésta al nivel de aquella.
 *
 * ---------------------------------------------------------------------------
 * LA REGLA, Y POR QUÉ FALLA ABIERTO
 *
 * El límite (`max_equipos`) lo manda el Servidor de Licencias en la misma
 * respuesta de validación por la que ya viajan las sublicencias, y se guarda
 * en `licencia_equipos_config`. Mientras no llegue ninguno —hoy, y en toda
 * campaña cuya licencia no lo defina— `max_equipos` es 0 y ESTO NO RESTRINGE
 * NADA: se limita a registrar qué equipos entran.
 *
 * Eso es deliberado. Dejar a una campaña entera fuera de su propia aplicación
 * el día de las elecciones porque el servidor de licencias tuvo un problema
 * sería mucho peor que el abuso que esto previene. Se restringe solo cuando
 * hay una regla explícita y vigente que decir.
 */
const crypto = require('crypto');
const pool = require('./db');

const NOMBRE_COOKIE = 'equipo';
const DURACION_MS = 2 * 365 * 24 * 60 * 60 * 1000;   // dos años: un equipo no se re-autoriza cada mes

/** Identificador nuevo, firmado. El azar es de 16 bytes: 2^128 posibilidades. */
function crearIdentificador() {
  const id = crypto.randomBytes(16).toString('base64url');
  const firma = crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(id).digest('base64url');
  return `${id}.${firma}`;
}

/** Devuelve el id si la firma es auténtica, o null. No consulta la base. */
function leerIdentificador(valor) {
  if (!valor || typeof valor !== 'string') return null;
  const corte = valor.lastIndexOf('.');
  if (corte < 1) return null;
  const id = valor.slice(0, corte);
  const firma = valor.slice(corte + 1);
  const esperada = crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(id).digest('base64url');
  /* Comparación en tiempo constante: un `===` normal delata la firma por lo
     que tarda en fallar. Mismo criterio que `secretoValido` del actualizador. */
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? id : null;
}

/**
 * La cookie, leída del encabezado a mano.
 *
 * Esta aplicación NO usa `cookie-parser` —comprobado—, así que `req.cookies`
 * no existe. Agregarlo habría sido una dependencia nueva que las tres
 * instalaciones tendrían que instalar al aplicar el parche, y un `npm install`
 * que falle deja la actualización a medias. Leer UNA cookie del encabezado son
 * cinco líneas y ningún riesgo. `res.cookie()` sí es de Express y funciona sin
 * el parser: solo la lectura lo necesitaba.
 */
function cookieDelEncabezado(req, nombre) {
  const crudo = req && req.headers && req.headers.cookie;
  if (!crudo) return null;
  for (const parte of crudo.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nombre) {
      try { return decodeURIComponent(parte.slice(i + 1).trim()); } catch (_) { return null; }
    }
  }
  return null;
}

/** El límite vigente. 0 —o sin fila— significa «sin restricción». */
/**
 * QUÉ EQUIPOS CONTROLA ESTA LICENCIA: los de quien la administra, y solo esos.
 *
 * El control existe para que una licencia vendida no se pueda correr desde
 * cualquier computador — es una protección sobre la licencia, no sobre las
 * personas. Quien podría prestarla es quien administra la campaña; un líder
 * entrando desde su celular en la calle no está activando ninguna licencia.
 *
 * SE APLICABA A TODO EL MUNDO, Y ESO LO ROMPÍA. Medido en la campaña de
 * prueba municipal el 30 de agosto de 2026: 37 líderes, 10 coordinadores, 3
 * sublíderes, 2 aspirantes al Concejo y 1 testigo —53 personas de campo—
 * contra 2 administradores, con un cupo de 2 equipos. Cada celular gastaba
 * una plaza, así que el cupo se llenaba con los dos primeros teléfonos y a
 * partir de ahí no entraba nadie. De hecho los dos equipos que quedaron
 * bloqueados eran de aspirantes al Concejo, ninguno de un administrador.
 *
 * `admin` Y NADIE MÁS, de momento. Coordinador y asistente administrativo
 * también trabajan desde equipos de la campaña y se podrían añadir aquí; se
 * dejaron fuera porque son 10 en una campaña municipal y volverían a llenar
 * el cupo. Si algún día se quieren dentro, se agregan a esta lista y no hay
 * que tocar nada más.
 */
const ROLES_CON_CONTROL_DE_EQUIPO = ['admin'];

/**
 * ¿A esta persona se le controla el equipo desde el que entra?
 *
 * El rol manda, con una excepción declarada: quien tiene sublicencia activa
 * NUNCA se controla, aunque su rol figure entre los de arriba. Un aspirante
 * al Concejo es dueño de su propia campaña y entra desde su celular; su
 * equipo no es «un computador de la licencia principal».
 */
async function equipoControlado(usuario) {
  if (!usuario || !ROLES_CON_CONTROL_DE_EQUIPO.includes(usuario.rol)) return false;
  /* La consulta de sublicencia se hace AQUÍ Y NO ANTES, para que solo la
     paguen los pocos roles controlados. Puesta al principio, correría en cada
     inicio de sesión de los 53 usuarios de campo para responder siempre lo
     mismo. Y si la tabla no existe —una instalación sin sublicencias— se
     asume que no hay: no tenerla no puede convertirse en un bloqueo. */
  try {
    const [[fila]] = await pool.query(
      'SELECT 1 AS hay FROM sublicencias WHERE usuario_id = ? AND activa = 1 LIMIT 1', [usuario.id]);
    return !fila;
  } catch (_) {
    return true;
  }
}

async function limiteVigente() {
  try {
    const [[c]] = await pool.query('SELECT max_equipos, requiere_aprobacion FROM licencia_equipos_config WHERE id = 1');
    return { max: (c && Number(c.max_equipos)) || 0, requiereAprobacion: !!(c && c.requiere_aprobacion) };
  } catch (_) {
    return { max: 0, requiereAprobacion: false };   // sin tabla: no se restringe
  }
}

/**
 * Reconoce el equipo desde el que llega esta petición y decide si puede entrar.
 *
 * Se llama AL INICIAR SESIÓN, no en cada petición: cortar a media jornada a
 * quien ya está trabajando no protege nada y sí arruina un día de campaña.
 *
 * Devuelve `{ permitido, motivo, equipo }`. Cuando permite, deja la cookie
 * puesta si hacía falta.
 */
async function reconocerEquipo(req, res, usuarioId) {
  const { max, requiereAprobacion } = await limiteVigente();

  let id = leerIdentificador(cookieDelEncabezado(req, NOMBRE_COOKIE));
  let esNuevo = false;
  if (!id) {
    const nuevo = crearIdentificador();
    id = leerIdentificador(nuevo);
    esNuevo = true;
    res.cookie(NOMBRE_COOKIE, nuevo, {
      httpOnly: true,                                   // JavaScript no lo puede leer ni robar
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: DURACION_MS,
      path: '/',
    });
  }

  const agente = String((req.headers && req.headers['user-agent']) || '').slice(0, 250);
  const ip = String((req.headers && req.headers['x-forwarded-for']) || req.ip || '').split(',')[0].trim().slice(0, 45);

  try {
    const [[equipo]] = await pool.query(
      'SELECT id, estado, nombre FROM equipos_autorizados WHERE identificador = ?', [id]);

    if (equipo) {
      /* `NULLIF(?, '')` PARA NO PISAR LO BUENO CON LO VACÍO.
         Detrás de un proxy no siempre llega `x-forwarded-for`, y una petición
         sin él escribía una IP vacía encima de la que sí se había registrado
         antes: en el panel se vería un equipo sin procedencia. Con esto, un
         dato ausente deja lo que ya había. Medido escribiéndolo. */
      await pool.query(
        `UPDATE equipos_autorizados
            SET ultimo_uso = NOW(),
                ultimo_usuario_id = COALESCE(?, ultimo_usuario_id),
                user_agent = COALESCE(NULLIF(?, ''), user_agent),
                ultima_ip  = COALESCE(NULLIF(?, ''), ultima_ip)
          WHERE id = ?`, [usuarioId || null, agente, ip, equipo.id]);
      if (equipo.estado === 'revocado') {
        return { permitido: false, motivo: 'revocado', equipo };
      }
      if (equipo.estado === 'pendiente') {
        return { permitido: false, motivo: 'pendiente', equipo };
      }
      return { permitido: true, equipo };
    }

    /* EQUIPO NUEVO. Si no hay límite, se registra autorizado y ya: sirve para
       que el panel pueda mostrar desde dónde se entra, que es el paso previo a
       poder decidir. Con límite, se cuenta cuántos hay ya autorizados. */
    let estado = 'autorizado';
    if (max > 0) {
      const [[{ n }]] = await pool.query(
        `SELECT COUNT(*) AS n FROM equipos_autorizados WHERE estado = 'autorizado'`);
      if (n >= max || requiereAprobacion) estado = 'pendiente';
    }

    const [ins] = await pool.query(
      `INSERT INTO equipos_autorizados
         (identificador, estado, nombre, primer_uso, ultimo_uso, ultimo_usuario_id, user_agent, ultima_ip)
       VALUES (?, ?, NULL, NOW(), NOW(), ?, ?, ?)`,
      [id, estado, usuarioId || null, agente, ip]);

    if (estado === 'autorizado') return { permitido: true, equipo: { id: ins.insertId, estado } };
    return { permitido: false, motivo: max > 0 && !requiereAprobacion ? 'cupo_lleno' : 'pendiente',
             equipo: { id: ins.insertId, estado } };
  } catch (err) {
    /* SIN TABLA —o con cualquier fallo de base— SE DEJA ENTRAR. Ver la nota de
       la cabecera: el riesgo de dejar fuera a una campaña entera por un
       problema nuestro es mayor que el del acceso que esto controla. */
    if (err.code !== 'ER_NO_SUCH_TABLE') {
      console.error('Equipos autorizados (se deja entrar):', err.message);
    }
    return { permitido: true, equipo: null, sinControl: true, esNuevo };
  }
}

/**
 * Los equipos de esta instalación, para reportarlos al Servidor de Licencias.
 *
 * Se mandan TODOS, no solo los nuevos: la validación es periódica y la lista
 * completa es idempotente. Mandar solo lo nuevo obligaría a llevar la cuenta
 * de qué se reportó ya, y esa cuenta se desincroniza en cuanto una validación
 * falla a medias.
 */
async function equiposParaReportar() {
  try {
    const [filas] = await pool.query(
      `SELECT e.identificador, e.estado, e.primer_uso, e.ultimo_uso,
              e.user_agent, e.ultima_ip, u.nombre AS ultimo_usuario
         FROM equipos_autorizados e
         LEFT JOIN usuarios u ON u.id = e.ultimo_usuario_id
        ORDER BY e.ultimo_uso DESC
        LIMIT 200`);
    return filas;
  } catch (_) {
    return [];   // sin tabla: no hay nada que contar
  }
}

/**
 * Aplica lo que responde el Servidor de Licencias: el cupo y el estado de cada
 * equipo. Es lo que hace que revocar desde el panel surta efecto solo.
 *
 * SOLO SE ESCRIBE LO QUE CAMBIA. `actualizado_en` de la configuración es un
 * dato que alguien mira; tocarlo en cada validación —cada pocas horas— lo
 * convertiría en ruido. Mismo criterio que `recalcularTodas`.
 */
async function aplicarRespuestaDeLicencia(config, estados) {
  const resumen = { cupo: null, cambiados: 0 };
  try {
    if (config && typeof config.max_equipos === 'number') {
      const [r] = await pool.query(
        `UPDATE licencia_equipos_config
            SET max_equipos = ?, requiere_aprobacion = ?
          WHERE id = 1 AND (max_equipos <> ? OR requiere_aprobacion <> ?)`,
        [config.max_equipos, config.requiere_aprobacion ? 1 : 0,
         config.max_equipos, config.requiere_aprobacion ? 1 : 0]);
      if (r.affectedRows) resumen.cupo = config.max_equipos;
    }
    if (Array.isArray(estados)) {
      for (const e of estados) {
        if (!e || !e.identificador) continue;
        if (!['autorizado', 'pendiente', 'revocado'].includes(e.estado)) continue;
        /* SE COMPARA EN JAVASCRIPT Y NO EN EL `WHERE`.
           La primera versión metía la comparación en la condición del UPDATE y
           salía una expresión con `<=>` y `IS NOT NULL` que había que leer dos
           veces para saber qué hacía — y que probablemente no hacía eso. Dos
           consultas claras valen más que una consulta ingeniosa: esto corre
           cada pocas horas sobre una lista de unos pocos equipos. */
        const [[actual]] = await pool.query(
          'SELECT estado, nombre FROM equipos_autorizados WHERE identificador = ?', [e.identificador]);
        if (!actual) continue;                       // un equipo que aquí ya no existe
        const nombreNuevo = e.nombre || actual.nombre;
        if (actual.estado === e.estado && actual.nombre === nombreNuevo) continue;
        await pool.query(
          'UPDATE equipos_autorizados SET estado = ?, nombre = ? WHERE identificador = ?',
          [e.estado, nombreNuevo, e.identificador]);
        resumen.cambiados++;
      }
    }
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') console.error('Aplicando equipos de la licencia:', err.message);
  }
  return resumen;
}

/** El mensaje que ve la persona. Dice qué pasa y qué hacer, no solo que no. */
function mensajeDeRechazo(motivo) {
  if (motivo === 'revocado') {
    return 'Este equipo ya no está autorizado para esta campaña. Pida que lo autoricen de nuevo.';
  }
  if (motivo === 'cupo_lleno') {
    return 'Esta licencia ya tiene todos sus equipos autorizados en uso. Para entrar desde éste, '
         + 'hay que liberar uno de los anteriores.';
  }
  return 'Este equipo todavía no está autorizado. Quedó registrado: pida que lo aprueben y vuelva a entrar.';
}

module.exports = {
  equipoControlado,
  ROLES_CON_CONTROL_DE_EQUIPO,
  reconocerEquipo, mensajeDeRechazo, limiteVigente,
  equiposParaReportar, aplicarRespuestaDeLicencia,
  crearIdentificador, leerIdentificador, NOMBRE_COOKIE,
};
