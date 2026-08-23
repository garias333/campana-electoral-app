#!/usr/bin/env bash
#
# ¿QUÉ LLAVE LE FUNCIONA A QUIÉN? — DIAGNÓSTICO, NO CAMBIA NADA.
#
# PARA QUÉ. Antes de cerrar el SSH a las contraseñas hay que saber si las
# cuentas que hoy entran con contraseña tienen instalada una llave que de
# verdad funcione. Tener una llave puesta en `authorized_keys` NO significa
# que su dueño la tenga: puede ser de otra máquina, o de otra persona.
#
# LA ÚNICA PRUEBA QUE VALE ES EL REGISTRO. Una llave sirve si ya entró con
# ella. Este guion cruza dos cosas:
#
#   1. las huellas que sshd aceptó de verdad, sacadas de /var/log/auth.log
#   2. las huellas instaladas en cada `authorized_keys`
#
# y dice, cuenta por cuenta, si la llave puesta es una que ya se usó y desde
# qué dirección. Lo que no aparece en el registro se marca como no probado,
# que no es lo mismo que roto pero tampoco es una garantía.
#
# NO IMPRIME NINGUNA LLAVE. Solo huellas y comentarios, que es información
# pública por diseño.
#
# HACE FALTA ROOT: /var/log/auth.log y los .ssh ajenos no se leen de otro modo.
#
#   sudo bash scripts/revisar-llaves-ssh.sh
#
# Las tres variables de abajo existen para poder probar el guion contra
# archivos de mentira, sin root y sin tocar el servidor.
#
set -uo pipefail   # sin -e a propósito: acá un grep que no encuentra nada es
                   # un resultado normal, no un error que deba abortar.

DIR_LOGS="${DIR_LOGS:-/var/log}"
DIR_CASAS="${DIR_CASAS:-/home}"
CASA_ROOT="${CASA_ROOT:-/root}"

TMP=$(mktemp); trap 'rm -f "$TMP" "$TMP".*' EXIT

# Se juntan los registros rotados: si solo se mira auth.log, un ingreso de hace
# una semana no existe, y "nunca entró con llave" seria una conclusion falsa
# sacada de una ventana demasiado corta.
LEIDOS=0
for F in "$DIR_LOGS"/auth.log "$DIR_LOGS"/auth.log.*; do
  [[ -e "$F" ]] || continue
  case "$F" in
    *.gz) zcat  "$F" 2>/dev/null ;;
    *)    cat   "$F" 2>/dev/null ;;
  esac
  LEIDOS=$((LEIDOS + 1))
done >> "$TMP"

if [[ $LEIDOS -eq 0 || ! -s "$TMP" ]]; then
  echo "No se pudo leer ningún registro en $DIR_LOGS. ¿Se está corriendo como root?" >&2
  exit 1
fi
echo "Registros leídos: $LEIDOS archivo(s), $(wc -l < "$TMP") líneas."

# ---------------------------------------------------------------------------
echo
echo "== 1. Llaves que SÍ han funcionado (según el registro)"

# Campo 11 es la huella: sshd escribe «ssh2: <TIPO> SHA256:<huella>», y el tipo
# cambia (RSA, ED25519, RSA-CERT), pero la huella siempre va detrás.
grep -hoE 'Accepted publickey for [A-Za-z0-9._-]+ from [0-9a-fA-F.:]+ port [0-9]+ ssh2: [A-Za-z0-9-]+ SHA256:[A-Za-z0-9+/=]+' "$TMP" \
  | awk '{print $11"\t"$4"\t"$6}' | sort | uniq -c | sort -rn > "$TMP".llaves

if [[ ! -s "$TMP".llaves ]]; then
  echo "   (ninguna: en este registro nadie ha entrado con llave)"
else
  while read -r LINEA; do
    VECES=$(echo "$LINEA" | awk '{print $1}')
    RESTO=$(echo "$LINEA" | sed 's/^ *[0-9]* //')
    HUELLA=$(echo "$RESTO" | cut -f1)
    USUARIO=$(echo "$RESTO" | cut -f2)
    ORIGEN=$(echo "$RESTO" | cut -f3)
    printf "   %-50s %-24s desde %-16s %sx\n" "$HUELLA" "$USUARIO" "$ORIGEN" "$VECES"
  done < "$TMP".llaves
fi

# Índice plano huella -> "usuario desde ip". Se usa más abajo para decir, de
# cada llave instalada, si alguna vez sirvió.
cut -f1 "$TMP".llaves 2>/dev/null | sed 's/^ *[0-9]* //' | sort -u > "$TMP".huellas_ok

# ---------------------------------------------------------------------------
echo
echo "== 2. Quién entró con CONTRASEÑA (son los que perderían el acceso)"
grep -hoE 'Accepted password for [A-Za-z0-9._-]+ from [0-9a-fA-F.:]+' "$TMP" \
  | awk '{print $4"\t"$6}' | sort | uniq -c | sort -rn > "$TMP".pass
if [[ ! -s "$TMP".pass ]]; then
  echo "   (ninguno)"
else
  while read -r LINEA; do
    VECES=$(echo "$LINEA" | awk '{print $1}')
    RESTO=$(echo "$LINEA" | sed 's/^ *[0-9]* //')
    printf "   %-26s desde %-16s %sx\n" "$(echo "$RESTO" | cut -f1)" "$(echo "$RESTO" | cut -f2)" "$VECES"
  done < "$TMP".pass
fi
cut -f1 "$TMP".pass 2>/dev/null | sed 's/^ *[0-9]* //' | sort -u > "$TMP".usuarios_pass

# ---------------------------------------------------------------------------
echo
echo "== 3. Cuenta por cuenta: qué llave tiene puesta y si está probada"

veredicto_cuenta() {
  local USUARIO="$1" AK="$2"
  local PROBADAS=0 TOTAL=0

  if [[ ! -f "$AK" ]]; then
    printf "   %-26s SIN NINGUNA LLAVE INSTALADA\n" "$USUARIO"
    return 2
  fi

  printf "   %s\n" "$USUARIO"
  while read -r BITS HUELLA RESTO; do
    [[ -n "${HUELLA:-}" ]] || continue
    TOTAL=$((TOTAL + 1))
    local COMENTARIO="${RESTO:-(sin comentario)}"
    if grep -qxF "$HUELLA" "$TMP".huellas_ok; then
      # Se dice CON QUÉ CUENTA funcionó: la misma llave suele estar puesta en
      # varias, y saber que sirvió en otra es justo lo que decide si esta
      # cuenta puede prescindir de la contraseña.
      local DONDE
      DONDE=$(grep -F "$HUELLA" "$TMP".llaves | sed 's/^ *[0-9]* //' \
              | awk -F'\t' '{print $2" desde "$3}' | sort -u | paste -sd'; ' -)
      printf "      %-50s %-28s PROBADA (%s)\n" "$HUELLA" "$COMENTARIO" "$DONDE"
      PROBADAS=$((PROBADAS + 1))
    else
      printf "      %-50s %-28s sin uso registrado\n" "$HUELLA" "$COMENTARIO"
    fi
  done < <(ssh-keygen -lf "$AK" 2>/dev/null)

  [[ $TOTAL -eq 0 ]] && { printf "      (el archivo existe pero no tiene llaves válidas)\n"; return 2; }
  [[ $PROBADAS -gt 0 ]] && return 0
  return 1
}

declare -a SEGUROS=() DUDOSOS=() SIN_LLAVE=()

for USUARIO in $(cat "$TMP".usuarios_pass); do
  if [[ "$USUARIO" == "root" ]]; then AK="$CASA_ROOT/.ssh/authorized_keys"
  else AK="$DIR_CASAS/$USUARIO/.ssh/authorized_keys"; fi
  veredicto_cuenta "$USUARIO" "$AK"
  case $? in
    0) SEGUROS+=("$USUARIO") ;;
    1) DUDOSOS+=("$USUARIO") ;;
    2) SIN_LLAVE+=("$USUARIO") ;;
  esac
done
[[ -s "$TMP".usuarios_pass ]] || echo "   (nadie entró con contraseña; no hay nada que revisar)"

# ---------------------------------------------------------------------------
echo
echo "== 4. Conclusión"
printf "   Con llave ya probada, pueden prescindir de la contraseña: %s\n" \
  "${SEGUROS[*]:-ninguna}"
printf "   Tienen llave pero NUNCA la han usado (hay que comprobarla):  %s\n" \
  "${DUDOSOS[*]:-ninguna}"
printf "   Sin ninguna llave, perderían el acceso:                      %s\n" \
  "${SIN_LLAVE[*]:-ninguna}"
echo
if [[ ${#DUDOSOS[@]} -eq 0 && ${#SIN_LLAVE[@]} -eq 0 ]]; then
  echo "   Se puede cerrar el SSH a las contraseñas sin dejar a nadie por fuera."
else
  echo "   NO cierre todavía. Para cada cuenta de las dos últimas líneas, instale"
  echo "   su llave pública y compruébela ANTES:"
  echo "      ssh-copy-id  usuario@srv1807015          # desde su computador"
  echo "      ssh -o PasswordAuthentication=no usuario@srv1807015"
fi
