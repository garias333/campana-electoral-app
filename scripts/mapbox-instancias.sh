#!/usr/bin/env bash
# scripts/mapbox-instancias.sh — el token de Mapbox de cada instancia.
#
# SE CORRE COMO ROOT, EN EL SERVIDOR:
#   bash scripts/mapbox-instancias.sh                      # revisa todas
#   bash scripts/mapbox-instancias.sh --poner <usuario> pk.xxxx
#   bash scripts/mapbox-instancias.sh --poner <usuario> pk.xxxx --reemplazar
#
# ------------------------------------------------------------------------
# UN TOKEN POR CAMPAÑA, NO UNO COMPARTIDO
#
#   El token es público (viaja al navegador en /api/territorial/mapbox-token),
#   así que el riesgo no es que se filtre: es la CUOTA. Mapbox cobra por
#   cargas de mapa, y con un token compartido las campañas se gastan el saldo
#   unas a otras y no hay forma de saber cuál consumió qué. Con uno por
#   campaña, cada cuota es suya y se puede restringir por URL desde el panel
#   de Mapbox — que es lo que impide que alguien copie el token y lo use en
#   otro sitio.
#
# POR QUÉ ESTE ARCHIVO EXISTE
#
#   4 de septiembre de 2026: el Mapa territorial de las dos campañas de prueba
#   solo ofrecía OpenStreetMap. No había ningún error: `mapa.html` no ofrece
#   los fondos de Mapbox cuando no hay token, a propósito, porque sin token
#   mostrarían teselas en blanco. Las dos campañas no tenían ni la línea en su
#   `.env` — nacieron sin ella porque `.env.example` no la traía.
#
#   Es el mismo patrón del SMTP de agosto, y la misma lección: la pista fue
#   un número que no cuadraba (97 caracteres en electoral, la línea ausente en
#   las campañas), y el fallo llevaba semanas sin que nadie lo notara porque
#   un mapa que funciona con un fondo menos no se queja.
#
# SE COMPRUEBA ANTES DE ESCRIBIR
#
#   `--poner` le pide una tesela real a Mapbox con ese token ANTES de tocar
#   ningún `.env`. Copiar una credencial sin comprobarla fue lo que, con el
#   SMTP, convirtió un fallo en tres.
# ------------------------------------------------------------------------
set -u

# La raíz es /home salvo que se diga otra cosa. Sirve para dos cosas: probar
# este archivo contra un árbol de mentira sin tocar nada real, y sobrevivir a
# una instalación que no cuelgue de /home.
BASE_HOME="${BASE_HOME:-/home}"

MODO="revisar"; USUARIO=""; TOKEN=""; REEMPLAZAR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --poner)       MODO="poner"; USUARIO="${2:?Falta el usuario}"; TOKEN="${3:?Falta el token}"; shift 3 ;;
    --reemplazar)  REEMPLAZAR=1; shift ;;
    -h|--help)     sed -n '2,9p' "$0"; exit 0 ;;
    *)             echo "Opción desconocida: $1"; exit 2 ;;
  esac
done

# Las instancias son las carpetas de /home que tienen un app.js dentro de su
# htdocs. Se descubren en vez de listarlas: una lista escrita a mano deja
# fuera la campaña nueva, y un inventario incompleto no da error — da una
# conclusión falsa con la misma cara que una verdadera.
# CADA SITIO APARECE UNA VEZ, aunque varias cuentas apunten a el.
#
# Cada instancia tiene su cuenta de CloudPanel y ademas una o mas cuentas SSH
# cuyo ~/htdocs es un ENLACE al mismo directorio. El glob las ve todas, asi que
# la primera version de este archivo listo 11 instancias donde hay 4 y marco
# como "COMPARTIDO" cada sitio consigo mismo. Un inventario mal contado no da
# error: da una conclusion falsa con la misma cara que una verdadera.
#
# Se resuelve la ruta fisica con `readlink -f` y se descarta la repetida.
#
# Y solo cuentan las instancias que USAN el token: las que tienen
# `public/mapa.html`. Sin ese filtro salia `proyector` —otra aplicacion del
# mismo servidor— como si le faltara algo que nunca ha necesitado.
listar_instancias() {
  local vistos=""
  for D in "$BASE_HOME"/*/htdocs/*/; do
    [ -f "$D/app.js" ] || continue
    [ -f "$D/public/mapa.html" ] || continue
    local real
    real=$(readlink -f "$D")
    case " $vistos " in *" $real "*) continue ;; esac
    vistos="$vistos $real"
    printf '%s\n' "$real"
  done
}

# Le pide UNA tesela a Mapbox, HACIENDOSE PASAR POR EL NAVEGADOR DE ESA
# CAMPANA. El segundo argumento es el dominio.
#
# EL `Referer` NO ES ADORNO. Un token restringido por URL —que es como hay que
# emitirlos— acepta la peticion solo si viene de su dominio, y RECHAZA las que
# llegan sin `Referer`. Sin esta cabecera, la comprobacion daria 401 para un
# token perfectamente bueno y este script se negaria a instalarlo: el peor
# tipo de guarda, la que rechaza justo lo que esta bien hecho.
#
# Con el dominio puesto, lo que se prueba es lo que de verdad va a pasar
# cuando alguien abra el mapa en esa campana.
probar_token() {
  local referer=""
  [ -n "${2:-}" ] && referer="https://$2/"
  if [ -n "$referer" ]; then
    curl -s -o /dev/null -w '%{http_code}' --max-time 20 -H "Referer: $referer" \
      "https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/10/291/489?access_token=$1"
  else
    curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
      "https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/10/291/489?access_token=$1"
  fi
}

# Nunca se imprime entero: lo justo para reconocerlo.
resumir() { printf '%s…%s (%s car.)' "$(echo "$1" | cut -c1-8)" "$(echo "$1" | rev | cut -c1-4 | rev)" "${#1}"; }

valor_en() { grep -m1 "^MAPBOX_ACCESS_TOKEN=" "$1" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"''; }

if [ "$MODO" = "revisar" ]; then
  printf '%-46s %-26s %s\n' "INSTANCIA" "TOKEN" "MAPBOX"
  printf '%-46s %-26s %s\n' "---------" "-----" "------"
  VISTOS=""; REPETIDOS=0; TOTAL=0
  for DIR in $(listar_instancias); do
    TOTAL=$((TOTAL+1))
    NOMBRE=$(basename "$DIR")
    ENV="$DIR/.env"
    if [ ! -f "$ENV" ]; then printf '%-46s %-26s %s\n' "$NOMBRE" "(sin .env)" "-"; continue; fi
    T=$(valor_en "$ENV")
    if [ -z "$T" ]; then
      printf '%-46s %-26s %s\n' "$NOMBRE" "FALTA" "solo OpenStreetMap"
      continue
    fi
    COD=$(probar_token "$T" "$NOMBRE")
    [ "$COD" = "200" ] && EST="sirve" || EST="NO SIRVE (HTTP $COD)"
    # ¿Compartido con otra instancia? Es lo que este script viene a evitar.
    HUELLA=$(printf '%s' "$T" | md5sum | cut -c1-8)
    case "$VISTOS" in *"$HUELLA"*) EST="$EST  <-- COMPARTIDO"; REPETIDOS=1 ;; esac
    VISTOS="$VISTOS $HUELLA"
    printf '%-46s %-26s %s\n' "$NOMBRE" "$(resumir "$T")" "$EST"
  done
  echo
  echo "$TOTAL instancia(s) revisadas."
  [ "$REPETIDOS" = "1" ] && cat <<'AVISO'

Hay instancias compartiendo token. Funciona, pero la cuota de Mapbox es una
sola para todas y no se puede saber cuál la consumió. Emita uno por campaña
en account.mapbox.com y restrínjalo por URL al dominio de esa campaña.
AVISO
  exit 0
fi

# ---- modo --poner ----
DIR="$BASE_HOME/$USUARIO/htdocs/$USUARIO.appestrategia.net"
[ -d "$DIR" ] || DIR=$(listar_instancias | grep "/$USUARIO/" | head -1)
[ -n "$DIR" ] && [ -d "$DIR" ] || { echo "No encuentro la instancia de '$USUARIO'."; exit 1; }
ENV="$DIR/.env"
[ -f "$ENV" ] || { echo "No existe $ENV"; exit 1; }

case "$TOKEN" in pk.*) ;; *) echo "Un token público de Mapbox empieza por 'pk.'. Ese no."; exit 1 ;; esac

DOMINIO=$(basename "$DIR")
echo "Comprobando el token contra Mapbox como si fuera el navegador de $DOMINIO..."
COD=$(probar_token "$TOKEN" "$DOMINIO")
if [ "$COD" != "200" ]; then
  echo "Mapbox respondió HTTP $COD: el token no sirve para ese dominio. No se tocó ningún archivo."
  echo
  echo "Si el token es nuevo y está restringido por URL, compruebe en"
  echo "account.mapbox.com que la restricción incluya EXACTAMENTE:"
  echo "  https://$DOMINIO/*"
  exit 1
fi
echo "  la tesela llega (HTTP 200)."

ACTUAL=$(valor_en "$ENV")
if [ -n "$ACTUAL" ] && [ "$REEMPLAZAR" != "1" ]; then
  echo "$USUARIO ya tiene token ($(resumir "$ACTUAL")). Para pisarlo: --reemplazar"
  exit 1
fi

# Se escribe conservando dueño y permisos: el .env de una campaña es de su
# propia cuenta y en 640. Un archivo nuevo con otro dueño deja la app sin
# poder leer su propia configuración al arrancar.
DUENO=$(stat -c '%U:%G' "$ENV"); PERMS=$(stat -c '%a' "$ENV")
TMP=$(mktemp)
if [ -n "$ACTUAL" ]; then
  grep -v "^MAPBOX_ACCESS_TOKEN=" "$ENV" > "$TMP"
else
  cat "$ENV" > "$TMP"
fi
printf 'MAPBOX_ACCESS_TOKEN=%s\n' "$TOKEN" >> "$TMP"
cat "$TMP" > "$ENV"; rm -f "$TMP"
chown "$DUENO" "$ENV"; chmod "$PERMS" "$ENV"

echo "Escrito en $ENV  (dueño $DUENO, permisos $PERMS)"
echo
echo "FALTA REINICIAR: pm2 restart NO relee el .env."
echo "  bash $(cd "$(dirname "$0")" && pwd)/reiniciar-instancia.sh $USUARIO"
