#!/usr/bin/env bash
set -uo pipefail

AGENT="${1:-}"
[ "$#" -eq 0 ] || shift
PROMPT="$*"
if [ -z "$AGENT" ] || [ -z "$PROMPT" ]; then
  echo "Usage: $0 <agy|codex> \"<prompt>\""
  exit 1
fi

HQ="${AGENT_HQ_URL:-http://127.0.0.1:3333}"
TICKET_ID="${TICKET_ID:-$(grep -oE '#[0-9]+|T-[0-9]+' <<<"$PROMPT" | head -n1 | tr -d '#' || true)}"
RUN_ID="$(date +%s)-$$"
LOG_DIR="${TMPDIR:-/tmp}/agent-hq"
LOG="$LOG_DIR/$RUN_ID.log"
mkdir -p "$LOG_DIR" || exit 1

hq_event() { # <event> [pid] [exitCode]
  curl --connect-timeout 0.1 --max-time 0.5 -s -X POST "$HQ/api/events" \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg e "$1" --arg a "$AGENT" --arg r "$RUN_ID" --arg t "$TICKET_ID" \
            --arg cwd "$PWD" --arg log "$LOG" --argjson pid "${2:-null}" --argjson code "${3:-null}" \
            '{event:$e, agent:$a, runId:$r, ticketId:$t, pid:$pid, cwd:$cwd, data:{logFile:$log, exitCode:$code}}')" \
    >/dev/null 2>&1 || true
}

case "$AGENT" in
  agy|antigravity) CMD=(agy -p "$PROMPT" --dangerously-skip-permissions) ;;
  codex) CMD=(codex exec -s workspace-write -c sandbox_workspace_write.network_access=true --add-dir "$HOME/.npm" "$PROMPT") ;;
  *) echo "Unknown agent: $AGENT (must be agy or codex)" >&2; exit 1 ;;
esac

echo ">>> Dispatching to $AGENT ..."
hq_event TASK_HANDOVER

"${CMD[@]}" > >(tee "$LOG") 2>&1 &
PID=$!
trap 'kill -TERM "$PID" 2>/dev/null || true' TERM INT
hq_event TASK_START "$PID"

wait "$PID"; CODE=$?
# A signal interrupts wait before the worker has necessarily exited.
while kill -0 "$PID" 2>/dev/null; do wait "$PID"; CODE=$?; done

if [ "$CODE" -eq 0 ]; then
  hq_event TASK_COMPLETE "$PID" 0
else
  hq_event TASK_FAILED "$PID" "$CODE"
fi
exit "$CODE"
