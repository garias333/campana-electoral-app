#!/usr/bin/env node
/**
 * ¿POR QUÉ ESTA PERSONA NO ENTRA COMO ASPIRANTE? Responde en un comando.
 *
 * Uso:
 *   node scripts/diagnosticar-aspirante.js campanadepruebamunicipal 1040100117
 *
 * SOLO LEE. No hay un solo INSERT, UPDATE ni DELETE en todo el archivo, y las
 * cuatro consultas son SELECT sobre `usuarios`, `roles`, `estructura` y
 * `sublicencias`. Se escribió porque la pregunta «¿es el dato o es el código?»
 * se estaba contestando a base de suponer, y cada suposición costaba una vuelta
 * entera.
 *
 * Las credenciales de la campaña se leen aquí dentro y NO se imprimen nunca.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const campana = process.argv[2];
const cedula = (process.argv[3] || '').replace(/\D/g, '');
if (!campana || !cedula) {
  console.error('Uso: node scripts/diagnosticar-aspirante.js <campana> <cedula>');
  console.error('Ej.: node scripts/diagnosticar-aspirante.js campanadepruebamunicipal 1040100117');
  process.exit(1);
}

const DIR = `/home/${campana}/htdocs/${campana}.appestrategia.net`;
if (!fs.existsSync(DIR)) { console.error(`No existe ${DIR}`); process.exit(1); }

function credenciales() {
  const texto = fs.readFileSync(path.join(DIR, '.env'), 'utf8');
  const leer = (clave) => {
    const m = texto.match(new RegExp('^' + clave + '\\s*=\\s*(.*)$', 'm'));
    if (!m) return null;
    return m[1].trim().replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');
  };
  return { host: leer('DB_HOST') || 'localhost', port: Number(leer('DB_PORT')) || 3306,
           user: leer('DB_USER'), password: leer('DB_PASSWORD'), database: leer('DB_NAME') };
}

const si = (v) => (v ? 'SÍ' : 'no');

(async () => {
  const c = await mysql.createConnection(credenciales());
  try {
    const [[u]] = await c.query(
      `SELECT u.id, u.nombre, u.email, u.telefono, u.nombre_usuario, u.tipo_cargo, u.activo,
              r.nombre AS rol
         FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id
        WHERE u.numero_identificacion = ? LIMIT 1`, [cedula]);

    console.log(`\nCampaña: ${campana}   ·   cédula ${cedula}\n`);
    if (!u) {
      console.log('  NO hay ninguna persona con esa cédula en esta campaña.');
      console.log('  Si la sublicencia se vendió con esta cédula, allá quedó en «sin persona»');
      console.log('  y nunca se creó nada aquí. Revise que la cédula del panel sea la de la ficha.');
      return;
    }

    console.log(`  ${u.nombre}${u.activo ? '' : '   (CUENTA INACTIVA)'}`);
    console.log(`    rol ............... ${u.rol || '(sin rol)'}`);
    console.log(`    tipo de cargo ..... ${u.tipo_cargo || '—'}`);
    console.log(`    nombre de usuario . ${u.nombre_usuario || '—'}`);
    console.log(`    correo ............ ${u.email || '(sin correo)'}`);
    console.log(`    teléfono .......... ${u.telefono || '(sin teléfono)'}`);

    const [estructura] = await c.query(
      `SELECT cargo, activo FROM estructura WHERE usuario_id = ?`, [u.id]);
    console.log(`    en la estructura .. ${estructura.length
      ? estructura.map(e => e.cargo + (e.activo ? '' : ' (inactiva)')).join(', ') : 'no aparece'}`);

    let sub = null;
    try {
      [[sub]] = await c.query(
        `SELECT activa, cargo, nombre, subtitulo, logo_url, marca_editada_en FROM sublicencias WHERE usuario_id = ? LIMIT 1`,
        [u.id]);
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE') console.log('\n  Esta campaña no tiene la tabla `sublicencias`.');
      else throw err;
    }

    console.log('\n  SUBLICENCIA');
    if (!sub) {
      console.log('    NO tiene fila. Sin ella no hay panel de aspirante: su nombre, su lema y');
      console.log('    su logo viven ahí. Créela en licencias con ESTA cédula y espere una');
      console.log('    validación (hasta 6 h, o aplique un parche para dispararla).');
    } else {
      console.log(`    activa ............ ${si(sub.activa)}`);
      console.log(`    cargo ............. ${sub.cargo || '—'}`);
      console.log(`    su campaña ........ ${sub.nombre || '(hereda la de la madre)'}`);
      console.log(`    su lema ........... ${sub.subtitulo || '—'}`);
      console.log(`    su logo ........... ${sub.logo_url ? 'sí' : 'no'}`);
      /* MARCA EDITADA: importa al recrear una sublicencia. Desde que el
         aspirante toca su nombre o su lema, la sincronizacion deja de pisarlos
         — asi que una sublicencia NUEVA para la misma persona heredaria estos
         textos viejos en vez de los que se escriban al venderla. */
      console.log(`    marca tocada por él  ${sub.marca_editada_en
        ? 'SÍ (' + String(sub.marca_editada_en).slice(0, 19) + ') — una sublicencia nueva NO pisaría estos textos'
        : 'no — una sublicencia nueva traería sus propios textos'}`);
    }

    /* SU RAMA: que votantes lo tienen a el como aspirante. Es lo que decide
       tanto lo que EL ve como lo que la madre dejaria de ver el dia que se
       conecte `filtroMadre` (lib/ramas.js). */
    if (sub) {
      const [[rama]] = await c.query(
        `SELECT COUNT(*) AS total,
                SUM(JSON_CONTAINS(v.apoya_a, '"alcaldia"')) AS apoyan_alcaldia
           FROM votantes v WHERE v.rama_aspirante_id = ?`, [u.id]);
      const [[sueltos]] = await c.query(
        `SELECT COUNT(*) AS total FROM votante_ramas WHERE aspirante_id = ? AND excluido = 0`, [u.id]);
      console.log('\n  SU RAMA DE VOTANTES');
      console.log(`    por cadena de mando ... ${rama.total}`);
      console.log(`    sumados a mano ........ ${sueltos.total}`);
      console.log(`    de esos, apoyan a la Alcaldía: ${Number(rama.apoyan_alcaldia || 0)}`);
      if (rama.total > 0) {
        console.log(`    -> los ${rama.total - Number(rama.apoyan_alcaldia || 0)} que NO la apoyan son los que`);
        console.log('       la campaña madre dejaría de ver cuando se conecte filtroMadre.');
      }
    }

    // El veredicto, con las mismas reglas que aplica auth.routes.js.
    const ROLES_CON_CODIGO = ['admin', 'coordinador', 'asistente_administrativo', 'aspirante_concejo'];
    const puedeCodigo = u.activo && ROLES_CON_CODIGO.includes(u.rol);
    const tieneDestino = !!(u.email || u.telefono);

    console.log('\n  ¿ENTRA COMO ASPIRANTE?');
    console.log(`    su rol puede pedir código ..... ${si(puedeCodigo)}${puedeCodigo ? '' : `   <- ${u.rol} no está en ROLES_CON_CODIGO`}`);
    console.log(`    tiene a dónde mandarlo ........ ${si(tieneDestino)}${tieneDestino ? '' : '   <- sin correo ni teléfono no hay a dónde'}`);
    console.log(`    sublicencia activa ............ ${si(sub && sub.activa)}`);
    console.log('');
    if (puedeCodigo && tieneDestino && sub && sub.activa) {
      console.log('    -> Todo está. Entrando por CORREO O CELULAR + CÓDIGO va a su panel.');
      console.log('       Con número de identificación y contraseña entra como líder, a la app:');
      console.log('       eso es lo correcto desde el parche 165, no un fallo.');
    } else {
      console.log('    -> NO. Falta lo marcado arriba con «no».');
    }
  } finally {
    await c.end();
  }
})().catch((err) => { console.error('No se pudo consultar:', err.code || err.message); process.exit(1); });
