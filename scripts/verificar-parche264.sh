#!/usr/bin/env bash
# scripts/verificar-parche264.sh — comprueba, SOLO LEYENDO, si el parche 264 (varios
# territorios por persona) quedó bien puesto en UNA instalación.
#
# SE CORRE COMO ROOT, EN EL SERVIDOR, una vez por instalación.
#
# Uso:
#   bash scripts/verificar-parche264.sh /home/USUARIO/htdocs/DOMINIO
#
# QUÉ MUESTRA
#   1. .version-parche y .version-base de esa carpeta; si lib/territoriosPersona.js está;
#      el PID y la hora de arranque del proceso de esa instalación (ps), y si arrancó
#      DESPUÉS del archivo de código más nuevo. «Responde» no es «reinició»: lo que
#      prueba que corre código nuevo es que el proceso sea más joven que el código.
#   2. Si existe la tabla estructura_territorios y sus llaves e índices.
#   3. Las tres consultas de control (CONSULTA_CONTROL de lib/territoriosPersona.js);
#      cada una debe dar 0.
#   4. Filas de estructura con territorio_id (todas y solo activas) frente a las de
#      estructura_territorios (principales y extras). Principales = «todas».
#   5. Las últimas 30 líneas de logs/actualizaciones.log, sin lo que parezca credencial.
#   6. Un resumen de una línea por comprobación.
#
# QUÉ NO HACE: no escribe en ninguna base (la sesión se abre READ ONLY y todo son
# SELECT/SHOW), no reinicia nada, no aplica nada, no toca archivos. Del .env lee SOLO
# DB_NAME, DB_HOST, DB_PORT y DB_USER; la clave se pide con read -rs (no se ve, no va en
# la línea de comandos, no se imprime y no se guarda en disco: viaja solo en MYSQL_PWD
# del proceso mysql de cada consulta).
#
# La conexión es siempre por TCP a 127.0.0.1 (--get-server-public-key hace falta para
# que caching_sha2_password funcione sin TLS). Por socket, root entra como OTRA cuenta
# y vería otra cosa o nada.
#
set -u

INST="${1:-}"
if [ -z "$INST" ]; then
  echo "Falta la ruta de la instalación."
  echo "Uso: bash scripts/verificar-parche264.sh /home/USUARIO/htdocs/DOMINIO"
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "Esto se corre como root: el .env y el proceso de otra instalación no son legibles para otras cuentas."
  exit 1
fi
INST="${INST%/}"
[ -d "$INST" ] || { echo "No existe la carpeta: $INST"; exit 1; }
[ -f "$INST/.env" ] || { echo "No hay .env en $INST (¿es la carpeta de la instalación?)"; exit 1; }
INST="$(readlink -f "$INST")"

valor() {   # una variable del .env, sin comillas; NUNCA se usa con DB_PASSWORD
  grep -E "^$1=" "$INST/.env" | head -1 | cut -d= -f2- | sed -E "s/^[\"']//; s/[\"']\$//"
}
BD="$(valor DB_NAME)"; HOST_ENV="$(valor DB_HOST)"; PUERTO="$(valor DB_PORT)"; USUARIO="$(valor DB_USER)"
PUERTO="${PUERTO:-3306}"
[ -n "$BD" ] && [ -n "$USUARIO" ] || { echo "El .env de $INST no trae DB_NAME o DB_USER."; exit 1; }

RESUMEN=()
nota() { RESUMEN+=("$1"); }
titulo() { echo; echo "================ $1 ================"; }

echo "Instalación : $INST"
echo "Base        : $BD   (el .env dice host '${HOST_ENV:-127.0.0.1}'; se conecta por TCP a 127.0.0.1:$PUERTO)"
case "${HOST_ENV:-127.0.0.1}" in
  127.0.0.1|localhost) ;;
  *) echo "AVISO: el .env apunta a otro servidor MySQL; este script igual consulta 127.0.0.1." ;;
esac
read -rsp "Clave de MySQL de la base $BD (no se ve al escribir): " CLAVE; echo

sql() {   # una sentencia; sin encabezados; sesión READ ONLY
  MYSQL_PWD="$CLAVE" mysql -h 127.0.0.1 -P "$PUERTO" -u "$USUARIO" --get-server-public-key \
    --init-command="SET SESSION TRANSACTION READ ONLY" -N -B --raw "$BD" -e "$1" 2>/dev/null
}
num() {   # una cifra, o ? si la consulta falló
  local v; v="$(sql "$1")" || v=""
  if [[ "$v" =~ ^[0-9]+$ ]]; then echo "$v"; else echo "?"; fi
}

if [ "$(sql 'SELECT 1')" != "1" ]; then
  unset CLAVE
  echo
  echo "No se pudo conectar a $BD como el usuario del .env (¿clave? ¿MySQL caído?). No se comprobó nada de la base."
  echo "Las secciones 1 y 5 no necesitan la base; vuelva a correr el script con la clave correcta."
  exit 1
fi

# ---------------------------------------------------------------- 1. versión y proceso
titulo "1. VERSIÓN DEL CÓDIGO Y PROCESO"
VP="$(cat "$INST/.version-parche" 2>/dev/null | tr -d '[:space:]')"; VB="$(cat "$INST/.version-base" 2>/dev/null | tr -d '[:space:]')"
echo ".version-parche : ${VP:-(no existe)}"
echo ".version-base   : ${VB:-(no existe)}"
if [ -f "$INST/lib/territoriosPersona.js" ]; then
  echo "lib/territoriosPersona.js : presente"; nota "OK    código del 264 en disco (lib/territoriosPersona.js)"
else
  echo "lib/territoriosPersona.js : AUSENTE (el parche 264 no está aplicado en esta carpeta)"; nota "FALTA código del 264 en disco"
fi
if [ "${VP:-0}" -ge 264 ] 2>/dev/null; then nota "OK    .version-parche = $VP"; else nota "FALTA .version-parche = ${VP:-?} (debería ser 264 o más)"; fi

ARRANQUE=app.js; [ -f "$INST/app.js" ] || ARRANQUE=server.js
PID="$(pgrep -f "$INST/$ARRANQUE" | head -1)"
if [ -z "$PID" ]; then   # por si arrancó con otra ruta (un enlace): el proceso de node con esta carpeta como cwd
  for d in /proc/[0-9]*; do
    if [ "$(readlink "$d/cwd" 2>/dev/null)" = "$INST" ] && tr '\0' ' ' < "$d/cmdline" 2>/dev/null | grep -qa 'node'; then
      PID="${d#/proc/}"; break
    fi
  done
fi
if [ -n "$PID" ]; then
  echo
  echo "Proceso ($INST/$ARRANQUE):"
  ps -o pid=,user=,lstart=,etime=,args= -p "$PID" | sed 's/^/   PID, usuario, arranque, tiempo vivo, comando:  /'
  ARRANQUE_EPOCH="$(date -d "$(ps -o lstart= -p "$PID")" +%s 2>/dev/null)"
  # Solo lo que el proceso CARGA al arrancar: app.js y lib/, routes/, config/, middleware/.
  # public/ se sirve desde el disco en cada petición y db/ y scripts/ no los carga la aplicación:
  # un cambio ahí no exige reiniciar y daría una falsa alarma.
  MAS_NUEVO="$(find "$INST/$ARRANQUE" "$INST"/lib "$INST"/routes "$INST"/config "$INST"/middleware \
                 -type f -printf '%T@ %Tc %p\n' 2>/dev/null | sort -n | tail -1)"
  if [ -n "$MAS_NUEVO" ]; then
    NUEVO_EPOCH="${MAS_NUEVO%%.*}"
    echo "   archivo de código más nuevo: ${MAS_NUEVO#* }"
    if [ -n "$ARRANQUE_EPOCH" ] && [ "$ARRANQUE_EPOCH" -ge "$NUEVO_EPOCH" ]; then
      echo "   → el proceso es MÁS JOVEN que el código: carga lo que hay en disco."
      nota "OK    el proceso arrancó después del código más nuevo (PID $PID)"
    else
      echo "   → el proceso arrancó ANTES que ese archivo: CORRE CÓDIGO VIEJO. Reinicie con scripts/reiniciar-instancia.sh (la prueba es que el PID cambie)."
      nota "ALTO  el proceso (PID $PID) es más viejo que el código en disco: falta reiniciar"
    fi
  fi
else
  echo
  echo "No hay ningún proceso con '$INST/$ARRANQUE' en su línea de comandos (¿instancia caída?)."
  nota "ALTO  no se encontró el proceso de la instalación"
fi

# ---------------------------------------------------------------- 2. la tabla
titulo "2. TABLA estructura_territorios"
HAY="$(num "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estructura_territorios'")"
if [ "$HAY" = "1" ]; then
  echo "La tabla EXISTE."
  CREA="$(sql "SHOW CREATE TABLE estructura_territorios")"
  RESUMIDO="$(printf '%s\n' "$CREA" | grep -aE 'KEY|CONSTRAINT|ENGINE' | sed -E 's/^[[:space:]]+//')"
  if [ -n "$RESUMIDO" ]; then printf '%s\n' "$RESUMIDO" | sed 's/^/   /'; else printf '%s\n' "$CREA" | sed 's/^/   /'; fi
  nota "OK    la tabla estructura_territorios existe"
else
  echo "La tabla NO existe (init-db no corrió, o el parche no está aplicado)."
  nota "FALTA la tabla estructura_territorios"
fi

# ---------------------------------------------------------------- 3. consultas de control
titulo "3. CONSULTAS DE CONTROL (cada una debe dar 0)"
echo "(copia de CONSULTA_CONTROL de lib/territoriosPersona.js)"
if [ "$HAY" = "1" ]; then
  Q1="SELECT COUNT(*) FROM estructura e WHERE e.territorio_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM estructura_territorios x WHERE x.estructura_id = e.id AND x.es_principal = 1 AND x.territorio_id = e.territorio_id)"
  Q2="SELECT COUNT(*) FROM (SELECT estructura_id FROM estructura_territorios WHERE es_principal = 1 GROUP BY estructura_id HAVING COUNT(*) > 1) x"
  Q3="SELECT COUNT(*) FROM estructura_territorios x JOIN estructura e ON e.id = x.estructura_id WHERE x.es_principal = 1 AND NOT (e.territorio_id <=> x.territorio_id)"
  TODO_CERO=1
  for par in "estructuras_sin_fila_principal_igual|$Q1" "personas_con_mas_de_una_principal|$Q2" "filas_principales_que_no_coinciden_con_la_columna|$Q3"; do
    NOMBRE="${par%%|*}"; CONSULTA="${par#*|}"
    R="$(num "$CONSULTA")"
    if [ "$R" = "0" ]; then echo "  $NOMBRE = 0   OK"; else echo "  $NOMBRE = $R   <-- DEBE SER 0"; TODO_CERO=0; fi
    if [ -f "$INST/lib/territoriosPersona.js" ] && ! grep -q "$NOMBRE" "$INST/lib/territoriosPersona.js"; then
      echo "    AVISO: la consulta '$NOMBRE' ya no figura en lib/territoriosPersona.js de esa instalación; este script quedó desactualizado."
    fi
  done
  if [ "$TODO_CERO" = "1" ]; then nota "OK    las 3 consultas de control dan 0"; else nota "ALTO  alguna consulta de control no da 0"; fi
else
  echo "No se corren: la tabla no existe."
  nota "FALTA consultas de control (no hay tabla)"
fi

# ---------------------------------------------------------------- 4. conteos
titulo "4. estructura FRENTE A estructura_territorios"
TODAS="$(num "SELECT COUNT(*) FROM estructura WHERE territorio_id IS NOT NULL")"
ACTIVAS="$(num "SELECT COUNT(*) FROM estructura WHERE territorio_id IS NOT NULL AND activo = 1")"
printf '  estructura con territorio_id NOT NULL — todas   : %s\n' "$TODAS"
printf '  estructura con territorio_id NOT NULL — activas : %s\n' "$ACTIVAS"
if [ "$HAY" = "1" ]; then
  PRINC="$(num "SELECT COUNT(*) FROM estructura_territorios WHERE es_principal = 1")"
  EXTRAS="$(num "SELECT COUNT(*) FROM estructura_territorios WHERE es_principal = 0")"
  PERSONAS_EXTRA="$(num "SELECT COUNT(DISTINCT estructura_id) FROM estructura_territorios WHERE es_principal = 0")"
  printf '  estructura_territorios — principales             : %s\n' "$PRINC"
  printf '  estructura_territorios — extras                  : %s   (de %s persona(s))\n' "$EXTRAS" "$PERSONAS_EXTRA"
  if [ "$PRINC" = "$TODAS" ] && [ "$PRINC" != "?" ]; then
    echo "  → COINCIDEN: principales ($PRINC) = todas ($TODAS)."
    nota "OK    principales = todas ($PRINC)"
  else
    echo "  → NO COINCIDEN: principales ($PRINC) frente a todas ($TODAS). Corra init-db (rellena a quien no tiene lista) o revise la sección 3."
    nota "ALTO  principales ($PRINC) distinto de todas ($TODAS)"
  fi
else
  echo "  (sin tabla no hay con qué comparar)"
  nota "FALTA conteo contra estructura_territorios (no hay tabla)"
fi
unset CLAVE

# ---------------------------------------------------------------- 5. registro del actualizador
titulo "5. ÚLTIMAS 30 LÍNEAS DE logs/actualizaciones.log"
LOG="$INST/logs/actualizaciones.log"
if [ -f "$LOG" ]; then
  ls -l --time-style=long-iso "$LOG" | awk '{print "   " $5 " bytes, última escritura " $6 " " $7}'
  ULT="$(tail -n 30 "$LOG")"
  # Se OCULTAN las líneas que parecen llevar una credencial y se acortan las cadenas largas
  # (un sha256 se deja en sus 16 primeros caracteres; cualquier otra cosa larga, fuera).
  PARECE='pass(word)?|contrase|clave|secret|token|api[_-]?key|authorization|bearer|credencial|mysql_pwd|db_(user|pass)|private key|-----BEGIN|x-[a-z-]*secret'
  OCULTAS="$(printf '%s\n' "$ULT" | grep -ciE "$PARECE")"
  printf '%s\n' "$ULT" | grep -viE "$PARECE" \
    | sed -E 's/\b([0-9a-fA-F]{16})[0-9a-fA-F]{48}\b/\1…(sha256)/g; s/[A-Za-z0-9+_=-]{40,}/<oculto>/g' \
    | sed 's/^/   | /'
  [ "$OCULTAS" -gt 0 ] && echo "   (se ocultaron $OCULTAS línea(s) por parecer credenciales)"
  ULTIMA_PARCHE="$(printf '%s\n' "$ULT" | grep -aiE 'Parche #?[0-9]+ aplicado|Error aplicando' | tail -1)"
  [ -n "$ULTIMA_PARCHE" ] && nota "INFO  última línea de parche en el registro: $(printf '%s' "$ULTIMA_PARCHE" | sed -E 's/[A-Za-z0-9+_=-]{40,}/<oculto>/g' | cut -c1-110)"
else
  echo "No existe $LOG (esa instalación nunca ha corrido el actualizador, o el cron escribe en otro sitio)."
  nota "INFO  no hay logs/actualizaciones.log"
fi

# ---------------------------------------------------------------- resumen
titulo "RESUMEN — $BD"
for linea in "${RESUMEN[@]}"; do echo "  $linea"; done
echo
echo "(Solo lectura: no se escribió ni se aplicó nada.)"
