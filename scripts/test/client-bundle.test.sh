#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOTAL=0
FAILED=0

pass() {
  TOTAL=$((TOTAL + 1))
  echo "PASS: $*"
}

fail() {
  TOTAL=$((TOTAL + 1))
  FAILED=$((FAILED + 1))
  echo "FAIL: $*"
}

CLIENT_DIR="$ROOT/apps/agent-hq/build/client"

if [[ ! -d "$CLIENT_DIR" ]]; then
  echo "Client bundle directory not found; building agent-hq..."
  (cd "$ROOT" && npx nx build agent-hq >/dev/null)
fi

FORBIDDEN_PATTERN='process\.version([^a-zA-Z0-9_]|$)|RedisError|bullmq|ioredis'
matches=$(grep -rnE "$FORBIDDEN_PATTERN" "$CLIENT_DIR" 2>/dev/null || true)

if [[ -n "$matches" ]]; then
  fail "Client bundle contains forbidden references ($FORBIDDEN_PATTERN)"
  echo "$matches" | head -n 10
else
  pass "Client bundle is free of process.version, RedisError, bullmq, ioredis"
fi

echo "---"
echo "Tests completed: $TOTAL | Failed: $FAILED"
exit "$FAILED"
