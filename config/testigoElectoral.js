const bcrypt = require('bcryptjs');
const { geocodificarDireccion } = require('./geocoder');
const { aspiranteDe, subarbolSql, filtroTestigosMadre } = require('../lib/ramas');
const { normalizarCedula, buscarFichaPorCedula, buscarUsuarioPorCedula } = require('../lib/normalizarCedula');

/**
 * A diferencia de Coordinador/Líder (que se georreferencian por su
 * dirección de RESIDENCIA), el formulario de Testigo electoral no pide
 * esa dirección — lo único que tiene es el Puesto de votación donde
 * vigila. Se geocodifica buscando el NOMBRE del puesto (con
 * Municipio/Departamento como ancla), ya que los puestos de votación
 * suelen ser instituciones conocidas (colegios, coliseos, etc.) que el
 * buscador de mapas sí reconoce por nombre, igual que una dirección.
 * Nunca hace fallar la creación/edición del testigo si el servicio no
 * responde o no encuentra nada.
 */
async function geocodificarTestigoPorPuestoYGuardar(pool, estructuraId, puestoVotacion, municipioVotacion, departamentoVotacion) {
  if (!puestoVotacion || !puestoVotacion.trim()) return { geocodificado: false };
  try {
    const resultado = await geocodificarDireccion({
      calle: puestoVotacion.trim(),
      ciudad: municipioVotacion || null,
      departamento: departamentoVotacion || null
    });
    if (!resultado) return { geocodificado: false };
    await pool.query(
      `UPDATE estructura SET latitud = ?, longitud = ?, geocodificado_en = NOW() WHERE id = ?`,
      [resultado.latitud, resultado.longitud, estructuraId]
    );
    return { geocodificado: true, ...resultado };
  } catch (err) {
    console.error('Error geocodificando testigo por puesto de votación:', err);
    return { geocodificado: false };
  }
}

/**
 * Revisa si alguna de las mesas que se quieren asignar (una sola, para
 * Testigo electoral, o varias, para Coordinador de puesto) ya está cubierta
 * por OTRO testigo del mismo puesto de votación — para no dejar que dos
 * personas queden asignadas a la misma mesa por error. Devuelve la lista de
 * números de mesa en conflicto (vacía si no hay ninguno).
 */
/* CADA CAMPANA OCUPA SUS PROPIAS MESAS.
   Antes esta comprobacion miraba todos los testigos de la base, asi que el
   testigo de la campana madre en la mesa 3 le impedia al aspirante poner el
   suyo en la mesa 3 del mismo puesto. Y eso no es un conflicto: cada campana
   pone su propio testigo en cada mesa — de eso se trata la figura.
   El dueno se deduce de la persona que se esta nombrando, subiendo por la
   cadena de mando hasta el aspirante mas cercano; si no cuelga de ninguno, es
   de la campana principal. */
async function verificarMesasDisponibles(pool, puesto, mesasSolicitadas, excluirEstructuraId, duenoCampana = 0) {
  const mesas = (mesasSolicitadas || []).map(Number).filter(m => Number.isInteger(m) && m > 0);
  if (!puesto || !mesas.length) return [];
  // Mismo criterio que /dia-d/mesas-ocupadas: se cruza por id, no por texto.
  const [[p]] = await pool.query(
    `SELECT id FROM dia_d_puestos_votacion WHERE nombre = ? AND aspirante_id = ?`,
    [puesto, duenoCampana || 0]);
  // Puesto desconocido: no se puede afirmar que haya conflicto.
  if (!p) return [];

  const acota = duenoCampana
    ? subarbolSql(duenoCampana, 'e.usuario_id')
    : await filtroTestigosMadre(pool, 'e.usuario_id');

  // COALESCE porque el puesto/mesa del testigo puede estar en dos sitios:
  // en "estructura" si la persona tiene otro cargo y ADEMÁS es testigo (así
  // no se le pisa su lugar de votación real), o en "usuarios" si es un
  // testigo puro creado desde la pantalla de Testigos. Mirar uno solo
  // dejaría mesas ocupadas sin detectar y pondría a dos personas en la misma.
  const [filas] = await pool.query(
    `SELECT e.id, e.tipo_testigo,
            COALESCE(e.mesa_votacion, u.mesa_votacion) AS mesa_votacion,
            e.mesas_asignadas
     FROM estructura e JOIN usuarios u ON u.id = e.usuario_id
     WHERE e.cargo = 'testigo' AND COALESCE(e.puesto_id, u.puesto_id) = ? AND e.id != ?
       ${acota ? 'AND ' + acota.sql : ''}`,
    acota ? [p.id, excluirEstructuraId || 0, ...acota.valores]
          : [p.id, excluirEstructuraId || 0]
  );
  const ocupadas = new Set();
  for (const f of filas) {
    if (f.tipo_testigo === 'puesto') {
      (f.mesas_asignadas || []).forEach(m => ocupadas.add(Number(m)));
    } else if (f.mesa_votacion) {
      ocupadas.add(Number(f.mesa_votacion));
    }
  }
  return mesas.filter(m => ocupadas.has(m));
}

/**
 * Ubica un puesto de la campaña dentro del Catálogo Territorial, para
 * saber en qué Departamento/Municipio queda. Se usa solo para
 * geocodificar y para mostrar la ubicación del testigo; no es
 * indispensable.
 *
 * Un puesto escrito a mano (antes de que existiera el catálogo) no tiene
 * `ctc_puesto_id` y devuelve nulos: preferible eso a inventarle una
 * ubicación. Lo mismo si esta instalación todavía no tiene permiso de
 * lectura sobre el catálogo — no se deja caer la asignación del testigo
 * por eso.
 */
/* RECIBE EL DUEÑO, y sin el se equivocaba de fila.
   Busca por NOMBRE, y desde que cada campaña tiene su propia lista hay dos
   filas distintas con el mismo. Si una de las dos se escribio a mano —sin
   enlace al catalogo— y MySQL devolvia esa, los JOIN no casaban y el testigo
   se quedaba sin departamento ni municipio, en silencio: la asignacion se
   guardaba igual, solo que a medias. */
async function ubicacionDelPuestoDeCampana(pool, nombrePuesto, dueno = 0) {
  const vacio = { departamento: null, municipio: null };
  if (!nombrePuesto || !nombrePuesto.trim()) return vacio;
  const catalogo = process.env.CATALOGO_DB || 'territoriosdb';
  try {
    const [[fila]] = await pool.query(
      `SELECT d.nombre AS departamento, m.nombre AS municipio
         FROM dia_d_puestos_votacion c
         JOIN ${catalogo}.ctc_puestos_votacion p ON p.id = c.ctc_puesto_id
         JOIN ${catalogo}.ctc_territorios     m ON m.id = p.municipio_id
         JOIN ${catalogo}.ctc_territorios     d ON d.id = m.padre_id
        WHERE c.nombre = ? AND c.aspirante_id = ?
        LIMIT 1`,
      [nombrePuesto.trim(), dueno]
    );
    return fila || vacio;
  } catch (err) {
    console.error('No se pudo ubicar el puesto en el catálogo territorial:', err.message);
    return vacio;
  }
}

/**
 * Asegura que un usuario ya existente (con su propio login, sea cual sea
 * su rol principal) también tenga una fila de Estructura territorial con
 * cargo='testigo' — sin tocar ninguna otra fila de Estructura que ya
 * tenga (Líder, Sublíder, etc.). Es lo que permite que la misma persona
 * sea, por ejemplo, Líder Y testigo electoral a la vez (ver
 * tieneDobleRolTestigo en routes/auth.routes.js, que usa esta doble
 * condición para preguntar con cuál capacidad entrar al iniciar sesión).
 *
 * El Puesto/Mesa donde VIGILA se guarda en la propia fila de "estructura",
 * NO en las columnas de "usuarios". Son dos cosas distintas: una persona
 * puede votar en un puesto y ser testigo en otro. Antes se escribían
 * encima del lugar de votación real y se perdía ese dato.
 *
 * (El testigo puro, creado desde la pantalla de Testigos, sigue guardando
 * en "usuarios": no tiene un lugar de votación aparte que proteger. Por
 * eso las consultas leen COALESCE de los dos lados.)
 *
 * SI YA ERA TESTIGO Y SE PIDE `actualizarSiExiste`, se le cambia el
 * puesto/mesa en vez de no hacer nada. Antes esta función se devolvía de
 * inmediato en ese caso, así que cambiarle el puesto a un testigo
 * existente no guardaba nada: el formulario aceptaba el cambio, no daba
 * ningún error, y al volver a abrirlo seguía igual que antes.
 *
 * Ese permiso va por parámetro y no por omisión a propósito. Al EDITAR a
 * una persona, actualizar es lo que se espera. Pero al CREAR un testigo
 * nuevo desde la pantalla de Testigos con una cédula que ya es testigo,
 * lo correcto es avisar del duplicado, no reescribirle el puesto a otra
 * persona sin que nadie lo pida.
 */
/**
 * DE QUIEN CUELGA EL TESTIGO. Sin esto la fila nacia con `supervisor_id` en
 * NULL, o sea colgando de nadie, y eso rompia las dos direcciones a la vez:
 * el aspirante no veia sus propios testigos -su subarbol baja por
 * supervisor_id y nunca llegaba- y la campana madre no podia excluirlos, asi
 * que aparecian en la lista de ella. Se veia como "0 testigos" en la
 * sublicencia y el mismo nombre asomando en la principal.
 *
 * El testigo cuelga de quien cuelga la persona:
 *   1. Su otra fila de estructura, si ya esta en el organigrama (lider,
 *      sublider, coordinador). Su jefe es el mismo.
 *   2. Si solo es votante, del sublider que lo registro, o del lider si no
 *      hubo sublider. `votantes` no guarda usuario_id: el enlace es la cedula.
 * Si no se puede resolver, se deja NULL como hasta ahora — mejor un testigo
 * sin rama que uno colgado del sitio equivocado.
 */
async function supervisorDelTestigo(pool, usuarioId) {
  const [[propia]] = await pool.query(
    `SELECT supervisor_id FROM estructura
      WHERE usuario_id = ? AND cargo <> 'testigo' AND supervisor_id IS NOT NULL
      LIMIT 1`, [usuarioId]);
  if (propia && propia.supervisor_id) return propia.supervisor_id;

  /* Como votante: la ficha con la MISMA cédula que la cuenta, escrita como esté en cada tabla («1.053…» = «1053…»).
     Se busca por la función común (por el índice, y solo si no hay se barren las variantes) y no con una unión
     normalizada en SQL: aquí la cuenta es UNA fila, y la unión barrería todos los votantes en cada llamada. */
  const [[cuenta]] = await pool.query('SELECT numero_identificacion FROM usuarios WHERE id = ?', [usuarioId]);
  const fichaId = cuenta ? await buscarFichaPorCedula(pool, normalizarCedula(cuenta.numero_identificacion)) : null;
  if (!fichaId) return null;
  const [[comoVotante]] = await pool.query(
    `SELECT COALESCE(sublider_id, lider_id) AS jefe FROM votantes WHERE id = ?`, [fichaId]);
  return comoVotante && comoVotante.jefe ? comoVotante.jefe : null;
}

async function asegurarEstructuraTestigo(pool, usuarioId, datosVotacion, tipoTestigo, mesasAsignadas, opciones = {}) {
  const { puesto_votacion, mesa_votacion } = datosVotacion || {};
  const tipo = tipoTestigo === 'puesto' ? 'puesto' : 'mesa';

  const [[yaExiste]] = await pool.query(
    `SELECT id FROM estructura WHERE usuario_id = ? AND cargo = 'testigo' LIMIT 1`,
    [usuarioId]
  );
  if (yaExiste && !opciones.actualizarSiExiste) {
    return { creado: false, estructuraId: yaExiste.id };
  }

  const mesasSolicitadas = tipo === 'puesto' ? (mesasAsignadas || []) : (mesa_votacion ? [mesa_votacion] : []);
  // Al editar hay que excluirse a uno mismo del cruce: si no, sus propias
  // mesas actuales aparecerían como "ya ocupadas" y no se podría guardar.
  const duenoCampana = (await aspiranteDe(pool, usuarioId)) || 0;
  const conflicto = await verificarMesasDisponibles(
    pool, puesto_votacion, mesasSolicitadas, yaExiste ? yaExiste.id : 0, duenoCampana);
  if (conflicto.length) {
    return { creado: false, conflicto };
  }

  // El id del puesto se resuelve acá y se guarda: los cruces del Día D se
  // hacen por id, no comparando el nombre carácter por carácter.
  const [[puestoCampana]] = await pool.query(
    `SELECT id FROM dia_d_puestos_votacion WHERE nombre = ? AND aspirante_id = ?`,
    [puesto_votacion || '', duenoCampana]);
  const ubicacion = await ubicacionDelPuestoDeCampana(pool, puesto_votacion, duenoCampana);

  if (yaExiste) {
    await pool.query(
      `UPDATE estructura
          SET tipo_testigo = ?, mesas_asignadas = ?, puesto_votacion = ?, mesa_votacion = ?,
              puesto_id = ?, departamento_votacion = ?, municipio_votacion = ?,
              -- Solo si nacio sin rama: nunca se pisa una ya puesta a mano.
              supervisor_id = COALESCE(supervisor_id, ?)
        WHERE id = ?`,
      [
        tipo,
        tipo === 'puesto' ? JSON.stringify(mesasSolicitadas.map(Number)) : null,
        puesto_votacion || null,
        tipo === 'puesto' ? null : (mesa_votacion || null),
        puestoCampana ? puestoCampana.id : null,
        ubicacion.departamento, ubicacion.municipio,
        await supervisorDelTestigo(pool, usuarioId),
        yaExiste.id
      ]
    );
    await geocodificarTestigoPorPuestoYGuardar(pool, yaExiste.id, puesto_votacion, ubicacion.municipio, ubicacion.departamento);
    return { creado: false, actualizado: true, estructuraId: yaExiste.id };
  }

  const supervisorId = await supervisorDelTestigo(pool, usuarioId);
  const [result] = await pool.query(
    `INSERT INTO estructura
       (usuario_id, cargo, tipo_testigo, mesas_asignadas, puesto_votacion, mesa_votacion,
        puesto_id, departamento_votacion, municipio_votacion, tipo_area_influencia, supervisor_id, activo)
     VALUES (?, 'testigo', ?, ?, ?, ?, ?, ?, ?, 'territorio', ?, 1)`,
    [
      usuarioId, tipo,
      tipo === 'puesto' ? JSON.stringify(mesasSolicitadas.map(Number)) : null,
      puesto_votacion || null,
      // Un Coordinador de puesto (tipo "puesto") cubre varias mesas del
      // mismo puesto, no una fija — se guarda sin Mesa, a diferencia del
      // Testigo electoral normal (tipo "mesa").
      tipo === 'puesto' ? null : (mesa_votacion || null),
      puestoCampana ? puestoCampana.id : null,
      ubicacion.departamento, ubicacion.municipio, supervisorId
    ]
  );
  await geocodificarTestigoPorPuestoYGuardar(pool, result.insertId, puesto_votacion, ubicacion.municipio, ubicacion.departamento);
  return { creado: true, estructuraId: result.insertId };
}

/**
 * Encuentra (por cédula o email) o crea la cuenta de acceso de una
 * persona que todavía no tiene login — usado al asignar como testigo
 * electoral a un Votante puro (categoría "votante" en la tabla
 * votantes), que a diferencia de un Sublíder nunca tuvo cuenta propia. Si
 * la cédula ya pertenece a alguien con cuenta (ej. ya es Sublíder), se
 * reutiliza esa cuenta tal cual, sin tocar su rol principal.
 */
async function resolverOCrearUsuarioParaTestigo(pool, { nombre, cedula, email, telefono }) {
  if (!cedula) {
    return { usuarioId: null, motivo: 'Falta el Número de identificación.' };
  }
  const emailLimpio = (email || '').trim().toLowerCase() || null;
  // Por correo, o por cédula escrita como sea («1.053…» y «1053…» son la misma cuenta).
  let existente = null;
  if (emailLimpio) [[existente]] = await pool.query(`SELECT id FROM usuarios WHERE email = ? LIMIT 1`, [emailLimpio]);
  if (!existente) existente = await buscarUsuarioPorCedula(pool, normalizarCedula(cedula));
  if (existente) {
    return { usuarioId: existente.id, creado: false };
  }
  const [[rolTestigo]] = await pool.query(`SELECT id FROM roles WHERE nombre = 'testigo'`);
  if (!rolTestigo) {
    return { usuarioId: null, motivo: 'El rol "testigo" no está configurado.' };
  }
  const hash = await bcrypt.hash(cedula, 12);
  const [result] = await pool.query(
    `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, password_hash, rol_id, telefono, debe_cambiar_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [(nombre || '').trim(), cedula, cedula, emailLimpio, hash, rolTestigo.id, telefono || null]
  );
  return { usuarioId: result.insertId, creado: true };
}

module.exports = {
  asegurarEstructuraTestigo, resolverOCrearUsuarioParaTestigo, verificarMesasDisponibles,
  geocodificarTestigoPorPuestoYGuardar,
  // Se exporta para poder comprobarla sola: de quien cuelga un testigo decide
  // en que campana aparece, y eso merece una prueba propia y no deducirlo.
  supervisorDelTestigo
};
