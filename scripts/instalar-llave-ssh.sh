#!/usr/bin/env bash
#
# INSTALA UNA LLAVE PÚBLICA EN VARIAS CUENTAS DE UNA VEZ.
#
# PARA QUÉ. Antes de cerrar el SSH a las contraseñas, las cuentas que hoy
# entran con contraseña necesitan una llave que sirva. Hacerlo a mano en nueve
# cuentas es nueve oportunidades de equivocarse en los permisos, y un permiso
# mal puesto no da error: sshd simplemente ignora la llave y pide la contraseña,
# que es exactamente el síntoma que uno estaba tratando de quitar.
#
# NUNCA PISA NADA. Se AÑADE al final de `authorized_keys`; si la llave ya está
# —se compara por huella, no por texto, porque el mismo material puede venir con
# otro comentario— no se duplica. Las llaves que ya hubiera siguen valiendo.
#
# DE DÓNDE SALE LA LLAVE (una de las tres):
#
#   --archivo <ruta.pub>    un archivo .pub
#   --llave "ssh-ed25519 AAAA... comentario"
#   --huella SHA256:xxxxx   la busca entre las que YA están instaladas en este
#                           servidor y la copia a las demás cuentas. Sirve para
#                           propagar una llave que ya se sabe que funciona, sin
#                           tener que traer el archivo desde otra máquina.
#
# LOS PERMISOS SE ARREGLAN SIEMPRE, porque son la mitad del problema:
# `~/.ssh` en 700, `authorized_keys` en 600 y ambos del dueño de la cuenta. Con
# `StrictModes` —activo por omisión— sshd descarta en silencio una llave que
# esté en un archivo demasiado abierto.
#
# HACE FALTA ROOT.
#
#   sudo bash scripts/instalar-llave-ssh.sh --huella SHA256:xxx --simular
#   sudo bash scripts/instalar-llave-ssh.sh --archivo /root/mi_llave.pub
#
set -uo pipefail

# Las nueve que el diagnóstico encontró entrando con contraseña. Se pueden
# cambiar con --cuentas "una otra".
CUENTAS=(encuestashh pretestshh gariasapppanel gariasappelectoral
         gariasappmapamanizales territoriosshh gariasappproyector
         gariasappfoda gariasappescucha)

SIMULAR=0; ARCHIVO=""; LLAVE=""; HUELLA=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --simular) SIMULAR=1; shift ;;
    --archivo) ARCHIVO="${2:-}"; shift 2 ;;
    --llave)   LLAVE="${2:-}";   shift 2 ;;
    --huella)  HUELLA="${2:-}";  shift 2 ;;
    --cuentas) read -r -a CUENTAS <<< "${2:-}"; shift 2 ;;
    *) echo "Argumento desconocido: $1" >&2; exit 1 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "Hay que correrlo como root." >&2
  exit 1
fi

huella_de() { printf '%s\n' "$1" | ssh-keygen -lf - 2>/dev/null | awk '{print $2}'; }

# --- 1. Conseguir la llave -------------------------------------------------
if [[ -n "$ARCHIVO" ]]; then
  [[ -r "$ARCHIVO" ]] || { echo "No puedo leer $ARCHIVO" >&2; exit 1; }
  LLAVE=$(head -1 "$ARCHIVO")
elif [[ -n "$HUELLA" ]]; then
  # Se recorre lo ya instalado y se busca la línea cuya huella coincida. Se
  # compara la huella y no el texto: el mismo material de llave aparece con
  # comentarios distintos en cada cuenta.
  for AK in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
    [[ -r "$AK" ]] || continue
    while IFS= read -r LINEA; do
      [[ "$LINEA" =~ ^(ssh|ecdsa|sk-) ]] || continue
      if [[ "$(huella_de "$LINEA")" == "$HUELLA" ]]; then
        LLAVE="$LINEA"
        echo "Llave encontrada en $AK"
        break 2
      fi
    done < "$AK"
  done
  [[ -n "$LLAVE" ]] || { echo "No hay ninguna llave con huella $HUELLA en este servidor." >&2; exit 1; }
fi

[[ -n "$LLAVE" ]] || { echo "Falta decir qué llave: --archivo, --llave o --huella." >&2; exit 1; }

H=$(huella_de "$LLAVE")
[[ -n "$H" ]] || { echo "Eso no es una llave pública válida." >&2; exit 1; }
COMENTARIO=$(printf '%s\n' "$LLAVE" | ssh-keygen -lf - 2>/dev/null | cut -d' ' -f3-)

echo "Llave a instalar: $H  $COMENTARIO"
echo "Cuentas: ${CUENTAS[*]}"
[[ $SIMULAR -eq 1 ]] && echo "(simulación: no se escribe nada)"
echo

# --- 2. Instalarla ---------------------------------------------------------
PUESTAS=0; YA=0; FALLOS=0
for U in "${CUENTAS[@]}"; do
  # La casa se saca de /etc/passwd y no se supone /home/$U: hay cuentas cuyo
  # directorio no se llama como ellas, y escribir en la carpeta equivocada
  # crearía un authorized_keys que sshd nunca va a leer.
  CASA=$(getent passwd "$U" | cut -d: -f6)
  if [[ -z "$CASA" ]]; then
    printf "   %-26s NO EXISTE esa cuenta\n" "$U"; FALLOS=$((FALLOS+1)); continue
  fi

  AK="$CASA/.ssh/authorized_keys"

  if [[ -f "$AK" ]] && ssh-keygen -lf "$AK" 2>/dev/null | awk '{print $2}' | grep -qxF "$H"; then
    printf "   %-26s ya la tenía\n" "$U"; YA=$((YA+1)); continue
  fi

  if [[ $SIMULAR -eq 1 ]]; then
    printf "   %-26s se le añadiría\n" "$U"; PUESTAS=$((PUESTAS+1)); continue
  fi

  mkdir -p "$CASA/.ssh" || { printf "   %-26s no pude crear .ssh\n" "$U"; FALLOS=$((FALLOS+1)); continue; }
  # Con `>>` y una línea propia: si el archivo venía sin salto final, pegar sin
  # más juntaría dos llaves en una sola línea y las dos dejarían de valer.
  printf '\n%s\n' "$LLAVE" >> "$AK"
  # Se quitan las líneas vacías que eso pueda dejar; sshd las tolera, pero un
  # archivo lleno de huecos invita a editarlo mal la próxima vez.
  sed -i '/^$/d' "$AK"

  chmod 700 "$CASA/.ssh"; chmod 600 "$AK"
  chown -R "$U": "$CASA/.ssh"

  if ssh-keygen -lf "$AK" 2>/dev/null | awk '{print $2}' | grep -qxF "$H"; then
    printf "   %-26s añadida\n" "$U"; PUESTAS=$((PUESTAS+1))
  else
    printf "   %-26s QUEDÓ MAL: el archivo no la reconoce\n" "$U"; FALLOS=$((FALLOS+1))
  fi

  # StrictModes: si la casa es escribible por el grupo o por otros, sshd
  # descarta la llave sin decir nada y vuelve a pedir contraseña. Se avisa en
  # vez de cambiarlo: los permisos de una casa los pone el panel y tocarlos
  # puede romper otra cosa.
  PERM=$(stat -c '%A' "$CASA")
  if [[ "${PERM:5:1}" == "w" || "${PERM:8:1}" == "w" ]]; then
    printf "   %-26s AVISO: %s es escribible por grupo u otros; sshd va a ignorar la llave\n" "" "$CASA"
  fi
done

echo
echo "Añadidas: $PUESTAS   Ya la tenían: $YA   Con problema: $FALLOS"
if [[ $SIMULAR -eq 0 && $PUESTAS -gt 0 ]]; then
  echo
  echo "COMPRUÉBELO DESDE SU COMPUTADOR antes de cerrar nada — que la llave esté"
  echo "puesta no prueba que usted tenga la mitad privada:"
  echo "   ssh -o PasswordAuthentication=no ${CUENTAS[0]}@srv1807015"
  echo
  echo "Y vuelva a mirar el registro después de entrar una vez con cada una:"
  echo "   bash scripts/revisar-llaves-ssh.sh"
fi
