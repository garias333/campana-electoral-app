#!/usr/bin/env bash
# scripts/contar-coordinadores.sh — CUÁNTOS COORDINADORES PODRÁN ENTRAR POR EL CELULAR en cada campaña (orden 60, parche 341).
#
# SE CORRE COMO ROOT, EN EL SERVIDOR (esta cuenta no puede leer las bases de las campañas):
#   bash scripts/contar-coordinadores.sh
# Pide la clave de root de MySQL (por TCP, como en el resto del proyecto: -h 127.0.0.1). Solo CUENTA: no muestra cédulas ni nombres y no escribe nada.
#
# Recorre TODA base que tenga las tablas usuarios, roles y estructura (las campañas y la Base). Por cada una:
#   coordinadores_activos       usuarios con rol «coordinador» y activo = 1
#   sin_cedula                  de ésos, los que no tienen número de identificación (no podrán entrar por el celular; sí por correo)
#   cedula_menos_de_6_digitos   de ésos, los que la tienen con 1 a 5 dígitos (entran, con la clave rellenada con ceros: 12345 → 012345)
#   podran_entrar               cédula de 6 dígitos o más
# (Antes de aplicar el 341 las columnas del ingreso no existen: esta cuenta solo mira usuarios.numero_identificacion.)
# MYSQL_CMD sirve para probarlo con otro usuario: MYSQL_CMD="mysql -h 127.0.0.1 -u usuario -N -B" MYSQL_PWD=... bash scripts/contar-coordinadores.sh
set -uo pipefail
if [[ -z "${MYSQL_CMD:-}" ]]; then
  read -rsp "Clave de root de MySQL: " MYSQL_PWD; echo
  export MYSQL_PWD
  MYSQL_CMD="mysql -h 127.0.0.1 -P 3306 -u root -N -B"
fi
bases=$($MYSQL_CMD -e "SELECT table_schema FROM information_schema.tables
  WHERE table_name IN ('usuarios','roles','estructura') AND table_schema NOT IN ('mysql','sys','performance_schema','information_schema')
  GROUP BY table_schema HAVING COUNT(DISTINCT table_name) = 3 ORDER BY table_schema") || { echo "No pude conectarme a MySQL."; exit 1; }
[[ -n "$bases" ]] || { echo "No encontré ninguna base con usuarios, roles y estructura."; exit 1; }
sql=""
for b in $bases; do
  [[ "$b" =~ ^[A-Za-z0-9_]+$ ]] || { echo "Salto la base «$b» (nombre raro)."; continue; }
  [[ -n "$sql" ]] && sql+=" UNION ALL "
  sql+="SELECT '$b' AS base, COUNT(*) AS coordinadores_activos, COALESCE(SUM(d = 0),0) AS sin_cedula,
         COALESCE(SUM(d BETWEEN 1 AND 5),0) AS cedula_menos_de_6_digitos, COALESCE(SUM(d >= 6),0) AS podran_entrar
        FROM (SELECT CHAR_LENGTH(REGEXP_REPLACE(COALESCE(u.numero_identificacion,''),'[^0-9]','')) AS d
                FROM \`$b\`.usuarios u JOIN \`$b\`.roles r ON r.id = u.rol_id
               WHERE r.nombre = 'coordinador' AND u.activo = 1) t_$b"
done
printf '%-40s %10s %10s %10s %10s\n' base coord_activos sin_cedula menos_de_6 podran_entrar
$MYSQL_CMD -e "$sql" | awk -F'\t' '{printf "%-40s %10s %10s %10s %10s\n", $1, $2, $3, $4, $5}'
