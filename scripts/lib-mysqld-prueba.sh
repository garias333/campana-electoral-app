#!/bin/bash
# scripts/lib-mysqld-prueba.sh
#
# Funciones comunes de montar-mysqld-prueba.sh y apagar-mysqld-prueba.sh. Se hace `source`; no se ejecuta.
#
# POR QUÉ EXISTEN ESTOS GUIONES (incidente del 27 de noviembre de 2026):
#   Un mysqld de prueba (puerto 33099, datadir en el scratchpad) recibió `mysqladmin shutdown` y, sin
#   esperar a que terminara, un `rm -rf` le borró el datadir. A mitad del apagado el servidor ya no
#   encontraba `ib_buffer_pool.incomplete` ni los `#innodb_redo`, y repitió el error sin parar durante
#   1 h 30 min. Su log era un redirect sin tope: creció a 97 GB y llenó el disco del VPS, donde viven
#   las siete aplicaciones. `mysqladmin shutdown` vuelve cuando el servidor ACEPTA la petición, no
#   cuando termina.
#
# REGLAS QUE ESTAS FUNCIONES HACEN CUMPLIR:
#   1. Nunca se borra un datadir mientras su mysqld siga vivo.
#   2. Nunca se mata nada por nombre (nada de pkill/killall): sólo por PID, leído del pid-file de la
#      instancia y verificado como un mysqld de ESE --datadir y del MISMO usuario. El mysqld de
#      producción (usuario mysql, datadir /home/mysql) queda fuera por construcción.
#   3. Ningún archivo del mysqld de prueba —el log incluido— puede crecer sin tope (ulimit -f).

PUERTO=33099
MYSQLD_BIN=/usr/sbin/mysqld

# Tope por ARCHIVO (RLIMIT_FSIZE) para todo lo que escribe el mysqld de prueba, log incluido. No es un
# tope del total del datadir. Medido y justificado en el encabezado de montar-mysqld-prueba.sh.
TOPE_MB_MINIMO=256
TOPE_MB="${MYSQLD_PRUEBA_TOPE_MB:-256}"

# Segundos que se espera a que el mysqld termine solo antes de matarlo por PID.
PLAZO_APAGADO="${MYSQLD_PRUEBA_PLAZO:-60}"

# preparar_instancia <directorio-de-trabajo> — fija TRABAJO, DATA, LOG, INITLOG, SOCKDIR, SOCK, PIDFILE, MARCA.
# Todo cuelga del directorio de trabajo, salvo el socket y el pid-file, que van a un directorio corto
# (el socket de la ruta larga del scratchpad falla: «socket file path is too long», límite de 107).
preparar_instancia() {
  if [ -z "${1:-}" ]; then echo "Falta el directorio de trabajo (uso: $0 <directorio-de-trabajo>)" >&2; return 2; fi
  if [ ! -d "$1" ]; then echo "No existe el directorio de trabajo: $1" >&2; return 2; fi
  TRABAJO="$(readlink -f -- "$1")"
  # Una red de seguridad barata: un directorio de trabajo tiene al menos tres niveles (/tmp/x/y), y no es $HOME.
  local barras="${TRABAJO//[^\/]/}"
  if [ "${#barras}" -lt 3 ] || [ "$TRABAJO" = "$HOME" ]; then
    echo "Me niego: $TRABAJO no es un directorio de trabajo razonable." >&2; return 2
  fi
  DATA="$TRABAJO/data"
  LOG="$TRABAJO/mysqld.log"
  INITLOG="$TRABAJO/init.log"
  MARCA="$TRABAJO/.mysqld-prueba-datadir"   # la crea montar; apagar sólo borra un datadir que tenga marca
  local h; h="$(printf '%s' "$TRABAJO" | md5sum | cut -c1-8)"
  SOCKDIR="/tmp/claude-$(id -u)/sock-$h"
  SOCK="$SOCKDIR/m.sock"
  PIDFILE="$SOCKDIR/m.pid"
}

# vivo <pid> — verdadero si el proceso existe y no es un zombi (kill -0 acierta con los zombis).
vivo() {
  local st
  st="$(sed -n 's/^State:[[:space:]]*\(.\).*/\1/p' "/proc/$1/status" 2>/dev/null)"
  [ -n "$st" ] && [ "$st" != "Z" ] && [ "$st" != "X" ]
}

# cmdline_de <pid> — carga los argumentos del proceso en el arreglo ARGS; falla si no se pueden leer.
cmdline_de() {
  ARGS=()
  [ -r "/proc/$1/cmdline" ] || return 1
  mapfile -d '' -t ARGS < "/proc/$1/cmdline" 2>/dev/null || return 1
  [ "${#ARGS[@]}" -gt 0 ]
}

# lleva_datadir <pid> — verdadero si es un proceso `mysqld` con exactamente --datadir=$DATA.
lleva_datadir() {
  cmdline_de "$1" || return 1
  [ "$(basename -- "${ARGS[0]}")" = "mysqld" ] || return 1
  local a
  for a in "${ARGS[@]:1}"; do [ "$a" = "--datadir=$DATA" ] && return 0; done
  return 1
}

# es_nuestro <pid> — el PID es un mysqld vivo, de ESTE datadir y de MI usuario. Es la única puerta
# por la que un PID puede ser matado.
es_nuestro() {
  vivo "$1" || return 1
  lleva_datadir "$1" || return 1
  [ "$(stat -c %u "/proc/$1" 2>/dev/null)" = "$(id -u)" ]
}

# pids_con_datadir — imprime los PID (de cualquier usuario) de procesos mysqld con --datadir=$DATA.
# Sólo LEE /proc; nunca se usa para matar.
pids_con_datadir() {
  local d p
  for d in /proc/[0-9]*; do
    p="${d#/proc/}"
    vivo "$p" && lleva_datadir "$p" && echo "$p"
  done
  return 0
}

# puerto_ocupado — verdadero si algo escucha en $PUERTO.
puerto_ocupado() {
  [ -n "$(ss -Hltn "sport = :$PUERTO" 2>/dev/null)" ]
}

# pid_del_pidfile — imprime el PID del pid-file de la instancia, o nada.
pid_del_pidfile() {
  [ -f "$PIDFILE" ] || return 0
  head -n1 "$PIDFILE" 2>/dev/null | tr -dc '0-9'
}

# validar_tope — el tope debe ser un entero de al menos $TOPE_MB_MINIMO.
validar_tope() {
  case "$TOPE_MB" in ''|*[!0-9]*) echo "MYSQLD_PRUEBA_TOPE_MB debe ser un entero (MB), recibí «$TOPE_MB»." >&2; return 2 ;; esac
  if [ "$TOPE_MB" -lt "$TOPE_MB_MINIMO" ]; then
    echo "Me niego: tope de $TOPE_MB MB por debajo del mínimo de $TOPE_MB_MINIMO MB." >&2; return 2
  fi
}
