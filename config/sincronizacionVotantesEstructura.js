/**
 * Una misma persona puede existir a la vez en Estructura territorial
 * (Coordinador/Líder/Testigo/Sublíder) y en Votantes y sublíderes — están
 * unidas por el Número de identificación (cédula). Este módulo sincroniza
 * en las DOS direcciones los datos personales/de contacto que tiene
 * sentido compartir (teléfono, email, género, edad, Apoya a, Lugar de
 * votación, dirección de residencia): editar a alguien desde cualquiera
 * de las dos pantallas actualiza también su copia en la otra.
 *
 * Lo que NO se sincroniza a propósito: Categoría/Intención de voto (solo
 * existen en Votantes) y Cargo/Meta de votos/Supervisor/Zona de
 * responsabilidad (solo existen en Estructura territorial) — esos son
 * datos organizacionales que se manejan a propósito solo desde
 * Estructura territorial, para que editar a alguien como votante nunca
 * reasigne sin querer a quién reporta o de qué área responde.
 */

/**
 * Estructura territorial → Votantes: cada persona que se agrega o edita
 * en Estructura territorial también queda (o se actualiza) como registro
 * en Votantes y sublíderes — usando el Número de identificación como
 * llave para saber si ya existía uno (INSERT ... ON DUPLICATE KEY).
 * Sin Número de identificación no hay forma confiable de saber si ya
 * existía, así que en ese caso no se sincroniza nada (para no crear
 * duplicados sueltos cada vez que se guarda).
 */
const { ramaDeVotante } = require('../lib/ramas');

/**
 * Busca la ficha de Votante de ESTA MISMA persona cuando la cédula no
 * coincide.
 *
 * Es el caso que duplicaba gente: alguien ya registrado como votante con
 * su cédula, al que después se agrega a Estructura con la cédula mal
 * digitada (un dígito de diferencia). Como la llave es la cédula, el
 * `ON DUPLICATE KEY` no la reconocía y creaba una segunda ficha — la misma
 * persona aparecía dos veces en el listado, y nada avisaba.
 *
 * El cotejo exige que coincidan **nombre y teléfono a la vez**. Solo el
 * teléfono no basta: en una familia se comparte. Solo el nombre tampoco:
 * hay homónimos. Los dos juntos, en una misma campaña, es la misma
 * persona. La comparación del nombre la hace la colación de la base, que
 * ignora mayúsculas y tildes; la del teléfono se hace sobre los puros
 * dígitos, porque unos vienen con espacios y otros no.
 *
 * Devuelve la ficha solo si su cédula está vacía o es distinta: si ya
 * tuviera la misma, el INSERT normal la habría encontrado.
 */
async function buscarFichaDeLaMismaPersona(pool, cedula, nombre, telefono) {
  const soloDigitos = (telefono || '').replace(/\D/g, '');
  const nom = (nombre || '').trim();
  if (!soloDigitos || !nom) return null;
  const [[fila]] = await pool.query(
    `SELECT id, cedula FROM votantes
      WHERE TRIM(nombre) = ?
        AND REGEXP_REPLACE(COALESCE(telefono, ''), '[^0-9]', '') = ?
        AND (cedula IS NULL OR cedula = '' OR cedula <> ?)
      ORDER BY id LIMIT 1`,
    [nom, soloDigitos, cedula]
  );
  return fila || null;
}

async function sincronizarVotanteDesdeEstructura(pool, datos) {
  const cedula = (datos.numero_identificacion || '').trim();
  if (!cedula) return;
  try {
    // Si nadie tiene esta cédula pero sí existe la ficha de esta misma
    // persona con otra, se le corrige la cédula ANTES de insertar: así el
    // `ON DUPLICATE KEY` de abajo la encuentra y actualiza esa ficha en
    // vez de crear una nueva. Es seguro cambiarla porque acabamos de
    // comprobar que ninguna otra fila la tiene.
    const [[yaConEsaCedula]] = await pool.query(`SELECT id FROM votantes WHERE cedula = ?`, [cedula]);
    if (!yaConEsaCedula) {
      const equivalente = await buscarFichaDeLaMismaPersona(pool, cedula, datos.nombre, datos.telefono);
      if (equivalente) {
        await pool.query(`UPDATE votantes SET cedula = ? WHERE id = ?`, [cedula, equivalente.id]);
        console.log(`Votante ${equivalente.id}: se unificó la cédula (${equivalente.cedula || 'vacía'} -> ${cedula}) con la ficha de Estructura territorial, en vez de crear un registro duplicado.`);
      }
    }
    /* EL AREA SE DEDUCE DEL TERRITORIO, y hasta hoy no se escribia en absoluto:
       la columna `area` no aparecia en este INSERT. Resultado: quien llegaba a
       Votantes desde la Estructura tenia su comuna y su barrio pero la columna
       AREA en blanco, y el filtro «Todas las areas» no lo encontraba nunca.

       Se deduce en vez de copiarse de `estructura.area` porque el dato que no
       miente es el territorio: si es un barrio o una comuna es urbano, y si es
       una vereda o un corregimiento es rural. Nadie escribe «Vereda La Cabaña»
       queriendo decir que es urbano. */
    let areaDeducida = null;
    if (datos.territorio_id) {
      try {
        const [[t]] = await pool.query('SELECT tipo FROM territorios WHERE id = ?', [datos.territorio_id]);
        if (t) areaDeducida = ['vereda', 'corregimiento'].includes(t.tipo) ? 'rural'
                            : ['barrio', 'comuna'].includes(t.tipo) ? 'urbano' : null;
      } catch (_) { /* sin territorio legible se deja en null, como antes */ }
    }

    await pool.query(
      `INSERT INTO votantes
         (nombre, cedula, telefono, email, genero, edad, apoya_a,
          departamento_votacion, municipio_votacion, puesto_votacion, mesa_votacion,
          departamento_residencia, ciudad_residencia,
          comuna_corregimiento_residencia, barrio_residencia, direccion, territorio_id, area,
          categoria, created_by, origen, rama_aspirante_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'votante', ?, 'estructura', ?)
       ON DUPLICATE KEY UPDATE
         nombre = VALUES(nombre),
         telefono = VALUES(telefono), email = VALUES(email), genero = VALUES(genero), edad = VALUES(edad),
         apoya_a = VALUES(apoya_a),
         departamento_votacion = VALUES(departamento_votacion), municipio_votacion = VALUES(municipio_votacion),
         puesto_votacion = VALUES(puesto_votacion), mesa_votacion = VALUES(mesa_votacion),
         departamento_residencia = VALUES(departamento_residencia), ciudad_residencia = VALUES(ciudad_residencia),
         /* La comuna y el barrio de RESIDENCIA si se pisan al actualizar: son
            un dato de la persona, y la ficha de estructura es donde se edita.
            La rama del aspirante, mas abajo, es el caso contrario y esta
            explicado alli. (Sin acentos graves en este comentario: va DENTRO
            de una plantilla de JavaScript y la cortarian.) */
         comuna_corregimiento_residencia = VALUES(comuna_corregimiento_residencia),
         barrio_residencia = VALUES(barrio_residencia),
         direccion = VALUES(direccion), territorio_id = VALUES(territorio_id),
         area = VALUES(area)`,
      [
        (datos.nombre || '').trim(), cedula,
        datos.telefono ? datos.telefono.replace(/\D/g, '') : null,
        (datos.email || '').trim() ? datos.email.trim().toLowerCase() : null,
        datos.genero || 'prefiero_no_responder', datos.edad || null,
        JSON.stringify(Array.isArray(datos.apoya_a) ? datos.apoya_a : []),
        datos.departamento_votacion || null, datos.municipio_votacion || null,
        datos.puesto_votacion || null, datos.mesa_votacion || null,
        datos.departamento_residencia || null, datos.ciudad_residencia || null,
        datos.comuna_corregimiento_residencia || null, datos.barrio_residencia || null,
        datos.direccion || null, datos.territorio_id || null, areaDeducida,
        datos.creado_por || null,
        /* DE QUE RAMA CUELGA, al crear la ficha. Esta persona esta en la
           estructura, asi que su rama sale de subir por ahi — que es lo mismo
           que calcularia `recalcularTodas()`.

           VA SOLO EN EL `VALUES` Y NO EN EL `ON DUPLICATE KEY UPDATE`, a
           proposito: si la ficha ya existe puede tener una rama sacada de su
           `lider_id`, y pisarla con lo que da la cedula la borraria para todo
           el que no este en la estructura de ningun aspirante. Al crear no hay
           nada que perder; al actualizar si. */
        await ramaDeVotante(pool, { cedula })
      ]
    );
  } catch (err) {
    // No debe hacer fallar la creación/edición de la persona en
    // Estructura por un problema al sincronizar su copia en Votantes.
    console.error('Error sincronizando el registro de Estructura hacia Votantes:', err);
  }
}

/**
 * Votantes → Estructura territorial ("y viceversa"): si la persona
 * editada en Votantes y sublíderes también existe en Estructura
 * territorial (misma cédula), le actualiza ahí los mismos datos
 * personales/de contacto. Si esa cédula no pertenece a nadie en
 * Estructura, no hace nada (la mayoría de los votantes no lo son).
 */
async function sincronizarEstructuraDesdeVotante(pool, datos) {
  const cedula = (datos.cedula || '').trim();
  if (!cedula) return;
  try {
    const [[usuario]] = await pool.query(`SELECT id FROM usuarios WHERE numero_identificacion = ?`, [cedula]);
    if (!usuario) return;
    await pool.query(
      `UPDATE usuarios SET
         nombre = ?, telefono = ?, email = ?, genero = ?, edad = ?, apoya_a = ?,
         departamento_votacion = ?, municipio_votacion = ?, puesto_votacion = ?, mesa_votacion = ?,
         departamento_residencia = ?, ciudad_residencia = ?
       WHERE id = ?`,
      [
        (datos.nombre || '').trim() || null,
        datos.telefono ? datos.telefono.replace(/\D/g, '') : null,
        (datos.email || '').trim() ? datos.email.trim().toLowerCase() : null,
        datos.genero || 'prefiero_no_responder', datos.edad || null,
        JSON.stringify(Array.isArray(datos.apoya_a) ? datos.apoya_a : []),
        datos.departamento_votacion || null, datos.municipio_votacion || null,
        datos.puesto_votacion || null, datos.mesa_votacion || null,
        datos.departamento_residencia || null, datos.ciudad_residencia || null,
        usuario.id
      ]
    );
    // La Dirección vive en Estructura (no en usuarios) — se actualiza en
    // todas las filas de Estructura de esta persona (por si tiene más de
    // un cargo, ej. Líder y Testigo a la vez).
    await pool.query(`UPDATE estructura SET direccion = ? WHERE usuario_id = ?`, [datos.direccion || null, usuario.id]);
  } catch (err) {
    // No debe hacer fallar la creación/edición del votante por un
    // problema al sincronizar su copia en Estructura territorial.
    console.error('Error sincronizando el registro de Votantes hacia Estructura territorial:', err);
  }
}

/**
 * El Excel de Estructura no trae Lugar de votación ni Apoya a (esas
 * columnas no existen en ese formato) — antes de sincronizar hacia
 * Votantes se trae lo que esa persona ya tuviera guardado ahí (por
 * cédula) para pasarlo de vuelta tal cual, y así sincronizarVotanteDesdeEstructura
 * no lo borre por no venir en la fila del Excel.
 */
async function traerVotanteActualPorCedula(pool, cedula) {
  if (!cedula) return null;
  const [[fila]] = await pool.query(
    `SELECT apoya_a, departamento_votacion, municipio_votacion, puesto_votacion, mesa_votacion FROM votantes WHERE cedula = ?`,
    [cedula]
  );
  return fila || null;
}

module.exports = {
  sincronizarVotanteDesdeEstructura,
  sincronizarEstructuraDesdeVotante,
  traerVotanteActualPorCedula
};
