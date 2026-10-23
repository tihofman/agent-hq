#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEST_DIR="$(mktemp -d)"
SERVER_PID=
DELEGATE_PID=
cleanup() {
  [ -z "$DELEGATE_PID" ] || kill -TERM "$DELEGATE_PID" 2>/dev/null || true
  [ -z "$SERVER_PID" ] || kill "$SERVER_PID" 2>/dev/null || true
  rm -f "$ROOT/docs/tickets/T-89-local-test.md"
  rmdir "$ROOT/docs/tickets" 2>/dev/null || true
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT
fail() { echo "FAIL: $*"; [ ! -f "$TEST_DIR/stdout" ] || cat "$TEST_DIR/stdout"; exit 1; }
pass() { echo "PASS: $*"; }
unset AGENT_MODEL
mkdir -p "$TEST_DIR/bin"
export AGENT_HQ_LOG_DIR="$TEST_DIR/agent-hq"
export TMPDIR="$TEST_DIR" WORKER_PID_FILE="$TEST_DIR/worker.pid"
export PATH="$TEST_DIR/bin:$PATH"
cat > "$TEST_DIR/bin/agy" <<'WORKER'
#!/usr/bin/env bash
printf '%s\n' "$$" > "$WORKER_PID_FILE"
jq -nc --args '$ARGS.positional' -- "$@" >> "$TMPDIR/worker.calls"
echo 'fake worker output'
echo 'fake worker stderr' >&2
if [ "${FAKE_WAIT:-0}" = 1 ]; then
  trap 'echo terminated > "$WORKER_PID_FILE.term"; exit 143' TERM
  while :; do sleep 0.05; done
fi
[ -z "${FAKE_LAST_LINE:-}" ] || echo "$FAKE_LAST_LINE"
exit "${FAKE_EXIT:-0}"
WORKER
chmod +x "$TEST_DIR/bin/agy"
cat > "$TEST_DIR/bin/gh" <<'GH'
#!/usr/bin/env bash
if [ "${FAKE_GH_MODE:-}" = "hang" ]; then
  trap 'exit 143' TERM
  while :; do sleep 0.05; done
elif [ "${FAKE_GH_MODE:-}" = "error" ]; then
  exit 1
elif [ "${FAKE_GH_MODE:-}" = "title" ]; then
  echo "${FAKE_GH_TITLE:-Default Ticket Title}"
  exit 0
fi
exit 1
GH
chmod +x "$TEST_DIR/bin/gh"
cat > "$TEST_DIR/server.cjs" <<'SERVER'
const http = require('node:http');
const fs = require('node:fs');
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    const parsed = JSON.parse(body);
    let logContent = null;
    if (parsed.data && parsed.data.logFile && fs.existsSync(parsed.data.logFile)) {
      logContent = fs.readFileSync(parsed.data.logFile, 'utf8');
    }
    fs.appendFileSync(process.argv[3], JSON.stringify({url:req.url, time:Date.now(), body:parsed, logContent}) + '\n');
    if (process.argv[2] !== 'hang') res.end('ok');
  });
});
server.listen(0, '127.0.0.1', () => fs.writeFileSync(process.argv[4], String(server.address().port)));
SERVER
start_server() {
  : > "$TEST_DIR/events"
  rm -f "$TEST_DIR/port"
  node "$TEST_DIR/server.cjs" "$1" "$TEST_DIR/events" "$TEST_DIR/port" &
  SERVER_PID=$!
  for ((i=0; i<100; i++)); do
    [ ! -s "$TEST_DIR/port" ] || break
    sleep 0.02
  done
  [ -s "$TEST_DIR/port" ] || fail 'test server startup'
  export AGENT_HQ_URL="http://127.0.0.1:$(cat "$TEST_DIR/port")"
}
stop_server() {
  kill "$SERVER_PID"
  wait "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=
}
run_delegate() {
  : > "$TEST_DIR/events"
  bash "$ROOT/scripts/delegate.sh" agy 'Implement #7 "quoted" prompt' > "$TEST_DIR/stdout" 2>&1
  CODE=$?
}
check_events() {
  jq -se --arg last "$1" --argjson code "$2" --argjson pid "$(cat "$WORKER_PID_FILE")" --arg cwd "$ROOT" '
    map(.body) as $e |
    ($e | map(.event)) == ["TASK_HANDOVER", "TASK_START", $last] and
    $e[0].pid == null and $e[1].pid == $pid and $e[2].pid == $pid and
    $e[2].data.exitCode == $code and
    ($e | map(.runId) | unique | length) == 1 and
    all($e[]; .agent == "agy" and .ticketId == "7" and .cwd == $cwd) and
    all(.[]; .url == "/api/events")
  ' "$TEST_DIR/events" >/dev/null || fail 'event order, schema, PID or exit code'
}

cd "$ROOT"
[ -x scripts/delegate.sh ] || fail 'delegate.sh exists and is executable'
for args in '' 'agy' 'unknown prompt'; do
  # Intentional word splitting exercises missing arguments.
  bash scripts/delegate.sh $args > "$TEST_DIR/usage" 2>&1
  [ "$?" = 1 ] || fail "invalid arguments: $args"
done
bash scripts/delegate.sh > "$TEST_DIR/usage" 2>&1
grep -q 'Usage:' "$TEST_DIR/usage" || fail 'usage message'
pass 'argument validation'

start_server respond
export FAKE_EXIT=0
run_delegate
[ "$CODE" = 0 ] || fail 'successful worker exit code'
check_events TASK_COMPLETE 0
LOG="$(jq -sr '.[0].body.data.logFile' "$TEST_DIR/events")"
RUN_ID="$(jq -sr '.[0].body.runId' "$TEST_DIR/events")"
[ "$LOG" = "$TMPDIR/agent-hq/$RUN_ID.log" ] || fail 'per-run log path'
for output in 'fake worker output' 'fake worker stderr'; do
  grep -q "$output" "$LOG" && grep -q "$output" "$TEST_DIR/stdout" || fail 'log and stdout'
done
grep -q '>>> Dispatching to agy' "$TEST_DIR/stdout" || fail 'dispatch message'
pass 'success events, real worker PID, log and stdout'

export FAKE_EXIT=23
run_delegate
[ "$CODE" = 23 ] || fail 'failed worker exit code'
check_events TASK_FAILED 23
[ "$(jq -sr '.[0].body.data.logFile' "$TEST_DIR/events")" != "$LOG" ] || fail 'unique run log'
pass 'failure event and exit-code propagation'

for mode in COMPLETE FAILED; do
  if [ "$mode" = COMPLETE ]; then export FAKE_EXIT=0; else export FAKE_EXIT=42; fi
  export FAKE_LAST_LINE="last worker output before $mode"
  run_delegate
  EVENT="TASK_$mode"
  grep -q 'not a child' "$TEST_DIR/stdout" && fail 'stderr contains "not a child"'
  LAST_LOG="$(jq -sr --arg ev "$EVENT" 'map(select(.body.event == $ev))[-1].logContent // ""' "$TEST_DIR/events")"
  echo "$LAST_LOG" | grep -q "last worker output before $mode" || fail "log missing last output before $EVENT"
done
unset FAKE_LAST_LINE
pass 'log contains last worker output before TASK_COMPLETE/TASK_FAILED and no "not a child" on stderr'

export FAKE_EXIT=0
export FAKE_LAST_LINE="Draft PR created: https://github.com/tihofman/agent-hq/pull/42"
run_delegate
[ "$CODE" = 0 ] || fail 'successful worker exit code with PR'
jq -se '
  map(.body) as $e |
  $e[0].data.prNumber == null and
  $e[1].data.prNumber == null and
  $e[2].data.prNumber == 42 and
  ($e[2].data.prNumber | type == "number")
' "$TEST_DIR/events" >/dev/null || fail 'single prNumber extracted as number'

export FAKE_LAST_LINE="$(printf 'First: https://github.com/tihofman/agent-hq/pull/11\nSecond: https://github.com/tihofman/agent-hq/pull/99')"
run_delegate
[ "$CODE" = 0 ] || fail 'successful worker exit code with multiple PRs'
jq -se '
  map(.body) as $e |
  $e[2].data.prNumber == 99 and
  ($e[2].data.prNumber | type == "number")
' "$TEST_DIR/events" >/dev/null || fail 'last prNumber extracted when multiple URLs present'

export FAKE_EXIT=7
export FAKE_LAST_LINE="Failed after opening https://github.com/tihofman/agent-hq/pull/55"
run_delegate
[ "$CODE" = 7 ] || fail 'failed worker exit code with PR'
jq -se '
  map(.body) as $e |
  $e[2].data.exitCode == 7 and
  $e[2].data.prNumber == 55 and
  ($e[2].data.prNumber | type == "number")
' "$TEST_DIR/events" >/dev/null || fail 'prNumber extracted on TASK_FAILED'

unset FAKE_LAST_LINE
export FAKE_EXIT=0
run_delegate
jq -se '
  map(.body) as $e |
  all($e[]; .data | has("prNumber") | not)
' "$TEST_DIR/events" >/dev/null || fail 'no prNumber when log has no PR URL'

export FAKE_LAST_LINE="https://github.com/o/r/pull/new/some-branch"
run_delegate
[ "$CODE" = 0 ] || fail 'successful worker exit code with PR creation URL'
check_events TASK_COMPLETE 0
jq -se '
  map(.body) | .[2].data | has("prNumber") | not
' "$TEST_DIR/events" >/dev/null || fail 'no prNumber for PR creation URL'
unset FAKE_LAST_LINE
pass 'prNumber extraction: hit, no hit, multiple URLs, TASK_FAILED and PR creation URL'

: > "$TEST_DIR/events"
rm -f "$WORKER_PID_FILE"
FAKE_WAIT=1 bash scripts/delegate.sh agy 'Implement #7' > "$TEST_DIR/stdout" 2>&1 &
DELEGATE_PID=$!
for ((i=0; i<100; i++)); do
  [ "$(wc -l < "$TEST_DIR/events")" -lt 2 ] || break
  sleep 0.02
done
[ "$(wc -l < "$TEST_DIR/events")" -ge 2 ] || fail 'worker startup before signal'
kill -TERM "$DELEGATE_PID"
# Bound the wait so broken signal forwarding fails instead of hanging CI.
for ((i=0; i<100; i++)); do
  kill -0 "$DELEGATE_PID" 2>/dev/null || break
  sleep 0.02
done
if kill -0 "$DELEGATE_PID" 2>/dev/null; then
  kill -KILL "$(cat "$WORKER_PID_FILE")" 2>/dev/null || true
  fail 'SIGTERM did not stop worker'
fi
wait "$DELEGATE_PID"; CODE=$?
DELEGATE_PID=
[ "$CODE" = 143 ] && [ -f "$WORKER_PID_FILE.term" ] || fail 'SIGTERM forwarding and exit code'
kill -0 "$(cat "$WORKER_PID_FILE")" 2>/dev/null && fail 'worker still alive'
check_events TASK_FAILED 143
pass 'SIGTERM reaches worker and reports its exit code'
stop_server

export FAKE_EXIT=0
now() { node -e 'console.log(Date.now())'; }
START="$(now)"
run_delegate
ELAPSED=$(( $(now) - START ))
# Allow slow CI scheduling, but reject any 5 s hang.
[ "$CODE" = 0 ] && [ "$ELAPSED" -lt 4000 ] || fail "server absent (${ELAPSED}ms, exit $CODE)"
pass 'absent server does not delay worker'

start_server hang
START="$(now)"
run_delegate
END="$(now)"
[ "$CODE" = 0 ] || fail 'hanging server changed worker exit'
node - "$TEST_DIR/events" "$START" "$END" <<'CHECK' || fail 'hanging server timeout'
const fs = require('node:fs');
const events = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
const times = events.map(e => e.time).concat(Number(process.argv[4]));
// Allow slow CI scheduling around curl's 0.5 s cap, but reject any 5 s hang.
if (events.length !== 3 || times.some((t, i) => i && t-times[i-1] > 4000) ||
    Number(process.argv[4])-Number(process.argv[3]) > 4500) process.exit(1);
CHECK
pass 'hanging server: all three calls time out at 0.5s (with scheduling tolerance)'
stop_server

start_server respond
ln -s agy "$TEST_DIR/bin/codex"
ln -s agy "$TEST_DIR/bin/claude"

# Test agy without AGENT_MODEL
unset AGENT_MODEL
: > "$TEST_DIR/worker.calls"
run_delegate
[ "$CODE" = 0 ] || fail 'successful agy exit code without AGENT_MODEL'
AGY_LOG="$(jq -sr '.[0].body.data.logFile' "$TEST_DIR/events")"
grep -q '\[model:' "$TEST_DIR/stdout" && fail 'stdout contains model without AGENT_MODEL'
grep -q '\[model:' "$AGY_LOG" && fail 'log contains model without AGENT_MODEL'
jq -se 'all(.[]; index("--model") == null)' "$TEST_DIR/worker.calls" >/dev/null || fail 'agy called without --model when AGENT_MODEL is unset'

# Test agy with empty AGENT_MODEL
export AGENT_MODEL=""
: > "$TEST_DIR/worker.calls"
run_delegate
[ "$CODE" = 0 ] || fail 'successful agy exit code with empty AGENT_MODEL'
AGY_LOG="$(jq -sr '.[0].body.data.logFile' "$TEST_DIR/events")"
grep -q '\[model:' "$TEST_DIR/stdout" && fail 'stdout contains model with empty AGENT_MODEL'
grep -q '\[model:' "$AGY_LOG" && fail 'log contains model with empty AGENT_MODEL'
jq -se 'all(.[]; index("--model") == null)' "$TEST_DIR/worker.calls" >/dev/null || fail 'agy called without --model when AGENT_MODEL is empty'

# Test agy with AGENT_MODEL
export AGENT_MODEL="gemini-4-argon-high"
: > "$TEST_DIR/worker.calls"
run_delegate
[ "$CODE" = 0 ] || fail 'successful agy exit code with AGENT_MODEL'
AGY_LOG="$(jq -sr '.[0].body.data.logFile' "$TEST_DIR/events")"
grep -q '>>> Dispatching to agy \[model: gemini-4-argon-high\]' "$TEST_DIR/stdout" || fail 'stdout contains agy model'
grep -q '>>> Dispatching to agy \[model: gemini-4-argon-high\]' "$AGY_LOG" || fail 'log contains agy model'
jq -se --arg model "gemini-4-argon-high" '
  .[-1] as $call |
  ($call | index("--model")) != null and
  $call[($call | index("--model")) + 1] == $model
' "$TEST_DIR/worker.calls" >/dev/null || fail 'agy called with --model gemini-4-argon-high'

# Test codex with AGENT_MODEL
export AGENT_MODEL="gpt-6-luna"
: > "$TEST_DIR/worker.calls"
: > "$TEST_DIR/events"
bash "$ROOT/scripts/delegate.sh" codex 'Implement #7 for codex' > "$TEST_DIR/stdout" 2>&1
[ "$?" = 0 ] || fail 'successful codex exit code with AGENT_MODEL'
CODEX_LOG="$(jq -sr '.[0].body.data.logFile' "$TEST_DIR/events")"
grep -q '>>> Dispatching to codex \[model: gpt-6-luna\]' "$TEST_DIR/stdout" || fail 'stdout contains codex model'
grep -q '>>> Dispatching to codex \[model: gpt-6-luna\]' "$CODEX_LOG" || fail 'log contains codex model'
jq -se --arg model "gpt-6-luna" '
  .[-1] as $call |
  (($call | index("-m")) != null and $call[($call | index("-m")) + 1] == $model) or
  (($call | index("--model")) != null and $call[($call | index("--model")) + 1] == $model)
' "$TEST_DIR/worker.calls" >/dev/null || fail 'codex called with model option'

# Test codex without AGENT_MODEL
unset AGENT_MODEL
: > "$TEST_DIR/worker.calls"
: > "$TEST_DIR/events"
bash "$ROOT/scripts/delegate.sh" codex 'Implement #7 for codex' > "$TEST_DIR/stdout" 2>&1
[ "$?" = 0 ] || fail 'successful codex exit code without AGENT_MODEL'
CODEX_LOG="$(jq -sr '.[0].body.data.logFile' "$TEST_DIR/events")"
grep -q '\[model:' "$TEST_DIR/stdout" && fail 'stdout contains model for codex without AGENT_MODEL'
grep -q '\[model:' "$CODEX_LOG" && fail 'log contains model for codex without AGENT_MODEL'
jq -se 'all(.[]; index("-m") == null and index("--model") == null)' "$TEST_DIR/worker.calls" >/dev/null || fail 'codex called without model option when AGENT_MODEL is unset'

# Test codex with empty AGENT_MODEL
export AGENT_MODEL=""
: > "$TEST_DIR/worker.calls"
: > "$TEST_DIR/events"
bash "$ROOT/scripts/delegate.sh" codex 'Implement #7 for codex' > "$TEST_DIR/stdout" 2>&1
[ "$?" = 0 ] || fail 'successful codex exit code with empty AGENT_MODEL'
CODEX_LOG="$(jq -sr '.[0].body.data.logFile' "$TEST_DIR/events")"
grep -q '\[model:' "$TEST_DIR/stdout" && fail 'stdout contains model for codex with empty AGENT_MODEL'
grep -q '\[model:' "$CODEX_LOG" && fail 'log contains model for codex with empty AGENT_MODEL'
jq -se 'all(.[]; index("-m") == null and index("--model") == null)' "$TEST_DIR/worker.calls" >/dev/null || fail 'codex called without model option when AGENT_MODEL is empty'

# Test claude with AGENT_MODEL
export AGENT_MODEL="claude-3-7-sonnet"
: > "$TEST_DIR/worker.calls"
: > "$TEST_DIR/events"
bash "$ROOT/scripts/delegate.sh" claude 'Implement #7 for claude' > "$TEST_DIR/stdout" 2>&1
[ "$?" = 0 ] || fail 'successful claude exit code with AGENT_MODEL'
CLAUDE_LOG="$(jq -sr '.[0].body.data.logFile' "$TEST_DIR/events")"
grep -q '>>> Dispatching to claude \[model: claude-3-7-sonnet\]' "$TEST_DIR/stdout" || fail 'stdout contains claude model'
grep -q '>>> Dispatching to claude \[model: claude-3-7-sonnet\]' "$CLAUDE_LOG" || fail 'log contains claude model'
CLAUDE_GITDIR="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
CLAUDE_TMPDIR="$(cd "${TMPDIR:-/tmp}" 2>/dev/null && pwd || echo /tmp)"
[ -n "$CLAUDE_TMPDIR" ] || CLAUDE_TMPDIR="/tmp"
jq -se --arg model "claude-3-7-sonnet" --arg cwd "$PWD" --arg npm "$HOME/.npm" --arg tmp "$CLAUDE_TMPDIR" --arg git "$CLAUDE_GITDIR" '
  .[-1] as $call |
  ($call | index("--model")) != null and
  $call[($call | index("--model")) + 1] == $model and
  ($call | index("-p")) != null and
  ($call | index("--dangerously-skip-permissions")) == null and
  ($call | index("--session-id")) as $idflag |
  ($call[$idflag+1] | test("^[0-9a-f-]{36}$")) and
  ($call | index("--permission-mode")) as $modeflag |
  $call[$modeflag+1] == "acceptEdits" and
  ($call | index("--settings")) as $settingsflag |
  ($call[$settingsflag+1] | fromjson | .sandbox.enabled == true and
    .sandbox.failIfUnavailable == true and .sandbox.allowUnsandboxedCommands == false and
    .sandbox.autoAllowBashIfSandboxed == true and
    .sandbox.filesystem.allowWrite == [$cwd, $npm, $tmp, $git] and
    .sandbox.filesystem.denyWrite == [($git + "/hooks"), ($git + "/config")] and
    ((.sandbox.filesystem.denyWrite // []) | index("/") == null))
' "$TEST_DIR/worker.calls" >/dev/null || fail 'claude called with model and sandbox settings'

# Test claude without AGENT_MODEL
unset AGENT_MODEL
: > "$TEST_DIR/worker.calls"
: > "$TEST_DIR/events"
bash "$ROOT/scripts/delegate.sh" claude 'Implement #7 for claude' > "$TEST_DIR/stdout" 2>&1
[ "$?" = 0 ] || fail 'successful claude exit code without AGENT_MODEL'
CLAUDE_LOG="$(jq -sr '.[0].body.data.logFile' "$TEST_DIR/events")"
grep -q '\[model:' "$TEST_DIR/stdout" && fail 'stdout contains model for claude without AGENT_MODEL'
grep -q '\[model:' "$CLAUDE_LOG" && fail 'log contains model for claude without AGENT_MODEL'
jq -se 'all(.[]; index("-m") == null and index("--model") == null)' "$TEST_DIR/worker.calls" >/dev/null || fail 'claude called without model option when AGENT_MODEL is unset'

# Test claude with empty AGENT_MODEL
export AGENT_MODEL=""
: > "$TEST_DIR/worker.calls"
: > "$TEST_DIR/events"
bash "$ROOT/scripts/delegate.sh" claude 'Implement #7 for claude' > "$TEST_DIR/stdout" 2>&1
[ "$?" = 0 ] || fail 'successful claude exit code with empty AGENT_MODEL'
CLAUDE_LOG="$(jq -sr '.[0].body.data.logFile' "$TEST_DIR/events")"
grep -q '\[model:' "$TEST_DIR/stdout" && fail 'stdout contains model for claude with empty AGENT_MODEL'
grep -q '\[model:' "$CLAUDE_LOG" && fail 'log contains model for claude with empty AGENT_MODEL'
jq -se 'all(.[]; index("-m") == null and index("--model") == null)' "$TEST_DIR/worker.calls" >/dev/null || fail 'claude called without model option when AGENT_MODEL is empty'

unset AGENT_MODEL
pass 'AGENT_MODEL passed to agy, codex, and claude, logged, and omitted when unset or empty'

# Test claude worker events, real PID, stdout and log
: > "$TEST_DIR/events"
bash "$ROOT/scripts/delegate.sh" claude 'Implement #7 for claude' > "$TEST_DIR/stdout" 2>&1
[ "$?" = 0 ] || fail 'successful claude execution'
jq -se --argjson pid "$(cat "$WORKER_PID_FILE")" --arg cwd "$ROOT" '
  map(.body) as $e |
  ($e | map(.event)) == ["TASK_HANDOVER", "TASK_START", "TASK_COMPLETE"] and
  $e[0].pid == null and $e[1].pid == $pid and $e[2].pid == $pid and
  $e[2].data.exitCode == 0 and
  all($e[]; .agent == "claude" and .ticketId == "7" and .cwd == $cwd)
' "$TEST_DIR/events" >/dev/null || fail 'claude events and real worker PID'
pass 'claude worker starts in background, reports real PID and events'

# Ticket title via gh (success)
export FAKE_EXIT=0
export FAKE_GH_MODE=title
export FAKE_GH_TITLE='Feature: Ticket Title for Bubble'
run_delegate
[ "$CODE" = 0 ] || fail 'successful worker exit code with gh title'
jq -se --arg title "$FAKE_GH_TITLE" '
  map(.body) as $e |
  $e[0].event == "TASK_HANDOVER" and $e[0].data.title == $title and
  $e[1].event == "TASK_START" and $e[1].data.title == $title and
  $e[2].event == "TASK_COMPLETE" and ($e[2].data | has("title") | not)
' "$TEST_DIR/events" >/dev/null || fail 'title present in TASK_HANDOVER and TASK_START, absent in TASK_COMPLETE'

# Ticket title via gh with special characters (quotes, symbols, backslashes)
export FAKE_GH_TITLE='feat(#89): "Quotes", $dollar, &amp, \backslash und Sonderzeichen äöü'
run_delegate
[ "$CODE" = 0 ] || fail 'successful exit with special chars in title'
jq -se --arg title "$FAKE_GH_TITLE" '
  map(.body) as $e |
  $e[0].data.title == $title and
  $e[1].data.title == $title
' "$TEST_DIR/events" >/dev/null || fail 'special characters in title safely embedded'

# Ticket title via gh error (exits 1)
export FAKE_GH_MODE=error
run_delegate
[ "$CODE" = 0 ] || fail 'successful worker exit code when gh fails'
jq -se '
  map(.body) as $e |
  all($e[]; .data | has("title") | not)
' "$TEST_DIR/events" >/dev/null || fail 'no title field when gh returns error'

# Ticket title when gh is absent / missing
MOCK_BIN_NO_GH="$TEST_DIR/bin_no_gh"
mkdir -p "$MOCK_BIN_NO_GH"
for cmd in bash sh node jq curl mktemp mkfifo rm kill wait date grep sed cut head tail tr mkdir cat tee; do
  p="$(command -v "$cmd" 2>/dev/null || true)"
  [ -z "$p" ] || ln -sf "$p" "$MOCK_BIN_NO_GH/$cmd"
done
ln -sf "$TEST_DIR/bin/agy" "$MOCK_BIN_NO_GH/agy"

: > "$TEST_DIR/events"
PATH="$MOCK_BIN_NO_GH" bash "$ROOT/scripts/delegate.sh" agy 'Implement #7 "quoted" prompt' > "$TEST_DIR/stdout" 2>&1
CODE=$?
[ "$CODE" = 0 ] || fail 'successful worker exit code when gh is missing'
jq -se '
  map(.body) as $e |
  all($e[]; .data | has("title") | not)
' "$TEST_DIR/events" >/dev/null || fail 'no title field when gh is missing'

# Ticket title when gh hangs (timeout triggers)
export FAKE_GH_MODE=hang
export DELEGATE_GH_TIMEOUT=1
START="$(now)"
run_delegate
ELAPSED=$(( $(now) - START ))
unset DELEGATE_GH_TIMEOUT
unset FAKE_GH_MODE
[ "$CODE" = 0 ] || fail 'successful worker exit code when gh hangs'
[ "$ELAPSED" -ge 900 ] && [ "$ELAPSED" -lt 3000 ] || fail "hanging gh timeout took unexpected duration (${ELAPSED}ms)"
jq -se '
  map(.body) as $e |
  all($e[]; .data | has("title") | not)
' "$TEST_DIR/events" >/dev/null || fail 'no title field when gh times out'
pass 'ticket title via gh: success, special characters, error, missing gh, and timeout'

# Local ticket T-N with file in docs/tickets/T-N-*.md
mkdir -p "$ROOT/docs/tickets"
TEST_TICKET_FILE="$ROOT/docs/tickets/T-89-local-test.md"
cat > "$TEST_TICKET_FILE" <<'TICKET'
# Lokales Ticket: "Sprechblasen-Titel" & mehr

## 1. Kurzbeschreibung
Test ticket
TICKET

: > "$TEST_DIR/events"
bash "$ROOT/scripts/delegate.sh" agy 'Implement T-89 local ticket' > "$TEST_DIR/stdout" 2>&1
CODE=$?
rm -f "$TEST_TICKET_FILE"
rmdir "$ROOT/docs/tickets" 2>/dev/null || true
[ "$CODE" = 0 ] || fail 'successful worker exit code with local T-N ticket'
jq -se --arg title 'Lokales Ticket: "Sprechblasen-Titel" & mehr' '
  map(.body) as $e |
  $e[0].ticketId == "T-89" and
  $e[0].data.title == $title and
  $e[1].data.title == $title and
  ($e[2].data | has("title") | not)
' "$TEST_DIR/events" >/dev/null || fail 'T-N ticket title extracted from file for TASK_HANDOVER and TASK_START'

# Local ticket T-N when file does not exist
: > "$TEST_DIR/events"
bash "$ROOT/scripts/delegate.sh" agy 'Implement T-999 missing ticket' > "$TEST_DIR/stdout" 2>&1
CODE=$?
[ "$CODE" = 0 ] || fail 'successful worker exit code with missing T-N ticket file'
jq -se '
  map(.body) as $e |
  $e[0].ticketId == "T-999" and
  all($e[]; .data | has("title") | not)
' "$TEST_DIR/events" >/dev/null || fail 'no title field when T-N ticket file does not exist'
pass 'local T-N ticket: extracted from docs/tickets/T-N-*.md when present, omitted when missing'

stop_server
