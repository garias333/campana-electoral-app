#!/usr/bin/env bash
#
# PUBLICA LA GUÍA DE LA PALETA DONDE TODAS LAS CUENTAS PUEDAN LEERLA.
#
# POR QUÉ UNA COPIA Y NO UN ENLACE. El enlace simbólico era la idea buena y no
# funciona: la carpeta de electoral está cerrada a las demás cuentas
# (`other::---`), así que el enlace resolvería y la lectura fallaría con
# «Permission denied». Para que sirviera habría que reabrir esa carpeta — que
# es deshacer el cierre del 23 de agosto por una comodidad. No vale la pena.
#
# ENTONCES HAY DOS COPIAS, Y ESO SIEMPRE TERMINA MAL: una se actualiza, la
# otra no, y nada avisa. Este guion no lo evita —no puede—, lo vuelve
# DETECTABLE: sin argumentos compara las dos y dice si la compartida se quedó
# atrás. Correrlo cuesta un segundo y quita la duda.
#
#   bash scripts/sincronizar-paleta-compartida.sh              # compara
#   sudo bash scripts/sincronizar-paleta-compartida.sh --publicar
#
set -uo pipefail

cd "$(dirname "$0")/.."
ORIGEN="$PWD/scripts/paleta-navy-instrucciones.md"
DESTINO=/usr/local/share/estrategia/paleta-navy.md

[[ -r "$ORIGEN" ]] || { echo "No encuentro $ORIGEN" >&2; exit 1; }

huella() { sha256sum "$1" 2>/dev/null | cut -c1-16; }

PUBLICAR=0
[[ "${1:-}" == "--publicar" ]] && PUBLICAR=1

if [[ $PUBLICAR -eq 1 ]]; then
  [[ $EUID -eq 0 ]] || { echo "Publicar necesita root: sudo bash $0 --publicar" >&2; exit 1; }
  install -d -m 755 "$(dirname "$DESTINO")"
  install -m 644 "$ORIGEN" "$DESTINO"
  echo "Publicada en $DESTINO"
  echo
fi

echo "  origen     $(huella "$ORIGEN")  $ORIGEN"
if [[ -e "$DESTINO" ]]; then
  echo "  compartida $(huella "$DESTINO")  $DESTINO"
else
  echo "  compartida (no existe)      $DESTINO"
fi
echo

if [[ ! -e "$DESTINO" ]]; then
  echo "Todavía no está publicada. Para publicarla:"
  echo "   sudo bash $0 --publicar"
  exit 1
fi

if [[ "$(huella "$ORIGEN")" == "$(huella "$DESTINO")" ]]; then
  echo "Iguales. Las demás aplicaciones están leyendo la guía al día."
  # Se comprueba que de verdad se pueda LEER desde afuera, no sólo que exista:
  # un archivo publicado con permisos mal puestos se ve en el listado y no se
  # abre, que es la misma clase de fallo silencioso que este guion evita.
  PERM=$(stat -c '%A' "$DESTINO")
  [[ "${PERM:7:1}" == "r" ]] || echo "OJO: $DESTINO no es legible por otras cuentas ($PERM)."
  exit 0
fi

echo "DISTINTAS: la copia compartida se quedó atrás."
echo "Las demás aplicaciones están leyendo una guía vieja. Para ponerla al día:"
echo "   sudo bash $0 --publicar"
exit 2
