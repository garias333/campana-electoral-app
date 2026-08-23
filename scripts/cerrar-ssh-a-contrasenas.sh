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
[[ "${1:-}" == "--simular" ]] && SIMULAR=1
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
echo "   PasswordAuthentication  yes -> no"
echo "   PermitRootLogin         yes -> prohibit-password"
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
sed -i -E \
  -e 's/^[[:space:]]*PasswordAuthentication[[:space:]]+.*/PasswordAuthentication no/' \
  -e 's/^[[:space:]]*PermitRootLogin[[:space:]]+.*/PermitRootLogin prohibit-password/' \
  "$CONF"

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

# Los archivos de /etc/ssh/sshd_config.d/ se leen DESPUÉS y pueden reponer lo
# que acabamos de quitar. Se avisa en vez de editarlos a ciegas.
if grep -rqiE '^[[:space:]]*(PasswordAuthentication|PermitRootLogin)' /etc/ssh/sshd_config.d/ 2>/dev/null; then
  echo "   AVISO: hay directivas en /etc/ssh/sshd_config.d/ que pueden mandar sobre esto:"
  grep -riE '^[[:space:]]*(PasswordAuthentication|PermitRootLogin)' /etc/ssh/sshd_config.d/ | sed 's/^/      /'
fi

if ! sshd -t 2>/tmp/sshd-t.err; then
  echo
  echo "El archivo quedó inválido. Se restaura la copia y no se aplica nada:" >&2
  sed 's/^/   /' /tmp/sshd-t.err >&2
  cp -p "$COPIA" "$CONF"
  exit 1
fi
echo "   sshd -t: el archivo es válido"

systemctl reload ssh 2>/dev/null || systemctl reload sshd
echo "   recargado (las sesiones abiertas siguen vivas)"

echo
echo "== Cómo quedó, según el propio sshd"
sshd -T | grep -iE '^(passwordauthentication|permitrootlogin|pubkeyauthentication) ' | sed 's/^/   /'

echo
echo "AHORA, SIN CERRAR ESTA TERMINAL: abra otra y compruebe que puede entrar."
echo "Si no puede, vuelva acá y ejecute:"
echo "   cp -p $COPIA $CONF && systemctl reload ssh"
