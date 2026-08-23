#!/usr/bin/env bash
#
# CIERRA EL CÓDIGO DEL SERVIDOR A LAS DEMÁS CUENTAS DEL VPS.
#
# QUÉ ARREGLA. Hoy `routes/` y `config/` de cada instalación tienen permiso de
# lectura para «otros» —cualquiera de las 30 cuentas con shell de esta máquina—.
# Ahora mismo nadie llega, porque la carpeta de la casa está cerrada más arriba,
# así que el riesgo es LATENTE, no activo. El problema es que depende de que esa
# puerta de arriba siga cerrada, y CloudPanel reajusta permisos por su cuenta al
# recrear o migrar un sitio, sin avisar. Esto lo cierra en el propio archivo, que
# es donde debe estar cerrado.
#
# QUÉ NO TOCA. `public/` se queda como está: es lo que el navegador tiene que
# poder leer, y cambiarlo puede romper el servicio de archivos estáticos.
# Tampoco `node_modules` (es código ajeno y público) ni `.well-known` (lo usa la
# renovación del certificado). Cerrar lo que ya es público no protege nada y sí
# puede tumbar algo.
#
# HACE FALTA ROOT. Cada archivo pertenece al usuario de su sitio, y sólo el
# dueño o root pueden cambiarle los permisos. Una cuenta de desarrollo no basta,
# aunque pueda escribir en la carpeta.
#
#   sudo bash scripts/cerrar-permisos-codigo.sh --simular   # muestra y no toca
#   sudo bash scripts/cerrar-permisos-codigo.sh             # aplica
#
set -euo pipefail

SIMULAR=0
[[ "${1:-}" == "--simular" ]] && SIMULAR=1

INSTALACIONES=(
  /home/appestrategia-electoral/htdocs/electoral.appestrategia.net
  /home/campanadepruebamunicipal/htdocs/campanadepruebamunicipal.appestrategia.net
  /home/campanadepruebadepartamental/htdocs/campanadepruebadepartamental.appestrategia.net
  /home/appestrategia-licencias/htdocs/licencias.appestrategia.net
)

# Lo que se deja como está, por las razones de la cabecera.
INTOCABLES=(public node_modules .well-known)

if [[ $EUID -ne 0 ]]; then
  echo "Hay que correrlo como root: sudo bash $0 ${1:-}" >&2
  exit 1
fi

TOTAL=0
for RAIZ in "${INSTALACIONES[@]}"; do
  if [[ ! -d "$RAIZ" ]]; then
    echo "  (no existe, se salta) $RAIZ"
    continue
  fi
  echo "== $(basename "$RAIZ")"

  # Se cuenta ANTES para poder decir cuánto cambió de verdad, en vez de
  # informar "listo" sin saber si había algo que hacer.
  ANTES=$(find "$RAIZ" -maxdepth 1 -mindepth 1 \
            $(printf "! -name %s " "${INTOCABLES[@]}") \
            -exec find {} -perm -o=r -print \; 2>/dev/null | wc -l)

  for HIJO in "$RAIZ"/* "$RAIZ"/.[!.]*; do
    [[ -e "$HIJO" ]] || continue
    NOMBRE=$(basename "$HIJO")
    SALTAR=0
    for I in "${INTOCABLES[@]}"; do [[ "$NOMBRE" == "$I" ]] && SALTAR=1; done
    [[ $SALTAR -eq 1 ]] && { printf "   .  %-24s se deja abierto a propósito\n" "$NOMBRE"; continue; }

    N=$(find "$HIJO" -perm -o=r 2>/dev/null | wc -l)
    [[ "$N" -eq 0 ]] && continue
    if [[ $SIMULAR -eq 1 ]]; then
      printf "   ~  %-24s %s elemento(s) quedarían cerrados\n" "$NOMBRE" "$N"
    else
      chmod -R o-rwx "$HIJO"
      printf "   ✓  %-24s %s elemento(s) cerrados\n" "$NOMBRE" "$N"
    fi
    TOTAL=$((TOTAL + N))
  done

  if [[ $SIMULAR -eq 0 ]]; then
    DESPUES=$(find "$RAIZ" -maxdepth 1 -mindepth 1 \
                $(printf "! -name %s " "${INTOCABLES[@]}") \
                -exec find {} -perm -o=r -print \; 2>/dev/null | wc -l)
    echo "   -> legibles por otros: $ANTES antes, $DESPUES ahora"
  fi
done

echo
if [[ $SIMULAR -eq 1 ]]; then
  echo "Simulación: no se cambió nada. $TOTAL elemento(s) se cerrarían."
else
  echo "Listo: $TOTAL elemento(s) cerrados a las demás cuentas del VPS."
  echo "Si algo dejara de funcionar, se revierte con: chmod -R o+rX <carpeta>"
fi
