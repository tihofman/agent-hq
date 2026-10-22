#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

PORT="${PORT:-3333}"
HOST="${HOST:-127.0.0.1}"

# 1. Voraussetzungen prüfen (node, npm, jq, gh)
MISSING_TOOLS=()
for tool in node npm jq gh; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    MISSING_TOOLS+=("$tool")
  fi
done

if [ ${#MISSING_TOOLS[@]} -gt 0 ]; then
  echo "Fehler: Folgende erforderliche Werkzeuge fehlen im PATH: ${MISSING_TOOLS[*]}" >&2
  echo "Bitte installiere die fehlenden Werkzeuge und starte das Skript erneut." >&2
  exit 1
fi

# 2. Port-Prüfung
OCCUPYING="$(lsof -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$OCCUPYING" ]; then
  echo "Fehler: Port $PORT ist bereits durch einen anderen Prozess belegt:" >&2
  echo "$OCCUPYING" >&2
  echo "Bitte beende den Prozess oder starte Agent-HQ auf einem freien Port (z.B. PORT=3334 ./run.sh)." >&2
  exit 1
fi

# Dry-run Modus für automatisierte Tests (verhindert echten Serverstart)
if [ "${RUN_SH_DRY_RUN:-0}" = "1" ]; then
  echo "Pre-flight-Prüfung für Port $PORT erfolgreich (RUN_SH_DRY_RUN=1)."
  exit 0
fi

# 3. Abhängigkeiten nur installieren, wenn node_modules fehlt
if [ ! -d "$ROOT/node_modules" ]; then
  echo "node_modules nicht vorhanden. Installiere Abhängigkeiten via npm ci..."
  if [ -f "$ROOT/package-lock.json" ]; then
    (cd "$ROOT" && npm ci)
  else
    (cd "$ROOT" && npm install)
  fi
fi

# 4. Prod-Server über nx start agent-hq bauen und starten
echo "Starte Agent-HQ auf http://$HOST:$PORT ..."
export PORT HOST
cd "$ROOT"
exec npx nx start agent-hq
