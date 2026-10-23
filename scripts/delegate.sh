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
  local pr=""
  if [ "$1" = TASK_COMPLETE ] || [ "$1" = TASK_FAILED ]; then
    pr="$(pr_from_log)"
  fi
  curl --connect-timeout 0.1 --max-time 0.5 -s -X POST "$HQ/api/events" \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg e "$1" --arg a "$AGENT" --arg r "$RUN_ID" --arg t "$TICKET_ID" \
            --arg cwd "$PWD" --arg log "$LOG" --argjson pid "${2:-null}" --argjson code "${3:-null}" \
            --arg pr "$pr" \
            '{event:$e, agent:$a, runId:$r, ticketId:$t, pid:$pid, cwd:$cwd,
              data:({logFile:$log, exitCode:$code} + (if $pr != "" and ($pr | test("^[0-9]+$")) then {prNumber:($pr | tonumber)} else {} end))}')" \
    >/dev/null 2>&1 || true
}

codex_command() {
  if [ -n "$SESSION" ]; then
    CMD=(codex exec resume "$SESSION"
      -c 'sandbox_mode="workspace-write"'
      -c sandbox_workspace_write.network_access=true
      -c "sandbox_workspace_write.writable_roots=$(jq -nc --arg cwd "$PWD" --arg npm "$HOME/.npm" '[$cwd,$npm]')"
      -- "$NEXT_PROMPT")
  else
    CMD=(codex exec -s workspace-write -c sandbox_workspace_write.network_access=true --add-dir "$HOME/.npm" -- "$NEXT_PROMPT")
  fi
}

agy_command() {
  local prompt="$NEXT_PROMPT"
  [[ "$prompt" != -* ]] || prompt=" $prompt"
  CMD=(agy -p "$prompt" --dangerously-skip-permissions --output-format stream-json)
  [ -z "$SESSION" ] || CMD+=(--conversation "$SESSION")
}

worker_output() {
  if [ "$AGENT" = codex ]; then
    cat
  else
    # Keep diagnostics/unknown events verbatim; render assistant text for the tailer.
    jq --unbuffered -Rr '
      . as $raw | try (fromjson |
        if .type == "init" then
          ">>> agy init session: " +
            (if (.conversation_id | type) == "string" then
              if (.conversation_id | test("^[A-Za-z0-9][A-Za-z0-9_-]*$")) then .conversation_id else "" end
            else "" end)
        else (if .type == "assistant" and (.message.content | type) == "array" then
          [.message.content[] | select(.type == "text") | .text] | join("\n")
        elif .type == "assistant" and (.message.content | type) == "string" then .message.content
        else $raw end) | gsub("(?m)^>>> agy init session:"; " >>> agy init session:")
        end) catch ($raw | gsub("(?m)^>>> agy init session:"; " >>> agy init session:"))'
  fi
}

session_from_log() {
  if [ "$AGENT" = codex ]; then
    grep -m1 -oE '^session id: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' "$LOG" | cut -d ' ' -f3
  else
    # Select the first init marker before validation; never accept a later replacement.
    local id
    id="$(grep '^>>> agy init session: ' "$LOG" | head -1 | cut -d ' ' -f5-)"
    [[ "$id" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] && printf '%s\n' "$id"
  fi
}

pr_from_log() {
  [ -n "${LOG:-}" ] && [ -r "$LOG" ] || return 0
  local num
  num="$(grep -oE 'github\.com/[^/[:space:]]+/[^/[:space:]]+/pull/[0-9]+\b' "$LOG" 2>/dev/null | tail -n1 | sed 's#.*/##' || true)"
  [[ "$num" =~ ^[0-9]+$ ]] && printf '%s\n' "$num"
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
  FIFO_DIR="$(mktemp -d)"
  FIFO="$FIFO_DIR/fifo"
  mkfifo "$FIFO"
  worker_output < "$FIFO" | tee -a "$LOG" &
  OUTPUT_PID=$!
  "${CMD[@]}" > "$FIFO" 2>&1 &
  PID=$!
  trap 'kill -TERM "$PID" 2>/dev/null || true' TERM INT
  hq_event TASK_START "$PID"

  wait "$PID"; CODE=$?
  # A signal interrupts wait before the worker has necessarily exited.
  while kill -0 "$PID" 2>/dev/null; do wait "$PID"; CODE=$?; done
  wait "$OUTPUT_PID" || true
  rm -rf "$FIFO_DIR"

  if [ "$CODE" -eq 0 ]; then
    hq_event TASK_COMPLETE "$PID" 0
  else
    hq_event TASK_FAILED "$PID" "$CODE"
  fi
  [ -f "$MSG" ] || break
  INSTRUCTION="$(cat "$MSG")"
  rm -f "$MSG"
  [ -n "$INSTRUCTION" ] || break
  SESSION="$(session_from_log)"
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
