#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEST_DIR="$(mktemp -d)"
DELEGATE_PID=
cleanup() {
  [ -z "$DELEGATE_PID" ] || kill -TERM "$DELEGATE_PID" 2>/dev/null || true
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT
fail() { echo "FAIL: $*"; cat "$TEST_DIR/stdout"; exit 1; }
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
      { [ "$no_session" = 1 ] || grep -qE 'session id:|conversation id:' "$(find "$AGENT_HQ_LOG_DIR" -name '*.log' | sort | tail -1)"; } && return
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
    length >= 2 and
    (.[1] | index("correction 1") != null or any(.[]; contains("original #35 prompt") and contains("correction 1"))) and
    (if $fallback == 1 then .[1] | any(.[]; contains("original #35 prompt") and contains("correction 1"))
     elif $agent == "agy" then .[1] | index("--conversation") != null and index("conv-123") != null and index("--dangerously-skip-permissions") != null
     else .[1] | .[0:3] == ["exec","resume","01234567-abcd-1234-abcd-012345678901"] and
       index("sandbox_mode=\"workspace-write\"") != null and
       index("sandbox_workspace_write.network_access=true") != null and
       index("sandbox_workspace_write.writable_roots=" + $roots) != null end)
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
  echo "PASS: $agent, $instructions corrections, fallback=$no_session, exit=$code"
}
cd "$ROOT"
run_case codex 1 0 23
run_case codex 2 0 23
run_case codex 2 1 23
run_case agy 2 0 23
run_case agy 1 1 23
FINAL_EXIT=0 run_case codex 1 0 0
# Plain cancellation is also covered by delegate.test.sh.
