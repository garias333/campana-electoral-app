'use strict';
/**
 * DATOS DE EJEMPLO PARA LAS CAPTURAS DE LOS MANUALES (scripts/capturar-manuales.js).
 *
 * Todo es inventado: nombres de pila con apellido «Ejemplo/Muestra/Prueba», cédulas que empiezan por 9000 (rango que no se asigna a
 * nadie), teléfonos 300000xxxx y correos @ejemplo.co. NUNCA se lee ni se copia nada de una campaña real: esto corre sobre una base
 * `simulada…` recién inicializada con db/init-db.js.
 *
 * PRECAMPAÑA: no aparece ningún cargo de elección en ningún dato ni en la configuración (`cargo_aspira` queda NULL). La campaña se
 * llama «Campaña de ejemplo».
 */
const bcrypt = require('bcryptjs');

const HASH = bcrypt.hashSync('clave-ejemplo', 4);

async function sembrar(pool) {
  const q = async (sql, p) => (await pool.query(sql, p))[0];
  // La marca de «terminé» se escribe al final: una siembra que murió a medias NO se da por buena (hay que reinicializar la base).
  const [[ya]] = await pool.query("SELECT COUNT(*) n FROM configuracion_campana WHERE slogan_campana = 'Juntos por el barrio'");
  if (ya.n) return leerIds(pool);
  const [[previo]] = await pool.query("SELECT COUNT(*) n FROM usuarios WHERE nombre = 'Laura Muestra'");
  if (previo.n) throw new Error('La siembra anterior quedó a medias: reinicializa la base (db/init-db.js sobre una base nueva).');

  // ------------------------------------------------------------------------------------------------ la campaña
  await q('INSERT IGNORE INTO configuracion_campana (id) VALUES (1)');
  await q(`UPDATE configuracion_campana SET nombre_candidato = 'Campaña de ejemplo', cargo_aspira = NULL, slogan_campana = NULL,
    meta_votos_campana = 2400, partido_politico = NULL, departamento = 'Departamento de ejemplo', ciudad = 'Ciudad de ejemplo',
    ciudad_tiene_comunas = 1, usar_nombre_barrios = 1, fecha_eleccion = CURDATE(), direccion_sede = 'Calle 1 # 2-3, sede de ejemplo',
    telefono = '3000000000', email = 'sede@ejemplo.co', marca_titulo = 'Campaña de ejemplo', marca_subtitulo = '',
    jornada_apertura = '00:00', jornada_cierre = '23:59', transporte_alerta_desde = '00:00:00' WHERE id = 1`);
  await q("UPDATE usuarios SET nombre = 'Admin Ejemplo', email = 'admin@ejemplo.co', nombre_usuario = 'admin.ejemplo', numero_identificacion = '9000000001' WHERE id = 1");
  // (Los códigos de enlace y de conductor usan el alfabeto del sistema: sin I, L, O, 0 ni 1.)
  // El superadministrador de la plantilla no debe verse en los listados.
  await q("UPDATE usuarios SET nombre = 'Superadmin Ejemplo', email = 'super@ejemplo.co', nombre_usuario = 'super.ejemplo', numero_identificacion = '9000000002' WHERE id = 2");

  // ------------------------------------------------------------------------------------------------ territorios
  const terr = async (tipo, nombre, padre) => (await q('INSERT INTO territorios (tipo, nombre, padre_id) VALUES (?,?,?)', [tipo, nombre, padre || null])).insertId;
  const dep = await terr('departamento', 'Departamento de ejemplo');
  const mun = await terr('municipio', 'Ciudad de ejemplo', dep);
  const cNorte = await terr('comuna', 'Comuna Norte', mun);
  const cCentro = await terr('comuna', 'Comuna Centro', mun);
  const corSur = await terr('corregimiento', 'Corregimiento Sur', mun);
  const bEjemplos = await terr('barrio', 'Barrio Los Ejemplos', cNorte);
  const bMuestra = await terr('barrio', 'Barrio La Muestra', cNorte);
  const bPlaza = await terr('barrio', 'Barrio Plaza Nueva', cCentro);
  const vVista = await terr('vereda', 'Vereda Buena Vista', corSur);

  // ------------------------------------------------------------------------------------------------ personas del equipo
  let n = 2;
  const persona = async (nombre, rol, extra) => {
    n++;
    const e = extra || {};
    const [r] = await pool.query(
      `INSERT INTO usuarios (nombre, numero_identificacion, nombre_usuario, email, telefono, password_hash, rol_id, activo, territorio_id,
                             barrio_residencia, comuna_corregimiento_residencia, ciudad_residencia, departamento_residencia)
       VALUES (?, ?, ?, ?, ?, ?, (SELECT id FROM roles WHERE nombre = ?), 1, ?, ?, ?, 'Ciudad de ejemplo', 'Departamento de ejemplo')`,
      [nombre, `9000000${String(n).padStart(3, '0')}`, `u900${n}`, `${nombre.split(' ')[0].toLowerCase()}@ejemplo.co`, `300000${String(n).padStart(4, '0')}`,
        HASH, rol, e.territorio || null, e.barrio || null, e.comuna || null]);
    return r.insertId;
  };
  const est = async (usuarioId, cargo, supervisor, meta, extra) => {
    const e = extra || {};
    await q('INSERT INTO estructura (usuario_id, cargo, supervisor_id, meta_votos, activo, territorio_id, puesto_id, puesto_votacion, mesa_votacion, tipo_testigo) VALUES (?,?,?,?,1,?,?,?,?,?)',
      [usuarioId, cargo, supervisor || null, meta || 0, e.territorio || null, e.puestoId || null, e.puesto || null, e.mesa || null, e.tipoTestigo || 'mesa']);
  };

  const coord = await persona('Carolina Ejemplo', 'coordinador', { territorio: cNorte });
  const lider = await persona('Laura Muestra', 'lider', { territorio: bEjemplos, barrio: 'Barrio Los Ejemplos', comuna: 'Comuna Norte' });
  const lider2 = await persona('Mateo Prueba', 'lider', { territorio: bPlaza, barrio: 'Barrio Plaza Nueva', comuna: 'Comuna Centro' });
  const sub = await persona('Sofía Ejemplo', 'sublider', { territorio: bEjemplos });
  const asist = await persona('Andrea Apoyo Ejemplo', 'asistente_administrativo');
  const testigo = await persona('Teresa Testigo Ejemplo', 'testigo');
  const testigo2 = await persona('Tomás Muestra', 'testigo');
  await est(coord, 'coordinador', null, 0, { territorio: cNorte });
  await est(lider, 'lider', coord, 120, { territorio: bEjemplos });
  await est(lider2, 'lider', coord, 90, { territorio: bPlaza });
  await est(sub, 'usuario', lider, 30, { territorio: bEjemplos });

  // ------------------------------------------------------------------------------------------------ puestos de votación
  const puestos = [];
  for (const [nombre, mesas] of [['I.E. Ejemplo Norte', 8], ['Colegio La Muestra', 5], ['Escuela Plaza Nueva', 6], ['Salón Comunal Buena Vista', 2]]) {
    puestos.push((await q('INSERT INTO dia_d_puestos_votacion (nombre, cantidad_mesas, aspirante_id) VALUES (?,?,0)', [nombre, mesas])).insertId);
  }
  await est(testigo, 'testigo', coord, 0, { puestoId: puestos[0], puesto: 'I.E. Ejemplo Norte', mesa: 1, tipoTestigo: 'mesa' });
  await est(testigo2, 'testigo', coord, 0, { puestoId: puestos[1], puesto: 'Colegio La Muestra', mesa: 2, tipoTestigo: 'mesa' });
  await q("UPDATE estructura SET mesas_asignadas = JSON_ARRAY(1,2) WHERE usuario_id = ?", [testigo]);
  await q('INSERT INTO dia_d_checkin (aspirante_id, usuario_id, puesto_id, fecha, origen) VALUES (0, ?, ?, CURDATE(), ?)', [testigo2, puestos[1], 'testigo']);
  for (const [i, nom] of ['Lista de ejemplo 1', 'Lista de ejemplo 2', 'Lista de ejemplo 3', 'Voto en blanco'].entries()) {
    await q("INSERT INTO dia_d_candidatos (nombre, orden, grupo, aspirante_id) VALUES (?,?,?,0)", [nom, i + 1, i < 3 ? 'candidato' : 'otros']);
  }

  // ------------------------------------------------------------------------------------------------ votantes
  const nombres = ['Ana', 'Beatriz', 'Camilo', 'Daniela', 'Esteban', 'Felipe', 'Gabriela', 'Hugo', 'Isabel', 'Julián', 'Karen', 'Lucía', 'Marcos', 'Natalia', 'Óscar',
    'Paola', 'Ricardo', 'Sandra', 'Tatiana', 'Víctor', 'Ximena', 'Yolanda', 'Zoe', 'Andrés', 'Bruno', 'Clara', 'Diego', 'Elena', 'Fabián', 'Gloria'];
  const apell = ['Ejemplo', 'Muestra', 'Prueba', 'Demo', 'Simulada'];
  const votantes = [];
  for (let i = 0; i < nombres.length; i++) {
    const dueno = i % 5 === 4 ? lider2 : lider;
    const puesto = puestos[i % 3];
    const nombrePuesto = ['I.E. Ejemplo Norte', 'Colegio La Muestra', 'Escuela Plaza Nueva'][i % 3];
    const barrio = [bEjemplos, bMuestra, bPlaza][i % 3];
    const nomBarrio = ['Barrio Los Ejemplos', 'Barrio La Muestra', 'Barrio Plaza Nueva'][i % 3];
    const [r] = await pool.query(
      `INSERT INTO votantes (categoria, nombre, cedula, telefono, email, genero, edad, territorio_id, direccion, ciudad_residencia, departamento_residencia,
          comuna_corregimiento_residencia, barrio_residencia, area, lider_id, sublider_id, puesto_votacion, puesto_id, mesa_votacion, consentimiento_autorizado,
          consentimiento_sms, consentimiento_whatsapp, consentimiento_email, consentimiento_fecha, consentimiento_confirmado_en, consentimiento_confirmado_canal,
          datos_verificados, origen, created_by, created_at, latitud, longitud)
       VALUES ('votante', ?, ?, ?, ?, ?, ?, ?, ?, 'Ciudad de ejemplo', 'Departamento de ejemplo', 'Comuna Norte', ?, 'urbano', ?, ?, ?, ?, ?, 1, 1, 1, 0, NOW(),
          ?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? DAY), ?, ?)`,
      [`${nombres[i]} ${apell[i % 5]}`, `9001${String(i + 1).padStart(6, '0')}`, i % 9 === 8 ? null : `3001${String(i + 1).padStart(6, '0')}`, `${nombres[i].toLowerCase()}@ejemplo.co`,
        i % 2 ? 'hombre' : 'mujer', 22 + i, barrio, `Calle ${i + 1} # ${i + 2}-${i + 3}`, nomBarrio, dueno, i % 7 === 3 ? sub : null, nombrePuesto, puesto, (i % 6) + 1,
        i % 3 === 0 ? new Date() : null, i % 3 === 0 ? 'sms' : null, i % 4 === 0 ? 1 : 0, i % 6 === 5 ? 'formulario_publico' : 'manual', dueno, i % 12,
        5.0689 + (i % 6) * 0.004, -75.5174 + (i % 5) * 0.004]);
    votantes.push(r.insertId);
  }
  // Algunos ya votaron y algunos necesitan transporte (el mismo día).
  for (const i of [0, 3, 6, 9, 12]) await q("INSERT INTO votante_votos (votante_id, voto_en, origen) VALUES (?, NOW(), 'equipo')", [votantes[i]]);
  await q('UPDATE votantes SET necesita_transporte = 1 WHERE id IN (?, ?, ?)', [votantes[1], votantes[4], votantes[7]]).catch(() => {});
  // Dos personas que pidieron no recibir más mensajes (una por SMS, otra anotada a mano), para la pantalla «No contactar».
  await q("UPDATE votantes SET no_contactar = 1, no_contactar_fecha = DATE_SUB(NOW(), INTERVAL 2 DAY), no_contactar_origen = 'sms' WHERE id = ?", [votantes[10]]);
  await q("UPDATE votantes SET no_contactar = 1, no_contactar_fecha = DATE_SUB(NOW(), INTERVAL 1 DAY), no_contactar_origen = 'manual', no_contactar_canal = 'llamada', no_contactar_motivo = 'Pidió no recibir más mensajes' WHERE id = ?", [votantes[11]]);

  // ------------------------------------------------------------------------------------------------ transporte, logística y enlace
  const veh = [];
  for (const [placa, tipo, cap] of [['EJE101', 'camioneta', 5], ['EJE102', 'van', 9], ['EJE103', 'carro', 4]]) {
    veh.push((await q('INSERT INTO transporte_vehiculos (aspirante_id, placa, tipo, capacidad, activo) VALUES (0,?,?,?,1)', [placa, tipo, cap])).insertId);
  }
  const cond = [];
  for (const [i, [nom, cod]] of [['Conductor Ejemplo Uno', 'CAMPANA2'], ['Conductor Ejemplo Dos', 'CAMPANA3'], ['Conductor Ejemplo Tres', 'CAMPANA4']].entries()) {
    cond.push((await q('INSERT INTO transporte_conductores (aspirante_id, nombre, celular, vehiculo_id, codigo, activo) VALUES (0,?,?,?,?,1)', [nom, `300111000${i}`, veh[i], cod])).insertId);
  }
  await q('INSERT INTO transporte_asignaciones (aspirante_id, votante_id, conductor_id, fecha) VALUES (0,?,?,CURDATE()), (0,?,?,CURDATE())', [votantes[1], cond[0], votantes[4], cond[0]]).catch(() => {});
  await q("INSERT INTO inscripcion_enlaces (usuario_id, codigo, activo) VALUES (?, 'MUESTRA2', 1), (?, 'EJEMPRA3', 1)", [lider, sub]).catch(() => {});

  // ------------------------------------------------------------------------------------------------ eventos, finanzas, redes, recursos, organigrama
  const dias = (d, h) => `DATE_ADD(DATE_ADD(CURDATE(), INTERVAL ${d} DAY), INTERVAL ${h} HOUR)`;
  for (const [t, tipo, d, h, lugar, est2] of [['Reunión de líderes', 'reunion', 2, 18, 'Salón comunal Los Ejemplos', 'programado'], ['Caminata de ejemplo', 'gotv', 4, 9, 'Parque La Muestra', 'programado'],
    ['Taller de ejemplo', 'capacitacion', 6, 15, 'Sede de ejemplo', 'programado'], ['Encuentro del barrio', 'evento_publico', -3, 17, 'Cancha Plaza Nueva', 'realizado'],
    ['Reunión de vereda', 'reunion', 8, 10, 'Escuela Buena Vista', 'programado']]) {
    await q(`INSERT INTO eventos (titulo, descripcion, tipo, fecha_inicio, fecha_fin, lugar, ciudad, territorio_id, meta_asistentes, estado, created_by, lider_id)
             VALUES (?, 'Evento de ejemplo', ?, ${dias(d, h)}, ${dias(d, h + 2)}, ?, 'Ciudad de ejemplo', ?, 40, ?, 1, ?)`, [t, tipo, lugar, bEjemplos, est2, lider]);
  }
  const [[ev]] = await pool.query("SELECT id FROM eventos WHERE estado = 'realizado' LIMIT 1");
  if (ev) for (let i = 0; i < 6; i++) {
    await q('INSERT INTO evento_asistentes (evento_id, votante_id, nombre, asistio) VALUES (?,?,?,?)', [ev.id, votantes[i], `${nombres[i]} ${apell[i % 5]}`, i < 4 ? 1 : 0]).catch(() => {});
  }
  const [cats] = await pool.query('SELECT id, tipo FROM finanzas_categorias');
  if (cats.length) {
    const gasto = cats.find((c) => c.tipo === 'gasto') || cats[0];
    const ingreso = cats.find((c) => c.tipo === 'ingreso') || cats[0];
    for (const [t, c, monto, d, desc, ter] of [['ingreso', ingreso, 1500000, 20, 'Aporte de ejemplo', 'Persona Ejemplo'], ['gasto', gasto, 320000, 15, 'Impresión de volantes de ejemplo', 'Imprenta Ejemplo'],
      ['gasto', gasto, 180000, 9, 'Refrigerios reunión de ejemplo', 'Tienda Muestra'], ['ingreso', ingreso, 800000, 7, 'Aporte de ejemplo', 'Persona Muestra'], ['gasto', gasto, 95000, 2, 'Transporte de ejemplo', 'Servicio Demo']]) {
      await q('INSERT INTO finanzas_movimientos (categoria_id, tipo, monto, descripcion, tercero, fecha, registrado_por) VALUES (?,?,?,?,?,DATE_SUB(CURDATE(), INTERVAL ? DAY),1)', [c.id, t, monto, desc, ter, d]);
    }
  }
  for (const [t, red, estado] of [['Mensaje de ejemplo para la semana', 'facebook', 'programado'], ['Foto del encuentro de ejemplo', 'instagram', 'publicado'], ['Video corto de ejemplo', 'tiktok', 'borrador'], ['Invitación a la reunión', 'whatsapp', 'programado']]) {
    await q(`INSERT INTO redes_publicaciones (titulo, red_social, contenido, fecha_programada, estado, metricas_alcance, metricas_interacciones, created_by)
             VALUES (?, ?, 'Texto de ejemplo', ${dias(1, 10)}, ?, 1200, 85, 1)`, [t, red, estado]);
  }
  for (const [t, tipo] of [['Mensaje de ejemplo para compartir', 'post_redes'], ['Noticia de ejemplo', 'noticia'], ['Próxima reunión de ejemplo', 'proxima_reunion']]) {
    await q('INSERT INTO recursos (titulo, tipo, descripcion, publicado, subido_por) VALUES (?,?,?,1,1)', [t, tipo, 'Contenido de ejemplo']);
  }
  const nodo = async (cargo, nombre, nivel, padre) => (await q('INSERT INTO organigrama_nodos (cargo, nombre, nivel, padre_id, tipo_relacion, orden, created_by) VALUES (?,?,?,?,?,1,1)', [cargo, nombre, nivel, padre || null, 'subordinado'])).insertId;
  const raiz = await nodo('Dirección de la campaña', 'Persona Ejemplo', 'nivel_1');
  const n2a = await nodo('Coordinación territorial', 'Carolina Ejemplo', 'nivel_2', raiz);
  await nodo('Coordinación de comunicaciones', 'Daniel Muestra', 'nivel_2', raiz);
  await nodo('Líder Comuna Norte', 'Laura Muestra', 'nivel_3', n2a);
  await nodo('Líder Comuna Centro', 'Mateo Prueba', 'nivel_3', n2a);

  await q("UPDATE configuracion_campana SET slogan_campana = 'Juntos por el barrio' WHERE id = 1");
  return leerIds(pool);
}

async function leerIds(pool) {
  const id = async (nombre) => { const [[r]] = await pool.query('SELECT id FROM usuarios WHERE nombre = ?', [nombre]); return r && r.id; };
  const [cond] = await pool.query("SELECT codigo FROM transporte_conductores ORDER BY id LIMIT 1");
  const [vot] = await pool.query('SELECT id, cedula FROM votantes ORDER BY id LIMIT 3');
  return {
    admin: 1, coordinador: await id('Carolina Ejemplo'), lider: await id('Laura Muestra'), lider2: await id('Mateo Prueba'), sublider: await id('Sofía Ejemplo'),
    asistente: await id('Andrea Apoyo Ejemplo'), testigo: await id('Teresa Testigo Ejemplo'), conductor: cond[0] && cond[0].codigo,
    votante1: vot[0] && vot[0].id, cedulaExistente: vot[0] && vot[0].cedula, enlaceLider: 'MUESTRA2',
  };
}

module.exports = { sembrar };
