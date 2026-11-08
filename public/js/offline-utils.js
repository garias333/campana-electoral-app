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
const OFFLINE_DB_VERSION = 6;
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
const OFFLINE_STORES = ['votantes_pendientes', 'estructura_pendientes', 'reportes_diad_pendientes',
                        'marcas_voto_pendientes', 'faltantes_cache',
                        'checkin_pendientes', 'transporte_pendientes', 'alertas_cache', 'logistica_pendientes',
                        'panel_lider_cache'];

/* DE QUIÉN ES CADA COSA GUARDADA EN EL CELULAR (orden del panel del líder).
   Un celular se comparte, y lo que se guarda sin señal tiene dos naturalezas:
     · COPIAS PARA LEER (la lista de faltantes, las alertas, el panel): llevan el id del usuario en su clave y SOLO se devuelven a
       ese usuario. Al cerrar sesión o al entrar otra cuenta se BORRAN las del anterior (public/js/cuentas-dispositivo.js).
     · COLAS DE LO PENDIENTE DE SUBIR (registros, marcas «ya votó», llegadas…): son trabajo de una persona que todavía no llegó al
       servidor. Se marcan con su dueño y solo SU sesión las ve y las sube; NO se borran al cambiar de cuenta, porque borrarlas
       sería perder datos. Lo anterior a este cambio no trae dueño y se le sigue mostrando a quien entre (como siempre).
   El «usuario actual» es el que dejó `registrarUsuarioSinSenal` (cuentas-dispositivo.js) al abrir cada pantalla. */
const OFFLINE_STORES_COPIA = ['faltantes_cache', 'alertas_cache', 'panel_lider_cache'];

function usuarioOffline() {
  try { return localStorage.getItem('offline_usuario_id') || ''; } catch (err) { return ''; }
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
  if (registro && registro.usuarioId === undefined) registro.usuarioId = usuarioOffline();
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
  if (OFFLINE_STORES_COPIA.includes(store)) return todo.filter((r) => r.usuarioId !== undefined && String(r.usuarioId) === yo);
  // Una cola: lo mío, y lo que no trae dueño (guardado antes de este cambio).
  return todo.filter((r) => r.usuarioId === undefined || r.usuarioId === '' || String(r.usuarioId) === yo || !yo);
}

/** Guarda la copia de LECTURA de este usuario (la clave lleva su id). */
async function guardarCopiaOffline(store, clave, datos) {
  const yo = usuarioOffline();
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
      await api(endpoint, { method: 'POST', body });
      await borrarDeColaOffline(store, registro.clienteUuid);
      subidos++;
    } catch (err) {
      if (err && err.esErrorDeRed) break;
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
