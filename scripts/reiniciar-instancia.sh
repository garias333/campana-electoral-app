#!/usr/bin/env bash
# scripts/reiniciar-instancia.sh — reinicia una instancia y COMPRUEBA que
# reinició de verdad.
#
# SE CORRE COMO ROOT, EN EL SERVIDOR:
#   bash scripts/reiniciar-instancia.sh campanadepruebamunicipal 3101
#   bash scripts/reiniciar-instancia.sh campanadepruebadepartamental 3102
#
# ------------------------------------------------------------------------
# POR QUÉ NO BASTA UN «pm2 restart», Y POR QUÉ NO BASTA MIRAR EL PUERTO
#
#   24 de agosto de 2026, dos fallos distintos en el mismo día:
#
#   1. Un `pm2 restart` dejó Electoral caída 3 m 51 s. PM2 tenía el intérprete
#      anotado como `node` a secas y lo resuelve por PATH; al respawnear falló
#      con «spawn node EACCES». Y `pm2 list` decía **online**, con pid `N/A` y
#      0 b de memoria: un estado roto con cara de sano.
#
#   2. La primera versión de este script preguntaba al PUERTO para no
#      depender de PM2… y cayó en la trampa simétrica. En la campaña
#      departamental el `pm2 restart` falló en silencio —esa cuenta no carga
#      nvm en un shell de login, así que no tiene `pm2` ni `node` en el
#      PATH—, el proceso viejo siguió sirviendo tan campante, el puerto
#      respondió 200 y el script informó «OK». Se descubrió comparando la
#      edad del proceso con la del archivo: 9.634 s contra 130 s.
#
#   LA LECCIÓN DE LAS DOS: «responde» no es «reinició». Lo único que prueba
#   un reinicio es que EL PID CAMBIÓ. Eso es lo que se comprueba aquí, y por
#   eso todo lo demás —PATH, intérprete, rutas absolutas— existe: para que
#   ese pid pueda cambiar en cuentas donde el perfil no ayuda.
# ------------------------------------------------------------------------
set -u

USUARIO="${1:?Falta el usuario de la instancia (ej. campanadepruebamunicipal)}"
PUERTO="${2:?Falta el puerto (ej. 3101)}"
DIR="/home/$USUARIO/htdocs/$USUARIO.appestrategia.net"

[ -d "$DIR" ] || { echo "No existe $DIR"; exit 1; }
[ "$(id -u)" = "0" ] || { echo "Esto se corre como root: cada instancia tiene su propio PM2."; exit 1; }

pid_actual() { pgrep -f "$DIR/app.js" | head -1; }
responde()   { curl -s -o /dev/null --max-time 5 "http://127.0.0.1:$PUERTO/login.html"; }

PID_ANTES="$(pid_actual)"
echo "pid antes: ${PID_ANTES:-ninguno (la instancia está caída)}"

# --- La ruta absoluta de node de ESA cuenta -----------------------------
# Cada instancia tiene su propio nvm y pueden estar en versiones distintas
# (medido: electoral v22.23.1, municipal v24.18.1). Se busca de más fiable a
# menos; `su - ... command -v node` va de ÚLTIMO porque es justo el que falló
# en la departamental: exige que el perfil cargue nvm en un shell de login no
# interactivo, y no todas las cuentas lo hacen.
NODEBIN=""; ORIGEN=""
if [ -n "$PID_ANTES" ]; then
  CAND="$(readlink -f "/proc/$PID_ANTES/exe" 2>/dev/null)"
  [ -n "$CAND" ] && [ -x "$CAND" ] && { NODEBIN="$CAND"; ORIGEN="del proceso vivo"; }
fi
if [ -z "$NODEBIN" ]; then
  # `sort -V` ordena por versión, no alfabéticamente: sin él v9 ganaría a v22.
  CAND="$(ls -d /home/"$USUARIO"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)"
  [ -n "$CAND" ] && [ -x "$CAND" ] && { NODEBIN="$CAND"; ORIGEN="del nvm de la cuenta"; }
fi
if [ -z "$NODEBIN" ]; then
  CAND="$(su - "$USUARIO" -c 'command -v node' 2>/dev/null)"
  [ -n "$CAND" ] && [ -x "$CAND" ] && { NODEBIN="$CAND"; ORIGEN="del perfil de la cuenta"; }
fi
[ -n "$NODEBIN" ] || { echo "No encuentro un node ejecutable para $USUARIO."; exit 1; }
BIN="$(dirname "$NODEBIN")"
echo "node: $NODEBIN ($ORIGEN)"

# PM2 vive junto a node en el mismo nvm. Se invoca por ruta absoluta Y con
# PATH puesto: la ruta absoluta es para poder llamarlo, y el PATH para que ÉL
# pueda encontrar node al arrancar el proceso hijo.
PM2BIN="$BIN/pm2"
[ -x "$PM2BIN" ] || { echo "No hay pm2 ejecutable en $BIN. ¿Está PM2 instalado en ese nvm?"; exit 1; }
como_usuario() { su -s /bin/bash - "$USUARIO" -c "export PATH='$BIN:\$PATH'; cd '$DIR' && $*" 2>&1; }

echo "Reiniciando…"
como_usuario "'$PM2BIN' restart all" | tail -3
sleep 6

PID_DESPUES="$(pid_actual)"
if [ -n "$PID_DESPUES" ] && [ "$PID_DESPUES" != "${PID_ANTES:-}" ] && responde; then
  echo "OK: pid $PID_ANTES -> $PID_DESPUES y el puerto $PUERTO responde."
  exit 0
fi

echo "El pid no cambió (sigue ${PID_DESPUES:-ninguno}). Recreando el proceso con el intérprete absoluto…"
NOMBRE="$(como_usuario "'$PM2BIN' jlist" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)"
NOMBRE="${NOMBRE:-campana-app}"
echo "  proceso PM2: $NOMBRE"
como_usuario "'$PM2BIN' delete '$NOMBRE'" > /dev/null

# SI EL PROCESO VIEJO SIGUE VIVO, EL PUERTO SIGUE OCUPADO.
#
# Pasa cuando PM2 no lo estaba gestionando de verdad (se levantó por otra
# vía, o su daemon perdió el rastro — el mismo pid `N/A` que se vio en
# Electoral). Sin esto, el `pm2 start` de abajo muere con EADDRINUSE y el
# mensaje no dice nada de la causa real: parece un puerto mal configurado.
if [ -n "${PID_ANTES:-}" ] && kill -0 "$PID_ANTES" 2>/dev/null; then
  echo "  el proceso viejo ($PID_ANTES) sigue vivo tras el delete; deteniéndolo"
  kill "$PID_ANTES" 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$PID_ANTES" 2>/dev/null || break
    sleep 1
  done
  kill -0 "$PID_ANTES" 2>/dev/null && { echo "  no se detuvo; no sigo a ciegas."; exit 1; }
fi

como_usuario "'$PM2BIN' start app.js --name '$NOMBRE' --interpreter '$NODEBIN'" | tail -3
sleep 6

PID_FINAL="$(pid_actual)"
if [ -n "$PID_FINAL" ] && [ "$PID_FINAL" != "${PID_ANTES:-}" ] && responde; then
  # `pm2 save` DESPUÉS de comprobar, nunca antes: guardar un estado roto es
  # lo que haría que el próximo reinicio del VPS repitiera el fallo.
  como_usuario "'$PM2BIN' save" > /dev/null
  echo "OK: recreado con intérprete absoluto (pid $PID_FINAL) y guardado."
  exit 0
fi

echo "SIGUE SIN REINICIAR. Mire el log:"
echo "  su -s /bin/bash - $USUARIO -c \"$PM2BIN logs --lines 40 --nostream\""
exit 1
