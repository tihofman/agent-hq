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
LOG_DIR="${AGENT_HQ_LOG_DIR:-${TMPDIR:-/tmp}/agent-hq}"
mkdir -p "$LOG_DIR" || exit 1

hq_event() { # <event> [pid] [exitCode]
  curl --connect-timeout 0.1 --max-time 0.5 -s -X POST "$HQ/api/events" \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg e "$1" --arg a "$AGENT" --arg r "$RUN_ID" --arg t "$TICKET_ID" \
            --arg cwd "$PWD" --arg log "$LOG" --argjson pid "${2:-null}" --argjson code "${3:-null}" \
            '{event:$e, agent:$a, runId:$r, ticketId:$t, pid:$pid, cwd:$cwd, data:{logFile:$log, exitCode:$code}}')" \
    >/dev/null 2>&1 || true
}

codex_command() {
  if [ -n "$SESSION" ]; then
    CMD=(codex exec resume "$SESSION"
      -c 'sandbox_mode="workspace-write"'
      -c sandbox_workspace_write.network_access=true
      -c "sandbox_workspace_write.writable_roots=$(jq -nc --arg cwd "$PWD" --arg npm "$HOME/.npm" '[$cwd,$npm]')"
      "$NEXT_PROMPT")
  else
    CMD=(codex exec -s workspace-write -c sandbox_workspace_write.network_access=true --add-dir "$HOME/.npm" "$NEXT_PROMPT")
  fi
}

agy_command() {
  CMD=(agy -p "$NEXT_PROMPT" --dangerously-skip-permissions --output-format stream-json)
  [ -z "$SESSION" ] || CMD+=(--conversation "$SESSION")
}

worker_output() {
  if [ "$AGENT" = codex ]; then
    cat
  else
    # Keep diagnostics/unknown events verbatim; render assistant text for the tailer.
    jq --unbuffered -Rr '
      . as $raw | try (fromjson |
        (if .conversation_id then "conversation id: \(.conversation_id)" else empty end),
        (if .type == "assistant" and (.message.content | type) == "array" then
          [.message.content[] | select(.type == "text") | .text] | join("\n")
        elif .type == "assistant" and (.message.content | type) == "string" then .message.content
        elif .type == "init" and .conversation_id then empty
        else $raw end)) catch $raw'
  fi
}

case "$AGENT" in
  agy|antigravity|codex) ;;
  *) echo "Unknown agent: $AGENT (must be agy or codex)" >&2; exit 1 ;;
esac

SESSION=
NEXT_PROMPT="$PROMPT"
CORRECTIONS=
ATTEMPT=0
while :; do
  RUN_ID="$(date +%s)-$$-$ATTEMPT"
  LOG="$LOG_DIR/$RUN_ID.log"
  MSG="${LOG%.log}.msg"
  if [ "$AGENT" = codex ]; then codex_command; else agy_command; fi
  echo ">>> Dispatching to $AGENT ..."
  hq_event TASK_HANDOVER
  : > "$LOG"
  if [ "$ATTEMPT" -gt 0 ]; then
    printf '>>> User-Anweisung: %s\n' "$INSTRUCTION" | tee -a "$LOG"
  fi

  # Wait for the output reader too, so session discovery sees the complete log.
  exec 3> >(worker_output | tee -a "$LOG")
  OUTPUT_PID=$!
  "${CMD[@]}" >&3 2>&1 &
  PID=$!
  exec 3>&-
  trap 'kill -TERM "$PID" 2>/dev/null || true' TERM INT
  hq_event TASK_START "$PID"

  wait "$PID"; CODE=$?
  # A signal interrupts wait before the worker has necessarily exited.
  while kill -0 "$PID" 2>/dev/null; do wait "$PID"; CODE=$?; done
  wait "$OUTPUT_PID" || true

  if [ "$CODE" -eq 0 ]; then
    hq_event TASK_COMPLETE "$PID" 0
  else
    hq_event TASK_FAILED "$PID" "$CODE"
  fi
  [ -f "$MSG" ] || break
  INSTRUCTION="$(cat "$MSG")"
  rm -f "$MSG"
  [ -n "$INSTRUCTION" ] || break
  FOUND_SESSION="$(sed -nE 's/^[[:space:]]*(session id|conversation id):[[:space:]]*([^[:space:]]+).*$/\2/p' "$LOG" | tail -1)"
  [ -z "$FOUND_SESSION" ] || SESSION="$FOUND_SESSION"
  CORRECTIONS="${CORRECTIONS}
$INSTRUCTION"
  if [ -n "$SESSION" ]; then
    NEXT_PROMPT="$INSTRUCTION"
  else
    NEXT_PROMPT="${PROMPT}
${CORRECTIONS}"
  fi
  ATTEMPT=$((ATTEMPT + 1))
done
exit "$CODE"
