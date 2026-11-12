#!/usr/bin/env bash
# scripts/rescate-parche-328-329.sh — devuelve a la vida una campaña que recibió el parche 329
# SIN el 328 (la app no arranca: routes/checkinDiaD.routes.js llama a requiereEditarModulo, que
# solo existe en middleware/permisoModulo.js del 328 → «requiereEditarModulo is not a function»).
#
# SE CORRE COMO ROOT, EN EL SERVIDOR, UNA VEZ POR CAMPAÑA (empezar por la municipal):
#   bash scripts/rescate-parche-328-329.sh --verificar campanadepruebamunicipal
#   bash scripts/rescate-parche-328-329.sh campanadepruebamunicipal
#   bash scripts/rescate-parche-328-329.sh campanadepruebadepartamental
#   bash scripts/rescate-parche-328-329.sh appestrategia-c001-2027
# La carpeta de la app se deduce (/home/USUARIO/htdocs/USUARIO.appestrategia.net, o la única que
# tenga app.js); si no, pásela como tercer argumento.
#
# --verificar NO ESCRIBE NADA: solo comprueba rutas, zips, node/pm2, puerto y proceso.
#
# QUÉ HACE, EN ESTE ORDEN, Y SE DETIENE EN EL PRIMER FALLO (antes de tocar archivos si falla el respaldo):
#   1. Respaldo: tar de la carpeta (sin node_modules ni backups) y mysqldump de la base, en
#      /root/respaldos-rescate-329/ (modo 700). El dump se comprueba por CONTENIDO, no por tamaño.
#   2. Descomprime campana-parche328.zip y DESPUÉS campana-parche329.zip encima, COMO EL USUARIO de
#      la campaña. Ningún zip trae .env ni uploads (se comprueba el listado antes). Al terminar
#      compara cada archivo con el del zip que debe ganar: 329 donde está en los dos, 328 el resto.
#   3. npm run init-db como el usuario, con el node de esa cuenta (repetible).
#   4. Reinicia con scripts/reiniciar-instancia.sh (prueba que el PID cambió) y pm2 save.
#   5. curl al puerto interno y al dominio: tiene que dar 200.
set -u
umask 077

BASE=/home/appestrategia-electoral/htdocs/electoral.appestrategia.net
Z328="$BASE/parches/campana-parche328.zip"
Z329="$BASE/parches/campana-parche329.zip"
RESP=/root/respaldos-rescate-329

SOLO_VERIFICAR=0
if [ "${1:-}" = "--verificar" ]; then SOLO_VERIFICAR=1; shift; fi
USR="${1:-}"
DIR="${2:-}"
[ -n "$USR" ] || { echo "Uso: bash scripts/rescate-parche-328-329.sh [--verificar] USUARIO [CARPETA_APP]"; exit 1; }
[ "$(id -u)" = "0" ] || { echo "Esto se corre como root: las campañas no se leen desde otra cuenta."; exit 1; }
id "$USR" >/dev/null 2>&1 || { echo "No existe el usuario de sistema «$USR»."; exit 1; }

fallo() { echo; echo "✗ $*"; exit 1; }
paso()  { echo; echo "== $*"; }

# ---------- carpeta de la app ----------
if [ -z "$DIR" ]; then
  DIR="/home/$USR/htdocs/$USR.appestrategia.net"
  if [ ! -d "$DIR" ]; then
    CAND="$(find "/home/$USR/htdocs" -mindepth 2 -maxdepth 2 -name app.js 2>/dev/null)"
    N="$(printf '%s\n' "$CAND" | grep -c .)"
    [ "$N" = "1" ] || fallo "No sé cuál es la carpeta de la app de $USR (candidatas: $N). Pásela como tercer argumento.
$CAND"
    DIR="$(dirname "$CAND")"
  fi
fi
DIR="${DIR%/}"
[ -f "$DIR/app.js" ] && [ -f "$DIR/.env" ] || fallo "En $DIR no hay app.js y .env: no es la carpeta de la app."
DOMINIO="$(basename "$DIR")"

envval() {   # valor de una variable del .env, sin comillas ni CR; NUNCA se imprime DB_PASSWORD
  grep -E "^[[:space:]]*$1[[:space:]]*=" "$DIR/.env" | head -1 | sed -E 's/^[^=]*=[[:space:]]*//; s/\r$//; s/^"(.*)"[[:space:]]*$/\1/; s/^'"'"'(.*)'"'"'[[:space:]]*$/\1/'
}
PUERTO="$(envval PORT)"
BD="$(envval DB_NAME)"; BDHOST="$(envval DB_HOST)"; BDPUERTO="$(envval DB_PORT)"; BDUSER="$(envval DB_USER)"; BDCLAVE="$(envval DB_PASSWORD)"
BDHOST="${BDHOST:-127.0.0.1}"; BDPUERTO="${BDPUERTO:-3306}"
[ -n "$PUERTO" ] && [ -n "$BD" ] && [ -n "$BDUSER" ] || fallo "Faltan PORT, DB_NAME o DB_USER en $DIR/.env."

# ---------- node y pm2 de esa cuenta (el más nuevo que tenga pm2, como reiniciar-instancia.sh) ----------
NODEBIN=""
for C in $(ls -d /home/"$USR"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V -r); do
  if [ -x "$C" ] && [ -x "$(dirname "$C")/pm2" ] && [ -x "$(dirname "$C")/npm" ]; then NODEBIN="$C"; break; fi
done
[ -n "$NODEBIN" ] || fallo "No encuentro un node con pm2 y npm en /home/$USR/.nvm/versions/node/*/bin."
BIN="$(dirname "$NODEBIN")"
como_usuario() { su -s /bin/bash - "$USR" -c "export PATH='$BIN':\$PATH; cd '$DIR' && $*" 2>&1; }

pid_actual() { pgrep -f "$DIR/app.js" | head -1; }

paso "Verificación (solo lectura)"
echo "usuario ....... $USR"
echo "carpeta ....... $DIR"
echo "dominio ....... $DOMINIO"
echo "puerto ........ $PUERTO"
echo "base .......... $BD (usuario $BDUSER en $BDHOST:$BDPUERTO)"
echo "node .......... $NODEBIN"
PID_ANTES="$(pid_actual)"
echo "pid ahora ..... ${PID_ANTES:-ninguno (la app está caída)}"
for Z in "$Z328" "$Z329"; do
  [ -f "$Z" ] || fallo "No existe $Z"
  unzip -tq "$Z" >/dev/null 2>&1 || fallo "$Z no pasa unzip -t."
  echo "zip ........... $(basename "$Z")  sha256 $(sha256sum "$Z" | cut -c1-16)…  $(unzip -Z1 "$Z" | wc -l) archivos"
  if unzip -Z1 "$Z" | grep -qE '(^|/)\.env|^uploads/|^node_modules/|^backups/|\.sql$|^\.\./|^/'; then
    fallo "$(basename "$Z") trae rutas que no deben viajar (.env, uploads, node_modules, .sql o rutas que escapan). No sigo."
  fi
done
[ "$(sha256sum "$Z328" | cut -d' ' -f1)" != "$(sha256sum "$Z329" | cut -d' ' -f1)" ] || fallo "Los dos zips son idénticos: algo está mal."
echo "estado actual . .version-parche = $(cat "$DIR/.version-parche" 2>/dev/null || echo 'no existe'); .version-base = $(cat "$DIR/.version-base" 2>/dev/null || echo 'no existe')"
if grep -q "requiereEditarModulo" "$DIR/middleware/permisoModulo.js" 2>/dev/null; then
  echo "permisoModulo.js: YA tiene requiereEditarModulo (el 328 está puesto)."
else
  echo "permisoModulo.js: NO tiene requiereEditarModulo (falta el 328): confirma la causa de la caída."
fi
echo "últimas líneas del error de PM2:"
como_usuario "pm2 logs --nostream --lines 12" | sed 's/^/   | /' | tail -16
echo "puerto $PUERTO ahora: HTTP $(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "http://127.0.0.1:$PUERTO/login.html")"

if [ "$SOLO_VERIFICAR" = "1" ]; then
  echo; echo "(--verificar: no se escribió nada.)"; exit 0
fi

# ---------- 1. respaldo ----------
paso "1/5 Respaldo"
mkdir -p "$RESP" && chmod 700 "$RESP"
SELLO="$(date +%Y%m%d-%H%M%S)"
TAR="$RESP/${USR}_app_$SELLO.tar.gz"
SQL="$RESP/${USR}_${BD}_$SELLO.sql"
tar -czf "$TAR" --exclude='./node_modules' --exclude='./backups' -C "$DIR" . || fallo "tar falló."
tar -tzf "$TAR" >/dev/null 2>&1 || fallo "El tar no se puede leer."
echo "carpeta ->  $TAR ($(du -h "$TAR" | cut -f1))"
MYSQL_PWD="$BDCLAVE" mysqldump -h "$BDHOST" -P "$BDPUERTO" -u "$BDUSER" --single-transaction --routines --triggers --no-tablespaces "$BD" > "$SQL" 2> "$SQL.err"
[ -s "$SQL.err" ] && sed 's/^/   mysqldump: /' "$SQL.err" | head -5
rm -f "$SQL.err"
# el contenido, no el tamaño (CLAUDE.md de territorios, regla 9)
grep -aq 'CREATE TABLE' "$SQL" && grep -aq 'INSERT INTO' "$SQL" && grep -aq -- '-- Dump completed' "$SQL" \
  || fallo "El respaldo de la base salió incompleto ($SQL). NO se tocó ningún archivo de la campaña."
echo "base    ->  $SQL ($(du -h "$SQL" | cut -f1), $(grep -ac 'CREATE TABLE' "$SQL") tablas)"
chmod 600 "$TAR" "$SQL"

# ---------- 2. descomprimir 328 y DESPUÉS 329, como el usuario ----------
paso "2/5 Descomprimir 328 y luego 329 (como $USR)"
TMP="$(mktemp -d /tmp/rescate329.XXXXXX)"; chmod 755 "$TMP"
install -m 644 "$Z328" "$TMP/p328.zip"; install -m 644 "$Z329" "$TMP/p329.zip"
como_usuario "unzip -o '$TMP/p328.zip' -d . > /dev/null && unzip -o '$TMP/p329.zip' -d . > /dev/null" \
  || { rm -rf "$TMP"; fallo "unzip falló. Restaurar: tar -xzf $TAR -C $DIR (como $USR)."; }
# cada archivo debe quedar igual al del zip que gana
MAL=0
for F in $(unzip -Z1 "$Z329"); do
  case "$F" in */) continue;; esac
  cmp -s <(unzip -p "$Z329" "$F") "$DIR/$F" || { echo "   DIFIERE (329): $F"; MAL=$((MAL+1)); }
done
for F in $(comm -23 <(unzip -Z1 "$Z328" | sort) <(unzip -Z1 "$Z329" | sort)); do
  case "$F" in */) continue;; esac
  cmp -s <(unzip -p "$Z328" "$F") "$DIR/$F" || { echo "   DIFIERE (328): $F"; MAL=$((MAL+1)); }
done
rm -rf "$TMP"
[ "$MAL" = "0" ] || fallo "$MAL archivos no quedaron como en el zip."
echo "OK: los $(comm -12 <(unzip -Z1 "$Z328" | sort) <(unzip -Z1 "$Z329" | sort) | wc -l) archivos comunes quedaron en la versión 329 y los demás en la de su zip."
grep -q "requiereEditarModulo" "$DIR/middleware/permisoModulo.js" || fallo "permisoModulo.js sigue sin requiereEditarModulo."
como_usuario "'$NODEBIN' -e \"require('./routes/checkinDiaD.routes')\"" >/dev/null 2>"$RESP/.carga.err" \
  && echo "OK: routes/checkinDiaD.routes.js carga sin error." \
  || { echo "   la carga del router dio:"; head -5 "$RESP/.carga.err" | sed 's/^/   | /'; }
rm -f "$RESP/.carga.err"

# ---------- 3. init-db ----------
paso "3/5 npm run init-db (como $USR)"
como_usuario "npm run init-db" > "$RESP/init-db_${USR}_$SELLO.log" || {
  tail -25 "$RESP/init-db_${USR}_$SELLO.log"
  fallo "init-db falló (log completo: $RESP/init-db_${USR}_$SELLO.log). No se reinició; la app seguía caída."
}
tail -4 "$RESP/init-db_${USR}_$SELLO.log"
echo "OK: init-db terminó sin error (log: $RESP/init-db_${USR}_$SELLO.log)"

# ---------- 4. reinicio + pm2 save ----------
paso "4/5 Reinicio (prueba: el PID cambia)"
bash "$BASE/scripts/reiniciar-instancia.sh" "$USR" "$PUERTO" || echo "   (reiniciar-instancia.sh terminó con error: ver arriba)"
como_usuario "pm2 save" | tail -2

# ---------- 5. comprobar ----------
paso "5/5 Comprobación"
sleep 3
LOCAL="$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' "http://127.0.0.1:$PUERTO/login.html")"
PUBLICO="$(curl -s -o /dev/null --max-time 15 -w '%{http_code}' "https://$DOMINIO/login.html")"
echo "puerto interno $PUERTO ... HTTP $LOCAL"
echo "https://$DOMINIO ... HTTP $PUBLICO"
echo "pid ahora: $(pid_actual)  (antes: ${PID_ANTES:-ninguno})"
if [ "$LOCAL" = "200" ] && [ "$PUBLICO" = "200" ]; then
  echo; echo "✓ $USR responde 200."
  echo "  Respaldos en $RESP (llevan datos personales; borrar cuando se confirme que todo sigue bien)."
  exit 0
fi
echo; echo "✗ NO responde 200. Últimas líneas del log de PM2:"
como_usuario "pm2 logs --nostream --lines 30" | tail -35
exit 1
