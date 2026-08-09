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
const OFFLINE_DB_VERSION = 2;
// Un "store" (cajón) por cada tipo de formulario que se pueda guardar sin
// conexión. Agregar uno nuevo acá NO borra los que ya existían en el
// dispositivo de nadie — IndexedDB solo agrega los que falten al subir de
// versión, conserva intacto lo que ya estaba guardado.
const OFFLINE_STORES = ['votantes_pendientes', 'estructura_pendientes', 'reportes_diad_pendientes'];

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
    req.onerror = () => reject(req.error);
  });
}

async function guardarEnColaOffline(store, registro) {
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
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
