#!/usr/bin/env bash
#
# DEJA EL ZIP DE UN PARCHE EN EL SERVIDOR DE LICENCIAS. NADA MÁS.
#
# Este guion existe para poder autorizar UNA cosa —copiar un archivo de parche—
# sin abrir un permiso amplio de escritura sobre la carpeta de otra aplicación.
# Lo que puede hacer está escrito aquí y se puede leer en un minuto.
#
# LO QUE NO HACE, A PROPÓSITO:
#   · no registra la fila en `parches_disponibles`
#   · no dispara la aplicación en ninguna campaña
#   · no toca ninguna base de datos
# Publicar y aplicar quedan en el panel, que es donde tienen que estar.
#
# Uso:
#   bash scripts/publicar-parche.sh 156
#   bash scripts/publicar-parche.sh 156 --forzar   # sólo para reemplazar uno
#                                                  # que todavía NO se aplicó
#
# ------------------------------------------------------------------------
# POR QUÉ SE NIEGA A PISAR UN PARCHE QUE YA ESTÁ ALLÁ
#
# El 27 de agosto de 2026 se subió el 155, las campañas lo aplicaron y
# `.version-parche` quedó en 155. Después se volvió a subir el 155 con más
# archivos dentro. Ese segundo zip no llegó a ninguna parte y no dio ningún
# error: un número ya aplicado NO se vuelve a ofrecer. Durante un rato pareció
# que las campañas tenían un código que no tenían.
#
# Pisar un número publicado es, en el mejor caso, inútil; en el peor, deja el
# registro mintiendo. Para cambios nuevos, número nuevo.
# ------------------------------------------------------------------------
set -uo pipefail

cd "$(dirname "$0")/.."

NUMERO="${1:?Falta el número del parche. Ej: bash scripts/publicar-parche.sh 156}"
FORZAR=0
[[ "${2:-}" == "--forzar" ]] && FORZAR=1

[[ "$NUMERO" =~ ^[0-9]+$ ]] || { echo "El número del parche debe ser un entero: '$NUMERO'"; exit 1; }

ORIGEN="$PWD/parches/campana-parche${NUMERO}.zip"
DESTINO="/home/appestrategia-licencias/htdocs/licencias.appestrategia.net/parches/parche-${NUMERO}.zip"

[[ -f "$ORIGEN" ]] || {
  echo "No existe $ORIGEN"
  echo "Genéralo primero:  node scripts/generar-parche.js $NUMERO archivo1 archivo2 ..."
  exit 1
}

# Que sea un zip de verdad, no un archivo a medio escribir.
[[ "$(head -c2 "$ORIGEN")" == "PK" ]] || { echo "$ORIGEN no empieza por 'PK': no parece un zip."; exit 1; }

if [[ -e "$DESTINO" && $FORZAR -eq 0 ]]; then
  echo "YA HAY UN parche-${NUMERO}.zip PUBLICADO."
  echo
  echo "  publicado: $(stat -c%s "$DESTINO") bytes, $(stat -c%y "$DESTINO" | cut -c1-19)"
  echo "  local    : $(stat -c%s "$ORIGEN") bytes, $(stat -c%y "$ORIGEN" | cut -c1-19)"
  if [[ "$(sha256sum < "$DESTINO")" == "$(sha256sum < "$ORIGEN")" ]]; then
    echo
    echo "Son el mismo archivo. No hay nada que hacer."
    exit 0
  fi
  echo
  echo "Son DISTINTOS. Si alguna campaña ya aplicó el $NUMERO, este zip nuevo"
  echo "no le va a llegar nunca: un número aplicado no se vuelve a ofrecer."
  echo "Para cambios nuevos, usa el número siguiente."
  echo
  echo "Si estás seguro de que NADIE lo ha aplicado todavía:"
  echo "   bash scripts/publicar-parche.sh $NUMERO --forzar"
  exit 1
fi

# `install -m 644` y no `cp`: una copia hecha como root deja 0660 root:root, sin
# lectura para otros, y el servidor de licencias —que corre como
# appestrategia-licencias— no puede abrirla. `/parches/descargar/N` responde
# entonces HTTP 500 y la campaña reporta el parche como fallido. Ya pasó.
install -m 644 "$ORIGEN" "$DESTINO" || { echo "No se pudo copiar a $DESTINO"; exit 1; }

echo "Publicado: $DESTINO"
ls -l "$DESTINO"
echo
echo "  huella origen  : $(sha256sum "$ORIGEN"  | cut -c1-16)"
echo "  huella destino : $(sha256sum "$DESTINO" | cut -c1-16)"
if [[ "$(sha256sum < "$DESTINO")" != "$(sha256sum < "$ORIGEN")" ]]; then
  echo "  LAS HUELLAS NO COINCIDEN. No lo publiques hasta averiguar por qué."
  exit 1
fi
echo
echo "El archivo está puesto y es legible. FALTA LO QUE NO HACE ESTE GUION:"
echo "  1. Registrarlo en el panel como parche #$NUMERO"
echo "  2. Marcar «toca base de datos» SOLO si el zip trae algo de db/"
echo "  3. Aplicarlo a las campañas desde el panel"
