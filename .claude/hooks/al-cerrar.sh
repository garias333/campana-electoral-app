#!/usr/bin/env bash
# SessionEnd: solo hechos mecánicos. Este evento no tiene control de decisión
# y no puede pedirle un turno al modelo, así que aquí no se genera prosa.
# Presupuesto de tiempo ajustado: mantenerlo rápido.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0
[[ -w ESTADO.md ]] || exit 0

RAMA=$(git branch --show-current 2>/dev/null || echo 'n/d')
COMMIT=$(git log -1 --format='%h %s' 2>/dev/null || echo 'n/d')
SUCIO=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

{
  echo
  echo "---"
  echo "<!-- cierre automático -->"
  echo "Sesión cerrada: $(date '+%Y-%m-%d %H:%M %Z') desde $(hostname)"
  echo "Rama: $RAMA | Commit: $COMMIT | Sin commitear: $SUCIO archivo(s)"
} >> ESTADO.md

exit 0
