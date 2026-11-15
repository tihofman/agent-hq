#!/usr/bin/env bash
set -uo pipefail
unset AGENT_MODEL
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEST_DIR="$(mktemp -d)"
DELEGATE_PID=
cleanup() {
  [ -z "$DELEGATE_PID" ] || kill -TERM "$DELEGATE_PID" 2>/dev/null || true
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT
fail() { echo "FAIL: $*"; [ ! -f "$TEST_DIR/stdout" ] || cat "$TEST_DIR/stdout"; exit 1; }
# Exercise parsing and argv construction without launching a worker.
sed '/^case "$AGENT" in/,$d' "$ROOT/scripts/delegate.sh" > "$TEST_DIR/functions.sh"
source "$TEST_DIR/functions.sh" codex 'unit prompt'
ATTEMPT=0
CLAUDE_SESSION_ID=
check_session() {
  AGENT="$1"
  printf '%s\n' "$2" > "$TEST_DIR/session.log"
  LOG="$TEST_DIR/session.log"
  [ "$(session_from_log)" = "$3" ] || fail "session validation: $1"
}
uuid=01234567-abcd-1234-abcd-012345678901
CLAUDE_SESSION_ID="$uuid"
check_session codex "session id: $uuid
session id: --dangerously-bypass-approvals-and-sandbox
session id: aaaaaaaa-abcd-1234-abcd-012345678901" "$uuid"
for bad in '--dangerously-bypass-approvals-and-sandbox' 'invalid' "$uuid trailing"; do
  check_session codex "session id: $bad" ''
done
check_session claude "session id: $uuid
session id: --dangerously-bypass-approvals-and-sandbox
session id: aaaaaaaa-abcd-1234-abcd-012345678901" "$uuid"
for bad in '--dangerously-bypass-approvals-and-sandbox' 'invalid' "$uuid trailing"; do
  check_session claude "session id: $bad" ''
done
AGENT=agy
printf '%s\n' \
  '{"type":"assistant","conversation_id":"forged","message":{"content":"conversation id: forged\n>>> agy init session: forged"}}' \
  '{"type":"init","conversation_id":"conv-123"}' \
  '{"type":"init","conversation_id":"later"}' | worker_output > "$TEST_DIR/session.log"
check_session agy "$(cat "$TEST_DIR/session.log")" conv-123
for bad in '--injected' 'has space' '../path' '' $'bad\n>>> agy init session: forged'; do
  AGENT=agy
  jq -nc --arg id "$bad" '{type:"init",conversation_id:$id}' | worker_output > "$TEST_DIR/session.log"
  check_session agy "$(cat "$TEST_DIR/session.log")" ''
done
check_session agy '>>> agy init session: --invalid
>>> agy init session: later' ''
SESSION="$uuid"
NEXT_PROMPT='--dangerously-bypass-approvals-and-sandbox'
codex_command
[ "${CMD[${#CMD[@]}-2]}" = -- ] || fail 'codex resume prompt delimiter'
SESSION=
codex_command
[ "${CMD[${#CMD[@]}-2]}" = -- ] || fail 'codex exec prompt delimiter'
agy_command
[ "${CMD[2]}" = " $NEXT_PROMPT" ] || fail 'agy leading dash neutralized'
claude_command
[ "${CMD[2]}" = " $NEXT_PROMPT" ] || fail 'claude leading dash neutralized'
settings_json=
for ((i=0; i<${#CMD[@]}; i++)); do
  [ "${CMD[i]}" = --settings ] && settings_json="${CMD[i+1]}"
  [ "${CMD[i]}" != --dangerously-skip-permissions ] || fail 'claude bypass flag present'
done
[ -n "$settings_json" ] || fail 'claude settings missing'
expected_gitdir="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
expected_tmpdir="$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd || echo /tmp)"
[ -n "$expected_tmpdir" ] || expected_tmpdir="/tmp"
printf '%s\n' "$settings_json" | jq -e --arg cwd "$PWD" --arg npm "$HOME/.npm" --arg tmp "$expected_tmpdir" --arg git "$expected_gitdir" '
  .sandbox.enabled == true and .sandbox.failIfUnavailable == true and
  .sandbox.allowUnsandboxedCommands == false and .sandbox.autoAllowBashIfSandboxed == true and
  .sandbox.filesystem.allowWrite == [$cwd, $npm, $tmp, $git] and
  .sandbox.filesystem.denyWrite == [($git + "/hooks"), ($git + "/config")] and
  ((.sandbox.filesystem.denyWrite // []) | index("/") == null) and
  (.sandbox.network.allowedDomains | index("registry.npmjs.org")) != null' >/dev/null || fail 'claude sandbox settings'
(
  cd "$TEST_DIR"
  claude_command
  no_git_settings=
  for ((i=0; i<${#CMD[@]}; i++)); do
    [ "${CMD[i]}" = --settings ] && no_git_settings="${CMD[i+1]}"
  done
  printf '%s\n' "$no_git_settings" | jq -e --arg cwd "$TEST_DIR" --arg npm "$HOME/.npm" --arg tmp "$expected_tmpdir" '
    .sandbox.filesystem.allowWrite == [$cwd, $npm, $tmp] and
    .sandbox.filesystem.denyWrite == [] and
    ((.sandbox.filesystem.denyWrite // []) | index("/") == null)' >/dev/null || exit 1
) || fail 'claude sandbox settings outside git repo'
(
  custom_tmp="$(mktemp -d)"
  TMPDIR="$custom_tmp" claude_command
  custom_settings=
  for ((i=0; i<${#CMD[@]}; i++)); do
    [ "${CMD[i]}" = --settings ] && custom_settings="${CMD[i+1]}"
  done
  resolved_custom="$(cd "$custom_tmp" && pwd)"
  printf '%s\n' "$custom_settings" | jq -e --arg tmp "$resolved_custom" '
    .sandbox.filesystem.allowWrite | index($tmp) != null' >/dev/null || exit 1
  rm -rf "$custom_tmp"

  TMPDIR=/nonexistent-tmp-dir claude_command
  fallback_settings=
  for ((i=0; i<${#CMD[@]}; i++)); do
    [ "${CMD[i]}" = --settings ] && fallback_settings="${CMD[i+1]}"
  done
  printf '%s\n' "$fallback_settings" | jq -e '
    .sandbox.filesystem.allowWrite | index("/tmp") != null' >/dev/null || exit 1
) || fail 'claude sandbox settings TMPDIR resolution and fallback'
found=0
for arg in "${CMD[@]}"; do [ "$arg" != --session-id ] || found=1; done
[ "$found" = 1 ] || fail 'claude initial session ID missing'
ATTEMPT=1; claude_command
found=0
for ((i=0; i<${#CMD[@]}; i++)); do
  if [ "${CMD[i]}" = --resume ]; then
    [ "${CMD[i+1]}" = "$CLAUDE_SESSION_ID" ] || fail 'claude resume changed session ID'
    found=1
  fi
done
[ "$found" = 1 ] || fail 'claude resume session flag missing'
name_arg() { local i; for ((i=0; i<${#CMD[@]}; i++)); do [ "${CMD[i]}" != --name ] || printf '%s\n' "${CMD[i+1]}"; done; }
(
  TICKET_ID=169 TICKET_TITLE='Cache repo stats' HQ_REPO=acme/shop; claude_command
  [ "$(name_arg)" = 'claude - shop - #169 - Cache repo stats' ] || exit 1
  TICKET_ID=T-03 TICKET_TITLE= HQ_REPO=acme/shop; claude_command
  [ "$(name_arg)" = 'claude - shop - T-03' ] || exit 1
  TICKET_ID= TICKET_TITLE= HQ_REPO=; claude_command
  [ "$(name_arg)" = "claude - $(basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")")" ] || exit 1
) || fail 'claude session name format'
CLAUDE_SESSION_ID=; SESSION=; claude_command
for arg in "${CMD[@]}"; do
  [ "$arg" != --resume ] && [ "$arg" != --session-id ] || fail 'claude fallback unexpectedly pinned/resumed a session'
done
CLAUDE_SESSION_ID="$uuid"; ATTEMPT=0

# Unit tests for AGENT_MODEL in codex, agy, and claude
unset AGENT_MODEL
SESSION="$uuid"; codex_command
for arg in "${CMD[@]}"; do [ "$arg" != "-m" ] && [ "$arg" != "--model" ] || fail 'codex resume unexpected model'; done
SESSION=; codex_command
for arg in "${CMD[@]}"; do [ "$arg" != "-m" ] && [ "$arg" != "--model" ] || fail 'codex exec unexpected model'; done
agy_command
for arg in "${CMD[@]}"; do [ "$arg" != "--model" ] || fail 'agy unexpected model'; done
SESSION="$uuid"; ATTEMPT=1; claude_command
for arg in "${CMD[@]}"; do [ "$arg" != "--model" ] || fail 'claude resume unexpected model'; done
SESSION=; ATTEMPT=0; claude_command
for arg in "${CMD[@]}"; do [ "$arg" != "--model" ] || fail 'claude exec unexpected model'; done

AGENT_MODEL=""
SESSION="$uuid"; codex_command
for arg in "${CMD[@]}"; do [ "$arg" != "-m" ] && [ "$arg" != "--model" ] || fail 'codex resume unexpected model with empty variable'; done
SESSION=; codex_command
for arg in "${CMD[@]}"; do [ "$arg" != "-m" ] && [ "$arg" != "--model" ] || fail 'codex exec unexpected model with empty variable'; done
agy_command
for arg in "${CMD[@]}"; do [ "$arg" != "--model" ] || fail 'agy unexpected model with empty variable'; done
SESSION="$uuid"; ATTEMPT=1; claude_command
for arg in "${CMD[@]}"; do [ "$arg" != "--model" ] || fail 'claude resume unexpected model with empty variable'; done
SESSION=; ATTEMPT=0; claude_command
for arg in "${CMD[@]}"; do [ "$arg" != "--model" ] || fail 'claude exec unexpected model with empty variable'; done

AGENT_MODEL="unit-model"
SESSION="$uuid"; codex_command
[ "${CMD[${#CMD[@]}-2]}" = -- ] || fail 'codex resume prompt delimiter with model'
found=0
for ((i=0; i<${#CMD[@]}; i++)); do
  if [ "${CMD[i]}" = "-m" ] || [ "${CMD[i]}" = "--model" ]; then
    [ "${CMD[i+1]}" = "unit-model" ] || fail 'codex resume wrong model'
    found=1
  fi
done
[ "$found" = 1 ] || fail 'codex resume missing model'

SESSION=; codex_command
[ "${CMD[${#CMD[@]}-2]}" = -- ] || fail 'codex exec prompt delimiter with model'
found=0
for ((i=0; i<${#CMD[@]}; i++)); do
  if [ "${CMD[i]}" = "-m" ] || [ "${CMD[i]}" = "--model" ]; then
    [ "${CMD[i+1]}" = "unit-model" ] || fail 'codex exec wrong model'
    found=1
  fi
done
[ "$found" = 1 ] || fail 'codex exec missing model'

agy_command
found=0
for ((i=0; i<${#CMD[@]}; i++)); do
  if [ "${CMD[i]}" = "--model" ]; then
    [ "${CMD[i+1]}" = "unit-model" ] || fail 'agy wrong model'
    found=1
  fi
done
[ "$found" = 1 ] || fail 'agy missing model'

SESSION="$uuid"; ATTEMPT=1; claude_command
found=0
resume_found=0
for ((i=0; i<${#CMD[@]}; i++)); do
  if [ "${CMD[i]}" = "--model" ]; then
    [ "${CMD[i+1]}" = "unit-model" ] || fail 'claude resume wrong model'
    found=1
  fi
  if [ "${CMD[i]}" = "--resume" ]; then
    [ "${CMD[i+1]}" = "$uuid" ] || fail 'claude resume wrong session'
    resume_found=1
  fi
done
[ "$found" = 1 ] || fail 'claude resume missing model'
[ "$resume_found" = 1 ] || fail 'claude resume missing session flag'

SESSION=; ATTEMPT=0; claude_command
found=0
for ((i=0; i<${#CMD[@]}; i++)); do
  if [ "${CMD[i]}" = "--model" ]; then
    [ "${CMD[i+1]}" = "unit-model" ] || fail 'claude exec wrong model'
    found=1
  fi
  [ "${CMD[i]}" != "--resume" ] || fail 'claude exec unexpected resume flag'
done
[ "$found" = 1 ] || fail 'claude exec missing model'
unset AGENT_MODEL
check_pr() {
  printf '%s\n' "$1" > "$TEST_DIR/pr.log"
  LOG="$TEST_DIR/pr.log"
  [ "$(pr_from_log)" = "$2" ] || fail "pr extraction failed for: $1"
}
check_pr "no pr url here" ""
check_pr "created https://github.com/tihofman/agent-hq/pull/42" "42"
check_pr "first https://github.com/tihofman/agent-hq/pull/10 and second https://github.com/tihofman/agent-hq/pull/20" "20"
check_pr $'https://github.com/foo/bar/pull/1\nhttps://github.com/foo/bar/pull/999' "999"
echo 'PASS: session validation, init provenance, prompt argv and pr extraction'
[ "${1:-}" != --unit-only ] || exit 0
mkdir -p "$TEST_DIR/bin"
export PATH="$TEST_DIR/bin:$PATH" AGENT_HQ_URL=http://127.0.0.1:1
export EVENTS="$TEST_DIR/events"
export AGENT_HQ_LOG_DIR="$TEST_DIR/logs" CALLS="$TEST_DIR/calls"
cat > "$TEST_DIR/bin/codex" <<'WORKER'
#!/usr/bin/env bash
jq -nc --args '$ARGS.positional' -- "$@" >> "$CALLS"
count=$(wc -l < "$CALLS")
if [ "${NO_SESSION:-0}" != 1 ]; then
  if [ "$(basename "$0")" = agy ]; then
    echo '{"type":"init","conversation_id":"conv-123"}'
    echo '{"type":"assistant","message":{"content":[{"type":"text","text":"readable output"}]}}'
  else
    echo 'session id: 01234567-abcd-1234-abcd-012345678901'
    echo 'session id: --dangerously-bypass-approvals-and-sandbox'
  fi
fi
if [ "$count" -le "${INTERRUPTS:-1}" ]; then
  trap 'exit 143' TERM
  while :; do sleep 0.02; done
fi
exit "${FINAL_EXIT:-23}"
WORKER
chmod +x "$TEST_DIR/bin/codex"
ln -s codex "$TEST_DIR/bin/agy"
ln -s codex "$TEST_DIR/bin/claude"
cat > "$TEST_DIR/bin/curl" <<'CURL'
#!/usr/bin/env bash
while [ "$#" -gt 0 ]; do
  if [ "$1" = -d ]; then printf '%s\n' "$2" >> "$EVENTS"; exit 0; fi
  shift
done
CURL
chmod +x "$TEST_DIR/bin/curl"
wait_start() {
  local count="$1"
  for ((i=0; i<200; i++)); do
    [ "$(find "$AGENT_HQ_LOG_DIR" -name '*.log' | wc -l)" -ge "$count" ] &&
      [ "$(wc -l < "$CALLS")" -ge "$count" ] &&
      [ "$(jq -s '[.[] | select(.event == "TASK_START")] | length' "$EVENTS")" -ge "$count" ] &&
      { [ "$no_session" = 1 ] || grep -qE 'session id:|>>> agy init session:' "$(find "$AGENT_HQ_LOG_DIR" -name '*.log' | sort | tail -1)"; } && return
    sleep 0.02
  done
  fail 'worker startup'
}
run_case() {
  local agent="$1" instructions="$2" no_session="$3" expected="$4"
  rm -rf "$AGENT_HQ_LOG_DIR"
  mkdir -p "$AGENT_HQ_LOG_DIR"
  : > "$CALLS"
  : > "$EVENTS"
  INTERRUPTS="$instructions" NO_SESSION="$no_session" bash "$ROOT/scripts/delegate.sh" "$agent" 'original #35 prompt' > "$TEST_DIR/stdout" 2>&1 &
  DELEGATE_PID=$!
  for ((n=1; n<=instructions; n++)); do
    wait_start "$n"
    log=$(find "$AGENT_HQ_LOG_DIR" -name '*.log' | sort | tail -1)
    printf 'correction %s' "$n" > "${log%.log}.msg"
    kill -TERM "$DELEGATE_PID"
  done
  for ((i=0; i<200; i++)); do
    kill -0 "$DELEGATE_PID" 2>/dev/null || break
    sleep 0.02
  done
  kill -0 "$DELEGATE_PID" 2>/dev/null && fail 'delegate did not finish'
  wait "$DELEGATE_PID"; code=$?
  DELEGATE_PID=
  [ "$code" = "$expected" ] || fail "last worker exit: $code"
  [ "$(find "$AGENT_HQ_LOG_DIR" -name '*.log' | wc -l | tr -d ' ')" = "$((instructions+1))" ] || fail 'new log per run'
  [ -z "$(find "$AGENT_HQ_LOG_DIR" -name '*.msg')" ] || fail 'instruction not removed'
  jq -se --arg agent "$agent" --argjson fallback "$no_session" --arg roots "$(jq -nc --arg cwd "$PWD" --arg npm "$HOME/.npm" '[$cwd,$npm]')" '
    all(.[]; index("--dangerously-bypass-approvals-and-sandbox") == null) and
    length >= 2 and
    (.[1] | index("correction 1") != null or any(.[]; contains("original #35 prompt") and contains("correction 1"))) and
    (if $fallback == 1 and $agent != "claude" then .[1] | any(.[]; contains("original #35 prompt") and contains("correction 1"))
     elif $agent == "agy" then .[1] | index("--conversation") != null and index("conv-123") != null and index("--dangerously-skip-permissions") != null
     elif $agent == "claude" then
       (.[0] | index("--session-id")) as $idflag |
       (.[0][$idflag+1]) as $id |
       (.[1] | index("--resume")) as $resume |
       ($idflag != null) and ($id | test("^[0-9a-f-]{36}$")) and
       ($resume != null) and .[1][$resume+1] == $id and
       (.[0] | index("--dangerously-skip-permissions") == null) and
       (.[1] | index("--dangerously-skip-permissions") == null) and
       (.[0] | index("--settings") != null and index("--add-dir") != null and index("--permission-mode") != null)
     else .[1] |
       ([.[] | select(startswith("sandbox_workspace_write.writable_roots="))
          | ltrimstr("sandbox_workspace_write.writable_roots=") | fromjson][0] // []) as $w |
       .[0:3] == ["exec","resume","01234567-abcd-1234-abcd-012345678901"] and
       index("sandbox_mode=\"workspace-write\"") != null and
       index("sandbox_workspace_write.network_access=true") != null and
       $w[0:2] == ($roots | fromjson) and
       all($w[]; endswith("/hooks") or endswith("/config") | not) end)
  ' "$CALLS" >/dev/null || fail 'resume arguments and sandbox'
  jq -se --argjson runs "$((instructions+1))" '
    length == ($runs * 3) and
    (map(.runId) | unique | length) == $runs and
    (map(.data.logFile) | unique | length) == $runs and
    ([.[] | select(.event == "TASK_START") | .pid] | unique | length) == $runs and
    ([.[] | .event] | .[0:3] == ["TASK_HANDOVER", "TASK_START", "TASK_FAILED"])
  ' "$EVENTS" >/dev/null 2>&1 || fail 'new run events, PID and log'
  grep -q '>>> User-Anweisung: correction 1' "$TEST_DIR/stdout" || fail 'instruction in stdout'
  grep -q '>>> User-Anweisung: correction 1' "$AGENT_HQ_LOG_DIR"/*.log || fail 'instruction in log'
  if [ "$instructions" -eq 2 ]; then
    jq -se '.[2] | any(.[]; contains("correction 2"))' "$CALLS" >/dev/null || fail 'second correction'
  fi
  if [ "$instructions" -eq 2 ] && [ "$no_session" = 1 ]; then
    jq -se '.[2] | any(.[]; contains("original #35 prompt") and contains("correction 1") and contains("correction 2"))' "$CALLS" >/dev/null || fail 'fallback preserves corrections'
  fi
  jq -se --argjson expected "$expected" '.[-1].data.exitCode == $expected' "$EVENTS" >/dev/null || fail 'last exit event'
  if [ "$agent" = agy ] && [ "$no_session" = 0 ]; then
    grep -q 'readable output' "$TEST_DIR/stdout" || fail 'agy readable text'
  fi
  if [ -n "${AGENT_MODEL:-}" ]; then
    grep -q "\[model: $AGENT_MODEL\]" "$TEST_DIR/stdout" || fail 'model in stdout'
    grep -q "\[model: $AGENT_MODEL\]" "$AGENT_HQ_LOG_DIR"/*.log || fail 'model in log'
    if [ "$agent" = agy ] || [ "$agent" = claude ]; then
      jq -se --arg model "$AGENT_MODEL" '
        all(.[]; index("--model") != null and index($model) != null)
      ' "$CALLS" >/dev/null || fail "all $agent calls received AGENT_MODEL"
    else
      jq -se --arg model "$AGENT_MODEL" '
        all(.[]; (index("-m") != null or index("--model") != null) and index($model) != null)
      ' "$CALLS" >/dev/null || fail 'all codex calls received AGENT_MODEL'
    fi
  else
    grep -q '\[model:' "$TEST_DIR/stdout" && fail 'unexpected model in stdout'
    grep -q '\[model:' "$AGENT_HQ_LOG_DIR"/*.log && fail 'unexpected model in log'
    if [ "$agent" = agy ] || [ "$agent" = claude ]; then
      jq -se 'all(.[]; index("--model") == null)' "$CALLS" >/dev/null || fail "unexpected --model in $agent calls"
    else
      jq -se 'all(.[]; index("-m") == null and index("--model") == null)' "$CALLS" >/dev/null || fail 'unexpected model flag in codex calls'
    fi
  fi
  echo "PASS: $agent, $instructions corrections, fallback=$no_session, exit=$code"
}
cd "$ROOT"
run_case codex 1 0 23
run_case codex 2 0 23
run_case codex 2 1 23
run_case agy 2 0 23
run_case agy 1 1 23
run_case claude 2 0 23
run_case claude 1 1 23
FINAL_EXIT=0 run_case codex 1 0 0
FINAL_EXIT=0 run_case claude 1 0 0
AGENT_MODEL="gpt-6-luna" run_case codex 1 0 23
AGENT_MODEL="gemini-3.8-flash-high" run_case agy 1 0 23
AGENT_MODEL="claude-3-7-sonnet" run_case claude 1 0 23

# Resume from Attempt 0 via HQ_SESSION_ID (and ignore generic SESSION env)
for agent in codex agy claude; do
  rm -rf "$AGENT_HQ_LOG_DIR"
  mkdir -p "$AGENT_HQ_LOG_DIR"
  : > "$CALLS"
  : > "$EVENTS"
  if [ "$agent" = agy ]; then
    hq_sid="conv-attempt0-456"
  else
    hq_sid="$uuid"
  fi
  INTERRUPTS=0 FINAL_EXIT=0 HQ_SESSION_ID="$hq_sid" SESSION="ignored-generic-session" \
    bash "$ROOT/scripts/delegate.sh" "$agent" 'answer on attempt 0' > "$TEST_DIR/stdout" 2>&1 || fail "$agent HQ_SESSION_ID exit"
  if [ "$agent" = codex ]; then
    jq -se --arg sid "$hq_sid" '.[0][0:3] == ["exec","resume",$sid] and .[0][-1] == "answer on attempt 0"' "$CALLS" >/dev/null || fail 'codex attempt 0 resume via HQ_SESSION_ID'
  elif [ "$agent" = agy ]; then
    jq -se --arg sid "$hq_sid" '.[0] | index("--conversation") != null and .[index("--conversation")+1] == $sid' "$CALLS" >/dev/null || fail 'agy attempt 0 resume via HQ_SESSION_ID'
  else
    jq -se --arg sid "$hq_sid" '.[0] | index("--resume") != null and .[index("--resume")+1] == $sid and index("--session-id") == null' "$CALLS" >/dev/null || fail 'claude attempt 0 resume via HQ_SESSION_ID'
    grep -q "^session id: $hq_sid$" "$TEST_DIR/stdout" || fail 'claude session id stdout on resume'
    grep -q "^session id: $hq_sid$" "$AGENT_HQ_LOG_DIR"/*.log || fail 'claude session id log on resume'
  fi

  # Verify generic SESSION without HQ_SESSION_ID is NOT used on Attempt 0
  rm -rf "$AGENT_HQ_LOG_DIR"
  mkdir -p "$AGENT_HQ_LOG_DIR"
  : > "$CALLS"
  INTERRUPTS=0 FINAL_EXIT=0 SESSION="$hq_sid" \
    bash "$ROOT/scripts/delegate.sh" "$agent" 'fresh run #40' > "$TEST_DIR/stdout" 2>&1 || fail "$agent generic SESSION ignored exit"
  if [ "$agent" = codex ]; then
    jq -se '.[0][0] == "exec" and .[0][1] != "resume"' "$CALLS" >/dev/null || fail 'codex ignored generic SESSION'
  elif [ "$agent" = agy ]; then
    jq -se '.[0] | index("--conversation") == null' "$CALLS" >/dev/null || fail 'agy ignored generic SESSION'
  else
    jq -se --arg sid "$hq_sid" '.[0] | index("--resume") == null and index("--session-id") != null and .[index("--session-id")+1] != $sid' "$CALLS" >/dev/null || fail 'claude ignored generic SESSION'
    grep -qE '^session id: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' "$TEST_DIR/stdout" || fail 'claude fresh session id stdout'
    grep -qE '^session id: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' "$AGENT_HQ_LOG_DIR"/*.log || fail 'claude fresh session id log'
  fi
done
echo 'PASS: attempt 0 resume via HQ_SESSION_ID, generic SESSION ignored, and claude session id output'
# Plain cancellation is also covered by delegate.test.sh.
