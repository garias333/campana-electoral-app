#!/usr/bin/env node
// scripts/elevar-superadmin.js
//
// Otorga —o revoca— la categoría de SUPERADMINISTRADOR: la única cuenta con
// control total de la aplicación, invisible para el resto y de la que solo
// puede haber una.
//
// Uso:
//   node scripts/elevar-superadmin.js                       (el correo por omisión)
//   node scripts/elevar-superadmin.js otro@dominio.com      (el correo es OPCIONAL)
//   node scripts/elevar-superadmin.js [correo] --simular    (no escribe nada)
//   node scripts/elevar-superadmin.js --estado              (solo informa)
//   node scripts/elevar-superadmin.js [correo] --revocar
//
// El correo por omisión es SUPERADMIN_EMAIL (.env) o, si no está, el valor de
// config/superadminCorreo.js: el mismo con el que db/init-db.js crea la cuenta
// al instalar una campaña nueva. Este script es para las campañas que ya
// existían, o para mover la categoría a otra cuenta.
//
// ESTO NO SE HACE DESDE LA APLICACIÓN, Y ESA ES LA IDEA.
//
//   Ninguna ruta del servidor escribe `usuarios.es_superadmin`. Si un
//   administrador pudiera otorgarse la categoría desde alguna pantalla, la
//   categoría no valdría nada: sería un rol más, al alcance de quien ya
//   tiene la pantalla de Usuarios. Al vivir solo aquí, otorgarla exige
//   entrar al servidor — que es justo el nivel de acceso que corresponde.
//
// SE CORRE UNA VEZ POR INSTANCIA. Cada campaña tiene su propia base de
// datos, así que la elevación no viaja con los parches: hay que correrlo en
// cada instalación donde esta cuenta deba mandar.

require('dotenv').config();
const pool = require('../config/db');
const { olvidarCache, CORREO_SUPERADMIN } = require('../config/superadmin');

const args = process.argv.slice(2);
const simular = args.includes('--simular');
const revocar = args.includes('--revocar');
const soloEstado = args.includes('--estado');
const correoArg = args.find(a => !a.startsWith('--'));

// El valor por omisión es el mismo que usa init-db (config/superadmin.js lo
// exporta). Se dice cuál se usa: elevar una cuenta es una decisión, y no debe
// salir de un valor que nadie vio.
const correo = (correoArg || CORREO_SUPERADMIN).trim().toLowerCase();
if (!correoArg && !soloEstado) {
  console.log(`Sin correo en la línea de comandos: se usa el de por omisión, ${correo}.`);
  console.log('(Para otra cuenta:  node scripts/elevar-superadmin.js otro@dominio.com)\n');
}

/**
 * ¿La base ya tiene la columna?
 *
 * Se pregunta antes de nada para poder decir QUÉ correr, en vez de morir con
 * un ER_BAD_FIELD_ERROR que no le dice nada a quien está en la consola.
 */
async function baseMigrada() {
  const [filas] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios'
        AND COLUMN_NAME IN ('es_superadmin', 'superadmin_unico')`
  );
  const [indices] = await pool.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios'
        AND INDEX_NAME = 'uq_superadmin_unico'`
  );
  return { columnas: filas.length, indice: indices.length > 0 };
}

async function main() {
  const estructura = await baseMigrada();
  if (estructura.columnas < 2 || !estructura.indice) {
    console.error('La base todavía no tiene la estructura del superadministrador.');
    console.error(`  columnas encontradas: ${estructura.columnas} de 2`);
    console.error(`  índice uq_superadmin_unico: ${estructura.indice ? 'sí' : 'no'}`);
    console.error('');
    console.error('Córrala primero y vuelva:  npm run init-db');
    process.exitCode = 1;
    return;
  }

  const [[actual]] = await pool.query(
    `SELECT u.id, u.nombre, u.email, r.nombre AS rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.es_superadmin = 1 LIMIT 1`
  );

  console.log('Superadministrador actual: ' +
    (actual ? `${actual.nombre} <${actual.email}> (id ${actual.id})` : 'ninguno'));

  if (soloEstado) return;

  const [[objetivo]] = await pool.query(
    `SELECT u.id, u.nombre, u.email, u.activo, u.es_superadmin, r.nombre AS rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE LOWER(u.email) = ? LIMIT 1`,
    [correo]
  );

  if (!objetivo) {
    console.error(`\nNo hay ninguna cuenta con el correo ${correo} en esta base.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Cuenta objetivo:           ${objetivo.nombre} <${objetivo.email}> (id ${objetivo.id}, rol ${objetivo.rol}, ${objetivo.activo ? 'activa' : 'INACTIVA'})`);
  console.log('');

  if (revocar) {
    if (!objetivo.es_superadmin) {
      console.log('Esa cuenta no es superadministradora. No hay nada que revocar.');
      return;
    }
    if (simular) {
      console.log('[simulación] Se le quitaría la categoría. Seguiría siendo administradora.');
      return;
    }
    await pool.query(`UPDATE usuarios SET es_superadmin = 0 WHERE id = ?`, [objetivo.id]);
    olvidarCache();
    console.log('Categoría revocada. La cuenta sigue siendo administradora y vuelve a ser visible.');
    return;
  }

  if (objetivo.es_superadmin) {
    console.log('Esa cuenta YA es la superadministradora. Nada que hacer.');
    return;
  }

  // OTRO YA LA TIENE: no se le quita a nadie por sorpresa.
  //
  // El índice único de la base rechazaría el UPDATE de todos modos, pero con
  // un ER_DUP_ENTRY sobre una columna generada que no le dice nada a quien
  // está mirando la consola. Aquí se explica y se dice qué hacer.
  if (actual && actual.id !== objetivo.id) {
    console.error(`Ya hay una superadministradora: ${actual.nombre} <${actual.email}> (id ${actual.id}).`);
    console.error('Solo puede haber una. Si de verdad quiere mover la categoría, primero:');
    console.error(`  node scripts/elevar-superadmin.js ${actual.email} --revocar`);
    process.exitCode = 1;
    return;
  }

  if (!objetivo.activo) {
    console.error('Esa cuenta está INACTIVA. Actívela antes: una cuenta inactiva no puede entrar,');
    console.error('y una vez elevada nadie más va a poder activársela desde la aplicación.');
    process.exitCode = 1;
    return;
  }

  /* --------------------------------------------------------------------
     EL ROL SE ASEGURA AQUÍ, NO SE DA POR SUPUESTO.

     El superadministrador saca sus permisos del rol 'admin' —así hereda las
     más de cuarenta rutas que autorizan con requireRole('admin') sin tocar
     ninguna, ver config/superadmin.js—. La bandera por sí sola solo le da
     invisibilidad y protección.

     Elevar una cuenta que no fuera admin dejaría lo peor de los dos mundos:
     alguien invisible, intocable y SIN control total, y encima nadie podría
     arreglarlo desde la aplicación porque ya no vería la fila. Por eso el
     rol se corrige en la misma operación en vez de rechazarla, y se anuncia.
     -------------------------------------------------------------------- */
  const hayQueAjustarRol = objetivo.rol !== 'admin';
  if (hayQueAjustarRol) {
    console.log(`Ojo: la cuenta tiene rol "${objetivo.rol}". Se le pondrá "admin" en la misma`);
    console.log('operación — sin ese rol la categoría no daría control total, solo invisibilidad.');
  }

  if (simular) {
    console.log('[simulación] No se escribió nada. Se habría hecho:');
    console.log(`  UPDATE usuarios SET es_superadmin = 1${hayQueAjustarRol ? ", rol_id = (rol 'admin')" : ''} WHERE id = ${objetivo.id};`);
    return;
  }

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    if (hayQueAjustarRol) {
      const [[rolAdmin]] = await conexion.query(`SELECT id FROM roles WHERE nombre = 'admin'`);
      if (!rolAdmin) throw new Error('No existe el rol "admin" en esta base.');
      await conexion.query(`UPDATE usuarios SET rol_id = ? WHERE id = ?`, [rolAdmin.id, objetivo.id]);
    }
    await conexion.query(`UPDATE usuarios SET es_superadmin = 1 WHERE id = ?`, [objetivo.id]);
    await conexion.query(
      `INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, detalle, ip)
       VALUES (?, 'elevar_superadmin', 'usuarios', ?, ?, NULL)`,
      [objetivo.id, objetivo.id,
       `Se otorgó la categoría de superadministrador a ${objetivo.email} desde la consola del servidor.`]
    );
    await conexion.commit();
  } catch (err) {
    await conexion.rollback();
    throw err;
  } finally {
    conexion.release();
  }

  olvidarCache();
  console.log(`Listo. ${objetivo.nombre} <${objetivo.email}> es la superadministradora de esta instancia.`);
  console.log('');
  console.log('No hace falta reiniciar ni volver a iniciar sesión: la comprobación consulta la');
  console.log('base en cada petición (con 30 s de caché), así que vale desde ya.');
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Error:', err.message);
    pool.end();
    process.exit(1);
  });
