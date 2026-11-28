#!/bin/bash
# scripts/montar-mysqld-prueba.sh <directorio-de-trabajo>
#
# Levanta un mysqld PRIVADO para probar contra una base desechable (puerto 33099, sólo 127.0.0.1).
# `electoraluser` sólo escribe en `electoraldb`: no hay base de pruebas, así que se monta una aparte.
# Todo cuelga de <directorio-de-trabajo> (normalmente el scratchpad de la sesión):
#
#   <dir>/data/        datadir (se crea aquí; el directorio tiene que existir ya)
#   <dir>/mysqld.log   log de errores del servidor (con tope, ver abajo)
#   <dir>/init.log     log de la inicialización
#   /tmp/claude-<uid>/sock-<hash>/m.sock y m.pid   socket y pid-file (ruta corta a propósito)
#
# SE APAGA SIEMPRE CON scripts/apagar-mysqld-prueba.sh <dir>. NUNCA con `mysqladmin shutdown; rm -rf`
# a mano: ver el porqué en scripts/lib-mysqld-prueba.sh (incidente de los 97 GB, 27 de nov. de 2026).
#
# SE NIEGA A MONTAR (código de salida 3) si:
#   - hay un mysqld vivo con ese --datadir, o el pid-file de la instancia apunta a un proceso vivo;
#   - algo escucha en el puerto 33099;
#   - ya existe <dir>/data (sobra de una corrida anterior: se limpia con apagar-mysqld-prueba.sh).
# Antes borraba el datadir sin mirar si alguien lo usaba; eso es justo lo que no puede volver a pasar.
#
# TOPE DE ARCHIVO — `ulimit -f` (RLIMIT_FSIZE) dentro del subshell que lanza mysqld:
#   Es un tope POR ARCHIVO, no del total. Con él, un log desbocado deja de crecer en TOPE_MB en vez de
#   llenar el disco. El valor por omisión sale de MEDIR el archivo más grande de un datadir real tras
#   cargar los datos de scripts/probar-*.js (ver «MEDICIÓN» abajo). Variable MYSQLD_PRUEBA_TOPE_MB para
#   subirlo; nunca baja de 256 MB (la biblioteca lo rechaza).
#
# MEDICIÓN (28 de nov. de 2026, mysqld 8.4.10-10): init-db sobre una base y, clonadas de ella, siete
#   suites reales en cadena (excel-y-editar, inscripcion-enlace, ficha-territorios, datos-campana-fichas,
#   coordinador-agregar-lider, barrio-pone-comuna, candidato), con un vigilante que anotaba cada segundo el
#   tamaño de cada archivo del datadir. Mayores: mysql.ibd 40 MB (41.943.040 bytes) · undo_001/002 16 MB ·
#   ibtmp1, ibdata1 y el doublewrite 12 MB · redo 3 MB cada uno · binlog completo 3 MB. Datadir total: 326 MB.
#   Regla: tope = max(256 MB, 4 × el mayor) = max(256, 160) = 256 MB.
#   OJO: `mysql.ibd` (el diccionario de datos) crece ~1,8 MB por cada base creada, y borrar la base no
#   devuelve el espacio. Un datadir que acumule del orden de 120 bases llegaría a 256 MB: en ese caso se
#   monta con MYSQLD_PRUEBA_TOPE_MB mayor, o —mejor— se apaga y se monta uno nuevo.
#
# PRUEBA DEL INCIDENTE CON EL TOPE PUESTO (28 de nov. de 2026): se montó con este guion, se borró a mano
#   el datadir con el mysqld vivo y se le mandó `mysqladmin shutdown` — lo mismo que el 27 de noviembre —,
#   con un vigilante que anotaba el log cada 0,5 s y estaba armado para matar por PID si pasaba de 256 MB.
#   Resultado: el error del incidente se reprodujo idéntico (2.314.088 veces «Unable to open
#   './#innodb_redo/#ib_redoNN' (error: 1504)»; `mysqladmin` se rindió a los 29 s esperando el pid-file).
#   El log creció ~14 MB/s (54 MB a los 4,4 s, 212 MB a los 15 s) y tocó 268.435.456 bytes EXACTOS a los
#   ~19 s del shutdown; no pasó de ahí en ninguna muestra. El proceso murió solo ~1 s después, sin que
#   el vigilante tuviera que matarlo (cero KILL), sin dejar `core`; la última línea del log quedó cortada
#   por el tope. Sin tope, a ese ritmo, son los ~100 GB del incidente en un par de horas. Qué señal o
#   salida lo mató no se determinó (el proceso no es hijo del guion). Disco libre antes y después: igual.
#
# Después de montar, las pruebas se corren con:
#   DB_HOST=127.0.0.1 DB_PORT=33099 DB_USER=root DB_PASSWORD= DB_NAME=simulada… node scripts/probar-….js
# (`root`, no un usuario sin SUPER: init-db crea rutinas y disparadores con el binlog encendido.)

set -euo pipefail
DIR_SCRIPTS="$(dirname "$(readlink -f "$0")")"
# shellcheck source=lib-mysqld-prueba.sh
. "$DIR_SCRIPTS/lib-mysqld-prueba.sh"

preparar_instancia "${1:-}" || exit 2
validar_tope || exit 2

rechazar() { echo "ME NIEGO A MONTAR: $*" >&2; exit 3; }

# --- (b) negarse a montar sobre algo que está en uso -------------------------------------------------
PID_VIEJO="$(pid_del_pidfile)"
if [ -n "$PID_VIEJO" ] && vivo "$PID_VIEJO"; then
  rechazar "el pid-file $PIDFILE apunta al PID $PID_VIEJO, que sigue vivo. Apáguelo con: $DIR_SCRIPTS/apagar-mysqld-prueba.sh $TRABAJO"
fi
EN_USO="$(pids_con_datadir | tr '\n' ' ')"
if [ -n "${EN_USO// /}" ]; then
  rechazar "ya hay un mysqld vivo con --datadir=$DATA (PID: $EN_USO). Apáguelo con: $DIR_SCRIPTS/apagar-mysqld-prueba.sh $TRABAJO"
fi
if puerto_ocupado; then
  rechazar "algo ya escucha en el puerto $PUERTO. Quién: $(ss -Hltnp "sport = :$PUERTO" 2>/dev/null | head -1)"
fi
if [ -e "$DATA" ]; then
  rechazar "ya existe $DATA (sobra de una corrida anterior, sin ningún mysqld vivo). Límpielo con: $DIR_SCRIPTS/apagar-mysqld-prueba.sh $TRABAJO"
fi

# --- preparar ---------------------------------------------------------------------------------------
mkdir -p "$SOCKDIR"; chmod 700 "$SOCKDIR"
rm -f "$SOCK" "$PIDFILE"        # sobras sin proceso (ya comprobado arriba)
mkdir "$DATA"
printf '%s\n' "$DATA" > "$MARCA"
TOPE_KB=$((TOPE_MB * 1024))

limpiar_y_salir() {   # ante cualquier fallo, apagar por el camino seguro (nunca un rm -rf suelto)
  "$DIR_SCRIPTS/apagar-mysqld-prueba.sh" "$TRABAJO" >&2 || true
  exit 1
}

# --- inicializar (también bajo el tope) -------------------------------------------------------------
if ! ( ulimit -f "$TOPE_KB"
       "$MYSQLD_BIN" --no-defaults --initialize-insecure --datadir="$DATA" --socket="$SOCK" \
         --log-error-verbosity=1 > "$INITLOG" 2>&1 ); then
  echo "FALLÓ la inicialización. Últimas líneas de $INITLOG:" >&2; tail -20 "$INITLOG" >&2
  limpiar_y_salir
fi

# --- arrancar, con el log bajo el mismo tope --------------------------------------------------------
: > "$LOG"
( ulimit -f "$TOPE_KB"
  setsid nohup "$MYSQLD_BIN" --no-defaults --datadir="$DATA" --socket="$SOCK" --pid-file="$PIDFILE" \
    --bind-address=127.0.0.1 --port="$PUERTO" --mysqlx=OFF --default-time-zone=-05:00 \
    --log-error-verbosity=1 > "$LOG" 2>&1 < /dev/null & )

for i in $(seq 1 60); do
  if mysqladmin --socket="$SOCK" -u root ping >/dev/null 2>&1; then
    PID="$(pid_del_pidfile)"
    if [ -z "$PID" ] || ! es_nuestro "$PID"; then
      echo "El servidor responde pero el pid-file no apunta a un mysqld de $DATA (PID «$PID»). No sigo." >&2
      limpiar_y_salir
    fi
    LIM="$(awk '/^Max file size/ {print $4}' "/proc/$PID/limits")"
    echo "mysqld de prueba ARRIBA (intento $i): PID=$PID puerto=$PUERTO socket=$SOCK"
    echo "  datadir=$DATA"
    echo "  log=$LOG"
    echo "  tope por archivo=${TOPE_MB} MB  (/proc/$PID/limits «Max file size»: $LIM bytes)"
    exit 0
  fi
  # si el proceso ya murió no tiene sentido esperar el resto del minuto
  PID_ARR="$(pid_del_pidfile)"
  if [ -n "$PID_ARR" ] && ! vivo "$PID_ARR"; then break; fi
  sleep 1
done

echo "NO ARRANCÓ. Últimas líneas de $LOG:" >&2; tail -20 "$LOG" >&2
limpiar_y_salir
