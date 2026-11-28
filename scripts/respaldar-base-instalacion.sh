#!/usr/bin/env bash
# scripts/respaldar-base-instalacion.sh — respalda la base de UNA instalación (una campaña
# de cliente) ANTES de aplicarle un parche, toque o no la base de datos (es rutina).
#
# SE CORRE COMO ROOT, EN EL SERVIDOR. NO se corre desde electoral.
#
# Uso:
#   bash scripts/respaldar-base-instalacion.sh /home/USUARIO/htdocs/DOMINIO NUMERO_DE_PARCHE
#   (el número es OBLIGATORIO: va en el nombre del archivo, y uno mal puesto no da error)
#
# Para encontrar la instalación de c001-2027 sin adivinar (solo imprime rutas):
#   grep -l '^DB_NAME=.*c00' /home/*/htdocs/*/.env
#
# QUÉ HACE
#   1. Lee del .env de ESA instalación el nombre de la base, el host y el usuario
#      (la CLAVE no se lee del .env: se pide con read -rs).
#   2. Muestra la ruta y la base y pide ESCRIBIR el nombre de la base para confirmar:
#      un nombre mal copiado respalda la base equivocada y no da error.
#   3. Pide la clave con read -rs (no se ve, no va en la línea de comandos, no se imprime,
#      no se guarda en disco: viaja solo en MYSQL_PWD del proceso mysqldump).
#   4. mysqldump --single-transaction --routines --triggers --no-tablespaces, a
#      <instalación>/backups/<base>_antes-parche<N>_<fecha>_<hora>.sql
#   5. COMPRUEBA EL CONTENIDO, NO EL TAMAÑO: sin --no-tablespaces el dump de un usuario sin
#      el privilegio PROCESS sale con encabezado y sin datos, con un tamaño creíble.
#      Exige CREATE TABLE, INSERT y la línea «-- Dump completed».
#
# QUÉ NO HACE: no escribe en ninguna base, no reinicia nada, no toca el .env.
#
# RESTAURAR (solo si hiciera falta; NO se ejecuta aquí). Primero parar la instalación:
#   mysql -h HOST -u USUARIO -p BASE < ARCHIVO.sql
#
set -u
umask 077

INST="${1:-}"
if [ -z "$INST" ]; then
  echo "Falta la ruta de la instalación."
  echo "Uso: bash scripts/respaldar-base-instalacion.sh /home/USUARIO/htdocs/DOMINIO NUMERO_DE_PARCHE"
  exit 1
fi
# El número de parche rotula el archivo. Antes estaba escrito a fuego («264») y reutilizar el
# guion para otro parche habría dejado un respaldo con el nombre equivocado, sin ningún error.
PARCHE="${2:-}"
if ! [[ "$PARCHE" =~ ^[0-9]+$ ]]; then
  echo "Falta el número del parche (solo dígitos). Uso: bash scripts/respaldar-base-instalacion.sh $INST NUMERO_DE_PARCHE"
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "Esto se corre como root: el .env de otra instalación no es legible para otras cuentas."
  exit 1
fi
INST="${INST%/}"
[ -d "$INST" ] || { echo "No existe la carpeta: $INST"; exit 1; }
[ -f "$INST/.env" ] || { echo "No hay .env en $INST (¿es la carpeta de la instalación?)"; exit 1; }

valor() {   # valor de una variable del .env, sin comillas; NUNCA se usa con DB_PASSWORD
  grep -E "^$1=" "$INST/.env" | head -1 | cut -d= -f2- | sed -E "s/^[\"']//; s/[\"']\$//"
}
BD="$(valor DB_NAME)"; HOST="$(valor DB_HOST)"; PUERTO="$(valor DB_PORT)"; USUARIO="$(valor DB_USER)"
HOST="${HOST:-127.0.0.1}"; PUERTO="${PUERTO:-3306}"
[ -n "$BD" ] && [ -n "$USUARIO" ] || { echo "El .env de $INST no trae DB_NAME o DB_USER."; exit 1; }

echo "Instalación : $INST"
echo "Base        : $BD   (servidor $HOST:$PUERTO)"
read -rp "Para confirmar, escriba el nombre de la base tal cual: " CONFIRMA
[ "$CONFIRMA" = "$BD" ] || { echo "No coincide. No se respaldó nada."; exit 1; }

DESTINO="$INST/backups"
mkdir -p "$DESTINO"
chown --reference="$INST" "$DESTINO" 2>/dev/null || true
ARCH="$DESTINO/${BD}_antes-parche${PARCHE}_$(date +%Y-%m-%d_%H%M%S).sql"

read -rsp "Clave de MySQL de la base $BD (no se ve al escribir): " CLAVE; echo
MYSQL_PWD="$CLAVE" mysqldump -h "$HOST" -P "$PUERTO" -u "$USUARIO" \
  --single-transaction --routines --triggers --no-tablespaces \
  --default-character-set=utf8mb4 "$BD" > "$ARCH"
RC=$?
unset CLAVE

TABLAS=$(grep -ac 'CREATE TABLE' "$ARCH" 2>/dev/null); TABLAS="${TABLAS:-0}"
DATOS=$(grep -ac '^INSERT INTO' "$ARCH" 2>/dev/null); DATOS="${DATOS:-0}"
if [ "$RC" -eq 0 ] && [ "$TABLAS" -gt 0 ] && tail -n 3 "$ARCH" | grep -aq 'Dump completed'; then
  chown --reference="$INST" "$ARCH" 2>/dev/null || true
  chmod 660 "$ARCH"
  echo
  echo "RESPALDO COMPLETO"
  ls -l "$ARCH"
  echo "Tablas (CREATE TABLE): $TABLAS   Líneas de datos (INSERT INTO): $DATOS"
  echo "Disparadores: $(grep -aEc 'CREATE.*TRIGGER' "$ARCH")   Rutinas: $(grep -aEc 'CREATE.*(PROCEDURE|FUNCTION)' "$ARCH")"
  tail -n 2 "$ARCH"
  echo
  echo "Guarde la ruta de arriba: es el punto de retorno si el parche hay que deshacerlo."
else
  mv "$ARCH" "$ARCH.FALLIDO" 2>/dev/null
  echo
  echo "EL RESPALDO FALLÓ (código de mysqldump: $RC, tablas: $TABLAS). No aplique el parche."
  echo "El archivo parcial quedó como: $ARCH.FALLIDO"
  exit 1
fi
