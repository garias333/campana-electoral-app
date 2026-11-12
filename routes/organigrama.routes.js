const express = require('express');
const { Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, PageBreak, WidthType } = require('docx');
const pool = require('../config/db');
const { registrarAuditoriaEn } = require('../config/auditoria');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requiereImportarExportar } = require('../middleware/permisoModulo');
const { generarDocumentoWord } = require('../config/wordExport');
const { validarTelefono10Digitos } = require('../config/verificaciones');

const router = express.Router();
router.use(requireAuth);

const NIVELES_VALIDOS = ['nivel_1', 'nivel_2', 'nivel_3', 'nivel_4', 'nivel_5', 'nivel_6', 'asesores'];
const ETIQUETAS_NIVEL = { nivel_1: 'Nivel 1', nivel_2: 'Nivel 2', nivel_3: 'Nivel 3', nivel_4: 'Nivel 4', nivel_5: 'Nivel 5', nivel_6: 'Nivel 6', asesores: 'Asesores' };

function formatoTelefonoServidor(valor) {
  const digitos = (valor || '').toString().replace(/\D/g, '').slice(0, 10);
  return [digitos.slice(0, 3), digitos.slice(3, 6), digitos.slice(6, 10)].filter(Boolean).join(' ');
}

/** Igual que nombreAbreviado() en public/organigrama.html. */
function nombreAbreviadoServidor(nodo) {
  const partesNombres = (nodo.nombres || '').trim().split(/\s+/).filter(Boolean);
  const partesApellidos = (nodo.apellidos || '').trim().split(/\s+/).filter(Boolean);
  if (partesNombres.length === 0 && partesApellidos.length === 0) return nodo.nombre || '';
  const resultado = [];
  if (partesNombres[0]) resultado.push(partesNombres[0]);
  if (partesNombres[1]) resultado.push(partesNombres[1].charAt(0).toUpperCase() + '.');
  if (partesApellidos[0]) resultado.push(partesApellidos[0]);
  if (partesApellidos[1]) resultado.push(partesApellidos[1].charAt(0).toUpperCase() + '.');
  return resultado.join(' ');
}

/** Igual que textoSubordinadoDe() en public/organigrama.html. */
function textoSubordinadoDeServidor(nodo, mapaPorId) {
  if (!nodo.padre_id) return '—';
  const padre = mapaPorId.get(nodo.padre_id);
  if (!padre) return '—';
  const nombrePadre = nombreAbreviadoServidor(padre);
  return nombrePadre ? `${padre.cargo} — ${nombrePadre}` : padre.cargo;
}

/** Arma la ficha de UN cargo como bloque de Word (mismos campos que fichaCargoHtml() en el frontend). */
function construirFichaCargoDocx(nodo, mapaPorId) {
  const filas = [
    ['Cargo', nodo.cargo],
    ['Nombres', nodo.nombres || nodo.nombre || '—'],
    ['Apellidos', nodo.apellidos || '—'],
    ['Teléfono', nodo.telefono ? formatoTelefonoServidor(nodo.telefono) : '—'],
    ['E-mail', nodo.email || '—'],
    ['Nivel', ETIQUETAS_NIVEL[nodo.nivel] || 'Sin especificar'],
    ['Subordinado de', textoSubordinadoDeServidor(nodo, mapaPorId)],
    ['Tipo de relación', nodo.tipo_relacion === 'asesor' ? 'Asesor / Staff (horizontal)' : 'Subordinado (línea jerárquica)']
  ];
  const bloque = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(nodo.cargo)] }),
    new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'Ficha del cargo — Organigrama de campaña', italics: true, color: '5B6472', size: 20 })] }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: filas.map(([etiqueta, valor]) => new TableRow({
        children: [
          new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: etiqueta, bold: true, size: 20 })] })] }),
          new TableCell({ width: { size: 70, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: valor, size: 20 })] })] })
        ]
      }))
    })
  ];
  if (nodo.funciones) {
    bloque.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300 }, children: [new TextRun('Funciones del cargo')] }));
    nodo.funciones.split('\n').forEach(linea => {
      bloque.push(new Paragraph({ children: [new TextRun({ text: linea, size: 20 })] }));
    });
  }
  bloque.push(new Paragraph({ text: '' }));
  return bloque;
}

/**
 * Sube por la cadena de padres desde nuevoPadreId, buscando si en algún
 * punto se llega a idPropio — en ese caso, asignar nuevoPadreId como padre
 * de idPropio crearía un ciclo (un cargo terminaría reportando a uno de
 * sus propios subordinados).
 */
async function creariaCiclo(nuevoPadreId, idPropio) {
  let actual = nuevoPadreId;
  let profundidad = 0;
  while (actual && profundidad < 50) {
    if (String(actual) === String(idPropio)) return true;
    const [[fila]] = await pool.query(`SELECT padre_id FROM organigrama_nodos WHERE id = ?`, [actual]);
    if (!fila) break;
    actual = fila.padre_id;
    profundidad++;
  }
  return false;
}

// Árbol completo (plano; el frontend arma la jerarquía a partir de padre_id).
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT n.*, u.nombre AS creado_por_nombre
       FROM organigrama_nodos n
       LEFT JOIN usuarios u ON u.id = n.created_by
       ORDER BY n.padre_id IS NULL DESC, n.orden, n.id`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo el organigrama.' });
  }
});

// Crea un nodo (cargo raíz si padre_id viene vacío, subordinado o asesor de otro nodo).
router.post('/', requireRole('admin', 'coordinador'), async (req, res) => {
  const { cargo, nombres, apellidos, telefono, email, nivel, funciones, padre_id, tipo_relacion } = req.body;
  if (!cargo || !cargo.trim()) {
    return res.status(400).json({ error: 'El Cargo es obligatorio.' });
  }
  if (nivel && !NIVELES_VALIDOS.includes(nivel)) {
    return res.status(400).json({ error: 'Nivel no válido.' });
  }
  if (!validarTelefono10Digitos(telefono)) {
    return res.status(400).json({ error: 'Error de digitación: el teléfono debe tener 10 dígitos.' });
  }
  const tipoRelacionFinal = padre_id && tipo_relacion === 'asesor' ? 'asesor' : 'subordinado';
  try {
    const [[{ maxOrden }]] = await pool.query(
      `SELECT COALESCE(MAX(orden), -1) + 1 AS maxOrden FROM organigrama_nodos WHERE padre_id <=> ?`,
      [padre_id || null]
    );

    const [result] = await pool.query(
      `INSERT INTO organigrama_nodos (cargo, nombres, apellidos, telefono, email, nivel, funciones, padre_id, tipo_relacion, orden, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cargo.trim(), (nombres || '').trim() || null, (apellidos || '').trim() || null,
       telefono ? telefono.replace(/\D/g, '') : null, (email || '').trim() || null, nivel || null,
       (funciones || '').trim() || null,
       padre_id || null, tipoRelacionFinal, maxOrden, req.session.usuario.id]
    );
    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creando el cargo. Verifica que el cargo superior exista.' });
  }
});

// Edita Cargo/Nombre y permite reasignar de quién es subordinado (o asesor),
// con protección para no crear ciclos.
router.put('/:id', requireRole('admin', 'coordinador'), async (req, res) => {
  const { cargo, nombres, apellidos, telefono, email, nivel, funciones, padre_id, tipo_relacion } = req.body;
  if (!cargo || !cargo.trim()) {
    return res.status(400).json({ error: 'El Cargo es obligatorio.' });
  }
  if (nivel && !NIVELES_VALIDOS.includes(nivel)) {
    return res.status(400).json({ error: 'Nivel no válido.' });
  }
  if (!validarTelefono10Digitos(telefono)) {
    return res.status(400).json({ error: 'Error de digitación: el teléfono debe tener 10 dígitos.' });
  }
  const nuevoPadreId = padre_id || null;
  const tipoRelacionFinal = nuevoPadreId && tipo_relacion === 'asesor' ? 'asesor' : 'subordinado';

  try {
    if (nuevoPadreId) {
      if (String(nuevoPadreId) === String(req.params.id)) {
        return res.status(400).json({ error: 'Un cargo no puede reportar a sí mismo.' });
      }
      const ciclo = await creariaCiclo(nuevoPadreId, req.params.id);
      if (ciclo) {
        return res.status(400).json({ error: 'Ese cambio crearía un ciclo: un cargo no puede terminar reportando a uno de sus propios subordinados.' });
      }
    }
    await pool.query(
      `UPDATE organigrama_nodos SET cargo = ?, nombres = ?, apellidos = ?, telefono = ?, email = ?, nivel = ?, funciones = ?, padre_id = ?, tipo_relacion = ? WHERE id = ?`,
      [cargo.trim(), (nombres || '').trim() || null, (apellidos || '').trim() || null,
       telefono ? telefono.replace(/\D/g, '') : null, (email || '').trim() || null, nivel || null,
       (funciones || '').trim() || null,
       nuevoPadreId, tipoRelacionFinal, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error actualizando el cargo.' });
  }
});

/* Elimina un nodo y toda su subestructura (ON DELETE CASCADE en padre_id).
 *
 * QUEDA CONSTANCIA, Y SE CUENTA LA SUBESTRUCTURA ANTES DE BORRARLA. Es lo que
 * hace distinta a esta ruta: el botón dice «eliminar el cargo» y lo que se
 * lleva es la rama entera colgada de él. Quien borra un nodo de nivel 2 puede
 * estar borrando veinte cargos sin saberlo, porque la cascada no avisa y la
 * pantalla se limita a redibujarse más pequeña.
 *
 * El conteo va con un CTE recursivo, que es la única forma de saber cuántos
 * descendientes hay: la tabla es una lista de adyacencia (`padre_id`) sin ruta
 * materializada, así que la profundidad no se conoce de antemano.
 */
router.delete('/:id', requireRole('admin', 'coordinador'), async (req, res) => {
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
    const [[nodo]] = await conexion.query(
      `WITH RECURSIVE rama AS (
         SELECT id, cargo FROM organigrama_nodos WHERE id = ?
         UNION ALL
         SELECT h.id, h.cargo FROM organigrama_nodos h JOIN rama ON h.padre_id = rama.id
       )
       SELECT n.id, n.cargo, n.nivel,
              TRIM(CONCAT(COALESCE(n.nombres, n.nombre, ''), ' ', COALESCE(n.apellidos, ''))) AS ocupante,
              (SELECT COUNT(*) - 1 FROM rama) AS descendientes
         FROM organigrama_nodos n WHERE n.id = ?`,
      [req.params.id, req.params.id]);
    if (!nodo) {
      await conexion.rollback();
      return res.status(404).json({ error: 'Ese cargo ya no existe.' });
    }

    const detalle = `Eliminó del organigrama el cargo «${nodo.cargo}»`
      + (nodo.ocupante ? `, ocupado por ${nodo.ocupante}` : ', sin nadie asignado')
      + (nodo.nivel ? ` (${String(nodo.nivel).replace('_', ' ')})` : '')
      + `. El identificador era ${nodo.id}.`
      + (nodo.descendientes > 0
          ? ` Con él se ${nodo.descendientes === 1 ? 'borró 1 cargo que colgaba debajo' : `borraron ${nodo.descendientes} cargos que colgaban debajo`}.`
          : '');

    await registrarAuditoriaEn(
      conexion, req.session.usuario.id, 'eliminar_cargo', 'organigrama_nodos', nodo.id,
      detalle, req.ip
    );

    /* SE COMPRUEBA `affectedRows`. El SELECT de arriba es una lectura
       consistente que no bloquea —REPEATABLE-READ—, así que dos peticiones
       simultáneas, o un doble clic, ven las dos la fila y las dos escriben su
       apunte. La segunda borraría cero filas y confirmaría igual. */
    const [borrado] = await conexion.query(`DELETE FROM organigrama_nodos WHERE id = ?`, [req.params.id]);
    if (!borrado.affectedRows) {
      await conexion.rollback();
      return res.status(404).json({ error: 'Ese cargo ya no existe.' });
    }
    await conexion.commit();
    res.json({ ok: true });
  } catch (err) {
    /* El rollback va protegido: si lo que falló fue la conexión misma —MySQL
       reiniciado, `wait_timeout`, un KILL— también lanza, y sin esto el
       `res.status(500)` de abajo no llegaría a ejecutarse nunca. */
    if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
    console.error(err);
    res.status(500).json({ error: 'Error eliminando el cargo.' });
  } finally {
    if (conexion) conexion.release();
  }
});

// Ficha de UN cargo en Word (mismo contenido que imprimirCargo() en pantalla/PDF).
router.get('/:id/exportar-word', requiereImportarExportar('organigrama'), async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM organigrama_nodos`);
    const mapaPorId = new Map(rows.map(n => [n.id, n]));
    const nodo = mapaPorId.get(Number(req.params.id));
    if (!nodo) return res.status(404).json({ error: 'Cargo no encontrado.' });
    const buffer = await generarDocumentoWord({
      titulo: nodo.cargo, subtitulo: 'Organigrama de campaña',
      secciones: [construirFichaCargoDocx(nodo, mapaPorId)]
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="cargo-${(nodo.cargo || 'ficha').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.docx"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error exportando la ficha del cargo a Word.' });
  }
});

// Ficha de TODOS los cargos en un solo Word, una por hoja (mismo orden que imprimirTodoOrganigrama()).
router.get('/exportar-word', requiereImportarExportar('organigrama'), async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM organigrama_nodos`);
    if (!rows.length) return res.status(400).json({ error: 'Todavía no hay cargos en el organigrama.' });
    const mapaPorId = new Map(rows.map(n => [n.id, n]));
    const ORDEN_NIVEL = { nivel_1: 0, nivel_2: 1, nivel_3: 2, nivel_4: 3, nivel_5: 4, nivel_6: 5, asesores: 6 };
    const ordenados = rows.slice().sort((a, b) => {
      const ordenA = a.nivel ? (ORDEN_NIVEL[a.nivel] ?? 7) : 7;
      const ordenB = b.nivel ? (ORDEN_NIVEL[b.nivel] ?? 7) : 7;
      if (ordenA !== ordenB) return ordenA - ordenB;
      return a.cargo.localeCompare(b.cargo);
    });
    const secciones = ordenados.map((n, i) => {
      const bloque = construirFichaCargoDocx(n, mapaPorId);
      if (i > 0) bloque.unshift(new Paragraph({ children: [new PageBreak()] }));
      return bloque;
    });
    const buffer = await generarDocumentoWord({
      titulo: 'Organigrama completo', subtitulo: 'Fichas por cargo — Organigrama de campaña', secciones
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="organigrama-completo.docx"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error exportando el organigrama completo a Word.' });
  }
});

module.exports = router;
