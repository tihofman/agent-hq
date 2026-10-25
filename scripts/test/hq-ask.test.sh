#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ASK_SCRIPT="$ROOT_DIR/scripts/hq-ask.sh"
DELEGATE_SCRIPT="$ROOT_DIR/scripts/delegate.sh"

FAILED=0
TOTAL=0

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

pass() {
  TOTAL=$((TOTAL + 1))
  echo -e "${GREEN}PASS${NC} $1"
}

fail() {
  TOTAL=$((TOTAL + 1))
  FAILED=$((FAILED + 1))
  echo -e "${RED}FAIL${NC} $1: $2"
}

TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hq-ask-test.XXXXXX")"
REQUESTS_FILE="$TEST_DIR/requests.jsonl"
PORT_FILE="$TEST_DIR/port"
CONTROL_FILE="$TEST_DIR/control"
SERVER_PID=""

# Start fake server in background on an OS-assigned ephemeral port
node -e '
const http = require("http");
const fs = require("fs");
const reqFile = process.argv[1];
const controlFile = process.argv[2];

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", () => {
    fs.appendFileSync(reqFile, JSON.stringify({
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: body
    }) + "\n");

    let mode = "200";
    if (fs.existsSync(controlFile)) {
      mode = fs.readFileSync(controlFile, "utf8").trim();
    }

    if (mode === "hang") {
      return;
    }

    const statusCode = parseInt(mode, 10) || 200;
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    if (statusCode >= 200 && statusCode < 300) {
      res.end(JSON.stringify({ ok: true, questionId: "105-1" }));
    } else {
      res.end(JSON.stringify({ error: "Mock error " + statusCode }));
    }
  });
});

server.listen(0, "127.0.0.1", () => {
  process.stdout.write(server.address().port.toString());
});
' "$REQUESTS_FILE" "$CONTROL_FILE" > "$PORT_FILE" &
SERVER_PID=$!

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT INT TERM

WAIT_COUNT=0
while [ ! -s "$PORT_FILE" ]; do
  sleep 0.05
  WAIT_COUNT=$((WAIT_COUNT + 1))
  if [ "$WAIT_COUNT" -gt 40 ]; then
    echo "Timed out waiting for fake server to start"
    exit 1
  fi
done

PORT="$(cat "$PORT_FILE")"
SERVER_URL="http://127.0.0.1:$PORT"

# ---------------------------------------------------------------------------
# 1. Missing environment variables -> Exit 1 without sending request
# ---------------------------------------------------------------------------
: > "$REQUESTS_FILE"
OUT=$( (export HQ_TEAM="frontend"; unset HQ_ISSUE_ID; "$ASK_SCRIPT" "Eine Frage") 2>&1 )
CODE=$?
REQ_COUNT=$(wc -l < "$REQUESTS_FILE" | tr -d ' ')
if [ "$CODE" -ne 0 ] && [ "$REQ_COUNT" -eq 0 ] && [[ "$OUT" =~ HQ_ISSUE_ID ]]; then
  pass "Missing HQ_ISSUE_ID -> Exit 1 without request"
else
  fail "Missing HQ_ISSUE_ID -> Exit 1 without request" "code=$CODE count=$REQ_COUNT out=$OUT"
fi

: > "$REQUESTS_FILE"
OUT=$( (export HQ_ISSUE_ID="105"; unset HQ_TEAM; "$ASK_SCRIPT" "Eine Frage") 2>&1 )
CODE=$?
REQ_COUNT=$(wc -l < "$REQUESTS_FILE" | tr -d ' ')
if [ "$CODE" -ne 0 ] && [ "$REQ_COUNT" -eq 0 ] && [[ "$OUT" =~ HQ_TEAM ]]; then
  pass "Missing HQ_TEAM -> Exit 1 without request"
else
  fail "Missing HQ_TEAM -> Exit 1 without request" "code=$CODE count=$REQ_COUNT out=$OUT"
fi

: > "$REQUESTS_FILE"
OUT=$( (unset HQ_ISSUE_ID HQ_TEAM; "$ASK_SCRIPT" "Eine Frage") 2>&1 )
CODE=$?
REQ_COUNT=$(wc -l < "$REQUESTS_FILE" | tr -d ' ')
if [ "$CODE" -ne 0 ] && [ "$REQ_COUNT" -eq 0 ]; then
  pass "Missing both HQ_ISSUE_ID and HQ_TEAM -> Exit 1 without request"
else
  fail "Missing both HQ_ISSUE_ID and HQ_TEAM -> Exit 1 without request" "code=$CODE count=$REQ_COUNT"
fi

for invalid_id in "0" "-1" "abc"; do
  : > "$REQUESTS_FILE"
  OUT=$( (export HQ_TEAM="frontend" HQ_ISSUE_ID="$invalid_id"; "$ASK_SCRIPT" "Eine Frage") 2>&1 )
  CODE=$?
  REQ_COUNT=$(wc -l < "$REQUESTS_FILE" | tr -d ' ')
  if [ "$CODE" -ne 0 ] && [ "$REQ_COUNT" -eq 0 ] && [[ "$OUT" =~ positive[[:space:]]+Ganzzahl ]]; then
    pass "Invalid HQ_ISSUE_ID='$invalid_id' -> Exit 1 with error and no request"
  else
    fail "Invalid HQ_ISSUE_ID='$invalid_id' -> Exit 1 with error and no request" "code=$CODE count=$REQ_COUNT out=$OUT"
  fi
done

# ---------------------------------------------------------------------------
# 2. Argument validation -> Exit 1 without sending request
# ---------------------------------------------------------------------------
: > "$REQUESTS_FILE"
OUT=$(HQ_ISSUE_ID="105" HQ_TEAM="frontend" AGENT_HQ_URL="$SERVER_URL" "$ASK_SCRIPT" 2>&1)
CODE=$?
REQ_COUNT=$(wc -l < "$REQUESTS_FILE" | tr -d ' ')
if [ "$CODE" -ne 0 ] && [ "$REQ_COUNT" -eq 0 ] && [[ "$OUT" =~ Keine[[:space:]]+Frage ]]; then
  pass "No question argument -> Exit 1 without request"
else
  fail "No question argument -> Exit 1 without request" "code=$CODE count=$REQ_COUNT out=$OUT"
fi

: > "$REQUESTS_FILE"
OUT=$(HQ_ISSUE_ID="105" HQ_TEAM="frontend" AGENT_HQ_URL="$SERVER_URL" "$ASK_SCRIPT" "Frage" --option 2>&1)
CODE=$?
REQ_COUNT=$(wc -l < "$REQUESTS_FILE" | tr -d ' ')
if [ "$CODE" -ne 0 ] && [ "$REQ_COUNT" -eq 0 ] && [[ "$OUT" =~ --option[[:space:]]+erfordert[[:space:]]+einen[[:space:]]+Wert ]]; then
  pass "Option without value -> Exit 1 without request"
else
  fail "Option without value -> Exit 1 without request" "code=$CODE count=$REQ_COUNT out=$OUT"
fi

: > "$REQUESTS_FILE"
OUT=$(HQ_ISSUE_ID="105" HQ_TEAM="frontend" AGENT_HQ_URL="$SERVER_URL" "$ASK_SCRIPT" "Frage 1" "Frage 2" 2>&1)
CODE=$?
REQ_COUNT=$(wc -l < "$REQUESTS_FILE" | tr -d ' ')
if [ "$CODE" -ne 0 ] && [ "$REQ_COUNT" -eq 0 ] && [[ "$OUT" =~ Unerwartetes[[:space:]]+Argument ]]; then
  pass "Multiple positional arguments -> Exit 1 without request"
else
  fail "Multiple positional arguments -> Exit 1 without request" "code=$CODE count=$REQ_COUNT out=$OUT"
fi

# ---------------------------------------------------------------------------
# 3. Successful request without options
# ---------------------------------------------------------------------------
: > "$REQUESTS_FILE"
rm -f "$CONTROL_FILE"
OUT=$(HQ_ISSUE_ID="105" HQ_TEAM="frontend" AGENT_HQ_URL="$SERVER_URL" "$ASK_SCRIPT" "Soll SvelteKit 2 verwendet werden?")
CODE=$?
LAST_LINE=$(tail -n1 <<<"$OUT")
REQ_COUNT=$(wc -l < "$REQUESTS_FILE" | tr -d ' ')
BODY=$(tail -n1 "$REQUESTS_FILE" | jq -r '.body')
METHOD=$(tail -n1 "$REQUESTS_FILE" | jq -r '.method')
URL=$(tail -n1 "$REQUESTS_FILE" | jq -r '.url')

EXPECTED_OUTPUT="Rückfrage gestellt. Beende dich jetzt ohne weitere Änderungen."
if [ "$CODE" -eq 0 ] && \
   [ "$LAST_LINE" = "$EXPECTED_OUTPUT" ] && \
   [ "$REQ_COUNT" -eq 1 ] && \
   [ "$METHOD" = "POST" ] && \
   [ "$URL" = "/api/questions" ] && \
   [ "$(jq -r '.issueId' <<<"$BODY")" = "105" ] && \
   [ "$(jq -r '.issueId | type' <<<"$BODY")" = "number" ] && \
   [ "$(jq -r '.team' <<<"$BODY")" = "frontend" ] && \
   [ "$(jq -r '.question' <<<"$BODY")" = "Soll SvelteKit 2 verwendet werden?" ] && \
   [ "$(jq 'has("options")' <<<"$BODY")" = "false" ]; then
  pass "Question without options -> HTTP 200, correct JSON, exit 0, final output"
else
  fail "Question without options -> HTTP 200, correct JSON, exit 0, final output" "code=$CODE out='$LAST_LINE' body='$BODY'"
fi

# ---------------------------------------------------------------------------
# 4. Successful request with multiple options (testing --option)
# ---------------------------------------------------------------------------
: > "$REQUESTS_FILE"
rm -f "$CONTROL_FILE"
OUT=$(HQ_ISSUE_ID="105" HQ_TEAM="backend" AGENT_HQ_URL="$SERVER_URL" "$ASK_SCRIPT" "Welche Datenbank?" --option "PostgreSQL" --option "SQLite" --option "MySQL")
CODE=$?
LAST_LINE=$(tail -n1 <<<"$OUT")
BODY=$(tail -n1 "$REQUESTS_FILE" | jq -r '.body')

if [ "$CODE" -eq 0 ] && \
   [ "$LAST_LINE" = "$EXPECTED_OUTPUT" ] && \
   [ "$(jq -r '.team' <<<"$BODY")" = "backend" ] && \
   [ "$(jq -r '.issueId | type' <<<"$BODY")" = "number" ] && \
   [ "$(jq -r '.options | length' <<<"$BODY")" = "3" ] && \
   [ "$(jq -r '.options[0]' <<<"$BODY")" = "PostgreSQL" ] && \
   [ "$(jq -r '.options[1]' <<<"$BODY")" = "SQLite" ] && \
   [ "$(jq -r '.options[2]' <<<"$BODY")" = "MySQL" ]; then
  pass "Question with multiple options -> correct options array in JSON"
else
  fail "Question with multiple options -> correct options array in JSON" "code=$CODE out='$LAST_LINE' body='$BODY'"
fi

# ---------------------------------------------------------------------------
# 4a. Repo and job ID from the worker slot are sent; absent without env (home repo)
# ---------------------------------------------------------------------------
: > "$REQUESTS_FILE"
rm -f "$CONTROL_FILE"
OUT=$(HQ_ISSUE_ID="12" HQ_TEAM="backend" HQ_REPO="acme/my-repo" HQ_JOB_ID="acme/my-repo#12" AGENT_HQ_URL="$SERVER_URL" "$ASK_SCRIPT" "Repo-Frage?")
CODE=$?
BODY=$(tail -n1 "$REQUESTS_FILE" | jq -r '.body')
OUT_HOME=$( (unset HQ_REPO HQ_JOB_ID; HQ_ISSUE_ID="12" HQ_TEAM="backend" AGENT_HQ_URL="$SERVER_URL" "$ASK_SCRIPT" "Home-Frage?") )
HOME_BODY=$(tail -n1 "$REQUESTS_FILE" | jq -r '.body')

if [ "$CODE" -eq 0 ] && \
   [ "$(jq -r '.repo' <<<"$BODY")" = "acme/my-repo" ] && \
   [ "$(jq -r '.jobId' <<<"$BODY")" = "acme/my-repo#12" ] && \
   [ "$(jq -c 'has("repo"), has("jobId")' <<<"$HOME_BODY" | tr -d '\n')" = "falsefalse" ]; then
  pass "HQ_REPO/HQ_JOB_ID -> repo and jobId in JSON, omitted without env"
else
  fail "HQ_REPO/HQ_JOB_ID -> repo and jobId in JSON, omitted without env" "code=$CODE body='$BODY' home='$HOME_BODY' out='$OUT$OUT_HOME'"
fi

# ---------------------------------------------------------------------------
# 4b. YAGNI: -o and --option= are not supported -> Exit 1
# ---------------------------------------------------------------------------
: > "$REQUESTS_FILE"
OUT=$(HQ_ISSUE_ID="105" HQ_TEAM="frontend" AGENT_HQ_URL="$SERVER_URL" "$ASK_SCRIPT" "Frage" -o "Wert" 2>&1)
CODE=$?
REQ_COUNT=$(wc -l < "$REQUESTS_FILE" | tr -d ' ')
if [ "$CODE" -ne 0 ] && [ "$REQ_COUNT" -eq 0 ] && [[ "$OUT" =~ Unerwartetes[[:space:]]+Argument ]]; then
  pass "Unsupported -o option -> Exit 1 without request"
else
  fail "Unsupported -o option -> Exit 1 without request" "code=$CODE count=$REQ_COUNT out='$OUT'"
fi

: > "$REQUESTS_FILE"
OUT=$(HQ_ISSUE_ID="105" HQ_TEAM="frontend" AGENT_HQ_URL="$SERVER_URL" "$ASK_SCRIPT" "Frage" --option="Wert" 2>&1)
CODE=$?
REQ_COUNT=$(wc -l < "$REQUESTS_FILE" | tr -d ' ')
if [ "$CODE" -ne 0 ] && [ "$REQ_COUNT" -eq 0 ] && [[ "$OUT" =~ Unerwartetes[[:space:]]+Argument ]]; then
  pass "Unsupported --option= option -> Exit 1 without request"
else
  fail "Unsupported --option= option -> Exit 1 without request" "code=$CODE count=$REQ_COUNT out='$OUT'"
fi

# ---------------------------------------------------------------------------
# 5. Escaping of special characters (quotes, backslashes, newlines, unicode)
# ---------------------------------------------------------------------------
: > "$REQUESTS_FILE"
rm -f "$CONTROL_FILE"
SPECIAL_QUESTION="Wie soll das \"Escape\"' funktionieren? \\ und Zeilenumbruch:"$'\n'"Zweite Zeile 🚀"
SPECIAL_OPTION="Option mit \"Anführungszeichen\" & \backslash"
OUT=$(HQ_ISSUE_ID="105" HQ_TEAM="qa" AGENT_HQ_URL="$SERVER_URL" "$ASK_SCRIPT" "$SPECIAL_QUESTION" --option "$SPECIAL_OPTION")
CODE=$?
BODY=$(tail -n1 "$REQUESTS_FILE" | jq -r '.body')

if [ "$CODE" -eq 0 ] && \
   [ "$(jq -r '.question' <<<"$BODY")" = "$SPECIAL_QUESTION" ] && \
   [ "$(jq -r '.options[0]' <<<"$BODY")" = "$SPECIAL_OPTION" ]; then
  pass "Special characters and newlines correctly escaped in JSON"
else
  fail "Special characters and newlines correctly escaped in JSON" "code=$CODE body='$BODY'"
fi

# ---------------------------------------------------------------------------
# 6. HTTP Non-2xx response -> Exit != 0 with error message
# ---------------------------------------------------------------------------
echo "409" > "$CONTROL_FILE"
: > "$REQUESTS_FILE"
OUT=$(HQ_ISSUE_ID="105" HQ_TEAM="frontend" AGENT_HQ_URL="$SERVER_URL" "$ASK_SCRIPT" "Testfrage" 2>&1)
CODE=$?
if [ "$CODE" -ne 0 ] && [[ "$OUT" =~ HTTP[[:space:]]+409 ]]; then
  pass "Server returns 409 Conflict -> Exit != 0 with message"
else
  fail "Server returns 409 Conflict -> Exit != 0 with message" "code=$CODE out='$OUT'"
fi

echo "400" > "$CONTROL_FILE"
: > "$REQUESTS_FILE"
OUT=$(HQ_ISSUE_ID="105" HQ_TEAM="frontend" AGENT_HQ_URL="$SERVER_URL" "$ASK_SCRIPT" "Testfrage" 2>&1)
CODE=$?
if [ "$CODE" -ne 0 ] && [[ "$OUT" =~ HTTP[[:space:]]+400 ]]; then
  pass "Server returns 400 Bad Request -> Exit != 0 with message"
else
  fail "Server returns 400 Bad Request -> Exit != 0 with message" "code=$CODE out='$OUT'"
fi

echo "500" > "$CONTROL_FILE"
: > "$REQUESTS_FILE"
OUT=$(HQ_ISSUE_ID="105" HQ_TEAM="frontend" AGENT_HQ_URL="$SERVER_URL" "$ASK_SCRIPT" "Testfrage" 2>&1)
CODE=$?
if [ "$CODE" -ne 0 ] && [[ "$OUT" =~ HTTP[[:space:]]+500 ]]; then
  pass "Server returns 500 Internal Error -> Exit != 0 with message"
else
  fail "Server returns 500 Internal Error -> Exit != 0 with message" "code=$CODE out='$OUT'"
fi

# ---------------------------------------------------------------------------
# 7. Server offline / connection refused -> Exit != 0 quickly
# ---------------------------------------------------------------------------
OFFLINE_URL="http://127.0.0.1:49999"
START_TIME=$(node -e 'console.log(Date.now())')
OUT=$(HQ_ISSUE_ID="105" HQ_TEAM="frontend" AGENT_HQ_URL="$OFFLINE_URL" "$ASK_SCRIPT" "Offline Frage" 2>&1)
CODE=$?
END_TIME=$(node -e 'console.log(Date.now())')
ELAPSED=$(( END_TIME - START_TIME ))

if [ "$CODE" -ne 0 ] && [ "$ELAPSED" -lt 1500 ] && [[ "$OUT" =~ Fehler ]]; then
  pass "Server offline -> Exit != 0 without long delay (${ELAPSED}ms)"
else
  fail "Server offline -> Exit != 0 without long delay" "code=$CODE elapsed=${ELAPSED}ms out='$OUT'"
fi

# ---------------------------------------------------------------------------
# 8. Hanging server -> times out quickly with Exit != 0
# ---------------------------------------------------------------------------
echo "hang" > "$CONTROL_FILE"
START_TIME=$(node -e 'console.log(Date.now())')
OUT=$(HQ_ISSUE_ID="105" HQ_TEAM="frontend" HQ_CONNECT_TIMEOUT="0.1" HQ_MAX_TIME="0.5" AGENT_HQ_URL="$SERVER_URL" "$ASK_SCRIPT" "Hanging Frage" 2>&1)
CODE=$?
END_TIME=$(node -e 'console.log(Date.now())')
ELAPSED=$(( END_TIME - START_TIME ))

if [ "$CODE" -ne 0 ] && [ "$ELAPSED" -lt 2500 ] && [[ "$OUT" =~ Fehler ]]; then
  pass "Hanging server -> times out quickly (${ELAPSED}ms) and exits != 0"
else
  fail "Hanging server -> times out quickly and exits != 0" "code=$CODE elapsed=${ELAPSED}ms out='$OUT'"
fi

# ---------------------------------------------------------------------------
# 9. Default AGENT_HQ_URL and timeouts (tested via fake curl wrapper)
# ---------------------------------------------------------------------------
FAKE_CURL_DIR="$TEST_DIR/fake_curl"
mkdir -p "$FAKE_CURL_DIR"
cat > "$FAKE_CURL_DIR/curl" << 'EOF'
#!/usr/bin/env bash
while [ "$#" -gt 0 ]; do
  case "$1" in
    --connect-timeout)
      echo "$2" > "$(dirname "$0")/curl_connect_timeout.txt"
      shift 2
      ;;
    --max-time)
      echo "$2" > "$(dirname "$0")/curl_max_time.txt"
      shift 2
      ;;
    http://*)
      echo "$1" > "$(dirname "$0")/curl_url.txt"
      shift
      ;;
    *)
      shift
      ;;
  esac
done
printf '{"ok":true}\n200\n'
exit 0
EOF
chmod +x "$FAKE_CURL_DIR/curl"

OUT=$( (unset AGENT_HQ_URL HQ_CONNECT_TIMEOUT HQ_MAX_TIME; PATH="$FAKE_CURL_DIR:$PATH" HQ_ISSUE_ID="105" HQ_TEAM="frontend" "$ASK_SCRIPT" "Default Port Frage") 2>&1 )
CODE=$?
CAPTURED_URL="$(cat "$FAKE_CURL_DIR/curl_url.txt" 2>/dev/null || echo '')"
CAPTURED_CONNECT_TO="$(cat "$FAKE_CURL_DIR/curl_connect_timeout.txt" 2>/dev/null || echo '')"
CAPTURED_MAX_TIME="$(cat "$FAKE_CURL_DIR/curl_max_time.txt" 2>/dev/null || echo '')"
if [ "$CODE" -eq 0 ] && \
   [ "$CAPTURED_URL" = "http://127.0.0.1:3333/api/questions" ] && \
   [ "$CAPTURED_CONNECT_TO" = "2" ] && \
   [ "$CAPTURED_MAX_TIME" = "10" ]; then
  pass "Default AGENT_HQ_URL targets http://127.0.0.1:3333 and defaults to --connect-timeout 2 --max-time 10"
else
  fail "Default AGENT_HQ_URL and timeouts" "code=$CODE url='$CAPTURED_URL' connect_to='$CAPTURED_CONNECT_TO' max_time='$CAPTURED_MAX_TIME' out='$OUT'"
fi

OUT=$( (PATH="$FAKE_CURL_DIR:$PATH" HQ_CONNECT_TIMEOUT="3" HQ_MAX_TIME="15" HQ_ISSUE_ID="105" HQ_TEAM="frontend" "$ASK_SCRIPT" "Override Timeout Frage") 2>&1 )
CODE=$?
CAPTURED_CONNECT_TO="$(cat "$FAKE_CURL_DIR/curl_connect_timeout.txt" 2>/dev/null || echo '')"
CAPTURED_MAX_TIME="$(cat "$FAKE_CURL_DIR/curl_max_time.txt" 2>/dev/null || echo '')"
if [ "$CODE" -eq 0 ] && \
   [ "$CAPTURED_CONNECT_TO" = "3" ] && \
   [ "$CAPTURED_MAX_TIME" = "15" ]; then
  pass "HQ_CONNECT_TIMEOUT and HQ_MAX_TIME override curl timeouts"
else
  fail "HQ_CONNECT_TIMEOUT and HQ_MAX_TIME override curl timeouts" "code=$CODE connect_to='$CAPTURED_CONNECT_TO' max_time='$CAPTURED_MAX_TIME' out='$OUT'"
fi

# ---------------------------------------------------------------------------
# 10. delegate.sh environment inheritance: HQ_ISSUE_ID and HQ_TEAM to worker
# ---------------------------------------------------------------------------
FAKE_BIN_DIR="$TEST_DIR/bin"
mkdir -p "$FAKE_BIN_DIR"
cat > "$FAKE_BIN_DIR/agy" << 'AGENT'
#!/usr/bin/env bash
echo "FAKE_AGENT_HQ_ISSUE_ID=${HQ_ISSUE_ID:-unset}" > "$TMPDIR/inherited_env.txt"
echo "FAKE_AGENT_HQ_TEAM=${HQ_TEAM:-unset}" >> "$TMPDIR/inherited_env.txt"
exit 0
AGENT
chmod +x "$FAKE_BIN_DIR/agy"

INHERIT_OUT=$(PATH="$FAKE_BIN_DIR:$PATH" \
  TMPDIR="$TEST_DIR" \
  AGENT_HQ_URL="$SERVER_URL" \
  HQ_ISSUE_ID="105" \
  HQ_TEAM="frontend" \
  bash "$DELEGATE_SCRIPT" agy "Task for #105" 2>&1)

if [ -f "$TEST_DIR/inherited_env.txt" ] && \
   grep -q "FAKE_AGENT_HQ_ISSUE_ID=105" "$TEST_DIR/inherited_env.txt" && \
   grep -q "FAKE_AGENT_HQ_TEAM=frontend" "$TEST_DIR/inherited_env.txt"; then
  pass "delegate.sh passes HQ_ISSUE_ID and HQ_TEAM to worker process"
else
  ENV_FILE_CONTENT="$(cat "$TEST_DIR/inherited_env.txt" 2>/dev/null || echo '<no file>')"
  fail "delegate.sh passes HQ_ISSUE_ID and HQ_TEAM to worker process" "env='$ENV_FILE_CONTENT' out='$INHERIT_OUT'"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "---"
echo "Tests completed: $TOTAL | Failed: $FAILED"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi
