const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
const { duenoDeLaCampana } = require('../lib/ramas');
const { requireAuth, requireRole, calcularAlcance } = require('../middleware/auth');
const { requiereImportarExportar } = require('../middleware/permisoModulo');
const { registrarAuditoria, registrarAuditoriaEn } = require('../config/auditoria');
const { upload, UPLOAD_DIR } = require('../middleware/upload');
const smsSvc = require('../config/sms');
const sendgridSvc = require('../config/sendgrid');
const pushSvc = require('../config/push');
const { enviarCorreoMasivo: enviarCorreoPersonal } = require('../config/mailer');
const { armarWhereSql } = require('../config/filtros');
const { verificarPasswordAdmin } = require('../config/verificaciones');
const { codigoDe: codigoDeBaja, urlDeBaja, aplicarBajaDeFicha, CANALES_BAJA_MANUAL } = require('../config/bajaContacto');
const yaVoto = require('../config/yaVotoEnlace');
const { mesasDeFila, listaEnPalabras } = require('../lib/coberturaTestigos');
const { condicionAlcanceVotantes, parametrosAlcanceVotantes } = require('../lib/alcanceVotantes');

const router = express.Router();

/**
 * La dirección pública de esta instalación.
 *
 * Sale de LICENCIA_DOMINIO y no de la cabecera `Host`, que la manda el
 * cliente. Estas URLs acaban dentro de correos y en el webhook que Twilio
 * llama de vuelta: si alguien colara otro Host, los adjuntos se pedirían a un
 * servidor ajeno y los avisos de entrega se irían a otro lado.
 */
function baseDelSitio(req) {
  return process.env.LICENCIA_DOMINIO
    ? `https://${process.env.LICENCIA_DOMINIO}`
    : `${req.protocol}://${req.get('host')}`;
}

/**
 * Ruta PÚBLICA a propósito (va antes de requireAuth) — Twilio necesita
 * descargar el archivo adjunto de una campaña desde sus propios
 * servidores, sin ninguna sesión de este sitio.
 *
 * Hoy NINGUNA campaña nueva puede traer adjunto: el único canal que los
 * admitía era WhatsApp, y está desactivado (ver POST /campanas). La ruta
 * se conserva para las campañas viejas que sí tengan uno guardado. Para no
 * convertir esto en un servidor de archivos abierto, solo entrega un
 * archivo si su nombre coincide EXACTAMENTE con el que quedó guardado
 * como adjunto de alguna campaña — cualquier otro nombre (aunque el
 * archivo exista físicamente en /uploads) responde 404.
 */
router.get('/adjunto-publico/:archivo', async (req, res) => {
  try {
    const [[campana]] = await pool.query(
      `SELECT adjunto_nombre FROM comunicaciones_campanas WHERE adjunto_nombre = ? LIMIT 1`,
      [req.params.archivo]
    );
    if (!campana) return res.status(404).send('No encontrado.');
    res.sendFile(path.join(UPLOAD_DIR, campana.adjunto_nombre));
  } catch (err) {
    console.error(err);
    res.status(500).send('Error interno.');
  }
});

router.use(requireAuth);
router.use(requireRole('admin', 'coordinador', 'lider', 'asistente_administrativo'));

const ETIQUETAS_CARGO = {
  coordinador: 'Coordinador', coordinador_organizaciones: 'Coordinador Organizaciones',
  lider: 'Líder', usuario: 'Sublíder', testigo: 'Testigo'
};
const ETIQUETAS_NIVEL = {
  nivel_1: 'Nivel 1', nivel_2: 'Nivel 2', nivel_3: 'Nivel 3', asesores: 'Asesores'
};

/**
 * Convierte lo que la persona escribió a mano (uno o varios números o
 * correos, separados por coma, punto y coma, o salto de línea) en la
 * misma forma de "destinatario" que usan los que sí vienen de Votantes/
 * Estructura — para que se puedan mezclar sin problema.
 */
function parsearDestinatariosManuales(texto) {
  if (!texto || !texto.trim()) return [];
  return texto.split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(contacto => ({
      tipo: 'manual', id: null, nombre: contacto, contacto,
      detalle: 'Agregado manualmente'
    }));
}

/**
 * Un número o correo escrito a mano puede ser el de alguien que YA está
 * registrado. Antes se enviaba igual, pero como "manual": sin nombre (se
 * mostraba el propio número) y sin persona detrás, así que un mensaje con
 * los marcadores de Lugar de votación no tenía de dónde sacar el dato y la
 * persona quedaba saltada — aunque su lugar estuviera bien registrado en
 * Votantes y sublíderes.
 *
 * Ahora se busca ese contacto en la base y, si aparece, el destinatario
 * pasa a ser esa persona. Los que de verdad no están registrados siguen
 * como manuales, que para eso existe la casilla.
 *
 * Si el mismo contacto está en dos fichas (pasa: la misma persona
 * registrada dos veces con cédulas distintas), se toma UNA sola —la más
 * reciente— en vez de mandar el mensaje repetido.
 */
async function resolverManualesContraLaBase(manuales, canal) {
  if (!manuales.length) return [];
  const columna = esCanalDeCorreo(canal) ? 'email' : 'telefono';
  const contactos = manuales.map(m => m.contacto);

  const [votantes] = await pool.query(
    `SELECT id, nombre, ${columna} AS contacto, puesto_votacion, mesa_votacion, no_contactar
       FROM votantes WHERE ${columna} IN (?) ORDER BY id DESC`, [contactos]);
  const [gente] = await pool.query(
    `SELECT e.id, e.usuario_id, u.nombre, u.${columna} AS contacto, e.cargo, u.no_contactar
       FROM estructura e JOIN usuarios u ON u.id = e.usuario_id
      WHERE u.${columna} IN (?) AND e.activo = 1 ORDER BY e.id DESC`, [contactos]);

  const porContacto = new Map();
  // La Estructura se indexa primero y los Votantes después, así que si
  // alguien está en las dos, gana su ficha de Votante: es la que tiene el
  // Lugar de votación de la persona (el de Estructura es donde vigila).
  // `usuario_id` va aparte del id de estructura porque el canal Push manda a la
  // CUENTA. Sin traerlo, un numero escrito a mano que resulta ser de alguien de
  // la estructura quedaria «sin contacto» en un aviso push, sin un solo error.
  gente.forEach(g => porContacto.set(String(g.contacto).trim().toLowerCase(),
    { tipo: 'estructura', id: g.id, usuario_id: g.usuario_id, nombre: g.nombre.trim(), contacto: g.contacto,
      dado_de_baja: !!g.no_contactar, detalle: `Estructura · ${g.cargo}` }));
  votantes.forEach(v => porContacto.set(String(v.contacto).trim().toLowerCase(),
    { tipo: 'votante', id: v.id, nombre: v.nombre.trim(), contacto: v.contacto,
      sin_lugar_votacion: !(v.puesto_votacion && String(v.puesto_votacion).trim()),
      dado_de_baja: !!v.no_contactar,
      detalle: v.puesto_votacion ? `Votante · Puesto: ${v.puesto_votacion}${v.mesa_votacion ? ' · Mesa ' + v.mesa_votacion : ''}` : 'Votante' }));

  return manuales.map(m => porContacto.get(String(m.contacto).trim().toLowerCase()) || m);
}

/**
 * Destinatarios elegidos uno por uno en pantalla (pantallas de Enviar SMS
 * y Enviar E-mail, que arman la lista a mano antes de escribir el mensaje).
 *
 * Antes esa lista se mandaba aplanada a puros números de teléfono, así que
 * TODOS llegaban como "manual" y se perdía de quién era cada contacto. Daba
 * igual mientras el mensaje fuera el mismo para todos, pero con los
 * marcadores de Lugar de votación ya no: sin saber a qué votante
 * corresponde cada número, no hay lugar que poner y no se le podría enviar
 * a nadie.
 *
 * El contacto se vuelve a leer de la base para votante/estructura, no se
 * confía en el que manda el navegador: el mensaje puede llevar el Lugar de
 * votación de esa persona, y así solo puede llegar a su propio teléfono o
 * correo. Los escritos a mano siguen tal cual, que para eso están.
 */
async function destinatariosDeSeleccion(seleccion, canal) {
  if (!Array.isArray(seleccion) || !seleccion.length) return [];
  const esCorreo = esCanalDeCorreo(canal);
  const salida = [];
  const idsVotantes = seleccion.filter(d => d.tipo === 'votante' && d.id).map(d => Number(d.id));
  const idsEstructura = seleccion.filter(d => d.tipo === 'estructura' && d.id).map(d => Number(d.id));

  const contactosVotantes = new Map();
  if (idsVotantes.length) {
    const [filas] = await pool.query(
      `SELECT id, nombre, email, telefono, no_contactar FROM votantes WHERE id IN (?)`, [idsVotantes]);
    filas.forEach(f => contactosVotantes.set(f.id, f));
  }
  const contactosEstructura = new Map();
  if (idsEstructura.length) {
    // usuario_id va aparte del id de estructura: el canal Push manda a la
    // CUENTA, y los dos rangos de id se solapan. Sin traerlo, un aviso por
    // selección manual no encontraría el dispositivo de nadie y la campaña
    // saldría entera como "sin contacto", sin un solo error.
    const [filas] = await pool.query(
      `SELECT e.id, e.usuario_id, u.nombre, u.email, u.telefono, u.no_contactar
         FROM estructura e JOIN usuarios u ON u.id = e.usuario_id WHERE e.id IN (?)`, [idsEstructura]);
    filas.forEach(f => contactosEstructura.set(f.id, f));
  }

  for (const d of seleccion) {
    if (d.tipo === 'votante' || d.tipo === 'estructura') {
      const fila = (d.tipo === 'votante' ? contactosVotantes : contactosEstructura).get(Number(d.id));
      if (!fila) continue; // se borró entre que se armó la lista y se envió
      salida.push({
        tipo: d.tipo, id: Number(d.id), usuario_id: fila.usuario_id || null,
        nombre: fila.nombre.trim(),
        contacto: esCorreo ? (fila.email || null) : (fila.telefono || null),
        // La baja manda sobre todo lo demas, tambien en lo que se elige uno por uno: sin esto, quien pidio no
        // recibir mas y estaba entre los elegidos recibia el mensaje igual (la lista de seleccion nunca la miraba).
        dado_de_baja: !!fila.no_contactar,
        detalle: d.detalle || ''
      });
    } else if (d.contacto) {
      salida.push({ tipo: 'manual', id: null, nombre: d.nombre || d.contacto, contacto: d.contacto, detalle: 'Agregado manualmente' });
    }
  }

  /* LO ESCRITO A MANO TAMBIEN SE BUSCA EN LA BASE, igual que en la otra puerta.
     Esta pantalla arma la lista antes de escribir el mensaje y mezcla gente
     elegida con numeros tecleados; los elegidos se leian de la base y los
     tecleados no, aunque fueran de la misma persona.

     LO QUE COSTABA. El 27 de agosto de 2026 salio de la campaña municipal un
     envio a un numero tecleado a mano que ya era el de un votante registrado
     desde el 31 de julio. Como quedo de tipo «manual» y sin id:

       · `{nombre}` se relleno con el propio numero: «Hola <el numero>».
       · `{baja}` se relleno con NADA. El codigo de baja es un HMAC de
         «tipo:id» y 'manual' no es un tipo firmable, asi que el mensaje
         prometia «Para no recibir mas:» y no daba ninguna salida.
       · los marcadores de Lugar de votacion se habrian saltado a esa persona
         aunque su puesto estuviera registrado.

     En el MISMO envio, el otro destinatario —elegido de la lista— salio bien.
     La diferencia no era la persona: era por que puerta entro.

     Se resuelve en un solo lote y se pisa la ficha en su sitio, para no
     alterar el orden que eligio quien escribe. */
  const tecleados = salida.filter(d => d.tipo === 'manual');
  if (tecleados.length) {
    const resueltos = await resolverManualesContraLaBase(tecleados, canal);
    tecleados.forEach((m, i) => { if (resueltos[i] !== m) Object.assign(m, resueltos[i]); });
  }
  return salida;
}

/** "email" (SendGrid, CRM masivo) y "email_personal" (Hostinger, grupos pequeños) usan el mismo dato de contacto: el correo. */
function esCanalDeCorreo(canal) {
  return canal === 'email' || canal === 'email_personal';
}

/**
 * Arma y ejecuta las consultas de Votantes y/o Estructura según los
 * filtros elegidos, y devuelve una lista unificada de destinatarios con
 * el dato de contacto que corresponde al canal (email o teléfono).
 */
/**
 * ¿Esta persona autorizó que le escriban por este canal?
 *
 * NULL NO ES «NO»: es «no consta». Son los registros anteriores a que el
 * formulario preguntara canal por canal, y siguen recibiendo como siempre —
 * decidido así a propósito: exigirles la autorización nueva habría dejado sin
 * mensajes a toda la base ya registrada hasta volver a preguntarle a cada
 * persona, una por una.
 *
 * Solo un 0 explícito bloquea, y ese 0 solo lo escribe alguien que preguntó y
 * recibió un no.
 *
 * El correo personal (email_personal) y el masivo son el mismo dato de
 * contacto, así que comparten autorización. Push no pregunta: se instala en el
 * teléfono de quien tiene cuenta y se activa desde el propio aparato.
 */
function autorizaCanal(fila, canal) {
  const columna = canal === 'sms' ? 'consentimiento_sms'
    : esCanalDeCorreo(canal) ? 'consentimiento_email'
    : null;
  if (!columna) return true;
  return fila[columna] === null || fila[columna] === undefined || Number(fila[columna]) === 1;
}

async function obtenerDestinatarios(filtros, canal, alcance = null) {
  // "seleccion" y "manual" traen la lista ya hecha: no se consulta nada
  // masivo, o se agregarían destinatarios que nadie pidió.
  const fuente = filtros.fuente || 'ambos';
  const resultados = [];

  /* «MIS VOTANTES QUE AÚN NO HAN VOTADO» (Día D, fase 2). A diferencia de las
     otras fuentes, ESTA SÍ SE ACOTA POR QUIEN PREGUNTA: lo que hace es leer el
     alcance del usuario (la misma condición del listado de Votantes). Un líder
     que la elija escribe a SUS votantes, no a toda la base. Sin `req.alcance` no
     devuelve a nadie: acotar a nadie es el error seguro. */
  if (fuente === 'mis_votantes_sin_voto') {
    if (!alcance) return [];
    const [filas] = await pool.query(`
      SELECT v.id, v.nombre, v.email, v.telefono, v.categoria, v.puesto_votacion, v.mesa_votacion,
             v.no_contactar, v.consentimiento_email, v.consentimiento_sms, v.consentimiento_whatsapp
        FROM votantes v
        LEFT JOIN votante_votos vv ON vv.votante_id = v.id
       WHERE vv.votante_id IS NULL AND ${condicionAlcanceVotantes(alcance, 'v')}`,
      parametrosAlcanceVotantes(alcance));
    filas.forEach(f => resultados.push({
      tipo: 'votante', id: f.id, nombre: f.nombre.trim(),
      contacto: esCanalDeCorreo(canal) ? (f.email || null) : (f.telefono || null),
      sin_lugar_votacion: !(f.puesto_votacion && String(f.puesto_votacion).trim()),
      sin_autorizacion: !autorizaCanal(f, canal),
      dado_de_baja: !!f.no_contactar,
      detalle: ['Votante sin votar', f.puesto_votacion ? `Puesto: ${f.puesto_votacion}${f.mesa_votacion ? ' · Mesa ' + f.mesa_votacion : ''}` : null]
        .filter(Boolean).join(' · '),
    }));
  }

  if (fuente === 'votantes' || fuente === 'ambos') {
    const condiciones = [];
    const params = [];
    if (filtros.territorio_id) {
      condiciones.push('(v.territorio_id = ? OR t.padre_id = ?)');
      params.push(filtros.territorio_id, filtros.territorio_id);
    }
    if (filtros.categoria) {
      condiciones.push('v.categoria = ?');
      params.push(filtros.categoria);
    }
    // Puesto de votación: es el corte natural para el Día D — "todos los
    // que votan en tal puesto". A diferencia del mismo filtro en
    // Estructura, aquí se compara el TEXTO que la persona tiene guardado
    // en su Lugar de votación, porque un votante no tiene puesto_id: la
    // tabla `votantes` guarda el nombre del puesto, no una referencia.
    if (filtros.puesto_votacion) {
      condiciones.push('v.puesto_votacion = ?');
      params.push(filtros.puesto_votacion);
    }
    const whereSql = armarWhereSql(condiciones, 'AND');
    const [filas] = await pool.query(`
      SELECT v.id, v.nombre, v.email, v.telefono,
             v.categoria, t.nombre AS territorio_nombre,
             v.puesto_votacion, v.mesa_votacion, v.no_contactar,
             v.consentimiento_email, v.consentimiento_sms, v.consentimiento_whatsapp
      FROM votantes v
      LEFT JOIN territorios t ON t.id = v.territorio_id
      WHERE 1=1 ${whereSql}
    `, params);
    filas.forEach(f => {
      resultados.push({
        tipo: 'votante', id: f.id, nombre: f.nombre.trim(),
        contacto: esCanalDeCorreo(canal) ? (f.email || null) : (f.telefono || null),
        // Se informa aparte para poder avisar ANTES de enviar cuántos
        // quedarían fuera si el mensaje usa los marcadores de Lugar de
        // votación — mejor saberlo al armar la lista que al ver el reporte.
        sin_lugar_votacion: !(f.puesto_votacion && String(f.puesto_votacion).trim()),
        // No autorizó ESTE canal. Se informa aparte —igual que la baja— para
        // poder decir antes de enviar cuántos quedan fuera y por qué, en vez
        // de que aparezcan como fallidos en el reporte.
        sin_autorizacion: !autorizaCanal(f, canal),
        // Pidió no recibir más mensajes. Se informa aparte en vez de
        // desaparecerlo de la lista: el administrador tiene que ver que esa
        // persona existe y por qué no le llega nada — si simplemente no
        // apareciera, el conteo bajaría sin explicación y alguien la
        // volvería a agregar a mano.
        dado_de_baja: !!f.no_contactar,
        detalle: [
          f.categoria === 'sublider' ? 'Sublíder' : 'Votante',
          f.territorio_nombre,
          f.puesto_votacion ? `Puesto: ${f.puesto_votacion}${f.mesa_votacion ? ' · Mesa ' + f.mesa_votacion : ''}` : null
        ].filter(Boolean).join(' · ')
      });
    });
  }

  // "testigos" es un subconjunto de Estructura (cargo='testigo'): se
  // ofrece como Fuente aparte porque a un testigo/coordinador de puesto se
  // le busca por Puesto de votación, no por Territorio (Comuna/Barrio),
  // que es como se organiza el resto de la Estructura.
  if (fuente === 'estructura' || fuente === 'testigos' || fuente === 'ambos') {
    const condiciones = [];
    const params = [];
    if (filtros.territorio_id) {
      condiciones.push('(e.territorio_id = ? OR t.padre_id = ?)');
      params.push(filtros.territorio_id, filtros.territorio_id);
    }
    if (fuente === 'testigos') {
      condiciones.push(`e.cargo = 'testigo'`);
    } else if (filtros.cargo) {
      condiciones.push('e.cargo = ?');
      params.push(filtros.cargo);
    }
    if (filtros.puesto_votacion) {
      // Se traduce el nombre a id para segmentar por la referencia dura.
      // Si el nombre no existe se filtra a NADIE (= 0), no a todos: un
      // envio vacio se nota y se corrige; uno al publico equivocado no.
      /* EL PUESTO SE BUSCA DENTRO DE LA CAMPAÑA DE QUIEN ENVIA.
         Desde que cada campaña tiene su propia lista hay dos filas distintas
         con el mismo nombre, y esta consulta se quedaba con una cualquiera —
         MySQL no promete orden sin ORDER BY—. Si le tocaba la de la otra
         campaña, el envio quedaba segmentado por un id que ninguno de sus
         testigos tiene: cero destinatarios, y el comentario de arriba explica
         justamente por que eso es preferible a mandarselo a todos… pero aqui
         no seria una eleccion, seria un accidente. */
      const [[pf]] = await pool.query(
        `SELECT id FROM dia_d_puestos_votacion WHERE nombre = ? AND aspirante_id = ?`,
        [filtros.puesto_votacion, await duenoDeLaCampana(pool, req)]);
      // COALESCE: el puesto donde vigila un testigo esta en "estructura" si
      // la persona tiene ademas otro cargo, y en "usuarios" si es testigo
      // puro. Mirar solo uno dejaria fuera del envio a media lista.
      condiciones.push('COALESCE(e.puesto_id, u.puesto_id) = ?');
      params.push(pf ? pf.id : 0);
    }
    condiciones.push('e.activo = 1');
    const whereSql = armarWhereSql(condiciones, 'AND');
    const [filas] = await pool.query(`
      SELECT e.id, e.usuario_id, u.nombre, u.email, u.telefono, e.cargo, e.tipo_testigo,
             COALESCE(e.puesto_votacion, u.puesto_votacion) AS puesto_votacion,
             t.nombre AS territorio_nombre
      FROM estructura e
      JOIN usuarios u ON u.id = e.usuario_id
      LEFT JOIN territorios t ON t.id = e.territorio_id
      WHERE 1=1 ${whereSql}
    `, params);
    filas.forEach(f => {
      const etiquetaCargo = f.cargo === 'testigo'
        ? (f.tipo_testigo === 'puesto' ? 'Coordinador de puesto' : 'Testigo electoral')
        : (ETIQUETAS_CARGO[f.cargo] || f.cargo);
      resultados.push({
        // OJO: `id` es el de la fila de ESTRUCTURA, no el de la persona.
        // `usuario_id` va aparte porque el canal Push manda a la cuenta, y
        // confundirlos entregaría el aviso a otra persona: los dos rangos
        // de id se solapan, así que el error no fallaría, acertaría mal.
        tipo: 'estructura', id: f.id, usuario_id: f.usuario_id, nombre: f.nombre,
        contacto: esCanalDeCorreo(canal) ? (f.email || null) : (f.telefono || null),
        detalle: [etiquetaCargo, f.puesto_votacion || f.territorio_nombre].filter(Boolean).join(' · ')
      });
    });
  }

  // Organigrama: los cargos (con nombre, teléfono y correo) también se
  // pueden usar como destinatarios — sea filtrando explícitamente por
  // "Solo Organigrama", o dentro de "Votantes y Estructura" (que en
  // realidad busca entre las tres fuentes a la vez).
  if (fuente === 'organigrama' || fuente === 'ambos') {
    const condicionesOrg = [];
    const paramsOrg = [];
    if (filtros.organigrama_cargo) {
      condicionesOrg.push('cargo LIKE ?');
      paramsOrg.push(`%${filtros.organigrama_cargo}%`);
    }
    if (filtros.organigrama_nombre) {
      condicionesOrg.push("(nombres LIKE ? OR apellidos LIKE ? OR nombre LIKE ? OR CONCAT(nombres, ' ', apellidos) LIKE ?)");
      const patron = `%${filtros.organigrama_nombre}%`;
      paramsOrg.push(patron, patron, patron, patron);
    }
    if (filtros.organigrama_nivel) {
      condicionesOrg.push('nivel = ?');
      paramsOrg.push(filtros.organigrama_nivel);
    }
    const whereOrg = armarWhereSql(condicionesOrg);
    const [filasOrg] = await pool.query(`
      SELECT id, cargo, nombre, nombres, apellidos, telefono, email, nivel FROM organigrama_nodos ${whereOrg}
    `, paramsOrg);
    filasOrg.forEach(f => {
      const nombreCompleto = (f.nombres || f.apellidos)
        ? [f.nombres, f.apellidos].filter(Boolean).join(' ')
        : (f.nombre || f.cargo);
      resultados.push({
        tipo: 'organigrama', id: f.id, nombre: nombreCompleto,
        contacto: esCanalDeCorreo(canal) ? (f.email || null) : (f.telefono || null),
        detalle: [f.cargo, ETIQUETAS_NIVEL[f.nivel]].filter(Boolean).join(' · ')
      });
    });
  }

  resultados.push(...await destinatariosDeSeleccion(filtros.seleccion, canal));
  resultados.push(...await resolverManualesContraLaBase(parsearDestinatariosManuales(filtros.manual), canal));

  // PUSH: el "contacto" no es un correo ni un teléfono, es la cuenta.
  // Solo tiene contacto quien haya registrado al menos un dispositivo, y
  // eso se resuelve en UNA consulta para toda la lista — no una por
  // persona, que en una campaña de cientos serían cientos de viajes.
  // Un votante o un cargo del organigrama nunca lo tienen: no son cuentas.
  if (canal === 'push') {
    const conDispositivo = await pushSvc.usuariosConDispositivo(resultados.map(d => d.usuario_id));
    resultados.forEach(d => {
      d.contacto = (d.usuario_id && conDispositivo.has(d.usuario_id)) ? String(d.usuario_id) : null;
    });
  }

  // Evita mandar el mensaje dos veces si el mismo número/correo ya venía
  // incluido por el filtro Y además se escribió a mano.
  const vistos = new Set();
  const sinDuplicados = resultados.filter(d => {
    const clave = (d.contacto || '').trim().toLowerCase();
    if (!clave) return true; // sin contacto, se deja pasar (se marcará "sin_contacto" al enviar)
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });

  return sinDuplicados;
}

/**
 * Igual que obtenerDestinatarios, pero recibe VARIOS grupos de filtros
 * (cada uno como los que ya arma "Elige a quién le va a llegar") y junta
 * a todos en una sola lista, sin duplicar a quien coincida con más de un
 * grupo — esto es lo que permite, por ejemplo, mandarle a la vez a
 * "Territorio X" y también a "Nivel 1 del Organigrama" en una misma
 * campaña, agregando un grupo tras otro.
 */
/**
 * El alcance del usuario, SOLO si algún grupo lo necesita («Mis votantes que aún
 * no han votado»). Se calcula aquí y no con un `router.use` porque casi todo este
 * módulo no lo usa, y porque `calcularAlcance` vive en el middleware de la
 * aplicación: solo llena `req.alcance` y llama a `next`, nunca responde.
 */
async function alcanceSiHaceFalta(req, res, grupos) {
  const lista = Array.isArray(grupos) ? grupos : [grupos];
  if (!lista.some(g => g && g.fuente === 'mis_votantes_sin_voto')) return null;
  if (!req.alcance) {
    await new Promise((ok, no) => calcularAlcance(req, res, (e) => (e ? no(e) : ok())));
  }
  return req.alcance || null;
}

/**
 * «PENDIENTE DE CONFIRMAR»: quien se inscribió solo por el enlace de un líder
 * (origen 'enlace_lider') y todavía no abrió /c para confirmar. Nadie comprobó que
 * ese celular sea suyo ni que fuera ella quien aceptó, así que NO ENTRA EN ENVÍOS
 * MASIVOS —de ningún canal— hasta que confirme. Es la regla de la orden 23.
 *
 * Se marca como `sin_autorizacion` (el mismo estado y el mismo conteo aparte que
 * ya usan los demás sin autorización) y con `pendiente_confirmar` para quien
 * quiera distinguirlo. Se aplica UNA vez, sobre la lista final, y no dentro de
 * cada fuente: hay cuatro maneras de armar destinatarios (filtros, selección,
 * escritos a mano y «mis votantes sin voto») y una regla repartida en cuatro
 * sitios se pierde en el quinto.
 *
 * Solo toca a los que tienen origen 'enlace_lider': el resto de la base, con su
 * NULL de «no consta», sigue recibiendo como siempre.
 */
async function marcarPendientesDeConfirmar(destinatarios) {
  const ids = [...new Set(destinatarios.filter(d => d.tipo === 'votante' && d.id).map(d => Number(d.id)))];
  if (!ids.length) return destinatarios;
  const pendientes = new Set();
  for (let i = 0; i < ids.length; i += 5000) {
    const [filas] = await pool.query(
      `SELECT id FROM votantes
        WHERE id IN (?) AND origen = 'enlace_lider' AND consentimiento_confirmado_en IS NULL`,
      [ids.slice(i, i + 5000)]);
    filas.forEach(f => pendientes.add(f.id));
  }
  for (const d of destinatarios) {
    if (d.tipo === 'votante' && d.id && pendientes.has(Number(d.id))) {
      d.sin_autorizacion = true;
      d.pendiente_confirmar = true;
    }
  }
  return destinatarios;
}

async function esPendienteDeConfirmar(votanteId) {
  const [[f]] = await pool.query(
    `SELECT 1 AS p FROM votantes WHERE id = ? AND origen = 'enlace_lider' AND consentimiento_confirmado_en IS NULL`,
    [votanteId]);
  return !!f;
}

const MARCADOR_ENLACE = /\{enlace_ya_vote\}/i;

/**
 * LA REGLA ESTRICTA DEL ENLACE «YA VOTÉ». Solo se aplica a un mensaje que lleva
 * `{enlace_ya_vote}`; la regla general del módulo NO cambia.
 *
 * Un enlace que registra un dato electoral no se manda a quien «no dijo que no»:
 * se manda solo a quien dijo que SÍ. Por eso aquí el consentimiento NULL —«no
 * consta», que en el resto del módulo deja pasar— EXCLUYE, igual que un 0. Y
 * excluye a quien no es un votante registrado (no hay ficha donde constar su
 * consentimiento) y a quien pidió la baja.
 *
 * Quien queda fuera por tener el consentimiento en NULL se cuenta APARTE
 * (`sin_autorizacion_registrada`): el administrador tiene que poder distinguir
 * «dijo que no» de «nunca le preguntamos».
 */
async function aplicarReglaDelEnlace(destinatarios, canal) {
  const columna = canal === 'sms' ? 'consentimiento_sms' : null;
  const ids = destinatarios.filter(d => d.tipo === 'votante' && d.id).map(d => Number(d.id));
  const filas = new Map();
  if (ids.length && columna) {
    const [r] = await pool.query(
      `SELECT id, no_contactar, ${columna} AS consentimiento FROM votantes WHERE id IN (?)`, [ids]);
    r.forEach(f => filas.set(f.id, f));
  }
  for (const d of destinatarios) {
    const f = d.tipo === 'votante' && d.id ? filas.get(Number(d.id)) : null;
    if (!f) { d.sin_autorizacion = true; d.sin_autorizacion_registrada = true; continue; }
    if (Number(f.no_contactar) === 1) d.dado_de_baja = true;
    if (Number(f.consentimiento) !== 1) {
      d.sin_autorizacion = true;
      if (f.consentimiento === null || f.consentimiento === undefined) d.sin_autorizacion_registrada = true;
    } else {
      d.sin_autorizacion = false;
    }
  }
  return destinatarios;
}

async function obtenerDestinatariosDeGrupos(grupos, canal, alcance = null) {
  if (!Array.isArray(grupos)) grupos = [grupos]; // compatibilidad: también acepta un solo grupo suelto
  const resultados = [];
  for (const grupo of grupos) {
    resultados.push(...await obtenerDestinatarios(grupo || {}, canal, alcance));
  }
  const vistos = new Set();
  return resultados.filter(d => {
    const clave = (d.contacto || '').trim().toLowerCase();
    if (!clave) return true;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

// Estado de configuración de cada canal (para mostrar en la interfaz cuáles ya se pueden usar).
// WhatsApp no aparece: está desactivado en toda la aplicación (ver POST /campanas).
router.get('/estado-canales', async (req, res) => {
  // LA FIRMA VIAJA CON EL ESTADO DEL CANAL para que el contador del navegador
  // pueda descontarla. La CRC obliga al proveedor a pegarla a cada SMS y ocupa
  // sitio en el segmento: sin este dato la pantalla diría "1 SMS" mientras el
  // proveedor cobra 2. Medida en un mensaje real, no supuesta.
  const sms = await smsSvc.estadoCanal();
  try {
    const cfg = await smsSvc.configCampana();
    sms.firma = cfg.firma || '';
    // Para que el contador sume (o no) los 78 caracteres del enlace.
    sms.baja_automatica = cfg.bajaAutomatica !== false;
  } catch (_) {
    sms.firma = '';   // sin tabla de ajustes todavía: se cuenta como antes
    sms.baja_automatica = true;
  }
  res.json({
    email: await sendgridSvc.estadoCanal(),
    email_personal: { configurado: true, motivo: null }, // reutiliza el SMTP de Hostinger, ya configurado para toda la app
    sms,
    push: pushSvc.estadoCanal()
  });
});

/* ------------------------------------------------------------------
   RESPUESTAS RECIBIDAS

   Lo que la gente contesta por SMS o WhatsApp llega por
   /webhooks/twilio/entrante y se guarda en comunicaciones_respuestas.
   Aquí solo se lee. Sin esta pantalla, las respuestas quedarían guardadas
   e invisibles, que es casi lo mismo que no tenerlas.
   ------------------------------------------------------------------ */
router.get('/respuestas', async (req, res) => {
  try {
    const soloNuevas = req.query.no_leidas === '1';
    const [filas] = await pool.query(
      `SELECT id, canal, de_contacto, mensaje, nombre_resuelto, votante_id, usuario_id,
              accion, leida, recibido_en
         FROM comunicaciones_respuestas
        ${soloNuevas ? 'WHERE leida = 0' : ''}
        ORDER BY recibido_en DESC
        LIMIT 200`);
    const [[conteo]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(leida = 0) AS sin_leer, SUM(accion = 'baja') AS bajas
         FROM comunicaciones_respuestas`);
    res.json({ respuestas: filas, conteo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error leyendo las respuestas recibidas.' });
  }
});

router.post('/respuestas/:id/leida', async (req, res) => {
  try {
    await pool.query(`UPDATE comunicaciones_respuestas SET leida = 1 WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo marcar como leída.' });
  }
});

/**
 * Reintentar los que fallaron.
 *
 * Solo toca los que están en 'fallido': un fallo suele ser del momento
 * (el proveedor rechazó, se cayó la red) y reintentar el envío completo
 * volvería a escribirle a quien YA recibió el mensaje. Los 'sin_contacto',
 * 'sin_lugar_votacion' y 'dado_de_baja' no se tocan: esos no fallaron, y
 * reintentarlos no cambiaría nada — o, en el caso de la baja, sería
 * pasarle por encima a lo que la persona pidió.
 */
router.post('/campanas/:id/reintentar-fallidos', async (req, res) => {
  try {
    const r = await reintentarFallidos(Number(req.params.id));
    if (r.enProceso) return res.status(409).json({ error: 'Esta campaña todavía se está enviando. Espera a que termine para reintentar los que fallaron.' });
    res.json({ ok: true, reintentados: r.reintentados });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron reintentar los envíos fallidos.' });
  }
});

/* ------------------------------------------------------------------
   PLANTILLAS

   Guardar el texto que ya se escribió una vez. Nada sofisticado: las
   campañas repiten los mismos cuatro o cinco mensajes (invitación,
   recordatorio, lugar de votación, agradecimiento) y hoy hay que
   teclearlos de nuevo cada vez, con el riesgo de que cada versión salga
   distinta.
   ------------------------------------------------------------------ */
router.get('/plantillas', async (req, res) => {
  try {
    const [filas] = await pool.query(
      `SELECT id, nombre, canal, asunto, cuerpo, created_at
         FROM comunicaciones_plantillas ORDER BY nombre`);
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error leyendo las plantillas.' });
  }
});

router.post('/plantillas', async (req, res) => {
  const { nombre, canal, asunto, cuerpo } = req.body;
  if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'La plantilla necesita un nombre.' });
  if (!cuerpo || !String(cuerpo).trim()) return res.status(400).json({ error: 'La plantilla está vacía.' });
  try {
    // Guardar con un nombre que ya existe REEMPLAZA el texto, en vez de
    // fallar con "nombre duplicado": quien escribe el mismo nombre casi
    // siempre está corrigiendo la plantilla, no creando otra.
    await pool.query(
      `INSERT INTO comunicaciones_plantillas (nombre, canal, asunto, cuerpo, creado_por)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE canal = VALUES(canal), asunto = VALUES(asunto), cuerpo = VALUES(cuerpo)`,
      [String(nombre).trim(), ['sms','email','push'].includes(canal) ? canal : 'cualquiera',
       asunto || null, cuerpo, req.session.usuario.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar la plantilla.' });
  }
});

router.delete('/plantillas/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM comunicaciones_plantillas WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar la plantilla.' });
  }
});

// Vista previa: cuántos destinatarios y una muestra, según los filtros — antes de enviar nada.
router.post('/destinatarios/preview', async (req, res) => {
  try {
    const { filtros, canal, completo, mensaje } = req.body;
    const alcance = await alcanceSiHaceFalta(req, res, filtros || {});
    let destinatarios = await obtenerDestinatariosDeGrupos(filtros || {}, canal || 'email', alcance);
    // Un mensaje con {enlace_ya_vote} se manda solo con consentimiento explícito.
    const conEnlace = MARCADOR_ENLACE.test(String(mensaje || ''));
    if (conEnlace) destinatarios = await aplicarReglaDelEnlace(destinatarios, canal || 'sms');
    destinatarios = await marcarPendientesDeConfirmar(destinatarios);
    // Quien pidió la baja no cuenta como "con contacto": tiene teléfono o
    // correo, pero no se le va a escribir. Sumarlo ahí haría prometer más
    // envíos de los que van a ocurrir. Lo mismo con quien no autorizó ESTE
    // canal, que se cuenta aparte para que la diferencia se vea: una cosa es
    // «no tenemos su número» y otra «nos dijo que no por aquí».
    const conContacto = destinatarios.filter(d => d.contacto && !d.dado_de_baja && !d.sin_autorizacion);
    const dadosDeBaja = destinatarios.filter(d => d.dado_de_baja).length;
    const sinAutorizacion = destinatarios.filter(d => d.sin_autorizacion && !d.dado_de_baja).length;
    res.json({
      total: destinatarios.length,
      conContacto: conContacto.length,
      sinContacto: destinatarios.filter(d => !d.contacto).length,
      dadosDeBaja,
      sinAutorizacion,
      // Solo con {enlace_ya_vote}: quienes quedan fuera por NO TENER registrada su
      // autorización (consentimiento en blanco), aparte de los que dijeron que no.
      sinAutorizacionRegistrada: conEnlace
        ? destinatarios.filter(d => d.sin_autorizacion_registrada && !d.dado_de_baja).length : 0,
      muestra: destinatarios.slice(0, 8),
      // "completo" trae la lista entera (con contacto) — la usan las
      // pantallas de Enviar E-mail/SMS para agregar de un tirón
      // a todo un grupo/subgrupo a los Seleccionados, no solo mostrar una
      // muestra de 8.
      destinatarios: completo ? conContacto : undefined
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error calculando los destinatarios.' });
  }
});

// Búsqueda de contactos para el selector manual de "Enviar SMS" y
// "Enviar E-mail" — trae de Votantes y Estructura a quienes su nombre
// coincida con lo buscado y tengan el dato de contacto que ese canal
// necesita (sin eso, no tendría sentido poder elegirlos).
//
// El canal por omisión es "sms" y antes era "whatsapp": lo único que
// decide es si el dato de contacto es el teléfono o el correo (ver
// esCanalDeCorreo), así que el comportamiento no cambia.
router.get('/destinatarios/buscar', async (req, res) => {
  try {
    const canal = req.query.canal || 'sms';
    const texto = String(req.query.q || '').trim().toLowerCase();
    if (texto.length < 2) return res.json([]);

    const todos = await obtenerDestinatarios({ fuente: 'ambos' }, canal);
    // Se busca tanto en el nombre como en el "detalle" (que para Organigrama
    // trae el Cargo y el Nivel, y para Estructura trae el Cargo y el
    // Territorio) — así, escribir un cargo o un nivel también encuentra a
    // la persona, no solo escribir su nombre.
    const coincidencias = todos
      .filter(d => d.contacto && `${d.nombre} ${d.detalle || ''}`.toLowerCase().includes(texto))
      .slice(0, 25);
    res.json(coincidencias);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error buscando contactos.' });
  }
});

// Historial de campañas enviadas/en borrador.
router.get('/campanas', async (req, res) => {
  try {
    // OMITIDOS: los destinatarios que no se enviaron y tampoco fallaron —
    // sin lugar de votación, sin dato de contacto, dados de baja, sin
    // autorización. No estaban en ninguna columna, así que un envío donde
    // se omitió a TODOS se veía como "Enviado · 1 destinatario · 0 enviados
    // · 0 fallidos": las cuentas no cerraban y la pantalla daba por bueno
    // un mensaje que nadie recibió.
    //
    // Se cuenta por descarte y no con una lista de estados omitidos, para
    // que un estado nuevo entre solo en vez de quedarse invisible como
    // estos. 'pendiente' queda fuera: ese todavía va en camino.
    const [filas] = await pool.query(`
      SELECT c.*, u.nombre AS creado_por_nombre,
             (SELECT COUNT(*) FROM comunicaciones_envios e
               WHERE e.campana_id = c.id
                 AND e.estado NOT IN ('enviado', 'fallido', 'pendiente')) AS omitidos
      FROM comunicaciones_campanas c
      LEFT JOIN usuarios u ON u.id = c.created_by
      ORDER BY c.created_at DESC
      LIMIT 100
    `);
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo el historial de campañas.' });
  }
});

// Elimina TODAS las campañas del CRM (y sus envíos, en cascada) — solo
// admin, con confirmación de contraseña por lo irreversible de la
// acción. Pensado para limpiar el historial de pruebas/campañas viejas.
// Elimina campañas del CRM (y sus envíos, en cascada) — solo admin, con
// confirmación de contraseña por lo irreversible de la acción. Si se
// manda "canal" en el body, solo borra las de ese canal (ej. solo
// SMS); si no se manda, borra TODAS sin importar el canal.
router.delete('/campanas', requireRole('admin'), async (req, res) => {
  const autorizado = await verificarPasswordAdmin(req.body && req.body.password);
  if (!autorizado) {
    return res.status(403).json({ error: 'Contraseña de administrador incorrecta.' });
  }
  /* El hermano masivo de la ruta de abajo, y tampoco dejaba rastro. Dejar solo
     una de las dos auditada reproduciría dentro de este archivo la misma
     asimetría que se está corrigiendo en toda la aplicación. */
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
    const canal = req.body && req.body.canal;
    const [[t]] = canal
      ? await conexion.query(
          `SELECT COUNT(*) AS campanas, COALESCE(SUM(enviados),0) AS enviados,
                  (SELECT COUNT(*) FROM comunicaciones_envios e
                    JOIN comunicaciones_campanas c2 ON c2.id = e.campana_id
                   WHERE c2.canal = ?) AS envios
             FROM comunicaciones_campanas WHERE canal = ?`, [canal, canal])
      : await conexion.query(
          `SELECT COUNT(*) AS campanas, COALESCE(SUM(enviados),0) AS enviados,
                  (SELECT COUNT(*) FROM comunicaciones_envios) AS envios
             FROM comunicaciones_campanas`);

    const detalle = `Eliminó de un golpe ${t.campanas} ${t.campanas === 1 ? 'campaña' : 'campañas'}`
      + (canal ? ` del canal ${canal}` : ' de todos los canales')
      + `, que sumaban ${t.enviados} mensajes enviados.`
      + (t.envios > 0 ? ` Con ellas se borraron ${t.envios} registros de envío.` : '');

    await registrarAuditoriaEn(
      conexion, req.session.usuario.id, 'eliminar_masivo', 'comunicaciones_campanas', null,
      detalle, req.ip
    );

    const [resultado] = canal
      ? await conexion.query(`DELETE FROM comunicaciones_campanas WHERE canal = ?`, [canal])
      : await conexion.query(`DELETE FROM comunicaciones_campanas`);
    await conexion.commit();
    res.json({ ok: true, eliminadas: resultado.affectedRows });
  } catch (err) {
    /* El rollback va protegido: si lo que falló fue la conexión misma —MySQL
       reiniciado, `wait_timeout`, un KILL— también lanza, y sin esto el
       `res.status(500)` de abajo no llegaría a ejecutarse nunca. */
    if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
    console.error(err);
    res.status(500).json({ error: 'Error eliminando las campañas.' });
  } finally {
    if (conexion) conexion.release();
  }
});

// Elimina UNA sola campaña puntual (y sus envíos, en cascada). Disponible
// para los mismos roles que ya pueden usar este módulo — al ser un solo
// registro (no un borrado masivo), no pide contraseña de administrador.
/* QUEDA CONSTANCIA, Y LO QUE SE PIERDE ES LA PRUEBA DE ENVÍO.
 *
 * Borrar una campaña se lleva en cascada sus `comunicaciones_envios`: a quién
 * se le escribió, a qué número o correo, y con qué resultado. Ese historial es
 * lo que permite responder «a esta persona nunca se le mandó nada» cuando
 * alguien reclama — y es la contrapartida de la lista de bajas, que sí se
 * conserva. Sin él, la campaña queda sin forma de demostrar lo que hizo.
 *
 * Esta ruta NO pide contraseña, a diferencia del borrado de todas: es una sola
 * fila y así estaba decidido. El apunte no cambia esa decisión — la
 * complementa, que es lo que faltaba. */
router.delete('/campanas/:id', async (req, res) => {
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
    const [[c]] = await conexion.query(
      `SELECT c.id, c.nombre, c.canal, c.estado, c.total_destinatarios, c.enviados, c.fallidos,
              u.nombre AS creada_por,
              (SELECT COUNT(*) FROM comunicaciones_envios e WHERE e.campana_id = c.id) AS envios
         FROM comunicaciones_campanas c
         LEFT JOIN usuarios u ON u.id = c.created_by
        WHERE c.id = ?`, [req.params.id]);
    if (!c) {
      await conexion.rollback();
      return res.status(404).json({ error: 'Esa campaña ya no existe.' });
    }

    const detalle = `Eliminó la campaña de ${c.canal} «${c.nombre}», en estado ${c.estado}`
      + `, con ${c.total_destinatarios} ${c.total_destinatarios === 1 ? 'destinatario' : 'destinatarios'}`
      + ` (${c.enviados} ${c.enviados === 1 ? 'enviado' : 'enviados'}, ${c.fallidos} ${c.fallidos === 1 ? 'fallido' : 'fallidos'}).`
      + ` El identificador era ${c.id}`
      + (c.creada_por ? `; la había creado ${c.creada_por}.` : '.')
      + (c.envios > 0
          ? ` Con ella se ${c.envios === 1 ? 'borró 1 registro de envío, que era' : `borraron ${c.envios} registros de envío, que eran`} la constancia de a quién se le escribió.`
          : '');

    await registrarAuditoriaEn(
      conexion, req.session.usuario.id, 'eliminar_campana', 'comunicaciones_campanas', c.id,
      detalle, req.ip
    );

    const [resultado] = await conexion.query(`DELETE FROM comunicaciones_campanas WHERE id = ?`, [req.params.id]);
    if (resultado.affectedRows === 0) {
      await conexion.rollback();
      return res.status(404).json({ error: 'Esa campaña ya no existe.' });
    }
    await conexion.commit();
    res.json({ ok: true });
  } catch (err) {
    /* El rollback va protegido: si lo que falló fue la conexión misma —MySQL
       reiniciado, `wait_timeout`, un KILL— también lanza, y sin esto el
       `res.status(500)` de abajo no llegaría a ejecutarse nunca. */
    if (conexion) { try { await conexion.rollback(); } catch (_) { /* la conexión ya no sirve */ } }
    console.error(err);
    res.status(500).json({ error: 'Error eliminando la campaña.' });
  } finally {
    if (conexion) conexion.release();
  }
});

// Detalle de una campaña: quién recibió el mensaje y con qué resultado.
router.get('/campanas/:id', async (req, res) => {
  try {
    const [[campana]] = await pool.query(`SELECT * FROM comunicaciones_campanas WHERE id = ?`, [req.params.id]);
    if (!campana) return res.status(404).json({ error: 'Campaña no encontrada.' });
    const [envios] = await pool.query(
      `SELECT * FROM comunicaciones_envios WHERE campana_id = ? ORDER BY id`,
      [req.params.id]
    );
    // Resumen de entrega. El dato ya llegaba —el webhook de estado de
    // Twilio lo escribe fila por fila— pero solo se devolvían las filas
    // crudas: con 332 destinatarios, saber cómo fue exigía contarlas a
    // ojo. Cada estado se cuenta aparte a propósito: "no llegó" y "no se
    // intentó" son problemas distintos y se arreglan distinto.
    const [[resumen]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(estado = 'enviado')             AS enviados,
              SUM(estado = 'fallido')             AS fallidos,
              SUM(estado = 'pendiente')           AS pendientes,
              SUM(estado = 'sin_contacto')        AS sin_contacto,
              SUM(estado = 'sin_lugar_votacion')  AS sin_lugar_votacion,
              SUM(estado = 'dado_de_baja')        AS dados_de_baja,
              SUM(estado = 'sin_autorizacion')    AS sin_autorizacion,
              SUM(estado = 'omitido')             AS omitidos,
              SUM(estado = 'enviando')            AS enviando
         FROM comunicaciones_envios WHERE campana_id = ?`, [req.params.id]);
    res.json({ campana, envios, resumen });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo el detalle de la campaña.' });
  }
});

/**
 * Envía un solo mensaje por el canal indicado. Lanza error si falla — el
 * llamador decide qué hacer con eso (marcar el envío como fallido).
 * Devuelve el SID de Twilio cuando aplica (SMS) — null para los canales
 * de correo, que no tienen ese concepto.
 *
 * WhatsApp ya no está: Meta prohíbe las campañas políticas en su API de
 * negocios (ver POST /campanas). El parámetro adjuntoUrl se conserva
 * porque era exclusivo de ese canal y hoy siempre llega en null.
 */
async function enviarUno(canal, contacto, asunto, mensaje, adjuntoUrl, statusCallbackUrl, urlBaja, ctx = {}) {
  if (canal === 'email') {
    await sendgridSvc.enviarCorreoMasivo(contacto, asunto, mensaje, urlBaja);
    return null;
  } else if (canal === 'email_personal') {
    await enviarCorreoPersonal(contacto, asunto, mensaje, urlBaja);
    return null;
  } else if (canal === 'sms') {
    // statusCallbackUrl se sigue pasando pero HOY NO SE USA: Onurix no avisa
    // el cambio de estado como hacía Twilio. Hasta que exista el webhook
    // (punto 8), un SMS queda en 'aceptado' y no pasa a 'entregado'.
    // `loteId` y `contactoId` dejan en la bitácora de SMS de QUÉ campaña y de QUÉ fila salió: con eso se reconcilia
    // una fila que quedó en 'enviando' tras un reinicio (reconciliarEnviando).
    const { sid } = await smsSvc.enviarSMS(contacto, mensaje, statusCallbackUrl, { origen: 'crm', loteId: ctx.loteId, contactoId: ctx.contactoId });
    return sid;
  } else if (canal === 'push') {
    // Aquí `contacto` es el usuario_id (ver obtenerDestinatarios). El
    // asunto hace de título del aviso: en push el título se ve siempre,
    // el cuerpo puede quedar recortado por el sistema.
    const { entregados } = await pushSvc.enviarAUsuario(Number(contacto), {
      titulo: asunto || 'Aviso de la campaña',
      cuerpo: mensaje
    });
    // No hay SID: se deja constancia de en cuántos dispositivos entró.
    return `push:${entregados}`;
  } else {
    throw new Error('Canal no reconocido.');
  }
}

/**
 * Marcadores que se reemplazan en el texto del mensaje, uno por
 * destinatario. `{nombre}` es el de siempre; los del Lugar de votación se
 * agregaron para el Día D, donde el mensaje útil es justamente el que le
 * dice a cada quien DÓNDE le toca votar.
 */
const MARCADORES_LUGAR = ['{puesto}', '{mesa}', '{municipio}', '{departamento}', '{lugar_votacion}'];

/**
 * Lugar de votación de un destinatario, según de dónde salió.
 *
 * Un votante lo tiene en su propia fila. Alguien de Estructura lo tiene
 * repartido entre `estructura` y `usuarios` —según sea testigo puro o
 * tenga además otro cargo—, así que se resuelve con COALESCE, igual que en
 * el resto de la aplicación. Un destinatario agregado a mano no tiene
 * ninguno: sus marcadores quedan vacíos.
 */
async function lugarDeVotacionDe(tipo, id) {
  if (!id) return null;
  if (tipo === 'votante') {
    const [[v]] = await pool.query(
      `SELECT departamento_votacion, municipio_votacion, puesto_votacion, mesa_votacion
         FROM votantes WHERE id = ?`, [id]);
    return v || null;
  }
  if (tipo === 'estructura') {
    const [[e]] = await pool.query(
      `SELECT COALESCE(e.departamento_votacion, u.departamento_votacion) AS departamento_votacion,
              COALESCE(e.municipio_votacion,    u.municipio_votacion)    AS municipio_votacion,
              COALESCE(e.puesto_votacion,       u.puesto_votacion)       AS puesto_votacion,
              COALESCE(e.mesa_votacion,         u.mesa_votacion)         AS mesa_votacion
         FROM estructura e JOIN usuarios u ON u.id = e.usuario_id
        WHERE e.id = ?`, [id]);
    return e || null;
  }
  return null;
}

const MARCADORES_TESTIGO = /\{(puesto_testigo|mesas_testigo)\}/i;

/** Puesto y mesas donde VIGILA un testigo (fila de estructura), o null si no es testigo o no tiene mesa. */
async function datosDeTestigo(tipo, id) {
  if (tipo !== 'estructura' || !id) return null;
  const [[e]] = await pool.query(
    `SELECT e.tipo_testigo, e.mesas_asignadas, COALESCE(e.mesa_votacion, u.mesa_votacion) AS mesa_votacion,
            COALESCE(e.puesto_votacion, u.puesto_votacion) AS puesto
       FROM estructura e JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.id = ? AND e.cargo = 'testigo'`, [id]);
  if (!e) return null;
  const mesas = mesasDeFila(e);
  const puesto = String(e.puesto || '').trim();
  return puesto && mesas.length ? { puesto, mesas } : null;
}

/**
 * Reemplaza los marcadores del mensaje con los datos de ESTE destinatario.
 *
 * La consulta del Lugar de votación solo se hace si el mensaje realmente
 * usa alguno de esos marcadores: un envío masivo corriente no debe pagar
 * una consulta extra por persona.
 *
 * Si a alguien le falta el dato, su marcador queda vacío en vez de escribir
 * "null" o "undefined" en un mensaje que va a leer una persona real.
 */
/**
 * Un marcador que se resuelve vacío (por ejemplo {slogan} sin eslogan
 * configurado) deja espacios de más. En un SMS cada carácter cuenta, así
 * que se quitan los espacios sobrantes al final de cada línea y del
 * mensaje. No se tocan los saltos de línea ni la separación interna: el
 * texto lo escribió una persona y puede tener un formato a propósito.
 */
function limpiarSobrantes(texto) {
  return texto.replace(/[ \t]+$/gm, '').trim();
}

/**
 * Quita la FRASE de baja entera cuando no hay enlace que poner.
 *
 * POR QUE NO BASTA CON DEJAR EL MARCADOR VACIO. Un destinatario escrito a mano
 * que no esta en la base no tiene ficha que dar de baja: el codigo es un HMAC
 * de «tipo:id» y sin id no hay codigo, asi que `{baja}` se resolvia a cadena
 * vacia. El mensaje salia prometiendo una salida y sin darla:
 *
 *     «... Gracias por acompanarnos. Para no recibir mas: »
 *
 * Eso es peor que no prometer nada — quien lo lee cree que el enlace se perdio
 * y no tiene a quien reclamarle. Se prefiere mandar el mensaje sin la frase.
 *
 * SE TRABAJA SOBRE EL TEXTO ORIGINAL, con el marcador todavia puesto. Buscar
 * una frase colgando DESPUES de sustituir seria adivinar: el texto lo escribe
 * cada campaña y «Para no recibir mas:» es solo una de mil formas de decirlo.
 * Con el marcador en su sitio, la frase se delimita sola.
 *
 * Se borra desde el final de la frase anterior —punto, admiracion,
 * interrogacion o salto de linea— hasta el marcador y su puntuacion final. El
 * separador de la izquierda se conserva: si no, «Gracias.» perderia su punto.
 *
 * SI ESO VACIA EL MENSAJE, NO SE TOCA NADA. Un texto que sea solo el enlace no
 * tiene otra cosa que decir, y mandar un SMS vacio falla en el operador — un
 * error nuevo a cambio de arreglar una frase.
 */
function quitarFraseDeBaja(mensaje) {
  let texto = String(mensaje);
  let previo;
  do {
    previo = texto;
    texto = texto.replace(/(^|[.!?\n])[^.!?\n]*\{baja\}[^.!?\n]*[.!?]?/i, (todo, separador) => separador);
  } while (texto !== previo && /\{baja\}/i.test(texto));
  return limpiarSobrantes(texto) ? texto : String(mensaje);
}

/**
 * El texto que se agrega al final de un SMS cuando quien redactó no puso
 * {baja}.
 *
 * POR QUÉ AUTOMÁTICO Y NO UN RECORDATORIO: {baja} era opcional, así que
 * bastaba con olvidarlo para que saliera un envío sin ninguna salida. Un
 * aviso en la pantalla no sirve — quien manda cien mensajes no lo lee — y el
 * fallo no da error: sale perfecto y deja a la gente sin cómo salirse.
 *
 * SOLO SMS. El correo ya lleva su pie y la cabecera List-Unsubscribe, puestos
 * por el propio remitente; agregarlo aquí lo duplicaría. Y a un aviso push no
 * se le pega una URL.
 *
 * CUESTA 77 CARACTERES, y eso no es gratis: con la firma del operador puede
 * empujar el mensaje a un segundo segmento y doblar la factura. Por eso el
 * contador de la pantalla lo suma también (ver public/js/segmentos-sms.js):
 * quien escribe tiene que ver el costo ANTES de enviar, no en el recibo.
 */
function agregarBajaSms(texto, canal, mensajeOriginal, urlBaja, encendido) {
  if (canal !== 'sms' || !urlBaja || encendido === false) return texto;
  // Se mira el mensaje ORIGINAL, no el ya personalizado: en el personalizado
  // {baja} fue reemplazado por la URL y el marcador ya no está, así que
  // buscarlo ahí daría siempre «no lo puso» y lo agregaría dos veces.
  if (/\{baja\}/i.test(String(mensajeOriginal || ''))) return texto;
  /* UN MENSAJE CON {enlace_ya_vote} NO LLEVA EL ENLACE DE BAJA AL FINAL. Esos ~60
     caracteres, más el enlace «Ya voté» y la firma del operador, pasaban de un segmento
     (160) y el mensaje podía NO llegar. La baja vive en la página del propio enlace
     («No quiero recibir más mensajes», /v/<token>?baja=1). Quien quiera el enlace de baja
     igual lo escribe a mano con {baja}, que ya se respetó arriba. */
  if (MARCADOR_ENLACE.test(String(mensajeOriginal || ''))) return texto;
  /* EL AVISO AL TESTIGO TAMPOCO LLEVA «Baja: …». Es un aviso OPERATIVO a alguien del equipo («eres testigo en tal
     puesto, mesa tal»), no un mensaje de campaña al electorado, y esos 78 caracteres lo llevaban siempre a 2 o 3 SMS:
     con el dominio departamental y la firma, el texto solo ya ocupa 147 a 169. Quien quiera la baja ahí la escribe a
     mano con {baja}, que ya se respeto arriba. La lista de «no contactar» SI se respeta (destinatariosDeSeleccion). */
  if (/\{(puesto_testigo|mesas_testigo)\}/i.test(String(mensajeOriginal || ''))) return texto;
  return `${texto} Baja: ${urlBaja}`;
}

async function personalizarMensaje(mensaje, envio, slogan = '', urlBajaBase = null, canal = null, baseEnlace = '') {
  // {slogan} se resuelve aparte de los del Lugar de votación: es el mismo
  // para todos y no debe disparar la búsqueda por persona ni el salto de
  // quien no tenga puesto registrado.
  // {baja} es por persona, como los del Lugar de votación: cada quien recibe
  // SU enlace firmado. Un enlace común daría de baja a quien lo abriera, no a
  // quien lo pidió.
  const codigo = codigoDeBaja(envio.destinatario_tipo, envio.destinatario_id);
  // Se devuelve ADEMAS de sustituirla en el texto: el correo la necesita
  // para la cabecera List-Unsubscribe, exista o no {baja} en el mensaje.
  const urlBaja = codigo ? urlDeBaja(codigo, urlBajaBase) : '';
  // Si esto falla, se sigue con el enlace PUESTO: quedarse sin salida por un
  // fallo al leer un ajuste es peor que gastar 78 caracteres de más.
  let bajaEncendida = true;
  try { bajaEncendida = (await smsSvc.configCampana()).bajaAutomatica !== false; } catch (_) {}
  // Sin enlace, la frase de baja se cae entera en vez de quedar colgando. Las
  // sustituciones siguen corriendo sobre ESTE texto, que puede haber perdido
  // esa frase; `mensaje` se conserva intacto porque `agregarBajaSms` lo mira
  // para saber si quien redacto puso {baja} a mano.
  const plantilla = urlBaja ? mensaje : quitarFraseDeBaja(mensaje);
  /* {enlace_ya_vote}: el enlace «Ya voté» de ESTE votante (se crea o se reutiliza).
     Solo existe para votantes registrados; para cualquier otro destinatario —o si
     no hay con qué armar la URL— se devuelve `faltaEnlace` y quien llama marca el
     envío como fallido en vez de mandar el marcador crudo. */
  let urlYaVote = '';
  if (MARCADOR_ENLACE.test(plantilla)) {
    if (envio.destinatario_tipo !== 'votante' || !envio.destinatario_id || !baseEnlace) {
      return { texto: '', urlBaja, faltaEnlace: true };
    }
    try {
      const mapa = await yaVoto.asegurarEnlaces([envio.destinatario_id], baseEnlace);
      urlYaVote = mapa.get(Number(envio.destinatario_id)) || '';
    } catch (err) {
      return { texto: '', urlBaja, faltaEnlace: true, motivoEnlace: err.message };
    }
  }
  /* {puesto_testigo}, {mesas_testigo} y {enlace_app}: el aviso al TESTIGO (Cobertura de testigos). Los datos son
     los de su fila de estructura —el puesto donde VIGILA y sus mesas, no donde vota—. Quien no sea testigo con
     mesa asignada no recibe el mensaje: se marca como fallido con el motivo, en vez de mandar «eres testigo
     en , mesa » a alguien que no lo es. */
  let puestoTestigo = '';
  let mesasTestigo = '';
  if (MARCADORES_TESTIGO.test(plantilla)) {
    const t = await datosDeTestigo(envio.destinatario_tipo, envio.destinatario_id);
    if (!t) {
      return { texto: '', urlBaja, faltaEnlace: true,
        motivoEnlace: 'Esta persona no es testigo con mesa asignada: el aviso de testigo no se le envia.' };
    }
    puestoTestigo = t.puesto;
    mesasTestigo = listaEnPalabras(t.mesas);
  }
  if (/\{enlace_app\}/i.test(plantilla) && !baseEnlace) {
    return { texto: '', urlBaja, faltaEnlace: true, motivoEnlace: 'No se pudo armar el enlace de la app: falta el dominio de la licencia.' };
  }
  let texto = plantilla
    .replace(/\{puesto_testigo\}/gi, puestoTestigo)
    .replace(/\{mesas_testigo\}/gi, mesasTestigo)
    .replace(/\{enlace_app\}/gi, baseEnlace || '')
    .replace(/\{nombre\}/gi, envio.destinatario_nombre.split(' ')[0])
    .replace(/\{primer_nombre\}/gi, envio.destinatario_nombre.split(' ')[0])
    .replace(/\{enlace_ya_vote\}/gi, urlYaVote)
    .replace(/\{slogan\}/gi, slogan || '')
    .replace(/\{baja\}/gi, urlBaja);
  const minus = plantilla.toLowerCase();
  if (!MARCADORES_LUGAR.some(m => minus.includes(m))) {
    return { texto: agregarBajaSms(limpiarSobrantes(texto), canal, mensaje, urlBaja, bajaEncendida), urlBaja };
  }

  const lugar = await lugarDeVotacionDe(envio.destinatario_tipo, envio.destinatario_id) || {};
  const puesto = (lugar.puesto_votacion || '').trim();
  const mesa = (lugar.mesa_votacion || '').toString().trim();
  const municipio = (lugar.municipio_votacion || '').trim();
  const departamento = (lugar.departamento_votacion || '').trim();
  // Frase armada: solo con las partes que sí existen, para que no queden
  // comas sueltas ni un "Mesa" sin número.
  const completo = [
    puesto ? `Puesto ${puesto}` : null,
    mesa ? `Mesa ${mesa}` : null,
    municipio || null,
    departamento || null
  ].filter(Boolean).join(', ');

  return {
    urlBaja,
    // Sin Puesto no hay mensaje que valga la pena mandar: el resto del
    // Lugar de votación (municipio, departamento) no le dice a nadie a
    // dónde ir. Quien llama decide qué hacer con esto.
    faltaLugar: !puesto,
    texto: agregarBajaSms(limpiarSobrantes(texto
      .replace(/\{lugar_votacion\}/gi, completo)
      .replace(/\{puesto\}/gi, puesto)
      .replace(/\{mesa\}/gi, mesa)
      .replace(/\{municipio\}/gi, municipio)
      .replace(/\{departamento\}/gi, departamento)), canal, mensaje, urlBaja, bajaEncendida),
  };
}

/**
 * Procesa el envío de una campaña en segundo plano: recorre los
 * destinatarios que sigan en estado "pendiente" en comunicaciones_envios,
 * manda su mensaje (reemplazando {nombre} si aparece), y va actualizando
 * esa misma fila con el resultado. Con una pausa corta entre cada uno para
 * no saturar el proveedor. No bloquea la respuesta al navegador — la
 * campaña queda en estado "enviando" y el front puede consultar el
 * progreso con GET /campanas/:id.
 *
 * A propósito solo recibe el campanaId: todo lo demás (canal, mensaje,
 * adjunto, a quién le falta enviar) se lee de la base de datos en vez de
 * recibirse en memoria — así, si el proceso de Node se reinicia a la
 * mitad de un envío grande (algo que sí pasa en este hosting), la MISMA
 * función sirve para reanudar donde se quedó con solo volver a llamarla
 * con el id de la campaña (ver reanudarCampanasPendientes, más abajo),
 * en vez de dejarla colgada en "Enviando..." para siempre.
 */
const campanasEnProceso = new Set();   // UN proceso de Node por campaña: la misma campaña no se envía dos veces a la vez

/* ------------------------------------------------------------------
   QUIÉN ENVÍA, CUÁNTAS VECES Y QUÉ SE VUELVE A MIRAR (recordatorios, Fase 0)

   Tres defectos que podían mandar un mensaje dos veces o mandarlo a quien ya no
   debía recibirlo:

   1. DOS CICLOS SOBRE LAS MISMAS FILAS. «Reintentar fallidos» pasaba las filas a
      'pendiente' y lanzaba otro envío; si el primero seguía en marcha, los dos
      leían la misma lista de pendientes. Ahora cada fila se RECLAMA antes de
      enviarla (UPDATE ... WHERE estado = 'pendiente': solo uno gana) y, además, una
      campaña que ya se está enviando en este proceso no arranca otro ciclo.

   2. UN REINICIO ENTRE «EL PROVEEDOR LO ACEPTÓ» Y «LO ANOTÉ». La fila queda en
      'enviando' antes de llamar al proveedor. Si el proceso muere ahí, al arrancar
      se RECONCILIA con la bitácora de SMS (o se deja 'fallido' con la advertencia):
      nunca se reenvía a ciegas. Reintentarlo es una decisión de una persona.

   3. LA LISTA SE CONGELA AL CREAR LA CAMPAÑA. Una campaña programada para mañana
      conservaba a quien hoy pidió la baja, retiró su autorización o ya votó. Ahora
      cada fila se vuelve a leer justo antes de enviarse (releerAntesDeEnviar).
   ------------------------------------------------------------------ */

/** Reclama UNA fila: solo quien la pasa de 'pendiente' a 'enviando' puede mandarla. */
async function reclamarFila(envioId, proceso) {
  const [r] = await pool.query(
    `UPDATE comunicaciones_envios SET estado = 'enviando', reclamado_en = NOW(), proceso = ?
      WHERE id = ? AND estado = 'pendiente'`, [proceso, envioId]);
  return r.affectedRows === 1;
}

/** ¿La campaña es de Día D? Lleva el enlace «Ya voté» o su fuente es «mis votantes que aún no han votado». */
function esCampanaDeDiaD(campana) {
  if (MARCADOR_ENLACE.test(campana.mensaje || '')) return true;
  const f = typeof campana.filtros === 'string' ? campana.filtros : JSON.stringify(campana.filtros || {});
  return f.includes('mis_votantes_sin_voto');
}

/**
 * Lo que ya no aplica ENTRE crear la campaña y enviarla. Devuelve el motivo (texto) o null si se puede enviar.
 * Vuelve a leer la ficha: baja, autorización del canal y, en Día D, si ya votó.
 *   · Autorización: la regla general deja pasar el NULL («no consta») y solo bloquea un 0; con {enlace_ya_vote}
 *     por SMS la regla es la estricta (solo un 1), la misma de aplicarReglaDelEnlace.
 */
async function releerAntesDeEnviar(envio, campana) {
  const canal = campana.canal;
  const diaD = esCampanaDeDiaD(campana);
  const estricta = canal === 'sms' && MARCADOR_ENLACE.test(campana.mensaje || '');
  if (envio.destinatario_tipo === 'votante' && envio.destinatario_id) {
    const [[v]] = await pool.query(
      `SELECT v.no_contactar, v.consentimiento_sms, v.consentimiento_email,
              EXISTS(SELECT 1 FROM votante_votos vv WHERE vv.votante_id = v.id) AS ya_voto
         FROM votantes v WHERE v.id = ?`, [envio.destinatario_id]);
    if (!v) return 'La persona ya no está registrada.';
    if (Number(v.no_contactar) === 1) return 'Pidió no recibir más mensajes: se respetó antes de enviar.';
    const columna = canal === 'sms' ? 'consentimiento_sms' : esCanalDeCorreo(canal) ? 'consentimiento_email' : null;
    if (columna) {
      const valor = v[columna];
      const autoriza = estricta ? Number(valor) === 1 : (valor === null || valor === undefined || Number(valor) === 1);
      if (!autoriza) return estricta && (valor === null || valor === undefined)
        ? 'No consta su autorización por este medio (el enlace «Ya voté» solo va a quien dijo que sí).'
        : 'Retiró su autorización por este medio: se respetó antes de enviar.';
    }
    if (diaD && Number(v.ya_voto) === 1) return 'Ya votó: no hace falta escribirle.';
  } else if (envio.destinatario_tipo === 'estructura' && envio.destinatario_id) {
    const [[u]] = await pool.query(
      `SELECT u.no_contactar FROM estructura e JOIN usuarios u ON u.id = e.usuario_id WHERE e.id = ?`, [envio.destinatario_id]);
    if (u && Number(u.no_contactar) === 1) return 'Pidió no recibir más mensajes: se respetó antes de enviar.';
  }
  return null;
}

/** Una campaña de SMS fuera de franja NO falla: se reprograma para la apertura de la siguiente. */
async function reprogramarPorFranja(campanaId) {
  let minutos = 60;
  try {
    const { minutosHastaLaFranja } = require('../config/bienvenidaAutomatica');
    minutos = Math.max(1, minutosHastaLaFranja(await smsSvc.configCampana()));
  } catch (_) { /* sin config: una hora, y se vuelve a mirar */ }
  await pool.query(
    `UPDATE comunicaciones_campanas SET estado = 'borrador', programado_para = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?`,
    [minutos, campanaId]);
  console.log(`Campaña ${campanaId}: fuera de la franja de SMS, se reprograma para dentro de ${minutos} min (la apertura).`);
}

/** Cierra la campaña si ya no queda ninguna fila por enviar ni en vuelo. */
async function cerrarCampanaSiTermino(campanaId) {
  try {
    const [[campana]] = await pool.query(`SELECT total_destinatarios FROM comunicaciones_campanas WHERE id = ?`, [campanaId]);
    if (!campana) return;
    const [[totales]] = await pool.query(
      `SELECT SUM(estado = 'enviado') AS enviados, SUM(estado = 'fallido') AS fallidos,
              SUM(estado IN ('pendiente','enviando')) AS abiertas
         FROM comunicaciones_envios WHERE campana_id = ?`, [campanaId]);
    // Si sigue habiendo filas abiertas (el proceso se reinició en medio de este ciclo), no se cierra todavía:
    // reanudarCampanasPendientes la retomará en el próximo arranque.
    if (Number(totales.abiertas) > 0) return;
    const fallidos = Number(totales.fallidos) || 0;
    const enviados = Number(totales.enviados) || 0;
    const estadoFinal = fallidos === campana.total_destinatarios && campana.total_destinatarios > 0 ? 'fallido' : 'enviado';
    await pool.query(
      `UPDATE comunicaciones_campanas SET estado = ?, enviados = ?, fallidos = ?, enviado_en = NOW() WHERE id = ?`,
      [estadoFinal, enviados, fallidos, campanaId]);
  } catch (errFinal) {
    // Si esto falla (por ejemplo, porque la campaña se borró justo en el último instante), ya no hay nada más
    // que actualizar — se deja constancia en los logs, sin lanzar el error hacia arriba.
    console.error(`No se pudo guardar el estado final de la campaña ${campanaId}:`, errFinal);
  }
}

/**
 * Las filas que quedaron en 'enviando' (el proceso murió después de reclamarlas) se RECONCILIAN, no se reenvían.
 *   · SMS: se busca en la bitácora (sms_envios, lote «crm-<campaña>», contacto = la fila). Si el proveedor lo aceptó →
 *     'enviado'; si lo rechazó → 'fallido' con su motivo.
 *   · Sin rastro (y para correo y push, que no tienen bitácora): 'fallido' con la advertencia de que NO se pudo
 *     confirmar si salió. «Reintentar fallidos» lo mandaría otra vez, y eso lo decide una persona.
 * `todas`: al arrancar, TODAS las 'enviando' son huérfanas (un solo proceso). Después, solo las de más de `minutos`
 * y que no sean de una campaña que este proceso está enviando ahora mismo.
 */
async function reconciliarEnviando({ todas = false, minutos = 10 } = {}) {
  const [filas] = await pool.query(
    `SELECT e.id, e.campana_id, c.canal
       FROM comunicaciones_envios e JOIN comunicaciones_campanas c ON c.id = e.campana_id
      WHERE e.estado = 'enviando' AND (? OR e.reclamado_en IS NULL OR e.reclamado_en < NOW() - INTERVAL ? MINUTE)`,
    [todas ? 1 : 0, minutos]);
  const tocadas = new Set();
  let n = 0;
  for (const f of filas) {
    if (!todas && campanasEnProceso.has(f.campana_id)) continue;
    let estado = 'fallido';
    let sid = null;
    let motivo = 'Se interrumpió el envío y no se pudo confirmar si el mensaje salió. Revisa con la persona antes de reintentar.';
    if (f.canal === 'sms') {
      try {
        const [[b]] = await pool.query(
          `SELECT estado, proveedor_id, error_mensaje FROM sms_envios WHERE lote_id = ? AND contacto_id = ? ORDER BY id DESC LIMIT 1`,
          [`crm-${f.campana_id}`, f.id]);
        if (b && (b.estado === 'aceptado' || b.estado === 'entregado')) { estado = 'enviado'; sid = b.proveedor_id || null; motivo = null; }
        else if (b && (b.estado === 'fallido' || b.estado === 'rechazado')) motivo = String(b.error_mensaje || 'El proveedor lo rechazó.').slice(0, 250);
      } catch (_) { /* sin bitácora: queda la advertencia */ }
    }
    const [r] = await pool.query(
      `UPDATE comunicaciones_envios SET estado = ?, twilio_sid = COALESCE(?, twilio_sid), error_mensaje = ?,
              enviado_en = IF(? = 'enviado', NOW(), enviado_en)
        WHERE id = ? AND estado = 'enviando'`, [estado, sid, motivo, estado, f.id]);
    if (r.affectedRows) { n++; tocadas.add(f.campana_id); }
  }
  for (const id of tocadas) await cerrarCampanaSiTermino(id);
  if (n) console.log(`Se reconciliaron ${n} envío(s) que quedaron en «enviando».`);
  return n;
}

/** Envío por fila de una campaña. Ver el encabezado de arriba: reclamar, releer, enviar, anotar. */
async function procesarEnvioCampana(campanaId) {
  if (campanasEnProceso.has(campanaId)) {
    console.log(`La campaña ${campanaId} ya se está enviando en este proceso: no se lanza otro ciclo.`);
    return;
  }
  campanasEnProceso.add(campanaId);
  try { await enviarFilasDeLaCampana(campanaId); }
  finally { campanasEnProceso.delete(campanaId); }
}

async function enviarFilasDeLaCampana(campanaId) {
  const [[campana]] = await pool.query(`SELECT * FROM comunicaciones_campanas WHERE id = ?`, [campanaId]);
  if (!campana) {
    console.warn(`La campaña ${campanaId} ya no existe — no hay nada que procesar.`);
    return;
  }
  const { canal, asunto, mensaje, adjunto_url: adjuntoUrl, status_callback_url: statusCallbackUrl } = campana;
  // El eslogan es el mismo para toda la campaña: se lee una vez, no una vez
  // por destinatario. Si está vacío, el marcador queda vacío en vez de
  // escribir "null" en un mensaje que va a leer una persona.
  const [[cfg]] = await pool.query(`SELECT slogan_campana FROM configuracion_campana WHERE id = 1`);
  // La base del enlace de baja se lee UNA vez por campaña, no por
  // destinatario: es la misma para todos y son cientos de mensajes.
  let urlBajaBase = null;
  try {
    const [[c]] = await pool.query(`SELECT url_baja_base FROM sms_config WHERE id = 1`);
    urlBajaBase = c && c.url_baja_base ? c.url_baja_base : null;
  } catch (_) { /* la tabla puede no existir todavía */ }
  const slogan = (cfg && cfg.slogan_campana ? cfg.slogan_campana : '').trim();
  // La base del enlace «Ya voté»: el dominio de la campaña, o —si el .env no lo
  // trae— el origen de la URL de baja, que es del mismo sitio.
  let baseEnlace = yaVoto.baseDelSitio();
  if (!baseEnlace && urlBajaBase) { try { baseEnlace = new URL(urlBajaBase).origin; } catch (_) { /* sin base */ } }

  const [pendientes] = await pool.query(
    `SELECT id, destinatario_tipo, destinatario_id, destinatario_nombre, destinatario_contacto
       FROM comunicaciones_envios WHERE campana_id = ? AND estado = 'pendiente' ORDER BY id`,
    [campanaId]
  );
  const proceso = crypto.randomBytes(6).toString('hex');
  let reprogramada = false;

  for (const envio of pendientes) {
    // Si en medio del envío alguien borró esta campaña (ej. con
    // "Eliminar todas" mientras todavía se estaba enviando), se detiene
    // aquí en vez de seguir intentando actualizar filas de una campaña
    // que ya no existe — eso es justamente lo que la dejaba colgada en
    // "Enviando..." para siempre.
    const [[sigueExistiendo]] = await pool.query(`SELECT id FROM comunicaciones_campanas WHERE id = ?`, [campanaId]);
    if (!sigueExistiendo) {
      console.warn(`La campaña ${campanaId} ya no existe (se borró mientras se enviaba) — se detiene el envío.`);
      return;
    }

    // La fila es de quien la reclama. Si otro ciclo se le adelantó, no se toca.
    if (!(await reclamarFila(envio.id, proceso))) continue;

    // Todo el procesamiento de ESTA fila queda protegido — un problema
    // puntual con un destinatario (incluso al guardar el resultado en la
    // base de datos) nunca debe tumbar el envío completo de la campaña.
    try {
      /* ÚLTIMA GUARDA, la que no depende de cómo se armó la lista: una fila que quedó
         'pendiente' (campaña programada, destinatario agregado después) de alguien que
         se inscribió por enlace y no ha confirmado NO se envía. */
      if (envio.destinatario_tipo === 'votante' && envio.destinatario_id && await esPendienteDeConfirmar(envio.destinatario_id)) {
        await pool.query(
          `UPDATE comunicaciones_envios SET estado = 'sin_autorizacion', error_mensaje = ? WHERE id = ?`,
          ['Se inscribió por el enlace de un líder y aún no confirma su autorización: no recibe envíos masivos.', envio.id]);
        continue;
      }

      // Lo que cambió desde que se armó la lista: baja, autorización del canal y, en Día D, si ya votó.
      const motivoOmitir = await releerAntesDeEnviar(envio, campana);
      if (motivoOmitir) {
        await pool.query(`UPDATE comunicaciones_envios SET estado = 'omitido', error_mensaje = ? WHERE id = ?`,
          [motivoOmitir.slice(0, 250), envio.id]);
        continue;
      }

      const { texto: mensajePersonalizado, faltaLugar, urlBaja, faltaEnlace, motivoEnlace } = await personalizarMensaje(mensaje, envio, slogan, urlBajaBase, canal, baseEnlace);
      if (faltaEnlace) {
        await pool.query(
          `UPDATE comunicaciones_envios SET estado = 'fallido', error_mensaje = ? WHERE id = ?`,
          [String(motivoEnlace || 'No se pudo armar el enlace «Ya voté» para esta persona: solo se envía a votantes registrados.').slice(0, 250), envio.id]);
        continue;
      }
      // Se salta, no se manda a medias. Queda registrado con su motivo para
      // que el administrador sepa a quién le falta completar la ficha.
      if (faltaLugar) {
        await pool.query(
          `UPDATE comunicaciones_envios
              SET estado = 'sin_lugar_votacion',
                  error_mensaje = 'No tiene Puesto de votación registrado — no se envió para no mandar el mensaje con el lugar en blanco.'
            WHERE id = ?`, [envio.id]);
        continue;
      }
      try {
        const sid = await enviarUno(canal, envio.destinatario_contacto, asunto, mensajePersonalizado, adjuntoUrl, statusCallbackUrl, urlBaja,
          { loteId: `crm-${campanaId}`, contactoId: envio.id });
        await pool.query(
          `UPDATE comunicaciones_envios SET estado = 'enviado', twilio_sid = ?, enviado_en = NOW() WHERE id = ?`,
          [sid, envio.id]
        );
      } catch (err) {
        if (err && err.codigo === 'FUERA_DE_FRANJA') {
          // No es un fallo: es la hora. La fila vuelve a la cola y la campaña espera la apertura.
          await pool.query(
            `UPDATE comunicaciones_envios SET estado = 'pendiente', reclamado_en = NULL, proceso = NULL, error_mensaje = NULL WHERE id = ?`, [envio.id]);
          await reprogramarPorFranja(campanaId);
          reprogramada = true;
          break;
        }
        if (err && err.codigo === 'DADO_DE_BAJA') {
          // La baja por número (SMS) que se vuelve a mirar dentro del propio envío.
          await pool.query(`UPDATE comunicaciones_envios SET estado = 'omitido', error_mensaje = ? WHERE id = ?`,
            ['Ese número pidió no recibir más mensajes: se respetó antes de enviar.', envio.id]);
          continue;
        }
        await pool.query(
          `UPDATE comunicaciones_envios SET estado = 'fallido', error_mensaje = ? WHERE id = ?`,
          [String(err.message || err).slice(0, 250), envio.id]
        );
      }
    } catch (errFila) {
      console.error(`Error registrando el resultado para ${envio.destinatario_nombre} en la campaña ${campanaId} (se sigue con el resto):`, errFila);
      // La fila no se queda en 'enviando' para siempre ni vuelve a 'pendiente' (podría reenviarse a ciegas).
      await pool.query(
        `UPDATE comunicaciones_envios SET estado = 'fallido', error_mensaje = ? WHERE id = ? AND estado = 'enviando'`,
        ['Error interno al registrar el resultado: no se pudo confirmar si salió. Revisa antes de reintentar.', envio.id]).catch(() => {});
    }

    // Pausa corta entre envíos — evita ráfagas que un proveedor pueda
    // interpretar como abuso, sobre todo en SMS.
    await new Promise(resolve => setTimeout(resolve, esCanalDeCorreo(canal) ? 300 : 600));
  }

  if (reprogramada) return;   // espera su apertura: el despachador la retoma
  await cerrarCampanaSiTermino(campanaId);
}

/**
 * «Reintentar fallidos»: reclama las filas fallidas (UPDATE ... WHERE estado = 'fallido', con la marca de este proceso)
 * y lanza UN ciclo. Un segundo clic no hace nada: si la campaña se está enviando se le dice que espere, y si ya no hay
 * fallidos que reclamar devuelve 0. Devuelve { reintentados, enProceso }.
 */
async function reintentarFallidos(campanaId) {
  if (campanasEnProceso.has(Number(campanaId))) return { reintentados: 0, enProceso: true };
  const marca = crypto.randomBytes(6).toString('hex');
  const [r] = await pool.query(
    `UPDATE comunicaciones_envios SET estado = 'pendiente', error_mensaje = NULL, reclamado_en = NULL, proceso = ?
      WHERE campana_id = ? AND estado = 'fallido'`, [marca, campanaId]);
  if (!r.affectedRows) return { reintentados: 0, enProceso: false };
  await pool.query(`UPDATE comunicaciones_campanas SET estado = 'enviando' WHERE id = ?`, [campanaId]);
  procesarEnvioCampana(Number(campanaId)).catch(err => console.error(`Error reintentando la campaña ${campanaId}:`, err));
  return { reintentados: r.affectedRows, enProceso: false };
}

/**
 * Se llama UNA vez al arrancar la aplicación (ver app.js): busca campañas
 * que quedaron en "enviando" — la única forma de que eso pase es que el
 * proceso de Node se haya reiniciado a la mitad de un envío — y retoma
 * cada una donde se quedó, en vez de dejarlas colgadas hasta que alguien
 * lo note. ANTES reconcilia las filas que quedaron en 'enviando' (no las reenvía).
 */
async function reanudarCampanasPendientes() {
  try {
    await reconciliarEnviando({ todas: true });
    const [campanas] = await pool.query(`SELECT id FROM comunicaciones_campanas WHERE estado = 'enviando'`);
    if (!campanas.length) return;
    console.log(`Reanudando ${campanas.length} campaña(s) que quedaron a medias en un reinicio anterior...`);
    for (const c of campanas) {
      procesarEnvioCampana(c.id).catch(err => console.error(`Error reanudando la campaña ${c.id}:`, err));
    }
  } catch (err) {
    console.error('Error buscando campañas pendientes de reanudar:', err);
  }
}

// Crea una campaña y arranca el envío. Devuelve de inmediato con el id de
// la campaña — el envío real sigue en segundo plano.
//
// WhatsApp está DESACTIVADO a propósito: Meta prohíbe las campañas
// políticas en su API de negocios (WhatsApp Business), así que usarlo
// arriesga la cuenta. Se apagó en la interfaz y se rechaza aquí, que es
// lo que de verdad cierra la puerta — la pantalla se puede saltar
// llamando a la API directo.
//
// NO se arrancaron los ENUM de la base ni la clasificación de respuestas
// entrantes de webhooks.routes.js: eso es historia, y si Meta cambia de
// política volver a encenderlo es agregar 'whatsapp' a la lista de abajo.
//
// El adjunto (campo "archivo") era exclusivo de WhatsApp, así que hoy no
// lo admite ningún canal.
router.post('/campanas', upload.single('archivo'), async (req, res) => {
  const { nombre, canal, asunto, mensaje } = req.body;
  // Los filtros llegan como texto JSON cuando la petición es multipart (ej.
  // "CRM y Mensajes" enviado como multipart) — ahí no hay forma de
  // mandar un objeto anidado directo. Pero cuando la petición va como JSON
  // normal (ej. "Enviar SMS"/"Enviar E-mail", sin adjunto), Express ya
  // entrega req.body.filtros como objeto, y hacerle JSON.parse() a un
  // objeto fallaba en silencio y lo dejaba vacío — con eso vacío, el envío
  // terminaba interpretando "sin filtro" como "mándale a todo el mundo".
  let filtros = {};
  try {
    filtros = typeof req.body.filtros === 'string'
      ? (req.body.filtros ? JSON.parse(req.body.filtros) : {})
      : (req.body.filtros || {});
  } catch (e) { filtros = {}; }

  if (!nombre || !canal || !mensaje) {
    return res.status(400).json({ error: 'Nombre, canal y mensaje son obligatorios.' });
  }
  if (canal === 'whatsapp') {
    return res.status(400).json({ error: 'El canal WhatsApp no está disponible: Meta no permite campañas políticas en su API de negocios.' });
  }
  if (!['email', 'sms', 'email_personal', 'push'].includes(canal)) {
    return res.status(400).json({ error: 'Canal no válido.' });
  }
  // PUSH SOLO LLEGA A QUIEN TIENE CUENTA EN LA APLICACIÓN.
  // La suscripción cuelga de usuarios.id, así que un votante nunca puede
  // recibirlo, y el organigrama tampoco: `organigrama_nodos` es una tabla
  // aparte, sin cuenta asociada. Se rechaza antes de enviar en vez de
  // dejar salir una campaña que reportaría a casi todos "sin contacto" —
  // un envío vacío se nota tarde y parece un fallo del sistema.
  if (canal === 'push') {
    const grupos = Array.isArray(filtros) ? filtros : [filtros];
    const origenes = grupos.map(g => (g && g.fuente) || 'ambos');
    // 'seleccion' entra: es la pantalla "Aviso en la app", donde se eligen
    // personas concretas una por una y la propia lista ya muestra quién
    // puede recibirlo. Lo que se bloquea es disparar contra un PÚBLICO que
    // en su mayoría no tiene cuenta, no elegir a alguien a dedo.
    const validos = ['estructura', 'testigos', 'seleccion'];
    if (!origenes.every(o => validos.includes(o))) {
      return res.status(400).json({
        error: 'Los avisos push solo llegan a quien tiene cuenta en la aplicación. Elija "Estructura" o "Testigos" como origen — los votantes y el organigrama no pueden recibirlos.'
      });
    }
  }
  if (esCanalDeCorreo(canal) && !asunto) {
    return res.status(400).json({ error: 'El asunto es obligatorio para campañas de correo.' });
  }
  if (req.file) {
    // multer ya lo escribió en disco antes de llegar aquí, así que hay que
    // borrarlo: si no, cada intento rechazado deja basura en uploads/.
    fs.unlink(path.join(UPLOAD_DIR, req.file.filename), () => {});
    return res.status(400).json({ error: 'Las campañas ya no admiten archivos adjuntos.' });
  }

  // Antes de arrancar, confirma que el canal esté listo para usarse.
  if (canal === 'sms') {
    const estado = await smsSvc.estadoCanal();
    if (!estado.configurado) {
      return res.status(400).json({ error: estado.motivo || `El canal ${canal} todavía no está configurado.` });
    }
    // La franja se pregunta UNA vez, aquí, y no destinatario por destinatario:
    // el proveedor rechaza la mensajería promocional fuera de 08:00-20:00, y
    // enterarse en el envío número 1 de 300 deja la campaña a medias, con la
    // mitad de la gente sin mensaje y el reporte lleno de fallidos.
    if (!estado.enFranja && !req.body.programado_para) {
      return res.status(400).json({
        error: `Fuera del horario permitido para SMS (${estado.franja.inicio}:00 a ${estado.franja.fin}:00, hora de Colombia). `
             + 'Puede programar el envío para mañana dentro de ese rango.'
      });
    }
  }
  if (canal === 'email') {
    const estado = await sendgridSvc.estadoCanal();
    if (!estado.configurado) {
      return res.status(400).json({ error: estado.motivo });
    }
  }
  if (canal === 'push') {
    const estado = pushSvc.estadoCanal();
    if (!estado.configurado) {
      return res.status(400).json({ error: estado.motivo });
    }
  }

  // {enlace_ya_vote}: solo SMS y solo si la campaña tiene fecha de elección. Se
  // rechaza ANTES de crear nada: una campaña con el marcador sin resolver
  // mandaría «avísanos aquí: {enlace_ya_vote}» tal cual a cientos de personas.
  const conEnlace = MARCADOR_ENLACE.test(String(mensaje || ''));
  if (conEnlace) {
    if (canal !== 'sms') {
      return res.status(400).json({ error: 'El enlace «Ya voté» solo se puede enviar por SMS (o con el asistente de WhatsApp).' });
    }
    const e = await yaVoto.estadoDeLaElección().catch(() => ({ fecha: null }));
    if (!e.fecha) {
      return res.status(400).json({ error: 'La campaña no tiene fecha de elección. Configúrela en Configuración → Datos de la campaña para poder enviar el enlace «Ya voté».' });
    }
  }

  try {
    const alcance = await alcanceSiHaceFalta(req, res, filtros || {});
    let destinatarios = await obtenerDestinatariosDeGrupos(filtros || {}, canal, alcance);
    if (conEnlace) destinatarios = await aplicarReglaDelEnlace(destinatarios, canal);
    destinatarios = await marcarPendientesDeConfirmar(destinatarios);
    if (destinatarios.length === 0) {
      return res.status(400).json({ error: 'No hay destinatarios que coincidan con los filtros elegidos.' });
    }

    const adjuntoNombre = req.file ? req.file.filename : null;
    const adjuntoUrl = req.file
      ? `${baseDelSitio(req)}/api/comunicaciones/adjunto-publico/${req.file.filename}`
      : null;
    // Solo aplica a SMS — le pide a Twilio que avise a esta URL cada vez
    // que el estado real de un mensaje cambie (por ejemplo, de "enviado"
    // a "no entregado"), porque esa confirmación casi siempre llega más
    // tarde de lo que se puede esperar en el momento del envío.
    const statusCallbackUrl = canal === 'sms'
      ? `${baseDelSitio(req)}/webhooks/twilio/estado-mensaje`
      : null;

    // Programación: si trae una fecha futura, la campaña nace en
    // 'borrador' con esa fecha y NO se dispara ahora. La despacha
    // despacharCampanasProgramadas() cuando llegue la hora.
    //
    // Una fecha ya pasada se ignora en vez de rechazarse: quien puso ayer
    // por error quería enviar, no quería un error. Sale de una.
    const programado = req.body.programado_para ? new Date(req.body.programado_para) : null;
    const esProgramada = programado && !isNaN(programado) && programado.getTime() > Date.now();

    const [result] = await pool.query(
      `INSERT INTO comunicaciones_campanas (nombre, canal, asunto, mensaje, filtros, adjunto_nombre, adjunto_url, status_callback_url, estado, total_destinatarios, created_by, programado_para)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nombre, canal, esCanalDeCorreo(canal) ? asunto : null, mensaje, JSON.stringify(filtros || {}),
       adjuntoNombre, adjuntoUrl, statusCallbackUrl,
       esProgramada ? 'borrador' : 'enviando',
       destinatarios.length, req.session.usuario.id,
       esProgramada ? programado : null]
    );
    const campanaId = result.insertId;

    // Se deja registrada de una vez la lista completa de a quién le falta
    // enviar (en vez de solo tenerla en memoria) — así, si el proceso de
    // Node se reinicia a la mitad, reanudarCampanasPendientes() (ver
    // app.js) sabe exactamente qué falta sin depender de nada que solo
    // vivía en esta petición HTTP.
    const valoresEnvios = destinatarios.map(d => [
      campanaId, d.tipo, d.id || null, d.nombre, d.contacto || null,
      // La baja manda sobre todo lo demás: aunque tenga contacto, no se le
      // intenta enviar. Queda como fila para que el reporte lo muestre.
      //
      // «Sin autorización» es un estado APARTE y no un tipo de baja: dado de
      // baja es quien pidió que no le escribieran más; sin autorización es
      // quien nunca dijo que sí por ese medio. Mezclarlos haría imposible
      // saber a quién tiene sentido volver a preguntarle.
      d.dado_de_baja ? 'dado_de_baja'
        : d.sin_autorizacion ? 'sin_autorizacion'
        : (d.contacto ? 'pendiente' : 'sin_contacto')
    ]);
    await pool.query(
      `INSERT INTO comunicaciones_envios (campana_id, destinatario_tipo, destinatario_id, destinatario_nombre, destinatario_contacto, estado) VALUES ?`,
      [valoresEnvios]
    );

    res.json({
      ok: true, campana_id: campanaId, total_destinatarios: destinatarios.length,
      programada: esProgramada ? programado.toISOString() : null,
    });

    if (esProgramada) return;   // queda esperando su hora

    // El envío sigue después de responder — así el navegador no se queda
    // esperando varios minutos si hay muchos destinatarios.
    procesarEnvioCampana(campanaId)
      .catch(err => console.error(`Error procesando el envío de la campaña ${campanaId}:`, err));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creando la campaña.' });
  }
});

/**
 * Despacha las campañas cuya hora ya llegó.
 *
 * Corre cada minuto y al arrancar. Es deliberadamente simple —una consulta
 * y un UPDATE— pero el UPDATE hace de candado: solo despacha las que
 * todavía están en 'borrador', y las pasa a 'enviando' ANTES de procesar.
 * Si dos ciclos se solaparan (o hubiera dos procesos), el segundo no
 * encontraría ninguna fila y no habría envíos dobles.
 */
async function despacharCampanasProgramadas() {
  try {
    await reconciliarEnviando({ minutos: 10 });   // las que quedaron «enviando» hace rato y nadie está enviando
    const [pendientes] = await pool.query(
      `SELECT id FROM comunicaciones_campanas
        WHERE estado = 'borrador' AND programado_para IS NOT NULL AND programado_para <= NOW()`);
    for (const c of pendientes) {
      const [r] = await pool.query(
        `UPDATE comunicaciones_campanas SET estado = 'enviando' WHERE id = ? AND estado = 'borrador'`, [c.id]);
      if (!r.affectedRows) continue;   // otro ciclo se le adelantó
      console.log(`Campaña programada ${c.id}: llegó su hora, se despacha.`);
      procesarEnvioCampana(c.id)
        .catch(err => console.error(`Error enviando la campaña programada ${c.id}:`, err));
    }
  } catch (err) {
    console.error('Error revisando las campañas programadas:', err.message);
  }
}

/* ------------------------------------------------------------------
   QUIÉN PIDIÓ NO RECIBIR MÁS

   Estaba guardado pero no se podía ver junto: la baja marca la ficha de la
   persona (no_contactar) y, SOLO si llegó por respuesta, deja ademas una fila
   en comunicaciones_respuestas. Como el enlace es hoy el camino principal
   —Onurix no recibe SMS entrantes—, casi ninguna baja aparecia en «Respuestas
   recibidas», y para saber quien se salio habia que abrir las fichas una por
   una.

   Con tres da igual; con trescientas, no. Y si alguien reclama por la Ley
   1581, lo que se necesita es poder mostrar el registro con su fecha y por
   donde llego.
   ------------------------------------------------------------------ */

/** Las dos tablas donde vive una baja, con la misma forma. */
const SQL_BAJAS = `
  SELECT 'Votante' AS tipo, id, nombre, telefono, email,
         no_contactar_fecha AS fecha, no_contactar_origen AS origen,
         no_contactar_canal AS canal, no_contactar_motivo AS motivo
    FROM votantes  WHERE no_contactar = 1
  UNION ALL
  SELECT 'Equipo', id, nombre, telefono, email,
         no_contactar_fecha, no_contactar_origen,
         no_contactar_canal, no_contactar_motivo
    FROM usuarios  WHERE no_contactar = 1
     AND es_superadmin = 0`;   // el superadministrador no sale en ninguna lista (config/superadmin.js)

/**
 * Por donde llego la baja, en palabras.
 *
 * 'enlace' cubre el enlace del mensaje Y el boton de «Cancelar suscripcion»
 * de Gmail: los dos terminan en la misma pagina. NULL es de las bajas
 * anteriores a que se guardara el origen — se dice, en vez de dejar el hueco
 * en blanco como si fuera un dato perdido.
 */
const ORIGEN_BAJA = {
  enlace: 'Enlace del mensaje',
  sms: 'Respondio al SMS',
  whatsapp: 'Respondio por WhatsApp',
  manual: 'Anotada a mano',
};

/** «Anotada a mano · Llamada»: para una baja manual se dice ademas por que canal la pidio. */
function textoDeOrigen(f) {
  const base = ORIGEN_BAJA[f.origen] || 'No quedo registrado';
  return f.origen === 'manual' && CANALES_BAJA_MANUAL[f.canal]
    ? `${base} · ${CANALES_BAJA_MANUAL[f.canal]}` : base;
}

router.get('/bajas', requireRole('admin', 'coordinador'), async (req, res) => {
  try {
    const [filas] = await pool.query(`${SQL_BAJAS} ORDER BY fecha IS NULL, fecha DESC, nombre`);
    res.json(filas.map(f => ({
      ...f,
      origen_texto: textoDeOrigen(f),
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error leyendo la lista de bajas.' });
  }
});

router.get('/bajas/exportar-excel', requireRole('admin', 'coordinador'), requiereImportarExportar('crm'), async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const [filas] = await pool.query(`${SQL_BAJAS} ORDER BY fecha IS NULL, fecha DESC, nombre`);
    const columnas = ['Tipo', 'Nombre', 'Telefono', 'Correo', 'Cuando lo pidio', 'Por donde', 'Motivo'];
    const datos = filas.map(f => ({
      Tipo: f.tipo,
      Nombre: f.nombre || '',
      Telefono: f.telefono || '',
      Correo: f.email || '',
      'Cuando lo pidio': f.fecha || '',
      'Por donde': textoDeOrigen(f),
      Motivo: f.motivo || '',
    }));
    // Con la lista vacia, json_to_sheet no escribe ni los encabezados y sale
    // un archivo en blanco que parece un error. Se arma la fila de titulos.
    const hoja = datos.length
      ? XLSX.utils.json_to_sheet(datos, { header: columnas })
      : XLSX.utils.aoa_to_sheet([columnas]);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Bajas');
    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="solicitudes-de-baja.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error exportando la lista de bajas.' });
  }
});

/**
 * ANOTAR A MANO que alguien pidio no recibir mas.
 *
 * Existe porque hay bajas que llegan por donde la app no las ve: el SMS sale por un codigo
 * corto del operador y la respuesta («NO», «BAJA») no vuelve (medido: cero respuestas
 * recibidas), o la persona lo pidio por telefono o en persona. Sin esto el equipo sabia
 * que alguien se habia salido y no tenia donde anotarlo, que es peor que no saberlo: el
 * siguiente envio le llegaba igual.
 *
 * Usa la MISMA funcion que la baja por enlace (`aplicarBajaDeFicha`), asi que marca a la
 * persona y no solo a la ficha: todas las que compartan telefono o correo, y la ficha
 * misma aunque no tenga ninguno. Con origen `manual`, el canal por el que lo pidio y el
 * motivo, que quedan en la ficha y en la auditoria con el nombre de quien la anoto.
 *
 * Mismo permiso que ve «Bajas» (admin y coordinador). El motivo y el canal son
 * obligatorios: es lo que, ante un reclamo, dice de donde salio esta baja.
 */
router.post('/bajas/manual', requireRole('admin', 'coordinador'), async (req, res) => {
  const { tipo, id, canal, motivo } = req.body || {};
  const tabla = tipo === 'votante' ? 'votantes' : tipo === 'usuario' ? 'usuarios' : null;
  if (!tabla) return res.status(400).json({ error: 'Tipo no valido.' });
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) return res.status(400).json({ error: 'Persona no valida.' });
  const motivoLimpio = String(motivo == null ? '' : motivo).trim();
  if (!motivoLimpio) {
    return res.status(400).json({ error: 'Escriba el motivo: queda en la ficha y en la auditoria.' });
  }
  if (motivoLimpio.length > 255) {
    return res.status(400).json({ error: 'El motivo es muy largo (maximo 255 caracteres).' });
  }
  if (!Object.prototype.hasOwnProperty.call(CANALES_BAJA_MANUAL, canal)) {
    return res.status(400).json({ error: 'Elija por que canal lo pidio.' });
  }

  try {
    // El superadministrador no existe para estas pantallas (config/superadmin.js): 404 como si no estuviera.
    const [[fila]] = await pool.query(
      `SELECT nombre FROM ${tabla} WHERE id = ?${tabla === 'usuarios' ? ' AND es_superadmin = 0' : ''}`, [idNum]);
    if (!fila) return res.status(404).json({ error: 'Esa persona ya no existe.' });

    const r = await aplicarBajaDeFicha(pool, tabla, idNum, { origen: 'manual', canal, motivo: motivoLimpio });
    if (!r) return res.status(404).json({ error: 'Esa persona ya no existe.' });

    await registrarAuditoria(
      req.session.usuario.id, 'marcar_no_contactar', tabla, idNum,
      `Anoto a mano que ${fila.nombre || '(sin nombre)'} pidio no recibir mas mensajes `
      + `(${r.fichas} ficha(s) marcada(s)${r.fichas === 0 ? ': ya estaba de baja, no se cambio nada' : ''}). `
      + `Canal: ${CANALES_BAJA_MANUAL[canal]}. Motivo: ${motivoLimpio}`,
      req.ip);

    res.json({ ok: true, fichas: r.fichas, ya_estaba: r.fichas === 0 });
  } catch (err) {
    console.error('Error anotando la baja a mano:', err.code || err.message);
    res.status(500).json({ error: 'No se pudo anotar la baja.' });
  }
});

/**
 * Volver a habilitar a alguien que habia pedido no recibir mas.
 *
 * SOLO ADMIN, y con motivo obligatorio. No es una casilla mas: esta persona
 * ejercio un derecho —revocar la autorizacion de sus datos, Ley 1581— y
 * deshacerlo por dentro sin que ella lo pidiera es exactamente lo que la
 * norma prohibe. El motivo no es burocracia: es lo unico que, dentro de seis
 * meses, explica por que alguien que pidio salirse volvio a recibir mensajes.
 *
 * SE DESMARCAN TODAS SUS FICHAS, igual que al darla de baja. La baja marca a
 * la persona (todo lo que comparta su telefono o su correo), asi que
 * reactivar una sola ficha la dejaria bloqueada por la otra: el boton
 * parecerian no funcionar, y nadie sabria por que.
 */
router.post('/bajas/:tipo/:id/reactivar', requireRole('admin'), async (req, res) => {
  const { motivo } = req.body || {};
  if (!motivo || !String(motivo).trim()) {
    return res.status(400).json({ error: 'Escriba por que se reactiva: queda en la auditoria.' });
  }
  const tabla = req.params.tipo === 'votante' ? 'votantes'
              : req.params.tipo === 'usuario' ? 'usuarios' : null;
  if (!tabla) return res.status(400).json({ error: 'Tipo no valido.' });

  try {
    const [[fila]] = await pool.query(
      `SELECT nombre, telefono, email FROM ${tabla} WHERE id = ?`, [req.params.id]);
    if (!fila) return res.status(404).json({ error: 'Esa persona ya no existe.' });

    const diez = String(fila.telefono || '').replace(/\D/g, '').slice(-10);
    let tocadas = 0;
    for (const t of ['votantes', 'usuarios']) {
      const [r] = await pool.query(
        `UPDATE ${t}
            SET no_contactar = 0, no_contactar_fecha = NULL, no_contactar_origen = NULL,
                no_contactar_canal = NULL, no_contactar_motivo = NULL
          WHERE no_contactar = 1
            AND ((? <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(telefono,''), '[^0-9]', ''), 10) = ?)
              OR (? IS NOT NULL AND email = ?)
              ${t === tabla ? 'OR id = ?' : ''})`,
        [diez, diez, fila.email || null, fila.email || null, ...(t === tabla ? [req.params.id] : [])]);
      tocadas += r.affectedRows;
    }

    await registrarAuditoria(
      req.session.usuario.id, 'reactivar_contacto', tabla, Number(req.params.id),
      `Volvio a habilitar el envio de mensajes a ${fila.nombre || '(sin nombre)'} `
      + `(${tocadas} ficha(s)). Motivo: ${String(motivo).trim().slice(0, 200)}`,
      req.ip);

    res.json({ ok: true, fichas: tocadas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo reactivar.' });
  }
});

module.exports = router;
module.exports.reanudarCampanasPendientes = reanudarCampanasPendientes;
module.exports.despacharCampanasProgramadas = despacharCampanasProgramadas;
module.exports.procesarEnvioCampana = procesarEnvioCampana;
module.exports.reintentarFallidos = reintentarFallidos;
module.exports.reconciliarEnviando = reconciliarEnviando;
module.exports.releerAntesDeEnviar = releerAntesDeEnviar;
module.exports.campanasEnProceso = campanasEnProceso;
