// config/licencia.js
//
// Se conecta al Servidor de Licencias central para activar y validar
// periódicamente esta instalación. Guarda el último resultado conocido
// en memoria (y un respaldo en disco) para que una caída breve de
// internet o del Servidor de Licencias no tumbe la aplicación de golpe
// — solo se bloquea si la licencia de verdad está vencida/suspendida, o
// si pasa demasiado tiempo sin poder validar (ver TOLERANCIA_SIN_CONTACTO_HORAS).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SERVIDOR_LICENCIAS = process.env.LICENCIA_SERVIDOR_URL; // ej. https://licencias.appestrategia.net
const API_SECRET = process.env.LICENCIA_API_SECRET;
const DOMINIO_INSTALACION = process.env.LICENCIA_DOMINIO; // ej. campana.clientex.com — debe ser EXACTO al registrado en el panel
const CLAVE_LICENCIA = process.env.LICENCIA_CLAVE; // solo hace falta la primera vez, para activar

const ARCHIVO_CACHE = path.join(__dirname, '..', '.licencia-cache.json');
const ARCHIVO_VERSION_PARCHE = path.join(__dirname, '..', '.version-parche');
const INTERVALO_VALIDACION_MS = 6 * 60 * 60 * 1000; // cada 6 horas
const TOLERANCIA_SIN_CONTACTO_HORAS = 72; // si lleva más de 3 días sin poder contactar al servidor, se bloquea por precaución

let estadoActual = { valido: null, motivo: null, mensaje: null, ultimaValidacionExitosa: null };

/* VALIDACIÓN «PRONTA» (Orden 92). Los equipos de la campaña solo llegan al panel dentro de la validación, que corre al arrancar y cada 6 horas: un equipo nuevo que queda
   «pendiente» (cupo lleno o aprobación a mano) se quedaba hasta 6 horas sin aparecer en el panel, y mientras tanto nadie podía aprobarlo. Quien registra un equipo pendiente pide
   `validarPronto()`: una validación ya, pero NUNCA más de una cada VENTANA (2 minutos por omisión; la prueba la achica con LICENCIA_VALIDACION_PRONTA_MS). Lo que llega dentro de la
   ventana no se pierde: queda UNA validación programada para cuando la ventana termine, y todas las peticiones de ese lapso comparten esa. El ciclo de 6 horas no cambia. */
const VENTANA_VALIDACION_PRONTA_MS = 2 * 60 * 1000;
let validando = false;
let ultimaValidacionInicio = 0;
let temporizadorPronta = null;

/**
 * Identificador único y estable de ESTE servidor — no es el mismo que
 * viaja si alguien copia solo los archivos de la aplicación a otra
 * máquina (a diferencia de un archivo dentro del proyecto, machine-id
 * es del sistema operativo instalado, no del código).
 */
function obtenerFingerprint() {
  let machineId;
  try {
    machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim();
  } catch (e) {
    try {
      machineId = fs.readFileSync('/var/lib/dbus/machine-id', 'utf8').trim();
    } catch (e2) {
      throw new Error('No se pudo leer un identificador único de este servidor (/etc/machine-id). Contacta al proveedor.');
    }
  }
  return crypto.createHash('sha256').update(`${machineId}|${DOMINIO_INSTALACION}`).digest('hex');
}

/**
 * Número del último parche aplicado, leído del mismo archivo que escribe
 * scripts/actualizar-automatico.js. Se reporta en cada validación para
 * que el panel de licencias sepa en qué versión va realmente cada
 * campaña.
 *
 * Antes se leía de una variable de entorno (VERSION_PARCHE_ACTUAL) que
 * nadie definía nunca, así que siempre viajaba nula — y como el servidor
 * guarda lo que recibe, borraba la versión que el propio parche acababa
 * de registrar. La columna "Va en" del panel quedaba siempre vacía.
 */
function versionParcheAplicada() {
  try {
    const n = parseInt(fs.readFileSync(ARCHIVO_VERSION_PARCHE, 'utf8').trim());
    return Number.isInteger(n) ? String(n) : null;
  } catch (err) {
    return null; // todavía no se ha aplicado ningún parche por este medio
  }
}

function guardarCache() {
  try {
    fs.writeFileSync(ARCHIVO_CACHE, JSON.stringify(estadoActual), 'utf8');
  } catch (e) { /* si no se puede escribir, no es crítico */ }
}

function cargarCache() {
  try {
    const contenido = fs.readFileSync(ARCHIVO_CACHE, 'utf8');
    estadoActual = JSON.parse(contenido);
  } catch (e) { /* primera vez, no hay cache todavía */ }
}

async function llamarServidorLicencias(ruta, body) {
  const resp = await fetch(`${SERVIDOR_LICENCIAS}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Secret': API_SECRET },
    body: JSON.stringify(body)
  });
  const datos = await resp.json().catch(() => ({}));
  return { ok: resp.ok, datos };
}

/** Se llama UNA vez, normalmente desde un script aparte (npm run activar-licencia), no en cada arranque. */
async function activar() {
  if (!CLAVE_LICENCIA) throw new Error('Falta LICENCIA_CLAVE en el .env para activar.');
  const fingerprint = obtenerFingerprint();
  const { ok, datos } = await llamarServidorLicencias('/api/licencia/activar', {
    clave_licencia: CLAVE_LICENCIA, dominio: DOMINIO_INSTALACION, fingerprint
  });
  if (!ok) throw new Error(datos.error || 'No se pudo activar la licencia.');
  console.log(`Licencia activada correctamente. Vence: ${datos.vence}`);
  return datos;
}

/** Se llama al arrancar el servidor, y luego cada INTERVALO_VALIDACION_MS. */
async function validar() {
  validando = true;
  ultimaValidacionInicio = Date.now();
  try {
    const fingerprint = obtenerFingerprint();
    /* LOS EQUIPOS VIAJAN CON LA VALIDACIÓN, por el mismo carril que las
       sublicencias y por la misma razón: este servidor no puede escribir en la
       base del panel ni el panel en la nuestra. La validación periódica es el
       único camino que ya existe entre los dos.
       Si leerlos falla se manda una lista vacía: reportar equipos no puede
       impedir que se valide la licencia, que es lo que mantiene viva la
       campaña.
       PERO NO SE TRAGA EN SILENCIO (Orden 92): si leerlos falla, queda escrito en el
       registro. Antes un fallo aquí daba una lista vacía sin una palabra, y el panel
       mostraba «todavía no se ha entrado desde ningún equipo» con la campaña
       rechazando equipos. */
    let equipos = [];
    try { equipos = await require('./equiposAutorizados').equiposParaReportar(); }
    catch (e) { console.error('[LICENCIA] No se pudieron leer los equipos para reportarlos al panel (se valida igual, sin la lista):', e.code || '', e.message); }
    if (equipos.length) {
      console.log(`[LICENCIA] Equipos que se reportan al panel: ${equipos.length} (${equipos.filter((x) => x.estado === 'pendiente').length} pendiente(s)).`);
    }
    const { ok, datos } = await llamarServidorLicencias('/api/licencia/validar', {
      dominio: DOMINIO_INSTALACION, fingerprint, version_actual: versionParcheAplicada(), equipos
    });
    estadoActual = {
      valido: ok && datos.valido,
      motivo: datos.motivo || null,
      mensaje: datos.mensaje || null,
      diasRestantes: datos.dias_restantes,
      ultimaValidacionExitosa: new Date().toISOString()
    };
    guardarCache();

    /* LAS SUBLICENCIAS LLEGAN CON LA LICENCIA. Se sincronizan solo cuando la
       validacion salio bien: con una licencia rechazada, la lista que venga no
       es de fiar y apagar sublicencias a partir de ella seria dejar sin datos a
       gente por culpa de un problema de la madre. */
    /* Y lo que baja se aplica: el cupo y las revocaciones. Solo con la
       licencia válida, mismo criterio que las sublicencias — de una respuesta
       rechazada no se toma ninguna decisión sobre quién entra. */
    if (estadoActual.valido && (datos.equipos_config || datos.equipos_estados)) {
      try {
        const r = await require('./equiposAutorizados')
          .aplicarRespuestaDeLicencia(datos.equipos_config, datos.equipos_estados);
        if (r.cupo !== null || r.cambiados) {
          console.log(`Equipos autorizados: cupo ${r.cupo === null ? 'sin cambios' : r.cupo}, ${r.cambiados} equipo(s) cambiaron de estado.`);
        }
      } catch (e) { console.error('Aplicando equipos:', e.message); }
    }

    if (estadoActual.valido && Array.isArray(datos.sublicencias)) {
      const r = await require('./sincronizarSublicencias').sincronizar(datos.sublicencias);
      if (r.activadas || r.apagadas || r.sinPersona.length) {
        console.log(`[SUBLICENCIAS] ${r.activadas} activada(s), ${r.actualizadas} actualizada(s), `
          + `${r.apagadas} apagada(s)`
          + (r.votantesRecalculados !== undefined ? `, ${r.votantesRecalculados} votante(s) recalculado(s)` : ''));
      }
      if (r.sinPersona.length) {
        console.warn('[SUBLICENCIAS] Vendidas a cedulas que NO existen en esta campana: '
          + r.sinPersona.join(', ') + '. No se activaron.');
      }
    }

    if (!estadoActual.valido) {
      console.error(`[LICENCIA] Validación rechazada: ${estadoActual.motivo} — ${estadoActual.mensaje || ''}`);
    } else if (datos.avisar_vencimiento_proximo) {
      console.warn(`[LICENCIA] Aviso: vence en ${datos.dias_restantes} día(s).`);
    }
  } catch (err) {
    // No se pudo contactar al Servidor de Licencias (sin internet,
    // servidor caído, etc.) — no se bloquea de inmediato, se mantiene el
    // último estado conocido hasta que pase la tolerancia.
    console.error('[LICENCIA] No se pudo contactar al Servidor de Licencias:', err.message);
  } finally {
    validando = false;
  }
}

/**
 * Pide una validación al panel «ya», sin pasar de una cada VENTANA. Devuelve qué hizo (para las pruebas):
 * 'sin_licencia' (esta instalación no tiene servidor de licencias configurado: no hay a quién avisar), 'ahora', 'programada' (se ejecutará al terminar la ventana)
 * o 'ya_programada' (ya hay una en espera: esta petición viaja en ella). Nunca lanza.
 */
function validarPronto() {
  if (!SERVIDOR_LICENCIAS || !API_SECRET || !DOMINIO_INSTALACION) return 'sin_licencia';
  if (temporizadorPronta) return 'ya_programada';
  const enEntorno = process.env.LICENCIA_VALIDACION_PRONTA_MS;   // solo lo usa la prueba, para no esperar 2 minutos de verdad
  const ventana = enEntorno !== undefined && enEntorno !== '' && Number(enEntorno) >= 0 ? Number(enEntorno) : VENTANA_VALIDACION_PRONTA_MS;
  const espera = Math.max(0, ultimaValidacionInicio + ventana - Date.now());
  const correr = () => {
    // Si justo hay una validación en curso, la lista que ella leyó puede no traer este equipo: se espera a que termine y se vuelve a validar.
    if (validando) { temporizadorPronta = setTimeout(correr, 500); if (temporizadorPronta.unref) temporizadorPronta.unref(); return; }
    temporizadorPronta = null;
    validar().catch(() => {});
  };
  temporizadorPronta = setTimeout(correr, espera);
  if (temporizadorPronta.unref) temporizadorPronta.unref();   // no mantiene vivo el proceso
  return espera === 0 ? 'ahora' : 'programada';
}

/** Usado por el middleware: decide si esta instalación puede seguir funcionando ahora mismo. */
function estaAutorizada() {
  if (estadoActual.valido === true) return true;
  if (estadoActual.valido === false) return false;
  // Todavía no se ha validado nunca en esta sesión del proceso (recién
  // arrancado) — se confía en la última validación exitosa guardada en
  // disco, mientras no supere la tolerancia sin contacto.
  if (!estadoActual.ultimaValidacionExitosa) return false;
  const horasDesdeUltimaValidacion = (Date.now() - new Date(estadoActual.ultimaValidacionExitosa).getTime()) / 3600000;
  return horasDesdeUltimaValidacion <= TOLERANCIA_SIN_CONTACTO_HORAS;
}

function iniciarValidacionPeriodica() {
  cargarCache();
  validar(); // primera validación al arrancar
  setInterval(validar, INTERVALO_VALIDACION_MS);
}

module.exports = { activar, validar, validarPronto, estaAutorizada, iniciarValidacionPeriodica, obtenerFingerprint, obtenerEstado: () => estadoActual };
