#!/usr/bin/env bash
#
# COPIA LA CARPETA CENTRAL DE LEGISLACIÓN A CADA CAMPAÑA. SOLO PARA EL VPS, COMO ROOT.
#
# Una sola carpeta manda: la de ESTA instalación (electoral). Lo que Gildardo
# suba, cambie o borre ahí se refleja en `legislacion/` de cada campaña. El
# código de la aplicación NO cambia: cada campaña sigue leyendo su propia
# carpeta (routes/legislacion.routes.js), que este guion mantiene.
#
# Pensado para correr desde el cron de root cada 15 minutos:
#
#   */15 * * * * PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
#       /bin/bash /home/appestrategia-electoral/htdocs/electoral.appestrategia.net/scripts/sincronizar-legislacion.sh \
#       >> /var/log/sincronizar-legislacion.log 2>&1
#
# El guion escribe su propio registro; la redirección del cron solo recoge lo
# inesperado (un error del propio bash), por eso en una corrida normal no
# añade nada.
#
# USO
#   sincronizar-legislacion.sh               copia a todas las campañas
#   sincronizar-legislacion.sh --simular     dice qué haría; no crea ni cambia nada
#   sincronizar-legislacion.sh --una RUTA    solo la campaña instalada en RUTA
#                                            (la carpeta que tiene package.json)
#
# QUÉ COPIA
#   Solo *.pdf, *.PDF e indice.json, del nivel superior de la carpeta central.
#   Ni subcarpetas ni enlaces simbólicos. Con --delete: lo que se borre en la
#   central desaparece en las campañas. Cualquier OTRO archivo que alguien deje
#   en el `legislacion/` de una campaña (por ejemplo un .txt) no se toca.
#   Con --delay-updates: nadie lee un PDF a medias (se escribe aparte y se
#   mueve todo al final).
#   Dueño: el usuario dueño de la instalación de la campaña. Permisos: 750 la
#   carpeta, 640 los archivos.
#
# QUÉ NO HACE NUNCA
#   · Si la carpeta central no existe o no tiene ni un PDF, TERMINA sin tocar
#     nada. Con --delete, un origen vacío por error (un disco sin montar, una
#     carpeta renombrada) dejaría TODAS las campañas sin su legislación. Para
#     vaciarlas a propósito hay que hacerlo a mano.
#   · No copia a la propia instalación central ni a lo que no sea una campaña
#     (package.json con "name": "campana-electoral-app").
#   · No sigue enlaces: si el `legislacion` de una campaña es un enlace
#     simbólico, esa campaña se OMITE. Este guion corre como root dentro de
#     carpetas que escribe otro usuario; seguir un enlace permitiría que ese
#     usuario hiciera a root escribir o borrar donde no debe. (Queda una
#     ventana mínima entre la comprobación y la copia; el único que podría
#     aprovecharla es el propio proceso de la campaña, que no crea enlaces.)
#   · No toca ninguna base de datos ni reinicia nada.
#
# EXCLUIR UNA CAMPAÑA: escribir su ruta (una por línea; # comenta) en
#   scripts/legislacion-excluir.txt   (junto a este guion; no existe por omisión)
# `--una` ignora esa lista: nombrar una campaña a mano es pedirla expresamente.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# CONFIGURACIÓN
# ---------------------------------------------------------------------------
ORIGEN="/home/appestrategia-electoral/htdocs/electoral.appestrategia.net/legislacion"
LOG="/var/log/sincronizar-legislacion.log"
BLOQUEO="/run/lock/sincronizar-legislacion.lock"
CARPETA_HOMES="/home"
NOMBRE_PAQUETE="campana-electoral-app"
LISTA_EXCLUIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/legislacion-excluir.txt"

# SOLO PARA PRUEBAS: con LEG_MODO_PRUEBA=1 se pueden sustituir las rutas de
# arriba y no se exige ser root. Sin esa variable no se lee ninguna otra.
MODO_PRUEBA="${LEG_MODO_PRUEBA:-0}"
if [[ "$MODO_PRUEBA" == "1" ]]; then
  ORIGEN="${LEG_ORIGEN:-$ORIGEN}"
  LOG="${LEG_LOG:-$LOG}"
  BLOQUEO="${LEG_BLOQUEO:-$BLOQUEO}"
  CARPETA_HOMES="${LEG_HOMES:-$CARPETA_HOMES}"
  LISTA_EXCLUIR="${LEG_EXCLUIR:-$LISTA_EXCLUIR}"
else
  # El cron trae un PATH mínimo; se fija uno completo.
  export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
fi
export LC_ALL=C   # la salida de rsync no cambia según el idioma del sistema

# ---------------------------------------------------------------------------
# ARGUMENTOS
# ---------------------------------------------------------------------------
SIMULAR=0
UNA=""

uso() {
  cat <<'FIN'
Uso: sincronizar-legislacion.sh [--simular] [--una RUTA]
  --simular    muestra qué se copiaría y borraría; no cambia nada
  --una RUTA   solo la campaña instalada en RUTA (la que tiene package.json)
FIN
}

while (( $# > 0 )); do
  case "$1" in
    --simular) SIMULAR=1 ;;
    --una)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--una necesita la ruta de la campaña." >&2; uso >&2; exit 2; }
      UNA="$2"; shift ;;
    -h|--help) uso; exit 0 ;;
    *) echo "Argumento desconocido: $1" >&2; uso >&2; exit 2 ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# REGISTRO
# ---------------------------------------------------------------------------
PREFIJO=""
(( SIMULAR == 1 )) && PREFIJO="[SIMULACIÓN] "

# Si no se puede escribir el archivo (por ejemplo una simulación sin ser root),
# el registro sale solo por pantalla.
REGISTRO_ESCRIBIBLE=1
if ! { touch "$LOG" 2>/dev/null && [[ -w "$LOG" ]]; }; then
  REGISTRO_ESCRIBIBLE=0
fi
(( REGISTRO_ESCRIBIBLE == 1 && SIMULAR == 0 )) && chmod 640 "$LOG" 2>/dev/null || true

# Una línea por mensaje, con fecha en UTC. En pantalla solo si hay terminal.
log() {
  local linea
  linea="$(date -u +%Y-%m-%dT%H:%M:%SZ) ${PREFIJO}$*"
  if (( REGISTRO_ESCRIBIBLE == 1 )); then printf '%s\n' "$linea" >> "$LOG"; fi
  if [[ -t 1 ]] || (( REGISTRO_ESCRIBIBLE == 0 )); then printf '%s\n' "$linea"; fi
  return 0
}

# ---------------------------------------------------------------------------
# COMPROBACIONES PREVIAS
# ---------------------------------------------------------------------------
if (( EUID != 0 )) && [[ "$MODO_PRUEBA" != "1" ]] && (( SIMULAR == 0 )); then
  echo "Este guion se corre como root (cambia dueños y escribe en las carpetas de las campañas)." >&2
  echo "Para solo ver qué haría:  $0 --simular" >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  log "ABORTO: rsync no está instalado. Instálalo (apt install rsync) y vuelve a correr."
  echo "Falta rsync: apt install rsync" >&2
  exit 1
fi
if ! rsync --help 2>&1 | grep -q -- '--chown'; then
  log "ABORTO: este rsync es demasiado viejo (no tiene --chown; hace falta 3.1 o más)."
  exit 1
fi
if ! command -v flock >/dev/null 2>&1; then
  log "ABORTO: falta flock (paquete util-linux)."
  exit 1
fi

# Dos corridas a la vez no se pisan: la segunda sale sin hacer nada.
# Una simulación no modifica nada y no necesita el candado.
if (( SIMULAR == 0 )); then
  exec 9>"$BLOQUEO"
  if ! flock -n 9; then
    log "Otra corrida sigue en curso; esta sale sin hacer nada."
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# EL ORIGEN: SI ALGO ESTÁ MAL, NO SE TOCA NINGUNA CAMPAÑA
# ---------------------------------------------------------------------------
if [[ ! -d "$ORIGEN" || -L "$ORIGEN" ]]; then
  log "ABORTO: la carpeta central no existe (o es un enlace): $ORIGEN. No se tocó ninguna campaña."
  exit 1
fi
N_PDF="$(find "$ORIGEN" -maxdepth 1 -type f \( -name '*.pdf' -o -name '*.PDF' \) | wc -l)"
if (( N_PDF == 0 )); then
  log "ABORTO: la carpeta central no tiene ningún PDF: $ORIGEN. No se tocó ninguna campaña (con --delete las habría vaciado)."
  exit 1
fi

# ---------------------------------------------------------------------------
# DESTINOS
# ---------------------------------------------------------------------------
RAIZ_CENTRAL="$(readlink -f "$(dirname "$ORIGEN")")"

# Rutas excluidas, ya resueltas, para comparar sin importar enlaces ni barras.
declare -A EXCLUIDAS=()
if [[ -f "$LISTA_EXCLUIR" ]]; then
  while IFS= read -r linea || [[ -n "$linea" ]]; do
    linea="${linea%%#*}"
    linea="$(printf '%s' "$linea" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [[ -n "$linea" ]] || continue
    EXCLUIDAS["$(readlink -f "$linea" 2>/dev/null || printf '%s' "$linea")"]=1
  done < "$LISTA_EXCLUIR"
fi

# ¿Es una instalación de campaña? package.json con el nombre de este producto.
es_campana() {
  local raiz="$1"
  [[ -f "$raiz/package.json" ]] || return 1
  grep -Eq '"name"[[:space:]]*:[[:space:]]*"'"$NOMBRE_PAQUETE"'"' "$raiz/package.json"
}

# Las instalaciones de campaña, una ruta REAL por línea y sin repetir.
# Hay que resolver enlaces: el ~/htdocs de las cuentas SSH es un enlace al de la
# cuenta del sitio, y sin esto la misma campaña saldría dos o tres veces (y la
# propia electoral también).
descubrir_campanas() {
  local pj raiz real
  declare -A vistas=()
  for pj in "$CARPETA_HOMES"/*/htdocs/*/package.json; do
    [[ -f "$pj" ]] || continue
    raiz="$(dirname "$pj")"
    real="$(readlink -f "$raiz")"
    [[ -n "${vistas[$real]:-}" ]] && continue
    vistas["$real"]=1
    [[ "$real" == "$RAIZ_CENTRAL" ]] && continue
    es_campana "$real" || continue
    printf '%s\n' "$real"
  done
  return 0
}

# ---------------------------------------------------------------------------
# LA COPIA DE UNA CAMPAÑA
# ---------------------------------------------------------------------------
TOTAL_CAMPANAS=0
TOTAL_COPIADOS=0
TOTAL_BORRADOS=0
TOTAL_ERRORES=0
TOTAL_OMITIDAS=0
# Las líneas de cada campaña se escriben siempre en pantalla/simulación/--una;
# en el cron solo cuando hubo cambios o fallos, para que el registro no crezca
# con 96 líneas inútiles por campaña al día.
DETALLADO=0
if [[ -t 1 ]] || (( SIMULAR == 1 )) || [[ -n "$UNA" ]]; then DETALLADO=1; fi

sincronizar_una() {
  local raiz="$1" dest="$1/legislacion" dueno grupo salida rc copiados borrados
  local -a opciones

  dueno="$(stat -c '%U' "$raiz")"
  grupo="$(stat -c '%G' "$raiz")"
  if [[ -z "$dueno" || "$dueno" == "UNKNOWN" || "$dueno" == "root" ]]; then
    log "OMITIDA $raiz: su dueño es «$dueno»; no se copia a una carpeta de root ni sin dueño."
    TOTAL_ERRORES=$((TOTAL_ERRORES + 1))
    return 0
  fi

  # Nunca escribir a través de un enlace (ver la nota de arriba).
  if [[ -L "$dest" ]]; then
    log "OMITIDA $raiz: legislacion/ es un enlace simbólico; no se sigue."
    TOTAL_ERRORES=$((TOTAL_ERRORES + 1))
    return 0
  fi
  if [[ -e "$dest" && ! -d "$dest" ]]; then
    log "OMITIDA $raiz: legislacion existe y no es una carpeta."
    TOTAL_ERRORES=$((TOTAL_ERRORES + 1))
    return 0
  fi

  opciones=(
    -r -t -p                   # recursivo (para que actúen los filtros), fecha y permisos (sin -p, --chmod
                               # solo vale para archivos nuevos y uno ya existente conservaría su modo)
    --no-links                 # los enlaces simbólicos ni se copian ni se siguen
    --delete                   # lo borrado en la central desaparece aquí
    --delay-updates            # nadie lee un PDF a medias
    --chmod=D750,F640
    "--chown=$dueno:$grupo"
    -i                         # una línea por cambio, para contar
    --exclude='*/'             # ninguna subcarpeta, ni una llamada «algo.pdf»
    --include='/*.pdf' --include='/*.PDF' --include='/indice.json'
    --exclude='*'              # y nada más (lo ajeno en el destino queda intacto)
  )
  (( SIMULAR == 1 )) && opciones+=(-n)

  if (( SIMULAR == 0 )); then
    # Crea la carpeta si falta y deja dueño y permisos al día, también si existía.
    install -d -m 750 -o "$dueno" -g "$grupo" "$dest"
  fi

  rc=0
  salida="$(rsync "${opciones[@]}" "$ORIGEN/" "$dest/" 2>&1)" || rc=$?

  # 24 = «un archivo de origen desapareció durante la copia»: se editó la
  # central a mitad de corrida; la siguiente corrida lo deja al día.
  if (( rc != 0 && rc != 24 )); then
    log "ERROR en $raiz (rsync código $rc):"
    printf '%s\n' "$salida" | head -n 8 | while IFS= read -r l; do log "    $l"; done || true
    TOTAL_ERRORES=$((TOTAL_ERRORES + 1))
    return 0
  fi

  copiados="$(printf '%s\n' "$salida" | grep -c '^>f' || true)"
  borrados="$(printf '%s\n' "$salida" | grep -c '^\*deleting' || true)"
  TOTAL_CAMPANAS=$((TOTAL_CAMPANAS + 1))
  TOTAL_COPIADOS=$((TOTAL_COPIADOS + copiados))
  TOTAL_BORRADOS=$((TOTAL_BORRADOS + borrados))

  if (( DETALLADO == 1 || copiados > 0 || borrados > 0 || rc == 24 )); then
    log "$raiz (dueño $dueno:$grupo): copiados=$copiados borrados=$borrados$( (( rc == 24 )) && printf ' (aviso: un archivo cambió durante la copia)' || true )"
    if (( SIMULAR == 1 )); then
      printf '%s\n' "$salida" | grep -E '^(>f|\*deleting)' | while IFS= read -r l; do log "    $l"; done || true
    fi
  fi
  return 0
}

# ---------------------------------------------------------------------------
# RECORRIDO
# ---------------------------------------------------------------------------
if [[ -n "$UNA" ]]; then
  real="$(readlink -f "$UNA" 2>/dev/null || true)"
  if [[ -z "$real" || ! -d "$real" ]]; then
    log "ABORTO: --una: no existe la carpeta $UNA"; exit 1
  fi
  if [[ "$real" == "$RAIZ_CENTRAL" ]]; then
    log "ABORTO: --una: esa es la instalación central, no una campaña."; exit 1
  fi
  if ! es_campana "$real"; then
    log "ABORTO: --una: $real no tiene un package.json de «$NOMBRE_PAQUETE»."; exit 1
  fi
  if [[ -n "${EXCLUIDAS[$real]:-}" ]]; then
    log "Aviso: $real está en $LISTA_EXCLUIR; se copia igual porque se pidió con --una."
  fi
  log "Inicio (--una $real): origen $ORIGEN, $N_PDF PDF."
  sincronizar_una "$real"
else
  log "Inicio: origen $ORIGEN, $N_PDF PDF."
  while IFS= read -r campana; do
    [[ -n "$campana" ]] || continue
    if [[ -n "${EXCLUIDAS[$campana]:-}" ]]; then
      TOTAL_OMITIDAS=$((TOTAL_OMITIDAS + 1))
      if (( DETALLADO == 1 )); then log "$campana: omitida (está en la lista de exclusión)."; fi
      continue
    fi
    sincronizar_una "$campana"
  done < <(descubrir_campanas)
fi

log "Fin: campañas=$TOTAL_CAMPANAS copiados=$TOTAL_COPIADOS borrados=$TOTAL_BORRADOS omitidas=$TOTAL_OMITIDAS errores=$TOTAL_ERRORES"
(( TOTAL_ERRORES == 0 )) || exit 1
exit 0
