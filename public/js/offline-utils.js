/* Utilidades compartidas para que los formularios de captura (celular y
   escritorio) funcionen sin conexión: una cola en IndexedDB por cada tipo
   de registro (todas dentro de una sola base "estrategia_offline"), un
   sincronizador genérico que la sube sola en cuanto vuelve la señal, y una
   caché en localStorage de los datos de referencia (territorios, catálogo
   de Colombia, puestos de votación, candidatos) para que las listas
   desplegables del formulario sigan apareciendo aunque no haya habido
   ninguna conexión todavía en este dispositivo.
   Requiere que /js/api-core.js (o /js/common.js) se cargue antes — usa
   la función api(), que ya distingue un error de red real (offline) de
   un error de verdad del servidor (ver esErrorDeRed en api-core.js). */

const OFFLINE_DB_NOMBRE = 'estrategia_offline';
const OFFLINE_DB_VERSION = 11;
// Un "store" (cajón) por cada tipo de formulario que se pueda guardar sin
// conexión. Agregar uno nuevo acá NO borra los que ya existían en el
// dispositivo de nadie — IndexedDB solo agrega los que falten al subir de
// versión, conserva intacto lo que ya estaba guardado.
// `marcas_voto_pendientes`: las marcas «ya votó» hechas sin señal (Día D, fase 2).
// `faltantes_cache`: la última lista de faltantes, para verla sin conexión.
// `checkin_pendientes`: el «Llegué a mi puesto» del testigo marcado sin señal (Día D, fase 4).
// `transporte_pendientes`: el interruptor «necesita transporte» de Faltantes, hecho sin señal.
// `alertas_cache`: la última lista del cuadro de alertas, para verla sin conexión.
// `logistica_pendientes`: las entregas de refrigerios/kits hechas sin señal por el coordinador de puesto (orden 39).
// `panel_lider_cache`: la última copia del panel del líder en el celular (orden del panel del líder).
// `solicitudes_pendientes`: las solicitudes ciudadanas registradas sin señal, con sus fotos como Blob (parche 303). Es una COLA: lleva dueño.
// `tareas_pendientes`: lo que el asignado hace sin señal en «Mis tareas» (empecé, terminé con fotos como Blob, no pude) (parche 305). Es una COLA: lleva dueño.
// `encuestas_pendientes`: las encuestas aplicadas sin señal (parche 307). ANÓNIMAS: no llevan nada del encuestado; solo el dueño es quien las aplicó. Es una COLA.
// `encuestas_cache`: la última copia de las encuestas publicadas, para aplicarlas sin señal. Es una COPIA de lectura: lleva dueño y se borra al cambiar de cuenta.
// `puerta_pendientes`: el resultado de cada puerta del puerta a puerta, marcado sin señal (parche 309). Es una COLA: lleva dueño y NO lleva nombre ni dirección de nadie
//   (solo el id de la puerta, el resultado y el instante del toque, que se borra al subirse).
// `puerta_cache`: la lista de visitas del líder, con nombres y direcciones (parche 309). Es una COPIA de lectura: lleva dueño, CADUCA A LAS 48 HORAS y se borra
//   al cerrar sesión o cambiar de cuenta.
// `eventos_pendientes`: las marcas «asistió / no asistió» hechas sin señal en Eventos (parche 313). Es una COLA: lleva dueño y NO lleva nombre de nadie (solo el id del asistente,
//   el valor y el instante del toque).
// `eventos_cache`: los eventos del líder con sus invitados (solo nombre y barrio: nunca teléfono ni cédula) (parche 313). Es una COPIA de lectura: lleva dueño, CADUCA A LAS 48 HORAS
//   y se borra al cerrar sesión o cambiar de cuenta.
const OFFLINE_STORES = ['votantes_pendientes', 'estructura_pendientes', 'reportes_diad_pendientes',
                        'marcas_voto_pendientes', 'faltantes_cache',
                        'checkin_pendientes', 'transporte_pendientes', 'alertas_cache', 'logistica_pendientes',
                        'panel_lider_cache', 'solicitudes_pendientes', 'tareas_pendientes',
                        'encuestas_pendientes', 'encuestas_cache', 'puerta_pendientes', 'puerta_cache',
                        'eventos_pendientes', 'eventos_cache'];

/* DE QUIÉN ES CADA COSA GUARDADA EN EL CELULAR (orden del panel del líder).
   Un celular se comparte, y lo que se guarda sin señal tiene dos naturalezas:
     · COPIAS PARA LEER (la lista de faltantes, las alertas, el panel): llevan el id del usuario en su clave y SOLO se devuelven a
       ese usuario. Al cerrar sesión o al entrar otra cuenta se BORRAN las del anterior (public/js/cuentas-dispositivo.js).
     · COLAS DE LO PENDIENTE DE SUBIR (registros, marcas «ya votó», llegadas…): son trabajo de una persona que todavía no llegó al
       servidor. Se marcan con su dueño y solo SU sesión las ve y las sube; NO se borran al cambiar de cuenta, porque borrarlas
       sería perder datos. DESDE EL PARCHE 329 NUNCA SE GUARDA UNA PENDIENTE SIN DUEÑO, y lo que ya estaba guardado sin dueño (anterior a este cambio)
       NO se envía ni se le muestra a nadie como propio: se avisa como «pendientes sin dueño» y la persona puede descartarlas (`revisarPendientesSinDueno`).
       El servidor lo comprueba también: cada pendiente sube con `X-Cola-Usuario` y, si no es la cuenta de la sesión, responde 409 (middleware/auth.js).
   El «usuario actual» es el que dejó `registrarUsuarioSinSenal` (cuentas-dispositivo.js) al abrir cada pantalla. */
const OFFLINE_STORES_COPIA = ['faltantes_cache', 'alertas_cache', 'panel_lider_cache', 'encuestas_cache', 'puerta_cache', 'eventos_cache'];

function usuarioOffline() {
  try { return localStorage.getItem('offline_usuario_id') || ''; } catch (err) { return ''; }
}

/** El dueño con que se guarda una pendiente: el usuario de este celular, y si falta, la identidad verificada o la cuenta activa. '' si NO se sabe. */
function duenoConocido() {
  const yo = usuarioOffline();
  if (yo) return yo;
  try {
    const verificado = JSON.parse(localStorage.getItem('app_usuario_verificado') || 'null');
    if (verificado && verificado.id !== undefined && verificado.id !== null) return String(verificado.id);
  } catch (err) { /* sin identidad en caché */ }
  try { return localStorage.getItem('app_cuenta_activa_id') || ''; } catch (err) { return ''; }
}

const MENSAJE_SIN_DUENO = 'No se pudo guardar sin señal porque no se sabe quién eres en este celular. Conéctate a internet, inicia sesión de nuevo y vuelve a intentarlo.';
let _avisoSinDuenoEn = 0;
function avisarSinDueno() {
  if (Date.now() - _avisoSinDuenoEn < 3000) return;      // una sola vez por intento (los llamadores también muestran el error)
  _avisoSinDuenoEn = Date.now();
  try {
    if (typeof mostrarToast === 'function') mostrarToast(MENSAJE_SIN_DUENO, 'error');
    else window.alert(MENSAJE_SIN_DUENO);
  } catch (err) { /* el error lanzado llega igual a quien llamó */ }
}

/** ¿El registro trae dueño? (un id; '' o ausente es «sin dueño»). */
function tieneDueno(registro) {
  return !!registro && registro.usuarioId !== undefined && registro.usuarioId !== null && String(registro.usuarioId) !== '';
}

function abrirBaseOffline() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NOMBRE, OFFLINE_DB_VERSION);
    req.onupgradeneeded = () => {
      OFFLINE_STORES.forEach((nombre) => {
        if (!req.result.objectStoreNames.contains(nombre)) {
          req.result.createObjectStore(nombre, { keyPath: 'clienteUuid' });
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      /* VersionError: la base de este teléfono ya está en una versión MÁS NUEVA que la
         de este script (otra pantalla —ya actualizada— la subió, y esta página quedó
         con el script viejo en memoria). Abrirla SIN pedir versión usa la que haya,
         que contiene todos los cajones de esta: así la cola de reportes del Día D no
         se rompe por una diferencia de versiones. */
      if (req.error && req.error.name === 'VersionError') {
        const r2 = indexedDB.open(OFFLINE_DB_NOMBRE);
        r2.onsuccess = () => resolve(r2.result);
        r2.onerror = () => reject(r2.error);
        return;
      }
      reject(req.error);
    };
  });
}

async function guardarEnColaOffline(store, registro) {
  if (registro && !tieneDueno(registro)) registro.usuarioId = duenoConocido();
  /* NUNCA SE GUARDA UNA PENDIENTE SIN DUEÑO (parche 329): sin saber de quién es, nadie podría enviarla con seguridad (la podría subir otra
     cuenta del mismo celular). No se encola y se avisa. Las copias de lectura tampoco: sin dueño no sirven a nadie. */
  if (!tieneDueno(registro)) {
    avisarSinDueno();
    const err = new Error(MENSAJE_SIN_DUENO);
    err.codigo = 'SIN_DUENO';
    throw err;
  }
  const db = await abrirBaseOffline();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(registro);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function listarColaOffline(store) {
  const db = await abrirBaseOffline();
  const todo = await new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const yo = String(usuarioOffline());
  /* SOLO LO MÍO (parche 329). Antes una cola dejaba pasar lo que no traía dueño y TODO si no había usuario registrado (`|| !yo`): en un celular
     compartido, cualquiera que abriera la app subía lo de otro. Ahora, sin usuario conocido no se ve nada, y lo que no trae dueño no se envía:
     se cuenta aparte (`listarSinDueno`) para avisarlo y poder descartarlo. */
  if (!yo) return [];
  return todo.filter((r) => tieneDueno(r) && String(r.usuarioId) === yo);
}

/** Lo que quedó guardado SIN DUEÑO en una cola (anterior al parche 329). No se envía a nadie. */
async function listarSinDueno(store) {
  if (OFFLINE_STORES_COPIA.includes(store)) return [];
  const db = await abrirBaseOffline();
  const todo = await new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return todo.filter((r) => !tieneDueno(r));
}

/**
 * «PENDIENTES SIN DUEÑO»: si hay en este celular, se avisa arriba de la pantalla con la opción de descartarlas. Solo se muestra cuando se sabe
 * quién usa el celular (se vuelve a llamar al registrar el usuario) y lo ve cualquier persona con sesión: el administrador o quien sea, porque no
 * hay forma de saber de quién eran. Descartar las BORRA (con confirmación): no se pueden enviar sin saber de quién son.
 */
async function revisarPendientesSinDueno() {
  try {
    if (!usuarioOffline() || !document.body) return;
    const huerfanas = [];
    for (const store of OFFLINE_STORES) {
      if (OFFLINE_STORES_COPIA.includes(store)) continue;
      (await listarSinDueno(store)).forEach((r) => huerfanas.push({ store, clienteUuid: r.clienteUuid }));
    }
    let barra = document.getElementById('aviso-pendientes-sin-dueno');
    if (!huerfanas.length) { if (barra) barra.remove(); return; }
    if (!barra) {
      barra = document.createElement('div');
      barra.id = 'aviso-pendientes-sin-dueno';
      barra.setAttribute('role', 'alert');
      barra.style.cssText = 'position:fixed; left:0; right:0; bottom:0; z-index:9998; background:#FDF3E0; color:#5C3B00; border-top:2px solid #B7791F;'
        + 'padding:10px 14px; font-size:.88rem; display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap;';
      document.body.appendChild(barra);
    }
    barra.innerHTML = '';
    const texto = document.createElement('span');
    texto.textContent = 'Hay ' + huerfanas.length + ' pendiente' + (huerfanas.length === 1 ? '' : 's')
      + ' sin dueño en este celular (guardadas antes de esta versión). No se envían, porque no se sabe de quién son.';
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.textContent = 'Descartarlas';
    boton.style.cssText = 'border:0; border-radius:8px; padding:7px 12px; font-weight:700; background:#B7791F; color:#fff; cursor:pointer;';
    boton.addEventListener('click', async () => {
      if (!window.confirm('¿Descartar ' + huerfanas.length + ' pendiente' + (huerfanas.length === 1 ? '' : 's')
        + ' sin dueño? Se borran de este celular y no se pueden recuperar.')) return;
      for (const h of huerfanas) { try { await borrarDeColaOffline(h.store, h.clienteUuid); } catch (err) { /* se intenta con las demás */ } }
      revisarPendientesSinDueno();
    });
    barra.appendChild(texto);
    barra.appendChild(boton);
  } catch (err) { /* sin IndexedDB o sin cuerpo todavía: no se avisa */ }
}
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(revisarPendientesSinDueno, 1500));
}

/** Guarda la copia de LECTURA de este usuario (la clave lleva su id). */
async function guardarCopiaOffline(store, clave, datos) {
  const yo = usuarioOffline();
  if (!yo) return;                       // sin dueño no se guarda copia (parche 329)
  return guardarEnColaOffline(store, { clienteUuid: `u${yo}:${clave}`, clave, datos, guardadoEn: Date.now(), usuarioId: yo });
}

/** La copia de lectura de ESTE usuario, o null. Nunca la de otro. */
async function leerCopiaOffline(store, clave) {
  const yo = String(usuarioOffline());
  const todo = await listarColaOffline(store);
  return todo.find((r) => r.clienteUuid === `u${yo}:${clave}`) || null;
}

async function borrarDeColaOffline(store, clienteUuid) {
  const db = await abrirBaseOffline();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(clienteUuid);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function generarUuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Respuestas HTTP que dicen «ahora no», no «este registro está mal»: 408, 429 (demasiadas solicitudes), 502, 503 y 504. */
const ESTADOS_TRANSITORIOS = [408, 429, 502, 503, 504];

/**
 * Reintenta subir todo lo pendiente de un "store". `obtenerBody(registro)`
 * arma lo que se manda a api() (un objeto plano para JSON, o un FormData
 * para multipart — api() ya sabe distinguirlos). Se detiene apenas vuelve
 * a fallar por falta de señal (no tiene caso seguir intentando el resto en
 * ese mismo momento); un error real del servidor marca ESE registro como
 * "fallido" (para revisar a mano) y sigue con los demás.
 */
async function sincronizarCola(store, endpoint, obtenerBody) {
  let cola = [];
  try {
    cola = await listarColaOffline(store);
  } catch (err) {
    return { subidos: 0, pendientes: 0, fallidos: 0 };
  }
  const pendientes = cola.filter((r) => r.estado !== 'fallido');
  let subidos = 0;

  for (const registro of pendientes) {
    try {
      const body = obtenerBody(registro);
      // `X-Cola-Usuario`: el DUEÑO de esta pendiente. El servidor rechaza con 409 si no es la cuenta de la sesión (middleware/auth.js).
      const respuesta = await api(endpoint, { method: 'POST', body, headers: { 'X-Cola-Usuario': String(registro.usuarioId) } });
      /* SOLO SE BORRA LO QUE EL SERVIDOR CONFIRMÓ (parche 308). Cuando la sesión venció, api() redirige al login y DEVUELVE undefined
         en vez de lanzar: antes se tomaba por éxito y el registro —trabajo de campo sin subir— se borraba sin que llegara a ninguna
         parte. Un éxito real siempre trae algo (el objeto de la respuesta, o null si no hay cuerpo): undefined es «no se confirmó nada». */
      if (respuesta === undefined) break;
      await borrarDeColaOffline(store, registro.clienteUuid);
      subidos++;
    } catch (err) {
      if (err && err.esErrorDeRed) break;
      // Un fallo del camino (servidor ocupado o caído, límite de solicitudes) no es un rechazo del registro: se deja en espera y se
      // reintenta en la siguiente subida, en vez de marcarlo «fallido» y obligar a la persona a reintentarlo a mano.
      if (err && err.status && ESTADOS_TRANSITORIOS.includes(err.status)) break;
      // «Esta pendiente es de otra cuenta» (409): NO está mal, solo no es de quien la presenta. Se deja guardada, intacta (ni «fallido» ni borrada).
      if (err && err.status === 409 && err.datos && err.datos.codigo === 'cola_de_otra_cuenta') continue;
      registro.estado = 'fallido';
      registro.error = (err && err.message) || 'No se pudo guardar.';
      await guardarEnColaOffline(store, registro);
    }
  }

  const restante = await listarColaOffline(store).catch(() => []);
  return {
    subidos,
    pendientes: restante.filter((r) => r.estado !== 'fallido').length,
    fallidos: restante.filter((r) => r.estado === 'fallido').length
  };
}

/** Guarda la última copia buena de un dato de referencia (territorios, catálogo de Colombia, puestos, candidatos...) para poder usarla sin conexión. */
function guardarCacheReferencia(clave, datos) {
  try {
    localStorage.setItem(`cache_ref_${clave}`, JSON.stringify({ datos, guardadoEn: Date.now() }));
  } catch (err) {
    // localStorage lleno o deshabilitado — no es crítico, simplemente no queda caché.
  }
}

function leerCacheReferencia(clave) {
  try {
    const crudo = localStorage.getItem(`cache_ref_${clave}`);
    if (!crudo) return null;
    return JSON.parse(crudo).datos;
  } catch (err) {
    return null;
  }
}

/**
 * Intenta obtener un dato de referencia en vivo (ej. `() => api('/territorial/territorios')`)
 * y lo guarda en caché si funciona. Si falla (sin conexión), usa la última
 * copia guardada en este dispositivo en vez de dejar el formulario sin
 * datos — así carga aunque no haya habido ninguna conexión todavía hoy.
 * Si tampoco hay copia guardada, deja que el error normal siga su curso.
 */
async function obtenerConCacheReferencia(clave, obtenerFn) {
  try {
    const datos = await obtenerFn();
    guardarCacheReferencia(clave, datos);
    return datos;
  } catch (err) {
    const cache = leerCacheReferencia(clave);
    if (cache !== null) return cache;
    throw err;
  }
}
