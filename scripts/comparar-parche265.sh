#!/usr/bin/env bash
# scripts/comparar-parche265.sh — SOLO LECTURA. Dice, archivo por archivo, si una campaña
# tiene cambios PROPIOS que el parche 265 (PWA para iPhone) pisaría al aplicarse.
#
# SE CORRE COMO ROOT, EN EL SERVIDOR, una vez por campaña (las cuentas normales no pueden
# abrir el sitio de otra campaña).
#
# Uso:
#   bash scripts/comparar-parche265.sh /home/USUARIO/htdocs/DOMINIO [--diff]
#
# Compara el sha256 de cada uno de los 14 archivos con dos huellas incrustadas abajo:
#   · la del 264 (da6959b^): lo que una campaña AL DÍA tiene hoy
#   · la del 265 (da6959b):  lo que dejaría el parche
# y lo clasifica:
#   =264      limpio: el parche lo actualiza y no pisa nada propio
#   =265      ya tiene el cambio
#   AUSENTE   no existe (lo esperable solo para public/app/apple-touch-icon.png, que es nuevo)
#   DISTINTO  no es ni el 264 ni el 265: el parche lo PISARÍA
# Con --diff muestra, para cada DISTINTO, las primeras 40 líneas de `diff -u` contra la
# versión del 265 (sale de parches/campana-parche265.zip, junto a este script).
#
# SI .version-parche DE LA CAMPAÑA ES MENOR QUE 264, un DISTINTO puede ser solo atraso (faltan
# parches anteriores) y no un cambio propio: aplique primero los pendientes y vuelva a correr.
#
# QUÉ NO HACE: no escribe nada, no aplica nada, no reinicia nada, no abre ninguna base y no
# lee el .env. Solo lee los 14 archivos, .version-parche y .version-base.
#
set -u

INST="${1:-}"; DIFF=0; [ "${2:-}" = "--diff" ] && DIFF=1
[ -n "$INST" ] || { echo "Falta la ruta de la campaña. Uso: bash scripts/comparar-parche265.sh /home/USUARIO/htdocs/DOMINIO [--diff]"; exit 1; }
[ -d "$INST" ] || { echo "No existe la carpeta: $INST"; exit 1; }
ZIP="$(cd "$(dirname "$0")/.." && pwd)/parches/campana-parche265.zip"

# huella_264 huella_265 ruta
TABLA='- c346094753566696af4012c5124f0d7aba8822e50fbb86af080c31e002bd0fb3 public/app/apple-touch-icon.png
410a53f63999e31aa5d8b85507bbc67877cdbc31a17ea14f81cc6518d8a9b256 2f0417f97bc93c4172593868114b6d5a646ce85de28e86a01ca5f2428b07ee80 public/app/avance-lideres.html
10b52e952616ecad50a71e552d8d0d201835abedb51319f8852206962c7851ef 45e72bd88e8b659b2ab57592e973d24e4c462a4ead80877e5118eaeb75459c90 public/app/biografia.html
a5deddc6205cab899c6d41218005b501fa24d0dd57d8938be822704ad0699993 e9a52920120abe4563bd30375bb457d91c56a396b08f824fd03091a968fd1d88 public/app/dia-d.html
fc6a0f3da3d6c8efe4a52e3b55f453d64bfd7e8c0de56cf505d79519771908c5 22d7db10f2d90b71c6cdf15b77aee99dc398d9e4efb2192059126036b4a3e43f public/app/estilos-app.css
51cfd418bc2cb3505d5f1422bc17a99ff6cf977007c1f20ea5d8e1bcf3087c9e 4227e08c55c1aad4b8801a9e82214092093989b20f733c439ac576ecbbedd8a3 public/app/informacion.html
e7df504c175cf00f0df1bc4719ff7be203b054c2eda94f5be96ede731bc9358b 1a5c8edaf2f9da4c155600b5a002f8d8cb8b6afada04e9b07d47d96704cca53d public/app/inicio.html
ae9426dc05246549b44b65c4408942873c37c8ebacf390eb1bd4d402aec4da64 a5b251e7bb1a5343b42cfd0dcb7c87aa903246bfdecf67678a6889eed9f4716e public/app/manifest.json
c0b6befe6b8e82b98719f76643e7b9b09da54e4671605e99323c8392230127f8 8d960fd123a3b24e19533e7dbde79cbb5ae565192f6f73b9c1fc0aa5cdd6844e public/app/mis-registros.html
0413e01ac32f395d50372e23db38e73419c48fb2447fd9834da4c218cae12ea3 564477b3d0ff60be4ed4f698994ab753845d3e32377a22007ad94354f10192f6 public/app/politica-privacidad.html
bd35280dd907fd48f70e0b1dfe3c3ee432c44217c34e9866f3447e07754b3c8a ab25cb37a5c14b0e2f0303deede8093b29519759d3085d4482d31fc77cbbee6c public/app/puesto-votacion.html
b5788a11a35a0ca45fe93f27dc3320744329d3b86bbd0075d9f59949e32cc591 f4bd672125042335de40e9848e6dc954e3f4ea227f3f03f0dd8d8438e727337a public/app/registro-votante.html
b9fd0ad93f60d55ff3e75a04692e54773e87507cbe0c1887a576ace8044f19be 102abb5d618a8cff3e32d52a55105b96f5dfc0d300aea67a3a3d0c06ee473bbd public/login.html
21f557827266c52577d8fcfe60ccd51c31e4a45fba3f831d2d5bc306dd4a8bec a0b6190a1089e4a6838432a346ce631e33c2185c0a2d502e8f4118a1c6902f16 public/service-worker.js'

echo "Campaña            : $INST"
echo ".version-parche    : $(tr -d '[:space:]' < "$INST/.version-parche" 2>/dev/null || echo '(no existe)')"
echo ".version-base      : $(tr -d '[:space:]' < "$INST/.version-base" 2>/dev/null || echo '(no existe)')"
echo

limpios=0; ya=0; ausentes=0; distintos=0
while read -r h264 h265 ruta; do
  [ -n "$ruta" ] || continue
  if [ ! -f "$INST/$ruta" ]; then
    estado="AUSENTE"; ausentes=$((ausentes+1))
  else
    h="$(sha256sum "$INST/$ruta" | cut -d' ' -f1)"
    if   [ "$h" = "$h265" ]; then estado="=265"; ya=$((ya+1))
    elif [ "$h" = "$h264" ]; then estado="=264"; limpios=$((limpios+1))
    else estado="DISTINTO"; distintos=$((distintos+1)); fi
  fi
  printf '  %-9s %s\n' "$estado" "$ruta"
  if [ "$estado" = "DISTINTO" ] && [ "$DIFF" = 1 ]; then
    if [ -f "$ZIP" ] && unzip -p "$ZIP" "$ruta" > /tmp/.cmp265.$$ 2>/dev/null; then
      diff -u /tmp/.cmp265.$$ "$INST/$ruta" | head -40 | sed 's/^/      | /'
    else
      echo "      (no se pudo leer $ruta de $ZIP)"
    fi
  fi
done <<< "$TABLA"
rm -f /tmp/.cmp265.$$

echo
echo "Resumen: =264 limpios: $limpios | ya en =265: $ya | ausentes: $ausentes | DISTINTOS: $distintos"
if [ "$distintos" -gt 0 ]; then
  echo "REVISAR: $distintos archivo(s) no coinciden ni con el 264 ni con el 265; el parche los pisaría."
else
  echo "Nada propio que pisar en estos 14 archivos."
fi
echo "(Solo lectura: no se escribió ni se aplicó nada.)"
