#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEST_DIR="$(mktemp -d)"
SERVER_PID=
DELEGATE_PID=
cleanup() {
  [ -z "$DELEGATE_PID" ] || kill -TERM "$DELEGATE_PID" 2>/dev/null || true
  [ -z "$SERVER_PID" ] || kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT
fail() { echo "FAIL: $*"; [ ! -f "$TEST_DIR/stdout" ] || cat "$TEST_DIR/stdout"; exit 1; }
pass() { echo "PASS: $*"; }
mkdir -p "$TEST_DIR/bin"
export AGENT_HQ_LOG_DIR="$TEST_DIR/agent-hq"
export TMPDIR="$TEST_DIR" WORKER_PID_FILE="$TEST_DIR/worker.pid"
export PATH="$TEST_DIR/bin:$PATH"
cat > "$TEST_DIR/bin/agy" <<'WORKER'
#!/usr/bin/env bash
printf '%s\n' "$$" > "$WORKER_PID_FILE"
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
