#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

PORT="${PORT:-3333}"
HOST="${HOST:-127.0.0.1}"

if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
  echo "Fehler: PORT muss numerisch sein: $PORT" >&2
  exit 1
fi

# 0. Moduswahl: --web (Server im Vordergrund) oder --tui (tmux-Sitzung, siehe ADR 0008)
MODE=
case "${1:-}" in
  --web) MODE=web ;;
  --tui) MODE=tui ;;
  "")
    if [ -t 0 ] || [ "${RUN_SH_ASSUME_TTY:-0}" = "1" ]; then
      printf 'Startmodus [w]eb / [t]ui: ' >&2
      read -r ANSWER || ANSWER=
      case "$ANSWER" in
        t | T | tui) MODE=tui ;;
        w | W | web | "") MODE=web ;;
        *)
          echo "Fehler: unbekannte Auswahl: $ANSWER" >&2
          exit 1
          ;;
      esac
    else
      MODE=web
    fi
    ;;
  *)
    echo "Fehler: unbekannte Option: $1 (erlaubt: --web, --tui)" >&2
    exit 1
    ;;
esac

if [ "$MODE" = "tui" ]; then
  exec bash "$ROOT/scripts/hq-tui.sh"
fi

# 1. Voraussetzungen prüfen (lsof wird für die Port-Prüfung gebraucht)
MISSING_TOOLS=()
for tool in node npm jq gh lsof; do
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
OCCUPYING="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$OCCUPYING" ]; then
  echo "Fehler: Port $PORT ist bereits durch einen anderen Prozess belegt:" >&2
  echo "$OCCUPYING" >&2
  echo "Bitte beende den Prozess oder starte Agent-HQ auf einem freien Port (z.B. PORT=3334 ./run.sh)." >&2
  exit 1
fi

# 3. Docker / Redis (optional für V2 Queue-Architektur)
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "Warnung: Docker läuft nicht oder ist nicht verfügbar. Agent-HQ startet ohne Redis/BullMQ (V2-Features deaktiviert)." >&2
elif [ "${RUN_SH_DRY_RUN:-0}" != "1" ]; then
  echo "Starte Redis via Docker Compose..."
  if ! (cd "$ROOT" && docker compose up -d redis); then
    echo "Warnung: 'docker compose up -d redis' fehlgeschlagen. Server startet ohne Redis." >&2
  else
    # Auf PONG warten mit Timeout (15 Sekunden Standard)
    REDIS_READY=0
    ATTEMPTS=0
    MAX_ATTEMPTS="${RUN_SH_REDIS_ATTEMPTS:-30}"
    SLEEP_INTERVAL="${RUN_SH_REDIS_SLEEP:-0.5}"
    while [ "$ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; do
      PING_OUTPUT="$( (cd "$ROOT" && docker compose exec -T redis redis-cli ping 2>/dev/null) || true)"

      if echo "$PING_OUTPUT" | grep -q "PONG"; then
        REDIS_READY=1
        break
      fi
      sleep "$SLEEP_INTERVAL"
      ATTEMPTS=$((ATTEMPTS + 1))
    done

    if [ "$REDIS_READY" = "1" ]; then
      echo "Redis ist bereit (PONG empfangen)."
    else
      echo "Warnung: Redis hat innerhalb des Timeouts nicht auf PING geantwortet. Server startet trotzdem." >&2
    fi
  fi
fi

# Dry-run Modus für automatisierte Tests (verhindert echten Serverstart)
if [ "${RUN_SH_DRY_RUN:-0}" = "1" ]; then
  echo "Pre-flight-Prüfung für Port $PORT erfolgreich (RUN_SH_DRY_RUN=1)."
  exit 0
fi

# 4. Abhängigkeiten nur installieren, wenn node_modules fehlt
if [ ! -d "$ROOT/node_modules" ]; then
  echo "node_modules nicht vorhanden. Installiere Abhängigkeiten via npm ci..."
  if [ -f "$ROOT/package-lock.json" ]; then
    (cd "$ROOT" && npm ci)
  else
    (cd "$ROOT" && npm install)
  fi
fi

# 5. Prod-Server über nx start agent-hq bauen und starten
echo "Starte Agent-HQ auf http://$HOST:$PORT ..."
export PORT HOST
cd "$ROOT"
exec npx nx start agent-hq
