#!/usr/bin/env bash
# scripts/rescate-parches.sh — PROCEDIMIENTO DE EMERGENCIA para aplicar a mano, en orden, uno o varios zips de
# parche sobre UNA campaña: la que quedó caída por un parche aplicado sin el que requería, o la que se quedó
# atrás y el panel no puede alcanzar. Generaliza lo que se hizo el 12 de noviembre de 2026 con el 328 y el 329
# (la noche anterior el panel dejó aplicar el 329 sin el 328 y las tres campañas se cayeron).
#
# SE CORRE COMO ROOT, EN EL SERVIDOR, UNA VEZ POR CAMPAÑA (empezar por la municipal):
#   bash scripts/rescate-parches.sh --verificar campanadepruebamunicipal parches/campana-parche328.zip parches/campana-parche329.zip
#   bash scripts/rescate-parches.sh campanadepruebamunicipal parches/campana-parche328.zip parches/campana-parche329.zip
#   bash scripts/rescate-parches.sh campanadepruebadepartamental parches/campana-parche328.zip parches/campana-parche329.zip
#   bash scripts/rescate-parches.sh --carpeta /home/otro/htdocs/sitio appestrategia-c001-2027 parches/campana-parche333.zip
# Los zips se aplican EN EL ORDEN EN QUE SE DAN. Su nombre debe ser campana-parche<N>.zip (de ahí sale el N).
# La carpeta de la app se deduce (/home/USUARIO/htdocs/USUARIO.appestrategia.net, o la única que tenga app.js);
# si no, se pasa con --carpeta.
#
# --verificar NO ESCRIBE NADA: comprueba rutas, zips (sin .env/uploads/.sql, sin rutas que escapen), node/pm2,
#             puerto y proceso, y dice qué parches tiene la campaña y si el requisito de cada zip se cumple.
#
# QUÉ HACE, EN ESTE ORDEN, Y SE DETIENE EN EL PRIMER FALLO (antes de tocar archivos si falla el respaldo):
#   0. Requisitos: cada zip con `.parche-requiere` R debe tener el R ya aplicado en la campaña o venir ANTES en la
#      misma orden. Si no, se niega sin tocar nada. (Un zip viejo sin `.parche-requiere` se acepta con aviso: aquí
#      quien decide el orden eres tú.)
#   1. Respaldo: tar de la carpeta (sin node_modules ni backups) y mysqldump de la base, en /root/respaldos-rescate/
#      (modo 700). El dump se comprueba por CONTENIDO, no por tamaño.
#   2. Descomprime los zips en orden, COMO EL USUARIO de la campaña (sin el `.parche-requiere`, que es del zip), y
#      compara cada archivo con el del último zip que lo trae.
#   3. npm run init-db como el usuario, con el node de esa cuenta (repetible).
#   4. Prueba de carga: `require('./app')` sin abrir el puerto (la misma que hace el actualizador). Si falla, NO
#      reinicia y dice cómo restaurar el respaldo.
#   5. Anota los parches en .parches-aplicados (sembrando antes la lista si no existía) y sube .version-parche.
#   6. Reinicia con scripts/reiniciar-instancia.sh (prueba que el PID cambió) y pm2 save.
#   7. curl al puerto interno y al dominio: tiene que dar 200.
set -u
umask 077

BASE=/home/appestrategia-electoral/htdocs/electoral.appestrategia.net
RESP=/root/respaldos-rescate

SOLO_VERIFICAR=0
DIR=""
while [ "${1:-}" != "" ]; do
  case "$1" in
    --verificar) SOLO_VERIFICAR=1; shift;;
    --carpeta)   DIR="${2:-}"; shift 2;;
    *) break;;
  esac
done
USR="${1:-}"; shift || true
ZIPS=("$@")
[ -n "$USR" ] && [ "${#ZIPS[@]}" -gt 0 ] || { echo "Uso: bash scripts/rescate-parches.sh [--verificar] [--carpeta RUTA] USUARIO ZIP1 [ZIP2 …]"; exit 1; }
[ "$(id -u)" = "0" ] || { echo "Esto se corre como root: las campañas no se leen desde otra cuenta."; exit 1; }
id "$USR" >/dev/null 2>&1 || { echo "No existe el usuario de sistema «$USR»."; exit 1; }

fallo() { echo; echo "✗ $*"; exit 1; }
paso()  { echo; echo "== $*"; }

# ---------- los zips: ruta absoluta, nombre y número ----------
NUMS=()
for i in "${!ZIPS[@]}"; do
  Z="${ZIPS[$i]}"
  [ -f "$Z" ] || { [ -f "$BASE/$Z" ] && Z="$BASE/$Z"; }
  [ -f "$Z" ] || fallo "No existe el zip ${ZIPS[$i]}"
  ZIPS[$i]="$(readlink -f "$Z")"
  N="$(basename "${ZIPS[$i]}" | sed -nE 's/^campana-parche([0-9]+)\.zip$/\1/p')"
  [ -n "$N" ] || fallo "El nombre de $(basename "${ZIPS[$i]}") no es campana-parche<N>.zip: no sé qué número de parche es."
  NUMS+=("$N")
done

# ---------- carpeta de la app ----------
if [ -z "$DIR" ]; then
  DIR="/home/$USR/htdocs/$USR.appestrategia.net"
  if [ ! -d "$DIR" ]; then
    CAND="$(find "/home/$USR/htdocs" -mindepth 2 -maxdepth 2 -name app.js 2>/dev/null)"
    N="$(printf '%s\n' "$CAND" | grep -c .)"
    [ "$N" = "1" ] || fallo "No sé cuál es la carpeta de la app de $USR (candidatas: $N). Pásela con --carpeta.
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

# Lo que tiene la campaña (lista de parches), con el MISMO criterio que el actualizador: .parches-aplicados si
# existe; si no, todo hasta .version-parche (o .version-base). Escribe «n1 n2 n3 …» (sin escribir nada en disco).
TMP="$(mktemp -d /tmp/rescate-parches.XXXXXX)"; chmod 755 "$TMP"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/tenidos.js" <<'JS'
const fs = require('fs');
let v = 0;
for (const f of ['.version-parche', '.version-base']) { try { v = parseInt(fs.readFileSync(f, 'utf8')) || 0; } catch (e) {} if (v) break; }
const set = new Set();
try { for (const l of fs.readFileSync('.parches-aplicados', 'utf8').split('\n')) { const t = l.replace(/#.*/, '').trim(); if (/^\d+$/.test(t)) set.add(+t); } }
catch (e) { for (let n = 1; n <= v; n++) set.add(n); }
console.log([...set].sort((a, b) => a - b).join(' '));
JS
cat > "$TMP/anotar.js" <<'JS'
// Anota los parches aplicados a mano. Si la campaña no tenía .parches-aplicados, lo siembra PRIMERO con todo hasta
// su .version-parche: sin esa siembra, un archivo con solo «328, 329» diría que no tiene nada del 1 al 327.
const fs = require('fs');
const nuevos = process.argv.slice(2).map(Number);
let v = 0;
try { v = parseInt(fs.readFileSync('.version-parche', 'utf8')) || 0; } catch (e) {}
const set = new Set();
let existe = true;
try { for (const l of fs.readFileSync('.parches-aplicados', 'utf8').split('\n')) { const t = l.replace(/#.*/, '').trim(); if (/^\d+$/.test(t)) set.add(+t); } }
catch (e) { existe = false; }
if (!existe) {   // todo lo anterior a lo que se aplica ahora (o hasta su versión, si es mayor)
  let tope = v || (Math.min(...nuevos) - 1);
  for (let n = 1; n <= tope; n++) set.add(n);
}
nuevos.forEach((n) => set.add(n));
fs.writeFileSync('.parches-aplicados', [...set].sort((a, b) => a - b).join('\n') + '\n');
fs.writeFileSync('.version-parche', String(Math.max(v, ...nuevos)));
console.log('anotado: ' + nuevos.join(', ') + ' → .version-parche ' + Math.max(v, ...nuevos));
JS
chmod 644 "$TMP"/*.js
cat > "$TMP/carga.js" <<'JS'
// ¿Carga app.js? Sin abrir el puerto (reemplaza listen) y saliendo a la fuerza (app.js deja temporizadores).
require('net').Server.prototype.listen = function () { return this; };
require('./app');
process.exit(0);
JS
chmod 644 "$TMP/carga.js"

paso "Verificación (solo lectura)"
echo "usuario ....... $USR"
echo "carpeta ....... $DIR"
echo "dominio ....... $DOMINIO"
echo "puerto ........ $PUERTO"
echo "base .......... $BD (usuario $BDUSER en $BDHOST:$BDPUERTO)"
echo "node .......... $NODEBIN"
PID_ANTES="$(pid_actual)"
echo "pid ahora ..... ${PID_ANTES:-ninguno (la app está caída)}"
for i in "${!ZIPS[@]}"; do
  Z="${ZIPS[$i]}"
  [ -f "$Z" ] || fallo "No existe $Z"
  unzip -tq "$Z" >/dev/null 2>&1 || fallo "$Z no pasa unzip -t."
  echo "zip ........... $(basename "$Z")  sha256 $(sha256sum "$Z" | cut -c1-16)…  $(unzip -Z1 "$Z" | wc -l) archivos"
  if unzip -Z1 "$Z" | grep -qE '(^|/)\.env|^uploads/|^node_modules/|^backups/|\.sql$|^\.\./|^/|(^|/)\.parches-aplicados$'; then
    fallo "$(basename "$Z") trae rutas que no deben viajar (.env, uploads, node_modules, .sql, .parches-aplicados o rutas que escapan). No sigo."
  fi
done
for i in "${!ZIPS[@]}"; do for j in "${!ZIPS[@]}"; do
  [ "$i" -lt "$j" ] && [ "$(sha256sum "${ZIPS[$i]}" | cut -d' ' -f1)" = "$(sha256sum "${ZIPS[$j]}" | cut -d' ' -f1)" ] && fallo "Los zips $(basename "${ZIPS[$i]}") y $(basename "${ZIPS[$j]}") son idénticos: algo está mal."
done; done
echo "estado actual . .version-parche = $(cat "$DIR/.version-parche" 2>/dev/null || echo 'no existe'); .version-base = $(cat "$DIR/.version-base" 2>/dev/null || echo 'no existe'); .parches-aplicados = $([ -f "$DIR/.parches-aplicados" ] && echo "existe ($(wc -l < "$DIR/.parches-aplicados") líneas)" || echo 'no existe (se sembrará)')"

paso "Requisitos"
TENIDOS=" $(como_usuario "'$NODEBIN' '$TMP/tenidos.js'" | tail -1) "
[ "${#TENIDOS}" -gt 4 ] || fallo "No pude leer qué parches tiene la campaña."
echo "la campaña tiene $(echo "$TENIDOS" | tr ' ' '\n' | grep -c .) parche(s) anotados; el último es el #$(echo "$TENIDOS" | tr ' ' '\n' | grep . | sort -n | tail -1)"
HUECOS=0
for i in "${!ZIPS[@]}"; do
  Z="${ZIPS[$i]}"; N="${NUMS[$i]}"
  R="$(unzip -p "$Z" .parche-requiere 2>/dev/null | tr -d '[:space:]')"
  if [ -z "$R" ]; then
    echo "  #$N: el zip NO trae .parche-requiere (formato anterior): no se puede comprobar el requisito; el orden lo pones tú."
  elif ! printf '%s' "$R" | grep -qE '^[0-9]+$'; then
    echo "  #$N: su .parche-requiere no es un número ($R)."; HUECOS=$((HUECOS+1))
  elif [[ "$TENIDOS" == *" $R "* ]]; then
    echo "  #$N: requiere el $R → ya lo tiene."
  else
    echo "  #$N: requiere el $R → FALTA y no viene antes en esta orden."; HUECOS=$((HUECOS+1))
  fi
  TENIDOS="$TENIDOS$N "
done
[ "$HUECOS" = "0" ] || fallo "Algún zip no tiene su requisito. No se toca nada: agrega primero el parche que falta, en orden."

echo "últimas líneas del error de PM2:"
como_usuario "pm2 logs --nostream --lines 12" | sed 's/^/   | /' | tail -16
echo "puerto $PUERTO ahora: HTTP $(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "http://127.0.0.1:$PUERTO/login.html")"

if [ "$SOLO_VERIFICAR" = "1" ]; then
  echo; echo "(--verificar: no se escribió nada.)"; exit 0
fi

# ---------- 1. respaldo ----------
paso "1/7 Respaldo"
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

# ---------- 2. descomprimir en orden, como el usuario ----------
paso "2/7 Descomprimir ${#ZIPS[@]} zip(s) en orden (como $USR)"
for i in "${!ZIPS[@]}"; do install -m 644 "${ZIPS[$i]}" "$TMP/p$i.zip"; done
for i in "${!ZIPS[@]}"; do
  # sin el .parche-requiere: es del zip, no de la instalación (y -x de un nombre que no está imprime un aviso)
  EXCL=""; unzip -Z1 "${ZIPS[$i]}" | grep -qx '.parche-requiere' && EXCL="-x .parche-requiere"
  como_usuario "unzip -o '$TMP/p$i.zip' $EXCL -d . > /dev/null" \
    || fallo "unzip de $(basename "${ZIPS[$i]}") falló. Restaurar: tar -xzf $TAR -C $DIR (como $USR)."
  echo "   aplicado $(basename "${ZIPS[$i]}")"
done
# cada archivo debe quedar igual al del ÚLTIMO zip que lo trae
MAL=0
declare -A GANA
for i in "${!ZIPS[@]}"; do
  while IFS= read -r F; do case "$F" in */|.parche-requiere) continue;; esac; GANA["$F"]="$i"; done < <(unzip -Z1 "${ZIPS[$i]}")
done
for F in "${!GANA[@]}"; do
  cmp -s <(unzip -p "${ZIPS[${GANA[$F]}]}" "$F") "$DIR/$F" || { echo "   DIFIERE ($(basename "${ZIPS[${GANA[$F]}]}")): $F"; MAL=$((MAL+1)); }
done
[ "$MAL" = "0" ] || fallo "$MAL archivos no quedaron como en el zip. Restaurar: tar -xzf $TAR -C $DIR (como $USR)."
echo "OK: los ${#GANA[@]} archivos distintos que traen los zips quedaron como en el último que los trae."

# ---------- 3. init-db ----------
paso "3/7 npm run init-db (como $USR)"
como_usuario "npm run init-db" > "$RESP/init-db_${USR}_$SELLO.log" || {
  tail -25 "$RESP/init-db_${USR}_$SELLO.log"
  fallo "init-db falló (log completo: $RESP/init-db_${USR}_$SELLO.log). No se reinició. Restaurar el código: tar -xzf $TAR -C $DIR (como $USR)."
}
tail -4 "$RESP/init-db_${USR}_$SELLO.log"
echo "OK: init-db terminó sin error (log: $RESP/init-db_${USR}_$SELLO.log)"

# ---------- 4. prueba de carga ----------
paso "4/7 Prueba de carga: require('./app') sin abrir el puerto"
como_usuario "'$NODEBIN' '$TMP/carga.js'" > "$TMP/carga.out" 2>&1 || {
  head -12 "$TMP/carga.out" | sed 's/^/   | /'
  fallo "app.js NO carga con estos parches: NO se reinició. Restaurar el código: tar -xzf $TAR -C $DIR (como $USR)."
}
echo "OK: app.js carga sin error."

# ---------- 5. anotar ----------
paso "5/7 Anotar en .parches-aplicados"
como_usuario "'$NODEBIN' '$TMP/anotar.js' ${NUMS[*]}" | tail -2

# ---------- 6. reinicio + pm2 save ----------
paso "6/7 Reinicio (prueba: el PID cambia)"
bash "$BASE/scripts/reiniciar-instancia.sh" "$USR" "$PUERTO" || echo "   (reiniciar-instancia.sh terminó con error: ver arriba)"
como_usuario "pm2 save" | tail -2

# ---------- 7. comprobar ----------
paso "7/7 Comprobación"
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
