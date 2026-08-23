#!/usr/bin/env bash
# SessionStart: el stdout de este script se agrega al contexto de Claude.
# Redactado como enunciados de hecho, nunca como instrucciones al modelo.
set -uo pipefail

RAIZ="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$RAIZ" || exit 0

echo "## Estado del repositorio"
if git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Rama actual: $(git branch --show-current 2>/dev/null || echo 'detached')"
  echo "Último commit: $(git log -1 --format='%h %s (%cr)' 2>/dev/null)"
  CAMBIOS=$(git status --short 2>/dev/null | head -15)
  if [[ -n "$CAMBIOS" ]]; then
    echo "Hay cambios sin commitear:"
    echo "$CAMBIOS"
  else
    echo "El árbol de trabajo está limpio."
  fi
else
  echo "Este directorio no es un repositorio git."
fi

# Resuelve el proceso PM2 por directorio de trabajo, no por nombre: así
# sobrevive a renombrados y no hay que mantener un mapeo app -> nombre PM2.
if command -v pm2 >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
  PM2_INFO=$(pm2 jlist 2>/dev/null | jq -r --arg d "$RAIZ" '
    .[] | select((.pm2_env.pm_cwd // "") | startswith($d))
        | "\(.name): estado \(.pm2_env.status), \(.pm2_env.restart_time) reinicios, memoria \((.monit.memory // 0) / 1048576 | floor)MB"
  ' 2>/dev/null)
  if [[ -n "$PM2_INFO" ]]; then
    echo
    echo "## Procesos PM2 de esta app"
    echo "$PM2_INFO"
  fi
fi

if [[ -f ESTADO.md ]]; then
  echo
  echo "## Bitácora de la sesión anterior (ESTADO.md)"
  cat ESTADO.md
else
  echo
  echo "No hay ESTADO.md: esta es la primera sesión con bitácora."
fi

exit 0
