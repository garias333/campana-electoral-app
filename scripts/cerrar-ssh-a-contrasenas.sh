#!/usr/bin/env bash
#
# DEJA EL SSH SÓLO CON LLAVE, Y A ROOT SIN CONTRASEÑA.
#
# QUÉ ARREGLA. Hoy sshd tiene `PasswordAuthentication yes` y `PermitRootLogin
# yes`, con 30 cuentas de shell en la máquina. Cada una es una puerta donde
# adivinar una contraseña equivale a llevarse el código y las bases de datos.
# fail2ban frena la fuerza bruta a ciegas, pero no sirve de nada contra una
# contraseña que se filtró por otro lado. Con llaves, adivinar deja de existir
# como ataque.
#
# POR QUÉ ESTE SCRIPT Y NO EDITAR EL ARCHIVO A MANO. Porque el error clásico
# —quitarse las contraseñas sin tener la llave puesta— deja a uno fuera de su
# propio servidor. Acá eso no puede pasar sin querer:
#
#   1. Si NINGUNA cuenta tiene llave instalada, se niega y no toca nada.
#   2. Guarda una copia fechada del archivo antes de escribir.
#   3. Valida la sintaxis con `sshd -t` ANTES de aplicar; si no valida,
#      restaura la copia y sale.
#   4. Usa `reload`, no `restart`: las sesiones abiertas NO se cortan. La que
#      usted tiene ahora sigue viva y es su red de seguridad.
#
# LA TERMINAL DEL NAVEGADOR QUEDA SIEMPRE ABIERTA. Medido en este servidor: la
# consola web de Hostinger entra por SSH desde 169.254.0.1 y se autentica con
# LLAVE, distinta en cada sesión — no con contraseña. O sea que el cambio no la
# afecta. Aun así se le deja una excepción explícita, porque el día que esa
# inyección de llave falle, sin excepción no quedaría ninguna forma de entrar.
#
# La excepción no abre nada hacia afuera: 169.254.0.0/16 es direccionamiento de
# enlace local. Un paquete de internet no puede venir con esa dirección de
# origen; sólo la usa el propio anfitrión. Es una puerta que únicamente existe
# desde adentro de la máquina.
#
# DESPUÉS DE CORRERLO, SIN CERRAR ESTA TERMINAL: abra OTRA y entre. Si entra,
# está bien. Si no, vuelva a la primera —que sigue abierta— y ejecute la línea
# de reversa que el script imprime al final.
#
#   sudo bash scripts/cerrar-ssh-a-contrasenas.sh --simular
#   sudo bash scripts/cerrar-ssh-a-contrasenas.sh
#
set -euo pipefail

SIMULAR=0
SOLO_ROOT=0
for ARG in "$@"; do
  case "$ARG" in
    --simular)   SIMULAR=1 ;;
    --solo-root) SOLO_ROOT=1 ;;
  esac
done
CONF=/etc/ssh/sshd_config
COPIA="$CONF.antes-de-cerrar-$(date +%Y-%m-%d_%H%M)"

if [[ $EUID -ne 0 ]]; then
  echo "Hay que correrlo como root: sudo bash $0 ${1:-}" >&2
  exit 1
fi

echo "== Quién tiene llave instalada hoy"
CON_LLAVE=0
for AK in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  [[ -f "$AK" ]] || continue
  N=$(grep -cE '^(ssh-|ecdsa-|sk-)' "$AK" 2>/dev/null || true)
  [[ "${N:-0}" -gt 0 ]] || continue
  printf "   %-52s %s llave(s)\n" "$AK" "$N"
  CON_LLAVE=$((CON_LLAVE + 1))
done

if [[ $CON_LLAVE -eq 0 ]]; then
  echo
  echo "NINGUNA cuenta tiene llave instalada. No se toca nada." >&2
  echo "Instale primero su llave (ssh-copy-id) y vuelva a correr esto." >&2
  exit 1
fi
echo "   -> $CON_LLAVE cuenta(s) podrían seguir entrando. Se puede continuar."

echo
echo
echo "== Cómo entra usted hoy (esto decide si el cambio es seguro)"
if [[ -r /var/log/auth.log ]]; then
  grep -hoE 'Accepted (publickey|password) for [a-z0-9_-]+ from [0-9.]+' /var/log/auth.log 2>/dev/null \
    | sort | uniq -c | sort -rn | head -10 | sed 's/^/   /'
  if grep -qE 'Accepted password for' /var/log/auth.log 2>/dev/null; then
    echo "   AVISO: hay ingresos por CONTRASEÑA en el registro, listados arriba."
    echo "   Esas cuentas pierden el acceso salvo que entren por 169.254.0.0/16."
  fi
else
  echo "   (no se puede leer /var/log/auth.log)"
fi

echo
echo "== Cambios"
if [[ $SOLO_ROOT -eq 1 ]]; then
  echo "   PermitRootLogin         yes -> prohibit-password"
  echo "   PasswordAuthentication  se deja en 'yes'  (--solo-root)"
else
  echo "   PasswordAuthentication  yes -> no"
  echo "   PermitRootLogin         yes -> prohibit-password"
fi
echo "   + excepción para 169.254.0.0/16 (la consola del navegador)"

if [[ $SIMULAR -eq 1 ]]; then
  echo
  echo "Simulación: no se escribió nada."
  exit 0
fi

cp -p "$CONF" "$COPIA"
echo
echo "   copia guardada en $COPIA"

# `-i` con expresión anclada: sólo las directivas activas, no los comentarios
# de ejemplo que el archivo trae y que confundirían un reemplazo global.
#
# CON --solo-root SE TOCA UNA SOLA DIRECTIVA, y es la que tiene evidencia
# detrás. En este servidor root NUNCA ha entrado con contraseña: las 15
# sesiones del registro son con llave, todas desde la consola del navegador.
# Cerrarle la contraseña a root no le quita nada a nadie y saca de la mesa el
# blanco más valioso. Las demás cuentas —que sí entran con contraseña todos los
# días— se dejan para cuando sus llaves estén comprobadas, en vez de romperles
# el acceso hoy a cambio de nada.
sed -i -E \
  -e 's/^[[:space:]]*PermitRootLogin[[:space:]]+.*/PermitRootLogin prohibit-password/' \
  "$CONF"
if [[ $SOLO_ROOT -eq 0 ]]; then
  sed -i -E \
    -e 's/^[[:space:]]*PasswordAuthentication[[:space:]]+.*/PasswordAuthentication no/' \
    "$CONF"
fi

# LA EXCEPCIÓN VA AL FINAL, Y NO ES UN DETALLE DE ESTILO: en sshd_config todo
# lo que viene después de un `Match` pertenece a ese bloque. Puesta en medio, se
# tragaría las directivas de abajo y cambiaría la configuración global sin que
# se note. Se añade una sola vez; si ya está, no se repite.
if ! grep -q '^Match Address 169.254.0.0/16' "$CONF"; then
  cat >> "$CONF" <<'BLOQUE'

# Consola del navegador (Hostinger). Entra por SSH desde el enlace local, que
# no es alcanzable desde internet: un paquete externo no puede traer esa
# dirección de origen. Es la salida de emergencia si la llave llegara a fallar.
Match Address 169.254.0.0/16
    PasswordAuthentication yes
    PermitRootLogin yes
BLOQUE
  echo "   excepción para la consola del navegador: añadida"
else
  echo "   excepción para la consola del navegador: ya estaba"
fi

# /etc/ssh/sshd_config.d/ MANDA SOBRE ESTE ARCHIVO, Y ESO NO ES INTUITIVO.
#
# En sshd_config gana el PRIMER valor que se lee, no el último — al revés que
# en casi cualquier otro archivo de configuración. Y el `Include` de
# sshd_config.d está en las primeras líneas. Resultado: `50-cloud-init.conf`,
# que trae `PasswordAuthentication yes`, le gana a lo que escribamos aquí.
#
# La primera versión de este guion sólo AVISABA de esos archivos. El aviso
# salió, el `sshd -t` dijo que todo estaba bien, el servicio recargó sin una
# queja... y `sshd -T` seguía respondiendo `passwordauthentication yes`. Todo
# parecía haber funcionado y no había cambiado nada. Por eso ahora se corrigen,
# con su propia copia de respaldo cada uno.
declare -a COPIAS_D=()
for EXTRA in /etc/ssh/sshd_config.d/*.conf; do
  [[ -f "$EXTRA" ]] || continue
  grep -qiE '^[[:space:]]*(PasswordAuthentication|PermitRootLogin)' "$EXTRA" || continue

  COPIA_EXTRA="$EXTRA.antes-de-cerrar-$(date +%Y-%m-%d_%H%M)"
  cp -p "$EXTRA" "$COPIA_EXTRA"
  COPIAS_D+=("$COPIA_EXTRA|$EXTRA")

  sed -i -E \
    -e 's/^[[:space:]]*PermitRootLogin[[:space:]]+.*/PermitRootLogin prohibit-password/' \
    "$EXTRA"
  if [[ $SOLO_ROOT -eq 0 ]]; then
    sed -i -E \
      -e 's/^[[:space:]]*PasswordAuthentication[[:space:]]+.*/PasswordAuthentication no/' \
      "$EXTRA"
  fi
  echo "   corregido también $EXTRA (manda sobre el principal)"
done

restaurar_todo() {
  cp -p "$COPIA" "$CONF"
  for PAR in "${COPIAS_D[@]:-}"; do
    [[ -n "$PAR" ]] || continue
    cp -p "${PAR%%|*}" "${PAR##*|}"
  done
}

if ! sshd -t 2>/tmp/sshd-t.err; then
  echo
  echo "La configuración quedó inválida. Se restaura todo y no se aplica nada:" >&2
  sed 's/^/   /' /tmp/sshd-t.err >&2
  restaurar_todo
  exit 1
fi
echo "   sshd -t: la configuración es válida"

systemctl reload ssh 2>/dev/null || systemctl reload sshd
echo "   recargado (las sesiones abiertas siguen vivas)"

echo
echo "== Cómo quedó, según el propio sshd"
sshd -T | grep -iE '^(passwordauthentication|permitrootlogin|pubkeyauthentication) ' | sed 's/^/   /'

# SE COMPRUEBA CONTRA LO QUE DICE SSHD, NO CONTRA LO QUE ESCRIBIMOS. Editar el
# archivo y que el servicio recargue no prueba nada: la primera vez que corrió
# esto, las dos cosas salieron bien y la contraseña seguía habilitada porque un
# archivo de sshd_config.d mandaba. `sshd -T` es la única fuente que sabe cuál
# valor ganó de verdad.
ESPERADO_ROOT='permitrootlogin (prohibit-password|without-password)'
if ! sshd -T | grep -qiE "^$ESPERADO_ROOT$"; then
  echo
  echo "   NO QUEDÓ APLICADO: root sigue pudiendo entrar con contraseña." >&2
  echo "   Se restaura todo para no dejar la configuración a medias." >&2
  restaurar_todo; systemctl reload ssh 2>/dev/null || systemctl reload sshd
  exit 1
fi
if [[ $SOLO_ROOT -eq 0 ]] && ! sshd -T | grep -qi '^passwordauthentication no$'; then
  echo
  echo "   NO QUEDÓ APLICADO: passwordauthentication sigue en 'yes'." >&2
  echo "   Algo lo está reponiendo. Revise:  sshd -T | grep -i password" >&2
  echo "   y  grep -ri passwordauth /etc/ssh/" >&2
  echo "   No se restaura nada: el cambio de root sí entró y conviene conservarlo." >&2
  exit 1
fi
echo "   comprobado contra sshd -T: el cambio quedó aplicado de verdad"

echo
echo "AHORA, SIN CERRAR ESTA TERMINAL: abra otra y compruebe que puede entrar."
echo "Si no puede, vuelva acá y ejecute TODAS estas líneas:"
echo "   cp -p $COPIA $CONF"
for PAR in "${COPIAS_D[@]:-}"; do
  [[ -n "$PAR" ]] || continue
  echo "   cp -p ${PAR%%|*} ${PAR##*|}"
done
echo "   systemctl reload ssh"
