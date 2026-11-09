#!/usr/bin/env bash
# scripts/contar-coordenadas-votantes.sh — cuenta, en UNA instalación, cuántos votantes tienen latitud y longitud y cuántos no.
# SOLO NÚMEROS: no imprime nombres, direcciones ni nada de ninguna persona.
#
# SE CORRE COMO ROOT, EN EL SERVIDOR (el .env de otra instalación no es legible para otras cuentas). NO se corre desde electoral.
#
# Uso:
#   bash scripts/contar-coordenadas-votantes.sh /home/USUARIO/htdocs/DOMINIO
#
# Para ver las instalaciones sin adivinar (solo imprime rutas):
#   ls -d /home/*/htdocs/*/ | while read d; do [ -f "$d/.env" ] && echo "$d"; done
#
# QUÉ HACE: lee del .env de ESA instalación el nombre de la base, el host y el usuario (la CLAVE no se lee del .env: se pide con read -rs, no se
# imprime ni se guarda) y corre UNA consulta de solo lectura (SELECT COUNT/SUM sobre `votantes`). No escribe en ninguna base, no reinicia nada.
#
# «ACTIVOS»: la tabla `votantes` no tiene columna de estado (activo/inactivo): cada fila es una ficha vigente, así que se cuentan todas.
# Solo se usan columnas que existen desde las primeras versiones, para que sirva también en una campaña que aún no recibe el parche 309.
set -u
umask 077

INST="${1:-}"
if [ -z "$INST" ]; then echo "Falta la ruta de la instalación. Uso: bash scripts/contar-coordenadas-votantes.sh /home/USUARIO/htdocs/DOMINIO"; exit 1; fi
if [ "$(id -u)" -ne 0 ]; then echo "Esto se corre como root: el .env de otra instalación no es legible para otras cuentas."; exit 1; fi
INST="${INST%/}"
[ -d "$INST" ] || { echo "No existe la carpeta: $INST"; exit 1; }
[ -f "$INST/.env" ] || { echo "No hay .env en $INST (¿es la carpeta de la instalación?)"; exit 1; }

valor() { grep -E "^$1=" "$INST/.env" | head -1 | cut -d= -f2- | sed -E "s/^[\"']//; s/[\"']\$//"; }
BD="$(valor DB_NAME)"; HOST="$(valor DB_HOST)"; PUERTO="$(valor DB_PORT)"; USUARIO="$(valor DB_USER)"
HOST="${HOST:-127.0.0.1}"; PUERTO="${PUERTO:-3306}"
[ -n "$BD" ] && [ -n "$USUARIO" ] || { echo "El .env no trae DB_NAME o DB_USER."; exit 1; }

echo "Instalación: $INST"
echo "Base: $BD   usuario: $USUARIO   host: $HOST:$PUERTO"
printf "Escribe el nombre de la base para confirmar: "
read -r CONFIRMA
[ "$CONFIRMA" = "$BD" ] || { echo "No coincide. No se hizo nada."; exit 1; }
printf "Clave de %s (no se ve): " "$USUARIO"
read -rs CLAVE; echo

MYSQL_PWD="$CLAVE" mysql -h "$HOST" -P "$PUERTO" -u "$USUARIO" "$BD" --table -e "
SELECT COUNT(*)                                                                                   AS fichas,
       COALESCE(SUM(latitud IS NOT NULL AND longitud IS NOT NULL), 0)                             AS con_coordenadas,
       COALESCE(SUM(latitud IS NULL OR longitud IS NULL), 0)                                      AS sin_coordenadas,
       COALESCE(SUM((latitud IS NULL OR longitud IS NULL) AND TRIM(COALESCE(direccion,'')) <> ''), 0) AS sin_coord_pero_con_direccion,
       COALESCE(SUM(TRIM(COALESCE(direccion,'')) = ''), 0)                                        AS sin_direccion,
       COALESCE(SUM(consentimiento_autorizado = 1), 0)                                            AS con_autorizacion,
       COALESCE(SUM(consentimiento_autorizado = 1 AND TRIM(COALESCE(direccion,'')) <> ''), 0)     AS autorizadas_con_direccion
  FROM votantes;"
CODIGO=$?
unset CLAVE
exit $CODIGO
