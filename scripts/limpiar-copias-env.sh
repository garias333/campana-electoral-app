#!/usr/bin/env bash
#
# BORRA LAS COPIAS VIEJAS DEL .env — DESPUÉS DE DECIR QUÉ SE PIERDE.
#
# QUÉ ARREGLA. Al lado del `.env` vivo hay copias fechadas de cada vez que se
# tocó algo. Traen credenciales que YA se retiraron —la llave de Anthropic, el
# token del bot de Telegram anterior; TELEGRAM_BOT_TOKEN y
# TELEGRAM_SUPERADMIN_CHAT_ID, en cambio, están VIGENTES, ver VIGENTES_RX más
# abajo— y que por lo tanto siguen en el servidor aunque el `.env`
# de verdad ya no las tenga. Retirar una credencial y dejar la copia al lado es
# no haberla retirado.
#
# POR QUÉ NO BORRA DE UNA. Porque una copia puede guardar una variable que el
# `.env` vivo ya no tiene y que hace falta —eso no se sabe hasta mirarlo—. Así
# que primero COMPARA y dice, por nombre, qué claves existen sólo en la copia.
# Los valores NO se imprimen nunca: el objetivo es no esparcir secretos, no
# esparcirlos mejor formateados.
#
#   bash scripts/limpiar-copias-env.sh            # compara y no borra
#   bash scripts/limpiar-copias-env.sh --borrar   # borra las que no aportan
#
# Con --borrar sólo se van las copias cuyo juego de claves está CONTENIDO en el
# .env vivo. Si una tiene algo propio, se conserva y se dice por qué.
#
# LAS CREDENCIALES RETIRADAS NO CUENTAN COMO «ALGO PROPIO». La primera versión
# de este script las contaba, y el resultado fue el contrario del que se busca:
# conservaba las cinco copias porque cada una tenía una clave que el .env vivo
# no tiene... que era exactamente la llave de Anthropic que habíamos quitado a
# propósito. Tenerla es motivo para BORRAR la copia, no para guardarla. Se vio
# corriendo el script; leyéndolo parecía correcto.
#
set -euo pipefail

BORRAR=0
RUTA=""
for ARG in "$@"; do
  case "$ARG" in
    --borrar) BORRAR=1 ;;
    *) RUTA="$ARG" ;;
  esac
done

# Sin ruta trabaja sobre su propia instalación; con ruta, sobre la que se le
# diga. Las cuatro instalaciones guardan copias del .env y este script vive en
# una sola: sin el argumento habría que acordarse de copiarlo a las otras, que
# es como se quedan las cosas a medio hacer.
cd "${RUTA:-$(dirname "$0")/..}"
VIVO=.env
[[ -f "$VIVO" ]] || { echo "No hay .env en $(pwd)" >&2; exit 1; }

claves() { grep -oE '^[A-Z_][A-Z0-9_]*=' "$1" 2>/dev/null | tr -d '=' | sort -u; }

# Lo que se sacó del .env a propósito. Que una copia lo tenga es la razón de
# borrarla, no de conservarla.
RETIRADAS_RX='^(ANTHROPIC_API_KEY|TELEGRAM_[A-Z0-9_]*)$'

# EXCEPCIÓN: estas dos NO están retiradas. Volvieron con el aviso por Telegram
# al superadministrador (config/telegram.js) y son credenciales vigentes. Sin
# esta excepción el script las trataría como retiradas: no las contaría como
# claves propias de una copia y la borraría, aunque fuera la única que las
# conserva. Con ella, una copia que tenga una que el .env vivo no tiene se
# CONSERVA y se avisa, como con cualquier clave vigente.
# Ojo: el nombre TELEGRAM_BOT_TOKEN es el mismo que tuvo el bot anterior, así
# que una copia vieja con el token de aquel bot ya no se distingue por nombre.
# Si se rotó el token, la copia vieja hay que revisarla a mano.
VIGENTES_RX='^TELEGRAM_(BOT_TOKEN|SUPERADMIN_CHAT_ID)$'

# Claves de un archivo SIN las retiradas (las vigentes se conservan en la lista).
sin_retiradas() { awk -v ret="$RETIRADAS_RX" -v vig="$VIGENTES_RX" '$0 ~ vig || $0 !~ ret'; }

SOBRAN=0
for COPIA in .env.*; do
  [[ -f "$COPIA" ]] || continue
  [[ "$COPIA" == ".env.example" ]] && { echo "== $COPIA: es la plantilla, se conserva"; continue; }

  # Diferencia contra el .env vivo, descontando las credenciales retiradas.
  # El `|| true` no es adorno: con `set -e`, un grep que no encuentra nada
  # devuelve 1 y mata el script entero. Y «no encuentra nada» es justo el caso
  # bueno — la copia no aporta claves propias. Sin esto, el script se moría en
  # silencio en la primera copia limpia y no imprimía ni una línea.
  PROPIAS=$(comm -23 <(claves "$COPIA") <(claves "$VIVO") | sin_retiradas | tr '\n' ' ' || true)
  RETIRADAS=$(grep -E '^(ANTHROPIC_API_KEY|TELEGRAM_[A-Z_]*)=.+' "$COPIA" 2>/dev/null \
    | grep -vE '^TELEGRAM_(BOT_TOKEN|SUPERADMIN_CHAT_ID)=' | wc -l || true)

  echo "== $COPIA"
  [[ "${RETIRADAS:-0}" -gt 0 ]] && echo "   contiene $RETIRADAS credencial(es) ya retiradas: motivo para borrarla"

  if [[ -n "${PROPIAS// /}" ]]; then
    echo "   TIENE CLAVES QUE EL .env VIVO NO: $PROPIAS"
    echo "   -> se conserva. Revísela a mano antes de borrarla."
    continue
  fi

  echo "   no aporta ninguna clave que el .env vivo no tenga"
  if [[ $BORRAR -eq 1 ]]; then
    rm -f "$COPIA"
    echo "   -> borrada"
  else
    echo "   -> se borraría con --borrar"
  fi
  SOBRAN=$((SOBRAN + 1))
done

echo
[[ $BORRAR -eq 1 ]] && echo "Listo: $SOBRAN copia(s) borrada(s)." \
                    || echo "$SOBRAN copia(s) se borrarían. Nada se tocó."
echo "Ojo: las credenciales que estuvieron en un archivo hay que darlas por"
echo "conocidas. Borrar la copia quita el archivo, no deshace la exposición:"
echo "si una llave llegó a estar de más en algún lado, lo correcto es rotarla."
