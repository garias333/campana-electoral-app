/**
 * EL CLIENTE DE LA API DE TERRITORIOS (el Catálogo Territorial). ORDEN 152.
 *
 * QUÉ RESUELVE. Los barrios, comunas, corregimientos y veredas viven en
 * Territorios y los comparten todas las campañas del municipio. Electoral los
 * LEE (la vista `territorios`, de solo lectura) y no escribe en `territoriosdb`:
 * no tiene permiso, y dárselo habría sido abrirle a cada campaña la escritura
 * sobre el catálogo nacional. Para subir uno nuevo, la campaña se lo PIDE a
 * Territorios por su API, y Territorios decide: lo correcto entra, lo dudoso
 * queda pendiente de revisión.
 *
 * LA LLAVE NO SALE DE AQUÍ. `TERRITORIOS_API_CLAVE` se lee del `.env` y solo la
 * ve este módulo: las rutas devuelven al navegador el resumen que contesta
 * Territorios, nunca la llave ni la URL con credenciales. Si algún día alguien
 * añade un `console.log` del objeto de la petición, lo que se registraría son
 * las cabeceras — por eso `cabeceras()` es una función local y no un objeto
 * guardado en el módulo que se pueda volcar por descuido.
 *
 * SE MANDAN LAS DOS CABECERAS, Y ES A PROPÓSITO. Preguntándole al servicio sin
 * llave contesta:
 *
 *   {"error":"llave_requerida","mensaje":"Envie la llave en Authorization: Bearer o en X-API-Key."}
 *
 * Acepta las dos formas. Mandar las dos quita de en medio la única duda que
 * quedaba —cuál espera la ruta de escritura— sin tener que adivinarla: la que
 * el servidor no mire, la ignora.
 *
 * SIN VARIABLES, NO ESTÁ CONECTADA. `estaConectado()` es falso y las rutas
 * responden 503 con un mensaje que se entiende; la ficha no pinta los botones.
 * Es el estado normal de una campaña a la que todavía no le generaron su llave,
 * no un error.
 *
 * NODE 22 TRAE `fetch` Y `AbortSignal.timeout`: no hace falta ninguna
 * dependencia nueva (comprobado en esta misma versión, v22.23.1).
 */
'use strict';

const TIEMPO_LIMITE_MS = 30 * 1000;

/** Se leen en cada llamada, no al cargar: así un cambio del `.env` + reinicio vale sin tocar nada más. */
function configuracion() {
  const url = (process.env.TERRITORIOS_API_URL || '').trim();
  const clave = (process.env.TERRITORIOS_API_CLAVE || '').trim();
  return { url: url.replace(/\/+$/, ''), clave };
}

/** ¿Esta campaña tiene con qué hablarle a Territorios? */
function estaConectado() {
  const { url, clave } = configuracion();
  return !!(url && clave);
}

const MENSAJE_SIN_CONECTAR = 'Esta campaña no está conectada con Territorios.';

/**
 * Una llamada POST a la API. Devuelve `{ status, cuerpo }` con lo que haya
 * contestado Territorios, SIN interpretarlo: quien llama decide qué hacer con
 * cada código (200 entró, 202 quedó pendiente, 403 fuera del ámbito, 422 error
 * de la fila, 401 llave mala).
 *
 * NUNCA LANZA POR UN CÓDIGO HTTP. Lanza solo si no se pudo hablar con el
 * servicio (se cayó la red, venció el tiempo límite, contestó algo que no es
 * JSON), y el mensaje que sale de aquí ya está limpio: sin la llave y sin la
 * URL, que es lo que acabaría en un log o en la pantalla.
 */
async function llamar(sufijo, cuerpo, opciones = {}) {
  const { url, clave } = configuracion();
  if (!url || !clave) {
    const err = new Error(MENSAJE_SIN_CONECTAR);
    err.sinConectar = true;
    throw err;
  }
  const destino = url + (sufijo || '') + (opciones.simular ? '?simular=1' : '');
  let respuesta;
  try {
    respuesta = await fetch(destino, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        /* Las dos formas que el servicio dice aceptar (ver la nota de arriba). */
        'Authorization': `Bearer ${clave}`,
        'X-API-Key': clave
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIEMPO_LIMITE_MS)
    });
  } catch (err) {
    /* `err.message` de fetch puede traer la URL entera. Se reemplaza por uno
       nuestro: a la pantalla no debe llegar ni el servidor ni la llave. */
    const esTiempo = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    const limpio = new Error(esTiempo
      ? 'Territorios no respondió a tiempo (30 segundos). Vuelva a intentarlo.'
      : 'No se pudo hablar con Territorios. Inténtelo de nuevo en un momento.');
    limpio.sinRespuesta = true;
    throw limpio;
  }

  let datos = null;
  try {
    datos = await respuesta.json();
  } catch (_) {
    /* Contestó algo que no es JSON (una página de error de Nginx, por ejemplo). */
    const err = new Error('Territorios contestó algo que no se pudo leer.');
    err.sinRespuesta = true;
    throw err;
  }
  return { status: respuesta.status, cuerpo: datos };
}

module.exports = { estaConectado, llamar, MENSAJE_SIN_CONECTAR, TIEMPO_LIMITE_MS };
