const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { registrarAuditoria } = require('../config/auditoria');
const { esSuperadmin } = require('../config/superadmin');

const router = express.Router();
router.use(requireAuth);

// Catálogo de módulos del menú — debe reflejar los mismos "modulo" usados
// en public/js/common.js (NAV_ITEMS) para que el filtrado funcione.
const MODULOS = [
  { clave: 'panel_general', etiqueta: 'Panel general' },
  { clave: 'organigrama', etiqueta: 'Organigrama' },
  { clave: 'territorial', etiqueta: 'Estructura territorial' },
  { clave: 'votantes', etiqueta: 'Votantes y sublíderes' },
  { clave: 'votantes_dashboard', etiqueta: 'Dashboard de votantes' },
  { clave: 'testigos', etiqueta: 'Testigos electorales' },
  { clave: 'mapa', etiqueta: 'Mapa de estructura y votantes' },
  { clave: 'agenda', etiqueta: 'Agenda' },
  { clave: 'eventos', etiqueta: 'Eventos y GOTV' },
  { clave: 'asistentes_reuniones', etiqueta: 'Asistentes a reuniones' },
  { clave: 'dia_d', etiqueta: 'Día D' },
  { clave: 'social', etiqueta: 'Redes y Opinión' },
  { clave: 'crm', etiqueta: 'CRM y Mensajes' },
  { clave: 'enviar_email', etiqueta: 'Enviar E-mail' },
  { clave: 'enviar_sms', etiqueta: 'Enviar SMS' },
  { clave: 'configurar_crm', etiqueta: 'Configurar CRM' },
  { clave: 'recursos', etiqueta: 'Información para compartir' },
  { clave: 'finanzas', etiqueta: 'Finanzas' },
  // «Usuarios» no es una pantalla del menú lateral sino una pestaña dentro de
  // Configuración. Está aquí para poder decidir quién administra cuentas sin
  // dar o quitar toda la Configuración de golpe. Ojo: hoy Configuración entera
  // es solo para admin, así que esta fila regula al administrador; queda lista
  // para el día que se abra a otro rol.
  { clave: 'usuarios', etiqueta: 'Usuarios' },
  { clave: 'configuracion', etiqueta: 'Configuración' }
];
/*
 * EL ORDEN ES EL DE LA JERARQUÍA, no el alfabético ni el de creación: se lee
 * de arriba abajo como se lee el organigrama de la campaña, y así la fila que
 * se busca está donde uno espera.
 *
 * «usuario» SE QUITA DE LA MATRIZ pero NO de la aplicación. El rol sigue
 * existiendo y sus filas de `permisos_rol` siguen ahí y aplicándose: el
 * guardado usa INSERT ... ON DUPLICATE KEY UPDATE y solo recorre esta lista,
 * así que no las toca ni las borra. Lo que cambia es que dejan de poder
 * editarse desde el panel.
 *
 * Comprobado antes de quitarlo (16 de agosto de 2026): una sola cuenta lo usa,
 * en la campaña municipal, y su acceso queda congelado en los 10 módulos que
 * tiene hoy. Si alguna vez hay que moverlo, basta con devolver 'usuario' a
 * esta lista.
 */
const ROLES = ['admin', 'asistente_administrativo', 'coordinador', 'lider', 'sublider', 'testigo', 'invitado'];

// Matriz completa (rol × módulo) para la pantalla de administración. Solo
// admin. Cada casilla trae los tres niveles de permiso: Ver, Editar y
// Agregar nuevo.
router.get('/matriz', requireRole('admin'), async (req, res) => {
  try {
    const [filas] = await pool.query(`SELECT rol, modulo, permitido, editar, agregar FROM permisos_rol`);
    const permisos = {};
    filas.forEach(f => {
      permisos[`${f.rol}:${f.modulo}`] = { ver: !!f.permitido, editar: !!f.editar, agregar: !!f.agregar };
    });
    res.json({ modulos: MODULOS, roles: ROLES, permisos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo la matriz de permisos.' });
  }
});

// Guarda la matriz completa (todas las casillas a la vez). Solo admin.
router.put('/matriz', requireRole('admin'), async (req, res) => {
  const { permisos } = req.body;
  if (!permisos || typeof permisos !== 'object') {
    return res.status(400).json({ error: 'Formato de permisos inválido.' });
  }
  const filas = [];
  for (const rol of ROLES) {
    for (const { clave: modulo } of MODULOS) {
      const celda = permisos[`${rol}:${modulo}`] || {};
      filas.push([rol, modulo, celda.ver ? 1 : 0, celda.editar ? 1 : 0, celda.agregar ? 1 : 0]);
    }
  }

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    // Un solo INSERT con todas las filas (antes eran 128 consultas
    // separadas, una por cada casilla rol×módulo) — mismo resultado en la
    // base de datos, un solo viaje en vez de 128.
    await conexion.query(
      `INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES ?
       ON DUPLICATE KEY UPDATE permitido = VALUES(permitido), editar = VALUES(editar), agregar = VALUES(agregar)`,
      [filas]
    );
    await conexion.commit();
    await registrarAuditoria(
      req.session.usuario.id, 'editar_matriz_permisos', 'permisos', null,
      'Actualizó la matriz de permisos por rol.', req.ip
    );
    res.json({ ok: true });
  } catch (err) {
    await conexion.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error guardando la matriz de permisos.' });
  } finally {
    conexion.release();
  }
});

// Permisos del rol del usuario que inició sesión — usado por common.js
// para armar el menú dinámicamente (según "ver"), y por las páginas
// individuales para mostrar/ocultar sus botones de Editar/Agregar nuevo.
// Cualquier usuario autenticado puede consultar esto (solo ve sus propios
// permisos, no los de otros roles).
router.get('/mios', async (req, res) => {
  try {
    /*
     * LA MATRIZ NO SE LE APLICA AL SUPERADMINISTRADOR.
     *
     * Esta pantalla la edita cualquier administrador, y la matriz está
     * indexada por NOMBRE DE ROL. Como el superadministrador conserva el rol
     * 'admin' —de ahí saca sus permisos, ver config/superadmin.js—, un
     * administrador que le quitara módulos a la fila «admin» se los estaría
     * quitando también a él: el menú del superadministrador se vaciaría por
     * decisión de alguien a quien supervisa.
     *
     * Devolviéndole todo en verde, la matriz sigue gobernando a los demás
     * roles —incluido «admin»— y a él no lo alcanza. Es exactamente lo que
     * significa «control total».
     */
    if (await esSuperadmin(req.session.usuario)) {
      const permisos = {};
      MODULOS.forEach(m => { permisos[m.clave] = { ver: true, editar: true, agregar: true }; });
      return res.json({ modulos: MODULOS.map(m => m.clave), permisos });
    }
    const [filas] = await pool.query(
      `SELECT modulo, permitido, editar, agregar FROM permisos_rol WHERE rol = ?`,
      [req.session.usuario.rol]
    );
    const permisos = {};
    filas.forEach(f => {
      permisos[f.modulo] = { ver: !!f.permitido, editar: !!f.editar, agregar: !!f.agregar };
    });
    res.json({
      // Se mantiene "modulos" (lista simple de módulos visibles) por
      // compatibilidad con lo que ya usa common.js para armar el menú.
      modulos: filas.filter(f => f.permitido).map(f => f.modulo),
      permisos
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo los permisos del usuario.' });
  }
});

module.exports = router;
