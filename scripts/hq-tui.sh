#!/usr/bin/env bash
# Startmodus --tui (ADR 0008, Abschnitt 2): tmux-Sitzung "agent-hq" mit
# TUI-Dashboard (links), Orchestrator claude (rechts) und Server-Log (unten).
# Aufruf über `run.sh --tui`. `hq-tui.sh _server` ist der interne Wrapper
# für das tmux-Fenster "server".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION=agent-hq
PORT="${PORT:-3333}"
HOST="${HOST:-127.0.0.1}"
AGENT_HQ_URL="${AGENT_HQ_URL:-http://$HOST:$PORT}"
SERVER_LOG="${AGENT_HQ_SERVER_LOG:-${TMPDIR:-/tmp}/agent-hq-server.log}"
CALLER_DIR="$PWD"

# Wrapper für das Fenster "server": run.sh --web läuft in einer eigenen
# Prozessgruppe. Endet die tmux-Sitzung (SIGHUP), bekommt die ganze Gruppe
# SIGTERM, damit der Server Worker sauber beendet (sveltekit:shutdown).
if [ "${1:-}" = "_server" ]; then
  set +e -m
  # Ohne nx-TUI bleibt das Log im unteren Pane lesbar.
  NX_TUI=false bash "$ROOT/run.sh" --web &
  SERVER_PID=$!
  stop_server() {
    # nx kann node in einer eigenen Prozessgruppe starten. Der Port war vor dem
    # Start frei, der Listener ist also unser Server.
    LISTENERS="$(lsof -t -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null)"
    kill -TERM -- "-$SERVER_PID" 2>/dev/null
    # shellcheck disable=SC2086
    [ -z "$LISTENERS" ] || kill -TERM $LISTENERS 2>/dev/null
    wait "$SERVER_PID"
    exit 0
  }
  trap stop_server HUP TERM INT
  wait "$SERVER_PID"
  exit $?
fi

q() { printf '%q' "$1"; }

attach() {
  if [ -n "${TMUX:-}" ]; then
    exec tmux switch-client -t "$SESSION"
  fi
  exec tmux attach-session -t "$SESSION"
}

stream_ok() {
  # /api/stream ist SSE und endet nicht. Der HTTP-Code kommt trotz Timeout.
  [ "$(curl -s -o /dev/null --max-time 2 -w '%{http_code}' "$AGENT_HQ_URL/api/stream" 2>/dev/null || true)" = "200" ]
}

skill_installed() {
  local cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  [ -f "$cfg/skills/agent-hq/SKILL.md" ] && return 0
  [ -f "$CALLER_DIR/.claude/skills/agent-hq/SKILL.md" ] && return 0
  [ -f "$cfg/plugins/installed_plugins.json" ] && grep -q '"agent-hq@' "$cfg/plugins/installed_plugins.json"
}

# 1. Voraussetzungen
if ! command -v tmux >/dev/null 2>&1; then
  echo "Fehler: tmux fehlt, wird aber für --tui gebraucht." >&2
  echo "Installieren: brew install tmux (macOS) bzw. sudo apt install tmux (Debian/Ubuntu). Alternativ: ./run.sh --web" >&2
  exit 1
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "tmux-Sitzung $SESSION läuft bereits, hänge mich an."
  attach
fi

MISSING_TOOLS=()
for tool in node npm curl lsof claude; do
  command -v "$tool" >/dev/null 2>&1 || MISSING_TOOLS+=("$tool")
done
if [ ${#MISSING_TOOLS[@]} -gt 0 ]; then
  echo "Fehler: Folgende erforderliche Werkzeuge fehlen im PATH: ${MISSING_TOOLS[*]}" >&2
  exit 1
fi

if [ ! -d "$ROOT/node_modules" ]; then
  echo "node_modules nicht vorhanden. Installiere Abhängigkeiten via npm ci..."
  (cd "$ROOT" && npm ci)
fi

if [ ! -f "$ROOT/dist/apps/agent-hq-tui/main.js" ]; then
  echo "TUI-Build fehlt. Baue agent-hq-tui..."
  (cd "$ROOT" && npx nx run agent-hq-tui:build)
fi

SKILL_HINT=
if ! skill_installed; then
  SKILL_HINT="Hinweis: Der Skill agent-hq fehlt in Claude Code. Installieren mit: npx skills add tihofman/agent-hq (oder in Claude Code: /plugin marketplace add tihofman/agent-hq und /plugin install agent-hq@agent-hq)"
fi

# 2. Server wiederverwenden oder im Fenster "server" starten
START_SERVER=0
if [ -n "$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)" ]; then
  if stream_ok; then
    echo "Nutze laufenden Agent-HQ-Server auf $AGENT_HQ_URL."
  else
    echo "Fehler: Port $PORT ist belegt, aber $AGENT_HQ_URL/api/stream antwortet nicht." >&2
    echo "Bitte beende den Prozess oder wähle einen freien Port (z.B. PORT=3334 ./run.sh --tui)." >&2
    exit 1
  fi
else
  START_SERVER=1
fi

# Laufende tmux-Server vererben ihre eigene Umgebung, deshalb explizit durchreichen.
ENV_ARGS=(-e "PATH=$PATH" -e "PORT=$PORT" -e "HOST=$HOST" -e "AGENT_HQ_URL=$AGENT_HQ_URL")
while IFS= read -r name; do
  ENV_ARGS+=(-e "$name=${!name}")
done < <(compgen -e | grep -E '^(AGENT_HQ_|REDIS_)' | grep -vx 'AGENT_HQ_URL' || true)

TUI_CMD="node $(q "$ROOT/apps/agent-hq-tui/bin/agent-hq-tui.js")"

if [ "$START_SERVER" = "1" ]; then
  : >"$SERVER_LOG"
  tmux new-session -d -s "$SESSION" -n server -c "$ROOT" "${ENV_ARGS[@]}" "bash $(q "$ROOT/scripts/hq-tui.sh") _server"
  tmux pipe-pane -t "$SESSION:server" -o "cat >> $(q "$SERVER_LOG")"
  LOG_CMD="tail -n 200 -F $(q "$SERVER_LOG")"

  echo "Starte Agent-HQ-Server im tmux-Fenster server, warte auf $AGENT_HQ_URL/api/stream ..."
  ATTEMPTS=0
  MAX_ATTEMPTS="${RUN_SH_SERVER_ATTEMPTS:-240}"
  until stream_ok; do
    if ! tmux has-session -t "$SESSION" 2>/dev/null; then
      echo "Fehler: Der Server hat sich beendet. Log: $SERVER_LOG" >&2
      tail -n 20 "$SERVER_LOG" >&2 2>/dev/null || true
      exit 1
    fi
    ATTEMPTS=$((ATTEMPTS + 1))
    if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
      echo "Warnung: Server antwortet noch nicht. Die TUI verbindet sich neu, sobald er läuft." >&2
      break
    fi
    sleep "${RUN_SH_SERVER_SLEEP:-0.5}"
  done
  tmux new-window -d -t "$SESSION" -n hq -c "$CALLER_DIR" "$TUI_CMD"
else
  tmux new-session -d -s "$SESSION" -n hq -c "$CALLER_DIR" "${ENV_ARGS[@]}" "$TUI_CMD"
  LOG_CMD="echo 'Server läuft außerhalb dieser Sitzung, sein Log steht in dessen Terminal.'; exec tail -f /dev/null"
fi

# 3. Layout im Fenster "hq": links TUI, rechts claude, unten Server-Log.
# claude läuft im normalen Berechtigungsmodus, der User sitzt davor.
CLAUDE_PANE="$(tmux split-window -h -P -F '#{pane_id}' -t "$SESSION:hq" -c "$CALLER_DIR" claude)"
tmux split-window -v -f -l 10 -t "$SESSION:hq" -c "$CALLER_DIR" "$LOG_CMD"
tmux select-pane -t "$CLAUDE_PANE"
tmux select-window -t "$SESSION:hq"

if [ -n "$SKILL_HINT" ]; then
  echo "$SKILL_HINT" >&2
  if [ -t 0 ]; then
    read -r -p "Enter zum Fortfahren ... " _ || true
  fi
fi

attach
