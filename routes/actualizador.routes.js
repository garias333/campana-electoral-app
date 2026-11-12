/**
 * Disparador de actualización: deja que el Servidor de Licencias ordene
 * a esta instalación aplicarse los parches pendientes AHORA, en vez de
 * esperar a que el cron de madrugada los recoja solo.
 *
 * Es la misma tarea de siempre —scripts/actualizar-automatico.js— solo
 * que arrancada desde afuera. No hay lógica de actualización duplicada
 * aquí: si algo cambia en cómo se aplica un parche, se cambia allá.
 *
 * POR QUÉ RESPONDE ANTES DE TERMINAR
 *   Aplicar un parche reinicia PM2, o sea que mata el proceso que está
 *   atendiendo esta misma solicitud. Esperar a que termine garantizaría
 *   que la respuesta nunca llegue. Así que se arranca la tarea suelta, se
 *   contesta "recibido" de una, y el resultado real viaja por el camino
 *   que ya existía: al terminar, el actualizador le reporta a
 *   /parches/confirmar del Servidor de Licencias si salió bien o mal.
 *
 * SEGURIDAD
 *   Esta ruta corre comandos en el servidor, así que es la más delicada
 *   de la aplicación. Va protegida con el mismo secreto compartido que ya
 *   usan las dos partes (LICENCIA_API_SECRET), comparado en tiempo
 *   constante para no filtrar el secreto midiendo cuánto tarda la
 *   respuesta. Si el secreto no está configurado, la ruta se niega a
 *   funcionar en vez de quedar abierta.
 */
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { leerAplicados, compactar } = require('../config/parchesAplicados');

const router = express.Router();

const PROYECTO = path.join(__dirname, '..');
const SCRIPT = path.join(PROYECTO, 'scripts', 'actualizar-automatico.js');
const NOMBRE_SCRIPT = path.join('scripts', 'actualizar-automatico.js');
const CARPETA_LOGS = path.join(PROYECTO, 'logs');

/**
 * Una actualización a la vez. Dos a la vez descomprimirían el mismo árbol
 * de archivos al tiempo y se pisarían a media escritura.
 *
 * SE LE PREGUNTA AL SISTEMA, NO A UNA VARIABLE
 *   Antes esto era una bandera en memoria. Una bandera en memoria se borra
 *   en cada reinicio de PM2 —y aplicar un parche reinicia PM2—, así que
 *   mentía en los dos sentidos:
 *
 *   - Decía «libre» cuando NO lo estaba: tras el reinicio de media
 *     actualización, el proceso nuevo nacía con la bandera abajo mientras
 *     el actualizador seguía trabajando.
 *   - Decía «ocupado» cuando SÍ estaba libre: si la corrida terminaba sin
 *     aplicar nada («ya estás al día»), no había reinicio que la bajara y
 *     quedaba trabada hasta que vencía un temporizador de diez minutos.
 *     O sea que el candado se cerraba justo en el caso inofensivo. El 8 de
 *     agosto de 2026 eso dejó a las dos campañas sin poder recibir el
 *     parche 11 entre las 18:59:57 y las 19:10:08, y el registro de
 *     `logs/actualizaciones.log` lo muestra: una corrida en vacío, y la
 *     siguiente diez minutos y once segundos después.
 *
 *   Preguntarle al sistema si el proceso existe no tiene ninguno de los dos
 *   problemas: sobrevive al reinicio y se libera solo en cuanto el
 *   actualizador termina, sin importar cómo termine.
 */

/**
 * ¿Hay un proceso corriendo el actualizador DE ESTA instalación?
 *
 * CÓMO SE BUSCA, Y POR QUÉ ASÍ
 *   - Por argumento EXACTO, nunca por subcadena. Un `pgrep -f` con el
 *     nombre del script se encuentra a sí mismo —el patrón aparece en la
 *     línea de comandos del propio pgrep— y la espera no termina nunca.
 *     Ya costó siete minutos una vez.
 *   - Nunca el PID propio, por lo mismo.
 *   - Las rutas relativas se resuelven contra el directorio de trabajo del
 *     proceso, porque el cron lo lanza justamente así:
 *         cd /ruta/al/sitio && node scripts/actualizar-automatico.js
 *     Sin resolverlas, el actualizador de OTRA campaña del mismo VPS
 *     —idéntico argumento relativo, distinta instalación— contaría como
 *     propio y bloquearía una actualización legítima.
 *   - `/proc/<pid>/cwd` solo lo puede leer el dueño del proceso. Como cada
 *     sitio corre con su propio usuario, los procesos ajenos fallan al
 *     resolverse y quedan descartados sin necesidad de código extra.
 */
function actualizadorEnMarcha() {
  let pids;
  try {
    pids = fs.readdirSync('/proc');
  } catch (err) {
    return false; // Sin /proc no hay forma de saberlo; queda el margen de arranque.
  }

  for (const pid of pids) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;

    let argumentos;
    try {
      argumentos = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    } catch (err) {
      continue; // El proceso terminó entre el listado y la lectura.
    }

    for (const argumento of argumentos) {
      if (!argumento.endsWith(NOMBRE_SCRIPT)) continue;
      if (argumento === SCRIPT) return true;
      if (path.isAbsolute(argumento)) continue; // Absoluta y distinta: es de otra instalación.
      let trabajo;
      try {
        trabajo = fs.readlinkSync(`/proc/${pid}/cwd`);
      } catch (err) {
        continue; // No se puede leer: el proceso es de otro usuario, o sea de otro sitio.
      }
      if (path.resolve(trabajo, argumento) === SCRIPT) return true;
    }
  }
  return false;
}

/**
 * Margen entre el `spawn` y el momento en que el proceso ya figura en
 * /proc. Son milisegundos, pero en ese hueco dos clics seguidos arrancarían
 * dos actualizadores descomprimiendo sobre el mismo árbol, que es
 * exactamente lo que este candado existe para impedir. Pasado el margen
 * manda lo que diga el sistema.
 */
const MARGEN_ARRANQUE_MS = 60 * 1000;
let arrancadoEn = 0;

function hayActualizacionEnCurso() {
  if (arrancadoEn && Date.now() - arrancadoEn < MARGEN_ARRANQUE_MS) return true;
  return actualizadorEnMarcha();
}

/** Compara en tiempo constante: un `===` normal delata el secreto por el tiempo que tarda. */
function secretoValido(recibido) {
  const esperado = process.env.LICENCIA_API_SECRET;
  if (!esperado || !recibido) return false;
  const a = Buffer.from(String(recibido));
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function exigirSecreto(req, res, next) {
  if (!process.env.LICENCIA_API_SECRET) {
    return res.status(503).json({
      error: 'Esta instalación no tiene configurado LICENCIA_API_SECRET; la actualización remota está deshabilitada.'
    });
  }
  if (!secretoValido(req.headers['x-api-secret'])) {
    return res.status(401).json({ error: 'No autorizado.' });
  }
  next();
}

/**
 * Dice en qué versión de parche va esta instalación. Sirve para que el
 * panel muestre el estado real sin tener que esperar a que la campaña
 * reporte algo, y para comprobar de un vistazo que el disparador
 * responde antes de mandarle una actualización de verdad.
 */
router.get('/estado', exigirSecreto, (req, res) => {
  let version = 0;
  try {
    version = parseInt(fs.readFileSync(path.join(PROYECTO, '.version-parche'), 'utf8').trim()) || 0;
  } catch (err) { /* Sin archivo todavía: nunca se ha aplicado un parche por este medio. */ }
  // Los parches que tiene puestos, compactados («1-333»): el panel de licencias
  // los usa para marcar «falta el N» en vez de dejar aplicar un parche sin su requisito.
  let aplicados = '';
  try { aplicados = compactar(leerAplicados(PROYECTO, version)); } catch (err) { /* sin lista: el panel usa la versión */ }
  res.json({ ok: true, version_actual: version, parches_aplicados: aplicados, actualizacion_en_curso: hayActualizacionEnCurso() });
});

/**
 * Arranca la actualización. Responde de inmediato: el resultado llega
 * después al Servidor de Licencias por /parches/confirmar.
 */
router.post('/ejecutar', exigirSecreto, (req, res) => {
  if (hayActualizacionEnCurso()) {
    return res.status(409).json({ error: 'Ya hay una actualización en curso en esta instalación.' });
  }
  if (!fs.existsSync(SCRIPT)) {
    return res.status(500).json({ error: 'Esta instalación no tiene scripts/actualizar-automatico.js.' });
  }

  fs.mkdirSync(CARPETA_LOGS, { recursive: true });
  const salida = fs.openSync(path.join(CARPETA_LOGS, 'actualizaciones.log'), 'a');
  fs.writeSync(salida, `\n=== Actualización pedida por el Servidor de Licencias — ${new Date().toISOString()} ===\n`);

  arrancadoEn = Date.now();
  // Se lanza a través de `setsid` — no basta con `detached`.
  //
  // El actualizador termina llamando a `pm2 restart`, que reinicia ESTA
  // misma aplicación. Y PM2 no mata solo al proceso: por omisión mata su
  // ÁRBOL entero (treekill). Como el actualizador nació de aquí, es parte
  // de ese árbol y se mataba a sí mismo justo al reiniciar — después de
  // dejar los archivos aplicados, pero antes de guardar el número de
  // versión y de avisarle al Servidor de Licencias. Resultado: la campaña
  // quedaba actualizada de verdad, pero reportada como fallida.
  //
  // `setsid` intercala un proceso que se retira de inmediato, así que el
  // actualizador queda colgando de init y ya no figura como descendiente
  // de esta app cuando PM2 recorre el árbol.
  // Si el sistema no trae setsid (raro en Linux), se lanza igual sin él:
  // vale más una actualización que quizá se corte en el reinicio que
  // ninguna. Se avisa en el registro para que quede rastro del motivo.
  const rutaSetsid = ['/usr/bin/setsid', '/bin/setsid'].find(r => fs.existsSync(r));
  if (!rutaSetsid) {
    console.warn('AVISO: no hay setsid en este sistema; el actualizador puede cortarse al reiniciar PM2.');
  }
  const hijo = rutaSetsid
    ? spawn(rutaSetsid, [process.execPath, SCRIPT], { cwd: PROYECTO, detached: true, stdio: ['ignore', salida, salida] })
    : spawn(process.execPath, [SCRIPT], { cwd: PROYECTO, detached: true, stdio: ['ignore', salida, salida] });
  hijo.on('error', (err) => {
    // Nunca llegó a existir un proceso, así que el margen de arranque no
    // tiene nada que cubrir: se retira de una para no bloquear el reintento.
    arrancadoEn = 0;
    console.error('No se pudo arrancar el actualizador:', err.message);
  });
  hijo.unref();

  res.json({
    ok: true,
    mensaje: 'Actualización iniciada. El resultado se reportará al Servidor de Licencias al terminar.'
  });
});

module.exports = router;
