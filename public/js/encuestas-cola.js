/* LA COLA SIN SEÑAL DE LAS ENCUESTAS (parche 307). La usan «Encuestas» (la lista) y «Aplicar una encuesta».
   Requiere /js/api-core.js y /js/offline-utils.js (los cajones de IndexedDB y `api()`).

   POR QUÉ NO SE USA `sincronizarCola` DE offline-utils.js. Sirve para casi todo, pero una respuesta de encuesta es trabajo de una persona en
   campo que no se puede perder, y esa función tiene dos defectos que aquí importan:
     · si `api()` recibe un 401 (la sesión venció) redirige al login y DEVUELVE undefined; `sincronizarCola` lo toma por éxito y BORRA el
       registro. Aquí solo se borra lo que el servidor confirmó con `{ ok: true }`.
     · un rechazo del servidor marca el registro «fallido» (bien) pero la pantalla de captura lo borraba al mostrar el error. Aquí NADIE borra un
       fallido por su cuenta: queda visible con su motivo y la persona decide «Reintentar» o «Descartar».
   Cada registro lleva su dueño (`usuarioId`): otra cuenta del mismo celular no lo ve ni lo sube. El servidor es idempotente por `cliente_uuid`:
   dos subidas a la vez, o un reintento después de un corte, no duplican. */

const ENCUESTAS_STORE = 'encuestas_pendientes';
let _sincronizandoEncuestas = false;

/** Lo que se manda al servidor: el contenido de la respuesta más el identificador de este registro. */
function cuerpoDeRespuestaEncuesta(registro) {
  return Object.assign({}, registro.payload, { cliente_uuid: registro.clienteUuid });
}

async function colaDeEncuestas() {
  try { return await listarColaOffline(ENCUESTAS_STORE); } catch (_) { return []; }
}

/** Sube lo pendiente, en el orden en que se tomó. Se detiene al faltar la señal. Devuelve { subidos, pendientes, fallidos }. */
async function sincronizarEncuestas() {
  if (_sincronizandoEncuestas) return { subidos: 0, pendientes: 0, fallidos: 0, ocupado: true };
  _sincronizandoEncuestas = true;
  let subidos = 0;
  try {
    const pendientes = (await colaDeEncuestas()).filter((r) => r.estado !== 'fallido').sort((a, b) => (a.creadoEn || 0) - (b.creadoEn || 0));
    for (const r of pendientes) {
      try {
        const res = await api('/encuestas/campo/responder', { method: 'POST', body: cuerpoDeRespuestaEncuesta(r) });
        if (!res || res.ok !== true) break;                    // sin confirmación del servidor no se borra nada
        await borrarDeColaOffline(ENCUESTAS_STORE, r.clienteUuid);
        subidos++;
      } catch (err) {
        if (err && err.esErrorDeRed) break;
        if (err && err.status && ESTADOS_TRANSITORIOS.includes(err.status)) break;     // servidor ocupado o caído: se reintenta solo
        r.estado = 'fallido';
        r.error = (err && err.message) || 'No se pudo guardar.';
        await guardarEnColaOffline(ENCUESTAS_STORE, r);
      }
    }
  } catch (_) { /* IndexedDB no disponible: no hay nada que subir */ } finally { _sincronizandoEncuestas = false; }
  const resto = await colaDeEncuestas();
  return { subidos, pendientes: resto.filter((r) => r.estado !== 'fallido').length, fallidos: resto.filter((r) => r.estado === 'fallido').length };
}

/** Vuelve a poner en espera lo que el servidor rechazó (por ejemplo, por un corte del servidor) y lo intenta de nuevo. */
async function reintentarEncuestasFallidas() {
  for (const r of (await colaDeEncuestas()).filter((x) => x.estado === 'fallido')) {
    delete r.estado;
    delete r.error;
    await guardarEnColaOffline(ENCUESTAS_STORE, r);
  }
  return sincronizarEncuestas();
}

/** La fecha de hoy en Colombia, 'YYYY-MM-DD' (la del reloj de este celular): para no ofrecer encuestas el día de la elección. */
function hoyEnColombia() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
