#!/bin/bash
# Uso (como root): bash scripts/poner-telegram-env.sh <ruta del .env>
# Pide el token del bot, el chat_id del superadmin y APP_NOMBRE sin mostrarlos.
set -euo pipefail
ENVF="${1:?falta la ruta del .env}"
[ -f "$ENVF" ] || { echo "No existe $ENVF"; exit 1; }
read -rsp 'Token del bot: ' TG_TOKEN; echo
read -rsp 'Tu chat_id: ' TG_CHAT; echo
read -rp 'Nombre de la campaña (Enter = no cambiar): ' APPN
[[ "$TG_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]] || { echo 'El token no tiene el formato 123456:ABC...'; exit 1; }
[[ "$TG_CHAT" =~ ^-?[0-9]+$ ]] || { echo 'El chat_id debe ser un numero'; exit 1; }
poner() {
  [ -n "$2" ] || return 0
  tmp=$(mktemp)
  grep -v "^$1=" "$ENVF" > "$tmp" || true
  printf '%s="%s"\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > "$ENVF"; rm -f "$tmp"
}
poner TELEGRAM_BOT_TOKEN "$TG_TOKEN"
poner TELEGRAM_SUPERADMIN_CHAT_ID "$TG_CHAT"
poner APP_NOMBRE "$APPN"
unset TG_TOKEN TG_CHAT
echo 'Listo. Variables presentes:'
grep -oE '^(TELEGRAM_BOT_TOKEN|TELEGRAM_SUPERADMIN_CHAT_ID)=' "$ENVF"
grep -E '^APP_NOMBRE=' "$ENVF" || echo 'APP_NOMBRE no esta definido'
