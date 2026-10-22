#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
HOOK_SCRIPT="$ROOT_DIR/scripts/hq-hook.sh"

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

# Temp files for fake server
REQUESTS_FILE="$(mktemp "${TMPDIR:-/tmp}/hq-test-requests.XXXXXX")"
PORT_FILE="$(mktemp "${TMPDIR:-/tmp}/hq-test-port.XXXXXX")"

# Start fake server in background on an OS-assigned ephemeral port
node -e '
const http = require("http");
const fs = require("fs");
const reqFile = process.argv[1];

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", chunk => body += chunk);
  req.on("end", () => {
    if (req.url === "/api/events" && req.method === "POST") {
      fs.appendFileSync(reqFile, body + "\n");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
});

server.listen(0, "127.0.0.1", () => {
  process.stdout.write(server.address().port.toString());
});
' "$REQUESTS_FILE" > "$PORT_FILE" &
SERVER_PID=$!

cleanup() {
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$REQUESTS_FILE" "$PORT_FILE"
}
trap cleanup EXIT INT TERM

# Wait for server to report port
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
export AGENT_HQ_URL="http://127.0.0.1:$PORT"

# Test 1: gh pr create --draft
TEST_NAME="Pattern: gh pr create --draft -> DRAFT_PR_CREATED"
> "$REQUESTS_FILE"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<'EOF' || EXIT_CODE=$?
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "cwd": "/workspace/agent-hq",
  "tool_input": {
    "command": "gh pr create --draft --title \"feat(#8): Claude-Code-Hook\" --body \"Closes #8\""
  },
  "tool_response": {
    "stdout": "https://github.com/tihofman/agent-hq/pull/42\n",
    "stderr": ""
  }
}
EOF
if [ "$EXIT_CODE" -ne 0 ]; then
  fail "$TEST_NAME" "hook exited with code $EXIT_CODE"
elif [ ! -s "$REQUESTS_FILE" ]; then
  fail "$TEST_NAME" "no event was received by server"
else
  EVENT="$(jq -r .event < "$REQUESTS_FILE")"
  AGENT="$(jq -r .agent < "$REQUESTS_FILE")"
  CWD="$(jq -r .cwd < "$REQUESTS_FILE")"
  PR="$(jq -r .data.prNumber < "$REQUESTS_FILE")"
  if [ "$EVENT" = "DRAFT_PR_CREATED" ] && [ "$AGENT" = "claude" ] && [ "$CWD" = "/workspace/agent-hq" ] && [ "$PR" = "42" ]; then
    pass "$TEST_NAME"
  else
    fail "$TEST_NAME" "unexpected payload: event=$EVENT, agent=$AGENT, cwd=$CWD, prNumber=$PR"
  fi
fi

# Test 2: gh pr diff
TEST_NAME="Pattern: gh pr diff -> REVIEW_START"
> "$REQUESTS_FILE"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<'EOF' || EXIT_CODE=$?
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "cwd": "/workspace/agent-hq",
  "tool_input": {
    "command": "gh pr diff https://github.com/tihofman/agent-hq/pull/15"
  },
  "tool_response": {
    "stdout": "diff --git a/scripts/test.sh b/scripts/test.sh\n",
    "stderr": ""
  }
}
EOF
if [ "$EXIT_CODE" -ne 0 ]; then
  fail "$TEST_NAME" "hook exited with code $EXIT_CODE"
elif [ ! -s "$REQUESTS_FILE" ]; then
  fail "$TEST_NAME" "no event was received by server"
else
  EVENT="$(jq -r .event < "$REQUESTS_FILE")"
  AGENT="$(jq -r .agent < "$REQUESTS_FILE")"
  PR="$(jq -r .data.prNumber < "$REQUESTS_FILE")"
  if [ "$EVENT" = "REVIEW_START" ] && [ "$AGENT" = "claude" ] && [ "$PR" = "15" ]; then
    pass "$TEST_NAME"
  else
    fail "$TEST_NAME" "unexpected payload: event=$EVENT, agent=$AGENT, prNumber=$PR"
  fi
fi

# Test 3: gh pr view
TEST_NAME="Pattern: gh pr view -> REVIEW_START"
> "$REQUESTS_FILE"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<'EOF' || EXIT_CODE=$?
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "cwd": "/workspace/agent-hq",
  "tool_input": {
    "command": "gh pr view 8"
  },
  "tool_response": {
    "stdout": "title:\tClaude-Code-Hook\nstate:\tOPEN\n",
    "stderr": ""
  }
}
EOF
if [ "$EXIT_CODE" -ne 0 ]; then
  fail "$TEST_NAME" "hook exited with code $EXIT_CODE"
elif [ ! -s "$REQUESTS_FILE" ]; then
  fail "$TEST_NAME" "no event was received by server"
else
  EVENT="$(jq -r .event < "$REQUESTS_FILE")"
  PR="$(jq -r .data.prNumber < "$REQUESTS_FILE")"
  if [ "$EVENT" = "REVIEW_START" ] && [ "$PR" = "8" ]; then
    pass "$TEST_NAME"
  else
    fail "$TEST_NAME" "unexpected payload: event=$EVENT, prNumber=$PR"
  fi
fi

# Test 4: gh pr ready
TEST_NAME="Pattern: gh pr ready -> PR_READY"
> "$REQUESTS_FILE"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<'EOF' || EXIT_CODE=$?
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "cwd": "/workspace/agent-hq",
  "tool_input": {
    "command": "gh pr ready 42"
  },
  "tool_response": {
    "stdout": "",
    "stderr": ""
  }
}
EOF
if [ "$EXIT_CODE" -ne 0 ]; then
  fail "$TEST_NAME" "hook exited with code $EXIT_CODE"
elif [ ! -s "$REQUESTS_FILE" ]; then
  fail "$TEST_NAME" "no event was received by server"
else
  EVENT="$(jq -r .event < "$REQUESTS_FILE")"
  PR="$(jq -r .data.prNumber < "$REQUESTS_FILE")"
  if [ "$EVENT" = "PR_READY" ] && [ "$PR" = "42" ]; then
    pass "$TEST_NAME"
  else
    fail "$TEST_NAME" "unexpected payload: event=$EVENT, prNumber=$PR"
  fi
fi

# Test 5: gh pr checks (PASS)
TEST_NAME="Pattern: gh pr checks (PASS) -> CI_CHECK_PASS"
> "$REQUESTS_FILE"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<'EOF' || EXIT_CODE=$?
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "cwd": "/workspace/agent-hq",
  "tool_input": {
    "command": "gh pr checks 42"
  },
  "tool_response": {
    "stdout": "✓ build (push) pass 1m32s https://github.com/...\n✓ test (push) pass 45s https://github.com/...\n",
    "stderr": ""
  }
}
EOF
if [ "$EXIT_CODE" -ne 0 ]; then
  fail "$TEST_NAME" "hook exited with code $EXIT_CODE"
elif [ ! -s "$REQUESTS_FILE" ]; then
  fail "$TEST_NAME" "no event was received by server"
else
  EVENT="$(jq -r .event < "$REQUESTS_FILE")"
  PR="$(jq -r .data.prNumber < "$REQUESTS_FILE")"
  if [ "$EVENT" = "CI_CHECK_PASS" ] && [ "$PR" = "42" ]; then
    pass "$TEST_NAME"
  else
    fail "$TEST_NAME" "unexpected payload: event=$EVENT, prNumber=$PR"
  fi
fi

# Test 6: gh pr checks (FAIL)
TEST_NAME="Pattern: gh pr checks (FAIL) -> CI_CHECK_FAIL"
> "$REQUESTS_FILE"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<'EOF' || EXIT_CODE=$?
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "cwd": "/workspace/agent-hq",
  "tool_input": {
    "command": "gh pr checks 42"
  },
  "tool_response": {
    "stdout": "✓ build (push) pass 1m32s https://github.com/...\n✕ test (push) fail 45s https://github.com/...\n",
    "stderr": ""
  }
}
EOF
if [ "$EXIT_CODE" -ne 0 ]; then
  fail "$TEST_NAME" "hook exited with code $EXIT_CODE"
elif [ ! -s "$REQUESTS_FILE" ]; then
  fail "$TEST_NAME" "no event was received by server"
else
  EVENT="$(jq -r .event < "$REQUESTS_FILE")"
  PR="$(jq -r .data.prNumber < "$REQUESTS_FILE")"
  if [ "$EVENT" = "CI_CHECK_FAIL" ] && [ "$PR" = "42" ]; then
    pass "$TEST_NAME"
  else
    fail "$TEST_NAME" "unexpected payload: event=$EVENT, prNumber=$PR"
  fi
fi

# Test 7: gh pr merge
TEST_NAME="Pattern: gh pr merge -> MERGED"
> "$REQUESTS_FILE"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<'EOF' || EXIT_CODE=$?
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "cwd": "/workspace/agent-hq",
  "tool_input": {
    "command": "gh pr merge 42 --squash"
  },
  "tool_response": {
    "stdout": "Merged pull request #42\n",
    "stderr": ""
  }
}
EOF
if [ "$EXIT_CODE" -ne 0 ]; then
  fail "$TEST_NAME" "hook exited with code $EXIT_CODE"
elif [ ! -s "$REQUESTS_FILE" ]; then
  fail "$TEST_NAME" "no event was received by server"
else
  EVENT="$(jq -r .event < "$REQUESTS_FILE")"
  PR="$(jq -r .data.prNumber < "$REQUESTS_FILE")"
  if [ "$EVENT" = "MERGED" ] && [ "$PR" = "42" ]; then
    pass "$TEST_NAME"
  else
    fail "$TEST_NAME" "unexpected payload: event=$EVENT, prNumber=$PR"
  fi
fi

# Test 8: Non-matching command sends nothing
TEST_NAME="Non-matching command sends nothing"
> "$REQUESTS_FILE"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<'EOF' || EXIT_CODE=$?
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "cwd": "/workspace/agent-hq",
  "tool_input": {
    "command": "git status"
  },
  "tool_response": {
    "stdout": "On branch main\n",
    "stderr": ""
  }
}
EOF
if [ "$EXIT_CODE" -ne 0 ]; then
  fail "$TEST_NAME" "hook exited with code $EXIT_CODE (expected 0)"
elif [ -s "$REQUESTS_FILE" ]; then
  fail "$TEST_NAME" "server unexpectedly received an event: $(cat "$REQUESTS_FILE")"
else
  pass "$TEST_NAME"
fi

# Test 9: Broken JSON exits 0 without error or sending
TEST_NAME="Broken JSON -> exit 0, sends nothing"
> "$REQUESTS_FILE"
EXIT_CODE=0
echo '{ malformed json: not valid...' | bash "$HOOK_SCRIPT" || EXIT_CODE=$?
if [ "$EXIT_CODE" -ne 0 ]; then
  fail "$TEST_NAME" "hook exited with code $EXIT_CODE (expected 0)"
elif [ -s "$REQUESTS_FILE" ]; then
  fail "$TEST_NAME" "server unexpectedly received an event"
else
  pass "$TEST_NAME"
fi

# Test 10: Empty stdin exits 0 without error or sending
TEST_NAME="Empty stdin -> exit 0, sends nothing"
> "$REQUESTS_FILE"
EXIT_CODE=0
echo -n "" | bash "$HOOK_SCRIPT" || EXIT_CODE=$?
if [ "$EXIT_CODE" -ne 0 ]; then
  fail "$TEST_NAME" "hook exited with code $EXIT_CODE (expected 0)"
elif [ -s "$REQUESTS_FILE" ]; then
  fail "$TEST_NAME" "server unexpectedly received an event"
else
  pass "$TEST_NAME"
fi

# Test 11: Server offline -> exit 0 without delay (< 1s)
TEST_NAME="Server offline -> exit 0 without delay"
OLD_HQ_URL="$AGENT_HQ_URL"
# Use an unassigned port on 127.0.0.1 where nothing is listening
export AGENT_HQ_URL="http://127.0.0.1:49999"

START_TIME=$(python3 -c 'import time; print(time.time())')
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<'EOF' || EXIT_CODE=$?
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "cwd": "/workspace/agent-hq",
  "tool_input": {
    "command": "gh pr view 8"
  },
  "tool_response": {
    "stdout": "title:\tTest\n",
    "stderr": ""
  }
}
EOF
END_TIME=$(python3 -c 'import time; print(time.time())')
DURATION=$(python3 -c "print(f'{$END_TIME - $START_TIME:.2f}')")
export AGENT_HQ_URL="$OLD_HQ_URL"

if [ "$EXIT_CODE" -ne 0 ]; then
  fail "$TEST_NAME" "hook exited with code $EXIT_CODE (expected 0)"
elif python3 -c "import sys; sys.exit(0 if float('$DURATION') < 1.0 else 1)"; then
  pass "$TEST_NAME (completed in ${DURATION}s)"
else
  fail "$TEST_NAME" "hook took too long (${DURATION}s >= 1.0s)"
fi

# Test 12: gh pr create WITHOUT --draft sends nothing
TEST_NAME="gh pr create without --draft sends nothing"
> "$REQUESTS_FILE"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<'EOF' || EXIT_CODE=$?
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "cwd": "/workspace/agent-hq",
  "tool_input": {
    "command": "gh pr create --title \"regular PR\" --body \"test\""
  },
  "tool_response": {
    "stdout": "https://github.com/tihofman/agent-hq/pull/50\n",
    "stderr": ""
  }
}
EOF
if [ "$EXIT_CODE" -ne 0 ]; then
  fail "$TEST_NAME" "hook exited with code $EXIT_CODE (expected 0)"
elif [ -s "$REQUESTS_FILE" ]; then
  fail "$TEST_NAME" "server unexpectedly received an event: $(cat "$REQUESTS_FILE")"
else
  pass "$TEST_NAME"
fi

# Test 13: gh pr checks with exitCode: 1 -> CI_CHECK_FAIL
TEST_NAME="Pattern: gh pr checks with exitCode: 1 -> CI_CHECK_FAIL"
> "$REQUESTS_FILE"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<'EOF' || EXIT_CODE=$?
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "cwd": "/workspace/agent-hq",
  "tool_input": {
    "command": "gh pr checks 99"
  },
  "tool_response": {
    "stdout": "checks in progress\n",
    "stderr": "",
    "exitCode": 1
  }
}
EOF
if [ "$EXIT_CODE" -ne 0 ]; then
  fail "$TEST_NAME" "hook exited with code $EXIT_CODE"
elif [ ! -s "$REQUESTS_FILE" ]; then
  fail "$TEST_NAME" "no event was received by server"
else
  EVENT="$(jq -r .event < "$REQUESTS_FILE")"
  PR="$(jq -r .data.prNumber < "$REQUESTS_FILE")"
  if [ "$EVENT" = "CI_CHECK_FAIL" ] && [ "$PR" = "99" ]; then
    pass "$TEST_NAME"
  else
    fail "$TEST_NAME" "unexpected payload: event=$EVENT, prNumber=$PR"
  fi
fi

# Test 14: Non-bash tool (e.g. Write) sends nothing
TEST_NAME="Non-Bash tool sends nothing"
> "$REQUESTS_FILE"
EXIT_CODE=0
bash "$HOOK_SCRIPT" <<'EOF' || EXIT_CODE=$?
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "cwd": "/workspace/agent-hq",
  "tool_input": {
    "file_path": "/workspace/file.txt",
    "content": "gh pr view 8"
  },
  "tool_response": {
    "filePath": "/workspace/file.txt",
    "type": "create"
  }
}
EOF
if [ "$EXIT_CODE" -ne 0 ]; then
  fail "$TEST_NAME" "hook exited with code $EXIT_CODE (expected 0)"
elif [ -s "$REQUESTS_FILE" ]; then
  fail "$TEST_NAME" "server unexpectedly received an event: $(cat "$REQUESTS_FILE")"
else
  pass "$TEST_NAME"
fi

echo "---"
echo "Tests completed: $TOTAL | Failed: $FAILED"
if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
exit 0
