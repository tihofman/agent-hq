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

# Test runner helper
run_case() {
  local name="$1"
  local json="$2"
  local expected_event="$3"
  local expected_pr="${4:-}"

  > "$REQUESTS_FILE"
  local exit_code=0
  printf '%s' "$json" | bash "$HOOK_SCRIPT" || exit_code=$?

  if [ "$exit_code" -ne 0 ]; then
    fail "$name" "hook exited with code $exit_code (expected 0)"
    return
  fi

  if [ "$expected_event" = "NONE" ]; then
    if [ -s "$REQUESTS_FILE" ]; then
      fail "$name" "server unexpectedly received an event: $(cat "$REQUESTS_FILE")"
    else
      pass "$name"
    fi
  else
    if [ ! -s "$REQUESTS_FILE" ]; then
      fail "$name" "no event was received by server"
      return
    fi

    local actual_event actual_agent actual_pr
    actual_event="$(jq -r '.event // empty' < "$REQUESTS_FILE")"
    actual_agent="$(jq -r '.agent // empty' < "$REQUESTS_FILE")"
    actual_pr="$(jq -r '.data.prNumber // empty' < "$REQUESTS_FILE")"

    if [ "$actual_event" != "$expected_event" ]; then
      fail "$name" "expected event $expected_event, got $actual_event"
      return
    fi

    if [ "$actual_agent" != "claude" ]; then
      fail "$name" "expected agent claude, got $actual_agent"
      return
    fi

    if [ -n "$expected_pr" ] && [ "$actual_pr" != "$expected_pr" ]; then
      fail "$name" "expected prNumber $expected_pr, got $actual_pr"
      return
    fi

    pass "$name"
  fi
}

# 1. gh pr create --draft
run_case "Pattern: gh pr create --draft -> DRAFT_PR_CREATED" '{
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
}' "DRAFT_PR_CREATED" 42

# 2. gh pr diff
run_case "Pattern: gh pr diff -> REVIEW_START" '{
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
}' "REVIEW_START" 15

# 3. gh pr view
run_case "Pattern: gh pr view -> REVIEW_START" '{
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
}' "REVIEW_START" 8

# 4. gh pr ready
run_case "Pattern: gh pr ready -> PR_READY" '{
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
}' "PR_READY" 42

# 5. gh pr checks (PostToolUse) -> CI_CHECK_PASS
run_case "Pattern: gh pr checks (PostToolUse) -> CI_CHECK_PASS" '{
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
}' "CI_CHECK_PASS" 42

# 6. gh pr merge -> MERGED
run_case "Pattern: gh pr merge -> MERGED" '{
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
}' "MERGED" 42

# 7. Non-matching command sends nothing
run_case "Non-matching command sends nothing" '{
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
}' "NONE"

# 8. Broken JSON exits 0 without error or sending
run_case "Broken JSON -> exit 0, sends nothing" '{ malformed json: not valid...' "NONE"

# 9. Empty stdin exits 0 without error or sending
run_case "Empty stdin -> exit 0, sends nothing" "" "NONE"

# 10. Server offline -> exit 0 without delay (< 1s), measured without python3
TEST_NAME="Server offline -> exit 0 without delay"
OLD_HQ_URL="$AGENT_HQ_URL"
export AGENT_HQ_URL="http://127.0.0.1:49999"

START_MS=0
if [ -n "${EPOCHREALTIME:-}" ]; then
  START_MS=$(( ${EPOCHREALTIME/./} / 1000 ))
else
  START_MS=$(node -e 'console.log(Date.now())')
fi

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

END_MS=0
if [ -n "${EPOCHREALTIME:-}" ]; then
  END_MS=$(( ${EPOCHREALTIME/./} / 1000 ))
else
  END_MS=$(node -e 'console.log(Date.now())')
fi

DURATION_MS=$(( END_MS - START_MS ))
export AGENT_HQ_URL="$OLD_HQ_URL"

if [ "$EXIT_CODE" -ne 0 ]; then
  fail "$TEST_NAME" "hook exited with code $EXIT_CODE (expected 0)"
elif [ "$DURATION_MS" -lt 1000 ]; then
  pass "$TEST_NAME (completed in ${DURATION_MS}ms)"
else
  fail "$TEST_NAME" "hook took too long (${DURATION_MS}ms >= 1000ms)"
fi

# 11. gh pr create without --draft sends nothing
run_case "gh pr create without --draft sends nothing" '{
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
}' "NONE"

# 12. Non-Bash tool (e.g. Write) sends nothing
run_case "Non-Bash tool sends nothing" '{
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
}' "NONE"

# 13. PostToolUseFailure: gh pr checks with Exit 1 -> CI_CHECK_FAIL
run_case "PostToolUseFailure: gh pr checks with Exit 1 -> CI_CHECK_FAIL" '{
  "hook_event_name": "PostToolUseFailure",
  "tool_name": "Bash",
  "cwd": "/workspace/agent-hq",
  "tool_input": {
    "command": "gh pr checks 99"
  },
  "error": "Exit code 1\n✕ build (push) failed 1m32s\n"
}' "CI_CHECK_FAIL" 99

# 14. PostToolUseFailure: gh pr checks with Exit 8 (pending) -> sends nothing
run_case "PostToolUseFailure: gh pr checks with Exit 8 -> sends nothing" '{
  "hook_event_name": "PostToolUseFailure",
  "tool_name": "Bash",
  "cwd": "/workspace/agent-hq",
  "tool_input": {
    "command": "gh pr checks 99"
  },
  "error": "Exit code 8\n- build (push) pending 1m32s\n"
}' "NONE"

# 15. PostToolUseFailure: gh pr merge with Exit 1 -> sends nothing
run_case "PostToolUseFailure: gh pr merge with Exit 1 -> sends nothing" '{
  "hook_event_name": "PostToolUseFailure",
  "tool_name": "Bash",
  "cwd": "/workspace/agent-hq",
  "tool_input": {
    "command": "gh pr merge 42 --squash"
  },
  "error": "Exit code 1\nPull request is not mergeable\n"
}' "NONE"

# 16. PR number precedence: command argument over body URL (/pull/5 in body -> prNumber 28)
run_case "PR number precedence: command argument over body URL" '{
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "cwd": "/workspace/agent-hq",
  "tool_input": {
    "command": "gh pr view 28 --json body"
  },
  "tool_response": {
    "stdout": "{\"body\": \"See also https://github.com/tihofman/agent-hq/pull/5 for background\"}\n",
    "stderr": ""
  }
}' "REVIEW_START" 28

# 17. PR number fallback: gh pr merge output format (pull request .*#N)
run_case "PR number fallback: gh pr merge output format" '{
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "cwd": "/workspace/agent-hq",
  "tool_input": {
    "command": "gh pr merge --squash"
  },
  "tool_response": {
    "stdout": "Merged pull request tihofman/agent-hq#42 into main\n",
    "stderr": ""
  }
}' "MERGED" 42

echo "---"
echo "Tests completed: $TOTAL | Failed: $FAILED"
if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
exit 0
