const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { registrarAuditoria } = require('../config/auditoria');
const { esSuperadmin } = require('../config/superadmin');
const { MODULOS_CON_IMPORTAR_EXPORTAR, moduloTieneImportarExportar } = require('../config/importarExportar');

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
  { clave: 'rescate_votos', etiqueta: 'Faltan por votar (Día D)' },
  { clave: 'resultados_dia_d', etiqueta: 'Resultados del Día D' },
  { clave: 'alertas_dia_d', etiqueta: 'Alertas del Día D' },
  { clave: 'transporte_dia_d', etiqueta: 'Transporte del Día D' },
  { clave: 'logistica_dia_d', etiqueta: 'Logística del Día D (refrigerios y kits)' },
  { clave: 'social', etiqueta: 'Redes y Opinión' },
  { clave: 'crm', etiqueta: 'CRM y Mensajes' },
  { clave: 'enviar_email', etiqueta: 'Enviar E-mail' },
  { clave: 'enviar_sms', etiqueta: 'Enviar SMS' },
  // «Aviso en la app» (push). Existía en el menú y en la siembra de fábrica (init-db.js) pero NO en este catálogo: no se podía
  // gobernar desde la matriz, y al superadministrador —cuyo menú se arma con ESTA lista— no le aparecía la entrada.
  { clave: 'enviar_push', etiqueta: 'Aviso en la app' },
  { clave: 'configurar_crm', etiqueta: 'Configurar CRM' },
  // Recordatorios automáticos: la pestaña «Recordatorios» de Configuración (interruptor, fecha permitida, tope de SMS, silencio, reglas e historial).
  { clave: 'recordatorios', etiqueta: 'Recordatorios automáticos' },
  // Solicitudes ciudadanas: necesidades del barrio que los líderes registran en campo y la campaña sigue hasta cerrarlas.
  { clave: 'solicitudes', etiqueta: 'Solicitudes ciudadanas' },
  // Tareas y metas por zona: lo que la coordinación le asigna a su equipo (visita, entrega de material, libre) y el seguimiento hasta verificarlo.
  { clave: 'tareas', etiqueta: 'Tareas' },
  // Puerta a puerta: visitas a votantes ya registrados. Dos módulos, para que quien arma las listas no sea quien las recorre.
  { clave: 'puerta_listas', etiqueta: 'Puerta a puerta (armar listas)' },
  { clave: 'puerta_visitas', etiqueta: 'Puerta a puerta (visitar en campo)' },
  { clave: 'recursos', etiqueta: 'Información para compartir' },
  // Normas en PDF que el equipo técnico deja en la carpeta `legislacion/` de la
  // instalación; la aplicación solo las lista y las sirve (routes/legislacion.routes.js).
  { clave: 'legislacion', etiqueta: 'Legislación' },
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
const ROLES = ['admin', 'administrativo', 'asistente_administrativo', 'coordinador', 'lider', 'sublider', 'testigo', 'invitado'];

/* ¿LA COLUMNA `importar_exportar` TODAVÍA NO EXISTE? Entre el momento en que el
   actualizador descomprime el parche y el momento en que `init-db` la crea (o si
   `init-db` no llegó a correr), este código ya está sirviendo y la base todavía
   no la tiene. Sin este respaldo, `/mios` respondería 500 a CADA usuario —lo
   llama common.js en cada página— y el menú de toda la campaña dejaría de
   dibujarse por una casilla nueva. Con él, la pantalla funciona como antes y el
   permiso nuevo queda cerrado (el middleware cierra por defecto).
   No se mira solo el código del error: otra columna que faltara también es
   ER_BAD_FIELD_ERROR, y eso SÍ debe fallar a la vista. */
function faltaColumnaImportarExportar(err) {
  return !!err && err.code === 'ER_BAD_FIELD_ERROR'
    && /importar_exportar/.test(err.sqlMessage || err.message || '');
}

// Matriz completa (rol × módulo) para la pantalla de administración. Solo
// admin. Cada casilla trae los tres niveles de permiso: Ver, Editar y
// Agregar nuevo.
router.get('/matriz', requireRole('admin'), async (req, res) => {
  try {
    let filas;
    let columnaExiste = true;
    try {
      [filas] = await pool.query(
        `SELECT rol, modulo, permitido, editar, agregar, importar_exportar FROM permisos_rol`);
    } catch (err) {
      if (!faltaColumnaImportarExportar(err)) throw err;
      columnaExiste = false;
      [filas] = await pool.query(`SELECT rol, modulo, permitido, editar, agregar FROM permisos_rol`);
    }
    const permisos = {};
    filas.forEach(f => {
      permisos[`${f.rol}:${f.modulo}`] = {
        ver: !!f.permitido, editar: !!f.editar, agregar: !!f.agregar,
        importar_exportar: !!f.importar_exportar
      };
    });
    /* `modulos_con_importar_exportar` viaja con la matriz para que la pantalla
       sepa en qué filas ofrecer la cuarta casilla sin llevar su propia copia de
       la lista: una casilla en un módulo que no tiene nada que importar ni
       exportar no hace nada, y una que miente es peor que ninguna. */
    // Activar complementos (parche 318): los módulos de un complemento apagado se siguen mostrando, pero en gris y con la nota.
    const C = require('../lib/complementos');
    const activosC = await C.complementosActivos();
    const complementos_apagados = {};
    C.CATALOGO.forEach((c) => { if (!activosC[c.clave]) c.modulos.forEach((m) => { complementos_apagados[m] = c.nombre; }); });
    res.json({
      modulos: MODULOS, roles: ROLES, permisos, complementos_apagados,
      // Sin la columna no se ofrece la casilla: dibujarla y que no guarde nada
      // sería una casilla que miente.
      modulos_con_importar_exportar: columnaExiste ? MODULOS_CON_IMPORTAR_EXPORTAR : []
    });
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
  /* ¿ESTA PANTALLA CONOCE LA CUARTA CASILLA? El guardado reescribe TODAS las
     celdas rol×módulo. Una pantalla que quedó abierta —o en la caché del
     navegador— de antes de «Importar / Exportar» no la manda, y tomar su
     ausencia por «apagada» le quitaría el permiso a todos los roles de un
     golpe, sin error y sin que el administrador hiciera nada. Si ninguna celda
     la trae, esa columna no se toca. */
  const traeImportarExportar = Object.values(permisos)
    .some(c => c && typeof c === 'object' && 'importar_exportar' in c);

  const filas = [];
  for (const rol of ROLES) {
    for (const { clave: modulo } of MODULOS) {
      const celda = permisos[`${rol}:${modulo}`] || {};
      const fila = [rol, modulo, celda.ver ? 1 : 0, celda.editar ? 1 : 0, celda.agregar ? 1 : 0];
      if (traeImportarExportar) {
        /* El administrador SIEMPRE lo tiene donde existe (el servidor no se lo
           pregunta, así que la matriz no puede decir otra cosa), y un módulo sin
           rutas de importar ni exportar siempre en 0, venga lo que venga. */
        fila.push(!moduloTieneImportarExportar(modulo) ? 0
          : (rol === 'admin' ? 1 : (celda.importar_exportar ? 1 : 0)));
      }
      filas.push(fila);
    }
  }

  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    // Un solo INSERT con todas las filas (antes eran 128 consultas
    // separadas, una por cada casilla rol×módulo) — mismo resultado en la
    // base de datos, un solo viaje en vez de 128.
    await conexion.query(
      traeImportarExportar
        ? `INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar, importar_exportar) VALUES ?
           ON DUPLICATE KEY UPDATE permitido = VALUES(permitido), editar = VALUES(editar),
             agregar = VALUES(agregar), importar_exportar = VALUES(importar_exportar)`
        : `INSERT INTO permisos_rol (rol, modulo, permitido, editar, agregar) VALUES ?
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
/**
 * LOS PERMISOS DE QUIEN PREGUNTA, en una función para que los comparta quien los necesite (los manuales de ayuda,
 * routes/manuales.routes.js) sin copiar la regla: superadministrador, aspirante con sublicencia y fila del rol.
 * Devuelve `{ modulos, permisos, hrefs }`, igual que `GET /mios`.
 */
async function permisosDeSesion(req) {
  const r = await permisosDeSesionSinComplementos(req);
  return aplicarComplementos(r);
}

/**
 * ACTIVAR COMPLEMENTOS (parche 318). Lo último que se le hace a lo que devuelve `/mios`, para TODOS (superadministrador y aspirante incluidos,
 * que tienen listas fijas): los módulos de un complemento apagado salen de `modulos`, su casilla queda en false (NO se borra: `puedeVer` del
 * navegador, ante una casilla que falta, dice que sí), las direcciones fijas del aspirante pierden las de ese complemento, y se agrega
 * `complementos: { clave: true|false }` para que el navegador esconda pestañas, tarjetas y botones sin otra llamada.
 * Si el estado no se puede leer, `complementosActivos` devuelve todo en false (falla cerrado).
 */
const HREF_DE_COMPLEMENTO = {
  '/dia-d.html#alertas': 'alertas_dia_d', '/app/alertas-dia-d.html': 'alertas_dia_d',
  '/dia-d.html#resultados': 'resultados_dia_d',
  '/dia-d.html#transporte': 'transporte_dia_d',
  '/dia-d.html#logistica': 'logistica_dia_d', '/app/logistica.html': 'logistica_dia_d',
  '/app/faltantes.html': 'faltan_por_votar',
};
async function aplicarComplementos({ modulos, permisos, hrefs }) {
  const C = require('../lib/complementos');
  const activos = await C.complementosActivos();
  const apagado = (m) => { const d = C.complementoDelModulo(m); return !!d && !activos[d]; };
  const permisosFiltrados = {};
  Object.keys(permisos).forEach((m) => {
    permisosFiltrados[m] = apagado(m)
      ? { ...permisos[m], ver: false, editar: false, agregar: false, importar_exportar: false }
      : permisos[m];
  });
  // Un módulo de un complemento apagado que no figuraba (p. ej. el superadministrador lo tiene todo) también se declara en false.
  C.CATALOGO.forEach((c) => c.modulos.forEach((m) => {
    if (!activos[c.clave] && !permisosFiltrados[m]) permisosFiltrados[m] = { ver: false, editar: false, agregar: false, importar_exportar: false };
  }));
  return {
    modulos: (modulos || []).filter((m) => !apagado(m)),
    permisos: permisosFiltrados,
    hrefs: hrefs ? hrefs.filter((h) => !HREF_DE_COMPLEMENTO[h] || activos[HREF_DE_COMPLEMENTO[h]]) : hrefs,
    complementos: activos,
  };
}

async function permisosDeSesionSinComplementos(req) {
  {
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
      MODULOS.forEach(m => { permisos[m.clave] = { ver: true, editar: true, agregar: true, importar_exportar: true }; });
      return { modulos: MODULOS.map(m => m.clave), permisos, hrefs: null };
    }
    let filas;
    try {
      [filas] = await pool.query(
        `SELECT modulo, permitido, editar, agregar, importar_exportar FROM permisos_rol WHERE rol = ?`,
        [req.session.usuario.rol]
      );
    } catch (err) {
      if (!faltaColumnaImportarExportar(err)) throw err;
      [filas] = await pool.query(
        `SELECT modulo, permitido, editar, agregar FROM permisos_rol WHERE rol = ?`,
        [req.session.usuario.rol]
      );
    }
    const permisos = {};
    filas.forEach(f => {
      permisos[f.modulo] = {
        ver: !!f.permitido, editar: !!f.editar, agregar: !!f.agregar,
        importar_exportar: !!f.importar_exportar
      };
    });
    /* EL ADMINISTRADOR LO TIENE SIEMPRE, y aquí se dice así para que el
       navegador no lo contradiga. El servidor no le pregunta a la matriz por el
       administrador (middleware/permisoModulo.js): si la fila de «admin»
       dijera 0 —porque alguien la apagó, o porque falta—, los botones se
       esconderían y las rutas seguirían abiertas. Peor que cualquiera de las
       dos por separado. */
    if (req.session.usuario.rol === 'admin') {
      MODULOS_CON_IMPORTAR_EXPORTAR.forEach(m => {
        permisos[m] = { ver: false, editar: false, agregar: false, ...permisos[m], importar_exportar: true };
      });
    }
    let modulos = filas.filter(f => f.permitido).map(f => f.modulo);
    let hrefs = null;   // sólo el aspirante recorta entrada por entrada

      /* EL ASPIRANTE VE SUS CUATRO MÓDULOS, Y NO SE INTERSECAN CON SU ROL.
         La versión anterior los cruzaba con la matriz del rol, razonando que
         «restringir sólo puede quitar». Suena prudente y estaba mal: MEDIDO el
         24 de agosto de 2026, de los cuatro módulos del aspirante la matriz le
         da al rol «lider» exactamente uno —

           votantes ....... permitido 1
           configuracion .. permitido 0
           territorial .... permitido 0
           testigos ....... permitido 0

         — así que el aspirante entraba y veía UNA entrada de menú. Es lo que
         se vio en pantalla: «Votantes y sublíderes» y nada más.

         El error de fondo era tratar la sublicencia como un recorte del rol.
         No lo es. Ese usuario tiene rol «lider» porque así figura en la
         estructura de la campaña madre; lo que compró es otra cosa, y son
         cuatro pantallas sobre SU rama.

         Sigue sin ser una puerta trasera, y por dos razones que se pueden
         comprobar: la lista es fija —estas cuatro, no las que él pida— y
         `middleware/aspirante.js` corta todo lo demás en el servidor. Las
         acciones destructivas de esos módulos siguen cerradas con
         `requireRole('admin')`, que él no cumple. */
    if (req.sublicencia) {
      const { MODULOS_ASPIRANTE, PERMISOS_ASPIRANTE,
              HREFS_ASPIRANTE } = require('../middleware/aspirante');
      modulos = MODULOS_ASPIRANTE.slice();
      Object.keys(permisos).forEach(k => { delete permisos[k]; });
      MODULOS_ASPIRANTE.forEach((m) => { permisos[m] = { ...PERMISOS_ASPIRANTE[m] }; });
      hrefs = HREFS_ASPIRANTE.slice();
    }

    // Se mantiene "modulos" (lista simple de módulos visibles) por
    // compatibilidad con lo que ya usa common.js para armar el menú.
    return { modulos, permisos, hrefs };
  }
}

router.get('/mios', async (req, res) => {
  try {
    res.json(await permisosDeSesion(req));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo los permisos del usuario.' });
  }
});


module.exports = router;
// Para quien necesite lo mismo que `/mios` o la lista de módulos sin pasar por HTTP (manuales de ayuda).
module.exports.permisosDeSesion = permisosDeSesion;
module.exports.MODULOS = MODULOS;
module.exports.ROLES = ROLES;
