#!/usr/bin/env bash
#
# PASA LA CAMPAÑA DE YIMAR (Puerto Berrío, DIVIPOLA 05579) AL CATÁLOGO
# TERRITORIAL. De una sola corrida, como root, en este orden:
#
#   1. la clave de root de MySQL, UNA vez
#   2. la vista del catálogo (se copia del repo de Territorios si hace falta)
#   3. los GRANT que le faltan a 'c001-2027user'@'%', y se comprueba ENTRANDO
#      como él
#   4. el reapuntado de las catorce columnas (respalda la base antes)
#   5. la vista: renombra `territorios` a `territorios_local` y la crea
#   6. la llave de Territorios y las dos líneas del .env (respalda el .env)
#   7. el reinicio, y se comprueba que la campaña responde
#
# SE DETIENE EN EL PRIMER ERROR Y DICE EN QUÉ PASO QUEDÓ. Lo que ya hizo no se
# deshace solo: al final de este archivo está cómo volver atrás, y el script lo
# vuelve a imprimir si se cae.
#
# Uso:
#   bash scripts/migrar-yimar-a-catalogo.sh              (migra)
#   bash scripts/migrar-yimar-a-catalogo.sh --simular    (solo comprueba)
#
# Si el paso 6 no logra generar la llave (sus banderas no están comprobadas
# desde aquí), el script se detiene AHÍ y dice cómo seguir: se genera a mano y
# se vuelve a correr con TERRITORIOS_API_CLAVE=... delante, que salta ese paso.
# Lo de antes ya quedó hecho y el script lo detecta.

set -Eeuo pipefail

SIMULAR=0
[[ "${1:-}" == "--simular" ]] && SIMULAR=1

# ---------------------------------------------------------------- constantes
BASE_CAMPANA='c001-2027db'
USUARIO_MYSQL='c001-2027user'
HOST_MYSQL='%'
USUARIO_SISTEMA='appestrategia-c001-2027'
MODELO_MYSQL='usercampanadepruebamunicipal'   # de quién se copian los permisos
DANE='05579'
ELECTORAL='/home/appestrategia-electoral/htdocs/electoral.appestrategia.net'
NODE="/home/appestrategia-electoral/.nvm/versions/node/v22.23.1/bin/node"
PARES="$ELECTORAL/scripts/pares/yimar-puerto-berrio.csv"
TRABAJO='/home/gariasappelectoral/orden154'
VISTA="$TRABAJO/vista_territorios_catalogo.sql"
VISTA_ORIGEN='/home/appestrategia-territorios/htdocs/territorios.appestrategia.net/vista_territorios_catalogo.sql'
CTC_DIR='/home/territoriosshh/htdocs/territorios.appestrategia.net'

PASO='arranque'
paso() { PASO="$1"; echo; echo "===== $1 ====="; }

# Lo que se imprime pase lo que pase si algo revienta: en qué paso quedó y
# cómo deshacerlo. Un script que se cae en silencio a las tres de la mañana es
# peor que no tenerlo.
al_fallar() {
  local codigo=$?
  echo
  echo "!!! SE DETUVO EN: $PASO (código $codigo)"
  echo
  echo "Para volver atrás, según hasta dónde llegó:"
  echo "  · La base:   mysql -h 127.0.0.1 -u root -p '$BASE_CAMPANA' < ${RESPALDO_BD:-<el respaldo que imprimió el paso 4>}"
  echo "  · La vista:  DROP VIEW territorios; RENAME TABLE territorios_local TO territorios;"
  echo "  · El .env:   cp ${RESPALDO_ENV:-<el respaldo del paso 6>} \$DIR/.env  y reiniciar"
  echo "  · Los GRANT: REVOKE SELECT ON territoriosdb.* FROM '$USUARIO_MYSQL'@'$HOST_MYSQL';"
  exit "$codigo"
}
trap al_fallar ERR

RESPALDO_BD=''
RESPALDO_ENV=''
YA_MIGRADA=0

# ------------------------------------------------------------------- paso 0
paso "0. Comprobaciones"
[[ "$(id -u)" == "0" ]] || { echo "Esto se corre como root."; exit 1; }
for f in "$NODE" "$PARES" "$ELECTORAL/scripts/territorios-a-catalogo.js" "$ELECTORAL/scripts/reiniciar-instancia.sh"; do
  [[ -e "$f" ]] || { echo "No existe: $f"; exit 1; }
done

# La carpeta de la campaña: la misma convención que reiniciar-instancia.sh.
DIR="/home/$USUARIO_SISTEMA/htdocs/$USUARIO_SISTEMA.appestrategia.net"
if [[ ! -f "$DIR/app.js" ]]; then
  CAND=$(find "/home/$USUARIO_SISTEMA/htdocs" -mindepth 2 -maxdepth 2 -name app.js 2>/dev/null | head -5)
  [[ $(echo "$CAND" | grep -c .) == 1 ]] || { echo "No sé cuál es la app de $USUARIO_SISTEMA:"; echo "$CAND"; exit 1; }
  DIR=$(dirname "$CAND")
fi
[[ -f "$DIR/.env" ]] || { echo "No existe $DIR/.env"; exit 1; }
echo "Campaña:  $DIR"
echo "Base:     $BASE_CAMPANA   ·   usuario MySQL: $USUARIO_MYSQL@$HOST_MYSQL"
[[ $SIMULAR == 1 ]] && echo "MODO SIMULAR: no se escribe nada."

# ------------------------------------------------------------------- paso 1
paso "1. Clave de root de MySQL"
read -r -s -p 'Clave root MySQL: ' CLAVE_ROOT; echo
export MYSQL_PWD="$CLAVE_ROOT"
mysql -h 127.0.0.1 -P 3306 -u root -e 'SELECT 1' >/dev/null
echo "La clave sirve."

# ------------------------------------------------------------------- paso 2
paso "2. La vista del catálogo"
if [[ -f "$VISTA" ]]; then
  echo "Ya estaba en $VISTA"
else
  [[ -r "$VISTA_ORIGEN" ]] || { echo "No puedo leer $VISTA_ORIGEN"; exit 1; }
  mkdir -p "$TRABAJO"
  install -o gariasappelectoral -m 644 "$VISTA_ORIGEN" "$VISTA"
  echo "Copiada a $VISTA"
fi
grep -q 'campana_ambito' "$VISTA" || { echo "Ese archivo no nombra campana_ambito: no parece la vista."; exit 1; }
grep -qi 'CREATE VIEW territorios' "$VISTA" || { echo "Ese archivo no crea la vista territorios."; exit 1; }
# No hay que ajustarla para c001: usa DATABASE() y el nombre del catálogo fijo,
# así que vale para cualquier campaña con solo pasársela a su base.
echo "Sirve tal cual: se acota con DATABASE(), no lleva el nombre de ninguna campaña."

# ------------------------------------------------------------------- paso 3
paso "3. Permisos de $USUARIO_MYSQL sobre territoriosdb"
TABLAS=$(mysql -h 127.0.0.1 -P 3306 -u root -N -B -e "
  SELECT TABLE_NAME FROM information_schema.TABLE_PRIVILEGES
   WHERE GRANTEE = \"'$MODELO_MYSQL'@'%'\" AND TABLE_SCHEMA='territoriosdb' AND PRIVILEGE_TYPE='SELECT'
   ORDER BY TABLE_NAME;")
N_MODELO=$(echo "$TABLAS" | grep -c .)
[[ "$N_MODELO" -ge 10 ]] || { echo "El modelo $MODELO_MYSQL solo tiene $N_MODELO tablas: algo no cuadra."; exit 1; }
echo "Se copian $N_MODELO tablas de $MODELO_MYSQL."
if [[ $SIMULAR == 0 ]]; then
  while read -r t; do
    [[ -n "$t" ]] || continue
    mysql -h 127.0.0.1 -P 3306 -u root -e "GRANT SELECT ON territoriosdb.\`$t\` TO '$USUARIO_MYSQL'@'$HOST_MYSQL';"
  done <<< "$TABLAS"
  mysql -h 127.0.0.1 -P 3306 -u root -e 'FLUSH PRIVILEGES;'
fi
N_AHORA=$(mysql -h 127.0.0.1 -P 3306 -u root -N -B -e "
  SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES
   WHERE GRANTEE = \"'$USUARIO_MYSQL'@'$HOST_MYSQL'\" AND TABLE_SCHEMA='territoriosdb' AND PRIVILEGE_TYPE='SELECT';")
if [[ $SIMULAR == 1 ]]; then
  echo "$USUARIO_MYSQL tiene $N_AHORA tabla(s) de territoriosdb (simulación: no se otorgó ninguna)."
else
  echo "$USUARIO_MYSQL tiene ahora $N_AHORA tabla(s) de territoriosdb."
  [[ "$N_AHORA" -ge "$N_MODELO" ]] || { echo "Se esperaban al menos $N_MODELO: el GRANT no cuajó."; exit 1; }
fi

# LA COMPROBACIÓN QUE IMPORTA: entrar COMO ÉL. Que root lea el catálogo no
# prueba nada — root lo lee todo, y es justo lo que escondería el fallo.
CLAVE_CAMPANA=$(sed -n 's/^[[:space:]]*DB_PASSWORD[[:space:]]*=[[:space:]]*//p' "$DIR/.env" | head -1 | sed 's/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/')
[[ -n "$CLAVE_CAMPANA" ]] || { echo "No pude leer DB_PASSWORD de $DIR/.env"; exit 1; }
if [[ $SIMULAR == 0 ]]; then
  # `--get-server-public-key` hace falta con caching_sha2_password sobre TCP sin
  # TLS; sin él el cliente se queja de la conexión, no de los permisos.
  SAL_PRUEBA=$(MYSQL_PWD="$CLAVE_CAMPANA" mysql -h 127.0.0.1 -P 3306 -u "$USUARIO_MYSQL" \
    --get-server-public-key -N -B \
    -e 'SELECT COUNT(*) FROM territoriosdb.ctc_territorios WHERE codigo_dane = "05579";' 2>&1) || SAL_PRUEBA="FALLO:$SAL_PRUEBA"
  if [[ "$SAL_PRUEBA" == FALLO:* ]]; then
    # NO TODO FALLO ES DE PERMISOS, y decir que lo es manda a arreglar lo que
    # no está roto. Se distingue, porque el remedio es distinto.
    if grep -qiE 'denied' <<< "$SAL_PRUEBA"; then
      echo "$USUARIO_MYSQL NO puede leer el catálogo: el GRANT no sirvió."
    else
      echo "No se pudo COMPROBAR el acceso de $USUARIO_MYSQL (no es un problema de permisos):"
      echo "   ${SAL_PRUEBA#FALLO:}"
      echo "   Compruébelo a mano antes de seguir; los GRANT ya quedaron dados."
    fi
    exit 1
  fi
  echo "Comprobado entrando como $USUARIO_MYSQL: lee el catálogo ($SAL_PRUEBA municipio(s) con ese código)."
fi
export MYSQL_PWD="$CLAVE_ROOT"

# ------------------------------------------------------------------- paso 4
paso "4. Reapuntar los territorios al catálogo"
if [[ $SIMULAR == 1 ]]; then
  DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=root DB_PASSWORD="$CLAVE_ROOT" DB_NAME="$BASE_CAMPANA" \
    CATALOGO_DB=territoriosdb "$NODE" "$ELECTORAL/scripts/territorios-a-catalogo.js" --dane "$DANE" --pares "$PARES"
else
  SALIDA=$(DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=root DB_PASSWORD="$CLAVE_ROOT" DB_NAME="$BASE_CAMPANA" \
    CATALOGO_DB=territoriosdb "$NODE" "$ELECTORAL/scripts/territorios-a-catalogo.js" --dane "$DANE" --pares "$PARES" --aplicar)
  echo "$SALIDA" | tail -14
  # VOLVER A CORRER EL SCRIPT TIENE QUE SER SEGURO. Si el paso 6 se cayó (la
  # llave), se vuelve a lanzar esto entero: el reapuntado ya está hecho y no
  # hay que repetirlo ni asustarse porque no haya respaldo nuevo.
  if grep -q 'ya NO es una tabla local' <<< "$SALIDA"; then
    YA_MIGRADA=1
    echo "Ya estaba reapuntada: se salta y se sigue."
  else
    RESPALDO_BD=$(echo "$SALIDA" | sed -n 's/^Respaldo: \([^ ]*\) .*/\1/p' | head -1)
    [[ -s "$RESPALDO_BD" ]] || { echo "No encuentro el respaldo que debía dejar el paso 4."; exit 1; }
    echo "Respaldo de la base: $RESPALDO_BD"
  fi
fi

# ------------------------------------------------------------------- paso 5
paso "5. La vista: territorios pasa a leerse del catálogo"
if [[ $SIMULAR == 1 ]]; then
  echo "(simular) se correría: mysql $BASE_CAMPANA < $VISTA"
else
  if [[ $YA_MIGRADA == 1 ]]; then
    echo "La campaña ya leía del catálogo: no se vuelve a crear la vista."
  else
    mysql -h 127.0.0.1 -P 3306 -u root "$BASE_CAMPANA" < "$VISTA" | sed 's/^/   /'
  fi
  TIPO=$(mysql -h 127.0.0.1 -P 3306 -u root -N -B -e "
    SELECT TABLE_TYPE FROM information_schema.TABLES
     WHERE TABLE_SCHEMA='$BASE_CAMPANA' AND TABLE_NAME='territorios';")
  [[ "$TIPO" == "VIEW" ]] || { echo "territorios quedó como '$TIPO' y debía ser VIEW."; exit 1; }
  echo "territorios es ahora una VISTA."
fi

# ------------------------------------------------------------------- paso 6
paso "6. Llave de Territorios y .env"
LLAVE="${TERRITORIOS_API_CLAVE:-}"
if [[ -n "$LLAVE" ]]; then
  echo "Se usa la llave que venía en el entorno (no se genera otra)."
elif [[ $SIMULAR == 1 ]]; then
  echo "(simular) se generaría la llave para el municipio $DANE."
else
  echo "Generando la llave en Territorios…"
  SAL_LLAVE=$(su -s /bin/bash - territoriosshh -c \
    "export NVM_DIR=\$HOME/.nvm; . \$NVM_DIR/nvm.sh; cd '$CTC_DIR' && node scripts/crear_clave_campana.js --campana yimar --nombre 'Campana Yimar Puerto Berrio' --municipios $DANE --nueva-llave" 2>&1) || true
  LLAVE=$(echo "$SAL_LLAVE" | grep -oE 'ctc_[A-Za-z0-9_-]{8,}' | head -1)
  if [[ -z "$LLAVE" ]]; then
    echo "No pude sacar la llave de la salida del generador. Lo que contestó (sin llaves):"
    echo "$SAL_LLAVE" | sed 's/ctc_[A-Za-z0-9_-]*/ctc_<oculta>/g' | tail -20
    echo
    echo "Genérela a mano y vuelva a correr este script así (salta lo ya hecho):"
    echo "  TERRITORIOS_API_CLAVE='ctc_...' bash $0"
    exit 1
  fi
  echo "Llave generada (no se muestra)."
fi

if [[ $SIMULAR == 0 ]]; then
  [[ "$LLAVE" == *'"'* ]] && { echo "La llave trae una comilla doble y dotenv no sabría leerla."; exit 1; }
  RESPALDO_ENV="$DIR/.env.antes-de-territorios-$(date +%Y%m%d%H%M%S)"
  cp -p "$DIR/.env" "$RESPALDO_ENV"
  chmod 600 "$RESPALDO_ENV"
  echo "Respaldo del .env: $RESPALDO_ENV"
  # Sin duplicar: se quitan las líneas viejas y se vuelven a escribir.
  sed -i '/^[[:space:]]*TERRITORIOS_API_URL[[:space:]]*=/d; /^[[:space:]]*TERRITORIOS_API_CLAVE[[:space:]]*=/d' "$DIR/.env"
  [[ -n "$(tail -c1 "$DIR/.env")" ]] && echo >> "$DIR/.env"
  {
    echo 'TERRITORIOS_API_URL=https://territorios.appestrategia.net/api/v1/territorios'
    printf 'TERRITORIOS_API_CLAVE="%s"\n' "$LLAVE"
  } >> "$DIR/.env"
  echo "Escritas TERRITORIOS_API_URL y TERRITORIOS_API_CLAVE ($(grep -c '^TERRITORIOS_API_' "$DIR/.env") líneas, sin duplicar)."
fi

# ------------------------------------------------------------------- paso 7
paso "7. Reiniciar y comprobar"
if [[ $SIMULAR == 1 ]]; then
  echo "(simular) se correría: bash $ELECTORAL/scripts/reiniciar-instancia.sh $USUARIO_SISTEMA"
else
  bash "$ELECTORAL/scripts/reiniciar-instancia.sh" "$USUARIO_SISTEMA" | sed 's/^/   /'
  PUERTO=$(sed -n 's/^[[:space:]]*PORT[[:space:]]*=[[:space:]]*\([0-9]\{2,5\}\).*/\1/p' "$DIR/.env" | head -1)
  [[ -n "$PUERTO" ]] || { echo "No pude leer PORT del .env para comprobar."; exit 1; }
  CODIGO=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "http://127.0.0.1:$PUERTO/login.html" || true)
  [[ "$CODIGO" =~ ^(200|302|304)$ ]] || { echo "La campaña contestó $CODIGO en el puerto $PUERTO."; exit 1; }
  echo "La campaña responde en el puerto $PUERTO (HTTP $CODIGO)."
fi

# -------------------------------------------------------------------- final
PASO='final'
trap - ERR
echo
echo "================= LISTO ================="
if [[ $SIMULAR == 1 ]]; then
  echo "Era una simulación: no se escribió nada."
  echo "Para hacerlo de verdad:  bash $0"
  exit 0
fi
mysql -h 127.0.0.1 -P 3306 -u root -N -B -e "
  SELECT CONCAT('  territorios que ve la campaña: ', COUNT(*)) FROM \`$BASE_CAMPANA\`.territorios;
  SELECT CONCAT('  la tabla vieja se conservó: ', COUNT(*)) FROM information_schema.TABLES
   WHERE TABLE_SCHEMA='$BASE_CAMPANA' AND TABLE_NAME='territorios_local';"
echo "  respaldo de la base: $RESPALDO_BD"
echo "  respaldo del .env:   $RESPALDO_ENV"
echo
echo "CÓMO VOLVER ATRÁS (en este orden):"
echo "  1. mysql -h 127.0.0.1 -u root -p '$BASE_CAMPANA' -e \"DROP VIEW territorios; RENAME TABLE territorios_local TO territorios;\""
echo "  2. cp '$RESPALDO_ENV' '$DIR/.env'"
echo "  3. bash $ELECTORAL/scripts/reiniciar-instancia.sh $USUARIO_SISTEMA"
echo "  Si además hay que deshacer el reapuntado de los territorio_id:"
echo "     mysql -h 127.0.0.1 -u root -p '$BASE_CAMPANA' < '$RESPALDO_BD'"
echo "  (ese respaldo es de ANTES de todo; restaurarlo deshace también lo demás.)"
echo
echo "En el navegador: Ctrl+F5 en la campaña."
unset MYSQL_PWD
