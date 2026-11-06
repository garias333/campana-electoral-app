const express = require('express');
const { usuariosDelAspiranteSql, subarbolSql } = require('../lib/ramas');
const { cargoDeLaMadre } = require('../config/cargoMadre');

/* EL ALCANCE DE CUENTAS DEL ASPIRANTE, en un solo sitio.
   Devuelve null para la campaña madre —sin acotar, como siempre— y el trozo de
   WHERE para el aspirante. Son ONCE rutas las que administran cuentas; que
   cada una arme su propia condición sería once oportunidades de que a una se
   le olvide, y el precio de olvidarse aquí es que un aspirante restablezca la
   contraseña de un líder de la alcaldía. */
async function alcanceCuentas(req) {
  if (!req.sublicencia) return null;
  return usuariosDelAspiranteSql(req.sublicencia.usuario_id, await cargoDeLaMadre());
}

/* ¿Puede este aspirante tocar ESTA cuenta? Se pregunta a la base, no se
   deduce: es la misma condición del listado, así que no pueden divergir. */
async function puedeAdministrar(req, usuarioId) {
  const alcance = await alcanceCuentas(req);
  if (!alcance) return !req.sublicencia;   // la madre sí; un aspirante sin cargo de madre, no
  const [[ok]] = await pool.query(
    `SELECT 1 AS ok FROM usuarios u WHERE u.id = ? AND ${alcance.sql} LIMIT 1`,
    [usuarioId, ...alcance.valores]
  );
  return !!ok;
}
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * Cuánto vive un código de acceso temporal.
 *
 * 48 horas es el margen para que alguien reciba el mensaje un viernes por la
 * noche y entre el domingo. Más allá de eso el código deja de ser una
 * comodidad y pasa a ser una puerta abierta: son cuatro dígitos, y con los 480
 * intentos diarios que permite el bloqueo por cuenta, treinta días de vigencia
 * dan un 76% de probabilidad de acertarlo. Con 48 horas queda por debajo del
 * 10%.
 */
const HORAS_VIGENCIA_CODIGO = 48;

/* QUE ROLES PUEDE REPARTIR CADA QUIEN. ESTO CERRABA UNA ESCALADA REAL.
 *
 * El rol pedido se validaba solo comprobando que EXISTIERA en la tabla
 * `roles`. Y 'admin' existe. Como estas dos rutas admiten al aspirante
 * -requireRole('admin','aspirante'), y middleware/auth.js las abre a
 * cualquiera con sublicencia-, un aspirante mandaba
 * POST /api/usuarios {rol:'admin', password:'la que el elija}, entraba con esa
 * cuenta y era ADMINISTRADOR DE LA CAMPANA MADRE: toda la base de votantes a
 * la vista, con cedula y telefono.
 *
 * El POST era ademas la unica ruta de escritura del fichero sin
 * `puedeAdministrar` -las otras siete lo tienen-, asi que no habia nada mas
 * entre esa peticion y la cuenta nueva.
 *
 * Y el PUT tenia la misma puerta un paso mas lejos: `puedeAdministrar` acota A
 * QUIEN se toca, no QUE ROL se le pone, asi que bastaba ascender a 'admin' a
 * alguien de su propia rama.
 *
 * La lista va por lo que cada uno necesita, no por lo que existe: un aspirante
 * arma su equipo -lideres, sublideres, votantes y testigos- y nada mas. Los
 * roles de la campana madre, y el que marca a un aspirante, son del
 * administrador. Se declara UNA vez para que las dos rutas no se separen.
 */
const ROLES_DEL_ASPIRANTE = ['lider', 'sublider', 'usuario', 'testigo'];

function rolPermitido(req, rol) {
  if (!req.sublicencia) return true;          // admin de la campana: sin cambios
  return ROLES_DEL_ASPIRANTE.includes(rol);
}
const { campoDuplicado, registrarErrorSinSql } = require('../config/erroresUsuarios');
const { verificarPasswordAdmin, validarTelefono10Digitos, verificarPasswordPropia } = require('../config/verificaciones');
const { registrarAuditoria, registrarAuditoriaEn } = require('../config/auditoria');
const smsSvc = require('../config/sms');
/*
 * SUPERADMINISTRADOR — ver config/superadmin.js para el porqué de todo esto.
 *
 * Aquí se aplica en dos formas, y las dos hacen falta:
 *
 *   `filtroOcultar` lo saca de los LISTADOS. Es lo que lo vuelve invisible
 *   en la pantalla de Usuarios y en los desplegables del resto de la
 *   aplicación.
 *
 *   `protegerObjetivo` blinda las rutas que reciben un `:id`, y no es
 *   redundante con lo anterior: esconder una fila no impide que alguien
 *   escriba el número a mano. Sin esta segunda mitad, un administrador que
 *   probara `DELETE /api/usuarios/1` borraría la cuenta que no puede ver.
 */
const { filtroOcultar, protegerObjetivo, protegerAutodestruccion, ERROR_2FA_OBLIGATORIO } = require('../config/superadmin');
router.use(requireAuth);

/**
 * Búsqueda por cédula EXACTA entre las cuentas del sistema (líderes,
 * coordinadores, testigos, etc.) — para el módulo de Asistentes a
 * reuniones: un asistente puede ser, además de un votante normal, un
 * líder o coordinador que solo existe como cuenta de usuario, sin fila
 * propia en Votantes (ej. si se creó desde Configuración → Usuarios en
 * vez de Estructura territorial). Solo trae lo mínimo (nombre y
 * teléfono, nada de email ni rol) para no exponer de más a quien esté
 * pasando lista.
 */
router.get('/buscar-por-cedula', async (req, res) => {
  const cedula = (req.query.cedula || '').trim();
  if (!cedula) return res.json(null);
  try {
    const ocultar = await filtroOcultar(req.session.usuario, 'usuarios');
    const [[fila]] = await pool.query(
      `SELECT id, nombre, telefono FROM usuarios
        WHERE numero_identificacion = ? ${ocultar} LIMIT 1`,
      [cedula]
    );
    res.json(fila || null);
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'Error buscando por número de identificación.' });
  }
});

// Listado liviano para poblar selects (líder responsable, supervisor, etc.)
// Solo usuarios activos.
//
// NO DEVUELVE EL CORREO, a propósito. Esta ruta la puede llamar CUALQUIER
// usuario con sesión —incluidos Invitado y Testigo—, porque las pantallas que
// la usan (Votantes, Territorial, Eventos) están abiertas a esos roles y
// necesitan la lista para armar sus desplegables. Devolver además el correo
// de todo el equipo era exponer datos de contacto a quien solo necesita
// nombres.
//
// Se comprobó que ninguno de los tres consumidores lo usaba: los tres leen
// únicamente id, nombre y rol. Por eso se quita el campo en vez de restringir
// la ruta por rol, que habría dejado sin desplegables a los Líderes.
router.get('/', async (req, res) => {
  const { rol } = req.query;
  const ocultar = await filtroOcultar(req.session.usuario);
  /* UN ASPIRANTE SOLO VE A SU GENTE, TAMBIÉN AQUÍ.
     Esta lista llena los desplegables de media aplicación, y el de «Reporta a»
     de Coordinadores y líderes entre ellos. Sin acotar, un aspirante que
     creaba un líder veía en ese desplegable a la campaña entera: medido el 30
     de agosto de 2026 en la campaña de prueba municipal, le llegaban las 62
     personas cuando su rama son 8 — 54 nombres que no son suyos.

     SE ACOTA CON `subarbolSql` Y NO CON `usuariosDelAspiranteSql`, que es el
     que usa el listado de administración de este mismo archivo. Son dos reglas
     distintas y está escrito así a propósito en lib/ramas.js: administrar una
     cuenta es de quien la tiene en exclusiva, así que de ahí se excluye a
     quien también apoya a la madre; VER a su propia gente incluye a todos los
     de su rama. Usar aquí la regla de administrar le escondería del
     desplegable a sus propios líderes que además apoyan a la Alcaldía.

     Comprobado antes de acotar: nadie de esa rama reporta hoy a alguien de
     fuera de ella, así que esto no le quita el jefe a ninguna ficha existente. */
  let alcanceRama = '';
  const params = rol ? [rol] : [];
  if (req.sublicencia) {
    const suyos = subarbolSql(req.sublicencia.usuario_id, 'u.id');
    alcanceRama = ` AND ${suyos.sql}`;
    params.push(...suyos.valores);
  }
  const whereSql = (rol ? 'WHERE r.nombre = ? AND u.activo = 1' : 'WHERE u.activo = 1') + ocultar + alcanceRama;
  try {
    /* QUIEN YA NO ESTÁ EN LA ESTRUCTURA NO SALE EN LOS DESPLEGABLES.
       Esta consulta miraba `usuarios.activo` y nada más, y son dos cosas
       distintas: dar de baja a alguien desde Coordinadores y líderes apaga su
       fila de `estructura` (`activo = 0` en el PUT de esa pantalla), NO su
       cuenta. La lista de la estructura filtra por `e.activo = 1` y esa persona
       desaparecía de ahí —para quien la dio de baja, «ya la eliminé»— pero
       seguía apareciendo en el desplegable de líderes de Votantes, donde
       todavía se le podían asignar personas.

       LA CONDICIÓN NO ES «TIENE FILA ACTIVA», ES «NO TIENE SOLO FILAS
       APAGADAS». Un administrador no tiene fila en `estructura` y tiene que
       seguir saliendo —es quien aparece como responsable de un evento—; con
       un `JOIN` a secas se habría caído de todos los desplegables de la
       aplicación. Se excluye únicamente a quien ESTUVO y ya no está. */
    const enEstructura = `AND (
        NOT EXISTS (SELECT 1 FROM estructura ex WHERE ex.usuario_id = u.id)
        OR EXISTS (SELECT 1 FROM estructura ex WHERE ex.usuario_id = u.id AND ex.activo = 1)
      )`;
    const [rows] = await pool.query(
      `SELECT u.id, u.nombre, r.nombre AS rol, u.territorio_id
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
       ${whereSql} ${enEstructura} ORDER BY u.nombre`, params
    );
    res.json(rows);
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'Error consultando los usuarios.' });
  }
});

// Listado completo para el panel de administración de Usuarios (Configuración).
// Incluye inactivos, y datos que no hacen falta en los selects livianos de arriba.
router.get('/admin', requireRole('admin', 'aspirante'), async (req, res) => {
  try {
    const alcance = await alcanceCuentas(req);
    // '' para el propio superadministrador —tiene que verse a sí mismo o no
    // podría administrar su cuenta—, y 'AND u.es_superadmin = 0' para
    // cualquier otro administrador. El contador de la pantalla («N de M
    // usuarios») sale de estas mismas filas, así que tampoco lo delata.
    const ocultar = await filtroOcultar(req.session.usuario);
    const [rows] = await pool.query(`
      SELECT u.id, u.nombre, u.numero_identificacion, u.nombre_usuario, u.email, u.telefono, u.credenciales_enviadas, r.nombre AS rol, u.activo, u.es_superadmin, u.telefono_soporte,
             u.debe_cambiar_password, u.two_factor_enabled, u.ultimo_login, u.created_at,
             -- MANDA EL TERRITORIO DE ESTRUCTURA. Antes era COALESCE(t.nombre, te.nombre),
             -- o sea la copia de usuarios primero, y esa copia solo se escribe al
             -- crear la cuenta: nadie la actualiza al editar, así que mostraba el
             -- territorio de cuando se dio de alta. La de usuarios queda solo para
             -- cuentas SIN fila de estructura (e.id IS NULL), que no tienen otra.
             -- (Sin comillas invertidas en este comentario: vive dentro de un
             -- template literal y una sola cerraría la cadena.)
             CASE WHEN e.id IS NOT NULL THEN te.nombre ELSE t.nombre END AS territorio_nombre
      FROM usuarios u
      JOIN roles r ON r.id = u.rol_id
      LEFT JOIN territorios t ON t.id = u.territorio_id
      -- "e.cargo = r.nombre" ata la fila de Estructura a la del cargo
      -- PRINCIPAL de la cuenta (u.rol_id): alguien con doble rol (ej. Líder
      -- y también Testigo electoral) tiene DOS filas en estructura para la
      -- misma cuenta — sin esta condición, el JOIN las traía ambas y la
      -- persona salía duplicada en este listado.
      LEFT JOIN estructura e ON e.usuario_id = u.id AND e.cargo = r.nombre
      LEFT JOIN territorios te ON te.id = e.territorio_id
      WHERE 1 = 1 ${ocultar}
      ${alcance ? 'AND ' + alcance.sql : ''}
      ORDER BY u.nombre
    `, alcance ? alcance.valores : []);
    res.json(rows);
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'Error obteniendo el listado de usuarios.' });
  }
});

// Lista de roles disponibles (para el selector de "Asignar roles y perfiles").
router.get('/roles', requireRole('admin', 'aspirante'), async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT id, nombre, descripcion FROM roles ORDER BY id`);
    res.json(rows);
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'Error obteniendo los roles.' });
  }
});

// Crea un usuario "suelto" (sin pasar por Estructura/Territorio) — para
// cuentas de administración, invitados, etc. Si no se indica una
// contraseña, se genera una temporal (igual que al crear alguien desde
// Agregar a la estructura); si el admin sí escribe una, se usa esa.
/**
 * Las cuatro acciones sobre una cuenta ajena se confirman con la contraseña
 * DE QUIEN LAS HACE: editar, restablecer la clave, quitar el 2FA y eliminar.
 *
 * Es `verificarPasswordPropia` y no `verificarPasswordAdmin` a propósito.
 * Aquel acepta la clave de CUALQUIER administrador activo, así que responde
 * «¿es usted un administrador?» — cosa que el rol de la ruta ya comprobó, y
 * que no confirma quién está al teclado. Este responde «¿es usted?», que es
 * la pregunta que cierra el caso real: una sesión abierta y sin dueño en un
 * computador de la sede.
 *
 * VA ANTES DE LA GUARDA DEL SUPERADMINISTRADOR, Y NO ES UN DETALLE DE ESTILO.
 *
 *   Al revés, quien no mandara contraseña recibiría 404 para el
 *   superadministrador y 403 para todos los demás — y esa diferencia es
 *   exactamente el rastro que la guarda existe para borrar. Con la
 *   contraseña primero, las dos respuestas son idénticas en los dos casos:
 *   sin clave o con clave equivocada, 403 para cualquier id; con la clave
 *   correcta, 404 tanto para el superadministrador como para un id que nunca
 *   existió.
 *
 *   Ya pasó una vez en este mismo archivo, medido: las rutas contestaban
 *   `200 {"ok":true}` para un id inexistente mientras el protegido daba 404,
 *   y ese contraste lo señalaba con el dedo.
 *
 * EL CAMPO SE LLAMA `password_confirmacion`, NO `password`.
 *
 *   En este archivo `password` ya significa otra cosa: la contraseña NUEVA
 *   que se le pone a la persona editada (formulario de Usuarios, campo
 *   opcional). Reusar el nombre habría hecho que al editar a alguien Y
 *   cambiarle la clave, la aplicación mandara la clave del OTRO como
 *   confirmación de quien edita.
 *
 *   Fallaría casi siempre, que es lo de menos. Lo grave es el caso en que
 *   NO falla: un administrador que le ponga a otro una contraseña igual a la
 *   suya quedaría confirmado sin haber confirmado nada.
 */
async function confirmarConSuPassword(req, res) {
  if (await verificarPasswordPropia(req.session.usuario.id, req.body && req.body.password_confirmacion)) return false;
  res.status(403).json({ error: 'Contraseña incorrecta. Escriba la suya para confirmar.' });
  return true;
}

router.post('/', requireRole('admin', 'aspirante'), async (req, res) => {
  const { nombre, numero_identificacion, nombre_usuario, email, telefono, rol, password } = req.body;
  if (!nombre || !email || !rol) {
    return res.status(400).json({ error: 'Nombre, email y rol son obligatorios.' });
  }
  if (password && password.trim() && password.trim().length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  }
  if (!validarTelefono10Digitos(telefono)) {
    return res.status(400).json({ error: 'Error de digitación: el teléfono debe tener 10 dígitos.' });
  }
  try {
    if (!rolPermitido(req, rol)) {
      return res.status(403).json({ error: 'No puedes asignar ese rol. Tu campaña maneja líderes, sublíderes, votantes y testigos.' });
    }
    const [[rolFila]] = await pool.query(`SELECT id FROM roles WHERE nombre = ?`, [rol]);
    if (!rolFila) return res.status(400).json({ error: 'Rol no válido.' });

    const passwordElegidaPorAdmin = !!(password && password.trim());
    const passwordFinal = passwordElegidaPorAdmin ? password.trim() : Math.random().toString(36).slice(-10);
    const hash = await bcrypt.hash(passwordFinal, 12);

    const [result] = await pool.query(
      `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, password_hash, rol_id, telefono, debe_cambiar_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      // Vacio con cedula a la mano: la cedula. Es lo que promete el campo del
      // formulario, y guardar NULL dejaba a la persona sin con que entrar
      // salvo por su correo — que un lider no suele tener.
      [nombre, (numero_identificacion || '').trim() || null,
       (nombre_usuario || '').trim() || (numero_identificacion || '').trim() || null,
       email.trim().toLowerCase(), hash, rolFila.id, telefono ? telefono.replace(/\D/g, '') : null]
    );
    res.json({
      ok: true,
      id: result.insertId,
      // Si el admin escribió la contraseña, no hace falta mostrársela de vuelta.
      password_temporal: passwordElegidaPorAdmin ? null : passwordFinal
    });
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    const msg = err.code === 'ER_DUP_ENTRY'
      ? campoDuplicado(err)
      : 'Error creando el usuario.';
    res.status(400).json({ error: msg });
  }
});

// Edita nombre/email/teléfono/rol/estado de un usuario existente.
router.put('/:id', requireRole('admin', 'aspirante'), async (req, res) => {
  /* El aspirante solo sobre las cuentas de SU equipo. Sin esta línea, abrirle
     la pestaña le daría la administración de toda la campaña madre. */
  if (req.sublicencia && !(await puedeAdministrar(req, req.params.id))) {
    return res.status(403).json({ error: 'Esa cuenta pertenece a la campaña principal.' });
  }

  if (await confirmarConSuPassword(req, res)) return;
  // VA ANTES DE VALIDAR, no después: la comprobación tiene que ser lo
  // primero que decide, para que la respuesta no dependa de qué traía el
  // formulario. Cubre de paso el cambio de rol —nadie le quita el admin al
  // superadministrador— y el de contraseña.
  if (await protegerObjetivo(req, res, req.params.id)) return;
  const { nombre, numero_identificacion, nombre_usuario, email, telefono, rol, activo, password, telefono_soporte } = req.body;
  /* `telefono_soporte` SOLO EXISTE PARA EL SUPERADMINISTRADOR, y se comprueba
     aunque el formulario no lo muestre a nadie más: un campo que la pantalla
     esconde sigue siendo un campo que se puede mandar a mano. */
  if (telefono_soporte !== undefined && !validarTelefono10Digitos(telefono_soporte)) {
    return res.status(400).json({ error: 'Error de digitación: el teléfono de soporte debe tener 10 dígitos.' });
  }
  if (!nombre || !email || !rol) {
    return res.status(400).json({ error: 'Nombre, email y rol son obligatorios.' });
  }
  if (password && password.trim() && password.trim().length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  }
  if (!validarTelefono10Digitos(telefono)) {
    return res.status(400).json({ error: 'Error de digitación: el teléfono debe tener 10 dígitos.' });
  }
  try {
    if (!rolPermitido(req, rol)) {
      return res.status(403).json({ error: 'No puedes asignar ese rol. Tu campaña maneja líderes, sublíderes, votantes y testigos.' });
    }
    const [[rolFila]] = await pool.query(`SELECT id FROM roles WHERE nombre = ?`, [rol]);
    if (!rolFila) return res.status(400).json({ error: 'Rol no válido.' });

    // Este formulario también trae la casilla de Activo: sin esto, el
    // superadministrador podría desactivarse desde la pantalla de edición
    // aunque el botón de estado se lo impida.
    if (!activo && await protegerAutodestruccion(req, res, req.params.id)) return;

    /* --------------------------------------------------------------------
       EL NOMBRE DE USUARIO SIGUE A LA CÉDULA CUANDO ERA LA CÉDULA

       Con qué se entra es `nombre_usuario`, no `numero_identificacion`. Al
       cambiarle la cédula a alguien, el usuario se quedaba con la vieja: la
       persona seguía entrando con el número anterior, y el mensaje de
       WhatsApp le mandaba ese, que era correcto pero no era el que el
       administrador acababa de escribir. Nadie daba error; simplemente los
       dos números dejaban de ser el mismo.

       Solo se re-sincroniza si el usuario ERA la cédula. Si el administrador
       le puso a propósito otro nombre de usuario, no se le toca — pisarlo
       seria decidir por él, y dejaria a esa persona sin poder entrar.
       -------------------------------------------------------------------- */
    const [[antes]] = await pool.query(
      `SELECT numero_identificacion, nombre_usuario FROM usuarios WHERE id = ?`, [req.params.id]);
    /* ------------------------------------------------------------------
       UN ID QUE NO EXISTE TIENE QUE RESPONDER 404, NO «ok».

       Es un defecto por su cuenta —la ruta contestaba `{ok:true}` sin haber
       tocado ninguna fila, y quien la llamara se quedaba creyendo que el
       cambio se hizo—, pero además es lo que sostiene que el
       superadministrador sea indetectable.

       La guarda de arriba responde 404 para esa cuenta. Si todo lo demás
       contestara 200, ese 404 sería justo la señal que se quería evitar:
       recorriendo ids, el único que responde distinto es el que existe y
       está protegido. Sirve de escondite que el resto conteste igual.

       Medido antes de arreglarlo: PUT, PUT/estado, restablecer-password y
       DELETE sobre el id 9999 devolvían los cuatro 200 {"ok":true}, y
       restablecer-password llegaba a inventar y devolver una contraseña
       temporal para una cuenta inexistente.
       ------------------------------------------------------------------ */
    if (!antes) return res.status(404).json({ error: 'Ese usuario ya no existe.' });
    const cedula = (numero_identificacion || '').trim();
    let usuarioFinal = (nombre_usuario || '').trim();

    // Vacío con cédula a la mano: es lo que promete el propio campo del
    // formulario («Se autocompleta con el Número de identificación»), y hasta
    // hoy no lo cumplía — se guardaba NULL y la persona quedaba sin con qué
    // entrar, salvo por su correo.
    if (!usuarioFinal && cedula) usuarioFinal = cedula;

    if (antes && cedula && antes.nombre_usuario
        && antes.nombre_usuario === antes.numero_identificacion
        && usuarioFinal === antes.nombre_usuario) {
      usuarioFinal = cedula;
    }
    const usuarioParaGuardar = usuarioFinal || null;

    if (password && password.trim()) {
      // Se escribió una contraseña nueva: se actualiza y se obliga a
      // cambiarla en el próximo inicio de sesión (igual que al crear).
      const hash = await bcrypt.hash(password.trim(), 12);
      await pool.query(
        `UPDATE usuarios SET nombre = ?, numero_identificacion = ?, nombre_usuario = ?, email = ?, telefono = ?,
         rol_id = ?, activo = ?, password_hash = ?, debe_cambiar_password = 1 WHERE id = ?`,
        [nombre, cedula || null, usuarioParaGuardar,
         email.trim().toLowerCase(), telefono ? telefono.replace(/\D/g, '') : null, rolFila.id, activo ? 1 : 0, hash, req.params.id]
      );
    } else {
      // Sin contraseña nueva: se deja la que ya tenía, sin tocarla.
      await pool.query(
        `UPDATE usuarios SET nombre = ?, numero_identificacion = ?, nombre_usuario = ?, email = ?, telefono = ?, rol_id = ?, activo = ? WHERE id = ?`,
        [nombre, cedula || null, usuarioParaGuardar,
         email.trim().toLowerCase(), telefono ? telefono.replace(/\D/g, '') : null, rolFila.id, activo ? 1 : 0, req.params.id]
      );
    }

    /* EL TELEFONO DE SOPORTE VA EN SU PROPIO UPDATE, y no dentro de los dos de
       arriba —uno con contraseña y otro sin ella—: meterlo en ambos es la clase
       de duplicado que se separa el día que alguien toque uno solo.

       El `AND es_superadmin = 1` es la guarda de verdad. Un `if` en JavaScript
       también habría servido hoy, pero la condición vive donde vive el dato: si
       mañana otra ruta reusa esta consulta, no puede escribir el número de
       soporte en la fila de nadie más. `undefined` significa «el formulario no
       traía el campo», que no es lo mismo que «lo dejaron vacío». */
    if (telefono_soporte !== undefined) {
      await pool.query(
        `UPDATE usuarios SET telefono_soporte = ? WHERE id = ? AND es_superadmin = 1`,
        [telefono_soporte ? String(telefono_soporte).replace(/\D/g, '') : null, req.params.id]);
    }
    res.json({ ok: true });
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    const msg = err.code === 'ER_DUP_ENTRY'
      ? campoDuplicado(err)
      : 'Error actualizando el usuario.';
    res.status(400).json({ error: msg });
  }
});

router.put('/:id/estado', requireRole('admin', 'aspirante'), async (req, res) => {
  /* El aspirante solo sobre las cuentas de SU equipo. Sin esta línea, abrirle
     la pestaña le daría la administración de toda la campaña madre. */
  if (req.sublicencia && !(await puedeAdministrar(req, req.params.id))) {
    return res.status(403).json({ error: 'Esa cuenta pertenece a la campaña principal.' });
  }

  if (await protegerObjetivo(req, res, req.params.id)) return;
  const { activo } = req.body;
  if (!activo && await protegerAutodestruccion(req, res, req.params.id)) return;
  try {
    // Se comprueba con un SELECT y no con `affectedRows`: MySQL cuenta ahí
    // las filas que CAMBIARON, así que poner «activo» en alguien que ya
    // estaba activo da cero y se leería como inexistente. Ver la nota del
    // PUT de arriba para por qué el 404 importa.
    const [[existe]] = await pool.query(`SELECT id FROM usuarios WHERE id = ?`, [req.params.id]);
    if (!existe) return res.status(404).json({ error: 'Ese usuario ya no existe.' });
    await pool.query(`UPDATE usuarios SET activo = ? WHERE id = ?`, [activo ? 1 : 0, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'Error actualizando el estado del usuario.' });
  }
});

// Restablece la contraseña de un usuario a una nueva temporal (por si la
// olvidó y no le llega el correo de recuperación, por ejemplo).
router.post('/:id/restablecer-password', requireRole('admin', 'aspirante'), async (req, res) => {
  /* El aspirante solo sobre las cuentas de SU equipo. Sin esta línea, abrirle
     la pestaña le daría la administración de toda la campaña madre. */
  if (req.sublicencia && !(await puedeAdministrar(req, req.params.id))) {
    return res.status(403).json({ error: 'Esa cuenta pertenece a la campaña principal.' });
  }

  if (await confirmarConSuPassword(req, res)) return;
  if (await protegerObjetivo(req, res, req.params.id)) return;
  try {
    // CÓDIGO DE 4 DÍGITOS, pedido para que se pueda dictar por teléfono y
    // teclear en un celular en campo sin equivocarse. Es una credencial de
    // un solo uso: `debe_cambiar_password = 1` obliga a cambiarla en el
    // primer ingreso, así que solo tiene que durar lo que tarde la persona
    // en entrar.
    //
    // `crypto.randomInt` y no `Math.random()`: con diez caracteres daba
    // igual, con cuatro dígitos no. `Math.random()` no es un generador
    // criptográfico y su estado se puede reconstruir observando unas pocas
    // salidas — es decir, quien vea un par de códigos podría anticipar los
    // siguientes. Es el mismo generador que ya usa el código 2FA.
    //
    // `padStart` importa: sin él, 42 saldría como "42" y no como "0042", y
    // uno de cada diez códigos tendría menos dígitos de los debidos.
    // LA CLAVE INICIAL ES LA CEDULA, y eso es una decision tomada a sabiendas.
    //
    // La cedula NO es un secreto: esta en el formulario de registro y la
    // conocen lideres y coordinadores. Quien sepa la de otro puede entrar con
    // su cuenta. Lo que lo hace aceptable son dos cosas, y las dos tienen que
    // seguir ahi: VENCE —ver password_temporal_expira, abajo— y obliga a
    // cambiarla en el primer ingreso. Es una llave para entrar una vez, no una
    // contraseña.
    //
    // A cambio, el dato no tiene que viajar: la persona ya lo sabe. Eso quita
    // de en medio el SMS del codigo, que hoy es justo lo que no esta llegando.
    //
    // Si no hay cedula registrada se cae al codigo aleatorio de antes: sin ese
    // respaldo, esta persona se quedaria sin ninguna forma de entrar.
    const [[quien]] = await pool.query(
      'SELECT numero_identificacion FROM usuarios WHERE id = ?', [req.params.id]);
    // Sin esto, un id inexistente recibía una contraseña temporal recién
    // inventada y un 200. Ver la nota del PUT de arriba.
    if (!quien) return res.status(404).json({ error: 'Ese usuario ya no existe.' });
    const cedula = quien && String(quien.numero_identificacion || '').trim();
    const passwordTemporal = cedula || String(crypto.randomInt(0, 10000)).padStart(4, '0');
    const esCedula = !!cedula;
    const hash = await bcrypt.hash(passwordTemporal, 12);
    // `credenciales_enviadas = NULL`: la clave que la persona tenga guardada
    // dejo de servir en este mismo instante, asi que la casilla de
    // "Credenciales enviadas" vuelve a estar en blanco. Sin esto, la tabla
    // seguiria diciendo que ya se le escribio y nadie se enteraria de que hay
    // que volver a hacerlo.
    const expira = new Date(Date.now() + HORAS_VIGENCIA_CODIGO * 60 * 60 * 1000);
    await pool.query(
      `UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 1, intentos_fallidos = 0,
              bloqueado_hasta = NULL, credenciales_enviadas = NULL, password_temporal_expira = ?
        WHERE id = ?`,
      [hash, expira, req.params.id]
    );

    // EL CÓDIGO VIAJA POR OTRO CANAL QUE EL ENLACE.
    //
    // El enlace de la aplicación no es un secreto —el dominio está publicado
    // en los registros de Certificate Transparency desde que se emitió su
    // certificado, y ahí no se puede borrar—. El código sí lo es. Mandarlos
    // juntos por WhatsApp significa que una sola captura reenviada lleva todo
    // lo necesario para entrar; separados, cada mensaje por su lado no sirve.
    //
    // La clave NUNCA sale del servidor por este camino: se genera aquí y se
    // manda desde aquí. El navegador solo recibe si salió o no.
    /* Y NO SE MANDA CUANDO LA CLAVE ES LA CÉDULA, que es el caso normal.
       Mandarle a alguien por SMS un número que se sabe de memoria no protege
       nada: gasta un crédito, llega un mensaje que no aporta, y deja la clave
       escrita en un aparato más. El razonamiento de arriba —separar el código
       del enlace— sigue valiendo entero para el otro caso: quien no tiene
       cédula registrada recibe un código de cuatro dígitos, y ése sí es un
       secreto que no puede viajar en el mismo WhatsApp que el enlace.

       La decisión se toma AQUÍ y no en el navegador porque es aquí donde se
       sabe cuál de los dos casos es: el front pide el envío sin saber qué
       contraseña se va a generar. */
    let sms = { enviado: false, motivo: null };
    if (esCedula) {
      sms.motivo = 'no hace falta: la contraseña es su número de cédula';
    } else if (req.body && req.body.enviar_sms) {
      const [[persona]] = await pool.query('SELECT nombre, telefono FROM usuarios WHERE id = ?', [req.params.id]);
      if (!persona || !persona.telefono) {
        sms.motivo = 'la persona no tiene teléfono registrado';
      } else {
        try {
          // `operativo: true`: es un mensaje de la aplicación a su propio
          // equipo, no propaganda, así que no lo detiene la lista de baja.
          await smsSvc.enviarSMS(
            persona.telefono,
            `Su codigo de acceso es ${passwordTemporal}. Vence en ${HORAS_VIGENCIA_CODIGO} horas.`,
            null,
            { origen: 'acceso', operativo: true, usuarioId: Number(req.params.id) }
          );
          sms.enviado = true;
        } catch (err) {
          sms.motivo = err.message || 'no se pudo enviar';
          console.warn('[credenciales] SMS no enviado:', sms.motivo);
        }
      }
    }

    res.json({
      ok: true,
      password_temporal: passwordTemporal,
      // Para que el mensaje de WhatsApp sepa QUE decir: si la clave es la
      // cedula, escribirla ahi seria mandar por escrito algo que la persona
      // ya sabe, y de paso dejarla en una captura reenviable.
      es_cedula: esCedula,
      expira_en: expira,
      horas_vigencia: HORAS_VIGENCIA_CODIGO,
      sms
    });
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'Error restableciendo la contraseña.' });
  }
});

/**
 * Le apaga la verificación en dos pasos a OTRA persona.
 *
 * POR QUÉ HACE FALTA. Hasta ahora `two_factor_enabled` solo se podía cambiar
 * desde la propia cuenta (PUT /auth/2fa, que escribe sobre
 * req.session.usuario.id). Es decir: a quien se le rompiera el correo con el
 * 2FA encendido quedaba fuera de su cuenta y NADIE dentro de la aplicación
 * podía sacarlo — había que entrar por base de datos.
 *
 * Eso convertía encender el 2FA en una puerta de un solo sentido, y era la
 * razón de no activarlo. Con este botón, un bloqueo se resuelve en dos clics.
 *
 * SOLO APAGA, NUNCA ENCIENDE. Encenderle el 2FA a otro le exigiría un correo
 * que quizá no revisa, y volveríamos al mismo problema desde el otro lado.
 * Activarlo sigue siendo decisión de cada quien, desde su propio panel.
 */
router.post('/:id/desactivar-2fa', requireRole('admin', 'aspirante'), async (req, res) => {
  /* El aspirante solo sobre las cuentas de SU equipo. Sin esta línea, abrirle
     la pestaña le daría la administración de toda la campaña madre. */
  if (req.sublicencia && !(await puedeAdministrar(req, req.params.id))) {
    return res.status(403).json({ error: 'Esa cuenta pertenece a la campaña principal.' });
  }

  if (await confirmarConSuPassword(req, res)) return;
  if (await protegerObjetivo(req, res, req.params.id)) return;
  try {
    const [[persona]] = await pool.query(
      'SELECT nombre, two_factor_enabled, es_superadmin FROM usuarios WHERE id = ?', [req.params.id]
    );
    if (!persona) return res.status(404).json({ error: 'Ese usuario ya no existe.' });
    /* Aquí solo llega el propio superadministrador: protegerObjetivo ya le
       respondió 404 a cualquier otro que apuntara a su id. Y a él tampoco se
       le apaga: entra siempre con código. */
    if (Number(persona.es_superadmin) === 1) {
      return res.status(400).json({ error: ERROR_2FA_OBLIGATORIO });
    }
    if (!persona.two_factor_enabled) {
      return res.json({ ok: true, ya_estaba: true, nombre: persona.nombre });
    }
    await pool.query('UPDATE usuarios SET two_factor_enabled = 0 WHERE id = ?', [req.params.id]);
    await registrarAuditoria(
      req.session.usuario.id, 'desactivar_2fa_ajeno', 'usuarios', req.params.id,
      `Un administrador le desactivó la verificación en dos pasos a ${persona.nombre}.`, req.ip
    );
    res.json({ ok: true, ya_estaba: false, nombre: persona.nombre });
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'No se pudo desactivar la verificación en dos pasos.' });
  }
});

/**
 * Deja constancia de que se le mandaron las credenciales a esta persona.
 *
 * Lo llama el botón de WhatsApp de Configuración → Usuarios DESPUÉS de abrir
 * la ventana del mensaje.
 *
 * LO QUE MARCA ES QUE EL MENSAJE SE ABRIÓ CON LOS DATOS PUESTOS, no que la
 * persona lo recibiera ni lo leyera: WhatsApp se abre en otra ventana, fuera
 * de esta aplicación, y desde aquí no hay forma de saber si el envío llegó a
 * completarse. Conviene que la casilla se entienda así y no como un acuse de
 * recibo.
 */
router.post('/:id/credenciales-enviadas', requireRole('admin', 'aspirante'), async (req, res) => {
  /* El aspirante solo sobre las cuentas de SU equipo. Sin esta línea, abrirle
     la pestaña le daría la administración de toda la campaña madre. */
  if (req.sublicencia && !(await puedeAdministrar(req, req.params.id))) {
    return res.status(403).json({ error: 'Esa cuenta pertenece a la campaña principal.' });
  }

  if (await protegerObjetivo(req, res, req.params.id)) return;
  try {
    const [r] = await pool.query(
      `UPDATE usuarios SET credenciales_enviadas = NOW() WHERE id = ?`, [req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Ese usuario ya no existe.' });
    const [[fila]] = await pool.query(
      `SELECT credenciales_enviadas FROM usuarios WHERE id = ?`, [req.params.id]
    );
    await registrarAuditoria(
      req.session.usuario.id, 'credenciales_enviadas', 'usuarios', req.params.id,
      'Se le enviaron por WhatsApp el enlace de la aplicación y sus datos de acceso.', req.ip
    );
    res.json({ ok: true, credenciales_enviadas: fila.credenciales_enviadas });
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'No se pudo dejar registrado el envío.' });
  }
});

// Eliminar un usuario también elimina en cascada su registro de Estructura
// si lo tenía (FK estructura.usuario_id ON DELETE CASCADE) — se advierte
// de esto en el frontend antes de confirmar.
/**
 * Acción administrativa en bloque: para todos los usuarios que YA tienen
 * Número de identificación guardado, copia ese número como su Nombre de
 * usuario (si no tenían uno) y como su contraseña — y los deja marcados
 * para cambiarla obligatoriamente en su próximo inicio de sesión. Piensa
 * en esto como un "restablecer contraseña" masivo usando la cédula como
 * valor de partida. Los usuarios sin Número de identificación se omiten
 * (no hay nada con qué sincronizarlos).
 */
router.post('/sincronizar-con-identificacion', requireRole('admin'), async (req, res) => {
  const { password } = req.body;
  const autorizado = await verificarPasswordAdmin(password);
  if (!autorizado) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }
  try {
    // EL SUPERADMINISTRADOR QUEDA FUERA DE ESTA ACCIÓN EN BLOQUE.
    //
    // Es un restablecimiento masivo de contraseñas: le pone a cada quien su
    // cédula como clave y lo obliga a cambiarla al entrar. Sin esta
    // exclusión, cualquier administrador dejaría al superadministrador con
    // una contraseña que ese administrador conoce —la cédula está a la vista
    // en media aplicación—, y sin verlo en ninguna pantalla. Es la vía por
    // la que se le tomaría la cuenta sin tocar nunca su fila.
    const [usuarios] = await pool.query(
      `SELECT id, numero_identificacion FROM usuarios
        WHERE numero_identificacion IS NOT NULL AND numero_identificacion != ''
          AND es_superadmin = 0`
    );

    let actualizados = 0;
    const fallidos = [];
    for (const u of usuarios) {
      try {
        const hash = await bcrypt.hash(u.numero_identificacion, 12);
        await pool.query(
          `UPDATE usuarios SET nombre_usuario = ?, password_hash = ?, debe_cambiar_password = 1 WHERE id = ?`,
          [u.numero_identificacion, hash, u.id]
        );
        actualizados++;
      } catch (err) {
        console.error(`Error sincronizando usuario id ${u.id}:`, err);
        fallidos.push(u.id);
      }
    }

    res.json({ ok: true, total: usuarios.length, actualizados, fallidos: fallidos.length });
  } catch (err) {
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'Error sincronizando usuarios con su Número de identificación.' });
  }
});

/**
 * El texto del apunte al borrar una cuenta. Se basta solo: después del
 * `DELETE` no queda fila de `usuarios` que consultar, y el identificador
 * numérico se escribe porque otras tablas lo siguen guardando —
 * `votantes.rama_aspirante_id` es la que permitió reconstruir a un aspirante
 * borrado por error el 29 de agosto de 2026.
 */
function descripcionDeCuentaBorrada(u) {
  const quedan = [];
  if (u.a_su_cargo > 0)     quedan.push(`${u.a_su_cargo} ${u.a_su_cargo === 1 ? 'persona quedó' : 'personas quedaron'} sin quién ${u.a_su_cargo === 1 ? 'la' : 'las'} coordine`);
  if (u.votantes_suyos > 0) quedan.push(`${u.votantes_suyos} ${u.votantes_suyos === 1 ? 'votante quedó' : 'votantes quedaron'} sin líder`);
  if (u.reportes > 0)       quedan.push(`se ${u.reportes === 1 ? 'borró' : 'borraron'} ${u.reportes} ${u.reportes === 1 ? 'reporte' : 'reportes'} del Día D`);
  const cola = quedan.length
    ? ` ${quedan.slice(0, -1).join(', ')}${quedan.length > 1 ? ' y ' : ''}${quedan[quedan.length - 1]}.`
    : '';
  return `Eliminó la cuenta de ${u.nombre || 'un usuario sin nombre'}`
    + (u.numero_identificacion ? ` (cédula ${u.numero_identificacion})` : '')
    + `, con rol ${u.rol || 'sin rol'}`
    + (u.tipo_cargo === 'aspirante_concejo' ? ' — aspirante al Concejo' : '')
    + (u.cargo_estructura ? `, y con ella su ficha de la Estructura.` : '.')
    + ` El identificador de usuario era ${u.id}`
    + (u.email ? `, el correo ${u.email}.` : '.')
    + cola;
}

router.delete('/:id', requireRole('admin', 'aspirante'), async (req, res) => {
  /* El aspirante solo sobre las cuentas de SU equipo. Sin esta línea, abrirle
     la pestaña le daría la administración de toda la campaña madre. */
  if (req.sublicencia && !(await puedeAdministrar(req, req.params.id))) {
    return res.status(403).json({ error: 'Esa cuenta pertenece a la campaña principal.' });
  }

  if (await confirmarConSuPassword(req, res)) return;
  if (await protegerObjetivo(req, res, req.params.id)) return;
  if (await protegerAutodestruccion(req, res, req.params.id)) return;
  /* QUEDA CONSTANCIA. Esta ruta borra una CUENTA, con todo lo que cuelga de
     ella: su ficha de estructura, sus reportes del Día D, su sublicencia si
     era aspirante y las opiniones que tuviera registradas. Nada de eso vuelve.

     Se lee antes del `DELETE` porque después no hay dónde, y se apunta dentro
     de la transacción para que el registro valga exactamente lo mismo que el
     borrado — ni un apunte de algo que no pasó, ni un borrado sin apunte.

     LO QUE SE CUENTA NO ES ADORNO. Al irse una cuenta, su equipo NO se borra:
     la foránea de `supervisor_id` lo deja sin nadie encima, y los votantes que
     esa persona registró pierden su `lider_id`, los dos en silencio. Dicho en
     el apunte, se sabe a quién hay que reasignar sin tener que buscarlo. */
  /* LA CONEXIÓN SE PIDE DENTRO DEL `try`. Fuera, si el pool está agotado o
     MySQL no responde, la promesa se rechaza donde no la ve ningún `catch`:
     Express 4 no envuelve los manejadores `async`, así que muere en el
     `unhandledRejection` de app.js, que solo la imprime. No se envía NINGUNA
     respuesta y el botón se queda girando hasta que corte Nginx. Antes de
     este cambio la consulta iba dentro del try y una base caída salía como un
     500 legible; había que conservarlo. */
  let conexion;
  try {
    conexion = await pool.getConnection();
    await conexion.beginTransaction();
    const [[ficha]] = await conexion.query(
      `SELECT u.id, u.nombre, u.numero_identificacion, u.email, u.tipo_cargo,
              r.nombre AS rol, e.cargo AS cargo_estructura,
              (SELECT COUNT(*) FROM estructura h WHERE h.supervisor_id = u.id)  AS a_su_cargo,
              (SELECT COUNT(*) FROM votantes v  WHERE v.lider_id = u.id)        AS votantes_suyos,
              (SELECT COUNT(*) FROM dia_d_reportes d WHERE d.testigo_id = u.id) AS reportes
         FROM usuarios u
         LEFT JOIN roles r      ON r.id = u.rol_id
         LEFT JOIN estructura e ON e.usuario_id = u.id
        WHERE u.id = ?`, [req.params.id]);
    if (!ficha) {
      await conexion.rollback();
      return res.status(404).json({ error: 'Ese usuario ya no existe.' });
    }

    await registrarAuditoriaEn(
      conexion, req.session.usuario.id, 'eliminar_persona', 'usuarios', ficha.id,
      descripcionDeCuentaBorrada(ficha), req.ip
    );

    // En un DELETE sí se puede confiar en `affectedRows`: cuenta filas
    // borradas, no filas que cambiaron de valor. Ver la nota del PUT.
    const [r] = await conexion.query(`DELETE FROM usuarios WHERE id = ?`, [req.params.id]);
    if (!r.affectedRows) {
      await conexion.rollback();
      return res.status(404).json({ error: 'Ese usuario ya no existe.' });
    }
    await conexion.commit();
    res.json({ ok: true });
  } catch (err) {
    /* El rollback va protegido: si lo que falló fue la conexión misma —MySQL
       reiniciado, `wait_timeout`, un KILL— también lanza, y sin esto el
       `res.status(500)` de abajo no llegaría a ejecutarse nunca. */
    if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
    registrarErrorSinSql('usuarios', err);
    res.status(500).json({ error: 'Error eliminando el usuario.' });
  } finally {
    if (conexion) conexion.release();
  }
});

module.exports = router;
