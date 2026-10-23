#!/usr/bin/env bash
set -uo pipefail

AGENT="${1:-}"
[ "$#" -eq 0 ] || shift
PROMPT="$*"
if [ -z "$AGENT" ] || [ -z "$PROMPT" ]; then
  echo "Usage: $0 <agy|codex|claude> \"<prompt>\""
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
  local title=""
  if [ "$1" = TASK_HANDOVER ] || [ "$1" = TASK_START ]; then
    title="${TICKET_TITLE:-}"
  fi
  curl --connect-timeout 0.1 --max-time 0.5 -s -X POST "$HQ/api/events" \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg e "$1" --arg a "$AGENT" --arg r "$RUN_ID" --arg t "$TICKET_ID" \
            --arg cwd "$PWD" --arg log "$LOG" --argjson pid "${2:-null}" --argjson code "${3:-null}" \
            --arg pr "$pr" --arg title "$title" \
            '{event:$e, agent:$a, runId:$r, ticketId:$t, pid:$pid, cwd:$cwd,
              data:({logFile:$log, exitCode:$code}
                    + (if $pr != "" and ($pr | test("^[0-9]+$")) then {prNumber:($pr | tonumber)} else {} end)
                    + (if $title != "" then {title:$title} else {} end))}')" \
    >/dev/null 2>&1 || true
}

codex_command() {
  if [ -n "$SESSION" ]; then
    CMD=(codex exec resume "$SESSION")
    [ -z "${AGENT_MODEL:-}" ] || CMD+=(-m "$AGENT_MODEL")
    CMD+=(-c 'sandbox_mode="workspace-write"'
      -c sandbox_workspace_write.network_access=true
      -c "sandbox_workspace_write.writable_roots=$(jq -nc --arg cwd "$PWD" --arg npm "$HOME/.npm" '[$cwd,$npm]')"
      -- "$NEXT_PROMPT")
  else
    CMD=(codex exec)
    [ -z "${AGENT_MODEL:-}" ] || CMD+=(-m "$AGENT_MODEL")
    CMD+=(-s workspace-write -c sandbox_workspace_write.network_access=true --add-dir "$HOME/.npm" -- "$NEXT_PROMPT")
  fi
}

agy_command() {
  local prompt="$NEXT_PROMPT"
  [[ "$prompt" != -* ]] || prompt=" $prompt"
  CMD=(agy -p "$prompt" --dangerously-skip-permissions --output-format stream-json)
  [ -z "${AGENT_MODEL:-}" ] || CMD+=(--model "$AGENT_MODEL")
  [ -z "$SESSION" ] || CMD+=(--conversation "$SESSION")
}

claude_command() {
  local prompt="$NEXT_PROMPT"
  [[ "$prompt" != -* ]] || prompt=" $prompt"
  local gitdir=""
  if git rev-parse --git-common-dir >/dev/null 2>&1; then
    gitdir="$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd)"
  fi
  local tmpdir=""
  tmpdir="$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd || echo /tmp)"
  [ -n "$tmpdir" ] || tmpdir="/tmp"
  local settings
  settings="$(jq -nc --arg cwd "$PWD" --arg npm "$HOME/.npm" --arg tmp "$tmpdir" --arg git "$gitdir" \
    '{sandbox:{enabled:true,failIfUnavailable:true,allowUnsandboxedCommands:false,autoAllowBashIfSandboxed:true,filesystem:{allowWrite:([$cwd,$npm,$tmp]+(if $git != "" then [$git] else [] end)),denyWrite:(if $git != "" then [($git+"/hooks"),($git+"/config")] else [] end)},network:{allowedDomains:["github.com","api.github.com","codeload.github.com","raw.githubusercontent.com","objects.githubusercontent.com","registry.npmjs.org","npmjs.org"]}}}')"
  CMD=(claude -p "$prompt")
  if [ -n "$SESSION" ] || [ "$ATTEMPT" -gt 0 ]; then
    if [ -n "$CLAUDE_SESSION_ID" ]; then
      CMD+=(--resume "$CLAUDE_SESSION_ID")
    elif [ -n "$SESSION" ]; then
      CMD+=(--resume "$SESSION")
    fi
  elif [ "$ATTEMPT" -eq 0 ]; then
    [ -z "$CLAUDE_SESSION_ID" ] || CMD+=(--session-id "$CLAUDE_SESSION_ID")
  fi
  CMD+=(--settings "$settings" --permission-mode acceptEdits --add-dir "$HOME/.npm")
  [ -z "${AGENT_MODEL:-}" ] || CMD+=(--model "$AGENT_MODEL")
}

new_session_id() {
  local id=""
  if command -v uuidgen >/dev/null 2>&1; then
    id="$(uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)"
  fi
  if ! [[ "$id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    if [ -r /proc/sys/kernel/random/uuid ]; then
      id="$(cat /proc/sys/kernel/random/uuid)"
    elif command -v python3 >/dev/null 2>&1; then
      id="$(python3 -c 'import uuid; print(uuid.uuid4())')"
    fi
  fi
  [[ "$id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || return 1
  printf '%s\n' "$id"
}

worker_output() {
  if [ "$AGENT" = codex ] || [ "$AGENT" = claude ]; then
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
  if [ "$AGENT" = codex ] || [ "$AGENT" = claude ]; then
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

ticket_title() {
  local id="${1#\#}"
  if [[ "$id" =~ ^[0-9]+$ ]]; then
    command -v gh >/dev/null 2>&1 || return 0
    local out_file
    out_file="$(mktemp "${TMPDIR:-/tmp}/gh-title.XXXXXX")" || return 0
    local timeout="${DELEGATE_GH_TIMEOUT:-3}"
    (
      set -m
      gh issue view "$id" --json title -q .title > "$out_file" 2>/dev/null &
      local cmd_pid=$!
      (
        sleep "$timeout" &
        local spid=$!
        trap 'kill -9 "$spid" 2>/dev/null; exit 0' TERM INT
        wait "$spid" 2>/dev/null || true
        kill -TERM -"$cmd_pid" 2>/dev/null || kill -TERM "$cmd_pid" 2>/dev/null || true
        sleep 0.1
        kill -KILL -"$cmd_pid" 2>/dev/null || kill -KILL "$cmd_pid" 2>/dev/null || true
      ) 2>/dev/null &
      local timer_pid=$!
      wait "$cmd_pid" 2>/dev/null
      local status=$?
      kill "$timer_pid" 2>/dev/null || true
      wait "$timer_pid" 2>/dev/null || true
      exit "$status"
    ) 2>/dev/null
    local status=$?
    local title=""
    if [ "$status" -eq 0 ] && [ -s "$out_file" ]; then
      title="$(head -n 1 "$out_file" | tr -d '\r')"
      title="${title#"${title%%[![:space:]]*}"}"
      title="${title%"${title##*[![:space:]]}"}"
    fi
    rm -f "$out_file"
    [ -z "$title" ] || printf '%s\n' "$title"
  elif [[ "$id" =~ ^T-[0-9]+$ ]]; then
    for f in docs/tickets/"$id"-*.md docs/tickets/"$id".md; do
      [ -f "$f" ] || continue
      local title
      title="$(grep -m1 '^#\{1,6\}[[:space:]]' "$f" 2>/dev/null | sed -e 's/^#[#[:space:]]*//' -e 's/[[:space:]]*$//' | tr -d '\r')"
      [ -z "$title" ] || printf '%s\n' "$title"
      break
    done
  fi
}

TICKET_TITLE="$(ticket_title "$TICKET_ID")"

case "$AGENT" in
  agy|antigravity|codex|claude) ;;
  *) echo "Unknown agent: $AGENT (must be agy, codex, or claude)" >&2; exit 1 ;;
esac

SESSION="${SESSION:-${HQ_SESSION_ID:-}}"
CLAUDE_SESSION_ID=
if [ "$AGENT" = claude ]; then
  if [ -n "$SESSION" ]; then
    CLAUDE_SESSION_ID="$SESSION"
  else
    CLAUDE_SESSION_ID="$(new_session_id 2>/dev/null || true)"
  fi
fi
NEXT_PROMPT="$PROMPT"
CORRECTIONS=
ATTEMPT=0
while :; do
  RUN_ID="$(date +%s)-$$-$ATTEMPT"
  LOG="$LOG_DIR/$RUN_ID.log"
  MSG="${LOG%.log}.msg"
  case "$AGENT" in
    codex) codex_command ;;
    claude) claude_command ;;
    *) agy_command ;;
  esac
  if [ -n "${AGENT_MODEL:-}" ]; then
    : > "$LOG"
    printf '>>> Dispatching to %s [model: %s] ...\n' "$AGENT" "$AGENT_MODEL" | tee -a "$LOG"
  else
    echo ">>> Dispatching to $AGENT ..."
    : > "$LOG"
  fi
  if [ "$AGENT" = claude ] && [ -n "$CLAUDE_SESSION_ID" ]; then
    printf 'session id: %s\n' "$CLAUDE_SESSION_ID" | tee -a "$LOG"
  fi
  hq_event TASK_HANDOVER
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
  if [ "$AGENT" = claude ] && [ -n "$CLAUDE_SESSION_ID" ]; then
    SESSION="$CLAUDE_SESSION_ID"
  fi
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
