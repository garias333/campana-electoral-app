const pool = require('./db');
const { registrarErrorSinSql } = require('./erroresUsuarios');

/** Lo que cabe en `auditoria.detalle`, que es TEXT: 65.535 BYTES, no caracteres. */
const TOPE_DETALLE_BYTES = 65535;

/**
 * Recorta un texto para que quepa en `detalle`, contando BYTES.
 *
 * NO ES LO MISMO QUE `slice()`, Y LA DIFERENCIA ROMPE. `detalle` es TEXT y su
 * límite son 65.535 bytes; en utf8mb4 una tilde o una eñe ocupan dos, y un
 * emoji cuatro. Un `slice(0, 60000)` deja 60.000 caracteres que pueden pesar
 * 67.200 bytes — medido con los 2.551 testigos de Caldas, nombres del estilo
 * de «José Luis Ramírez Muñoz».
 *
 * Y pasarse NO trunca: este servidor corre con `STRICT_TRANS_TABLES`
 * —comprobado en la base—, así que MySQL responde ERROR 1406 y rechaza la
 * fila entera. Con la versión anterior de este archivo, ese error se tragaba
 * y el borrado seguía adelante: justo el fallo que todo esto venía a cerrar.
 *
 * Se corta en el límite de un carácter, nunca a mitad de uno: un byte suelto
 * de una eñe partida no es UTF-8 válido.
 */
function recortarABytes(texto, tope = TOPE_DETALLE_BYTES) {
  if (texto === null || texto === undefined) return null;
  const s = String(texto);
  if (Buffer.byteLength(s, 'utf8') <= tope) return s;
  const aviso = ' […recortado]';
  const disponible = tope - Buffer.byteLength(aviso, 'utf8');
  /* Cortar en un byte cualquiera puede partir un carácter por la mitad, y el
     decodificador dejaría ahí un U+FFFD. Se retrocede hasta el comienzo del
     carácter MIRANDO LOS BYTES, no re-descodificando: en UTF-8 los bytes de
     continuación son los que empiezan por 10xxxxxx, así que basta con
     saltarlos. Como mucho se retroceden tres. */
  const bytes = Buffer.from(s, 'utf8');
  let corte = disponible;
  while (corte > 0 && (bytes[corte] & 0xC0) === 0x80) corte -= 1;
  return bytes.subarray(0, corte).toString('utf8') + aviso;
}

/**
 * Registra una acción sensible en el log de auditoría (tabla `auditoria`).
 *
 * NO LANZA. Se llama desde acciones que ya ocurrieron y que no se pueden
 * deshacer —exportar un Excel, cambiar un logo—: que falle el apunte no puede
 * tumbar lo que ya pasó, y quien pulsó el botón no tiene forma de entender un
 * error de auditoría. Para los BORRADOS existe `registrarAuditoriaEn`, que se
 * comporta al revés y explica por qué.
 */
async function registrarAuditoria(usuarioId, accion, entidad, entidadId, detalle, ip) {
  try {
    await ejecutarApunte(pool, usuarioId, accion, entidad, entidadId, detalle, ip);
  } catch (err) {
    /* SIN LA SENTENCIA. `console.error(err)` a secas imprime el objeto entero
       de mysql2, y ahí viaja `err.sql` con los valores ya interpolados — o
       sea la cédula, el teléfono y el correo de la persona, en claro, en el
       log de PM2. Este repositorio ya cerró este mismo agujero una vez, cuando
       `err.sql` llevaba el `password_hash`; de ahí salió `registrarErrorSinSql`. */
    registrarErrorSinSql('Error registrando auditoría:', err);
  }
}

/**
 * El apunte de un BORRADO, escrito por la MISMA conexión que lo borra.
 *
 * ---------------------------------------------------------------------------
 * LANZA SI FALLA, Y ESA ES LA RAZÓN DE QUE EXISTA
 *
 * La primera versión de esta función se tragaba el error igual que su hermana,
 * razonando que un INSERT fallido no aborta la transacción de MySQL y que por
 * tanto no dejaba nada a medias. Lo primero es cierto; lo segundo, al revés de
 * como se leyó. Reproducido contra la base el 29 de agosto de 2026:
 *
 *     START TRANSACTION;
 *     INSERT INTO auditoria (...);   -- ERROR 1406, se traga
 *     DELETE FROM ...;               -- sigue adelante
 *     COMMIT;                        -- confirma
 *
 * Resultado: filas borradas, apuntes escritos CERO, respuesta 200. Que un
 * INSERT fallido no aborte la transacción es precisamente lo que hace peligroso
 * tragárselo: el borrado continúa. La transacción solo garantizaba una
 * dirección —el ROLLBACK sí se lleva el apunte— y hacía falta la otra.
 *
 * Lanzando, el `catch` del manejador hace ROLLBACK y responde 500. Se pierde
 * el borrado, que se puede repetir; no se pierde la constancia, que no.
 *
 * ---------------------------------------------------------------------------
 * SE ESCRIBE ANTES DE BORRAR
 *
 * Quien borra puede borrarse a sí mismo, y así el apunte queda escrito pase lo
 * que pase con la integridad referencial. Nota medida el 29 de agosto de 2026:
 * `db/schema.sql` declara para esta tabla una foránea contra `usuarios` con
 * `ON DELETE SET NULL`, pero NINGUNA de las tres bases desplegadas la tiene
 * —cero foráneas sobre `auditoria` en electoraldb y en las dos campañas—,
 * porque `CREATE TABLE IF NOT EXISTS` no añade restricciones a una tabla que
 * ya existe. Escribir antes de borrar es correcto con foránea y sin ella, y
 * por eso se hace así en vez de apoyarse en cuál de las dos toque.
 *
 * ---------------------------------------------------------------------------
 * EL ERROR QUE LANZA VA LIMPIO
 *
 * Se descarta el objeto de mysql2 y se levanta uno nuevo con el código y el
 * mensaje. Si se propagara el original, el `console.error(err)` del manejador
 * imprimiría `err.sql` con la cédula y el teléfono dentro — el mismo agujero
 * que `registrarErrorSinSql` cierra en la otra rama.
 */
async function registrarAuditoriaEn(ejecutor, usuarioId, accion, entidad, entidadId, detalle, ip) {
  try {
    await ejecutarApunte(ejecutor, usuarioId, accion, entidad, entidadId, detalle, ip);
  } catch (err) {
    registrarErrorSinSql('No se pudo escribir el apunte de auditoría — se deshace el borrado:', err);
    const limpio = new Error(`No se pudo dejar constancia del borrado (${err.code || 'error'}). No se borró nada.`);
    limpio.code = err.code;
    limpio.auditoria = true;
    throw limpio;
  }
}

/** El INSERT, común a las dos. `entidadId` se fuerza a entero o a NULL. */
async function ejecutarApunte(ejecutor, usuarioId, accion, entidad, entidadId, detalle, ip) {
  /* `Number.isInteger` y no `|| null`: un `Number('5abc')` da NaN, que es
     falsy, y el apunte quedaría con `entidad_id` NULL sin que nada avise —
     justo el dato por el que se busca un borrado cuando alguien pregunta. */
  const id = Number.isInteger(entidadId) ? entidadId
    : (Number.isInteger(Number(entidadId)) && entidadId !== null && entidadId !== '' ? Number(entidadId) : null);
  await ejecutor.query(
    `INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, detalle, ip) VALUES (?, ?, ?, ?, ?, ?)`,
    [usuarioId || null, accion, entidad || null, id, recortarABytes(detalle), ip || null]
  );
}

module.exports = { registrarAuditoria, registrarAuditoriaEn, recortarABytes, TOPE_DETALLE_BYTES };
