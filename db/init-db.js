/**
 * Inicializa la base de datos: crea las tablas (schema.sql) y un usuario
 * administrador inicial si no existe ninguno.
 *
 * Uso: node db/init-db.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
// El de Node, no el `crypto` global de la Web: ese existe en Node 22 pero no
// tiene randomBytes, así que sin este require el fallo sería un TypeError
// dentro de la creación del administrador, no un error al arrancar.
const crypto = require('crypto');
/**
 * Agrega una columna a una tabla solo si no existe ya. MySQL real (a
 * diferencia de MariaDB/PostgreSQL) no soporta "ADD COLUMN IF NOT EXISTS",
 * así que se maneja capturando el error de columna duplicada.
 */
/**
 * Quita una columna que ya no se usa, sin fallar si no está.
 *
 * El gemelo de `agregarColumnaSiFalta`, y hace falta por lo mismo: el esquema
 * se aplica con `CREATE TABLE IF NOT EXISTS`, que crea lo que falta pero no
 * quita nada. Sin esto, una columna retirada del esquema seguiría viva en
 * todas las instalaciones que ya existen — y ahí sí es peor que no haberla
 * quitado, porque el código deja de escribirla y nadie sabe si el dato que
 * queda es de ayer o de hace un año.
 *
 * ES IRREVERSIBLE: se lleva el dato. Solo se usa cuando la decisión de retirar
 * el campo está tomada, no para «limpiar» por si acaso.
 */
async function quitarColumnaSiSobra(connection, tabla, nombreColumna) {
  try {
    await connection.query(`ALTER TABLE ${tabla} DROP COLUMN ${nombreColumna}`);
    console.log(`Columna ${nombreColumna} eliminada de ${tabla}.`);
    return true;
  } catch (err) {
    // 1091: no existe la columna — ya se habia quitado en una corrida anterior.
    if (err.errno === 1091 || err.code === 'ER_CANT_DROP_FIELD_OR_KEY') {
      return false;
    }
    throw err;
  }
}

async function agregarColumnaSiFalta(connection, tabla, definicionColumna, nombreColumna) {
  try {
    await connection.query(`ALTER TABLE ${tabla} ADD COLUMN ${definicionColumna}`);
    console.log(`Columna ${nombreColumna} agregada a ${tabla}.`);
    return true; // recién creada
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log(`La columna ${nombreColumna} ya existía en ${tabla}. Sin cambios.`);
      return false; // ya existía
    } else {
      throw err;
    }
  }
}

/**
 * Redefine una columna existente (por ejemplo, para agregar valores nuevos
 * a un ENUM). A diferencia de agregarColumnaSiFalta, esto siempre se puede
 * volver a correr sin problema: si ya tiene esa misma definición, MySQL
 * simplemente no cambia nada.
 */
async function modificarColumna(connection, tabla, definicionColumna) {
  try {
    await connection.query(`ALTER TABLE ${tabla} MODIFY COLUMN ${definicionColumna}`);
    console.log(`Columna actualizada en ${tabla}: ${definicionColumna.split(' ')[0]}.`);
  } catch (err) {
    console.error(`Error actualizando columna en ${tabla}:`, err.message);
    throw err;
  }
}

/**
 * Mantiene usuarios.puesto_id al día a partir del texto de
 * usuarios.puesto_votacion, que es un campo libre. Existe para que el
 * cruce de testigos contra puestos del Día D se haga por id y no
 * comparando dos textos que tendrían que coincidir carácter por carácter
 * para siempre.
 *
 * Va con DROP + CREATE porque MySQL no admite "CREATE TRIGGER IF NOT
 * EXISTS" (DROP ... IF EXISTS sí es universal), y todo el script tiene que
 * poder correrse las veces que haga falta.
 *
 * Si el usuario de base de datos no tiene el privilegio TRIGGER (algunos
 * hostings lo restringen), se avisa y se sigue: sin el disparador la app
 * funciona igual salvo el cruce por id, y es preferible eso a dejar la
 * instalación a medias por un permiso que hay que pedir aparte.
 */
/**
 * Le da a cada testigo YA EXISTENTE su propio puesto/mesa en la fila de
 * "estructura", copiándolo de "usuarios".
 *
 * POR QUÉ HACE FALTA
 *   Hasta ahora el puesto donde alguien VIGILA se guardaba encima del
 *   lugar donde VOTA — eran las mismas columnas. Al separarlos, los
 *   testigos creados antes quedan con su fila de estructura vacía, así
 *   que las consultas siguen cayendo a "usuarios" y los dos conceptos se
 *   ven idénticos en pantalla, como si el arreglo no hubiera servido.
 *
 * POR QUÉ COPIAR DE "usuarios" ES CORRECTO
 *   En los dos casos posibles, lo que hay en "usuarios" ES el dato del
 *   testigo: si se creó desde la pantalla de Testigos, ahí se guardó
 *   siempre; y si es alguien con otro cargo que además se marcó testigo,
 *   ese valor había sobrescrito su lugar de votación. En ambos, el dato
 *   pertenece a la capacidad de testigo.
 *
 * LO QUE NO SE PUEDE RECUPERAR
 *   El lugar de votación REAL de quien tenía doble rol se perdió cuando
 *   lo pisaron; no hay de dónde sacarlo. Después de esta migración, ese
 *   campo se puede corregir a mano desde el formulario y ya no se vuelve
 *   a perder. Antes de esto no servía de nada corregirlo, porque el
 *   testigo se quedaba sin puesto.
 *
 * Solo toca filas cuyo puesto de testigo está vacío, así que correrla de
 * nuevo no pisa nada de lo que ya se haya ajustado a mano.
 */
async function separarDatosDeTestigosExistentes(connection) {
  const [resultado] = await connection.query(`
    UPDATE estructura e
      JOIN usuarios u ON u.id = e.usuario_id
       SET e.puesto_votacion       = u.puesto_votacion,
           e.mesa_votacion         = CASE WHEN e.tipo_testigo = 'puesto' THEN NULL
                                          ELSE NULLIF(TRIM(u.mesa_votacion), '') END,
           e.puesto_id             = u.puesto_id,
           e.departamento_votacion = u.departamento_votacion,
           e.municipio_votacion    = u.municipio_votacion
     WHERE e.cargo = 'testigo'
       AND e.puesto_votacion IS NULL
       AND u.puesto_votacion IS NOT NULL
       AND u.puesto_votacion <> ''
  `);
  if (resultado.affectedRows > 0) {
    console.log(
      `Testigos: a ${resultado.affectedRows} se les separó el puesto donde vigilan del lugar donde votan.\n` +
      '  OJO: a quienes tienen doble rol (Líder/Sublíder/Votante que además es testigo) su\n' +
      '  Lugar de Votación quedó con el dato del puesto que vigilan, porque el original se\n' +
      '  había perdido antes. Revísalo en su ficha y corrígelo: ya no se vuelve a pisar.'
    );
  } else {
    console.log('Testigos: no hay ninguno con el puesto sin separar. Sin cambios.');
  }
}

/**
 * ¿Se puede llegar al catálogo desde esta base?
 *
 * Hay que preguntarlo ANTES de meter el catálogo dentro de un disparador: si
 * la instalación no tiene permiso de lectura sobre `territoriosdb`, el
 * disparador se crearía sin problema y reventaría en CADA alta de votante,
 * dejando la campaña sin poder registrar a nadie. Se comprueba una vez y se
 * elige qué disparador crear.
 */
async function alcanzaElCatalogo(connection) {
  try {
    await connection.query(
      `SELECT cp.id
         FROM dia_d_puestos_votacion p
         JOIN territoriosdb.ctc_puestos_votacion cp ON cp.id = p.ctc_puesto_id
         JOIN territoriosdb.ctc_territorios m ON m.id = cp.municipio_id
        LIMIT 1`
    );
    return true;
  } catch (err) {
    console.warn('  Catálogo no accesible desde esta base (' + (err.code || err.message) +
      '): el cruce de puestos se hará solo por nombre exacto.');
    return false;
  }
}

/**
 * El cruce del texto «Lugar de votación» contra el puesto de la campaña.
 *
 * DOS REGLAS, EN ESTE ORDEN, Y LA SEGUNDA SUMA — NO REEMPLAZA:
 *
 *   1. Nombre exacto contra la copia de la campaña. Es lo que había, y hay
 *      que conservarlo: en la campaña municipal 16 de 87 personas tienen el
 *      puesto escrito con un nombre TRUNCADO («ANTIGUO TERMINAL DE TRANS
 *      PEOPLE») que coincide con esa copia pero no con el catálogo. Cambiar
 *      una regla por otra los habría dejado sin cruzar.
 *
 *   2. Por catálogo, dentro del municipio de votación de la persona. Hace
 *      falta porque al sembrar una campaña que abarca más de un municipio el
 *      nombre lleva el municipio pegado —«IE CAMILO TORRES (ARMENIA)»— para
 *      poder distinguir los homónimos, y entonces NUNCA es igual al texto que
 *      escribió la persona, que es el nombre pelado del catálogo.
 *
 * SE CRUZA CONTRA EL CATÁLOGO, NO CONTRA EL NOMBRE RECORTADO. Quitarle el
 * paréntesis al nombre sembrado parece más simple y está mal: hay puestos con
 * paréntesis propios, como «COCORA (PALESTINA) (SALENTO)».
 *
 * EL MUNICIPIO SE BUSCA DENTRO DE SU DEPARTAMENTO. «Córdoba» es municipio de
 * Quindío, de Bolívar y de Nariño; sin acotar por departamento el cruce mete
 * gente en otro lado del país. Es la misma regla que el catálogo aplica a sus
 * alias, y aquí se comprobó midiendo: sin el departamento, 62 votantes daban
 * 107 coincidencias.
 *
 * Medido el 16 de agosto de 2026 sobre las dos campañas: con las dos reglas
 * juntas cruzan 87/87 en la municipal y 81/81 en la departamental, y en CERO
 * casos las dos reglas se contradicen — ninguna asignación ya correcta se
 * mueve.
 */
function expresionPuestoId(alias, conCatalogo) {
  const texto = `${alias}.puesto_votacion IS NOT NULL AND ${alias}.puesto_votacion <> ''`;
  // REGLA 0, LA DEFINITIVA: si la fila ya tiene el id del catálogo, el puesto
  // de la campaña sale de un enlace entre ids y NO se compara ni un carácter.
  // Es inmune a que el puesto se renombre, a los sufijos de municipio y a los
  // nombres truncados: el problema que resolvió el parche 86 no puede volver
  // a ocurrir en una fila que pase por aquí.
  //
  // No necesita el catálogo abierto: `dia_d_puestos_votacion.ctc_puesto_id`
  // es una columna de la propia campaña, y es única (uq_dia_d_puestos_ctc).
  const porCtc = `(SELECT p.id FROM dia_d_puestos_votacion p
       WHERE ${alias}.ctc_puesto_id IS NOT NULL
         AND p.ctc_puesto_id = ${alias}.ctc_puesto_id
       LIMIT 1)`;
  const porNombre = `(SELECT p.id FROM dia_d_puestos_votacion p
       WHERE ${texto} AND p.nombre = ${alias}.puesto_votacion
       LIMIT 1)`;
  if (!conCatalogo) return `COALESCE(${porCtc}, ${porNombre})`;
  // LIMIT 1 y no una comprobación de unicidad: dentro de un municipio el
  // nombre del puesto no se repite —verificado sobre los 62 casos, todos con
  // un único candidato— y un COUNT en cada alta costaría el doble.
  const porCatalogo = `(SELECT p.id FROM dia_d_puestos_votacion p
         JOIN territoriosdb.ctc_puestos_votacion cp ON cp.id = p.ctc_puesto_id
         JOIN territoriosdb.ctc_territorios m ON m.id = cp.municipio_id
         JOIN territoriosdb.ctc_territorios d ON d.id = m.padre_id
       WHERE ${texto}
         AND ${alias}.municipio_votacion IS NOT NULL AND ${alias}.municipio_votacion <> ''
         AND cp.nombre = ${alias}.puesto_votacion
         AND m.nombre = ${alias}.municipio_votacion
         AND d.nombre = ${alias}.departamento_votacion
       LIMIT 1)`;
  // COALESCE evalúa de izquierda a derecha y se detiene en el primer valor:
  // la consulta al catálogo solo corre cuando el nombre exacto no encontró.
  return `COALESCE(${porCtc}, ${porNombre}, ${porCatalogo})`;
}

/**
 * El cuerpo del disparador, que hace DOS cosas:
 *
 *   1. Deja `ctc_puesto_id` —el id del puesto en el CATÁLOGO— guardado en la
 *      fila. Es el arreglo de fondo: una vez escrito, el enlace no vuelve a
 *      depender de comparar textos nunca más.
 *   2. Deriva `puesto_id` (la copia de la campaña) de ese id.
 *
 * VA EN EL DISPARADOR Y NO SOLO EN LA RUTA porque hay más de un escritor: el
 * alta y la edición pasan por routes/votantes.routes.js, pero la importación
 * por Excel escribe con su propio INSERT. Poniéndolo aquí queda cubierto todo
 * camino de escritura, presente y futuro, sin tener que acordarse.
 *
 * EL CASO DELICADO ES LA EDICIÓN. Si alguien cambia el Puesto, el
 * `ctc_puesto_id` que trae la fila es el ANTERIOR, y la regla 0 lo tomaría
 * como bueno dejando a la persona enlazada a su puesto viejo — un dato
 * equivocado que además parece verificado. Por eso, cuando el texto cambia y
 * el id NO cambia en esa misma escritura, el id se descarta y se vuelve a
 * resolver. Si quien escribe manda un id distinto, ese manda: es una elección
 * explícita.
 */
function cuerpoTriggerPuestoId(conCatalogo, esActualizacion) {
  const expr = expresionPuestoId('NEW', conCatalogo);
  const olvidarIdViejo = !esActualizacion ? '' : `
    IF NOT (NEW.puesto_votacion <=> OLD.puesto_votacion)
       OR NOT (NEW.municipio_votacion <=> OLD.municipio_votacion) THEN
      IF NEW.ctc_puesto_id <=> OLD.ctc_puesto_id THEN
        SET NEW.ctc_puesto_id = NULL;
      END IF;
    END IF;`;
  return `BEGIN${olvidarIdViejo}
    SET NEW.puesto_id = ${expr};
    SET NEW.ctc_puesto_id = COALESCE(
      NEW.ctc_puesto_id,
      (SELECT p.ctc_puesto_id FROM dia_d_puestos_votacion p WHERE p.id = NEW.puesto_id));
  END`;
}

/**
 * Rehace un indice unico solo si sus columnas cambiaron. Idempotente: si ya
 * esta como se pide, no toca nada — importa porque esto corre en cada arranque
 * y un DROP+CREATE gratuito sobre una tabla con datos no es gratis.
 */
async function rehacerIndiceUnico(connection, tabla, nombre, columnas) {
  const [filas] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
      ORDER BY SEQ_IN_INDEX`, [tabla, nombre]);
  const actual = filas.map(f => f.COLUMN_NAME).join(',');
  if (actual === columnas.join(',')) return false;
  if (actual) await connection.query(`ALTER TABLE \`${tabla}\` DROP INDEX \`${nombre}\``);
  await connection.query(
    `ALTER TABLE \`${tabla}\` ADD UNIQUE KEY \`${nombre}\` (${columnas.map(c => '`' + c + '`').join(',')})`);
  return true;
}

async function crearTriggersPuestoId(connection) {
  const conCatalogo = await alcanzaElCatalogo(connection);
  try {
    // Las dos tablas se tratan igual: el texto sigue siendo lo que la
    // persona escribió, y el id se deduce de él. En `votantes` el id queda
    // NULL a menudo y está bien — alguien registrado aquí puede votar en un
    // municipio que la campaña no cubre, y ese puesto no está en la lista.
    for (const tabla of ['usuarios', 'votantes']) {
      for (const momento of ['ins', 'upd']) {
        const evento = momento === 'ins' ? 'INSERT' : 'UPDATE';
        const cuerpo = cuerpoTriggerPuestoId(conCatalogo, momento === 'upd');
        await connection.query(`DROP TRIGGER IF EXISTS trg_${tabla}_puesto_id_${momento}`);
        await connection.query(
          `CREATE TRIGGER trg_${tabla}_puesto_id_${momento} BEFORE ${evento} ON ${tabla} FOR EACH ROW ${cuerpo}`
        );
      }
    }
    console.log('Disparadores de puesto_id (usuarios y votantes) creados/actualizados.');

    // Un disparador solo actúa al escribir: las filas que YA existían se
    // quedarían con el id vacío para siempre, y el cruce por id nacería
    // muerto sin que nada avisara. Se rellenan aquí, y se vuelve a hacer en
    // cada corrida porque la lista de puestos cambia (al resembrarla, un
    // texto que antes no cruzaba puede empezar a cruzar).
    //
    // Solo toca filas con el id vacío: nunca repisa uno ya resuelto.
    for (const tabla of ['usuarios', 'votantes']) {
      // La MISMA expresión del disparador, no una parecida: si el relleno y
      // el disparador razonaran distinto, una fila quedaría enlazada al
      // guardarla y desenlazada al volver a guardarla, o al revés.
      const [r] = await connection.query(
        `UPDATE ${tabla} t
            SET t.puesto_id = ${expresionPuestoId('t', conCatalogo)}
          WHERE t.puesto_id IS NULL AND t.puesto_votacion IS NOT NULL AND t.puesto_votacion <> ''`
      );
      if (r.affectedRows > 0) console.log(`  ${tabla}: ${r.affectedRows} fila(s) con puesto_id resuelto desde el texto.`);

      // Y SE GUARDA EL ID DEL CATÁLOGO, que es lo que hace el arreglo
      // permanente. A partir de aquí esa fila ya no depende de ningún texto:
      // la regla 0 la resuelve por id. El texto se conserva como etiqueta
      // legible y como respaldo de las filas que nunca lleguen a tener id
      // (puestos escritos a mano, sin enlace al catálogo).
      const [rc] = await connection.query(
        `UPDATE ${tabla} t
            JOIN dia_d_puestos_votacion p ON p.id = t.puesto_id
             SET t.ctc_puesto_id = p.ctc_puesto_id
          WHERE t.ctc_puesto_id IS NULL AND p.ctc_puesto_id IS NOT NULL`
      );
      if (rc.affectedRows > 0) console.log(`  ${tabla}: ${rc.affectedRows} fila(s) enlazadas al catálogo por id.`);
    }
  } catch (err) {
    if (err.code === 'ER_SPECIFIC_ACCESS_DENIED_ERROR' || err.errno === 1142) {
      console.warn(
        'AVISO: el usuario de la base de datos no tiene permiso para crear disparadores (TRIGGER). ' +
        'usuarios.puesto_id y votantes.puesto_id no se llenarán solos; hay que pedirle ese privilegio al hosting.'
      );
      return;
    }
    throw err;
  }
}
/**
 * Módulos del menú y qué roles los ven por defecto — refleja el mismo
 * criterio que ya usaban los arreglos "roles" del menú antes de existir la
 * pantalla de "Asignación de permisos". Sirve solo para sembrar valores
 * iniciales la primera vez; una vez el admin guarda cambios desde esa
 * pantalla, esos quedan intactos (INSERT IGNORE no los pisa).
 */
const ROLES_PERMISOS = ['admin', 'coordinador', 'lider', 'sublider', 'testigo', 'usuario', 'asistente_administrativo', 'invitado'];

/* EL ROL «administrativo» SE SIEMBRA, PERO NO ENTRA EN `ROLES_PERMISOS`.
   Esa lista tiene dos oficios que aquí se separan: es la lista de roles a los
   que hay que crearles fila en la matriz, Y es el valor que usan los módulos
   que quieren decir «todos» —panel_general, votantes, agenda, biografía,
   política, recursos y ayuda—. Metiéndolo ahí, el rol nuevo se llevaría esos
   siete de una vez, incluido Votantes, que es la base entera de la campaña.

   Se pidió que naciera con lo mínimo y que sus módulos se asignen a mano
   desde Configuración → Asignación de permisos, así que se le siembra fila en
   TODOS los módulos —para que la pantalla lo muestre completo— pero con el
   permiso puesto solo en los cuatro de abajo. */
const ROLES_A_SEMBRAR = [...ROLES_PERMISOS, 'administrativo'];
const MODULOS_INICIALES_ADMINISTRATIVO = ['panel_general', 'agenda', 'recursos', 'ayuda'];
const PERMISOS_POR_DEFECTO = {
  panel_general: ROLES_PERMISOS,
  organigrama: ['admin', 'coordinador', 'lider', 'testigo', 'invitado'],
  territorial: ['admin', 'coordinador', 'lider', 'testigo', 'invitado'],
  votantes: ROLES_PERMISOS,
  votantes_dashboard: ['admin', 'coordinador'],
  testigos: ['admin', 'coordinador'],
  mapa: ['admin', 'coordinador'],
  agenda: ROLES_PERMISOS,
  eventos: ['admin', 'coordinador', 'lider', 'testigo', 'invitado'],
  asistentes_reuniones: ['admin', 'coordinador', 'lider'],
  dia_d: ['admin', 'coordinador'],
  // «Faltan por votar» y el ranking del Día D (fase 2): lo usa toda la gente
  // que trabaja votantes ese día, no solo la coordinación. Testigo e invitado
  // no. El aspirante no figura aquí: su acceso va en PERMISOS_ASPIRANTE
  // (middleware/aspirante.js), porque su rol de fila es «lider».
  rescate_votos: ['admin', 'coordinador', 'lider', 'sublider'],
  // Resultados del Día D (fase 3): consolidado, resultado oficial y diferencias. Lo ven el
  // administrador y el coordinador de fábrica (el aspirante, por PERMISOS_ASPIRANTE); líder,
  // sublíder, testigo e invitado no. No existe un rol de «abogado» en la matriz.
  resultados_dia_d: ['admin', 'coordinador'],
  // Alertas del Día D (fase 4): el cuadro en vivo de la coordinación. Administrador y coordinador de fábrica
  // (el aspirante, por PERMISOS_ASPIRANTE); líder, sublíder, testigo e invitado no. El INSERT IGNORE de abajo no
  // pisa lo que el administrador ya editó.
  alertas_dia_d: ['admin', 'coordinador'],
  // Transporte del Día D (orden 33): vehículos, conductores y a quién recoge cada uno. Administrador y coordinador de
  // fábrica (el aspirante, por PERMISOS_ASPIRANTE). El líder sigue MARCANDO «necesita transporte» con `rescate_votos`.
  transporte_dia_d: ['admin', 'coordinador'],
  // Logística del día D (orden 39): refrigerios, almuerzos y kits. Administrador y coordinador de fábrica (el aspirante, por
  // PERMISOS_ASPIRANTE). La pantalla del coordinador de puesto NO va por esta casilla sino por su fila de testigo tipo «puesto».
  logistica_dia_d: ['admin', 'coordinador'],
  social: ['admin', 'coordinador', 'lider', 'testigo', 'invitado'],
  crm: ['admin', 'coordinador', 'asistente_administrativo'],
  enviar_email: ['admin', 'coordinador', 'lider', 'asistente_administrativo'],
  enviar_sms: ['admin', 'coordinador', 'lider', 'asistente_administrativo'],
  // "Aviso en la app" (push). Sin esta línea la entrada del menú NO le
  // aparece a nadie: common.js oculta todo ítem cuyo módulo no esté en los
  // permisos del usuario, y el resultado es un menú sin la opción y nadie
  // sabiendo por qué.
  enviar_push: ['admin', 'coordinador', 'lider', 'asistente_administrativo'],
  configurar_crm: ['admin'],
  // Recordatorios automáticos (Configuración → Recordatorios): solo el administrador de fábrica. Sin esta línea la entrada del menú no le
  // aparece a nadie (common.js oculta todo ítem cuyo módulo no esté en los permisos del usuario).
  recordatorios: ['admin'],
  // Solicitudes ciudadanas (parche 303): apagado de fábrica, solo el administrador. Se le abre a líderes y coordinadores desde Asignación de permisos.
  solicitudes: ['admin'],
  biografia_candidato: ROLES_PERMISOS,
  politica_privacidad: ROLES_PERMISOS,
  recursos: ROLES_PERMISOS,
  // Legislación: solo consulta de PDF. De fábrica la ven administrador y
  // coordinador; el resto se abre desde Asignación de permisos. Sin esta
  // línea la entrada del menú no le aparece a nadie (common.js oculta todo
  // ítem cuyo módulo no esté en los permisos del usuario).
  legislacion: ['admin', 'coordinador'],
  finanzas: ['admin', 'coordinador', 'asistente_administrativo'],
  configuracion: ['admin', 'asistente_administrativo'],
  // El menú "Ayuda" en sí es visible para todos los roles (cada quien ve
  // su propio manual) — el Manual de instalación, dentro de esa misma
  // pantalla, ya está restringido aparte a solo admin en el frontend.
  ayuda: ROLES_PERMISOS
};

// Para la mayoría de módulos, Editar y Agregar nuevo por defecto siguen a
// "Ver" (quien puede ver, puede editar/agregar) — Invitado es la única
// excepción fija (nunca edita ni agrega, aunque sí pueda ver). Para
// "territorial" se preserva el comportamiento que ya existía antes de
// esta granularidad: solo Admin y Coordinador pueden Editar/Agregar ahí.
// «Importar / Exportar»: qué módulos lo tienen y a quién se le da de fábrica.
// Es un archivo de datos puros (sin conexión a la base) y es la MISMA lista que
// leen la matriz de permisos y el middleware que bloquea las rutas.
const { IMPORTAR_EXPORTAR_POR_DEFECTO, importarExportarPorDefecto } = require('../config/importarExportar');

const RESTRICCION_EDITAR_AGREGAR = {
  territorial: ['admin', 'coordinador'],
  // Legislación es de solo consulta: no hay nada que editar ni agregar desde
  // la aplicación (los PDF se suben por el administrador de archivos del
  // servidor). Lista vacía = Editar y Agregar en 0 para todos.
  legislacion: []
};

async function sembrarPermisosPorDefecto(connection) {
  for (const modulo of Object.keys(PERMISOS_POR_DEFECTO)) {
    const rolesPermitidos = PERMISOS_POR_DEFECTO[modulo];
    const restriccion = RESTRICCION_EDITAR_AGREGAR[modulo];
    for (const rol of ROLES_A_SEMBRAR) {
      const ver = rol === 'administrativo'
        ? (MODULOS_INICIALES_ADMINISTRATIVO.includes(modulo) ? 1 : 0)
        : (rolesPermitidos.includes(rol) ? 1 : 0);
      const puedeEditarAgregar = ver && rol !== 'invitado' && (!restriccion || restriccion.includes(rol));
      const editar = puedeEditarAgregar ? 1 : 0;
      const agregar = puedeEditarAgregar ? 1 : 0;
      // Importar/Exportar NO sigue a «Ver»: un coordinador sin Ver en un módulo
      // conserva la casilla encendida, porque hoy las rutas no miran la matriz y
      // apagarla aquí cambiaría lo que ya funciona. La tabla de fábrica es la
      // de config/importarExportar.js, y los roles que no figuran quedan en 0.
      const importarExportar = importarExportarPorDefecto(rol, modulo);
      await connection.query(
        `INSERT IGNORE INTO permisos_rol (rol, modulo, permitido, editar, agregar, importar_exportar)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [rol, modulo, ver, editar, agregar, importarExportar]
      );
    }
  }
  console.log('Permisos por defecto verificados/sembrados (no se pisan los que el admin ya haya editado).');
}

/**
 * Texto por defecto de la Política de privacidad, redactado conforme a la
 * legislación colombiana de habeas data vigente para el tratamiento de
 * datos personales en campañas políticas (Ley 1581 de 2012, Decreto 1377
 * de 2013, Decreto 886 de 2014, artículo 15 de la Constitución Política,
 * y la Sentencia C-748 de 2011 de la Corte Constitucional). Redactado en
 * lenguaje técnico-jurídico pero explicado de forma sencilla, pensado
 * para que lo entienda alguien con estudios de básica primaria.
 *
 * Formato: el párrafo antes del primer "## " es el aviso/descargo inicial
 * (el frontend lo muestra en un recuadro de advertencia aparte). Cada
 * línea "## Título" marca el inicio de una sección numerada (el frontend
 * las detecta, las numera y arma la tabla de contenido automáticamente).
 * Los datos entre [corchetes] son marcadores que el usuario debe
 * completar con la información real de su campaña antes de publicar.
 */
const TEXTO_POLITICA_PRIVACIDAD_DEFECTO = `Este es un documento BORRADOR generado como punto de partida. Antes de publicarlo, un abogado debe revisarlo, y usted debe completar todos los datos marcados entre [corchetes] con la información real de su campaña.

## 1. ¿Quién es el responsable de sus datos?

El responsable del tratamiento de sus datos personales es [NOMBRE DEL CANDIDATO / NOMBRE DE LA CAMPAÑA], con NIT o cédula [NÚMERO], con sede en [CIUDAD, DEPARTAMENTO], correo de contacto [CORREO] y teléfono [TELÉFONO]. Esta persona (o campaña) es quien decide qué datos se recogen y para qué se usan, y quien responde ante usted y ante las autoridades por el buen manejo de su información.

## 2. ¿Qué información recogemos y para qué la usamos?

Cuando usted hace parte de esta campaña —como votante, líder, coordinador, sublíder, testigo o asistente a un evento—, podemos recoger datos como: su nombre completo, número de cédula, teléfono, correo electrónico, dirección de residencia, edad, género, el barrio o vereda donde vive, y su lugar de votación (puesto y mesa). Usamos esta información para: organizar el trabajo de la campaña en el territorio, invitarlo a eventos y reuniones, comunicarnos con usted por teléfono, mensaje de texto, WhatsApp o correo, y para planear estrategias de campaña. No usamos su información para ningún fin distinto a estos, ni la vendemos a nadie.

## 3. Su intención de voto es un dato especialmente protegido

La ley colombiana (artículo 5 de la Ley 1581 de 2012) dice que los datos sobre las opiniones políticas de una persona son "datos sensibles" — es decir, datos que merecen un cuidado extra, porque si se usan mal pueden afectarlo o hacer que lo discriminen. Si esta campaña registra su intención de voto o su nivel de apoyo (por ejemplo: "confirmado", "probable", "indeciso"), lo hacemos únicamente con su autorización libre y expresa, y usted en cualquier momento puede pedirnos que dejemos de tener ese dato, sin que eso le traiga ninguna consecuencia negativa.

## 4. ¿Cómo protegemos su información?

Guardamos su información en sistemas con acceso restringido, protegidos con contraseña, y solo las personas de la campaña que necesitan esa información para hacer su trabajo (por ejemplo, su líder o coordinador de zona) pueden verla. Trabajamos para evitar que personas no autorizadas, fuera de la campaña, puedan ver, cambiar o robar esta información.

## 5. ¿Con quién compartimos su información?

Por regla general, su información solo la usa el equipo de esta campaña. No se la entregamos ni la vendemos a empresas, partidos distintos, ni terceros ajenos a la campaña. Solo en los casos en que la ley lo exija —por ejemplo, si una autoridad electoral o un juez lo ordena— podríamos tener que entregar información, y únicamente la que la ley exija.

## 6. ¿Por cuánto tiempo guardamos su información?

Guardamos su información mientras dure el propósito para el que la recogimos: mientras dure el proceso electoral y el tiempo razonable después, necesario para cumplir obligaciones legales (por ejemplo, rendición de cuentas ante el Consejo Nacional Electoral). Pasado ese tiempo, o si usted nos pide que la eliminemos y no hay una razón legal para conservarla, la borramos de nuestros sistemas.

## 7. Sus derechos (derechos ARCO) y cómo ejercerlos

Como titular de sus datos, usted tiene derecho a:

- **Conocer**: saber qué información suya tenemos guardada.
- **Actualizar**: pedirnos que corrijamos un dato que esté mal o desactualizado.
- **Rectificar**: pedirnos que arreglemos información incompleta o inexacta.
- **Suprimir**: pedirnos que borremos su información, cuando ya no sea necesaria o cuando usted retire su autorización.
- **Revocar la autorización**: cambiar de opinión y pedirnos que dejemos de usar su información, en cualquier momento.

Para ejercer cualquiera de estos derechos, puede escribirnos a [CORREO], llamarnos o escribirnos por WhatsApp al [TELÉFONO], o acercarse a nuestra sede en [DIRECCIÓN]. Responderemos su solicitud dentro de los plazos que establece la ley (10 días hábiles para consultas, 15 días hábiles para reclamos).

## 8. Menores de edad

Esta campaña no recoge intencionalmente información de menores de 18 años para fines de intención de voto o afiliación política, salvo la información básica necesaria para organizar actividades familiares o educativas de la campaña, y siempre con la autorización de sus padres o representantes legales.

## 9. Cambios a esta política

Esta política puede cambiar con el tiempo, por ejemplo si cambian las leyes o la forma en que trabajamos. Cuando eso pase, publicaremos la versión actualizada en esta misma página, con la fecha de la última actualización visible.

## 10. ¿Dónde puede quejarse si algo no le parece bien?

Si usted considera que no hemos cuidado bien su información, primero puede escribirnos directamente a los canales de contacto de esta política. Si no queda conforme con nuestra respuesta, tiene derecho a poner una queja ante la Superintendencia de Industria y Comercio (SIC), que es la entidad del Estado colombiano encargada de vigilar que se cumpla la ley de protección de datos personales.

## 11. Fundamento jurídico

Esta política se elabora conforme a: el artículo 15 de la Constitución Política de Colombia (derecho fundamental al habeas data); la Ley Estatutaria 1581 de 2012 (Régimen General de Protección de Datos Personales); el Decreto 1377 de 2013 (que reglamenta parcialmente la Ley 1581 de 2012); el Decreto 886 de 2014 (Registro Nacional de Bases de Datos); y la Sentencia C-748 de 2011 de la Corte Constitucional, que declaró exequible la Ley 1581 de 2012 y fijó los criterios de interpretación sobre datos sensibles, entre ellos las opiniones políticas.

Última actualización: [FECHA]`;

/**
 * Siembra el texto por defecto de la Política de privacidad en
 * `contenido_paginas` — SOLO la primera vez (INSERT IGNORE respeta la
 * llave primaria `clave`), para no pisar el contenido si el admin ya lo
 * editó desde la aplicación.
 */
/* Agrega a la política de privacidad la finalidad de las solicitudes ciudadanas (parche 303) y archiva la versión nueva. Va DESPUÉS de sembrar la
   política por defecto: en una base nueva la fila no existe antes de ese paso. Repetible: si el texto ya trae la frase, no hace nada. */
async function agregarFinalidadSolicitudes(connection) {
  /* LA POLÍTICA DE PRIVACIDAD GANA UNA FINALIDAD: «registrar y remitir necesidades del territorio». Se agrega UNA vez (si el texto ya
     la trae, no se toca) al final de la sección 2 y se ARCHIVA la versión nueva con su huella, igual que cuando el administrador
     edita la política desde la pantalla (config/politicaVersiones.js): la autorización de cada ciudadano guarda esa huella. */
  const FRASE_SOLICITUDES = 'registrar y remitir necesidades del territorio';
  const [[politicaActual]] = await connection.query(`SELECT contenido FROM contenido_paginas WHERE clave = 'politica_privacidad'`);
  if (politicaActual && politicaActual.contenido && !politicaActual.contenido.includes(FRASE_SOLICITUDES)) {
    const parrafo = '\n\nSi usted nos cuenta una necesidad de su barrio o vereda y autoriza que guardemos su nombre y su teléfono, los usaremos únicamente para '
      + FRASE_SOLICITUDES + ': anotarla, hacerle seguimiento y remitirla a la entidad que corresponda. Si no lo autoriza, la necesidad se registra sin sus datos. '
      + 'No pedimos su cédula. Puede pedir en cualquier momento que borremos sus datos de esa solicitud, y los borramos de todos modos pasado el plazo que fije la campaña.';
    const texto = politicaActual.contenido;
    const corte = texto.search(/\n## 3\./);
    const nuevo = corte === -1 ? texto.replace(/\s+$/, '') + parrafo : texto.slice(0, corte).replace(/\s+$/, '') + parrafo + '\n' + texto.slice(corte);
    await connection.query(`UPDATE contenido_paginas SET contenido = ? WHERE clave = 'politica_privacidad'`, [nuevo]);
    const huella = require('crypto').createHash('sha256').update(nuevo, 'utf8').digest('hex').slice(0, 16);
    await connection.query(
      `INSERT IGNORE INTO politica_versiones (huella, clave, titulo, contenido, archivada_por, archivada_por_nombre) VALUES (?, 'politica_privacidad', 'Política de privacidad', ?, NULL, 'Actualización automática (solicitudes ciudadanas)')`,
      [huella, nuevo]);
    console.log(`Política de privacidad: se agregó la finalidad de las solicitudes ciudadanas y se archivó la versión ${huella}.`);
  }
}

async function sembrarPoliticaPrivacidadPorDefecto(connection) {
  await connection.query(
    `INSERT IGNORE INTO contenido_paginas (clave, titulo, contenido) VALUES (?, ?, ?)`,
    ['politica_privacidad', 'Política de privacidad', TEXTO_POLITICA_PRIVACIDAD_DEFECTO]
  );
  console.log('Política de privacidad por defecto verificada/sembrada (no se pisa si el admin ya la editó).');
}

/**
 * El archivo donde se deja la contraseña inicial del superadministrador.
 * Vive en la carpeta de la instalación, con modo 0600, y está en .gitignore y
 * fuera de las plantillas (scripts/generar-plantilla.js).
 */
const ARCHIVO_CREDENCIALES_SUPERADMIN = '.credenciales-superadmin.txt';

/**
 * Lo mismo para el administrador inicial (admin@campana.local o ADMIN_EMAIL):
 * mismo formato, modo 0600, mismo trato en .gitignore y en parches/plantillas.
 * Solo se escribe si la contraseña se GENERÓ (sin ADMIN_PASSWORD).
 */
const ARCHIVO_CREDENCIALES_ADMIN = '.credenciales-admin.txt';

/**
 * Crea el superadministrador de una instalación NUEVA.
 *
 * SOLO SI EL ADMINISTRADOR SE CREÓ EN ESTA MISMA CORRIDA (`adminCreadoEstaCorrida`).
 * init-db no es solo de la instalación: el actualizador lo corre en cada parche
 * que toca `db/` (scripts/actualizar-automatico.js), con la salida a un log. Sin
 * esta condición, cada campaña que ya existe recibiría un superadministrador
 * nuevo y su contraseña acabaría en un archivo y en un log. Para una campaña
 * existente el camino es `node scripts/elevar-superadmin.js`.
 *
 * NO IMPRIME LA CONTRASEÑA. La deja en ARCHIVO_CREDENCIALES_SUPERADMIN (modo
 * 0600) y muestra solo la ruta. El archivo se escribe ANTES de tocar la base y
 * con `wx` (no sobrescribe): si la escritura falla no queda una cuenta cuya
 * clave nadie conoce, y si ya hay un archivo sin leer no se pisa.
 *
 * IDEMPOTENTE. Si ya hay un es_superadmin = 1, no hace nada. Si el correo ya
 * pertenece a otra cuenta, no la eleva en silencio: avisa y remite a
 * scripts/elevar-superadmin.js.
 *
 * Devuelve true solo si creó la cuenta.
 */
async function crearSuperadminInicial(connection, adminCreadoEstaCorrida) {
  if (!adminCreadoEstaCorrida) return false;

  // Se lee aquí y no arriba: el valor sale del .env, y dotenv ya se cargó.
  const { CORREO_SUPERADMIN, TELEFONO_SUPERADMIN } = require('../config/superadminCorreo');
  const ruta = path.join(__dirname, '..', ARCHIVO_CREDENCIALES_SUPERADMIN);

  const [yaHay] = await connection.query(`SELECT id FROM usuarios WHERE es_superadmin = 1 LIMIT 1`);
  if (yaHay.length) {
    console.log('Ya existe un superadministrador. No se creó otro.');
    return false;
  }

  const [correoUsado] = await connection.query(
    `SELECT id FROM usuarios WHERE LOWER(email) = ? LIMIT 1`, [CORREO_SUPERADMIN]);
  if (correoUsado.length) {
    console.warn(`AVISO: ${CORREO_SUPERADMIN} ya pertenece a otra cuenta (id ${correoUsado[0].id}). ` +
      'No se creó el superadministrador ni se elevó esa cuenta. Para elevarla a propósito:\n' +
      `  node scripts/elevar-superadmin.js ${CORREO_SUPERADMIN}`);
    return false;
  }

  const [[rolAdmin]] = await connection.query(`SELECT id FROM roles WHERE nombre = 'admin'`);
  if (!rolAdmin) throw new Error('No existe el rol "admin": no se puede crear el superadministrador.');

  const passwordPlano = crypto.randomBytes(12).toString('base64url');
  const hash = await bcrypt.hash(passwordPlano, 12);

  // 1. El archivo primero. `wx`: falla si ya existe, en vez de pisar una clave
  //    que quizá nadie ha leído todavía.
  try {
    fs.writeFileSync(
      ruta,
      `Superadministrador de esta instalación\n` +
      `Correo:     ${CORREO_SUPERADMIN}\n` +
      `Contraseña: ${passwordPlano}\n` +
      `Creada:     ${new Date().toISOString()}\n\n` +
      `Debe cambiarla en el primer ingreso. Lea este archivo con cat y BÓRRELO.\n`,
      { flag: 'wx', mode: 0o600 }
    );
    // `mode` se enmascara con el umask y puede heredar una ACL de la carpeta:
    // se fija y se comprueba, no se supone.
    fs.chmodSync(ruta, 0o600);
    if ((fs.statSync(ruta).mode & 0o777) !== 0o600) {
      throw new Error(`No se pudo dejar ${ruta} en modo 0600.`);
    }
  } catch (err) {
    if (err.code === 'EEXIST') {
      console.warn(`AVISO: ya existe ${ruta}. No se creó el superadministrador para no ` +
        'pisar credenciales sin leer. Léalo con cat, bórrelo y vuelva a correr init-db.');
      return false;
    }
    try { fs.unlinkSync(ruta); } catch (_) { /* no se llegó a crear */ }
    throw err;
  }

  // 2. La cuenta y su apunte, en una transacción.
  try {
    await connection.beginTransaction();
    const [r] = await connection.query(
      // `telefono` y `two_factor_enabled = 1`: el superadministrador entra
      // siempre con código, y el código necesita a dónde llegar.
      `INSERT INTO usuarios (nombre, email, password_hash, rol_id, activo, es_superadmin, debe_cambiar_password,
                             telefono, two_factor_enabled)
       VALUES ('Superadministrador', ?, ?, ?, 1, 1, 1, ?, 1)`,
      [CORREO_SUPERADMIN, hash, rolAdmin.id, TELEFONO_SUPERADMIN]
    );
    await connection.query(
      `INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, detalle, ip)
       VALUES (?, 'crear_superadmin', 'usuarios', ?, ?, NULL)`,
      [r.insertId, r.insertId,
       `Se creó la cuenta de superadministrador ${CORREO_SUPERADMIN} al instalar la campaña (init-db).`]
    );
    await connection.commit();
  } catch (err) {
    try { await connection.rollback(); } catch (_) { /* la conexión ya no sirve */ }
    try { fs.unlinkSync(ruta); } catch (_) { /* nada que borrar */ }
    if (err.code === 'ER_DUP_ENTRY') {
      console.warn('AVISO: otra corrida creó el superadministrador (o el correo) a la vez. No se creó otro.');
      return false;
    }
    throw err;
  }

  console.log('----------------------------------------------------');
  console.log('Superadministrador creado: ' + CORREO_SUPERADMIN);
  console.log('  Credenciales en: ' + ruta + ' (modo 0600)');
  console.log('  Léalas con:      cat ' + ruta);
  console.log('  y BORRE el archivo después. Deberá cambiar la contraseña en el primer ingreso.');
  console.log('----------------------------------------------------');
  return true;
}

/**
 * El superadministrador entra SIEMPRE con código, y el código necesita a dónde
 * llegar. Corre en cada init-db (no solo en instalaciones nuevas), así que
 * alcanza también a las campañas que ya existían.
 *
 * Para la cuenta con `es_superadmin = 1`:
 *   - `two_factor_enabled = 1`;
 *   - `telefono` = SUPERADMIN_TELEFONO, SOLO si está vacío (nunca pisa uno puesto).
 *
 * NO crea ni eleva cuentas (eso es crearSuperadminInicial y
 * scripts/elevar-superadmin.js) y NO toca contraseñas. Idempotente: segunda
 * pasada, cero filas cambiadas. Imprime solo cuántos superadmins asegura.
 */
async function asegurarSuperadmin(connection) {
  const { TELEFONO_SUPERADMIN } = require('../config/superadminCorreo');
  await connection.query(
    `UPDATE usuarios
        SET two_factor_enabled = 1,
            telefono = IF(telefono IS NULL OR TRIM(telefono) = '', ?, telefono)
      WHERE es_superadmin = 1
        AND (two_factor_enabled IS NULL OR two_factor_enabled <> 1
             OR telefono IS NULL OR TRIM(telefono) = '')`,
    [TELEFONO_SUPERADMIN]
  );
  const [[{ n }]] = await connection.query(`SELECT COUNT(*) AS n FROM usuarios WHERE es_superadmin = 1`);
  console.log(`superadmin asegurado (${n})`);
}

/**
 * El superadministrador no puede formar parte de la estructura.
 *
 * Casi todo listado de personas (estructura, organigrama, dashboard, testigos,
 * exportaciones) parte de `estructura JOIN usuarios`. La cuenta es invisible
 * en ellos MIENTRAS NO TENGA FILA en `estructura`: si un administrador teclea
 * su correo en «Agregar a la estructura», varias rutas reutilizan la cuenta
 * existente y la cuenta aparecería en todas partes. Se impide en la base, no
 * en cada una de las seis rutas que insertan, igual que el índice
 * uq_superadmin_unico: da igual por dónde entre el INSERT.
 *
 * Solo los crea si faltan: en una corrida sobre una base ya instalada no toca
 * nada. (Si algún día cambia el cuerpo, hay que cambiar también el nombre.)
 *
 * Sin el privilegio TRIGGER solo avisa, como crearTriggersPuestoId.
 */
async function crearTriggersEstructuraSinSuperadmin(connection) {
  const [existentes] = await connection.query(
    `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE()
        AND TRIGGER_NAME IN ('trg_estructura_sin_superadmin_ins', 'trg_estructura_sin_superadmin_upd')`);
  if (existentes.length === 2) return false;
  const cuerpo = (esActualizacion) => `
    IF ${esActualizacion ? 'NOT (NEW.usuario_id <=> OLD.usuario_id) AND ' : ''}EXISTS (
         SELECT 1 FROM usuarios WHERE id = NEW.usuario_id AND es_superadmin = 1) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'El superadministrador no puede formar parte de la estructura.';
    END IF`;
  try {
    for (const momento of ['ins', 'upd']) {
      const evento = momento === 'ins' ? 'INSERT' : 'UPDATE';
      await connection.query(`DROP TRIGGER IF EXISTS trg_estructura_sin_superadmin_${momento}`);
      await connection.query(
        `CREATE TRIGGER trg_estructura_sin_superadmin_${momento} BEFORE ${evento} ON estructura
         FOR EACH ROW ${cuerpo(momento === 'upd')}`
      );
    }
    console.log('Disparadores de estructura (el superadministrador no entra en ella) creados.');
    return true;
  } catch (err) {
    if (err.code === 'ER_SPECIFIC_ACCESS_DENIED_ERROR' || err.errno === 1142) {
      console.warn(
        'AVISO: sin permiso para crear disparadores (TRIGGER): nada impide en la base que el ' +
        'superadministrador sea añadido a la estructura. Hay que pedirle ese privilegio al hosting.'
      );
      return false;
    }
    throw err;
  }
}

/**
 * Los ids de la tabla LOCAL `territorios` nacen en un rango que el catálogo no usa.
 *
 * Una campaña nueva edita sus territorios en una tabla local (config/territoriosModo.js).
 * Los ids locales y los del catálogo (`territoriosdb.ctc_territorios`, unas 42 mil
 * filas) se solaparían desde el 1, y si algún día esa campaña se conecta al catálogo,
 * un `territorio_id` viejo resolvería a OTRO territorio real en vez de fallar — el error
 * que ya costó un votante de Manizales asignado a Arcabuco. Desde 500.000.000 un id
 * local no existe en el catálogo: la referencia vieja da NULL y se ve. Cabe en INT.
 *
 * NUNCA SOBRE UNA VISTA. Las campañas conectadas tienen `territorios` como vista y
 * `ALTER TABLE` sobre ella fallaría — o peor. Se mira `TABLE_TYPE` y solo `BASE TABLE`
 * pasa. Se decide con `MAX(id)`, no con el contador de information_schema, que MySQL
 * guarda en caché y puede estar atrasado. Es idempotente: si ya hay ids en el rango, o
 * el contador ya está ahí, no hace nada.
 */
const INICIO_IDS_LOCALES = 500000000;
async function ajustarContadorTerritorios(connection) {
  const [[t]] = await connection.query(
    `SELECT TABLE_TYPE AS tipo FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'territorios' LIMIT 1`);
  if (!t || t.tipo !== 'BASE TABLE') {
    console.log(`territorios no es una tabla local (${t ? t.tipo : 'no existe'}): no se toca su contador.`);
    return false;
  }
  const [[m]] = await connection.query(`SELECT COALESCE(MAX(id), 0) AS maximo FROM territorios`);
  if (Number(m.maximo) >= INICIO_IDS_LOCALES) return false;

  // ¿El contador ya está alto? Se pide al servidor que no use la caché de estadísticas
  // (MySQL 8); si no se puede, se aplica el ALTER, que es idempotente.
  try {
    await connection.query(`SET SESSION information_schema_stats_expiry = 0`);
    const [[c]] = await connection.query(
      `SELECT AUTO_INCREMENT AS siguiente FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'territorios'`);
    if (c && Number(c.siguiente) >= INICIO_IDS_LOCALES) return false;
  } catch (_) { /* se aplica igual */ }

  await connection.query(`ALTER TABLE territorios AUTO_INCREMENT = ${INICIO_IDS_LOCALES}`);
  console.log(`territorios (tabla local): los ids nuevos empezarán en ${INICIO_IDS_LOCALES}.`);
  return true;
}

/**
 * Los territorios de una persona: la tabla `estructura_territorios` ya existe
 * (la crea db/schema.sql, que se aplica entera al principio de cada corrida);
 * aquí se la RELLENA.
 *
 * Una fila principal por cada persona que tiene `estructura.territorio_id` y
 * NO TIENE NINGUNA fila en la tabla. La condición es «ninguna», no «ninguna
 * principal», y no es un detalle: si alguien quitó a mano un territorio, o
 * cambió de principal, volver a correr esto no debe resucitar lo que se quitó.
 * Una persona que ya tiene su lista no se toca.
 *
 * No lee `territorios`, así que da igual que sea vista del catálogo o tabla
 * local. Es idempotente: la segunda corrida inserta 0 filas.
 *
 * Al terminar se cuenta cuántas personas quedaron con la columna y la fila
 * principal en desacuerdo (la consulta de control de lib/territoriosPersona.js);
 * si no es 0 se AVISA, no se arregla: el desacuerdo sería de código, y
 * corregirlo en silencio lo taparía.
 */
async function rellenarTerritoriosPuente(connection) {
  const [[existe]] = await connection.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estructura_territorios'`);
  if (!Number(existe.n)) {
    throw new Error('Falta la tabla estructura_territorios: db/schema.sql debía crearla en esta misma corrida.');
  }
  const [res] = await connection.query(
    `INSERT INTO estructura_territorios (estructura_id, territorio_id, es_principal)
     SELECT e.id, e.territorio_id, 1
       FROM estructura e
      WHERE e.territorio_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM estructura_territorios x WHERE x.estructura_id = e.id)`);
  console.log(`estructura_territorios: ${res.affectedRows} persona(s) con su territorio principal copiado a la lista.`);

  const [[desacuerdo]] = await connection.query(
    `SELECT COUNT(*) AS n
       FROM estructura e
      WHERE e.territorio_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM estructura_territorios x
                         WHERE x.estructura_id = e.id AND x.es_principal = 1
                           AND x.territorio_id = e.territorio_id)`);
  if (Number(desacuerdo.n) > 0) {
    console.warn(`AVISO: ${desacuerdo.n} persona(s) tienen estructura.territorio_id sin su fila principal igual en estructura_territorios. Corra la consulta de control de lib/territoriosPersona.js para verlas.`);
  } else {
    console.log('estructura_territorios: la columna y la fila principal coinciden en todas las personas.');
  }
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true
  });
  console.log('Conectado a MySQL. Aplicando esquema...');
  /* QUÉ TABLAS DE «YA VOTÓ» EXISTÍAN ANTES DE APLICAR schema.sql. Se mira AQUÍ, antes
     del CREATE TABLE IF NOT EXISTS: después es imposible distinguir «ya estaba» de
     «la acaba de crear esta misma corrida». La primera versión lo deducía por la
     hora de creación (CREATE_TIME) y decía «creada» en una segunda corrida hecha a
     los pocos segundos de la primera — justo lo que se hace para comprobar que
     init-db es repetible. */
  const [yaExistian] = await connection.query(
    `SELECT TABLE_NAME AS t FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('votante_votos', 'votante_voto_tokens',
       'dia_d_resultado_oficial', 'dia_d_mesa_revision', 'dia_d_paquetes', 'dia_d_suplentes_testigo',
       'dia_d_checkin', 'dia_d_alertas_atendidas', 'dia_d_alertas_avisadas')`);
  const tablasVotoQueExistian = new Set(yaExistian.map(r => r.t));
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await connection.query(schema);
  console.log('Esquema aplicado correctamente.');
  // Migraciones defensivas para instalaciones ya existentes (creadas antes de
  // que estas columnas se agregaran al esquema).
  await agregarColumnaSiFalta(
    connection, 'configuracion_campana',
    'territorio_departamento VARCHAR(100) NULL AFTER ciudad',
    'territorio_departamento'
  );
  await agregarColumnaSiFalta(
    connection, 'configuracion_campana',
    'territorio_ciudad VARCHAR(100) NULL AFTER territorio_departamento',
    'territorio_ciudad'
  );
  await agregarColumnaSiFalta(
    connection, 'configuracion_campana',
    'slogan_campana VARCHAR(255) NULL AFTER cargo_aspira',
    'slogan_campana'
  );
  await agregarColumnaSiFalta(
    connection, 'usuarios',
    'two_factor_enabled TINYINT(1) DEFAULT 0 AFTER debe_cambiar_password',
    'two_factor_enabled'
  );
  // Número de identificación del personal de Estructura (único, para poder
  // avisar "ya registrado por otro líder" antes de guardar).
  await agregarColumnaSiFalta(
    connection, 'usuarios',
    'numero_identificacion VARCHAR(20) NULL UNIQUE AFTER nombre',
    'numero_identificacion'
  );
  // Lugar de votación del personal de Estructura.
  await agregarColumnaSiFalta(
    connection, 'usuarios',
    'departamento_votacion VARCHAR(100) NULL AFTER numero_identificacion',
    'departamento_votacion'
  );
  await agregarColumnaSiFalta(
    connection, 'usuarios',
    'municipio_votacion VARCHAR(100) NULL AFTER departamento_votacion',
    'municipio_votacion'
  );
  await agregarColumnaSiFalta(
    connection, 'usuarios',
    'puesto_votacion VARCHAR(150) NULL AFTER municipio_votacion',
    'puesto_votacion'
  );
  await agregarColumnaSiFalta(
    connection, 'usuarios',
    'mesa_votacion VARCHAR(20) NULL AFTER puesto_votacion',
    'mesa_votacion'
  );
  // Comuna/Corregimiento y Barrio/Vereda de residencia (dos campos en
  // cascada, distintos del territorio de influencia).
  await agregarColumnaSiFalta(
    connection, 'usuarios',
    'departamento_residencia VARCHAR(100) NULL AFTER mesa_votacion',
    'departamento_residencia'
  );
  await agregarColumnaSiFalta(
    connection, 'usuarios',
    'ciudad_residencia VARCHAR(100) NULL AFTER departamento_residencia',
    'ciudad_residencia'
  );
  await agregarColumnaSiFalta(
    connection, 'usuarios',
    'comuna_corregimiento_residencia VARCHAR(150) NULL AFTER ciudad_residencia',
    'comuna_corregimiento_residencia'
  );
  await agregarColumnaSiFalta(
    connection, 'usuarios',
    'barrio_residencia VARCHAR(150) NULL AFTER comuna_corregimiento_residencia',
    'barrio_residencia'
  );
  // Tipo de cargo político/comunitario (opcional, independiente del Cargo de Estructura).
  await agregarColumnaSiFalta(
    connection, 'usuarios',
    `tipo_cargo ENUM(
      'concejal','edil','aspirante_concejo','aspirante_jal','presidente_jal',
      'presidente_jac','miembro_jal','miembro_jac','presidente_gremio','presidente_asociacion'
    ) NULL AFTER barrio_residencia`,
    'tipo_cargo'
  );
  // Género y Edad, en Agregar a la estructura (Datos personales).
  await agregarColumnaSiFalta(
    connection, 'usuarios',
    `genero ENUM('mujer','hombre','no_binario','prefiero_no_responder') DEFAULT 'prefiero_no_responder' AFTER barrio_residencia`,
    'genero'
  );
  await agregarColumnaSiFalta(
    connection, 'usuarios',
    'edad SMALLINT UNSIGNED NULL AFTER genero',
    'edad'
  );
  // Amplía el ENUM de tipo_cargo con Organizaciones sociales/religiosas
  // (para instalaciones que ya tenían la columna con la lista anterior).
  await modificarColumna(
    connection, 'usuarios',
    `tipo_cargo ENUM(
      'concejal','edil','aspirante_concejo','aspirante_jal','presidente_jal',
      'presidente_jac','miembro_jal','miembro_jac','presidente_gremio','presidente_asociacion',
      'organizaciones_sociales','organizaciones_religiosas'
    ) NULL`
  );
  // El correo electrónico deja de ser obligatorio: los líderes/sublíderes
  // se pueden crear solo con Número de identificación (que sirve como
  // Nombre de usuario y contraseña inicial). El login ya acepta ambos.
  await modificarColumna(connection, 'usuarios', 'email VARCHAR(150) NULL');

  // Área de influencia: geográfica (Territorio) u Organización.
  await agregarColumnaSiFalta(
    connection, 'estructura',
    "tipo_area_influencia ENUM('territorio','organizacion') NOT NULL DEFAULT 'territorio' AFTER cargo",
    'tipo_area_influencia'
  );
  await agregarColumnaSiFalta(
    connection, 'estructura',
    'organizacion VARCHAR(150) NULL AFTER tipo_area_influencia',
    'organizacion'
  );
  // territorio_id debe permitir NULL desde que existe el área de
  // influencia por Organización (antes era siempre obligatorio).
  await modificarColumna(connection, 'estructura', 'territorio_id INT NULL');
  // Nuevo cargo "Coordinador Organizaciones" (coordina a las personas cuya
  // área de influencia es una Organización, en vez de un territorio).
  await modificarColumna(
    connection, 'estructura',
    "cargo ENUM('coordinador','coordinador_organizaciones','lider','usuario','testigo') NOT NULL"
  );
  // Distingue, dentro de cargo='testigo', si la persona cubre una sola
  // mesa (Testigo electoral, el caso normal) o varias mesas del mismo
  // puesto de votación (Coordinador de puesto).
  await agregarColumnaSiFalta(
    connection, 'estructura',
    `tipo_testigo ENUM('mesa','puesto') NOT NULL DEFAULT 'mesa' AFTER cargo`,
    'tipo_testigo'
  );
  // Lista de mesas que cubre un Coordinador de puesto (tipo_testigo='puesto') —
  // el Testigo electoral normal (tipo_testigo='mesa') sigue usando la
  // columna mesa_votacion de usuarios, una sola mesa.
  await agregarColumnaSiFalta(
    connection, 'estructura',
    `mesas_asignadas JSON NULL AFTER tipo_testigo`,
    'mesas_asignadas'
  );
  // Relación horizontal (asesor) vs. jerárquica normal (subordinado) en el Organigrama manual.
  await agregarColumnaSiFalta(
    connection, 'organigrama_nodos',
    "tipo_relacion ENUM('subordinado','asesor') NOT NULL DEFAULT 'subordinado' AFTER padre_id",
    'tipo_relacion'
  );
  // Categoría obligatoria del formulario "Nuevo votante o sublíder": Votante o Sublíder.
  await agregarColumnaSiFalta(
    connection, 'votantes',
    "categoria ENUM('votante','sublider') NOT NULL DEFAULT 'votante' AFTER id",
    'categoria'
  );
  // Área de influencia del Sublíder: geográfica (Territorio) u Organización.
  await agregarColumnaSiFalta(
    connection, 'votantes',
    "tipo_area_influencia ENUM('territorio','organizacion') NOT NULL DEFAULT 'territorio' AFTER territorio_id",
    'tipo_area_influencia'
  );
  await agregarColumnaSiFalta(
    connection, 'votantes',
    'organizacion VARCHAR(150) NULL AFTER tipo_area_influencia',
    'organizacion'
  );
  // Sublíder (colaborador bajo el líder) que refirió al contacto, opcional.
  await agregarColumnaSiFalta(
    connection, 'votantes',
    'sublider_id INT NULL AFTER lider_id',
    'sublider_id'
  );
  // Departamento/Ciudad de residencia (catálogo DANE), en Nuevo votante o sublíder.
  await agregarColumnaSiFalta(
    connection, 'votantes',
    'departamento_residencia VARCHAR(100) NULL AFTER direccion',
    'departamento_residencia'
  );
  await agregarColumnaSiFalta(
    connection, 'votantes',
    'ciudad_residencia VARCHAR(100) NULL AFTER departamento_residencia',
    'ciudad_residencia'
  );
  await agregarColumnaSiFalta(
    connection, 'estructura',
    'direccion VARCHAR(255) NULL AFTER meta_lideres',
    'direccion'
  );
  await agregarColumnaSiFalta(
    connection, 'estructura',
    'latitud DECIMAL(10,7) NULL AFTER direccion',
    'latitud'
  );
  await agregarColumnaSiFalta(
    connection, 'estructura',
    'longitud DECIMAL(10,7) NULL AFTER latitud',
    'longitud'
  );
  await agregarColumnaSiFalta(
    connection, 'estructura',
    'geocodificado_en DATETIME NULL AFTER longitud',
    'geocodificado_en'
  );
  // Georreferenciación de votantes/contactos (mapa territorial + botón GPS).
  await agregarColumnaSiFalta(
    connection, 'votantes',
    "area ENUM('urbano','rural') NULL AFTER direccion",
    'area'
  );
  await agregarColumnaSiFalta(
    connection, 'votantes',
    'latitud DECIMAL(10,7) NULL AFTER area',
    'latitud'
  );
  await agregarColumnaSiFalta(
    connection, 'votantes',
    'longitud DECIMAL(10,7) NULL AFTER latitud',
    'longitud'
  );
  await agregarColumnaSiFalta(
    connection, 'votantes',
    'geocodificado_en DATETIME NULL AFTER longitud',
    'geocodificado_en'
  );
  // Lugar de votación de votantes/contactos (Departamento y Municipio; Puesto
  // y Mesa ya existían en el esquema pero sin campo en el formulario).
  await agregarColumnaSiFalta(
    connection, 'votantes',
    'departamento_votacion VARCHAR(100) NULL',
    'departamento_votacion'
  );
  await agregarColumnaSiFalta(
    connection, 'votantes',
    'municipio_votacion VARCHAR(100) NULL AFTER departamento_votacion',
    'municipio_votacion'
  );
  // Área/georreferenciación y responsables informativos (coordinador/líder) de Eventos.
  await agregarColumnaSiFalta(
    connection, 'eventos',
    "area ENUM('urbano','rural') NULL AFTER territorio_id",
    'area'
  );
  await agregarColumnaSiFalta(
    connection, 'eventos',
    'latitud DECIMAL(10,7) NULL AFTER area',
    'latitud'
  );
  await agregarColumnaSiFalta(
    connection, 'eventos',
    'longitud DECIMAL(10,7) NULL AFTER latitud',
    'longitud'
  );
  await agregarColumnaSiFalta(
    connection, 'eventos',
    'geocodificado_en DATETIME NULL AFTER longitud',
    'geocodificado_en'
  );
  await agregarColumnaSiFalta(
    connection, 'eventos',
    'coordinador_id INT NULL AFTER responsable_id',
    'coordinador_id'
  );
  await agregarColumnaSiFalta(
    connection, 'eventos',
    'lider_id INT NULL AFTER coordinador_id',
    'lider_id'
  );
  // ¿Este es el arranque de una instalación NUEVA? Lo decide el administrador: si lo
  // creamos ahora, la base estaba vacía de personas. Lo usa crearSuperadminInicial.
  let adminCreadoEstaCorrida = false;
  const [admins] = await connection.query(
    `SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.nombre = 'admin' LIMIT 1`
  );
  if (admins.length === 0) {
    const email = process.env.ADMIN_EMAIL || 'admin@campana.local';
    // SIN ADMIN_PASSWORD SE GENERA UNA AL AZAR, NUNCA UNA FIJA.
    //
    // Antes el valor por defecto era una contraseña escrita en este archivo,
    // y por tanto conocida por cualquiera que vea el repositorio. Medido el
    // 9 de agosto de 2026: NINGUNA de las tres instalaciones define
    // ADMIN_PASSWORD, así que las tres nacieron con esa misma clave — y
    // `.env.example` ni la mencionaba, de modo que nadie sabía que podía
    // fijarla.
    //
    // `debe_cambiar_password = 1` obliga a cambiarla al entrar, pero eso no
    // sirve de nada si quien entra primero no es el dueño de la campaña.
    // Una al azar cierra esa ventana sin estorbar el aprovisionamiento: se
    // imprime abajo, igual que antes.
    const claveDeEntorno = Boolean(process.env.ADMIN_PASSWORD);
    const passwordPlano = process.env.ADMIN_PASSWORD
      || crypto.randomBytes(12).toString('base64url');
    const hash = await bcrypt.hash(passwordPlano, 12);
    const [[rolAdmin]] = await connection.query(`SELECT id FROM roles WHERE nombre = 'admin'`);

    /* LA CONTRASEÑA GENERADA NO SE IMPRIME: SE DEJA EN UN ARCHIVO.
       Lo que sale por consola acaba en el historial del terminal, en la salida
       del actualizador o en un log (el actualizador corre init-db con la salida
       a un archivo). El archivo queda en la carpeta de la instalación, modo 0600,
       igual que el del superadministrador: se lee con cat y se borra.

       Solo cuando la clave se GENERÓ. Si el operador la fijó en ADMIN_PASSWORD
       ya la tiene, y copiarla a un segundo archivo en claro sería dejar dos
       copias donde antes había una.

       El archivo se escribe ANTES de tocar la base y con `wx` (no sobrescribe):
       si la escritura falla no queda una cuenta cuya clave nadie conoce, y si ya
       hay un archivo sin leer NO se pisa — se detiene, porque seguir sin dejar la
       clave en ninguna parte dejaría una instalación sin administrador utilizable. */
    const rutaAdmin = path.join(__dirname, '..', ARCHIVO_CREDENCIALES_ADMIN);
    if (!claveDeEntorno) {
      try {
        fs.writeFileSync(
          rutaAdmin,
          `Administrador de esta instalación\n` +
          `Correo:     ${email}\n` +
          `Contraseña: ${passwordPlano}\n` +
          `Creada:     ${new Date().toISOString()}\n\n` +
          `Debe cambiarla en el primer ingreso. Lea este archivo con cat y BÓRRELO.\n`,
          { flag: 'wx', mode: 0o600 }
        );
        // `mode` se enmascara con el umask y puede heredar una ACL de la carpeta:
        // se fija y se comprueba, no se supone.
        fs.chmodSync(rutaAdmin, 0o600);
        if ((fs.statSync(rutaAdmin).mode & 0o777) !== 0o600) {
          throw new Error(`No se pudo dejar ${rutaAdmin} en modo 0600.`);
        }
      } catch (err) {
        if (err.code === 'EEXIST') {
          throw new Error(`Ya existe ${rutaAdmin}. No se creó el administrador para no pisar ` +
            'credenciales sin leer. Léalo con cat, bórrelo y vuelva a correr init-db.');
        }
        try { fs.unlinkSync(rutaAdmin); } catch (_) { /* no se llegó a crear */ }
        throw err;
      }
    }

    try {
      await connection.query(
        `INSERT INTO usuarios (nombre, email, password_hash, rol_id, activo, debe_cambiar_password)
         VALUES (?, ?, ?, ?, 1, 1)`,
        ['Administrador de Campaña', email, hash, rolAdmin.id]
      );
    } catch (err) {
      // Sin cuenta no hay clave que guardar: el archivo no se queda mintiendo.
      if (!claveDeEntorno) { try { fs.unlinkSync(rutaAdmin); } catch (_) { /* ya no está */ } }
      throw err;
    }
    adminCreadoEstaCorrida = true;
    console.log('----------------------------------------------------');
    console.log('Usuario administrador creado:');
    console.log('  Email:    ', email);
    if (claveDeEntorno) {
      console.log('  Contraseña: la de ADMIN_PASSWORD (.env)');
    } else {
      console.log('  Credenciales en: ' + rutaAdmin + ' (modo 0600)');
      console.log('  Léalas con:      cat ' + rutaAdmin);
      console.log('  y BORRE el archivo después.');
    }
    console.log('  (Deberá cambiar la contraseña en el primer ingreso)');
    console.log('----------------------------------------------------');
  } else {
    console.log('Ya existe al menos un usuario administrador. No se creó uno nuevo.');
  }

  // "Editar" y "Agregar nuevo" — niveles de permiso más finos, aparte de
  // "Ver" (permitido), para instalaciones que ya tenían permisos_rol.
  const editarRecienCreada = await agregarColumnaSiFalta(
    connection, 'permisos_rol',
    'editar TINYINT(1) NOT NULL DEFAULT 1 AFTER permitido',
    'editar'
  );
  const agregarRecienCreada = await agregarColumnaSiFalta(
    connection, 'permisos_rol',
    'agregar TINYINT(1) NOT NULL DEFAULT 1 AFTER editar',
    'agregar'
  );

  // Estas dos columnas se crean con DEFAULT 1 (para no dejar a nadie sin
  // poder editar/agregar de la nada) — pero eso incluye a filas de
  // "territorial" que antes de este parche NO tenían acceso a
  // editar/agregar (esa restricción vivía en el código, no en esta
  // tabla). Se corrige acá, UNA SOLA VEZ (justo cuando la columna se
  // acaba de crear) — para no pisar después cualquier ajuste que el
  // admin haga desde Asignación de permisos.
  if (editarRecienCreada || agregarRecienCreada) {
    await connection.query(
      `UPDATE permisos_rol SET editar = 0, agregar = 0
       WHERE modulo = 'territorial' AND rol NOT IN ('admin', 'coordinador')`
    );
    console.log('Editar/Agregar de "territorial" ajustado para preservar el comportamiento previo (solo Admin y Coordinador).');
  }

  // «Importar / Exportar» — un cuarto nivel, aparte de Ver/Editar/Agregar, que
  // gobierna los botones de importar, exportar e imprimir a PDF y, a diferencia
  // de los otros tres, TAMBIÉN las rutas del servidor (middleware/permisoModulo.js).
  //
  // DEFAULT 0: una fila que nadie rellenó no da permiso. Pero eso por sí solo
  // dejaría sin importar ni exportar a quien hoy puede, así que al crearse la
  // columna se enciende para quien ya tenía el derecho — y SOLO entonces, igual
  // que arriba: si se repitiera en cada corrida, pisaría lo que el administrador
  // haya apagado desde Asignación de permisos.
  const importarExportarRecienCreada = await agregarColumnaSiFalta(
    connection, 'permisos_rol',
    "importar_exportar TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Importar y exportar archivos de datos de ese módulo' AFTER agregar",
    'importar_exportar'
  );
  if (importarExportarRecienCreada) {
    let encendidas = 0;
    for (const [modulo, roles] of Object.entries(IMPORTAR_EXPORTAR_POR_DEFECTO)) {
      const [r] = await connection.query(
        `UPDATE permisos_rol SET importar_exportar = 1 WHERE modulo = ? AND rol IN (?)`,
        [modulo, roles]
      );
      encendidas += r.affectedRows;
    }
    console.log(`Importar/Exportar encendido para administrador y coordinador donde ya importaban o exportaban (${encendidas} fila(s)). OJO: cuatro exportaciones que antes solo pedían sesión (territorios, asistentes de eventos y 2 de Word del organigrama) ahora exigen el permiso.`);
  }

  // El campo Género de Votantes/sublíderes nunca se había expuesto en el
  // formulario — ahora se agrega con las opciones Mujer/Hombre/No
  // binario/Prefiero no responder (antes el ENUM tenía M/F/Otro/No
  // informa). Se remapean los valores existentes ANTES de cambiar el
  // ENUM, y SOLO si todavía tiene la definición vieja — así, si se vuelve
  // a correr "npm run init-db" más adelante (por otro parche), esto no
  // pisa los valores que la gente ya haya elegido con el formulario nuevo.
  const [[columnaGenero]] = await connection.query(`
    SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'votantes' AND COLUMN_NAME = 'genero'
  `);
  const generoTieneEnumViejo = columnaGenero && columnaGenero.COLUMN_TYPE && columnaGenero.COLUMN_TYPE.includes("'M'");
  if (generoTieneEnumViejo) {
    // Bug corregido: no se puede escribir 'hombre'/'mujer'/... directamente
    // mientras la columna siga siendo el ENUM viejo (solo admite
    // 'M'/'F'/'Otro'/'No informa') — MySQL lo rechaza con "Data truncated".
    // Por eso primero se amplía a VARCHAR (conserva los valores actuales
    // tal cual), se remapean, y AL FINAL se angosta al ENUM nuevo.
    await connection.query(`ALTER TABLE votantes MODIFY genero VARCHAR(30) DEFAULT 'No informa'`);
    await connection.query(`
      UPDATE votantes SET genero = CASE genero
        WHEN 'M' THEN 'hombre'
        WHEN 'F' THEN 'mujer'
        WHEN 'Otro' THEN 'no_binario'
        ELSE 'prefiero_no_responder'
      END
    `);
    console.log('Valores de género de Votantes remapeados a las nuevas opciones.');
  }
  await modificarColumna(
    connection, 'votantes',
    `genero ENUM('mujer','hombre','no_binario','prefiero_no_responder') DEFAULT 'prefiero_no_responder'`
  );
  await agregarColumnaSiFalta(
    connection, 'votantes',
    'edad SMALLINT UNSIGNED NULL AFTER genero',
    'edad'
  );

  // Destinatarios manuales en el CRM (números/correos escritos a mano,
  // sin un registro real en Votantes/Estructura). Ampliar el ENUM es
  // seguro: solo se agrega una opción nueva, los valores existentes
  // ('votante'/'estructura') siguen siendo válidos.
  await modificarColumna(
    connection, 'comunicaciones_envios',
    `destinatario_tipo ENUM('votante','estructura','manual') NOT NULL`
  );
  await modificarColumna(
    connection, 'comunicaciones_envios',
    `destinatario_id INT NULL COMMENT 'id en votantes o en estructura, según destinatario_tipo; NULL si es un contacto manual'`
  );

  // "email_personal" — canal nuevo para "Enviar E-mail" (grupos pequeños,
  // vía el correo de Hostinger que ya está configurado), separado del
  // canal "email" que usa el CRM masivo con SendGrid. Ampliar el ENUM es
  // seguro: los valores existentes siguen siendo válidos.
  // 'push' se agrega para el canal de avisos (bloque 4). 'whatsapp' se
  // CONSERVA aunque el canal esté desactivado: hay campañas viejas que
  // podrían tenerlo guardado, y quitarlo del ENUM las dejaría con un valor
  // que MySQL no reconoce.
  await modificarColumna(
    connection, 'comunicaciones_campanas',
    `canal ENUM('email','sms','whatsapp','email_personal','push') NOT NULL`
  );

  // Organigrama: Nombres/Apellidos separados (reemplaza al campo "nombre"
  // libre para los cargos nuevos), más Teléfono y E-mail, para poder
  // contactarlos desde el CRM.
  await agregarColumnaSiFalta(connection, 'organigrama_nodos', 'nombres VARCHAR(100) NULL AFTER nombre', 'nombres');
  await agregarColumnaSiFalta(connection, 'organigrama_nodos', 'apellidos VARCHAR(100) NULL AFTER nombres', 'apellidos');
  await agregarColumnaSiFalta(connection, 'organigrama_nodos', 'telefono VARCHAR(30) NULL AFTER apellidos', 'telefono');
  await agregarColumnaSiFalta(connection, 'organigrama_nodos', 'email VARCHAR(150) NULL AFTER telefono', 'email');
  await agregarColumnaSiFalta(connection, 'organigrama_nodos', `nivel ENUM('nivel_1','nivel_2','nivel_3','asesores') NULL AFTER email`, 'nivel');
  // Se agregan Nivel 4, 5 y 6 — como solo se AMPLÍA el conjunto de valores
  // del ENUM (no se quita ni se renombra ninguno existente), se puede
  // ampliar directamente sin el paso intermedio de "abrir a texto libre"
  // que sí hace falta cuando una migración angosta o remapea valores.
  await modificarColumna(connection, 'organigrama_nodos', `nivel ENUM('nivel_1','nivel_2','nivel_3','nivel_4','nivel_5','nivel_6','asesores') NULL`);

  // Se AMPLÍA el ENUM de tipo de recurso con "jingle" y "foto_campana" —
  // como solo se agregan valores nuevos (no se quita ni se renombra
  // ninguno existente), es seguro correr esto directo, sin necesidad del
  // procedimiento de ensanchar a texto libre primero.
  await modificarColumna(
    connection, 'recursos',
    `tipo ENUM('noticia','post_redes','video','publicidad_digital','publicidad_impresa','proxima_reunion','jingle','foto_campana') NOT NULL`
  );

  // Se AMPLÍA el ENUM de origen de votantes con "estructura" — para
  // distinguir los votantes que se crearon/actualizaron automáticamente
  // al agregar a esa misma persona en Estructura territorial.
  await modificarColumna(
    connection, 'votantes',
    `origen ENUM('manual','importado','formulario_publico','estructura','enlace_lider') DEFAULT 'manual'`
  );

  // Adjunto opcional de una campaña. Hoy NINGÚN canal lo admite: era
  // exclusivo de WhatsApp, que está desactivado (Meta prohíbe las
  // campañas políticas en su API de negocios). Las columnas se conservan
  // para las campañas viejas que tengan uno guardado.
  await agregarColumnaSiFalta(connection, 'comunicaciones_campanas', 'adjunto_nombre VARCHAR(255) NULL AFTER filtros', 'adjunto_nombre');
  await agregarColumnaSiFalta(connection, 'comunicaciones_campanas', 'adjunto_url VARCHAR(500) NULL AFTER adjunto_nombre', 'adjunto_url');

  // Guarda el ID (SID) que Twilio le asigna a cada mensaje de SMS/WhatsApp
  // enviado — así, cuando Twilio avisa después que un mensaje cambió de
  // estado (por ejemplo, de "enviado" a "no entregado"), el sistema sabe
  // a cuál fila de comunicaciones_envios corregirle el estado.
  await agregarColumnaSiFalta(connection, 'comunicaciones_envios', 'twilio_sid VARCHAR(50) NULL AFTER destinatario_contacto', 'twilio_sid');

  // --- El número de mesa, con el mismo tipo en todas partes ---
  //
  // `estructura.mesa_votacion` era INT y `usuarios`, `votantes` y
  // `dia_d_reportes` lo tenían como VARCHAR(20). El mismo dato con dos tipos
  // obliga a MySQL a convertir en cada `COALESCE(e.mesa_votacion,
  // u.mesa_votacion)` —que es como lo leen el Día D y el CRM— y abre la
  // puerta a comparaciones sorpresa ('03' contra 3).
  //
  // LA CONVERSIÓN VA CON GUARDA, Y LA RAZÓN SE COMPROBÓ, NO SE SUPUSO.
  //   La primera versión de este comentario decía que un `MODIFY ... INT`
  //   convertiría un valor no numérico en 0 en silencio. Es FALSO en este
  //   servidor: MySQL está en modo estricto y lo rechaza con «Incorrect
  //   integer value: 'A-7'». Probado.
  //
  //   La guarda sigue haciendo falta, por otro motivo: ese error abortaría
  //   `npm run init-db` ENTERO, y como el actualizador lo corre al aplicar un
  //   parche, una sola mesa mal escrita dejaría la campaña con el parche a
  //   medias y reportado como fallido. Así, la tabla se deja como está, se
  //   dice cuántos valores estorban y el resto de migraciones sigue su curso.
  for (const tabla of ['usuarios', 'votantes', 'dia_d_reportes']) {
    const [[col]] = await connection.query(`
      SELECT DATA_TYPE AS tipo, IS_NULLABLE AS nulos FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'mesa_votacion'`,
      [tabla]);
    if (!col || col.tipo === 'int') continue;
    const [[sucios]] = await connection.query(
      `SELECT COUNT(*) AS n FROM ${tabla}
        WHERE mesa_votacion IS NOT NULL AND TRIM(mesa_votacion) <> ''
          AND mesa_votacion NOT REGEXP '^[0-9]+$'`);
    if (sucios.n > 0) {
      console.warn(
        `AVISO: ${tabla}.mesa_votacion tiene ${sucios.n} valor(es) que no son un número entero, ` +
        'así que NO se convirtió a INT (convertirlos los volvería 0 en silencio). ' +
        'Revísalos y vuelve a correr esto.');
      continue;
    }
    const nulos = col.nulos === 'YES' ? 'NULL' : 'NOT NULL';
    // Las cadenas vacías no pasan a INT: se normalizan a NULL primero (solo
    // aplica donde la columna admite nulos).
    if (nulos === 'NULL') {
      await connection.query(`UPDATE ${tabla} SET mesa_votacion = NULL WHERE TRIM(mesa_votacion) = ''`);
    }
    await connection.query(`ALTER TABLE ${tabla} MODIFY mesa_votacion INT ${nulos}`);
    console.log(`${tabla}.mesa_votacion convertida a INT ${nulos}.`);
  }

  // `campana_ambito` se creó a mano en las bases existentes (no la traía este
  // repositorio, ver A26), así que heredó la colación POR DEFECTO DE LA BASE
  // —utf8mb4_general_ci— mientras las 29 tablas del esquema usan
  // utf8mb4_0900_ai_ci. Ahora que `schema.sql` la declara con COLLATE
  // explícito, una instalación nueva nacería distinta de las que ya existen.
  // Se alinea aquí. Es una tabla de una fila: la conversión es instantánea.
  const [[colacionAmbito]] = await connection.query(`
    SELECT TABLE_COLLATION AS colacion FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campana_ambito'`);
  if (colacionAmbito && colacionAmbito.colacion && colacionAmbito.colacion !== 'utf8mb4_0900_ai_ci') {
    await connection.query(
      `ALTER TABLE campana_ambito CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    console.log(`campana_ambito: colación alineada (${colacionAmbito.colacion} -> utf8mb4_0900_ai_ci).`);
  }
  // `sessions` NO se toca: la crea express-mysql-session y usa utf8mb4_bin a
  // propósito — un identificador de sesión SÍ debe distinguir mayúsculas.

  // Índice para el webhook de estado de Twilio, que busca la fila por SID en
  // cada aviso. Sin él es un recorrido completo por aviso, y esta tabla tiene
  // una fila por destinatario (ver A7 de AUDITORIA.md).
  try {
    await connection.query(`ALTER TABLE comunicaciones_envios ADD INDEX idx_envios_twilio_sid (twilio_sid)`);
    console.log('Índice idx_envios_twilio_sid creado.');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
    console.log('El índice idx_envios_twilio_sid ya existía. Sin cambios.');
  }

  // Estado nuevo "sin_lugar_votacion": cuando el mensaje usa los marcadores
  // de Lugar de votación ({lugar_votacion}, {puesto}...) y el destinatario
  // no lo tiene registrado, NO se le envía — le llegaría un mensaje con el
  // lugar en blanco, que es peor que no recibir nada.
  //
  // Se separa de "fallido" a propósito: fallido significa que el envío se
  // intentó y el proveedor lo rechazó. Meterlos en la misma bolsa haría
  // creer que hay un problema de mensajería cuando lo que falta es
  // completar una ficha.
  //
  // Y "dado_de_baja": la persona pidió no recibir más mensajes. Va aparte
  // por la misma razón — no es un fallo de entrega ni una ficha incompleta,
  // es una decisión suya, y ante una queja hay que poder mostrar que se
  // respetó y desde cuándo.
  await modificarColumna(
    connection, 'comunicaciones_envios',
    "estado ENUM('pendiente','enviando','enviado','fallido','sin_contacto','sin_lugar_votacion','dado_de_baja','sin_autorizacion','omitido') NOT NULL DEFAULT 'pendiente'"
  );
  // Recordatorios, Fase 0: «enviando» (la fila está en manos de un ciclo, ya reclamada) y «omitido» (algo cambió entre armar la
  // campaña y enviarla: baja, autorización retirada, ya votó…). `reclamado_en` y `proceso` dicen quién y desde cuándo la tiene,
  // para reconciliar las que quedaron a medias tras un reinicio sin reenviarlas a ciegas.
  await agregarColumnaSiFalta(connection, 'comunicaciones_envios', 'reclamado_en DATETIME NULL AFTER enviado_en', 'reclamado_en');
  await agregarColumnaSiFalta(connection, 'comunicaciones_envios', 'proceso VARCHAR(16) NULL AFTER reclamado_en', 'proceso');

  // "Apoya a": a qué cargo(s) apoya esta persona — se guarda como una
  // lista en JSON (ej. ["alcaldia","concejo"]) porque alguien puede
  // apoyar a más de uno a la vez (son elecciones simultáneas).
  await agregarColumnaSiFalta(connection, 'usuarios', 'apoya_a JSON NULL AFTER tipo_cargo', 'apoya_a');
  await agregarColumnaSiFalta(connection, 'votantes', 'apoya_a JSON NULL', 'apoya_a');

  // "Datos verificados": casilla en el listado de Votantes y sublíderes que
  // solo Administrador y Asistente administrativo pueden marcar/desmarcar
  // (columna visible para todos, pero de solo lectura para los demás roles).
  await agregarColumnaSiFalta(connection, 'votantes', 'datos_verificados TINYINT(1) NOT NULL DEFAULT 0 AFTER consentimiento_metodo', 'datos_verificados');

  // Funciones del cargo — texto libre con las responsabilidades, mostrado
  // en la vista de detalle y en la impresión de cada cargo.
  await agregarColumnaSiFalta(connection, 'organigrama_nodos', 'funciones TEXT NULL AFTER nivel', 'funciones');

  await agregarColumnaSiFalta(connection, 'contenido_paginas', 'foto_url VARCHAR(255) NULL AFTER contenido', 'foto_url');
  await agregarColumnaSiFalta(connection, 'contenido_paginas', 'video_url VARCHAR(255) NULL AFTER foto_url', 'video_url');

  // meta_votos_base: "piso" manual, separado del total efectivo
  // (meta_votos) que ya puede incluir la suma de los gremiales de un
  // Coordinador Organizaciones. Solo la primera vez que se agrega la
  // columna, se copia el meta_votos que ya tenía cada quien como su
  // meta_votos_base inicial (para no perder lo que ya había, ni que a
  // todos les quede en 0 de golpe).
  const metaVotosBaseRecienCreada = await agregarColumnaSiFalta(
    connection, 'estructura',
    'meta_votos_base INT NOT NULL DEFAULT 0 AFTER meta_votos',
    'meta_votos_base'
  );
  if (metaVotosBaseRecienCreada) {
    await connection.query(`UPDATE estructura SET meta_votos_base = meta_votos`);
    console.log('meta_votos_base inicializada con el meta_votos que ya tenía cada quien.');
  }

  // "¿Utilizar nombre de comunas?" / "¿Utilizar nombre de barrios?": si el
  // admin responde "No" a cualquiera, el campo correspondiente (Comuna o
  // Barrio) deja de mostrarse en los formularios de creación de persona/
  // evento (Territorial, Votantes, app móvil, Eventos, Asistentes a
  // reuniones). Por defecto ambas son 1 (Sí) para no cambiar el
  // comportamiento de las instalaciones ya existentes.
  await agregarColumnaSiFalta(
    connection, 'configuracion_campana',
    'ciudad_tiene_comunas TINYINT(1) NOT NULL DEFAULT 1 AFTER territorio_ciudad',
    'ciudad_tiene_comunas'
  );
  await agregarColumnaSiFalta(
    connection, 'configuracion_campana',
    'usar_nombre_barrios TINYINT(1) NOT NULL DEFAULT 1 AFTER ciudad_tiene_comunas',
    'usar_nombre_barrios'
  );

  // El Área (Urbano/Rural) de una persona de la estructura.
  //
  // Hasta ahora no se guardaba: la tabla la DEDUCÍA del tipo de territorio
  // —barrio/comuna = Urbano, vereda/corregimiento = Rural—. Eso funciona
  // mientras la persona cuelgue de una de esas cuatro capas, pero en cuanto
  // cuelga del MUNICIPIO no hay nada de dónde deducirla y la columna sale
  // vacía. Medido el 15 de agosto de 2026 en la campaña departamental: 27 de
  // 75 personas con «—» en Área, todas asignadas a un municipio, porque
  // Quindío no tiene ni una comuna ni un corregimiento.
  //
  // `votantes` y `eventos` ya guardaban su propia columna `area`; esta le
  // pone a `estructura` la misma, con el mismo tipo y los mismos valores.
  await agregarColumnaSiFalta(
    connection, 'estructura',
    "area ENUM('urbano','rural') NULL AFTER territorio_id",
    'area'
  );

  // Los dos gemelos RURALES de las de arriba. La jerarquía tiene cuatro
  // niveles bajo el municipio y hasta hoy solo los dos urbanos se podían
  // apagar, así que una campaña de ciudad —sin un solo corregimiento— tenía
  // que dejar esos dos campos a la vista pidiendo un dato que no existe.
  //
  // Corregimiento va con Comuna y Vereda con Barrio: son el mismo nivel de
  // la jerarquía, lo urbano y lo rural conviven ahí y los distingue el
  // tipo, no la profundidad.
  //
  // Por defecto 1, como las urbanas: una instalación que ya existe no puede
  // notar el cambio hasta que alguien responda "No" a propósito.
  await agregarColumnaSiFalta(
    connection, 'configuracion_campana',
    'usar_nombre_corregimientos TINYINT(1) NOT NULL DEFAULT 1 AFTER usar_nombre_barrios',
    'usar_nombre_corregimientos'
  );
  await agregarColumnaSiFalta(
    connection, 'configuracion_campana',
    'usar_nombre_veredas TINYINT(1) NOT NULL DEFAULT 1 AFTER usar_nombre_corregimientos',
    'usar_nombre_veredas'
  );

  // "Apoyos": a qué otras campañas puede apoyar la gente que se registra.
  // El admin los activa en Datos de la campaña y elige cuáles aplican; esa
  // lista es la que aparece como "Apoya a" en los formularios de
  // Coordinadores/Líderes y de Votantes/Sublíderes.
  //
  // NULL (sin activar) es distinto de [] (activado sin marcar ninguno), y
  // por eso la columna admite nulos: en ambos casos la sección no se
  // muestra, pero conviene poder distinguir "nunca lo configuró" de "lo
  // configuró y lo dejó vacío" cuando alguien venga a revisar por qué no
  // le aparece.
  await agregarColumnaSiFalta(
    connection, 'configuracion_campana',
    'apoyos_activos JSON NULL AFTER usar_nombre_barrios',
    'apoyos_activos'
  );

  // Departamento y ciudad del evento. Antes solo se guardaba "lugar"
  // (texto libre) y el territorio, que se queda dentro del ámbito de la
  // campaña — pero un evento puede ser fuera de la ciudad sede (un foro
  // en otro municipio, un encuentro regional), y no había dónde anotarlo.
  await agregarColumnaSiFalta(connection, 'eventos', 'departamento VARCHAR(100) NULL AFTER lugar', 'departamento');
  await agregarColumnaSiFalta(connection, 'eventos', 'ciudad VARCHAR(100) NULL AFTER departamento', 'ciudad');

  // Votantes y sublíderes: "Nombres" y "Apellidos" (dos columnas) se
  // fusionan en un solo campo "nombre" — el formulario ahora pide un solo
  // campo "Nombres y apellidos". Se detecta si la columna "nombres" (la
  // vieja) todavía existe: si ya no está, esta migración ya se corrió antes
  // y no hay nada que hacer.
  const [[columnaNombresVotantes]] = await connection.query(
    `SELECT COUNT(*) AS existe FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'votantes' AND column_name = 'nombres'`
  );
  if (columnaNombresVotantes.existe > 0) {
    await agregarColumnaSiFalta(connection, 'votantes', 'nombre VARCHAR(300) NULL AFTER categoria', 'nombre');
    await connection.query(`UPDATE votantes SET nombre = TRIM(CONCAT(nombres, ' ', apellidos)) WHERE nombre IS NULL`);
    await connection.query(`ALTER TABLE votantes MODIFY nombre VARCHAR(300) NOT NULL`);
    try {
      await connection.query(`ALTER TABLE votantes DROP INDEX ft_votante_nombre`);
    } catch (err) {
      if (err.code !== 'ER_CANT_DROP_FIELD_OR_KEY') throw err;
    }
    await connection.query(`ALTER TABLE votantes DROP COLUMN nombres, DROP COLUMN apellidos`);
    await connection.query(`ALTER TABLE votantes ADD FULLTEXT INDEX ft_votante_nombre (nombre)`);
    console.log('Votantes: columnas nombres/apellidos fusionadas en un solo campo "nombre".');
  }

  // --- Enlace con el Catálogo Territorial de Colombia (territoriosdb) ---
  // Estas tres se habían creado a mano directamente en la base de la
  // instalación original, así que no estaban en ningún archivo del repo.
  // Sin ellas, routes/catalogo.routes.js falla con "columna desconocida"
  // en cualquier instalación nueva. Quedan aquí para que una campaña nueva
  // (o las ya existentes) las obtengan corriendo este mismo script.
  await agregarColumnaSiFalta(
    connection, 'dia_d_puestos_votacion',
    'ctc_puesto_id INT NULL AFTER cantidad_mesas',
    'ctc_puesto_id'
  );
  // Único: un puesto del catálogo no se puede sembrar dos veces en la misma
  // campaña. Es lo que hace repetible la carga masiva por municipio
  // (INSERT IGNORE) sin duplicar filas.
  try {
    await connection.query(
      `ALTER TABLE dia_d_puestos_votacion ADD UNIQUE INDEX uq_dia_d_puestos_ctc (ctc_puesto_id)`
    );
    console.log('Índice único uq_dia_d_puestos_ctc creado.');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
    console.log('El índice uq_dia_d_puestos_ctc ya existía. Sin cambios.');
  }

  // --- El id del puesto del CATÁLOGO en la ficha de cada persona ---
  //
  // Es el arreglo de fondo del "Lugar de votación". Hasta ahora el enlace se
  // DEDUCÍA comparando el texto que la persona eligió contra el nombre del
  // puesto sembrado en la campaña, y por eso se rompía cada vez que ese
  // nombre no era idéntico: con el municipio pegado para desambiguar
  // homónimos, o recortado a 32 caracteres por la fuente de origen.
  //
  // Guardando el id del catálogo, el enlace deja de deducirse. Se resuelve
  // UNA vez al guardar la ficha (routes/votantes.routes.js) y a partir de ahí
  // la regla 0 del disparador lo usa directo. Renombrar un puesto ya no
  // desconecta a nadie.
  //
  // BIGINT UNSIGNED para que case con ctc_puestos_votacion.id del catálogo y
  // con dia_d_puestos_votacion.ctc_puesto_id — medidos los tres, son iguales.
  // Un INT aquí obligaría a MySQL a convertir en cada cruce.
  //
  // Sin llave foránea a propósito: apunta a OTRA base de datos, y MySQL no
  // admite foráneas entre bases (es la misma razón por la que la migración al
  // catálogo soltó las que había).
  for (const tabla of ['votantes', 'usuarios']) {
    // `puesto_id` es el ancla del AFTER de abajo, y su definición «oficial» está
    // más adelante en este archivo. En una base VACÍA votantes todavía no la
    // tiene aquí (schema.sql solo la crea en usuarios) y el ALTER moría con
    // ER_BAD_FIELD_ERROR. Se asegura antes; la de abajo queda como no-op. En
    // una base que ya la tiene, esto tampoco cambia nada.
    await agregarColumnaSiFalta(
      connection, tabla, 'puesto_id INT NULL AFTER puesto_votacion', 'puesto_id'
    );
    await agregarColumnaSiFalta(
      connection, tabla,
      'ctc_puesto_id BIGINT UNSIGNED NULL AFTER puesto_id',
      'ctc_puesto_id'
    );
  }

  // --- Cuándo se le enviaron sus credenciales a cada persona del equipo ---
  //
  // Es una FECHA y no un sí/no: además de marcar la casilla, deja saber
  // cuándo se mandó, que es lo que hace falta cuando alguien dice que nunca
  // le llegó.
  //
  // Se pone en NULL al restablecer la contraseña: a partir de ese momento lo
  // que la persona tenga guardado ya no sirve, y la casilla vuelve a estar en
  // blanco para que se vea de un vistazo a quién falta volver a escribirle.
  //
  // OJO CON LO QUE SIGNIFICA: marca que el mensaje se ABRIÓ para enviarlo, no
  // que la persona lo haya recibido ni leído. WhatsApp se abre en otra
  // ventana y no hay forma de saber desde aquí si el envío se completó.
  await agregarColumnaSiFalta(
    connection, 'usuarios',
    'credenciales_enviadas DATETIME NULL AFTER telefono',
    'credenciales_enviadas'
  );

  // --- Hasta cuándo sirve la contraseña temporal ---
  //
  // El código que se le manda a alguien para que entre la primera vez no
  // caducaba: seguía sirviendo semanas después, y desde el parche 91 es de
  // cuatro dígitos. Con el bloqueo actual —5 intentos cada 15 minutos— caben
  // 480 intentos al día contra una cuenta: en 30 días eso es un 76% de
  // probabilidad de acertarlo. Con 48 horas de vigencia baja a menos del 10%.
  //
  // NULL significa «sin caducidad», que es lo correcto para todas las
  // contraseñas que ya existen y para las que el propio usuario elige. Solo
  // se llena al generar un código temporal.
  await agregarColumnaSiFalta(
    connection, 'usuarios',
    'password_temporal_expira DATETIME NULL AFTER debe_cambiar_password',
    'password_temporal_expira'
  );

  // --- La marca que se ve en la barra lateral ---
  //
  // El logo, el nombre y la bajada estaban escritos DENTRO de common.js, así
  // que cambiarlos exigía tocar código y un parche. Para una plataforma que se
  // licencia a varias campañas eso no sirve: cada una quiere la suya, y quien
  // la administra no debería depender de nadie para cambiarla.
  //
  // Se guardan VACIAS a propósito. Vacío significa «use lo de siempre», que es
  // lo que ya está en el código: así ninguna instalación existente cambia de
  // aspecto al recibir esta migración, y solo cambia la que decida escribir
  // algo. Un valor por defecto aquí habría reescrito la marca de todas.
  /* LA META DE VOTOS DE LA CAMPAÑA, declarada y no calculada.
     El panel venía mostrando como meta la SUMA de las metas de sus líderes
     (`meta_votos_lideres`), que es otra cosa: eso es lo que el equipo se
     comprometió a traer, no lo que la campaña necesita para ganar. Los dos
     números son útiles y no tienen por qué coincidir.

     Entra NULL y no 0 a propósito, y no es lo mismo: cero es una meta de cero
     votos, escrita por alguien; NULL es que todavía no la ha fijado nadie.
     Con un valor por defecto, todas las campañas existentes aparecerían de
     golpe con una meta que nunca declararon. */
  await agregarColumnaSiFalta(
    connection, 'configuracion_campana',
    "meta_votos_campana INT UNSIGNED NULL COMMENT 'Meta de votos que se fija la campana. NULL = sin declarar, distinto de cero'",
    'meta_votos_campana'
  );
  await agregarColumnaSiFalta(
    connection, 'configuracion_campana',
    "marca_titulo VARCHAR(120) NULL COMMENT 'Nombre en la barra lateral. Vacio = el del codigo'",
    'marca_titulo'
  );
  await agregarColumnaSiFalta(
    connection, 'configuracion_campana',
    "marca_subtitulo VARCHAR(160) NULL COMMENT 'Bajada bajo el nombre. Vacio = la del codigo'",
    'marca_subtitulo'
  );
  await agregarColumnaSiFalta(
    connection, 'configuracion_campana',
    "marca_logo_url VARCHAR(255) NULL COMMENT 'Logo propio subido por la campana. Vacio = /img/logo.png'",
    'marca_logo_url'
  );

  // usuarios.puesto_id: el id del puesto de votación, derivado del texto
  // libre de usuarios.puesto_votacion. Existe para que los cruces del Día D
  // se hagan por id y no comparando dos textos carácter por carácter.
  await agregarColumnaSiFalta(connection, 'usuarios', 'puesto_id INT NULL AFTER puesto_votacion', 'puesto_id');

  // votantes.puesto_id: lo mismo para el lugar donde vota un votante.
  //
  // **Se admite NULL a propósito, y es lo normal.** Dónde vota una persona
  // no tiene por qué ser un puesto que la campaña cubra: alguien registrado
  // en Manizales puede votar en Neiva. Con el puesto dentro del ámbito, el
  // id queda lleno y el estimado por puesto cruza por id; fuera del ámbito
  // queda NULL y solo sobrevive el texto, que es todo lo que se sabe. Esos
  // no cuentan para la cobertura por puesto de ninguna manera.
  await agregarColumnaSiFalta(connection, 'votantes', 'puesto_id INT NULL AFTER puesto_votacion', 'puesto_id');
  await crearTriggersPuestoId(connection);

  // usuarios.nombre_usuario: el identificador con el que se inicia sesión
  // (routes/auth.routes.js lo consulta junto con el email). Igual que las
  // columnas ctc_* de arriba, existía solo porque se creó a mano en la
  // base original: una instalación nueva no la obtenía y el login entero
  // respondía 500 con "columna desconocida" (hallazgo A1 de AUDITORIA.md).
  await agregarColumnaSiFalta(
    connection, 'usuarios',
    'nombre_usuario VARCHAR(60) NULL AFTER numero_identificacion',
    'nombre_usuario'
  );
  // Único, y el índice se llama exactamente `nombre_usuario`:
  // config/erroresUsuarios.js identifica el campo duplicado por el NOMBRE
  // del índice que MySQL reporta en el ER_DUP_ENTRY, y el login usa
  // LIMIT 1 — con duplicados, la segunda cuenta con el mismo nombre de
  // usuario nunca podría entrar y nada avisaría. NULL sí puede repetirse
  // (quien no tiene nombre de usuario entra por email); la cadena vacía
  // no llega nunca: todas las rutas normalizan '' a NULL antes de escribir.
  try {
    await connection.query(`ALTER TABLE usuarios ADD UNIQUE INDEX nombre_usuario (nombre_usuario)`);
    console.log('Índice único nombre_usuario creado en usuarios.');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
    console.log('El índice nombre_usuario ya existía en usuarios. Sin cambios.');
  }

  // ------------------------------------------------------------------
  // CRM: baja de contacto, respuestas entrantes, programación y plantillas
  // ------------------------------------------------------------------
  //
  // LA BAJA NO ES UNA COMODIDAD, ES LA OTRA MITAD DEL CONSENTIMIENTO.
  //   La app pide autorización al registrar a una persona (Ley 1581 de
  //   2012). Ese consentimiento es revocable, y hasta ahora no había forma
  //   de revocarlo: quien respondía «BAJA» a un SMS seguía recibiendo
  //   mensajes. Pedir la autorización y no honrar su retiro es peor que no
  //   haberla pedido nunca.
  //
  //   Se marca la persona, no el número: un teléfono puede estar en varias
  //   fichas (en una familia se comparte), y la baja la pide una persona.
  //   Por eso el webhook busca por teléfono pero marca cada ficha que
  //   coincida, y lo deja anotado en `comunicaciones_respuestas`.
  for (const tabla of ['votantes', 'usuarios']) {
    await agregarColumnaSiFalta(connection, tabla,
      'no_contactar TINYINT(1) NOT NULL DEFAULT 0', 'no_contactar');
    await agregarColumnaSiFalta(connection, tabla,
      'no_contactar_fecha DATETIME NULL AFTER no_contactar', 'no_contactar_fecha');
    // De dónde salió la baja: `sms`, `whatsapp`, `correo` o `manual`. Sirve
    // para demostrar ante una queja CÓMO se pidió, no solo que se pidió.
    await agregarColumnaSiFalta(connection, tabla,
      'no_contactar_origen VARCHAR(20) NULL AFTER no_contactar_fecha', 'no_contactar_origen');
    // La baja anotada A MANO (origen `manual`): por qué canal la pidió la persona
    // (SMS respondido, llamada, en persona…) y el motivo que escribió quien la
    // registró. Es VARCHAR y no ENUM, como el origen: agregar un canal no exige
    // tocar la base. Quedan NULL en las bajas por enlace o por respuesta.
    await agregarColumnaSiFalta(connection, tabla,
      'no_contactar_canal VARCHAR(20) NULL AFTER no_contactar_origen', 'no_contactar_canal');
    await agregarColumnaSiFalta(connection, tabla,
      'no_contactar_motivo VARCHAR(255) NULL AFTER no_contactar_canal', 'no_contactar_motivo');
  }

  // Respuestas entrantes. Hasta ahora Twilio solo avisaba el ESTADO de lo
  // que salía; lo que la gente contestaba no llegaba a ninguna parte.
  await connection.query(`
    CREATE TABLE IF NOT EXISTS comunicaciones_respuestas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      canal ENUM('sms','whatsapp') NOT NULL,
      de_contacto VARCHAR(40) NOT NULL,
      mensaje TEXT,
      -- A quién se le pudo atribuir. Puede quedar en NULL: un número
      -- desconocido también escribe, y esa respuesta no se descarta.
      votante_id INT NULL,
      usuario_id INT NULL,
      nombre_resuelto VARCHAR(150) NULL,
      -- 'baja' si el texto pedía darse de baja; 'ninguna' si es un mensaje
      -- normal que alguien tendrá que leer.
      accion ENUM('ninguna','baja') NOT NULL DEFAULT 'ninguna',
      leida TINYINT(1) NOT NULL DEFAULT 0,
      twilio_sid VARCHAR(60) NULL,
      recibido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_resp_recibido (recibido_en),
      INDEX idx_resp_leida (leida),
      INDEX idx_resp_votante (votante_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  console.log('Tabla comunicaciones_respuestas lista.');

  // Programación de envíos. La cola reanudable ya existía; solo faltaba
  // decir "sale a tal hora" en vez de "sale ya".
  await agregarColumnaSiFalta(connection, 'comunicaciones_campanas',
    'programado_para DATETIME NULL', 'programado_para');
  try {
    await connection.query(`ALTER TABLE comunicaciones_campanas ADD INDEX idx_camp_programado (programado_para)`);
    console.log('Índice idx_camp_programado creado.');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
  }

  // Plantillas reutilizables.
  await connection.query(`
    CREATE TABLE IF NOT EXISTS comunicaciones_plantillas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(120) NOT NULL,
      canal ENUM('sms','whatsapp','email','push','cualquiera') NOT NULL DEFAULT 'cualquiera',
      asunto VARCHAR(200) NULL,
      cuerpo TEXT NOT NULL,
      creado_por INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_plantilla_nombre (nombre)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // El CREATE de arriba solo actúa la primera vez, así que en una base que
  // ya existía el ENUM se queda como estaba: hay que ampliarlo aparte para
  // que acepte 'push'. Sin esto, guardar una plantilla de ese canal falla
  // con "Data truncated for column 'canal'".
  await modificarColumna(
    connection, 'comunicaciones_plantillas',
    `canal ENUM('sms','whatsapp','email','push','cualquiera') NOT NULL DEFAULT 'cualquiera'`
  );
  console.log('Tabla comunicaciones_plantillas lista.');

  // Plantillas de arranque.
  //
  // LAS DE SMS VAN SIN TILDES, Y NO ES DESCUIDO.
  //   Una sola tilde saca el mensaje del alfabeto GSM-7 y el segmento baja
  //   de 160 a 70 caracteres: el mismo texto pasa de 1 SMS a 3, y se
  //   facturan tres. Escritas sin tildes caben en uno solo. Quien prefiera
  //   escribirlas con tildes puede editarlas — el contador de la pantalla
  //   le dirá al instante cuánto cuesta esa decisión.
  //
  //   Las de correo SÍ llevan tildes: ahí no hay segmentos que pagar.
  //
  // LAS DE PRIMER CONTACTO DICEN COMO DARSE DE BAJA.
  //   Es lo que hace utilizable el canal de respuestas (Ley 1581 de 2012):
  //   si no se le dice a la persona que puede responder BAJA, el derecho
  //   existe pero nadie sabe ejercerlo.
  //
  // `INSERT IGNORE` sobre el nombre: si alguien las edita, una migración
  // posterior NO le pisa el texto.
  //
  // LOS NOMBRES TIENEN QUE DISTINGUIRSE POR ALGO QUE NO SEA UNA TILDE.
  //   La columna es utf8mb4_0900_ai_ci, que ignora los acentos: para MySQL
  //   «Invitacion a evento» y «Invitación a evento» son la MISMA cadena, y
  //   el INSERT IGNORE descarta la segunda sin decir nada. Pasó: de las 10
  //   de abajo solo entraban 9, y el hueco solo se veía contando los id.
  //   Por eso la de correo dice «(correo)». Al agregar una plantilla nueva,
  //   comprobar que su nombre no sea igual a otro salvo por las tildes.
  const plantillasBase = [
    ['Bienvenida (primer contacto)', 'sms', null,
     'Hola {nombre}, le saluda la campana de {slogan}. Gracias por acompanarnos. Para no recibir mas: {baja}'],
    ['Dia D - donde vota', 'sms', null,
     'Hola {nombre}, este domingo vota en {puesto}, mesa {mesa} ({municipio}). Lleve su cedula. Su voto cuenta.'],
    ['Recordatorio vispera', 'sms', null,
     'Hola {nombre}, manana son las elecciones. Su puesto: {puesto}, mesa {mesa}. Las urnas abren a las 8 am.'],
    ['Invitacion a evento', 'sms', null,
     'Hola {nombre}, lo invitamos a nuestro encuentro. Lo esperamos. Para no recibir mas: {baja}'],
    // Aviso al testigo desde Cobertura de testigos. Sin tildes (SMS); con la firma del operador y un puesto
    // corto cabe en 1 segmento, con un puesto largo pasa a 2: ver la nota de ESTADO.md.
    ['Testigo - aviso de asignacion', 'sms', null,
     '{primer_nombre}, testigo en {puesto_testigo}, mesa {mesas_testigo}. {enlace_app}'],
    ['Convocatoria a testigos', 'sms', null,
     'Hola {nombre}, usted es testigo en {puesto}, mesa {mesa}. Presentese a las 7 am con su cedula y credencial.'],
    ['Agradecimiento post jornada', 'sms', null,
     'Hola {nombre}, gracias por votar y por acompanarnos en esta jornada. Seguimos trabajando por {municipio}.'],

    // --- WhatsApp -------------------------------------------------------
    //
    // Se escriben con tildes y signos completos a proposito: por WhatsApp no
    // hay GSM-7 que valga, no se cobra por segmento y una tilde no encarece
    // nada — al reves que en SMS, donde una sola baja el limite de 160 a 70.
    //
    // Solo usan los cuatro marcadores que el asistente sabe reemplazar:
    // {nombre}, {primer_nombre}, {candidato} y {slogan}. Meter {puesto} o
    // {mesa} aqui dejaria el marcador crudo en el mensaje, porque el
    // asistente de WhatsApp no consulta el lugar de votacion de nadie.
    //
    // Lo que va entre corchetes lo completa quien escribe: dia, hora y lugar
    // cambian en cada convocatoria y no hay dato en la base que los llene.
    ['WhatsApp · Invitación a reunión', 'whatsapp', null,
     'Hola {primer_nombre}, le escribe el equipo de {candidato}. Lo invitamos a nuestra reunión el [día] a las [hora] en [lugar]. Nos importa que esté. {slogan}'],
    ['WhatsApp · Recordatorio del mismo día', 'whatsapp', null,
     '{primer_nombre}, le recordamos que hoy nos encontramos a las [hora] en [lugar]. Lo esperamos. — Equipo de {candidato}'],
    ['WhatsApp · Primer contacto', 'whatsapp', null,
     'Hola {nombre}, le habla el equipo de {candidato}. Nos gustaría contarle nuestras propuestas y, sobre todo, escuchar las suyas. ¿Tiene unos minutos esta semana?'],
    ['WhatsApp · Convocatoria a testigos', 'whatsapp', null,
     'Hola {primer_nombre}, la campaña de {candidato} lo necesita como testigo electoral. La capacitación es el [día] a las [hora] en [lugar]. ¿Contamos con usted?'],
    ['WhatsApp · Víspera de la jornada', 'whatsapp', null,
     '{primer_nombre}, mañana son las elecciones. Lleve su cédula y vote temprano. Gracias por acompañar a {candidato}. {slogan}'],
    ['WhatsApp · Agradecimiento post jornada', 'whatsapp', null,
     '{primer_nombre}, gracias por su apoyo en esta jornada. Cada voto fue trabajo de gente como usted. — {candidato}'],

    ['Bienvenida al equipo', 'email', 'Bienvenido a la campaña',
     'Hola {nombre},\n\nGracias por sumarse a nuestra campaña. Desde hoy hace parte del equipo que está construyendo esto en {municipio}.\n\nEn los próximos días le estaremos compartiendo información sobre encuentros y actividades.\n\n{slogan}\n\n---\nSi no desea seguir recibiendo estos correos, use el enlace para darse de baja que aparece al pie de este mensaje.'],
    ['Invitación a evento (correo)', 'email', 'Lo esperamos en nuestro próximo encuentro',
     'Hola {nombre},\n\nQueremos invitarlo a nuestro próximo encuentro. Su presencia es importante para nosotros.\n\nFecha: (completar)\nHora: (completar)\nLugar: (completar)\n\nConfirme su asistencia respondiendo este correo.\n\n{slogan}'],
    ['Su lugar de votación', 'email', 'Este es su lugar de votación',
     'Hola {nombre},\n\nEste domingo usted vota en:\n\nPuesto: {puesto}\nMesa: {mesa}\nMunicipio: {municipio}, {departamento}\n\nRecuerde llevar su cédula original. Las urnas abren a las 8:00 a.m. y cierran a las 4:00 p.m.\n\n{slogan}'],
    ['Agradecimiento', 'email', 'Gracias por acompañarnos',
     'Hola {nombre},\n\nGracias por su apoyo y por el tiempo que le dedicó a esta causa. Nada de lo que logramos habría sido posible sin personas como usted.\n\n{slogan}'],
  ];
  for (const [nombre, canal, asunto, cuerpo] of plantillasBase) {
    await connection.query(
      `INSERT IGNORE INTO comunicaciones_plantillas (nombre, canal, asunto, cuerpo) VALUES (?, ?, ?, ?)`,
      [nombre, canal, asunto, cuerpo]);
  }
  console.log(`Plantillas de arranque: ${plantillasBase.length} revisadas.`);

  // ------------------------------------------------------------------
  // Notificaciones push: dónde vive cada dispositivo suscrito
  // ------------------------------------------------------------------
  //
  // Cuando un teléfono acepta recibir avisos, el navegador entrega tres
  // datos: una URL (el "endpoint", que identifica a ese dispositivo ante
  // el servicio de su fabricante) y dos claves con las que se cifra el
  // contenido. Sin los tres no se puede enviar nada.
  //
  // LA LLAVE ES EL ENDPOINT, NO LA PERSONA.
  //   Una misma persona puede tener el celular y el computador, y cada uno
  //   es una suscripción distinta. Y un mismo teléfono puede cambiar de
  //   dueño (en una campaña se prestan), por eso también se guarda a quién
  //   pertenece: al cambiar de cuenta, la suscripción se reasigna en vez de
  //   duplicarse.
  //
  // SE BORRAN SOLAS CUANDO CADUCAN.
  //   Los servicios de push responden 404 o 410 cuando un dispositivo ya no
  //   existe (la persona desinstaló, limpió los datos, cambió de teléfono).
  //   Esa respuesta es la señal para eliminar la fila: si no, la tabla se
  //   llena de direcciones muertas y cada envío gasta tiempo en ellas.
  await connection.query(`
    CREATE TABLE IF NOT EXISTS push_suscripciones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT NOT NULL,
      endpoint VARCHAR(500) NOT NULL,
      p256dh VARCHAR(200) NOT NULL,
      auth VARCHAR(100) NOT NULL,
      dispositivo VARCHAR(150) NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ultimo_envio DATETIME NULL,
      UNIQUE KEY uq_push_endpoint (endpoint(255)),
      INDEX idx_push_usuario (usuario_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  console.log('Tabla push_suscripciones lista.');

  // --- Día D: el reporte guarda el id Y el texto del puesto ---
  //
  // ATENCIÓN AL LEER ESTO DENTRO DE SEIS MESES: en `dia_d_reportes`,
  // `puesto_votacion` es una INSTANTÁNEA HISTÓRICA, no una llave.
  //
  // Un reporte dice dónde estuvo un testigo a una hora determinada. Si
  // después alguien renombra ese puesto en la lista de la campaña, el
  // reporte NO puede cambiar de lugar retroactivamente: por eso se guarda
  // el texto tal como estaba ese día. Para agrupar, contar o cruzar
  // reportes, **siempre `puesto_id`**. Cruzar por el texto es exactamente
  // el problema que esta migración vino a quitar, y volver a hacerlo lo
  // reintroduce sin que nada avise.
  await agregarColumnaSiFalta(connection, 'dia_d_reportes', 'puesto_id INT NULL AFTER puesto_votacion', 'puesto_id');
  try {
    await connection.query(`ALTER TABLE dia_d_reportes ADD INDEX idx_dia_d_reportes_puesto (puesto_id)`);
    console.log('Índice idx_dia_d_reportes_puesto creado.');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
    console.log('El índice idx_dia_d_reportes_puesto ya existía. Sin cambios.');
  }

  // Salida de emergencia del Día D: si el puesto donde de verdad está el
  // testigo no aparece en la lista sembrada, puede escribirlo a mano y el
  // reporte queda marcado para que alguien lo revise. Sin esto, un testigo
  // en un puesto que la siembra omitió no podría reportar — y ese día no
  // hay a quién llamar. La columna va aquí; el botón, en el parche del
  // cliente.
  await agregarColumnaSiFalta(
    connection, 'dia_d_reportes',
    'puesto_fuera_de_lista TINYINT(1) NOT NULL DEFAULT 0 AFTER puesto_id',
    'puesto_fuera_de_lista'
  );

  // --- Día D: alertas de coherencia que pone el servidor ---
  //
  // El servidor anota —no rechaza— lo que un E-14 mal sumado o un reporte
  // dudoso tiene de raro: suma de votos distinta del total de votantes, mesa
  // fuera de lista, reporte enviado por la coordinación en lugar del testigo.
  // Rechazar esos casos escondería justo lo que la campaña necesita ver para
  // reclamar. NULL = sin alertas.
  await agregarColumnaSiFalta(
    connection, 'dia_d_reportes',
    'alertas TEXT NULL',
    'alertas'
  );

  // --- Día D: índices sobre la URL de las fotos ---
  //
  // El filtro de /uploads (app.js) pregunta, por cada archivo suelto de la
  // raíz que alguien intenta abrir, si ese archivo es de un reporte del Día D.
  // Sin estos índices cada apertura recorrería las dos tablas enteras.
  // 255 caracteres × 4 bytes caben de sobra en el límite de 3072 de InnoDB.
  for (const [tabla, columna, indice] of [
    ['dia_d_reportes', 'foto_e14_url', 'idx_diad_foto_url'],
    ['dia_d_reporte_documentos', 'url', 'idx_doc_url'],
  ]) {
    try {
      await connection.query(`ALTER TABLE ${tabla} ADD INDEX ${indice} (${columna})`);
      console.log(`Índice ${indice} creado.`);
    } catch (err) {
      if (err.code !== 'ER_DUP_KEYNAME') throw err;
      console.log(`El índice ${indice} ya existía. Sin cambios.`);
    }
  }

  // --- Día D fase 2: «ya votó» ---
  //
  // Las dos tablas las crea db/schema.sql (CREATE TABLE IF NOT EXISTS, al
  // principio de cada corrida). Aquí solo se COMPRUEBA que existan y se dice si ya
  // estaban, según lo que había ANTES de aplicar el esquema (ver `tablasVotoQueExistian`).
  for (const tabla of ['votante_votos', 'votante_voto_tokens',
                       'dia_d_resultado_oficial', 'dia_d_mesa_revision', 'dia_d_paquetes',
                       'dia_d_suplentes_testigo', 'dia_d_checkin', 'dia_d_alertas_atendidas',
                       'dia_d_alertas_avisadas']) {
    const [[t]] = await connection.query(
      `SELECT 1 AS x FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [tabla]);
    if (!t) throw new Error(`Falta la tabla ${tabla}: db/schema.sql debía crearla en esta misma corrida.`);
    console.log(tablasVotoQueExistian.has(tabla)
      ? `La tabla ${tabla} ya existía. Sin cambios.`
      : `Tabla ${tabla} creada.`);
  }

  // --- Cobertura de testigos: cuántas mesas puede cubrir un mismo testigo ---
  // Pasarlo NO bloquea nada: la pantalla de cobertura avisa (un testigo con diez mesas no vigila ninguna).
  // 3 de fábrica; se cambia en Configuración → Día D → Puestos de votación.
  await agregarColumnaSiFalta(connection, 'configuracion_campana',
    'max_mesas_por_testigo TINYINT UNSIGNED NOT NULL DEFAULT 3', 'max_mesas_por_testigo');

  // --- Día D fase 4: la jornada (horarios y umbrales de las alertas) ---
  // Todo es de la campaña y se edita en Configuración → Datos de la campaña, junto a la fecha de elección. Hora de
  // Colombia. Los valores por omisión son los de una jornada corriente: urnas de 8:00 a 16:00.
  for (const [definicion, nombre] of [
    ["jornada_apertura TIME NOT NULL DEFAULT '08:00:00'", 'jornada_apertura'],
    ["jornada_cierre TIME NOT NULL DEFAULT '16:00:00'", 'jornada_cierre'],
    ['plazo_e14_min INT NOT NULL DEFAULT 120', 'plazo_e14_min'],
    ['alerta_checkin_min INT NOT NULL DEFAULT 30', 'alerta_checkin_min'],
    ['baja_votacion_pct INT NOT NULL DEFAULT 40', 'baja_votacion_pct'],
    ["baja_votacion_desde TIME NOT NULL DEFAULT '12:00:00'", 'baja_votacion_desde'],
    // El interruptor de los avisos push automáticos de las alertas (orden 20). Encendido por omisión.
    ['avisos_alertas_push TINYINT NOT NULL DEFAULT 1', 'avisos_alertas_push'],
  ]) {
    await agregarColumnaSiFalta(connection, 'configuracion_campana', definicion, nombre);
  }
  // Quien necesita que lo lleven a votar. NULL = no se sabe; 1 = sí; 0 = no.
  await agregarColumnaSiFalta(connection, 'votantes',
    'necesita_transporte TINYINT NULL COMMENT "1 = necesita transporte el dia de la eleccion; NULL = no se sabe"', 'necesita_transporte');

  /* --- Día D: TRANSPORTE, parte 1 (orden 33) ---
     Vehículos, conductores y a quién recoge cada uno. TODAS con `aspirante_id` como dueño, igual que
     `dia_d_puestos_votacion` (0 = la campaña madre). La demanda sigue siendo `votantes.necesita_transporte`;
     aquí está lo que se hace con ella. «Llevado al puesto» NO es «ya votó»: no toca `votante_votos`.
     Idempotente: CREATE TABLE IF NOT EXISTS, y la hora de la alerta con agregarColumnaSiFalta. */
  await connection.query(`
    CREATE TABLE IF NOT EXISTS transporte_vehiculos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      aspirante_id INT NOT NULL DEFAULT 0,
      placa VARCHAR(12) NOT NULL,
      tipo ENUM('carro','camioneta','van','bus','moto','otro') NOT NULL DEFAULT 'carro',
      capacidad INT NOT NULL DEFAULT 4 COMMENT 'Personas que caben: la suma de «personas» de sus paradas se compara con esto (solo avisa)',
      descripcion VARCHAR(150) NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_transp_veh_placa (aspirante_id, placa)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS transporte_conductores (
      id INT AUTO_INCREMENT PRIMARY KEY,
      aspirante_id INT NOT NULL DEFAULT 0,
      nombre VARCHAR(120) NOT NULL,
      celular VARCHAR(20) NULL,
      vehiculo_id INT NULL,
      codigo CHAR(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'Entra a /t/<codigo> sin cuenta. Mismo alfabeto que /i (sin 0/O/1/I/L); en claro, rotable y revocable',
      activo TINYINT(1) NOT NULL DEFAULT 1,
      usuario_id INT NULL COMMENT 'Opcional: si el conductor además tiene cuenta',
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      rotado_en DATETIME NULL,
      UNIQUE KEY uq_transp_cond_codigo (codigo),
      KEY idx_transp_cond_dueno (aspirante_id, activo),
      FOREIGN KEY (vehiculo_id) REFERENCES transporte_vehiculos(id) ON DELETE SET NULL,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS transporte_asignaciones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      aspirante_id INT NOT NULL DEFAULT 0,
      votante_id INT NOT NULL,
      conductor_id INT NOT NULL,
      fecha DATE NOT NULL COMMENT 'El día de la elección al que corresponde la recogida',
      orden INT NOT NULL DEFAULT 0 COMMENT 'Posición de la parada en la lista del conductor',
      personas INT NOT NULL DEFAULT 1 COMMENT 'Cuántas personas recoge en esta parada (la persona y quienes van con ella)',
      nota VARCHAR(255) NULL,
      estado ENUM('asignado','recogido','en_puesto','no_estaba','cancelado') NOT NULL DEFAULT 'asignado',
      recogido_en DATETIME NULL,
      llevado_en DATETIME NULL,
      latitud DECIMAL(10,7) NULL COMMENT 'Donde estaba el teléfono del conductor al tocar (opcional; la última marca)',
      longitud DECIMAL(10,7) NULL,
      cliente_uuid VARCHAR(64) NULL COMMENT 'La última marca aplicada: un reintento con el mismo uuid no cambia nada',
      asignado_por INT NULL,
      asignado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_transp_asig_votante_fecha (votante_id, fecha),
      KEY idx_transp_asig_conductor (conductor_id, fecha, orden),
      KEY idx_transp_asig_dueno (aspirante_id, fecha, estado),
      FOREIGN KEY (votante_id) REFERENCES votantes(id) ON DELETE CASCADE,
      FOREIGN KEY (conductor_id) REFERENCES transporte_conductores(id) ON DELETE CASCADE,
      FOREIGN KEY (asignado_por) REFERENCES usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  // La hora desde la que «transporte sin recoger» es una alerta (la usa lib/alertasDiaD.js desde la orden 35).
  await agregarColumnaSiFalta(connection, 'configuracion_campana',
    "transporte_alerta_desde TIME NOT NULL DEFAULT '14:00:00'", 'transporte_alerta_desde');
  // Orden 35: «Voy en camino» le manda UN SMS al votante. Esta marca es lo que impide mandarlo dos veces (se reclama con
  // un UPDATE ... WHERE aviso_enviado_en IS NULL antes de enviar).
  await agregarColumnaSiFalta(connection, 'transporte_asignaciones',
    "aviso_enviado_en DATETIME NULL COMMENT 'Cuándo se le mandó al votante el SMS «tu transporte va en camino» (una sola vez por parada)'",
    'aviso_enviado_en');
  // Orden 35: la firma que el proveedor pega a cada SMS medía hasta 40 caracteres, y la de una campaña real mide ~50
  // («Estrategia Marketing Politico - Campaña municipal»). Se ensancha; MODIFY no toca el contenido.
  try {
    await connection.query(
      `ALTER TABLE sms_config MODIFY COLUMN firma VARCHAR(80) NULL
         COMMENT 'La firma que el proveedor agrega a cada mensaje por exigencia de la CRC. NO la escribe esta aplicacion: se guarda para poder CONTAR lo que ocupa, porque le resta caracteres al segmento'`);
    console.log('Columna sms_config.firma a VARCHAR(80).');
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
  }
  console.log('Tablas del transporte del Día D listas.');

  // --- Logística del día D (orden 39): refrigerios, almuerzos, kits ---
  // `aspirante_id` es el dueño (0 = la campaña madre), como en el resto del Día D. Los ítems no se borran (una entrega apunta a
  // su ítem): se desactivan. `logistica_plan` guarda SÓLO lo que alguien corrigió a mano; sin fila, la cantidad es la sugerida
  // (los testigos del puesto). La clave única de `logistica_entregas` es lo que impide entregar dos veces lo mismo a la misma
  // persona el mismo día —el doble toque, o el reintento de la cola sin señal—.
  await connection.query(`
    CREATE TABLE IF NOT EXISTS logistica_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      aspirante_id INT NOT NULL DEFAULT 0,
      nombre VARCHAR(80) NOT NULL,
      destinatario ENUM('testigos','conductores') NOT NULL DEFAULT 'testigos',
      hora_limite TIME NULL COMMENT 'Hasta cuándo debe estar entregado; desde ahí cuenta la alerta «sin entregar»',
      incluir_suplentes TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Si el sugerido del plan suma también a los suplentes del puesto',
      activo TINYINT(1) NOT NULL DEFAULT 1,
      orden INT NOT NULL DEFAULT 0,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_logi_item (aspirante_id, nombre)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS logistica_plan (
      id INT AUTO_INCREMENT PRIMARY KEY,
      aspirante_id INT NOT NULL DEFAULT 0,
      item_id INT NOT NULL,
      puesto_id INT NOT NULL,
      cantidad INT NOT NULL COMMENT 'Corrección a mano de la cantidad sugerida; sin fila, manda la sugerida',
      actualizado_por INT NULL,
      actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_logi_plan (item_id, puesto_id),
      FOREIGN KEY (item_id) REFERENCES logistica_items(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS logistica_entregas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      aspirante_id INT NOT NULL DEFAULT 0,
      item_id INT NOT NULL,
      puesto_id INT NOT NULL,
      receptor_usuario_id INT NOT NULL COMMENT 'El testigo que recibió',
      fecha DATE NOT NULL,
      estado ENUM('entregado','anulado') NOT NULL DEFAULT 'entregado',
      entregado_por INT NULL,
      entregado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'La hora del TOQUE (no la de la subida, si se hizo sin señal)',
      nota VARCHAR(255) NULL,
      foto_url VARCHAR(255) NULL COMMENT 'Archivo en uploads/dia-d/ (carpeta protegida); sale sólo por GET /entregas/:id/foto',
      cliente_uuid VARCHAR(64) NULL,
      anulado_por INT NULL,
      anulado_en DATETIME NULL,
      UNIQUE KEY uq_logi_entrega (item_id, receptor_usuario_id, fecha),
      KEY idx_logi_entrega_puesto (aspirante_id, fecha, puesto_id),
      FOREIGN KEY (item_id) REFERENCES logistica_items(id) ON DELETE CASCADE,
      FOREIGN KEY (receptor_usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
      FOREIGN KEY (entregado_por) REFERENCES usuarios(id) ON DELETE SET NULL,
      FOREIGN KEY (anulado_por) REFERENCES usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  // Los tres ítems de fábrica, UNA vez: sólo si la campaña madre no tiene ninguno. Si el administrador renombró o desactivó uno,
  // volver a correr init-db no lo recrea. (Un aspirante recibe los suyos la primera vez que abre el módulo.)
  {
    const { ITEMS_DE_FABRICA } = require('../lib/logisticaItems');
    const [[{ n }]] = await connection.query('SELECT COUNT(*) AS n FROM logistica_items WHERE aspirante_id = 0');
    if (Number(n) === 0) {
      for (const it of ITEMS_DE_FABRICA) {
        await connection.query(
          'INSERT INTO logistica_items (aspirante_id, nombre, destinatario, hora_limite, orden) VALUES (0, ?, ?, ?, ?)',
          [it.nombre, it.destinatario, it.hora, it.orden]);
      }
      console.log('Ítems de logística sembrados: ' + ITEMS_DE_FABRICA.map(i => i.nombre).join(', ') + '.');
    }
  }
  console.log('Tablas de la logística del Día D listas.');

  // --- Día D fase 3: el bloque de cada voto ---
  // `dia_d_reporte_votos` guardaba solo el NOMBRE del candidato; el bloque (candidato,
  // nivelación, otros) se deducía cruzando ese nombre con la hoja de HOY, y si el candidato se
  // renombraba o se borraba el cruce se perdía. Los reportes nuevos lo guardan; los viejos
  // quedan en NULL y se siguen deduciendo por nombre (nada se reescribe).
  await agregarColumnaSiFalta(
    connection, 'dia_d_reporte_votos',
    `grupo ENUM('candidato','nivelacion','otros') NULL AFTER votos`,
    'grupo'
  );

  // Índices de votantes que la lista de faltantes necesita. `sublider_id` y
  // `puesto_id` no tenían ninguno (medido con SHOW INDEX): el filtro por
  // sublíder y por puesto recorría la tabla entera. Se busca CUALQUIER índice
  // que ya empiece por esa columna —una base creada desde el esquema trae el de
  // la llave foránea con otro nombre— para no duplicarlo.
  for (const [columna, nombre] of [['sublider_id', 'idx_votantes_sublider'], ['puesto_id', 'idx_votantes_puesto_id']]) {
    const [[ya]] = await connection.query(
      `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'votantes'
          AND COLUMN_NAME = ? AND SEQ_IN_INDEX = 1`, [columna]);
    if (ya.n > 0) {
      console.log(`votantes.${columna} ya tenía índice. Sin cambios.`);
    } else {
      await connection.query(`ALTER TABLE votantes ADD INDEX ${nombre} (${columna})`);
      console.log(`Índice ${nombre} creado.`);
    }
  }

  // Plantillas de arranque del enlace «Ya voté».
  //
  // LA DE SMS ES CORTA A PROPÓSITO. Con el enlace (~50 a ~70 caracteres según el dominio) y la
  // firma del operador (30), la versión anterior —«Hola {primer_nombre}, hoy votas en {puesto},
  // mesa {mesa}…»— pasaba de un segmento y el mensaje podía NO llegar. La página del enlace ya
  // muestra el puesto, la mesa y cómo llegar, así que el SMS no los repite. Va sin tildes (ver la
  // nota de las plantillas de arriba).
  //
  // SI EL ADMINISTRADOR YA LA EDITÓ NO SE LE PISA: solo se reemplaza el texto que esta migración
  // sembró antes (el viejo, exacto). Si cambió, la nueva se crea aparte como «… (corto)».
  const NOMBRE_YA_VOTO = 'Dia D - aviso ya voto';
  const TEXTO_YA_VOTO_VIEJO = 'Hola {primer_nombre}, hoy votas en {puesto}, mesa {mesa}. Cuando votes, avisanos aqui: {enlace_ya_vote}';
  const TEXTO_YA_VOTO_NUEVO = '{primer_nombre}, hoy votamos. Cuando votes, avisanos aqui: {enlace_ya_vote}';
  const [[existente]] = await connection.query(
    `SELECT cuerpo FROM comunicaciones_plantillas WHERE nombre = ?`, [NOMBRE_YA_VOTO]);
  if (!existente) {
    await connection.query(
      `INSERT INTO comunicaciones_plantillas (nombre, canal, asunto, cuerpo) VALUES (?, 'sms', NULL, ?)`,
      [NOMBRE_YA_VOTO, TEXTO_YA_VOTO_NUEVO]);
    console.log(`Plantilla «${NOMBRE_YA_VOTO}» creada.`);
  } else if (existente.cuerpo === TEXTO_YA_VOTO_NUEVO) {
    console.log(`La plantilla «${NOMBRE_YA_VOTO}» ya existía. Sin cambios.`);
  } else if (existente.cuerpo === TEXTO_YA_VOTO_VIEJO) {
    await connection.query(`UPDATE comunicaciones_plantillas SET cuerpo = ? WHERE nombre = ?`,
      [TEXTO_YA_VOTO_NUEVO, NOMBRE_YA_VOTO]);
    console.log(`Plantilla «${NOMBRE_YA_VOTO}» actualizada al texto corto (1 SMS).`);
  } else {
    // La editó el administrador: se respeta y la corta se agrega aparte, si no estaba ya.
    const [r] = await connection.query(
      `INSERT INTO comunicaciones_plantillas (nombre, canal, asunto, cuerpo)
       SELECT ?, 'sms', NULL, ? FROM DUAL
        WHERE NOT EXISTS (SELECT 1 FROM comunicaciones_plantillas WHERE nombre = ?)`,
      [`${NOMBRE_YA_VOTO} (corto)`, TEXTO_YA_VOTO_NUEVO, `${NOMBRE_YA_VOTO} (corto)`]);
    console.log(r.affectedRows
      ? `La plantilla «${NOMBRE_YA_VOTO}» fue editada: se respeta y se creó «${NOMBRE_YA_VOTO} (corto)».`
      : `La plantilla «${NOMBRE_YA_VOTO} (corto)» ya existía. Sin cambios.`);
  }
  {
    const [r] = await connection.query(
      `INSERT INTO comunicaciones_plantillas (nombre, canal, asunto, cuerpo)
       SELECT 'WhatsApp · Ya voté', 'whatsapp', NULL, ? FROM DUAL
        WHERE NOT EXISTS (SELECT 1 FROM comunicaciones_plantillas WHERE nombre = 'WhatsApp · Ya voté')`,
      ['Hola {primer_nombre}, hoy votas en {puesto}, mesa {mesa}. Cuando votes, avísanos aquí: {enlace_ya_vote}']);
    console.log(r.affectedRows ? 'Plantilla «WhatsApp · Ya voté» creada.' : 'La plantilla «WhatsApp · Ya voté» ya existía. Sin cambios.');
  }

  // --- Testigo electoral: puesto/mesa propios, separados del lugar de
  // votación de la persona ---
  // Antes, a un Líder/Coordinador/Sublíder/Votante que además se marcaba
  // como testigo se le escribía el puesto de VIGILANCIA encima de su lugar
  // de votación real (las mismas columnas de "usuarios" servían para los
  // dos conceptos). Una persona puede votar en un puesto y ser testigo en
  // otro distinto, así que el dato del testigo pasa a vivir en su propia
  // fila de "estructura".
  //
  // El testigo PURO (creado desde la pantalla Testigos) sigue guardando en
  // "usuarios" como siempre: no tiene un lugar de votación aparte que
  // proteger. Por eso las consultas leen COALESCE(estructura, usuarios) y
  // no hace falta migrar ningún dato existente.
  await agregarColumnaSiFalta(connection, 'estructura', 'puesto_votacion VARCHAR(200) NULL AFTER mesas_asignadas', 'puesto_votacion');
  await agregarColumnaSiFalta(connection, 'estructura', 'mesa_votacion INT NULL AFTER puesto_votacion', 'mesa_votacion');
  await agregarColumnaSiFalta(connection, 'estructura', 'puesto_id INT NULL AFTER mesa_votacion', 'puesto_id');
  await agregarColumnaSiFalta(connection, 'estructura', 'departamento_votacion VARCHAR(150) NULL AFTER puesto_id', 'departamento_votacion');
  await agregarColumnaSiFalta(connection, 'estructura', 'municipio_votacion VARCHAR(150) NULL AFTER departamento_votacion', 'municipio_votacion');
  await separarDatosDeTestigosExistentes(connection);

  // Credenciales propias de Onurix por campaña. Van vacías salvo que la
  // campaña traiga su propia cuenta: lo normal es usar la maestra del .env.
  await agregarColumnaSiFalta(connection, 'configuracion_comunicaciones',
    'onurix_client VARCHAR(50) NULL AFTER twilio_whatsapp_from', 'onurix_client');
  await agregarColumnaSiFalta(connection, 'configuracion_comunicaciones',
    'onurix_key VARCHAR(255) NULL AFTER onurix_client', 'onurix_key');

  // Las tablas del canal SMS las crea schema.sql, pero con CREATE TABLE IF NOT
  // EXISTS: en una base que YA las tiene —las que recibieron la migración a
  // mano— no cambia nada. Las columnas que se agregaron después van por aquí.
  await agregarColumnaSiFalta(connection, 'sms_envios',
    'proveedor_lote_id VARCHAR(128) NULL AFTER proveedor_id', 'proveedor_lote_id');
  await agregarColumnaSiFalta(connection, 'sms_envios',
    'estado_proveedor VARCHAR(40) NULL AFTER estado', 'estado_proveedor');
  // Autorización por canal, y la versión del texto que se mostró. Van NULL en
  // lo ya registrado: "no consta" y no "no autorizó" — ver la nota del
  // esquema. Es lo que permite activar esto sin dejar muda a la campaña.
  for (const canal of ['email', 'sms', 'whatsapp']) {
    await agregarColumnaSiFalta(connection, 'votantes',
      `consentimiento_${canal} TINYINT(1) NULL AFTER consentimiento_metodo`, `consentimiento_${canal}`);
  }
  await agregarColumnaSiFalta(connection, 'votantes',
    'consentimiento_version VARCHAR(64) NULL AFTER consentimiento_whatsapp', 'consentimiento_version');
  // ¿El servidor pudo resolver esa huella contra su archivo de versiones?
  // NULL en todo lo ya registrado, que es lo honesto: esas fichas se crearon
  // cuando nadie comprobaba nada, así que no consta ni que sí ni que no.
  // Un 0 significa "se comprobó y no cuadró"; NULL, "no se comprobó".
  await agregarColumnaSiFalta(connection, 'votantes',
    "consentimiento_version_ok TINYINT(1) NULL COMMENT 'La huella recibida corresponde a una versión archivada de la política' AFTER consentimiento_version",
    'consentimiento_version_ok');
  // Doble confirmación. NULL mientras nadie confirme: no es "no confirmó",
  // es que no se le ha pedido — que es el estado de todo lo ya registrado.
  await agregarColumnaSiFalta(connection, 'votantes',
    "consentimiento_confirmado_en DATETIME NULL COMMENT 'La persona lo confirmó desde su propio teléfono o correo' AFTER consentimiento_version_ok",
    'consentimiento_confirmado_en');
  await agregarColumnaSiFalta(connection, 'votantes',
    "consentimiento_confirmado_canal ENUM('sms','email') NULL AFTER consentimiento_confirmado_en",
    'consentimiento_confirmado_canal');

  await agregarColumnaSiFalta(connection, 'sms_config',
    "baja_automatica TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Pegar el enlace de baja al final de cada SMS que no traiga {baja}'",
    'baja_automatica');
  await agregarColumnaSiFalta(connection, 'sms_config',
    "firma_posicion ENUM('inicio','final') NOT NULL DEFAULT 'final' AFTER firma", 'firma_posicion');

  // APAGADA POR OMISIÓN, al revés que `baja_automatica`. Aquella no cuesta
  // nada y protege a quien recibe, así que va encendida; ésta gasta un
  // crédito por cada persona que se registre, y encenderla es una decisión
  // que toma cada campaña — no algo que le llegue en un parche.
  await agregarColumnaSiFalta(connection, 'sms_config',
    "bienvenida_automatica TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Mandar la plantilla Bienvenida (primer contacto) al registrar a alguien nuevo'",
    'bienvenida_automatica');
  // Confirmación de consentimiento por CORREO al registrar. Apagada de fábrica
  // como la de arriba, aunque el correo no gaste crédito: mandarle algo a
  // alguien recién registrado lo decide la campaña, no el programa. Solo
  // correo — para SMS está el botón manual de la ficha, que avisa del costo.
  await agregarColumnaSiFalta(connection, 'sms_config',
    "confirmacion_email_automatica TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Pedir la doble confirmación por correo al registrar a alguien nuevo'",
    'confirmacion_email_automatica');

  // Índice de la lista de baja. El canal SMS pregunta por cada mensaje si ese
  // teléfono pidió no recibir, y el filtro que decide es `no_contactar = 1`:
  // los dados de baja son pocos, así que con índice MySQL recorre solo esas
  // filas. Un índice sobre `telefono` NO serviría — la columna va envuelta en
  // REGEXP_REPLACE y ningún índice se usa sobre una expresión.
  //
  // Estaba creado a mano en electoral y no en el esquema, así que el parche 28
  // llegó a las campañas sin él: lo que se aplica a una base a mano no existe
  // para las demás.
  for (const tabla of ['votantes', 'usuarios']) {
    try {
      await connection.query(`ALTER TABLE ${tabla} ADD INDEX idx_no_contactar (no_contactar)`);
      console.log(`Índice idx_no_contactar creado en ${tabla}.`);
    } catch (err) {
      if (err.code !== 'ER_DUP_KEYNAME') throw err;
      console.log(`El índice idx_no_contactar de ${tabla} ya existía. Sin cambios.`);
    }
  }
  // `proveedor` nació NOT NULL y tiene que admitir NULL: un mensaje rechazado
  // por la lista de baja o por falta de créditos nunca llegó a tener uno, y
  // con NOT NULL ese INSERT muere DESPUÉS de haber devuelto el crédito.
  await modificarColumna(connection, 'sms_envios', 'proveedor VARCHAR(20) NULL');

  // Las plantillas prometian «Responda BAJA», y esa respuesta no llega:
  // medido el 13 de agosto de 2026 en la campaña municipal, enviando con un
  // numero de EE. UU. el operador colombiano entrega desde un codigo corto
  // suyo y la respuesta no tiene ruta de vuelta —cero respuestas recibidas en
  // toda la vida de la instalacion—. Se cambian por el enlace de baja, que no
  // depende del proveedor.
  //
  // SOLO se corrige la plantilla que siga EXACTAMENTE como se sembro: si el
  // administrador la reescribio, su texto manda y aqui no se toca.
  const plantillasConBajaVieja = [
    ['Bienvenida (primer contacto)',
     'Hola {nombre}, le saluda la campana de {slogan}. Gracias por acompanarnos. Responda BAJA si no desea recibir mas mensajes.',
     'Hola {nombre}, le saluda la campana de {slogan}. Gracias por acompanarnos. Para no recibir mas: {baja}'],
    ['Invitacion a evento',
     'Hola {nombre}, lo invitamos a nuestro encuentro. Confirme su asistencia respondiendo SI. Responda BAJA para no recibir mas mensajes.',
     'Hola {nombre}, lo invitamos a nuestro encuentro. Lo esperamos. Para no recibir mas: {baja}'],
  ];
  // Lo mismo para el correo: «respóndanos y lo retiramos de la lista» promete una gestión
  // manual que nadie hace —el correo sale de un buzón que no se lee— y el pie de baja
  // automático (config/bajaContacto.js `pieDeBaja`) ya trae el enlace.
  plantillasConBajaVieja.push(['Bienvenida al equipo',
    'Hola {nombre},\n\nGracias por sumarse a nuestra campaña. Desde hoy hace parte del equipo que está construyendo esto en {municipio}.\n\nEn los próximos días le estaremos compartiendo información sobre encuentros y actividades.\n\n{slogan}\n\n---\nSi no desea seguir recibiendo estos correos, respóndanos y lo retiramos de la lista.',
    'Hola {nombre},\n\nGracias por sumarse a nuestra campaña. Desde hoy hace parte del equipo que está construyendo esto en {municipio}.\n\nEn los próximos días le estaremos compartiendo información sobre encuentros y actividades.\n\n{slogan}\n\n---\nSi no desea seguir recibiendo estos correos, use el enlace para darse de baja que aparece al pie de este mensaje.']);
  // La del aviso al testigo se acortó (orden 19): «eres testigo en … Entra a la app:» pasaba de 1 SMS con casi
  // cualquier nombre de puesto. Sólo se cambia si sigue EXACTAMENTE como se sembró.
  plantillasConBajaVieja.push(['Testigo - aviso de asignacion',
    '{primer_nombre}, eres testigo en {puesto_testigo}, mesa {mesas_testigo}. Entra a la app: {enlace_app}',
    '{primer_nombre}, testigo en {puesto_testigo}, mesa {mesas_testigo}. {enlace_app}']);
  for (const [nombre, textoViejo, textoNuevo] of plantillasConBajaVieja) {
    const [r] = await connection.query(
      `UPDATE comunicaciones_plantillas SET cuerpo = ? WHERE nombre = ? AND cuerpo = ?`,
      [textoNuevo, nombre, textoViejo]);
    if (r.affectedRows) console.log(`Plantilla "${nombre}": se actualizo el texto sembrado.`);
  }

  /* -------------------------------------------------------------------
     SUPERADMINISTRADOR — la única cuenta con control total.

     La bandera va aparte del rol a propósito: la cuenta conserva su
     `rol_id` de admin, y de ahí hereda las más de cuarenta rutas que
     autorizan con `requireRole('admin')`. Un rol nuevo la habría dejado
     FUERA de todas ellas. El razonamiento completo está en
     config/superadmin.js.

     La columna generada existe solo para colgarle el UNIQUE: vale 1 para el
     superadministrador y NULL para el resto, y MySQL no compara NULL entre
     sí en un índice único. Así «solo puede haber uno» lo garantiza la base
     y no un `if` de JavaScript —que no cubriría lo que entra por la
     consola de MySQL o por un respaldo restaurado—.

     LA COLUMNA GENERADA VA DESPUÉS, EN SU PROPIO ALTER: en una base ya
     creada MySQL no admite referenciar en la expresión de una columna
     generada otra columna añadida en la MISMA sentencia.

     Esto NO eleva a nadie: deja la base lista y ya. Otorgar la categoría es
     un acto aparte y deliberado, `node scripts/elevar-superadmin.js`, y
     ninguna ruta de la aplicación escribe esta columna.
     ------------------------------------------------------------------- */
  await agregarColumnaSiFalta(connection, 'usuarios',
    "es_superadmin TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Superadministrador: única cuenta con control total. Ver config/superadmin.js' AFTER ultimo_login",
    'es_superadmin');

  /* EL TELEFONO AL QUE ESCRIBE QUIEN NECESITA SOPORTE. Vive en la fila del
     superadministrador y no en `configuracion_campana` a proposito: la
     configuracion de campaña la edita cada admin de campaña, y el soporte lo
     da INGESES, no la campaña. Puesto ahi, cualquier admin podria cambiar el
     numero al que escriben sus propios usuarios cuando algo falla.

     Va en `usuarios` y no en una tabla nueva porque es un dato de esa cuenta,
     y la cuenta ya es unica (`superadmin_unico`). */
  await agregarColumnaSiFalta(connection, 'usuarios',
    "telefono_soporte VARCHAR(20) NULL COMMENT 'Solo del superadministrador: el WhatsApp de soporte que ve toda la aplicacion' AFTER es_superadmin",
    'telefono_soporte');
  await agregarColumnaSiFalta(connection, 'usuarios',
    "superadmin_unico TINYINT(1) GENERATED ALWAYS AS (IF(es_superadmin = 1, 1, NULL)) VIRTUAL AFTER es_superadmin",
    'superadmin_unico');
  /* -------------------------------------------------------------------
     SUBLICENCIAS PARA ASPIRANTES A OTROS CARGOS

     Un aspirante al Concejo que trabaja dentro de la estructura de una
     campaña a la Alcaldía puede tener su propia vista: su rama, sus votantes,
     sus testigos. El dato NO se duplica — la persona sigue existiendo una sola
     vez y quién la ve es una consulta.

     ESTE PASO NO CAMBIA NADA TODAVÍA. Crea las tablas y la columna derivada, y
     las llena. Ninguna ruta las consulta aún: se puede aplicar, medir y volver
     atrás sin que nadie note una diferencia.
     ------------------------------------------------------------------- */
  await connection.query(`
    CREATE TABLE IF NOT EXISTS sublicencias (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT NOT NULL COMMENT 'El aspirante, que ya es lider o coordinador de la madre',
      cargo VARCHAR(30) NOT NULL COMMENT 'concejo | jal | asamblea ...',
      nombre VARCHAR(150) NULL COMMENT 'Como se llama SU campana, para su propia marca',
      subtitulo VARCHAR(200) NULL COMMENT 'Su lema, bajo el nombre',
      logo_url VARCHAR(255) NULL COMMENT 'Su logo. Lo sube el superadministrador, no el aspirante',
      activa TINYINT(1) NOT NULL DEFAULT 1,
      creada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      -- Una persona no puede aspirar a dos cosas a la vez dentro de la misma
      -- campana: si lo hiciera, un votante suyo tendria dos ramas principales y
      -- el reparto dejaria de ser una funcion.
      marca_editada_en DATETIME NULL COMMENT 'Desde que el aspirante toco su marca, manda la suya',
      UNIQUE KEY uq_sublicencia_usuario (usuario_id),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  /* QUIEN MANDA SOBRE EL NOMBRE Y EL LEMA, CUANDO LOS DOS PUEDEN ESCRIBIRLOS.
     Los escribe el superadministrador al vender la sublicencia, y la campaña se
     los vuelve a traer cada seis horas. Si el aspirante tambien los puede
     cambiar, sin esta marca su texto duraria como mucho hasta la siguiente
     validacion y desapareceria SOLO, sin error y sin explicacion.

     Con ella, el dia que el los toca pasan a ser suyos: la sincronizacion sigue
     mandando en el cargo, en si esta activa y en el logo, pero deja de pisar
     esos dos campos. Es una decision, no un detalle — el superadministrador ya
     no se los podra cambiar desde Licencias. */
  await agregarColumnaSiFalta(connection, 'sublicencias',
    'marca_editada_en DATETIME NULL', 'marca_editada_en');

  /* LA META DEL ASPIRANTE PARA SU PROPIA CAMPAÑA.
     Son DOS metas distintas y viven en dos sitios porque las pone gente
     distinta:
       · `sublicencias.meta_votos` — a cuántos votos aspira ÉL al Concejo. La
         escribe él, en su Configuración → Datos de la campaña.
       · `estructura.meta_votos`  — cuántos votos le promete a la campaña a la
         Alcaldía. Se la ponen a él al inscribirlo en la campaña principal.
     Juntarlas en una sola columna habría obligado a elegir quién manda, y la
     respuesta es «cada una manda en la suya». */
  await agregarColumnaSiFalta(connection, 'sublicencias',
    "meta_votos INT NOT NULL DEFAULT 0 COMMENT 'Meta de votos de SU campaña. La define el aspirante.'",
    'meta_votos');

  /* QUIÉN QUITÓ A QUIÉN DE SU EQUIPO, SIN BORRAR A NADIE.
     Es la hermana de `votante_ramas.excluido`, para la estructura. Un aspirante
     con sublicencia no puede borrar personas: la fila de `estructura` y la
     cuenta de `usuarios` son de la campaña madre, y el botón «Eliminar» de esa
     pantalla borra las dos — un aspirante usándolo dejaría sin cuenta a un
     líder de la alcaldía. Lo que hace es apuntar aquí que esa persona sale de
     SU vista; la madre la sigue viendo, con la marca de quién la quitó.
     Se guarda `aspirante_id` y no un simple booleano porque puede haber varios
     aspirantes y cada uno decide por su cuenta. */
  await connection.query(`
    CREATE TABLE IF NOT EXISTS estructura_exclusiones (
      estructura_id INT NOT NULL,
      aspirante_id INT NOT NULL,
      excluido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (estructura_id, aspirante_id),
      KEY idx_ee_aspirante (aspirante_id),
      FOREIGN KEY (estructura_id) REFERENCES estructura(id) ON DELETE CASCADE,
      FOREIGN KEY (aspirante_id) REFERENCES usuarios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('Tabla estructura_exclusiones lista.');

  /* EQUIPOS AUTORIZADOS — «que solo se entre desde los computadores de la
     campaña». Ver config/equiposAutorizados.js, que explica qué se puede y qué
     no se puede prometer desde un navegador.
     `identificador` es el que va firmado en la cookie; la firma impide
     inventarlo, y esta tabla es la que decide si entra, para poder revocarlo
     desde el panel sin tocar el equipo. */
  await connection.query(`
    CREATE TABLE IF NOT EXISTS equipos_autorizados (
      id INT AUTO_INCREMENT PRIMARY KEY,
      identificador VARCHAR(64) NOT NULL,
      nombre VARCHAR(120) NULL COMMENT 'Se lo pone una persona: «Portátil de Diego»',
      estado ENUM('autorizado','pendiente','revocado') NOT NULL DEFAULT 'autorizado',
      primer_uso DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ultimo_uso DATETIME NULL,
      ultimo_usuario_id INT NULL,
      user_agent VARCHAR(250) NULL,
      ultima_ip VARCHAR(45) NULL,
      UNIQUE KEY uq_equipo_identificador (identificador),
      KEY idx_equipo_estado (estado),
      FOREIGN KEY (ultimo_usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  /* EL LÍMITE LO MANDA EL SERVIDOR DE LICENCIAS, no se edita aquí: es la
     condición que se vende. Llega en la misma respuesta de validación por la
     que ya viajan las sublicencias.
     `max_equipos = 0` es «sin restricción», y es el valor de arranque: mientras
     ninguna licencia diga otra cosa, esto solo registra desde dónde se entra.
     Una fila única, como sms_config. */
  await connection.query(`
    CREATE TABLE IF NOT EXISTS licencia_equipos_config (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      max_equipos INT NOT NULL DEFAULT 0 COMMENT '0 = sin restricción',
      requiere_aprobacion TINYINT(1) NOT NULL DEFAULT 0,
      actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await connection.query(`INSERT IGNORE INTO licencia_equipos_config (id, max_equipos) VALUES (1, 0)`);
  console.log('Tablas de equipos autorizados listas.');

  /* Las pertenencias ADICIONALES: el votante que apoya a dos aspirantes. La
     principal —quien lo registro primero— sigue en votantes.lider_id, que es lo
     que ve la campana madre y por eso no se toca. */
  await connection.query(`
    CREATE TABLE IF NOT EXISTS votante_ramas (
      votante_id INT NOT NULL,
      aspirante_id INT NOT NULL,
      registrado_por INT NULL COMMENT 'Quien lo sumo a ESTA rama',
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      excluido TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'El aspirante la quito de SU vista; la ficha sigue viva',
      PRIMARY KEY (votante_id, aspirante_id),
      KEY idx_vr_aspirante (aspirante_id),
      FOREIGN KEY (votante_id) REFERENCES votantes(id) ON DELETE CASCADE,
      FOREIGN KEY (aspirante_id) REFERENCES usuarios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  /* `excluido` PARA LAS INSTALACIONES QUE YA TENIAN LA TABLA.
     Es lo que permite que «eliminar» signifique cosas distintas segun quien lo
     haga: el administrador borra la ficha, y el aspirante la quita de SU vista.
     Sin esta columna, un aspirante borrando a alguien de su base borraria a esa
     persona tambien de la campaña madre — y esa fila no la registro el. */
  await agregarColumnaSiFalta(connection, 'votante_ramas',
    'excluido TINYINT(1) NOT NULL DEFAULT 0', 'excluido');

  /* La rama principal, DERIVADA y guardada. Se calcula subiendo por la cadena
     de mando hasta topar con un aspirante con sublicencia activa. Se guarda en
     vez de recorrerla en cada consulta porque la tabla de votantes se lista
     entera muchas veces al dia, y una CTE recursiva por fila es un precio que
     no hay que pagar. Se recalcula con scripts/recalcular-ramas.js */
  /* LA COMUNA Y EL BARRIO DE RESIDENCIA, TAMBIÉN EN VOTANTES.
     Existían solo en `usuarios`, así que un votante que no está en la
     estructura no tenía dónde guardarlos — y la pantalla de Votantes acababa
     mostrando en esas dos columnas el TERRITORIO DE INFLUENCIA, que es otra
     cosa: dónde trabaja la persona, no dónde vive. Por eso la misma persona
     salía en «Comuna 03 - Cumanday › Centro» en Estructura y en «Comuna 01 -
     Atardeceres › Chipre» en Votantes, y parecía un fallo de sincronización.
     Con las columnas aquí, cada pantalla muestra lo suyo y la sincronización
     puede traer el dato de la ficha de estructura. */
  await agregarColumnaSiFalta(connection, 'votantes',
    'comuna_corregimiento_residencia VARCHAR(120) NULL AFTER ciudad_residencia',
    'comuna_corregimiento_residencia');
  await agregarColumnaSiFalta(connection, 'votantes',
    'barrio_residencia VARCHAR(120) NULL AFTER comuna_corregimiento_residencia',
    'barrio_residencia');

  await agregarColumnaSiFalta(connection, 'votantes',
    `rama_aspirante_id INT NULL COMMENT 'Derivado: aspirante del que cuelga. Ver lib/ramas.js' AFTER sublider_id`,
    'rama_aspirante_id');
  try {
    await connection.query(`ALTER TABLE votantes ADD INDEX idx_votantes_rama (rama_aspirante_id)`);
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
  }

  console.log('Sublicencias: tablas, columna derivada e indice listos.');

  try {
    await connection.query(
      `ALTER TABLE usuarios ADD UNIQUE INDEX uq_superadmin_unico (superadmin_unico)`);
    console.log('Índice uq_superadmin_unico creado: solo puede haber un superadministrador.');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
    console.log('El índice uq_superadmin_unico ya existía. Sin cambios.');
  }

  // Con la columna y el índice único ya garantizados: el disparador que mantiene al
  // superadministrador fuera de la estructura, y la cuenta inicial (solo si esta es
  // una instalación nueva).
  await crearTriggersEstructuraSinSuperadmin(connection);
  await crearSuperadminInicial(connection, adminCreadoEstaCorrida);
  await asegurarSuperadmin(connection);
  await ajustarContadorTerritorios(connection);
  await rellenarTerritoriosPuente(connection);

  /* LA INTENCIÓN DE VOTO SE RETIRA DE LA APLICACIÓN (30 de agosto de 2026).
     Era una escala —confirmado, probable, indeciso, no apoya— que en la
     práctica nadie llenaba: el campo no estaba en ningún formulario, así que
     solo podía entrar por importación de Excel. Medido antes de quitarla: 4
     votantes de 97 en una campaña y 0 de 81 en la otra tenían algo distinto de
     «desconocido», el panel calculaba tres contadores que no pintaba, el mapa
     coloreaba por una columna que su consulta no devolvía —todos los pines
     grises desde siempre— y `votante_opinion`, la misma escala por aspirante,
     tenía cero filas.

     Se retira también el filtro de destinatarios de los cuatro envíos, que
     filtraba por un valor que no se podía escribir. */
  await quitarColumnaSiSobra(connection, 'votantes', 'intencion_voto');
  await connection.query('DROP TABLE IF EXISTS votante_opinion');

  /* LOS TESTIGOS QUE NACIERON SIN RAMA.
     Hasta ahora la fila de estructura de un testigo se creaba sin
     `supervisor_id`, o sea colgando de nadie. Eso rompia las dos direcciones a
     la vez: el aspirante no veia sus propios testigos —su subarbol baja por
     supervisor_id y nunca llegaba— y la campana madre tampoco podia
     excluirlos, asi que salian en la lista de ella. Se veia como «0 testigos»
     en la sublicencia y el mismo nombre asomando en la principal.
     Ya se arreglo el alta (config/testigoElectoral.js), pero los que existen
     siguen sueltos y no se reparan solos: solo se tocan si alguien vuelve a
     editar ese testigo, y nadie tiene motivo para hacerlo.
     Se cuelgan de donde cuelga la persona, en el mismo orden que usa el alta:
     su otra fila de estructura si esta en el organigrama, y si solo es
     votante, del sublider que la registro o del lider si no hubo sublider.
     Solo toca filas con supervisor_id NULL: una rama puesta a mano no se pisa,
     y correrlo dos veces no cambia nada. */
  await connection.query(`
    UPDATE estructura e
       JOIN estructura o ON o.usuario_id = e.usuario_id
                        AND o.cargo <> 'testigo' AND o.supervisor_id IS NOT NULL
       SET e.supervisor_id = o.supervisor_id
     WHERE e.cargo = 'testigo' AND e.supervisor_id IS NULL`);
  await connection.query(`
    UPDATE estructura e
       JOIN usuarios u ON u.id = e.usuario_id AND u.numero_identificacion IS NOT NULL
       JOIN votantes v ON v.cedula = u.numero_identificacion
       SET e.supervisor_id = COALESCE(v.sublider_id, v.lider_id)
     WHERE e.cargo = 'testigo' AND e.supervisor_id IS NULL
       AND COALESCE(v.sublider_id, v.lider_id) IS NOT NULL`);

  /* CADA CAMPANA TIENE SU PROPIA LISTA DE PUESTOS Y DE CANDIDATOS.
     La sublicencia del Aspirante al Concejo es una campana aparte: sus puestos
     del Dia D, con su propia cantidad de mesas, no son los de la campana
     madre. Hasta ahora habia una sola lista y el aspirante veia la de ella.

     `aspirante_id` = 0 ES LA CAMPANA PRINCIPAL, y es 0 y no NULL a proposito:
     en MySQL un indice unico admite tantos NULL como quieras, asi que con NULL
     la campana madre habria podido repetir el mismo nombre de puesto tantas
     veces como filas — justo la unicidad que el indice existe para garantizar.
     Con 0 la pareja (0, 'LA FLORESTA') choca consigo misma como debe.

     Y por eso los dos unicos pasan a llevar el dueno delante: dos campanas
     cubren los MISMOS sitios fisicos, asi que sin el dueno la segunda que
     intentara traer un puesto del catalogo chocaria con la primera. */
  await agregarColumnaSiFalta(connection, 'dia_d_puestos_votacion',
    'aspirante_id INT NOT NULL DEFAULT 0', 'aspirante_id');
  await agregarColumnaSiFalta(connection, 'dia_d_candidatos',
    'aspirante_id INT NOT NULL DEFAULT 0', 'aspirante_id');

  /* EL ORDEN DEL TARJETON, QUE NO ES EL ORDEN DE CAPTURA.
     El testigo transcribe un E-14 y alli el orden lo fija la Registraduria.
     Hasta hoy la lista salia por `id` —orden en que el admin fue tecleando— y
     no habia forma de cuadrarla con el papel, asi que las cifras se copiaban
     corridas de lugar sin que nada avisara.

     Se rellena con el `id` en la primera corrida: como `id` es unico y
     creciente, el orden que habia se conserva EXACTO y nadie ve un cambio.
     La condicion `orden = 0` hace que solo actue sobre lo que nunca se ordeno;
     una campana que ya movio sus candidatos no se toca en la siguiente
     corrida. */
  if (await agregarColumnaSiFalta(connection, 'dia_d_candidatos',
        'orden INT NOT NULL DEFAULT 0', 'orden')) {
    const [r] = await connection.query('UPDATE dia_d_candidatos SET orden = id WHERE orden = 0');
    console.log(`Orden inicial de candidatos asignado a ${r.affectedRows} fila(s).`);
  }

  /* LOS TRES BLOQUES DEL E-14: candidatos, nivelacion de la mesa y otros votos.
     Todo lo que ya existia cae en `candidato` por el DEFAULT, asi que despues
     de migrar la aplicacion se comporta EXACTAMENTE igual que antes: la misma
     lista, en el mismo orden, en el mismo grafico. Repartirlo entre los tres
     bloques es decision de cada campaña.

     NO se intenta adivinar el bloque por el nombre. Seria facil mandar a
     `otros` todo lo que empiece por «Votos », y es justo el tipo de regla que
     acierta en la campaña de prueba y falla en la primera real —un candidato
     que se apellide asi, una lista llamada «Votos por el cambio»—. Mover una
     fila de bloque cuesta dos clics; deshacer un reparto automatico que nadie
     pidio, no. */
  await agregarColumnaSiFalta(connection, 'dia_d_candidatos',
    "grupo ENUM('candidato','nivelacion','otros') NOT NULL DEFAULT 'candidato'", 'grupo');

  /* El ORDEN de los bloques, que es un dato de la campaña y no de cada fila.
     La tabla se crea vacia: `ordenDeLosBloques()` en routes/diaD.routes.js
     devuelve el orden natural cuando una campaña no tiene filas aqui, asi que
     no hace falta sembrar nada y una campaña que nunca mueva un bloque no
     escribe ni una linea. */
  await connection.query(`
    CREATE TABLE IF NOT EXISTS dia_d_bloques (
      aspirante_id INT NOT NULL DEFAULT 0,
      grupo ENUM('candidato','nivelacion','otros') NOT NULL,
      orden INT NOT NULL,
      PRIMARY KEY (aspirante_id, grupo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  await agregarColumnaSiFalta(connection, 'dia_d_bloques',
    'numerado TINYINT(1) NOT NULL DEFAULT 1', 'numerado');
  await agregarColumnaSiFalta(connection, 'dia_d_bloques',
    'numero_inicial INT NOT NULL DEFAULT 1', 'numero_inicial');

  /* SE SIEMBRA LO QUE HOY SE VE, para que nadie note un cambio al actualizar.
     Hasta ahora la numeracion arrancaba en 0 si la campaña era de un aspirante
     y en 1 si no, deducido en el navegador. Eso pasa a ser un dato por bloque,
     y aqui se escribe el valor que esa campaña ya estaba mostrando.

     Solo para las campañas que YA tienen filas en dia_d_candidatos: una que
     todavia no ha configurado nada estrena el valor por defecto (numerada
     desde 1) sin necesidad de una fila. Y con INSERT IGNORE, una campaña que ya
     hubiera movido un bloque conserva lo suyo. */
  const [duenos] = await connection.query('SELECT DISTINCT aspirante_id FROM dia_d_candidatos');
  for (const { aspirante_id: duenoId } of duenos) {
    for (const [i, grupo] of ['candidato', 'nivelacion', 'otros'].entries()) {
      await connection.query(
        `INSERT IGNORE INTO dia_d_bloques (aspirante_id, grupo, orden, numerado, numero_inicial)
         VALUES (?,?,?,1,?)`,
        [duenoId, grupo, i + 1, duenoId ? 0 : 1]);
    }
  }
  console.log(`Tabla dia_d_bloques lista (${duenos.length} campaña(s) con su numeración sembrada).`);
  await rehacerIndiceUnico(connection, 'dia_d_puestos_votacion', 'uq_puesto_nombre',
    ['aspirante_id', 'nombre']);
  await rehacerIndiceUnico(connection, 'dia_d_puestos_votacion', 'uq_dia_d_puestos_ctc',
    ['aspirante_id', 'ctc_puesto_id']);

  /* ---------------------------------------------------------------------
     INSCRIPCIÓN POR ENLACE / QR DEL LÍDER (/i/:codigo)

     Cada líder, sublíder o coordinador tiene un enlace corto y un QR propios.
     Quien lo abre se inscribe solo desde su celular y queda como votante de ese
     líder con origen «enlace_lider», pendiente de confirmar por /c.

     EL CÓDIGO SE GUARDA EN CLARO (no es un HMAC como el de /v) porque tiene que
     poder ROTARSE por persona y revocarse sin tocar a nadie más. No identifica
     a nadie por sí solo: el id del usuario no viaja en la URL.
     --------------------------------------------------------------------- */
  await connection.query(`
    CREATE TABLE IF NOT EXISTS inscripcion_enlaces (
      id INT AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT NOT NULL,
      codigo CHAR(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'Alfabeto sin 0/O/1/I/L; ver config/inscripcionEnlace.js',
      activo TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 = lo desactivó un coordinador o el administrador: el líder no lo puede reactivar',
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      rotado_en DATETIME NULL,
      UNIQUE KEY uq_insc_usuario (usuario_id),
      UNIQUE KEY uq_insc_codigo (codigo),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

  /* LA BITÁCORA. Una fila por intento que llegó a evaluarse (no por cada GET).
     `cedula_hash` es el SHA-256 de la cédula: sirve para contar y cruzar
     intentos sin guardar el número en una tabla que se lista. `otro_lider` es
     aparte de `resultado` porque un mismo intento puede sumar a una rama Y
     haber sido de otro líder, y el coordinador necesita ver lo segundo. */
  await connection.query(`
    CREATE TABLE IF NOT EXISTS inscripcion_intentos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      enlace_id INT NOT NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resultado ENUM('nuevo','mismo_lider','otro_lider','rama_sumada','consentimiento_completado','rechazado') NOT NULL,
      votante_id INT NULL,
      cedula_hash CHAR(64) NULL,
      telefono_hash CHAR(64) NULL COMMENT 'SHA-256 de los últimos 10 dígitos: para el tope por teléfono',
      otro_lider TINYINT(1) NOT NULL DEFAULT 0,
      motivo VARCHAR(40) NULL COMMENT 'En rechazados: honeypot, muy_rapido, tope_telefono, tope_enlace. En una cédula que ya existía: cedula_existente',
      cedula_fin CHAR(3) NULL COMMENT 'Últimos 3 dígitos de la cédula, solo cuando ya existía (para el aviso al líder)',
      celular_coincide TINYINT(1) NULL COMMENT 'Solo cuando la cédula ya existía: 1 si el celular escrito coincidía con el de la ficha',
      sms_reenviado TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Reinscripción con celular coincidente: 1 si se encoló otra vez el SMS de confirmación',
      ip VARCHAR(45) NULL,
      navegador VARCHAR(255) NULL,
      KEY idx_insc_int_enlace (enlace_id, creado_en),
      KEY idx_insc_int_tel (telefono_hash, creado_en),
      KEY idx_insc_int_votante (votante_id),
      FOREIGN KEY (enlace_id) REFERENCES inscripcion_enlaces(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

  /* Las dos columnas de la orden 28 en una base que ya tenía la tabla (CREATE TABLE IF NOT EXISTS no las agrega). */
  await agregarColumnaSiFalta(connection, 'inscripcion_intentos',
    "cedula_fin CHAR(3) NULL COMMENT 'Últimos 3 dígitos de la cédula, solo cuando ya existía (para el aviso al líder)'", 'cedula_fin');
  await agregarColumnaSiFalta(connection, 'inscripcion_intentos',
    "celular_coincide TINYINT(1) NULL COMMENT 'Solo cuando la cédula ya existía: 1 si el celular escrito coincidía con el de la ficha'", 'celular_coincide');

  /* La reinscripción de una ficha sin confirmar vuelve a mandar el SMS de confirmación (orden 31): el intento anota si se encoló. */
  await agregarColumnaSiFalta(connection, 'inscripcion_intentos',
    "sms_reenviado TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Reinscripción con celular coincidente: 1 si se encoló otra vez el SMS de confirmación'", 'sms_reenviado');

  /* UNA CÉDULA, UNA FICHA: el índice UNIQUE de votantes.cedula. Viene en db/schema.sql, así que toda campaña
     creada con él lo tiene; esto cubre a la que no. CONDICIONAL: si ya hay cédulas repetidas NO se crea (fallaría
     a la mitad, o peor, habría que borrar fichas de personas), se avisa por consola y se sigue. Es lo único que
     hace con duplicados: contarlos y decirlo. Quitarlos es decisión de quien administra la campaña. */
  {
    const [[idx]] = await connection.query(
      `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'votantes' AND COLUMN_NAME = 'cedula'
          AND NON_UNIQUE = 0 AND SEQ_IN_INDEX = 1`);
    if (idx.n > 0) {
      console.log('votantes.cedula ya tiene índice UNIQUE. Sin cambios.');
    } else {
      const [dups] = await connection.query(
        `SELECT cedula, COUNT(*) AS n FROM votantes WHERE cedula IS NOT NULL GROUP BY cedula HAVING COUNT(*) > 1 LIMIT 5`);
      if (dups.length) {
        console.warn(`AVISO: votantes.cedula NO tiene índice UNIQUE y hay cédulas repetidas (p. ej. ${dups.map(d => d.cedula + ' ×' + d.n).join(', ')}).`);
        console.warn('       No se creó el índice. Resuelva los duplicados y vuelva a correr init-db.');
      } else {
        await connection.query('ALTER TABLE votantes ADD UNIQUE KEY cedula (cedula)');
        console.log('Índice UNIQUE de votantes.cedula creado.');
      }
    }
  }

  await connection.query(`
    CREATE TABLE IF NOT EXISTS inscripcion_config (
      id TINYINT NOT NULL PRIMARY KEY,
      habilitado TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Interruptor general de la inscripción por enlace',
      limite_enlace_dia INT NOT NULL DEFAULT 200,
      limite_telefono_dia INT NOT NULL DEFAULT 3,
      segundos_minimos INT NOT NULL DEFAULT 4,
      mensaje_plantilla TEXT NULL COMMENT 'Mensaje con que el líder invita (orden 29). NULL = el texto sugerido, que vive en config/inscripcionMensaje.js'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await connection.query(`INSERT IGNORE INTO inscripcion_config (id) VALUES (1)`);
  await agregarColumnaSiFalta(connection, 'inscripcion_config',
    "mensaje_plantilla TEXT NULL COMMENT 'Mensaje con que el líder invita (orden 29). NULL = el texto sugerido, que vive en config/inscripcionMensaje.js'", 'mensaje_plantilla');

  /* LA EVIDENCIA DE LA AUTORIZACIÓN, EN SU PROPIA TABLA (y no en dos columnas de
     `votantes`). `votantes` se devuelve entera con SELECT v.* en el listado y en
     la ficha; una IP y un navegador no tienen por qué viajar ahí. Es el mismo
     criterio de `votante_firmas`. */
  await connection.query(`
    CREATE TABLE IF NOT EXISTS votante_consentimiento_evidencia (
      votante_id INT NOT NULL PRIMARY KEY,
      metodo VARCHAR(50) NOT NULL,
      ip VARCHAR(45) NULL,
      navegador VARCHAR(255) NULL,
      enlace_id INT NULL,
      politica_version VARCHAR(64) NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (votante_id) REFERENCES votantes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  /* LA COLA DEL SMS DE CONFIRMACIÓN. Un SMS por votante en la vida (UNIQUE): es
     el «UN SMS» de la orden. No guarda el token —se crea al enviar, y de /c solo
     se guarda el hash— sino a quién y desde cuándo. Fuera de la franja el envío
     queda para la apertura (enviar_desde). */
  await connection.query(`
    CREATE TABLE IF NOT EXISTS inscripcion_sms_cola (
      id INT AUTO_INCREMENT PRIMARY KEY,
      votante_id INT NOT NULL,
      enviar_desde DATETIME NOT NULL,
      estado ENUM('pendiente','enviado','omitido','fallido') NOT NULL DEFAULT 'pendiente',
      detalle VARCHAR(200) NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      enviado_en DATETIME NULL,
      UNIQUE KEY uq_insc_sms_votante (votante_id),
      KEY idx_insc_sms_estado (estado, enviar_desde),
      FOREIGN KEY (votante_id) REFERENCES votantes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  console.log('Tablas de la inscripción por enlace listas.');

  /* ------------------------------------------------------------------------------------------------------------
     RECORDATORIOS AUTOMÁTICOS, FASE 1 (lib/recordatorios.js). Apagados de fábrica: sin reglas y con el interruptor en 0.
       · recordatorio_reglas   QUÉ se manda, por qué canal, CUÁNDO (desfase respecto de algo, o una hora del día) y a quién (filtros).
       · recordatorio_envios   UNA fila por (regla, destinatario, ocurrencia). La clave única es el candado contra los duplicados:
                               se hace INSERT IGNORE ANTES de enviar y solo manda quien de verdad insertó (como lib/avisosAlertas.js).
       · recordatorio_tope_diario  los segmentos de SMS automáticos gastados hoy, con reserva previa.
     ------------------------------------------------------------------------------------------------------------ */
  await connection.query(`
    CREATE TABLE IF NOT EXISTS recordatorio_reglas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tipo VARCHAR(40) NOT NULL COMMENT 'evento | ya_votaste | …: qué fuente de candidatos usa (lib/recordatorios.js)',
      nombre VARCHAR(120) NOT NULL,
      canal ENUM('sms','push','email') NOT NULL,
      activo TINYINT(1) NOT NULL DEFAULT 0,
      plantilla TEXT NOT NULL COMMENT 'Texto con variables de la lista cerrada de su tipo, p. ej. {nombre}',
      asunto VARCHAR(150) NULL COMMENT 'Título del push o asunto del correo',
      desfase_min INT NULL COMMENT 'Minutos respecto del hecho: -1440 = un día antes. NULL si se usa hora_dia',
      hora_dia TIME NULL COMMENT 'Hora del día (Colombia) a la que toca, p. ej. el Día D',
      gracia_min INT NOT NULL DEFAULT 180 COMMENT 'Pasado este tiempo desde que tocaba, ya no se manda (catch-up con tope)',
      filtros JSON NULL,
      creado_por INT NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_rec_regla_activa (activo, tipo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS recordatorio_envios (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      regla_id INT NOT NULL,
      destinatario_tipo ENUM('votante','usuario','manual') NOT NULL,
      destinatario_id INT NOT NULL DEFAULT 0,
      ocurrencia VARCHAR(80) NOT NULL COMMENT 'Qué hecho dispara este envío: evento:12:2026-11-20T10:00, dia:2026-11-08…',
      canal ENUM('sms','push','email') NOT NULL,
      estado ENUM('reclamado','enviando','enviado','omitido','fallido','diferido') NOT NULL DEFAULT 'reclamado',
      motivo VARCHAR(250) NULL,
      intentos TINYINT UNSIGNED NOT NULL DEFAULT 0,
      segmentos TINYINT UNSIGNED NOT NULL DEFAULT 0,
      proveedor_id VARCHAR(128) NULL,
      debe_salir_en DATETIME NOT NULL COMMENT 'Cuándo tocaba',
      proximo_intento DATETIME NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reclamado_en DATETIME NULL,
      enviado_en DATETIME NULL,
      actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_rec_envio (regla_id, destinatario_tipo, destinatario_id, ocurrencia),
      KEY idx_rec_envio_estado (estado, proximo_intento),
      KEY idx_rec_envio_dia (canal, estado, enviado_en)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS recordatorio_tope_diario (
      fecha DATE NOT NULL PRIMARY KEY,
      segmentos_usados INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // Configuración de la campaña (una sola fila). Todo apagado o en su valor prudente de fábrica.
  await agregarColumnaSiFalta(connection, 'configuracion_campana',
    "recordatorios_activos TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Interruptor general de los recordatorios automáticos (apagado de fábrica)'", 'recordatorios_activos');
  await agregarColumnaSiFalta(connection, 'configuracion_campana',
    "fecha_permitida_propaganda DATE NULL COMMENT 'Desde esta fecha los automáticos pueden hablar de voto, elección, urnas, tarjetón o cargo. Vacía = nunca (precampaña)'", 'fecha_permitida_propaganda');
  await agregarColumnaSiFalta(connection, 'configuracion_campana',
    "tope_diario_sms_automaticos INT NOT NULL DEFAULT 200 COMMENT 'Segmentos de SMS automáticos por día; nunca más que el límite del libro central'", 'tope_diario_sms_automaticos');
  await agregarColumnaSiFalta(connection, 'configuracion_campana',
    "silencio_inicio TIME NOT NULL DEFAULT '20:00:00' COMMENT 'Desde esta hora no sale ningún automático (push, correo ni SMS)'", 'silencio_inicio');
  await agregarColumnaSiFalta(connection, 'configuracion_campana',
    "silencio_fin TIME NOT NULL DEFAULT '08:00:00' COMMENT 'Hasta esta hora no sale ningún automático'", 'silencio_fin');
  /* LAS REGLAS DE FÁBRICA, TODAS APAGADAS. «X horas antes» para eventos (24 h y 2 h, por aviso en la app para el equipo y por SMS o
     correo para los votantes asistentes) y las dos rondas del «¿ya votaste?» del Día D (14:00; la segunda es opcional). Se siembran
     con INSERT directo, sin pasar por el validador: el «¿ya votaste?» habla de voto por naturaleza y solo se puede ACTIVAR cuando
     `fecha_permitida_propaganda` ya llegó. Una regla que el administrador editó no se pisa (se busca por nombre). */
  const reglasDeFabrica = [
    ['evento', 'Evento · 24 h antes · SMS', 'sms', '{nombre}: te esperamos en {evento}, {fecha} {hora}, {lugar}.', null, -1440, null, 180],
    ['evento', 'Evento · 2 h antes · SMS', 'sms', '{nombre}: te esperamos en {evento}, {fecha} {hora}, {lugar}.', null, -120, null, 180],
    ['evento', 'Evento · 24 h antes · aviso en la app (equipo)', 'push', '{nombre}: te esperamos en {evento}, {fecha} {hora}, {lugar}.', 'Recordatorio de evento', -1440, null, 180],
    ['evento', 'Evento · 2 h antes · aviso en la app (equipo)', 'push', '{nombre}: te esperamos en {evento}, {fecha} {hora}, {lugar}.', 'Recordatorio de evento', -120, null, 180],
    ['evento', 'Evento · 24 h antes · correo', 'email', '{nombre}: te esperamos en {evento}, {fecha} {hora}, {lugar}.', 'Recordatorio: {evento}', -1440, null, 180],
    ['dia_d_ya_votaste', 'Día D · ¿ya votaste? · 1.ª ronda (14:00)', 'sms', '{nombre}, ¿ya votaste? Si ya lo hiciste, avísanos aquí: {enlace_ya_vote}', null, null, '14:00:00', 60],
    ['dia_d_ya_votaste', 'Día D · ¿ya votaste? · 2.ª ronda (15:00, opcional)', 'sms', '{nombre}, ¿ya votaste? Si ya lo hiciste, avísanos aquí: {enlace_ya_vote}', null, null, '15:00:00', 60],
  ];
  for (const [tipo, nombre, canal, plantilla, asunto, desfase, hora, gracia] of reglasDeFabrica) {
    await connection.query(
      `INSERT INTO recordatorio_reglas (tipo, nombre, canal, activo, plantilla, asunto, desfase_min, hora_dia, gracia_min)
       SELECT ?, ?, ?, 0, ?, ?, ?, ?, ? FROM DUAL
        WHERE NOT EXISTS (SELECT 1 FROM recordatorio_reglas WHERE nombre = ?)`,
      [tipo, nombre, canal, plantilla, asunto, desfase, hora, gracia, nombre]);
  }
  // El SMS de evento lleva ahora el enlace de baja (parche 302): la plantilla de fábrica se acortó. Las reglas que el administrador NO
  // editó (texto idéntico al de fábrica anterior) pasan al texto nuevo; las que editó no se tocan.
  await connection.query(
    `UPDATE recordatorio_reglas SET plantilla = ? WHERE tipo = 'evento' AND plantilla = ?`,
    ['{nombre}: te esperamos en {evento}, {fecha} {hora}, {lugar}.', '{nombre}, te esperamos en {evento} el {fecha} a las {hora} en {lugar}.']);
  console.log('Tablas de los recordatorios automáticos listas (apagados).');

  /* ------------------------------------------------------------------------------------------------------------
     SOLICITUDES CIUDADANAS (parche 303). Necesidades del barrio o la vereda que los líderes registran en campo y la campaña sigue hasta
     cerrarlas. Apagado de fábrica: el módulo `solicitudes` solo lo ve el administrador.
       · solicitud_categorias  catálogo editable por el administrador.
       · solicitudes           UNA fila por necesidad. SIN vínculo a votantes: no hay votante_id, ni apoya_a, ni intención de voto.
                               El ciudadano es opcional y su nombre y teléfono solo se guardan si marcó la autorización.
       · solicitud_fotos       hasta 3 por solicitud; los archivos viven en uploads/solicitudes/ (que /uploads no sirve).
       · solicitud_historial   cada cambio de estado, de responsable o nota interna, con quién y cuándo.
     ------------------------------------------------------------------------------------------------------------ */
  await connection.query(`
    CREATE TABLE IF NOT EXISTS solicitud_categorias (
      id INT AUTO_INCREMENT PRIMARY KEY,
      clave VARCHAR(40) NOT NULL,
      nombre VARCHAR(80) NOT NULL,
      ayuda VARCHAR(255) NULL COMMENT 'Lo que se le dice a quien registra (p. ej. «cuenta la necesidad, no diagnósticos»)',
      orden SMALLINT NOT NULL DEFAULT 100,
      activa TINYINT(1) NOT NULL DEFAULT 1,
      creada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_solicitud_categoria_clave (clave)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS solicitudes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cliente_uuid CHAR(36) NOT NULL COMMENT 'Lo genera el celular al guardar (también sin señal): un reintento no duplica',
      categoria_id INT NOT NULL,
      descripcion TEXT NOT NULL,
      estado ENUM('registrada','en_revision','remitida','cerrada') NOT NULL DEFAULT 'registrada',
      territorio_id INT NULL COMMENT 'Barrio o vereda de la vista territorios; sin FK (en campañas ligadas al catálogo es una vista)',
      barrio_texto VARCHAR(120) NULL COMMENT 'Barrio o vereda tal como lo escribió quien registra',
      latitud DECIMAL(10,7) NULL,
      longitud DECIMAL(10,7) NULL,
      precision_m INT NULL,
      ciudadano_nombre VARCHAR(150) NULL,
      ciudadano_telefono VARCHAR(20) NULL,
      autoriza_datos TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Sin autorización NO se guarda nombre ni teléfono: la solicitud es anónima',
      autoriza_fecha DATETIME NULL,
      politica_version CHAR(16) NULL COMMENT 'Huella de la política que se le mostró (politica_versiones)',
      responsable_id INT NULL,
      entidad_remitida VARCHAR(150) NULL,
      remitida_en DATETIME NULL,
      cerrada_en DATETIME NULL,
      motivo_cierre VARCHAR(255) NULL,
      registrado_por INT NULL,
      lider_id INT NULL COMMENT 'Para el alcance: igual que votantes.lider_id',
      sublider_id INT NULL,
      rama_aspirante_id INT NULL,
      aspirante_id INT NOT NULL DEFAULT 0,
      anonimizada_en DATETIME NULL,
      creada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_solicitud_cliente_uuid (cliente_uuid),
      KEY idx_solicitud_estado (estado, creada_en),
      KEY idx_solicitud_categoria (categoria_id),
      KEY idx_solicitud_territorio (territorio_id),
      KEY idx_solicitud_responsable (responsable_id),
      KEY idx_solicitud_lider (lider_id),
      KEY idx_solicitud_rama (rama_aspirante_id),
      FOREIGN KEY (categoria_id) REFERENCES solicitud_categorias(id),
      FOREIGN KEY (responsable_id) REFERENCES usuarios(id) ON DELETE SET NULL,
      FOREIGN KEY (registrado_por) REFERENCES usuarios(id) ON DELETE SET NULL,
      FOREIGN KEY (lider_id) REFERENCES usuarios(id) ON DELETE SET NULL,
      FOREIGN KEY (sublider_id) REFERENCES usuarios(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS solicitud_fotos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      solicitud_id INT NOT NULL,
      orden TINYINT UNSIGNED NOT NULL,
      archivo VARCHAR(80) NOT NULL COMMENT 'Solo el nombre: el archivo vive en uploads/solicitudes/',
      ancho INT NULL,
      alto INT NULL,
      bytes INT NULL,
      creada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_solicitud_foto_orden (solicitud_id, orden),
      FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS solicitud_historial (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      solicitud_id INT NOT NULL,
      tipo ENUM('registro','estado','responsable','nota','categoria','anonimizada') NOT NULL,
      estado_antes VARCHAR(20) NULL,
      estado_despues VARCHAR(20) NULL,
      responsable_antes INT NULL,
      responsable_despues INT NULL,
      entidad VARCHAR(150) NULL,
      nota VARCHAR(1000) NULL,
      usuario_id INT NULL,
      usuario_nombre VARCHAR(150) NULL COMMENT 'Copia del nombre: sobrevive al borrado de la cuenta',
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_solicitud_hist (solicitud_id, creado_en),
      FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  // Cuántos meses después de la fecha de la elección se anonimizan las solicitudes (scripts/anonimizar-solicitudes.js).
  await agregarColumnaSiFalta(connection, 'configuracion_campana',
    "anonimizar_solicitudes_meses INT NOT NULL DEFAULT 6 COMMENT 'Meses después de la elección en que scripts/anonimizar-solicitudes.js borra nombre, teléfono y fotos de las solicitudes'", 'anonimizar_solicitudes_meses');
  // Seguimiento (parche 304): a los cuántos días sin movimiento se avisa al responsable (el aviso lo manda el motor de recordatorios,
  // con su regla APAGADA de fábrica; ver lib/recordatoriosSolicitudes.js).
  await agregarColumnaSiFalta(connection, 'configuracion_campana',
    "solicitud_dias_sin_movimiento INT NOT NULL DEFAULT 15 COMMENT 'Días sin movimiento tras los cuales una solicitud con responsable genera el aviso de seguimiento'", 'solicitud_dias_sin_movimiento');
  // Las categorías de fábrica (el administrador las edita desde la pantalla; una que ya existe no se pisa).
  const categoriasDeFabrica = [
    ['vias', 'Vías', 10, null],
    ['agua', 'Agua', 20, null],
    ['luz', 'Luz', 30, null],
    ['empleo', 'Empleo', 40, null],
    ['salud', 'Salud', 50, 'Cuenta la necesidad (por ejemplo, «no hay un puesto de salud cerca»). No escribas diagnósticos ni nombres de personas.'],
    ['educacion', 'Educación', 60, null],
    ['seguridad', 'Seguridad', 70, 'Cuenta la necesidad del barrio (por ejemplo, «falta iluminación en la cancha»). No escribas denuncias con nombres ni datos de nadie.'],
    ['medio_ambiente', 'Medio ambiente', 80, null],
    ['otras', 'Otras', 90, null],
  ];
  for (const [clave, nombre, orden, ayuda] of categoriasDeFabrica) {
    await connection.query(
      `INSERT IGNORE INTO solicitud_categorias (clave, nombre, ayuda, orden) VALUES (?, ?, ?, ?)`, [clave, nombre, ayuda, orden]);
  }
  /* LA REGLA DE SEGUIMIENTO, APAGADA. Una fila en recordatorio_reglas para el tipo `solicitud_sin_movimiento` (aviso en la app, solo al
     responsable). Sigue los dos interruptores de siempre: el general de los recordatorios y el de la regla. Una regla que el administrador
     editó no se pisa (se busca por nombre). El texto no habla de voto, elección ni cargo: vale también en precampaña. */
  await connection.query(
    `INSERT INTO recordatorio_reglas (tipo, nombre, canal, activo, plantilla, asunto, desfase_min, hora_dia, gracia_min)
     SELECT 'solicitud_sin_movimiento', ?, 'push', 0, ?, ?, NULL, NULL, 1440 FROM DUAL
      WHERE NOT EXISTS (SELECT 1 FROM recordatorio_reglas WHERE nombre = ?)`,
    ['Solicitud ciudadana · sin movimiento · aviso en la app (responsable)',
     '{nombre}, la solicitud de {categoria} en {barrio} lleva {dias} días sin movimiento.', 'Solicitud sin movimiento',
     'Solicitud ciudadana · sin movimiento · aviso en la app (responsable)']);
  console.log('Tablas de las solicitudes ciudadanas listas (módulo apagado).');

  await sembrarPermisosPorDefecto(connection);
  await sembrarPoliticaPrivacidadPorDefecto(connection);
  await agregarFinalidadSolicitudes(connection);

  await connection.end();
  console.log('Listo.');
}
main().catch((err) => {
  console.error('Error inicializando la base de datos:', err);
  process.exit(1);
});
