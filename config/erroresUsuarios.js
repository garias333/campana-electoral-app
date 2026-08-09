/**
 * Dos ayudantes para los errores de `usuarios`.
 *
 * Van en un archivo aparte a propósito: el parche que los instala tiene
 * que insertar UNA línea de `require` en vez de generar JavaScript con
 * comillas anidadas desde awk. Escribir código desde un script que a su
 * vez está entre comillas es como se cuelan los errores tontos — el 7 de
 * agosto de 2026 pasó dos veces en esta misma jornada.
 */

/**
 * De un ER_DUP_ENTRY, decir QUE campo chocó.
 *
 * EL PROBLEMA
 *   El mensaje de siempre nombra los tres campos a la vez —«ese email,
 *   número de identificación o nombre de usuario»— y quien lo lee no
 *   sabe cuál corregir. En el log del 7 de agosto de 2026 se ve el
 *   efecto: alguien cambió el CORREO tres veces seguidas cuando lo
 *   repetido era la CEDULA.
 *
 * MySQL sí lo dice, y no hay que adivinarlo:
 *   Duplicate entry '71185551' for key 'usuarios.numero_identificacion'
 *
 * Si algún día cambia ese formato, se cae al mensaje genérico de antes.
 * Nunca se queda sin responder.
 */
function campoDuplicado(err) {
  const m = /for key '(?:[^'.]+\.)?([^']+)'/.exec((err && err.sqlMessage) || '');
  switch (m && m[1]) {
    case 'email':
      return 'Ya existe otro usuario con ese correo.';
    case 'numero_identificacion':
      return 'Ya existe otro usuario con ese número de identificación.';
    case 'nombre_usuario':
      return 'Ya existe otro usuario con ese nombre de usuario.';
    default:
      return 'Ya existe un usuario con ese email, número de identificación o nombre de usuario.';
  }
}

/**
 * Registrar el error SIN la sentencia SQL.
 *
 * `console.error(err)` imprime el objeto entero de mysql2, y ahí va
 * `err.sql` con la consulta completa — que en la tabla `usuarios`
 * incluye `password_hash`. Quedaba en texto plano en el log de PM2, que
 * no está pensado para guardar secretos.
 *
 * Se conserva todo lo demás —código, mensaje y traza—: quitar el stack
 * para tapar el hash cambiaría un problema por otro, porque sin traza un
 * error que no sea de SQL se vuelve indepurable.
 */
function registrarErrorSinSql(contexto, err) {
  if (!err) { console.error(contexto, '(sin detalle)'); return; }
  console.error(contexto, err.code || '', err.sqlMessage || err.message || '');
  if (err.stack) console.error(err.stack);
}

module.exports = { campoDuplicado, registrarErrorSinSql };
