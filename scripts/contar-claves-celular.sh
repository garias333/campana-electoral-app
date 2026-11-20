#!/usr/bin/env bash
# scripts/contar-claves-celular.sh — QUIÉN PODRÁ ENTRAR POR LOS BOTONES DEL CELULAR en cada campaña, por rol (orden 67, parche 345).
#
# SE CORRE COMO ROOT, EN EL SERVIDOR (esta cuenta no puede leer las bases de las campañas):
#   bash scripts/contar-claves-celular.sh
# Pide la clave de root de MySQL (por TCP, como en el resto del proyecto: -h 127.0.0.1). Solo CUENTA: no muestra cédulas ni nombres y no escribe nada.
#
# Recorre TODA base que tenga las tablas usuarios, roles y estructura (las campañas y la Base). Por cada base y por cada ROL DE BOTÓN
# (lider, sublider, aspirante_concejo, testigo, coordinador, usuario, invitado) que tenga usuarios ACTIVOS, una fila con:
#   activos         usuarios con ese rol y activo = 1
#   sin_cedula      de ésos, los que no tienen número de identificación: NO podrán entrar por el botón (la clave sale de la cédula)
#   cedula_corta    de ésos, los que la tienen con 1 a 5 dígitos: entran, con la clave rellenada con ceros (12345 → 012345)
#   podran_entrar   cédula de 6 dígitos o más
# Un rol sin usuarios activos no sale. (Antes de aplicar el 345 las columnas de la clave no existen: esta cuenta solo mira usuarios.numero_identificacion.)
# MYSQL_CMD sirve para probarlo con otro usuario: MYSQL_CMD="mysql -h 127.0.0.1 -u usuario -N -B" MYSQL_PWD=... bash scripts/contar-claves-celular.sh
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
  sql+="SELECT '$b' AS base, rol, COUNT(*) AS activos, COALESCE(SUM(d = 0),0) AS sin_cedula,
         COALESCE(SUM(d BETWEEN 1 AND 5),0) AS cedula_corta, COALESCE(SUM(d >= 6),0) AS podran_entrar
        FROM (SELECT r.nombre AS rol, CHAR_LENGTH(REGEXP_REPLACE(COALESCE(u.numero_identificacion,''),'[^0-9]','')) AS d
                FROM \`$b\`.usuarios u JOIN \`$b\`.roles r ON r.id = u.rol_id
               WHERE r.nombre IN ('lider','sublider','aspirante_concejo','testigo','coordinador','usuario','invitado') AND u.activo = 1) t_$b
       GROUP BY rol"
done
sql="SELECT * FROM ($sql) todos ORDER BY base, FIELD(rol,'lider','sublider','aspirante_concejo','testigo','coordinador','usuario','invitado')"
printf '%-36s %-18s %8s %11s %13s %14s\n' base rol activos sin_cedula cedula_corta podran_entrar
$MYSQL_CMD -e "$sql" | awk -F'\t' '{printf "%-36s %-18s %8s %11s %13s %14s\n", $1, $2, $3, $4, $5, $6}'
