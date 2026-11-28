#!/bin/bash
# scripts/apagar-mysqld-prueba.sh <directorio-de-trabajo>
#
# Apaga el mysqld de prueba montado por montar-mysqld-prueba.sh y BORRA su datadir — en ese orden y
# sólo si el proceso ya no existe. Es la única forma de apagar y limpiar. NUNCA `mysqladmin shutdown;
# rm -rf` a mano: `shutdown` vuelve cuando el servidor acepta la petición, no cuando termina, y un
# datadir borrado a mitad del apagado dejó a un mysqld reintentando el error durante 1 h 30 min hasta
# escribir 97 GB de log (incidente del 27 de noviembre de 2026; ver scripts/lib-mysqld-prueba.sh).
#
# SECUENCIA
#   1. El PID sale del pid-file de ESTA instancia —nunca de un nombre— y se verifica que es un mysqld
#      vivo, con exactamente --datadir=<dir>/data y del mismo usuario. Si no lo es (PID reutilizado,
#      pid-file ajeno) no se toca ni se borra nada.
#   2. Apagado ordenado: `mysqladmin shutdown` (con tiempo máximo: un servidor detenido lo dejaría
#      colgado) y se ESPERA a que el proceso desaparezca, hasta MYSQLD_PRUEBA_PLAZO s (60 por omisión).
#   3. Si no terminó: se verifica de nuevo el PID y se mata con SIGKILL, sólo ese PID.
#   4. Sólo cuando el proceso ya no existe (y ningún otro mysqld lleva ese datadir) se borra el
#      datadir y el directorio del socket. El log se conserva.
#   Si algo sigue vivo al final, NO se borra nada y se sale con error.
#
# Prohibido en este guion y en cualquier otro de pruebas: pkill, killall o matar por nombre. El mysqld
# de producción (usuario mysql, datadir /home/mysql) queda fuera: no tiene este --datadir ni este usuario.
#
# Códigos de salida: 0 limpio · 2 uso · 4 me niego (PID o proceso ajeno) · 5 no pude detener el proceso.

set -uo pipefail
DIR_SCRIPTS="$(dirname "$(readlink -f "$0")")"
# shellcheck source=lib-mysqld-prueba.sh
. "$DIR_SCRIPTS/lib-mysqld-prueba.sh"

preparar_instancia "${1:-}" || exit 2
case "$PLAZO_APAGADO" in ''|*[!0-9]*) echo "MYSQLD_PRUEBA_PLAZO debe ser un entero (segundos)." >&2; exit 2 ;; esac

# esperar_muerte <pid> <segundos> — verdadero si el proceso desaparece antes del plazo.
esperar_muerte() {
  local i
  for ((i = 0; i < $2; i++)); do
    vivo "$1" || return 0
    sleep 1
  done
  ! vivo "$1"
}

PID="$(pid_del_pidfile)"

if [ -n "$PID" ] && vivo "$PID"; then
  # --- 1. verificar que es nuestro --------------------------------------------------------------------
  if ! es_nuestro "$PID"; then
    echo "ME NIEGO: el PID $PID del pid-file $PIDFILE está vivo pero NO es un mysqld con --datadir=$DATA de mi usuario." >&2
    echo "  No lo mato ni borro nada. Es: $(tr '\0' ' ' < "/proc/$PID/cmdline" 2>/dev/null | cut -c1-200)" >&2
    exit 4
  fi
  echo "PID $PID verificado: mysqld de $DATA."

  # --- 2. apagado ordenado, y esperar de verdad --------------------------------------------------------
  echo "Pido apagado ordenado (mysqladmin shutdown) y espero hasta ${PLAZO_APAGADO}s a que el proceso termine..."
  timeout -k 2 10 mysqladmin --socket="$SOCK" -u root shutdown >/dev/null 2>&1 || echo "  (mysqladmin no obtuvo respuesta en 10 s o falló; sigo esperando al proceso)"
  if esperar_muerte "$PID" "$PLAZO_APAGADO"; then
    echo "El proceso $PID terminó solo."
  else
    # --- 3. no terminó: matarlo, sólo a ese PID ----------------------------------------------------------
    echo "El proceso $PID SIGUE VIVO tras ${PLAZO_APAGADO}s. Lo mato por PID (SIGKILL)."
    if es_nuestro "$PID"; then
      kill -KILL "$PID" 2>/dev/null || true
    else
      echo "ME NIEGO: el PID $PID ya no es nuestro mysqld (cambió durante la espera)." >&2; exit 4
    fi
    if ! esperar_muerte "$PID" 15; then
      echo "NO PUDE DETENER el PID $PID tras SIGKILL. No borro nada." >&2; exit 5
    fi
    echo "El proceso $PID ya no existe (SIGKILL)."
  fi
else
  # sin pid-file válido: puede ser una sobra sin proceso, o un mysqld que no figura en el pid-file
  AJENOS="$(pids_con_datadir | tr '\n' ' ')"
  if [ -n "${AJENOS// /}" ]; then
    echo "ME NIEGO: hay mysqld vivo con --datadir=$DATA (PID: $AJENOS) pero no figura en el pid-file $PIDFILE." >&2
    echo "  No mato por nombre ni por suposición. Revíselo a mano; no borro nada." >&2
    exit 4
  fi
  echo "No hay ningún mysqld vivo para $DATA (pid-file: ${PID:-ausente}). Sólo limpio."
fi

# --- 4. el proceso ya no existe: confirmar, y recién entonces borrar -----------------------------------
RESTO="$(pids_con_datadir | tr '\n' ' ')"
if [ -n "${RESTO// /}" ]; then
  echo "NO BORRO: siguen vivos mysqld con ese datadir (PID: $RESTO)." >&2; exit 5
fi
if [ -e "$DATA" ]; then
  if [ ! -f "$MARCA" ] || [ "$(head -n1 "$MARCA")" != "$DATA" ]; then
    echo "ME NIEGO a borrar $DATA: no lo creó montar-mysqld-prueba.sh (falta o no coincide $MARCA)." >&2; exit 4
  fi
  case "$DATA" in */data) ;; *) echo "ME NIEGO: «$DATA» no termina en /data." >&2; exit 4 ;; esac
  rm -rf -- "$DATA"
  echo "Datadir borrado: $DATA"
else
  echo "El datadir $DATA ya no existía."
fi
rm -f -- "$MARCA"
rm -rf -- "$SOCKDIR"
if [ -f "$LOG" ]; then echo "Log conservado: $LOG ($(stat -c %s "$LOG") bytes)"; fi
exit 0
